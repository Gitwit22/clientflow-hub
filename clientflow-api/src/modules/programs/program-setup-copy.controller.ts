import { BadRequestException, Body, Controller, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
} from '../../common/guards/clientflow-auth.guard';
import { parseIdempotencyKey } from '../communications/communication-attempts';
import { parseCopyParts, ProgramSetupCopyService, type CopyActor } from './program-setup-copy.service';

function actorOf(request: AuthenticatedRequest): CopyActor {
  const admin = request.adminUser!;
  return { actorUserId: admin.id ?? null, actorDisplayName: admin.displayName ?? 'Unknown', actorEmail: admin.email ?? '' };
}

function sourceProgramIdOf(body: Record<string, unknown>): string {
  if (typeof body.sourceProgramId !== 'string' || !body.sourceProgramId.trim()) {
    throw new BadRequestException('Choose the program to copy from.');
  }
  return body.sourceProgramId.trim();
}

function requiredKey(raw: unknown): string {
  const key = parseIdempotencyKey(raw);
  if (!key) throw new BadRequestException('Idempotency-Key header is required.');
  return key;
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

/** Copying one program's setup into another (organization admins only). */
@ApiTags('programs')
@Controller('programs')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class ProgramSetupCopyController {
  constructor(private readonly copies: ProgramSetupCopyService) {}

  /** What copying into a new program would do. Changes nothing. */
  @Post('setup-copy/preview')
  previewNew(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.copies.preview(request.adminUser!.organizationId, null, sourceProgramIdOf(body), parseCopyParts(body.parts));
  }

  /** Creates a new, inactive program from another program's setup, in one transaction. */
  @Post('from-setup')
  createFromSetup(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.copies.createFromCopy(
      request.adminUser!.organizationId,
      {
        name: typeof body.name === 'string' ? body.name : '',
        description: typeof body.description === 'string' ? body.description : '',
        defaultMonitoringFrequency: typeof body.defaultMonitoringFrequency === 'string' ? body.defaultMonitoringFrequency : undefined,
        defaultContractTemplateId: typeof body.defaultContractTemplateId === 'string' ? body.defaultContractTemplateId : undefined,
        statusPipeline: strings(body.statusPipeline),
        defaultWorkflow: strings(body.defaultWorkflow),
      },
      { sourceProgramId: sourceProgramIdOf(body), parts: parseCopyParts(body.parts), idempotencyKey: requiredKey(idempotencyKey) },
      actorOf(request),
    );
  }

  /** What copying into this (inactive) program would do. Changes nothing. */
  @Post(':programId/setup-copy/preview')
  previewInto(@Req() request: AuthenticatedRequest, @Param('programId') programId: string, @Body() body: Record<string, unknown>) {
    return this.copies.preview(request.adminUser!.organizationId, programId, sourceProgramIdOf(body), parseCopyParts(body.parts));
  }

  /** Copies the chosen parts into this inactive program. */
  @Post(':programId/setup-copy')
  copyInto(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.copies.copyInto(
      request.adminUser!.organizationId,
      programId,
      { sourceProgramId: sourceProgramIdOf(body), parts: parseCopyParts(body.parts), idempotencyKey: requiredKey(idempotencyKey) },
      actorOf(request),
    );
  }
}
