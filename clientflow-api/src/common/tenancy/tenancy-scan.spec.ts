import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Static guards for docs/ARCHITECTURE_RULES.md. They read the source, so a new query that breaks
 * a rule fails CI even before anyone writes a test for that endpoint.
 */
const SRC = join(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'generated' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('tenant isolation (static scan)', () => {
  it('looks up records by a bare id only together with organizationId (use OrgScopedRepository)', () => {
    // `where: { id: clientId }` with no organizationId lets any organization reach the record.
    // An id taken from an already-loaded, already-scoped record (`contract.id`,
    // `formAssignment.clientId`) is fine; a bare identifier (usually a route param) is not.
    const lookup = /\.cf\w+\.(findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow)\(\{\s*where:\s*\{([^{}]*)\}/g;
    const violations: string[] = [];
    for (const file of files) {
      if (file.path.startsWith('common/tenancy/')) continue;
      for (const match of file.text.matchAll(lookup)) {
        const where = match[2];
        if (/\borganizationId\b/.test(where)) continue;
        const idValue = /(?:^|[\s,{])id\s*(?::\s*([^,}\n]+))?(?=[,}\n]|$)/.exec(where);
        if (!idValue) continue;
        const value = (idValue[1] ?? 'id').trim();
        if (value.includes('.')) continue;
        violations.push(`${file.path}:${lineOf(file.text, match.index ?? 0)}  where: {${where.trim()}}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('never passes a request body straight into Prisma data', () => {
    const patterns = [/\bdata:\s*body\b/g, /\bdata:\s*\{\s*\.\.\.body\b/g, /\bdata:\s*dto\b/g, /\bdata:\s*\{\s*\.\.\.dto\b/g];
    const violations: string[] = [];
    for (const file of files) {
      for (const pattern of patterns) {
        for (const match of file.text.matchAll(pattern)) {
          violations.push(`${file.path}:${lineOf(file.text, match.index ?? 0)}  ${match[0]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
