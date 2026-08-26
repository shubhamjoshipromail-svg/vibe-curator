export type DeepLinkActivation = { presetId: string } | { token: string } | { controls: true };

/**
 * Parse one URL delivered by the native deep-link plugin.
 *
 * This stays exported so the release smoke test can exercise the exact
 * activation contract without booting a browser window or a Tauri runtime.
 */
export function activationFromDeepLink(value: string): DeepLinkActivation | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'vibecurator:') return undefined;
    if (url.hostname === 'controls') return { controls: true };
    if (url.hostname !== 'open') return undefined;
    const token = url.searchParams.get('activation') ?? '';
    if (/^[a-f0-9]{64}$/.test(token)) return { token };
    const presetId = url.searchParams.get('preset') ?? '';
    return /^[a-zA-Z0-9_-]{1,160}$/.test(presetId) ? { presetId } : undefined;
  } catch { return undefined; }
}

export async function registerDeepLinks(
  openPreset: (activation: DeepLinkActivation) => Promise<void>,
  includeCurrent = true,
): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const handle = (urls: string[]) => {
    for (const value of urls) {
      const activation = activationFromDeepLink(value);
      if (activation) void openPreset(activation);
    }
  };
  if (includeCurrent) handle((await getCurrent()) ?? []);
  await onOpenUrl(handle);
}
