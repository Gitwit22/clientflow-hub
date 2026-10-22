import { PrismaClient } from '../../generated/clientflow';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramEmailService } from './program-email.service';

/** Program emails against a real, migrated Postgres. Set CLIENTFLOW_PG_TEST_URL to run it. */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('program emails (Postgres)', () => {
  let prisma: PrismaClient;
  let organizationId: string;
  let programId: string;
  const sendProgramEmail = jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2026-10-22T15:00:00.000Z' });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const stamp = Date.now();
    organizationId = (await prisma.organization.create({ data: { name: 'Emails', slug: `emails-${stamp}` } })).id;
    programId = (await prisma.cfProgram.create({
      data: { organizationId, name: 'IDI', description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: '', defaultContractTemplateId: '' },
    })).id;
    for (const [name, email] of [['Alpha', `a-${stamp}@x.test`], ['Beta', `b-${stamp}@x.test`], ['Gamma', `A-${stamp}@X.test`]]) {
      const client = await prisma.cfClient.create({
        data: { organizationId, businessName: name, primaryContactName: name, email, phone: '', assignedStaff: '', intake: {} },
      });
      await prisma.cfProgramEnrollment.create({ data: { organizationId, clientId: client.id, programId, status: 'active' } });
    }
  });
  afterAll(async () => prisma?.$disconnect());

  it('creates one email for simultaneous requests with the same key, and sends each address once', async () => {
    // Separate service instances: like two server processes receiving the same retried request.
    const services = [...Array(4)].map(
      () => new ProgramEmailService(prisma as unknown as PrismaService, { sendProgramEmail } as unknown as N8nService),
    );
    const results = await Promise.all(
      services.map((service) => service.create(organizationId, { id: null, displayName: 'Jordan' }, programId, {
        subject: 'Hello',
        body: 'Message',
        idempotencyKey: 'pg-same-key-1',
      })),
    );
    const id = results[0].id;
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    await Promise.all(services.map((service) => service.whenIdle(id)));

    expect(await prisma.cfProgramEmail.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.cfCommunication.count({ where: { programEmailId: id } })).toBe(2); // A and Gamma share an address
    expect(sendProgramEmail).toHaveBeenCalledTimes(2);
    const email = await prisma.cfProgramEmail.findUniqueOrThrow({ where: { id } });
    expect(email).toEqual(expect.objectContaining({ status: 'COMPLETED', recipientCount: 2, skippedCount: 1 }));
  });
});
