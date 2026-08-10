import { Texture } from 'pixi.js';
import type { VibeSpec } from '../types';

/**
 * Asset packs — the seam `painters.ts` was always meant to be replaced through.
 *
 * The hard part here is NOT loading images. It is registration: when the fire
 * and the knight arrive from two different sources (two artists, two API calls,
 * two packs), what makes them stand on the same floor? Answer: every asset is
 * trimmed to its alpha bounding box on load, then positioned by a slot anchor.
 * Source padding stops mattering, which is the only way independently-produced
 * sprites can ever align.
 */

export interface LicenseRow {
  source: string;
  license: string;
  url: string;
  commercial_ok: boolean;
  attribution_required?: boolean;
}

export interface PackAsset {
  file: string;
  license: LicenseRow;
}

export interface AssetPack {
  id: string;
  label: string;
  /** Assets keyed by the same name a LayerSpec puts in `asset`. */
  assets: Record<string, PackAsset>;
}

export interface LoadedAsset {
  texture: Texture;
  /** Trimmed content size, in source pixels. Drives placement scale. */
  width: number;
  height: number;
}

const packCache = new Map<string, Promise<AssetPack>>();
const assetCache = new Map<string, Promise<LoadedAsset>>();

export function loadPack(url: string): Promise<AssetPack> {
  let p = packCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`pack ${url}: HTTP ${r.status}`);
      return r.json() as Promise<AssetPack>;
    });
    packCache.set(url, p);
  }
  return p;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image ${src}`));
    img.src = src;
  });
}

/**
 * Crop to the alpha bounding box.
 *
 * Generated sprites in particular arrive with wildly inconsistent padding — the
 * same prompt returns a knight centred in one call and floating high in the
 * next. Trimming first means the anchor refers to the CONTENT, not to whatever
 * whitespace the source happened to include.
 */
export function trimToAlpha(
  img: HTMLImageElement | HTMLCanvasElement,
  threshold = 8,
): HTMLCanvasElement {
  const w = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const h = 'naturalHeight' in img ? img.naturalHeight : img.height;

  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(img as CanvasImageSource, 0, 0);

  const { data } = sg.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Fully transparent asset: nothing to trim, and cropping to zero would throw.
  if (maxX < 0) return src;

  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  out.getContext('2d')!.drawImage(src, minX, minY, tw, th, 0, 0, tw, th);
  return out;
}

export function loadAsset(
  packUrl: string,
  pack: AssetPack,
  key: string,
  style: VibeSpec['render_style'],
): Promise<LoadedAsset> {
  const entry = pack.assets[key];
  const base = packUrl.slice(0, packUrl.lastIndexOf('/') + 1);
  const src = base + entry.file;

  let p = assetCache.get(src);
  if (!p) {
    p = loadImage(src).then((img) => {
      const trimmed = trimToAlpha(img);
      const texture = Texture.from(trimmed);
      texture.source.scaleMode = style === 'pixel_art' ? 'nearest' : 'linear';
      return { texture, width: trimmed.width, height: trimmed.height };
    });
    assetCache.set(src, p);
  }
  return p;
}
