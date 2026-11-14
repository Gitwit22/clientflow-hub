import { PrismaClient } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';
import { COPY_PARTS, ProgramSetupCopyService } from './program-setup-copy.service';
import { WorkflowConfigService } from './workflow-config.service';

/** Copying a program's setup against a real, migrated Postgres. Set CLIENTFLOW_PG_TEST_URL to run it. */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('copying a program setup (Postgres)', () => {
  let prisma: PrismaClient;
  let service: ProgramSetupCopyService;
  let organizationId: string;
  let sourceId: string;
  const actor = { actorUserId: null, actorDisplayName: 'Jordan', actorEmail: 'jordan@example.org' };
  const parts = [...COPY_PARTS];
  let n = 0;
  const key = () => `copy-${Date.now()}-${(n += 1)}`;

  const programRows = (programId: string) =>
    Promise.all([
      prisma.cfProgramContractTemplate.count({ where: { organizationId, programId } }),
      prisma.cfFormTemplate.count({ where: { organizationId, programId } }),
      prisma.cfProgramDeliverableTemplate.count({ where: { organizationId, programId } }),
      prisma.cfProgramWelcomeEmailTemplate.count({ where: { organizationId, programId } }),
      prisma.cfProgramAutomationRule.count({ where: { organizationId, programId } }),
    ]);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const db = prisma as unknown as PrismaService;
    service = new ProgramSetupCopyService(db, new WorkflowConfigService(db));
    const stamp = Date.now();
    organizationId = (await prisma.organization.create({ data: { name: 'Copy', slug: `copy-${stamp}` } })).id;
    const source = await prisma.cfProgram.create({
      data: { organizationId, name: 'IDI', description: '', isActive: true, defaultFormTemplateId: 'general-intake', defaultMonitoringFrequency: 'Monthly', defaultContractTemplateId: '', statusPipeline: ['New Intake', 'Contract Pending', 'Active'], defaultWorkflow: [] },
    });
    sourceId = source.id;
    const form = await prisma.cfFormTemplate.create({
      data: { organizationId, programId: sourceId, scope: 'program_section', name: 'IDI questions', description: '', fields: [{ id: 'q1', label: 'Q1' }], emailTemplate: 'default' },
    });
    await prisma.cfProgram.update({ where: { id: sourceId }, data: { defaultFormTemplateId: form.id } });
    const agreement = await prisma.cfProgramContractTemplate.create({ data: { organizationId, programId: sourceId, name: 'IDI Agreement', purpose: 'enrollment' } });
    const version = await prisma.cfProgramContractVersion.create({ data: { organizationId, templateId: agreement.id, version: 1, content: 'Agreement for {{client.businessName}}', createdBy: 'seed' } });
    await prisma.cfProgramContractTemplate.update({ where: { id: agreement.id }, data: { activeVersionId: version.id } });
    const welcome = await prisma.cfProgramWelcomeEmailTemplate.create({ data: { organizationId, programId: sourceId, name: 'Welcome Email' } });
    const welcomeVersion = await prisma.cfProgramWelcomeEmailVersion.create({ data: { organizationId, templateId: welcome.id, version: 1, subject: 'Welcome', body: 'Hello', createdBy: 'seed' } });
    await prisma.cfProgramWorkflowConfig.create({
      data: { organizationId, programId: sourceId, sendContractAfterIntake: true, sendWelcomeAfterContractSigned: true, activeContractTemplateId: agreement.id, activeContractVersionId: version.id, activeWelcomeEmailTemplateId: welcome.id, activeWelcomeEmailVersionId: welcomeVersion.id },
    });
    await prisma.cfProgramDeliverableTemplate.create({ data: { organizationId, programId: sourceId, title: 'Monthly check-in' } });
    await prisma.cfProgramBillingConfig.create({ data: { organizationId, programId: sourceId, defaultAmount: 150.5 } });
    await prisma.cfProgramAutomationRule.create({ data: { organizationId, programId: sourceId, trigger: 'intake_submitted', action: 'send_email', actionConfig: { subject: 'Thanks', message: 'Got it' } } });
  });
  afterAll(async () => prisma?.$disconnect());

  it('creates the program and copies every part in one transaction', async () => {
    const result = await service.createFromCopy(organizationId, { name: 'Second Program', description: '' }, { sourceProgramId: sourceId, parts, idempotencyKey: key() }, actor);
    expect(await programRows(result.programId)).toEqual([1, 1, 1, 1, 1]);
    const program = await prisma.cfProgram.findUniqueOrThrow({ where: { id: result.programId } });
    expect(program.isActive).toBe(false);
    const workflow = await prisma.cfProgramWorkflowConfig.findFirstOrThrow({ where: { organizationId, programId: result.programId } });
    expect(workflow.activeContractVersionId).toBeTruthy();
    expect(workflow.activeWelcomeEmailVersionId).toBeTruthy();
    const billing = await prisma.cfProgramBillingConfig.findFirstOrThrow({ where: { organizationId, programId: result.programId } });
    expect(Number(billing.defaultAmount)).toBe(150.5);
  });

  it('leaves nothing behind when a part fails', async () => {
    const programsBefore = await prisma.cfProgram.count({ where: { organizationId } });
    const copiesBefore = await prisma.cfProgramSetupCopy.count({ where: { organizationId } });
    // Billing runs after the agreements, questions and welcome email have been written.
    jest.spyOn(service as never, 'copyBilling').mockRejectedValueOnce(new Error('billing failed') as never);
    await expect(service.createFromCopy(organizationId, { name: 'Half made', description: '' }, { sourceProgramId: sourceId, parts, idempotencyKey: key() }, actor))
      .rejects.toThrow('billing failed');
    expect(await prisma.cfProgram.count({ where: { organizationId } })).toBe(programsBefore);
    expect(await prisma.cfProgram.count({ where: { organizationId, name: 'Half made' } })).toBe(0);
    expect(await prisma.cfProgramSetupCopy.count({ where: { organizationId } })).toBe(copiesBefore);

    const target = await prisma.cfProgram.create({ data: { organizationId, name: 'Grant', description: '', isActive: false, defaultFormTemplateId: 'general-intake', defaultMonitoringFrequency: 'Quarterly', defaultContractTemplateId: '' } });
    jest.spyOn(service as never, 'copyBilling').mockRejectedValueOnce(new Error('billing failed') as never);
    await expect(service.copyInto(organizationId, target.id, { sourceProgramId: sourceId, parts, idempotencyKey: key() }, actor)).rejects.toThrow('billing failed');
    expect(await programRows(target.id)).toEqual([0, 0, 0, 0, 0]);
    expect((await prisma.cfProgram.findUniqueOrThrow({ where: { id: target.id } })).defaultMonitoringFrequency).toBe('Quarterly');
  });

  it('creates one program when the same request arrives twice at the same moment', async () => {
    const idempotencyKey = key();
    const results = await Promise.all([1, 2, 3].map(() =>
      service.createFromCopy(organizationId, { name: 'Twice', description: '' }, { sourceProgramId: sourceId, parts, idempotencyKey }, actor)));
    expect(new Set(results.map((result) => result.programId)).size).toBe(1);
    expect(await prisma.cfProgram.count({ where: { organizationId, name: 'Twice' } })).toBe(1);
    expect(await prisma.cfProgramSetupCopy.count({ where: { organizationId, idempotencyKey } })).toBe(1);
  });

  it('applies two different copies into one program one after the other', async () => {
    const target = await prisma.cfProgram.create({ data: { organizationId, name: 'Sponsorship', description: '', isActive: false, defaultFormTemplateId: 'general-intake', defaultMonitoringFrequency: 'Monthly', defaultContractTemplateId: '' } });
    const results = await Promise.all([key(), key()].map((idempotencyKey) =>
      service.copyInto(organizationId, target.id, { sourceProgramId: sourceId, parts: ['agreements', 'welcomeEmail', 'intakeQuestions'], idempotencyKey }, actor)));
    // The row lock makes the second copy see the first one's work: nothing is added twice.
    expect(await programRows(target.id)).toEqual([1, 1, 0, 1, 0]);
    expect(results.flatMap((result) => result.parts.map((part) => part.outcome)).sort()).toEqual(['copy', 'copy', 'copy', 'skip', 'skip', 'skip']);
  });
});
