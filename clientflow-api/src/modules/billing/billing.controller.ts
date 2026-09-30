import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
} from '../../common/guards/clientflow-auth.guard';
import { parseIdempotencyKey } from '../communications/communication-attempts';
import { BillingDashboardService } from './billing-dashboard.service';
import { parseOrgDate, parseOrgDateEnd, type CalendarPeriodKind } from './billing-schedule.util';
import { BillingService } from './billing.service';
import { BackfillSelectionDto } from './dto/backfill-selection.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ReplaceAgreementDto } from './dto/replace-agreement.dto';
import { UpsertProgramBillingConfigDto } from './dto/upsert-program-billing-config.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';

function actorFrom(request: AuthenticatedRequest) {
  return {
    actorUserId: request.adminUser?.id ?? null,
    actorDisplayName: request.adminUser?.displayName ?? 'Unknown',
  };
}

function toSelection(dto: BackfillSelectionDto, timezone: string) {
  return {
    paidThroughDate: dto.paidThroughDate ? parseOrgDateEnd(dto.paidThroughDate, timezone) : undefined,
    periods: dto.periods?.map((period) => ({ start: new Date(period.start), end: new Date(period.end) })),
  };
}

@ApiTags('billing')
@Controller('programs/:programId/billing-config')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class ProgramBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  async get(@Req() request: AuthenticatedRequest, @Param('programId') programId: string) {
    const organizationId = request.adminUser!.organizationId;
    await this.billing.requireProgramForOrg(organizationId, programId);
    return this.billing.getOrCreateProgramConfig(organizationId, programId);
  }

  @Patch()
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Body() dto: UpsertProgramBillingConfigDto,
  ) {
    const organizationId = request.adminUser!.organizationId;
    await this.billing.requireProgramForOrg(organizationId, programId);
    return this.billing.updateProgramConfig(organizationId, programId, dto);
  }
}

@ApiTags('billing')
@Controller('clients/:clientId/enrollments/:enrollmentId/billing')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class EnrollmentBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  async getSummary(
    @Req() request: AuthenticatedRequest,
    @Param('clientId') clientId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    const organizationId = request.adminUser!.organizationId;
    await this.billing.requireEnrollmentForClient(organizationId, clientId, enrollmentId);
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    return this.billing.getEnrollmentBillingSummary(organizationId, enrollmentId, timezone);
  }

  @Get('periods')
  async getPeriods(
    @Req() request: AuthenticatedRequest,
    @Param('clientId') clientId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Query('throughDate') throughDate?: string,
  ) {
    const organizationId = request.adminUser!.organizationId;
    await this.billing.requireEnrollmentForClient(organizationId, clientId, enrollmentId);
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    return this.billing.listOpenPeriods(
      organizationId,
      enrollmentId,
      timezone,
      throughDate ? parseOrgDateEnd(throughDate, timezone) : undefined,
    );
  }

  @Post('agreement')
  async replaceAgreement(
    @Req() request: AuthenticatedRequest,
    @Param('clientId') clientId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: ReplaceAgreementDto,
  ) {
    const organizationId = request.adminUser!.organizationId;
    await this.billing.requireEnrollmentForClient(organizationId, clientId, enrollmentId);
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    return this.billing.replaceAgreement({
      organizationId,
      enrollmentId,
      amount: dto.amount,
      frequency: dto.frequency,
      customIntervalDays: dto.customIntervalDays ?? null,
      startDate: parseOrgDate(dto.startDate, timezone),
      defaultDueDay: dto.defaultDueDay ?? null,
      timezone,
      ...actorFrom(request),
    });
  }

  @Post('payments')
  async recordPayment(
    @Req() request: AuthenticatedRequest,
    @Param('clientId') clientId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: RecordPaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const organizationId = request.adminUser!.organizationId;
    await this.billing.requireEnrollmentForClient(organizationId, clientId, enrollmentId);
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    return this.billing.recordPayment({
      organizationId,
      enrollmentId,
      amount: dto.amount,
      paymentDate: parseOrgDate(dto.paymentDate, timezone),
      paymentMethod: dto.paymentMethod,
      billingPeriodStart: parseOrgDate(dto.billingPeriodStart, timezone),
      billingPeriodEnd: parseOrgDate(dto.billingPeriodEnd, timezone),
      note: dto.note ?? null,
      timezone,
      idempotencyKey: parseIdempotencyKey(idempotencyKey),
      ...actorFrom(request),
    });
  }

  @Post('backfill/preview')
  async previewBackfill(
    @Req() request: AuthenticatedRequest,
    @Param('clientId') clientId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: BackfillSelectionDto,
  ) {
    const organizationId = request.adminUser!.organizationId;
    await this.billing.requireEnrollmentForClient(organizationId, clientId, enrollmentId);
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    return this.billing.previewBackfill(organizationId, enrollmentId, timezone, toSelection(dto, timezone));
  }

  @Post('backfill/confirm')
  async confirmBackfill(
    @Req() request: AuthenticatedRequest,
    @Param('clientId') clientId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: BackfillSelectionDto,
  ) {
    const organizationId = request.adminUser!.organizationId;
    await this.billing.requireEnrollmentForClient(organizationId, clientId, enrollmentId);
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    const actor = actorFrom(request);
    return this.billing.confirmBackfill(
      organizationId,
      enrollmentId,
      timezone,
      toSelection(dto, timezone),
      actor.actorUserId,
      actor.actorDisplayName,
    );
  }
}

@ApiTags('billing')
@Controller('billing')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class BillingDashboardController {
  constructor(
    private readonly billing: BillingService,
    private readonly dashboard: BillingDashboardService,
  ) {}

  @Get('dashboard')
  async getDashboard(@Req() request: AuthenticatedRequest, @Query('period') period?: string) {
    const organizationId = request.adminUser!.organizationId;
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    const kind: CalendarPeriodKind = period === 'quarter' || period === 'year' ? period : 'month';
    return this.dashboard.getOrgDashboard(organizationId, timezone, kind);
  }

  @Patch('payments/:paymentId/void')
  async voidPayment(
    @Req() request: AuthenticatedRequest,
    @Param('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDto,
  ) {
    const organizationId = request.adminUser!.organizationId;
    const actor = actorFrom(request);
    return this.billing.voidPayment(organizationId, paymentId, dto.reason, actor.actorUserId, actor.actorDisplayName);
  }
}
