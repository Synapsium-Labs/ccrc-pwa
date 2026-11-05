// A GONE ROW HOLDS ONLY A RECLAIM IT COULD OVERLAP (#2294).
//
// A registry row whose workdir is gone used to hold every child's reclaim unless git or ccd had recorded what became
// of it, and on one fleet two such rows turned off disk recovery for all of it. What can be proved when the path is
// gone: a row can overlap the child in four ways.
//   1. Its spelling is at, in or through the child. The literal arms catch this, even for a gone row.
//   2. A component now gone was a link into the child.
//   3. Its tree was moved into the child or a leaf.
//   4. Its session is alive somewhere unknown.
// Ways 2 and 3 cannot be excluded from the spelling, so a gone row is still never PLACED by a projection. It is only
// RELEASED, by a stronger question than the moved-check: nothing runs for the row (`_ws_reclaim_gone_quiet`), and no
// checkout at all stands under the child or either leaf (`_ws_reclaim_no_checkout`). That excludes a moved checkout,
// never a tree with no `.git` of its own, so ways 2 and 3 keep a stated residual, pinned below and in the verb's suite.
// The second shape is on #2294 too: a row that goes between the rows pass and the identity walk.
//
// FIXTURE HOME ONLY: `makePrHarness`'s HOME is the isolation boundary, and every call runs under `CHILD_STUBS`, so no
// unit or pane is touched. `CHILD_STUBS` answers `gone` for a pane nobody planted and `inactive` for every unit: a row
// here is quiet unless a case says otherwise.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD, ccdSource } from './ccdWsHelpers.js';
import {
  CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, TMUX_FAULTS, childReclaimVerb, evalOf, makeChild, plantTmux, type Child, type LadderAnswer,
} from './childReclaimFixture.js';
import { EXP_ID, EXP_STUBS, NOW, makeArchived } from './wsExpireFixture.js';
import { FAKE_PROC_SELF } from './worktreeIdentityFixture.js';
import { parseChildReclaimAudit, parseChildReclaimAuditFailed } from '../src/coord/childReclaim.js';
import { parseExpireAudit } from '../src/archivedExpiry.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-reclaim-gone-quiet-'); });
afterEach(() => { h.cleanup(); });

/** The row that cannot be resolved completely: it holds, as it always did. */
const HELD = 'name a workdir that cannot be resolved completely';
/** A row released as quiet, held by a checkout that could be its moved tree. */
const QUIET_HELD = 'name a workdir that is gone, and nothing runs for them';
const UNWALK = 'the identity walk of the registry rows did not answer for row';
const OTHER = 'demo2-still-harbor';
const AT = '1700000000000';
const REG = (): string => path.join(h.home, '.cc-sessions');
const leaf = (dir: '.cc-tmp' | '.cc-clips'): string => path.join(h.home, dir, CHILD_ID);

const placed = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('reclaimable');
  expect(r.token, label).toMatch(/^[0-9a-f]{64}$/);
};
const held = (r: LadderAnswer, label: string, needle = `registry row(s) ${OTHER} ${HELD}`): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('unmeasured');
  expect(r.detail, label).toContain(needle);
  expect(r.token, label).toBe('');
};
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';

