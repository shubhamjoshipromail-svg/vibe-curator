import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export const NATIVE_DOWNLOAD_PATH = '/downloads/mac/latest';
export const NATIVE_RELEASES_URL = 'https://github.com/shubhamjoshipromail-svg/vibe-curator/releases';
export const FALLBACK_DMG_URL = 'https://github.com/shubhamjoshipromail-svg/vibe-curator/releases/download/v0.1.1-beta.4/Vibe-Curator-0.1.1-beta.4-arm64-technical-tester-unnotarized.dmg';

const RELEASES_API_URL = 'https://api.github.com/repos/shubhamjoshipromail-svg/vibe-curator/releases?per_page=20';
const CACHE_TTL_MS = 10 * 60_000;

type GitHubAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

type GitHubRelease = {
  draft?: unknown;
  published_at?: unknown;
  created_at?: unknown;
  assets?: unknown;
};

let cachedDownload: { url: string; expiresAt: number } | undefined;

function validAssetUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith('/shubhamjoshipromail-svg/vibe-curator/releases/download/');
  } catch {
    return false;
  }
}

/** Selects the newest published, non-draft DMG. Prereleases are intentional. */
export function latestMacDmg(releases: unknown): string | undefined {
  if (!Array.isArray(releases)) return undefined;
  return (releases as GitHubRelease[])
    .filter((release) => release.draft !== true && Array.isArray(release.assets))
    .sort((a, b) => {
      const aDate = Date.parse(typeof a.published_at === 'string' ? a.published_at : String(a.created_at ?? '')) || 0;
      const bDate = Date.parse(typeof b.published_at === 'string' ? b.published_at : String(b.created_at ?? '')) || 0;
      return bDate - aDate;
    })
    .flatMap((release) => (release.assets as GitHubAsset[])
      .filter((asset) => typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.dmg'))
      .sort((a, b) => Number(String(b.name).toLowerCase().includes('arm64')) - Number(String(a.name).toLowerCase().includes('arm64'))))
    .map((asset) => asset.browser_download_url)
    .find(validAssetUrl);
}

async function resolveLatestDmg(): Promise<string> {
  const now = Date.now();
  if (cachedDownload && cachedDownload.expiresAt > now) return cachedDownload.url;

  try {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'vibe-curator-download-resolver',
      'x-github-api-version': '2022-11-28',
    };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(RELEASES_API_URL, { headers, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`GitHub releases request failed (${response.status})`);
    const selected = latestMacDmg(await response.json());
    if (!selected) throw new Error('No published DMG was found');
    cachedDownload = { url: selected, expiresAt: now + CACHE_TTL_MS };
    return selected;
  } catch (error) {
    console.warn('Using the pinned Mac DMG fallback:', error instanceof Error ? error.message : error);
    return FALLBACK_DMG_URL;
  }
}

async function redirectToLatestDmg(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  let pathname: string;
  try { pathname = new URL(req.url ?? '/', 'http://vibe-curator.local').pathname; } catch { return next(); }
  if (pathname !== NATIVE_DOWNLOAD_PATH) return next();
  if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, HEAD');
    res.end();
    return;
  }
  res.statusCode = 302;
  res.setHeader('location', await resolveLatestDmg());
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', '0');
  res.end();
}

export function nativeDownloadPlugin(): Plugin {
  return {
    name: 'vibe-native-download',
    configureServer(server) {
      server.middlewares.use((req, res, next) => { void redirectToLatestDmg(req, res, next); });
    },
  };
}
