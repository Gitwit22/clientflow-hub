import type { PrismaService } from '../../prisma/prisma.service';
import type { ProgramDeliverablesService } from '../deliverables/program-deliverables.service';
import { BillingService } from './billing.service';

describe('payments complete program deliverables', () => {
  it('a recorded past payment completes deliverables for the month it was paid in', async () => {
    const paymentDate = new Date('2026-10-12T16:00:00.000Z');
    const prisma = {
      cfPaymentRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'pay-1', amount: 250 }),
      },
    } as unknown as PrismaService;
    const autoComplete = jest.fn().mockResolvedValue(1);
    const service = new BillingService(prisma, { autoComplete } as unknown as ProgramDeliverablesService);

    await service.recordPastPayment({
      organizationId: 'org-1', enrollmentId: 'enr-1', amount: 250, paymentDate, paymentMethod: 'check',
      actorUserId: 'admin-1', actorDisplayName: 'Ada', idempotencyKey: 'k-00000001',
    } as never);

    expect(autoComplete).toHaveBeenCalledWith({
      organizationId: 'org-1', enrollmentId: 'enr-1', trigger: 'payment_recorded', occurredAt: paymentDate,
      detail: 'payment of $250.00 recorded',
    });
  });

  it('a payment replayed by its key does not complete anything again', async () => {
    const prisma = {
      cfPaymentRecord: { findFirst: jest.fn().mockResolvedValue({ id: 'pay-1', amount: 250 }), create: jest.fn() },
    } as unknown as PrismaService;
    const autoComplete = jest.fn();
    const service = new BillingService(prisma, { autoComplete } as unknown as ProgramDeliverablesService);
    await service.recordPastPayment({
      organizationId: 'org-1', enrollmentId: 'enr-1', amount: 250, paymentDate: new Date(), paymentMethod: 'check',
      actorUserId: null, actorDisplayName: 'Ada', idempotencyKey: 'k-00000001',
    } as never);
    expect(autoComplete).not.toHaveBeenCalled();
  });
});
