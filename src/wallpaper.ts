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
import { appApiUrl, isBundledSurface } from './runtime/config';
import { cacheTransferredAsset } from './media/assets';
import { readMasterAudioPreferences, recoverLegacyZeroVolume, writeMasterAudioPreferences } from './audio/preferences';
import {
  emitNativeMediaEvent,
  listenNativeMediaControls,
  type NativePlayerStatus,
} from './runtime/media';
import type { Preset } from './preset/types';

const ACTIVE_PRESET_KEY = 'vibe.wallpaper.preset-id';
const STARTER_PRESET_ID = 'market-pixel-last-broadcast';
const STARTER_MUSIC_ID = 'builtin_last_broadcast_score';
const app = document.querySelector<HTMLDivElement>('#wallpaper-app')!;
const stage = document.querySelector<HTMLDivElement>('#stage')!;
const status = document.querySelector<HTMLDivElement>('#wallpaper-status')!;
const sound = document.querySelector<HTMLButtonElement>('#wallpaper-sound')!;
const controlsButton = document.querySelector<HTMLButtonElement>('#wallpaper-controls')!;

const scene = new Scene();
const audio = new AudioEngine();
const state = createState(scene, audio);
let masterPreferences = recoverLegacyZeroVolume(readMasterAudioPreferences());
let bootPromise: Promise<void> | undefined;
let activationChain = Promise.resolve();
const pendingActivationKeys = new Set<string>();

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
  const response = await fetch(appApiUrl(`/api/native/activations/${token}`), { cache: 'no-store' });
  const body = await response.json().catch(() => ({})) as { preset?: Preset; message?: string };
  if (!response.ok || !body.preset) throw new Error(body.message || 'The Mac handoff could not be loaded.');
  const assetIds = [
    body.preset.scene.kind === 'image' || body.preset.scene.kind === 'video' ? body.preset.scene.assetId : undefined,
    body.preset.music?.url ? undefined : body.preset.music?.assetId,
  ].filter((value): value is string => Boolean(value));
  for (const assetId of [...new Set(assetIds)]) {
    try {
      const assetResponse = await fetch(appApiUrl(`/api/native/activations/${token}/assets/${encodeURIComponent(assetId)}`), { cache: 'no-store' });
      if (!assetResponse.ok) throw new Error(`HTTP ${assetResponse.status}`);
      await cacheTransferredAsset(assetId, await assetResponse.blob());
    } catch (error) {
      // The scene loader has a renderer fallback. Keep the handoff usable when
      // an individual transfer asset expires or its cache is unavailable.
      console.warn(`[vibe] transferred asset ${assetId} could not be cached; using fallback if needed`, error);
    }
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
    // Measured after mastering trimmed the fade. It was 30 here, which was the
    // pre-master length and made the wallpaper loop early against a 20.6s file.
    durationSeconds: 20.61,
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

function playerStatus(status: NativePlayerStatus['status'], error?: unknown): NativePlayerStatus {
  const master = audio.getLayer('master');
  return {
    status,
    started: state.started,
    muted: master.muted,
    volume: master.gain,
    levelDb: audio.getLevel(),
    presetId: state.loaded?.id,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  };
}

function reportPlayerStatus(status: NativePlayerStatus['status'], error?: unknown): void {
  void emitNativeMediaEvent('vibe://audio/status', playerStatus(status, error)).catch((eventError) => {
    console.warn('[vibe] could not report native player status', eventError);
  });
}

function reportVolume(): void {
  const master = audio.getLayer('master');
  void emitNativeMediaEvent('vibe://audio/volume', { volume: master.gain, muted: master.muted });
}

function reportNativeState(): void {
  const preset = state.loaded;
  if (preset) void emitNativeMediaEvent('vibe://audio/current-preset', { presetId: preset.id, name: preset.name });
  reportVolume();
  reportPlayerStatus(state.started ? 'playing' : 'awaiting-gesture');
}

function applyMasterPreferences(): void {
  audio.setLayer('master', masterPreferences.volume, masterPreferences.muted);
}

function soundLabel(): string {
  if (!state.started) return 'Start sound';
  if (masterPreferences.muted) return 'Sound muted';
  const percent = Math.round(masterPreferences.volume * 100);
  return percent === 0 ? 'Volume 0%' : `Sound on · ${percent}%`;
}

function persistMasterPreferences(): void {
  const master = audio.getLayer('master');
  masterPreferences = { volume: master.gain, muted: master.muted };
  writeMasterAudioPreferences(masterPreferences);
  reportVolume();
}

async function startSound(fromNativeControl = false): Promise<void> {
  const preset = state.loaded;
  if (!preset) return;
  if (state.started) {
    await runtimeHost.enterWallpaperMode();
    sound.textContent = soundLabel();
    sound.dataset.sleeping = masterPreferences.volume > 0 && !masterPreferences.muted ? 'true' : 'false';
    reportPlayerStatus('playing');
    return;
  }
  sound.disabled = true;
  reportPlayerStatus('starting');
  try {
    audio.setAmbientEvents(preset.livingStill?.audio.events ?? []);
    await audio.start(audioSpecForPreset(preset));
    state.started = true;
    syncAudioLayers(state, preset);
    applyMasterPreferences();
    await syncGeneratedMusic(state, preset);
    sound.textContent = soundLabel();
    if (masterPreferences.volume > 0 && !masterPreferences.muted) {
      window.setTimeout(() => { sound.dataset.sleeping = 'true'; }, 2600);
    }
    await runtimeHost.enterWallpaperMode();
    reportPlayerStatus('playing');
    window.setTimeout(() => reportPlayerStatus('playing'), 1600);
  } catch (error) {
    console.error('[vibe] wallpaper audio failed to start', error);
    sound.textContent = error instanceof Error ? `Sound unavailable · ${error.message}` : 'Sound unavailable';
    // A native menu/popover click is not a gesture in this webview. Do not
    // pretend otherwise: leave the visible wallpaper button available.
    reportPlayerStatus(fromNativeControl ? 'awaiting-gesture' : 'error', error);
  } finally {
    sound.disabled = false;
  }
}

function setSoundMuted(muted: boolean): void {
  masterPreferences = { ...masterPreferences, muted };
  writeMasterAudioPreferences(masterPreferences);
  if (!state.started) {
    sound.textContent = 'Start sound';
    sound.dataset.sleeping = 'false';
    applyMasterPreferences();
    reportVolume();
    reportPlayerStatus('awaiting-gesture');
    return;
  }
  applyMasterPreferences();
  sound.textContent = soundLabel();
  sound.dataset.sleeping = 'false';
  if (!muted && masterPreferences.volume > 0) {
    window.setTimeout(() => { sound.dataset.sleeping = 'true'; }, 3200);
  }
  reportVolume();
  reportPlayerStatus('playing');
}

function setMasterVolume(volume: number): void {
  masterPreferences = { ...masterPreferences, volume };
  applyMasterPreferences();
  persistMasterPreferences();
  sound.textContent = soundLabel();
  sound.dataset.sleeping = volume > 0 && !masterPreferences.muted && state.started ? 'true' : 'false';
  reportPlayerStatus(state.started ? 'playing' : 'awaiting-gesture');
}

function stopSound(): void {
  if (state.started) audio.stop();
  state.started = false;
  sound.textContent = 'Start sound';
  sound.dataset.sleeping = 'false';
  reportPlayerStatus('stopped');
}

async function activatePreset(preset: Preset): Promise<void> {
  localStorage.setItem(ACTIVE_PRESET_KEY, preset.id);
  document.title = `${preset.name} — Vibe Curator`;
  await loadPreset(state, preset);
  // Presets author their ambience/music mix, but the system master belongs to
  // the listener and survives every native activation.
  applyMasterPreferences();
  status.textContent = preset.name;
  delete status.dataset.error;
  app.dataset.ready = 'true';
  sound.textContent = soundLabel();
  void emitNativeMediaEvent('vibe://audio/current-preset', { presetId: preset.id, name: preset.name });
  reportVolume();
  reportPlayerStatus(state.started ? 'playing' : 'awaiting-gesture');
}

function queueActivation(key: string, work: () => Promise<void>): void {
  // Tauri's deep-link plugin and the single-instance handler can both observe
  // one OS URL. Ignore only the duplicate that is already in flight; a later
  // request for the same preset is still allowed to refresh it.
  if (pendingActivationKeys.has(key)) return;
  pendingActivationKeys.add(key);
  activationChain = activationChain
    .then(work)
    .catch((error) => {
      console.error('[vibe] wallpaper activation failed', error);
      status.textContent = error instanceof Error ? error.message : 'Wallpaper activation failed.';
      status.dataset.error = 'true';
      reportPlayerStatus('error', error);
    })
    .finally(() => {
      pendingActivationKeys.delete(key);
    });
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
  await scene.mount(stage, { ...VIBES[0], palette: preset.palette });
  await audio.prepare();
  scene.setViewMode('player');
  await activatePreset(preset);
  sound.hidden = false;
  controlsButton.hidden = !isBundledSurface();
}

sound.addEventListener('click', () => void startSound());
controlsButton.addEventListener('click', async () => {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('show_native_controls_command');
});
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'm') void startSound();
});
window.addEventListener('focus', () => {
  sound.dataset.sleeping = 'false';
  if (state.started) window.setTimeout(() => { sound.dataset.sleeping = 'true'; }, 4200);
});

