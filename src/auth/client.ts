import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';

export interface AuthStatus {
  viewer?: {
    id: string;
    name: string;
    email?: string;
    image?: string | null;
    isAnonymous: boolean;
    mode: 'account' | 'development';
  };
  googleConfigured: boolean;
  persistent: boolean;
}

export const authClient = createAuthClient({ plugins: [anonymousClient()] });

export async function authStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/vibe-status', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Account status is unavailable.');
  return response.json() as Promise<AuthStatus>;
}

/** Every cloud request has an owner, even when the person skips sign-in. */
export async function ensureViewer(): Promise<AuthStatus> {
  let status = await authStatus();
  if (!status.viewer && status.persistent) {
    const result = await authClient.signIn.anonymous();
    if (result.error) throw new Error(result.error.message || 'Could not start a guest session.');
    status = await authStatus();
  }
  return status;
}

export async function continueWithGoogle(): Promise<void> {
  await authClient.signIn.social({ provider: 'google', callbackURL: window.location.href });
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
  location.reload();
}
