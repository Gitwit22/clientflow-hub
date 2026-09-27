import { WorkflowConfigService } from './workflow-config.service';

describe('WorkflowConfigService', () => {
  describe('applyUpdate', () => {
    it('defaults sendContractAfterIntake/sendWelcomeAfterContractSigned to true when creating a row for a single-field update', async () => {
      const prisma = {
        cfProgramWorkflowConfig: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'config-1', ...data })),
        },
      };
      const service = new WorkflowConfigService(prisma as never);

      // Staff activates a contract version before ever touching the automation toggles -
      // this must not silently leave the automation flags off via the schema default.
      await service.applyUpdate('org-1', 'program-1', { activeContractVersionId: 'version-1' });

      expect(prisma.cfProgramWorkflowConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          programId: 'program-1',
          enabled: true,
          sendContractAfterIntake: true,
          sendWelcomeAfterContractSigned: true,
          activeContractVersionId: 'version-1',
        }),
      });
    });

    it('lets explicit staff-provided flags override the create-time defaults', async () => {
      const prisma = {
        cfProgramWorkflowConfig: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'config-1', ...data })),
        },
      };
      const service = new WorkflowConfigService(prisma as never);

      await service.applyUpdate('org-1', 'program-1', { sendContractAfterIntake: false });

      expect(prisma.cfProgramWorkflowConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sendContractAfterIntake: false,
          sendWelcomeAfterContractSigned: true,
        }),
      });
    });

    it('only touches the supplied fields when a row already exists', async () => {
      const prisma = {
        cfProgramWorkflowConfig: {
          findFirst: jest.fn().mockResolvedValue({ id: 'config-1' }),
          update: jest.fn().mockResolvedValue({ id: 'config-1' }),
        },
      };
      const service = new WorkflowConfigService(prisma as never);

      await service.applyUpdate('org-1', 'program-1', { activeContractVersionId: 'version-2' });

      expect(prisma.cfProgramWorkflowConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        data: { activeContractVersionId: 'version-2' },
      });
    });
  });
});
