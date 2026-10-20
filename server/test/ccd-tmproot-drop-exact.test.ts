// path-identity W2 (TR3 A, TR4 A): the reclaim tail's witness drop is generation-exact (path-identity spec §3.2 and
// §3.3, Figure 3). Before this wave `_ws_tmproot_witness_drop` was a plain unlink of the live name: a tail that ran
// while `~/.cc-tmp` was unmounted read the leaf as gone and dropped its witness, and beside a quarantine slot of the id
// it orphaned that slot's witness. Now it reads and parses the witness, asks the device the witness records, lists the
// quarantine slots of the id, proves the leaf absent again, and unlinks only the generation it read: through the
// collector's compare-and-drop where `mv --no-copy` exists, and by a second read and a six-field compare elsewhere. It
// answers complete (0), kept (1) or unmeasured (2), with its reason in `_WS_WDROP_WHY`, and prints nothing.
// `_ws_tmproot_remove` reports a drop that is not complete as its own 2, never 1.
// FIXTURE HOME ONLY (`makePrHarness`): every witness, leaf and slot lives under the harness's HOME, and ccd runs as
// sourced functions, never against the live HOME. Nothing is mounted: the device question is driven by a rewritten
// `dev=` field and by `~/.cc-tmp` removed whole. The compare-and-drop rows need Linux with `mv --no-copy`; every other
// row runs on both platforms, Darwin simulated on a Linux host.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { LINUX, NO_COPY } from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-tmproot-drop-exact-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const wdir = (): string => path.join(h.home, '.cc-sessions', 'tmproots');
const witness = (id: string = ID): string => path.join(wdir(), id);
const root = (): string => path.join(h.home, '.cc-tmp');
const leaf = (id: string = ID): string => path.join(root(), id);
const quarantine = (): string => path.join(root(), '.ccd-quarantine');
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const linesOf = (name: string): string[] => {
  const p = path.join(h.home, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
/** What stands at `p`, for an untouched check: a directory's sorted names, or a file's bytes. */
const standing = (p: string): string =>
  (fs.lstatSync(p).isDirectory() ? `dir:${fs.readdirSync(p).sort().join(',')}` : fs.readFileSync(p, 'utf8'));

/** The drop, and its answer on one line: `[rc=<n>] <_WS_WDROP>|<_WS_WDROP_WHY>`. */
const DROP = (id: string): string => `_ws_tmproot_witness_drop ${id}; echo "[rc=$?] $_WS_WDROP|$_WS_WDROP_WHY"`;
/** `pre`, then `DROP(id)`. Everything written to stderr after ccd is sourced goes to `$HOME/drop-stderr`, so a row can
 *  assert that the drop printed nothing. */
const drop = (id: string = ID, pre = ''): { out: string; err: string } => {
  const r = h.run(`exec 2>"$HOME/drop-stderr"; ${pre} ${DROP(id)}`);
  const ef = path.join(h.home, 'drop-stderr');
  const err = fs.existsSync(ef) ? fs.readFileSync(ef, 'utf8') : '';
  expect(r.code, `the CONTROL: the snippet ran to its answer: ${r.stdout} ${err}`).toBe(0);
  return { out: r.stdout, err };
};

/** A leaf and the witness the REAL writer writes for it, for run 7. Returns the witness's bytes. */
const plant = (id: string = ID): string => {
  fs.mkdirSync(leaf(id), { recursive: true });
  fs.writeFileSync(path.join(leaf(id), 'scratch'), 'the leaf’s own');
  h.sh(`_ws_tmproot_witness_write ${id} '${leaf(id)}' 7`);
  expect(fs.existsSync(witness(id)), 'the CONTROL: the real writer wrote the witness').toBe(true);
  return fs.readFileSync(witness(id), 'utf8');
};
/** `plant`, then the leaf removed: the drop's ordinary input, a witness whose leaf is gone. */
const orphaned = (id: string = ID): string => {
  const bytes = plant(id);
  fs.rmSync(leaf(id), { recursive: true, force: true });
  return bytes;
};

/** `mv` and `rm`, each logged to `$HOME/mv-calls` or `$HOME/rm-calls` and then run (`ccd-ws-collect-order.test.ts`'s
 *  spy shape). */
const MV_SPY = 'mv() { printf \'%s\\n\' "$*" >> "$HOME/mv-calls"; command mv "$@"; };';
const RM_SPY = 'rm() { printf \'%s\\n\' "$*" >> "$HOME/rm-calls"; command rm "$@"; };';
/** Simulated Darwin. On a Linux host `_plat_devino`'s Darwin arm runs BSD `stat -f`, which GNU `stat` refuses, so the
 *  Linux arm stands in for it; on a Darwin host nothing is added. */
const DARWIN = `CCD_OS=darwin; ${process.platform === 'darwin' ? '' : "_plat_devino() { stat -c '%d:%i' \"$@\"; };"}`;
/** `_ws_reclaim_absent`, wrapped: when the drop asks it of the leaf — its absence proven again, the last ask before it
 *  drops — a recycled spawn's writer first replaces the witness (`sed` into a dot-leading temp file, then `mv -f` over
 *  the live name, as `_ws_tmproot_witness_write` does), and the real function then answers. Every other ask is the
 *  real one. The swap is logged to `$HOME/race-ran`. */
const RACE_AT_REPROVE = (sed: string): string =>
  'eval "_t_absent_real()$(declare -f _ws_reclaim_absent | tail -n +2)";'
  + ' _ws_reclaim_absent() { if [[ "${FUNCNAME[1]}" == _ws_tmproot_witness_drop && "$1" == "$HOME/.cc-tmp/' + ID + '" ]]; then'
  + ' sed -e "' + sed + '" "$REG/tmproots/' + ID + '" > "$REG/tmproots/.' + ID + '.race.tmp"'
  + ' && command mv -f -- "$REG/tmproots/.' + ID + '.race.tmp" "$REG/tmproots/' + ID + '"'
  + ' && echo raced >> "$HOME/race-ran"; fi;'
  + ' _t_absent_real "$@"; };';
/** The real `_ws_collect_mv`, refused when its destination is the witness's own name: the compare-and-drop's move
 *  back fails, and what it moved aside stays at its aside. Each refusal is logged to `$HOME/move-back-refused`. */
const MOVE_BACK_FAILS =
  'eval "_t_mv_real()$(declare -f _ws_collect_mv | tail -n +2)";'
  + ' _ws_collect_mv() { if [[ "$2" == "$REG/tmproots/' + ID + '" ]]; then echo "$1" >> "$HOME/move-back-refused"; return 1; fi;'
  + ' _t_mv_real "$@"; };';
/** Search permission is never asked of root, so a `tmproots/` made unsearchable is no fixture there. */
const ROOT_USER = process.getuid?.() === 0;
/** `_ws_reclaim_absent`, wrapped as `RACE_AT_REPROVE` wraps it: when the drop proves the leaf's absence again,
 *  `tmproots/` is first made unsearchable (mode 0600), so the second read finds no witness off a failed test while the
 *  witness stands. Logged to `$HOME/lock-ran`. Every other ask is the real one. */
const LOCK_AT_REPROVE =
  'eval "_t_absent_real()$(declare -f _ws_reclaim_absent | tail -n +2)";'
  + ' _ws_reclaim_absent() { if [[ "${FUNCNAME[1]}" == _ws_tmproot_witness_drop && "$1" == "$HOME/.cc-tmp/' + ID + '" ]]; then'
  + ' chmod 0600 "$REG/tmproots" && echo locked >> "$HOME/lock-ran"; fi;'
  + ' _t_absent_real "$@"; };';
/** `fn`, with `tmproots/`'s mode as it stood before restored after it whatever it answered, so the harness can remove
 *  the fixture. */
const restoringMode = <T>(fn: () => T): T => {
  const mode = fs.statSync(wdir()).mode & 0o7777;
  try { return fn(); } finally { fs.chmodSync(wdir(), mode); }
};

describe('the drop’s three answers, in its fixed order (path-identity spec §3.2 and §3.3)', () => {
  it('no witness stands: complete, absent, nothing touched', () => {
    const r = drop();
    expect(r.out).toBe('[rc=0] absent|');
    expect(r.err).toBe('');
    expect(fs.existsSync(wdir()), 'tmproots/ was never made').toBe(false);
  });

  it.skipIf(ROOT_USER)('a tmproots/ that cannot be SEARCHED: no witness reads, but its absence is never proven, so unmeasured and the witness byte-identical', () => {
    const bytes = orphaned();
    const r = restoringMode(() => { fs.chmodSync(wdir(), 0o600); return drop(); });
    expect(r.out).toMatch(/^\[rc=2\] \|its witness was kept: no witness was read at its name, and its absence could not be proven \(/);
    expect(r.out).toContain('cannot be searched');
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8'), 'the witness stands, byte-identical').toBe(bytes);
  });

  it('a witness the real writer wrote, its leaf gone: complete, dropped, and tmproots/ stays', () => {
    orphaned();
    const r = drop();
    expect(r.out).toBe('[rc=0] dropped|');
    expect(r.err).toBe('');
    expect(fs.existsSync(witness())).toBe(false);
    expect(fs.statSync(wdir()).isDirectory(), 'tmproots/ itself stays').toBe(true);
    expect(fs.readdirSync(wdir()), 'and nothing is left beside it').toEqual([]);
  });

  it('the leaf STANDS when the drop proves the absence again: kept, the witness byte-identical', () => {
    const bytes = plant();
    const r = drop();
    expect(r.out).toMatch(new RegExp(`^\\[rc=1\\] \\|its witness was kept: a leaf stands at ${esc(leaf())} again`));
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
    expect(fs.readFileSync(path.join(leaf(), 'scratch'), 'utf8'), 'the leaf is never touched').toBe('the leaf’s own');
  });

  it.each([
    ['a body in no grammar ccd writes', (): string => { orphaned(); fs.writeFileSync(witness(), 'v=2 junk\n'); return witness(); }],
    ['a directory at the witness name', (): string => {
      orphaned();
      fs.rmSync(witness());
      fs.mkdirSync(path.join(witness(), 'inside'), { recursive: true });
      return witness();
    }],
    ['a LINKED tmproots/, never followed', (): string => {
      orphaned();
      const elsewhere = path.join(h.home, 'elsewhere');
      fs.renameSync(wdir(), elsewhere);
      fs.symlinkSync(elsewhere, wdir());
      return path.join(elsewhere, ID);
    }],
  ] as const)('the witness does not parse (%s): unmeasured, and what stands is untouched', (_what, make) => {
    const at = make();
    const before = standing(at);
    const r = drop();
    expect(r.out).toMatch(/^\[rc=2\] \|its witness was kept: /);
    expect(r.err).toBe('');
    expect(standing(at), 'untouched').toBe(before);
  });

  it('the witness records another device than the physical ~/.cc-tmp: unmeasured, the witness byte-identical', () => {
    expect(String(fs.statSync(h.home).dev), 'the CONTROL: the fixture is not on device 1').not.toBe('1');
    const bytes = orphaned().replace(/ dev=\d+ /, ' dev=1 ');
    fs.writeFileSync(witness(), bytes);
    const r = drop();
    expect(r.out).toMatch(/^\[rc=2\] \|its witness was kept: /);
    expect(r.out).toContain('is on device');
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('the whole ~/.cc-tmp removed: its device cannot be read, so unmeasured, never no slot so drop', () => {
    const bytes = orphaned();
    fs.rmSync(root(), { recursive: true, force: true });
    const r = drop();
    expect(r.out).toMatch(/^\[rc=2\] \|its witness was kept: /);
    expect(r.out).toContain('so its device was never compared');
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('a quarantine slot of the id stands with no record naming it: kept, the reason naming the slot', () => {
    const bytes = orphaned();
    fs.mkdirSync(path.join(quarantine(), `slot.${ID}.1.1`), { recursive: true });
    const r = drop();
    expect(r.out).toMatch(/^\[rc=1\] \|its witness was kept: the quarantine slot /);
    expect(r.out).toContain(`slot.${ID}.1.1`);
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('CONTROL: a nested id slot is not this id slot, the parse is exact, so the witness is dropped', () => {
    orphaned();
    const nested = path.join(quarantine(), `slot.${ID}.v2-x.1.1`);
    fs.mkdirSync(nested, { recursive: true });
    const r = drop();
    expect(r.out).toBe('[rc=0] dropped|');
    expect(r.err).toBe('');
    expect(fs.existsSync(witness())).toBe(false);
    expect(fs.statSync(nested).isDirectory(), 'the other id’s slot stands').toBe(true);
  });

  it.each([
    ['a link to a directory', (): void => {
      const d = path.join(h.home, 'q-elsewhere');
      fs.mkdirSync(d);
      fs.symlinkSync(d, quarantine());
    }],
    ['a plain file', (): void => { fs.writeFileSync(quarantine(), 'not a directory'); }],
  ] as const)('the quarantine is %s, so its slots cannot be listed: unmeasured, the witness byte-identical', (_what, make) => {
    const bytes = orphaned();
    make();
    const r = drop();
    expect(r.out).toMatch(/^\[rc=2\] \|its witness was kept: /);
    expect(r.out).toContain('whether a quarantine slot of');
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it.each([['.x'], ['.demo-quiet-mesa.4242.17.tmp']])('an id no witness is named for (%s): kept, nothing touched, a planted file of that name stands', (id) => {
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(id), 'a writer’s in-flight temp file');
    const r = drop(id);
    expect(r.out).toMatch(/^\[rc=1\] \|its witness was kept: /);
    expect(r.out).toContain(`'${id}' is not an id a witness is named for`);
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(id), 'utf8')).toBe('a writer’s in-flight temp file');
  });

  it('the caller’s own reads stand: the witness fields and the compare-and-drop answer are shadowed', () => {
    orphaned();
    const r = h.run(`exec 2>"$HOME/drop-stderr"; _WS_WIT_RUN=sentinel; _WS_WIT_DEV=sentinel; _WS_CAD=sentinel; ${DROP(ID)};`
      + ' printf \'after %s %s %s\\n\' "$_WS_WIT_RUN" "$_WS_WIT_DEV" "$_WS_CAD"');
    expect(r.stdout.split('\n')).toEqual(['[rc=0] dropped|', 'after sentinel sentinel sentinel']);
    expect(fs.readFileSync(path.join(h.home, 'drop-stderr'), 'utf8')).toBe('');
  });
});

describe.skipIf(!LINUX || !NO_COPY)('where a NOREPLACE rename exists: the collector’s compare-and-drop, given the fields this drop read', () => {
  it('a recycled spawn rewrites the witness at the re-proof: kept, the newer generation stands, no aside', () => {
    orphaned();
    const r = drop(ID, RACE_AT_REPROVE('s/ run=7 / run=8 /'));
    expect(linesOf('race-ran'), 'the CONTROL: the rewrite landed in the window').toEqual(['raced']);
    expect(r.out).toMatch(/^\[rc=1\] \|its witness was kept: a newer generation stands at /);
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8'), 'the newer generation stands').toMatch(/ run=8 /);
    expect(fs.readdirSync(wdir()), 'no aside is left').toEqual([ID]);
  });

  it('the move back fails as well: kept, nothing printed, the reason says the newer one stands at its aside', () => {
    orphaned();
    const r = drop(ID, `${RACE_AT_REPROVE('s/ run=7 / run=8 /')} ${MOVE_BACK_FAILS}`);
    expect(linesOf('race-ran'), 'the CONTROL: the rewrite landed in the window').toEqual(['raced']);
    expect(linesOf('move-back-refused'), 'the CONTROL: the move back was refused, once').toHaveLength(1);
    expect(r.out).toMatch(/^\[rc=1\] \|its witness was kept: /);
    expect(r.out).toContain('could not be moved back from its compare-and-drop aside');
    expect(r.err, 'the compare-and-drop’s own warning is silenced at the drop’s call').toBe('');
    expect(fs.existsSync(witness()), 'nothing stands at the witness’s name').toBe(false);
    const names = fs.readdirSync(wdir());
    expect(names, 'one aside, and nothing else').toHaveLength(1);
    expect(names[0]).toMatch(new RegExp(`^\\.${esc(ID)}\\.drop\\.\\d+$`));
    expect(fs.readFileSync(path.join(wdir(), names[0]!), 'utf8'), 'holding the newer generation').toMatch(/ run=8 /);
  });

  it('one NOREPLACE rename aside, then the unlink there: the live name is never rm’d', () => {
    orphaned();
    const r = drop(ID, `${MV_SPY} ${RM_SPY}`);
    expect(r.out).toBe('[rc=0] dropped|');
    expect(r.err).toBe('');
    const w = witness();
    const aside = `${esc(wdir())}/\\.${esc(ID)}\\.drop\\.\\d+`;
    expect(linesOf('mv-calls')).toContainEqual(expect.stringMatching(new RegExp(`^-T -n --no-copy -- ${esc(w)} ${aside}$`)));
    expect(linesOf('rm-calls')).toContainEqual(expect.stringMatching(new RegExp(`^-f -- ${aside}$`)));
    expect(linesOf('rm-calls').filter((l) => l.endsWith(` ${w}`)), 'never the live name').toEqual([]);
  });
});

describe('where none exists (Darwin, or an mv without --no-copy): a second read, six fields compared, then the unlink', () => {
  it('simulated Darwin: the second read matches, the live name is unlinked once, no rename', () => {
    orphaned();
    const r = drop(ID, `${DARWIN} ${MV_SPY} ${RM_SPY}`);
    expect(r.out).toBe('[rc=0] dropped|');
    expect(r.err).toBe('');
    expect(fs.existsSync(witness())).toBe(false);
    expect(linesOf('mv-calls'), 'no rename is asked for').toEqual([]);
    expect(linesOf('rm-calls').filter((l) => l === `-f -- ${witness()}`), 'the live name, once').toHaveLength(1);
  });

  it('simulated Darwin, a recycled spawn rewrites the witness before the second read: kept, the newer generation stands', () => {
    orphaned();
    const r = drop(ID, `${DARWIN} ${RACE_AT_REPROVE('s/ run=7 / run=8 /')}`);
    expect(linesOf('race-ran'), 'the CONTROL: the rewrite landed in the window').toEqual(['raced']);
    expect(r.out).toMatch(/^\[rc=1\] \|its witness was kept: a newer generation stands at /);
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8')).toMatch(/ run=8 /);
    expect(fs.readdirSync(wdir())).toEqual([ID]);
  });

  it.skipIf(ROOT_USER)('simulated Darwin, tmproots/ made unsearchable before the second read: its absence is never proven, so unmeasured and the witness byte-identical', () => {
    const bytes = orphaned();
    const r = restoringMode(() => drop(ID, `${DARWIN} ${LOCK_AT_REPROVE}`));
    expect(linesOf('lock-ran'), 'the CONTROL: tmproots/ was made unsearchable in the window').toEqual(['locked']);
    expect(r.out).toMatch(/^\[rc=2\] \|its witness was kept: on a second read no witness was read at its name, and its absence could not be proven \(/);
    expect(r.out).toContain('cannot be searched');
    expect(r.err).toBe('');
    expect(fs.readFileSync(witness(), 'utf8'), 'the witness stands, byte-identical').toBe(bytes);
  });

  /** A uid the fixture's own is not, so the rewritten `uid=` differs and still parses. */
  const OTHER_UID = String((process.getuid?.() ?? 0) + 1);
  // With the case above (`run`), every one of the six compared fields has a row: each rewrites ONE field, to a value
  // the reader still parses, and the second read's compare must keep the witness.
  it.each([
    ['dev', 's/ dev=[0-9]* / dev=1 /', ' dev=1 '],
    ['ino', 's/ ino=[0-9]* / ino=1 /', ' ino=1 '],
    ['btime', 's/ btime=[0-9-]* / btime=1 /', ' btime=1 '],
    ['uid', `s/ uid=[0-9]* / uid=${OTHER_UID} /`, ` uid=${OTHER_UID} `],
    ['at', 's/ at=[0-9]*$/ at=1000000000000/', ' at=1000000000000\n'],
  ] as const)('simulated Darwin, only %s rewritten before the second read: kept, so that field is compared', (_field, sed, now) => {
    const bytes = orphaned();
    expect(bytes, 'the CONTROL: the first read carries another value').not.toContain(now);
    const r = drop(ID, `${DARWIN} ${RACE_AT_REPROVE(sed)}`);
    expect(linesOf('race-ran'), 'the CONTROL: the rewrite landed in the window').toEqual(['raced']);
    expect(fs.readFileSync(witness(), 'utf8'), 'the CONTROL: that one field was rewritten').toContain(now);
    expect(r.out).toMatch(/^\[rc=1\] \|its witness was kept: a newer generation stands at /);
    expect(r.err).toBe('');
  });

  it('an mv without --no-copy (stubbed): the same second-read path, dropped, no rename', () => {
    orphaned();
    const r = drop(ID, `_ws_collect_mv_ok() { return 1; }; ${MV_SPY}`);
    expect(r.out).toBe('[rc=0] dropped|');
    expect(r.err).toBe('');
    expect(fs.existsSync(witness())).toBe(false);
    expect(linesOf('mv-calls'), 'no rename is asked for').toEqual([]);
  });
});

describe('_ws_tmproot_remove: a drop that is not complete is its 2, never its 1 (path-identity spec §3.2)', () => {
  const DROP_STUB = (rc: 1 | 2): string =>
    `_ws_tmproot_witness_drop() { _WS_WDROP=''; _WS_WDROP_WHY='stub: kept'; return ${rc}; };`;
  const remove = (pre = ''): string => h.run(`exec 2>&1; ${pre} _ws_tmproot_remove ${ID}; echo "[rc=$?] $_WS_LEAF_WHY"`).stdout;

  it.each([[1], [2]] as const)('the drop answers %i: the leaf removed, and 2 with the drop’s reason after "no leaf stands, but "', (rc) => {
    plant();
    expect(remove(DROP_STUB(rc))).toBe('[rc=2] no leaf stands, but stub: kept');
    expect(fs.existsSync(leaf()), 'the leaf’s removal stands').toBe(false);
  });

  it('CONTROL: the real drop, complete: 0, the leaf and its witness both gone', () => {
    plant();
    expect(remove()).toMatch(/^\[rc=0\]/);
    expect(fs.existsSync(leaf())).toBe(false);
    expect(fs.existsSync(witness())).toBe(false);
  });
});

describe('the source: the drop prints nothing, and reuses the collector’s compare-and-drop', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  /** `name`'s body, from its head line to its first closing brace at column 0, or '' when it is not defined. */
  const bodyOf = (name: string): string => {
    const a = src.indexOf(`\n${name}() {`);
    const b = a > -1 ? src.indexOf('\n}\n', a) : -1;
    return b > a ? src.slice(a, b) : '';
  };

  it('one call of _ws_collect_witness_cad with its stderr dropped, no move of its own, no echo or printf', () => {
    const code = bodyOf('_ws_tmproot_witness_drop').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code.length, 'the drop could not be sliced').toBeGreaterThan(600);
    expect((code.match(/_ws_collect_witness_cad\b[^\n]*2>\/dev\/null/g) ?? []).length, 'one call, its stderr dropped').toBe(1);
    expect(code, 'it moves nothing itself: the compare-and-drop is the collector’s, never a copy').not.toMatch(/\b(?:_ws_collect_mv|mv)\s/);
    expect(code, 'it prints nothing').not.toMatch(/\b(?:printf|echo)\b/);
  });
});