/** A plain workspace of ANOTHER repository, minted by the real ws-add, so its entry field is the valid one ws-add seeds. */
const other = (): { main: string; wt: string } => {
  const main = h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  return { main, wt: path.join(h.home, 'worktrees', 'demo2', 'still-harbor') };
};
/** The child, and a row whose tree is gone with nothing recorded of it: neither recorded arm can place it. */
const goneRow = (): { c: Child; o: { main: string; wt: string } } => {
  const c = makeChild(h);
  const o = other();
  placed(evalOf(h), 'the CONTROL: while its tree stands the row is placed outside');
  fs.rmSync(o.wt, { recursive: true, force: true });
  h.git(o.main, 'worktree', 'prune');   // the FIXTURE removes git's record; ccd never runs this
  expect(stanza(o.main, o.wt), 'the CONTROL: git records nothing of it').toBe('');
  return { c, o };
};
/** A row as a hand leaves one: `.uuid` and `.workdir`, nothing else, so its entry field reads `legacy-absent`. */
const handRow = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(REG(), `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(REG(), `${id}.workdir`), workdir);
};
/** `_ws_reclaim_workdir_shared`'s whole answer, for the child or any spelling of it. */
const rows = (wd: string, pre = ''): { rc: string; shared: string; nested: string; through: string; why: string; ids: string; quietRows: string } => {
  const [rc = '', shared = '', nested = '', through = '', why = '', ids = '', quietRows = ''] = h.sh(`${CHILD_STUBS} ${pre}`
    + ` _ws_reclaim_workdir_shared ${CHILD_ID} '${wd}' >/dev/null; rc=$?;`
    + ' printf \'%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\' "$rc" "$_WS_SHARED_ROWS" "$_WS_NESTED_ROWS" "$_WS_THROUGH_ROWS" "$_WS_SHARED_WHY" "$_WS_RECORDED_GDIRS$_WS_RECORDED_IDS" "$_WS_QUIET_ROWS"')
    .split('\x1f');
  return { rc, shared, nested, through, why, ids, quietRows };
};
const owned = (c: Child, pre = ''): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`${CHILD_STUBS} ${pre} _ws_reclaim_owned ${CHILD_ID} "${c.wt}" "${c.main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
const quiet = (id: string, w: string, pre = ''): string =>
  h.sh(`${CHILD_STUBS} ${pre} _ws_reclaim_gone_quiet ${id} '${w}'; printf '%s' "$?"`);
/** A document with its release key taken out: what a reader that ignores the key is handed. */
const withoutQuietRows = (stdout: string): string => {
  const o = JSON.parse(stdout) as Record<string, unknown>;
  delete o['quietRows'];
  return JSON.stringify(o);
};
/** `ws-audit --session <child> --reclaim`, its document parsed. */
const auditDoc = (pre = ''): { code: number; stdout: string; stderr: string; doc: Record<string, unknown> } => {
  const r = h.run(`${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB} ${pre} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
  return { ...r, doc: JSON.parse(r.stdout) as Record<string, unknown> };
};
/** `ws-audit --session <id> --expire` over a fake process root, its document parsed. */
const expireDocOf = (id: string): { code: number; stdout: string; stderr: string; doc: Record<string, unknown> } => {
  const r = h.run(`${EXP_STUBS} ${FAKE_PROC_SELF} cmd_ws_audit --session ${id} --expire`);
  return { ...r, doc: JSON.parse(r.stdout) as Record<string, unknown> };
};
const expireVerbOf = (id: string, token: string): { code: number; stdout: string; stderr: string } =>
  h.run(`${EXP_STUBS} ${FAKE_PROC_SELF} ${CHILD_ENV} cmd_ws_expire --expect ${token} --session ${id}`);
/** Runs `script` inside the rows pass, between its last resolve and the identity walk: the window #2294's comment names. */
const atWalk = (script: string): string =>
  `f=$(declare -f _ws_reclaim_idwalk); eval "_ws_idwalk_real\${f#_ws_reclaim_idwalk}"; _ws_reclaim_idwalk() { ${script}; _ws_idwalk_real "$@"; };`;

describe('the ticket: one unresolvable row beside an unrelated finished child', () => {
  it('the child still reclaims, and the row, its name and the gone path are left exactly as they were', () => {
    const { c, o } = goneRow();
    const r = evalOf(h);
    placed(r, 'a gone row nothing runs for holds no unrelated child');
    const v = childReclaimVerb(h, r.token);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect((JSON.parse(v.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the child’s tree is gone').toBe(false);
    expect(fs.existsSync(o.wt), 'no directory was created at the gone path').toBe(false);
    expect(h.reg(OTHER, 'workdir'), 'the row stands: it only stopped holding').toBe(o.wt);
  }, 180_000);

  it('the ticket’s own row, with a legacy entry and no field at all: the audit answers reclaimable and the real verb reclaims', () => {
    const { c, o } = goneRow();
    fs.rmSync(path.join(REG(), `${OTHER}.workdirid`));
    const a = auditDoc();
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc['verdict'], String(a.doc['detail'])).toBe('reclaimable');
    expect(a.doc, 'the CONTROL: the row’s entry is legacy').toHaveProperty('legacyRows', 1);
    const v = childReclaimVerb(h, String(a.doc['token']));
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect((JSON.parse(v.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the child’s tree is gone').toBe(false);
    expect(fs.existsSync(o.wt), 'no directory was created at the gone path').toBe(false);
    expect(h.reg(OTHER, 'workdir'), 'the row stands: it only stopped holding').toBe(o.wt);
  }, 180_000);

  it('a parent gone too releases it: the absent part may be longer than the leaf, the standing part may not lie', () => {
    const { o } = goneRow();
    fs.rmSync(path.dirname(o.wt), { recursive: true, force: true });
    placed(evalOf(h), 'the row’s whole project directory is gone');
  }, 120_000);

  it('two vanished children with no record release each other', () => {
    const { c } = goneRow();
    fs.rmSync(c.wt, { recursive: true, force: true });
    h.git(c.main, 'worktree', 'prune');
    const r = rows(c.wt);
    expect([r.rc, r.why]).toEqual(['0', '']);
  }, 120_000);
});

describe('(c) and (d): something may run for the row', () => {
  it('a pane that is up keeps the hold', () => {
    goneRow();
    plantTmux(h, { sessions: [`cc-${OTHER}`] });
    held(evalOf(h), 'the row’s pane is up, somewhere ccd cannot place');
  }, 120_000);

  it.each(Object.entries(TMUX_FAULTS))('a tmux that could not be asked keeps the hold: %s', (label, fault) => {
    goneRow();
    // The rows rung alone: the child's own rung 5 meets the same fault and answers for itself.
    const r = rows(path.join(h.home, 'worktrees', 'demo', 'quiet-basin'), `tmux() { echo '${fault}' >&2; return 1; };`);
    expect(r.rc, label).toBe('2');
    expect(r.why).toContain(`registry row(s) ${OTHER} ${HELD}`);
  }, 120_000);

  it.each([
    ['an active unit', 'active'], ['a unit still starting', 'activating'], ['an answer it has no word for', 'reloading'],
    ['a service manager that answered nothing', ''],
  ])('%s keeps the hold', (label, word) => {
    goneRow();
    held(evalOf(h, { pre: `_svc_is_active() { [[ "$1" == *${OTHER}* ]] && printf '%s' '${word}' || printf inactive; };` }), label);
  }, 120_000);

  it('a failed unit is stopped: it is not restarted', () => {
    goneRow();
    placed(evalOf(h, { pre: `_svc_is_active() { [[ "$1" == *${OTHER}* ]] && printf failed || printf inactive; }; _svc_launchctl() { return 113; };` }), 'failed');
  }, 120_000);
});

describe('(a) and (b): the spelling must be plain, and the standing part must be what it says', () => {
  it('a link on the standing part keeps the hold', () => {
    const { o } = goneRow();
    fs.mkdirSync(path.join(h.home, 'real'));
    fs.symlinkSync(path.join(h.home, 'real'), path.join(h.home, 'wtlink'));
    const w = path.join(h.home, 'wtlink', 'gone', 'tree');
    fs.writeFileSync(path.join(REG(), `${OTHER}.workdir`), w);
    const r = evalOf(h);
    held(r, 'the row is spelled through a link that stands');
    expect(r.detail, 'by id only').not.toContain(w);
    fs.writeFileSync(path.join(REG(), `${OTHER}.workdir`), o.wt);
    placed(evalOf(h), 'the CONTROL: spelled physically, the same row is released');
  }, 120_000);

  it('answers 1 for each spelling and each thing standing at it, and 0 for the CONTROL', () => {
    const real = fs.realpathSync(h.home);
    const gone = path.join(real, 'worktrees', 'gone');
    fs.mkdirSync(path.join(real, 'worktrees'), { recursive: true });
    expect(quiet('some-row', gone), 'the CONTROL').toBe('0');
    expect(quiet('some-row', path.join(gone, 'deeper', 'still')), 'the CONTROL: more of it gone').toBe('0');
    expect(quiet('some-row', `${gone}/`), 'a trailing slash').toBe('1');
    expect(quiet('some-row', `${real}/worktrees//gone`), 'a double slash').toBe('1');
    expect(quiet('some-row', `${real}/worktrees/./gone`), 'a dot').toBe('1');
    expect(quiet('some-row', `${real}/worktrees/x/../gone`), 'a dot dot').toBe('1');
    expect(quiet('some-row', 'worktrees/gone'), 'a relative spelling').toBe('1');
    expect(h.sh(`${CHILD_STUBS} _ws_reclaim_gone_quiet some-row $'${gone}\\tx'; printf '%s' "$?"`), 'a control character').toBe('1');
    fs.mkdirSync(path.join(real, 'worktrees', 'stands'));
    expect(quiet('some-row', path.join(real, 'worktrees', 'stands')), 'a path that stands').toBe('1');
    fs.symlinkSync(path.join(real, 'nowhere'), path.join(real, 'worktrees', 'dangling'));
    expect(quiet('some-row', path.join(real, 'worktrees', 'dangling')), 'a dangling link at the path').toBe('1');
    expect(quiet('some-row', path.join(real, 'worktrees', 'dangling', 'below')), 'a dangling link on the path').toBe('1');
  }, 60_000);

  it('never disturbs the probe’s globals, which the ladder’s own rung reads', () => {
    const gone = path.join(fs.realpathSync(h.home), 'gone');
    expect(h.sh(`${CHILD_STUBS} PROBE_VERDICT=live; PROBE_DETAIL=kept; PROBE_SUBSTRATE=present;`
      + ` _ws_reclaim_gone_quiet some-row '${gone}'; printf '%s %s %s %s' "$?" "$PROBE_VERDICT" "$PROBE_DETAIL" "$PROBE_SUBSTRATE"`))
      .toBe('0 live kept present');
  });
});

