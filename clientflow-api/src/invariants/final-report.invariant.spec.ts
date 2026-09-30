import { NotFoundException } from '@nestjs/common';
import { ScaffoldService } from '../common/services/scaffold.service';
import { ClientflowCompatibilityController } from '../modules/compatibility/compatibility.controller';
import { applyFinalReportDecision } from '../modules/lifecycle/final-report';
import { inMemoryDb } from './in-memory-db';

/** A final report's archive decision takes effect, through the enrollment state machine. */
const ORG = 'org-a';
const actor = { id: 'staff-1', name: 'Staff' };

function setup(status: string) {
  const rows = {
    cfClient: [{ id: 'c1', organizationId: ORG, isArchived: false, archivedAt: null }],
    cfProgramEnrollment: [
      { id: 'e1', organizationId: ORG, clientId: 'c1', programId: 'p1', status, isArchived: false },
      { id: 'e2', organizationId: ORG, clientId: 'c1', programId: 'p2', status: 'active', isArchived: false },
    ],
    cfEnrollmentStatusHistory: [] as Array<Record<string, unknown>>,
    cfContract: [{ id: 'k1', organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', status: 'SENT' }],
    cfFormAssignment: [] as Array<Record<string, unknown>>,
    cfEnrollmentBillingAgreement: [{ id: 'b1', organizationId: ORG, enrollmentId: 'e1', status: 'active' }],
  };
  return { rows, db: inMemoryDb(rows) as never };
}

describe('final report archive decision', () => {
  it('a completion outcome completes the enrollment and ends what was still open on it', async () => {
    const { rows, db } = setup('active');
    const outcome = await applyFinalReportDecision(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', decision: 'Program Complete', actor });
    expect(outcome).toEqual({ applied: 'completed', enrollmentId: 'e1' });
    expect(rows.cfProgramEnrollment[0].status).toBe('completed');
    expect(rows.cfProgramEnrollment[1].status).toBe('active'); // other programs untouched
    expect(rows.cfEnrollmentStatusHistory).toHaveLength(1);
    expect(rows.cfContract[0].status).toBe('CANCELLED');
    expect(rows.cfEnrollmentBillingAgreement[0].status).toBe('ended');
  });

  it('an early ending withdraws the enrollment', async () => {
    const { rows, db } = setup('on_hold');
    await applyFinalReportDecision(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', decision: 'Defaulted', actor });
    expect(rows.cfProgramEnrollment[0].status).toBe('withdrawn');
  });

  it('never forces an illegal transition (an enrollment that never started cannot be completed)', async () => {
    const { rows, db } = setup('pending_review');
    const outcome = await applyFinalReportDecision(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', decision: 'Contract Complete', actor });
    expect(outcome).toEqual({ applied: null, reason: 'transition_not_allowed' });
    expect(rows.cfProgramEnrollment[0].status).toBe('pending_review');
  });

  it('"Archived" archives the client and their enrollments', async () => {
    const { rows, db } = setup('active');
    await applyFinalReportDecision(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', decision: 'Archived', actor });
    expect(rows.cfClient[0]).toEqual(expect.objectContaining({ isArchived: true, finalStatus: 'Archived' }));
    expect(rows.cfProgramEnrollment.every((enrollment) => enrollment.isArchived)).toBe(true);
  });

  it('"Pre-Archive" only records the report', async () => {
    const { rows, db } = setup('active');
    const before = JSON.stringify(rows);
    await expect(applyFinalReportDecision(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', decision: 'Pre-Archive', actor }))
      .resolves.toEqual({ applied: null, reason: 'recorded_only' });
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('INVARIANT: final reports and terms stay inside the organization', () => {
  function controllerFor(orgId: string) {
    const rows = {
      cfClient: [{ id: 'c1', organizationId: ORG, isArchived: false, isDemo: false }],
      cfProgramEnrollment: [{ id: 'e1', organizationId: ORG, clientId: 'c1', programId: 'p1', status: 'active' }],
      cfProgram: [{ id: 'p1', organizationId: ORG }],
      cfFinalReport: [] as Array<Record<string, unknown>>,
      cfTerms: [] as Array<Record<string, unknown>>,
    };
    const controller = new ClientflowCompatibilityController(new ScaffoldService(), inMemoryDb(rows) as never);
    jest.spyOn(controller as never, 'requireOrgFromRequest').mockResolvedValue(
      { orgId, admin: { id: 'admin', email: 'a@example.com', organizationId: orgId } } as never,
    );
    return { rows, controller };
  }

  it("another organization can't file a final report or terms on this client (404, nothing written)", async () => {
    const { rows, controller } = controllerFor('org-b');
    await expect(controller.createFinalReport({} as never, 'c1', { enrollmentId: 'e1', archiveDecision: 'Archived' }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.createTerms({} as never, 'c1', { enrollmentId: 'e1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.cfFinalReport).toHaveLength(0);
    expect(rows.cfTerms).toHaveLength(0);
    expect(rows.cfClient[0].isArchived).toBe(false);
  });

  it('a report and terms filed for an enrollment record it and take its program', async () => {
    const { rows, controller } = controllerFor(ORG);
    await controller.createFinalReport({} as never, 'c1', { enrollmentId: 'e1', programId: 'ignored', archiveDecision: 'Pre-Archive' });
    await controller.createTerms({} as never, 'c1', { enrollmentId: 'e1' });
    expect(rows.cfFinalReport[0]).toEqual(expect.objectContaining({ enrollmentId: 'e1', programId: 'p1' }));
    expect(rows.cfTerms[0]).toEqual(expect.objectContaining({ enrollmentId: 'e1', programId: 'p1' }));
  });
});
