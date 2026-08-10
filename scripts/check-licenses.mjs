#!/usr/bin/env node
/**
 * License gate.
 *
 * Fails the build if any shipped asset lacks a complete license row. Fifteen
 * minutes of work now; a genuinely miserable archaeology project later, once
 * there are three hundred files and no memory of where half of them came from.
 *
 * The `commercial_ok` check is deliberately strict about WHY: "royalty-free" is
 * not "copyright-free", and a great many royalty-free audio licenses prohibit
 * redistribution inside an app or asset library — which is exactly what this
 * project does. Only CC0 / public domain passes without a manual override.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PACK_DIRS = ['public/packs', 'public/audio'];

const ACCEPTED = [/^CC0/i, /^public[- ]domain$/i, /^Unlicense$/i];

const problems = [];
let checked = 0;
let packs = 0;

function checkLicense(where, name, lic) {
  if (!lic || typeof lic !== 'object') {
    problems.push(`${where}: "${name}" has no license block`);
    return;
  }
  for (const field of ['source', 'license', 'url']) {
    if (!lic[field] || typeof lic[field] !== 'string' || !lic[field].trim()) {
      problems.push(`${where}: "${name}" missing license.${field}`);
    }
  }
  if (lic.commercial_ok !== true) {
    problems.push(`${where}: "${name}" is not marked commercial_ok`);
  }
  if (typeof lic.license === 'string' && !ACCEPTED.some((re) => re.test(lic.license))) {
    problems.push(
      `${where}: "${name}" license "${lic.license}" is not CC0/public-domain. ` +
        `Verify it permits redistribution inside an app, then add it to ACCEPTED.`,
    );
  }
}

function checkFileExists(where, name, dir, file) {
  if (!file) {
    problems.push(`${where}: "${name}" has no file`);
    return;
  }
  if (!existsSync(join(dir, file))) {
    problems.push(`${where}: "${name}" references missing file "${file}"`);
  }
}

for (const rel of PACK_DIRS) {
  const base = join(ROOT, rel);
  if (!existsSync(base)) continue;

  for (const entry of readdirSync(base)) {
    const dir = join(base, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifest = join(dir, 'pack.json');
    if (!existsSync(manifest)) {
      problems.push(`${rel}/${entry}: no pack.json`);
      continue;
    }

    packs++;
    let pack;
    try {
      pack = JSON.parse(readFileSync(manifest, 'utf8'));
    } catch (err) {
      problems.push(`${rel}/${entry}/pack.json: invalid JSON — ${err.message}`);
      continue;
    }

    const where = `${rel}/${entry}`;

    for (const [name, asset] of Object.entries(pack.assets ?? {})) {
      checked++;
      checkLicense(where, name, asset.license);
      checkFileExists(where, name, dir, asset.file);
    }

    for (const [name, tex] of Object.entries(pack.textures ?? {})) {
      checked++;
      checkLicense(where, name, tex.license);
      checkFileExists(where, name, dir, tex.file);
    }

    for (const [name, inst] of Object.entries(pack.instruments ?? {})) {
      checked++;
      checkLicense(where, name, inst.license);
      for (const file of Object.values(inst.samples ?? {})) {
        checkFileExists(where, `${name} sample`, dir, file);
      }
    }
  }
}

if (problems.length) {
  console.error(`\nLicense check FAILED — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`License check passed: ${checked} asset(s) across ${packs} pack(s).`);
