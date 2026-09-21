import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { PublicContractsController } from './public-contracts.controller';

@Module({
  imports: [IntegrationsModule],
  controllers: [ContractsController, PublicContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
