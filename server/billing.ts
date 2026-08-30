import type { Plugin } from 'vite';
import { viewerFor } from './auth';
import { BETA_WELCOME_CREDITS, CREDIT_COSTS, creditStatus } from './credits';
import { billingEnabled } from './beta';

function json(
  res: { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void },
  status: number,
  value: unknown,
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

export function billingPlugin(): Plugin {
  return {
    name: 'vibe-billing',
    configureServer(server) {
      server.middlewares.use('/api/billing', async (req, res) => {
        try {
          const path = (req.url ?? '/').split('?')[0];
          const viewer = await viewerFor(req, res);
          if (!viewer) return json(res, 401, { message: 'A session is required.' });
          if (req.method === 'GET' && (path === '/status' || path === 'status')) {
            // Email drives the admin allowlist check, so an unlimited account
            // is reported as unlimited rather than as a balance.
            const credits = await creditStatus(viewer.id, viewer.email);
            const checkoutConfigured = billingEnabled() && Boolean(
              process.env.STRIPE_SECRET_KEY
              && process.env.STRIPE_WEBHOOK_SECRET
              && process.env.STRIPE_PRICE_PLUS_MONTHLY
              && process.env.STRIPE_PRICE_CREDITS_100,
            );
            return json(res, 200, {
              credits,
              costs: CREDIT_COSTS,
              betaWelcomeCredits: BETA_WELCOME_CREDITS,
              checkoutConfigured,
            });
          }
          return json(res, 404, { message: 'Billing operation not found.' });
        } catch (error) {
          server.config.logger.error(`[vibe] billing operation failed: ${String(error)}`);
          return json(res, 500, { message: 'Billing status is temporarily unavailable.' });
        }
      });
    },
  };
}
