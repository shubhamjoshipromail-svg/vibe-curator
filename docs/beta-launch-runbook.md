# Private beta launch runbook

## Tomorrow's release boundary

The beta is ready when a new visitor can become an anonymous user, receive 100
non-cash Vibe Credits once, save private projects, link Google without losing
media, purchase in Stripe test mode, and generate only while a server-side
credit reservation is available. Playback, local editing, uploads and curated
worlds remain free after their assets are stored.

Not in tomorrow's boundary: creator payouts, public user publishing, native app
store review, community moderation, usage-based invoices, or selling a music
library.

## Release order

1. Merge the stabilized beta branch to `main` and allow Railway to build.
2. Confirm the Better Auth migration and product schema complete in pre-deploy.
3. Set the canonical HTTPS URL and Google OAuth callback.
4. Configure Stripe test products, webhook and price ids.
5. Add restricted provider keys with provider-side hard spend limits.
6. Run the smoke matrix below with a fresh anonymous browser and one Google test account.
7. Invite 5–10 named testers; do not publish an open signup link on day one.

## Required Railway variables

- `APP_URL=https://vibe-curator-production.up.railway.app`
- `BETTER_AUTH_URL` set to the same origin
- `BETTER_AUTH_SECRET` with at least 32 random characters
- `DATABASE_URL` from Railway Postgres
- `VIBE_DATA_DIR=/data` with one mounted volume and one web replica
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `STRIPE_SECRET_KEY` (test mode for the first beta)
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PLUS_MONTHLY`
- `STRIPE_PRICE_CREATOR_MONTHLY`
- `STRIPE_PRICE_CREDITS_100`
- restricted server-only AI provider keys

Never create a `VITE_`-prefixed secret.

## Google configuration

- Authorized JavaScript origin: the exact `APP_URL` origin.
- Authorized redirect URI: `${APP_URL}/api/auth/callback/google`.
- Keep the OAuth consent screen in Testing and list only invited Google accounts
  until the flow has passed review.

## Stripe test catalog

- Plus monthly: fixed recurring price, 100 credits granted per paid invoice.
- Creator monthly: fixed recurring price, 400 credits granted per paid invoice.
- 100-credit pack: one-time fixed price.
- Checkout receives only the server's configured price ids; the browser sends a
  product key and cannot choose an arbitrary amount.
- Webhook endpoint: `${APP_URL}/api/stripe/webhook`.
- Subscribe to `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, and
  `invoice.paid`.
- Enable Stripe Tax and configure the customer portal in test mode.

## Security and operational boundaries

- Keep one Railway replica while binary media is on its mounted volume.
- Set hard provider-account spend ceilings in addition to Vibe Credits.
- Back up Postgres and the volume daily.
- Keep the Market first-party-only during private beta.
- Do not log cookies, authorization headers, provider payloads, or raw Stripe
  webhook bodies.
- Review generation jobs and Stripe events daily during the beta.

## Smoke matrix

1. `/explore`, `/labs/:id`, and `/player` load directly and Back/Forward work.
2. A fresh browser receives one anonymous session and exactly 100 credits.
3. Refreshing or reopening does not issue another welcome grant.
4. Two simultaneous generation reservations cannot overspend one balance.
5. Failed provider calls release their reservations and do not charge credits.
6. Successful calls create one immutable debit even if a webhook/request retries.
7. Google linking preserves projects, folders, media files and remaining credits.
8. Another account cannot read or delete the first account's asset ids.
9. A hostile `Origin` receives `403`; an invalid Stripe signature receives `400`.
10. Stripe test Checkout returns, grants the correct credits once, and the
    customer portal opens.
11. A redeploy preserves accounts, credit history, projects and media.
12. Provider keys are absent from the client bundle and browser network payloads.

## Rollback

If billing or generation authorization fails, remove the Stripe/provider keys
and keep the free curated Player, uploads and deterministic editor online. Roll
Railway back to the previous successful deployment; do not delete ledger or
webhook rows. They are the audit trail for reconciliation.
