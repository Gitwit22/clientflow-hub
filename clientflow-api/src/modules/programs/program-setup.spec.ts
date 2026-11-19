import { ScaffoldService } from '../../common/services/scaffold.service';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { ClientflowCompatibilityController } from '../compatibility/compatibility.controller';
import { assertIntakeChoice, journeyHasContractStage, programSetup } from './program-setup';
import { WorkflowConfigService } from './workflow-config.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */

const ORG = 'org-1';
const DEFAULT_PIPELINE = ['New Intake', 'Needs Review', 'More Information Needed', 'Qualified', 'Approved', 'Terms Proposed', 'Contract Pending', 'Active', 'Monitoring', 'Final Report Needed', 'Completed'];
const NO_CONTRACT_PIPELINE = ['New Intake', 'Active', 'Final Report Needed', 'Completed'];

function setup(programs: Array<Record<string, unknown>> = []) {
  const tables: Record<string, any[]> = {
    cfProgram: programs.map((program) => ({ organizationId: ORG, isActive: false, defaultWorkflow: [], statusPipeline: DEFAULT_PIPELINE, defaultFormTemplateId: 'general-intake', ...program })),
    cfFormTemplate: [
      { id: 'form-1', organizationId: ORG, isActive: true, programId: 'p2', scope: 'program_section' },
      { id: 'form-other', organizationId: ORG, isActive: true, programId: 'p9', scope: 'program_section' },
      { id: 'form-shared', organizationId: ORG, isActive: true, programId: null, scope: 'program_section' },
    ],
    cfProgramWorkflowConfig: [],
    cfProgramContractTemplate: [],
    cfProgramContractVersion: [],
    cfProgramWelcomeEmailVersion: [],
    cfProgramDeliverableTemplate: [],
    cfProgramBillingConfig: [],
  };
  const db = inMemoryDb(tables) as any;
  const controller = new ClientflowCompatibilityController(new ScaffoldService(), db, undefined, undefined, undefined, new WorkflowConfigService(db));
  jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({ orgId: ORG, admin: { id: 'admin-1', email: 'staff@example.org' } });
  const withAgreement = (programId: string) => {
    tables.cfProgramContractTemplate.push({ id: `tpl-${programId}`, organizationId: ORG, programId, purpose: 'enrollment', isActive: true, activeVersionId: `ver-${programId}` });
    tables.cfProgramContractVersion.push({ id: `ver-${programId}`, organizationId: ORG, templateId: `tpl-${programId}` });
    tables.cfProgramWorkflowConfig.push({
      id: `wf-${programId}`, organizationId: ORG, programId, enabled: true, sendContractAfterIntake: false, sendWelcomeAfterContractSigned: false,
      activeContractTemplateId: `tpl-${programId}`, activeContractVersionId: `ver-${programId}`, activeWelcomeEmailVersionId: null,
    });
  };
  return { tables, db, controller, withAgreement };
}

const req = {} as never;

