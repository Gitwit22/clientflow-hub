import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import type { ContractEmailDeliveryResult } from '../../integrations/n8n/n8n.types';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CONTRACT_CLIENT_STATUS,
  CONTRACT_STATUS,
  contractRuleFor,
  contractTemplateNameFor,
  contractTokenExpiry,
  generateContractToken,
  hashContractToken,
  renderContractSnapshot,
} from './contract-lifecycle';

const SAFE_PROGRAM_ERROR = 'The selected program is not configured for contract processing.';
const SAFE_TEMPLATE_ERROR = 'The selected program does not have an active contract template.';

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
