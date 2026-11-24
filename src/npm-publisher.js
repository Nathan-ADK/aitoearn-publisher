// npm publish pipeline: validate -> npm pack --dry-run -> (optional) npm publish.
import * as path from 'node:path';
import * as fs from 'node:fs';
import { resolveDir, readPackageJson, validatePackageJson, runCommand, EXIT } from './utils.js';

/**
 * Locate npm executable. Order: NPM_BIN env -> npm next to current node -> "npm" on PATH.
 */
function npmCommand() {
  if (process.env.NPM_BIN) return process.env.NPM_BIN;
  if (process.platform === 'win32' && process.execPath) {
    const candidate = path.join(path.dirname(process.execPath), 'npm.cmd');
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/** Spawn options: Windows npm is a .cmd shim requiring shell:true. */
function npmOpts(dir) {
  return { cwd: dir, shell: process.platform === 'win32' };
}

/** Display name for logs. */
function npmLabel() {
  const c = npmCommand();
  return c.toLowerCase().endsWith('.cmd') ? 'npm' : c;
}

/**
 * Publish (or dry-run) an npm package.
 * @param {object} opts
 * @param {string} opts.dir            package directory
 * @param {boolean} opts.publish       true -> real publish; false -> dry-run only
 * @param {string} [opts.tag]          dist-tag (default latest)
 * @param {string} [opts.version]      optional version to set via npm version --no-git-tag-version (not applied, only reported)
 * @returns {Promise<{code:number, messages:string[], data:object}>}
 */
export async function publishNpm(opts = {}) {
  const dir = resolveDir(opts.dir);
  const messages = [];
  const result = { code: EXIT.OK, messages, data: {} };

  // 1. validate package.json
  let pkg;
  try {
    pkg = await readPackageJson(dir);
  } catch (err) {
    messages.push(`[npm] 错误: ${err.message}`);
    result.code = EXIT.VALIDATION;
    return result;
  }
  const errors = validatePackageJson(pkg.data);
  if (errors.length) {
    messages.push(`[npm] package.json 校验失败: ${errors.join('; ')}`);
    result.code = EXIT.VALIDATION;
    return result;
  }
  messages.push(`[npm] package: ${pkg.data.name}@${pkg.data.version} (${dir})`);

  if (opts.version && opts.version !== pkg.data.version) {
    messages.push(`[npm] 注意: --version ${opts.version} 与 package.json 版本 ${pkg.data.version} 不一致；本工具不改写文件，请先手动同步。`);
  }

  // 2. pack --dry-run preflight
  const pack = await runCommand(npmCommand(), ['pack', '--dry-run'], npmOpts(dir));
  messages.push('[npm] === npm pack --dry-run ===');
  if (pack.stdout) messages.push(pack.stdout.trimEnd());
  if (pack.stderr) messages.push(`[npm] stderr: ${pack.stderr.trimEnd()}`);
  result.data.pack = { code: pack.code, stdout: pack.stdout, stderr: pack.stderr };
  if (pack.code !== 0) {
    messages.push(`[npm] pack --dry-run 失败 (exit ${pack.code})`);
    result.code = EXIT.VALIDATION;
    return result;
  }

  // 3. publish or print intent
  const tag = opts.tag || 'latest';
  if (!opts.publish) {
    messages.push(`[npm] dry-run: 将执行 \`${npmLabel()} publish --tag ${tag}\` (未执行)`);
    messages.push('[npm] 提示: 真实发布需显式传入 --publish，并确保 npm login 已完成。');
    result.data.wouldPublish = true;
    return result;
  }

  messages.push(`[npm] 执行发布: ${npmLabel()} publish --tag ${tag}`);
  const pub = await runCommand(npmCommand(), ['publish', '--tag', tag], npmOpts(dir));
  result.data.publish = { code: pub.code, stdout: pub.stdout, stderr: pub.stderr };
  if (pub.stdout) messages.push(pub.stdout.trimEnd());
  if (pub.stderr) messages.push(`[npm] stderr: ${pub.stderr.trimEnd()}`);
  if (pub.code !== 0) {
    messages.push(`[npm] publish 失败 (exit ${pub.code})`);
    result.code = EXIT.NETWORK;
  } else {
    messages.push('[npm] publish 成功');
  }
  return result;
}
