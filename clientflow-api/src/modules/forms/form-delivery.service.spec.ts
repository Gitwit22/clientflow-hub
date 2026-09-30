import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { N8nHttpError, type N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { FormDeliveryService } from './form-delivery.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

const actor = { id: 'admin-1', displayName: 'Jordan Lee' };
const client = { id: 'client-1', primaryContactName: 'Client Owner', isDemo: false };
const generalForm = { id: 'form-general', programId: null, name: 'General Form' };
const programForm = { id: 'form-p1', programId: 'program-1', name: 'Program One Form' };
const assignment = {
  id: 'assign-1',
  organizationId: 'org-1',
  clientId: 'client-1',
  enrollmentId: 'enroll-1',
  formId: 'form-p1',
  recipientEmail: 'client@example.com',
  secureLink: 'https://app.example.com/s/token',
  dueDate: '2030-01-08',
  expiresAt: null,
};

function build(overrides: Record<string, any> = {}, n8nOverrides: Record<string, any> = {}) {
  const transaction: Record<string, any> = {
    cfFormAssignment: { update: jest.fn().mockImplementation(async ({ data }) => ({ ...assignment, ...data })) },
    cfCommunication: { update: jest.fn().mockResolvedValue({}) },
    cfActivityLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: Record<string, any> = {
    cfClient: { findFirst: jest.fn().mockResolvedValue(client) },
    cfFormTemplate: { findFirst: jest.fn().mockResolvedValue(programForm) },
    cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue({ id: 'enroll-1', programId: 'program-1' }) },
    cfFormAssignment: {
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'new-assign', ...data })),
      findFirst: jest.fn().mockResolvedValue(assignment),
      update: jest.fn().mockResolvedValue({}),
    },
    cfCommunication: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    cfActivityLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(transaction)),
    ...overrides,
  };
  const n8n: Record<string, any> = {
    getIntakeAvailability: jest.fn().mockReturnValue('ready'),
    deliver: jest.fn().mockImplementation(async (payload: { eventId: string }) => ({
      success: true, status: 'SENT', eventId: payload.eventId, sentAt: '2030-01-01T00:00:05.000Z',
    })),
    ...n8nOverrides,
  };
  const service = new FormDeliveryService(prisma as unknown as PrismaService, n8n as unknown as N8nService);
  return { service, prisma, n8n, transaction };
}

describe('FormDeliveryService.createAssignment', () => {
  const body = { clientId: 'client-1', formId: 'form-p1', completionMethod: 'secure_link', recipientEmail: 'client@example.com' };

  it('requires a client and a form', async () => {
    const { service } = build();
    await expect(service.createAssignment('org-1', actor, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a client or form that is not in this organization', async () => {
    await expect(build({ cfClient: { findFirst: jest.fn().mockResolvedValue(null) } }).service
      .createAssignment('org-1', actor, body)).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ cfFormTemplate: { findFirst: jest.fn().mockResolvedValue(null) } }).service
      .createAssignment('org-1', actor, body)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stores the selected enrollment on the assignment, scoped to this client', async () => {
    const { service, prisma } = build();
    await service.createAssignment('org-1', actor, { ...body, enrollmentId: 'enroll-1' });

    expect(prisma.cfProgramEnrollment.findFirst).toHaveBeenCalledWith({
      where: { id: 'enroll-1', clientId: 'client-1', organizationId: 'org-1' },
      select: { id: true, programId: true },
    });
    expect(prisma.cfFormAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollmentId: 'enroll-1', status: 'draft', createdByUserId: 'admin-1', organizationId: 'org-1',
      }),
    });
  });

  it("rejects another client's enrollment", async () => {
    const { service, prisma } = build({ cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(service.createAssignment('org-1', actor, { ...body, enrollmentId: 'not-mine' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.cfFormAssignment.create).not.toHaveBeenCalled();
  });

  it("rejects a program form for an enrollment in a different program", async () => {
    const { service, prisma } = build({
      cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue({ id: 'enroll-2', programId: 'program-2' }) },
    });
    await expect(service.createAssignment('org-1', actor, { ...body, enrollmentId: 'enroll-2' }))
      .rejects.toThrow('This form belongs to a different program than the selected enrollment.');
    expect(prisma.cfFormAssignment.create).not.toHaveBeenCalled();
  });

  it("resolves the client's enrollment in the form's program when none is given", async () => {
    const { service, prisma } = build();
    await service.createAssignment('org-1', actor, body);
    expect(prisma.cfProgramEnrollment.findFirst).toHaveBeenCalledWith({
      where: { clientId: 'client-1', organizationId: 'org-1', programId: 'program-1' },
      select: { id: true },
    });
    expect(prisma.cfFormAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ enrollmentId: 'enroll-1' }),
    });
  });

  it('refuses a program form for a client with no enrollment in that program', async () => {
    const { service, prisma } = build({ cfProgramEnrollment: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(service.createAssignment('org-1', actor, body)).rejects.toThrow(
      "Enroll the client in this form's program before sending a program form.",
    );
    expect(prisma.cfFormAssignment.create).not.toHaveBeenCalled();
  });

  it('allows a general form with no enrollment', async () => {
    const { service, prisma } = build({ cfFormTemplate: { findFirst: jest.fn().mockResolvedValue(generalForm) } });
    await service.createAssignment('org-1', actor, { ...body, formId: 'form-general' });
    expect(prisma.cfProgramEnrollment.findFirst).not.toHaveBeenCalled();
    expect(prisma.cfFormAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ enrollmentId: null }),
    });
  });

  it('stores only the token hash and returns the working link once, in the response', async () => {
    const { service, prisma } = build();
    const created = await service.createAssignment('org-1', actor, body);
    const data = prisma.cfFormAssignment.create.mock.calls[0][0].data;
    expect(data.secureLink).toBeNull();
    expect(data.secureLinkToken).toMatch(/^[a-f0-9]{64}$/);
    expect(created.secureLink).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
    expect(created).not.toHaveProperty('secureLinkToken');
    const rawToken = (created.secureLink as string).split('/s/')[1];
    expect(createHash('sha256').update(rawToken).digest('hex')).toBe(data.secureLinkToken);
  });
});

