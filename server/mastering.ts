import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { MasterReport, PlaybackPlan } from '../src/audio/brief';

/**
 * Deterministic mastering pass.
 *
 * The defect this exists to fix: every generator hands back a track that fades
 * to silence. Trimming digital silence is not enough — the fade itself is
 * audible, and a loop that restarts out of a fade sounds broken no matter how
 * tight the silence trim is. So the tail is found by energy, not by threshold:
 * the last 250 ms window still carrying median-ish level is where the music
 * actually stops, and everything after it (fade included) is cut.
 *
 * FFmpeg is an operating-system dependency. Production installs the Debian
 * package through Railpack and checks its redistribution status before the
 * database migration or application start.
 */

const run = promisify(execFile);

/** Working format. Wide enough that trimming and folding never quantise. */
const WORK_SAMPLE_RATE = 48_000;
const WORK_CHANNELS = 2;

const SILENCE_FLOOR_DB = -50;
const WINDOW_SECONDS = 0.25;
/** A window at or above this fraction of the median RMS still counts as content. */
const CONTENT_RMS_RATIO = 0.6;
/** Below this fraction of the requested duration the track is flagged degraded. */
const MIN_CONTENT_RATIO = 0.6;

const TARGET_LUFS = -18;
const TARGET_TRUE_PEAK_DB = -1.5;
/** A master that gets this close to full scale has been clipped by the encoder. */
const REJECT_TRUE_PEAK_DB = -0.1;
const MAX_SEAM_DELTA_DB = 6;
/** Measured either side of the loop point to judge the seam. */
const SEAM_WINDOW_SECONDS = 0.05;

const OUTPUT_SAMPLE_RATE = 44_100;
const OUTPUT_BITRATE = '160k';
const OUTPUT_MIME = 'audio/mpeg';

const FFMPEG_MAX_BUFFER = 64 * 1024 * 1024;

export interface MasterResult {
  audio: Buffer;
  mimeType: string;
  report: MasterReport;
}

interface Pcm {
  sampleRate: number;
  channels: number;
  /** Interleaved. */
  data: Float32Array;
  frames: number;
}

interface LoudnessMeasurement {
  lufs?: number;
  truePeakDb?: number;
}

function ffmpegBinary(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

async function ffmpeg(args: string[]): Promise<string> {
  // ffmpeg reports everything on stderr, including the measurements we parse.
  const { stderr } = await run(ffmpegBinary(), ['-nostdin', '-hide_banner', '-y', ...args], {
    maxBuffer: FFMPEG_MAX_BUFFER,
    encoding: 'utf8',
  });
  return stderr;
}

function round(value: number | undefined, places = 2): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function toDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

// --- decoding -------------------------------------------------------------

/** Minimal RIFF walk. ffmpeg emits an extensible header for f32, so the chunk
 *  layout cannot be assumed to be the canonical 44 bytes. */
function parseWav(wav: Buffer): Pcm {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Decoded file is not RIFF/WAVE.');
  }

  let channels = WORK_CHANNELS;
  let sampleRate = WORK_SAMPLE_RATE;
  let bitsPerSample = 32;
  let body: Buffer | undefined;

  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && start + 16 <= wav.length) {
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bitsPerSample = wav.readUInt16LE(start + 14);
    } else if (id === 'data') {
      body = wav.subarray(start, Math.min(start + size, wav.length));
      break;
    }
    offset = start + size + (size % 2);
  }

  if (!body) throw new Error('Decoded file has no data chunk.');
  if (bitsPerSample !== 32) throw new Error(`Expected 32-bit float samples, got ${bitsPerSample}.`);

  // Copy rather than view: the data chunk is not guaranteed 4-byte aligned.
  const aligned = Buffer.from(body.subarray(0, body.length - (body.length % 4)));
  const data = new Float32Array(aligned.buffer, aligned.byteOffset, aligned.length / 4);
  return { sampleRate, channels, data, frames: Math.floor(data.length / channels) };
}

