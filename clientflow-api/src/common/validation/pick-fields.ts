import { BadRequestException } from '@nestjs/common';

/**
 * Builds Prisma mutation data from an explicit per-field allowlist (docs/ARCHITECTURE_RULES.md
 * rule 5). Only listed fields are read; each is type-checked and converted. Unlisted keys are
 * ignored, so identifiers and ownership columns (id, organizationId, clientId, tokens, isDemo…)
 * can never be written through a generic update, whatever the request contains.
 */
export type FieldKind =
  | 'string'
  | 'nullableString'
  | 'number'
  | 'int'
  | 'boolean'
  | 'date'
  | 'nullableDate'
  | 'stringArray'
  | 'jsonObject'
  | 'jsonArray'
  | { oneOf: readonly string[] };

export type FieldSpec = Record<string, FieldKind>;

function fail(field: string, expected: string): never {
  throw new BadRequestException(`${field} must be ${expected}.`);
}

function convert(field: string, kind: FieldKind, value: unknown): unknown {
  if (typeof kind === 'object') {
    if (typeof value !== 'string' || !kind.oneOf.includes(value)) fail(field, `one of: ${kind.oneOf.join(', ')}`);
    return value;
  }
  switch (kind) {
    case 'string':
      if (typeof value !== 'string') fail(field, 'a string');
      return value;
    case 'nullableString':
      if (value !== null && typeof value !== 'string') fail(field, 'a string or null');
      return value;
    case 'number': {
      const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof number !== 'number' || !Number.isFinite(number)) fail(field, 'a number');
      return number;
    }
    case 'int': {
      const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof number !== 'number' || !Number.isInteger(number)) fail(field, 'a whole number');
      return number;
    }
    case 'boolean':
      if (typeof value !== 'boolean') fail(field, 'true or false');
      return value;
    case 'date':
    case 'nullableDate': {
      if (kind === 'nullableDate' && (value === null || value === '')) return null;
      const date = typeof value === 'string' || value instanceof Date ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) fail(field, 'a valid date');
      return date;
    }
    case 'stringArray':
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) fail(field, 'a list of strings');
      return value;
    case 'jsonObject':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field, 'an object');
      return value;
    case 'jsonArray':
      if (!Array.isArray(value)) fail(field, 'a list');
      return value;
  }
}

export function pickFields(body: unknown, spec: FieldSpec): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('A JSON object body is required.');
  }
  const input = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(spec)) {
    if (input[field] === undefined) continue;
    data[field] = convert(field, kind, input[field]);
  }
  return data;
}
