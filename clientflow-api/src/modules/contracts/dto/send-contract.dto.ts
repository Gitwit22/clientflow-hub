import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SendContractDto {
  @ApiProperty({ example: 'contract_123' })
  @IsString()
  @MinLength(1)
  contractId!: string;
}
