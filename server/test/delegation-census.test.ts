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
  rec('plain', { HEAD: `${SHA_A}\n` }, null);
  // a gitdir naming a path that was never created (inside a private tmp dir, not a fixed shared name)
  fs.writeFileSync(path.join(repo, '.git', 'worktrees', 'plain', 'gitdir'), `${path.join(mkTmp('ccrc-census-gone-'), 'never-created')}/.git\n`);
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
// A fixture repository with the given admin records (wt = a directory name made under the repo, or null).
function mini(recs: Array<{ name: string; files: Record<string, string>; wt: string | null }>): {
  repo: string; ccd: string; h1: string; h2: string; wt: (n: string) => string;
  meta: (home: string, proj: string, rel: string, body: object) => void;
} {
  const repo = mkTmp('ccrc-census-mini-');
  const ccd = mkTmp('ccrc-census-ccd-');
  const h1 = mkTmp('ccrc-census-h1-');
  const h2 = mkTmp('ccrc-census-h2-');
  const wt = (n: string): string => path.join(repo, '.wts', n);
  for (const r of recs) {
    const a = path.join(repo, '.git', 'worktrees', r.name);
    fs.mkdirSync(path.join(a, 'logs'), { recursive: true });
    for (const [f, body] of Object.entries(r.files)) fs.writeFileSync(path.join(a, f), body);
    if (r.wt !== null) { fs.mkdirSync(wt(r.wt), { recursive: true }); fs.writeFileSync(path.join(a, 'gitdir'), `${wt(r.wt)}/.git\n`); }
  }
  const meta = (home: string, proj: string, rel: string, body: object): void => {
    const f = path.join(home, 'projects', proj, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(body));
  };
  return { repo, ccd, h1, h2, wt, meta };
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
    expect(out.totals).toMatchObject({ records: 3, agent: 1, wf: 1, other: 1, metaFound: 2, metaMissing: 0, metaMalformed: 0, homesUnreadable: 0, multiHome: 1, worktreeAbsent: 1 });
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
    const r = census(['--repo', repo, '--home', mkTmp('ccrc-census-h-')]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ adminRead: 'absent', records: [] });
  });

  it('reports a .git FILE (a linked worktree) as not-main, never unreadable', () => {
    const repo = mkTmp('ccrc-census-linked-');
    fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /rig/elsewhere\n');
    const r = census(['--repo', repo, '--home', mkTmp('ccrc-census-h-')]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ adminRead: 'not-main', records: [] });
  });

  it('prints only allow-listed meta key names; an id-shaped key becomes (unprintable)', () => {
    const w = mini([{ name: 'agent-kk', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-kk' }]);
    const idKey = 'f'.repeat(40);
    w.meta(w.h1, munge(w.repo), 'u1/subagents/agent-kk.meta.json', { agentType: 'g', toolUseId: 'x', toolu_01ABCdef: 1, [idKey]: 2, worktreePath: w.wt('wt-kk') });
    const r = census(['--repo', w.repo, '--home', w.h1]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).records[0].meta.keys).toEqual(['(unprintable)', 'agentType', 'toolUseId', 'worktreePath']);
    expect(r.stdout.includes('toolu_01'), 'toolu_ key').toBe(false);
    expect(r.stdout.includes(idKey), '40-char key').toBe(false);
  });

  it('marks an unparsable agent meta malformed, distinct from a valid meta with no worktreePath', () => {
    const w = mini([
      { name: 'agent-bad', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-bad' },
      { name: 'agent-nop', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-nop' },
    ]);
    const bad = path.join(w.h1, 'projects', munge(w.repo), 'u1', 'subagents', 'agent-bad.meta.json');
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, '{not json');
    w.meta(w.h1, munge(w.repo), 'u1/subagents/agent-nop.meta.json', { agentType: 'g' });
    const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
    expect(out.records[0].meta).toMatchObject({ found: true, malformed: true, worktreePathEquals: null, keys: [] });
    expect(out.records[1].meta).toMatchObject({ found: true, malformed: false, worktreePathEquals: false, keys: ['agentType'] });
    expect(out.totals).toMatchObject({ metaMalformed: 1, metaFound: 2 });
  });

  it('marks a malformed or path-less workflow meta on its run, and a differing path is simply not found', () => {
    const w = mini([
      { name: 'wf_bad-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w1' },
      { name: 'wf_ok-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w2' },
      { name: 'wf_diff-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w3' },
    ]);
    const wfm = (run: string, file: string, body: string): void => {
      const f = path.join(w.h1, 'projects', munge(w.repo), 'u1', 'subagents', 'workflows', run, file);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    };
    wfm('wf_bad', 'a.meta.json', '{oops');
    wfm('wf_bad', 'b.meta.json', JSON.stringify({ workflowPhase: 'p' }));   // path-less
    wfm('wf_ok', 'a.meta.json', JSON.stringify({ workflowPhase: 'p', worktreePath: w.wt('wt-w2') }));
    wfm('wf_diff', 'a.meta.json', JSON.stringify({ workflowPhase: 'p', worktreePath: `${w.wt('wt-w3')}-other` }));
    const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
    const [bad, diff, ok] = out.records;   // sorted by admin name: wf_bad-1, wf_diff-1, wf_ok-1
    expect(bad.meta).toMatchObject({ found: false, malformed: true });
    expect(diff.meta).toMatchObject({ found: false, malformed: false });
    expect(ok.meta).toMatchObject({ found: true, malformed: false, worktreePathEquals: true });
    expect(out.totals).toMatchObject({ wf: 3, metaFound: 1, metaMissing: 2, metaMalformed: 1 });
  });

  it('counts an unreadable projects directory as an unreadable home, not as nothing there', () => {
    if (process.getuid?.() === 0) return;   // root reads through mode 000
    const w = mini([{ name: 'agent-un', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-un' }]);
    const projects = path.join(w.h1, 'projects');
    fs.mkdirSync(projects);
    fs.chmodSync(projects, 0o000);
    try {
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1, '--home', w.h2]).stdout);
      expect(out.totals).toMatchObject({ homesUnreadable: 1, metaFound: 0, metaMissing: 1 });
    } finally { fs.chmodSync(projects, 0o700); }
  });

  it('resolves a trailing slash on --repo and --ccd-root, and a relative gitdir against the record dir', () => {
    const w = mini([{ name: 'agent-rel', files: { HEAD: `${SHA_A}\n` }, wt: null }, { name: 'agent-ccdonly', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-c' }]);
    w.meta(w.h1, munge(path.join(w.ccd, 'p')), 'u3/subagents/agent-ccdonly.meta.json', { agentType: 'g' });
    fs.mkdirSync(path.join(w.repo, 'relwt'));
    fs.writeFileSync(path.join(w.repo, '.git', 'worktrees', 'agent-rel', 'gitdir'), '../../../relwt/.git\n');
    w.meta(w.h1, munge(w.repo), 'u1/subagents/agent-rel.meta.json', { agentType: 'g' });
    const out = JSON.parse(census(['--repo', `${w.repo}/`, '--ccd-root', `${w.ccd}/`, '--home', w.h1]).stdout);
    expect(out.records[1]).toMatchObject({ worktreeDir: 'present' });   // sorted: agent-ccdonly, agent-rel
    expect(out.records[1].meta.parentCwdClass).toBe('main-checkout');
    expect(out.records[0].meta.parentCwdClass).toBe('ccd-workspace');
    w.meta(w.h1, munge(path.join(w.ccd, 'p')), 'u2/subagents/agent-rel.meta.json', { agentType: 'g' });
    const mixed = JSON.parse(census(['--repo', `${w.repo}/`, '--ccd-root', `${w.ccd}/`, '--home', w.h1]).stdout);
    expect(mixed.records[1].meta.parentCwdClass).toBe('mixed');
    expect(mixed.totals.byParent).toEqual({ 'ccd-workspace': 1, mixed: 1 });
  });

  it('reports locked, a malformed HEAD and a malformed CLAUDE_BASE', () => {
    const w = mini([
      { name: 'plain-locked', files: { HEAD: `${SHA_A}\n`, locked: '' }, wt: 'wt-l' },
      { name: 'plain-head', files: { HEAD: 'not-a-head\n', CLAUDE_BASE: 'zzz' }, wt: 'wt-h' },
    ]);
    const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
    const [head, locked] = out.records;   // sorted: plain-head, plain-locked
    expect(locked).toMatchObject({ locked: true, head: 'detached', claudeBase: 'absent', movedFromBase: null });
    expect(head).toMatchObject({ locked: false, head: 'malformed', claudeBase: 'malformed', baseAgreesFirstLog: null, movedFromBase: null });
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
