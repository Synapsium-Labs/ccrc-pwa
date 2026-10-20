// path-identity W2 (TR3 A, TR4 A; path-identity spec §3.2): a witness drop that is not COMPLETE is RECORDED by each
// of its three callers in the reclaim and expiry tail, never swallowed.
//   D1 is `_ws_tmproot_remove`, step (6)'s removal arm: it maps the drop's kept (1) and unmeasured (2) answers to its
//      own rc 2, "no leaf stands, but …" (its leaf half's 0 means removed or proven absent), which the tail records as
//      it records any rc 2.
//   D2 and D3 are step (6)'s in-use and unmeasured arms (D3 is the arm on Darwin, always): over a leaf PROVEN absent
//      they call the drop alone, and a drop that is not complete keeps the temp root `unmeasured`, its reason "no leaf
//      stands, but" the drop's. No new word: `tmpRootKept` keeps refused, unmeasured and in-use.
// Each caller is pinned on its own by a stubbed drop answering 1 and 2, so a `|| :` restored at one caller reds that
// caller's rows and no other's. The REAL drop is composed at all three (a witness on another device, a quarantine
// slot of the id standing, a quarantine that is a link), ws-expire takes the same tail, and a scan reds any drop call
// in ccd/ccd that discards its answer with `|| :` or `|| true` (other ways of discarding it are not scanned).
// FIXTURE HOMES ONLY (`makePrHarness`): the unit and the pane are stubbed (`CHILD_STUBS`, `EXP_STUBS`), and the temp
// root's in-use probe is stubbed in every verb case or answers Darwin's word before it looks, so no case walks `/proc`
// for it: `PROC_SPY` records any such walk, and every verb case asserts there was none. The ws-expire case's audit
// and verb DO walk the real `/proc`, through the expiry ladder's own probe (`_ws_expire_cwd_users`), which nothing
// here stubs, so CLAUDE.md lists this file as a load flake. Nothing here runs ccd against the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-tmproot-drop-prop-'); });
afterEach(() => { h.cleanup(); });

type Run = { code: number; stdout: string; stderr: string };

const tmpRoot = (): string => path.join(h.home, '.cc-tmp');
const leafOf = (id: string = CHILD_ID): string => path.join(tmpRoot(), id);
const witnessOf = (id: string = CHILD_ID): string => path.join(h.home, '.cc-sessions', 'tmproots', id);
const quarantine = (): string => path.join(tmpRoot(), '.ccd-quarantine');

/** The temp root's in-use probe, stubbed: the shapes `ccd-child-tmproot-witness-drop.test.ts` (IN_USE, UNMEASURED)
 *  and `ccd-child-reclaim-done-kept.test.ts` (NOBODY) use, copied as local constants. */
const IN_USE = 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY="stub: in use"; return 1; };';
const UNMEASURED = 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY="stub: not measured"; return 2; };';
const NOBODY = '_ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY=""; return 0; };';
/** Darwin, on any host: the probe answers unmeasured before it looks, so step (6) takes D3. The row that uses it
 *  reaches neither `_plat_devino` nor `rm -rfx` (no clips leaf, no temp leaf, a stubbed drop), so no shim rides it. */
const DARWIN = 'CCD_OS=darwin; CCD_RECLAIM_TMPROOT_WAIT_S=0;';
/** The in-use probe's `/proc` walk, recorded to `$HOME/proc-walks` before it reads: every verb case asserts none ran. */
const PROC_SPY = '_ws_path_users_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };';
/** The drop, stubbed: kept (1) or unmeasured (2), with a reason a case finds in the row. It touches nothing. */
const DROP_STUB = (rc: 1 | 2): string =>
  `_ws_tmproot_witness_drop() { _WS_WDROP=''; _WS_WDROP_WHY='stub: kept'; return ${rc}; };`;

/** Search permission is never asked of root, so a `~/.cc-tmp` made unsearchable is no fixture there. */
const ROOT_USER = process.getuid?.() === 0;
/** `_ws_reclaim_absent`, wrapped: when the DROP asks it of the leaf (its absence, proven again, the last ask before it
 *  drops), `~/.cc-tmp` is made mode 0600, the real function answers (its parent cannot be searched, so 2), and the mode
 *  it had is put back before the drop goes on. The tail's own ask of the leaf, a step earlier, is the real one, and so is
 *  every other. Logged to `$HOME/root-locked`. (`ccd-tmproot-drop-exact.test.ts` has the same seam for the helper.) */
