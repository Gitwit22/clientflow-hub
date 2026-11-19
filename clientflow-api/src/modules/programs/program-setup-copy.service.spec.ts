import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { parseCopyParts, ProgramSetupCopyService, COPY_PARTS } from './program-setup-copy.service';
import { WorkflowConfigService } from './workflow-config.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */

const ORG = 'org-1';
const actor = { actorUserId: 'admin-1', actorDisplayName: 'Jordan', actorEmail: 'jordan@example.org' };
const IDI_PIPELINE = ['New Intake', 'Terms Proposed', 'Contract Pending', 'Active', 'Monitoring', 'Final Report Needed', 'Completed'];

/** An IDI-like source program with every part set up, plus an inactive target and an active program. */
function setup() {
  const tables: Record<string, any[]> = {
    cfProgram: [
      { id: 'idi', organizationId: ORG, name: 'IDI', isActive: true, defaultFormTemplateId: 'form-idi', statusPipeline: IDI_PIPELINE, defaultWorkflow: ['Intake', 'Contract'], requiredDocuments: ['W-9'], defaultMonitoringFrequency: 'Monthly' },
      { id: 'grant', organizationId: ORG, name: 'Grant', isActive: false, defaultFormTemplateId: 'general-intake', statusPipeline: [], defaultWorkflow: [], requiredDocuments: [], defaultMonitoringFrequency: 'Quarterly' },
      { id: 'live', organizationId: ORG, name: 'Live', isActive: true, defaultFormTemplateId: 'general-intake', statusPipeline: [], defaultWorkflow: [], requiredDocuments: [], defaultMonitoringFrequency: 'Monthly' },
      { id: 'other-org-program', organizationId: 'org-2', name: 'Elsewhere', isActive: false, defaultFormTemplateId: 'general-intake', statusPipeline: [], defaultWorkflow: [], requiredDocuments: [], defaultMonitoringFrequency: 'Monthly' },
    ],
    cfFormTemplate: [
      { id: 'form-idi', organizationId: ORG, programId: 'idi', scope: 'program_section', isActive: true, name: 'IDI questions', description: 'About your business', fields: [{ id: 'q1' }, { id: 'q2' }], emailTemplate: 'default', internalNotes: null, dueInDays: 7, sortOrder: 0, version: 3 },
    ],
    cfProgramContractTemplate: [
      { id: 'tpl-enroll', organizationId: ORG, programId: 'idi', name: 'IDI Membership Agreement', purpose: 'enrollment', isActive: true, signatureRequired: true, activeVersionId: 'ver-enroll-2', createdAt: new Date('2026-01-01') },
      { id: 'tpl-award', organizationId: ORG, programId: 'idi', name: 'Member Fund Award Agreement', purpose: 'award', isActive: true, signatureRequired: true, activeVersionId: 'ver-award-1', createdAt: new Date('2026-02-01') },
      { id: 'tpl-old', organizationId: ORG, programId: 'idi', name: 'Retired', purpose: 'enrollment', isActive: false, signatureRequired: true, activeVersionId: 'ver-old', createdAt: new Date('2025-01-01') },
    ],
    cfProgramContractVersion: [
      { id: 'ver-enroll-1', organizationId: ORG, templateId: 'tpl-enroll', version: 1, title: 'Old', content: 'Old text', fileUrl: null, fileName: null, storedFileId: null, signableFields: [] },
      { id: 'ver-enroll-2', organizationId: ORG, templateId: 'tpl-enroll', version: 2, title: 'Membership', content: 'Welcome {{client.businessName}}', fileUrl: null, fileName: null, storedFileId: null, signableFields: [] },
      { id: 'ver-award-1', organizationId: ORG, templateId: 'tpl-award', version: 1, title: 'Award', content: 'Award of {{award.amount}}', fileUrl: null, fileName: null, storedFileId: null, signableFields: [] },
    ],
    cfProgramWorkflowConfig: [
      { id: 'wf-idi', organizationId: ORG, programId: 'idi', enabled: true, sendContractAfterIntake: true, sendWelcomeAfterContractSigned: true, activeContractTemplateId: 'tpl-enroll', activeContractVersionId: 'ver-enroll-2', activeWelcomeEmailTemplateId: 'wel-tpl', activeWelcomeEmailVersionId: 'wel-ver-2' },
    ],
    cfProgramWelcomeEmailTemplate: [{ id: 'wel-tpl', organizationId: ORG, programId: 'idi', name: 'Welcome Email', isActive: true }],
    cfProgramWelcomeEmailVersion: [
      { id: 'wel-ver-1', organizationId: ORG, templateId: 'wel-tpl', version: 1, subject: 'Old welcome', body: 'Old', guideStoredFileId: null, allowedVariables: [] },
      { id: 'wel-ver-2', organizationId: ORG, templateId: 'wel-tpl', version: 2, subject: 'Welcome to IDI', body: 'Hello {{client.firstName}}', guideStoredFileId: 'file-guide', allowedVariables: [] },
    ],
    cfProgramDeliverableTemplate: [
      { id: 'del-1', organizationId: ORG, programId: 'idi', title: 'Monthly check-in', description: null, cadence: 'MONTHLY', active: true, sortOrder: 0, programWideDate: false, createdAt: new Date() },
      { id: 'del-2', organizationId: ORG, programId: 'idi', title: 'Workshop', description: 'Group session', cadence: 'MONTHLY', active: true, sortOrder: 1, programWideDate: true, createdAt: new Date() },
      { id: 'del-off', organizationId: ORG, programId: 'idi', title: 'Retired', description: null, cadence: 'MONTHLY', active: false, sortOrder: 2, programWideDate: false, createdAt: new Date() },
    ],
    cfProgramDeliverableSchedule: [{ id: 'sch-1', organizationId: ORG, programId: 'idi', templateId: 'del-2', periodStart: new Date('2026-11-01'), scheduledFor: new Date('2026-11-20') }],
    cfProgramBillingConfig: [{ id: 'bill-idi', organizationId: ORG, programId: 'idi', defaultAmount: 99, frequency: 'monthly', customIntervalDays: null, billingRequired: true, defaultDueDay: 1, allowCustomClientPricing: true, active: true }],
    cfProgramAutomationRule: [
      { id: 'rule-email', organizationId: ORG, programId: 'idi', trigger: 'intake_submitted', action: 'send_email', conditions: {}, actionConfig: { subject: 'Thanks', message: 'We got it' }, enabled: true, sortOrder: 0, createdAt: new Date() },
      { id: 'rule-form', organizationId: ORG, programId: 'idi', trigger: 'contract_signed', action: 'send_form', conditions: {}, actionConfig: { formTemplateId: 'form-idi' }, enabled: true, sortOrder: 0, createdAt: new Date() },
    ],
    cfProgramEnrollment: [{ id: 'enr-1', organizationId: ORG, programId: 'idi', clientId: 'client-1', status: 'active' }],
    cfProgramSetupCopy: [],
  };
  const db = inMemoryDb(tables, { cfProgramSetupCopy: [['organizationId', 'idempotencyKey']] }) as any;
  db.$queryRaw = jest.fn().mockResolvedValue([]);
  const service = new ProgramSetupCopyService(db, new WorkflowConfigService(db));
  return { tables, db, service };
}

