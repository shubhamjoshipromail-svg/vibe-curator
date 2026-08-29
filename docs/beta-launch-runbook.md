# Invited beta launch and operations runbook

Last reconciled with release `0.1.1`: 2026-08-29.

## Current release boundary

The beta is ready when a new visitor can become an anonymous user, receive 100
non-cash Vibe Credits once, save private projects, link Google without losing
media, purchase in Stripe test mode, and generate only while a server-side
credit reservation is available. Playback, local editing, uploads and curated
worlds remain free after their assets are stored.

Not in this boundary: creator payouts, public user publishing, native app
store review, community moderation, usage-based invoices, or selling a music
library.

Current distribution:

- Web/API `0.1.1`: Railway production.
- Chrome `0.1.1`: approved and published under item `niamjnjkmfnlpcejieffodipboacfdnm`.
- macOS `0.1.1` Beta 2: published for technical testers, ad-hoc signed and unnotarized.

## Release order

1. Run the web, Chrome, and native release checks from a clean release worktree.
2. Fast-forward or merge the stabilized beta branch to `main` only after the checks pass.
3. Deploy the exact merged worktree with `railway up --detach -y --service vibe-curator --environment production --message "<release>"`. This project currently uses CLI uploads rather than GitHub auto-deploy.
4. Wait for Railway status `SUCCESS`; confirm the Better Auth migration and product schema complete in pre-deploy.
5. Verify `/api/health`, `/`, and `/desktop`, then inspect the served bundle for the expected release links.
6. Confirm the Chrome Web Store public listing version and the GitHub native asset/checksum URLs.
7. Run the smoke matrix below with a fresh anonymous browser and one Google test account.

Initial environment setup, when needed:

1. Set the canonical HTTPS URL and Google OAuth callback.
2. Configure Stripe test products, webhook and price ids.
3. Add restricted provider keys with provider-side hard spend limits.
4. Invite 5–10 named testers; do not publish an open signup link on day one.

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
13. Chrome Web Store version matches the packaged manifest; New Tab, sound opt-in,
    popup volume, and the website-to-extension handoff pass in a clean Chrome profile.
14. A fresh browser cannot enter until the Beta Terms checkbox is checked; missing,
    false, or stale-policy acknowledgment requests are rejected by the server.

## Rollback

If billing or generation authorization fails, remove the Stripe/provider keys
and keep the free curated Player, uploads and deterministic editor online. Roll
Railway back to the previous successful deployment; do not delete ledger or
webhook rows. They are the audit trail for reconciliation.
