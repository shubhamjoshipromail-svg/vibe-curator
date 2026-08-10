#!/usr/bin/env node
/**
 * Generates dev fixture sprites for the asset seam.
 *
 * These are NOT art. They exist to prove registration, and they are built to be
 * hostile about it: each sprite sits in a different canvas size with different,
 * deliberately asymmetric padding, and neither is centred. If trim-and-anchor
 * works, both still land exactly on the floor line at the position their layer
 * spec asks for. If it is broken, they float or sink and you see it instantly.
 *
 * A real bought pack will have exactly this problem in a less obvious form.
 *
 * Zero dependencies — minimal PNG encoder below (zlib + CRC32).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// --- minimal PNG encoder -----------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- tiny raster -------------------------------------------------------------

function surface(w, h) {
  const data = Buffer.alloc(w * 4 * h); // transparent
  const hex = (c) => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
  return {
    w,
    h,
    data,
    rect(x, y, rw, rh, color) {
      const [r, g, b] = hex(color);
      for (let yy = y; yy < y + rh; yy++) {
        if (yy < 0 || yy >= h) continue;
        for (let xx = x; xx < x + rw; xx++) {
          if (xx < 0 || xx >= w) continue;
          const i = (yy * w + xx) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
        }
      }
    },
  };
}

// --- fixtures ----------------------------------------------------------------

// Ashen Keep's ramp, so the fixtures at least sit in the right colour world.
const DARK = '#1c1419';
const STEEL = '#4a3a3a';
const STEEL_LIT = '#8b3a3a';
const TRIM = '#c47a3a';
const BRIGHT = '#e8dcc8';

/**
 * Canvas 128x128, content only ~34x58, pushed hard toward the top-left.
 * Padding is asymmetric on every side on purpose.
 */
function knight() {
  const s = surface(128, 128);
  const x = 26;
  const y = 9;

  s.rect(x + 20, y + 30, 3, 26, BRIGHT); // spear shaft
  s.rect(x + 19, y + 22, 5, 9, TRIM); // spear head
  s.rect(x + 10, y + 2, 14, 12, STEEL); // helm
  s.rect(x + 10, y + 2, 14, 3, STEEL_LIT); // helm crest
  s.rect(x + 12, y + 8, 10, 3, DARK); // visor
  s.rect(x + 8, y + 14, 18, 24, STEEL); // torso
  s.rect(x + 8, y + 14, 4, 24, STEEL_LIT); // lit edge
  s.rect(x + 2, y + 18, 7, 16, TRIM); // shield
  s.rect(x + 3, y + 24, 5, 3, BRIGHT); // shield boss
  s.rect(x + 10, y + 38, 6, 20, STEEL); // left leg
  s.rect(x + 18, y + 38, 6, 20, STEEL); // right leg
  s.rect(x + 9, y + 55, 8, 3, DARK); // left boot
  s.rect(x + 17, y + 55, 8, 3, DARK); // right boot

  return { name: 'knight_resting', png: encodePNG(s.w, s.h, s.data) };
}

/**
 * Different canvas (96x64) and different padding again — content sits low and
 * right. Nothing about these two sprites shares a coordinate convention.
 */
function campfire() {
  const s = surface(96, 64);
  const x = 38;
  const y = 33;

  s.rect(x + 4, y + 8, 30, 5, STEEL); // back log
  s.rect(x + 8, y + 4, 22, 5, TRIM); // front log
  for (let i = 0; i < 7; i++) {
    s.rect(x + i * 6, y + 14, 5, 5, i % 2 ? STEEL : STEEL_LIT); // stone ring
  }
  s.rect(x + 2, y + 12, 4, 5, STEEL); // left kerb
  s.rect(x + 34, y + 12, 4, 5, STEEL); // right kerb

  return { name: 'campfire_stones', png: encodePNG(s.w, s.h, s.data) };
}

// --- audio fixtures ----------------------------------------------------------

/**
 * Same principle as the sprites: these are not sound design, they exist to
 * exercise the Player/Sampler code paths end to end so the seam is verified
 * rather than merely written. Real CC0 recordings replace them file-for-file.
 */
function encodeWAV(samples, sampleRate = 44100) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

let seed = 12345;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

