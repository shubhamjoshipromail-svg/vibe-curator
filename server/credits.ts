import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { database, ensureProductSchema } from './database';
import { generationBudgets, isAdminEmail } from './beta';
// Re-exported so the six generation routes keep importing refusal vocabulary
// from one place, while tests can pull the pure module directly.
export { reserveFailureMessage, type ReserveFailureReason } from './credit-messages';
import type { ReserveFailureReason } from './credit-messages';

export const BETA_WELCOME_CREDITS = 100;

export type CreditOperation = 'image' | 'music' | 'motion' | 'shader' | 'direction';

export const CREDIT_COSTS: Record<CreditOperation, number> = {
  image: 2,
  music: 2,
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
  /** USD this owner has committed today against the per-user daily cap. */
  todaySpendUsd: number;
  /** The per-user daily cap in force, so the UI can explain a block. */
  dailyCapUsd: number;
  /**
   * Set when generation is blocked by a spend cap rather than by credits.
   * `global` deliberately carries no figure: that is the owner's provider
   * account, not the user's business.
   */
  blockedBy?: 'user_daily_cap' | 'global_daily_cap';
  /** True for allowlisted admin accounts, so the UI can show it instead of a balance. */
  unlimited: boolean;
}

export type ReserveResult =
  | { ok: true; reservation: CreditReservation }
  | { ok: false; reason: ReserveFailureReason };

export interface CreditReservation {
  id: string;
  ownerId: string;
  operation: CreditOperation;
  credits: number;
  persistent: boolean;
  /** True when limits were skipped for an allowlisted admin account. */
  adminBypass: boolean;
}

/**
 * Spend that actually committed money today.
 *
 * Only `completed` jobs and `reserved` jobs still inside their window count. A
 * `failed` job paid a provider nothing, and an expired reservation was never
 * charged either — counting them burned the daily budget permanently on every
 * provider error and timeout.
 *
 * Admin rows are recorded but excluded, so an unlimited account cannot exhaust
 * the shared beta budget for everyone else.
 */
const COMMITTED_SPEND_PREDICATE = `
  estimated_cost_usd IS NOT NULL
  AND admin_bypass = FALSE
  AND (status = 'completed' OR (status = 'reserved' AND expires_at > NOW()))
  AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
`;

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

interface DailySpend {
  user: number;
  global: number;
}

async function dailySpend(client: PoolClient, ownerId: string): Promise<DailySpend> {
  const result = await client.query(
    `SELECT
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE owner_id = $1), 0)::float AS user_spend,
       COALESCE(SUM(estimated_cost_usd), 0)::float AS global_spend
     FROM vibe_generation_jobs
     WHERE ${COMMITTED_SPEND_PREDICATE}`,
    [ownerId],
  );
  return {
    user: Number(result.rows[0]?.user_spend ?? 0),
    global: Number(result.rows[0]?.global_spend ?? 0),
  };
}

async function statusWithClient(
  client: PoolClient,
  ownerId: string,
  email?: string | null,
): Promise<CreditStatus> {
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
  const unlimited = isAdminEmail(email);
  const budgets = generationBudgets();
  const spend = await dailySpend(client, ownerId);

  // Report a cap block only when it is the *binding* constraint. An admin is
  // never blocked, and a user who is simply out of credits should be told that
  // rather than being handed a cap explanation.
  let blockedBy: CreditStatus['blockedBy'];
  if (!unlimited) {
    if (spend.user >= budgets.userDailyUsd) blockedBy = 'user_daily_cap';
    else if (spend.global >= budgets.globalDailyUsd) blockedBy = 'global_daily_cap';
  }

  return {
    balance,
    reserved,
    available: Math.max(0, balance - reserved),
    plan: result.rows[0]?.plan ?? 'beta',
    persistent: true,
    todaySpendUsd: Number(spend.user.toFixed(4)),
    dailyCapUsd: budgets.userDailyUsd,
    blockedBy,
    unlimited,
  };
}

export async function creditStatus(ownerId: string, email?: string | null): Promise<CreditStatus> {
  const db = database();
  if (!db) {
    return {
      balance: BETA_WELCOME_CREDITS,
      reserved: 0,
      available: BETA_WELCOME_CREDITS,
      plan: 'local-beta',
      persistent: false,
      todaySpendUsd: 0,
      dailyCapUsd: generationBudgets().userDailyUsd,
      unlimited: isAdminEmail(email),
    };
  }
  await ensureProductSchema();
  const client = await db.connect();
  try {
    return await statusWithClient(client, ownerId, email);
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
  options: {
    idempotencyKey?: string;
    provider?: string;
    estimatedCostUsd?: number;
    /**
     * The viewer's verified account email, threaded from `viewerFor`. The admin
     * check lives here rather than at the call sites so media, director and
     * shader routes cannot drift apart on who is exempt.
     */
    email?: string | null;
  } = {},
): Promise<ReserveResult> {
  const credits = CREDIT_COSTS[operation];
  const adminBypass = isAdminEmail(options.email);
  const db = database();
  if (!db) {
    return {
      ok: true,
      reservation: { id: randomUUID(), ownerId, operation, credits, persistent: false, adminBypass },
    };
  }
  await ensureProductSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // One global lock makes the spend-limit check and reservation atomic across
    // every app instance. This protects the owner's provider account, not just
    // an individual user's credit balance.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vibe:daily-provider-budget'))");
    // Serialize balance decisions for one owner without locking unrelated users.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ownerId]);
    const status = await statusWithClient(client, ownerId, options.email);

    // Admins skip the balance check and both spend caps, but every other step
    // below still runs: the job row is written with its estimated cost so
    // accounting and spend visibility stay complete.
    if (!adminBypass && status.available < credits) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'insufficient_credits' };
    }

    if (options.idempotencyKey) {
      const existing = await client.query(
        `SELECT id, status FROM vibe_generation_jobs
         WHERE owner_id = $1 AND idempotency_key = $2`,
        [ownerId, options.idempotencyKey],
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return { ok: false, reason: 'duplicate_request' };
      }
    }

    if (!adminBypass && options.estimatedCostUsd && options.estimatedCostUsd > 0) {
      const budgets = generationBudgets();
      const spend = await dailySpend(client, ownerId);
      // Checked separately so the caller can say which ceiling was hit. One
      // combined condition is why a per-user block used to be reported as an
      // empty wallet.
      if (spend.user + options.estimatedCostUsd > budgets.userDailyUsd) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'user_daily_cap' };
      }
      if (spend.global + options.estimatedCostUsd > budgets.globalDailyUsd) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'global_daily_cap' };
      }
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO vibe_generation_jobs (
         id, owner_id, operation, credits, status, idempotency_key,
         provider, estimated_cost_usd, expires_at, admin_bypass
       ) VALUES ($1, $2, $3, $4, 'reserved', $5, $6, $7, NOW() + INTERVAL '20 minutes', $8)`,
      [id, ownerId, operation, credits, options.idempotencyKey ?? null, options.provider ?? null, options.estimatedCostUsd ?? null, adminBypass],
    );
    await client.query('COMMIT');
    return { ok: true, reservation: { id, ownerId, operation, credits, persistent: true, adminBypass } };
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
    // The job row above is always written, so admin spend stays visible in
    // accounting. The ledger debit is skipped: an unlimited account that still
    // burned credits would eventually go negative and start being refused,
    // which is the opposite of unlimited.
    if (updated.rowCount && !reservation.adminBypass) {
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
