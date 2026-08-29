import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { viewerFor } from './auth';
import { database, deleteProductData, ensureProductSchema } from './database';
import { deleteOwnerStorage, ownerDir } from './storage';

export const POLICY_VERSION = '2026-08-29-beta';

type ResponseLike = { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void };
function json(res: ResponseLike, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 4096) throw new Error('Policy acknowledgment payload is too large.');
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

async function localJson(ownerId: string, name: string): Promise<unknown[]> {
  try {
    const parsed = JSON.parse(await readFile(join(ownerDir(ownerId), `${name}.json`), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function exportFor(ownerId: string): Promise<Record<string, unknown>> {
  const db = database();
  if (!db) {
    const assets = await readdir(join(ownerDir(ownerId), 'assets')).catch(() => []);
    return { projects: await localJson(ownerId, 'projects'), folders: await localJson(ownerId, 'folders'), assetFiles: assets.filter((name) => !name.endsWith('.json')) };
  }
  await ensureProductSchema();
  const [projects, folders, assets, credits, jobs, acknowledgements] = await Promise.all([
    db.query('SELECT document, updated_at FROM vibe_projects WHERE owner_id = $1 ORDER BY updated_at', [ownerId]),
    db.query('SELECT document, updated_at FROM vibe_folders WHERE owner_id = $1 ORDER BY updated_at', [ownerId]),
    db.query('SELECT id, mime_type, byte_size, created_at FROM vibe_assets WHERE owner_id = $1 ORDER BY created_at', [ownerId]),
    db.query('SELECT delta, reason, reference, created_at FROM vibe_credit_ledger WHERE owner_id = $1 ORDER BY created_at', [ownerId]),
    db.query('SELECT operation, credits, status, provider, estimated_cost_usd, error_code, created_at, completed_at FROM vibe_generation_jobs WHERE owner_id = $1 ORDER BY created_at', [ownerId]),
    db.query('SELECT policy_version, source, created_at FROM vibe_policy_acknowledgements WHERE owner_id = $1 ORDER BY created_at', [ownerId]),
  ]);
  return { projects: projects.rows, folders: folders.rows, assets: assets.rows, creditLedger: credits.rows, generationJobs: jobs.rows, policyAcknowledgements: acknowledgements.rows };
}

export function privacyPlugin(): Plugin {
  return { name: 'vibe-privacy', configureServer(server) {
    server.middlewares.use('/api/privacy', async (req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      try {
        const viewer = await viewerFor(req, res);
        if (!viewer) return json(res, 401, { message: 'A session is required.' });
        const db = database();
        if (req.method === 'GET' && (path === '/status' || path === 'status')) {
          if (!db) return json(res, 200, { acknowledged: false, policyVersion: POLICY_VERSION, persistent: false });
          await ensureProductSchema();
          const result = await db.query(
            'SELECT 1 FROM vibe_policy_acknowledgements WHERE owner_id = $1 AND policy_version = $2',
            [viewer.id, POLICY_VERSION],
          );
          return json(res, 200, { acknowledged: Boolean(result.rowCount), policyVersion: POLICY_VERSION, persistent: true });
        }
        if (req.method === 'POST' && (path === '/acknowledge' || path === 'acknowledge')) {
          const body = await readJson(req);
          if (body.accepted !== true || body.policyVersion !== POLICY_VERSION) {
            return json(res, 400, { message: 'Explicit acceptance of the current Beta Terms is required.' });
          }
          if (db) {
            await ensureProductSchema();
            await db.query(
              `INSERT INTO vibe_policy_acknowledgements (id, owner_id, policy_version, source)
               VALUES ($1, $2, $3, 'web-beta-gate') ON CONFLICT (owner_id, policy_version) DO NOTHING`,
              [randomUUID(), viewer.id, POLICY_VERSION],
            );
          }
          return json(res, 200, { acknowledged: true, policyVersion: POLICY_VERSION });
        }
        if (req.method === 'GET' && (path === '/export' || path === 'export')) {
          return json(res, 200, {
            exportedAt: new Date().toISOString(),
            account: { id: viewer.id, name: viewer.name, email: viewer.email, isAnonymous: viewer.isAnonymous },
            data: await exportFor(viewer.id),
          });
        }
        if (req.method === 'POST' && (path === '/delete-product-data' || path === 'delete-product-data')) {
          await deleteProductData(viewer.id);
          await deleteOwnerStorage(viewer.id);
          return json(res, 200, { deleted: true });
        }
        return json(res, 404, { message: 'Privacy operation not found.' });
      } catch (error) {
        server.config.logger.error(`[vibe] privacy operation failed: ${String(error)}`);
        return json(res, 500, { message: 'The privacy request could not be completed.' });
      }
    });
  } };
}
