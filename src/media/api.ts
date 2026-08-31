import type { MasterReport, MusicBrief, PlaybackPlan, SceneAudioContext } from '../audio/brief';

export interface MediaCapabilities {
  sceneGeneration: boolean;
  motionGeneration?: boolean;
  musicGeneration: boolean;
  musicPromptAdaptation?: boolean;
  elevenMusicConfigured?: boolean;
  lyriaMusicConfigured?: boolean;
  defaultMusicProvider?: 'lyria' | 'elevenlabs';
  musicProviders?: {
    lyria: { available: boolean; enabled: boolean; premiumOnly: false; model: string; costUsd: number; durationSeconds: number };
    elevenlabs: { available: boolean; enabled: boolean; premiumOnly: true; model: string; costUsd: number; durationSeconds: number };
  };
  musicPromptTranslatorConfigured?: boolean;
  /** v2 is the default; v1 remains available only as an explicit compatibility mode. */
  pipelineVersion?: 'v1' | 'v2';
  imageProvider?: string;
  imageModel?: string;
  motionModel?: string;
  musicModel?: string;
  estimatedCostsUsd?: { image: number; motionDraft: number; music: number };
  estimatedSpendUsd?: number;
  spendCapUsd?: number;
}

export interface GeneratedVisual {
  blob: Blob;
  mimeType: string;
  model: string;
  provider: string;
  prompt: string;
  durationSeconds?: number;
  estimatedCostUsd?: number;
}

export interface GeneratedMusic {
  blob: Blob;
  mimeType: string;
  model: string;
  provider: string;
  durationSeconds?: number;
  adaptedPrompt?: string;
  promptProvider?: string;
  promptModel?: string;
  estimatedCostUsd?: number;
  vocalMode?: 'vocals' | 'instrumental';
  /** Present only on the v2 mastered pipeline; absent on v1. */
  masterReport?: MasterReport;
  playback?: PlaybackPlan;
  degraded?: boolean;
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // The consumer never needs a provider payload; details stay in server logs.
  }
  return 'The media service is unavailable right now.';
}

export async function mediaCapabilities(): Promise<MediaCapabilities> {
  const res = await fetch('/api/media/status');
  if (!res.ok) return { sceneGeneration: false, musicGeneration: false };
  return (await res.json()) as MediaCapabilities;
}

function decodeMedia(body: {
  data: string;
  mimeType: string;
  model: string;
  provider: string;
  prompt: string;
  durationSeconds?: number;
  estimatedCostUsd?: number;
}): GeneratedVisual {
  const bytes = Uint8Array.from(atob(body.data), (char) => char.charCodeAt(0));
  return {
    blob: new Blob([bytes], { type: body.mimeType }),
    mimeType: body.mimeType,
    model: body.model,
    provider: body.provider,
    prompt: body.prompt,
    durationSeconds: body.durationSeconds,
    estimatedCostUsd: body.estimatedCostUsd,
  };
}

export async function generateSceneImage(prompt: string, style: string): Promise<GeneratedVisual> {
  const res = await fetch('/api/media/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ prompt, style }),
  });
  if (!res.ok) throw new Error(await safeMessage(res));
  return decodeMedia(await res.json());
}

export async function generateSceneMotion(
  prompt: string,
  image: Blob,
): Promise<GeneratedVisual> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(image);
  });
  const res = await fetch('/api/media/motion', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ prompt, imageData: data, mimeType: image.type || 'image/png' }),
  });
  if (!res.ok) throw new Error(await safeMessage(res));
  return decodeMedia(await res.json());
}

export interface MusicRequest {
  provider: 'lyria' | 'elevenlabs';
  brief: MusicBrief;
  /** The user's own words. Empty is valid: the brief still carries direction. */
  userRequest: string;
  vocalMode: 'auto' | 'vocals' | 'instrumental';
  sceneContext?: SceneAudioContext;
  /**
   * Backwards-compatible text for older servers. Current servers consume the
   * structured `brief` and allow this to be absent when the user typed nothing.
   */
  prompt?: string;
}

/** Vendor-neutral client call. Labs asks for music, not for a specific SDK. */
export async function generateMusic(request: MusicRequest): Promise<GeneratedMusic> {
  const res = await fetch('/api/media/music', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await safeMessage(res));

  const body = (await res.json()) as {
    data: string;
    mimeType: string;
    model: string;
    provider: string;
    durationSeconds?: number;
    adaptedPrompt?: string;
    promptProvider?: string;
    promptModel?: string;
    estimatedCostUsd?: number;
    vocalMode?: 'vocals' | 'instrumental';
    masterReport?: MasterReport;
    playback?: PlaybackPlan;
    degraded?: boolean;
  };
  const bytes = Uint8Array.from(atob(body.data), (char) => char.charCodeAt(0));
  return {
    blob: new Blob([bytes], { type: body.mimeType }),
    mimeType: body.mimeType,
    model: body.model,
    provider: body.provider,
    durationSeconds: body.durationSeconds,
    adaptedPrompt: body.adaptedPrompt,
    promptProvider: body.promptProvider,
    promptModel: body.promptModel,
    estimatedCostUsd: body.estimatedCostUsd,
    vocalMode: body.vocalMode,
    masterReport: body.masterReport,
    playback: body.playback,
    degraded: body.degraded,
  };
}
