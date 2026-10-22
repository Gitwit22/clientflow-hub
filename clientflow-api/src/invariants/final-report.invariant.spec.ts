import { NotFoundException } from '@nestjs/common';
import { ScaffoldService } from '../common/services/scaffold.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ClientflowCompatibilityController } from '../modules/compatibility/compatibility.controller';
import { ProgramDeliverablesService } from '../modules/deliverables/program-deliverables.service';
import { FinalReportsService } from '../modules/final-reports/final-reports.service';
import { archiveProgramParticipation } from '../modules/lifecycle/final-report';
import { inMemoryDb } from './in-memory-db';

/** Finalizing a final report archives the client's participation in that one program only. */
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
    cfEnrollmentBillingAgreement: [
      { id: 'b1', organizationId: ORG, enrollmentId: 'e1', status: 'active' },
      { id: 'b2', organizationId: ORG, enrollmentId: 'e2', status: 'active' },
    ],
  };
  return { rows, db: inMemoryDb(rows) as never };
}

describe('archiving program participation', () => {
  it('a finishing outcome closes and archives only that enrollment; the client and other programs stay active', async () => {
    const { rows, db } = setup('active');
    const result = await archiveProgramParticipation(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', outcome: 'Program Complete', actor });
    expect(result).toEqual({ enrollmentId: 'e1', previousStatus: 'active', status: 'completed' });
    expect(rows.cfProgramEnrollment[0]).toEqual(expect.objectContaining({ status: 'completed', isArchived: true }));
    expect(rows.cfProgramEnrollment[1]).toEqual(expect.objectContaining({ status: 'active', isArchived: false }));
    expect(rows.cfClient[0].isArchived).toBe(false);
    expect(rows.cfEnrollmentStatusHistory).toHaveLength(1);
    expect(rows.cfContract[0].status).toBe('CANCELLED');
    expect(rows.cfEnrollmentBillingAgreement.map((agreement) => agreement.status)).toEqual(['ended', 'active']);
  });

  it('an early ending closes it as withdrawn', async () => {
    const { rows, db } = setup('on_hold');
    await archiveProgramParticipation(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', outcome: 'Defaulted', actor });
    expect(rows.cfProgramEnrollment[0]).toEqual(expect.objectContaining({ status: 'withdrawn', isArchived: true }));
  });

  it('an enrollment that never became active still ends (withdrawn), never forced to "completed"', async () => {
    const { rows, db } = setup('pending_review');
    const result = await archiveProgramParticipation(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', outcome: 'Contract Complete', actor });
    expect(result.status).toBe('withdrawn');
    expect(rows.cfEnrollmentBillingAgreement[0].status).toBe('ended');
  });

  it('an enrollment already closed keeps its status and is archived', async () => {
    const { rows, db } = setup('completed');
    await archiveProgramParticipation(db, { organizationId: ORG, clientId: 'c1', enrollmentId: 'e1', outcome: 'Closed Early', actor });
    expect(rows.cfProgramEnrollment[0]).toEqual(expect.objectContaining({ status: 'completed', isArchived: true }));
    expect(rows.cfEnrollmentStatusHistory).toHaveLength(0);
  });
});

describe('INVARIANT: final reports and terms stay inside the organization', () => {
  function controllerFor(orgId: string) {
    const rows = {
      cfClient: [{ id: 'c1', organizationId: ORG, isArchived: false, isDemo: false, intake: {}, businessName: 'B', primaryContactName: 'P' }],
      cfProgramEnrollment: [{ id: 'e1', organizationId: ORG, clientId: 'c1', programId: 'p1', status: 'active', isArchived: false }],
      cfProgram: [{ id: 'p1', organizationId: ORG }],
      cfFinalReport: [] as Array<Record<string, unknown>>,
      cfTerms: [] as Array<Record<string, unknown>>,
    };
    const db = inMemoryDb({ ...rows, organization: [{ id: ORG, settings: {} }] }) as unknown as PrismaService;
    const reports = new FinalReportsService(db, new ProgramDeliverablesService(db));
    const controller = new ClientflowCompatibilityController(
      new ScaffoldService(), db, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reports,
    );
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

  it('a report and terms filed for an enrollment record it and take its program; a report is only a draft', async () => {
    const { rows, controller } = controllerFor(ORG);
    await controller.createFinalReport({} as never, 'c1', { enrollmentId: 'e1', programId: 'ignored', archiveDecision: 'Archived' });
    await controller.createTerms({} as never, 'c1', { enrollmentId: 'e1' });
    expect(rows.cfFinalReport[0]).toEqual(expect.objectContaining({ enrollmentId: 'e1', programId: 'p1', status: 'DRAFT', archiveDecision: '' }));
    // Saving never archives anything, whatever the request asks for.
    expect(rows.cfClient[0].isArchived).toBe(false);
    expect(rows.cfProgramEnrollment[0]).toEqual(expect.objectContaining({ status: 'active', isArchived: false }));
    expect(rows.cfTerms[0]).toEqual(expect.objectContaining({ enrollmentId: 'e1', programId: 'p1' }));
  });
});