describe('the release’s other conditions', () => {
  it.each([
    ['a pending field: a spawn that never recorded where it entered', (w: string): string => `v1\tpending\t${AT}\t-\t${w}`,
      'began a spawn that never recorded where its pane entered'],
  ])('%s keeps holding, by its own sentence', (label, body, needle) => {
    const { o } = goneRow();
    fs.writeFileSync(path.join(REG(), `${OTHER}.workdirid`), body(o.wt));
    const r = evalOf(h);
    expect(r.verdict, `${label}: ${r.detail}`).toBe('unmeasured');
    expect(r.detail).toContain(needle);
    // Held twice: the field's own bucket, and the row it left unresolved.
    expect(r.detail).toContain(`registry row(s) ${OTHER} ${HELD}`);
  }, 120_000);

  it('an unreadable field keeps holding', () => {
    const { o } = goneRow();
    const f = path.join(REG(), `${OTHER}.workdirid`);
    fs.rmSync(f, { force: true });
    fs.mkdirSync(f);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) ${OTHER} ${HELD}`);
    expect(r.detail).toContain('have an entry-identity field that is not a regular file');
    fs.rmdirSync(f);
    fs.writeFileSync(path.join(REG(), `${OTHER}.workdir`), o.wt);
    placed(evalOf(h), 'the CONTROL: no field is `legacy-absent`, which the arm releases');
  }, 120_000);

  it('a row under the child’s RESOLVED spelling is never released: the child’s own spelling goes through a link, so `lit` misses it', () => {
    const c = makeChild(h);
    const real = fs.realpathSync(c.wt);
    fs.symlinkSync(path.dirname(real), path.join(h.home, 'alias'));
    const wd = path.join(h.home, 'alias', path.basename(c.wt));
    handRow(OTHER, path.join(real, 'gone-in-the-child'));
    const r = rows(wd);
    expect(r.rc, r.why).toBe('2');
    expect(r.why).toContain(`registry row(s) ${OTHER} ${HELD}`);
    const control = path.join(path.dirname(real), 'gone-beside-the-child');
    handRow(OTHER, control);
    expect(rows(wd).rc, 'the CONTROL: a sibling of it is released').toBe('0');
  }, 120_000);

  it('a row under a leaf’s RESOLVED spelling is never released', () => {
    const c = makeChild(h);
    const tmp = path.join(fs.realpathSync(h.home), 'tmp-real');
    fs.mkdirSync(path.join(tmp, CHILD_ID), { recursive: true });
    fs.rmSync(path.join(h.home, '.cc-tmp'), { recursive: true, force: true });
    fs.symlinkSync(tmp, path.join(h.home, '.cc-tmp'));
    handRow(OTHER, path.join(tmp, CHILD_ID, 'gone'));
    const r = rows(c.wt);
    expect(r.rc, r.why).toBe('2');
    expect(r.why).toContain(`registry row(s) ${OTHER} ${HELD}`);
    handRow(OTHER, path.join(tmp, 'gone-beside-the-leaf'));
    expect(rows(c.wt).rc, 'the CONTROL: beside the leaf it is released').toBe('0');
  }, 120_000);

  it('a released row keeps its entry rules: a valid field that entered the child still refuses it', () => {
    const { c, o } = goneRow();
    const inside = path.join(fs.realpathSync(c.wt), 'server');
    fs.mkdirSync(inside);
    const ident = h.sh(`_ws_path_ident '${inside}'; printf '%s' "$_WS_IDENT"`);
    fs.writeFileSync(path.join(REG(), `${OTHER}.workdirid`), `v1\t${ident}\t${AT}\t${inside}\t${o.wt}`);
    const r = rows(c.wt);
    expect(r.nested, 'only `unres` is skipped; nothing leaves a bucket').toBe(OTHER);
    const a = evalOf(h);
    expect(a.verdict, a.detail).toBe('containment-unproven');
  }, 120_000);

  it('a gone row literally in the child is refused by the literal arms, whatever runs for it', () => {
    const c = makeChild(h);
    handRow(OTHER, path.join(c.wt, 'gone'));
    const r = rows(c.wt);
    expect(r.nested).toBe(OTHER);
  }, 60_000);

  it('it keeps nothing for the moved-check: the release is no placement', () => {
    const { c } = goneRow();
    expect(rows(c.wt).ids).toBe('');
  }, 120_000);
});

describe('no checkout at all under the child or a leaf: a moved tree the moved-check cannot see', () => {
  /** The row's tree moved to `dest`, with git's record of it gone too: nothing names it, so only the scan finds it. */
  const movedTo = (dest: (c: Child) => string): { c: Child; dest: string } => {
    const c = makeChild(h);
    const o = other();
    const to = dest(c);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(o.wt, to);
    h.git(o.main, 'worktree', 'prune');
    expect(stanza(o.main, o.wt), 'the CONTROL: git records nothing of it').toBe('');
    expect(fs.existsSync(path.join(to, '.git')), 'the CONTROL: its .git moved with it').toBe(true);
    return { c, dest: to };
  };

  it.each([
    ['inside the child', (c: Child): string => path.join(c.wt, 'moved')],
    ['deep inside the child', (c: Child): string => path.join(c.wt, 'a', 'b', 'moved')],
    ['inside the temp root', (): string => path.join(leaf('.cc-tmp'), 'moved')],
    ['inside the clips directory', (): string => path.join(leaf('.cc-clips'), 'moved')],
    ['AS the temp root', (): string => leaf('.cc-tmp')],
    ['AS the clips directory', (): string => leaf('.cc-clips')],
  ])('%s holds, at the ladder and at the tail', (label, dest) => {
    const { c } = movedTo(dest);
    const r = evalOf(h);
    held(r, label, `registry row(s) ${OTHER} ${QUIET_HELD}`);
    const t = owned(c);
    expect(t.rc, `${label}: ${t.why}`).toBe('2');
    expect(t.why).toContain(QUIET_HELD);
  }, 120_000);

  it('a checkout of another kind holds too, a plain `.git` directory included', () => {
    const { c } = goneRow();
    const clone = path.join(c.wt, 'vendor', 'lib');
    fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
    held(evalOf(h), 'no checkout at all may stand there', `registry row(s) ${OTHER} ${QUIET_HELD}`);
    fs.rmSync(path.join(c.wt, 'vendor'), { recursive: true });
    placed(evalOf(h), 'the CONTROL: with it gone the row is released');
  }, 120_000);

  it('a child it cannot scan holds, never "no checkout"', (ctx) => {
    if (process.getuid?.() === 0) { ctx.skip(); return; }
    const { c } = goneRow();
    const shut = path.join(c.wt, 'shut');
    fs.mkdirSync(shut);
    fs.chmodSync(shut, 0o000);
    try {
      const r = rows(c.wt);
      expect(r.rc, r.why).toBe('2');
      expect(r.why).toContain(QUIET_HELD);
      expect(r.why).toContain('could not be scanned');
    } finally { fs.chmodSync(shut, 0o755); }
    expect(rows(c.wt).rc, 'the CONTROL: readable, the scan answers').toBe('0');
  }, 120_000);

  it('the scan is not asked when no row was released: a child with a checkout of its own beside a recorded gone row answers as before', () => {
    const c = makeChild(h);
    const o = other();
    fs.rmSync(o.wt, { recursive: true, force: true });
    expect(stanza(o.main, o.wt), 'the CONTROL: git keeps the record, prunable').toContain('\nprunable');
    fs.mkdirSync(path.join(c.wt, 'vendor', 'lib', '.git'), { recursive: true });
    const r = rows(c.wt);
    expect([r.rc, r.why], 'the recorded arm places it, so nothing here is asked').toEqual(['0', '']);
  }, 120_000);

  it('the stated limit, gone-row-release-misses-a-tree-with-no-git: a stopped row’s tree that was never a checkout has no .git to find', () => {
    const { c } = goneRow();
    fs.mkdirSync(path.join(c.wt, 'moved-plain-tree'));
    fs.writeFileSync(path.join(c.wt, 'moved-plain-tree', 'notes.txt'), 'no session is in it: nothing runs for its row\n');
    expect(rows(c.wt).rc).toBe('0');
  }, 120_000);

  describe('the stated limit through the real verb: each tree with no `.git` of its own, and what the pin keeps of it', () => {
    const ROW = 'demo3-plain-tree';
    const KEPT = 'kept.txt';
    const IGNORED = 'notes.local';
    /** A tree a stopped session left: one file git would add, one it ignores. */
    const fill = (dir: string): void => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.gitignore'), `${IGNORED}\n`);
      fs.writeFileSync(path.join(dir, KEPT), 'what git would add\n');
      fs.writeFileSync(path.join(dir, IGNORED), 'what git would not\n');
    };
    /** Each answers the spelling the row keeps, with the tree standing there as a stopped session left it. */
    const SHAPES: ReadonlyArray<readonly [string, () => string]> = [
      ['a row that was never a checkout', (): string => {
        const was = path.join(h.home, 'plain-tree');
        fill(was);
        return was;
      }],
      ['a subdirectory of a checkout moved alone', (): string => {
        const was = path.join(other().wt, 'sub');
        fill(was);
        return was;
      }],
      ['a checkout stripped of its `.git`', (): string => {
        const was = other().wt;
        fs.rmSync(path.join(was, '.git'));
        fill(was);
        return was;
      }],
    ];
    const reclaimed = (make: () => string, to: 'child' | 'leaf'): { c: Child; wip: string } => {
      const c = makeChild(h);
      const was = make();
      // The clips leaf: the tail's in-use probe of a temp root cannot be asked on every platform this suite runs on.
      const dest = to === 'child' ? path.join(c.wt, 'moved') : path.join(leaf('.cc-clips'), 'moved');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(was, dest);
      handRow(ROW, was);
      const r = evalOf(h);
      placed(r, 'nothing here has a `.git` to find');
      const v = childReclaimVerb(h, r.token);
      expect(v.code, v.stdout + v.stderr).toBe(0);
      expect(fs.existsSync(dest), 'the tree went with the child').toBe(false);
      expect(h.reg(ROW, 'workdir'), 'the row stands').toBe(was);
      expect(fs.existsSync(was), 'no directory was created at the gone path').toBe(false);
      return { c, wip: (JSON.parse(v.stdout) as { wip: string | null }).wip ?? '' };
    };
    const noCopy = (name: string): void => {
      expect(h.sh(`find '${h.home}' -name '${name}' -not -path '*/.git/*'`), `no copy of ${name} under HOME`).toBe('');
    };

    it.each(SHAPES)('%s, moved into the child: the pin keeps what git would add, and never an ignored file', (_label, make) => {
      const { c, wip } = reclaimed(make, 'child');
      expect(wip, 'the CONTROL: the pin ran').toMatch(/^[0-9a-f]{40}$/);
      const pinned = h.git(c.main, 'ls-tree', '-r', '--name-only', wip).split('\n');
      expect(pinned).toContain(`moved/${KEPT}`);
      expect(pinned).not.toContain(`moved/${IGNORED}`);
      noCopy(IGNORED);
    }, 180_000);

    it.each(SHAPES)('%s, moved into a leaf: nothing in a leaf is ever pinned', (_label, make) => {
      const { c } = reclaimed(make, 'leaf');
      expect(h.git(c.main, 'rev-list', '--all', '--objects'), 'in no tree on any ref').not.toContain(KEPT);
      noCopy(KEPT);
      noCopy(IGNORED);
    }, 180_000);
  });

  it('a link at a leaf is unlinked, never followed, so nothing behind it is scanned', () => {
    const { c } = goneRow();
    const elsewhere = path.join(h.home, 'elsewhere', 'moved');
    fs.mkdirSync(path.join(elsewhere, '.git'), { recursive: true });
    fs.mkdirSync(path.dirname(leaf('.cc-tmp')), { recursive: true });
    fs.symlinkSync(path.dirname(elsewhere), leaf('.cc-tmp'));
    expect(rows(c.wt).why).toBe('');
  }, 120_000);

  it('the collector asks it of the leaf it would remove, whose own root is no child’s tree', () => {
    const c = makeChild(h);
    const o = other();
    fs.rmSync(o.wt, { recursive: true, force: true });
    h.git(o.main, 'worktree', 'prune');
    fs.rmSync(path.join(REG(), `${CHILD_ID}.workdir`));   // the collector's population: a dead child, its row gone
    fs.rmSync(c.wt, { recursive: true, force: true });
    const ask = (): string => h.sh(`${CHILD_STUBS} _ws_reclaim_contained _ws_collect_rows_clear ${CHILD_ID} '${leaf('.cc-tmp')}'; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_COLLECT_ROWS_WHY"`);
    fs.mkdirSync(leaf('.cc-tmp'), { recursive: true });
    expect(ask(), 'the CONTROL: an empty temp root is clear').toBe('0\x1f');
    fs.mkdirSync(path.join(leaf('.cc-tmp'), '.git'));
    const [rc = '', why = ''] = ask().split('\x1f');
    expect(rc, why).toBe('2');
    expect(why).toContain(QUIET_HELD);
  }, 120_000);

  it('the loose arm asks it of the entry, whose own root is no child’s tree', () => {
    const { o } = { o: other() };
    fs.rmSync(o.wt, { recursive: true, force: true });
    h.git(o.main, 'worktree', 'prune');
    const entry = path.join(h.home, 'loose-entry');
    fs.mkdirSync(entry);
    const ask = (): string => h.sh(`${CHILD_STUBS} _ws_reclaim_contained _ws_loose_rows loose-entry '${entry}'; rc=$?; printf '%s\\x1f%s' "$rc" "$_WS_LOOSE_WHY"`);
    expect(ask(), 'the CONTROL: an entry that is no checkout is clear').toBe('0\x1f');
    fs.mkdirSync(path.join(entry, '.git'));
    const [rc = '', why = ''] = ask().split('\x1f');
    expect(rc, why).toBe('2');
    expect(why).toContain(QUIET_HELD);
  }, 120_000);
});

