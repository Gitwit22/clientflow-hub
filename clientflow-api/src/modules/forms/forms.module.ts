import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { AutomationModule } from '../automation/automation.module';
import { DeliverablesModule } from '../deliverables/deliverables.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { FormDeliveryService } from './form-delivery.service';
import { FormProfileService } from './form-profile.service';
import { IntakeWorkflowService } from './intake-workflow.service';
import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from './public-forms.service';

@Module({
  imports: [AutomationModule, IntegrationsModule, EnrollmentsModule, DeliverablesModule],
  controllers: [PublicFormsController],
  providers: [PublicFormsService, FormProfileService, FormDeliveryService, IntakeWorkflowService],
  exports: [FormProfileService, FormDeliveryService, IntakeWorkflowService],
})
export class FormsModule {}
