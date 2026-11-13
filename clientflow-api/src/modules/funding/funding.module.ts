import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AwardsController, EnrollmentAwardsController } from './funding.controller';
import { FundingService } from './funding.service';

@Module({
  imports: [BillingModule],
  controllers: [EnrollmentAwardsController, AwardsController],
  providers: [FundingService],
  exports: [FundingService],
})
export class FundingModule {}
