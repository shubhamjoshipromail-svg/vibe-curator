import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildStylePrompt } from '../src/app/marketplace-prompt.ts';
import { createLatestTaskQueue, parseRoute, toPath } from '../src/app/router.ts';

test('Labs routes preserve their originating Market collection', () => {
  const route = {
    name: 'labs' as const,
    presetId: 'market-pixel-midnight-shrine',
    returnTo: 'marketplace' as const,
    returnCollection: 'pixel-art',
  };
  const path = toPath(route);
  assert.equal(path, '/labs/market-pixel-midnight-shrine?from=marketplace&collection=pixel-art');
  assert.deepEqual(parseRoute(path), route);
});

test('the route queue cannot let an intermediate slow navigation win', async () => {
  const rendered: string[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const schedule = createLatestTaskQueue(async (route: string) => {
    rendered.push(route);
    if (route === 'first') await firstBlocked;
  });

  const first = schedule('first');
  await schedule('intermediate');
  await schedule('latest');
  releaseFirst();
  await first;
  assert.deepEqual(rendered, ['first', 'latest']);
});

test('every collection prompt is cohesive and never renders an undefined style', () => {
  for (const collection of [
    { id: 'pixel-art', mood: 'Nostalgic', stylePrompt: 'Authentic hand-authored 16-bit pixel art.' },
    { id: 'living-scenes', mood: 'Still first · Generative' },
  ]) {
    const prompt = buildStylePrompt(collection, {
      subject: 'an original scene', setting: '', time: 'artist choice', weather: '', mood: collection.mood,
    });
    assert.doesNotMatch(prompt, /undefined/i, collection.id);
    assert.match(prompt, /Full-screen 16:9 background/, collection.id);
  }
});

test('Market navigation has one clear audio path and explicit in-app Back routes', () => {
  const marketplace = readFileSync(new URL('../src/app/marketplace.ts', import.meta.url), 'utf8');
  const explore = readFileSync(new URL('../src/app/explore.ts', import.meta.url), 'utf8');
  const labs = readFileSync(new URL('../src/app/labs.ts', import.meta.url), 'utf8');
  const library = readFileSync(new URL('../src/preset/library.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(marketplace, /Preview score|new Audio\(/);
  assert.doesNotMatch(explore, /history\.back\(/);
  assert.doesNotMatch(labs, /history\.back\(/);
  assert.match(explore, /PROMPT_DEFINED_STYLE/);
  assert.match(marketplace, /returnCollection: post\.collection/);
  const forkBody = library.slice(library.indexOf('export function forkPreset'), library.indexOf('export function createMediaPreset'));
  assert.doesNotMatch(forkBody, /loadSaved\(|existing/, 'Open & remix must not resurrect an older saved draft');
});