describe('the second shape: a row that goes during the walk', () => {
  /** The child and a standing row, which is what the rows pass resolves `complete` before the seam runs. */
  const standing = (): { c: Child; o: { main: string; wt: string } } => {
    const c = makeChild(h);
    const o = other();
    placed(evalOf(h), 'the CONTROL: the row stands, placed outside');
    return { c, o };
  };
  const rmTree = (o: { wt: string }): string => `rm -rf '${o.wt}'`;

  it('a row purged whole is dropped, as the listing arm drops it, and asks its entry rules nothing', () => {
    const { c, o } = standing();
    const r = rows(c.wt, atWalk(`${rmTree(o)}; rm -f "$REG/${OTHER}".*`));
    expect([r.rc, r.why]).toEqual(['0', '']);
  }, 120_000);

  it('a purged row’s entry field places nothing: it is no row any more', () => {
    const { c, o } = standing();
    const inside = path.join(fs.realpathSync(c.wt), 'server');
    fs.mkdirSync(inside);
    const ident = h.sh(`_ws_path_ident '${inside}'; printf '%s' "$_WS_IDENT"`);
    fs.writeFileSync(path.join(REG(), `${OTHER}.workdirid`), `v1\t${ident}\t${AT}\t${inside}\t${o.wt}`);
    expect(rows(c.wt).nested, 'the CONTROL: while it stands, its field places it inside').toBe(OTHER);
    const r = rows(c.wt, atWalk(`${rmTree(o)}; rm -f "$REG/${OTHER}".*`));
    expect([r.rc, r.nested, r.why]).toEqual(['0', '', '']);
  }, 120_000);

  it('a row whose `.workdir` cannot be read now is one that was not read', () => {
    const { c, o } = standing();
    const f = path.join(REG(), `${OTHER}.workdir`);
    const r = rows(c.wt, atWalk(`${rmTree(o)}; rm -f '${f}'; ln -s '${path.join(h.home, 'nowhere')}' '${f}'`));
    expect(r.rc).toBe('2');
    expect(r.why).toContain(`could not read ${f}`);
    expect(r.why).not.toContain(UNWALK);
  }, 120_000);

  it('a row respelled during the walk was never asked: it holds', () => {
    const { c, o } = standing();
    const f = path.join(REG(), `${OTHER}.workdir`);
    const r = rows(c.wt, atWalk(`${rmTree(o)}; printf '%s' '${path.join(h.home, 'elsewhere')}' > '${f}'`));
    expect(r.rc).toBe('2');
    expect(r.why).toContain(`${UNWALK} ${OTHER}`);
  }, 120_000);

  it('a tree git recorded is placed by that record, and kept for the moved-check', () => {
    const { c, o } = standing();
    const r = rows(c.wt, atWalk(rmTree(o)));
    expect([r.rc, r.why]).toEqual(['0', '']);
    expect(r.ids, 'its admin directory and its entry identity are kept').toContain(`${OTHER}\t`);
  }, 120_000);

  it('a tree git has no record of, its row quiet, is released, and the release asks for no checkout', () => {
    const { c, o } = standing();
    const inner = path.join(c.wt, 'vendor', 'lib', '.git');
    const pruned = `${rmTree(o)}; git -C '${o.main}' worktree prune`;
    const r = rows(c.wt, atWalk(pruned));
    expect([r.rc, r.why, r.ids]).toEqual(['0', '', '']);
    fs.mkdirSync(inner, { recursive: true });
    const g = rows(c.wt, atWalk(`mkdir -p '${o.wt}'; ${pruned}`));
    expect(g.rc).toBe('2');
    expect(g.why).toContain(`registry row(s) ${OTHER} ${QUIET_HELD}`);
  }, 120_000);

  it('a gone tree whose pane is up holds, as a walk that did not answer', () => {
    const { c, o } = standing();
    plantTmux(h, { sessions: [`cc-${OTHER}`] });
    const r = rows(c.wt, atWalk(`${rmTree(o)}; git -C '${o.main}' worktree prune`));
    expect(r.rc).toBe('2');
    expect(r.why).toContain(`${UNWALK} ${OTHER}`);
  }, 120_000);

  it('a pending field keeps holding what the walk found gone', () => {
    const { c, o } = standing();
    fs.writeFileSync(path.join(REG(), `${OTHER}.workdirid`), `v1\tpending\t${AT}\t-\t${o.wt}`);
    const r = rows(c.wt, atWalk(`${rmTree(o)}; git -C '${o.main}' worktree prune`));
    expect(r.rc).toBe('2');
    expect(r.why).toContain(`${UNWALK} ${OTHER}`);
  }, 120_000);

  it('a walk that found it gone while its spelling resolves whole again holds: it was never asked', () => {
    const { c, o } = standing();
    // The walk answers `gone` for a path that stands by the time the pass reads the reply.
    const seam = `f=$(declare -f _ws_reclaim_idwalk); eval "_ws_idwalk_real\${f#_ws_reclaim_idwalk}";`
      + ` _ws_reclaim_idwalk() { mv '${o.wt}' '${o.wt}.away'; _ws_idwalk_real "$@"; local r=$?; mv '${o.wt}.away' '${o.wt}'; return $r; };`;
    const r = rows(c.wt, seam);
    expect(r.rc).toBe('2');
    expect(r.why).toContain(`${UNWALK} ${OTHER}`);
  }, 120_000);

  it('a recorded placement here is compared as the pass compares one: inside the child it is NESTED', () => {
    const { c, o } = standing();
    const inside = path.join(fs.realpathSync(c.wt), 'a-tree');
    const r = rows(c.wt, `${atWalk(rmTree(o))} _ws_reclaim_recorded() { _WS_RECORDED_AT='${inside}'; _WS_RECORDED_G=''; return 0; };`);
    expect([r.rc, r.nested]).toEqual(['0', OTHER]);
  }, 120_000);

  it('a recorded placement at the child is SHARED, and in a leaf NESTED', () => {
    const { c, o } = standing();
    const real = fs.realpathSync(c.wt);
    const r = rows(c.wt, `${atWalk(rmTree(o))} _ws_reclaim_recorded() { _WS_RECORDED_AT='${real}'; _WS_RECORDED_G=''; return 0; };`);
    expect([r.rc, r.shared]).toEqual(['0', OTHER]);
    fs.mkdirSync(leaf('.cc-tmp'), { recursive: true });
    const inLeaf = path.join(fs.realpathSync(leaf('.cc-tmp')), 'x');
    fs.mkdirSync(o.wt, { recursive: true });
    const l = rows(c.wt, `${atWalk(rmTree(o))} _ws_reclaim_recorded() { _WS_RECORDED_AT='${inLeaf}'; _WS_RECORDED_G=''; return 0; };`);
    expect([l.rc, l.nested]).toEqual(['0', OTHER]);
  }, 120_000);
});

