# ClientFlow Deployment Summary

## Production Topology

- Frontend: Cloudflare Pages at `https://clientflow-2g9.pages.dev`
- API: EA Management Render service at `https://clientflow-vjqd.onrender.com`
- Authentication: HttpOnly access and refresh cookies issued by the API
- Email: n8n from the EA Management API service
- Data and object storage: configured only on the API service

## Frontend Configuration

`VITE_CLIENTFLOW_API_URL` is the only application-specific frontend variable. It is public browser
configuration, not secret storage. The production fallback already points to the EA Management API.

Build and deploy with `npm test`, `npm run lint`, `npm run build`, and
`npm run deploy:cloudflare`.

## Server Configuration

The API owns JWT, database, n8n, R2, and CORS configuration. Its `CORS_ORIGIN` must include
`https://clientflow-2g9.pages.dev`. See the API `render.yaml` and frontend `DEPLOYMENT.md` for the
current variable names and verification steps.