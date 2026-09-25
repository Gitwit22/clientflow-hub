import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScaffoldService } from './common/services/scaffold.service';
import { environmentSchema } from './config/env';
import { IntegrationsModule } from './integrations/integrations.module';
import { CompatibilityModule } from './modules/compatibility/compatibility.module';
import {
  ArchiveModule,
  AuditModule,
  AuthModule,
  CommunicationsModule,
  DocumentsModule,
  EmailModule,
  MonitoringModule,
  NotificationsModule,
  OrganizationsModule,
  ReportsModule,
  TermsModule,
  UsersModule,
  WebhooksModule,
} from './modules/domain-modules';
import { ClientsModule } from './modules/clients/clients.module';
import { AutomationModule } from './modules/automation/automation.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { FormsModule } from './modules/forms/forms.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { HealthController } from './modules/health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: (config) => environmentSchema.parse(config),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    IntegrationsModule,
    CompatibilityModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ClientsModule,
    AutomationModule,
    ProgramsModule,
    EnrollmentsModule,
    FormsModule,
    ContractsModule,
    TermsModule,
    MonitoringModule,
    DocumentsModule,
    CommunicationsModule,
    ReportsModule,
    ArchiveModule,
    NotificationsModule,
    WebhooksModule,
    EmailModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [
    ScaffoldService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [ScaffoldService],
})
export class AppModule {}
