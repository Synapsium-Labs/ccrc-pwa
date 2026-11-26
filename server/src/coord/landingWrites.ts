// L1, context C4 (landing order wave 5f). PURE: no clock, no fs, no store, no I/O; every import is a type except
// those from the shared landing vocabulary, `shared/landingLine.ts`, the one file the purity case admits a value
// import from (D-9093; the wave 5j plan's section 13, C12). The
// attributed landing writes' vocabulary and their ONE decision: `decideLandingMutation` reads the coherent facts the
// store gathered inside its transaction and answers a refusal or the one mutation to journal. `CoordStore.
// writeLandingAuthority` (L3) gathers, calls this, then appends and applies; nothing here acts.
//
// Four commands (wave 5j-b, D-9049): the two attributed writes, `entry` and `order`, and the operator's two doors,
// `pause` and `withdraw`. Each has its own refusal order below, first match wins.
//
// Pause and resume (one command, `paused` true or false; no sign-in fact reaches this file, F5 ruling):
//   1. a project the line has never seen (no entry, no listed subject of it, no flags row) -> landing-project-unknown
//   2. `paused` equal to the stored flag -> {kind:'unchanged'}, appending nothing
//   3. otherwise {kind:'pause'}. Recovery, an identity conflict and the main-red hold never refuse it: it moves no entry.
//
// Withdraw (the operator's withdrawal of one entry; it writes no order edge and chooses no successor):
//   1. an identity conflict listed in this project's recovery       -> landing-identity-conflict
//   2. no entry of (project, pr): a listed subject of that key is landing-recovery-unresolved, otherwise landing-entry-missing
//   3. the entry's own subject is listed -> landing-recovery-unresolved (`landingHoldGate`'s `land` rule: another
//      subject's hold does not stop a subtractive act)
//   4. the STORED state word: terminal -> landing-entry-terminal; 'unrecognised' -> landing-projection-unreadable
//   5. the stored pin time (`pinTimes`, never the display) does not read or differs from the body's -> landing-entry-moved
//   6. the entry's own current association does not read -> run-unreadable
//   7. otherwise {kind:'withdraw'}, with the entry's recipient and every direct, non-terminal dependant whose edges read,
//      each with its own recipient; a dependant whose association does not read is `unreadable`, never a refusal (F3).
//
// Entry and order, the attributed writes (first match wins):
//   1. an identity conflict listed in this project's recovery       -> landing-identity-conflict
//   2. entry: the (project, pr) already has a projection or a recovered subject -> landing-entry-exists; otherwise any
//      unresolved recovery listed in the project -> landing-recovery-unresolved; then `nextId` null -> landing-id-overflow.
//   3. order: the source is looked up by (project, pr). Absent from the projections: a recovered subject of that
//      (project, pr) is landing-recovery-unresolved (never entry-missing), otherwise landing-entry-missing. A
//      projection that is not `readable` is landing-projection-unreadable (a display placeholder is never journalled).
//      Then ANY unresolved recovery listed in the project refuses the write landing-recovery-unresolved, whether or not
//      the write reaches that subject: a project identity conflict refuses identity-conflict, every other unresolved
//      recovery holds the whole line.
//   4. each named target, in order: absent from both inventories -> landing-after-missing; a known id of another
//      project -> landing-after-cross-project; a listed recovery subject -> landing-recovery-unresolved (its
//      projection is unmeasured, so it is neither absent nor satisfied).
//   5. the walk over the proposed graph (the source's edges replaced by the effective afterIds, every other node as the
//      independent `dependencies` fact says, never the display `[]`): a node that is not a known entry is
//      after-missing / after-cross-project / recovery-unresolved like a direct target; unreadable dependencies ->
//      landing-dependencies-unreadable; reaching the source (self-edge included) -> landing-cycle. The source's own old
//      edges are never walked when afterIds is sent, so a cycle through it can be repaired; a patch that omits afterIds
//      keeps the current edges and is walked, so a source-reaching cycle is refused even unchanged. A visited set lets
//      an old cycle that does not touch the source pass. A readable unknown-state (quarantined) target is traversable.
//   6. the current association of the source and every named target comes from `facts.coordinators`; missing or
//      unreadable -> run-unreadable. A binding is never read from a historical id.
//   7. an effective no-op (the same resulting afterIds and fixesMain) -> {kind:'noop'}, appending nothing.
//   A changed order names the withdrawn targets its new edges drop (`released`, by the stored word), so the feed records
//   every release of a withdrawn hold, whoever the setter is (section 11 C1, D-9047).
// Omitted `afterIds`/`fixesMain` keep the current value; `[]` and `false` are explicit clears.
import type {
  LandingBoundaryFailure, LandingEntry, LandingEntryState, LandingInfrastructureFailure, LandingLineFlags, LandingMutationCode, LandingNoticeOutcome,
  LandingRecovery, LandingSubjectRef,
} from '../../../shared/landingLine.js';
import { LANDING_ENTRY_TERMINAL } from '../../../shared/landingLine.js';
import type { LandingProjectionRead, LandingTerminalRepair } from './landingEntry.js';
import type { NoticeRecord } from '../notice.js';

