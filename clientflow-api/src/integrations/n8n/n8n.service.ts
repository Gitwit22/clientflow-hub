import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type {
  ClientflowLifecyclePayload,
  ContractCopyEmailDeliveryResult,
  ContractCopyEmailPayload,
  ContractCopyLifecyclePayload,
  ContractEmailDeliveryResult,
  ContractEmailPayload,
  ContractSendLifecyclePayload,
  IntakeSendLifecyclePayload,
  IntakeEmailDeliveryResult,
  IntakeEmailPayload,
  N8nDeliveryReceipt,
  WelcomeEmailDeliveryResult,
  WelcomeEmailPayload,
  WelcomeSendLifecyclePayload,
} from './n8n.types';

@Injectable()
export class N8nService {
  private readonly logger = new Logger(N8nService.name);

  constructor(private readonly config: ConfigService<Environment, true>) {}

  // Both the legacy clientflow-api names and the aliases shared with nxt-lvl-api2 must be honored -
  // deliver() already resolved aliases while the send* methods below did not, so the same n8n
  // configuration could behave as "enabled" for one code path (Forms page) and "disabled" for
  // another (Add client) depending on which env var names were actually set.
  private resolveN8nConfig() {
    const enabled = this.config.get('N8N_ENABLED', { infer: true }) === 'true'
      || this.config.get('N8N_FORM_EMAIL_ENABLED', { infer: true }) === 'true'
      || this.config.get('CLIENTFLOW_N8N_FORM_EMAIL_ENABLED', { infer: true }) === 'true';
    const webhookUrl = this.config.get('N8N_EMAIL_WEBHOOK_URL', { infer: true })
      ?? this.config.get('CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL', { infer: true })
      ?? this.config.get('N8N_FORM_EMAIL_WEBHOOK_URL', { infer: true });
    const secret = this.config.get('CLIENTFLOW_N8N_SECRET', { infer: true })
      ?? this.config.get('CLIENTFLOW_N8N_CLIENTFLOW_SECRET', { infer: true })
      ?? this.config.get('N8N_CLIENTFLOW_SECRET', { infer: true });
    const rawBearerToken = this.config.get('N8N_EMAIL_BEARER_TOKEN', { infer: true })
      ?? this.config.get('CLIENTFLOW_N8N_FORM_EMAIL_BEARER_TOKEN', { infer: true })
      ?? this.config.get('N8N_FORM_EMAIL_BEARER_TOKEN', { infer: true });
    const bearerToken = rawBearerToken?.replace(/^Bearer\s+/i, '');
    const timeoutMs = this.config.get('N8N_FORM_EMAIL_TIMEOUT_MS', { infer: true })
      ?? this.config.get('N8N_TIMEOUT_MS', { infer: true });
    return { enabled, webhookUrl, secret, bearerToken, timeoutMs };
  }

  getIntakeAvailability(): 'ready' | 'disabled' | 'not_configured' {
    const { enabled, webhookUrl, secret } = this.resolveN8nConfig();
    if (!enabled) return 'disabled';
    return webhookUrl && secret ? 'ready' : 'not_configured';
  }

  /** Safe (no secrets) snapshot of which n8n env vars are resolving, for diagnosing config drift. */
  getDiagnostics() {
    const { enabled, webhookUrl, secret, bearerToken, timeoutMs } = this.resolveN8nConfig();
    const firstConfiguredName = (...keys: Array<keyof Environment>) =>
      keys.find((key) => this.config.get(key, { infer: true }) != null) ?? null;
    return {
      availability: this.getIntakeAvailability(),
      enabledFrom: this.config.get('N8N_ENABLED', { infer: true }) === 'true'
        ? 'N8N_ENABLED'
        : this.config.get('N8N_FORM_EMAIL_ENABLED', { infer: true }) === 'true'
          ? 'N8N_FORM_EMAIL_ENABLED'
          : this.config.get('CLIENTFLOW_N8N_FORM_EMAIL_ENABLED', { infer: true }) === 'true'
            ? 'CLIENTFLOW_N8N_FORM_EMAIL_ENABLED'
            : null,
      hasWebhookUrl: Boolean(webhookUrl),
      hasSecret: Boolean(secret),
      hasBearerToken: Boolean(bearerToken),
      webhookFrom: firstConfiguredName('N8N_EMAIL_WEBHOOK_URL', 'CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL', 'N8N_FORM_EMAIL_WEBHOOK_URL'),
      secretFrom: firstConfiguredName('CLIENTFLOW_N8N_SECRET', 'CLIENTFLOW_N8N_CLIENTFLOW_SECRET', 'N8N_CLIENTFLOW_SECRET'),
      bearerFrom: firstConfiguredName('N8N_EMAIL_BEARER_TOKEN', 'CLIENTFLOW_N8N_FORM_EMAIL_BEARER_TOKEN', 'N8N_FORM_EMAIL_BEARER_TOKEN'),
      webhookMatchesExpectedEndpoint: webhookUrl === 'https://nxtlvl.app.n8n.cloud/webhook/clientflow/send-form-email',
      timeoutMs,
      enabled,
    };
  }

