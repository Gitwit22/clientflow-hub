import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Environment } from '../../config/env';
import type {
  ContractEmailDeliveryResult,
  WelcomeCopyMetadata,
  WelcomeEmailDeliveryResult,
} from '../../integrations/n8n/n8n.types';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  attemptEventId,
  DELIVERY_SOURCE,
  findAttemptByKey,
  isUniqueViolation,
  recordedDelivery,
  type DeliverySource,
} from '../communications/communication-attempts';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import {
  CONTRACT_CLIENT_STATUS,
  CONTRACT_STATUS,
  INITIAL_FOLLOW_UP_TYPE,
  MONITORING_TASK_STATUS,
  contractTokenExpiry,
  generateContractToken,
  hashContractToken,
  monitoringDueDate,
  renderContractSnapshot,
  safeAttachmentFileName,
  WELCOME_NEXT_STEP,
} from './contract-lifecycle';
import { renderExecutedContractPdf } from './executed-contract-pdf';
import type { SubmitPublicContractDto } from './dto/submit-public-contract.dto';

const SAFE_PROGRAM_ERROR = 'The selected program is not configured for contract processing.';
const SAFE_TEMPLATE_ERROR = 'The selected program does not have an active contract template.';
const SAFE_PUBLIC_CONTRACT_ERROR = 'The contract link is invalid or unavailable.';
const COMMUNICATION_STATUS = {
  requested: 'REQUESTED',
  sending: 'SENDING',
  sent: 'SENT',
  failed: 'FAILED',
} as const;
const CONTRACT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const WELCOME_VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;
const ALLOWED_WELCOME_VARIABLES = new Set([
  'client.firstName',
  'client.fullName',
  'program.name',
  'organization.name',
  'enrollment.startDate',
  'enrollment.nextAction',
]);

export interface StaffSigner {
  id: string | null;
  name: string;
}

/** Longest a presigned R2/S3 download URL may live (7 days). Emailed copies need more than minutes. */
const EXECUTED_COPY_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Who is behind a delivery and where it came from; drives the audit trail. */
export interface DeliveryContext {
  source: DeliverySource;
  actor?: StaffSigner | null;
  idempotencyKey?: string | null;
}

