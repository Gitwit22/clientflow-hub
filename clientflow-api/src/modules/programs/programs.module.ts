import { Module } from '@nestjs/common';
import { ProgramSetupCopyController } from './program-setup-copy.controller';
import { ProgramSetupCopyService } from './program-setup-copy.service';
import { WorkflowConfigService } from './workflow-config.service';

@Module({
  controllers: [ProgramSetupCopyController],
  providers: [WorkflowConfigService, ProgramSetupCopyService],
  exports: [WorkflowConfigService],
})
export class ProgramsModule {}
