import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [IntegrationsModule, ContractsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
