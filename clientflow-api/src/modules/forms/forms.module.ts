import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from './public-forms.service';

@Module({
  imports: [AutomationModule],
  controllers: [PublicFormsController],
  providers: [PublicFormsService],
})
export class FormsModule {}
