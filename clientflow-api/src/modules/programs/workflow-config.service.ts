import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { contractRuleFor } from '../contracts/contract-lifecycle';

/**
 * The single creator/resolver for CfProgramWorkflowConfig. Every other service or controller
 * that needs a program's workflow configuration must go through this service instead of
 * re-implementing its own defaulting logic - previously four independent places each
 * re-derived (and could disagree on) the same defaults.
 */
@Injectable()
export class WorkflowConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transitional compatibility only.
   * Legacy program-name inference (`contractRuleFor`) must not be introduced outside this
   * service. Cleanup ticket: remove the inference branch once every production
   * CfProgramWorkflowConfig row has been verified to exist and be explicit (Phase 2 audit).
   */
  async getOrCreate(organizationId: string, programId: string, programName?: string) {
    const existing = await this.prisma.cfProgramWorkflowConfig.findFirst({
      where: { organizationId, programId },
    });
    if (existing) return existing;

    const legacyRule = programName ? contractRuleFor(programName) : null;
    return this.prisma.cfProgramWorkflowConfig.create({
      data: {
        organizationId,
        programId,
        sendContractAfterIntake: legacyRule ? legacyRule === 'auto_contract' : true,
        sendWelcomeAfterContractSigned: true,
      },
    });
  }

  /**
   * Applies explicit staff-provided configuration (settings UI, program creation with an
   * explicit workflow payload). The supplied values are authoritative - never combined with
   * legacy inference. Creates the row if it doesn't exist yet.
   *
   * When creating for the first time, any field NOT included in `data` must still get a
   * value (booleans can't be left "unset" on create) - default those to the same
   * automation-on posture as getOrCreate(), so that e.g. activating a contract version
   * before ever touching the toggles doesn't silently leave sendContractAfterIntake/
   * sendWelcomeAfterContractSigned on the schema's `false` default.
   */
  async applyUpdate(organizationId: string, programId: string, data: Record<string, unknown>) {
    const existing = await this.prisma.cfProgramWorkflowConfig.findFirst({
      where: { organizationId, programId },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.cfProgramWorkflowConfig.update({ where: { id: existing.id }, data });
    }
    return this.prisma.cfProgramWorkflowConfig.create({
      data: {
        organizationId,
        programId,
        enabled: true,
        sendContractAfterIntake: true,
        sendWelcomeAfterContractSigned: true,
        ...data,
      },
    });
  }
}
