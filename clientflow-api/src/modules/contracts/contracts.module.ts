import { forwardRef, Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ProgramsModule } from '../programs/programs.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PublicContractsController } from './public-contracts.controller';

@Module({
  imports: [IntegrationsModule, ProgramsModule, forwardRef(() => AutomationModule)],
  controllers: [ContractsController, PublicContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
