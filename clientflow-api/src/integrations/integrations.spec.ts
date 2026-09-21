import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env';
import { EmailService } from './email/email.service';
import { N8nService } from './n8n/n8n.service';
import { StorageService } from './storage/storage.service';

function disabledConfig(): ConfigService<Environment, true> {
  return { get: jest.fn().mockReturnValue('false') } as unknown as ConfigService<Environment, true>;
}

function configuredN8n(): ConfigService<Environment, true> {
  const values: Record<string, string | number> = {
    N8N_ENABLED: 'true',
    N8N_EMAIL_WEBHOOK_URL: 'https://n8n.example.com/webhook/intake',
    CLIENTFLOW_N8N_SECRET: 'webhook-secret',
    N8N_EMAIL_BEARER_TOKEN: 'Bearer workflow-token',
    N8N_TIMEOUT_MS: 5000,
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService<Environment, true>;
}

describe('disabled integrations', () => {
  it('does not send n8n events', async () => {
    const service = new N8nService(disabledConfig());
    await expect(service.deliver({
      eventId: 'event-1',
      eventType: 'intake.send',
      organizationId: 'org-1',
      clientId: 'client-1',
      occurredAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not enable email or storage', () => {
    expect(() => new EmailService(disabledConfig()).assertEnabled()).toThrow(ServiceUnavailableException);
    expect(() => new StorageService(disabledConfig()).assertEnabled()).toThrow(ServiceUnavailableException);
  });

  it('sends the intake payload with secret, bearer, and idempotency headers', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    const service = new N8nService(configuredN8n());
    const payload = {
      eventType: 'intake.send' as const,
      organizationId: 'org-1',
      clientId: 'client-1',
      recipientEmail: 'client@example.com',
      clientName: 'Client Owner',
      formName: 'General Intake Form' as const,
      formUrl: 'https://clientflow.example.com/s/token',
      dueDate: '2030-01-08T00:00:00.000Z',
    };

    await expect(service.sendIntake('intake-assignment-1', payload))
      .resolves.toEqual(expect.objectContaining({ status: 'sent' }));
    expect(fetchMock).toHaveBeenCalledWith('https://n8n.example.com/webhook/intake', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-clientflow-secret': 'webhook-secret',
        'Idempotency-Key': 'intake-assignment-1',
        Authorization: 'Bearer workflow-token',
      },
      body: JSON.stringify(payload),
    }));
    fetchMock.mockRestore();
  });
});
