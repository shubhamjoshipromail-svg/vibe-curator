/**
 * Audio brief vocabulary shared by scene analysis, prompt rendering and
 * mastering. Types only: this module has no imports and no runtime value, so it
 * is safe to pull into the browser bundle and into `server/` alike.
 */

/** What the visual analyser observed about a scene, before any musical decision. */
export interface SceneAudioContext {
  /** Where the scene appears to take place, e.g. `['forest', 'night']`. */
  environment: string[];
  /**
   * Concrete things visible in the frame, e.g. `['fire', 'rain']`. These are
   * ambience sources only and must never influence genre or instrumentation.
   */
  observedElements: string[];
  /** How the scene feels, e.g. `['tender', 'lonely']`. */
  emotionalQualities: string[];
  apparentEra?: string;
  energy: 'still' | 'gentle' | 'active' | 'intense';
  visualRhythm: 'fluid' | 'steady' | 'fragmented' | 'pulsing';
  scale: 'intimate' | 'room' | 'landscape' | 'cosmic';
  /** 0 = cold, 1 = warm. */
  warmth: number;
  /** 0 = bright, 1 = dark. */
  darkness: number;
}

export type MusicMode = 'soundscape' | 'ambient_score' | 'instrumental_score' | 'song';

export type VocalRequirement = 'none' | 'optional' | 'required';

/** The musical half of a brief. Every field beyond `mood` is optional so the
 *  renderer can stay silent about anything nobody asked for. */
export interface MusicDirection {
  mood: string[];
  tempo?: string;
  rhythm?: string;
  instrumentation?: string[];
  avoid?: string[];
  density?: string;
  /** 0..1 mix level for the musical layer. A mixing parameter, not a prompt clause. */
  prominence?: number;
  evolution?: string;
}

/** The non-musical half of a brief: the scene's own sounds. */
export interface AmbienceDirection {
  enabled: boolean;
  elements: string[];
  /** 0..1 mix level for the ambience layer. */
  prominence: number;
}

export interface PlaybackPlan {
  mode: 'once' | 'loop' | 'crossfade';
  targetDurationSeconds: number;
  crossfadeSeconds: number;
  loopStart?: number;
  loopEnd?: number;
}

export interface MusicBrief {
  mode: MusicMode;
  vocals: VocalRequirement;
  music: MusicDirection;
  ambience: AmbienceDirection;
  playback: PlaybackPlan;
}

/**
 * A partial brief supplied by a card. Nested members are partial too, so a card
 * can direct one field (say, tempo) without having to restate a whole brief.
 */
export interface MusicBriefDirection {
  mode?: MusicMode;
  vocals?: VocalRequirement;
  music?: Partial<MusicDirection>;
  ambience?: Partial<AmbienceDirection>;
  playback?: Partial<PlaybackPlan>;
}

/**
 * What the mastering stage measured and what it did about it. Mastering owns
 * fades, trailing silence, seamless repetition and loudness, so none of that
 * appears in a `MusicBrief` or in a provider prompt.
 */
export interface MasterReport {
  ok: boolean;
  /** Why `ok` is false. */
  reason?: string;
  /** True when the track was usable but shorter than the plan asked for. */
  degraded?: boolean;

  /** Measurements taken from the delivered audio. */
  measuredDurationSeconds?: number;
  measuredLufs?: number;
  peakDb?: number;
  truePeakDb?: number;
  noiseFloorDb?: number;
  leadingSilenceSeconds?: number;
  trailingSilenceSeconds?: number;

  /** Parameters applied in response to those measurements. */
  targetLufs?: number;
  gainDb?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  /** Length after trimming, before any crossfade fold. */
  contentDurationSeconds?: number;
  crossfadeSeconds?: number;
  /** Level difference in dB across the loop point after the crossfade. */
  seamDeltaDb?: number;
  loopStart?: number;
  loopEnd?: number;

  /** Measurements taken from the delivered master. */
  outputDurationSeconds?: number;
  outputLufs?: number;
  outputTruePeakDb?: number;

  /** Anything a human should read. */
  notes?: string[];
}
