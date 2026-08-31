import {
  createMediaPreset,
  createProjectFolder,
  deletePreset,
  deleteProjectFolder,
  listPresets,
  listProjectFolders,
  listSaved,
  movePresetToFolder,
  savePreset,
  type ProjectFolder,
} from '../preset/library';
import { renderThumbnail } from '../preset/thumbnail';
import { cachedGeneration, generationFingerprint, rememberGeneration, storeAsset } from '../media/assets';
import { generateSceneImage, mediaCapabilities } from '../media/api';
import { navigate } from './router';
import type { Preset } from '../preset/types';
import { buildStylePrompt, MARKET_COLLECTIONS, MARKET_POSTS, marketPresets, renderMarketPost, type MarketCollectionId } from './marketplace';

const STYLES = [
  { value: 'cinematic, realistic lighting and detailed subject', label: 'Cinematic image', help: 'A detailed, film-like source image. Best general starting point.' },
  { value: 'neon motion graphic, luminous edges and dark background', label: 'Neon glow', help: 'Bright luminous edges on a dark background.' },
  { value: 'editorial halftone print, tactile ink dots and bold color', label: 'Printed dots', help: 'A graphic print look made from visible ink-like dots.' },
  { value: 'ASCII character mosaic, high contrast digital typography', label: 'Text mosaic', help: 'The image is rebuilt with characters and digital texture.' },
  { value: 'follow the complete visual style already specified in the subject prompt; do not introduce a second style', label: 'Prompt defines style', help: 'Uses the full style recipe already present in your prompt.' },
];

const PROMPT_DEFINED_STYLE = STYLES.at(-1)!.value;

type LibraryView = 'projects' | 'market';
type ProjectType = 'generated' | 'uploads' | 'living' | 'music' | 'remixes';

const PROJECT_TYPES: Array<{ id: ProjectType; name: string; description: string }> = [
  { id: 'generated', name: 'Generated visuals', description: 'AI-created images and motion drafts.' },
  { id: 'uploads', name: 'Images & video', description: 'Original media you added yourself.' },
  { id: 'living', name: 'Living scenes', description: 'Procedural and renderer-based worlds.' },
  { id: 'music', name: 'Music attached', description: 'Projects with a saved generated track.' },
  { id: 'remixes', name: 'Remixes', description: 'Work derived from a starting point or Market card.' },
];

