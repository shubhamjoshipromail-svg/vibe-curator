import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import Anthropic from '@anthropic-ai/sdk';
import type { IncomingMessage } from 'node:http';
import { viewerFor } from './auth';
import { completeReservation, failReservation, reserveCredits, reserveFailureMessage, type CreditReservation } from './credits';
import { generationAllowed, generationDisabledMessage } from './beta';
// @ts-expect-error — plain .mjs shared with the built-in library generator, so
// the shipped examples and the runtime path can never drift apart.
import { SYSTEM_PROMPT, SHADER_SCHEMA, buildUserMessage, MODEL } from './shader-prompt.mjs';

// Conservative reservation used by the company-wide beta spend ceiling.
const SHADER_ESTIMATED_COST_USD = 0.05;

/**
 * Dev-time generation proxy.
 *
 * The API key is read here, in the Node process, and never crosses to the
 * browser. Note the env var is ANTHROPIC_API_KEY, NOT VITE_ANTHROPIC_KEY — Vite
 * inlines any VITE_-prefixed variable into the client bundle, so that prefix
 * would ship the key to every visitor.
 *
 * This middleware is deliberately the same shape as its successors: a POST to
 * /api/gen/shader returning {name, notes, glsl, params}. Moving to a Cloudflare
 * Worker or a desktop main process later is a change of host, not of contract.
 */

interface RequestBody {
  prompt: string;
  paletteRamp?: string[];
  renderStyle?: string;
  previous?: { glsl: string; error: string };
}

async function readBody(req: IncomingMessage, limit = 512 * 1024): Promise<string> {
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

export function genShaderPlugin(mode: string): Plugin {
  return {
    name: 'vibe-gen-shader',
    configureServer(server) {
      // Read from .env without exposing anything to the client bundle.
      const env = loadEnv(mode, process.cwd(), '');
      const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      const client = apiKey ? new Anthropic({ apiKey }) : null;

      if (!client) {
        server.config.logger.warn(
          '[vibe] ANTHROPIC_API_KEY not set — effect generation disabled. Copy .env.example to .env.',
        );
      }

      server.middlewares.use('/api/gen/shader', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        if (!generationAllowed('shader')) {
          res.statusCode = 503;
          res.end(generationDisabledMessage());
          return;
        }
        if (!client) {
          res.statusCode = 503;
          res.end('ANTHROPIC_API_KEY is not configured on the server. See .env.example.');
          return;
        }

        let reservation: CreditReservation | undefined;
        try {
          const viewer = await viewerFor(req, res);
          if (!viewer) {
            res.statusCode = 401;
            res.end('A session is required.');
            return;
          }
          const body = JSON.parse(await readBody(req)) as RequestBody;
          if (!body.prompt?.trim()) {
            res.statusCode = 400;
            res.end('prompt is required');
            return;
          }
          const header = req.headers['x-idempotency-key'];
          const authorized = await reserveCredits(viewer.id, 'shader', {
            idempotencyKey: typeof header === 'string' && header.length <= 200 ? header : undefined,
            provider: 'anthropic',
            estimatedCostUsd: SHADER_ESTIMATED_COST_USD,
            email: viewer.email,
          });
          if (!authorized.ok) {
            res.statusCode = 402;
            res.end(reserveFailureMessage(authorized.reason, 'this effect'));
            return;
          }
          reservation = authorized.reservation;

          const message = await client.messages.create({
            model: MODEL,
            max_tokens: 6000,
            system: SYSTEM_PROMPT,
            output_config: {
              // Structured output removes an entire class of parsing bugs — no
              // markdown fences to strip, no prose wrapped around the code.
              format: { type: 'json_schema', schema: SHADER_SCHEMA },
            },
            messages: [{ role: 'user', content: buildUserMessage(body) }],
          });

          if (message.stop_reason === 'refusal') {
            await failReservation(reservation, 'provider_refusal');
            reservation = undefined;
            res.statusCode = 422;
            res.end('The model declined this request.');
            return;
          }

          const text = message.content.find((b) => b.type === 'text');
          if (!text || text.type !== 'text') {
            throw new Error('No text content in model response.');
          }

          const parsed = JSON.parse(text.text) as Record<string, unknown>;
          await completeReservation(reservation);
          reservation = undefined;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            ...parsed,
            generation: {
              provider: 'anthropic',
              model: MODEL,
              inputTokens: message.usage?.input_tokens ?? 0,
              outputTokens: message.usage?.output_tokens ?? 0,
            },
          }));
        } catch (err) {
          if (reservation) await failReservation(reservation, 'shader_failed');
          server.config.logger.error(`[vibe] shader generation failed: ${String(err)}`);
          const status = typeof err === 'object' && err && 'status' in err
            ? Number((err as { status?: number }).status) : 500;
          res.statusCode = String(err).includes('too large') ? 413 : Number.isFinite(status) ? status : 500;
          res.setHeader('content-type', 'application/json');
          const message = res.statusCode === 413
            ? 'The effect request is too large.'
            : res.statusCode === 429
            ? 'Effect generation is busy. Wait a moment and try again.'
            : res.statusCode === 402 || res.statusCode === 403
              ? 'Effect generation is not available for this account.'
              : 'The effect could not be generated right now.';
          res.end(JSON.stringify({ message }));
        }
      });
    },
  };
}
