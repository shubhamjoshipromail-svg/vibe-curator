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

export interface BillingStatus {
  credits: {
    balance: number;
    reserved: number;
    available: number;
    plan: string;
    persistent: boolean;
  };
  costs: Record<'image' | 'music' | 'motion' | 'shader' | 'direction', number>;
  betaWelcomeCredits: number;
  checkoutConfigured: boolean;
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

export async function billingStatus(): Promise<BillingStatus> {
  const response = await fetch('/api/billing/status', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Credit status is unavailable.');
  return response.json() as Promise<BillingStatus>;
}

export async function startCheckout(kind: 'plus' | 'creator' | 'credits_100'): Promise<void> {
  const response = await fetch('/api/stripe/checkout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ kind }),
  });
  const body = await response.json() as { url?: string; message?: string };
  if (!response.ok || !body.url) throw new Error(body.message || 'Checkout could not start.');
  location.assign(body.url);
}

export async function openBillingPortal(): Promise<void> {
  const response = await fetch('/api/stripe/portal', { method: 'POST', credentials: 'same-origin' });
  const body = await response.json() as { url?: string; message?: string };
  if (!response.ok || !body.url) throw new Error(body.message || 'Billing portal could not open.');
  location.assign(body.url);
}
