import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import Anthropic from '@anthropic-ai/sdk';
// @ts-expect-error — plain .mjs shared with the built-in library generator, so
// the shipped examples and the runtime path can never drift apart.
import { SYSTEM_PROMPT, SHADER_SCHEMA, buildUserMessage, MODEL } from './shader-prompt.mjs';

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

async function readBody(req: {
  on: (e: string, cb: (c?: unknown) => void) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
    });
    req.on('end', () => resolve(data));
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
        if (!client) {
          res.statusCode = 503;
          res.end('ANTHROPIC_API_KEY is not configured on the server. See .env.example.');
          return;
        }

        try {
          const body = JSON.parse(await readBody(req)) as RequestBody;
          if (!body.prompt?.trim()) {
            res.statusCode = 400;
            res.end('prompt is required');
            return;
          }

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
            res.statusCode = 422;
            res.end('The model declined this request.');
            return;
          }

          const text = message.content.find((b) => b.type === 'text');
          if (!text || text.type !== 'text') {
            res.statusCode = 502;
            res.end('No text content in model response.');
            return;
          }

          const parsed = JSON.parse(text.text) as Record<string, unknown>;
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
          server.config.logger.error(`[vibe] shader generation failed: ${String(err)}`);
          const status = typeof err === 'object' && err && 'status' in err
            ? Number((err as { status?: number }).status) : 500;
          res.statusCode = Number.isFinite(status) ? status : 500;
          res.setHeader('content-type', 'application/json');
          const message = res.statusCode === 429
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
