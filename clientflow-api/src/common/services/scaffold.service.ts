import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class ScaffoldService {
  notImplemented(domain: string): never {
    throw new NotImplementedException(`${domain} is scaffolded but has not been ported from API 2.`);
  }
}
