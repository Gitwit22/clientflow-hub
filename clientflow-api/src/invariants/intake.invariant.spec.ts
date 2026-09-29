import { BadRequestException, ConflictException, GoneException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProgramAutomationService } from '../modules/automation/program-automation.service';
import { EnrollmentsService } from '../modules/enrollments/enrollments.service';
import { hashPublicToken } from '../modules/forms/intake-lifecycle';
import { IntakeWorkflowService } from '../modules/forms/intake-workflow.service';
import { inMemoryDb } from './in-memory-db';

/**
 * INVARIANT 4: retrying one intake submission never creates more enrollments, submissions or
 * staff notifications, and a refused submission changes nothing.
 */
const ORG = 'org-a';
const token = 'T'.repeat(43);

function setup(assignmentOverrides: Record<string, unknown> = {}) {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    cfFormAssignment: [{
      id: 'fa-1', organizationId: ORG, clientId: 'client-1', formId: 'form-1', status: 'sent',
      secureLinkToken: hashPublicToken(token), submittedAt: null, cancelledAt: null, expiresAt: null,
      recipientEmail: 'pat@example.com', deliveryMethod: 'email', ...assignmentOverrides,
    }],
    cfClient: [{
      id: 'client-1', organizationId: ORG, isArchived: false, primaryContactName: 'Pat', assignedUserId: null,
      assignedStaff: 'Unassigned', isDemo: false, intake: { referralSource: 'event' }, status: 'INTAKE_SENT',
    }],
    cfFormTemplate: [{ id: 'form-1', organizationId: ORG, isActive: true }],
    cfProgram: [
      { id: 'p-grant', organizationId: ORG, name: 'Grant', isActive: true },
      { id: 'p-coach', organizationId: ORG, name: 'Coaching', isActive: true },
      { id: 'p-retired', organizationId: ORG, name: 'Old', isActive: false },
      { id: 'p-foreign', organizationId: 'org-b', name: 'Theirs', isActive: true },
    ],
    // Already enrolled in coaching: selecting it again must reuse this enrollment.
    cfProgramEnrollment: [{ id: 'enr-coach', organizationId: ORG, clientId: 'client-1', programId: 'p-coach', status: 'active' }],
    cfEnrollmentStatusHistory: [],
    cfIntakeSubmission: [],
    cfIntakeSubmissionSnapshot: [],
    cfIntakeSubmissionProgram: [],
    cfActivityLog: [],
    adminUser: [{ id: 'admin-1', organizationId: ORG, isActive: true, role: 'org_admin' }],
    cfNotification: [],
  };
  const db = inMemoryDb(rows) as unknown as PrismaService;
  const automation = { runTrigger: jest.fn<Promise<unknown>, [{ trigger: string; programIds: string[]; idempotencySeed: string }]>().mockResolvedValue({ ran: true }) };
  const service = new IntakeWorkflowService(db, new EnrollmentsService(db), automation as unknown as ProgramAutomationService);
  const counts = () => Object.fromEntries(Object.entries(rows).map(([table, list]) => [table, list.length]));
  return { rows, service, automation, counts };
}

const input = {
  coreResponses: { contactName: 'Pat', email: 'pat@example.com' },
  programResponses: { 'p-grant': { amount: '5000' } },
  selectedProgramIds: ['p-grant', 'p-coach'],
  idempotencyKey: 'attempt-1',
};

