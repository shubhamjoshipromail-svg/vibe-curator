#!/usr/bin/env node
/**
 * Offline mastering backfill for the curated pack.
 *
 * Every curated track was generated with a fade to silence, which is fine for a
 * one-shot listen and wrong for a bed that loops. This runs the same mastering
 * pass the server uses — imported, never reimplemented — over each file and
 * writes the result back under the same name, so `pack.json` license rows and
 * the license gate are untouched.
 *
 * Files get noticeably shorter. That is the point: the fade is the defect.
 *
 *   node --experimental-strip-types scripts/master-baselines.mjs [options]
 *
 *   --dry-run            measure and print, write nothing
 *   --crossfade=<sec>    loop fold length (default 4)
 *   --target=<sec>       duration the plan asks for (default: each file's own)
 *   --only=<name>        limit to one file, with or without the .mp3
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { inspectTrack, masterTrack } from '../server/mastering.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CURATED = join(ROOT, 'public/audio/curated');
// The ambient_score mode default. These beds are ambient beds.
const DEFAULT_CROSSFADE_SECONDS = 8;
/**
 * The fold comes OUT of the content, so a fixed crossfade eats a short track.
 * Nine of the twelve baselines are 30 s: at 27.6 s of content an 8 s fold leaves
 * a 19.6 s loop, shorter than the source it replaced. Capping the fold at 15% of
 * content gives that file 4.1 s and keeps a 23.5 s loop.
 */
const MAX_CROSSFADE_FRACTION = 0.15;

function flag(name) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

const dryRun = process.argv.includes('--dry-run');
const crossfadeSeconds = Number(flag('crossfade') ?? DEFAULT_CROSSFADE_SECONDS);
const targetOverride = flag('target') ? Number(flag('target')) : undefined;
const only = flag('only')?.replace(/\.mp3$/, '');

const show = (value, places = 2) => (typeof value === 'number' ? value.toFixed(places) : '—');

function table(rows) {
  const headers = ['file', 'dur', 'LUFS', 'peak', 'lead', 'tail', 'xfade'];
  const body = rows.map((row) => [
    row.file,
    `${show(row.before.durationSeconds, 1)} → ${show(row.after.durationSeconds, 1)}`,
    `${show(row.before.lufs, 1)} → ${show(row.after.lufs, 1)}`,
    `${show(row.before.truePeakDb)} → ${show(row.after.truePeakDb)}`,
    `${show(row.before.leadingSilenceSeconds)} → ${show(row.after.leadingSilenceSeconds)}`,
    `${show(row.before.trailingSilenceSeconds)} → ${show(row.after.trailingSilenceSeconds)}`,
    row.crossfade.clamped
      ? `${show(row.crossfade.configured, 1)}→${show(row.crossfade.effective, 1)} clamped`
      : show(row.crossfade.effective, 1),
  ]);

  const widths = headers.map((header, column) =>
    Math.max(header.length, ...body.map((line) => line[column].length)));
  const line = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ');

  console.log('');
  console.log(line(headers));
  console.log(widths.map((width) => '─'.repeat(width)).join('  '));
  for (const cells of body) console.log(line(cells));
}

const entries = (await readdir(CURATED))
  .filter((name) => name.endsWith('.mp3'))
  .filter((name) => !only || name === `${only}.mp3`)
  .sort();

if (entries.length === 0) {
  console.error(`No .mp3 files matched in ${CURATED}.`);
  process.exit(1);
}

console.log(`Mastering ${entries.length} curated track(s)${dryRun ? ' (dry run, nothing will be written)' : ''}.`);

const rows = [];
const failures = [];

for (const file of entries) {
  const path = join(CURATED, file);
  const original = await readFile(path);

  const before = await inspectTrack(original);
  // Without an override the plan asks for what the file already is, so an
  // untouched 30 s bed is not flagged degraded just for being 30 s.
  const basePlan = {
    mode: 'crossfade',
    targetDurationSeconds: targetOverride ?? Math.round(before.durationSeconds ?? 0),
    crossfadeSeconds,
  };

  // Pass one establishes how much content survives the trim; only then is the
  // 15% cap computable. Trimming happens before the fold, so contentDuration is
  // the same whichever crossfade this pass used.
  let mastered = await masterTrack(original, basePlan);
  const contentSeconds = mastered.report.contentDurationSeconds ?? 0;
  const effective = contentSeconds > 0
    ? Math.min(crossfadeSeconds, Number((MAX_CROSSFADE_FRACTION * contentSeconds).toFixed(2)))
    : crossfadeSeconds;
  const clamped = effective < crossfadeSeconds - 0.01;
  if (clamped) mastered = await masterTrack(original, { ...basePlan, crossfadeSeconds: effective });

  const plan = { ...basePlan, crossfadeSeconds: effective };
  const crossfade = { configured: crossfadeSeconds, effective, clamped, maxFraction: MAX_CROSSFADE_FRACTION };
  const { audio, mimeType, report } = mastered;
  const after = await inspectTrack(audio);
  rows.push({ file, before, after, crossfade });

  if (!report.ok) failures.push(`${file}: ${report.reason ?? 'unknown'}`);

  if (!dryRun) {
    if (mimeType !== 'audio/mpeg') {
      failures.push(`${file}: refusing to write ${mimeType} over an .mp3`);
      continue;
    }
    await writeFile(path, audio);
    await writeFile(path.replace(/\.mp3$/, '.master.json'), `${JSON.stringify({ file, plan, crossfade, report, before, after }, null, 2)}\n`);
  }

  process.stdout.write(`  ${report.ok ? '✓' : '✗'} ${file}\n`);
}

table(rows);

if (failures.length) {
  console.log('');
  console.log(`${failures.length} track(s) reported not ok:`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
}

console.log('');
console.log(dryRun
  ? 'Dry run complete. Re-run without --dry-run to write the masters and reports.'
  : 'Wrote mastered audio and a .master.json report beside each track.');
