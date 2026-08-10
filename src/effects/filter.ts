import { Filter, GlProgram, UniformGroup } from 'pixi.js';
import type { Palette } from '../types';
import { hexToRgb } from '../palette';

/**
 * A generated shader, wrapped as a Pixi filter.
 *
 * This drops into exactly the slot the blur on the abstract field already uses
 * — `container.filters` — which is why GEN-EFFECT needed no new rendering
 * machinery. A generated effect is just another filter on a layer.
 */

/** Pixi's standard filter vertex shader. The model never touches this. */
const VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord() {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main() {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`.trim();

export class EffectFilter extends Filter {
  readonly label: string;

  constructor(fragment: string, label: string) {
    super({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment, name: `gen-effect-${label}` }),
      resources: {
        effectUniforms: new UniformGroup({
          uTime: { value: 0, type: 'f32' },
          uResolution: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          uEnergy: { value: 1, type: 'f32' },
          uIntensity: { value: 0.6, type: 'f32' },
          uP0: { value: 0, type: 'f32' },
          uP1: { value: 0, type: 'f32' },
          uP2: { value: 0, type: 'f32' },
          uP3: { value: 0, type: 'f32' },
          uPaletteLo: { value: new Float32Array(16), type: 'mat4x4<f32>' },
          uPaletteHi: { value: new Float32Array(16), type: 'mat4x4<f32>' },
          uAudioLo: { value: new Float32Array(4), type: 'vec4<f32>' },
          uAudioHi: { value: new Float32Array(4), type: 'vec4<f32>' },
        }),
      },
    });
    this.label = label;
  }

  private get u(): Record<string, unknown> {
    return (this.resources.effectUniforms as UniformGroup).uniforms as Record<string, unknown>;
  }

  setPalette(palette: Palette): void {
    const lo = this.u.uPaletteLo as Float32Array;
    const hi = this.u.uPaletteHi as Float32Array;
    for (let i = 0; i < 8; i++) {
      const [r, g, b] = hexToRgb(palette.ramp[Math.min(i, palette.ramp.length - 1)]);
      const buf = i < 4 ? lo : hi;
      const o = (i % 4) * 4;
      buf[o] = r / 255;
      buf[o + 1] = g / 255;
      buf[o + 2] = b / 255;
      buf[o + 3] = 1;
    }
  }

  setResolution(w: number, h: number): void {
    const buf = this.u.uResolution as Float32Array;
    buf[0] = w;
    buf[1] = h;
  }

  /** Set a generated effect's own tunable parameters. */
  setParams(params: { key: string; value: number }[]): void {
    for (const p of params) this.u[p.key] = p.value;
  }

  setIntensity(v: number): void {
    this.u.uIntensity = v;
  }

  /** Called every frame by the scene. */
  update(time: number, energy: number, audioBands?: Float32Array): void {
    this.u.uTime = time;
    this.u.uEnergy = energy;
    if (audioBands) {
      (this.u.uAudioLo as Float32Array).set(audioBands.subarray(0, 4));
      (this.u.uAudioHi as Float32Array).set(audioBands.subarray(4, 8));
    }
  }
}
