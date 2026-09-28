import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { AutomationModule } from '../automation/automation.module';
import { FormDeliveryService } from './form-delivery.service';
import { FormProfileService } from './form-profile.service';
import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from './public-forms.service';

@Module({
  imports: [AutomationModule, IntegrationsModule],
  controllers: [PublicFormsController],
  providers: [PublicFormsService, FormProfileService, FormDeliveryService],
  exports: [FormProfileService, FormDeliveryService],
})
export class FormsModule {}
