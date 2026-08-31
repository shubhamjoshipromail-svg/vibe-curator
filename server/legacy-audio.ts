import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** The public origin accepted by the published Chrome and native clients. */
export const CANONICAL_VIBE_ORIGIN = 'https://vibe-curator-production.up.railway.app';

/**
 * A deliberately finite migration table. Keep this separate from pack.json:
 * these names are compatibility inputs, not published assets.
 */
export const LEGACY_CURATED_AUDIO_REDIRECTS = Object.freeze({
  '/audio/curated/bioluminescent-koi.mp3': '/audio/curated/bioluminescent-koi-v2.mp3',
  '/audio/curated/electric-garden.mp3': '/audio/curated/electric-garden-v2.mp3',
  '/audio/curated/foggy-stone-shelter.mp3': '/audio/curated/foggy-stone-shelter-v2.mp3',
  '/audio/curated/gatehouse-rain.mp3': '/audio/curated/gatehouse-rain-v2.mp3',
  '/audio/curated/impressionist-water.mp3': '/audio/curated/impressionist-water-v2.mp3',
  '/audio/curated/japanese-water-garden.mp3': '/audio/curated/japanese-water-garden-v2.mp3',
  '/audio/curated/koi-pond.mp3': '/audio/curated/koi-pond-v2.mp3',
  '/audio/curated/last-broadcast.mp3': '/audio/curated/last-broadcast-v2.mp3',
  '/audio/curated/late-night-focus.mp3': '/audio/curated/late-night-focus-v2.mp3',
  '/audio/curated/luminous-current.mp3': '/audio/curated/luminous-current-v2.mp3',
  '/audio/curated/pixel-forest.mp3': '/audio/curated/pixel-forest-v2.mp3',
  '/audio/curated/smiling-through-rain.mp3': '/audio/curated/smiling-through-rain-v2.mp3',
} as const);

type CuratedAudioPack = { assets: Record<string, { file: string }> };

const curatedAudioPack = JSON.parse(
  readFileSync(new URL('../public/audio/curated/pack.json', import.meta.url), 'utf8'),
) as CuratedAudioPack;

/** Every deployed curated MP3 is explicitly admitted by the checked-in pack. */
const CURRENT_CURATED_AUDIO_PATHS = new Set(
  Object.values(curatedAudioPack.assets)
    .map(({ file }) => file)
    .filter((file) => /^[a-z0-9-]+-v2\.mp3$/.test(file))
    .map((file) => `/audio/curated/${file}`),
);

/**
 * Returns a redirect destination only for one of the twelve former paths.
 * Search parameters are intentionally rejected, matching Chrome handoff's
 * approved-media URL contract instead of creating a query-string side channel.
 */
export function legacyCuratedAudioRedirect(requestUrl: string | undefined): string | undefined {
  let url: URL;
  try { url = new URL(requestUrl ?? '/', 'http://vibe-curator.local'); } catch { return undefined; }
  if (url.search || url.hash) return undefined;
  return LEGACY_CURATED_AUDIO_REDIRECTS[url.pathname as keyof typeof LEGACY_CURATED_AUDIO_REDIRECTS];
}

export type CuratedAudioRequest =
  | { kind: 'redirect'; target: string }
  | { kind: 'pass' }
  | { kind: 'reject' };

/**
 * Vite's SPA fallback would otherwise turn a typo under /audio/curated into a
 * 200 HTML document. Restrict that namespace to the known v2 files and the
 * twelve exact legacy names, while leaving unrelated static routes alone.
 */
export function classifyCuratedAudioRequest(requestUrl: string | undefined): CuratedAudioRequest {
  const target = legacyCuratedAudioRedirect(requestUrl);
  if (target) return { kind: 'redirect', target };
  let url: URL;
  try { url = new URL(requestUrl ?? '/', 'http://vibe-curator.local'); } catch { return { kind: 'pass' }; }
  if (!url.pathname.startsWith('/audio/curated/') || !url.pathname.endsWith('.mp3')) return { kind: 'pass' };
  if (CURRENT_CURATED_AUDIO_PATHS.has(url.pathname)) return { kind: 'pass' };
  return { kind: 'reject' };
}

/**
 * Converts only known first-party curated paths into canonical absolute v2
 * URLs. Native Beta 3 otherwise resolves a relative v2 filename inside its
 * old app bundle, where the replacement bytes do not exist.
 */
export function canonicalCuratedAudioUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let url: URL;
  try { url = new URL(value, CANONICAL_VIBE_ORIGIN); } catch { return undefined; }
  if (url.search || url.hash || url.username || url.password) return undefined;
  if (url.origin !== CANONICAL_VIBE_ORIGIN) return undefined;
  const path = LEGACY_CURATED_AUDIO_REDIRECTS[url.pathname as keyof typeof LEGACY_CURATED_AUDIO_REDIRECTS]
    ?? (CURRENT_CURATED_AUDIO_PATHS.has(url.pathname) ? url.pathname : undefined);
  return path ? `${CANONICAL_VIBE_ORIGIN}${path}` : undefined;
}

/** Clone an activation preset while canonicalizing only its approved music URLs. */
export function canonicalizeActivationPreset(preset: Record<string, unknown>): Record<string, unknown> {
  const result = { ...preset };
  for (const key of ['music', 'baselineMusic'] as const) {
    const asset = preset[key];
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) continue;
    const record = asset as Record<string, unknown>;
    const url = canonicalCuratedAudioUrl(record.url);
    if (url) result[key] = { ...record, url };
  }
  return result;
}

function redirectLegacyAudio(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const request = classifyCuratedAudioRequest(req.url);
  if (request.kind === 'pass') return next();
  if (request.kind === 'redirect') {
    res.statusCode = 308;
    res.setHeader('location', request.target);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('content-length', '0');
    res.end();
    return;
  }
  res.statusCode = 404;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end('Curated audio not found.');
}

/**
 * Mounts before Vite's static and SPA middleware. Preview uses the repository's
 * previewApiBridge, which invokes this same configureServer hook after the
 * security middleware instead of registering the redirector twice.
 */
export function legacyCuratedAudioPlugin(): Plugin {
  return {
    name: 'vibe-legacy-curated-audio',
    configureServer(server) {
      server.middlewares.use(redirectLegacyAudio);
    },
  };
}
