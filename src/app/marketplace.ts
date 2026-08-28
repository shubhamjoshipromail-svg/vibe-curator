import { listPresets } from '../preset/library';
import { renderThumbnail } from '../preset/thumbnail';
import type { Preset } from '../preset/types';
import { navigate } from './router';
import { setAsChromeVibe } from '../runtime/chrome-handoff';

export type MarketCollectionId = 'pixel-art' | 'cozy-dark-fantasy' | 'conceptual-sketch' | 'japandi' | 'synthwave' | 'aurora' | 'mystical-western' | 'art-deco' | 'bauhaus' | 'art-nouveau' | 'wabi-sabi' | 'neo-brutalism' | 'risograph' | 'paper-cut' | 'cyanotype' | 'stained-glass' | 'surreal-collage' | 'mid-century' | 'living-scenes';

export interface MarketCollection {
  id: MarketCollectionId;
  name: string;
  description: string;
  mood: string;
  /** Locked visual grammar; user content is prepended through buildStylePrompt. */
  stylePrompt?: string;
}

export interface MarketplacePost {
  presetId: string;
  collection: MarketCollectionId;
  variant: string;
  author: string;
  handle: string;
  official?: boolean;
  likes: number;
}

export const MARKET_POSTS: MarketplacePost[] = [
  { presetId: 'market-pixel-last-broadcast', collection: 'pixel-art', variant: 'Curator Edition', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 1384 },
  { presetId: 'market-pixel-midnight-shrine', collection: 'pixel-art', variant: 'Midnight Shrine', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 928 },
  { presetId: 'market-pixel-lantern-save', collection: 'pixel-art', variant: 'Lantern Save', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 711 },
  { presetId: 'market-cozy-gatehouse-rest', collection: 'cozy-dark-fantasy', variant: 'Illustrated Still', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 1187 },
  { presetId: 'market-living-ember-throne', collection: 'cozy-dark-fantasy', variant: 'Living Firelight', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 947 },
  { presetId: 'market-sketch-rain-table', collection: 'conceptual-sketch', variant: 'Rain Table', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 583 },
  { presetId: 'market-sketch-green-note', collection: 'conceptual-sketch', variant: 'Green Note', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 446 },
  { presetId: 'market-aurora-stillwater', collection: 'aurora', variant: 'Stillwater', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 864 },
  { presetId: 'market-aurora-night-current', collection: 'aurora', variant: 'Night Current', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 612 },
  { presetId: 'market-japandi-blue-hour', collection: 'japandi', variant: 'Blue Hour', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 735 },
  { presetId: 'market-japandi-warm-stillness', collection: 'japandi', variant: 'Warm Stillness', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 493 },
  { presetId: 'market-western-moon-ritual', collection: 'mystical-western', variant: 'Moon Ritual', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 1093 },
  { presetId: 'market-western-dust-signal', collection: 'mystical-western', variant: 'Dust Signal', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 527 },
  { presetId: 'market-deco-emerald-midnight', collection: 'art-deco', variant: 'Emerald Midnight', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 947 },
  { presetId: 'market-deco-golden-hour', collection: 'art-deco', variant: 'Golden Afterglow', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 684 },
  { presetId: 'market-synthwave-observatory', collection: 'synthwave', variant: 'Night Observatory', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 1218 },
  { presetId: 'market-synthwave-coastal-drive', collection: 'synthwave', variant: 'Coastal Drive', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 876 },
  { presetId: 'market-bauhaus-pavilion', collection: 'bauhaus', variant: 'Primary Pavilion', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 744 },
  { presetId: 'market-art-nouveau-conservatory', collection: 'art-nouveau', variant: 'Moon Conservatory', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 831 },
  { presetId: 'market-wabi-sabi-rain-bowl', collection: 'wabi-sabi', variant: 'Rain Bowl', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 629 },
  { presetId: 'market-neo-brutalist-playground', collection: 'neo-brutalism', variant: 'Raw Playground', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 706 },
  { presetId: 'market-risograph-hill-ride', collection: 'risograph', variant: 'Hill Ride', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 778 },
  { presetId: 'market-paper-cut-fox-valley', collection: 'paper-cut', variant: 'Fox Valley', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 694 },
  { presetId: 'market-cyanotype-coast', collection: 'cyanotype', variant: 'Botanical Coast', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 651 },
  { presetId: 'market-stained-glass-heron', collection: 'stained-glass', variant: 'Heron Sunrise', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 902 },
  { presetId: 'market-surreal-collage-door', collection: 'surreal-collage', variant: 'Ocean Door', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 856 },
  { presetId: 'market-mid-century-lake-house', collection: 'mid-century', variant: 'Lake House', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 811 },
  { presetId: 'market-living-color-orbit', collection: 'living-scenes', variant: 'Reactive Bloom', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 864 },
  { presetId: 'market-living-midnight-haze', collection: 'living-scenes', variant: 'Shader Atmosphere', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 612 },
  { presetId: 'market-living-neon-koi', collection: 'living-scenes', variant: 'Tracked Motion', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 1093 },
  { presetId: 'market-living-ember-throne', collection: 'living-scenes', variant: 'Pixel Renderer', author: 'Vibe Curator', handle: '@vibecurator', official: true, likes: 947 },
];

