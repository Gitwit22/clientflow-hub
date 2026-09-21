import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';

@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  assertEnabled(): void {
    if (this.config.get('STORAGE_ENABLED', { infer: true }) !== 'true') {
      throw new ServiceUnavailableException('ClientFlow storage is disabled.');
    }
  }
}
