import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class GenerateContractDto {
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

  @ApiPropertyOptional({
    example: 'enrollment_123',
    description: 'The program enrollment to generate the contract for. Program context comes from the enrollment, not the legacy client program.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  enrollmentId?: string;
}