const ALL = [...COPY_PARTS];
const request = (parts = ALL, key = 'copy-key-1', sourceProgramId = 'idi') => ({ sourceProgramId, parts, idempotencyKey: key });

describe('copying a program setup', () => {
  it('reads the parts staff chose, in a fixed order, and refuses unknown or empty choices', () => {
    expect(parseCopyParts(['billing', 'journey', 'billing'])).toEqual(['journey', 'billing']);
    expect(() => parseCopyParts([])).toThrow(BadRequestException);
    expect(() => parseCopyParts(['clients'])).toThrow('Unknown setup parts: clients.');
  });

  it("creates an inactive program with every part of IDI's setup, and nothing client-related", async () => {
    const { service, tables } = setup();
    const before = { enrollments: tables.cfProgramEnrollment.length, schedules: tables.cfProgramDeliverableSchedule.length };
    const result = await service.createFromCopy(ORG, { name: 'Second Program', description: 'Like IDI', statusPipeline: ['New Intake'], defaultWorkflow: [] }, request(), actor);

    const program = tables.cfProgram.find((row) => row.id === result.programId);
    expect(program).toEqual(expect.objectContaining({ name: 'Second Program', isActive: false, statusPipeline: IDI_PIPELINE, requiredDocuments: ['W-9'], defaultMonitoringFrequency: 'Monthly' }));

    // Intake questions: a copy owned by the new program, used as its intake.
    const questions = tables.cfFormTemplate.find((row) => row.programId === program.id);
    expect(questions).toEqual(expect.objectContaining({ name: 'IDI questions', scope: 'program_section', fields: [{ id: 'q1' }, { id: 'q2' }], version: 1 }));
    expect(program.defaultFormTemplateId).toBe(questions.id);

    // Agreements: the active ones (not the retired one), each from the version in use.
    const agreements = tables.cfProgramContractTemplate.filter((row) => row.programId === program.id);
    expect(agreements.map((row) => [row.name, row.purpose])).toEqual([
      ['IDI Membership Agreement', 'enrollment'],
      ['Member Fund Award Agreement', 'award'],
    ]);
    const versionOf = (template: any) => tables.cfProgramContractVersion.find((row) => row.id === template.activeVersionId);
    expect(versionOf(agreements[0])).toEqual(expect.objectContaining({ version: 1, content: 'Welcome {{client.businessName}}', createdBy: 'jordan@example.org' }));
    expect(versionOf(agreements[1]).content).toBe('Award of {{award.amount}}');

    // The enrollment agreement and welcome email are designated, and the switches copied.
    const workflow = tables.cfProgramWorkflowConfig.find((row) => row.programId === program.id);
    expect(workflow).toEqual(expect.objectContaining({
      activeContractTemplateId: agreements[0].id,
      activeContractVersionId: agreements[0].activeVersionId,
      enabled: true,
      sendContractAfterIntake: true,
      sendWelcomeAfterContractSigned: true,
    }));
    const welcome = tables.cfProgramWelcomeEmailVersion.find((row) => row.id === workflow.activeWelcomeEmailVersionId);
    expect(welcome).toEqual(expect.objectContaining({ subject: 'Welcome to IDI', guideStoredFileId: 'file-guide', version: 1 }));

    // Active deliverables only; program-wide dates stay with IDI.
    expect(tables.cfProgramDeliverableTemplate.filter((row) => row.programId === program.id).map((row) => row.title)).toEqual(['Monthly check-in', 'Workshop']);
    expect(tables.cfProgramDeliverableSchedule).toHaveLength(before.schedules);

    expect(tables.cfProgramBillingConfig.find((row) => row.programId === program.id)).toEqual(expect.objectContaining({ defaultAmount: 99, frequency: 'monthly', billingRequired: true }));

    // Only custom emails carry over: a rule pointing at IDI's own form does not.
    expect(tables.cfProgramAutomationRule.filter((row) => row.programId === program.id).map((row) => row.action)).toEqual(['send_email']);

    expect(tables.cfProgramEnrollment).toHaveLength(before.enrollments);
    expect(tables.cfProgramSetupCopy).toEqual([expect.objectContaining({ targetProgramId: program.id, sourceProgramId: 'idi', idempotencyKey: 'copy-key-1', createdByUserId: 'admin-1' })]);
    expect(result.parts.map((part) => part.outcome)).toEqual(['replace', 'copy', 'copy', 'copy', 'copy', 'replace', 'replace']);
  });

  it('copies only the parts staff chose', async () => {
    const { service, tables } = setup();
    const result = await service.createFromCopy(ORG, { name: 'Agreements only', description: '' }, request(['agreements']), actor);
    expect(tables.cfProgramContractTemplate.filter((row) => row.programId === result.programId)).toHaveLength(2);
    expect(tables.cfFormTemplate.filter((row) => row.programId === result.programId)).toHaveLength(0);
    expect(tables.cfProgramDeliverableTemplate.filter((row) => row.programId === result.programId)).toHaveLength(0);
    expect(tables.cfProgramBillingConfig.filter((row) => row.programId === result.programId)).toHaveLength(0);
  });

  it('finishes an existing inactive program without overwriting what it already has', async () => {
    const { service, tables } = setup();
    tables.cfFormTemplate.push({ id: 'form-grant', organizationId: ORG, programId: 'grant', scope: 'program_section', isActive: true, name: 'Grant questions', fields: [] });
    tables.cfProgramContractTemplate.push({ id: 'tpl-grant', organizationId: ORG, programId: 'grant', name: 'IDI Membership Agreement', purpose: 'enrollment', isActive: true, activeVersionId: 'ver-grant' });
    tables.cfProgramWorkflowConfig.push({ id: 'wf-grant', organizationId: ORG, programId: 'grant', enabled: true, sendContractAfterIntake: false, sendWelcomeAfterContractSigned: false, activeContractTemplateId: 'tpl-grant', activeContractVersionId: 'ver-grant', activeWelcomeEmailTemplateId: null, activeWelcomeEmailVersionId: null });
    tables.cfProgramDeliverableTemplate.push({ id: 'del-grant', organizationId: ORG, programId: 'grant', title: 'monthly CHECK-IN', active: true, sortOrder: 0 });

    const result = await service.copyInto(ORG, 'grant', request(['intakeQuestions', 'agreements', 'welcomeEmail', 'deliverables']), actor);
    const outcome = Object.fromEntries(result.parts.map((part) => [part.part, part.outcome]));
    expect(outcome).toEqual({ intakeQuestions: 'skip', agreements: 'copy', welcomeEmail: 'copy', deliverables: 'copy' });

    // Its own questions stay; the same-named agreement is kept, only the award one is added, and
    // its enrollment agreement stays the designated one.
    expect(tables.cfFormTemplate.filter((row) => row.programId === 'grant').map((row) => row.id)).toEqual(['form-grant']);
    expect(tables.cfProgramContractTemplate.filter((row) => row.programId === 'grant').map((row) => row.name)).toEqual(['IDI Membership Agreement', 'Member Fund Award Agreement']);
    const workflow = tables.cfProgramWorkflowConfig.find((row) => row.programId === 'grant');
    expect(workflow.activeContractTemplateId).toBe('tpl-grant');
    expect(workflow.activeWelcomeEmailVersionId).toBeTruthy();
    // Deliverable titles already there (any letter case) are not added twice.
    expect(tables.cfProgramDeliverableTemplate.filter((row) => row.programId === 'grant').map((row) => row.title)).toEqual(['monthly CHECK-IN', 'Workshop']);
  });

  it('never changes a live program, the program itself, or another organization', async () => {
    const { service } = setup();
    await expect(service.copyInto(ORG, 'live', request(), actor)).rejects.toThrow(ConflictException);
    await expect(service.copyInto(ORG, 'idi', request(ALL, 'k-idi', 'grant'), actor)).rejects.toThrow(ConflictException);
    await expect(service.copyInto(ORG, 'grant', request(ALL, 'k-self', 'grant'), actor)).rejects.toThrow('Choose a different program');
    await expect(service.copyInto(ORG, 'grant', request(ALL, 'k-org', 'other-org-program'), actor)).rejects.toThrow(NotFoundException);
    await expect(service.copyInto('org-2', 'other-org-program', request(ALL, 'k-org2'), actor)).rejects.toThrow('Program to copy from not found.');
  });

  it('copies once when the same request is repeated', async () => {
    const { service, tables } = setup();
    const first = await service.createFromCopy(ORG, { name: 'Second Program', description: '' }, request(), actor);
    const again = await service.createFromCopy(ORG, { name: 'Second Program', description: '' }, request(), actor);
    expect(again).toEqual(expect.objectContaining({ programId: first.programId, replayed: true }));
    expect(tables.cfProgram.filter((row) => row.name === 'Second Program')).toHaveLength(1);
    expect(tables.cfProgramSetupCopy).toHaveLength(1);
  });

  it('previews what would be copied without changing anything', async () => {
    const { service, tables } = setup();
    const snapshot = JSON.stringify(tables);
    const preview = await service.preview(ORG, 'grant', 'idi', ALL);
    expect(JSON.stringify(tables)).toBe(snapshot);
    expect(preview.parts.find((part) => part.part === 'agreements')).toEqual(expect.objectContaining({
      outcome: 'copy',
      detail: expect.stringContaining('"IDI Membership Agreement" becomes the enrollment agreement.'),
    }));
    expect(preview.parts.find((part) => part.part === 'deliverables')?.detail).toContain('Program-wide dates are not copied');
  });

  it('says when the program it copies from has nothing for a part', async () => {
    const { service } = setup();
    const preview = await service.preview(ORG, null, 'grant', ['intakeQuestions', 'agreements', 'welcomeEmail', 'deliverables', 'billing']);
    expect(preview.parts.map((part) => part.outcome)).toEqual(['nothing', 'nothing', 'nothing', 'nothing', 'nothing']);
  });
});
