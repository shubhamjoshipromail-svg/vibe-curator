import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CANONICAL_VIBE_ORIGIN,
  LEGACY_CURATED_AUDIO_REDIRECTS,
  canonicalCuratedAudioUrl,
  canonicalizeActivationPreset,
  classifyCuratedAudioRequest,
  legacyCuratedAudioRedirect,
} from '../server/legacy-audio.ts';

const root = new URL('../', import.meta.url);
const curated = new URL('public/audio/curated/', root);

test('every legacy curated URL redirects to its exact v2 replacement', () => {
  const entries = Object.entries(LEGACY_CURATED_AUDIO_REDIRECTS);
  assert.equal(entries.length, 12);
  for (const [legacy, target] of entries) {
    assert.equal(legacyCuratedAudioRedirect(legacy), target, legacy);
    assert.equal(legacyCuratedAudioRedirect(`${legacy}?cache=1`), undefined, `${legacy} query`);
    assert.equal(canonicalCuratedAudioUrl(legacy), `${CANONICAL_VIBE_ORIGIN}${target}`, legacy);
  }
});

test('legacy aliases are exact and cannot become a general curated-file redirector', () => {
  for (const request of [
    '/audio/curated/not-a-track.mp3',
    '/audio/curated/electric-garden-v2.mp3',
    '/audio/curated/electric-garden.mp3/extra',
    '/audio/curated/electric-garden.mp3?activation=anything',
    '/audio/curated/%65lectric-garden.mp3',
  ]) assert.equal(legacyCuratedAudioRedirect(request), undefined, request);
  assert.equal(classifyCuratedAudioRequest('/audio/curated/not-a-track.mp3').kind, 'reject');
  assert.equal(classifyCuratedAudioRequest('/audio/curated/electric-garden.mp3?activation=anything').kind, 'reject');
  assert.equal(classifyCuratedAudioRequest('/audio/curated/electric-garden-v2.mp3').kind, 'pass');
  assert.equal(canonicalCuratedAudioUrl('https://elsewhere.example/audio/curated/electric-garden.mp3'), undefined);
  assert.equal(canonicalCuratedAudioUrl('/audio/curated/electric-garden.mp3?cache=1'), undefined);
});

test('pack has only v2 tracks and each redirect target is a deployable asset', () => {
  const pack = JSON.parse(readFileSync(new URL('pack.json', curated), 'utf8')) as { assets: Record<string, { file: string }> };
  const packed = Object.values(pack.assets).map(({ file }) => file).sort();
  const actual = readdirSync(curated).filter((file) => file.endsWith('.mp3')).sort();
  assert.deepEqual(actual, packed, 'no orphan or legacy MP3 files may be deployed');
  for (const target of Object.values(LEGACY_CURATED_AUDIO_REDIRECTS)) {
    const file = target.split('/').at(-1)!;
    assert.ok(existsSync(new URL(file, curated)), `missing redirect target ${file}`);
    assert.ok(packed.includes(file), `redirect target missing from pack: ${file}`);
  }
  assert.ok(packed.every((file) => file.endsWith('-v2.mp3')));
});

test('native activations canonicalize only allowlisted first-party music URLs', () => {
  const native = readFileSync(new URL('../server/native.ts', import.meta.url), 'utf8');
  assert.match(native, /import \{ canonicalizeActivationPreset \} from '\.\/legacy-audio'/);
  assert.match(native, /const preset = canonicalizeActivationPreset\(receivedPreset\)/);
  const preset = canonicalizeActivationPreset({
    id: 'market-pixel-last-broadcast',
    music: { url: '/audio/curated/last-broadcast.mp3', assetId: 'kept' },
    baselineMusic: { url: '/audio/curated/electric-garden-v2.mp3' },
    other: { url: '/audio/curated/not-a-track.mp3' },
  });
  assert.equal((preset.music as { url: string }).url, `${CANONICAL_VIBE_ORIGIN}/audio/curated/last-broadcast-v2.mp3`);
  assert.equal((preset.baselineMusic as { url: string }).url, `${CANONICAL_VIBE_ORIGIN}/audio/curated/electric-garden-v2.mp3`);
  assert.deepEqual(preset.other, { url: '/audio/curated/not-a-track.mp3' });
});

test('Vite installs the alias ahead of static assets for both dev and Railway preview', () => {
  const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(config, /legacyCuratedAudioPlugin\(\)/);
  assert.match(config, /const hook = plugin\.configureServer/);
  const source = readFileSync(new URL('../server/legacy-audio.ts', import.meta.url), 'utf8');
  assert.match(source, /configureServer\(server\)/);
  assert.doesNotMatch(source, /configurePreviewServer\(server\)/, 'preview bridge must not mount the redirector twice');
});
