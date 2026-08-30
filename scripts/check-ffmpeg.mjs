#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

export function validateFfmpegReports(licenseText, filtersText, encodersText) {
  const license = licenseText.toLowerCase();
  if (license.includes('--enable-nonfree') || license.includes('not legally redistributable')) {
    throw new Error('FFmpeg is a nonfree build and cannot be redistributed.');
  }
  if (!filtersText.includes('loudnorm') || !filtersText.includes('ebur128') || !filtersText.includes('silencedetect')) {
    throw new Error('FFmpeg is missing a mastering filter (loudnorm, ebur128, or silencedetect).');
  }
  if (!encodersText.includes('libmp3lame')) {
    throw new Error('FFmpeg is missing the libmp3lame encoder.');
  }
}

export function checkFfmpeg(binary = process.env.FFMPEG_PATH?.trim() || 'ffmpeg') {
  const run = (args) => execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const license = run(['-L']);
  const filters = run(['-hide_banner', '-filters']);
  const encoders = run(['-hide_banner', '-encoders']);
  validateFfmpegReports(license, filters, encoders);
  const version = run(['-version']).split('\n')[0];
  console.log(`FFmpeg release gate passed: ${version}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  checkFfmpeg();
}
