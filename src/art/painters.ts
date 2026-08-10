import type { Palette } from '../types';
import { hexToRgb, ramp } from '../palette';
import { makeNoise1D } from '../rng';

/**
 * Placeholder art, drawn procedurally.
 *
 * The point of this file is that it is DISPOSABLE. Every painter is a function
 * of (canvas, size, palette, rng, params) that fills a transparent layer — the
 * exact contract a loaded PNG satisfies. When real hand-authored or generated
 * assets exist, a painter is replaced by a texture load and nothing else in the
 * codebase changes.
 *
 * Its purpose right now is to answer Phase 0's question without art: if subtle
 * procedural motion reads as alive on THIS, real art can only improve it.
 */
export type Painter = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  rand: () => number,
  params: Record<string, number>,
) => void;

/** Integer-aligned rect. Keeps pixel painters honest about the grid. */
function px(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// ---------------------------------------------------------------------------
// interior_firelight
// ---------------------------------------------------------------------------

const stone_wall_mossy: Painter = (g, w, h, p, rand) => {
  px(g, 0, 0, w, h, ramp(p, 0.12));
  const bw = 24;
  const bh = 14;
  for (let row = 0; row * bh < h; row++) {
    const offset = row % 2 === 0 ? 0 : -bw / 2;
    for (let col = -1; col * bw + offset < w; col++) {
      const x = col * bw + offset;
      const y = row * bh;
      // Blocks sit in a narrow band of the ramp so the wall reads as one material.
      const tone = 0.2 + rand() * 0.13;
      px(g, x + 1, y + 1, bw - 2, bh - 2, ramp(p, tone));
      // A lit top edge on each block; cheap, and it sells the stone.
      px(g, x + 1, y + 1, bw - 2, 1, ramp(p, tone + 0.08));
      if (rand() < 0.09) {
        const mw = 4 + Math.floor(rand() * 8);
        px(g, x + 2 + rand() * 8, y + bh - 4, mw, 2, ramp(p, 0.3));
      }
    }
  }
};

const earth_floor: Painter = (g, w, h, p, rand) => {
  const top = h * 0.74;
  px(g, 0, top, w, h - top, ramp(p, 0.16));
  px(g, 0, top, w, 2, ramp(p, 0.24));
  for (let i = 0; i < 420; i++) {
    const x = rand() * w;
    const y = top + 3 + rand() * (h - top - 3);
    px(g, x, y, 1 + Math.floor(rand() * 2), 1, ramp(p, 0.1 + rand() * 0.16));
  }
};

const grass_tufts: Painter = (g, w, h, p, rand) => {
  const base = h * 0.76;
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const y = base + rand() * (h * 0.2);
    const blades = 3 + Math.floor(rand() * 3);
    for (let b = 0; b < blades; b++) {
      const bx = x + b * 2 - blades;
      const bh2 = 4 + rand() * 7;
      const lean = (rand() - 0.5) * 3;
      for (let s = 0; s < bh2; s++) {
        px(g, bx + (lean * s) / bh2, y - s, 1, 1, ramp(p, 0.26 + rand() * 0.08));
      }
    }
  }
};

const knight_resting: Painter = (g, w, h, p) => {
  const cx = w * 0.66;
  const ground = h * 0.85;
  const dark = ramp(p, 0.14);
  const armor = ramp(p, 0.42);
  const armorLit = ramp(p, 0.52);
  const cloth = ramp(p, 0.55);

  // Sword laid on the ground, pointing away from the fire.
  px(g, cx + 16, ground + 2, 34, 2, ramp(p, 0.6));
  px(g, cx + 12, ground, 4, 6, ramp(p, 0.72));

  // Legs out, slightly bent.
  px(g, cx - 4, ground - 8, 26, 7, armor);
  px(g, cx + 20, ground - 11, 9, 10, armor);
  px(g, cx + 20, ground - 11, 9, 2, armorLit);

  // Torso, leaning back into the wall.
  px(g, cx - 12, ground - 34, 18, 27, armor);
  px(g, cx - 12, ground - 34, 4, 27, armorLit);
  px(g, cx - 13, ground - 30, 20, 3, cloth);

  // Pauldrons and arm resting on the knee.
  px(g, cx - 15, ground - 33, 7, 6, armorLit);
  px(g, cx + 4, ground - 33, 6, 6, armorLit);
  px(g, cx + 4, ground - 26, 6, 16, armor);

  // Helm, tipped forward. No face — silhouette reads better and dates less.
  px(g, cx - 11, ground - 45, 15, 12, armor);
  px(g, cx - 11, ground - 45, 15, 3, armorLit);
  px(g, cx - 9, ground - 39, 12, 3, dark);
  px(g, cx - 3, ground - 50, 4, 6, ramp(p, 0.62));
};

const campfire_stones: Painter = (g, w, h, p, rand) => {
  const cx = w * 0.28;
  const cy = h * 0.86;
  // Logs first, then the ring in front of them.
  px(g, cx - 12, cy - 5, 24, 4, ramp(p, 0.22));
  px(g, cx - 9, cy - 9, 18, 4, ramp(p, 0.26));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const sx = cx + Math.cos(a) * 20;
    const sy = cy + Math.sin(a) * 8;
    const s = 4 + rand() * 3;
    px(g, sx - s / 2, sy - s / 2, s, s * 0.8, ramp(p, 0.3 + rand() * 0.1));
  }
};

