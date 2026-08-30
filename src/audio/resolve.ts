import type {
  AmbienceDirection,
  MusicBrief,
  MusicBriefDirection,
  MusicDirection,
  MusicMode,
  PlaybackPlan,
  SceneAudioContext,
  VocalRequirement,
} from './brief';

/**
 * Turns everything we know about a card into a single `MusicBrief`.
 *
 * Precedence, highest first:
 *   1. an explicit user request
 *   2. the UI vocal control
 *   3. card direction
 *   4. scene analysis
 *   5. the mode default
 *
 * A higher tier wins outright on any field it sets; a lower tier only fills a
 * field still undefined. The one deliberate inversion is `vocals`: the UI
 * control is authoritative whenever it is not 'auto', so a request asking for a
 * chorus cannot override an explicit instrumental toggle.
 *
 * The critical invariant: `scene.observedElements` may only ever reach
 * `brief.ambience.elements`. A visible fire contributes fire ambience and
 * warmth; it never decides genre or instrumentation.
 */

export interface ResolveMusicBriefInputs {
  userRequest?: string;
  vocalControl: 'auto' | 'vocals' | 'instrumental';
  cardDirection?: MusicBriefDirection;
  scene?: SceneAudioContext;
}

interface ModeDefaults {
  vocals: VocalRequirement;
  playbackMode: PlaybackPlan['mode'];
  targetDurationSeconds: number;
  crossfadeSeconds: number;
  ambienceProminence: number;
}

const DEFAULT_MODE: MusicMode = 'ambient_score';

const MODE_DEFAULTS: Record<MusicMode, ModeDefaults> = {
  soundscape: {
    vocals: 'none',
    playbackMode: 'crossfade',
    targetDurationSeconds: 120,
    crossfadeSeconds: 10,
    ambienceProminence: 0.9,
  },
  ambient_score: {
    vocals: 'none',
    playbackMode: 'crossfade',
    targetDurationSeconds: 120,
    crossfadeSeconds: 8,
    ambienceProminence: 0.4,
  },
  instrumental_score: {
    vocals: 'none',
    playbackMode: 'crossfade',
    targetDurationSeconds: 120,
    crossfadeSeconds: 3,
    ambienceProminence: 0.25,
  },
  song: {
    vocals: 'required',
    playbackMode: 'once',
    targetDurationSeconds: 180,
    crossfadeSeconds: 0,
    ambienceProminence: 0.15,
  },
};

/**
 * Closed vocabularies. Request parsing is deliberately lexical and small: it
 * recognises words a user actually typed and infers nothing else.
 */
const INSTRUMENTS = [
  'string quartet', 'double bass', 'upright bass', 'french horn', 'acoustic guitar',
  'electric guitar', 'felt piano', 'cello', 'violin', 'viola', 'piano', 'harp',
  'guitar', 'flute', 'clarinet', 'oboe', 'bassoon', 'saxophone', 'trumpet',
  'trombone', 'horn', 'organ', 'harmonium', 'accordion', 'synthesizer', 'synth',
  'strings', 'choir', 'drums', 'percussion', 'bass', 'marimba', 'kalimba',
  'vibraphone', 'glockenspiel', 'timpani', 'bells', 'pads', 'pad', 'banjo',
  'mandolin', 'sitar', 'koto', 'shakuhachi', 'duduk',
];

const MOODS = [
  'classical', 'orchestral', 'cinematic', 'ambient', 'jazz', 'folk', 'electronic',
  'lo-fi', 'minimal', 'minimalist', 'choral', 'baroque', 'romantic', 'melancholy',
  'melancholic', 'hopeful', 'tender', 'nostalgic', 'triumphant', 'ominous',
  'serene', 'playful', 'somber', 'ethereal', 'meditative', 'tense', 'uplifting',
  'wistful', 'sacred', 'pastoral', 'noir', 'drone', 'dreamy',
];

const TEMPI: ReadonlyArray<readonly [string, string]> = [
  ['very slow', 'very slow'], ['mid-tempo', 'moderate'], ['midtempo', 'moderate'],
  ['slow', 'slow'], ['languid', 'slow'], ['unhurried', 'slow'],
  ['moderate', 'moderate'], ['medium', 'moderate'],
  ['upbeat', 'fast'], ['driving', 'fast'], ['brisk', 'fast'], ['fast', 'fast'],
];

const RHYTHMS = ['syncopated', 'rubato', 'free time', 'fragmented', 'pulsing', 'steady', 'fluid'];

const DENSITIES = ['sparse', 'spacious', 'layered', 'lush', 'dense', 'thin', 'full'];

const VOCAL_WORDS = ['vocals', 'vocal', 'singing', 'sung', 'lyrics', 'chorus', 'verse', 'voice', 'voices', 'topline', 'words'];

