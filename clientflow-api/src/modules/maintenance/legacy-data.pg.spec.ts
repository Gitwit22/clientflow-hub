import { PrismaClient } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';
import { LEGACY_CONTRACT_HEADER } from '../contracts/legacy-contract';
import { LegacyDataService } from './legacy-data.service';

/**
 * Runs against a real, migrated Postgres (the cleanup uses OR/NOT/startsWith filters the in-memory
 * test database doesn't model). Set CLIENTFLOW_PG_TEST_URL to a throwaway database to run it:
 *   CLIENTFLOW_PG_TEST_URL=postgresql://postgres@127.0.0.1:55432/cf npx jest legacy-data.pg
 */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('LegacyDataService (Postgres)', () => {
  let prisma: PrismaClient;
  let service: LegacyDataService;
  const admin = { id: '', role: 'org_admin' };
  let orgId = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    service = new LegacyDataService(prisma as unknown as PrismaService);
    const org = await prisma.organization.create({ data: { name: 'Legacy Org', slug: `legacy-${Date.now()}` } });
    orgId = org.id;
    admin.id = (await prisma.adminUser.create({ data: { organizationId: orgId, email: `a${Date.now()}@x.test`, passwordHash: 'x' } })).id;
    const scope = { organizationId: orgId };
    const client = (name: string) => prisma.cfClient.create({
      data: { ...scope, businessName: name, primaryContactName: name, email: `${name}@x.test`, phone: '', assignedStaff: 'Unassigned', intake: {} },
    });
    const program = await prisma.cfProgram.create({
      data: { ...scope, name: 'Inspired Detroit', description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: 'monthly', defaultContractTemplateId: 'Service Agreement' },
    });
    ids.program = program.id;
    const onlyLegacy = await client('OnlyLegacy');
    const signedReal = await client('SignedReal');
    ids.onlyLegacy = onlyLegacy.id;
    ids.signedReal = signedReal.id;
    ids.enrollOnly = (await prisma.cfProgramEnrollment.create({ data: { ...scope, clientId: onlyLegacy.id, programId: program.id, status: 'approved' } })).id;
    ids.enrollSigned = (await prisma.cfProgramEnrollment.create({ data: { ...scope, clientId: signedReal.id, programId: program.id, status: 'active' } })).id;

    const legacyContract = (clientId: string, data: Record<string, unknown> = {}) => prisma.cfContract.create({
      data: {
        ...scope, clientId, programId: program.id, contractTemplateId: '', contractType: 'Service Agreement', status: 'DRAFT',
        generatedContent: `${LEGACY_CONTRACT_HEADER}\n\nThis agreement … {{programName}}`, ...data,
      },
    });
    ids.draftA = (await legacyContract(onlyLegacy.id)).id;
    ids.draftB = (await legacyContract(onlyLegacy.id, { status: 'Draft', enrollmentId: ids.enrollOnly })).id;
    ids.sentLegacy = (await legacyContract(onlyLegacy.id, { status: 'SENT', secureTokenHash: 'f'.repeat(64), sentAt: new Date() })).id;
    ids.signedLegacy = (await legacyContract(signedReal.id, { status: 'COMPLETED', completedAt: new Date() })).id;
    ids.real = (await prisma.cfContract.create({
      data: {
        ...scope, clientId: signedReal.id, programId: program.id, enrollmentId: ids.enrollSigned, contractTemplateId: 'pt-1',
        contractType: 'Inspired Detroit Agreement', status: 'DRAFT', generatedContent: 'Real', staffSignedAt: new Date(),
      },
    })).id;
    await prisma.cfCommunication.create({
      data: { ...scope, clientId: onlyLegacy.id, contractId: ids.draftA, type: 'contract_email', direction: 'outbound', subject: 'x', date: new Date(), staffMember: 'x' },
    });

    // A program form and a general form sent before enrollments existed.
    const programForm = await prisma.cfFormTemplate.create({ data: { ...scope, programId: program.id, name: 'Check-in', description: '', emailTemplate: '' } });
    const generalForm = await prisma.cfFormTemplate.create({ data: { ...scope, name: 'General Intake', description: '', emailTemplate: '' } });
    ids.programFormAssignment = (await prisma.cfFormAssignment.create({ data: { ...scope, clientId: onlyLegacy.id, formId: programForm.id, status: 'sent' } })).id;
    ids.generalFormAssignment = (await prisma.cfFormAssignment.create({ data: { ...scope, clientId: onlyLegacy.id, formId: generalForm.id, status: 'sent' } })).id;
    await prisma.cfCommunication.create({
      data: { ...scope, clientId: onlyLegacy.id, formAssignmentId: ids.programFormAssignment, type: 'form_email', direction: 'outbound', subject: 'x', date: new Date(), staffMember: 'x' },
    });

    // An intake submitted before answers were written to the profile.
    const intakeForm = await prisma.cfFormTemplate.create({
      data: {
        ...scope, name: 'Intake', description: '', emailTemplate: '',
        fields: [
          { id: 'businessName', label: 'Business name', type: 'text' },
          { id: 'phone', label: 'Phone', type: 'text' },
          { id: 'businessDescription', label: 'Describe your business', type: 'textarea' },
        ],
      },
    });
    await prisma.cfFormAssignment.create({
      data: {
        ...scope, clientId: onlyLegacy.id, formId: intakeForm.id, status: 'submitted', submittedAt: new Date(),
        responses: { businessName: 'Renamed Biz', phone: '313-555-0100', businessDescription: 'Neighborhood bakery' },
      },
    });

    // Rows of a client deleted before permanent delete existed.
    await prisma.cfActivityLog.create({ data: { ...scope, clientId: 'gone-client', action: 'x', description: 'x', user: 'x' } });
    await prisma.cfFormAssignment.create({ data: { ...scope, clientId: 'gone-client', formId: generalForm.id } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('previews without changing anything', async () => {
    const before = await prisma.cfContract.count({ where: { organizationId: orgId } });
    const report = await service.preview(orgId, admin);

    expect(report.applied).toBe(false);
    expect(report.contracts.remove.map((c) => c.contractId).sort()).toEqual([ids.draftA, ids.draftB].sort());
    expect(report.contracts.cancel.map((c) => c.contractId)).toEqual([ids.sentLegacy]);
    expect(report.contracts.keep.map((c) => c.contractId)).toEqual([ids.signedLegacy]);
    expect(report.linked.formAssignments).toBe(1); // the program form; the general form stays client-wide
    expect(report.clientsNeedingContract).toEqual([
      expect.objectContaining({ clientId: ids.onlyLegacy, enrollmentId: ids.enrollOnly, programName: 'Inspired Detroit' }),
    ]);
    expect(report.profilesFilled).toEqual([
      { clientId: ids.onlyLegacy, businessName: 'OnlyLegacy', fields: ['Phone', 'Business description'] },
    ]);
    expect(report.orphans.clientIds).toBe(1);
    expect(await prisma.cfContract.count({ where: { organizationId: orgId } })).toBe(before);
  });

  it('applies: removes unsent drafts, cancels the sent one, keeps signed records, links sent forms', async () => {
    const report = await service.apply(orgId, admin);
    expect(report.applied).toBe(true);

    const remaining = await prisma.cfContract.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } });
    expect(remaining.map((c) => c.id).sort()).toEqual([ids.sentLegacy, ids.signedLegacy, ids.real].sort());
    const cancelled = remaining.find((c) => c.id === ids.sentLegacy)!;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.secureTokenHash).toBeNull();
    expect(remaining.find((c) => c.id === ids.signedLegacy)!.status).toBe('COMPLETED');

    const forms = await prisma.cfFormAssignment.findMany({ where: { organizationId: orgId } });
    expect(forms.find((f) => f.id === ids.programFormAssignment)!.enrollmentId).toBe(ids.enrollOnly);
    expect(forms.find((f) => f.id === ids.generalFormAssignment)!.enrollmentId).toBeNull();
    expect(forms.some((f) => f.clientId === 'gone-client')).toBe(false);

    const formEmail = await prisma.cfCommunication.findFirst({ where: { organizationId: orgId, formAssignmentId: ids.programFormAssignment } });
    expect(formEmail!.enrollmentId).toBe(ids.enrollOnly);
    const draftEmail = await prisma.cfCommunication.findFirst({ where: { organizationId: orgId, type: 'contract_email' } });
    expect(draftEmail!.contractId).toBeNull();

    const filled = await prisma.cfClient.findUnique({ where: { id: ids.onlyLegacy } });
    expect(filled).toMatchObject({ businessName: 'OnlyLegacy', phone: '313-555-0100', intake: { businessDescription: 'Neighborhood bakery' } });

    const audit = await prisma.auditLog.findMany({ where: { organizationId: orgId, targetType: 'LEGACY_DATA_CLEANUP' } });
    expect(audit).toHaveLength(1);
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    const report = await service.preview(orgId, admin);
    expect(report.contracts.remove).toEqual([]);
    expect(report.contracts.cancel).toEqual([]);
    expect(Object.values(report.linked).every((count) => count === 0)).toBe(true);
    expect(report.orphans.clientIds).toBe(0);
    expect(report.profilesFilled).toEqual([]);
  });

  it('is for organization admins only', async () => {
    await expect(service.preview(orgId, { id: admin.id, role: 'reviewer' })).rejects.toThrow(/organization admins/);
  });
});
