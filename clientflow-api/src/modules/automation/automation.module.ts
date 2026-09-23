import { forwardRef, Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ProgramAutomationService } from './program-automation.service';

@Module({
  imports: [IntegrationsModule, forwardRef(() => ContractsModule)],
  providers: [ProgramAutomationService],
  exports: [ProgramAutomationService],
})
export class AutomationModule {}