export type Coordinator = { kind: 'no-run' } | { kind: 'run'; runId: number; claimedBy: string | null };

/** The coherent facts of one project, gathered by the store inside one transaction (shared contract §4). */
export interface LandingMutationFacts {
  project: string;
  flags: LandingLineFlags;
  entries: LandingEntry[];
  projections: { id: number; value: LandingProjectionRead }[];
  /** Wave 5i (fix round 1, R1): the STORED state word of each entry of this project, as the row holds it (the raw
   *  `row.state`), `'unrecognised'` when it is not a word of the L0 vocabulary. Read before the display fold; it never
   *  says the row reads, and no reader may take it for readability. Every entry has one record. */
  stateWords: { id: number; value: LandingEntryState | 'unrecognised' }[];
  dependencies: { id: number; value: { kind: 'readable'; afterIds: number[] } | { kind: 'unreadable' } }[];
  recovery: LandingRecovery;
  /** The next entry id, or null when the one allocator would overflow. */
  nextId: number | null;
  /** Ids of entries of OTHER projects: an id-only membership fact that separates missing from foreign. */
  foreignIds: number[];
  /** The current association of each entry, from its projection's own run id (never a historical one). */
  coordinators: { id: number; value: Coordinator | { kind: 'unreadable' } }[];
  /** Wave 5i (D-8626): the terminal-evidence permission of each open row that does not read, from `landingFactsOf`. It is
   *  independent of `projections` and `dependencies`, never a repaired display, and no reader may take it for readability. */
  terminalRepairs: { id: number; value: LandingTerminalRepair }[];
  /** Wave 5i: the journal creation claim of each entry of this project whose exact identity (id, project, pr) a recorded
   *  creation names, with that creation's seq and its claimant. Never read off the mutable projection's `setBy`: an order
   *  setter replaces that, and the next-to-land cue goes to the creator. */
  creations: { id: number; seq: number; setBy: string }[];
  /** Wave 5j-b: whether the project has a `landing_projects` row (a project the pause door may name). */
  flagsRow: boolean;
  /** Wave 5j-b: each entry's STORED `pinnedAt`, read strictly, `null` when it does not read. The display entry turns an
   *  unreadable pin time into `0`, so the withdraw door's compare-and-set reads this and never the display. */
  pinTimes: { id: number; value: number | null }[];
}
export type LandingReadResult =
  | { ok: true; facts: LandingMutationFacts }
  | ({ ok: false } & LandingInfrastructureFailure);

export type LandingJournalReplay =
  | { ok: true; applied: number; lastSeq: number }
  | ({ ok: false } & LandingBoundaryFailure);
/** The attributed writes' answer. `released` (wave 5j-b, section 11 C1) names the withdrawn targets a changed order's new
 *  edges dropped, by entry id and PR, `[]` for a creation, a no-op or an order that releases none: the feed notice reads it,
 *  and the route answer drops it with `coordinator`. */
