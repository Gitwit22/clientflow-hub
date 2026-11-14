import { ScaffoldService } from '../../common/services/scaffold.service';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import { ClientflowCompatibilityController } from './compatibility.controller';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */

/** A program's custom automatic emails (automation rules with send_email). */
function setup() {
  const tables: Record<string, any[]> = {
    organization: [{ id: 'org-1', name: 'EA Management' }],
    cfProgram: [
      { id: 'program-1', organizationId: 'org-1', name: 'Grant', isActive: false },
      { id: 'program-2', organizationId: 'org-2', name: 'Elsewhere', isActive: false },
    ],
    cfProgramAutomationRule: [
      { id: 'rule-other-org', organizationId: 'org-2', programId: 'program-2', trigger: 'intake_submitted', action: 'send_email', actionConfig: { subject: 'x', message: 'y' } },
    ],
    cfProgramDocumentTemplate: [],
    cfProgramWorkflowConfig: [],
    cfProgramContractTemplate: [],
    cfProgramContractVersion: [],
    cfProgramWelcomeEmailTemplate: [],
    cfProgramWelcomeEmailVersion: [],
    cfCommunication: [],
    cfProgramAutomationExecution: [],
  };
  const db = inMemoryDb(tables) as any;
  const n8n = { sendWelcome: jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2030-01-01T00:00:00.000Z' }) };
  const controller = new ClientflowCompatibilityController(
    new ScaffoldService(), db, n8n as any, undefined, undefined, new WorkflowConfigService(db),
  );
  jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
    orgId: 'org-1',
    admin: { id: 'admin-1', email: 'jordan@example.org', firstName: 'Jordan', lastName: 'Lee' },
  });
  return { controller, tables, n8n };
}

const req = {} as never;
const email = (actionConfig: Record<string, unknown>, trigger = 'intake_submitted') => ({ trigger, action: 'send_email', actionConfig });

describe('custom automatic emails', () => {
  it('saves a custom email with its text trimmed, and lists the fields and triggers staff can use', async () => {
    const { controller, tables } = setup();
    await controller.createProgramAutomationRule(req, 'program-1', email({ subject: '  Thanks, {{client.businessName}} ', message: ' We got your intake. ' }));
    expect(tables.cfProgramAutomationRule.find((rule) => rule.programId === 'program-1').actionConfig)
      .toEqual({ subject: 'Thanks, {{client.businessName}}', message: 'We got your intake.' });

    const automation = await controller.getProgramAutomation(req, 'program-1');
    expect(automation.rules).toHaveLength(1);
    expect(automation.emailFields.map((field: { key: string }) => field.key)).toContain('organization.name');
    expect(automation.emailTriggers).toContainEqual({ trigger: 'contract_signed', label: 'When the agreement is signed' });
  });

  it('refuses a custom email with no subject or message, or a merge field it cannot fill', async () => {
    const { controller, tables } = setup();
    await expect(controller.createProgramAutomationRule(req, 'program-1', email({ subject: '', message: 'Hi' }))).rejects.toThrow('Add a subject');
    await expect(controller.createProgramAutomationRule(req, 'program-1', email({ subject: 'Hi', message: '   ' }))).rejects.toThrow('Add the message');
    await expect(controller.createProgramAutomationRule(req, 'program-1', email({ subject: 'Hi {{client.firstName}}', message: 'Hello' })))
      .rejects.toThrow('Unknown merge field: {{client.firstName}}');
    await expect(controller.createProgramAutomationRule(req, 'program-1', email({ subject: 'x'.repeat(201), message: 'Hello' }))).rejects.toThrow('under 200');
    expect(tables.cfProgramAutomationRule.filter((rule) => rule.programId === 'program-1')).toHaveLength(0);
  });

  it('checks the text again when a custom email is edited, and can switch it off', async () => {
    const { controller, tables } = setup();
    await controller.createProgramAutomationRule(req, 'program-1', email({ subject: 'Thanks', message: 'Got it' }));
    const rule = tables.cfProgramAutomationRule.find((row) => row.programId === 'program-1');
    await expect(controller.updateProgramAutomationRule(req, 'program-1', rule.id, { actionConfig: { subject: 'Thanks', message: '{{nope}}' } }))
      .rejects.toThrow('Unknown merge field');
    await controller.updateProgramAutomationRule(req, 'program-1', rule.id, { enabled: false });
    expect(rule.enabled).toBe(false);
    expect(rule.actionConfig).toEqual({ subject: 'Thanks', message: 'Got it' });
  });

  it("deletes a program's custom email, never another organization's", async () => {
    const { controller, tables } = setup();
    await controller.createProgramAutomationRule(req, 'program-1', email({ subject: 'Thanks', message: 'Got it' }));
    const rule = tables.cfProgramAutomationRule.find((row) => row.programId === 'program-1');
    await expect(controller.deleteProgramAutomationRule(req, 'program-1', rule.id)).resolves.toEqual({ deleted: true, id: rule.id });
    expect(tables.cfProgramAutomationRule.map((row) => row.id)).toEqual(['rule-other-org']);
    await expect(controller.deleteProgramAutomationRule(req, 'program-1', 'rule-other-org')).rejects.toThrow('not found');
    expect(tables.cfProgramAutomationRule).toHaveLength(1);
  });

  it('sends a test to the staff member with sample details, and records nothing', async () => {
    const { controller, tables, n8n } = setup();
    const result = await controller.sendProgramAutomationEmailTest(req, 'program-1', {
      subject: 'Welcome, {{client.businessName}}',
      message: 'From {{organization.name}}: {{program.name}} starts soon. — {{staff.name}}',
    });
    expect(result.recipientEmail).toBe('jordan@example.org');
    const [eventId, payload] = n8n.sendWelcome.mock.calls[0];
    expect(eventId).toMatch(/^automation\.email\.test:/);
    expect(payload).toEqual(expect.objectContaining({
      recipientEmail: 'jordan@example.org',
      subject: '[Test] Welcome, Rivers Bakery LLC',
      body: 'From EA Management: Grant starts soon. — Jordan Lee',
      renderMode: 'verbatim',
    }));
    expect(tables.cfCommunication).toHaveLength(0);
    expect(tables.cfProgramAutomationExecution).toHaveLength(0);
  });

  it('shows no agreement or welcome email as active until one is designated', async () => {
    const { controller, tables } = setup();
    tables.cfProgramContractTemplate.push({ id: 'tpl-1', organizationId: 'org-1', programId: 'program-1', name: 'Agreement', purpose: 'enrollment', isActive: true, createdAt: new Date() });
    tables.cfProgramContractVersion.push({ id: 'ver-1', organizationId: 'org-1', templateId: 'tpl-1', version: 1, content: 'Text', createdAt: new Date() });
    tables.cfProgramWelcomeEmailTemplate.push({ id: 'wel-1', organizationId: 'org-1', programId: 'program-1', name: 'Welcome', isActive: true, createdAt: new Date() });
    tables.cfProgramWelcomeEmailVersion.push({ id: 'wv-1', organizationId: 'org-1', templateId: 'wel-1', version: 1, subject: 'Hi', body: 'Hello', createdAt: new Date() });
    const workflow = await controller.getProgramWorkflowConfig(req, 'program-1');
    expect(workflow.contract.activeTemplate).toBeNull();
    expect(workflow.contract.activeVersion).toBeNull();
    expect(workflow.welcomeEmail.activeVersion).toBeNull();
  });
});
