import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distribution = join(extensionRoot, 'dist');
const manifest = JSON.parse(await readFile(join(distribution, 'manifest.json'), 'utf8'));
const entries = {};

async function collect(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else entries[relative(distribution, path).replaceAll('\\', '/')] = [new Uint8Array(await readFile(path)), { mtime: new Date('1980-01-02T00:00:00.000Z') }];
  }
}

await collect(distribution);
const artifacts = join(extensionRoot, 'artifacts');
await mkdir(artifacts, { recursive: true });
const output = join(artifacts, `vibe-curator-chrome-${manifest.version}.zip`);
await writeFile(output, zipSync(entries, { level: 9 }));
console.log(relative(extensionRoot, output));
