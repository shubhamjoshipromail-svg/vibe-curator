# Native release QA

## Current beta artifact

The current technical-tester release is [Vibe Curator `0.1.1` Beta 3](https://github.com/shubhamjoshipromail-svg/vibe-curator/releases/tag/v0.1.1-beta.3) for Apple-silicon Macs. The DMG is ad-hoc signed with the hardened runtime and is not notarized. Its release includes a `.sha256` companion file. Gatekeeper rejection on a normal first launch is expected until a Developer ID Application certificate is available and the artifact is notarized/stapled.

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

For a release candidate, also verify the built application and expected distribution status:

```sh
codesign --verify --deep --strict --verbose=2 "src-tauri/target/release/bundle/macos/Vibe Curator.app"
codesign -dvvv "src-tauri/target/release/bundle/macos/Vibe Curator.app"
spctl --assess --type execute --verbose=4 "src-tauri/target/release/bundle/macos/Vibe Curator.app"
xcrun stapler validate "src-tauri/target/release/bundle/macos/Vibe Curator.app"
```

For Beta 3, `codesign --verify` must pass, the signature reports `adhoc` with no Team ID, and `spctl`/`stapler` must report rejection/no ticket. Do not describe that result as generally signed or notarized.
