import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { N8nService } from './n8n.service';

const webhookUrl = 'https://nxtlvl.app.n8n.cloud/webhook/clientflow/send-form-email';
const sentAt = '2026-10-07T09:00:01.000Z';

function service(overrides: Record<string, string | number> = {}) {
  const values: Record<string, string | number> = {
    N8N_ENABLED: 'true',
    N8N_EMAIL_WEBHOOK_URL: webhookUrl,
    CLIENTFLOW_N8N_SECRET: 'test-secret',
    N8N_EMAIL_BEARER_TOKEN: 'Bearer test-token',
    N8N_TIMEOUT_MS: 5000,
    ...overrides,
  };
  return new N8nService({ get: (key: string) => values[key] } as ConfigService<Environment, true>);
}

function sentBody(fetchMock: jest.SpiedFunction<typeof fetch>): Record<string, unknown> {
  const body = fetchMock.mock.calls[0][1]?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON string request body.');
  return JSON.parse(body) as Record<string, unknown>;
}

const common = {
  organizationId: 'org-1',
  clientId: 'member-1',
  sentByUserId: 'admin-1',
  recipientEmail: 'dana@example.com',
  clientName: 'Dana Smith',
  organizationName: 'EA Management LLC',
};

describe('staff invite and password reset emails', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends staff.invite with the sign-up link and every field n8n validates', async () => {
    const eventId = 'staff.invite:member-1:abc';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, status: 'SENT', eventId, sentAt })));
    await expect(service().sendStaffInvite(eventId, {
      ...common,
      actionUrl: 'https://app.example.com/accept-invite?token=t1',
      inviterName: 'Erica Admin',
      roleLabel: 'Reviewer',
      expiresInHours: 72,
    })).resolves.toEqual({ status: 'sent', sentAt });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: expect.objectContaining({ 'Idempotency-Key': eventId }) });
    expect(sentBody(fetchMock)).toEqual({
      eventId,
      eventType: 'staff.invite',
      occurredAt: expect.any(String),
      ...common,
      actionUrl: 'https://app.example.com/accept-invite?token=t1',
      inviterName: 'Erica Admin',
      roleLabel: 'Reviewer',
      expiresInHours: 72,
    });
  });

  it('sends staff.password_reset with the reset link and its lifetime', async () => {
    const eventId = 'staff.password_reset:member-1:abc';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, status: 'SENT', eventId, sentAt })));
    await expect(service().sendStaffPasswordReset(eventId, {
      ...common,
      actionUrl: 'https://app.example.com/reset-password?token=t2',
      requestedByName: 'Erica Admin',
      expiresInMinutes: 60,
    })).resolves.toEqual({ status: 'sent', sentAt });
    expect(sentBody(fetchMock)).toMatchObject({ eventType: 'staff.password_reset', expiresInMinutes: 60, actionUrl: 'https://app.example.com/reset-password?token=t2' });
  });

  it('reports n8n errors and a switched-off integration instead of throwing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 400 }));
    const payload = { ...common, actionUrl: 'https://x.test/accept-invite?token=t', inviterName: 'A', roleLabel: 'Admin', expiresInHours: 72 };
    await expect(service().sendStaffInvite('e1', payload)).resolves.toEqual({ status: 'failed', reason: 'n8n_http_400' });
    await expect(service({ N8N_ENABLED: 'false' }).sendStaffInvite('e2', payload)).resolves.toEqual({ status: 'skipped', reason: 'disabled' });
  });
});