export type LandingAuthorityWrite =
  | { ok: true; entry: LandingEntry; previous: LandingEntry | null; changed: boolean; seq: number | null; coordinator: Coordinator;
      released: LandingReleased[] }
  | ({ ok: false } & LandingInfrastructureFailure)
  | { ok: false; error: LandingMutationCode | 'run-unreadable' };
export type LandingReleased = { entryId: number; pr: number };
/** The pause door's answer (wave 5j-b): `changed: false` with `seq: null` for a pause or resume that matched the flag. */
export type LandingPauseWrite =
  | { ok: true; project: string; operatorPaused: boolean; changed: boolean; seq: number | null }
  | ({ ok: false } & LandingInfrastructureFailure)
  | { ok: false; error: LandingMutationCode };
/** The withdraw door's answer (wave 5j-b): the entry after and before, the record's seq and what each notice did. */
export type LandingWithdrawWrite =
  | { ok: true; entry: LandingEntry; previous: LandingEntry; changed: true; seq: number; notices: LandingNoticeOutcome[]; coordinator: Coordinator }
  | ({ ok: false } & LandingInfrastructureFailure)
  | { ok: false; error: LandingMutationCode | 'run-unreadable' };
/** The writer's answer for one command arm, in `advanceLanding`'s `AdvanceLandingResultOf` style. */
export type LandingAuthorityWriteOf<C extends LandingAuthorityCommand> =
  C extends { kind: 'pause' } ? LandingPauseWrite : C extends { kind: 'withdraw' } ? LandingWithdrawWrite : LandingAuthorityWrite;

export interface LandingCaller { byId: string; byUuid: string }
export interface LandingEntryRequest extends LandingCaller {
  project: string; pr: number; pinnedSha: string; handoffCommit: string;
}
export interface LandingOrderRequest extends LandingCaller {
  project: string; pr: number; afterIds?: number[]; fixesMain?: boolean;
}
/** `withdraw` and `pause` (wave 5j-b) are the operator's: `setBy` is always `'operator'`, and `actor` is the text the
 *  route recorded with its file's one expression (the device actor armed, `flag-off` dark), never a raw label. */
export type LandingAuthorityCommand =
  | { kind: 'entry'; project: string; pr: number; pinnedSha: string; handoffCommit: string; setBy: string }
  | { kind: 'order'; project: string; pr: number; afterIds?: number[]; fixesMain?: boolean; setBy: string }
  | { kind: 'withdraw'; project: string; pr: number; pinnedAt: number; setBy: 'operator'; actor: string }
  | { kind: 'pause'; project: string; paused: boolean; setBy: 'operator'; actor: string };
export type LandingDoorParse =
  | { ok: true; kind: 'withdraw'; project: string; pr: number; pinnedAt: number }
  | { ok: true; kind: 'pause'; project: string; paused: boolean }
  | { ok: false; error: 'bad-request' };
export type LandingWriteParse =
  | { ok: true; kind: 'entry'; request: LandingEntryRequest }
  | { ok: true; kind: 'order'; request: LandingOrderRequest }
  | { ok: false; error: 'bad-request' };
/** A noop and an order carry the source's current association the decision read (readable only), and an order its journal
 *  binding, so neither the record nor the store's answer reads it again or folds an unreadable one into no-run. A creation
 *  has no run. */
export type LandingMutationDecision =
  | { ok: false; error: LandingMutationCode | 'run-unreadable' | 'landing-projection-unreadable' }
  | { ok: true; mutation:
      | { kind: 'noop'; entry: LandingEntry; coordinator: Coordinator }
      | (Extract<LandingAuthorityCommand, { kind: 'entry' }> & { id: number })
      | { kind: 'order'; entry: LandingEntry; coordinator: Coordinator; binding: LandingSubjectRef['binding']; after: LandingSubjectRef[];
          fixesMain: boolean; released: LandingReleased[] }
      | { kind: 'unchanged'; project: string; operatorPaused: boolean }
      | { kind: 'pause'; project: string; paused: boolean }
      | { kind: 'withdraw'; entry: LandingEntry; coordinator: Coordinator; binding: LandingSubjectRef['binding'];
          recipient: LandingRecipient; dependants: { entry: LandingEntry; recipient: LandingDependantRecipient }[] } };
