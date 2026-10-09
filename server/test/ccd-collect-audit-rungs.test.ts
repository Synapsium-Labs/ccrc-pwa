// `ws-audit --collect`'s FRESH rungs, one by one and in order (the temp-root collector, spec §5.10): registered,
// witness-mismatch, changed-recently, in-use, containment-unproven, paused. The first that does not pass ends the
// evaluation, and a probe that cannot answer ends it as unmeasured, naming itself. A witness whose leaf is proven
// gone is its own answer. FIXTURE HOME ONLY (`collectFixture.ts`). Linux only: the collector measures nothing
// elsewhere, and the in-use cases run real processes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { readJournal, refusalsOf } from './lifecycleHelpers.js';
import { holdCwd } from './wsExpireFixture.js';
import {
  AGED, COL_ID, NO_WALK, PAUSE, type Answer, collectAudit, collectOf, holdTmpdir, leafOf, makeOrphan, regDir,
  replaceLeaf, secondsAgoNs, verdictOf, walkAt, walked, witnessOf,
} from './collectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-rungs-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;

/** A worktree moved into the leaf: its `.git` file names an admin directory that is gone. */
const plantForeignCheckout = (leaf: string): void => {
  fs.mkdirSync(path.join(leaf, 'wt'));
  fs.writeFileSync(path.join(leaf, 'wt', '.git'), `gitdir: ${path.join(h.home, 'gone', '.git', 'worktrees', 'wt')}\n`);
};

