import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { database, deleteProductData, ensureProductSchema, transferOwnership } from './database';
import { deleteOwnerStorage, transferOwnerStorage } from './storage';

const db = database();

function configuredOrigin(): string | undefined {
  const configured = process.env.BETTER_AUTH_URL || process.env.APP_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    if (process.env.NODE_ENV === 'production' && !local && url.protocol !== 'https:') {
      throw new Error('Production APP_URL/BETTER_AUTH_URL must use HTTPS.');
    }
    return url.origin;
  } catch (error) {
    throw new Error(`Invalid APP_URL/BETTER_AUTH_URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const productionUrl = configuredOrigin();
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const hostedDeployment = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN);
const authSecret = process.env.BETTER_AUTH_SECRET
  || (process.env.NODE_ENV === 'production' ? undefined : 'vibe-curator-development-secret-change-me');

if (hostedDeployment && !db) throw new Error('DATABASE_URL is required for hosted deployments.');

if (db && (process.env.NODE_ENV === 'production' || hostedDeployment)) {
  if (!productionUrl) throw new Error('APP_URL or BETTER_AUTH_URL is required when DATABASE_URL is configured in production.');
  if (!authSecret || authSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters in production.');
}

export const auth = db ? betterAuth({
  database: db,
  secret: authSecret,
  baseURL: productionUrl,
  basePath: '/api/auth',
  advanced: {
    ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
  },
  trustedOrigins: [
    'http://localhost:5178',
    'http://127.0.0.1:5178',
    ...(productionUrl ? [productionUrl] : []),
  ],
  socialProviders: googleConfigured ? {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  } : undefined,
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await deleteProductData(user.id);
        await deleteOwnerStorage(user.id);
      },
    },
  },
  plugins: [anonymous({
    emailDomainName: 'guest.vibecurator.local',
    onLinkAccount: async ({ anonymousUser, newUser }) => {
      await transferOwnership(anonymousUser.user.id, newUser.user.id);
      await transferOwnerStorage(anonymousUser.user.id, newUser.user.id);
    },
  })],
}) : undefined;

export interface Viewer {
  id: string;
  name: string;
  email?: string;
  image?: string | null;
  isAnonymous: boolean;
  mode: 'account' | 'development';
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  const item = (req.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : undefined;
}

/** Local development remains usable without Postgres. Production always gets Better Auth. */
export async function viewerFor(req: IncomingMessage, res?: ServerResponse): Promise<Viewer | undefined> {
  if (auth) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return undefined;
    const user = session.user as typeof session.user & { isAnonymous?: boolean };
    return { id: user.id, name: user.name, email: user.isAnonymous ? undefined : user.email, image: user.image, isAnonymous: Boolean(user.isAnonymous), mode: 'account' };
  }
  let id = cookie(req, 'vibe_dev_guest');
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    id = randomUUID();
    res?.setHeader('set-cookie', `vibe_dev_guest=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  }
  return { id: `dev_${id}`, name: 'Local guest', isAnonymous: true, mode: 'development' };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

export function authPlugin(): Plugin {
  const handler = auth ? toNodeHandler(auth) : undefined;
  return {
    name: 'vibe-auth',
    configureServer(server) {
      if (db) void ensureProductSchema().catch((error) => server.config.logger.error(`[vibe] database setup failed: ${String(error)}`));
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (!path.startsWith('/api/auth/')) {
          next();
          return;
        }
        if (path === '/api/auth/vibe-status') {
          const viewer = await viewerFor(req, res);
          json(res, 200, { viewer, googleConfigured, persistent: Boolean(db) });
          return;
        }
        if (!handler) {
          json(res, 503, { message: 'Account sign-in needs DATABASE_URL. Local guest mode is active.' });
          return;
        }
        await handler(req, res);
      });
    },
  };
}
