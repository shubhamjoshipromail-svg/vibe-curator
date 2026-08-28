import { getState, onStoredState, sendRequest } from './client';
import type { ExtensionState } from './core';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = element<HTMLElement>('stage');
const image = element<HTMLImageElement>('scene-image');
const enable = element<HTMLButtonElement>('enable-sound');
const play = element<HTMLButtonElement>('toggle-play');
const status = element<HTMLElement>('status');
let state: ExtensionState | undefined;

function render(next: ExtensionState): void {
  state = next;
  const { preset, playback } = next;
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
  enable.hidden = playback.soundUnlocked;
  play.hidden = !playback.soundUnlocked;
  play.textContent = playback.desiredPlaying ? 'Ⅱ' : '▶';
  play.setAttribute('aria-label', playback.desiredPlaying ? 'Pause ambient sound' : 'Play ambient sound');
  element('sound-title').textContent = playback.soundUnlocked
    ? (playback.desiredPlaying ? 'Ambient sound is playing' : 'Ambient sound is paused')
    : 'Sound is off';
  element('sound-detail').textContent = playback.soundUnlocked
    ? 'It keeps playing when this tab closes. Use the toolbar for volume.'
    : 'One click enables ambient audio on this device.';
}

async function run(operation: () => Promise<ExtensionState>): Promise<void> {
  enable.disabled = true;
  play.disabled = true;
  status.textContent = '';
  try { render(await operation()); }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'The sound control failed.'; }
  finally { enable.disabled = false; play.disabled = false; }
}

enable.addEventListener('click', () => void run(() => sendRequest({ type: 'enable-sound' })));
play.addEventListener('click', () => {
  if (state) void run(() => sendRequest({ type: 'set-playing', playing: !state!.playback.desiredPlaying }));
});
onStoredState(render);
void getState().then(render).catch((error) => { status.textContent = error instanceof Error ? error.message : 'Vibe Curator could not start.'; });