/** Who a withdrawal tells (D-9050): a run's `claimedBy`, or a run-less entry's recorded creation claimant; failing those,
 *  nobody, with the reason. A dependant whose own association does not read keeps the facts' word, `unreadable`. */
export type LandingRecipient = { kind: 'session'; toId: string } | { kind: 'none'; reason: 'unclaimed' | 'unrecorded' };
export type LandingDependantRecipient = LandingRecipient | { kind: 'unreadable' };

const refuse = (error: Extract<LandingMutationDecision, { ok: false }>['error']): LandingMutationDecision => ({ ok: false, error });

export function decideLandingMutation(command: LandingAuthorityCommand, facts: LandingMutationFacts): LandingMutationDecision {
  const listed = facts.recovery.subjects;
  if (command.kind === 'pause') {
    const known = facts.entries.length > 0 || listed.some((x) => x.project === command.project) || facts.flagsRow;
    if (!known) return refuse('landing-project-unknown');
    if (command.paused === facts.flags.operatorPaused) return { ok: true, mutation: { kind: 'unchanged', project: command.project, operatorPaused: command.paused } };
    return { ok: true, mutation: { kind: 'pause', project: command.project, paused: command.paused } };
  }
  if (listed.some((x) => x.projection.kind === 'identity-conflict')) return refuse('landing-identity-conflict');
  const byKey = (x: { project: string; pr: number }): boolean => x.project === command.project && x.pr === command.pr;
  if (command.kind === 'withdraw') return decideWithdraw(command, facts, byKey);

  if (command.kind === 'entry') {
    if (facts.entries.some(byKey) || listed.some(byKey)) return refuse('landing-entry-exists');
    if (listed.length > 0) return refuse('landing-recovery-unresolved');
    if (facts.nextId === null) return refuse('landing-id-overflow');
    return { ok: true, mutation: { ...command, id: facts.nextId } };
  }

  const source = facts.entries.find(byKey);
  if (source === undefined) return refuse(listed.some(byKey) ? 'landing-recovery-unresolved' : 'landing-entry-missing');
  const sourceRead = facts.projections.find((p) => p.id === source.id);
  if (sourceRead === undefined || sourceRead.value.kind !== 'readable') return refuse('landing-projection-unreadable');
  if (listed.length > 0) return refuse('landing-recovery-unresolved');

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
  /** A node the graph names must be a known entry of this project (an unresolved recovery subject never gets this far:
   *  the project-wide refusal above answers first). */
  const classify = (id: number): Extract<LandingMutationDecision, { ok: false }>['error'] | null => {
    if (id === source.id) return null;
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

  // Step 6 before step 7: the source's and every named target's current association, so that a no-op over one that
  // cannot be read refuses rather than reading as success. A missing or unreadable one is never a no-run.
  const coordinatorOf = (e: LandingEntry): Coordinator | null => {
    const c = facts.coordinators.find((x) => x.id === e.id)?.value;
    return c === undefined || c.kind === 'unreadable' ? null : c;
  };
  const coordinator = coordinatorOf(source);
  if (coordinator === null) return refuse('run-unreadable');
  const after: LandingSubjectRef[] = [];
  for (const t of effective) {
    const e = known.get(t)!;
    const c = coordinatorOf(e);
    if (c === null) return refuse('run-unreadable');
    after.push({ id: e.id, project: e.project, pr: e.pr, binding: landingBindingOf(c) });
  }
  const same = sourceDeps.kind === 'readable' && sourceDeps.afterIds.length === effective.length
    && sourceDeps.afterIds.every((v, i) => v === effective[i]) && fixesMain === source.fixesMain;
  if (same) return { ok: true, mutation: { kind: 'noop', entry: source, coordinator } };
  // The withdrawn targets the new edges drop, by the STORED word (section 11 C1): the feed records each such release.
  const released: LandingReleased[] = (sourceDeps.kind === 'readable' ? sourceDeps.afterIds : [])
    .filter((t) => !effective.includes(t) && wordOf(facts, t) === 'withdrawn' && known.has(t))
    .map((t) => ({ entryId: t, pr: known.get(t)!.pr }));
  return { ok: true, mutation: { kind: 'order', entry: source, coordinator, binding: landingBindingOf(coordinator), after, fixesMain, released } };
}

const wordOf = (facts: LandingMutationFacts, id: number): LandingEntryState | 'unrecognised' | undefined =>
  facts.stateWords.find((w) => w.id === id)?.value;
const isTerminalWord = (w: LandingEntryState | 'unrecognised' | undefined): boolean =>
  w !== undefined && w !== 'unrecognised' && LANDING_ENTRY_TERMINAL[w];

/** The withdraw arm, steps 2 to 7 of its refusal order (the identity conflict, step 1, answered above). */
function decideWithdraw(command: Extract<LandingAuthorityCommand, { kind: 'withdraw' }>, facts: LandingMutationFacts,
  byKey: (x: { project: string; pr: number }) => boolean): LandingMutationDecision {
  const listed = facts.recovery.subjects;
  const entry = facts.entries.find(byKey);
  if (entry === undefined) return refuse(listed.some(byKey) ? 'landing-recovery-unresolved' : 'landing-entry-missing');
  if (listed.some(byKey)) return refuse('landing-recovery-unresolved');
  const word = wordOf(facts, entry.id);
  if (isTerminalWord(word)) return refuse('landing-entry-terminal');
  if (word === undefined || word === 'unrecognised') return refuse('landing-projection-unreadable');
  const pinnedAt = facts.pinTimes.find((p) => p.id === entry.id)?.value ?? null;
  if (pinnedAt === null || pinnedAt !== command.pinnedAt) return refuse('landing-entry-moved');
  const association = (id: number): Coordinator | { kind: 'unreadable' } =>
    facts.coordinators.find((c) => c.id === id)?.value ?? { kind: 'unreadable' };
  const coordinator = association(entry.id);
  if (coordinator.kind === 'unreadable') return refuse('run-unreadable');
  const recipientOf = (id: number, c: Coordinator): LandingRecipient => {
    if (c.kind === 'run') return c.claimedBy === null ? { kind: 'none', reason: 'unclaimed' } : { kind: 'session', toId: c.claimedBy };
    const created = facts.creations.find((x) => x.id === id);
    return created === undefined ? { kind: 'none', reason: 'unrecorded' } : { kind: 'session', toId: created.setBy };
  };
  // Direct dependants only: every non-terminal entry whose READABLE dependencies name the target. One whose edges do not
  // read is not listed (its edges are unknown, and its display state keeps it out of the line already).
  const dependants: { entry: LandingEntry; recipient: LandingDependantRecipient }[] = [];
  for (const d of facts.entries) {
    if (d.id === entry.id || isTerminalWord(wordOf(facts, d.id))) continue;
    const deps = facts.dependencies.find((x) => x.id === d.id)?.value;
    if (deps === undefined || deps.kind !== 'readable' || !deps.afterIds.includes(entry.id)) continue;
    const c = association(d.id);
    dependants.push({ entry: d, recipient: c.kind === 'unreadable' ? { kind: 'unreadable' } : recipientOf(d.id, c) });
  }
  return { ok: true, mutation: { kind: 'withdraw', entry, coordinator, binding: landingBindingOf(coordinator),
    recipient: recipientOf(entry.id, coordinator), dependants } };
}

/** A readable current association as the journal's historical binding: total over the two readable members, so an
 *  unreadable one cannot reach it (the decision refused it). */
const landingBindingOf = (c: Coordinator): LandingSubjectRef['binding'] =>
  c.kind === 'no-run' ? { kind: 'no-run' } : { kind: 'run', observedRunId: c.runId };

// ── parsing and the notice (wave 5f Task 2) ──────────────────────────────────────────────────────────────────────
const ENTRY_KEYS = ['byId', 'byUuid', 'project', 'pr', 'pinnedSha', 'handoffCommit'] as const;
const ORDER_KEYS = ['byId', 'byUuid', 'project', 'pr', 'afterIds', 'fixesMain'] as const;
const BAD: { ok: false; error: 'bad-request' } = { ok: false, error: 'bad-request' };
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);

