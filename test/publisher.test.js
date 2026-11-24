import { describe, it, expect } from 'bun:test';
import { parseRepo, buildReleaseBody } from '../src/github-publisher.js';
import { parseCommitLine } from '../src/changelog.js';
import { validatePackageJson, printDryRequest, EXIT } from '../src/utils.js';
import { parseArgs, main } from '../src/cli.js';

describe('utils', () => {
  it('validates package.json', () => {
    expect(validatePackageJson({ name: 'x', version: '1.2.3' })).toEqual([]);
    expect(validatePackageJson({ version: '1.2.3' }).join()).toContain('缺少 name');
    expect(validatePackageJson({ name: 'x', version: 'bad' }).join()).toContain('semver');
    expect(validatePackageJson({ name: 'x', version: '1.0.0', private: true }).join()).toContain('private');
  });

  it('redacts authorization in dry-run print', () => {
    const out = printDryRequest('POST', 'https://api.github.com/x', { a: 1 }, { Authorization: 'Bearer secret' });
    expect(out).toContain('***REDACTED***');
    expect(out).not.toContain('secret');
  });

  it('has exit codes', () => {
    expect(EXIT.OK).toBe(0);
    expect(EXIT.USAGE).toBe(2);
    expect(EXIT.AUTH).toBe(4);
  });
});

describe('github publisher', () => {
  it('parses owner/repo and URLs', () => {
    expect(parseRepo('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
    expect(parseRepo('https://github.com/yikart/AiToEarn.git')).toEqual({ owner: 'yikart', repo: 'AiToEarn' });
    expect(parseRepo('git@github.com:yikart/AiToEarn.git')).toEqual({ owner: 'yikart', repo: 'AiToEarn' });
    expect(parseRepo('???')).toBeNull();
  });

  it('builds release body', () => {
    const b = buildReleaseBody({ tagName: 'v1.0.0', name: 'Release', body: 'notes', prerelease: true });
    expect(b.tag_name).toBe('v1.0.0');
    expect(b.name).toBe('Release');
    expect(b.prerelease).toBe(true);
  });
});

describe('changelog', () => {
  it('parses conventional commits', () => {
    const c = parseCommitLine('abc1234\tfeat(core): add thing');
    expect(c.type).toBe('feat');
    expect(c.scope).toBe('core');
    expect(c.subject).toBe('add thing');
    const b = parseCommitLine('def5678\tfix!: breaking bug');
    expect(b.breaking).toBe(true);
  });
});

describe('cli', () => {
  it('parses args with repeats and flags', () => {
    const a = parseArgs(['--target', 'both', '--dir', '.', '--asset', 'a.zip', '--asset', 'b.zip', '--publish']);
    expect(a.target).toBe('both');
    expect(a.assets).toEqual(['a.zip', 'b.zip']);
    expect(a.publish).toBe(true);
  });

  it('help returns 0', async () => {
    expect(await main(['--help'])).toBe(EXIT.OK);
  });

  it('missing target returns usage', async () => {
    expect(await main(['--dir', '.'])).toBe(EXIT.USAGE);
  });
});
