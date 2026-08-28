import { getState, onStoredState, sendRequest } from './client';
import type { ExtensionState } from './core';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enable = element<HTMLButtonElement>('enable-sound');
const play = element<HTMLButtonElement>('toggle-play');
const volume = element<HTMLInputElement>('volume');
const output = element<HTMLOutputElement>('volume-output');
const status = element<HTMLElement>('status');
let state: ExtensionState | undefined;
let volumeTimer: number | undefined;

function render(next: ExtensionState): void {
  state = next;
  element('scene-name').textContent = next.preset.name;
  element('scene-style').textContent = next.preset.scene.style;
  enable.hidden = next.playback.soundUnlocked;
  play.hidden = !next.playback.soundUnlocked;
  play.textContent = next.playback.desiredPlaying ? 'Pause' : 'Play';
  volume.value = String(next.playback.masterVolume);
  output.value = `${Math.round(next.playback.masterVolume * 100)}%`;
  document.body.style.setProperty('--popup-accent', next.preset.palette.accent);
  document.body.style.setProperty('--popup-base', next.preset.palette.base);
}

async function run(operation: () => Promise<ExtensionState>): Promise<void> {
  enable.disabled = true;
  play.disabled = true;
  status.textContent = '';
  try { render(await operation()); }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'The control failed.'; }
  finally { enable.disabled = false; play.disabled = false; }
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
onStoredState(render);
void getState().then(render).catch((error) => { status.textContent = error instanceof Error ? error.message : 'Vibe Curator could not start.'; });
