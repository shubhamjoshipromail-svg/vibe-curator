#!/usr/bin/env node
/**
 * Regenerates the noise-like curated baselines through the v2 music pipeline.
 *
 * Measured spectral flatness (low = tonal, high = noise-like) flagged three of
 * the twelve baselines as noise rather than music. They are genuine ElevenLabs
 * output; they are just bad output, generated with the v1 prompt that pushed
 * every request toward a "restrained ambient bed" until the result was texture
 * with no musical content.
 *
 *   electric-garden        0.397   backs 5 cards
 *   smiling-through-rain   0.448   backs 2 cards
 *   japanese-water-garden  0.341   backs 4 cards
 *
 * Two deliberate choices in the briefs below:
 *
 * 1. No ambience elements are baked into the music. The two worst offenders are
 *    the two rain/water tracks, and recorded rain IS broadband noise — asking a
 *    music model for it guarantees a flat spectrum. The app already has an
 *    ambience bus for that. Music asks for music.
 * 2. One file still serves several cards, so each brief is the common intent of
 *    its group rather than any single card's entry. electric-garden backs five
 *    cards that all want pulse, so it asks for pulse instead of a bed.
 *
 * Files are rewritten in place under their existing names. Renaming would break
 * the pack.json license rows that gate the build, which is why the previous
 * pass shipped as a ?v= query rather than a rename; bump CURATED_ASSET_VERSION
 * to 3 after running this.
 *
 *   node --experimental-strip-types scripts/regenerate-baselines.mjs [--dry-run] [--only=<name>]
 *
 * Costs about $0.30 per track at 120 s ($0.15/min), so ~$0.90 for all three.
 */
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { inspectTrack, masterTrack } from '../server/mastering.ts';
import { resolveMusicBrief } from '../src/audio/resolve.ts';
import { renderProviderPrompt } from '../src/audio/render-prompt.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CURATED = join(ROOT, 'public/audio/curated');
const LENGTH_MS = 120_000;
const CROSSFADE_SECONDS = 8;
const USD_PER_MINUTE = 0.15;

/** Common intent per file, not per card. See the header. */
const TARGETS = [
  {
    file: 'electric-garden.mp3',
    cards: 5,
    direction: {
      mode: 'instrumental_score',
      music: {
        mood: ['electric', 'buoyant', 'nocturnal'],
        instrumentation: ['analog synth', 'electric piano', 'soft drum machine', 'electric bass'],
        tempo: 'moderate',
        rhythm: 'steady pulse',
        density: 'medium',
        evolution: 'builds gently and settles back',
      },
    },
  },
  {
    file: 'japanese-water-garden.mp3',
    cards: 4,
    direction: {
      mode: 'ambient_score',
      music: {
        mood: ['warm', 'calm', 'unhurried'],
        instrumentation: ['felt piano', 'soft strings', 'plucked string'],
        tempo: 'slow',
        density: 'sparse',
        avoid: ['field recording', 'water sounds', 'broadband noise'],
      },
    },
  },
  {
    file: 'smiling-through-rain.mp3',
    cards: 2,
    direction: {
      mode: 'ambient_score',
      music: {
        mood: ['contemplative', 'intimate', 'muted'],
        instrumentation: ['upright piano', 'soft cello'],
        tempo: 'slow',
        density: 'sparse',
        avoid: ['field recording', 'rain sounds', 'broadband noise'],
      },
    },
  },
];

function flag(name) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

const dryRun = process.argv.includes('--dry-run');
const only = flag('only')?.replace(/\.mp3$/, '');
/**
 * A sparse, slow piece can end far quieter than it began even after the fade is
 * trimmed, which shows up as a large seam delta at the loop point. Folding more
 * of the loud head over the quiet tail is the fix, so the crossfade is tunable
 * per track rather than fixed at the ambient_score default.
 */
const crossfadeSeconds = Number(flag('crossfade') ?? CROSSFADE_SECONDS);

async function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  try {
    const env = await readFile(resolve(ROOT, '.env'), 'utf8');
    const match = env.match(/^ELEVENLABS_API_KEY=(.*)$/m);
    if (match?.[1].trim()) return match[1].trim();
  } catch {
    /* no .env */
  }
  throw new Error('ELEVENLABS_API_KEY not found in environment or .env');
}

/** Same construction the server uses, so offline baselines match runtime output. */
function promptFor(target) {
  const brief = resolveMusicBrief({
    vocalControl: 'instrumental',
    cardDirection: target.direction,
  });
  return { brief, prompt: renderProviderPrompt(brief, 'elevenlabs') };
}

async function generate(key, prompt) {
  const upstream = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({
      model_id: 'music_v2',
      prompt: `Instrumental music with no vocals. ${prompt}`,
      music_length_ms: LENGTH_MS,
      force_instrumental: true,
    }),
  });
  if (!upstream.ok) {
    throw new Error(`ElevenLabs ${upstream.status}: ${(await upstream.text()).slice(0, 400)}`);
  }
  const audio = Buffer.from(await upstream.arrayBuffer());
  if (!audio.length) throw new Error('response contained no audio bytes');
  return audio;
}

const selected = TARGETS.filter((target) => !only || target.file.startsWith(only));
if (!selected.length) {
  console.error(`No target matches --only=${only}`);
  process.exit(1);
}

console.log(`${dryRun ? 'DRY RUN — ' : ''}regenerating ${selected.length} baseline(s) at ${LENGTH_MS / 1000}s`);
if (!dryRun) {
  console.log(`estimated spend: $${(selected.length * (LENGTH_MS / 60_000) * USD_PER_MINUTE).toFixed(2)}\n`);
}

if (dryRun) {
  for (const target of selected) {
    const { prompt } = promptFor(target);
    console.log(`\n── ${target.file} (${target.cards} cards)`);
    console.log(prompt);
  }
  process.exit(0);
}

const key = await apiKey();
const results = [];

for (const target of selected) {
  const { prompt } = promptFor(target);
  process.stdout.write(`  ${target.file.padEnd(26)} generating…`);
  try {
    const raw = await generate(key, prompt);
    process.stdout.write(' mastering…');
    const before = await inspectTrack(raw);
    const mastered = await masterTrack(raw, {
      mode: 'crossfade',
      targetDurationSeconds: LENGTH_MS / 1000,
      crossfadeSeconds,
    });
    await writeFile(join(CURATED, target.file), mastered.audio);
    await writeFile(
      join(CURATED, target.file.replace(/\.mp3$/, '.master.json')),
      `${JSON.stringify({ ...mastered.report, prompt, regeneratedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    results.push({ file: target.file, before, report: mastered.report });
    console.log(` ok  ${before.durationSeconds?.toFixed(1)}s → ${mastered.report.outputDurationSeconds?.toFixed(1)}s`);
  } catch (error) {
    console.log(` FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${results.length}/${selected.length} regenerated. Run \`npm run verify:loops\` next,`);
console.log('then bump CURATED_ASSET_VERSION in src/preset/library.ts and update CURATED_PLAYBACK durations.');
