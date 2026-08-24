import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';
import { accountOrigin } from '../runtime/config';

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

// Better Auth intentionally accepts only HTTP(S) base URLs. The local Tauri
// wallpaper uses a custom scheme, so initialize against the public account
// origin even though its offline boot path does not require a session.
export const authClient = createAuthClient({
  baseURL: accountOrigin(),
  plugins: [anonymousClient()],
});

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

export async function acknowledgeBetaTerms(): Promise<void> {
  const response = await fetch('/api/privacy/acknowledge', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not record the beta terms acknowledgment.');
}

export async function betaTermsStatus(): Promise<{ acknowledged: boolean; policyVersion: string; persistent: boolean }> {
  const response = await fetch('/api/privacy/status', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Could not check the beta terms status.');
  return response.json() as Promise<{ acknowledged: boolean; policyVersion: string; persistent: boolean }>;
}

export async function exportMyData(): Promise<void> {
  const response = await fetch('/api/privacy/export', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Your data export could not be prepared.');
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `vibe-curator-data-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function deleteMyAccount(persistent: boolean): Promise<void> {
  if (persistent) {
    const result = await authClient.deleteUser();
    if (result.error) throw new Error(result.error.message || 'Your account could not be deleted.');
  } else {
    const response = await fetch('/api/privacy/delete-product-data', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Your local beta data could not be deleted.');
  }
  localStorage.clear();
  location.assign('/');
}
