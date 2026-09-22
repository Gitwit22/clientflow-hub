# ClientFlow Migration History

## Ownership

ClientFlow API owns ClientFlow identity, organizations, clients, programs, enrollments, forms, public tokens, terms, contracts, monitoring, documents, communications, reports, archive, notifications, audit, email, n8n, and storage. The former service retains non-ClientFlow applications and copies no ClientFlow runtime dependencies.

The Prisma schema and migrations were copied from the legacy ClientFlow data path. Field names remain camelCase. Migrations are not executed by build or startup.

## Existing data preservation

Create a full point-in-time Neon branch/database clone so schema, rows, indexes, constraints, and `_prisma_migrations` are preserved together. Do not rebuild the target by replaying historical migrations and do not run seed, demo-removal, normalization, or cleanup scripts against either database.

Run `scripts/audit-clientflow-clone.sql` separately against source and clone, save the PII-free output, and require an exact diff. The audit compares row counts, deterministic ID fingerprints, migration history, and core ClientFlow orphan counts. Any legacy writes after the branch point require a fresh clone or a reviewed delta synchronization before cutover.

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

`contract.send` contains organization/client IDs, recipient email/client name, program name, contract name, one-time contract URL, and a `YYYY-MM-DD` due date. Contract issue first records a `CfCommunication` row with `requested` or `skipped`, then updates it to `sent` or `failed` after enabled delivery. The contract remains issued when delivery is skipped or fails.

`welcome.send` contains organization/client IDs, recipient email/client name, program name, and the fixed onboarding next step. Contract acceptance records the communication before delivery; successful delivery adds `WELCOME_SENT` activity while the client remains `ONBOARDING`.

## Contract workflow migration

Migration `20260921120000_add_contract_workflow` is additive and must be reviewed before it is applied to a validated clone. It creates organization-scoped contract templates, adds hashed token/expiry/template/completion fields to existing contracts, and links communications to contracts. It preserves the physical legacy `CfContract.content` column as `generatedContent`, existing optional compatibility columns, and unknown historical status values.

The migration seeds seven deterministic placeholder templates per represented organization and backfills every existing contract to a matching template or General Services Agreement. No production migration is run by build or startup. The expanded clone audit must show expected template rows and zero new client/program/template/event orphans before staging writes are enabled.

Migration `20260922120000_add_contract_acceptance_and_onboarding` is also additive and review-only. It adds nullable acceptance/audit fields to existing contracts and creates `CfMonitoringTask` for contract-triggered follow-up without reviving the deliberately removed legacy `CfMonitoringItem` table. Existing rows are not rewritten. Apply it only to an approved clone after the contract workflow migration.

## Migration order

1. Freeze legacy ClientFlow writes before switching production traffic.
2. Port authentication and organization isolation.
3. Create a point-in-time clone and require a clean parity audit before any staging write.
4. Port services domain by domain with parity tests.
5. Configure staging-only email, n8n, and R2 credentials.
6. Verify public form and contract links, lifecycle automation, audit, and archive restore.
7. Set `VITE_CLIENTFLOW_API_URL` only after cookie, CORS, and route compatibility tests pass.
8. Observe production, then disable legacy ClientFlow routes.
9. Remove legacy ClientFlow code and environment variables in a separate reviewed change.

## Rollback

Keep the legacy routes and ClientFlow database path available through the verification window. If cutover fails, pause writes, restore the frontend ClientFlow API URL, disable the new service’s outbound flags, and verify login plus a controlled read before resuming traffic. Never copy data back without a reviewed reconciliation plan.