import type { TilingSprite } from 'pixi.js';
import type { Animator, AnimatorName, FrameCtx, LayerRuntime } from '../types';
import { hexToNum, ramp } from '../palette';
import { makeNoise1D } from '../rng';

/**
 * The animator library.
 *
 * This is the durable asset of the whole project: written once, reused across
 * every scene forever. Roughly ten of these cover the great majority of ambient
 * scenes, which is precisely why the archetype-rig approach is tractable.
 *
 * Every animator reads `ctx.energy` — the session arc. That single multiplier is
 * what makes the scene a room that settles over an evening rather than a loop
 * that is identical at minute 40.
 */

function phase(l: LayerRuntime, ctx: FrameCtx): number {
  if (l.state.phase === undefined) l.state.phase = ctx.rand() * Math.PI * 2;
  return l.state.phase as number;
}

const none: Animator = { update() {} };

/** Foliage, banners, anything rooted at its base. Skews about its own base. */
const sway: Animator = {
  init(l) {
    if (!l.sprite) return;
    // An anchored asset already has its origin at its base (anchor [0.5, 1]),
    // so it skews correctly with no pivot surgery. Only full-bleed painter
    // layers need their pivot moved to the bottom edge — doing it to a placed
    // sprite would fling it off screen.
    if (l.placed) return;
    l.sprite.pivot.set(0, l.sprite.height);
    l.sprite.y = l.sprite.height;
  },
  update(l, ctx) {
    if (!l.sprite) return;
    const ph = phase(l, ctx);
    // Two incommensurate frequencies so it never reads as a metronome.
    const a = Math.sin(ctx.t * 0.45 + ph) * 0.6 + Math.sin(ctx.t * 0.17 + ph * 2) * 0.4;
    l.sprite.skew.x = a * 0.035 * (0.35 + 0.65 * ctx.energy);
  },
};

/** A single pixel of vertical travel. Below the threshold of notice, above the threshold of dead. */
const breathe: Animator = {
  init(l) {
    if (l.sprite) l.state.baseY = l.sprite.y;
  },
  update(l, ctx) {
    if (!l.sprite) return;
    const ph = phase(l, ctx);
    // Breathing slows as the session settles — the subject relaxes with you.
    const rate = 0.5 * (0.7 + 0.3 * ctx.energy);
    l.sprite.y = (l.state.baseY as number) + Math.sin(ctx.t * rate + ph) * 0.9;
  },
};

/**
 * Generative fire. Drawn as noise-driven columns rather than a sprite sequence,
 * so it never loops and it costs nothing to author.
 *
 * Publishes `shared.fire` so light pools and embers stay locked to the flame
 * without any of them knowing about each other.
 */
const fire: Animator = {
  draws: true,
  init(l, ctx) {
    l.state.noise = makeNoise1D(ctx.rand);
  },
  update(l, ctx) {
    const g = l.gfx;
    if (!g) return;
    const noise = l.state.noise as (x: number) => number;
    const p = ctx.palette;

    // Registration between a DRAWN animator and a PLACED asset.
    //
    // When the slot is filled by a sprite, derive the flame from that sprite's
    // actual bounds rather than from authored coordinates. Drop in any campfire
    // asset, at any size, and the flame sits on its logs automatically. Hand
    // coordinates would need re-tuning for every new asset — which is exactly
    // the failure mode once assets are generated per-slot.
    let cx: number;
    let cy: number;
    const s = l.sprite;
    if (l.placed && s) {
      cx = s.x;
      cy = s.y - s.height * (l.spec.params?.flame_base ?? 0.5);
    } else {
      cx = ctx.width * (l.spec.params?.cx ?? 0.28);
      cy = ctx.height * (l.spec.params?.cy ?? 0.86);
    }

    // NOT `scale` — that now means the asset's placement scale. Overloading the
    // two silently shrank the flame to a tenth of its size.
    const scale = (l.spec.params?.flame_scale ?? 1) * (0.55 + 0.45 * ctx.energy);

    // Global flicker: a slow breath plus a fast tremor.
    const flicker =
      0.82 + noise(ctx.t * 1.6) * 0.14 + noise(ctx.t * 7.3 + 40) * 0.06;
    ctx.shared.fire = flicker * scale;
    // Publish the resolved origin too, so embers rise from wherever the flame
    // actually ended up without the particles slot knowing anything about it.
    ctx.shared.fire_x = cx;
    ctx.shared.fire_y = cy;

    g.clear();

    const bands = [
      { wf: 1.0, hf: 1.0, tone: 0.5, alpha: 0.85 },
      { wf: 0.62, hf: 0.72, tone: 0.68, alpha: 0.95 },
      { wf: 0.32, hf: 0.44, tone: 0.92, alpha: 1.0 },
    ];

    for (const band of bands) {
      const halfW = 15 * band.wf * scale;
      const maxH = 34 * band.hf * scale * flicker;
      const cols = Math.max(3, Math.round(halfW * 2));
      const col = hexToNum(ramp(p, band.tone));

      for (let i = 0; i < cols; i++) {
        const fx = i / (cols - 1);
        const x = cx - halfW + fx * halfW * 2;
        // Taper toward the edges, then perturb with travelling noise so the
        // flame licks upward instead of pulsing uniformly.
        const taper = Math.cos((fx - 0.5) * Math.PI);
        const lick = 0.72 + noise(ctx.t * 3.1 + fx * 5) * 0.28 + noise(ctx.t * 9 + fx * 11) * 0.12;
        const hgt = Math.max(1, maxH * taper * lick);
        g.rect(Math.round(x), Math.round(cy - hgt), 1, Math.round(hgt));
      }
      g.fill({ color: col, alpha: band.alpha });
    }
  },
};

