import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { database, ensureProductSchema, transferOwnership } from './database';

const db = database();
const productionUrl = process.env.BETTER_AUTH_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = db ? betterAuth({
  database: db,
  secret: process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'vibe-curator-development-secret-change-me'),
  baseURL: productionUrl,
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
  plugins: [anonymous({
    emailDomainName: 'guest.vibecurator.local',
    onLinkAccount: async ({ anonymousUser, newUser }) => {
      await transferOwnership(anonymousUser.user.id, newUser.user.id);
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
