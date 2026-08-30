import type { AppState } from './state';
import { audioSpecForPreset, loadPreset, reloadEffects, syncAudioLayers, syncGeneratedMusic } from './state';
import { navigate } from './router';
import { MARKET_MUSIC_DIRECTION, builtInEffects, forkPreset, getPreset, savePreset } from '../preset/library';
import { CONTROL_DEFS, newId, type Preset } from '../preset/types';
import { generateEffect } from '../effects/generate';
import type { EffectManifest } from '../effects/manifest';
import { assetUrl, cachedGeneration, generationFingerprint, getAsset, rememberGeneration, storeAsset } from '../media/assets';
import { generateMusic, generateSceneMotion, mediaCapabilities } from '../media/api';
import { resolveMusicBrief } from '../audio/resolve';
import { renderProviderPrompt } from '../audio/render-prompt';
import type { MusicBrief, MusicMode, SceneAudioContext } from '../audio/brief';
import { sourceEffect, type SourceEffectRecipe, type SourceEffectParams } from '../source-aware/types';
import { orchestrateLivingStill } from '../living-still/orchestrator';
import { directLivingStill } from '../living-still/api';
import { runtimeHost } from '../runtime/host';
import { setAsChromeVibe } from '../runtime/chrome-handoff';

/**
 * While a slider is being dragged, fade the panels so the change can be judged
 * against the actual image rather than the 6% of it left visible between cards.
 * The panel holding the control keeps its opacity so its value stays readable.
 */
function installPeekWhileAdjusting(host: HTMLElement): void {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) return;

  let active: HTMLElement | null = null;

  const start = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLInputElement) || target.type !== 'range') return;
    active = target.closest('.panel');
    active?.classList.add('is-adjusting');
    app.classList.add('is-peeking');
  };

  const stop = () => {
    if (!app.classList.contains('is-peeking')) return;
    app.classList.remove('is-peeking');
    active?.classList.remove('is-adjusting');
    active = null;
  };

  host.addEventListener('pointerdown', start);
  // Keyboard users get the same affordance when nudging a focused slider.
  host.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key.startsWith('Arrow')) start(e);
  });
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  host.addEventListener('keyup', stop);
  host.addEventListener('focusout', stop);
}

/**
 * Labs — where a room becomes yours.
 *
 * Two rules shape this screen. First, every control is a feeling, not a
 * mechanism: Mood, Motion, Depth, Glow, Atmosphere, Intensity. Second, editing
 * a built-in never damages it — opening one starts an owned copy, so the
 * starting library is always intact to come back to.
 */
