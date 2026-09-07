# ClientFlow Deployment Summary

## Production Topology

- Frontend: Cloudflare Pages at `https://clientflow-2g9.pages.dev`
- API: Render at `https://nxt-lvl-api2.onrender.com`
- Authentication: HttpOnly access and refresh cookies issued by the API
- Email: Resend from the API service
- Data and object storage: configured only on the API service

## Frontend Configuration

`VITE_API_URL` is the only application-specific frontend variable. It is public browser
configuration, not secret storage. The production fallback already points to the Render API.

Build and deploy with `npm test`, `npm run lint`, `npm run build`, and
`npm run deploy:cloudflare`.

## Server Configuration

The API owns JWT, database, Resend, R2, and CORS configuration. Its `CORS_ORIGIN` must include
`https://clientflow-2g9.pages.dev`. See the API `render.yaml` and frontend `DEPLOYMENT.md` for the
current variable names and verification steps.