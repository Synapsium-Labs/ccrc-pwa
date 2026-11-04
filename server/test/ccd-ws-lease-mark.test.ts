// Delegation broker wave 5, PR1 (Tasks 5.1.2 and 5.1.3): the lease library and `ccd ws-lease-mark`, the carrier's one writer.
// Every case runs on a FIXTURE HOME (`makeCcdHarness`): nothing here reads or writes the live `~/.cc-sessions`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lease-mark-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

describe('the lease library arrives, loaded beside the other two', () => {
  it('W5-A1: a source checkout loads the lease library beside the other two', () => {
    expect(h.sh('declare -F _dl_leases_dir >/dev/null && echo defined').trim()).toBe('defined');
  });

  it('W5-A1b: the leases directory is made 0700 with .locks and by-tree, and refused through a link', () => {
    const reg = path.join(h.home, '.cc-sessions');
    expect(h.sh('_dl_leases_dir; echo "rc=$?"').trim().split('\n').pop()).toBe('rc=0');
    expect(fs.readdirSync(path.join(reg, 'delegation', 'leases')).sort()).toEqual(['.locks', 'by-tree']);
    expect(fs.statSync(path.join(reg, 'delegation', 'leases')).mode & 0o777).toBe(0o700);
    fs.rmSync(path.join(reg, 'delegation'), { recursive: true });
    const elsewhere = fs.mkdtempSync(path.join(h.home, 'elsewhere-'));
    fs.symlinkSync(elsewhere, path.join(reg, 'delegation'));
    expect(h.sh('_dl_leases_dir; echo "rc=$?"').trim().split('\n').pop()).toBe('rc=1');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });
});

const LEASE = '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab';
const OTHER = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const THIRD = '2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091';
const INC = '11111111-2222-4333-8444-555555555555';
const hex = (s: string): string => Buffer.from(s).toString('hex');
const reg = (): string => path.join(h.home, '.cc-sessions');
const leasesDir = (): string => path.join(reg(), 'delegation', 'leases');
const main = (): string => path.join(h.home, 'projects', 'demo');
const agentTree = (name = 'agent-a', at = path.join(main(), '.claude', 'worktrees', name), from = main()): string => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  h.git(from, 'worktree', 'add', '-b', `claude/${name}`, '--', at);
  return fs.realpathSync(at);
};
type Flags = Record<string, string | null>;
const BASE: Flags = { lease: LEASE, generation: '1', project: 'demo', 'admin-record-hex': hex('agent-a'),
  parent: 'lane-a-demo', 'parent-incarnation': INC, activity: 'act-1', source: 'agent', state: 'ephemeral', 'journal-seq': '7' };
interface Out { code: number; doc: Record<string, unknown>; lines: string[] }
const run = (argv: string, pre = ''): Out => {
  const out = h.sh(`${pre} cmd_ws_lease_mark ${argv}; echo "rc=$?"`).trim().split('\n');
  const code = Number(/^rc=(\d+)$/.exec(out.pop()!)![1]);
  return { code, lines: out, doc: JSON.parse(out[out.length - 1] ?? '{}') as Record<string, unknown> };
};
const mark = (over: Flags = {}, pre = ''): Out =>
  run(Object.entries({ ...BASE, ...over }).filter(([, v]) => v !== null).map(([k, v]) => `--${k} ${v}`).join(' '), pre);
