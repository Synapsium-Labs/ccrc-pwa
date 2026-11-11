// Cleanup un-wedge R2 (spec 2026-11-04 §4.2): ccd's rows rung names the rows that hold a child. A few registry rows
// held hundreds of children at `unmeasured`, and the console showed one failing item per child. The rung's
// `_ws_reclaim_workdir_shared` now keeps `_WS_HELD_BY`: one `id<TAB>word<TAB>workspace` line for each OTHER row in a
// not-asked bucket, reset on every call, ids only. The reclaim, expiry and collect audit documents print it as
// `heldBy` (an array when the rung answered rc 2, `[]` when it answered rc 0, `null` when it was not reached) with
// `heldByOwn` beside an array (true when the child had a fault of its own too), and the reclaim audit's
// `probe-unmeasured` journal line carries `meas.heldBy`, the ids comma-joined. ccd's hold itself does not narrow (D6,
// as the operator ruled): every case that held before holds now, with the same verdict and detail.
//
// FIXTURE HOMEs ONLY (`makePrHarness`): every repository, row and leaf lives under the harness's HOME; ccd runs as
// sourced functions under `CHILD_STUBS`, never against the live HOME. Rows are hand-planted.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { CHILD_ID, CHILD_STUBS, makeChild } from './childReclaimFixture.js';
import { EXP_ID, expireAudit, makeArchived } from './wsExpireFixture.js';
import { COL_ID, collectAudit, makeOrphan } from './wsCollectFixture.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { writeField } from './worktreeIdentityFixture.js';
import { itDarwin, itLinux } from './platformFixtures.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-held-by-'); });
afterEach(() => { h.cleanup(); });

