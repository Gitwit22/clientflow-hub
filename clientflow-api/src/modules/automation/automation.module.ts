import { forwardRef, Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ProgramsModule } from '../programs/programs.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { ProgramAutomationService } from './program-automation.service';

@Module({
  imports: [IntegrationsModule, ProgramsModule, EnrollmentsModule, forwardRef(() => ContractsModule)],
  providers: [ProgramAutomationService],
  exports: [ProgramAutomationService],
})
export class AutomationModule {}
