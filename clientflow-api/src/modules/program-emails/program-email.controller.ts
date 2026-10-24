import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
} from '../../common/guards/clientflow-auth.guard';
import { parseIdempotencyKey } from '../communications/communication-attempts';
import { ProgramEmailService, type ProgramEmailActor } from './program-email.service';

function actorFrom(request: AuthenticatedRequest): ProgramEmailActor {
  return { id: request.adminUser?.id ?? null, displayName: request.adminUser?.displayName ?? 'staff' };
}

/** Program-wide emails. The organization always comes from the session; admins only. */
@ApiTags('program emails')
@Controller()
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class ProgramEmailController {
  constructor(private readonly emails: ProgramEmailService) {}

  /** Who would receive it now, and who would be skipped and why. */
  @Get('programs/:programId/emails/recipients')
  recipients(@Req() request: AuthenticatedRequest, @Param('programId') programId: string) {
    return this.emails.previewRecipients(request.adminUser!.organizationId, programId);
  }

  @Get('programs/:programId/emails')
  list(@Req() request: AuthenticatedRequest, @Param('programId') programId: string) {
    return this.emails.list(request.adminUser!.organizationId, programId);
  }

  /** Records the email and starts sending; answers before sending finishes. Without clientIds it goes to every member. */
  @Post('programs/:programId/emails')
  @HttpCode(202)
  create(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { subject?: unknown; body?: unknown; clientIds?: unknown },
  ) {
    return this.emails.create(request.adminUser!.organizationId, actorFrom(request), programId, {
      subject: body?.subject,
      body: body?.body,
      clientIds: body?.clientIds,
      idempotencyKey: parseIdempotencyKey(idempotencyKey),
    });
  }

  @Get('program-emails/:emailId')
  get(@Req() request: AuthenticatedRequest, @Param('emailId') emailId: string) {
    return this.emails.get(request.adminUser!.organizationId, emailId);
  }

  /** Sends again to the recipients that failed; recipients already accepted are left alone. */
  @Post('program-emails/:emailId/retry')
  @HttpCode(202)
  retry(@Req() request: AuthenticatedRequest, @Param('emailId') emailId: string) {
    return this.emails.retryFailed(request.adminUser!.organizationId, emailId);
  }
}
