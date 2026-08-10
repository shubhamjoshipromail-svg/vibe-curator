import type { Palette } from './types';

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Sample the ramp at 0..1. The main way painters stay on-palette by default. */
export function ramp(p: Palette, tNorm: number): string {
  const i = Math.round(Math.max(0, Math.min(1, tNorm)) * (p.ramp.length - 1));
  return p.ramp[i];
}

/**
 * Quantize an image to `palette.ramp`.
 *
 * This is the ~20 lines that make cross-modal coherence structural instead of
 * hopeful: layers produced by completely separate processes — hand-drawn today,
 * six different generation calls later — come out looking like one scene
 * because they all land on the same ramp. Run it on every layer, always.
 */
export function quantizeToRamp(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  palette: Palette,
): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const ramps = palette.ramp.map(hexToRgb);

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < ramps.length; c++) {
      const dr = d[i] - ramps[c][0];
      const dg = d[i + 1] - ramps[c][1];
      const db = d[i + 2] - ramps[c][2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    d[i] = ramps[best][0];
    d[i + 1] = ramps[best][1];
    d[i + 2] = ramps[best][2];
  }
  ctx.putImageData(img, 0, 0);
}
