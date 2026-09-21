import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';

@Injectable()
export class EmailService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  assertEnabled(): void {
    if (this.config.get('EMAIL_SEND_ENABLED', { infer: true }) !== 'true') {
      throw new ServiceUnavailableException('ClientFlow email delivery is disabled.');
    }
  }
}
