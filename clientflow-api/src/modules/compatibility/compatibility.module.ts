import { Module } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { AutomationModule } from '../automation/automation.module';
import { ProgramsModule } from '../programs/programs.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { FormsModule } from '../forms/forms.module';
import { DeliverablesModule } from '../deliverables/deliverables.module';
import { FinalReportsModule } from '../final-reports/final-reports.module';
import {
  AuthCompatibilityController,
  ClientflowCompatibilityController,
  FutureApiBoundaryController,
  OrganizationsCompatibilityController,
  PublicFormCompatibilityController,
} from './compatibility.controller';

@Module({
  imports: [IntegrationsModule, AutomationModule, ProgramsModule, EnrollmentsModule, FormsModule, FinalReportsModule, DeliverablesModule],
  controllers: [
    AuthCompatibilityController,
    ClientflowCompatibilityController,
    OrganizationsCompatibilityController,
    PublicFormCompatibilityController,
    FutureApiBoundaryController,
  ],
  providers: [ScaffoldService],
})
export class CompatibilityModule {}
