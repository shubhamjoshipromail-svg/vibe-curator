export type DeepLinkActivation = { token: string } | { controls: true };

export function validActivationToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/** Parse the deliberately small public custom-protocol contract. */
export function activationFromDeepLink(value: string): DeepLinkActivation | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'vibecurator:'
      || url.username !== ''
      || url.password !== ''
      || url.port !== ''
      || url.pathname !== ''
      || url.hash !== ''
    ) return undefined;

    if (url.hostname === 'controls') {
      return url.search === '' ? { controls: true } : undefined;
    }
    if (url.hostname !== 'open') return undefined;
    const pairs = [...url.searchParams.entries()];
    if (pairs.length !== 1 || pairs[0][0] !== 'activation') return undefined;
    return validActivationToken(pairs[0][1]) ? { token: pairs[0][1] } : undefined;
  } catch {
    return undefined;
  }
}

export interface NativeActivationBridge {
  listen(handler: (token: unknown) => void | Promise<void>): Promise<() => void>;
  claim(token: string): Promise<boolean>;
  takePending(): Promise<unknown[]>;
}

async function tauriActivationBridge(): Promise<NativeActivationBridge | undefined> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return undefined;
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  return {
    listen: (handler) => listen<{ token?: unknown }>('vibe://activate-transfer', (event) => handler(event.payload?.token)),
    claim: (token) => invoke<boolean>('claim_native_activation', { token }),
    takePending: () => invoke<unknown[]>('take_pending_native_activations'),
  };
}

/**
 * Subscribe before draining Rust's cold-start inbox. A warm event atomically
 * claims its queued token, and a drained token is already claimed. The local
 * set is a final idempotency guard if those asynchronous paths cross.
 */
export async function connectNativeActivationInbox(
  activate: (token: string) => void | Promise<void>,
  suppliedBridge?: NativeActivationBridge,
): Promise<() => void> {
  const bridge = suppliedBridge ?? await tauriActivationBridge();
  if (!bridge) return () => {};
  const delivered = new Set<string>();

  const deliver = async (token: unknown): Promise<void> => {
    if (!validActivationToken(token) || delivered.has(token)) return;
    delivered.add(token);
    await activate(token);
  };
  const handleEvent = async (token: unknown): Promise<void> => {
    if (!validActivationToken(token) || delivered.has(token)) return;
    if (await bridge.claim(token)) await deliver(token);
  };

  const unlisten = await bridge.listen(handleEvent);
  for (const token of await bridge.takePending()) await deliver(token);
  return unlisten;
}
