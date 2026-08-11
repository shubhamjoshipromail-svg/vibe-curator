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
  { value: 'psychedelic print', label: 'Psychedelic print' },
  { value: 'organic macro', label: 'Organic macro' },
  { value: 'electro-organic', label: 'Electro nature' },
  { value: 'dark fantasy', label: 'Dark fantasy' },
];

const CREATION_TYPES = [
  {
    id: 'artist',
    label: 'Artist DNA',
    mark: 'A',
    description: 'Start with an artist, movement or era; translate the reference into editable visual and musical characteristics.',
    placeholder: 'A visual world with the creative DNA of an artist or movement—describe the subject, palette and energy…',
    style: 'psychedelic print',
    note: 'Artist names may guide the visual draft. Before music generation, the lightweight adapter removes every artist and song name and sends only descriptive musical traits to ElevenLabs.',
    starters: [] as string[],
  },
  {
    id: 'vibes',
    label: 'Vibes',
    mark: 'V',
    description: 'Lead with a feeling, place or time of day and let the image, motion and sound follow the same direction.',
    placeholder: 'A warm late-night rooftop after rain, reflective, slow and cinematic…',
    style: 'cinematic',
    note: 'Best for open-ended mood direction. Generate a source first, then tune motion, effects and sound independently in Labs.',
    starters: ['signal-drift', 'nocturne'],
  },
  {
    id: 'nature',
    label: 'Nature',
    mark: 'N',
    description: 'Plants, animals, weather and landscapes with organic motion and restrained source-aware treatments.',
    placeholder: 'A luminous wildflower opening at blue hour, dew on every petal, deep forest behind it…',
    style: 'organic macro',
    note: 'Use a generated source or your own photograph. Your upload remains the original image; motion and contour analysis happen locally.',
    starters: ['paper-valley', 'salt-flats', 'cloud-study', 'bloom-signal'],
  },
  {
    id: 'electro-nature',
    label: 'Electro Nature',
    mark: 'E',
    description: 'Living subjects reconstructed with tracked light, grids, particles, signal trails and audio-reactive color.',
    placeholder: 'A translucent moth in a midnight greenhouse, its wing veins becoming neon circuitry and moving particles…',
    style: 'electro-organic',
    note: 'This combines a recognizable image source with local edge/motion treatments and generated shaders. The source is never sent through a second vision-to-text loop.',
    starters: ['living-koi', 'cloud-study', 'bloom-signal'],
  },
  {
    id: 'dark-fantasy',
    label: 'Dark Fantasy',
    mark: 'D',
    description: 'Ruins, firelight, armor, forests and mythic spaces—either generated imagery or a fully procedural living room.',
    placeholder: 'An ancient knight beneath a ruined cathedral, low firelight, drifting ash and enormous shadowed arches…',
    style: 'dark fantasy',
    note: 'Generate draft creates an AI image source. Ashen Keep and Moss & Glass below are different: coded layered rooms with real-time fire, embers and light, and no AI generation cost.',
    starters: ['ashen-keep', 'moss-glass'],
  },
] as const;

type CreationType = (typeof CREATION_TYPES)[number];

