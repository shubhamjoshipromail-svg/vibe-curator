import type { Preset } from './types';
import { VIBES } from '../vibes';
import { ARCHETYPES } from '../archetypes';
import { PAINTERS } from '../art/painters';
import { mulberry32 } from '../rng';
import { assetUrl } from '../media/assets';
import { SourceAwareSurface } from '../source-aware/processor';

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

  if (preset.scene.kind === 'procedural') {
    const surface = new SourceAwareSurface({
      width: w,
      height: h,
      demoSourceId: preset.scene.sourceId,
      recipes: preset.sourceEffects,
    });
    surface.update(2.1, 1 / 30);
    surface.update(2.32, 0.22);
    g.drawImage(surface.canvas, 0, 0);
    return canvas;
  }

  if (preset.scene.kind !== 'renderer') {
    const wash = g.createLinearGradient(0, 0, w, h);
    wash.addColorStop(0, preset.palette.surface);
    wash.addColorStop(1, preset.palette.base);
    g.fillStyle = wash;
    g.fillRect(0, 0, w, h);

    if (preset.scene.kind === 'image') {
      const source = preset.scene.url
        ? Promise.resolve(preset.scene.url)
        : preset.scene.assetId
          ? assetUrl(preset.scene.assetId)
          : Promise.resolve(undefined);
      void source.then((url) => {
        if (!url) return;
        const image = new Image();
        image.onload = () => {
          const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
          const dw = image.naturalWidth * scale;
          const dh = image.naturalHeight * scale;
          g.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
        };
        image.src = url;
      });
    } else {
      g.fillStyle = preset.palette.accent;
      g.globalAlpha = 0.16;
      g.fillRect(w * 0.08, h * 0.12, w * 0.84, h * 0.76);
      g.globalAlpha = 1;
      g.fillStyle = preset.palette.text;
      g.font = `${Math.round(h * 0.08)}px sans-serif`;
      g.textAlign = 'center';
      g.fillText('LOOPING VIDEO', w / 2, h / 2);
    }
    return canvas;
  }

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
