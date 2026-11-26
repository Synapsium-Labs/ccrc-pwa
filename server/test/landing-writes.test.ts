// Landing order wave 5f, Task 1: `decideLandingMutation`, the one pure decision under the attributed landing writes
// (coord/landingWrites.ts, L1). Cases are data over `LandingMutationFacts`; no store, no journal.
import { describe, it, expect } from 'vitest';
import { builtinModules } from 'node:module';
import { identifierReferences, parseSource, type ParsedFile } from './scan/parse.js';
import { parsedFile } from './scan/symbols.js';
import {
  decideLandingMutation, landingCommandOf, landingMutationNotice, landingWithdrawNoticesOf, parseLandingDoor, parseLandingWrite,
  type LandingAuthorityCommand, type LandingAuthorityWrite, type LandingMutationFacts, type LandingPauseWrite, type LandingWithdrawWrite,
} from '../src/coord/landingWrites.js';
import { parseLandingJournal } from '../src/coord/landingJournalPolicy.js';
import { deviceActor } from '../src/ccdargv.js';
import {
  landingAssociationReadable, landingEntryFactsOfRow, landingRecordOf, landingRecoveryOf, type LandingEntryFacts, type LandingProjectionWitness,
  type LandingRecoverySubjectFact,
} from '../src/coord/landingEntry.js';
import { LANDING_ENTRY_STATES, LANDING_ENTRY_TERMINAL, type LandingEntry, type LandingEntryState, type LandingRecoverySubject } from '../../shared/landingLine.js';

