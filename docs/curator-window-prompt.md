# Prompt for an isolated Curator Editions task

Start this in a separate Codex worktree/branch named
`codex/curator-editions-beta` so it cannot change the active auth/billing work.

```text
Create a beta content pack of five original “Vibe Curator Originals” inspired
only by the broad qualities of cozy pixel-art destinations: deliberate 16/32-bit
clusters, cool night environments, small warm practical lights, solitude,
shelter and discovery. Do not copy the supplied Instagram screenshots, their
compositions, names, characters, captions, or account branding.

Use the imagegen skill and create original 16:9 masters for:
1. The Rain Archive — sheltered book archive, rain and amber windows.
2. Moonwell Ruins — ancient water court, moon reflection and candles.
3. Lantern Quarter — descending night market and suspended lanterns.
4. Northglass Observatory — mountain study, telescope, aurora and fire.
5. The Last Crossing — old bridge, dark river, fireflies and one distant lamp.

Work only in:
- public/market/curator-beta/
- docs/curator-beta/

Do not edit package files, server files, src files, Railway configuration, or
existing Market assets. For every edition, save:
- one optimized widescreen master image;
- prompt/provenance JSON;
- a Living Still direction JSON describing 1–3 subtle localized effects;
- an ambience brief using rain, water, fire, wind, room tone, sparse chimes or
  other non-musical textures;
- title, one-sentence description, mood tags and accessibility alt text.

Do not generate ElevenLabs music. Its current self-serve terms prohibit
commercial music libraries, and the configured key is invalid. Ambience briefs
must be fulfilled later with owned, commissioned, CC0, or explicitly licensed
sound assets. Run image optimization and provide a manifest, but leave code
integration to the main task. Commit only your two allowed directories.
```
