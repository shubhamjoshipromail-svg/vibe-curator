import type { Palette } from '../types';
import type { EffectManifest } from '../effects/manifest';
import { normalizeParams } from '../effects/manifest';
import {
  DEFAULT_AUDIO,
  DEFAULT_CONTROLS,
  newId,
  type Controls,
  type Preset,
  type SceneLayer,
} from './types';
import builtinEffects from '../effects/builtin.json';
import { sourceEffect, type SourceEffectRecipe } from '../source-aware/types';
import { migrateAssets } from '../media/assets';
import { orchestrateLivingStill } from '../living-still/orchestrator';

/**
 * The Library: what Explore browses and what Save writes to.
 *
 * Built-ins ship with the app and are read-only — remixing one produces a copy
 * rather than editing it in place, so the starting set can never be destroyed.
 * User presets live in localStorage. That is deliberately the least
 * infrastructure that makes save/reuse real; swapping it for a backend later
 * only touches this file.
 */

const STORAGE_KEY = 'vibe.library.v1';
const FOLDER_STORAGE_KEY = 'vibe.project-folders.v1';
let sharedSaved: Preset[] | undefined;
let sharedFolders: ProjectFolder[] | undefined;

export interface ProjectFolder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

function automaticTags(scene: SceneLayer, style: string, prompt = ''): string[] {
  const text = `${prompt} ${scene.label} ${style}`.toLowerCase();
  const tags = new Set<string>([scene.kind, style.toLowerCase().replace(/\s+/g, '-')]);
  for (const tag of ['fish', 'flower', 'cloud', 'portrait', 'landscape', 'abstract', 'nature', 'space']) {
    if (text.includes(tag)) tags.add(tag);
  }
  if (scene.kind === 'image' || scene.kind === 'video') tags.add('media');
  return [...tags];
}

// --- built-in effects --------------------------------------------------------

interface BuiltinEffectFile {
  generatedAt: string;
  effects: Array<{
    slug: string;
    name: string;
    notes: string;
    prompt: string;
    glsl: string;
    params: unknown;
    provider: string;
    model: string;
  }>;
}

/**
 * These are produced through the runtime generation contract or reviewed as
 * built-ins when a benchmark needs exact performance or interaction behavior.
 */
export function builtInEffects(): EffectManifest[] {
  const file = builtinEffects as BuiltinEffectFile;
  return file.effects.map((e) => ({
    id: `builtin_${e.slug}`,
    name: e.name,
    notes: e.notes,
    prompt: e.prompt,
    glsl: e.glsl,
    params: normalizeParams(e.params),
    provider: e.provider,
    model: e.model,
    version: 1,
    createdAt: file.generatedAt,
    enabled: true,
  }));
}

export function findBuiltInEffect(id: string): EffectManifest | undefined {
  return builtInEffects().find((e) => e.id === id);
}

// --- palettes ----------------------------------------------------------------

function palette(base: string, surface: string, primary: string, accent: string, text: string, ramp: string[]): Palette {
  return { base, surface, primary, accent, text, ramp };
}

const ASHEN = palette('#0e0a10', '#2a2028', '#8b3a3a', '#d4b483', '#e8dcc8', [
  '#0e0a10', '#1c1419', '#2a2028', '#4a3a3a', '#8b3a3a', '#c47a3a', '#d4b483', '#e8dcc8',
]);

const MOSSGLASS = palette('#080f0c', '#16261e', '#2f5f47', '#9ecf9a', '#eaf5e6', [
  '#080f0c', '#0f1a14', '#16261e', '#24422f', '#2f5f47', '#4f8f63', '#9ecf9a', '#eaf5e6',
]);

const PAPER = palette('#0b1418', '#1f3a3d', '#356063', '#8fb8a8', '#eef2e6', [
  '#0b1418', '#14262b', '#1f3a3d', '#356063', '#5c8f87', '#8fb8a8', '#c3d8c8', '#eef2e6',
]);

const SALTFLAT = palette('#140f10', '#33262233', '#7a5347', '#e0b48c', '#fdf1e3', [
  '#140f10', '#241a19', '#3a2926', '#5c4036', '#7a5347', '#b08163', '#e0b48c', '#fdf1e3',
]);

const SIGNAL = palette('#05060f', '#141d3d', '#22345e', '#4fa3b8', '#dff6f4', [
  '#05060f', '#0b1024', '#141d3d', '#22345e', '#356a8a', '#4fa3b8', '#8fd6dc', '#dff6f4',
]);

const NOCTURNE = palette('#0a0510', '#1d1030', '#3a1d52', '#c46ba8', '#f6e4f2', [
  '#0a0510', '#12081f', '#1d1030', '#2b1642', '#3a1d52', '#7a3a7d', '#c46ba8', '#f6e4f2',
]);

const AURORA = palette('#061026', '#102c4c', '#18a7a0', '#b989ef', '#edfaff', [
  '#061026', '#0b1d3e', '#102c4c', '#13617b', '#18a7a0', '#68d6d0', '#b989ef', '#edfaff',
]);

