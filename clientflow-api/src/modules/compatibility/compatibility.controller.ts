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
import { StorageService } from '../../integrations/storage/storage.service';
import { ProgramAutomationService } from '../automation/program-automation.service';
import { WorkflowConfigService } from '../programs/workflow-config.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { AUTOMATED_CLIENT_STATUSES, buildClientProfileUpdate } from '../clients/client-profile-update';
import { resolvePublicFormLink } from '../forms/public-form-link';
import { applyEnrollmentClosure } from '../lifecycle/enrollment-closure';
import { assertEnrollmentTransition, isEnrollmentStatus, transitionEnrollment } from '../lifecycle/enrollment-state';
import { withoutLinkSecrets } from '../forms/form-delivery.service';
import { answerFields, labelledAnswers } from '../forms/answer-list';
import { isLegacyContract } from '../contracts/legacy-contract';
import { assertContractVersionContent, welcomeVersionContent } from '../programs/workflow-version-content';
import { normalizeMonitoringFrequency, parseComplianceStatus, recordMonitoringResult } from '../lifecycle/monitoring';
import { applyFinalReportDecision } from '../lifecycle/final-report';
import { type FieldSpec, pickFields } from '../../common/validation/pick-fields';
import {
  assertCanGrantRole,
  assertCanManageMember,
  parseRole,
  requireManager,
} from '../../common/authorization/role-policy';
import {
  assertEnrollmentForClient,
  findClientForOrg,
  findEnrollmentForOrg,
  findFormTemplateForOrg,
  findProgramForOrg,
  findStoredFileForOrg,
} from '../../common/tenancy/org-scoped.repository';
import {
  EXECUTED_CONTRACT_MIME_TYPE,
  EXECUTED_STORED_FILE_SELECT,
  ensureExecutedContractPdf,
} from '../contracts/executed-contract-file';
import { FormDeliveryService } from '../forms/form-delivery.service';
import { FormProfileService } from '../forms/form-profile.service';
import { IntakeWorkflowService } from '../forms/intake-workflow.service';
import { parseIdempotencyKey } from '../communications/communication-attempts';
import { Throttle } from '@nestjs/throttler';

/** Sign-in endpoints: 10 attempts a minute per visitor, so passwords and tokens can't be guessed. */
export const SIGN_IN_LIMIT = { default: { limit: 10, ttl: 60_000 } };

const ACCESS_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-clientflow_session' : 'clientflow_session';
const REFRESH_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-clientflow_refresh' : 'clientflow_refresh';
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readJwtSecret(type: 'access' | 'refresh'): string {
  const key = type === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET';
  // No fallback (not JWT_SECRET, not a built-in string): the env schema refuses to start without
  // both secrets, and signing or verifying with a guessable secret must be impossible.
  const secret = process.env[key];
  if (!secret) throw new ServiceUnavailableException('Authentication is not configured.');
  return secret;
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

function trimSlashEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start += 1;
  while (end > start && value[end - 1] === '/') end -= 1;
  return value.slice(start, end);
}