/** Creation stays fixed while the Library switches in place between owned work and discovery. */
export function renderExplore(
  host: HTMLElement,
  initialView: LibraryView = 'market',
  initialSelection: { folder?: string; type?: string; collection?: string } = {},
): void {
  host.innerHTML = `
    <header class="page-head explore-head">
      <div><p class="eyebrow">VISUAL → ATMOSPHERE → SOUND</p><h1>Build a world worth staying in.</h1><p class="sub">Create a visual or start from your own image. Shape its mood with sound, effects and optional motion.</p></div>
    </header>
    <section class="create-studio" aria-labelledby="create-title">
      <div class="create-copy"><span>01</span><div><h2 id="create-title">Create a visual</h2><p>One inexpensive draft first. Motion and sound are separate decisions.</p></div></div>
      <textarea id="visual-prompt" rows="3" placeholder="Two bioluminescent blue fish swimming through black water…"></textarea>
      <div class="create-toolbar">
        <label class="style-picker"><span>Starting look</span><select id="visual-style" aria-label="Starting look">${STYLES.map((style) => `<option value="${style.value}">${style.label}</option>`).join('')}</select></label>
        <label class="button-like ghost" for="quick-upload">Use your image</label>
        <input id="quick-upload" class="file-input" type="file" accept="image/*" />
        <button class="primary" id="visual-go">Generate draft</button>
      </div>
      <p class="style-help" id="style-help"></p>
      <p class="generation-note" id="visual-status">Checking generation…</p>
    </section>
    <section class="library-section">
      <div class="library-switch" role="tablist" aria-label="Library view">
        <button role="tab" id="projects-tab">Projects</button><button role="tab" id="market-tab">Market</button>
      </div>
      <div class="section-head library-heading"><div><p class="eyebrow" id="library-eyebrow"></p><h2 id="library-title"></h2><p class="section-copy" id="library-copy"></p></div><div class="library-tools" id="library-tools"></div></div>
      <div class="library-breadcrumb" id="library-breadcrumb"></div>
      <div class="tag-row" id="tags"></div>
      <div class="grid folder-grid" id="folder-grid"></div>
      <div class="grid" id="owned-grid"></div>
    </section>
    <details class="starter-section">
      <summary><div><p class="eyebrow">STARTING POINTS</p><h2>Explore treatments</h2></div><span>Open collection</span></summary>
      <div class="grid compact-grid" id="starter-grid"></div>
    </details>`;

  wireCreation(host);
  const title = host.querySelector<HTMLElement>('#library-title')!;
  const eyebrow = host.querySelector<HTMLElement>('#library-eyebrow')!;
  const copy = host.querySelector<HTMLElement>('#library-copy')!;
  const tools = host.querySelector<HTMLDivElement>('#library-tools')!;
  const breadcrumbs = host.querySelector<HTMLDivElement>('#library-breadcrumb')!;
  const tags = host.querySelector<HTMLDivElement>('#tags')!;
  const folderGrid = host.querySelector<HTMLDivElement>('#folder-grid')!;
  const ownedGrid = host.querySelector<HTMLDivElement>('#owned-grid')!;
  const projectsTab = host.querySelector<HTMLButtonElement>('#projects-tab')!;
  const marketTab = host.querySelector<HTMLButtonElement>('#market-tab')!;
  let view: LibraryView = initialView;
  let projectFolder = initialSelection.folder;
  let projectType = PROJECT_TYPES.some((item) => item.id === initialSelection.type) ? initialSelection.type as ProjectType : undefined;
  let marketFolder = MARKET_COLLECTIONS.some((item) => item.id === initialSelection.collection) ? initialSelection.collection as MarketCollectionId : undefined;
  let activeTag = 'all';
  let query = '';

  const reset = (next: LibraryView) => navigate({ name: 'explore', view: next });
  projectsTab.addEventListener('click', () => reset('projects'));
  marketTab.addEventListener('click', () => reset('market'));

  function draw(): void {
    projectsTab.className = view === 'projects' ? 'active' : '';
    marketTab.className = view === 'market' ? 'active' : '';
    projectsTab.setAttribute('aria-selected', String(view === 'projects'));
    marketTab.setAttribute('aria-selected', String(view === 'market'));
    folderGrid.innerHTML = ''; ownedGrid.innerHTML = ''; tags.innerHTML = ''; tools.innerHTML = ''; breadcrumbs.innerHTML = '';
    if (view === 'market') drawMarket(); else drawProjects();
  }

  function drawProjects(): void {
    const folders = listProjectFolders();
    const saved = listSaved().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    eyebrow.textContent = 'YOUR LIBRARY';
    const activeType = PROJECT_TYPES.find((item) => item.id === projectType);
    title.textContent = projectFolder ? folders.find((item) => item.id === projectFolder)?.name ?? 'Projects' : activeType?.name ?? 'Projects';
    copy.textContent = projectFolder
      ? 'This project folder contains only work you explicitly placed here.'
      : activeType?.description ?? 'Browse work by type, or make a project folder for work you intentionally want together.';
    const search = document.createElement('input'); search.className = 'search'; search.type = 'search'; search.placeholder = 'Search projects…'; search.value = query;
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); drawProjectsContent(folders, saved); });
    tools.appendChild(search);
    if (!projectFolder && !projectType) {
      const create = document.createElement('button'); create.className = 'ghost'; create.textContent = '+ New folder';
      create.addEventListener('click', () => {
        const name = prompt('Folder name');
        if (name?.trim()) { const folder = createProjectFolder(name); navigate({ name: 'explore', folder: folder.id }); }
      });
      tools.prepend(create);
    } else {
      const back = document.createElement('button'); back.className = 'crumb-button'; back.textContent = '← All folders';
      back.addEventListener('click', () => {
        navigate({ name: 'explore', view: 'projects' });
      }); breadcrumbs.appendChild(back);
      if (projectFolder) {
        const remove = document.createElement('button'); remove.className = 'ghost danger-quiet'; remove.textContent = 'Delete folder';
        remove.addEventListener('click', () => {
          if (confirm('Delete this folder? Its projects will move to Unfiled.')) { deleteProjectFolder(projectFolder!); projectFolder = undefined; draw(); }
        }); tools.prepend(remove);
      }
    }
    drawProjectsContent(folders, saved);
  }

  function drawProjectsContent(folders: ProjectFolder[], saved: Preset[]): void {
    folderGrid.innerHTML = ''; ownedGrid.innerHTML = ''; tags.innerHTML = '';
    if (!projectFolder && !projectType) {
      const visibleFolders = folders.filter((folder) => !query || folder.name.toLowerCase().includes(query) || saved.some((preset) => preset.folderId === folder.id && projectHaystack(preset).includes(query)));
      for (const folder of visibleFolders) {
        const contents = saved.filter((preset) => preset.folderId === folder.id);
        folderGrid.appendChild(projectFolderCard(folder.name, contents, () => navigate({ name: 'explore', folder: folder.id })));
      }
      for (const type of PROJECT_TYPES) {
        const contents = saved.filter((preset) => !preset.folderId && projectMatchesType(preset, type.id));
        if (!contents.length || (query && !type.name.toLowerCase().includes(query) && !contents.some((preset) => projectHaystack(preset).includes(query)))) continue;
        folderGrid.appendChild(typeFolderCard(type.name, type.description, contents, () => navigate({ name: 'explore', type: type.id })));
      }
      if (!folderGrid.children.length) folderGrid.innerHTML = '<div class="empty project-empty"><strong>No matching projects.</strong><span>Create something new or clear the search.</span></div>';
      return;
    }
    const folderContents = projectFolder
      ? saved.filter((preset) => preset.folderId === projectFolder)
      : saved.filter((preset) => !preset.folderId && projectType && projectMatchesType(preset, projectType));
    const availableTags = [...new Set(folderContents.flatMap((preset) => preset.tags))].slice(0, 8);
    if (activeTag !== 'all' && !availableTags.includes(activeTag)) activeTag = 'all';
    for (const tag of ['all', ...availableTags]) {
      const button = document.createElement('button'); button.className = `filter-chip${activeTag === tag ? ' active' : ''}`; button.textContent = tag === 'all' ? 'All' : tag.replace(/-/g, ' ');
      button.addEventListener('click', () => { activeTag = tag; drawProjectsContent(folders, saved); }); tags.appendChild(button);
    }
    const filtered = folderContents.filter((preset) => (activeTag === 'all' || preset.tags.includes(activeTag)) && (!query || projectHaystack(preset).includes(query)));
    if (!filtered.length) ownedGrid.innerHTML = '<div class="empty project-empty"><strong>This folder is empty.</strong><span>Move a project here from another folder, or create something new.</span></div>';
    for (const preset of filtered) ownedGrid.appendChild(projectCard(preset, folders, draw));
  }

  function drawMarket(): void {
    eyebrow.textContent = 'DISCOVER & REMIX';
    title.textContent = marketFolder ? MARKET_COLLECTIONS.find((item) => item.id === marketFolder)?.name ?? 'Market' : 'Market collections';
    copy.textContent = marketFolder ? 'Every item opens still. Add only the motion you want in Labs, then save it to Projects.' : 'Curated visual styles that start completely still. Motion is always your choice in Labs.';
    if (!marketFolder) {
      for (const collection of MARKET_COLLECTIONS) {
        const posts = MARKET_POSTS.filter((post) => post.collection === collection.id);
        folderGrid.appendChild(marketCollectionCard(collection.name, collection.description, collection.mood, posts.map((post) => post.presetId), () => navigate({ name: 'explore', view: 'market', collection: collection.id })));
      }
      return;
    }
    const back = document.createElement('button'); back.className = 'crumb-button'; back.textContent = '← All collections';
    back.addEventListener('click', () => {
      navigate({ name: 'explore', view: 'market' });
    }); breadcrumbs.appendChild(back);
    const presets = marketPresets();
    const collection = MARKET_COLLECTIONS.find((item) => item.id === marketFolder);
    if (collection?.stylePrompt) ownedGrid.appendChild(styleRecipe(collection, host));
    for (const post of MARKET_POSTS.filter((item) => item.collection === marketFolder)) {
      const preset = presets.get(post.presetId); if (preset) ownedGrid.appendChild(renderMarketPost(preset, post));
    }
  }

  const starterGrid = host.querySelector<HTMLDivElement>('#starter-grid')!;
  const folders = listProjectFolders();
  for (const preset of listPresets().filter((item) => item.builtIn && !item.marketplaceOnly)) starterGrid.appendChild(projectCard(preset, folders, draw));
  draw();
}