describe('a pane that comes up after the audit: the tail asks again', () => {
  it('`_ws_reclaim_owned` answers 2, and the same row with no pane answers 0', () => {
    const { c } = goneRow();
    placed(evalOf(h), 'the audit released it');
    expect(owned(c).rc, 'the CONTROL: nothing has changed since the audit').toBe('0');
    plantTmux(h, { sessions: [`cc-${OTHER}`] });
    const t = owned(c);
    expect(t.rc, t.why).toBe('2');
    expect(t.why).toContain(`registry row(s) ${OTHER} ${HELD}`);
  }, 120_000);

  it('the verb’s own tail asks it: a pane up at the ownership check stops the reclaim with the tree standing, resumably', () => {
    const { c } = goneRow();
    const r = evalOf(h);
    placed(r, 'the audit released it');
    // Past the audit and the locked recomputation, so only the tail's own ask can see it.
    const paneAtTail = `f=$(declare -f _ws_reclaim_owned); eval "_ws_owned_real\${f#_ws_reclaim_owned}";`
      + ` _ws_reclaim_owned() { echo 'cc-${OTHER}' >> "$HOME/tmux-sessions"; _ws_owned_real "$@"; };`;
    const v = childReclaimVerb(h, r.token, { pre: paneAtTail });
    expect(v.code, v.stdout + v.stderr).not.toBe(0);
    expect(JSON.parse(v.stdout) as Record<string, unknown>).toHaveProperty('failed', 'worktree-remove-failed');
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
  }, 180_000);
});

