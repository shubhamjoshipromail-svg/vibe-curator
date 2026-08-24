function presetFromDeepLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'vibecurator:' || url.hostname !== 'open') return undefined;
    const presetId = url.searchParams.get('preset') ?? '';
    return /^[a-zA-Z0-9_-]{1,160}$/.test(presetId) ? presetId : undefined;
  } catch { return undefined; }
}

export async function registerDeepLinks(openPreset: (presetId: string) => Promise<void>): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const handle = (urls: string[]) => {
    for (const value of urls) {
      const presetId = presetFromDeepLink(value);
      if (presetId) void openPreset(presetId);
    }
  };
  handle((await getCurrent()) ?? []);
  await onOpenUrl(handle);
}