function styleRecipe(collection: (typeof MARKET_COLLECTIONS)[number], host: HTMLElement): HTMLElement {
  const section = document.createElement('section'); section.className = 'style-recipe';
  section.innerHTML = `<div class="style-recipe-head"><div><span>REUSABLE STYLE</span><h3>Make your own ${collection.name}</h3><p>Change the content. The visual construction stays fixed.</p></div><button class="ghost" data-copy>Copy full prompt</button></div><div class="style-recipe-fields"><label>Subject<input data-field="subject" value="an original scene" /></label><label>Setting<input data-field="setting" placeholder="forest, city, interior…" /></label><label>Time<select data-field="time"><option>artist choice</option><option>sunrise</option><option>day</option><option>golden hour</option><option>night</option></select></label><label>Weather<input data-field="weather" placeholder="clear, rain, fog…" /></label><label>Mood<input data-field="mood" value="${collection.mood}" /></label></div><textarea data-output readonly></textarea><button class="primary" data-use>Use in Create</button>`;
  const values = () => Object.fromEntries([...section.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')].map((el) => [el.dataset.field!, el.value])) as { subject: string; setting: string; time: string; weather: string; mood: string };
  const output = section.querySelector<HTMLTextAreaElement>('[data-output]')!;
  const refresh = () => { output.value = buildStylePrompt(collection, values()); };
  section.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', refresh)); refresh();
  section.querySelector('[data-copy]')?.addEventListener('click', () => { void navigator.clipboard.writeText(output.value); });
  section.querySelector('[data-use]')?.addEventListener('click', () => {
    const prompt = host.querySelector<HTMLTextAreaElement>('#visual-prompt'); if (!prompt) return;
    prompt.value = output.value;
    const style = host.querySelector<HTMLSelectElement>('#visual-style');
    if (style) { style.value = PROMPT_DEFINED_STYLE; style.dispatchEvent(new Event('change')); }
    prompt.focus(); prompt.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  return section;
}

function wireCreation(host: HTMLElement): void {
  const status = host.querySelector<HTMLParagraphElement>('#visual-status')!;
  const promptInput = host.querySelector<HTMLTextAreaElement>('#visual-prompt')!;
  const style = host.querySelector<HTMLSelectElement>('#visual-style')!;
  const go = host.querySelector<HTMLButtonElement>('#visual-go')!;
  const upload = host.querySelector<HTMLInputElement>('#quick-upload')!;
  const styleHelp = host.querySelector<HTMLParagraphElement>('#style-help')!;
  const explainStyle = () => {
    styleHelp.textContent = STYLES.find((option) => option.value === style.value)?.help ?? '';
  };
  style.addEventListener('change', explainStyle);
  explainStyle();
  let generationEnabled = false; let imageModel = 'gpt-image-2';
  void mediaCapabilities().then((caps) => {
    generationEnabled = caps.sceneGeneration; imageModel = caps.imageModel ?? imageModel; go.disabled = !generationEnabled;
    status.textContent = generationEnabled ? `~$${(caps.estimatedCostsUsd?.image ?? 0.01).toFixed(2)} per new draft · repeats reuse the local cache · session cap $${(caps.spendCapUsd ?? 3).toFixed(2)}` : 'Add OPENAI_API_KEY to generate drafts. Uploads and starting points still work.';
  }).catch(() => { go.disabled = true; status.textContent = 'Generation is offline. Uploads and starting points still work.'; });
  const openProject = (preset: Preset) => { savePreset(preset); navigate({ name: 'labs', presetId: preset.id }); };
  go.addEventListener('click', async () => {
    const request = promptInput.value.trim(); if (!request) { status.textContent = 'Describe what you want to see first.'; promptInput.focus(); return; }
    if (!generationEnabled) return; go.disabled = true; status.textContent = 'Creating one visual draft…';
    try {
      const fingerprint = await generationFingerprint('scene-image', imageModel, request, style.value);
      const cached = await cachedGeneration(fingerprint); let assetId = cached?.id; let mimeType = cached?.blob.type || 'image/png'; let provider = 'openai'; let model = imageModel;
      if (!assetId) { const generated = await generateSceneImage(request, style.value); assetId = await storeAsset(generated.blob, 'scene'); mimeType = generated.mimeType; provider = generated.provider; model = generated.model; rememberGeneration(fingerprint, assetId); }
      status.textContent = cached ? 'Reused the cached draft. Opening the editor…' : 'Draft saved. Opening the editor…';
      openProject(createMediaPreset({ prompt: request, style: style.value, assetId, mimeType, provider, model }));
    } catch (error) { console.error('[vibe] visual generation failed', error); status.textContent = error instanceof Error ? error.message : 'The visual could not be generated.'; }
    finally { go.disabled = !generationEnabled; }
  });
  upload.addEventListener('change', async () => {
    const file = upload.files?.[0]; if (!file) return; status.textContent = 'Adding your image…';
    try { const assetId = await storeAsset(file, 'scene'); const request = promptInput.value.trim() || file.name.replace(/\.[^.]+$/, ''); openProject(createMediaPreset({ prompt: request, style: style.value, assetId, mimeType: file.type, provider: 'upload', model: 'original' })); }
    catch (error) { status.textContent = error instanceof Error ? error.message : 'That image could not be added.'; }
    finally { upload.value = ''; }
  });
}

function projectHaystack(preset: Preset): string { return `${preset.name} ${preset.description} ${preset.tags.join(' ')}`.toLowerCase(); }

function projectMatchesType(preset: Preset, type: ProjectType): boolean {
  return projectTypeFor(preset) === type;
}

/** Automatic shelves are mutually exclusive so the root never duplicates a project. */
function projectTypeFor(preset: Preset): ProjectType {
  if (preset.parentId) return 'remixes';
  if (preset.music) return 'music';
  if (preset.scene.kind === 'renderer' || preset.scene.kind === 'procedural') return 'living';
  if (preset.scene.provenance?.provider === 'upload') return 'uploads';
  return 'generated';
}

function thumbnailStack(presets: Preset[]): HTMLElement {
  const stack = document.createElement('div'); stack.className = 'folder-thumbnails';
  for (const preset of presets.slice(0, 3)) { const thumb = renderThumbnail(preset, 300, 170); thumb.className = 'folder-thumb'; stack.appendChild(thumb); }
  if (!presets.length) stack.innerHTML = '<div class="folder-empty-art"><span>＋</span></div>';
  return stack;
}

function projectFolderCard(name: string, presets: Preset[], open: () => void): HTMLElement {
  const card = document.createElement('button'); card.className = 'folder-card'; card.appendChild(thumbnailStack(presets));
  const copy = document.createElement('span'); copy.className = 'folder-card-copy';
  const title = document.createElement('strong'); title.textContent = name;
  const count = document.createElement('small'); count.textContent = `${presets.length} project${presets.length === 1 ? '' : 's'} · one level`;
  copy.append(title, count); card.appendChild(copy); card.addEventListener('click', open); return card;
}

function typeFolderCard(name: string, description: string, presets: Preset[], open: () => void): HTMLElement {
  const card = projectFolderCard(name, presets, open);
  card.classList.add('type-folder');
  const count = card.querySelector('small');
  if (count) count.textContent = `${description} · ${presets.length}`;
  return card;
}

function marketCollectionCard(name: string, description: string, mood: string, presetIds: string[], open: () => void): HTMLElement {
  const presets = marketPresets(); const card = document.createElement('button'); card.className = 'folder-card market-collection-card';
  const hero = presets.get(presetIds[0]); if (hero) { const thumb = renderThumbnail(hero, 560, 315); thumb.className = 'collection-hero'; card.appendChild(thumb); }
  const copy = document.createElement('span'); copy.className = 'folder-card-copy'; copy.innerHTML = `<span class="collection-kicker">${mood}</span><strong>${name}</strong><small>${description}</small><em>${presetIds.length} variations →</em>`; card.appendChild(copy); card.addEventListener('click', open); return card;
}

function projectCard(preset: Preset, folders: ProjectFolder[], refresh: () => void): HTMLElement {
  const el = document.createElement('article'); el.className = 'card'; el.tabIndex = 0;
  const thumb = renderThumbnail(preset, 480, 270); thumb.className = 'card-thumb'; el.appendChild(thumb);
  const body = document.createElement('div'); body.className = 'card-body';
  const title = document.createElement('h2'); title.textContent = preset.name; const description = document.createElement('p'); description.textContent = preset.description; body.append(title, description);
  const meta = document.createElement('div'); meta.className = 'card-meta';
  for (const label of [preset.scene.style, preset.scene.kind, preset.music || preset.baselineMusic ? 'music' : '', preset.parentId ? 'remix' : ''].filter(Boolean)) { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = label; meta.appendChild(chip); }
  body.appendChild(meta); el.appendChild(body);
  const actions = document.createElement('div'); actions.className = 'card-actions'; const open = document.createElement('button'); open.className = 'primary'; open.textContent = preset.builtIn ? 'Use starting point' : 'Continue'; open.addEventListener('click', (event) => { event.stopPropagation(); navigate({ name: 'labs', presetId: preset.id }); }); actions.appendChild(open);
  if (!preset.builtIn) {
    const select = document.createElement('select'); select.className = 'folder-select'; select.setAttribute('aria-label', `Folder for ${preset.name}`);
    select.add(new Option('Unfiled', ''));
    for (const folder of folders) select.add(new Option(folder.name, folder.id));
    select.value = preset.folderId ?? '';
    select.addEventListener('click', (event) => event.stopPropagation()); select.addEventListener('change', (event) => { event.stopPropagation(); movePresetToFolder(preset.id, select.value || undefined); refresh(); }); actions.appendChild(select);
    const del = document.createElement('button'); del.className = 'ghost'; del.textContent = 'Delete'; del.addEventListener('click', (event) => { event.stopPropagation(); if (confirm(`Delete “${preset.name}”? This cannot be undone.`)) { deletePreset(preset.id); refresh(); } }); actions.appendChild(del);
  }
  el.appendChild(actions); const enter = () => navigate({ name: 'labs', presetId: preset.id }); el.addEventListener('click', enter); el.addEventListener('keydown', (event) => { if (event.key === 'Enter') enter(); }); return el;
}