const JAPANDI = palette('#16130f', '#3a3026', '#806d58', '#bca27d', '#eee7dc', [
  '#16130f', '#26211b', '#3a3026', '#55493b', '#806d58', '#a68d70', '#bca27d', '#eee7dc',
]);

const WESTERN = palette('#0d0d0e', '#30241c', '#78472a', '#d4a45f', '#f0dfbd', [
  '#0d0d0e', '#1d1916', '#30241c', '#543321', '#78472a', '#a86a38', '#d4a45f', '#f0dfbd',
]);

const DECO = palette('#050908', '#092a25', '#145b50', '#c9a04d', '#f4e9ca', [
  '#050908', '#071814', '#092a25', '#0e4038', '#145b50', '#42877b', '#c9a04d', '#f4e9ca',
]);

const SKETCH = palette('#181713', '#e8e1d2', '#30302a', '#70906f', '#10100e', [
  '#10100e', '#30302a', '#666157', '#969083', '#bdb5a6', '#d8d0c1', '#70906f', '#f2ebdc',
]);

const SYNTHWAVE = palette('#08051d', '#23104b', '#6d1e82', '#ff4f9a', '#dff8ff', [
  '#08051d', '#160b38', '#23104b', '#4b176b', '#6d1e82', '#ff4f9a', '#32d6ef', '#dff8ff',
]);

// --- seed presets ------------------------------------------------------------

function seed(
  id: string,
  name: string,
  description: string,
  baseVibeId: string,
  pal: Palette,
  controls: Partial<Controls>,
  effectIds: string[] = [],
  scene?: SceneLayer,
  sourceEffects: SourceEffectRecipe[] = [],
): Preset {
  const effects = effectIds
    .map((eid) => findBuiltInEffect(eid))
    .filter((e): e is EffectManifest => Boolean(e))
    .map((e) => ({ ...e, params: e.params.map((p) => ({ ...p })) }));

  return {
    id,
    name,
    description,
    builtIn: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tags: automaticTags(scene ?? { kind: 'renderer', label: name, style: 'procedural' }, 'starting-point', description),
    baseVibeId,
    scene: scene ?? { kind: 'renderer', label: 'Living renderer', style: baseVibeId === 'ashen-keep' ? 'pixel art' : 'procedural' },
    palette: pal,
    effects,
    sourceEffects,
    audio: structuredClone(DEFAULT_AUDIO),
    controls: { ...DEFAULT_CONTROLS, ...controls },
    theme: { accent: pal.accent },
  };
}

/**
 * Six starting rooms across three rigs. Two per rig with different palettes,
 * which is the cheapest possible demonstration that recolouring alone turns
 * one scene into several distinct places.
 */
