import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  buildMusicProviderPrompt,
  parseMusicGenerationRequest,
  resolveRequestedMusicBrief,
} from '../server/music-request.ts';

const cardBrief = {
  mode: 'ambient_score',
  vocals: 'none',
  music: {
    mood: ['noir'],
    tempo: 'slow',
    instrumentation: ['organ'],
    evolution: 'slowly widening',
  },
  ambience: { enabled: true, elements: ['rain'], prominence: 0.7 },
  playback: { mode: 'crossfade', targetDurationSeconds: 120, crossfadeSeconds: 8 },
} as const;

test('a complete structured brief is accepted without a fallback prompt', () => {
  const request = parseMusicGenerationRequest({ brief: cardBrief, userRequest: '', vocalMode: 'auto', prompt: '' });
  const brief = resolveRequestedMusicBrief(request);

  assert.equal(brief.mode, cardBrief.mode);
  assert.equal(request.provider, 'lyria');
  assert.equal(brief.vocals, cardBrief.vocals);
  assert.deepEqual(brief.music.mood, cardBrief.music.mood);
  assert.equal(brief.music.tempo, cardBrief.music.tempo);
  assert.deepEqual(brief.music.instrumentation, cardBrief.music.instrumentation);
  assert.equal(brief.music.evolution, cardBrief.music.evolution);
  assert.deepEqual(brief.ambience, cardBrief.ambience);
  assert.equal(brief.playback.mode, cardBrief.playback.mode);
  assert.equal(brief.playback.targetDurationSeconds, cardBrief.playback.targetDurationSeconds);
  assert.equal(brief.playback.crossfadeSeconds, cardBrief.playback.crossfadeSeconds);

  const provider = buildMusicProviderPrompt(brief, request.userRequest);
  assert.ok(provider.prompt.length > 0);
  assert.equal(provider.needsReferenceTranslation, false);
});

test('provider routing accepts Lyria and rejects unknown or premium bypass values', () => {
  assert.equal(parseMusicGenerationRequest({ prompt: 'soft piano', provider: 'lyria' }).provider, 'lyria');
  assert.equal(parseMusicGenerationRequest({ prompt: 'soft piano', provider: 'elevenlabs' }).provider, 'elevenlabs');
  assert.throws(() => parseMusicGenerationRequest({ prompt: 'soft piano', provider: 'cheap-wrapper' }), /provider/);
});

test('user words and the vocal control retain precedence over a submitted card brief', () => {
  const request = parseMusicGenerationRequest({
    brief: cardBrief,
    userRequest: 'harp, fast and hopeful',
    vocalMode: 'vocals',
    prompt: 'harp, fast and hopeful',
  });
  const brief = resolveRequestedMusicBrief(request);

  assert.equal(brief.mode, 'ambient_score');
  assert.equal(brief.vocals, 'required');
  assert.deepEqual(brief.music.instrumentation, ['harp']);
  assert.equal(brief.music.tempo, 'fast');
  assert.deepEqual(brief.music.mood, ['hopeful']);
  assert.equal(brief.music.evolution, 'slowly widening');
  assert.deepEqual(brief.ambience, cardBrief.ambience);
  assert.equal(brief.playback.mode, cardBrief.playback.mode);
  assert.equal(brief.playback.targetDurationSeconds, cardBrief.playback.targetDurationSeconds);
  assert.equal(brief.playback.crossfadeSeconds, cardBrief.playback.crossfadeSeconds);
});

test('malformed structured briefs are rejected instead of being trusted as MusicBrief', () => {
  assert.throws(
    () => parseMusicGenerationRequest({
      prompt: 'anything',
      brief: { ...cardBrief, music: { ...cardBrief.music, mood: 'not-an-array' } },
    }),
    /Invalid music brief music\.mood/,
  );
  assert.throws(
    () => parseMusicGenerationRequest({
      prompt: 'anything',
      brief: { ...cardBrief, playback: { ...cardBrief.playback, loopStart: 40 } },
    }),
    /Invalid music brief playback loop/,
  );
  assert.throws(
    () => parseMusicGenerationRequest({
      prompt: 'anything',
      sceneContext: {
        environment: [], observedElements: [], emotionalQualities: [],
        energy: 'explosive', visualRhythm: 'steady', scale: 'room', warmth: 0.5, darkness: 0.5,
      },
    }),
    /Invalid music request sceneContext/,
  );
});

test('legacy prompt-only clients keep their existing resolver path', () => {
  const request = parseMusicGenerationRequest({ prompt: 'slow cello instrumental', vocalMode: 'auto' });
  const brief = resolveRequestedMusicBrief(request);

  assert.equal(brief.mode, 'instrumental_score');
  assert.equal(brief.vocals, 'none');
  assert.equal(brief.music.tempo, 'slow');
  assert.deepEqual(brief.music.instrumentation, ['cello']);
});

test('reference detection covers untrusted structured-brief fields', () => {
  const request = parseMusicGenerationRequest({
    prompt: 'soft',
    userRequest: 'soft',
    vocalMode: 'auto',
    brief: {
      ...cardBrief,
      music: { ...cardBrief.music, mood: ['in the style of Taylor Swift'] },
    },
  });
  const provider = buildMusicProviderPrompt(resolveRequestedMusicBrief(request), request.userRequest);

  assert.match(provider.prompt, /Taylor Swift/);
  assert.equal(provider.needsReferenceTranslation, true);
});
