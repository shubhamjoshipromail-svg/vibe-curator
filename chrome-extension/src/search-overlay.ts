const STORAGE_KEY = 'vibe.curator.extension.state.v1';
const STYLE_ID = 'vibe-curator-search-style';

interface SearchState {
  features: { enabled: boolean; googleSearchBackground: boolean };
  preset: {
    scene: { kind: string; url?: string };
    palette: { base: string; surface: string; primary: string; accent: string };
  };
}

function searchState(value: unknown): SearchState {
  if (!value || typeof value !== 'object') throw new Error('Missing extension state.');
  const state = value as SearchState;
  const colors = state.preset?.palette;
  if (typeof state.features?.enabled !== 'boolean' || typeof state.features.googleSearchBackground !== 'boolean'
    || !colors || ![colors.base, colors.surface, colors.primary, colors.accent].every((color) => /^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error('Invalid extension state.');
  }
  if (state.preset.scene.kind === 'image') {
    const url = new URL(state.preset.scene.url || '');
    if (url.origin !== 'https://vibe-curator-production.up.railway.app' || url.search || url.hash
      || !/^\/market\/styles\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(url.pathname)) {
      throw new Error('Invalid scene image.');
    }
  }
  return state;
}

function removeOverlay(): void {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.removeAttribute('data-vibe-curator-search');
  document.documentElement.style.removeProperty('--vibe-curator-search-background');
}

function backgroundFor(state: SearchState): string {
  const { preset } = state;
  const gradients = `radial-gradient(circle at 82% 12%, ${preset.palette.accent}55, transparent 34%), radial-gradient(circle at 18% 86%, ${preset.palette.primary}66, transparent 38%), linear-gradient(145deg, ${preset.palette.base}, ${preset.palette.surface})`;
  return preset.scene.kind === 'image' ? `linear-gradient(${preset.palette.base}66, ${preset.palette.base}88), url("${preset.scene.url}"), ${gradients}` : gradients;
}

function applyOverlay(state: SearchState): void {
  if (!state.features.enabled || !state.features.googleSearchBackground) { removeOverlay(); return; }
  document.documentElement.setAttribute('data-vibe-curator-search', 'on');
  document.documentElement.style.setProperty('--vibe-curator-search-background', backgroundFor(state));
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html[data-vibe-curator-search] { background: var(--vibe-curator-search-background) center / cover fixed !important; }
      html[data-vibe-curator-search] body { background: transparent !important; }
      html[data-vibe-curator-search] .sfbg,
      html[data-vibe-curator-search] .CvDJxb,
      html[data-vibe-curator-search] #searchform,
      html[data-vibe-curator-search] #appbar { background: color-mix(in srgb, white 86%, transparent) !important; backdrop-filter: blur(18px); }
      html[data-vibe-curator-search] #rcnt,
      html[data-vibe-curator-search] #center_col,
      html[data-vibe-curator-search] #rhs { background: transparent !important; }
      html[data-vibe-curator-search] #center_col,
      html[data-vibe-curator-search] #rhs {
        background: color-mix(in srgb, white 91%, transparent) !important;
        border-radius: 20px;
        box-shadow: 0 12px 42px #00000014;
      }
      @media (prefers-color-scheme: dark) {
        html[data-vibe-curator-search] .sfbg,
        html[data-vibe-curator-search] .CvDJxb,
        html[data-vibe-curator-search] #searchform,
        html[data-vibe-curator-search] #appbar { background: color-mix(in srgb, #202124 84%, transparent) !important; }
        html[data-vibe-curator-search] #center_col,
        html[data-vibe-curator-search] #rhs { background: color-mix(in srgb, #202124 91%, transparent) !important; }
      }
    `;
    document.documentElement.append(style);
  }
}

async function refresh(): Promise<void> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  try { applyOverlay(searchState(stored)); } catch { removeOverlay(); }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  try { applyOverlay(searchState(changes[STORAGE_KEY].newValue)); } catch { removeOverlay(); }
});

void refresh();
