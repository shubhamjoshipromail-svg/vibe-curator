/**
 * Public application origin used by the packaged shell for account-client
 * initialization. No secret is embedded here; the native release grants IPC
 * access to this exact HTTPS origin in its Tauri capability manifest.
 */
export const DEPLOYED_APP_ORIGIN = 'https://vibe-curator-production.up.railway.app';

export function accountOrigin(): string {
  return location.protocol === 'tauri:' ? DEPLOYED_APP_ORIGIN : location.origin;
}

export function isBundledSurface(): boolean {
  return location.protocol === 'tauri:';
}
