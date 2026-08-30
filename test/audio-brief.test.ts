import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { MusicBrief, SceneAudioContext } from '../src/audio/brief.ts';
import { renderProviderPrompt } from '../src/audio/render-prompt.ts';
import { resolveMusicBrief } from '../src/audio/resolve.ts';

const scene = (overrides: Partial<SceneAudioContext> = {}): SceneAudioContext => ({
  environment: ['cabin', 'night'],
  observedElements: [],
  emotionalQualities: ['tender'],
  energy: 'still',
  visualRhythm: 'fluid',
  scale: 'intimate',
  warmth: 0.5,
  darkness: 0.5,
  ...overrides,
});

const emptyBrief = (mode: MusicBrief['mode'] = 'instrumental_score'): MusicBrief => ({
  mode,
  vocals: 'none',
  music: { mood: [] },
  ambience: { enabled: false, elements: [], prominence: 0 },
  playback: { mode: 'once', targetDurationSeconds: 120, crossfadeSeconds: 3 },
});

test('a visible fire becomes ambience and never instrumentation', () => {
  const brief = resolveMusicBrief({
    userRequest: 'slow classical, cello-forward',
    vocalControl: 'auto',
    scene: scene({ observedElements: ['fire'], warmth: 0.9, darkness: 0.7 }),
  });

  assert.deepEqual(brief.music.instrumentation, ['cello']);
  assert.equal(brief.music.instrumentation?.includes('fire'), false);
  assert.equal(brief.ambience.elements.includes('fire'), true);
  assert.equal(brief.ambience.enabled, true);
  assert.equal(brief.music.tempo, 'slow');
  assert.deepEqual(brief.music.mood, ['classical']);

  const prompt = renderProviderPrompt(brief, 'elevenlabs');
  assert.match(prompt, /Instrumentation: cello\./);
  assert.match(prompt, /Ambience: fire\./);
  assert.doesNotMatch(prompt, /Instrumentation:[^.]*fire/);
});

test('observed elements are the only scene field that reaches ambience, and reach nothing else', () => {
  const brief = resolveMusicBrief({
    vocalControl: 'auto',
    scene: scene({ observedElements: ['fire', 'rain'], emotionalQualities: ['calm'], warmth: 0.9, darkness: 0.2 }),
  });

  assert.deepEqual(brief.ambience.elements, ['fire', 'rain']);
  assert.equal(brief.music.instrumentation, undefined);
  assert.deepEqual(brief.music.mood, ['calm', 'warm', 'bright', 'still']);
  for (const element of ['fire', 'rain']) {
    assert.equal(brief.music.mood.includes(element), false, element);
    assert.equal(JSON.stringify(brief.music).includes(element), false, element);
  }
});

test("vocalControl 'instrumental' beats a user request asking for a chorus", () => {
  const brief = resolveMusicBrief({
    userRequest: 'big anthemic chorus with layered vocals',
    vocalControl: 'instrumental',
  });

  assert.equal(brief.vocals, 'none');
  assert.equal(brief.mode, 'song');
  assert.match(renderProviderPrompt(brief, 'elevenlabs'), /No vocals, no vocal samples, no spoken word\./);
});

test("vocalControl 'auto' defers to an explicit request, and 'vocals' overrides one", () => {
  assert.equal(resolveMusicBrief({ userRequest: 'a song with lyrics', vocalControl: 'auto' }).vocals, 'required');
  assert.equal(resolveMusicBrief({ userRequest: 'strictly instrumental', vocalControl: 'auto' }).vocals, 'none');
  assert.equal(resolveMusicBrief({ userRequest: 'strictly instrumental', vocalControl: 'vocals' }).vocals, 'required');
});

test('an empty brief renders a short prompt rather than a padded one', () => {
  const prompt = renderProviderPrompt(emptyBrief(), 'elevenlabs');

  assert.equal(prompt, 'An instrumental score. No vocals, no vocal samples, no spoken word.');
  for (const padding of ['Mood:', 'Instrumentation:', 'Tempo:', 'Rhythm:', 'Density:', 'Evolution:', 'Ambience:', 'Avoid:']) {
    assert.equal(prompt.includes(padding), false, padding);
  }
});