const ROOT_LOCK_AT_REPROVE = (): string => {
  const mode = (fs.statSync(tmpRoot()).mode & 0o7777).toString(8);
  return 'eval "_t_absent_real()$(declare -f _ws_reclaim_absent | tail -n +2)";'
    + ' _ws_reclaim_absent() { local _t_rc; if [[ "${FUNCNAME[1]}" == _ws_tmproot_witness_drop && "$1" == "$HOME/.cc-tmp/' + CHILD_ID + '" ]]; then'
    + ' chmod 0600 "$HOME/.cc-tmp" && echo locked >> "$HOME/root-locked"; _t_absent_real "$@"; _t_rc=$?;'
    + ' chmod ' + mode + ' "$HOME/.cc-tmp"; return "$_t_rc"; fi;'
    + ' _t_absent_real "$@"; };';
};

/** A real child whose temp root the REAL writer made and witnessed (`_child_tmpdir`); the witness's bytes. */
const witnessed = (): string => {
  makeChild(h);
  h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
  expect(fs.statSync(leafOf()).isDirectory(), 'the CONTROL: the leaf stands').toBe(true);
  expect(fs.existsSync(witnessOf()), 'the CONTROL: the real writer witnessed it').toBe(true);
  return fs.readFileSync(witnessOf(), 'utf8');
};

/** The leaf removed before the verb, so step (6) proves it absent: the shape D2 and D3 drop over. */
const leafGone = (id: string = CHILD_ID): void => {
  fs.rmSync(leafOf(id), { recursive: true, force: true });
  expect(fs.existsSync(leafOf(id)), 'the CONTROL: no leaf stands').toBe(false);
};

/** The witness's `dev=` rewritten to 1, a device `~/.cc-tmp` is not on (asserted), so the real `_ws_collect_root_dev`
 *  answers 1 and the drop keeps the witness. Rewritten here rather than with `sed -i`, whose BSD form needs a suffix.
 *  Returns the rewritten bytes. */
const devOne = (id: string = CHILD_ID): string => {
  expect(String(fs.statSync(tmpRoot(), { bigint: true }).dev), 'the CONTROL: ~/.cc-tmp is not on device 1').not.toBe('1');
  const before = fs.readFileSync(witnessOf(id), 'utf8');
  const after = before.replace(/ dev=[0-9]+ /, ' dev=1 ');
  expect(after, 'the CONTROL: the witness carried a dev= field').not.toBe(before);
  fs.writeFileSync(witnessOf(id), after);
  return after;
};

/** `ws-reclaim` of the child with the token its ladder mints now (`evalPre` rides the ladder too, for Darwin's word),
 *  `pre` and `PROC_SPY` riding the verb. */
const reclaim = (pre: string, evalPre = ''): Run => {
  const e = evalOf(h, { pre: evalPre });
  expect(e.verdict, `the CONTROL: the ladder passes — ${e.detail}`).toBe('reclaimable');
  return childReclaimVerb(h, e.token, { pre: `${pre} ${PROC_SPY}` });
};

/** What every verb case asserts: the act completed; the document's `tmpRootKept`; the done row's `meas.tmpRootKept`;
 *  the detail's fixed lead (`tmpwhy` comes first in its own line, and `_ws_leaf_why_line` cuts that line at 300 bytes,
 *  so the lead is never past the cut); the leaf's fate (removed by the verb on D1, gone before it on D2 and D3); and
 *  no walk of `/proc` by the in-use probe. */
