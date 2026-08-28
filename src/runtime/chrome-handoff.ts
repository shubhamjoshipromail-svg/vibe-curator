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

/** Deliberately excludes effects, private assets, arbitrary media URLs and provenance. */
export function projectPresetForChrome(preset: ChromeVibeInput): ChromeVibePreset | null {
  const origin = 'https://vibe-curator-production.up.railway.app';
  let scene: ChromeVibePreset['scene'];
  if (preset.scene.kind === 'image') {
    if (preset.scene.assetId || !preset.scene.url || !/^\/market\/styles\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(preset.scene.url)) return null;
    scene = { kind: 'image', label: preset.scene.label, style: preset.scene.style, url: `${origin}${preset.scene.url}` };
  } else if (preset.scene.kind === 'procedural') {
    scene = { kind: 'procedural' as const, label: preset.scene.label, style: preset.scene.style, sourceId: preset.scene.sourceId };
  } else if (preset.scene.kind === 'renderer') {
    scene = { kind: 'renderer' as const, label: preset.scene.label, style: preset.scene.style };
  } else return null;
  const trackUrl = preset.music?.url && /^\/audio\/curated\/[a-z0-9][a-z0-9._-]*\.mp3$/i.test(preset.music.url)
    ? `${origin}${preset.music.url}` : undefined;
  if (preset.music?.url && !trackUrl) return null;
  return {
    id: preset.id, name: preset.name, description: preset.description, baseVibeId: preset.baseVibeId,
    scene, palette: { ...preset.palette, ramp: [...preset.palette.ramp] },
    controls: { ...preset.controls },
    audio: structuredClone(preset.audio), trackUrl,
  };
}

function requestId(): string { return `web_${crypto.randomUUID().replaceAll('-', '')}`; }

export async function setAsChromeVibe(preset: ChromeVibeInput): Promise<ChromeHandoffResult> {
  const safePreset = projectPresetForChrome(preset);
  if (!safePreset) return { ok: false, message: 'Chrome Vibe supports coded scenes, not private media.' };
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
