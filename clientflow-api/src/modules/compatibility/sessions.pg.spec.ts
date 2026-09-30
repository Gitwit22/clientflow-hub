import { hash } from 'bcrypt';
import type { Request, Response } from 'express';
import { ScaffoldService } from '../../common/services/scaffold.service';
import { PrismaClient } from '../../generated/clientflow';
import { AuthCompatibilityController } from './compatibility.controller';

/** Sign-in sessions against a real, migrated Postgres. Set CLIENTFLOW_PG_TEST_URL to run it. */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('sessions: refresh, concurrent tabs and logout (Postgres)', () => {
  let prisma: PrismaClient;
  let auth: AuthCompatibilityController;
  const email = `tabs-${Date.now()}@x.test`;
  const secrets = { JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) };

  // Minimal cookie jar: what the browser would hold after each response.
  const jar = new Map<string, string>();
  const response = () => {
    const set: Record<string, string> = {};
    return {
      set,
      res: {
        cookie: (name: string, value: string) => {
          set[name] = value;
          jar.set(name, value);
        },
        clearCookie: (name: string) => jar.delete(name),
      } as unknown as Response,
    };
  };
  const request = (cookies: Map<string, string>) =>
    ({ headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } }) as unknown as Request;
  const access = () => [...jar].find(([k]) => k.endsWith('session'))![1];
  const refresh = () => [...jar].find(([k]) => k.endsWith('refresh'))![1];
  const me = (token: string) =>
    auth.getMe({ headers: { authorization: `Bearer ${token}` } } as unknown as Request);

  beforeAll(async () => {
    Object.assign(process.env, secrets);
    prisma = new PrismaClient({ datasources: { db: { url } } });
    auth = new AuthCompatibilityController(new ScaffoldService(), prisma as never);
    const org = await prisma.organization.create({ data: { name: 'Tabs', slug: `tabs-${Date.now()}` } });
    await prisma.adminUser.create({ data: { organizationId: org.id, email, passwordHash: await hash('correct-horse', 4), role: 'org_admin', isActive: true } });
  });
  afterAll(async () => prisma?.$disconnect());

  it('two tabs refreshing with the same token both stay signed in', async () => {
    await auth.login({ email, password: 'correct-horse' }, response().res);
    const firstAccess = access();
    const staleRefresh = refresh();
    const sessionId = staleRefresh.split('.')[0];

    // Tab A refreshes: new refresh + access token, same session id.
    await auth.refresh(request(new Map(jar)), response().res);
    expect(refresh()).not.toBe(staleRefresh);
    expect(refresh().split('.')[0]).toBe(sessionId);
    await expect(me(access())).resolves.toMatchObject({ email });
    await expect(me(firstAccess)).rejects.toThrow(/no longer active/);

    // Tab B still holds the replaced token: within the grace window it gets an access token and
    // leaves the refresh cookie tab A set.
    const tabB = response();
    await auth.refresh(request(new Map([['clientflow_refresh', staleRefresh]])), tabB.res);
    expect(Object.keys(tabB.set)).toEqual(['clientflow_session']);
    await expect(me(tabB.set.clientflow_session)).resolves.toMatchObject({ email });
  });

  it('a replaced token is refused once the grace window has passed', async () => {
    await auth.login({ email, password: 'correct-horse' }, response().res);
    const staleRefresh = refresh();
    await auth.refresh(request(new Map(jar)), response().res);
    await prisma.authSession.update({ where: { id: staleRefresh.split('.')[0] }, data: { refreshRotatedAt: new Date(Date.now() - 120_000) } });
    await expect(auth.refresh(request(new Map([['clientflow_refresh', staleRefresh]])), response().res)).rejects.toThrow(/expired or revoked/);
  });

  it('logging out ends the access token at once', async () => {
    await auth.login({ email, password: 'correct-horse' }, response().res);
    const token = access();
    await expect(me(token)).resolves.toMatchObject({ email });
    await auth.logout(request(new Map(jar)), response().res);
    await expect(me(token)).rejects.toThrow(/no longer active/);
  });
});
