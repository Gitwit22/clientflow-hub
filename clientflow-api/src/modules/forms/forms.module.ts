import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from './public-forms.service';

@Module({
  imports: [ContractsModule],
  controllers: [PublicFormsController],
  providers: [PublicFormsService],
})
export class FormsModule {}
