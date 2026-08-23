import type { LivingEffect, LivingStillManifest, NormalizedRegion } from './types';

export interface SceneObservation {
  fire?: NormalizedRegion;
  exterior?: NormalizedRegion;
  sky?: NormalizedRegion;
}

/**
 * Deterministic local planner used immediately and as the validated target
 * schema for an LLM planner later. It selects trusted recipes before any
 * generated shader, so automatic mode stays cheap and predictable.
 */
export function orchestrateLivingStill(intent: string, observed: SceneObservation): LivingStillManifest {
  const text = intent.toLowerCase();
  const motion = /dramatic|violent|intense|heavy/.test(text) ? 'dramatic' : /subtle|quiet|calm|slight|gentle/.test(text) ? 'subtle' : 'balanced';
  const scale = motion === 'dramatic' ? 0.85 : motion === 'subtle' ? 0.38 : 0.58;
  const effects: LivingEffect[] = [];
  if (observed.fire && /fire|flame|brazier|candle|lantern|hearth/.test(text)) {
    effects.push({ id: 'intent-fire', kind: 'fire', region: observed.fire, intensity: scale, speed: 0.75, enabled: true, color: '#ffad42' });
    effects.push({ id: 'intent-fire-glow', kind: 'light-flicker', region: observed.fire, intensity: scale * 0.65, speed: 0.55, enabled: true, color: '#ff9b38' });
  }
  const weatherRegion = observed.exterior ?? observed.sky;
  if (weatherRegion && /rain|storm|drizzle|wet/.test(text)) {
    effects.push({ id: 'intent-rain', kind: 'rain', region: weatherRegion, intensity: scale, speed: 0.7, enabled: true, color: '#a9c9e8' });
  }
  return {
    version: 1,
    intent,
    motion,
    effects: effects.slice(0, 4),
    audio: {
      textures: [
        ...(/fire|flame|brazier|hearth/.test(text) ? ['fire_crackle' as const] : []),
        ...(/rain|storm|drizzle/.test(text) ? ['rain' as const] : []),
      ],
      events: /owl/.test(text) ? [{ id: 'intent-owl', kind: 'owl', minIntervalSeconds: 70, maxIntervalSeconds: 190, gain: 0.2, pan: -0.55, enabled: true }] : [],
      musicMood: /dark|fantasy|storm|lonely|melanchol|ominous/.test(text) ? 'dark_ambient' : /warm|cozy|safe|shelter/.test(text) ? 'warm_ambient' : 'minimal',
      musicDirection: 'Restrained environmental ambient score matching the scene’s emotional weight; stable, unresolved, sparse, and suitable for seamless repetition.',
    },
    confidence: effects.length ? 0.9 : 0.45,
    rationale: effects.length ? 'Matched visible semantic regions to trusted lightweight motion and ambience recipes.' : 'No trusted region/effect match; a generated shader or video may be needed.',
  };
}
