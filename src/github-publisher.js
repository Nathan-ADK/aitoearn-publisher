// GitHub Release publisher using the built-in fetch (no gh CLI, no server API).
import { printDryRequest, EXIT, resolveGithubToken, ensureProxyTls } from './utils.js';

const API_ROOT = 'https://api.github.com';

/**
 * Parse "owner/repo" or a GitHub URL into {owner, repo}.
 */
export function parseRepo(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim();
  const urlMatch = s.match(/github\.com[/:]([^/]+)\/([^/.#]+?)(?:\.git)?(?:[/#]|$)/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  const plain = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (plain) return { owner: plain[1], repo: plain[2] };
  return null;
}

/**
 * Build the release request body.
 */
export function buildReleaseBody({ tagName, name, body, draft = false, prerelease = false, targetCommitish }) {
  const payload = {
    tag_name: tagName,
    name: name || tagName,
    body: body || '',
    draft: Boolean(draft),
    prerelease: Boolean(prerelease),
  };
  if (targetCommitish) payload.target_commitish = targetCommitish;
  return payload;
}

/**
 * Create a GitHub Release (or dry-run it).
 * @param {object} opts
 * @param {string} opts.repo            "owner/repo" or GitHub URL
 * @param {string} opts.tagName         release tag
 * @param {string} [opts.name]          release title
 * @param {string} [opts.body]          release notes (markdown)
 * @param {boolean} opts.publish        true = real, false = dry-run
 * @param {string} [opts.token]         token override (defaults to process.env.GITHUB_TOKEN)
 * @param {string[]} [opts.assets]      local file paths to upload
 * @returns {Promise<{code:number, messages:string[], data:object}>}
 */
export async function publishGithub(opts = {}) {
  const messages = [];
  const result = { code: EXIT.OK, messages, data: {} };

  const parsed = parseRepo(opts.repo);
  if (!parsed) {
    messages.push(`[github] 错误: 无法解析 repo "${opts.repo}"，应为 owner/repo 或 GitHub URL`);
    result.code = EXIT.VALIDATION;
    return result;
  }
  if (!opts.tagName) {
    messages.push('[github] 错误: 缺少 tagName');
    result.code = EXIT.VALIDATION;
    return result;
  }

  ensureProxyTls();
  const token = resolveGithubToken(opts);
  const url = `${API_ROOT}/repos/${parsed.owner}/${parsed.repo}/releases`;
  const payload = buildReleaseBody({
    tagName: opts.tagName,
    name: opts.name,
    body: opts.body,
    draft: opts.draft,
    prerelease: opts.prerelease,
    targetCommitish: opts.targetCommitish,
  });
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  messages.push(`[github] repository: ${parsed.owner}/${parsed.repo}`);
  messages.push(`[github] release tag: ${opts.tagName}${opts.name ? ` — ${opts.name}` : ''}`);
  if (opts.body) {
    messages.push('[github] --- release notes ---');
    messages.push(opts.body.trimEnd());
    messages.push('[github] --- end release notes ---');
  }

  if (!opts.publish) {
    messages.push('[github] === dry-run: 将发送以下请求（未实际发送）===');
    messages.push(printDryRequest('POST', url, payload, headers));
    if (opts.assets && opts.assets.length) {
      for (const asset of opts.assets) {
        messages.push(printDryRequest('POST', `https://uploads.github.com/repos/${parsed.owner}/${parsed.repo}/releases/<id>/assets?name=<filename>`, '<binary>', {
          Authorization: token ? 'Bearer ***REDACTED***' : '(none)',
          'Content-Type': 'application/octet-stream',
        }));
      }
    }
    if (!token) {
      messages.push('[github] 提示: GITHUB_TOKEN 未设置；真实发布前必须设置环境变量 GITHUB_TOKEN（fine-grained token 需 contents:write 权限）。');
    } else {
      messages.push('[github] 提示: 检测到 GITHUB_TOKEN（已打码）；真实发布需传 --publish。');
    }
    result.data.wouldPublish = true;
    return result;
  }

  if (!token) {
    messages.push('[github] 错误: GITHUB_TOKEN 未设置，无法创建 Release。请设置环境变量 GITHUB_TOKEN。');
    result.code = EXIT.AUTH;
    return result;
  }

  if (typeof fetch !== 'function') {
    messages.push('[github] 错误: 当前运行时没有 fetch，需要 Node >= 18。');
    result.code = EXIT.UNKNOWN;
    return result;
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    messages.push(`[github] 网络错误: ${err.message}`);
    result.code = EXIT.NETWORK;
    return result;
  }

  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  result.data.response = { status: resp.status, body: json };

  if (!resp.ok) {
    messages.push(`[github] API 失败: HTTP ${resp.status} ${json.message || ''}`);
    messages.push(text.slice(0, 2000));
    result.code = resp.status === 401 || resp.status === 403 ? EXIT.AUTH : EXIT.NETWORK;
    return result;
  }

  messages.push(`[github] Release 创建成功: ${json.html_url || `(id ${json.id})`}`);

  // asset uploads
  if (opts.assets && opts.assets.length) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const uploadBase = `https://uploads.github.com/repos/${parsed.owner}/${parsed.repo}/releases/${json.id}/assets`;
    for (const asset of opts.assets) {
      try {
        const buf = await fs.readFile(asset);
        const name = path.basename(asset);
        const upResp = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: buf,
        });
        if (!upResp.ok) {
          messages.push(`[github] asset ${name} 上传失败: HTTP ${upResp.status}`);
          result.code = EXIT.NETWORK;
        } else {
          messages.push(`[github] asset ${name} 上传成功`);
        }
      } catch (err) {
        messages.push(`[github] asset ${asset} 读取失败: ${err.message}`);
        result.code = EXIT.NETWORK;
      }
    }
  }

  return result;
}