describe.skipIf(!LINUX)('registered: a row of the id, by direct lookup, and by a listing the audit can trust', () => {
  it.each(['child', 'uuid', 'hold', 'reaping'])('a standing `%s` field: registered, exit 0, no token, nothing journaled', (field) => {
    makeOrphan(h);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.${field}`), 'x');
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('registered');
    expect(String(a.doc!['detail'])).toContain(`${COL_ID}.${field}`);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it.skipIf(ROOT)('a registry that can be searched but not listed: a `.child` is still seen; any other row makes the slug UNMEASURED, never free', () => {
    makeOrphan(h);
    const reg = regDir(h);
    fs.writeFileSync(path.join(reg, `${COL_ID}.hold`), 'x');
    expect(verdictOf(collectAudit(h, { pre: AGED })), 'the CONTROL: listable, the row is seen').toBe('registered');
    fs.chmodSync(reg, 0o300);
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      fs.writeFileSync(path.join(reg, `${COL_ID}.child`), '8');
      expect(verdictOf(collectAudit(h, { pre: AGED })), 'a direct lookup needs no listing').toBe('registered');
    } finally { fs.chmodSync(reg, 0o755); }
  }, 90_000);

  it('a direct lookup whose absence cannot be measured is UNMEASURED `registry`, never free', () => {
    // `[[ -e ]]` reads EACCES as absence; the direct lookups ask `_ws_reclaim_absent`, whose unmeasured answer is
    // stubbed here for the `.child` name alone (a `$REG` that cannot be searched answers unmeasured before the lock,
    // at the population, so this rung is reached only through the seam).
    makeOrphan(h);
    const seam = 'eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
      + ' _ws_reclaim_absent() { if [[ "$1" == *.child ]]; then _WS_ABSENT_WHY="stub: $1 could not be looked at"; return 2; fi;'
      + ' _orig_absent "$@"; };';
    const a = collectAudit(h, { pre: `${AGED} ${seam}` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('registry');
    expect(String(a.doc!['detail'])).toContain(`${COL_ID}.child could not be looked at`);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('registered outranks every later rung', () => {
    makeOrphan(h);
    fs.writeFileSync(path.join(regDir(h), `${COL_ID}.child`), '9');
    replaceLeaf(h);
    expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('registered');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('witness-mismatch: TERMINAL, journaled, offered to the operator, never taken', () => {
  const expectMismatch = (a: Answer, detail: string): void => {
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('witness-mismatch');
    expect(String(a.doc!['detail'])).toContain(detail);
    expect(a.doc!['token']).toBeUndefined();
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'witness-mismatch' }]);
  };

  it('a witness ccd cannot read as it writes it', () => {
    makeOrphan(h);
    fs.writeFileSync(witnessOf(h), 'v=2 junk\n');
    expectMismatch(collectAudit(h, { pre: AGED }), 'cannot be read as ccd writes it');
  }, 60_000);

  it('a witness with no birth time is never taken on device and inode alone', () => {
    makeOrphan(h);
    fs.writeFileSync(witnessOf(h), fs.readFileSync(witnessOf(h), 'utf8').replace(/ btime=\d+ /, ' btime=- '));
    // The file system is made to keep no birth time either, so dev and ino WOULD match: only the rule refuses it.
    expectMismatch(collectAudit(h, { pre: `${AGED} _plat_btime() { echo 0; };` }), 'records no birth time');
  }, 60_000);

  it('a directory of another inode at the id', () => {
    makeOrphan(h);
    replaceLeaf(h);
    expectMismatch(collectAudit(h, { pre: AGED }), 'its witness names');
  }, 60_000);

  it('a link at the id, to the very directory its witness names: never followed, and nothing behind it is touched', () => {
    const { leaf } = makeOrphan(h);
    const moved = path.join(h.home, 'moved');
    fs.renameSync(leaf, moved);
    fs.symlinkSync(moved, leaf);
    expectMismatch(collectAudit(h, { pre: AGED }), 'is a link or not a directory');
    expect(fs.existsSync(path.join(moved, 'cdk.out', 'manifest.json'))).toBe(true);
  }, 60_000);

  it('a file at the id', () => {
    const { leaf } = makeOrphan(h);
    fs.rmSync(leaf, { recursive: true });
    fs.writeFileSync(leaf, 'a file where the leaf was');
    expectMismatch(collectAudit(h, { pre: AGED }), 'is a link or not a directory');
  }, 60_000);
});

describe.skipIf(!LINUX)('a leaf that vanishes while its identity is read: a retry, never witness-mismatch (spec §5.10)', () => {
  /** The identity check's rc 1 is also "nothing stands": this seam removes the leaf and answers 1, as a race would. */
  const VANISH = '_ws_collect_ident() { rm -rf -- "$1"; return 1; };';

  it('PROVEN gone after the directory test: unmeasured `leaf`, exit 1, no token, journaled nowhere', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${VANISH}` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('leaf');
    expect(String(a.doc!['detail'])).toContain('vanished while its identity was read');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('an absence that cannot be measured after the identity answered 1: unmeasured `leaf`, never witness-mismatch', () => {
    const { leaf } = makeOrphan(h);
    const seam = '_ws_collect_ident() { : > "$HOME/ident-asked"; return 1; };'
      + ' eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
      + ` _ws_reclaim_absent() { if [[ "$1" == '${leaf}' && -e "$HOME/ident-asked" ]]; then`
      + ' _WS_ABSENT_WHY="stub: $1 could not be looked at"; return 2; fi; _orig_absent "$@"; };';
    const a = collectAudit(h, { pre: `${AGED} ${seam}` });
    expect(a.code, a.stderr).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('leaf');
    expect(String(a.doc!['detail'])).toContain('stub:');
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);
});

describe.skipIf(!LINUX)('a witness whose leaf is PROVEN gone: collectable at once, so the verb can drop the witness', () => {
  it('exists false, no walk, a token of its own, and the witness still standing', () => {
    const { leaf } = makeOrphan(h);
    const present = collectAudit(h, { pre: AGED }).doc!['token'];
    fs.rmSync(leaf, { recursive: true });
    const a = collectAudit(h, { pre: NO_WALK });
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc).toMatchObject({ exists: false, verdict: 'collectable' });
    expect(walked(h), 'nothing to walk').toBe(false);
    expect(collectOf(a)).toMatchObject({ newestCtimeNs: null, entries: null, idleAt: null });
    expect(a.doc!['token']).toMatch(/^[0-9a-f]{64}$/);
    expect(a.doc!['token']).not.toBe(present);
    expect(fs.existsSync(witnessOf(h)), 'an audit drops nothing').toBe(true);
  }, 60_000);

  it.skipIf(ROOT)('a leaf whose absence cannot be proven is unmeasured `leaf`, never gone', () => {
    const { leaf } = makeOrphan(h);
    const root = path.dirname(leaf);
    fs.chmodSync(root, 0o000);
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(1);
      expect(collectOf(a)['unmeasured']).toBe('leaf');
    } finally { fs.chmodSync(root, 0o700); }
  }, 60_000);
});

describe.skipIf(!LINUX)('changed-recently: the newest CTIME under the leaf, against max(24 h, the knob)', () => {
  it('a fresh leaf, through the REAL walk: changed-recently, with the instant it turns collectable', () => {
    makeOrphan(h);
    const before = Math.floor(Date.now() / 1000);
    const a = collectAudit(h);
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('changed-recently');
    const c = collectOf(a);
    expect(c['entries'], 'the leaf itself, cdk.out and its manifest').toBe(3);
    expect(Number(c['idleAt'])).toBeGreaterThanOrEqual(before + 86_400 - 5);
    expect(Number(c['idleAt'])).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 86_400 + 1);
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('the boundary: five seconds short of the floor is changed-recently, five seconds past it is collectable', () => {
    makeOrphan(h);
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(86_400 - 5)) }))).toBe('changed-recently');
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(86_400 + 5)) }))).toBe('collectable');
  }, 60_000);

  it('the knob RAISES the floor', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S=200000; ${AGED}` });
    expect(verdictOf(a)).toBe('changed-recently');
    expect(collectOf(a)['floorS']).toBe(200_000);
  }, 60_000);

  it.each(['60', '0', ''])('the knob %j never LOWERS it', (k) => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S='${k}'; ${walkAt(secondsAgoNs(3600))}` });
    expect(verdictOf(a)).toBe('changed-recently');
    expect(collectOf(a)['floorS']).toBe(86_400);
  }, 60_000);

  it.each(['-5', 'abc', '1e9'])('a knob %j that is no whole number is unmeasured `floor`, never folded to 24 h', (k) => {
    // Task 4's `_ws_collect_floor_s` prints NOTHING for a set, non-empty knob that is not a whole number: a raise asked
    // for unreadably is never read as no raise. The document then names no floor, and no instant it turns idle.
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S='${k}'; ${walkAt(secondsAgoNs(3600))}` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)).toMatchObject({ unmeasured: 'floor', floorS: null, idleAt: null });
    expect(String(a.doc!['detail'])).toContain('WS_COLLECT_IDLE_FLOOR_S');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
  }, 60_000);

  it('a newest change in the FUTURE (a clock stepped back) is changed-recently, never idle', () => {
    makeOrphan(h);
    expect(verdictOf(collectAudit(h, { pre: walkAt(secondsAgoNs(-3600)) }))).toBe('changed-recently');
  }, 60_000);

  it('a clock that cannot be read is unmeasured `clock`, never idle (Task 4’s `_ws_collect_floor_held` answers 2)', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_collect_now_ns() { echo soon; };` });
    expect(a.code, a.stderr).toBe(1);
    expect(verdictOf(a)).toBe('unmeasured');
    expect(collectOf(a)['unmeasured']).toBe('clock');
    expect(a.doc!['token']).toBeUndefined();
  }, 60_000);

  it('mtime is never read: a leaf whose every mtime is years old is still changed-recently (the REAL walk)', () => {
    const { leaf } = makeOrphan(h);
    const old = new Date('2020-01-01T00:00:00Z');
    for (const p of [path.join(leaf, 'cdk.out', 'manifest.json'), path.join(leaf, 'cdk.out'), leaf]) fs.utimesSync(p, old, old);
    expect(verdictOf(collectAudit(h))).toBe('changed-recently');
  }, 60_000);
});

