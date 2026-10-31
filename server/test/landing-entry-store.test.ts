// Landing order wave 5e (Task 1): the landing line's entry and its ONE writer, `CoordStore.advanceLanding`. The run's
// advance and the entry commit in one transaction; a refused edge writes neither. Temporary coord.db files only.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { LandingAdvance } from '../src/coord/landingEntry.js';
import type { LandingEjectionKind } from '../../shared/landingLine.js';
import { mergingAtDetail } from '../../shared/landing.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const HC = 'c'.repeat(40);
const BASE = 'd'.repeat(40);
const BASE2 = 'e'.repeat(40);
const P = 'project-a';

let coord: CoordStore;
beforeEach(() => { coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-landing-'), '.ccrc', 'coord.db'))); });

const pin = (head: string = HEAD, pr: number | null = 7): LandingAdvance =>
  ({ kind: 'pin', head, pr, mode: 'off', handoffCommit: HC });
const eject = (base: string | null = BASE, kind: LandingEjectionKind = 'conflict'): LandingAdvance =>
  ({ kind: 'retreat', ejection: base === null ? null : { base, kind } });
const countEvents = (id: number): number =>
  (coord.db.prepare('SELECT COUNT(*) AS n FROM run_events WHERE runId = ?').get(id) as { n: number }).n;
const step = (id: number, to: Parameters<CoordStore['advance']>[1]): void => {
  const r = coord.advance(id, to, 'test');
  if (!r.ok) throw new Error(`fixture advance to ${to} refused`);
};
/** A run at `working`, in project-a. */
const atWorking = (): number => {
  const opened = coord.openRun({ program: 'p', title: 't', project: P, wave: 1, waveOf: 1, claimedBy: 'coord-a' });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, 'project-a-ws1');
  step(opened.id, 'dispatched');
  step(opened.id, 'working');
  return opened.id;
};
const atReview = (): number => { const id = atWorking(); step(id, 'awaiting-review'); return id; };
/** A run at `merging` with its entry pinned at HEAD. */
const atMerging = (): number => {
  const id = atReview();
  const r = coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() });
  if (!r.ok) throw new Error('fixture pin refused');
  return id;
};
const insertRaw = (pr: number, state: string, runId: number | null, pinnedSha: string = HEAD2, pinnedAt = 1): void => {
  coord.db.prepare('INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) ' +
    "VALUES (?, ?, ?, ?, ?, ?, 'operator', ?)").run(P, pr, pinnedSha, HC, runId, state, pinnedAt);
};

