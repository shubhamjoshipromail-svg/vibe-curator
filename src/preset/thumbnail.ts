import type { Preset } from './types';
import { VIBES } from '../vibes';
import { ARCHETYPES } from '../archetypes';
import { PAINTERS } from '../art/painters';
import { mulberry32 } from '../rng';

/**
 * Card previews for Explore.
 *
 * Rendered from the preset's own painters and palette rather than a stored
 * image, so a card always shows what you will actually get — including after a
 * recolour, which is the whole point of the palette being authoritative. Costs
 * a few milliseconds and no storage.
 */

const BLEND: Record<string, GlobalCompositeOperation> = {
  add: 'lighter',
  multiply: 'multiply',
  screen: 'screen',
  normal: 'source-over',
};

export function renderThumbnail(preset: Preset, w = 480, h = 270): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;

  const vibe = VIBES.find((v) => v.id === preset.baseVibeId);
  if (!vibe) {
    g.fillStyle = preset.palette.base;
    g.fillRect(0, 0, w, h);
    return canvas;
  }

  g.fillStyle = preset.palette.base;
  g.fillRect(0, 0, w, h);

  const archetype = ARCHETYPES[vibe.archetype];
  if (!archetype) return canvas;

  // Same seed as the live scene, so the preview matches the real thing.
  const rand = mulberry32(vibe.seed);

  for (const def of archetype.slots) {
    const spec = vibe.layers.find((l) => l.slot === def.slot);
    if (!spec) continue;
    const painter = PAINTERS[spec.asset];
    if (!painter) continue; // generative slots have no static form

    g.save();
    g.globalCompositeOperation = BLEND[def.blend ?? 'normal'] ?? 'source-over';
    g.globalAlpha = spec.alpha ?? def.alpha ?? 1;
    painter(g, w, h, preset.palette, rand, spec.params ?? {});
    g.restore();
  }

  // A hint of the glow control, so two presets that differ only by controls
  // still look different on their cards.
  const glow = preset.controls.glow;
  if (glow > 0.05) {
    const grad = g.createRadialGradient(w * 0.3, h * 0.7, 0, w * 0.3, h * 0.7, w * 0.6);
    grad.addColorStop(0, `rgba(255,255,255,${(glow * 0.18).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

  return canvas;
}
