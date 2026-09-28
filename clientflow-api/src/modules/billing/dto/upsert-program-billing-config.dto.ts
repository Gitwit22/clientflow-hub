import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import type { CfBillingFrequency } from '../../../generated/clientflow';

const BILLING_FREQUENCIES: CfBillingFrequency[] = ['one_time', 'weekly', 'monthly', 'quarterly', 'annually', 'custom'];

export class UpsertProgramBillingConfigDto {
  @ApiPropertyOptional({ example: 250 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultAmount?: number;

  @ApiPropertyOptional({ example: 'monthly' })
  @IsOptional()
  @IsIn(BILLING_FREQUENCIES)
  frequency?: CfBillingFrequency;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  customIntervalDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  billingRequired?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Day of month, 1-28.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  defaultDueDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowCustomClientPricing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
