# ClientFlow Hub Environment Variables

ClientFlow Hub is deployed to Cloudflare Pages at `https://clientflow-2g9.pages.dev`.

## Frontend

The only application-specific frontend variable is:

```env
VITE_CLIENTFLOW_API_URL=https://clientflow-vjqd.onrender.com
```

The production code already uses that URL as its fallback. Set `VITE_CLIENTFLOW_API_URL` in the Cloudflare
Pages build environment only when targeting another API, such as local development.

All `VITE_*` values are embedded in browser assets and are public. Never use them for API keys,
JWT signing secrets, database URLs, provider credentials, or Cloudflare deployment tokens.

## API

Server credentials belong to the EA Management Render service. Relevant variables include:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `CORS_ORIGIN=https://clientflow-2g9.pages.dev`
- `N8N_ENABLED=true`
- `N8N_EMAIL_WEBHOOK_URL`
- `CLIENTFLOW_N8N_SECRET`
- `N8N_EMAIL_BEARER_TOKEN`
- R2 storage credentials

Do not copy these values into ClientFlow Hub or prefix them with `VITE_`.

### Support Hub monitoring

ClientFlow reports server errors and failed email deliveries to Support Hub, and Support Hub polls
ClientFlow's health. All of it is optional: with these unset, ClientFlow behaves exactly as before.

| Variable | Purpose |
|---|---|
| `SUPPORT_HUB_URL` | Support Hub base URL, e.g. `https://support.example.com` (https in production). |
| `SUPPORT_HUB_TELEMETRY_KEY` | The `shk_…` key Support Hub issued for this application environment. |
| `SUPPORT_HUB_ENVIRONMENT` | Optional override (`production` / `staging` / `development`); defaults from `NODE_ENV`. |
| `HEALTH_DEPENDENCIES_TOKEN` | 32+ character bearer token for `GET /api/v1/health/dependencies`. The endpoint returns 404 when unset. |

Telemetry is fire-and-forget: a slow or unavailable Support Hub never delays or fails a ClientFlow
request. A partial or malformed configuration disables telemetry with one warning in the logs; it never
stops the API from starting. Only operational metadata is sent (component, error code, route template,
request id, HTTP status), never client names, emails, form answers, contract content or tokens.

Health endpoints for Support Hub to poll:

| Endpoint | Auth | Meaning |
|---|---|---|
| `GET /api/v1/health/live` | none | Process is up. |
| `GET /api/v1/health/ready` | none | Database reachable and all migrations applied (503 otherwise). |
| `GET /api/v1/health/dependencies` | `Authorization: Bearer $HEALTH_DEPENDENCIES_TOKEN` | Database, email pipeline and storage. 503 when the database is down; 200 with `X-Health-Status: degraded` when most emails in the last hour failed or email is not configured. |

## Local Development

Create an untracked `.env` file when the API runs locally:

```env
VITE_CLIENTFLOW_API_URL=http://localhost:4001
```

Then run `npm install` and `npm run dev`. See `DEPLOYMENT.md` for deployment steps.