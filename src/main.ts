import { Scene } from './scene';
import { AudioEngine } from './audio/engine';
import { createState, loadPreset } from './app/state';
import { parseRoute, navigate, onRouteChange, type Route } from './app/router';
import { renderExplore } from './app/explore';
import { renderLabs } from './app/labs';
import { renderPlayer } from './app/player';
import { hydrateLibrary, listPresets, pruneRedundantPresets } from './preset/library';
import { runEffectSelfTest } from './effects/selftest';
import { VIBES } from './vibes';
import { ensureViewer } from './auth/client';
import { mountAccountControl } from './auth/account';

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
      <button class="primary" id="begin">Enter</button>
    </div>
  </div>
`;

const stage = app.querySelector<HTMLDivElement>('#stage')!;
const view = app.querySelector<HTMLDivElement>('#view')!;
const gate = app.querySelector<HTMLDivElement>('#gate')!;

const scene = new Scene();
const audio = new AudioEngine();
const state = createState(scene, audio);

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
  await ensureViewer();
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
  render(parseRoute(location.hash));
  await mountAccountControl(app.querySelector<HTMLElement>('#account-slot')!);
}

async function render(route: Route): Promise<void> {
  app.dataset.mode = route.name;
  scene.setViewMode(route.name === 'player' ? 'player' : route.name === 'labs' ? 'labs' : 'explore');
  view.scrollTop = 0;

  switch (route.name) {
    case 'labs':
      await renderLabs(view, state, route.presetId, route.returnTo);
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

onRouteChange((route) => void render(route));

app.querySelector<HTMLButtonElement>('#begin')!.addEventListener('click', async () => {
  gate.classList.add('hidden');
  scene.resetSession();
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

if (!location.hash) navigate({ name: 'explore', view: 'market' });
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
