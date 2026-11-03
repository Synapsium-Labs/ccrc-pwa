// Landing order wave 5f, Task 1: `decideLandingMutation`, the one pure decision under the attributed landing writes
// (coord/landingWrites.ts, L1). Cases are data over `LandingMutationFacts`; no store, no journal.
import { describe, it, expect } from 'vitest';
import { builtinModules } from 'node:module';
import { identifierReferences, parseSource, type ParsedFile } from './scan/parse.js';
import { parsedFile } from './scan/symbols.js';
import { decideLandingMutation, type LandingAuthorityCommand, type LandingMutationFacts } from '../src/coord/landingWrites.js';
import {
  landingAssociationReadable, landingEntryFactsOfRow, landingRecoveryOf, type LandingEntryFacts, type LandingProjectionWitness,
  type LandingRecoverySubjectFact,
} from '../src/coord/landingEntry.js';
import type { LandingEntry, LandingRecoverySubject } from '../../shared/landingLine.js';

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
  it('unrelated unresolved recovery does not refuse a write that does not reach it', () => {
    const f = facts({ entries: [e(1), e(2)], recovery: [recovered(150, 50, MISSING)] });
    expect(ok(order(1, { afterIds: [102] }), f)).toMatchObject({ kind: 'order' });
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
    // the display afterIds [] of an unreadable row hides an edge back to the source
    const f = facts({ entries: [e(1), e(2, { state: 'unknown' })], unreadableDeps: [102] });
    expect(refused(order(1, { afterIds: [102] }), f)).toBe('landing-dependencies-unreadable');
    // an unreadable row that is NOT reached does not matter
    expect(ok(order(1, { afterIds: [] }), f)).toMatchObject({ kind: 'noop' });
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
    expect(m).toEqual({ kind: 'noop', entry: base.entries[0] });
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
