import type { MusicBrief, MusicMode, VocalRequirement } from './brief';

/**
 * Renders a `MusicBrief` into a provider prompt.
 *
 * Hard rule: a clause is emitted only when the brief holds a value for it. No
 * defaults are substituted, nothing is padded, and no restraint language is
 * added that the brief did not ask for.
 *
 * Fades, trailing silence, seamless repetition and arrangement arc are owned by
 * mastering, so none of them are ever mentioned here.
 */

const MODE_PREAMBLE: Record<MusicMode, string> = {
  soundscape: 'A continuous environmental soundscape.',
  ambient_score: 'An ambient score.',
  instrumental_score: 'An instrumental score.',
  song: 'A song.',
};

const VOCAL_DECLARATION: Record<VocalRequirement, string> = {
  none: 'No vocals, no vocal samples, no spoken word.',
  optional: 'Vocals optional.',
  required: 'Vocals required.',
};

/** Restraint the mode itself implies. Anything else must come from the brief. */
const MODE_NEGATIVES: Record<MusicMode, string[]> = {
  soundscape: ['no melody', 'no chord progression', 'no musical pulse'],
  ambient_score: ['no hook', 'no repeated motif more than twice consecutively', 'no drum kit'],
  instrumental_score: [],
  song: [],
};

function list(values: string[] | undefined): string | undefined {
  const items = values?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
  return items.length > 0 ? items.join(', ') : undefined;
}

export function renderProviderPrompt(brief: MusicBrief, provider: 'elevenlabs' | 'lyria'): string {
  void provider;
  const clauses: string[] = [];

  clauses.push(MODE_PREAMBLE[brief.mode]);
  clauses.push(VOCAL_DECLARATION[brief.vocals]);

  // A repeating track has no runway, so it must open already sounding finished.
  if (brief.playback.mode !== 'once') clauses.push('Begin at full texture.');

  const mood = list(brief.music.mood);
  if (mood) clauses.push(`Mood: ${mood}.`);

  const instrumentation = list(brief.music.instrumentation);
  if (instrumentation) clauses.push(`Instrumentation: ${instrumentation}.`);

  if (brief.music.tempo) clauses.push(`Tempo: ${brief.music.tempo}.`);
  if (brief.music.rhythm) clauses.push(`Rhythm: ${brief.music.rhythm}.`);
  if (brief.music.density) clauses.push(`Density: ${brief.music.density}.`);
  if (brief.music.evolution) clauses.push(`Evolution: ${brief.music.evolution}.`);

  const elements = brief.ambience.enabled ? list(brief.ambience.elements) : undefined;
  if (elements) clauses.push(`Ambience: ${elements}.`);

  const negatives = list([...new Set([...(brief.music.avoid ?? []), ...MODE_NEGATIVES[brief.mode]])]);
  if (negatives) clauses.push(`Avoid: ${negatives}.`);

  return clauses.join(' ');
}
