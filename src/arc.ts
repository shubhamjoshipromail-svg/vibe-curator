import type { ArcSpec } from './types';

/**
 * The session arc.
 *
 * The first version lerped linearly from `energy_start` to `energy_end`, and it
 * read exactly as it was written: the fire just dies. Monotonic decay is not
 * what being in a room feels like. A room settles, then holds, and the holding
 * is where you actually do your work.
 *
 * So the arc has a SHAPE, and the shape is the differentiator. `energy_start`
 * and `energy_end` now describe the envelope's bounds; the shape describes the
 * trajectory between them, and therefore the direction is set by the vibe
 * rather than baked into the curve.
 */
export type ArcShape = 'settle' | 'steady' | 'build' | 'none';

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * Returns 0..1, where 0 means "at the start value" and 1 means "at the end
 * value". Never clamped to monotonic — that is the entire point.
 */
function curve(shape: ArcShape, p: number): number {
  switch (shape) {
    case 'none':
      return 0;

    // Sits in the middle of the envelope and breathes. For rooms meant to be
    // ambient company rather than a bounded work session.
    case 'steady':
      return 0.5 + Math.sin(p * Math.PI * 4) * 0.06;

    // Reverse pacing: holds near the start, then commits late. For rooms that
    // are supposed to wake up rather than wind down.
    case 'build': {
      const e = p * p * (3 - 2 * p);
      return e * e;
    }

    case 'settle':
    default: {
      // Four movements, and the third is the one that matters.
      const PLATEAU = 0.55;
      const REVIVAL = 0.36;

      // 1. Settle in. The room comes down off its opening state quickly —
      //    this is the first 2 minutes of a 25 minute session.
      if (p < 0.08) return PLATEAU * smoothstep(p / 0.08);

      // 2. The plateau. Most of the session lives here. It undulates very
      //    slowly rather than sitting flat, because a constant is as dead as
      //    a decay is depressing.
      if (p < 0.7) {
        const u = (p - 0.08) / 0.62;
        return PLATEAU + Math.sin(u * Math.PI * 2.5) * 0.05;
      }

      // 3. The revival. Someone puts another log on. This is what stops the
      //    arc reading as "the fire is dying" — it recovers before it ends,
      //    so the ending is a choice rather than an inevitability.
      if (p < 0.78) {
        return PLATEAU + (REVIVAL - PLATEAU) * smoothstep((p - 0.7) / 0.08);
      }

      // 4. The real wind-down, and only now.
      return REVIVAL + (1 - REVIVAL) * smoothstep((p - 0.78) / 0.22);
    }
  }
}

export interface ArcState {
  energy: number;
  warmth: number;
}

export function arcAt(arc: ArcSpec, progress: number): ArcState {
  const k = curve(arc.shape, Math.max(0, Math.min(1, progress)));
  return {
    energy: arc.energy_start + (arc.energy_end - arc.energy_start) * k,
    // Warmth trails energy slightly: colour cools a beat after motion calms,
    // which is how light actually behaves in a room.
    warmth: arc.warmth_start + (arc.warmth_end - arc.warmth_start) * Math.pow(k, 1.3),
  };
}

/** Sampled for the UI's arc preview, so the shape is legible before you commit 25 minutes. */
export function sampleArc(arc: ArcSpec, steps = 96): number[] {
  return Array.from({ length: steps }, (_, i) => arcAt(arc, i / (steps - 1)).energy);
}
