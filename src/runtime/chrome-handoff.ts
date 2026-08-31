interface ChromeVibePalette {
  base: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
  ramp: string[];
}

interface ChromeVibeControls {
  mood: number;
  motion: number;
  depth: number;
  glow: number;
  atmosphere: number;
  intensity: number;
}

interface ChromeVibeAudio {
  ambience: { gain: number; muted: boolean };
  music: { gain: number; muted: boolean };
  master: { gain: number; muted: boolean };
}

/** Minimal structural contract so the isolated extension tests do not need the web renderer dependencies. */
export interface ChromeVibeInput {
  id: string;
  name: string;
  description: string;
  baseVibeId: string;
  scene: { kind: string; label: string; style: string; sourceId?: string; url?: string; assetId?: string };
  palette: ChromeVibePalette;
  controls: ChromeVibeControls;
  audio: ChromeVibeAudio;
  music?: { url?: string };
  baselineMusic?: { url?: string };
}

export interface ChromeVibePreset {
  id: string;
  name: string;
  description: string;
  baseVibeId: string;
  scene: { kind: 'renderer' | 'procedural' | 'image'; label: string; style: string; sourceId?: string; url?: string };
  palette: ChromeVibePalette;
  controls: ChromeVibeControls;
  audio: ChromeVibeAudio;
  trackUrl?: string;
}

export interface ChromeHandoffResult { ok: boolean; message: string }

const PRODUCTION_EXTENSION_ID = 'niamjnjkmfnlpcejieffodipboacfdnm';
const configuredExtensionId = import.meta.env.VITE_CHROME_EXTENSION_ID?.trim() || PRODUCTION_EXTENSION_ID;
const extensionId = configuredExtensionId && /^[a-p]{32}$/.test(configuredExtensionId) ? configuredExtensionId : undefined;

/** Base64 image payload the extension will store and render itself. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
/** ~4.5 MB of image bytes. Comfortably inside chrome.storage.local's 10 MB. */
const MAX_DATA_URL_CHARS = 6_000_000;

/**
 * Excludes effects, arbitrary media URLs and provenance.
 *
 * Private media is no longer excluded outright. A generated visual lives in
 * owner-scoped storage the extension cannot authenticate against, so rather
 * than publishing it to a URL, the bytes are handed over once and the extension
 * keeps its own copy — the same trade the native handoff already makes. Nothing
 * becomes publicly reachable, and there is no token to expire out from under a
 * new tab weeks later.
 */
export function projectPresetForChrome(
  preset: ChromeVibeInput,
  imageDataUrl?: string,
): ChromeVibePreset | null {
  const origin = 'https://vibe-curator-production.up.railway.app';
  let scene: ChromeVibePreset['scene'];
  if (preset.scene.kind === 'image') {
    if (imageDataUrl) {
      if (!DATA_IMAGE.test(imageDataUrl) || imageDataUrl.length > MAX_DATA_URL_CHARS) return null;
      scene = { kind: 'image', label: preset.scene.label, style: preset.scene.style, url: imageDataUrl };
    } else {
      if (preset.scene.assetId || !preset.scene.url || !/^\/market\/styles\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(preset.scene.url)) return null;
      scene = { kind: 'image', label: preset.scene.label, style: preset.scene.style, url: `${origin}${preset.scene.url}` };
    }
  } else if (preset.scene.kind === 'procedural') {
    scene = { kind: 'procedural' as const, label: preset.scene.label, style: preset.scene.style, sourceId: preset.scene.sourceId };
  } else if (preset.scene.kind === 'renderer') {
    scene = { kind: 'renderer' as const, label: preset.scene.label, style: preset.scene.style };
  } else return null;
  const selectedMusic = preset.music ?? preset.baselineMusic;
  // This is an allowlist; a preset whose URL fails it is rejected outright below.
  const trackUrl = selectedMusic?.url && /^\/audio\/curated\/[a-z0-9][a-z0-9._-]*\.mp3$/i.test(selectedMusic.url)
    ? `${origin}${selectedMusic.url}` : undefined;
  if (selectedMusic?.url && !trackUrl) return null;
  return {
    id: preset.id, name: preset.name, description: preset.description, baseVibeId: preset.baseVibeId,
    scene, palette: { ...preset.palette, ramp: [...preset.palette.ramp] },
    controls: { ...preset.controls },
    audio: structuredClone(preset.audio), trackUrl,
  };
}

function requestId(): string { return `web_${crypto.randomUUID().replaceAll('-', '')}`; }

/**
 * Read a private asset out of local/shared storage as a data URL.
 *
 * Dynamically imported so this module keeps no top-level web-renderer imports:
 * the extension's own test suite imports `projectPresetForChrome` from here and
 * must not have to stand up IndexedDB to do it.
 */
async function imageDataUrlFor(preset: ChromeVibeInput): Promise<string | undefined> {
  if (preset.scene.kind !== 'image' || !preset.scene.assetId) return undefined;
  const { getAsset } = await import('../media/assets');
  const blob = await getAsset(preset.scene.assetId);
  if (!blob) return undefined;
  return new Promise<string | undefined>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
}

export async function setAsChromeVibe(preset: ChromeVibeInput): Promise<ChromeHandoffResult> {
  let imageDataUrl: string | undefined;
  try {
    imageDataUrl = await imageDataUrlFor(preset);
  } catch (error) {
    console.warn('[vibe] could not read the scene image for Chrome', error);
  }

  if (preset.scene.kind === 'image' && preset.scene.assetId && !imageDataUrl) {
    return { ok: false, message: 'This scene image could not be read. Open it once in Labs, then try again.' };
  }
  if (imageDataUrl && imageDataUrl.length > MAX_DATA_URL_CHARS) {
    return { ok: false, message: 'This scene image is too large to send to Chrome. Use a smaller image.' };
  }

  const safePreset = projectPresetForChrome(preset, imageDataUrl);
  if (!safePreset) return { ok: false, message: 'Chrome Vibe could not accept this scene.' };
  if (!extensionId) return { ok: false, message: configuredExtensionId ? 'The Chrome extension ID is invalid.' : 'Chrome Vibe is not configured for this site.' };
  const chromeApi = (globalThis as { chrome?: { runtime?: { lastError?: { message?: string }; sendMessage?: (id: string, message: unknown, callback?: (response: unknown) => void) => void } } }).chrome;
  const runtime = chromeApi?.runtime;
  const sendMessage = runtime?.sendMessage?.bind(runtime);
  if (!runtime || !sendMessage) return { ok: false, message: 'Install the Vibe Curator Chrome extension to use this.' };
  const id = requestId();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ChromeHandoffResult) => { if (!settled) { settled = true; resolve(result); } };
    try {
      sendMessage(extensionId, { v: 1, type: 'vibe:set-preset', requestId: id, preset: safePreset }, (response) => {
        const lastError = runtime.lastError;
        const ack = response as { v?: number; ok?: boolean; requestId?: string; message?: string } | undefined;
        if (lastError) finish({ ok: false, message: `Chrome Vibe unavailable: ${lastError.message || 'connection failed'}` });
        else if (!ack || ack.v !== 1 || ack.requestId !== id || ack.ok !== true) finish({ ok: false, message: ack?.message || 'Chrome Vibe rejected this scene.' });
        else finish({ ok: true, message: 'Chrome Vibe updated.' });
      });
    } catch { finish({ ok: false, message: 'Chrome Vibe is unavailable.' }); }
  });
}
