/**
 * Standalone shader compilation, used as the verification step in the
 * generation loop.
 *
 * Pixi compiles filters lazily on first render, which is far too late — by then
 * a broken shader is a blank screen with a console warning. Compiling here, on
 * a throwaway WebGL2 context, means a failure is a precise compiler log we can
 * hand straight back to the model. Machine-generated, line-numbered feedback is
 * exactly what makes the retry loop converge instead of flail.
 */

let gl: WebGL2RenderingContext | null | undefined;

function context(): WebGL2RenderingContext | null {
  if (gl === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    gl = canvas.getContext('webgl2');
  }
  return gl;
}

export interface CompileResult {
  ok: boolean;
  log: string;
}

/**
 * Pixi's own fragment preamble, reproduced exactly.
 *
 * This matters more than it looks. Pixi emits NO `#version` directive, which
 * means a WebGL2 context compiles filter shaders as **GLSL ES 1.00**, not 3.00
 * — the ES3-looking `in` / `out` / `texture()` syntax only works because of the
 * compatibility defines below.
 *
 * The first version of this file wrapped the source in `#version 300 es` and
 * happily passed shaders that the renderer then refused to link: integer
 * `clamp()` and dynamic matrix indexing are legal in ES 3.00 and illegal in
 * ES 1.00. A verification step that compiles against a different language than
 * the renderer is worse than no verification, because it reports success.
 *
 * If this ever drifts from Pixi's preprocessor, the gate silently starts lying
 * again — which is why the exact source is quoted here rather than approximated.
 */
const PIXI_PREAMBLE = [
  '#ifdef GL_ES',
  '#define in varying',
  '#define finalColor gl_FragColor',
  '#define texture texture2D',
  '#endif',
  'precision mediump float;',
].join('\n');

/** Pixi strips the `out` declaration on the ES1 path; so must we. */
function stripOutDeclaration(source: string): string {
  return source.replace(/^\s*out\s+vec4\s+finalColor\s*;\s*$/m, '');
}

/**
 * Compile a harness-wrapped fragment shader exactly as the renderer will.
 */
export function compileFragment(source: string): CompileResult {
  const ctx = context();
  if (!ctx) {
    // No WebGL2 means we cannot verify. Say so rather than reporting success.
    return { ok: false, log: 'WebGL2 unavailable; cannot verify shader.' };
  }

  const shader = ctx.createShader(ctx.FRAGMENT_SHADER);
  if (!shader) return { ok: false, log: 'Could not allocate a shader object.' };

  ctx.shaderSource(shader, `${PIXI_PREAMBLE}\n${stripOutDeclaration(source)}`);
  ctx.compileShader(shader);

  const ok = ctx.getShaderParameter(shader, ctx.COMPILE_STATUS) as boolean;
  const log = ctx.getShaderInfoLog(shader) ?? '';
  ctx.deleteShader(shader);

  return { ok, log: log.trim() };
}

export const PREAMBLE_LINE_COUNT = PIXI_PREAMBLE.split('\n').length;

/**
 * Re-number compiler errors against the model's own code.
 *
 * The compiler counts lines in the assembled shader, but the model only wrote
 * the tail of it. Handing back raw line numbers points at harness code the
 * model never saw and cannot fix.
 */
export function rebaseLog(log: string, harnessLineCount: number): string {
  return log.replace(/ERROR:\s*(\d+):(\d+)/g, (_m, col, line) => {
    const rebased = Number(line) - harnessLineCount;
    return rebased > 0 ? `ERROR: ${col}:${rebased}` : `ERROR: ${col}:${line} (in harness)`;
  });
}
