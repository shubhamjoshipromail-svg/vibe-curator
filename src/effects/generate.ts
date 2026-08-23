import { buildFragmentSource, guardEffectSource, HARNESS_PREAMBLE } from './harness';
import { compileFragment, rebaseLog, PREAMBLE_LINE_COUNT } from './compile';
import { EffectFilter } from './filter';
import { normalizeParams, type EffectManifest } from './manifest';
import { newId } from '../preset/types';

const CACHE_KEY = 'vibe.effect-cache.v1';

/**
 * The GEN-EFFECT generation loop.
 *
 * The interesting part is not the model call — it is the self-healing retry.
 * A GLSL compiler produces precise, line-numbered, machine-generated errors,
 * which is close to ideal feedback for a model. Feeding the compiler log back
 * turns "the model sometimes writes invalid GLSL" from a correctness problem
 * into a latency one.
 *
 * The API key never reaches this file. Requests go to a same-origin proxy that
 * holds the key server-side — in dev that is a Vite middleware, and later the
 * Worker or desktop main process, with the same route shape.
 */

export interface GeneratedEffect {
  manifest: EffectManifest;
  /** Full harness-wrapped shader that actually compiled. */
  fragment: string;
  filter: EffectFilter;
  attempts: number;
  cacheHit?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface GenerateOptions {
  /** Vibe context so the effect can be written against the actual palette. */
  paletteRamp: string[];
  renderStyle: string;
  maxAttempts?: number;
  onProgress?: (message: string) => void;
  /** Set when re-prompting an existing effect, to record lineage. */
  parentId?: string;
}

interface ShaderResponse {
  name: string;
  notes: string;
  glsl: string;
  params?: unknown;
  generation?: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
}

function buildManifest(
  res: ShaderResponse,
  prompt: string,
  parentId?: string,
): EffectManifest {
  return {
    id: newId('fx'),
    name: res.name,
    notes: res.notes,
    prompt,
    glsl: res.glsl,
    params: normalizeParams(res.params),
    provider: res.generation?.provider ?? 'anthropic',
    model: res.generation?.model ?? 'unknown',
    version: 1,
    createdAt: new Date().toISOString(),
    parentId,
    enabled: true,
  };
}

/** Build a live filter from a stored manifest — how a saved effect comes back. */
export function instantiate(manifest: EffectManifest): { fragment: string; filter: EffectFilter } {
  const guard = guardEffectSource(manifest.glsl);
  if (!guard.ok) throw new Error(`"${manifest.name}" failed its guard:\n${guard.errors.join('\n')}`);

  const fragment = buildFragmentSource(manifest.glsl);
  const compiled = compileFragment(fragment);
  if (!compiled.ok) {
    throw new Error(`"${manifest.name}" failed to compile:\n${rebaseLog(compiled.log, harnessOffset())}`);
  }

  const filter = new EffectFilter(fragment, manifest.name);
  filter.setParams(manifest.params);
  return { fragment, filter };
}

/** Lines the harness prepends, so compiler line numbers can be rebased onto the model's code. */
function harnessOffset(): number {
  return PREAMBLE_LINE_COUNT + HARNESS_PREAMBLE.split('\n').length + 2;
}

async function requestShader(
  prompt: string,
  opts: GenerateOptions,
  previous?: { glsl: string; error: string },
): Promise<ShaderResponse> {
  const res = await fetch('/api/gen/shader', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({
      prompt,
      paletteRamp: opts.paletteRamp,
      renderStyle: opts.renderStyle,
      previous,
    }),
  });

  if (!res.ok) {
    let message = 'The effect could not be generated right now.';
    try {
      const detail = (await res.json()) as { message?: string };
      if (detail.message) message = detail.message;
    } catch {
      // Provider details deliberately remain in server logs.
    }
    throw new Error(message);
  }
  return (await res.json()) as ShaderResponse;
}

interface CacheEntry {
  key: string;
  response: ShaderResponse;
  savedAt: string;
}

function requestKey(prompt: string, opts: GenerateOptions): string {
  return JSON.stringify([
    prompt.trim().toLowerCase().replace(/\s+/g, ' '),
    opts.renderStyle,
    opts.paletteRamp,
  ]);
}

function readCache(): CacheEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    const next = [entry, ...readCache().filter((e) => e.key !== entry.key)].slice(0, 20);
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[vibe] effect cache unavailable', err);
  }
}

export async function generateEffect(
  prompt: string,
  opts: GenerateOptions,
): Promise<GeneratedEffect> {
  const key = requestKey(prompt, opts);
  const cached = readCache().find((entry) => entry.key === key);
  if (cached) {
    const manifest = buildManifest(cached.response, prompt, opts.parentId);
    const { fragment, filter } = instantiate(manifest);
    opts.onProgress?.('Reusing a saved effect…');
    return { manifest, fragment, filter, attempts: 0, cacheHit: true };
  }

  const maxAttempts = opts.maxAttempts ?? 3;
  let previous: { glsl: string; error: string } | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    opts.onProgress?.(attempt === 1 ? 'Generating…' : `Fixing errors (attempt ${attempt})…`);

    const result = await requestShader(prompt, opts, previous);

    // Static guard first: it catches the class of problem a compiler cannot,
    // and it costs nothing.
    const guard = guardEffectSource(result.glsl);
    if (!guard.ok) {
      previous = { glsl: result.glsl, error: guard.errors.join('\n') };
      continue;
    }

    const fragment = buildFragmentSource(result.glsl);
    const compiled = compileFragment(fragment);
    if (!compiled.ok) {
      previous = { glsl: result.glsl, error: rebaseLog(compiled.log, harnessOffset()) };
      continue;
    }

    const manifest = buildManifest(result, prompt, opts.parentId);
    const filter = new EffectFilter(fragment, manifest.name);
    filter.setParams(manifest.params);

    writeCache({ key, response: result, savedAt: new Date().toISOString() });
    return {
      manifest,
      fragment,
      filter,
      attempts: attempt,
      usage: result.generation
        ? { inputTokens: result.generation.inputTokens, outputTokens: result.generation.outputTokens }
        : undefined,
    };
  }

  throw new Error(
    `Could not produce a valid shader in ${maxAttempts} attempts.\nLast error:\n${previous?.error ?? 'unknown'}`,
  );
}

/**
 * Build a filter from GLSL that did not come from the model — a saved effect,
 * or a fixture. Runs the same guard and compile path, because a shader loaded
 * from disk deserves exactly as much trust as a generated one.
 */
export function compileEffect(manifest: EffectManifest): GeneratedEffect {
  const { fragment, filter } = instantiate(manifest);
  return { manifest, fragment, filter, attempts: 0 };
}