describe.skipIf(!LINUX)('in-use: a process of this uid in the leaf, by cwd or by TMPDIR', () => {
  it('a process whose cwd is in the leaf', () => {
    const { leaf } = makeOrphan(h);
    const p = holdCwd(path.join(leaf, 'cdk.out'));
    try {
      const a = collectAudit(h, { pre: AGED });
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('in-use');
      expect(String(a.doc!['detail'])).toContain(String(p.pid));
      expect(a.doc!['token']).toBeUndefined();
    } finally { p.stop(); }
  }, 60_000);

  it('a process whose TMPDIR is the leaf, with its cwd elsewhere: the shape that re-created a leaf', () => {
    const { leaf } = makeOrphan(h);
    const p = holdTmpdir(leaf);
    try {
      expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('in-use');
    } finally { p.stop(); }
  }, 60_000);

  it('a probe that cannot answer is unmeasured `in-use`, never "nobody"', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_path_users() { _WS_PATH_USERS_WHY='stub: the table would not list'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('in-use');
  }, 60_000);
});

describe.skipIf(!LINUX)('containment-unproven: TERMINAL — a checkout git records elsewhere, or a row at, inside or through the leaf', () => {
  it('a worktree moved into the leaf, whose admin directory is gone: journaled, and nothing touched', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const a = collectAudit(h, { pre: AGED });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('containment-unproven');
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'containment-unproven' }]);
    expect(fs.existsSync(path.join(leaf, 'wt', '.git'))).toBe(true);
  }, 60_000);

  it('a stopped session’s row inside the leaf (the measured loss): containment-unproven', () => {
    const { leaf } = makeOrphan(h);
    fs.mkdirSync(path.join(leaf, 'clone'));
    fs.writeFileSync(path.join(regDir(h), 'demo-other.workdir'), path.join(leaf, 'clone'));
    fs.writeFileSync(path.join(regDir(h), 'demo-other.uuid'), 'deadbeef-0000-4000-8000-000000000000');
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('containment-unproven');
  }, 60_000);

  it('the row rule is asked of the id and of the leaf’s own path', () => {
    const { leaf } = makeOrphan(h);
    const rows = `_ws_collect_rows_clear() { printf '%s|%s' "$1" "$2" > "$HOME/rows-asked"; _WS_COLLECT_ROWS_WHY='stub: a row'; return 1; };`;
    expect(verdictOf(collectAudit(h, { pre: `${AGED} ${rows}` }))).toBe('containment-unproven');
    expect(fs.readFileSync(path.join(h.home, 'rows-asked'), 'utf8')).toBe(`${COL_ID}|${leaf}`);
  }, 60_000);

  it('a checkout scan that cannot answer: unmeasured `checkouts`', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_leaf_checkouts() { _WS_CHECKOUTS_WHY='stub: the walk timed out'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('checkouts');
  }, 60_000);

  it('a row rule that cannot answer: unmeasured `rows`', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} _ws_collect_rows_clear() { _WS_COLLECT_ROWS_WHY='stub: unplaceable'; return 2; };` });
    expect(a.code).toBe(1);
    expect(collectOf(a)['unmeasured']).toBe('rows');
  }, 60_000);
});

describe.skipIf(!LINUX)('paused: read inside the lock, the last rung', () => {
  it('the kill-switch: paused, exit 0, no token, nothing journaled; lowered, collectable', () => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `${AGED} ${PAUSE}` });
    expect(a.code, a.stderr).toBe(0);
    expect(verdictOf(a)).toBe('paused');
    expect(a.doc!['token']).toBeUndefined();
    expect(readJournal(h.home)).toEqual([]);
    fs.rmSync(path.join(regDir(h), 'reclaim-paused'));
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('collectable');
  }, 60_000);

  it('a dangling link at the switch pauses too', () => {
    makeOrphan(h);
    fs.symlinkSync(path.join(h.home, 'nowhere'), path.join(regDir(h), 'reclaim-paused'));
    expect(verdictOf(collectAudit(h, { pre: AGED }))).toBe('paused');
  }, 60_000);
});

describe.skipIf(!LINUX)('the order: the first rung that does not pass ends the evaluation', () => {
  it('witness-mismatch outranks changed-recently, in-use, containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    replaceLeaf(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('witness-mismatch'); } finally { p.stop(); }
  }, 60_000);

  it('changed-recently (the REAL walk) outranks in-use, containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: PAUSE }))).toBe('changed-recently'); } finally { p.stop(); }
  }, 60_000);

  it('in-use outranks containment and the pause', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    const p = holdCwd(leaf);
    try { expect(verdictOf(collectAudit(h, { pre: `${AGED} ${PAUSE}` }))).toBe('in-use'); } finally { p.stop(); }
  }, 60_000);

  it('containment outranks the pause: a paused fleet still learns its terminal refusals', () => {
    const { leaf } = makeOrphan(h);
    plantForeignCheckout(leaf);
    expect(verdictOf(collectAudit(h, { pre: `${AGED} ${PAUSE}` }))).toBe('containment-unproven');
    expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'containment-unproven' }]);
  }, 60_000);
});

// The leaf the document names is `_child_tmpdir`'s spelling, untouched by any of the rungs above.
it.skipIf(!LINUX)('every rung leaves the leaf as it found it', () => {
  const { leaf } = makeOrphan(h);
  const before = (fs.readdirSync(leaf, { recursive: true }) as string[]).map(String).sort();
  for (const pre of [AGED, '', `${AGED} ${PAUSE}`]) collectAudit(h, { pre });
  expect((fs.readdirSync(leafOf(h), { recursive: true }) as string[]).map(String).sort()).toEqual(before);
}, 90_000);
