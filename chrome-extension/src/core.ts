export const PROTOCOL_VERSION = 1 as const;
export const TRUSTED_SITE_ORIGIN = 'https://vibe-curator-production.up.railway.app';
export const STORAGE_KEY = 'vibe.curator.extension.state.v1';

export const BASE_VIBE_IDS = ['ashen-keep', 'paper-valley', 'signal-drift', 'pixel-broadcast'] as const;
export const PROCEDURAL_SOURCE_IDS = ['living-koi', 'drifting-cloud', 'blooming-flower'] as const;

type BaseVibeId = (typeof BASE_VIBE_IDS)[number];
type ProceduralSourceId = (typeof PROCEDURAL_SOURCE_IDS)[number];

export interface Palette {
  base: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
  ramp: string[];
}

export interface Controls {
  mood: number;
  motion: number;
  depth: number;
  glow: number;
  atmosphere: number;
  intensity: number;
}

export interface AudioLayer { gain: number; muted: boolean }

export interface SafePreset {
  id: string;
  name: string;
  description: string;
  baseVibeId: BaseVibeId;
  scene:
    | { kind: 'renderer'; label: string; style: string }
    | { kind: 'procedural'; label: string; style: string; sourceId: ProceduralSourceId }
    | { kind: 'image'; label: string; style: string; url: string };
  palette: Palette;
  controls: Controls;
  audio: { ambience: AudioLayer; music: AudioLayer; master: AudioLayer };
  trackUrl?: string;
}

export interface ExtensionState {
  schemaVersion: 1;
  preset: SafePreset;
  playback: { desiredPlaying: boolean; soundUnlocked: boolean; masterVolume: number };
  revision: number;
  updatedAt: string;
}

export const DEFAULT_PRESET: SafePreset = {
  id: 'signal-drift',
  name: 'Signal Drift',
  description: 'Weightless and deep. Nothing to look at directly.',
  baseVibeId: 'signal-drift',
  scene: { kind: 'renderer', label: 'Living renderer', style: 'procedural' },
  palette: {
    base: '#05060f', surface: '#141d3d', primary: '#22345e', accent: '#4fa3b8', text: '#dff6f4',
    ramp: ['#05060f', '#0b1024', '#141d3d', '#22345e', '#356a8a', '#4fa3b8', '#8fd6dc', '#dff6f4'],
  },
  controls: { mood: 0.25, motion: 0.5, depth: 0.85, glow: 0.6, atmosphere: 0.5, intensity: 0.6 },
  audio: {
    ambience: { gain: 0.8, muted: false }, music: { gain: 0.65, muted: false }, master: { gain: 0.8, muted: false },
  },
};

export const DEFAULT_STATE: ExtensionState = {
  schemaVersion: 1,
  preset: DEFAULT_PRESET,
  playback: { desiredPlaying: false, soundUnlocked: false, masterVolume: 0.8 },
  revision: 0,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export type InternalRequest =
  | { v: 1; target: 'service-worker'; type: 'get-state'; requestId: string }
  | { v: 1; target: 'service-worker'; type: 'enable-sound'; requestId: string }
  | { v: 1; target: 'service-worker'; type: 'set-playing'; requestId: string; playing: boolean }
  | { v: 1; target: 'service-worker'; type: 'set-volume'; requestId: string; volume: number };

export interface ExternalSetPresetRequest { v: 1; type: 'vibe:set-preset'; requestId: string; preset: SafePreset }
export interface AudioApplyRequest { v: 1; target: 'offscreen'; type: 'audio:apply'; requestId: string; sessionToken: string; state: ExtensionState }
export type SuccessResponse = { v: 1; requestId: string; ok: true; state: ExtensionState };
export type ErrorResponse = { v: 1; requestId: string; ok: false; error: { code: string; message: string }; message: string };
export type ProtocolResponse = SuccessResponse | ErrorResponse;

const REQUEST_ID = /^[a-zA-Z0-9_-]{8,96}$/;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const MARKET_IMAGE_PATH = /^\/market\/styles\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i;
const CURATED_AUDIO_PATH = /^\/audio\/curated\/[a-z0-9][a-z0-9._-]*\.mp3$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) if (!known.has(key)) throw new Error(`${label} contains unsupported field "${key}".`);
}

function stringValue(value: unknown, label: string, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || (pattern && !pattern.test(value))) throw new Error(`${label} is invalid.`);
  return value;
}

function unitValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1.`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function integerValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${label} is unsupported.`);
  return value as T[number];
}

