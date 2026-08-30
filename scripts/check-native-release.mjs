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

  const source = read('src/runtime/deep-link.ts');
  assert.match(source, /url\.protocol !== 'vibecurator:'/);
  assert.match(source, /url\.hostname !== 'open'/);
  assert.match(source, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(source, /\^\[a-zA-Z0-9_-\]\{1,160\}\$/);
  console.log(`Native contract: ${BUNDLE_ID} / ${SCHEME}://open (OK)`);
}

function checkMarketplaceAudio() {
  const marketplace = read('src/app/marketplace.ts');
  const library = read('src/preset/library.ts');
  const posts = [...marketplace.matchAll(/presetId: '([^']+)'/g)].map((match) => match[1]);
  // The card-to-score map moved from inline `curatedMusic(...)` calls to a
  // `curated(assetId, file, name, createdAt)` helper that fills the playback
  // plan from CURATED_PLAYBACK. The contract this asserts is unchanged: every
  // marketplace card owns exactly one baseline score that exists on disk.
  const scores = [...library.matchAll(/'([^']+)': curated\('[^']+', '([^']+)'/g)]
    .map((match) => ({ id: match[1], file: match[2] }));
  assert.ok(posts.length > 0, 'marketplace posts are missing');
  assert.ok(scores.length > 0, 'curated marketplace scores are missing');
  const postIds = new Set(posts);
  const scoreIds = new Set(scores.map((score) => score.id));
  assert.deepEqual(scoreIds, postIds, 'every marketplace card must have one included baseline score');
  for (const score of scores) {
    assert.ok(postIds.has(score.id), `orphan curated score mapping: ${score.id}`);
    assert.ok(existsSync(resolve(ROOT, 'public/audio/curated', score.file)), `missing curated score file: ${score.file}`);
  }

  const curatedPack = JSON.parse(read('public/audio/curated/pack.json'));
  const packFiles = Object.values(curatedPack.assets ?? {}).map((asset) => asset.file);
  for (const file of packFiles) {
    assert.ok(existsSync(resolve(ROOT, 'public/audio/curated', file)), `pack references missing audio: ${file}`);
  }
  const actualFiles = readdirSync(resolve(ROOT, 'public/audio/curated')).filter((file) => /\.(mp3|wav|ogg)$/i.test(file));
  assert.deepEqual([...actualFiles].sort(), [...new Set(packFiles)].sort(), 'curated audio directory and pack manifest diverged');
  assert.deepEqual(new Set(scores.map((score) => score.file)), new Set(packFiles), 'curated tracks must be reachable from marketplace score mappings');
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
