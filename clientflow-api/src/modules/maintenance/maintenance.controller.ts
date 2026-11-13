import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
  requireAdmin,
} from '../../common/guards/clientflow-auth.guard';
import { LegacyDataService } from './legacy-data.service';
import { LogoStorageService } from './logo-storage.service';

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

@ApiTags('maintenance')
@Controller('maintenance/logo-storage')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class LogoStorageController {
  constructor(private readonly logoStorage: LogoStorageService) {}

  @Get()
  @ApiOperation({ summary: 'Which bucket holds the email header logo (changes nothing)' })
  @ApiOkResponse({ description: 'no_logo, private_bucket or public_bucket, and whether the public bucket is configured.' })
  status(@Req() request: AuthenticatedRequest) {
    const admin = requireAdmin(request);
    return this.logoStorage.status(admin.organizationId, admin);
  }

  @Post('move-to-public')
  @ApiOperation({
    summary: 'Move the email header logo to the public assets bucket',
    description: 'Copies the logo into the public assets bucket and switches its record once the copy is verified. Idempotent.',
  })
  @ApiOkResponse({ description: 'The logo storage status after the move.' })
  moveToPublic(@Req() request: AuthenticatedRequest) {
    const admin = requireAdmin(request);
    return this.logoStorage.moveToPublic(admin.organizationId, admin);
  }
}
