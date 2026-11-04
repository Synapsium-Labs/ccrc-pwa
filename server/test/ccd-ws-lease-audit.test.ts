// Delegation broker wave 5, PR2 (Task 5.2.1): `ccd ws-lease-audit`, the read-only measure of a leased tree. It reads the
// carrier without any lock, recomputes the box-side fingerprint and answers the tree's tip, dirt and commits beyond its
// creation base, plus (with --holders) who holds or sits in it. It writes nothing, by any path. Every case runs on a
// FIXTURE HOME (`makeCcdHarness`): nothing here reads or writes the live `~/.cc-sessions`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { fileURLToPath } from 'node:url';
import { LEASE_AUDIT_REFUSALS } from '../../shared/api.js';
import { LEASE, OTHER, STUBS, agentTree, carrier, carrierPath, hex, leasesDir, main, mark } from './leaseFixture.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lease-audit-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

interface Audit { code: number; doc: Record<string, unknown>; lines: string[] }
const audit = (gen = 1, extra = '', pre = STUBS): Audit => {
  const out = h.sh(`${pre} cmd_ws_lease_audit --lease ${LEASE} --generation ${gen} ${extra}; echo "rc=$?"`).trim().split('\n');
  const code = Number(/^rc=(\d+)$/.exec(out.pop()!)![1]);
  return { code, lines: out, doc: JSON.parse(out[out.length - 1] ?? '{}') as Record<string, unknown> };
};
const auditArgv = (argv: string): Audit => {
  const out = h.sh(`${STUBS} cmd_ws_lease_audit ${argv}; echo "rc=$?"`).trim().split('\n');
  const code = Number(/^rc=(\d+)$/.exec(out.pop()!)![1]);
  return { code, lines: out, doc: JSON.parse(out[out.length - 1] ?? '{}') as Record<string, unknown> };
};
const refused = (r: Audit, word: string): void => {
  expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: false, refusal: word });
  expect(typeof r.doc.detail).toBe('string');
  expect(r.code).toBe(word === 'usage' ? 2 : 1);
  expect(r.lines).toHaveLength(1);
};
const adminDir = (name = 'agent-a'): string => path.join(main(h), '.git', 'worktrees', name);
/** Rewrite the stored carrier's fields in place, keeping its grammar (the reader checks shape, not provenance). */
const rewriteCarrier = (over: Record<string, unknown>): void => {
  fs.writeFileSync(carrierPath(h), `${JSON.stringify({ ...carrier(h), ...over })}\n`);
};
/** A `git` first on PATH that exits 128 for `rev-list` and passes every other subcommand to the real git. */
const gitRevListFails = (): string => {
  const real = h.sh('command -v git').trim();
  const dir = path.join(h.home, 'gitwrap');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'git'),
    `#!/bin/bash\nfor a in "$@"; do [[ "$a" == rev-list ]] && exit 128; done\nexec '${real}' "$@"\n`, { mode: 0o755 });
  return `PATH='${dir}':"$PATH";`;
};
/** A recursive listing with sizes, mtimes and inodes: equal before and after means nothing was written under it. */
const listing = (root: string): string[] => {
  const rows: string[] = [];
  const walk = (p: string): void => {
    const st = fs.lstatSync(p);
    rows.push(`${path.relative(root, p) || '.'}\t${st.mode}\t${st.size}\t${st.mtimeMs}\t${st.ino}`);
    if (st.isDirectory()) for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e));
  };
  walk(root);
  return rows;
};