function sanitizeStorageName(value: string, fallback: string): string {
  const cleaned = Array.from(value)
    .map((character) => /[A-Za-z0-9._-]/.test(character) ? character : '-')
    .join('');
  const trimmed = cleaned.replaceAll('--', '-');
  return trimSlashEdges(trimmed).replace(/^-+/, '').replace(/-+$/, '') || fallback;
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
    private readonly storage?: StorageService,
    private readonly workflowConfig?: WorkflowConfigService,
    private readonly enrollments?: EnrollmentsService,
    private readonly formProfile?: FormProfileService,
    private readonly formDelivery?: FormDeliveryService,
  ) {}

  private requirePrisma(): PrismaService {
    if (!this.prisma) throw this.scaffold.notImplemented('ClientFlow admin compatibility');
    return this.prisma;
  }

  private requireStorage(): StorageService {
    if (!this.storage) throw this.scaffold.notImplemented('ClientFlow storage compatibility');
    return this.storage;
  }

  /** Runs a program automation trigger after the change it describes; a failure never undoes that. */
  private async fireTrigger(request: Parameters<ProgramAutomationService['runTrigger']>[0]) {
    if (!this.automation) return;
    try {
      await this.automation.runTrigger(request);
    } catch (error) {
      this.logger.warn(`Automation ${request.trigger} failed for client ${request.clientId}: ${(error as Error).message}`);
    }
  }

  private requireWorkflowConfig(): WorkflowConfigService {
    if (!this.workflowConfig) throw this.scaffold.notImplemented('ClientFlow workflow configuration');
    return this.workflowConfig;
  }

  private requireEnrollments(): EnrollmentsService {
    if (!this.enrollments) throw this.scaffold.notImplemented('ClientFlow enrollments');
    return this.enrollments;
  }

  private requireFormProfile(): FormProfileService {
    if (!this.formProfile) throw this.scaffold.notImplemented('ClientFlow form profile');
    return this.formProfile;
  }

  private requireFormDelivery(): FormDeliveryService {
    if (!this.formDelivery) throw this.scaffold.notImplemented('ClientFlow form delivery');
    return this.formDelivery;
  }

  private actorOf(admin: { id: string; email: string; firstName?: string | null; lastName?: string | null }) {
    return { id: admin.id, displayName: [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email };
  }

  private enrollmentTransition(target: unknown): string {
    return String(target ?? '').toLowerCase();
  }

  private progressForEnrollmentStatus(status: string): number {
    return {
      interested: 10,
      pending_review: 25,
      approved: 45,
      onboarding: 70,
      active: 85,
      on_hold: 60,
      completed: 100,
      declined: 100,
      withdrawn: 100,
    }[status] ?? 0;
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
    const resolvedConfig = config ?? {
      enabled: true,
      sendContractAfterIntake: false,
      sendWelcomeAfterContractSigned: false,
      activeContractTemplateId: null,
      activeContractVersionId: null,
      activeWelcomeEmailTemplateId: null,
      activeWelcomeEmailVersionId: null,
    };
    return {
      config: resolvedConfig,
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
      // Deprecated mirror of `config` for callers not yet migrated - remove once nothing reads it.
      automation: {
        sendContractAfterIntake: resolvedConfig.sendContractAfterIntake,
        sendWelcomeAfterContractSigned: resolvedConfig.sendWelcomeAfterContractSigned,
      },
    };
  }

  /** Active clients by default; `?archived=true` lists the archive (they are never mixed). */
  @Get('clients') async listClients(@Req() request: Request, @Query('archived') archived?: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfClient.findMany({
      where: { organizationId: orgId, isArchived: archived === 'true' },
      orderBy: archived === 'true' ? { archivedAt: 'desc' } : { createdAt: 'desc' },
    });
  }
  // An archived client stays viewable (the profile shows it as archived and offers Restore).
  @Get('clients/:id') async getClient(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const client = await this.requirePrisma().cfClient.findFirst({ where: { id, organizationId: orgId } });
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }
  @Post('clients') async createClient(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const optional = pickFields(body, CLIENT_CREATE_FIELDS);
    if (typeof optional.assignedUserId === 'string') {
      const assignee = await prisma.adminUser.findFirst({ where: { id: optional.assignedUserId, organizationId: orgId } });
      if (!assignee) throw new NotFoundException('Assigned staff member not found.');
    }
    // Legacy mirror only (enrollment is canonical); still must belong to this organization.
    const programId = typeof body.programId === 'string' && body.programId
      ? (await findProgramForOrg(prisma, orgId, body.programId)).id
      : null;
    const status = String(body.status ?? 'New Intake');
    if (AUTOMATED_CLIENT_STATUSES.has(status)) {
      throw new BadRequestException('Client workflow statuses are set by the intake and contract workflow.');
    }
    return prisma.cfClient.create({
      data: {
        ...optional,
        organizationId: orgId,
        programId,
        businessName: String(body.businessName ?? 'Untitled Client'),
        primaryContactName: String(body.primaryContactName ?? 'Unknown Contact'),
        email: String(body.email ?? ''),
        phone: String(body.phone ?? ''),
        assignedStaff: String(body.assignedStaff ?? 'Unassigned'),
        intake: (isRecord(body.intake) ? body.intake : {}) as any,
        socialLinks: Array.isArray(body.socialLinks) ? body.socialLinks.filter((link) => typeof link === 'string') : [],
        status,
        lifecycleStatus: 'intake_pending',
        intakeSource: String(body.intakeSource ?? 'admin_created'),
      } as any,
    });
  }
  @Patch('clients/:id') async updateClient(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    // Explicit allowlist: the request body is never passed to Prisma directly.
    const data = buildClientProfileUpdate(body);
    const prisma = this.requirePrisma();
    const previous = await findClientForOrg(prisma, orgId, id, { includeArchived: true });
    const archiving = data.isArchived === true && !previous.isArchived;
    const restoring = data.isArchived === false && previous.isArchived;
    const previousArchivedAt = previous.archivedAt;
    if (archiving && !data.archivedAt) data.archivedAt = new Date();
    // Restoring returns the client to the active caseload: the archive details no longer apply.
    if (restoring) Object.assign(data, { archivedAt: null, archiveReason: null, finalStatus: null });
    const updated = await prisma.$transaction(async (transaction) => {
      const client = await transaction.cfClient.update({ where: { id, organizationId: orgId }, data });
      // Archive and restore cascade to the client's enrollments on the server, so every page
      // (and every other session) sees the same state. Restore only brings back the enrollments
      // archived together with the client, not ones archived on their own earlier.
      if (archiving) {
        await transaction.cfProgramEnrollment.updateMany({
          where: { organizationId: orgId, clientId: id, isArchived: false },
          data: { isArchived: true, archivedAt: client.archivedAt },
        });
      }
      if (restoring && previousArchivedAt) {
        await transaction.cfProgramEnrollment.updateMany({
          where: { organizationId: orgId, clientId: id, isArchived: true, archivedAt: previousArchivedAt },
          data: { isArchived: false, archivedAt: null },
        });
      }
      return client;
    });
    if (this.enrollments && (data.assignedUserId !== undefined || data.assignedStaff !== undefined)) {
      await this.enrollments.syncAssignmentToActiveEnrollments(
        orgId,
        id,
        updated.assignedUserId,
        updated.assignedStaff,
      );
    }
    return updated;
  }
  @Post('clients/:clientId/apply-form-responses/preview') async previewApplyFormResponses(
    @Req() request: Request,
    @Param('clientId') clientId: string,
    @Body() body: { assignmentId?: string },
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requireFormProfile().preview(orgId, clientId, String(body?.assignmentId ?? ''));
  }
  @Post('clients/:clientId/apply-form-responses') async applyFormResponses(
    @Req() request: Request,
    @Param('clientId') clientId: string,
    @Body() body: { assignmentId?: string; fields?: unknown },
  ) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const displayName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email;
    return this.requireFormProfile().apply(
      orgId,
      { id: admin.id, displayName },
      clientId,
      String(body?.assignmentId ?? ''),
      body?.fields,
    );
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
    const [clients, formAssignments, formTemplates, terms, contracts, monitoring, statusHistory, intakeLinks, welcomeEmails] = await Promise.all([
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
        select: { id: true, name: true, fields: true },
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
      prisma.cfIntakeSubmissionProgram.findMany({
        where: { organizationId: orgId, enrollmentId: { in: enrollmentIds } },
      }),
      // Welcome emails decide whether a signed participant still needs one (their next step).
      prisma.cfCommunication.findMany({
        where: { organizationId: orgId, clientId: { in: clientIds }, type: 'welcome_email' },
        select: { id: true, clientId: true, contractId: true, type: true, status: true, date: true, sentAt: true, errorCode: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    // The intake answers each participant gave when they applied: the shared (core) questions and
    // this program's questions, labelled from the form exactly as it was shown to them.
    const intakeSubmissionIds = [...new Set(intakeLinks.map((link) => link.intakeSubmissionId))];
    const [intakeSubmissions, intakeSnapshots] = intakeSubmissionIds.length
      ? await Promise.all([
        prisma.cfIntakeSubmission.findMany({
          where: { organizationId: orgId, id: { in: intakeSubmissionIds } },
          select: { id: true, responsePayload: true, submittedAt: true },
        }),
        prisma.cfIntakeSubmissionSnapshot.findMany({
          where: { organizationId: orgId, intakeSubmissionId: { in: intakeSubmissionIds } },
          select: { intakeSubmissionId: true, renderedSections: true },
        }),
      ])
      : [[], []];
    const intakeFor = (enrollmentId: string) => {
      const link = intakeLinks.find((item) => item.enrollmentId === enrollmentId);
      const submission = link && intakeSubmissions.find((item) => item.id === link.intakeSubmissionId);
      if (!link || !submission) return { coreIntake: [], programIntake: [] };
      const snapshot = intakeSnapshots.find((item) => item.intakeSubmissionId === submission.id);
      const sections = Array.isArray(snapshot?.renderedSections)
        ? (snapshot.renderedSections as Array<Record<string, unknown> | null>)
        : [];
      const core = sections.find((section) => section?.kind === 'core');
      const own = sections.find((section) => section?.kind === 'program' && section.programId === id);
      return {
        coreIntake: [{
          id: `${submission.id}:core`,
          title: typeof core?.title === 'string' && core.title ? core.title : 'Intake',
          submittedAt: submission.submittedAt,
          answers: labelledAnswers(answerFields(core?.fields), submission.responsePayload),
        }],
        programIntake: [{
          id: `${submission.id}:${id}`,
          title: typeof own?.title === 'string' && own.title ? own.title : program.name,
          submittedAt: submission.submittedAt,
          answers: labelledAnswers(answerFields(own?.fields), link.responsePayload),
        }],
      };
    };
    const participants = enrollments.flatMap((enrollment) => {
      const client = clients.find((item) => item.id === enrollment.clientId);
      if (!client) return [];
      const enrollmentForms = formAssignments.filter((item) => item.enrollmentId === enrollment.id);
      return [{
        client,
        enrollment,
        ...intakeFor(enrollment.id),
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
            answers: labelledAnswers(answerFields(template?.fields), item.responses),
          };
        }),
        terms: terms.filter((item) => item.enrollmentId === enrollment.id),
        contracts: contracts
          .filter((item) => item.enrollmentId === enrollment.id)
          .map((item) => ({ ...item, legacy: isLegacyContract(item) })),
        welcomeEmails: welcomeEmails.filter((item) => item.clientId === enrollment.clientId),
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
    // Only treat this as an explicit staff choice when the request actually carries workflow
    // settings - otherwise this would fake an "administrator configured this" update.
    if (body.sendContractAfterIntake !== undefined || body.sendWelcomeAfterContractSigned !== undefined) {
      await this.requireWorkflowConfig().applyUpdate(orgId, program.id, {
        enabled: true,
        sendContractAfterIntake: body.sendContractAfterIntake === true,
        sendWelcomeAfterContractSigned: body.sendWelcomeAfterContractSigned === true,
      });
    } else {
      await this.requireWorkflowConfig().getOrCreate(orgId, program.id, program.name);
    }
    return program;
  }
  @Patch('programs/:id') async updateProgram(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const data = pickFields(body, PROGRAM_UPDATE_FIELDS);
    if (typeof data.defaultFormTemplateId === 'string' && data.defaultFormTemplateId) {
      await findFormTemplateForOrg(this.requirePrisma(), orgId, data.defaultFormTemplateId);
    }
    return this.requirePrisma().cfProgram.update({ where: { id, organizationId: orgId }, data });
  }
  @Get('programs/:id/workflow') async getProgramWorkflowConfig(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.getProgramWorkflow(orgId, id);
  }
  @Patch('programs/:id/workflow') async updateProgramWorkflowConfig(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    await findProgramForOrg(this.requirePrisma(), orgId, id);
    await this.requirePrisma().cfProgram.findFirstOrThrow({
      where: { id, organizationId: orgId },
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
    await this.requireWorkflowConfig().applyUpdate(orgId, id, data);
    return this.getProgramWorkflow(orgId, id);
  }
  @Post('programs/:id/workflow/contracts/templates') async createProgramWorkflowContractTemplate(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    await findProgramForOrg(this.requirePrisma(), orgId, id);
    if (body.content || body.fileUrl || body.fileName) assertContractVersionContent(body);
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
          storedFileId: body.storedFileId ? String(body.storedFileId) : null,
          signableFields: Array.isArray(body.signableFields) ? body.signableFields : [],
          createdBy: admin.email,
        },
      });
    }
    return this.getProgramWorkflow(orgId, id);
  }
  @Post('programs/:programId/workflow/contracts/templates/:templateId/versions') async createProgramWorkflowContractVersion(@Req() request: Request, @Param('programId') programId: string, @Param('templateId') templateId: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    await findProgramForOrg(this.requirePrisma(), orgId, programId);
    const template = await this.requirePrisma().cfProgramContractTemplate.findFirst({
      where: { id: templateId, organizationId: orgId, programId },
      select: { id: true },
    });
    if (!template) throw new NotFoundException('Program workflow contract template not found.');
    assertContractVersionContent(body);
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
        storedFileId: body.storedFileId ? String(body.storedFileId) : null,
        signableFields: Array.isArray(body.signableFields) ? body.signableFields : [],
        createdBy: admin.email,
      },
    });
    if (body.makeActive !== false) {
      await this.requireWorkflowConfig().applyUpdate(orgId, programId, { activeContractVersionId: version.id, activeContractTemplateId: templateId });
    }
    return this.getProgramWorkflow(orgId, programId);
  }
  @Post('programs/:id/workflow/emails/templates') async createProgramWorkflowWelcomeTemplate(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    await findProgramForOrg(this.requirePrisma(), orgId, id);
    const content = body.subject || body.body ? welcomeVersionContent(body) : null;
    const template = await this.requirePrisma().cfProgramWelcomeEmailTemplate.create({
      data: {
        organizationId: orgId,
        programId: id,
        name: String(body.name ?? 'Welcome Email'),
        isActive: body.isActive !== false,
      },
    });
    if (content) {
      await this.requirePrisma().cfProgramWelcomeEmailVersion.create({
        data: {
          organizationId: orgId,
          templateId: template.id,
          version: 1,
          subject: content.subject,
          body: content.body,
          guideStoredFileId: body.guideStoredFileId ? String(body.guideStoredFileId) : null,
          createdBy: admin.email,
          allowedVariables: Array.isArray(body.allowedVariables) ? body.allowedVariables : [],
        },
      });
    }
    return this.getProgramWorkflow(orgId, id);
  }
  @Post('programs/:programId/workflow/emails/templates/:templateId/versions') async createProgramWorkflowWelcomeVersion(@Req() request: Request, @Param('programId') programId: string, @Param('templateId') templateId: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    await findProgramForOrg(this.requirePrisma(), orgId, programId);
    const template = await this.requirePrisma().cfProgramWelcomeEmailTemplate.findFirst({
      where: { id: templateId, organizationId: orgId, programId },
      select: { id: true },
    });
    if (!template) throw new NotFoundException('Program workflow welcome template not found.');
    const content = welcomeVersionContent(body);
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
        subject: content.subject,
        body: content.body,
        guideStoredFileId: body.guideStoredFileId ? String(body.guideStoredFileId) : null,
        createdBy: admin.email,
        allowedVariables: Array.isArray(body.allowedVariables) ? body.allowedVariables : [],
      },
    });
    if (body.makeActive !== false) {
      await this.requireWorkflowConfig().applyUpdate(orgId, programId, { activeWelcomeEmailVersionId: version.id, activeWelcomeEmailTemplateId: templateId });
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
    await findProgramForOrg(this.requirePrisma(), orgId, id);
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
    await findProgramForOrg(this.requirePrisma(), orgId, programId);
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
    await findProgramForOrg(this.requirePrisma(), orgId, id);
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
    await findProgramForOrg(this.requirePrisma(), orgId, programId);
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
    await findProgramForOrg(this.requirePrisma(), orgId, programId);
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

  @Get('enrollments') async listEnrollments(
    @Req() request: Request,
    @Query('clientId') clientId?: string,
    @Query('programId') programId?: string,
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfProgramEnrollment.findMany({
      where: { organizationId: orgId, ...(clientId ? { clientId } : {}), ...(programId ? { programId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
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
    const initialStatus = this.enrollmentTransition(body.status ?? 'interested');
    const actorDisplayName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email;
    const enrollment = await this.requireEnrollments().createManualEnrollment({
      organizationId: orgId,
      clientId: String(body.clientId ?? ''),
      programId: String(body.programId ?? ''),
      status: initialStatus,
      assignedUserId: body.assignedUserId ? String(body.assignedUserId) : null,
      assignedStaff: body.assignedStaff ? String(body.assignedStaff) : null,
      // The audit trail always names the signed-in admin, never a body-supplied actor.
      lastModifiedByUserId: admin.id,
      lastModifiedByDisplayName: actorDisplayName,
      startDate: body.startDate ? new Date(String(body.startDate)) : null,
      nextAction: body.nextAction ? String(body.nextAction) : null,
      nextActionDate: body.nextActionDate ? new Date(String(body.nextActionDate)) : null,
      progressPercentage: Number(body.progressPercentage ?? this.progressForEnrollmentStatus(initialStatus)),
      currentGoalId: body.currentGoalId ? String(body.currentGoalId) : null,
      clientResponsiveness: String(body.clientResponsiveness ?? 'unknown'),
      currentBlockers: body.currentBlockers ? String(body.currentBlockers) : null,
      riskLevel: String(body.riskLevel ?? 'low'),
      staffProgressNotes: body.staffProgressNotes ? String(body.staffProgressNotes) : null,
      meetingsAttended: Number(body.meetingsAttended ?? 0),
      outcomeAchieved: String(body.outcomeAchieved ?? 'pending'),
      finalOutcomeSummary: body.finalOutcomeSummary ? String(body.finalOutcomeSummary) : null,
      completedAt: body.completedAt ? new Date(String(body.completedAt)) : null,
      withdrawnAt: body.withdrawnAt ? new Date(String(body.withdrawnAt)) : null,
      onHoldReason: body.onHoldReason ? String(body.onHoldReason) : null,
      actorUserId: admin.id,
      actorDisplayName,
    });
    if (this.automation) {
      await this.automation.runTrigger({
        organizationId: orgId,
        clientId: enrollment.clientId,
        trigger: 'enrollment.created',
        programIds: [enrollment.programId],
        enrollmentIdsByProgramId: { [enrollment.programId]: enrollment.id },
        actorUserId: admin.id,
        actorDisplayName,
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
    if (body.status !== undefined) {
      throw new BadRequestException('Enrollment status changes must use the transition endpoint.');
    }
    const data = pickFields(body, ENROLLMENT_UPDATE_FIELDS);
    if (typeof data.assignedUserId === 'string') {
      const assignee = await prisma.adminUser.findFirst({ where: { id: data.assignedUserId, organizationId: orgId } });
      if (!assignee) throw new NotFoundException('Assigned staff member not found.');
    }
    const updated = await prisma.cfProgramEnrollment.update({
      where: { id, organizationId: orgId },
      data: { ...data, lastModifiedByUserId: admin.id, lastModifiedByDisplayName: [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email },
    });
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
  @Post('enrollments/:id/transition') async transitionEnrollment(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const current = await prisma.cfProgramEnrollment.findFirst({ where: { id, organizationId: orgId } });
    if (!current) throw new NotFoundException('Enrollment not found.');
    const target = this.enrollmentTransition(body.status);
    if (!target) throw new BadRequestException('A target enrollment status is required.');
    if (!isEnrollmentStatus(target)) throw new BadRequestException(`Unknown enrollment status: ${target}.`);
    // Staff may reinstate a withdrawn member; nothing else leaves a closed state.
    assertEnrollmentTransition(String(current.status), target, { byStaff: true });
    const now = new Date();
    const changedByDisplayName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email;
    const updated = await prisma.$transaction(async (transaction) => {
      await transitionEnrollment(transaction, {
        organizationId: orgId,
        enrollmentId: id,
        from: String(current.status),
        to: target,
        byStaff: true,
        data: {
          progressPercentage: this.progressForEnrollmentStatus(target),
          nextAction: body.nextAction !== undefined ? (body.nextAction ? String(body.nextAction) : null) : current.nextAction,
          nextActionDate: body.nextActionDate !== undefined
            ? (body.nextActionDate ? new Date(String(body.nextActionDate)) : null)
            : current.nextActionDate,
          lastProgressUpdate: now,
          lastModifiedByUserId: admin.id,
          lastModifiedByDisplayName: changedByDisplayName,
          completedAt: target === 'completed' ? now : current.completedAt,
          withdrawnAt: target === 'withdrawn' ? now : target === 'active' ? null : current.withdrawnAt,
          onHoldReason: body.statusReason ? String(body.statusReason) : target === 'on_hold' ? current.onHoldReason : null,
        },
        history: {
          changedByUserId: admin.id,
          changedByDisplayName,
          reason: body.statusReason ? String(body.statusReason) : null,
        },
      });
      const enrollment = await transaction.cfProgramEnrollment.findFirstOrThrow({ where: { id, organizationId: orgId } });
      // A closed enrollment leaves nothing actionable behind: open contracts, forms and billing end.
      await applyEnrollmentClosure(transaction, enrollment, now);
      await transaction.cfActivityLog.create({
        data: {
          organizationId: orgId,
          clientId: enrollment.clientId,
          enrollmentId: enrollment.id,
          actorUserId: admin.id,
          action: 'ENROLLMENT_STATUS_CHANGED',
          description: `Enrollment status changed from ${current.status} to ${enrollment.status}.`,
          user: changedByDisplayName,
        },
      });
      return enrollment;
    });
    for (const trigger of ['approved', 'completed'] as const) {
      if (String(current.status) === trigger || String(updated.status) !== trigger) continue;
      await this.fireTrigger({
        organizationId: orgId,
        clientId: updated.clientId,
        trigger: trigger === 'approved' ? 'enrollment.approved' : 'program.completed',
        programIds: [updated.programId],
        enrollmentIdsByProgramId: { [updated.programId]: updated.id },
        actorUserId: admin.id,
        actorDisplayName: changedByDisplayName,
        idempotencySeed: `compat.enrollment.${trigger}:${updated.id}`,
        payload: { enrollmentStatus: updated.status },
      });
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
    const data = pickFields(body, FORM_TEMPLATE_UPDATE_FIELDS);
    if (typeof data.programId === 'string' && data.programId) {
      await findProgramForOrg(this.requirePrisma(), orgId, data.programId);
    }
    return this.requirePrisma().cfFormTemplate.update({ where: { id, organizationId: orgId }, data });
  }
  @Delete('form-templates/:id') async deleteFormTemplate(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    await this.requirePrisma().cfFormTemplate.update({ where: { id, organizationId: orgId }, data: { isActive: false } });
    return { id, unlinkedProgramIds: [], cancelledAssignments: 0 };
  }
  @Get('form-assignments') async listFormAssignments(@Req() request: Request, @Query('clientId') clientId?: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const assignments = await this.requirePrisma().cfFormAssignment.findMany({
      where: { organizationId: orgId, ...(clientId ? { clientId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return assignments.map(withoutLinkSecrets);
  }
  @Post('form-assignments') async createFormAssignment(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    return this.requireFormDelivery().createAssignment(orgId, this.actorOf(admin), body);
  }
  @Post('form-assignments/:id/send') async sendFormAssignment(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    return this.requireFormDelivery().send(orgId, this.actorOf(admin), id, {
      personalMessage: body?.personalMessage,
      idempotencyKey: parseIdempotencyKey(request.headers['idempotency-key']),
    });
  }
  @Patch('form-assignments/:id') async updateFormAssignment(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const updated = await this.requirePrisma().cfFormAssignment.update({
      where: { id, organizationId: orgId },
      data: pickFields(body, FORM_ASSIGNMENT_UPDATE_FIELDS),
    });
    return withoutLinkSecrets(updated);
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
    return { ...submission, client: client ?? null, assignment: assignment ? withoutLinkSecrets(assignment) : null, snapshot: snapshot ?? null, programs };
  }

  @Get('notifications') async listNotifications(@Req() request: Request, @Query('limit') limit?: string) {
    const { admin } = await this.requireOrgFromRequest(request);
    const mine = { organizationId: admin.organizationId, recipientAdminId: admin.id };
    const parsedLimit = Number.parseInt(limit ?? '30', 10);
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 30;
    const prisma = this.requirePrisma();
    const [items, unreadCount] = await Promise.all([
      prisma.cfNotification.findMany({ where: mine, orderBy: { createdAt: 'desc' }, take }),
      // The badge counts every unread notification, not just the ones on this page.
      prisma.cfNotification.count({ where: { ...mine, readAt: null } }),
    ]);
    return { items, unreadCount };
  }
  @Patch('notifications/read-all') async markAllNotificationsRead(@Req() request: Request) {
    const { admin } = await this.requireOrgFromRequest(request);
    const { count } = await this.requirePrisma().cfNotification.updateMany({ where: { organizationId: admin.organizationId, recipientAdminId: admin.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: count };
  }
  @Patch('notifications/:id/read') async markNotificationRead(@Req() request: Request, @Param('id') id: string) {
    const { admin } = await this.requireOrgFromRequest(request);
    const mine = { id, organizationId: admin.organizationId, recipientAdminId: admin.id };
    const { count } = await this.requirePrisma().cfNotification.updateMany({ where: { ...mine, readAt: null }, data: { readAt: new Date() } });
    if (count === 0 && !(await this.requirePrisma().cfNotification.findFirst({ where: mine, select: { id: true } }))) {
      throw new NotFoundException('Notification not found.');
    }
    return { id, read: true };
  }

  @Get('terms') async listAllTerms(
    @Req() request: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfTerms.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...listPage(limit, offset),
    });
  }
  @Get('monitoring') async listAllMonitoring(@Req() request: Request) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfEnrollmentMonitoring.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }
  @Get('contracts') async listAllContracts(
    @Req() request: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const contracts = await this.requirePrisma().cfContract.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...listPage(limit, offset),
    });
    return contracts.map((contract) => ({ ...contract, legacy: isLegacyContract(contract) }));
  }
  @Get('documents') async listAllDocuments(
    @Req() request: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfDocument.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...listPage(limit, offset),
    });
  }
  @Post('files/upload-intent') async createStoredFileUploadIntent(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const storage = this.requireStorage();
    storage.assertEnabled();
    const originalFileName = String(body.name ?? 'upload.bin');
    const mimeType = String(body.type ?? 'application/octet-stream');
    const sizeBytes = Number(body.byteSize ?? 0);
    const storageKeyPrefix = body.storageKeyPrefix ? trimSlashEdges(String(body.storageKeyPrefix)) : 'uploads';
    const safeName = sanitizeStorageName(originalFileName, 'upload.bin');
    const storageKey = `${storageKeyPrefix}/${orgId}/${Date.now()}-${randomBytes(8).toString('hex')}-${safeName}`;
    const upload = await storage.createPresignedUploadUrl(storageKey, mimeType);
    const storedFile = await this.requirePrisma().cfStoredFile.create({
      data: {
        organizationId: orgId,
        storageKey,
        originalFileName,
        mimeType,
        sizeBytes,
        status: 'REQUESTED',
        uploadedByUserId: admin.id,
      },
    });
    return { storedFile, uploadUrl: upload.url, expiresInSeconds: upload.expiresInSeconds };
  }
  @Post('files/:id/complete') async completeStoredFileUpload(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const storage = this.requireStorage();
    storage.assertEnabled();
    const storedFile = await this.requirePrisma().cfStoredFile.findFirst({ where: { id, organizationId: orgId } });
    if (!storedFile) throw new NotFoundException('Stored file not found.');
    const exists = await storage.objectExists(storedFile.storageKey);
    if (!exists) throw new BadRequestException('Uploaded file bytes were not found in storage.');
    return this.requirePrisma().cfStoredFile.update({
      where: { id: storedFile.id },
      data: { status: 'READY', completedAt: new Date() },
    });
  }
  @Get('files/:id/download') async downloadStoredFile(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const storage = this.requireStorage();
    storage.assertEnabled();
    const storedFile = await this.requirePrisma().cfStoredFile.findFirst({ where: { id, organizationId: orgId } });
    if (!storedFile) throw new NotFoundException('Stored file not found.');
    const [contractVersion, welcomeVersion, document] = await Promise.all([
      this.requirePrisma().cfProgramContractVersion.findFirst({
        where: { organizationId: orgId, storedFileId: storedFile.id },
        select: { id: true },
      }),
      this.requirePrisma().cfProgramWelcomeEmailVersion.findFirst({
        where: { organizationId: orgId, guideStoredFileId: storedFile.id },
        select: { id: true },
      }),
      this.requirePrisma().cfDocument.findFirst({
        where: { organizationId: orgId, storedFileId: storedFile.id },
        select: { id: true },
      }),
    ]);
    if (!contractVersion && !welcomeVersion && !document) {
      throw new ForbiddenException('Stored file is not available through this endpoint.');
    }
    const download = await storage.createPresignedDownloadUrl(storedFile.storageKey, 300);
    return { url: download.url, expiresInSeconds: download.expiresInSeconds };
  }
  @Get('communications') async listAllCommunications(
    @Req() request: Request,
    @Query('limit') limitQuery?: string,
    @Query('offset') offsetQuery?: string,
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfCommunication.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...listPage(limitQuery ?? '100', offsetQuery),
    });
  }
  @Get('final-reports') async listAllFinalReports(
    @Req() request: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfFinalReport.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...listPage(limit, offset),
    });
  }
  @Get('clients/:clientId/terms') async listTerms(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfTerms.findMany({ where: { organizationId: orgId, clientId }, orderBy: { createdAt: 'desc' } });
  }
  @Post('clients/:clientId/terms') async createTerms(@Req() request: Request, @Param('clientId') clientId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    await findClientForOrg(this.requirePrisma(), orgId, clientId, { includeArchived: true });
    const termsEnrollment = typeof body.enrollmentId === 'string' && body.enrollmentId
      ? await findEnrollmentForOrg(this.requirePrisma(), orgId, body.enrollmentId, { clientId })
      : null;
    if (!termsEnrollment && body.programId) await findProgramForOrg(this.requirePrisma(), orgId, String(body.programId));
    return this.requirePrisma().cfTerms.create({ data: { organizationId: orgId, clientId, enrollmentId: termsEnrollment?.id ?? null, programId: termsEnrollment?.programId ?? String(body.programId ?? ''), supportType: String(body.supportType ?? 'Service'), resourceDescription: String(body.resourceDescription ?? ''), grantAmount: Number(body.grantAmount ?? 0), loanAmount: Number(body.loanAmount ?? 0), investmentAmount: Number(body.investmentAmount ?? 0), forgivableAmount: Number(body.forgivableAmount ?? 0), repaymentRequired: Boolean(body.repaymentRequired ?? false), repaymentSchedule: String(body.repaymentSchedule ?? ''), interestDescription: String(body.interestDescription ?? ''), milestones: String(body.milestones ?? ''), reportingRequirements: String(body.reportingRequirements ?? ''), startDate: String(body.startDate ?? ''), endDate: String(body.endDate ?? ''), monitoringFrequency: String(body.monitoringFrequency ?? 'Monthly'), specialConditions: String(body.specialConditions ?? ''), fundingAmount: Number(body.fundingAmount ?? 0) } });
  }
  @Patch('terms/:id') async updateTerms(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfTerms.update({ where: { id, organizationId: orgId }, data: pickFields(body, TERMS_UPDATE_FIELDS) });
  }
  @Post('enrollments/:enrollmentId/monitoring') async createMonitoring(@Req() request: Request, @Param('enrollmentId') enrollmentId: string, @Body() body: Record<string, unknown>) {
    const { orgId } = await this.requireOrgFromRequest(request);
    await findEnrollmentForOrg(this.requirePrisma(), orgId, enrollmentId);
    return this.requirePrisma().cfEnrollmentMonitoring.create({ data: { organizationId: orgId, enrollmentId, name: String(body.name ?? 'Monitoring Review'), description: body.description ? String(body.description) : null, frequency: normalizeMonitoringFrequency(body.frequency ?? 'monthly').frequency, customIntervalDays: body.customIntervalDays ? Number(body.customIntervalDays) : normalizeMonitoringFrequency(body.frequency ?? 'monthly').customIntervalDays, expectedValue: body.expectedValue ? Number(body.expectedValue) : null, actualValue: body.actualValue ? Number(body.actualValue) : null, unit: body.unit ? String(body.unit) : null, complianceStatus: body.complianceStatus !== undefined || body.status !== undefined ? parseComplianceStatus(body.complianceStatus ?? body.status) : 'pending', lastReviewedAt: body.lastReviewedAt ? new Date(String(body.lastReviewedAt)) : null, nextReviewAt: body.nextReviewAt ? new Date(String(body.nextReviewAt)) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), assignedReviewerId: body.assignedStaffId ? String(body.assignedStaffId) : null, followUpRequired: Boolean(body.followUpRequired ?? false), evidenceRequired: Boolean(body.evidenceRequired ?? false), notes: String(body.notes ?? ''), active: true } as any });
  }
  /** Adapter: the review is recorded by the monitoring lifecycle (result, schedule, history). */
  @Post('enrollment-monitoring/:id/results') async recordMonitoringResult(@Req() request: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().$transaction((transaction) => recordMonitoringResult(transaction, {
      organizationId: orgId,
      monitoringId: id,
      result: body,
      reviewedByUserId: admin.id,
    }));
  }
  @Get('enrollment-monitoring/:id/history') async getMonitoringHistory(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfEnrollmentMonitoringHistory.findMany({ where: { organizationId: orgId, enrollmentMonitoringId: id }, orderBy: { createdAt: 'desc' } });
  }
  @Get('clients/:clientId/contracts') async listContracts(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const contracts = await this.requirePrisma().cfContract.findMany({ where: { organizationId: orgId, clientId }, orderBy: { createdAt: 'desc' } });
    return contracts.map((contract) => ({ ...contract, legacy: isLegacyContract(contract) }));
  }
  @Get('clients/:clientId/contracts/:contractId/download') async downloadExecutedContract(
    @Req() request: Request,
    @Param('clientId') clientId: string,
    @Param('contractId') contractId: string,
  ) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const storage = this.requireStorage();
    storage.assertEnabled();
    const contract = await this.requirePrisma().cfContract.findFirst({
      where: {
        id: contractId,
        clientId,
        organizationId: orgId,
      },
      include: { executedStoredFile: { select: EXECUTED_STORED_FILE_SELECT } },
    });
    if (!contract?.executedStoredFileId || !contract.executedStoredFile) {
      throw new NotFoundException('Executed contract artifact not found.');
    }
    // Upgrades a copy archived as plain text to a PDF on first download.
    const client = await this.requirePrisma().cfClient.findFirst({
      where: { id: clientId, organizationId: orgId },
      select: { businessName: true },
    });
    const executed = await ensureExecutedContractPdf(
      this.requirePrisma(),
      storage,
      contract,
      contract.executedStoredFile,
      client?.businessName,
    );
    const download = await storage.createPresignedDownloadUrl(executed.storageKey, 300, {
      downloadFileName: executed.downloadFileName,
      contentType: EXECUTED_CONTRACT_MIME_TYPE,
    });
    return { url: download.url, expiresInSeconds: download.expiresInSeconds };
  }
  @Get('clients/:clientId/documents') async listDocuments(@Req() request: Request, @Param('clientId') clientId: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    return this.requirePrisma().cfDocument.findMany({ where: { organizationId: orgId, clientId }, orderBy: { createdAt: 'desc' } });
  }
  @Post('clients/:clientId/documents/upload-intent') async createUploadIntent(@Req() request: Request, @Param('clientId') clientId: string, @Body() body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const storage = this.requireStorage();
    storage.assertEnabled();
    const client = await this.requirePrisma().cfClient.findFirst({ where: { id: clientId, organizationId: orgId, isArchived: false } });
    if (!client) throw new NotFoundException('Client not found.');
    const originalFileName = String(body.name ?? 'upload.bin');
    const mimeType = String(body.type ?? 'application/octet-stream');
    const sizeBytes = Number(body.byteSize ?? 0);
    const safeName = sanitizeStorageName(originalFileName, 'upload.bin');
    const storageKey = `client-documents/${orgId}/${clientId}/${Date.now()}-${randomBytes(8).toString('hex')}-${safeName}`;
    const upload = await storage.createPresignedUploadUrl(storageKey, mimeType);
    const storedFile = await this.requirePrisma().cfStoredFile.create({
      data: {
        organizationId: orgId,
        storageKey,
        originalFileName,
        mimeType,
        sizeBytes,
        status: 'REQUESTED',
        uploadedByUserId: admin.id,
      },
    });
    const document = await this.requirePrisma().cfDocument.create({
      data: {
        organizationId: orgId,
        clientId,
        enrollmentId: await assertEnrollmentForClient(
          this.requirePrisma(),
          orgId,
          body.enrollmentId ? String(body.enrollmentId) : null,
          clientId,
        ),
        name: originalFileName,
        type: mimeType,
        url: '',
        storedFileId: storedFile.id,
        objectKey: storageKey,
        byteSize: sizeBytes,
        uploadStatus: 'pending',
        uploadedBy: admin.email,
        isDemo: client.isDemo,
      },
    });
    return { document, storedFile, uploadUrl: upload.url, expiresInSeconds: upload.expiresInSeconds };
  }
  @Post('documents/:id/complete-upload') async completeUpload(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const document = await this.requirePrisma().cfDocument.findFirst({ where: { id, organizationId: orgId } });
    if (!document) throw new NotFoundException('Document not found.');
    if (!document.storedFileId) throw new BadRequestException('Document is not linked to a stored file.');
    const storage = this.requireStorage();
    storage.assertEnabled();
    const storedFile = await this.requirePrisma().cfStoredFile.findFirst({
      where: { id: document.storedFileId, organizationId: orgId },
    });
    if (!storedFile) throw new NotFoundException('Stored file not found.');
    const exists = await storage.objectExists(storedFile.storageKey);
    if (!exists) throw new BadRequestException('Uploaded file bytes were not found in storage.');
    await this.requirePrisma().cfStoredFile.update({
      where: { id: storedFile.id },
      data: { status: 'READY', completedAt: new Date() },
    });
    const completed = await this.requirePrisma().cfDocument.update({
      where: { id: document.id },
      data: {
        url: storage.getObjectPublicUrl(storedFile.storageKey) ?? '',
        objectKey: storedFile.storageKey,
        byteSize: storedFile.sizeBytes,
        uploadStatus: 'ready',
      },
    });
    // A document filed for an enrollment triggers that program's rules; one filed on the client
    // triggers the rules of each program the client is still in. Only the first completion counts.
    if (document.uploadStatus !== 'ready') {
      const enrollments = await this.requirePrisma().cfProgramEnrollment.findMany({
        where: document.enrollmentId
          ? { id: document.enrollmentId, organizationId: orgId }
          : { organizationId: orgId, clientId: document.clientId, status: { notIn: ['completed', 'declined', 'withdrawn'] } },
        select: { id: true, programId: true },
      });
      if (enrollments.length) {
        await this.fireTrigger({
          organizationId: orgId,
          clientId: document.clientId,
          trigger: 'document.uploaded',
          programIds: enrollments.map((enrollment) => enrollment.programId),
          enrollmentIdsByProgramId: Object.fromEntries(enrollments.map((enrollment) => [enrollment.programId, enrollment.id])),
          idempotencySeed: `compat.document.uploaded:${document.id}`,
          payload: { documentId: document.id, documentType: document.type },
        });
      }
    }
    return completed;
  }
  @Get('documents/:id/download') async downloadDocument(@Req() request: Request, @Param('id') id: string) {
    const { orgId } = await this.requireOrgFromRequest(request);
    const document = await this.requirePrisma().cfDocument.findFirst({ where: { id, organizationId: orgId } });
    if (!document) throw new NotFoundException('Document not found.');
    if (!document.storedFileId) throw new BadRequestException('Document is not linked to a stored file.');
    const storedFile = await this.requirePrisma().cfStoredFile.findFirst({
      where: { id: document.storedFileId, organizationId: orgId },
    });
    if (!storedFile) throw new NotFoundException('Stored file not found.');
    const download = await this.requireStorage().createPresignedDownloadUrl(storedFile.storageKey, 300);
    return { url: download.url, expiresInSeconds: download.expiresInSeconds };
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
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    const prisma = this.requirePrisma();
    const client = await findClientForOrg(prisma, orgId, clientId, { includeArchived: true });
    // The report belongs to an enrollment when one is given (its program is the report's program).
    const enrollment = typeof body.enrollmentId === 'string' && body.enrollmentId
      ? await findEnrollmentForOrg(prisma, orgId, body.enrollmentId, { clientId: client.id })
      : null;
    const programId = enrollment?.programId
      ?? (typeof body.programId === 'string' && body.programId ? (await findProgramForOrg(prisma, orgId, body.programId)).id : '');
    const decision = String(body.archiveDecision ?? '');
    const actorName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email;
    return prisma.$transaction(async (transaction) => {
      const report = await transaction.cfFinalReport.create({ data: { organizationId: orgId, clientId: client.id, enrollmentId: enrollment?.id ?? null, programId, startDate: String(body.startDate ?? ''), endDate: String(body.endDate ?? ''), originalNeed: String(body.originalNeed ?? ''), supportProvided: String(body.supportProvided ?? ''), fundingProvided: String(body.fundingProvided ?? ''), milestonesCompleted: String(body.milestonesCompleted ?? ''), resultsAchieved: String(body.resultsAchieved ?? ''), issuesEncountered: String(body.issuesEncountered ?? ''), staffComments: String(body.staffComments ?? ''), clientOutcome: String(body.clientOutcome ?? ''), recommendedNextSteps: String(body.recommendedNextSteps ?? ''), archiveDecision: decision, isDemo: client.isDemo } });
      // The archive decision takes effect with the report (complete / withdraw / archive).
      const outcome = await applyFinalReportDecision(transaction, {
        organizationId: orgId,
        clientId: client.id,
        enrollmentId: enrollment?.id ?? null,
        decision,
        actor: { id: admin.id, name: actorName },
      });
      return { ...report, outcome };
    });
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
    const client = await findClientForOrg(this.requirePrisma(), orgId, String(body.clientId ?? ''), { includeArchived: true });
    return this.requirePrisma().cfActivityLog.create({ data: { organizationId: orgId, clientId: client.id, action: String(body.action ?? 'NOTE'), description: String(body.description ?? ''), user: String(body.user ?? 'system') } });
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
    const { admin } = await this.requireOrgFromRequest(request);
    requireManager(admin);
    return { seeded: {}, liveMode: false };
  }
  @Post('remove-demo') async removeDemo(@Req() request: Request, @Body() _body: Record<string, unknown>) {
    const { orgId, admin } = await this.requireOrgFromRequest(request);
    requireManager(admin);
    await this.requirePrisma().organization.update({ where: { id: orgId }, data: { liveMode: true } });
    return { liveMode: true, demoRemovedAt: new Date().toISOString(), principalAdminId: null, removed: {} };
  }
}

/*
 * Explicit write allowlists for generic PATCH/POST routes (docs/ARCHITECTURE_RULES.md rule 5).
 * Identifiers, ownership columns, tokens and demo flags are never listed.
 */
const PROGRAM_UPDATE_FIELDS: FieldSpec = {
  name: 'string',
  description: 'string',
  isActive: 'boolean',
  financialTrackingEnabled: 'boolean',
  defaultFormTemplateId: 'string',
  defaultMonitoringFrequency: 'string',
  defaultContractTemplateId: 'string',
  defaultWorkflow: 'stringArray',
  requiredDocuments: 'stringArray',
  statusPipeline: 'stringArray',
  welcomeMessage: 'nullableString',
};

const ENROLLMENT_UPDATE_FIELDS: FieldSpec = {
  assignedUserId: 'nullableString',
  assignedStaff: 'nullableString',
  startDate: 'nullableDate',
  nextAction: 'nullableString',
  nextActionDate: 'nullableDate',
  progressPercentage: 'int',
  targetCompletionDate: 'nullableDate',
  currentGoalId: 'nullableString',
  clientResponsiveness: { oneOf: ['responsive', 'inconsistent', 'unresponsive', 'unknown'] },
  currentBlockers: 'nullableString',
  riskLevel: { oneOf: ['low', 'medium', 'high', 'critical'] },
  staffProgressNotes: 'nullableString',
  meetingsAttended: 'int',
  outcomeAchieved: { oneOf: ['yes', 'partial', 'no', 'pending'] },
  finalOutcomeSummary: 'nullableString',
  onHoldReason: 'nullableString',
};

const FORM_TEMPLATE_UPDATE_FIELDS: FieldSpec = {
  name: 'string',
  description: 'string',
  fields: 'jsonArray',
  emailTemplate: 'string',
  internalNotes: 'nullableString',
  dueInDays: 'int',
  isActive: 'boolean',
  sortOrder: 'int',
  scope: { oneOf: ['master_core', 'program_section'] },
  programId: 'nullableString',
};

const FORM_ASSIGNMENT_UPDATE_FIELDS: FieldSpec = {
  status: {
    oneOf: ['draft', 'sent', 'delivered', 'opened', 'in_progress', 'submitted', 'under_review', 'approved', 'cancelled', 'expired'],
  },
  responses: 'jsonObject',
  editHistory: 'jsonArray',
  startedAt: 'nullableDate',
  submittedAt: 'nullableDate',
  cancelledAt: 'nullableDate',
};

const TERMS_UPDATE_FIELDS: FieldSpec = {
  supportType: 'string',
  fundingAmount: 'number',
  resourceDescription: 'string',
  grantAmount: 'number',
  loanAmount: 'number',
  investmentAmount: 'number',
  forgivableAmount: 'number',
  repaymentRequired: 'boolean',
  repaymentSchedule: 'string',
  interestDescription: 'string',
  milestones: 'string',
  reportingRequirements: 'string',
  startDate: 'string',
  endDate: 'string',
  monitoringFrequency: 'string',
  specialConditions: 'string',
  approvalStatus: 'string',
};

/** Client columns staff may set when creating a client (workflow/ownership columns are server-set). */
const CLIENT_CREATE_FIELDS: FieldSpec = {
  website: 'nullableString',
  profileType: 'nullableString',
  relationshipType: 'nullableString',
  assignedUserId: 'nullableString',
  source: 'nullableString',
  nextFollowUpDate: 'nullableDate',
  convertedAt: 'nullableDate',
  snapchat: 'jsonObject',
};

/** The organization settings staff may change. Anything else in the request body is ignored. */
function pickOrganizationSettings(body: Record<string, unknown>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const key of ['replyToEmail', 'defaultMonitoringFrequency', 'timezone', 'currency'] as const) {
    if (typeof body[key] === 'string') settings[key] = (body[key] as string).trim();
  }
  if (body.logoStoredFileId === null || typeof body.logoStoredFileId === 'string') {
    settings.logoStoredFileId = body.logoStoredFileId;
  }
  for (const key of ['features', 'notificationTemplateToggles'] as const) {
    const value = body[key];
    if (isRecord(value)) {
      settings[key] = Object.fromEntries(
        Object.entries(value).filter(([, flag]) => typeof flag === 'boolean'),
      );
    }
  }
  return settings;
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
    private readonly intake?: IntakeWorkflowService,
  ) {}

  private requirePrisma(): PrismaService {
    if (!this.prisma) throw this.scaffold.notImplemented('Public forms');
    return this.prisma;
  }

  private requireIntake(): IntakeWorkflowService {
    if (!this.intake) throw this.scaffold.notImplemented('Public form submission');
    return this.intake;
  }

  @Get(':token') async getForm(@Param('token') token: string) {
    // Adapter: link rules (cancelled / expired / archived client) live in forms/public-form-link.
    const { assignment: formAssignment, client, template } = await resolvePublicFormLink(this.requirePrisma(), token, 'view');

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

  /** Adapter: translates the form page's request and hands it to the intake workflow. */
  @Post(':token/submit') async submitForm(@Param('token') token: string, @Body() body: Record<string, unknown>) {
    const result = await this.requireIntake().submit(token, {
      coreResponses: isRecord(body.coreResponses) ? body.coreResponses : {},
      programResponses: isRecord(body.programResponses)
        ? body.programResponses as Record<string, Record<string, unknown>>
        : {},
      selectedProgramIds: Array.isArray(body.selectedProgramIds)
        ? body.selectedProgramIds.filter((id): id is string => typeof id === 'string')
        : [],
      configurationToken: typeof body.configurationToken === 'string' ? body.configurationToken : undefined,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    });
    return {
      success: true,
      enrollmentIds: result.enrollmentIds,
      automation: result.automation,
      ...(result.replayed ? { replayed: true } : {}),
    };
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

  @Throttle(SIGN_IN_LIMIT) @Post('login') async login(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
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

  @Throttle(SIGN_IN_LIMIT) @Post('accept-invite') async acceptInvite(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
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
    requireManager(await this.requireOrgAccess(request, orgId));
    const existing = await this.requirePrisma().organization.findUnique({ where: { id: orgId } });
    if (!existing) throw new NotFoundException('Organization not found.');
    const currentSettings = isRecord(existing.settings) ? existing.settings as Record<string, unknown> : {};
    const changes = pickOrganizationSettings(body);
    if (typeof changes.logoStoredFileId === 'string') {
      await findStoredFileForOrg(this.requirePrisma(), orgId, changes.logoStoredFileId);
    }
    const nextSettings: Record<string, unknown> = { ...currentSettings, ...changes };
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
    const updated = await this.requirePrisma().organization.update({ where: { id: orgId }, data: { name, settings: nextSettings as any } });
    return { id: updated.id, name: updated.name, settings: nextSettings, liveMode: updated.liveMode, demoRemovedAt: updated.demoRemovedAt, principal: null };
  }

  @Get(':orgId/members') async listMembers(@Req() request: Request, @Param('orgId') orgId: string) {
    await this.requireOrgAccess(request, orgId);
    const members = await this.requirePrisma().adminUser.findMany({ where: { organizationId: orgId }, select: { id: true, email: true, firstName: true, lastName: true, jobTitle: true, role: true, isActive: true, createdAt: true, invitation: { select: { acceptedAt: true, revokedAt: true } } }, orderBy: { createdAt: 'asc' } });
    return members.map((member) => ({ id: member.id, email: member.email, firstName: member.firstName, lastName: member.lastName, jobTitle: member.jobTitle, role: member.role, isActive: member.isActive, createdAt: member.createdAt.toISOString(), invitePending: !member.invitation || (!member.invitation.acceptedAt && !member.invitation.revokedAt), isPrincipal: false }));
  }

  @Post(':orgId/invitations') async inviteMember(@Req() request: Request, @Param('orgId') orgId: string, @Body() body: Record<string, unknown>) {
    const actor = await this.requireOrgAccess(request, orgId);
    const role = body.role === undefined ? 'reviewer' : parseRole(body.role);
    assertCanGrantRole(actor, role);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required.');
    const existing = await this.requirePrisma().adminUser.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with this email already exists.');
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plainToken).digest('hex');
    const randomPasswordHash = await hash(randomBytes(32).toString('hex'), 12);
    await this.requirePrisma().adminUser.create({ data: { organizationId: orgId, email, firstName: String(body.firstName ?? ''), lastName: body.lastName ? String(body.lastName) : null, jobTitle: body.jobTitle ? String(body.jobTitle) : null, passwordHash: randomPasswordHash, role, isActive: false, invitation: { create: { tokenHash, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) } } } });
    return { message: `Invitation sent to ${email}.` };
  }

  @Post(':orgId/invitations/:memberId/revoke') async revokeInvite(@Req() request: Request, @Param('orgId') orgId: string, @Param('memberId') memberId: string) {
    const actor = await this.requireOrgAccess(request, orgId);
    const invitation = await this.requirePrisma().adminInvitation.findFirst({
      where: { adminUserId: memberId, adminUser: { organizationId: orgId } },
      include: { adminUser: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    assertCanManageMember(actor, invitation.adminUser);
    if (invitation.acceptedAt || invitation.revokedAt) throw new BadRequestException('Only pending invitations can be revoked.');
    await this.requirePrisma().$transaction([
      this.requirePrisma().adminInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } }),
      this.requirePrisma().adminUser.delete({ where: { id: memberId, organizationId: orgId } }),
    ]);
    return { message: `Invitation to ${invitation.adminUser.email} revoked.` };
  }

  @Patch(':orgId/members/:memberId/role') async updateMemberRole(@Req() request: Request, @Param('orgId') orgId: string, @Param('memberId') memberId: string, @Body() body: Record<string, unknown>) {
    const actor = await this.requireOrgAccess(request, orgId);
    const member = await this.requirePrisma().adminUser.findFirst({ where: { id: memberId, organizationId: orgId } });
    if (!member) throw new NotFoundException('Member not found.');
    assertCanManageMember(actor, member);
    const role = parseRole(body.role);
    assertCanGrantRole(actor, role);
    const updated = await this.requirePrisma().adminUser.update({ where: { id: memberId, organizationId: orgId }, data: { role }, select: { id: true, email: true, role: true } });
    return { id: updated.id, email: updated.email, role: updated.role };
  }

  @Post(':orgId/members/:memberId/disable') async disableMember(@Req() request: Request, @Param('orgId') orgId: string, @Param('memberId') memberId: string) {
    const actor = await this.requireOrgAccess(request, orgId);
    const member = await this.requirePrisma().adminUser.findFirst({ where: { id: memberId, organizationId: orgId } });
    if (!member) throw new NotFoundException('Member not found.');
    assertCanManageMember(actor, member);
    await this.requirePrisma().adminUser.update({ where: { id: memberId, organizationId: orgId }, data: { isActive: false } });
    return { message: 'Member disabled.' };
  }

  @Post(':orgId/members/:memberId/enable') async enableMember(@Req() request: Request, @Param('orgId') orgId: string, @Param('memberId') memberId: string) {
    const actor = await this.requireOrgAccess(request, orgId);
    const member = await this.requirePrisma().adminUser.findFirst({ where: { id: memberId, organizationId: orgId } });
    if (!member) throw new NotFoundException('Member not found.');
    assertCanManageMember(actor, member);
    await this.requirePrisma().adminUser.update({ where: { id: memberId, organizationId: orgId }, data: { isActive: true } });
    return { message: 'Member enabled.' };
  }
}

@Controller('api-boundary')
export class FutureApiBoundaryController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @All('*') futureBoundary() { return this.scaffold.notImplemented('Normalized ClientFlow API'); }
}

const MAX_LIST_PAGE = 500;


/**
 * `?limit=&offset=` for the org-wide lists the app pages through. Without a limit the whole list is
 * returned (older callers); with one, pages are bounded so a client loop always terminates.
 */
function listPage(limit?: string, offset?: string): { take?: number; skip?: number } {
  if (limit === undefined) return {};
  const parsedLimit = Number.parseInt(limit, 10);
  const parsedOffset = Number.parseInt(offset ?? '0', 10);
  return {
    take: Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), MAX_LIST_PAGE) : MAX_LIST_PAGE,
    skip: Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0,
  };
}
