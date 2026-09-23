import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProgramAutomationService } from '../automation/program-automation.service';
import { ContractsService } from './contracts.service';
import { SubmitPublicContractDto } from './dto/submit-public-contract.dto';

@ApiTags('public contracts')
@Controller('public/contracts')
export class PublicContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly automation: ProgramAutomationService,
  ) {}

  @Get(':token')
  @ApiOperation({ summary: 'Open a public contract' })
  @ApiOkResponse({ description: 'Safe contract snapshot and signing metadata.' })
  @ApiNotFoundResponse({ description: 'Contract link is invalid or unavailable.' })
  getContract(@Param('token') token: string) {
    return this.contracts.openPublicContract(token);
  }

  @Post(':token')
  @ApiOperation({ summary: 'Accept and complete a public contract' })
  @ApiOkResponse({ description: 'Contract completed and client moved to onboarding.' })
  @ApiNotFoundResponse({ description: 'Contract link is invalid or unavailable.' })
  async submitContract(
    @Param('token') token: string,
    @Body() body: SubmitPublicContractDto,
    @Req() request: Request,
  ) {
    const result = await this.contracts.completePublicContract(token, body, {
      signerIp: request.ip || request.socket.remoteAddress || null,
      userAgent: request.get('user-agent')?.slice(0, 1000) || null,
    });
    if (result.programId) {
      await this.automation.runTrigger({
        organizationId: result.organizationId,
        clientId: result.client.id,
        trigger: 'contract.signed',
        programIds: [result.programId],
        enrollmentIdsByProgramId: result.enrollmentId
          ? { [result.programId]: result.enrollmentId }
          : undefined,
        actorDisplayName: 'public contract',
        idempotencySeed: `public-contract-signed:${result.contract.id}`,
      });
    }
    return result;
  }
}
