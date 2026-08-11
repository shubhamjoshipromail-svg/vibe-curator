import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MUSIC_MODEL = 'music_v2';
const MUSIC_PROVIDER = 'elevenlabs';
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const VIDEO_MODEL = 'veo-3.1-lite-generate-preview';
const IMAGE_COST_USD = 0.04;
const VIDEO_COST_USD = 0.20;
const MUSIC_COST_USD = 0.075;
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

function providerMessage(error: unknown, operation: 'image' | 'motion'): { status: number; message: string } {
  const detail = String(error);
  if (detail.includes('429') || detail.includes('RESOURCE_EXHAUSTED') || detail.toLowerCase().includes('quota')) {
    return {
      status: 429,
      message: `Gemini ${operation} quota is unavailable for this key. Enable billing/quota in Google AI Studio, then retry once. No result was stored.`,
    };
  }
  if (detail.includes('401') || detail.includes('403') || detail.includes('PERMISSION_DENIED')) {
    return { status: 403, message: `Gemini ${operation} access was denied for this key. Check the key and enabled models. No result was stored.` };
  }
  return { status: 502, message: `The ${operation} service could not complete this request. No result was stored.` };
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
      const spendCapUsd = Number(env.MEDIA_GENERATION_CAP_USD || DEFAULT_SESSION_CAP_USD);
      const gemini = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : undefined;

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
            sceneGeneration: Boolean(gemini),
            motionGeneration: Boolean(gemini),
            musicGeneration: Boolean(elevenKey),
            imageModel: IMAGE_MODEL,
            motionModel: VIDEO_MODEL,
            musicModel: MUSIC_MODEL,
            estimatedCostsUsd: {
              image: IMAGE_COST_USD,
              motionDraft: VIDEO_COST_USD,
              music: MUSIC_COST_USD,
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
          if (!gemini) {
            sendJson(res, 503, { message: 'Image generation needs GEMINI_API_KEY on the local server.' });
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
            const response = await gemini.models.generateContent({
              model: IMAGE_MODEL,
              contents: [
                `Create a production-quality widescreen source image for a living visual environment. Subject: ${prompt}.`,
                `Art direction: ${style}. Desktop 16:9 composition, strong subject separation, rich fine detail, coherent anatomy and lighting, no text, no border, no UI, no watermark-like lettering.`,
                'Compose it so realtime grid, ASCII, halftone, glow, and motion treatments can track the subject without destroying its identity.',
              ].join(' '),
              config: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
              },
            });
            const parts = response.candidates?.[0]?.content?.parts ?? [];
            const image = parts.find((part) => part.inlineData?.data)?.inlineData;
            if (!image?.data) throw new Error('Gemini returned no image bytes.');
            sendJson(res, 200, {
              data: image.data,
              mimeType: image.mimeType ?? 'image/png',
              provider: 'google',
              model: IMAGE_MODEL,
              prompt,
              estimatedCostUsd: IMAGE_COST_USD,
            });
          } catch (err) {
            release(IMAGE_COST_USD);
            server.config.logger.error(`[vibe] image generation failed: ${String(err)}`);
            const failure = providerMessage(err, 'image');
            sendJson(res, failure.status, { message: failure.message });
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
            const failure = providerMessage(err, 'motion');
            sendJson(res, failure.status, { message: failure.message });
          } finally {
            if (outputPath) void unlink(outputPath).catch(() => undefined);
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
        if (!reserve(MUSIC_COST_USD)) {
          sendJson(res, 402, { message: `The $${spendCapUsd.toFixed(2)} media-generation cap has been reached.` });
          return;
        }

        try {
          const body = JSON.parse(await readBody(req)) as { prompt?: string };
          const prompt = body.prompt?.trim();
          if (!prompt) {
            release(MUSIC_COST_USD);
            sendJson(res, 400, { message: 'Describe the music first.' });
            return;
          }

          const upstream = await fetch(
            'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
            {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'xi-api-key': elevenKey },
            body: JSON.stringify({
              model_id: MUSIC_MODEL,
              prompt: `Instrumental ambient soundtrack for a visual environment. No vocals. ${prompt}`,
              music_length_ms: 30_000,
              force_instrumental: true,
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
            release(MUSIC_COST_USD);
            server.config.logger.error('[vibe] Eleven Music response contained no audio bytes');
            sendJson(res, 502, { message: 'The music service returned no playable track.' });
            return;
          }

          sendJson(res, 200, {
            data: audio.toString('base64'),
            mimeType: upstream.headers.get('content-type') ?? 'audio/mpeg',
            provider: MUSIC_PROVIDER,
            model: MUSIC_MODEL,
            durationSeconds: 30,
            songId: upstream.headers.get('song-id') ?? undefined,
          });
        } catch (err) {
          release(MUSIC_COST_USD);
          server.config.logger.error(`[vibe] music generation failed: ${String(err)}`);
          sendJson(res, 500, { message: 'The music could not be generated right now.' });
        }
      });
    },
  };
}
