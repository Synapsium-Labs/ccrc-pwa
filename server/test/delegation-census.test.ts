// deploy/delegation-census.mjs (delegation broker wave 1, spec §8.1 questions 3, 6, 9): a read-only,
// path-free census of one repository's leftover Claude Code worktrees and their subagent metadata.
// Every row runs the real CLI over a fixture repository and fixture config homes.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const CENSUS = path.resolve(__dirname, '../../deploy/delegation-census.mjs');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const munge = (p: string): string => p.replace(/[^A-Za-z0-9]/g, '-');

function world(): { repo: string; ccd: string; h1: string; h2: string } {
  const repo = mkTmp('ccrc-census-repo-');
  const ccd = mkTmp('ccrc-census-ccd-');
  const h1 = mkTmp('ccrc-census-h1-');
  const h2 = mkTmp('ccrc-census-h2-');
  const rec = (name: string, files: Record<string, string>, wt: string | null): void => {
    const a = path.join(repo, '.git', 'worktrees', name);
    fs.mkdirSync(path.join(a, 'logs'), { recursive: true });
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(a, f), body);
    if (wt !== null) { fs.mkdirSync(wt, { recursive: true }); fs.writeFileSync(path.join(a, 'gitdir'), `${wt}/.git\n`); }
  };
  const wtA = path.join(repo, '.claude', 'worktrees', 'agent-abc');
  const wtW = path.join(repo, '.claude', 'worktrees', 'wf_run1-1');
  rec('agent-abc', { HEAD: `${SHA_B}\n`, CLAUDE_BASE: SHA_A, 'logs/HEAD': `${'0'.repeat(40)} ${SHA_A} Rig <you@example.com> 1 +0000\tbranch: Created\n` }, wtA);
  rec('wf_run1-1', { HEAD: 'ref: refs/heads/x\n', CLAUDE_BASE: SHA_A, 'logs/HEAD': `${'0'.repeat(40)} ${SHA_A} R <you@example.com> 1 +0000\tx\n` }, wtW);
  rec('plain', { HEAD: `${SHA_A}\n` }, path.join(repo, '..', 'gone-elsewhere-xyz'));
  fs.rmSync(path.join(repo, '..', 'gone-elsewhere-xyz'), { recursive: true });
  const meta = (home: string, proj: string, rel: string, body: object): void => {
    const f = path.join(home, 'projects', proj, 'uuid-sentinel-1', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(body));
  };
  const agentMeta = { agentType: 'g', description: 'SENTINEL-description', toolUseId: 'toolu_sentinel', worktreePath: wtA, spawnedWithWorktree: true };
  meta(h1, munge(repo), 'subagents/agent-abc.meta.json', agentMeta);
  meta(h2, munge(repo), 'subagents/agent-abc.meta.json', agentMeta);
  meta(h1, munge(path.join(ccd, 'proj', 'slug')), 'subagents/workflows/wf_run1/agent-q.meta.json',
    { workflowPhase: 'p', description: 'SENTINEL-description', worktreePath: wtW, spawnedWithWorktree: true });
  return { repo, ccd, h1, h2 };
}
const census = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [CENSUS, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('delegation-census (read-only, path-free)', () => {
  it('classifies each admin record and finds its metadata across homes', () => {
    const w = world();
    const r = census(['--repo', w.repo, '--ccd-root', w.ccd, '--home', w.h1, '--home', w.h2]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.adminRead).toBe('ok');
    expect(out.totals).toMatchObject({ records: 3, agent: 1, wf: 1, other: 1, metaFound: 2, metaMissing: 0, multiHome: 1, worktreeAbsent: 1 });
    const agent = out.records.find((x: { kind: string }) => x.kind === 'agent');
    expect(agent).toMatchObject({ head: 'detached', claudeBase: 'ok', baseAgreesFirstLog: true, movedFromBase: true, locked: false, worktreeDir: 'present' });
    expect(agent.meta).toMatchObject({ found: true, homes: 2, uuids: 1, worktreePathEquals: true, parentCwdClass: 'main-checkout' });
    expect(agent.meta.keys).toEqual(['agentType', 'description', 'spawnedWithWorktree', 'toolUseId', 'worktreePath']);
    const wf = out.records.find((x: { kind: string }) => x.kind === 'wf');
    expect(wf).toMatchObject({ head: 'ref', movedFromBase: null });
    expect(wf.meta).toMatchObject({ found: true, homes: 1, parentCwdClass: 'ccd-workspace', worktreePathEquals: true });
    const other = out.records.find((x: { kind: string }) => x.kind === 'other');
    expect(other).toMatchObject({ claudeBase: 'absent', worktreeDir: 'absent', meta: null });
  });

  it('prints no path, record name, id, uuid or metadata value', () => {
    const w = world();
    const r = census(['--repo', w.repo, '--ccd-root', w.ccd, '--home', w.h1, '--home', w.h2]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).totals.records).toBe(3);   // the scan below ran over a real document
    const text = r.stdout;
    for (const bad of [w.repo, w.h1, w.h2, w.ccd, 'abc', 'run1', 'uuid-sentinel-1', 'SENTINEL-description', 'toolu_sentinel', SHA_A, '/tmp/']) {
      expect(text.includes(bad), bad).toBe(false);
    }
  });

  it('reports an absent admin directory as absent, with no records', () => {
    const repo = mkTmp('ccrc-census-empty-');
    fs.mkdirSync(path.join(repo, '.git'));
    const out = JSON.parse(census(['--repo', repo, '--home', mkTmp('ccrc-census-h-')]).stdout);
    expect(out).toMatchObject({ adminRead: 'absent', records: [] });
  });

  it('refuses bad arguments with exit 2, one stderr line and no stdout', () => {
    for (const bad of [[], ['--home', '/x'], ['--repo'], ['--repo', '/x', '--bogus']]) {
      const r = census(bad);
      expect(r.status, bad.join(' ')).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr.trim().split('\n')).toHaveLength(1);
    }
  });
});
