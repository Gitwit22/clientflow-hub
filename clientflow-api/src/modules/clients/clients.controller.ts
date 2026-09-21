import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a client and send the General Intake form' })
  @ApiCreatedResponse({
    description: 'Client and intake assignment created. n8n delivery may be sent, skipped, or failed.',
  })
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }
}
