import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitAfterAudio, DEFAULT_STATE, PROTOCOL_VERSION, type ExtensionState } from '../src/core';

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | void;

let listener: Listener;
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const sessionToken = 'session_12345678';

class FakeAudio {
  src: string;
  loop = false;
  preload = '';
  volume = 1;

  constructor(url: string) { this.src = url; }
  pause() {}
  removeAttribute() { this.src = ''; }
  load() {}
  async play(): Promise<void> { throw new Error('media decode failed'); }
}

const connectable = { connect() { return connectable; } };
const fakeContext = {
  state: 'suspended',
  currentTime: 0,
  destination: {},
  resume: vi.fn(async () => { fakeContext.state = 'running'; }),
  suspend: vi.fn(async () => { fakeContext.state = 'suspended'; }),
  createBiquadFilter: () => ({ ...connectable, type: 'lowpass', frequency: { value: 0 } }),
  createGain: () => ({ ...connectable, gain: { value: 0, setTargetAtTime: vi.fn() } }),
  createOscillator: () => ({ ...connectable, type: 'sine', frequency: { value: 0 }, start: vi.fn() }),
};

function invoke(message: unknown): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    expect(listener(message, { id: extensionId }, (response) => {
      resolve(response as { ok: boolean; message?: string });
    })).toBe(true);
  });
}

beforeAll(async () => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL(`chrome-extension://${extensionId}/offscreen.html?session=${sessionToken}`),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Audio', { value: FakeAudio, configurable: true });
  Object.defineProperty(globalThis, 'AudioContext', {
    value: class { constructor() { return fakeContext; } },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'chrome', {
    value: { runtime: { id: extensionId, onMessage: { addListener: (value: Listener) => { listener = value; } } } },
    configurable: true,
  });
  await import('../src/offscreen');
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('offscreen audio application', () => {
  it('warns on an unplayable track and still allows the state to be persisted', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state: ExtensionState = structuredClone(DEFAULT_STATE);
    state.playback = { ...state.playback, soundUnlocked: true, desiredPlaying: true };
    state.preset.trackUrl = 'https://vibe-curator-production.up.railway.app/audio/curated/last-broadcast-v2.mp3';
    let persisted: ExtensionState | undefined;

    await commitAfterAudio(
      state,
      async (next) => {
        const response = await invoke({
          v: PROTOCOL_VERSION,
          target: 'offscreen',
          type: 'audio:apply',
          requestId: 'audio_12345678',
          sessionToken,
          state: next,
        });
        if (!response.ok) throw new Error(response.message);
      },
      async (next) => { persisted = next; },
    );

    expect(warning).toHaveBeenCalledWith(
      'Unable to play curated track; continuing with ambience.',
      expect.objectContaining({ message: 'media decode failed' }),
    );
    expect(persisted).toEqual(state);
  });

  it('still rejects protocol and validation errors', async () => {
    const response = await invoke({
      v: 99,
      target: 'offscreen',
      type: 'audio:apply',
      requestId: 'audio_12345678',
      sessionToken,
      state: DEFAULT_STATE,
    });
    expect(response.ok).toBe(false);
    expect(response.message).toContain('Unsupported protocol version');
  });
});
