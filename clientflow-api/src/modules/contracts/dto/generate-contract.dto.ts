import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class GenerateContractDto {
  @ApiProperty({ example: 'Jordan Staff', description: 'Typed electronic signature of the staff member generating this contract on behalf of the organization.' })
  @IsString()
  @MinLength(1)
  staffSignerName!: string;

  @ApiPropertyOptional({ example: 'admin-user-id' })
  @IsOptional()
  @IsString()
  staffSignerId?: string;
}
