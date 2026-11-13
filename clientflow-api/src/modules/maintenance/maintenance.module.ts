import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { LegacyDataService } from './legacy-data.service';
import { LogoStorageController, MaintenanceController } from './maintenance.controller';
import { LogoStorageService } from './logo-storage.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [MaintenanceController, LogoStorageController],
  providers: [LegacyDataService, LogoStorageService],
})
export class MaintenanceModule {}
