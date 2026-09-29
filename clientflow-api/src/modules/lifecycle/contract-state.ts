import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/clientflow';
import type { TenantDb } from '../../common/tenancy/org-scoped.repository';
import { CONTRACT_STATUS } from '../contracts/contract-lifecycle';

/**
 * Contract state machine:
 *
 *   DRAFT → SENT → OPENED → COMPLETED
 *   DRAFT / SENT / OPENED → CANCELLED
 *   SENT / OPENED → EXPIRED (link lapsed)        EXPIRED → SENT (staff re-issue)
 *   SENT / OPENED → SENT (resend rotates the link)
 *
 * COMPLETED and CANCELLED are terminal: a signed contract can never go back to SENT or DRAFT.
 * Every change is a conditional update on the allowed source states, so a resend racing a
 * signature can't revert the signature.
 */
export type ContractStatus = (typeof CONTRACT_STATUS)[keyof typeof CONTRACT_STATUS];

export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['SENT', 'OPENED', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
  OPENED: ['SENT', 'OPENED', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
  EXPIRED: ['SENT', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Contracts a client could still act on (and that must be cancelled when their enrollment closes). */
export const OPEN_CONTRACT_STATUSES: readonly ContractStatus[] = ['DRAFT', 'SENT', 'OPENED', 'EXPIRED'];

export function contractSourcesFor(to: ContractStatus): ContractStatus[] {
  return (Object.keys(CONTRACT_TRANSITIONS) as ContractStatus[]).filter((from) => CONTRACT_TRANSITIONS[from].includes(to));
}

export function canTransitionContract(from: string, to: ContractStatus): boolean {
  return (CONTRACT_TRANSITIONS[from as ContractStatus] ?? []).includes(to);
}

/**
 * Moves one contract to `to` only from a state that allows it. Throws 409 when the contract has
 * already moved on (e.g. it was signed while staff clicked resend).
 */
export async function transitionContract(
  db: TenantDb,
  input: {
    organizationId: string;
    contractId: string;
    to: ContractStatus;
    data?: Omit<Prisma.CfContractUpdateManyMutationInput, 'status'>;
    conflictMessage?: string;
  },
): Promise<void> {
  const result = await db.cfContract.updateMany({
    where: { id: input.contractId, organizationId: input.organizationId, status: { in: contractSourcesFor(input.to) } },
    data: { ...(input.data ?? {}), status: input.to },
  });
  if (result.count !== 1) {
    throw new ConflictException(input.conflictMessage ?? 'This contract has already been signed or closed.');
  }
}

/** Cancels every still-actionable contract for an enrollment (closed enrollment, program change). */
export async function cancelOpenContracts(
  db: TenantDb,
  input: { organizationId: string; clientId: string; enrollmentId?: string | null; programId?: string | null },
): Promise<number> {
  const result = await db.cfContract.updateMany({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      status: { in: [...OPEN_CONTRACT_STATUSES] },
      ...(input.enrollmentId ? { enrollmentId: input.enrollmentId } : {}),
      ...(input.programId ? { programId: input.programId } : {}),
    },
    data: { status: CONTRACT_STATUS.cancelled, secureTokenHash: null, secureTokenExpiresAt: null },
  });
  return result.count;
}
