// L1, context C4 (landing order wave 5f). PURE: no clock, no fs, no store, no I/O; every import is a type. The
// attributed landing writes' vocabulary and their ONE decision: `decideLandingMutation` reads the coherent facts the
// store gathered inside its transaction and answers a refusal or the one mutation to journal. `CoordStore.
// writeLandingAuthority` (L3) gathers, calls this, then appends and applies; nothing here acts.
//
// Refusal order for both commands (first match wins):
//   1. an identity conflict listed in this project's recovery       -> landing-identity-conflict
//   2. entry: the (project, pr) already has a projection or a recovered subject -> landing-entry-exists;
//      then `nextId` null -> landing-id-overflow.
//   3. order: the source is looked up by (project, pr). Absent from the projections: a recovered subject of that
//      (project, pr) is landing-recovery-unresolved (never entry-missing), otherwise landing-entry-missing. A
//      projection that is not `readable` is landing-projection-unreadable (a display placeholder is never journalled);
//      a source (or a directly named target) that is itself a listed recovery subject is landing-recovery-unresolved.
//      Recovery is refused only where the write REACHES it (the source and the targets it names): another unresolved
//      subject elsewhere in the project holds the line, not this write.
//   4. each named target, in order: absent from both inventories -> landing-after-missing; a known id of another
//      project -> landing-after-cross-project; a listed recovery subject -> landing-recovery-unresolved (its
//      projection is unmeasured, so it is neither absent nor satisfied).
//   5. the walk over the proposed graph (the source's edges replaced by the effective afterIds, every other node as the
//      independent `dependencies` fact says, never the display `[]`): a node that is not a known entry is
//      after-missing / after-cross-project / recovery-unresolved like a direct target; unreadable dependencies ->
//      landing-dependencies-unreadable; reaching the source (self-edge included) -> landing-cycle. The source's own old
//      edges are never walked, so a cycle through it can be repaired, and a visited set lets an old cycle that does not
//      touch the source pass. A readable unknown-state (quarantined) target is traversable. A node the walk reaches
//      that is a listed recovery subject is refused too (conservative: its edges are unmeasured).
//   6. the current association of the source and every named target comes from `facts.coordinators`; missing or
//      unreadable -> run-unreadable. A binding is never read from a historical id.
//   7. an effective no-op (the same resulting afterIds and fixesMain) -> {kind:'noop'}, appending nothing.
// Omitted `afterIds`/`fixesMain` keep the current value; `[]` and `false` are explicit clears.
import type {
  LandingEntry, LandingInfrastructureFailure, LandingLineFlags, LandingMutationCode, LandingRecovery, LandingSubjectRef,
} from '../../../shared/landingLine.js';
import type { LandingProjectionRead } from './landingEntry.js';

type Coordinator = { kind: 'no-run' } | { kind: 'run'; runId: number; claimedBy: string | null };

/** The coherent facts of one project, gathered by the store inside one transaction (shared contract §4). */
export interface LandingMutationFacts {
  project: string;
  flags: LandingLineFlags;
  entries: LandingEntry[];
  projections: { id: number; value: LandingProjectionRead }[];
  dependencies: { id: number; value: { kind: 'readable'; afterIds: number[] } | { kind: 'unreadable' } }[];
  recovery: LandingRecovery;
  /** The next entry id, or null when the one allocator would overflow. */
  nextId: number | null;
  /** Ids of entries of OTHER projects: an id-only membership fact that separates missing from foreign. */
  foreignIds: number[];
  /** The current association of each entry, from its projection's own run id (never a historical one). */
  coordinators: { id: number; value: Coordinator | { kind: 'unreadable' } }[];
}
export type LandingReadResult =
  | { ok: true; facts: LandingMutationFacts }
  | ({ ok: false } & LandingInfrastructureFailure);

export type LandingJournalReplay =
  | { ok: true; applied: number; lastSeq: number }
  | ({ ok: false } & LandingInfrastructureFailure);
export type LandingAuthorityWrite =
  | { ok: true; entry: LandingEntry; previous: LandingEntry | null; changed: boolean; seq: number | null; coordinator: Coordinator }
  | ({ ok: false } & LandingInfrastructureFailure)
  | { ok: false; error: LandingMutationCode | 'run-unreadable' };

export interface LandingCaller { byId: string; byUuid: string }
export interface LandingEntryRequest extends LandingCaller {
  project: string; pr: number; pinnedSha: string; handoffCommit: string;
}
export interface LandingOrderRequest extends LandingCaller {
  project: string; pr: number; afterIds?: number[]; fixesMain?: boolean;
}
export type LandingAuthorityCommand =
  | { kind: 'entry'; project: string; pr: number; pinnedSha: string; handoffCommit: string; setBy: string }
  | { kind: 'order'; project: string; pr: number; afterIds?: number[]; fixesMain?: boolean; setBy: string };
