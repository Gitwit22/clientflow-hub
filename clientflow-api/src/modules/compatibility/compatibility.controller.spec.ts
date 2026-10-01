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
        cfClient: { findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }) },
        cfProgram: { findFirst: jest.fn().mockResolvedValue({ id: 'program-1' }) },
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

    it('rejects moving a client into a workflow status by hand, but accepts the status it already has', async () => {
      const prisma: Record<string, any> = {
        cfClient: {
          update: jest.fn().mockResolvedValue({ id: 'client-1' }),
          findFirst: jest.fn().mockResolvedValue({ id: 'client-1', organizationId: 'org-1', status: 'PROGRAM_SELECTED', isArchived: false, archivedAt: null }),
        },
        $transaction: jest.fn(async (callback: (value: unknown) => unknown) => callback(prisma)),
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com' },
      });

      await expect(controller.updateClient({} as never, 'client-1', { status: 'ONBOARDING' }))
        .rejects.toThrow('That status is set by the intake and contract workflow');
      expect(prisma.cfClient.update).not.toHaveBeenCalled();

      // The Edit client form sends the whole profile back, unchanged status included.
      await controller.updateClient({} as never, 'client-1', { status: 'PROGRAM_SELECTED', phone: '313-555-0100' });
      expect(prisma.cfClient.update).toHaveBeenCalledWith({
        where: { id: 'client-1', organizationId: 'org-1' },
        data: { phone: '313-555-0100' },
      });
    });

    it('never passes an arbitrary request body to Prisma from the generic client update', async () => {
      const prisma: Record<string, any> = {
        cfClient: {
          update: jest.fn().mockResolvedValue({ id: 'client-1' }),
          findFirst: jest.fn().mockResolvedValue({ id: 'client-1', organizationId: 'org-1', isArchived: false, archivedAt: null }),
        },
        $transaction: jest.fn(async (callback: (value: unknown) => unknown) => callback(prisma)),
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com' },
      });

      await expect(controller.updateClient({} as never, 'client-1', { organizationId: 'org-2', intake: {} }))
        .rejects.toThrow('These fields cannot be updated on a client: organizationId, intake.');
      expect(prisma.cfClient.update).not.toHaveBeenCalled();

      await controller.updateClient({} as never, 'client-1', { businessName: 'New Name', nextFollowUpDate: '' });
      expect(prisma.cfClient.update).toHaveBeenCalledWith({
        where: { id: 'client-1', organizationId: 'org-1' },
        data: { businessName: 'New Name', nextFollowUpDate: null },
      });
    });

    it('delegates apply-form-responses to the form profile service with the staff actor', async () => {
      const formProfile = {
        preview: jest.fn().mockResolvedValue([{ key: 'email' }]),
        apply: jest.fn().mockResolvedValue({ applied: ['email'] }),
      };
      const controller = new ClientflowCompatibilityController(
        scaffold, undefined, undefined, undefined, undefined, undefined, undefined, formProfile as never,
      );
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com', firstName: 'Jordan', lastName: 'Lee' },
      });

      await controller.previewApplyFormResponses({} as never, 'client-1', { assignmentId: 'a-1' });
      await controller.applyFormResponses({} as never, 'client-1', { assignmentId: 'a-1', fields: ['email'] });

      expect(formProfile.preview).toHaveBeenCalledWith('org-1', 'client-1', 'a-1');
      expect(formProfile.apply).toHaveBeenCalledWith(
        'org-1', { id: 'admin-1', displayName: 'Jordan Lee' }, 'client-1', 'a-1', ['email'],
      );
    });

    it('delegates form assignment create and send to the form delivery service with the staff actor', async () => {
      const formDelivery = {
        createAssignment: jest.fn().mockResolvedValue({ id: 'assign-1' }),
        send: jest.fn().mockResolvedValue({ success: true }),
      };
      const controller = new ClientflowCompatibilityController(
        scaffold, undefined, undefined, undefined, undefined, undefined, undefined, undefined, formDelivery as never,
      );
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com', firstName: 'Jordan', lastName: 'Lee' },
      });

      await controller.createFormAssignment({} as never, { clientId: 'client-1', formId: 'form-1', enrollmentId: 'e-1' });
      await controller.sendFormAssignment(
        { headers: { 'idempotency-key': 'attempt-0001-abcd' } } as never,
        'assign-1',
        { personalMessage: 'Hi' },
      );

      expect(formDelivery.createAssignment).toHaveBeenCalledWith(
        'org-1',
        { id: 'admin-1', displayName: 'Jordan Lee' },
        { clientId: 'client-1', formId: 'form-1', enrollmentId: 'e-1' },
      );
      expect(formDelivery.send).toHaveBeenCalledWith(
        'org-1',
        { id: 'admin-1', displayName: 'Jordan Lee' },
        'assign-1',
        { personalMessage: 'Hi', idempotencyKey: 'attempt-0001-abcd' },
      );
    });

    it('rejects a malformed Idempotency-Key on the form send', async () => {
      const formDelivery = { send: jest.fn() };
      const controller = new ClientflowCompatibilityController(
        scaffold, undefined, undefined, undefined, undefined, undefined, undefined, undefined, formDelivery as never,
      );
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com' },
      });
      await expect(controller.sendFormAssignment(
        { headers: { 'idempotency-key': 'x' } } as never, 'assign-1', {},
      )).rejects.toThrow('Idempotency-Key must be 8-128 characters');
      expect(formDelivery.send).not.toHaveBeenCalled();
    });

    it('cascades an assignment change onto the client\'s still-open enrollments', async () => {
      const updatedClient = { id: 'client-1', organizationId: 'org-1', assignedUserId: 'user-2', assignedStaff: 'Jordan Staff' };
      const prisma: Record<string, any> = {
        cfClient: {
          update: jest.fn().mockResolvedValue(updatedClient),
          findFirst: jest.fn().mockResolvedValue({ id: 'client-1', organizationId: 'org-1', isArchived: false, archivedAt: null }),
        },
        $transaction: jest.fn(async (callback: (value: unknown) => unknown) => callback(prisma)),
        cfProgramEnrollment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      const enrollments = new EnrollmentsService(prisma as never);
      const controller = new ClientflowCompatibilityController(
        scaffold,
        prisma as never,
        undefined,
        undefined,
        undefined,
        undefined,
        enrollments,
      );
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com' },
      });

      await controller.updateClient({} as never, 'client-1', { assignedUserId: 'user-2', assignedStaff: 'Jordan Staff' });

      expect(prisma.cfProgramEnrollment.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', clientId: 'client-1', status: { notIn: ['completed', 'declined', 'withdrawn'] } },
        data: { assignedUserId: 'user-2', assignedStaff: 'Jordan Staff' },
      });
    });

    it('does not cascade to enrollments when the update has no assignment fields', async () => {
      const updatedClient = { id: 'client-1', organizationId: 'org-1' };
      const prisma: Record<string, any> = {
        cfClient: {
          update: jest.fn().mockResolvedValue(updatedClient),
          findFirst: jest.fn().mockResolvedValue({ id: 'client-1', organizationId: 'org-1', isArchived: false, archivedAt: null }),
        },
        $transaction: jest.fn(async (callback: (value: unknown) => unknown) => callback(prisma)),
        cfProgramEnrollment: { updateMany: jest.fn() },
      };
      const enrollments = new EnrollmentsService(prisma as never);
      const controller = new ClientflowCompatibilityController(
        scaffold,
        prisma as never,
        undefined,
        undefined,
        undefined,
        undefined,
        enrollments,
      );
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com' },
      });

      await controller.updateClient({} as never, 'client-1', { businessName: 'New Name' });

      expect(prisma.cfProgramEnrollment.updateMany).not.toHaveBeenCalled();
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

    it('no longer exposes direct contract mutation endpoints (createContract/updateContract removed)', () => {
      const controller = new ClientflowCompatibilityController(scaffold, {} as never);

      expect((controller as any).createContract).toBeUndefined();
      expect((controller as any).updateContract).toBeUndefined();
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

    it('keeps the deprecated automation mirror exactly equal to config, never independently defaulted', async () => {
      const prisma = {
        cfProgramWorkflowConfig: {
          findFirst: jest.fn().mockResolvedValue({
            enabled: false,
            sendContractAfterIntake: true,
            sendWelcomeAfterContractSigned: false,
          }),
        },
        cfProgramContractTemplate: { findMany: jest.fn().mockResolvedValue([]) },
        cfProgramWelcomeEmailTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);

      const result = await (controller as any).getProgramWorkflow('org-1', 'program-1');

      expect(result.automation).toEqual({
        sendContractAfterIntake: result.config.sendContractAfterIntake,
        sendWelcomeAfterContractSigned: result.config.sendWelcomeAfterContractSigned,
      });
      expect(result.automation).toEqual({
        sendContractAfterIntake: true,
        sendWelcomeAfterContractSigned: false,
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
        cfCommunication: { findMany: jest.fn().mockResolvedValue([]) },
        cfIntakeSubmissionProgram: { findMany: jest.fn().mockResolvedValue([]) },
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

    it("shows each participant's intake and form answers, labelled from the form", async () => {
      const program = { id: 'program-1', organizationId: 'org-1', name: 'Grant' };
      const enrollment = { id: 'enroll-1', clientId: 'client-1', programId: 'program-1', status: 'active' };
      const submittedAt = new Date('2030-01-02T00:00:00.000Z');
      const prisma = {
        cfProgram: { findFirst: jest.fn().mockResolvedValue(program) },
        cfProgramEnrollment: { findMany: jest.fn().mockResolvedValue([enrollment]) },
        cfClient: { findMany: jest.fn().mockResolvedValue([{ id: 'client-1', businessName: 'Acme' }]) },
        cfFormAssignment: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'fa-1', formId: 'form-1', enrollmentId: 'enroll-1', status: 'submitted', responses: { goal: 'Grow' } },
          ]),
        },
        cfFormTemplate: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'form-1', name: 'Check-in', fields: [{ id: 'goal', label: 'Main goal', type: 'text' }] },
          ]),
        },
        cfTerms: { findMany: jest.fn().mockResolvedValue([]) },
        cfContract: { findMany: jest.fn().mockResolvedValue([]) },
        cfEnrollmentMonitoring: { findMany: jest.fn().mockResolvedValue([]) },
        cfEnrollmentStatusHistory: { findMany: jest.fn().mockResolvedValue([]) },
        cfCommunication: { findMany: jest.fn().mockResolvedValue([]) },
        cfIntakeSubmissionProgram: {
          findMany: jest.fn().mockResolvedValue([
            { intakeSubmissionId: 'sub-1', enrollmentId: 'enroll-1', programId: 'program-1', responsePayload: { revenue: 5000 } },
          ]),
        },
        cfIntakeSubmission: {
          findMany: jest.fn().mockResolvedValue([{ id: 'sub-1', responsePayload: { name: 'Pat' }, submittedAt }]),
        },
        cfIntakeSubmissionSnapshot: {
          findMany: jest.fn().mockResolvedValue([{
            intakeSubmissionId: 'sub-1',
            renderedSections: [
              { kind: 'core', title: 'About you', fields: [{ id: 'name', label: 'Your name', type: 'text' }] },
              { kind: 'program', programId: 'program-1', title: 'Grant questions', fields: [{ id: 'revenue', label: 'Revenue', type: 'number' }] },
            ],
          }]),
        },
        cfProgramWorkflowConfig: { findFirst: jest.fn().mockResolvedValue(null) },
        cfProgramContractTemplate: { findMany: jest.fn().mockResolvedValue([]) },
        cfProgramWelcomeEmailTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const controller = new ClientflowCompatibilityController(scaffold, prisma as never);
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({ orgId: 'org-1' });

      const [participant] = (await controller.getProgramDetail({} as never, 'program-1')).participants;

      expect(participant.coreIntake).toEqual([expect.objectContaining({
        title: 'About you', submittedAt, answers: [{ fieldId: 'name', label: 'Your name', type: 'text', value: 'Pat' }],
      })]);
      expect(participant.programIntake).toEqual([expect.objectContaining({
        title: 'Grant questions', answers: [{ fieldId: 'revenue', label: 'Revenue', type: 'number', value: 5000 }],
      })]);
      expect(participant.forms[0].answers).toEqual([{ fieldId: 'goal', label: 'Main goal', type: 'text', value: 'Grow' }]);
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
        cfProgram: { findFirst: jest.fn().mockResolvedValue({ id: 'program-1' }) },
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