const AUDIT_STUBS = `${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB}`;
const REG = (): string => path.join(h.home, '.cc-sessions');
const ROW = 'demo-gone-row';
const AT = '1760000000000';
/** A registry row as an older ccd or a hand leaves one: `.uuid` and `.workdir`, nothing else. */
const otherRow = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(REG(), `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(REG(), `${id}.workdir`), workdir);
};
/** A path under the fixture HOME that does not exist: a row spelled there is gone, and no record places it. */
const gonePath = (): string => path.join(fs.realpathSync(h.home), 'gone', 'tree');
const mk = (...parts: string[]): string => {
  const p = path.join(h.home, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
};

type Doc = Record<string, unknown>;
interface Audit { code: number; doc: Doc; stdout: string; stderr: string }
const parse = (r: { code: number; stdout: string; stderr: string }): Audit => {
  const line = r.stdout.trim().split('\n').pop() ?? '';
  let doc: Doc = {};
  try { doc = JSON.parse(line) as Doc; } catch { throw new Error(`no JSON document: ${r.stdout}${r.stderr}`); }
  return { ...r, doc };
};
const reclaimAudit = (pre = ''): Audit =>
  parse(h.run(`${AUDIT_STUBS} ${pre} cmd_ws_audit --session ${CHILD_ID} --reclaim`));
const expiryAudit = (): Audit => parse(expireAudit(h));
const collectDoc = (): Audit => parse(collectAudit(h));
/** The document's keys with R2's two keys set aside: what Step 0 pins as today's document. */
const keysBefore = (d: Doc): string[] => Object.keys(d).filter((k) => k !== 'heldBy' && k !== 'heldByOwn');
const heldBy = (d: Doc): unknown => d['heldBy'];
/** The collect document on Darwin (D-8265): ccd's temp-root collector runs on Linux only, so on a Mac it answers
 *  `unmeasured` with the `platform` probe before it reads the population or asks the rows rung — `heldBy` is null
 *  there, as for any document whose rung was not reached. The Linux cases pin the rung's answer; these pin this one. */
const expectDarwinCollect = (c: Audit): void => {
  expect(c.code, c.stdout).toBe(1);
  expect(c.doc['mode']).toBe('collect');
  expect(c.doc['verdict']).toBe('unmeasured');
  expect((c.doc['collect'] as Doc | undefined)?.['unmeasured']).toBe('platform');
  expect(String(c.doc['detail'])).toContain('the temp-root collector runs on Linux only');
  expect(heldBy(c.doc), 'the rows rung was not reached').toBeNull();
};

// ── Step 0: today's documents, characterized ─────────────────────────────────────────────────────────────────────
// Pinned on main before R2 (green there), minus the new keys: R2 adds `heldBy`/`heldByOwn` and changes nothing else.
describe('Step 0: the three documents as main prints them, minus heldBy', () => {
  const RECLAIM_KEYS = ['id', 'project', 'branch', 'workdir'];
  it('clean: the child alone is reclaimable, and the document keeps its keys', () => {
    makeChild(h);
    const a = reclaimAudit();
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc['verdict']).toBe('reclaimable');
    expect(a.doc['mode']).toBe('reclaim');
    for (const k of RECLAIM_KEYS) expect(keysBefore(a.doc), k).toContain(k);
  }, 90_000);

  it('a gone row: the child is unmeasured, its detail names the row by id', () => {
    makeChild(h);
    otherRow(ROW, gonePath());
    const a = reclaimAudit();
    expect(a.code, a.stdout).toBe(1);
    expect(a.doc['verdict']).toBe('unmeasured');
    expect(String(a.doc['detail'])).toContain(`registry row(s) ${ROW} name a workdir that cannot be resolved completely`);
  }, 90_000);

  it('a SHARED row: the child is refused containment-unproven', () => {
    const c = makeChild(h);
    otherRow('demo-twin', c.wt);
    const a = reclaimAudit();
    expect(a.code, a.stderr).toBe(0);
    expect(a.doc['verdict']).toBe('containment-unproven');
    expect(String(a.doc['detail'])).toContain('is also named by registry row(s) demo-twin');
  }, 90_000);

  itLinux('the expiry and collect documents keep their verdicts with a gone row', () => {
    makeArchived(h);
    otherRow(ROW, gonePath());
    const e = expiryAudit();
    expect(e.code, e.stdout).toBe(1);
    expect(e.doc['verdict']).toBe('unmeasured');
    expect(e.doc['mode']).toBe('expire');
    makeOrphan(h);
    const c = collectDoc();
    expect(c.doc['mode']).toBe('collect');
    expect(c.doc['verdict']).toBe('unmeasured');
    expect(String(c.doc['detail'])).toContain(`registry row(s) ${ROW} name a workdir that cannot be resolved completely`);
  }, 120_000);

  itDarwin('on Darwin the expiry document keeps its verdict and the collect document answers `platform`', () => {
    makeArchived(h);
    otherRow(ROW, gonePath());
    const e = expiryAudit();
    expect(e.code, e.stdout).toBe(1);
    expect(e.doc['verdict']).toBe('unmeasured');
    expect(e.doc['mode']).toBe('expire');
    makeOrphan(h);
    expectDarwinCollect(collectDoc());
  }, 120_000);
});

// ── Step 1: ccd names the rows ───────────────────────────────────────────────────────────────────────────────────
describe('ccd names the rows that hold the child, by id and word', () => {
  it('a gone unrecorded row is named gone-unrecorded in the reclaim document', () => {
    makeChild(h);
    otherRow(ROW, gonePath());
    const a = reclaimAudit();
    expect(a.doc['verdict'], 'the hold does not narrow').toBe('unmeasured');
    expect(heldBy(a.doc)).toEqual([{ id: ROW, word: 'gone-unrecorded', workspace: 'absent' }]);
    expect(a.doc['heldByOwn'], 'nothing of the child’s own held it').toBe(false);
  }, 90_000);

  it('a gone workspace row says its workspace field is present', () => {
    makeChild(h);
    otherRow(ROW, gonePath());
    fs.writeFileSync(path.join(REG(), `${ROW}.workspace`), 'gone-slug');
    expect(heldBy(reclaimAudit().doc)).toEqual([{ id: ROW, word: 'gone-unrecorded', workspace: 'present' }]);
  }, 90_000);

  it('a gone row whose workspace field is a link says unreadable', () => {
    makeChild(h);
    otherRow(ROW, gonePath());
    fs.writeFileSync(path.join(h.home, 'ws-target'), 'gone-slug');
    fs.symlinkSync(path.join(h.home, 'ws-target'), path.join(REG(), `${ROW}.workspace`));
    expect(heldBy(reclaimAudit().doc)).toEqual([{ id: ROW, word: 'gone-unrecorded', workspace: 'unreadable' }]);
  }, 90_000);

  it('not-plain: a row spelled relative', () => {
    makeChild(h);
    otherRow('demo-relative', 'quiet-basin/server');
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('unmeasured');
    expect(heldBy(a.doc)).toEqual([{ id: 'demo-relative', word: 'not-plain', workspace: 'absent' }]);
  }, 90_000);

  it('under-proc: a row spelled under /proc', () => {
    makeChild(h);
    otherRow('demo-proc', '/proc/self/cwd/server');
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('unmeasured');
    expect(heldBy(a.doc)).toEqual([{ id: 'demo-proc', word: 'under-proc', workspace: 'absent' }]);
  }, 90_000);

  it('workdir-unreadable: a row whose .workdir is a link', () => {
    makeChild(h);
    fs.writeFileSync(path.join(REG(), 'demo-linked.uuid'), 'u-demo-linked');
    fs.writeFileSync(path.join(h.home, 'wd-target'), mk('elsewhere'));
    fs.symlinkSync(path.join(h.home, 'wd-target'), path.join(REG(), 'demo-linked.workdir'));
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('unmeasured');
    expect(heldBy(a.doc)).toEqual([{ id: 'demo-linked', word: 'workdir-unreadable', workspace: 'absent' }]);
  }, 90_000);

  it('entry-pending: a row whose entry field reads pending', () => {
    makeChild(h);
    const elsewhere = mk('elsewhere');
    otherRow('demo-pending', elsewhere);
    writeField(h, 'demo-pending', `v1\tpending\t${AT}\t-\t${elsewhere}`);
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('unmeasured');
    expect(heldBy(a.doc)).toEqual([{ id: 'demo-pending', word: 'entry-pending', workspace: 'absent' }]);
  }, 90_000);

  it('entry-unmeasured: a row whose entry field is a directory', () => {
    makeChild(h);
    otherRow('demo-dirfield', mk('elsewhere'));
    fs.mkdirSync(path.join(REG(), 'demo-dirfield.workdirid'));
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('unmeasured');
    expect(heldBy(a.doc)).toEqual([{ id: 'demo-dirfield', word: 'entry-unmeasured', workspace: 'absent' }]);
  }, 90_000);

  it('entry-moved: the directory a row entered moved into the child and was replaced at its old path', () => {
    // The fixture of `ccd-rows-rung-entry.test.ts`'s I3b, cut to its levers.
    const c = makeChild(h);
    const outsideServer = mk('outside', 'server');
    const alias = path.join(h.home, 'alias');
    fs.symlinkSync(path.dirname(outsideServer), alias);
    otherRow('demo-alias', `${alias}/server`);
    const ident = h.sh(`_ws_path_ident '${outsideServer}'; printf '%s' "$_WS_IDENT"`);
    writeField(h, 'demo-alias', `v1\t${ident}\t${AT}\t${fs.realpathSync(outsideServer)}\t${alias}/server`);
    expect(reclaimAudit().doc['verdict'], 'the CONTROL: the field records where the row still leads').toBe('reclaimable');
    fs.renameSync(outsideServer, path.join(c.wt, 'moved-in'));
    fs.mkdirSync(outsideServer);
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('unmeasured');
    expect(heldBy(a.doc)).toEqual([{ id: 'demo-alias', word: 'entry-moved', workspace: 'absent' }]);
  }, 90_000);

  it('a SHARED row outranks, and heldBy is []', () => {
    const c = makeChild(h);
    otherRow(ROW, gonePath());
    otherRow('demo-twin', c.wt);
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('containment-unproven');
    expect(heldBy(a.doc)).toEqual([]);
    expect(a.doc['heldByOwn']).toBe(false);
  }, 90_000);

  it('an outranking pass leaves no row named, even in the global', () => {
    const c = makeChild(h);
    otherRow(ROW, gonePath());
    otherRow('demo-twin', c.wt);
    const out = h.sh(`_ws_reclaim_workdir_shared ${CHILD_ID} "${c.wt}" >/dev/null; printf '[%s][%s][%s]' "$?" "$_WS_HELD_BY" "$_WS_HELD_BY_IDS"`);
    expect(out).toBe('[0][][]');
  }, 90_000);

  it('a clean child prints heldBy []', () => {
    makeChild(h);
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('reclaimable');
    expect(heldBy(a.doc)).toEqual([]);
  }, 90_000);

  it('heldBy is null when an earlier rung refused (a not-a-child row)', () => {
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('not-a-child');
    expect(Object.prototype.hasOwnProperty.call(a.doc, 'heldBy'), 'the key is printed').toBe(true);
    expect(heldBy(a.doc)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(a.doc, 'heldByOwn'), 'no heldByOwn beside a null').toBe(false);
  }, 90_000);

  it('the child’s own fault beside a holding row sets heldByOwn', () => {
    makeChild(h);
    otherRow(ROW, gonePath());
    // The child's own leaf cannot be measured: an unsearchable ~/.cc-tmp makes its leaf's absence unprovable.
    const tmp = mk('.cc-tmp');
    fs.chmodSync(tmp, 0o000);
    try {
      const a = reclaimAudit();
      expect(a.doc['verdict']).toBe('unmeasured');
      expect(heldBy(a.doc)).toEqual([{ id: ROW, word: 'gone-unrecorded', workspace: 'absent' }]);
      expect(a.doc['heldByOwn']).toBe(true);
    } finally { fs.chmodSync(tmp, 0o755); }
  }, 90_000);

  itLinux('the expiry and the collect documents carry the same field', () => {
    makeArchived(h);
    otherRow(ROW, gonePath());
    const e = expiryAudit();
    expect(e.doc['verdict']).toBe('unmeasured');
    expect(heldBy(e.doc)).toEqual([{ id: ROW, word: 'gone-unrecorded', workspace: 'absent' }]);
    expect(e.doc['heldByOwn']).toBe(false);
    makeOrphan(h);
    const c = collectDoc();
    expect(c.doc['verdict']).toBe('unmeasured');
    expect(heldBy(c.doc)).toEqual([{ id: ROW, word: 'gone-unrecorded', workspace: 'absent' }]);
    expect(c.doc['heldByOwn']).toBe(false);
  }, 120_000);

  itDarwin('on Darwin the expiry document carries the field and the collect document answers `platform`', () => {
    makeArchived(h);
    otherRow(ROW, gonePath());
    const e = expiryAudit();
    expect(e.doc['verdict']).toBe('unmeasured');
    expect(heldBy(e.doc)).toEqual([{ id: ROW, word: 'gone-unrecorded', workspace: 'absent' }]);
    expect(e.doc['heldByOwn']).toBe(false);
    makeOrphan(h);
    expectDarwinCollect(collectDoc());
  }, 120_000);

  it('the collect document prints null when its rows rung was not reached (the id’s own row stands)', () => {
    makeOrphan(h);
    otherRow(COL_ID, mk('own-row'));
    const c = collectDoc();
    expect(heldBy(c.doc)).toBeNull();
  }, 90_000);

  it('only ids are printed: a row whose workdir holds a newline prints its id alone', () => {
    makeChild(h);
    otherRow(ROW, `${gonePath()}\nccd: forged line`);
    const a = reclaimAudit();
    expect(a.doc['verdict']).toBe('unmeasured');
    expect(heldBy(a.doc)).toEqual([{ id: ROW, word: 'gone-unrecorded', workspace: 'absent' }]);
    expect(JSON.stringify(a.doc['heldBy']), 'no workdir value').not.toContain('forged');
  }, 90_000);

  it('a row whose id is not an id ccd prints is listed with a null id', () => {
    makeChild(h);
    otherRow('demo odd', gonePath());
    const held = heldBy(reclaimAudit().doc) as { id: unknown; word: string }[];
    // Its workspace field is never read through an id ccd does not print, so it says unreadable: never forgotten.
    expect(held).toEqual([{ id: null, word: 'gone-unrecorded', workspace: 'unreadable' }]);
  }, 90_000);

  it('the probe-unmeasured journal line carries meas.heldBy', () => {
    makeChild(h);
    otherRow(ROW, gonePath());
    otherRow('demo-relative', 'quiet-basin/server');
    const a = reclaimAudit();
    expect(a.code).toBe(1);
    const failed = eventsOf(h.home, 'reclaim').filter((e) => e['refusal'] === 'probe-unmeasured');
    expect(failed).toHaveLength(1);
    expect(measOf(failed[0]!)['heldBy']?.split(',').sort()).toEqual([ROW, 'demo-relative'].sort());
  }, 90_000);

  it('a registry that cannot be listed answers rc 2 with heldByOwn true, never a clean false (review 1580 F11)', () => {
    const c = makeChild(h);
    otherRow(ROW, gonePath());
    // `find` failing is the rung's one listing of the registry failing: the rung must not claim the child is fault-free.
    const out = h.sh(`find() { return 1; }; _ws_reclaim_workdir_shared ${CHILD_ID} "${c.wt}" >/dev/null; rc=$?; unset -f find;`
      + ` printf '[%s][%s][%s]' "$rc" "$_WS_SHARED_WHY" "$(_ws_held_by_doc)"`);
    expect(out).toBe(`[2][could not list ${REG()}]["heldBy":[],"heldByOwn":true,]`);
  }, 90_000);

  it('a second call does not carry the first call’s rows', () => {
    const c = makeChild(h);
    otherRow(ROW, gonePath());
    const out = h.sh(`_ws_reclaim_workdir_shared ${CHILD_ID} "${c.wt}" >/dev/null; printf '[%s]' "$_WS_HELD_BY";`
      + ` rm -f "$REG/${ROW}.workdir" "$REG/${ROW}.uuid"; _ws_reclaim_workdir_shared ${CHILD_ID} "${c.wt}" >/dev/null;`
      + ` printf '[%s]' "$_WS_HELD_BY"`);
    expect(out).toBe(`[${ROW}\tgone-unrecorded\tabsent\n][]`);
  }, 90_000);
});
