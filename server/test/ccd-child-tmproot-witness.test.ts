// Child-reclamation wave 6, Task 7: the temp root's POSITIVE WITNESS
// (spec §5.2, with spec §5.6's removal order).
//
// `_child_tmpdir`'s rc-0 arm writes `$REG/tmproots/<id>`: one versioned
// key=value line binding the leaf's dev, ino and birth time to the run that
// minted it. It is rewritten only when absent or stale, never written on rc 1
// or rc 2, and a failed write never fails a spawn. It dies only after
// `_ws_leaf_remove` has PROVEN the leaf absent (`_ws_tmproot_remove`), so a
// leaf the tail keeps because it is in use keeps its witness too.
//
// FIXTURE HOMES ONLY (`makePrHarness`). The tail cases run the sourced verb
// with the unit, the pane and the in-use probe stubbed (`CHILD_STUBS`, `pre`);
// nothing here runs ccd against the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-tmproot-witness-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const wdir = (): string => path.join(h.home, '.cc-sessions', 'tmproots');
const witness = (id: string = ID): string => path.join(wdir(), id);
const leaf = (id: string = ID): string => path.join(h.home, '.cc-tmp', id);

/** `ccd-child-tmpdir.test.ts`'s seed: the three fields `_spawn_start` refuses
 *  without, plus the marker when given. */
const seed = (id: string, child: string | null): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  if (child !== null) h.sh(`_reg_set ${id} child '${child}'`);
};

/** A snippet's merged stdout and stderr, and its status — never a throw. */
const run = (snippet: string): { code: number; out: string } => {
  const r = h.run(`exec 2>&1; ${snippet}`);
  return { code: r.code, out: r.stdout + r.stderr };
};

/** The witness as [key, value] pairs, in file order. */
const fieldsOf = (p: string = witness()): Array<[string, string]> =>
  fs.readFileSync(p, 'utf8').replace(/\n$/, '').split(' ').map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i), kv.slice(i + 1)] as [string, string];
  });
const field = (k: string, p: string = witness()): string | undefined =>
  fieldsOf(p).find(([key]) => key === k)?.[1];

/** What the witness must say about `p`, measured by NODE's stat — never by ccd. */
const measured = (p: string): { dev: string; ino: string; btime: string; uid: string } => {
  const st = fs.statSync(p, { bigint: true });
  const bt = st.birthtimeNs / 1_000_000_000n;
  return { dev: String(st.dev), ino: String(st.ino), btime: bt > 0n ? String(bt) : '-', uid: String(process.getuid?.()) };
};
const LINE = /^v=1 id=(\S+) run=(\S+) dev=\d+ ino=\d+ btime=(?:[1-9]\d*|-) uid=\d+ at=\d{13}\n$/;

