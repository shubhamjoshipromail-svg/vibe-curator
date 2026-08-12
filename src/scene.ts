import { Application, BlurFilter, Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { FrameCtx, LayerRuntime, LayerSpec, VibeSpec } from './types';
import { ARCHETYPES, type SlotDef } from './archetypes';
import { loadAsset, loadPack, type LoadedAsset } from './art/pack';
import { ANIMATORS } from './animators';
import { PAINTERS } from './art/painters';
import { bake } from './art/bake';
import { hexToNum } from './palette';
import { mulberry32 } from './rng';
import { arcAt } from './arc';
import { DEFAULT_CONTROLS, type Controls } from './preset/types';
import type { EffectFilter } from './effects/filter';
import type { Filter } from 'pixi.js';
import { SourceAwareSurface, type SourceMetrics } from './source-aware/processor';
import type { DemoSourceId, SourceEffectRecipe, SourceMotion } from './source-aware/types';

/**
 * Pixel art scaled by a non-integer factor is mush — source pixels land across
 * texel boundaries and the grid the whole style depends on stops existing.
 * Snap to whole multiples (or whole divisors below 1:1) instead.
 */
function snapScale(s: number): number {
  if (s >= 1) return Math.max(1, Math.round(s));
  return 1 / Math.max(1, Math.round(1 / s));
}

/**
 * The renderer. Reads a VibeSpec, builds the archetype rig, and runs it.
 *
 * Note what is NOT here: any knowledge of a specific scene. Swapping the vibe
 * produces a different world with no code change, which is the property that
 * makes generation a content problem later rather than an engineering one.
 */
export class Scene {
  app = new Application();
  root = new Container();
  layers: LayerRuntime[] = [];
  vibe!: VibeSpec;

  /** Real seconds elapsed. Drives animator motion; never scaled. */
  t = 0;
  /** Session seconds elapsed. Drives the arc; scaled by `timeScale`. */
  sessionT = 0;
  energy = 1;
  warmth = 1;
  progress = 0;
  running = true;
  /**
   * Multiplier on session time. Exists so the 25-minute arc can be judged in
   * 25 seconds. Evaluating a slow idea in real time is how slow ideas go
   * unevaluated.
   */
  timeScale = 1;

  private host!: HTMLElement;
  private shared: Record<string, number> = {};
  private rand: () => number = Math.random;

  /** Guards against interleaved async rebuilds when the user switches quickly. */
  private buildToken = 0;
  private mediaElement?: HTMLVideoElement;
  private sourceSurface?: SourceAwareSurface;
  private performanceTier: 'light' | 'balanced' | 'full' = 'balanced';
  private sourceTexture?: Texture;
  private bakedTextures = new Set<Texture>();

  /**
   * Generated effects, keyed by target ('scene' or a slot name).
   *
   * These deliberately SURVIVE a vibe change. An effect the user generated is
   * their customization, not a property of one room — dropping it on every
   * switch would make the feature feel disposable. They are re-applied against
   * the new palette and resolution after each rebuild.
   */
  private effects = new Map<string, EffectFilter[]>();
  /** Rig-owned filters (e.g. the abstract field's blur), kept separate so
   *  applying a generated effect never silently deletes them. */
  private baseFilters = new Map<string, Filter[]>();
  /** Live spectrum, fed to every effect's uAudio uniform. */
  private audioBands = new Float32Array(8);

  /**
   * The user's Labs controls.
   *
   * These are the only knobs the product exposes, and they fan out here into
   * the mechanical values the renderer actually uses. Nothing downstream knows
   * the word "mood"; nothing upstream should have to know the word "alpha".
   */
  controls: Controls = { ...DEFAULT_CONTROLS };
  private depthBlur?: BlurFilter;
  private viewMode: 'explore' | 'labs' | 'player' = 'explore';

  async mount(host: HTMLElement, vibe: VibeSpec): Promise<void> {
    this.host = host;
    await this.app.init({
      width: vibe.internal[0],
      height: vibe.internal[1],
      background: hexToNum(vibe.palette.base),
      antialias: false,
      autoDensity: false,
      resolution: 1,
      // Pin to WebGL rather than letting Pixi probe WebGPU first. The probe
      // requests a GPU device, which can stall indefinitely inside embedded
      // webviews — and embedded webviews are the entire delivery target here
      // (Plash, Lively, Tauri). Nothing this renderer does needs WebGPU.
      preference: 'webgl',
    });
    console.info('[vibe] renderer ready:', this.app.renderer.type);
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);

    await this.setVibe(vibe);

    this.app.ticker.add((ticker) => {
      if (!this.running) return;
      // Clamped so a backgrounded tab does not fast-forward the whole session.
      this.tick(Math.min(ticker.deltaMS / 1000, 0.05));
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.app.ticker.stop();
        this.mediaElement?.pause();
      } else {
        this.app.ticker.start();
        if (this.mediaElement) void this.mediaElement.play().catch(() => undefined);
      }
    });

    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  async setVibe(vibe: VibeSpec): Promise<void> {
    const token = ++this.buildToken;
    this.stopMedia();
    this.vibe = vibe;
    this.rand = mulberry32(vibe.seed);
    this.shared = {};
    this.t = 0;
    this.sessionT = 0;

    this.clearRenderTree();
    this.layers = [];
    this.depthBlur = undefined;
    this.root.filters = [];

    const [w, h] = vibe.internal;
    this.app.renderer.resize(w, h);
    this.app.renderer.background.color = hexToNum(vibe.palette.base);
    this.app.canvas.classList.toggle('pixelated', vibe.render_style === 'pixel_art');

    const archetype = ARCHETYPES[vibe.archetype];
    if (!archetype) throw new Error(`Unknown archetype: ${vibe.archetype}`);

    // A missing or broken pack must never blank the room — it falls back to the
    // procedural painters, which is also what makes partial packs work.
    let pack;
    if (vibe.pack) {
      try {
        pack = await loadPack(vibe.pack);
      } catch (err) {
        console.warn(`pack failed to load, falling back to painters: ${vibe.pack}`, err);
      }
    }
    if (token !== this.buildToken) return;

    // Draw order comes from the archetype, not from the vibe. A vibe that omits
    // a slot simply leaves it empty; it can never reorder the rig.
    for (const def of archetype.slots) {
      const spec = vibe.layers.find((l) => l.slot === def.slot);
      if (!spec) continue;

      const view = new Container();
      const baseAlpha = spec.alpha ?? def.alpha ?? 1;
      const layer: LayerRuntime = { slot: def.slot, spec, def, view, state: {}, baseAlpha };

      // Asset first, painter as fallback. Both resolve from the same `asset`
      // name, so swapping in real art is a pack file, not a spec rewrite.
      let asset: LoadedAsset | undefined;
      if (pack?.assets[spec.asset]) {
        try {
          asset = await loadAsset(vibe.pack!, pack, spec.asset, vibe.render_style);
        } catch (err) {
          console.warn(`asset "${spec.asset}" failed; using painter`, err);
        }
        if (token !== this.buildToken) return;
      }

      const painter = PAINTERS[spec.asset];

      if (asset) {
        const sprite = new Sprite(asset.texture);
        this.placeSprite(sprite, def, spec, asset);
        sprite.alpha = baseAlpha;
        if (def.blend) sprite.blendMode = def.blend;
        view.addChild(sprite);
        layer.sprite = sprite;
        layer.placed = (def.fit ?? 'cover') === 'anchor';
      } else if (painter) {
        // Light layers keep their smooth falloff; see bake().
        const isLight = def.blend === 'add' || def.blend === 'screen';
        const tex = bake(
          painter,
          w,
          h,
          vibe.palette,
          this.rand,
          spec.params ?? {},
          vibe.render_style,
          !isLight,
        );
        this.bakedTextures.add(tex);
        const sprite = def.tiling
          ? new TilingSprite({ texture: tex, width: w, height: h })
          : new Sprite(tex);
        sprite.alpha = baseAlpha;
        if (def.blend) sprite.blendMode = def.blend;
        view.addChild(sprite);
        layer.sprite = sprite;
      }

      const animator = ANIMATORS[def.animator];
      if (animator.draws) {
        const gfx = new Graphics();
        if (def.blend) gfx.blendMode = def.blend;
        view.addChild(gfx);
        layer.gfx = gfx;
      }

      if (def.blur) {
        this.baseFilters.set(def.slot, [new BlurFilter({ strength: def.blur, quality: 3 })]);
      } else if (def.slot === 'backdrop' || def.slot === 'sky') {
        // The far layer carries the Depth control.
        this.depthBlur = new BlurFilter({ strength: 0, quality: 2 });
        this.baseFilters.set(def.slot, [this.depthBlur]);
      }

      this.root.addChild(view);
      this.layers.push(layer);
      animator.init?.(layer, this.frameCtx(0));
    }

    // Re-apply generated effects against the new palette and resolution.
    for (const target of this.effects.keys()) this.syncFilters(target);

    this.fit();
  }

  /** Replace the procedural rig with an authored/uploaded full-bleed scene. */
  async setMedia(
    src: string,
    kind: 'image' | 'video',
    fallback: VibeSpec,
    recipes: SourceEffectRecipe[] = [],
    motion?: SourceMotion,
  ): Promise<void> {
    const token = ++this.buildToken;
    this.stopMedia();
    this.vibe = fallback;
    this.rand = mulberry32(fallback.seed);
    this.shared = {};
    this.t = 0;
    this.sessionT = 0;
    this.clearRenderTree();
    this.layers = [];
    this.depthBlur = undefined;
    this.root.filters = [];

    const [w, h] = fallback.internal;
    this.app.renderer.resize(w, h);
    this.app.renderer.background.color = hexToNum(fallback.palette.base);
    this.app.canvas.classList.remove('pixelated');

    let media: HTMLVideoElement | HTMLCanvasElement;
    if (kind === 'video') {
      const video = document.createElement('video');
      video.src = src;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('The selected video could not be decoded.'));
      });
      if (token !== this.buildToken) return;
      this.mediaElement = video;
      await video.play();
      media = video;
    } else {
      // Blob URLs have no extension, so Pixi's asset parser cannot infer their
      // format. Let the browser decode every image type first, then rasterize
      // it. In particular, wrapping an SVG-backed HTMLImageElement directly in
      // a Pixi texture produces a valid-looking but black WebGL texture in some
      // browsers.
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = src;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The selected image could not be decoded.'));
      });
      if (token !== this.buildToken) return;
      const maxDimension = 4096;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const raster = document.createElement('canvas');
      raster.width = Math.max(1, Math.round(image.naturalWidth * scale));
      raster.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = raster.getContext('2d');
      if (!context) throw new Error('The browser could not prepare this image.');
      context.drawImage(image, 0, 0, raster.width, raster.height);
      media = raster;
    }

    this.installSourceSurface({ source: media, recipes, motion });

    for (const target of this.effects.keys()) this.syncFilters(target);
    this.fit();
  }

  /** A moving deterministic source used by the built-in vertical-slice demos. */
  async setProceduralSource(
    sourceId: DemoSourceId,
    fallback: VibeSpec,
    recipes: SourceEffectRecipe[],
  ): Promise<void> {
    ++this.buildToken;
    this.stopMedia();
    this.vibe = fallback;
    this.rand = mulberry32(fallback.seed);
    this.shared = {};
    this.t = 0;
    this.sessionT = 0;
    this.clearRenderTree();
    this.layers = [];
    this.depthBlur = undefined;
    this.root.filters = [];

    const [w, h] = fallback.internal;
    this.app.renderer.resize(w, h);
    this.app.renderer.background.color = hexToNum(fallback.palette.base);
    this.app.canvas.classList.remove('pixelated');
    this.installSourceSurface({ demoSourceId: sourceId, recipes });

    for (const target of this.effects.keys()) this.syncFilters(target);
    this.fit();
  }

  private installSourceSurface(options: {
    source?: HTMLVideoElement | HTMLCanvasElement;
    demoSourceId?: DemoSourceId;
    recipes: SourceEffectRecipe[];
    motion?: SourceMotion;
  }): void {
    const [w, h] = this.vibe.internal;
    this.sourceSurface = new SourceAwareSurface({ width: w, height: h, quality: this.performanceTier, ...options });
    // Seed previous-frame analysis before the texture is uploaded.
    this.sourceSurface.update(0, 1 / 60);
    const texture = Texture.from(this.sourceSurface.canvas);
    this.sourceTexture = texture;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = w;
    sprite.height = h;
    sprite.position.set(w / 2, h / 2);
    this.root.addChild(sprite);
  }

  setSourceEffects(recipes: SourceEffectRecipe[]): void {
    this.sourceSurface?.setRecipes(recipes);
  }

  setSourceMotion(motion?: SourceMotion): void {
    this.sourceSurface?.setMotion(motion);
  }

  setPerformanceTier(tier: 'light' | 'balanced' | 'full'): void {
    this.performanceTier = tier;
    this.sourceSurface?.setQuality(tier);
  }

  /** Match render work to what is actually visible without changing Player quality. */
  setViewMode(mode: 'explore' | 'labs' | 'player'): void {
    this.viewMode = mode;
    // Explore only shows the scene under dense UI at 18% opacity. Labs needs
    // responsive controls; Player remains native display-rate quality.
    this.app.ticker.maxFPS = mode === 'player' ? 60 : mode === 'labs' ? 30 : 15;
  }

  getViewMode(): 'explore' | 'labs' | 'player' {
    return this.viewMode;
  }

  getSourceMetrics(): SourceMetrics | undefined {
    return this.sourceSurface?.getMetrics();
  }

  private stopMedia(): void {
    if (this.mediaElement) {
      this.mediaElement.pause();
      this.mediaElement.removeAttribute('src');
      this.mediaElement.load();
      this.mediaElement = undefined;
    }
    this.sourceTexture?.destroy();
    this.sourceTexture = undefined;
    this.sourceSurface = undefined;
  }

  /** Release scene-owned GPU/Display resources when switching documents. */
  private clearRenderTree(): void {
    for (const filters of this.baseFilters.values()) {
      for (const filter of filters) filter.destroy();
    }
    this.baseFilters.clear();
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    for (const texture of this.bakedTextures) texture.destroy(true);
    this.bakedTextures.clear();
  }

  /** Attach a generated shader effect to the whole scene or a single slot. */
  addEffect(target: string, filter: EffectFilter): void {
    const list = this.effects.get(target) ?? [];
    list.push(filter);
    this.effects.set(target, list);
    this.syncFilters(target);
  }

  removeEffect(target: string, filter: EffectFilter): void {
    const list = (this.effects.get(target) ?? []).filter((f) => f !== filter);
    filter.destroy();
    if (list.length) this.effects.set(target, list);
    else this.effects.delete(target);
    this.syncFilters(target);
  }

  /** Drop every generated effect. Used when switching to a different preset. */
  clearAllEffects(): void {
    const targets = [...this.effects.keys()];
    for (const filters of this.effects.values()) {
      for (const filter of filters) filter.destroy();
    }
    this.effects.clear();
    for (const t of targets) this.syncFilters(t);
  }

  /** Slot names a user can target, in draw order. */
  effectTargets(): string[] {
    return this.layers.map((l) => l.slot);
  }

  /** Fed by the audio engine each frame; drives the uAudio uniform. */
  setAudioBands(bands: Float32Array): void {
    this.audioBands.set(bands.subarray(0, 8));
  }

  /** Compose rig-owned filters with generated ones, base first. */
  private syncFilters(target: string): void {
    const generated = this.effects.get(target) ?? [];
    const [w, h] = this.vibe.internal;
    for (const f of generated) {
      f.setPalette(this.vibe.palette);
      f.setResolution(w, h);
    }

    const base = target === 'scene' ? [] : (this.baseFilters.get(target) ?? []);
    const composed = [...base, ...generated];

    const container =
      target === 'scene' ? this.root : this.layers.find((l) => l.slot === target)?.view;
    if (!container) return;

    container.filters = composed.length ? composed : [];
  }

  /**
   * Position an asset-backed sprite. Everything here operates on the TRIMMED
   * content size, which is why sprites from unrelated sources still line up.
   */
  private placeSprite(
    sprite: Sprite,
    def: SlotDef,
    spec: LayerSpec,
    asset: LoadedAsset,
  ): void {
    const [w, h] = this.vibe.internal;
    const pixel = this.vibe.render_style === 'pixel_art';
    const fit = def.fit ?? 'cover';

    if (fit === 'cover' || fit === 'contain') {
      const ratio =
        fit === 'cover'
          ? Math.max(w / asset.width, h / asset.height)
          : Math.min(w / asset.width, h / asset.height);
      sprite.anchor.set(0.5);
      sprite.scale.set(pixel ? snapScale(ratio) : ratio);
      sprite.position.set(w / 2, h / 2);
    } else {
      const targetH = h * (spec.params?.scale ?? def.defaultScale ?? 0.25);
      const ratio = targetH / asset.height;
      const [ax, ay] = def.anchor ?? [0.5, 1];
      sprite.anchor.set(ax, ay);
      sprite.scale.set(pixel ? snapScale(ratio) : ratio);
      sprite.position.set(
        w * (spec.params?.cx ?? 0.5),
        h * (spec.params?.cy ?? 0.85),
      );
    }

    if (pixel) sprite.roundPixels = true;
  }

  /** Restart the arc without rebuilding the scene. */
  resetSession(): void {
    this.sessionT = 0;
  }

  private frameCtx(dt: number): FrameCtx {
    return {
      t: this.t,
      dt,
      progress: this.progress,
      energy: this.energy,
      warmth: this.warmth,
      width: this.vibe.internal[0],
      height: this.vibe.internal[1],
      palette: this.vibe.palette,
      rand: this.rand,
      shared: this.shared,
    };
  }

  private tick(dt: number): void {
    // Two clocks. Animator motion runs in real time; only the arc is scaled, so
    // fast-forwarding a session previews the arc without strobing the fire.
    this.t += dt;
    this.sessionT += dt * this.timeScale;

    // --- the session arc ---------------------------------------------------
    // The one thing separating a room from a wallpaper. Everything downstream
    // multiplies by these two numbers, so the whole scene ages together.
    const arc = this.vibe.arc;
    this.progress = Math.min(1, this.sessionT / (arc.minutes * 60));
    const state = arcAt(arc, this.progress);

    // Motion scales the arc rather than replacing it: at motion 0 the scene is
    // nearly still but still breathes; at 1 it runs at full arc energy.
    const c = this.controls;
    this.energy = state.energy * (0.25 + 0.75 * c.motion);
    this.warmth = state.warmth * (0.55 + 0.75 * c.mood);

    const ctx = this.frameCtx(dt);
    if (this.sourceSurface && this.sourceTexture) {
      if (this.sourceSurface.update(this.t, dt)) this.sourceTexture.source.update();
    }
    for (const layer of this.layers) {
      ANIMATORS[layer.def.animator].update(layer, ctx);
    }

    // The grade carries both the arc's colour shift and the Atmosphere control:
    // as a session settles the room cools, and haze thickens the wash over it.
    const grade = this.layers.find((l) => l.slot === 'ambient_grade');
    if (grade?.sprite) {
      grade.sprite.alpha =
        grade.baseAlpha * (0.55 + 0.9 * c.atmosphere) * (0.82 + 0.18 * this.warmth);
    }

    // Glow drives how far light spills.
    const pool = this.layers.find((l) => l.slot === 'light_pool' || l.slot === 'bloom');
    if (pool?.sprite) {
      pool.sprite.alpha *= 0.35 + 1.3 * c.glow;
    }

    // Depth softens the far layer, separating it from the subject.
    if (this.depthBlur) this.depthBlur.strength = c.depth * 4;

    for (const list of this.effects.values()) {
      for (const f of list) {
        f.setIntensity(c.intensity);
        f.update(this.t, this.energy, this.audioBands);
      }
    }
  }

  /** Letterbox the internal buffer into the host element, preserving aspect. */
  private fit(): void {
    const [w, h] = this.vibe?.internal ?? [1, 1];
    const box = this.host.getBoundingClientRect();
    const scale = Math.min(box.width / w, box.height / h);
    const canvas = this.app.canvas;
    canvas.style.width = `${Math.round(w * scale)}px`;
    canvas.style.height = `${Math.round(h * scale)}px`;
  }
}
