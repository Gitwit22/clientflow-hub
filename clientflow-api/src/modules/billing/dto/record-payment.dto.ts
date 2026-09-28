import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import type { CfPaymentMethod } from '../../../generated/clientflow';

const PAYMENT_METHODS: CfPaymentMethod[] = ['cash', 'check', 'ach', 'card', 'other'];

export class RecordPaymentDto {
  @ApiProperty({ example: 250 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: '2026-10-03' })
  @IsISO8601()
  paymentDate!: string;

  @ApiProperty({ example: 'ach' })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: CfPaymentMethod;

  @ApiProperty({ example: '2026-10-01', description: 'Start of the billing period this payment is applied to.' })
  @IsISO8601()
  billingPeriodStart!: string;

  @ApiProperty({ example: '2026-10-31', description: 'End of the billing period this payment is applied to.' })
  @IsISO8601()
  billingPeriodEnd!: string;

  @ApiPropertyOptional({ example: 'October payment' })
  @IsOptional()
  @IsString()
  note?: string;
}
