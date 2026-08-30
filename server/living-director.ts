import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { viewerFor } from './auth';
import { completeReservation, failReservation, reserveCredits, reserveFailureMessage, type CreditReservation } from './credits';
import { generationAllowed, generationDisabledMessage } from './beta';

const MODEL = 'gpt-5.6-luna';
// Covers image input plus structured output. The previous 0.05 over-reserved by
// roughly 16x, which held credits hostage for work that never cost that much.
const DIRECTION_ESTIMATED_COST_USD = 0.005;

/**
 * One plan per image, not per generation. Re-scoring the same still for every
 * music or motion pass was the single largest source of wasted direction spend.
 * The key includes the intention because a new intention is a different brief,
 * and serving the old plan for it would be a stale-answer bug rather than a
 * saving.
 */
const PLAN_CACHE_LIMIT = 64;
const planCache = new Map<string, Record<string, unknown>>();

function planCacheKey(imageDataUrl: string, intent: string): string {
  return createHash('sha256').update(imageDataUrl).update('\0').update(intent).digest('hex');
}

function rememberPlan(key: string, plan: Record<string, unknown>): void {
  planCache.delete(key);
  planCache.set(key, plan);
  while (planCache.size > PLAN_CACHE_LIMIT) {
    const oldest = planCache.keys().next();
    if (oldest.done) break;
    planCache.delete(oldest.value);
  }
}

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
      // DEPRECATED: musicMood and musicDirection are retained only so presets
      // saved before the scene-context split keep loading. Nothing new may read
      // them — the music path takes sceneContext instead. Do not extend these.
      musicMood: { type: 'string', enum: ['dark_ambient', 'warm_ambient', 'ethereal', 'playful', 'tense', 'minimal'] },
      musicDirection: { type: 'string' },
    }, required: ['textures', 'events', 'musicMood', 'musicDirection'] },
    // Mirrors SceneAudioContext in src/audio/brief.ts. Observation only: what is
    // visible and how it feels, never what it should sound like.
    sceneContext: { type: 'object', additionalProperties: false, properties: {
      environment: { type: 'array', maxItems: 6, items: { type: 'string' } },
      observedElements: { type: 'array', maxItems: 8, items: { type: 'string' } },
      emotionalQualities: { type: 'array', maxItems: 6, items: { type: 'string' } },
      apparentEra: { type: 'string' },
      energy: { type: 'string', enum: ['still', 'gentle', 'active', 'intense'] },
      visualRhythm: { type: 'string', enum: ['fluid', 'steady', 'fragmented', 'pulsing'] },
      scale: { type: 'string', enum: ['intimate', 'room', 'landscape', 'cosmic'] },
      warmth: { type: 'number', minimum: 0, maximum: 1 },
      darkness: { type: 'number', minimum: 0, maximum: 1 },
    }, required: [
      'environment', 'observedElements', 'emotionalQualities', 'apparentEra',
      'energy', 'visualRhythm', 'scale', 'warmth', 'darkness',
    ] },
  }, required: ['motion', 'confidence', 'rationale', 'effects', 'audio', 'sceneContext'],
} as const;

async function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) return reject(new Error('Request is too large.'));
    let data = ''; let size = 0; let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      const value = String(chunk); size += Buffer.byteLength(value);
      if (size > limit) { settled = true; reject(new Error('Request is too large.')); return; }
      data += value;
    });
    req.on('end', () => { if (!settled) resolve(data); });
    req.on('error', reject);
  });
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
      if (!generationAllowed('direction')) return json(res, 503, { message: generationDisabledMessage() });
      if (!key) return json(res, 503, { message: 'Automatic visual direction needs OPENAI_API_KEY on the server.' });
      let reservation: CreditReservation | undefined;
      try {
        const viewer = await viewerFor(req, res);
        if (!viewer) return json(res, 401, { message: 'A session is required.' });
        const body = JSON.parse(await readBody(req)) as { intent?: string; imageDataUrl?: string };
        if (!body.intent?.trim() || !body.imageDataUrl?.startsWith('data:image/')) return json(res, 400, { message: 'An intention and source image are required.' });
        // Served before any reservation: a cache hit makes no provider call, so
        // it must not spend credits either.
        const cacheKey = planCacheKey(body.imageDataUrl, body.intent.trim());
        const cached = planCache.get(cacheKey);
        if (cached) {
          rememberPlan(cacheKey, cached);
          return json(res, 200, { ...cached, provider: 'openai', model: MODEL, cached: true });
        }

        const header = req.headers['x-idempotency-key'];
        const authorized = await reserveCredits(viewer.id, 'direction', {
          idempotencyKey: typeof header === 'string' && header.length <= 200 ? header : undefined,
          provider: 'openai',
          estimatedCostUsd: DIRECTION_ESTIMATED_COST_USD,
          email: viewer.email,
        });
        if (!authorized.ok) return json(res, 402, { message: reserveFailureMessage(authorized.reason, 'automatic direction') });
        reservation = authorized.reservation;
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
              // Scene analyser. The vision model reports observation, never
              // musical judgement: naming a genre or instrument here is what
              // used to let a visible campfire decide the arrangement.
              'Fill sceneContext by observation only. Report what is visibly present and how the scene feels.',
              'environment: where this takes place, as plain nouns (for example forest, night, interior, shoreline).',
              'observedElements: discrete things actually visible that make sound or imply it (for example fire, rain, crowd, machinery). Only what you can see. These become ambience, nothing else.',
              'emotionalQualities: how the scene feels, as plain adjectives (for example lonely, tender, ominous, expectant).',
              'apparentEra: the period the image appears to depict, or an empty string when there is no clear signal.',
              'energy: still, gentle, active or intense. visualRhythm: fluid, steady, fragmented or pulsing. scale: intimate, room, landscape or cosmic.',
              'warmth: 0 for cold light and palette, 1 for warm. darkness: 0 for bright, 1 for dark. Judge both from the image.',
              'You are FORBIDDEN from naming any musical genre, instrument, tempo, key, scale, chord, style, artist, band, producer or production technique anywhere in sceneContext. No “ambient”, no “strings”, no “slow”, no “minor key”, no “lo-fi”. Describe the scene, never the score.',
              'Do not make dark imagery feel happy. Match the emotional valence you actually see.',
              'Also set the deprecated musicMood and musicDirection fields for backward compatibility only; keep musicDirection to one short sentence and do not let it influence sceneContext.',
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
          await failReservation(reservation, `provider_${upstream.status}`);
          reservation = undefined;
          server.config.logger.error(`[vibe] living director failed (${upstream.status}): ${payload.error?.message ?? 'unknown'}`);
          return json(res, upstream.status === 429 ? 429 : 502, { message: upstream.status === 429 ? 'The scene director is busy. Try again shortly.' : 'The scene director could not analyze this image.' });
        }
        const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
        if (!text) throw new Error('The scene director returned no plan.');
        const plan = JSON.parse(text) as Record<string, unknown>;
        await completeReservation(reservation);
        reservation = undefined;
        rememberPlan(cacheKey, plan);
        return json(res, 200, { ...plan, provider: 'openai', model: MODEL, cached: false });
      } catch (error) {
        if (reservation) await failReservation(reservation, 'direction_failed');
        server.config.logger.error(`[vibe] living director error: ${String(error)}`);
        return json(res, String(error).includes('too large') ? 413 : 500, {
          message: String(error).includes('too large') ? 'The scene direction request is too large.' : 'The scene director could not complete this request.',
        });
      }
    });
  } };
}
