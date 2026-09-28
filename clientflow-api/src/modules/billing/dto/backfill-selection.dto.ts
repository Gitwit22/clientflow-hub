import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, ValidateNested } from 'class-validator';

export class BackfillPeriodDto {
  @IsISO8601()
  start!: string;

  @IsISO8601()
  end!: string;
}

/**
 * Exactly one of `paidThroughDate` ("Current" — auto-select every period up to this date) or
 * `periods` ("Partial/Unknown" — an explicit admin-picked subset) must be provided. Shared by
 * both the preview and confirm endpoints so preview always reflects what confirm will create.
 */
export class BackfillSelectionDto {
  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsISO8601()
  paidThroughDate?: string;

  @ApiPropertyOptional({ type: [BackfillPeriodDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BackfillPeriodDto)
  periods?: BackfillPeriodDto[];
}