// ---------------------------------------------------------------------------
// exterior_landscape
// ---------------------------------------------------------------------------

const sky_gradient: Painter = (g, w, h, p) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, ramp(p, 0.08));
  grad.addColorStop(0.55, ramp(p, 0.3));
  grad.addColorStop(1, ramp(p, 0.62));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
};

const star_field: Painter = (g, w, h, p, rand) => {
  for (let i = 0; i < 140; i++) {
    const x = rand() * w;
    const y = rand() * h * 0.5;
    const r = rand() * 1.4 + 0.4;
    g.globalAlpha = 0.25 + rand() * 0.6;
    g.fillStyle = ramp(p, 0.9);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
};

const cloud_band: Painter = (g, w, h, p, rand) => {
  // Drawn twice with a width offset so the tiling seam is soft rather than hard.
  const blob = (x: number, y: number, rx: number, ry: number, a: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, rx);
    grad.addColorStop(0, ramp(p, 0.72));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = a;
    g.fillStyle = grad;
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.translate(-x, -y);
    g.beginPath();
    g.arc(x, y, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  for (let i = 0; i < 16; i++) {
    const x = rand() * w;
    const y = h * (0.18 + rand() * 0.3);
    const rx = 40 + rand() * 90;
    const a = 0.16 + rand() * 0.24;
    blob(x, y, rx, rx * 0.34, a);
    blob(x - w, y, rx, rx * 0.34, a);
    blob(x + w, y, rx, rx * 0.34, a);
  }
  g.globalAlpha = 1;
};

const ridge: Painter = (g, w, h, p, rand, params) => {
  const baseline = h * (params.baseline ?? 0.6);
  const amp = h * (params.amp ?? 0.1);
  const tone = params.tone ?? 0.2;
  const noise = makeNoise1D(rand);
  const scale = params.scale ?? 0.012;

  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x++) {
    const y = baseline + noise(x * scale) * amp + noise(x * scale * 3.7) * amp * 0.25;
    g.lineTo(x, y);
  }
  g.lineTo(w, h);
  g.closePath();
  g.fillStyle = ramp(p, tone);
  g.fill();
};

const water_band: Painter = (g, w, h, p, rand, params) => {
  const top = h * (params.top ?? 0.78);
  const grad = g.createLinearGradient(0, top, 0, h);
  grad.addColorStop(0, ramp(p, 0.42));
  grad.addColorStop(1, ramp(p, 0.2));
  g.fillStyle = grad;
  g.fillRect(0, top, w, h - top);
  // Specular streaks; the shimmer animator moves these vertically.
  for (let i = 0; i < 70; i++) {
    const y = top + rand() * (h - top);
    const len = 6 + rand() * 46;
    g.globalAlpha = 0.05 + rand() * 0.22;
    g.fillStyle = ramp(p, 0.85);
    g.fillRect(rand() * w, y, len, 1);
  }
  g.globalAlpha = 1;
};

const reeds: Painter = (g, w, h, p, rand, params) => {
  const base = h * (params.base ?? 0.84);
  g.strokeStyle = ramp(p, 0.14);
  g.lineWidth = 1.4;
  for (let i = 0; i < 60; i++) {
    const x = rand() * w;
    const tall = 10 + rand() * 34;
    const lean = (rand() - 0.5) * 10;
    g.beginPath();
    g.moveTo(x, base + rand() * 14);
    g.quadraticCurveTo(x + lean * 0.4, base - tall * 0.6, x + lean, base - tall);
    g.stroke();
  }
};

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

const radial_glow: Painter = (g, w, h, p, _rand, params) => {
  const cx = w * (params.cx ?? 0.5);
  const cy = h * (params.cy ?? 0.5);
  const r = Math.max(w, h) * (params.radius ?? 0.4);
  const [cr, cg, cb] = hexToRgb(ramp(p, params.tone ?? 0.78));

  // Quadratic alpha falloff across many stops. Light has no edge, and a linear
  // two-stop gradient reads as a visible disc even before quantization.
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    grad.addColorStop(t, `rgba(${cr},${cg},${cb},${a.toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
};

const flat_grade: Painter = (g, w, h, p, _rand, params) => {
  g.fillStyle = ramp(p, params.tone ?? 0.45);
  g.fillRect(0, 0, w, h);
};

const flat_base: Painter = (g, w, h, p, _rand, params) => {
  g.fillStyle = ramp(p, params.tone ?? 0.05);
  g.fillRect(0, 0, w, h);
};

export const PAINTERS: Record<string, Painter> = {
  stone_wall_mossy,
  earth_floor,
  grass_tufts,
  knight_resting,
  campfire_stones,
  sky_gradient,
  star_field,
  cloud_band,
  ridge,
  water_band,
  reeds,
  radial_glow,
  flat_grade,
  flat_base,
};
