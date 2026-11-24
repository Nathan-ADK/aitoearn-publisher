import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const AUTH_FILE = path.join(ROOT, 'auth.json');

/** Load auth.json if present. Never throws. */
export function loadAuthFile() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** GitHub token: opts > env > auth.json. */
export function resolveGithubToken(opts = {}) {
  return opts.token || process.env.GITHUB_TOKEN || loadAuthFile().github || '';
}

/** npm token and registry: opts > env > auth.json > defaults. */
export function resolveNpmAuth(opts = {}) {
  const cfg = loadAuthFile();
  return {
    token: opts.token || process.env.NPM_TOKEN || cfg.npm || '',
    registry: opts.registry || process.env.NPM_REGISTRY || cfg.registry || 'https://registry.npmjs.org',
  };
}

/**
 * Ensure proxy TLS works on machines whose HTTPS proxy uses a private CA.
 * Opt-in via env PUBLISHER_ALLOW_PROXY_TLS=1 or auth.json allowProxyTls:true.
 * Sets NODE_TLS_REJECT_UNAUTHORIZED=0 for this process only.
 */
export function ensureProxyTls() {
  const cfg = loadAuthFile();
  const enabled = process.env.PUBLISHER_ALLOW_PROXY_TLS === '1' || cfg.allowProxyTls === true;
  if (enabled && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    return true;
  }
  return false;
}

export { resolveDir } from './utils-path.js';