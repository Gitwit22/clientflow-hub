import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { CfDeliverableCadence } from '../../../generated/clientflow';

export const DELIVERABLE_CADENCES: CfDeliverableCadence[] = ['MONTHLY', 'QUARTERLY', 'ONE_TIME', 'AS_NEEDED'];

export class CreateDeliverableTemplateDto {
  @ApiProperty({ example: 'Coaching Session' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ example: 'One 60-minute session with a business coach.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'MONTHLY' })
  @IsOptional()
  @IsIn(DELIVERABLE_CADENCES)
  cadence?: CfDeliverableCadence;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'The date is set once per month for the whole program.' })
  @IsOptional()
  @IsBoolean()
  programWideDate?: boolean;
}

export class UpdateDeliverableTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'null or "" clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(DELIVERABLE_CADENCES)
  cadence?: CfDeliverableCadence;

  @ApiPropertyOptional({ description: 'Inactive deliverables are left out of future cycles only.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'The date is set once per month for the whole program.' })
  @IsOptional()
  @IsBoolean()
  programWideDate?: boolean;
}

export class ReorderDeliverableTemplatesDto {
  @ApiProperty({ type: [String], description: "Every one of the program's deliverable ids, in the new order." })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  orderedIds!: string[];
}

export class SetProgramDeliverableDateDto {
  @ApiProperty({ example: '2026-10', description: 'The month the date is for.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-10.' })
  month!: string;

  @ApiPropertyOptional({ example: '2026-10-18', description: 'null clears the date for that month.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledFor must be a date like 2026-10-18.' })
  scheduledFor?: string | null;
}
