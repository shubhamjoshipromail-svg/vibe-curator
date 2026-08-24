import { Scene } from './scene';
import { AudioEngine } from './audio/engine';
import {
  audioSpecForPreset,
  createState,
  loadPreset,
  syncAudioLayers,
  syncGeneratedMusic,
} from './app/state';
import { ensureViewer } from './auth/client';
import { getPreset, hydrateLibrary, listPresets } from './preset/library';
import { VIBES } from './vibes';
import { runtimeHost } from './runtime/host';
import { isBundledSurface } from './runtime/config';

const ACTIVE_PRESET_KEY = 'vibe.wallpaper.preset-id';
const app = document.querySelector<HTMLDivElement>('#wallpaper-app')!;
const stage = document.querySelector<HTMLDivElement>('#stage')!;
const status = document.querySelector<HTMLDivElement>('#wallpaper-status')!;
const sound = document.querySelector<HTMLButtonElement>('#wallpaper-sound')!;

const scene = new Scene();
const audio = new AudioEngine();
const state = createState(scene, audio);

function requestedPresetId(): string | undefined {
  return new URLSearchParams(location.search).get('preset')
    ?? localStorage.getItem(ACTIVE_PRESET_KEY)
    ?? undefined;
}

async function startSound(): Promise<void> {
  const preset = state.loaded;
  if (!preset || state.started) return;
  sound.disabled = true;
  try {
    audio.setAmbientEvents(preset.livingStill?.audio.events ?? []);
    await audio.start(audioSpecForPreset(preset));
    state.started = true;
    syncAudioLayers(state, preset);
    await syncGeneratedMusic(state, preset);
    sound.hidden = true;
    await runtimeHost.enterWallpaperMode();
  } catch (error) {
    console.error('[vibe] wallpaper audio failed to start', error);
    sound.textContent = 'Sound unavailable';
  } finally {
    sound.disabled = false;
  }
}

async function boot(): Promise<void> {
  // A missing network/session must not stop built-in rooms from working.
  // The packaged starter intentionally stays offline; after activation the
  // Tauri command navigates this window to the hosted HTTPS wallpaper, where
  // normal same-origin auth and library hydration apply.
  if (!isBundledSurface()) {
    await ensureViewer().then(() => hydrateLibrary()).catch((error) => {
      console.warn('[vibe] wallpaper library is offline; using local content', error);
    });
  }

  const preset = (requestedPresetId() ? getPreset(requestedPresetId()!) : undefined) ?? listPresets()[0];
  localStorage.setItem(ACTIVE_PRESET_KEY, preset.id);
  document.title = `${preset.name} — Vibe Curator`;

  await scene.mount(stage, { ...VIBES[0], palette: preset.palette });
  scene.setViewMode('player');
  await loadPreset(state, preset);

  status.textContent = preset.name;
  app.dataset.ready = 'true';
  sound.hidden = false;
  await runtimeHost.enterWallpaperMode();
}

sound.addEventListener('click', () => void startSound());
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'm') void startSound();
});

let audioPump = 0;
function pumpAudio(): void {
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

void boot().catch((error) => {
  console.error('[vibe] wallpaper failed to start', error);
  status.textContent = error instanceof Error ? error.message : 'Wallpaper could not start.';
  status.dataset.error = 'true';
});
