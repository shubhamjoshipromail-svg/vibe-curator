import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { activationFromDeepLink } from '../src/runtime/deep-link.ts';
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

test('accepts a bounded preset activation on the canonical scheme and host', () => {
  assert.deepEqual(
    activationFromDeepLink('vibecurator://open?preset=market-pixel-last-broadcast'),
    { presetId: 'market-pixel-last-broadcast' },
  );
  assert.deepEqual(
    activationFromDeepLink('vibecurator://open?preset=folder%2Fitem_2'),
    undefined,
    'encoded slash must not widen the preset-id grammar',
  );
});

test('accepts the dedicated controls deep link without accepting arbitrary hosts', () => {
  assert.deepEqual(activationFromDeepLink('vibecurator://controls'), { controls: true });
  assert.equal(activationFromDeepLink('vibecurator://settings'), undefined);
});

test('accepts exactly 64 lowercase hexadecimal transfer-token characters', () => {
  assert.deepEqual(activationFromDeepLink(`vibecurator://open?activation=${token}`), { token });
  assert.equal(activationFromDeepLink(`vibecurator://open?activation=${token.slice(0, -1)}`), undefined);
  assert.equal(activationFromDeepLink(`vibecurator://open?activation=${token.toUpperCase()}`), undefined);
  assert.deepEqual(activationFromDeepLink(`vibecurator://open?activation=${token}&preset=ignored`), { token },
    'a valid activation token takes precedence over a preset');
  assert.deepEqual(activationFromDeepLink(`vibecurator://open?activation=not-a-token&preset=fallback`), { presetId: 'fallback' },
    'an invalid token may fall back to a valid preset activation');
});

test('rejects malformed, wrong-host, wrong-scheme, and unsafe activations', () => {
  const rejected = [
    'not a URL',
    'https://open?preset=market-pixel-last-broadcast',
    'vibecurator://other?preset=market-pixel-last-broadcast',
    'vibecurator://open?preset=',
    'vibecurator://open?preset=contains.dot',
    `vibecurator://open?preset=${'x'.repeat(161)}`,
    'vibecurator://open?activation=not-a-token',
  ];
  for (const value of rejected) assert.equal(activationFromDeepLink(value), undefined, value);
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
