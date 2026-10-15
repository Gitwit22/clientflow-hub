import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';

// Pushes operational failures to Support Hub (telemetry contract v1).
//
// Ground rules, in priority order:
//   1. Telemetry never blocks or breaks ClientFlow: reportError() returns immediately, never
//      throws, and every send is bounded by a timeout. If Support Hub is down, events are dropped.
//   2. Only operational metadata leaves ClientFlow: component, error code, route template, request
//      id, status. Never client names, emails, form answers, contract content, tokens or headers.
//   3. A failure loop must not flood Support Hub, so sends are capped per fingerprint per minute.
//      Support Hub groups events into incidents, so the dropped duplicates lose nothing but count.

export const TELEMETRY_SCHEMA_VERSION = '1.0';
/** DI token for an explicit reporter (tests); unset in the app, which uses supportHubTelemetry(). */
export const SUPPORT_HUB_TELEMETRY = Symbol('SUPPORT_HUB_TELEMETRY');
const APPLICATION_ID = 'clientflow';
const SERVICE_NAME = 'clientflow-api';
const SEND_TIMEOUT_MS = 3_000;
const MAX_IN_FLIGHT = 10;
const MAX_PER_FINGERPRINT_PER_MINUTE = 30;
const KEY_PATTERN = /^shk_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export type TelemetryEnvironment = 'production' | 'staging' | 'development';
export type TelemetrySeverity = 'critical' | 'error' | 'warning' | 'info';

export interface TelemetryReport {
  /** 'error' opens/joins an incident in Support Hub; 'warning' is recorded only. */
  type?: 'error' | 'warning';
  severity: TelemetrySeverity;
  /** Functional area, e.g. "intake", "email", "clients". Becomes part of the incident fingerprint. */
  component: string;
  /** UPPER_SNAKE_CASE. Becomes part of the incident fingerprint, so keep it stable and low-cardinality. */
  code: string;
  /** Operational description only. Never interpolate client data into it. */
  message?: string;
  context?: {
    requestId?: string;
    /** Route template ("/api/v1/clients/:id"), never a concrete path. */
    route?: string;
    method?: string;
    statusCode?: number;
    durationMs?: number;
    operation?: string;
  };
}

export interface TelemetryReporter {
  reportError(report: TelemetryReport): void;
}

export interface SupportHubTelemetryOptions {
  eventsUrl?: string;
  telemetryKey?: string;
  environment: TelemetryEnvironment;
  version?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function normalizeIdentifier(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
  return cleaned || 'unknown';
}

export function toErrorCode(value: string): string {
  const code = value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 64);
  if (!code) return 'UNKNOWN_ERROR';
  const prefixed = /^[A-Z]/.test(code) ? code : `E_${code}`.slice(0, 64);
  return ERROR_CODE_PATTERN.test(prefixed) ? prefixed : 'UNKNOWN_ERROR';
}

export class SupportHubTelemetry implements TelemetryReporter {
  private readonly logger = new Logger('SupportHubTelemetry');
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly eventsUrl?: string;
  private readonly telemetryKey?: string;
  private inFlight = 0;
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  private lastFailureLogAt = 0;
  private droppedSinceLastLog = 0;

  constructor(private readonly options: SupportHubTelemetryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    const { eventsUrl, telemetryKey } = SupportHubTelemetry.validate(options, this.logger);
    this.eventsUrl = eventsUrl;
    this.telemetryKey = telemetryKey;
  }

  /** Disabled (with one warning) unless both the URL and a well-formed key are configured. */
  private static validate(
    options: SupportHubTelemetryOptions,
    logger: Logger,
  ): { eventsUrl?: string; telemetryKey?: string } {
    const { eventsUrl, telemetryKey } = options;
    if (!eventsUrl && !telemetryKey) return {};
    if (!eventsUrl || !telemetryKey) {
      logger.warn('Support Hub telemetry is disabled: set both SUPPORT_HUB_URL and SUPPORT_HUB_TELEMETRY_KEY.');
      return {};
    }
    let url: URL;
    try {
      url = new URL(eventsUrl);
    } catch {
      logger.warn('Support Hub telemetry is disabled: SUPPORT_HUB_URL is not a valid URL.');
      return {};
    }
    if (url.protocol !== 'https:' && options.environment === 'production') {
      logger.warn('Support Hub telemetry is disabled: SUPPORT_HUB_URL must use https in production.');
      return {};
    }
    if (!KEY_PATTERN.test(telemetryKey)) {
      logger.warn('Support Hub telemetry is disabled: SUPPORT_HUB_TELEMETRY_KEY is malformed.');
      return {};
    }
    return { eventsUrl: url.toString(), telemetryKey };
  }

  get enabled(): boolean {
    return Boolean(this.eventsUrl && this.telemetryKey);
  }

