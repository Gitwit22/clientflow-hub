import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthenticatedRequest, ClientflowAuthGuard } from '../../common/guards/clientflow-auth.guard';
import { FinalReportsService } from './final-reports.service';

/** Final reports: drafts staff can edit, then finalize. The organization comes from the session. */
@ApiTags('final reports')
@Controller('final-reports')
@UseGuards(ClientflowAuthGuard)
export class FinalReportsController {
  constructor(private readonly reports: FinalReportsService) {}

  /** Saves a new draft. Changes nothing else (participation, billing, checklists). */
  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.reports.createDraft(request.adminUser!.organizationId, typeof body?.clientId === 'string' ? body.clientId : '', body ?? {});
  }

  @Get(':reportId')
  get(@Req() request: AuthenticatedRequest, @Param('reportId') reportId: string) {
    return this.reports.get(request.adminUser!.organizationId, reportId);
  }

  /** Edits a draft's written sections. A finalized report is read-only (409). */
  @Patch(':reportId')
  update(@Req() request: AuthenticatedRequest, @Param('reportId') reportId: string, @Body() body: Record<string, unknown>) {
    return this.reports.updateDraft(request.adminUser!.organizationId, reportId, body ?? {});
  }

  /**
   * Finalizes the report (keeps a snapshot) and archives the client's participation in its program.
   * Body: { outcome, confirm: true }, optionally with the last edits to the written sections.
   */
  @Post(':reportId/finalize')
  finalize(@Req() request: AuthenticatedRequest, @Param('reportId') reportId: string, @Body() body: Record<string, unknown>) {
    return this.reports.finalize(
      request.adminUser!.organizationId,
      { id: request.adminUser?.id ?? null, displayName: request.adminUser?.displayName ?? 'staff' },
      reportId,
      body ?? {},
    );
  }
}
