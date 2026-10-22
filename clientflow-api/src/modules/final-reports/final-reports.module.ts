import { Module } from '@nestjs/common';
import { DeliverablesModule } from '../deliverables/deliverables.module';
import { FinalReportsController } from './final-reports.controller';
import { FinalReportsService } from './final-reports.service';

@Module({
  imports: [DeliverablesModule],
  controllers: [FinalReportsController],
  providers: [FinalReportsService],
  exports: [FinalReportsService],
})
export class FinalReportsModule {}
