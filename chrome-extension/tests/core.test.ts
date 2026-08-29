import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET, DEFAULT_STATE, commitAfterAudio, isTrustedExternalSender, nextState, validateExternalRequest,
  validateInternalRequest, validatePreset, validateState,
} from '../src/core';

function preset() { return structuredClone(DEFAULT_PRESET); }

describe('preset validation', () => {
  it('accepts the safe built-in projection', () => { expect(validatePreset(preset()).id).toBe('signal-drift'); });

  it('accepts only exact first-party curated media paths', () => {
    const value = preset();
    value.scene = {
      kind: 'image', label: 'Broadcast', style: 'Pixel Art',
      url: 'https://vibe-curator-production.up.railway.app/market/styles/pixel-last-broadcast.png',
    };
    value.trackUrl = 'https://vibe-curator-production.up.railway.app/audio/curated/last-broadcast.mp3';
    expect(validatePreset(value).scene.kind).toBe('image');
  });

  it.each([
    'http://vibe-curator-production.up.railway.app/market/styles/a.png',
    'https://evil.example/market/styles/a.png',
    'data:image/png;base64,AAAA',
    'https://vibe-curator-production.up.railway.app/market/styles/a.png?next=evil',
    'https://vibe-curator-production.up.railway.app/private/a.png',
  ])('rejects unsafe image URL %s', (url) => {
    const value = preset() as unknown as Record<string, unknown>;
    value.scene = { kind: 'image', label: 'Unsafe', style: 'test', url };
    expect(() => validatePreset(value)).toThrow();
  });

  it('rejects unknown executable or private fields', () => {
    expect(() => validatePreset({ ...preset(), effects: [{ glsl: 'void main(){}' }] })).toThrow(/unsupported field/);
    expect(() => validatePreset({ ...preset(), assetId: 'private_asset' })).toThrow(/unsupported field/);
  });

  it('rejects malformed nested values and prototypes', () => {
    expect(() => validatePreset({ ...preset(), controls: { ...preset().controls, motion: Number.NaN } })).toThrow();
    expect(() => validatePreset({ ...preset(), palette: { ...preset().palette, ramp: ['#000000'] } })).toThrow();
    expect(() => validatePreset(Object.assign(Object.create({ inherited: true }), preset()))).toThrow(/plain object/);
  });
});

describe('message and state validation', () => {
  it('validates a versioned external handoff', () => {
    const request = validateExternalRequest({ v: 1, type: 'vibe:set-preset', requestId: 'web_12345678', preset: preset() });
    expect(request.requestId).toBe('web_12345678');
  });

  it('rejects unknown message fields and sound unlock over external protocol', () => {
    expect(() => validateExternalRequest({ v: 1, type: 'vibe:set-preset', requestId: 'web_12345678', preset: preset(), enableSound: true })).toThrow();
    expect(() => validateExternalRequest({ v: 1, type: 'enable-sound', requestId: 'web_12345678' })).toThrow();
  });

  it('validates internal controls strictly', () => {
    expect(validateInternalRequest({ v: 1, target: 'service-worker', type: 'set-volume', requestId: 'ui_12345678', volume: 0.4 }).type).toBe('set-volume');
    expect(() => validateInternalRequest({ v: 1, target: 'service-worker', type: 'set-volume', requestId: 'ui_12345678', volume: Infinity })).toThrow();
    expect(validateInternalRequest({ v: 1, target: 'service-worker', type: 'set-enabled', requestId: 'ui_12345678', enabled: false }).type).toBe('set-enabled');
    expect(() => validateInternalRequest({ v: 1, target: 'service-worker', type: 'set-google-search', requestId: 'ui_12345678', enabled: 'yes' })).toThrow();
  });

  it('increments revisions without unlocking sound implicitly', () => {
    const changed = nextState(DEFAULT_STATE, { preset: preset() }, new Date('2026-08-25T00:00:00.000Z'));
    expect(changed.revision).toBe(1);
    expect(changed.playback.soundUnlocked).toBe(false);
    expect(validateState(changed)).toEqual(changed);
  });

  it('migrates existing state to safe feature defaults', () => {
    const old = structuredClone(DEFAULT_STATE) as unknown as Record<string, unknown>;
    delete old.features;
    expect(validateState(old).features).toEqual({ enabled: true, googleSearchBackground: false });
  });

  it('requires both exact origin and URL for website senders', () => {
    const origin = 'https://vibe-curator-production.up.railway.app';
    expect(isTrustedExternalSender(origin, `${origin}/explore?collection=pixel-art`)).toBe(true);
    expect(isTrustedExternalSender('https://evil.example', `${origin}/explore`)).toBe(false);
    expect(isTrustedExternalSender(origin, 'https://evil.example/')).toBe(false);
  });

  it('acknowledges state only after audio and storage complete', async () => {
    const events: string[] = [];
    const next = nextState(DEFAULT_STATE, { soundUnlocked: true, desiredPlaying: true });
    await expect(commitAfterAudio(
      next,
      async () => { events.push('audio'); },
      async () => { events.push('storage'); },
    )).resolves.toEqual(next);
    expect(events).toEqual(['audio', 'storage']);
  });

  it('does not persist or acknowledge when audio rejects', async () => {
    let persisted = false;
    await expect(commitAfterAudio(
      DEFAULT_STATE,
      async () => { throw new Error('audio blocked'); },
      async () => { persisted = true; },
    )).rejects.toThrow('audio blocked');
    expect(persisted).toBe(false);
  });
});
