import {
  SupportHubTelemetry,
  supportHubTelemetry,
  telemetryEnvironment,
  telemetryFromEnvironment,
  toErrorCode,
} from './support-hub-telemetry';

const KEY = `shk_0123456789ab_${'A'.repeat(43)}`;
const URL = 'https://support.example.com/api/v1/events';

function okFetch() {
  return jest.fn(async () => new Response('{}', { status: 202 })) as unknown as jest.Mock & typeof fetch;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('SupportHubTelemetry', () => {
  it('sends a contract v1 event with only whitelisted operational fields', async () => {
    const fetchImpl = okFetch();
    const telemetry = new SupportHubTelemetry({ eventsUrl: URL, telemetryKey: KEY, environment: 'production', version: 'abc123', fetchImpl });

    telemetry.reportError({
      severity: 'error',
      component: 'Intake',
      code: 'INTAKE_SUBMISSION_FAILED',
      message: 'Unable to persist intake submission',
      context: { requestId: 'req-1', route: '/api/v1/public/forms/:token?x=1', method: 'post', statusCode: 500 },
    });
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string) as unknown;
    expect(body).toEqual({
      schemaVersion: '1.0',
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      timestamp: expect.any(String),
      application: { id: 'clientflow', environment: 'production', version: 'abc123' },
      type: 'error',
      severity: 'error',
      source: { service: 'clientflow-api', component: 'intake' },
      error: { code: 'INTAKE_SUBMISSION_FAILED', message: 'Unable to persist intake submission' },
      context: { requestId: 'req-1', route: '/api/v1/public/forms/:token', method: 'POST', statusCode: 500 },
    });
  });

  it('is a silent no-op when unconfigured, partially configured or misconfigured', async () => {
    const fetchImpl = okFetch();
    const variants = [
      {},
      { eventsUrl: URL },
      { telemetryKey: KEY },
      { eventsUrl: 'not a url', telemetryKey: KEY },
      { eventsUrl: 'http://support.example.com/api/v1/events', telemetryKey: KEY },
      { eventsUrl: URL, telemetryKey: 'wrong-format' },
    ];
    for (const variant of variants) {
      const telemetry = new SupportHubTelemetry({ ...variant, environment: 'production', fetchImpl });
      expect(telemetry.enabled).toBe(false);
      telemetry.reportError({ severity: 'error', component: 'x', code: 'X_FAILED' });
    }
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws or rejects when Support Hub is unreachable', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const telemetry = new SupportHubTelemetry({ eventsUrl: URL, telemetryKey: KEY, environment: 'production', fetchImpl });
    expect(() => telemetry.reportError({ severity: 'error', component: 'x', code: 'X_FAILED' })).not.toThrow();
    await flush();
  });

  it('returns before the send completes', () => {
    let resolveSend: (value: Response) => void = () => undefined;
    const fetchImpl = jest.fn(() => new Promise<Response>((resolve) => { resolveSend = resolve; })) as unknown as typeof fetch;
    const telemetry = new SupportHubTelemetry({ eventsUrl: URL, telemetryKey: KEY, environment: 'production', fetchImpl });
    telemetry.reportError({ severity: 'error', component: 'x', code: 'X_FAILED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveSend(new Response('{}', { status: 202 }));
  });

  it('caps sends per fingerprint per minute and recovers in the next window', async () => {
    let now = Date.parse('2026-10-15T21:30:00.000Z');
    const fetchImpl = okFetch();
    const telemetry = new SupportHubTelemetry({ eventsUrl: URL, telemetryKey: KEY, environment: 'production', fetchImpl, now: () => now });
    for (let i = 0; i < 50; i++) {
      telemetry.reportError({ severity: 'error', component: 'email', code: 'EMAIL_DELIVERY_TIMEOUT' });
      await flush();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(30);

    // A different failure is not starved by the noisy one.
    telemetry.reportError({ severity: 'error', component: 'intake', code: 'INTAKE_SUBMISSION_FAILED' });
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(31);

    now += 60_000;
    telemetry.reportError({ severity: 'error', component: 'email', code: 'EMAIL_DELIVERY_TIMEOUT' });
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(32);
  });

  it('caps concurrent sends so a slow Support Hub cannot pile up requests', () => {
    const fetchImpl = jest.fn(() => new Promise<Response>(() => undefined)) as unknown as jest.Mock & typeof fetch;
    const telemetry = new SupportHubTelemetry({ eventsUrl: URL, telemetryKey: KEY, environment: 'production', fetchImpl });
    for (let i = 0; i < 25; i++) telemetry.reportError({ severity: 'error', component: `c${i}`, code: 'X_FAILED' });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });
});

describe('telemetry configuration', () => {
  it('builds the events URL and environment from process env', () => {
    const telemetry = telemetryFromEnvironment({
      NODE_ENV: 'production',
      SUPPORT_HUB_URL: 'https://support.example.com/',
      SUPPORT_HUB_TELEMETRY_KEY: KEY,
    });
    expect(telemetry.enabled).toBe(true);
    expect(telemetryEnvironment({ NODE_ENV: 'production', SUPPORT_HUB_ENVIRONMENT: 'staging' })).toBe('staging');
    expect(telemetryEnvironment({ NODE_ENV: 'development' })).toBe('development');
  });

  it('is disabled under test', () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    supportHubTelemetry().reportError({ severity: 'error', component: 'x', code: 'X_FAILED' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('normalizes arbitrary names into contract error codes', () => {
    expect(toErrorCode('UNHANDLED_RangeError')).toBe('UNHANDLED_RANGE_ERROR');
    expect(toErrorCode('EMAIL_DELIVERY_n8n_http_500')).toBe('EMAIL_DELIVERY_N8N_HTTP_500');
    expect(toErrorCode('500 oops')).toBe('E_500_OOPS');
    expect(toErrorCode('!!!')).toBe('UNKNOWN_ERROR');
  });
});
