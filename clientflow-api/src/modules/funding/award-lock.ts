import { NotFoundException } from '@nestjs/common';
import type { CfEnrollmentAward, Prisma } from '../../generated/clientflow';

/**
 * Locks one award row for the rest of the transaction (SELECT … FOR UPDATE) and returns it.
 * Everything that reads or changes an award's balance or agreement takes this lock first, so two
 * requests on the same award (two payments, a payment and a cancel, signing and replacing the
 * agreement) are applied one after the other.
 */
export async function lockAward(
  tx: Prisma.TransactionClient,
  organizationId: string,
  awardId: string,
): Promise<CfEnrollmentAward> {
  await tx.$queryRaw`SELECT "id" FROM "CfEnrollmentAward" WHERE "id" = ${awardId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const award = await tx.cfEnrollmentAward.findFirst({ where: { id: awardId, organizationId } });
  if (!award) throw new NotFoundException('Award not found.');
  return award;
}
