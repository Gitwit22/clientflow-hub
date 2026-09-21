# ClientFlow Hub Deployment Guide

## Overview

ClientFlow Hub is a TanStack Start + React application deployed primarily to Cloudflare Pages.
The production site is `https://clientflow-2g9.pages.dev` and the production API is
`https://nxt-lvl-api2.onrender.com`.

> `VITE_*` values are public browser configuration. Never put email provider keys, JWT secrets,
> database URLs, backend credentials, or Cloudflare API tokens in a `VITE_*` variable.

The repository also contains the future standalone API at `clientflow-api/`. Render treats it as
a second web service with that directory as its service root. Automatic deployment and outbound
integrations are disabled, and the frontend remains pointed at API 2 until the migration gates in
`clientflow-api/docs/RENDER_DEPLOYMENT.md` pass.

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
VITE_API_URL=https://nxt-lvl-api2.onrender.com
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
The application defaults to `https://nxt-lvl-api2.onrender.com`. Set `VITE_API_URL` as a
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
| `VITE_API_URL` | Backend API URL | `https://api.clientflow.app` |

Email is sent by `nxt-lvl-api2`. Configure `RESEND_API_KEY`, `EMAIL_FROM`,
`EMAIL_REPLY_TO`, and `EMAIL_SEND_ENABLED` only on the API service.

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
- Verify `VITE_API_URL` is correct and accessible
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
3. Configure Resend on the API service if sending forms
4. Test locally with `npm run dev`
5. Deploy to Render or Cloudflare
