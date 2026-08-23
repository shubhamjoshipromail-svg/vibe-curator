export type LivingEffectKind = 'fire' | 'rain' | 'embers' | 'light-flicker' | 'fog' | 'dust';

export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LivingEffect {
  id: string;
  kind: LivingEffectKind;
  region: NormalizedRegion;
  /** Optional semantic polygon inside the bounding region; preferred over a coarse box. */
  mask?: Array<{ x: number; y: number }>;
  intensity: number;
  speed: number;
  enabled: boolean;
  color?: string;
}

export interface AmbientEvent {
  id: string;
  kind: 'owl' | 'bird' | 'thunder' | 'chime';
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  gain: number;
  pan?: number;
  enabled: boolean;
  assetUrls?: string[];
}

export interface LivingAudioPlan {
  textures: Array<'fire_crackle' | 'room_air' | 'wind' | 'rain' | 'water'>;
  events: AmbientEvent[];
  musicMood?: 'dark_ambient' | 'warm_ambient' | 'ethereal' | 'playful' | 'tense' | 'minimal';
  musicDirection?: string;
}

/** One document consumed by automatic creation, Labs and playback. */
export interface LivingStillManifest {
  version: 1;
  intent: string;
  motion: 'subtle' | 'balanced' | 'dramatic';
  effects: LivingEffect[];
  audio: LivingAudioPlan;
  confidence: number;
  rationale: string;
}
