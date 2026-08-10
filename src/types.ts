/**
 * The vibe spec is the spine of the product. Everything downstream — renderer,
 * audio engine, and later the theme exporter — reads from this and nothing else.
 *
 * Two rules keep cross-modal coherence real rather than aspirational:
 *   1. `palette.ramp` is authoritative. Every visual layer is quantized to it,
 *      which is why independently-produced layers still look like one scene.
 *   2. Nothing downstream may invent style. It selects and configures only.
 */

import type { ArcShape } from './arc';

export type AnimatorName =
  | 'none'
  | 'sway'
  | 'breathe'
  | 'fire'
  | 'embers'
  | 'radial_pulse'
  /** Free-floating particle drift (draws its own particles). */
  | 'drift'
  /** Horizontal scroll of a tiling layer. */
  | 'scroll'
  | 'twinkle'
  | 'shimmer'
  | 'flow';

export type BlendName = 'normal' | 'add' | 'multiply' | 'screen';

export interface Palette {
  base: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
  /** Authoritative colour ramp, dark -> light. All layers quantize to this. */
  ramp: string[];
}

/** One filled slot in an archetype rig. */
export interface LayerSpec {
  slot: string;
  /** Name of a painter today; a generated/authored asset URL later. */
  asset: string;
  /** Prompt kept alongside the asset so Phase 4 can regenerate just this slot. */
  prompt?: string;
  alpha?: number;
  /**
   * Placement and tuning. `cx`/`cy` position an anchored sprite in normalized
   * scene coords; `scale` is its height as a fraction of scene height. These
   * are content-level on purpose — see SlotDef.anchor for why.
   */
  params?: Record<string, number>;
}

export interface AudioSpec {
  /** Root note of the sustained bed, e.g. "D2". */
  root: string;
  scale: 'aeolian' | 'dorian' | 'major_pentatonic' | 'lydian';
  /** Named synthesized textures. No sample licensing at this stage. */
  textures: Array<'fire_crackle' | 'room_air' | 'wind' | 'rain' | 'water'>;
  motif: {
    instrument: 'pluck' | 'bell' | 'none';
    density_per_min: number;
    gain_db: number;
  };
  lowpass_hz: number;
  reverb: { size: number; wet: number };
  bed_gain_db: number;
  /**
   * Optional audio pack URL. Any texture or instrument the pack provides is
   * played from samples; everything else falls back to synthesis. Same
   * partial-override property as the art packs.
   */
  pack?: string;
}

/**
 * The session arc. This is the thing that makes it a room rather than a
 * wallpaper: the scene is not the same at minute 40 as at minute 0.
 *
 * `energy` drives motion amplitude, particle density and motif frequency.
 * `warmth` drives the ambient grade toward or away from the primary hue.
 */
export interface ArcSpec {
  /** Nominal session length in minutes; the arc is normalized against it. */
  minutes: number;
  /**
   * Trajectory between the start and end values. `settle` is the default and
   * the good one; see src/arc.ts for why monotonic decay was the wrong model.
   */
  shape: ArcShape;
  energy_start: number;
  energy_end: number;
  warmth_start: number;
  warmth_end: number;
}

export interface VibeSpec {
  id: string;
  label: string;
  user_prompt: string;
  /**
   * Style is per-vibe, deliberately NOT a global build decision. `pixel_art`
   * renders into a small internal buffer with nearest-neighbour upscaling;
   * `smooth` renders at full resolution with linear filtering.
   */
  render_style: 'pixel_art' | 'smooth';
  /** Internal render resolution. The pixel grid falls out of this for free. */
  internal: [number, number];
  archetype: string;
  seed: number;
  /**
   * Optional asset pack URL. When present, any layer whose `asset` name matches
   * a pack entry renders from the image; everything else falls back to its
   * procedural painter. Partial packs are therefore fully supported, which is
   * what makes per-slot replacement (and later, per-slot reroll) work.
   */
  pack?: string;
  palette: Palette;
  layers: LayerSpec[];
  audio: AudioSpec;
  arc: ArcSpec;
}

/** Per-frame state handed to every animator. */
export interface FrameCtx {
  /**
   * Cross-layer bus. Lets a slot react to another slot without knowing what
   * filled it — e.g. `light_pool` pulses off whatever the `light_source`
   * animator publishes as `fire`. This is what keeps the rig composable.
   */
  shared: Record<string, number>;
  /** Seconds since the session began. */
  t: number;
  /** Seconds since last frame, clamped. */
  dt: number;
  /** 0..1 session progress against `arc.minutes`. */
  progress: number;
  /** Current arc energy: motion amplitude and density multiplier. */
  energy: number;
  /** Current arc warmth. */
  warmth: number;
  width: number;
  height: number;
  palette: Palette;
  rand: () => number;
}

// --- runtime -----------------------------------------------------------------

import type { Container, Sprite, TilingSprite, Graphics } from 'pixi.js';
import type { SlotDef } from './archetypes';

export interface LayerRuntime {
  slot: string;
  spec: LayerSpec;
  def: SlotDef;
  view: Container;
  /** Present when the slot has a baked painter (or, later, a loaded asset). */
  sprite?: Sprite | TilingSprite;
  /** Present when the animator draws generatively each frame. */
  gfx?: Graphics;
  state: Record<string, any>;
  baseAlpha: number;
  /** True when the sprite is an anchored asset rather than a full-bleed layer. */
  placed?: boolean;
}

export interface Animator {
  /** Generative animators get a Graphics and redraw every frame. */
  draws?: boolean;
  init?(l: LayerRuntime, ctx: FrameCtx): void;
  update(l: LayerRuntime, ctx: FrameCtx): void;
}
