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
 * These were produced by `npm run gen:effects` through the same prompt the
 * product uses at runtime — real generations, not hand-written stand-ins.
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

  return rooms;
}

// --- persistence -------------------------------------------------------------

function normalizePreset(raw: Preset): Preset {
  return {
    ...raw,
    scene: raw.scene ?? { kind: 'renderer', label: 'Living renderer', style: 'procedural' },
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    sourceEffects: Array.isArray(raw.sourceEffects) ? raw.sourceEffects : [],
    audio: raw.audio ?? structuredClone(DEFAULT_AUDIO),
    controls: { ...DEFAULT_CONTROLS, ...(raw.controls ?? {}) },
  };
}

function loadSaved(): Preset[] {
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

function writeSaved(list: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('[vibe] could not save', err);
  }
}

export function listPresets(): Preset[] {
  return [...seedPresets(), ...loadSaved()];
}

export function listSaved(): Preset[] {
  return loadSaved();
}

export function getPreset(id: string): Preset | undefined {
  return listPresets().find((p) => p.id === id);
}

/** Persist a user preset, replacing any existing one with the same id. */
export function savePreset(preset: Preset): Preset {
  const saved = loadSaved().filter((p) => p.id !== preset.id);
  saved.push(preset);
  writeSaved(saved);
  return preset;
}

export function deletePreset(id: string): void {
  writeSaved(loadSaved().filter((p) => p.id !== id));
}

/**
 * Fork a preset for editing. Built-ins are never mutated — remixing one always
 * produces a new, owned copy, with `parentId` recording where it came from.
 */
export function forkPreset(source: Preset, name?: string): Preset {
  return {
    ...structuredClone(source),
    id: newId('preset'),
    name: name ?? `${source.name} remix`,
    builtIn: false,
    createdAt: new Date().toISOString(),
    parentId: source.id,
  };
}
