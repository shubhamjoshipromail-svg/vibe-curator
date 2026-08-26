/**
 * Public application origin used by the packaged shell for account-client
 * initialization. No secret is embedded here; the native release grants IPC
 * access to this exact HTTPS origin in its Tauri capability manifest.
 */
export const DEPLOYED_APP_ORIGIN = 'https://vibe-curator-production.up.railway.app';

export function accountOrigin(): string {
  return location.protocol === 'tauri:' ? DEPLOYED_APP_ORIGIN : location.origin;
}

/**
 * Resolve an application API path from both the hosted site and the packaged
 * `tauri://localhost` renderer. Relative fetches from the packaged renderer
 * otherwise target Tauri's asset protocol instead of the Railway API.
 */
export function appApiUrl(path: string): string {
  if (!path.startsWith('/')) throw new Error('Application API paths must be absolute');
  return new URL(path, accountOrigin()).toString();
}

export function isBundledSurface(): boolean {
  return location.protocol === 'tauri:';
}
