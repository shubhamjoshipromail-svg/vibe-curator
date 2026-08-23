import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database, ensureProductSchema } from './database';

export const BETA_WELCOME_CREDITS = 100;

export type CreditOperation = 'image' | 'music' | 'motion' | 'shader' | 'direction';

export const CREDIT_COSTS: Record<CreditOperation, number> = {
  image: 2,
  music: 8,
  motion: 60,
  shader: 1,
  direction: 1,
};

export interface CreditStatus {
  balance: number;
  reserved: number;
  available: number;
  plan: string;
  persistent: boolean;
}

export interface CreditReservation {
  id: string;
  ownerId: string;
  operation: CreditOperation;
  credits: number;
  persistent: boolean;
}

async function grantBetaCredits(client: PoolClient, ownerId: string): Promise<void> {
  await client.query(
    `INSERT INTO vibe_billing_accounts (owner_id, plan) VALUES ($1, 'beta')
     ON CONFLICT (owner_id) DO NOTHING`,
    [ownerId],
  );
  await client.query(
    `INSERT INTO vibe_credit_ledger (id, owner_id, delta, reason, reference, metadata)
     VALUES ($1, $2, $3, 'beta_welcome', 'beta_welcome_v1', $4)
     ON CONFLICT (owner_id, reference) DO NOTHING`,
    [randomUUID(), ownerId, BETA_WELCOME_CREDITS, JSON.stringify({ campaign: 'private-beta' })],
  );
}

async function statusWithClient(client: PoolClient, ownerId: string): Promise<CreditStatus> {
  await grantBetaCredits(client, ownerId);
  const result = await client.query(
    `SELECT
       COALESCE((SELECT SUM(delta) FROM vibe_credit_ledger WHERE owner_id = $1), 0)::int AS balance,
       COALESCE((SELECT SUM(credits) FROM vibe_generation_jobs
         WHERE owner_id = $1 AND status = 'reserved' AND expires_at > NOW()), 0)::int AS reserved,
       COALESCE((SELECT plan FROM vibe_billing_accounts WHERE owner_id = $1), 'beta') AS plan`,
    [ownerId],
  );
  const balance = Number(result.rows[0]?.balance ?? 0);
  const reserved = Number(result.rows[0]?.reserved ?? 0);
  return { balance, reserved, available: Math.max(0, balance - reserved), plan: result.rows[0]?.plan ?? 'beta', persistent: true };
}

export async function creditStatus(ownerId: string): Promise<CreditStatus> {
  const db = database();
  if (!db) return { balance: BETA_WELCOME_CREDITS, reserved: 0, available: BETA_WELCOME_CREDITS, plan: 'local-beta', persistent: false };
  await ensureProductSchema();
  const client = await db.connect();
  try {
    return await statusWithClient(client, ownerId);
  } finally {
    client.release();
  }
}

export async function grantCredits(
  ownerId: string,
  amount: number,
  reason: string,
  reference: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Credit grant must be a positive integer.');
  const db = database();
  if (!db) return;
  await ensureProductSchema();
  await db.query(
    `INSERT INTO vibe_credit_ledger (id, owner_id, delta, reason, reference, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (owner_id, reference) DO NOTHING`,
    [randomUUID(), ownerId, amount, reason, reference, JSON.stringify(metadata)],
  );
}

export async function reserveCredits(
  ownerId: string,
  operation: CreditOperation,
  options: { idempotencyKey?: string; provider?: string; estimatedCostUsd?: number } = {},
): Promise<CreditReservation | undefined> {
  const credits = CREDIT_COSTS[operation];
  const db = database();
  if (!db) return { id: randomUUID(), ownerId, operation, credits, persistent: false };
  await ensureProductSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serialize balance decisions for one owner without locking unrelated users.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ownerId]);
    const status = await statusWithClient(client, ownerId);
    if (status.available < credits) {
      await client.query('ROLLBACK');
      return undefined;
    }
    if (options.idempotencyKey) {
      const existing = await client.query(
        `SELECT id, status FROM vibe_generation_jobs
         WHERE owner_id = $1 AND idempotency_key = $2`,
        [ownerId, options.idempotencyKey],
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return undefined;
      }
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO vibe_generation_jobs (
         id, owner_id, operation, credits, status, idempotency_key,
         provider, estimated_cost_usd, expires_at
       ) VALUES ($1, $2, $3, $4, 'reserved', $5, $6, $7, NOW() + INTERVAL '20 minutes')`,
      [id, ownerId, operation, credits, options.idempotencyKey ?? null, options.provider ?? null, options.estimatedCostUsd ?? null],
    );
    await client.query('COMMIT');
    return { id, ownerId, operation, credits, persistent: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function completeReservation(reservation: CreditReservation, providerRequestId?: string): Promise<void> {
  if (!reservation.persistent) return;
  const db = database();
  if (!db) return;
  await ensureProductSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE vibe_generation_jobs
       SET status = 'completed', provider_request_id = $2, completed_at = NOW()
       WHERE id = $1 AND owner_id = $3 AND status = 'reserved'
       RETURNING credits, operation`,
      [reservation.id, providerRequestId ?? null, reservation.ownerId],
    );
    if (updated.rowCount) {
      await client.query(
        `INSERT INTO vibe_credit_ledger (id, owner_id, delta, reason, reference, metadata)
         VALUES ($1, $2, $3, 'generation', $4, $5)
         ON CONFLICT (owner_id, reference) DO NOTHING`,
        [randomUUID(), reservation.ownerId, -reservation.credits, `generation:${reservation.id}`, JSON.stringify({ operation: reservation.operation })],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function failReservation(reservation: CreditReservation, errorCode = 'provider_failed'): Promise<void> {
  if (!reservation.persistent) return;
  const db = database();
  if (!db) return;
  await db.query(
    `UPDATE vibe_generation_jobs
     SET status = 'failed', error_code = $2, completed_at = NOW()
     WHERE id = $1 AND owner_id = $3 AND status = 'reserved'`,
    [reservation.id, errorCode, reservation.ownerId],
  );
}