  reportError(report: TelemetryReport): void {
    try {
      if (!this.enabled) return;
      const event = this.buildEvent(report);
      const fingerprint = `${event.source.component}:${event.error.code}`;
      if (!this.admit(fingerprint)) {
        this.droppedSinceLastLog++;
        return;
      }
      this.inFlight++;
      void this.send(event).finally(() => {
        this.inFlight--;
      });
    } catch (error) {
      // Building or scheduling an event must never surface to the caller.
      this.logFailure(`could not queue event: ${(error as Error).message}`);
    }
  }

  private admit(fingerprint: string): boolean {
    if (this.inFlight >= MAX_IN_FLIGHT) return false;
    const now = this.now();
    const window = this.windows.get(fingerprint);
    if (!window || now - window.startedAt >= 60_000) {
      this.windows.set(fingerprint, { startedAt: now, count: 1 });
      if (this.windows.size > 500) this.pruneWindows(now);
      return true;
    }
    if (window.count >= MAX_PER_FINGERPRINT_PER_MINUTE) return false;
    window.count++;
    return true;
  }

  private pruneWindows(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= 60_000) this.windows.delete(key);
    }
  }

  private buildEvent(report: TelemetryReport) {
    const context: Record<string, string | number> = {};
    if (report.context?.requestId) context.requestId = report.context.requestId.slice(0, 128);
    if (report.context?.route) context.route = report.context.route.split(/[?#]/, 1)[0].slice(0, 256);
    const method = report.context?.method?.toUpperCase();
    if (method && ALLOWED_METHODS.has(method)) context.method = method;
    const status = report.context?.statusCode;
    if (Number.isInteger(status) && status! >= 100 && status! <= 599) context.statusCode = status!;
    const duration = report.context?.durationMs;
    if (Number.isInteger(duration) && duration! >= 0) context.durationMs = Math.min(duration!, 3_600_000);
    if (report.context?.operation) context.operation = normalizeIdentifier(report.context.operation);

    return {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      eventId: randomUUID(),
      timestamp: new Date(this.now()).toISOString(),
      application: {
        id: APPLICATION_ID,
        environment: this.options.environment,
        ...(this.options.version ? { version: this.options.version.slice(0, 64) } : {}),
      },
      type: report.type ?? 'error',
      severity: report.severity,
      source: { service: SERVICE_NAME, component: normalizeIdentifier(report.component) },
      error: {
        code: ERROR_CODE_PATTERN.test(report.code) ? report.code : toErrorCode(report.code),
        ...(report.message ? { message: report.message.slice(0, 500) } : {}),
      },
      ...(Object.keys(context).length ? { context } : {}),
    };
  }

  private async send(event: ReturnType<SupportHubTelemetry['buildEvent']>): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(this.eventsUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.telemetryKey}` },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      // The body is never needed; release it.
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) this.logFailure(`Support Hub answered HTTP ${response.status}`);
    } catch (error) {
      this.logFailure(controller.signal.aborted ? `timed out after ${SEND_TIMEOUT_MS}ms` : (error as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  /** At most one log line per minute, so a Support Hub outage cannot flood ClientFlow's logs. */
  private logFailure(reason: string): void {
    const now = this.now();
    if (now - this.lastFailureLogAt < 60_000) return;
    this.lastFailureLogAt = now;
    const dropped = this.droppedSinceLastLog;
    this.droppedSinceLastLog = 0;
    this.logger.warn(`Support Hub telemetry send failed (${reason}); ${dropped} event(s) rate-limited since last report.`);
  }
}

export function telemetryEnvironment(env: NodeJS.ProcessEnv): TelemetryEnvironment {
  const explicit = env.SUPPORT_HUB_ENVIRONMENT;
  if (explicit === 'production' || explicit === 'staging' || explicit === 'development') return explicit;
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}

export function telemetryFromEnvironment(env: NodeJS.ProcessEnv): SupportHubTelemetry {
  const base = env.SUPPORT_HUB_URL?.trim();
  return new SupportHubTelemetry({
    eventsUrl: base ? `${base.replace(/\/+$/, '')}/api/v1/events` : undefined,
    telemetryKey: env.SUPPORT_HUB_TELEMETRY_KEY?.trim() || undefined,
    environment: telemetryEnvironment(env),
    version: env.RENDER_GIT_COMMIT?.slice(0, 12),
  });
}

let shared: SupportHubTelemetry | undefined;

/**
 * Process-wide reporter. Created on first use so it reads the environment after ConfigModule has
 * loaded .env files. Disabled in tests unless a test configures it explicitly.
 */
export function supportHubTelemetry(): TelemetryReporter {
  if (process.env.NODE_ENV === 'test') return { reportError: () => undefined };
  shared ??= telemetryFromEnvironment(process.env);
  return shared;
}
