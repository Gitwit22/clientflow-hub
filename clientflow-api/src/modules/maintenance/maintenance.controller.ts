import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
  requireAdmin,
} from '../../common/guards/clientflow-auth.guard';
import { LegacyDataService } from './legacy-data.service';

@ApiTags('maintenance')
@Controller('maintenance/legacy-data')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class MaintenanceController {
  constructor(private readonly legacyData: LegacyDataService) {}

  @Get()
  @ApiOperation({ summary: 'Preview the legacy data cleanup (changes nothing)' })
  @ApiOkResponse({ description: 'What the cleanup would remove, cancel, keep and link.' })
  preview(@Req() request: AuthenticatedRequest) {
    const admin = requireAdmin(request);
    return this.legacyData.preview(admin.organizationId, admin);
  }

  @Post('apply')
  @ApiOperation({
    summary: 'Apply the legacy data cleanup',
    description: 'Removes unsent placeholder contracts, cancels sent ones, links pre-enrollment records and clears rows of deleted clients. Idempotent.',
  })
  @ApiOkResponse({ description: 'What was changed.' })
  apply(@Req() request: AuthenticatedRequest) {
    const admin = requireAdmin(request);
    return this.legacyData.apply(admin.organizationId, admin);
  }
}
