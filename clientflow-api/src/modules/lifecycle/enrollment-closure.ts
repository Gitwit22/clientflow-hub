import type { TenantDb } from '../../common/tenancy/org-scoped.repository';
import { cancelOpenContracts } from './contract-state';
import { isClosedEnrollment } from './enrollment-state';

/** Form assignments a client could still open and submit. */
const OPEN_FORM_STATUSES = ['draft', 'sending', 'sent', 'delivered', 'opened', 'in_progress', 'delivery_failed'];

/**
 * What must happen, in the same transaction, when an enrollment reaches a closed state
 * (completed, declined, withdrawn): nothing left over may keep acting on it. Open contracts are
 * cancelled (their signing links stop working), unfinished forms are cancelled, and the billing
 * agreement ends so it stops accruing expected/outstanding amounts.
 */
export async function applyEnrollmentClosure(
  db: TenantDb,
  enrollment: { id: string; organizationId: string; clientId: string; status: string },
  now = new Date(),
): Promise<{ contractsCancelled: number; formsCancelled: number; agreementsEnded: number }> {
  if (!isClosedEnrollment(enrollment.status)) return { contractsCancelled: 0, formsCancelled: 0, agreementsEnded: 0 };
  const contractsCancelled = await cancelOpenContracts(db, {
    organizationId: enrollment.organizationId,
    clientId: enrollment.clientId,
    enrollmentId: enrollment.id,
  });
  const forms = await db.cfFormAssignment.updateMany({
    where: {
      organizationId: enrollment.organizationId,
      enrollmentId: enrollment.id,
      submittedAt: null,
      status: { in: OPEN_FORM_STATUSES },
    },
    data: { status: 'cancelled', cancelledAt: now },
  });
  const agreements = await db.cfEnrollmentBillingAgreement.updateMany({
    where: { organizationId: enrollment.organizationId, enrollmentId: enrollment.id, status: 'active' },
    data: { status: 'ended', endDate: now },
  });
  return { contractsCancelled, formsCancelled: forms.count, agreementsEnded: agreements.count };
}
