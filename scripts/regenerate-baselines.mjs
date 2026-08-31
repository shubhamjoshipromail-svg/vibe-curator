#!/usr/bin/env node
/**
 * Generate one distinct 30-second instrumental score for every Market card.
 *
 * The provider is asked for a slightly longer source so deterministic
 * mastering can remove the provider fade and fold the remaining excess into a
 * seamless 30-second loop. Generation is resumable: completed files are
 * skipped unless --force is passed, and the runtime manifest is rewritten
 * after every successful card.
 *
 *   npm run regen:baselines -- --dry-run
 *   npm run regen:baselines
 *   npm run regen:baselines -- --only=market-pixel-last-broadcast --force
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { masterTrack } from '../server/mastering.ts';
import { resolveMusicBrief } from '../src/audio/resolve.ts';
import { renderProviderPrompt } from '../src/audio/render-prompt.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CURATED = join(ROOT, 'public/audio/curated');
const RUNTIME_MANIFEST = join(CURATED, 'market-scores.json');
const PACK_MANIFEST = join(CURATED, 'pack.json');
const TARGET_SECONDS = 30;
const SOURCE_SECONDS = 38;
const LENGTH_MS = SOURCE_SECONDS * 1000;
const USD_PER_MINUTE = 0.15;

const instrumental = (mood, instrumentation, extra = {}) => ({
  mode: 'instrumental_score',
  vocals: 'none',
  music: {
    mood,
    instrumentation,
    avoid: ['ambient wash', 'field recording', 'soundscape', 'lyrics', 'vocal samples', 'spoken word'],
    ...extra,
  },
  ambience: { enabled: false, elements: [], prominence: 0 },
  playback: { mode: 'crossfade', targetDurationSeconds: TARGET_SECONDS, crossfadeSeconds: 3 },
});

const TARGETS = [
  { id: 'market-pixel-last-broadcast', name: 'Moonlit Signal', direction: instrumental(['lonely', 'nocturnal', 'maritime'], ['soft analog synth', 'distant bell', 'electronic percussion'], { tempo: 'slow', rhythm: 'steady pulse', density: 'sparse' }) },
  { id: 'market-pixel-midnight-shrine', name: 'Shrine Save Theme', direction: instrumental(['still', 'reverent', 'nocturnal'], ['bell-toned synth', 'warm square-wave lead', 'soft electronic drums'], { tempo: 'slow', rhythm: 'measured pulse', density: 'sparse' }) },
  { id: 'market-cozy-gatehouse-rest', name: 'Gatehouse Vigil', direction: instrumental(['sheltered', 'tender', 'weary'], ['felt piano', 'low strings', 'soft frame drum'], { tempo: 'slow', rhythm: 'gentle pulse', density: 'sparse' }) },
  { id: 'market-living-ember-throne', name: 'Ember Processional', direction: instrumental(['solemn', 'vast', 'embered'], ['low strings', 'french horn', 'timpani'], { tempo: 'slow', rhythm: 'measured processional' }) },
  { id: 'market-sketch-rain-table', name: 'Rain Table Waltz', direction: instrumental(['contemplative', 'intimate', 'muted'], ['upright piano', 'soft cello', 'brush percussion'], { tempo: 'slow', rhythm: 'loose waltz', density: 'sparse' }) },
  { id: 'market-aurora-stillwater', name: 'Stillwater Motion', direction: instrumental(['vast', 'luminous', 'serene'], ['glass harmonics', 'electric piano', 'soft synth bass', 'electronic percussion'], { tempo: 'slow', rhythm: 'flowing pulse', density: 'spacious' }) },
  { id: 'market-japandi-blue-hour', name: 'Blue Hour Study', direction: instrumental(['quiet', 'spare', 'focused'], ['felt piano', 'marimba', 'upright bass'], { tempo: 'slow', rhythm: 'measured', density: 'sparse' }) },
  { id: 'market-western-moon-ritual', name: 'Mesa Ceremony', direction: instrumental(['arid', 'ceremonial', 'vast'], ['baritone guitar', 'bowed bass', 'hand drum', 'distant metallic percussion'], { tempo: 'slow', rhythm: 'processional' }) },
  { id: 'market-deco-emerald-midnight', name: 'Emerald After Hours', direction: instrumental(['sophisticated', 'nocturnal', 'smoky'], ['muted trumpet', 'brushed drums', 'upright bass'], { tempo: 'moderate', rhythm: 'restrained swing' }) },
  { id: 'market-synthwave-observatory', name: 'Observatory Drive', direction: instrumental(['retro', 'expansive', 'nocturnal'], ['analog synth', 'gated pad', 'electronic drums'], { tempo: 'moderate', rhythm: 'steady driving pulse' }) },
  { id: 'market-bauhaus-pavilion', name: 'Primary Rhythm', direction: instrumental(['precise', 'open', 'rational'], ['marimba', 'clarinet', 'dry percussion'], { tempo: 'moderate', rhythm: 'geometric pulse', density: 'sparse' }) },
  { id: 'market-art-nouveau-conservatory', name: 'Moon Conservatory', direction: instrumental(['ornate', 'nocturnal', 'botanical'], ['harp', 'flute', 'strings'], { tempo: 'slow', rhythm: 'flowing chamber pulse' }) },
  { id: 'market-wabi-sabi-rain-bowl', name: 'Imperfect Measure', direction: instrumental(['still', 'imperfect', 'quiet'], ['prepared piano', 'wood percussion', 'soft cello'], { tempo: 'slow', rhythm: 'free and measured', density: 'sparse' }) },
  { id: 'market-neo-brutalist-playground', name: 'Hard Shadow Game', direction: instrumental(['blunt', 'rhythmic', 'graphic'], ['percussion', 'detuned synth bass', 'staccato brass'], { tempo: 'moderate', rhythm: 'angular syncopation', density: 'dense' }) },
  { id: 'market-risograph-hill-ride', name: 'Two Ink Ride', direction: instrumental(['buoyant', 'kinetic', 'printed'], ['marimba', 'muted guitar', 'hand percussion'], { tempo: 'moderate', rhythm: 'bouncy cycling pulse' }) },
  { id: 'market-paper-cut-fox-valley', name: 'Fox Valley Theme', direction: instrumental(['storybook', 'nocturnal', 'hushed'], ['celesta', 'soft strings', 'pizzicato cello'], { tempo: 'slow', rhythm: 'gentle storybook pulse' }) },
  { id: 'market-cyanotype-coast', name: 'Blue Exposure', direction: instrumental(['cool', 'archival', 'still'], ['bowed vibraphone', 'glass harmonics', 'soft piano'], { tempo: 'slow', rhythm: 'tidal pulse', density: 'sparse' }) },
  { id: 'market-stained-glass-heron', name: 'Heron Light', direction: instrumental(['radiant', 'sacred', 'still'], ['pipe organ', 'bells', 'cello'], { tempo: 'slow', rhythm: 'stately pulse' }) },
  { id: 'market-surreal-collage-door', name: 'Impossible Door', direction: instrumental(['dreamlike', 'displaced', 'uncanny'], ['processed piano', 'reversed guitar', 'upright bass', 'brush percussion'], { tempo: 'slow', rhythm: 'off-kilter pulse' }) },
  { id: 'market-mid-century-lake-house', name: 'Lake House Morning', direction: instrumental(['optimistic', 'breezy', 'warm'], ['vibraphone', 'brushed drums', 'flute'], { tempo: 'moderate', rhythm: 'light lounge groove' }) },
  { id: 'market-living-color-orbit', name: 'Color Orbit', direction: instrumental(['kaleidoscopic', 'euphoric', 'kinetic'], ['arpeggiated synth', 'electric bass', 'electronic percussion'], { tempo: 'fast', rhythm: 'spiraling pulse', density: 'dense' }) },
  { id: 'market-living-midnight-haze', name: 'Violet Half Time', direction: instrumental(['hazy', 'suspended', 'violet'], ['electric piano', 'deep synth bass', 'soft electronic drums'], { tempo: 'slow', rhythm: 'half-time pulse', density: 'medium' }) },
  { id: 'market-living-neon-koi', name: 'Neon Current', direction: instrumental(['fluid', 'electric', 'luminous'], ['plucked synth', 'sub bass', 'electronic percussion'], { tempo: 'moderate', rhythm: 'flowing broken beat' }) },
].map((target) => ({ ...target, file: `${target.id}-v2.mp3` }));

function flag(name) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const only = flag('only');

async function apiKey() {
  if (process.env.ELEVENLABS_API_KEY?.trim()) return process.env.ELEVENLABS_API_KEY.trim();
  const env = await readFile(resolve(ROOT, '.env'), 'utf8');
  const match = env.match(/^ELEVENLABS_API_KEY=(.*)$/m);
  if (match?.[1].trim()) return match[1].trim();
  throw new Error('ELEVENLABS_API_KEY not found in environment or .env');
}

function promptFor(target) {
  const brief = resolveMusicBrief({ vocalControl: 'instrumental', cardDirection: target.direction });
  const prompt = renderProviderPrompt(brief, 'elevenlabs');
  return { brief, prompt: `Instrumental music with no vocals. ${prompt}` };
}

async function generate(key, prompt) {
  const response = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({ model_id: 'music_v2', prompt, music_length_ms: LENGTH_MS, force_instrumental: true }),
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error('ElevenLabs returned no audio bytes');
  return audio;
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function saveManifests(cards) {
  const generatedAt = new Date().toISOString();
  await writeFile(RUNTIME_MANIFEST, `${JSON.stringify({ version: 1, generatedAt, cards }, null, 2)}\n`);
  const pack = await readJson(PACK_MANIFEST, {});
  pack.note = 'One original 30-second instrumental score per unique Vibe Curator Market card.';
  pack.license = {
    source: `Generated by Vibe Curator with ElevenLabs Music v2 in ${generatedAt.slice(0, 10)}`,
    license: 'ElevenLabs Paid Output Terms',
    url: 'https://elevenlabs.io/terms-of-use',
    commercial_ok: true,
    attribution_required: false,
  };
  const generatedAssets = Object.fromEntries(Object.entries(cards).map(([id, card]) => [id.replace(/^market-/, '').replaceAll('-', '_'), { file: card.file }]));
  pack.assets = { ...(pack.legacyAssets ?? {}), ...generatedAssets };
  await writeFile(PACK_MANIFEST, `${JSON.stringify(pack, null, 2)}\n`);
}

const selected = TARGETS.filter((target) => !only || target.id === only || target.file === only);
if (!selected.length) throw new Error(`No Market score matches --only=${only}`);
const estimated = selected.length * SOURCE_SECONDS / 60 * USD_PER_MINUTE;
console.log(`${dryRun ? 'DRY RUN — ' : ''}${selected.length} unique Market score(s), ${SOURCE_SECONDS}s provider source → ${TARGET_SECONDS}s master`);
console.log(`estimated ElevenLabs spend if all generate: $${estimated.toFixed(2)}`);

if (dryRun) {
  for (const target of selected) console.log(`\n── ${target.id}\n${promptFor(target).prompt}`);
  process.exit(0);
}

const key = await apiKey();
const manifest = await readJson(RUNTIME_MANIFEST, { cards: {} });
const cards = manifest.cards ?? {};
let completed = 0;
let failed = 0;

for (const target of selected) {
  const path = join(CURATED, target.file);
  if (!force && cards[target.id]) {
    try {
      await readFile(path);
      console.log(`  ↷ ${target.id} already generated`);
      completed++;
      continue;
    } catch { /* regenerate missing bytes */ }
  }

  process.stdout.write(`  ${target.id.padEnd(38)} generating…`);
  try {
    const { brief, prompt } = promptFor(target);
    const raw = await generate(key, prompt);
    process.stdout.write(' mastering…');

    const trimmed = await masterTrack(raw, { mode: 'once', targetDurationSeconds: TARGET_SECONDS, crossfadeSeconds: 0 });
    const content = trimmed.report.contentDurationSeconds ?? 0;
    if (content < TARGET_SECONDS) throw new Error(`only ${content.toFixed(2)}s survived fade removal`);
    const crossfadeSeconds = Number((content - TARGET_SECONDS).toFixed(2));
    if (crossfadeSeconds <= 0 || crossfadeSeconds > 10) throw new Error(`required crossfade ${crossfadeSeconds}s is outside the safe range`);

    const mastered = await masterTrack(raw, { mode: 'crossfade', targetDurationSeconds: TARGET_SECONDS, crossfadeSeconds });
    const duration = mastered.report.outputDurationSeconds ?? 0;
    if (!mastered.report.ok) throw new Error(mastered.report.reason ?? 'mastering rejected the track');
    if (Math.abs(duration - TARGET_SECONDS) > 0.15) throw new Error(`master is ${duration.toFixed(2)}s, expected 30s`);
    if (mastered.mimeType !== 'audio/mpeg') throw new Error(`master returned ${mastered.mimeType}`);

    const createdAt = new Date().toISOString();
    await writeFile(path, mastered.audio);
    await writeFile(join(CURATED, target.file.replace(/\.mp3$/, '.master.json')), `${JSON.stringify({
      file: target.file, cardId: target.id, name: target.name, brief, prompt,
      sourceDurationSeconds: SOURCE_SECONDS, createdAt, report: mastered.report,
    }, null, 2)}\n`);
    cards[target.id] = {
      assetId: `builtin_${target.id.replace(/^market-/, '').replaceAll('-', '_')}_score`,
      file: target.file,
      name: target.name,
      durationSeconds: duration,
      playback: {
        mode: 'crossfade', targetDurationSeconds: duration,
        crossfadeSeconds: mastered.report.crossfadeSeconds ?? crossfadeSeconds,
        loopStart: mastered.report.loopStart ?? 0,
        loopEnd: mastered.report.loopEnd ?? duration,
      },
      createdAt,
    };
    await saveManifests(cards);
    completed++;
    console.log(` ok ${duration.toFixed(1)}s`);
  } catch (error) {
    failed++;
    console.log(` FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${completed}/${selected.length} ready; ${failed} failed.`);
if (failed) process.exitCode = 1;
