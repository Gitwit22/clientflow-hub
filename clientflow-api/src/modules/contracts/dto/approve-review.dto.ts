import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ApproveReviewDto {
  @ApiProperty({ example: 'Jordan Staff', description: 'Typed electronic signature of the approving staff member.' })
  @IsString()
  @MinLength(1)
  staffSignerName!: string;

  @ApiPropertyOptional({ example: 'admin-user-id' })
  @IsOptional()
  @IsString()
  staffSignerId?: string;
}
