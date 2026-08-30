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

/**
 * Hard server-side ceilings used before any paid provider request is started.
 *
 * INVARIANT: the per-user daily cap must exceed the maximum spend achievable
 * with a full credit balance, or the credit balance is a lie.
 *
 * 100 welcome credits buy at most ~$2.71 (12 music generations at 8 credits and
 * $0.226 each) or ~$2.33 (one 60-credit motion draft plus five music). The old
 * $1 default stopped a user after four music generations while the UI still
 * advertised twelve, which is the reported "100 credits, not enough credits"
 * bug. $4 sits above the credit ceiling, so credits are the real limit and
 * these remain what they are meant to be: a safety net on the provider account.
 *
 * The global cap protects the owner's bill across every user at once. At $5 a
 * beta of ten users exhausted it in an afternoon; $50 leaves the per-user cap
 * as the binding constraint under normal load.
 */
export function generationBudgets(): { globalDailyUsd: number; userDailyUsd: number } {
  return {
    globalDailyUsd: positiveMoney('BETA_DAILY_SPEND_CAP_USD', 50),
    userDailyUsd: positiveMoney('BETA_USER_DAILY_SPEND_CAP_USD', 4),
  };
}

/**
 * Accounts exempt from credit and spend limits.
 *
 * Read only from server environment. Never from a request body, header, query
 * string, or any client-supplied claim — an allowlist that a caller can
 * influence is not an allowlist.
 */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Anonymous viewers carry no email and must never match, including when
 * ADMIN_EMAILS is unset or empty (both yield an empty allowlist).
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return adminEmails().has(normalized);
}

export function generationDisabledMessage(): string {
  return 'AI generation is paused for this free beta. Curated scenes, uploads, editing, playback, and the desktop wallpaper remain available.';
}
