import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export type PublicAnswer = string | number | boolean | string[] | null;

export class SubmitPublicFormDto {
  @ApiProperty({
    example: {
      contactName: 'Jordan Taylor',
      email: 'jordan@example.com',
      selectedProgram: 'Event Planning',
    },
  })
  @IsObject()
  answers!: Record<string, PublicAnswer>;
}
