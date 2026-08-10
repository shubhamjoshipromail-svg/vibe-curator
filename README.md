# Vibe Curator

> A room you can conjure.

```bash
npm install && npm run dev
```

Then open http://localhost:5178 and click **Begin session**. Audio needs that
first click; browsers require a gesture.

---

## The flow

**Explore → Labs → Player.** One renderer and one audio engine underneath all
three, so moving between them is a CSS change, not a reload — the room never
stops playing while you work on it.

- **Explore** — six rooms as cards with real previews, rendered from each
  preset's own painters and palette so a card always shows what you'll get.
  No prompt box here on purpose: a blank field as the first thing you see
  invites a weak first attempt, and a weak first impression is permanent.
- **Labs** — six controls named for feelings (Mood, Motion, Depth, Glow,
  Atmosphere, Intensity), the effect stack with per-effect parameter sliders,
  and the audio layers. Opening a built-in forks it, so the starting library
  can never be damaged.
- **Player** — the environment, with chrome that fades and a layer mixer that
  doesn't. Ambience and music are separate buses; either can be silenced
  without touching the other.

Saved rooms persist to localStorage and reappear in Explore tagged `yours` and
`remix`, with `parentId` recording where they came from.

## Layers

| Layer | What it is |
|---|---|
| Background visual | An archetype rig recoloured by the preset's palette |
| Effect | Generated GLSL shaders, stacked, each with its own controls |
| Ambience | Room tone, fire, wind — the sound of the place |
| Music | Bed and motifs — the sound of the mood |
| Theme | Accent colour carried from the palette |

## GEN-EFFECT

Describe an effect in the panel on the right; it is generated as a GLSL
fragment shader, validated, compiled, and applied to the live scene.

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY, then restart the dev server
```

Six effects ship built-in — real generations produced by `npm run gen:effects`
through the same prompt the product uses at runtime, so Explore has good content
instead of an empty gallery and a 40-second wait.

**Effects are editable, not one-shot.** Each generation also declares 2–4 named
parameters ("Drift Speed", "Caustic Sharpness", "Droplet Density") that become
sliders in Labs and retune the live shader without regenerating. The manifest
keeps the prompt, the params, the model and the lineage, so an effect can be
reopened, re-prompted, and remixed.

Generation takes 30–75 seconds. That is the main known weakness — see below.

**Why shaders and not JavaScript.** A fragment shader cannot reach the network,
the filesystem, or the DOM, so generated code needs no sandbox. The one real
risk — an unbounded loop hanging the GPU — is a static check, not a hope.

**Two gates, because neither is sufficient alone.** The static guard catches
what compiles fine and then hangs (unbounded loops). The compiler catches
syntax. A shader must pass both, and on failure the compiler log is fed back to
the model verbatim — precise, line-numbered feedback is why the retry converges.

**The language level is GLSL ES 1.00, not 3.00.** Pixi emits no `#version`
directive, so filter shaders compile as ES 1.00 even on a WebGL2 context; the
ES3-looking `in`/`out`/`texture()` syntax survives only via compatibility
defines. No integer `clamp`, no dynamic indexing, no `%`. The verifier
reproduces Pixi's exact preamble — an earlier version tested against
`#version 300 es` and passed shaders the renderer then refused.

**The key never reaches the browser.** Requests go to a same-origin proxy that
holds it server-side. Note `ANTHROPIC_API_KEY`, not `VITE_ANTHROPIC_KEY` — Vite
inlines `VITE_`-prefixed variables into the client bundle.

## Status

**Milestone 2 seams are in.** Real art and real audio can now be dropped in
without touching engine code, and a license gate blocks anything undocumented.
The content shipped here is still placeholder — see "Bring your own content".

## What this is

The backbone: an archetype rig, an animator library, a generative audio engine,
and three vibes that share all of it. **No AI generation anywhere**, and no art
or audio assets at all — every layer is drawn procedurally and every sound is
synthesized.

That is deliberate. It means the two questions worth answering can be answered
today, with nothing sourced and nothing licensed:

1. **Does subtle procedural motion actually feel alive?** If it reads as alive on
   placeholder art, real art can only improve it.
2. **Does the rig generalize, or is it a campfire-specific toy?** Three
   archetypes in three aesthetics, sharing one renderer, is the cheap test.

## The framing

The unit of value is **time spent inside a room**, not the artifact generated.
A scene identical at minute 40 is wallpaper; one where the light has changed is a
room. So the session arc is a first-class concept, not a later feature — see
`ArcSpec` in [src/types.ts](src/types.ts) and the two-clock tick in
[src/scene.ts](src/scene.ts).

Use the `120×` button to watch a 25-minute arc in 13 seconds. Evaluating a slow
idea in real time is how slow ideas go unevaluated.