function seedPresets(): Preset[] {
  const rooms = [
    seed('ashen-keep', 'Ashen Keep', 'A knight resting by a low fire in a stone hall.', 'ashen-keep', ASHEN,
      { mood: 0.85, motion: 0.5, depth: 0.55, glow: 0.7, atmosphere: 0.4, intensity: 0.55 },
      ['builtin_drifting-motes']),

    seed('moss-glass', 'Moss & Glass', 'The same hall, long abandoned and gone green.', 'ashen-keep', MOSSGLASS,
      { mood: 0.35, motion: 0.4, depth: 0.6, glow: 0.45, atmosphere: 0.6, intensity: 0.5 },
      ['builtin_volumetric-shaft']),

    seed('paper-valley', 'Paper Valley', 'A cold ink-wash valley at dusk, wide and quiet.', 'paper-valley', PAPER,
      { mood: 0.3, motion: 0.55, depth: 0.7, glow: 0.4, atmosphere: 0.55, intensity: 0.5 },
      ['builtin_aurora-veil']),

    seed('salt-flats', 'Salt Flats', 'The same valley at first light, warm and hazy.', 'paper-valley', SALTFLAT,
      { mood: 0.9, motion: 0.35, depth: 0.6, glow: 0.65, atmosphere: 0.7, intensity: 0.45 },
      ['builtin_volumetric-shaft']),

    seed('signal-drift', 'Signal Drift', 'Weightless and deep. Nothing to look at directly.', 'signal-drift', SIGNAL,
      { mood: 0.25, motion: 0.5, depth: 0.85, glow: 0.6, atmosphere: 0.5, intensity: 0.6 },
      ['builtin_underwater-light']),

    seed('nocturne', 'Nocturne', 'Violet dark, slow and close.', 'signal-drift', NOCTURNE,
      { mood: 0.6, motion: 0.3, depth: 0.8, glow: 0.7, atmosphere: 0.65, intensity: 0.55 },
      ['builtin_rain-on-glass']),
  ];

  // Three moving sources prove the source-aware path end to end. Each recipe
  // remains independently editable, and normal atmospheric filters still
  // compose over the processed source.
  rooms.push(
    seed('living-koi', 'Living Koi', 'Luminous cells follow two koi as they curve through midnight water.', 'signal-drift', SIGNAL,
      { mood: 0.45, motion: 0.7, depth: 0.8, glow: 0.9, atmosphere: 0.3, intensity: 0.55 },
      ['builtin_underwater-light'],
      { kind: 'procedural', label: 'Swimming koi source', style: 'source-aware motion', sourceId: 'living-koi' },
      [sourceEffect('motion-cells', 'Luminous wake cells', '#61f0e6', { cellSize: 11, trail: 1.15, density: 0.76, response: 1.35 })]),
    seed('cloud-study', 'Cloud Study', 'A soft halftone wake gathers around drifting cloud banks.', 'paper-valley', PAPER,
      { mood: 0.65, motion: 0.55, depth: 0.72, glow: 0.52, atmosphere: 0.7, intensity: 0.34 },
      [],
      { kind: 'procedural', label: 'Drifting cloud source', style: 'motion halftone', sourceId: 'drifting-cloud' },
      [sourceEffect('motion-cells', 'Cloud halftone wake', '#ffd6ae', { cellSize: 15, trail: 1.7, glow: 0.56, density: 0.58, response: 1.8 })]),
    seed('bloom-signal', 'Bloom Signal', 'A living contour rebuilds itself around a flower as it opens.', 'signal-drift', NOCTURNE,
      { mood: 0.72, motion: 0.62, depth: 0.76, glow: 0.88, atmosphere: 0.4, intensity: 0.42 },
      ['builtin_drifting-motes'],
      { kind: 'procedural', label: 'Blooming flower source', style: 'edge reconstruction', sourceId: 'blooming-flower' },
      [sourceEffect('edge-echo', 'Bloom contour echo', '#ff82ad', { cellSize: 9, trail: 1.25, glow: 0.92, density: 0.82, response: 1.2 })]),
  );

  const market = (preset: Preset): Preset => ({
    ...preset,
    marketplaceOnly: true,
    controls: { ...preset.controls, motion: 0 },
    scene: preset.scene.kind === 'image' || preset.scene.kind === 'video'
      ? { ...preset.scene, motion: { kind: 'none' } }
      : preset.scene,
    tags: [...preset.tags, 'curated', 'static-scene', 'simple-music'],
  });
  const marketImage = (path: string, label: string, style: string): SceneLayer => ({
    kind: 'image', url: path, label, style, mimeType: 'image/jpeg', motion: { kind: 'none' },
    provenance: { provider: 'openai', model: 'gpt-image-2', createdAt: '2026-08-13T21:44:00.000Z' },
  });
  rooms.push(
    market(seed('market-pixel-last-broadcast', 'The Last Broadcast', 'An authored pixel-art headland with a quiet signal, moonlit sea and minimal coastal score.', 'pixel-broadcast', SIGNAL,
      { mood: 0.42, motion: 0, depth: 0.5, glow: 0.38, atmosphere: 0.28, intensity: 0.12 }, [],
      { kind: 'image', url: '/market/styles/pixel-last-broadcast.png', label: 'The Last Broadcast master', style: 'Pixel Art', mimeType: 'image/png', motion: { kind: 'none' }, provenance: { provider: 'openai', model: 'gpt-image-2', createdAt: '2026-08-13T22:08:00.000Z' } })),
    market(seed('market-pixel-midnight-shrine', 'Midnight Shrine', 'A true 16-bit lakeside scene with hard pixels, still water and one warm lantern.', 'ashen-keep', SIGNAL,
      { mood: 0.3, motion: 0.08, depth: 0.52, glow: 0.44, atmosphere: 0.28, intensity: 0.16 }, [], marketImage('/market/styles/pixel-art.jpg', 'Pixel shrine at midnight', 'Pixel Art'))),
    market(seed('market-pixel-lantern-save', 'Lantern Save Point', 'The same pixel world with warmer color and a soft analog-game glow.', 'ashen-keep', ASHEN,
      { mood: 0.72, motion: 0.1, depth: 0.48, glow: 0.62, atmosphere: 0.32, intensity: 0.24 }, ['builtin_crt-phosphor'], marketImage('/market/styles/pixel-art.jpg', 'Pixel lantern save point', 'Pixel Art'))),
    (() => {
      const preset = market(seed('market-cozy-gatehouse-rest', 'Gatehouse Rest', 'A rainbound ranger finds one warm, quiet night beneath an abandoned mountain gatehouse.', 'ashen-keep', ASHEN,
        { mood: 0.78, motion: 0.46, depth: 0.72, glow: 0.58, atmosphere: 0.55, intensity: 0.32 }, [],
        { kind: 'image', url: '/market/styles/cozy-dark-fantasy.png', label: 'Gatehouse Rest master', style: 'Cozy Dark Fantasy', mimeType: 'image/png', motion: { kind: 'none' }, provenance: { provider: 'openai', model: 'gpt-image-2', createdAt: '2026-08-14T20:24:00.000Z' } }));
      preset.livingStill = orchestrateLivingStill(
        'Quiet subtle fire in the brazier, gentle rain outside the archway, occasional distant owl; preserve the sleeping ranger and architecture.',
        { fire: { x: 0.43, y: 0.50, width: 0.14, height: 0.30 }, exterior: { x: 0.57, y: 0.08, width: 0.43, height: 0.78 } },
      );
      preset.tags = preset.tags.filter((tag) => tag !== 'static-scene');
      preset.tags.push('living-still');
      return preset;
    })(),
    market(seed('market-sketch-rain-table', 'Rain Table', 'Loose black ink, paper grain and two quiet cups beside a rain-dark window.', 'paper-valley', SKETCH,
      { mood: 0.52, motion: 0.08, depth: 0.38, glow: 0.12, atmosphere: 0.42, intensity: 0.12 }, [], marketImage('/market/styles/conceptual-sketch.jpg', 'Rainy café conceptual sketch', 'Conceptual Sketch'))),
    market(seed('market-sketch-green-note', 'Green Note', 'A raw editorial drawing with one restrained green accent and softer paper tone.', 'paper-valley', MOSSGLASS,
      { mood: 0.62, motion: 0.1, depth: 0.42, glow: 0.18, atmosphere: 0.35, intensity: 0.16 }, [], marketImage('/market/styles/conceptual-sketch.jpg', 'Green-note conceptual sketch', 'Conceptual Sketch'))),
    market(seed('market-aurora-stillwater', 'Aurora Stillwater', 'Wide iridescent light over a glass-dark horizon, paired with a slow ambient bed.', 'signal-drift', AURORA,
      { mood: 0.42, motion: 0.22, depth: 0.82, glow: 0.84, atmosphere: 0.55, intensity: 0.28 }, ['builtin_aurora-veil'], marketImage('/market/styles/aurora.jpg', 'Aurora over still water', 'Aurora'))),
    market(seed('market-aurora-night-current', 'Night Current', 'The same luminous world with cooler color, deeper haze and rain-softened edges.', 'signal-drift', SIGNAL,
      { mood: 0.22, motion: 0.34, depth: 0.9, glow: 0.72, atmosphere: 0.76, intensity: 0.36 }, ['builtin_rain-on-glass'], marketImage('/market/styles/aurora.jpg', 'Aurora night current', 'Aurora'))),
    market(seed('market-japandi-blue-hour', 'Blue Hour Room', 'A spare room at dusk with low light, natural wood and an unobtrusive focus loop.', 'paper-valley', JAPANDI,
      { mood: 0.46, motion: 0.08, depth: 0.42, glow: 0.18, atmosphere: 0.3, intensity: 0.12 }, [], marketImage('/market/styles/japandi-editorial.jpg', 'Japandi editorial garden', 'Japandi'))),
    market(seed('market-japandi-warm-stillness', 'Warm Stillness', 'A warmer, softer mix of the room for reading, thinking and quiet work.', 'paper-valley', SALTFLAT,
      { mood: 0.82, motion: 0.08, depth: 0.38, glow: 0.24, atmosphere: 0.34, intensity: 0.14 }, [], marketImage('/market/styles/japandi-editorial.jpg', 'Warm Japandi print', 'Japandi'))),
    market(seed('market-western-moon-ritual', 'Moon Ritual', 'A moonlit mesa, distant celestial geometry and a low desert drone.', 'ashen-keep', WESTERN,
      { mood: 0.68, motion: 0.2, depth: 0.78, glow: 0.58, atmosphere: 0.5, intensity: 0.3 }, ['builtin_drifting-motes'], marketImage('/market/styles/mystical-western.jpg', 'Moonlit mystical western', 'Mystical Western'))),
    market(seed('market-western-dust-signal', 'Dust Signal', 'The desert retuned as a darker analog broadcast with slow-moving grain.', 'ashen-keep', ASHEN,
      { mood: 0.76, motion: 0.28, depth: 0.68, glow: 0.46, atmosphere: 0.62, intensity: 0.38 }, ['builtin_crt-phosphor'], marketImage('/market/styles/mystical-western.jpg', 'Mystical western dust signal', 'Mystical Western'))),
    market(seed('market-deco-emerald-midnight', 'Emerald Midnight', 'Lacquer, brass and a distant city paired with a restrained after-hours pulse.', 'signal-drift', DECO,
      { mood: 0.62, motion: 0.18, depth: 0.86, glow: 0.56, atmosphere: 0.36, intensity: 0.24 }, [], marketImage('/market/styles/art-deco.jpg', 'Emerald Art Deco lounge', 'Art Deco'))),
    market(seed('market-deco-golden-hour', 'Golden Afterglow', 'A warmer lounge variation with soft bloom and slow drifting light.', 'signal-drift', WESTERN,
      { mood: 0.9, motion: 0.24, depth: 0.8, glow: 0.74, atmosphere: 0.44, intensity: 0.32 }, ['builtin_volumetric-shaft'], marketImage('/market/styles/art-deco.jpg', 'Golden Art Deco afterglow', 'Art Deco'))),
    market(seed('market-synthwave-observatory', 'Night Observatory', 'An airbrushed neon coast with a wireframe horizon and slow retro pulse.', 'signal-drift', SYNTHWAVE,
      { mood: 0.64, motion: 0.22, depth: 0.74, glow: 0.82, atmosphere: 0.3, intensity: 0.28 }, ['builtin_crt-phosphor'], marketImage('/market/styles/synthwave.jpg', 'Synthwave coastal observatory', 'Synthwave'))),
    market(seed('market-synthwave-coastal-drive', 'Coastal Drive', 'A brighter magenta-cyan variation with deeper bloom and VHS texture.', 'signal-drift', NOCTURNE,
      { mood: 0.76, motion: 0.3, depth: 0.78, glow: 0.94, atmosphere: 0.36, intensity: 0.4 }, ['builtin_crt-phosphor', 'builtin_aurora-veil'], marketImage('/market/styles/synthwave.jpg', 'Synthwave coastal drive', 'Synthwave'))),

    market(seed('market-bauhaus-pavilion', 'Primary Pavilion', 'A disciplined seaside pavilion composed from primary geometry and open space.', 'paper-valley', PAPER, { mood: 0.65, motion: 0, depth: 0.42, glow: 0.2, atmosphere: 0.2, intensity: 0.18 }, [], marketImage('/market/styles/bauhaus.png', 'Bauhaus primary pavilion', 'Bauhaus'))),
    market(seed('market-art-nouveau-conservatory', 'Moon Conservatory', 'A botanical moon garden drawn with flowing ornamental linework.', 'paper-valley', MOSSGLASS, { mood: 0.62, motion: 0, depth: 0.66, glow: 0.52, atmosphere: 0.48, intensity: 0.24 }, [], marketImage('/market/styles/art-nouveau.png', 'Art Nouveau moon conservatory', 'Art Nouveau'))),
    market(seed('market-wabi-sabi-rain-bowl', 'Rain Bowl', 'A weathered handmade bowl, rainy window and an almost silent room.', 'paper-valley', JAPANDI, { mood: 0.48, motion: 0, depth: 0.5, glow: 0.12, atmosphere: 0.55, intensity: 0.1 }, [], marketImage('/market/styles/wabi-sabi.png', 'Wabi-sabi rain bowl', 'Wabi-Sabi'))),
    market(seed('market-neo-brutalist-playground', 'Raw Playground', 'Hard outlines and acid blocks turn an urban playground into a graphic system.', 'signal-drift', SIGNAL, { mood: 0.78, motion: 0, depth: 0.38, glow: 0.18, atmosphere: 0.12, intensity: 0.32 }, [], marketImage('/market/styles/neo-brutalism.png', 'Neo-brutalist playground', 'Neo-Brutalism'))),
    market(seed('market-risograph-hill-ride', 'Hill Ride', 'Two inks, imperfect registration and cyclists moving through a printed hillside.', 'paper-valley', SALTFLAT, { mood: 0.75, motion: 0, depth: 0.42, glow: 0.14, atmosphere: 0.22, intensity: 0.22 }, [], marketImage('/market/styles/risograph.png', 'Risograph hill ride', 'Risograph'))),
    market(seed('market-paper-cut-fox-valley', 'Fox Valley', 'A moonlit forest built from layered cardstock, shadow and storybook silhouettes.', 'ashen-keep', MOSSGLASS, { mood: 0.58, motion: 0, depth: 0.76, glow: 0.4, atmosphere: 0.36, intensity: 0.18 }, [], marketImage('/market/styles/paper-cut.png', 'Paper-cut fox valley', 'Paper Cut'))),
    market(seed('market-cyanotype-coast', 'Botanical Coast', 'Ferns, shells and a distant sail rendered as a handmade blue photogram.', 'paper-valley', SIGNAL, { mood: 0.38, motion: 0, depth: 0.38, glow: 0.12, atmosphere: 0.4, intensity: 0.12 }, [], marketImage('/market/styles/cyanotype.png', 'Cyanotype botanical coast', 'Cyanotype'))),
    market(seed('market-stained-glass-heron', 'Heron Sunrise', 'A jewel-toned mountain lake assembled from luminous glass and lead.', 'signal-drift', DECO, { mood: 0.84, motion: 0, depth: 0.6, glow: 0.72, atmosphere: 0.2, intensity: 0.28 }, [], marketImage('/market/styles/stained-glass.png', 'Stained-glass heron sunrise', 'Stained Glass'))),
    market(seed('market-surreal-collage-door', 'Ocean Door', 'A torn-paper desert where one impossible doorway opens into the sea.', 'paper-valley', WESTERN, { mood: 0.58, motion: 0, depth: 0.58, glow: 0.18, atmosphere: 0.32, intensity: 0.18 }, [], marketImage('/market/styles/surreal-collage.png', 'Surreal collage ocean door', 'Surreal Collage'))),
    market(seed('market-mid-century-lake-house', 'Lake House', 'An optimistic hillside retreat illustrated in warm atomic-age color.', 'paper-valley', MOSSGLASS, { mood: 0.86, motion: 0, depth: 0.6, glow: 0.44, atmosphere: 0.25, intensity: 0.2 }, [], marketImage('/market/styles/mid-century.png', 'Mid-century lake house', 'Mid-Century Modern'))),

    market(seed('market-living-color-orbit', 'Color Orbit Garden', 'A procedural flower world folded into an audio-reactive color tunnel.', 'signal-drift', NOCTURNE,
      { mood: 0.82, motion: 0.84, depth: 0.88, glow: 0.96, atmosphere: 0.35, intensity: 0.9 }, ['builtin_psychedelic-fractal'],
      { kind: 'procedural', label: 'Blooming color-orbit source', style: 'living scene', sourceId: 'blooming-flower' },
      [sourceEffect('edge-echo', 'Prismatic contour echo', '#ff63ca', { cellSize: 8, trail: 1.1, glow: 0.94, density: 0.8, response: 1.25 })])),
    market(seed('market-living-midnight-haze', 'Midnight Haze', 'A coded violet field where rain refraction and aurora light breathe together.', 'signal-drift', NOCTURNE,
      { mood: 0.48, motion: 0.42, depth: 0.9, glow: 0.82, atmosphere: 0.8, intensity: 0.58 }, ['builtin_aurora-veil', 'builtin_rain-on-glass'])),
    market(seed('market-living-neon-koi', 'Neon Koi Circuit', 'Living koi reconstructed in real time as a bright moving signal field.', 'signal-drift', SIGNAL,
      { mood: 0.5, motion: 0.78, depth: 0.84, glow: 0.95, atmosphere: 0.25, intensity: 0.7 }, ['builtin_underwater-light'],
      { kind: 'procedural', label: 'Electro koi source', style: 'living scene', sourceId: 'living-koi' },
      [sourceEffect('tracked-grid', 'Neon anatomy grid', '#78fff0', { cellSize: 7, trail: 0.9, glow: 0.86, density: 0.82, response: 1.45, sourceVisibility: 0.75 })])),
    market(seed('market-living-ember-throne', 'Ember Throne', 'The original code-painted dark-fantasy hall with live fire, sparks and light.', 'ashen-keep', ASHEN,
      { mood: 0.92, motion: 0.58, depth: 0.66, glow: 0.82, atmosphere: 0.52, intensity: 0.62 }, ['builtin_drifting-motes', 'builtin_volumetric-shaft'])),
  );

  return rooms;
}

