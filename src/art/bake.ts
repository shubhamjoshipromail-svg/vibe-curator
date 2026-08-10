import { Texture } from 'pixi.js';
import type { Palette, VibeSpec } from '../types';
import { quantizeToRamp } from '../palette';
import type { Painter } from './painters';

/**
 * Render a painter into a texture once.
 *
 * This is the swap point for real art. Replacing a painter with
 * `await Assets.load(url)` changes nothing else in the codebase, which is the
 * whole reason the placeholder art is safe to throw away later.
 */
export function bake(
  painter: Painter,
  w: number,
  h: number,
  palette: Palette,
  rand: () => number,
  params: Record<string, number>,
  style: VibeSpec['render_style'],
  quantize: boolean,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = style !== 'pixel_art';

  painter(g, w, h, palette, rand, params);

  // Hard quantization is a pixel-art move, and it applies to MATERIAL only.
  //
  // Two exemptions, both learned the hard way by looking at the screen:
  //   - Smooth styles stay on-palette by construction instead (painters only
  //     sample `ramp()`); collapsing a gouache sky to eight colours would
  //     destroy exactly what makes it painterly.
  //   - Light is not material. Quantizing an additive glow turns its falloff
  //     into a hard-edged disc, which is why the caller opts glow layers out.
  if (style === 'pixel_art' && quantize) quantizeToRamp(g, w, h, palette);

  const tex = Texture.from(canvas);
  tex.source.scaleMode = style === 'pixel_art' ? 'nearest' : 'linear';
  return tex;
}
