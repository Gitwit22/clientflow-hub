import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import type { CfPaymentMethod } from '../../../generated/clientflow';

const PAYMENT_METHODS: CfPaymentMethod[] = ['cash', 'check', 'ach', 'card', 'other'];

export class CreateAwardDto {
  @ApiProperty({ example: 'Member Business Achievement Award' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'IDI Member Fund', description: 'Where the money comes from.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  source!: string;

  @ApiProperty({ example: 500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amountAwarded!: number;

  @ApiProperty({ example: '2026-11-12' })
  @IsISO8601()
  awardDate!: string;

  @ApiPropertyOptional({ example: '2026-11-21' })
  @IsOptional()
  @IsISO8601()
  expectedPaymentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ description: "An award agreement template of the award's program." })
  @IsOptional()
  @IsString()
  agreementTemplateId?: string;

  @ApiPropertyOptional({ description: 'Record the award as already approved.' })
  @IsOptional()
  @IsBoolean()
  approve?: boolean;
}

export class UpdateAwardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amountAwarded?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  awardDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  expectedPaymentDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  agreementTemplateId?: string | null;

  @ApiPropertyOptional({
    description: 'Confirms changing title, source, amount or date of an award that already has an agreement; that agreement is retired.',
  })
  @IsOptional()
  @IsBoolean()
  replaceAgreement?: boolean;
}

export class CancelAwardDto {
  @ApiProperty({ example: 'Business closed before the award was paid.' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class RecordAwardPaymentDto {
  @ApiProperty({ example: 250 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: '2026-11-20' })
  @IsISO8601()
  paymentDate!: string;

  @ApiProperty({ example: 'check' })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: CfPaymentMethod;

  @ApiPropertyOptional({ example: 'Check #1042' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class VoidAwardPaymentDto {
  @ApiProperty({ example: 'Recorded on the wrong award.' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
