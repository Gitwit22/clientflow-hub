import type { PrismaService } from '../../prisma/prisma.service';
import type { ScaffoldService } from '../../common/services/scaffold.service';
import { OrganizationsCompatibilityController } from './compatibility.controller';

describe('organization settings', () => {
  it('turning one notification toggle off keeps the others as they were', async () => {
    const settings = { notificationTemplateToggles: { programInvite: false, finalReport: true }, features: { billing: true } };
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ id: 'org-1', settings }),
        update: jest.fn().mockImplementation(({ data }: { data: { settings: unknown } }) => ({ id: 'org-1', name: 'EA', settings: data.settings })),
      },
    };
    const controller = new OrganizationsCompatibilityController({} as ScaffoldService, prisma as unknown as PrismaService);
    jest.spyOn(controller as any, 'requireOrgAccess').mockResolvedValue({ id: 'admin-1', role: 'org_admin' });

    const result = await controller.updateSettings({} as never, 'org-1', { notificationTemplateToggles: { finalReport: false } });

    expect(result.settings).toEqual({
      notificationTemplateToggles: { programInvite: false, finalReport: false },
      features: { billing: true },
    });
  });

  it('saving one role signature keeps the other roles, and refuses an unknown role', async () => {
    const settings = { emailSignaturesByRole: { org_admin: 'Thank you,\nEAM Administration', reviewer: 'Old staff sign-off' } };
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ id: 'org-1', settings }),
        update: jest.fn().mockImplementation(({ data }: { data: { settings: unknown } }) => ({ id: 'org-1', name: 'EA', settings: data.settings })),
      },
    };
    const controller = new OrganizationsCompatibilityController({} as ScaffoldService, prisma as unknown as PrismaService);
    jest.spyOn(controller as any, 'requireOrgAccess').mockResolvedValue({ id: 'admin-1', role: 'org_admin' });

    const result = await controller.updateSettings({} as never, 'org-1', { emailSignaturesByRole: { reviewer: 'Thank you,\nEAM Staff' } });
    expect(result.settings).toEqual({
      emailSignaturesByRole: { org_admin: 'Thank you,\nEAM Administration', reviewer: 'Thank you,\nEAM Staff' },
    });
    await expect(controller.updateSettings({} as never, 'org-1', { emailSignaturesByRole: { owner: 'x' } })).rejects.toThrow('Unknown role');
  });
});
