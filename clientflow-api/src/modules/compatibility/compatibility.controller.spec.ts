import { NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import type { ProgramAutomationService } from '../automation/program-automation.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { ClientflowCompatibilityController, PublicFormCompatibilityController } from './compatibility.controller';
import { COMPATIBILITY_ROUTE_GROUPS, FUTURE_ROUTE_GROUPS } from './route-inventory';

describe('compatibility route scaffold', () => {
  const scaffold = new ScaffoldService();

  it('keeps the ClientFlow compatibility route groups', () => {
    expect(COMPATIBILITY_ROUTE_GROUPS).toEqual({
      auth: '/api/v1/auth',
      organizations: '/api/v1/organizations',
      clientflowAdmin: '/api/v1/admin/cf',
      publicForms: '/api/v1/public/form',
    });
  });

  describe('ClientflowCompatibilityController automation hooks', () => {
    it('runs enrollment.created automation and returns the created enrollment', async () => {
      const scaffold = new ScaffoldService();
      const enrollment = {
        id: 'enroll-1',
        clientId: 'client-1',
        programId: 'program-1',
        organizationId: 'org-1',
        status: 'interested',
      };
      const transaction = {
        cfProgramEnrollment: { create: jest.fn().mockResolvedValue(enrollment) },
        cfEnrollmentStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
        cfActivityLog: { create: jest.fn().mockResolvedValue({ id: 'activity-1' }) },
      };
      const prisma = {
        $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
      };
      const automation = { runTrigger: jest.fn().mockResolvedValue({}) } as unknown as ProgramAutomationService;
      const enrollments = new EnrollmentsService(prisma as never);
      const controller = new ClientflowCompatibilityController(
        scaffold,
        prisma as never,
        undefined,
        automation,
        undefined,
        undefined,
        enrollments,
      );
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com', firstName: 'Admin', lastName: 'User' },
      });

      const result = await controller.createEnrollment({} as never, { clientId: 'client-1', programId: 'program-1' });

      expect(transaction.cfProgramEnrollment.create).toHaveBeenCalled();
      expect(automation.runTrigger).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'org-1',
        clientId: 'client-1',
        trigger: 'enrollment.created',
        programIds: ['program-1'],
        enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      }));
      expect(result).toEqual(enrollment);
    });

    it('rejects direct client status mutation through the generic update endpoint', async () => {
      const prisma = {
        cfClient: { update: jest.fn() },
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com' },
      });

      await expect(controller.updateClient({} as never, 'client-1', { status: 'ONBOARDING' }))
        .rejects.toThrow('Client workflow statuses cannot be changed through the generic update endpoint.');
      expect(prisma.cfClient.update).not.toHaveBeenCalled();
    });

    it('rejects direct enrollment status mutation through the generic update endpoint', async () => {
      const prisma = {
        cfProgramEnrollment: {
          findFirst: jest.fn().mockResolvedValue({ id: 'enroll-1', organizationId: 'org-1', status: 'interested' }),
          update: jest.fn(),
        },
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com' },
      });

      await expect(controller.updateEnrollment({} as never, 'enroll-1', { status: 'approved' }))
        .rejects.toThrow('Enrollment status changes must use the transition endpoint.');
      expect(prisma.cfProgramEnrollment.update).not.toHaveBeenCalled();
    });

    it('returns safe empty workflow selections when optional configuration is absent', async () => {
      const prisma = {
        cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(null) },
        cfProgramContractTemplate: { findMany: jest.fn().mockResolvedValue([]) },
        cfProgramWelcomeEmailTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);

      const result = await (controller as any).getProgramWorkflow('org-1', 'program-legacy');

      expect(result.config).toEqual(expect.objectContaining({
        enabled: true,
        sendContractAfterIntake: false,
        sendWelcomeAfterContractSigned: false,
      }));
      expect(result.contract).toEqual({
        templates: [],
        versions: [],
        activeTemplate: null,
        activeVersion: null,
      });
      expect(result.welcomeEmail).toEqual({
        templates: [],
        versions: [],
        activeTemplate: null,
        activeVersion: null,
      });
    });

    it('resolves configured contract and welcome versions independently', async () => {
      const contractTemplate = { id: 'contract-template-1', createdAt: new Date('2030-01-01') };
      const welcomeTemplate = { id: 'welcome-template-1', createdAt: new Date('2030-01-01') };
      const prisma = {
        cfProgramWorkflowConfig: {
          findFirst: jest.fn().mockResolvedValue({
            enabled: true,
            sendContractAfterIntake: true,
            sendWelcomeAfterContractSigned: true,
            activeContractTemplateId: contractTemplate.id,
            activeContractVersionId: 'contract-version-1',
            activeWelcomeEmailTemplateId: welcomeTemplate.id,
            activeWelcomeEmailVersionId: 'welcome-version-1',
          }),
        },
        cfProgramContractTemplate: { findMany: jest.fn().mockResolvedValue([contractTemplate]) },
        cfProgramWelcomeEmailTemplate: { findMany: jest.fn().mockResolvedValue([welcomeTemplate]) },
        cfProgramContractVersion: {
          findMany: jest.fn().mockResolvedValue([{ id: 'contract-version-1', templateId: contractTemplate.id }]),
        },
        cfProgramWelcomeEmailVersion: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);

      const result = await (controller as any).getProgramWorkflow('org-1', 'program-1');

      expect(result.contract.activeTemplate).toEqual(contractTemplate);
      expect(result.contract.activeVersion).toEqual({ id: 'contract-version-1', templateId: contractTemplate.id });
      expect(result.welcomeEmail.activeTemplate).toEqual(welcomeTemplate);
      expect(result.welcomeEmail.activeVersion).toBeNull();
    });

    it('passes bounded pagination to communications queries', async () => {
      const prisma = { cfCommunication: { findMany: jest.fn().mockResolvedValue([]) } };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({ orgId: 'org-1' });

      await controller.listAllCommunications({} as never, '500', '500');

      expect(prisma.cfCommunication.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        skip: 500,
      });
    });

    it('returns program detail for a legacy program without workflow records', async () => {
      const program = { id: 'program-legacy', organizationId: 'org-1', name: 'Legacy Program' };
      const prisma = {
        cfProgram: { findFirst: jest.fn().mockResolvedValue(program) },
        cfProgramEnrollment: { findMany: jest.fn().mockResolvedValue([]) },
        cfClient: { findMany: jest.fn().mockResolvedValue([]) },
        cfFormAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        cfFormTemplate: { findMany: jest.fn().mockResolvedValue([]) },
        cfTerms: { findMany: jest.fn().mockResolvedValue([]) },
        cfContract: { findMany: jest.fn().mockResolvedValue([]) },
        cfEnrollmentMonitoring: { findMany: jest.fn().mockResolvedValue([]) },
        cfEnrollmentStatusHistory: { findMany: jest.fn().mockResolvedValue([]) },
        cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(null) },
        cfProgramContractTemplate: { findMany: jest.fn().mockResolvedValue([]) },
        cfProgramWelcomeEmailTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({ orgId: 'org-1' });

      const result = await controller.getProgramDetail({} as never, 'program-legacy');

      expect(result.program).toEqual(program);
      expect(result.workflow.config).toEqual(expect.objectContaining({
        sendContractAfterIntake: false,
        sendWelcomeAfterContractSigned: false,
      }));
      expect(result.participants).toEqual([]);
    });

    it('rejects a nonexistent program before querying workflow configuration', async () => {
      const prisma = {
        cfProgram: { findFirst: jest.fn().mockResolvedValue(null) },
        cfProgramWorkflowConfig: { findFirst: jest.fn() },
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({ orgId: 'org-1' });

      await expect(controller.getProgramDetail({} as never, 'missing-program'))
        .rejects.toThrow('Program not found.');
      expect(prisma.cfProgramWorkflowConfig.findFirst).not.toHaveBeenCalled();
    });

    it('allocates next document version inside a transaction lock and activates it', async () => {
      const scaffold = new ScaffoldService();
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        cfProgramDocumentVersion: {
          findFirst: jest.fn().mockResolvedValue({ version: 1 }),
          create: jest.fn().mockResolvedValue({ id: 'version-2', version: 2 }),
        },
        cfProgramDocumentTemplate: { update: jest.fn().mockResolvedValue({ id: 'template-1' }) },
      };
      const prisma = {
        cfProgramDocumentTemplate: { findFirst: jest.fn().mockResolvedValue({ id: 'template-1' }) },
        $transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com' },
      });

      const result = await controller.createProgramDocumentVersion(
        {} as never,
        'program-1',
        'template-1',
        { fileUrl: 'https://example.com/doc.pdf' },
      );

      expect(transaction.$queryRaw).toHaveBeenCalled();
      expect(transaction.cfProgramDocumentVersion.findFirst).toHaveBeenCalled();
      expect(transaction.cfProgramDocumentTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: { activeVersionId: 'version-2' },
      });
      expect(result).toEqual(expect.objectContaining({ id: 'version-2' }));
    });
  });

  it('tracks the requested standalone route groups', () => {
    expect(FUTURE_ROUTE_GROUPS).toContain('public/contracts');
    expect(FUTURE_ROUTE_GROUPS).toContain('webhooks/n8n');
    expect(FUTURE_ROUTE_GROUPS).toContain('audit');
  });

  it('enforces authentication before accessing admin data and fails unconfigured public storage', async () => {
    await expect(new ClientflowCompatibilityController(scaffold).listClients({ headers: {} } as never))
      .rejects.toThrow(UnauthorizedException);
    await expect(new PublicFormCompatibilityController(scaffold).getForm('form-token'))
      .rejects.toThrow(NotImplementedException);
  });
});
