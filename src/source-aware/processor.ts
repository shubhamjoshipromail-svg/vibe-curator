import { paintDemoSource } from './demo-sources';
import type { DemoSourceId, SourceEffectRecipe, SourceMotion } from './types';

type MediaSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

export interface SourceSurfaceOptions {
  width: number;
  height: number;
  source?: MediaSource;
  demoSourceId?: DemoSourceId;
  motion?: SourceMotion;
  recipes: SourceEffectRecipe[];
}

function drawCover(
  g: CanvasRenderingContext2D,
  source: MediaSource,
  w: number,
  h: number,
  t: number,
  motion?: SourceMotion,
) {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!sw || !sh) return;
  const drift = motion?.kind === 'drift';
  const amount = drift ? (motion.amount ?? 0.035) : 0;
  const speed = motion?.speed ?? 0.1;
  const scale = Math.max(w / sw, h / sh) * (1 + amount * 1.6);
  const dw = sw * scale;
  const dh = sh * scale;
  const ox = drift ? Math.sin(t * speed) * w * amount : 0;
  const oy = drift ? Math.cos(t * speed * 0.73) * h * amount * 0.55 : 0;
  g.drawImage(source, (w - dw) / 2 + ox, (h - dh) / 2 + oy, dw, dh);
}

/**
 * Low-resolution deterministic source analysis feeding a full-resolution
 * Canvas2D treatment surface. It works for demos, uploaded video, and images.
 * Analysis only sees the clean source frame, preventing feedback instability.
 */
export class SourceAwareSurface {
  readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly analysis = document.createElement('canvas');
  private readonly ag: CanvasRenderingContext2D;
  private readonly aw = 128;
  private readonly ah = 72;
  private previous = new Float32Array(this.aw * this.ah);
  private current = new Float32Array(this.aw * this.ah);
  private difference = new Float32Array(this.aw * this.ah);
  private trails = new Map<string, Float32Array>();
  private initialized = false;

  constructor(private options: SourceSurfaceOptions) {
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    this.analysis.width = this.aw;
    this.analysis.height = this.ah;
    const g = this.canvas.getContext('2d');
    const ag = this.analysis.getContext('2d', { willReadFrequently: true });
    if (!g || !ag) throw new Error('Canvas source processing is unavailable.');
    this.g = g;
    this.ag = ag;
  }

  setRecipes(recipes: SourceEffectRecipe[]): void {
    this.options.recipes = recipes;
  }

  update(t: number, dt: number): void {
    const { width: w, height: h } = this.options;
    this.g.clearRect(0, 0, w, h);
    if (this.options.demoSourceId) {
      paintDemoSource(this.options.demoSourceId, this.g, w, h, t);
    } else if (this.options.source) {
      drawCover(this.g, this.options.source, w, h, t, this.options.motion);
    }

    this.ag.clearRect(0, 0, this.aw, this.ah);
    this.ag.drawImage(this.canvas, 0, 0, this.aw, this.ah);
    let pixels: Uint8ClampedArray;
    try {
      pixels = this.ag.getImageData(0, 0, this.aw, this.ah).data;
    } catch (err) {
      // Cross-origin video without CORS may play but cannot be sampled. It
      // remains visible; only source-aware overlays are skipped.
      console.warn('[vibe] source analysis unavailable for this media', err);
      return;
    }

    for (let i = 0; i < this.current.length; i++) {
      const p = i * 4;
      const luma = (pixels[p] * 0.2126 + pixels[p + 1] * 0.7152 + pixels[p + 2] * 0.0722) / 255;
      this.current[i] = luma;
      this.difference[i] = this.initialized ? Math.abs(luma - this.previous[i]) : 0;
    }

    for (const recipe of this.options.recipes) {
      if (!recipe.enabled) continue;
      const trail = this.trails.get(recipe.id) ?? new Float32Array(this.previous.length);
      this.trails.set(recipe.id, trail);
      const decay = Math.exp(-dt / Math.max(0.05, recipe.params.trail));
      for (let i = 0; i < trail.length; i++) {
        trail[i] = Math.max(this.difference[i], trail[i] * decay);
      }
      this.drawRecipe(recipe, this.current, trail);
    }
    const oldPrevious = this.previous;
    this.previous = this.current;
    this.current = oldPrevious;
    this.initialized = true;
  }

  private drawRecipe(recipe: SourceEffectRecipe, current: Float32Array, trail: Float32Array): void {
    const { width: w, height: h } = this.options;
    const p = recipe.params;
    const stride = Math.max(1, Math.round(p.cellSize / (w / this.aw)));
    const cw = w / this.aw;
    const ch = h / this.ah;
    this.g.save();
    this.g.globalCompositeOperation = 'lighter';
    this.g.fillStyle = p.color;
    this.g.shadowColor = p.color;
    this.g.shadowBlur = p.glow * 22;

    for (let y = 1; y < this.ah - 1; y += stride) {
      for (let x = 1; x < this.aw - 1; x += stride) {
        // Stable spatial hash keeps density deterministic frame to frame.
        const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        if ((hash % 1000) / 1000 > p.density) continue;
        const i = y * this.aw + x;
        const edge = Math.abs(current[i + 1] - current[i - 1])
          + Math.abs(current[i + this.aw] - current[i - this.aw]);
        const signal = recipe.kind === 'motion-cells'
          ? trail[i] * p.response * 7
          : Math.max(trail[i] * p.response * 4.5, edge * p.response * 1.35);
        if (signal < 0.045) continue;
        const alpha = Math.min(0.78, signal) * (0.3 + p.glow * 0.7);
        const size = p.cellSize * (0.55 + Math.min(1, signal) * 0.75);
        this.g.globalAlpha = alpha;
        if (recipe.kind === 'motion-cells') {
          this.g.fillRect(x * cw - size / 2, y * ch - size / 2, size, Math.max(2, size * 0.35));
        } else {
          this.g.beginPath();
          this.g.arc(x * cw, y * ch, Math.max(1.5, size * 0.24), 0, Math.PI * 2);
          this.g.fill();
        }
      }
    }
    this.g.restore();
  }
}
