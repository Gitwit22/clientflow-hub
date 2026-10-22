import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ProgramEmailController } from './program-email.controller';
import { ProgramEmailService } from './program-email.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [ProgramEmailController],
  providers: [ProgramEmailService],
})
export class ProgramEmailsModule {}
