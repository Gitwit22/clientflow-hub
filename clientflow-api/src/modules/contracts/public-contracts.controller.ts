import { Controller, Get } from '@nestjs/common';
import { ApiNotImplementedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScaffoldService } from '../../common/services/scaffold.service';

@ApiTags('public contracts')
@Controller('public/contracts')
export class PublicContractsController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Open a public contract (signing not implemented)' })
  @ApiNotImplementedResponse({
    description: 'Public contract signing is not implemented.',
    schema: {
      example: {
        success: false,
        error: {
          code: 'CLIENTFLOW_NOT_IMPLEMENTED',
          message: 'Public contract signing is scaffolded but has not been ported from API 2.',
        },
      },
    },
  })
  getContract() {
    return this.scaffold.notImplemented('Public contract signing');
  }
}
