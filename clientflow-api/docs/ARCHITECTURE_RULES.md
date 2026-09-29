# ClientFlow architecture rules

These rules hold for every change. Reviewers reject code that breaks them; several are enforced by
specs (see "Enforcement").

## 1. Compatibility routes are adapters

`src/modules/compatibility/*` exists so older frontend calls keep working. A compatibility handler
may parse and translate a request and shape a response. It must not contain business logic: it
calls the same domain services as every other route (for example, public `/s/:token` form links
go through `PublicFormsService` for token rules). Removing the compatibility layer is Phase 5
work; until then it must not grow new behavior.

## 2. Enrollment is the client→program relationship

`CfProgramEnrollment` is the source of truth for which programs a client is in. Any workflow
decision (intake routing, review, contracts, onboarding, billing, automation) resolves program
context from an enrollment. `CfClient.programId` is a legacy mirror: it may still be written for
older screens, but business logic never reads it.

## 3. Enrollment monitoring is the monitoring model

`CfEnrollmentMonitoring` (with its history and evidence) is canonical. New code does not create
`CfMonitoringTask` rows.

## 4. The security boundary, in order

```
Authentication (ClientflowAuthGuard)
  → AdminUser (organizationId, role)
  → Authorization (role policy) + ownership (OrgScopedRepository)
  → Explicit DTO / allowlist
  → Domain service
  → Database
```

- The organization always comes from the authenticated `AdminUser`, never from a request body or
  query string.
- Every lookup of an organization-owned record by id goes through
  `src/common/tenancy/org-scoped.repository.ts`, which walks the ownership chain
  (organization → client → enrollment → contract / monitoring / terms / documents).
- A record that belongs to another organization is indistinguishable from one that doesn't exist:
  both are `404 Not Found`.
- Foreign ids supplied in a body or URL (a program id on an enrollment, an enrollment id on terms)
  are validated through the same repository before use.

## 5. Request objects never become Prisma data

A request body, query or DTO is never passed as, or spread into, Prisma `data`. Services build the
mutation field by field:

```ts
const data = { name: dto.name.trim(), description: dto.description ?? '' };
await prisma.cfProgram.update({ where: { id, organizationId }, data });
```

Tedious by design: a DTO that later grows a field cannot silently make that column writable.

## 6. Secrets

The API refuses to start without its JWT secrets in every environment except `test`. There is no
built-in fallback secret.

## Enforcement

- `src/common/tenancy/tenancy-scan.spec.ts` fails on id-only client lookups outside the tenancy
  repository and on request bodies passed to Prisma `data`.
- `test/invariants/*.spec.ts` hold the cross-cutting rules (cross-organization access, role
  promotion, token states, and more as later phases land).
