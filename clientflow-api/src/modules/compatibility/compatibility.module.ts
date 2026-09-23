import { Module } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { AutomationModule } from '../automation/automation.module';
import {
  AuthCompatibilityController,
  ClientflowCompatibilityController,
  FutureApiBoundaryController,
  OrganizationsCompatibilityController,
  PublicFormCompatibilityController,
} from './compatibility.controller';

@Module({
  imports: [IntegrationsModule, AutomationModule],
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
