// Shared utilities for aitoearn-publisher.
import * as path from 'node:path';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const AUTH_FILE = path.join(ROOT, 'auth.json');

/** Resolve an absolute path (relative paths resolve against cwd). */
export function resolveDir(input) {
  const target = input && String(input).trim() ? String(input).trim() : '.';
  return path.resolve(process.cwd(), target);
}

/** Load auth.json if present. Never throws. */
export function loadAuthFile() {
  try {
    return JSON.parse(fsSync.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** GitHub token: opts > env > auth.json. */
export function resolveGithubToken(opts = {}) {
  return opts.token || process.env.GITHUB_TOKEN || loadAuthFile().github || '';
}

/** npm auth: opts > env > auth.json > defaults. */
export function resolveNpmAuth(opts = {}) {
  const cfg = loadAuthFile();
  return {
    token: opts.token || process.env.NPM_TOKEN || cfg.npm || '',
    registry: opts.registry || process.env.NPM_REGISTRY || cfg.registry || 'https://registry.npmjs.org',
  };
}

/**
 * Enable proxy TLS workaround only when explicitly configured, because it
 * disables certificate verification. On some machines the HTTPS proxy uses a
 * private CA and fetch fails with "unable to verify the first certificate".
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

/** Read and parse a package.json from a directory. */
export async function readPackageJson(dir) {
  const file = path.join(dir, 'package.json');
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    throw new Error(`无法读取 package.json: ${file} (${err.message})`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`package.json 不是合法 JSON: ${file} (${err.message})`);
  }
  return { path: file, data };
}

/** Validate required npm package fields. Returns an array of error messages. */
export function validatePackageJson(data) {
  const errors = [];
  if (!data.name || typeof data.name !== 'string') errors.push('缺少 name');
  if (!data.version || typeof data.version !== 'string') errors.push('缺少 version');
  if (data.version && !/^\d+\.\d+\.\d+/.test(data.version)) {
    errors.push(`version 不是 semver: ${data.version}`);
  }
  if (data.private === true) errors.push('package.json 标记了 "private": true，不能发布');
  return errors;
}

/** Redact a secret for logs. */
export function redact(secret) {
  if (!secret) return '(unset)';
  const v = String(secret);
  return v.length <= 8 ? '***' : `${v.slice(0, 4)}...${v.slice(-4)}`;
}

/** Format a dry-run HTTP request with secrets redacted. Returns a string. */
export function printDryRequest(method, url, third, fourth) {
  // Back-compat: original signature was (method, url, body, headers).
  let body = third;
  let headers = fourth;
  if (third && typeof third === 'object' && !Array.isArray(third)
      && (fourth === undefined || typeof fourth === 'object')) {
    // Ambiguous: detect headers by presence of Authorization/Accept keys.
    if ('Authorization' in third || 'Accept' in third || 'Content-Type' in third) {
      headers = third;
      body = fourth;
    }
  }
  const safe = { ...(headers || {}) };
  if (safe.Authorization && !String(safe.Authorization).includes('REDACTED')) {
    safe.Authorization = 'Bearer ***REDACTED***';
  }
  const lines = [
    `[dry-run] ${method} ${url}`,
    `[dry-run] headers: ${JSON.stringify(safe)}`,
  ];
  if (body !== undefined) {
    lines.push(`[dry-run] body: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return lines.join('\n');
}

export const EXIT = Object.freeze({
  OK: 0,
  OTHER: 1,
  USAGE: 2,
  VALIDATION: 3,
  CREDENTIALS: 4,
  AUTH: 4, // alias used by tests and older callers
  NETWORK: 5,
});

/** Run a command, never throws on non-zero exit. */
export function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        shell: opts.shell === true,
        env: { ...process.env, ...(opts.env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish(-1);
      return;
    }
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code ?? -1));
    if (opts.timeoutMs) timer = setTimeout(() => { try { child.kill(); } catch {} finish(-1); }, opts.timeoutMs);
  });
}