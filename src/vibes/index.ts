import type { VibeSpec } from '../types';

/**
 * The starting library.
 *
 * Three vibes across three archetypes in three deliberately different
 * aesthetics. That spread is the point: it is the cheapest possible test of
 * whether the rig generalizes or whether we built a campfire-specific toy.
 *
 * Note there is no prompt box driving these. Shipping "describe your vibe" as
 * the front door is a blank-page problem, and one mediocre first prompt kills
 * the impression permanently. Named rooms first; the prompt is an escape hatch.
 */

const ashenKeep: VibeSpec = {
  id: 'ashen-keep',
  label: 'Ashen Keep',
  user_prompt: 'dark fantasy with retro game graphics',
  render_style: 'pixel_art',
  internal: [480, 270],
  archetype: 'interior_firelight',
  seed: 1207,
  // Only `subject` and `light_source` exist in this pack; every other slot
  // falls back to its painter. Partial packs are the normal case, not an edge
  // case — it is also what per-slot reroll will look like later.
  pack: '/packs/dev-fixtures/pack.json',
  palette: {
    base: '#0e0a10',
    surface: '#2a2028',
    primary: '#8b3a3a',
    accent: '#d4b483',
    text: '#e8dcc8',
    ramp: [
      '#0e0a10', '#1c1419', '#2a2028', '#4a3a3a',
      '#8b3a3a', '#c47a3a', '#d4b483', '#e8dcc8',
    ],
  },
  layers: [
    { slot: 'backdrop', asset: 'stone_wall_mossy', prompt: 'mortared stone dungeon wall, damp, torchlit' },
    { slot: 'floor', asset: 'earth_floor', prompt: 'packed earth floor with scattered gravel' },
    { slot: 'foliage', asset: 'grass_tufts', prompt: 'sparse dark grass growing through the floor' },
    { slot: 'subject', asset: 'knight_resting', prompt: 'plate-armoured knight seated against a wall, sword laid down', params: { cx: 0.66, cy: 0.87, scale: 0.3 } },
    { slot: 'light_source', asset: 'campfire_stones', prompt: 'small ringed campfire, stones around the edge', params: { cx: 0.28, cy: 0.88, scale: 0.06, flame_scale: 0.8, flame_base: 0.45 } },
    { slot: 'light_pool', asset: 'radial_glow', alpha: 0.75, params: { cx: 0.28, cy: 0.78, radius: 0.85, tone: 0.66 } },
    { slot: 'particles', asset: '_generative_embers', params: { cx: 0.28, cy: 0.86, rate: 16 } },
    { slot: 'ambient_grade', asset: 'flat_grade', alpha: 0.28, params: { tone: 0.82 } },
  ],
  audio: {
    root: 'D2',
    scale: 'aeolian',
    textures: ['fire_crackle', 'room_air'],
    motif: { instrument: 'pluck', density_per_min: 9, gain_db: -16 },
    lowpass_hz: 4200,
    reverb: { size: 0.7, wet: 0.25 },
    bed_gain_db: -22,
    // Fixture pack: exercises the Player, GrainPlayer and Sampler paths. The
    // drone bed still comes from synthesis, which is the partial-override case.
    pack: '/audio/dev-fixtures/pack.json',
  },
  arc: {
    minutes: 25,
    shape: 'settle',
    energy_start: 1,
    energy_end: 0.42,
    warmth_start: 1,
    warmth_end: 0.55,
  },
};