const carrierPath = (id = LEASE): string => path.join(leasesDir(), `${id}.json`);
const carrier = (id = LEASE): Record<string, unknown> => JSON.parse(fs.readFileSync(carrierPath(id), 'utf8')) as Record<string, unknown>;
const byTree = (): string[] => fs.readdirSync(path.join(leasesDir(), 'by-tree')).filter((f) => !f.startsWith('.'));
const entry = (): string => fs.readFileSync(path.join(leasesDir(), 'by-tree', byTree()[0]!), 'utf8').trim();
/** Refused: the word, rc 1 (2 for usage), one line of stdout, and the carrier as it was (absent, or these bytes). */
const refused = (r: Out, word: string, before: Buffer | null = null): void => {
  expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: false, refusal: word });
  expect(r.code).toBe(word === 'usage' ? 2 : 1);
  expect(r.lines).toHaveLength(1);
  if (before === null) expect(fs.existsSync(carrierPath())).toBe(false);
  else expect(fs.readFileSync(carrierPath())).toEqual(before);
};
/** `_plat_mv_notdir` fails when `when` (a bash test over its call count `$__mvn` and destination `$2`) holds. */
const mvFails = (when: string): string =>
  `eval "$(declare -f _plat_mv_notdir | sed '1s/^_plat_mv_notdir/__real_mv_notdir/')"; __mvn=0; `
  + `_plat_mv_notdir() { __mvn=$((__mvn + 1)); if ${when}; then return 1; fi; __real_mv_notdir "$@"; };`;