export type LandingReadQuery = { ok: true; project: string; pr: number | null } | { ok: false; detail: string };

/** The landing read's query: `project` required and trimmed; `pr` absent (the entries still in the line) or a decimal
 *  positive safe integer with no leading zero (that PR's entry, in any state). Anything else is refused, never coerced. */
export function parseLandingReadQuery(q: unknown): LandingReadQuery {
  const o = (typeof q === 'object' && q !== null ? q : {}) as Record<string, unknown>;
  const project = text(o['project']);
  if (project === null) return { ok: false, detail: 'the landing line is per-project — ?project= is required' };
  const raw = o['pr'];
  if (raw === undefined) return { ok: true, project, pr: null };
  const pr = typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null;
  if (pr === null || !Number.isSafeInteger(pr)) {
    return { ok: false, detail: 'the landing read takes ?pr= as a PR number: a positive integer with no leading zero' };
  }
  return { ok: true, project, pr };
}

/** One request body, closed: known keys only, so a client `setBy`, `runId`, `state` or time is refused, never ignored. */
export function parseLandingWrite(kind: 'entry' | 'order', body: unknown): LandingWriteParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return BAD;
  const o = body as Record<string, unknown>;
  const known: readonly string[] = kind === 'entry' ? ENTRY_KEYS : ORDER_KEYS;
  if (Object.keys(o).some((k) => !known.includes(k))) return BAD;
  const byId = text(o['byId']);
  const byUuid = text(o['byUuid']);
  const project = text(o['project']);
  if (byId === null || byUuid === null || project === null || !positive(o['pr'])) return BAD;
  const caller = { byId, byUuid, project, pr: o['pr'] };
  if (kind === 'entry') {
    if (!hash(o['pinnedSha']) || !hash(o['handoffCommit'])) return BAD;
    return { ok: true, kind: 'entry', request: { ...caller, pinnedSha: o['pinnedSha'], handoffCommit: o['handoffCommit'] } };
  }
  const afterIds = o['afterIds'];
  const fixesMain = o['fixesMain'];
  if (afterIds === undefined && fixesMain === undefined) return BAD;
  const request: LandingOrderRequest = { ...caller };
  if (afterIds !== undefined) {
    if (!Array.isArray(afterIds) || !afterIds.every(positive) || new Set(afterIds).size !== afterIds.length) return BAD;
    request.afterIds = [...afterIds];
  }
  if (fixesMain !== undefined) {
    if (typeof fixesMain !== 'boolean') return BAD;
    request.fixesMain = fixesMain;
  }
  return { ok: true, kind: 'order', request };
}