/** Brown-ish noise bed. Edges forced to silence so the loop point is clean. */
function roomAir(seconds = 4, sr = 44100) {
  const n = seconds * sr;
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + (rnd() * 2 - 1) * 0.02) * 0.995;
    out[i] = last * 3;
  }
  const edge = Math.floor(sr * 0.05);
  for (let i = 0; i < edge; i++) {
    const k = i / edge;
    out[i] *= k;
    out[n - 1 - i] *= k;
  }
  return out;
}

/** Noise bed plus sparse transient pops — transient-heavy on purpose, to make
 *  the difference between plain-loop and granular playback audible. */
function fireCrackle(seconds = 4, sr = 44100) {
  const out = roomAir(seconds, sr);
  const n = out.length;
  for (let p = 0; p < seconds * 14; p++) {
    const at = Math.floor(rnd() * (n - 2000));
    const len = 40 + Math.floor(rnd() * 260);
    const amp = 0.15 + rnd() * 0.5;
    for (let i = 0; i < len; i++) {
      out[at + i] += (rnd() * 2 - 1) * amp * Math.pow(1 - i / len, 3);
    }
  }
  const edge = Math.floor(sr * 0.05);
  for (let i = 0; i < edge; i++) {
    const k = i / edge;
    out[i] *= k;
    out[n - 1 - i] *= k;
  }
  return out;
}

/** A plucked-ish note, for proving Tone.Sampler note mapping and pitch shifting. */
function pluckNote(freq, seconds = 2.4, sr = 44100) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const partials = [1, 2, 3, 4.2, 5.4];
  const gains = [1, 0.45, 0.22, 0.1, 0.05];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (let p = 0; p < partials.length; p++) {
      v += Math.sin(2 * Math.PI * freq * partials[p] * t) * gains[p] * Math.exp(-t * (2 + p * 1.6));
    }
    out[i] = v * 0.3;
  }
  return out;
}

// --- write -------------------------------------------------------------------

const OUT = resolve(import.meta.dirname, '..', 'public', 'packs', 'dev-fixtures');
mkdirSync(OUT, { recursive: true });

const license = {
  source: 'Generated by scripts/make-dev-fixtures.mjs in this repository',
  license: 'CC0-1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  commercial_ok: true,
  attribution_required: false,
};

const assets = {};
for (const { name, png } of [knight(), campfire()]) {
  const file = `${name}.png`;
  writeFileSync(join(OUT, file), png);
  assets[name] = { file, license };
  console.log(`wrote ${file} (${png.length} bytes)`);
}

writeFileSync(
  join(OUT, 'pack.json'),
  JSON.stringify(
    {
      id: 'dev-fixtures',
      label: 'Dev Fixtures',
      note: 'Registration test sprites, not art. Replace with a real pack.',
      assets,
    },
    null,
    2,
  ) + '\n',
);
console.log('wrote packs/dev-fixtures/pack.json');

const AOUT = resolve(import.meta.dirname, '..', 'public', 'audio', 'dev-fixtures');
mkdirSync(AOUT, { recursive: true });

const textures = {};
for (const [name, samples, mode] of [
  // Ambience beds belong far below the melodic layer. Anything near -20 dB
  // stacks into the limiter once bed + textures + motifs are all sounding.
  ['room_air', roomAir(), 'granular', -32],
  ['fire_crackle', fireCrackle(), 'player', -26],
]) {
  const file = `${name}.wav`;
  const wav = encodeWAV(samples);
  writeFileSync(join(AOUT, file), wav);
  textures[name] = { file, loop_mode: mode, gain_db: mode === 'granular' ? -32 : -26, license };
  console.log(`wrote ${file} (${(wav.length / 1024).toFixed(0)} KB)`);
}

const pluckSamples = {};
for (const [note, freq] of [
  ['C2', 65.41],
  ['C3', 130.81],
  ['C4', 261.63],
]) {
  const file = `pluck_${note}.wav`;
  writeFileSync(join(AOUT, file), encodeWAV(pluckNote(freq)));
  pluckSamples[note] = file;
  console.log(`wrote ${file}`);
}

writeFileSync(
  join(AOUT, 'pack.json'),
  JSON.stringify(
    {
      id: 'dev-fixtures-audio',
      label: 'Dev Fixtures (audio)',
      note: 'Synthesized stand-ins to exercise the sample path. Replace with CC0 recordings.',
      textures,
      instruments: { pluck: { samples: pluckSamples, license } },
    },
    null,
    2,
  ) + '\n',
);
console.log('wrote audio/dev-fixtures/pack.json');
