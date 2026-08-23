import { Pool } from 'pg';

let pool: Pool | undefined;
let initialized: Promise<void> | undefined;

export function database(): Pool | undefined {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  pool ??= new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
    max: 10,
  });
  return pool;
}

/** Product data is deliberately separate from Better Auth's own tables. */
export function ensureProductSchema(): Promise<void> {
  const db = database();
  if (!db) return Promise.resolve();
  initialized ??= db.query(`
    CREATE TABLE IF NOT EXISTS vibe_projects (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      document JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_id, id)
    );
    CREATE INDEX IF NOT EXISTS vibe_projects_owner_updated_idx
      ON vibe_projects (owner_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS vibe_folders (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      document JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_id, id)
    );

    CREATE TABLE IF NOT EXISTS vibe_assets (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_id, id)
    );
  `).then(() => undefined);
  return initialized;
}

export async function transferOwnership(fromUserId: string, toUserId: string): Promise<void> {
  const db = database();
  if (!db || fromUserId === toUserId) return;
  await ensureProductSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const table of ['vibe_projects', 'vibe_folders', 'vibe_assets']) {
      await client.query(
        `INSERT INTO ${table} SELECT $2, id, ${table === 'vibe_assets' ? 'mime_type, byte_size, created_at' : 'document, updated_at'} FROM ${table} WHERE owner_id = $1 ON CONFLICT (owner_id, id) DO NOTHING`,
        [fromUserId, toUserId],
      );
      await client.query(`DELETE FROM ${table} WHERE owner_id = $1`, [fromUserId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
