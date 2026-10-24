import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { buildRecipientList } from './program-email-recipients';
import { ProgramEmailService } from './program-email.service';

type Row = Record<string, unknown>;

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const staff = { id: 'admin-1', displayName: 'Jordan Lee' };

function client(id: string, businessName: string, email: string | null, extra: Row = {}): Row {
  return { id, organizationId: ORG, businessName, primaryContactName: `${businessName} Owner`, email, isDemo: false, isArchived: false, ...extra };
}

function enrollment(id: string, clientId: string, status = 'active', extra: Row = {}): Row {
  return { id, organizationId: ORG, programId: 'p-idi', clientId, status, isDemo: false, isArchived: false, ...extra };
}

function setup(send?: jest.Mock) {
  const rows: Record<string, Row[]> = {
    cfProgram: [
      { id: 'p-idi', organizationId: ORG, name: 'The Inspired Detroit Initiative' },
      { id: 'p-empty', organizationId: ORG, name: 'Empty Program' },
      { id: 'p-foreign', organizationId: OTHER_ORG, name: 'Theirs' },
    ],
    cfClient: [
      client('c1', 'Black Economic Exchange', 'Tamika@Example.com'),
      client('c2', 'Moonlight Minerals', 'pat@moonlight.test'),
      client('c3', 'No Email LLC', ''),
      client('c4', 'Typo Co', 'typo@gmail'),
      client('c5', 'Shared Inbox Inc', 'tamika@example.com'),
      client('c6', 'Withdrawn Bakery', 'baker@example.com'),
      client('c7', 'Demo Shop', 'demo@example.com', { isDemo: true }),
      client('c8', 'Archived Test Co', 'archived@example.com', { isArchived: true }),
      client('c9', 'Finished Program LLC', 'finished@example.com'),
      { ...client('cx', 'Their Client', 'theirs@example.com'), organizationId: OTHER_ORG },
    ],
    cfProgramEnrollment: [
      enrollment('e1', 'c1'),
      enrollment('e2', 'c2', 'onboarding'),
      enrollment('e3', 'c3'),
      enrollment('e4', 'c4'),
      enrollment('e5', 'c5'),
      enrollment('e6', 'c6', 'withdrawn'),
      enrollment('e7', 'c7', 'active', { isDemo: true }),
      enrollment('e8', 'c8', 'interested'), // the client was archived, the enrollment left open
      enrollment('e9', 'c9', 'completed', { isArchived: true }), // participation archived
      { ...enrollment('ex', 'cx'), organizationId: OTHER_ORG, programId: 'p-foreign' },
    ],
    cfProgramEmail: [],
    cfCommunication: [],
  };
  const db = inMemoryDb(rows, {
    cfProgramEmail: [['organizationId', 'idempotencyKey']],
    cfCommunication: [['eventId']],
  });
  const sendProgramEmail =
    send ?? jest.fn().mockImplementation(() => Promise.resolve({ status: 'sent', sentAt: '2026-10-22T15:00:00.000Z' }));
  const service = new ProgramEmailService(db as unknown as PrismaService, { sendProgramEmail } as unknown as N8nService);
  return { rows, service, sendProgramEmail };
}

async function sendAndWait(service: ProgramEmailService, key = 'key-00000001', programId = 'p-idi') {
  const created = await service.create(ORG, staff, programId, { subject: 'October update', body: 'Hello all,\n\nSee you Saturday.', idempotencyKey: key });
  await service.whenIdle(created.id);
  return service.get(ORG, created.id);
}