export async function renderLabs(host: HTMLElement, state: AppState, presetId: string, returnTo: 'explore' | 'marketplace' = 'explore'): Promise<void> {
  const source = getPreset(presetId);
  if (!source) {
    host.innerHTML = `<div class="empty-stage"><p>That room no longer exists.</p><button class="primary" id="go">Back to Explore</button></div>`;
    host.querySelector('#go')?.addEventListener('click', () => navigate({ name: returnTo }));
    return;
  }

  // Built-ins are read-only: editing one starts a copy immediately.
  const draft: Preset = source.builtIn
    ? forkPreset(source, `${source.name} remix`)
    : structuredClone(source);
  state.draft = draft;
  const originalScene = structuredClone(source.scene);

  await loadPreset(state, draft);

  host.innerHTML = `
    <div class="labs">
      <header class="page-head labs-head">
        <div>
          <input id="name" class="name-input" />
          <p class="sub" id="labs-context"></p>
        </div>
        <div class="labs-actions">
          <button class="ghost" id="back">← Back</button>
          <button class="ghost" id="save">Save</button>
          <button class="display-mac-button" id="display-mac">${runtimeHost.kind === 'tauri' ? 'Set as Mac desktop' : 'Send to Mac desktop'}</button>
          ${runtimeHost.kind === 'tauri' ? '' : '<button class="ghost" id="display-chrome">Send to Chrome</button><span class="handoff-status" id="chrome-status" role="status"></span>'}
          <button class="primary" id="apply">Save &amp; Play</button>
        </div>
      </header>

      <div class="labs-panels">
        <section class="panel scene-panel">
          <h2>Scene</h2>
          <p class="hint">The visual underneath your live effects. Replace it without rebuilding the room.</p>
          <div class="scene-summary" id="scene-summary"></div>
          <div class="scene-actions">
            <label class="button-like primary" for="scene-upload">Use image or video</label>
            <input id="scene-upload" class="file-input" type="file" accept="image/*,video/*" />
            <button class="ghost" id="scene-animate">Animate source · ~$0.20</button>
            <button class="ghost" id="scene-restore">Restore original</button>
          </div>
          <p class="fx-status" id="scene-status"></p>
          <div class="source-motion" id="source-motion"></div>
        </section>

        <!-- The director used to sit at the bottom of the Scene panel, roughly
             1300px down, which put the single most interesting control in the
             product below the fold on a laptop. It gets its own panel. -->
        <section class="panel">
          <h2>Living Still director</h2>
          <div class="living-director">
            <p class="hint">Describe only what should move or sound. The director prefers tested effects and preserves the image.</p>
            <textarea id="living-intent" rows="2" placeholder="Gentle rain outside, quiet fire, occasional owl…"></textarea>
            <button class="primary wide" id="living-run">Auto-direct</button>
            <p class="fx-status" id="living-status"></p>
            <div id="living-layers"></div>
          </div>
        </section>

        <section class="panel">
          <h2>Source-aware treatments</h2>
          <div class="source-treatments">
            <p class="hint">These read motion and contours from the source. Atmospheric effects below still compose on top.</p>
            <div class="stock-effects" id="source-stock"></div>
            <div id="source-list"></div>
          </div>
        </section>

        <section class="panel">
          <h2>Feel</h2>
          <div id="controls"></div>
        </section>

        <section class="panel performance-panel">
          <h2>Performance</h2>
          <p class="hint">Automatic controls how often tracking runs and how many full-screen effects render together.</p>
          <div class="performance-choices" id="performance-choices"></div>
          <p class="fx-status" id="performance-status"></p>
        </section>

        <section class="panel">
          <h2>Effects</h2>
          <p class="hint">Add an instant reusable treatment, or generate something unusual as an editable shader.</p>
          <div class="stock-effects" id="fx-stock"></div>
          <textarea id="fx-prompt" rows="2" placeholder="slow glowing particles drifting upward…"></textarea>
          <button class="primary wide" id="fx-go">Generate effect</button>
          <p class="fx-status" id="fx-status"></p>
          <div id="fx-list"></div>
        </section>

        <section class="panel">
          <h2>Sound</h2>
          <div id="audio"></div>
          <div class="music-maker">
            <h3>Music asset</h3>
            <div id="music-current"></div>
            <div class="vocal-mode" id="music-mode" role="group" aria-label="Kind of music"></div>
            <div class="vocal-mode" id="vocal-mode" role="group" aria-label="Voice in generated music"></div>
            <textarea id="music-prompt" rows="3" placeholder="Optional. Your own words only — what you want to hear. Leave it empty to score the card as it is."></textarea>
            <button class="primary wide" id="music-go">Generate music from this visual</button>
            <p class="fx-status" id="music-status"></p>
          </div>
        </section>
      </div>
    </div>
  `;

  installPeekWhileAdjusting(host);

  const nameInput = host.querySelector<HTMLInputElement>('#name')!;
  nameInput.value = draft.name;
  const labsContext = host.querySelector<HTMLParagraphElement>('#labs-context')!;
  if (source.builtIn) {
    labsContext.append('Remixing ');
    const sourceName = document.createElement('strong');
    sourceName.textContent = source.name;
    labsContext.append(sourceName, ' — the original stays untouched.');
  } else {
    labsContext.textContent = 'Your room.';
  }
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value.trim() || 'Untitled room';
  });

  const performanceChoices = host.querySelector<HTMLDivElement>('#performance-choices')!;
  const performanceStatus = host.querySelector<HTMLParagraphElement>('#performance-status')!;
  const performanceLabels = {
    light: ['Light', '9fps tracking · 1 shader'],
    balanced: ['Automatic', '13fps tracking · up to 2 shaders'],
    full: ['Full', '18fps tracking · every shader'],
  } as const;
  function drawPerformance(): void {
    performanceChoices.innerHTML = '';
    const tier = draft.performanceTier ?? 'balanced';
    for (const [id, labels] of Object.entries(performanceLabels) as Array<[NonNullable<Preset['performanceTier']>, readonly [string, string]]>) {
      const button = document.createElement('button');
      button.className = `performance-choice${tier === id ? ' active' : ''}`;
      button.innerHTML = `<strong>${labels[0]}</strong><small>${labels[1]}</small>`;
      button.addEventListener('click', () => {
        draft.performanceTier = id;
        state.scene.setPerformanceTier(id);
        reloadEffects(state, draft);
        performanceStatus.textContent = id === 'balanced' ? 'Automatic is recommended for desktop.' : id === 'light' ? 'Light mode prioritizes responsiveness.' : 'Full mode may be heavy with stacked effects.';
        drawPerformance();
      });
      performanceChoices.appendChild(button);
    }
  }
  drawPerformance();

  // --- scene ----------------------------------------------------------------
  const sceneSummary = host.querySelector<HTMLDivElement>('#scene-summary')!;
  const sceneStatus = host.querySelector<HTMLParagraphElement>('#scene-status')!;
  const sceneUpload = host.querySelector<HTMLInputElement>('#scene-upload')!;
  const sceneAnimate = host.querySelector<HTMLButtonElement>('#scene-animate')!;
  const sourceMotion = host.querySelector<HTMLDivElement>('#source-motion')!;
  const livingIntent = host.querySelector<HTMLTextAreaElement>('#living-intent')!;
  const livingRun = host.querySelector<HTMLButtonElement>('#living-run')!;
  const livingStatus = host.querySelector<HTMLParagraphElement>('#living-status')!;
  const livingLayers = host.querySelector<HTMLDivElement>('#living-layers')!;

  livingIntent.value = draft.livingStill?.intent ?? '';

  function drawLivingStill(): void {
    livingLayers.innerHTML = '';
    const manifest = draft.livingStill;
    if (!manifest) {
      livingStatus.textContent = 'No directed motion yet. The image remains untouched.';
      return;
    }
    livingStatus.textContent = `${Math.round(manifest.confidence * 100)}% match · ${manifest.rationale}`;
    for (const effect of manifest.effects) {
      const row = document.createElement('div');
      row.className = 'mix-row living-layer-row';
      row.innerHTML = `<button class="mute ${effect.enabled ? '' : 'is-muted'}">${effect.enabled ? '●' : '✕'}</button><label>${effect.kind}<small>trusted motion recipe</small></label><input type="range" min="0" max="1" step="0.01" value="${effect.intensity}" />`;
      const toggle = row.querySelector<HTMLButtonElement>('button')!;
      const slider = row.querySelector<HTMLInputElement>('input')!;
      toggle.addEventListener('click', () => {
        effect.enabled = !effect.enabled;
        state.scene.setLivingEffects(manifest.effects);
        drawLivingStill();
      });
      slider.addEventListener('input', () => {
        effect.intensity = Number(slider.value);
        state.scene.setLivingEffects(manifest.effects);
      });
      livingLayers.appendChild(row);
    }
    if (manifest.audio.events.length) {
      const events = document.createElement('p');
      events.className = 'hint';
      events.textContent = `Occasional sounds: ${manifest.audio.events.map((event) => event.kind).join(', ')}`;
      livingLayers.appendChild(events);
    }
  }

  livingRun.addEventListener('click', async () => {
    if (draft.scene.kind !== 'image') {
      livingStatus.textContent = 'Living Still direction currently requires a still image.';
      return;
    }
    const intent = livingIntent.value.trim();
    if (!intent) return;
    livingRun.disabled = true;
    livingStatus.textContent = 'Analyzing visible regions and selecting the smallest matching effect set…';
    try {
      const sceneSource = draft.scene.url ?? (draft.scene.assetId ? await assetUrl(draft.scene.assetId) : undefined);
      if (!sceneSource) throw new Error('The source image is unavailable for analysis.');
      draft.livingStill = await directLivingStill(intent, sceneSource);
      await loadPreset(state, draft);
      drawLivingStill();
    } catch (error) {
      console.warn('[vibe] vision direction unavailable; using local intent fallback', error);
      draft.livingStill = orchestrateLivingStill(intent, {
        fire: { x: 0.4, y: 0.48, width: 0.2, height: 0.34 },
        exterior: { x: 0.56, y: 0.06, width: 0.44, height: 0.82 },
        sky: { x: 0, y: 0, width: 1, height: 0.55 },
      });
      await loadPreset(state, draft);
      drawLivingStill();
      livingStatus.textContent = `${error instanceof Error ? error.message : 'Vision analysis unavailable'} Using the local safe fallback.`;
    } finally {
      livingRun.disabled = false;
    }
  });

  function drawSourceMotion() {
    sourceMotion.innerHTML = '';
    if (draft.scene.kind !== 'image' && draft.scene.kind !== 'video') return;
    const motion = draft.scene.motion ?? {
      kind: draft.scene.kind === 'image' ? 'drift' as const : 'none' as const,
      amount: 0.06,
      speed: draft.scene.kind === 'video' ? 1 : 0.05,
    };
    draft.scene.motion = motion;
    sourceMotion.innerHTML = `
      <div class="source-motion-head"><strong>Motion</strong><span>${draft.scene.kind === 'video' ? 'playback' : 'live image movement'}</span></div>
      <div class="motion-kind" role="group" aria-label="Motion style"></div>
      <label class="ctl ctl-tight"><div class="ctl-head"><span>Speed</span><output>${(motion.speed ?? .8).toFixed(2)}×</output></div><input data-motion="speed" type="range" min="0.2" max="2" step="0.01" value="${motion.speed ?? .8}" /></label>
      ${draft.scene.kind === 'image' ? `<label class="ctl ctl-tight"><div class="ctl-head"><span>Amount</span><output>${Math.round((motion.amount ?? .025) * 100)}%</output></div><input data-motion="amount" type="range" min="0" max="0.09" step="0.001" value="${motion.amount ?? .025}" /></label>` : ''}
    `;
    const choices = draft.scene.kind === 'image' ? ['none', 'drift', 'flow'] as const : ['none'] as const;
    const kindHost = sourceMotion.querySelector<HTMLDivElement>('.motion-kind')!;
    for (const kind of choices) {
      const button = document.createElement('button');
      button.className = `filter-chip${motion.kind === kind ? ' active' : ''}`;
      button.textContent = kind;
      button.addEventListener('click', () => {
        motion.kind = kind;
        state.scene.setSourceMotion(motion);
        drawSourceMotion();
      });
      kindHost.appendChild(button);
    }
    for (const input of sourceMotion.querySelectorAll<HTMLInputElement>('input[data-motion]')) {
      input.addEventListener('input', () => {
        if (input.dataset.motion === 'speed') motion.speed = Number(input.value);
        else motion.amount = Number(input.value);
        const output = input.closest('label')?.querySelector('output');
        if (output) output.textContent = input.dataset.motion === 'speed'
          ? `${Number(input.value).toFixed(2)}×`
          : `${Math.round(Number(input.value) * 100)}%`;
        state.scene.setSourceMotion(motion);
      });
    }
  }

  function drawScene() {
    const kind = draft.scene.kind === 'renderer'
      ? 'Living renderer'
      : draft.scene.kind === 'procedural'
        ? 'Procedural source'
        : draft.scene.kind === 'video'
          ? 'Looping video'
          : 'Image';
    const description = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = draft.scene.label;
    const detail = document.createElement('span');
    detail.textContent = `${kind} · ${draft.scene.style}`;
    description.append(label, detail);
    const sceneKind = document.createElement('span');
    sceneKind.className = 'scene-kind';
    sceneKind.textContent = draft.scene.kind;
    sceneSummary.replaceChildren(description, sceneKind);
    sceneAnimate.hidden = draft.scene.kind !== 'image' || !draft.scene.assetId;
    drawSourceMotion();
    drawLivingStill();
  }

  sceneUpload.addEventListener('change', async () => {
    const file = sceneUpload.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      sceneStatus.textContent = 'Choose an image or video file.';
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      sceneStatus.textContent = 'Choose a file smaller than 80 MB for this local prototype.';
      return;
    }
    sceneStatus.textContent = 'Adding scene…';
    try {
      const kind = file.type.startsWith('video/') ? 'video' as const : 'image' as const;
      const assetId = await storeAsset(file, 'scene');
      draft.scene = {
        kind,
        assetId,
        mimeType: file.type,
        label: file.name.replace(/\.[^.]+$/, ''),
        style: 'uploaded',
        provenance: { createdAt: new Date().toISOString(), parentPresetId: source.id },
        // Same reasoning as generated visuals: drift preserves an uploaded
        // photo, flow re-slices it. See preset/library.ts.
        motion: kind === 'image' ? { kind: 'drift', amount: 0.06, speed: 0.05 } : { kind: 'none', speed: 1 },
      };
      await loadPreset(state, draft);
      drawScene();
      drawSourceTreatments();
      sceneStatus.textContent = 'Scene replaced. Effects and sound remain independent.';
    } catch (err) {
      console.error('[vibe] scene upload failed', err);
      sceneStatus.textContent = 'That file could not be used as a scene.';
    } finally {
      sceneUpload.value = '';
    }
  });

  sceneAnimate.addEventListener('click', async () => {
    if (draft.scene.kind !== 'image' || !draft.scene.assetId) return;
    sceneAnimate.disabled = true;
    sceneStatus.textContent = 'Creating one 4-second motion draft… this can take a few minutes.';
    try {
      const image = await getAsset(draft.scene.assetId);
      if (!image) throw new Error('The source image is no longer available locally.');
      const request = draft.scene.provenance?.prompt ?? draft.description;
      const fingerprint = await generationFingerprint('scene-motion', draft.scene.assetId, request);
      const cached = await cachedGeneration(fingerprint);
      let assetId = cached?.id;
      let mimeType = cached?.blob.type || 'video/mp4';
      let provider = 'google';
      let model = 'veo-3.1-lite-generate-preview';
      if (!assetId) {
        const generated = await generateSceneMotion(request, image);
        assetId = await storeAsset(generated.blob, 'scene');
        mimeType = generated.mimeType;
        provider = generated.provider;
        model = generated.model;
        rememberGeneration(fingerprint, assetId);
      }
      draft.scene = {
        kind: 'video',
        assetId,
        mimeType,
        label: draft.scene.label,
        style: draft.scene.style,
        motion: { kind: 'none', speed: 1 },
        provenance: { ...draft.scene.provenance, provider, model, createdAt: new Date().toISOString() },
      };
      await loadPreset(state, draft);
      drawScene();
      sceneStatus.textContent = cached ? 'Cached motion reused. Adjust playback speed below.' : 'Motion saved locally. Adjust playback speed below.';
    } catch (error) {
      console.error('[vibe] source motion failed', error);
      sceneStatus.textContent = error instanceof Error ? error.message : 'Motion generation failed; the image is unchanged.';
    } finally {
      sceneAnimate.disabled = false;
    }
  });

  host.querySelector('#scene-restore')?.addEventListener('click', async () => {
    draft.scene = structuredClone(originalScene);
    await loadPreset(state, draft);
    drawScene();
    drawSourceTreatments();
    sceneStatus.textContent = 'Original scene restored.';
  });
  drawScene();

  // --- source-aware treatments ---------------------------------------------
  const sourceList = host.querySelector<HTMLDivElement>('#source-list')!;
  const sourceStock = host.querySelector<HTMLDivElement>('#source-stock')!;
  const sourceParamDefs: Array<{ key: keyof Omit<SourceEffectParams, 'color'>; label: string; min: number; max: number; step: number }> = [
    { key: 'cellSize', label: 'Cell size', min: 4, max: 26, step: 1 },
    { key: 'trail', label: 'Trail length', min: 0.15, max: 3, step: 0.05 },
    { key: 'glow', label: 'Glow', min: 0, max: 1.5, step: 0.01 },
    { key: 'density', label: 'Density', min: 0.08, max: 1, step: 0.01 },
    { key: 'response', label: 'Response', min: 0.2, max: 3, step: 0.02 },
    { key: 'sourceVisibility', label: 'Source detail', min: 0, max: 1, step: 0.01 },
  ];

  function syncSourceTreatments() {
    state.scene.setSourceEffects(draft.sourceEffects);
  }

  function sourceCard(recipe: SourceEffectRecipe): HTMLElement {
    const el = document.createElement('div');
    el.className = 'fx-card source-card';
    el.innerHTML = `
      <div class="fx-card-head">
        <label class="toggle"><input type="checkbox" /><span></span></label>
        <button class="ghost tiny" data-act="remove" title="Remove">×</button>
      </div>
      <p class="fx-notes"></p>
      <div class="fx-params"></div>
      <label class="color-row"><span>Tint</span><input type="color" /></label>
    `;
    const enabled = el.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    enabled.checked = recipe.enabled;
    el.querySelector<HTMLElement>('.toggle span')!.textContent = recipe.name;
    el.querySelector<HTMLElement>('.fx-notes')!.textContent = recipe.notes;
    el.querySelector<HTMLInputElement>('input[type=color]')!.value = recipe.params.color;
    enabled.addEventListener('change', (event) => {
      recipe.enabled = (event.target as HTMLInputElement).checked;
      syncSourceTreatments();
    });
    el.querySelector<HTMLButtonElement>('[data-act=remove]')!.addEventListener('click', () => {
      draft.sourceEffects = draft.sourceEffects.filter((item) => item.id !== recipe.id);
      syncSourceTreatments();
      drawSourceTreatments();
    });
    const params = el.querySelector<HTMLDivElement>('.fx-params')!;
    for (const def of sourceParamDefs) {
      const row = document.createElement('div');
      row.className = 'ctl ctl-tight';
      row.innerHTML = `<div class="ctl-head"><label>${def.label}</label></div><input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${recipe.params[def.key]}" />`;
      row.querySelector<HTMLInputElement>('input')!.addEventListener('input', (event) => {
        recipe.params[def.key] = Number((event.target as HTMLInputElement).value);
        syncSourceTreatments();
      });
      params.appendChild(row);
    }
    el.querySelector<HTMLInputElement>('input[type=color]')!.addEventListener('input', (event) => {
      recipe.params.color = (event.target as HTMLInputElement).value;
      syncSourceTreatments();
    });
    return el;
  }

  function addSourceTreatment(kind: 'motion-cells' | 'edge-echo' | 'tracked-grid') {
    const recipe = sourceEffect(
      kind,
      kind === 'motion-cells' ? 'Motion cells' : kind === 'edge-echo' ? 'Edge echo' : 'Tracked grid',
      draft.palette.accent,
    );
    recipe.id = newId('source');
    draft.sourceEffects.push(recipe);
    syncSourceTreatments();
    drawSourceTreatments();
  }

  function drawSourceTreatments() {
    sourceStock.innerHTML = '';
    for (const option of [
      { kind: 'motion-cells' as const, label: '+ Motion cells' },
      { kind: 'edge-echo' as const, label: '+ Edge echo' },
      { kind: 'tracked-grid' as const, label: '+ Tracked grid' },
    ]) {
      const button = document.createElement('button');
      button.className = 'stock-effect';
      button.textContent = option.label;
      button.disabled = draft.scene.kind === 'renderer';
      button.title = button.disabled ? 'Choose or upload a media source first.' : 'Add a reusable source-aware recipe.';
      button.addEventListener('click', () => addSourceTreatment(option.kind));
      sourceStock.appendChild(button);
    }
    sourceList.innerHTML = '';
    if (!draft.sourceEffects.length) {
      sourceList.innerHTML = `<p class="empty-inline">${draft.scene.kind === 'renderer' ? 'Upload media to enable source analysis.' : 'No source treatment yet. The moving source is unprocessed.'}</p>`;
      return;
    }
    for (const recipe of draft.sourceEffects) sourceList.appendChild(sourceCard(recipe));
  }
  drawSourceTreatments();

  // --- feel controls ---------------------------------------------------------
  const controlsEl = host.querySelector<HTMLDivElement>('#controls')!;
  for (const def of CONTROL_DEFS) {
    const row = document.createElement('div');
    row.className = 'ctl';
    row.innerHTML = `
      <div class="ctl-head"><label>${def.label}</label></div>
      <input type="range" min="0" max="1" step="0.01" value="${draft.controls[def.key]}" />
      <div class="ctl-ends"><span>${def.low}</span><span>${def.high}</span></div>
    `;
    const slider = row.querySelector<HTMLInputElement>('input')!;
    slider.addEventListener('input', () => {
      draft.controls[def.key] = Number(slider.value);
      // Applied live — you should never have to press Apply to see a slider work.
      state.scene.controls = { ...draft.controls };
    });
    controlsEl.appendChild(row);
  }

  // --- effects ---------------------------------------------------------------
  const fxList = host.querySelector<HTMLDivElement>('#fx-list')!;
  const fxStatus = host.querySelector<HTMLParagraphElement>('#fx-status')!;
  const fxPrompt = host.querySelector<HTMLTextAreaElement>('#fx-prompt')!;
  const fxGo = host.querySelector<HTMLButtonElement>('#fx-go')!;
  const fxStock = host.querySelector<HTMLDivElement>('#fx-stock')!;

  function drawStockEffects() {
    fxStock.innerHTML = '';
    for (const stock of builtInEffects()) {
      const exists = draft.effects.some((effect) => effect.id === stock.id || effect.parentId === stock.id);
      const button = document.createElement('button');
      button.className = 'stock-effect';
      button.disabled = exists;
      button.textContent = exists ? `✓ ${stock.name}` : `+ ${stock.name}`;
      button.title = stock.notes;
      button.addEventListener('click', () => {
        draft.effects.push({
          ...structuredClone(stock),
          id: newId('fx'),
          parentId: stock.id,
          createdAt: new Date().toISOString(),
        });
        reloadEffects(state, draft);
        drawEffects();
        drawStockEffects();
      });
      fxStock.appendChild(button);
    }
  }

  function drawEffects() {
    fxList.innerHTML = '';
    if (!draft.effects.length) {
      fxList.innerHTML = '<p class="empty-inline">No effects yet.</p>';
      return;
    }
    for (const fx of draft.effects) fxList.appendChild(effectCard(fx));
  }

  function effectCard(fx: EffectManifest): HTMLElement {
    const el = document.createElement('div');
    el.className = 'fx-card';
    el.innerHTML = `
      <div class="fx-card-head">
        <label class="toggle">
          <input type="checkbox" />
          <span></span>
        </label>
        <button class="ghost tiny" data-act="remove" title="Remove">×</button>
      </div>
      <p class="fx-notes"></p>
      <div class="fx-params"></div>
      <details class="fx-remix">
        <summary>Remix this effect</summary>
        <textarea rows="2"></textarea>
        <button class="ghost wide" data-act="remix">Regenerate from this prompt</button>
      </details>
    `;

    const enabled = el.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    enabled.checked = fx.enabled;
    el.querySelector<HTMLElement>('.toggle span')!.textContent = fx.name;
    el.querySelector<HTMLElement>('.fx-notes')!.textContent = fx.notes;
    el.querySelector<HTMLTextAreaElement>('.fx-remix textarea')!.value = fx.prompt;
    enabled.addEventListener('change', (e) => {
      fx.enabled = (e.target as HTMLInputElement).checked;
      reloadEffects(state, draft);
    });

    el.querySelector('[data-act=remove]')!.addEventListener('click', () => {
      draft.effects = draft.effects.filter((e) => e.id !== fx.id);
      reloadEffects(state, draft);
      drawEffects();
      drawStockEffects();
    });

    // Parameter sliders — the thing that makes a generated effect editable
    // rather than a lottery ticket you re-roll.
    const params = el.querySelector<HTMLDivElement>('.fx-params')!;
    for (const p of fx.params) {
      const row = document.createElement('div');
      row.className = 'ctl ctl-tight';
      row.innerHTML = '<div class="ctl-head"><label></label></div><input type="range" />';
      row.querySelector<HTMLLabelElement>('label')!.textContent = p.label;
      const slider = row.querySelector<HTMLInputElement>('input')!;
      slider.min = String(p.min);
      slider.max = String(p.max);
      slider.step = String((p.max - p.min) / 100);
      slider.value = String(p.value);
      slider.addEventListener('input', () => {
        p.value = Number(slider.value);
        state.filters.get(fx.id)?.setParams(fx.params);
      });
      params.appendChild(row);
    }

    el.querySelector('[data-act=remix]')!.addEventListener('click', async () => {
      const ta = el.querySelector<HTMLTextAreaElement>('.fx-remix textarea')!;
      await runGeneration(ta.value.trim(), fx.id, fx.id);
    });

    return el;
  }

  /** Shared by "Generate effect" and per-effect remix. */
  async function runGeneration(prompt: string, parentId?: string, replaceId?: string) {
    if (!prompt) {
      fxStatus.textContent = 'Describe the effect first.';
      return;
    }
    fxGo.disabled = true;
    const started = Date.now();
    // Generation takes tens of seconds. Saying so beats a spinner that lies.
    const timer = setInterval(() => {
      fxStatus.textContent = `Designing the effect… ${Math.round((Date.now() - started) / 1000)}s`;
    }, 500);

    try {
      const result = await generateEffect(prompt, {
        paletteRamp: draft.palette.ramp,
        renderStyle: state.scene.vibe.render_style,
        parentId,
        onProgress: (m) => {
          fxStatus.textContent = m;
        },
      });

      if (replaceId) {
        const idx = draft.effects.findIndex((e) => e.id === replaceId);
        if (idx >= 0) draft.effects[idx] = result.manifest;
        else draft.effects.push(result.manifest);
      } else {
        draft.effects.push(result.manifest);
      }

      reloadEffects(state, draft);
      drawEffects();
      const sourceLabel = result.cacheHit ? 'reused from cache' : `${result.attempts} model attempt${result.attempts === 1 ? '' : 's'}`;
      fxStatus.textContent = `✓ ${result.manifest.name} — ${result.manifest.params.length} controls, ${sourceLabel}.`;
      fxPrompt.value = '';
    } catch (err) {
      fxStatus.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      clearInterval(timer);
      fxGo.disabled = false;
    }
  }

  fxGo.addEventListener('click', () => runGeneration(fxPrompt.value.trim()));
  drawEffects();
  drawStockEffects();

  // --- sound -----------------------------------------------------------------
  const audioEl = host.querySelector<HTMLDivElement>('#audio')!;
  const startSound = document.createElement('button');
  startSound.className = 'primary wide';
  startSound.textContent = state.started ? 'Sound on' : 'Play included sound';
  startSound.disabled = state.started;
  startSound.addEventListener('click', async () => {
    startSound.disabled = true;
    startSound.textContent = 'Starting sound…';
    try {
      state.audio.setAmbientEvents(draft.livingStill?.audio.events ?? []);
      await state.audio.start(audioSpecForPreset(draft));
      state.started = true;
      syncAudioLayers(state, draft);
      await syncGeneratedMusic(state, draft);
      startSound.textContent = 'Sound on';
    } catch (error) {
      console.error('[vibe] audio failed to start', error);
      startSound.textContent = 'Sound unavailable';
      startSound.disabled = false;
    }
  });
  audioEl.appendChild(startSound);
  for (const layer of [
    { key: 'ambience' as const, label: 'Ambience', hint: 'the sound of the place' },
    { key: 'music' as const, label: 'Music', hint: 'the sound of the mood' },
    { key: 'master' as const, label: 'Everything', hint: '' },
  ]) {
    const s = draft.audio[layer.key];
    const row = document.createElement('div');
    row.className = 'mix-row';
    row.innerHTML = `
      <button class="mute ${s.muted ? 'is-muted' : ''}">${s.muted ? '✕' : '●'}</button>
      <label>${layer.label}${layer.hint ? `<small>${layer.hint}</small>` : ''}</label>
      <input type="range" min="0" max="1" step="0.01" value="${s.gain}" />
    `;
    const mute = row.querySelector<HTMLButtonElement>('.mute')!;
    const slider = row.querySelector<HTMLInputElement>('input')!;
    slider.addEventListener('input', () => {
      draft.audio[layer.key].gain = Number(slider.value);
      syncAudioLayers(state, draft);
    });
    mute.addEventListener('click', () => {
      const next = !draft.audio[layer.key].muted;
      draft.audio[layer.key].muted = next;
      mute.classList.toggle('is-muted', next);
      mute.textContent = next ? '✕' : '●';
      syncAudioLayers(state, draft);
    });
    audioEl.appendChild(row);
  }

  // Generated music is a one-time asset. Playback only reads the stored blob.
  const musicCurrent = host.querySelector<HTMLDivElement>('#music-current')!;
  const musicPrompt = host.querySelector<HTMLTextAreaElement>('#music-prompt')!;
  const musicGo = host.querySelector<HTMLButtonElement>('#music-go')!;
  const musicStatus = host.querySelector<HTMLParagraphElement>('#music-status')!;
  const vocalModeHost = host.querySelector<HTMLDivElement>('#vocal-mode')!;
  const musicModeHost = host.querySelector<HTMLDivElement>('#music-mode')!;
  let vocalMode: 'auto' | 'vocals' | 'instrumental' = 'auto';
  let musicMode: MusicMode = draft.music?.musicBrief?.mode ?? 'ambient_score';

  // The textarea holds the user's own words and nothing else. The old pre-filled
  // paragraph, concatenated from five preset fields, is what made every card
  // converge on one track once the server rewrote it again on top.
  musicPrompt.value = draft.music?.provenance.inputPrompt ?? '';
  if (draft.music?.provenance.vocalMode) vocalMode = draft.music.provenance.vocalMode;

  /**
   * Choice buttons, built node by node. Nothing here may become an innerHTML
   * template: test/release-surface.test.ts gates the build on exactly that, and
   * these rows render preset-derived state.
   */
  function drawChoices<T extends string>(
    target: HTMLDivElement,
    options: ReadonlyArray<{ id: T; label: string; hint: string }>,
    selected: T,
    pick: (id: T) => void,
  ): void {
    target.replaceChildren();
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `vocal-choice${selected === option.id ? ' active' : ''}`;
      const label = document.createElement('strong');
      label.textContent = option.label;
      const hint = document.createElement('small');
      hint.textContent = option.hint;
      button.append(label, hint);
      button.addEventListener('click', () => pick(option.id));
      target.appendChild(button);
    }
  }

  function drawVocalMode(): void {
    drawChoices(
      vocalModeHost,
      [
        { id: 'auto' as const, label: 'Auto', hint: 'follow my prompt' },
        { id: 'vocals' as const, label: 'Vocals', hint: 'singing or rap' },
        { id: 'instrumental' as const, label: 'Instrumental', hint: 'music only' },
      ],
      vocalMode,
      (id) => { vocalMode = id; drawVocalMode(); },
    );
  }

  function drawMusicMode(): void {
    drawChoices(
      musicModeHost,
      [
        { id: 'soundscape' as const, label: 'Soundscape', hint: 'place, not music' },
        { id: 'ambient_score' as const, label: 'Ambient', hint: 'a bed that repeats' },
        { id: 'instrumental_score' as const, label: 'Score', hint: 'written, no voice' },
        { id: 'song' as const, label: 'Song', hint: 'verses and a hook' },
      ],
      musicMode,
      (id) => { musicMode = id; drawMusicMode(); },
    );
  }

  /**
   * The director returns sceneContext, but src/living-still/api.ts does not
   * forward it yet and that file is outside this change. Read it tolerantly so
   * the brief picks it up the moment that hop lands.
   */
  function cachedSceneContext(): SceneAudioContext | undefined {
    return (draft.livingStill as { sceneContext?: SceneAudioContext } | undefined)?.sceneContext;
  }

  /**
   * Card direction, the mode buttons, the vocal buttons and the user's own text,
   * resolved by the shared precedence rules. An empty textarea is fine: the card
   * and the scene still carry direction on their own.
   */
  function buildMusicBrief(): MusicBrief {
    // A Marketplace card carries its own direction; anything else has none, and
    // resolveMusicBrief simply falls through to the scene and the mode default.
    // Precedence is untouched: user request > UI control > card > scene > default.
    // presetId, not draft.id: editing a built-in forks it under a fresh id, and
    // the direction belongs to the card that was opened.
    const market = MARKET_MUSIC_DIRECTION[presetId];
    return resolveMusicBrief({
      userRequest: musicPrompt.value.trim() || undefined,
      vocalControl: vocalMode,
      cardDirection: {
        ...market,
        ...draft.music?.musicBrief,
        music: { ...market?.music, ...draft.music?.musicBrief?.music },
        mode: musicMode,
      },
      scene: cachedSceneContext(),
    });
  }

  function drawMusic() {
    musicCurrent.innerHTML = '';
    const selectedMusic = draft.music ?? draft.baselineMusic;
    if (!selectedMusic) {
      musicCurrent.innerHTML = '<p class="empty-inline">Procedural score · instant and free</p>';
      return;
    }
    const row = document.createElement('div');
    row.className = 'music-asset';
    const description = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = selectedMusic.name;
    const duration = document.createElement('span');
    duration.textContent = `${draft.music ? 'custom track' : 'included baseline'} · ${selectedMusic.durationSeconds ?? 30}s`;
    description.append(name, duration);
    const remove = document.createElement('button');
    remove.className = 'ghost tiny';
    remove.textContent = draft.music ? 'Use baseline' : 'Included';
    remove.disabled = !draft.music;
    row.append(description, remove);
    remove.addEventListener('click', async () => {
      draft.music = undefined;
      await syncGeneratedMusic(state, draft);
      drawMusic();
      musicStatus.textContent = draft.baselineMusic ? 'Included baseline score restored.' : 'Procedural score restored.';
    });
    musicCurrent.appendChild(row);
  }

  void mediaCapabilities()
    .then((caps) => {
      if (!caps.musicGeneration) {
        musicGo.disabled = true;
        musicStatus.textContent = 'Add ELEVENLABS_API_KEY to enable one-time Eleven Music generation. The procedural score remains available.';
      } else {
        musicStatus.textContent = caps.musicPromptAdaptation
          ? 'Artist references are translated into descriptive musical DNA before ElevenLabs · one 90-second seamless-bed generation · approximately $0.226.'
          : 'Add ANTHROPIC_API_KEY to translate artist references before music generation.';
        if (!caps.musicPromptAdaptation) musicGo.disabled = true;
      }
    })
    .catch(() => {
      musicGo.disabled = true;
      musicStatus.textContent = 'Music generation is offline. The procedural score remains available.';
    });

  musicGo.addEventListener('click', async () => {
    const userRequest = musicPrompt.value.trim();
    const brief = buildMusicBrief();
    musicGo.disabled = true;
    musicStatus.textContent = 'Composing one track… your current music keeps playing.';
    try {
      const generated = await generateMusic({
        brief,
        userRequest,
        vocalMode,
        sceneContext: cachedSceneContext(),
        // The route still requires non-empty prompt text. When the user typed
        // nothing, the brief renders its own.
        prompt: userRequest || renderProviderPrompt(brief, 'elevenlabs'),
      });
      const savedPrompt = generated.adaptedPrompt ?? userRequest;
      const label = userRequest || generated.adaptedPrompt || 'Generated track';
      const assetId = await storeAsset(generated.blob, 'music');
      draft.music = {
        assetId,
        name: label.length > 46 ? `${label.slice(0, 43)}…` : label,
        mimeType: generated.mimeType,
        durationSeconds: generated.durationSeconds,
        musicBrief: brief,
        playback: generated.playback,
        masterReport: generated.masterReport,
        provenance: {
          prompt: savedPrompt,
          inputPrompt: userRequest,
          vocalMode: generated.vocalMode,
          provider: generated.provider,
          model: generated.model,
          createdAt: new Date().toISOString(),
          parentPresetId: source.id,
        },
      };
      const url = await assetUrl(assetId);
      if (state.started) await state.audio.setGeneratedMusic(url, draft.music?.playback);
      drawMusic();
      // The box keeps the user's own words. It is their input, not a display of ours.
      const voice = generated.vocalMode === 'vocals' ? 'vocals enabled' : 'instrumental mode';
      musicStatus.textContent = generated.degraded
        ? `Track saved with ${voice}, but it came back shorter than asked for.`
        : `Track saved with ${voice}.`;
    } catch (err) {
      console.error('[vibe] music generation failed', err);
      musicStatus.textContent = err instanceof Error ? err.message : 'Music generation failed. Your current mix is unchanged.';
    } finally {
      musicGo.disabled = false;
    }
  });
  drawMusicMode();
  drawVocalMode();
  drawMusic();

  // --- save / apply ----------------------------------------------------------
  function commit(): Preset {
    if (!draft.id || draft.builtIn) draft.id = newId('preset');
    draft.builtIn = false;
    savePreset(draft);
    state.loaded = draft;
    return draft;
  }

  host.querySelector('#back')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else navigate({ name: returnTo });
  });
  host.querySelector('#save')?.addEventListener('click', () => {
    commit();
    const btn = host.querySelector<HTMLButtonElement>('#save')!;
    btn.textContent = 'Saved';
    setTimeout(() => (btn.textContent = 'Save'), 1400);
  });
  host.querySelector<HTMLButtonElement>('#display-mac')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    const preset = commit();
    try {
      if (runtimeHost.kind === 'tauri') await runtimeHost.activatePreset(preset.id);
      else await runtimeHost.openNativeApp(preset);
      button.textContent = runtimeHost.kind === 'tauri' ? 'Desktop updated' : 'Sent to Mac';
    } catch (error) {
      console.error('[vibe] could not display on Mac', error);
      button.textContent = 'Could not reach Mac';
    } finally {
      button.disabled = false;
    }
  });
  host.querySelector<HTMLButtonElement>('#display-chrome')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const status = host.querySelector<HTMLElement>('#chrome-status');
    button.disabled = true;
    const result = await setAsChromeVibe(commit());
    if (status) status.textContent = result.message;
    button.textContent = result.ok ? 'Sent to Chrome' : 'Send to Chrome';
    button.disabled = false;
  });
  host.querySelector('#apply')?.addEventListener('click', () => {
    commit();
    navigate({ name: 'player' });
  });
}
