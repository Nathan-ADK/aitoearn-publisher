// Generate a Conventional-Commits grouped changelog from local git history.
import { resolveDir, runCommand } from './utils.js';

const GROUPS = [
  { key: 'feat', title: 'Features' },
  { key: 'fix', title: 'Bug Fixes' },
  { key: 'perf', title: 'Performance Improvements' },
  { key: 'refactor', title: 'Code Refactoring' },
  { key: 'docs', title: 'Documentation' },
  { key: 'chore', title: 'Miscellaneous Chores' },
  { key: 'test', title: 'Tests' },
  { key: 'build', title: 'Build System' },
  { key: 'ci', title: 'Continuous Integration' },
];

/**
 * Parse one git log line: "<hash>\t<subject>" into {hash, type, scope, breaking, subject}.
 */
export function parseCommitLine(line) {
  const tab = line.indexOf('\t');
  const hash = tab >= 0 ? line.slice(0, tab) : '';
  const subject = tab >= 0 ? line.slice(tab + 1) : line;
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.*)$/);
  if (!m) return { hash, type: 'other', scope: '', breaking: false, subject, raw: subject };
  return {
    hash,
    type: m[1].toLowerCase(),
    scope: m[2] || '',
    breaking: Boolean(m[3]),
    subject: m[4],
    raw: subject,
  };
}

/**
 * Generate markdown changelog.
 * @param {object} opts
 * @param {string} opts.dir     git repo directory
 * @param {string} [opts.since] git revision (e.g. v0.1.0 or HEAD~5)
 */
export async function generateChangelog(opts = {}) {
  const dir = resolveDir(opts.dir);
  const since = opts.since || '';
  const range = since ? `${since}..HEAD` : 'HEAD';
  // separator tab avoids ambiguity with commit subjects containing spaces
  const log = await runCommand('git', ['log', '--pretty=format:%h%x09%s', range], { cwd: dir });

  if (log.code !== 0) {
    const err = (log.stderr || '').trim() || `git log 退出码 ${log.code}`;
    throw new Error(`git log 失败 (${range}): ${err}`);
  }

  const commits = log.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(parseCommitLine);
  const grouped = new Map(GROUPS.map((g) => [g.key, []]));
  const other = [];

  for (const c of commits) {
    if (grouped.has(c.type)) grouped.get(c.type).push(c);
    else other.push(c);
  }

  const lines = [];
  lines.push(`## Changelog (\`${range}\`)`);
  lines.push('');
  let any = false;
  for (const g of GROUPS) {
    const items = grouped.get(g.key);
    if (!items || !items.length) continue;
    any = true;
    lines.push(`### ${g.title}`);
    lines.push('');
    for (const c of items) {
      const scope = c.scope ? `**${c.scope}:** ` : '';
      lines.push(`- ${scope}${c.subject}${c.breaking ? ' **(BREAKING)**' : ''} (${c.hash})`);
    }
    lines.push('');
  }
  if (other.length) {
    any = true;
    lines.push('### Other Changes');
    lines.push('');
    for (const c of other) lines.push(`- ${c.raw} (${c.hash})`);
    lines.push('');
  }
  if (!any) {
    lines.push('_No commits._');
    lines.push('');
  }

  return {
    markdown: lines.join('\n').trimEnd() + '\n',
    range,
    commits,
    count: commits.length,
  };
}
