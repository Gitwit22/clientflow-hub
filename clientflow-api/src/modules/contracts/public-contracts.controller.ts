import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Logger } from '@nestjs/common';
import { ProgramAutomationService } from '../automation/program-automation.service';
import { ContractsService } from './contracts.service';
import { SubmitPublicContractDto } from './dto/submit-public-contract.dto';

@ApiTags('public contracts')
@Controller('public/contracts')
export class PublicContractsController {
  private readonly logger = new Logger(PublicContractsController.name);

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
    let automation: { status: 'skipped' | 'completed' | 'failed'; execution?: unknown } = { status: 'skipped' };
    if (result.programId) {
      try {
        const execution = await this.automation.runTrigger({
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
        const executedAnyActions = Array.isArray(execution?.programs)
          && execution.programs.some((program) => program.actions.length > 0);
        automation = { status: executedAnyActions ? 'completed' : 'skipped', execution };
      } catch (error) {
        this.logger.warn(`Contract automation failed for ${result.contract.id}: ${(error as Error).message}`);
        automation = { status: 'failed' };
      }
    }
    // The signer is anonymous: return only what their page needs. No organization, enrollment or
    // staff ids, and never internal error text (it is logged above instead).
    return {
      contract: { id: result.contract.id, status: result.contract.status, completedAt: result.contract.completedAt },
      client: { id: result.client.id, status: result.client.status },
      automation: { status: automation.status },
    };
  }
}
