import { authStatus, deleteMyAccount, exportMyData } from '../auth/client';
import { navigate, type Route } from './router';

const LAST_UPDATED = 'August 23, 2026';
const NATIVE_RELEASE_TAG = 'v0.1.1-beta.3';
const NATIVE_RELEASE_ASSET = 'Vibe-Curator-0.1.1-beta.3-arm64-unnotarized.dmg';
const NATIVE_RELEASE_URL = `https://github.com/shubhamjoshipromail-svg/vibe-curator/releases/download/${NATIVE_RELEASE_TAG}/${NATIVE_RELEASE_ASSET}`;

function shell(title: string, body: string): string {
  return `<main class="legal-page">
    <nav class="legal-nav" aria-label="Legal and beta pages">
      <button class="ghost" data-route="explore">← Vibe Curator</button>
      <a href="/desktop">Desktop app</a><a href="/beta">Beta</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/data">Your data</a>
    </nav>
    <article><p class="account-kicker">FREE PRIVATE BETA · UPDATED ${LAST_UPDATED.toUpperCase()}</p><h1>${title}</h1>${body}</article>
  </main>`;
}

const privacy = shell('Privacy Notice', `
  <p>Vibe Curator is a small private beta. We collect only what is needed to provide accounts, saved projects, credits, security, and features you deliberately use. We do not sell personal information, run behavioral advertising, or use analytics trackers in this beta.</p>
  <h2>What we process</h2>
  <p>A necessary session cookie and account identifier; Google name, email, and profile image only if you choose Google sign-in; saved project and folder documents; uploaded image, video, and audio files; prompts you submit; credit, generation-job, provider, and error metadata; and limited IP/user-agent data used by authentication, rate limiting, and hosting logs.</p>
  <h2>AI providers</h2>
  <p>When you deliberately choose an AI generation or analysis action, the prompt and relevant source media may be sent to the named provider shown in the feature. Production AI generation is disabled by default during the beta. Do not upload confidential, identifying, or third-party personal information.</p>
  <h2>Why and how long</h2>
  <p>We process necessary data to provide the service, secure it, prevent abuse, and meet legal obligations. Account content remains until you delete it or your account. Operational and hosting logs are retained only as needed for security and reliability under provider settings. After deletion, a minimal de-identified generation cost record may remain temporarily to enforce provider budgets, prevent abuse, and meet legal obligations; prompts, source media, account identifiers, provider request IDs, and idempotency links are removed from that record.</p>
  <h2>Processors and transfers</h2>
  <p>Current or optional processors may include Railway and PostgreSQL hosting, Google OAuth, selected AI providers, and Stripe only after payments are enabled. These providers may process data in other countries under their own contractual safeguards.</p>
  <h2>Your choices and rights</h2>
  <p>You can use a guest account, avoid optional AI features, export your data, and delete your account from <a href="/data">Your data</a>. Depending on where you live, you may also have rights to access, correct, erase, restrict, object, or port personal data and complain to a regulator.</p>
  <h2>Children</h2><p>The beta is a general-audience product and is not intended for anyone under 18. We do not knowingly collect personal information from children under 13. If we learn that we have, we will delete it.</p>
  <h2>Contact</h2><p>Until a dedicated private support address is configured, use the in-product export/deletion controls. A private privacy-contact email must be added before opening the beta beyond invited testers.</p>`);

const terms = shell('Beta Terms', `
  <p>By entering the beta you agree to these terms and acknowledge the Privacy Notice. The beta is provided for evaluation, may change or stop, and can contain defects. Keep backups of important source media.</p>
  <h2>Your content</h2><p>You keep ownership of content you upload. You give Vibe Curator and its processors a limited permission to host and process it only to operate features you request. You must have the rights and permissions needed for anything you upload; do not upload illegal, infringing, confidential, or non-consensual personal content.</p>
  <h2>Acceptable use</h2><p>Do not evade limits, attack the service, scrape other users, upload malware, impersonate others, or use generated output unlawfully. Access may be limited or removed to protect people, providers, or the service.</p>
  <h2>Costs and availability</h2><p>The invited beta is free and usage-capped. Credits are promotional usage units, have no cash value, and do not guarantee access to paid providers. Payments are disabled unless a checkout page clearly states otherwise.</p>
  <h2>Warranty and liability</h2><p>The beta is provided “as is” to the extent permitted by law, without a promise of uninterrupted availability or fitness for a particular purpose. Nothing here excludes rights or liability that cannot legally be excluded.</p>`);

