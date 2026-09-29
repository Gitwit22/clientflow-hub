import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ApproveReviewDto {
  @ApiPropertyOptional({
    example: 'Jordan Staff',
    description: 'Ignored: the signer is always the signed-in admin. Accepted so older clients keep working.',
  })
  @IsOptional()
  @IsString()
  staffSignerName?: string;

  @ApiPropertyOptional({ example: 'admin-user-id' })
  @IsOptional()
  @IsString()
  staffSignerId?: string;
}
