import { paintDemoSource } from './demo-sources';
import type { DemoSourceId, SourceEffectRecipe, SourceMotion } from './types';

type MediaSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

export interface SourceMetrics {
  brightness: number;
  motion: number;
  centroidX: number;
}

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
  const animated = motion?.kind === 'drift' || motion?.kind === 'flow';
  const drift = motion?.kind === 'drift';
  const amount = animated ? (motion.amount ?? 0.035) : 0;
  const speed = motion?.speed ?? 0.75;
  const scale = Math.max(w / sw, h / sh) * (1 + amount * 1.6);
  const dw = sw * scale;
  const dh = sh * scale;
  const ox = drift ? Math.sin(t * speed) * w * amount : 0;
  const oy = drift ? Math.cos(t * speed * 0.73) * h * amount * 0.55 : 0;
  const dx = (w - dw) / 2 + ox;
  const dy = (h - dh) / 2 + oy;
  if (motion?.kind !== 'flow') {
    g.drawImage(source, dx, dy, dw, dh);
    return;
  }
  // Displace narrow horizontal bands independently. This keeps source detail
  // intact while giving any still image obvious, continuous motion.
  const bands = 42;
  for (let band = 0; band < bands; band++) {
    const sy = (sh / bands) * band;
    const sourceBandH = sh / bands + 1;
    const y = dy + (dh / bands) * band;
    const bandH = dh / bands + 1;
    const wave = Math.sin(t * speed * 2.1 + band * 0.46) * w * amount;
    g.drawImage(source, 0, sy, sw, sourceBandH, dx + wave, y, dw, bandH);
  }
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
  private readonly clean = document.createElement('canvas');
  private readonly cleanG: CanvasRenderingContext2D;
  private readonly ag: CanvasRenderingContext2D;
  private readonly aw = 192;
  private readonly ah = 108;
  private previous = new Float32Array(this.aw * this.ah);
  private current = new Float32Array(this.aw * this.ah);
  private difference = new Float32Array(this.aw * this.ah);
  private red = new Uint8Array(this.aw * this.ah);
  private green = new Uint8Array(this.aw * this.ah);
  private blue = new Uint8Array(this.aw * this.ah);
  private trails = new Map<string, Float32Array>();
  private initialized = false;
  private metrics: SourceMetrics = { brightness: 0, motion: 0, centroidX: 0.5 };
  private lastFrameAt = -Infinity;

  constructor(private options: SourceSurfaceOptions) {
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    this.analysis.width = this.aw;
    this.analysis.height = this.ah;
    this.clean.width = options.width;
    this.clean.height = options.height;
    const g = this.canvas.getContext('2d');
    const ag = this.analysis.getContext('2d', { willReadFrequently: true });
    const cleanG = this.clean.getContext('2d');
    if (!g || !ag || !cleanG) throw new Error('Canvas source processing is unavailable.');
    this.g = g;
    this.ag = ag;
    this.cleanG = cleanG;
  }

  setRecipes(recipes: SourceEffectRecipe[]): void {
    this.options.recipes = recipes;
  }

  setMotion(motion?: SourceMotion): void {
    this.options.motion = motion;
    if (this.options.source instanceof HTMLVideoElement) {
      this.options.source.playbackRate = Math.min(2, Math.max(0.25, motion?.speed ?? 1));
    }
  }

  getMetrics(): SourceMetrics {
    return { ...this.metrics };
  }

  update(t: number, dt: number): boolean {
    // Source analysis and thousands of vector marks do not need display-rate
    // updates. A steady 24fps remains fluid and leaves the UI responsive.
    if (this.initialized && t - this.lastFrameAt < 1 / 24) return false;
    this.lastFrameAt = t;
    const { width: w, height: h } = this.options;
    this.g.clearRect(0, 0, w, h);
    this.cleanG.clearRect(0, 0, w, h);
    if (this.options.demoSourceId) {
      paintDemoSource(this.options.demoSourceId, this.cleanG, w, h, t);
    } else if (this.options.source) {
      drawCover(this.cleanG, this.options.source, w, h, t, this.options.motion);
    }

    this.ag.clearRect(0, 0, this.aw, this.ah);
    this.ag.drawImage(this.clean, 0, 0, this.aw, this.ah);
    let pixels: Uint8ClampedArray;
    try {
      pixels = this.ag.getImageData(0, 0, this.aw, this.ah).data;
    } catch (err) {
      // Cross-origin video without CORS may play but cannot be sampled. It
      // remains visible; only source-aware overlays are skipped.
      console.warn('[vibe] source analysis unavailable for this media', err);
      return false;
    }

    let brightnessSum = 0;
    let motionSum = 0;
    let weightedX = 0;
    for (let i = 0; i < this.current.length; i++) {
      const p = i * 4;
      const luma = (pixels[p] * 0.2126 + pixels[p + 1] * 0.7152 + pixels[p + 2] * 0.0722) / 255;
      this.current[i] = luma;
      this.red[i] = pixels[p];
      this.green[i] = pixels[p + 1];
      this.blue[i] = pixels[p + 2];
      this.difference[i] = this.initialized ? Math.abs(luma - this.previous[i]) : 0;
      brightnessSum += luma;
      motionSum += this.difference[i];
      weightedX += (i % this.aw) * luma;
    }
    const brightness = brightnessSum / this.current.length;
    const target = {
      brightness,
      motion: Math.min(1, (motionSum / this.current.length) * 12),
      centroidX: brightnessSum > 0.001 ? weightedX / brightnessSum / (this.aw - 1) : 0.5,
    };
    this.metrics.brightness += (target.brightness - this.metrics.brightness) * 0.08;
    this.metrics.motion += (target.motion - this.metrics.motion) * 0.12;
    this.metrics.centroidX += (target.centroidX - this.metrics.centroidX) * 0.1;

    const active = this.options.recipes.filter((recipe) => recipe.enabled);
    const sourceVisibility = active.length
      ? Math.max(...active.map((recipe) => recipe.params.sourceVisibility ?? 0.82))
      : 1;
    this.g.save();
    this.g.globalAlpha = sourceVisibility;
    this.g.drawImage(this.clean, 0, 0);
    this.g.restore();

    for (const recipe of active) {
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
    return true;
  }

  private drawRecipe(recipe: SourceEffectRecipe, current: Float32Array, trail: Float32Array): void {
    const { width: w, height: h } = this.options;
    const p = recipe.params;
    const stride = Math.max(recipe.kind === 'tracked-grid' ? 3 : 2, Math.round(p.cellSize / (w / this.aw)));
    const cw = w / this.aw;
    const ch = h / this.ah;
    this.g.save();
    this.g.globalCompositeOperation = 'lighter';
    this.g.fillStyle = p.color;
    this.g.shadowColor = p.color;
    this.g.shadowBlur = p.glow * (recipe.kind === 'tracked-grid' ? 8 : 18);

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
          : recipe.kind === 'edge-echo'
            ? Math.max(trail[i] * p.response * 4.5, edge * p.response * 1.35)
            : Math.max(current[i] * 0.72, edge * p.response * 1.8, trail[i] * p.response * 3);
        if (signal < (recipe.kind === 'tracked-grid' ? 0.11 : 0.045)) continue;
        const alpha = Math.min(0.78, signal) * (0.3 + p.glow * 0.7);
        const size = p.cellSize * (0.55 + Math.min(1, signal) * 0.75);
        this.g.globalAlpha = alpha;
        if (recipe.kind === 'motion-cells') {
          this.g.fillRect(x * cw - size / 2, y * ch - size / 2, size, Math.max(2, size * 0.35));
        } else if (recipe.kind === 'edge-echo') {
          this.g.beginPath();
          this.g.arc(x * cw, y * ch, Math.max(1.5, size * 0.24), 0, Math.PI * 2);
          this.g.fill();
        } else {
          const sourceColor = `rgb(${this.red[i]} ${this.green[i]} ${this.blue[i]})`;
          this.g.strokeStyle = hash % 7 < 5 ? sourceColor : p.color;
          this.g.fillStyle = hash % 11 === 0 ? p.color : sourceColor;
          this.g.lineWidth = Math.max(1, size * 0.12);
          const px = x * cw;
          const py = y * ch;
          const r = Math.max(1.5, size * 0.3);
          if (hash % 3 === 0) {
            this.g.beginPath();
            this.g.moveTo(px - r, py); this.g.lineTo(px + r, py);
            this.g.moveTo(px, py - r); this.g.lineTo(px, py + r);
            this.g.stroke();
          } else if (hash % 3 === 1) {
            this.g.strokeRect(px - r, py - r, r * 2, r * 2);
          } else {
            this.g.fillRect(px - r * .55, py - r * .55, r * 1.1, r * 1.1);
          }
        }
      }
    }
    this.g.restore();
  }
}
