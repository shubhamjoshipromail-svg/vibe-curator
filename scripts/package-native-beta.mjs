import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BETA = 4;
const ARCHITECTURE = 'arm64';
const SOURCE_ARCHITECTURE = 'aarch64';
const PRODUCT_NAME = 'Vibe Curator';

function fail(message) {
  throw new Error(`Native beta packaging refused: ${message}`);
}

function readVersion(relative) {
  const content = readFileSync(join(ROOT, relative), 'utf8');
  if (relative.endsWith('.json')) return JSON.parse(content).version;
  return content.match(/^version = "([^"]+)"$/m)?.[1];
}

function parseSourceArgument() {
  const args = process.argv.slice(2);
  if (!args.length) return undefined;
  if (args.length === 2 && args[0] === '--source' && args[1] && !args[1].startsWith('-')) return resolve(args[1]);
  fail('usage is npm run package:native-beta [-- --source /absolute/path/to/Vibe Curator_<version>_aarch64.dmg]');
}

function command(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr.trim() : error instanceof Error ? error.message : String(error);
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
}

function validateSourceDmg(source, version) {
  const expectedSourceName = `${PRODUCT_NAME}_${version}_${SOURCE_ARCHITECTURE}.dmg`;
  if (process.platform !== 'darwin') fail('DMG validation requires macOS.');
  if (!existsSync(source)) fail(`source DMG is missing: ${source}`);
  if (!statSync(source).isFile()) fail(`source is not a file: ${source}`);
  if (basename(source) !== expectedSourceName) fail(`source must be named ${expectedSourceName}, received ${basename(source)}.`);

  const mountPoint = mkdtempSync(join(tmpdir(), 'vibe-curator-beta-dmg-'));
  let mounted = false;
  try {
    command('hdiutil', ['attach', source, '-nobrowse', '-readonly', '-mountpoint', mountPoint]);
    mounted = true;
    const app = join(mountPoint, `${PRODUCT_NAME}.app`);
    const infoPlist = join(app, 'Contents', 'Info.plist');
    if (!existsSync(infoPlist)) fail(`DMG does not contain ${PRODUCT_NAME}.app with Info.plist.`);

    const embeddedVersion = command('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', infoPlist]).trim();
    if (embeddedVersion !== version) fail(`embedded app version is ${embeddedVersion || 'missing'}, expected ${version}.`);
    const executableName = command('plutil', ['-extract', 'CFBundleExecutable', 'raw', infoPlist]).trim();
    if (!/^[A-Za-z0-9._-]+$/.test(executableName)) fail('embedded app executable name is missing or unsafe.');
    const executable = join(app, 'Contents', 'MacOS', executableName);
    if (!existsSync(executable)) fail(`DMG does not contain the declared executable ${executableName}.`);
    const architectures = command('lipo', ['-archs', executable]).trim().split(/\s+/).filter(Boolean);
    if (architectures.length !== 1 || architectures[0] !== ARCHITECTURE) {
      fail(`embedded executable architectures are ${architectures.join(', ') || 'missing'}, expected only ${ARCHITECTURE}.`);
    }
    command('codesign', ['--verify', '--deep', '--strict', app]);
  } finally {
    if (mounted) {
      try { execFileSync('hdiutil', ['detach', mountPoint], { stdio: 'ignore' }); }
      catch { fail(`could not detach validation mount: ${mountPoint}`); }
    }
    rmSync(mountPoint, { recursive: true, force: true });
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const packageVersion = readVersion('package.json');
const tauriVersion = readVersion('src-tauri/tauri.conf.json');
const cargoVersion = readVersion('src-tauri/Cargo.toml');
if (!packageVersion || packageVersion !== tauriVersion || packageVersion !== cargoVersion) {
  fail(`version inputs disagree (package=${packageVersion}, tauri=${tauriVersion}, cargo=${cargoVersion}).`);
}

const source = parseSourceArgument() ?? join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'dmg', `${PRODUCT_NAME}_${packageVersion}_${SOURCE_ARCHITECTURE}.dmg`);
validateSourceDmg(source, packageVersion);

const releaseVersion = `${packageVersion}-beta.${BETA}`;
const releaseDirectory = join(ROOT, 'release-artifacts');
const artifactName = `Vibe-Curator-${releaseVersion}-${ARCHITECTURE}-technical-tester-unnotarized.dmg`;
const artifact = join(releaseDirectory, artifactName);
const checksum = `${artifact}.sha256`;
if (existsSync(artifact) || existsSync(checksum)) fail(`refusing to overwrite an existing release artifact: ${artifact}`);

mkdirSync(releaseDirectory, { recursive: true });
const stagedArtifact = join(releaseDirectory, `.${artifactName}.staging`);
const stagedChecksum = `${stagedArtifact}.sha256`;
try {
  copyFileSync(source, stagedArtifact);
  const digest = sha256(stagedArtifact);
  writeFileSync(stagedChecksum, `${digest}  ${artifactName}\n`, { encoding: 'utf8', mode: 0o644 });
  renameSync(stagedArtifact, artifact);
  renameSync(stagedChecksum, checksum);
} finally {
  if (existsSync(stagedArtifact)) unlinkSync(stagedArtifact);
  if (existsSync(stagedChecksum)) unlinkSync(stagedChecksum);
}

console.log(`Created ${artifact}`);
console.log(`Created ${checksum}`);