describe('program email recipients', () => {
  it('includes every enrollment whatever its status, one copy per address, and lists who is skipped and why', async () => {
    const { service } = setup();
    const preview = await service.previewRecipients(ORG, 'p-idi');

    expect(preview.recipients.map((recipient) => [recipient.businessName, recipient.email])).toEqual([
      ['Black Economic Exchange', 'tamika@example.com'],
      ['Moonlight Minerals', 'pat@moonlight.test'], // onboarding counts
      ['Withdrawn Bakery', 'baker@example.com'], // withdrawn counts too: no "active only" filter
    ]);
    // Archived clients and archived participations are left out entirely (not even listed as skipped).
    expect(JSON.stringify(preview)).not.toMatch(/Archived Test Co|Finished Program LLC/);
    expect(preview.skipped).toEqual([
      { clientId: 'c3', businessName: 'No Email LLC', email: null, reason: 'missing_email' },
      { clientId: 'c5', businessName: 'Shared Inbox Inc', email: 'tamika@example.com', reason: 'duplicate_email' },
      { clientId: 'c4', businessName: 'Typo Co', email: 'typo@gmail', reason: 'invalid_email' },
    ]);
    expect(preview).toEqual(expect.objectContaining({ recipientCount: 3, skippedCount: 3 }));
    // Demo records and other organizations never appear.
    expect(JSON.stringify(preview)).not.toMatch(/demo@example|theirs@example/);
  });

  it("never reads another organization's program", async () => {
    const { service } = setup();
    await expect(service.previewRecipients(ORG, 'p-foreign')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('counts a client enrolled twice once', () => {
    const member = { clientId: 'c1', businessName: 'A', contactName: 'Ann', email: 'a@x.test' };
    const list = buildRecipientList([{ ...member, enrollmentId: 'e1' }, { ...member, enrollmentId: 'e2' }]);
    expect(list.recipients).toHaveLength(1);
    expect(list.skipped).toEqual([]);
  });
});

describe('sending a program email', () => {
  it('records the email and every recipient, then sends each one separately in the background', async () => {
    const { service, sendProgramEmail, rows } = setup();
    const detail = await sendAndWait(service);

    expect(detail).toEqual(expect.objectContaining({
      subject: 'October update',
      sentByDisplayName: 'Jordan Lee',
      status: 'COMPLETED',
      recipientCount: 3,
      skippedCount: 3,
      counts: { pending: 0, sending: 0, accepted: 3, failed: 0 },
    }));
    expect(detail.completedAt).toBeInstanceOf(Date);
    expect(sendProgramEmail).toHaveBeenCalledTimes(3);
    const calls = sendProgramEmail.mock.calls as [string, Record<string, unknown>][];
    expect(calls.map(([, payload]) => payload.recipientEmail)).toEqual(['tamika@example.com', 'pat@moonlight.test', 'baker@example.com']);
    expect(new Set(calls.map(([eventId]) => eventId)).size).toBe(3);
    expect(calls[0][0]).toMatch(new RegExp(`^program\\.email:${detail.id}:`));
    expect(calls[0][1]).toEqual(expect.objectContaining({
      clientName: 'Black Economic Exchange Owner',
      programName: 'The Inspired Detroit Initiative',
      subject: 'October update',
      body: 'Hello all,\n\nSee you Saturday.',
      organizationId: ORG,
    }));
    // Each recipient is a communication on the client's record.
    const communications = rows.cfCommunication.filter((row) => row.programEmailId === detail.id);
    expect(communications.map((row) => [row.clientId, row.type, row.status])).toEqual([
      ['c1', 'program_email', 'SENT'],
      ['c2', 'program_email', 'SENT'],
      ['c6', 'program_email', 'SENT'],
    ]);
    expect(detail.recipients.every((recipient) => recipient.outcome === 'accepted' && recipient.acceptedAt)).toBe(true);
  });

  it('returns the same email for a repeated request (double-click or network retry) and sends once', async () => {
    const { service, sendProgramEmail, rows } = setup();
    const first = await service.create(ORG, staff, 'p-idi', { subject: 'S', body: 'B', idempotencyKey: 'same-key-1' });
    const again = await service.create(ORG, staff, 'p-idi', { subject: 'S', body: 'B', idempotencyKey: 'same-key-1' });
    await service.whenIdle(first.id);

    expect(again.id).toBe(first.id);
    expect(rows.cfProgramEmail).toHaveLength(1);
    expect(rows.cfCommunication).toHaveLength(3);
    expect(sendProgramEmail).toHaveBeenCalledTimes(3);
  });

  it('sends only to the chosen members, even one who shares an address with someone left out', async () => {
    const { service, sendProgramEmail, rows } = setup();
    const created = await service.create(ORG, staff, 'p-idi', {
      subject: 'Just you two',
      body: 'Hi',
      clientIds: ['c2', 'c5', 'c3'],
      idempotencyKey: 'chosen-key-1',
    });
    await service.whenIdle(created.id);

    expect(created.recipientCount).toBe(2);
    expect(rows.cfCommunication.map((row) => [row.clientId, row.recipientEmail])).toEqual([
      ['c2', 'pat@moonlight.test'],
      ['c5', 'tamika@example.com'], // c1 has the same address but wasn't chosen
    ]);
    expect(created.skipped).toEqual([{ clientId: 'c3', businessName: 'No Email LLC', email: null, reason: 'missing_email' }]);
    expect(sendProgramEmail).toHaveBeenCalledTimes(2);
  });

  it('refuses a choice with nobody in it, a member from outside the program, or nobody reachable', async () => {
    const { service, rows } = setup();
    const send = (clientIds: unknown, key: string) => service.create(ORG, staff, 'p-idi', { subject: 'S', body: 'B', clientIds, idempotencyKey: key });
    await expect(send([], 'pick-0000001')).rejects.toThrow(/at least one member/);
    await expect(send(['c1', 'cx'], 'pick-0000002')).rejects.toThrow(/not in this program/);
    await expect(send(['c1', 7], 'pick-0000003')).rejects.toThrow(/list of client ids/);
    await expect(send(['c3', 'c4'], 'pick-0000004')).rejects.toThrow('None of the chosen members has a usable email address.');
    await expect(send(['c8'], 'pick-0000005')).rejects.toThrow(/not in this program/); // archived
    expect(rows.cfProgramEmail).toHaveLength(0);
    expect(rows.cfCommunication).toHaveLength(0);
  });

  it('previews the whole email a member would get, without recording or sending anything', async () => {
    const { rows, sendProgramEmail } = setup();
    // The real formatter and layout, with the mocked delivery; no logo is set up, so the text header shows.
    const { N8nService: RealN8n } = jest.requireActual<typeof import('../../integrations/n8n/n8n.service')>('../../integrations/n8n/n8n.service');
    const n8n = Object.assign(Object.create(RealN8n.prototype) as N8nService, { sendProgramEmail });
    const service = new ProgramEmailService(inMemoryDb(rows) as unknown as PrismaService, n8n);
    const preview = await service.preview(ORG, 'p-idi', { subject: ' Grant day ', body: 'Hi **all**\n- bring ID' });

    expect(preview).toEqual(expect.objectContaining({ programName: 'The Inspired Detroit Initiative', fromName: 'EA Management LLC', subject: 'Grant day' }));
    expect(preview.html).toContain('EA MANAGEMENT');
    expect(preview.html).toContain('<strong>all</strong>');
    expect(preview.html).toContain('<li style="margin:0 0 4px 0;">bring ID</li>');
    expect(preview.html).toContain('Thank you,<br/>EA Management LLC');
    expect(preview.text).toBe('Hi all\n• bring ID');
    expect(rows.cfProgramEmail).toHaveLength(0);
    expect(rows.cfCommunication).toHaveLength(0);
    expect(sendProgramEmail).not.toHaveBeenCalled();
    await expect(service.preview(ORG, 'p-idi', { subject: '', body: 'x' })).rejects.toThrow('Enter a subject.');
    await expect(service.preview(ORG, 'p-foreign', { subject: 'S', body: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires a key, a subject, a message and someone to send to', async () => {
    const { service } = setup();
    await expect(service.create(ORG, staff, 'p-idi', { subject: 'S', body: 'B', idempotencyKey: null })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(ORG, staff, 'p-idi', { subject: ' ', body: 'B', idempotencyKey: 'k-0000001' })).rejects.toThrow('Enter a subject.');
    await expect(service.create(ORG, staff, 'p-idi', { subject: 'S', body: '', idempotencyKey: 'k-0000002' })).rejects.toThrow('Enter a message.');
    await expect(service.create(ORG, staff, 'p-empty', { subject: 'S', body: 'B', idempotencyKey: 'k-0000003' })).rejects.toThrow(/usable email/);
    await expect(service.create(ORG, staff, 'p-foreign', { subject: 'S', body: 'B', idempotencyKey: 'k-0000004' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records a failure per recipient, and a retry sends only to the ones that failed', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ status: 'sent', sentAt: '2026-10-22T15:00:00.000Z' })
      .mockResolvedValueOnce({ status: 'failed', reason: 'n8n_http_502' })
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue({ status: 'sent', sentAt: '2026-10-22T15:05:00.000Z' });
    const { service } = setup(send);
    const partial = await sendAndWait(service);

    expect(partial.counts).toEqual({ pending: 0, sending: 0, accepted: 1, failed: 2 });
    expect(partial.status).toBe('COMPLETED');
    expect(partial.recipients.map((recipient) => [recipient.email, recipient.outcome, recipient.errorCode])).toEqual([
      ['tamika@example.com', 'accepted', null],
      ['pat@moonlight.test', 'failed', 'n8n_http_502'],
      ['baker@example.com', 'failed', 'unavailable'],
    ]);

    const firstEventIds = (send.mock.calls as [string, Record<string, unknown>][]).map(([eventId]) => eventId);
    await service.retryFailed(ORG, partial.id);
    await service.whenIdle(partial.id);
    const retried = await service.get(ORG, partial.id);

    expect(send).toHaveBeenCalledTimes(5);
    const retryCalls = (send.mock.calls as [string, Record<string, unknown>][]).slice(3);
    expect(retryCalls.map(([, payload]) => payload.recipientEmail)).toEqual(['pat@moonlight.test', 'baker@example.com']);
    // Same event ids as the first attempt, so n8n can recognize a copy it already sent.
    expect(retryCalls.map(([eventId]) => eventId)).toEqual(firstEventIds.slice(1));
    expect(retried.counts).toEqual({ pending: 0, sending: 0, accepted: 3, failed: 0 });

    // Nothing left to retry: another retry sends nothing.
    await service.retryFailed(ORG, partial.id);
    await service.whenIdle(partial.id);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('picks up an email cut off by a server restart without resending accepted recipients', async () => {
    const { service, rows, sendProgramEmail } = setup();
    const created = await sendAndWait(service);
    sendProgramEmail.mockClear();
    // Simulate a crash: one recipient mid-send, one never started, the email still sending.
    const communications = rows.cfCommunication.filter((row) => row.programEmailId === created.id);
    communications[1].status = 'SENDING';
    communications[2].status = 'REQUESTED';
    rows.cfProgramEmail[0].status = 'SENDING';

    await service.resumeUnfinished();
    await service.whenIdle(created.id);

    expect((sendProgramEmail.mock.calls as [string, Record<string, unknown>][]).map(([, payload]) => payload.recipientEmail))
      .toEqual(['pat@moonlight.test', 'baker@example.com']);
    expect((await service.get(ORG, created.id)).status).toBe('COMPLETED');
  });

  it("lists the program's emails with counts, and keeps other organizations out", async () => {
    const { service } = setup();
    const sent = await sendAndWait(service);
    const history = await service.list(ORG, 'p-idi');
    expect(history).toEqual([expect.objectContaining({ id: sent.id, subject: 'October update', counts: { pending: 0, sending: 0, accepted: 3, failed: 0 } })]);

    await expect(service.get(OTHER_ORG, sent.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.retryFailed(OTHER_ORG, sent.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list(OTHER_ORG, 'p-idi')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records every recipient as failed (to retry later) when email delivery is not set up', async () => {
    const { rows } = setup();
    const db = inMemoryDb(rows, { cfProgramEmail: [['organizationId', 'idempotencyKey']] });
    const service = new ProgramEmailService(db as unknown as PrismaService);
    const created = await service.create(ORG, staff, 'p-idi', { subject: 'S', body: 'B', idempotencyKey: 'k-00000099' });
    await service.whenIdle(created.id);
    const detail = await service.get(ORG, created.id);
    expect(detail.counts.failed).toBe(3);
    expect(detail.recipients[0].errorCode).toBe('not_configured');
  });
});
