import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SendWelcomeDto {
  @ApiProperty({ example: 'enrollment_123' })
  @IsString()
  @MinLength(1)
  enrollmentId!: string;
}
