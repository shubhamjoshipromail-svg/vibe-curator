import { resolveMusicBrief } from '../src/audio/resolve.ts';
import { renderProviderPrompt } from '../src/audio/render-prompt.ts';
import { containsNamedReference } from './music-brief.ts';
import type {
  AmbienceDirection,
  MusicBrief,
  MusicBriefDirection,
  MusicDirection,
  PlaybackPlan,
  SceneAudioContext,
} from '../src/audio/brief.ts';

export type RequestedVocalMode = 'auto' | 'vocals' | 'instrumental';

export interface MusicGenerationRequest {
  /** Legacy clients send only this rendered or free-form text. */
  prompt: string;
  /** The user's unrendered words. It may be empty when a card supplies direction. */
  userRequest: string;
  vocalMode: RequestedVocalMode;
  sceneContext?: SceneAudioContext;
  /**
   * A complete, validated card/UI brief. It is treated as card direction when
   * resolving the final brief, so explicit user words and the vocal control
   * keep the documented precedence over it.
   */
  brief?: MusicBrief;
}

const MODES = new Set<MusicBrief['mode']>(['soundscape', 'ambient_score', 'instrumental_score', 'song']);
const VOCALS = new Set<MusicBrief['vocals']>(['none', 'optional', 'required']);
const PLAYBACK_MODES = new Set<PlaybackPlan['mode']>(['once', 'loop', 'crossfade']);
const REQUESTED_VOCAL_MODES = new Set<RequestedVocalMode>(['auto', 'vocals', 'instrumental']);
const SCENE_ENERGIES = new Set<SceneAudioContext['energy']>(['still', 'gentle', 'active', 'intense']);
const VISUAL_RHYTHMS = new Set<SceneAudioContext['visualRhythm']>(['fluid', 'steady', 'fragmented', 'pulsing']);
const SCENE_SCALES = new Set<SceneAudioContext['scale']>(['intimate', 'room', 'landscape', 'cosmic']);
const MAX_TEXT = 12_000;
const MAX_LIST_ITEMS = 32;
const MAX_LIST_ITEM_LENGTH = 160;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown, label: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid music brief ${label}.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LIST_ITEM_LENGTH) throw new Error(`Invalid music brief ${label}.`);
  return trimmed;
}

function requestText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid music request ${label}.`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT) throw new Error('Music request is too large.');
  return trimmed;
}

function stringList(value: unknown, label: string, required = false): string[] | undefined {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new Error(`Invalid music brief ${label}.`);
  return value.map((item) => text(item, label, true)!);
}

function numberInRange(value: unknown, label: string, minimum: number, maximum: number, required = false): number | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid music brief ${label}.`);
  }
  return value;
}

function parseMusic(value: unknown): MusicDirection {
  const source = record(value);
  if (!source) throw new Error('Invalid music brief music.');
  return {
    mood: stringList(source.mood, 'music.mood', true)!,
    tempo: text(source.tempo, 'music.tempo'),
    rhythm: text(source.rhythm, 'music.rhythm'),
    instrumentation: stringList(source.instrumentation, 'music.instrumentation'),
    avoid: stringList(source.avoid, 'music.avoid'),
    density: text(source.density, 'music.density'),
    prominence: numberInRange(source.prominence, 'music.prominence', 0, 1),
    evolution: text(source.evolution, 'music.evolution'),
  };
}

function parseAmbience(value: unknown): AmbienceDirection {
  const source = record(value);
  if (!source || typeof source.enabled !== 'boolean') throw new Error('Invalid music brief ambience.');
  return {
    enabled: source.enabled,
    elements: stringList(source.elements, 'ambience.elements', true)!,
    prominence: numberInRange(source.prominence, 'ambience.prominence', 0, 1, true)!,
  };
}

function parsePlayback(value: unknown): PlaybackPlan {
  const source = record(value);
  if (!source || typeof source.mode !== 'string' || !PLAYBACK_MODES.has(source.mode as PlaybackPlan['mode'])) {
    throw new Error('Invalid music brief playback.mode.');
  }
  const targetDurationSeconds = numberInRange(source.targetDurationSeconds, 'playback.targetDurationSeconds', 1, 900, true)!;
  const crossfadeSeconds = numberInRange(source.crossfadeSeconds, 'playback.crossfadeSeconds', 0, targetDurationSeconds, true)!;
  const loopStart = numberInRange(source.loopStart, 'playback.loopStart', 0, targetDurationSeconds);
  const loopEnd = numberInRange(source.loopEnd, 'playback.loopEnd', 0, targetDurationSeconds);
  if ((loopStart === undefined) !== (loopEnd === undefined) || (loopStart !== undefined && loopEnd! <= loopStart)) {
    throw new Error('Invalid music brief playback loop.');
  }
  return { mode: source.mode as PlaybackPlan['mode'], targetDurationSeconds, crossfadeSeconds, loopStart, loopEnd };
}

