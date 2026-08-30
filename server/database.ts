import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

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

    CREATE TABLE IF NOT EXISTS vibe_billing_accounts (
      owner_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'beta',
      stripe_customer_id TEXT UNIQUE,
      stripe_subscription_id TEXT UNIQUE,
      subscription_status TEXT,
      current_period_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vibe_credit_ledger (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      delta INTEGER NOT NULL CHECK (delta <> 0),
      reason TEXT NOT NULL,
      reference TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_id, reference)
    );
    CREATE INDEX IF NOT EXISTS vibe_credit_ledger_owner_created_idx
      ON vibe_credit_ledger (owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS vibe_generation_jobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      credits INTEGER NOT NULL CHECK (credits > 0),
      status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'failed')),
      idempotency_key TEXT,
      provider TEXT,
      provider_request_id TEXT,
      estimated_cost_usd NUMERIC(12, 6),
      actual_cost_usd NUMERIC(12, 6),
      error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      UNIQUE (owner_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS vibe_generation_jobs_owner_status_idx
      ON vibe_generation_jobs (owner_id, status, created_at DESC);

    -- Admin generations are still recorded so accounting and spend visibility
    -- stay intact, but they are excluded from the shared daily budget. Added by
    -- ALTER because the CREATE above is IF NOT EXISTS and would skip existing
    -- deployments.
    ALTER TABLE vibe_generation_jobs
      ADD COLUMN IF NOT EXISTS admin_bypass BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS vibe_webhook_events (
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, event_id)
    );

    CREATE TABLE IF NOT EXISTS vibe_policy_acknowledgements (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_id, policy_version)
    );
    CREATE INDEX IF NOT EXISTS vibe_policy_ack_owner_created_idx
      ON vibe_policy_acknowledgements (owner_id, created_at DESC);
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
    await client.query(
      `INSERT INTO vibe_billing_accounts (
         owner_id, plan, stripe_customer_id, stripe_subscription_id,
         subscription_status, current_period_end, created_at, updated_at
       )
       SELECT $2, plan, stripe_customer_id, stripe_subscription_id,
         subscription_status, current_period_end, created_at, updated_at
       FROM vibe_billing_accounts WHERE owner_id = $1
       ON CONFLICT (owner_id) DO NOTHING`,
      [fromUserId, toUserId],
    );
    await client.query('DELETE FROM vibe_billing_accounts WHERE owner_id = $1', [fromUserId]);
    await client.query(
      `INSERT INTO vibe_credit_ledger (id, owner_id, delta, reason, reference, metadata, created_at)
       SELECT id, $2, delta, reason, reference, metadata, created_at
       FROM vibe_credit_ledger WHERE owner_id = $1
       ON CONFLICT DO NOTHING`,
      [fromUserId, toUserId],
    );
    await client.query('DELETE FROM vibe_credit_ledger WHERE owner_id = $1', [fromUserId]);
    await client.query(
      `UPDATE vibe_generation_jobs SET owner_id = $2
       WHERE owner_id = $1 AND NOT EXISTS (
         SELECT 1 FROM vibe_generation_jobs existing
         WHERE existing.owner_id = $2
           AND existing.idempotency_key = vibe_generation_jobs.idempotency_key
           AND vibe_generation_jobs.idempotency_key IS NOT NULL
       )`,
      [fromUserId, toUserId],
    );
    await client.query('DELETE FROM vibe_generation_jobs WHERE owner_id = $1', [fromUserId]);
    await client.query(
      `INSERT INTO vibe_policy_acknowledgements (id, owner_id, policy_version, source, created_at)
       SELECT id, $2, policy_version, source, created_at
       FROM vibe_policy_acknowledgements WHERE owner_id = $1
       ON CONFLICT (owner_id, policy_version) DO NOTHING`,
      [fromUserId, toUserId],
    );
    await client.query('DELETE FROM vibe_policy_acknowledgements WHERE owner_id = $1', [fromUserId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteProductData(ownerId: string): Promise<void> {
  const db = database();
  if (!db) return;
  await ensureProductSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Preserve only a de-identified operational cost record so account deletion
    // cannot reset the company-wide provider budget. Prompts and source media
    // are never stored on these rows; request/idempotency links are removed.
    await client.query(
      `UPDATE vibe_generation_jobs
       SET owner_id = $2, idempotency_key = NULL, provider_request_id = NULL
       WHERE owner_id = $1`,
      [ownerId, `deleted_${randomUUID()}`],
    );
    for (const table of [
      'vibe_projects', 'vibe_folders', 'vibe_assets',
      'vibe_credit_ledger', 'vibe_billing_accounts', 'vibe_policy_acknowledgements',
    ]) {
      await client.query(`DELETE FROM ${table} WHERE owner_id = $1`, [ownerId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
