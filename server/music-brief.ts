/**
 * Named-reference detection and sanitisation for the music path.
 *
 * `containsNamedReference` gates a legal safety mechanism, so it is deliberately
 * lopsided: a false positive costs one cheap LLM call that is instructed to
 * change nothing, while a false negative sends an artist's name to a music
 * generator. Every ambiguous branch therefore returns true.
 *
 * KNOWN LIMIT, by construction: a bare all-lowercase name with no comparison
 * framing, no possessive and no quotes — “boards of canada and tycho” — carries
 * no lexical signal and is not caught here. Detecting it needs a name gazetteer,
 * which is a different mechanism with different maintenance. The downstream
 * stripReferences pass does not catch it either. If that gap matters the fix is
 * a gazetteer, not a looser rule here: loosening this one enough to catch it
 * would fire on most ordinary requests and re-flatten them.
 */

const SANITISER_MODEL = 'gpt-5.6-luna';
const SANITISER_PROVIDER = 'openai';

/** Reported when the deterministic path handled a request with no LLM call. */
export const NO_LLM_CALL = 'none';

export interface TranslatedReferences {
  prompt: string;
  removedReferences: string[];
}

/**
 * Capitalised words that are ordinary musical or descriptive vocabulary rather
 * than names. Kept deliberately small: anything not here that is capitalised
 * mid-sentence is treated as a possible name.
 */
const MUSICAL_VOCABULARY = new Set([
  // Pitch and key vocabulary, which is legitimately capitalised mid-sentence.
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'major', 'minor', 'sharp', 'flat',
  'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian', 'ionian',
  // Genre and texture words that users often capitalise.
  'ambient', 'classical', 'orchestral', 'cinematic', 'electronic', 'acoustic',
  'jazz', 'folk', 'blues', 'rock', 'pop', 'techno', 'house', 'garage', 'drone',
  'lo-fi', 'lofi', 'hi-fi', 'downtempo', 'trip-hop', 'synthwave', 'baroque',
  'romantic', 'gregorian', 'choral', 'minimal', 'minimalist', 'industrial',
  // Instrument families.
  'piano', 'cello', 'violin', 'viola', 'harp', 'guitar', 'bass', 'drums',
  'strings', 'brass', 'woodwind', 'organ', 'synth', 'synthesizer', 'choir',
  'percussion', 'marimba', 'kalimba', 'vibraphone', 'timpani', 'pad', 'pads',
  // Tempo and dynamics.
  'slow', 'fast', 'moderate', 'adagio', 'andante', 'allegro', 'largo',
  'forte', 'piano-dynamic', 'crescendo', 'rubato', 'legato', 'staccato',
  // Sentence-opening filler that carries no identity.
  'the', 'a-word', 'an', 'i', 'it', 'this', 'that', 'make', 'create', 'write',
]);

/**
 * Possessive bases common enough to be worth exempting. Everything else that
 * takes a possessive is treated as a possible name, including lowercase words:
 * users type artist names in lowercase constantly.
 */
const COMMON_POSSESSIVE_BASES = new Set([
  'song', 'songs', 'track', 'tracks', 'piece', 'pieces', 'music', 'score',
  'melody', 'rhythm', 'scene', 'image', 'picture', 'video', 'world', 'city',
  'night', 'day', 'morning', 'evening', 'forest', 'ocean', 'sea', 'river',
  'room', 'listener', 'player', 'user', 'today', 'tomorrow', 'yesterday',
  'nature', 'earth', 'sky', 'storm', 'fire', 'water', 'wind', 'rain',
]);

/**
 * Comparison framing. Anything following one of these is a reference to
 * something outside the request, whether or not it is capitalised.
 */
const COMPARISON_PATTERNS: RegExp[] = [
  /\bin the style of\b/i,
  // Bare “style” / “vibe” as a modifier: “aphex twin style pads” carries no
  // capitalisation and no “of”, so nothing else here would catch it.
  /\bstyles?\b/i,
  /\bvibes?\b/i,
  /\binspired by\b/i,
  /\bsounds? like\b/i,
  /\bsounding like\b/i,
  /\breminiscent of\b/i,
  /\bvibes? of\b/i,
  /\bfeel of\b/i,
  /\benergy of\b/i,
  /\bevocative of\b/i,
  /\bhomage to\b/i,
  /\btribute to\b/i,
  /\b(?:à|a) la\b/i,
  /\blike\b/i,
  /\b[a-z]+-(?:esque|like|core|ish)\b/i,
  /\bmeets\b/i,
  /\bcover of\b/i,
  /\bsoundtrack (?:to|from|of)\b/i,
  /\btheme (?:to|from)\b/i,
];

/** Paired quotes. Contractions must not count, so lone apostrophes are ignored. */
const QUOTE_PATTERNS: RegExp[] = [
  /"[^"]+"/,
  /[“”][^“”]+[“”]/,
  /«[^»]+»/,
  /(?:^|\s)'[^']+'(?=$|[\s.,;:!?])/,
  /(?:^|\s)‘[^’]+’(?=$|[\s.,;:!?])/,
];