function parseSceneContext(value: unknown): SceneAudioContext | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  if (
    !source
    || typeof source.energy !== 'string'
    || !SCENE_ENERGIES.has(source.energy as SceneAudioContext['energy'])
    || typeof source.visualRhythm !== 'string'
    || !VISUAL_RHYTHMS.has(source.visualRhythm as SceneAudioContext['visualRhythm'])
    || typeof source.scale !== 'string'
    || !SCENE_SCALES.has(source.scale as SceneAudioContext['scale'])
  ) {
    throw new Error('Invalid music request sceneContext.');
  }
  return {
    environment: stringList(source.environment, 'sceneContext.environment', true)!,
    observedElements: stringList(source.observedElements, 'sceneContext.observedElements', true)!,
    emotionalQualities: stringList(source.emotionalQualities, 'sceneContext.emotionalQualities', true)!,
    apparentEra: text(source.apparentEra, 'sceneContext.apparentEra'),
    energy: source.energy as SceneAudioContext['energy'],
    visualRhythm: source.visualRhythm as SceneAudioContext['visualRhythm'],
    scale: source.scale as SceneAudioContext['scale'],
    warmth: numberInRange(source.warmth, 'sceneContext.warmth', 0, 1, true)!,
    darkness: numberInRange(source.darkness, 'sceneContext.darkness', 0, 1, true)!,
  };
}

/** Parse the browser payload without trusting JSON to already match MusicBrief. */
export function parseMusicGenerationRequest(value: unknown): MusicGenerationRequest {
  const source = record(value);
  if (!source) throw new Error('Invalid music request.');
  const prompt = source.prompt === undefined ? '' : requestText(source.prompt, 'prompt');
  const userRequest = source.userRequest === undefined ? '' : requestText(source.userRequest, 'userRequest');
  const vocalMode = source.vocalMode === undefined ? 'auto' : source.vocalMode;
  if (typeof vocalMode !== 'string' || !REQUESTED_VOCAL_MODES.has(vocalMode as RequestedVocalMode)) {
    throw new Error('Invalid music request vocalMode.');
  }

  let brief: MusicBrief | undefined;
  if (source.brief !== undefined) {
    const raw = record(source.brief);
    if (!raw || typeof raw.mode !== 'string' || !MODES.has(raw.mode as MusicBrief['mode']) || typeof raw.vocals !== 'string' || !VOCALS.has(raw.vocals as MusicBrief['vocals'])) {
      throw new Error('Invalid music brief.');
    }
    brief = {
      mode: raw.mode as MusicBrief['mode'],
      vocals: raw.vocals as MusicBrief['vocals'],
      music: parseMusic(raw.music),
      ambience: parseAmbience(raw.ambience),
      playback: parsePlayback(raw.playback),
    };
  }

  if (!prompt && !userRequest && !brief) throw new Error('Describe the music first.');
  return {
    prompt,
    userRequest,
    vocalMode: vocalMode as RequestedVocalMode,
    sceneContext: parseSceneContext(source.sceneContext),
    brief,
  };
}

/**
 * Preserve a submitted card/UI brief, while applying only the higher-priority
 * user text and vocal control through the shared resolver.
 */
export function resolveRequestedMusicBrief(request: MusicGenerationRequest): MusicBrief {
  const requestText = request.userRequest || (request.brief ? undefined : request.prompt);
  return resolveMusicBrief({
    userRequest: requestText,
    vocalControl: request.vocalMode,
    cardDirection: request.brief as MusicBriefDirection | undefined,
    scene: request.sceneContext,
  });
}

/**
 * Build the complete untrusted prompt boundary used by the provider path.
 * Reference detection must inspect both client-supplied brief fields and the
 * user's free text; checking either half alone creates a bypass.
 */
export function buildMusicProviderPrompt(
  brief: MusicBrief,
  userRequest: string,
): { prompt: string; needsReferenceTranslation: boolean } {
  const prompt = `${renderProviderPrompt(brief, 'elevenlabs')} ${userRequest}`.trim();
  return {
    prompt,
    needsReferenceTranslation: containsNamedReference(prompt),
  };
}
