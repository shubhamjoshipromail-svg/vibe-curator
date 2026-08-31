# Vibe Curator for Chrome

This directory is an isolated Manifest V3 companion to the Vibe Curator website. It replaces Chrome's New Tab page with the selected scene, exposes play/pause and master volume in the toolbar popup, and keeps user-enabled audio in an offscreen document when the New Tab closes.

**Current published release:** [`0.1.1` on the Chrome Web Store](https://chromewebstore.google.com/detail/vibe-curator/niamjnjkmfnlpcejieffodipboacfdnm) (item ID `niamjnjkmfnlpcejieffodipboacfdnm`). Source version `0.2.0` is the next store candidate.

The toolbar also has a master **Vibe** switch and an opt-in **Google Search** switch. Google access is requested only when that feature is enabled. The background script is then registered only for `https://www.google.com/search*`; it does not run on Gmail, Drive, Google Account pages, or unrelated websites.

## Build, test, and package

Requires Node.js 20 or newer.

```sh
npm ci
npm run verify
npm run package
```

- `npm run verify` runs strict TypeScript checks, unit/manifest tests, and a production build.
- `npm run build` writes the unpacked extension to `dist/`.
- `npm run package` creates a reproducible store-ready zip under `artifacts/`.

The extension is intentionally separate from the website's Vite build and server dependencies.

## Load the unpacked extension

1. Run `npm ci && npm run build` in this directory.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this directory's `dist/` folder.
5. Open a New Tab. Chrome will warn if another extension already controls New Tab; only one override can be active.
6. Click **Enable sound** once in the New Tab or popup. The website is never allowed to unlock or autoplay sound.

To restore Chrome's default New Tab, disable or remove Vibe Curator at `chrome://extensions`.

## Connect the website

Chrome assigns an ID after the extension is loaded or published. Production builds default to the published Vibe Curator item. To test an unpacked build with a different ID, override it in the website build environment:

```sh
VITE_CHROME_EXTENSION_ID=niamjnjkmfnlpcejieffodipboacfdnm
```

Rebuild the website. Its **Set as Chrome Vibe** action sends a versioned request and displays success only after the extension validates the preset, updates active audio when needed, commits `chrome.storage.local`, and returns a matching acknowledgement.

Unpacked IDs are suitable for local testing but may differ across machines or paths.

The stable production item URL is used by the website's Chrome button. It serves the latest approved version without requiring a website link change for every extension update.

## Architecture and safety boundary

- `service-worker.ts` is the authoritative coordinator. It validates requests, serializes updates, controls the offscreen document, and commits versioned state.
- `offscreen.ts` is the only persistent audio owner. It acknowledges play, pause, track, and volume changes after they take effect.
- `newtab.ts` and `popup.ts` are thin clients. Closing either does not own or stop audio.
- `core.ts` contains the shared data contract and strict runtime validators.

The external payload is a safe projection of the website preset—not the full application document. It rejects unknown fields, raw effects/GLSL, private `assetId` values, video, `blob:`/`data:` URLs, arbitrary hosts, unsafe paths, non-finite controls, invalid colors, oversized strings, and unsupported scene/source identifiers.

## Permissions and privacy

| Manifest entry | Why it is needed |
| --- | --- |
| `storage` | Persists the selected scene, first-use sound state, play/pause, volume, revision, and update time on this Chrome profile. |
| `offscreen` | Hosts audio after a New Tab or popup closes; service workers do not have DOM audio APIs. |
| `scripting` | Registers or removes the packaged Google Search background script after the user changes the Search toggle. It does not execute arbitrary or remotely hosted code. |
| Optional `https://www.google.com/*` | Requested at runtime only when the user enables the Google Search background. The registered script itself is restricted to `/search` result pages. |
| `externally_connectable` | Allows messages only from `https://vibe-curator-production.up.railway.app/*`. The worker re-checks the sender's exact origin. |

The extension has no `tabs`, `activeTab`, history, web-navigation, or broad host permission. The optional Google Search content script changes page presentation only; it does not read, retain, or transmit search queries or result content. It does not collect analytics or send browsing data.

Curated image and MP3 media may load from the exact first-party Vibe Curator production origin. The manifest CSP allows that origin only for images and audio. All JavaScript, HTML, and CSS execute from the installed package; remote executable code, `eval`, and inline scripts are not allowed.

State remains in `chrome.storage.local` until the extension is removed or its storage is cleared. Website handoffs contain only the selected curated/coded scene projection. They do not contain account data, prompts, private uploads, or local asset identifiers.

## Manual release checks

- Inspect `dist/manifest.json`: only `storage` and `offscreen` permissions are present.
- Open a New Tab and confirm the scene renders with no console/CSP errors.
- Confirm no sound starts before the explicit **Enable sound** click.
- Enable sound, close the New Tab, and confirm it continues; pause and change volume from the popup.
- Restart Chrome and confirm scene/playback settings hydrate from storage without bypassing first-use sound state.
- Confirm the extension-owned New Tab keeps Gmail, Images, Google Apps, and Account equivalents accessible. Treat Chrome-owned footer and customization UI as browser settings, not extension DOM.
- From the production site, apply a curated image/score and a coded scene; confirm real success and negative responses.
- Confirm a copied request from any other origin is rejected.
- Turn **Vibe** off and confirm audio stops, Search styling disappears, and New Tab shows the disabled state.
- Enable **Google Search**, grant the one-site prompt, and confirm the background appears on `/search` while Gmail, Drive, and non-Google pages remain untouched.
- Disable the network: coded scenes and synthesized fallback audio should still work; first-party curated media needs the network.
