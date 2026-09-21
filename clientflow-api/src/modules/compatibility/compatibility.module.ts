import { Module } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import {
  AuthCompatibilityController,
  ClientflowCompatibilityController,
  FutureApiBoundaryController,
  OrganizationsCompatibilityController,
  PublicFormCompatibilityController,
} from './compatibility.controller';

@Module({
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