describe('two gone stopped rows, and the expiry of each', () => {
  const SECOND = 'demo3-gone-mesa';
  /** Stamps the archive on a row `makeArchived` did not build. */
  const archive = (id: string): void => {
    fs.writeFileSync(path.join(REG(), `${id}.archived`), `${NOW - 8 * 86_400}\n`);
    fs.writeFileSync(path.join(REG(), `${id}.archivedreason`), 'operator\n');
    fs.writeFileSync(path.join(REG(), `${id}.archivemanifest`), '{"paths":[]}\n');
  };
  /** Two archived workspaces of two repositories, each tree gone, and git's record of each gone with it. */
  const twoArchivedGone = (): { a: { main: string; wt: string }; b: { main: string; wt: string } } => {
    const a = makeArchived(h);
    const b = other();
    archive(OTHER);
    for (const r of [a, b]) {
      fs.rmSync(r.wt, { recursive: true, force: true });
      h.git(r.main, 'worktree', 'prune');
      expect(stanza(r.main, r.wt), 'the CONTROL: git records nothing of it').toBe('');
    }
    return { a, b };
  };

  it('a child beside two of them reclaims, and the audit names both', () => {
    goneRow();
    handRow(SECOND, path.join(fs.realpathSync(h.home), 'worktrees', 'gone-too'));
    const d = auditDoc();
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('reclaimable');
    expect((d.doc['quietRows'] as string[]).slice().sort()).toEqual([OTHER, SECOND].sort());
    const v = childReclaimVerb(h, String(d.doc['token']));
    expect(v.code, v.stdout + v.stderr).toBe(0);
  }, 180_000);

  it('each is the other’s gone row: both audits answer expirable, and each names the other', () => {
    twoArchivedGone();
    const first = expireDocOf(EXP_ID);
    expect(first.doc['verdict'], String(first.doc['detail'])).toBe('expirable');
    expect(first.doc['quietRows']).toEqual([OTHER]);
    const second = expireDocOf(OTHER);
    expect(second.doc['verdict'], String(second.doc['detail'])).toBe('expirable');
    expect(second.doc['quietRows']).toEqual([EXP_ID]);
  }, 180_000);

  it('the verb expires each in turn, the first with the second still gone beside it', () => {
    twoArchivedGone();
    for (const id of [EXP_ID, OTHER]) {
      const d = expireDocOf(id);
      expect(d.doc['verdict'], String(d.doc['detail'])).toBe('expirable');
      const v = expireVerbOf(id, String(d.doc['token']));
      expect(v.code, v.stdout + v.stderr).toBe(0);
      expect(JSON.parse(v.stdout) as Record<string, unknown>).toHaveProperty('expired', id);
    }
  }, 240_000);

  it('an archived tree that stands expires beside a gone stopped row, and that row’s gone path stays gone', () => {
    const a = makeArchived(h);
    const o = other();
    fs.rmSync(o.wt, { recursive: true, force: true });
    h.git(o.main, 'worktree', 'prune');
    const d = expireDocOf(EXP_ID);
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('expirable');
    const v = expireVerbOf(EXP_ID, String(d.doc['token']));
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(fs.existsSync(a.wt), 'the archived tree went').toBe(false);
    expect(fs.existsSync(o.wt), 'no directory was created at the gone path').toBe(false);
    expect(h.reg(OTHER, 'workdir'), 'the row stands: it only stopped holding').toBe(o.wt);
  }, 180_000);

  it('a pane up for the gone row keeps holding the expiry', () => {
    makeArchived(h);
    const o = other();
    fs.rmSync(o.wt, { recursive: true, force: true });
    h.git(o.main, 'worktree', 'prune');
    plantTmux(h, { sessions: [`cc-${OTHER}`] });
    const d = expireDocOf(EXP_ID);
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('unmeasured');
    expect(String(d.doc['detail'])).toContain(`registry row(s) ${OTHER} ${HELD}`);
    expect(d.doc['quietRows']).toEqual([]);
  }, 180_000);
});

