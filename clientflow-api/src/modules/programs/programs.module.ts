import { Module } from '@nestjs/common';
import { WorkflowConfigService } from './workflow-config.service';

@Module({
  providers: [WorkflowConfigService],
  exports: [WorkflowConfigService],
})
export class ProgramsModule {}
