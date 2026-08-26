import { PROTOCOL_VERSION, requestId, validateState, type ExtensionState, type InternalRequest, type ProtocolResponse } from './core';

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'v' | 'target' | 'requestId'> : never;
type ClientRequest = WithoutEnvelope<InternalRequest>;

export async function sendRequest(request: ClientRequest): Promise<ExtensionState> {
  const envelope = { ...request, v: PROTOCOL_VERSION, target: 'service-worker', requestId: requestId('ui') } as InternalRequest;
  const response = await chrome.runtime.sendMessage(envelope) as ProtocolResponse | undefined;
  if (!response || response.v !== PROTOCOL_VERSION || response.requestId !== envelope.requestId) throw new Error('The extension returned an invalid response.');
  if (!response.ok) throw new Error(response.error.message);
  return validateState(response.state);
}

export async function getState(): Promise<ExtensionState> { return sendRequest({ type: 'get-state' }); }

export function onStoredState(listener: (state: ExtensionState) => void): () => void {
  const handle = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    for (const change of Object.values(changes)) {
      try { listener(validateState(change.newValue)); } catch { /* Ignore unrelated or malformed storage entries. */ }
    }
  };
  chrome.storage.onChanged.addListener(handle);
  return () => chrome.storage.onChanged.removeListener(handle);
}