export type LandingWriteParse =
  | { ok: true; kind: 'entry'; request: LandingEntryRequest }
  | { ok: true; kind: 'order'; request: LandingOrderRequest }
  | { ok: false; error: 'bad-request' };
export type LandingMutationDecision =
  | { ok: false; error: LandingMutationCode | 'run-unreadable' | 'landing-projection-unreadable' }
  | { ok: true; mutation:
      | { kind: 'noop'; entry: LandingEntry }
      | (Extract<LandingAuthorityCommand, { kind: 'entry' }> & { id: number })
      | { kind: 'order'; entry: LandingEntry; after: LandingSubjectRef[]; fixesMain: boolean } };

const refuse = (error: Extract<LandingMutationDecision, { ok: false }>['error']): LandingMutationDecision => ({ ok: false, error });

export function decideLandingMutation(command: LandingAuthorityCommand, facts: LandingMutationFacts): LandingMutationDecision {
  const listed = facts.recovery.subjects;
  if (listed.some((x) => x.projection.kind === 'identity-conflict')) return refuse('landing-identity-conflict');
  const byKey = (x: { project: string; pr: number }): boolean => x.project === command.project && x.pr === command.pr;

  if (command.kind === 'entry') {
    if (facts.entries.some(byKey) || listed.some(byKey)) return refuse('landing-entry-exists');
    if (facts.nextId === null) return refuse('landing-id-overflow');
    return { ok: true, mutation: { ...command, id: facts.nextId } };
  }

  const source = facts.entries.find(byKey);
  if (source === undefined) return refuse(listed.some(byKey) ? 'landing-recovery-unresolved' : 'landing-entry-missing');
  const sourceRead = facts.projections.find((p) => p.id === source.id);
  if (sourceRead === undefined || sourceRead.value.kind !== 'readable') return refuse('landing-projection-unreadable');
  const inRecovery = (id: number): boolean => listed.some((x) => x.id === id);
  if (inRecovery(source.id)) return refuse('landing-recovery-unresolved');

  const depsOf = (id: number): { kind: 'readable'; afterIds: number[] } | { kind: 'unreadable' } =>
    facts.dependencies.find((d) => d.id === id)?.value ?? { kind: 'unreadable' };
  const sourceDeps = depsOf(source.id);
  let effective: number[];
  if (command.afterIds !== undefined) effective = [...new Set(command.afterIds)];
  else if (sourceDeps.kind === 'readable') effective = sourceDeps.afterIds;
  else return refuse('landing-dependencies-unreadable');
  const fixesMain = command.fixesMain ?? source.fixesMain;

  const known = new Map(facts.entries.map((e) => [e.id, e] as const));
  const foreign = new Set(facts.foreignIds);
  /** A node the graph names must be a known entry of this project and not an unresolved recovery subject. */
  const classify = (id: number): Extract<LandingMutationDecision, { ok: false }>['error'] | null => {
    if (id === source.id) return null;
    if (inRecovery(id)) return 'landing-recovery-unresolved';
    if (known.has(id)) return null;
    return foreign.has(id) ? 'landing-after-cross-project' : 'landing-after-missing';
  };
  for (const t of effective) {
    const bad = classify(t);
    if (bad !== null) return refuse(bad);
  }
  // Walk only what the proposed edges reach. The source's own old edges are replaced, never walked.
  const seen = new Set<number>();
  const stack = [...effective];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === source.id) return refuse('landing-cycle');
    if (seen.has(id)) continue;
    seen.add(id);
    const bad = classify(id);
    if (bad !== null) return refuse(bad);
    const deps = depsOf(id);
    if (deps.kind === 'unreadable') return refuse('landing-dependencies-unreadable');
    stack.push(...deps.afterIds);
  }

  const bindingOf = (e: LandingEntry): LandingSubjectRef['binding'] | null => {
    const c = facts.coordinators.find((x) => x.id === e.id)?.value;
    if (c === undefined || c.kind === 'unreadable') return null;
    return c.kind === 'no-run' ? { kind: 'no-run' } : { kind: 'run', observedRunId: c.runId };
  };
  if (bindingOf(source) === null) return refuse('run-unreadable');
  const same = sourceDeps.kind === 'readable' && sourceDeps.afterIds.length === effective.length
    && sourceDeps.afterIds.every((v, i) => v === effective[i]) && fixesMain === source.fixesMain;
  if (same) return { ok: true, mutation: { kind: 'noop', entry: source } };
  const after: LandingSubjectRef[] = [];
  for (const t of effective) {
    const e = known.get(t)!;
    const binding = bindingOf(e);
    if (binding === null) return refuse('run-unreadable');
    after.push({ id: e.id, project: e.project, pr: e.pr, binding });
  }
  return { ok: true, mutation: { kind: 'order', entry: source, after, fixesMain } };
}
