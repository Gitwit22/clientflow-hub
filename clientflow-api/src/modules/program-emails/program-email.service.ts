import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CfCommunication, CfProgramEmail, Prisma } from '../../generated/clientflow';
import { findProgramForOrg } from '../../common/tenancy/org-scoped.repository';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMUNICATION_STATUS, DELIVERY_SOURCE, attemptEventId, isUniqueViolation } from '../communications/communication-attempts';
import { buildRecipientList, type SkippedMember } from './program-email-recipients';

export interface ProgramEmailActor {
  id: string | null;
  displayName: string;
}

export const PROGRAM_EMAIL_STATUS = { sending: 'SENDING', completed: 'COMPLETED' } as const;

const SUBJECT_MAX = 200;
const BODY_MAX = 20_000;
/** A recipient left "sending" this long (the server stopped mid-send) is picked up again. */
const STALE_SENDING_MS = 2 * 60_000;

/** One recipient's outcome. "accepted" means the email provider took it; delivery is not confirmed. */
export type RecipientOutcome = 'pending' | 'sending' | 'accepted' | 'failed';

const OUTCOME_BY_STATUS: Record<string, RecipientOutcome> = {
  [COMMUNICATION_STATUS.requested]: 'pending',
  [COMMUNICATION_STATUS.sending]: 'sending',
  [COMMUNICATION_STATUS.sent]: 'accepted',
  [COMMUNICATION_STATUS.failed]: 'failed',
};

export interface ProgramEmailCounts {
  pending: number;
  sending: number;
  accepted: number;
  failed: number;
}

export interface ProgramEmailSummary {
  id: string;
  programId: string;
  subject: string;
  body: string;
  sentByDisplayName: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  recipientCount: number;
  skippedCount: number;
  counts: ProgramEmailCounts;
}

export interface ProgramEmailDetail extends ProgramEmailSummary {
  recipients: Array<{
    communicationId: string;
    clientId: string;
    name: string;
    businessName: string;
    email: string;
    outcome: RecipientOutcome;
    errorCode: string | null;
    acceptedAt: Date | null;
  }>;
  skipped: SkippedMember[];
}

interface RecipientContext {
  name: string;
  businessName: string;
}

function contextOf(communication: Pick<CfCommunication, 'templateContext'>): RecipientContext {
  const value = communication.templateContext;
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    name: typeof record.recipientName === 'string' ? record.recipientName : '',
    businessName: typeof record.businessName === 'string' ? record.businessName : '',
  };
}

const MAX_CHOSEN = 5_000;

/** The members chosen to receive the email, or undefined for everyone in the program. */
function chosenMembers(value: unknown): Set<string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) {
    throw new BadRequestException('clientIds must be a list of client ids.');
  }
  if (!value.length) throw new BadRequestException('Choose at least one member, or send to everyone.');
  if (value.length > MAX_CHOSEN) throw new BadRequestException('Too many members chosen.');
  return new Set(value as string[]);
}

function skippedOf(email: Pick<CfProgramEmail, 'skipped'>): SkippedMember[] {
  return Array.isArray(email.skipped) ? (email.skipped as unknown as SkippedMember[]) : [];
}

/**
 * Program-wide email: one message sent separately to every member of a program.
 *
 * Sending happens on the server after the request returns, one recipient at a time, so a long list
 * never depends on a browser request staying open. Each recipient is a CfCommunication row created
 * up front with its own provider event id; a row is claimed with a conditional update before it is
 * sent, and the n8n workflow ignores an event id it already sent, so a retry, a second worker or a
 * restart mid-send never emails anyone twice.
 */
