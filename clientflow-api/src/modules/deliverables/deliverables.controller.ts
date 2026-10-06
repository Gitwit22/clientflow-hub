import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
} from '../../common/guards/clientflow-auth.guard';
import {
  CreateDeliverableTemplateDto,
  ReorderDeliverableTemplatesDto,
  SetProgramDeliverableDateDto,
  UpdateDeliverableTemplateDto,
} from './dto/deliverable-template.dto';
import { UpdateEnrollmentDeliverableDto } from './dto/update-enrollment-deliverable.dto';
import { ProgramDeliverablesService, type DeliverableActor } from './program-deliverables.service';

function actorFrom(request: AuthenticatedRequest): DeliverableActor {
  return { id: request.adminUser?.id ?? null, displayName: request.adminUser?.displayName ?? 'staff' };
}

/** A program's deliverable templates. The organization always comes from the session. */
@ApiTags('program deliverables')
@Controller('programs/:programId/deliverables')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class ProgramDeliverablesController {
  constructor(private readonly deliverables: ProgramDeliverablesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('programId') programId: string) {
    return this.deliverables.listTemplates(request.adminUser!.organizationId, programId);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Body() dto: CreateDeliverableTemplateDto,
  ) {
    return this.deliverables.createTemplate(request.adminUser!.organizationId, programId, dto);
  }

  /** Program-wide deliverables and their date for one month (?month=2026-10). */
  @Get('schedule')
  schedule(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Query('month') month: string,
  ) {
    return this.deliverables.listProgramDates(request.adminUser!.organizationId, programId, String(month ?? ''));
  }

  /** Sets or clears a program-wide deliverable's date for a month, for every member. */
  @Put(':templateId/schedule')
  setDate(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Param('templateId') templateId: string,
    @Body() dto: SetProgramDeliverableDateDto,
  ) {
    return this.deliverables.setProgramDate(request.adminUser!.organizationId, programId, templateId, dto);
  }

  // Declared before ':templateId' so "reorder" is never read as a template id.
  @Post('reorder')
  reorder(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Body() dto: ReorderDeliverableTemplatesDto,
  ) {
    return this.deliverables.reorderTemplates(request.adminUser!.organizationId, programId, dto);
  }

  @Patch(':templateId')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateDeliverableTemplateDto,
  ) {
    return this.deliverables.updateTemplate(request.adminUser!.organizationId, programId, templateId, dto);
  }
}

/** One enrollment's reporting cycles and the deliverables tracked in them. */
@ApiTags('program deliverables')
@Controller('enrollments/:enrollmentId/deliverables')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class EnrollmentDeliverablesController {
  constructor(private readonly deliverables: ProgramDeliverablesService) {}

  /** The current period, created on first use for an active enrollment. */
  @Get('current')
  current(@Req() request: AuthenticatedRequest, @Param('enrollmentId') enrollmentId: string) {
    return this.deliverables.getCurrent(request.adminUser!.organizationId, enrollmentId);
  }

  @Get('history')
  history(@Req() request: AuthenticatedRequest, @Param('enrollmentId') enrollmentId: string) {
    return this.deliverables.listHistory(request.adminUser!.organizationId, enrollmentId);
  }

  @Get('cycles/:cycleId')
  cycle(
    @Req() request: AuthenticatedRequest,
    @Param('enrollmentId') enrollmentId: string,
    @Param('cycleId') cycleId: string,
  ) {
    return this.deliverables.getCycle(request.adminUser!.organizationId, enrollmentId, cycleId);
  }

  @Post('cycles/:cycleId/finalize')
  finalize(
    @Req() request: AuthenticatedRequest,
    @Param('enrollmentId') enrollmentId: string,
    @Param('cycleId') cycleId: string,
  ) {
    return this.deliverables.finalizeCycle(request.adminUser!.organizationId, actorFrom(request), enrollmentId, cycleId);
  }

  @Patch(':deliverableId')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('enrollmentId') enrollmentId: string,
    @Param('deliverableId') deliverableId: string,
    @Body() dto: UpdateEnrollmentDeliverableDto,
  ) {
    return this.deliverables.updateDeliverable(
      request.adminUser!.organizationId,
      actorFrom(request),
      enrollmentId,
      deliverableId,
      dto,
    );
  }

  @Post(':deliverableId/set-next-action')
  setNextAction(
    @Req() request: AuthenticatedRequest,
    @Param('enrollmentId') enrollmentId: string,
    @Param('deliverableId') deliverableId: string,
  ) {
    return this.deliverables.setNextAction(request.adminUser!.organizationId, actorFrom(request), enrollmentId, deliverableId);
  }
}
