import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/clientflow';
import { NOT_LEGACY_CONTRACT } from '../contracts/legacy-contract';
import { RESOLVED_STATUSES } from '../deliverables/deliverable-summary';
import { outstandingOf, receivedOf, toAmount } from '../funding/award-rules';
import { OPEN_CONTRACT_STATUSES } from '../lifecycle/contract-state';

/**
 * What is still open on a program participation when staff close it out: agreements not signed,
 * deliverables not resolved, and funding awards with money still owed. Staff resolve them or record
 * why the participation is closing with them outstanding.
 */
export type ClosureReviewItemKind = 'agreement' | 'deliverable' | 'award';

export interface ClosureReviewItem {
  kind: ClosureReviewItemKind;
  id: string;
  label: string;
  detail: string;
}

export interface ClosureReview {
  items: ClosureReviewItem[];
  /** A fingerprint of the items, so finalizing can tell whether anything changed since review. */
  reviewHash: string;
  reviewedAt: string;
}

type Db = Pick<
  Prisma.TransactionClient,
  'cfContract' | 'cfEnrollmentDeliverable' | 'cfEnrollmentDeliverableCycle' | 'cfEnrollmentAward' | 'cfAwardPayment'
>;

const CONTRACT_STATUS_WORD: Record<string, string> = {
  DRAFT: 'prepared but not sent',
  SENT: 'sent, not signed',
  OPENED: 'opened, not signed',
  EXPIRED: 'signing link expired',
};

const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

/** The fingerprint of a review's items; stable for the same open items in any order. */
export function closureReviewHash(items: readonly ClosureReviewItem[]): string {
  const canonical = [...items]
    .map((item) => `${item.kind}|${item.id}|${item.detail}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Builds the review from the database client given (the finalize transaction passes its own, so the
 * review it enforces is the one it commits with).
 */
export async function buildClosureReview(
  db: Db,
  organizationId: string,
  enrollmentId: string,
  now: Date = new Date(),
): Promise<ClosureReview> {
  const [contracts, deliverables, awards] = await Promise.all([
    db.cfContract.findMany({
      where: { organizationId, enrollmentId, status: { in: [...OPEN_CONTRACT_STATUSES] }, ...NOT_LEGACY_CONTRACT },
      select: { id: true, contractType: true, status: true, purpose: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.cfEnrollmentDeliverable.findMany({
      where: { organizationId, enrollmentId, status: { notIn: [...RESOLVED_STATUSES] } },
      select: { id: true, titleSnapshot: true, status: true, cycleId: true },
      orderBy: [{ cycleId: 'asc' }, { sortOrder: 'asc' }],
    }),
    db.cfEnrollmentAward.findMany({
      where: { organizationId, enrollmentId, status: { not: 'cancelled' } },
      orderBy: { awardDate: 'asc' },
    }),
  ]);
  const cycleIds = [...new Set(deliverables.map((item) => item.cycleId))];
  const [cycles, payments] = await Promise.all([
    cycleIds.length
      ? db.cfEnrollmentDeliverableCycle.findMany({ where: { organizationId, id: { in: cycleIds } }, select: { id: true, label: true } })
      : Promise.resolve([]),
    awards.length
      ? db.cfAwardPayment.findMany({
          where: { organizationId, awardId: { in: awards.map((award) => award.id) } },
          select: { awardId: true, amount: true, voidedAt: true },
        })
      : Promise.resolve([]),
  ]);
  const cycleLabel = new Map(cycles.map((cycle) => [cycle.id, cycle.label]));

  const items: ClosureReviewItem[] = [
    ...contracts.map((contract) => ({
      kind: 'agreement' as const,
      id: contract.id,
      label: contract.contractType,
      detail: `${contract.purpose === 'award' ? 'Award agreement' : 'Agreement'} ${CONTRACT_STATUS_WORD[contract.status] ?? contract.status.toLowerCase()}`,
    })),
    ...deliverables.map((item) => ({
      kind: 'deliverable' as const,
      id: item.id,
      label: item.titleSnapshot,
      detail: `${cycleLabel.get(item.cycleId) ?? 'Checklist'}: ${item.status.toLowerCase().replace(/_/g, ' ')}`,
    })),
    ...awards.flatMap((award) => {
      const received = receivedOf(payments.filter((payment) => payment.awardId === award.id));
      const owed = toAmount(outstandingOf(award, received));
      return owed > 0
        ? [{
            kind: 'award' as const,
            id: award.id,
            label: award.title,
            detail: `${money(owed)} still owed of ${money(toAmount(award.amountAwarded))} awarded`,
          }]
        : [];
    }),
  ];
  return { items, reviewHash: closureReviewHash(items), reviewedAt: now.toISOString() };
}
