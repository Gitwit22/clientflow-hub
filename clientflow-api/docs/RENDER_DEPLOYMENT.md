# Render Deployment

## Blueprint shape

The repository root `render.yaml` defines the existing frontend and a separate `clientflow-api` web service. The API uses `rootDir: clientflow-api`, Node, `npm ci && npm run build`, `npm run start:prod`, and `/api/v1/health/live`.

`autoDeploy` is disabled. Creating the blueprint must not switch frontend traffic.

## Initial non-production deployment

1. Connect the existing `clientflow-hub` repository in Render.
2. Select the `clientflow-api` service from the blueprint.
3. Keep automatic deployment disabled.
4. Supply a dedicated non-production `DATABASE_URL`; never reuse a legacy source `DATABASE_URL`.
5. Generate separate access and refresh JWT secrets.
6. Set the staging frontend origin in `CORS_ORIGIN` and API URL in `APP_URL`.
7. Leave `EMAIL_SEND_ENABLED`, `N8N_ENABLED`, and `STORAGE_ENABLED` set to `false`.
8. Deploy manually and verify `/api/v1/health/live`.
9. Confirm representative business routes return HTTP 501 before any parity port is declared ready.

## Migration gate

Build and start never execute Prisma migrations. After the target database is approved and backed up, review `prisma migrate status` and run `npm run prisma:deploy` as an explicit Render pre-deploy operation.

## Cutover gate

Set the production frontend `VITE_CLIENTFLOW_API_URL`, attach a production custom domain, enable outbound integrations, and change DNS only after authentication, organization isolation, route parity, public links, lifecycle automation, storage, n8n receipts, audit, monitoring, and rollback have passed staging tests.

## Rollback

Disable outbound flags, restore the previous frontend API URL, and keep the new service online only for diagnosis. Database rollback requires a backup/forward-fix decision; do not automatically reverse Prisma migrations.