describe('program setup checklist', () => {
  it('reads the contract stage the way the journey editor does', () => {
    expect(journeyHasContractStage({ statusPipeline: DEFAULT_PIPELINE, defaultWorkflow: [] })).toBe(true);
    expect(journeyHasContractStage({ statusPipeline: NO_CONTRACT_PIPELINE, defaultWorkflow: [] })).toBe(false);
    expect(journeyHasContractStage({ statusPipeline: [], defaultWorkflow: ['Intake', 'Active'] })).toBe(false);
    expect(journeyHasContractStage({ statusPipeline: [], defaultWorkflow: ['Intake', 'Contract'] })).toBe(true);
    // Nothing recognizable means the default journey, which has a contract stage.
    expect(journeyHasContractStage({ statusPipeline: [], defaultWorkflow: [] })).toBe(true);
  });

  it('requires an enrollment agreement only when the program uses contracts', async () => {
    const { db, withAgreement } = setup();
    const withContracts = await programSetup(db, { id: 'p1', organizationId: ORG, isActive: false, defaultFormTemplateId: 'general-intake', statusPipeline: DEFAULT_PIPELINE, defaultWorkflow: [] });
    expect(withContracts.ready).toBe(false);
    expect(withContracts.missingRequired.map((item) => item.key)).toEqual(['enrollment_agreement']);

    const noContracts = await programSetup(db, { id: 'p2', organizationId: ORG, isActive: false, defaultFormTemplateId: 'form-1', statusPipeline: NO_CONTRACT_PIPELINE, defaultWorkflow: [] });
    expect(noContracts.ready).toBe(true);
    expect(noContracts.items.find((item) => item.key === 'enrollment_agreement')).toEqual(expect.objectContaining({ required: false }));

    withAgreement('p1');
    expect((await programSetup(db, { id: 'p1', organizationId: ORG, isActive: false, defaultFormTemplateId: 'general-intake', statusPipeline: DEFAULT_PIPELINE, defaultWorkflow: [] })).ready).toBe(true);
  });

  it('requires a welcome email only when it is sent automatically, and an intake form always', async () => {
    const { db, tables, withAgreement } = setup();
    withAgreement('p1');
    tables.cfProgramWorkflowConfig[0].sendWelcomeAfterContractSigned = true;
    const welcomeOn = await programSetup(db, { id: 'p1', organizationId: ORG, isActive: false, defaultFormTemplateId: 'general-intake', statusPipeline: DEFAULT_PIPELINE, defaultWorkflow: [] });
    expect(welcomeOn.missingRequired.map((item) => item.key)).toEqual(['welcome_email']);
    const noForm = await programSetup(db, { id: 'p1', organizationId: ORG, isActive: false, defaultFormTemplateId: 'deleted-form', statusPipeline: DEFAULT_PIPELINE, defaultWorkflow: [] });
    expect(noForm.missingRequired.map((item) => item.key)).toContain('intake_form');
  });

  it("counts only the program's own questions or the general intake as its intake", async () => {
    const { db } = setup();
    const base = { organizationId: ORG, isActive: false, statusPipeline: NO_CONTRACT_PIPELINE, defaultWorkflow: [] };
    const intakeOf = async (id: string, defaultFormTemplateId: string) =>
      (await programSetup(db, { ...base, id, defaultFormTemplateId })).items.find((item) => item.key === 'intake_form');
    // Questions it owns are shown on the public intake, whatever the program points at.
    expect(await intakeOf('p2', 'form-1')).toEqual(expect.objectContaining({ done: true }));
    expect(await intakeOf('p2', 'general-intake')).toEqual(expect.objectContaining({ done: true }));
    // General intake alone is a valid choice.
    expect(await intakeOf('p3', 'general-intake')).toEqual(expect.objectContaining({ done: true }));
    // A form that belongs to another program, or to none, is never shown for this one.
    expect(await intakeOf('p3', 'form-other')).toEqual(expect.objectContaining({ done: false }));
    expect(await intakeOf('p3', 'form-shared')).toEqual(expect.objectContaining({ done: false }));
  });

  it('accepts only the general intake or questions that belong to the program', async () => {
    const { db } = setup();
    await expect(assertIntakeChoice(db, ORG, null, 'general-intake')).resolves.toBeUndefined();
    await expect(assertIntakeChoice(db, ORG, 'p2', 'form-1')).resolves.toBeUndefined();
    await expect(assertIntakeChoice(db, ORG, 'p3', 'form-1')).rejects.toThrow('belong to this program');
    await expect(assertIntakeChoice(db, ORG, 'p3', 'form-shared')).rejects.toThrow('belong to this program');
    // A new program has no questions of its own yet.
    await expect(assertIntakeChoice(db, ORG, null, 'form-1')).rejects.toThrow('belong to this program');
    await expect(assertIntakeChoice(db, 'other-org', 'p2', 'form-1')).rejects.toThrow('belong to this program');
  });

  describe('activation', () => {
    it('will not create a program active before its setup is complete, but creates it inactive', async () => {
      const { controller, tables } = setup();
      await expect(controller.createProgram(req, { name: 'Coaching', defaultFormTemplateId: 'general-intake', statusPipeline: DEFAULT_PIPELINE, isActive: true }))
        .rejects.toThrow('Enrollment agreement');
      expect(tables.cfProgram).toHaveLength(0);
      // Without isActive the stored default would be active, so it is checked too.
      await expect(controller.createProgram(req, { name: 'Coaching', defaultFormTemplateId: 'general-intake', statusPipeline: DEFAULT_PIPELINE }))
        .rejects.toThrow('Finish setting up');
      const created = await controller.createProgram(req, { name: 'Coaching', defaultFormTemplateId: 'general-intake', statusPipeline: DEFAULT_PIPELINE, isActive: false });
      expect(created).toEqual(expect.objectContaining({ isActive: false }));
      // A program that doesn't use contracts can be created active straight away.
      await expect(controller.createProgram(req, { name: 'Workshop', defaultFormTemplateId: 'general-intake', statusPipeline: NO_CONTRACT_PIPELINE, isActive: true }))
        .resolves.toEqual(expect.objectContaining({ isActive: true }));
    });

    it('checks only a real inactive-to-active change, never edits to an active program', async () => {
      const { controller, withAgreement } = setup([
        { id: 'p-new', name: 'New', isActive: false },
        { id: 'p-live', name: 'Live', isActive: true },
      ]);
      await expect(controller.updateProgram(req, 'p-new', { isActive: true })).rejects.toThrow('Enrollment agreement');
      // An active program missing setup can still be edited (and stays active).
      await expect(controller.updateProgram(req, 'p-live', { name: 'Live (renamed)', isActive: true }))
        .resolves.toEqual(expect.objectContaining({ name: 'Live (renamed)', isActive: true }));
      withAgreement('p-new');
      await expect(controller.updateProgram(req, 'p-new', { isActive: true })).resolves.toEqual(expect.objectContaining({ isActive: true }));
    });

    it('reports setup per program for the list', async () => {
      const { controller, withAgreement } = setup([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      withAgreement('b');
      const summary = await controller.listProgramSetup(req);
      expect(summary).toEqual(expect.arrayContaining([
        expect.objectContaining({ programId: 'a', ready: false, missingRequired: ['Enrollment agreement'] }),
        expect.objectContaining({ programId: 'b', ready: true, missingRequired: [] }),
      ]));
    });
  });
});
