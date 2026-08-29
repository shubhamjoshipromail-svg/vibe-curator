import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const distribution = resolve('dist');
const manifest = JSON.parse(await readFile(join(distribution, 'manifest.json'), 'utf8'));
const required = [
  manifest.chrome_url_overrides.newtab,
  manifest.action.default_popup,
  manifest.background.service_worker,
  'offscreen.html',
  'search_overlay.js',
];
for (const file of required) await access(join(distribution, file));
const searchOverlay = await readFile(join(distribution, 'search_overlay.js'), 'utf8');
if (/^\s*import\s/m.test(searchOverlay)) throw new Error('Registered content script must be a self-contained classic script.');

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
