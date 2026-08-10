/**
 * Pipeline fixtures.
 *
 * These stand in for model output so the GEN-EFFECT path can be verified
 * end-to-end without an API key: the harness, the static guard, the compiler,
 * the error rebasing, and the live application to a layer. The only link they
 * do not exercise is the model call itself.
 *
 * Two of the three are deliberately broken, because a validator that has only
 * ever seen valid input is not a validator.
 */

/** Valid. Ambient scanlines, palette bloom, grain, vignette — all energy-scaled. */
export const FIXTURE_VALID = `
vec4 effect(vec2 uv, vec4 src) {
  vec3 col = src.rgb;

  // Slow scanline drift. Low amplitude on purpose: this sits behind work.
  float scan = sin(uv.y * uResolution.y * 0.8 + uTime * 0.6) * 0.5 + 0.5;
  col *= 1.0 - 0.07 * scan * uEnergy;

  // Bloom in the highlights, tinted from the scene's own ramp.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += palette(6) * pow(lum, 3.0) * 0.22 * uEnergy;

  // Drifting grain.
  float g = noise21(uv * uResolution * 0.5 + uTime * 7.0);
  col += (g - 0.5) * 0.035;

  // Vignette.
  vec2 d = uv - 0.5;
  col *= 1.0 - dot(d, d) * 0.65;

  return vec4(col, src.a);
}
`.trim();

/** Invalid: missing semicolon and an undeclared identifier. The compiler catches this. */
export const FIXTURE_COMPILE_ERROR = `
vec4 effect(vec2 uv, vec4 src) {
  vec3 col = src.rgb
  col += someUndeclaredThing * 2.0;
  return vec4(col, src.a);
}
`.trim();

/** Invalid: an unbounded loop. Compiles fine; hangs the GPU. Only the guard catches this. */
export const FIXTURE_GUARD_VIOLATION = `
vec4 effect(vec2 uv, vec4 src) {
  float acc = 0.0;
  int i = 0;
  while (i < 100000) { acc += 0.001; i++; }
  return vec4(src.rgb * acc, src.a);
}
`.trim();
