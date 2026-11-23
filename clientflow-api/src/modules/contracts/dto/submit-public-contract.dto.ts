import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Shown to the person signing, so they are written for them (the signing page also maps them to
// the matching field).
export const SIGNER_MESSAGES = {
  name: "Type your full name — it's your signature.",
  nameTooLong: 'Keep your name under 160 characters.',
  email: 'Enter a valid email address, like name@example.com.',
  emailTooLong: 'Keep the email address under 320 characters.',
  agree: "Tick the box to confirm you've read and agree.",
  note: 'Keep the note under 1000 characters.',
} as const;

export class SubmitPublicContractDto {
  @ApiProperty({ example: 'Jordan Taylor', maxLength: 160 })
  @IsString({ message: SIGNER_MESSAGES.name })
  @MinLength(1, { message: SIGNER_MESSAGES.name })
  @MaxLength(160, { message: SIGNER_MESSAGES.nameTooLong })
  signedName!: string;

  @ApiProperty({ example: 'jordan@example.com', maxLength: 320 })
  @IsEmail({}, { message: SIGNER_MESSAGES.email })
  @MaxLength(320, { message: SIGNER_MESSAGES.emailTooLong })
  signedEmail!: string;

  @ApiProperty({ example: true })
  @Equals(true, { message: SIGNER_MESSAGES.agree })
  agreedToTerms!: true;

  @ApiPropertyOptional({ example: 'Accepted on behalf of Jordan Taylor LLC.', maxLength: 1000 })
  @IsOptional()
  @IsString({ message: SIGNER_MESSAGES.note })
  @MaxLength(1000, { message: SIGNER_MESSAGES.note })
  signatureNote?: string;
}
