import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const distribution = resolve('dist');
const manifest = JSON.parse(await readFile(join(distribution, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
if (manifest.version !== packageJson.version) throw new Error(`Manifest version ${manifest.version} does not match package version ${packageJson.version}.`);
const required = [
  manifest.chrome_url_overrides.newtab,
  manifest.action.default_popup,
  manifest.background.service_worker,
  'offscreen.html',
];
for (const file of required) await access(join(distribution, file));

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:html|js)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      if (/\beval\s*\(|\bnew\s+Function\s*\(|<script[^>]+src=["']https?:/i.test(source)) {
        throw new Error(`Remote or dynamic executable code found in ${path}`);
      }
    }
  }
}

await scan(distribution);
console.log(`Verified ${required.length} MV3 entry points and packaged-only executable code.`);
