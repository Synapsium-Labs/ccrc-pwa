// D-7319: the dead-dispatch verdict (L1, `coord/deadDispatch.ts`), row by row. Every doubt keeps the run; only a run
// proven dead (planned, unbound, stamped past the bound, claimed, on a marking box, with no workspace for it in a
// registry read whole, the switch on and the cleanup pause clear) is `dead`. The lane test pins what the act does with
// the verdict; this file pins the verdict alone, and that each guard is load-bearing (each row flips one fact).
import { describe, expect, it } from 'vitest';
import {
  DEAD_DISPATCH_KEEPS, deadDispatchVerdict, dispatchAbandonViewOf, type DeadDispatchFacts, type DeadDispatchRecord,
} from '../src/coord/deadDispatch.js';

const NOW = 1_790_000_000_000;
const BOUND = 900_000;
const run = { id: 7, state: 'planned', project: 'project-a', sessionId: null, dispatchStartedAt: NOW - BOUND, claimedBy: 'project-a-coord' };
const coordRow: DeadDispatchRecord = {
  id: 'project-a-coord', project: 'project-a', workspace: null, child: { kind: 'none' }, held: null, spawned: true, identityMeasured: true,
};
const base: DeadDispatchFacts = {
  armed: true, run, childOmitted: false, now: NOW, boundMs: BOUND,
  registry: { listed: true, refused: 0, pause: 'clear', records: [coordRow] },
};
const withRecords = (records: DeadDispatchRecord[]): DeadDispatchFacts =>
  ({ ...base, registry: { listed: true, refused: 0, pause: 'clear', records: [coordRow, ...records] } });
const ws = (over: Partial<DeadDispatchRecord>): DeadDispatchRecord =>
  ({ id: 'project-a-w1', project: 'project-a', workspace: 'w1', child: { kind: 'none' }, held: null, spawned: true, identityMeasured: true, ...over });
const why = (f: DeadDispatchFacts): string => { const v = deadDispatchVerdict(f); return v.kind === 'dead' ? 'dead' : v.why; };

describe('deadDispatchVerdict', () => {
  it('a planned, unbound run stamped exactly the bound ago, claimed, with no workspace for it, is dead', () => {
    expect(deadDispatchVerdict(base)).toEqual({ kind: 'dead', claimedBy: 'project-a-coord', startedAt: NOW - BOUND });
  });

  it('the switch: off keeps it; a pause raised, or one that could not be measured, keeps it', () => {
    expect(why({ ...base, armed: false })).toBe('switch-off');
    expect(why({ ...base, registry: { ...base.registry, pause: 'set' } as DeadDispatchFacts['registry'] })).toBe('paused');
    expect(why({ ...base, registry: { ...base.registry, pause: 'unmeasurable' } as DeadDispatchFacts['registry'] })).toBe('paused');
    expect(why({ ...base, registry: { listed: false } })).toBe('registry-unmeasured');
  });

  it('the run: not planned, bound, unstamped, or with no coordinator to tell, is kept', () => {
    expect(why({ ...base, run: { ...run, state: 'dispatched' } })).toBe('not-planned');
    expect(why({ ...base, run: { ...run, state: 'failed' } })).toBe('not-planned');
    expect(why({ ...base, run: { ...run, sessionId: 'project-a-w1' } })).toBe('bound');
    expect(why({ ...base, run: { ...run, dispatchStartedAt: null } })).toBe('no-stamp');
    expect(why({ ...base, run: { ...run, claimedBy: null } })).toBe('unclaimed');
  });

  it('in flight: a stamp one millisecond younger than the bound keeps it (a retry restamps, so it reads young again)', () => {
    expect(why({ ...base, run: { ...run, dispatchStartedAt: NOW - BOUND + 1 } })).toBe('in-flight');
    expect(why({ ...base, run: { ...run, dispatchStartedAt: NOW } })).toBe('in-flight');
  });

  it('a box that minted without the child marker (`child-omitted:` journaled) cannot prove there is no workspace', () => {
    expect(why({ ...base, childOmitted: true })).toBe('unmarked-box');
  });

  it('a workspace whose marker names the run keeps it, in any project, held or not, spawned or not', () => {
    expect(why(withRecords([ws({ child: { kind: 'child', runId: 7 } })]))).toBe('child-workspace');
    expect(why(withRecords([ws({ project: 'project-b', child: { kind: 'child', runId: 7 }, held: 'run:7', spawned: false })]))).toBe('child-workspace');
    // Another run's child is not this run's.
    expect(why(withRecords([ws({ child: { kind: 'child', runId: 8 } })]))).toBe('dead');
  });

  it("an unreadable marker, an unmeasured identity, or refused names in the run's registry keep it", () => {
    expect(why(withRecords([ws({ child: { kind: 'unreadable' } })]))).toBe('marker-unreadable');
    expect(why(withRecords([ws({ identityMeasured: false })]))).toBe('registry-unmeasured');
    expect(why({ ...base, registry: { listed: true, refused: 1, pause: 'clear', records: [coordRow] } })).toBe('registry-unmeasured');
    // Another project's doubt is not this run's.
    expect(why(withRecords([ws({ project: 'project-b', child: { kind: 'unreadable' } })]))).toBe('dead');
  });

  it("a cut-short ws-add's shape in the run's project (a workspace, no marker, no hold, never spawned) keeps it", () => {
    expect(why(withRecords([ws({ spawned: false })]))).toBe('possible-target');
    // Spawned, held, or not a workspace: an ordinary row of the project, not a cut-short ws-add's.
    expect(why(withRecords([ws({ spawned: true })]))).toBe('dead');
    expect(why(withRecords([ws({ spawned: false, held: 'run:3' })]))).toBe('dead');
    expect(why(withRecords([ws({ spawned: false, workspace: null })]))).toBe('dead');
    expect(why(withRecords([ws({ spawned: false, project: 'project-b' })]))).toBe('dead');
  });

  it("the keep table is these reasons: one per row above, and the executor's own `run-unreadable`", () => {
    expect([...DEAD_DISPATCH_KEEPS].sort()).toEqual([
      'bound', 'child-workspace', 'in-flight', 'marker-unreadable', 'no-stamp', 'not-planned', 'paused', 'possible-target',
      'registry-unmeasured', 'run-unreadable', 'switch-off', 'unclaimed', 'unmarked-box',
    ]);
  });
});

describe('dispatchAbandonViewOf', () => {
  it('only an exact stored `on` arms the act', () => {
    expect(dispatchAbandonViewOf({ kind: 'row', choice: 'on', updatedAt: 0 }, BOUND)).toEqual(
      { stored: 'on', detail: null, armed: true, boundMs: BOUND, updatedAt: 0 });
    expect(dispatchAbandonViewOf({ kind: 'row', choice: 'off', updatedAt: 5 }, BOUND).armed).toBe(false);
    expect(dispatchAbandonViewOf({ kind: 'row', choice: 'ON', updatedAt: 5 }, BOUND)).toMatchObject({ stored: 'unknown', armed: false });
    expect(dispatchAbandonViewOf({ kind: 'row', choice: 1, updatedAt: 5 }, BOUND)).toMatchObject({ stored: 'unknown', armed: false });
    expect(dispatchAbandonViewOf({ kind: 'absent' }, BOUND)).toMatchObject({ stored: 'absent', armed: false, updatedAt: null });
    expect(dispatchAbandonViewOf({ kind: 'unreadable', detail: 'no such table' }, BOUND))
      .toMatchObject({ stored: 'unreadable', detail: 'no such table', armed: false });
  });
});