/** Embers rising off the light source. Density falls as the fire burns down. */
const embers: Animator = {
  draws: true,
  init(l) {
    l.state.parts = [];
    l.state.acc = 0;
  },
  update(l, ctx) {
    const g = l.gfx;
    if (!g) return;
    const parts = l.state.parts as Array<{
      x: number; y: number; vy: number; ph: number; life: number; max: number; tone: number;
    }>;

    // Prefer the light source's published origin; fall back to authored coords
    // when this archetype has no fire animator running.
    const cx = ctx.shared.fire_x ?? ctx.width * (l.spec.params?.cx ?? 0.28);
    const cy = ctx.shared.fire_y ?? ctx.height * (l.spec.params?.cy ?? 0.86);
    const rate = (l.spec.params?.rate ?? 14) * ctx.energy * (ctx.shared.fire ?? 1);

    l.state.acc = (l.state.acc as number) + rate * ctx.dt;
    while ((l.state.acc as number) >= 1) {
      l.state.acc = (l.state.acc as number) - 1;
      const max = 1.6 + ctx.rand() * 2.4;
      parts.push({
        x: cx + (ctx.rand() - 0.5) * 22,
        y: cy - 4 - ctx.rand() * 8,
        vy: 9 + ctx.rand() * 16,
        ph: ctx.rand() * Math.PI * 2,
        life: 0,
        max,
        tone: 0.62 + ctx.rand() * 0.3,
      });
    }

    g.clear();
    for (let i = parts.length - 1; i >= 0; i--) {
      const e = parts[i];
      e.life += ctx.dt;
      if (e.life > e.max) {
        parts.splice(i, 1);
        continue;
      }
      e.y -= e.vy * ctx.dt;
      // Embers decelerate and wander as they cool.
      e.vy *= 1 - 0.55 * ctx.dt;
      const drift = Math.sin(ctx.t * 1.9 + e.ph) * 6;
      const k = e.life / e.max;
      const alpha = (1 - k) * (0.35 + 0.65 * Math.abs(Math.sin(ctx.t * 9 + e.ph)));
      g.rect(Math.round(e.x + drift), Math.round(e.y), 1, 1);
      g.fill({ color: hexToNum(ramp(ctx.palette, e.tone)), alpha });
    }
  },
};

/** Light pools and blooms. Locks to `shared.fire` when a light source published one. */
const radial_pulse: Animator = {
  update(l, ctx) {
    if (!l.sprite) return;
    const ph = phase(l, ctx);
    const linked = ctx.shared.fire;
    const drive =
      linked !== undefined
        ? linked
        : 0.85 + Math.sin(ctx.t * 0.35 + ph) * 0.15;
    l.sprite.alpha = l.baseAlpha * drive * (0.5 + 0.5 * ctx.energy);
    const s = 0.94 + drive * 0.09;
    l.sprite.scale.set(s);
  },
};

