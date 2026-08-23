import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MUSIC_MODEL = 'music_v2';
const MUSIC_PROVIDER = 'elevenlabs';
const MUSIC_PROMPT_MODEL = 'claude-haiku-4-5';
const MUSIC_PROMPT_PROVIDER = 'anthropic';
const IMAGE_MODEL = 'gpt-image-2';
const IMAGE_PROVIDER = 'openai';
const VIDEO_MODEL = 'veo-3.1-lite-generate-preview';
// Conservative draft estimate. OpenAI bills GPT Image 2 output by image tokens.
const IMAGE_COST_USD = 0.01;
const VIDEO_COST_USD = 0.20;
const MUSIC_COST_USD = 0.225;
const MUSIC_PROMPT_COST_USD = 0.001;
const DEFAULT_SESSION_CAP_USD = 3;

async function readBody(req: { on: (e: string, cb: (c?: unknown) => void) => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += String(chunk)));
    req.on('end', () => resolve(data));
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

type VocalMode = 'auto' | 'vocals' | 'instrumental';

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

      server.middlewares.use('/api/media', async (req, res) => {
        const path = (req.url ?? '').split('?')[0];
        if (req.method === 'GET' && (path === '/status' || path === 'status')) {
          sendJson(res, 200, {
            sceneGeneration: Boolean(openAiKey),
            motionGeneration: Boolean(gemini),
            musicGeneration: Boolean(elevenKey),
            musicPromptAdaptation: Boolean(anthropic),
            imageProvider: IMAGE_PROVIDER,
            imageModel: IMAGE_MODEL,
            motionModel: VIDEO_MODEL,
            musicModel: MUSIC_MODEL,
            estimatedCostsUsd: {
              image: IMAGE_COST_USD,
              motionDraft: VIDEO_COST_USD,
              music: MUSIC_COST_USD + MUSIC_PROMPT_COST_USD,
            },
            estimatedSpendUsd: Number(estimatedSpendUsd.toFixed(3)),
            spendCapUsd,
          });
          return;
        }

        if (req.method !== 'POST') {
          sendJson(res, 404, { message: 'Media operation not found.' });
          return;
        }

        if (path === '/image' || path === 'image') {
          if (!openAiKey) {
            sendJson(res, 503, { message: 'Image generation needs OPENAI_API_KEY on the local server.' });
            return;
          }
          if (!reserve(IMAGE_COST_USD)) {
            sendJson(res, 402, { message: `The $${spendCapUsd.toFixed(2)} media-generation cap has been reached.` });
            return;
          }
          try {
            const body = JSON.parse(await readBody(req)) as { prompt?: string; style?: string };
            const prompt = body.prompt?.trim();
            if (!prompt) {
              release(IMAGE_COST_USD);
              sendJson(res, 400, { message: 'Describe the visual first.' });
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
              release(IMAGE_COST_USD);
              server.config.logger.error(`[vibe] OpenAI image failed (${upstream.status}): ${detail.slice(0, 1200)}`);
              const failure = openAiImageMessage(upstream.status, detail);
              sendJson(res, failure.status, { message: failure.message });
              return;
            }
            const response = (await upstream.json()) as { data?: Array<{ b64_json?: string }> };
            const imageData = response.data?.[0]?.b64_json;
            if (!imageData) throw new Error('OpenAI returned no image bytes.');
            sendJson(res, 200, {
              data: imageData,
              mimeType: 'image/png',
              provider: IMAGE_PROVIDER,
              model: IMAGE_MODEL,
              prompt,
              estimatedCostUsd: IMAGE_COST_USD,
            });
          } catch (err) {
            release(IMAGE_COST_USD);
            server.config.logger.error(`[vibe] image generation failed: ${String(err)}`);
            sendJson(res, 502, { message: 'The image service could not complete this request. No result was stored.' });
          }
          return;
        }

        if (path === '/motion' || path === 'motion') {
          if (!gemini || !geminiKey) {
            sendJson(res, 503, { message: 'Motion generation needs GEMINI_API_KEY on the local server.' });
            return;
          }
          if (!reserve(VIDEO_COST_USD)) {
            sendJson(res, 402, { message: `The $${spendCapUsd.toFixed(2)} media-generation cap has been reached.` });
            return;
          }
          let outputPath: string | undefined;
          try {
            const body = JSON.parse(await readBody(req)) as {
              prompt?: string;
              imageData?: string;
              mimeType?: string;
            };
            const prompt = body.prompt?.trim();
            if (!prompt || !body.imageData) {
              release(VIDEO_COST_USD);
              sendJson(res, 400, { message: 'Motion generation needs a prompt and source image.' });
              return;
            }
            let operation = await gemini.models.generateVideos({
              model: VIDEO_MODEL,
              prompt: [
                `Animate this source as a seamless living visual: ${prompt}.`,
                'Motion must be clearly visible during the first second. Preserve subject identity and fine detail. Use confident organic subject motion, secondary motion, and restrained camera movement. Avoid cuts, text, morphing anatomy, or new objects.',
              ].join(' '),
              image: { imageBytes: body.imageData, mimeType: body.mimeType ?? 'image/png' },
              config: {
                numberOfVideos: 1,
                durationSeconds: 4,
                aspectRatio: '16:9',
                resolution: '720p',
                generateAudio: true,
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
            sendJson(res, 200, {
              data: bytes.toString('base64'),
              mimeType: video.mimeType ?? 'video/mp4',
              provider: 'google',
              model: VIDEO_MODEL,
              prompt,
              durationSeconds: 4,
              estimatedCostUsd: VIDEO_COST_USD,
            });
          } catch (err) {
            release(VIDEO_COST_USD);
            server.config.logger.error(`[vibe] motion generation failed: ${String(err)}`);
            const failure = geminiMessage(err);
            sendJson(res, failure.status, { message: failure.message });
          } finally {
            if (outputPath) void unlink(outputPath).catch(() => undefined);
          }
          return;
        }

        if (path === '/music-prompt' || path === 'music-prompt') {
          if (!anthropic) {
            sendJson(res, 503, { message: 'Artist-reference adaptation needs ANTHROPIC_API_KEY on the local server.' });
            return;
          }
          try {
            const body = JSON.parse(await readBody(req)) as { prompt?: string; vocalMode?: VocalMode };
            const request = body.prompt?.trim();
            if (!request) {
              sendJson(res, 400, { message: 'Describe the music first.' });
              return;
            }
            if (!reserve(MUSIC_PROMPT_COST_USD)) {
              sendJson(res, 402, { message: `The $${spendCapUsd.toFixed(2)} media-generation cap has been reached.` });
              return;
            }
            const adapted = await adaptMusicPrompt(anthropic, request, body.vocalMode ?? 'auto');
            sendJson(res, 200, {
              ...adapted,
              provider: MUSIC_PROMPT_PROVIDER,
              model: MUSIC_PROMPT_MODEL,
            });
          } catch (err) {
            release(MUSIC_PROMPT_COST_USD);
            server.config.logger.error(`[vibe] music prompt adaptation failed: ${String(err)}`);
            sendJson(res, 502, { message: 'The music direction could not be translated right now.' });
          }
          return;
        }

        if (path !== '/music' && path !== 'music') {
          sendJson(res, 404, { message: 'Media operation not found.' });
          return;
        }
        if (!elevenKey) {
          sendJson(res, 503, {
            message: 'Music generation needs ELEVENLABS_API_KEY on the local server. Your current mix is unchanged.',
          });
          return;
        }
        if (!anthropic) {
          sendJson(res, 503, {
            message: 'Music generation needs ANTHROPIC_API_KEY to translate artist references before sending them to ElevenLabs.',
          });
          return;
        }
        const totalMusicCostUsd = MUSIC_COST_USD + MUSIC_PROMPT_COST_USD;
        if (!reserve(totalMusicCostUsd)) {
          sendJson(res, 402, { message: `The $${spendCapUsd.toFixed(2)} media-generation cap has been reached.` });
          return;
        }

        let promptAdapted = false;
        try {
          const body = JSON.parse(await readBody(req)) as { prompt?: string; vocalMode?: VocalMode };
          const prompt = body.prompt?.trim();
          if (!prompt) {
            release(totalMusicCostUsd);
            sendJson(res, 400, { message: 'Describe the music first.' });
            return;
          }

          const adapted = await adaptMusicPrompt(anthropic, prompt, body.vocalMode ?? 'auto');
          promptAdapted = true;

          const upstream = await fetch(
            'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
            {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'xi-api-key': elevenKey },
            body: JSON.stringify({
              model_id: MUSIC_MODEL,
              prompt: adapted.vocalMode === 'vocals'
                ? `Song with prominent vocals. ${adapted.prompt}`
                : `Instrumental music with no vocals. ${adapted.prompt}`,
              music_length_ms: 90_000,
              force_instrumental: adapted.vocalMode === 'instrumental',
            }),
            },
          );
          if (!upstream.ok) {
            release(MUSIC_COST_USD);
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
            server.config.logger.error('[vibe] Eleven Music response contained no audio bytes');
            sendJson(res, 502, { message: 'The music service returned no playable track.' });
            return;
          }

          sendJson(res, 200, {
            data: audio.toString('base64'),
            mimeType: upstream.headers.get('content-type') ?? 'audio/mpeg',
            provider: MUSIC_PROVIDER,
            model: MUSIC_MODEL,
            durationSeconds: 90,
            songId: upstream.headers.get('song-id') ?? undefined,
            adaptedPrompt: adapted.prompt,
            vocalMode: adapted.vocalMode,
            promptProvider: MUSIC_PROMPT_PROVIDER,
            promptModel: MUSIC_PROMPT_MODEL,
            estimatedCostUsd: totalMusicCostUsd,
          });
        } catch (err) {
          release(promptAdapted ? MUSIC_COST_USD : totalMusicCostUsd);
          server.config.logger.error(`[vibe] music generation failed: ${String(err)}`);
          sendJson(res, 500, { message: 'The music could not be generated right now.' });
        }
      });
    },
  };
}
