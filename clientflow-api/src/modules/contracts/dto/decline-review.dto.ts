import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeclineReviewDto {
  @ApiPropertyOptional({ example: 'Program is no longer offered.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
