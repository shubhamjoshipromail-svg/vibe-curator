export type DeepLinkActivation = { presetId: string } | { token: string };

function activationFromDeepLink(value: string): DeepLinkActivation | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'vibecurator:' || url.hostname !== 'open') return undefined;
    const token = url.searchParams.get('activation') ?? '';
    if (/^[a-f0-9]{64}$/.test(token)) return { token };
    const presetId = url.searchParams.get('preset') ?? '';
    return /^[a-zA-Z0-9_-]{1,160}$/.test(presetId) ? { presetId } : undefined;
  } catch { return undefined; }
}

export async function registerDeepLinks(openPreset: (activation: DeepLinkActivation) => Promise<void>): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const handle = (urls: string[]) => {
    for (const value of urls) {
      const activation = activationFromDeepLink(value);
      if (activation) void openPreset(activation);
    }
  };
  handle((await getCurrent()) ?? []);
  await onOpenUrl(handle);
}
