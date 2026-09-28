import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORS_ALLOWED_HEADERS } from './cors';

describe('CORS allowed headers', () => {
  it('allows every custom header the browser app sends', () => {
    const allowed = CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase());
    for (const header of ['content-type', 'x-app-partition', 'idempotency-key']) {
      expect(allowed).toContain(header);
    }
  });

  it('covers the headers set in the frontend API client', () => {
    const client = readFileSync(join(__dirname, '../../../src/lib/apiClient.ts'), 'utf8');
    const sent = [...client.matchAll(/["']((?:X-[A-Za-z-]+)|Idempotency-Key)["']\s*:/g)].map((m) => m[1].toLowerCase());
    expect(sent.length).toBeGreaterThan(0);
    const allowed = CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase());
    for (const header of sent) expect(allowed).toContain(header);
  });
});