@Injectable()
export class ProgramEmailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProgramEmailService.name);
  /** Emails being worked on by this server process, and the work in progress. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly n8n?: N8nService,
  ) {}

  /** Picks up any email still sending when the server last stopped. */
  onApplicationBootstrap() {
    void this.resumeUnfinished().catch((error: unknown) =>
      this.logger.warn(`Could not resume program emails: ${error instanceof Error ? error.message : 'unknown error'}`),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Recipients
  // ---------------------------------------------------------------------------------------------

  /** Who the email would go to right now: everyone enrolled in the program, one copy per address. */
  async previewRecipients(organizationId: string, programId: string) {
    const program = await findProgramForOrg(this.prisma, organizationId, programId);
    const list = await this.recipientsFor(organizationId, program.id);
    return {
      program: { id: program.id, name: program.name },
      recipients: list.recipients,
      skipped: list.skipped,
      recipientCount: list.recipients.length,
      skippedCount: list.skipped.length,
    };
  }

  /**
   * Everyone enrolled, or only the chosen members when `onlyClientIds` is given. Members are chosen
   * before addresses are de-duplicated, so a chosen member who shares an address with someone left
   * out still gets the email.
   */
  private async recipientsFor(organizationId: string, programId: string, onlyClientIds?: ReadonlySet<string>) {
    // Every enrollment counts, whatever its status. Demo records are sample data, never emailed.
    const all = await this.prisma.cfProgramEnrollment.findMany({
      where: { organizationId, programId, isDemo: false },
      select: { id: true, clientId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (onlyClientIds) {
      const members = new Set(all.map((enrollment) => enrollment.clientId));
      if ([...onlyClientIds].some((clientId) => !members.has(clientId))) {
        throw new BadRequestException('Some of the chosen members are not in this program. Reload and choose again.');
      }
    }
    const enrollments = onlyClientIds ? all.filter((enrollment) => onlyClientIds.has(enrollment.clientId)) : all;
    if (!enrollments.length) return buildRecipientList([]);
    const clients = await this.prisma.cfClient.findMany({
      where: { organizationId, id: { in: [...new Set(enrollments.map((enrollment) => enrollment.clientId))] }, isDemo: false },
      select: { id: true, businessName: true, primaryContactName: true, email: true },
    });
    const byId = new Map(clients.map((client) => [client.id, client]));
    return buildRecipientList(
      enrollments.flatMap((enrollment) => {
        const client = byId.get(enrollment.clientId);
        return client
          ? [{
              clientId: client.id,
              enrollmentId: enrollment.id,
              businessName: client.businessName,
              contactName: client.primaryContactName,
              email: client.email,
            }]
          : [];
      }),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------

  /**
   * Records the email and its recipients, then sends in the background. The same idempotency key
   * returns the email already created for it (a double-click or a retried request), never a second one.
   */
  async create(
    organizationId: string,
    actor: ProgramEmailActor,
    programId: string,
    input: { subject?: unknown; body?: unknown; clientIds?: unknown; idempotencyKey: string | null },
  ): Promise<ProgramEmailDetail> {
    if (!input.idempotencyKey) throw new BadRequestException('An Idempotency-Key header is required to send a program email.');
    const prior = await this.prisma.cfProgramEmail.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
    if (prior) {
      if (prior.programId !== programId) throw new BadRequestException('This Idempotency-Key was already used for another program.');
      return this.detailOf(prior);
    }

    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!subject) throw new BadRequestException('Enter a subject.');
    if (subject.length > SUBJECT_MAX) throw new BadRequestException(`Keep the subject under ${SUBJECT_MAX} characters.`);
    if (!body) throw new BadRequestException('Enter a message.');
    if (body.length > BODY_MAX) throw new BadRequestException(`Keep the message under ${BODY_MAX.toLocaleString('en-US')} characters.`);

    const chosen = chosenMembers(input.clientIds);

    const program = await findProgramForOrg(this.prisma, organizationId, programId);
    const list = await this.recipientsFor(organizationId, program.id, chosen);
    if (!list.recipients.length) {
      throw new BadRequestException(
        chosen ? 'None of the chosen members has a usable email address.' : 'Nobody in this program has a usable email address.',
      );
    }

    const emailId = randomUUID();
    const now = new Date();
    let email: CfProgramEmail;
    try {
      email = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.cfProgramEmail.create({
          data: {
            id: emailId,
            organizationId,
            programId: program.id,
            subject,
            body,
            sentByUserId: actor.id,
            sentByDisplayName: actor.displayName,
            idempotencyKey: input.idempotencyKey!,
            status: PROGRAM_EMAIL_STATUS.sending,
            recipientCount: list.recipients.length,
            skippedCount: list.skipped.length,
            skipped: list.skipped as unknown as Prisma.InputJsonValue,
          },
        });
        await transaction.cfCommunication.createMany({
          data: list.recipients.map((recipient) => {
            const communicationId = randomUUID();
            return {
              id: communicationId,
              organizationId,
              clientId: recipient.clientId,
              enrollmentId: recipient.enrollmentId,
              eventId: attemptEventId('program.email', emailId, communicationId),
              recipientEmail: recipient.email,
              channel: 'email',
              provider: 'n8n',
              status: COMMUNICATION_STATUS.requested,
              requestedAt: now,
              type: 'program_email',
              direction: 'outbound',
              subject,
              renderedSubject: subject,
              renderedBody: body,
              templateContext: { recipientName: recipient.name, businessName: recipient.businessName, programName: program.name },
              notes: `Program email to ${program.name} members.`,
              date: now,
              staffMember: actor.displayName,
              createdByUserId: actor.id,
              source: DELIVERY_SOURCE.manual,
              programEmailId: emailId,
            };
          }),
        });
        return created;
      });
    } catch (error) {
      // The same key raced in from another request: return that email.
      if (isUniqueViolation(error)) {
        const raced = await this.prisma.cfProgramEmail.findFirst({ where: { organizationId, idempotencyKey: input.idempotencyKey } });
        if (raced) return this.detailOf(raced);
      }
      throw error;
    }

    this.startSending(organizationId, email.id);
    return this.detailOf(email);
  }

  /** Sends again to the recipients that failed. Anyone already accepted is never sent to again. */
  async retryFailed(organizationId: string, emailId: string): Promise<ProgramEmailDetail> {
    const email = await this.requireEmail(organizationId, emailId);
    await this.prisma.cfCommunication.updateMany({
      where: { organizationId, programEmailId: email.id, status: COMMUNICATION_STATUS.failed },
      data: { status: COMMUNICATION_STATUS.requested, errorCode: null, failedAt: null },
    });
    if (!this.running.has(email.id)) await this.requeueStale(email.id);
    const reopened = await this.reopenIfPending(email);
    this.startSending(organizationId, email.id);
    return this.detailOf(reopened);
  }

  /** Starts (or joins) sending this email in the background; returns at once. */
  startSending(organizationId: string, emailId: string) {
    if (this.running.has(emailId)) return;
    const work = this.drain(organizationId, emailId)
      .then(async () => {
        this.running.delete(emailId);
        // A retry that arrived while this run was finishing queued recipients it did not see.
        const waiting = await this.prisma.cfCommunication.count({
          where: { programEmailId: emailId, status: COMMUNICATION_STATUS.requested },
        });
        if (waiting > 0) {
          this.startSending(organizationId, emailId);
          await this.running.get(emailId);
        }
      })
      .catch((error: unknown) => {
        this.running.delete(emailId);
        this.logger.error(`Program email ${emailId} stopped: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
    this.running.set(emailId, work);
  }

  /** Resolves when this process has no work left on the email (used by tests and shutdown). */
  async whenIdle(emailId: string): Promise<void> {
    await this.running.get(emailId);
  }

  /** Sends every waiting recipient of one email, one at a time, then marks the email complete. */
  private async drain(organizationId: string, emailId: string): Promise<void> {
    const email = await this.prisma.cfProgramEmail.findFirst({ where: { id: emailId, organizationId } });
    if (!email) return;
    const program = await this.prisma.cfProgram.findFirst({
      where: { id: email.programId, organizationId: email.organizationId },
      select: { name: true },
    });
    for (;;) {
      const next = await this.prisma.cfCommunication.findFirst({
        where: { programEmailId: email.id, status: COMMUNICATION_STATUS.requested },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) break;
      // Claim it first: another worker that got here already owns it.
      const claimed = await this.prisma.cfCommunication.updateMany({
        where: { id: next.id, status: COMMUNICATION_STATUS.requested },
        data: { status: COMMUNICATION_STATUS.sending },
      });
      if (claimed.count !== 1) continue;
      await this.sendOne(email, program?.name ?? 'your program', next);
    }
    await this.completeIfDone(email.id);
  }

  private async sendOne(email: CfProgramEmail, programName: string, communication: CfCommunication) {
    const context = contextOf(communication);
    let result: { status: 'sent'; sentAt: string } | { status: 'skipped' | 'failed'; reason: string };
    if (!this.n8n) {
      result = { status: 'failed', reason: 'not_configured' };
    } else {
      try {
        result = await this.n8n.sendProgramEmail(communication.eventId!, {
          organizationId: email.organizationId,
          clientId: communication.clientId,
          sentByUserId: email.sentByUserId ?? 'system',
          recipientEmail: communication.recipientEmail!,
          clientName: context.name || context.businessName || 'there',
          programName,
          programEmailId: email.id,
          subject: email.subject,
          body: email.body,
        });
      } catch (error) {
        this.logger.warn(`Program email ${email.id} recipient ${communication.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
        result = { status: 'failed', reason: 'unavailable' };
      }
    }
    const now = new Date();
    await this.prisma.cfCommunication.update({
      where: { id: communication.id },
      data:
        result.status === 'sent'
          ? { status: COMMUNICATION_STATUS.sent, sentAt: new Date(result.sentAt), errorCode: null, failedAt: null }
          : { status: COMMUNICATION_STATUS.failed, errorCode: result.reason, failedAt: now },
    });
  }

  private async completeIfDone(emailId: string) {
    const open = await this.prisma.cfCommunication.count({
      where: { programEmailId: emailId, status: { in: [COMMUNICATION_STATUS.requested, COMMUNICATION_STATUS.sending] } },
    });
    if (open > 0) return;
    await this.prisma.cfProgramEmail.updateMany({
      where: { id: emailId, status: PROGRAM_EMAIL_STATUS.sending },
      data: { status: PROGRAM_EMAIL_STATUS.completed, completedAt: new Date() },
    });
  }

  private async reopenIfPending(email: CfProgramEmail): Promise<CfProgramEmail> {
    const pending = await this.prisma.cfCommunication.count({
      where: { programEmailId: email.id, status: COMMUNICATION_STATUS.requested },
    });
    if (pending === 0) return email;
    return this.prisma.cfProgramEmail.update({
      where: { id: email.id },
      data: { status: PROGRAM_EMAIL_STATUS.sending, completedAt: null },
    });
  }

  /**
   * A recipient still "sending" with no worker on it was cut off by a stopped server. It goes back
   * in the queue with the same event id, which n8n will not send twice.
   */
  private async requeueStale(emailId: string) {
    await this.prisma.cfCommunication.updateMany({
      where: {
        programEmailId: emailId,
        status: COMMUNICATION_STATUS.sending,
        updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) },
      },
      data: { status: COMMUNICATION_STATUS.requested },
    });
  }

  async resumeUnfinished() {
    const unfinished = await this.prisma.cfProgramEmail.findMany({
      where: { status: PROGRAM_EMAIL_STATUS.sending },
      select: { id: true, organizationId: true },
    });
    for (const email of unfinished) {
      // At startup nothing in this process is sending, so every "sending" row was cut off.
      await this.prisma.cfCommunication.updateMany({
        where: { programEmailId: email.id, status: COMMUNICATION_STATUS.sending },
        data: { status: COMMUNICATION_STATUS.requested },
      });
      this.startSending(email.organizationId, email.id);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------------------------

  async list(organizationId: string, programId: string): Promise<ProgramEmailSummary[]> {
    await findProgramForOrg(this.prisma, organizationId, programId);
    const emails = await this.prisma.cfProgramEmail.findMany({
      where: { organizationId, programId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    if (!emails.length) return [];
    const rows = await this.prisma.cfCommunication.findMany({
      where: { organizationId, programEmailId: { in: emails.map((email) => email.id) } },
      select: { programEmailId: true, status: true },
    });
    return emails.map((email) => this.summaryOf(email, rows.filter((row) => row.programEmailId === email.id)));
  }

  async get(organizationId: string, emailId: string): Promise<ProgramEmailDetail> {
    return this.detailOf(await this.requireEmail(organizationId, emailId));
  }

  private async requireEmail(organizationId: string, emailId: string) {
    const email = await this.prisma.cfProgramEmail.findFirst({ where: { id: emailId, organizationId } });
    if (!email) throw new NotFoundException('Program email not found.');
    return email;
  }

  private summaryOf(email: CfProgramEmail, rows: Array<{ status: string | null }>): ProgramEmailSummary {
    const counts: ProgramEmailCounts = { pending: 0, sending: 0, accepted: 0, failed: 0 };
    for (const row of rows) counts[OUTCOME_BY_STATUS[row.status ?? ''] ?? 'pending'] += 1;
    return {
      id: email.id,
      programId: email.programId,
      subject: email.subject,
      body: email.body,
      sentByDisplayName: email.sentByDisplayName,
      status: email.status,
      createdAt: email.createdAt,
      completedAt: email.completedAt,
      recipientCount: email.recipientCount,
      skippedCount: email.skippedCount,
      counts,
    };
  }

  private async detailOf(email: CfProgramEmail): Promise<ProgramEmailDetail> {
    const rows = await this.prisma.cfCommunication.findMany({
      where: { organizationId: email.organizationId, programEmailId: email.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...this.summaryOf(email, rows),
      recipients: rows.map((row) => {
        const context = contextOf(row);
        return {
          communicationId: row.id,
          clientId: row.clientId,
          name: context.name,
          businessName: context.businessName,
          email: row.recipientEmail ?? '',
          outcome: OUTCOME_BY_STATUS[row.status ?? ''] ?? 'pending',
          errorCode: row.errorCode,
          acceptedAt: row.status === COMMUNICATION_STATUS.sent ? row.sentAt : null,
        };
      }),
      skipped: skippedOf(email),
    };
  }
}
