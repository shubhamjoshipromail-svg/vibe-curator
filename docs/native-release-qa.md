# Native release QA

The native smoke checks are intentionally deterministic and read-only:

```sh
npm run test:native
npm run check:native
```

`test:native` exercises the exact `vibecurator://open` activation parser. It
covers preset IDs, transfer tokens, malformed URLs, wrong hosts/schemes, and
the parser's precedence rule. `check:native` verifies the Tauri identifier and
scheme, confirms every curated marketplace score mapping points at a listed
post and an existing audio file, and reconciles the curated audio directory
with `public/audio/curated/pack.json`.

On macOS, request a LaunchServices inventory with:

```sh
npm run check:native -- --launchservices
```

The command reads the exact `com.vibecurator.player` registration and prints a
per-app `lsregister -u` cleanup command. It never runs unregister, `-kill`,
global domain cleanup, installation, or deployment. Review each printed path
before manually running a command; only a stale Vibe Curator app bundle should
be a target.
