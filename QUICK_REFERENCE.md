# Quick Reference: Environment Variables

## Render Deploy - Minimum Required
```
NODE_ENV=production
VITE_API_URL=https://your-api-url.com
VITE_SENDGRID_API_KEY=SG.xxxxx
VITE_SENDGRID_FROM_EMAIL=noreply@domain.com
VITE_BACKEND_API_KEY=your-key
```

## Cloudflare Deploy - Minimum Required
```toml
# In wrangler.toml
account_id = "your-account-id"
```

## All Variables (Render Dashboard)
```
NODE_ENV=production
VITE_API_URL=https://api.clientflow.app
VITE_SENDGRID_API_KEY=SG.xxxxx
VITE_SENDGRID_FROM_EMAIL=noreply@yourdomain.com
VITE_BACKEND_API_KEY=secret-key
VITE_JWT_SECRET=min-32-characters-secret
VITE_CLOUDFLARE_ACCOUNT_ID=account-id
VITE_CLOUDFLARE_API_TOKEN=token
VITE_CLOUDFLARE_ZONE_ID=zone-id
VITE_SENTRY_DSN=https://xxx
VITE_ANALYTICS_ID=G-xxx
VITE_CORS_ORIGIN=https://clientflow.app
DATABASE_URL=postgresql://...
```

## All Secrets (Cloudflare)
```bash
wrangler secret put VITE_API_URL
wrangler secret put VITE_SENDGRID_API_KEY
wrangler secret put VITE_BACKEND_API_KEY
wrangler secret put VITE_JWT_SECRET
wrangler secret put DATABASE_URL
```

## Where to Find These Values
| Variable | Source |
|----------|--------|
| `VITE_API_URL` | Your backend server URL |
| `VITE_SENDGRID_API_KEY` | SendGrid account settings |
| `VITE_SENDGRID_FROM_EMAIL` | Your sender email address |
| `VITE_BACKEND_API_KEY` | Backend API authentication token |
| `VITE_JWT_SECRET` | Generate: `openssl rand -base64 32` |
| `VITE_CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Account |
| `VITE_CLOUDFLARE_API_TOKEN` | Cloudflare → API Tokens |
| `VITE_CLOUDFLARE_ZONE_ID` | Cloudflare → DNS → Zone ID |
| `VITE_SENTRY_DSN` | Sentry project settings |
| `VITE_ANALYTICS_ID` | Google Analytics 4 property ID |
| `DATABASE_URL` | Your database connection string |
| `VITE_CORS_ORIGIN` | Your frontend domain(s) |

## Deploy Commands
```bash
npm install          # Install dependencies
npm run build        # Build for production
npm run preview      # Preview production build
npm run dev          # Run development server
npm run deploy:render      # Trigger Render deploy
npm run deploy:cloudflare  # Deploy to Cloudflare
```