/** The pair the act hands the notice (wave 5j-b): each command arm with its own result shape, so an arm reads only the
 *  fields its result has. */
export type LandingNoticeInput =
  | { command: Extract<LandingAuthorityCommand, { kind: 'entry' | 'order' }>; result: Extract<LandingAuthorityWrite, { ok: true }> }
  | { command: Extract<LandingAuthorityCommand, { kind: 'pause' }>; result: Extract<LandingPauseWrite, { ok: true }> }
  | { command: Extract<LandingAuthorityCommand, { kind: 'withdraw' }>; result: Extract<LandingWithdrawWrite, { ok: true }> };

/** The one feed notice a successful write owes, all `record-only`:
 *  - a CHANGED order by someone other than the current run's claimant (a no-run or unclaimed current association owes it
 *    too), and, since wave 5j-b, a changed order that releases a withdrawn hold whoever the setter is (section 11 C1);
 *  - a changed pause or resume (`landing-paused`/`landing-resumed`) and every withdrawal (`landing-withdrawn`), each with
 *    `sessionId: ''` as every operator door's event carries, the actor in the body.
 *  Creation, a no-op, an unchanged pause, a failure and a replay owe none. A crash between COMMIT and the sink can omit the
 *  event; there is no outbox and no exactly-once claim. */
