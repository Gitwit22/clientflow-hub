import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { PrismaClient } from '../../generated/clientflow';
import type { N8nService } from '../../integrations/n8n/n8n.service';
import type { StorageService } from '../../integrations/storage/storage.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { FundingService } from '../funding/funding.service';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import { ContractsService } from './contracts.service';

/**
 * Award agreements end to end against a real, migrated Postgres: prepare from the reviewed text,
 * send, open and sign, without touching the client's joining workflow. Set CLIENTFLOW_PG_TEST_URL.
 */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('award agreements (Postgres)', () => {
  let prisma: PrismaClient;
  let contracts: ContractsService;
  let funding: FundingService;
  let organizationId: string;
  let clientId: string;
  let enrollmentId: string;
  const staff = { id: null, name: 'Jordan Lee' };
  const actor = { actorUserId: null, actorDisplayName: 'Jordan Lee' };
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const db = prisma as unknown as PrismaService;
    const config = { get: (key: string) => ({ APP_URL: 'https://clientflow.example.com' } as Record<string, string>)[key] };
    // Email delivery off: sending still issues the signing link, the email is recorded as skipped.
    const n8n = {
      getContractAvailability: () => 'disabled',
      getWelcomeAvailability: () => 'disabled',
      getContractCopyAvailability: () => 'disabled',
    };
    contracts = new ContractsService(
      db,
      config as unknown as ConfigService<Environment, true>,
      n8n as unknown as N8nService,
      new WorkflowConfigService(db),
      { isEnabled: () => false } as unknown as StorageService,
    );
    funding = new FundingService(db, new BillingService(db));
    const stamp = Date.now();
    organizationId = (await prisma.organization.create({ data: { name: 'EA', slug: `awards-${stamp}` } })).id;
    const program = await prisma.cfProgram.create({
      data: { organizationId, name: 'IDI', description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: 'Monthly', defaultContractTemplateId: '' },
    });
    clientId = (await prisma.cfClient.create({
      data: {
        organizationId, businessName: 'Rivers Bakery LLC', primaryContactName: 'Pat Rivers', email: `pat-${stamp}@x.test`,
        phone: '', assignedStaff: '', intake: {}, status: 'ACTIVE',
      },
    })).id;
    enrollmentId = (await prisma.cfProgramEnrollment.create({
      data: { organizationId, clientId, programId: program.id, status: 'active', startDate: new Date('2026-10-01') },
    })).id;
    const template = await prisma.cfProgramContractTemplate.create({
      data: { organizationId, programId: program.id, name: 'Member Fund Award Agreement', purpose: 'award' },
    });
    const version = await prisma.cfProgramContractVersion.create({
      data: {
        organizationId, templateId: template.id, version: 1, title: 'Member Business Achievement Award Agreement',
        content: 'Award Amount: {{award.amount}}\nBusiness Name: {{client.businessName}}\nAward Date: {{award.date}}',
        createdBy: 'staff',
      },
    });
    await prisma.cfProgramContractTemplate.update({ where: { id: template.id }, data: { activeVersionId: version.id } });
  });
  afterAll(async () => prisma?.$disconnect());

  const newAward = async () => {
    const award = await funding.create(organizationId, clientId, enrollmentId, {
      title: 'Member Business Achievement Award', source: 'IDI Member Fund', amountAwarded: 500, awardDate: '2026-11-12', approve: true,
    }, actor, null);
    return award;
  };

  it('prepares, sends and signs an award agreement without touching the joining workflow', async () => {
    const award = await newAward();
    const preview = await contracts.previewAwardAgreement(organizationId, award.id);
    expect(preview.content).toContain('Award Amount: $500.00');
    expect(preview.content).toContain('Business Name: Rivers Bakery LLC');
    expect(preview.content).toContain('Award Date: November 12, 2026');
    expect(preview.missing).toEqual([]);

    const generated = await contracts.generateAwardAgreement(organizationId, award.id, staff, {
      review: { versionId: preview.versionId, contentHash: preview.contentHash },
    });
    const sent = await contracts.sendForStaff(organizationId, clientId, generated.contract.id, { actor: staff });
    expect((await prisma.cfEnrollmentAward.findUniqueOrThrow({ where: { id: award.id } })).status).toBe('agreement_sent');

    const token = String(sent.publicContractUrl).split('/').pop()!;
    const opened = await contracts.openPublicContract(token);
    expect(opened.contract.purpose).toBe('award');
    const signed = await contracts.completePublicContract(
      token,
      { signedName: 'Pat Rivers', signedEmail: 'pat@x.test', agreedToTerms: true } as never,
      { signerIp: null, userAgent: null },
    );
    expect(signed.purpose).toBe('award');

    const [client, enrollment, awardAfter, monitoring, welcome, history] = await Promise.all([
      prisma.cfClient.findUniqueOrThrow({ where: { id: clientId } }),
      prisma.cfProgramEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } }),
      prisma.cfEnrollmentAward.findUniqueOrThrow({ where: { id: award.id } }),
      prisma.cfEnrollmentMonitoring.count({ where: { enrollmentId } }),
      prisma.cfCommunication.count({ where: { clientId, type: 'welcome_email' } }),
      prisma.cfEnrollmentStatusHistory.count({ where: { enrollmentId } }),
    ]);
    // The client's status, enrollment and start date are exactly as before; no onboarding steps.
    expect(client.status).toBe('ACTIVE');
    expect(enrollment).toEqual(expect.objectContaining({ status: 'active', startDate: new Date('2026-10-01') }));
    expect(monitoring).toBe(0);
    expect(welcome).toBe(0);
    expect(history).toBe(0);
    expect(awardAfter.status).toBe('agreement_signed');
    // Payments can now be recorded.
    await expect(funding.recordPayment(organizationId, award.id, { amount: 500, paymentDate: today, paymentMethod: 'check' }, actor, null))
      .resolves.toEqual(expect.objectContaining({ paymentState: 'paid' }));
  });

  it('prepares one agreement per award, even under simultaneous requests', async () => {
    const award = await newAward();
    const results = await Promise.allSettled([...Array(4)].map(() => contracts.generateAwardAgreement(organizationId, award.id, staff)));
    const ids = new Set(results.filter((result) => result.status === 'fulfilled').map((result) => (result as PromiseFulfilledResult<{ contract: { id: string } }>).value.contract.id));
    expect(ids.size).toBe(1);
    expect(await prisma.cfContract.count({ where: { awardId: award.id } })).toBe(1);
  });

  it('refuses an agreement for an unapproved award, and refuses a changed text after review', async () => {
    const pending = await funding.create(organizationId, clientId, enrollmentId, {
      title: 'Pending Award', source: 'IDI Member Fund', amountAwarded: 100, awardDate: '2026-11-12',
    }, actor, null);
    await expect(contracts.generateAwardAgreement(organizationId, pending.id, staff)).rejects.toThrow('Approve the award');

    const award = await newAward();
    const preview = await contracts.previewAwardAgreement(organizationId, award.id);
    await funding.update(organizationId, award.id, { amountAwarded: 750 }, actor);
    await expect(contracts.generateAwardAgreement(organizationId, award.id, staff, {
      review: { versionId: preview.versionId, contentHash: preview.contentHash },
    })).rejects.toThrow('changed since you reviewed');
  });

  it("a cancelled award's agreement can no longer be sent or signed", async () => {
    const award = await newAward();
    const generated = await contracts.generateAwardAgreement(organizationId, award.id, staff);
    const sent = await contracts.sendForStaff(organizationId, clientId, generated.contract.id, { actor: staff });
    const token = String(sent.publicContractUrl).split('/').pop()!;
    await funding.cancel(organizationId, award.id, 'Business closed', actor);
    expect((await prisma.cfContract.findUniqueOrThrow({ where: { id: generated.contract.id } })).status).toBe('CANCELLED');
    await expect(contracts.completePublicContract(
      token,
      { signedName: 'Pat', signedEmail: 'pat@x.test', agreedToTerms: true } as never,
      { signerIp: null, userAgent: null },
    )).rejects.toThrow();
    await expect(contracts.sendForStaff(organizationId, clientId, generated.contract.id, { actor: staff })).rejects.toThrow();
  });

  it('an award agreement never stands in for the enrollment agreement', async () => {
    const award = await newAward();
    const generated = await contracts.generateAwardAgreement(organizationId, award.id, staff);
    // Preparing an enrollment agreement does not reuse the award's open draft.
    // The program has no enrollment agreement, so the only open agreement is the award's draft: the
    // enrollment path must not pick it up; it reports that no enrollment agreement is set up.
    expect(generated.contract.id).toBeTruthy();
    await expect(contracts.previewForStaff(organizationId, clientId, { enrollmentId }))
      .rejects.toThrow('does not have an active contract template');
  });
});
