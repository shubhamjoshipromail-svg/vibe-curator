export interface MediaCapabilities {
  sceneGeneration: boolean;
  musicGeneration: boolean;
  musicModel?: string;
}

export interface GeneratedMusic {
  blob: Blob;
  mimeType: string;
  model: string;
  provider: string;
  durationSeconds?: number;
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

/** Vendor-neutral client call. Labs asks for music, not for a specific SDK. */
export async function generateMusic(prompt: string): Promise<GeneratedMusic> {
  const res = await fetch('/api/media/music', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(await safeMessage(res));

  const body = (await res.json()) as {
    data: string;
    mimeType: string;
    model: string;
    provider: string;
    durationSeconds?: number;
  };
  const bytes = Uint8Array.from(atob(body.data), (char) => char.charCodeAt(0));
  return {
    blob: new Blob([bytes], { type: body.mimeType }),
    mimeType: body.mimeType,
    model: body.model,
    provider: body.provider,
    durationSeconds: body.durationSeconds,
  };
}
