// path-identity W3 (path-identity spec §4.3 to §4.5; §4.10, PI1 B, PI2 L1, PI3 B, PI7 P2, PI9 K1): a row's recorded
// entry places it against the child, and only ever adds a placement or a hold.
//
// Each registry row carries one entry field, `$REG/<id>.workdirid`: where its pane entered after its `cd` (that
// directory's device, inode and birth time, its physical path, and the logical spelling it was given). The rows rung
// reads it for every row whose `.workdir` reads, before any arm can skip the row, and asks four things of a VALID
// field: is its recorded identity or physical path the child's (SHARED, terminal, even for a row the strings cannot
// place); does its recorded path lie inside the child or a leaf, as a string (NESTED) or walked now (SHARED or
// NESTED); and, for a row that still resolves completely, did it enter a directory other than the one its spelling
// names now, one that can no longer be placed (a hold). A PENDING field or one that is not a regular file holds, by
// row id; a LEGACY one changes nothing and is counted. No field releases a row: a gone row is released only by its
// git record or its breadcrumb, as before. The rung counts the other rows whose field is in a `legacy-*` state
// (`legacyRows`) and those whose field reads `pending` (`pendingRows`); a field that reads `unmeasured` is in neither,
// and it holds the child. The reclaim audit document prints both, `null` when not counted.
//
// FIXTURE HOMEs ONLY (`makePrHarness`): every repository, row, field and leaf lives under the harness's HOME, and ccd
// runs as sourced functions under `CHILD_STUBS`, never against the live HOME. Rows are hand-planted unless a case
// says a sibling is minted by the real `cmd_ws_add` (which seeds its field); fields are written by `writeField`, with
// identities read by `_ws_path_ident`. Nothing is mounted. No case reaches a reclaim tail (the one verb case refuses
// inside the lock, and `PROC_SPY` proves no `/proc` walk ran), and the expiry cases read a fake process root
// (`FAKE_PROC_SELF`), so this file shells no real `/proc` walk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, WS_ADD } from './ccdWsHelpers.js';
import {
  CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, type Child, type LadderAnswer,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_ID, expireAudit, makeArchived } from './wsExpireFixture.js';
import { FAKE_PROC_SELF, walkSpy, writeField } from './worktreeIdentityFixture.js';
import { parseChildReclaimAudit, parseChildReclaimAuditFailed } from '../src/coord/childReclaim.js';
import { parseExpireAudit } from '../src/archivedExpiry.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-rows-rung-entry-'); });
afterEach(() => { h.cleanup(); });
const { treeOf, atticShas, intact, refusedWith } = verbHelpers(() => h);

/** How the wave's brief rules the expiry document's half of the count: `true` when its one in-place printf edit was
 *  consented to, `false` when that half was dropped. */
const EXPIRE_HALF: boolean = true;

const HEX64 = /^[0-9a-f]{64}$/;
const AT = '1760000000000';
const ALT = 'demo-alias-live';
const SIB = 'demo-still-harbor';
const DEAD = 'demo-quiet-mesa';
const REG = (): string => path.join(h.home, '.cc-sessions');
/** The ladder's containment details, and the not-asked sentences (each by row id). */
const SHARED_BY = (id: string): string => `is also named by registry row(s) ${id}`;
const NESTED_BY = (id: string): string => `has registry row(s) ${id} rooted inside it`;
const HELD = 'name a workdir that cannot be resolved completely';
const PENDING = 'began a spawn that never recorded where its pane entered (its entry identity is pending), so ccd cannot'
  + ' place them against this child — restart that session (ccd start <id>)';
const UNFIELD = 'have an entry-identity field that is not a regular file or cannot be read';
const UNREC = 'entered a directory other than the one their workdir names now, and where they entered can no longer be placed';
const UNWALK = 'the identity walk of the registry rows did not answer for row';

