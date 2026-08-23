import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { viewerFor } from './auth';
import { grantCredits } from './credits';
import { database, ensureProductSchema } from './database';

const STRIPE_API = 'https://api.stripe.com/v1';
const CREDIT_PACK_SIZE = 100;

type StripeObject = Record<string, unknown> & { id: string };
type StripeEvent = { id: string; type: string; data: { object: StripeObject } };

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) return reject(new Error('Request is too large.'));
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > limit) {
        settled = true;
        reject(new Error('Request is too large.'));
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function appOrigin(): string {
  const value = process.env.APP_URL || process.env.BETTER_AUTH_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:5178');
  return new URL(value).origin;
}

async function stripeRequest(path: string, params: Record<string, string>, idempotencyKey?: string): Promise<StripeObject> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe is not configured.');
  const body = new URLSearchParams(params);
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body,
  });
  const payload = await response.json() as StripeObject & { error?: { message?: string } };
  if (!response.ok) throw new Error(`Stripe request failed (${response.status}): ${payload.error?.message ?? 'unknown error'}`);
  return payload;
}

async function stripeCustomer(ownerId: string, email?: string, name?: string): Promise<string> {
  const db = database();
  if (!db) throw new Error('DATABASE_URL is required for billing.');
  await ensureProductSchema();
  const existing = await db.query('SELECT stripe_customer_id FROM vibe_billing_accounts WHERE owner_id = $1', [ownerId]);
  if (existing.rows[0]?.stripe_customer_id) return existing.rows[0].stripe_customer_id as string;
  const customer = await stripeRequest('/customers', {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    'metadata[owner_id]': ownerId,
  }, `vibe-customer-${ownerId}`);
  await db.query(
    `INSERT INTO vibe_billing_accounts (owner_id, stripe_customer_id)
     VALUES ($1, $2)
     ON CONFLICT (owner_id) DO UPDATE
       SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = NOW()`,
    [ownerId, customer.id],
  );
  return customer.id;
}

function checkoutPrice(kind: string): { price: string; mode: 'payment' | 'subscription'; credits?: number } | undefined {
  if (kind === 'plus') return process.env.STRIPE_PRICE_PLUS_MONTHLY
    ? { price: process.env.STRIPE_PRICE_PLUS_MONTHLY, mode: 'subscription' } : undefined;
  if (kind === 'creator') return process.env.STRIPE_PRICE_CREATOR_MONTHLY
    ? { price: process.env.STRIPE_PRICE_CREATOR_MONTHLY, mode: 'subscription' } : undefined;
  if (kind === 'credits_100') return process.env.STRIPE_PRICE_CREDITS_100
    ? { price: process.env.STRIPE_PRICE_CREDITS_100, mode: 'payment', credits: CREDIT_PACK_SIZE } : undefined;
  return undefined;
}

