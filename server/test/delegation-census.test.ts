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
    expect(out.totals).toMatchObject({ records: 3, agent: 1, wf: 1, other: 1, metaFound: 2, metaMissing: 0, metaMalformed: 0, metaUnreadable: 0, metaPathless: 0, homesUnreadable: 0, multiHome: 1, worktreeAbsent: 1, worktreeUnreadable: 0 });
    const agent = out.records.find((x: { kind: string }) => x.kind === 'agent');
    expect(agent).toMatchObject({ head: 'detached', claudeBase: 'ok', baseAgreesFirstLog: true, movedFromBase: true, locked: false, worktreeDir: 'present' });
    expect(agent.meta).toMatchObject({ found: true, homes: 2, uuids: 1, worktreePathEquals: true, parentCwdClass: 'main-checkout' });
    expect(agent.meta.keys).toEqual(['agentType', 'description', 'spawnedWithWorktree', 'toolUseId', 'worktreePath']);
    const wf = out.records.find((x: { kind: string }) => x.kind === 'wf');
    expect(wf).toMatchObject({ head: 'ref', movedFromBase: 'unmeasured' });   // a ref HEAD whose ref is absent: unmeasured, never null (null = no base)
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
    expect(out.records[0].meta).toMatchObject({ found: true, malformed: true, unreadable: false, worktreePathEquals: null, keys: [] });   // F8's control: unparsable is still malformed, never unreadable
    expect(out.records[1].meta).toMatchObject({ found: true, malformed: false, unreadable: false, pathless: true, worktreePathEquals: false, keys: ['agentType'] });
    expect(out.records[0].meta.pathless).toBe(false);   // the unparsable one is corruption, not the path-less shape
    expect(out.totals).toMatchObject({ metaMalformed: 1, metaUnreadable: 0, metaPathless: 1, metaFound: 2 });
  });

  it('marks a malformed workflow meta and a path-less one on their runs, separately; a differing path is simply not found', () => {
    const w = mini([
      { name: 'wf_bad-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w1' },
      { name: 'wf_nop-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w4' },
      { name: 'wf_ok-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w2' },
      { name: 'wf_diff-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w3' },
    ]);
    const wfm = (run: string, file: string, body: string): void => {
      const f = path.join(w.h1, 'projects', munge(w.repo), 'u1', 'subagents', 'workflows', run, file);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    };
    wfm('wf_bad', 'a.meta.json', '{oops');
    wfm('wf_bad', 'b.meta.json', '[1,2]');   // parses but is not an object: malformed too
    wfm('wf_nop', 'a.meta.json', JSON.stringify({ workflowPhase: 'p' }));   // parses, no worktreePath: the ordinary path-less shape
    wfm('wf_ok', 'a.meta.json', JSON.stringify({ workflowPhase: 'p', worktreePath: w.wt('wt-w2') }));
    wfm('wf_diff', 'a.meta.json', JSON.stringify({ workflowPhase: 'p', worktreePath: `${w.wt('wt-w3')}-other` }));
    const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
    const [bad, diff, nop, ok] = out.records;   // sorted by admin name: wf_bad-1, wf_diff-1, wf_nop-1, wf_ok-1
    expect(bad.meta).toMatchObject({ found: false, malformed: true, unreadable: false, pathless: false });   // F8's control: unparsable is still malformed, never unreadable
    expect(diff.meta).toMatchObject({ found: false, malformed: false, unreadable: false, pathless: false });
    expect(nop.meta).toMatchObject({ found: false, malformed: false, unreadable: false, pathless: true });
    expect(ok.meta).toMatchObject({ found: true, malformed: false, unreadable: false, pathless: false, worktreePathEquals: true });
    expect(out.totals).toMatchObject({ wf: 4, metaFound: 1, metaMissing: 3, metaMalformed: 1, metaUnreadable: 0, metaPathless: 1 });
  });

  // F8 (review 304): a meta that cannot be READ is not a meta that does not PARSE. The census gave both `malformed`, which
  // the header reserves for an unparsable one; a read failure (EISDIR, EACCES) is its own marker, `meta.unreadable` /
  // `totals.metaUnreadable`, and is neither malformed nor path-less (there is no content to be either). A DIRECTORY named
  // `<x>.meta.json` is the fixture that works as root too (reading it is EISDIR); the mode-000 rows skip as root.
  const metaDirAt = (home: string, repo: string, rel: string): string => path.join(home, 'projects', munge(repo), rel);
  const putRaw = (f: string, body: string): void => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };

  it('marks an agent meta that cannot be READ unreadable: not malformed, not path-less, no keys and no path comparison (review 304 F8)', () => {
    const w = mini([
      { name: 'agent-dir', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-dir' },
      { name: 'agent-bad', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-bad' },
      { name: 'agent-ok', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-ok' },
    ]);
    fs.mkdirSync(metaDirAt(w.h1, w.repo, 'u1/subagents/agent-dir.meta.json'), { recursive: true });   // reading a directory fails EISDIR
    putRaw(metaDirAt(w.h1, w.repo, 'u1/subagents/agent-bad.meta.json'), '{not json');
    w.meta(w.h1, munge(w.repo), 'u1/subagents/agent-ok.meta.json', { agentType: 'g', worktreePath: w.wt('wt-ok') });
    const r = census(['--repo', w.repo, '--home', w.h1]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    const [bad, dir, ok] = out.records;   // sorted by admin name: agent-bad, agent-dir, agent-ok
    expect(dir.meta).toMatchObject({ found: true, malformed: false, unreadable: true, pathless: false, worktreePathEquals: null, keys: [], homes: 1 });
    expect(bad.meta).toMatchObject({ found: true, malformed: true, unreadable: false, pathless: false });   // the control: an unparsable meta is still malformed
    expect(ok.meta).toMatchObject({ found: true, malformed: false, unreadable: false, pathless: false, worktreePathEquals: true });
    expect(out.totals).toMatchObject({ metaFound: 3, metaMalformed: 1, metaUnreadable: 1, metaPathless: 0 });
    for (const leak of ['agent-dir', '.meta.json', w.h1]) expect(r.stdout.includes(leak), leak).toBe(false);   // the marker is a boolean, never the name
  });

  it('marks a workflow meta that cannot be READ on its run as unreadable, apart from malformed and path-less (review 304 F8)', () => {
    const w = mini([
      { name: 'wf_dir-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w1' },
      { name: 'wf_bad-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w2' },
      { name: 'wf_ok-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-w3' },
    ]);
    const wfm = (run: string, file: string): string => path.join(w.h1, 'projects', munge(w.repo), 'u1', 'subagents', 'workflows', run, file);
    fs.mkdirSync(wfm('wf_dir', 'a.meta.json'), { recursive: true });   // EISDIR
    putRaw(wfm('wf_bad', 'a.meta.json'), '{oops');
    putRaw(wfm('wf_ok', 'a.meta.json'), JSON.stringify({ workflowPhase: 'p', worktreePath: w.wt('wt-w3') }));
    const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
    const [bad, dir, ok] = out.records;   // sorted: wf_bad-1, wf_dir-1, wf_ok-1
    expect(dir.meta).toMatchObject({ found: false, malformed: false, unreadable: true, pathless: false });
    expect(bad.meta).toMatchObject({ found: false, malformed: true, unreadable: false, pathless: false });   // the control
    expect(ok.meta).toMatchObject({ found: true, malformed: false, unreadable: false, pathless: false, worktreePathEquals: true });
    expect(out.totals).toMatchObject({ wf: 3, metaFound: 1, metaMissing: 2, metaMalformed: 1, metaUnreadable: 1, metaPathless: 0 });
  });

  it('a workflow run that holds a good meta beside an unreadable one and an unparsable one marks the record it names with both (review 304 F8)', () => {
    const w = mini([{ name: 'wf_mix-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-wx' }]);
    const wfm = (file: string): string => path.join(w.h1, 'projects', munge(w.repo), 'u1', 'subagents', 'workflows', 'wf_mix', file);
    putRaw(wfm('a.meta.json'), JSON.stringify({ workflowPhase: 'p', worktreePath: w.wt('wt-wx') }));   // names this record
    putRaw(wfm('b.meta.json'), '{oops');
    fs.mkdirSync(wfm('c.meta.json'));   // EISDIR
    const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
    expect(out.records[0].meta).toMatchObject({ found: true, malformed: true, unreadable: true, pathless: false, worktreePathEquals: true, keys: ['workflowPhase', 'worktreePath'] });
    expect(out.totals).toMatchObject({ metaFound: 1, metaMissing: 0, metaMalformed: 1, metaUnreadable: 1, metaPathless: 0 });
  });

  it('marks an agent meta and a workflow meta whose file refuses to be read (mode 000) unreadable, not malformed (review 304 F8)', () => {
    if (process.getuid?.() === 0) return;   // root reads through mode 000
    const w = mini([
      { name: 'agent-mode', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-am' },
      { name: 'wf_mode-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-wm' },
    ]);
    const a = metaDirAt(w.h1, w.repo, 'u1/subagents/agent-mode.meta.json');
    const f = metaDirAt(w.h1, w.repo, 'u1/subagents/workflows/wf_mode/a.meta.json');
    putRaw(a, JSON.stringify({ agentType: 'g', worktreePath: w.wt('wt-am') }));   // valid JSON: it would parse if it could be read
    putRaw(f, JSON.stringify({ workflowPhase: 'p', worktreePath: w.wt('wt-wm') }));
    fs.chmodSync(a, 0o000);
    fs.chmodSync(f, 0o000);
    try {
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
      const [agent, wf] = out.records;   // sorted: agent-mode, wf_mode-1
      expect(agent.meta).toMatchObject({ found: true, malformed: false, unreadable: true, pathless: false, worktreePathEquals: null, keys: [] });
      expect(wf.meta).toMatchObject({ found: false, malformed: false, unreadable: true, pathless: false });
      expect(out.totals).toMatchObject({ metaFound: 1, metaMissing: 1, metaMalformed: 0, metaUnreadable: 2, metaPathless: 0 });
    } finally { fs.chmodSync(a, 0o600); fs.chmodSync(f, 0o600); }
  });

  it('an unreadable meta contributes no keys and no path comparison, and is counted beside a malformed one, never as it (review 304 F8)', () => {
    const w = mini([
      { name: 'agent-mixa', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-xa' },
      { name: 'agent-mixb', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-xb' },
    ]);
    // mixa: a valid meta in h1 whose path matches, an unreadable one in h2; mixb: an unparsable one in h1, an unreadable one in h2.
    w.meta(w.h1, munge(w.repo), 'u1/subagents/agent-mixa.meta.json', { agentType: 'g', worktreePath: w.wt('wt-xa') });
    fs.mkdirSync(metaDirAt(w.h2, w.repo, 'u1/subagents/agent-mixa.meta.json'), { recursive: true });
    putRaw(metaDirAt(w.h1, w.repo, 'u1/subagents/agent-mixb.meta.json'), '{nope');
    fs.mkdirSync(metaDirAt(w.h2, w.repo, 'u1/subagents/agent-mixb.meta.json'), { recursive: true });
    const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1, '--home', w.h2]).stdout);
    const [a, b] = out.records;
    expect(a.meta).toMatchObject({ found: true, homes: 2, malformed: false, unreadable: true, pathless: false, worktreePathEquals: true, keys: ['agentType', 'worktreePath'] });
    expect(b.meta).toMatchObject({ found: true, homes: 2, malformed: true, unreadable: true, pathless: false, worktreePathEquals: null, keys: [] });
    expect(out.totals).toMatchObject({ metaMalformed: 1, metaUnreadable: 2, metaPathless: 0, multiHome: 2 });
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

  // F10 (review 304): `worktreeDir` and `claudeBase` no longer fold a failure into "nothing there". A worktree directory
  // whose stat fails with anything but ENOENT/ENOTDIR is 'unreadable' (`totals.worktreeUnreadable`), and a CLAUDE_BASE
  // whose read fails with anything but ENOENT/ENOTDIR is `claudeBase: 'unreadable'`, with `movedFromBase: 'unmeasured'`
  // (null means ONLY "no valid CLAUDE_BASE", and an unreadable one may be valid). A DIRECTORY named CLAUDE_BASE is the
  // fixture that works as root too (reading it is EISDIR); the mode-000 rows skip as root.
  it("reads a worktree directory that cannot be examined (its parent refuses search) as 'unreadable', never 'absent' (review 304 F10)", () => {
    if (process.getuid?.() === 0) return;   // root searches through mode 000
    const w = mini([{ name: 'agent-wu', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-wu' }]);
    const parent = path.dirname(w.wt('wt-wu'));
    fs.chmodSync(parent, 0o000);
    try {
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
      expect(out.records[0].worktreeDir).toBe('unreadable');
      expect(out.totals).toMatchObject({ worktreeUnreadable: 1, worktreeAbsent: 0 });
    } finally { fs.chmodSync(parent, 0o755); }
  });

  it("reads a worktree path under a regular file (ENOTDIR) and a missing one (ENOENT) as 'absent': nothing there, not unreadable (review 304 F10)", () => {
    const w = mini([
      { name: 'agent-wn', files: { HEAD: `${SHA_A}\n` }, wt: null },
      { name: 'agent-wo', files: { HEAD: `${SHA_A}\n` }, wt: null },
    ]);
    fs.writeFileSync(path.join(w.repo, 'a-file'), 'x');
    fs.writeFileSync(path.join(w.repo, '.git', 'worktrees', 'agent-wn', 'gitdir'), `${w.repo}/a-file/wt/.git\n`);   // stat: ENOTDIR
    fs.writeFileSync(path.join(w.repo, '.git', 'worktrees', 'agent-wo', 'gitdir'), `${w.repo}/no-such-dir/.git\n`);   // stat: ENOENT
    const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
    expect(out.records.map((x: { worktreeDir: string }) => x.worktreeDir)).toEqual(['absent', 'absent']);
    expect(out.totals).toMatchObject({ worktreeAbsent: 2, worktreeUnreadable: 0 });
  });

  describe('a CLAUDE_BASE that cannot be read (review 304 F10)', () => {
    const LOG = `${'0'.repeat(40)} ${SHA_A} Rig <you@example.com> 1 +0000\tbranch: Created\n`;   // a valid first log line: baseAgreesFirstLog could be answered
    // A detached HEAD and a ref HEAD, both resolvable, so only the CLAUDE_BASE is in doubt.
    function baseWorld(): ReturnType<typeof mini> & { admin: (n: string) => string } {
      const w = mini([
        { name: 'b-det', files: { HEAD: `${SHA_B}\n`, 'logs/HEAD': LOG }, wt: 'wt-b1' },
        { name: 'b-ref', files: { HEAD: 'ref: refs/heads/wt-bq\n', 'logs/HEAD': LOG }, wt: 'wt-b2' },
      ]);
      putRaw(path.join(w.repo, '.git', 'refs', 'heads', 'wt-bq'), `${SHA_B}\n`);
      return { ...w, admin: (n) => path.join(w.repo, '.git', 'worktrees', n) };
    }
    const expectUnreadable = (w: ReturnType<typeof mini>): void => {
      const r = census(['--repo', w.repo, '--home', w.h1]);
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout);
      for (const rec of out.records) {
        expect(rec).toMatchObject({ claudeBase: 'unreadable', baseAgreesFirstLog: null, movedFromBase: 'unmeasured' });
      }
      expect(out.records.map((x: { head: string }) => x.head)).toEqual(['detached', 'ref']);   // sorted: b-det, b-ref; the HEADs were measured fine
    };

    it("is 'unreadable' when CLAUDE_BASE is a directory (EISDIR), its movedFromBase 'unmeasured' and not null", () => {
      const w = baseWorld();
      for (const n of ['b-det', 'b-ref']) fs.mkdirSync(path.join(w.admin(n), 'CLAUDE_BASE'));
      expectUnreadable(w);
    });

    it("is 'unreadable' when the CLAUDE_BASE file refuses to be read (mode 000), its movedFromBase 'unmeasured' and not null", () => {
      if (process.getuid?.() === 0) return;   // root reads through mode 000
      const w = baseWorld();
      const files = ['b-det', 'b-ref'].map((n) => path.join(w.admin(n), 'CLAUDE_BASE'));
      for (const f of files) { fs.writeFileSync(f, SHA_A); fs.chmodSync(f, 0o000); }
      try { expectUnreadable(w); } finally { for (const f of files) fs.chmodSync(f, 0o600); }
    });

    it("is 'absent' when there is no CLAUDE_BASE (ENOENT) or the record is not a directory (ENOTDIR), its movedFromBase null", () => {
      const w = baseWorld();
      fs.writeFileSync(path.join(w.repo, '.git', 'worktrees', 'agent-file'), 'x');   // an admin entry that is a regular file: CLAUDE_BASE under it is ENOTDIR
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
      const [file, det, ref] = out.records;   // sorted: agent-file, b-det, b-ref
      expect(file).toMatchObject({ kind: 'agent', claudeBase: 'absent', movedFromBase: null });
      expect(det).toMatchObject({ claudeBase: 'absent', baseAgreesFirstLog: null, movedFromBase: null });   // ENOENT
      expect(ref).toMatchObject({ claudeBase: 'absent', movedFromBase: null });
    });
  });

  // KNOWN LIMIT (the header names it), pinned so that closing it is a visible edit and never an accident: three per-record
  // reads still fold a failure into their "nothing there" value. `locked` is false when its stat fails (the record directory
  // refuses search), `baseAgreesFirstLog` is null when `logs/HEAD` cannot be read, as it is when it is absent, and an
  // unreadable `gitdir` reads as an absent one: `worktreeDir: 'unmeasured'` and, for a workflow record, `meta.found: false`
  // (counted in `totals.metaMissing`) although its meta is on disk.
  it('KNOWN LIMIT: locked reads false when its stat fails, baseAgreesFirstLog null when logs/HEAD cannot be read, and an unreadable gitdir reads as an absent one (review 304 F10)', () => {
    if (process.getuid?.() === 0) return;   // root reads through mode 000
    const LOG = `${'0'.repeat(40)} ${SHA_A} Rig <you@example.com> 1 +0000\tbranch: Created\n`;
    const w = mini([
      { name: 'agent-lg', files: { HEAD: `${SHA_A}\n`, CLAUDE_BASE: SHA_A, 'logs/HEAD': LOG }, wt: 'wt-lg' },
      { name: 'agent-lk', files: { HEAD: `${SHA_A}\n`, CLAUDE_BASE: SHA_A, 'logs/HEAD': LOG, locked: '' }, wt: 'wt-lk' },
      { name: 'agent-ok', files: { HEAD: `${SHA_A}\n`, CLAUDE_BASE: SHA_A, 'logs/HEAD': LOG, locked: '' }, wt: 'wt-ok' },
      { name: 'wf_gd-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-gd' },   // gitdir at mode 000
      { name: 'wf_gdabs-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: null },   // no gitdir at all
      { name: 'wf_gdok-1', files: { HEAD: 'ref: refs/heads/x\n' }, wt: 'wt-gdok' },   // the control: a readable gitdir
    ]);
    const admin = (n: string): string => path.join(w.repo, '.git', 'worktrees', n);
    for (const [run, wt] of [['wf_gd', 'wt-gd'], ['wf_gdabs', 'wt-gdabs'], ['wf_gdok', 'wt-gdok']]) {
      w.meta(w.h1, munge(w.repo), `u1/subagents/workflows/${run}/a.meta.json`, { workflowPhase: 'p', worktreePath: w.wt(wt) });   // each meta is on disk
    }
    const gitdir = path.join(admin('wf_gd-1'), 'gitdir');
    fs.chmodSync(path.join(admin('agent-lg'), 'logs', 'HEAD'), 0o000);
    fs.chmodSync(admin('agent-lk'), 0o400);   // listable, not searchable: `locked` (and every read inside) fails EACCES
    fs.chmodSync(gitdir, 0o000);
    try {
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
      const [lg, lk, ok, gd, gdabs, gdok] = out.records;   // sorted: agent-lg, agent-lk, agent-ok, wf_gd-1, wf_gdabs-1, wf_gdok-1
      expect(ok).toMatchObject({ locked: true, baseAgreesFirstLog: true });   // the controls: both are measurable
      expect(lg).toMatchObject({ locked: false, baseAgreesFirstLog: null });
      expect(lk).toMatchObject({ locked: false, worktreeDir: 'unmeasured', claudeBase: 'unreadable' });   // locked is on disk, and reads false
      expect(gdok).toMatchObject({ worktreeDir: 'present', meta: { found: true } });
      expect(gd).toMatchObject({ worktreeDir: 'unmeasured', meta: { found: false } });
      expect(gd.worktreeDir).toBe(gdabs.worktreeDir);   // an unreadable gitdir and an absent one read alike
      expect(gd.meta).toEqual(gdabs.meta);
      expect(out.totals.metaFound).toBe(1);   // only wf_gdok-1's meta is found; wf_gd-1's is on disk, and counted in metaMissing with the rest
    } finally { fs.chmodSync(admin('agent-lk'), 0o755); fs.chmodSync(path.join(admin('agent-lg'), 'logs', 'HEAD'), 0o600); fs.chmodSync(gitdir, 0o600); }
  });

  // Root-proof (EISDIR fails for root too): `text` is the convenience read that folds an unreadable file to null, so a
  // DIRECTORY where `gitdir`, `HEAD`, `logs/HEAD` or `packed-refs` belongs reads as an absent one and the census still answers.
  // Without that fold the UNREADABLE symbol reaches a `.trim()`, a regex or a `.split`, and the census dies on a TypeError.
  it('reads a gitdir, HEAD, logs/HEAD or packed-refs that is a DIRECTORY (EISDIR) as an unreadable one, and still answers (review 304 F10)', () => {
    const w = mini([
      { name: 'agent-hd', files: { CLAUDE_BASE: SHA_A }, wt: 'wt-hd' },   // HEAD is a directory
      { name: 'agent-gd', files: { HEAD: `${SHA_A}\n`, CLAUDE_BASE: SHA_A }, wt: null },   // gitdir is a directory
      { name: 'agent-lh', files: { HEAD: `${SHA_A}\n`, CLAUDE_BASE: SHA_A }, wt: 'wt-lh' },   // logs/HEAD is a directory
      { name: 'agent-pr', files: { HEAD: 'ref: refs/heads/wt-pr\n', CLAUDE_BASE: SHA_A }, wt: 'wt-pr' },   // no loose ref, and packed-refs is a directory
    ]);
    const admin = (n: string): string => path.join(w.repo, '.git', 'worktrees', n);
    fs.mkdirSync(path.join(admin('agent-hd'), 'HEAD'));
    fs.mkdirSync(path.join(admin('agent-gd'), 'gitdir'));
    fs.mkdirSync(path.join(admin('agent-lh'), 'logs', 'HEAD'));
    fs.mkdirSync(path.join(w.repo, '.git', 'packed-refs'));
    const r = census(['--repo', w.repo, '--home', w.h1]);
    expect(r.status, r.stderr).toBe(0);
    const [gd, hd, lh, pr] = JSON.parse(r.stdout).records;   // sorted: agent-gd, agent-hd, agent-lh, agent-pr
    expect(gd).toMatchObject({ worktreeDir: 'unmeasured' });
    expect(hd).toMatchObject({ head: 'unreadable', movedFromBase: 'unmeasured' });
    expect(lh).toMatchObject({ head: 'detached', baseAgreesFirstLog: null, movedFromBase: false });
    expect(pr).toMatchObject({ head: 'ref', movedFromBase: 'unmeasured' });
  });

  // F11(a): a real config home's project dir holds <uuid>.jsonl FILES beside the <uuid>/ dirs, so listing
  // `<file>/subagents` fails ENOTDIR. That is "nothing there", never an unreadable home.
  it('treats a <uuid>.jsonl file beside a <uuid>/ dir as nothing there, not as an unreadable home', () => {
    const w = mini([{ name: 'agent-nt', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-nt' }]);
    w.meta(w.h1, munge(w.repo), 'u1/subagents/agent-nt.meta.json', { agentType: 'g', worktreePath: w.wt('wt-nt') });
    fs.writeFileSync(path.join(w.h1, 'projects', munge(w.repo), 'u1.jsonl'), '{}\n');
    fs.writeFileSync(path.join(w.h1, 'projects', munge(w.repo), 'u0.jsonl'), '{}\n');
    const r = census(['--repo', w.repo, '--home', w.h1]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.totals).toMatchObject({ homesUnreadable: 0, metaFound: 1, metaMissing: 0 });
    expect(out.records[0].meta).toMatchObject({ found: true, homes: 1, uuids: 1, worktreePathEquals: true });
  });

  // F11(b): `homes` counts DISTINCT homes. One record with two metas under the SAME home (two project dirs in
  // one home) is one home, and is not multi-home.
  it('counts distinct homes: two metas for one record under the same home are one home, not multiHome', () => {
    const w = mini([{ name: 'agent-dh', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-dh' }]);
    const body = { agentType: 'g', worktreePath: w.wt('wt-dh') };
    w.meta(w.h1, munge(w.repo), 'u1/subagents/agent-dh.meta.json', body);
    w.meta(w.h1, munge(path.join(w.ccd, 'p')), 'u2/subagents/agent-dh.meta.json', body);
    const out = JSON.parse(census(['--repo', w.repo, '--ccd-root', w.ccd, '--home', w.h1]).stdout);
    expect(out.records[0].meta).toMatchObject({ found: true, homes: 1, uuids: 2, parentCwdClass: 'mixed' });
    expect(out.totals.multiHome).toBe(0);
    const two = JSON.parse(census(['--repo', w.repo, '--ccd-root', w.ccd, '--home', w.h1, '--home', w.h2]).stdout);
    expect(two.totals.multiHome).toBe(0);   // h2 holds nothing for it: still one home
    w.meta(w.h2, munge(w.repo), 'u1/subagents/agent-dh.meta.json', body);
    const both = JSON.parse(census(['--repo', w.repo, '--ccd-root', w.ccd, '--home', w.h1, '--home', w.h2]).stdout);
    expect(both.records[0].meta.homes).toBe(2);
    expect(both.totals.multiHome).toBe(1);
  });

  // F9 (review 304): `--home` is resolved like `--repo` and `--ccd-root`. `homes` counts DISTINCT homes, and one home
  // spelled two ways (`<h>` and `<h>/`) is one home: it read every meta twice and counted its record in `multiHome`.
  it('resolves --home like --repo: one home spelled two ways is one home, not multiHome (review 304 F9)', () => {
    const w = mini([{ name: 'agent-hs', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-hs' }]);
    w.meta(w.h1, munge(w.repo), 'u1/subagents/agent-hs.meta.json', { agentType: 'g', worktreePath: w.wt('wt-hs') });
    for (const homes of [[w.h1, `${w.h1}/`], [`${w.h1}/`, w.h1], [w.h1, `${w.h1}/.`]]) {
      const out = JSON.parse(census(['--repo', w.repo, ...homes.flatMap((h) => ['--home', h])]).stdout);
      expect(out.records[0].meta, homes.join(' ')).toMatchObject({ found: true, homes: 1, uuids: 1 });
      expect(out.totals.multiHome, homes.join(' ')).toBe(0);
    }
    w.meta(w.h2, munge(w.repo), 'u1/subagents/agent-hs.meta.json', { agentType: 'g', worktreePath: w.wt('wt-hs') });
    const two = JSON.parse(census(['--repo', w.repo, '--home', w.h1, '--home', `${w.h1}/`, '--home', w.h2]).stdout);
    expect(two.records[0].meta.homes).toBe(2);   // the control: a second, different home still counts
    expect(two.totals.multiHome).toBe(1);
  });

  it('counts one unreadable home spelled two ways once (review 304 F9)', () => {
    if (process.getuid?.() === 0) return;   // root reads through mode 000
    const w = mini([{ name: 'agent-hu', files: { HEAD: `${SHA_A}\n` }, wt: 'wt-hu' }]);
    const projects = path.join(w.h1, 'projects');
    fs.mkdirSync(projects);
    fs.chmodSync(projects, 0o000);
    try {
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1, '--home', `${w.h1}/`]).stdout);
      expect(out.totals.homesUnreadable).toBe(1);
    } finally { fs.chmodSync(projects, 0o700); }
  });

  // F14: movedFromBase for every HEAD shape. null means ONLY "no valid CLAUDE_BASE to compare against"; a HEAD
  // the census cannot resolve to a commit is 'unmeasured'. A ref HEAD resolves READ-ONLY in `<repo>/.git`.
  describe('movedFromBase', () => {
    const LOOSE_NAME = 'worktree-SENTINEL-refname';
    function refWorld(): { w: ReturnType<typeof mini>; out: { records: Array<{ movedFromBase: unknown }>; totals: Record<string, number> }; stdout: string; at: (n: string) => unknown } {
      const base = { CLAUDE_BASE: SHA_A };
      const recs: Parameters<typeof mini>[0] = [
        { name: 'r-loose-eq', files: { HEAD: `ref: refs/heads/${LOOSE_NAME}\n`, ...base }, wt: 'wt-1' },
        { name: 'r-loose-ne', files: { HEAD: 'ref: refs/heads/worktree-two\n', ...base }, wt: 'wt-2' },
        { name: 'r-packed-eq', files: { HEAD: 'ref: refs/heads/worktree-pk\n', ...base }, wt: 'wt-3' },
        { name: 'r-packed-ne', files: { HEAD: 'ref: refs/heads/worktree-pk-other\n', ...base }, wt: 'wt-4' },
        { name: 'r-packed-junk', files: { HEAD: 'ref: refs/heads/worktree-pk-junk\n', ...base }, wt: 'wt-14' },
        { name: 'r-packed-xsha', files: { HEAD: 'ref: refs/heads/wt-x\n', ...base }, wt: 'wt-15' },
        { name: 'r-packed-trail', files: { HEAD: 'ref: refs/heads/wt-y\n', ...base }, wt: 'wt-16' },
        { name: 'r-dir-packed', files: { HEAD: 'ref: refs/heads/worktree-dir\n', ...base }, wt: 'wt-17' },
        { name: 'r-absent', files: { HEAD: 'ref: refs/heads/worktree-nowhere\n', ...base }, wt: 'wt-5' },
        { name: 'r-symbolic', files: { HEAD: 'ref: refs/heads/worktree-sym\n', ...base }, wt: 'wt-6' },
        { name: 'r-junk', files: { HEAD: 'ref: refs/heads/worktree-junk\n', ...base }, wt: 'wt-7' },
        { name: 'r-nobase', files: { HEAD: `ref: refs/heads/${LOOSE_NAME}\n` }, wt: 'wt-8' },
        { name: 'r-badbase', files: { HEAD: `ref: refs/heads/${LOOSE_NAME}\n`, CLAUDE_BASE: 'zzz' }, wt: 'wt-9' },
        { name: 'd-eq', files: { HEAD: `${SHA_A}\n`, ...base }, wt: 'wt-10' },
        { name: 'd-ne', files: { HEAD: `${SHA_B}\n`, ...base }, wt: 'wt-11' },
        { name: 'h-malformed', files: { HEAD: 'not-a-head\n', ...base }, wt: 'wt-12' },
        { name: 'h-unreadable', files: { ...base }, wt: 'wt-13' },
      ];
      const w = mini(recs);
      const git = path.join(w.repo, '.git');
      const put = (rel: string, body: string): void => { fs.mkdirSync(path.dirname(path.join(git, rel)), { recursive: true }); fs.writeFileSync(path.join(git, rel), body); };
      put(`refs/heads/${LOOSE_NAME}`, `${SHA_A}\n`);
      put('refs/heads/worktree-two', `${SHA_B}\n`);
      put('refs/heads/worktree-sym', 'ref: refs/heads/worktree-two\n');
      put('refs/heads/worktree-junk', 'not a sha at all\n');
      fs.mkdirSync(path.join(git, 'refs', 'heads', 'worktree-dir'), { recursive: true });   // a leftover EMPTY directory at the loose path
      put('packed-refs', [
        '# pack-refs with: peeled fully-peeled sorted',
        `${SHA_B} refs/heads/worktree-pk-zz`,
        `${SHA_A} refs/heads/worktree-pk`,
        `^${SHA_B}`,
        `${SHA_B} refs/heads/worktree-pk-other`,
        `${'z'.repeat(40)} refs/heads/worktree-pk-junk`,   // a packed line whose first field is not a sha
        `${SHA_B} refs/heads/worktree-sym`,   // a stale packed line behind a loose ref that is not a sha: the loose file wins
        `${SHA_B} refs/heads/worktree-junk`,
        `x${SHA_B} refs/heads/wt-x`,   // a sha with a stray prefix: the line is anchored at its start
        `${SHA_B} refs/heads/wt-y junk`,   // a name with trailing text: the line is anchored at its end
        `${SHA_B} refs/heads/worktree-dir`,   // git falls through a directory at the loose path to packed-refs
        '',
      ].join('\n'));
      const r = census(['--repo', w.repo, '--home', w.h1]);
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout);
      const order = recs.map((x) => x.name).sort();
      return { w, out, stdout: r.stdout, at: (n) => out.records[order.indexOf(n)].movedFromBase };
    }

    it('a ref: HEAD whose loose ref equals CLAUDE_BASE has not moved; one that differs has', () => {
      const { at } = refWorld();
      expect(at('r-loose-eq')).toBe(false);
      expect(at('r-loose-ne')).toBe(true);
    });

    it('a ref: HEAD resolves through packed-refs when there is no loose ref (comment and peeled lines skipped, name matched exactly)', () => {
      const { at } = refWorld();
      expect(at('r-packed-eq')).toBe(false);
      expect(at('r-packed-ne')).toBe(true);
      expect(at('r-dir-packed')).toBe(true);   // a directory at the loose path is not a loose ref: packed-refs answers (as git does)
    });

    it("reports 'unmeasured', never null, for a ref that does not resolve and for an unreadable or malformed HEAD", () => {
      const { at } = refWorld();
      expect(at('r-absent')).toBe('unmeasured');   // no loose file, no packed line
      expect(at('r-symbolic')).toBe('unmeasured');   // a symbolic loose ref is not followed, and a stale packed line does not stand in for it
      expect(at('r-junk')).toBe('unmeasured');   // a loose file that is not a sha does not fall through to packed-refs
      expect(at('r-packed-junk')).toBe('unmeasured');   // a packed-refs line that is not <sha> <name>
      expect(at('r-packed-xsha')).toBe('unmeasured');   // `x<sha> <name>`: not a line that STARTS with a sha
      expect(at('r-packed-trail')).toBe('unmeasured');   // `<sha> <name> junk`: not a line that ENDS at the name
      expect(at('h-malformed')).toBe('unmeasured');
      expect(at('h-unreadable')).toBe('unmeasured');
    });

    it('keeps null only for a record with no valid CLAUDE_BASE, and keeps comparing a detached HEAD', () => {
      const { at } = refWorld();
      expect(at('r-nobase')).toBeNull();
      expect(at('r-badbase')).toBeNull();
      expect(at('d-eq')).toBe(false);
      expect(at('d-ne')).toBe(true);
    });

    it('prints no ref name, sha or path while resolving refs', () => {
      const { w, out, stdout } = refWorld();
      expect(out.totals.records).toBe(17);   // the scan below ran over a real document
      for (const bad of [w.repo, w.h1, LOOSE_NAME, 'SENTINEL', 'refs/', 'heads', 'packed', SHA_A, SHA_B, 'worktree-pk', 'r-loose']) {
        expect(stdout.includes(bad), bad).toBe(false);
      }
    });

    it("reports 'unmeasured' for a loose ref that exists but cannot be read, never the stale packed-refs line behind it", () => {
      if (process.getuid?.() === 0) return;   // root reads through mode 000
      const w = mini([{ name: 'r-eacces', files: { HEAD: 'ref: refs/heads/wt-eacces\n', CLAUDE_BASE: SHA_A }, wt: 'wt-g' }]);
      const git = path.join(w.repo, '.git');
      const loose = path.join(git, 'refs', 'heads', 'wt-eacces');
      fs.mkdirSync(path.dirname(loose), { recursive: true });
      fs.writeFileSync(loose, `${SHA_A}\n`);   // the real tip: equal to CLAUDE_BASE
      fs.writeFileSync(path.join(git, 'packed-refs'), `${SHA_B} refs/heads/wt-eacces\n`);   // stale: would read `true`
      fs.chmodSync(loose, 0o000);
      try {
        const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
        expect(out.records[0].movedFromBase).toBe('unmeasured');
      } finally { fs.chmodSync(loose, 0o600); }
    });

    // F13 (+ review I1/M2): what sits at the loose-ref path, judged as git's files backend judges it: it lstats the path;
    // ENOENT falls through to packed-refs, a REAL directory falls through too, and anything else is read (an error
    // there is an error, never a fall-through). Measured read-only in a temp repo with a stale packed-refs line, by
    // `git rev-parse HEAD` in a linked worktree whose HEAD is `ref: refs/heads/<n>`:
    //   valid symlink to a file ........ the target's sha (followed; beats the packed line)   -> the census agrees
    //   DANGLING symlink ............... fails "unknown revision" (for-each-ref alone would fall through)
    //   symlink to a DIRECTORY ......... fails "unknown revision"
    //   real directory / nothing ....... the packed line
    //   a symlink whose TEXT is a ref name (git's symbolic-ref form, resolved from the git dir) .... resolves; the census
    //     reads it as a file path under the link's own directory, normally finds nothing and answers 'unmeasured':
    //     fail-closed, a KNOWN LIMIT (pinned below so that resolving it on purpose is a visible edit, never an accident).
    //     Where that relative path does exist (a doubled refs/heads/refs/heads/<n>), the census reads the wrong ref: the
    //     limit is then a possibly wrong boolean, a shape nothing Claude Code is known to make.
    function symWorld(): (n: string) => unknown {
      const w = mini([
        { name: 's-valid', files: { HEAD: 'ref: refs/heads/wt-link\n', CLAUDE_BASE: SHA_A }, wt: 'wt-s1' },
        { name: 's-dangling', files: { HEAD: 'ref: refs/heads/wt-dangle\n', CLAUDE_BASE: SHA_A }, wt: 'wt-s2' },
        { name: 's-absent', files: { HEAD: 'ref: refs/heads/wt-packed-only\n', CLAUDE_BASE: SHA_A }, wt: 'wt-s3' },
        { name: 's-dirlink', files: { HEAD: 'ref: refs/heads/wt-dirlink\n', CLAUDE_BASE: SHA_A }, wt: 'wt-s4' },
        { name: 's-textlink', files: { HEAD: 'ref: refs/heads/wt-textlink\n', CLAUDE_BASE: SHA_A }, wt: 'wt-s5' },
      ]);
      const git = path.join(w.repo, '.git');
      const heads = path.join(git, 'refs', 'heads');
      fs.mkdirSync(heads, { recursive: true });
      fs.writeFileSync(path.join(w.repo, 'link-target'), `${SHA_A}\n`);   // the real tip: equal to CLAUDE_BASE
      fs.mkdirSync(path.join(w.repo, 'a-dir'));
      fs.symlinkSync(path.join(w.repo, 'link-target'), path.join(heads, 'wt-link'));
      fs.symlinkSync(path.join(w.repo, 'no-such-file'), path.join(heads, 'wt-dangle'));
      fs.symlinkSync(path.join(w.repo, 'a-dir'), path.join(heads, 'wt-dirlink'));
      fs.symlinkSync('refs/heads/wt-link', path.join(heads, 'wt-textlink'));   // the symbolic-ref text form (git resolves it to SHA_A)
      fs.writeFileSync(path.join(git, 'packed-refs'), [
        `${SHA_B} refs/heads/wt-link`,   // stale: would read `true` if the valid symlink were not followed
        `${SHA_B} refs/heads/wt-dangle`,   // stale: would read `true` if a dangling symlink counted as "nothing there"
        `${SHA_B} refs/heads/wt-packed-only`,   // no loose path at all (lstat ENOENT): packed-refs answers
        `${SHA_B} refs/heads/wt-dirlink`,   // stale: would read `true` if a symlink to a directory counted as a directory
        `${SHA_B} refs/heads/wt-textlink`,   // stale: would read `true` if the text form fell through
        '',
      ].join('\n'));
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
      const order = ['s-valid', 's-dangling', 's-absent', 's-dirlink', 's-textlink'].sort();
      return (n) => out.records[order.indexOf(n)].movedFromBase;
    }
    it("reports 'unmeasured' for a loose ref that is a DANGLING symlink, never the stale packed-refs line behind it", () => {
      expect(symWorld()('s-dangling')).toBe('unmeasured');
    });
    it("reports 'unmeasured' for a loose ref that is a symlink to a DIRECTORY (git fails there too), never the stale packed-refs line behind it", () => {
      expect(symWorld()('s-dirlink')).toBe('unmeasured');
    });
    it('follows a loose ref that is a VALID symlink, as git does (the target holds the real tip; the packed line is stale)', () => {
      expect(symWorld()('s-valid')).toBe(false);
    });
    it('still answers from packed-refs when nothing at all is at the loose path (the lstat agrees: ENOENT stays "nothing there")', () => {
      expect(symWorld()('s-absent')).toBe(true);
    });
    it("KNOWN LIMIT: a loose ref that is a symlink whose text is a ref name (git's symbolic-ref form) reads 'unmeasured', fail-closed", () => {
      expect(symWorld()('s-textlink')).toBe('unmeasured');
    });
    // lstat fails with something other than ENOENT: here the parent directory refuses search (mode 000), so the path
    // cannot be examined at all. Measured: `git rev-parse HEAD` fails "unknown revision" there while `for-each-ref`
    // alone falls through to the packed line; the census says 'unmeasured', never the stale packed line.
    it("reports 'unmeasured' when the loose path cannot be examined at all (its parent directory refuses search), never the stale packed-refs line", () => {
      if (process.getuid?.() === 0) return;   // root searches through mode 000
      const w = mini([{ name: 's-noaccess', files: { HEAD: 'ref: refs/heads/wt-noaccess\n', CLAUDE_BASE: SHA_A }, wt: 'wt-s6' }]);
      const git = path.join(w.repo, '.git');
      const heads = path.join(git, 'refs', 'heads');
      fs.mkdirSync(heads, { recursive: true });
      fs.writeFileSync(path.join(heads, 'wt-noaccess'), `${SHA_A}\n`);   // the real tip: equal to CLAUDE_BASE
      fs.writeFileSync(path.join(git, 'packed-refs'), `${SHA_B} refs/heads/wt-noaccess\n`);   // stale: would read `true`
      fs.chmodSync(heads, 0o000);
      try {
        const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
        expect(out.records[0].movedFromBase).toBe('unmeasured');
      } finally { fs.chmodSync(heads, 0o755); }
    });

    // lstat fails ENOTDIR: a parent component of the loose path is a regular file (the census's own `ls` helper folds
    // ENOTDIR into "nothing there"; this reader must not). Measured: `git rev-parse HEAD` fails "unknown revision".
    it("reports 'unmeasured' when a parent component of the loose path is a file (lstat ENOTDIR), never the stale packed-refs line", () => {
      const w = mini([{ name: 's-notdir', files: { HEAD: 'ref: refs/heads/wt-nd/x\n', CLAUDE_BASE: SHA_A }, wt: 'wt-n1' }]);
      const git = path.join(w.repo, '.git');
      const heads = path.join(git, 'refs', 'heads');
      fs.mkdirSync(heads, { recursive: true });
      fs.writeFileSync(path.join(heads, 'wt-nd'), `${SHA_A}\n`);   // a parent component is a regular file: lstat ENOTDIR
      fs.writeFileSync(path.join(git, 'packed-refs'), `${SHA_B} refs/heads/wt-nd/x\n`);   // stale: would read `true`
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
      expect(out.records[0].movedFromBase).toBe('unmeasured');
    });

    it("refuses a ref name that is not shaped refs/<safe chars> or has a .. segment: 'unmeasured', never joined onto a path", () => {
      const w = mini([
        { name: 'x-dotdot', files: { HEAD: 'ref: refs/../../planted\n', CLAUDE_BASE: SHA_A }, wt: 'wt-a' },
        { name: 'x-dotdot2', files: { HEAD: 'ref: refs/heads/../../../planted2\n', CLAUDE_BASE: SHA_A }, wt: 'wt-b' },
        { name: 'x-noprefix', files: { HEAD: 'ref: planted3\n', CLAUDE_BASE: SHA_A }, wt: 'wt-c' },
        { name: 'x-badchar', files: { HEAD: 'ref: refs/heads/wt space\n', CLAUDE_BASE: SHA_A }, wt: 'wt-d' },
        { name: 'x-anchor', files: { HEAD: 'ref: x/refs/planted4\n', CLAUDE_BASE: SHA_A }, wt: 'wt-f' },
        { name: 'x-control', files: { HEAD: 'ref: refs/heads/ok\n', CLAUDE_BASE: SHA_A }, wt: 'wt-e' },
      ]);
      const git = path.join(w.repo, '.git');
      // Each name, joined onto the common dir, WOULD land on a planted file holding a sha that differs from CLAUDE_BASE.
      fs.writeFileSync(path.join(w.repo, 'planted'), `${SHA_B}\n`);                // <repo>/.git/refs/../../planted
      fs.writeFileSync(path.join(w.repo, 'planted2'), `${SHA_B}\n`);               // <repo>/.git/refs/heads/../../../planted2
      fs.writeFileSync(path.join(git, 'planted3'), `${SHA_B}\n`);                  // <repo>/.git/planted3
      fs.mkdirSync(path.join(git, 'x', 'refs'), { recursive: true });
      fs.writeFileSync(path.join(git, 'x', 'refs', 'planted4'), `${SHA_B}\n`);     // <repo>/.git/x/refs/planted4: contains refs/, does not START with it
      fs.mkdirSync(path.join(git, 'refs', 'heads'), { recursive: true });
      fs.writeFileSync(path.join(git, 'refs', 'heads', 'wt space'), `${SHA_B}\n`);
      fs.writeFileSync(path.join(git, 'refs', 'heads', 'ok'), `${SHA_B}\n`);
      const out = JSON.parse(census(['--repo', w.repo, '--home', w.h1]).stdout);
      const order = ['x-dotdot', 'x-dotdot2', 'x-noprefix', 'x-badchar', 'x-anchor', 'x-control'].sort();
      const at = (n: string): unknown => out.records[order.indexOf(n)].movedFromBase;
      expect(at('x-dotdot')).toBe('unmeasured');
      expect(at('x-dotdot2')).toBe('unmeasured');
      expect(at('x-noprefix')).toBe('unmeasured');
      expect(at('x-badchar')).toBe('unmeasured');
      expect(at('x-anchor')).toBe('unmeasured');   // `refs/` somewhere inside the name is not the shape: the match is anchored at its start
      expect(at('x-control')).toBe(true);   // the same planting, under a well-shaped name, does resolve
    });
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
