import type { LicenseRow } from '../art/pack';

/**
 * Audio packs. Same seam idea as the art packs: named entries replace
 * synthesized sources one at a time, and anything absent falls back.
 *
 * The synthesized engine was never meant to ship — synths sound like synths.
 * What it bought was a verified SCHEDULER, which is the part that is expensive
 * to get right and which sampled sources reuse unchanged.
 */
export interface AudioTexture {
  file: string;
  /**
   * How to loop this file forever.
   *
   * `player`  — straight looped playback with loop points snapped to zero
   *              crossings. Preserves transients, so it is right for anything
   *              percussive: fire crackle, rain on glass, ticking.
   * `granular` — overlapping grains (Tone.GrainPlayer). Genuinely seamless on
   *              material that was never loop-prepared, which is most CC0 field
   *              recordings, but it smears transients. Right for beds: room
   *              tone, wind, distant water.
   *
   * Defaults to `player`, which is the safer failure: a faint seam beats
   * mush.
   */
  loop_mode?: 'player' | 'granular';
  gain_db?: number;
  license: LicenseRow;
}

export interface AudioInstrument {
  /** Note name -> filename, e.g. { "C3": "cello_C3.wav" }. Tone.Sampler pitch-shifts between them. */
  samples: Record<string, string>;
  license: LicenseRow;
}

export interface AudioPack {
  id: string;
  label: string;
  textures?: Record<string, AudioTexture>;
  instruments?: Record<string, AudioInstrument>;
}

const cache = new Map<string, Promise<AudioPack>>();

export function loadAudioPack(url: string): Promise<AudioPack> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`audio pack ${url}: HTTP ${r.status}`);
      return r.json() as Promise<AudioPack>;
    });
    cache.set(url, p);
  }
  return p;
}

/**
 * Snap loop points to zero crossings.
 *
 * Be clear about what this does and does not do: it removes the CLICK caused by
 * a waveform jumping across zero at the seam. It does not remove the
 * discontinuity in the sound itself — if a file's tail does not resemble its
 * head, you will still hear the loop. That is a job for `granular` mode or for
 * sourcing a properly loop-prepared file.
 */
export function refineLoopPoints(
  data: Float32Array,
  sampleRate: number,
  searchSeconds = 0.05,
): { start: number; end: number } {
  const win = Math.floor(sampleRate * searchSeconds);
  const start = scanForCrossing(data, 0, win, 1);
  const end = scanForCrossing(data, data.length - 1, win, -1);
  return { start: start / sampleRate, end: end / sampleRate };
}

function scanForCrossing(d: Float32Array, from: number, window: number, dir: 1 | -1): number {
  for (let i = 0; i < window; i++) {
    const a = from + i * dir;
    const b = a + dir;
    if (b < 0 || b >= d.length) break;
    if ((d[a] <= 0 && d[b] > 0) || (d[a] >= 0 && d[b] < 0)) return a;
  }
  return from;
}
