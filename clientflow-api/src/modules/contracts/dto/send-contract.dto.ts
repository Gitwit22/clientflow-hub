import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class SendContractDto {
  @ApiProperty({ example: 'contract_123' })
  @IsString()
  @MinLength(1)
  contractId!: string;

  @ApiPropertyOptional({
    example: 'enrollment_123',
    description: 'When given, the contract must belong to this enrollment.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  enrollmentId?: string;
}
