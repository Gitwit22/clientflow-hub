import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateClientDto {
  @ApiPropertyOptional({
    example: 'org_ea_management',
    description: "Ignored: the client is always created in the signed-in admin's organization.",
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

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

  @ApiPropertyOptional({ example: true, default: true, description: 'Send the intake email immediately. Set false to defer sending until POST /clients/:id/intake/send.' })
  @IsOptional()
  @IsBoolean()
  sendIntakeImmediately?: boolean;
}
