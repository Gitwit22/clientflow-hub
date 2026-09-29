import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class PermanentDeleteClientDto {
  @ApiProperty({ description: 'The business name, typed exactly to confirm.', example: 'Acme LLC' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  confirmation!: string;
}
