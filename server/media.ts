import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { viewerFor } from './auth';
import {
  completeReservation,
  failReservation,
  reserveCredits,
  type CreditOperation,
  type CreditReservation,
} from './credits';
import { generationAllowed, generationDisabledMessage, generationMode } from './beta';
import { masterTrack } from './mastering';
import { resolveMusicBrief } from '../src/audio/resolve';
import { renderProviderPrompt } from '../src/audio/render-prompt';
import {
  containsNamedReference,
  translateReferences,
  NO_LLM_CALL,
  SANITISER_MODEL,
  SANITISER_PROVIDER,
} from './music-brief';
import type { MasterReport, PlaybackPlan, SceneAudioContext } from '../src/audio/brief';

const MUSIC_MODEL = 'music_v2';
const MUSIC_PROVIDER = 'elevenlabs';
const MUSIC_PROMPT_MODEL = 'claude-haiku-4-5';
const MUSIC_PROMPT_PROVIDER = 'anthropic';
const IMAGE_MODEL = 'gpt-image-2';
const IMAGE_PROVIDER = 'openai';
const VIDEO_MODEL = 'veo-3.1-lite-generate-preview';
// Conservative draft estimate. OpenAI bills GPT Image 2 output by image tokens.
const IMAGE_COST_USD = 0.01;
const VIDEO_COST_USD = 1.20;
const MUSIC_COST_USD = 0.225;
// v2 asks for two minutes instead of ninety seconds. ElevenLabs bills $0.15/min,
// so the estimate moves with the length. CREDIT_COSTS is deliberately untouched:
// repricing credits is a product decision, not a consequence of this flag.
const MUSIC_COST_USD_V2 = 0.30;
const MUSIC_LENGTH_MS = 90_000;
const MUSIC_LENGTH_MS_V2 = 120_000;
const MUSIC_PROMPT_COST_USD = 0.001;
const DEFAULT_SESSION_CAP_USD = 3;

async function readBody(req: IncomingMessage, limit = 32 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) return reject(new Error('Request is too large.'));
    let data = '';
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      const value = String(chunk);
      size += Buffer.byteLength(value);
      if (size > limit) {
        settled = true;
        reject(new Error('Request is too large.'));
        return;
      }
      data += value;
    });
    req.on('end', () => { if (!settled) resolve(data); });
    req.on('error', reject);
  });
}

function sendJson(res: { statusCode: number; setHeader(k: string, v: string): void; end(body: string): void }, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function geminiMessage(error: unknown): { status: number; message: string } {
  const detail = String(error);
  if (detail.includes('429') || detail.includes('RESOURCE_EXHAUSTED') || detail.toLowerCase().includes('quota')) {
    return {
      status: 429,
      message: 'Gemini motion quota is unavailable for this key. Enable billing/quota in Google AI Studio, then retry once. No result was stored.',
    };
  }
  if (detail.includes('401') || detail.includes('403') || detail.includes('PERMISSION_DENIED')) {
    return { status: 403, message: 'Gemini motion access was denied for this key. Check the key and enabled models. No result was stored.' };
  }
  return { status: 502, message: 'The motion service could not complete this request. No result was stored.' };
}

function openAiImageMessage(status: number, detail: string): { status: number; message: string } {
  const normalized = detail.toLowerCase();
  if (status === 401 || status === 403) {
    return { status: 403, message: 'OpenAI image access was denied. Check OPENAI_API_KEY and your project permissions. No result was stored.' };
  }
  if (status === 429 && (normalized.includes('quota') || normalized.includes('billing') || normalized.includes('insufficient'))) {
    return { status: 429, message: 'OpenAI image credits or quota are unavailable for this key. Add API billing or raise the project limit, then retry. No result was stored.' };
  }
  if (status === 429) {
    return { status: 429, message: 'OpenAI image generation is rate-limited right now. Wait a moment and retry. No result was stored.' };
  }
  if (status === 400 && normalized.includes('moderation_blocked')) {
    return { status: 400, message: 'This visual request was blocked by an image safety check. Revise the prompt and try again. No result was stored.' };
  }
  if (status >= 400 && status < 500) {
    return { status, message: 'OpenAI could not use this visual request. Revise it and try again. No result was stored.' };
  }
  return { status: 502, message: 'The image service could not complete this request. No result was stored.' };
}

const MUSIC_PROMPT_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    removedReferences: { type: 'array', items: { type: 'string' } },
  },
  required: ['prompt', 'removedReferences'],
  additionalProperties: false,
} as const;

