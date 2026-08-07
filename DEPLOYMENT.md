# ClientFlow Hub Deployment Guide

## Overview

ClientFlow Hub is a TanStack Start + React application that can be deployed to:
- **Render** (recommended for beginners)
- **Cloudflare Workers/Pages** (recommended for edge deployment)
- **Any Node.js-compatible platform**

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
VITE_API_URL=https://your-backend-url.com
VITE_SENDGRID_API_KEY=SG.xxxxx
VITE_SENDGRID_FROM_EMAIL=noreply@yourdomain.com
VITE_BACKEND_API_KEY=your-secret-key
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

### Step 2: Set Secrets
```bash
wrangler secret put VITE_API_URL
wrangler secret put VITE_SENDGRID_API_KEY
wrangler secret put VITE_BACKEND_API_KEY
```

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

### Optional Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_SENDGRID_API_KEY` | SendGrid API key for emails | (none) |
| `VITE_SENDGRID_FROM_EMAIL` | Sender email address | (none) |
| `VITE_BACKEND_API_KEY` | Backend authentication key | (none) |
| `VITE_SENTRY_DSN` | Sentry error tracking | (none) |
| `VITE_ANALYTICS_ID` | Google Analytics ID | (none) |

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
3. Set up email service (SendGrid) if sending forms
4. Test locally with `npm run dev`
5. Deploy to Render or Cloudflare
