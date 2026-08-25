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
import { registerDeepLinks } from './runtime/deep-link';
import { isBundledSurface } from './runtime/config';
import { cacheTransferredAsset } from './media/assets';
import type { Preset } from './preset/types';

const ACTIVE_PRESET_KEY = 'vibe.wallpaper.preset-id';
const STARTER_PRESET_ID = 'market-pixel-last-broadcast';
const STARTER_MUSIC_ID = 'builtin_last_broadcast_score';
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

function requestedActivationToken(): string | undefined {
  const token = new URLSearchParams(location.search).get('activation') ?? '';
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}

async function receiveActivation(token: string): Promise<Preset> {
  const response = await fetch(`/api/native/activations/${token}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({})) as { preset?: Preset; message?: string };
  if (!response.ok || !body.preset) throw new Error(body.message || 'The Mac handoff could not be loaded.');
  const assetIds = [
    body.preset.scene.kind === 'image' || body.preset.scene.kind === 'video' ? body.preset.scene.assetId : undefined,
    body.preset.music?.url ? undefined : body.preset.music?.assetId,
  ].filter((value): value is string => Boolean(value));
  for (const assetId of [...new Set(assetIds)]) {
    const assetResponse = await fetch(`/api/native/activations/${token}/assets/${encodeURIComponent(assetId)}`, { cache: 'no-store' });
    if (!assetResponse.ok) throw new Error(`The transferred asset ${assetId} is unavailable.`);
    await cacheTransferredAsset(assetId, await assetResponse.blob());
  }
  history.replaceState({}, '', '/wallpaper.html');
  return body.preset;
}

async function bundledStarterPreset(): Promise<Preset> {
  const source = getPreset(STARTER_PRESET_ID);
  if (!source) throw new Error('The starter room is unavailable.');
  const preset = structuredClone(source);
  preset.music = {
    assetId: STARTER_MUSIC_ID,
    url: '/audio/curated/last-broadcast.mp3',
    name: 'The Last Broadcast — instrumental ambient score',
    mimeType: 'audio/mpeg',
    durationSeconds: 30,
    provenance: {
      provider: 'elevenlabs',
      model: 'music_v2',
      vocalMode: 'instrumental',
      createdAt: '2026-08-13T22:18:47.735Z',
      parentPresetId: STARTER_PRESET_ID,
    },
  };
  return preset;
}

async function startSound(): Promise<void> {
  const preset = state.loaded;
  if (!preset) return;
  if (state.started) {
    await runtimeHost.enterWallpaperMode();
    sound.textContent = 'Sound on';
    sound.dataset.sleeping = 'true';
    return;
  }
  sound.disabled = true;
  try {
    audio.setAmbientEvents(preset.livingStill?.audio.events ?? []);
    await audio.start(audioSpecForPreset(preset));
    state.started = true;
    syncAudioLayers(state, preset);
    await syncGeneratedMusic(state, preset);
    sound.textContent = 'Sound on';
    window.setTimeout(() => { sound.dataset.sleeping = 'true'; }, 2600);
    await runtimeHost.enterWallpaperMode();
  } catch (error) {
    console.error('[vibe] wallpaper audio failed to start', error);
    sound.textContent = error instanceof Error ? `Sound unavailable · ${error.message}` : 'Sound unavailable';
  } finally {
    sound.disabled = false;
  }
}

async function boot(): Promise<void> {
  const activationToken = requestedActivationToken();
  // A missing network/session must not stop built-in rooms from working.
  // The packaged starter intentionally stays offline; after activation the
  // Tauri command navigates this window to the hosted HTTPS wallpaper, where
  // normal same-origin auth and library hydration apply.
  if (!isBundledSurface() && !activationToken) {
    await ensureViewer().then(() => hydrateLibrary()).catch((error) => {
      console.warn('[vibe] wallpaper library is offline; using local content', error);
    });
  }

  const preset = activationToken
    ? await receiveActivation(activationToken)
    : (isBundledSurface() && requestedPresetId() === STARTER_PRESET_ID
      ? await bundledStarterPreset()
      : (requestedPresetId() ? getPreset(requestedPresetId()!) : undefined) ?? listPresets()[0]);
  localStorage.setItem(ACTIVE_PRESET_KEY, preset.id);
  document.title = `${preset.name} — Vibe Curator`;

  await scene.mount(stage, { ...VIBES[0], palette: preset.palette });
  scene.setViewMode('player');
  await loadPreset(state, preset);

  status.textContent = preset.name;
  app.dataset.ready = 'true';
  sound.textContent = 'Start sound';
  sound.hidden = false;
}

sound.addEventListener('click', () => void startSound());
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'm') void startSound();
});
window.addEventListener('focus', () => {
  sound.dataset.sleeping = 'false';
  if (state.started) window.setTimeout(() => { sound.dataset.sleeping = 'true'; }, 4200);
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

// The packaged app loads this wallpaper entry point directly. Register the
// custom-protocol listener here (not only in the website shell) so an already
// running companion receives Display on Mac activations instead of staying on
// the bundled Koi starter.
void registerDeepLinks(async (activation) => {
  if ('token' in activation) {
    await runtimeHost.activateTransfer(activation.token);
  } else {
    await runtimeHost.activatePreset(activation.presetId);
  }
});

void boot().catch((error) => {
  console.error('[vibe] wallpaper failed to start', error);
  status.textContent = error instanceof Error ? error.message : 'Wallpaper could not start.';
  status.dataset.error = 'true';
});
