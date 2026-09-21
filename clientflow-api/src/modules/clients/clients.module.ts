import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
