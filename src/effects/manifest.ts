/**
 * An effect manifest is a generated effect made REUSABLE.
 *
 * The first version of GEN-EFFECT returned raw GLSL and nothing else, which
 * meant "customize" could only ever mean "generate it again and hope". A
 * manifest carries the prompt that made it, the parameters it exposes, and its
 * lineage — so an effect can be reopened, retuned, duplicated and remixed like
 * a real document.
 */

/** One user-tunable knob the generated shader declared. */
export interface EffectParam {
  /** Uniform name: uP0..uP3. Fixed set, so no dynamic uniform plumbing. */
  key: 'uP0' | 'uP1' | 'uP2' | 'uP3';
  /** Human label, e.g. "Drift Speed". */
  label: string;
  min: number;
  max: number;
  value: number;
}

export interface EffectManifest {
  id: string;
  name: string;
  /** What it does, in one line, for the card. */
  notes: string;
  /** The prompt that produced it. Editable — this is how you remix. */
  prompt: string;
  /** The `vec4 effect(...)` function body. */
  glsl: string;
  params: EffectParam[];
  /** Provenance, so a saved effect can be reproduced or audited later. */
  provider: string;
  model: string;
  version: number;
  createdAt: string;
  /** Set when duplicated or re-prompted from another effect. */
  parentId?: string;
  /** Off when the user toggles it in Labs without deleting it. */
  enabled: boolean;
}

export const PARAM_KEYS = ['uP0', 'uP1', 'uP2', 'uP3'] as const;

/** Coerce whatever the model returned into a safe, bounded param list. */
export function normalizeParams(raw: unknown): EffectParam[] {
  if (!Array.isArray(raw)) return [];
  const out: EffectParam[] = [];
  for (const item of raw.slice(0, 4)) {
    const p = item as Partial<EffectParam>;
    const key = PARAM_KEYS[out.length];
    const min = Number.isFinite(p.min) ? Number(p.min) : 0;
    const max = Number.isFinite(p.max) ? Number(p.max) : 1;
    const value = Number.isFinite(p.value) ? Number(p.value) : (min + max) / 2;
    out.push({
      key,
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : `Param ${out.length + 1}`,
      min,
      max: max > min ? max : min + 1,
      value: Math.min(Math.max(value, min), max),
    });
  }
  return out;
}
