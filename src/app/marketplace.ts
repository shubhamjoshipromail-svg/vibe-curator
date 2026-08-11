import { listPresets } from '../preset/library';
import { renderThumbnail } from '../preset/thumbnail';
import type { Preset } from '../preset/types';
import { navigate } from './router';

type Collection = 'artist' | 'vibes' | 'nature' | 'electro-nature' | 'dark-fantasy';

interface MarketplacePost {
  presetId: string;
  collection: Collection;
  author: string;
  handle: string;
  official?: boolean;
  likes: number;
}

const POSTS: MarketplacePost[] = [
  { presetId: 'market-artist-color-orbit', collection: 'artist', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 864 },
  { presetId: 'market-vibes-midnight-haze', collection: 'vibes', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 612 },
  { presetId: 'market-nature-moon-bloom', collection: 'nature', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 735 },
  { presetId: 'market-electro-neon-koi', collection: 'electro-nature', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 1093 },
  { presetId: 'market-dark-ember-throne', collection: 'dark-fantasy', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 947 },
  { presetId: 'community-cloud-radio', collection: 'electro-nature', author: 'Soft Static', handle: '@softstatic', likes: 318 },
  { presetId: 'community-rose-tunnel', collection: 'artist', author: 'Night Garden', handle: '@nightgarden', likes: 527 },
  { presetId: 'community-tidal-signal', collection: 'nature', author: 'Moth Signal', handle: '@mothsignal', likes: 284 },
  { presetId: 'community-green-ruin', collection: 'dark-fantasy', author: 'Fern Archive', handle: '@fernarchive', likes: 419 },
  { presetId: 'community-ember-sentinel', collection: 'vibes', author: 'Low Lantern', handle: '@lowlantern', likes: 356 },
];

const COLLECTIONS: Array<{ id: 'all' | Collection; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'artist', label: 'Artist' },
  { id: 'vibes', label: 'Vibes' },
  { id: 'nature', label: 'Nature' },
  { id: 'electro-nature', label: 'Electro Nature' },
  { id: 'dark-fantasy', label: 'Dark Fantasy' },
];

export function renderMarketplace(host: HTMLElement): void {
  host.innerHTML = `
    <header class="page-head market-head">
      <div><p class="eyebrow">DISCOVER &amp; REMIX</p><h1>Marketplace</h1><p class="sub">Premade rooms from Vibe Curator and posts shared by the community. Open anything in Labs and make it yours.</p></div>
      <button class="ghost" id="projects">Your projects</button>
    </header>
    <div class="tag-row market-filters" id="market-filters"></div>
    <section class="market-section"><div class="section-head"><div><p class="eyebrow">MADE BY VIBE</p><h2>Official starting cards</h2></div></div><div class="grid" id="official-grid"></div></section>
    <section class="market-section"><div class="section-head"><div><p class="eyebrow">COMMUNITY</p><h2>Recent posts</h2></div></div><div class="grid" id="community-grid"></div></section>
  `;

  host.querySelector('#projects')?.addEventListener('click', () => navigate({ name: 'explore' }));
  const filters = host.querySelector<HTMLDivElement>('#market-filters')!;
  const officialGrid = host.querySelector<HTMLDivElement>('#official-grid')!;
  const communityGrid = host.querySelector<HTMLDivElement>('#community-grid')!;
  let active: 'all' | Collection = 'all';

  const presets = new Map(listPresets().map((preset) => [preset.id, preset]));

  function draw() {
    filters.innerHTML = '';
    for (const collection of COLLECTIONS) {
      const button = document.createElement('button');
      button.className = `filter-chip${active === collection.id ? ' active' : ''}`;
      button.textContent = collection.label;
      button.addEventListener('click', () => { active = collection.id; draw(); });
      filters.appendChild(button);
    }
    const visible = POSTS.filter((post) => active === 'all' || post.collection === active);
    officialGrid.innerHTML = '';
    communityGrid.innerHTML = '';
    for (const post of visible) {
      const preset = presets.get(post.presetId);
      if (!preset) continue;
      (post.official ? officialGrid : communityGrid).appendChild(postCard(preset, post));
    }
    if (!officialGrid.children.length) officialGrid.innerHTML = '<p class="empty-inline">No official card in this collection yet.</p>';
    if (!communityGrid.children.length) communityGrid.innerHTML = '<p class="empty-inline">No community post in this collection yet.</p>';
  }
  draw();
}

function postCard(preset: Preset, post: MarketplacePost): HTMLElement {
  const card = document.createElement('article');
  card.className = 'card market-card';
  card.tabIndex = 0;
  const thumb = renderThumbnail(preset, 480, 270);
  thumb.className = 'card-thumb';
  card.appendChild(thumb);
  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = `
    <div class="post-author"><span class="post-avatar">${post.author.slice(0, 1)}</span><div><strong>${post.author}${post.official ? ' <b>Official</b>' : ''}</strong><small>${post.handle}</small></div><span class="post-likes">♡ ${post.likes}</span></div>
    <h2>${preset.name}</h2><p>${preset.description}</p>
    <div class="card-meta"><span class="chip">${post.collection.replace('-', ' ')}</span><span class="chip">${preset.scene.kind === 'renderer' ? 'procedural live' : 'coded source'}</span></div>`;
  card.appendChild(body);
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const remix = document.createElement('button');
  remix.className = 'primary';
  remix.textContent = 'Open in Labs';
  const open = () => navigate({ name: 'labs', presetId: preset.id, returnTo: 'marketplace' });
  remix.addEventListener('click', (event) => { event.stopPropagation(); open(); });
  actions.appendChild(remix);
  card.appendChild(actions);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => { if (event.key === 'Enter') open(); });
  return card;
}
