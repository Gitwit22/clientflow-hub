import { NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import type { ProgramAutomationService } from '../automation/program-automation.service';
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
      };
      const prisma = {
        cfProgramEnrollment: { create: jest.fn().mockResolvedValue(enrollment) },
      };
      const automation = { runTrigger: jest.fn().mockResolvedValue({}) } as unknown as ProgramAutomationService;
      const controller = new ClientflowCompatibilityController(
        scaffold,
        prisma as never,
        undefined,
        automation,
      );
      jest.spyOn(controller as any, 'requireOrgFromRequest').mockResolvedValue({
        orgId: 'org-1',
        admin: { id: 'admin-1', email: 'admin@example.com', firstName: 'Admin', lastName: 'User' },
      });

      const result = await controller.createEnrollment({} as never, { clientId: 'client-1', programId: 'program-1' });

      expect(prisma.cfProgramEnrollment.create).toHaveBeenCalled();
      expect(automation.runTrigger).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'org-1',
        clientId: 'client-1',
        trigger: 'enrollment.created',
        programIds: ['program-1'],
        enrollmentIdsByProgramId: { 'program-1': 'enroll-1' },
      }));
      expect(result).toEqual(enrollment);
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