const paperValley: VibeSpec = {
  id: 'paper-valley',
  label: 'Paper Valley',
  user_prompt: 'quiet ink-wash valley at dusk, wide and cold',
  render_style: 'smooth',
  internal: [960, 540],
  archetype: 'exterior_landscape',
  seed: 4409,
  palette: {
    base: '#0b1418',
    surface: '#1f3a3d',
    primary: '#356063',
    accent: '#8fb8a8',
    text: '#eef2e6',
    ramp: [
      '#0b1418', '#14262b', '#1f3a3d', '#356063',
      '#5c8f87', '#8fb8a8', '#c3d8c8', '#eef2e6',
    ],
  },
  layers: [
    { slot: 'sky', asset: 'sky_gradient', prompt: 'wide dusk sky, cold, ink-wash gradient' },
    { slot: 'stars', asset: 'star_field', alpha: 0.6 },
    { slot: 'clouds', asset: 'cloud_band', alpha: 0.55, params: { speed: 5 } },
    { slot: 'ridge_far', asset: 'ridge', params: { baseline: 0.5, amp: 0.07, tone: 0.34, scale: 0.007 } },
    { slot: 'ridge_near', asset: 'ridge', params: { baseline: 0.66, amp: 0.05, tone: 0.15, scale: 0.014 } },
    { slot: 'water', asset: 'water_band', params: { top: 0.78 } },
    { slot: 'foliage', asset: 'reeds', params: { base: 0.83 } },
    { slot: 'ambient_grade', asset: 'flat_grade', alpha: 0.35, params: { tone: 0.72 } },
  ],
  audio: {
    root: 'A2',
    scale: 'dorian',
    textures: ['wind', 'water'],
    motif: { instrument: 'bell', density_per_min: 5, gain_db: -20 },
    lowpass_hz: 6000,
    reverb: { size: 0.85, wet: 0.35 },
    bed_gain_db: -24,
  },
  arc: {
    minutes: 30,
    shape: 'settle',
    energy_start: 1,
    energy_end: 0.5,
    warmth_start: 1,
    warmth_end: 0.62,
  },
};

const signalDrift: VibeSpec = {
  id: 'signal-drift',
  label: 'Signal Drift',
  user_prompt: 'weightless, deep, nothing to look at directly',
  render_style: 'smooth',
  internal: [960, 540],
  archetype: 'abstract_field',
  seed: 8821,
  palette: {
    base: '#05060f',
    surface: '#141d3d',
    primary: '#22345e',
    accent: '#4fa3b8',
    text: '#dff6f4',
    ramp: [
      '#05060f', '#0b1024', '#141d3d', '#22345e',
      '#356a8a', '#4fa3b8', '#8fd6dc', '#dff6f4',
    ],
  },
  layers: [
    { slot: 'backdrop', asset: 'flat_base', params: { tone: 0.03 } },
    { slot: 'field', asset: '_generative_flow' },
    { slot: 'particles', asset: '_generative_drift', params: { count: 90 } },
    { slot: 'bloom', asset: 'radial_glow', alpha: 0.3, params: { cx: 0.5, cy: 0.52, radius: 0.7, tone: 0.6 } },
    { slot: 'ambient_grade', asset: 'flat_grade', alpha: 0.25, params: { tone: 0.8 } },
  ],
  audio: {
    root: 'E2',
    scale: 'lydian',
    textures: ['room_air'],
    motif: { instrument: 'bell', density_per_min: 3, gain_db: -22 },
    lowpass_hz: 3000,
    reverb: { size: 0.95, wet: 0.45 },
    bed_gain_db: -20,
  },
  arc: {
    minutes: 45,
    shape: 'steady',
    energy_start: 0.9,
    energy_end: 0.45,
    warmth_start: 1,
    warmth_end: 0.7,
  },
};

const pixelBroadcast: VibeSpec = {
  id: 'pixel-broadcast',
  label: 'Pixel Broadcast',
  user_prompt: 'poetic 16-bit coastal night, distant signal, quiet wonder',
  render_style: 'pixel_art',
  internal: [480, 270],
  archetype: 'exterior_landscape',
  seed: 6813,
  palette: {
    base: '#071327', surface: '#142b4d', primary: '#385b91', accent: '#f1b767', text: '#f8edcf',
    ramp: ['#071327', '#0c1d38', '#142b4d', '#203d69', '#385b91', '#6f83b5', '#b8add0', '#f8edcf'],
  },
  layers: [],
  audio: {
    root: 'D2',
    scale: 'major_pentatonic',
    textures: ['wind', 'water'],
    motif: { instrument: 'bell', density_per_min: 4, gain_db: -21 },
    lowpass_hz: 5200,
    reverb: { size: 0.88, wet: 0.38 },
    bed_gain_db: -25,
  },
  arc: {
    minutes: 35,
    shape: 'settle',
    energy_start: 0.72,
    energy_end: 0.38,
    warmth_start: 0.9,
    warmth_end: 0.62,
  },
};

export const VIBES: VibeSpec[] = [ashenKeep, paperValley, signalDrift, pixelBroadcast];
