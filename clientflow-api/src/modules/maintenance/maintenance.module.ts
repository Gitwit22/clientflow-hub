import { Module } from '@nestjs/common';
import { LegacyDataService } from './legacy-data.service';
import { MaintenanceController } from './maintenance.controller';

@Module({
  controllers: [MaintenanceController],
  providers: [LegacyDataService],
})
export class MaintenanceModule {}
