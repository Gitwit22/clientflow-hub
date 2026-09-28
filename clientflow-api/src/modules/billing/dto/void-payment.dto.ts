import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class VoidPaymentDto {
  @ApiProperty({ example: 'Recorded against the wrong client by mistake.' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
