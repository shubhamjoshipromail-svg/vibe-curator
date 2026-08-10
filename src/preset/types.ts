import type { Palette } from '../types';
import type { EffectManifest } from '../effects/manifest';

/**
 * A Preset is the composed document the whole product revolves around:
 * what you browse in Explore, what you edit in Labs, what plays in the Player,
 * and what Save writes back to the Library.
 *
 * It is layered on purpose. Each layer can be swapped, muted, or regenerated
 * without disturbing the others — that is what makes remixing feel like
 * editing rather than starting over.
 */

/**
 * The only controls a user ever sees.
 *
 * Every one is 0..1 and named for a FEELING, not a mechanism. Internally these
 * fan out to filter cutoffs, alpha values, particle rates and animator
 * amplitudes — but "lowpass 4200Hz" is not a thing anyone wants to think about
 * while choosing a place to work.
 */
export interface Controls {
  /** Cool and distant ↔ warm and close. Drives colour temperature. */
  mood: number;
  /** Still ↔ alive. Scales every animator's amplitude. */
  motion: number;
  /** Flat ↔ deep. Drives blur, vignette and layer separation. */
  depth: number;
  /** How strongly light blooms and pools. */
  glow: number;
  /** Clear ↔ hazy. Drives the colour grade and how muffled the sound is. */
  atmosphere: number;
  /** How assertive generated effects are. Fed to every effect as uIntensity. */
  intensity: number;
}

export const DEFAULT_CONTROLS: Controls = {
  mood: 0.6,
  motion: 0.55,
  depth: 0.5,
  glow: 0.55,
  atmosphere: 0.45,
  intensity: 0.6,
};

/** Metadata for one control, used to build the Labs UI generically. */
export interface ControlDef {
  key: keyof Controls;
  label: string;
  /** Shown under the slider. Describes the two ends, not the number. */
  low: string;
  high: string;
}

export const CONTROL_DEFS: ControlDef[] = [
  { key: 'mood', label: 'Mood', low: 'cool', high: 'warm' },
  { key: 'motion', label: 'Motion', low: 'still', high: 'alive' },
  { key: 'depth', label: 'Depth', low: 'flat', high: 'deep' },
  { key: 'glow', label: 'Glow', low: 'dim', high: 'radiant' },
  { key: 'atmosphere', label: 'Atmosphere', low: 'clear', high: 'hazy' },
  { key: 'intensity', label: 'Intensity', low: 'subtle', high: 'bold' },
];

/** Independent audio layers. Each mixes under the master, and each can be silenced alone. */
export interface AudioLayers {
  /** Room tone, fire, wind, water — the sound of the place. */
  ambience: { gain: number; muted: boolean };
  /** The bed and melodic motifs — the sound of the mood. */
  music: { gain: number; muted: boolean };
  master: { gain: number; muted: boolean };
}

export const DEFAULT_AUDIO: AudioLayers = {
  ambience: { gain: 0.8, muted: false },
  music: { gain: 0.65, muted: false },
  master: { gain: 0.8, muted: false },
};

export interface Preset {
  id: string;
  name: string;
  description: string;
  /** Ships with the app; cannot be overwritten, only remixed into a copy. */
  builtIn: boolean;
  createdAt: string;
  /** Set when this was remixed from another preset. Gives Library a lineage. */
  parentId?: string;

  // --- layers ---
  /** Background visual: which scene rig and asset set to build. */
  baseVibeId: string;
  /** Overrides the base vibe's palette. Recolouring alone makes one scene into many. */
  palette: Palette;
  /** Generated shader effects, in order. */
  effects: EffectManifest[];
  /** Ambience + music levels. */
  audio: AudioLayers;
  /** Optional accent used by the app chrome when this preset is playing. */
  theme?: { accent: string };

  controls: Controls;
}

export function cloneControls(c: Controls): Controls {
  return { ...c };
}

export function newId(prefix = 'p'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
