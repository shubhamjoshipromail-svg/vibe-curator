import { Scene } from './scene';
import { AudioEngine } from './audio/engine';
import { createState, loadPreset } from './app/state';
import { createLatestTaskQueue, parseRoute, navigate, onRouteChange, toPath, type Route } from './app/router';
import { renderExplore } from './app/explore';
import { renderLabs } from './app/labs';
import { renderPlayer } from './app/player';
import { hydrateLibrary, listPresets, pruneRedundantPresets } from './preset/library';
import { runEffectSelfTest } from './effects/selftest';
import { VIBES } from './vibes';
import { ensureViewer } from './auth/client';
import { mountAccountControl } from './auth/account';
import { acknowledgeBetaTerms, betaTermsStatus } from './auth/client';
import { renderLegal } from './app/legal';

/**
 * App shell.
 *
 * One Scene, one AudioEngine, three views onto them. The stage element is
 * always mounted — views only change how much of the screen it occupies — so
 * moving from Labs to Player is a CSS change, not a teardown. The room never
 * stops playing while you work on it.
 */

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="stage"></div>
  <div id="view"></div>
  <div id="account-slot"></div>
  <div id="gate">
    <div class="gate-inner">
      <h1>Vibe Curator</h1>
      <p>Browse a room, make it yours, and stay a while. Sound stays off until you start it in Player.</p>
      <label class="gate-accept"><input type="checkbox" id="accept-beta" /> <span>I agree to the <a href="/terms" target="_blank">Beta Terms</a> and acknowledge the <a href="/privacy" target="_blank">Privacy Notice</a>.</span></label>
      <button class="primary" id="begin" disabled>Enter free beta</button>
      <p class="gate-error" id="gate-error" role="status"></p>
    </div>
  </div>
`;

const stage = app.querySelector<HTMLDivElement>('#stage')!;
const view = app.querySelector<HTMLDivElement>('#view')!;
const gate = app.querySelector<HTMLDivElement>('#gate')!;

const scene = new Scene();
const audio = new AudioEngine();
const state = createState(scene, audio);
let policyAcknowledged = false;
let policyVersion = '';

/**
 * Collapse exact-duplicate remixes left by older builds. Runs once per browser;
 * the flag stops it re-scanning a clean library on every load.
 */
const PRUNE_FLAG = 'vibe.pruned.v1';
function cleanUpLegacyDuplicates(): void {
  if (localStorage.getItem(PRUNE_FLAG)) return;
  try {
    const removed = pruneRedundantPresets();
    localStorage.setItem(PRUNE_FLAG, new Date().toISOString());
    if (removed) console.info(`[vibe] removed ${removed} duplicate project record(s) from older builds`);
  } catch (err) {
    console.warn('[vibe] library cleanup skipped', err);
  }
}

async function boot(): Promise<void> {
  const viewerStatus = await ensureViewer();
  const policyStatus = await betaTermsStatus();
  policyVersion = policyStatus.policyVersion;
  policyAcknowledged = viewerStatus.persistent
    ? policyStatus.acknowledged
    : Boolean(localStorage.getItem(`vibe.policy.${policyVersion}`));
  await hydrateLibrary();
  cleanUpLegacyDuplicates();
  const first = listPresets()[0];
  try {
    await scene.mount(stage, { ...VIBES[0], palette: first.palette });
    await loadPreset(state, first);
  } catch (err) {
    console.error('[vibe] failed to start', err);
    stage.innerHTML = `<pre class="fatal">Could not start the renderer.\n${String(err)}</pre>`;
  }
  const initialRoute = parseRoute(`${location.pathname}${location.search}${location.hash}`);
  if (location.hash.startsWith('#/')) history.replaceState({}, '', toPath(initialRoute));
  await scheduleRender(initialRoute);
  if (initialRoute.name === 'legal') gate.classList.add('hidden');
  await mountAccountControl(app.querySelector<HTMLElement>('#account-slot')!);
}

async function render(route: Route): Promise<void> {
  app.dataset.mode = route.name;
  gate.classList.toggle('hidden', route.name === 'legal' || policyAcknowledged);
  scene.setViewMode(route.name === 'player' ? 'player' : route.name === 'labs' ? 'labs' : 'explore');
  view.scrollTop = 0;
  view.innerHTML = '<div class="empty-stage route-loading"><p>Opening…</p></div>';

  switch (route.name) {
    case 'legal':
      await renderLegal(view, route);
      break;
    case 'labs':
      await renderLabs(view, state, route.presetId, route.returnTo, route.returnCollection);
      break;
    case 'marketplace':
      // Backward-compatible alias: Market is now an in-place Library view.
      renderExplore(view, 'market');
      break;
    case 'player':
      renderPlayer(view, state);
      break;
    default:
      await hydrateLibrary();
      renderExplore(view, route.view ?? 'market', {
        folder: route.folder,
        type: route.type,
        collection: route.collection,
      });
  }
}

async function renderSafely(route: Route): Promise<void> {
  try {
    await render(route);
  } catch (error) {
    console.error('[vibe] route failed to render', error);
    view.innerHTML = '<div class="empty-stage"><p>This screen could not open. Your previous work is still saved.</p><button class="primary" id="route-home">Back to Market</button></div>';
    view.querySelector('#route-home')?.addEventListener('click', () => navigate({ name: 'explore', view: 'market' }));
  }
}

const scheduleRender = createLatestTaskQueue(renderSafely);
onRouteChange((route) => void scheduleRender(route));

const accept = app.querySelector<HTMLInputElement>('#accept-beta')!;
const begin = app.querySelector<HTMLButtonElement>('#begin')!;
const gateError = app.querySelector<HTMLElement>('#gate-error')!;
accept.addEventListener('change', () => {
  begin.disabled = !accept.checked;
  if (accept.checked) gateError.textContent = '';
});
begin.addEventListener('click', async () => {
  if (!accept.checked) {
    begin.disabled = true;
    gateError.textContent = 'Please agree to the Beta Terms before continuing.';
    return;
  }
  begin.disabled = true;
  gateError.textContent = '';
  try {
    await acknowledgeBetaTerms(policyVersion, true);
    policyAcknowledged = true;
    localStorage.setItem(`vibe.policy.${policyVersion}`, new Date().toISOString());
    gate.classList.add('hidden');
    scene.resetSession();
  } catch (error) {
    gateError.textContent = error instanceof Error ? error.message : 'Could not enter the beta.';
    begin.disabled = !accept.checked;
  }
});

// Feed the live spectrum to generated effects every frame.
let audioPump = 0;
function pumpAudio() {
  if (audio.started) {
    scene.setAudioBands(audio.getBands());
    audio.setVisualMetrics(scene.getSourceMetrics());
  }
  audioPump = requestAnimationFrame(pumpAudio);
}
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(audioPump);
  if (!document.hidden) audioPump = requestAnimationFrame(pumpAudio);
});
audioPump = requestAnimationFrame(pumpAudio);

if (location.pathname === '/' && !location.hash) navigate({ name: 'explore', view: 'market' });
void boot();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__vibe = {
    scene,
    audio,
    state,
    // Verifies the effect guard + compiler against known-good and known-bad
    // shaders without needing an API key.
    runEffectSelfTest,
  };
}
