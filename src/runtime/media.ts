/**
 * Small, versioned-by-name boundary between the native tray/popover and the
 * persistent wallpaper webview. Keeping this here means the webview can be
 * tested as a normal browser surface while native code only needs to emit
 * named events.
 */

export const NATIVE_MEDIA_EVENTS = {
  activatePreset: 'vibe://activate-preset',
  activateTransfer: 'vibe://activate-transfer',
  setMasterVolume: 'vibe://audio/set-master-volume',
  setMuted: 'vibe://audio/set-muted',
  start: 'vibe://audio/start',
  stop: 'vibe://audio/stop',
  // Kept while existing tray installs use the original menu event.
  legacySetMuted: 'vibe://set-sound-muted',
  status: 'vibe://audio/status',
  currentPreset: 'vibe://audio/current-preset',
  volume: 'vibe://audio/volume',
  requestState: 'vibe://native-controls/request-state',
} as const;

export type PlayerStatus = 'awaiting-gesture' | 'starting' | 'playing' | 'stopped' | 'error';

export interface NativePlayerStatus {
  status: PlayerStatus;
  started: boolean;
  muted: boolean;
  volume: number;
  levelDb?: number;
  presetId?: string;
  error?: string;
}

export interface NativePresetStatus {
  presetId: string;
  name: string;
}

export interface NativeVolumeStatus {
  volume: number;
  muted: boolean;
}

export interface NativeMediaControls {
  onActivatePreset(presetId: string): void | Promise<void>;
  onActivateTransfer(token: string): void | Promise<void>;
  onSetMasterVolume(volume: number): void | Promise<void>;
  onSetMuted(muted: boolean): void | Promise<void>;
  onStart(): void | Promise<void>;
  onStop(): void | Promise<void>;
  onRequestState(): void | Promise<void>;
}

export function clampVolume(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function validPresetId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/** Subscribe only inside Tauri. The returned function is safe in previews. */
export async function listenNativeMediaControls(controls: NativeMediaControls): Promise<() => void> {
  if (!('__TAURI_INTERNALS__' in window)) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const entries = await Promise.all([
    listen<{ presetId?: unknown }>(NATIVE_MEDIA_EVENTS.activatePreset, (event) => {
      if (validPresetId(event.payload?.presetId)) void controls.onActivatePreset(event.payload.presetId);
    }),
    listen<{ token?: unknown }>(NATIVE_MEDIA_EVENTS.activateTransfer, (event) => {
      if (validToken(event.payload?.token)) void controls.onActivateTransfer(event.payload.token);
    }),
    listen<unknown>(NATIVE_MEDIA_EVENTS.setMasterVolume, (event) => {
      const volume = clampVolume(event.payload);
      if (volume !== undefined) void controls.onSetMasterVolume(volume);
    }),
    listen<boolean>(NATIVE_MEDIA_EVENTS.setMuted, (event) => {
      if (typeof event.payload === 'boolean') void controls.onSetMuted(event.payload);
    }),
    listen(NATIVE_MEDIA_EVENTS.start, () => void controls.onStart()),
    listen(NATIVE_MEDIA_EVENTS.stop, () => void controls.onStop()),
    listen(NATIVE_MEDIA_EVENTS.requestState, () => void controls.onRequestState()),
    listen<boolean>(NATIVE_MEDIA_EVENTS.legacySetMuted, (event) => {
      if (typeof event.payload === 'boolean') void controls.onSetMuted(event.payload);
    }),
  ]);
  return () => entries.forEach((unlisten) => unlisten());
}

export async function emitNativeMediaEvent(
  event: typeof NATIVE_MEDIA_EVENTS.status | typeof NATIVE_MEDIA_EVENTS.currentPreset | typeof NATIVE_MEDIA_EVENTS.volume,
  payload: NativePlayerStatus | NativePresetStatus | NativeVolumeStatus,
): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const { emit } = await import('@tauri-apps/api/event');
  await emit(event, payload);
}
