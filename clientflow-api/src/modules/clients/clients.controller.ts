import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContractsService } from '../contracts/contracts.service';
import { ApproveReviewDto } from '../contracts/dto/approve-review.dto';
import { DeclineReviewDto } from '../contracts/dto/decline-review.dto';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientProgramDto } from './dto/update-client-program.dto';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly contracts: ContractsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a client and send the General Intake form' })
  @ApiCreatedResponse({
    description: 'Client and intake assignment created. n8n delivery may be sent, skipped, or failed.',
  })
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List clients for an organization, optionally filtered by status' })
  @ApiOkResponse({ description: 'Safe client summaries.' })
  list(@Query('organizationId') organizationId: string, @Query('status') status?: string) {
    return this.clients.list(organizationId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a client with its current program, contract and monitoring task' })
  @ApiOkResponse({ description: 'Safe client detail.' })
  getOne(@Param('id') id: string) {
    return this.clients.getOne(id);
  }

  @Patch(':id/program')
  @ApiOperation({ summary: "Correct a client's selected program and re-run the contract rule engine" })
  @ApiOkResponse({ description: 'The re-evaluated contract rule outcome for the corrected program.' })
  updateProgram(@Param('id') id: string, @Body() dto: UpdateClientProgramDto) {
    return this.clients.updateProgram(id, dto.programId);
  }

  @Post(':id/intake/send')
  @ApiOperation({ summary: 'Send a deferred intake email for a client' })
  @ApiOkResponse({ description: 'Non-fatal email delivery result.' })
  sendIntakeNow(@Param('id') id: string) {
    return this.clients.sendIntakeNow(id);
  }

  @Post(':id/review/approve')
  @ApiOperation({ summary: 'Approve a staff-review client, sign for the organization, and issue its contract' })
  @ApiOkResponse({ description: 'Contract issue metadata and non-fatal email delivery result.' })
  approveReview(@Param('id') id: string, @Body() dto: ApproveReviewDto) {
    return this.contracts.approveReview(id, { id: dto.staffSignerId ?? null, name: dto.staffSignerName });
  }

  @Post(':id/review/decline')
  @ApiOperation({ summary: 'Decline a staff-review client without creating a contract' })
  @ApiOkResponse({ description: 'The updated client status.' })
  declineReview(@Param('id') id: string, @Body() dto: DeclineReviewDto) {
    return this.contracts.declineReview(id, dto.reason);
  }
}
