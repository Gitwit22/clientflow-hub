import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { N8nHttpError, N8nService } from '../../integrations/n8n/n8n.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  attemptEventId,
  COMMUNICATION_STATUS,
  DELIVERY_SOURCE,
  findAttemptByKey,
  isUniqueViolation,
  type CommunicationSnapshot,
  type DeliverySource,
} from '../communications/communication-attempts';

export interface FormDeliveryActor {
  id: string;
  displayName: string;
}

const FORM_STATUS = { draft: 'draft', sent: 'sent' } as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Creating and emailing form assignments to clients. Every send writes a communication row and an
 * activity row (with the staff member and source) using the shared idempotency convention, so a
 * manual send leaves the same trail as the contract and welcome sends.
 */
@Injectable()
export class FormDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly n8n: N8nService,
  ) {}

  /**
   * Creates a draft assignment. A program form must be tied to an enrollment in that program: an
   * explicit enrollmentId must belong to the client and match the form's program, and when none is
   * given it is resolved from the client's enrollment in the form's program.
   */
  async createAssignment(organizationId: string, actor: FormDeliveryActor, body: Record<string, unknown>) {
    const clientId = text(body.clientId);
    const formId = text(body.formId);
    if (!clientId || !formId) throw new BadRequestException('clientId and formId are required.');

    const [client, template] = await Promise.all([
      this.prisma.cfClient.findFirst({ where: { id: clientId, organizationId }, select: { id: true } }),
      this.prisma.cfFormTemplate.findFirst({ where: { id: formId, organizationId }, select: { id: true, programId: true, name: true } }),
    ]);
    if (!client) throw new NotFoundException('Client not found.');
    if (!template) throw new NotFoundException('Form template not found.');

    const requestedEnrollmentId = text(body.enrollmentId);
    let enrollmentId: string | null = null;
    if (requestedEnrollmentId) {
      const enrollment = await this.prisma.cfProgramEnrollment.findFirst({
        where: { id: requestedEnrollmentId, clientId, organizationId },
        select: { id: true, programId: true },
      });
      if (!enrollment) throw new NotFoundException('Program enrollment not found for this client.');
      if (template.programId && enrollment.programId !== template.programId) {
        throw new BadRequestException('This form belongs to a different program than the selected enrollment.');
      }
      enrollmentId = enrollment.id;
    } else if (template.programId) {
      const enrollment = await this.prisma.cfProgramEnrollment.findFirst({
        where: { clientId, organizationId, programId: template.programId },
        select: { id: true },
      });
      if (!enrollment) {
        throw new BadRequestException('Enroll the client in this form\'s program before sending a program form.');
      }
      enrollmentId = enrollment.id;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const appUrl = (process.env.APP_URL ?? 'https://clientflow-2g9.pages.dev').replace(/\/$/, '');
    const dueDate = text(body.dueDate);
    const created = await this.prisma.cfFormAssignment.create({
      data: {
        organizationId,
        clientId,
        enrollmentId,
        formId,
        assignedUserId: text(body.assignedUserId),
        completionMethod: text(body.completionMethod),
        deliveryMethod: text(body.deliveryMethod),
        recipientEmail: text(body.recipientEmail),
        recipientPhone: text(body.recipientPhone),
        status: FORM_STATUS.draft,
        dueAt: dueDate ? new Date(dueDate) : null,
        dueDate,
        expiresAt: dueDate ? new Date(dueDate) : null,
        sentAt: null,
        // Only the hash is stored. The working link is returned once, in this response, so staff
        // can open it right away; a database read or an admin list can never reveal a live link.
        secureLink: null,
        secureLinkToken: tokenHash,
        createdByUserId: actor.id,
      },
    });
    return { ...withoutLinkSecrets(created), secureLink: `${appUrl}/s/${rawToken}` };
  }

  async send(
    organizationId: string,
    actor: FormDeliveryActor,
    assignmentId: string,
    input: { personalMessage?: unknown; idempotencyKey?: string | null; source?: DeliverySource },
  ) {
    const assignment = await this.prisma.cfFormAssignment.findFirst({ where: { id: assignmentId, organizationId } });
    if (!assignment) throw new NotFoundException('Form assignment not found.');

    // A retried request returns the first attempt instead of emailing again.
    if (input.idempotencyKey) {
      const prior = await findAttemptByKey(this.prisma, organizationId, input.idempotencyKey);
      if (prior) return this.replay(prior, assignment);
    }

    if (!assignment.recipientEmail) throw new BadRequestException('A recipient email is required before sending.');
    const [client, form] = await Promise.all([
      this.prisma.cfClient.findFirst({
        where: { id: assignment.clientId, organizationId },
        select: { primaryContactName: true, isDemo: true },
      }),
      this.prisma.cfFormTemplate.findFirst({
        where: { id: assignment.formId, organizationId },
        select: { name: true, dueInDays: true },
      }),
    ]);
    if (!client || !form) throw new NotFoundException('Form assignment details not found.');

    // An assignment without its own due date is due the template's dueInDays after it is sent, and
    // that date is saved so the email and the record agree.
    const sendTime = new Date();
    const defaultDue = assignment.dueDate || assignment.expiresAt
      ? null
      : new Date(sendTime.getTime() + (form.dueInDays ?? 7) * 86_400_000);

    // Raw links are never stored, so each send issues a fresh one (the previous link stops working).
    const rawToken = randomBytes(32).toString('base64url');
    const appUrl = (process.env.APP_URL ?? 'https://clientflow-2g9.pages.dev').replace(/\/$/, '');
    const formUrl = `${appUrl}/s/${rawToken}`;
    await this.prisma.cfFormAssignment.update({
      where: { id: assignment.id },
      data: {
        secureLink: null,
        secureLinkToken: createHash('sha256').update(rawToken).digest('hex'),
        ...(defaultDue ? { dueAt: defaultDue, dueDate: defaultDue.toISOString().slice(0, 10) } : {}),
      },
    });

    const availability = this.n8n.getIntakeAvailability();
    const now = new Date();
    const communicationId = randomUUID();
    const eventId = attemptEventId('form.send', assignment.id, communicationId);
    let communication: { id: string };
    try {
      communication = await this.prisma.cfCommunication.create({
        data: {
          id: communicationId,
          organizationId,
          clientId: assignment.clientId,
          enrollmentId: assignment.enrollmentId,
          eventId,
          formAssignmentId: assignment.id,
          formId: assignment.formId,
          recipientEmail: assignment.recipientEmail,
          channel: 'email',
          provider: 'n8n',
          status: availability === 'ready' ? COMMUNICATION_STATUS.requested : COMMUNICATION_STATUS.failed,
          requestedAt: now,
          errorCode: availability === 'ready' ? null : availability,
          type: 'form_email',
          direction: 'outbound',
          subject: form.name,
          notes: availability === 'ready' ? 'Form email requested by staff.' : 'Form email blocked before send.',
          date: now,
          staffMember: actor.displayName,
          createdByUserId: actor.id,
          source: input.source ?? DELIVERY_SOURCE.manual,
          idempotencyKey: input.idempotencyKey ?? null,
          isDemo: client.isDemo,
        },
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error)) {
        const prior = await findAttemptByKey(this.prisma, organizationId, input.idempotencyKey);
        if (prior) return this.replay(prior, assignment);
      }
      throw error;
    }

    if (availability !== 'ready') {
      await this.recordFailure(organizationId, actor, assignment, form.name, communication.id, availability, input.source);
      throw new ServiceUnavailableException('Email delivery is unavailable.');
    }

    await this.prisma.cfCommunication.update({
      where: { id: communication.id },
      data: { status: COMMUNICATION_STATUS.sending },
    });

    let receipt: { status: string; sentAt: string };
    try {
      receipt = await this.n8n.deliver({
        eventId,
        eventType: 'form.send',
        organizationId,
        clientId: assignment.clientId,
        formId: assignment.formId,
        recipientEmail: assignment.recipientEmail,
        clientName: client.primaryContactName,
        formName: form.name,
        formUrl,
        expiresAt: assignment.expiresAt?.toISOString() ?? null,
        sentByUserId: actor.id,
        dueDate:
          assignment.dueDate || assignment.expiresAt?.toISOString() || (defaultDue ?? sendTime).toISOString().slice(0, 10),
        ...(typeof input.personalMessage === 'string' && input.personalMessage.trim()
          ? { personalMessage: input.personalMessage.trim() }
          : {}),
        occurredAt: now.toISOString(),
      });
    } catch (error) {
      const reason = error instanceof N8nHttpError
        ? error.reason
        : error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'rejected';
      await this.recordFailure(organizationId, actor, assignment, form.name, communication.id, reason, input.source);
      throw error;
    }

    const sentAt = new Date(receipt.sentAt);
    const updatedAssignment = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.cfFormAssignment.update({
        where: { id: assignment.id },
        data: { status: FORM_STATUS.sent, sentAt },
      });
      await tx.cfCommunication.update({
        where: { id: communication.id },
        data: { status: COMMUNICATION_STATUS.sent, sentAt, failedAt: null, errorCode: null },
      });
      await tx.cfActivityLog.create({
        data: {
          organizationId,
          clientId: assignment.clientId,
          enrollmentId: assignment.enrollmentId,
          actorUserId: actor.id,
          action: 'FORM_EMAIL_SENT',
          description: `${form.name} emailed to the client.`,
          user: actor.displayName,
          source: input.source ?? DELIVERY_SOURCE.manual,
        },
      });
      return updated;
    });

    return {
      success: true as const,
      status: receipt.status,
      message: 'Email accepted for delivery',
      provider: 'N8N_GMAIL' as const,
      formId: assignment.formId,
      recipientEmail: assignment.recipientEmail,
      sentAt: receipt.sentAt,
      assignment: updatedAssignment,
    };
  }

  private async recordFailure(
    organizationId: string,
    actor: FormDeliveryActor,
    assignment: { id: string; clientId: string; enrollmentId: string | null },
    formName: string,
    communicationId: string,
    reason: string,
    source: DeliverySource = DELIVERY_SOURCE.manual,
  ) {
    await this.prisma.cfCommunication.update({
      where: { id: communicationId },
      data: { status: COMMUNICATION_STATUS.failed, failedAt: new Date(), errorCode: reason },
    });
    await this.prisma.cfActivityLog.create({
      data: {
        organizationId,
        clientId: assignment.clientId,
        enrollmentId: assignment.enrollmentId,
        actorUserId: actor.id,
        action: 'FORM_EMAIL_FAILED',
        description: `${formName} could not be emailed: ${reason}.`,
        user: actor.displayName,
        source,
      },
    });
  }

  private replay(
    prior: CommunicationSnapshot,
    assignment: { formId: string; recipientEmail: string | null },
  ) {
    if (prior.status === COMMUNICATION_STATUS.sent && prior.sentAt) {
      return {
        success: true as const,
        status: 'SENT',
        message: 'Email accepted for delivery',
        provider: 'N8N_GMAIL' as const,
        formId: assignment.formId,
        recipientEmail: assignment.recipientEmail,
        sentAt: prior.sentAt.toISOString(),
        replayed: true as const,
      };
    }
    if (prior.status === COMMUNICATION_STATUS.failed) {
      throw new ServiceUnavailableException('Email delivery is unavailable.');
    }
    throw new ConflictException('This send is already in progress.');
  }
}

/** Form assignment rows as returned to staff: never the link hash or a stored raw link. */
export function withoutLinkSecrets<T extends { secureLink?: string | null; secureLinkToken?: string | null }>(
  assignment: T,
): Omit<T, 'secureLink' | 'secureLinkToken'> {
  const rest: Partial<T> = { ...assignment };
  delete rest.secureLink;
  delete rest.secureLinkToken;
  return rest as Omit<T, 'secureLink' | 'secureLinkToken'>;
}
