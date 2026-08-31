import { describe, expect, it } from 'vitest';
import { validatePreset } from '../src/core';
import { projectPresetForChrome } from '../../src/runtime/chrome-handoff';

/**
 * Generated visuals are private, owner-scoped media. They reach the extension
 * as inline bytes rather than as a URL, so nothing has to be published and no
 * token can expire out from under a saved new tab.
 *
 * These tests pin the boundary: raster data URLs in, everything else out.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const ORIGIN = 'https://vibe-curator-production.up.railway.app';
/** The validator requires exactly eight ramp entries. */
const RAMP = ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'];

type Scene = { kind: string; label: string; style: string; sourceId?: string; url?: string; assetId?: string };

function baseInput(scene: Scene) {
  return {
    id: 'project_abc', name: 'Room', description: 'A room', baseVibeId: 'ashen-keep',
    scene,
    palette: { base: '#000000', surface: '#111111', primary: '#222222', accent: '#333333', text: '#ffffff', ramp: [...RAMP] },
    controls: { mood: 0.5, motion: 0.5, depth: 0.5, glow: 0.5, atmosphere: 0.5, intensity: 0.5 },
    audio: { ambience: { gain: 0.4, muted: false }, music: { gain: 0.65, muted: false }, master: { gain: 0.8, muted: false } },
  };
}

function sceneOf(preset: ReturnType<typeof projectPresetForChrome>) {
  if (!preset) throw new Error('preset was rejected');
  return preset.scene;
}

describe('private media handoff', () => {
  it('accepts a generated visual when its bytes are supplied', () => {
    const input = baseInput({ kind: 'image', label: 'Alley', style: 'cinematic', assetId: 'asset_123' });
    const projected = projectPresetForChrome(input, PNG);
    expect(sceneOf(projected).url).toBe(PNG);
  });

  it('still refuses a private asset when no bytes are supplied', () => {
    const input = baseInput({ kind: 'image', label: 'Alley', style: 'cinematic', assetId: 'asset_123' });
    expect(projectPresetForChrome(input)).toBeNull();
  });

  it('refuses an oversized payload rather than blowing the storage quota', () => {
    const huge = `data:image/png;base64,${'A'.repeat(6_000_001)}`;
    const input = baseInput({ kind: 'image', label: 'Alley', style: 'cinematic', assetId: 'asset_123' });
    expect(projectPresetForChrome(input, huge)).toBeNull();
  });

  it('refuses a non-raster or script-bearing data URL', () => {
    const input = baseInput({ kind: 'image', label: 'Alley', style: 'cinematic', assetId: 'asset_123' });
    for (const bad of [
      'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=',
      'data:text/html;base64,PGh0bWw+',
      'data:image/png,notbase64',
      'javascript:alert(1)',
    ]) {
      expect(projectPresetForChrome(input, bad)).toBeNull();
    }
  });

  it('still allows a bundled market image with no bytes', () => {
    const input = baseInput({ kind: 'image', label: 'Pixel', style: 'Pixel Art', url: '/market/styles/pixel-art.jpg' });
    expect(sceneOf(projectPresetForChrome(input)).url).toBe(`${ORIGIN}/market/styles/pixel-art.jpg`);
  });
});

describe('extension-side validation', () => {
  const preset = (url: string) => ({
    id: 'project_abc', name: 'Room', description: 'A room', baseVibeId: 'ashen-keep',
    scene: { kind: 'image', label: 'Alley', style: 'cinematic', url },
    palette: { base: '#000000', surface: '#111111', primary: '#222222', accent: '#333333', text: '#ffffff', ramp: [...RAMP] },
    controls: { mood: 0.5, motion: 0.5, depth: 0.5, glow: 0.5, atmosphere: 0.5, intensity: 0.5 },
    audio: { ambience: { gain: 0.4, muted: false }, music: { gain: 0.65, muted: false }, master: { gain: 0.8, muted: false } },
    trackUrl: undefined,
  });

  it('accepts inline raster bytes', () => {
    const { scene } = validatePreset(preset(PNG));
    if (scene.kind !== 'image') throw new Error('expected an image scene');
    expect(scene.url).toBe(PNG);
  });

  it('rejects an inline SVG, which is a script surface', () => {
    expect(() => validatePreset(preset('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')))
      .toThrow(/not an approved format/);
  });

  it('rejects an oversized data URL', () => {
    expect(() => validatePreset(preset(`data:image/png;base64,${'A'.repeat(6_000_001)}`))).toThrow();
  });

  it('keeps rejecting an untrusted https origin', () => {
    expect(() => validatePreset(preset('https://evil.example/x.png'))).toThrow(/approved Vibe Curator asset/);
  });
});