export const MARKET_COLLECTIONS: MarketCollection[] = [
  { id: 'pixel-art', name: 'Pixel Art', description: 'True low-resolution scenes built from hard-edged color clusters.', mood: '16-bit · Nostalgic', stylePrompt: 'Authentic hand-authored 16-bit pixel art on a strict 480×270 conceptual grid; large intentional pixel clusters, hard aliased edges, stepped curves, indexed-looking 24-color palette with hue-shifted ramps, selective ordered dithering only at field transitions. Pixels travel in clusters; avoid accidental jaggies, banding, pillow shading, random pixel noise, smooth gradients, antialiasing, photorealism and faux pixel filters.' },
  { id: 'cozy-dark-fantasy', name: 'Cozy Dark Fantasy', description: 'Weathered medieval shelters where firelight makes the dangerous world feel briefly safe.', mood: 'Sheltered · Medieval', stylePrompt: 'Authentic hand-authored 16-bit/32-bit-era medieval dark-fantasy pixel illustration designed on a strict 480×270 conceptual grid; crisp square pixels and intentional clusters; readable large silhouettes; dark ink-like one-to-three-pixel outlines; limited earthy palette with carefully hue-shifted ramps; one warm amber or copper practical light against cool indigo-blue exterior shadows; rich but economical texture in stone, aged timber, worn leather, cloth and wet metal; intimate shelter composition with foreground, midground and background separated by value; selective ordered or stylized dithering only in broad shadow transitions; restrained highlights on firelit and wet edges. Keep the scene quiet, humane and mysterious rather than heroic. Avoid text, dialogue boxes, UI, logos, watermarks, recognizable heraldry or characters, photorealism, smooth painterly rendering, 3D, vector art, blur, random single-pixel noise, generic neon magic and faux pixel filters.' },
  { id: 'conceptual-sketch', name: 'Conceptual Sketch', description: 'Loose ink, imperfect lines and tactile editorial observations.', mood: 'Raw · Human', stylePrompt: 'Rough observational black brush-pen and pencil drawing on warm uncoated paper; spontaneous imperfect line weight, sparse crosshatching, visible paper grain, one restrained accent color, editorial negative space. Avoid clean vector lines, polished digital illustration, glossy gradients, fake lettering and photorealism.' },
  { id: 'japandi', name: 'Japandi', description: 'Flat organic geometry, quiet print texture and considered space.', mood: 'Calm · Editorial', stylePrompt: 'Japandi editorial illustration: flat screen-printed organic geometry, warm ivory fibrous paper, charcoal navy, muted sage, clay terracotta and taupe, asymmetric balanced composition, generous negative space, subtle ink misregistration. Avoid photographic interiors, glossy gradients, clutter and generic zen decoration.' },
  { id: 'synthwave', name: 'Synthwave', description: 'Airbrushed horizons, neon grids and VHS-era night color.', mood: 'Retro · Electric', stylePrompt: 'Authentic 1980s synthwave album-cover illustration: airbrushed poster art, strong horizon, sunset disc, wireframe geometry, midnight purple, electric magenta, hot coral and cyan, subtle halftone and VHS print grain. Avoid generic cyberpunk alleys, modern sci-fi clutter, glossy 3D and fake text.' },
  { id: 'aurora', name: 'Aurora', description: 'Iridescent light, glassy horizons and slow ambient color.', mood: 'Dreamy · Meditative', stylePrompt: 'Refined ambient digital art with flowing iridescent light ribbons, translucent organic waves, deep midnight ground, emerald cyan violet and restrained rose, soft luminous depth and generous calm negative space. Avoid busy detail, hard borders, readable symbols and oversaturation.' },
  { id: 'mystical-western', name: 'Mystical Western', description: 'Desert folklore, celestial geometry and midnight dust.', mood: 'Rugged · Spiritual', stylePrompt: 'Cinematic fine-art western folklore landscape with tactile film grain, sandstone and tobacco earth, midnight indigo sky, restrained celestial geometry and quiet surrealism. Avoid kitschy cowboy props, obvious tarot cards, neon and crowded occult symbols.' },
  { id: 'art-deco', name: 'Art Deco', description: 'Geometric glamour, lacquered darks and precise gold light.', mood: 'Glamorous · Jazzy', stylePrompt: '1920s Art Deco architectural illustration: monumental symmetry, streamlined arches, stepped geometry, black lacquer, antique gold, smoked glass, jewel-tone accents and precise reflections. Avoid casino clichés, excessive ornament, generic luxury hotels and modern minimalism.' },
  { id: 'bauhaus', name: 'Bauhaus', description: 'Functional geometry, primary color and disciplined visual rhythm.', mood: 'Rational · Bold', stylePrompt: 'Authentic Bauhaus graphic composition: strict asymmetric grid, primary red blue yellow with black and warm white, circles rectangles and diagonal bars, flat screen-print ink, functional modernist clarity and strong negative space. Avoid gradients, decorative excess, photorealism and 3D gloss.' },
  { id: 'art-nouveau', name: 'Art Nouveau', description: 'Botanical linework and flowing ornamental structure.', mood: 'Organic · Poetic', stylePrompt: 'Authentic Art Nouveau decorative illustration: whiplash curves, integrated botanical linework, elegant flat depth, stained-ink poster texture, muted olive teal cream and copper. Avoid modern vector minimalism, photorealism, 3D and disconnected ornament.' },
  { id: 'wabi-sabi', name: 'Wabi-Sabi', description: 'Quiet imperfection, honest materials and generous emptiness.', mood: 'Tactile · Still', stylePrompt: 'Wabi-sabi fine-art photography: asymmetry, emptiness, honest wear, imperfect handmade materials, muted earth color, soft natural light, tactile grain and restrained composition. Avoid glossy perfection, styled luxury clutter, saturated color and artificial polish.' },
  { id: 'neo-brutalism', name: 'Neo-Brutalism', description: 'Raw outlines, hard shadows and unapologetic color.', mood: 'Loud · Playful', stylePrompt: 'Neo-brutalist editorial graphic design: huge flat color blocks, thick black outlines, intentionally awkward geometry, hard offset shadows, acid accents and raw playful hierarchy. Avoid smooth gradients, elegant minimalism, photorealism and glossy 3D.' },
  { id: 'risograph', name: 'Risograph', description: 'Limited inks, tactile halftones and joyful misregistration.', mood: 'Printed · Energetic', stylePrompt: 'Authentic two-color risograph print on warm recycled paper; visible halftone dots, overprint color, imperfect registration, simplified hand-cut silhouettes and energetic editorial composition. Avoid smooth gradients, full-color digital painting, perfect alignment and photorealism.' },
  { id: 'paper-cut', name: 'Paper Cut', description: 'Layered cardstock worlds with physical depth and shadow.', mood: 'Crafted · Storybook', stylePrompt: 'Hand-crafted layered paper-cut diorama: clearly cut cardstock edges, six to eight depth planes, gentle physical cast shadows, limited harmonious palette, tactile fibers and clean storybook silhouettes. Avoid plastic CGI, smooth digital vectors, photorealism and excessive tiny detail.' },
  { id: 'cyanotype', name: 'Cyanotype', description: 'Prussian-blue photographic impressions on handmade paper.', mood: 'Botanical · Archival', stylePrompt: 'Authentic cyanotype photogram: Prussian blue field, sun-exposed white silhouettes, uneven chemical edges, watercolor wash variation, handmade paper grain and sparse museum-quality composition. Use blue and paper white only; avoid digital glow, smooth gradients and conventional photography.' },
  { id: 'stained-glass', name: 'Stained Glass', description: 'Jewel-toned glass shaped by strong lead linework.', mood: 'Luminous · Sacred', stylePrompt: 'Authored stained-glass artwork: bold lead-came outlines, individually shaped translucent glass pieces, jewel-tone cobalt amber ruby and emerald, luminous backlighting, controlled geometric segmentation, handcrafted bubbles and texture. Avoid cathedral architecture unless requested, smooth digital gradients and photorealism.' },
  { id: 'surreal-collage', name: 'Surreal Collage', description: 'Poetic scale shifts assembled from tactile found fragments.', mood: 'Analog · Uncanny', stylePrompt: 'Analog surrealist collage: cut vintage photographic fragments, torn paper edges, mismatched scale, aged magazine grain, restrained palette and poetic negative space. Avoid smooth digital painting, seamless compositing, 3D rendering, crowded symbolism and fake text.' },
  { id: 'mid-century', name: 'Mid-Century Modern', description: 'Flat gouache shapes and optimistic atomic-age composition.', mood: 'Warm · Graphic', stylePrompt: 'Mid-century modern editorial illustration: flat gouache shapes, simplified forms, boomerang and atomic-age geometry, textured paper, mustard avocado teal burnt orange and charcoal, elegant 1950s travel-poster composition. Avoid photorealism, glossy 3D, modern gradients and text.' },
  { id: 'living-scenes', name: 'Living Scenes', description: 'Original coded worlds that start still and become generative only when you add motion.', mood: 'Still first · Generative' },
];

