#!/usr/bin/env node
// CLI entry for @nathan-adk/aitoearn-publisher.
import { resolveDir, EXIT } from './utils.js';
import { publishNpm } from './npm-publisher.js';
import { publishGithub } from './github-publisher.js';
import { generateChangelog } from './changelog.js';

const HELP = `aitoearn-publisher — 本地一键发布 npm 包与 GitHub Release（不依赖 aitoearn.cn）

用法:
  node cli.js --target npm|github|both --dir <path> [options]

必需:
  --target <npm|github|both>   发布目标。npm=仅 npm；github=仅 GitHub Release；both=两者
  --dir <path>                 包目录（npm）或 git 仓库目录（github / changelog）

选项:
  --version <x.y.z>            期望版本（仅做一致性提示，不改写文件）
  --tag <tag>                  npm dist-tag，默认 latest；github release tag 默认取 package.json version
  --name <name>                GitHub Release 标题（默认 tag）
  --repo <owner/repo>          GitHub 仓库，默认从 git origin 推断
  --since <rev>                changelog 起点，如 v0.1.0 或 HEAD~5
  --notes <file>               从文件读取 Release notes（默认用 changelog）
  --asset <file>               上传 asset，可重复指定
  --draft                      创建草稿 Release
  --prerelease                 标记为预发布
  --dry-run                    只打印将执行的请求，不实际发布（默认）
  --publish                    真实发布（必须显式指定，覆盖 --dry-run）
  --changelog-only             只生成并打印 changelog，不发布
  --help, -h                   显示帮助

退出码:
  0 成功 / dry-run 完成
  2 用法错误
  3 校验错误（package.json / git / 参数）
  4 凭据错误（GITHUB_TOKEN 缺失或无效）
  5 网络或远端错误
  1 其他未知错误

凭据:
  npm:        先执行 \`npm login\`（或使用 NPM_TOKEN 并配置 ~/.npmrc）
  GitHub:     设置环境变量 GITHUB_TOKEN（fine-grained token 需 contents:write）

示例:
  node cli.js --target npm --dir /path/to/pkg --dry-run
  node cli.js --target github --dir /path/to/repo --tag v0.1.0 --dry-run
  node cli.js --target both --dir /path/to/repo --since v0.1.0 --publish
  node cli.js --target github --dir /path/to/repo --changelog-only --since HEAD~5
`;

/** Minimal argument parser supporting --key value, --key=value, flags, repeated --asset. */
export function parseArgs(argv) {
  const out = { assets: [] };
  const flags = new Set(['dry-run', 'publish', 'draft', 'prerelease', 'changelog-only', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') && arg !== '-h') continue;
    const raw = arg === '-h' ? '--help' : arg;
    const eq = raw.indexOf('=');
    const key = (eq >= 0 ? raw.slice(2, eq) : raw.slice(2));
    const inline = eq >= 0 ? raw.slice(eq + 1) : undefined;
    if (flags.has(key)) {
      out[key] = true;
      continue;
    }
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined) {
      throw new Error(`选项 --${key} 缺少值`);
    }
    if (key === 'asset') out.assets.push(value);
    else out[key] = value;
  }
  return out;
}

async function detectRepo(dir) {
  const { runCommand } = await import('./utils.js');
  const remote = await runCommand('git', ['remote', 'get-url', 'origin'], { cwd: dir });
  if (remote.code !== 0) return '';
  return remote.stdout.trim();
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`参数错误: ${err.message}`);
    console.error(HELP);
    return EXIT.USAGE;
  }
  if (args.help) {
    console.log(HELP);
    return EXIT.OK;
  }

  if (!args.target || !['npm', 'github', 'both'].includes(args.target)) {
    console.error('错误: 必须指定 --target npm|github|both');
    console.error(HELP);
    return EXIT.USAGE;
  }
  if (!args.dir) {
    console.error('错误: 必须指定 --dir <path>');
    return EXIT.USAGE;
  }

  const dir = resolveDir(args.dir);
  const publish = Boolean(args.publish); // default dry-run
  const messages = [];
  let code = EXIT.OK;

  // changelog (also used as release notes unless --notes given)
  let changelog = null;
  if (args['changelog-only'] || args.since || args.target !== 'npm') {
    try {
      changelog = await generateChangelog({ dir, since: args.since });
    } catch (err) {
      console.error(`[changelog] 警告: ${err.message}`);
      if (args['changelog-only']) return EXIT.VALIDATION;
    }
  }
  if (args['changelog-only']) {
    console.log(changelog ? changelog.markdown : '(no changelog)');
    return EXIT.OK;
  }
  if (changelog) {
    console.log(`[changelog] 生成 ${changelog.count} 条提交 (${changelog.range})`);
  }

  let releaseNotes = changelog ? changelog.markdown : '';
  if (args.notes) {
    const fs = await import('node:fs/promises');
    try {
      releaseNotes = await fs.readFile(resolveDir(args.notes), 'utf8');
    } catch (err) {
      console.error(`[notes] 读取失败: ${err.message}`);
      return EXIT.VALIDATION;
    }
  }

  // read package.json for version fallback / npm
  let pkgVersion = '';
  try {
    const { readPackageJson } = await import('./utils.js');
    const { data } = await readPackageJson(dir);
    pkgVersion = data.version || '';
  } catch {
    // github-only target without package.json is fine
  }

  if (args.target === 'npm' || args.target === 'both') {
    const r = await publishNpm({
      dir,
      publish,
      tag: args.tag || 'latest',
      version: args.version,
    });
    messages.push(...r.messages);
    if (r.code !== 0) code = r.code;
  }

  if (args.target === 'github' || args.target === 'both') {
    let repo = args.repo;
    if (!repo) repo = await detectRepo(dir);
    const tagName = args.tag || (pkgVersion ? `v${pkgVersion}` : '');
    const r = await publishGithub({
      repo,
      tagName,
      name: args.name,
      body: releaseNotes,
      publish,
      draft: Boolean(args.draft),
      prerelease: Boolean(args.prerelease),
      assets: args.assets || [],
    });
    messages.push(...r.messages);
    if (r.code !== 0 && code === 0) code = r.code;
  }

  console.log(messages.join('\n'));
  console.log(`\n[result] exit=${code} mode=${publish ? 'PUBLISH' : 'DRY-RUN'}`);
  return code;
}

// ESM direct-run detection (Windows / POSIX)
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
let isDirect = false;
if (process.argv[1]) {
  try {
    isDirect = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
  } catch { /* ignore */ }
}
if (isDirect) {
  process.exitCode = await main();
}
