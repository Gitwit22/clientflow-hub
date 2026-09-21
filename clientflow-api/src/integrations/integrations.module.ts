import { Module } from '@nestjs/common';
import { EmailService } from './email/email.service';
import { N8nService } from './n8n/n8n.service';
import { StorageService } from './storage/storage.service';

@Module({
  providers: [EmailService, N8nService, StorageService],
  exports: [EmailService, N8nService, StorageService],
})
export class IntegrationsModule {}
