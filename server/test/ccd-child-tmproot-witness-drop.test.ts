// The temp root's witness on the tail's KEPT arms (child reclamation wave 6,
// spec §5.2 for the witness, spec §5.6 for the tail). Step (6) asks who uses
// the temp root; on "in use" or "unmeasured" (on Darwin, always) it keeps the
// leaf — but only a leaf that STANDS is kept. Over a leaf PROVEN absent nothing
// is kept, and the witness of that leaf is nothing to keep either: it goes,
// through `_ws_tmproot_witness_drop`, the witness half of `_ws_tmproot_remove`.
// Before, those arms left `$REG/tmproots/<id>` standing beside no leaf, and
// after the row's purge nothing ever asked about that id again.
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
const DARWIN = 'CCD_OS=darwin; CCD_RECLAIM_TMPROOT_WAIT_S=0;';

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
    ['Darwin, where the probe answers unmeasured unasked — no stub', DARWIN],
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
    'THE WINDOW: probe %s, absence proven (rc 0), and a leaf standing again when step (6) acts — only the witness goes; the leaf is never removed unprobed', (_label, pre) => {
      witnessed();
      fs.writeFileSync(path.join(leaf(), 'precious'), 'written after the absence was proven');
      const r = childReclaimVerb(h, evalOf(h).token, { pre: `${pre} ${ABSENT_AT_STEP6(0)}` });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
      expect(absentAsks(), 'the CONTROL: step (6) asked, once').toEqual([`step6 ${leaf()}`]);
      expect(fs.readFileSync(path.join(leaf(), 'precious'), 'utf8'), 'the re-created leaf is never removed unprobed')
        .toBe('written after the absence was proven');
      expect(fs.existsSync(witness()), 'the witness goes on the proven answer').toBe(false);
      expect(measOf(doneOf())['tmpRootKept']).toBeUndefined();
    }, 90_000);
});

describe('_ws_tmproot_witness_drop — the witness half, alone (spec §5.2)', () => {
  const ID = 'demo-quiet-mesa';
  /** A leaf and the witness the REAL writer writes for it. */
  const plant = (): string => {
    fs.mkdirSync(leaf(ID), { recursive: true });
    fs.writeFileSync(path.join(leaf(ID), 'scratch'), 'the leaf’s own');
    h.sh(`_ws_tmproot_witness_write ${ID} '${leaf(ID)}' 7`);
    expect(fs.existsSync(witness(ID)), 'the CONTROL: the witness was written').toBe(true);
    return fs.readFileSync(witness(ID), 'utf8');
  };
  const drop = (id: string): { code: number; out: string } => {
    const r = h.run(`exec 2>&1; _ws_tmproot_witness_drop '${id}'; echo "[rc=$?]"`);
    return { code: r.code, out: r.stdout + r.stderr };
  };

  it('the plain drop removes the witness and nothing else — the leaf it names is never touched, tmproots/ stays', () => {
    plant();
    expect(drop(ID).out).toBe('[rc=0]');
    expect(fs.existsSync(witness(ID))).toBe(false);
    expect(fs.readFileSync(path.join(leaf(ID), 'scratch'), 'utf8'), 'the leaf stands').toBe('the leaf’s own');
    expect(fs.statSync(wdir()).isDirectory()).toBe(true);
  });

  it('a LINKED tmproots/ is never followed: warned about, rc 0, and the file it reaches stands', () => {
    const bytes = plant();
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.renameSync(wdir(), elsewhere);
    fs.symlinkSync(elsewhere, wdir());
    const r = drop(ID);
    expect(r.out).toContain(`ccd: warn: ${ID}'s temp root is gone but ${wdir()} is a link`);
    expect(r.out).toMatch(/\[rc=0\]$/);
    expect(fs.readFileSync(path.join(elsewhere, ID), 'utf8'), 'the link’s target is untouched').toBe(bytes);
  });

  it.each([['.demo-quiet-mesa.4242.17.tmp'], ['.x']])('an id no witness is named for (%j) is refused, rc 1 — a planted file of that name stands', (id) => {
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(id), 'a writer’s in-flight temp file');
    const r = drop(id);
    expect(r.out).toContain(`'${id}' is not an id a witness is named for`);
    expect(r.out).toMatch(/\[rc=1\]$/);
    expect(fs.readFileSync(witness(id), 'utf8')).toBe('a writer’s in-flight temp file');
  });

  it('a witness that cannot be unlinked is warned about, and never fails its caller: rc 0', () => {
    plant();
    fs.rmSync(witness(ID));
    fs.mkdirSync(path.join(witness(ID), 'inside'), { recursive: true });
    const r = drop(ID);
    expect(r.out).toContain(`ccd: warn: ${ID}'s temp root is gone but its witness ${witness(ID)} could not be removed`);
    expect(r.out).toMatch(/\[rc=0\]$/);
    expect(fs.statSync(witness(ID)).isDirectory()).toBe(true);
  });
});
