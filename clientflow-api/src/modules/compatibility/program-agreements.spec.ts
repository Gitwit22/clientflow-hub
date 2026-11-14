import { ScaffoldService } from '../../common/services/scaffold.service';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import { ClientflowCompatibilityController } from './compatibility.controller';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */

/** Program agreement templates: several per program, one of them the enrollment agreement. */
function setup(tables: Record<string, Array<Record<string, unknown>>> = {}) {
  const now = new Date('2026-11-01T00:00:00.000Z');
  const db = inMemoryDb({
    cfProgram: [{ id: 'program-1', organizationId: 'org-1', name: 'IDI', isActive: true }],
    cfProgramWorkflowConfig: [],
    cfProgramContractTemplate: [],
    cfProgramContractVersion: [],
    cfProgramWelcomeEmailTemplate: [],
    cfProgramWelcomeEmailVersion: [],
    ...tables,
  }) as any;
  // Prisma fills defaults and timestamps; the in-memory stand-in doesn't.
  const create = (model: string, defaults: Record<string, unknown>) => {
    const original = db[model].create.bind(db[model]);
    db[model].create = ({ data }: { data: Record<string, unknown> }) =>
      original({ data: { id: `${model}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now, ...defaults, ...data } });
  };
  create('cfProgramContractTemplate', { purpose: 'enrollment', isActive: true, activeVersionId: null });
  create('cfProgramContractVersion', {});
  create('cfProgramWorkflowConfig', { activeContractTemplateId: null, activeContractVersionId: null });
  const controller = new ClientflowCompatibilityController(
    new ScaffoldService(), db, undefined, undefined, undefined, new WorkflowConfigService(db),
  );
  jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({ orgId: 'org-1', admin: { id: 'admin-1', email: 'staff@example.org' } });
  return { controller, db };
}

const req = {} as never;

describe('program agreement templates', () => {
  it("makes a program's first agreement its enrollment agreement, so contracts can be sent right away", async () => {
    const { controller, db } = setup();
    const workflow = await controller.createProgramWorkflowContractTemplate(req, 'program-1', {
      name: 'Membership Agreement', content: 'Welcome {{client.businessName}}.',
    });
    const [template] = db.cfProgramContractTemplate.rows ?? (await db.cfProgramContractTemplate.findMany({}));
    expect(workflow.config.activeContractTemplateId).toBe(template.id);
    expect(workflow.contract.activeVersion?.content).toBe('Welcome {{client.businessName}}.');
    expect(template.activeVersionId).toBe(workflow.config.activeContractVersionId);
  });

  it('adds an award agreement without touching the enrollment agreement', async () => {
    const { controller } = setup();
    const first = await controller.createProgramWorkflowContractTemplate(req, 'program-1', { name: 'Membership Agreement', content: 'Join.' });
    const after = await controller.createProgramWorkflowContractTemplate(req, 'program-1', {
      name: 'Member Fund Award Agreement', purpose: 'award', content: 'Award of {{award.amount}} to {{client.businessName}}.',
    });
    expect(after.config.activeContractTemplateId).toBe(first.config.activeContractTemplateId);
    expect(after.contract.activeTemplate?.name).toBe('Membership Agreement');
    const award = after.contract.templates.find((template: { purpose: string }) => template.purpose === 'award');
    expect(award).toEqual(expect.objectContaining({ name: 'Member Fund Award Agreement', activeVersionId: expect.any(String) }));
  });

  it('rejects unknown merge fields and award fields in an enrollment agreement when saving', async () => {
    const { controller } = setup();
    await expect(controller.createProgramWorkflowContractTemplate(req, 'program-1', { name: 'A', content: 'Hi {{client.bizname}}' }))
      .rejects.toThrow('Unknown merge field');
    await expect(controller.createProgramWorkflowContractTemplate(req, 'program-1', { name: 'B', content: 'Amount {{award.amount}}' }))
      .rejects.toThrow('only be used in award agreements');
  });

  it('never lets an award template become the enrollment agreement', async () => {
    const { controller } = setup();
    const workflow = await controller.createProgramWorkflowContractTemplate(req, 'program-1', { name: 'Award', purpose: 'award', content: 'Award {{award.amount}}' });
    const award = workflow.contract.templates[0];
    // No enrollment agreement exists, and the award template is not used as a fallback for one.
    expect(workflow.config.activeContractTemplateId).toBeNull();
    expect(workflow.contract.activeTemplate).toBeNull();
    expect(workflow.contract.activeVersion).toBeNull();
    await expect(controller.updateProgramWorkflowConfig(req, 'program-1', { activeContractTemplateId: award.id, activeContractVersionId: award.activeVersionId }))
      .rejects.toThrow('cannot be the enrollment agreement');
  });

  it("refuses to turn the enrollment agreement into an award template or hide it", async () => {
    const { controller } = setup();
    const workflow = await controller.createProgramWorkflowContractTemplate(req, 'program-1', { name: 'Membership Agreement', content: 'Join.' });
    const id = workflow.config.activeContractTemplateId as string;
    await expect(controller.updateProgramWorkflowContractTemplate(req, 'program-1', id, { purpose: 'award' }))
      .rejects.toThrow('enrollment agreement');
    await expect(controller.updateProgramWorkflowContractTemplate(req, 'program-1', id, { isActive: false }))
      .rejects.toThrow('enrollment agreement');
  });

  it("keeps an award template's own active version, separate from the enrollment agreement", async () => {
    const { controller } = setup();
    const enrollment = await controller.createProgramWorkflowContractTemplate(req, 'program-1', { name: 'Membership Agreement', content: 'Join.' });
    const created = await controller.createProgramWorkflowContractTemplate(req, 'program-1', { name: 'Award', purpose: 'award', content: 'v1 {{award.amount}}' });
    const award = created.contract.templates.find((template: { purpose: string }) => template.purpose === 'award')!;
    const updated = await controller.createProgramWorkflowContractVersion(req, 'program-1', award.id, { content: 'v2 {{award.amount}}' });
    const awardAfter = updated.contract.templates.find((template: { id: string }) => template.id === award.id)!;
    const v2 = updated.contract.versions.find((version: { content: string }) => version.content === 'v2 {{award.amount}}')!;
    expect(awardAfter.activeVersionId).toBe(v2.id);
    expect(updated.config.activeContractTemplateId).toBe(enrollment.config.activeContractTemplateId);
    expect(updated.config.activeContractVersionId).toBe(enrollment.config.activeContractVersionId);
  });

  it("makes a program's first welcome email its active one, and leaves an existing choice alone", async () => {
    const { controller, db } = setup();
    const created = db.cfProgramWelcomeEmailTemplate.create.bind(db.cfProgramWelcomeEmailTemplate);
    db.cfProgramWelcomeEmailTemplate.create = ({ data }: any) => created({ data: { id: `wt-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), ...data } });
    const createdVersion = db.cfProgramWelcomeEmailVersion.create.bind(db.cfProgramWelcomeEmailVersion);
    db.cfProgramWelcomeEmailVersion.create = ({ data }: any) => createdVersion({ data: { id: `wv-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), ...data } });
    const first = await controller.createProgramWorkflowWelcomeTemplate(req, 'program-1', { subject: 'Welcome', body: 'Welcome aboard' });
    expect(first.config.activeWelcomeEmailVersionId).toEqual(expect.any(String));
    const second = await controller.createProgramWorkflowWelcomeTemplate(req, 'program-1', { name: 'Alt welcome', subject: 'Hi', body: 'Other' });
    expect(second.config.activeWelcomeEmailVersionId).toBe(first.config.activeWelcomeEmailVersionId);
  });
});