## Layout

| Path | What it is |
|---|---|
| [src/types.ts](src/types.ts) | The vibe spec. The spine — everything downstream reads from this. |
| [src/archetypes.ts](src/archetypes.ts) | Slot rigs. Named slots + an animator each. |
| [src/animators/index.ts](src/animators/index.ts) | **The durable asset.** Written once, reused forever. |
| [src/scene.ts](src/scene.ts) | Renderer. Knows nothing about any specific scene. |
| [src/audio/engine.ts](src/audio/engine.ts) | Bed + textures + sparse randomized events. |
| [src/vibes/index.ts](src/vibes/index.ts) | The library. Three rooms. |
| [src/arc.ts](src/arc.ts) | Session arc shapes. Settle / steady / build / none. |
| [src/art/pack.ts](src/art/pack.ts) | Asset packs: load, trim to alpha, register. |
| [src/audio/pack.ts](src/audio/pack.ts) | Audio packs: sampled textures and instruments. |
| [src/art/painters.ts](src/art/painters.ts) | **Disposable.** Placeholder art, drawn in code. |
| [src/effects/harness.ts](src/effects/harness.ts) | GEN-EFFECT contract + static guard. |
| [src/effects/compile.ts](src/effects/compile.ts) | Shader verification. Must match Pixi's preamble exactly. |
| [src/effects/generate.ts](src/effects/generate.ts) | The self-healing generation loop. |
| [server/gen-shader.ts](server/gen-shader.ts) | Key-holding proxy. Becomes a Worker or desktop process later. |
| [scripts/check-licenses.mjs](scripts/check-licenses.mjs) | Build gate. Fails on any asset without a license row. |

## Bring your own content

Both seams work the same way: a pack declares named entries, anything it
provides wins, anything it omits falls back to the procedural/synthesized
version. **Partial packs are the normal case** — that is also what per-slot
reroll will look like later.

**Art** — drop images in `public/packs/<your-pack>/` with a `pack.json`, then set
`pack` on the vibe. Every asset is trimmed to its alpha bounding box on load and
positioned by the slot's anchor, so source padding does not matter and sprites
from unrelated sources still stand on the same floor.

**Audio** — same shape in `public/audio/<your-pack>/`. Textures pick a
`loop_mode`: `player` preserves transients (fire, rain), `granular` is seamless
on material never prepared for looping (room tone, wind). Instruments are
note-name → file maps for `Tone.Sampler`.

Run `npm run gen:fixtures` to regenerate the placeholder pack, and
`npm run check:licenses` to validate. **Only CC0 or public domain passes.**
"Royalty-free" is deliberately rejected — many such licenses forbid exactly this
kind of redistribution.

## As an actual wallpaper

```bash
npm run build && npm run preview
```

Then point [Plash](https://sindresorhus.com/plash) at `http://localhost:5179`.
Zero code, and it answers the "is this actually a wallpaper" question far faster
than a native shell would. On Windows, point Lively at the built `dist/`.

## Three decisions worth knowing about

**The arc is not a decay.** It settles, holds a long breathing plateau, revives
around 75%, and only then winds down. A monotonic fade reads as "the fire is
dying"; the revival is what makes the ending feel chosen rather than inevitable.
See [src/arc.ts](src/arc.ts).


**Quantization applies to material, not light.** Every pixel-art layer is snapped
to `palette.ramp`, which is what makes independently-produced layers look like
one scene. But quantizing an additive glow turns its falloff into a hard-edged
disc — so light layers opt out. See `bake()`.

**Render style is per-vibe, not global.** `internal` resolution and
nearest-vs-linear filtering live on the vibe spec. Pixel art is a style this can
render, not the identity of the product.

## Known weakness

**Effect generation takes 30–75 s.** Labs shows a live counter rather than a
spinner that lies, but this needs a real job queue — queued → generating → ready
— so a generation runs in the background while you keep working. That same queue
is what image, video and music generation will need, so it isn't effect-specific
plumbing.

## Not built yet, on purpose

- Image/video generation. The provider seam is designed but nothing is wired;
  fal.ai is the recommended first provider (queue-first, webhooks).
- Music generation. Lyria 3 via the Gemini API is the recommendation — it does
  image→music, which fits "generate audio matching this scene" directly.
- A job queue with persistent results.
- Spotify. Their terms prohibit synchronizing recordings with visual media,
  which is exactly this product. System-audio loopback is the better path.
- Tauri / native shell. Needs a Rust toolchain; Plash answers the same question
  for now at zero cost.
- `rain` and `snow` animators — the next two to add.
- Save/name a vibe, and the seed-based reroll the seeded RNG already allows for.
