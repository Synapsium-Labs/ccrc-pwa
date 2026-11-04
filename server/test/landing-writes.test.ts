// Landing order wave 5f, Task 1: `decideLandingMutation`, the one pure decision under the attributed landing writes
// (coord/landingWrites.ts, L1). Cases are data over `LandingMutationFacts`; no store, no journal.
import { describe, it, expect } from 'vitest';
import { builtinModules } from 'node:module';
import { identifierReferences, parseSource, type ParsedFile } from './scan/parse.js';
import { parsedFile } from './scan/symbols.js';
import {
  decideLandingMutation, landingCommandOf, landingMutationNotice, parseLandingWrite, type LandingAuthorityCommand, type LandingAuthorityWrite,
  type LandingMutationFacts,
} from '../src/coord/landingWrites.js';
import {
  landingAssociationReadable, landingEntryFactsOfRow, landingRecordOf, landingRecoveryOf, type LandingEntryFacts, type LandingProjectionWitness,
  type LandingRecoverySubjectFact,
} from '../src/coord/landingEntry.js';
import type { LandingEntry, LandingRecoverySubject } from '../../shared/landingLine.js';

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
}
const facts = (o: Opts): LandingMutationFacts => ({
  project: 'project-a', flags: { operatorPaused: false, mainRedHold: false }, entries: o.entries,
  projections: o.entries.map((x) => ({ id: x.id, value: o.unreadableProjection?.includes(x.id) ? { kind: 'unreadable' as const }
    : { kind: 'readable' as const, quarantine: o.quarantined?.includes(x.id) ? 'stale-episode-head' as const : null } })),
  dependencies: o.entries.map((x) => ({ id: x.id, value: o.unreadableDeps?.includes(x.id) ? { kind: 'unreadable' as const }
    : { kind: 'readable' as const, afterIds: x.afterIds } })),
  recovery: { subjects: o.recovery ?? [], hold: o.recovery?.length ? { reason: 'landing-recovery-unresolved', subjectIds: o.recovery.map((s) => s.id) } : null },
  nextId: o.nextId === undefined ? 900 : o.nextId, foreignIds: o.foreign ?? [],
  coordinators: o.entries.map((x) => ({ id: x.id, value: o.unreadableRun?.includes(x.id) ? { kind: 'unreadable' as const }
    : x.runId === null ? { kind: 'no-run' as const } : { kind: 'run' as const, runId: x.runId, claimedBy: 'coord' } })),
});
const recovered = (id: number, pr: number, projection: LandingRecoverySubject['projection'], project = 'project-a'): LandingRecoverySubject => ({
  id, project, pr, creation: { kind: 'not-recorded' }, historical: { binding: { kind: 'no-run' }, observedSeq: 1 }, projection,
  authority: { kind: 'not-set' } });
const order = (pr: number, patch: { afterIds?: number[]; fixesMain?: boolean } = {}): LandingAuthorityCommand =>
  ({ kind: 'order', project: 'project-a', pr, setBy: 'lane-b', ...patch });
const create = (pr: number): LandingAuthorityCommand =>
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
    if (d.mutation.kind === 'noop') return 'noop';
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
      coordinator: { kind: 'run', runId: 9, claimedBy: 'coord-a' }, ...over });
  const cmd = order(11, { afterIds: [2], fixesMain: true });
  it('is due for a foreign changed order, with the exact record', () => {
    expect(landingMutationNotice(cmd, ok())).toEqual({ due: true, event: { kind: 'coord', sessionId: 'lane-b',
      title: 'landing-inversion: project-a #11', body: 'lane-b set project-a #11 afterIds=[2], fixesMain=true', runId: 9 } });
  });
  it('a clear is described by its resulting values', () => {
    const r = ok({ entry: e(11, { afterIds: [], fixesMain: false }) });
    expect(landingMutationNotice(cmd, r)).toMatchObject({ due: true, event: { body: 'lane-b set project-a #11 afterIds=[], fixesMain=false' } });
  });
  it('the current run claimant own order, an unchanged order and a creation owe nothing', () => {
    expect(landingMutationNotice({ ...cmd, setBy: 'coord-a' } as LandingAuthorityCommand, ok())).toEqual({ due: false });
    expect(landingMutationNotice(cmd, ok({ changed: false, seq: null }))).toEqual({ due: false });
    expect(landingMutationNotice(create(11), ok({ previous: null }))).toEqual({ due: false });
  });
  it('a no-run or unclaimed current association is always due, with its actual run id or null', () => {
    expect(landingMutationNotice(cmd, ok({ coordinator: { kind: 'no-run' } }))).toMatchObject({ due: true, event: { runId: null } });
    expect(landingMutationNotice({ ...cmd, setBy: 'coord-a' } as LandingAuthorityCommand, ok({ coordinator: { kind: 'run', runId: 9, claimedBy: null } })))
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
  it('CONTROL: the scans see a builtin, a value import and a clock; a comment is not a clock', () => {
    expect(builtins(probe(`import { readFileSync } from 'node:fs';`))).toEqual(['node:fs']);
    expect(valueImports(probe(`import { x } from './store.js';`))).toEqual(['./store.js']);
    expect(valueImports(probe(`import type { x } from './store.js';`))).toEqual([]);
    expect(clock(probe('const t = Date.now();'))).toEqual(['1 Date']);
    expect(clock(probe('// Date.now() is not used\nconst t = 1;'))).toEqual([]);
  });
  it('has no clock, no fs, no node builtin and no value import at all', () => {
    const p = parsedFile(FILE);
    expect(p.symbols.length).toBeGreaterThan(0);
    expect(clock(p)).toEqual([]);
    expect(builtins(p)).toEqual([]);
    expect(valueImports(p)).toEqual([]);
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