function stripReferences(prompt: string, references: string[]): string {
  let clean = prompt;
  for (const reference of references) {
    const term = reference.trim();
    if (!term) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(escaped, 'gi'), '');
  }
  return clean
    .replace(/\b(?:in the style of|inspired by|sounds? like|reminiscent of)\b\s*[,;:]?/gi, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

type MusicPipeline = 'v1' | 'v2';

type VocalMode = 'auto' | 'vocals' | 'instrumental';

/**
 * The playback plan the master is cut against. `targetDurationSeconds` is
 * pinned to what we actually asked the provider for rather than the resolver's
 * ideal length — judging a two-minute generation against a three-minute ideal
 * would mark every song degraded for no useful reason.
 */
function musicPlaybackPlan(
  request: string,
  vocalMode: Exclude<VocalMode, 'auto'>,
  lengthSeconds: number,
  scene?: SceneAudioContext,
): PlaybackPlan {
  const brief = resolveMusicBrief({ userRequest: request, vocalControl: vocalMode, scene });
  return { ...brief.playback, targetDurationSeconds: lengthSeconds };
}

function resolveVocalMode(request: string, requested: VocalMode): Exclude<VocalMode, 'auto'> {
  if (requested !== 'auto') return requested;
  const text = request.toLowerCase();
  // Positive vocal intent wins over contradictory template residue such as
  // "no vocals" left in an older saved prompt.
  if (/\b(vocals?|sing(?:er|ing)?|rap(?:per|ping)?|lyrics?|verse|chorus|hook|chant|spoken word|ad[- ]?libs?)\b/.test(text)) return 'vocals';
  if (/\b(instrumental|no vocals?|without vocals?|music only)\b/.test(text)) return 'instrumental';
  return 'instrumental';
}

async function adaptMusicPrompt(
  client: Anthropic,
  request: string,
  requestedMode: VocalMode = 'auto',
): Promise<{ prompt: string; removedReferences: string[]; vocalMode: Exclude<VocalMode, 'auto'> }> {
  const vocalMode = resolveVocalMode(request, requestedMode);
  const message = await client.messages.create({
    model: MUSIC_PROMPT_MODEL,
    max_tokens: 500,
    system: [
      'Convert a user music request into a concise production prompt for a music-generation model.',
      'Infer musical DNA from any named artists, bands, songs, albums, producers, or eras: instrumentation, tempo, groove, harmony, arrangement, production texture, performance feel, dynamics, and emotional arc.',
      'The output prompt must contain no artist, band, song, album, label, producer, celebrity, or other proper-name references from the request.',
      'Never write “in the style of”, “inspired by”, “sounds like”, or equivalent comparison language.',
      'Do not reproduce lyrics, melodies, titles, or signature phrases associated with a removed reference. Describe transferable musical characteristics only.',
      vocalMode === 'vocals'
        ? 'The user wants vocals. Preserve their requested vocal language, delivery, speed, tone, structure, and any clearly original lyrics they supplied. Explicitly require prominent vocals; never turn this into an instrumental or add “no vocals”.'
        : 'The user wants an instrumental. Explicitly state that it has no vocals.',
      'Shape a restrained long-form ambient bed that can repeat invisibly. Begin immediately at the established texture: no count-in, opening swell, fanfare, or long fade-in. Maintain stable harmony, dynamics and instrumentation. End in the same musical state as the beginning: no cadence, resolution, final hit, fade-out, or trailing silence.',
      'Match the image’s emotional valence exactly. Dark, lonely, ominous, contemplative or melancholic imagery must not become cheerful, jaunty, triumphant or whimsical unless explicitly requested.',
      'Write 45–110 words, usable directly as a music generation prompt. Return every removed named reference in removedReferences.',
    ].join(' '),
    output_config: { format: { type: 'json_schema', schema: MUSIC_PROMPT_SCHEMA } },
    messages: [{ role: 'user', content: request }],
  });
  const text = message.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Prompt adapter returned no text.');
  const parsed = JSON.parse(text.text) as { prompt?: string; removedReferences?: string[] };
  const references = Array.isArray(parsed.removedReferences) ? parsed.removedReferences : [];
  const prompt = stripReferences(parsed.prompt?.trim() ?? '', references);
  if (!prompt) throw new Error('Prompt adapter returned an empty prompt.');
  return { prompt, removedReferences: references, vocalMode };
}

/** Direct media operations behind one capability-shaped local boundary. */
export function mediaPlugin(mode: string): Plugin {
  let estimatedSpendUsd = 0;
  return {
    name: 'vibe-media',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '');
      const elevenKey = env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
      const geminiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      const openAiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
      const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      const spendCapUsd = Number(env.MEDIA_GENERATION_CAP_USD || DEFAULT_SESSION_CAP_USD);
      // Anything other than an explicit 'v1' runs the mastered pipeline.
      const musicPipeline: MusicPipeline =
        (env.VIBE_MUSIC_PIPELINE || process.env.VIBE_MUSIC_PIPELINE) === 'v1' ? 'v1' : 'v2';
      const musicCostUsd = musicPipeline === 'v1' ? MUSIC_COST_USD : MUSIC_COST_USD_V2;
      const musicLengthMs = musicPipeline === 'v1' ? MUSIC_LENGTH_MS : MUSIC_LENGTH_MS_V2;
      const musicLengthSeconds = musicLengthMs / 1000;
      const gemini = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : undefined;
      const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : undefined;

      const reserve = (estimatedCost: number) => {
        if (estimatedSpendUsd + estimatedCost > spendCapUsd + 0.0001) return false;
        estimatedSpendUsd += estimatedCost;
        return true;
      };

      const release = (estimatedCost: number) => {
        estimatedSpendUsd = Math.max(0, estimatedSpendUsd - estimatedCost);
      };

      const authorize = async (
        ownerId: string,
        operation: CreditOperation,
        estimatedCostUsd: number,
        provider: string,
        idempotencyKey?: string,
      ): Promise<CreditReservation | undefined> => {
        const reservation = await reserveCredits(ownerId, operation, { idempotencyKey, provider, estimatedCostUsd });
        if (!reservation) return undefined;
        if (!reservation.persistent && !reserve(estimatedCostUsd)) return undefined;
        return reservation;
      };

      const fail = async (reservation: CreditReservation | undefined, estimatedCostUsd: number, code: string) => {
        if (!reservation) return;
        if (!reservation.persistent) release(estimatedCostUsd);
        await failReservation(reservation, code);
      };

      server.middlewares.use('/api/media', async (req, res) => {
        const path = (req.url ?? '').split('?')[0];
        if (req.method === 'GET' && (path === '/status' || path === 'status')) {
          sendJson(res, 200, {
            sceneGeneration: generationAllowed('image') && Boolean(openAiKey),
            motionGeneration: generationAllowed('motion') && Boolean(gemini),
            musicGeneration: generationAllowed('music') && Boolean(elevenKey),
            musicPromptAdaptation: generationAllowed('direction') && Boolean(anthropic),
            generationMode: generationMode(),
            imageProvider: IMAGE_PROVIDER,
            imageModel: IMAGE_MODEL,
            motionModel: VIDEO_MODEL,
            musicModel: MUSIC_MODEL,
            estimatedCostsUsd: {
              image: IMAGE_COST_USD,
              motionDraft: VIDEO_COST_USD,
              music: musicCostUsd + MUSIC_PROMPT_COST_USD,
            },
            estimatedSpendUsd: Number(estimatedSpendUsd.toFixed(3)),
            spendCapUsd,
            pipelineVersion: musicPipeline,
          });
          return;
        }

        if (req.method !== 'POST') {
          sendJson(res, 404, { message: 'Media operation not found.' });
          return;
        }

        const viewer = await viewerFor(req, res);
        if (!viewer) {
          sendJson(res, 401, { message: 'A session is required.' });
          return;
        }
        const idempotencyKeyHeader = req.headers['x-idempotency-key'];
        const idempotencyKey = typeof idempotencyKeyHeader === 'string' && idempotencyKeyHeader.length <= 200
          ? idempotencyKeyHeader : undefined;

        if (path === '/image' || path === 'image') {
          if (!generationAllowed('image')) {
            sendJson(res, 503, { message: generationDisabledMessage() });
            return;
          }
          if (!openAiKey) {
            sendJson(res, 503, { message: 'Image generation needs OPENAI_API_KEY on the local server.' });
            return;
          }
          let reservation: CreditReservation | undefined;
          try {
            const body = JSON.parse(await readBody(req)) as { prompt?: string; style?: string };
            const prompt = body.prompt?.trim();
            if (!prompt) {
              sendJson(res, 400, { message: 'Describe the visual first.' });
              return;
            }
            reservation = await authorize(viewer.id, 'image', IMAGE_COST_USD, IMAGE_PROVIDER, idempotencyKey);
            if (!reservation) {
              sendJson(res, 402, { message: 'You do not have enough Vibe Credits for this image.' });
              return;
            }
            const style = body.style?.trim() || 'cinematic digital art';
            const imagePrompt = [
                `Create a production-quality widescreen source image for a living visual environment. Subject: ${prompt}.`,
                `Art direction: ${style}. Desktop 16:9 composition, strong subject separation, rich fine detail, coherent anatomy and lighting, no text, no border, no UI, no watermark-like lettering.`,
                'Compose it so realtime grid, ASCII, halftone, glow, and motion treatments can track the subject without destroying its identity.',
              ].join(' ');
            const upstream = await fetch('https://api.openai.com/v1/images/generations', {
              method: 'POST',
              headers: {
                authorization: `Bearer ${openAiKey}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: IMAGE_MODEL,
                prompt: imagePrompt,
                size: '1536x1024',
                quality: 'low',
                output_format: 'png',
                n: 1,
              }),
            });
            if (!upstream.ok) {
              const detail = await upstream.text();
              await fail(reservation, IMAGE_COST_USD, `provider_${upstream.status}`);
              reservation = undefined;
              server.config.logger.error(`[vibe] OpenAI image failed (${upstream.status}): ${detail.slice(0, 1200)}`);
              const failure = openAiImageMessage(upstream.status, detail);
              sendJson(res, failure.status, { message: failure.message });
              return;
            }
            const response = (await upstream.json()) as { data?: Array<{ b64_json?: string }> };
            const imageData = response.data?.[0]?.b64_json;
            if (!imageData) throw new Error('OpenAI returned no image bytes.');
            await completeReservation(reservation);
            reservation = undefined;
            sendJson(res, 200, {
              data: imageData,
              mimeType: 'image/png',
              provider: IMAGE_PROVIDER,
              model: IMAGE_MODEL,
              prompt,
              estimatedCostUsd: IMAGE_COST_USD,
            });
          } catch (err) {
            await fail(reservation, IMAGE_COST_USD, 'image_failed');
            server.config.logger.error(`[vibe] image generation failed: ${String(err)}`);
            sendJson(res, String(err).includes('too large') ? 413 : 502, {
              message: String(err).includes('too large') ? 'The image request is too large.' : 'The image service could not complete this request. No result was stored.',
            });
          }
          return;
        }

        if (path === '/motion' || path === 'motion') {
          if (!generationAllowed('motion')) {
            sendJson(res, 503, { message: generationDisabledMessage() });
            return;
          }
          if (!gemini || !geminiKey) {
            sendJson(res, 503, { message: 'Motion generation needs GEMINI_API_KEY on the local server.' });
            return;
          }
          let reservation: CreditReservation | undefined;
          let outputPath: string | undefined;
          try {
            const body = JSON.parse(await readBody(req)) as {
              prompt?: string;
              imageData?: string;
              mimeType?: string;
            };
            const prompt = body.prompt?.trim();
            if (!prompt || !body.imageData) {
              sendJson(res, 400, { message: 'Motion generation needs a prompt and source image.' });
              return;
            }
            reservation = await authorize(viewer.id, 'motion', VIDEO_COST_USD, 'google', idempotencyKey);
            if (!reservation) {
              sendJson(res, 402, { message: 'You do not have enough Vibe Credits for motion generation.' });
              return;
            }
            let operation = await gemini.models.generateVideos({
              model: VIDEO_MODEL,
              source: {
                prompt: [
                  `Animate this source as a seamless living visual: ${prompt}.`,
                  'Motion must be clearly visible during the first second. Preserve subject identity and fine detail. Use confident organic subject motion, secondary motion, and restrained camera movement. Avoid cuts, text, morphing anatomy, or new objects.',
                ].join(' '),
                image: { imageBytes: body.imageData, mimeType: body.mimeType ?? 'image/png' },
              },
              config: {
                numberOfVideos: 1,
                durationSeconds: 8,
                aspectRatio: '16:9',
                resolution: '720p',
                negativePrompt: 'text, captions, logos, cuts, duplicate subjects, broken anatomy, melting, jitter, camera whip',
              },
            });
            const deadline = Date.now() + 6 * 60_000;
            while (!operation.done && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 8_000));
              operation = await gemini.operations.getVideosOperation({ operation });
            }
            if (!operation.done) throw new Error('Motion generation timed out.');
            if (operation.error) throw new Error(JSON.stringify(operation.error));
            const video = operation.response?.generatedVideos?.[0]?.video;
            if (!video) throw new Error('Gemini returned no video.');
            let bytes: Buffer;
            if (video.videoBytes) {
              bytes = Buffer.from(video.videoBytes, 'base64');
            } else {
              outputPath = join(tmpdir(), `vibe-motion-${randomUUID()}.mp4`);
              await gemini.files.download({ file: video, downloadPath: outputPath });
              bytes = await readFile(outputPath);
            }
            if (!bytes.length) throw new Error('Generated video contained no bytes.');
            await completeReservation(reservation);
            reservation = undefined;
            sendJson(res, 200, {
              data: bytes.toString('base64'),
              mimeType: video.mimeType ?? 'video/mp4',
              provider: 'google',
              model: VIDEO_MODEL,
              prompt,
              durationSeconds: 8,
              estimatedCostUsd: VIDEO_COST_USD,
            });
          } catch (err) {
            await fail(reservation, VIDEO_COST_USD, 'motion_failed');
            server.config.logger.error(`[vibe] motion generation failed: ${String(err)}`);
            if (String(err).includes('too large')) {
              sendJson(res, 413, { message: 'The motion request is too large.' });
              return;
            }
            const failure = geminiMessage(err);
            sendJson(res, failure.status, { message: failure.message });
          } finally {
            if (outputPath) void unlink(outputPath).catch(() => undefined);
          }
          return;
        }

        if (path === '/music-prompt' || path === 'music-prompt') {
          if (!generationAllowed('direction')) {
            sendJson(res, 503, { message: generationDisabledMessage() });
            return;
          }
          if (!anthropic) {
            sendJson(res, 503, { message: 'Artist-reference adaptation needs ANTHROPIC_API_KEY on the local server.' });
            return;
          }
          let reservation: CreditReservation | undefined;
          try {
            const body = JSON.parse(await readBody(req)) as { prompt?: string; vocalMode?: VocalMode };
            const request = body.prompt?.trim();
            if (!request) {
              sendJson(res, 400, { message: 'Describe the music first.' });
              return;
            }
            reservation = await authorize(viewer.id, 'direction', MUSIC_PROMPT_COST_USD, MUSIC_PROMPT_PROVIDER, idempotencyKey);
            if (!reservation) {
              sendJson(res, 402, { message: 'You do not have enough Vibe Credits for music direction.' });
              return;
            }
            const adapted = await adaptMusicPrompt(anthropic, request, body.vocalMode ?? 'auto');
            await completeReservation(reservation);
            reservation = undefined;
            sendJson(res, 200, {
              ...adapted,
              provider: MUSIC_PROMPT_PROVIDER,
              model: MUSIC_PROMPT_MODEL,
            });
          } catch (err) {
            await fail(reservation, MUSIC_PROMPT_COST_USD, 'music_direction_failed');
            server.config.logger.error(`[vibe] music prompt adaptation failed: ${String(err)}`);
            sendJson(res, String(err).includes('too large') ? 413 : 502, {
              message: String(err).includes('too large') ? 'The music request is too large.' : 'The music direction could not be translated right now.',
            });
          }
          return;
        }

        if (path !== '/music' && path !== 'music') {
          sendJson(res, 404, { message: 'Media operation not found.' });
          return;
        }
        if (!generationAllowed('music')) {
          sendJson(res, 503, { message: generationDisabledMessage() });
          return;
        }
        if (!elevenKey) {
          sendJson(res, 503, {
            message: 'Music generation needs ELEVENLABS_API_KEY on the local server. Your current mix is unchanged.',
          });
          return;
        }
        // v1 translates references with Anthropic; v2 with Luna. Either way the
        // route refuses to run without a translator, because the alternative is
        // forwarding a name to the generator.
        if (musicPipeline === 'v1' && !anthropic) {
          sendJson(res, 503, {
            message: 'Music generation needs ANTHROPIC_API_KEY to translate artist references before sending them to ElevenLabs.',
          });
          return;
        }
        if (musicPipeline === 'v2' && !openAiKey) {
          sendJson(res, 503, {
            message: 'Music generation needs OPENAI_API_KEY to translate artist references before sending them to ElevenLabs.',
          });
          return;
        }
        const totalMusicCostUsd = musicCostUsd + MUSIC_PROMPT_COST_USD;
        let reservation: CreditReservation | undefined;
        try {
          const body = JSON.parse(await readBody(req)) as {
            prompt?: string;
            vocalMode?: VocalMode;
            sceneContext?: SceneAudioContext;
          };
          const prompt = body.prompt?.trim();
          if (!prompt) {
            sendJson(res, 400, { message: 'Describe the music first.' });
            return;
          }

          reservation = await authorize(viewer.id, 'music', totalMusicCostUsd, MUSIC_PROVIDER, idempotencyKey);
          if (!reservation) {
            sendJson(res, 402, { message: 'You do not have enough Vibe Credits for music generation.' });
            return;
          }

          let musicPrompt: string;
          let musicVocalMode: Exclude<VocalMode, 'auto'>;
          let promptProvider: string;
          let promptModel: string;

          if (musicPipeline === 'v1') {
            const adapted = await adaptMusicPrompt(anthropic!, prompt, body.vocalMode ?? 'auto');
            musicPrompt = adapted.prompt;
            musicVocalMode = adapted.vocalMode;
            promptProvider = MUSIC_PROMPT_PROVIDER;
            promptModel = MUSIC_PROMPT_MODEL;
          } else {
            // An explicit UI choice is authoritative; the keyword regex is only
            // ever consulted for 'auto'.
            const requestedVocalMode = body.vocalMode ?? 'auto';
            musicVocalMode = requestedVocalMode === 'auto'
              ? resolveVocalMode(prompt, 'auto')
              : requestedVocalMode;

            const brief = resolveMusicBrief({
              userRequest: prompt,
              vocalControl: musicVocalMode,
              scene: body.sceneContext,
            });
            const rendered = renderProviderPrompt(brief, 'elevenlabs');

            // The LLM runs only when the request may carry a name. Everything
            // else reaches the generator in the user's own words.
            let requestText = prompt;
            let removedReferences: string[] = [];
            promptProvider = NO_LLM_CALL;
            promptModel = NO_LLM_CALL;

            if (containsNamedReference(prompt)) {
              const translated = await translateReferences(prompt, openAiKey);
              requestText = translated.prompt;
              removedReferences = translated.removedReferences;
              promptProvider = SANITISER_PROVIDER;
              promptModel = SANITISER_MODEL;
            }

            // Defence in depth: the regex pass runs on every request, including
            // the ones no model ever saw. It costs nothing.
            musicPrompt = stripReferences(`${rendered} ${requestText}`.trim(), removedReferences);
          }

          const upstream = await fetch(
            'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
            {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'xi-api-key': elevenKey },
            body: JSON.stringify({
              model_id: MUSIC_MODEL,
              prompt: musicVocalMode === 'vocals'
                ? `Song with prominent vocals. ${musicPrompt}`
                : `Instrumental music with no vocals. ${musicPrompt}`,
              music_length_ms: musicLengthMs,
              force_instrumental: musicVocalMode === 'instrumental',
            }),
            },
          );
          if (!upstream.ok) {
            await fail(reservation, totalMusicCostUsd, `provider_${upstream.status}`);
            reservation = undefined;
            const detail = await upstream.text();
            server.config.logger.error(`[vibe] Eleven Music failed (${upstream.status}): ${detail.slice(0, 1200)}`);
            sendJson(res, upstream.status === 429 ? 429 : 502, {
              message: upstream.status === 429
                ? 'Music generation is busy. Wait a moment and try again.'
                : 'The music service could not create this track. Your current mix is unchanged.',
            });
            return;
          }

          const audio = Buffer.from(await upstream.arrayBuffer());
          if (!audio.length) {
            throw new Error('Eleven Music response contained no audio bytes.');
          }

          const songId = upstream.headers.get('song-id') ?? undefined;
          const upstreamMimeType = upstream.headers.get('content-type') ?? 'audio/mpeg';

          // The provider has generated and billed the track. Settle here, before
          // any post-processing, so nothing downstream can refund spent money.
          await completeReservation(reservation, songId);
          reservation = undefined;

          let audioOut: Buffer = audio;
          let mimeTypeOut = upstreamMimeType;
          let durationSecondsOut: number = musicLengthSeconds;
          let extras: { masterReport: MasterReport; playback: PlaybackPlan; degraded: boolean } | undefined;

          if (musicPipeline === 'v2') {
            const playback = musicPlaybackPlan(prompt, musicVocalMode, musicLengthSeconds, body.sceneContext);
            let masterReport: MasterReport = { ok: false };
            try {
              const mastered = await masterTrack(audio, playback);
              audioOut = mastered.audio;
              // masterTrack falls back to the raw input on a total failure; the
              // upstream type is more accurate than its generic placeholder.
              mimeTypeOut = mastered.mimeType === 'application/octet-stream' ? upstreamMimeType : mastered.mimeType;
              masterReport = mastered.report;
              durationSecondsOut = mastered.report.outputDurationSeconds ?? musicLengthSeconds;
            } catch (masteringErr) {
              // Deliberately swallowed. Reaching the outer catch would call fail()
              // and refund credits for audio the provider already delivered, so a
              // mastering fault degrades to the unmastered track instead.
              masterReport = { ok: false, reason: `Mastering unavailable: ${String(masteringErr)}`.slice(0, 500) };
              server.config.logger.error(`[vibe] music mastering failed, returning unmastered audio: ${String(masteringErr)}`);
            }
            extras = { masterReport, playback, degraded: masterReport.degraded === true };
          }

          sendJson(res, 200, {
            data: audioOut.toString('base64'),
            mimeType: mimeTypeOut,
            provider: MUSIC_PROVIDER,
            model: MUSIC_MODEL,
            durationSeconds: durationSecondsOut,
            songId,
            adaptedPrompt: musicPrompt,
            vocalMode: musicVocalMode,
            promptProvider,
            promptModel,
            estimatedCostUsd: totalMusicCostUsd,
            ...extras,
          });
        } catch (err) {
          await fail(reservation, totalMusicCostUsd, 'music_failed');
          server.config.logger.error(`[vibe] music generation failed: ${String(err)}`);
          sendJson(res, String(err).includes('too large') ? 413 : 500, {
            message: String(err).includes('too large') ? 'The music request is too large.' : 'The music could not be generated right now.',
          });
        }
      });
    },
  };
}
