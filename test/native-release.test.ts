import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  activationFromDeepLink,
  connectNativeActivationInbox,
  type NativeActivationBridge,
} from '../src/runtime/deep-link.ts';
import { clampVolume } from '../src/runtime/media.ts';
import {
  DEFAULT_MASTER_AUDIO_PREFERENCES,
  MASTER_AUDIO_ZERO_RECOVERY_KEY,
  readMasterAudioPreferences,
  recoverLegacyZeroVolume,
  writeMasterAudioPreferences,
} from '../src/audio/preferences.ts';

const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('menu-bar clicks toggle the controls popup independently of playback', () => {
  const nativeHost = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(nativeHost, /fn toggle_native_controls[\s\S]*window\.is_visible\(\)[\s\S]*window\.hide\(\)[\s\S]*show_native_controls/);
  assert.match(nativeHost, /toggle_native_controls\(tray\.app_handle\(\), rect\)/);
});

test('rejects the unsupported preset deep-link path explicitly', () => {
  assert.equal(activationFromDeepLink('vibecurator://open?preset=market-pixel-last-broadcast'), undefined);
  assert.equal(activationFromDeepLink(`vibecurator://open?activation=not-a-token&preset=fallback`), undefined);
});

test('accepts the dedicated controls deep link without accepting arbitrary hosts', () => {
  assert.deepEqual(activationFromDeepLink('vibecurator://controls'), { controls: true });
  assert.equal(activationFromDeepLink('vibecurator://settings'), undefined);
});

test('accepts exactly 64 lowercase hexadecimal transfer-token characters', () => {
  assert.deepEqual(activationFromDeepLink(`vibecurator://open?activation=${token}`), { token });
  assert.equal(activationFromDeepLink(`vibecurator://open?activation=${token.slice(0, -1)}`), undefined);
  assert.equal(activationFromDeepLink(`vibecurator://open?activation=${token.toUpperCase()}`), undefined);
  assert.equal(activationFromDeepLink(`vibecurator://open?activation=${token}&extra=ignored`), undefined);
  assert.equal(activationFromDeepLink(`vibecurator://open/path?activation=${token}`), undefined);
  assert.equal(activationFromDeepLink(`vibecurator://open?activation=${token}#fragment`), undefined);
});

test('rejects malformed, wrong-host, wrong-scheme, and unsafe activations', () => {
  const rejected = [
    'not a URL',
    'https://open?preset=market-pixel-last-broadcast',
    'vibecurator://other?preset=market-pixel-last-broadcast',
    'vibecurator://controls?extra=1',
    'vibecurator://open?activation=not-a-token',
  ];
  for (const value of rejected) assert.equal(activationFromDeepLink(value), undefined, value);
});

test('subscribes before draining cold activations and delivers current tokens once', async () => {
  let handler: ((value: unknown) => void | Promise<void>) | undefined;
  let subscribedBeforeDrain = false;
  const bridge: NativeActivationBridge = {
    async listen(next) {
      handler = next;
      return () => {};
    },
    async claim() { return false; },
    async takePending() {
      subscribedBeforeDrain = Boolean(handler);
      return [token, token, 'not-a-token'];
    },
  };
  const delivered: string[] = [];
  await connectNativeActivationInbox(async (value) => { delivered.push(value); }, bridge);
  assert.equal(subscribedBeforeDrain, true);
  assert.deepEqual(delivered, [token]);
});

test('claims warm activations and suppresses an event racing the cold drain', async () => {
  const warm = `1${token.slice(1)}`;
  let handler: ((value: unknown) => void | Promise<void>) | undefined;
  const pending = new Set([token]);
  const bridge: NativeActivationBridge = {
    async listen(next) {
      handler = next;
      return () => {};
    },
    async claim(value) { return pending.delete(value); },
    async takePending() {
      pending.delete(token);
      return [token];
    },
  };
  const delivered: string[] = [];
  await connectNativeActivationInbox(async (value) => { delivered.push(value); }, bridge);

  await handler?.(token);
  pending.add(warm);
  await handler?.(warm);
  await handler?.(warm);
  assert.deepEqual(delivered, [token, warm]);
});

test('clamps native master volume and rejects non-numeric payloads', () => {
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(0.42), 0.42);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(Number.NaN), undefined);
  assert.equal(clampVolume('0.5'), undefined);
});

test('persists safe master preferences and recovers from malformed storage', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage;

  writeMasterAudioPreferences({ volume: 4, muted: true }, storage);
  assert.deepEqual(readMasterAudioPreferences(storage), { volume: 1, muted: true });
  values.set('vibe.audio.master.v1', '{broken');
  assert.deepEqual(readMasterAudioPreferences(storage), DEFAULT_MASTER_AUDIO_PREFERENCES);
});

test('repairs an old silent master once without overriding later intentional zero', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage;

  values.set('vibe.audio.master.v1', JSON.stringify({ volume: 0, muted: false }));
  assert.deepEqual(recoverLegacyZeroVolume(readMasterAudioPreferences(storage), storage), { volume: 0.8, muted: false });
  assert.equal(values.get(MASTER_AUDIO_ZERO_RECOVERY_KEY), '1');

  writeMasterAudioPreferences({ volume: 0, muted: false }, storage);
  assert.deepEqual(recoverLegacyZeroVolume(readMasterAudioPreferences(storage), storage), { volume: 0, muted: false });
});