type NotificationPayload = {
  organizationId: string;
  clientId?: string | null;
  submissionId?: string | null;
  sourceType: string;
  sourceId: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  isDemo?: boolean;
};

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    private readonly n8n: N8nService,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly storage: StorageService = { isEnabled: () => false } as unknown as StorageService,
  ) {}

  async prepareProgramSelection(organizationId: string, programName: string) {
    const programs = await this.prisma.cfProgram.findMany({
      where: { organizationId, name: programName, isActive: true },
      take: 2,
    });
    if (programs.length !== 1) throw new BadRequestException(SAFE_PROGRAM_ERROR);

    const program = programs[0];
    const workflow = await this.workflowConfig.getOrCreate(program.organizationId, program.id, program.name);
    const rule = workflow.sendContractAfterIntake ? 'auto_contract' : 'staff_review';
    const template = workflow.sendContractAfterIntake
      ? await this.resolveTemplate(program)
      : null;
    return { program, rule, template };
  }

  async handlePostIntakeProgramSelection(clientId: string, programId: string) {
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');
    if (client.programId !== programId) throw new BadRequestException(SAFE_PROGRAM_ERROR);

    const program = await this.prisma.cfProgram.findFirst({
      where: { id: programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new BadRequestException(SAFE_PROGRAM_ERROR);

    const workflow = await this.workflowConfig.getOrCreate(program.organizationId, program.id, program.name);
    if (!workflow.enabled || !workflow.sendContractAfterIntake) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.cfClient.update({
          where: { id: client.id },
          data: { status: CONTRACT_CLIENT_STATUS.pendingStaffReview },
        });
        await transaction.cfActivityLog.create({
          data: {
            organizationId: client.organizationId,
            clientId: client.id,
            actorUserId: client.assignedUserId,
            action: 'PENDING_STAFF_REVIEW',
            description: 'Pending staff review before contract',
            user: 'system',
          },
        });
      });
      return {
        nextAction: 'STAFF_REVIEW_REQUIRED' as const,
        clientStatus: CONTRACT_CLIENT_STATUS.pendingStaffReview,
        program: { id: program.id, name: program.name },
        contract: null,
        emailDelivery: null,
      };
    }

    let template;
    try {
      template = await this.resolveTemplate(program);
    } catch (error) {
      if (error instanceof BadRequestException && error.message === SAFE_TEMPLATE_ERROR) {
        return this.failForMissingContractConfiguration(client, program);
      }
      throw error;
    }
    const defaultSigner: StaffSigner = {
      id: client.assignedUserId,
      name: client.assignedStaff && client.assignedStaff !== 'Unassigned'
        ? client.assignedStaff
        : 'EA Management Team',
    };
    const generated = await this.generateInternal(client, program, template, defaultSigner);
    const issued = await this.issueContract(client, program, template, generated.contract.id);
    return {
      nextAction: 'CONTRACT_SENT' as const,
      clientStatus: CONTRACT_CLIENT_STATUS.contractSent,
      program: { id: program.id, name: program.name },
      ...issued,
    };
  }

  async issueContractForProgram(
    clientId: string,
    programId: string,
    options?: { enrollmentId?: string | null; staffSigner?: StaffSigner },
  ) {
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');

    const program = await this.prisma.cfProgram.findFirst({
      where: { id: programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new BadRequestException(SAFE_PROGRAM_ERROR);

    const template = await this.resolveTemplate(program);
    const defaultSigner: StaffSigner = options?.staffSigner && options.staffSigner.name.trim()
      ? options.staffSigner
      : {
          id: client.assignedUserId,
          name: client.assignedStaff && client.assignedStaff !== 'Unassigned'
            ? client.assignedStaff
            : 'EA Management Team',
        };
    const generated = await this.generateInternal(
      client,
      program,
      template,
      defaultSigner,
      options?.enrollmentId ?? null,
    );
    return this.issueContract(client, program, template, generated.contract.id);
  }

  async generateForStaff(
    clientId: string,
    staffSigner: StaffSigner,
    options?: { enrollmentId?: string | null },
  ) {
    // Program context comes from the enrollment when one is given; the legacy single client.programId
    // is only a fallback for older callers that don't send an enrollment.
    const { client, program, enrollmentId } = options?.enrollmentId
      ? await this.resolveEnrollmentProgram(clientId, options.enrollmentId)
      : { ...(await this.resolveClientProgram(clientId)), enrollmentId: null };
    const template = await this.resolveTemplate(program);
    const generated = await this.generateInternal(client, program, template, staffSigner, enrollmentId);
    return {
      contract: this.safeContract(generated.contract, template.name),
      // Null when a contract was already emailed: its link is left untouched rather than rotated.
      publicContractUrl: generated.rawToken ? this.publicContractUrl(generated.rawToken) : null,
    };
  }

  async sendForStaff(
    clientId: string,
    contractId: string,
    options?: { enrollmentId?: string | null; actor?: StaffSigner | null; idempotencyKey?: string | null },
  ) {
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');

    const contract = await this.prisma.cfContract.findFirst({
      where: { id: contractId, clientId: client.id, organizationId: client.organizationId },
    });
    if (!contract) throw new NotFoundException('Contract not found.');

    // A retried request (same Idempotency-Key) returns the first attempt instead of re-issuing, so
    // the signing link isn't rotated twice and the client isn't emailed twice.
    if (options?.idempotencyKey) {
      const prior = await findAttemptByKey(this.prisma, client.organizationId, options.idempotencyKey);
      if (prior) return this.replayedContractSend(contract, prior);
    }

    // OPENED (the client viewed the link but hasn't signed) can be resent like SENT.
    if (![CONTRACT_STATUS.draft, CONTRACT_STATUS.sent, CONTRACT_STATUS.opened].includes(contract.status as 'DRAFT' | 'SENT' | 'OPENED')) {
      throw new BadRequestException('The contract cannot be sent in its current status.');
    }
    if (options?.enrollmentId && contract.enrollmentId && contract.enrollmentId !== options.enrollmentId) {
      throw new BadRequestException('This contract belongs to a different program enrollment.');
    }

    const program = await this.prisma.cfProgram.findFirst({
      where: { id: contract.programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new BadRequestException(SAFE_PROGRAM_ERROR);
    // A contract that's already been generated carries its own name/content - re-resolving a
    // template here would require guessing which table (legacy vs. program-scoped) it came from.
    try {
      return await this.issueContract(client, program, { name: contract.contractType }, contract.id, {
        source: DELIVERY_SOURCE.manual,
        actor: options?.actor ?? null,
        idempotencyKey: options?.idempotencyKey ?? null,
      });
    } catch (error) {
      // Two concurrent requests with the same key: the unique index let one win.
      if (options?.idempotencyKey && isUniqueViolation(error)) {
        const prior = await findAttemptByKey(this.prisma, client.organizationId, options.idempotencyKey);
        if (prior) return this.replayedContractSend(contract, prior);
      }
      throw error;
    }
  }

  private replayedContractSend(
    contract: Parameters<ContractsService['safeContract']>[0] & { contractType: string },
    prior: Parameters<typeof recordedDelivery>[0],
  ) {
    return {
      contract: this.safeContract(contract, contract.contractType),
      publicContractUrl: null,
      emailDelivery: recordedDelivery(prior),
      replayed: true as const,
    };
  }

  /**
   * Emails the client the fully signed copy of a COMPLETED contract. This is a separate path from
   * the signing link: it never rotates a token and never touches the contract's status.
   */
  async sendExecutedCopy(
    clientId: string,
    contractId: string,
    options?: { actor?: StaffSigner | null; idempotencyKey?: string | null },
  ) {
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');
    const contract = await this.prisma.cfContract.findFirst({
      where: { id: contractId, clientId: client.id, organizationId: client.organizationId },
    });
    if (!contract) throw new NotFoundException('Contract not found.');
    if (contract.status !== CONTRACT_STATUS.completed) {
      throw new BadRequestException('Only a signed contract can be sent as a copy.');
    }
    if (options?.idempotencyKey) {
      const prior = await findAttemptByKey(this.prisma, client.organizationId, options.idempotencyKey);
      if (prior) {
        return { contractId: contract.id, emailDelivery: recordedDelivery(prior), replayed: true as const };
      }
    }
    if (!contract.executedStoredFileId) {
      throw new BadRequestException('The signed copy is not available yet.');
    }
    const program = await this.prisma.cfProgram.findFirst({
      where: { id: contract.programId, organizationId: client.organizationId },
    });
    if (!program) throw new BadRequestException(SAFE_PROGRAM_ERROR);
    return this.deliverExecutedCopy(client, contract, program, {
      source: DELIVERY_SOURCE.manual,
      actor: options?.actor ?? null,
      idempotencyKey: options?.idempotencyKey ?? null,
    });
  }

  /**
   * Manual welcome email / resend for one enrollment. The signature gate the automatic workflow
   * uses is preserved: the enrollment's latest contract must be COMPLETED.
   */
  async sendWelcomeForEnrollment(
    clientId: string,
    options: { enrollmentId: string; actor?: StaffSigner | null; idempotencyKey?: string | null },
  ) {
    const { client, program, enrollmentId } = await this.resolveEnrollmentProgram(clientId, options.enrollmentId);

    if (options.idempotencyKey) {
      const prior = await findAttemptByKey(this.prisma, client.organizationId, options.idempotencyKey);
      if (prior) {
        return { contractId: prior.contractId, emailDelivery: recordedDelivery(prior), replayed: true as const };
      }
    }

    const contract = await this.prisma.cfContract.findFirst({
      where: {
        organizationId: client.organizationId,
        clientId: client.id,
        OR: [{ enrollmentId }, { enrollmentId: null, programId: program.id }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!contract || contract.status !== CONTRACT_STATUS.completed) {
      throw new BadRequestException('The contract must be signed before the welcome email can be sent.');
    }

    const workflow = await this.workflowConfig.getOrCreate(program.organizationId, program.id, program.name);
    const welcomeConfig = await this.resolveWelcomeEmailForDelivery({
      workflow,
      organizationId: client.organizationId,
      client,
      program,
      enrollmentId,
      fallbackMessage: program.welcomeMessage ?? undefined,
    });
    const availability = this.n8n.getWelcomeAvailability();
    const now = new Date();
    const communicationId = randomUUID();
    const eventId = attemptEventId('welcome.send', contract.id, communicationId);
    const delivery: DeliveryContext = {
      source: DELIVERY_SOURCE.manual,
      actor: options.actor ?? null,
      idempotencyKey: options.idempotencyKey ?? null,
    };

    let communication: { id: string };
    try {
      communication = await this.prisma.cfCommunication.create({
        data: {
          id: communicationId,
          organizationId: client.organizationId,
          clientId: client.id,
          enrollmentId,
          eventId,
          contractId: contract.id,
          recipientEmail: client.email,
          channel: 'email',
          provider: 'n8n',
          status: availability === 'ready' ? COMMUNICATION_STATUS.requested : COMMUNICATION_STATUS.failed,
          requestedAt: now,
          errorCode: availability === 'ready' ? null : availability,
          type: 'welcome_email',
          direction: 'outbound',
          subject: welcomeConfig.subject,
          notes: availability === 'ready' ? 'Welcome email requested by staff.' : 'Welcome email blocked before send.',
          renderedSubject: welcomeConfig.subject,
          renderedBody: welcomeConfig.body,
          templateContext: this.welcomeTemplateContext(welcomeConfig),
          date: now,
          staffMember: delivery.actor?.name?.trim() || 'staff',
          createdByUserId: delivery.actor?.id ?? null,
          source: DELIVERY_SOURCE.manual,
          idempotencyKey: delivery.idempotencyKey ?? null,
          isDemo: client.isDemo,
        },
      });
    } catch (error) {
      if (options.idempotencyKey && isUniqueViolation(error)) {
        const prior = await findAttemptByKey(this.prisma, client.organizationId, options.idempotencyKey);
        if (prior) {
          return { contractId: contract.id, emailDelivery: recordedDelivery(prior), replayed: true as const };
        }
      }
      throw error;
    }

    const emailDelivery = await this.dispatchWelcome({
      communicationId: communication.id,
      eventId,
      client,
      program,
      welcomeConfig,
      availability,
      delivery,
    });
    return { contractId: contract.id, emailDelivery, replayed: false as const };
  }

  private async sendExecutedCopyAfterSignature(
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    contract: { id: string },
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {},
  ): Promise<void> {
    // Never lets a failing copy affect the signature that already happened or the welcome email.
    try {
      const completedContract = await this.prisma.cfContract.findFirst({ where: { id: contract.id } });
      if (!completedContract) return;
      await this.deliverExecutedCopy(client, completedContract, program, {
        source: DELIVERY_SOURCE.automation,
        idempotencyKey: `auto:contract.copy:${contract.id}`,
      });
    } catch (error) {
      this.logger.warn(`Unable to send the executed copy for contract ${contract.id}: ${(error as Error).message}`);
    }
  }

  private async deliverExecutedCopy(
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    contract: NonNullable<Awaited<ReturnType<PrismaService['cfContract']['findFirst']>>>,
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {},
    delivery: DeliveryContext,
  ) {
    if (contract.status !== CONTRACT_STATUS.completed) {
      throw new BadRequestException('Only a signed contract can be sent as a copy.');
    }
    if (delivery.idempotencyKey) {
      const prior = await findAttemptByKey(this.prisma, client.organizationId, delivery.idempotencyKey);
      if (prior) {
        return { contractId: contract.id, emailDelivery: recordedDelivery(prior), replayed: true as const };
      }
    }

    const now = new Date();
    const manual = delivery.source === DELIVERY_SOURCE.manual;
    const staffName = delivery.actor?.name?.trim() || 'system';
    const communicationId = randomUUID();
    const eventId = attemptEventId('contract.copy', contract.id, communicationId);
    const availability = this.n8n.getContractCopyAvailability();
    const storedFile = contract.executedStoredFileId
      ? await this.prisma.cfStoredFile.findFirst({
          where: { id: contract.executedStoredFileId },
          select: { storageKey: true },
        })
      : null;
    const blocked = !storedFile
      ? 'executed_copy_unavailable'
      : !this.storage.isEnabled()
        ? 'storage_unavailable'
        : availability !== 'ready'
          ? availability
          : null;

    let communication: { id: string };
    try {
      communication = await this.prisma.cfCommunication.create({
        data: {
          id: communicationId,
          organizationId: client.organizationId,
          clientId: client.id,
          enrollmentId: contract.enrollmentId,
          eventId,
          contractId: contract.id,
          recipientEmail: client.email,
          channel: 'email',
          provider: 'n8n',
          status: blocked ? COMMUNICATION_STATUS.failed : COMMUNICATION_STATUS.requested,
          requestedAt: now,
          errorCode: blocked,
          type: 'contract_copy_email',
          direction: 'outbound',
          subject: `${contract.contractType} - signed copy`,
          notes: blocked ? 'Signed copy blocked before send.' : 'Signed copy requested.',
          date: now,
          staffMember: manual ? staffName : 'system',
          createdByUserId: delivery.actor?.id ?? null,
          source: delivery.source,
          idempotencyKey: delivery.idempotencyKey ?? null,
          isDemo: client.isDemo,
        },
      });
    } catch (error) {
      if (delivery.idempotencyKey && isUniqueViolation(error)) {
        const prior = await findAttemptByKey(this.prisma, client.organizationId, delivery.idempotencyKey);
        if (prior) {
          return { contractId: contract.id, emailDelivery: recordedDelivery(prior), replayed: true as const };
        }
      }
      throw error;
    }

    let emailDelivery: ContractEmailDeliveryResult;
    if (blocked || !storedFile) {
      emailDelivery = { status: 'failed', reason: 'unavailable' };
    } else {
      await this.prisma.cfCommunication.update({
        where: { id: communication.id },
        data: { status: COMMUNICATION_STATUS.sending },
      });
      try {
        const download = await this.storage.createPresignedDownloadUrl(
          storedFile.storageKey,
          EXECUTED_COPY_URL_TTL_SECONDS,
        );
        if (!download.url.startsWith('https://')) {
          throw new Error('The executed copy requires an HTTPS download URL.');
        }
        emailDelivery = await this.n8n.sendContractCopy(eventId, {
          organizationId: client.organizationId,
          clientId: client.id,
          contractId: contract.id,
          enrollmentId: contract.enrollmentId,
          recipientEmail: client.email,
          clientName: client.primaryContactName,
          programName: program.name,
          contractName: contract.contractType,
          executedCopyUrl: download.url,
          source: delivery.source,
          sentByUserId: manual ? delivery.actor?.id ?? client.assignedUserId ?? 'system' : 'system',
        });
      } catch (error) {
        this.logger.warn(`Unable to prepare the signed copy for contract ${contract.id}: ${(error as Error).message}`);
        emailDelivery = { status: 'failed', reason: 'unavailable' };
      }
    }

    const failureReason = blocked
      ?? (emailDelivery.status === 'sent' ? null : ('reason' in emailDelivery ? emailDelivery.reason : 'unknown'));
    await this.prisma.cfCommunication.update({
      where: { id: communication.id },
      data: emailDelivery.status === 'sent'
        ? { status: COMMUNICATION_STATUS.sent, sentAt: new Date(emailDelivery.sentAt), failedAt: null, errorCode: null }
        : { status: COMMUNICATION_STATUS.failed, failedAt: new Date(), errorCode: failureReason },
    });
    await this.prisma.cfActivityLog.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        enrollmentId: contract.enrollmentId,
        actorUserId: delivery.actor?.id ?? client.assignedUserId,
        action: emailDelivery.status === 'sent' ? 'CONTRACT_COPY_SENT' : 'CONTRACT_COPY_FAILED',
        description: emailDelivery.status === 'sent'
          ? 'Signed contract copy sent to the client.'
          : `Signed contract copy failed: ${failureReason ?? 'unknown'}.`,
        user: manual ? staffName : 'system',
        source: delivery.source,
      },
    });
    if (emailDelivery.status !== 'sent') {
      await this.createAdminNotifications({
        organizationId: client.organizationId,
        clientId: client.id,
        sourceType: 'contract_copy_delivery',
        sourceId: communication.id,
        type: 'CONTRACT_COPY_FAILED',
        title: 'Signed contract copy failed',
        message: `The signed copy for ${client.primaryContactName} needs staff attention.`,
        actionUrl: `/clients/${client.id}?tab=contracts`,
        isDemo: client.isDemo,
      });
    }
    return { contractId: contract.id, emailDelivery, replayed: false as const };
  }

  /** Sends the welcome email for an already-created communication, then records the outcome. */
  private async dispatchWelcome(input: {
    communicationId: string;
    eventId: string;
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {};
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {};
    welcomeConfig: Awaited<ReturnType<ContractsService['resolveWelcomeEmailForDelivery']>>;
    availability: 'ready' | 'disabled' | 'not_configured';
    delivery: DeliveryContext;
  }): Promise<WelcomeEmailDeliveryResult> {
    const { client, program, welcomeConfig, availability } = input;
    if (availability === 'ready') {
      await this.prisma.cfCommunication.update({
        where: { id: input.communicationId },
        data: { status: COMMUNICATION_STATUS.sending },
      });
    }
    // Enough to trace any email back to the ClientFlow copy that produced it (no client data).
    this.logger.log(
      `welcome.send eventId=${input.eventId} source=${welcomeConfig.meta.source} `
      + `templateId=${welcomeConfig.meta.templateId ?? 'none'} versionId=${welcomeConfig.meta.versionId ?? 'none'} `
      + `trigger=${input.delivery.source}`,
    );
    const attachment = availability === 'ready'
      ? await this.resolveWelcomeAttachment(welcomeConfig.guideStoredFileId)
      : undefined;
    const welcomeDelivery: WelcomeEmailDeliveryResult = availability !== 'ready'
      ? { status: 'failed', reason: availability }
      : await this.n8n.sendWelcome(input.eventId, {
          organizationId: client.organizationId,
          clientId: client.id,
          recipientEmail: client.email,
          clientName: client.primaryContactName,
          programName: program.name,
          // ClientFlow owns the wording: the resolved subject and body go out as-is.
          subject: welcomeConfig.subject,
          body: welcomeConfig.body,
          renderMode: 'verbatim',
          welcome: welcomeConfig.meta,
          nextStep: welcomeConfig.body,
          attachmentUrl: attachment?.url,
          attachmentFileName: attachment?.fileName,
          attachmentMimeType: attachment?.mimeType,
          headerImageUrl: welcomeConfig.headerImageUrl,
          sentByUserId: input.delivery.actor?.id ?? client.assignedUserId ?? 'system',
        });
    await this.recordWelcomeDeliveryResult(input.communicationId, client, welcomeDelivery, input.delivery);
    return welcomeDelivery;
  }

  async approveReview(clientId: string, staffSigner: StaffSigner) {
    if (!staffSigner.name.trim()) {
      throw new BadRequestException('A staff signer name is required to approve and sign this contract.');
    }
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');
    if (client.status !== CONTRACT_CLIENT_STATUS.pendingStaffReview) {
      throw new BadRequestException('Client is not pending staff review.');
    }
    if (!client.programId) throw new BadRequestException(SAFE_PROGRAM_ERROR);

    const program = await this.prisma.cfProgram.findFirst({
      where: { id: client.programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new BadRequestException(SAFE_PROGRAM_ERROR);

    const template = await this.resolveTemplate(program);
    const generated = await this.generateInternal(client, program, template, staffSigner);
    const issued = await this.issueContract(client, program, template, generated.contract.id);
    return {
      nextAction: 'CONTRACT_SENT' as const,
      clientStatus: CONTRACT_CLIENT_STATUS.contractSent,
      program: { id: program.id, name: program.name },
      ...issued,
    };
  }

  async declineReview(clientId: string, reason?: string) {
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');
    if (client.status !== CONTRACT_CLIENT_STATUS.pendingStaffReview) {
      throw new BadRequestException('Client is not pending staff review.');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.cfClient.update({
        where: { id: client.id },
        data: { status: CONTRACT_CLIENT_STATUS.reviewDeclined },
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorUserId: client.assignedUserId,
          action: 'REVIEW_DECLINED',
          description: reason ? `Staff review declined: ${reason}` : 'Staff review declined.',
          user: 'staff',
        },
      });
      return result;
    });

    return { client: { id: updated.id, status: updated.status } };
  }

  async openPublicContract(rawToken: string) {
    const { contract, client, program } = await this.resolvePublicContract(rawToken);
    const secureTokenHash = hashContractToken(rawToken);

    await this.prisma.$transaction(async (transaction) => {
      const opened = await transaction.cfContract.updateMany({
        where: {
          id: contract.id,
          secureTokenHash,
          status: CONTRACT_STATUS.sent,
          secureTokenExpiresAt: { gt: new Date() },
        },
        data: { status: CONTRACT_STATUS.opened },
      });
      if (opened.count === 0) return;
      await transaction.cfClient.update({
        where: { id: client.id },
        data: { status: CONTRACT_CLIENT_STATUS.contractOpened },
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorUserId: null,
          action: 'CONTRACT_OPENED',
          description: 'Contract opened by client',
          user: 'public_contract',
        },
      });
    });

    return {
      contract: {
        id: contract.id,
        status: contract.status === CONTRACT_STATUS.sent ? CONTRACT_STATUS.opened : contract.status,
        contractName: contract.contractType,
        content: contract.generatedContent,
        expiresAt: contract.secureTokenExpiresAt,
      },
      client: { name: client.primaryContactName },
      program: { id: program.id, name: program.name },
    };
  }

  async completePublicContract(
    rawToken: string,
    acceptance: SubmitPublicContractDto,
    requestMetadata: { signerIp: string | null; userAgent: string | null },
  ) {
    const { contract, client, program } = await this.resolvePublicContract(rawToken);
    const now = new Date();
    const secureTokenHash = hashContractToken(rawToken);
    const dueDate = monitoringDueDate(now, program.defaultMonitoringFrequency);
    const workflow = await this.workflowConfig.getOrCreate(program.organizationId, program.id, program.name);
    const welcomeConfig = await this.resolveWelcomeEmailForDelivery({
      workflow,
      organizationId: client.organizationId,
      client,
      program,
      enrollmentId: contract.enrollmentId,
      fallbackMessage: program.welcomeMessage ?? undefined,
    });
    const shouldSendWelcome = workflow.enabled && workflow.sendWelcomeAfterContractSigned;
    const availability = shouldSendWelcome
      ? this.n8n.getWelcomeAvailability()
      : 'disabled';
    const eventId = `welcome.send:${contract.id}`;

    const completed = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.cfContract.updateMany({
        where: {
          id: contract.id,
          secureTokenHash,
          status: { in: [CONTRACT_STATUS.sent, CONTRACT_STATUS.opened] },
          completedAt: null,
          secureTokenExpiresAt: { gt: now },
        },
        data: {
          status: CONTRACT_STATUS.completed,
          signedAt: now,
          signedName: acceptance.signedName.trim(),
          signedEmail: acceptance.signedEmail.trim().toLowerCase(),
          agreedToTerms: true,
          signatureNote: acceptance.signatureNote?.trim() || null,
          signerIp: requestMetadata.signerIp?.slice(0, 255) || null,
          signerUserAgent: requestMetadata.userAgent,
          completedAt: now,
          secureTokenHash: null,
          secureTokenExpiresAt: null,
        },
      });
      if (result.count !== 1) throw new NotFoundException(SAFE_PUBLIC_CONTRACT_ERROR);

      await transaction.cfClient.update({
        where: { id: client.id },
        data: { status: CONTRACT_CLIENT_STATUS.onboarding, nextFollowUpDate: dueDate },
      });
      const monitoringTask = await transaction.cfMonitoringTask.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          programId: program.id,
          contractId: contract.id,
          type: INITIAL_FOLLOW_UP_TYPE,
          dueDate,
          status: MONITORING_TASK_STATUS.pending,
          assignedStaffId: client.assignedUserId,
          notes: 'Created automatically when the contract was completed.',
        },
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorUserId: null,
          action: 'CONTRACT_SIGNED',
          description: 'Contract signed by client',
          user: 'public_contract',
        },
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorUserId: client.assignedUserId,
          action: 'ONBOARDING',
          description: 'Client moved to onboarding',
          user: 'system',
        },
      });
      if (contract.enrollmentId) {
        const enrollment = await transaction.cfProgramEnrollment.findFirst({
          where: { id: contract.enrollmentId, organizationId: client.organizationId },
          select: { status: true },
        });
        if (enrollment && !['completed', 'declined', 'withdrawn', 'active'].includes(enrollment.status)) {
          await transaction.cfProgramEnrollment.update({
            where: { id: contract.enrollmentId },
            data: { status: 'active', lastProgressUpdate: now },
          });
          await transaction.cfEnrollmentStatusHistory.create({
            data: {
              organizationId: client.organizationId,
              enrollmentId: contract.enrollmentId,
              previousStatus: enrollment.status as any,
              newStatus: 'active',
              changedByUserId: null,
              changedByDisplayName: 'system',
              reason: 'Contract signed by client.',
            },
          });
        }
      }
      const communication = shouldSendWelcome
        ? await transaction.cfCommunication.create({
            data: {
              organizationId: client.organizationId,
              clientId: client.id,
              enrollmentId: contract.enrollmentId,
              eventId,
              contractId: contract.id,
              recipientEmail: client.email,
              channel: 'email',
              provider: 'n8n',
              status: availability === 'ready' ? COMMUNICATION_STATUS.requested : COMMUNICATION_STATUS.failed,
              requestedAt: now,
              errorCode: availability === 'ready' ? null : availability,
              type: 'welcome_email',
              direction: 'outbound',
              subject: welcomeConfig.subject,
              notes: availability === 'ready'
                ? 'Welcome email requested.'
                : 'Welcome email blocked before send.',
              renderedSubject: welcomeConfig.subject,
              renderedBody: welcomeConfig.body,
              templateContext: this.welcomeTemplateContext(welcomeConfig),
              date: now,
              staffMember: 'system',
              source: DELIVERY_SOURCE.automation,
              // A repeated completion can never queue a second automatic welcome.
              idempotencyKey: `auto:welcome.send:${contract.id}`,
              isDemo: client.isDemo,
            },
          })
        : null;
      return { monitoringTask, communication };
    });

    // Order matters: file the executed copy, email it, then send the welcome email. The copy and the
    // welcome are independent: neither can block the other, or the completion that already happened.
    await this.archiveExecutedContract(client, contract, acceptance, now);
    await this.sendExecutedCopyAfterSignature(client, contract, program);

    const welcomeDelivery: WelcomeEmailDeliveryResult = !completed.communication
      ? { status: 'skipped', reason: 'disabled' }
      : await this.dispatchWelcome({
          communicationId: completed.communication.id,
          eventId,
          client,
          program,
          welcomeConfig,
          availability,
          delivery: { source: DELIVERY_SOURCE.automation },
        });

    await this.createAdminNotifications({
      organizationId: client.organizationId,
      clientId: client.id,
      sourceType: 'contract',
      sourceId: contract.id,
      type: 'CONTRACT_SIGNED',
      title: 'Contract signed',
      message: `${client.primaryContactName} signed ${contract.contractType}.`,
      actionUrl: `/clients/${client.id}?tab=contracts`,
      isDemo: client.isDemo,
    });

    return {
      organizationId: client.organizationId,
      programId: program.id,
      enrollmentId: contract.enrollmentId,
      contract: { id: contract.id, status: CONTRACT_STATUS.completed, completedAt: now },
      client: { id: client.id, status: CONTRACT_CLIENT_STATUS.onboarding },
      monitoringTask: {
        id: completed.monitoringTask.id,
        type: completed.monitoringTask.type,
        status: completed.monitoringTask.status,
        dueDate: completed.monitoringTask.dueDate,
        assignedStaffId: completed.monitoringTask.assignedStaffId,
      },
      welcomeDelivery,
    };
  }

  /** Uploads the fully signed document to R2 as a PDF and files it on the client's record. Non-fatal on failure. */
  private async archiveExecutedContract(
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    contract: Awaited<ReturnType<PrismaService['cfContract']['findUnique']>> & {},
    acceptance: SubmitPublicContractDto,
    signedAt: Date,
  ): Promise<void> {
    if (!this.storage.isEnabled()) return;
    try {
      const executedContent = [
        contract.generatedContent,
        '',
        'CLIENT ACCEPTANCE',
        `Signed by: ${acceptance.signedName.trim()}`,
        `Signed email: ${acceptance.signedEmail.trim().toLowerCase()}`,
        `Signed at: ${signedAt.toISOString()}`,
        acceptance.signatureNote?.trim() ? `Note: ${acceptance.signatureNote.trim()}` : null,
      ].filter((line): line is string => line !== null).join('\n');

      const executedPdf = await renderExecutedContractPdf({
        title: `${contract.contractType} - Executed`,
        content: executedContent,
      });
      const objectKey = `contracts/${client.organizationId}/${client.id}/${contract.id}-executed.pdf`;
      const uploaded = await this.storage.uploadBuffer(objectKey, executedPdf, 'application/pdf');

      const storedFile = await this.prisma.cfStoredFile.create({
        data: {
          organizationId: client.organizationId,
          storageKey: uploaded.objectKey,
          originalFileName: `${contract.contractType} - Executed.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: uploaded.byteSize,
          status: 'READY',
          uploadedByUserId: client.assignedUserId,
          completedAt: signedAt,
        },
      });

      await this.prisma.$transaction([
        this.prisma.cfContract.update({
          where: { id: contract.id },
          data: { executedStoredFileId: storedFile.id },
        }),
        this.prisma.cfDocument.create({
          data: {
            organizationId: client.organizationId,
            clientId: client.id,
            name: `${contract.contractType} — Executed`,
            type: 'contract',
            url: uploaded.url,
            storedFileId: storedFile.id,
            objectKey: uploaded.objectKey,
            bucket: uploaded.bucket,
            byteSize: uploaded.byteSize,
            uploadStatus: 'ready',
            uploadedBy: 'system',
            isDemo: client.isDemo,
          },
        }),
      ]);
    } catch (error) {
      this.logger.warn(`Unable to archive executed contract ${contract.id} to storage: ${(error as Error).message}`);
    }
  }

  private async resolveClientProgram(clientId: string) {
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');
    if (!client.programId) throw new BadRequestException(SAFE_PROGRAM_ERROR);
    const program = await this.prisma.cfProgram.findFirst({
      where: { id: client.programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new BadRequestException(SAFE_PROGRAM_ERROR);
    return { client, program };
  }

  /** The client's enrollment and the program it points at: the only source of program context. */
  private async resolveEnrollmentProgram(clientId: string, enrollmentId: string) {
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');
    const enrollment = await this.prisma.cfProgramEnrollment.findFirst({
      where: { id: enrollmentId, clientId: client.id, organizationId: client.organizationId },
    });
    if (!enrollment) throw new NotFoundException('Program enrollment not found for this client.');
    const program = await this.prisma.cfProgram.findFirst({
      where: { id: enrollment.programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new BadRequestException(SAFE_PROGRAM_ERROR);
    return { client, program, enrollmentId: enrollment.id };
  }

  private async resolvePublicContract(rawToken: string) {
    if (!CONTRACT_TOKEN_PATTERN.test(rawToken)) {
      throw new NotFoundException(SAFE_PUBLIC_CONTRACT_ERROR);
    }
    const contract = await this.prisma.cfContract.findUnique({
      where: { secureTokenHash: hashContractToken(rawToken) },
    });
    const now = new Date();
    if (
      !contract
      || ![CONTRACT_STATUS.sent, CONTRACT_STATUS.opened].includes(contract.status as 'SENT' | 'OPENED')
      || !contract.secureTokenExpiresAt
      || contract.secureTokenExpiresAt <= now
      || contract.completedAt
    ) {
      throw new NotFoundException(SAFE_PUBLIC_CONTRACT_ERROR);
    }
    const [client, program] = await Promise.all([
      this.prisma.cfClient.findFirst({
        where: { id: contract.clientId, organizationId: contract.organizationId, isArchived: false },
      }),
      this.prisma.cfProgram.findFirst({
        where: { id: contract.programId, organizationId: contract.organizationId, isActive: true },
      }),
    ]);
    if (!client || !program) throw new NotFoundException(SAFE_PUBLIC_CONTRACT_ERROR);
    return { contract, client, program };
  }

  private async resolveTemplate(program: {
    id: string;
    organizationId: string;
    name: string;
    defaultContractTemplateId: string;
  }) {
    const workflow = await this.workflowConfig.getOrCreate(program.organizationId, program.id, program.name);
    const programContractTemplateModel = (this.prisma as unknown as {
      cfProgramContractTemplate?: {
        findFirst: (args: unknown) => Promise<{ id: string; name: string; signatureRequired: boolean } | null>;
        findMany: (args: unknown) => Promise<Array<{ id: string }>>;
      };
    }).cfProgramContractTemplate;

    const programContractVersionModel = (this.prisma as unknown as {
      cfProgramContractVersion?: {
        findFirst: (args: unknown) => Promise<any>;
      };
    }).cfProgramContractVersion;
    const activeProgramTemplate = workflow.activeContractTemplateId && programContractTemplateModel
      ? await programContractTemplateModel.findFirst({
          where: {
            id: workflow.activeContractTemplateId,
            organizationId: program.organizationId,
            programId: program.id,
            isActive: true,
          },
        })
      : null;
    const version = activeProgramTemplate && workflow.activeContractVersionId && programContractVersionModel
      ? await programContractVersionModel.findFirst({
          where: {
            id: workflow.activeContractVersionId,
            organizationId: program.organizationId,
            templateId: activeProgramTemplate.id,
          },
        })
      : null;
    if (version) {
      return {
        id: version.id,
        organizationId: version.organizationId,
        name: version.title?.trim() || activeProgramTemplate?.name || `${program.name} Agreement`,
        content: version.content,
        isActive: true,
        createdAt: version.createdAt,
        updatedAt: version.createdAt,
      };
    }
    throw new BadRequestException(SAFE_TEMPLATE_ERROR);
  }

  private async generateInternal(
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {},
    template: { id: string; name: string; content: string },
    staffSigner: StaffSigner,
    enrollmentId: string | null = null,
  ) {
    const now = new Date();
    const rawToken = generateContractToken();
    const secureTokenHash = hashContractToken(rawToken);
    const secureTokenExpiresAt = contractTokenExpiry(now);
    const existing = await this.prisma.cfContract.findFirst({
      where: {
        organizationId: client.organizationId,
        clientId: client.id,
        programId: program.id,
        status: { in: [CONTRACT_STATUS.draft, CONTRACT_STATUS.sent, CONTRACT_STATUS.opened] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing && (existing.status === CONTRACT_STATUS.sent || existing.status === CONTRACT_STATUS.opened)) {
      // Already emailed: rotating the token would silently invalidate the link the client holds.
      // Staff who mean to resend use the send action, which rotates it deliberately.
      const contract = existing.enrollmentId || !enrollmentId
        ? existing
        : await this.prisma.cfContract.update({ where: { id: existing.id }, data: { enrollmentId } });
      return { contract, rawToken: null as string | null };
    }
    if (existing) {
      const contract = await this.prisma.cfContract.update({
        where: { id: existing.id },
        data: {
          secureTokenHash,
          secureTokenExpiresAt,
          enrollmentId: existing.enrollmentId ?? enrollmentId,
          ...(existing.staffSignedAt ? {} : {
            staffSignedByUserId: staffSigner.id,
            staffSignedByName: staffSigner.name,
            staffSignedAt: now,
          }),
        },
      });
      return { contract, rawToken: rawToken as string | null };
    }

    const contract = await this.prisma.cfContract.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        programId: program.id,
        enrollmentId,
        contractTemplateId: template.id,
        contractType: template.name,
        status: CONTRACT_STATUS.draft,
        secureTokenHash,
        secureTokenExpiresAt,
        staffSignedByUserId: staffSigner.id,
        staffSignedByName: staffSigner.name,
        staffSignedAt: now,
        generatedContent: renderContractSnapshot({
          templateName: template.name,
          templateContent: template.content,
          clientId: client.id,
          clientName: client.primaryContactName,
          programId: program.id,
          programName: program.name,
          generatedAt: now,
          staffSignerName: staffSigner.name,
          staffSignedAt: now,
        }),
        isDemo: client.isDemo,
      },
    });
    return { contract, rawToken: rawToken as string | null };
  }

  private async issueContract(
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {},
    template: { name: string },
    contractId: string,
    delivery: DeliveryContext = { source: DELIVERY_SOURCE.automation },
  ) {
    const now = new Date();
    const rawToken = generateContractToken();
    const secureTokenHash = hashContractToken(rawToken);
    const secureTokenExpiresAt = contractTokenExpiry(now);
    const publicContractUrl = this.publicContractUrl(rawToken);
    const availability = this.n8n.getContractAvailability();
    const manual = delivery.source === DELIVERY_SOURCE.manual;
    // Manual sends build the provider event id from the communication row created first, so a
    // deliberate resend is a new event and a retried request (same key) is never a second one.
    const communicationId = manual ? randomUUID() : null;
    const eventId = communicationId
      ? attemptEventId('contract.send', contractId, communicationId)
      : `contract.send:${contractId}:${secureTokenHash.slice(0, 16)}`;
    const staffName = delivery.actor?.name?.trim() || 'system';

    const issued = await this.prisma.$transaction(async (transaction) => {
      const contract = await transaction.cfContract.update({
        where: { id: contractId },
        data: {
          status: CONTRACT_STATUS.sent,
          secureTokenHash,
          secureTokenExpiresAt,
          sentAt: now,
        },
      });
      await transaction.cfClient.update({
        where: { id: client.id },
        data: { status: CONTRACT_CLIENT_STATUS.contractSent },
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          enrollmentId: contract.enrollmentId,
          actorUserId: delivery.actor?.id ?? client.assignedUserId,
          action: 'CONTRACT_SENT',
          description: 'Contract sent',
          user: manual ? staffName : 'system',
          source: delivery.source,
        },
      });
      if (contract.enrollmentId) {
        const enrollment = await transaction.cfProgramEnrollment.findFirst({
          where: { id: contract.enrollmentId, organizationId: client.organizationId, status: 'interested' },
          select: { status: true },
        });
        if (enrollment) {
          await transaction.cfProgramEnrollment.update({
            where: { id: contract.enrollmentId },
            data: { status: 'onboarding', lastProgressUpdate: now },
          });
          await transaction.cfEnrollmentStatusHistory.create({
            data: {
              organizationId: client.organizationId,
              enrollmentId: contract.enrollmentId,
              previousStatus: 'interested',
              newStatus: 'onboarding',
              changedByUserId: null,
              changedByDisplayName: 'system',
              reason: 'Contract sent.',
            },
          });
        }
      }
      const communication = await transaction.cfCommunication.create({
        data: {
          ...(communicationId ? { id: communicationId } : {}),
          organizationId: client.organizationId,
          clientId: client.id,
          enrollmentId: contract.enrollmentId,
          eventId,
          contractId: contract.id,
          recipientEmail: client.email,
          channel: 'email',
          provider: 'n8n',
          status: availability === 'ready' ? COMMUNICATION_STATUS.requested : COMMUNICATION_STATUS.failed,
          requestedAt: now,
          errorCode: availability === 'ready' ? null : availability,
          type: 'contract_email',
          direction: 'outbound',
          subject: template.name,
          notes: availability === 'ready'
            ? 'Contract email requested.'
            : 'Contract email blocked before send.',
          date: now,
          staffMember: manual ? staffName : 'system',
          createdByUserId: delivery.actor?.id ?? null,
          source: delivery.source,
          idempotencyKey: delivery.idempotencyKey ?? null,
          isDemo: client.isDemo,
        },
      });
      return { contract, communication };
    });

    if (availability === 'ready') {
      await this.prisma.cfCommunication.update({
        where: { id: issued.communication.id },
        data: { status: COMMUNICATION_STATUS.sending },
      });
    }
    const emailDelivery = availability !== 'ready'
      ? { status: 'failed' as const, reason: availability }
      : await this.n8n.sendContract(eventId, {
          organizationId: client.organizationId,
          clientId: client.id,
          recipientEmail: client.email,
          clientName: client.primaryContactName,
          programName: program.name,
          contractName: template.name,
          contractUrl: publicContractUrl,
          dueDate: secureTokenExpiresAt.toISOString().slice(0, 10),
          sentByUserId: client.assignedUserId ?? 'system',
        });
    await this.recordDeliveryResult(issued.communication.id, emailDelivery);

    return {
      contract: this.safeContract(issued.contract, template.name),
      publicContractUrl,
      emailDelivery,
    };
  }

  private async resolveWelcomeEmailForDelivery(input: {
    workflow: Awaited<ReturnType<WorkflowConfigService['getOrCreate']>>;
    organizationId: string;
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {};
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {};
    enrollmentId: string | null;
    fallbackMessage?: string;
  }) {
    const organizationModel = (this.prisma as unknown as {
      organization?: { findUnique: (args: unknown) => Promise<{ name: string; settings: unknown } | null> };
    }).organization;
    const enrollmentModel = (this.prisma as unknown as {
      cfProgramEnrollment?: { findFirst: (args: unknown) => Promise<{ startDate: Date | null; nextAction: string | null } | null> };
    }).cfProgramEnrollment;
    const [organization, enrollment] = await Promise.all([
      organizationModel
        ? organizationModel.findUnique({
            where: { id: input.organizationId },
            select: { name: true, settings: true },
          })
        : Promise.resolve(null),
      input.enrollmentId && enrollmentModel
        ? enrollmentModel.findFirst({
            where: { id: input.enrollmentId, organizationId: input.organizationId },
            select: { startDate: true, nextAction: true },
          })
        : Promise.resolve(null),
    ]);
    const logoStoredFileId = this.isRecord(organization?.settings)
      && typeof organization.settings.logoStoredFileId === 'string'
      ? organization.settings.logoStoredFileId
      : null;
    const headerImageUrl = await this.resolveOrganizationLogoUrl(logoStoredFileId);

    const context = {
      client: {
        firstName: this.firstName(input.client.primaryContactName),
        fullName: input.client.primaryContactName,
      },
      program: { name: input.program.name },
      organization: { name: organization?.name ?? '' },
      enrollment: {
        startDate: enrollment?.startDate?.toISOString().slice(0, 10) ?? '',
        nextAction: enrollment?.nextAction ?? '',
      },
    };

    const fallbackBody = this.renderWelcomeTemplate(
      input.fallbackMessage?.trim() || WELCOME_NEXT_STEP,
      context,
    );
    const fallbackSubject = `Welcome to ${input.program.name}`;
    const welcomeVersionModel = (this.prisma as unknown as {
      cfProgramWelcomeEmailVersion?: {
        findFirst: (args: unknown) => Promise<any>;
      };
    }).cfProgramWelcomeEmailVersion;
    const activeVersionCandidate = input.workflow.activeWelcomeEmailVersionId && welcomeVersionModel
      ? await welcomeVersionModel.findFirst({
          where: {
            id: input.workflow.activeWelcomeEmailVersionId,
            organizationId: input.organizationId,
          },
        })
      : null;
    const activeWelcomeTemplateModel = (this.prisma as unknown as {
      cfProgramWelcomeEmailTemplate?: {
        findFirst: (args: unknown) => Promise<{ id: string; name?: string } | null>;
      };
    }).cfProgramWelcomeEmailTemplate;
    const activeWelcomeTemplate = input.workflow.activeWelcomeEmailTemplateId && activeWelcomeTemplateModel
      ? await activeWelcomeTemplateModel.findFirst({
          where: {
            id: input.workflow.activeWelcomeEmailTemplateId,
            organizationId: input.organizationId,
            programId: input.program.id,
            isActive: true,
          },
          select: { id: true, name: true },
        })
      : null;
    const activeVersion = activeVersionCandidate
      ? (
        !activeWelcomeTemplate || activeVersionCandidate.templateId === activeWelcomeTemplate.id
          ? activeVersionCandidate
          : null
      )
      : null;
    if (!activeVersion) {
      // Fallback order: the program's own message override, then the generic ClientFlow body.
      const meta: WelcomeCopyMetadata = {
        source: input.fallbackMessage?.trim() ? 'program_message' : 'default',
        templateId: null,
        templateName: null,
        versionId: null,
        versionNumber: null,
      };
      return {
        subject: fallbackSubject,
        body: fallbackBody,
        context,
        guideStoredFileId: null,
        headerImageUrl,
        meta,
      };
    }
    const meta: WelcomeCopyMetadata = {
      source: 'program_version',
      templateId: activeVersion.templateId ?? activeWelcomeTemplate?.id ?? null,
      templateName: activeWelcomeTemplate?.name ?? null,
      versionId: activeVersion.id ?? null,
      versionNumber: typeof activeVersion.version === 'number' ? activeVersion.version : null,
    };
    return {
      subject: this.renderWelcomeTemplate(activeVersion.subject, context),
      body: this.renderWelcomeTemplate(activeVersion.body, context),
      context,
      guideStoredFileId: activeVersion.guideStoredFileId ?? null,
      headerImageUrl,
      meta,
    };
  }

  /** What is stored with the communication: the variables used plus which copy produced the email. */
  private welcomeTemplateContext(
    welcomeConfig: Awaited<ReturnType<ContractsService['resolveWelcomeEmailForDelivery']>>,
  ) {
    return { ...welcomeConfig.context, welcome: welcomeConfig.meta };
  }

  private renderWelcomeTemplate(template: string, context: Record<string, unknown>): string {
    return template.replace(WELCOME_VARIABLE_PATTERN, (_full, path: string) => {
      if (!ALLOWED_WELCOME_VARIABLES.has(path)) return '';
      const value = this.readTemplateValue(context, path);
      return value === null || value === undefined ? '' : String(value);
    });
  }

  /**
   * The welcome guide as an attachment: a short-lived download URL plus the document's real name and
   * type. ClientFlow knows what the document is, so n8n never has to guess a filename from a
   * presigned URL; it downloads the URL and attaches the file under this name and type.
   */
  private async resolveWelcomeAttachment(
    storedFileId: string | null,
  ): Promise<{ url: string; fileName?: string; mimeType?: string } | undefined> {
    if (!storedFileId || !this.storage.isEnabled()) return undefined;
    const storedFile = await this.prisma.cfStoredFile.findFirst({
      where: { id: storedFileId },
      select: { storageKey: true, originalFileName: true, mimeType: true },
    });
    if (!storedFile) return undefined;
    const download = await this.storage.createPresignedDownloadUrl(storedFile.storageKey, 900);
    const fileName = safeAttachmentFileName(storedFile.originalFileName);
    const mimeType = storedFile.mimeType?.trim() || undefined;
    return {
      url: download.url,
      ...(fileName ? { fileName } : {}),
      ...(mimeType ? { mimeType } : {}),
    };
  }

  // Header logo is embedded inline and must stay resolvable whenever the email is reopened later,
  // so this uses the permanent public URL, never the short-lived presigned attachment URL. Purely
  // cosmetic: any failure here must not throw or otherwise affect welcome delivery.
  private async resolveOrganizationLogoUrl(storedFileId: string | null): Promise<string | undefined> {
    if (!storedFileId || !this.storage.isEnabled()) return undefined;
    try {
      const storedFile = await this.prisma.cfStoredFile.findFirst({
        where: { id: storedFileId },
        select: { storageKey: true },
      });
      if (!storedFile) return undefined;
      return this.storage.getObjectPublicUrl(storedFile.storageKey);
    } catch (error) {
      this.logger.warn(`Unable to resolve organization header logo ${storedFileId}: ${(error as Error).message}`);
      return undefined;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private readTemplateValue(context: Record<string, unknown>, path: string): unknown {
    const segments = path.split('.');
    let cursor: unknown = context;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== 'object' || !(segment in (cursor as Record<string, unknown>))) {
        return '';
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor;
  }

  private firstName(fullName: string): string {
    const value = fullName.trim();
    if (!value) return '';
    const [first] = value.split(/\s+/);
    return first || value;
  }

  private async failForMissingContractConfiguration(
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {},
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.cfClient.update({
        where: { id: client.id },
        data: { status: CONTRACT_CLIENT_STATUS.pendingStaffReview },
      });
      await transaction.cfActivityLog.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorUserId: client.assignedUserId,
          action: 'CONTRACT_CONFIGURATION_MISSING',
          description: `Automatic contract sending stopped because ${program.name} has no active contract version.`,
          user: 'system',
        },
      });
    });
    await this.createAdminNotifications({
      organizationId: client.organizationId,
      clientId: client.id,
      sourceType: 'contract_configuration',
      sourceId: `${client.id}:${program.id}`,
      type: 'CONTRACT_CONFIGURATION_MISSING',
      title: 'Contract configuration missing',
      message: `${program.name} has auto-contract enabled but no active contract version.`,
      actionUrl: `/programs/${program.id}`,
      isDemo: client.isDemo,
    });
    return {
      nextAction: 'STAFF_REVIEW_REQUIRED' as const,
      clientStatus: CONTRACT_CLIENT_STATUS.pendingStaffReview,
      program: { id: program.id, name: program.name },
      contract: null,
      emailDelivery: null,
    };
  }

  private async createAdminNotifications(payload: NotificationPayload): Promise<void> {
    try {
      const adminModel = (this.prisma as unknown as {
        adminUser?: {
          findMany: (args: unknown) => Promise<Array<{ id: string }>>;
        };
        cfNotification?: {
          createMany?: (args: unknown) => Promise<unknown>;
          create?: (args: unknown) => Promise<unknown>;
        };
      }).adminUser;
      const notificationModel = (this.prisma as unknown as {
        cfNotification?: {
          createMany?: (args: unknown) => Promise<unknown>;
          create?: (args: unknown) => Promise<unknown>;
        };
      }).cfNotification;
      if (!adminModel || !notificationModel) return;
      const admins = await adminModel.findMany({
        where: {
          organizationId: payload.organizationId,
          isActive: true,
          role: { in: ['org_admin', 'super_admin'] },
        },
        select: { id: true },
      });
      if (admins.length === 0) return;
      const data = admins.map((admin) => ({
        organizationId: payload.organizationId,
        recipientAdminId: admin.id,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        actionUrl: payload.actionUrl ?? null,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        clientId: payload.clientId ?? null,
        submissionId: payload.submissionId ?? null,
        isDemo: payload.isDemo ?? false,
      }));
      if (notificationModel.createMany) {
        await notificationModel.createMany({ data, skipDuplicates: true });
        return;
      }
      await Promise.all(data.map(async (item) => {
        try {
          await notificationModel.create?.({ data: item });
        } catch {
          // ignore duplicate notification inserts in older mocks
        }
      }));
    } catch (error) {
      this.logger.warn(`Unable to create admin notifications for ${payload.type}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private async recordDeliveryResult(
    communicationId: string,
    delivery: ContractEmailDeliveryResult,
  ): Promise<void> {
    const communicationModel = (this.prisma as unknown as {
      cfCommunication?: { update: (args: unknown) => Promise<unknown> };
    }).cfCommunication;
    if (!communicationModel) return;
    await communicationModel.update({
      where: { id: communicationId },
      data: delivery.status === 'sent'
        ? { status: COMMUNICATION_STATUS.sent, sentAt: new Date(delivery.sentAt), failedAt: null, errorCode: null }
        : { status: COMMUNICATION_STATUS.failed, failedAt: new Date(), errorCode: 'reason' in delivery ? delivery.reason : 'unknown' },
    });
  }

  private async recordWelcomeDeliveryResult(
    communicationId: string,
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    delivery: WelcomeEmailDeliveryResult,
    context: DeliveryContext = { source: DELIVERY_SOURCE.automation },
  ): Promise<void> {
    const manual = context.source === DELIVERY_SOURCE.manual;
    const auditUser = manual ? context.actor?.name?.trim() || 'staff' : 'system';
    const auditActorId = context.actor?.id ?? client.assignedUserId;
    const communicationModel = (this.prisma as unknown as {
      cfCommunication?: { update: (args: unknown) => Promise<unknown> };
    }).cfCommunication;
    const activityModel = (this.prisma as unknown as {
      cfActivityLog?: { create: (args: unknown) => Promise<unknown> };
    }).cfActivityLog;
    if (delivery.status !== 'sent') {
      if (communicationModel) {
        await communicationModel.update({
          where: { id: communicationId },
          data: {
            status: COMMUNICATION_STATUS.failed,
            failedAt: new Date(),
            errorCode: 'reason' in delivery ? delivery.reason : 'unknown',
          },
        });
      }
      if (activityModel) {
        await activityModel.create({
          data: {
            organizationId: client.organizationId,
            clientId: client.id,
            actorUserId: auditActorId,
            action: 'WELCOME_FAILED',
            description: `Welcome email failed: ${'reason' in delivery ? delivery.reason : 'unknown'}.`,
            user: auditUser,
            source: context.source,
          },
        });
      }
      await this.createAdminNotifications({
        organizationId: client.organizationId,
        clientId: client.id,
        sourceType: 'welcome_delivery',
        sourceId: communicationId,
        type: 'WELCOME_FAILED',
        title: 'Welcome email failed',
        message: `Welcome delivery for ${client.primaryContactName} needs staff attention.`,
        actionUrl: `/clients/${client.id}?tab=communications`,
        isDemo: client.isDemo,
      });
      return;
    }
    await this.prisma.$transaction(async (transaction) => {
      if ((transaction as { cfCommunication?: { update: (args: unknown) => Promise<unknown> } }).cfCommunication) {
        await (transaction as { cfCommunication: { update: (args: unknown) => Promise<unknown> } }).cfCommunication.update({
          where: { id: communicationId },
          data: {
            status: COMMUNICATION_STATUS.sent,
            sentAt: new Date(delivery.sentAt),
            failedAt: null,
            errorCode: null,
          },
        });
      }
      await transaction.cfActivityLog.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          actorUserId: auditActorId,
          action: 'WELCOME_SENT',
          description: 'Welcome email sent',
          user: auditUser,
          source: context.source,
        },
      });
    });
  }

  private safeContract(contract: {
    id: string;
    organizationId: string;
    clientId: string;
    programId: string;
    contractTemplateId: string;
    status: string;
    secureTokenExpiresAt: Date | null;
    sentAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }, contractName: string) {
    return {
      id: contract.id,
      organizationId: contract.organizationId,
      clientId: contract.clientId,
      programId: contract.programId,
      contractTemplateId: contract.contractTemplateId,
      contractName,
      status: contract.status,
      secureTokenExpiresAt: contract.secureTokenExpiresAt,
      sentAt: contract.sentAt,
      completedAt: contract.completedAt,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    };
  }

  private publicContractUrl(rawToken: string): string {
    const appUrl = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    return `${appUrl}/agreements/${rawToken}`;
  }
}
