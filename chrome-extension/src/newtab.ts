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
  stage.classList.toggle('vibe-disabled', !next.features.enabled);
  stage.style.setProperty('--base', preset.palette.base);
  stage.style.setProperty('--surface', preset.palette.surface);
  stage.style.setProperty('--primary', preset.palette.primary);
  stage.style.setProperty('--accent', preset.palette.accent);
  stage.style.setProperty('--text', preset.palette.text);
  stage.style.setProperty('--motion', String(Math.max(0.01, preset.controls.motion)));
  stage.style.setProperty('--glow', String(preset.controls.glow));
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
  element('sound-title').textContent = !next.features.enabled ? 'Vibe is off' : playback.soundUnlocked
    ? (playback.desiredPlaying ? 'Ambient sound is playing' : 'Ambient sound is paused')
    : 'Sound is off';
  element('sound-detail').textContent = !next.features.enabled
    ? 'Turn it back on from the toolbar extension button.'
    : playback.soundUnlocked
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