describe('_child_tmpdir writes the witness on rc 0, and only on rc 0 (spec §5.2)', () => {
  it('rc 0 writes ONE versioned line binding the leaf’s dev, ino, btime and uid to the run — silently', () => {
    seed(ID, '7');
    const before = Date.now();
    const r = run(`_child_tmpdir ${ID}; echo "[rc=$?]"`);
    const after = Date.now();
    expect(r.out, 'rc 0 prints the path and nothing else — a witness write is silent').toBe(`${leaf()}[rc=0]`);
    expect(fs.readFileSync(witness(), 'utf8')).toMatch(LINE);
    expect(fieldsOf().map(([k]) => k)).toEqual(['v', 'id', 'run', 'dev', 'ino', 'btime', 'uid', 'at']);
    expect(field('id')).toBe(ID);
    expect(field('run')).toBe('7');
    expect({ dev: field('dev'), ino: field('ino'), btime: field('btime'), uid: field('uid') }).toEqual(measured(leaf()));
    const at = Number(field('at'));
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
    expect(fs.readdirSync(wdir()), 'temp file then mv: nothing else is left in tmproots/').toEqual([ID]);
  });

  it('a leaf that already exists with no witness — one older than this wave — is witnessed on its next spawn', () => {
    seed(ID, '7');
    fs.mkdirSync(leaf(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(leaf(), 'scratch'), 'x');
    expect(fs.existsSync(witness())).toBe(false);
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(field('ino')).toBe(measured(leaf()).ino);
  });

  it('a CURRENT witness is never rewritten — its own inode and bytes stand across respawns', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const ino = fs.statSync(witness()).ino;
    const bytes = fs.readFileSync(witness(), 'utf8');
    h.sh(`_child_tmpdir ${ID} >/dev/null; _child_tmpdir ${ID} >/dev/null`);
    expect(fs.statSync(witness()).ino, 'rewritten: a respawn replaced a current witness').toBe(ino);
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('a leaf REPLACED by a new inode is re-witnessed — by a new file moved into place, never a write in place', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const oldLeafIno = field('ino');
    const oldWitnessIno = fs.statSync(witness()).ino;
    // Renamed AWAY, not removed: the old inode stays allocated, so the new
    // leaf cannot be handed the same inode number (ext4 reuses freed ones).
    fs.renameSync(leaf(), `${leaf()}.old`);
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(field('ino')).toBe(measured(leaf()).ino);
    expect(field('ino')).not.toBe(oldLeafIno);
    expect(fs.statSync(witness()).ino, 'the witness was written in place, not temp file then mv').not.toBe(oldWitnessIno);
    expect(fs.readdirSync(wdir())).toEqual([ID]);
  });

  it.each(['dev', 'ino', 'btime'] as const)('a witness whose %s alone no longer matches the leaf is stale, and rewritten', (key) => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const good = fs.readFileSync(witness(), 'utf8');
    const wrong = key === 'btime' ? '1' : '999999';
    fs.writeFileSync(witness(), good.replace(new RegExp(` ${key}=[^ ]+ `), ` ${key}=${wrong} `));
    expect(field(key), 'the CONTROL: the plant took').toBe(wrong);
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(field(key)).toBe(measured(leaf())[key]);
  });

  it('a malformed witness is stale too — rewritten whole', () => {
    seed(ID, '7');
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(), 'not a witness\n');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(fs.readFileSync(witness(), 'utf8')).toMatch(LINE);
  });

  it.each([['0'], ['-1']])('btime is "-" where the filesystem keeps none (stat answered %s)', (bt) => {
    seed(ID, '7');
    h.sh(`_plat_btime() { printf '%s' '${bt}'; }; _child_tmpdir ${ID} >/dev/null`);
    expect(field('btime')).toBe('-');
  });

  it('a recycled slug: the new child’s first rc 0 overwrites the old child’s witness', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    h.sh(`_reg_purge ${ID}`);                    // the old row goes; the witness outlives it (an orphaned temp root's case)
    fs.renameSync(leaf(), `${leaf()}.old`);      // and its leaf (kept allocated: a distinct inode below)
    seed(ID, '8');                               // ws-add hands the slug out again, to run 8
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(field('run')).toBe('8');
    expect(field('ino')).toBe(measured(leaf()).ino);
  });

  it('a recycled slug that inherits a KEPT leaf — the SAME inode — is re-witnessed for its new run (run joins the staleness test)', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const leafIno = field('ino');
    const oldWitnessIno = fs.statSync(witness()).ino;
    h.sh(`_reg_purge ${ID}`);                    // the old row goes; its leaf and witness are KEPT (a human verb, or the tail's in-use arm)
    seed(ID, '8');                               // ws-add hands the slug out again, to run 8
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(measured(leaf()).ino, 'the CONTROL: the new child inherited the SAME leaf').toBe(leafIno);
    expect(field('run'), 'a same-inode witness still names the old run').toBe('8');
    expect({ dev: field('dev'), ino: field('ino'), btime: field('btime'), uid: field('uid') }).toEqual(measured(leaf()));
    expect(fs.statSync(witness()).ino, 'the witness was written in place, not temp file then mv').not.toBe(oldWitnessIno);
    expect(fs.readdirSync(wdir())).toEqual([ID]);
  });

  it.each([[null], ['abc'], ['07']])('rc 1 (marker %j) writes nothing — not even tmproots/', (child) => {
    seed(ID, child);
    expect(run(`_child_tmpdir ${ID}; echo "[rc=$?]"`).out).toBe('[rc=1]');
    expect(fs.existsSync(wdir())).toBe(false);
  });

  it('rc 2 (a symlinked leaf) writes nothing', () => {
    seed(ID, '7');
    const target = path.join(h.home, 'elsewhere');
    fs.mkdirSync(target);
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.symlinkSync(target, leaf());
    expect(run(`_child_tmpdir ${ID}; echo "[rc=$?]"`).out).toContain('[rc=2]');
    expect(fs.existsSync(witness())).toBe(false);
  });

  it('rc 2 leaves an EARLIER witness exactly as it was — never rewritten, never removed', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const bytes = fs.readFileSync(witness(), 'utf8');
    const ino = fs.statSync(witness()).ino;
    fs.rmSync(leaf(), { recursive: true, force: true });
    fs.writeFileSync(leaf(), 'a file where the leaf was');
    expect(run(`_child_tmpdir ${ID}; echo "[rc=$?]"`).out).toContain('[rc=2]');
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
    expect(fs.statSync(witness()).ino).toBe(ino);
  });
});