const beta = shell('How this beta works', `
  <p>This first beta is free, invited, and deliberately capped. You can browse curated rooms, upload and edit your own scenes, save projects, play layered sound, and use the native wallpaper player. Expensive AI generation and payments remain off by default.</p>
  <h2>Credits</h2><p>Test users receive promotional Vibe Credits so the accounting system can be tested. Credits are not money. When limited AI trials are enabled, both per-user and company-wide daily dollar ceilings are enforced before a provider request begins.</p>
  <h2>No API-key setup</h2><p>Testers do not need to bring provider keys. The company controls the few enabled server-side features and their budget. Curated, pre-generated scenes and sounds provide the main beta experience without an unpredictable bill.</p>`);

const desktop = shell('Desktop app for Mac', `
  <p>The Mac app does not need the Mac App Store. Beta 3 includes the latest handoff, audio and menu-bar fixes, but it is ad-hoc signed rather than notarized by Apple.</p>
  <h2>What the app does</h2><p>It runs a living scene behind desktop icons, adds a menu-bar control, and can be opened from the website with a <code>vibecurator://</code> link after installation. A WebSocket cannot wake a closed app; the registered deep link can.</p>
  <div class="legal-callout warning-callout"><strong>Unnotarized technical-tester build</strong><p>Gatekeeper will block the first normal launch because this Mac has no Developer ID signing certificate installed. Download it only from this page. After dragging it to Applications, try opening it once, then use Finder’s right-click → Open flow or System Settings → Privacy &amp; Security → Open Anyway. Do not weaken Gatekeeper globally.</p>
    <p><strong>Requirements:</strong> Apple-silicon Mac (M1 or newer), macOS 11 or newer.</p>
    <a class="button-like primary" href="${NATIVE_RELEASE_URL}">Download Beta 3</a>
    <a class="checksum-link" href="${NATIVE_RELEASE_URL}.sha256">SHA-256 checksum</a>
  </div>`);

async function dataPage(): Promise<string> {
  const status = await authStatus();
  return shell('Your data', `
    <p>${status.viewer?.isAnonymous ? 'This is a guest account.' : `Signed in as ${status.viewer?.email ?? 'your account'}.`} Download a machine-readable copy of stored product data or permanently delete this account and its product content.</p>
    <div class="data-actions"><button class="primary" id="export-data">Download my data</button><button class="danger" id="delete-data">Delete my account and data</button><p id="data-status" role="status"></p></div>
    <p class="hint">Deletion cannot be undone. Provider or hosting records already created may remain only when required for security, fraud prevention, or law.</p>`);
}

export async function renderLegal(host: HTMLElement, route: Extract<Route, { name: 'legal' }>): Promise<void> {
  host.innerHTML = route.page === 'privacy' ? privacy : route.page === 'terms' ? terms : route.page === 'beta' ? beta : route.page === 'desktop' ? desktop : await dataPage();
  host.querySelector('[data-route="explore"]')?.addEventListener('click', () => navigate({ name: 'explore', view: 'market' }));
  if (route.page !== 'data') return;
  const statusLine = host.querySelector<HTMLElement>('#data-status')!;
  host.querySelector('#export-data')?.addEventListener('click', async () => {
    try { statusLine.textContent = 'Preparing export…'; await exportMyData(); statusLine.textContent = 'Export downloaded.'; }
    catch (error) { statusLine.textContent = error instanceof Error ? error.message : 'Export failed.'; }
  });
  host.querySelector('#delete-data')?.addEventListener('click', async () => {
    if (!confirm('Permanently delete this account, projects, uploads, credits, and generation history?')) return;
    try { statusLine.textContent = 'Deleting…'; const status = await authStatus(); await deleteMyAccount(status.persistent); }
    catch (error) { statusLine.textContent = error instanceof Error ? error.message : 'Deletion failed.'; }
  });
}
