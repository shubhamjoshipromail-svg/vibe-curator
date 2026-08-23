import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function canonicalOrigin(): string | undefined {
  const value = process.env.APP_URL || process.env.BETTER_AUTH_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  return value ? new URL(value).origin : undefined;
}

function requestIp(req: IncomingMessage): string {
  if (process.env.NODE_ENV === 'production') {
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp) return realIp;
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function ratePolicy(path: string): { limit: number; windowMs: number; group: string } {
  if (path === '/api/stripe/webhook') return { limit: 300, windowMs: 60_000, group: 'stripe-webhook' };
  if (path.startsWith('/api/media/') || path === '/api/gen/shader' || path === '/api/living-director') {
    return { limit: 20, windowMs: 10 * 60_000, group: 'generation' };
  }
  if (path.startsWith('/api/auth/')) return { limit: 60, windowMs: 60_000, group: 'auth' };
  if (path.startsWith('/api/stripe/')) return { limit: 30, windowMs: 60_000, group: 'billing' };
  return { limit: 180, windowMs: 60_000, group: 'api' };
}

function rateLimited(req: IncomingMessage, path: string, res: ServerResponse): boolean {
  const policy = ratePolicy(path);
  const now = Date.now();
  const key = `${requestIp(req)}:${policy.group}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + policy.windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  res.setHeader('x-ratelimit-limit', String(policy.limit));
  res.setHeader('x-ratelimit-remaining', String(Math.max(0, policy.limit - bucket.count)));
  res.setHeader('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  }
  if (bucket.count <= policy.limit) return false;
  res.statusCode = 429;
  res.setHeader('content-type', 'application/json');
  res.setHeader('retry-after', String(Math.ceil((bucket.resetAt - now) / 1000)));
  res.end(JSON.stringify({ message: 'Too many requests. Please wait and try again.' }));
  return true;
}

function setSecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  const development = process.env.NODE_ENV !== 'production';
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(self), usb=(), serial=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('content-security-policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://accounts.google.com https://checkout.stripe.com",
    development ? "script-src 'self' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "media-src 'self' data: blob:",
    development ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; '));
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (process.env.NODE_ENV === 'production' && forwardedProto === 'https') {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
}

function originAllowed(req: IncomingMessage, path: string): boolean {
  if (!path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')) return true;
  if (path === '/api/stripe/webhook') return true;
  const origin = req.headers.origin;
  if (!origin) return true; // Native shell, same-origin non-browser clients, and server webhooks.
  const allowed = new Set([
    canonicalOrigin(),
    ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5178', 'http://127.0.0.1:5178']),
  ].filter((value): value is string => Boolean(value)));
  return allowed.has(origin);
}

/** Security boundary shared by development and Railway preview servers. */
export function securityPlugin(): Plugin {
  return {
    name: 'vibe-security',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        setSecurityHeaders(req, res);
        res.setHeader('x-request-id', randomUUID());
        const path = (req.url ?? '/').split('?')[0];
        if (!originAllowed(req, path)) {
          res.statusCode = 403;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ message: 'Request origin is not allowed.' }));
          return;
        }
        if (path.startsWith('/api/') && rateLimited(req, path, res)) return;
        next();
      });
    },
  };
}
