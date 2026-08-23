import type { LivingStillManifest } from './types';

async function imageDataUrl(source: string): Promise<string> {
  const response = await fetch(source);
  if (!response.ok) throw new Error('The source image could not be loaded for analysis.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob);
  });
}

export async function directLivingStill(intent: string, source: string): Promise<LivingStillManifest> {
  const response = await fetch('/api/living-director', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent, imageDataUrl: await imageDataUrl(source) }),
  });
  const body = await response.json() as Partial<LivingStillManifest> & { message?: string };
  if (!response.ok) throw new Error(body.message ?? 'The scene director is unavailable.');
  return {
    version: 1, intent, motion: body.motion ?? 'subtle', effects: (body.effects ?? []).map((effect) => ({ ...effect, enabled: true })),
    audio: { textures: body.audio?.textures ?? [], events: (body.audio?.events ?? []).map((event) => ({ ...event, enabled: true })), musicMood: body.audio?.musicMood, musicDirection: body.audio?.musicDirection },
    confidence: body.confidence ?? 0.5, rationale: body.rationale ?? 'Selected from trusted Living Still recipes.',
  };
}
