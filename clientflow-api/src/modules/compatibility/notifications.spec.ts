import { NotFoundException } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { ClientflowCompatibilityController } from './compatibility.controller';

function setup() {
  const rows = {
    cfNotification: [
      { id: 'n1', organizationId: 'org-1', recipientAdminId: 'admin-1', readAt: null, createdAt: new Date(1) },
      { id: 'n2', organizationId: 'org-1', recipientAdminId: 'admin-1', readAt: null, createdAt: new Date(2) },
      { id: 'n3', organizationId: 'org-1', recipientAdminId: 'admin-1', readAt: new Date(), createdAt: new Date(3) },
      { id: 'n-other', organizationId: 'org-1', recipientAdminId: 'admin-2', readAt: null, createdAt: new Date(4) },
    ] as Array<Record<string, unknown>>,
  };
  const controller = new ClientflowCompatibilityController(new ScaffoldService(), inMemoryDb(rows) as never);
  jest.spyOn(controller as never, 'requireOrgFromRequest').mockResolvedValue(
    { orgId: 'org-1', admin: { id: 'admin-1', organizationId: 'org-1' } } as never,
  );
  return { rows, controller };
}

describe('notifications', () => {
  it("reports the admin's real unread count", async () => {
    const { controller } = setup();
    const result = await controller.listNotifications({} as never);
    expect(result.unreadCount).toBe(2);
    expect(result.items.map((item) => item.id).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('mark-all-read reports how many it changed and leaves other admins alone', async () => {
    const { rows, controller } = setup();
    await expect(controller.markAllNotificationsRead({} as never)).resolves.toEqual({ updated: 2 });
    expect(rows.cfNotification.find((n) => n.id === 'n-other')?.readAt).toBeNull();
  });

  it("marking another admin's notification is a 404", async () => {
    const { rows, controller } = setup();
    await expect(controller.markNotificationRead({} as never, 'n-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.cfNotification.find((n) => n.id === 'n-other')?.readAt).toBeNull();
  });
});
