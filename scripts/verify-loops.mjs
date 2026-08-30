#!/usr/bin/env node
/**
 * Deterministic loop verification for the curated pack.
 *
 * Nobody should have to listen to twelve files to find out whether mastering
 * worked. This measures the four things that actually go wrong — an audible tail,
 * a jump at the wrap point, a clipped master, and a loop trimmed to nothing — and
 * exits non-zero if any file fails.
 *
 * Deliberately NOT wired into `npm run build`. The 30 s sources sit close to the
 * duration floor until they are regenerated at full length, so this is a gate a
 * human runs, not one that blocks a release.
 *
 *   node --experimental-strip-types scripts/verify-loops.mjs [--json]
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { inspectTrack } from '../server/mastering.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CURATED = join(ROOT, 'public/audio/curated');

/** The seam is judged over half a second either side of the wrap. */
const SEAM_WINDOW_SECONDS = 0.5;

const LIMITS = {
  trailingSilenceSeconds: 0.25,
  seamDeltaDb: 6,
  truePeakDb: -0.1,
  minDurationSeconds: 15,
};

const asJson = process.argv.includes('--json');
const show = (value, places = 2) => (typeof value === 'number' ? value.toFixed(places) : '—');

function check(m) {
  const failures = [];
  if (m.trailingSilenceSeconds > LIMITS.trailingSilenceSeconds) {
    failures.push(`trailing silence ${m.trailingSilenceSeconds.toFixed(2)}s > ${LIMITS.trailingSilenceSeconds}s`);
  }
  // An unmeasurable seam is not a pass: it means the file would not decode.
  if (typeof m.seamDeltaDb !== 'number') failures.push('seam delta unmeasurable');
  else if (m.seamDeltaDb > LIMITS.seamDeltaDb) failures.push(`seam delta ${m.seamDeltaDb.toFixed(1)}dB > ${LIMITS.seamDeltaDb}dB`);
  if (typeof m.truePeakDb === 'number' && m.truePeakDb > LIMITS.truePeakDb) {
    failures.push(`true peak ${m.truePeakDb.toFixed(2)}dBTP > ${LIMITS.truePeakDb}dBTP`);
  }
  if (typeof m.durationSeconds !== 'number') failures.push('duration unmeasurable');
  else if (m.durationSeconds < LIMITS.minDurationSeconds) {
    failures.push(`duration ${m.durationSeconds.toFixed(1)}s < ${LIMITS.minDurationSeconds}s`);
  }
  return failures;
}

const files = (await readdir(CURATED)).filter((name) => name.endsWith('.mp3')).sort();
if (files.length === 0) {
  console.error(`No .mp3 files found in ${CURATED}.`);
  process.exit(1);
}

const results = [];
for (const file of files) {
  const measured = await inspectTrack(await readFile(join(CURATED, file)), SEAM_WINDOW_SECONDS);
  results.push({ file, ...measured, failures: check(measured) });
}

if (asJson) {
  console.log(JSON.stringify({ limits: LIMITS, seamWindowSeconds: SEAM_WINDOW_SECONDS, results }, null, 2));
} else {
  const headers = ['', 'file', 'dur', 'LUFS', 'peak', 'lead', 'tail', 'seamΔ'];
  const body = results.map((r) => [
    r.failures.length ? '✗' : '✓',
    r.file,
    `${show(r.durationSeconds, 1)}s`,
    show(r.lufs, 1),
    show(r.truePeakDb),
    show(r.leadingSilenceSeconds),
    show(r.trailingSilenceSeconds),
    `${show(r.seamDeltaDb, 1)}dB`,
  ]);
  const widths = headers.map((h, c) => Math.max(h.length, ...body.map((line) => line[c].length)));
  const line = (cells) => cells.map((cell, c) => cell.padEnd(widths[c])).join('  ');

  console.log(`Loop verification · ${files.length} file(s) · seam measured over ${SEAM_WINDOW_SECONDS}s`);
  console.log('');
  console.log(line(headers));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const cells of body) console.log(line(cells));

  console.log('');
  console.log(`limits · tail ≤ ${LIMITS.trailingSilenceSeconds}s · seam ≤ ${LIMITS.seamDeltaDb}dB `
    + `· peak ≤ ${LIMITS.truePeakDb}dBTP · duration ≥ ${LIMITS.minDurationSeconds}s`);
}

const failed = results.filter((r) => r.failures.length);
if (failed.length) {
  console.error('');
  console.error(`FAILED — ${failed.length} of ${results.length} file(s):`);
  for (const r of failed) console.error(`  ✗ ${r.file}: ${r.failures.join('; ')}`);
  process.exit(1);
}

console.log('');
console.log(`All ${results.length} file(s) within limits.`);