export function landingMutationNotice(input: LandingNoticeInput): { due: false } | { due: true; event: NoticeRecord } {
  if (input.command.kind === 'pause') {
    const { command, result } = input as Extract<LandingNoticeInput, { command: { kind: 'pause' } }>;
    if (!result.changed) return { due: false };
    const verb = result.operatorPaused ? 'paused' : 'resumed';
    return { due: true, event: { kind: 'coord', sessionId: '', title: `landing-${verb}: ${result.project}`,
      body: `${command.actor} ${verb} the landing line of ${result.project} (journal seq ${String(result.seq)})`, runId: null } };
  }
  if (input.command.kind === 'withdraw') {
    const { command, result } = input as Extract<LandingNoticeInput, { command: { kind: 'withdraw' } }>;
    const told = result.notices.map((n) => n.kind === 'queued' ? `${n.word} to ${n.toId} (entry ${n.entryId})`
      : n.kind === 'none' ? `${n.word}: no coordinator to tell (${n.reason}) (entry ${n.entryId})`
        : `${n.word}: association unreadable (entry ${n.entryId})`);
    const { project, pr } = command;
    return { due: true, event: { kind: 'coord', sessionId: '', title: `landing-withdrawn: ${project} #${pr}`,
      body: `${command.actor} withdrew ${project} #${pr} (entry ${result.entry.id}, journal seq ${result.seq}); notices: ${told.join('; ')}`,
      runId: result.coordinator.kind === 'run' ? result.coordinator.runId : null } };
  }
  const { command, result } = input as Extract<LandingNoticeInput, { command: { kind: 'entry' | 'order' } }>;
  if (command.kind !== 'order' || !result.changed) return { due: false };
  const c = result.coordinator;
  if (c.kind === 'run' && c.claimedBy === command.setBy && result.released.length === 0) return { due: false };
  const { project, pr, setBy } = command;
  const released = result.released.length === 0 ? '' : `; released the withdrawn ${result.released.map((r) => `#${r.pr}`).join(', ')}`;
  return { due: true, event: {
    kind: 'coord', sessionId: setBy, title: `landing-inversion: ${project} #${pr}`,
    body: `${setBy} set ${project} #${pr} afterIds=${JSON.stringify(result.entry.afterIds)}, fixesMain=${result.entry.fixesMain ? 'true' : 'false'}${released}`,
    runId: c.kind === 'run' ? c.runId : null } };
}

/** One door body, closed (wave 5j-b): `{project, pr, pinnedAt}` or `{project, paused}`, nothing else, so no `after`,
 *  `afterIds`, `head` or successor field can ride along. `pinnedAt` is a nonnegative safe integer: the pin time the
 *  console read, the withdrawal's compare-and-set. */
export function parseLandingDoor(kind: 'withdraw' | 'pause', body: unknown): LandingDoorParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return BAD;
  const o = body as Record<string, unknown>;
  const known: readonly string[] = kind === 'withdraw' ? WITHDRAW_KEYS : PAUSE_KEYS;
  if (Object.keys(o).some((k) => !known.includes(k)) || known.some((k) => !(k in o))) return BAD;
  const project = text(o['project']);
  if (project === null) return BAD;
  if (kind === 'pause') return typeof o['paused'] === 'boolean' ? { ok: true, kind: 'pause', project, paused: o['paused'] } : BAD;
  const pr = o['pr'];
  const pinnedAt = o['pinnedAt'];
  if (!positive(pr) || typeof pinnedAt !== 'number' || !Number.isSafeInteger(pinnedAt) || pinnedAt < 0) return BAD;
  return { ok: true, kind: 'withdraw', project, pr, pinnedAt };
}
const WITHDRAW_KEYS = ['project', 'pr', 'pinnedAt'] as const;
const PAUSE_KEYS = ['project', 'paused'] as const;

/** One notice of a withdrawal: its word, the entry it is about (the withdrawn one, or the dependant), its recipient, the
 *  PR its subject names, the identity tuple the store hashes and its body. */