describe('ws-lease-mark writes one carrier, generation-strict', () => {
  it('W5-L1: a clean agent tree at generation 1 gets a carrier and a by-tree entry', () => {
    const t = agentTree();
    const r = mark();
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    expect(r.doc).toMatchObject({ ok: true, answer: 'written', lease: LEASE, generation: 1, state: 'ephemeral' });
    expect(carrier()).toMatchObject({ v: 1, leaseId: LEASE, generation: 1, state: 'ephemeral', journalSeq: 7,
      adminRecord: 'agent-a', canonicalPath: t, source: 'agent', branch: 'claude/agent-a', expiresAt: null });
    expect(carrier().fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(byTree()).toHaveLength(1);
    expect(entry()).toBe(LEASE);
    expect(r.lines).toHaveLength(1);
  }, 60_000);

  it('W5-L2: the same generation with the same body answers unchanged and rewrites nothing', () => {
    agentTree(); mark();
    const before = fs.readFileSync(carrierPath());
    const r = mark();
    expect(r.code).toBe(0);
    expect(r.doc).toMatchObject({ ok: true, answer: 'unchanged' });
    expect(fs.readFileSync(carrierPath())).toEqual(before);
  }, 60_000);

  it('W5-L3: stored + 1 is written; a different body at the same generation refuses; a carrier two behind catches up; below refuses', () => {
    agentTree(); mark();
    expect(mark({ generation: '2', state: 'adopted', 'expires-at': '1767225600000', 'journal-seq': '9' }).doc)
      .toMatchObject({ ok: true, answer: 'written', generation: 2, state: 'adopted' });
    expect(mark({ generation: '2', state: 'retained', 'journal-seq': '9' }).doc).toMatchObject({ ok: false, refusal: 'generation-conflict' });
    expect(mark({ generation: '4', state: 'retained', 'expires-at': '1767830400000', 'journal-seq': '12' }).doc)
      .toMatchObject({ ok: true, answer: 'written', generation: 4, state: 'retained' });
    expect(mark({ generation: '3', state: 'adopted', 'expires-at': '1767225600000', 'journal-seq': '10' }).doc)
      .toMatchObject({ ok: false, refusal: 'stale-generation' });
    expect(carrier()).toMatchObject({ generation: 4, state: 'retained', expiresAt: 1767830400000 });
  }, 60_000);

  it('W5-L4: a new lease at a generation other than 1 refuses stale-generation and writes nothing', () => {
    agentTree();
    refused(mark({ generation: '2' }), 'stale-generation');
  }, 60_000);
});

describe('ws-lease-mark refuses every tree spec §5.10 refuses, before any write', () => {
  it('W5-L5: a name starting with `-` marks through --admin-record-hex; every other usage error is rc 2', () => {
    const t = agentTree('-dash');
    const r = mark({ 'admin-record-hex': hex('-dash') });
    expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: true, answer: 'written' });
    expect(carrier()).toMatchObject({ adminRecord: '-dash', canonicalPath: t });
    fs.rmSync(path.join(leasesDir()), { recursive: true });
    const flags = Object.entries(BASE).map(([k, v]) => `--${k} ${v}`).join(' ');
    refused(run(flags.replace(`--admin-record-hex ${hex('agent-a')}`, '--admin-record agent-a')), 'usage');
    refused(run(`${flags} --lease ${LEASE}`), 'usage');
    refused(run(`${flags.replace(`--lease ${LEASE} `, '')} --lease`), 'usage');
    refused(mark({ 'release-reason': 'foreign', state: 'adopted' }), 'usage');
    refused(mark({ state: 'promoted', 'promoted-run': '12' }), 'usage');
    refused(mark({ 'admin-record-hex': hex('..') }), 'usage');
    refused(mark({ 'admin-record-hex': 'AB' }), 'usage');
  }, 60_000);

  it('W5-L6: a main checkout that is a link refuses not-under-projects-root', () => {
    agentTree();
    const away = path.join(h.home, 'away');
    fs.mkdirSync(away);
    fs.renameSync(main(), path.join(away, 'demo'));
    fs.symlinkSync(path.join(away, 'demo'), main());
    refused(mark(), 'not-under-projects-root');
  }, 60_000);

  it('W5-L7: a link anywhere below the root that holds the tree refuses symlink', () => {
    agentTree();
    const wt = path.join(main(), '.claude', 'worktrees');
    const away = path.join(main(), '.claude', 'moved-worktrees');
    fs.renameSync(wt, away);
    fs.symlinkSync(away, wt);
    refused(mark(), 'symlink');
  }, 60_000);

  it('W5-L8: a locked tree refuses locked (O5-3), and is written once it is unlocked', () => {
    const t = agentTree();
    h.git(main(), 'worktree', 'lock', t);
    refused(mark(), 'locked');
    h.git(main(), 'worktree', 'unlock', t);
    expect(mark().doc).toMatchObject({ ok: true, answer: 'written' });
  }, 60_000);

  it('W5-L9: an admin record that names the main checkout refuses main-worktree', () => {
    agentTree();
    const rec = path.join(main(), '.git', 'worktrees', 'fake');
    fs.mkdirSync(rec);
    fs.writeFileSync(path.join(rec, 'gitdir'), `${fs.realpathSync(main())}/.git\n`);
    refused(mark({ 'admin-record-hex': hex('fake') }), 'main-worktree');
  }, 60_000);

  it('W5-L10: a registry row at or inside the tree refuses registered', () => {
    const t = agentTree();
    h.sh(`_reg_set demo-quiet-cove workdir '${t}'`);
    refused(mark(), 'registered');
    h.sh(`_reg_set demo-quiet-cove workdir '${t}/sub'; _reg_set demo-quiet-cove child 5`);
    refused(mark(), 'registered');
  }, 60_000);

  it('W5-L11: the checkout that holds the tree as `.claude/worktrees/<name>` passes; any other containing row refuses nested', () => {
    agentTree();
    h.sh(`_reg_set lane-a-demo workdir '${fs.realpathSync(main())}'`);
    expect(mark().doc).toMatchObject({ ok: true, answer: 'written' });
    fs.rmSync(leasesDir(), { recursive: true });
    h.sh(`_reg_set demo-outer workdir '${fs.realpathSync(main())}/.claude'`);
    refused(mark(), 'nested');
  }, 60_000);

  it('W5-L12: a linked worktree inside the tree, or the tree inside another one away from its worktrees dir, refuses nested', () => {
    const t = agentTree();
    h.git(main(), 'worktree', 'add', '-b', 'inner', '--', path.join(t, 'inner'));
    refused(mark(), 'nested');
    const outer = agentTree('outer');
    agentTree('agent-z', path.join(outer, 'sub', 'agent-z'));
    refused(mark({ 'admin-record-hex': hex('agent-z') }), 'nested');
  }, 60_000);

  it('W5-L24: an Agent tree inside a ccd workspace is written; one elsewhere inside it refuses nested', () => {
    const ws = path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
    fs.mkdirSync(path.dirname(ws), { recursive: true });
    h.git(main(), 'worktree', 'add', '-b', 'ws/quiet-mesa', '--', ws);
    h.sh(`_reg_set demo-quiet-mesa workdir '${fs.realpathSync(ws)}'`);
    const t = agentTree('agent-x', path.join(ws, '.claude', 'worktrees', 'agent-x'), ws);
    const r = mark({ 'admin-record-hex': hex('agent-x') });
    expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: true, answer: 'written' });
    expect(carrier()).toMatchObject({ canonicalPath: t, adminRecord: 'agent-x' });
    fs.rmSync(leasesDir(), { recursive: true });
    agentTree('agent-y', path.join(ws, 'sub', 'agent-y'), ws);
    refused(mark({ 'admin-record-hex': hex('agent-y') }), 'nested');
  }, 60_000);

  it('W5-L13: another lease that holds the tree refuses tree-held; a released, ephemeral or carrier-less one is re-pointed', () => {
    agentTree();
    expect(mark({ lease: OTHER }).doc).toMatchObject({ ok: true });
    expect(mark({ lease: OTHER, generation: '2', state: 'adopted', 'journal-seq': '8' }).doc).toMatchObject({ ok: true, answer: 'written' });
    refused(mark(), 'tree-held');
    expect(mark({ lease: OTHER, generation: '3', state: 'released', 'release-reason': 'foreign', 'journal-seq': '9' }).doc)
      .toMatchObject({ ok: true, answer: 'written' });
    expect(mark().doc).toMatchObject({ ok: true, answer: 'written' });
    expect(entry()).toBe(LEASE);
    // OTHER only ephemeral: re-pointed
    fs.rmSync(leasesDir(), { recursive: true });
    mark({ lease: OTHER });
    expect(entry()).toBe(OTHER);
    expect(mark().doc).toMatchObject({ ok: true, answer: 'written' });
    expect(entry()).toBe(LEASE);
    // the entry names a lease with no carrier: re-pointed
    fs.rmSync(leasesDir(), { recursive: true });
    mark();
    fs.writeFileSync(path.join(leasesDir(), 'by-tree', byTree()[0]!), `${THIRD}\n`);
    fs.rmSync(carrierPath());
    expect(mark().doc).toMatchObject({ ok: true, answer: 'written' });
    expect(entry()).toBe(LEASE);
    // OTHER's carrier malformed: unmeasured
    fs.rmSync(leasesDir(), { recursive: true });
    mark({ lease: OTHER });
    fs.writeFileSync(carrierPath(OTHER), '{');
    refused(mark(), 'unmeasured');
  }, 120_000);

  it('W5-L14: a malformed, linked or oversized stored carrier refuses bad-carrier and is left as it is', () => {
    agentTree();
    fs.mkdirSync(path.join(leasesDir(), 'by-tree'), { recursive: true });
    fs.writeFileSync(carrierPath(), '{');
    refused(mark(), 'bad-carrier', Buffer.from('{'));
    fs.rmSync(carrierPath());
    mark({ lease: OTHER });
    const target = fs.readFileSync(carrierPath(OTHER));
    fs.symlinkSync(carrierPath(OTHER), carrierPath());
    const r = mark();
    expect(r.doc).toMatchObject({ ok: false, refusal: 'bad-carrier' });
    expect(fs.lstatSync(carrierPath()).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(carrierPath(OTHER))).toEqual(target);
    fs.rmSync(carrierPath());
    const big = Buffer.alloc(20000, 0x20);
    fs.writeFileSync(carrierPath(), big);
    refused(mark(), 'bad-carrier', big);
  }, 60_000);

  it('W5-L15: a leases directory that is a link refuses unmeasured and makes nothing at its target', () => {
    agentTree();
    const away = fs.mkdtempSync(path.join(h.home, 'away-'));
    fs.mkdirSync(path.join(reg(), 'delegation'), { recursive: true });
    fs.symlinkSync(away, leasesDir());
    refused(mark(), 'unmeasured');
    expect(fs.readdirSync(away)).toEqual([]);
  }, 60_000);

  it('W5-L16: a tree removed and re-added at the same path refuses fingerprint-mismatch', () => {
    const t = agentTree();
    mark();
    const before = fs.readFileSync(carrierPath());
    h.git(main(), 'worktree', 'remove', t);
    fs.writeFileSync(path.join(main(), 'more.md'), 'more\n');
    h.git(main(), 'add', 'more.md');
    h.git(main(), 'commit', '-m', 'more');
    h.git(main(), 'worktree', 'add', '-b', 'claude/agent-a-again', '--', t);
    refused(mark({ generation: '2', state: 'adopted', 'journal-seq': '8' }), 'fingerprint-mismatch', before);
  }, 60_000);

  it('W5-L17: a lost answer is re-driven: the same generation 2 twice answers unchanged the second time', () => {
    agentTree(); mark();
    const g2 = { generation: '2', state: 'adopted', 'expires-at': '1767225600000', 'journal-seq': '9' };
    expect(mark(g2).doc).toMatchObject({ ok: true, answer: 'written' });
    const r = mark(g2);
    expect(r.code).toBe(0);
    expect(r.doc).toMatchObject({ ok: true, answer: 'unchanged', generation: 2 });
  }, 60_000);

  it('W5-L18: a held lock answers busy at once', async () => {
    agentTree();
    h.sh('_dl_leases_dir >/dev/null');
    const lock = path.join(leasesDir(), '.locks', `${LEASE}.lock`);
    const holder = spawn('flock', [lock, 'sleep', '5'], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 50 && !fs.existsSync(lock); i++) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 200));
      refused(mark(), 'busy');
    } finally { holder.kill('SIGKILL'); }
  }, 60_000);

  it('W5-L19: a release whose tree is gone is written and keeps the stored fingerprint; with no carrier it refuses no-tree', () => {
    const t = agentTree();
    mark();
    const fp = carrier().fingerprint;
    h.git(main(), 'worktree', 'remove', t);
    h.git(main(), 'worktree', 'prune');
    const rel = { generation: '2', state: 'released', 'release-reason': 'native-removed', 'journal-seq': '8' };
    expect(mark(rel).doc).toMatchObject({ ok: true, answer: 'written', state: 'released' });
    expect(carrier()).toMatchObject({ state: 'released', releaseReason: 'native-removed', fingerprint: fp, canonicalPath: t });
    const r = mark({ ...rel, lease: OTHER });
    expect(r.doc).toMatchObject({ ok: false, refusal: 'no-tree' });
    expect(fs.existsSync(carrierPath(OTHER))).toBe(false);
  }, 60_000);

  it('W5-L20: the creation base is CLAUDE_BASE, else the first logs/HEAD line, else unmeasured', () => {
    agentTree();
    const admin = path.join(main(), '.git', 'worktrees', 'agent-a');
    const base = 'a'.repeat(40);
    fs.writeFileSync(path.join(admin, 'CLAUDE_BASE'), `${base}\n`);
    mark();
    expect(carrier().claudeBase).toBe(base);
    fs.rmSync(leasesDir(), { recursive: true });
    fs.rmSync(path.join(admin, 'CLAUDE_BASE'));
    const first = fs.readFileSync(path.join(admin, 'logs', 'HEAD'), 'utf8').split('\n')[0]!.split(' ')[1];
    mark();
    expect(carrier().claudeBase).toBe(first);
    if (process.getuid?.() === 0) return;   // root reads a mode-0000 file
    fs.rmSync(leasesDir(), { recursive: true });
    fs.chmodSync(path.join(admin, 'logs', 'HEAD'), 0);
    try { refused(mark(), 'unmeasured'); } finally { fs.chmodSync(path.join(admin, 'logs', 'HEAD'), 0o644); }
  }, 60_000);

  it('W5-L21: a promoted mark records its run and session', () => {
    agentTree(); mark();
    expect(mark({ generation: '2', state: 'promoted', 'promoted-run': '12', 'promoted-session': 'demo-bright-fern', 'journal-seq': '8' }).doc)
      .toMatchObject({ ok: true, answer: 'written', state: 'promoted' });
    expect(carrier()).toMatchObject({ promotedRun: 12, promotedSession: 'demo-bright-fern', releaseReason: null });
  }, 60_000);

  it('W5-L22: nothing but the one line on stdout, and nothing under the tree, its admin dir or its record changes', () => {
    const t = agentTree();
    const admin = path.join(main(), '.git', 'worktrees', 'agent-a');
    const snap = (d: string): string[] => {
      const out: string[] = [];
      const walk = (p: string): void => {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          const q = path.join(p, e.name);
          const st = fs.lstatSync(q);
          out.push(`${path.relative(d, q)} ${st.size} ${st.mtimeMs}`);
          if (e.isDirectory()) walk(q);
        }
      };
      walk(d);
      return out.sort();
    };
    // the test's own `git status` refreshes the index, so it runs before the snapshot is taken and after it is compared
    const status = h.git(t, 'status', '--porcelain');
    const before = [snap(t), snap(admin)];
    const r = mark();
    expect(r.lines).toHaveLength(1);
    expect(r.doc).toMatchObject({ ok: true, answer: 'written' });
    expect([snap(t), snap(admin)]).toEqual(before);
    expect(h.git(t, 'status', '--porcelain')).toBe(status);
  }, 60_000);

  it('W5-L23: the by-tree entry is written first; a re-drive writes the carrier; an unchanged mark repairs a lost entry', () => {
    agentTree();
    const r = mark({}, mvFails('(( __mvn == 2 ))'));
    expect(r.doc).toMatchObject({ ok: false });
    expect(entry()).toBe(LEASE);
    expect(fs.existsSync(carrierPath())).toBe(false);
    expect(fs.readdirSync(leasesDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(h.sh(`_dl_tree_owner ${byTree()[0]}; echo "rc=$?"`).split('\n').pop()).toBe('rc=0');
    expect(h.sh(`_dl_carrier_read ${LEASE}; echo "rc=$?"`).split('\n').pop()).toBe('rc=3');
    expect(mark().doc).toMatchObject({ ok: true, answer: 'written' });
    expect(entry()).toBe(LEASE);
    fs.rmSync(path.join(leasesDir(), 'by-tree', byTree()[0]!));
    expect(byTree()).toEqual([]);
    expect(mark().doc).toMatchObject({ ok: true, answer: 'unchanged' });
    expect(entry()).toBe(LEASE);
  }, 60_000);

  it('W5-L23b: a release of a half-written lease clears its entry (index-cleared); with no entry naming it, no-tree', () => {
    agentTree();
    mark({}, mvFails('(( __mvn == 2 ))'));
    const key = byTree()[0]!;
    const rel = { generation: '2', state: 'released', 'release-reason': 'foreign', 'journal-seq': '8' };
    const r = mark(rel);
    expect(r.code).toBe(0);
    expect(r.doc).toMatchObject({ ok: true, answer: 'index-cleared' });
    expect(byTree()).toEqual([]);
    expect(fs.existsSync(carrierPath())).toBe(false);
    expect(h.sh(`_dl_tree_owner ${key}; echo "rc=$?"`).split('\n').pop()).toBe('rc=3');
    refused(mark(rel), 'no-tree');
  }, 60_000);

  it('W5-L25: a failed rename leaves the stored carrier byte-identical, its inode unchanged, and no temp file', () => {
    agentTree(); mark();
    const before = fs.readFileSync(carrierPath());
    const ino = fs.statSync(carrierPath()).ino;
    const r = mark({ generation: '2', state: 'adopted', 'journal-seq': '8' }, mvFails('[[ "$2" == *.json ]]'));
    expect(r.doc).toMatchObject({ ok: false });
    expect(fs.readFileSync(carrierPath())).toEqual(before);
    expect(fs.statSync(carrierPath()).ino).toBe(ino);
    expect(fs.readdirSync(leasesDir()).filter((f) => f.startsWith(`.${LEASE}`) || (f.endsWith('.json') && f !== `${LEASE}.json`))).toEqual([]);
  }, 60_000);
});
