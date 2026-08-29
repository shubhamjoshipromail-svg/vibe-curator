import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRESET, PROTOCOL_VERSION, STORAGE_KEY } from '../src/core';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;

let internalListener: Listener;
let externalListener: Listener;
let audioShouldFail = false;
let createCount = 0;
const contexts: Array<{ documentUrl: string }> = [];
const stored: Record<string, unknown> = {};
const events: string[] = [];

const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const fakeChrome = {
  runtime: {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    getURL: (path: string) => `${extensionOrigin}/${path.replace(/^\//, '')}`,
    getContexts: vi.fn(async () => contexts),
    sendMessage: vi.fn(async (message: { requestId: string }) => {
      events.push('audio');
      if (audioShouldFail) throw new Error('audio blocked');
      return { v: PROTOCOL_VERSION, requestId: message.requestId, ok: true };
    }),
    onMessage: { addListener: (listener: Listener) => { internalListener = listener; } },
    onMessageExternal: { addListener: (listener: Listener) => { externalListener = listener; } },
    onInstalled: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => { events.push('storage'); Object.assign(stored, value); }),
    },
  },
  offscreen: {
    Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' },
    createDocument: vi.fn(async ({ url }: { url: string }) => {
      createCount += 1;
      contexts.push({ documentUrl: `${extensionOrigin}/${url}` });
    }),
    closeDocument: vi.fn(async () => { contexts.length = 0; }),
  },
};

function invoke(listener: Listener, message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  return new Promise((resolve) => {
    expect(listener(message, sender, resolve)).toBe(true);
  });
}

const popupSender = { id: fakeChrome.runtime.id, url: `${extensionOrigin}/popup.html` };

beforeAll(async () => {
  Object.defineProperty(globalThis, 'chrome', { value: fakeChrome, configurable: true });
  await import('../src/service-worker');
});

beforeEach(() => {
  audioShouldFail = false;
  events.length = 0;
  contexts.length = 0;
  createCount = 0;
  delete stored[STORAGE_KEY];
  vi.clearAllMocks();
});

describe('service worker routing', () => {
  it('unlocks sound only after offscreen audio succeeds, then stores and acknowledges', async () => {
    const response = await invoke(internalListener, {
      v: 1, target: 'service-worker', type: 'enable-sound', requestId: 'ui_12345678',
    }, popupSender) as { ok: boolean; state: { playback: { soundUnlocked: boolean } } };
    expect(response.ok).toBe(true);
    expect(response.state.playback.soundUnlocked).toBe(true);
    expect(events).toEqual(['audio', 'storage']);
    expect(createCount).toBe(1);
    expect(stored[STORAGE_KEY]).toEqual(response.state);
    const audioMessage = fakeChrome.runtime.sendMessage.mock.calls[0]?.[0] as { sessionToken?: string };
    expect(audioMessage.sessionToken).toMatch(/^session_[a-z0-9]+$/i);
    expect(contexts[0]?.documentUrl).toContain(`session=${audioMessage.sessionToken}`);
  });

  it('does not persist first-use consent when offscreen audio fails', async () => {
    audioShouldFail = true;
    const response = await invoke(internalListener, {
      v: 1, target: 'service-worker', type: 'enable-sound', requestId: 'ui_12345678',
    }, popupSender) as { ok: boolean; message: string };
    expect(response.ok).toBe(false);
    expect(response.message).toContain('audio blocked');
    expect(stored[STORAGE_KEY]).toBeUndefined();
  });

  it('serializes concurrent updates and creates only one offscreen document', async () => {
    const enable = invoke(internalListener, {
      v: 1, target: 'service-worker', type: 'enable-sound', requestId: 'ui_enable123',
    }, popupSender);
    const volume = invoke(internalListener, {
      v: 1, target: 'service-worker', type: 'set-volume', requestId: 'ui_volume123', volume: 0.42,
    }, popupSender);
    const [, volumeResponse] = await Promise.all([enable, volume]) as Array<{ ok: boolean; state: { playback: { masterVolume: number } } }>;
    expect(volumeResponse.ok).toBe(true);
    expect(volumeResponse.state.playback.masterVolume).toBe(0.42);
    expect(createCount).toBe(1);
  });

  it('changes the current vibe volume without changing overall extension volume', async () => {
    const response = await invoke(internalListener, {
      v: 1, target: 'service-worker', type: 'set-vibe-volume', requestId: 'ui_vibevolume', volume: 0.35,
    }, popupSender) as { ok: boolean; state: { preset: { audio: { master: { gain: number } } }; playback: { masterVolume: number } } };
    expect(response.ok).toBe(true);
    expect(response.state.preset.audio.master.gain).toBe(0.35);
    expect(response.state.playback.masterVolume).toBe(0.8);
  });

  it('rejects external messages from any non-production origin', async () => {
    const response = await invoke(externalListener, {
      v: 1, type: 'vibe:set-preset', requestId: 'web_12345678', preset: DEFAULT_PRESET,
    }, { origin: 'https://evil.example', url: 'https://evil.example/' }) as { ok: boolean };
    expect(response.ok).toBe(false);
    expect(stored[STORAGE_KEY]).toBeUndefined();
  });
});
