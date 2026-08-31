#!/usr/bin/env node

/**
 * Deterministic, read-only native release checks.
 *
 * The LaunchServices mode intentionally prints exact `lsregister -u` commands
 * instead of running them. This prevents a QA check from unregistering another
 * app or from applying the broad `lsregister -kill` recipe to the whole Mac.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUNDLE_ID = 'com.vibecurator.player';
const SCHEME = 'vibecurator';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const args = new Set(process.argv.slice(2));

function read(relative) {
  return readFileSync(resolve(ROOT, relative), 'utf8');
}

function checkSourceContracts() {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(config.identifier, BUNDLE_ID, 'Tauri bundle identifier changed unexpectedly');
  assert.deepEqual(config.plugins?.['deep-link']?.desktop?.schemes, [SCHEME], 'deep-link scheme must stay canonical');
  assert.equal(config.bundle?.macOS?.minimumSystemVersion, '11.0', 'native minimum must match the macOS 11+ product claim');

  const source = read('src/runtime/deep-link.ts');
  assert.match(source, /url\.protocol !== 'vibecurator:'/);
  assert.match(source, /url\.hostname !== 'open'/);
  assert.match(source, /\^\[a-f0-9\]\{64\}\$/);
  assert.doesNotMatch(source, /presetId/, 'unsupported preset deep links must not be reintroduced');
  assert.match(source, /claim_native_activation/);
  assert.match(source, /take_pending_native_activations/);
  console.log(`Native contract: ${BUNDLE_ID} / ${SCHEME}://open (OK)`);
}

function checkMarketplaceAudio() {
  const marketplace = read('src/app/marketplace.ts');
  const library = read('src/preset/library.ts');
  const posts = [...marketplace.matchAll(/presetId: '([^']+)'/g)].map((match) => match[1]);
  const scoreManifest = JSON.parse(read('public/audio/curated/market-scores.json'));
  const scores = Object.entries(scoreManifest.cards ?? {})
    .map(([id, score]) => ({ id, file: score.file, durationSeconds: score.durationSeconds }));
  assert.ok(posts.length > 0, 'marketplace posts are missing');
  assert.ok(scores.length > 0, 'curated marketplace scores are missing');
  assert.equal(posts.length, new Set(posts).size, 'marketplace must not list the same card twice');
  const postIds = new Set(posts);
  const scoreIds = new Set(scores.map((score) => score.id));
  assert.deepEqual(scoreIds, postIds, 'every marketplace card must have one included baseline score');
  const directionSource = library.slice(
    library.indexOf('export const MARKET_MUSIC_DIRECTION'),
    library.indexOf('// --- persistence'),
  );
  const directionIds = new Set([...directionSource.matchAll(/'([^']+)': direction\(/g)].map((match) => match[1]));
  assert.deepEqual(directionIds, postIds, 'every Marketplace card must have one v2 music direction');
  const marketImages = [...library.matchAll(/marketImage\('([^']+)'/g)].map((match) => match[1]);
  assert.equal(marketImages.length, new Set(marketImages).size, 'Marketplace variants must not reuse the same source image');
  for (const score of scores) {
    assert.ok(postIds.has(score.id), `orphan curated score mapping: ${score.id}`);
    assert.ok(existsSync(resolve(ROOT, 'public/audio/curated', score.file)), `missing curated score file: ${score.file}`);
    assert.ok(Math.abs(score.durationSeconds - 30) <= 0.15, `${score.id} must own a 30-second score`);
  }

  const curatedPack = JSON.parse(read('public/audio/curated/pack.json'));
  const packFiles = Object.values(curatedPack.assets ?? {}).map((asset) => asset.file);
  for (const file of packFiles) {
    assert.ok(existsSync(resolve(ROOT, 'public/audio/curated', file)), `pack references missing audio: ${file}`);
  }
  const actualFiles = readdirSync(resolve(ROOT, 'public/audio/curated')).filter((file) => /\.(mp3|wav|ogg)$/i.test(file));
  assert.deepEqual([...actualFiles].sort(), [...new Set(packFiles)].sort(), 'curated audio directory and pack manifest diverged');
  for (const score of scores) assert.ok(packFiles.includes(score.file), `pack is missing current Market score: ${score.file}`);
  console.log(`Marketplace audio: ${scoreIds.size}/${postIds.size} cards have included scores; ${packFiles.length} files verified (OK)`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function launchServicesPlan() {
  if (process.platform !== 'darwin') {
    console.log('LaunchServices: skipped (exact registration checks require macOS).');
    return;
  }
  assert.ok(existsSync(LSREGISTER), `lsregister not found at ${LSREGISTER}`);
  const dump = spawnSync(LSREGISTER, ['-dump'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(dump.status, 0, `lsregister -dump failed: ${dump.error?.message || dump.stderr || 'unknown error'}`);
  const paths = new Set();
  for (const block of dump.stdout.split(/\n\s*\n/)) {
    if (!new RegExp(`(?:bundle id|identifier):\\s*${BUNDLE_ID}\\b`).test(block)) continue;
    for (const match of block.matchAll(/(?:^|\n)path:\s*(.+\.app)\s*$/gm)) paths.add(match[1].trim());
  }
  const indexed = spawnSync('mdfind', [`kMDItemCFBundleIdentifier == '${BUNDLE_ID}'`], { encoding: 'utf8' });
  if (indexed.status === 0) for (const path of indexed.stdout.split('\n').map((item) => item.trim()).filter(Boolean)) paths.add(path);
  if (!paths.size) {
    console.log(`LaunchServices: no registration found for exact bundle ${BUNDLE_ID}.`);
    return;
  }
  console.log(`LaunchServices registrations for exact bundle ${BUNDLE_ID}:`);
  for (const path of paths) {
    assert.ok(path.endsWith('.app'), `refusing non-app LaunchServices target: ${path}`);
    console.log(`  ${path}`);
    console.log(`  cleanup plan (not executed): ${LSREGISTER} -u -- ${shellQuote(path)}`);
  }
}

checkSourceContracts();
checkMarketplaceAudio();
if (args.has('--launchservices') || args.has('--launchservices-plan')) launchServicesPlan();
else if (process.platform === 'darwin') console.log('LaunchServices: skipped (pass --launchservices for read-only registration inventory).');
console.log('Native release checks passed.');