const recorded = (r: Run, act: 'reclaim' | 'expire', id: string, lead: string): void => {
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const doc = JSON.parse(r.stdout) as Record<string, unknown>;
  expect(doc[act === 'reclaim' ? 'reclaimed' : 'expired'], 'the act completed').toBe(id);
  expect(doc['tmpRootKept'], 'the document records the kept witness').toBe('unmeasured');
  const done = eventsOf(h.home, act).find((e) => e['outcome'] === 'done');
  expect(done, 'a done row was journaled').toBeDefined();
  expect(measOf(done!)['tmpRootKept'], 'the done row records the kept witness').toBe('unmeasured');
  const detail = String(done!['detail'] ?? '');
  expect(detail).toMatch(/kept \(unmeasured\): no leaf stands, but (stub: kept|its witness was kept: )/);
  expect(detail).toContain(`temp root ${leafOf(id)} kept (unmeasured): ${lead}`);
  expect(fs.existsSync(leafOf(id)), 'no leaf stands: the verb removed it (D1), or it was gone before (D2, D3)').toBe(false);
  expect(fs.existsSync(path.join(h.home, 'proc-walks')), 'the in-use probe never walked /proc').toBe(false);
};

describe('D1, `_ws_tmproot_remove` (step 6’s removal arm): a drop that is not complete is recorded `unmeasured`', () => {
  it.each([1, 2] as const)('D1 rc %i: the stubbed drop answers it — the leaf removed, kept `unmeasured`, "no leaf stands, but …"', (rc) => {
    const before = witnessed();
    const r = reclaim(`${NOBODY} ${DROP_STUB(rc)}`);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the stubbed drop touched nothing').toBe(before);
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but stub: kept');
  }, 90_000);

  it('D1 real, another device: the leaf removed, the witness kept byte for byte, `unmeasured`', () => {
    witnessed();
    fs.writeFileSync(path.join(leafOf(), 'scratch'), 'the leaf content');
    const rewritten = devOne();
    const r = reclaim(NOBODY);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the witness is kept, byte for byte').toBe(rewritten);
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but its witness was kept: ');
  }, 90_000);
});

describe('D2, step (6)’s in-use arm: over a leaf proven absent, a drop that is not complete is recorded `unmeasured`', () => {
  it.each([1, 2] as const)('D2 rc %i: the stubbed drop answers it — kept `unmeasured`, "no leaf stands, but …"', (rc) => {
    const before = witnessed();
    leafGone();
    const r = reclaim(`${IN_USE} ${DROP_STUB(rc)}`);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the stubbed drop touched nothing').toBe(before);
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but stub: kept');
  }, 90_000);

  it('D2 real, another device: the witness kept byte for byte, `unmeasured`', () => {
    witnessed();
    leafGone();
    const rewritten = devOne();
    const r = reclaim(IN_USE);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the witness is kept, byte for byte').toBe(rewritten);
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but its witness was kept: ');
  }, 90_000);

  it('D2 real, a linked quarantine: the witness kept byte for byte, `unmeasured`, the link never followed', () => {
    const before = witnessed();
    leafGone();
    const elsewhere = path.join(h.home, 'elsewhere-quarantine');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, quarantine());
    const r = reclaim(IN_USE);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the witness is kept, byte for byte').toBe(before);
    expect(fs.lstatSync(quarantine()).isSymbolicLink(), 'the link stands').toBe(true);
    expect(fs.readdirSync(elsewhere), 'nothing was written through the link').toEqual([]);
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but its witness was kept: ');
  }, 90_000);

  it.skipIf(ROOT_USER)('D2 real, ~/.cc-tmp unsearchable only at the drop’s re-proof: the witness kept byte for byte, `unmeasured`', () => {
    const before = witnessed();
    leafGone();
    const mode = fs.statSync(tmpRoot()).mode & 0o7777;
    let r: Run;
    try { r = reclaim(`${IN_USE} ${ROOT_LOCK_AT_REPROVE()}`); } finally { fs.chmodSync(tmpRoot(), mode); }
    expect(fs.readFileSync(path.join(h.home, 'root-locked'), 'utf8'), 'the CONTROL: ~/.cc-tmp was made unsearchable at the re-proof, once').toBe('locked\n');
    expect(fs.existsSync(witnessOf()), 'the witness stands: never dropped over an absence that was not proven').toBe(true);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the witness is kept, byte for byte').toBe(before);
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but its witness was kept: the absence of the leaf could not be proven again');
  }, 90_000);
});

