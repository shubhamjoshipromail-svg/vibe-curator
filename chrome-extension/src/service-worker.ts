import {
  DEFAULT_STATE, PROTOCOL_VERSION, STORAGE_KEY, commitAfterAudio, errorResponse, isTrustedExternalSender, nextState, requestId,
  validateExternalRequest, validateInternalRequest, validateState,
  type ExtensionState, type InternalRequest, type ProtocolResponse,
} from './core';

const OFFSCREEN_PATH = 'offscreen.html';
const SEARCH_SCRIPT_ID = 'vibe-curator-google-search';
const GOOGLE_SEARCH_ORIGIN = 'https://www.google.com/*';
let creatingOffscreen: Promise<void> | undefined;
let audioSessionToken: string | undefined;
let updateQueue: Promise<unknown> = Promise.resolve();

async function readState(): Promise<ExtensionState> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  if (stored === undefined) return structuredClone(DEFAULT_STATE);
  try { return validateState(stored); } catch { return structuredClone(DEFAULT_STATE); }
}

function tokenFromContext(context: chrome.runtime.ExtensionContext): string | undefined {
  if (!context.documentUrl) return undefined;
  try {
    const url = new URL(context.documentUrl);
    if (url.origin !== new URL(chrome.runtime.getURL('/')).origin || url.pathname !== new URL(chrome.runtime.getURL(OFFSCREEN_PATH)).pathname) return undefined;
    return url.searchParams.get('session') || undefined;
  } catch { return undefined; }
}

async function existingOffscreenToken(): Promise<string | undefined> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  const token = contexts.map(tokenFromContext).find(Boolean);
  if (token) audioSessionToken = token;
  else if (contexts.length) await chrome.offscreen.closeDocument();
  return token;
}

async function ensureOffscreen(): Promise<string> {
  const existing = await existingOffscreenToken();
  if (existing) return existing;
  audioSessionToken = requestId('session');
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: `${OFFSCREEN_PATH}?session=${encodeURIComponent(audioSessionToken)}`, reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Keep user-enabled ambient audio playing after the New Tab page closes.',
  }).finally(() => { creatingOffscreen = undefined; });
  await creatingOffscreen;
  return audioSessionToken;
}

async function syncAudio(state: ExtensionState): Promise<void> {
  if (!state.playback.soundUnlocked) return;
  let sessionToken: string | undefined;
  if (!state.playback.desiredPlaying) {
    sessionToken = await existingOffscreenToken();
    if (!sessionToken) return;
  } else sessionToken = await ensureOffscreen();

  const id = requestId('audio');
  const response = await chrome.runtime.sendMessage({
    v: PROTOCOL_VERSION, target: 'offscreen', type: 'audio:apply', requestId: id, sessionToken, state,
  });
  const acknowledgement = response as { v?: number; requestId?: string; ok?: boolean; error?: { message?: string } } | undefined;
  if (!acknowledgement || acknowledgement.v !== PROTOCOL_VERSION || acknowledgement.requestId !== id || acknowledgement.ok !== true) {
    throw new Error(acknowledgement?.error?.message || 'Audio rejected the update.');
  }
}

async function commit(next: ExtensionState): Promise<ExtensionState> {
  return commitAfterAudio(next, syncAudio, async (state) => chrome.storage.local.set({ [STORAGE_KEY]: state }));
}

async function syncSearchScript(state: ExtensionState): Promise<void> {
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SEARCH_SCRIPT_ID] })).length > 0;
  const shouldRegister = state.features.googleSearchBackground
    && await chrome.permissions.contains({ origins: [GOOGLE_SEARCH_ORIGIN] });
  if (shouldRegister && !registered) {
    await chrome.scripting.registerContentScripts([{
      id: SEARCH_SCRIPT_ID,
      matches: ['https://www.google.com/search*'],
      js: ['search_overlay.js'],
      runAt: 'document_start',
      persistAcrossSessions: true,
    }]);
  } else if (!shouldRegister && registered) await chrome.scripting.unregisterContentScripts({ ids: [SEARCH_SCRIPT_ID] });
}

async function commitFeatures(next: ExtensionState): Promise<ExtensionState> {
  await syncAudio(next);
  await syncSearchScript(next);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = updateQueue.then(operation, operation);
  updateQueue = result.catch(() => undefined);
  return result;
}

function isUiSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  return [chrome.runtime.getURL('newtab.html'), chrome.runtime.getURL('popup.html')].includes(sender.url);
}

async function applyInternal(request: InternalRequest): Promise<ExtensionState> {
  const current = await readState();
  if (request.type === 'get-state') return current;
  if (request.type === 'enable-sound') {
    if (!current.features.enabled) throw new Error('Turn Vibe on before enabling sound.');
    return commit(nextState(current, { soundUnlocked: true, desiredPlaying: true }));
  }
  if (request.type === 'set-playing') {
    if (request.playing && !current.features.enabled) throw new Error('Turn Vibe on before starting playback.');
    if (request.playing && !current.playback.soundUnlocked) throw new Error('Enable sound once before starting playback.');
    return commit(nextState(current, { desiredPlaying: request.playing }));
  }
  if (request.type === 'set-volume') return commit(nextState(current, { masterVolume: request.volume }));
  if (request.type === 'set-enabled') {
    return commitFeatures(nextState(current, {
      desiredPlaying: request.enabled ? current.playback.desiredPlaying : false,
      features: { enabled: request.enabled },
    }));
  }
  if (request.enabled && !await chrome.permissions.contains({ origins: [GOOGLE_SEARCH_ORIGIN] })) {
    throw new Error('Google Search access was not granted.');
  }
  return commitFeatures(nextState(current, { features: { googleSearchBackground: request.enabled } }));
}

function respond(sendResponse: (response: ProtocolResponse) => void, operation: () => Promise<ProtocolResponse>): true {
  void operation().then(sendResponse).catch((error) => sendResponse(errorResponse(undefined, 'internal_error', error)));
  return true;
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!raw || typeof raw !== 'object' || (raw as { target?: unknown }).target !== 'service-worker') return false;
  const candidateId = (raw as { requestId?: unknown }).requestId;
  return respond(sendResponse, async () => {
    try {
      if (!isUiSender(sender)) throw new Error('This request did not come from an extension control.');
      const request = validateInternalRequest(raw);
      const state = await serialize(() => applyInternal(request));
      return { v: 1, requestId: request.requestId, ok: true, state };
    } catch (error) { return errorResponse(candidateId, 'invalid_internal_request', error); }
  });
});

chrome.runtime.onMessageExternal.addListener((raw: unknown, sender, sendResponse) => {
  const candidateId = raw && typeof raw === 'object' ? (raw as { requestId?: unknown }).requestId : undefined;
  return respond(sendResponse, async () => {
    try {
      if (!isTrustedExternalSender(sender.origin, sender.url)) throw new Error('Only the Vibe Curator production site may set a Chrome Vibe.');
      const request = validateExternalRequest(raw);
      const state = await serialize(async () => commit(nextState(await readState(), { preset: request.preset })));
      return { v: 1, requestId: request.requestId, ok: true, state };
    } catch (error) { return errorResponse(candidateId, 'rejected_external_request', error); }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void serialize(async () => {
    const state = await readState();
    await syncSearchScript(state);
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  });
});

chrome.runtime.onStartup.addListener(() => { void serialize(async () => syncSearchScript(await readState())); });