describe('the audit trail: every release is named in the audit document', () => {
  it('a reclaimable document names the row, and the parser reads it exactly as it reads one without the key', () => {
    goneRow();
    const d = auditDoc();
    expect(d.code, d.stderr).toBe(0);
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('reclaimable');
    expect(d.doc['quietRows']).toEqual([OTHER]);
    const parsed = parseChildReclaimAudit(CHILD_ID, d.stdout);
    expect(parsed.kind).toBe('token');
    expect(parsed).toEqual(parseChildReclaimAudit(CHILD_ID, withoutQuietRows(d.stdout)));
  }, 120_000);

  it('the key sits beside the counts, and asks nothing of the token', () => {
    goneRow();
    const keys = Object.keys(auditDoc().doc);
    expect(keys.slice(keys.indexOf('legacyRows'), keys.indexOf('legacyRows') + 3)).toEqual(['legacyRows', 'pendingRows', 'quietRows']);
  }, 120_000);

  it('a child with no gone row names none: an empty list, never a missing key', () => {
    makeChild(h);
    expect(auditDoc().doc['quietRows']).toEqual([]);
  }, 120_000);

  it('a row that keeps holding is not named: nothing was released', () => {
    goneRow();
    plantTmux(h, { sessions: [`cc-${OTHER}`] });
    const d = auditDoc(`_session_probe() { if [[ "$1" == ${OTHER} ]]; then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; };`);
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('unmeasured');
    expect(d.doc['quietRows']).toEqual([]);
    const failed = parseChildReclaimAuditFailed(CHILD_ID, d.stdout, d.stderr);
    expect(failed).toEqual(parseChildReclaimAuditFailed(CHILD_ID, withoutQuietRows(d.stdout), d.stderr));
  }, 120_000);

  it('a checkout under the child takes the release back: the row was not let go, so it is not named', () => {
    const { c } = goneRow();
    fs.mkdirSync(path.join(c.wt, 'vendor', 'lib', '.git'), { recursive: true });
    const d = auditDoc();
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('unmeasured');
    expect(String(d.doc['detail'])).toContain(QUIET_HELD);
    expect(d.doc['quietRows']).toEqual([]);
    expect(rows(c.wt).quietRows).toBe('');
  }, 120_000);

  it('a refusal outranks the release, and the scan was never asked: none is named', () => {
    const { c } = goneRow();
    handRow('demo3-inside', path.join(c.wt, 'gone'));
    const d = auditDoc();
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('containment-unproven');
    expect(d.doc['quietRows']).toEqual([]);
  }, 120_000);

  it('one row released beside one that holds: the hold answers, and the release is still named', () => {
    goneRow();
    const gone = path.join(fs.realpathSync(h.home), 'worktrees', 'gone-too');
    handRow('demo3-running', gone);
    const d = auditDoc('_svc_is_active() { [[ "$1" == *demo3-running* ]] && printf active || printf inactive; };');
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('unmeasured');
    expect(String(d.doc['detail'])).toContain(`registry row(s) demo3-running ${HELD}`);
    expect(d.doc['quietRows']).toEqual([OTHER]);
  }, 120_000);

  it('not counted is null, as the counts are: a ladder that stops before the rows rung', () => {
    goneRow();
    fs.rmSync(path.join(REG(), `${CHILD_ID}.child`));
    const d = auditDoc();
    expect(d.doc['verdict']).toBe('not-a-child');
    expect(d.doc['quietRows']).toBeNull();
  }, 120_000);

  it('not counted is null: a registry that cannot be listed', () => {
    goneRow();
    const d = auditDoc('find() { [[ "$*" == *"-name *.workdir"* ]] && return 1; command find "$@"; };');
    expect(String(d.doc['detail'])).toContain('could not list');
    expect(d.doc['quietRows']).toBeNull();
  }, 120_000);

  it('a row released where the walk found it gone is named too', () => {
    const c = makeChild(h);
    const o = other();
    placed(evalOf(h), 'the CONTROL: the row stands, placed outside');
    const r = rows(c.wt, atWalk(`rm -rf '${o.wt}'; git -C '${o.main}' worktree prune`));
    expect([r.rc, r.quietRows]).toEqual(['0', OTHER]);
  }, 120_000);

  it('every pass starts clean, and so does the ladder’s reset', () => {
    const { c } = goneRow();
    expect(h.sh(`${CHILD_STUBS} _WS_QUIET_ROWS=stale; _ws_reclaim_reset; printf '[%s]' "$_WS_QUIET_ROWS"`)).toBe('[]');
    fs.rmSync(path.join(REG(), `${OTHER}.workdir`));
    expect(rows(c.wt, '_WS_QUIET_ROWS=stale;').quietRows).toBe('');
  }, 120_000);

  it('`_ws_quiet_rows_json` prints each id through `_json_str`, and null when the rung did not count', () => {
    const ask = (pre: string): string => h.sh(`${pre} _ws_quiet_rows_json`);
    expect(ask("_WS_LEGACY_ROWS=''; _WS_QUIET_ROWS=''")).toBe('null');
    expect(ask("_WS_LEGACY_ROWS=0; _WS_QUIET_ROWS=''")).toBe('[]');
    expect(ask("_WS_LEGACY_ROWS=0; _WS_QUIET_ROWS='row-a'")).toBe('["row-a"]');
    expect(JSON.parse(ask("_WS_LEGACY_ROWS=2; _WS_QUIET_ROWS='row-a, row\"b, row-c'"))).toEqual(['row-a', 'row"b', 'row-c']);
  });

  it('the expire document carries it too, and its parser reads it as before', () => {
    makeArchived(h);
    const o = other();
    fs.rmSync(o.wt, { recursive: true, force: true });
    h.git(o.main, 'worktree', 'prune');
    const d = expireDocOf(EXP_ID);
    expect(d.doc['verdict'], String(d.doc['detail'])).toBe('expirable');
    expect(d.doc['quietRows']).toEqual([OTHER]);
    expect(parseExpireAudit(EXP_ID, true, d.stdout)).toEqual(parseExpireAudit(EXP_ID, true, withoutQuietRows(d.stdout)));
  }, 180_000);
});