const ENERGY_MOOD: Record<SceneAudioContext['energy'], string> = {
  still: 'still',
  gentle: 'gentle',
  active: 'lively',
  intense: 'intense',
};

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word match that still catches compounds like `cello-forward`. */
function mentions(text: string, term: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeForRegExp(term)}(?![a-z0-9])`, 'i').test(text);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

/** Drops terms fully contained in a longer sibling, so `double bass` beats `bass`. */
function dropSubsumed(terms: string[]): string[] {
  return terms.filter((term) => !terms.some((other) => other !== term && mentions(other, term)));
}

function matchAll(text: string, vocabulary: readonly string[]): string[] {
  return vocabulary.filter((term) => mentions(text, term));
}

function matchFirst(text: string, vocabulary: readonly string[]): string | undefined {
  return vocabulary.find((term) => mentions(text, term));
}

function nonEmpty(values: string[] | undefined): string[] | undefined {
  return values && values.length > 0 ? values : undefined;
}

function requestMode(text: string): MusicMode | undefined {
  if (mentions(text, 'soundscape')) return 'soundscape';
  if (VOCAL_WORDS.some((word) => word !== 'vocal' && word !== 'vocals' && mentions(text, word))) return 'song';
  if (mentions(text, 'song')) return 'song';
  if (mentions(text, 'ambient')) return 'ambient_score';
  if (mentions(text, 'score') || mentions(text, 'instrumental')) return 'instrumental_score';
  return undefined;
}

/**
 * Only consulted when the UI vocal control is 'auto' — the one case where we are
 * allowed to guess vocal intent from what the user typed.
 */
function requestVocals(text: string): VocalRequirement | undefined {
  if (/\b(?:no|without)\s+(?:vocals?|singing|lyrics|voices?|words)\b/i.test(text)) return 'none';
  if (mentions(text, 'instrumental')) return 'none';
  if (VOCAL_WORDS.some((word) => mentions(text, word))) return 'required';
  return undefined;
}

function requestAvoid(text: string): string[] {
  const avoided: string[] = [];
  for (const match of text.matchAll(/\b(?:no|without|avoid)\s+([a-z][a-z0-9 -]*)/gi)) {
    const phrase = match[1]?.trim().replace(/\s+(?:and|or)$/i, '').trim();
    // Vocal intent is carried by `brief.vocals`, not by the avoid list.
    if (phrase && !VOCAL_WORDS.some((word) => mentions(phrase, word))) avoided.push(`no ${phrase}`);
  }
  return dedupe(avoided);
}

interface RequestDirection {
  mode?: MusicMode;
  vocals?: VocalRequirement;
  mood?: string[];
  tempo?: string;
  rhythm?: string;
  instrumentation?: string[];
  avoid?: string[];
  density?: string;
}

function parseUserRequest(userRequest: string | undefined): RequestDirection {
  const text = userRequest?.trim();
  if (!text) return {};
  return {
    mode: requestMode(text),
    vocals: requestVocals(text),
    mood: nonEmpty(matchAll(text, MOODS)),
    tempo: TEMPI.find(([term]) => mentions(text, term))?.[1],
    rhythm: matchFirst(text, RHYTHMS),
    instrumentation: nonEmpty(dropSubsumed(matchAll(text, INSTRUMENTS))),
    avoid: nonEmpty(requestAvoid(text)),
    density: matchFirst(text, DENSITIES),
  };
}

/**
 * The scene's contribution to `music.mood`. Emotional qualities, warmth,
 * darkness and energy only — `observedElements` is not read here and never is.
 */
function sceneMood(scene: SceneAudioContext | undefined): string[] | undefined {
  if (!scene) return undefined;
  const mood = [...scene.emotionalQualities];
  if (scene.warmth >= 0.66) mood.push('warm');
  else if (scene.warmth <= 0.33) mood.push('cool');
  if (scene.darkness >= 0.66) mood.push('dark');
  else if (scene.darkness <= 0.33) mood.push('bright');
  mood.push(ENERGY_MOOD[scene.energy]);
  return nonEmpty(dedupe(mood));
}

export function resolveMusicBrief(inputs: ResolveMusicBriefInputs): MusicBrief {
  const request = parseUserRequest(inputs.userRequest);
  const card = inputs.cardDirection;
  const scene = inputs.scene;

  const mode: MusicMode = request.mode ?? card?.mode ?? DEFAULT_MODE;
  const defaults = MODE_DEFAULTS[mode];

  const vocals: VocalRequirement = inputs.vocalControl === 'vocals'
    ? 'required'
    : inputs.vocalControl === 'instrumental'
      ? 'none'
      : request.vocals ?? card?.vocals ?? defaults.vocals;

  const music: MusicDirection = {
    mood: request.mood ?? nonEmpty(card?.music?.mood) ?? sceneMood(scene) ?? [],
    tempo: request.tempo ?? card?.music?.tempo,
    rhythm: request.rhythm ?? card?.music?.rhythm,
    instrumentation: request.instrumentation ?? nonEmpty(card?.music?.instrumentation),
    avoid: request.avoid ?? nonEmpty(card?.music?.avoid),
    density: request.density ?? card?.music?.density,
    prominence: card?.music?.prominence,
    evolution: card?.music?.evolution,
  };

  // The only path from an observed element into a brief.
  const elements = dedupe(nonEmpty(card?.ambience?.elements) ?? scene?.observedElements ?? []);
  const enabled = card?.ambience?.enabled ?? elements.length > 0;
  const ambience: AmbienceDirection = {
    enabled,
    elements,
    prominence: card?.ambience?.prominence ?? (enabled ? defaults.ambienceProminence : 0),
  };

  const playback: PlaybackPlan = {
    mode: card?.playback?.mode ?? defaults.playbackMode,
    targetDurationSeconds: card?.playback?.targetDurationSeconds ?? defaults.targetDurationSeconds,
    crossfadeSeconds: card?.playback?.crossfadeSeconds ?? defaults.crossfadeSeconds,
    loopStart: card?.playback?.loopStart,
    loopEnd: card?.playback?.loopEnd,
  };

  return { mode, vocals, music, ambience, playback };
}
