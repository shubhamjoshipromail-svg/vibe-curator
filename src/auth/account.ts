import {
  authStatus,
  billingStatus,
  continueWithGoogle,
  openBillingPortal,
  signOut,
  startCheckout,
  type AuthStatus,
  type BillingStatus,
} from './client';

export async function mountAccountControl(host: HTMLElement): Promise<void> {
  const root = document.createElement('div');
  root.className = 'account-control';
  root.innerHTML = `<button class="account-trigger" aria-haspopup="dialog" aria-expanded="false">Guest</button>`;
  host.appendChild(root);
  const trigger = root.querySelector<HTMLButtonElement>('.account-trigger')!;
  let status: AuthStatus;
  let billing: BillingStatus | undefined;
  try {
    [status, billing] = await Promise.all([authStatus(), billingStatus().catch(() => undefined)]);
  } catch {
    trigger.textContent = 'Offline';
    trigger.disabled = true;
    return;
  }
  trigger.textContent = status.viewer?.isAnonymous ? 'Guest' : (status.viewer?.name.split(' ')[0] || 'Account');
  trigger.addEventListener('click', () => {
    const open = root.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(open));
    root.querySelector('.account-popover')?.remove();
    if (!open) return;
    const panel = document.createElement('div');
    panel.className = 'account-popover';
    const viewer = status.viewer;
    const kicker = document.createElement('p');
    kicker.className = 'account-kicker';
    kicker.textContent = viewer?.isAnonymous ? 'GUEST SESSION' : 'SIGNED IN';
    const name = document.createElement('strong');
    name.textContent = viewer?.isAnonymous ? 'Your work is private on this account' : viewer?.name || 'Vibe Curator';
    const detail = document.createElement('p');
    detail.textContent = viewer?.isAnonymous
      ? (status.persistent ? 'Sign in to keep it across devices.' : 'Local development storage is active.')
      : viewer?.email || 'Synced across devices';
    panel.append(kicker, name, detail);
    if (billing) {
      const creditLine = document.createElement('p');
      creditLine.className = 'account-credits';
      creditLine.textContent = `${billing.credits.available} Vibe Credits available · ${billing.credits.plan}`;
      panel.appendChild(creditLine);
    }
    const action = document.createElement('button');
    action.className = viewer?.isAnonymous ? 'primary wide' : 'ghost wide';
    action.textContent = viewer?.isAnonymous ? (status.googleConfigured ? 'Continue with Google' : 'Google setup pending') : 'Sign out';
    action.disabled = Boolean(viewer?.isAnonymous && !status.googleConfigured);
    action.addEventListener('click', () => void (viewer?.isAnonymous ? continueWithGoogle() : signOut()));
    panel.appendChild(action);
    if (!viewer?.isAnonymous && billing?.checkoutConfigured) {
      const upgrade = document.createElement('button');
      upgrade.className = 'primary wide';
      upgrade.textContent = billing.credits.plan === 'beta' ? 'Choose Plus' : 'Buy 100 credits';
      upgrade.addEventListener('click', () => void startCheckout(billing?.credits.plan === 'beta' ? 'plus' : 'credits_100'));
      const manage = document.createElement('button');
      manage.className = 'ghost wide';
      manage.textContent = 'Manage billing';
      manage.addEventListener('click', () => void openBillingPortal());
      panel.insertBefore(upgrade, action);
      panel.insertBefore(manage, action);
    }
    const privacy = document.createElement('a');
    privacy.className = 'account-link';
    privacy.href = '/data';
    privacy.textContent = 'Privacy & your data';
    panel.appendChild(privacy);
    root.appendChild(panel);
  });
}