// --- persistence -------------------------------------------------------------

function normalizePreset(raw: Preset): Preset {
  return {
    ...raw,
    updatedAt: raw.updatedAt ?? raw.createdAt,
    tags: Array.isArray(raw.tags) ? raw.tags : automaticTags(raw.scene, raw.scene?.style ?? 'scene', raw.description),
    scene: raw.scene ?? { kind: 'renderer', label: 'Living renderer', style: 'procedural' },
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    sourceEffects: Array.isArray(raw.sourceEffects) ? raw.sourceEffects : [],
    performanceTier: raw.performanceTier ?? 'balanced',
    audio: raw.audio ?? structuredClone(DEFAULT_AUDIO),
    controls: { ...DEFAULT_CONTROLS, ...(raw.controls ?? {}) },
  };
}

function loadLocalSaved(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Preset[]).map(normalizePreset) : [];
  } catch (err) {
    console.warn('[vibe] could not read the library; starting empty', err);
    return [];
  }
}

function loadSaved(): Preset[] {
  return sharedSaved ?? loadLocalSaved();
}

function writeSaved(list: Preset[]): void {
  sharedSaved = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('[vibe] could not save', err);
  }
}

function normalizeFolder(raw: ProjectFolder): ProjectFolder {
  return {
    id: raw.id,
    name: String(raw.name || 'Untitled folder').trim().slice(0, 60) || 'Untitled folder',
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date().toISOString(),
  };
}

