# Required Environment Variables - Render & Cloudflare Deployment

## Summary of Changes

✅ **Removed Bun Configuration**
- `bunfig.toml` removed from tracking (added to .gitignore)
- Switched to npm package management
- Updated all build scripts to use npm

✅ **Created Deployment Infrastructure**
- `render.yaml` - Render Web Service configuration
- `wrangler.toml` - Cloudflare Workers/Pages configuration
- `.env.example` - Environment variables template
- `DEPLOYMENT.md` - Complete deployment guide

✅ **Updated Build Scripts**
- Added `deploy:render` script
- Added `deploy:cloudflare` script
- Added `start` script for production

---

## RENDER Environment Variables

### Essential (Required)
```
NODE_ENV=production
VITE_API_URL=https://api.clientflow.app
```

### Email Service (SendGrid)
```
VITE_SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxx
VITE_SENDGRID_FROM_EMAIL=noreply@yourdomain.com
```

### Backend Authentication
```
VITE_BACKEND_API_KEY=your-secret-backend-key-here
```

### Optional
```
VITE_SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
VITE_ANALYTICS_ID=G-XXXXXXXX
```

### Database (if applicable)
```
DATABASE_URL=postgresql://user:password@localhost:5432/clientflow
```

### Security
```
VITE_JWT_SECRET=your-jwt-secret-key-minimum-32-characters
VITE_CORS_ORIGIN=https://clientflow.app,https://www.clientflow.app
```

---

## CLOUDFLARE Environment Variables

### Secrets (stored securely - not visible in wrangler.toml)
```bash
# Set via: wrangler secret put VARIABLE_NAME
wrangler secret put VITE_API_URL
wrangler secret put VITE_SENDGRID_API_KEY
wrangler secret put VITE_BACKEND_API_KEY
wrangler secret put VITE_JWT_SECRET
wrangler secret put DATABASE_URL
```

### Configuration Variables (in wrangler.toml)
```toml
[env.production.vars]
NODE_ENV = "production"
VITE_SENDGRID_FROM_EMAIL = "noreply@yourdomain.com"
ENVIRONMENT = "production"

[env.staging.vars]
NODE_ENV = "staging"
VITE_SENDGRID_FROM_EMAIL = "staging-noreply@yourdomain.com"
ENVIRONMENT = "staging"
```

### Cloudflare Specific Config
```
VITE_CLOUDFLARE_ACCOUNT_ID=your-12-digit-account-id
VITE_CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
VITE_CLOUDFLARE_ZONE_ID=your-zone-id-for-domain
```

---

## Service Variables by Function

### API Backend
- `VITE_API_URL` - Main backend endpoint
- `VITE_BACKEND_API_KEY` - Authentication key for backend
- `DATABASE_URL` - Database connection string

### Email (SendGrid)
- `VITE_SENDGRID_API_KEY` - SendGrid account API key
- `VITE_SENDGRID_FROM_EMAIL` - Default sender email address

### Security
- `VITE_JWT_SECRET` - Secret for signing JWT tokens
- `VITE_CORS_ORIGIN` - Comma-separated list of allowed origins

### Monitoring
- `VITE_SENTRY_DSN` - Sentry error tracking endpoint
- `VITE_ANALYTICS_ID` - Google Analytics tracking ID

### Deployment
- `NODE_ENV` - Set to `production` for Render/Cloudflare
- `ENVIRONMENT` - Specific environment tag (production/staging)

---

## Deployment Checklist

### Before Deploying to Render
- [ ] Copy `.env.example` → `.env.production`
- [ ] Fill in all REQUIRED variables
- [ ] Test locally: `npm install && npm run dev`
- [ ] Build successfully: `npm run build`
- [ ] Push to Git repository
- [ ] Create Render Web Service
- [ ] Configure environment variables in Render dashboard
- [ ] Deploy via Git webhook or manual trigger

### Before Deploying to Cloudflare
- [ ] Install Wrangler: `npm install -g @cloudflare/wrangler`
- [ ] Authenticate: `wrangler login`
- [ ] Update `wrangler.toml` with your account ID
- [ ] Set secrets: `wrangler secret put VARIABLE_NAME`
- [ ] Test locally: `npm install && npm run build`
- [ ] Deploy: `npm run deploy:cloudflare`

---

## Quick Start Commands

### Local Development
```bash
npm install
npm run dev
```

### Production Build
```bash
npm run build
npm run preview
```

### Deploy to Render
```bash
# Configure in Render dashboard
# Push to Git → Automatic deployment
npm run deploy:render
```

### Deploy to Cloudflare
```bash
npm run deploy:cloudflare
```

---

## File Structure After Setup

```
clientflow-hub/
├── .env.example              # Template for environment variables
├── .env                       # Your local/development environment
├── .env.production            # Production environment variables
├── .gitignore                # Updated with deployment files
├── render.yaml              # Render deployment configuration
├── wrangler.toml            # Cloudflare deployment configuration
├── DEPLOYMENT.md            # Detailed deployment guide
├── ENVIRONMENT_VARS.md      # This file
├── package.json             # Updated with deployment scripts
├── vite.config.ts
└── src/
    ├── server.ts
    ├── start.ts
    └── ...
```

---

## Notes

1. **Bun has been deprecated** - All build scripts now use npm
2. **Choose ONE deployment platform** - Render (simpler) or Cloudflare (faster/global)
3. **Environment variables are NOT committed** - Keep `.env` in `.gitignore`
4. **Production builds** use `vite build` which optimizes for performance
5. **SendGrid integration** requires a valid API key if email features are used

---

## Support

For issues:
1. Check `DEPLOYMENT.md` for troubleshooting steps
2. Review environment variable values
3. Check build logs in Render dashboard or `wrangler build`
4. Verify backend API is accessible from your deployment platform
