// Delegation broker wave 5 PR4, Task 5.4.2: the orphan ladder's lease rung (`_dl_orphan_rung`, ccd/lib/delegation-lease.sh,
// called from `_ws_orphan_ladder` after the registry rung). A tree whose delegation carrier holds it (`adopted`/`retained`
// until expiry plus the margin, `transferring` always) is refused `leased`; every unreadable or contradictory answer refuses
// `unmeasured`; and the token binds the lease id, its generation and its state, so a carrier written between the audit and
// the act changes the recomputed token (D-7002, D-7804, D-7828; O5-1 (a)). Every case runs on a FIXTURE HOME
// (`makeCcdHarness`), with the orphan suites' probe stubs; nothing here touches a live box.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { STUBS, LEASE, BASE, agentTree, carrierPath, hex, leasesDir, main, mark as markOf, reg, type Flags } from './leaseFixture.js';
import { LADDER_CASES, characterise, ladderFixture, type LadderDoc } from './orphanLadderFixture.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-orphan-lease-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

interface Audit { verdict: string; refusal: string | null; detail: string; token: string | null; rescueToken: string | null }
const audit = (p: string, pre = STUBS): Audit =>
  JSON.parse(h.sh(`${pre} _ws_orphan_audit ${hex(p)} || true`).trim().split('\n').pop()!) as Audit;
const tokenOf = (p: string, pre = STUBS): string => { const a = audit(p, pre); expect(a.token, a.detail).toMatch(/^[0-9a-f]{64}$/); return a.token!; };
interface Out { code: number; doc: Record<string, unknown> }
const orphan = (p: string, token: string, flags = '', pre = STUBS): Out => {
  const out = h.sh(`${pre} cmd_ws_orphan --expect ${token} --tree-hex ${hex(p)} ${flags}; echo "rc=$?"`);
  const lines = out.trim().split('\n');
  const rc = Number(/^rc=(\d+)$/.exec(lines.pop()!)![1]);
  return { code: rc, doc: JSON.parse(lines.pop() ?? '{}') as Record<string, unknown> };
};
/** A mark that must be written (the rows are about the rung, not the verb). */
const mark = (over: Flags = {}, pre = ''): void => {
  const r = markOf(h, over, pre);
  expect(r.doc['ok'], JSON.stringify(r.doc)).toBe(true);
};
const markArgv = (over: Flags): string =>
  Object.entries({ ...BASE, ...over }).filter(([, v]) => v !== null).map(([k, v]) => `--${k} ${v}`).join(' ');
const byTree = (): string => path.join(leasesDir(h), 'by-tree');
/** The one by-tree entry a mark wrote. */
const entry = (): string => {
  const names = fs.readdirSync(byTree()).filter((n) => !n.startsWith('.'));
  expect(names).toHaveLength(1);
  return path.join(byTree(), names[0]!);
};
const editCarrier = (edit: (c: Record<string, unknown>) => void): void => {
  const c = JSON.parse(fs.readFileSync(carrierPath(h), 'utf8')) as Record<string, unknown>;
  edit(c);
  fs.writeFileSync(carrierPath(h), `${JSON.stringify(c)}\n`);
};
/** The token's input names, read with the encoder redefined to print them. */
const inputNames = (p: string): string[] => {
  const names = '_ws_reclaim_fingerprint() { local a out=""; for a in "$@"; do out+="${a%%=*} "; done; printf "%s" "${out% }"; };';
  return h.sh(`${STUBS} ${names} _ws_orphan_ladder "$(_ws_orphan_unhex ${hex(p)})" >/dev/null 2>&1 || :; printf "%s" "$_WS_ORPHAN_TOKEN"`)
    .trim().split(' ').filter(Boolean);
};
const adopted = (gen: string, expiresAt: number): Flags => ({ generation: gen, state: 'adopted', 'expires-at': String(expiresAt), 'journal-seq': String(7 + Number(gen)) });

