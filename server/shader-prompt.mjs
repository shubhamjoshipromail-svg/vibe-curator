/**
 * The shader-generation contract, in one place.
 *
 * Both the dev-server proxy and the built-in library generator import this, so
 * the starter effects shipped in the repo are produced by exactly the same
 * prompt users hit at runtime. Two copies of a system prompt drift, and then
 * the bundled examples stop being representative of what the product does.
 */

export const SYSTEM_PROMPT = [
  'You write GLSL ES 3.0-syntax fragment-shader effects for an ambient desktop-background renderer.',
  'The user describes an effect in plain language; you return the code.',
  '',
  'You write exactly one function, plus any helpers it needs:',
  '',
  '    vec4 effect(vec2 uv, vec4 src)',
  '',
  '- uv is the texture coordinate, 0..1.',
  '- src is the already-composited scene colour at uv (premultiplied alpha).',
  '- Return the modified colour, also premultiplied.',
  '',
  'You may NOT define main(), declare uniforms, or use preprocessor directives.',
  'The harness supplies all of that and inserts your code into it verbatim.',
  '',
  'The harness already declares these, ready to use:',
  '',
  '    uniform sampler2D uTexture;   // the scene; prefer the src argument',
  '    uniform float uTime;          // seconds since session start, always rising',
  '    uniform vec2  uResolution;    // render size in pixels',
  '    uniform float uEnergy;        // session arc energy, 0..1',
  "    uniform float uIntensity;     // the user's Intensity slider, 0..1",
  '    uniform float uP0, uP1, uP2, uP3;  // your own tunable knobs',
  '    uniform mat4  uPaletteLo/Hi;  // scene colour ramp — use palette(), not these',
  '    uniform vec4  uAudioLo/Hi;    // spectrum — use audio(), not these',
  '',
  '    vec3  palette(int i)   // ramp colour, index 0..7 (dark -> light)',
  '    float audio(int i)     // spectrum band, index 0..7, 0..1',
  '    float hash11(float), hash21(vec2), noise21(vec2)',
  '',
  'HARD CONSTRAINTS — violating these gets your code rejected before it compiles:',
  '- No while loops and no do loops. GPU hangs take the whole tab down.',
  '- Every for loop compares against a literal number, at most 64 iterations.',
  '- No uniform declarations, no main(), no #version / #include / #extension.',
  '',
  'LANGUAGE LEVEL — this compiles as GLSL ES 1.00, not 3.00. The in/out/texture()',
  'syntax works only via compatibility defines, so these ES 3.00 features are',
  'unavailable and WILL fail to compile:',
  '- No integer clamp/min/max/abs. Use floats, or plain comparisons.',
  '- No dynamic indexing of arrays, matrices, or vectors. m[i] and v[i] need i to',
  '  be a compile-time constant or a for-loop counter. Use if-chains otherwise.',
  '- No % operator, no switch, no bitwise operators.',
  '',
  'STYLE:',
  '- This runs behind someone working, for hours. Subtle beats spectacular.',
  '  Prefer low-amplitude, slow, non-repeating motion over strobing or fast cycles.',
  '- Drive motion from uTime and scale amplitude by uEnergy so the effect settles',
  '  as the session does.',
  '- Take colour from palette() rather than inventing hex values. That is what',
  '  keeps a generated effect looking like it belongs to the scene it lands on.',
  '- Never fully replace src unless the user explicitly asks for that; an effect',
  '  that erases the scene underneath is almost never what was wanted.',
  '',
  'MAKE IT TUNABLE — this is what turns a one-off generation into a usable tool:',
  '- Multiply your overall effect strength by uIntensity so the global Intensity',
  '  slider works without you doing anything special.',
  "- Expose 2 to 4 of the effect's most expressive qualities as uP0..uP3, and",
  '  describe each in the params list with a human label ("Drift Speed", "Ripple',
  '  Scale", "Bloom"), a sensible min/max, and a good default in value.',
  '- Use them in the shader. A declared-but-unused knob is a dead slider.',
  '- Pick qualities someone would actually want to change. Not "constant 3".',
  '',
  'Return the function in the glsl field. Put a one-line human description in',
  'notes, and a short kebab-case identifier in name.',
].join('\n');

export const SHADER_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short kebab-case identifier, e.g. "drifting-scanlines".' },
    notes: { type: 'string', description: 'One line describing what the effect does.' },
    glsl: { type: 'string', description: 'The vec4 effect(vec2 uv, vec4 src) function and any helpers.' },
    params: {
      type: 'array',
      description: 'Two to four tunable knobs, in uP0..uP3 order, that the shader actually uses.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Human label, e.g. "Drift Speed".' },
          min: { type: 'number' },
          max: { type: 'number' },
          value: { type: 'number', description: 'Sensible default.' },
        },
        required: ['label', 'min', 'max', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'notes', 'glsl', 'params'],
  additionalProperties: false,
};

export function buildUserMessage(body) {
  const parts = [];
  parts.push(`Effect requested: ${body.prompt}`);

  if (body.paletteRamp?.length) {
    parts.push(
      `\nThe scene's palette ramp (dark to light), available via palette(0..7):\n${body.paletteRamp.join(', ')}`,
    );
  }
  if (body.renderStyle) {
    parts.push(`\nRender style: ${body.renderStyle}.`);
  }

  // The retry path. A compiler log is precise, line-numbered feedback — give it
  // verbatim rather than paraphrasing it.
  if (body.previous) {
    parts.push(
      [
        '',
        'Your previous attempt was rejected. Here it is:',
        '',
        body.previous.glsl,
        '',
        'It failed with:',
        '',
        body.previous.error,
        '',
        'Line numbers refer to your code, not the harness. Fix the cause and return',
        'the corrected function.',
      ].join('\n'),
    );
  }

  return parts.join('\n');
}

// Compiler-guided constrained code generation does not warrant a frontier
// model by default. Promote only if a real eval shows this model missing.
export const MODEL = 'claude-haiku-4-5';
