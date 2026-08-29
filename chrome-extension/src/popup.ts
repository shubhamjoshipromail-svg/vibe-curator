import { getState, onStoredState, sendRequest } from './client';
import type { ExtensionState } from './core';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enable = element<HTMLButtonElement>('enable-sound');
const play = element<HTMLButtonElement>('toggle-play');
const volume = element<HTMLInputElement>('volume');
const output = element<HTMLOutputElement>('volume-output');
const status = element<HTMLElement>('status');
const vibeEnabled = element<HTMLInputElement>('vibe-enabled');
const googleSearch = element<HTMLInputElement>('google-search');
let state: ExtensionState | undefined;
let volumeTimer: number | undefined;

function render(next: ExtensionState): void {
  state = next;
  vibeEnabled.checked = next.features.enabled;
  googleSearch.checked = next.features.googleSearchBackground;
  element('scene-name').textContent = next.preset.name;
  element('scene-style').textContent = next.preset.scene.style;
  enable.hidden = next.playback.soundUnlocked;
  play.hidden = !next.playback.soundUnlocked;
  play.textContent = next.playback.desiredPlaying ? 'Pause' : 'Play';
  volume.value = String(next.playback.masterVolume);
  output.value = `${Math.round(next.playback.masterVolume * 100)}%`;
  document.body.style.setProperty('--popup-accent', next.preset.palette.accent);
  document.body.style.setProperty('--popup-base', next.preset.palette.base);
  document.body.classList.toggle('vibe-off', !next.features.enabled);
}

function setBusy(busy: boolean): void {
  const vibeIsOff = state ? !state.features.enabled : false;
  enable.disabled = busy || vibeIsOff;
  play.disabled = busy || vibeIsOff;
  volume.disabled = busy || vibeIsOff;
  vibeEnabled.disabled = busy;
  googleSearch.disabled = busy;
}

async function run(operation: () => Promise<ExtensionState>): Promise<void> {
  setBusy(true);
  status.textContent = '';
  try { render(await operation()); }
  catch (error) {
    if (state) render(state);
    status.textContent = error instanceof Error ? error.message : 'The control failed.';
  }
  finally { setBusy(false); }
}

enable.addEventListener('click', () => void run(() => sendRequest({ type: 'enable-sound' })));
play.addEventListener('click', () => {
  if (state) void run(() => sendRequest({ type: 'set-playing', playing: !state!.playback.desiredPlaying }));
});
volume.addEventListener('input', () => {
  output.value = `${Math.round(Number(volume.value) * 100)}%`;
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => void run(() => sendRequest({ type: 'set-volume', volume: Number(volume.value) })), 80);
});
volume.addEventListener('change', () => {
  window.clearTimeout(volumeTimer);
  void run(() => sendRequest({ type: 'set-volume', volume: Number(volume.value) }));
});
vibeEnabled.addEventListener('change', () => void run(() => sendRequest({ type: 'set-enabled', enabled: vibeEnabled.checked })));
googleSearch.addEventListener('change', () => {
  void run(async () => {
    if (googleSearch.checked) {
      const granted = await chrome.permissions.request({ origins: ['https://www.google.com/*'] });
      if (!granted) throw new Error('Google Search access was not granted.');
    }
    return sendRequest({ type: 'set-google-search', enabled: googleSearch.checked });
  });
});
onStoredState(render);
void getState().then(render).catch((error) => { status.textContent = error instanceof Error ? error.message : 'Vibe Curator could not start.'; });
