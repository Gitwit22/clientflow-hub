import { Body, Controller, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AuthenticatedRequest,
  ClientflowAdminOnlyGuard,
  ClientflowAuthGuard,
} from '../../common/guards/clientflow-auth.guard';
import { parseIdempotencyKey } from '../communications/communication-attempts';
import { ContractsService, type StaffSigner } from './contracts.service';
import { GenerateContractDto } from './dto/generate-contract.dto';
import { SendContractDto } from './dto/send-contract.dto';
import { SendWelcomeDto } from './dto/send-welcome.dto';

/** The signed-in staff member behind a request, used for signatures and the audit trail. */
function staffActor(request: AuthenticatedRequest): StaffSigner | null {
  return request.adminUser ? { id: request.adminUser.id, name: request.adminUser.displayName } : null;
}

@ApiTags('contracts')
@Controller('clients/:id/contracts')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a contract for a client selected program' })
  @ApiOkResponse({
    description: 'Safe contract metadata and a one-time public contract URL.',
    schema: {
      example: {
        contract: {
          id: 'contract_123',
          clientId: 'client_123',
          programId: 'program_123',
          contractName: 'Brand Awareness Service Agreement',
          status: 'DRAFT',
          secureTokenExpiresAt: '2026-09-28T12:00:00.000Z',
        },
        publicContractUrl: 'https://clientflow.nxtlvltechnology.com/agreements/one-time-token',
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Standalone staff contract management is disabled.' })
  @ApiNotFoundResponse({ description: 'Client or selected program was not found.' })
  @ApiBadRequestResponse({ description: 'The selected program has no usable contract template.' })
  generate(@Req() request: AuthenticatedRequest, @Param('id') clientId: string, @Body() dto: GenerateContractDto) {
    const signer = request.adminUser
      ? { id: request.adminUser.id, name: request.adminUser.displayName }
      : { id: dto.staffSignerId ?? null, name: dto.staffSignerName ?? '' };
    return this.contracts.generateForStaff(clientId, signer, { enrollmentId: dto.enrollmentId ?? null });
  }

  @Post('send')
  @ApiOperation({ summary: 'Issue and send an existing generated contract' })
  @ApiOkResponse({
    description: 'Contract issue metadata and non-fatal email delivery result.',
    schema: {
      example: {
        contract: { id: 'contract_123', status: 'SENT' },
        publicContractUrl: 'https://clientflow.nxtlvltechnology.com/agreements/rotated-token',
        emailDelivery: { status: 'skipped', reason: 'disabled' },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Standalone staff contract management is disabled.' })
  @ApiNotFoundResponse({ description: 'Client or contract was not found.' })
  @ApiBadRequestResponse({ description: 'The contract cannot be sent.' })
  send(
    @Req() request: AuthenticatedRequest,
    @Param('id') clientId: string,
    @Body() dto: SendContractDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.contracts.sendForStaff(clientId, dto.contractId, {
      enrollmentId: dto.enrollmentId ?? null,
      actor: staffActor(request),
      idempotencyKey: parseIdempotencyKey(idempotencyKey),
    });
  }

  @Post(':contractId/send-copy')
  @ApiOperation({
    summary: 'Email the client the signed copy of a completed contract',
    description: 'Never issues or rotates a signing link. Requires a COMPLETED contract with an archived executed copy.',
  })
  @ApiOkResponse({
    description: 'The recorded delivery result for this attempt.',
    schema: { example: { contractId: 'contract_123', emailDelivery: { status: 'sent', sentAt: '2026-09-28T12:00:00.000Z' }, replayed: false } },
  })
  @ApiNotFoundResponse({ description: 'Client or contract was not found.' })
  @ApiBadRequestResponse({ description: 'The contract is not signed, or its signed copy is not available yet.' })
  sendCopy(
    @Req() request: AuthenticatedRequest,
    @Param('id') clientId: string,
    @Param('contractId') contractId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.contracts.sendExecutedCopy(clientId, contractId, {
      actor: staffActor(request),
      idempotencyKey: parseIdempotencyKey(idempotencyKey),
    });
  }
}

@ApiTags('contracts')
@Controller('clients/:id/welcome')
@UseGuards(ClientflowAuthGuard, ClientflowAdminOnlyGuard)
export class WelcomeController {
  constructor(private readonly contracts: ContractsService) {}

  @Post('send')
  @ApiOperation({
    summary: 'Send or resend the welcome email for an enrollment',
    description: 'Requires the contract for this enrollment to be signed, exactly like the automatic post-signature workflow.',
  })
  @ApiOkResponse({
    description: 'The recorded delivery result for this attempt.',
    schema: { example: { contractId: 'contract_123', emailDelivery: { status: 'sent', sentAt: '2026-09-28T12:00:00.000Z' }, replayed: false } },
  })
  @ApiBadRequestResponse({ description: 'The contract has not been signed yet.' })
  @ApiNotFoundResponse({ description: 'Client or enrollment was not found.' })
  send(
    @Req() request: AuthenticatedRequest,
    @Param('id') clientId: string,
    @Body() dto: SendWelcomeDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.contracts.sendWelcomeForEnrollment(clientId, {
      enrollmentId: dto.enrollmentId,
      actor: staffActor(request),
      idempotencyKey: parseIdempotencyKey(idempotencyKey),
    });
  }
}
