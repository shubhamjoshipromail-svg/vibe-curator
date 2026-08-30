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
  root.innerHTML = `
    <a class="install-trigger chrome-trigger" href="https://chromewebstore.google.com/detail/vibe-curator/niamjnjkmfnlpcejieffodipboacfdnm" target="_blank" rel="noreferrer" aria-label="Add Vibe Curator to Chrome">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9"/><path d="M4.2 7.5h10.4M8.5 20l5.2-9"/><circle cx="12" cy="12" r="3.4"/></svg>
      <span>Chrome</span>
    </a>
    <a class="install-trigger" href="/desktop" aria-label="Install the Mac app">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 6.5v10M8 12.5l4 4 4-4"/></svg>
      <span>Install App</span>
    </a>
    <button class="account-trigger" aria-haspopup="dialog" aria-expanded="false">Guest</button>`;
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
  const close = (): void => {
    root.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    root.querySelector('.account-popover')?.remove();
  };
  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target as Node)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !root.classList.contains('open')) return;
    close();
    trigger.focus();
  });
  trigger.addEventListener('click', () => {
    const shouldOpen = !root.classList.contains('open');
    close();
    if (!shouldOpen) return;
    root.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
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
      creditLine.textContent = billing.credits.unlimited
        ? `Unlimited generation · ${billing.credits.plan}`
        : `${billing.credits.available} Vibe Credits available · ${billing.credits.plan}`;
      panel.appendChild(creditLine);

      // A balance alone was misleading: a user could hold 100 credits and still
      // be refused by a spend cap, with nothing on screen explaining why.
      if (billing.credits.blockedBy) {
        const note = document.createElement('p');
        note.className = 'account-credit-note';
        note.textContent = billing.credits.blockedBy === 'user_daily_cap'
          ? `Daily generation limit reached ($${billing.credits.todaySpendUsd.toFixed(2)} of $${billing.credits.dailyCapUsd.toFixed(2)}). It resets at 00:00 UTC and your credits are unchanged.`
          : 'Generation is paused for today across the beta. Your credits are unaffected.';
        panel.appendChild(note);
      }
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
    const desktop = document.createElement('a');
    desktop.className = 'account-link';
    desktop.href = '/desktop';
    desktop.textContent = 'Download the Mac app';
    const chrome = document.createElement('a');
    chrome.className = 'account-link';
    chrome.href = 'https://chromewebstore.google.com/detail/vibe-curator/niamjnjkmfnlpcejieffodipboacfdnm';
    chrome.target = '_blank';
    chrome.rel = 'noreferrer';
    chrome.textContent = 'Add the Chrome extension';
    panel.append(chrome, desktop, privacy);
    root.appendChild(panel);
  });
}
