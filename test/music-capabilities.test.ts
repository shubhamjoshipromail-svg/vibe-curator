import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { musicPipelineCapabilities } from '../server/music-capabilities.ts';

const allKeys = {
  lyriaConfigured: true,
  elevenLabsConfigured: true,
  openAiConfigured: true,
  anthropicConfigured: true,
  musicEnabled: true,
  directionEnabled: true,
};

test('Lyria generation works without a translator while named-reference adaptation still requires OpenAI', () => {
  const unavailable = musicPipelineCapabilities('v2', { ...allKeys, openAiConfigured: false });
  assert.equal(unavailable.musicGeneration, true);
  assert.equal(unavailable.musicPromptAdaptation, false);
  assert.equal(unavailable.musicPromptTranslatorConfigured, false);
  const available = musicPipelineCapabilities('v2', { ...allKeys, anthropicConfigured: false });
  assert.equal(available.musicGeneration, true);
  assert.equal(available.musicPromptAdaptation, true);
  assert.equal(available.musicProviders.lyria.enabled, true);
});

test('explicit v1 compatibility continues to require Anthropic', () => {
  assert.equal(musicPipelineCapabilities('v1', { ...allKeys, anthropicConfigured: false }).musicGeneration, false);
  assert.equal(musicPipelineCapabilities('v1', { ...allKeys, openAiConfigured: false }).musicGeneration, true);
});

test('Lyria is the default and ElevenLabs remains visibly premium-only', () => {
  const labs = readFileSync(new URL('../src/app/labs.ts', import.meta.url), 'utf8');
  const mediaRoute = readFileSync(new URL('../server/media.ts', import.meta.url), 'utf8');
  assert.match(labs, /caps\.pipelineVersion === 'v1' \? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'/);
  assert.match(labs, /caps\.musicPromptTranslatorConfigured/);
  assert.match(labs, /label: 'Lyria', hint: '30 seconds · available', disabled: false/);
  assert.match(labs, /label: 'ElevenLabs', hint: 'Premium only', disabled: true/);
  assert.match(labs, /provider: musicProvider/);
  const capabilities = musicPipelineCapabilities('v2', allKeys);
  assert.equal(capabilities.defaultMusicProvider, 'lyria');
  assert.equal(capabilities.musicProviders.elevenlabs.enabled, false);
  assert.equal(capabilities.musicProviders.elevenlabs.premiumOnly, true);
  assert.match(mediaRoute, /if \(body\.provider === 'elevenlabs'\)/);
  assert.match(mediaRoute, /ElevenLabs music is reserved for Premium/);
});
