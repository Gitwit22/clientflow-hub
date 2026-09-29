import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/clientflow';
import { findMonitoringForOrg, type TenantDb } from '../../common/tenancy/org-scoped.repository';

/**
 * Enrollment monitoring (CfEnrollmentMonitoring is canonical; CfMonitoringTask is legacy).
 * Recording a review stores the result, keeps the item's notes unless new ones are given, moves the
 * next review forward by the item's frequency, and writes one history row, all together.
 */
export const MONITORING_FREQUENCIES = ['once', 'weekly', 'monthly', 'quarterly', 'annually', 'custom'] as const;
export type MonitoringFrequency = (typeof MONITORING_FREQUENCIES)[number];

export const COMPLIANCE_STATUSES = ['pending', 'compliant', 'partially_compliant', 'non_compliant', 'not_applicable'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

const DEFAULT_CUSTOM_INTERVAL_DAYS = 30;
const DAY_MS = 86_400_000;

/** Program settings use labels like "Monthly" or "Bi-weekly"; this maps them onto the stored enum. */
export function normalizeMonitoringFrequency(value: unknown): { frequency: MonitoringFrequency; customIntervalDays: number | null } {
  const key = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_-]/g, '') : '';
  if (key === 'biweekly' || key === 'fortnightly') return { frequency: 'custom', customIntervalDays: 14 };
  if (key === 'annual' || key === 'yearly') return { frequency: 'annually', customIntervalDays: null };
  const match = MONITORING_FREQUENCIES.find((frequency) => frequency === key);
  return { frequency: match ?? 'monthly', customIntervalDays: null };
}

function addMonths(from: Date, months: number): Date {
  const next = new Date(from);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  // Clamp to the month's last day (Jan 31 + 1 month = Feb 28/29, not Mar 3).
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/** When the next review is due after a review on `from`; null for a one-time item. */
export function nextReviewAfter(from: Date, frequency: string, customIntervalDays?: number | null): Date | null {
  switch (frequency) {
    case 'once':
      return null;
    case 'weekly':
      return new Date(from.getTime() + 7 * DAY_MS);
    case 'monthly':
      return addMonths(from, 1);
    case 'quarterly':
      return addMonths(from, 3);
    case 'annually':
      return addMonths(from, 12);
    case 'custom':
      return new Date(from.getTime() + (customIntervalDays && customIntervalDays > 0 ? customIntervalDays : DEFAULT_CUSTOM_INTERVAL_DAYS) * DAY_MS);
    default:
      return addMonths(from, 1);
  }
}

export function parseComplianceStatus(value: unknown): ComplianceStatus {
  if (typeof value === 'string' && (COMPLIANCE_STATUSES as readonly string[]).includes(value)) return value as ComplianceStatus;
  throw new BadRequestException(`Compliance status must be one of: ${COMPLIANCE_STATUSES.join(', ')}.`);
}

function optionalNumber(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new BadRequestException(`${label} must be a number.`);
  return parsed;
}

function optionalDate(value: unknown, label: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new BadRequestException(`${label} must be a date.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${label} must be a date.`);
  return parsed;
}

export interface MonitoringResultInput {
  complianceStatus?: unknown;
  /** Older clients sent the result as `status`. */
  status?: unknown;
  actualValue?: unknown;
  expectedValue?: unknown;
  unit?: unknown;
  notes?: unknown;
  followUpRequired?: unknown;
  /** Overrides the computed next review date (null ends the schedule). */
  nextReviewAt?: unknown;
}

export async function recordMonitoringResult(
  db: TenantDb,
  input: { organizationId: string; monitoringId: string; result: MonitoringResultInput; reviewedByUserId: string | null },
  now = new Date(),
) {
  const current = await findMonitoringForOrg(db, input.organizationId, input.monitoringId);
  if (!current.active) throw new BadRequestException('This monitoring item is no longer active.');
  const { result } = input;

  const complianceStatus = parseComplianceStatus(result.complianceStatus ?? result.status);
  const actualValue = optionalNumber(result.actualValue, 'Actual value');
  const expectedValue = optionalNumber(result.expectedValue, 'Expected value');
  if (result.unit !== undefined && result.unit !== null && typeof result.unit !== 'string') {
    throw new BadRequestException('Unit must be text.');
  }
  const unit = result.unit === undefined ? undefined : result.unit;
  // Notes the reviewer didn't touch are kept.
  const notes = typeof result.notes === 'string' ? result.notes : current.notes;
  const followUpRequired = typeof result.followUpRequired === 'boolean' ? result.followUpRequired : current.followUpRequired;
  const override = optionalDate(result.nextReviewAt, 'Next review date');
  const nextReviewAt = override !== undefined ? override : nextReviewAfter(now, current.frequency, current.customIntervalDays);

  const data: Prisma.CfEnrollmentMonitoringUpdateManyMutationInput = {
    complianceStatus,
    lastReviewedAt: now,
    nextReviewAt,
    notes,
    followUpRequired,
    ...(actualValue !== undefined ? { actualValue } : {}),
    ...(expectedValue !== undefined ? { expectedValue } : {}),
    ...(unit !== undefined ? { unit } : {}),
  };
  // Captured before the update, so history always records what the item was.
  const previous = {
    complianceStatus: current.complianceStatus,
    actualValue: current.actualValue === null ? null : Number(current.actualValue),
    expectedValue: current.expectedValue,
    unit: current.unit,
    nextReviewAt: current.nextReviewAt?.toISOString() ?? null,
  };
  await db.cfEnrollmentMonitoring.updateMany({ where: { id: current.id, organizationId: input.organizationId }, data });
  await db.cfEnrollmentMonitoringHistory.create({
    data: {
      organizationId: input.organizationId,
      enrollmentId: current.enrollmentId,
      enrollmentMonitoringId: current.id,
      expectedValue: expectedValue !== undefined ? expectedValue : previous.expectedValue,
      actualValue: actualValue !== undefined ? actualValue : previous.actualValue,
      unit: unit !== undefined ? unit : previous.unit,
      complianceStatus,
      reviewedAt: now,
      nextReviewAt,
      reviewedByUserId: input.reviewedByUserId,
      followUpRequired,
      notes,
      previousValue: {
        complianceStatus: previous.complianceStatus,
        actualValue: previous.actualValue,
        nextReviewAt: previous.nextReviewAt,
      },
      newValue: {
        complianceStatus,
        actualValue: actualValue !== undefined ? actualValue : previous.actualValue,
        nextReviewAt: nextReviewAt?.toISOString() ?? null,
      },
      isDemo: current.isDemo,
    },
  });
  return findMonitoringForOrg(db, input.organizationId, current.id);
}
