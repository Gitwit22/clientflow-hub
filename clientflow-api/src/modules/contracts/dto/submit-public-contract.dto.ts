import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitPublicContractDto {
  @ApiProperty({ example: 'Jordan Taylor', maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  signedName!: string;

  @ApiProperty({ example: 'jordan@example.com', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  signedEmail!: string;

  @ApiProperty({ example: true })
  @Equals(true, { message: 'agreedToTerms must be true' })
  agreedToTerms!: true;

  @ApiPropertyOptional({ example: 'Accepted on behalf of Jordan Taylor LLC.', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  signatureNote?: string;
}