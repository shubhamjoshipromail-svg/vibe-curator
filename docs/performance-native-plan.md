# Performance and native delivery plan

## What was making the current app heavy

The primary bottleneck is local rendering, not project storage or API latency:

1. Pixi rendered at display rate on every route, including Explore where the scene was mostly hidden.
2. Explore applied a full-viewport CSS blur to the animated WebGL canvas, forcing continuous recompositing.
3. Transparent cards used backdrop blur over that same moving canvas.
4. Procedural card thumbnails were regenerated repeatedly during Library redraws.
5. GPU textures and filters were detached but not explicitly released when switching scenes/effects.
6. Tone.js was part of the initial bundle even though sound is user-initiated.
7. Animation and audio analysis continued while the document was hidden.

## Runtime policy

- Explore: 15 fps background renderer. The visible product UI remains full-rate.
- Labs: 30 fps renderer for responsive editing.
- Player: 60 fps and full visual quality.
- Hidden document: renderer, uploaded video and audio-analysis polling pause.
- Sound: Tone.js loads only when the user explicitly starts sound.
- Thumbnails: deterministic procedural renders are cached with a bounded memory budget.
- Scene changes: old scene textures and filter resources are explicitly destroyed.

This policy changes invisible or obscured work, not authored output. Player remains the quality reference.

## Native recommendation

Use **Tauri 2 as the first native shell** around the existing TypeScript renderer.

- It preserves the current WebGL/Pixi effect system and the browser-based creation UI.
- The native layer should own filesystem access, media import/export, secure API-key storage,
  sleep/wake lifecycle, system audio permissions and optional wallpaper/window integration.
- Keep the renderer behind the existing `Scene` interface. A future Rust/WGPU renderer can replace
  it only if profiling proves WebView/WebGL is the remaining limit; do not rewrite it pre-emptively.
- Add a native render/export worker separately from the interactive preview. Export can render at
  fixed quality without making the editor compete for the same frame budget.

## Railway and database boundary

Railway is useful for work that should not run in the interactive render loop:

- generation API proxy and secret isolation;
- long-running image/video/music jobs with progress and retries;
- user accounts, marketplace posts and project metadata;
- signed object-storage URLs and synchronization.

A database will not improve WebGL frame time. Store metadata in Postgres and large images, audio and
video in object storage rather than database rows. Keep local-first project and asset caches so the
native app opens and plays without a network round trip.

## Next measurements

Before any renderer rewrite, capture on representative desktop hardware:

- Player FPS and frame-time p50/p95 for renderer, uploaded image and uploaded video scenes;
- GPU memory after 20 scene switches;
- CPU usage in Explore, Labs, Player and a hidden window;
- tracking analysis time and canvas-to-texture upload time;
- time-to-interactive before and after the lazy audio chunk.

Those measurements decide whether the next optimization belongs in Canvas tracking, shader passes,
media decode, or the host WebView.
