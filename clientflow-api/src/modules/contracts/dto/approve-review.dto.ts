import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ApproveReviewDto {
  @ApiPropertyOptional({
    example: 'Jordan Staff',
    description: 'Typed electronic signature of the approving staff member. Only used when there is no authenticated session.',
  })
  @IsOptional()
  @IsString()
  staffSignerName?: string;

  @ApiPropertyOptional({ example: 'admin-user-id' })
  @IsOptional()
  @IsString()
  staffSignerId?: string;
}
