# YardVision AI v8 — Staging Deployment

## 1. PostgreSQL / Render
The included `render.yaml` creates:
- `yardvision-ai-staging` web service
- `yardvision-staging-db` PostgreSQL database

The database connection is injected as `DATABASE_URL`.

## 2. Cloudflare R2 image storage
Create an R2 bucket, for example:
`yardvision-staging`

Create an R2 API token with Object Read & Write permission for that bucket.

Set these Render environment variables:
- `STORAGE_BUCKET`
- `STORAGE_ENDPOINT`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`

YardVision v8.2 serves customer yard images through authenticated, signed app URLs.
`STORAGE_PUBLIC_BASE_URL` is no longer required. After verifying v8.2 image loading,
disable the R2 Public Development URL so bucket objects are not directly public.

## 3. Resend
Use a verified sender/domain and set:
- `EMAIL_MODE=resend`
- `RESEND_API_KEY`
- `EMAIL_FROM`

Staging enforces email verification.

## 4. Stripe test mode
Create a recurring monthly price for YardVision Pro and set:
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`

Configure the webhook endpoint:
`https://YOUR-STAGING-HOST/api/stripe/webhook`

Events used by YardVision:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## 5. CORS
Set:
`ALLOWED_ORIGINS=https://YOUR-STAGING-HOST`

## 6. Verify staging
Open:
`https://YOUR-STAGING-HOST`

Then open the **Status** page. Core staging readiness should be green for:
- OpenAI
- PostgreSQL
- Session Secret
- Resend Email
- Cloud Storage

Stripe can be connected before subscription testing.

You can also run locally:
`npm run staging:check`