/** Horizontal scroll for tiling layers — clouds, mist, distant weather. */
const scroll: Animator = {
  update(l, ctx) {
    const s = l.sprite as TilingSprite | undefined;
    if (!s || !('tilePosition' in s)) return;
    const speed = l.spec.params?.speed ?? 4;
    s.tilePosition.x -= speed * ctx.dt;
  },
};

/** Free-floating motes. Wraps rather than respawning, so density stays constant. */
const drift: Animator = {
  draws: true,
  init(l, ctx) {
    const n = Math.round(l.spec.params?.count ?? 70);
    l.state.parts = Array.from({ length: n }, () => ({
      x: ctx.rand() * ctx.width,
      y: ctx.rand() * ctx.height,
      r: 0.6 + ctx.rand() * 1.8,
      sp: 2 + ctx.rand() * 7,
      ph: ctx.rand() * Math.PI * 2,
      tone: 0.55 + ctx.rand() * 0.4,
    }));
  },
  update(l, ctx) {
    const g = l.gfx;
    if (!g) return;
    const parts = l.state.parts as Array<{
      x: number; y: number; r: number; sp: number; ph: number; tone: number;
    }>;
    g.clear();
    for (const p of parts) {
      p.y -= p.sp * ctx.dt * (0.4 + 0.6 * ctx.energy);
      p.x += Math.sin(ctx.t * 0.3 + p.ph) * 4 * ctx.dt;
      if (p.y < -4) {
        p.y = ctx.height + 4;
        p.x = ctx.rand() * ctx.width;
      }
      const alpha = 0.25 + 0.45 * Math.abs(Math.sin(ctx.t * 0.7 + p.ph));
      g.circle(p.x, p.y, p.r);
      g.fill({ color: hexToNum(ramp(ctx.palette, p.tone)), alpha });
    }
  },
};

/** Stars. Two out-of-phase sines so the field never blinks in unison. */
const twinkle: Animator = {
  update(l, ctx) {
    if (!l.sprite) return;
    const ph = phase(l, ctx);
    const a = 0.72 + Math.sin(ctx.t * 0.9 + ph) * 0.16 + Math.sin(ctx.t * 2.3 + ph * 3) * 0.08;
    l.sprite.alpha = l.baseAlpha * a;
  },
};

/** Water. Sub-pixel vertical travel reads as surface movement without warping. */
const shimmer: Animator = {
  init(l) {
    if (l.sprite) l.state.baseY = l.sprite.y;
  },
  update(l, ctx) {
    if (!l.sprite) return;
    const ph = phase(l, ctx);
    l.sprite.y = (l.state.baseY as number) + Math.sin(ctx.t * 0.8 + ph) * 0.7;
    l.sprite.alpha = l.baseAlpha * (0.9 + Math.sin(ctx.t * 1.3 + ph) * 0.1);
  },
};

/** Slow lava-lamp field for abstract scenes. Three blobs, incommensurate orbits. */
const flow: Animator = {
  draws: true,
  init(l, ctx) {
    l.state.blobs = Array.from({ length: 4 }, (_, i) => ({
      ph: ctx.rand() * Math.PI * 2,
      sx: 0.06 + ctx.rand() * 0.07,
      sy: 0.04 + ctx.rand() * 0.05,
      r: 0.24 + ctx.rand() * 0.2,
      tone: 0.35 + i * 0.16,
    }));
  },
  update(l, ctx) {
    const g = l.gfx;
    if (!g) return;
    const blobs = l.state.blobs as Array<{
      ph: number; sx: number; sy: number; r: number; tone: number;
    }>;
    g.clear();
    for (const b of blobs) {
      const x = ctx.width * (0.5 + Math.sin(ctx.t * b.sx + b.ph) * 0.34);
      const y = ctx.height * (0.5 + Math.cos(ctx.t * b.sy + b.ph * 1.7) * 0.3);
      const r = Math.min(ctx.width, ctx.height) * b.r * (0.8 + 0.2 * ctx.energy);
      g.circle(x, y, r);
      g.fill({ color: hexToNum(ramp(ctx.palette, b.tone)), alpha: 0.16 });
    }
  },
};

export const ANIMATORS: Record<AnimatorName, Animator> = {
  none,
  sway,
  breathe,
  fire,
  embers,
  radial_pulse,
  scroll,
  drift,
  twinkle,
  shimmer,
  flow,
};