function verifyWebhook(payload: Buffer, signatureHeader: string, secret: string): boolean {
  const fields = Object.fromEntries(signatureHeader.split(',').map((part) => {
    const [key, ...rest] = part.split('=');
    return [key, rest.join('=')];
  }));
  const timestamp = Number(fields.t);
  const signature = fields.v1;
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload.toString('utf8')}`).digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

async function processStripeEvent(event: StripeEvent): Promise<void> {
  const db = database();
  if (!db) throw new Error('DATABASE_URL is required for Stripe webhooks.');
  await ensureProductSchema();
  const claimed = await db.query(
    `INSERT INTO vibe_webhook_events (provider, event_id, event_type)
     VALUES ('stripe', $1, $2) ON CONFLICT DO NOTHING RETURNING event_id`,
    [event.id, event.type],
  );
  if (!claimed.rowCount) return;
  try {
    const object = event.data.object;
    if (event.type === 'checkout.session.completed') {
      const metadata = (object.metadata ?? {}) as Record<string, unknown>;
      const ownerId = stringValue(metadata.owner_id);
      const paymentStatus = stringValue(object.payment_status);
      const credits = Number(metadata.credits ?? 0);
      if (ownerId && paymentStatus === 'paid' && Number.isSafeInteger(credits) && credits > 0 && credits <= 10_000) {
        await grantCredits(ownerId, credits, 'stripe_purchase', `stripe_checkout:${object.id}`, { eventId: event.id });
      }
    }
    if (event.type.startsWith('customer.subscription.')) {
      const metadata = (object.metadata ?? {}) as Record<string, unknown>;
      const customerId = stringValue(object.customer);
      let ownerId = stringValue(metadata.owner_id);
      if (!ownerId && customerId) {
        const account = await db.query('SELECT owner_id FROM vibe_billing_accounts WHERE stripe_customer_id = $1', [customerId]);
        ownerId = account.rows[0]?.owner_id;
      }
      if (ownerId) {
        const items = ((object.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data ?? []);
        const priceId = items[0]?.price?.id;
        const plan = priceId === process.env.STRIPE_PRICE_CREATOR_MONTHLY
          ? 'creator' : priceId === process.env.STRIPE_PRICE_PLUS_MONTHLY ? 'plus' : 'beta';
        const periodEnd = typeof object.current_period_end === 'number'
          ? new Date(object.current_period_end * 1000).toISOString() : null;
        await db.query(
          `INSERT INTO vibe_billing_accounts (
             owner_id, plan, stripe_customer_id, stripe_subscription_id,
             subscription_status, current_period_end
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (owner_id) DO UPDATE SET
             plan = EXCLUDED.plan,
             stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, vibe_billing_accounts.stripe_customer_id),
             stripe_subscription_id = EXCLUDED.stripe_subscription_id,
             subscription_status = EXCLUDED.subscription_status,
             current_period_end = EXCLUDED.current_period_end,
             updated_at = NOW()`,
          [ownerId, event.type.endsWith('.deleted') ? 'beta' : plan, customerId ?? null, object.id, stringValue(object.status) ?? null, periodEnd],
        );
      }
    }
    if (event.type === 'invoice.paid') {
      const customerId = stringValue(object.customer);
      if (customerId) {
        const account = await db.query(
          'SELECT owner_id, plan FROM vibe_billing_accounts WHERE stripe_customer_id = $1',
          [customerId],
        );
        const ownerId = account.rows[0]?.owner_id as string | undefined;
        const line = ((object.lines as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [])[0];
        const legacyPrice = (line?.price as { id?: string } | undefined)?.id;
        const modernPrice = ((line?.pricing as { price_details?: { price?: string } } | undefined)?.price_details?.price);
        const priceId = legacyPrice || modernPrice;
        const plan = priceId === process.env.STRIPE_PRICE_CREATOR_MONTHLY
          ? 'creator' : priceId === process.env.STRIPE_PRICE_PLUS_MONTHLY
            ? 'plus' : account.rows[0]?.plan as string | undefined;
        const included = plan === 'creator' ? 400 : plan === 'plus' ? 100 : 0;
        if (ownerId && included) {
          await grantCredits(ownerId, included, 'subscription_renewal', `stripe_invoice:${object.id}`, { plan, eventId: event.id });
        }
      }
    }
  } catch (error) {
    // Let Stripe retry failures; successful reprocessing remains idempotent.
    await db.query("DELETE FROM vibe_webhook_events WHERE provider = 'stripe' AND event_id = $1", [event.id]);
    throw error;
  }
}

export function stripePlugin(): Plugin {
  return {
    name: 'vibe-stripe',
    configureServer(server) {
      server.middlewares.use('/api/stripe', async (req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        try {
          if (req.method === 'POST' && (path === '/webhook' || path === 'webhook')) {
            const payload = await readBody(req);
            const signature = req.headers['stripe-signature'];
            const secret = process.env.STRIPE_WEBHOOK_SECRET;
            if (!secret || typeof signature !== 'string' || !verifyWebhook(payload, signature, secret)) {
              return json(res, 400, { message: 'Invalid webhook signature.' });
            }
            await processStripeEvent(JSON.parse(payload.toString('utf8')) as StripeEvent);
            return json(res, 200, { received: true });
          }

          const viewer = await viewerFor(req, res);
          if (!viewer) return json(res, 401, { message: 'A session is required.' });
          if (viewer.isAnonymous) return json(res, 403, { message: 'Sign in before starting billing.' });

          if (req.method === 'POST' && (path === '/checkout' || path === 'checkout')) {
            const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')) as { kind?: string };
            const selected = checkoutPrice(body.kind ?? '');
            if (!selected) return json(res, 400, { message: 'That checkout option is unavailable.' });
            const customer = await stripeCustomer(viewer.id, viewer.email, viewer.name);
            const origin = appOrigin();
            const requestId = req.headers['x-idempotency-key'];
            const session = await stripeRequest('/checkout/sessions', {
              customer,
              mode: selected.mode,
              'line_items[0][price]': selected.price,
              'line_items[0][quantity]': '1',
              success_url: `${origin}/explore?view=projects&billing=success`,
              cancel_url: `${origin}/explore?view=projects&billing=cancelled`,
              allow_promotion_codes: 'true',
              'automatic_tax[enabled]': 'true',
              'metadata[owner_id]': viewer.id,
              'metadata[kind]': body.kind ?? '',
              ...(selected.credits ? { 'metadata[credits]': String(selected.credits) } : {}),
              ...(selected.mode === 'subscription' ? {
                'subscription_data[metadata][owner_id]': viewer.id,
                'subscription_data[metadata][kind]': body.kind ?? '',
              } : {}),
            }, typeof requestId === 'string' && requestId.length <= 200 ? requestId : randomUUID());
            return json(res, 200, { url: session.url });
          }

          if (req.method === 'POST' && (path === '/portal' || path === 'portal')) {
            const customer = await stripeCustomer(viewer.id, viewer.email, viewer.name);
            const session = await stripeRequest('/billing_portal/sessions', {
              customer,
              return_url: `${appOrigin()}/explore?view=projects`,
            }, randomUUID());
            return json(res, 200, { url: session.url });
          }
          return json(res, 404, { message: 'Stripe operation not found.' });
        } catch (error) {
          server.config.logger.error(`[vibe] Stripe operation failed: ${String(error)}`);
          return json(res, String(error).includes('too large') ? 413 : 500, { message: 'Payment service is temporarily unavailable.' });
        }
      });
    },
  };
}
