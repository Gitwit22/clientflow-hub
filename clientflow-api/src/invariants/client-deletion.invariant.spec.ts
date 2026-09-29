import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { StorageService } from '../integrations/storage/storage.service';
import type { PrismaService } from '../prisma/prisma.service';
import { BillingDashboardService } from '../modules/billing/billing-dashboard.service';
import { CLIENT_DELETION_STEPS, type ClientDataKey } from '../modules/clients/client-deletion.manifest';
import {
  CLIENT_PERMANENTLY_DELETED,
  ClientDeletionService,
  STORAGE_CLEANUP,
} from '../modules/clients/client-deletion.service';
import { inMemoryDb } from './in-memory-db';

/**
 * INVARIANT 9: permanent deletion leaves zero rows owned by the client, money included.
 * INVARIANT 10: it leaves exactly one organizational audit event, with no personal details.
 * Plus the archive rule: an archived client's payments stay in the financial records.
 */
const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const manager = { id: 'admin-1', role: 'org_admin' };
const PII = { businessName: 'Test Erase LLC', primaryContactName: 'Pat Private', email: 'pat@private.example' };

/** One row in every manifest table for a client, keyed by that client's ids. */
function ownedRows(organizationId: string, suffix: string) {
  const ids: Record<ClientDataKey, string> = {
    clientId: `client-${suffix}`,
    enrollmentId: `enr-${suffix}`,
    formAssignmentId: `fa-${suffix}`,
    intakeSubmissionId: `sub-${suffix}`,
    billingAgreementId: `agr-${suffix}`,
    anyOwnedId: `contract-${suffix}`,
  };
  const rows: Record<string, Array<Record<string, unknown>>> = {};
  for (const step of CLIENT_DELETION_STEPS) {
    (rows[step.model] ??= []).push({
      id: `${step.model}-${step.column ?? step.by}-${suffix}`,
      organizationId,
      [step.column ?? step.by]: ids[step.by],
    });
  }
  // The rows the service reads ids from, shaped like the real ones.
  rows.cfProgramEnrollment.push({ id: ids.enrollmentId, organizationId, clientId: ids.clientId, programId: 'p1', isArchived: false });
  rows.cfFormAssignment.push({ id: ids.formAssignmentId, organizationId, clientId: ids.clientId });
  rows.cfIntakeSubmission.push({ id: ids.intakeSubmissionId, organizationId, clientId: ids.clientId });
  rows.cfEnrollmentBillingAgreement.push({ id: ids.billingAgreementId, organizationId, enrollmentId: ids.enrollmentId });
  rows.cfContract.push({ id: ids.anyOwnedId, organizationId, clientId: ids.clientId, executedStoredFileId: `file-contract-${suffix}` });
  rows.cfDocument.push({
    id: `doc-${suffix}`, organizationId, clientId: ids.clientId, storedFileId: `file-doc-${suffix}`, objectKey: `client-documents/${suffix}.pdf`,
  });
  rows.cfPaymentRecord.push({
    id: `pay-${suffix}`, organizationId, enrollmentId: ids.enrollmentId, billingAgreementId: ids.billingAgreementId, amount: 250,
  });
  const files = [
    { id: `file-contract-${suffix}`, organizationId, storageKey: `contracts/${suffix}-executed.pdf` },
    { id: `file-doc-${suffix}`, organizationId, storageKey: `client-documents/${suffix}.pdf` },
  ];
  return { ids, rows, files };
}

function setup(storage: Partial<StorageService> = {}) {
  const target = ownedRows(ORG, 'a');
  const bystander = ownedRows(ORG, 'b');
  const otherOrg = ownedRows(OTHER_ORG, 'z');
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const set of [target, bystander, otherOrg]) {
    for (const [model, rows] of Object.entries(set.rows)) (tables[model] ??= []).push(...rows);
  }
  tables.cfClient = [
    { id: 'client-a', organizationId: ORG, isArchived: true, ...PII },
    { id: 'client-b', organizationId: ORG, isArchived: false, businessName: 'Keep LLC' },
    { id: 'client-z', organizationId: OTHER_ORG, isArchived: false, businessName: 'Other Org LLC' },
  ];
  tables.cfStoredFile = [
    ...target.files, ...bystander.files, ...otherOrg.files,
    // A program template's file must survive even if it were ever referenced.
    { id: 'file-template', organizationId: ORG, storageKey: 'templates/agreement.pdf' },
  ];
  tables.cfProgramContractVersion = [{ id: 'pv-1', organizationId: ORG, storedFileId: 'file-template' }];
  tables.auditLog = [];
  const db = inMemoryDb(tables) as unknown as PrismaService;
  const storageService = {
    isEnabled: () => true,
    deleteObject: jest.fn().mockResolvedValue(undefined),
    ...storage,
  } as unknown as StorageService & { deleteObject: jest.Mock };
  return { tables, service: new ClientDeletionService(db, storageService), storage: storageService, target, db };
}

function ownedBy(tables: Record<string, Array<Record<string, unknown>>>, ids: Record<ClientDataKey, string>) {
  const values = new Set(Object.values(ids));
  const left: string[] = [];
  for (const step of CLIENT_DELETION_STEPS) {
    for (const row of tables[step.model] ?? []) {
      if (values.has(row[step.column ?? step.by] as string)) left.push(`${step.model}:${String(row.id)}`);
    }
  }
  return left;
}

