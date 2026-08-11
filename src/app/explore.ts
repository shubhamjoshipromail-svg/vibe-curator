import { createMediaPreset, deletePreset, listPresets, listSaved, savePreset } from '../preset/library';
import { renderThumbnail } from '../preset/thumbnail';
import { cachedGeneration, generationFingerprint, rememberGeneration, storeAsset } from '../media/assets';
import { generateSceneImage, mediaCapabilities } from '../media/api';
import { navigate } from './router';
import type { Preset } from '../preset/types';

const STYLES = [
  { value: 'tracked neon', label: 'Tracked neon' },
  { value: 'halftone print', label: 'Halftone print' },
  { value: 'ascii glow', label: 'ASCII glow' },
  { value: 'cinematic', label: 'Cinematic' },
];

/** The front door: create first, then resume owned work, then browse starting points. */
export function renderExplore(host: HTMLElement): void {
  host.innerHTML = `
    <header class="page-head explore-head">
      <div><p class="eyebrow">VISUAL → MOTION → SOUND</p><h1>Make anything move.</h1><p class="sub">Describe a visual or start from your own image. The result stays editable, reactive and reusable.</p></div>
    </header>
    <section class="create-studio" aria-labelledby="create-title">
      <div class="create-copy"><span>01</span><div><h2 id="create-title">Create a visual</h2><p>One inexpensive draft first. Motion and sound are separate decisions.</p></div></div>
      <textarea id="visual-prompt" rows="3" placeholder="Two bioluminescent blue fish swimming through black water…"></textarea>
      <div class="create-toolbar">
        <select id="visual-style" aria-label="Visual treatment">${STYLES.map((style) => `<option value="${style.value}">${style.label}</option>`).join('')}</select>
        <label class="button-like ghost" for="quick-upload">Use your image</label>
        <input id="quick-upload" class="file-input" type="file" accept="image/*" />
        <button class="primary" id="visual-go">Generate draft</button>
      </div>
      <p class="generation-note" id="visual-status">Checking generation…</p>
    </section>
    <section class="library-section">
      <div class="section-head"><div><p class="eyebrow">YOUR LIBRARY</p><h2>Projects</h2></div><div class="library-tools"><button class="ghost" id="marketplace">Marketplace</button><input id="search" class="search" type="search" placeholder="Search projects…" /></div></div>
      <div class="tag-row" id="tags"></div>
      <div class="grid" id="owned-grid"></div>
    </section>
    <details class="starter-section">
      <summary><div><p class="eyebrow">STARTING POINTS</p><h2>Explore treatments</h2></div><span>Open collection</span></summary>
      <div class="grid compact-grid" id="starter-grid"></div>
    </details>
  `;

  const status = host.querySelector<HTMLParagraphElement>('#visual-status')!;
  const prompt = host.querySelector<HTMLTextAreaElement>('#visual-prompt')!;
  const style = host.querySelector<HTMLSelectElement>('#visual-style')!;
  const go = host.querySelector<HTMLButtonElement>('#visual-go')!;
  const upload = host.querySelector<HTMLInputElement>('#quick-upload')!;
  host.querySelector('#marketplace')?.addEventListener('click', () => navigate({ name: 'marketplace' }));
  let generationEnabled = false;
  let imageModel = 'gemini-2.5-flash-image';

  void mediaCapabilities().then((caps) => {
    generationEnabled = caps.sceneGeneration;
    imageModel = caps.imageModel ?? imageModel;
    go.disabled = !generationEnabled;
    status.textContent = generationEnabled
      ? `~$${(caps.estimatedCostsUsd?.image ?? 0.04).toFixed(2)} per new draft · repeats reuse the local cache · session cap $${(caps.spendCapUsd ?? 3).toFixed(2)}`
      : 'Add GEMINI_API_KEY to generate drafts. Uploads and starting points still work.';
  }).catch(() => {
    go.disabled = true;
    status.textContent = 'Generation is offline. Uploads and starting points still work.';
  });

  const openProject = (preset: Preset) => {
    savePreset(preset);
    navigate({ name: 'labs', presetId: preset.id });
  };

  go.addEventListener('click', async () => {
    const request = prompt.value.trim();
    if (!request) {
      status.textContent = 'Describe what you want to see first.';
      prompt.focus();
      return;
    }
    if (!generationEnabled) return;
    go.disabled = true;
    status.textContent = 'Creating one visual draft…';
    try {
      const fingerprint = await generationFingerprint('scene-image', imageModel, request, style.value);
      const cached = await cachedGeneration(fingerprint);
      let assetId = cached?.id;
      let mimeType = cached?.blob.type || 'image/png';
      let provider = 'google';
      let model = imageModel;
      if (!assetId) {
        const generated = await generateSceneImage(request, style.value);
        assetId = await storeAsset(generated.blob, 'scene');
        mimeType = generated.mimeType;
        provider = generated.provider;
        model = generated.model;
        rememberGeneration(fingerprint, assetId);
      }
      const preset = createMediaPreset({ prompt: request, style: style.value, assetId, mimeType, provider, model });
      status.textContent = cached ? 'Reused the cached draft. Opening the editor…' : 'Draft saved. Opening the editor…';
      openProject(preset);
    } catch (error) {
      console.error('[vibe] visual generation failed', error);
      status.textContent = error instanceof Error ? error.message : 'The visual could not be generated.';
    } finally {
      go.disabled = !generationEnabled;
    }
  });

  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    if (!file) return;
    status.textContent = 'Adding your image…';
    try {
      const assetId = await storeAsset(file, 'scene');
      const request = prompt.value.trim() || file.name.replace(/\.[^.]+$/, '');
      const preset = createMediaPreset({ prompt: request, style: style.value, assetId, mimeType: file.type, provider: 'upload', model: 'original' });
      openProject(preset);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'That image could not be added.';
    } finally {
      upload.value = '';
    }
  });

  const ownedGrid = host.querySelector<HTMLDivElement>('#owned-grid')!;
  const starterGrid = host.querySelector<HTMLDivElement>('#starter-grid')!;
  const search = host.querySelector<HTMLInputElement>('#search')!;
  const tags = host.querySelector<HTMLDivElement>('#tags')!;
  let activeTag = 'all';

  function drawLibrary() {
    const saved = listSaved().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const availableTags = [...new Set(saved.flatMap((preset) => preset.tags))].slice(0, 8);
    if (activeTag !== 'all' && !availableTags.includes(activeTag)) activeTag = 'all';
    tags.innerHTML = '';
    for (const tag of ['all', ...availableTags]) {
      const button = document.createElement('button');
      button.className = `filter-chip${activeTag === tag ? ' active' : ''}`;
      button.textContent = tag === 'all' ? 'All' : tag.replace(/-/g, ' ');
      button.addEventListener('click', () => { activeTag = tag; drawLibrary(); });
      tags.appendChild(button);
    }
    const q = search.value.trim().toLowerCase();
    const filtered = saved.filter((preset) => {
      const matchesTag = activeTag === 'all' || preset.tags.includes(activeTag);
      const haystack = `${preset.name} ${preset.description} ${preset.tags.join(' ')}`.toLowerCase();
      return matchesTag && (!q || haystack.includes(q));
    });
    ownedGrid.innerHTML = '';
    if (!filtered.length) ownedGrid.innerHTML = '<div class="empty project-empty"><strong>No projects yet.</strong><span>Generate a draft or use your own image above.</span></div>';
    for (const preset of filtered) ownedGrid.appendChild(card(preset, drawLibrary));
  }

  for (const preset of listPresets().filter((item) => item.builtIn && !item.marketplaceOnly)) starterGrid.appendChild(card(preset, drawLibrary));
  search.addEventListener('input', drawLibrary);
  drawLibrary();
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
  const title = document.createElement('h2');
  title.textContent = preset.name;
  const description = document.createElement('p');
  description.textContent = preset.description;
  body.append(title, description);
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  for (const label of [preset.scene.style, preset.scene.kind, preset.music ? 'music' : '', preset.parentId ? 'remix' : ''].filter(Boolean)) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = label;
    meta.appendChild(chip);
  }
  body.appendChild(meta);
  el.appendChild(body);
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const open = document.createElement('button');
  open.className = 'primary';
  open.textContent = preset.builtIn ? 'Use starting point' : 'Continue';
  open.addEventListener('click', (event) => { event.stopPropagation(); navigate({ name: 'labs', presetId: preset.id }); });
  actions.appendChild(open);
  if (!preset.builtIn) {
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Delete';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      if (confirm(`Delete “${preset.name}”? This cannot be undone.`)) { deletePreset(preset.id); refresh(); }
    });
    actions.appendChild(del);
  }
  el.appendChild(actions);
  const enter = () => navigate({ name: 'labs', presetId: preset.id });
  el.addEventListener('click', enter);
  el.addEventListener('keydown', (event) => { if (event.key === 'Enter') enter(); });
  return el;
}
