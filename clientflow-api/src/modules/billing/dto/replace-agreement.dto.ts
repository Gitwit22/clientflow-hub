import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';
import type { CfBillingFrequency } from '../../../generated/clientflow';

const BILLING_FREQUENCIES: CfBillingFrequency[] = ['one_time', 'weekly', 'monthly', 'quarterly', 'annually', 'custom'];

export class ReplaceAgreementDto {
  @ApiProperty({ example: 250 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ example: 'monthly' })
  @IsIn(BILLING_FREQUENCIES)
  frequency!: CfBillingFrequency;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  customIntervalDays?: number;

  @ApiProperty({ example: '2026-01-01' })
  @IsISO8601()
  startDate!: string;

  @ApiPropertyOptional({ example: 1, description: 'Day of month, 1-28.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  defaultDueDay?: number;
}
