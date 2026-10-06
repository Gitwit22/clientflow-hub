import { ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CfDeliverableStatus } from '../../../generated/clientflow';

export const DELIVERABLE_STATUSES: CfDeliverableStatus[] = [
  'NOT_STARTED',
  'AVAILABLE',
  'SCHEDULED',
  'IN_PROGRESS',
  'DELIVERED',
  'COMPLETED',
  'NOT_APPLICABLE',
];

export class UpdateEnrollmentDeliverableDto {
  @ApiPropertyOptional({ example: 'DELIVERED' })
  @IsOptional()
  @IsIn(DELIVERABLE_STATUSES)
  status?: CfDeliverableStatus;

  @ApiPropertyOptional({ example: '2026-10-21', description: 'Optional; null clears it.' })
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string | null;

  @ApiPropertyOptional({ example: 'Shared four opportunities.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  outcome?: string | null;

  @ApiPropertyOptional({ description: 'Only false: clears the next-action mark. Use set-next-action to set it.' })
  @IsOptional()
  @Equals(false)
  isNextAction?: false;
}