describe('ws-lease-audit measures a leased tree', () => {
  it('W5-AU1: a tree with no commit and no dirt is unchanged, at its tip', () => {
    const t = agentTree(h); mark(h);
    const r = audit();
    expect(r.code, JSON.stringify(r.doc)).toBe(0);
    expect(r.doc).toMatchObject({ ok: true, lease: LEASE, generation: 1, dirty: false, aheadOfBase: 0, branchAheadOfBase: 0,
      changed: false });
    expect(r.doc.tip).toBe(h.git(t, 'rev-parse', 'HEAD').trim());
    expect(r.doc.token).toMatch(/^[0-9a-f]{64}$/);
    expect(r.doc).not.toHaveProperty('holders');
    expect(r.lines).toHaveLength(1);
  }, 60_000);

  it('W5-AU2: one commit beyond the base is changed; an untracked file alone is changed', () => {
    const t = agentTree(h); mark(h);
    fs.writeFileSync(path.join(t, 'u.txt'), 'u\n');
    expect(audit().doc).toMatchObject({ ok: true, dirty: true, aheadOfBase: 0, changed: true });
    h.git(t, 'add', 'u.txt'); h.git(t, 'commit', '-m', 'w');
    const r = audit();
    expect(r.doc).toMatchObject({ ok: true, dirty: false, aheadOfBase: 1, branchAheadOfBase: 1, changed: true });
    expect(r.doc.tip).toBe(h.git(t, 'rev-parse', 'HEAD').trim());
    expect(r.code).toBe(0);
  }, 60_000);

  it('W5-AU3: a carrier at generation 2 asked at 1 refuses stale-generation; asked at 2 it answers', () => {
    agentTree(h); mark(h);
    expect(mark(h, { generation: '2', state: 'adopted', 'expires-at': '1767225600000', 'journal-seq': '9' }).doc)
      .toMatchObject({ ok: true, answer: 'written', generation: 2 });
    refused(audit(1), 'stale-generation');
    refused(audit(3), 'stale-generation');
    expect(audit(2).doc).toMatchObject({ ok: true, generation: 2, changed: false });
  }, 60_000);

  it('W5-AU4: CLAUDE_BASE rewritten to another commit refuses fingerprint-mismatch, before any fact', () => {
    agentTree(h); mark(h);
    fs.writeFileSync(path.join(main(h), 'b.txt'), 'b\n');
    h.git(main(h), 'add', 'b.txt'); h.git(main(h), 'commit', '-m', 'b');
    fs.writeFileSync(path.join(adminDir(), 'CLAUDE_BASE'), `${h.git(main(h), 'rev-parse', 'HEAD').trim()}\n`);
    const r = audit();
    refused(r, 'fingerprint-mismatch');
    expect(r.doc).not.toHaveProperty('tip');
  }, 60_000);

  it('W5-AU4b: a base that cannot be counted makes aheadOfBase and changed unmeasured, never 0 or false', () => {
    agentTree(h); mark(h);
    const r = audit(1, '', `${STUBS} ${gitRevListFails()}`);
    expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: true, dirty: false, aheadOfBase: 'unmeasured',
      branchAheadOfBase: 'unmeasured', changed: 'unmeasured' });
    expect(r.code).toBe(1);
  }, 60_000);

  it('W5-AU4c (review 1446 F6): a carrier whose claudeBase disagrees with the tree\'s makes both counts and changed unmeasured', () => {
    const t = agentTree(h); mark(h);
    const other = 'e'.repeat(40);
    expect(other).not.toBe(carrier(h).claudeBase);
    rewriteCarrier({ claudeBase: other });
    const r = audit();
    expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: true, dirty: false, aheadOfBase: 'unmeasured',
      branchAheadOfBase: 'unmeasured', changed: 'unmeasured' });
    expect(r.doc.tip).toBe(h.git(t, 'rev-parse', 'HEAD').trim());
    expect(r.code).toBe(1);
  }, 60_000);

  it('W5-AU5: an unreadable index makes dirty and changed unmeasured', () => {
    if (process.getuid?.() === 0) return;   // root reads a mode-0000 file
    agentTree(h); mark(h);
    const index = path.join(adminDir(), 'index');
    fs.chmodSync(index, 0);
    try {
      const r = audit();
      expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: true, dirty: 'unmeasured', changed: 'unmeasured' });
      expect(r.code).toBe(1);
    } finally { fs.chmodSync(index, 0o644); }
  }, 60_000);

  it('W5-AU6: the tree removed refuses no-tree; a malformed carrier bad-carrier; no carrier no-carrier', () => {
    refused(audit(), 'no-carrier');
    const t = agentTree(h); mark(h);
    fs.rmSync(t, { recursive: true, force: true });
    refused(audit(), 'no-tree');
    fs.writeFileSync(carrierPath(h), '{');
    refused(audit(), 'bad-carrier');
    fs.rmSync(carrierPath(h));
    fs.symlinkSync(path.join(h.home, 'nowhere.json'), carrierPath(h));
    refused(audit(), 'bad-carrier');
  }, 60_000);

  it('W5-AU6b (review 1446 F1, D-7974): a tree whose parent cannot be searched is unmeasured, never no-tree', () => {
    if (process.getuid?.() === 0) return;   // root searches a mode-0000 directory
    const t = agentTree(h); mark(h);
    const parent = path.dirname(t);
    fs.chmodSync(parent, 0);
    try {
      const r = audit();
      refused(r, 'unmeasured');
      expect(String(r.doc.detail)).toContain('still stands is unmeasured');
      expect(String(r.doc.detail)).toContain('cannot be searched');
      expect(String(r.doc.detail)).not.toContain('holds no worktree record');
    } finally { fs.chmodSync(parent, 0o755); }
    expect(audit().doc).toMatchObject({ ok: true, changed: false });   // CONTROL: searchable again, the tree answers
  }, 60_000);

  it('W5-AU11 (review 1446 F2, D-7975): an edit git is told not to look at is dirt, under either flag', () => {
    for (const flag of ['--assume-unchanged', '--skip-worktree']) {
      const t = agentTree(h, `agent-${flag.slice(2, 6)}`);
      const lease = flag === '--assume-unchanged' ? LEASE : OTHER;
      mark(h, { lease, 'admin-record-hex': hex(path.basename(t)) });
      h.git(t, 'update-index', flag, 'README.md');
      fs.writeFileSync(path.join(t, 'README.md'), 'hidden edit\n');
      expect(h.git(t, 'status', '--porcelain'), flag).toBe('');   // git status itself does not see it
      const out = h.sh(`${STUBS} cmd_ws_lease_audit --lease ${lease} --generation 1; echo "rc=$?"`).trim().split('\n');
      out.pop();
      const doc = JSON.parse(out.pop()!) as Record<string, unknown>;
      expect(doc, `${flag}: ${JSON.stringify(doc)}`).toMatchObject({ ok: true, dirty: true, aheadOfBase: 0, changed: true });
    }
  }, 60_000);

  it('W5-AU12 (review 1446 F3, D-7976): commits on the recorded branch count when HEAD has left it', () => {
    // a second commit on main first, so the tree's base has an ancestor to reset to
    fs.writeFileSync(path.join(main(h), 'b.txt'), 'b\n');
    h.git(main(h), 'add', 'b.txt'); h.git(main(h), 'commit', '-m', 'b');
    const t = agentTree(h); mark(h);
    const base = h.git(t, 'rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(t, 'w.txt'), 'w\n');
    h.git(t, 'add', 'w.txt'); h.git(t, 'commit', '-m', 'w');
    h.git(t, 'checkout', '-q', '--detach', base);
    const d = audit();
    expect(d.doc, JSON.stringify(d.doc)).toMatchObject({ ok: true, tip: base, dirty: false, aheadOfBase: 0, branchAheadOfBase: 1,
      changed: true });
    expect(d.code).toBe(0);
    h.git(t, 'reset', '-q', '--hard', `${base}~1`);
    const a = audit();
    expect(a.doc, JSON.stringify(a.doc)).toMatchObject({ ok: true, dirty: false, aheadOfBase: 0, branchAheadOfBase: 1, changed: true });
    expect(a.doc.tip).not.toBe(base);
    // the recorded branch deleted: its own value, never 0, and changed cannot be measured
    h.git(t, 'branch', '-q', '-D', 'claude/agent-a');
    const g = audit();
    expect(g.doc, JSON.stringify(g.doc)).toMatchObject({ ok: true, branchAheadOfBase: 'branch-gone', changed: 'unmeasured' });
    expect(g.code).toBe(1);
    // a carrier that records no branch (the tree was detached when it was marked)
    rewriteCarrier({ branch: null });
    expect(audit().doc).toMatchObject({ ok: true, aheadOfBase: 0, branchAheadOfBase: 'no-branch', changed: false });
  }, 60_000);

  it('W5-AU7: three audits write nothing under the registry, the tree, its admin dir or the common worktrees entry', () => {
    const t = agentTree(h); mark(h);
    // The mark's lock file is removed, so an audit that opened or touched one would show; a tracked file's stat record is
    // made stale, so a git read that refreshes the index (no GIT_OPTIONAL_LOCKS=0) would rewrite it.
    fs.rmSync(path.join(leasesDir(h), '.locks', `${LEASE}.lock`));
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(t, 'README.md'), later, later);
    const reg = path.join(h.home, '.cc-sessions');
    const common = path.join(main(h), '.git', 'worktrees');
    // review 1446 F8: the main checkout's whole common dir (its index, refs, logs and every admin record), not only its
    // worktrees entry
    const snap = (): string[] => [...listing(reg), ...listing(t), ...listing(adminDir()), ...listing(common).slice(0, 1),
      ...listing(path.join(main(h), '.git'))];
    const before = snap();
    expect(audit().doc).toMatchObject({ ok: true, changed: false });
    expect(audit(1, '--holders').doc).toMatchObject({ ok: true, holders: [] });
    expect(audit().doc).toMatchObject({ ok: true, changed: false });
    expect(snap()).toEqual(before);
  }, 60_000);

  it('W5-AU8: the token binds the generation, the parent incarnation and the tip; it is stable over an unchanged state', () => {
    const t = agentTree(h); mark(h);
    const inc0 = carrier(h).parentIncarnation;
    const a = audit().doc.token;
    expect(audit().doc.token).toBe(a);
    rewriteCarrier({ generation: 2 });
    const g = audit(2).doc.token;
    expect(g).toMatch(/^[0-9a-f]{64}$/);
    expect(g).not.toBe(a);
    rewriteCarrier({ generation: 1, parentIncarnation: '99999999-2222-4333-8444-555555555555' });
    const i = audit().doc.token;
    expect(i).toMatch(/^[0-9a-f]{64}$/);
    expect(i).not.toBe(a);
    rewriteCarrier({ parentIncarnation: inc0 });
    expect(audit().doc.token).toBe(a);
    fs.writeFileSync(path.join(t, 'c.txt'), 'c\n');
    h.git(t, 'add', 'c.txt'); h.git(t, 'commit', '-m', 'c');
    const c = audit().doc;
    expect(c.token).toMatch(/^[0-9a-f]{64}$/);
    expect(c.token).not.toBe(a);
    // review 1446 F5: the tip moves and neither count does (an amend), and the token still changes
    h.git(t, 'commit', '-q', '--amend', '-m', 'c2');
    const m = audit().doc;
    expect(m).toMatchObject({ aheadOfBase: c.aheadOfBase, branchAheadOfBase: c.branchAheadOfBase, dirty: c.dirty });
    expect(m.tip).not.toBe(c.tip);
    expect(m.token).not.toBe(c.token);
  }, 60_000);

  it('W5-AU8b (review 1446 F4, D-7977): the token binds holders and whether they were asked', () => {
    agentTree(h); mark(h);
    const none = audit().doc.token;
    const empty = audit(1, '--holders').doc.token;
    const cwd4242 = '_ws_cwd_users() { _WS_CWD_USERS_PIDS=4242; _WS_CWD_USERS_WHY="process 4242 (x) sits there"; return 1; };';
    const one = audit(1, '--holders', `${STUBS} ${cwd4242}`).doc.token;
    const cwdFails = '_ws_cwd_users() { _WS_CWD_USERS_WHY="the walk of /proc did not finish within 10s"; return 2; };';
    const unm = audit(1, '--holders', `${STUBS} ${cwdFails}`).doc.token;
    const all = [none, empty, one, unm];
    for (const tk of all) expect(tk).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(all).size, JSON.stringify(all)).toBe(4);
    expect(audit(1, '--holders').doc.token).toBe(empty);   // the same answer mints the same token
  }, 60_000);

  it('W5-AU9: --holders answers the probes\' pids, [] for nobody and "unmeasured" when one fails; without it they are never asked', () => {
    agentTree(h); mark(h);
    expect(audit(1, '--holders').doc).toMatchObject({ ok: true, holders: [] });
    const cwd4242 = '_ws_cwd_users() { _WS_CWD_USERS_PIDS=4242; _WS_CWD_USERS_WHY="process 4242 (x) sits there"; return 1; };';
    const r = audit(1, '--holders', `${STUBS} ${cwd4242}`);
    expect(r.doc, JSON.stringify(r.doc)).toMatchObject({ ok: true, holders: [4242], changed: false });
    expect(r.code).toBe(0);
    const path77 = '_ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
      + ' for i in "$@"; do _WS_PATH_USERS_RCS+=(1); _WS_PATH_USERS_PIDS_OF+=("77 4242"); _WS_PATH_USERS_WHY_OF+=("x"); done; return 0; };';
    expect(audit(1, '--holders', `${STUBS} ${cwd4242} ${path77}`).doc).toMatchObject({ ok: true, holders: [77, 4242] });
    const cwdFails = '_ws_cwd_users() { _WS_CWD_USERS_WHY="the walk of /proc did not finish within 10s"; return 2; };';
    const u = audit(1, '--holders', `${STUBS} ${cwdFails}`);
    expect(u.doc, JSON.stringify(u.doc)).toMatchObject({ ok: true, holders: 'unmeasured', changed: false });
    expect(u.code).toBe(1);
    const pathFails = '_ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
      + ' for i in "$@"; do _WS_PATH_USERS_RCS+=(2); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=("walk"); done; return 0; };';
    expect(audit(1, '--holders', `${STUBS} ${pathFails}`).doc).toMatchObject({ ok: true, holders: 'unmeasured' });
    const probesDie = '_ws_cwd_users() { echo probed >&2; exit 97; }; _ws_path_users_many() { echo probed >&2; exit 97; };';
    const n = audit(1, '', probesDie);
    expect(n.doc, JSON.stringify(n.doc)).toMatchObject({ ok: true, changed: false });
    expect(n.doc).not.toHaveProperty('holders');
    expect(n.code).toBe(0);
  }, 60_000);

  it('W5-AU0: the grammar is strict; every usage error is rc 2 with one line', () => {
    refused(auditArgv(''), 'usage');
    refused(auditArgv(`--lease ${LEASE}`), 'usage');
    refused(auditArgv('--generation 1'), 'usage');
    refused(auditArgv(`--lease ${LEASE} --generation 0`), 'usage');
    refused(auditArgv(`--lease ${LEASE} --generation x`), 'usage');
    refused(auditArgv(`--lease NOT-A-LEASE --generation 1`), 'usage');
    refused(auditArgv(`--lease ${LEASE} --generation 1 --lease ${LEASE}`), 'usage');
    refused(auditArgv(`--lease ${LEASE} --generation 1 --holders --holders`), 'usage');
    refused(auditArgv(`--lease ${LEASE} --generation 1 --other x`), 'usage');
    refused(auditArgv(`--lease ${LEASE} --generation`), 'usage');
  }, 60_000);

  it('W5-AU10: the verb refuses with exactly the words shared/api.ts declares, the server\'s one reader of them', () => {
    const lib = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ccd', 'lib',
      'delegation-lease.sh'), 'utf8');
    const start = lib.indexOf('\ncmd_ws_lease_audit() {');
    const ladder = lib.indexOf('\n_dl_audit_ladder() {');
    const end = lib.indexOf('\n}\n', ladder);
    expect(start).toBeGreaterThan(0);
    expect(ladder).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(ladder);
    const body = lib.slice(start, end + 3);   // the verb and its ladder only, never a later function
    const words = new Set([...body.matchAll(/_dl_mark_refuse ([a-z-]+) /g), ...body.matchAll(/"refusal":"([a-z-]+)"/g)].map((m) => m[1]!));
    expect([...words].sort()).toEqual([...LEASE_AUDIT_REFUSALS].sort());
  });
});
