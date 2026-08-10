#!/usr/bin/env node
/**
 * Generates the built-in effect library.
 *
 * These are not hand-written examples dressed up as AI output. They are real
 * generations through the same prompt and schema the product uses at runtime,
 * saved so Explore has genuinely good content on first launch instead of an
 * empty gallery and a 40 second wait.
 *
 *   node scripts/generate-builtin-effects.mjs
 *
 * Requires ANTHROPIC_API_KEY in .env. Re-run to refresh the library.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, SHADER_SCHEMA, buildUserMessage, MODEL } from '../server/shader-prompt.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const env = readFileSync(resolve(ROOT, '.env'), 'utf8');
    const m = env.match(/^ANTHROPIC_API_KEY=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch {
    /* no .env */
  }
  console.error('ANTHROPIC_API_KEY not found in env or .env');
  process.exit(1);
}

// A neutral ramp, so built-ins are not tied to one scene's colours. Every
// effect reads palette() at runtime and recolours itself per preset anyway.
const NEUTRAL_RAMP = [
  '#0a0a0f', '#141420', '#242435', '#3a3a52',
  '#5c5c7a', '#8a8aa8', '#bcbcd0', '#eeeef4',
];

const REQUESTS = [
  {
    slug: 'drifting-motes',
    prompt: 'slow glowing particles drifting upward behind the scene, like embers or dust catching light, sparse and calm',
  },
  {
    slug: 'underwater-light',
    prompt: 'make the background look like light refracting underwater: slow caustic ripples playing across everything, gentle lensing',
  },
  {
    slug: 'crt-phosphor',
    prompt: 'old CRT monitor: rolling scanlines, slight chromatic aberration at the edges, soft phosphor glow and a gentle vignette',
  },
  {
    slug: 'volumetric-shaft',
    prompt: 'a soft shaft of light falling diagonally across the scene with slow dust turning inside it, like sun through a high window',
  },
  {
    slug: 'aurora-veil',
    prompt: 'a faint aurora veil breathing slowly across the upper half of the scene, soft vertical curtains, never harsh',
  },
  {
    slug: 'rain-on-glass',
    prompt: 'looking through a rain-streaked window: droplets refracting the scene, slow trails running down, soft defocus between them',
  },
];

const client = new Anthropic({ apiKey: loadKey() });

async function generate(req) {
  const started = Date.now();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: SHADER_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: buildUserMessage({ prompt: req.prompt, paletteRamp: NEUTRAL_RAMP }),
      },
    ],
  });

  if (message.stop_reason === 'refusal') throw new Error('model declined');
  const text = message.content.find((b) => b.type === 'text');
  if (!text) throw new Error('no text content');

  const parsed = JSON.parse(text.text);
  return {
    ...parsed,
    slug: req.slug,
    prompt: req.prompt,
    provider: 'anthropic',
    model: MODEL,
    elapsedMs: Date.now() - started,
    usage: {
      input: message.usage?.input_tokens ?? null,
      output: message.usage?.output_tokens ?? null,
    },
  };
}

console.log(`Generating ${REQUESTS.length} built-in effects with ${MODEL}...`);

const settled = await Promise.allSettled(REQUESTS.map(generate));

const effects = [];
for (let i = 0; i < settled.length; i++) {
  const r = settled[i];
  if (r.status === 'fulfilled') {
    const e = r.value;
    effects.push(e);
    console.log(
      `  ok   ${e.slug.padEnd(18)} ${String(e.elapsedMs / 1000).padStart(5)}s  ` +
        `${e.params?.length ?? 0} params  ${e.glsl.length} chars`,
    );
  } else {
    console.error(`  FAIL ${REQUESTS[i].slug}: ${r.reason}`);
  }
}

if (!effects.length) {
  console.error('No effects generated; leaving the existing library alone.');
  process.exit(1);
}

const out = resolve(ROOT, 'src/effects/builtin.json');
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), effects }, null, 2) + '\n');
console.log(`\nWrote ${effects.length} effects to src/effects/builtin.json`);
