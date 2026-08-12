import { listPresets } from '../preset/library';
import { renderThumbnail } from '../preset/thumbnail';
import type { Preset } from '../preset/types';
import { navigate } from './router';

export type MarketCollectionId = 'artist' | 'vibes' | 'nature' | 'electro-nature' | 'dark-fantasy';

export interface MarketplacePost {
  presetId: string;
  collection: MarketCollectionId;
  author: string;
  handle: string;
  official?: boolean;
  likes: number;
}

export const MARKET_POSTS: MarketplacePost[] = [
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

export const MARKET_COLLECTIONS: Array<{ id: MarketCollectionId; name: string; description: string }> = [
  { id: 'artist', name: 'Artist DNA', description: 'Musical and visual language, translated without copying a name.' },
  { id: 'vibes', name: 'Vibes After Dark', description: 'Atmosphere-first rooms for listening, focus and escape.' },
  { id: 'nature', name: 'Living Nature', description: 'Flowers, water and organic motion with responsive treatments.' },
  { id: 'electro-nature', name: 'Electro Nature', description: 'Natural subjects rebuilt as signal, light and motion.' },
  { id: 'dark-fantasy', name: 'Dark Fantasy Mixes', description: 'Firelit halls, ruins and other cinematic living worlds.' },
];

export function marketPresets(): Map<string, Preset> {
  return new Map(listPresets().map((preset) => [preset.id, preset]));
}

export function renderMarketPost(preset: Preset, post: MarketplacePost): HTMLElement {
  const card = document.createElement('article');
  card.className = 'card market-card';
  card.tabIndex = 0;
  const thumb = renderThumbnail(preset, 480, 270);
  thumb.className = 'card-thumb';
  card.appendChild(thumb);
  const body = document.createElement('div');
  body.className = 'card-body';
  const author = document.createElement('div');
  author.className = 'post-author';
  author.innerHTML = `<span class="post-avatar">${post.author.slice(0, 1)}</span><div><strong>${post.author}${post.official ? ' <b>Official</b>' : ''}</strong><small>${post.handle}</small></div><span class="post-likes">♡ ${post.likes}</span>`;
  const title = document.createElement('h2'); title.textContent = preset.name;
  const copy = document.createElement('p'); copy.textContent = preset.description;
  const meta = document.createElement('div'); meta.className = 'card-meta';
  meta.innerHTML = `<span class="chip">${post.collection.replace('-', ' ')}</span><span class="chip">${preset.scene.kind === 'renderer' ? 'procedural live' : 'coded source'}</span>`;
  body.append(author, title, copy, meta); card.appendChild(body);
  const actions = document.createElement('div'); actions.className = 'card-actions';
  const remix = document.createElement('button'); remix.className = 'primary'; remix.textContent = 'Open in Labs';
  const open = () => navigate({ name: 'labs', presetId: preset.id, returnTo: 'marketplace' });
  remix.addEventListener('click', (event) => { event.stopPropagation(); open(); });
  actions.appendChild(remix); card.appendChild(actions);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => { if (event.key === 'Enter') open(); });
  return card;
}
