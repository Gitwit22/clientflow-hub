# ClientFlow API

Standalone NestJS/Prisma service for ClientFlow and EA Management.

This application lives inside the `clientflow-hub` repository but is an independent deployable service. It does not receive production traffic, run database migrations on startup, or enable email, n8n, or storage by default.

The first implemented vertical slice creates a client and General Intake assignment, issues a one-time public URL whose token is stored only as a SHA-256 hash, opens/submits that form, updates intake status/program selection, and records activity. n8n intake delivery runs after the database transaction and cannot roll it back.

The second slice resolves selected programs, evaluates contract rules, generates and issues auto-contracts, or places the client in staff review. The third slice opens and accepts public contracts, moves completed clients to onboarding, creates their initial follow-up task, and records non-fatal welcome delivery.

## Local commands

```powershell
npm install
npm run prisma:generate
npm test
npm run lint
npm run build
npm run start:dev
```

The local API defaults to `http://localhost:4001`. Health is available at `/api/v1/health/live` and Swagger at `/api/docs`.

## Live slice configuration

Use only a validated point-in-time clone for staging. Set `DATABASE_URL` to that clone and set `APP_URL` to the ClientFlow frontend origin. Client creation also requires `ALLOW_UNAUTHENTICATED_CLIENT_CREATION=true`; environment validation prevents this temporary flag in production.

Staff contract generation and send routes require `ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT=true`. Environment validation also prevents this temporary flag in production.

n8n remains non-fatal and defaults off. Enabling it requires `N8N_ENABLED=true`, `N8N_EMAIL_WEBHOOK_URL`, and `CLIENTFLOW_N8N_SECRET`; `N8N_EMAIL_BEARER_TOKEN` is optional.

Implemented routes:

- `POST /api/v1/clients`
- `GET /api/v1/public/forms/:token`
- `POST /api/v1/public/forms/:token/submit`
- `POST /api/v1/clients/:id/contracts/generate`
- `POST /api/v1/clients/:id/contracts/send`
- `GET /api/v1/public/contracts/:token`
- `POST /api/v1/public/contracts/:token`

All compatibility routes still return HTTP 501 until their business services are ported and verified. See `docs/API_ROUTES.md`, `docs/CONTRACT_LIFECYCLE.md`, `docs/MIGRATION_FROM_API2.md`, and `docs/RENDER_DEPLOYMENT.md`.

Do not run Prisma migrations against API 2 or production. After credential rotation and explicit approval, apply the reviewed migration only to a fresh validated clone.

## Contract smoke checks

After a rotated, validated clone is explicitly approved and migrated, start with n8n disabled:

```powershell
$env:ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT = "true"
$env:N8N_ENABLED = "false"
npm run start:dev
```

In another terminal, use IDs from a dedicated staging test client:

```powershell
$generated = Invoke-RestMethod -Method Post `
	-Uri "http://localhost:4001/api/v1/clients/client_123/contracts/generate"

$body = @{ contractId = $generated.contract.id } | ConvertTo-Json
$sent = Invoke-RestMethod -Method Post `
	-Uri "http://localhost:4001/api/v1/clients/client_123/contracts/send" `
	-ContentType "application/json" `
	-Body $body

$token = ($sent.publicContractUrl -split '/')[-1]
Invoke-RestMethod -Uri "http://localhost:4001/api/v1/public/contracts/$token"

$acceptance = @{
	signedName = "Staging Client"
	signedEmail = "staging-client@example.com"
	agreedToTerms = $true
	signatureNote = "Staging acceptance test"
} | ConvertTo-Json
Invoke-RestMethod -Method Post `
	-Uri "http://localhost:4001/api/v1/public/contracts/$token" `
	-ContentType "application/json" `
	-Body $acceptance
```

Expected results are a safe generated contract response, `SENT` plus skipped contract delivery, `OPENED` after the public GET, and `COMPLETED` with client status `ONBOARDING`, one pending `Initial Follow-Up`, and skipped welcome delivery after POST. Never run these commands against API 2 or production.
