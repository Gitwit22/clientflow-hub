import {
  All,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, compare } from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { sign, verify as jwtVerify } from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { CfProgramAction, CfProgramTrigger } from '../../generated/clientflow';
import { PrismaService } from '../../prisma/prisma.service';
import { ScaffoldService } from '../../common/services/scaffold.service';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { ProgramAutomationService } from '../automation/program-automation.service';

const ACCESS_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-clientflow_session' : 'clientflow_session';
const REFRESH_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-clientflow_refresh' : 'clientflow_refresh';
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readJwtSecret(type: 'access' | 'refresh'): string {
  const key = type === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET';
  return process.env[key] ?? process.env.JWT_SECRET ?? 'development-clientflow-secret';
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

function getSessionTokenPayload(token: string, type: 'access' | 'refresh') {
  if (!token) throw new UnauthorizedException('Missing authenticated session.');
  const secret = readJwtSecret(type);
  try {
    return jwtVerify(token, secret) as Record<string, unknown> & { sub?: string; email?: string; roles?: string[]; organizationId?: string; sessionId?: string; jti?: string };
  } catch {
    throw new UnauthorizedException('Invalid or expired token.');
  }
}

function hashRefreshToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeAdminShape(admin: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  role: string;
  organizationId: string;
  isActive: boolean;
}) {
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.firstName ?? undefined,
    lastName: admin.lastName ?? undefined,
    jobTitle: admin.jobTitle ?? undefined,
    role: admin.role,
    organizationId: admin.organizationId,
    active: admin.isActive,
  };
}

function getCookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie ?? '';
  for (const chunk of raw.split(';')) {
    const [key, ...rest] = chunk.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function setSessionCookies(response: Response, accessToken: string, refreshToken: string): void {
  const cookies = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    partitioned: process.env.NODE_ENV === 'production',
  };
  response.cookie(ACCESS_COOKIE_NAME, accessToken, { ...cookies, maxAge: ACCESS_TTL_MS });
  response.cookie(REFRESH_COOKIE_NAME, refreshToken, { ...cookies, maxAge: REFRESH_TTL_MS });
}