describe('INVARIANT: permanent deletion erases every client-owned row, money included', () => {
  it('leaves nothing of the client, and touches no other client or organization', async () => {
    const { tables, service, storage, target } = setup();
    const before = Object.fromEntries(Object.entries(tables).map(([model, rows]) => [model, rows.length]));

    const result = await service.permanentlyDelete({
      organizationId: ORG, clientId: 'client-a', actor: manager, confirmation: '  test erase llc ',
    });

    expect(ownedBy(tables, target.ids)).toEqual([]);
    expect(tables.cfClient.map((client) => client.id)).toEqual(['client-b', 'client-z']);
    expect(tables.cfPaymentRecord.map((payment) => payment.id)).not.toContain('pay-a');
    expect(tables.cfPaymentRecord.map((payment) => payment.id)).toEqual(expect.arrayContaining(['pay-b', 'pay-z']));
    expect(tables.cfStoredFile.map((file) => file.id).sort()).toEqual(
      ['file-contract-b', 'file-contract-z', 'file-doc-b', 'file-doc-z', 'file-template'].sort(),
    );
    // Every other table lost exactly this client's rows.
    for (const step of CLIENT_DELETION_STEPS) {
      expect(tables[step.model].every((row) => row.organizationId === OTHER_ORG || !String(row.id).endsWith('-a'))).toBe(true);
    }
    expect(tables.cfClient.length).toBe(before.cfClient - 1);
    expect(storage.deleteObject.mock.calls.map(([key]) => String(key)).sort()).toEqual(
      ['client-documents/a.pdf', 'contracts/a-executed.pdf'].sort(),
    );
    expect(result).toEqual(expect.objectContaining({ id: 'client-a', deleted: true, filesRemoved: 2, filesFailed: 0 }));
  });

  it('writes exactly one organizational audit event, with no personal details', async () => {
    const { tables, service } = setup();
    await service.permanentlyDelete({ organizationId: ORG, clientId: 'client-a', actor: manager, confirmation: PII.businessName });

    expect(tables.auditLog).toHaveLength(1);
    expect(tables.auditLog[0]).toEqual(expect.objectContaining({
      organizationId: ORG,
      actorAdminId: 'admin-1',
      action: 'deleted',
      targetType: CLIENT_PERMANENTLY_DELETED,
      targetId: 'client-a',
    }));
    const recorded = JSON.stringify(tables.auditLog);
    for (const value of Object.values(PII)) expect(recorded.toLowerCase()).not.toContain(value.toLowerCase());
  });

  it.each([
    ['a wrong confirmation', { confirmation: 'Some Other LLC' }, BadRequestException],
    ['a reviewer', { actor: { id: 'rev-1', role: 'reviewer' } }, ForbiddenException],
    ['another organization', { organizationId: OTHER_ORG }, NotFoundException],
  ])('refuses %s and deletes nothing', async (_label, override, error) => {
    const { tables, service, target } = setup();
    await expect(service.permanentlyDelete({
      organizationId: ORG, clientId: 'client-a', actor: manager, confirmation: PII.businessName, ...override,
    })).rejects.toBeInstanceOf(error);
    expect(ownedBy(tables, target.ids).length).toBeGreaterThan(0);
    expect(tables.auditLog).toHaveLength(0);
  });

  it('records files it could not remove for cleanup, without undoing the deletion', async () => {
    const { tables, service, target } = setup({ deleteObject: jest.fn().mockRejectedValue(new Error('R2 down')) });
    const result = await service.permanentlyDelete({
      organizationId: ORG, clientId: 'client-a', actor: manager, confirmation: PII.businessName,
    });
    expect(ownedBy(tables, target.ids)).toEqual([]);
    expect(result.filesFailed).toBe(2);
    expect(tables.auditLog.map((entry) => entry.targetType)).toEqual([CLIENT_PERMANENTLY_DELETED, STORAGE_CLEANUP]);
  });
});

describe('RULE: an archived client keeps their financial contribution', () => {
  it("counts an archived client's payments as money received", async () => {
    const paidAt = new Date();
    const db = inMemoryDb({
      cfEnrollmentBillingAgreement: [],
      cfPaymentRecord: [{
        id: 'pay-1', organizationId: ORG, enrollmentId: 'enr-archived', billingAgreementId: 'agr-1', amount: 400,
        voidedAt: null, paymentDate: paidAt, billingPeriodStart: paidAt, billingPeriodEnd: paidAt,
      }],
      cfProgramEnrollment: [{ id: 'enr-archived', organizationId: ORG, clientId: 'client-archived', programId: 'p1', isArchived: true }],
      cfProgram: [{ id: 'p1', organizationId: ORG, name: 'Program' }],
      cfClient: [{ id: 'client-archived', organizationId: ORG, isArchived: true, businessName: 'Archived LLC' }],
      cfProgramBillingConfig: [],
    }) as unknown as PrismaService;

    const dashboard = await new BillingDashboardService(db).getOrgDashboard(ORG, 'UTC', 'month');

    expect(dashboard.revenue.received).toBe(400);
    expect(dashboard.receivedByProgram).toEqual([expect.objectContaining({ programId: 'p1', received: 400 })]);
  });
});
