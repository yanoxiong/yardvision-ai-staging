# YardVision AI v8 — Staging Build

This is the first YardVision build designed to be moved from localhost to a public staging environment.

## Added in v8
- PostgreSQL-first staging architecture with local fallback
- S3-compatible persistent image storage
- Cloudflare R2-compatible configuration
- Resend verification/password reset email
- Stripe test subscription webhooks
- Render Blueprint (`render.yaml`)
- Render secure-cookie proxy support
- Restricted production CORS
- Security headers, compression, auth/generation rate limiting
- Production session-secret validation
- `/healthz` liveness endpoint
- `/api/readiness` staging-readiness endpoint
- In-app **Status** page
- CLI `npm run staging:check`
- Unique local port 3018

## Local test
1. Run `SETUP_YARDVISION.bat`.
2. Put your OpenAI key in `.env`.
3. Run `START_YARDVISION.bat`.
4. Open `http://localhost:3018`.

Local fallback still uses JSON + local files + console email unless production services are configured.

## Public staging
See `STAGING_DEPLOYMENT.md`.

## Important
The package contains no API secrets. Real deployment requires connecting the external accounts and supplying their credentials through Render environment variables.