describe('the entry is written by advanceLanding, in the run\'s own transaction (landing order wave 5e)', () => {
  it('advance → merging creates one pinned entry at the episode head, in the same call', () => {
    const id = atReview();
    const r = coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() });
    expect(r).toMatchObject({ ok: true, from: 'awaiting-review', to: 'merging', landing: { kind: 'pinned', created: true } });
    expect(coord.landingEntries(P)).toEqual([{ id: expect.any(Number), project: P, pr: 7, pinnedSha: HEAD, handoffCommit: HC,
      runId: id, state: 'pinned', baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false,
      setBy: 'coordinator', pinnedAt: expect.any(Number) }]);
    expect(coord.currentEpisode(id)).toMatchObject({ head: HEAD, pr: 7, mode: 'off' });
    expect(coord.landingEntries(P)[0]!.pinnedSha).toBe(coord.currentEpisode(id)!.head);
  });

  it('a refused edge writes no entry and no run row (no phantom)', () => {
    const id = atWorking();
    const before = countEvents(id);
    expect(coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() }))
      .toEqual({ ok: false, error: 'bad-transition', from: 'working', to: 'merging' });
    expect(coord.landingEntries(P)).toEqual([]);
    expect(countEvents(id)).toBe(before);
  });

  it('an unknown run answers unknown-run', () => {
    expect(coord.advanceLanding({ runId: 9999, to: 'merging', causedBy: 'coordinator', landing: pin() }))
      .toEqual({ ok: false, error: 'unknown-run' });
  });

  it('a throw in the entry write rolls the run\'s advance back', () => {
    const id = atReview();
    coord.db.exec("CREATE TRIGGER boom BEFORE INSERT ON landing_entries BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(() => coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() })).toThrow(/boom/);
    expect(coord.run(id)).toMatchObject({ ok: true, run: { state: 'awaiting-review' } });
    expect(coord.currentEpisode(id)).toBeNull();
  });

  it('merging → working with an ejection marks it ejected, records the base and the kind, and counts', () => {
    const id = atMerging();
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() })).toMatchObject({
      ok: true, from: 'merging', to: 'working', landing: { kind: 'ejected', entry: { state: 'ejected', baseSha: BASE,
      ejectionKind: 'conflict', ejections: 1, pinnedSha: HEAD } } });
  });

  it('the next advance → merging re-pins the same row, keeps the count and clears the ejection', () => {
    const id = atMerging();
    coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() });
    const firstId = coord.landingEntries(P)[0]!.id;
    step(id, 'awaiting-review');
    const r = coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin(HEAD2) });
    expect(r).toMatchObject({ ok: true, landing: { kind: 'pinned', created: false,
      entry: { id: firstId, pinnedSha: HEAD2, state: 'pinned', baseSha: null, ejectionKind: null, ejections: 1 } } });
    expect(coord.landingEntries(P)).toHaveLength(1);
  });

  it('a second ejection counts two', () => {
    const id = atMerging();
    coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() });
    step(id, 'awaiting-review');
    coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin(HEAD2) });
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject(BASE2, 'new-head') }))
      .toMatchObject({ ok: true, landing: { kind: 'ejected', entry: { ejections: 2, baseSha: BASE2, ejectionKind: 'new-head' } } });
  });

  it('a bare retreat from merging ejects with no base', () => {
    const id = atMerging();
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject(null) }))
      .toMatchObject({ ok: true, landing: { kind: 'ejected', entry: { state: 'ejected', baseSha: null, ejectionKind: null, ejections: 1 } } });
  });

  it('an ejection on a run not at merging is refused and moves nothing', () => {
    const id = atReview();
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() }))
      .toEqual({ ok: false, error: 'ejection-not-merging', from: 'awaiting-review' });
    expect(coord.run(id)).toMatchObject({ ok: true, run: { state: 'awaiting-review' } });
  });

  it('a retreat from awaiting-review with no ejection is a plain advance', () => {
    const id = atReview();
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject(null) }))
      .toMatchObject({ ok: true, to: 'working', landing: { kind: 'none' } });
  });

  it('an episode with no PR creates no entry', () => {
    const id = atReview();
    expect(coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin(HEAD, null) }))
      .toMatchObject({ ok: true, landing: { kind: 'no-pr' } });
    expect(coord.landingEntries(P)).toEqual([]);
    expect(coord.currentEpisode(id)).toMatchObject({ pr: null });
  });

  it.each(['landed', 'withdrawn'])('a %s row is kept, and the run still advances', (state) => {
    const id = atReview();
    insertRaw(7, state, null);
    expect(coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() }))
      .toMatchObject({ ok: true, to: 'merging', landing: { kind: 'kept', state } });
    expect(coord.landingEntries(P)[0]).toMatchObject({ pinnedSha: HEAD2, state });
  });

  it('a pin onto a row this build cannot read keeps it untouched, and the run still advances (the rollback case)', () => {
    const id = atReview();
    insertRaw(7, 'later', null);
    expect(coord.landingEntries(P)[0]).toMatchObject({ state: 'unknown', pinnedSha: HEAD2 });
    expect(coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: pin() }))
      .toMatchObject({ ok: true, from: 'awaiting-review', to: 'merging', landing: { kind: 'kept', state: 'unknown' } });
    expect(coord.landingEntries(P)).toEqual([expect.objectContaining({ pr: 7, state: 'unknown', pinnedSha: HEAD2, runId: null, ejections: 0 })]);
    expect(coord.db.prepare('SELECT state FROM landing_entries WHERE pr = 7').get()).toEqual({ state: 'later' });
  });

  it('a retreat from merging never ejects another run\'s pinned entry for the same PR', () => {
    const other = coord.openRun({ program: 'p', title: 't', project: P, wave: 2, waveOf: 2, claimedBy: 'coord-a' });
    if (!('id' in other)) throw new Error('fixture openRun refused');
    const id = atReview();
    insertRaw(7, 'pinned', other.id, HEAD2);
    coord.advance(id, 'merging', 'coordinator', mergingAtDetail(HEAD, 7, 'off'));
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() }))
      .toMatchObject({ ok: true, from: 'merging', to: 'working', landing: { kind: 'kept', state: 'pinned' } });
    expect(coord.landingEntries(P)).toEqual([expect.objectContaining({ pr: 7, state: 'pinned', runId: other.id, pinnedSha: HEAD2,
      baseSha: null, ejectionKind: null, ejections: 0 })]);
  });

  it.each(['ejected', 'landed'])('a retreat from merging leaves this run\'s own %s entry alone', (state) => {
    const id = atReview();
    insertRaw(7, state, id, HEAD2);
    coord.advance(id, 'merging', 'coordinator', mergingAtDetail(HEAD, 7, 'off'));
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() }))
      .toMatchObject({ ok: true, from: 'merging', to: 'working', landing: { kind: 'kept', state } });
    expect(coord.landingEntries(P)).toEqual([expect.objectContaining({ pr: 7, state, runId: id, pinnedSha: HEAD2,
      baseSha: null, ejectionKind: null, ejections: 0 })]);
  });

  it('a retreat whose episode predates the line is no-entry, and never ejects another PR\'s row of the same run', () => {
    const id = atReview();
    insertRaw(8, 'pinned', id, HEAD2);
    coord.advance(id, 'merging', 'coordinator', mergingAtDetail(HEAD, 7, 'off'));
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() }))
      .toMatchObject({ ok: true, landing: { kind: 'no-entry' } });
    expect(coord.landingEntries(P)).toEqual([expect.objectContaining({ pr: 8, state: 'pinned', ejections: 0 })]);
  });

  it('a retreat from merging with no episode is no-episode, apart from no-pr, and writes nothing', () => {
    const id = atReview();
    coord.advance(id, 'merging', 'coordinator');
    expect(coord.currentEpisode(id)).toBeNull();
    expect(coord.advanceLanding({ runId: id, to: 'working', causedBy: 'coordinator', landing: eject() }))
      .toMatchObject({ ok: true, to: 'working', landing: { kind: 'no-episode' } });
    expect(coord.landingEntries(P)).toEqual([]);
  });

  it('a pin on an advance not to merging is a programming error: it throws and writes nothing', () => {
    const id = atWorking();
    const before = countEvents(id);
    expect(() => coord.advanceLanding({ runId: id, to: 'awaiting-review', causedBy: 'coordinator', landing: pin() })).toThrow();
    expect(coord.run(id)).toMatchObject({ ok: true, run: { state: 'working' } });
    expect(coord.landingEntries(P)).toEqual([]);
    expect(countEvents(id)).toBe(before);
  });

  it('landingProject reads absent as clear and any non-zero as set', () => {
    expect(coord.landingProject(P)).toEqual({ operatorPaused: false, mainRedHold: false });
    coord.db.prepare('INSERT INTO landing_projects (project, operatorPaused, mainRedHold) VALUES (?, 1, 0)').run(P);
    expect(coord.landingProject(P)).toEqual({ operatorPaused: true, mainRedHold: false });
    coord.db.prepare('UPDATE landing_projects SET operatorPaused = 0, mainRedHold = 7').run();
    expect(coord.landingProject(P)).toEqual({ operatorPaused: false, mainRedHold: true });
  });

  it('landingEntries reads a word this build cannot name as unknown, and orders by pinnedAt then id', () => {
    const raw = (pr: number, over: Record<string, string | number>, pinnedAt = 1): void => {
      insertRaw(pr, 'pinned', null, HEAD, pinnedAt);
      for (const [k, v] of Object.entries(over)) {
        coord.db.prepare(`UPDATE landing_entries SET ${k} = ? WHERE pr = ?`).run(v, pr);
      }
    };
    raw(1, { state: 'later' });
    raw(2, { state: 'ejected', ejectionKind: 'sideways' });
    raw(3, { afterIds: 'nope' });
    raw(4, { afterIds: '[3,4]', fixesMain: 1 });
    expect(coord.landingEntries(P).map((e) => [e.pr, e.state, e.ejectionKind, e.afterIds, e.fixesMain])).toEqual([
      [1, 'unknown', null, [], false], [2, 'unknown', null, [], false], [3, 'unknown', null, [], false],
      [4, 'pinned', null, [3, 4], true]]);
    coord.db.exec('DELETE FROM landing_entries');
    raw(10, {}, 5);
    raw(11, {}, 2);
    coord.db.prepare("INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) " +
      "VALUES ('project-b', 12, ?, ?, NULL, 'pinned', 'operator', 1)").run(HEAD, HC);
    expect(coord.landingEntries(P).map((e) => e.pr)).toEqual([11, 10]);
  });
});
