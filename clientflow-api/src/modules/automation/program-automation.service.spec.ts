import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ContractsService } from '../contracts/contracts.service';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import type { FormDeliveryService } from '../forms/form-delivery.service';
import { ProgramAutomationService, renderRuleText } from './program-automation.service';

// Shared test context: builds real WorkflowConfigService/EnrollmentsService instances against
// the same mocked `prisma` each test already configures, so existing prisma mocks/assertions
// keep working unchanged - only the canonical services now sit between automation and prisma.
function programAutomationTestContext(
  prisma: unknown,
  contracts: unknown,
  n8n: unknown,
  formDelivery?: unknown,
): ProgramAutomationService {
  // The program's "send contract after intake" setting is read on every intake trigger; tests
  // that don't configure it get a program with that setting off.
  const withWorkflow = prisma as Record<string, unknown>;
  withWorkflow.cfProgramWorkflowConfig ??= {
    findFirst: jest.fn().mockResolvedValue({ enabled: true, sendContractAfterIntake: false }),
  };
  return new ProgramAutomationService(
    prisma as unknown as PrismaService,
    contracts as ContractsService,
    n8n as unknown as N8nService,
    new WorkflowConfigService(prisma as unknown as PrismaService),
    new EnrollmentsService(prisma as unknown as PrismaService),
    formDelivery as FormDeliveryService | undefined,
  );
}