describe('a witness that cannot be written never fails the spawn — it warns', () => {
  it('tmproots/ unmakeable (a FILE stands there): rc 0, the path, and a warning', () => {
    seed(ID, '7');
    fs.writeFileSync(wdir(), 'in the way');
    const r = run(`_child_tmpdir ${ID}; echo "[rc=$?]"`);
    expect(r.out).toContain(`${leaf()}[rc=0]`);
    expect(r.out).toContain(`ccd: warn: ${ID}'s temp root`);
  });

  it('a DIRECTORY at the witness path is refused — nothing is moved inside it, no temp file is left', () => {
    seed(ID, '7');
    fs.mkdirSync(witness(), { recursive: true });
    const r = run(`_child_tmpdir ${ID}; echo "[rc=$?]"`);
    expect(r.out).toContain(`${leaf()}[rc=0]`);
    expect(r.out).toContain(`ccd: warn: ${ID}'s temp root`);
    expect(fs.readdirSync(witness()), 'mv moved the temp file INSIDE the directory').toEqual([]);
    expect(fs.readdirSync(wdir())).toEqual([ID]);
  });

  it('a stat that FAILS writes nothing and warns — unmeasured is never "-"', () => {
    seed(ID, '7');
    const r = run(`_plat_btime() { return 1; }; _child_tmpdir ${ID}; echo "[rc=$?]"`);
    expect(r.out).toContain(`${leaf()}[rc=0]`);
    expect(r.out).toContain(`ccd: warn: ${ID}'s temp root`);
    expect(fs.existsSync(witness())).toBe(false);
  });
});

describe('_ws_tmproot_witness_write refuses what is not a child’s own leaf', () => {
  const plants: Array<[string, (p: string) => void]> = [
    ['a symlink', (p) => { fs.mkdirSync(path.join(h.home, 'target')); fs.symlinkSync(path.join(h.home, 'target'), p); }],
    ['a regular file', (p) => { fs.writeFileSync(p, 'x'); }],
  ];
  it.each(plants)('a leaf that is %s', (_label, plant) => {
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    plant(leaf());
    expect(run(`_ws_tmproot_witness_write ${ID} '${leaf()}' 7; echo "[rc=$?]"`).out).toBe('[rc=1]');
    expect(fs.existsSync(witness())).toBe(false);
  });

  it.each([['abc'], ['07'], ['']])('a run outside the run-id grammar (%j)', (runId) => {
    fs.mkdirSync(leaf(), { recursive: true });
    expect(run(`_ws_tmproot_witness_write ${ID} '${leaf()}' '${runId}'; echo "[rc=$?]"`).out).toBe('[rc=1]');
    expect(fs.existsSync(wdir())).toBe(false);
  });

  it.each([['.hidden-id'], ['..'], ['a/b']])('an id that could name another file (%j)', (id) => {
    fs.mkdirSync(leaf(), { recursive: true });
    expect(run(`_ws_tmproot_witness_write '${id}' '${leaf()}' 7; echo "[rc=$?]"`).out).toBe('[rc=1]');
    expect(fs.existsSync(wdir())).toBe(false);
  });
});

