import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

const MUSIC_MODEL = 'music_v2';
const MUSIC_PROVIDER = 'elevenlabs';

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

/** Direct media operations behind one capability-shaped local boundary. */
export function mediaPlugin(mode: string): Plugin {
  return {
    name: 'vibe-media',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '');
      const apiKey = env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;

      server.middlewares.use('/api/media', async (req, res) => {
        const path = (req.url ?? '').split('?')[0];
        if (req.method === 'GET' && (path === '/status' || path === 'status')) {
          sendJson(res, 200, {
            sceneGeneration: false,
            musicGeneration: Boolean(apiKey),
            musicModel: MUSIC_MODEL,
          });
          return;
        }

        if (req.method !== 'POST' || (path !== '/music' && path !== 'music')) {
          sendJson(res, 404, { message: 'Media operation not found.' });
          return;
        }
        if (!apiKey) {
          sendJson(res, 503, {
            message: 'Music generation needs ELEVENLABS_API_KEY on the local server. Your current mix is unchanged.',
          });
          return;
        }

        try {
          const body = JSON.parse(await readBody(req)) as { prompt?: string };
          const prompt = body.prompt?.trim();
          if (!prompt) {
            sendJson(res, 400, { message: 'Describe the music first.' });
            return;
          }

          const upstream = await fetch(
            'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
            {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'xi-api-key': apiKey },
            body: JSON.stringify({
              model_id: MUSIC_MODEL,
              prompt: `Instrumental ambient soundtrack for a visual environment. No vocals. ${prompt}`,
              music_length_ms: 30_000,
              force_instrumental: true,
            }),
            },
          );
          if (!upstream.ok) {
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
            durationSeconds: 30,
            songId: upstream.headers.get('song-id') ?? undefined,
          });
        } catch (err) {
          server.config.logger.error(`[vibe] music generation failed: ${String(err)}`);
          sendJson(res, 500, { message: 'The music could not be generated right now.' });
        }
      });
    },
  };
}