describe('ProgramAutomationService', () => {
  const baseClient = {
    id: 'client-1',
    email: 'client@example.com',
    primaryContactName: 'Client Owner',
    assignedUserId: 'admin-1',
    assignedStaff: 'Admin User',
    isDemo: false,
  };

  const baseProgram = {
    id: 'program-1',
    name: 'Program One',
    defaultFormTemplateId: 'form-1',
  };

  it('creates a task for create_task rules and records execution details', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(baseClient) },
      cfProgram: { findMany: jest.fn().mockResolvedValue([baseProgram]) },
      cfProgramAutomationRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-1',
            action: 'create_task',
            actionConfig: { title: 'Collect onboarding docs' },
            conditions: {},
          },
        ]),
      },
      cfProgramAutomationExecution: {
        create: jest.fn().mockResolvedValue({ id: 'exec-1' }),
        update: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      },
      cfTask: { create: jest.fn().mockResolvedValue({ id: 'task-1' }) },
    };

    const service = programAutomationTestContext(
      prisma,
      {} as ContractsService,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') },
    );

    await service.runTrigger({
      organizationId: 'org-1',
      clientId: 'client-1',
      trigger: 'intake.submitted',
      programIds: ['program-1'],
      enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      idempotencySeed: 'seed-1',
    });

    expect(prisma.cfTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        enrollmentId: 'enroll-1',
        title: 'Collect onboarding docs',
      }),
    }));
    expect(prisma.cfProgramAutomationExecution.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'exec-1' },
      data: expect.objectContaining({ details: expect.objectContaining({ taskId: 'task-1' }) }),
    }));
  });

  it('send_email rules send their own subject and message verbatim, tagged as an automation rule', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(baseClient) },
      cfProgram: { findMany: jest.fn().mockResolvedValue([baseProgram]) },
      cfProgramAutomationRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-9',
            action: 'send_email',
            actionConfig: { subject: 'Your first week', message: 'Hello, here is your first-week checklist.' },
            conditions: {},
          },
        ]),
      },
      cfProgramAutomationExecution: {
        create: jest.fn().mockResolvedValue({ id: 'exec-1' }),
        update: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      },
      cfCommunication: {
        create: jest.fn().mockResolvedValue({ id: 'comm-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const n8n = {
      getWelcomeAvailability: jest.fn().mockReturnValue('ready'),
      sendWelcome: jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2030-01-01T00:00:00.000Z' }),
    };
    const service = programAutomationTestContext(prisma, {} as ContractsService, n8n);

    await service.runTrigger({
      organizationId: 'org-1',
      clientId: 'client-1',
      trigger: 'intake.submitted',
      programIds: ['program-1'],
      enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      idempotencySeed: 'seed-9',
    });

    const payload = (n8n.sendWelcome.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(payload).toEqual(expect.objectContaining({
      subject: 'Your first week',
      body: 'Hello, here is your first-week checklist.',
      nextStep: 'Hello, here is your first-week checklist.',
      renderMode: 'verbatim',
      welcome: {
        source: 'automation_rule', templateId: null, templateName: null, versionId: null, versionNumber: null, ruleId: 'rule-9',
      },
    }));
    expect(prisma.cfCommunication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        renderedSubject: 'Your first week',
        renderedBody: 'Hello, here is your first-week checklist.',
        templateContext: { welcome: expect.objectContaining({ source: 'automation_rule', ruleId: 'rule-9' }) },
      }),
    });
  });

  it('creates an enrollment and logs ENROLLMENT_CREATED activity for create_enrollment rules', async () => {
    const transaction = {
      cfClient: { findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }) },
      cfProgram: { findFirst: jest.fn().mockResolvedValue({ id: 'program-1' }) },
      cfProgramEnrollment: { create: jest.fn().mockResolvedValue({ id: 'enroll-new' }) },
      cfEnrollmentStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-new' }) },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-new' }) },
    };
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(baseClient) },
      cfProgram: { findMany: jest.fn().mockResolvedValue([baseProgram]) },
      cfProgramAutomationRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-enroll',
            action: 'create_enrollment',
            actionConfig: {},
            conditions: {},
          },
        ]),
      },
      cfProgramAutomationExecution: {
        create: jest.fn().mockResolvedValue({ id: 'exec-enroll' }),
        update: jest.fn().mockResolvedValue({ id: 'exec-enroll' }),
      },
      cfProgramEnrollment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };

    const service = programAutomationTestContext(
      prisma,
      {} as ContractsService,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') },
    );

    await service.runTrigger({
      organizationId: 'org-1',
      clientId: 'client-1',
      trigger: 'intake.submitted',
      programIds: ['program-1'],
      idempotencySeed: 'seed-enroll',
    });

    expect(transaction.cfProgramEnrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: 'org-1', clientId: 'client-1', programId: 'program-1' }),
    }));
    expect(transaction.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1',
        clientId: 'client-1',
        enrollmentId: 'enroll-new',
        action: 'ENROLLMENT_CREATED',
        description: 'Enrolled in Program One.',
      }),
    }));
  });

  it('changes enrollment status and writes status history for change_status rules', async () => {
    const prisma: Record<string, any> = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(baseClient) },
      cfProgram: { findMany: jest.fn().mockResolvedValue([baseProgram]) },
      cfProgramAutomationRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-2',
            action: 'change_status',
            actionConfig: { status: 'onboarding' },
            conditions: {},
          },
        ]),
      },
      cfProgramAutomationExecution: {
        create: jest.fn().mockResolvedValue({ id: 'exec-2' }),
        update: jest.fn().mockResolvedValue({ id: 'exec-2' }),
      },
      cfProgramEnrollment: {
        findFirst: jest.fn().mockResolvedValue({ status: 'approved' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cfEnrollmentStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
      cfContract: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      cfFormAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      cfEnrollmentBillingAgreement: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown): Promise<unknown> => callback(prisma)),
    };

    const service = programAutomationTestContext(
      prisma,
      {} as ContractsService,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') },
    );

    await service.runTrigger({
      organizationId: 'org-1',
      clientId: 'client-1',
      trigger: 'enrollment.approved',
      programIds: ['program-1'],
      enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      idempotencySeed: 'seed-2',
      payload: { enrollmentStatus: 'approved' },
    });

    expect(prisma.cfProgramEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      // Conditional on the state it was read in, so a concurrent change can't be overwritten.
      where: { id: 'enroll-1', organizationId: 'org-1', status: 'approved' },
      data: expect.objectContaining({ status: 'onboarding' }),
    }));
    expect(prisma.cfEnrollmentStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        enrollmentId: 'enroll-1',
        previousStatus: 'approved',
        newStatus: 'onboarding',
      }),
    }));
  });

  it('falls back to seven days when send_form template dueInDays is null', async () => {
    const fixedNow = new Date('2030-01-01T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(fixedNow);
    try {
      const prisma = {
        cfClient: { findFirst: jest.fn().mockResolvedValue(baseClient) },
        cfProgram: { findMany: jest.fn().mockResolvedValue([baseProgram]) },
        cfProgramAutomationRule: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'rule-3',
              action: 'send_form',
              actionConfig: {},
              conditions: {},
            },
          ]),
        },
        cfProgramAutomationExecution: {
          create: jest.fn().mockResolvedValue({ id: 'exec-3' }),
          update: jest.fn().mockResolvedValue({ id: 'exec-3' }),
        },
        cfFormTemplate: {
          findFirst: jest.fn().mockResolvedValue({ id: 'form-1', dueInDays: null, isActive: true }),
        },
        cfFormAssignment: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
        },
      };

      const formDelivery = {
        createAssignment: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
        send: jest.fn().mockResolvedValue({ status: 'sent' }),
      };
      const service = programAutomationTestContext(
        prisma,
        {} as ContractsService,
        { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') },
        formDelivery,
      );

      await service.runTrigger({
        organizationId: 'org-1',
        clientId: 'client-1',
        trigger: 'intake.submitted',
        programIds: ['program-1'],
        enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
        idempotencySeed: 'seed-3',
      });

      // The form goes out the same way a staff send does: a real link and an email.
      expect(formDelivery.createAssignment).toHaveBeenCalledWith('org-1', expect.anything(), expect.objectContaining({
        clientId: 'client-1',
        formId: 'form-1',
        enrollmentId: 'enroll-1',
        deliveryMethod: 'automation',
        dueDate: '2030-01-08',
      }));
      expect(formDelivery.send).toHaveBeenCalledWith('org-1', expect.anything(), 'assignment-1', {
        idempotencyKey: expect.stringMatching(/^auto-form-[a-f0-9]{48}$/),
        source: 'automation',
      });
      expect(prisma.cfFormAssignment.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('sets pending staff review and logs activity for send_contract rules requiring approval', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(baseClient), update: jest.fn().mockResolvedValue({}) },
      cfProgram: { findMany: jest.fn().mockResolvedValue([baseProgram]) },
      cfProgramAutomationRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-4',
            action: 'send_contract',
            actionConfig: { requireStaffApproval: true },
            conditions: {},
          },
        ]),
      },
      cfProgramAutomationExecution: {
        create: jest.fn().mockResolvedValue({ id: 'exec-4' }),
        update: jest.fn().mockResolvedValue({ id: 'exec-4' }),
      },
      cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };

    const service = programAutomationTestContext(
      prisma,
      {} as ContractsService,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') },
    );

    await service.runTrigger({
      organizationId: 'org-1',
      clientId: 'client-1',
      trigger: 'intake.submitted',
      programIds: ['program-1'],
      enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      idempotencySeed: 'seed-4',
    });

    expect(prisma.cfClient.update).toHaveBeenCalledWith({
      where: { id: 'client-1' },
      data: { status: 'PENDING_STAFF_REVIEW' },
    });
    expect(prisma.cfActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'PENDING_STAFF_REVIEW',
        enrollmentId: 'enroll-1',
      }),
    }));
  });

  it('issues a contract when send_contract does not require staff approval', async () => {
    const prisma = {
      cfClient: { findFirst: jest.fn().mockResolvedValue(baseClient) },
      cfProgram: { findMany: jest.fn().mockResolvedValue([baseProgram]) },
      cfProgramAutomationRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-5',
            action: 'send_contract',
            actionConfig: {},
            conditions: {},
          },
        ]),
      },
      cfProgramAutomationExecution: {
        create: jest.fn().mockResolvedValue({ id: 'exec-5' }),
        update: jest.fn().mockResolvedValue({ id: 'exec-5' }),
      },
      cfContract: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const contracts = {
      issueContractForProgram: jest.fn().mockResolvedValue({
        contract: { id: 'contract-1', status: 'SENT' },
        emailDelivery: { status: 'sent' },
      }),
    };

    const service = programAutomationTestContext(
      prisma,
      contracts,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') },
    );

    await service.runTrigger({
      organizationId: 'org-1',
      clientId: 'client-1',
      trigger: 'intake.submitted',
      programIds: ['program-1'],
      enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      idempotencySeed: 'seed-5',
    });

    expect(contracts.issueContractForProgram).toHaveBeenCalledWith(
      'org-1',
      'client-1',
      'program-1',
      expect.objectContaining({
        enrollmentId: 'enroll-1',
      }),
    );
  });

  describe('the "send contract after intake" setting', () => {
    function build(rules: Array<{ id: string; action: string }>) {
      const prisma = {
        cfClient: { findFirst: jest.fn().mockResolvedValue(baseClient) },
        cfProgram: { findMany: jest.fn().mockResolvedValue([baseProgram]) },
        cfProgramAutomationRule: {
          findMany: jest.fn().mockResolvedValue(rules.map((rule) => ({ ...rule, actionConfig: {}, conditions: {} }))),
        },
        cfProgramAutomationExecution: {
          create: jest.fn().mockImplementation(async ({ data }: { data: { ruleId: string } }) => ({ id: `exec-${data.ruleId}` })),
          update: jest.fn().mockResolvedValue({}),
        },
        cfProgramWorkflowConfig: {
          findFirst: jest.fn().mockResolvedValue({ enabled: true, sendContractAfterIntake: true }),
        },
        cfContract: { findFirst: jest.fn().mockResolvedValue(null) },
        cfTask: { create: jest.fn().mockResolvedValue({ id: 'task-1' }) },
      };
      const contracts = {
        issueContractForProgram: jest.fn().mockResolvedValue({
          contract: { id: 'contract-1', status: 'SENT' },
          emailDelivery: { status: 'sent' },
        }),
      };
      const service = programAutomationTestContext(prisma, contracts, { getWelcomeAvailability: () => 'disabled' });
      const run = () => service.runTrigger({
        organizationId: 'org-1',
        clientId: 'client-1',
        trigger: 'intake.submitted',
        programIds: ['program-1'],
        enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
        idempotencySeed: 'seed-toggle',
      });
      return { prisma, contracts, run };
    }

    it('still sends the contract when the program also has other intake rules, and runs those rules', async () => {
      const { prisma, contracts, run } = build([{ id: 'rule-task', action: 'create_task' }]);
      const result = await run();
      expect(contracts.issueContractForProgram).toHaveBeenCalledTimes(1);
      expect(prisma.cfTask.create).toHaveBeenCalledTimes(1);
      expect(result.programs[0].actions).toEqual(['send_contract', 'create_task']);
    });

    it('leaves the contract to a send_contract rule, so only one contract goes out', async () => {
      const { contracts, run } = build([{ id: 'rule-contract', action: 'send_contract' }]);
      const result = await run();
      expect(contracts.issueContractForProgram).toHaveBeenCalledTimes(1);
      expect(result.programs[0].actions).toEqual(['send_contract']);
    });
  });
});

describe('renderRuleText', () => {
  it('fills every occurrence of known placeholders and leaves unknown ones', () => {
    expect(renderRuleText('Hi {{contactName}} — {{ programName }} / {{programName}} {{unknown}}', {
      contactName: 'Pat',
      programName: 'Grant',
    })).toBe('Hi Pat — Grant / Grant {{unknown}}');
  });

  it('keeps a placeholder whose value is empty rather than printing a blank', () => {
    expect(renderRuleText('For {{businessName}}', { businessName: '  ' })).toBe('For {{businessName}}');
  });
});
