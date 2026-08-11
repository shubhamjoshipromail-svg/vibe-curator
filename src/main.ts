import { Scene } from './scene';
import { AudioEngine } from './audio/engine';
import { createState, loadPreset, syncGeneratedMusic } from './app/state';
import { parseRoute, navigate, onRouteChange, type Route } from './app/router';
import { renderExplore } from './app/explore';
import { renderLabs } from './app/labs';
import { renderPlayer } from './app/player';
import { hydrateLibrary, listPresets } from './preset/library';
import { runEffectSelfTest } from './effects/selftest';
import { VIBES } from './vibes';

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
  <div id="gate">
    <div class="gate-inner">
      <h1>Vibe Curator</h1>
      <p>Browse a room, make it yours, and stay a while. Sound starts on your first click.</p>
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

async function boot(): Promise<void> {
  await hydrateLibrary();
  const first = listPresets()[0];
  try {
    await scene.mount(stage, { ...VIBES[0], palette: first.palette });
    await loadPreset(state, first);
  } catch (err) {
    console.error('[vibe] failed to start', err);
    stage.innerHTML = `<pre class="fatal">Could not start the renderer.\n${String(err)}</pre>`;
  }
  render(parseRoute(location.hash));
}

async function render(route: Route): Promise<void> {
  app.dataset.mode = route.name;
  view.scrollTop = 0;

  switch (route.name) {
    case 'labs':
      await renderLabs(view, state, route.presetId);
      break;
    case 'player':
      renderPlayer(view, state);
      break;
    default:
      await hydrateLibrary();
      renderExplore(view);
  }
}

onRouteChange((route) => void render(route));

app.querySelector<HTMLButtonElement>('#begin')!.addEventListener('click', async () => {
  gate.classList.add('hidden');
  state.started = true;
  scene.resetSession();
  try {
    const base = VIBES.find((v) => v.id === state.loaded?.baseVibeId) ?? VIBES[0];
    await audio.start(base.audio);
    if (state.loaded) {
      for (const layer of ['ambience', 'music', 'master'] as const) {
        const s = state.loaded.audio[layer];
        audio.setLayer(layer, s.gain, s.muted);
      }
      await syncGeneratedMusic(state, state.loaded);
    }
  } catch (err) {
    // Visuals are the load-bearing half; audio failure must never blank the room.
    console.error('[vibe] audio failed to start', err);
  }
});

// Feed the live spectrum to generated effects every frame.
function pumpAudio() {
  if (audio.started) {
    scene.setAudioBands(audio.getBands());
    audio.setVisualMetrics(scene.getSourceMetrics());
  }
  requestAnimationFrame(pumpAudio);
}
requestAnimationFrame(pumpAudio);

if (!location.hash) navigate({ name: 'explore' });
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
