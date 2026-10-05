/**
 * A tiny in-memory stand-in for the Prisma client, used by the invariant specs. Unlike jest mocks
 * that return a fixed row, it evaluates `where` filters, so a query that forgets
 * `organizationId` really does return another organization's row, and the invariant fails.
 *
 * Supports: equality (Dates by time), `in`, `not`, compound unique keys
 * (`{ a_b: { a, b } }`), AND via object keys, `orderBy`, and optional unique constraints.
 */
import { Prisma } from '../generated/clientflow';

type Row = Record<string, unknown>;
type OrderBy = Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[] | undefined;

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    const value = row[key];
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const filter = condition as Row;
      if ('in' in filter) return (filter.in as unknown[]).some((candidate) => sameValue(candidate, value));
      if ('not' in filter) return !sameValue(value, filter.not);
      // A compound unique key (`enrollmentId_cadence_periodStart: { … }`) names no column itself.
      if (value === undefined && !(key in row)) return matches(row, filter);
      return false;
    }
    return sameValue(value, condition);
  });
}

function sorted(rows: Row[], orderBy: OrderBy): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((entry) => Object.entries(entry));
  if (keys.length === 0) return rows;
  const value = (row: Row, key: string) => {
    const raw = row[key];
    return raw instanceof Date ? raw.getTime() : (raw as number | string | null | undefined);
  };
  return [...rows].sort((a, b) => {
    for (const [key, direction] of keys) {
      const left = value(a, key) ?? '';
      const right = value(b, key) ?? '';
      if (left < right) return direction === 'asc' ? -1 : 1;
      if (left > right) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', { code: 'P2002', clientVersion: 'test' });
}

function table(rows: Row[], uniques: string[][] = []) {
  const first = (where?: Row, orderBy?: OrderBy) =>
    Promise.resolve(sorted(rows.filter((row) => matches(row, where)), orderBy)[0] ?? null);
  const clashes = (row: Row) =>
    uniques.some((columns) => rows.some((other) => columns.every((column) => sameValue(other[column], row[column]))));
  return {
    findFirst: ({ where, orderBy }: { where?: Row; orderBy?: OrderBy } = {}) => first(where, orderBy),
    findUnique: ({ where }: { where?: Row } = {}) => first(where),
    findFirstOrThrow: ({ where }: { where?: Row } = {}) => first(where).then((row) => row
      ?? Promise.reject(Object.assign(new Error('No record found.'), { code: 'P2025' }))),
    findMany: ({ where, orderBy }: { where?: Row; orderBy?: OrderBy } = {}) =>
      Promise.resolve(sorted(rows.filter((row) => matches(row, where)), orderBy)),
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
    deleteMany: ({ where }: { where?: Row } = {}) => {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], where)) rows.splice(index, 1);
      }
      return Promise.resolve({ count: before - rows.length });
    },
    createMany: ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (clashes(row)) {
          if (skipDuplicates) continue;
          return Promise.reject(uniqueViolation());
        }
        rows.push({ id: Math.random().toString(36).slice(2), ...row });
        count += 1;
      }
      return Promise.resolve({ count });
    },
    create: ({ data }: { data: Row }) => {
      if (clashes(data)) return Promise.reject(uniqueViolation());
      const row = { id: Math.random().toString(36).slice(2), ...data };
      rows.push(row);
      return Promise.resolve(row);
    },
  };
}

/** `uniques` lists each table's unique column sets, enforced on create/createMany like Postgres. */
export function inMemoryDb(seed: Record<string, Row[]>, uniques: Record<string, string[][]> = {}) {
  const tables: Record<string, ReturnType<typeof table>> = {};
  const db: Record<string, unknown> = new Proxy(tables, {
    get(target, name: string) {
      if (name === '$transaction') {
        return (input: unknown) => (typeof input === 'function'
          ? Promise.resolve((input as (tx: unknown) => unknown)(db))
          : Promise.all(input as Promise<unknown>[]));
      }
      if (name === 'then') return undefined;
      if (!(name in target)) target[name] = table((seed[name] ??= []), uniques[name]);
      return target[name];
    },
  });
  return db;
}
