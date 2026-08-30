import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { viewerFor } from './auth';
import { ownerAssetDir } from './storage';
import { canonicalizeActivationPreset } from './legacy-audio';

const ACTIVATION_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-zA-Z0-9_-]{3,160}$/;
const PACKAGED_APP_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost']);

interface NativeActivation {
  ownerId: string;
  preset: Record<string, unknown>;
  assetIds: Set<string>;
  expiresAt: number;
}

type ResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string | Buffer): void;
};

const activations = new Map<string, NativeActivation>();

function allowPackagedApp(req: IncomingMessage, res: ResponseLike): boolean {
  const origin = req.headers.origin ?? '';
  if (!PACKAGED_APP_ORIGINS.has(origin)) return false;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  res.setHeader('access-control-max-age', '600');
  return true;
}

function json(res: ResponseLike, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('referrer-policy', 'no-referrer');
  res.end(JSON.stringify(value));
}

function readRequest(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        settled = true;
        reject(new Error('Request is too large.'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => { if (!settled) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function activationFor(token: string): NativeActivation | undefined {
  const activation = activations.get(token);
  if (!activation) return undefined;
  if (activation.expiresAt <= Date.now()) {
    activations.delete(token);
    return undefined;
  }
  return activation;
}

function referencedAssets(preset: Record<string, unknown>): Set<string> {
  const result = new Set<string>();
  const scene = preset.scene as Record<string, unknown> | undefined;
  const music = preset.music as Record<string, unknown> | undefined;
  for (const value of [scene?.assetId, music?.url ? undefined : music?.assetId]) {
    if (typeof value === 'string' && ID_PATTERN.test(value)) result.add(value);
  }
  return result;
}

/** A private, expiring bridge from an authenticated web session to the local companion. */
export function nativeActivationPlugin(): Plugin {
  return {
    name: 'vibe-native-activation',
    configureServer(server) {
      server.middlewares.use('/api/native', async (request, response) => {
        const req = request as IncomingMessage;
        const res = response as ResponseLike;
        const path = (req.url ?? '/').split('?')[0];
        const parts = path.split('/').filter(Boolean);
        try {
          const packagedRequest = allowPackagedApp(req, res);
          if (req.method === 'OPTIONS' && packagedRequest) {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (parts[0] !== 'activations') {
            json(res, 404, { message: 'Native operation not found.' });
            return;
          }

          if (parts.length === 1 && req.method === 'POST') {
            const viewer = await viewerFor(req, response);
            if (!viewer) {
              json(res, 401, { message: 'A session is required.' });
              return;
            }
            const raw = await readRequest(req, MAX_BODY_BYTES);
            const body = JSON.parse(raw.toString('utf8')) as { preset?: Record<string, unknown> };
            const receivedPreset = body.preset;
            if (!receivedPreset || typeof receivedPreset.id !== 'string' || !ID_PATTERN.test(receivedPreset.id)) {
              json(res, 400, { message: 'A valid preset is required.' });
              return;
            }
            const preset = canonicalizeActivationPreset(receivedPreset);
            const token = randomBytes(32).toString('hex');
            activations.set(token, {
              ownerId: viewer.id,
              preset,
              assetIds: referencedAssets(preset),
              expiresAt: Date.now() + ACTIVATION_TTL_MS,
            });
            if (activations.size > 1000) {
              for (const [key, value] of activations) if (value.expiresAt <= Date.now()) activations.delete(key);
            }
            json(res, 201, { deepLink: `vibecurator://open?activation=${token}`, expiresInSeconds: ACTIVATION_TTL_MS / 1000 });
            return;
          }

          const token = parts[1];
          if (!token || !TOKEN_PATTERN.test(token)) {
            json(res, 400, { message: 'Invalid activation.' });
            return;
          }
          const activation = activationFor(token);
          if (!activation) {
            json(res, 404, { message: 'This Display on Mac request expired. Send it again from the website.' });
            return;
          }

          if (parts.length === 2 && req.method === 'GET') {
            json(res, 200, { preset: activation.preset, expiresAt: new Date(activation.expiresAt).toISOString() });
            return;
          }

          if (parts[2] === 'assets' && parts.length === 4 && (req.method === 'GET' || req.method === 'HEAD')) {
            const assetId = parts[3];
            if (!ID_PATTERN.test(assetId) || !activation.assetIds.has(assetId)) {
              json(res, 404, { message: 'Transferred asset not found.' });
              return;
            }
            const directory = ownerAssetDir(activation.ownerId);
            const assetPath = join(directory, assetId);
            const metadataPath = join(directory, `${assetId}.json`);
            const [assetStat, metadata] = await Promise.all([
              stat(assetPath),
              readFile(metadataPath, 'utf8').then((value) => JSON.parse(value) as { mimeType?: string }).catch(() => ({})),
            ]);
            res.statusCode = 200;
            res.setHeader('content-type', metadata.mimeType || 'application/octet-stream');
            res.setHeader('content-length', String(assetStat.size));
            res.setHeader('cache-control', 'private, no-store');
            res.setHeader('referrer-policy', 'no-referrer');
            res.end(req.method === 'HEAD' ? undefined : await readFile(assetPath));
            return;
          }

          json(res, 404, { message: 'Native operation not found.' });
        } catch (error) {
          server.config.logger.error(`[vibe] native activation failed: ${String(error)}`);
          json(res, String(error).includes('too large') ? 413 : 500, { message: 'The Mac handoff could not be prepared.' });
        }
      });
    },
  };
}