describe('_ws_unit_stopped: the one read of "is this unit stopped"', () => {
  const ask = (pre: string): string =>
    h.sh(`${pre} _ws_unit_stopped some-row; printf '%s|%s|%s' "$?" "$_WS_UNIT_WORD" "$_WS_UNIT_WHY"`);
  const darwin = (out: string, rc: number): string =>
    `CCD_OS=darwin; _svc_is_active() { printf failed; }; _svc_launchctl() { printf '%s' '${out}'; return ${rc}; };`;

  it.each([
    ['inactive', '0||'], ['failed', '0||'],
    ['active', '1|active|'], ['activating', '1|activating|'], ['unknown', '1|unknown|'],
  ])('answers %s', (word, want) => {
    expect(ask(`CCD_OS=linux; _svc_is_active() { printf '%s' '${word}'; };`)).toBe(want);
  });

  it('an empty answer is the manager not answering', () => {
    expect(ask('CCD_OS=linux; _svc_is_active() { :; };'))
      .toBe('2||whether claude-session@some-row is running could not be asked — the service manager answered nothing');
  });

  it('on Darwin a `failed` stamp stands only behind launchd’s exit 113', () => {
    expect(ask(darwin('Could not find service', 113))).toBe('0||');
    expect(ask(darwin('state = running', 0))).toBe('1|running|');
    expect(ask(darwin('state = waiting', 0))).toBe('1|loaded|');
    expect(ask(darwin('', 1)).startsWith('2||claude-session@some-row answered \'failed\' from its stamp')).toBe(true);
  });

  it('holds no word of its own: its two callers say what the answer means', () => {
    const src = ccdSource();
    const from = src.indexOf('\n_ws_unit_stopped() {');
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('\n}\n', from));
    expect(body).not.toContain('_ws_refuse');
    expect(body).not.toContain('_ws_reclaim_unmeasured');
  });
});

describe('the records state the release, the exception it makes and what it costs', () => {
  const ROOT = path.resolve(import.meta.dirname, '..', '..');
  const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\s+/g, ' ');
  const between = (s: string, from: string, to: string): string => {
    const at = s.indexOf(from);
    expect(at, `${from} is missing`).toBeGreaterThan(-1);
    const end = s.indexOf(to, at + 1);
    expect(end, `${to} must follow ${from}`).toBeGreaterThan(at);
    return s.slice(at, end);
  };
  const AMENDED = '**Amended by the gone-row release (2026-11-05, #2294, D-8019).**';
  const contract = read('docs/superpowers/programs/child-reclamation-contract.md');
  const spec = read('docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md');
  const unwedge = read('docs/superpowers/specs/2026-11-04-cleanup-unwedge-design.md');
  const header = ccdSource().split('\n').filter((l) => l.startsWith('  #')).map((l) => l.replace(/^ *# ?/, '')).join(' ');

  it('R31 says, beside the words it keeps, that process state is an input here and that the cost narrowed', () => {
    const r31 = between(contract, '- **R31 —', '- **R32 —');
    const at = r31.indexOf(AMENDED);
    expect(at, 'R31 carries no amendment').toBeGreaterThan(-1);
    const a = r31.slice(at);
    expect(a).toContain('"is not an input"');
    expect(a).toContain('"Holds every child\'s reclaim"');
    expect(a).toContain('release each other');
    expect(a).toContain('a purge or a restored link');
    expect(r31.slice(0, at), 'the amendment follows the bullets it amends').toContain('hold each other');
  });

  it('R94 and its as-built note both name the one place process state does more than refuse', () => {
    const r94 = between(contract, '- **R94 — R31 amended', '- **R95 —');
    expect(r94).toContain(AMENDED);
    expect(r94).toContain('turn a hold into a removal');
    expect(between(contract, '**R94 as built (process state may only refuse).**', '**R54 as W3 leaves it')).toContain('turn a hold into a removal');
  });

  it.each([
    ['the spec', (): string => between(spec, '**The residual, stated plainly', '- **A `complete` resolution places the spelling')],
    ['the rung header', (): string => between(header, 'WHAT THIS DOES NOT SEE', 'NOR AT, INSIDE OR THROUGH A LEAF')],
    ['the contract', (): string => between(contract, '- **R31 —', '- **R32 —')],
  ])('%s states the residual whole: every shape with no `.git` of its own, and what the pin does not keep', (_label, text) => {
    const t = text();
    expect(t).toContain('gone-row-release-misses-a-tree-with-no-git');
    for (const shape of ['a link now gone', 'never a checkout', 'a subdirectory of a checkout moved alone', 'stripped of its `.git`']) {
      expect(t, shape).toContain(shape);
    }
    expect(t).toContain('ignored file');
    expect(t).toContain('leaf');
  });

  it('no record says a tree with no `.git` is excluded by the scan', () => {
    expect(unwedge).not.toContain('With no checkout there no moved tree is');
    expect(spec).not.toContain('with no checkout there no moved tree is');
    expect(header).not.toContain('With no checkout there, no moved tree is');
  });

  it('D6 asks the operator about the exception and the residual, not only the narrowing', () => {
    const open = between(unwedge, '- D6: ccd\'s hold for rows with no durable record', '- D12:');
    expect(open).toContain('R94');
    expect(open).toContain('gone-row-release-misses-a-tree-with-no-git');
  });
});

describe('what the quiet arm never does', () => {
  it('its bodies create, prune, purge and write nothing', () => {
    const src = ccdSource();
    const FORBIDDEN: readonly [string, RegExp][] = [
      ['creates a directory', /\bmkdir\b/],
      ['prunes git’s records', /\bprune\b|\bgc\b/],
      ['removes something', /\brm\b|\brmdir\b|\bunlink\b|_reg_purge|_reg_retire|update-ref|worktree +remove/],
      ['writes the registry', /_reg_set|_reg_write|>>?\s*"?\$REG/],
    ];
    const hits: string[] = [];
    for (const name of ['_ws_reclaim_gone_quiet', '_ws_reclaim_quiet_row', '_ws_reclaim_no_checkout', '_ws_unit_stopped']) {
      const from = src.indexOf(`\n${name}() {`);
      expect(from, `${name} is defined`).toBeGreaterThan(-1);
      const code = src.slice(from, src.indexOf('\n}\n', from)).split('\n').filter((l) => !/^\s*#/.test(l));
      for (const line of code) {
        for (const [what, re] of FORBIDDEN) if (re.test(line)) hits.push(`${name} ${what}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('a child with a run id and a release mints the same token as one with no gone row at all: the row is no token input', () => {
    const { c, o } = goneRow();
    const with_ = evalOf(h, { childOf: String(CHILD_RUN) }).token;
    fs.rmSync(path.join(REG(), `${OTHER}.workdir`));
    const without = evalOf(h, { childOf: String(CHILD_RUN) }).token;
    expect(with_, 'a row that only stopped holding changes nothing the pin acts on').toBe(without);
    expect(fs.existsSync(o.wt)).toBe(false);
    expect(fs.existsSync(c.wt)).toBe(true);
  }, 120_000);
});
