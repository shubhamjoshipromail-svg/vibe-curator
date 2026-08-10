import type { AnimatorName, BlendName } from './types';

/**
 * An archetype is a fixed set of named layer slots, each with an animator
 * attached. Generation (or a human) fills the slots; the rig handles motion.
 *
 * This is the decision that converts an open-ended "animate an arbitrary scene"
 * problem into a content-filling problem with predictable quality — and it is
 * what makes per-slot reroll possible later. A bad layer degrades one slot
 * instead of ruining the scene.
 */
export interface SlotDef {
  slot: string;
  animator: AnimatorName;
  blend?: BlendName;
  /** Horizontally tiled and scrolled rather than placed once. */
  tiling?: boolean;
  /** Baseline opacity before the arc modulates it. */
  alpha?: number;
  /**
   * Softness in pixels. A property of the rig, not the art: some slots are
   * masses of light rather than objects, and they must never show an edge.
   */
  blur?: number;
  /**
   * How an asset-backed sprite occupies the frame. Rig-level, because it is a
   * fact about the SLOT: a backdrop always covers, a subject is always placed.
   * `cover` and `contain` ignore anchor and position entirely.
   */
  fit?: 'cover' | 'contain' | 'anchor';
  /**
   * Normalized anchor within the trimmed content, e.g. [0.5, 1] for
   * bottom-centre. Rig-level too: a subject stands on its feet in every vibe
   * that fills this slot, regardless of aesthetic.
   *
   * NOTE: scale and position are deliberately NOT here — they live on the layer
   * spec, because two vibes sharing this rig will legitimately put their
   * campfire in different places at different sizes.
   */
  anchor?: [number, number];
  /** Fallback height as a fraction of scene height, when a vibe omits `scale`. */
  defaultScale?: number;
}

export interface Archetype {
  id: string;
  /** Draw order, back to front. */
  slots: SlotDef[];
}

export const ARCHETYPES: Record<string, Archetype> = {
  interior_firelight: {
    id: 'interior_firelight',
    slots: [
      { slot: 'backdrop', animator: 'none' },
      { slot: 'floor', animator: 'none' },
      { slot: 'foliage', animator: 'sway' },
      { slot: 'subject', animator: 'breathe', fit: 'anchor', anchor: [0.5, 1], defaultScale: 0.34 },
      { slot: 'light_source', animator: 'fire', fit: 'anchor', anchor: [0.5, 1], defaultScale: 0.12 },
      { slot: 'light_pool', animator: 'radial_pulse', blend: 'add', alpha: 0.55 },
      { slot: 'particles', animator: 'embers' },
      { slot: 'ambient_grade', animator: 'none', blend: 'multiply', alpha: 0.75 },
    ],
  },

  exterior_landscape: {
    id: 'exterior_landscape',
    slots: [
      { slot: 'sky', animator: 'none' },
      { slot: 'stars', animator: 'twinkle', blend: 'add', alpha: 0.7 },
      { slot: 'clouds', animator: 'scroll', tiling: true, alpha: 0.8 },
      { slot: 'ridge_far', animator: 'none' },
      { slot: 'ridge_near', animator: 'none' },
      { slot: 'water', animator: 'shimmer' },
      { slot: 'foliage', animator: 'sway' },
      { slot: 'ambient_grade', animator: 'none', blend: 'multiply', alpha: 0.7 },
    ],
  },

  abstract_field: {
    id: 'abstract_field',
    slots: [
      { slot: 'backdrop', animator: 'none' },
      { slot: 'field', animator: 'flow', blend: 'screen', alpha: 0.85, blur: 90 },
      { slot: 'particles', animator: 'drift' },
      { slot: 'bloom', animator: 'radial_pulse', blend: 'add', alpha: 0.4 },
      { slot: 'ambient_grade', animator: 'none', blend: 'multiply', alpha: 0.6 },
    ],
  },
};
