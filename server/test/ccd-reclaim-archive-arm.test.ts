// Cleanup un-wedge R1 (D-7999, spec 2026-11-04 §3): an archived row whose tree is gone is placed from its archive
// record, a third arm of `_ws_reclaim_recorded` (`_ws_reclaim_recorded_archive`), after git's record and ccd's
// breadcrumb. A gone row that neither of those places held every child of the box at `unmeasured`, and a repo-wide
// `git worktree prune` is all it takes to remove git's record. The archive record proves the same three facts the git
// arm proves from git's: where the tree was (A4, A5), that it was this row's (A1 to A3), and that it is gone now with
// no record git still keeps (A6, A7). Every condition that cannot be read holds, and a record written before R1 (no
// `workdir`, `workdirReal` or `uuid`) places nothing (D3, as the operator ruled).
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the isolation boundary: every repository, worktree, registry row and
// archive record lives under it; units and panes are stubbed. The FIXTURE removes git's records with plain git in
// its own repositories; ccd never prunes them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import {
  CHILD_ID, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, type LadderAnswer,
} from './childReclaimFixture.js';
import { EXP_ID, expireEvalOf, expireVerb, makeArchived } from './wsExpireFixture.js';
import { COL_ID, makeOrphan } from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-reclaim-archive-arm-'); });
afterEach(() => { h.cleanup(); });

/** `_ws_reclaim_workdir_shared`'s cannot-be-placed sentence: the row holds the child. */
const HELD = 'name a workdir that cannot be resolved completely';
/** `ws-archive` reaches the unit and the pane; stub exactly those, as `ccd-archive.test.ts` does. */
const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  _ws_supervise() { echo "supervise $1" >> "$HOME/ccd-calls"; };
  _spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; };
  _spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; SPAWN_FROMSWAP=0; };
  _spawn_settle() { echo "spawn_settle $1" >> "$HOME/ccd-calls"; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };
  _session_verdict() { echo gone; };`;

interface Sib { id: string; main: string; wt: string; admin: string }
const reg = (id: string, field: string): string => path.join(h.home, '.cc-sessions', `${id}.${field}`);
/** git's porcelain stanza for `wt` in `main`'s list, or '' when git records no worktree there. */
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';

/** A top-level workspace of `project` (no `--child`), archived by the real `ws-archive`, its tree standing. */
const archivedSibling = (project = 'demo'): Sib => {
  if (project !== 'demo') h.makeGhRepo(project, `o/${project}`);
  const id = `${project}-still-harbor`;
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add ${project}`);
  const wt = path.join(h.home, 'worktrees', project, 'still-harbor');
  const admin = h.git(wt, 'rev-parse', '--absolute-git-dir');
  h.sh(`${ARCH} cmd_ws_archive --session ${id}`);
  expect(h.reg(id, 'archived'), 'the CONTROL: the real archive stands').toMatch(/^[0-9]+$/);
  const m = manifestOf(id);
  expect(m['workdir'], 'the CONTROL: the archive recorded where the tree stood').toBe(wt);
  return { id, main: path.join(h.home, 'projects', project), wt, admin };
};
/** Its tree removed, and git's record of it removed by the FIXTURE (never by ccd). */
const gone = (s: Sib): void => {
  fs.rmSync(s.wt, { recursive: true, force: true });
  h.git(s.main, 'worktree', 'prune');
  expect(stanza(s.main, s.wt), 'the CONTROL: git records nothing of the gone tree').toBe('');
  expect(fs.existsSync(s.admin), 'the CONTROL: its admin directory went with the record').toBe(false);
};
const manifestOf = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(reg(id, 'archivemanifest'), 'utf8')) as Record<string, unknown>;
const writeManifest = (id: string, m: Record<string, unknown>): void => {
  fs.writeFileSync(reg(id, 'archivemanifest'), `${JSON.stringify(m)}\n`);
};

