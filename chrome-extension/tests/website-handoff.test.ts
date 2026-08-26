import { describe, expect, it } from 'vitest';
import { projectPresetForChrome } from '../../src/runtime/chrome-handoff';
import { DEFAULT_PRESET } from '../src/core';

function websitePreset(scene: Record<string, unknown>) {
  return {
    ...structuredClone(DEFAULT_PRESET),
    builtIn: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    effects: [],
    sourceEffects: [],
    scene,
  };
}

describe('website safe projection', () => {
  it('rejects video instead of silently substituting a renderer', () => {
    const value = websitePreset({
      kind: 'video', label: 'Private motion', style: 'cinematic',
      url: 'https://vibe-curator-production.up.railway.app/market/styles/pixel-last-broadcast.png',
    });
    expect(projectPresetForChrome(value as never)).toBeNull();
  });

  it('projects a public market image to the exact production origin', () => {
    const value = websitePreset({ kind: 'image', label: 'Broadcast', style: 'Pixel Art', url: '/market/styles/pixel-last-broadcast.png' });
    const projected = projectPresetForChrome(value as never);
    expect(projected?.scene).toEqual({
      kind: 'image', label: 'Broadcast', style: 'Pixel Art',
      url: 'https://vibe-curator-production.up.railway.app/market/styles/pixel-last-broadcast.png',
    });
  });

  it('rejects private image identifiers and arbitrary authored tracks', () => {
    expect(projectPresetForChrome(websitePreset({ kind: 'image', label: 'Private', style: 'test', assetId: 'private-1' }) as never)).toBeNull();
    const renderer = websitePreset({ kind: 'renderer', label: 'Room', style: 'procedural' });
    (renderer as unknown as Record<string, unknown>).music = { url: 'https://evil.example/track.mp3' };
    expect(projectPresetForChrome(renderer as never)).toBeNull();
  });
});
