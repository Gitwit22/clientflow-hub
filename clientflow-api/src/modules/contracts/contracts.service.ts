import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type {
  ContractEmailDeliveryResult,
  WelcomeEmailDeliveryResult,
} from '../../integrations/n8n/n8n.types';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CONTRACT_CLIENT_STATUS,
  CONTRACT_STATUS,
  INITIAL_FOLLOW_UP_TYPE,
  MONITORING_TASK_STATUS,
  contractRuleFor,
  contractTokenExpiry,
  generateContractToken,
  hashContractToken,
  monitoringDueDate,
  renderContractSnapshot,
  WELCOME_NEXT_STEP,
} from './contract-lifecycle';
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
    private readonly storage: StorageService = { isEnabled: () => false } as unknown as StorageService,
  ) {}

  async prepareProgramSelection(organizationId: string, programName: string) {
    const programs = await this.prisma.cfProgram.findMany({
      where: { organizationId, name: programName, isActive: true },
      take: 2,
    });
    if (programs.length !== 1) throw new BadRequestException(SAFE_PROGRAM_ERROR);

    const program = programs[0];
    const workflow = await this.getOrCreateWorkflowConfig(program.organizationId, program.id, program.name);
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

    const workflow = await this.getOrCreateWorkflowConfig(program.organizationId, program.id, program.name);
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

  async generateForStaff(clientId: string, staffSigner: StaffSigner) {
    const { client, program } = await this.resolveClientProgram(clientId);
    const template = await this.resolveTemplate(program);
    const generated = await this.generateInternal(client, program, template, staffSigner);
    return {
      contract: this.safeContract(generated.contract, template.name),
      publicContractUrl: this.publicContractUrl(generated.rawToken),
    };
  }

  async sendForStaff(clientId: string, contractId: string) {
    const client = await this.prisma.cfClient.findFirst({
      where: { id: clientId, isArchived: false },
    });
    if (!client) throw new NotFoundException('Client not found.');

    const contract = await this.prisma.cfContract.findFirst({
      where: { id: contractId, clientId: client.id, organizationId: client.organizationId },
    });
    if (!contract) throw new NotFoundException('Contract not found.');
    if (![CONTRACT_STATUS.draft, CONTRACT_STATUS.sent].includes(contract.status as 'DRAFT' | 'SENT')) {
      throw new BadRequestException('The contract cannot be sent in its current status.');
    }

    const program = await this.prisma.cfProgram.findFirst({
      where: { id: contract.programId, organizationId: client.organizationId, isActive: true },
    });
    if (!program) throw new BadRequestException(SAFE_PROGRAM_ERROR);
    const template = await this.prisma.cfContractTemplate.findFirst({
      where: {
        id: contract.contractTemplateId,
        organizationId: client.organizationId,
        isActive: true,
      },
    });
    if (!template) throw new BadRequestException(SAFE_TEMPLATE_ERROR);
    return this.issueContract(client, program, template, contract.id);
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
    const workflow = await this.getOrCreateWorkflowConfig(program.organizationId, program.id, program.name);
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
      const communication = shouldSendWelcome
        ? await transaction.cfCommunication.create({
            data: {
              organizationId: client.organizationId,
              clientId: client.id,
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
              templateContext: welcomeConfig.context,
              date: now,
              staffMember: 'system',
              isDemo: client.isDemo,
            },
          })
        : null;
      return { monitoringTask, communication };
    });

    if (completed.communication && availability === 'ready') {
      await this.prisma.cfCommunication.update({
        where: { id: completed.communication.id },
        data: { status: COMMUNICATION_STATUS.sending },
      });
    }
    const welcomeDelivery = !shouldSendWelcome
      ? { status: 'skipped' as const, reason: 'disabled' as const }
      : availability !== 'ready'
        ? { status: 'failed' as const, reason: availability }
        : await this.n8n.sendWelcome(eventId, {
            organizationId: client.organizationId,
            clientId: client.id,
            recipientEmail: client.email,
            clientName: client.primaryContactName,
            programName: program.name,
            nextStep: welcomeConfig.body,
            attachmentUrl: await this.resolveWelcomeAttachmentUrl(welcomeConfig.guideStoredFileId),
            sentByUserId: client.assignedUserId ?? 'system',
          });
    if (completed.communication) {
      await this.recordWelcomeDeliveryResult(
        completed.communication.id,
        client,
        welcomeDelivery,
      );
    }

    await this.archiveExecutedContract(client, contract, acceptance, now);

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

  /** Uploads the fully signed document to R2 and files it on the client's record. Non-fatal on failure. */
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

      const objectKey = `contracts/${client.organizationId}/${client.id}/${contract.id}-executed.txt`;
      const uploaded = await this.storage.uploadText(objectKey, executedContent, 'text/plain');

      const storedFile = await this.prisma.cfStoredFile.create({
        data: {
          organizationId: client.organizationId,
          storageKey: uploaded.objectKey,
          originalFileName: `${contract.contractType} - Executed.txt`,
          mimeType: 'text/plain',
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
    const workflow = await this.getOrCreateWorkflowConfig(program.organizationId, program.id, program.name);
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
    template: Awaited<ReturnType<PrismaService['cfContractTemplate']['findFirst']>> & {},
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
        status: { in: [CONTRACT_STATUS.draft, CONTRACT_STATUS.sent] },
      },
      orderBy: { createdAt: 'desc' },
    });
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
      return { contract, rawToken };
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
    return { contract, rawToken };
  }

  private async issueContract(
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {},
    template: Awaited<ReturnType<PrismaService['cfContractTemplate']['findFirst']>> & {},
    contractId: string,
  ) {
    const now = new Date();
    const rawToken = generateContractToken();
    const secureTokenHash = hashContractToken(rawToken);
    const secureTokenExpiresAt = contractTokenExpiry(now);
    const publicContractUrl = this.publicContractUrl(rawToken);
    const availability = this.n8n.getContractAvailability();
    const eventId = `contract.send:${contractId}:${secureTokenHash.slice(0, 16)}`;

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
          actorUserId: client.assignedUserId,
          action: 'CONTRACT_SENT',
          description: 'Contract sent',
          user: 'system',
        },
      });
      const communication = await transaction.cfCommunication.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
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
          staffMember: 'system',
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

  private async getOrCreateWorkflowConfig(organizationId: string, programId: string, programName?: string) {
    const workflowModel = (this.prisma as unknown as {
      cfProgramWorkflowConfig?: {
        findFirst: (args: unknown) => Promise<any>;
        create: (args: unknown) => Promise<any>;
      };
    }).cfProgramWorkflowConfig;
    const legacyRule = programName ? contractRuleFor(programName) : null;
    const fallbackConfig = {
      id: 'legacy-workflow-config',
      organizationId,
      programId,
      enabled: true,
      sendContractAfterIntake: legacyRule ? legacyRule === 'auto_contract' : true,
      sendWelcomeAfterContractSigned: true,
      activeContractTemplateId: null,
      activeContractVersionId: null,
      activeWelcomeEmailTemplateId: null,
      activeWelcomeEmailVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (!workflowModel) return fallbackConfig;
    const existing = await workflowModel.findFirst({
      where: { organizationId, programId },
    });
    if (existing) return existing;
    return workflowModel.create({
      data: {
        organizationId,
        programId,
        sendContractAfterIntake: fallbackConfig.sendContractAfterIntake,
        sendWelcomeAfterContractSigned: fallbackConfig.sendWelcomeAfterContractSigned,
      },
    });
  }

  private async resolveWelcomeEmailForDelivery(input: {
    workflow: Awaited<ReturnType<ContractsService['getOrCreateWorkflowConfig']>>;
    organizationId: string;
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {};
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {};
    enrollmentId: string | null;
    fallbackMessage?: string;
  }) {
    const organizationModel = (this.prisma as unknown as {
      organization?: { findUnique: (args: unknown) => Promise<{ name: string } | null> };
    }).organization;
    const enrollmentModel = (this.prisma as unknown as {
      cfProgramEnrollment?: { findFirst: (args: unknown) => Promise<{ startDate: Date | null; nextAction: string | null } | null> };
    }).cfProgramEnrollment;
    const [organization, enrollment] = await Promise.all([
      organizationModel
        ? organizationModel.findUnique({
            where: { id: input.organizationId },
            select: { name: true },
          })
        : Promise.resolve(null),
      input.enrollmentId && enrollmentModel
        ? enrollmentModel.findFirst({
            where: { id: input.enrollmentId, organizationId: input.organizationId },
            select: { startDate: true, nextAction: true },
          })
        : Promise.resolve(null),
    ]);

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
        findFirst: (args: unknown) => Promise<{ id: string } | null>;
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
          select: { id: true },
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
      return {
        subject: fallbackSubject,
        body: fallbackBody,
        context,
        guideStoredFileId: null,
      };
    }
    return {
      subject: this.renderWelcomeTemplate(activeVersion.subject, context),
      body: this.renderWelcomeTemplate(activeVersion.body, context),
      context,
      guideStoredFileId: activeVersion.guideStoredFileId ?? null,
    };
  }

  private renderWelcomeTemplate(template: string, context: Record<string, unknown>): string {
    return template.replace(WELCOME_VARIABLE_PATTERN, (_full, path: string) => {
      if (!ALLOWED_WELCOME_VARIABLES.has(path)) return '';
      const value = this.readTemplateValue(context, path);
      return value === null || value === undefined ? '' : String(value);
    });
  }

  private async resolveWelcomeAttachmentUrl(storedFileId: string | null): Promise<string | undefined> {
    if (!storedFileId || !this.storage.isEnabled()) return undefined;
    const storedFile = await this.prisma.cfStoredFile.findFirst({
      where: { id: storedFileId },
      select: { storageKey: true },
    });
    if (!storedFile) return undefined;
    const download = await this.storage.createPresignedDownloadUrl(storedFile.storageKey, 900);
    return download.url;
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
  ): Promise<void> {
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
            actorUserId: client.assignedUserId,
            action: 'WELCOME_FAILED',
            description: `Welcome email failed: ${'reason' in delivery ? delivery.reason : 'unknown'}.`,
            user: 'system',
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
          actorUserId: client.assignedUserId,
          action: 'WELCOME_SENT',
          description: 'Welcome email sent',
          user: 'system',
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
