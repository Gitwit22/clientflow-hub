/**
 * A tiny in-memory stand-in for the Prisma client, used by the invariant specs. Unlike jest mocks
 * that return a fixed row, it evaluates `where` filters, so a query that forgets
 * `organizationId` really does return another organization's row, and the invariant fails.
 *
 * Supports: equality, `in`, `not`, nested relation-free objects, AND via object keys.
 */
type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    const value = row[key];
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const filter = condition as Row;
      if ('in' in filter) return (filter.in as unknown[]).includes(value);
      if ('not' in filter) return value !== filter.not;
      return false;
    }
    return value === condition;
  });
}

function table(rows: Row[]) {
  const first = (where?: Row) => Promise.resolve(rows.find((row) => matches(row, where)) ?? null);
  return {
    findFirst: ({ where }: { where?: Row } = {}) => first(where),
    findUnique: ({ where }: { where?: Row } = {}) => first(where),
    findFirstOrThrow: ({ where }: { where?: Row } = {}) => first(where).then((row) => row
      ?? Promise.reject(Object.assign(new Error('No record found.'), { code: 'P2025' }))),
    findMany: ({ where }: { where?: Row } = {}) => Promise.resolve(rows.filter((row) => matches(row, where))),
    count: ({ where }: { where?: Row } = {}) => Promise.resolve(rows.filter((row) => matches(row, where)).length),
    update: ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) return Promise.reject(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }));
      Object.assign(row, data);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      const hits = rows.filter((row) => matches(row, where));
      hits.forEach((row) => Object.assign(row, data));
      return Promise.resolve({ count: hits.length });
    },
    create: ({ data }: { data: Row }) => {
      const row = { id: Math.random().toString(36).slice(2), ...data };
      rows.push(row);
      return Promise.resolve(row);
    },
  };
}

export function inMemoryDb(seed: Record<string, Row[]>) {
  const tables: Record<string, ReturnType<typeof table>> = {};
  const db: Record<string, unknown> = new Proxy(tables, {
    get(target, name: string) {
      if (name === '$transaction') {
        return (input: unknown) => (typeof input === 'function'
          ? Promise.resolve((input as (tx: unknown) => unknown)(db))
          : Promise.all(input as Promise<unknown>[]));
      }
      if (name === 'then') return undefined;
      if (!(name in target)) target[name] = table((seed[name] ??= []));
      return target[name];
    },
  });
  return db;
}
