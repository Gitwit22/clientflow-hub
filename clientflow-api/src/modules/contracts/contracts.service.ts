import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type {
  ContractEmailDeliveryResult,
  WelcomeEmailDeliveryResult,
} from '../../integrations/n8n/n8n.types';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CONTRACT_CLIENT_STATUS,
  CONTRACT_STATUS,
  INITIAL_FOLLOW_UP_TYPE,
  MONITORING_TASK_STATUS,
  WELCOME_NEXT_STEP,
  contractRuleFor,
  contractTemplateNameFor,
  contractTokenExpiry,
  generateContractToken,
  hashContractToken,
  monitoringDueDate,
  renderContractSnapshot,
} from './contract-lifecycle';
import type { SubmitPublicContractDto } from './dto/submit-public-contract.dto';

const SAFE_PROGRAM_ERROR = 'The selected program is not configured for contract processing.';
const SAFE_TEMPLATE_ERROR = 'The selected program does not have an active contract template.';
const SAFE_PUBLIC_CONTRACT_ERROR = 'The contract link is invalid or unavailable.';
const CONTRACT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    private readonly n8n: N8nService,
  ) {}

  async prepareProgramSelection(organizationId: string, programName: string) {
    const programs = await this.prisma.cfProgram.findMany({
      where: { organizationId, name: programName, isActive: true },
      take: 2,
    });
    if (programs.length !== 1) throw new BadRequestException(SAFE_PROGRAM_ERROR);

    const program = programs[0];
    const rule = contractRuleFor(program.name);
    if (!rule) throw new BadRequestException(SAFE_PROGRAM_ERROR);
    const template = rule === 'auto_contract'
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

    const rule = contractRuleFor(program.name);
    if (!rule) throw new BadRequestException(SAFE_PROGRAM_ERROR);
    if (rule === 'staff_review') {
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

    const template = await this.resolveTemplate(program);
    const generated = await this.generateInternal(client, program, template);
    const issued = await this.issueContract(client, program, template, generated.contract.id);
    return {
      nextAction: 'CONTRACT_SENT' as const,
      clientStatus: CONTRACT_CLIENT_STATUS.contractSent,
      program: { id: program.id, name: program.name },
      ...issued,
    };
  }

  async generateForStaff(clientId: string) {
    this.assertStaffManagementEnabled();
    const { client, program } = await this.resolveClientProgram(clientId);
    const template = await this.resolveTemplate(program);
    const generated = await this.generateInternal(client, program, template);
    return {
      contract: this.safeContract(generated.contract, template.name),
      publicContractUrl: this.publicContractUrl(generated.rawToken),
    };
  }

  async sendForStaff(clientId: string, contractId: string) {
    this.assertStaffManagementEnabled();
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
    const availability = this.n8n.getWelcomeAvailability();
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
          action: 'CONTRACT_COMPLETED',
          description: 'Contract completed by client',
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
      const communication = await transaction.cfCommunication.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          eventId,
          contractId: contract.id,
          recipientEmail: client.email,
          channel: 'email',
          provider: 'n8n',
          status: availability === 'ready' ? 'requested' : 'skipped',
          requestedAt: now,
          errorCode: availability === 'ready' ? null : availability,
          type: 'welcome_email',
          direction: 'outbound',
          subject: 'Welcome to onboarding',
          notes: availability === 'ready'
            ? 'Welcome email requested.'
            : 'Welcome email skipped by configuration.',
          date: now,
          staffMember: 'system',
          isDemo: client.isDemo,
        },
      });
      return { monitoringTask, communication };
    });

    const welcomeDelivery = await this.n8n.sendWelcome(eventId, {
      eventType: 'welcome.send',
      organizationId: client.organizationId,
      clientId: client.id,
      recipientEmail: client.email,
      clientName: client.primaryContactName,
      programName: program.name,
      nextStep: WELCOME_NEXT_STEP,
    });
    await this.recordWelcomeDeliveryResult(
      completed.communication.id,
      client,
      welcomeDelivery,
    );

    return {
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
    if (!contractRuleFor(program.name)) throw new BadRequestException(SAFE_PROGRAM_ERROR);
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
    const mappedName = contractTemplateNameFor(program.name);
    if (!mappedName) throw new BadRequestException(SAFE_TEMPLATE_ERROR);
    const names = [...new Set([program.defaultContractTemplateId, mappedName])];
    const templates = await this.prisma.cfContractTemplate.findMany({
      where: {
        organizationId: program.organizationId,
        isActive: true,
        OR: [
          { id: program.defaultContractTemplateId },
          { name: { in: names } },
        ],
      },
    });
    const template = templates.find((candidate) => candidate.id === program.defaultContractTemplateId)
      ?? templates.find((candidate) => candidate.name === program.defaultContractTemplateId)
      ?? templates.find((candidate) => candidate.name === mappedName);
    if (!template) throw new BadRequestException(SAFE_TEMPLATE_ERROR);
    return template;
  }

  private async generateInternal(
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    program: Awaited<ReturnType<PrismaService['cfProgram']['findFirst']>> & {},
    template: Awaited<ReturnType<PrismaService['cfContractTemplate']['findFirst']>> & {},
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
        data: { secureTokenHash, secureTokenExpiresAt },
      });
      return { contract, rawToken };
    }

    const contract = await this.prisma.cfContract.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        programId: program.id,
        contractTemplateId: template.id,
        contractType: template.name,
        status: CONTRACT_STATUS.draft,
        secureTokenHash,
        secureTokenExpiresAt,
        generatedContent: renderContractSnapshot({
          templateName: template.name,
          templateContent: template.content,
          clientId: client.id,
          clientName: client.primaryContactName,
          programId: program.id,
          programName: program.name,
          generatedAt: now,
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
          status: availability === 'ready' ? 'requested' : 'skipped',
          requestedAt: now,
          errorCode: availability === 'ready' ? null : availability,
          type: 'contract_email',
          direction: 'outbound',
          subject: template.name,
          notes: availability === 'ready'
            ? 'Contract email requested.'
            : 'Contract email skipped by configuration.',
          date: now,
          staffMember: 'system',
          isDemo: client.isDemo,
        },
      });
      return { contract, communication };
    });

    const emailDelivery = await this.n8n.sendContract(eventId, {
      eventType: 'contract.send',
      organizationId: client.organizationId,
      clientId: client.id,
      recipientEmail: client.email,
      clientName: client.primaryContactName,
      programName: program.name,
      contractName: template.name,
      contractUrl: publicContractUrl,
      dueDate: secureTokenExpiresAt.toISOString().slice(0, 10),
    });
    await this.recordDeliveryResult(issued.communication.id, emailDelivery);

    return {
      contract: this.safeContract(issued.contract, template.name),
      publicContractUrl,
      emailDelivery,
    };
  }

  private async recordDeliveryResult(
    communicationId: string,
    delivery: ContractEmailDeliveryResult,
  ): Promise<void> {
    if (delivery.status === 'skipped') return;
    await this.prisma.cfCommunication.update({
      where: { id: communicationId },
      data: delivery.status === 'sent'
        ? { status: 'sent', sentAt: new Date(delivery.sentAt), failedAt: null, errorCode: null }
        : { status: 'failed', failedAt: new Date(), errorCode: delivery.reason },
    });
  }

  private async recordWelcomeDeliveryResult(
    communicationId: string,
    client: Awaited<ReturnType<PrismaService['cfClient']['findFirst']>> & {},
    delivery: WelcomeEmailDeliveryResult,
  ): Promise<void> {
    if (delivery.status === 'skipped') return;
    if (delivery.status === 'failed') {
      await this.prisma.cfCommunication.update({
        where: { id: communicationId },
        data: { status: 'failed', failedAt: new Date(), errorCode: delivery.reason },
      });
      return;
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.cfCommunication.update({
        where: { id: communicationId },
        data: {
          status: 'sent',
          sentAt: new Date(delivery.sentAt),
          failedAt: null,
          errorCode: null,
        },
      });
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
    return `${appUrl}/contracts/${rawToken}`;
  }

  private assertStaffManagementEnabled(): void {
    if (this.config.get('ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT', { infer: true }) !== 'true') {
      throw new ForbiddenException(
        'Contract management is disabled until standalone authentication is available.',
      );
    }
  }
}
