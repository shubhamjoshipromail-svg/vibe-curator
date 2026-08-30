import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateFfmpegReports } from '../scripts/check-ffmpeg.mjs';

const filters = ' T.. loudnorm A->A\n ... ebur128 A->N\n ... silencedetect A->A';
const encoders = ' A....D libmp3lame libmp3lame MP3';

test('the release gate accepts a redistributable FFmpeg with required mastering features', () => {
  assert.doesNotThrow(() => validateFfmpegReports('FFmpeg is free software under the GPL version 2 or later', filters, encoders));
});

test('the release gate rejects nonfree FFmpeg builds', () => {
  assert.throws(
    () => validateFfmpegReports('configuration: --enable-gpl --enable-nonfree\nnot legally redistributable', filters, encoders),
    /cannot be redistributed/,
  );
});