/** The field's two forms (path-identity spec §4.3, with its pending form). */
const field = (ident: string, phys: string, logical: string): string => `v1\t${ident}\t${AT}\t${phys}\t${logical}`;
const pendingField = (logical: string): string => `v1\tpending\t${AT}\t-\t${logical}`;
/** A directory under the fixture HOME, made; its spelling as given (never resolved). */
const mk = (...parts: string[]): string => {
  const p = path.join(h.home, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const gone = (): string => path.join(fs.realpathSync(h.home), 'gone-entry');
/** A registry row as an older ccd or a hand leaves one: `.uuid` and `.workdir`, nothing else. */
const otherRow = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(REG(), `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(REG(), `${id}.workdir`), workdir);
};
/** `_ws_path_ident`'s identity of the directory `p`, asserted measured. */
const identOf = (p: string, pre = ''): string => {
  const out = h.sh(`${pre} _ws_path_ident '${p}'; printf '[%s]%s' "$?" "$_WS_IDENT"`);
  expect(out, `the CONTROL: ${p} has an identity`).toMatch(/^\[0\][0-9]+:[0-9]+:([1-9][0-9]*|-)$/);
  return out.slice(3);
};
/** `_ws_workdirid_read`'s state word for `id`, given its logical spelling. */
const fieldState = (id: string, logical: string): string =>
  h.sh(`_ws_workdirid_read ${id} '${logical}'; printf '%s' "$_WS_WDID_STATE"`);
const answers = (r: LadderAnswer, verdict: string, needle: string, label = ''): void => {
  expect(r.verdict, `${label} ${r.detail}`).toBe(verdict);
  expect(r.detail, label).toContain(needle);
  expect(r.token, `${label}: no token`).toBe('');
};
const placed = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('reclaimable');
  expect(r.token, label).toMatch(HEX64);
};

/** The re-pointed alias (`ccd-child-reclaim-verb.test.ts`'s `aliasRow`, cut to its levers): `<tree>/server` holding
 *  another session's work, `$HOME/outside/server`, an alias `$HOME/alias`, and the row `ALT` spelled `alias/server`. */
const aliasRow = (tree: string) => {
  const server = path.join(tree, 'server');
  fs.mkdirSync(server, { recursive: true });
  fs.writeFileSync(path.join(server, 'live.txt'), 'another session’s uncommitted work\n');
  const outsideServer = mk('outside', 'server');
  const alias = path.join(h.home, 'alias');
  const raw = `${alias}/server`;
  return {
    raw, server, outsideServer,
    pointAt: (target: 'tree' | 'outside'): void => {
      if (fs.lstatSync(alias, { throwIfNoEntry: false })) fs.unlinkSync(alias);
      fs.symlinkSync(target === 'tree' ? tree : path.dirname(outsideServer), alias);
    },
    writeRow: (): void => { otherRow(ALT, raw); },
  };
};
/** A sibling of the child's own repository minted by the REAL `cmd_ws_add`, so its field is the seed ws-add wrote. */
const sibling = (child = true): { wt: string } => {
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add ${child ? `--child ${CHILD_RUN} ` : ''}demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-harbor');
  expect(fieldState(SIB, wt), 'the CONTROL: ws-add seeded a valid field').toBe('valid');
  return { wt };
};
/** A checkout of `main`'s repository whose admin entry's `gitdir` is blank: with it, neither gone-row arm can place
 *  any gone row of that repository (`ccd-child-reclaim-sibling-entry.test.ts`'s shape). */
const blankAdminEntry = (main: string): void => {
  h.git(main, 'worktree', 'add', '-q', '-b', 'ws/other', path.join(h.home, 'worktrees', 'demo', 'other'));
  fs.writeFileSync(path.join(main, '.git', 'worktrees', 'other', 'gitdir'), '\n');
};

/** `_ws_reclaim_eval`'s answer for any child id, `_ws_reclaim_owned`'s for any id, git's stanza for a path, and a
 *  reclaim interrupted after its pin, as `ccd-child-reclaim-recovery.test.ts` builds them. */
const evalAs = (id: string): LadderAnswer => {
  const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${id} 0 '' >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
};
const ownedOf = (id: string, wt: string, main: string): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`_ws_reclaim_owned ${id} "${wt}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';
const pinned = (id: string, wt: string, main: string): void => {
  h.sh(`${CHILD_STUBS} export ${CHILD_ENV}; _ws_reclaim_eval ${id} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${id} "${wt}" "${main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${id} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN} present)" >/dev/null`
    + ` && _reg_set ${id} reaping reclaim:branch`);
  expect(h.reg(id, 'reaping'), `the CONTROL: ${id} carries the breadcrumb`).toBe('reclaim:branch');
};
const removedByTail = (wt: string, main: string): void => {
  h.git(main, 'worktree', 'remove', '--force', wt);
  expect(fs.existsSync(wt)).toBe(false);
};

/** `_ws_reclaim_workdir_shared`'s rc and its two counts, read right after it. */
const counts = (c: Child, pre = ''): string =>
  h.sh(`${pre} _ws_reclaim_workdir_shared ${CHILD_ID} '${c.wt}' >/dev/null; rc=$?;`
    + ' printf \'[rc=%s] legacy=[%s] pending=[%s]\' "$rc" "$_WS_LEGACY_ROWS" "$_WS_PENDING_ROWS"');
/** `ws-audit --session <child> --reclaim`, its document parsed. */
const AUDIT_STUBS = `${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB}`;
const reclaimDoc = (pre = ''): { code: number; stdout: string; stderr: string; doc: Record<string, unknown> } => {
  const r = h.run(`${AUDIT_STUBS} ${pre} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
  return { ...r, doc: JSON.parse(r.stdout) as Record<string, unknown> };
};
/** `ws-audit --session <archived> --expire` over a fake process root, its document parsed. */
const expireDoc = (pre = ''): { code: number; stdout: string; stderr: string; doc: Record<string, unknown> } => {
  const r = expireAudit(h, { pre: `${FAKE_PROC_SELF} ${pre}` });
  return { ...r, doc: JSON.parse(r.stdout) as Record<string, unknown> };
};
const withoutCounts = (stdout: string): string => {
  const o = JSON.parse(stdout) as Record<string, unknown>;
  delete o['legacyRows'];
  delete o['pendingRows'];
  return JSON.stringify(o);
};
/** The collector's row rule over a dead child's temp root, asked as its callers ask it (contained). */
const collectClear = (pre = ''): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_reclaim_contained _ws_collect_rows_clear ${DEAD}`
    + ` '${path.join(h.home, '.cc-tmp', DEAD)}'; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_COLLECT_ROWS_WHY"`).split('\x1f');
  return { rc, why };
};
/** `_plat_btime`, answering `bt` for every path: the walk carries this definition into its own bound. */
const BTIME = (bt: string): string => `_plat_btime() { local p; for p in "$@"; do echo ${bt}; done; };`;
/** The same, failing for `p` alone: the walk's batched call is refused, each path is asked alone, and `p` reads un. */
const BTIME_FAILS_AT = (p: string): string =>
  `_plat_btime() { local q r=0; for q in "$@"; do if [[ "$q" == '${p}' ]]; then r=1; else echo 1111; fi; done; return $r; };`;
/** `find`, failing for the rows rung's one registry listing only. */
const FIND_FAILS = 'find() { [[ " $* " == *" *.workdir "* ]] && return 1; command find "$@"; };';
const PROC_SPY = '_ws_path_users_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };';
const walks = (): string[] => {
  const p = path.join(h.home, 'proc-walks');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
/** `walkSpy`'s record: one line per walk, `walk` and then one `<kind><index>` token per request (Task 3). */
const walkCalls = (): string[] => {
  const p = path.join(h.home, 'walk-calls');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

describe('a valid field places its row, and only adds (path-identity spec §4.5 step 2)', () => {
  const LEGACY: Array<[string, (x: string) => void]> = [
    ['absent', (): void => undefined],
    ['a link to a valid body', (x) => {
      const body = path.join(h.home, 'fieldbody');
      fs.writeFileSync(body, field(identOf(x), fs.realpathSync(x), x));
      fs.symlinkSync(body, path.join(REG(), 'demo-inside.workdirid'));
    }],
    ['unparseable', () => { writeField(h, 'demo-inside', 'v2\tjunk'); }],
    ['stale: it names another logical spelling', (x) => {
      writeField(h, 'demo-inside', field(identOf(x), fs.realpathSync(x), path.join(h.home, 'another-spelling')));
    }],
  ];
  it.each(LEGACY)('I2: a legacy field (%s) beside a row inside the child changes nothing — NESTED, and counted legacy', (_l, plant) => {
    const c = makeChild(h);
    const x = path.join(c.wt, 'x');
    fs.mkdirSync(x);
    otherRow('demo-inside', x);
    plant(x);
    expect(fieldState('demo-inside', x)).toMatch(/^legacy-/);
    answers(evalOf(h), 'containment-unproven', NESTED_BY('demo-inside'));
    expect(counts(c)).toBe('[rc=0] legacy=[1] pending=[0]');
  }, 90_000);

  it('I3: the re-pointed alias — a valid field recording the child holds it, where the legacy row reclaims', () => {
    const c = makeChild(h);
    const a = aliasRow(c.wt);
    a.pointAt('tree');
    const rec = field(identOf(a.server), fs.realpathSync(a.server), a.raw);
    a.pointAt('outside');
    a.writeRow();
    const legacy = evalOf(h);
    expect(legacy.verdict, `the CONTROL: legacy, the re-pointed alias resolves outside — ${legacy.detail}`).toBe('reclaimable');
    writeField(h, ALT, rec);
    expect(fieldState(ALT, a.raw), 'the CONTROL: the field reads valid').toBe('valid');
    answers(evalOf(h), 'containment-unproven', NESTED_BY(ALT));
  }, 90_000);

  it('I3, the directory it entered removed and recreated in place: still NESTED by its recorded path', () => {
    const c = makeChild(h);
    const a = aliasRow(c.wt);
    a.pointAt('tree');
    const rec = field(identOf(a.server), fs.realpathSync(a.server), a.raw);
    a.pointAt('outside');
    a.writeRow();
    writeField(h, ALT, rec);
    fs.rmSync(a.server, { recursive: true, force: true });
    fs.mkdirSync(a.server);
    answers(evalOf(h), 'containment-unproven', NESTED_BY(ALT));
  }, 90_000);

  it('I3b: the directory it entered moved into the child and replaced at its old path — unmeasured, never reclaimable', () => {
    const c = makeChild(h);
    const a = aliasRow(c.wt);
    a.pointAt('outside');
    a.writeRow();
    writeField(h, ALT, field(identOf(a.outsideServer), fs.realpathSync(a.outsideServer), a.raw));
    const control = evalOf(h);
    expect(control.verdict, `the CONTROL: the field records where the row still leads — ${control.detail}`).toBe('reclaimable');
    fs.renameSync(a.outsideServer, path.join(c.wt, 'moved-in'));
    fs.mkdirSync(a.outsideServer);
    answers(evalOf(h), 'unmeasured', `registry row(s) ${ALT} ${UNREC}`);
  }, 90_000);

  it('I3, the verb: a field recording the child, written after the token, is refused in the lock and nothing is touched', () => {
    const c = makeChild(h);
    const a = aliasRow(c.wt);
    a.pointAt('tree');
    const rec = field(identOf(a.server), fs.realpathSync(a.server), a.raw);
    a.pointAt('outside');
    a.writeRow();
    const tok = evalOf(h).token;
    expect(tok, 'the CONTROL: a legacy row resolving outside mints a token').toMatch(HEX64);
    writeField(h, ALT, rec);
    const before = treeOf(c.wt);
    const r = childReclaimVerb(h, tok, { pre: PROC_SPY });
    expect(treeOf(c.wt), 'the child’s tree, and the other session’s work inside it, survive byte for byte').toEqual(before);
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
    expect(refusedWith(r)).toBe('containment-unproven');
    expect((JSON.parse(r.stdout) as { detail: string }).detail).toContain(NESTED_BY(ALT));
    intact(c);
    expect(walks(), 'the refusal came before any tail: no /proc walk').toEqual([]);
  }, 120_000);

  it('I4: a row inside the child whose field records a path outside stays NESTED — a recorded path never moves a row out', () => {
    const c = makeChild(h);
    const x = path.join(c.wt, 'x');
    fs.mkdirSync(x);
    const outside = mk('outside');
    otherRow('demo-inside', x);
    writeField(h, 'demo-inside', field(identOf(outside), fs.realpathSync(outside), x));
    expect(fieldState('demo-inside', x), 'the CONTROL: the field reads valid').toBe('valid');
    answers(evalOf(h), 'containment-unproven', NESTED_BY('demo-inside'));
  }, 90_000);

  it('I5: a gone row whose field records a path outside, beside a blank admin entry, still holds the child', () => {
    const c = makeChild(h);
    const s = sibling();
    blankAdminEntry(c.main);
    fs.rmSync(s.wt, { recursive: true, force: true });
    answers(evalOf(h), 'unmeasured', `registry row(s) ${SIB} ${HELD}`, 'the CONTROL: the seed alone');
    const outside = mk('outside');
    writeField(h, SIB, field(identOf(outside), fs.realpathSync(outside), s.wt));
    answers(evalOf(h), 'unmeasured', `registry row(s) ${SIB} ${HELD}`, 'a field recording a path outside');
  }, 120_000);

  const I6: Array<[string, (c: Child) => string]> = [
    ['its recorded physical path is the child’s', (c) => fs.realpathSync(c.wt)],
    ['by identity alone: its recorded path is gone', (_c) => path.join(fs.realpathSync(h.home), 'bindgone', 'quiet-basin')],
  ];
  it.each(I6)('I6, P2: a `..` row that names the child is SHARED by its field — %s', (_l, physOf) => {
    const c = makeChild(h);
    mk('elsewhere', 'sub');
    mk('elsewhere', 'gone');
    fs.symlinkSync(path.join(h.home, 'elsewhere', 'sub'), path.join(h.home, 'lnk'));
    mk('gone');
    const raw = `${h.home}/lnk/../gone/../${path.relative(h.home, c.wt)}`;
    otherRow('demo-dotdot', raw);
    answers(evalOf(h), 'containment-unproven', SHARED_BY('demo-dotdot'), 'the CONTROL: while gone stands');
    fs.rmdirSync(path.join(h.home, 'gone'));
    answers(evalOf(h), 'unmeasured', `registry row(s) demo-dotdot ${HELD}`, 'the CONTROL: no field, once gone goes');
    writeField(h, 'demo-dotdot', field(identOf(c.wt), physOf(c), raw));
    expect(fieldState('demo-dotdot', raw), 'the CONTROL: the field reads valid').toBe('valid');
    answers(evalOf(h), 'containment-unproven', SHARED_BY('demo-dotdot'));
  }, 90_000);

  it('a bind-spelled recorded path (a link stands in for the bind) is NESTED by its walk alone', () => {
    const c = makeChild(h);
    const server = path.join(c.wt, 'server');
    fs.mkdirSync(server);
    fs.symlinkSync(c.wt, path.join(h.home, 'bindlike'));
    const outsideServer = mk('outside', 'server');
    otherRow('demo-bindrec', outsideServer);
    expect(evalOf(h).verdict, 'the CONTROL: legacy, the row lies outside').toBe('reclaimable');
    writeField(h, 'demo-bindrec', field(identOf(server), `${fs.realpathSync(h.home)}/bindlike/server`, outsideServer));
    expect(fieldState('demo-bindrec', outsideServer), 'the CONTROL: the field reads valid').toBe('valid');
    answers(evalOf(h), 'containment-unproven', NESTED_BY('demo-bindrec'));
  }, 90_000);
});

describe('a pending or unmeasured field holds, by row id', () => {
  it('a PENDING field holds the child, by row id, with its remedy', () => {
    makeChild(h);
    const elsewhere = mk('elsewhere');
    otherRow('demo-pending', elsewhere);
    expect(evalOf(h).verdict, 'the CONTROL: legacy, the row lies outside').toBe('reclaimable');
    writeField(h, 'demo-pending', pendingField(elsewhere));
    expect(fieldState('demo-pending', elsewhere)).toBe('pending');
    const r = evalOf(h);
    answers(r, 'unmeasured', `registry row(s) demo-pending ${PENDING}`);
    expect(r.detail, 'by id, never by its spelling').not.toContain(elsewhere);
  }, 90_000);

  it('a DIRECTORY at the field holds the child: not a regular file, unmeasured', () => {
    makeChild(h);
    const elsewhere = mk('elsewhere');
    otherRow('demo-dirfield', elsewhere);
    fs.mkdirSync(path.join(REG(), 'demo-dirfield.workdirid'));
    expect(fieldState('demo-dirfield', elsewhere)).toBe('unmeasured');
    answers(evalOf(h), 'unmeasured', `registry row(s) demo-dirfield ${UNFIELD}`);
  }, 90_000);

  it('outranked: a pending field beside a row inside the child is containment-unproven, never a retry', () => {
    const c = makeChild(h);
    const elsewhere = mk('elsewhere');
    otherRow('demo-pending', elsewhere);
    writeField(h, 'demo-pending', pendingField(elsewhere));
    fs.mkdirSync(path.join(c.wt, 'x'));
    otherRow('demo-inside', path.join(c.wt, 'x'));
    answers(evalOf(h), 'containment-unproven', NESTED_BY('demo-inside'));
  }, 90_000);
});

describe('birth times (P20): read only where identities are compared across time, and never read as none kept', () => {
  /** A standing row outside the child, spelled physically, with nothing yet at its field: the mismatch rule's shape. */
  const recycledRow = (): { cur: string; devino: string } => {
    makeChild(h);
    const cur = fs.realpathSync(mk('cur'));
    otherRow('demo-recycled', cur);
    const devino = h.sh(`_plat_devino '${cur}'`);
    expect(devino, 'the CONTROL: a device and inode').toMatch(/^[0-9]+:[0-9]+$/);
    return { cur, devino };
  };

  it('a recycled inode: the same device and inode, another birth time, the recorded path gone — unmeasured', () => {
    const { cur, devino } = recycledRow();
    writeField(h, 'demo-recycled', field(`${devino}:1111`, gone(), cur));
    expect(evalOf(h, { pre: BTIME('1111') }).verdict, 'the CONTROL: the same birth time is the same directory')
      .toBe('reclaimable');
    writeField(h, 'demo-recycled', field(`${devino}:2222`, gone(), cur));
    answers(evalOf(h, { pre: BTIME('1111') }), 'unmeasured', `registry row(s) demo-recycled ${UNREC}`);
  }, 90_000);

  it('a birth time that could not be read is never read as none kept — unmeasured, naming the walk, never a pass', () => {
    const { cur, devino } = recycledRow();
    writeField(h, 'demo-recycled', field(`${devino}:2222`, gone(), cur));
    const r = evalOf(h, { pre: BTIME_FAILS_AT(cur) });
    answers(r, 'unmeasured', `${UNWALK} demo-recycled`);
    expect(r.detail, 'the mismatch rule was never asked').not.toContain(UNREC);
  }, 90_000);

  const DASH: Array<[string, (di: string) => string, string]> = [
    ['the field keeps none', (di) => `${di}:-`, '1111'],
    ['the walk reads none now', (di) => `${di}:2222`, '0'],
  ];
  it.each(DASH)('btime - on either side compares device and inode only — %s: no mismatch, reclaimable', (_l, ident, bt) => {
    const { cur, devino } = recycledRow();
    writeField(h, 'demo-recycled', field(ident(devino), gone(), cur));
    const r = evalOf(h, { pre: BTIME(bt) });
    expect(r.verdict, r.detail).toBe('reclaimable');
  }, 90_000);

  it('the one walk carries each valid field’s F request, after every request of the rows’ own', () => {
    const { cur, devino } = recycledRow();
    writeField(h, 'demo-recycled', field(`${devino}:1111`, gone(), cur));
    const r = evalOf(h, { pre: `${walkSpy} ${BTIME('1111')}` });
    expect(r.verdict, `the CONTROL: the birth times were asked, or rule (d) would hold — ${r.detail}`).toBe('reclaimable');
    const calls = walkCalls();
    expect(calls, 'one walk').toHaveLength(1);
    const toks = calls[0]!.split(' ').slice(1);
    expect(toks, 'one F request, by field').toContain('F0');
    const first = toks.findIndex((t) => t.startsWith('F'));
    expect(toks.slice(first).every((t) => t.startsWith('F')), toks.join(' ')).toBe(true);
  }, 90_000);
});

describe('a gone row never mismatches: its recorded path reads GONE, which adds nothing by itself', () => {
  it('the git-record arm releases a seeded sibling whose recorded path is GONE: reclaimable', () => {
    const c = makeChild(h);
    const s = sibling();
    placed(evalOf(h), 'the CONTROL: while its tree stands, its field matches it, outside the child');
    fs.rmSync(s.wt, { recursive: true, force: true });
    expect(stanza(c.main, s.wt), 'the CONTROL: git keeps the record, prunable').toContain('\nprunable');
    placed(evalOf(h), 'git’s record places the gone sibling, and its field adds nothing');
  }, 120_000);

  it('two seeded children of one repository, both trees gone, release each other', () => {
    const c = makeChild(h);
    const s = sibling();
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.rmSync(s.wt, { recursive: true, force: true });
    placed(evalOf(h), 'the child, its seeded sibling placed by git’s record');
    placed(evalAs(SIB), 'the sibling, the seeded child placed by git’s record');
  }, 120_000);

  it('the breadcrumb arm releases two seeded children whose trees the tail removed', () => {
    const c = makeChild(h);
    const s = sibling();
    pinned(CHILD_ID, c.wt, c.main);
    pinned(SIB, s.wt, c.main);
    removedByTail(c.wt, c.main);
    removedByTail(s.wt, c.main);
    for (const wt of [c.wt, s.wt]) expect(stanza(c.main, wt), 'the CONTROL: git keeps no record').toBe('');
    const mine = ownedOf(CHILD_ID, c.wt, c.main);
    expect(mine.rc, mine.why).toBe('0');
    const theirs = ownedOf(SIB, s.wt, c.main);
    expect(theirs.rc, theirs.why).toBe('0');
  }, 180_000);

  it('a gone row whose field records a path inside the child is NESTED, by the string of its recorded path', () => {
    const c = makeChild(h);
    const s = sibling();
    fs.rmSync(s.wt, { recursive: true, force: true });
    placed(evalOf(h), 'the CONTROL: the seed records the gone tree, outside the child');
    writeField(h, SIB, field('1:2:-', path.join(fs.realpathSync(c.wt), 'inner'), s.wt));
    answers(evalOf(h), 'containment-unproven', NESTED_BY(SIB));
  }, 120_000);
});

describe('ws-expire and the collector share the rows rung', () => {
  it('X, I3: the re-pointed alias with a field recording the archived tree holds the expiry', () => {
    const e = makeArchived(h);
    const a = aliasRow(e.wt);
    a.pointAt('tree');
    const rec = field(identOf(a.server), fs.realpathSync(a.server), a.raw);
    a.pointAt('outside');
    a.writeRow();
    const legacy = expireDoc();
    expect(legacy.doc['verdict'], `the CONTROL: legacy — ${String(legacy.doc['detail'])}`).toBe('expirable');
    writeField(h, ALT, rec);
    const r = expireDoc();
    expect(r.doc['verdict'], String(r.doc['detail'])).toBe('containment-unproven');
    expect(String(r.doc['detail'])).toContain(NESTED_BY(ALT));
  }, 120_000);

  it('X, I5: a gone row with a field outside, beside a blank admin entry, still holds the expiry', () => {
    const e = makeArchived(h);
    const s = sibling(false);
    blankAdminEntry(e.main);
    fs.rmSync(s.wt, { recursive: true, force: true });
    const outside = mk('outside');
    writeField(h, SIB, field(identOf(outside), fs.realpathSync(outside), s.wt));
    const r = expireDoc();
    expect(r.code, 'an unmeasured audit exits 1').toBe(1);
    expect(r.doc['verdict'], String(r.doc['detail'])).toBe('unmeasured');
    expect(String(r.doc['detail'])).toContain(`registry row(s) ${SIB} ${HELD}`);
  }, 120_000);

  it('C, I3: a field recording a path inside the dead child’s temp root refuses its collection', () => {
    const leaf = mk('.cc-tmp', DEAD);
    const a = aliasRow(leaf);
    a.pointAt('tree');
    const rec = field(identOf(a.server), fs.realpathSync(a.server), a.raw);
    a.pointAt('outside');
    a.writeRow();
    const legacy = collectClear();
    expect(legacy.rc, `the CONTROL: legacy, the row resolves outside — ${legacy.why}`).toBe('0');
    writeField(h, ALT, rec);
    const r = collectClear();
    expect(r.rc, r.why).toBe('1');
    expect(r.why).toContain(`inside: ${ALT}`);
  }, 60_000);

  it('C, I5: a gone row with a field outside, beside a blank admin entry, is never "no row" to the collector', () => {
    mk('.cc-tmp', DEAD);
    const main = h.makeGhRepo('demo');
    const s = sibling(false);
    blankAdminEntry(main);
    fs.rmSync(s.wt, { recursive: true, force: true });
    const outside = mk('outside');
    writeField(h, SIB, field(identOf(outside), fs.realpathSync(outside), s.wt));
    const r = collectClear();
    expect(r.rc, r.why).toBe('2');
    expect(r.why).toContain(`registry row(s) ${SIB} ${HELD}`);
  }, 90_000);
});

describe('the legacy count (path-identity spec §4.4)', () => {
  /** Three other rows, each outside the child: a valid field, none (legacy), and a pending one. */
  const threeRows = (): void => {
    const valid = mk('valid');
    otherRow('demo-valid', valid);
    writeField(h, 'demo-valid', field(identOf(valid), fs.realpathSync(valid), valid));
    otherRow('demo-legacy', mk('legacy'));
    const pending = mk('pending');
    otherRow('demo-pending', pending);
    writeField(h, 'demo-pending', pendingField(pending));
  };

  it('the rung counts legacy and pending rows: three other rows, valid, absent and pending', () => {
    const c = makeChild(h);
    threeRows();
    expect(counts(c)).toBe('[rc=2] legacy=[1] pending=[1]');
  }, 90_000);

  it('the reclaim document carries legacyRows and pendingRows, and the parser reads it exactly as before', () => {
    makeChild(h);
    const valid = mk('valid');
    otherRow('demo-valid', valid);
    writeField(h, 'demo-valid', field(identOf(valid), fs.realpathSync(valid), valid));
    otherRow('demo-legacy', mk('legacy'));
    const r = reclaimDoc();
    expect(r.code, r.stderr).toBe(0);
    expect(r.doc['verdict'], String(r.doc['detail'])).toBe('reclaimable');
    expect(r.doc).toHaveProperty('legacyRows', 1);
    expect(r.doc).toHaveProperty('pendingRows', 0);
    const parsed = parseChildReclaimAudit(CHILD_ID, r.stdout);
    expect(parsed.kind).toBe('token');
    expect(parsed).toEqual(parseChildReclaimAudit(CHILD_ID, withoutCounts(r.stdout)));
  }, 90_000);

  it('the unmeasured reclaim document carries them too, and the failed-document parser reads it exactly as before', () => {
    makeChild(h);
    threeRows();
    const r = reclaimDoc();
    expect(r.code, 'an unmeasured audit exits 1').toBe(1);
    expect(r.doc['verdict']).toBe('unmeasured');
    expect(r.doc).toHaveProperty('legacyRows', 1);
    expect(r.doc).toHaveProperty('pendingRows', 1);
    const parsed = parseChildReclaimAuditFailed(CHILD_ID, r.stdout, r.stderr);
    expect(parsed.kind).toBe('unmeasured');
    expect(parsed).toEqual(parseChildReclaimAuditFailed(CHILD_ID, withoutCounts(r.stdout), r.stderr));
  }, 90_000);

  it('not counted is null: a ladder that stops before the rows rung (not-a-child) prints both keys as null', () => {
    makeChild(h);
    threeRows();
    fs.rmSync(path.join(REG(), `${CHILD_ID}.child`));
    const r = reclaimDoc();
    expect(r.doc['verdict']).toBe('not-a-child');
    expect(r.doc).toHaveProperty('legacyRows', null);
    expect(r.doc).toHaveProperty('pendingRows', null);
    expect(parseChildReclaimAudit(CHILD_ID, r.stdout)).toEqual(parseChildReclaimAudit(CHILD_ID, withoutCounts(r.stdout)));
  }, 90_000);

  it('not counted is null: a registry that cannot be listed prints both keys as null, and the rung leaves them empty', () => {
    const c = makeChild(h);
    threeRows();
    expect(counts(c, FIND_FAILS)).toBe('[rc=2] legacy=[] pending=[]');
    const r = reclaimDoc(FIND_FAILS);
    expect(r.code).toBe(1);
    expect(String(r.doc['detail'])).toContain('could not list');
    expect(r.doc).toHaveProperty('legacyRows', null);
    expect(r.doc).toHaveProperty('pendingRows', null);
  }, 90_000);

  it('the expire document: the counts, or neither key where its half was fenced; the parser reads it as before', () => {
    makeArchived(h);
    otherRow('demo-legacy', mk('legacy'));
    const r = expireDoc();
    expect(r.code, r.stderr).toBe(0);
    expect(r.doc['verdict'], String(r.doc['detail'])).toBe('expirable');
    if (EXPIRE_HALF) {
      expect(r.doc).toHaveProperty('legacyRows', 1);
      expect(r.doc).toHaveProperty('pendingRows', 0);
    } else {
      expect(Object.keys(r.doc)).not.toContain('legacyRows');
      expect(Object.keys(r.doc)).not.toContain('pendingRows');
    }
    expect(parseExpireAudit(EXP_ID, true, r.stdout)).toEqual(parseExpireAudit(EXP_ID, true, withoutCounts(r.stdout)));
  }, 120_000);
});

describe('the source', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  /** `name`'s body, from its head line to its first closing brace at column 0, or '' when it is not defined. */
  const bodyOf = (name: string): string => {
    const a = src.indexOf(`\n${name}() {`);
    const b = a > -1 ? src.indexOf('\n}\n', a) : -1;
    return b > a ? src.slice(a, b) : '';
  };
  const code = (s: string): string[] => s.split('\n').filter((l) => !/^\s*#/.test(l));

  it('one field read per row, directly after the .workdir read and before every arm that continues past it', () => {
    const lines = code(bodyOf('_ws_reclaim_workdir_shared'));
    expect(lines.length, 'the rung could not be sliced').toBeGreaterThan(100);
    const at = (needle: string): number[] => lines.flatMap((l, i) => (l.includes(needle) ? [i] : []));
    const read = at('_ws_workdirid_read "$o" "$w"');
    expect(read, 'one field read').toHaveLength(1);
    const unread = at('unread+="${unread:+, }$n"; continue;')[0]!;
    const notAbs = at('[[ "$w" == /* && "$w" != //[!/]* ]] || { unplaced+=')[0]!;
    expect(unread < read[0]! && read[0]! < notAbs, 'after the .workdir read, before the first arm that skips a row').toBe(true);
    expect(lines.slice(unread + 1, read[0]!).some((l) => /\bcontinue\b/.test(l)), 'no continue between them').toBe(false);
  });

  it('the field arms only ever add: every bucket write between them and the outrank line appends', () => {
    const body = bodyOf('_ws_reclaim_workdir_shared');
    const a = body.indexOf('# AND WHERE EACH ROW ENTERED: rules (a) to (d)');
    const b = body.indexOf('[[ -z "$_WS_SHARED_ROWS$_WS_NESTED_ROWS$_WS_THROUGH_ROWS" ]] || return 0');
    expect(a > -1 && b > a, 'the arms stand above the outrank line').toBe(true);
    const arms = code(body.slice(a, b)).join('\n');
    const writes = [...arms.matchAll(/\b(_WS_(?:SHARED|NESTED|THROUGH)_ROWS|un(?:walk|rec|res|placed|mine|proc|read|leaf|mount|pend|field))(\+?=)/g)];
    expect(writes.length, 'the scan has subjects').toBeGreaterThan(5);
    expect(writes.filter((m) => m[2] !== '+=').map((m) => m[0]), 'no bucket is assigned, only appended to').toEqual([]);
  });
});
