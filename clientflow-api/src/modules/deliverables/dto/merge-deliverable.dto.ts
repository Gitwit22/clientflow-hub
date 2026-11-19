import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MergeDeliverableDto {
  @ApiProperty({ description: 'The deliverable this one is merged into (same program).' })
  @IsString()
  @IsNotEmpty()
  intoTemplateId!: string;
}
