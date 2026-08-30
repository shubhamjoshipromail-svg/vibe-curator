import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('web, native and Rust release versions remain aligned', () => {
  const packageJson = JSON.parse(read('package.json')) as { version: string };
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json')) as { version: string };
  const cargoVersion = read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"$/m)?.[1];
  assert.equal(packageJson.version, '0.1.1');
  assert.equal(tauri.version, packageJson.version);
  assert.equal(cargoVersion, packageJson.version);
});

test('first-page Chrome action uses the stable published extension identity', () => {
  const account = read('src/auth/account.ts');
  assert.match(account, /chromewebstore\.google\.com\/detail\/vibe-curator\/niamjnjkmfnlpcejieffodipboacfdnm/);
  assert.match(account, /aria-label="Add Vibe Curator to Chrome"/);
  assert.match(account, /target="_blank" rel="noreferrer"/);
  assert.match(account, /<span>Chrome<\/span>/);
});

test('desktop page uses the stable native-releases channel and preserves the Gatekeeper warning', () => {
  const legal = read('src/app/legal.ts');
  assert.match(legal, /NATIVE_RELEASES_URL = 'https:\/\/github\.com\/shubhamjoshipromail-svg\/vibe-curator\/releases'/);
  assert.match(legal, /Download latest technical beta/);
  assert.match(legal, /ad-hoc signed rather than notarized by Apple/);
  assert.match(legal, /Unnotarized technical-tester build/);
  assert.match(legal, /Gatekeeper will block the first normal launch/);
  assert.doesNotMatch(legal, /beta\.3|Beta 3/);
});

test('native beta packaging is pinned to a checked arm64 source and a Beta 4 technical-tester artifact', () => {
  const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const packaging = read('scripts/package-native-beta.mjs');
  assert.equal(packageJson.scripts['package:native-beta'], 'node scripts/package-native-beta.mjs');
  assert.match(packaging, /const BETA = 4/);
  assert.match(packaging, /const ARCHITECTURE = 'arm64'/);
  assert.match(packaging, /const SOURCE_ARCHITECTURE = 'aarch64'/);
  assert.match(packaging, /Vibe-Curator-\$\{releaseVersion\}-\$\{ARCHITECTURE\}-technical-tester-unnotarized\.dmg/);
  assert.match(packaging, /embedded app version/);
  assert.match(packaging, /lipo', \['-archs'/);
  assert.match(packaging, /codesign', \['--verify', '--deep', '--strict'/);
  assert.match(packaging, /refusing to overwrite an existing release artifact/);
});

test('native publication happens before a frontend deploy', () => {
  const runbook = read('docs/beta-launch-runbook.md');
  const build = runbook.indexOf('Build and checksum the native technical-tester DMG');
  const publish = runbook.indexOf('Create the GitHub prerelease and upload both native files');
  const verify = runbook.indexOf('Verify the uploaded DMG and checksum from the GitHub release page');
  const deploy = runbook.indexOf('Deploy the frontend only after that verification');
  assert.ok(build >= 0 && publish > build && verify > publish && deploy > verify);
});

test('Labs does not interpolate user or provider labels into HTML', () => {
  const labs = read('src/app/labs.ts');
  for (const unsafe of [
    'value="${draft.name}"', '<strong>${source.name}</strong>',
    '<strong>${draft.scene.label}</strong>',
    '<span>${fx.name}</span>', '<p class="fx-notes">${fx.notes}</p>',
    '<textarea rows="2">${fx.prompt}</textarea>', '<label>${p.label}</label>',
  ]) assert.equal(labs.includes(unsafe), false, unsafe);
});

test('beta entry requires explicit acceptance on both client and server', () => {
  const main = read('src/main.ts');
  const client = read('src/auth/client.ts');
  const privacy = read('server/privacy.ts');
  assert.match(main, /if \(!accept\.checked\)/);
  assert.match(main, /acknowledgeBetaTerms\(policyVersion, true\)/);
  assert.match(main, /localStorage\.getItem\(`vibe\.policy\.\$\{policyVersion\}`\)/);
  assert.match(client, /JSON\.stringify\(\{ policyVersion, accepted \}\)/);
  assert.match(privacy, /POLICY_VERSION = '2026-08-29-beta'/);
  assert.match(privacy, /body\.accepted !== true \|\| body\.policyVersion !== POLICY_VERSION/);
});

test('Labs exposes Chrome handoff and no longer opens the standalone Mac controls window', () => {
  const labs = read('src/app/labs.ts');
  assert.match(labs, /id="display-chrome">Send to Chrome/);
  assert.match(labs, /setAsChromeVibe\(commit\(\)\)/);
  assert.doesNotMatch(labs, /mac-controls|vibecurator:\/\/controls/);
});
