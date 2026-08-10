import { listPresets, deletePreset } from '../preset/library';
import { renderThumbnail } from '../preset/thumbnail';
import { navigate } from './router';
import type { Preset } from '../preset/types';

/**
 * Explore — the front door.
 *
 * Rooms are presented as content, not configuration: a picture, a name, a line
 * about what it feels like. There is deliberately no prompt box here. A blank
 * text field as the first thing a user sees invites a weak first attempt, and a
 * weak first impression is permanent — so the prompt lives in Labs, after
 * you've already got something good on screen to change.
 */
export function renderExplore(host: HTMLElement): void {
  host.innerHTML = `
    <header class="page-head">
      <div>
        <h1>Explore</h1>
        <p class="sub">Pick a place to work. Every one can be remixed.</p>
      </div>
      <input id="search" class="search" type="search" placeholder="Search rooms…" />
    </header>
    <div class="grid" id="grid"></div>
  `;

  const grid = host.querySelector<HTMLDivElement>('#grid')!;
  const search = host.querySelector<HTMLInputElement>('#search')!;

  function draw(filter: string) {
    const q = filter.trim().toLowerCase();
    const presets = listPresets().filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.effects.some((e) => e.name.toLowerCase().includes(q)),
    );

    grid.innerHTML = '';
    if (!presets.length) {
      grid.innerHTML = `<p class="empty">Nothing matches “${filter}”.</p>`;
      return;
    }
    for (const preset of presets) grid.appendChild(card(preset, () => draw(search.value)));
  }

  search.addEventListener('input', () => draw(search.value));
  draw('');
}

function card(preset: Preset, refresh: () => void): HTMLElement {
  const el = document.createElement('article');
  el.className = 'card';
  el.tabIndex = 0;

  const thumb = renderThumbnail(preset, 480, 270);
  thumb.className = 'card-thumb';
  el.appendChild(thumb);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = `
    <h2>${preset.name}</h2>
    <p>${preset.description}</p>
    <div class="card-meta">
      ${preset.effects.length ? `<span class="chip">${preset.effects.length} effect${preset.effects.length > 1 ? 's' : ''}</span>` : ''}
      ${preset.builtIn ? '' : '<span class="chip chip-own">yours</span>'}
      ${preset.parentId ? '<span class="chip chip-quiet">remix</span>' : ''}
    </div>
  `;
  el.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const open = document.createElement('button');
  open.className = 'primary';
  open.textContent = 'Open in Labs';
  open.addEventListener('click', (e) => {
    e.stopPropagation();
    navigate({ name: 'labs', presetId: preset.id });
  });
  actions.appendChild(open);

  if (!preset.builtIn) {
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Delete';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete “${preset.name}”? This cannot be undone.`)) {
        deletePreset(preset.id);
        refresh();
      }
    });
    actions.appendChild(del);
  }

  el.appendChild(actions);

  const enter = () => navigate({ name: 'labs', presetId: preset.id });
  el.addEventListener('click', enter);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') enter();
  });

  return el;
}
