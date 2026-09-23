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
      eventType: 'form.send',
      organizationId: 'org-1',
      clientId: 'client-1',
      formId: 'form-1',
      formName: 'General Intake Form',
      formUrl: 'https://clientflow.example.com/s/token',
      recipientEmail: 'client@example.com',
      sentByUserId: 'system',
      occurredAt: new Date().toISOString(),
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not enable email or storage', () => {
    expect(() => new EmailService(disabledConfig()).assertEnabled()).toThrow(ServiceUnavailableException);
    expect(() => new StorageService(disabledConfig()).assertEnabled()).toThrow(ServiceUnavailableException);
  });

  it('sends intake with eventType form.send', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ success: true, status: 'ACCEPTED', eventId: sent.eventId, sentAt: '2030-01-01T00:00:00.000Z' }), { status: 202 });
    });
    const service = new N8nService(configuredN8n());
    const payload = {
      organizationId: 'org-1',
      clientId: 'client-1',
      formId: 'form-1',
      recipientEmail: 'client@example.com',
      clientName: 'Client Owner',
      formName: 'General Intake Form' as const,
      formUrl: 'https://clientflow.example.com/s/token',
      dueDate: '2030-01-08T00:00:00.000Z',
      sentByUserId: 'system',
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
    }));
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(sentBody).toEqual({
      ...payload,
      eventId: 'intake-assignment-1',
      eventType: 'form.send',
      formPurpose: 'general_intake',
      occurredAt: expect.any(String),
    });
    fetchMock.mockRestore();
  });

  it('sends contract with eventType contract.send (not form.send)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ success: true, status: 'ACCEPTED', eventId: sent.eventId, sentAt: '2030-01-01T00:00:00.000Z' }), { status: 202 });
    });
    const service = new N8nService(configuredN8n());
    const payload = {
      organizationId: 'org_ea_management',
      clientId: 'client_123',
      recipientEmail: 'client@example.com',
      clientName: 'Client Name',
      programName: 'Brand Awareness Subscription',
      contractName: 'Brand Awareness Service Agreement',
      contractUrl: 'https://clientflow.example.com/contracts/token',
      dueDate: '2026-09-28',
      sentByUserId: 'system',
    };

    await expect(service.sendContract('contract.send:contract-1:event-1', payload))
      .resolves.toEqual(expect.objectContaining({ status: 'sent' }));
    expect(fetchMock).toHaveBeenCalledWith('https://n8n.example.com/webhook/intake', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-clientflow-secret': 'webhook-secret',
        'Idempotency-Key': 'contract.send:contract-1:event-1',
        Authorization: 'Bearer workflow-token',
      },
    }));
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(sentBody).toEqual({
      ...payload,
      eventId: 'contract.send:contract-1:event-1',
      eventType: 'contract.send',
      occurredAt: expect.any(String),
    });
    expect(sentBody).not.toHaveProperty('formId');
    expect(sentBody).not.toHaveProperty('formName');
    expect(sentBody).not.toHaveProperty('formUrl');
    fetchMock.mockRestore();
  });

  it('sends welcome with eventType welcome.send (not form.send) and no formName/formUrl', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ success: true, status: 'ACCEPTED', eventId: sent.eventId, sentAt: '2030-01-01T00:00:00.000Z' }), { status: 202 });
    });
    const service = new N8nService(configuredN8n());
    const payload = {
      organizationId: 'org_ea_management',
      clientId: 'client_123',
      recipientEmail: 'client@example.com',
      clientName: 'Client Name',
      programName: 'The Inspired Detroit Initiative',
      nextStep: 'Your agreement has been received and your enrollment is now moving into onboarding.',
      attachmentUrl: 'https://clientflow-2g9.pages.dev/contracts%20and%20emails/IDI%20Member%20Welcome%20Guide.pdf',
      sentByUserId: 'system',
    };

    await expect(service.sendWelcome('welcome.send:contract-1', payload))
      .resolves.toEqual(expect.objectContaining({ status: 'sent' }));
    expect(fetchMock).toHaveBeenCalledWith('https://n8n.example.com/webhook/intake', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-clientflow-secret': 'webhook-secret',
        'Idempotency-Key': 'welcome.send:contract-1',
        Authorization: 'Bearer workflow-token',
      },
    }));
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(sentBody).toEqual({
      ...payload,
      eventId: 'welcome.send:contract-1',
      eventType: 'welcome.send',
      occurredAt: expect.any(String),
    });
    expect(sentBody).not.toHaveProperty('formId');
    expect(sentBody).not.toHaveProperty('formName');
    expect(sentBody).not.toHaveProperty('formUrl');
    fetchMock.mockRestore();
  });

  it('preserves the caller-supplied eventType when delivering directly', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ success: true, status: 'ACCEPTED', eventId: sent.eventId, sentAt: '2030-01-01T00:00:00.000Z' }), { status: 202 });
    });
    const service = new N8nService(configuredN8n());

    await service.deliver({
      eventId: 'welcome.send:direct-1',
      eventType: 'welcome.send',
      organizationId: 'org-1',
      clientId: 'client-1',
      recipientEmail: 'client@example.com',
      clientName: 'Client Owner',
      programName: 'The Inspired Detroit Initiative',
      nextStep: 'Welcome aboard.',
      sentByUserId: 'system',
      occurredAt: new Date().toISOString(),
    });

    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(sentBody.eventType).toBe('welcome.send');
    fetchMock.mockRestore();
  });
});
