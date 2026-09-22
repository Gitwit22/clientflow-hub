# ClientFlow Hub Deployment Guide

## Overview

ClientFlow Hub is a TanStack Start + React application deployed primarily to Cloudflare Pages.
The production site is `https://clientflow-2g9.pages.dev` and the production API is
`https://clientflow-vjqd.onrender.com`.

> `VITE_*` values are public browser configuration. Never put email provider keys, JWT secrets,
> database URLs, backend credentials, or Cloudflare API tokens in a `VITE_*` variable.

The repository contains the standalone EA Management API at `clientflow-api/`. Render treats it
as a second web service with that directory as its service root. The frontend routes all
ClientFlow traffic to this service.

---

## Render Deployment

### Prerequisites
- Render account at https://render.com
- Git repository connected to Render

### Step 1: Create Service on Render
1. Log in to Render Dashboard
2. Click **New +** → **Web Service**
3. Connect your Git repository
4. Fill in the configuration:
   - **Name**: `clientflow-hub`
   - **Region**: Choose your region
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run preview`
   - **Plan**: Starter ($7/month)

### Step 2: Set Environment Variables
In Render Dashboard, go to **Environment**:

```
NODE_ENV=production
VITE_CLIENTFLOW_API_URL=https://clientflow-vjqd.onrender.com
```

### Step 3: Deploy
Render automatically deploys when you push to your branch.

---

## Cloudflare Workers/Pages Deployment

### Prerequisites
- Cloudflare account at https://cloudflare.com
- Wrangler CLI installed: `npm install -g wrangler`
- Authenticated with: `wrangler login`

### Step 1: Configure wrangler.toml
Update `wrangler.toml` with your settings:
```toml
account_id = "your-account-id"
```

### Step 2: Configure the API URL
The application defaults to `https://clientflow-vjqd.onrender.com`. Set `VITE_CLIENTFLOW_API_URL` as a
Cloudflare Pages build variable only when deploying against a different API.

### Step 3: Deploy
```bash
wrangler deploy --env production
```

---

## Environment Variables Reference

### Required Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Deployment environment | `production` |
| `VITE_CLIENTFLOW_API_URL` | EA Management API URL | `https://clientflow-vjqd.onrender.com` |

Email is delivered through n8n by the EA Management API. Configure `N8N_ENABLED`,
`N8N_EMAIL_WEBHOOK_URL`, `CLIENTFLOW_N8N_SECRET`, and any optional bearer token only on the API service.

---

## Build and Preview Locally

### Development
```bash
npm install
npm run dev
```

### Production Build
```bash
npm run build
npm run preview
```

---

## Troubleshooting

### Build Fails on Render
- Check build logs in Render Dashboard
- Ensure `npm install` completes successfully
- Verify all environment variables are set

### API Connection Issues
- Verify `VITE_CLIENTFLOW_API_URL` is correct and accessible
- Check backend service is running
- Review CORS settings on backend

### Cloudflare Deployment Issues
- Ensure `wrangler.toml` account ID is correct
- Run `wrangler whoami` to verify authentication
- Check file sizes (Cloudflare has limits)

---

## Removed Bun Configuration

This project has been migrated from Bun to npm:
- ❌ Removed: `bunfig.toml`
- ✅ Using: `package-lock.json` (npm)
- ✅ Using: `npm install` for dependency management

All scripts now use npm instead of Bun.

---

## Next Steps

1. Update `.env.example` with your actual service endpoints
2. Configure API backend URL in environment variables
3. Configure n8n on the API service before sending forms
4. Test locally with `npm run dev`
5. Deploy to Render or Cloudflare
