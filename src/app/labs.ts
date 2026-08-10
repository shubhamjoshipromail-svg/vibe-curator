import type { AppState } from './state';
import { loadPreset, reloadEffects, syncAudioLayers } from './state';
import { navigate } from './router';
import { forkPreset, getPreset, savePreset } from '../preset/library';
import { CONTROL_DEFS, newId, type Preset } from '../preset/types';
import { generateEffect } from '../effects/generate';
import type { EffectManifest } from '../effects/manifest';

/**
 * Labs — where a room becomes yours.
 *
 * Two rules shape this screen. First, every control is a feeling, not a
 * mechanism: Mood, Motion, Depth, Glow, Atmosphere, Intensity. Second, editing
 * a built-in never damages it — opening one starts an owned copy, so the
 * starting library is always intact to come back to.
 */
export async function renderLabs(host: HTMLElement, state: AppState, presetId: string): Promise<void> {
  const source = getPreset(presetId);
  if (!source) {
    host.innerHTML = `<div class="empty-stage"><p>That room no longer exists.</p><button class="primary" id="go">Back to Explore</button></div>`;
    host.querySelector('#go')?.addEventListener('click', () => navigate({ name: 'explore' }));
    return;
  }

  // Built-ins are read-only: editing one starts a copy immediately.
  const draft: Preset = source.builtIn
    ? forkPreset(source, `${source.name} remix`)
    : structuredClone(source);
  state.draft = draft;

  await loadPreset(state, draft);

  host.innerHTML = `
    <div class="labs">
      <header class="page-head labs-head">
        <div>
          <input id="name" class="name-input" value="${draft.name}" />
          <p class="sub">${source.builtIn ? `Remixing <strong>${source.name}</strong> — the original stays untouched.` : 'Your room.'}</p>
        </div>
        <div class="labs-actions">
          <button class="ghost" id="back">Explore</button>
          <button class="ghost" id="save">Save</button>
          <button class="primary" id="apply">Save &amp; Play</button>
        </div>
      </header>

      <div class="labs-panels">
        <section class="panel">
          <h2>Feel</h2>
          <div id="controls"></div>
        </section>

        <section class="panel">
          <h2>Effects</h2>
          <p class="hint">Describe something and it is generated as a real shader, then becomes an editable layer.</p>
          <textarea id="fx-prompt" rows="2" placeholder="slow glowing particles drifting upward…"></textarea>
          <button class="primary wide" id="fx-go">Generate effect</button>
          <p class="fx-status" id="fx-status"></p>
          <div id="fx-list"></div>
        </section>

        <section class="panel">
          <h2>Sound</h2>
          <div id="audio"></div>
        </section>
      </div>
    </div>
  `;

  const nameInput = host.querySelector<HTMLInputElement>('#name')!;
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value.trim() || 'Untitled room';
  });

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
          <input type="checkbox" ${fx.enabled ? 'checked' : ''} />
          <span>${fx.name}</span>
        </label>
        <button class="ghost tiny" data-act="remove" title="Remove">×</button>
      </div>
      <p class="fx-notes">${fx.notes}</p>
      <div class="fx-params"></div>
      <details class="fx-remix">
        <summary>Remix this effect</summary>
        <textarea rows="2">${fx.prompt}</textarea>
        <button class="ghost wide" data-act="remix">Regenerate from this prompt</button>
      </details>
    `;

    el.querySelector<HTMLInputElement>('input[type=checkbox]')!.addEventListener('change', (e) => {
      fx.enabled = (e.target as HTMLInputElement).checked;
      reloadEffects(state, draft);
    });

    el.querySelector('[data-act=remove]')!.addEventListener('click', () => {
      draft.effects = draft.effects.filter((e) => e.id !== fx.id);
      reloadEffects(state, draft);
      drawEffects();
    });

    // Parameter sliders — the thing that makes a generated effect editable
    // rather than a lottery ticket you re-roll.
    const params = el.querySelector<HTMLDivElement>('.fx-params')!;
    for (const p of fx.params) {
      const row = document.createElement('div');
      row.className = 'ctl ctl-tight';
      row.innerHTML = `
        <div class="ctl-head"><label>${p.label}</label></div>
        <input type="range" min="${p.min}" max="${p.max}" step="${(p.max - p.min) / 100}" value="${p.value}" />
      `;
      const slider = row.querySelector<HTMLInputElement>('input')!;
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
        renderStyle: 'pixel_art',
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
      fxStatus.textContent = `✓ ${result.manifest.name} — ${result.manifest.params.length} controls, ready in ${Math.round((Date.now() - started) / 1000)}s.`;
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

  // --- sound -----------------------------------------------------------------
  const audioEl = host.querySelector<HTMLDivElement>('#audio')!;
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

  // --- save / apply ----------------------------------------------------------
  function commit(): Preset {
    if (!draft.id || draft.builtIn) draft.id = newId('preset');
    draft.builtIn = false;
    savePreset(draft);
    state.loaded = draft;
    return draft;
  }

  host.querySelector('#back')?.addEventListener('click', () => navigate({ name: 'explore' }));
  host.querySelector('#save')?.addEventListener('click', () => {
    commit();
    const btn = host.querySelector<HTMLButtonElement>('#save')!;
    btn.textContent = 'Saved';
    setTimeout(() => (btn.textContent = 'Save'), 1400);
  });
  host.querySelector('#apply')?.addEventListener('click', () => {
    commit();
    navigate({ name: 'player' });
  });
}