describe('_ws_tmproot_witness_read: parsed, absent, or unreadable — three answers', () => {
  const GOOD = `v=1 id=${ID} run=7 dev=2064 ino=35 btime=- uid=1000 at=1791277099334\n`;
  const SEED = 'demo-good-seed';
  const plant = (text: string, id: string = ID): void => {
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(id), text);
  };
  /** Reads a GOOD witness first, so a failing read must also CLEAR every field. */
  const read = (id: string = ID): string => {
    plant(GOOD.replace(`id=${ID}`, `id=${SEED}`), SEED);
    return run(`_ws_tmproot_witness_read ${SEED} >/dev/null; _ws_tmproot_witness_read '${id}'; `
      + `printf '[rc=%s] %s|%s|%s|%s|%s|%s' "$?" "$_WS_WIT_RUN" "$_WS_WIT_DEV" "$_WS_WIT_INO" "$_WS_WIT_BTIME" "$_WS_WIT_UID" "$_WS_WIT_AT"`).out;
  };

  it('rc 0 sets every field', () => {
    plant(GOOD);
    expect(read()).toBe('[rc=0] 7|2064|35|-|1000|1791277099334');
  });

  it('rc 1 when nothing stands there — and every field is cleared', () => {
    expect(read()).toBe('[rc=1] |||||');
  });

  it.each([
    ['no trailing newline', GOOD.slice(0, -1)],
    ['a second line', `${GOOD}${GOOD}`],
    ['another id', GOOD.replace(`id=${ID}`, 'id=demo-quiet-reef')],
    ['a run outside the grammar', GOOD.replace('run=7', 'run=07')],
    ['a locale-widened digit', GOOD.replace('run=7', 'run=1²')],
    ['an unknown version', GOOD.replace('v=1', 'v=2')],
    ['keys out of order', GOOD.replace('dev=2064 ino=35', 'ino=35 dev=2064')],
    ['btime 0 (the writer spells that -)', GOOD.replace('btime=-', 'btime=0')],
    ['an oversize body', `${GOOD.slice(0, -1)}${' '.repeat(600)}\n`],
  ])('rc 2 for %s', (_label, text) => {
    plant(text);
    expect(read()).toBe('[rc=2] |||||');
  });

  it('rc 2 for a directory, and for a symlink to a GOOD witness — a link is never followed', () => {
    fs.mkdirSync(witness(), { recursive: true });
    expect(read()).toBe('[rc=2] |||||');
    fs.rmdirSync(witness());
    plant(GOOD, 'demo-quiet-reef');
    fs.symlinkSync(witness('demo-quiet-reef'), witness());
    expect(read()).toBe('[rc=2] |||||');
  });

  it('rc 2 for an id that could name another file', () => {
    expect(read('../x')).toBe('[rc=2] |||||');
    expect(read('.tmp')).toBe('[rc=2] |||||');
  });
});

describe('_ws_tmproot_remove: the witness dies only after the leaf is PROVEN absent', () => {
  /** A recording `_ws_leaf_remove`: its argc and argv, and whether the witness
   *  still stood at the instant it ran. */
  const STUB = (rc: number): string =>
    `_ws_leaf_remove() { { printf '%s|' "$#" "$@"; [[ -e "$REG/tmproots/${ID}" ]] && printf present; echo; } >> "$HOME/leaf-calls";`
    + ` _WS_LEAF_WHY="stub-why"; return ${rc}; };`;
  const calls = (): string[] => fs.readFileSync(path.join(h.home, 'leaf-calls'), 'utf8').split('\n').filter(Boolean);
  const root = (): string => path.join(h.home, '.cc-tmp');

  it('the REAL helper: the leaf and its witness both go, and tmproots/ itself stays', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    fs.writeFileSync(path.join(leaf(), 'scratch'), 'x');
    expect(run(`_ws_tmproot_remove ${ID}; echo "[rc=$?]"`).out).toBe('[rc=0]');
    expect(fs.existsSync(leaf())).toBe(false);
    expect(fs.existsSync(witness())).toBe(false);
    expect(fs.statSync(wdir()).isDirectory()).toBe(true);
  });

  it('a witness with NO leaf is nothing to do, and is cleaned', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    fs.rmSync(leaf(), { recursive: true, force: true });
    expect(run(`_ws_tmproot_remove ${ID}; echo "[rc=$?]"`).out).toBe('[rc=0]');
    expect(fs.existsSync(witness())).toBe(false);
  });

  it('the leaf goes FIRST: the witness still stood when the removal helper ran', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(run(`${STUB(0)} _ws_tmproot_remove ${ID}; echo "[rc=$?]"`).out).toBe('[rc=0]');
    expect(calls()).toEqual([`2|${root()}|${ID}|present`]);
    expect(fs.existsSync(witness())).toBe(false);
  });

  it.each([[1], [2]])('helper rc %i is passed through, _WS_LEAF_WHY with it, and the witness stands byte-identical', (rc) => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const bytes = fs.readFileSync(witness(), 'utf8');
    expect(run(`${STUB(rc)} _ws_tmproot_remove ${ID}; echo "[rc=$?] $_WS_LEAF_WHY"`).out).toBe(`[rc=${rc}] stub-why`);
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('an expected dev:ino is handed through, and its absence is never an empty third argument', () => {
    run(`${STUB(0)} _ws_tmproot_remove ${ID} 5:6; _ws_tmproot_remove ${ID}`);
    expect(calls()).toEqual([`3|${root()}|${ID}|5:6|`, `2|${root()}|${ID}|`]);
  });

  // A collector walking tmproots/ must never turn a writer's in-flight temp
  // file into a leaf to remove: the id is refused before the helper is asked.
  it.each([['.demo-quiet-mesa.4242.17.tmp'], ['.x']])('an id no witness is named for (%j) answers 1 and touches nothing — a planted file of that name stands', (id) => {
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(id), 'a writer’s in-flight temp file');
    expect(run(`${STUB(0)} _ws_tmproot_remove '${id}'; echo "[rc=$?] $_WS_LEAF_WHY"`).out)
      .toBe(`[rc=1] '${id}' is not an id a witness is named for, so nothing was touched`);
    expect(fs.existsSync(path.join(h.home, 'leaf-calls')), 'the removal helper was asked').toBe(false);
    expect(fs.readFileSync(witness(id), 'utf8')).toBe('a writer’s in-flight temp file');
  });
});