describe('the lease rung refuses a held tree', () => {
  it('W5-O1: a tree whose carrier is adopted and unexpired is refused `leased`, and the act removes nothing', () => {
    const t = agentTree(h); mark();
    const until = Date.now() + 7 * DAY;
    mark(adopted('2', until));
    const a = audit(t);
    expect(a).toMatchObject({ verdict: 'refused', refusal: 'leased' });
    expect(a.detail).toContain(`until ${new Date(until).toISOString()},`);   // the expiry as an ISO instant, never epoch ms (F7)
    expect(a.detail).not.toMatch(/epoch ms|until \d+[ ,]/);
    // the instant is UTC whatever the box's zone (the rung prints it with TZ=UTC0)
    const ny = audit(t, `${STUBS} export TZ=America/New_York;`);
    expect(ny).toMatchObject({ verdict: 'refused', refusal: 'leased' });
    expect(ny.detail).toContain(`until ${new Date(until).toISOString()},`);
    expect(a.token).toBeNull();
    expect(a.rescueToken).toBeNull();
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('W5-O2: a token minted before the carrier moved is refused state-changed at the act', () => {
    const t = agentTree(h); mark();                                       // ephemeral: not held
    const token = tokenOf(t);
    mark(adopted('2', Date.now() + DAY));
    const r = orphan(t, token);
    expect(r.doc['removed']).toBeUndefined();
    expect(r.doc['refused']).toBe('state-changed');
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('W5-O2b: the token binds the generation alone (same lease, same state, an expired hold)', () => {
    const t = agentTree(h); mark();
    const past = Date.now() - 2 * HOUR;
    mark(adopted('2', past));                                             // adopted, expired past the margin: free
    const token = tokenOf(t);
    mark({ generation: '3', state: 'transferring', 'journal-seq': '10' });
    mark(adopted('4', past));                                             // the lease and the state as they were; leasegen differs
    expect(audit(t).verdict).toBe('token');                               // the in-lock ladder passes ...
    const r = orphan(t, token);
    expect(r.doc['removed']).toBeUndefined();
    expect(r.doc['refused']).toBe('state-changed');                       // ... so the token compare refuses
    expect(r.doc['detail']).toMatch(/changed since the audit/);
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('W5-O5: retained 30 minutes past expiry is still leased (the margin); 2 hours past is not held', () => {
    const t = agentTree(h); mark();
    mark({ generation: '2', state: 'retained', 'expires-at': String(Date.now() - 30 * 60_000), 'journal-seq': '9' });
    expect(audit(t)).toMatchObject({ verdict: 'refused', refusal: 'leased' });
    mark({ generation: '3', state: 'retained', 'expires-at': String(Date.now() - 2 * HOUR), 'journal-seq': '10' });
    const a = audit(t);
    expect(a.verdict, a.detail).toBe('token');                            // the ladder's later rungs decide: clean, pushed, quiet
  }, 60_000);

  it('W5-O6: transferring with no expiresAt is leased', () => {
    const t = agentTree(h); mark();
    mark({ generation: '2', state: 'transferring', 'journal-seq': '9' });
    expect(audit(t)).toMatchObject({ verdict: 'refused', refusal: 'leased' });
  }, 60_000);

  it('W5-O6b: adopted or retained at this tree with no expiresAt is unmeasured, never not held', () => {
    for (const state of ['adopted', 'retained']) {
      const t = agentTree(h); mark();
      mark({ generation: '2', state, 'expires-at': String(Date.now() + DAY), 'journal-seq': '9' });
      editCarrier((c) => { c['expiresAt'] = null; });                     // a carrier the mark could also write (its flag is optional)
      const a = audit(t);
      expect(a, state).toMatchObject({ verdict: 'unmeasured', token: null, rescueToken: null });
      expect(a.detail, state).toMatch(/holds this tree \((adopted|retained)\) with no expiry/);
      expect(fs.existsSync(t), state).toBe(true);
      h.git(main(h), 'worktree', 'remove', '--force', t);
      h.git(main(h), 'worktree', 'prune');
      h.git(main(h), 'branch', '-D', 'claude/agent-a');
      fs.rmSync(path.join(reg(h), 'delegation'), { recursive: true });
    }
  }, 120_000);

  it('W5-O8: the rung runs inside the lock (the carrier moves to adopted after the audit\'s rung, before the lock)', () => {
    const t = agentTree(h); mark();
    const flag = path.join(h.home, 'marked-once');
    // the audit's own holder probe (rung 12, after the lease rung read `ephemeral`) marks the carrier adopted, once
    const moving = `_ws_path_users_many() { local i; if [[ ! -e '${flag}' ]]; then : > '${flag}';`
      + ` cmd_ws_lease_mark ${markArgv(adopted('2', Date.now() + DAY))} >/dev/null; fi;`
      + ' _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
      + ' for i in "$@"; do _WS_PATH_USERS_RCS+=(0); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=(""); done; return 0; };';
    const token = tokenOf(t, `${STUBS} ${moving}`);                       // minted over the ephemeral carrier
    expect(JSON.parse(fs.readFileSync(carrierPath(h), 'utf8'))).toMatchObject({ state: 'adopted', generation: 2 });
    const r = orphan(t, token);
    expect(r.doc['removed']).not.toBe(true);
    expect(r.doc['refused']).toBe('state-changed');
    expect(String(r.doc['detail'])).toContain('leased');                  // the in-lock ladder's own rung refused
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);
});

describe('the lease rung fails shut: every unreadable answer is unmeasured', () => {
  it('W5-O3: the by-tree entry is a link, a directory, or unreadable: unmeasured, tree kept', () => {
    const t = agentTree(h); mark();
    const e = entry(); const held = path.join(h.home, 'held-id');
    fs.writeFileSync(held, `${LEASE}\n`);
    fs.rmSync(e); fs.symlinkSync(held, e);
    expect(audit(t)).toMatchObject({ verdict: 'unmeasured', token: null });
    fs.rmSync(e); fs.mkdirSync(e);
    expect(audit(t)).toMatchObject({ verdict: 'unmeasured', token: null });
    fs.rmSync(e, { recursive: true }); fs.writeFileSync(e, `${LEASE}\n`);
    expect(audit(t).verdict).toBe('token');                               // CONTROL: the entry restored, the ephemeral carrier frees it
    if (!ROOT) {
      fs.chmodSync(e, 0o000);
      try { expect(audit(t)).toMatchObject({ verdict: 'unmeasured', token: null }); } finally { fs.chmodSync(e, 0o600); }
    }
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('W5-O3: the by-tree directory is a link, or searchable but not listable, while a carrier stands: unmeasured, tree kept', () => {
    const t = agentTree(h); mark();
    const saved = path.join(h.home, 'by-tree-saved'); const empty = path.join(h.home, 'empty-dir');
    fs.renameSync(byTree(), saved); fs.mkdirSync(empty); fs.symlinkSync(empty, byTree());
    const linked = audit(t);
    expect(linked, linked.detail).toMatchObject({ verdict: 'unmeasured', token: null, rescueToken: null });
    expect(linked.detail).toMatch(/link/);
    fs.rmSync(byTree()); fs.renameSync(saved, byTree());
    expect(audit(t).verdict).toBe('token');                               // CONTROL: the index restored, the ephemeral carrier frees it
    if (!ROOT) {
      fs.chmodSync(byTree(), 0o300);                                      // searchable, not listable
      try {
        const a = audit(t);
        expect(a, a.detail).toMatchObject({ verdict: 'unmeasured', token: null, rescueToken: null });
        expect(a.detail).toMatch(/cannot be listed/);
      } finally { fs.chmodSync(byTree(), 0o700); }
    }
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('W5-O3b: no by-tree directory while a carrier stands is unmeasured; with no carrier it is not held', () => {
    const t = agentTree(h); mark();
    fs.rmSync(byTree(), { recursive: true });
    const a = audit(t);
    expect(a).toMatchObject({ verdict: 'unmeasured', token: null });
    expect(a.detail).toMatch(/lease index is missing while carriers exist/);
    expect(fs.existsSync(t)).toBe(true);
    fs.rmSync(carrierPath(h));                                            // leases/ now holds no carrier: none can hold the tree
    expect(audit(t).verdict).toBe('token');
  }, 60_000);

  it('W5-O3c: an empty leases directory with no by-tree directory is not held; an unreadable leases directory is unmeasured', () => {
    const t = agentTree(h);
    fs.mkdirSync(leasesDir(h), { recursive: true });
    expect(audit(t).verdict).toBe('token');
    if (!ROOT) {
      fs.chmodSync(leasesDir(h), 0o300);                                  // searchable, not listable: a carrier cannot be ruled out
      try { expect(audit(t)).toMatchObject({ verdict: 'unmeasured', token: null }); } finally { fs.chmodSync(leasesDir(h), 0o700); }
    }
  }, 60_000);

  it('W5-O4: the entry names a lease whose carrier is missing, malformed, or holding at another path: unmeasured, tree kept', () => {
    const t = agentTree(h); mark();
    const saved = fs.readFileSync(carrierPath(h));
    fs.rmSync(carrierPath(h));
    expect(audit(t)).toMatchObject({ verdict: 'unmeasured', token: null });
    fs.writeFileSync(carrierPath(h), '{"v":1,');
    expect(audit(t)).toMatchObject({ verdict: 'unmeasured', token: null });
    fs.writeFileSync(carrierPath(h), saved);
    mark(adopted('2', Date.now() + DAY));
    const other = path.join(main(h), '.claude', 'worktrees', 'agent-z');
    for (const state of ['adopted', 'retained', 'transferring']) {
      editCarrier((c) => { c['state'] = state; c['canonicalPath'] = other; if (state === 'transferring') c['expiresAt'] = null; });
      const a = audit(t);
      expect(a, state).toMatchObject({ verdict: 'unmeasured', token: null });
    }
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('W5-O4b: the half-written mark (index written, carrier rename failed) is unmeasured until the verb\'s index-cleared heal', () => {
    const t = agentTree(h);
    const failCarrier = 'eval "$(declare -f _plat_mv_notdir | sed \'1s/_plat_mv_notdir/__w5_orig_mv/\')";'
      + ' _plat_mv_notdir() { [[ "${2-}" == *.json ]] && return 1; __w5_orig_mv "$@"; };';
    const r = markOf(h, {}, failCarrier);
    expect(r.doc['ok']).toBe(false);
    expect(fs.existsSync(entry())).toBe(true);
    expect(fs.existsSync(carrierPath(h))).toBe(false);
    expect(audit(t)).toMatchObject({ verdict: 'unmeasured', token: null });
    const heal = markOf(h, { state: 'released', 'release-reason': 'native-removed' });
    expect(heal.doc).toMatchObject({ ok: true, answer: 'index-cleared' });
    const a = audit(t);
    expect(a.verdict, a.detail).toBe('token');
  }, 60_000);

  it('W5-O4c: a reused admin record whose lease no longer holds (released, ephemeral, promoted) leaves a new tree free', () => {
    const states: Flags[] = [
      { generation: '2', state: 'released', 'release-reason': 'native-removed', 'journal-seq': '9' },
      {},
      { generation: '2', state: 'promoted', 'promoted-run': '41', 'promoted-session': 'lane-a-demo', 'journal-seq': '9' },
    ];
    for (const over of states) {
      const first = agentTree(h); mark();
      if (Object.keys(over).length > 0) mark(over);
      h.git(main(h), 'worktree', 'remove', '--force', first);
      h.git(main(h), 'worktree', 'prune');
      // a new, unleased tree at another path on the same admin record (`agent-a`)
      const at = path.join(h.home, 'worktrees', 'demo', 'agent-a');
      fs.mkdirSync(path.dirname(at), { recursive: true });
      h.git(main(h), 'worktree', 'add', '-b', 'ws/agent-a', '--', at);
      const t = fs.realpathSync(at);
      expect(fs.readFileSync(path.join(t, '.git'), 'utf8')).toMatch(/worktrees\/agent-a\n?$/);
      const a = audit(t);
      expect(a.verdict, `${String(over['state'] ?? 'ephemeral')}: ${a.detail}`).toBe('token');
      // reset for the next state
      h.git(main(h), 'worktree', 'remove', '--force', t);
      h.git(main(h), 'worktree', 'prune');
      h.git(main(h), 'branch', '-D', 'ws/agent-a', 'claude/agent-a');
      fs.rmSync(path.join(reg(h), 'delegation'), { recursive: true });
    }
  }, 120_000);

  it('W5-O4d: a clock that answers no whole number of seconds is unmeasured, never not held', () => {
    const t = agentTree(h); mark();
    mark(adopted('2', Date.now() + DAY));
    for (const bad of ['1.5', '12x', '', '08', '0999999999']) {
      const clock = `_now_s_to() { printf -v "$1" '%s' '${bad}'; };`;
      const a = audit(t, `${STUBS} ${clock}`);
      expect(a, JSON.stringify(bad)).toMatchObject({ verdict: 'unmeasured', token: null });
      expect(a.detail, JSON.stringify(bad)).toMatch(/clock/);
    }
    expect(audit(t)).toMatchObject({ verdict: 'refused', refusal: 'leased' });   // CONTROL: the real clock holds it
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);
});

describe('the lease rung is inert where no carrier holds', () => {
  /** The six W5-O0 trees, each built in a fresh fixture HOME with `before` laid on its registry, characterised. */
  const sixUnder = (before: (t: string, record: string) => void): Record<string, LadderDoc> => {
    const out: Record<string, LadderDoc> = {};
    for (const [name, c] of Object.entries(LADDER_CASES)) {
      const hh = makeCcdHarness('ccrc-orphan-lease-six-');
      try {
        hh.makeRepo('demo');
        const prev = h; h = hh;
        try { const t = c.build(hh); before(t, c.record); out[name] = characterise(hh, t); } finally { h = prev; }
      } finally { hh.cleanup(); }
    }
    return out;
  };
  /** The carrier's marks, at the tree's own admin record. The mark refuses a locked or registered tree, so the locked case is
   *  unlocked and the registry row inside is set aside for them, each restored before the tree is characterised. */
  const marks = (t: string, record: string, ...overs: Flags[]): void => {
    const locked = /locked/.test(h.git(main(h), 'worktree', 'list', '--porcelain').split('\n\n').find((b) => b.startsWith(`worktree ${t}\n`)) ?? '');
    const row = path.join(reg(h), 'plain-a.workdir'); const aside = path.join(h.home, 'plain-a.workdir.aside');
    const registered = fs.existsSync(row);
    if (locked) h.git(main(h), 'worktree', 'unlock', t);
    if (registered) fs.renameSync(row, aside);
    try {
      for (const over of [{}, ...overs]) mark({ 'admin-record-hex': hex(record), ...over });
    } finally {
      if (registered) fs.renameSync(aside, row);
      if (locked) h.git(main(h), 'worktree', 'lock', t);
    }
  };

  it('W5-O7: no $REG/delegation at all: the six W5-O0 documents equal the fixture, the three new input names last', () => {
    const t = agentTree(h);
    expect(fs.existsSync(path.join(reg(h), 'delegation'))).toBe(false);
    expect(inputNames(t).slice(-3)).toEqual(['lease', 'leasegen', 'leasestate']);
    expect(sixUnder(() => { expect(fs.existsSync(path.join(reg(h), 'delegation'))).toBe(false); })).toEqual(ladderFixture());
  }, 240_000);

  for (const [label, overs] of [
    ['ephemeral', []],
    ['promoted', [{ generation: '2', state: 'promoted', 'promoted-run': '41', 'promoted-session': 'lane-a-demo', 'journal-seq': '9' }]],
    ['released', [{ generation: '2', state: 'released', 'release-reason': 'native-removed', 'journal-seq': '9' }]],
  ] as Array<[string, Flags[]]>) {
    it(`W5-O7: a carrier ${label} at each tree: the six W5-O0 documents equal the fixture`, () => {
      expect(sixUnder((t, record) => { marks(t, record, ...overs); expect(fs.existsSync(carrierPath(h))).toBe(true); })).toEqual(ladderFixture());
    }, 240_000);
  }

  it('W5-O7b: a registry holding only the spool: the six documents equal the fixture, and the key is never derived', () => {
    const spoolOnly = (): void => { fs.mkdirSync(path.join(reg(h), 'delegation', 'spool', 'lane-a-demo'), { recursive: true }); };
    expect(sixUnder(() => { spoolOnly(); })).toEqual(ladderFixture());
    // a leaseless tree whose gitfile is unreadable, or names no admin record of this repository: main's later rung answers, not
    // the rung's `unmeasured` (the key, which needs the gitfile, is never derived while leases/ does not stand)
    const breakings: Array<[string, (t: string) => void]> = [
      ['a gitfile naming a record outside <common>/worktrees', (t) => { fs.writeFileSync(path.join(t, '.git'), `gitdir: ${path.join(h.home, 'elsewhere')}\n`); }],
    ];
    if (!ROOT) breakings.push(['an unreadable gitfile', (t) => { fs.chmodSync(path.join(t, '.git'), 0o000); }]);
    for (const [label, breakIt] of breakings) {
      const none = sixUnder((t) => { breakIt(t); });
      expect(sixUnder((t) => { spoolOnly(); breakIt(t); }), label).toEqual(none);
    }
  }, 480_000);

  it('W5-O9b: cmd_caps prints orphan-lease-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('orphan-lease-v1');
  }, 60_000);
});
