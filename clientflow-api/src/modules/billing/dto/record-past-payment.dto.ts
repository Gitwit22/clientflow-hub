import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { CfPaymentMethod } from '../../../generated/clientflow';

const PAYMENT_METHODS: CfPaymentMethod[] = ['cash', 'check', 'ach', 'card', 'other'];

/** A payment the client made in the past, recorded with its real date and no billing period. */
export class RecordPastPaymentDto {
  @ApiProperty({ example: 150 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: '2026-03-15' })
  @IsISO8601()
  paymentDate!: string;

  @ApiProperty({ example: 'check' })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: CfPaymentMethod;

  @ApiPropertyOptional({ example: 'Spring workshop fee, paid before ClientFlow' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
