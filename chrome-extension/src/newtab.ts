import { getState, onStoredState, sendRequest } from './client';
import type { ExtensionState } from './core';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = element<HTMLElement>('stage');
const image = element<HTMLImageElement>('scene-image');
const enable = element<HTMLButtonElement>('enable-sound');
const play = element<HTMLButtonElement>('toggle-play');
const volume = element<HTMLInputElement>('vibe-volume');
const volumeOutput = element<HTMLOutputElement>('vibe-volume-output');
const status = element<HTMLElement>('status');
let state: ExtensionState | undefined;
let volumeTimer: number | undefined;

function render(next: ExtensionState): void {
  state = next;
  const { preset, playback } = next;
  stage.classList.toggle('vibe-disabled', !next.features.enabled);
  stage.style.setProperty('--base', preset.palette.base);
  stage.style.setProperty('--surface', preset.palette.surface);
  stage.style.setProperty('--primary', preset.palette.primary);
  stage.style.setProperty('--accent', preset.palette.accent);
  stage.style.setProperty('--text', preset.palette.text);
  stage.style.setProperty('--motion', String(Math.max(0.01, preset.controls.motion)));
  stage.style.setProperty('--glow', String(preset.controls.glow));
  stage.style.setProperty('--depth', String(preset.controls.depth));
  stage.style.setProperty('--atmosphere', String(preset.controls.atmosphere));
  stage.style.setProperty('--intensity', String(preset.controls.intensity));
  stage.style.setProperty('--mood', String(preset.controls.mood));
  stage.dataset.baseVibe = preset.baseVibeId;
  stage.dataset.source = preset.scene.kind === 'procedural' ? preset.scene.sourceId : preset.scene.kind;
  element('scene-name').textContent = preset.name;
  element('scene-description').textContent = preset.description;
  element('scene-style').textContent = preset.scene.style.toUpperCase();
  if (preset.scene.kind === 'image') {
    image.src = preset.scene.url;
    image.alt = preset.scene.label;
    image.hidden = false;
  } else {
    image.removeAttribute('src');
    image.alt = '';
    image.hidden = true;
  }
  enable.hidden = playback.soundUnlocked || !next.features.enabled;
  play.hidden = !playback.soundUnlocked || !next.features.enabled;
  play.textContent = playback.desiredPlaying ? 'Ⅱ' : '▶';
  play.setAttribute('aria-label', playback.desiredPlaying ? 'Pause ambient sound' : 'Play ambient sound');
  // The new-tab slider stays (0.1.2), so the copy keeps describing it rather
  // than pointing at the toolbar, but the off state from 0.2.0 takes priority.
  volume.value = String(preset.audio.master.gain);
  volumeOutput.value = `${Math.round(preset.audio.master.gain * 100)}%`;
  element('sound-title').textContent = !next.features.enabled ? 'Vibe is off' : playback.soundUnlocked
    ? (playback.desiredPlaying ? 'Ambient sound is playing' : 'Ambient sound is paused')
    : 'Sound is off';
  element('sound-detail').textContent = !next.features.enabled
    ? 'Turn it back on from the toolbar extension button.'
    : playback.soundUnlocked
    ? 'It keeps playing when this tab closes. This slider controls only this vibe.'
    : 'One click enables this vibe\'s audio on this device.';
}

async function run(operation: () => Promise<ExtensionState>): Promise<void> {
  enable.disabled = true;
  play.disabled = true;
  volume.disabled = true;
  status.textContent = '';
  try { render(await operation()); }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'The sound control failed.'; }
  finally { enable.disabled = false; play.disabled = false; volume.disabled = false; }
}

enable.addEventListener('click', () => void run(() => sendRequest({ type: 'enable-sound' })));
play.addEventListener('click', () => {
  if (state) void run(() => sendRequest({ type: 'set-playing', playing: !state!.playback.desiredPlaying }));
});
volume.addEventListener('input', () => {
  volumeOutput.value = `${Math.round(Number(volume.value) * 100)}%`;
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => void run(() => sendRequest({ type: 'set-vibe-volume', volume: Number(volume.value) })), 80);
});
volume.addEventListener('change', () => {
  window.clearTimeout(volumeTimer);
  void run(() => sendRequest({ type: 'set-vibe-volume', volume: Number(volume.value) }));
});
onStoredState(render);
void getState().then(render).catch((error) => { status.textContent = error instanceof Error ? error.message : 'Vibe Curator could not start.'; });