  // Temporary intake tracing. Only names, booleans, event IDs and numeric HTTP statuses;
  // never URLs, headers, payload contents, response bodies or raw exception messages.
  private traceIntake(
    stage: string,
    payload: { eventType: string; eventId: string },
    outboundFetchStarted = false,
    outboundStatus: number | null = null,
    errorCode: string | null = null,
  ): void {
    if (payload.eventType !== 'intake.send') return;
    const diagnostics = this.getDiagnostics();
    this.logger.log(JSON.stringify({
      stage, eventType: payload.eventType, eventId: payload.eventId,
      deliveryEnabled: diagnostics.enabled,
      webhookConfigured: diagnostics.hasWebhookUrl,
      secretConfigured: diagnostics.hasSecret,
      bearerConfigured: diagnostics.hasBearerToken,
      enabledFrom: diagnostics.enabledFrom,
      webhookFrom: diagnostics.webhookFrom,
      secretFrom: diagnostics.secretFrom,
      bearerFrom: diagnostics.bearerFrom,
      webhookMatchesExpectedEndpoint: diagnostics.webhookMatchesExpectedEndpoint,
      outboundFetchStarted, outboundStatus, errorCode,
    }));
  }

  getContractAvailability(): 'ready' | 'disabled' | 'not_configured' {
    return this.getIntakeAvailability();
  }

  getWelcomeAvailability(): 'ready' | 'disabled' | 'not_configured' {
    return this.getIntakeAvailability();
  }

  getContractCopyAvailability(): 'ready' | 'disabled' | 'not_configured' {
    return this.getIntakeAvailability();
  }

  // sendIntake/sendContract/sendWelcome all delegate to deliver() for a single HTTP transport, but
  // each must supply its OWN real eventType - n8n's workflow switches on eventType and validates
  // different required fields per branch (form.send and intake.send need formName/formUrl,
  // contract.send needs contractName/contractUrl, contract.copy needs executedCopyUrl, welcome.send
  // needs clientName/programName and the resolved subject/body). Forcing every send through one
  // event type made the other payloads fail that branch's validation. Intake has its own event
  // type (intake.send) rather than form.send plus a purpose flag, which n8n does not read.
  private async sendViaDeliver<T extends ClientflowLifecyclePayload>(
    availability: 'ready' | 'disabled' | 'not_configured',
    eventId: string,
    payload: Omit<T, 'eventId' | 'occurredAt'>,
  ): Promise<
    | { status: 'sent'; sentAt: string }
    | { status: 'skipped'; reason: 'disabled' | 'not_configured' }
    | { status: 'failed'; reason: 'timeout' | 'rejected' | 'unavailable' }
  > {
    if (availability !== 'ready') {
      this.traceIntake('sendViaDeliver.skipped', { eventType: payload.eventType, eventId }, false, null, availability);
      return { status: 'skipped', reason: availability };
    }
    try {
      const receipt = await this.deliver({
        ...payload,
        eventId,
        occurredAt: new Date().toISOString(),
      } as T);
      return { status: 'sent', sentAt: receipt.sentAt };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return { status: 'failed', reason: 'timeout' };
      if (error instanceof ServiceUnavailableException && /rejected|invalid receipt/.test(error.message)) {
        return { status: 'failed', reason: 'rejected' };
      }
      return { status: 'failed', reason: 'unavailable' };
    }
  }

