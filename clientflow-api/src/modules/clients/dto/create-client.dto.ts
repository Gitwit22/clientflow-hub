import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateClientDto {
  @ApiProperty({ example: 'org_ea_management' })
  @IsString()
  @MinLength(1)
  organizationId!: string;

  @ApiProperty({ example: 'Jordan Taylor' })
  @IsString()
  @MinLength(1)
  contactName!: string;

  @ApiPropertyOptional({ example: 'Taylor Creative LLC' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiProperty({ example: 'jordan@example.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: '+1 313 555 0100' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'admin_created' })
  @IsOptional()
  @IsString()
  intakeSource?: string;

  @ApiPropertyOptional({ example: 'admin-user-id' })
  @IsOptional()
  @IsString()
  assignedStaffId?: string;
}