const POSSESSIVE_PATTERN = /\b([\p{L}][\p{L}\p{M}-]*)['’]s\b/gu;

interface Token {
  word: string;
  sentenceInitial: boolean;
  /** True only for a capitalised follower inside the SAME sentence. */
  runsIntoCapital: boolean;
}

function tokenize(text: string): Token[] {
  const raw = [...text.matchAll(/[\p{L}][\p{L}\p{M}\p{N}'’-]*/gu)];
  const isCapitalised = (word: string) => /^[\p{Lu}]/u.test(word);
  // A sentence opener is the very start, or the first word after . ! ? : or a newline.
  const opensSentence = (index: number) =>
    /(?:^|[.!?:\n—]|^\s*[-*•])\s*$/.test(text.slice(0, raw[index].index));

  return raw.map((match, index) => {
    const next = raw[index + 1];
    return {
      word: match[0],
      sentenceInitial: opensSentence(index),
      // “Hans Zimmer” runs into a capital; “Sparse. Let” does not, because the
      // follower opens a new sentence of its own.
      runsIntoCapital: next !== undefined && isCapitalised(next[0]) && !opensSentence(index + 1),
    };
  }).filter((token) => isCapitalised(token.word) || /^[\p{Lu}]{2,}$/u.test(token.word));
}

/**
 * True when the text may contain a name. Conservative by construction: an
 * unrecognised capitalised word, any comparison framing, any possessive that is
 * not obviously a common noun, and any quoted span all trip it.
 */
export function containsNamedReference(text: string): boolean {
  const value = text?.trim();
  // No text is not a safe answer to give a generator, so treat it as suspect.
  if (!value) return true;

  for (const pattern of COMPARISON_PATTERNS) if (pattern.test(value)) return true;
  for (const pattern of QUOTE_PATTERNS) if (pattern.test(value)) return true;

  for (const match of value.matchAll(POSSESSIVE_PATTERN)) {
    const base = match[1].toLowerCase();
    if (!COMMON_POSSESSIVE_BASES.has(base)) return true;
  }

  for (const token of tokenize(value)) {
    const word = token.word.toLowerCase().replace(/['’]s$/, '');
    if (MUSICAL_VOCABULARY.has(word)) continue;
    // A lone capital opening a sentence is ordinary English. A capital that runs
    // into another capital, or sits mid-sentence, is name-shaped.
    if (token.sentenceInitial && !token.runsIntoCapital) continue;
    return true;
  }

  return false;
}

/**
 * The sanitiser prompt. Its entire job is substitution: names become the musical
 * characteristics they imply, and every other word survives untouched. The
 * previous adapter rewrote whole requests into restrained ambient beds, which is
 * why every track sounded the same; the negative instructions below exist
 * specifically to stop that from happening again.
 */
const SANITISER_INSTRUCTIONS = [
  'You remove named references from a music request and change nothing else.',
  'Replace every artist, band, song, album, composer, producer, label, film, game, brand, celebrity and other proper name with the musical characteristics it implies: instrumentation, tempo, groove, harmony, arrangement, production texture, performance feel, dynamics.',
  'Preserve every other word exactly as written. Keep the user’s own adjectives, structure, ordering, punctuation and length.',
  'Do NOT shorten. Do NOT tidy, rephrase, correct or improve the writing. Do NOT summarise.',
  'Do NOT add any of the following, or synonyms for them, unless the user wrote them first: ambient, restrained, stable, seamless, loopable, minimal, subtle, gentle, background, unobtrusive, atmospheric, evolving, sparse, understated.',
  'Do NOT add structural or production advice the user did not ask for, and do NOT describe how the track should begin, end or repeat.',
  'Never write “in the style of”, “inspired by”, “sounds like”, “reminiscent of” or any equivalent comparison.',
  'Do not reproduce lyrics, melodies, titles or signature phrases belonging to anything you removed. Describe transferable musical characteristics only.',
  'If the request contains no named reference, return it completely unchanged with an empty removedReferences array.',
  'Return every name you removed in removedReferences.',
].join(' ');

const SANITISER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: { type: 'string' },
    removedReferences: { type: 'array', items: { type: 'string' } },
  },
  required: ['prompt', 'removedReferences'],
} as const;

/**
 * Replaces named references with musical characteristics, leaving everything
 * else byte-identical. `apiKey` defaults to the ambient environment so the
 * exported signature stays single-argument, but callers that already resolved a
 * key through Vite's loadEnv should pass it.
 */
export async function translateReferences(
  text: string,
  apiKey: string | undefined = process.env.OPENAI_API_KEY,
): Promise<TranslatedReferences> {
  if (!apiKey) throw new Error('Reference translation needs OPENAI_API_KEY on the server.');

  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: SANITISER_MODEL,
      instructions: SANITISER_INSTRUCTIONS,
      input: [{ role: 'user', content: [{ type: 'input_text', text }] }],
      text: { format: { type: 'json_schema', name: 'sanitised_music_request', strict: true, schema: SANITISER_SCHEMA } },
    }),
  });

  const payload = await upstream.json() as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    error?: { message?: string };
  };
  if (!upstream.ok) {
    throw new Error(`Reference translation failed (${upstream.status}): ${payload.error?.message ?? 'unknown'}`);
  }

  const body = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!body) throw new Error('Reference translation returned no text.');

  const parsed = JSON.parse(body) as { prompt?: string; removedReferences?: string[] };
  const prompt = parsed.prompt?.trim();
  if (!prompt) throw new Error('Reference translation returned an empty prompt.');

  return {
    prompt,
    removedReferences: Array.isArray(parsed.removedReferences) ? parsed.removedReferences : [],
  };
}

export { SANITISER_MODEL, SANITISER_PROVIDER };