  async sendIntake(eventId: string, payload: IntakeEmailPayload): Promise<IntakeEmailDeliveryResult> {
    this.traceIntake('N8nService.sendIntake', { eventType: 'intake.send', eventId });
    return this.sendViaDeliver<IntakeSendLifecyclePayload>(this.getIntakeAvailability(), eventId, {
      ...payload,
      eventType: 'intake.send',
    });
  }

  async sendContract(
    eventId: string,
    payload: ContractEmailPayload,
  ): Promise<ContractEmailDeliveryResult> {
    return this.sendViaDeliver<ContractSendLifecyclePayload>(this.getContractAvailability(), eventId, {
      ...payload,
      eventType: 'contract.send',
    });
  }

  async sendWelcome(
    eventId: string,
    payload: WelcomeEmailPayload,
  ): Promise<WelcomeEmailDeliveryResult> {
    return this.sendViaDeliver<WelcomeSendLifecyclePayload>(this.getWelcomeAvailability(), eventId, {
      ...payload,
      eventType: 'welcome.send',
    });
  }

  async sendContractCopy(
    eventId: string,
    payload: ContractCopyEmailPayload,
  ): Promise<ContractCopyEmailDeliveryResult> {
    return this.sendViaDeliver<ContractCopyLifecyclePayload>(this.getContractCopyAvailability(), eventId, {
      eventType: 'contract.copy',
      organizationId: payload.organizationId,
      clientId: payload.clientId,
      sentByUserId: payload.sentByUserId,
      recipientEmail: payload.recipientEmail,
      clientName: payload.clientName,
      enrollmentId: payload.enrollmentId,
      contractId: payload.contractId,
      contractName: payload.contractName,
      programName: payload.programName,
      executedCopyUrl: payload.executedCopyUrl,
      source: payload.source,
    });
  }

  async deliver(payload: ClientflowLifecyclePayload): Promise<N8nDeliveryReceipt> {
    const { enabled, webhookUrl, secret, bearerToken, timeoutMs } = this.resolveN8nConfig();
    this.traceIntake('N8nService.deliver', payload);
    if (!enabled) {
      throw new ServiceUnavailableException('n8n delivery is disabled.');
    }
    if (!webhookUrl || !secret) throw new ServiceUnavailableException('n8n is not configured.');
    const outboundPayload = {
      ...payload,
      organizationId: this.config.get('N8N_ORGANIZATION_ID', { infer: true }) ?? payload.organizationId,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let outboundFetchStarted = false;
    let outboundStatus: number | null = null;
    try {
      outboundFetchStarted = true;
      this.traceIntake('outbound.fetch.started', payload, outboundFetchStarted);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-clientflow-secret': secret,
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
          'Idempotency-Key': payload.eventId,
        },
        body: JSON.stringify(outboundPayload),
        signal: controller.signal,
      });
      outboundStatus = response.status;
      this.traceIntake('outbound.fetch.response', payload, outboundFetchStarted, outboundStatus);
      if (!response.ok) {
        await response.text().catch(() => '');
        // A response may echo credentials: record status only, never its body.
        console.error(`[n8n.deliver] rejected eventId=${payload.eventId} status=${response.status}`);
        throw new ServiceUnavailableException('n8n rejected the event.');
      }
      const receipt = await response.json() as Partial<N8nDeliveryReceipt>;
      if (receipt.success !== true || receipt.eventId !== payload.eventId || !receipt.sentAt) {
        throw new ServiceUnavailableException('n8n returned an invalid receipt.');
      }
      this.traceIntake('outbound.receipt.accepted', payload, outboundFetchStarted, outboundStatus);
      return receipt as N8nDeliveryReceipt;
    } catch (error) {
      const cause = error instanceof Error ? error.cause : null;
      const causeCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
      const safeNetworkCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'];
      const errorCode = error instanceof Error && error.name === 'AbortError'
        ? 'timeout'
        : typeof causeCode === 'string' && safeNetworkCodes.includes(causeCode)
          ? causeCode
          : error instanceof ServiceUnavailableException ? 'rejected' : 'unavailable';
      this.traceIntake('outbound.failed', payload, outboundFetchStarted, outboundStatus, errorCode);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
