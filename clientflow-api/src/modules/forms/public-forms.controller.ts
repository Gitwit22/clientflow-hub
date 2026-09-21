import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubmitPublicFormDto } from './dto/submit-public-form.dto';
import { PublicFormsService } from './public-forms.service';

@ApiTags('public forms')
@Controller('public/forms')
export class PublicFormsController {
  constructor(private readonly forms: PublicFormsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Open a public General Intake form' })
  @ApiOkResponse({ description: 'Client-safe form definition and prefilled contact information.' })
  @ApiNotFoundResponse({ description: 'The form link is invalid or unavailable.' })
  getForm(@Param('token') token: string) {
    return this.forms.getByToken(token);
  }

  @Post(':token/submit')
  @ApiOperation({ summary: 'Submit a public General Intake form' })
  @ApiOkResponse({ description: 'The intake was submitted and the client lifecycle was updated.' })
  @ApiNotFoundResponse({ description: 'The form link is invalid or unavailable.' })
  submit(@Param('token') token: string, @Body() dto: SubmitPublicFormDto) {
    return this.forms.submit(token, dto);
  }
}
