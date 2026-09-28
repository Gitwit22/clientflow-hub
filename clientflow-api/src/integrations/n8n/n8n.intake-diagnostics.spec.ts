import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { N8nService } from './n8n.service';

describe('temporary intake diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports the selected config names and fetch status without exposing credentials or response bodies', async () => {
    const values: Record<string, string | number> = {
      N8N_FORM_EMAIL_ENABLED: 'true',
      CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL: 'https://nxtlvl.app.n8n.cloud/webhook/clientflow/send-form-email',
      N8N_FORM_EMAIL_WEBHOOK_URL: 'https://unused.example.com',
      CLIENTFLOW_N8N_CLIENTFLOW_SECRET: 'private-shared-secret',
      N8N_CLIENTFLOW_SECRET: 'unused-secret',
      N8N_FORM_EMAIL_BEARER_TOKEN: 'private-bearer-token',
      N8N_TIMEOUT_MS: 15000,
    };
    const service = new N8nService({ get: (key: string) => values[key] } as ConfigService<Environment, true>);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('private-response-body', { status: 401 }));

    await expect(service.sendIntake('intake-assignment-1', {
      organizationId: 'org-1', clientId: 'client-1', formId: 'form-1',
      recipientEmail: 'private@example.com', clientName: 'Private Client', formName: 'General Intake Form',
      formUrl: 'https://app.example.com/s/private-form-token', dueDate: '2030-01-01T00:00:00.000Z', sentByUserId: 'system',
    })).resolves.toEqual({ status: 'failed', reason: 'rejected' });

    const entries = log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'N8nService.sendIntake', outboundFetchStarted: false }),
      expect.objectContaining({ stage: 'N8nService.deliver', outboundFetchStarted: false }),
      expect.objectContaining({ stage: 'outbound.fetch.started', outboundFetchStarted: true }),
      expect.objectContaining({
        stage: 'outbound.fetch.response', outboundStatus: 401,
        deliveryEnabled: true, webhookConfigured: true, secretConfigured: true, bearerConfigured: true,
        webhookFrom: 'CLIENTFLOW_N8N_FORM_EMAIL_WEBHOOK_URL', secretFrom: 'CLIENTFLOW_N8N_CLIENTFLOW_SECRET',
        bearerFrom: 'N8N_FORM_EMAIL_BEARER_TOKEN', webhookMatchesExpectedEndpoint: true,
      }),
    ]));
    const output = JSON.stringify([...log.mock.calls, ...errorLog.mock.calls]);
    expect(output).not.toMatch(/private-|private@example|Private Client|https:\/\//);
  });

  it('reports an early skip without attempting fetch', async () => {
    const values: Record<string, string | number> = { N8N_ENABLED: 'false', N8N_TIMEOUT_MS: 15000 };
    const service = new N8nService({ get: (key: string) => values[key] } as ConfigService<Environment, true>);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(service.sendIntake('intake-assignment-1', {
      organizationId: 'org-1', clientId: 'client-1', formId: 'form-1', recipientEmail: 'client@example.com',
      clientName: 'Client', formName: 'General Intake Form', formUrl: 'https://app.example.com/s/token',
      dueDate: '2030-01-01T00:00:00.000Z', sentByUserId: 'system',
    })).resolves.toEqual({ status: 'skipped', reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toContainEqual(expect.objectContaining({
      stage: 'sendViaDeliver.skipped', outboundFetchStarted: false, deliveryEnabled: false, errorCode: 'disabled',
    }));
  });
});