describe('D3, step (6)’s unmeasured arm (the arm on Darwin, always): a drop that is not complete is recorded `unmeasured`', () => {
  it.each([1, 2] as const)('D3 rc %i: the stubbed drop answers it — kept `unmeasured`, "no leaf stands, but …"', (rc) => {
    const before = witnessed();
    leafGone();
    const r = reclaim(`${UNMEASURED} ${DROP_STUB(rc)}`);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the stubbed drop touched nothing').toBe(before);
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but stub: kept');
  }, 90_000);

  it('D3 on Darwin, where the probe answers unmeasured before it looks: the stubbed drop answers 1 — kept `unmeasured`', () => {
    const before = witnessed();
    leafGone();
    const r = reclaim(`${DARWIN} ${DROP_STUB(1)}`, DARWIN);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the stubbed drop touched nothing').toBe(before);
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but stub: kept');
  }, 90_000);

  it('D3 real, a quarantine slot of the id: the witness kept byte for byte, `unmeasured`, the slot untouched', () => {
    const before = witnessed();
    leafGone();
    const slot = path.join(quarantine(), `slot.${CHILD_ID}.1.1`);
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, 'keep'), 'the slot content');
    const r = reclaim(UNMEASURED);
    expect(fs.readFileSync(witnessOf(), 'utf8'), 'the witness is kept, byte for byte').toBe(before);
    expect(fs.readFileSync(path.join(slot, 'keep'), 'utf8'), 'the slot is untouched').toBe('the slot content');
    recorded(r, 'reclaim', CHILD_ID, 'no leaf stands, but its witness was kept: ');
  }, 90_000);
});

describe('ws-expire takes the same tail: its D3 records a kept witness the same way', () => {
  it('ws-expire, D3 real: an archived workspace’s witness on another device, its leaf gone — expired, the witness kept, `unmeasured`', () => {
    makeArchived(h);
    fs.mkdirSync(leafOf(EXP_ID), { recursive: true, mode: 0o700 });
    h.sh(`_ws_tmproot_witness_write ${EXP_ID} '${leafOf(EXP_ID)}' 7`);
    expect(fs.existsSync(witnessOf(EXP_ID)), 'the CONTROL: the real writer witnessed the leaf').toBe(true);
    leafGone(EXP_ID);
    const rewritten = devOne(EXP_ID);
    const token = expireToken(h);
    expect(token, 'the CONTROL: the expiry audit minted a token').not.toBe('');
    const r = expireVerb(h, token, { pre: `${UNMEASURED} ${PROC_SPY}` });
    expect(fs.readFileSync(witnessOf(EXP_ID), 'utf8'), 'the witness is kept, byte for byte').toBe(rewritten);
    recorded(r, 'expire', EXP_ID, 'no leaf stands, but its witness was kept: ');
  }, 120_000);
});

describe('the scan: no call of the drop in ccd/ccd discards its answer with `|| :` or `|| true` (path-identity spec §3.2)', () => {
  /** The CODE lines of `text` (whole-line comments dropped) that call `_ws_tmproot_witness_drop` and discard its
   *  answer with `|| :` or `|| true` before any trailing comment. */
  const swallowed = (text: string): string[] => text.split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .filter((l) => /_ws_tmproot_witness_drop\b[^#\n]*\|\|\s*(?::|true\b)/.test(l));

  it('the scan: no `|| :` or `|| true` on any drop call', () => {
    const planted = [
      '         0) _ws_tmproot_witness_drop "$id" || : ;;   # nothing stands there',
      '  _ws_tmproot_witness_drop "$id" || true',
      '  # _ws_tmproot_witness_drop "$id" || :',
      '  _ws_tmproot_witness_drop "$id" && return 0',
    ];
    expect(swallowed(planted.join('\n')), 'the CONTROL: it finds a planted one of each spelling, and passes a comment and a read answer')
      .toEqual([planted[0], planted[1]]);
    const src = fs.readFileSync(CCD, 'utf8');
    const calls = src.split('\n').filter((l) => !/^\s*#/.test(l) && l.includes('_ws_tmproot_witness_drop "$id"'));
    expect(calls.length, 'the CONTROL: the scan reads the three callers').toBeGreaterThanOrEqual(3);
    expect(swallowed(src), 'a drop call that swallows its answer').toEqual([]);
  });
});
