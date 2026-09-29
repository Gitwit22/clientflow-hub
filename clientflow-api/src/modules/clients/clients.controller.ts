import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
  requireAdmin,
} from '../../common/guards/clientflow-auth.guard';
import { parseIdempotencyKey } from '../communications/communication-attempts';
import { ContractsService } from '../contracts/contracts.service';
import { DeclineReviewDto } from '../contracts/dto/decline-review.dto';
import { ClientDeletionService } from './client-deletion.service';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { PermanentDeleteClientDto } from './dto/permanent-delete-client.dto';
import { UpdateClientProgramDto } from './dto/update-client-program.dto';

@ApiTags('clients')
@Controller('clients')
@UseGuards(ClientflowAuthGuard)
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly contracts: ContractsService,
    private readonly deletion: ClientDeletionService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a client and send the General Intake form' })
  @ApiCreatedResponse({
    description: 'Client and intake assignment created. n8n delivery may be sent, skipped, or failed.',
  })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateClientDto) {
    return this.clients.create(requireAdmin(request).organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List clients for an organization, optionally filtered by status' })
  @ApiOkResponse({ description: 'Safe client summaries.' })
  list(@Req() request: AuthenticatedRequest, @Query('status') status?: string) {
    return this.clients.list(requireAdmin(request).organizationId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a client with its current program, contract and monitoring task' })
  @ApiOkResponse({ description: 'Safe client detail.' })
  getOne(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.clients.getOne(requireAdmin(request).organizationId, id);
  }

  @Patch(':id/program')
  @ApiOperation({ summary: "Correct a client's selected program and re-run the contract rule engine" })
  @ApiOkResponse({ description: 'The re-evaluated contract rule outcome for the corrected program.' })
  updateProgram(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() dto: UpdateClientProgramDto) {
    const admin = requireAdmin(request);
    return this.clients.updateProgram(admin.organizationId, id, dto.programId, { id: admin.id, name: admin.displayName });
  }

  @Post(':id/intake/send')
  @ApiOperation({ summary: 'Send a deferred intake email for a client' })
  @ApiOkResponse({ description: 'Non-fatal email delivery result.' })
  sendIntakeNow(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const admin = requireAdmin(request);
    return this.clients.sendIntakeNow(admin.organizationId, id, {
      actor: { id: admin.id, name: admin.displayName },
      idempotencyKey: parseIdempotencyKey(idempotencyKey),
    });
  }

  @Post(':id/review/approve')
  @UseGuards(ClientflowAdminOnlyGuard)
  @ApiOperation({ summary: 'Approve a staff-review client, sign for the organization, and issue its contract' })
  @ApiOkResponse({ description: 'Contract issue metadata and non-fatal email delivery result.' })
  approveReview(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    // Needed only when the client has more than one enrollment awaiting review.
    @Query('enrollmentId') enrollmentId?: string,
  ) {
    // Older clients may still send staffSigner* fields in the body; the signer is always the
    // signed-in admin, so the body is not read.
    const admin = requireAdmin(request);
    return this.contracts.approveReview(admin.organizationId, id, { id: admin.id, name: admin.displayName }, { enrollmentId: enrollmentId || null });
  }

  @Post(':id/review/decline')
  @UseGuards(ClientflowAdminOnlyGuard)
  @ApiOperation({ summary: 'Decline a staff-review client without creating a contract' })
  @ApiOkResponse({ description: 'The updated client status.' })
  declineReview(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: DeclineReviewDto,
    @Query('enrollmentId') enrollmentId?: string,
  ) {
    const admin = requireAdmin(request);
    return this.contracts.declineReview(admin.organizationId, id, dto.reason, {
      enrollmentId: enrollmentId || null,
      actor: { id: admin.id, name: admin.displayName },
    });
  }

  @Delete(':id/permanent')
  @UseGuards(ClientflowAdminOnlyGuard)
  @ApiOperation({
    summary: 'Permanently erase a client and everything recorded for them, including payments',
    description: 'Irreversible. Archive instead to keep the record and its financial history.',
  })
  @ApiOkResponse({ description: 'Row counts removed per table; no client details.' })
  permanentlyDelete(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: PermanentDeleteClientDto,
  ) {
    const admin = requireAdmin(request);
    return this.deletion.permanentlyDelete({
      organizationId: admin.organizationId,
      clientId: id,
      actor: { id: admin.id, role: admin.role },
      confirmation: dto.confirmation,
    });
  }
}
