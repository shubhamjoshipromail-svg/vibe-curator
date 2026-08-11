import type { Plugin } from 'vite';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), '.vibe-data');
const ASSET_DIR = join(DATA_DIR, 'assets');
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');
const MAX_ASSET_BYTES = 100 * 1024 * 1024;

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

async function ensureStorage(): Promise<void> {
  await mkdir(ASSET_DIR, { recursive: true });
}

async function readProjects(): Promise<Array<Record<string, unknown>>> {
  try {
    const parsed = JSON.parse(await readFile(PROJECTS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string') : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeProjects(projects: Array<Record<string, unknown>>): Promise<void> {
  await ensureStorage();
  const temporary = `${PROJECTS_FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(projects, null, 2), 'utf8');
  await rename(temporary, PROJECTS_FILE);
}

function readRequest(req: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        reject(new Error('Request is too large.'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Local, browser-independent persistence for the desktop prototype. */
export function libraryPlugin(): Plugin {
  let projectMutations: Promise<void> = Promise.resolve();
  const mutateProjects = (operation: () => Promise<void>) => {
    projectMutations = projectMutations.then(operation, operation);
    return projectMutations;
  };

  return {
    name: 'vibe-library',
    configureServer(server) {
      void ensureStorage();
      server.middlewares.use('/api/library', async (req, res) => {
        const response = res as ResponseLike;
        const path = (req.url ?? '/').split('?')[0];
        const parts = path.split('/').filter(Boolean);
        try {
          if (parts[0] === 'projects' && parts.length === 1 && req.method === 'GET') {
            await projectMutations;
            json(response, 200, await readProjects());
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
                const projects = (await readProjects()).filter((item) => item.id !== id);
                projects.push(project);
                await writeProjects(projects);
              });
              json(response, 200, { ok: true });
              return;
            }
            if (req.method === 'DELETE') {
              await mutateProjects(async () => {
                await writeProjects((await readProjects()).filter((item) => item.id !== id));
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
            const assetPath = join(ASSET_DIR, id);
            const metadataPath = join(ASSET_DIR, `${id}.json`);
            if (req.method === 'PUT') {
              const bytes = await readRequest(req, MAX_ASSET_BYTES);
              await ensureStorage();
              await writeFile(assetPath, bytes);
              await writeFile(metadataPath, JSON.stringify({ mimeType: req.headers['content-type'] || 'application/octet-stream' }), 'utf8');
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
                response.setHeader('content-type', metadata.mimeType || 'application/octet-stream');
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
