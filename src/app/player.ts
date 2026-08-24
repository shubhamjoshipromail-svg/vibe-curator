import type { AppState } from './state';
import { audioSpecForPreset, syncAudioLayers, syncGeneratedMusic } from './state';
import { navigate } from './router';
import { savePreset } from '../preset/library';
import { runtimeHost } from '../runtime/host';

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

  host.dataset.artStyle = preset.scene.style.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  host.innerHTML = `
    <button class="player-menu-trigger" id="player-menu" aria-label="Open player controls" aria-expanded="false">•••</button>
    <button class="player-drawer-backdrop" id="player-backdrop" aria-label="Close player controls"></button>
    <div class="player-control-drawer" id="player-drawer" aria-hidden="true">
      <div class="player-actions">
        <button class="ghost" id="sound">${state.started ? 'Sound on' : 'Start sound'}</button>
        ${runtimeHost.kind === 'tauri'
          ? '<button class="ghost" id="desktop">Set as desktop</button>'
          : '<button class="ghost" id="desktop-preview">Preview wallpaper</button><button class="display-mac-button" id="desktop">Send to Mac desktop</button>'}
        <button class="ghost" id="edit">Customize</button>
        <button class="ghost" id="browse">← Back</button>
      </div>
      <div class="mixer" id="mixer">
        <h2>Sound layers</h2>
        <div id="mix-rows"></div>
      </div>
    </div>
  `;

  const menu = host.querySelector<HTMLButtonElement>('#player-menu')!;
  const drawer = host.querySelector<HTMLDivElement>('#player-drawer')!;
  const backdrop = host.querySelector<HTMLButtonElement>('#player-backdrop')!;
  const setDrawer = (open: boolean) => {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    menu.setAttribute('aria-expanded', String(open));
    backdrop.classList.toggle('open', open);
  };
  menu.addEventListener('click', (event) => {
    event.stopPropagation();
    setDrawer(!drawer.classList.contains('open'));
  });
  drawer.addEventListener('click', (event) => event.stopPropagation());
  backdrop.addEventListener('click', () => setDrawer(false));
  const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawer(false); };
  host.addEventListener('keydown', closeOnEscape);

  host.querySelector('#edit')?.addEventListener('click', () =>
    navigate({ name: 'labs', presetId: preset.id }),
  );
  host.querySelector<HTMLButtonElement>('#desktop')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      if (runtimeHost.kind === 'tauri') await runtimeHost.activatePreset(preset.id);
      else await runtimeHost.openNativeApp(preset);
      button.textContent = runtimeHost.kind === 'tauri' ? 'Desktop updated' : 'Opening desktop app…';
    } catch (error) {
      console.error('[vibe] could not activate wallpaper', error);
      button.textContent = 'Could not update desktop';
    } finally {
      button.disabled = false;
    }
  });
  host.querySelector<HTMLButtonElement>('#desktop-preview')?.addEventListener('click', async () => {
    await runtimeHost.activatePreset(preset.id);
  });
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
      state.audio.setAmbientEvents(preset.livingStill?.audio.events ?? []);
      await state.audio.start(audioSpecForPreset(preset));
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