describe('INVARIANT: a retried intake submission creates nothing new', () => {
  it('records the submission once: form, enrollments, history, answers, client', async () => {
    const { rows, service, automation } = setup();
    const result = await service.submit(token, input);

    expect(rows.cfFormAssignment[0]).toEqual(expect.objectContaining({
      status: 'submitted', responses: input.coreResponses, // flat, so "Apply to profile" can read it
    }));
    expect(rows.cfIntakeSubmission).toHaveLength(1);
    expect(rows.cfProgramEnrollment.map((e) => e.programId).sort()).toEqual(['p-coach', 'p-grant']);
    const grant = rows.cfProgramEnrollment.find((e) => e.programId === 'p-grant');
    expect(rows.cfEnrollmentStatusHistory).toEqual([expect.objectContaining({ enrollmentId: grant?.id, newStatus: 'interested' })]);
    expect(result.enrollmentIds).toEqual([grant?.id, 'enr-coach']);
    expect(rows.cfIntakeSubmissionProgram).toEqual(expect.arrayContaining([
      expect.objectContaining({ programId: 'p-grant', responsePayload: { amount: '5000' } }),
    ]));
    expect(rows.cfClient[0]).toEqual(expect.objectContaining({
      status: 'PROGRAM_SELECTED', programId: 'p-grant', intake: { referralSource: 'event', programOfInterest: 'Grant' },
    }));
    expect(rows.cfNotification).toHaveLength(1);
    // Automation after commit: intake rules for both programs, "enrollment created" only for the
    // enrollment this submission created (coaching already existed).
    const triggers = automation.runTrigger.mock.calls.map(([request]: [{ trigger: string; programIds: string[]; idempotencySeed: string }]) => request);
    expect(triggers).toEqual([
      expect.objectContaining({ trigger: 'intake.submitted', programIds: ['p-grant', 'p-coach'], idempotencySeed: `intake.submitted:${result.submissionId}` }),
      expect.objectContaining({ trigger: 'enrollment.created', programIds: ['p-grant'], idempotencySeed: `enrollment.created:${result.submissionId}` }),
    ]);
  });

  it.each([
    ['the same request again', input],
    ['the same key with a changed body', { ...input, coreResponses: { contactName: 'Pat R.' } }],
  ])('replays %s without writing anything', async (_label, retry) => {
    const { service, automation, counts } = setup();
    const first = await service.submit(token, input);
    const before = counts();

    const again = await service.submit(token, retry);

    expect(again).toEqual(expect.objectContaining({
      submissionId: first.submissionId, enrollmentIds: first.enrollmentIds, replayed: true,
    }));
    expect(counts()).toEqual(before);
    expect(automation.runTrigger).toHaveBeenCalledTimes(2); // only the first submission's triggers
  });

  it('refuses a different submission on an already-submitted form', async () => {
    const { service, counts } = setup();
    await service.submit(token, input);
    const before = counts();
    await expect(service.submit(token, { coreResponses: { contactName: 'Someone else' }, idempotencyKey: 'attempt-2' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(counts()).toEqual(before);
  });

  it('lets only one of two simultaneous submissions through', async () => {
    const { rows, service } = setup();
    const outcomes = await Promise.allSettled([
      service.submit(token, input),
      service.submit(token, { ...input, idempotencyKey: 'attempt-2', coreResponses: { contactName: 'Other tab' } }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(rows.cfIntakeSubmission).toHaveLength(1);
    expect(rows.cfProgramEnrollment).toHaveLength(2);
  });

  it.each([
    ['an inactive program', ['p-retired']],
    ["another organization's program", ['p-foreign']],
    ['a made-up program id', ['nope']],
  ])('refuses %s before writing anything', async (_label, selectedProgramIds) => {
    const { rows, service, counts } = setup();
    const before = counts();
    await expect(service.submit(token, { ...input, selectedProgramIds })).rejects.toBeInstanceOf(BadRequestException);
    expect(counts()).toEqual(before);
    expect(rows.cfFormAssignment[0].status).toBe('sent');
  });

  it('refuses a cancelled link and changes nothing', async () => {
    const { rows, service, counts } = setup({ status: 'cancelled', cancelledAt: new Date() });
    const before = counts();
    await expect(service.submit(token, input)).rejects.toBeInstanceOf(GoneException);
    expect(counts()).toEqual(before);
    expect(rows.cfFormAssignment[0].status).toBe('cancelled');
  });
});
