import { Scene } from '../scene';
import { AudioEngine } from '../audio/engine';
import { VIBES } from '../vibes';
import { instantiate } from '../effects/generate';
import type { EffectFilter } from '../effects/filter';
import type { Preset } from '../preset/types';
import type { VibeSpec } from '../types';

/**
 * Shared application state.
 *
 * There is exactly one Scene and one AudioEngine for the whole app. Explore,
 * Labs and Player are three views onto the same running environment, not three
 * apps — which is why moving from Labs to Player is instant and continuous
 * rather than a reload.
 */
export interface AppState {
  scene: Scene;
  audio: AudioEngine;
  /** The preset currently loaded into the engine. */
  loaded: Preset | null;
  /** The unsaved edit in progress, if Labs is open. */
  draft: Preset | null;
  /** True once the user has interacted, which browsers require before audio. */
  started: boolean;
  /** Live filters by effect id, so Labs sliders can retune without rebuilding. */
  filters: Map<string, EffectFilter>;
}

export function createState(scene: Scene, audio: AudioEngine): AppState {
  return { scene, audio, loaded: null, draft: null, started: false, filters: new Map() };
}

export function vibeForPreset(preset: Preset): VibeSpec {
  const base = VIBES.find((v) => v.id === preset.baseVibeId) ?? VIBES[0];
  // The palette is the preset's, not the base scene's. Recolouring is the
  // cheapest and most dramatic customization available, so it is a first-class
  // override rather than a variant scene.
  return { ...base, palette: preset.palette };
}

/** Load a preset into the live engine: visuals, effects, controls and audio. */
export async function loadPreset(state: AppState, preset: Preset): Promise<void> {
  state.scene.clearAllEffects();
  state.filters.clear();

  await state.scene.setVibe(vibeForPreset(preset));
  state.scene.controls = { ...preset.controls };

  for (const manifest of preset.effects) {
    if (!manifest.enabled) continue;
    try {
      const { filter } = instantiate(manifest);
      state.scene.addEffect('scene', filter);
      state.filters.set(manifest.id, filter);
    } catch (err) {
      // One bad effect must never take the room down with it.
      console.warn(`[vibe] skipping effect "${manifest.name}":`, err);
    }
  }

  const base = VIBES.find((v) => v.id === preset.baseVibeId) ?? VIBES[0];
  if (state.started) await state.audio.setSpec(base.audio);
  syncAudioLayers(state, preset);

  state.loaded = preset;
}

export function syncAudioLayers(state: AppState, preset: Preset): void {
  for (const layer of ['ambience', 'music', 'master'] as const) {
    const s = preset.audio[layer];
    state.audio.setLayer(layer, s.gain, s.muted);
  }
}

/** Rebuild only the effect stack — used when Labs adds, removes or toggles one. */
export function reloadEffects(state: AppState, preset: Preset): void {
  state.scene.clearAllEffects();
  state.filters.clear();
  for (const manifest of preset.effects) {
    if (!manifest.enabled) continue;
    try {
      const { filter } = instantiate(manifest);
      state.scene.addEffect('scene', filter);
      state.filters.set(manifest.id, filter);
    } catch (err) {
      console.warn(`[vibe] skipping effect "${manifest.name}":`, err);
    }
  }
}