const held = (r: LadderAnswer, id: string, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('unmeasured');
  expect(r.detail, label).toContain(`registry row(s) ${id} ${HELD}`);
  expect(r.token, label).toBe('');
};
const placed = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('reclaimable');
  expect(r.token, label).toMatch(/^[0-9a-f]{64}$/);
};
/** The child, an archived sibling of its own repository whose tree is gone and unrecorded, and the CONTROL: placed. */
const armed = (): { c: ReturnType<typeof makeChild>; s: Sib } => {
  const c = makeChild(h);
  const s = archivedSibling();
  placed(evalOf(h), 'the CONTROL: while its tree stands the sibling is placed outside');
  gone(s);
  placed(evalOf(h), 'the CONTROL: the archive record places the gone sibling');
  return { c, s };
};
/** Each hold below is measured against this CONTROL: put back, the same record places the row again. */
const placesAgain = (label: string): void => { placed(evalOf(h), `the CONTROL: ${label}`); };
const ownedOf = (id: string, wt: string, main: string): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`_ws_reclaim_owned ${id} "${wt}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};

describe('the archive arm places a gone archived row', () => {
  it('an archived sibling whose tree is gone and whose record git pruned no longer holds a present child, and the verb reclaims the child', () => {
    const c = makeChild(h);
    const s = archivedSibling();
    placed(evalOf(h), 'the CONTROL: while its tree stands the sibling is placed outside');
    gone(s);
    const r = evalOf(h);
    placed(r, 'the archive record places the gone sibling');
    const v = childReclaimVerb(h, r.token);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect((JSON.parse(v.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the child’s tree is gone').toBe(false);
    // What the arm never does: it only stopped the sibling holding the child.
    expect(fs.existsSync(s.wt), 'no directory was created at the gone path').toBe(false);
    expect(h.reg(s.id, 'workdir'), 'the sibling’s row stands').toBe(s.wt);
    expect(h.reg(s.id, 'archived'), 'its archive stands').toMatch(/^[0-9]+$/);
    expect(manifestOf(s.id)['workdir'], 'its manifest stands').toBe(s.wt);
  }, 120_000);

  it('the same sibling no longer holds a vanished child', () => {
    const c = makeChild(h);
    const s = archivedSibling();
    gone(s);
    fs.rmSync(c.wt, { recursive: true, force: true });
    placed(evalOf(h), 'the vanished child, the gone sibling placed by its archive record');
  }, 120_000);

  it('the expiry ladder passes the same sibling', () => {
    makeArchived(h);
    const s = archivedSibling();
    gone(s);
    const e = expireEvalOf(h);
    expect(e.verdict, e.detail).toBe('expirable');
    const v = expireVerb(h, e.token);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect((JSON.parse(v.stdout) as { expired: string }).expired).toBe(EXP_ID);
    expect(h.reg(s.id, 'archived'), 'the gone sibling’s archive stands').toMatch(/^[0-9]+$/);
  }, 120_000);

  it('the collector’s rows rule passes the same sibling', () => {
    h.makeGhRepo('demo');
    const s = archivedSibling();
    gone(s);
    const o = makeOrphan(h);
    const [rc = '', why = ''] = h.sh(`_ws_reclaim_contained _ws_collect_rows_clear ${COL_ID} '${o.leaf}'; rc=$?;`
      + ' printf \'%s\\x1f%s\' "$rc" "$_WS_COLLECT_ROWS_WHY"').split('\x1f');
    expect(rc, why).toBe('0');
  }, 120_000);
});

describe('the archive arm holds', () => {
  it('a manifest written before this change (no workdir, workdirReal or uuid) keeps the hold', () => {
    const { s } = armed();
    const m = manifestOf(s.id);
    const { workdir: _w, workdirReal: _r, uuid: _u, ...old } = m;
    writeManifest(s.id, old);
    held(evalOf(h), s.id, 'a record from before R1');
    writeManifest(s.id, m);
    placesAgain('the record restored');
  }, 120_000);

  it('a manifest whose workdir is not the row’s .workdir keeps the hold', () => {
    const { s } = armed();
    const m = manifestOf(s.id);
    writeManifest(s.id, { ...m, workdir: `${s.wt}-elsewhere` });
    held(evalOf(h), s.id, 'another workdir');
    writeManifest(s.id, m);
    placesAgain('the record restored');
  }, 120_000);

  it('a manifest whose workdirReal is not its workdir keeps the hold', () => {
    const { s } = armed();
    const m = manifestOf(s.id);
    // The shape an archive taken through a linked spelling records (`ccd-archive.test.ts`'s link case).
    writeManifest(s.id, { ...m, workdirReal: path.join(h.home, 'wtlink', 'demo', 'still-harbor') });
    held(evalOf(h), s.id, 'a workdirReal that is not the spelling');
    writeManifest(s.id, { ...m, workdirReal: null });
    held(evalOf(h), s.id, 'a workdirReal recorded as null');
    writeManifest(s.id, m);
    placesAgain('the record restored');
  }, 120_000);

  for (const field of ['id', 'uuid', 'branch'] as const) {
    it(`a manifest whose ${field} is not the row’s keeps the hold`, () => {
      const { s } = armed();
      const m = manifestOf(s.id);
      writeManifest(s.id, { ...m, [field]: `${String(m[field])}x` });
      held(evalOf(h), s.id, `another ${field}`);
      writeManifest(s.id, m);
      placesAgain('the record restored');
    }, 120_000);
  }

  it('an unreadable, non-JSON, linked or absent manifest keeps the hold', (ctx) => {
    const { s } = armed();
    const f = reg(s.id, 'archivemanifest');
    const good = fs.readFileSync(f, 'utf8');
    if (process.getuid?.() !== 0) {
      fs.chmodSync(f, 0o000);
      try { held(evalOf(h), s.id, 'an unreadable manifest'); } finally { fs.chmodSync(f, 0o644); }
      placesAgain('readable again');
    } else ctx.annotate('unreadable arm skipped as root');
    fs.writeFileSync(f, good.replace(/}\s*$/, ''));
    held(evalOf(h), s.id, 'a manifest that is not JSON');
    fs.writeFileSync(f, '["not", "an", "object"]\n');
    held(evalOf(h), s.id, 'a manifest that is not an object');
    const copy = path.join(h.home, 'manifest-copy.json');
    fs.writeFileSync(copy, good);
    fs.rmSync(f);
    fs.symlinkSync(copy, f);
    held(evalOf(h), s.id, 'a manifest that is a link, to a valid copy');
    fs.rmSync(f);
    held(evalOf(h), s.id, 'an absent manifest');
    fs.writeFileSync(f, good);
    placesAgain('the record restored');
  }, 120_000);

  it('an .archived that is not a whole number, is a link or is absent keeps the hold', () => {
    const { s } = armed();
    const f = reg(s.id, 'archived');
    const good = fs.readFileSync(f, 'utf8');
    for (const bad of ['17x\n', '-17\n', '\n', '１７\n']) {
      fs.writeFileSync(f, bad);
      held(evalOf(h), s.id, `an .archived reading ${JSON.stringify(bad)}`);
    }
    const copy = path.join(h.home, 'archived-copy');
    fs.writeFileSync(copy, good);
    fs.rmSync(f);
    fs.symlinkSync(copy, f);
    held(evalOf(h), s.id, 'an .archived that is a link, to a valid copy');
    fs.rmSync(f);
    held(evalOf(h), s.id, 'an absent .archived');
    fs.writeFileSync(f, good);
    placesAgain('the archive restored');
  }, 120_000);

  it('a parent spelled through a link keeps the hold (A5)', () => {
    const { s } = armed();
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const linked = path.join(h.home, 'wtlink', 'demo', 'still-harbor');
    const m = manifestOf(s.id);
    // The row AND its record both name the linked spelling, so A3 and A4 hold and only A5 decides.
    fs.writeFileSync(reg(s.id, 'workdir'), linked);
    writeManifest(s.id, { ...m, workdir: linked, workdirReal: linked });
    const r = evalOf(h);
    held(r, s.id, 'the row is spelled through a link');
    expect(r.detail, 'by id only').not.toContain(linked);
    fs.writeFileSync(reg(s.id, 'workdir'), s.wt);
    writeManifest(s.id, m);
    placesAgain('spelled physically');
  }, 120_000);

  it('a record git still holds is the git arm’s: a locked record keeps the hold (A6)', () => {
    makeChild(h);
    const s = archivedSibling();
    h.git(s.main, 'worktree', 'lock', s.wt);
    fs.rmSync(s.wt, { recursive: true, force: true });
    h.git(s.main, 'worktree', 'prune');
    const st = stanza(s.main, s.wt);
    expect(st, 'the CONTROL: a prune keeps a locked record').toContain('\nlocked');
    expect(st, 'the CONTROL: and git never reads it as prunable').not.toContain('\nprunable');
    held(evalOf(h), s.id, 'a locked record');
    fs.rmSync(path.join(s.admin, 'locked'));
    expect(stanza(s.main, s.wt), 'the CONTROL: unlocked, the record is prunable').toContain('\nprunable');
    placed(evalOf(h), 'the CONTROL: unlocked, git’s own arm places it');
    h.git(s.main, 'worktree', 'prune');
    placesAgain('pruned, the archive record places it');
  }, 120_000);

  it('a worktree list git could not give keeps the hold (A6): an unread record is never none', () => {
    const { s } = armed();
    // git's list of `demo` fails; every other git call, and every other repository's list, answers as before.
    const pre = `git() { if [[ "$*" == *"${s.main}"*"worktree list"* ]]; then return 128; fi; command git "$@"; };`;
    held(evalOf(h, { pre }), s.id, 'git could not list the worktrees');
    placesAgain('the list answers again');
  }, 120_000);

  it('an admin entry naming the tree that cannot be read keeps the hold (A6)', (ctx) => {
    if (process.getuid?.() === 0) { ctx.skip(); return; }
    makeChild(h);
    // Another repository's, so the child's own records stay readable.
    const s = archivedSibling('demo2');
    fs.rmSync(s.wt, { recursive: true, force: true });
    expect(stanza(s.main, s.wt), 'the CONTROL: git keeps the record, prunable').toContain('\nprunable');
    const dir = path.dirname(s.admin);
    fs.chmodSync(dir, 0o000);
    try {
      expect(stanza(s.main, s.wt), 'the CONTROL: git’s list silently omits the record it cannot read').toBe('');
      held(evalOf(h), s.id, 'worktrees/ cannot be listed');
    } finally { fs.chmodSync(dir, 0o755); }
    placed(evalOf(h), 'the CONTROL: listable again, git’s own arm places it');
  }, 120_000);

  it('a leaf that is a dangling link keeps the hold (A7)', () => {
    const { s } = armed();
    fs.symlinkSync(path.join(h.home, 'nowhere'), s.wt);
    held(evalOf(h), s.id, 'a dangling link at the leaf');
    fs.rmSync(s.wt);
    placesAgain('the link removed');
  }, 120_000);

  it('no python3 keeps the hold', () => {
    const { s } = armed();
    // The arm's one reader of the record finds no interpreter; every other reader keeps its own.
    const pre = 'python3() { if [[ "$*" == *archivemanifest* ]]; then return 127; fi; command python3 "$@"; };';
    held(evalOf(h, { pre }), s.id, 'no python3 to read the record');
    placesAgain('python3 back');
  }, 120_000);

  it('a restored row is held again', () => {
    makeChild(h);
    const s = archivedSibling();
    const r = h.run(`${ARCH} cmd_ws_restore --session ${s.id}`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.reg(s.id, 'archived'), 'the CONTROL: the restore removed the archive').toBeNull();
    gone(s);
    held(evalOf(h), s.id, 'a restored row whose tree is gone');
  }, 120_000);
});

describe('the moved-tree hole, for an archive-placed row', () => {
  it('an archived sibling’s tree moved inside the child keeps the child, at the ladder and in _ws_reclaim_owned', () => {
    const c = makeChild(h);
    const s = archivedSibling();
    const moved = path.join(c.wt, 'inner-moved');
    fs.renameSync(s.wt, moved);
    h.git(s.main, 'worktree', 'prune');
    expect(stanza(s.main, s.wt), 'the CONTROL: git records nothing of the moved tree').toBe('');
    expect(fs.readFileSync(path.join(moved, '.git'), 'utf8'), 'the CONTROL: the moved tree names the pruned admin directory')
      .toContain(s.admin);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(moved);
    expect(r.token).toBe('');
    const owned = ownedOf(CHILD_ID, c.wt, c.main);
    expect(owned.rc, `the tail asks it again: ${owned.why}`).toBe('2');
    expect(owned.why).toContain(moved);
    expect(fs.existsSync(path.join(moved, '.git')), 'the moved tree stands').toBe(true);
    // CONTROL: moved back out and removed, the archive record places the row, and the tail passes.
    fs.rmSync(moved, { recursive: true, force: true });
    placed(evalOf(h), 'the CONTROL: nothing inside the child, the record places the sibling');
    expect(ownedOf(CHILD_ID, c.wt, c.main).rc).toBe('0');
  }, 120_000);

  it('a row with no entry field: the archive flag alone makes the moved check and the tail read the moved tree', () => {
    // The case above also records where the row's session entered (`.workdirid`), which forces the same scan by
    // itself. An older row has no such field, so here only `_WS_RECORDED_ARCH` makes `_ws_reclaim_owned` scan the
    // child and `_ws_reclaim_moved_check` read each nested checkout's git directory (D5).
    const c = makeChild(h);
    const s = archivedSibling();
    const field = reg(s.id, 'workdirid');
    expect(fs.existsSync(field), 'the CONTROL: ws-add recorded where the session entered').toBe(true);
    fs.rmSync(field);
    const moved = path.join(c.wt, 'inner-moved');
    fs.renameSync(s.wt, moved);
    h.git(s.main, 'worktree', 'prune');
    expect(stanza(s.main, s.wt), 'the CONTROL: git records nothing of the moved tree').toBe('');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(moved);
    const owned = ownedOf(CHILD_ID, c.wt, c.main);
    expect(owned.rc, `the tail asks it again: ${owned.why}`).toBe('2');
    expect(owned.why).toContain(`could not read the git directory of the checkout at ${moved}`);
    fs.rmSync(moved, { recursive: true, force: true });
    placed(evalOf(h), 'the CONTROL: nothing inside the child, the record places the sibling');
    expect(ownedOf(CHILD_ID, c.wt, c.main).rc).toBe('0');
  }, 120_000);
});

// The stubs every verb call above carries come from `childReclaimFixture.ts`; named here so a reader of this file sees
// that no unit or pane is touched.
void CHILD_STUBS;
