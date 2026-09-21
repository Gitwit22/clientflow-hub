import { Module } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PublicContractsController } from './public-contracts.controller';

@Module({
  imports: [IntegrationsModule],
  controllers: [ContractsController, PublicContractsController],
  providers: [ContractsService, ScaffoldService],
  exports: [ContractsService],
})
export class ContractsModule {}
