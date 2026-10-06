import type { ScaffoldService } from '../../common/services/scaffold.service';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { isInvitePending, OrganizationsCompatibilityController } from './compatibility.controller';

const admin = { id: 'admin-1', email: 'erica@example.com', firstName: 'Erica', lastName: 'Admin', organizationId: 'org-1', role: 'org_admin', isActive: true };

function setup(n8n?: Partial<N8nService>) {
  const prisma = {
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'EA Management LLC', principalAdminId: 'admin-1' }) },
    adminUser: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'member-1', ...data })),
    },
    adminInvitation: { update: jest.fn() },
    adminPasswordReset: { updateMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const controller = new OrganizationsCompatibilityController({} as ScaffoldService, prisma as unknown as PrismaService, n8n as N8nService | undefined);
  jest.spyOn(controller as never, 'requireOrgAccess').mockResolvedValue(admin as never);
  return { controller, prisma };
}

describe('staff invite and reset emails', () => {
  it('an invite emails the sign-up link to the new member and still returns it', async () => {
    const sendStaffInvite = jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2026-10-07T09:00:00.000Z' });
    const { controller } = setup({ sendStaffInvite });

    const result = await controller.inviteMember({} as never, 'org-1', { email: 'Dana@Example.com', firstName: 'Dana', lastName: 'Smith', role: 'reviewer' });

    expect(result.inviteUrl).toMatch(/\/accept-invite\?token=[0-9a-f]{64}$/);
    expect(result.emailDelivery).toEqual({ status: 'sent', sentAt: '2026-10-07T09:00:00.000Z' });
    expect(sendStaffInvite).toHaveBeenCalledWith(expect.stringMatching(/^staff\.invite:member-1:/), {
      organizationId: 'org-1',
      clientId: 'member-1',
      sentByUserId: 'admin-1',
      recipientEmail: 'dana@example.com',
      clientName: 'Dana Smith',
      actionUrl: result.inviteUrl,
      organizationName: 'EA Management LLC',
      inviterName: 'Erica Admin',
      roleLabel: 'Staff',
      expiresInHours: 72,
    });
  });

  it('a failed or impossible email never fails the invite', async () => {
    const failing = setup({ sendStaffInvite: jest.fn().mockResolvedValue({ status: 'failed', reason: 'n8n_http_400' }) });
    await expect(failing.controller.inviteMember({} as never, 'org-1', { email: 'a@example.com' }))
      .resolves.toMatchObject({ inviteUrl: expect.any(String), emailDelivery: { status: 'failed', reason: 'n8n_http_400' } });

    const throwing = setup({ sendStaffInvite: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(throwing.controller.inviteMember({} as never, 'org-1', { email: 'b@example.com' }))
      .resolves.toMatchObject({ emailDelivery: { status: 'failed', reason: 'unavailable' } });

    const noN8n = setup();
    await expect(noN8n.controller.inviteMember({} as never, 'org-1', { email: 'c@example.com' }))
      .resolves.toMatchObject({ emailDelivery: { status: 'skipped', reason: 'not_configured' } });
  });

  it('a new invite link and a reset link are emailed too, each with its own event id', async () => {
    const sendStaffInvite = jest.fn().mockResolvedValue({ status: 'sent', sentAt: 'now' });
    const sendStaffPasswordReset = jest.fn().mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { controller, prisma } = setup({ sendStaffInvite, sendStaffPasswordReset });
    const member = { id: 'member-2', email: 'sam@example.com', firstName: '', lastName: null, organizationId: 'org-1', role: 'reviewer', isActive: true };
    prisma.adminUser.findFirst.mockResolvedValue({ ...member, invitation: { id: 'inv-1', acceptedAt: null, revokedAt: null } });

    const first = await controller.newInviteLink({} as never, 'org-1', 'member-2');
    await controller.newInviteLink({} as never, 'org-1', 'member-2');
    expect(first.emailDelivery).toEqual({ status: 'sent', sentAt: 'now' });
    const calls = sendStaffInvite.mock.calls as [string, Record<string, unknown>][];
    expect(calls[0][0]).not.toBe(calls[1][0]);
    expect(calls[0][1]).toMatchObject({ clientName: 'sam@example.com', actionUrl: first.inviteUrl });

    const reset = await controller.passwordResetLink({} as never, 'org-1', 'member-2');
    expect(reset.emailDelivery).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(sendStaffPasswordReset).toHaveBeenCalledWith(expect.stringMatching(/^staff\.password_reset:member-2:/), expect.objectContaining({
      actionUrl: reset.resetUrl,
      requestedByName: 'Erica Admin',
      expiresInMinutes: 60,
    }));
  });
});

describe('who shows as Invited', () => {
  const open = { acceptedAt: null, revokedAt: null };
  it.each([
    ['no invitation (e.g. the first admin)', { invitation: null }, false],
    ['open invitation, never signed in', { invitation: open, lastLoginAt: null, _count: { sessions: 0 } }, true],
    ['open invitation, but has signed in', { invitation: open, lastLoginAt: new Date(), _count: { sessions: 0 } }, false],
    ['open invitation, has a session', { invitation: open, lastLoginAt: null, _count: { sessions: 1 } }, false],
    ['accepted invitation', { invitation: { acceptedAt: new Date(), revokedAt: null } }, false],
  ])('%s', (_label, member, pending) => {
    expect(isInvitePending(member)).toBe(pending);
  });

  it('the members list marks only open, never-used invitations', async () => {
    const { controller, prisma } = setup();
    const base = { email: 'x@example.com', firstName: null, lastName: null, jobTitle: null, role: 'reviewer', createdAt: new Date() };
    prisma.adminUser.findMany.mockResolvedValue([
      { ...base, id: 'admin-1', isActive: true, lastLoginAt: new Date(), invitation: null, _count: { sessions: 3 } },
      { ...base, id: 'member-1', isActive: false, lastLoginAt: null, invitation: { acceptedAt: null, revokedAt: null }, _count: { sessions: 0 } },
    ]);
    const members = await controller.listMembers({} as never, 'org-1');
    expect(members.map((m) => [m.id, m.invitePending, m.isPrincipal])).toEqual([['admin-1', false, true], ['member-1', true, false]]);
  });
});