function trustedMediaUrl(value: unknown, kind: 'image' | 'audio'): string {
  const raw = stringValue(value, `${kind} URL`, 300);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${kind} URL is invalid.`); }
  const pathPattern = kind === 'image' ? MARKET_IMAGE_PATH : CURATED_AUDIO_PATH;
  if (url.protocol !== 'https:' || url.origin !== TRUSTED_SITE_ORIGIN || url.username || url.password || url.search || url.hash || !pathPattern.test(url.pathname)) {
    throw new Error(`${kind} URL is not an approved Vibe Curator asset.`);
  }
  return url.href;
}

function validatePalette(value: unknown): Palette {
  const palette = record(value, 'palette');
  exactKeys(palette, ['base', 'surface', 'primary', 'accent', 'text', 'ramp'], 'palette');
  if (!Array.isArray(palette.ramp) || palette.ramp.length !== 8) throw new Error('palette.ramp must contain eight colors.');
  return {
    base: stringValue(palette.base, 'palette.base', 9, HEX), surface: stringValue(palette.surface, 'palette.surface', 9, HEX),
    primary: stringValue(palette.primary, 'palette.primary', 9, HEX), accent: stringValue(palette.accent, 'palette.accent', 9, HEX),
    text: stringValue(palette.text, 'palette.text', 9, HEX),
    ramp: palette.ramp.map((color, index) => stringValue(color, `palette.ramp[${index}]`, 9, HEX)),
  };
}

function validateControls(value: unknown): Controls {
  const controls = record(value, 'controls');
  exactKeys(controls, ['mood', 'motion', 'depth', 'glow', 'atmosphere', 'intensity'], 'controls');
  return {
    mood: unitValue(controls.mood, 'controls.mood'), motion: unitValue(controls.motion, 'controls.motion'),
    depth: unitValue(controls.depth, 'controls.depth'), glow: unitValue(controls.glow, 'controls.glow'),
    atmosphere: unitValue(controls.atmosphere, 'controls.atmosphere'), intensity: unitValue(controls.intensity, 'controls.intensity'),
  };
}

function validateLayer(value: unknown, label: string): AudioLayer {
  const layer = record(value, label);
  exactKeys(layer, ['gain', 'muted'], label);
  return { gain: unitValue(layer.gain, `${label}.gain`), muted: booleanValue(layer.muted, `${label}.muted`) };
}

function validateAudio(value: unknown): SafePreset['audio'] {
  const audio = record(value, 'audio');
  exactKeys(audio, ['ambience', 'music', 'master'], 'audio');
  return { ambience: validateLayer(audio.ambience, 'audio.ambience'), music: validateLayer(audio.music, 'audio.music'), master: validateLayer(audio.master, 'audio.master') };
}

function validateScene(value: unknown): SafePreset['scene'] {
  const scene = record(value, 'scene');
  const kind = stringValue(scene.kind, 'scene.kind', 16);
  const common = { label: stringValue(scene.label, 'scene.label', 100), style: stringValue(scene.style, 'scene.style', 100) };
  if (kind === 'renderer') { exactKeys(scene, ['kind', 'label', 'style'], 'scene'); return { kind, ...common }; }
  if (kind === 'procedural') {
    exactKeys(scene, ['kind', 'label', 'style', 'sourceId'], 'scene');
    return { kind, ...common, sourceId: enumValue(scene.sourceId, PROCEDURAL_SOURCE_IDS, 'scene.sourceId') };
  }
  if (kind === 'image') { exactKeys(scene, ['kind', 'label', 'style', 'url'], 'scene'); return { kind, ...common, url: trustedMediaUrl(scene.url, 'image') }; }
  throw new Error('scene.kind is unsupported.');
}

export function validatePreset(value: unknown): SafePreset {
  const preset = record(value, 'preset');
  exactKeys(preset, ['id', 'name', 'description', 'baseVibeId', 'scene', 'palette', 'controls', 'audio', 'trackUrl'], 'preset');
  const result: SafePreset = {
    id: stringValue(preset.id, 'preset.id', 96, IDENTIFIER), name: stringValue(preset.name, 'preset.name', 100),
    description: stringValue(preset.description, 'preset.description', 400),
    baseVibeId: enumValue(preset.baseVibeId, BASE_VIBE_IDS, 'preset.baseVibeId'), scene: validateScene(preset.scene),
    palette: validatePalette(preset.palette), controls: validateControls(preset.controls), audio: validateAudio(preset.audio),
  };
  if (preset.trackUrl !== undefined) result.trackUrl = trustedMediaUrl(preset.trackUrl, 'audio');
  return result;
}

export function validateState(value: unknown): ExtensionState {
  const state = record(value, 'state');
  exactKeys(state, ['schemaVersion', 'preset', 'playback', 'revision', 'updatedAt'], 'state');
  if (state.schemaVersion !== 1) throw new Error('Unsupported state version.');
  const playback = record(state.playback, 'playback');
  exactKeys(playback, ['desiredPlaying', 'soundUnlocked', 'masterVolume'], 'playback');
  const updatedAt = stringValue(state.updatedAt, 'updatedAt', 40);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('updatedAt is invalid.');
  return {
    schemaVersion: 1, preset: validatePreset(state.preset),
    playback: {
      desiredPlaying: booleanValue(playback.desiredPlaying, 'playback.desiredPlaying'),
      soundUnlocked: booleanValue(playback.soundUnlocked, 'playback.soundUnlocked'),
      masterVolume: unitValue(playback.masterVolume, 'playback.masterVolume'),
    },
    revision: integerValue(state.revision, 'revision'), updatedAt,
  };
}

function validateEnvelope(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  const request = record(value, label);
  exactKeys(request, allowed, label);
  if (request.v !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version.');
  stringValue(request.requestId, 'requestId', 96, REQUEST_ID);
  return request;
}

export function validateInternalRequest(value: unknown): InternalRequest {
  const base = record(value, 'request');
  const type = base.type;
  if (type === 'get-state' || type === 'enable-sound') {
    const request = validateEnvelope(base, ['v', 'target', 'type', 'requestId'], 'request');
    if (request.target !== 'service-worker') throw new Error('Invalid request target.');
    return request as unknown as InternalRequest;
  }
  if (type === 'set-playing') {
    const request = validateEnvelope(base, ['v', 'target', 'type', 'requestId', 'playing'], 'request');
    if (request.target !== 'service-worker') throw new Error('Invalid request target.');
    booleanValue(request.playing, 'playing'); return request as unknown as InternalRequest;
  }
  if (type === 'set-volume') {
    const request = validateEnvelope(base, ['v', 'target', 'type', 'requestId', 'volume'], 'request');
    if (request.target !== 'service-worker') throw new Error('Invalid request target.');
    unitValue(request.volume, 'volume'); return request as unknown as InternalRequest;
  }
  throw new Error('Unsupported internal request.');
}

export function validateExternalRequest(value: unknown): ExternalSetPresetRequest {
  const request = validateEnvelope(value, ['v', 'type', 'requestId', 'preset'], 'request');
  if (request.type !== 'vibe:set-preset') throw new Error('Unsupported external request.');
  return { v: 1, type: 'vibe:set-preset', requestId: request.requestId as string, preset: validatePreset(request.preset) };
}

export function validateAudioRequest(value: unknown): AudioApplyRequest {
  const request = validateEnvelope(value, ['v', 'target', 'type', 'requestId', 'sessionToken', 'state'], 'audio request');
  if (request.target !== 'offscreen' || request.type !== 'audio:apply') throw new Error('Unsupported audio request.');
  return {
    v: 1, target: 'offscreen', type: 'audio:apply', requestId: request.requestId as string,
    sessionToken: stringValue(request.sessionToken, 'sessionToken', 96, REQUEST_ID), state: validateState(request.state),
  };
}

export function nextState(current: ExtensionState, change: Partial<ExtensionState['playback']> & { preset?: SafePreset }, now = new Date()): ExtensionState {
  const { preset, ...playbackChange } = change;
  return validateState({
    schemaVersion: 1, preset: preset ?? current.preset, playback: { ...current.playback, ...playbackChange },
    revision: current.revision + 1, updatedAt: now.toISOString(),
  });
}

export async function commitAfterAudio(
  next: ExtensionState,
  applyAudio: (state: ExtensionState) => Promise<void>,
  persist: (state: ExtensionState) => Promise<void>,
): Promise<ExtensionState> {
  await applyAudio(next);
  await persist(next);
  return next;
}

export function isTrustedExternalSender(origin?: string, url?: string): boolean {
  if (origin !== TRUSTED_SITE_ORIGIN || !url) return false;
  try { return new URL(url).origin === TRUSTED_SITE_ORIGIN; } catch { return false; }
}

export function requestId(prefix = 'ext'): string { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

export function errorResponse(requestIdValue: unknown, code: string, error: unknown): ErrorResponse {
  const id = typeof requestIdValue === 'string' && REQUEST_ID.test(requestIdValue) ? requestIdValue : 'invalid_request';
  const message = error instanceof Error ? error.message : 'The request could not be completed.';
  return { v: 1, requestId: id, ok: false, error: { code, message }, message };
}
