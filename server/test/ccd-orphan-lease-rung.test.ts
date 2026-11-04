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
    mark(adopted('2', Date.now() + 7 * DAY));
    const a = audit(t);
    expect(a).toMatchObject({ verdict: 'refused', refusal: 'leased' });
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
});

describe('the lease rung is inert where no carrier holds', () => {
  it('W5-O7: no $REG/delegation at all, and an ephemeral, promoted or released carrier: not held, with three new token inputs', () => {
    const t = agentTree(h);
    expect(fs.existsSync(path.join(reg(h), 'delegation'))).toBe(false);
    expect(audit(t).verdict).toBe('token');
    const names = inputNames(t);
    expect(names.slice(-3)).toEqual(['lease', 'leasegen', 'leasestate']);
    mark();
    expect(audit(t).verdict).toBe('token');
    mark({ generation: '2', state: 'promoted', 'promoted-run': '41', 'promoted-session': 'lane-a-demo', 'journal-seq': '9' });
    expect(audit(t).verdict).toBe('token');
    mark({ generation: '3', state: 'released', 'release-reason': 'native-removed', 'journal-seq': '10' });
    expect(audit(t).verdict).toBe('token');
    expect(inputNames(t)).toEqual(names);
  }, 60_000);

  it('W5-O9b: cmd_caps prints orphan-lease-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('orphan-lease-v1');
  }, 60_000);
});
