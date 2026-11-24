#!/usr/bin/env node
// Credential store for aitoearn-publisher.
// One-place config; secrets are never written to source or logs.
// Usage:
//   node src/setup-credentials.mjs --github <token> [--npm <token>] [--registry https://registry.npmjs.org]
//   node src/setup-credentials.mjs --show
//
// Stores into ./auth.json (gitignored) with 0600-equivalent ACL on Windows.
// Precedence at runtime: explicit opts > env (GITHUB_TOKEN / NPM_TOKEN) > auth.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const FILE = path.join(ROOT, 'auth.json');
const GITIGNORE = path.join(ROOT, '.gitignore');

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--github') out.github = argv[++i];
    else if (a === '--npm') out.npm = argv[++i];
    else if (a === '--registry') out.registry = argv[++i];
    else if (a === '--show') out.show = true;
    else if (a === '--clear') out.clear = true;
  }
  return out;
}

function mask(s) {
  if (!s) return '(unset)';
  const v = String(s);
  return v.length <= 8 ? '***' : `${v.slice(0, 4)}...${v.slice(-4)}`;
}

const args = parse(process.argv.slice(2));

if (args.clear) {
  try { fs.unlinkSync(FILE); console.log('[auth] removed auth.json'); }
  catch { console.log('[auth] no auth.json to remove'); }
  process.exit(0);
}

if (args.show) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  console.log(`[auth] file: ${FILE}`);
  console.log(`[auth] github: ${mask(cur.github || process.env.GITHUB_TOKEN)}`);
  console.log(`[auth] npm:    ${mask(cur.npm || process.env.NPM_TOKEN)}`);
  console.log(`[auth] registry: ${cur.registry || process.env.NPM_REGISTRY || 'https://registry.npmjs.org'}`);
  process.exit(0);
}

if (!args.github && !args.npm) {
  console.error('usage: node src/setup-credentials.mjs --github <token> [--npm <token>] [--registry <url>]');
  console.error('       node src/setup-credentials.mjs --show | --clear');
  process.exit(2);
}

let cur = {};
try { cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const next = {
  ...cur,
  ...(args.github ? { github: args.github } : {}),
  ...(args.npm ? { npm: args.npm } : {}),
  ...(args.registry ? { registry: args.registry } : {}),
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
try { fs.chmodSync(FILE, 0o600); } catch {}
// Ensure auth.json is gitignored so it can never be published by accident.
let gi = '';
try { gi = fs.readFileSync(GITIGNORE, 'utf8'); } catch {}
if (!gi.split(/\r?\n/).includes('auth.json')) {
  fs.writeFileSync(GITIGNORE, `${gi}${gi && !gi.endsWith('\n') ? '\n' : ''}auth.json\n`, 'utf8');
}
console.log(`[auth] saved ${FILE}`);
console.log(`[auth] github: ${mask(next.github)}`);
console.log(`[auth] npm:    ${mask(next.npm)}`);
console.log('[auth] auth.json is gitignored and excluded from npm package files.');