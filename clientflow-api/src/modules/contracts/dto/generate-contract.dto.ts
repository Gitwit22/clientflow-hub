import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

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

  @ApiPropertyOptional({
    example: 'version_123',
    description: 'The template version shown in the review (from the preview). Sent together with contentHash.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  reviewedVersionId?: string;

  @ApiPropertyOptional({
    description: 'The contentHash from the preview. A new agreement is only generated from exactly that text; otherwise 409.',
  })
  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  reviewedContentHash?: string;
}

export class PreviewContractDto {
  @ApiPropertyOptional({ example: 'enrollment_123', description: 'The program enrollment the agreement is for.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  enrollmentId?: string;
}

export class AwardAgreementDto {
  @ApiPropertyOptional({ description: "Which of the program's award agreement templates to use (when it has several)." })
  @IsOptional()
  @IsString()
  @MinLength(1)
  templateId?: string;

  @ApiPropertyOptional({ description: 'The template version shown in the review (from the preview).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  reviewedVersionId?: string;

  @ApiPropertyOptional({ description: 'The contentHash from the preview; a change since then is refused with 409.' })
  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  reviewedContentHash?: string;
}
