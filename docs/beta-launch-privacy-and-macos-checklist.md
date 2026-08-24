# Vibe Curator invited-beta launch checklist

Last reviewed: 2026-08-23. This is an engineering/compliance checklist, not jurisdiction-specific legal advice.

## Recommended launch shape

- [x] Free, invitation-only beta; no payment promise and no refundable cash balance.
- [x] No BYOK setup for testers. Provider keys remain server-side and are never prefixed `VITE_`.
- [x] Production generation defaults to `off`, even if provider keys exist.
- [x] Company-wide and per-user UTC daily estimated-dollar ceilings are enforced transactionally before enabled provider calls.
- [x] Stripe code remains dormant unless `ENABLE_BILLING=true`; old credentials alone cannot expose checkout or accept webhooks.
- [ ] Create 8–20 tester invitations and a short feedback channel; do not open public signup yet.
- [ ] Configure a private support/privacy email before inviting anyone outside a known tester group.
- [ ] Decide the legal/business name, operator address/country, and governing-law wording before a public launch.

## macOS website distribution

- [x] App Store distribution is not required. Apple supports distribution outside the Mac App Store using Developer ID. See [Apple macOS distribution](https://developer.apple.com/macos/distribution/) and [Developer ID](https://developer.apple.com/developer-id/).
- [x] `vibecurator://open?preset=…` deep links and single-instance behavior are integrated. A registered URL scheme can launch a closed installed app; a WebSocket cannot wake a process that is not running. See [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/).
- [x] Website desktop page explains that the download is pending signing/notarization and does not offer the ad-hoc engineering build publicly.
- [ ] Join/renew the Apple Developer Program. Tauri documents the US price as $99/year; regional pricing/tax can vary. See [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).
- [ ] Create/import a `Developer ID Application` certificate and protect its private key.
- [ ] Add hardened-runtime entitlements, sign every nested binary, archive as a DMG, submit to Apple notarization, and staple the ticket. See [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) and [Tauri DMG distribution](https://v2.tauri.app/distribute/dmg/).
- [ ] Verify the final artifact on a different Mac: `codesign --verify --deep --strict`, `spctl --assess --type open`, install, first launch, menu bar, wallpaper, quit, and web deep link.
- [ ] Host the versioned notarized DMG over HTTPS, publish SHA-256 and file size, then enable the website download button.
- [ ] Add signed automatic updates only after the manual beta install is stable.

## Data map and minimization

- [x] Documented in-product: necessary auth/session cookie; account ID; optional Google profile; project/folder documents; uploaded media; prompts; credit/job/provider/error metadata; limited auth/rate-limit/hosting log data.
- [x] No ads, data sale/share, behavioral analytics, location, contacts, camera, or microphone collection in this beta.
- [x] User uploads are allow-listed by MIME type and size; IDs and deep-link parameters are validated.
- [x] Optional provider transfer happens only after the user invokes the relevant feature; production generation starts disabled.
- [ ] Inventory Railway/Postgres log retention, backups, regions, subprocessors, and deletion behavior; record exact settings internally.
- [ ] Inventory each enabled AI provider’s retention/training settings and contract/DPA before enabling it for testers.
- [ ] Remove unused production keys and rotate any key previously pasted into chat, logs, source, or screenshots.

The design follows GDPR principles of lawfulness/transparency, purpose limitation, minimization, accuracy, storage limitation, security, and accountability: [European Commission GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en).

## Notice, lawful basis, and consent

- [x] Privacy Notice and Beta Terms are directly accessible at `/privacy` and `/terms`.
- [x] Entry uses an unchecked affirmative control. It separates agreement to terms from acknowledgment of the notice; it does not falsely label all necessary processing as optional consent.
- [x] No marketing/analytics consent box exists because those activities do not exist.
- [x] No cookie banner exists because only necessary session/auth cookies are used. Add a granular opt-in before adding nonessential analytics/advertising storage. See the [ICO cookies guidance](https://ico.org.uk/media/for-organisations/guide-to-pecr/guidance-on-the-use-of-cookies-and-similar-technologies-1-0.pdf).
- [ ] Add the operator identity and private contact address to the Privacy Notice.
- [ ] For each processing purpose, document the applicable lawful basis (service/contract, legitimate interests, legal obligation, or specific consent). Consent must be freely given, specific, informed, affirmative, and as easy to withdraw as to give. See [European Commission lawful grounds](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en).
- [ ] If marketing or optional analytics is later added, use separate unchecked choices, store version/time, honor withdrawal, and do not bundle them with service access.

## User rights and retention

- [x] Self-service JSON product-data export is available at `/data`.
- [x] Self-service account deletion removes identity-linked product records and volume-backed files through the authenticated account deletion hook; only de-identified cost/security rows remain so deletion cannot reset the global provider ceiling.
- [x] Guest/local product data can also be deleted.
- [ ] Test export and deletion on a real Railway guest, Google-linked account, and account with assets; verify backups expire according to the documented schedule.
- [ ] Add correction/contact workflow and an internal request log. GDPR requests generally require a response without undue delay and in principle within one month: [European Commission—handling requests](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en).
- [ ] Set and enforce concrete retention periods for security logs, failed generation jobs, expired reservations, deleted-account backups, and abandoned anonymous accounts.
- [ ] Write an incident-response procedure: owner, triage, containment, credential rotation, evidence, notification decision, and tester communication.

## Children and sensitive content

- [x] Terms state that the beta is general-audience and not intended for under-18s; the notice states no knowing collection from under-13s.
- [ ] Do not solicit date of birth unless implementing a neutral, reviewed age-screening flow.
- [ ] If there is actual knowledge of an under-13 user, block further collection and delete the data. Email, persistent identifiers, photos, video, and audio can be personal information under COPPA. See the [FTC COPPA compliance plan](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business).
- [ ] Add a moderation/report path before public uploads or public sharing exist.

## Security release gate

- [x] HTTPS-only production origin, host allow-list, strict response headers/CSP, same-origin mutation checks, auth-required APIs, rate limits, request-size limits, MIME allow-list, idempotent jobs/webhooks, server-only secrets.
- [x] No API key is bundled in the browser or native client.
- [ ] Replace the current per-process IP rate limiter with a shared Railway/Redis limiter before public signup or horizontal scaling.
- [ ] Run dependency, secret, and code scanning; review every finding and patch critical/high issues.
- [ ] Rotate production secrets, use separate least-privilege provider projects, and set provider-console hard monthly limits/alerts in addition to app limits.
- [ ] Confirm database backups and perform a restore drill.
- [ ] Confirm Railway custom-domain TLS, DNS, environment separation, volume mount, health checks, and alerting.
- [ ] Test session fixation, guest-to-Google ownership transfer, logout, deletion, CSRF/origin rejection, rate limits, malformed uploads, and unauthorized asset access.

FTC guidance recommends knowing what data is held, keeping only what is needed, protecting it, disposing of it securely, and honoring privacy promises: [FTC privacy and security](https://www.ftc.gov/business-guidance/privacy-security) and [Start with Security](https://www.ftc.gov/business-guidance/resources/start-security-guide-business).

## Payments—deferred until after beta validation

- [x] Payment UI and endpoints are off by default.
- [ ] First validate that testers repeatedly use curated scenes, desktop activation, saves, and sound—not merely generation.
- [ ] Before enabling Stripe: legal entity/tax/merchant details, refund/cancellation terms, pricing and included credits, failed-payment behavior, webhook replay tests, entitlement reconciliation, customer portal, receipts, support path, fraud limits, and test-mode end-to-end QA.
- [ ] Never sell credits below worst-case provider cost plus hosting, failures/retries, taxes/fees, support, and margin. Keep a dollar budget independent of credits.
- [ ] Test the subscription lifecycle and failure cases using [Stripe Billing testing](https://docs.stripe.com/billing/testing) and [Stripe Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions).

## Go/no-go for the invited beta

Go only when: a real production account can sign in; save/upload/export/delete work; generation and billing are visibly off; server spend controls are configured; the app artifact is notarized or distribution is explicitly limited to technically informed internal testers; a private support/privacy contact exists; and one clean-Mac install test passes.
