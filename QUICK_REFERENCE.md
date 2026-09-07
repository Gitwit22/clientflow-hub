# Quick Reference: Environment Variables

## Frontend Configuration
```
NODE_ENV=production
VITE_API_URL=https://nxt-lvl-api2.onrender.com
```

`VITE_*` values are public. Never store credentials in them.

## Cloudflare Deploy - Minimum Required
```toml
# In wrangler.toml
account_id = "your-account-id"
```

## Where to Find These Values
| Variable | Source |
|----------|--------|
| `VITE_API_URL` | Your backend server URL |

Email, JWT, database, storage, and CORS secrets belong to `nxt-lvl-api2` on Render.

## Deploy Commands
```bash
npm install          # Install dependencies
npm run build        # Build for production
npm run preview      # Preview production build
npm run dev          # Run development server
npm run deploy:render      # Trigger Render deploy
npm run deploy:cloudflare  # Deploy to Cloudflare
```
