import type { AppState } from './state';
import { syncAudioLayers, syncGeneratedMusic } from './state';
import { navigate } from './router';
import { savePreset } from '../preset/library';
import { VIBES } from '../vibes';

/**
 * Player — where the environment is actually experienced.
 *
 * Everything here fades out of the way. The only persistent controls are the
 * layer mixer, because "turn the music down but keep the room" is something
 * people genuinely want mid-session, and hunting for it in a settings screen
 * would be worse than a small always-available panel.
 */
export function renderPlayer(host: HTMLElement, state: AppState): void {
  const preset = state.loaded;
  if (!preset) {
    host.innerHTML = `<div class="empty-stage"><p>Nothing loaded yet.</p><button class="primary" id="go">Browse rooms</button></div>`;
    host.querySelector('#go')?.addEventListener('click', () => navigate({ name: 'explore' }));
    return;
  }

  host.innerHTML = `
    <div class="player-chrome">
      <div class="player-title">
        <h1>${preset.name}</h1>
        <p>${preset.description}</p>
      </div>
      <div class="player-actions">
        <button class="ghost" id="sound">${state.started ? 'Sound on' : 'Start sound'}</button>
        <button class="ghost" id="edit">Customize</button>
        <button class="ghost" id="browse">← Back</button>
      </div>
    </div>
    <div class="mixer" id="mixer">
      <h2>Layers</h2>
      <div id="mix-rows"></div>
    </div>
  `;

  host.querySelector('#edit')?.addEventListener('click', () =>
    navigate({ name: 'labs', presetId: preset.id }),
  );
  host.querySelector('#browse')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else navigate({ name: 'explore' });
  });
  host.querySelector<HTMLButtonElement>('#sound')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (state.started) {
      state.audio.stop();
      state.started = false;
      button.textContent = 'Start sound';
      return;
    }
    button.disabled = true;
    try {
      const base = VIBES.find((vibe) => vibe.id === preset.baseVibeId) ?? VIBES[0];
      await state.audio.start(base.audio);
      state.started = true;
      syncAudioLayers(state, preset);
      await syncGeneratedMusic(state, preset);
      button.textContent = 'Sound on';
    } catch (error) {
      console.error('[vibe] audio failed to start', error);
      button.textContent = 'Sound unavailable';
    } finally {
      button.disabled = false;
    }
  });

  const rows = host.querySelector<HTMLDivElement>('#mix-rows')!;
  const layers = [
    { key: 'master' as const, label: 'Everything' },
    { key: 'ambience' as const, label: 'Ambience' },
    { key: 'music' as const, label: 'Music' },
  ];

  for (const layer of layers) {
    const s = preset.audio[layer.key];
    const row = document.createElement('div');
    row.className = 'mix-row';
    row.innerHTML = `
      <button class="mute ${s.muted ? 'is-muted' : ''}" title="Mute">${s.muted ? '✕' : '●'}</button>
      <label>${layer.label}</label>
      <input type="range" min="0" max="1" step="0.01" value="${s.gain}" />
    `;

    const mute = row.querySelector<HTMLButtonElement>('.mute')!;
    const slider = row.querySelector<HTMLInputElement>('input')!;

    const commit = () => {
      syncAudioLayers(state, preset);
      // The mixer is part of the preset, so a level change is a real edit.
      if (!preset.builtIn) savePreset(preset);
    };

    slider.addEventListener('input', () => {
      preset.audio[layer.key].gain = Number(slider.value);
      commit();
    });
    mute.addEventListener('click', () => {
      const next = !preset.audio[layer.key].muted;
      preset.audio[layer.key].muted = next;
      mute.classList.toggle('is-muted', next);
      mute.textContent = next ? '✕' : '●';
      commit();
    });

    rows.appendChild(row);
  }
}
