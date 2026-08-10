/**
 * The GEN-EFFECT contract.
 *
 * Generated effects are GLSL fragment shaders, not JavaScript. That constraint
 * is the whole reason this feature is safe to ship: a fragment shader cannot
 * reach the network, the filesystem, or the DOM. The worst a bad one can do is
 * look wrong or run slowly — and the static guard below catches the one case
 * that could actually hang the GPU.
 *
 * The model writes ONE function. Everything around it — uniforms, helpers,
 * main() — is fixed harness code it never sees or edits, so it cannot break the
 * renderer plumbing no matter what it emits.
 */

/** Uniform names and helpers the model may rely on. Mirrored in the system prompt. */
export const HARNESS_PREAMBLE = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

// Seconds since the session started. Always increasing.
uniform float uTime;
// Render target size in pixels.
uniform vec2 uResolution;
// Session arc energy, 0..1. Scale motion and intensity by this.
uniform float uEnergy;
// The user's Intensity slider, 0..1. Multiply your effect's strength by this so
// the control works on every effect without the effect knowing it exists.
uniform float uIntensity;
// Up to four effect-specific knobs, surfaced as labelled sliders in Labs.
// Declare what they mean in the params list; the harness always provides all four.
uniform float uP0;
uniform float uP1;
uniform float uP2;
uniform float uP3;
// The vibe's colour ramp and the audio spectrum, packed into matrices rather
// than arrays. Array uniforms inside a Pixi UniformGroup fail to bind and the
// program silently refuses to run — mat4/vec4 bind reliably. The model never
// touches these directly; it uses palette() and audio() below.
uniform mat4 uPaletteLo;   // ramp entries 0-3, rgb in .rgb
uniform mat4 uPaletteHi;   // ramp entries 4-7
uniform vec4 uAudioLo;     // spectrum bands 0-3
uniform vec4 uAudioHi;     // spectrum bands 4-7

// Written as if-chains with constant indices on purpose. The renderer compiles
// these as GLSL ES 1.00, which has no integer clamp() and forbids indexing a
// matrix or array with a non-constant expression.
vec3 palette(int i) {
  if (i <= 0) return uPaletteLo[0].rgb;
  if (i == 1) return uPaletteLo[1].rgb;
  if (i == 2) return uPaletteLo[2].rgb;
  if (i == 3) return uPaletteLo[3].rgb;
  if (i == 4) return uPaletteHi[0].rgb;
  if (i == 5) return uPaletteHi[1].rgb;
  if (i == 6) return uPaletteHi[2].rgb;
  return uPaletteHi[3].rgb;
}
float audio(int i) {
  if (i <= 0) return uAudioLo.x;
  if (i == 1) return uAudioLo.y;
  if (i == 2) return uAudioLo.z;
  if (i == 3) return uAudioLo.w;
  if (i == 4) return uAudioHi.x;
  if (i == 5) return uAudioHi.y;
  if (i == 6) return uAudioHi.z;
  return uAudioHi.w;
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
`.trim();

const HARNESS_MAIN = `
void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  finalColor = effect(vTextureCoord, src);
}
`.trim();

/** Wrap a model-authored `effect()` body into a complete Pixi filter shader. */
export function buildFragmentSource(effectFn: string): string {
  return `${HARNESS_PREAMBLE}\n\n${effectFn.trim()}\n\n${HARNESS_MAIN}\n`;
}

export interface GuardResult {
  ok: boolean;
  errors: string[];
}

/**
 * Static guard, run before the shader ever reaches a compiler.
 *
 * The compiler catches syntax; it does NOT catch a shader that compiles fine
 * and then spins forever. An unbounded loop in a fragment shader hangs the GPU
 * and can take the whole tab (or the compositor) with it, so loop bounds are
 * checked here rather than hoped for.
 */
export function guardEffectSource(src: string): GuardResult {
  const errors: string[] = [];

  if (!/vec4\s+effect\s*\(/.test(src)) {
    errors.push('Must define `vec4 effect(vec2 uv, vec4 src)`.');
  }
  if (/\bwhile\s*\(/.test(src) || /\bdo\s*\{/.test(src)) {
    errors.push('`while` and `do` loops are not allowed — they can hang the GPU. Use a `for` loop with a literal bound.');
  }
  if (/\bvoid\s+main\s*\(/.test(src)) {
    errors.push('Do not define main() — the harness provides it.');
  }
  if (/#\s*(version|include|extension)/.test(src)) {
    errors.push('Preprocessor directives are not allowed.');
  }
  if (/\buniform\b/.test(src)) {
    errors.push('Do not declare uniforms — use the ones the harness provides.');
  }

  // Every `for` must have a literal upper bound, and a small one. A loop bound
  // by a uniform is unbounded as far as the compiler is concerned.
  const MAX_ITERATIONS = 64;
  const forHeaders = src.match(/for\s*\([^)]*\)/g) ?? [];
  for (const header of forHeaders) {
    const bound = header.match(/[<>]=?\s*(\d+)/);
    if (!bound) {
      errors.push(`Loop \`${header}\` has no literal bound. Compare against a number, e.g. \`i < 16\`.`);
    } else if (Number(bound[1]) > MAX_ITERATIONS) {
      errors.push(`Loop \`${header}\` exceeds the ${MAX_ITERATIONS} iteration cap.`);
    }
  }

  return { ok: errors.length === 0, errors };
}
