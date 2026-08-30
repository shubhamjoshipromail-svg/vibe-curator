import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { musicPipelineCapabilities } from '../server/music-capabilities.ts';

const allKeys = {
  elevenLabsConfigured: true,
  openAiConfigured: true,
  anthropicConfigured: true,
  musicEnabled: true,
  directionEnabled: true,
};

test('the default v2 music pipeline requires OpenAI, not Anthropic', () => {
  assert.deepEqual(musicPipelineCapabilities('v2', { ...allKeys, openAiConfigured: false }), {
    musicGeneration: false,
    musicPromptAdaptation: false,
    elevenMusicConfigured: true,
    musicPromptTranslatorConfigured: false,
  });
  assert.deepEqual(musicPipelineCapabilities('v2', { ...allKeys, anthropicConfigured: false }), {
    musicGeneration: true,
    musicPromptAdaptation: true,
    elevenMusicConfigured: true,
    musicPromptTranslatorConfigured: true,
  });
});

test('explicit v1 compatibility continues to require Anthropic', () => {
  assert.deepEqual(musicPipelineCapabilities('v1', { ...allKeys, anthropicConfigured: false }), {
    musicGeneration: false,
    musicPromptAdaptation: false,
    elevenMusicConfigured: true,
    musicPromptTranslatorConfigured: false,
  });
  assert.deepEqual(musicPipelineCapabilities('v1', { ...allKeys, openAiConfigured: false }), {
    musicGeneration: true,
    musicPromptAdaptation: true,
    elevenMusicConfigured: true,
    musicPromptTranslatorConfigured: true,
  });
});

test('Labs tells default v2 users to configure OpenAI and retains the v1 fallback', () => {
  const labs = readFileSync(new URL('../src/app/labs.ts', import.meta.url), 'utf8');
  assert.match(labs, /caps\.pipelineVersion === 'v1' \? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'/);
  assert.match(labs, /caps\.musicPromptTranslatorConfigured/);
  assert.doesNotMatch(labs, /if \(!caps\.musicPromptAdaptation\) musicGo\.disabled = true/);
});
