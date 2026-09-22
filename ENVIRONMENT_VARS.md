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

## Local Development

Create an untracked `.env` file when the API runs locally:

```env
VITE_CLIENTFLOW_API_URL=http://localhost:4001
```

Then run `npm install` and `npm run dev`. See `DEPLOYMENT.md` for deployment steps.