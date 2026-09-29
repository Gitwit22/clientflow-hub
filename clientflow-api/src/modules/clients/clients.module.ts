import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ContractsModule } from '../contracts/contracts.module';
import { ClientsController } from './clients.controller';
import { ClientDeletionService } from './client-deletion.service';
import { ClientsService } from './clients.service';

@Module({
  imports: [IntegrationsModule, ContractsModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientDeletionService],
})
export class ClientsModule {}
