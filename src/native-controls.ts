import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type NativeControlsSnapshot = {
  wallpaperVisible: boolean;
  desktopIconsVisible: boolean;
  launchAtLogin: boolean;
};

type PlaybackState = 'playing' | 'stopped' | 'awaiting-gesture' | 'unknown';

const sceneName = document.querySelector<HTMLElement>('#scene-name')!;
const audioStatus = document.querySelector<HTMLElement>('#audio-status')!;
const volume = document.querySelector<HTMLInputElement>('#master-volume')!;
const volumeValue = document.querySelector<HTMLOutputElement>('#volume-value')!;
const start = document.querySelector<HTMLButtonElement>('#start')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const gestureFallback = document.querySelector<HTMLButtonElement>('#gesture-fallback')!;
const wallpaperToggle = document.querySelector<HTMLButtonElement>('#wallpaper-toggle')!;
const iconsToggle = document.querySelector<HTMLButtonElement>('#icons-toggle')!;
const loginToggle = document.querySelector<HTMLButtonElement>('#login-toggle')!;
const openEditor = document.querySelector<HTMLButtonElement>('#open-editor')!;
const closeControls = document.querySelector<HTMLButtonElement>('#close-controls')!;

let nativeState: NativeControlsSnapshot = { wallpaperVisible: true, desktopIconsVisible: true, launchAtLogin: false };
let volumeTimer: number | undefined;

function actionButtonValue(button: HTMLButtonElement, text: string): void {
  button.querySelector<HTMLElement>('.row-value')!.textContent = text;
}

function renderNativeState(): void {
  actionButtonValue(wallpaperToggle, nativeState.wallpaperVisible ? 'Hide' : 'Show');
  actionButtonValue(iconsToggle, nativeState.desktopIconsVisible ? 'Hide' : 'Show');
  actionButtonValue(loginToggle, nativeState.launchAtLogin ? 'On' : 'Off');
}

function renderPlayback(state: PlaybackState, detail?: string): void {
  const labels: Record<PlaybackState, string> = {
    playing: 'Playing',
    stopped: 'Stopped',
    'awaiting-gesture': 'Needs click',
    unknown: 'Connecting',
  };
  audioStatus.textContent = detail || labels[state];
  audioStatus.dataset.state = state;
  // Never claim that playback started until the wallpaper renderer reports it.
  start.disabled = state === 'playing';
  stop.disabled = state === 'stopped';
  gestureFallback.hidden = state !== 'awaiting-gesture';
}

function setVolume(value: number): void {
  const safe = Math.min(1, Math.max(0, value));
  volume.value = String(safe);
  volumeValue.value = `${Math.round(safe * 100)}%`;
  volumeValue.textContent = volumeValue.value;
}

async function dispatch(action: Record<string, unknown>): Promise<void> {
  await invoke('native_controls_dispatch', { action });
}

function readPlaybackStatus(payload: unknown): { state: PlaybackState; detail?: string } {
  const values = typeof payload === 'object' && payload ? payload as Record<string, unknown> : undefined;
  const raw = typeof payload === 'string'
    ? payload
    : values
      ? String(values.state ?? values.status ?? '')
      : '';
  const normalized = raw.toLowerCase().replaceAll('_', '-');
  if (normalized === 'playing') {
    const level = typeof values?.levelDb === 'number' && Number.isFinite(values.levelDb) ? values.levelDb : undefined;
    return { state: 'playing', detail: level === undefined ? undefined : `Playing · ${Math.round(level)} dB` };
  }
  if (normalized === 'awaiting-gesture' || normalized === 'needs-gesture') return { state: 'awaiting-gesture' };
  if (normalized === 'stopped' || normalized === 'idle') return { state: 'stopped' };
  const error = typeof values?.error === 'string' ? values.error : undefined;
  return { state: 'unknown', detail: error || raw || undefined };
}

function readPresetName(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload) {
    const values = payload as Record<string, unknown>;
    const candidate = values.name ?? values.presetName ?? values.title;
    return typeof candidate === 'string' ? candidate : undefined;
  }
  return undefined;
}

function readVolume(payload: unknown): number | undefined {
  const value = typeof payload === 'number'
    ? payload
    : typeof payload === 'object' && payload ? (payload as Record<string, unknown>).volume : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

start.addEventListener('click', () => {
  // The wallpaper may need a direct user gesture for Web Audio. Keep the
  // renderer authoritative and expose its awaiting-gesture fallback.
  renderPlayback('unknown', 'Start requested');
  void dispatch({ action: 'start' }).catch((error) => renderPlayback('stopped', String(error)));
});
stop.addEventListener('click', () => void dispatch({ action: 'stop' }));
volume.addEventListener('input', () => {
  setVolume(Number(volume.value));
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => {
    void dispatch({ action: 'setMasterVolume', volume: Number(volume.value) });
  }, 40);
});
wallpaperToggle.addEventListener('click', () => void dispatch({
  action: 'setWallpaperVisible', visible: !nativeState.wallpaperVisible,
}));
iconsToggle.addEventListener('click', () => void dispatch({
  action: 'setDesktopIconsVisible', visible: !nativeState.desktopIconsVisible,
}));
loginToggle.addEventListener('click', () => void dispatch({
  action: 'setLaunchAtLogin', enabled: !nativeState.launchAtLogin,
}));
openEditor.addEventListener('click', () => void dispatch({ action: 'openEditor' }));
closeControls.addEventListener('click', () => void invoke('native_controls_close'));
gestureFallback.addEventListener('click', () => {
  void invoke('enable_wallpaper_controls').then(() => invoke('native_controls_close'));
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void invoke('native_controls_close');
});

void Promise.all([
  invoke<NativeControlsSnapshot>('native_controls_snapshot_command').then((snapshot) => {
    nativeState = snapshot;
    renderNativeState();
  }),
  listen<NativeControlsSnapshot>('vibe://native-controls/snapshot', (event) => {
    nativeState = event.payload;
    renderNativeState();
  }),
  listen<unknown>('vibe://audio/status', (event) => {
    const next = readPlaybackStatus(event.payload);
    renderPlayback(next.state, next.detail);
  }),
  listen<unknown>('vibe://audio/current-preset', (event) => {
    const name = readPresetName(event.payload);
    if (name) sceneName.textContent = name;
  }),
  listen<unknown>('vibe://audio/volume', (event) => {
    const next = readVolume(event.payload);
    if (next !== undefined) setVolume(next);
  }),
]);

renderNativeState();
renderPlayback('stopped');
