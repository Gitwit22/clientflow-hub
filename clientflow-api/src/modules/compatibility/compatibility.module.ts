import { Module } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ContractsModule } from '../contracts/contracts.module';
import {
  AuthCompatibilityController,
  ClientflowCompatibilityController,
  FutureApiBoundaryController,
  OrganizationsCompatibilityController,
  PublicFormCompatibilityController,
} from './compatibility.controller';

@Module({
  imports: [IntegrationsModule, ContractsModule],
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
