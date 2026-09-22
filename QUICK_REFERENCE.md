# Quick Reference: Environment Variables

## Frontend Configuration
```
NODE_ENV=production
VITE_CLIENTFLOW_API_URL=https://clientflow-vjqd.onrender.com
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
| `VITE_CLIENTFLOW_API_URL` | EA Management API URL |

Email, JWT, database, storage, and CORS secrets belong to the EA Management API service on Render.

## Deploy Commands
```bash
npm install          # Install dependencies
npm run build        # Build for production
npm run preview      # Preview production build
npm run dev          # Run development server
npm run deploy:render      # Trigger Render deploy
npm run deploy:cloudflare  # Deploy to Cloudflare
```
