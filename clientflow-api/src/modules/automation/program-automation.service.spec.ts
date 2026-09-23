import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ContractsService } from '../contracts/contracts.service';
import { ProgramAutomationService } from './program-automation.service';

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

    const service = new ProgramAutomationService(
      prisma as unknown as PrismaService,
      {} as ContractsService,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') } as unknown as N8nService,
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

  it('changes enrollment status and writes status history for change_status rules', async () => {
    const prisma = {
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
    };

    const service = new ProgramAutomationService(
      prisma as unknown as PrismaService,
      {} as ContractsService,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') } as unknown as N8nService,
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
      where: { id: 'enroll-1', organizationId: 'org-1' },
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

    const service = new ProgramAutomationService(
      prisma as unknown as PrismaService,
      {} as ContractsService,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') } as unknown as N8nService,
    );

    await service.runTrigger({
      organizationId: 'org-1',
      clientId: 'client-1',
      trigger: 'intake.submitted',
      programIds: ['program-1'],
      enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      idempotencySeed: 'seed-3',
    });

    expect(prisma.cfFormAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        dueDate: '2030-01-08',
      }),
    }));
    jest.useRealTimers();
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

    const service = new ProgramAutomationService(
      prisma as unknown as PrismaService,
      {} as ContractsService,
      { getWelcomeAvailability: jest.fn().mockReturnValue('disabled') } as unknown as N8nService,
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
});