function loadLocalFolders(): ProjectFolder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDER_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as ProjectFolder[]).map(normalizeFolder) : [];
  } catch {
    return [];
  }
}

function writeFolders(folders: ProjectFolder[]): void {
  sharedFolders = folders;
  localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(folders));
}

async function persistSharedFolder(folder: ProjectFolder): Promise<void> {
  const response = await fetch(`/api/library/folders/${encodeURIComponent(folder.id)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(folder),
  });
  if (!response.ok) throw new Error('The shared local library could not save this folder.');
}

async function persistSharedPreset(preset: Preset): Promise<void> {
  const response = await fetch(`/api/library/projects/${encodeURIComponent(preset.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(preset),
  });
  if (!response.ok) throw new Error('The shared local library could not save this project.');
}

/** Merge browser-local projects into the server library and pull projects made
 * in other browsers into this browser cache. Newest updatedAt wins per id. */
export async function hydrateLibrary(): Promise<void> {
  const local = loadLocalSaved();
  const localFolders = loadLocalFolders();
  let remote: Preset[];
  let remoteFolders: ProjectFolder[] = [];
  try {
    const [response, folderResponse] = await Promise.all([
      fetch('/api/library/projects', { cache: 'no-store' }),
      fetch('/api/library/folders', { cache: 'no-store' }),
    ]);
    if (!response.ok || !folderResponse.ok) throw new Error('Shared library is unavailable.');
    const [parsed, folderParsed] = await Promise.all([response.json(), folderResponse.json()]);
    remote = Array.isArray(parsed) ? (parsed as Preset[]).map(normalizePreset) : [];
    remoteFolders = Array.isArray(folderParsed) ? (folderParsed as ProjectFolder[]).map(normalizeFolder) : [];
  } catch (error) {
    console.warn('[vibe] using browser library cache', error);
    sharedSaved = local;
    sharedFolders = localFolders;
    return;
  }

  const merged = new Map<string, Preset>();
  for (const preset of remote) merged.set(preset.id, preset);
  for (const preset of local) {
    const existing = merged.get(preset.id);
    if (!existing || preset.updatedAt > existing.updatedAt) merged.set(preset.id, preset);
  }

  // Assets have to arrive before their project documents become visible in a
  // second browser. Missing legacy assets stay safely cached in their origin.
  await migrateAssets(local.flatMap((preset) => [
    preset.scene.kind === 'image' || preset.scene.kind === 'video' ? preset.scene.assetId ?? '' : '',
    preset.music?.assetId ?? '',
  ]));

  const remoteById = new Map(remote.map((preset) => [preset.id, preset]));
  for (const preset of local) {
    const serverCopy = remoteById.get(preset.id);
    if (!serverCopy || preset.updatedAt > serverCopy.updatedAt) {
      try {
        await persistSharedPreset(preset);
      } catch (error) {
        console.warn(`[vibe] could not migrate project ${preset.id}`, error);
      }
    }
  }
  writeSaved([...merged.values()]);

  const mergedFolders = new Map(remoteFolders.map((folder) => [folder.id, folder]));
  for (const folder of localFolders) {
    const existing = mergedFolders.get(folder.id);
    if (!existing || folder.updatedAt > existing.updatedAt) {
      mergedFolders.set(folder.id, folder);
      void persistSharedFolder(folder).catch((error) => console.warn('[vibe] could not migrate folder', error));
    }
  }
  writeFolders([...mergedFolders.values()]);
}

export function listProjectFolders(): ProjectFolder[] {
  return [...(sharedFolders ?? loadLocalFolders())].sort((a, b) => a.name.localeCompare(b.name));
}

export function createProjectFolder(name: string): ProjectFolder {
  const now = new Date().toISOString();
  const folder = normalizeFolder({ id: newId('folder'), name, createdAt: now, updatedAt: now });
  writeFolders([...listProjectFolders(), folder]);
  void persistSharedFolder(folder).catch((error) => console.warn('[vibe] shared folder save failed', error));
  return folder;
}

export function deleteProjectFolder(id: string): void {
  writeFolders(listProjectFolders().filter((folder) => folder.id !== id));
  for (const preset of listSaved().filter((item) => item.folderId === id)) {
    savePreset({ ...preset, folderId: undefined });
  }
  void fetch(`/api/library/folders/${encodeURIComponent(id)}`, { method: 'DELETE' })
    .catch((error) => console.warn('[vibe] shared folder delete failed', error));
}

export function movePresetToFolder(presetId: string, folderId?: string): void {
  const preset = listSaved().find((item) => item.id === presetId);
  if (preset) savePreset({ ...preset, folderId });
}

export function listPresets(): Preset[] {
  return [...seedPresets(), ...consolidateSaved(loadSaved())];
}

export function listSaved(): Preset[] {
  return consolidateSaved(loadSaved());
}

/**
 * A stable signature of everything that makes a preset *different* to look at
 * or listen to. Identity, timestamps and names are excluded on purpose: two
 * remixes with the same settings are the same room, whatever they are called.
 */
export function presetFingerprint(preset: Preset): string {
  const scene = preset.scene;
  return JSON.stringify({
    // SceneLayer is a union; the 'renderer' variant carries no media fields.
    scene: {
      kind: scene?.kind ?? null,
      source: scene && 'assetId' in scene ? scene.assetId : scene && 'url' in scene ? scene.url : null,
      motion: scene && 'motion' in scene ? scene.motion : null,
    },
    palette: preset.palette?.ramp ?? null,
    controls: preset.controls ?? null,
    effects: (preset.effects ?? []).map((e) => [e.name, e.enabled, e.params?.map((p) => p.value)]),
    sourceEffects: (preset.sourceEffects ?? []).map((e) => [e.kind, e.enabled, e.params]),
    living: (preset.livingStill?.effects ?? []).map((e) => [e.kind, e.enabled, e.intensity]),
    music: preset.music?.assetId ?? null,
    audio: preset.audio ?? null,
  });
}

/**
 * Older builds minted a brand-new remix every time you opened a starting point,
 * so a library can contain five "Neon Koi remix" records with identical
 * settings. This used to be handled by showing only the newest per parent,
 * which hid genuinely different variants along with the noise.
 *
 * Now: distinct variants are all shown, disambiguated by age. Exact copies are
 * still collapsed here, and `pruneRedundantPresets` removes them for good.
 */
function consolidateSaved(saved: Preset[]): Preset[] {
  const byParent = new Map<string, Preset[]>();
  const independent: Preset[] = [];

  for (const preset of saved) {
    if (!preset.parentId) {
      independent.push(preset);
      continue;
    }
    (byParent.get(preset.parentId) ?? byParent.set(preset.parentId, []).get(preset.parentId)!).push(preset);
  }

  const variants: Preset[] = [];
  for (const group of byParent.values()) {
    const newestFirst = [...group].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const seen = new Set<string>();
    let index = 0;
    for (const preset of newestFirst) {
      const key = presetFingerprint(preset);
      if (seen.has(key)) continue; // an exact copy of one we are already showing
      seen.add(key);
      index += 1;
      // Distinct variants stay visible; the older ones just get a suffix so the
      // Library does not show four cards with the same name.
      variants.push(index === 1 ? preset : { ...preset, name: `${preset.name} ${index}` });
    }
  }

  return [...independent, ...variants];
}

/**
 * One-time cleanup for libraries built by older versions.
 *
 * Only removes records whose settings are byte-identical to a newer sibling, so
 * nothing a user actually made differently is lost. Returns how many went.
 */
export function pruneRedundantPresets(): number {
  const saved = loadSaved();
  const keep: Preset[] = [];
  const drop: Preset[] = [];
  const seenByParent = new Map<string, Set<string>>();

  const newestFirst = [...saved].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  for (const preset of newestFirst) {
    if (!preset.parentId) {
      keep.push(preset);
      continue;
    }
    const seen = seenByParent.get(preset.parentId) ?? new Set<string>();
    seenByParent.set(preset.parentId, seen);
    const key = presetFingerprint(preset);
    if (seen.has(key)) drop.push(preset);
    else {
      seen.add(key);
      keep.push(preset);
    }
  }

  if (!drop.length) return 0;

  writeSaved(keep);
  for (const preset of drop) {
    void fetch(`/api/library/projects/${encodeURIComponent(preset.id)}`, { method: 'DELETE' })
      .catch((error) => console.warn('[vibe] shared project delete failed', error));
  }
  return drop.length;
}

export function getPreset(id: string): Preset | undefined {
  return listPresets().find((p) => p.id === id);
}

/** Persist a user preset, replacing any existing one with the same id. */
export function savePreset(preset: Preset): Preset {
  preset.updatedAt = new Date().toISOString();
  preset.tags = automaticTags(preset.scene, preset.scene.style, preset.scene.provenance?.prompt ?? preset.description);
  const saved = loadSaved().filter((p) => p.id !== preset.id);
  saved.push(preset);
  writeSaved(saved);
  void persistSharedPreset(preset).catch((error) => console.error('[vibe] shared project save failed', error));
  return preset;
}

export function deletePreset(id: string): void {
  writeSaved(loadSaved().filter((p) => p.id !== id));
  void fetch(`/api/library/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
    .catch((error) => console.warn('[vibe] shared project delete failed', error));
}

/**
 * Fork a preset for editing. Built-ins are never mutated — remixing one always
 * produces a new, owned copy, with `parentId` recording where it came from.
 */
export function forkPreset(source: Preset, name?: string): Preset {
  if (source.builtIn) {
    const existing = loadSaved()
      .filter((preset) => preset.parentId === source.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (existing) return structuredClone(existing);
  }
  const now = new Date().toISOString();
  return {
    ...structuredClone(source),
    id: newId('preset'),
    name: name ?? `${source.name} remix`,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
    tags: [...source.tags],
    parentId: source.id,
  };
}

export function createMediaPreset(input: {
  prompt: string;
  style: string;
  assetId: string;
  mimeType: string;
  provider: string;
  model: string;
}): Preset {
  const now = new Date().toISOString();
  const words = input.prompt.trim().split(/\s+/).slice(0, 5).join(' ');
  const name = words ? words.replace(/^./, (letter) => letter.toUpperCase()) : 'Untitled visual';
  const scene: SceneLayer = {
    kind: 'image',
    label: name,
    style: input.style,
    assetId: input.assetId,
    mimeType: input.mimeType,
    // Drift, not flow. Drift is a single translated draw — a slow Ken Burns
    // that cannot tear. Flow re-slices the frame, and on the photoreal images
    // this generator produces that is the one setting that makes a beautiful
    // source look worse than the file on disk. Flow stays one click away in
    // Labs for anyone who wants it; it just is not what you land on.
    motion: { kind: 'drift', amount: 0.06, speed: 0.05 },
    provenance: {
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      createdAt: now,
    },
  };
  return {
    id: newId('project'),
    name,
    description: input.prompt,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
    tags: automaticTags(scene, input.style, input.prompt),
    scene,
    baseVibeId: 'signal-drift',
    palette: structuredClone(SIGNAL),
    effects: [],
    sourceEffects: [sourceEffect('tracked-grid', 'Tracked signal grid', '#ff8a5b', {
      cellSize: 8,
      density: 0.7,
      glow: 0.72,
      trail: 0.7,
      response: 1.15,
      sourceVisibility: 0.88,
    })],
    audio: structuredClone(DEFAULT_AUDIO),
    controls: { ...DEFAULT_CONTROLS, motion: 0.72, glow: 0.74, intensity: 0.72 },
    performanceTier: 'balanced',
    theme: { accent: SIGNAL.accent },
  };
}