function clearSessionCookies(response: Response): void {
  response.clearCookie(ACCESS_COOKIE_NAME, { path: '/', httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production', partitioned: process.env.NODE_ENV === 'production' });
  response.clearCookie(REFRESH_COOKIE_NAME, { path: '/', httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production', partitioned: process.env.NODE_ENV === 'production' });
}

function signSessionToken(adminId: string, email: string, roles: string[], organizationId: string | null, sessionId: string, jti: string, type: 'access' | 'refresh') {
  const secret = readJwtSecret(type);
  const expiresIn = type === 'access' ? process.env.JWT_ACCESS_EXPIRES_IN ?? '15m' : process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
  return sign({
    email,
    roles,
    sessionId,
    jti,
    organizationId,
    appPartition: 'clientflow',
  }, secret as any, {
    subject: adminId,
    expiresIn,
    issuer: 'clientflow',
  } as any);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseProgramTrigger(value: unknown): CfProgramTrigger | null {
  if (typeof value !== 'string') return null;
  return Object.values(CfProgramTrigger).includes(value as CfProgramTrigger)
    ? value as CfProgramTrigger
    : null;
}

function parseProgramAction(value: unknown): CfProgramAction | null {
  if (typeof value !== 'string') return null;
  return Object.values(CfProgramAction).includes(value as CfProgramAction)
    ? value as CfProgramAction
    : null;
}

@Controller('admin/cf')
export class ClientflowCompatibilityController {
  private readonly logger = new Logger(ClientflowCompatibilityController.name);

  constructor(
    private readonly scaffold: ScaffoldService,
    private readonly prisma?: PrismaService,
    private readonly n8n?: N8nService,
    private readonly automation?: ProgramAutomationService,
  ) {}

  private requirePrisma(): PrismaService {
    if (!this.prisma) throw this.scaffold.notImplemented('ClientFlow admin compatibility');
    return this.prisma;
  }

  private async requireOrgFromRequest(request: Request) {
    const accessToken = (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined) ?? getCookieValue(request, ACCESS_COOKIE_NAME);
    if (!accessToken) throw new UnauthorizedException('Missing authenticated session.');
    const payload = getSessionTokenPayload(accessToken, 'access');
    const admin = await this.requirePrisma().adminUser.findUnique({
      where: { id: payload.sub ?? '' },
      select: { id: true, email: true, firstName: true, lastName: true, jobTitle: true, role: true, organizationId: true, isActive: true },
    });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Authenticated session is no longer active.');
    if (payload.organizationId && payload.organizationId !== admin.organizationId) {
      throw new UnauthorizedException('Authenticated organization is invalid.');
    }
    return { admin, orgId: admin.organizationId };
  }

  private async getDemoStatusFor(orgId: string) {
    const org = await this.requirePrisma().organization.findUnique({
      where: { id: orgId },
      select: { liveMode: true, demoRemovedAt: true, principalAdminId: true },
    });
    return { liveMode: !!org?.liveMode, demoRemovedAt: org?.demoRemovedAt ?? null, principalAdminId: org?.principalAdminId ?? null };
  }

  private async upsertProgramWorkflowConfig(
    organizationId: string,
    programId: string,
    data: Record<string, unknown>,
  ) {
    const existing = await this.requirePrisma().cfProgramWorkflowConfig.findFirst({
      where: { organizationId, programId },
      select: { id: true },
    });
    if (existing) {
      return this.requirePrisma().cfProgramWorkflowConfig.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.requirePrisma().cfProgramWorkflowConfig.create({
      data: {
        organizationId,
        programId,
        ...data,
      },
    });
  }

  private async getProgramWorkflow(organizationId: string, programId: string) {
    const prisma = this.requirePrisma();
    const [config, contractTemplates, welcomeTemplates] = await Promise.all([
      prisma.cfProgramWorkflowConfig.findFirst({
        where: { organizationId, programId },
      }),
      prisma.cfProgramContractTemplate.findMany({
        where: { organizationId, programId, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.cfProgramWelcomeEmailTemplate.findMany({
        where: { organizationId, programId, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const contractTemplateIds = contractTemplates.map((template) => template.id);
    const welcomeTemplateIds = welcomeTemplates.map((template) => template.id);
    const [contractVersions, welcomeVersions] = await Promise.all([
      contractTemplateIds.length
        ? prisma.cfProgramContractVersion.findMany({
            where: { organizationId, templateId: { in: contractTemplateIds } },
            orderBy: [{ templateId: 'asc' }, { version: 'desc' }],
          })
        : Promise.resolve([]),
      welcomeTemplateIds.length
        ? prisma.cfProgramWelcomeEmailVersion.findMany({
            where: { organizationId, templateId: { in: welcomeTemplateIds } },
            orderBy: [{ templateId: 'asc' }, { version: 'desc' }],
          })
        : Promise.resolve([]),
    ]);
    const activeContractTemplate = config?.activeContractTemplateId
      ? contractTemplates.find((template) => template.id === config.activeContractTemplateId) ?? null
      : contractTemplates[0] ?? null;
    const activeWelcomeTemplate = config?.activeWelcomeEmailTemplateId
      ? welcomeTemplates.find((template) => template.id === config.activeWelcomeEmailTemplateId) ?? null
      : welcomeTemplates[0] ?? null;
    const activeContractVersion = config?.activeContractVersionId
      ? contractVersions.find((version) => version.id === config.activeContractVersionId) ?? null
      : activeContractTemplate
        ? contractVersions.find((version) => version.templateId === activeContractTemplate.id) ?? null
        : contractVersions[0] ?? null;
    const activeWelcomeVersion = config?.activeWelcomeEmailVersionId
      ? welcomeVersions.find((version) => version.id === config.activeWelcomeEmailVersionId) ?? null
      : activeWelcomeTemplate
        ? welcomeVersions.find((version) => version.templateId === activeWelcomeTemplate.id) ?? null
        : welcomeVersions[0] ?? null;
    return {
      config: config ?? {
        enabled: true,
        sendContractAfterIntake: false,
        sendWelcomeAfterContractSigned: false,
        activeContractTemplateId: null,
        activeContractVersionId: null,
        activeWelcomeEmailTemplateId: null,
        activeWelcomeEmailVersionId: null,
      },
      contract: {
        templates: contractTemplates,
        versions: contractVersions,
        activeTemplate: activeContractTemplate,
        activeVersion: activeContractVersion,
      },
      welcomeEmail: {
        templates: welcomeTemplates,
        versions: welcomeVersions,
        activeTemplate: activeWelcomeTemplate,
        activeVersion: activeWelcomeVersion,
      },
      automation: {
        enabled: config?.enabled ?? true,
        sendContractAfterIntake: config?.sendContractAfterIntake ?? false,
        sendWelcomeAfterContractSigned: config?.sendWelcomeAfterContractSigned ?? false,
      },
    };
  }

  @Get('clients') async listClients(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfClient.findMany({ where: { organizationId: orgId, isArchived: false }, orderBy: { createdAt: 'desc' } });
  }
  @Get('clients/:id') async getClient(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const client = await this.requirePrisma().cfClient.findFirst({ where: { id, organizationId: orgId, isArchived: false } });
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }
  @Post('clients') async createClient(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfClient.create({ data: { ...body, organizationId: orgId, businessName: String(body.businessName ?? 'Untitled Client'), primaryContactName: String(body.primaryContactName ?? 'Unknown Contact'), email: String(body.email ?? ''), phone: String(body.phone ?? ''), assignedStaff: String(body.assignedStaff ?? 'Unassigned'), intake: (isRecord(body.intake) ? body.intake : {}) as any, socialLinks: Array.isArray(body.socialLinks) ? body.socialLinks : [], status: String(body.status ?? 'New Intake'), lifecycleStatus: String(body.lifecycleStatus ?? 'intake_pending'), source: String(body.source ?? 'admin_created'), intakeSource: String(body.intakeSource ?? 'admin_created'), } as any });
  }
  @Patch('clients/:id') async updateClient(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfClient.update({ where: { id, organizationId: orgId }, data: body });
  }
  @Delete('clients/:id') async deleteClient(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    await this.requirePrisma().cfClient.update({ where: { id, organizationId: orgId }, data: { isArchived: true, archiveReason: 'Deleted via compatibility route' } });
    return { id, deleted: true };
  }

  @Get('programs') async listPrograms(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfProgram.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } });
  }
  @Get('programs/:id/detail') async getProgramDetail(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const program = await prisma.cfProgram.findFirst({ where: { id, organizationId: orgId } });
    if (!program) throw new NotFoundException('Program not found.');
    const enrollments = await prisma.cfProgramEnrollment.findMany({
      where: { organizationId: orgId, programId: id, isArchived: false },
      orderBy: { createdAt: 'desc' },
    });
    const clientIds = enrollments.map((enrollment) => enrollment.clientId);
    const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
    const [clients, formAssignments, formTemplates, terms, contracts, monitoring, statusHistory] = await Promise.all([
      prisma.cfClient.findMany({
        where: { organizationId: orgId, id: { in: clientIds }, isArchived: false },
        select: { id: true, businessName: true, primaryContactName: true, email: true, phone: true },
      }),
      prisma.cfFormAssignment.findMany({
        where: { organizationId: orgId, enrollmentId: { in: enrollmentIds } },
        select: { id: true, formId: true, enrollmentId: true, status: true, dueAt: true, dueDate: true, sentAt: true, openedAt: true, submittedAt: true, responses: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.cfFormTemplate.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      }),
      prisma.cfTerms.findMany({
        where: { organizationId: orgId, enrollmentId: { in: enrollmentIds } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.cfContract.findMany({
        where: { organizationId: orgId, enrollmentId: { in: enrollmentIds } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.cfEnrollmentMonitoring.findMany({
        where: { organizationId: orgId, enrollmentId: { in: enrollmentIds } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.cfEnrollmentStatusHistory.findMany({
        where: { organizationId: orgId, enrollmentId: { in: enrollmentIds } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const participants = enrollments.flatMap((enrollment) => {
      const client = clients.find((item) => item.id === enrollment.clientId);
      if (!client) return [];
      const enrollmentForms = formAssignments.filter((item) => item.enrollmentId === enrollment.id);
      return [{
        client,
        enrollment,
        coreIntake: [],
        programIntake: [],
        forms: enrollmentForms.map((item) => {
          const template = formTemplates.find((t) => t.id === item.formId);
          return {
            id: item.id,
            formId: item.formId,
            templateName: template?.name ?? 'Unknown form',
            status: item.status,
            dueAt: item.dueAt,
            dueDate: item.dueDate,
            sentAt: item.sentAt,
            openedAt: item.openedAt,
            submittedAt: item.submittedAt,
            answers: Array.isArray(item.responses) ? item.responses : [],
          };
        }),
        terms: terms.filter((item) => item.enrollmentId === enrollment.id),
        contracts: contracts.filter((item) => item.enrollmentId === enrollment.id),
        monitoring: monitoring.filter((item) => item.enrollmentId === enrollment.id),
        statusHistory: statusHistory.filter((item) => item.enrollmentId === enrollment.id),
      }];
    });
    const workflow = await this.getProgramWorkflow(orgId, id);
    return {
      program,
      workflow,
      summary: {
        current: participants.filter(({ enrollment }) => !['completed', 'declined', 'withdrawn'].includes(enrollment.status)).length,
        completed: participants.filter(({ enrollment }) => enrollment.status === 'completed').length,
        closed: participants.filter(({ enrollment }) => ['declined', 'withdrawn'].includes(enrollment.status)).length,
      },
      participants,
    };
  }
  @Post('programs') async createProgram(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const program = await this.requirePrisma().cfProgram.create({ data: { organizationId: orgId, name: String(body.name ?? 'Untitled Program'), description: String(body.description ?? ''), defaultFormTemplateId: String(body.defaultFormTemplateId ?? 'unknown'), defaultMonitoringFrequency: String(body.defaultMonitoringFrequency ?? 'monthly'), defaultContractTemplateId: String(body.defaultContractTemplateId ?? 'unknown'), defaultWorkflow: Array.isArray(body.defaultWorkflow) ? body.defaultWorkflow.map(String) : [], requiredDocuments: Array.isArray(body.requiredDocuments) ? body.requiredDocuments.map(String) : [], statusPipeline: Array.isArray(body.statusPipeline) ? body.statusPipeline.map(String) : [] } });
    await this.requirePrisma().cfProgramWorkflowConfig.create({
      data: {
        organizationId: orgId,
        programId: program.id,
        enabled: true,
        sendContractAfterIntake: body.sendContractAfterIntake === true,
        sendWelcomeAfterContractSigned: body.sendWelcomeAfterContractSigned === true,
      },
    });
    return program;
  }
  @Patch('programs/:id') async updateProgram(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfProgram.update({ where: { id, organizationId: orgId }, data: body });
  }
  @Get('programs/:id/workflow') async getProgramWorkflowConfig(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.getProgramWorkflow(orgId, id);
  }
  @Patch('programs/:id/workflow') async updateProgramWorkflowConfig(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    await this.requirePrisma().cfProgram.findFirstOrThrow({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    const existing = await this.requirePrisma().cfProgramWorkflowConfig.findFirst({
      where: { organizationId: orgId, programId: id },
      select: { id: true },
    });
    const data = {
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      sendContractAfterIntake: body.sendContractAfterIntake !== undefined ? Boolean(body.sendContractAfterIntake) : undefined,
      sendWelcomeAfterContractSigned: body.sendWelcomeAfterContractSigned !== undefined ? Boolean(body.sendWelcomeAfterContractSigned) : undefined,
      activeContractTemplateId: body.activeContractTemplateId !== undefined
        ? (body.activeContractTemplateId ? String(body.activeContractTemplateId) : null)
        : undefined,
      activeContractVersionId: body.activeContractVersionId !== undefined
        ? (body.activeContractVersionId ? String(body.activeContractVersionId) : null)
        : undefined,
      activeWelcomeEmailTemplateId: body.activeWelcomeEmailTemplateId !== undefined
        ? (body.activeWelcomeEmailTemplateId ? String(body.activeWelcomeEmailTemplateId) : null)
        : undefined,
      activeWelcomeEmailVersionId: body.activeWelcomeEmailVersionId !== undefined
        ? (body.activeWelcomeEmailVersionId ? String(body.activeWelcomeEmailVersionId) : null)
        : undefined,
    };
    if (data.activeContractTemplateId) {
      const contractTemplate = await this.requirePrisma().cfProgramContractTemplate.findFirst({
        where: {
          id: data.activeContractTemplateId,
          organizationId: orgId,
          programId: id,
          isActive: true,
        },
        select: { id: true },
      });
      if (!contractTemplate) throw new BadRequestException('Invalid active contract template for this program.');
    }
    if (data.activeContractVersionId) {
      const contractVersion = await this.requirePrisma().cfProgramContractVersion.findFirst({
        where: {
          id: data.activeContractVersionId,
          organizationId: orgId,
        },
        select: { id: true, templateId: true },
      });
      const owningTemplate = contractVersion
        ? await this.requirePrisma().cfProgramContractTemplate.findFirst({
            where: {
              id: contractVersion.templateId,
              organizationId: orgId,
              programId: id,
              isActive: true,
            },
            select: { id: true },
          })
        : null;
      if (!contractVersion || !owningTemplate) {
        throw new BadRequestException('Invalid active contract version for this program.');
      }
    }
    if (data.activeWelcomeEmailTemplateId) {
      const welcomeTemplate = await this.requirePrisma().cfProgramWelcomeEmailTemplate.findFirst({
        where: {
          id: data.activeWelcomeEmailTemplateId,
          organizationId: orgId,
          programId: id,
          isActive: true,
        },
        select: { id: true },
      });
      if (!welcomeTemplate) throw new BadRequestException('Invalid active welcome template for this program.');
    }
    if (data.activeWelcomeEmailVersionId) {
      const welcomeVersion = await this.requirePrisma().cfProgramWelcomeEmailVersion.findFirst({
        where: {
          id: data.activeWelcomeEmailVersionId,
          organizationId: orgId,
        },
        select: { id: true, templateId: true },
      });
      const owningTemplate = welcomeVersion
        ? await this.requirePrisma().cfProgramWelcomeEmailTemplate.findFirst({
            where: {
              id: welcomeVersion.templateId,
              organizationId: orgId,
              programId: id,
              isActive: true,
            },
            select: { id: true },
          })
        : null;
      if (!welcomeVersion || !owningTemplate) {
        throw new BadRequestException('Invalid active welcome version for this program.');
      }
    }
    if (existing) {
      await this.requirePrisma().cfProgramWorkflowConfig.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.requirePrisma().cfProgramWorkflowConfig.create({
        data: {
          organizationId: orgId,
          programId: id,
          enabled: data.enabled ?? true,
          sendContractAfterIntake: data.sendContractAfterIntake ?? false,
          sendWelcomeAfterContractSigned: data.sendWelcomeAfterContractSigned ?? false,
          activeContractTemplateId: data.activeContractTemplateId ?? null,
          activeContractVersionId: data.activeContractVersionId ?? null,
          activeWelcomeEmailTemplateId: data.activeWelcomeEmailTemplateId ?? null,
          activeWelcomeEmailVersionId: data.activeWelcomeEmailVersionId ?? null,
        },
      });
    }
    return this.getProgramWorkflow(orgId, id);
  }
  @Post('programs/:id/workflow/contracts/templates') async createProgramWorkflowContractTemplate(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const template = await this.requirePrisma().cfProgramContractTemplate.create({
      data: {
        organizationId: orgId,
        programId: id,
        name: String(body.name ?? 'Program Contract'),
        signatureRequired: body.signatureRequired !== false,
        isActive: body.isActive !== false,
      },
    });
    if (body.content || body.fileUrl || body.fileName) {
      await this.requirePrisma().cfProgramContractVersion.create({
        data: {
          organizationId: orgId,
          templateId: template.id,
          version: 1,
          title: body.title ? String(body.title) : null,
          content: String(body.content ?? ''),
          fileUrl: body.fileUrl ? String(body.fileUrl) : null,
          fileName: body.fileName ? String(body.fileName) : null,
          signableFields: Array.isArray(body.signableFields) ? body.signableFields : [],
          createdBy: admin.email,
        },
      });
    }
    return this.getProgramWorkflow(orgId, id);
  }
  @Post('programs/:programId/workflow/contracts/templates/:templateId/versions') async createProgramWorkflowContractVersion(@Req() request: Request, @Param('programId') programId: string, @Param('templateId') templateId: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const template = await this.requirePrisma().cfProgramContractTemplate.findFirst({
      where: { id: templateId, organizationId: orgId, programId },
      select: { id: true },
    });
    if (!template) throw new NotFoundException('Program workflow contract template not found.');
    const latest = await this.requirePrisma().cfProgramContractVersion.findFirst({
      where: { organizationId: orgId, templateId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = await this.requirePrisma().cfProgramContractVersion.create({
      data: {
        organizationId: orgId,
        templateId,
        version: Number(body.version ?? ((latest?.version ?? 0) + 1)),
        title: body.title ? String(body.title) : null,
        content: String(body.content ?? ''),
        fileUrl: body.fileUrl ? String(body.fileUrl) : null,
        fileName: body.fileName ? String(body.fileName) : null,
        signableFields: Array.isArray(body.signableFields) ? body.signableFields : [],
        createdBy: admin.email,
      },
    });
    if (body.makeActive !== false) {
      await this.upsertProgramWorkflowConfig(orgId, programId, { activeContractVersionId: version.id, activeContractTemplateId: templateId });
    }
    return this.getProgramWorkflow(orgId, programId);
  }
  @Post('programs/:id/workflow/emails/templates') async createProgramWorkflowWelcomeTemplate(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const template = await this.requirePrisma().cfProgramWelcomeEmailTemplate.create({
      data: {
        organizationId: orgId,
        programId: id,
        name: String(body.name ?? 'Welcome Email'),
        isActive: body.isActive !== false,
      },
    });
    if (body.subject || body.body) {
      await this.requirePrisma().cfProgramWelcomeEmailVersion.create({
        data: {
          organizationId: orgId,
          templateId: template.id,
          version: 1,
          subject: String(body.subject ?? `Welcome to ${body.programName ?? 'the program'}`),
          body: String(body.body ?? ''),
          createdBy: admin.email,
          allowedVariables: Array.isArray(body.allowedVariables) ? body.allowedVariables : [],
        },
      });
    }
    return this.getProgramWorkflow(orgId, id);
  }
  @Post('programs/:programId/workflow/emails/templates/:templateId/versions') async createProgramWorkflowWelcomeVersion(@Req() request: Request, @Param('programId') programId: string, @Param('templateId') templateId: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const template = await this.requirePrisma().cfProgramWelcomeEmailTemplate.findFirst({
      where: { id: templateId, organizationId: orgId, programId },
      select: { id: true },
    });
    if (!template) throw new NotFoundException('Program workflow welcome template not found.');
    const latest = await this.requirePrisma().cfProgramWelcomeEmailVersion.findFirst({
      where: { organizationId: orgId, templateId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = await this.requirePrisma().cfProgramWelcomeEmailVersion.create({
      data: {
        organizationId: orgId,
        templateId,
        version: Number(body.version ?? ((latest?.version ?? 0) + 1)),
        subject: String(body.subject ?? `Welcome to ${body.programName ?? 'the program'}`),
        body: String(body.body ?? ''),
        createdBy: admin.email,
        allowedVariables: Array.isArray(body.allowedVariables) ? body.allowedVariables : [],
      },
    });
    if (body.makeActive !== false) {
      await this.upsertProgramWorkflowConfig(orgId, programId, { activeWelcomeEmailVersionId: version.id, activeWelcomeEmailTemplateId: templateId });
    }
    return this.getProgramWorkflow(orgId, programId);
  }
  @Get('programs/:id/automation') async getProgramAutomation(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const [rules, templates] = await Promise.all([
      prisma.cfProgramAutomationRule.findMany({
        where: { organizationId: orgId, programId: id },
        orderBy: [{ trigger: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.cfProgramDocumentTemplate.findMany({
        where: { organizationId: orgId, programId: id },
        orderBy: [{ createdAt: 'asc' }],
      }),
    ]);
    const versions = templates.length === 0
      ? []
      : await prisma.cfProgramDocumentVersion.findMany({
          where: { organizationId: orgId, templateId: { in: templates.map((template) => template.id) } },
          orderBy: [{ templateId: 'asc' }, { version: 'desc' }],
        });
    return { rules, templates, versions };
  }
  @Post('programs/:id/automation/rules') async createProgramAutomationRule(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    if (body.trigger === undefined) throw new BadRequestException('Automation trigger is required.');
    if (body.action === undefined) throw new BadRequestException('Automation action is required.');
    const trigger = parseProgramTrigger(body.trigger);
    const action = parseProgramAction(body.action);
    if (!trigger) throw new BadRequestException('Invalid automation trigger.');
    if (!action) throw new BadRequestException('Invalid automation action.');
    return this.requirePrisma().cfProgramAutomationRule.create({
      data: {
        organizationId: orgId,
        programId: id,
        trigger,
        conditions: isRecord(body.conditions) ? body.conditions as any : {},
        action,
        actionConfig: isRecord(body.actionConfig) ? body.actionConfig as any : {},
        enabled: body.enabled !== false,
        sortOrder: Number(body.sortOrder ?? 0),
      },
    });
  }
  @Patch('programs/:programId/automation/rules/:ruleId') async updateProgramAutomationRule(@Req() request: Request, @Param('programId') programId: string, @Param('ruleId') ruleId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const existing = await this.requirePrisma().cfProgramAutomationRule.findFirst({
      where: { id: ruleId, organizationId: orgId, programId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Program automation rule not found.');
    const trigger = body.trigger !== undefined ? parseProgramTrigger(body.trigger) : undefined;
    const action = body.action !== undefined ? parseProgramAction(body.action) : undefined;
    if (body.trigger !== undefined && !trigger) throw new BadRequestException('Invalid automation trigger.');
    if (body.action !== undefined && !action) throw new BadRequestException('Invalid automation action.');
    if (body.conditions !== undefined && !isRecord(body.conditions)) {
      throw new BadRequestException('Automation conditions must be an object.');
    }
    if (body.actionConfig !== undefined && !isRecord(body.actionConfig)) {
      throw new BadRequestException('Automation actionConfig must be an object.');
    }
    return this.requirePrisma().cfProgramAutomationRule.update({
      where: { id: ruleId },
      data: {
        ...(trigger ? { trigger } : {}),
        ...(action ? { action } : {}),
        ...(body.conditions !== undefined ? { conditions: body.conditions as any } : {}),
        ...(body.actionConfig !== undefined ? { actionConfig: body.actionConfig as any } : {}),
        ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}),
      },
    });
  }
  @Post('programs/:id/documents/templates') async createProgramDocumentTemplate(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const trigger = body.trigger === undefined || body.trigger === null || body.trigger === ''
      ? null
      : parseProgramTrigger(body.trigger);
    if (body.trigger !== undefined && body.trigger !== null && body.trigger !== '' && !trigger) {
      throw new BadRequestException('Invalid program document trigger.');
    }
    return this.requirePrisma().cfProgramDocumentTemplate.create({
      data: {
        organizationId: orgId,
        programId: id,
        name: String(body.name ?? 'Untitled Document'),
        type: String(body.type ?? 'document'),
        required: body.required !== false,
        signatureRequired: body.signatureRequired === true,
        autoSend: body.autoSend === true,
        trigger,
        isActive: body.isActive !== false,
      },
    });
  }
  @Post('programs/:programId/documents/templates/:templateId/versions') async createProgramDocumentVersion(@Req() request: Request, @Param('programId') programId: string, @Param('templateId') templateId: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const template = await prisma.cfProgramDocumentTemplate.findFirst({ where: { id: templateId, organizationId: orgId, programId } });
    if (!template) throw new NotFoundException('Program document template not found.');
    const requestedVersion = body.version !== undefined ? Number(body.version) : null;
    const payload = {
      organizationId: orgId,
      templateId,
      fileUrl: String(body.fileUrl ?? ''),
      fileName: body.fileName ? String(body.fileName) : null,
      objectKey: body.objectKey ? String(body.objectKey) : null,
      bucket: body.bucket ? String(body.bucket) : null,
      byteSize: body.byteSize !== undefined ? Number(body.byteSize) : null,
      checksum: body.checksum ? String(body.checksum) : null,
      createdBy: admin.email,
    };
    const makeActive = body.makeActive !== false;
    let version: Awaited<ReturnType<typeof prisma.cfProgramDocumentVersion.create>> | null = null;
    if (requestedVersion !== null) {
      try {
        version = await prisma.$transaction(async (transaction) => {
          const created = await transaction.cfProgramDocumentVersion.create({
            data: { ...payload, version: requestedVersion },
          });
          if (makeActive) {
            await transaction.cfProgramDocumentTemplate.update({
              where: { id: templateId },
              data: { activeVersionId: created.id },
            });
          }
          return created;
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new BadRequestException(`Document version ${requestedVersion} already exists for this template.`);
        }
        throw error;
      }
    } else {
      version = await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`cf_program_doc_version:${templateId}`}))`;
        const latest = await transaction.cfProgramDocumentVersion.findFirst({
          where: { organizationId: orgId, templateId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const created = await transaction.cfProgramDocumentVersion.create({
          data: { ...payload, version: (latest?.version ?? 0) + 1 },
        });
        if (makeActive) {
          await transaction.cfProgramDocumentTemplate.update({
            where: { id: templateId },
            data: { activeVersionId: created.id },
          });
        }
        return created;
      });
    }
    return version;
  }
  @Patch('programs/:programId/documents/templates/:templateId') async updateProgramDocumentTemplate(@Req() request: Request, @Param('programId') programId: string, @Param('templateId') templateId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const template = await this.requirePrisma().cfProgramDocumentTemplate.findFirst({ where: { id: templateId, organizationId: orgId, programId } });
    if (!template) throw new NotFoundException('Program document template not found.');
    let triggerUpdate: CfProgramTrigger | null | undefined;
    if (body.trigger !== undefined) {
      if (body.trigger === null || body.trigger === '') {
        triggerUpdate = null;
      } else {
        triggerUpdate = parseProgramTrigger(body.trigger);
        if (!triggerUpdate) throw new BadRequestException('Invalid program document trigger.');
      }
    }
    return this.requirePrisma().cfProgramDocumentTemplate.update({
      where: { id: templateId },
      data: {
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.type !== undefined ? { type: String(body.type) } : {}),
        ...(body.required !== undefined ? { required: Boolean(body.required) } : {}),
        ...(body.signatureRequired !== undefined ? { signatureRequired: Boolean(body.signatureRequired) } : {}),
        ...(body.autoSend !== undefined ? { autoSend: Boolean(body.autoSend) } : {}),
        ...(body.trigger !== undefined ? { trigger: triggerUpdate } : {}),
        ...(body.activeVersionId !== undefined ? { activeVersionId: body.activeVersionId ? String(body.activeVersionId) : null } : {}),
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
      },
    });
  }

  @Get('enrollments') async listEnrollments(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfProgramEnrollment.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }
  @Get('enrollments/:id') async getEnrollment(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const enrollment = await this.requirePrisma().cfProgramEnrollment.findFirst({ where: { id, organizationId: orgId } });
    if (!enrollment) throw new NotFoundException('Enrollment not found.');
    return enrollment;
  }
  @Get('enrollments/:id/history') async getEnrollmentHistory(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfEnrollmentStatusHistory.findMany({ where: { organizationId: orgId, enrollmentId: id }, orderBy: { createdAt: 'desc' } });
  }
  @Post('enrollments') async createEnrollment(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const enrollment = await this.requirePrisma().cfProgramEnrollment.create({ data: { organizationId: orgId, clientId: String(body.clientId ?? ''), programId: String(body.programId ?? ''), status: String(body.status ?? 'interested') as any, assignedUserId: body.assignedUserId ? String(body.assignedUserId) : null, assignedStaff: body.assignedStaff ? String(body.assignedStaff) : null, lastModifiedByUserId: body.lastModifiedByUserId ? String(body.lastModifiedByUserId) : null, lastModifiedByDisplayName: body.lastModifiedByDisplayName ? String(body.lastModifiedByDisplayName) : null, startDate: body.startDate ? new Date(String(body.startDate)) : null, nextAction: body.nextAction ? String(body.nextAction) : null, nextActionDate: body.nextActionDate ? new Date(String(body.nextActionDate)) : null, progressPercentage: Number(body.progressPercentage ?? 0), currentGoalId: body.currentGoalId ? String(body.currentGoalId) : null, lastProgressUpdate: body.lastProgressUpdate ? new Date(String(body.lastProgressUpdate)) : null, clientResponsiveness: String(body.clientResponsiveness ?? 'unknown') as any, currentBlockers: body.currentBlockers ? String(body.currentBlockers) : null, riskLevel: String(body.riskLevel ?? 'low') as any, staffProgressNotes: body.staffProgressNotes ? String(body.staffProgressNotes) : null, meetingsAttended: Number(body.meetingsAttended ?? 0), outcomeAchieved: String(body.outcomeAchieved ?? 'pending') as any, finalOutcomeSummary: body.finalOutcomeSummary ? String(body.finalOutcomeSummary) : null, completedAt: body.completedAt ? new Date(String(body.completedAt)) : null, withdrawnAt: body.withdrawnAt ? new Date(String(body.withdrawnAt)) : null, onHoldReason: body.onHoldReason ? String(body.onHoldReason) : null } });
    if (this.automation) {
      await this.automation.runTrigger({
        organizationId: orgId,
        clientId: enrollment.clientId,
        trigger: 'enrollment.created',
        programIds: [enrollment.programId],
        enrollmentIdsByProgramId: { [enrollment.programId]: enrollment.id },
        actorUserId: admin.id,
        actorDisplayName: [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email,
        idempotencySeed: `compat.enrollment.created:${enrollment.id}`,
      });
    }
    return enrollment;
  }
  @Patch('enrollments/:id') async updateEnrollment(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const current = await prisma.cfProgramEnrollment.findFirst({ where: { id, organizationId: orgId } });
    if (!current) throw new NotFoundException('Enrollment not found.');
    const updated = await prisma.cfProgramEnrollment.update({ where: { id, organizationId: orgId }, data: body });
    if (this.automation
      && String(current.status).toLowerCase() !== 'approved'
      && String(updated.status).toLowerCase() === 'approved') {
      try {
        await this.automation.runTrigger({
          organizationId: orgId,
          clientId: updated.clientId,
          trigger: 'enrollment.approved',
          programIds: [updated.programId],
          enrollmentIdsByProgramId: { [updated.programId]: updated.id },
          actorUserId: admin.id,
          actorDisplayName: [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email,
          idempotencySeed: `compat.enrollment.approved:${updated.id}`,
          payload: { enrollmentStatus: updated.status },
        });
      } catch (error) {
        this.logger.warn(`Enrollment approval automation failed for ${updated.id}: ${(error as Error).message}`);
      }
    }
    return updated;
  }

  @Get('form-templates') async listFormTemplates(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFormTemplate.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }
  @Post('form-templates') async createFormTemplate(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFormTemplate.create({ data: { organizationId: orgId, name: String(body.name ?? 'Untitled Form'), description: String(body.description ?? ''), fields: Array.isArray(body.fields) ? body.fields : [], emailTemplate: String(body.emailTemplate ?? 'general-intake'), dueInDays: Number(body.dueInDays ?? 7), scope: String(body.scope ?? 'legacy'), version: Number(body.version ?? 1), sortOrder: Number(body.sortOrder ?? 0), programId: body.programId ? String(body.programId) : null, internalNotes: body.internalNotes ? String(body.internalNotes) : null } });
  }
  @Patch('form-templates/:id') async updateFormTemplate(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFormTemplate.update({ where: { id, organizationId: orgId }, data: body });
  }
  @Delete('form-templates/:id') async deleteFormTemplate(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    await this.requirePrisma().cfFormTemplate.update({ where: { id, organizationId: orgId }, data: { isActive: false } });
    return { id, unlinkedProgramIds: [], cancelledAssignments: 0 };
  }
  @Get('form-assignments') async listFormAssignments(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFormAssignment.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }
  @Post('form-assignments') async createFormAssignment(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const appUrl = process.env.APP_URL ?? 'https://clientflow-2g9.pages.dev';
    return this.requirePrisma().cfFormAssignment.create({ data: { organizationId: orgId, clientId: String(body.clientId ?? ''), formId: String(body.formId ?? ''), assignedUserId: body.assignedUserId ? String(body.assignedUserId) : null, completionMethod: body.completionMethod ? String(body.completionMethod) : null, deliveryMethod: body.deliveryMethod ? String(body.deliveryMethod) : null, recipientEmail: body.recipientEmail ? String(body.recipientEmail) : null, recipientPhone: body.recipientPhone ? String(body.recipientPhone) : null, status: String(body.status ?? 'draft'), dueAt: body.dueDate ? new Date(String(body.dueDate)) : null, dueDate: body.dueDate ? String(body.dueDate) : null, expiresAt: body.dueDate ? new Date(String(body.dueDate)) : null, sentAt: body.sentAt ? new Date(String(body.sentAt)) : null, secureLink: `${appUrl}/s/${rawToken}`, secureLinkToken: tokenHash, createdByUserId: body.assignedUserId ? String(body.assignedUserId) : null } });
  }
  @Post('form-assignments/:id/send') async sendFormAssignment(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const assignment = await this.requirePrisma().cfFormAssignment.findFirst({ where: { id, organizationId: orgId } });
    if (!assignment) throw new NotFoundException('Form assignment not found.');
    if (!assignment.recipientEmail) throw new BadRequestException('A recipient email is required before sending.');
    if (!this.n8n) throw new ServiceUnavailableException('Email delivery is unavailable.');
    let formUrl = assignment.secureLink;
    if (!formUrl) {
      const rawToken = randomBytes(32).toString('base64url');
      const appUrl = process.env.APP_URL ?? 'https://clientflow-2g9.pages.dev';
      formUrl = `${appUrl}/s/${rawToken}`;
      await this.requirePrisma().cfFormAssignment.update({ where: { id: assignment.id }, data: { secureLink: formUrl, secureLinkToken: createHash('sha256').update(rawToken).digest('hex') } });
    }
    const client = await this.requirePrisma().cfClient.findFirst({ where: { id: assignment.clientId, organizationId: orgId }, select: { primaryContactName: true } });
    const form = await this.requirePrisma().cfFormTemplate.findFirst({ where: { id: assignment.formId, organizationId: orgId }, select: { name: true } });
    if (!client || !form) throw new NotFoundException('Form assignment details not found.');
    const receipt = await this.n8n.deliver({ eventId: `form.send:${assignment.id}`, eventType: 'form.send', organizationId: orgId, clientId: assignment.clientId, formId: assignment.formId, recipientEmail: assignment.recipientEmail, clientName: client.primaryContactName, formName: form.name, formUrl, expiresAt: assignment.expiresAt?.toISOString() ?? null, sentByUserId: admin.id, dueDate: assignment.dueDate ?? assignment.expiresAt?.toISOString() ?? new Date().toISOString(), ...(typeof body.personalMessage === 'string' && body.personalMessage.trim() ? { personalMessage: body.personalMessage.trim() } : {}), occurredAt: new Date().toISOString() });
    const sentAt = new Date(receipt.sentAt);
    const updatedAssignment = await this.requirePrisma().cfFormAssignment.update({ where: { id: assignment.id }, data: { status: 'sent', sentAt } });
    return { success: true, status: receipt.status, message: 'Email accepted for delivery', provider: 'N8N_GMAIL', formId: assignment.formId, recipientEmail: assignment.recipientEmail, sentAt: receipt.sentAt, assignment: updatedAssignment };
  }
  @Patch('form-assignments/:id') async updateFormAssignment(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFormAssignment.update({ where: { id, organizationId: orgId }, data: body });
  }
  @Get('intake-submissions') async listIntakeSubmissions(@Req() request: Request, @Query('clientId') clientId?: string, @Query('programId') programId?: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const submissionIds = programId
      ? (await prisma.cfIntakeSubmissionProgram.findMany({ where: { organizationId: orgId, programId }, select: { intakeSubmissionId: true } })).map((link) => link.intakeSubmissionId)
      : undefined;
    if (programId && submissionIds!.length === 0) return [];
    const submissions = await prisma.cfIntakeSubmission.findMany({
      where: { organizationId: orgId, ...(clientId ? { clientId } : {}), ...(programId ? { id: { in: submissionIds } } : {}) },
      orderBy: { submittedAt: 'desc' },
    });
    const ids = submissions.map((submission) => submission.id);
    const clientIds = [...new Set(submissions.map((submission) => submission.clientId))];
    const [clients, links, snapshots] = await Promise.all([
      prisma.cfClient.findMany({ where: { organizationId: orgId, id: { in: clientIds } }, select: { id: true, businessName: true, primaryContactName: true, email: true } }),
      prisma.cfIntakeSubmissionProgram.findMany({ where: { organizationId: orgId, intakeSubmissionId: { in: ids } } }),
      prisma.cfIntakeSubmissionSnapshot.findMany({ where: { organizationId: orgId, intakeSubmissionId: { in: ids } } }),
    ]);
    const clientById = new Map(clients.map((client) => [client.id, client]));
    return submissions.map((submission) => ({
      ...submission,
      client: clientById.get(submission.clientId) ?? null,
      programs: links.filter((link) => link.intakeSubmissionId === submission.id),
      snapshot: snapshots.find((snapshot) => snapshot.intakeSubmissionId === submission.id) ?? null,
    }));
  }
  @Get('intake-submissions/:id') async getIntakeSubmission(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const submission = await prisma.cfIntakeSubmission.findFirst({ where: { id, organizationId: orgId } });
    if (!submission) throw new NotFoundException('Intake submission not found.');
    const [client, assignment, snapshot, programs] = await Promise.all([
      prisma.cfClient.findFirst({ where: { id: submission.clientId, organizationId: orgId } }),
      prisma.cfFormAssignment.findFirst({ where: { id: submission.formAssignmentId, organizationId: orgId } }),
      prisma.cfIntakeSubmissionSnapshot.findFirst({ where: { intakeSubmissionId: id, organizationId: orgId } }),
      prisma.cfIntakeSubmissionProgram.findMany({ where: { intakeSubmissionId: id, organizationId: orgId } }),
    ]);
    return { ...submission, client: client ?? null, assignment: assignment ?? null, snapshot: snapshot ?? null, programs };
  }

  @Get('notifications') async listNotifications(@Req() request: Request) {
    const { admin } = await this.requireOrgFromRequest(request);
    return { items: await this.requirePrisma().cfNotification.findMany({ where: { organizationId: admin.organizationId, recipientAdminId: admin.id }, orderBy: { createdAt: 'desc' }, take: 30 }), unreadCount: 0 };
  }
  @Patch('notifications/read-all') async markAllNotificationsRead(@Req() request: Request) {
    const { admin } = await this.requireOrgFromRequest(request);
    await this.requirePrisma().cfNotification.updateMany({ where: { organizationId: admin.organizationId, recipientAdminId: admin.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: 0 };
  }
  @Patch('notifications/:id/read') async markNotificationRead(@Req() request: Request, @Param('id') id: string) {
    const { admin } = await this.requireOrgFromRequest(request);
    await this.requirePrisma().cfNotification.updateMany({ where: { id, organizationId: admin.organizationId, recipientAdminId: admin.id }, data: { readAt: new Date() } });
    return { id, read: true };
  }

  @Get('terms') async listAllTerms(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfTerms.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }
  @Get('monitoring') async listAllMonitoring(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfEnrollmentMonitoring.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }
  @Get('contracts') async listAllContracts(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfContract.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }
  @Get('documents') async listAllDocuments(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfDocument.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }
  @Get('communications') async listAllCommunications(
    @Req() request: Request,
    @Query('limit') limitQuery?: string,
    @Query('offset') offsetQuery?: string,
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const parsedLimit = Number.parseInt(limitQuery ?? '100', 10);
    const parsedOffset = Number.parseInt(offsetQuery ?? '0', 10);
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;
    const skip = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
    return this.requirePrisma().cfCommunication.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      skip,
    });
  }
  @Get('final-reports') async listAllFinalReports(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFinalReport.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }
  @Get('clients/:clientId/terms') async listTerms(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfTerms.findMany({ where: { organizationId: orgId, clientId }, orderBy: { createdAt: 'desc' } });
  }
  @Post('clients/:clientId/terms') async createTerms(@Req() request: Request, @Param('clientId') clientId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfTerms.create({ data: { organizationId: orgId, clientId, programId: String(body.programId ?? ''), supportType: String(body.supportType ?? 'Service'), resourceDescription: String(body.resourceDescription ?? ''), grantAmount: Number(body.grantAmount ?? 0), loanAmount: Number(body.loanAmount ?? 0), investmentAmount: Number(body.investmentAmount ?? 0), forgivableAmount: Number(body.forgivableAmount ?? 0), repaymentRequired: Boolean(body.repaymentRequired ?? false), repaymentSchedule: String(body.repaymentSchedule ?? ''), interestDescription: String(body.interestDescription ?? ''), milestones: String(body.milestones ?? ''), reportingRequirements: String(body.reportingRequirements ?? ''), startDate: String(body.startDate ?? ''), endDate: String(body.endDate ?? ''), monitoringFrequency: String(body.monitoringFrequency ?? 'Monthly'), specialConditions: String(body.specialConditions ?? ''), fundingAmount: Number(body.fundingAmount ?? 0) } });
  }
  @Patch('terms/:id') async updateTerms(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfTerms.update({ where: { id, organizationId: orgId }, data: body });
  }
  @Post('enrollments/:enrollmentId/monitoring') async createMonitoring(@Req() request: Request, @Param('enrollmentId') enrollmentId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfEnrollmentMonitoring.create({ data: { organizationId: orgId, enrollmentId, name: String(body.name ?? 'Monitoring Review'), description: body.description ? String(body.description) : null, frequency: String(body.frequency ?? 'monthly') as any, customIntervalDays: body.customIntervalDays ? Number(body.customIntervalDays) : null, expectedValue: body.expectedValue ? Number(body.expectedValue) : null, actualValue: body.actualValue ? Number(body.actualValue) : null, unit: body.unit ? String(body.unit) : null, complianceStatus: String(body.status ?? 'pending') as any, lastReviewedAt: body.lastReviewedAt ? new Date(String(body.lastReviewedAt)) : null, nextReviewAt: body.nextReviewAt ? new Date(String(body.nextReviewAt)) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), assignedReviewerId: body.assignedStaffId ? String(body.assignedStaffId) : null, followUpRequired: Boolean(body.followUpRequired ?? false), evidenceRequired: Boolean(body.evidenceRequired ?? false), notes: String(body.notes ?? ''), active: true } as any });
  }
  @Post('enrollment-monitoring/:id/results') async recordMonitoringResult(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfEnrollmentMonitoring.update({ where: { id, organizationId: orgId }, data: { complianceStatus: String(body.status ?? 'compliant') as any, notes: body.notes ? String(body.notes) : null, lastReviewedAt: new Date(), followUpRequired: Boolean(body.followUpRequired ?? false) } as any });
  }
  @Get('enrollment-monitoring/:id/history') async getMonitoringHistory(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfEnrollmentMonitoringHistory.findMany({ where: { organizationId: orgId, enrollmentMonitoringId: id }, orderBy: { createdAt: 'desc' } });
  }
  @Get('clients/:clientId/contracts') async listContracts(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfContract.findMany({ where: { organizationId: orgId, clientId }, orderBy: { createdAt: 'desc' } });
  }
  @Post('clients/:clientId/contracts') async createContract(@Req() request: Request, @Param('clientId') clientId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfContract.create({ data: { organizationId: orgId, clientId, programId: String(body.programId ?? ''), contractTemplateId: String(body.contractTemplateId ?? ''), contractType: String(body.contractType ?? 'Service Agreement'), status: String(body.status ?? 'DRAFT'), generatedContent: String(body.generatedContent ?? ''), termsId: body.termsId ? String(body.termsId) : null } });
  }
  @Patch('contracts/:id') async updateContract(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfContract.update({ where: { id, organizationId: orgId }, data: body });
  }
  @Get('clients/:clientId/documents') async listDocuments(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfDocument.findMany({ where: { organizationId: orgId, clientId }, orderBy: { createdAt: 'desc' } });
  }
  @Post('clients/:clientId/documents/upload-intent') async createUploadIntent(@Req() request: Request, @Param('clientId') clientId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return { document: { id: randomUUID(), organizationId: orgId, clientId, name: String(body.name ?? 'upload'), type: String(body.type ?? 'application/octet-stream'), url: '', objectKey: null, bucket: null, byteSize: Number(body.byteSize ?? 0), uploadStatus: 'ready', uploadedAt: new Date().toISOString(), uploadedBy: 'compatibility', isDemo: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, uploadUrl: '', expiresInSeconds: 0 };
  }
  @Post('documents/:id/complete-upload') async completeUpload(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const document = await this.requirePrisma().cfDocument.findFirst({ where: { id, organizationId: orgId } });
    if (!document) throw new NotFoundException('Document not found.');
    return document;
  }
  @Get('documents/:id/download') async downloadDocument(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const document = await this.requirePrisma().cfDocument.findFirst({ where: { id, organizationId: orgId } });
    if (!document) throw new NotFoundException('Document not found.');
    return { url: document.url, expiresInSeconds: 300 };
  }
  @Get('clients/:clientId/communications') async listCommunications(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfCommunication.findMany({ where: { organizationId: orgId, clientId }, orderBy: { createdAt: 'desc' } });
  }
  @Post('clients/:clientId/communications') async createCommunication(@Req() request: Request, @Param('clientId') clientId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfCommunication.create({ data: { organizationId: orgId, clientId, type: String(body.type ?? 'general'), direction: String(body.direction ?? 'outbound'), subject: String(body.subject ?? 'Communication'), notes: String(body.notes ?? ''), date: new Date(String(body.date ?? Date.now())), staffMember: String(body.staffMember ?? 'system'), channel: body.channel ? String(body.channel) : 'email', provider: body.provider ? String(body.provider) : 'system', status: body.status ? String(body.status) : 'sent', recipientEmail: body.recipientEmail ? String(body.recipientEmail) : null } });
  }
  @Get('clients/:clientId/final-reports') async listFinalReports(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFinalReport.findMany({ where: { organizationId: orgId, clientId }, orderBy: { createdAt: 'desc' } });
  }
  @Post('clients/:clientId/final-reports') async createFinalReport(@Req() request: Request, @Param('clientId') clientId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFinalReport.create({ data: { organizationId: orgId, clientId, programId: String(body.programId ?? ''), startDate: String(body.startDate ?? ''), endDate: String(body.endDate ?? ''), originalNeed: String(body.originalNeed ?? ''), supportProvided: String(body.supportProvided ?? ''), fundingProvided: String(body.fundingProvided ?? ''), milestonesCompleted: String(body.milestonesCompleted ?? ''), resultsAchieved: String(body.resultsAchieved ?? ''), issuesEncountered: String(body.issuesEncountered ?? ''), staffComments: String(body.staffComments ?? ''), clientOutcome: String(body.clientOutcome ?? ''), recommendedNextSteps: String(body.recommendedNextSteps ?? ''), archiveDecision: String(body.archiveDecision ?? '') } });
  }
  @Get('activity') async listActivity(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfActivityLog.findMany({ where: { organizationId: orgId }, orderBy: { timestamp: 'desc' }, take: 200 });
  }
  @Get('clients/:clientId/activity') async listClientActivity(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfActivityLog.findMany({ where: { organizationId: orgId, clientId }, orderBy: { timestamp: 'desc' } });
  }
  @Post('activity') async createActivity(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfActivityLog.create({ data: { organizationId: orgId, clientId: String(body.clientId ?? ''), action: String(body.action ?? 'NOTE'), description: String(body.description ?? ''), user: String(body.user ?? 'system') } });
  }
  @Get('demo-status') async getDemoStatus(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.getDemoStatusFor(orgId);
  }
  @Get('system/n8n-status') async getN8nStatus(@Req() request: Request) {
    await this.requireOrgFromRequest(request);
    return this.n8n?.getDiagnostics() ?? { availability: 'not_configured', enabled: false };
  }
  @Post('seed-demo') async seedDemo(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return { seeded: {}, liveMode: false };
  }
  @Post('remove-demo') async removeDemo(@Req() request: Request, @Body() _body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    await this.requirePrisma().organization.update({ where: { id: orgId }, data: { liveMode: true } });
    return { liveMode: true, demoRemovedAt: new Date().toISOString(), principalAdminId: null, removed: {} };
  }
}

const PUBLIC_FIELD_ALIASES: Record<string, 'primaryContactName' | 'businessName' | 'email' | 'phone' | 'website'> = {
  name: 'primaryContactName',
  contact: 'primaryContactName',
  fullName: 'primaryContactName',
  primaryContactName: 'primaryContactName',
  business: 'businessName',
  businessName: 'businessName',
  bizName: 'businessName',
  email: 'email',
  phone: 'phone',
  website: 'website',
};

interface NormalizedPublicField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  helpText?: string;
}

const FALLBACK_PUBLIC_FIELDS: NormalizedPublicField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true },
  { id: 'business', label: 'Business / Organization Name', type: 'text', required: true },
  { id: 'email', label: 'Email', type: 'email', required: true },
  { id: 'phone', label: 'Phone', type: 'phone', required: true },
  { id: 'description', label: 'Brief business description', type: 'textarea', required: false },
  { id: 'assistance', label: 'Type of assistance needed', type: 'textarea', required: false },
];

function humanizeFieldId(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
}

// Legacy templates store loosely-shaped field JSON; normalize to what the public form UI requires.
function normalizePublicFields(rawFields: unknown): NormalizedPublicField[] {
  if (!Array.isArray(rawFields)) return FALLBACK_PUBLIC_FIELDS;
  const normalized: NormalizedPublicField[] = [];
  rawFields.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const id = String(entry.id ?? entry.name ?? entry.key ?? `field_${index}`);
    const label = String(entry.label ?? entry.name ?? humanizeFieldId(id) ?? id);
    const type = typeof entry.type === 'string' ? entry.type : 'text';
    const required = entry.required === true;
    const options = Array.isArray(entry.options) ? entry.options.map(String) : undefined;
    const helpText = typeof entry.helpText === 'string' ? entry.helpText : (typeof entry.description === 'string' ? entry.description : undefined);
    normalized.push({ id, label, type, required, ...(options?.length ? { options } : {}), ...(helpText ? { helpText } : {}) });
  });
  return normalized.length ? normalized : FALLBACK_PUBLIC_FIELDS;
}

function resolvePublicPrefill(
  fields: NormalizedPublicField[],
  client: { primaryContactName: string; businessName: string; email: string; phone: string; website: string | null } | null,
): Record<string, string> {
  if (!client) return {};
  const prefill: Record<string, string> = {};
  for (const field of fields) {
    const mappedKey = PUBLIC_FIELD_ALIASES[field.id];
    if (!mappedKey) continue;
    const value = client[mappedKey];
    if (value) prefill[field.id] = value;
  }
  return prefill;
}

@Controller('public/form')
export class PublicFormCompatibilityController {
  private readonly logger = new Logger(PublicFormCompatibilityController.name);

  constructor(
    private readonly scaffold: ScaffoldService,
    private readonly prisma?: PrismaService,
    private readonly automation?: ProgramAutomationService,
  ) {}

  private requirePrisma(): PrismaService {
    if (!this.prisma) throw this.scaffold.notImplemented('Public forms');
    return this.prisma;
  }

  @Get(':token') async getForm(@Param('token') token: string) {
    const formAssignment = await this.requirePrisma().cfFormAssignment.findUnique({
      where: { secureLinkToken: createHash('sha256').update(token).digest('hex') },
    });
    if (!formAssignment) throw new NotFoundException('This form link is invalid or unavailable.');
    const client = await this.requirePrisma().cfClient.findUnique({ where: { id: formAssignment.clientId } });
    const template = await this.requirePrisma().cfFormTemplate.findFirst({ where: { id: formAssignment.formId, organizationId: formAssignment.organizationId, isActive: true } });
    if (!template) throw new NotFoundException('This form link is invalid or unavailable.');

    if (formAssignment.status === 'sent' || formAssignment.status === 'delivered') {
      await this.requirePrisma().cfFormAssignment.update({ where: { id: formAssignment.id }, data: { status: 'opened', openedAt: new Date() } });
    }

    const fields = normalizePublicFields(template.fields);
    const coreSection = {
      id: `core:${template.id}:${template.version}`,
      kind: 'core' as const,
      templateId: template.id,
      templateVersion: template.version,
      programId: null,
      title: template.name,
      description: template.description,
      fields,
    };

    const programs = await this.requirePrisma().cfProgram.findMany({
      where: { organizationId: formAssignment.organizationId, isActive: true },
      select: { id: true, name: true, defaultFormTemplateId: true },
      orderBy: { name: 'asc' },
    });
    const sectionTemplates = await this.requirePrisma().cfFormTemplate.findMany({
      where: {
        organizationId: formAssignment.organizationId,
        isActive: true,
        OR: [{ scope: 'program_section' }, { scope: 'legacy', programId: { not: null } }],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    const programSections = programs.map((activeProgram) => {
      const matchingSections = sectionTemplates.filter((candidate) => candidate.programId === activeProgram.id);
      const section = matchingSections.find((candidate) => candidate.id === activeProgram.defaultFormTemplateId)
        ?? matchingSections.find((candidate) => candidate.scope === 'program_section')
        ?? matchingSections[0];
      return {
        id: section ? `program:${activeProgram.id}:${section.id}:${section.version}` : `program:${activeProgram.id}:empty`,
        kind: 'program' as const,
        templateId: section?.id ?? '',
        templateVersion: section?.version ?? 0,
        programId: activeProgram.id,
        title: section?.name ?? activeProgram.name,
        description: section?.description ?? '',
        fields: section ? normalizePublicFields(section.fields) : [],
      };
    });
    const renderedSections = [coreSection, ...programSections];

    const configurationToken = randomBytes(32).toString('hex');
    await this.requirePrisma().cfIntakeRenderSession.create({
      data: {
        organizationId: formAssignment.organizationId,
        formAssignmentId: formAssignment.id,
        configurationToken,
        coreTemplateId: template.id,
        coreTemplateVersion: template.version,
        renderedSections: renderedSections as unknown as object,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return {
      assignment: { id: formAssignment.id, status: formAssignment.status, dueDate: formAssignment.dueDate },
      form: { id: template.id, name: template.name, description: template.description, fields },
      program: { name: 'EA Management Program' },
      contact: { name: client?.primaryContactName ?? formAssignment.recipientEmail ?? 'Client' },
      prefill: resolvePublicPrefill(fields, client),
      intakeConfiguration: {
        configurationToken,
        programs: programs.map(({ id, name }) => ({ id, name })),
        sections: renderedSections,
      },
    };
  }

  @Post(':token/submit') async submitForm(@Param('token') token: string, @Body() body: Record<string, unknown>) {
    const prisma = this.requirePrisma();
    const formAssignment = await prisma.cfFormAssignment.findUnique({
      where: { secureLinkToken: createHash('sha256').update(token).digest('hex') },
    });
    if (!formAssignment) throw new NotFoundException('This form link is invalid or unavailable.');
    const configurationToken = typeof body.configurationToken === 'string' ? body.configurationToken : undefined;
    let renderSession: Awaited<ReturnType<typeof prisma.cfIntakeRenderSession.findUnique>> = null;
    if (configurationToken) {
      renderSession = await prisma.cfIntakeRenderSession.findUnique({ where: { configurationToken } });
      if (!renderSession || renderSession.formAssignmentId !== formAssignment.id || renderSession.expiresAt <= new Date()) {
        throw new ConflictException('This form has changed. Reload the form to use the latest version.');
      }
    }

    const coreResponses = isRecord(body.coreResponses) ? body.coreResponses : {};
    const programResponses = isRecord(body.programResponses) ? body.programResponses as Record<string, Record<string, unknown>> : {};
    const selectedProgramIds = Array.isArray(body.selectedProgramIds)
      ? body.selectedProgramIds.filter((id): id is string => typeof id === 'string')
      : [];

    const client = await prisma.cfClient.findFirst({ where: { id: formAssignment.clientId, organizationId: formAssignment.organizationId } });

    // Ensure (or reuse) an enrollment per selected program so the client shows up on the program's member list.
    const enrollmentIds: string[] = [];
    const enrollmentIdsByProgramId: Record<string, string> = {};
    for (const programId of selectedProgramIds) {
      const existingEnrollment = await prisma.cfProgramEnrollment.findFirst({ where: { organizationId: formAssignment.organizationId, clientId: formAssignment.clientId, programId } });
      const enrollment = existingEnrollment ?? await prisma.cfProgramEnrollment.create({
        data: {
          organizationId: formAssignment.organizationId,
          clientId: formAssignment.clientId,
          programId,
          status: 'interested',
          assignedUserId: client?.assignedUserId ?? null,
          assignedStaff: client?.assignedStaff ?? null,
          lastModifiedByDisplayName: 'Client submission',
          isDemo: client?.isDemo ?? false,
        },
      });
      if (!existingEnrollment) {
        await prisma.cfEnrollmentStatusHistory.create({
          data: {
            organizationId: formAssignment.organizationId,
            enrollmentId: enrollment.id,
            newStatus: 'interested',
            reason: 'Created from master intake submission.',
            changedByDisplayName: 'Client submission',
          },
        });
      }
      enrollmentIds.push(enrollment.id);
      enrollmentIdsByProgramId[programId] = enrollment.id;
    }

    const submission = await prisma.cfIntakeSubmission.create({
      data: {
        organizationId: formAssignment.organizationId,
        clientId: formAssignment.clientId,
        formAssignmentId: formAssignment.id,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : randomBytes(16).toString('hex'),
        requestHash: createHash('sha256').update(JSON.stringify({ coreResponses, programResponses, selectedProgramIds })).digest('hex'),
        configurationToken: configurationToken ?? '',
        responsePayload: coreResponses as unknown as object,
        resultPayload: { success: true, enrollmentIds } as unknown as object,
        source: formAssignment.deliveryMethod ?? 'secure_link',
        submitterEmail: formAssignment.recipientEmail,
        isDemo: client?.isDemo ?? false,
      },
    });
    if (selectedProgramIds.length > 0) {
      await prisma.cfIntakeSubmissionSnapshot.create({
        data: {
          organizationId: formAssignment.organizationId,
          intakeSubmissionId: submission.id,
          coreTemplateId: formAssignment.formId,
          coreTemplateVersion: 1,
          selectedProgramIds,
          renderedSections: (renderSession?.renderedSections ?? []) as unknown as object,
        },
      });
      await prisma.cfIntakeSubmissionProgram.createMany({
        data: selectedProgramIds.map((programId, index) => ({
          organizationId: formAssignment.organizationId,
          intakeSubmissionId: submission.id,
          programId,
          enrollmentId: enrollmentIds[index],
          responsePayload: (programResponses[programId] ?? {}) as unknown as object,
        })),
      });
    }

    await prisma.cfFormAssignment.update({
      where: { id: formAssignment.id },
      data: { status: 'submitted', submittedAt: new Date(), responses: { core: coreResponses, programs: programResponses, selectedProgramIds } as unknown as object },
    });
    await prisma.cfActivityLog.create({
      data: {
        organizationId: formAssignment.organizationId,
        clientId: formAssignment.clientId,
        action: 'INTAKE_SUBMITTED',
        description: selectedProgramIds.length > 0
          ? `Intake submitted for ${selectedProgramIds.length} program(s).`
          : 'Intake submitted without a program selection.',
        user: 'client',
      },
    });

    const primaryProgramId = selectedProgramIds[0];
    if (client && primaryProgramId) {
      await prisma.cfClient.update({ where: { id: client.id }, data: { programId: primaryProgramId } });
    }

    let automation = null;
    if (client && selectedProgramIds.length > 0 && this.automation) {
      try {
        automation = await this.automation.runTrigger({
          organizationId: formAssignment.organizationId,
          clientId: client.id,
          trigger: 'intake.submitted',
          programIds: selectedProgramIds,
          enrollmentIdsByProgramId,
          actorDisplayName: 'Client submission',
          idempotencySeed: `compat.intake.submitted:${submission.id}`,
          payload: { selectedProgramIds },
        });
      } catch (error) {
        this.logger.warn(`Intake automation failed for submission ${submission.id}: ${(error as Error).message}`);
        automation = null;
      }
    }

    return { success: true, enrollmentIds, automation };
  }
}

@Controller('auth')
export class AuthCompatibilityController {
  constructor(private readonly scaffold: ScaffoldService, private readonly prisma?: PrismaService) {}

  private requirePrisma(): PrismaService {
    if (!this.prisma) throw this.scaffold.notImplemented('Authentication');
    return this.prisma;
  }

  private async requireAuthenticatedAdmin(request: Request) {
    const accessToken = (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined) ?? getCookieValue(request, ACCESS_COOKIE_NAME);
    if (!accessToken) throw new UnauthorizedException('Missing authenticated session.');
    const payload = getSessionTokenPayload(accessToken, 'access');
    const admin = await this.requirePrisma().adminUser.findUnique({
      where: { id: payload.sub ?? '' },
      select: { id: true, email: true, firstName: true, lastName: true, jobTitle: true, role: true, organizationId: true, isActive: true, passwordHash: true },
    });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Authenticated session is no longer active.');
    return { admin, payload };
  }

  private buildSessionData(admin: { id: string; email: string; firstName: string | null; lastName: string | null; jobTitle: string | null; role: string; organizationId: string; }) {
    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName ?? undefined,
      lastName: admin.lastName ?? undefined,
      jobTitle: admin.jobTitle ?? undefined,
      role: admin.role,
      organizationId: admin.organizationId,
    };
  }

  @Post('login') async login(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!email || !password) throw new BadRequestException('Email and password are required.');
    const admin = await this.requirePrisma().adminUser.findUnique({ where: { email }, select: { id: true, email: true, firstName: true, lastName: true, jobTitle: true, role: true, organizationId: true, passwordHash: true, isActive: true } });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Invalid email or password.');
    const valid = await compare(password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password.');
    const sessionId = randomUUID();
    const jti = randomUUID();
    const accessToken = signSessionToken(admin.id, admin.email, [admin.role], admin.organizationId, sessionId, jti, 'access');
    const refreshToken = `${sessionId}.${randomBytes(32).toString('base64url')}`;
    const refreshHash = hashRefreshToken(refreshToken);
    await this.requirePrisma().authSession.create({ data: { id: sessionId, adminUserId: admin.id, jti, expiresAt: new Date(Date.now() + ACCESS_TTL_MS), refreshTokenHash: refreshHash, refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS) } });
    setSessionCookies(response, accessToken, refreshToken);
    return { admin: this.buildSessionData(admin) };
  }

  @Post('refresh') async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = getCookieValue(request, REFRESH_COOKIE_NAME) ?? (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined);
    if (!refreshToken) throw new UnauthorizedException('Missing refresh session.');
    const [sessionId] = refreshToken.split('.', 2);
    if (!sessionId) throw new UnauthorizedException('Missing refresh session.');
    const session = await this.requirePrisma().authSession.findFirst({
      where: { id: sessionId, refreshTokenHash: hashRefreshToken(refreshToken), refreshExpiresAt: { gt: new Date() }, revokedAt: null, adminUser: { isActive: true } },
      include: { adminUser: { select: { id: true, email: true, firstName: true, lastName: true, jobTitle: true, role: true, organizationId: true, isActive: true } } },
    });
    if (!session) throw new UnauthorizedException('Refresh session is expired or revoked.');
    const nextSessionId = randomUUID();
    const nextJti = randomUUID();
    const nextRefreshToken = `${nextSessionId}.${randomBytes(32).toString('base64url')}`;
    await this.requirePrisma().authSession.update({ where: { id: sessionId }, data: { id: nextSessionId, jti: nextJti, refreshTokenHash: hashRefreshToken(nextRefreshToken), refreshRotatedAt: new Date(), refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS), expiresAt: new Date(Date.now() + ACCESS_TTL_MS) } });
    setSessionCookies(response, signSessionToken(session.adminUser.id, session.adminUser.email, [session.adminUser.role], session.adminUser.organizationId, nextSessionId, nextJti, 'access'), nextRefreshToken);
    return { valid: true };
  }

  @Post('logout') async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = getCookieValue(request, REFRESH_COOKIE_NAME);
    if (refreshToken) {
      const [sessionId] = refreshToken.split('.', 2);
      if (sessionId) {
        await this.requirePrisma().authSession.updateMany({ where: { id: sessionId, refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
      }
    }
    clearSessionCookies(response);
    return { message: 'Logged out.' };
  }

  @Get('me') async getMe(@Req() request: Request) {
    const { admin } = await this.requireAuthenticatedAdmin(request);
    return this.buildSessionData(admin);
  }

  @Patch('me') async updateMe(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { admin } = await this.requireAuthenticatedAdmin(request);
    const update = await this.requirePrisma().adminUser.update({
      where: { id: admin.id },
      data: {
        firstName: body.firstName === undefined ? undefined : String(body.firstName ?? null),
        lastName: body.lastName === undefined ? undefined : String(body.lastName ?? null),
        jobTitle: body.jobTitle === undefined ? undefined : String(body.jobTitle ?? null),
      },
      select: { id: true, email: true, firstName: true, lastName: true, jobTitle: true, role: true, organizationId: true, isActive: true },
    });
    return this.buildSessionData(update);
  }

  @Post('change-password') async changePassword(@Req() request: Request, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const { admin } = await this.requireAuthenticatedAdmin(request);
    const currentPassword = String(body.currentPassword ?? '');
    const newPassword = String(body.newPassword ?? '');
    if (!currentPassword || !newPassword) throw new BadRequestException('Current and new passwords are required.');
    const valid = await compare(currentPassword, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect.');
    if (currentPassword === newPassword) throw new BadRequestException('New password must be different from the current password.');
    const passwordHash = await hash(newPassword, 12);
    await this.requirePrisma().adminUser.update({ where: { id: admin.id }, data: { passwordHash } });
    await this.requirePrisma().authSession.updateMany({ where: { adminUserId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
    clearSessionCookies(response);
    return { message: 'Password changed. Sign in again with your new password.' };
  }

  @Get('session') async getSession(@Req() request: Request) {
    await this.requireAuthenticatedAdmin(request);
    return { valid: true };
  }

  @Get('validate-invite') async validateInvite(@Query('token') token: string) {
    const rawToken = String(token ?? '');
    if (!rawToken) return { valid: false, reason: 'Missing token.' };
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invitation = await this.requirePrisma().adminInvitation.findUnique({
      where: { tokenHash },
      include: { adminUser: { select: { email: true, firstName: true } } },
    });
    if (!invitation) return { valid: false, reason: 'Invitation not found.' };
    if (invitation.acceptedAt) return { valid: false, reason: 'Invitation already accepted.' };
    if (invitation.revokedAt) return { valid: false, reason: 'Invitation has been revoked.' };
    if (invitation.expiresAt < new Date()) return { valid: false, reason: 'Invitation has expired.' };
    return { valid: true, email: invitation.adminUser.email, firstName: invitation.adminUser.firstName ?? undefined };
  }

  @Post('accept-invite') async acceptInvite(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const token = String(body.token ?? '');
    const newPassword = String(body.newPassword ?? '');
    if (!token || !newPassword) throw new BadRequestException('Token and new password are required.');
    if (newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters.');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = await this.requirePrisma().adminInvitation.findUnique({ where: { tokenHash }, include: { adminUser: true } });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.acceptedAt) throw new BadRequestException('Invitation already accepted.');
    if (invitation.revokedAt) throw new BadRequestException('Invitation has been revoked.');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('Invitation has expired.');
    const passwordHash = await hash(newPassword, 12);
    await this.requirePrisma().$transaction([
      this.requirePrisma().adminUser.update({ where: { id: invitation.adminUserId }, data: { passwordHash, isActive: true } }),
      this.requirePrisma().adminInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
    ]);
    const sessionId = randomUUID();
    const jti = randomUUID();
    const accessToken = signSessionToken(invitation.adminUser.id, invitation.adminUser.email, [invitation.adminUser.role], invitation.adminUser.organizationId, sessionId, jti, 'access');
    const refreshToken = `${sessionId}.${randomBytes(32).toString('base64url')}`;
    await this.requirePrisma().authSession.create({ data: { id: sessionId, adminUserId: invitation.adminUser.id, jti, expiresAt: new Date(Date.now() + ACCESS_TTL_MS), refreshTokenHash: hashRefreshToken(refreshToken), refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS) } });
    setSessionCookies(response, accessToken, refreshToken);
    return { admin: this.buildSessionData(invitation.adminUser) };
  }

  @Get('bootstrap') async bootstrap(@Req() request: Request) {
    const { admin } = await this.requireAuthenticatedAdmin(request);
    const organization = await this.requirePrisma().organization.findUnique({ where: { id: admin.organizationId }, select: { id: true, name: true, status: true, settings: true, liveMode: true } });
    const settings = isRecord(organization?.settings) ? organization.settings as Record<string, unknown> : {};
    return {
      user: { id: admin.id, email: admin.email, displayName: [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email },
      platformRole: null,
      activeOrganization: organization ? { id: organization.id, name: organization.name, role: admin.role, status: organization.status } : null,
      settings: {
        timezone: typeof settings.timezone === 'string' ? settings.timezone : 'UTC',
        currency: typeof settings.currency === 'string' ? settings.currency : 'USD',
        environment: process.env.NODE_ENV ?? 'development',
        features: isRecord(settings.features) ? settings.features as Record<string, boolean> : {},
      },
      permissions: ['view_clients', 'manage_clients', 'manage_programs', 'manage_members'],
    };
  }
}

@Controller('organizations')
export class OrganizationsCompatibilityController {
  constructor(private readonly scaffold: ScaffoldService, private readonly prisma?: PrismaService) {}

  private requirePrisma(): PrismaService {
    if (!this.prisma) throw this.scaffold.notImplemented('Organizations');
    return this.prisma;
  }

  private async requireOrgAccess(request: Request, orgId: string) {
    const accessToken = (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined) ?? getCookieValue(request, ACCESS_COOKIE_NAME);
    if (!accessToken) throw new UnauthorizedException('Missing authenticated session.');
    const payload = getSessionTokenPayload(accessToken, 'access');
    const admin = await this.requirePrisma().adminUser.findUnique({ where: { id: payload.sub ?? '' }, select: { id: true, email: true, organizationId: true, role: true, isActive: true } });
    if (!admin || !admin.isActive || admin.organizationId !== orgId) throw new ForbiddenException('Access denied to this organization.');
    return admin;
  }

  @Get(':orgId/settings') async getSettings(@Req() request: Request, @Param('orgId') orgId: string) {
    await this.requireOrgAccess(request, orgId);
    const org = await this.requirePrisma().organization.findUnique({ where: { id: orgId }, include: { principalAdmin: { select: { id: true, email: true, firstName: true, lastName: true } } } });
    if (!org) throw new NotFoundException('Organization not found.');
    return { id: org.id, name: org.name, settings: isRecord(org.settings) ? org.settings as Record<string, unknown> : {}, liveMode: org.liveMode, demoRemovedAt: org.demoRemovedAt, principal: org.principalAdmin };
  }

  @Patch(':orgId/settings') async updateSettings(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: Record<string, unknown>) {
    await this.requireOrgAccess(request, orgId);
    const existing = await this.requirePrisma().organization.findUnique({ where: { id: orgId } });
    if (!existing) throw new NotFoundException('Organization not found.');
    const currentSettings = isRecord(existing.settings) ? existing.settings as Record<string, unknown> : {};
    const nextSettings: Record<string, unknown> = { ...currentSettings, ...body };
    const updated = await this.requirePrisma().organization.update({ where: { id: orgId }, data: { name: typeof body.name === 'string' ? body.name : undefined, settings: nextSettings as any } as any });
    return { id: updated.id, name: updated.name, settings: nextSettings, liveMode: updated.liveMode, demoRemovedAt: updated.demoRemovedAt, principal: null };
  }

  @Get(':orgId/members') async listMembers(@Req() request: Request, @Param('orgId') orgId: string) {
    await this.requireOrgAccess(request, orgId);
    const members = await this.requirePrisma().adminUser.findMany({ where: { organizationId: orgId }, select: { id: true, email: true, firstName: true, lastName: true, jobTitle: true, role: true, isActive: true, createdAt: true, invitation: { select: { acceptedAt: true, revokedAt: true } } }, orderBy: { createdAt: 'asc' } });
    return members.map((member) => ({ id: member.id, email: member.email, firstName: member.firstName, lastName: member.lastName, jobTitle: member.jobTitle, role: member.role, isActive: member.isActive, createdAt: member.createdAt.toISOString(), invitePending: !member.invitation || (!member.invitation.acceptedAt && !member.invitation.revokedAt), isPrincipal: false }));
  }

  @Post(':orgId/invitations') async inviteMember(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: Record<string, unknown>) {
    await this.requireOrgAccess(request, orgId);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required.');
    const existing = await this.requirePrisma().adminUser.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with this email already exists.');
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plainToken).digest('hex');
    const randomPasswordHash = await hash(randomBytes(32).toString('hex'), 12);
    await this.requirePrisma().adminUser.create({ data: { organizationId: orgId, email, firstName: String(body.firstName ?? ''), lastName: body.lastName ? String(body.lastName) : null, jobTitle: body.jobTitle ? String(body.jobTitle) : null, passwordHash: randomPasswordHash, role: String(body.role ?? 'reviewer') as 'org_admin' | 'reviewer', isActive: false, invitation: { create: { tokenHash, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) } } } });
    return { message: `Invitation sent to ${email}.` };
  }

  @Post(':orgId/invitations/:memberId/revoke') async revokeInvite(@Req() request: Request, @Param('orgId') orgId: string, @Param('memberId') memberId: string) {
    await this.requireOrgAccess(request, orgId);
    const invitation = await this.requirePrisma().adminInvitation.findFirst({ where: { adminUserId: memberId }, include: { adminUser: true } });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.acceptedAt || invitation.revokedAt) throw new BadRequestException('Only pending invitations can be revoked.');
    await this.requirePrisma().adminInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
    await this.requirePrisma().adminUser.delete({ where: { id: memberId } });
    return { message: `Invitation to ${invitation.adminUser.email} revoked.` };
  }

  @Patch(':orgId/members/:memberId/role') async updateMemberRole(@Req() request: Request, @Param('orgId') orgId: string, @Param('memberId') memberId: string, @Body() body: Record<string, unknown>) {
    await this.requireOrgAccess(request, orgId);
    const member = await this.requirePrisma().adminUser.findFirst({ where: { id: memberId, organizationId: orgId } });
    if (!member) throw new NotFoundException('Member not found.');
    const updated = await this.requirePrisma().adminUser.update({ where: { id: memberId }, data: { role: String(body.role ?? member.role) as 'org_admin' | 'reviewer' }, select: { id: true, email: true, role: true } });
    return { id: updated.id, email: updated.email, role: updated.role };
  }

  @Post(':orgId/members/:memberId/disable') async disableMember(@Req() request: Request, @Param('orgId') orgId: string, @Param('memberId') memberId: string) {
    await this.requireOrgAccess(request, orgId);
    await this.requirePrisma().adminUser.update({ where: { id: memberId, organizationId: orgId }, data: { isActive: false } });
    return { message: 'Member disabled.' };
  }

  @Post(':orgId/members/:memberId/enable') async enableMember(@Req() request: Request, @Param('orgId') orgId: string, @Param('memberId') memberId: string) {
    await this.requireOrgAccess(request, orgId);
    await this.requirePrisma().adminUser.update({ where: { id: memberId, organizationId: orgId }, data: { isActive: true } });
    return { message: 'Member enabled.' };
  }
}

@Controller('api-boundary')
export class FutureApiBoundaryController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @All('*') futureBoundary() { return this.scaffold.notImplemented('Normalized ClientFlow API'); }
}
