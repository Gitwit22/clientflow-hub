import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class GenerateContractDto {
  @ApiPropertyOptional({
    example: 'Jordan Staff',
    description: 'Typed electronic signature of the staff member generating this contract. Only used when there is no authenticated session.',
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
