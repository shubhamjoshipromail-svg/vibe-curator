import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

const MODEL = 'gpt-5-mini';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    motion: { type: 'string', enum: ['subtle', 'balanced', 'dramatic'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
    effects: { type: 'array', maxItems: 4, items: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' }, kind: { type: 'string', enum: ['fire', 'rain', 'embers', 'light-flicker', 'fog', 'dust'] },
        region: { type: 'object', additionalProperties: false, properties: {
          x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 },
          width: { type: 'number', minimum: 0.01, maximum: 1 }, height: { type: 'number', minimum: 0.01, maximum: 1 },
        }, required: ['x', 'y', 'width', 'height'] },
        mask: { type: 'array', minItems: 3, maxItems: 16, items: { type: 'object', additionalProperties: false, properties: {
          x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 },
        }, required: ['x', 'y'] } },
        intensity: { type: 'number', minimum: 0, maximum: 1 }, speed: { type: 'number', minimum: 0, maximum: 1 }, color: { type: 'string' },
      }, required: ['id', 'kind', 'region', 'mask', 'intensity', 'speed', 'color'],
    } },
    audio: { type: 'object', additionalProperties: false, properties: {
      textures: { type: 'array', items: { type: 'string', enum: ['fire_crackle', 'room_air', 'wind', 'rain', 'water'] } },
      events: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string' }, kind: { type: 'string', enum: ['owl', 'bird', 'thunder', 'chime'] },
        minIntervalSeconds: { type: 'number', minimum: 10, maximum: 600 }, maxIntervalSeconds: { type: 'number', minimum: 10, maximum: 900 },
        gain: { type: 'number', minimum: 0, maximum: 1 }, pan: { type: 'number', minimum: -1, maximum: 1 },
      }, required: ['id', 'kind', 'minIntervalSeconds', 'maxIntervalSeconds', 'gain', 'pan'] } },
      musicMood: { type: 'string', enum: ['dark_ambient', 'warm_ambient', 'ethereal', 'playful', 'tense', 'minimal'] },
      musicDirection: { type: 'string' },
    }, required: ['textures', 'events', 'musicMood', 'musicDirection'] },
  }, required: ['motion', 'confidence', 'rationale', 'effects', 'audio'],
} as const;

async function readBody(req: { on(e: string, cb: (chunk?: unknown) => void): void }): Promise<string> {
  return new Promise((resolve, reject) => { let data = ''; req.on('data', (c) => { data += String(c); }); req.on('end', () => resolve(data)); req.on('error', reject); });
}

function json(res: { statusCode: number; setHeader(k: string, v: string): void; end(s: string): void }, status: number, value: unknown): void {
  res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value));
}

export function livingDirectorPlugin(mode: string): Plugin {
  return { name: 'vibe-living-director', configureServer(server) {
    const env = loadEnv(mode, process.cwd(), '');
    const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    server.middlewares.use('/api/living-director', async (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { message: 'POST only' });
      if (!key) return json(res, 503, { message: 'Automatic visual direction needs OPENAI_API_KEY on the server.' });
      try {
        const body = JSON.parse(await readBody(req)) as { intent?: string; imageDataUrl?: string };
        if (!body.intent?.trim() || !body.imageDataUrl?.startsWith('data:image/')) return json(res, 400, { message: 'An intention and source image are required.' });
        const upstream = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            instructions: [
              'You are the scene director for a subtle living-background app.',
              'Inspect the image and user intention. Select only visible, appropriate regions for trusted effects.',
              'Regions and polygon mask points are normalized image coordinates. Keep the rectangle tight and trace the actually visible target with the polygon.',
              'Rain belongs only in visibly exterior/open-sky regions. Trace openings inside their frame; exclude sheltered interiors, arch stones and people.',
              'Fire and light-flicker must be tightly centered on visible flames or luminous practical sources.',
              'Prefer 1-3 effects. Protect faces, bodies, text, architecture and focal objects. Never invent an effect target that is not visible.',
              'Select sound textures/events from the provided enums. Occasional events should be sparse.',
              'Classify music mood from both the visible image and intention. Write a concise musicDirection covering emotional valence, tempo feel, instrumentation, density and seamless-loop behavior. Do not make dark imagery happy.',
              'This is planning only: do not write shader code or animation frames.',
            ].join(' '),
            input: [{ role: 'user', content: [
              { type: 'input_text', text: `User intention: ${body.intent.trim()}` },
              { type: 'input_image', image_url: body.imageDataUrl, detail: 'high' },
            ] }],
            text: { format: { type: 'json_schema', name: 'living_still_plan', strict: true, schema: SCHEMA } },
          }),
        });
        const payload = await upstream.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
        if (!upstream.ok) {
          server.config.logger.error(`[vibe] living director failed (${upstream.status}): ${payload.error?.message ?? 'unknown'}`);
          return json(res, upstream.status === 429 ? 429 : 502, { message: upstream.status === 429 ? 'The scene director is busy. Try again shortly.' : 'The scene director could not analyze this image.' });
        }
        const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
        if (!text) return json(res, 502, { message: 'The scene director returned no plan.' });
        const plan = JSON.parse(text) as Record<string, unknown>;
        return json(res, 200, { ...plan, provider: 'openai', model: MODEL });
      } catch (error) {
        server.config.logger.error(`[vibe] living director error: ${String(error)}`);
        return json(res, 500, { message: 'The scene director could not complete this request.' });
      }
    });
  } };
}