describe('the tail removes the witness only with the leaf, and keeps both when it keeps the leaf (spec §5.6, spec §5.2)', () => {
  const NOBODY = '_ws_path_users() { _WS_PATH_USERS_PIDS=""; return 0; };';
  /** A real child whose leaf the REAL writer has witnessed. */
  const witnessed = (): string => {
    makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    expect(fs.existsSync(witness(CHILD_ID)), 'the CONTROL: the real writer witnessed the child’s leaf').toBe(true);
    return fs.readFileSync(witness(CHILD_ID), 'utf8');
  };

  it('a reclaim whose leaf nobody uses removes the leaf, THEN its witness — tmproots/ itself stays', () => {
    witnessed();
    const r = childReclaimVerb(h, evalOf(h).token, { pre: NOBODY });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(leaf(CHILD_ID)), 'temp root').toBe(false);
    expect(fs.existsSync(witness(CHILD_ID)), 'witness').toBe(false);
    expect(fs.statSync(wdir()).isDirectory()).toBe(true);
  }, 90_000);

  // The in-use substrate is Task 6's keep-arm case's own, and so is the wait:
  // Task 6's knob `CCD_RECLAIM_TMPROOT_WAIT_S`, set to 0 (it can only lower the
  // bound), asks the probe once after the kill and never sleeps; step (6) asks
  // again at the instant of removal. No `sleep` is stubbed.
  it.each([
    ['in use', 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=4242; return 1; };'],
    ['unmeasured', 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_WHY="stubbed"; return 2; };'],
  ])('a leaf the tail KEEPS (%s) keeps its witness, byte for byte', (_label, pre) => {
    const before = witnessed();
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed, 'a kept leaf is not a refusal (spec §5.6)').toBe(CHILD_ID);
    expect(fs.existsSync(leaf(CHILD_ID)), 'the kept leaf').toBe(true);
    expect(fs.readFileSync(witness(CHILD_ID), 'utf8')).toBe(before);
  }, 90_000);
});

