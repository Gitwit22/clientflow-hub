import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { SendContractDto } from './dto/send-contract.dto';

@ApiTags('contracts')
@Controller('clients/:id/contracts')
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
        publicContractUrl: 'https://clientflow.nxtlvltechnology.com/contracts/one-time-token',
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Standalone staff contract management is disabled.' })
  @ApiNotFoundResponse({ description: 'Client or selected program was not found.' })
  @ApiBadRequestResponse({ description: 'The selected program has no usable contract template.' })
  generate(@Param('id') clientId: string) {
    return this.contracts.generateForStaff(clientId);
  }

  @Post('send')
  @ApiOperation({ summary: 'Issue and send an existing generated contract' })
  @ApiOkResponse({
    description: 'Contract issue metadata and non-fatal email delivery result.',
    schema: {
      example: {
        contract: { id: 'contract_123', status: 'SENT' },
        publicContractUrl: 'https://clientflow.nxtlvltechnology.com/contracts/rotated-token',
        emailDelivery: { status: 'skipped', reason: 'disabled' },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Standalone staff contract management is disabled.' })
  @ApiNotFoundResponse({ description: 'Client or contract was not found.' })
  @ApiBadRequestResponse({ description: 'The contract cannot be sent.' })
  send(@Param('id') clientId: string, @Body() dto: SendContractDto) {
    return this.contracts.sendForStaff(clientId, dto.contractId);
  }
}