function writeWav(pcm: Pcm): Buffer {
  const bytes = pcm.frames * pcm.channels * 4;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(pcm.channels, 22);
  header.writeUInt32LE(pcm.sampleRate, 24);
  header.writeUInt32LE(pcm.sampleRate * pcm.channels * 4, 28);
  header.writeUInt16LE(pcm.channels * 4, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(bytes, 40);
  const body = Buffer.from(pcm.data.buffer, pcm.data.byteOffset, bytes);
  return Buffer.concat([header, body]);
}

// --- measurement ----------------------------------------------------------

/** Reads the ebur128 summary block, not the per-frame progress lines. */
function parseLoudness(stderr: string): LoudnessMeasurement {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const lufs = Number(summary.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/)?.[1]);
  const truePeak = Number(summary.match(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/)?.[1]);
  return {
    lufs: Number.isFinite(lufs) ? lufs : undefined,
    truePeakDb: Number.isFinite(truePeak) ? truePeak : undefined,
  };
}

async function measureLoudness(path: string): Promise<LoudnessMeasurement> {
  return parseLoudness(await ffmpeg(['-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-']));
}

/** Leading and trailing silence at the -50 dB floor, from ffmpeg's own detector. */
function parseSilence(stderr: string, duration: number): { lead: number; tail: number } {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));

  // A run that opens at zero is leading silence. For trailing silence, some
  // ffmpeg builds flush a closing silence_end at EOF and some leave the run
  // open, so accept either: an unterminated run, or one that closes at the end.
  const lead = starts.length > 0 && starts[0] <= 0.01 && ends.length > 0 ? Math.max(0, ends[0]) : 0;

  let tail = 0;
  if (starts.length > 0) {
    const lastStart = starts[starts.length - 1];
    const closesAtEof = ends.length > 0 && duration > 0 && ends[ends.length - 1] >= duration - 0.05;
    if (starts.length > ends.length || closesAtEof) tail = Math.max(0, duration - lastStart);
  }

  // An entirely silent file is all lead, not lead plus tail counted twice.
  return { lead, tail: lead + tail > duration ? 0 : tail };
}

async function measureSilence(path: string, duration: number): Promise<{ lead: number; tail: number }> {
  const stderr = await ffmpeg([
    '-i', path,
    '-af', `silencedetect=noise=${SILENCE_FLOOR_DB}dB:d=0.05`,
    '-f', 'null', '-',
  ]);
  return parseSilence(stderr, duration);
}

/** Mean-square energy of one interleaved frame span, as an amplitude. */
function rms(pcm: Pcm, startFrame: number, endFrame: number): number {
  const from = Math.max(0, startFrame) * pcm.channels;
  const to = Math.min(pcm.frames, endFrame) * pcm.channels;
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += pcm.data[i] * pcm.data[i];
  return Math.sqrt(sum / (to - from));
}

