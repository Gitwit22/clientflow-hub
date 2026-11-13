import { Body, Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
  requireAdmin,
} from '../../common/guards/clientflow-auth.guard';
import { parseIdempotencyKey } from '../communications/communication-attempts';
import { CancelAwardDto, CreateAwardDto, RecordAwardPaymentDto, UpdateAwardDto, VoidAwardPaymentDto } from './dto/award.dto';
import { FundingService, type FundingActor } from './funding.service';

function actorFrom(request: AuthenticatedRequest): FundingActor {
  const admin = requireAdmin(request);
  return { actorUserId: admin.id, actorDisplayName: admin.displayName };
}

@ApiTags('funding')
@Controller('clients/:clientId/enrollments/:enrollmentId/awards')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class EnrollmentAwardsController {
  constructor(private readonly funding: FundingService) {}

  @Get()
  @ApiOperation({ summary: "A program participation's funding awards, with payments and balances" })
  list(@Req() request: AuthenticatedRequest, @Param('clientId') clientId: string, @Param('enrollmentId') enrollmentId: string) {
    return this.funding.listForEnrollment(requireAdmin(request).organizationId, clientId, enrollmentId);
  }

  @Post()
  @ApiOperation({ summary: 'Record a funding award for this program participation' })
  create(
    @Req() request: AuthenticatedRequest,
    @Param('clientId') clientId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() dto: CreateAwardDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.funding.create(
      requireAdmin(request).organizationId,
      clientId,
      enrollmentId,
      dto,
      actorFrom(request),
      parseIdempotencyKey(idempotencyKey),
    );
  }
}

@ApiTags('funding')
@Controller()
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class AwardsController {
  constructor(private readonly funding: FundingService) {}

  @Get('awards/:awardId')
  get(@Req() request: AuthenticatedRequest, @Param('awardId') awardId: string) {
    return this.funding.get(requireAdmin(request).organizationId, awardId);
  }

  @Patch('awards/:awardId')
  @ApiOperation({ summary: 'Change an award. Agreement fields need replaceAgreement once an agreement exists.' })
  update(@Req() request: AuthenticatedRequest, @Param('awardId') awardId: string, @Body() dto: UpdateAwardDto) {
    return this.funding.update(requireAdmin(request).organizationId, awardId, dto, actorFrom(request));
  }

  @Post('awards/:awardId/approve')
  approve(@Req() request: AuthenticatedRequest, @Param('awardId') awardId: string) {
    return this.funding.approve(requireAdmin(request).organizationId, awardId, actorFrom(request));
  }

  @Post('awards/:awardId/cancel')
  @ApiOperation({ summary: 'Cancel an award with no recorded payments. An unsigned agreement is cancelled with it.' })
  cancel(@Req() request: AuthenticatedRequest, @Param('awardId') awardId: string, @Body() dto: CancelAwardDto) {
    return this.funding.cancel(requireAdmin(request).organizationId, awardId, dto.reason, actorFrom(request));
  }

  @Post('awards/:awardId/payments')
  @ApiOperation({ summary: 'Record a payment on an award. Never more than what is still owed.' })
  recordPayment(
    @Req() request: AuthenticatedRequest,
    @Param('awardId') awardId: string,
    @Body() dto: RecordAwardPaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.funding.recordPayment(
      requireAdmin(request).organizationId,
      awardId,
      dto,
      actorFrom(request),
      parseIdempotencyKey(idempotencyKey),
    );
  }

  @Patch('award-payments/:paymentId/void')
  @ApiOperation({ summary: 'Void an award payment recorded by mistake (it stays in the ledger)' })
  voidPayment(@Req() request: AuthenticatedRequest, @Param('paymentId') paymentId: string, @Body() dto: VoidAwardPaymentDto) {
    return this.funding.voidPayment(requireAdmin(request).organizationId, paymentId, dto.reason, actorFrom(request));
  }

  @Get('funding/outstanding')
  @ApiOperation({ summary: 'Every award with money still owed, including archived participations' })
  @ApiOkResponse({ description: 'Awards with an outstanding balance, oldest first.' })
  outstanding(@Req() request: AuthenticatedRequest) {
    return this.funding.outstanding(requireAdmin(request).organizationId);
  }
}
