# ClientFlow API

Standalone NestJS/Prisma service for ClientFlow and EA Management.

This application lives inside the `clientflow-hub` repository but is an independent deployable service. It does not receive production traffic, run database migrations on startup, or enable email, n8n, or storage by default.

The first implemented vertical slice creates a client and General Intake assignment, issues a one-time public URL whose token is stored only as a SHA-256 hash, opens/submits that form, updates intake status/program selection, and records activity. n8n intake delivery runs after the database transaction and cannot roll it back.

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

n8n remains non-fatal and defaults off. Enabling it requires `N8N_ENABLED=true`, `N8N_EMAIL_WEBHOOK_URL`, and `CLIENTFLOW_N8N_SECRET`; `N8N_EMAIL_BEARER_TOKEN` is optional.

Implemented routes:

- `POST /api/v1/clients`
- `GET /api/v1/public/forms/:token`
- `POST /api/v1/public/forms/:token/submit`

All compatibility routes still return HTTP 501 until their business services are ported and verified. See `docs/API_ROUTES.md`, `docs/MIGRATION_FROM_API2.md`, and `docs/RENDER_DEPLOYMENT.md`.
