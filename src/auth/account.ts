import { authStatus, continueWithGoogle, signOut, type AuthStatus } from './client';

export async function mountAccountControl(host: HTMLElement): Promise<void> {
  const root = document.createElement('div');
  root.className = 'account-control';
  root.innerHTML = `<button class="account-trigger" aria-haspopup="dialog" aria-expanded="false">Guest</button>`;
  host.appendChild(root);
  const trigger = root.querySelector<HTMLButtonElement>('.account-trigger')!;
  let status: AuthStatus;
  try {
    status = await authStatus();
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
    panel.innerHTML = `<p class="account-kicker">${viewer?.isAnonymous ? 'GUEST SESSION' : 'SIGNED IN'}</p><strong>${viewer?.isAnonymous ? 'Your work is private on this account' : viewer?.name || 'Vibe Curator'}</strong><p>${viewer?.isAnonymous ? (status.persistent ? 'Sign in to keep it across devices.' : 'Local development storage is active.') : viewer?.email || 'Synced across devices'}</p>`;
    const action = document.createElement('button');
    action.className = viewer?.isAnonymous ? 'primary wide' : 'ghost wide';
    action.textContent = viewer?.isAnonymous ? (status.googleConfigured ? 'Continue with Google' : 'Google setup pending') : 'Sign out';
    action.disabled = Boolean(viewer?.isAnonymous && !status.googleConfigured);
    action.addEventListener('click', () => void (viewer?.isAnonymous ? continueWithGoogle() : signOut()));
    panel.appendChild(action);
    root.appendChild(panel);
  });
}