export function buildStylePrompt(collection: MarketCollection, values: { subject: string; setting: string; time: string; weather: string; mood: string }): string {
  return `Create ${values.subject || 'an original scene'}${values.setting ? ` in ${values.setting}` : ''}. Time of day: ${values.time || 'artist choice'}. Weather/atmosphere: ${values.weather || 'artist choice'}. Desired mood: ${values.mood || collection.mood}. Fixed visual style: ${collection.stylePrompt} Full-screen 16:9 background; no text, logo, watermark or UI.`;
}

export function marketPresets(): Map<string, Preset> {
  return new Map(listPresets().map((preset) => [preset.id, preset]));
}

let activeScore: HTMLAudioElement | undefined;
let activeScoreButton: HTMLButtonElement | undefined;

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
  author.innerHTML = `<span class="post-avatar">${post.author.slice(0, 1)}</span><div><strong>${post.author}${post.official ? ' <b>Curated</b>' : ''}</strong><small>${post.handle}</small></div><span class="post-likes">♡ ${post.likes}</span>`;
  const title = document.createElement('h2'); title.textContent = preset.name;
  const copy = document.createElement('p'); copy.textContent = preset.description;
  const meta = document.createElement('div'); meta.className = 'card-meta';
  const coded = preset.scene.kind === 'renderer' || preset.scene.kind === 'procedural';
  meta.innerHTML = `<span class="chip">${post.variant}</span><span class="chip">${coded ? 'still coded scene' : 'static scene'}</span><span class="chip">${preset.music ? 'authored score' : 'procedural score'}</span>`;
  body.append(author, title, copy, meta); card.appendChild(body);
  const actions = document.createElement('div'); actions.className = 'card-actions';
  const remix = document.createElement('button'); remix.className = 'primary'; remix.textContent = 'Open & remix';
  const open = () => navigate({ name: 'labs', presetId: preset.id, returnTo: 'marketplace' });
  remix.addEventListener('click', (event) => { event.stopPropagation(); open(); });
  actions.appendChild(remix);
  const chromeButton = document.createElement('button');
  const chromeStatus = document.createElement('span');
  chromeButton.className = 'ghost';
  chromeButton.textContent = 'Set as Chrome Vibe';
  chromeStatus.className = 'chrome-handoff-status';
  chromeStatus.setAttribute('role', 'status');
  chromeButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    chromeButton.disabled = true;
    chromeStatus.textContent = 'Contacting the extension…';
    const result = await setAsChromeVibe(preset);
    chromeButton.textContent = result.ok ? 'Chrome Vibe set' : 'Set as Chrome Vibe';
    chromeStatus.textContent = result.message;
    chromeButton.disabled = false;
  });
  actions.append(chromeButton, chromeStatus);
  if (preset.music?.url) {
    const preview = document.createElement('button');
    preview.className = 'ghost';
    preview.textContent = '▶ Preview score';
    preview.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (activeScore && activeScoreButton === preview && !activeScore.paused) {
        activeScore.pause();
        preview.textContent = '▶ Preview score';
        return;
      }
      activeScore?.pause();
      if (activeScoreButton) activeScoreButton.textContent = '▶ Preview score';
      const score = new Audio(preset.music!.url!);
      score.loop = true;
      score.volume = 0.72;
      activeScore = score;
      activeScoreButton = preview;
      score.addEventListener('error', () => { preview.textContent = 'Score unavailable'; }, { once: true });
      await score.play();
      preview.textContent = 'Ⅱ Pause score';
    });
    actions.appendChild(preview);
  }
  card.appendChild(actions);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => { if (event.key === 'Enter') open(); });
  return card;
}