void listenNativeMediaControls({
  onActivatePreset: async (presetId) => {
    await bootPromise;
    queueActivation(`preset:${presetId}`, async () => {
      const preset = getPreset(presetId) ?? (await hydrateLibrary(), getPreset(presetId));
      if (!preset) throw new Error(`Preset “${presetId}” is unavailable.`);
      await activatePreset(preset);
    });
  },
  onActivateTransfer: async (token) => {
    await bootPromise;
    queueActivation(`transfer:${token}`, async () => activatePreset(await receiveActivation(token)));
  },
  onSetMasterVolume: setMasterVolume,
  onSetMuted: setSoundMuted,
  onStart: async () => {
    await bootPromise;
    await startSound(true);
  },
  onStop: stopSound,
  onRequestState: reportNativeState,
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
  await bootPromise;
  if ('controls' in activation) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('show_native_controls_command');
  } else if ('token' in activation) queueActivation(`transfer:${activation.token}`, async () => activatePreset(await receiveActivation(activation.token)));
  else queueActivation(`preset:${activation.presetId}`, async () => {
    const preset = getPreset(activation.presetId) ?? (await hydrateLibrary(), getPreset(activation.presetId));
    if (!preset) throw new Error(`Preset “${activation.presetId}” is unavailable.`);
    await activatePreset(preset);
  });
}, false);

bootPromise = boot().catch((error) => {
  console.error('[vibe] wallpaper failed to start', error);
  status.textContent = error instanceof Error ? error.message : 'Wallpaper could not start.';
  status.dataset.error = 'true';
  reportPlayerStatus('error', error);
});
