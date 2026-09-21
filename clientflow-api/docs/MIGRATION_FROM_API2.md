# Migration From API 2

## Ownership

ClientFlow API will own ClientFlow identity, organizations, clients, programs, enrollments, forms, public tokens, terms, contracts, monitoring, documents, communications, reports, archive, notifications, audit, email, n8n, and storage. API 2 retains non-ClientFlow applications and copies no ClientFlow runtime dependencies.

The Prisma schema and 15 migrations were copied from `nxt-lvl-api2/prisma/clientflow`. Field names remain camelCase. Migrations are not executed by build or startup.

## Existing data preservation

API 2 remains authoritative. Create a full point-in-time Neon branch/database clone so schema, rows, indexes, constraints, and `_prisma_migrations` are preserved together. Do not rebuild the target by replaying historical migrations and do not run seed, demo-removal, normalization, or cleanup scripts against either database.

Run `scripts/audit-clientflow-clone.sql` separately against source and clone, save the PII-free output, and require an exact diff. The audit compares row counts, deterministic ID fingerprints, migration history, and core ClientFlow orphan counts. Any API 2 writes after the branch point require a fresh clone or a reviewed delta synchronization before cutover.

Rotate all database and n8n credentials exposed during planning before cloning, smoke testing, or deployment. Supply credentials outside committed files and shell history.

## Business rules to preserve

1. Client creation assigns General Intake, generates a secure token, sends intake email, and sets Intake Sent.
2. Intake submission saves responses, records selected programs, and sets Program Selected.
3. Brand Awareness and 30-Day Premier Workshop may auto-send contracts. Event Planning recommends review. Commercial Property, Grant, and Sponsorship require approval. Interest and Other/Unsure require review.
4. Contract completion sends welcome email, enters Onboarding, and creates the first monitoring task.
5. Archive requires a reason, preserves history, never hard-deletes, and supports authorized restore.

## n8n contract

Outbound events are `form.send`, `intake.send`, `contract.send`, `welcome.send`, `form.submitted`, `contract.completed`, and `email.status`. Requests use `x-clientflow-secret`, optional bearer auth, an `Idempotency-Key` matching `eventId`, and a bounded timeout. Valid receipts include `success`, `status`, `eventId`, and `sentAt`.

Workflow names and the sender account must be verified in n8n before enabling delivery.

## Migration order

1. Keep API 2 authoritative and freeze new ClientFlow features there.
2. Port authentication and organization isolation.
3. Create a point-in-time clone and require a clean parity audit before any staging write.
4. Port services domain by domain with parity tests.
5. Configure staging-only email, n8n, and R2 credentials.
6. Verify public form and contract links, lifecycle automation, audit, and archive restore.
7. Switch `VITE_API_URL` only after cookie, CORS, and route compatibility tests pass.
8. Observe production, then disable API 2 ClientFlow routes.
9. Remove API 2 ClientFlow code and environment variables in a separate reviewed change.

## Rollback

Keep API 2 routes and its ClientFlow database path available through the verification window. If cutover fails, pause writes, restore the frontend API URL, disable the new service’s outbound flags, and verify login plus a controlled read before resuming traffic. Never copy data back without a reviewed reconciliation plan.
