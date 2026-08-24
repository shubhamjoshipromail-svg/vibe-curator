import type { CreditOperation } from './credits';

export type GenerationMode = 'off' | 'light' | 'full';

export function billingEnabled(): boolean {
  return process.env.ENABLE_BILLING === 'true';
}

export function generationMode(): GenerationMode {
  const configured = process.env.BETA_GENERATION_MODE?.toLowerCase();
  if (configured === 'off' || configured === 'light' || configured === 'full') return configured;
  return process.env.NODE_ENV === 'production' ? 'off' : 'full';
}

export function generationAllowed(operation: CreditOperation): boolean {
  const overrideName: Record<CreditOperation, string> = {
    image: 'ENABLE_IMAGE_GENERATION',
    music: 'ENABLE_MUSIC_GENERATION',
    motion: 'ENABLE_MOTION_GENERATION',
    shader: 'ENABLE_SHADER_GENERATION',
    direction: 'ENABLE_DIRECTION_GENERATION',
  };
  const override = process.env[overrideName[operation]]?.toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;
  const mode = generationMode();
  if (mode === 'off') return false;
  if (mode === 'full') return true;
  return operation === 'shader' || operation === 'direction';
}

function positiveMoney(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Hard server-side ceilings used before any paid provider request is started. */
export function generationBudgets(): { globalDailyUsd: number; userDailyUsd: number } {
  return {
    globalDailyUsd: positiveMoney('BETA_DAILY_SPEND_CAP_USD', 5),
    userDailyUsd: positiveMoney('BETA_USER_DAILY_SPEND_CAP_USD', 1),
  };
}

export function generationDisabledMessage(): string {
  return 'AI generation is paused for this free beta. Curated scenes, uploads, editing, playback, and the desktop wallpaper remain available.';
}
