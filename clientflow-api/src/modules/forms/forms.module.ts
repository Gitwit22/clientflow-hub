import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { FormProfileService } from './form-profile.service';
import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from './public-forms.service';

@Module({
  imports: [AutomationModule],
  controllers: [PublicFormsController],
  providers: [PublicFormsService, FormProfileService],
  exports: [FormProfileService],
})
export class FormsModule {}
