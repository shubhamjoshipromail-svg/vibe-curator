/**
 * Seeded RNG. Scene jitter must be stable across reloads, otherwise a vibe you
 * liked is unreproducible — which matters the moment users can save one.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1-D value noise; the backbone of every organic animator here. */
export function makeNoise1D(rand: () => number, size = 256): (x: number) => number {
  const table = Array.from({ length: size }, () => rand() * 2 - 1);
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[((i % size) + size) % size];
    const b = table[(((i + 1) % size) + size) % size];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}
