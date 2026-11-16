// The temp root's witness on the tail's KEPT arms (child reclamation wave 6,
// spec §5.2 for the witness, spec §5.6 for the tail; path-identity W2, path-identity
// spec §3.2 and §3.3, for the drop). Step (6) asks who uses the temp root; on
// "in use" or "unmeasured" (on Darwin, always) it keeps the leaf — but only a
// leaf that STANDS is kept. Over a leaf PROVEN absent nothing is kept, and the
// witness of that leaf goes to `_ws_tmproot_witness_drop`, the witness half of
// `_ws_tmproot_remove`. Since path-identity W2 that drop is generation-exact: it
// asks the device the witness records and the quarantine slots of the id, proves
// the leaf absent again, and unlinks only the generation it read (a compare-and-
// drop where `mv --no-copy` exists, a second read and a field compare where it
// does not). Otherwise it keeps the witness and says why, printing nothing.
// Before wave 6, those arms left `$REG/tmproots/<id>` standing beside no leaf,
// and after the row's purge nothing ever asked about that id again.
// The arms NEVER go through `_ws_tmproot_remove`: its leaf half would run an
// unprobed removal on a leaf re-created after the absence was proven. An
// absence that could not be proven (`_ws_reclaim_absent` rc 2) is recorded
// `unmeasured`, and the witness stays.
// FIXTURE HOMES ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`CHILD_STUBS`), the in-use probe is stubbed or answers Darwin's word, and
// nothing here runs ccd against the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { DARWIN_IDENT_SHIMS, DARWIN_LSOF_STUB } from './worktreeIdentityFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-tmproot-witness-drop-'); });
afterEach(() => { h.cleanup(); });

const wdir = (): string => path.join(h.home, '.cc-sessions', 'tmproots');
const witness = (id: string = CHILD_ID): string => path.join(wdir(), id);
const leaf = (id: string = CHILD_ID): string => path.join(h.home, '.cc-tmp', id);
const doneOf = (): Record<string, unknown> => eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;

/** A real child whose temp root the REAL writer made and witnessed. */
const witnessed = (): string => {
  makeChild(h);
  h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
  expect(fs.existsSync(witness()), 'the CONTROL: the real writer witnessed the child’s leaf').toBe(true);
  expect(fs.statSync(leaf()).isDirectory(), 'the CONTROL: the leaf stands').toBe(true);
  return fs.readFileSync(witness(), 'utf8');
};

const IN_USE = 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY="stub: in use"; return 1; };';
const UNMEASURED = 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY="stub: not measured"; return 2; };';
const DARWIN = `CCD_OS=darwin; CCD_RECLAIM_TMPROOT_WAIT_S=0; ${DARWIN_LSOF_STUB}`;
/** Simulated Darwin on a Linux host: `_plat_devino`'s Darwin arm runs BSD `stat -f`, which GNU `stat` refuses, so the
 *  drop's device question would read unreadable. The Linux arm stands in for it there; on a Darwin host nothing is
 *  added. With it, the Darwin row takes the drop's second-read path (path-identity spec §3.2). Since path-identity W3
 *  the tail's owned check measures identities too (`_plat_devino` and `_plat_btime`), so this is the fixture's one
 *  host-conditional pair, `DARWIN_IDENT_SHIMS`. */
const DEVINO_SHIM = DARWIN_IDENT_SHIMS;

/** `_ws_reclaim_absent`, answering `rc` for the temp root when step (6) asks — and only then — and the real
 *  answer everywhere else. Each such ask is recorded in `$HOME/absent-asks`. */
const ABSENT_AT_STEP6 = (rc: 0 | 2): string =>
  `eval "_t_absent_real()$(declare -f _ws_reclaim_absent | tail -n +2)";`
  + ' _ws_reclaim_absent() { if [[ "${FUNCNAME[1]}" == _ws_reclaim_tail && "$1" == "$HOME/.cc-tmp/' + CHILD_ID + '" ]]; then'
  + ` echo "step6 $1" >> "$HOME/absent-asks"; _WS_ABSENT_WHY="stub: absence unmeasured"; return ${rc}; fi;`
  + ' _t_absent_real "$@"; };';