describe('$REG/tmproots is invisible to every registry walker (spec §5.2, the pools/ precedent)', () => {
  /** Where ccd ITSELF says the witness lives — never this file's own
   *  spelling of it — so each walker below is asked about the file ccd wrote,
   *  wherever that is. A witness moved to a registry-shaped name
   *  (`$REG/<id>.<x>`) is then taken by `_reg_purge` here, rather than
   *  missed by this fixture before any walker is asked. */
  const wpath = (): string => h.sh(`_ws_tmproot_witness_file ${ID}`);
  const witnessedRow = (): string => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    return fs.readFileSync(wpath(), 'utf8');
  };

  it('_reg_purge takes the row and leaves the witness standing — it OUTLIVES the row (an orphaned temp root’s case)', () => {
    const bytes = witnessedRow();
    h.sh(`_reg_purge ${ID}`);
    for (const f of ['uuid', 'child', 'wrapper', 'workdir']) expect(h.reg(ID, f), f).toBeNull();
    expect(fs.readFileSync(wpath(), 'utf8')).toBe(bytes);
  });

  it('survives _reg_purge of a session whose id IS `tmproots` — the collision shape', () => {
    const bytes = witnessedRow();
    const reg = path.join(h.home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, 'tmproots.uuid'), 'u');
    fs.writeFileSync(path.join(reg, 'tmproots.wrapper'), 'claude');
    h.sh('_reg_purge tmproots');
    expect(fs.existsSync(path.join(reg, 'tmproots.uuid')), 'the CONTROL: that row was purged').toBe(false);
    expect(fs.readFileSync(wpath(), 'utf8')).toBe(bytes);
  });

  it('_ws_slug_free reads a slug whose only trace is its witness as FREE, and _ws_slug_residue names nothing', () => {
    witnessedRow();
    h.sh(`_reg_purge ${ID}`);
    expect(h.sh('_ws_slug_free demo quiet-mesa && echo free || echo taken')).toBe('free');
    expect(h.sh('_ws_slug_residue demo quiet-mesa')).toBe('');
  });

  it('`ccd ls` lists no row for it', () => {
    witnessedRow();
    h.sh(`_reg_purge ${ID}`);
    const out = h.sh('cmd_ls');
    expect(out).toContain('(no sessions)');
    expect(out).not.toContain('tmproots');
  });

  const CCD_DIR = path.dirname(CCD);
  /** Every shell file ccd/ ships, found by SHEBANG — never a hand-kept list. */
  const shipped = (): string[] => fs.readdirSync(CCD_DIR, { withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => path.join(CCD_DIR, e.name))
    .filter((p) => /^#!.*[/ ](ba)?sh(\s|$)/.test(fs.readFileSync(p, 'utf8').split('\n', 1)[0] ?? ''));
  /** A glob rooted at the registry, and the character right after its `*`. */
  const REG_GLOB = /(?:\$\{?(?:REG|_SVC_REG|reg)\}?|\$HOME"?\/\.cc-sessions)"?\/\*(.?)/g;
  const REG_FIND = /\bfind\b[^#\n]*\$\{?(?:REG|_SVC_REG|reg)\b/;
  const census = (files: readonly string[]): { globs: string[]; finds: string[]; bad: string[] } => {
    const globs: string[] = []; const finds: string[] = []; const bad: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        const at = `${path.basename(f)}:${i + 1}: ${line.trim()}`;
        for (const m of line.matchAll(REG_GLOB)) {
          globs.push(at);
          if (m[1] !== '.' && m[1] !== '-') bad.push(`a glob that is not suffix-shaped — ${at}`);
        }
        if (REG_FIND.test(line)) {
          finds.push(at);
          if (!/-maxdepth 1\b/.test(line) || !/-name\b/.test(line)) bad.push(`a find that is not depth-1 and name-filtered — ${at}`);
        }
      });
    }
    return { globs, finds, bad };
  };

  it('every registry glob in shipped shell is suffix-shaped, and every registry find is depth-1 and name-filtered', () => {
    // WHY THIS IS THE PROOF: a dotless directory matches no `*.<x>` or
    // `*-<x>` glob and no depth-1 `-name` filter, and its files are one level
    // further down. A bare `"$REG"/*` would see `tmproots` and hand it to a
    // walker that thinks every entry is a field file.
    const files = shipped();
    expect(files, 'the walk must reach ccd itself').toContain(CCD);
    const c = census(files);
    expect(c.globs.length, 'the scan found almost no registry glob — the regex went blind').toBeGreaterThanOrEqual(15);
    expect(c.finds.length, 'the scan found no registry find — the regex went blind').toBeGreaterThanOrEqual(3);
    expect(c.bad).toEqual([]);
  });

  it('CONTROL: it flags a bare glob and an unfiltered find, and passes the suffix shapes and a comment', () => {
    const dir = path.join(h.home, 'census-control');
    fs.mkdirSync(dir);
    const f = path.join(dir, 'planted');
    fs.writeFileSync(f, '#!/usr/bin/env bash\nfor f in "$REG"/*; do :; done\nfor f in "$REG"/*.uuid; do :; done\n'
      + 'names=$(find "$REG" -maxdepth 1)\n# for f in "$REG"/*; do :; done\n');
    const bad = census([f]).bad;
    expect(bad).toHaveLength(2);
    expect(bad[0]).toContain('planted:2:');
    expect(bad[1]).toContain('planted:4:');
  });
});

describe('_plat_btime — one format letter, two userlands', () => {
  it('GNU %W on Linux, BSD %B on Darwin', () => {
    const arm = (os: string): string => h.sh(`CCD_OS=${os}; stat() { printf '%s' "$*"; }; _plat_btime /x`);
    expect(arm('linux')).toBe('-c %W /x');
    expect(arm('darwin')).toBe('-f %B /x');
  });
});
