import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAgreementLine } from './agreement-format';

/** The same cases the web app runs (src/lib/agreement-format.spec.ts): page and PDF agree. */
const fixtures = JSON.parse(readFileSync(join(__dirname, 'agreement-format.fixtures.json'), 'utf8')) as Array<{
  name: string;
  line: string;
  block: unknown;
}>;

describe('agreement formatting (API copy)', () => {
  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('%s', (_name, { line, block }) => {
    expect(parseAgreementLine(line)).toEqual(block);
  });
});
