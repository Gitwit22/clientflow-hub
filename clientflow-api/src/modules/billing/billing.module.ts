import { Module } from '@nestjs/common';
import { BillingDashboardService } from './billing-dashboard.service';
import {
  BillingDashboardController,
  EnrollmentBillingController,
  ProgramBillingController,
} from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  controllers: [ProgramBillingController, EnrollmentBillingController, BillingDashboardController],
  providers: [BillingService, BillingDashboardService],
  exports: [BillingService, BillingDashboardService],
})
export class BillingModule {}
