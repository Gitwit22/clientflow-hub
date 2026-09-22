import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class UpdateClientProgramDto {
  @ApiProperty({ example: 'program_123' })
  @IsString()
  @MinLength(1)
  programId!: string;
}
