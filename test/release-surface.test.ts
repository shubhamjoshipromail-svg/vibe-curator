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

test('desktop page targets the reviewed Beta 2 artifact and warns about Gatekeeper', () => {
  const legal = read('src/app/legal.ts');
  assert.match(legal, /NATIVE_RELEASE_TAG = 'v0\.1\.1-beta\.2'/);
  assert.match(legal, /Vibe-Curator-0\.1\.1-beta\.2-arm64-unnotarized\.dmg/);
  assert.match(legal, /Gatekeeper will block the first normal launch/);
  assert.doesNotMatch(legal, /v0\.1\.0-beta\.1/);
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
