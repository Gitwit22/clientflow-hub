import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/clientflow';

/**
 * Delivery idempotency convention shared by every manual staff send.
 *
 * The browser generates one key per send attempt and reuses it if the request is retried. The
 * server looks the key up first; if a CfCommunication already carries it, that attempt's recorded
 * state is returned and nothing is sent again. Otherwise the communication row is created FIRST and
 * the provider event id is built from that row's id, so an intentional resend (a new key) is a new
 * email, a retry of the same attempt cannot double-send, and every provider event traces back to a
 * communication row.
 */
export const DELIVERY_SOURCE = {
  manual: 'manual_staff_action',
  automation: 'automation',
} as const;

export type DeliverySource = (typeof DELIVERY_SOURCE)[keyof typeof DELIVERY_SOURCE];

export const COMMUNICATION_STATUS = {
  requested: 'REQUESTED',
  sending: 'SENDING',
  sent: 'SENT',
  failed: 'FAILED',
} as const;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Reads an Idempotency-Key header value. Absent → null; malformed → 400. */
export function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value.trim())) {
    throw new BadRequestException('Idempotency-Key must be 8-128 characters of letters, numbers, . _ : or -.');
  }
  return value.trim();
}

/** `<kind>:<subjectId>:<communicationId>`, e.g. welcome.send:<contractId>:<communicationId>. */
export function attemptEventId(kind: string, subjectId: string, communicationId: string): string {
  return `${kind}:${subjectId}:${communicationId}`;
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

interface CommunicationDb {
  cfCommunication: {
    findFirst: (args: {
      where: { organizationId: string; idempotencyKey: string };
    }) => Promise<CommunicationSnapshot | null>;
  };
}

export interface CommunicationSnapshot {
  id: string;
  status: string | null;
  sentAt: Date | null;
  errorCode: string | null;
  contractId: string | null;
  formAssignmentId: string | null;
  type: string;
}

export async function findAttemptByKey(
  db: CommunicationDb,
  organizationId: string,
  idempotencyKey: string,
): Promise<CommunicationSnapshot | null> {
  return db.cfCommunication.findFirst({ where: { organizationId, idempotencyKey } });
}

/** The recorded outcome of an earlier attempt, in the same shape the n8n delivery results use. */
export type RecordedDelivery =
  | { status: 'sent'; sentAt: string }
  | { status: 'failed'; reason: string }
  | { status: 'pending' };

export function recordedDelivery(communication: CommunicationSnapshot): RecordedDelivery {
  if (communication.status === COMMUNICATION_STATUS.sent && communication.sentAt) {
    return { status: 'sent', sentAt: communication.sentAt.toISOString() };
  }
  if (communication.status === COMMUNICATION_STATUS.failed) {
    return { status: 'failed', reason: communication.errorCode ?? 'unknown' };
  }
  return { status: 'pending' };
}
