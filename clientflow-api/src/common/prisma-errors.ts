/** True when a Prisma error is a unique-constraint violation (P2002). */
export function isPrismaUniqueViolation(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}
