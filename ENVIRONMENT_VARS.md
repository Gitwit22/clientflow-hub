# ClientFlow Hub Environment Variables

ClientFlow Hub is deployed to Cloudflare Pages at `https://clientflow-2g9.pages.dev`.

## Frontend

The only application-specific frontend variable is:

```env
VITE_API_URL=https://nxt-lvl-api2.onrender.com
```

The production code already uses that URL as its fallback. Set `VITE_API_URL` in the Cloudflare
Pages build environment only when targeting another API, such as local development.

All `VITE_*` values are embedded in browser assets and are public. Never use them for API keys,
JWT signing secrets, database URLs, provider credentials, or Cloudflare deployment tokens.

## API

Server credentials belong to the `nxt-lvl-api2` Render service. Relevant variables include:

- `DATABASE_URL`
- `CLIENTFLOW_DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN=https://clientflow-2g9.pages.dev`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `EMAIL_SEND_ENABLED=true`
- R2 storage credentials

Do not copy these values into ClientFlow Hub or prefix them with `VITE_`.

## Local Development

Create an untracked `.env` file when the API runs locally:

```env
VITE_API_URL=http://localhost:3000
```

Then run `npm install` and `npm run dev`. See `DEPLOYMENT.md` for deployment steps.