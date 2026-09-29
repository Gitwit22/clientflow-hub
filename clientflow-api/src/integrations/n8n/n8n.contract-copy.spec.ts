import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { N8nService } from './n8n.service';
import type { ContractCopyEmailPayload } from './n8n.types';

const webhookUrl = 'https://nxtlvl.app.n8n.cloud/webhook/clientflow/send-form-email';
const eventId = 'contract.copy:contract-1:attempt-1';
const sentAt = '2026-09-28T13:00:01.000Z';
const payload: ContractCopyEmailPayload = {
  organizationId: 'org-1',
  clientId: 'client-1',
  sentByUserId: 'system',
  recipientEmail: 'client@example.com',
  clientName: 'Client Name',
  enrollmentId: 'enrollment-1',
  contractId: 'contract-1',
  contractName: 'Membership Agreement',
  programName: 'The Inspired Detroit Initiative',
  executedCopyUrl: 'https://storage.example.com/contract-executed.txt?signature=download',
  source: 'automation',
};
const receipt = {
  success: true, status: 'SENT', eventId, clientId: payload.clientId,
  recipientEmail: payload.recipientEmail, sentAt,
};

function service() {
  const values: Record<string, string | number> = {
    N8N_ENABLED: 'true',
    N8N_EMAIL_WEBHOOK_URL: webhookUrl,
    CLIENTFLOW_N8N_SECRET: 'test-secret',
    N8N_EMAIL_BEARER_TOKEN: 'Bearer test-token',
    N8N_TIMEOUT_MS: 5000,
  };
  return new N8nService({ get: (key: string) => values[key] } as ConfigService<Environment, true>);
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON string request body.');
  return init.body;
}

describe('frozen contract.copy outbound contract (2026-09-28)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['automation', 'manual_staff_action'] as const)(
    'POSTs the exact baseline payload with source %s and the existing authentication headers',
    async (source) => {
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(receipt)));
      await expect(service().sendContractCopy(eventId, { ...payload, source }))
        .resolves.toEqual({ status: 'sent', sentAt });

      expect(fetchMock).toHaveBeenCalledWith(webhookUrl, expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-clientflow-secret': 'test-secret',
          Authorization: 'Bearer test-token',
          'Idempotency-Key': eventId,
        },
      }));
      // Exact equality freezes the wire fields, including all eight common n8n-required fields.
      const body: unknown = JSON.parse(requestBody(fetchMock.mock.calls[0][1]));
      expect(body).toEqual({
        eventId,
        eventType: 'contract.copy',
        occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        organizationId: 'org-1',
        clientId: 'client-1',
        sentByUserId: 'system',
        recipientEmail: 'client@example.com',
        clientName: 'Client Name',
        enrollmentId: 'enrollment-1',
        contractId: 'contract-1',
        contractName: 'Membership Agreement',
        programName: 'The Inspired Detroit Initiative',
        executedCopyUrl: 'https://storage.example.com/contract-executed.txt?signature=download',
        source,
      });
    },
  );

  it('never forwards signing links, tokens, attachments, or legacy fields from a caller', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(receipt)));
    const legacyPayload = {
      ...payload,
      contractUrl: 'https://clientflow.example.com/contracts/private-token',
      signingUrl: 'https://clientflow.example.com/contracts/private-token',
      formUrl: 'https://clientflow.example.com/s/private-token',
      publicSigningToken: 'private-token',
      attachmentUrl: 'https://storage.example.com/attachment',
      expiresAt: '2026-10-05T13:00:00.000Z',
    };
    await service().sendContractCopy(eventId, legacyPayload);
    const body = requestBody(fetchMock.mock.calls[0][1]);
    expect(body).not.toMatch(/contractUrl|signingUrl|formUrl|private-token|attachmentUrl|expiresAt/);
    expect(JSON.parse(body)).toHaveProperty('executedCopyUrl', payload.executedCopyUrl);
  });

  it.each([
    // An HTTP error keeps its status so staff can see why (n8n down, plan ended, auth mismatch).
    [400, { success: false, error: 'Invalid request' }, 'n8n_http_400'],
    [502, { success: false, status: 'FAILED' }, 'n8n_http_502'],
    [500, receipt, 'n8n_http_500'],
    [200, { ...receipt, success: false }, 'rejected'],
    [200, { ...receipt, eventId: 'another-attempt' }, 'rejected'],
    [200, { ...receipt, sentAt: undefined }, 'rejected'],
  ])('records HTTP %s or an unsuccessful/invalid receipt as a failed delivery', async (status, response, reason) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status }));
    await expect(service().sendContractCopy(eventId, payload))
      .resolves.toEqual({ status: 'failed', reason });
  });

  it('preserves eventId and Idempotency-Key on a transport retry of the same attempt', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify(receipt)));
    const n8n = service();
    await expect(n8n.sendContractCopy(eventId, payload)).resolves.toEqual({ status: 'failed', reason: 'unavailable' });
    await expect(n8n.sendContractCopy(eventId, payload)).resolves.toEqual({ status: 'sent', sentAt });
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(requestBody(init))).toHaveProperty('eventId', eventId);
      expect(init?.headers).toHaveProperty('Idempotency-Key', eventId);
    }
  });
});