describe('FormDeliveryService.send', () => {
  const input = { idempotencyKey: 'attempt-0001-abcd', personalMessage: ' Hello ' };

  it('records the attempt first and sends with an event id built from the communication row', async () => {
    const { service, prisma, n8n } = build();
    const result = await service.send('org-1', actor, 'assign-1', input);

    const created = prisma.cfCommunication.create.mock.calls[0][0].data;
    expect(created).toEqual(expect.objectContaining({
      type: 'form_email',
      source: 'manual_staff_action',
      idempotencyKey: 'attempt-0001-abcd',
      staffMember: 'Jordan Lee',
      createdByUserId: 'admin-1',
      formAssignmentId: 'assign-1',
      enrollmentId: 'enroll-1',
      recipientEmail: 'client@example.com',
    }));
    expect(created.eventId).toBe(`form.send:assign-1:${created.id}`);
    expect(n8n.deliver).toHaveBeenCalledWith(expect.objectContaining({
      eventId: created.eventId,
      eventType: 'form.send',
      // Each send issues a fresh link; the stored raw link (if any) is never reused.
      formUrl: expect.stringMatching(/\/s\/[A-Za-z0-9_-]{43}$/),
      personalMessage: 'Hello',
      sentByUserId: 'admin-1',
    }));
    expect(result).toEqual(expect.objectContaining({
      success: true, provider: 'N8N_GMAIL', formId: 'form-p1', sentAt: '2030-01-01T00:00:05.000Z',
    }));
  });

  it('rejects a mistyped recipient before recording or emailing anything', async () => {
    const { service, prisma, n8n } = build({
      cfFormAssignment: {
        findFirst: jest.fn().mockResolvedValue({ ...assignment, recipientEmail: 'client gmail.com' }),
        update: jest.fn(),
      },
    });
    await expect(service.send('org-1', actor, 'assign-1', input)).rejects.toThrow('is not a valid email address');
    expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
    expect(n8n.deliver).not.toHaveBeenCalled();
  });

  it("keeps the assignment's own due date", async () => {
    const { service, prisma, n8n } = build();
    await service.send('org-1', actor, 'assign-1', input);
    expect(n8n.deliver).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2030-01-08' }));
    expect(prisma.cfFormAssignment.update.mock.calls[0][0].data).not.toHaveProperty('dueDate');
  });

  it("gives an undated assignment the template's dueInDays and saves it (not 'due today')", async () => {
    jest.useFakeTimers({ now: new Date('2030-01-01T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const { service, prisma, n8n } = build({
        cfFormTemplate: { findFirst: jest.fn().mockResolvedValue({ ...programForm, dueInDays: 10 }) },
        cfFormAssignment: {
          findFirst: jest.fn().mockResolvedValue({ ...assignment, dueDate: null }),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      await service.send('org-1', actor, 'assign-1', input);
      expect(n8n.deliver).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2030-01-11' }));
      expect(prisma.cfFormAssignment.update.mock.calls[0][0].data).toEqual(expect.objectContaining({
        dueDate: '2030-01-11', dueAt: new Date('2030-01-11T15:00:00.000Z'),
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks the assignment sent and writes the SENT communication and staff activity together', async () => {
    const { service, transaction } = build();
    const result: any = await service.send('org-1', actor, 'assign-1', input);

    expect(transaction.cfFormAssignment.update).toHaveBeenCalledWith({
      where: { id: 'assign-1' },
      data: { status: 'sent', sentAt: new Date('2030-01-01T00:00:05.000Z') },
    });
    expect(transaction.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SENT', errorCode: null }),
    }));
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FORM_EMAIL_SENT', user: 'Jordan Lee', actorUserId: 'admin-1',
        source: 'manual_staff_action', enrollmentId: 'enroll-1',
      }),
    });
    expect(result.assignment.status).toBe('sent');
  });

  it('records a delivery failure (communication FAILED + activity) and still surfaces the error', async () => {
    const boom = new ServiceUnavailableException('n8n rejected the event.');
    const { service, prisma } = build({}, { deliver: jest.fn().mockRejectedValue(boom) });

    await expect(service.send('org-1', actor, 'assign-1', input)).rejects.toBe(boom);

    const created = prisma.cfCommunication.create.mock.calls[0][0].data;
    expect(prisma.cfCommunication.update).toHaveBeenLastCalledWith({
      where: { id: created.id },
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'rejected' }),
    });
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'FORM_EMAIL_FAILED', user: 'Jordan Lee' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled(); // the assignment is NOT marked sent
  });

  it("records n8n's HTTP status so staff can see why the email failed", async () => {
    const rejected = new N8nHttpError(500);
    const { service, prisma } = build({}, { deliver: jest.fn().mockRejectedValue(rejected) });
    await expect(service.send('org-1', actor, 'assign-1', input)).rejects.toThrow('n8n rejected the event (HTTP 500).');
    expect(prisma.cfCommunication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'n8n_http_500' }),
    }));
  });

  it('records a timeout distinctly', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { service, prisma } = build({}, { deliver: jest.fn().mockRejectedValue(abort) });
    await expect(service.send('org-1', actor, 'assign-1', input)).rejects.toBe(abort);
    expect(prisma.cfCommunication.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ errorCode: 'timeout' }),
    }));
  });

  it('records the blocked attempt when delivery is not configured, and never calls n8n', async () => {
    const { service, prisma, n8n } = build({}, { getIntakeAvailability: jest.fn().mockReturnValue('disabled') });

    await expect(service.send('org-1', actor, 'assign-1', input)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(n8n.deliver).not.toHaveBeenCalled();
    expect(prisma.cfCommunication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'disabled' }),
    });
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'FORM_EMAIL_FAILED' }),
    });
  });

  it('a retried request (same Idempotency-Key) returns the first result and does not email again', async () => {
    const prior = {
      id: 'comm-1', status: 'SENT', sentAt: new Date('2030-01-01T00:00:05.000Z'), errorCode: null,
      contractId: null, formAssignmentId: 'assign-1', type: 'form_email',
    };
    const { service, prisma, n8n } = build({
      cfCommunication: { findFirst: jest.fn().mockResolvedValue(prior), create: jest.fn(), update: jest.fn() },
    });

    const result: any = await service.send('org-1', actor, 'assign-1', input);

    expect(result).toEqual(expect.objectContaining({ success: true, replayed: true, sentAt: '2030-01-01T00:00:05.000Z' }));
    expect(n8n.deliver).not.toHaveBeenCalled();
    expect(prisma.cfCommunication.create).not.toHaveBeenCalled();
  });

  it('replaying a failed attempt reports the failure; replaying one still in flight is a conflict', async () => {
    const replayOf = (status: string) => build({
      cfCommunication: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'comm-1', status, sentAt: null, errorCode: 'rejected', contractId: null, formAssignmentId: 'assign-1', type: 'form_email',
        }),
        create: jest.fn(), update: jest.fn(),
      },
    }).service.send('org-1', actor, 'assign-1', input);

    await expect(replayOf('FAILED')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(replayOf('SENDING')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a deliberate resend (new key) is a new email with its own event id', async () => {
    const { service, prisma, n8n } = build();
    await service.send('org-1', actor, 'assign-1', input);
    await service.send('org-1', actor, 'assign-1', { ...input, idempotencyKey: 'attempt-0002-abcd' });

    const ids = prisma.cfCommunication.create.mock.calls.map((call: any) => call[0].data.eventId);
    expect(new Set(ids).size).toBe(2);
    expect(n8n.deliver).toHaveBeenCalledTimes(2);
  });

  it('requires a recipient email and an assignment in this organization', async () => {
    await expect(build({
      cfFormAssignment: { findFirst: jest.fn().mockResolvedValue({ ...assignment, recipientEmail: null }), update: jest.fn() },
    }).service.send('org-1', actor, 'assign-1', input)).rejects.toBeInstanceOf(BadRequestException);

    const missing = build({ cfFormAssignment: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(missing.service.send('org-1', actor, 'nope', input)).rejects.toBeInstanceOf(NotFoundException);
    expect(missing.prisma.cfFormAssignment.findFirst).toHaveBeenCalledWith({ where: { id: 'nope', organizationId: 'org-1' } });
  });
});
