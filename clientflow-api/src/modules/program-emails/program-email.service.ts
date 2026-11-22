import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CfCommunication, CfProgramEmail, Prisma } from '../../generated/clientflow';
import { findProgramForOrg } from '../../common/tenancy/org-scoped.repository';
import { EMAIL_SENDER_NAME, emailDocumentHtml, formattedTextToEmail } from '../../integrations/n8n/email-body';
import { emailImageKeyFor, emailImagesIn } from '../../integrations/n8n/email-images';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { isSendableEmail } from '../communications/recipient';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMUNICATION_STATUS, DELIVERY_SOURCE, attemptEventId, isUniqueViolation } from '../communications/communication-attempts';
import { buildRecipientList, type ProgramEmailRecipient, type SkippedMember } from './program-email-recipients';
import {
  AUTOMATION_EMAIL_FIELDS,
  renderAutomationText,
  sampleAutomationValues,
  unknownAutomationFields,
  type AutomationEmailField,
} from '../automation/automation-email';

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
  /** The contact name as entered; absent on recipients queued before it was recorded. */
  contactName: string | null;
  businessName: string;
}

function contextOf(communication: Pick<CfCommunication, 'templateContext'>): RecipientContext {
  const value = communication.templateContext;
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    name: typeof record.recipientName === 'string' ? record.recipientName : '',
    contactName: typeof record.contactName === 'string' ? record.contactName : null,
    businessName: typeof record.businessName === 'string' ? record.businessName : '',
  };
}

/**
 * The fields a program email can personalize with: the client fields shared with automatic emails,
 * without the assigned staff member (a blast is from whoever writes it).
 */
export const PROGRAM_EMAIL_FIELDS = AUTOMATION_EMAIL_FIELDS.filter((field) => field.key !== 'staff.name');

type FieldValues = Partial<Record<AutomationEmailField, string | null | undefined>>;

function messageFrom(input: { subject?: unknown; body?: unknown }, options: { checkFields?: boolean } = {}) {
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!subject) throw new BadRequestException('Enter a subject.');
  if (subject.length > SUBJECT_MAX) throw new BadRequestException(`Keep the subject under ${SUBJECT_MAX} characters.`);
  if (!body) throw new BadRequestException('Enter a message.');
  if (body.length > BODY_MAX) throw new BadRequestException(`Keep the message under ${BODY_MAX.toLocaleString('en-US')} characters.`);
  if (options.checkFields !== false) {
    const unknown = unknownProgramEmailFields(`${subject}\n${body}`);
    if (unknown.length) {
      throw new BadRequestException(
        `${unknown.map((name) => `{{${name}}}`).join(', ')} ${unknown.length === 1 ? "isn't a field" : "aren't fields"} ClientFlow can fill in. Use one of: ${PROGRAM_EMAIL_FIELDS.map((field) => `{{${field.key}}}`).join(', ')}.`,
      );
    }
  }
  return { subject, body };
}

/** Fields in the text a program email can't fill in (unknown names, or the assigned staff member). */
function unknownProgramEmailFields(text: string): string[] {
  const known = new Set<string>(PROGRAM_EMAIL_FIELDS.map((field) => field.key));
  const staffNames = new Set(['staff.name', 'staffName']);
  const found = new Set(unknownAutomationFields(text));
  for (const match of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    if (staffNames.has(match[1]) && !known.has(match[1])) found.add(match[1]);
  }
  return [...found];
}

/** Fills a program email's fields for one person. Values are filled before formatting, which escapes them. */
function personalize(text: string, values: FieldValues): string {
  return renderAutomationText(text, values);
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

const MAX_PROGRAMS = 100;

/** The programs chosen for a multi-program email, in the order chosen, each id once. */
function chosenProgramIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) {
    throw new BadRequestException('programIds must be a list of program ids.');
  }
  const ids = [...new Set(value as string[])];
  if (!ids.length) throw new BadRequestException('Choose at least one program.');
  if (ids.length > MAX_PROGRAMS) throw new BadRequestException('Too many programs chosen.');
  return ids;
}

