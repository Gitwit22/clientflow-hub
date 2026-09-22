# ClientFlow Deployment Checklist

## Cloudflare Pages

- [ ] Production URL is `https://clientflow-2g9.pages.dev`.
- [ ] `npm test`, `npm run lint`, and `npm run build` pass.
- [ ] `VITE_CLIENTFLOW_API_URL` is set to the intended public EA Management API.
- [ ] No email, JWT, database, storage, backend, or Cloudflare credentials use a `VITE_*` name.
- [ ] The built assets contain no API keys or secret values.

## Render API

- [ ] `CORS_ORIGIN` includes exactly `https://clientflow-2g9.pages.dev` and approved custom domains.
- [ ] Database, JWT, n8n, and R2 credentials exist only on the API service.
- [ ] `N8N_ENABLED`, `N8N_EMAIL_WEBHOOK_URL`, and `CLIENTFLOW_N8N_SECRET` are configured for email delivery.
- [ ] Both Prisma migrations complete during deployment.
- [ ] API build and tests pass.

## Smoke Test

- [ ] Login establishes secure session and refresh cookies.
- [ ] Dashboard bootstrap loads clients, programs, and all paginated collections.
- [ ] A failed collection displays the retry state instead of empty data.
- [ ] Public form links load and submit with `X-App-Partition: clientflow`.
- [ ] Missing or unknown partitions are rejected on ClientFlow-owned routes.
- [ ] An unapproved origin cannot make credentialed state-changing requests.