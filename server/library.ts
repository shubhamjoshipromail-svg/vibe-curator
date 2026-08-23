import type { Plugin } from 'vite';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { database, ensureProductSchema } from './database';
import { viewerFor } from './auth';
import { ensureOwnerStorage, ownerAssetDir, ownerDir } from './storage';
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const ALLOWED_ASSET_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
]);

type ResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string | Buffer): void;
};

function json(res: ResponseLike, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

function safeId(value: string): string | undefined {
  const decoded = decodeURIComponent(value);
  return /^[a-zA-Z0-9_-]{3,160}$/.test(decoded) ? decoded : undefined;
}

function assetMime(value: string | string[] | undefined): string | undefined {
  const normalized = (Array.isArray(value) ? value[0] : value)?.split(';')[0].trim().toLowerCase();
  return normalized && ALLOWED_ASSET_MIME_TYPES.has(normalized) ? normalized : undefined;
}

async function readDocuments(kind: 'projects' | 'folders', ownerId: string): Promise<Array<Record<string, unknown>>> {
  const db = database();
  if (db) {
    await ensureProductSchema();
    const result = await db.query(`SELECT document FROM vibe_${kind} WHERE owner_id = $1 ORDER BY updated_at`, [ownerId]);
    return result.rows.map((row) => row.document as Record<string, unknown>);
  }
  try {
    const parsed = JSON.parse(await readFile(join(ownerDir(ownerId), `${kind}.json`), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string') : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeDocuments(kind: 'projects' | 'folders', ownerId: string, documents: Array<Record<string, unknown>>): Promise<void> {
  const db = database();
  if (db) {
    await ensureProductSchema();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM vibe_${kind} WHERE owner_id = $1`, [ownerId]);
      for (const document of documents) {
        await client.query(
          `INSERT INTO vibe_${kind} (owner_id, id, document, updated_at) VALUES ($1, $2, $3, $4)`,
          [ownerId, document.id, JSON.stringify(document), document.updatedAt || new Date().toISOString()],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }
  await ensureOwnerStorage(ownerId);
  const file = join(ownerDir(ownerId), `${kind}.json`);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(documents, null, 2), 'utf8');
  await rename(temporary, file);
}

function readRequest(req: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
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

/** Local, browser-independent persistence for the desktop prototype. */
export function libraryPlugin(): Plugin {
  let projectMutations: Promise<void> = Promise.resolve();
  let folderMutations: Promise<void> = Promise.resolve();
  const mutateProjects = (operation: () => Promise<void>) => {
    projectMutations = projectMutations.then(operation, operation);
    return projectMutations;
  };
  const mutateFolders = (operation: () => Promise<void>) => {
    folderMutations = folderMutations.then(operation, operation);
    return folderMutations;
  };

  return {
    name: 'vibe-library',
    configureServer(server) {
      server.middlewares.use('/api/library', async (req, res) => {
        const response = res as ResponseLike;
        const path = (req.url ?? '/').split('?')[0];
        const parts = path.split('/').filter(Boolean);
        try {
          const viewer = await viewerFor(req, res);
          if (!viewer) {
            json(response, 401, { message: 'A session is required.' });
            return;
          }
          const ownerId = viewer.id;
          if (parts[0] === 'folders' && parts.length === 1 && req.method === 'GET') {
            await folderMutations;
            json(response, 200, await readDocuments('folders', ownerId));
            return;
          }

          if (parts[0] === 'folders' && parts.length === 2) {
            const id = safeId(parts[1]);
            if (!id) {
              json(response, 400, { message: 'Invalid folder id.' });
              return;
            }
            if (req.method === 'PUT') {
              const raw = await readRequest(req, 64 * 1024);
              const folder = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
              if (folder.id !== id || typeof folder.name !== 'string') {
                json(response, 400, { message: 'Invalid folder.' });
                return;
              }
              await mutateFolders(async () => {
                const folders = (await readDocuments('folders', ownerId)).filter((item) => item.id !== id);
                folders.push(folder);
                await writeDocuments('folders', ownerId, folders);
              });
              json(response, 200, { ok: true });
              return;
            }
            if (req.method === 'DELETE') {
              await mutateFolders(async () => {
                await writeDocuments('folders', ownerId, (await readDocuments('folders', ownerId)).filter((item) => item.id !== id));
              });
              json(response, 200, { ok: true });
              return;
            }
          }

          if (parts[0] === 'projects' && parts.length === 1 && req.method === 'GET') {
            await projectMutations;
            json(response, 200, await readDocuments('projects', ownerId));
            return;
          }

          if (parts[0] === 'projects' && parts.length === 2) {
            const id = safeId(parts[1]);
            if (!id) {
              json(response, 400, { message: 'Invalid project id.' });
              return;
            }
            if (req.method === 'PUT') {
              const raw = await readRequest(req, 2 * 1024 * 1024);
              const project = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
              if (project.id !== id) {
                json(response, 400, { message: 'Project id does not match the request.' });
                return;
              }
              await mutateProjects(async () => {
                const projects = (await readDocuments('projects', ownerId)).filter((item) => item.id !== id);
                projects.push(project);
                await writeDocuments('projects', ownerId, projects);
              });
              json(response, 200, { ok: true });
              return;
            }
            if (req.method === 'DELETE') {
              await mutateProjects(async () => {
                await writeDocuments('projects', ownerId, (await readDocuments('projects', ownerId)).filter((item) => item.id !== id));
              });
              json(response, 200, { ok: true });
              return;
            }
          }

          if (parts[0] === 'assets' && parts.length === 2) {
            const id = safeId(parts[1]);
            if (!id) {
              json(response, 400, { message: 'Invalid asset id.' });
              return;
            }
            const userAssetDir = ownerAssetDir(ownerId);
            const assetPath = join(userAssetDir, id);
            const metadataPath = join(userAssetDir, `${id}.json`);
            if (req.method === 'PUT') {
              const mimeType = assetMime(req.headers['content-type']);
              if (!mimeType) {
                json(response, 415, { message: 'Only supported image, video, and audio files can be stored.' });
                return;
              }
              const bytes = await readRequest(req, MAX_ASSET_BYTES);
              await ensureOwnerStorage(ownerId);
              await writeFile(assetPath, bytes);
              await writeFile(metadataPath, JSON.stringify({ mimeType }), 'utf8');
              const db = database();
              if (db) await db.query(
                `INSERT INTO vibe_assets (owner_id, id, mime_type, byte_size) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (owner_id, id) DO UPDATE SET mime_type = EXCLUDED.mime_type, byte_size = EXCLUDED.byte_size`,
                [ownerId, id, mimeType, bytes.length],
              );
              json(response, 200, { ok: true, bytes: bytes.length });
              return;
            }
            if (req.method === 'GET' || req.method === 'HEAD') {
              try {
                const [assetStat, metadata] = await Promise.all([
                  stat(assetPath),
                  readFile(metadataPath, 'utf8').then((value) => JSON.parse(value) as { mimeType?: string }).catch(() => ({})),
                ]);
                response.statusCode = 200;
                const mimeType = assetMime(metadata.mimeType) || 'application/octet-stream';
                response.setHeader('content-type', mimeType);
                if (mimeType === 'application/octet-stream') response.setHeader('content-disposition', 'attachment');
                response.setHeader('content-length', String(assetStat.size));
                response.setHeader('cache-control', 'no-cache');
                response.end(req.method === 'HEAD' ? undefined : await readFile(assetPath));
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') json(response, 404, { message: 'Asset not found.' });
                else throw error;
              }
              return;
            }
            if (req.method === 'DELETE') {
              await Promise.all([unlink(assetPath).catch(() => undefined), unlink(metadataPath).catch(() => undefined)]);
              const db = database();
              if (db) await db.query('DELETE FROM vibe_assets WHERE owner_id = $1 AND id = $2', [ownerId, id]);
              json(response, 200, { ok: true });
              return;
            }
          }

          json(response, 404, { message: 'Library operation not found.' });
        } catch (error) {
          server.config.logger.error(`[vibe] library operation failed: ${String(error)}`);
          json(response, String(error).includes('too large') ? 413 : 500, { message: 'The shared local library could not complete this operation.' });
        }
      });
    },
  };
}