function samplePeak(pcm: Pcm): number {
  let peak = 0;
  for (let i = 0; i < pcm.data.length; i++) {
    const value = Math.abs(pcm.data[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function parseDuration(stderr: string): number | undefined {
  const match = stderr.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export interface TrackMeasurement {
  durationSeconds?: number;
  lufs?: number;
  truePeakDb?: number;
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
  /** Level difference across the wrap point, measured over `seamWindowSeconds`. */
  seamDeltaDb?: number;
  seamWindowSeconds?: number;
}

/**
 * Measures a track without changing it. Shared with the offline backfill so the
 * before/after table and the report are produced by the same code path.
 */
export async function inspectTrack(input: Buffer, seamWindowSeconds = 0.5): Promise<TrackMeasurement> {
  ffmpegBinary();
  const dir = await mkdtemp(join(tmpdir(), 'vibe-inspect-'));
  try {
    const path = join(dir, 'source');
    await writeFile(path, input);
    const stderr = await ffmpeg([
      '-i', path,
      '-af', `silencedetect=noise=${SILENCE_FLOOR_DB}dB:d=0.05`,
      '-f', 'null', '-',
    ]);
    const durationSeconds = parseDuration(stderr);
    const silence = parseSilence(stderr, durationSeconds ?? 0);
    const loudness = await measureLoudness(path);

    // The seam needs samples, not a filter summary, so this one measurement
    // costs a decode. Offline tooling only; masterTrack never calls it.
    let seam: number | undefined;
    try {
      const decodedPath = join(dir, 'decoded.wav');
      await ffmpeg([
        '-i', path, '-vn', '-ac', String(WORK_CHANNELS), '-ar', String(WORK_SAMPLE_RATE),
        '-c:a', 'pcm_f32le', '-f', 'wav', decodedPath,
      ]);
      const measured = seamDeltaDb(parseWav(await readFile(decodedPath)), seamWindowSeconds);
      if (Number.isFinite(measured)) seam = measured;
    } catch {
      // A track we cannot decode simply has no seam reading.
    }

    return {
      durationSeconds: round(durationSeconds),
      lufs: round(loudness.lufs, 1),
      truePeakDb: round(loudness.truePeakDb, 2),
      leadingSilenceSeconds: round(silence.lead) ?? 0,
      trailingSilenceSeconds: round(silence.tail) ?? 0,
      seamDeltaDb: round(seam, 2),
      seamWindowSeconds,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// --- trimming -------------------------------------------------------------

interface TrimResult {
  startFrame: number;
  endFrame: number;
  noiseFloorDb: number;
}

/**
 * Head is cut at the detected silence. Tail is cut where the music stops
 * carrying energy — walking back to the last 250 ms window still at 0.6x the
 * median RMS — which lands before the fade rather than after it.
 */
function findContent(pcm: Pcm, leadSeconds: number): TrimResult {
  const windowFrames = Math.max(1, Math.round(WINDOW_SECONDS * pcm.sampleRate));
  const windowCount = Math.floor(pcm.frames / windowFrames);
  const startFrame = Math.min(pcm.frames, Math.round(leadSeconds * pcm.sampleRate));

  if (windowCount === 0) return { startFrame, endFrame: pcm.frames, noiseFloorDb: -Infinity };

  const levels: number[] = [];
  for (let w = 0; w < windowCount; w++) levels.push(rms(pcm, w * windowFrames, (w + 1) * windowFrames));

  const threshold = median(levels) * CONTENT_RMS_RATIO;
  let lastContentWindow = -1;
  for (let w = windowCount - 1; w >= 0; w--) {
    if (levels[w] >= threshold && levels[w] > 0) {
      lastContentWindow = w;
      break;
    }
  }

  const endFrame = lastContentWindow < 0
    ? pcm.frames
    : Math.min(pcm.frames, (lastContentWindow + 1) * windowFrames);

  const quietest = Math.min(...levels.filter((level) => level > 0));
  return {
    startFrame,
    endFrame: Math.max(startFrame, endFrame),
    noiseFloorDb: Number.isFinite(quietest) ? toDb(quietest) : -Infinity,
  };
}

function slice(pcm: Pcm, startFrame: number, endFrame: number): Pcm {
  const frames = Math.max(0, endFrame - startFrame);
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels,
    data: pcm.data.slice(startFrame * pcm.channels, endFrame * pcm.channels),
    frames,
  };
}

// --- crossfade ------------------------------------------------------------

/**
 * Folds the last `seconds` onto the first `seconds` with an equal-power curve,
 * so the wrap point carries constant energy instead of a dip. Output is exactly
 * `content - seconds` long, and position 0 follows position `length` naturally.
 */
function crossfade(pcm: Pcm, seconds: number): Pcm {
  const fadeFrames = Math.round(seconds * pcm.sampleRate);
  const outFrames = pcm.frames - fadeFrames;
  const out = new Float32Array(outFrames * pcm.channels);

  for (let frame = 0; frame < outFrames; frame++) {
    for (let channel = 0; channel < pcm.channels; channel++) {
      const index = frame * pcm.channels + channel;
      if (frame < fadeFrames) {
        const t = (frame + 0.5) / fadeFrames;
        const head = pcm.data[index];
        const tail = pcm.data[(outFrames + frame) * pcm.channels + channel];
        out[index] = head * Math.sin(t * Math.PI / 2) + tail * Math.cos(t * Math.PI / 2);
      } else {
        out[index] = pcm.data[index];
      }
    }
  }

  return { sampleRate: pcm.sampleRate, channels: pcm.channels, data: out, frames: outFrames };
}

/** Level difference across the wrap point: end of the file against its start. */
function seamDeltaDb(pcm: Pcm, windowSeconds: number = SEAM_WINDOW_SECONDS): number {
  const window = Math.max(1, Math.round(windowSeconds * pcm.sampleRate));
  const before = rms(pcm, pcm.frames - window, pcm.frames);
  const after = rms(pcm, 0, window);
  if (before <= 0 || after <= 0) return Infinity;
  return Math.abs(toDb(before) - toDb(after));
}

// --- normalise and encode -------------------------------------------------

function loudnormFilter(extra = ''): string {
  return `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DB}:LRA=11${extra}`;
}

interface LoudnormPass {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/**
 * Two-pass loudnorm. The single-pass form is a dynamic compressor whose result
 * depends on how ffmpeg buffers the stream; measuring first and applying linear
 * gain second gives the same master byte-for-byte on every run.
 */
async function measureLoudnorm(path: string): Promise<LoudnormPass | undefined> {
  const stderr = await ffmpeg(['-i', path, '-af', loudnormFilter(':print_format=json'), '-f', 'null', '-']);
  const json = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  try {
    const parsed = JSON.parse(json) as LoudnormPass;
    return Number.isFinite(Number(parsed.input_i)) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function encodeMp3(source: string, destination: string, pass: LoudnormPass | undefined): Promise<void> {
  const filter = pass
    ? loudnormFilter(
      `:measured_I=${pass.input_i}:measured_TP=${pass.input_tp}:measured_LRA=${pass.input_lra}`
      + `:measured_thresh=${pass.input_thresh}:offset=${pass.target_offset}:linear=true`,
    )
    : loudnormFilter();
  await ffmpeg([
    '-i', source,
    '-af', filter,
    '-vn', '-map_metadata', '-1',
    '-c:a', 'libmp3lame', '-ar', String(OUTPUT_SAMPLE_RATE), '-ac', String(WORK_CHANNELS), '-b:a', OUTPUT_BITRATE,
    destination,
  ]);
}

// --- entry point ----------------------------------------------------------

/**
 * Masters one track against a playback plan.
 *
 * Never throws for an audio reason: anything that goes wrong downgrades to the
 * best audio available with `ok: false` and a reason. The only throw is a
 * missing ffmpeg, which is an environment fault rather than a bad track.
 */
export async function masterTrack(input: Buffer, plan: PlaybackPlan): Promise<MasterResult> {
  ffmpegBinary();

  const report: MasterReport = { ok: false, targetLufs: TARGET_LUFS, notes: [] };
  let best: { audio: Buffer; mimeType: string } = { audio: input, mimeType: 'application/octet-stream' };

  const reject = (reason: string): MasterResult => {
    report.ok = false;
    report.reason = reason;
    return { audio: best.audio, mimeType: best.mimeType, report };
  };

  const dir = await mkdtemp(join(tmpdir(), 'vibe-master-'));

  try {
    const sourcePath = join(dir, 'source');
    const decodedPath = join(dir, 'decoded.wav');
    const contentPath = join(dir, 'content.wav');
    const outputPath = join(dir, 'master.mp3');

    await writeFile(sourcePath, input);

    // 1 — decode to the working format.
    await ffmpeg([
      '-i', sourcePath,
      '-vn', '-ac', String(WORK_CHANNELS), '-ar', String(WORK_SAMPLE_RATE),
      '-c:a', 'pcm_f32le', '-f', 'wav', decodedPath,
    ]);
    const decoded = parseWav(await readFile(decodedPath));
    const duration = decoded.frames / decoded.sampleRate;
    report.measuredDurationSeconds = round(duration);

    // 2 — measure the delivered audio.
    const loudness = await measureLoudness(decodedPath);
    const silence = await measureSilence(decodedPath, duration);
    report.measuredLufs = round(loudness.lufs, 1);
    report.truePeakDb = round(loudness.truePeakDb, 2);
    report.peakDb = round(toDb(samplePeak(decoded)), 2);
    report.leadingSilenceSeconds = round(silence.lead);
    report.trailingSilenceSeconds = round(silence.tail);

    // 3 — trim: silence off the head, the fade off the tail.
    const trim = findContent(decoded, silence.lead);
    const content = slice(decoded, trim.startFrame, trim.endFrame);
    const contentSeconds = content.frames / content.sampleRate;
    report.noiseFloorDb = Number.isFinite(trim.noiseFloorDb) ? round(trim.noiseFloorDb, 2) : undefined;
    report.trimStartSeconds = round(trim.startFrame / decoded.sampleRate);
    report.trimEndSeconds = round((decoded.frames - trim.endFrame) / decoded.sampleRate);
    report.contentDurationSeconds = round(contentSeconds);

    if (content.frames === 0) return reject('Nothing survived the trim: the track is silent.');

    // 4 — short content is still shipped, just flagged.
    const shortfall = contentSeconds < MIN_CONTENT_RATIO * plan.targetDurationSeconds;
    if (shortfall) {
      report.degraded = true;
      report.notes?.push(
        `Trimmed content is ${contentSeconds.toFixed(1)}s against a ${plan.targetDurationSeconds}s target.`,
      );
    }

    // 5 — fold the tail onto the head so the wrap point is seamless.
    const wants = plan.mode !== 'once' && plan.crossfadeSeconds > 0;
    const fadeSeconds = Math.min(plan.crossfadeSeconds, contentSeconds / 2);
    const folds = wants && fadeSeconds > 0;
    const finished = folds ? crossfade(content, fadeSeconds) : content;
    report.crossfadeSeconds = round(folds ? fadeSeconds : 0);
    if (wants && fadeSeconds < plan.crossfadeSeconds) {
      report.notes?.push(`Crossfade shortened to ${fadeSeconds.toFixed(2)}s to fit the trimmed content.`);
    }

    let seam: number | undefined;
    if (folds) {
      seam = seamDeltaDb(finished);
      report.seamDeltaDb = Number.isFinite(seam) ? round(seam, 2) : undefined;
      report.loopStart = 0;
      report.loopEnd = round(finished.frames / finished.sampleRate);
    }

    // 6 and 7 — normalise, then encode.
    await writeFile(contentPath, writeWav(finished));
    await encodeMp3(contentPath, outputPath, await measureLoudnorm(contentPath));
    best = { audio: await readFile(outputPath), mimeType: OUTPUT_MIME };

    // 8 — measure what we actually produced.
    const output = await measureLoudness(outputPath);
    report.outputDurationSeconds = round(finished.frames / finished.sampleRate);
    report.outputLufs = round(output.lufs, 1);
    report.outputTruePeakDb = round(output.truePeakDb, 2);
    if (output.lufs !== undefined) report.gainDb = round(output.lufs - (loudness.lufs ?? output.lufs), 2);

    if (output.lufs === undefined) return reject('Integrated loudness could not be measured on the master.');
    if (output.truePeakDb !== undefined && output.truePeakDb > REJECT_TRUE_PEAK_DB) {
      return reject(`True peak is ${output.truePeakDb.toFixed(2)} dBTP, above the ${REJECT_TRUE_PEAK_DB} dBTP ceiling.`);
    }
    if (shortfall) {
      return reject(
        `Trimmed content is ${contentSeconds.toFixed(1)}s, under ${MIN_CONTENT_RATIO} x the ${plan.targetDurationSeconds}s target.`,
      );
    }
    if (seam !== undefined && seam > MAX_SEAM_DELTA_DB) {
      return reject(`Loop seam differs by ${seam.toFixed(1)} dB, above the ${MAX_SEAM_DELTA_DB} dB limit.`);
    }

    report.ok = true;
    return { audio: best.audio, mimeType: best.mimeType, report };
  } catch (err) {
    // An audio fault must not propagate: salvage a plain encode if we can.
    const message = err instanceof Error ? err.message : String(err);
    if (best.mimeType !== OUTPUT_MIME) {
      const salvaged = await salvage(input, dir);
      if (salvaged) best = { audio: salvaged, mimeType: OUTPUT_MIME };
    }
    report.notes?.push(message.slice(0, 500));
    return reject(`Mastering failed: ${message.split('\n')[0]}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Last resort: a straight re-encode, so callers still get playable audio. */
async function salvage(input: Buffer, dir: string): Promise<Buffer | undefined> {
  try {
    const source = join(dir, 'salvage-source');
    const destination = join(dir, 'salvage.mp3');
    await writeFile(source, input);
    await ffmpeg([
      '-i', source, '-vn', '-map_metadata', '-1',
      '-c:a', 'libmp3lame', '-ar', String(OUTPUT_SAMPLE_RATE), '-ac', String(WORK_CHANNELS), '-b:a', OUTPUT_BITRATE,
      destination,
    ]);
    return await readFile(destination);
  } catch {
    return undefined;
  }
}
