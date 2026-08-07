# Environment Variables Checklist

## ✅ Render Deployment Checklist

Add these to **Render Dashboard → Environment** section:

### Essential (Required)
- [ ] `NODE_ENV` = `production`
- [ ] `VITE_API_URL` = `https://your-backend-url.com/api`

### Email Service
- [ ] `VITE_SENDGRID_API_KEY` = `SG.xxxxxxxxxxxxx`
- [ ] `VITE_SENDGRID_FROM_EMAIL` = `noreply@yourdomain.com`

### Backend Integration
- [ ] `VITE_BACKEND_API_KEY` = `your-secret-key`

### Security
- [ ] `VITE_JWT_SECRET` = `generate-32-char-secret`
- [ ] `VITE_CORS_ORIGIN` = `https://yourdomain.com`

### Database (Optional)
- [ ] `DATABASE_URL` = `postgresql://user:pass@host:5432/db`

### Monitoring (Optional)
- [ ] `VITE_SENTRY_DSN` = `https://xxxxx@xxxxx.ingest.sentry.io/xxxxx`
- [ ] `VITE_ANALYTICS_ID` = `G-XXXXXXXXXX`

---

## ✅ Cloudflare Deployment Checklist

### Configuration (in wrangler.toml)
- [ ] Update `account_id` with your Cloudflare account ID
- [ ] Update `name` for your project
- [ ] Set correct `type = "javascript"`

### Secrets (run via CLI)
```bash
wrangler secret put VITE_API_URL
wrangler secret put VITE_SENDGRID_API_KEY
wrangler secret put VITE_BACKEND_API_KEY
wrangler secret put VITE_JWT_SECRET
wrangler secret put DATABASE_URL
```

- [ ] `VITE_API_URL` = `https://your-backend-url.com/api`
- [ ] `VITE_SENDGRID_API_KEY` = `SG.xxxxxxxxxxxxx`
- [ ] `VITE_BACKEND_API_KEY` = `your-secret-key`
- [ ] `VITE_JWT_SECRET` = `generate-32-char-secret`
- [ ] `DATABASE_URL` = `postgresql://...` (if needed)

### Environment Variables (in wrangler.toml vars section)
- [ ] `NODE_ENV` = `production`
- [ ] `VITE_SENDGRID_FROM_EMAIL` = `noreply@yourdomain.com`
- [ ] `VITE_CORS_ORIGIN` = `https://yourdomain.com`

---

## 📋 Variable Values Reference

### Getting Your Values

**Render Account Setup**
```
1. Go to https://render.com
2. Create account or login
3. Create Web Service
4. Navigate to Environment settings
5. Add each variable from above
```

**Cloudflare Account Setup**
```
1. Go to https://cloudflare.com
2. Account ID: Dashboard → Account Home → Account ID (right sidebar)
3. API Token: Account Home → API Tokens → Create Token
4. Zone ID: Select domain → Overview → Zone ID (right sidebar)
```

**SendGrid Setup**
```
1. Go to https://sendgrid.com
2. Sign up or login
3. Settings → API Keys → Create API Key
4. Use the key as VITE_SENDGRID_API_KEY
5. Settings → Sender Authentication → Verify sender email
```

**Backend API Key**
```
Ask your backend developer (nxt-lvl-api2 team)
This is used to authenticate requests from frontend to backend
```

**JWT Secret**
```
Generate with: openssl rand -base64 32
Or: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
Minimum 32 characters
```

---

## 🎯 Priority Order

### Phase 1: Minimum Viable Deployment
1. ✅ Set `NODE_ENV=production`
2. ✅ Set `VITE_API_URL` (your backend)
3. ✅ Deploy to Render OR Cloudflare
4. ✅ Test basic functionality

### Phase 2: Add Email Capability
1. ✅ Create SendGrid account
2. ✅ Set `VITE_SENDGRID_API_KEY`
3. ✅ Set `VITE_SENDGRID_FROM_EMAIL`
4. ✅ Test email sending

### Phase 3: Security & Production Hardening
1. ✅ Set `VITE_JWT_SECRET`
2. ✅ Set `VITE_CORS_ORIGIN` to production domain
3. ✅ Set `VITE_BACKEND_API_KEY`
4. ✅ Enable HTTPS/SSL
5. ✅ Configure firewall rules

### Phase 4: Monitoring & Analytics (Optional)
1. ✅ Create Sentry account (error tracking)
2. ✅ Set `VITE_SENTRY_DSN`
3. ✅ Setup Google Analytics
4. ✅ Set `VITE_ANALYTICS_ID`

---

## 🚀 Deployment Flow

```
1. Local Development
   ├─ npm install
   ├─ npm run dev
   └─ Test with npm run build && npm run preview

2. Choose Platform
   ├─ Option A: Render
   │  ├─ Create Web Service
   │  ├─ Add environment variables
   │  ├─ Connect Git repo
   │  └─ Deploy
   └─ Option B: Cloudflare
      ├─ Install wrangler
      ├─ wrangler login
      ├─ wrangler secret put (each secret)
      └─ npm run deploy:cloudflare

3. Post-Deployment
   ├─ Test URLs (both platform + domain)
   ├─ Check error logs
   ├─ Test API connectivity
   └─ Monitor with Sentry (optional)
```

---

## 📱 Testing After Deployment

### Test Checklist
- [ ] Access main page (loads without errors)
- [ ] Navigation works (sidebar links)
- [ ] Dashboard displays data
- [ ] Client list loads
- [ ] Create new client (if connected to backend)
- [ ] Send form (if SendGrid configured)
- [ ] Check browser console (no errors)
- [ ] Check server logs (any warnings?)
- [ ] Test on mobile (responsive design)

### Debugging If Issues Occur

**Render**
```
1. Go to Render Dashboard
2. Select your service
3. Logs tab → View full logs
4. Look for errors near the top
```

**Cloudflare**
```
1. Run: wrangler tail
2. Make requests to your domain
3. Watch the live logs in terminal
```

**General**
```
1. Check browser DevTools Console (F12)
2. Network tab → Check API calls
3. Check if VITE_API_URL is correct
4. Verify backend is running/accessible
5. Check firewall/CORS settings
```

---

## 💾 Save These Files

Make sure these files are saved in your project:
- ✅ `.env.example` - Template (commit this)
- ✅ `.env` - Your actual values (DO NOT commit)
- ✅ `render.yaml` - Render config (commit)
- ✅ `wrangler.toml` - Cloudflare config (commit)
- ✅ All `*.md` documentation files (commit)

---

## 🆘 Need Help?

1. **Can't deploy?** → Check `DEPLOYMENT.md`
2. **Wrong variable?** → Check `QUICK_REFERENCE.md`
3. **API not connecting?** → Verify `VITE_API_URL` is correct
4. **Email not sending?** → Check `VITE_SENDGRID_API_KEY`
5. **Still stuck?** → Review backend error logs

---

**Status**: ✅ Deployment infrastructure ready
**Next Action**: Fill in variables and deploy
**Estimated Time**: 15-30 minutes for first deployment
