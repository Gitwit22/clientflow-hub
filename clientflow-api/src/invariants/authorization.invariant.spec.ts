import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { ScaffoldService } from '../common/services/scaffold.service';
import { EnrollmentsService } from '../modules/enrollments/enrollments.service';
import { hashPublicToken } from '../modules/forms/intake-lifecycle';
import { IntakeWorkflowService } from '../modules/forms/intake-workflow.service';
import {
  OrganizationsCompatibilityController,
  PublicFormCompatibilityController,
} from '../modules/compatibility/compatibility.controller';
import { inMemoryDb } from './in-memory-db';

const ORG = 'org-a';

function orgController(actor: { id: string; role: string }) {
  const db = inMemoryDb({
    adminUser: [
      { id: 'reviewer-1', organizationId: ORG, role: 'reviewer', isActive: true },
      { id: 'admin-1', organizationId: ORG, role: 'org_admin', isActive: true },
      { id: 'super-1', organizationId: ORG, role: 'super_admin', isActive: true },
      { id: 'admin-b', organizationId: 'org-b', role: 'org_admin', isActive: true },
    ],
  });
  const controller = new OrganizationsCompatibilityController(new ScaffoldService(), db as never);
  jest.spyOn(controller as never, 'requireOrgAccess').mockResolvedValue({ ...actor, organizationId: ORG, isActive: true } as never);
  return { controller, db: db as unknown as { adminUser: { findFirst: (q: unknown) => Promise<{ role: string } | null> } } };
}

/** INVARIANT 2: a reviewer can never promote their own (or anyone's) role. */
describe('INVARIANT: role changes follow the role policy', () => {
  it.each(['reviewer', 'org_admin', 'super_admin'])('a reviewer cannot make themself %s', async (role) => {
    const { controller, db } = orgController({ id: 'reviewer-1', role: 'reviewer' });
    await expect(controller.updateMemberRole({} as never, ORG, 'reviewer-1', { role })).rejects.toBeInstanceOf(ForbiddenException);
    expect((await db.adminUser.findFirst({ where: { id: 'reviewer-1' } }))?.role).toBe('reviewer');
  });

  it('a reviewer cannot promote anyone else either', async () => {
    const { controller } = orgController({ id: 'reviewer-1', role: 'reviewer' });
    await expect(controller.updateMemberRole({} as never, ORG, 'admin-1', { role: 'super_admin' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an org_admin cannot change their own role or grant super_admin', async () => {
    const { controller } = orgController({ id: 'admin-1', role: 'org_admin' });
    await expect(controller.updateMemberRole({} as never, ORG, 'admin-1', { role: 'super_admin' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.updateMemberRole({} as never, ORG, 'reviewer-1', { role: 'super_admin' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('members of another organization are not found', async () => {
    const { controller } = orgController({ id: 'admin-1', role: 'org_admin' });
    await expect(controller.updateMemberRole({} as never, ORG, 'admin-b', { role: 'reviewer' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

/** INVARIANT 3: a cancelled, expired or submitted public token can never change workflow state. */
describe('INVARIANT: closed public form links cannot mutate workflow', () => {
  const token = 'T'.repeat(43);
  const base = {
    id: 'assign-1', organizationId: ORG, clientId: 'client-1', formId: 'form-1',
    secureLinkToken: hashPublicToken(token), status: 'sent', cancelledAt: null, expiresAt: null, submittedAt: null,
  };

  function publicController(assignment: Record<string, unknown>) {
    const rows = { cfFormAssignment: [{ ...base, ...assignment }], cfIntakeSubmission: [], cfProgramEnrollment: [] };
    const db = inMemoryDb({
      ...rows,
      cfClient: [{ id: 'client-1', organizationId: ORG, isArchived: false }],
      cfFormTemplate: [{ id: 'form-1', organizationId: ORG, isActive: true, fields: [] }],
    });
    const intake = new IntakeWorkflowService(db as never, new EnrollmentsService(db as never));
    return { controller: new PublicFormCompatibilityController(new ScaffoldService(), db as never, intake), rows };
  }

  it.each([
    ['cancelled', { cancelledAt: new Date(), status: 'cancelled' }, GoneException],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }, GoneException],
    ['already submitted', { submittedAt: new Date(), status: 'submitted' }, ConflictException],
  ])('a %s link cannot be submitted, and nothing is written', async (_state, assignment, error) => {
    const { controller, rows } = publicController(assignment);
    const before = JSON.stringify(rows);
    await expect(controller.submitForm(token, { answers: {} })).rejects.toBeInstanceOf(error);
    expect(JSON.stringify(rows)).toBe(before);
    expect(rows.cfIntakeSubmission).toHaveLength(0);
    expect(rows.cfProgramEnrollment).toHaveLength(0);
  });

  it('opening a cancelled link does not reopen it', async () => {
    const { controller, rows } = publicController({ cancelledAt: new Date(), status: 'cancelled' });
    await expect(controller.getForm(token)).rejects.toBeInstanceOf(GoneException);
    expect(rows.cfFormAssignment[0].status).toBe('cancelled');
  });
});