/** The front door: create first, then resume owned work, then browse starting points. */
export function renderExplore(host: HTMLElement): void {
  host.innerHTML = `
    <header class="page-head explore-head">
      <div><p class="eyebrow">VISUAL → MOTION → SOUND</p><h1>Make anything move.</h1><p class="sub">Describe a visual or start from your own image. The result stays editable, reactive and reusable.</p></div>
    </header>
    <section class="creation-types" aria-labelledby="creation-types-title">
      <div class="section-head type-head"><div><p class="eyebrow">CHOOSE A DIRECTION</p><h2 id="creation-types-title">Five ways to begin</h2></div></div>
      <div class="type-grid" id="creation-type-grid">
        ${CREATION_TYPES.map((type, index) => `<button class="creation-type${index === 1 ? ' active' : ''}" data-type="${type.id}" aria-pressed="${index === 1}"><span>${type.mark}</span><strong>${type.label}</strong><small>${type.description}</small></button>`).join('')}
      </div>
    </section>
    <section class="create-studio" aria-labelledby="create-title">
      <div class="create-copy"><span>01</span><div><h2 id="create-title">Create a Vibes visual</h2><p id="create-description">Lead with a feeling, place or time of day.</p></div></div>
      <textarea id="visual-prompt" rows="3" placeholder="Two bioluminescent blue fish swimming through black water…"></textarea>
      <div class="create-toolbar">
        <select id="visual-style" aria-label="Visual treatment">${STYLES.map((style) => `<option value="${style.value}">${style.label}</option>`).join('')}</select>
        <label class="button-like ghost" for="quick-upload">Use your image</label>
        <input id="quick-upload" class="file-input" type="file" accept="image/*" />
        <button class="primary" id="visual-go">Generate draft</button>
      </div>
      <p class="pipeline-note" id="pipeline-note"></p>
      <p class="generation-note" id="visual-status">Checking generation…</p>
    </section>
    <section class="library-section">
      <div class="section-head"><div><p class="eyebrow">YOUR LIBRARY</p><h2>Projects</h2></div><input id="search" class="search" type="search" placeholder="Search projects…" /></div>
      <div class="tag-row" id="tags"></div>
      <div class="grid" id="owned-grid"></div>
    </section>
    <details class="starter-section" open>
      <summary><div><p class="eyebrow">STARTING POINTS</p><h2 id="starter-title">Vibes starting points</h2></div><span>Toggle collection</span></summary>
      <div class="grid compact-grid" id="starter-grid"></div>
    </details>
    <details class="source-guide">
      <summary><div><p class="eyebrow">HOW SOURCES WORK</p><h2>Three pipelines, no redundant vision loop</h2></div><span>View architecture</span></summary>
      <div class="source-guide-grid">
        <article><strong>Procedural room</strong><span>Free after load</span><p>Layered coded artwork with real-time fire, water, particles and light. No image model.</p></article>
        <article><strong>Generated source</strong><span>One image call</span><p>Your text becomes one OpenAI image. Motion, shaders and music stay separate and reusable.</p></article>
        <article><strong>Your image</strong><span>Direct original</span><p>The file is stored as-is. Local pixel analysis drives edges and movement; no vision model or re-generation.</p></article>
      </div>
    </details>
  `;

  const status = host.querySelector<HTMLParagraphElement>('#visual-status')!;
  const prompt = host.querySelector<HTMLTextAreaElement>('#visual-prompt')!;
  const style = host.querySelector<HTMLSelectElement>('#visual-style')!;
  const go = host.querySelector<HTMLButtonElement>('#visual-go')!;
  const upload = host.querySelector<HTMLInputElement>('#quick-upload')!;
  const createTitle = host.querySelector<HTMLHeadingElement>('#create-title')!;
  const createDescription = host.querySelector<HTMLParagraphElement>('#create-description')!;
  const pipelineNote = host.querySelector<HTMLParagraphElement>('#pipeline-note')!;
  const starterTitle = host.querySelector<HTMLHeadingElement>('#starter-title')!;
  let generationEnabled = false;
  let imageModel = 'gpt-image-2';
  let activeCreationType: CreationType = CREATION_TYPES[1];

  void mediaCapabilities().then((caps) => {
    generationEnabled = caps.sceneGeneration;
    imageModel = caps.imageModel ?? imageModel;
    go.disabled = !generationEnabled;
    status.textContent = generationEnabled
      ? `~$${(caps.estimatedCostsUsd?.image ?? 0.04).toFixed(2)} per new draft · repeats reuse the local cache · session cap $${(caps.spendCapUsd ?? 3).toFixed(2)}`
      : 'Add OPENAI_API_KEY to generate drafts. Direct uploads and procedural starting points still work.';
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
      const creationType = activeCreationType.id;
      const fingerprint = await generationFingerprint('scene-image', imageModel, request, style.value);
      const cached = await cachedGeneration(fingerprint);
      let assetId = cached?.id;
      let mimeType = cached?.blob.type || 'image/png';
      let provider = 'openai';
      let model = imageModel;
      if (!assetId) {
        const generated = await generateSceneImage(request, style.value);
        assetId = await storeAsset(generated.blob, 'scene');
        mimeType = generated.mimeType;
        provider = generated.provider;
        model = generated.model;
        rememberGeneration(fingerprint, assetId);
      }
      const preset = createMediaPreset({ prompt: request, style: style.value, assetId, mimeType, provider, model, category: creationType });
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
      const preset = createMediaPreset({ prompt: request, style: style.value, assetId, mimeType: file.type, provider: 'upload', model: 'original', category: activeCreationType.id });
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

  function drawStarters() {
    const all = listPresets().filter((item) => item.builtIn);
    const selected = activeCreationType.starters.length
      ? all.filter((preset) => (activeCreationType.starters as readonly string[]).includes(preset.id))
      : [];
    starterGrid.innerHTML = '';
    if (!selected.length) {
      starterGrid.innerHTML = '<div class="empty project-empty"><strong>No fixed artist template.</strong><span>Enter any artist, movement or era above; the result remains your own editable project.</span></div>';
      return;
    }
    for (const preset of selected) starterGrid.appendChild(card(preset, drawLibrary));
  }

  function selectCreationType(next: CreationType) {
    activeCreationType = next;
    host.querySelectorAll<HTMLButtonElement>('.creation-type').forEach((button) => {
      const selected = button.dataset.type === next.id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    createTitle.textContent = `Create: ${next.label}`;
    createDescription.textContent = next.description;
    prompt.placeholder = next.placeholder;
    style.value = next.style;
    pipelineNote.textContent = next.note;
    starterTitle.textContent = `${next.label} starting points`;
    drawStarters();
  }

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

  host.querySelectorAll<HTMLButtonElement>('.creation-type').forEach((button) => {
    button.addEventListener('click', () => {
      const next = CREATION_TYPES.find((type) => type.id === button.dataset.type);
      if (next) selectCreationType(next);
    });
  });
  search.addEventListener('input', drawLibrary);
  selectCreationType(activeCreationType);
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
  const sourceLabel = preset.scene.kind === 'renderer'
    ? 'procedural live'
    : preset.scene.kind === 'procedural'
      ? 'coded source'
      : preset.scene.provenance?.provider === 'upload'
        ? 'direct upload'
        : preset.scene.kind === 'video'
          ? 'video source'
          : 'AI image';
  for (const label of [preset.scene.style, sourceLabel, preset.music ? 'music' : '', preset.parentId ? 'remix' : ''].filter(Boolean)) {
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