/** Type-level teeth: the spawned tsc of `typecheck-tests.test.ts` checks these, a vitest run only transpiles them. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

/** Entry `id` is `pr` + 100, so an edge read as a PR number points at nothing. */
const e = (pr: number, over: Partial<LandingEntry> = {}): LandingEntry => ({
  id: pr + 100, project: 'project-a', pr, pinnedSha: 'a'.repeat(40), handoffCommit: 'b'.repeat(40), runId: null,
  state: 'pinned', baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a', pinnedAt: 1000 + pr, ...over });

interface Opts {
  entries: LandingEntry[];
  unreadableProjection?: number[]; unreadableDeps?: number[]; foreign?: number[];
  recovery?: LandingRecoverySubject[]; nextId?: number | null; unreadableRun?: number[];
  quarantined?: number[];
  /** Wave 5j-b: the door facts. `words` overrides an entry's STORED word, `pinTimes` its strict pin time (null: does not
   *  read), `claimedBy` a run's claimant (default `coord`). */
  words?: Record<number, LandingEntryState | 'unrecognised'>; pinTimes?: Record<number, number | null>;
  claimedBy?: Record<number, string | null>; creations?: LandingMutationFacts['creations']; flagsRow?: boolean;
  operatorPaused?: boolean;
}
const facts = (o: Opts): LandingMutationFacts => ({
  project: 'project-a', flags: { operatorPaused: o.operatorPaused ?? false, mainRedHold: false }, entries: o.entries,
  projections: o.entries.map((x) => ({ id: x.id, value: o.unreadableProjection?.includes(x.id) ? { kind: 'unreadable' as const }
    : { kind: 'readable' as const, quarantine: o.quarantined?.includes(x.id) ? 'stale-episode-head' as const : null } })),
  stateWords: o.entries.map((x) => ({ id: x.id, value: o.words?.[x.id] ?? x.state })),
  dependencies: o.entries.map((x) => ({ id: x.id, value: o.unreadableDeps?.includes(x.id) ? { kind: 'unreadable' as const }
    : { kind: 'readable' as const, afterIds: x.afterIds } })),
  recovery: { subjects: o.recovery ?? [], hold: o.recovery?.length ? { reason: 'landing-recovery-unresolved', subjectIds: o.recovery.map((s) => s.id) } : null },
  nextId: o.nextId === undefined ? 900 : o.nextId, foreignIds: o.foreign ?? [],
  coordinators: o.entries.map((x) => ({ id: x.id, value: o.unreadableRun?.includes(x.id) ? { kind: 'unreadable' as const }
    : x.runId === null ? { kind: 'no-run' as const }
      : { kind: 'run' as const, runId: x.runId, claimedBy: o.claimedBy !== undefined && x.id in o.claimedBy ? o.claimedBy[x.id] as string | null : 'coord' } })),
  terminalRepairs: [], creations: o.creations ?? [],
  flagsRow: o.flagsRow ?? false,
  pinTimes: o.entries.map((x) => ({ id: x.id, value: o.pinTimes !== undefined && x.id in o.pinTimes ? o.pinTimes[x.id] as number | null : x.pinnedAt })),
});
const recovered = (id: number, pr: number, projection: LandingRecoverySubject['projection'], project = 'project-a'): LandingRecoverySubject => ({
  id, project, pr, creation: { kind: 'not-recorded' }, historical: { binding: { kind: 'no-run' }, observedSeq: 1 }, projection,
  authority: { kind: 'not-set' } });
const order = (pr: number, patch: { afterIds?: number[]; fixesMain?: boolean } = {}): Extract<LandingAuthorityCommand, { kind: 'order' }> =>
  ({ kind: 'order', project: 'project-a', pr, setBy: 'lane-b', ...patch });
const create = (pr: number): Extract<LandingAuthorityCommand, { kind: 'entry' }> =>
  ({ kind: 'entry', project: 'project-a', pr, pinnedSha: 'c'.repeat(40), handoffCommit: 'd'.repeat(40), setBy: 'lane-b' });
const refused = (c: LandingAuthorityCommand, f: LandingMutationFacts): string | null => {
  const d = decideLandingMutation(c, f);
  return d.ok ? null : d.error;
};
const ok = (c: LandingAuthorityCommand, f: LandingMutationFacts) => {
  const d = decideLandingMutation(c, f);
  if (!d.ok) throw new Error(`refused ${d.error}`);
  return d.mutation;
};
const MISSING = { kind: 'missing', association: 'unmeasured' } as const;

describe('decideLandingMutation: the source', () => {
  it('order-missing-source', () => {
    expect(refused(order(9, { afterIds: [] }), facts({ entries: [e(1)] }))).toBe('landing-entry-missing');
  });
  it('order-unresolved-source', () => {
    const f = facts({ entries: [e(1)], recovery: [recovered(109, 9, MISSING)] });
    expect(refused(order(9, { afterIds: [] }), f)).toBe('landing-recovery-unresolved');
  });
  it('an association-unmeasured source is unresolved, not missing', () => {
    const f = facts({ entries: [e(1)], recovery: [recovered(101, 1, { kind: 'association-unmeasured', reason: 'historical-binding-mismatch' })] });
    expect(refused(order(1, { fixesMain: true }), f)).toBe('landing-recovery-unresolved');
  });
  it('unreadable-source-cannot-journal-placeholders', () => {
    // fixesMain-only patch: the omitted afterIds would otherwise be journalled from the display placeholder [].
    const f = facts({ entries: [e(1, { state: 'unknown' })], unreadableProjection: [101] });
    expect(refused(order(1, { fixesMain: true }), f)).toBe('landing-projection-unreadable');
    expect(refused(order(1, { afterIds: [] }), f)).toBe('landing-projection-unreadable');
  });
  it('ANY unresolved recovery in the project refuses an order write, even one that does not reach it', () => {
    const f = facts({ entries: [e(1), e(2)], recovery: [recovered(150, 50, MISSING)] });
    expect(refused(order(1, { afterIds: [102] }), f)).toBe('landing-recovery-unresolved');
    expect(refused(order(1, { fixesMain: true }), f)).toBe('landing-recovery-unresolved');
  });
  it('the source checks keep their own words ahead of the project-wide recovery refusal', () => {
    const rec = [recovered(150, 50, MISSING)];
    expect(refused(order(9, { afterIds: [] }), facts({ entries: [e(1)], recovery: rec }))).toBe('landing-entry-missing');
    expect(refused(order(1, { afterIds: [] }), facts({ entries: [e(1, { state: 'unknown' })], unreadableProjection: [101], recovery: rec })))
      .toBe('landing-projection-unreadable');
  });
});

describe('decideLandingMutation: targets and graph', () => {
  it('requires-existing-after-target', () => {
    expect(refused(order(1, { afterIds: [999] }), facts({ entries: [e(1)] }))).toBe('landing-after-missing');
  });
  it('requires-same-project-after-target', () => {
    expect(refused(order(1, { afterIds: [500] }), facts({ entries: [e(1)], foreign: [500] }))).toBe('landing-after-cross-project');
  });
  it('recovered-target-is-unmeasured', () => {
    const f = facts({ entries: [e(1)], recovery: [recovered(107, 7, MISSING)] });
    expect(refused(order(1, { afterIds: [107] }), f)).toBe('landing-recovery-unresolved');
  });
  it('a target that is itself in recovery is refused by the project-wide rule, whether or not it is also a known entry', () => {
    const f = facts({ entries: [e(1), e(7)], recovery: [recovered(107, 7, MISSING)] });
    expect(refused(order(1, { afterIds: [107] }), f)).toBe('landing-recovery-unresolved');
    expect(refused(order(1, { afterIds: [107], fixesMain: true }), f)).toBe('landing-recovery-unresolved');
  });
  it('rejects-self-cycle', () => {
    expect(refused(order(1, { afterIds: [101] }), facts({ entries: [e(1)] }))).toBe('landing-cycle');
  });
  it('rejects-transitive-cycle', () => {
    const f = facts({ entries: [e(1), e(2, { afterIds: [101] })] });
    expect(refused(order(1, { afterIds: [102] }), f)).toBe('landing-cycle');
  });
  it('permits-independent-old-cycle', () => {
    const f = facts({ entries: [e(1), e(2, { afterIds: [103] }), e(3, { afterIds: [102] }), e(4)] });
    expect(ok(order(1, { afterIds: [104] }), f)).toMatchObject({ kind: 'order', after: [{ id: 104 }] });
    // and a target that leads INTO the old cycle (never back to the source) terminates through the visited set
    expect(ok(order(1, { afterIds: [102] }), f)).toMatchObject({ kind: 'order' });
  });
  it('permits-source-cycle-repair', () => {
    const f = facts({ entries: [e(1, { afterIds: [102] }), e(2, { afterIds: [101] })] });
    expect(ok(order(1, { afterIds: [] }), f)).toMatchObject({ kind: 'order', after: [], fixesMain: false });
  });
  it('an existing invalid edge reached transitively is after-missing / after-cross-project, not satisfied', () => {
    expect(refused(order(1, { afterIds: [102] }), facts({ entries: [e(1), e(2, { afterIds: [999] })] }))).toBe('landing-after-missing');
    expect(refused(order(1, { afterIds: [102] }), facts({ entries: [e(1), e(2, { afterIds: [500] })], foreign: [500] }))).toBe('landing-after-cross-project');
  });
  it('unreadable-reachable-dependencies-refuse', () => {
    // the unreadable row's raw stored edges close a cycle back to the source (101); its display afterIds [] hides it, and
    // the independent dependency fact says unreadable, so the walk must refuse rather than treat it as a leaf
    const f = facts({ entries: [e(1), e(2, { state: 'unknown', afterIds: [101] })], unreadableDeps: [102] });
    expect(refused(order(1, { afterIds: [102] }), f)).toBe('landing-dependencies-unreadable');
    // reached only transitively through a readable node
    const via = facts({ entries: [e(1), e(2, { afterIds: [103] }), e(3, { state: 'unknown', afterIds: [101] })], unreadableDeps: [103] });
    expect(refused(order(1, { afterIds: [102] }), via)).toBe('landing-dependencies-unreadable');
    // an unreadable row that is NOT reached does not matter
    expect(ok(order(1, { afterIds: [] }), f)).toMatchObject({ kind: 'noop' });
  });
  it('a recovered node reached only transitively refuses recovery-unresolved', () => {
    const f = facts({ entries: [e(1), e(2, { afterIds: [107] })], recovery: [recovered(107, 7, MISSING)] });
    expect(refused(order(1, { afterIds: [102] }), f)).toBe('landing-recovery-unresolved');
  });
  it('a fixesMain-only patch on a source whose current edges cycle back is refused landing-cycle, even unchanged', () => {
    const f = facts({ entries: [e(1, { afterIds: [102] }), e(2, { afterIds: [101] })] });
    expect(refused(order(1, { fixesMain: true }), f)).toBe('landing-cycle');
    expect(refused(order(1, { fixesMain: false }), f)).toBe('landing-cycle');
    // sending afterIds that break the cycle together with fixesMain succeeds
    expect(ok(order(1, { afterIds: [], fixesMain: true }), f)).toMatchObject({ kind: 'order', after: [], fixesMain: true });
  });
  it('readable-unknown-state-is-traversable', () => {
    const f = facts({ entries: [e(1), e(2, { state: 'unknown', afterIds: [103] }), e(3)], quarantined: [102] });
    expect(ok(order(1, { afterIds: [102] }), f)).toMatchObject({ kind: 'order', after: [{ id: 102 }] });
    // its readable edges are walked: an edge back to the source through it is a cycle
    const back = facts({ entries: [e(1), e(2, { state: 'unknown', afterIds: [101] })], quarantined: [102] });
    expect(refused(order(1, { afterIds: [102] }), back)).toBe('landing-cycle');
  });
});

describe('decideLandingMutation: omission, clears and no-ops', () => {
  const base = facts({ entries: [e(1, { afterIds: [102], fixesMain: true }), e(2), e(3)] });
  it('omitted-after-preserves', () => {
    expect(ok(order(1, { fixesMain: false }), base)).toMatchObject({ kind: 'order', after: [{ id: 102 }], fixesMain: false });
  });
  it('omitted-fixes-preserves', () => {
    expect(ok(order(1, { afterIds: [103] }), base)).toMatchObject({ kind: 'order', after: [{ id: 103 }], fixesMain: true });
  });
  it('explicit [] and false are clears', () => {
    expect(ok(order(1, { afterIds: [], fixesMain: false }), base)).toMatchObject({ kind: 'order', after: [], fixesMain: false });
  });
  it('noop: the same resulting afterIds and fixesMain append nothing', () => {
    const m = ok(order(1, { afterIds: [102], fixesMain: true }), base);
    expect(m).toEqual({ kind: 'noop', entry: base.entries[0], coordinator: { kind: 'no-run' } });
    expect(ok(order(1, { fixesMain: true }), base)).toMatchObject({ kind: 'noop' });
  });
  it('a reference carries the target`s current association, never a historical id', () => {
    const f = facts({ entries: [e(1), e(2, { runId: 77 })] });
    expect(ok(order(1, { afterIds: [102] }), f)).toMatchObject({ after: [{ id: 102, binding: { kind: 'run', observedRunId: 77 } }] });
  });
  it('an unreadable or missing current run refuses run-unreadable', () => {
    expect(refused(order(1, { afterIds: [102] }), facts({ entries: [e(1), e(2)], unreadableRun: [102] }))).toBe('run-unreadable');
    expect(refused(order(1, { fixesMain: true }), facts({ entries: [e(1)], unreadableRun: [101] }))).toBe('run-unreadable');
  });
  // Review 1413 A1: the header's step 6 (every association) comes before step 7 (the no-op), so a no-op over a target whose
  // association cannot be read is a refusal, never a success (fail-closed, plan §4 "never no-run").
  it('a no-op over an unreadable or missing target association refuses run-unreadable, never answers noop', () => {
    const kept = { entries: [e(1, { afterIds: [102], fixesMain: true }), e(2), e(3)] };
    const unreadable = facts({ ...kept, unreadableRun: [102] });
    expect(refused(order(1, { afterIds: [102], fixesMain: true }), unreadable)).toBe('run-unreadable');
    // afterIds omitted: the kept edges are the named targets
    expect(refused(order(1, { fixesMain: true }), unreadable)).toBe('run-unreadable');
    const missing = facts(kept);
    missing.coordinators = missing.coordinators.filter((c) => c.id !== 102);
    expect(refused(order(1, { afterIds: [102], fixesMain: true }), missing)).toBe('run-unreadable');
    // CONTROL: the same request over a readable target is the no-op
    expect(ok(order(1, { afterIds: [102], fixesMain: true }), facts(kept))).toMatchObject({ kind: 'noop' });
  });
});

// Review 1413 A2: the source association a journal record carries is the one the decision read, so an unreadable or
// missing coordinator can never be journalled as a no-run binding (CLAUDE.md "no overloaded null at a seam").
describe('the record carries the decided association, never an unreadable one read as no-run', () => {
  /** The decided order's coordinator type admits no unreadable member: the decision refused that already. */
  type OrderMutation = Extract<Extract<ReturnType<typeof decideLandingMutation>, { ok: true }>['mutation'], { kind: 'order' }>;
  type NoopMutation = Extract<Extract<ReturnType<typeof decideLandingMutation>, { ok: true }>['mutation'], { kind: 'noop' }>;
  type _OrderReadable = AssertTrue<Equals<Extract<OrderMutation['coordinator'], { kind: 'unreadable' }>, never>>;
  type _NoopReadable = AssertTrue<Equals<Extract<NoopMutation['coordinator'], { kind: 'unreadable' }>, never>>;
  const proofs: [_OrderReadable, _NoopReadable] = [true, true];
  const recordOf = (cmd: LandingAuthorityCommand, f: LandingMutationFacts) => {
    const d = decideLandingMutation(cmd, f);
    if (!d.ok) return d.error;
    if (d.mutation.kind === 'noop' || d.mutation.kind === 'unchanged') return 'noop';
    return landingRecordOf(cmd, d.mutation, 7, 5000);
  };

  it('an unreadable or missing source association refuses: no record, and so no no-run binding, is made', () => {
    expect(proofs).toEqual([true, true]);
    expect(recordOf(order(1, { fixesMain: true }), facts({ entries: [e(1, { runId: 42 })], unreadableRun: [101] }))).toBe('run-unreadable');
    const missing = facts({ entries: [e(1, { runId: 42 })] });
    missing.coordinators = [];
    expect(recordOf(order(1, { fixesMain: true }), missing)).toBe('run-unreadable');
  });

  it('the decided order carries the source association it read, and the record binds exactly that', () => {
    const f = facts({ entries: [e(1, { runId: 42 })] });
    expect(ok(order(1, { fixesMain: true }), f)).toMatchObject({ kind: 'order', coordinator: { kind: 'run', runId: 42, claimedBy: 'coord' },
      binding: { kind: 'run', observedRunId: 42 } });
    expect(recordOf(order(1, { fixesMain: true }), f)).toMatchObject({ kind: 'order', seq: 7, at: 5000,
      subject: { id: 101, project: 'project-a', pr: 1, binding: { kind: 'run', observedRunId: 42 } } });
    // CONTROL: a genuine no-run association records no-run
    expect(recordOf(order(1, { fixesMain: true }), facts({ entries: [e(1)] })))
      .toMatchObject({ subject: { id: 101, binding: { kind: 'no-run' } } });
  });

  it('the record never re-reads the association from the facts: the decision is the one source', () => {
    const f = facts({ entries: [e(1, { runId: 42 })] });
    const d = decideLandingMutation(order(1, { fixesMain: true }), f);
    if (!d.ok || d.mutation.kind !== 'order') throw new Error('expected an order');
    // the facts row turning unreadable after the decision changes nothing the record says
    f.coordinators = [{ id: 101, value: { kind: 'unreadable' } }];
    expect(landingRecordOf(order(1, { fixesMain: true }), d.mutation, 8, 6000))
      .toMatchObject({ subject: { binding: { kind: 'run', observedRunId: 42 } } });
  });
});

describe('decideLandingMutation: creation', () => {
  it('creates with the allocated id', () => {
    expect(ok(create(5), facts({ entries: [e(1)], nextId: 321 }))).toMatchObject({ kind: 'entry', id: 321, pr: 5, setBy: 'lane-b' });
  });
  it('entry-exists: a projection', () => {
    expect(refused(create(1), facts({ entries: [e(1)] }))).toBe('landing-entry-exists');
  });
  it('entry-exists: a recovered subject with no projection', () => {
    expect(refused(create(9), facts({ entries: [], recovery: [recovered(109, 9, MISSING)] }))).toBe('landing-entry-exists');
  });
  it('any unresolved recovery in the project refuses creation of another entry', () => {
    const f = facts({ entries: [e(1)], recovery: [recovered(150, 50, MISSING)] });
    expect(refused(create(5), f)).toBe('landing-recovery-unresolved');
    // a duplicate keeps its own word
    expect(refused(create(1), f)).toBe('landing-entry-exists');
    expect(refused(create(50), f)).toBe('landing-entry-exists');
  });
  it('id-overflow', () => {
    expect(refused(create(5), facts({ entries: [], nextId: null }))).toBe('landing-id-overflow');
  });
});

describe('decideLandingMutation: identity conflict', () => {
  const conflict = recovered(150, 50, { kind: 'identity-conflict', conflicts: [{ id: 150, project: 'project-b', pr: 8 }] });
  it('refuses every command while the project has an identity conflict', () => {
    const f = facts({ entries: [e(1)], recovery: [conflict] });
    expect(refused(create(5), f)).toBe('landing-identity-conflict');
    expect(refused(order(1, { afterIds: [] }), f)).toBe('landing-identity-conflict');
  });
});

const WHO = { byId: 'lane-b', byUuid: 'u-lane-b' };
const entryIn = { ...WHO, project: 'project-a', pr: 11, pinnedSha: 'a'.repeat(40), handoffCommit: 'b'.repeat(40) };
const orderIn = { ...WHO, project: 'project-a', pr: 11, afterIds: [2], fixesMain: true };
const bad = { ok: false, error: 'bad-request' };

describe('parseLandingWrite (wave 5f Task 2)', () => {
  it('parses an entry and an order, keeping their literal kind', () => {
    expect(parseLandingWrite('entry', entryIn)).toEqual({ ok: true, kind: 'entry', request: entryIn });
    expect(parseLandingWrite('order', orderIn)).toEqual({ ok: true, kind: 'order', request: orderIn });
  });
  it('entry-rejects-authoritative-fields', () => {
    for (const k of ['setBy', 'runId', 'state', 'pinnedAt', 'afterIds', 'ejections', 'id']) {
      expect(parseLandingWrite('entry', { ...entryIn, [k]: k === 'afterIds' ? [] : 'x' }), k).toEqual(bad);
    }
  });
  it('order-rejects-authoritative-fields', () => {
    for (const k of ['setBy', 'runId', 'state', 'at', 'pinnedSha', 'id']) expect(parseLandingWrite('order', { ...orderIn, [k]: 5 }), k).toEqual(bad);
  });
  it('requires an object body and trimmed nonblank identity strings, trimmed on the way in', () => {
    for (const body of [null, undefined, [], 'x', 3]) expect(parseLandingWrite('entry', body)).toEqual(bad);
    for (const k of ['byId', 'byUuid', 'project']) {
      for (const v of ['', '   ', 5, null]) expect(parseLandingWrite('entry', { ...entryIn, [k]: v }), `${k} ${String(v)}`).toEqual(bad);
    }
    expect(parseLandingWrite('entry', { ...entryIn, byId: '  lane-b ', project: ' project-a ' })).toMatchObject({ ok: true, request: { byId: 'lane-b', project: 'project-a' } });
  });
  it('pr is a positive safe integer', () => {
    for (const pr of [0, -1, 1.5, '11', null, Number.MAX_SAFE_INTEGER + 1, NaN]) expect(parseLandingWrite('entry', { ...entryIn, pr }), String(pr)).toEqual(bad);
  });
  it('hashes are 40 lowercase hex', () => {
    for (const v of ['A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), 7, '']) {
      expect(parseLandingWrite('entry', { ...entryIn, pinnedSha: v })).toEqual(bad);
      expect(parseLandingWrite('entry', { ...entryIn, handoffCommit: v })).toEqual(bad);
    }
    expect(parseLandingWrite('entry', { ...entryIn, handoffCommit: undefined })).toEqual(bad);
  });
  it('afterIds is a duplicate-free array of positive safe integers', () => {
    for (const afterIds of [[0], [-1], [1.5], ['1'], [1, 1], 'x', null, {}, [Number.MAX_SAFE_INTEGER + 1]]) {
      expect(parseLandingWrite('order', { ...orderIn, afterIds }), JSON.stringify(afterIds)).toEqual(bad);
    }
  });
  it('fixesMain-must-be-boolean', () => {
    for (const fixesMain of [0, 1, 'true', null, [], {}]) expect(parseLandingWrite('order', { ...orderIn, fixesMain }), String(fixesMain)).toEqual(bad);
  });
  it('preserves omission versus an explicit [] or false, and needs at least one patch key', () => {
    const { afterIds: _a, fixesMain: _f, ...base } = orderIn;
    expect(parseLandingWrite('order', base)).toEqual(bad);
    const onlyFlag = parseLandingWrite('order', { ...base, fixesMain: false });
    expect(onlyFlag).toEqual({ ok: true, kind: 'order', request: { ...base, fixesMain: false } });
    expect(onlyFlag.ok && 'afterIds' in (onlyFlag as { request: object }).request).toBe(false);
    const onlyAfter = parseLandingWrite('order', { ...base, afterIds: [] });
    expect(onlyAfter).toEqual({ ok: true, kind: 'order', request: { ...base, afterIds: [] } });
    expect(onlyAfter.ok && 'fixesMain' in (onlyAfter as { request: object }).request).toBe(false);
  });
  it('the command is built from the attributed id and carries only what was sent', () => {
    const p = parseLandingWrite('order', { ...WHO, project: 'project-a', pr: 11, afterIds: [] });
    if (!p.ok) throw new Error('parse');
    const c = landingCommandOf(p);
    expect(c).toEqual({ kind: 'order', project: 'project-a', pr: 11, setBy: 'lane-b', afterIds: [] });
    expect('fixesMain' in c).toBe(false);
  });
});

describe('landingMutationNotice (wave 5f Task 2)', () => {
  const ok = (over: Partial<Extract<LandingAuthorityWrite, { ok: true }>> = {}): Extract<LandingAuthorityWrite, { ok: true }> =>
    ({ ok: true, entry: e(11, { afterIds: [2], fixesMain: true, setBy: 'lane-b' }), previous: e(11), changed: true, seq: 4,
      coordinator: { kind: 'run', runId: 9, claimedBy: 'coord-a' }, released: [], ...over });
  const cmd = order(11, { afterIds: [2], fixesMain: true });
  it('is due for a foreign changed order, with the exact record', () => {
    expect(landingMutationNotice({ command: cmd, result: ok() })).toEqual({ due: true, event: { kind: 'coord', sessionId: 'lane-b',
      title: 'landing-inversion: project-a #11', body: 'lane-b set project-a #11 afterIds=[2], fixesMain=true', runId: 9 } });
  });
  it('a clear is described by its resulting values', () => {
    const r = ok({ entry: e(11, { afterIds: [], fixesMain: false }) });
    expect(landingMutationNotice({ command: cmd, result: r })).toMatchObject({ due: true, event: { body: 'lane-b set project-a #11 afterIds=[], fixesMain=false' } });
  });
  it('the current run claimant own order, an unchanged order and a creation owe nothing', () => {
    expect(landingMutationNotice({ command: { ...cmd, setBy: 'coord-a' }, result: ok() })).toEqual({ due: false });
    expect(landingMutationNotice({ command: cmd, result: ok({ changed: false, seq: null }) })).toEqual({ due: false });
    expect(landingMutationNotice({ command: create(11), result: ok({ previous: null }) })).toEqual({ due: false });
  });
  it('a no-run or unclaimed current association is always due, with its actual run id or null', () => {
    expect(landingMutationNotice({ command: cmd, result: ok({ coordinator: { kind: 'no-run' } }) })).toMatchObject({ due: true, event: { runId: null } });
    expect(landingMutationNotice({ command: { ...cmd, setBy: 'coord-a' }, result: ok({ coordinator: { kind: 'run', runId: 9, claimedBy: null } }) }))
      .toMatchObject({ due: true, event: { runId: 9, sessionId: 'coord-a' } });
  });
});

describe('landingWrites.ts is the pure L1 module its header says it is', () => {
  const FILE = 'server/src/coord/landingWrites.ts';
  const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
  const isNodeBuiltin = (s: string): boolean => s.startsWith('node:') || NODE_BUILTINS.has(s.split('/')[0]!);
  const valueImports = (p: ParsedFile): string[] => p.imports.filter((x) => x.kind !== 'type-query' && !x.typeOnly).map((x) => x.specifier);
  const builtins = (p: ParsedFile): string[] => p.imports.map((x) => x.specifier).filter(isNodeBuiltin);
  const CLOCK_AND_FS = new Set(['Date', 'performance', 'fs', 'require', 'readFileSync', 'writeFileSync']);
  const clock = (p: ParsedFile): string[] => identifierReferences(p.text, p.path, CLOCK_AND_FS).map((x) => `${x.line} ${x.name}`);
  const probe = (src: string): ParsedFile => parseSource(src, 'probe.ts');
  // The one value import admitted: the shared landing vocabulary, spelled exactly (D-9093, review run 3864's F6 ruling).
  const SHARED_LANDING = '../../../shared/landingLine.js';
  const otherValueImports = (p: ParsedFile): string[] => valueImports(p).filter((s) => s !== SHARED_LANDING);
  it('CONTROL: the scans see a builtin, a value import and a clock; a comment is not a clock', () => {
    expect(builtins(probe(`import { readFileSync } from 'node:fs';`))).toEqual(['node:fs']);
    expect(valueImports(probe(`import { x } from './store.js';`))).toEqual(['./store.js']);
    expect(valueImports(probe(`import type { x } from './store.js';`))).toEqual([]);
    expect(otherValueImports(probe(`import { x } from './store.js';\nimport { y } from '${SHARED_LANDING}';`))).toEqual(['./store.js']);
    expect(otherValueImports(probe(`import { y } from '../../shared/landingLine.js';`))).toEqual(['../../shared/landingLine.js']);
    expect(clock(probe('const t = Date.now();'))).toEqual(['1 Date']);
    expect(clock(probe('// Date.now() is not used\nconst t = 1;'))).toEqual([]);
  });
  it('has no clock, no fs, no node builtin and no value import except the shared landing vocabulary', () => {
    const p = parsedFile(FILE);
    expect(p.symbols.length).toBeGreaterThan(0);
    expect(clock(p)).toEqual([]);
    expect(builtins(p)).toEqual([]);
    expect(otherValueImports(p)).toEqual([]);
  });
});

describe('landingRecoveryOf and landingAssociationReadable (the recovery fold)', () => {
  const HEX = 'a'.repeat(40);
  const row = (id: number, pr: number, over: Record<string, unknown> = {}, project = 'project-a'): LandingEntryFacts =>
    landingEntryFactsOfRow({ id, project, pr, pinnedSha: HEX, handoffCommit: HEX, runId: null, state: 'pinned', baseSha: null, ejectionKind: null,
      ejections: 0, afterIds: '[]', fixesMain: 0, setBy: 'lane-a', pinnedAt: 1, quarantineKind: null, ...over });
  const subject = (id: number, pr: number, over: Partial<LandingRecoverySubjectFact> = {}, project = 'project-a'): LandingRecoverySubjectFact =>
    ({ id, project, pr, binding: { kind: 'no-run' }, observedSeq: 3, creation: { kind: 'not-recorded' }, authority: { kind: 'not-set' }, ...over });
  const witness = (over: Partial<LandingProjectionWitness> = {}): LandingProjectionWitness =>
    ({ id: 1, project: 'project-a', pr: 1, observedSeq: 3, runId: 11, pinnedSha: HEX, handoffCommit: HEX, ...over });
  const none: LandingProjectionWitness[] = [];

  it('a subject with no projection of its identity is missing and holds; nothing is invented', () => {
    const r = landingRecoveryOf('project-a', { subjects: [subject(5, 2)], projections: [], witnesses: none });
    expect(r.hold).toEqual({ reason: 'landing-recovery-unresolved', subjectIds: [5] });
    expect(r.subjects).toEqual([{ id: 5, project: 'project-a', pr: 2, creation: { kind: 'not-recorded' },
      historical: { binding: { kind: 'no-run' }, observedSeq: 3 }, projection: { kind: 'missing', association: 'unmeasured' }, authority: { kind: 'not-set' } }]);
  });
  it('an agreeing exact projection resolves the subject (nothing listed, no hold)', () => {
    expect(landingRecoveryOf('project-a', { subjects: [subject(1, 1)], projections: [row(1, 1)], witnesses: none })).toEqual({ subjects: [], hold: null });
    expect(landingRecoveryOf('project-a', { subjects: [subject(1, 1, { binding: { kind: 'run', observedRunId: 11 } })], projections: [row(1, 1, { runId: 11 })], witnesses: none }).hold).toBeNull();
  });
  it('a contradicting binding is association-unmeasured, in both directions, until a matching witness', () => {
    const noRunVsRun = { subjects: [subject(1, 1)], projections: [row(1, 1, { runId: 11 })] };
    expect(landingRecoveryOf('project-a', { ...noRunVsRun, witnesses: none }).subjects[0]!.projection)
      .toEqual({ kind: 'association-unmeasured', reason: 'historical-binding-mismatch' });
    const runVsNoRun = { subjects: [subject(1, 1, { binding: { kind: 'run', observedRunId: 11 } })], projections: [row(1, 1)] };
    expect(landingRecoveryOf('project-a', { ...runVsNoRun, witnesses: none }).hold?.subjectIds).toEqual([1]);
    const otherRun = { subjects: [subject(1, 1, { binding: { kind: 'run', observedRunId: 12 } })], projections: [row(1, 1, { runId: 11 })] };
    expect(landingRecoveryOf('project-a', { ...otherRun, witnesses: none }).hold?.subjectIds).toEqual([1]);
    expect(landingRecoveryOf('project-a', { ...noRunVsRun, witnesses: [witness()] }).hold).toBeNull();
  });
  it('the witness must match identity, observedSeq, runId, head and handoff exactly', () => {
    const input = { subjects: [subject(1, 1)], projections: [row(1, 1, { runId: 11 })] };
    for (const bad of [{ observedSeq: 2 }, { runId: 12 }, { pinnedSha: 'b'.repeat(40) }, { handoffCommit: 'b'.repeat(40) }, { pr: 9 }, { project: 'project-b' }, { id: 2 }]) {
      expect(landingRecoveryOf('project-a', { ...input, witnesses: [witness(bad)] }).hold, JSON.stringify(bad)).not.toBeNull();
    }
  });
  it('an ID collision lists the conflicting identity and shows in every involved project', () => {
    const input = { subjects: [subject(5, 2)], projections: [row(5, 9, {}, 'project-b')], witnesses: none };
    const a = landingRecoveryOf('project-a', input);
    const b = landingRecoveryOf('project-b', input);
    for (const r of [a, b]) {
      expect(r.subjects[0]!.projection).toEqual({ kind: 'identity-conflict', conflicts: [{ id: 5, project: 'project-b', pr: 9 }] });
      expect(r.hold?.subjectIds).toEqual([5]);
    }
    expect(landingRecoveryOf('project-c', input)).toEqual({ subjects: [], hold: null });
  });
  it('a project/pr collision under another id is a conflict too, whatever the projection state', () => {
    const r = landingRecoveryOf('project-a', { subjects: [subject(5, 2)], projections: [row(6, 2, { state: 'landed' })], witnesses: none });
    expect(r.subjects[0]!.projection).toEqual({ kind: 'identity-conflict', conflicts: [{ id: 6, project: 'project-a', pr: 2 }] });
  });
  it('hold ids are sorted and deduplicated', () => {
    const r = landingRecoveryOf('project-a', { subjects: [subject(9, 3), subject(4, 1), subject(7, 2)], projections: [], witnesses: none });
    expect(r.hold?.subjectIds).toEqual([4, 7, 9]);
  });
  it('landingAssociationReadable needs exact identity', () => {
    const entry = row(1, 1).entry;
    const s = { id: 1, project: 'project-a', pr: 1, binding: { kind: 'no-run' } as const, observedSeq: 3 };
    expect(landingAssociationReadable({ subject: s, entry, witness: null })).toBe(true);
    expect(landingAssociationReadable({ subject: { ...s, pr: 2 }, entry, witness: null })).toBe(false);
    expect(landingAssociationReadable({ subject: { ...s, id: 2 }, entry, witness: null })).toBe(false);
  });
});

// ── Landing order wave 5j-b, Task 7 (D-9049, D-9050): the operator's two doors, decided purely ──────────────────────
const withdraw = (pr: number, pinnedAt: number, actor = 'flag-off'): Extract<LandingAuthorityCommand, { kind: 'withdraw' }> =>
  ({ kind: 'withdraw', project: 'project-a', pr, pinnedAt, setBy: 'operator', actor });
const pause = (paused: boolean, project = 'project-a', actor = 'flag-off'): Extract<LandingAuthorityCommand, { kind: 'pause' }> =>
  ({ kind: 'pause', project, paused, setBy: 'operator', actor });
type WithdrawMutation = Extract<Extract<ReturnType<typeof decideLandingMutation>, { ok: true }>['mutation'], { kind: 'withdraw' }>;
const withdrawn = (c: LandingAuthorityCommand, f: LandingMutationFacts): WithdrawMutation => {
  const m = ok(c, f);
  if (m.kind !== 'withdraw') throw new Error(`expected a withdraw, got ${m.kind}`);
  return m;
};
/** A line: A (head), B after A, C after B, all run-bound to runs 11, 12, 13. */
const line = (): LandingEntry[] => [e(1, { runId: 11 }), e(2, { runId: 12, afterIds: [101] }), e(3, { runId: 13, afterIds: [102] })];

describe('parseLandingDoor (wave 5j-b)', () => {
  it('accepts exactly the two closed bodies', () => {
    expect(parseLandingDoor('withdraw', { project: 'project-a', pr: 7, pinnedAt: 0 }))
      .toEqual({ ok: true, kind: 'withdraw', project: 'project-a', pr: 7, pinnedAt: 0 });
    expect(parseLandingDoor('pause', { project: ' project-a ', paused: false })).toEqual({ ok: true, kind: 'pause', project: 'project-a', paused: false });
  });
  it('refuses each extra key, so no successor field can ride along', () => {
    for (const k of ['after', 'afterIds', 'fixesMain', 'head', 'next', 'setBy', 'actor']) {
      expect(parseLandingDoor('withdraw', { project: 'project-a', pr: 7, pinnedAt: 1, [k]: [] }), k).toEqual(bad);
      expect(parseLandingDoor('pause', { project: 'project-a', paused: true, [k]: [] }), k).toEqual(bad);
    }
    // a key of the other door is an extra key too
    expect(parseLandingDoor('pause', { project: 'project-a', paused: true, pr: 7 })).toEqual(bad);
    expect(parseLandingDoor('withdraw', { project: 'project-a', pr: 7, pinnedAt: 1, paused: true })).toEqual(bad);
  });
  it('refuses a blank project, a non-boolean paused, a bad pr or pinnedAt, a missing key and a non-object body', () => {
    for (const project of ['', '  ', 5, null]) expect(parseLandingDoor('pause', { project, paused: true }), String(project)).toEqual(bad);
    for (const paused of [0, 1, 'true', null, undefined]) expect(parseLandingDoor('pause', { project: 'project-a', paused }), String(paused)).toEqual(bad);
    for (const pinnedAt of [-1, 1.5, '1', null, undefined, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(parseLandingDoor('withdraw', { project: 'project-a', pr: 7, pinnedAt }), String(pinnedAt)).toEqual(bad);
    }
    for (const pr of [0, -1, 1.5, '7', null]) expect(parseLandingDoor('withdraw', { project: 'project-a', pr, pinnedAt: 1 }), String(pr)).toEqual(bad);
    for (const body of [null, undefined, [], [{ project: 'project-a', paused: true }], 'x', 3]) {
      expect(parseLandingDoor('pause', body)).toEqual(bad);
      expect(parseLandingDoor('withdraw', body)).toEqual(bad);
    }
  });
});

describe('decideLandingMutation: withdraw (wave 5j-b, section 4.4)', () => {
  const conflict = recovered(150, 50, { kind: 'identity-conflict', conflicts: [{ id: 150, project: 'project-b', pr: 8 }] });
  it('1. an identity conflict listed in the project refuses', () => {
    expect(refused(withdraw(1, 1001), facts({ entries: line(), recovery: [conflict] }))).toBe('landing-identity-conflict');
  });
  it('2. an absent entry is missing, or unresolved when a listed subject has its key', () => {
    expect(refused(withdraw(9, 1009), facts({ entries: line() }))).toBe('landing-entry-missing');
    expect(refused(withdraw(9, 1009), facts({ entries: line(), recovery: [recovered(109, 9, MISSING)] }))).toBe('landing-recovery-unresolved');
  });
  it('3. the entry own listed subject refuses; another subject hold does not stop a subtractive act', () => {
    const own = recovered(101, 1, { kind: 'association-unmeasured', reason: 'historical-binding-mismatch' });
    expect(refused(withdraw(1, 1001), facts({ entries: line(), recovery: [own] }))).toBe('landing-recovery-unresolved');
    expect(withdrawn(withdraw(1, 1001), facts({ entries: line(), recovery: [recovered(150, 50, MISSING)] })).entry.id).toBe(101);
  });
  it('4. a terminal stored word refuses terminal; an unrecognised one refuses projection-unreadable', () => {
    for (const w of ['landed', 'withdrawn', 'closed'] as const) {
      expect(refused(withdraw(1, 1001), facts({ entries: line(), words: { 101: w } })), w).toBe('landing-entry-terminal');
    }
    expect(refused(withdraw(1, 1001), facts({ entries: line(), words: { 101: 'unrecognised' } }))).toBe('landing-projection-unreadable');
  });
  it('5. a pin time that moved, or that does not read, refuses moved', () => {
    expect(refused(withdraw(1, 1000), facts({ entries: line() }))).toBe('landing-entry-moved');
    expect(refused(withdraw(1, 1001), facts({ entries: line(), pinTimes: { 101: null } }))).toBe('landing-entry-moved');
  });
  it('5. a damaged row shown with pinnedAt 0, withdrawn with pinnedAt 0, refuses moved: the display is never read', () => {
    const f = facts({ entries: [e(1, { state: 'unknown', pinnedAt: 0 })], words: { 101: 'pinned' }, pinTimes: { 101: null } });
    expect(refused(withdraw(1, 0), f)).toBe('landing-entry-moved');
  });
  it('6. the entry own unreadable association refuses run-unreadable, and so does a missing one', () => {
    expect(refused(withdraw(1, 1001), facts({ entries: line(), unreadableRun: [101] }))).toBe('run-unreadable');
    const missing = facts({ entries: line() });
    missing.coordinators = missing.coordinators.filter((c) => c.id !== 101);
    expect(refused(withdraw(1, 1001), missing)).toBe('run-unreadable');
  });
  it('the earlier refusal answers where two hold', () => {
    // terminal and a stale pin time: terminal (step 4 before step 5)
    expect(refused(withdraw(1, 5), facts({ entries: line(), words: { 101: 'landed' } }))).toBe('landing-entry-terminal');
    // a listed own subject that is also terminal: recovery (step 3 before step 4)
    const own = recovered(101, 1, MISSING);
    expect(refused(withdraw(1, 1001), facts({ entries: line(), words: { 101: 'landed' }, recovery: [own] }))).toBe('landing-recovery-unresolved');
    // unrecognised and an unreadable association: projection-unreadable (step 4 before step 6)
    expect(refused(withdraw(1, 1001), facts({ entries: line(), words: { 101: 'unrecognised' }, unreadableRun: [101] }))).toBe('landing-projection-unreadable');
    // a stale pin time and an unreadable association: moved (step 5 before step 6)
    expect(refused(withdraw(1, 7), facts({ entries: line(), unreadableRun: [101] }))).toBe('landing-entry-moved');
  });
  it('accepts the head, an ejected entry, a quarantined unknown row and a row whose pinnedSha does not read', () => {
    expect(withdrawn(withdraw(1, 1001), facts({ entries: line() }))).toMatchObject({ kind: 'withdraw', entry: { id: 101 } });
    expect(withdrawn(withdraw(2, 1002), facts({ entries: [e(1), e(2, { state: 'ejected' })] }))).toMatchObject({ entry: { id: 102 } });
    expect(withdrawn(withdraw(2, 1002), facts({ entries: [e(1), e(2, { state: 'unknown' })], quarantined: [102] })))
      .toMatchObject({ entry: { id: 102 } });
    expect(withdrawn(withdraw(2, 1002), facts({ entries: [e(1), e(2, { pinnedSha: 'not-a-sha' })], unreadableProjection: [102] })))
      .toMatchObject({ entry: { id: 102 } });
  });
  it('carries the entry, its current association and the journal binding it read', () => {
    const m = withdrawn(withdraw(1, 1001), facts({ entries: line() }));
    expect(m.coordinator).toEqual({ kind: 'run', runId: 11, claimedBy: 'coord' });
    expect(m.binding).toEqual({ kind: 'run', observedRunId: 11 });
    const noRun = withdrawn(withdraw(1, 1001), facts({ entries: [e(1)] }));
    expect(noRun.coordinator).toEqual({ kind: 'no-run' });
    expect(noRun.binding).toEqual({ kind: 'no-run' });
  });
});

describe('decideLandingMutation: the withdrawal recipients (wave 5j-b, D-9050)', () => {
  it('a run-bound entry tells its run claimant, never the creation claimant', () => {
    const f = facts({ entries: line(), claimedBy: { 101: 'coord-a' }, creations: [{ id: 101, seq: 1, setBy: 'creator-a' }] });
    expect(withdrawn(withdraw(1, 1001), f).recipient).toEqual({ kind: 'session', toId: 'coord-a' });
  });
  it('a run-less entry tells its recorded creation claimant', () => {
    const f = facts({ entries: [e(1)], creations: [{ id: 101, seq: 1, setBy: 'creator-a' }] });
    expect(withdrawn(withdraw(1, 1001), f).recipient).toEqual({ kind: 'session', toId: 'creator-a' });
  });
  it('nobody to tell: a run with no claimant is unclaimed, a run-less entry with no recorded creation is unrecorded', () => {
    expect(withdrawn(withdraw(1, 1001), facts({ entries: line(), claimedBy: { 101: null } })).recipient).toEqual({ kind: 'none', reason: 'unclaimed' });
    expect(withdrawn(withdraw(1, 1001), facts({ entries: [e(1)] })).recipient).toEqual({ kind: 'none', reason: 'unrecorded' });
  });
  it('dependants are the direct ones only, never transitive, never a terminal one, never one whose edges do not read', () => {
    const entries = [...line(), e(4, { runId: 14, afterIds: [101], state: 'ejected' }), e(5, { afterIds: [101] }), e(6, { runId: 16, afterIds: [101] }),
      e(7, { runId: 17, afterIds: [101] })];
    const f = facts({ entries, words: { 106: 'landed' }, unreadableDeps: [107], claimedBy: { 102: 'coord-b', 104: null },
      creations: [{ id: 105, seq: 2, setBy: 'creator-e' }] });
    const m = withdrawn(withdraw(1, 1001), f);
    expect(m.dependants.map((d) => [d.entry.id, d.recipient])).toEqual([
      [102, { kind: 'session', toId: 'coord-b' }],
      [104, { kind: 'none', reason: 'unclaimed' }],
      [105, { kind: 'session', toId: 'creator-e' }],
    ]);
  });
  it('a dependant whose association does not read keeps the facts word: the withdrawal is still decided', () => {
    const m = withdrawn(withdraw(1, 1001), facts({ entries: line(), unreadableRun: [102] }));
    expect(m.dependants).toEqual([{ entry: line()[1], recipient: { kind: 'unreadable' } }]);
  });
});

describe('decideLandingMutation: pause and resume (wave 5j-b, F5 ruling)', () => {
  it('a pause and a resume of a known project decide alike, each to its value', () => {
    expect(ok(pause(true), facts({ entries: line() }))).toEqual({ kind: 'pause', project: 'project-a', paused: true });
    expect(ok(pause(false), facts({ entries: line(), operatorPaused: true }))).toEqual({ kind: 'pause', project: 'project-a', paused: false });
  });
  it('equal values answer unchanged', () => {
    expect(ok(pause(false), facts({ entries: line() }))).toEqual({ kind: 'unchanged', project: 'project-a', operatorPaused: false });
    expect(ok(pause(true), facts({ entries: line(), operatorPaused: true }))).toEqual({ kind: 'unchanged', project: 'project-a', operatorPaused: true });
  });
  it('a project the line has never seen is unknown; a flags row, an entry or a listed subject makes it known', () => {
    expect(refused(pause(true), facts({ entries: [] }))).toBe('landing-project-unknown');
    expect(refused(pause(false), facts({ entries: [] }))).toBe('landing-project-unknown');
    expect(ok(pause(true), facts({ entries: [], flagsRow: true }))).toMatchObject({ kind: 'pause' });
    expect(ok(pause(true), facts({ entries: [], recovery: [recovered(109, 9, MISSING)] }))).toMatchObject({ kind: 'pause' });
    // a listed subject of ANOTHER project (an identity conflict shows in both) does not make this project known by itself
    const other = recovered(150, 50, { kind: 'identity-conflict', conflicts: [{ id: 150, project: 'project-a', pr: 8 }] }, 'project-b');
    expect(refused(pause(true), facts({ entries: [], recovery: [other] }))).toBe('landing-project-unknown');
  });
  it('neither a recovery hold nor an identity conflict refuses a pause or a resume', () => {
    const conflict = recovered(150, 50, { kind: 'identity-conflict', conflicts: [{ id: 150, project: 'project-b', pr: 8 }] });
    expect(ok(pause(true), facts({ entries: line(), recovery: [recovered(109, 9, MISSING)] }))).toMatchObject({ kind: 'pause', paused: true });
    expect(ok(pause(true), facts({ entries: line(), recovery: [conflict] }))).toMatchObject({ kind: 'pause', paused: true });
    expect(ok(pause(false), facts({ entries: line(), recovery: [conflict], operatorPaused: true }))).toMatchObject({ kind: 'pause', paused: false });
  });
});

describe('landingRecordOf: the door records round-trip through the journal parser (wave 5j-b)', () => {
  // A real, long User-Agent, cut by the device actor owner at 120 code units: one whose cut ends in a space, one whose
  // cut falls inside an emoji (a lone high surrogate is not a control character, so the owner's text keeps it).
  const SPACE_AT_CUT = `${'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778 Safari/537.36 Edg/131.0.2903'.padEnd(119, 'x')} tail`;
  const EMOJI_AT_CUT = `${'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'.padEnd(119, 'y')}\u{1F600} more`;
  it('CONTROL: the two labels cut where the case says', () => {
    expect(deviceActor(SPACE_AT_CUT).endsWith(' ')).toBe(true);
    expect(deviceActor(SPACE_AT_CUT).length).toBe('device:'.length + 120);
    expect(deviceActor(EMOJI_AT_CUT).charCodeAt(deviceActor(EMOJI_AT_CUT).length - 1)).toBe(0xd83d);
  });
  it.each([['flag-off'], ['unmeasured'], [deviceActor(SPACE_AT_CUT)], [deviceActor(EMOJI_AT_CUT)]])('actor %j: both records parse', (actor) => {
    const f = facts({ entries: line() });
    const wc = withdraw(1, 1001, actor);
    const rec = landingRecordOf(wc, withdrawn(wc, f), 1, 5000);
    expect(rec).toEqual({ v: 1, seq: 1, at: 5000, setBy: 'operator', subject: { id: 101, project: 'project-a', pr: 1, binding: { kind: 'run', observedRunId: 11 } },
      kind: 'withdraw', actor });
    const pc = pause(true, 'project-a', actor);
    const pm = ok(pc, f);
    if (pm.kind !== 'pause') throw new Error('expected a pause');
    const prec = landingRecordOf(pc, pm, 2, 6000);
    expect(prec).toEqual({ v: 1, seq: 2, at: 6000, setBy: 'operator', kind: 'pause', project: 'project-a', paused: true, actor });
    const parsed = parseLandingJournal(`${JSON.stringify(rec)}\n${JSON.stringify(prec)}\n`);
    expect(parsed).toEqual({ ok: true, records: [rec, prec], lastSeq: 2 });
  });
});

describe('landingWithdrawNoticesOf (wave 5j-b, D-9050)', () => {
  const f = facts({ entries: [...line(), e(4, { afterIds: [101] }), e(5, { runId: 15, afterIds: [101] })], claimedBy: { 101: 'coord-a', 102: 'coord-b', 105: null },
    creations: [{ id: 104, seq: 3, setBy: 'creator-d' }] });
  const m = withdrawn(withdraw(1, 1001), f);
  const notices = landingWithdrawNoticesOf({ project: 'project-a', mutation: m, seq: 9, at: Date.UTC(2026, 10, 25, 14, 30, 5, 7) });
  it('one notice to the entry coordinator and one per direct dependant, none for a none recipient', () => {
    expect(notices.map((n) => [n.word, n.toId, n.pr])).toEqual([
      ['landing-withdrawn', 'coord-a', 1], ['landing-held', 'coord-b', 2], ['landing-held', 'creator-d', 4]]);
  });
  it('the identity tuples', () => {
    expect(notices[0]!.identity).toBe(JSON.stringify(['landing-withdrawn', 1, 'project-a', 101, 1, 9, 'coord-a']));
    expect(notices[1]!.identity).toBe(JSON.stringify(['landing-held', 1, 'project-a', 102, 2, 101, 9, 'coord-b']));
  });
  it('the entry notice says what happened, that nothing chose a successor, the candidate drop and the retreat first', () => {
    const b = notices[0]!.body;
    for (const want of ['The operator withdrew project-a #1 (entry 101, state pinned, pinned at ' + 'a'.repeat(40) + ') at 2026-11-25T14:30:05.007Z, journal seq 9.',
      'Nothing chose a successor', 'keeps waiting', 'Do not land this PR at that pin', 'ccd land-candidate --project project-a --pr 1 --drop']) {
      expect(b, want).toContain(want);
    }
    expect(b.indexOf('retreat')).toBeGreaterThan(-1);
    expect(b.indexOf('retreat')).toBeLessThan(b.indexOf('new advance'));
  });
  it('a run-less entry notice says it cannot come back yet', () => {
    const g = facts({ entries: [e(1)], creations: [{ id: 101, seq: 1, setBy: 'creator-a' }] });
    const [n] = landingWithdrawNoticesOf({ project: 'project-a', mutation: withdrawn(withdraw(1, 1001), g), seq: 2, at: 0 });
    expect(n!.toId).toBe('creator-a');
    expect(n!.body).toContain('cannot come back yet');
    expect(n!.body).toContain('landing-entry-exists');
    expect(n!.body).not.toContain('retreat');
  });
  it('a dependant notice names the wait, the release by any attributed session, and how the wait ends', () => {
    const b = notices[1]!.body;
    for (const want of ['project-a #2 waits on #1, which the operator withdrew', 'will not land while that edge stands',
      'Any attributed session may release it', 'POST /api/landing/order', 'the feed records', 're-enters', 'cannot re-enter yet']) {
      expect(b, want).toContain(want);
    }
  });
  it('builds nothing for an unreadable dependant', () => {
    const u = withdrawn(withdraw(1, 1001), facts({ entries: line(), unreadableRun: [102] }));
    expect(landingWithdrawNoticesOf({ project: 'project-a', mutation: u, seq: 3, at: 0 }).map((n) => n.word)).toEqual(['landing-withdrawn']);
  });
});

describe('landingMutationNotice: the doors feed events (wave 5j-b)', () => {
  const entry = e(1, { runId: 11, state: 'withdrawn' });
  const pauseOk = (over: Partial<Extract<LandingPauseWrite, { ok: true }>> = {}): Extract<LandingPauseWrite, { ok: true }> =>
    ({ ok: true, project: 'project-a', operatorPaused: true, changed: true, seq: 4, ...over });
  it('a changed pause and a changed resume each owe one record, sessionId empty, the actor in the body', () => {
    expect(landingMutationNotice({ command: pause(true, 'project-a', 'device:phone'), result: pauseOk() })).toEqual({ due: true,
      event: { kind: 'coord', sessionId: '', title: 'landing-paused: project-a', body: 'device:phone paused the landing line of project-a (journal seq 4)', runId: null } });
    expect(landingMutationNotice({ command: pause(false), result: pauseOk({ operatorPaused: false }) })).toMatchObject({ due: true,
      event: { sessionId: '', title: 'landing-resumed: project-a', body: 'flag-off resumed the landing line of project-a (journal seq 4)' } });
  });
  it('an unchanged pause owes nothing', () => {
    expect(landingMutationNotice({ command: pause(true), result: pauseOk({ changed: false, seq: null }) })).toEqual({ due: false });
  });
  it('a withdrawal owes one record naming the actor, each notice queued, each none with its reason, each unreadable', () => {
    const result: Extract<LandingWithdrawWrite, { ok: true }> = { ok: true, entry, previous: e(1, { runId: 11 }), changed: true, seq: 5,
      coordinator: { kind: 'run', runId: 11, claimedBy: 'coord-a' }, notices: [
        { word: 'landing-withdrawn', entryId: 101, kind: 'queued', toId: 'coord-a', mailId: 7, deliveryId: 8 },
        { word: 'landing-held', entryId: 102, kind: 'none', reason: 'unclaimed' },
        { word: 'landing-held', entryId: 103, kind: 'unreadable' },
        { word: 'landing-held', entryId: 104, kind: 'none', reason: 'unrecorded' }] };
    const owed = landingMutationNotice({ command: withdraw(1, 1001, 'device:phone'), result });
    expect(owed).toMatchObject({ due: true, event: { kind: 'coord', sessionId: '', title: 'landing-withdrawn: project-a #1', runId: 11 } });
    const body = owed.due ? owed.event.body : '';
    for (const want of ['device:phone withdrew project-a #1 (entry 101, journal seq 5)', 'landing-withdrawn to coord-a (entry 101)',
      'landing-held: no coordinator to tell (unclaimed) (entry 102)', 'landing-held: association unreadable (entry 103)',
      'landing-held: no coordinator to tell (unrecorded) (entry 104)']) {
      expect(body, want).toContain(want);
    }
  });
});

describe('landingMutationNotice: a release of a withdrawn hold is always in the feed (wave 5j-b, section 11 C1)', () => {
  const orderOk = (over: Partial<Extract<LandingAuthorityWrite, { ok: true }>> = {}): Extract<LandingAuthorityWrite, { ok: true }> =>
    ({ ok: true, entry: e(3, { runId: 13, afterIds: [] }), previous: e(3, { runId: 13, afterIds: [102] }), changed: true, seq: 6,
      coordinator: { kind: 'run', runId: 13, claimedBy: 'coord-c' }, released: [{ entryId: 102, pr: 2 }], ...over });
  const cmd = (setBy: string): Extract<LandingAuthorityCommand, { kind: 'order' }> => ({ kind: 'order', project: 'project-a', pr: 3, afterIds: [], setBy });
  it('the run own claimant release owes the event, naming the released target by PR', () => {
    const owed = landingMutationNotice({ command: cmd('coord-c'), result: orderOk() });
    expect(owed).toMatchObject({ due: true, event: { sessionId: 'coord-c', title: 'landing-inversion: project-a #3', runId: 13 } });
    expect(owed.due ? owed.event.body : '').toContain('released the withdrawn #2');
  });
  it('so does another session, and a run-less or unclaimed dependant', () => {
    expect(landingMutationNotice({ command: cmd('lane-b'), result: orderOk() })).toMatchObject({ due: true, event: { sessionId: 'lane-b' } });
    expect(landingMutationNotice({ command: cmd('lane-b'), result: orderOk({ coordinator: { kind: 'no-run' } }) })).toMatchObject({ due: true });
    expect(landingMutationNotice({ command: cmd('coord-c'), result: orderOk({ coordinator: { kind: 'run', runId: 13, claimedBy: null } }) }))
      .toMatchObject({ due: true });
  });
  it('a changed order by the run own claimant that releases nothing still owes none', () => {
    expect(landingMutationNotice({ command: cmd('coord-c'), result: orderOk({ released: [] }) })).toEqual({ due: false });
  });
  it('the decider names the released withdrawn targets: dropped edges whose stored word is withdrawn, and only those', () => {
    const entries = [e(1, { runId: 11 }), e(2, { runId: 12, state: 'withdrawn' }), e(3, { runId: 13, afterIds: [101, 102] })];
    const f = facts({ entries });
    expect(ok(order(3, { afterIds: [101] }), f)).toMatchObject({ kind: 'order', released: [{ entryId: 102, pr: 2 }] });
    expect(ok(order(3, { afterIds: [] }), f)).toMatchObject({ kind: 'order', released: [{ entryId: 102, pr: 2 }] });
    // a dropped edge to a pinned target releases no withdrawn hold
    expect(ok(order(3, { afterIds: [102] }), f)).toMatchObject({ kind: 'order', released: [] });
    // the stored word decides, not the display: a display-unknown row stored withdrawn is a release
    const g = facts({ entries: [e(1), e(2, { state: 'unknown' }), e(3, { afterIds: [102] })], words: { 102: 'withdrawn' } });
    expect(ok(order(3, { afterIds: [] }), g)).toMatchObject({ kind: 'order', released: [{ entryId: 102, pr: 2 }] });
  });
});

describe('the withdraw arm reads terminal exactly as L0 classifies it (one copy, LANDING_ENTRY_TERMINAL, D-9093)', () => {
  it.each([...LANDING_ENTRY_STATES])('stored word %s', (w) => {
    const f = facts({ entries: line(), words: { 101: w } });
    const got = refused(withdraw(1, 1001), f);
    if (LANDING_ENTRY_TERMINAL[w]) expect(got).toBe('landing-entry-terminal');
    else expect(got).toBeNull();
    // and a dependant stored under that word is told only when it is not terminal
    const g = facts({ entries: line(), words: { 102: w } });
    expect(withdrawn(withdraw(1, 1001), g).dependants.map((d) => d.entry.id)).toEqual(LANDING_ENTRY_TERMINAL[w] ? [] : [102]);
  });
});