export interface LandingWithdrawNotice { word: 'landing-withdrawn' | 'landing-held'; entryId: number; toId: string; pr: number; identity: string; body: string }

/** The withdrawal's notices, from values (D-9050): one to the entry's coordinator and one to each direct dependant's, each
 *  with the identity tuple the store hashes and its body. No clock, no hash. A recipient of kind `none` or `unreadable`
 *  gets no notice: the answer and the feed event name it instead. */
export function landingWithdrawNoticesOf(f: { project: string; mutation: Extract<Extract<LandingMutationDecision, { ok: true }>['mutation'],
  { kind: 'withdraw' }>; seq: number; at: number }): LandingWithdrawNotice[] {
  const { project, mutation: m, seq } = f;
  const out: LandingWithdrawNotice[] = [];
  const e = m.entry;
  if (m.recipient.kind === 'session') {
    const toId = m.recipient.toId;
    const back = e.runId !== null
      ? 'It comes back by a retreat of its run from merging to working (when it is still at merging) and then a new advance to merging.'
      : 'It is a run-less entry and cannot come back yet (follow-up landing-runless-reentry): POST /api/landing/entries refuses it landing-entry-exists.';
    out.push({ word: 'landing-withdrawn', entryId: e.id, toId, pr: e.pr, identity: JSON.stringify(['landing-withdrawn', 1, project, e.id, e.pr, seq, toId]),
      body: [`The operator withdrew ${project} #${e.pr} (entry ${e.id}, state ${e.state}, pinned at ${e.pinnedSha}) at ${isoOf(f.at)}, journal seq ${seq}.`,
        'Nothing chose a successor, and any entry that waited on this one keeps waiting.',
        `Do not land this PR at that pin. On a project that composes candidates, drop its candidate refs from your own shell (ccd land-candidate --project ${project} --pr ${e.pr} --drop, spec §5.5 step 4).`,
        back].join('\n') });
  }
  for (const d of m.dependants) {
    if (d.recipient.kind !== 'session') continue;
    const toId = d.recipient.toId;
    out.push({ word: 'landing-held', entryId: d.entry.id, toId, pr: d.entry.pr,
      identity: JSON.stringify(['landing-held', 1, project, d.entry.id, d.entry.pr, e.id, seq, toId]),
      body: [`${project} #${d.entry.pr} waits on #${e.pr}, which the operator withdrew, and will not land while that edge stands.`,
        `Any attributed session may release it by declaring its order again without #${e.pr} (POST /api/landing/order), a deliberate act the feed records.`,
        `Otherwise it waits until #${e.pr} re-enters and then lands or is closed; a run-less #${e.pr} cannot re-enter yet.`].join('\n') });
  }
  return out;
}

/** Epoch milliseconds as an ISO-8601 UTC instant, by integer arithmetic (the days-to-civil conversion), because this module
 *  names no clock and no `Date` (its purity test reads the identifier). Defined for the nonnegative safe times a record
 *  carries. */
function isoOf(ms: number): string {
  const day = Math.floor(ms / 86_400_000);
  const rem = ms - day * 86_400_000;
  const z = day + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(y, 4)}-${p(m)}-${p(d)}T${p(Math.floor(rem / 3_600_000))}:${p(Math.floor(rem / 60_000) % 60)}:${p(Math.floor(rem / 1000) % 60)}.${p(rem % 1000, 3)}Z`;
}

/** The command a parsed request becomes: the setter is the ATTRIBUTED sender, never a body field. */
export function landingCommandOf(parsed: Extract<LandingWriteParse, { ok: true }>): Extract<LandingAuthorityCommand, { kind: 'entry' | 'order' }> {
  const { byId, project, pr } = parsed.request;
  if (parsed.kind === 'entry') {
    return { kind: 'entry', project, pr, pinnedSha: parsed.request.pinnedSha, handoffCommit: parsed.request.handoffCommit, setBy: byId };
  }
  const { afterIds, fixesMain } = parsed.request;
  return { kind: 'order', project, pr, setBy: byId, ...(afterIds === undefined ? {} : { afterIds }), ...(fixesMain === undefined ? {} : { fixesMain }) };
}
