import { ScaffoldService } from '../../common/services/scaffold.service';
import { PrismaClient } from '../../generated/clientflow';
import { AuthCompatibilityController, OrganizationsCompatibilityController } from './compatibility.controller';

/**
 * Invite and password-reset links against a real, migrated Postgres. Set CLIENTFLOW_PG_TEST_URL to
 * a throwaway database to run it (see legacy-data.pg.spec.ts).
 */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('staff invite and reset links (Postgres)', () => {
  let prisma: PrismaClient;
  let orgs: OrganizationsCompatibilityController;
  let auth: AuthCompatibilityController;
  let orgId = '';
  let admin: { id: string; role: string; organizationId: string; isActive: boolean };
  const stamp = Date.now();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    orgs = new OrganizationsCompatibilityController(new ScaffoldService(), prisma as never);
    auth = new AuthCompatibilityController(new ScaffoldService(), prisma as never);
    orgId = (await prisma.organization.create({ data: { name: 'Links', slug: `links-${stamp}` } })).id;
    admin = await prisma.adminUser.create({ data: { organizationId: orgId, email: `boss-${stamp}@x.test`, passwordHash: 'x', role: 'org_admin', isActive: true } });
    jest.spyOn(orgs as never, 'requireOrgAccess').mockResolvedValue(admin as never);
  });
  afterAll(async () => prisma?.$disconnect());

  const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? '';

  it('an invite returns a working link once, and a fresh link replaces it', async () => {
    const invited = await orgs.inviteMember({} as never, orgId, { email: `new-${stamp}@x.test`, firstName: 'New' });
    const first = tokenOf(invited.inviteUrl);
    expect(invited.inviteUrl).toMatch(/\/accept-invite\?token=[0-9a-f]{64}$/);
    await expect(auth.validateInvite(first)).resolves.toMatchObject({ valid: true, email: `new-${stamp}@x.test` });

    const member = await prisma.adminUser.findUniqueOrThrow({ where: { email: `new-${stamp}@x.test` } });
    const fresh = await orgs.newInviteLink({} as never, orgId, member.id);
    await expect(auth.validateInvite(first)).resolves.toMatchObject({ valid: false });
    await expect(auth.validateInvite(tokenOf(fresh.inviteUrl))).resolves.toMatchObject({ valid: true });
  });

  it('a reset link works once, signs the member out everywhere, and an older link stops working', async () => {
    const member = await prisma.adminUser.create({ data: { organizationId: orgId, email: `staff-${stamp}@x.test`, passwordHash: 'old', role: 'reviewer', isActive: true } });
    await prisma.authSession.create({ data: { id: `s-${stamp}`, adminUserId: member.id, jti: `j-${stamp}`, expiresAt: new Date(Date.now() + 60_000), refreshTokenHash: `h-${stamp}`, refreshExpiresAt: new Date(Date.now() + 60_000) } });

    const older = tokenOf((await orgs.passwordResetLink({} as never, orgId, member.id)).resetUrl);
    const link = await orgs.passwordResetLink({} as never, orgId, member.id);
    expect(link.expiresInMinutes).toBe(60);
    const token = tokenOf(link.resetUrl);
    await expect(auth.validateReset(older)).resolves.toMatchObject({ valid: false });
    await expect(auth.validateReset(token)).resolves.toEqual({ valid: true, email: `staff-${stamp}@x.test` });

    await auth.resetPassword({ token, newPassword: 'a-new-password' });
    const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: member.id } });
    expect(updated.passwordHash).not.toBe('old');
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: `s-${stamp}` } })).revokedAt).not.toBeNull();
    await expect(auth.resetPassword({ token, newPassword: 'another-password' })).rejects.toThrow(/invalid, used or expired/);
  });

  it('admins cannot reset their own password this way, and reviewers cannot make links', async () => {
    await expect(orgs.passwordResetLink({} as never, orgId, admin.id)).rejects.toThrow(/cannot change your own/);
    jest.spyOn(orgs as never, 'requireOrgAccess').mockResolvedValueOnce({ ...admin, id: 'someone', role: 'reviewer' } as never);
    const target = await prisma.adminUser.findUniqueOrThrow({ where: { email: `staff-${stamp}@x.test` } });
    await expect(orgs.passwordResetLink({} as never, orgId, target.id)).rejects.toThrow(/Only organization admins/);
  });
});