test('instrumental_score renders no restraint negatives', () => {
  const brief = resolveMusicBrief({ userRequest: 'instrumental score, piano', vocalControl: 'auto' });
  assert.equal(brief.mode, 'instrumental_score');

  const prompt = renderProviderPrompt(brief, 'elevenlabs');
  assert.equal(prompt.includes('Avoid:'), false);
  for (const negative of ['no melody', 'no chord progression', 'no musical pulse', 'no hook', 'no repeated motif', 'no drum kit']) {
    assert.equal(prompt.includes(negative), false, negative);
  }
});

test('soundscape and ambient_score each carry their own negatives', () => {
  const soundscape = renderProviderPrompt({ ...emptyBrief('soundscape') }, 'elevenlabs');
  assert.match(soundscape, /Avoid: no melody, no chord progression, no musical pulse\./);

  const ambient = renderProviderPrompt({ ...emptyBrief('ambient_score') }, 'elevenlabs');
  assert.match(ambient, /Avoid: no hook, no repeated motif more than twice consecutively, no drum kit\./);

  assert.equal(renderProviderPrompt(emptyBrief('song'), 'elevenlabs').includes('Avoid:'), false);
});

test('the prompt never speaks for mastering', () => {
  const brief = resolveMusicBrief({
    userRequest: 'sparse ambient, felt piano, no drums',
    vocalControl: 'instrumental',
    scene: scene({ observedElements: ['wind'] }),
  });
  const prompt = renderProviderPrompt(brief, 'elevenlabs').toLowerCase();

  for (const owned of ['fade in', 'fade-in', 'fade out', 'fade-out', 'trailing silence', 'seamless', 'loop', 'dramatic arc', 'stable arrangement']) {
    assert.equal(prompt.includes(owned), false, owned);
  }
});

test('playback defaults follow the mode', () => {
  const plan = (mode: MusicBrief['mode'], userRequest: string) =>
    resolveMusicBrief({ userRequest, vocalControl: 'auto' }).playback;

  assert.deepEqual(plan('soundscape', 'a soundscape'), {
    mode: 'crossfade', targetDurationSeconds: 120, crossfadeSeconds: 10, loopStart: undefined, loopEnd: undefined,
  });
  assert.deepEqual(plan('ambient_score', 'ambient'), {
    mode: 'crossfade', targetDurationSeconds: 120, crossfadeSeconds: 8, loopStart: undefined, loopEnd: undefined,
  });
  assert.deepEqual(plan('instrumental_score', 'an instrumental score'), {
    mode: 'crossfade', targetDurationSeconds: 120, crossfadeSeconds: 3, loopStart: undefined, loopEnd: undefined,
  });
  assert.deepEqual(plan('song', 'a song with lyrics'), {
    mode: 'once', targetDurationSeconds: 180, crossfadeSeconds: 0, loopStart: undefined, loopEnd: undefined,
  });
});

test('card direction outranks the scene but yields to an explicit request', () => {
  const brief = resolveMusicBrief({
    userRequest: 'harp',
    vocalControl: 'auto',
    cardDirection: {
      mode: 'soundscape',
      music: { instrumentation: ['organ'], tempo: 'moderate', evolution: 'slowly widening' },
      ambience: { prominence: 0.5 },
    },
    scene: scene({ observedElements: ['surf'], emotionalQualities: ['vast'] }),
  });

  assert.equal(brief.mode, 'soundscape');
  assert.deepEqual(brief.music.instrumentation, ['harp']);
  assert.equal(brief.music.tempo, 'moderate');
  assert.equal(brief.music.evolution, 'slowly widening');
  assert.deepEqual(brief.music.mood, ['vast', 'still']);
  assert.deepEqual(brief.ambience.elements, ['surf']);
  assert.equal(brief.ambience.prominence, 0.5);
});
