import { Module } from '@nestjs/common';
import { EnrollmentDeliverablesController, ProgramDeliverablesController } from './deliverables.controller';
import { ProgramDeliverablesService } from './program-deliverables.service';

@Module({
  controllers: [ProgramDeliverablesController, EnrollmentDeliverablesController],
  providers: [ProgramDeliverablesService],
  exports: [ProgramDeliverablesService],
})
export class DeliverablesModule {}