const absentAsks = (): string[] => {
  const p = path.join(h.home, 'absent-asks');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

describe('a temp root ALREADY GONE at step (6): its witness goes with it, on the kept arms too (spec §5.2, spec §5.6)', () => {
  it.each([
    ['the probe answers in use (rc 1)', IN_USE],
    ['the probe answers unmeasured (rc 2)', UNMEASURED],
    ['Darwin, where the probe answers unmeasured unasked — no stub; the drop takes its second-read path', `${DARWIN} ${DEVINO_SHIM}`],
  ])('%s: reclaimed, nothing kept, the witness GONE', (_label, pre) => {
    witnessed();
    fs.rmSync(leaf(), { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h, { pre }).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(leaf()), 'no leaf was made').toBe(false);
    expect(fs.existsSync(witness()), 'the witness of a leaf PROVEN absent is dropped').toBe(false);
    expect(fs.statSync(wdir()).isDirectory(), 'tmproots/ itself stays').toBe(true);
    const done = doneOf();
    expect(measOf(done)['tmpRootKept'], 'over nothing, nothing is kept').toBeUndefined();
    expect(String(done['detail'] ?? '')).not.toContain('temp root');
  }, 90_000);

  it.each([['in use', IN_USE, 'in-use'], ['unmeasured', UNMEASURED, 'unmeasured']] as const)(
    'CONTROL: a temp root that STANDS and is %s keeps the leaf AND the witness, recorded', (_label, pre, word) => {
      const before = witnessed();
      fs.writeFileSync(path.join(leaf(), 'scratch'), 'kept');
      const r = childReclaimVerb(h, evalOf(h).token, { pre });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(fs.readFileSync(path.join(leaf(), 'scratch'), 'utf8'), 'the leaf is kept').toBe('kept');
      expect(fs.readFileSync(witness(), 'utf8'), 'its witness is kept, byte for byte').toBe(before);
      expect(measOf(doneOf())['tmpRootKept']).toBe(word);
    }, 90_000);
});

describe('step (6) reads `_ws_reclaim_absent`’s THREE answers on the kept arms', () => {
  it.each([['in use', IN_USE], ['unmeasured', UNMEASURED]] as const)(
    'probe %s, absence UNMEASURED (rc 2): kept `unmeasured` with the absence’s reason, and the witness stays', (_label, pre) => {
      const before = witnessed();
      fs.rmSync(leaf(), { recursive: true, force: true });
      const r = childReclaimVerb(h, evalOf(h).token, { pre: `${pre} ${ABSENT_AT_STEP6(2)}` });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
      expect(absentAsks(), 'the CONTROL: step (6) asked, once').toEqual([`step6 ${leaf()}`]);
      const done = doneOf();
      expect(measOf(done)['tmpRootKept']).toBe('unmeasured');
      expect(String(done['detail'])).toContain(`temp root ${leaf()} kept (unmeasured): stub: absence unmeasured`);
      expect(fs.readFileSync(witness(), 'utf8'), 'a witness beside an absence never proven stays').toBe(before);
    }, 90_000);

  it.each([['in use', IN_USE], ['unmeasured', UNMEASURED]] as const)(
    'THE WINDOW: probe %s, absence proven (rc 0), and a leaf standing again when step (6) acts — the drop proves the absence again, so the leaf and its witness both stay; the leaf is never removed unprobed', (_label, pre) => {
      const before = witnessed();
      fs.writeFileSync(path.join(leaf(), 'precious'), 'written after the absence was proven');
      const r = childReclaimVerb(h, evalOf(h).token, { pre: `${pre} ${ABSENT_AT_STEP6(0)}` });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
      expect(absentAsks(), 'the CONTROL: step (6) asked, once — the drop’s own ask is not step (6)’s, so it is answered for real').toEqual([`step6 ${leaf()}`]);
      expect(fs.readFileSync(path.join(leaf(), 'precious'), 'utf8'), 'the re-created leaf is never removed unprobed')
        .toBe('written after the absence was proven');
      expect(fs.readFileSync(witness(), 'utf8'), 'a leaf stands at the drop’s own proof: its witness stays, byte for byte')
        .toBe(before);
      expect(measOf(doneOf())['tmpRootKept']).toBe('unmeasured');
    }, 90_000);
});

describe('_ws_tmproot_witness_drop — the witness half, alone (spec §5.2; path-identity spec §3.2 and §3.3)', () => {
  const ID = 'demo-quiet-mesa';
  /** A leaf and the witness the REAL writer writes for it. */
  const plant = (): string => {
    fs.mkdirSync(leaf(ID), { recursive: true });
    fs.writeFileSync(path.join(leaf(ID), 'scratch'), 'the leaf’s own');
    h.sh(`_ws_tmproot_witness_write ${ID} '${leaf(ID)}' 7`);
    expect(fs.existsSync(witness(ID)), 'the CONTROL: the witness was written').toBe(true);
    return fs.readFileSync(witness(ID), 'utf8');
  };
  /** The drop, its stderr merged IN FRONT of its answer: anything it printed comes before `[rc=`. */
  const drop = (id: string): { code: number; out: string } => {
    const r = h.run(`exec 2>&1; _ws_tmproot_witness_drop '${id}'; echo "[rc=$?] \${_WS_WDROP-}|\${_WS_WDROP_WHY-}"`);
    return { code: r.code, out: r.stdout + r.stderr };
  };

  it('a leaf that STANDS keeps its witness: the drop proves the absence again, answers kept, and touches nothing', () => {
    const bytes = plant();
    expect(drop(ID).out).toMatch(/^\[rc=1\] \|its witness was kept: a leaf stands at /);
    expect(fs.readFileSync(witness(ID), 'utf8'), 'the witness stays, byte for byte').toBe(bytes);
    expect(fs.readFileSync(path.join(leaf(ID), 'scratch'), 'utf8'), 'the leaf stands').toBe('the leaf’s own');
  });

  it('the leaf gone: the drop removes the witness and nothing else — tmproots/ stays', () => {
    plant();
    fs.rmSync(leaf(ID), { recursive: true, force: true });
    expect(drop(ID).out).toBe('[rc=0] dropped|');
    expect(fs.existsSync(witness(ID))).toBe(false);
    expect(fs.statSync(wdir()).isDirectory()).toBe(true);
  });

  it('a LINKED tmproots/ is never followed: unmeasured (rc 2), nothing printed, and the file it reaches stands', () => {
    const bytes = plant();
    fs.rmSync(leaf(ID), { recursive: true, force: true });
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.renameSync(wdir(), elsewhere);
    fs.symlinkSync(elsewhere, wdir());
    const r = drop(ID);
    expect(r.out, 'nothing printed before the answer').toMatch(/^\[rc=2\] \|its witness was kept: /);
    expect(r.out).not.toContain('ccd: warn');
    expect(fs.readFileSync(path.join(elsewhere, ID), 'utf8'), 'the link’s target is untouched').toBe(bytes);
  });

  it.each([['.demo-quiet-mesa.4242.17.tmp'], ['.x']])('an id no witness is named for (%j) is refused, rc 1, its reason in _WS_WDROP_WHY and nothing printed — a planted file of that name stands', (id) => {
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(id), 'a writer’s in-flight temp file');
    const r = drop(id);
    expect(r.out).toMatch(/^\[rc=1\] \|its witness was kept: /);
    expect(r.out).toContain(`'${id}' is not an id a witness is named for`);
    expect(r.out).not.toContain('ccd: warn');
    expect(fs.readFileSync(witness(id), 'utf8')).toBe('a writer’s in-flight temp file');
  });

  it('a directory at the witness name is no witness ccd wrote: unmeasured (rc 2), nothing printed, and it stands', () => {
    plant();
    fs.rmSync(leaf(ID), { recursive: true, force: true });
    fs.rmSync(witness(ID));
    fs.mkdirSync(path.join(witness(ID), 'inside'), { recursive: true });
    const r = drop(ID);
    expect(r.out).toMatch(/^\[rc=2\] \|its witness was kept: /);
    expect(r.out).not.toContain('ccd: warn');
    expect(fs.statSync(witness(ID)).isDirectory()).toBe(true);
  });
});