/** One program's part of a multi-program email: who it sends to, after earlier programs took theirs. */
interface ProgramShare {
  program: { id: string; name: string };
  /** Members to choose for this program's email: new recipients plus new members with no usable address. */
  clientIds: string[];
  recipients: ProgramEmailRecipient[];
  skipped: SkippedMember[];
  /** Members left out because an earlier program already emails them (or their address). */
  alreadyIncluded: number;
}

export interface MultiProgramEmailResult {
  emails: ProgramEmailDetail[];
  /** Programs with nobody new to email (everyone is reached through an earlier program, or nobody is reachable). */
  skippedPrograms: Array<{ programId: string; programName: string }>;
  recipientCount: number;
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
    @Optional() private readonly storage?: StorageService,
  ) {}

  /**
   * Every image in a message must be one this organization uploaded for emails (a finished upload in
   * its email-images folder of the public bucket). Anything else is refused, so an email can't
   * carry a tracking pixel, another organization's image or a link that might later change.
   */
  private async assertEmailImages(organizationId: string, body: string): Promise<void> {
    const images = emailImagesIn(body);
    if (!images.length) return;
    if (!this.storage?.isPublicAssetsConfigured()) {
      throw new BadRequestException("Images can't be added yet: public image storage isn't configured.");
    }
    for (const image of images) {
      const key = emailImageKeyFor(this.storage, organizationId, image.url);
      const stored = key
        ? await this.prisma.cfStoredFile.findFirst({
            where: { organizationId, storageKey: key, storageBucket: 'public', status: 'READY' },
            select: { id: true },
          })
        : null;
      if (!stored) {
        throw new BadRequestException('Add images with the Image button. One of the images in this message was not uploaded for these emails.');
      }
    }
  }

  /**
   * Sends one copy of the message to the signed-in staff member, marked [Test]. Nothing is recorded
   * against members or the program's email history.
   */
  async sendTest(
    organizationId: string,
    actor: ProgramEmailActor & { email: string },
    programId: string,
    input: { subject?: unknown; body?: unknown; sampleClientId?: unknown },
  ) {
    const message = messageFrom(input);
    await this.assertEmailImages(organizationId, message.body);
    const program = await findProgramForOrg(this.prisma, organizationId, programId);
    // Filled in as for the chosen member (or sample details), so the test reads like the real thing.
    const { values } = await this.sampleValues(organizationId, program, input.sampleClientId);
    const subject = personalize(message.subject, values);
    const body = personalize(message.body, values);
    if (!isSendableEmail(actor.email)) throw new BadRequestException('Your account has no email address a test can be sent to.');
    if (!this.n8n) throw new ServiceUnavailableException('Email delivery is not set up.');
    const delivery = await this.n8n.sendProgramEmail(`program.email.test:${randomUUID()}`, {
      organizationId,
      // The test goes to the staff member themself; no client is involved.
      clientId: actor.id ?? 'staff',
      sentByUserId: actor.id ?? 'staff',
      ...(actor.id ? { senderUserId: actor.id } : {}),
      recipientEmail: actor.email,
      clientName: actor.displayName,
      programName: program.name,
      programId: program.id,
      programEmailId: 'test',
      subject: `[Test] ${subject}`,
      body,
    });
    return { recipientEmail: actor.email, delivery };
  }

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
    // Every enrollment counts, whatever its status, except archived ones: an archived client, or a
    // participation archived when its final report was finalized, is out of the program's working
    // list. Test clients get the email too (that is what they are for); they are marked isTest.
    const enrollments = await this.prisma.cfProgramEnrollment.findMany({
      where: { organizationId, programId, isArchived: false },
      select: { id: true, clientId: true },
      orderBy: { createdAt: 'asc' },
    });
    const clients = enrollments.length
      ? await this.prisma.cfClient.findMany({
          where: { organizationId, id: { in: [...new Set(enrollments.map((enrollment) => enrollment.clientId))] }, isArchived: false },
          select: { id: true, businessName: true, primaryContactName: true, email: true, isDemo: true },
        })
      : [];
    const byId = new Map(clients.map((client) => [client.id, client]));
    const members = enrollments.flatMap((enrollment) => {
      const client = byId.get(enrollment.clientId);
      return client
        ? [{
            clientId: client.id,
            enrollmentId: enrollment.id,
            businessName: client.businessName,
            contactName: client.primaryContactName,
            email: client.email,
            ...(client.isDemo ? { isTest: true } : {}),
          }]
        : [];
    });
    if (onlyClientIds) {
      const memberIds = new Set(members.map((member) => member.clientId));
      if ([...onlyClientIds].some((clientId) => !memberIds.has(clientId))) {
        throw new BadRequestException('Some of the chosen members are not in this program. Reload and choose again.');
      }
    }
    return buildRecipientList(onlyClientIds ? members.filter((member) => onlyClientIds.has(member.clientId)) : members);
  }

  // ---------------------------------------------------------------------------------------------
  // Several programs at once
  // ---------------------------------------------------------------------------------------------

  /**
   * Splits the members of several programs so each person gets one copy. Programs are taken in the
   * order chosen; a member (or an address) already reached through an earlier program is left out
   * of later ones. `seen` may start with people an earlier attempt of the same send already covered.
   */
  private async shareOut(
    organizationId: string,
    programs: Array<{ id: string; name: string }>,
    seen = { clients: new Set<string>(), emails: new Set<string>() },
  ): Promise<ProgramShare[]> {
    const shares: ProgramShare[] = [];
    for (const program of programs) {
      shares.push(await this.shareFor(organizationId, program, seen));
    }
    return shares;
  }

  private async shareFor(
    organizationId: string,
    program: { id: string; name: string },
    seen: { clients: Set<string>; emails: Set<string> },
  ): Promise<ProgramShare> {
    const list = await this.recipientsFor(organizationId, program.id);
    let alreadyIncluded = 0;
    const recipients = list.recipients.filter((recipient) => {
      const fresh = !seen.clients.has(recipient.clientId) && !seen.emails.has(recipient.email);
      if (!fresh) alreadyIncluded += 1;
      return fresh;
    });
    // Within one program a second member sharing an address is already "duplicate_email"; across
    // programs that member is simply reached through the earlier program.
    const skipped = list.skipped.filter((member) => {
      if (seen.clients.has(member.clientId)) return false;
      if (member.reason === 'duplicate_email' && member.email && seen.emails.has(member.email)) return false;
      return true;
    });
    for (const recipient of recipients) {
      seen.clients.add(recipient.clientId);
      seen.emails.add(recipient.email);
    }
    for (const member of skipped) seen.clients.add(member.clientId);
    return {
      program,
      clientIds: [...recipients.map((recipient) => recipient.clientId), ...skipped.filter((member) => member.reason !== 'duplicate_email').map((member) => member.clientId)],
      recipients,
      skipped,
      alreadyIncluded,
    };
  }

  private async programsFor(organizationId: string, programIds: unknown) {
    const programs: Array<{ id: string; name: string }> = [];
    for (const id of chosenProgramIds(programIds)) {
      const program = await findProgramForOrg(this.prisma, organizationId, id);
      programs.push({ id: program.id, name: program.name });
    }
    return programs;
  }

  /** Who an email to several programs would reach right now: one copy per person, per address. */
  async previewMultiRecipients(organizationId: string, programIds: unknown) {
    const shares = await this.shareOut(organizationId, await this.programsFor(organizationId, programIds));
    const recipients = shares.flatMap((share) => share.recipients.map((recipient) => ({ ...recipient, programId: share.program.id })));
    const skipped = shares.flatMap((share) => share.skipped);
    return {
      programs: shares.map((share) => ({
        id: share.program.id,
        name: share.program.name,
        recipientCount: share.recipients.length,
        alreadyIncluded: share.alreadyIncluded,
      })),
      recipients,
      skipped,
      recipientCount: recipients.length,
      skippedCount: skipped.length,
    };
  }

  /**
   * One message to the members of several programs, each person once. It is recorded as one
   * program email per program (so each program's history, retry and email style keep working),
   * created with a key derived from the request's key: repeating the request returns the emails
   * already created and never sends a second copy, and a program already sent keeps the
   * recipients it recorded when the rest are worked out again.
   */
  async createForPrograms(
    organizationId: string,
    actor: ProgramEmailActor,
    input: { programIds?: unknown; subject?: unknown; body?: unknown; idempotencyKey: string | null },
  ): Promise<MultiProgramEmailResult> {
    if (!input.idempotencyKey) throw new BadRequestException('An Idempotency-Key header is required to send a program email.');
    const { subject, body } = messageFrom(input);
    await this.assertEmailImages(organizationId, body);
    const programs = await this.programsFor(organizationId, input.programIds);

    const seen = { clients: new Set<string>(), emails: new Set<string>() };
    const emails: ProgramEmailDetail[] = [];
    const skippedPrograms: MultiProgramEmailResult['skippedPrograms'] = [];
    for (const program of programs) {
      const key = `${input.idempotencyKey}:${program.id}`;
      const prior = await this.prisma.cfProgramEmail.findFirst({ where: { organizationId, idempotencyKey: key } });
      if (prior) {
        const detail = await this.detailOf(prior);
        for (const recipient of detail.recipients) {
          seen.clients.add(recipient.clientId);
          seen.emails.add(recipient.email.toLowerCase());
        }
        for (const member of detail.skipped) seen.clients.add(member.clientId);
        emails.push(detail);
        continue;
      }
      const share = await this.shareFor(organizationId, program, seen);
      if (!share.recipients.length) {
        skippedPrograms.push({ programId: program.id, programName: program.name });
        continue;
      }
      emails.push(await this.create(organizationId, actor, program.id, {
        subject,
        body,
        clientIds: share.clientIds,
        idempotencyKey: key,
      }));
    }
    if (!emails.length) throw new BadRequestException('Nobody in the chosen programs has a usable email address.');
    return { emails, skippedPrograms, recipientCount: emails.reduce((sum, email) => sum + email.recipientCount, 0) };
  }

  /**
   * The email exactly as a member would receive it (sender, subject, logo header, formatted message,
   * sign-off), built the same way the send builds it. Nothing is recorded or sent.
   */
  async preview(
    organizationId: string,
    programId: string,
    input: { subject?: unknown; body?: unknown; sampleClientId?: unknown },
    /** The staff member previewing: the email shows their role's signature, as it will be sent. */
    senderUserId?: string | null,
  ) {
    // A misspelled field stays visible in the preview; sending refuses it.
    const message = messageFrom(input, { checkFields: false });
    await this.assertEmailImages(organizationId, message.body);
    const program = await findProgramForOrg(this.prisma, organizationId, programId);
    const { values, previewedAs } = await this.sampleValues(organizationId, program, input.sampleClientId);
    const subject = personalize(message.subject, values);
    const body = personalize(message.body, values);
    let rendered: { html: string; text: string };
    if (this.n8n) {
      rendered = await this.n8n.previewProgramEmail(organizationId, body, program.id, senderUserId ?? undefined);
    } else {
      const formatted = formattedTextToEmail(body);
      rendered = { html: emailDocumentHtml(formatted.html), text: formatted.text };
    }
    return {
      programName: program.name,
      fromName: EMAIL_SENDER_NAME,
      subject,
      html: rendered.html,
      text: rendered.text,
      /** Whose details filled the fields; null when sample details were used. */
      previewedAs,
    };
  }

  /**
   * Field values for a preview or test: the chosen member's real details when they belong to this
   * program in this organization, otherwise sample details.
   */
  private async sampleValues(
    organizationId: string,
    program: { id: string; name: string },
    sampleClientId: unknown,
  ): Promise<{ values: FieldValues; previewedAs: string | null }> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const shared: FieldValues = {
      'program.name': program.name,
      ...(organization?.name ? { 'organization.name': organization.name } : {}),
    };
    if (typeof sampleClientId === 'string' && sampleClientId) {
      const enrollment = await this.prisma.cfProgramEnrollment.findFirst({
        where: { organizationId, programId: program.id, clientId: sampleClientId, isArchived: false },
        select: { id: true },
      });
      const client = enrollment
        ? await this.prisma.cfClient.findFirst({
            where: { id: sampleClientId, organizationId, isArchived: false },
            select: { businessName: true, primaryContactName: true },
          })
        : null;
      if (client) {
        return {
          values: { ...shared, 'client.contactName': client.primaryContactName, 'client.businessName': client.businessName },
          previewedAs: client.businessName.trim() || client.primaryContactName.trim() || null,
        };
      }
    }
    return { values: sampleAutomationValues(shared as Partial<Record<AutomationEmailField, string>>), previewedAs: null };
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

    const { subject, body } = messageFrom(input);
    await this.assertEmailImages(organizationId, body);
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
              templateContext: {
                recipientName: recipient.name,
                contactName: recipient.contactName,
                businessName: recipient.businessName,
                programName: program.name,
              },
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
    const organization = await this.prisma.organization.findUnique({
      where: { id: email.organizationId },
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
      await this.sendOne(email, program?.name ?? 'your program', organization?.name ?? '', next);
    }
    await this.completeIfDone(email.id);
  }

  private async sendOne(email: CfProgramEmail, programName: string, organizationName: string, communication: CfCommunication) {
    const context = contextOf(communication);
    // This person's copy: their names in place of the fields. The same every attempt, so a retry
    // sends the same text.
    const values: FieldValues = {
      // Recipients queued before the contact name was recorded: the greeting name stands in.
      'client.contactName': context.contactName ?? context.name,
      'client.businessName': context.businessName,
      'program.name': programName,
      'organization.name': organizationName,
    };
    const subject = personalize(email.subject, values);
    const body = personalize(email.body, values);
    let result: { status: 'sent'; sentAt: string } | { status: 'skipped' | 'failed'; reason: string };
    if (!this.n8n) {
      result = { status: 'failed', reason: 'not_configured' };
    } else {
      try {
        result = await this.n8n.sendProgramEmail(communication.eventId!, {
          organizationId: email.organizationId,
          clientId: communication.clientId,
          sentByUserId: email.sentByUserId ?? 'system',
          // Sent on behalf of the staff member who wrote it: their role's signature.
          ...(email.sentByUserId ? { senderUserId: email.sentByUserId } : {}),
          recipientEmail: communication.recipientEmail!,
          clientName: context.name || context.businessName || 'there',
          programName,
          programId: email.programId,
          programEmailId: email.id,
          subject,
          body,
        });
      } catch (error) {
        this.logger.warn(`Program email ${email.id} recipient ${communication.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
        result = { status: 'failed', reason: 'unavailable' };
      }
    }
    const now = new Date();
    // What this person was sent (or would have been), so their history shows their own copy.
    const rendered = { renderedSubject: subject, renderedBody: body };
    await this.prisma.cfCommunication.update({
      where: { id: communication.id },
      data:
        result.status === 'sent'
          ? { ...rendered, status: COMMUNICATION_STATUS.sent, sentAt: new Date(result.sentAt), errorCode: null, failedAt: null }
          : { ...rendered, status: COMMUNICATION_STATUS.failed, errorCode: result.reason, failedAt: now },
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
