// Delegation broker wave 3, Task 11: the PURE join qualification and correlation ladder (spec §5.4, §5.14).
//
// `correlateDelegation` answers one question for one worktree-census record: which delegation activity does this worktree belong to?
// The answer is `run-child-owned` (rung 1: the existing run/child model owns it), `linked` (rung 2, 3 or 4 proved it), or one of three
// honest non-answers: `unresolved` (the evidence exists and does not decide), `conflicting` (it decides two ways; final until an
// operator resolves it), `unmeasured` (something needed was unreadable or is not yet durably applied, so it is retried).
//
// THIS MODULE IS L1. It imports types, the model's pure helpers and nothing else: no filesystem, no clock, no randomness, no store
// (and no state that outlives its inputs: D-5604's delta memo is keyed weakly by the window it describes).
// Time comes only from the listing windows it is handed. It decides and emits NOTHING: no lease request, no journal entry, no effect.
// Task 12's pure policy turns a `linked` verdict into a `DelegationLeaseCreationRequest` (and a `run-child-owned` one into a
// `record-run-child-owned`, never a lease); Task 13 wires both to the watcher.
//
// THE LADDER
//   1. Run-child agreement is its own terminal verdict. A tree that gains a registry row or a `.child` marker within two
//      reconciliation passes is a ccd workspace being BORN, never a lease, so no lease verdict is given while the wait stands.
//   2. Exact upstream identity. A tree named `agent-<id>` or `wf_<run>-<n>` is decided HERE OR NOT AT ALL: the name routes, it never
//      links, and without rung-2 evidence the tree is `unmeasured` (retried), never passed to rungs 3 and 4. The same upstream ID in
//      two parents' evidence is `conflicting`.
//   3. The subagent's own path: an event from inside a subagent whose `cwd` equals the canonical path. "Inside a subagent" means
//      only that its `agentId` belongs to an activity a qualifying join has opened (a bare `agent_id` is retained evidence, not
//      placement; amendment `tool-agent-id-alone-is-unjoined-evidence`). The parent's own `cwd` never links.
//   4. The session's own creation delta: one Bash call whose before/after listings differ by exactly the one added admin record,
//      while no other session's window on the same repository overlaps it in time.
//
// NEVER LINKS: a display name, a name pattern, a branch prefix, a timestamp or a census bracket, process ancestry, directory nesting,
// a session's own working directory. This file reads from a census record only `state`, `adminRecord`, `project` and `canonicalPath`;
// the three pinned folds of wave 1's D-4008 (`locked` false for a failed stat, `baseAgreesFirstLog` null for an unreadable first log,
// an unreadable `gitdir` read as an absent canonical path) are no evidence of anything, and a source scan pins that nothing here reads
// them.
//
// WHAT THE CALLER NO LONGER HOLDS (R57, R65, D-4653; spec §5.3: "a lost event can delay or prevent a link, never create one"). The
// caller holds a bounded slice of the journal. Several rules that keep a tree from linking are NEGATIVE evidence: they fire only while
// the other party's events are still held. A rival claim on the same upstream ID (rungs 2 and 3), the parent's own working directory and
// a second subagent on the path (rung 3), and another session's overlapping window (rung 4). An eviction can empty any of them, and a
// link that rests on an emptied rule is a permanent, wrong lease. So an eviction may only make a verdict LESS decided, and the two
// halves of that are decided differently, because an instant can bound a listing window but cannot see an event that is gone:
//   - RUNG 4 reads `evidenceHorizon` (the latest `observedAt` among evicted events) and the windows it holds, and refuses a link when a
//     window it holds could have been overlapped by one it lost.
//   - RUNGS 2 AND 3 read `droppedEvidence`, an index of the keys the caller kept of every event it dropped (the caller drops one by
//     eviction, by a reload that truncates, and, by its one-event-per-tuple rule, every later event of a tuple whose first was evicted).
//     A link of activity A (parent p, upstream id X, at path C) is `unmeasured('evidence-horizon')` if a dropped event (a) names X from
//     a parent other than p, or (b) reported C and either carries no agent id and comes from p, or carries an agent id other than X and
//     is not a SubagentStart or SubagentStop. That is membership, not a comparison with an instant. A caller that has not measured what
//     it dropped says so, and an unmeasured index is not an empty one: every link is then `unmeasured('evidence-horizon')` (D-4008).
//     A caller that FORGETS a key without a measured census showing its tree gone leaves a coarser MARK in the index instead (R73: a
//     path hash, an id hash, a lost project, or a global flag), and a rung-2 or rung-3 link that any mark covers is `unmeasured` too.
//   - `combine` never lets a link beat an `evidence-horizon` answer from the other rung: that answer is a rung that found an activity
//     and was about to link, and its real answer may have been a link to another parent.
//   - LOST WINDOWS (2c, R84; coordinator 5477: "lost evidence must never decide a link"). The caller also hands over windows whose
//     listings it LOST: a Bash call whose listing the hook shed (`truncated`), and a session-hour it could not measure. Such a window says
//     when a call may have run, never what it listed. A rung-4 candidate it may overlap is `unmeasured('evidence-horizon')`, and so is
//     a tree with NO rung-4 candidate whose creator's call such a window, or an eviction, may have held (X1: the bracket between the census
//     that did not list the tree and the first that did, `firstSighting`), which stops a rung-3 link beside it. The reason is the same
//     `evidence-horizon`, because the remedy is the same: the full evidence was not a link to this activity, or was not known to be.
// A verdict that was not a link is never touched: the rules above only ever turn a link into a non-answer.
//
// INTERPRETATIONS (each recorded in the task report): `conflicting` is decided over PARENTS: two linked rungs that name the same
// parent are agreement (the lowest rung's activity is reported) and two that name different parents conflict; `repository` on a
// listing window is compared to the census record's `project`, the one repository key the census carries; an `unresolved` ccd
// workspace (registry row or `.child` without run-child agreement) and a record whose first pass is still inside the birth wait are
// non-answers, not leases.
import { DELEGATION_ACTIVITY_SOURCE_KINDS, type DelegationEventEnvelopeV1, type DelegationLeaseSourceKind } from '../../../shared/api.js';
import {
  DELEGATION_MODEL_REFUSALS,
  DelegationModelError,
  leaseSourceKindOfActivity,
  parseDelegationInstant,
  type DelegationActivityRow,
  type DelegationCensusRecord,
} from './delegation-model.js';

// ── The vocabulary the plan fixes ─────────────────────────────────────────────────────────────────────────────────────

/** One Bash call's before/after listing of a repository's admin-record names, with the call's time window. */
export interface DelegationListingWindow {
  sessionId: string;
  parentIncarnation: string;
  toolUseId: string;
  /** The census project key of the session that ran the call, or NULL when the caller cannot name it (I-1: a session whose registry row
   *  is gone, after a restart). A null repository is UNKNOWN, never "another repository": rung 4 treats such a window as on every
   *  repository for its overlap and horizon tests, and never takes it as a candidate. */
  repository: string | null;
  /** 2c d (R84): the repository the call's working directory is attributed to (the nearest tree the caller lists or remembers, else its
   *  resolved projects root), which is the repository the hook LISTED. Null when the caller cannot attribute it (no `cwd`, or no tree and
   *  no resolved root names it): UNKNOWN, so the window may be on every repository. Absent: the caller did not measure it, and only
   *  `repository` is read (the rule before R84). It widens the overlap and horizon tests only; a candidate is still chosen by `repository`. */
  listedRepository?: string | null;
  /** 2c (R84): the window's listings were LOST (a shed listing, an unmeasured hour), so its listings mean nothing: it is never a candidate
   *  and never a held window to the horizon test, and a link it may hide is `unmeasured('evidence-horizon')`. An hour's window names no
   *  call: its `toolUseId` is the empty string. */
  lost?: true;
  startedAt: string;
  endedAt: string | null;
  before: readonly string[];
  after: readonly string[] | null;
}

export interface DelegationCorrelationInput {
  record: DelegationCensusRecord;
  runChildAgreement: {
    activityId: string;
    evidenceJournalIds: readonly string[];
  } | null;
  activities: readonly DelegationActivityRow[];
  acceptedEvidence: readonly {
    journalId: string;
    event: DelegationEventEnvelopeV1;
  }[];
  pointMetas: readonly {
    parentId: string;
    parentIncarnation: string;
    sourceKind: 'agent' | 'workflow';
    upstreamId: string;
    worktreePath: string;
    evidenceJournalId: string;
  }[];
  listingWindows: readonly DelegationListingWindow[];
  birthPassesRemaining: 0 | 1 | 2;
  hasRegistryRow: boolean;
  hasChildMarker: boolean;
  /** R57 (D-4653): the latest `observedAt` among events the caller has evicted from `acceptedEvidence` and `listingWindows`, or null when
   *  it evicted none. It decides RUNG 4 ONLY (a listing window is an instant and an interval, which an instant can bound). It cannot
   *  decide rungs 2 and 3: an event observed AFTER it may still be missing, because the caller keeps one event per (session,
   *  incarnation, agent, directory) and hides that tuple's later events once its first is evicted. Those rungs read `droppedEvidence`. */
  evidenceHorizon: string | null;
  /** R65 (D-4653): what the caller remembers of the events it no longer holds, reduced to the keys rungs 2 and 3 read. NEVER null: a
   *  caller that has not measured it says so (`DELEGATION_DROPPED_UNMEASURED`), and an unmeasured index is not an empty one. */
  droppedEvidence: DelegationDroppedEvidence;
  /** X1 (R84): when the census first listed this tree. `at` is the census that first listed it; `after` the latest earlier census of the
   *  tree's project, which did not, or NULL when the caller has none (a restart lost it, or no earlier census of the project was measured):
   *  a LOST first-sighting instant is not an empty one, so the bracket is then (-inf, at] (coordinator 5484, condition 3). The tree was
   *  created in (after, at], so the call that created it began in [after - margin, at]. Read only to VETO a link (never to make one). */
  firstSighting: { after: string | null; at: string };
}

export type DelegationCorrelationVerdict =
  | {
      kind: 'run-child-owned';
      activityId: string;
      evidenceJournalIds: readonly string[];
    }
  | {
      kind: 'linked';
      activityId: string;
      rung: 2 | 3 | 4;
      evidenceJournalIds: readonly string[];
    }
  | { kind: 'unresolved'; reason: string; evidenceJournalIds: readonly string[] }
  | { kind: 'conflicting'; reason: string; evidenceJournalIds: readonly string[] }
  | { kind: 'unmeasured'; reason: string; evidenceJournalIds: readonly string[] };

/** The only verdict that may reach lease creation. `run-child-owned` is deliberately not assignable to it (W3-M63). */
export type DelegationLinkedVerdict = Extract<DelegationCorrelationVerdict, { kind: 'linked' }>;

/**
 * Every reason a non-answer can carry, declared ONCE. The plan types a verdict's `reason` as `string`, and that stays; but Task 12 must
 * branch on some of them (`ccrc-birth-wait` and `ccd-workspace-not-a-lease` are a tree being BORN, not unowned work), so the words are
 * a closed list it imports rather than spells. Server-internal (it is not a wire word), hence here and not in `shared/api.ts`.
 */
export const DELEGATION_CORRELATION_REASONS = [
  'record-unreadable',
  'record-absent',
  'ccd-workspace-not-a-lease',
  'ccrc-birth-wait',
  'canonical-path-unmeasured',
  'rung-2-evidence-absent',
  'same-upstream-id-in-multiple-sessions',
  'duplicate-activity-rows',
  'rung-2-meta-absent',
  'meta-paths-disagree',
  'rung-2-path-mismatch',
  'rung-2-subagent-event-absent',
  'activity-not-durably-open',
  'agent-id-claimed-by-multiple-sessions',
  'path-claimed-by-multiple-parents',
  'ambiguous-subagent-path',
  'parent-cwd',
  'overlapping-listing-window',
  'listing-window-instant-unreadable',
  'ambiguous-listing-windows',
  'rungs-disagree',
  'no-correlating-evidence',
  'evidence-horizon',
] as const;
export type DelegationCorrelationReason = (typeof DELEGATION_CORRELATION_REASONS)[number];

// ── The dropped-evidence index (R65, part of D-4653) ─────────────────────────────────────────────────────────────────

/**
 * One event the caller no longer holds, reduced to the fields the negative-evidence rules of rungs 2 and 3 read, and nothing else. The
 * caller keeps DISTINCT keys, never events. A SubagentStart or SubagentStop is told apart because the host emits them with the parent's
 * context, so they are not "emitted from inside" a subagent (the rule `rung3` applies to the events it holds).
 */
export interface DelegationDroppedKey {
  parentId: string;
  parentIncarnation: string;
  /** The event's own `agentId` (its emitter), or null. */
  agentId: string | null;
  /** The agent an Agent/Task launch response named, or null. */
  launchAgentId: string | null;
  /** The run a Workflow launch response named, or null. */
  runId: string | null;
  /** The working directory the event reported, or null. */
  cwd: string | null;
  startStop: boolean;
}

/** The index correlation queries. `measured: false` is the caller saying it has NOT (re)read what it dropped; it is not "nothing". */
export type DelegationDroppedEvidence =
  | { readonly measured: false }
  | {
      readonly measured: true;
      /** An agent id or a run id -> the parents (by key) of the dropped events that named it. */
      readonly named: ReadonlyMap<string, ReadonlySet<string>>;
      /** A working directory -> the dropped events that reported it. */
      readonly atPath: ReadonlyMap<string, readonly { parent: string; agentId: string | null; startStop: boolean }[]>;
      /** R73: what the caller FORGOT without a measured census showing the tree gone, kept as coarse marks. */
      readonly marks: DelegationLostMarks;
    };

/** A lost or never-built index. Every link answers `unmeasured('evidence-horizon')` against it (D-4008: unknown is never empty). */
export const DELEGATION_DROPPED_UNMEASURED: DelegationDroppedEvidence = Object.freeze({ measured: false as const });

// ── The lossy marks (R73, part of D-4653) ────────────────────────────────────────────────────────────────────────────

/**
 * A set of 64-bit hashes of texts, in bounded memory: open addressing over a `Uint32Array` of (high, low) pairs, the pair (0, 0) being an
 * empty slot. PLAIN DATA (no methods, no closures), so a correlation input that carries one stays cloneable; an empty one is a zero-length
 * array, which also freezes. A collision can only make a text read as present: a mark that is wrongly present makes a link `unmeasured`,
 * never makes one, and at 64 bits and the caller's cap (well under a million) the chance per query is below one in ten million million.
 */
export interface DelegationHashSet {
  slots: Uint32Array;
  size: number;
}

export const emptyDelegationHashSet = (): DelegationHashSet => ({ slots: new Uint32Array(0), size: 0 });

/** Two independent 32-bit lanes over the UTF-16 code units (a cyrb53-style mix kept at its full 64 bits); never the pair (0, 0). */
function hash64(text: string): readonly [number, number] {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = h1 >>> 0;
  const lo = h2 >>> 0;
  return hi === 0 && lo === 0 ? [0, 1] : [hi, lo];
}

/** The pair index where `hash` is, or the empty one where it would go. `slots` holds at least one empty pair (the load stays under 3/4). */
function probeOf(slots: Uint32Array, hi: number, lo: number): number {
  const mask = slots.length / 2 - 1;
  let i = (lo ^ Math.imul(hi, 0x9e3779b1)) & mask;
  for (;;) {
    const a = slots[2 * i]!;
    const b = slots[2 * i + 1]!;
    if ((a === hi && b === lo) || (a === 0 && b === 0)) return i;
    i = (i + 1) & mask;
  }
}

export function delegationHashSetHas(set: Readonly<DelegationHashSet>, text: string): boolean {
  if (set.size === 0) return false;
  const [hi, lo] = hash64(text);
  const i = probeOf(set.slots, hi, lo);
  return set.slots[2 * i] === hi && set.slots[2 * i + 1] === lo;
}

/** Adds `text`; answers false ONLY when the set already holds `cap` texts and `text` is not one of them (the caller then raises its global
 *  lossy flag). The array grows by doubling, so its memory is at most 16 bytes a slot pair over the smallest power of two above 4/3 cap. */
export function delegationHashSetAdd(set: DelegationHashSet, text: string, cap: number): boolean {
  const [hi, lo] = hash64(text);
  if (set.slots.length > 0) {
    const i = probeOf(set.slots, hi, lo);
    if (set.slots[2 * i] === hi && set.slots[2 * i + 1] === lo) return true;
  }
  if (set.size >= cap) return false;
  const pairs = set.slots.length / 2;
  if ((set.size + 1) * 4 > pairs * 3) {
    const grown = new Uint32Array(Math.max(2048, set.slots.length * 2));
    for (let j = 0; j < pairs; j++) {
      const a = set.slots[2 * j]!;
      const b = set.slots[2 * j + 1]!;
      if (a === 0 && b === 0) continue;
      const k = probeOf(grown, a, b);
      grown[2 * k] = a;
      grown[2 * k + 1] = b;
    }
    set.slots = grown;
  }
  const i = probeOf(set.slots, hi, lo);
  set.slots[2 * i] = hi;
  set.slots[2 * i + 1] = lo;
  set.size += 1;
  return true;
}

/**
 * THE LOSSY MARKS (R73). The caller forgets a dropped key either because a census of its project, measured in this pass, shows every tree
 * the key could veto gone, or by replacing it with one of these COARSER marks, each of which still moves every link the key could have
 * vetoed to `unmeasured('evidence-horizon')` (rungs 2 and 3; rung 4 reads no key):
 *   - `paths`: 64-bit hashes of the working directories of the clause-(b) keys it forgot; a tree whose canonical path is one of them;
 *   - `ids`: 64-bit hashes of the agent and run ids of the clause-(a) keys it forgot; an activity whose upstream id (or run) is one of them;
 *   - `projects`: the projects whose held keys it dropped at its per-project cap; every tree of such a project;
 *   - `prefixes` (R77, N19): the directories that ATTRIBUTED path marks to a project now lost (the nearest tree, or the project's own
 *     checkout under the projects root); every tree at or under one, whatever repository it belongs to. A lost project's marks are
 *     dropped, and a mark is attributed by path, so a mark that really guarded another repository's tree nested there would be dropped
 *     with it: the prefix keeps its veto;
 *   - `lossy`: a hash set reached its cap; every rung-2 and rung-3 link.
 * A false mark only ever delays a link. What sets and clears each is the caller's (the lane's docstring, `watch.ts`).
 */
export interface DelegationLostMarks {
  readonly lossy: boolean;
  readonly projects: ReadonlySet<string>;
  /** R77: every tree whose canonical path is at or under one of these is covered (the lost projects' attributing prefixes). */
  readonly prefixes: ReadonlySet<string>;
  /** The path marks, as the caller keeps them (R75: one set per project they are attributed to, and one for none); a path in ANY of
   *  them is marked. */
  readonly paths: readonly Readonly<DelegationHashSet>[];
  readonly ids: Readonly<DelegationHashSet>;
}

/** No marks: a lane that has forgotten nothing it could not prove gone. */
export const DELEGATION_NO_MARKS: DelegationLostMarks = Object.freeze({
  lossy: false, projects: Object.freeze(new Set<string>()) as ReadonlySet<string>, prefixes: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  paths: Object.freeze([]) as readonly DelegationHashSet[], ids: Object.freeze(emptyDelegationHashSet()),
});

/** Is this path in one of the path-mark sets? */
const pathMarked = (m: DelegationLostMarks, path: string): boolean => m.paths.some((s) => delegationHashSetHas(s, path));

/** R77: is this path at or under one of the lost projects' attributing prefixes? O(path depth). */
function prefixCovered(m: DelegationLostMarks, path: string): boolean {
  if (m.prefixes.size === 0) return false;
  for (let p = path; p.length > 0;) {
    if (m.prefixes.has(p)) return true;
    const cut = p.lastIndexOf('/');
    if (cut <= 0) break;
    p = p.slice(0, cut);
  }
  return false;
}

/** The kinds of mark, for the caller's count of the verdicts each changed. `prefix` is a lost project's attributing prefix (R77);
 *  `window` is a listing window whose repository the caller cannot name (I-1), which is not in the index but is counted beside it. */
export type DelegationMarkKind = 'lossy' | 'project' | 'prefix' | 'path' | 'id' | 'window';

/** The keys of one dropped event. */
export function delegationDroppedKeyOf(event: DelegationEventEnvelopeV1): DelegationDroppedKey {
  const launch = event.eventKind === 'PostToolUse' && 'launch' in event && typeof event.launch === 'object' && event.launch !== null ? event.launch : null;
  return {
    parentId: event.sessionId,
    parentIncarnation: event.parentIncarnation,
    agentId: text(event.agentId) ? event.agentId : null,
    launchAgentId: launch !== null && 'agentId' in launch && text(launch.agentId) ? launch.agentId : null,
    runId: launch !== null && 'runId' in launch && text(launch.runId) ? launch.runId : null,
    cwd: text(event.cwd) ? event.cwd : null,
    startStop: event.eventKind === 'SubagentStart' || event.eventKind === 'SubagentStop',
  };
}

/** The identity of a key, for the caller's de-duplication. */
export const delegationDroppedKeyId = (k: DelegationDroppedKey): string =>
  JSON.stringify([k.parentId, k.parentIncarnation, k.agentId, k.launchAgentId, k.runId, k.cwd, k.startStop]);

/** A MEASURED index over these keys and the marks of what the caller forgot (empty keys and no marks: measured, nothing dropped). */
export function indexDelegationDropped(keys: Iterable<DelegationDroppedKey>, marks: DelegationLostMarks = DELEGATION_NO_MARKS): DelegationDroppedEvidence {
  const named = new Map<string, Set<string>>();
  const atPath = new Map<string, { parent: string; agentId: string | null; startStop: boolean }[]>();
  for (const k of keys) {
    const parent = parentKey(k.parentId, k.parentIncarnation);
    for (const name of [k.agentId, k.launchAgentId, k.runId]) {
      if (name === null) continue;
      const parents = named.get(name) ?? new Set<string>();
      parents.add(parent);
      named.set(name, parents);
    }
    if (k.cwd !== null) {
      const here = atPath.get(k.cwd) ?? [];
      if (!here.some((e) => e.parent === parent && e.agentId === k.agentId && e.startStop === k.startStop)) here.push({ parent, agentId: k.agentId, startStop: k.startStop });
      atPath.set(k.cwd, here);
    }
  }
  return { measured: true, named, atPath, marks };
}

/** The identity of a tree the census lists: its project and its admin record. */
export const delegationTreeKey = (project: string, adminRecord: string): string => JSON.stringify([project, adminRecord]);

/**
 * The slack allowed between the fleet's clock (the time an event was observed) and the server's (the time a census was measured): the
 * remote deployment has two boxes. A key whose latest dropped event is within this of the census is kept, because a tree born after the
 * census could have an event that looks earlier than it. It ASSUMES THE TWO BOXES ARE NTP-SYNCED: a fleet box whose clock drifts further
 * than this can make an event observed after the census read as one before it. (Accepted interpretations, R73: the drop time is the
 * event's own `observedAt`, and the allowance is 60 s.)
 */
export const DELEGATION_CLOCK_SKEW_MS = 60_000;

/** What the planner needs to know of one project's census in this pass. */
export interface DelegationPruneProject {
  /** The project's delegation records as MEASURED in this pass, or null when this pass measured none. */
  readonly records: readonly DelegationCensusRecord[] | null;
  /**
   * The project can hold no tree the lane decides, so for pruning it counts as measured with no trees (R70). That is a refused
   * project name (`refused-project`: the census returns before it reads anything, so the project never produces a record and no path in
   * it can become a rung-2 or rung-3 candidate, which is always a census RECORD) and a `not-a-checkout` answer the caller has seen on
   * enough consecutive passes to trust (R71: one such pass may be a dropped round trip that landed on one stat and not its neighbour).
   */
  readonly standing: boolean;
  /** A measured census of the project has been read since this lane started: until then what it remembers is only what the checkpoint
   *  gave it, and a project this lane has not seen is not a project it can prune for. */
  readonly measuredSinceStart: boolean;
  /**
   * R73 rule 1: the project's census lists a record whose path is null for a TRANSIENT reason (a `gitdir` read that failed, a record being
   * born) and which has no remembered path, and the caller's streak for it has not run its course. Such a project keeps its own keys, as
   * one not measured since the start does. The caller decides it (this module never reads a census diagnostic): a STANDING null path
   * (a relative or malformed `gitdir`, a refused name) never holds anything back, because a record with a null path is never a rung-2 or
   * rung-3 candidate (`canonical-path-unmeasured`), and its keys, forgotten, leave path marks that catch it if it is ever repaired.
   */
  readonly unplacedHold: boolean;
}

/**
 * The trees (by `delegationTreeKey`) that a MEASURED census of their own project shows gone: the project's records, measured in this
 * pass, do not list the record or list it `absent`; or the project is a standing refusal and holds no tree at all. A tree whose project
 * has no view this pass, is absent from the map, or whose record is listed with a null path (a `gitdir` read that failed) is NOT gone.
 */
export function delegationGoneTrees(known: ReadonlyMap<string, string>, projects: ReadonlyMap<string, DelegationPruneProject>): string[] {
  const gone: string[] = [];
  for (const treeKey of known.keys()) {
    const [project, adminRecord] = JSON.parse(treeKey) as [string, string];
    const p = projects.get(project);
    if (p === undefined) continue;
    if (p.standing) { gone.push(treeKey); continue; }
    if (p.records === null) continue;
    if (!p.records.some((r) => r.adminRecord === adminRecord && r.state !== 'absent')) gone.push(treeKey);
  }
  return gone;
}

export interface DelegationPruneInput {
  /** Every dropped key: its id, the keys, and the time of the LATEST event dropped under it (epoch ms; Infinity when unreadable). */
  keys: Iterable<readonly [string, DelegationDroppedKey, number]>;
  projects: ReadonlyMap<string, DelegationPruneProject>;
  /** The last MEASURED canonical path of each tree, by `delegationTreeKey`. */
  known: ReadonlyMap<string, string>;
  /** The paths of the trees that THIS census (the one the plan prunes against) showed gone, which the caller has already stopped
   *  remembering. A key at one of them is forgotten with no path mark: invariant (1). A path shown gone by an earlier census is not one. */
  gonePaths: ReadonlySet<string>;
  /** The project a session belongs to, when the caller knows it. */
  projectOfParent: (parentId: string) => string | undefined;
  activities: readonly DelegationActivityRow[];
  /** When the census was measured (epoch ms). */
  measuredAtMs: number;
  /** R73: the projects already lost (their keys were dropped at the per-project cap): every tree of one is covered by its project mark. */
  lost: ReadonlySet<string>;
  /** R73 rule 3: the most keys a held-back project may keep; past it, the project is lost. */
  holdCap: number;
  /** R75, N20: the PHYSICAL directory the census reads each project's checkout under (`<projectsRoot>/<project>`), resolved by the
   *  caller on the box that holds it; null when the caller has none; `DELEGATION_ROOT_UNMEASURED` when the caller has one but could not
   *  resolve it (attribution by the root then answers nothing, never the configured spelling). Only attribution reads it. */
  projectsRoot: DelegationProjectsRoot;
}

/** N20 (coordinator 5439): a projects root the caller has but could not resolve. Not `null`, which is "no projects root": a root that
 *  failed to resolve is retried by the caller, and in the meantime attribution by the root is UNMEASURED, so no mark is attributed by a
 *  spelling that may not be the physical path git reports (a guess). */
export const DELEGATION_ROOT_UNMEASURED: { readonly unmeasured: true } = Object.freeze({ unmeasured: true as const });
export type DelegationProjectsRoot = string | null | typeof DELEGATION_ROOT_UNMEASURED;

/** What a path mark is attributed to (R75), and the directory that attributed it (R77): the nearest tree's canonical path, or the
 *  project's checkout `<projectsRoot>/<project>`. */
export interface DelegationMarkAttribution { project: string; prefix: string }

/**
 * R75: the project a path mark is attributed to, so that at its cap the caller can turn a project lost (its project mark covers every
 * tree of it) instead of raising the global flag. A directory belongs to project P when it is at or under a tree the caller lists or
 * remembers for P (the nearest such tree), or at or under P's own checkout `<projectsRoot>/<P>`, which is where the census reads P from;
 * otherwise to no project. A root the caller could not resolve (`DELEGATION_ROOT_UNMEASURED`) attributes nothing: the nearest-tree rule
 * still applies (a tree's path is canonical), and a mark it does not place is attributed to no project, the safe side (N20).
 * NESTING ACROSS REPOSITORIES (R77, N19): a tree of ANOTHER repository can sit inside P's checkout or inside one of P's trees (git allows
 * it; nothing on a ccrc fleet makes it). A mark there is attributed to P. When P is lost its marks are dropped, so the caller keeps the
 * PREFIX that attributed each one and, once P is lost, covers every tree at or under it (`DelegationLostMarks.prefixes`): the nested
 * tree's veto is kept, whatever repository it belongs to.
 */
export function delegationMarkAttributionOf(path: string, projectsRoot: DelegationProjectsRoot, trees: ReadonlyMap<string, string>): DelegationMarkAttribution | null {
  for (let p = path; p.length > 0;) {
    const owner = trees.get(p);
    if (owner !== undefined) return { project: owner, prefix: p };
    const cut = p.lastIndexOf('/');
    if (cut <= 0) break;
    p = p.slice(0, cut);
  }
  if (projectsRoot === null || typeof projectsRoot !== 'string') return null;
  const root = projectsRoot.replace(/\/+$/, '');
  if (root === '' || !path.startsWith(`${root}/`)) return null;
  const project = path.slice(root.length + 1).split('/')[0];
  return project === undefined || project === '' ? null : { project, prefix: `${root}/${project}` };
}

/** The project alone (`delegationMarkAttributionOf`). */
export function delegationMarkProjectOf(path: string, projectsRoot: DelegationProjectsRoot, trees: ReadonlyMap<string, string>): string | null {
  return delegationMarkAttributionOf(path, projectsRoot, trees)?.project ?? null;
}

/** What one prune decides. The caller applies the marks BEFORE it forgets the keys (both in one synchronous step). */
export interface DelegationPrunePlan {
  /** The ids of the keys to forget. */
  forget: string[];
  /** The working directories to path-mark: of forgotten keys whose directory no tree shown gone in this census, and no lost project's
   *  remembered tree, had; each with the project it is attributed to and the prefix that attributed it (`delegationMarkAttributionOf`),
   *  or both null. */
  markPaths: { path: string; project: string | null; prefix: string | null }[];
  /** The agent and run ids to id-mark: the names of forgotten keys that nobody asks about yet (a name redundant by its own parent's
   *  activity row is exact, and is not marked). */
  markIds: string[];
  /** Projects lost in THIS plan (rule 3). */
  lose: string[];
  /** The projects still held back after this plan, and how many keys each holds (for the caller's report). */
  held: ReadonlyMap<string, number>;
}

/**
 * Which dropped keys to forget in this pass, and the marks that stand for them (R69 to R71, R73; unknown is never empty, D-4008).
 *
 * THE INVARIANT (R73). A key is forgotten only if either (1) a census of its project, measured in this pass, shows every tree the key could
 * veto gone, or (2) it is replaced by a COARSER mark that still moves every link the key could have vetoed to `unmeasured('evidence-horizon')`
 * (`DelegationLostMarks`). So the plan answers which keys to forget AND which marks to leave: a forgotten key's directory is path-marked
 * unless a tree shown gone by this census had it (1), or a lost project's remembered tree had it (its project mark covers it); a forgotten
 * key's names are id-marked unless its own parent's activity row makes them redundant (`claimsOf` reads rows, so nothing is lost). A key no
 * protected path or asked-about name needs is forgotten (`prunableDelegationDropped` argues which those are).
 *
 * A path protects its keys while any census record lists it, and while it is the remembered path of a tree no measured census of that
 * tree's own project shows gone (and whose project is not lost): so a record whose `gitdir` read failed this pass (a null path), a project
 * whose view is null this pass, and a project that is not in the census at all each keep what they had of the trees the lane knows. A tree
 * the lane does NOT know (never listed with a path since the start, and in no lease or attempt) protects nothing: its keys are forgotten
 * WITH their path marks, which is what makes a restart safe for a tree the checkpoint cannot seed (N11).
 *
 * PER PROJECT, HELD BACK, BOUNDED. A project that is not a standing refusal and either has not been measured since the lane started (its
 * view null) or lists a transient null-path record it has no path for (`unplacedHold`, rule 1) keeps ITS OWN keys: those of its sessions'
 * events and those at a path one of its remembered trees has. The other projects prune theirs. A held-back project that holds more than
 * `holdCap` keys is LOST (rule 3): it stops holding anything back, its remembered paths stop protecting (its project mark covers every
 * tree of it), and its keys go through the prune with their marks. So the index is bounded by what present trees and asked-about names
 * need, plus `holdCap` per held-back project, whatever stays unmeasured and for however long.
 *
 * A key is also kept unless its latest dropped event predates the census by more than `DELEGATION_CLOCK_SKEW_MS`: a tree born after the
 * census was measured can have events only after it, and a key that has such an event must not be forgotten against a census that
 * could not have listed the tree. The stamp is the event's own observed time, not the lane's clock: a restart replays the journal, and
 * the lane's clock would make every replayed key look newer than the census. (Accepted interpretations, R73: "drop time" is the event's
 * `observedAt`; the 60 s allowance assumes the fleet box and the server are NTP-synced, and a box drifting further can make an event
 * after the census read as one before it.)
 *
 * WHAT THIS FORGETS WITHOUT A MARK, AND WHY THAT IS SOUND (R68, as revised). The forgotten events belong to a tree that no longer exists:
 * it was shown gone by a measured census of its project, in this pass. A tree later created at that path does not inherit them. (The held
 * events of an earlier life still veto a tree at the same path, because rung 3 compares paths and not lives; the controller ruled that the
 * forgotten ones need not, because the alternative, remembering them for ever, is the unbounded index.)
 *
 * THE CLAUSE-(a) OBSERVATION. A rival key naming X is forgotten when nobody asks about X (no present `agent-<X>` tree and no agent
 * activity row for X). It now leaves an id mark, so an X asked about later answers `unmeasured` until a re-index reads the key again.
 */
export function planDelegationDroppedPrune(input: DelegationPruneInput): DelegationPrunePlan {
  const { projects, known } = input;
  const measured: DelegationCensusRecord[] = [];
  for (const p of projects.values()) if (p.records !== null) measured.push(...p.records);
  const gone = new Set(delegationGoneTrees(known, projects));
  const projectOfTree = (treeKey: string): string => (JSON.parse(treeKey) as [string, string])[0];

  // Who can hold keys back, and which paths each owns (the paths the census lists, and the remembered ones not shown gone).
  const blocked = new Set<string>();
  for (const [project, p] of projects) {
    if (input.lost.has(project) || p.standing) continue;
    if ((p.records === null && !p.measuredSinceStart) || p.unplacedHold) blocked.add(project);
  }
  const pathProjects = new Map<string, Set<string>>();
  const ownedBy = (path: string, project: string): void => { const set = pathProjects.get(path) ?? new Set<string>(); set.add(project); pathProjects.set(path, set); };
  for (const r of measured) if (r.canonicalPath !== null) ownedBy(r.canonicalPath, r.project);
  for (const [treeKey, path] of known) if (!gone.has(treeKey)) ownedBy(path, projectOfTree(treeKey));
  const entries = [...input.keys];
  const holdersOf = (k: DelegationDroppedKey, among: ReadonlySet<string>): string[] => {
    if (among.size === 0) return [];
    const out = new Set<string>();
    const owner = input.projectOfParent(k.parentId);
    if (owner !== undefined && among.has(owner)) out.add(owner);
    if (k.cwd !== null) for (const q of pathProjects.get(k.cwd) ?? []) if (among.has(q)) out.add(q);
    return [...out];
  };
  const countHeld = (among: ReadonlySet<string>): Map<string, number> => {
    const held = new Map<string, number>();
    for (const [, k] of entries) for (const q of holdersOf(k, among)) held.set(q, (held.get(q) ?? 0) + 1);
    return held;
  };

  // Rule 3: a held-back project over the cap is lost, and stops holding anything back.
  const lose = [...countHeld(blocked)].filter(([, n]) => n > input.holdCap).map(([project]) => project).sort();
  for (const project of lose) blocked.delete(project);
  const lost = new Set([...input.lost, ...lose]);

  // What protects a path, and what covers one (a key forgotten at a covered path needs no path mark).
  const protectedPaths = new Set<string>();
  const covered = new Set<string>(input.gonePaths);
  for (const r of measured) if (r.canonicalPath !== null) protectedPaths.add(r.canonicalPath);
  for (const [treeKey, path] of known) {
    if (gone.has(treeKey) || lost.has(projectOfTree(treeKey))) covered.add(path);
    else protectedPaths.add(path);
  }
  for (const path of protectedPaths) covered.delete(path);

  const candidates = entries.filter(([, k]) => holdersOf(k, blocked).length === 0);
  const forgotten = pruneDropped(candidates, measured, protectedPaths, input.activities, input.measuredAtMs - DELEGATION_CLOCK_SKEW_MS);
  const markPaths = new Set<string>();
  const markIds = new Set<string>();
  for (const f of forgotten) {
    // A SubagentStart or SubagentStop never vetoes by its path (clause (b) skips them; it carries an agent id), so it needs no path mark.
    if (f.key.cwd !== null && !f.key.startStop && !covered.has(f.key.cwd)) markPaths.add(f.key.cwd);
    for (const name of f.unaskedNames) markIds.add(name);
  }
  // R75: each path mark's project, by the nearest tree the census lists or the caller remembers, else by the checkout root.
  const trees = new Map<string, string>();
  for (const [treeKey, path] of known) trees.set(path, projectOfTree(treeKey));
  for (const r of measured) if (r.canonicalPath !== null) trees.set(r.canonicalPath, r.project);
  return {
    forget: forgotten.map((f) => f.id),
    markPaths: [...markPaths].map((path) => {
      const a = delegationMarkAttributionOf(path, input.projectsRoot, trees);
      return { path, project: a?.project ?? null, prefix: a?.prefix ?? null };
    }),
    markIds: [...markIds], lose, held: countHeld(blocked),
  };
}

/**
 * Which dropped keys can be forgotten: those no protected path, no present census record's name and no activity row can still ask
 * about, whose latest dropped event is before `cutoffMs`. Answers the keys' ids; it changes nothing. `planDelegationDroppedPrune` decides
 * what is protected and when to call this, and which marks a forgotten key leaves; it is exported for its own rows.
 *
 * WHY THIS IS SOUND. A key changes a verdict only through the two queries above, and each asks about something specific:
 *   - clause (b) asks about the canonical path of the census record being decided, so a key whose `cwd` is no protected path is never
 *     asked, and a protected path keeps EVERY key that reported it;
 *   - clause (a) asks about an upstream id X: rung 2's is the name of a present `agent-<id>` tree (the id) or `wf_<run>-<n>` tree (the
 *     run), and rung 3's is the upstream id of an `agent` activity row. A key whose names are none of those is never asked. And a key
 *     naming X from parent R is REDUNDANT when the checkpoint already holds R's activity row for X, because `claimsOf` reads rows and
 *     sees R as a claimant whatever the lane holds: only a rival with NO row (a parent that sent a bare event naming X, whose meta was
 *     never read) can be hidden by an eviction, and that is the key kept. Wave 3 never deletes an activity row; a wave that does must
 *     revisit this rule. A run id is never redundant by rows (a row names a worker, not the run), so it is kept while a present tree or
 *     a workflow row carries the run.
 * "Never asked" is about NOW: a path or a name asked about later is what the planner's marks are for (R73).
 */
export function prunableDelegationDropped(
  keys: Iterable<readonly [string, DelegationDroppedKey, number]>,
  census: readonly DelegationCensusRecord[],
  protectedPaths: ReadonlySet<string>,
  activities: readonly DelegationActivityRow[],
  cutoffMs: number,
): string[] {
  return pruneDropped(keys, census, protectedPaths, activities, cutoffMs).map((f) => f.id);
}

/** `prunableDelegationDropped`, with each forgotten key's names that nobody asks about (the ones that must leave an id mark). */
function pruneDropped(
  keys: Iterable<readonly [string, DelegationDroppedKey, number]>,
  census: readonly DelegationCensusRecord[],
  protectedPaths: ReadonlySet<string>,
  activities: readonly DelegationActivityRow[],
  cutoffMs: number,
): { id: string; key: DelegationDroppedKey; unaskedNames: string[] }[] {
  const askedAgents = new Set<string>();
  const askedRuns = new Set<string>();
  for (const r of census) {
    if (r.adminRecord.startsWith(AGENT_PREFIX)) askedAgents.add(r.adminRecord.slice(AGENT_PREFIX.length));
    const wf = /^(wf_.+)-(\d+)$/.exec(r.adminRecord);
    if (wf !== null) askedRuns.add(wf[1]!);
  }
  const rows = new Set<string>();
  for (const a of activities) {
    if (a.sourceKind === 'agent') {
      askedAgents.add(a.upstreamId);
      rows.add(JSON.stringify([a.parentId, a.parentIncarnation, a.upstreamId]));
    } else if (a.sourceKind === 'workflow') {
      const wf = /^(wf_.+)-(\d+)$/.exec(a.upstreamId);
      if (wf !== null) askedRuns.add(wf[1]!);
    }
  }
  const forget: { id: string; key: DelegationDroppedKey; unaskedNames: string[] }[] = [];
  for (const [id, k, at] of keys) {
    if (!(at < cutoffMs)) continue;
    if (k.cwd !== null && protectedPaths.has(k.cwd)) continue;
    const ownRow = (name: string): boolean => rows.has(JSON.stringify([k.parentId, k.parentIncarnation, name]));
    const needsAgent = (name: string | null): boolean => name !== null && askedAgents.has(name) && !ownRow(name);
    if (needsAgent(k.agentId) || needsAgent(k.launchAgentId)) continue;
    if (k.runId !== null && askedRuns.has(k.runId)) continue;
    // Reaching here, an agent name is either not asked about (it leaves a mark) or redundant by its own parent's row (exact: no mark);
    // a run id is not asked about (a mark).
    const unaskedNames: string[] = [];
    for (const name of [k.agentId, k.launchAgentId]) if (name !== null && !askedAgents.has(name)) unaskedNames.push(name);
    if (k.runId !== null) unaskedNames.push(k.runId);
    forget.push({ id, key: k, unaskedNames });
  }
  return forget;
}

/**
 * Did one of the caller's marks change this verdict, and which kind (R73: the links each kind of mark held at `unmeasured`,
 * counted apart from every other `unmeasured` reason)? Null for any verdict that is not `unmeasured('evidence-horizon')`, for an
 * unmeasured index (which is not a mark), and for a verdict the same input without marks answers the same way (a real key, a horizon or
 * the unmeasured state decided it). Otherwise the first kind that applies, in the order the rungs ask: the global flag, the lost project,
 * the tree's path, and (since nothing else could have) an id.
 * A mark is asked BEFORE lost evidence (2c): both sides of the question are read without the lost windows and without X1, so a verdict a
 * mark and lost evidence both hold is the mark's, and `delegationLostEvidenceForced` does not count it.
 */
export function delegationMarkForced(input: DelegationCorrelationInput, verdict: DelegationCorrelationVerdict): DelegationMarkKind | null {
  const d = input.droppedEvidence;
  if (!d.measured || verdict.kind !== 'unmeasured' || verdict.reason !== 'evidence-horizon') return null;
  const m = d.marks;
  if (!m.lossy && m.projects.size === 0 && m.prefixes.size === 0 && m.paths.every((s) => s.size === 0) && m.ids.size === 0) return null;
  const held = { ...input, listingWindows: input.listingWindows.filter((w) => w.lost !== true) };
  const withMarks = correlate(held, false);
  if (withMarks.kind !== 'unmeasured' || withMarks.reason !== 'evidence-horizon') return null;
  const without = correlate({ ...held, droppedEvidence: { ...d, marks: DELEGATION_NO_MARKS } }, false);
  if (without.kind === 'unmeasured' && without.reason === 'evidence-horizon') return null;
  if (m.lossy) return 'lossy';
  if (m.projects.has(input.record.project)) return 'project';
  if (input.record.canonicalPath !== null && prefixCovered(m, input.record.canonicalPath)) return 'prefix';
  if (input.record.canonicalPath !== null && pathMarked(m, input.record.canonicalPath)) return 'path';
  return 'id';
}

/**
 * I-1: did a listing window whose repository the caller cannot name change this verdict? Such a window vetoes every candidate it
 * overlaps (rung 4), so it is counted like a mark, apart from every other reason (`window`). False when the input holds none, for a
 * link, and for a verdict the same input without them answers the same way.
 */
export function delegationUnknownWindowForced(input: DelegationCorrelationInput, verdict: DelegationCorrelationVerdict): boolean {
  if (verdict.kind === 'linked' || verdict.kind === 'run-child-owned') return false;
  // A LOST window is not counted here (2c): it is lost evidence, counted apart (`delegationLostEvidenceForced`), and asked after this
  // kind, so both sides of the question are read without the lost windows and without X1.
  if (!input.listingWindows.some((w) => w.repository === null && w.lost !== true)) return false;
  const held = input.listingWindows.filter((w) => w.lost !== true);
  const base = correlate({ ...input, listingWindows: held }, false);
  const without = correlate({ ...input, listingWindows: held.filter((w) => w.repository !== null) }, false);
  if (without.kind !== base.kind) return true;
  // R88: two LINKS to the same activity are the same answer. Lost evidence alone can hold such a verdict back (the latest ready instant,
  // after every restart, which is when an unknown window exists), and it is counted as lost evidence, never as this kind as well.
  if (base.kind === 'linked' && without.kind === 'linked') return base.activityId !== without.activityId;
  return !('reason' in without) || !('reason' in base) || without.reason !== base.reason;
}

/**
 * 2c (R84): did LOST evidence hold back a link? True when the verdict is `unmeasured('evidence-horizon')` and the same input, without its
 * lost windows (a shed listing, an unmeasured hour) and without X1's lost-creator arm, is a LINK. So it counts the links lost evidence
 * cost, for the lane's hourly warn line, apart from every mark kind and from the I-1 `window` kind. A verdict that two causes hold (a lost
 * window and a mark, say) is counted by neither, as with the marks: the count is a floor on what lost evidence cost, never more.
 */
export function delegationLostEvidenceForced(input: DelegationCorrelationInput, verdict: DelegationCorrelationVerdict): boolean {
  if (verdict.kind !== 'unmeasured' || verdict.reason !== 'evidence-horizon') return false;
  return correlate({ ...input, listingWindows: input.listingWindows.filter((w) => w.lost !== true) }, false).kind === 'linked';
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Unlinked {
  kind: 'unresolved' | 'conflicting' | 'unmeasured';
  reason: DelegationCorrelationReason;
  evidenceJournalIds: readonly string[];
  /** X1 (R84): rung 4's lost-creator answer, which only ever stops a link beside it (`combine`); it never leaves this module. */
  lostCreator?: true;
}
type Answer = DelegationLinkedVerdict | Unlinked;

/** Evidence lists are de-duplicated and in code-unit order, so a verdict does not depend on the order evidence was handed over. */
const ids = (list: readonly string[]): string[] => [...new Set(list)].sort();
const unresolved = (reason: DelegationCorrelationReason, evidence: readonly string[] = []): Unlinked => ({ kind: 'unresolved', reason, evidenceJournalIds: ids(evidence) });
const conflicting = (reason: DelegationCorrelationReason, evidence: readonly string[] = []): Unlinked => ({ kind: 'conflicting', reason, evidenceJournalIds: ids(evidence) });
const unmeasured = (reason: DelegationCorrelationReason, evidence: readonly string[] = []): Unlinked => ({ kind: 'unmeasured', reason, evidenceJournalIds: ids(evidence) });
const linked = (activityId: string, rung: 2 | 3 | 4, evidence: readonly string[]): DelegationLinkedVerdict => ({ kind: 'linked', activityId, rung, evidenceJournalIds: ids(evidence) });

/** A parent is (ccd id, registry incarnation): the same ccd id under another incarnation is another parent. */
const parentKey = (parentId: string, parentIncarnation: string): string => JSON.stringify([parentId, parentIncarnation]);

const AGENT_PREFIX = 'agent-';
const WORKFLOW_PREFIX = 'wf_';

/** A non-empty string is the only kind of ID or path there is; anything else names nothing. */
const text = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** Does this event CLAIM the agent: a SubagentStart naming it, or an Agent/Task launch response that launched it. A SubagentStop
 *  alone and a bare tool event do not (an unpaired stop is routine, and a bare `agent_id` is not placement). */
function claimsAgent(event: DelegationEventEnvelopeV1, agentId: string): boolean {
  if (event.eventKind === 'SubagentStart') return event.agentId === agentId;
  if (event.eventKind === 'PostToolUse' && (event.toolName === 'Agent' || event.toolName === 'Task')) {
    const launch = event.launch;
    return typeof launch === 'object' && launch !== null && launch.agentId === agentId;
  }
  return false;
}

interface Claims {
  /** The distinct parents that hold this upstream ID in any of their durable evidence. */
  parents: Map<string, { parentId: string; parentIncarnation: string }>;
  /** The journal records that show those claims. */
  journalIds: string[];
}

/** Every parent that claims the upstream ID: through an open activity, a point meta, or (for an agent) a claiming event. */
function claimsOf(input: DelegationCorrelationInput, sourceKind: 'agent' | 'workflow', upstreamId: string): Claims {
  const claims: Claims = { parents: new Map(), journalIds: [] };
  const claim = (parentId: string, parentIncarnation: string, journalId: string): void => {
    claims.parents.set(parentKey(parentId, parentIncarnation), { parentId, parentIncarnation });
    claims.journalIds.push(journalId);
  };
  for (const a of input.activities) if (a.sourceKind === sourceKind && a.upstreamId === upstreamId) claim(a.parentId, a.parentIncarnation, a.identityJournalId);
  for (const m of input.pointMetas) if (m.sourceKind === sourceKind && m.upstreamId === upstreamId) claim(m.parentId, m.parentIncarnation, m.evidenceJournalId);
  if (sourceKind === 'agent') {
    for (const { journalId, event } of input.acceptedEvidence) if (claimsAgent(event, upstreamId)) claim(event.sessionId, event.parentIncarnation, journalId);
  }
  return claims;
}

// ── The evidence horizon (R57, D-4653) ───────────────────────────────────────────────────────────────────────────────

/**
 * How long after the horizon a listing window must have begun for rung 4 to trust that no evicted window overlaps it: twenty minutes.
 * A window is a Bash call. Claude Code's Bash tool ends a call at its timeout, ten minutes at the longest by default, and a call that
 * never reported its end is an OPEN-ENDED window, which the rule below already refuses. A call that began at or before the horizon was
 * therefore over by the horizon plus the tool's longest call, so a candidate that began MORE than that after the horizon cannot overlap
 * an evicted window; one that began sooner, or exactly then (the test is closed, like the overlap test), might.
 *
 * THIS ASSUMES BASH CALLS STAY WITHIN CLAUDE CODE'S MAXIMUM BASH TIMEOUT, WHICH `BASH_MAX_TIMEOUT_MS` CAN RAISE. A fleet that raises it
 * past this margin breaks the premise silently: a sibling call longer than the margin, whose start was evicted, no longer vetoes, rung 4
 * links, and `createLease` journals a permanent, immutable lease for possibly the wrong parent. A too-small margin re-opens exactly
 * that wrong lease. A too-large one costs little: more rung-4 trees answer `unmeasured` while the slice spans less than the margin plus
 * the birth wait. Twenty minutes is twice the default ceiling; raise it with the ceiling.
 *
 * BACKGROUND TOOLS (coordinator 5443, measured from the hook and the corpus). The ceiling binds FOREGROUND Bash only; a
 * `run_in_background` Bash call and Monitor have none. Neither can break THIS margin: a window is the hook's own PreToolUse listing
 * and PostToolUse listing of one Bash call, and a background call's PostToolUse fires as the call returns, at once, so its window is
 * short whatever the background process then does; Monitor is not Bash, so it makes no window at all (the hook takes a listing only
 * for a Bash command that names `worktree`). What they CAN do is a different hazard, stated plainly for wave 4: a `git worktree add`
 * run by a background job happens AFTER its own window closed, so it lies inside no window of its creator. Rung 4 then cannot tie the
 * tree to its creator (no link: safe), but if ANOTHER session's worktree-naming Bash window happens to be open at that moment and adds
 * nothing else, that window's delta shows exactly the new record and rung 4 links the tree to the wrong session, with no overlapping
 * window to veto it. It needs that coincidence; the captured corpus holds no background worktree creation. Wave 4 owns it (for
 * example: refuse a rung-4 link while a session of the repository has a background Bash task outstanding).
 */
export const DELEGATION_EVIDENCE_MARGIN_MS = 20 * 60 * 1000;

/** The horizon as epoch milliseconds, or `null` when the caller evicted nothing. A horizon that is not a canonical instant fails SAFE:
 *  `NaN` is read by rung 4 as "reaches the horizon": it refuses the link. */
function horizonMsOf(input: DelegationCorrelationInput): number | null {
  if (input.evidenceHorizon === null) return null;
  try { return parseDelegationInstant(input.evidenceHorizon); } catch (err) { if (err instanceof DelegationModelError) return Number.NaN; throw err; }
}

// ── Queries over the dropped-evidence index (R65) ───────────────────────────────────────────────────────────────────────

/** The index once it is known to be measured. Each rung checks `measured` itself, once: an index that was lost is not an empty one. */
type MeasuredDropped = Extract<DelegationDroppedEvidence, { measured: true }>;

/** (a) Did a dropped event name one of these ids from a parent other than `parent`? Reads only the index, so it is false for an
 *  index that dropped nothing and for a dropped event of the activity's own parent. */
function droppedRival(d: MeasuredDropped, ids: readonly string[], parent: string): boolean {
  for (const id of ids) {
    const parents = d.named.get(id);
    if (parents === undefined) continue;
    for (const p of parents) if (p !== parent) return true;
  }
  return false;
}

/** (b) Did a dropped event report this path as a working directory in a way that vetoes a rung-3 link of agent `agentId` of `parent`:
 *  the parent's own (no agent id), or another agent's that is not the host's own SubagentStart/SubagentStop about it? */
function droppedPathVeto(d: MeasuredDropped, canonical: string, parent: string, agentId: string): boolean {
  for (const e of d.atPath.get(canonical) ?? []) {
    if (e.agentId === null ? e.parent === parent : e.agentId !== agentId && !e.startStop) return true;
  }
  return false;
}

/** (R73) Does one of the caller's lossy marks stand for a key that could have vetoed a link of this tree, for an activity named by one of
 *  these ids? The marks are coarse on purpose: any of them makes the link `unmeasured('evidence-horizon')`. */
function droppedMarked(d: MeasuredDropped, record: DelegationCensusRecord, canonical: string, ids: readonly string[]): boolean {
  const m = d.marks;
  return m.lossy || m.projects.has(record.project) || prefixCovered(m, canonical) || pathMarked(m, canonical) || ids.some((id) => delegationHashSetHas(m.ids, id));
}

/** The ids a rung-2 claim on `upstreamId` can have been made under: the id itself and, for a workflow worker `wf_<run>-<n>`, the run's. */
function claimIdsOf(sourceKind: 'agent' | 'workflow', upstreamId: string): readonly string[] {
  if (sourceKind === 'agent') return [upstreamId];
  const m = /^(wf_.+)-(\d+)$/.exec(upstreamId);
  return m === null ? [upstreamId] : [upstreamId, m[1]!];
}

// ── Rung 2: exact upstream identity ──────────────────────────────────────────────────────────────────────────────────

/**
 * Decides a tree named `agent-<id>` (sourceKind `agent`, upstream ID `<id>`) or `wf_<run>-<n>` (sourceKind `workflow`, the whole name).
 * It ALWAYS answers: with no rung-2 evidence the answer is `unmeasured`, because the name only routes. The proof is the parent's own
 * evidence (an agent needs a SubagentStart or SubagentStop for the ID from the same parent; a workflow worker needs only its meta),
 * a point meta whose `worktreePath` EQUALS the canonical path, string for string, and the activity a qualifying join has durably opened.
 */
function rung2(input: DelegationCorrelationInput, sourceKind: 'agent' | 'workflow', upstreamId: string, canonical: string): Answer {
  const claims = claimsOf(input, sourceKind, upstreamId);
  if (claims.parents.size === 0) return unmeasured('rung-2-evidence-absent');
  if (claims.parents.size > 1) return conflicting('same-upstream-id-in-multiple-sessions', claims.journalIds);
  const [parent] = [...claims.parents.values()];
  if (parent === undefined) return unmeasured('rung-2-evidence-absent');
  const same = (parentId: string, parentIncarnation: string): boolean => parentId === parent.parentId && parentIncarnation === parent.parentIncarnation;

  const activities = input.activities.filter((a) => a.sourceKind === sourceKind && a.upstreamId === upstreamId && same(a.parentId, a.parentIncarnation));
  if (new Set(activities.map((a) => a.activityId)).size > 1) return conflicting('duplicate-activity-rows', activities.map((a) => a.identityJournalId));
  const metas = input.pointMetas.filter((m) => m.sourceKind === sourceKind && m.upstreamId === upstreamId && same(m.parentId, m.parentIncarnation));
  if (metas.length === 0) return unmeasured('rung-2-meta-absent', claims.journalIds);
  const metaIds = metas.map((m) => m.evidenceJournalId);
  if (new Set(metas.map((m) => m.worktreePath)).size > 1) return conflicting('meta-paths-disagree', [...metaIds, ...activities.map((a) => a.identityJournalId)]);
  if (metas[0]?.worktreePath !== canonical) return unmeasured('rung-2-path-mismatch', metaIds);

  const spool: string[] = [];
  if (sourceKind === 'agent') {
    for (const { journalId, event } of input.acceptedEvidence) {
      if ((event.eventKind === 'SubagentStart' || event.eventKind === 'SubagentStop') && event.agentId === upstreamId && same(event.sessionId, event.parentIncarnation)) spool.push(journalId);
    }
    if (spool.length === 0) return unmeasured('rung-2-subagent-event-absent', metaIds);
  }
  const activity = activities[0];
  if (activity === undefined) return unmeasured('activity-not-durably-open', [...metaIds, ...spool]);
  // R65: the "one parent" check above is negative evidence an eviction could have emptied. A rival with an activity row is seen through
  // the checkpoint; one that only ever sent a bare event, whose meta was never read, is seen only here.
  // R73: a key the caller forgot without proof that its tree was gone is a mark, and a mark is asked like the key it stands for.
  const dropped = input.droppedEvidence;
  if (!dropped.measured || droppedRival(dropped, claimIdsOf(sourceKind, upstreamId), parentKey(activity.parentId, activity.parentIncarnation))
    || droppedMarked(dropped, input.record, canonical, claimIdsOf(sourceKind, upstreamId))) {
    return unmeasured('evidence-horizon', [...spool, ...metaIds, activity.identityJournalId]);
  }
  return linked(activity.activityId, 2, [...spool, ...metaIds, activity.identityJournalId]);
}

// ── Rung 3: the subagent's own path ──────────────────────────────────────────────────────────────────────────────────

function rung3(input: DelegationCorrelationInput, canonical: string): Answer | null {
  const hits = new Map<string, { activity: DelegationActivityRow; journalIds: string[] }>();
  // Parents that THEMSELVES reported the path as a working directory (an event with no `agentId`). A non-isolated subagent inherits its
  // parent's cwd on every event it emits, so a cwd the parent reported can never place a subagent (ruling R42).
  const parentReported = new Map<string, string[]>();
  for (const { journalId, event } of input.acceptedEvidence) {
    if (!text(event.cwd) || event.cwd !== canonical) continue;
    const agentId = event.agentId;
    if (!text(agentId)) {
      const key = parentKey(event.sessionId, event.parentIncarnation);
      parentReported.set(key, [...(parentReported.get(key) ?? []), journalId]);
      continue;
    }
    // SubagentStart and SubagentStop are the host's own events about the agent and carry the parent's context on a non-isolated one:
    // they are not "emitted from inside" it.
    if (event.eventKind === 'SubagentStart' || event.eventKind === 'SubagentStop') continue;
    const activity = input.activities.find((a) => a.sourceKind === 'agent' && a.upstreamId === agentId && a.parentId === event.sessionId && a.parentIncarnation === event.parentIncarnation);
    if (activity === undefined) continue;                                        // an agent no qualifying join opened: evidence, not placement
    const hit = hits.get(activity.activityId) ?? { activity, journalIds: [activity.identityJournalId] };
    hit.journalIds.push(journalId);
    hits.set(activity.activityId, hit);
  }
  if (hits.size === 0) return null;
  const all = [...hits.values()].flatMap((h) => h.journalIds);
  // The conflict checks run FIRST (Task 11 N1): a conflict is final, and a parent-cwd veto of one parent's hit must not turn another
  // parent's claim on the same path into a retried `unresolved`. That only ever moves an answer toward the final, safe side.
  for (const { activity } of hits.values()) {
    if (claimsOf(input, 'agent', activity.upstreamId).parents.size > 1) return conflicting('agent-id-claimed-by-multiple-sessions', all);
  }
  const parents = new Set([...hits.values()].map((h) => parentKey(h.activity.parentId, h.activity.parentIncarnation)));
  if (parents.size > 1) return conflicting('path-claimed-by-multiple-parents', all);
  // One parent from here: its own cwd at the path vetoes every hit (R42), and two of its subagents on the path are ambiguous.
  for (const { activity } of hits.values()) {
    const reported = parentReported.get(parentKey(activity.parentId, activity.parentIncarnation));
    if (reported !== undefined) return unresolved('parent-cwd', [...all, ...reported]);
  }
  if (hits.size > 1) return unresolved('ambiguous-subagent-path', all);
  const [only] = [...hits.values()];
  if (only === undefined) return null;
  // R65: the vetoes above (`parent-cwd`, a second claimant, a second subagent on the path) are negative evidence an eviction could have
  // emptied, and an instant cannot see what is gone: the dropped-evidence index is asked instead (clauses (a) and (b)).
  const parent = parentKey(only.activity.parentId, only.activity.parentIncarnation);
  const dropped = input.droppedEvidence;
  if (!dropped.measured || droppedRival(dropped, [only.activity.upstreamId], parent) || droppedPathVeto(dropped, canonical, parent, only.activity.upstreamId)
    || droppedMarked(dropped, input.record, canonical, [only.activity.upstreamId])) {
    return unmeasured('evidence-horizon', only.journalIds);
  }
  return linked(only.activity.activityId, 3, only.journalIds);
}

// ── Rung 4: the session's own creation delta ─────────────────────────────────────────────────────────────────────────

/**
 * D-5604: what one window's listings say, computed ONCE per window object. The reconcile lane hands every census tree, and every ladder
 * rerun (`delegationMarkForced`, `delegationUnknownWindowForced`, `delegationLostEvidenceForced`), the SAME window objects, built afresh each
 * pass (`delegationListingWindowsOf`), so rebuilding two Sets per window per tree cost seconds a pass on a busy repository. `added` is the
 * distinct names the after-listing adds to the before-listing (compared as sets, as `new Set` does), `removes` whether it drops any. A window
 * with no after-listing measured no delta: null. Keyed weakly by the window, so nothing outlives the windows it describes (the L1 header holds:
 * no state that outlives its inputs). It relies on a window never being mutated after it is built, which no caller does.
 */
interface ListingDelta { readonly added: ReadonlySet<string>; readonly removes: boolean }
const listingDeltas = new WeakMap<DelegationListingWindow, ListingDelta | null>();
function listingDeltaOf(window: DelegationListingWindow): ListingDelta | null {
  const known = listingDeltas.get(window);
  if (known !== undefined) return known;
  let delta: ListingDelta | null = null;
  if (window.after !== null) {
    const before = new Set(window.before);
    const after = new Set(window.after);
    const added = new Set<string>();
    for (const name of after) if (!before.has(name)) added.add(name);
    let removes = false;
    for (const name of before) if (!after.has(name)) { removes = true; break; }
    delta = { added, removes };
  }
  listingDeltas.set(window, delta);
  return delta;
}

/** Did this window add exactly the one record, and remove none? A window with no after-listing measured no delta at all. */
function addedExactly(window: DelegationListingWindow, adminRecord: string): boolean {
  const delta = listingDeltaOf(window);
  return delta !== null && delta.added.size === 1 && delta.added.has(adminRecord) && !delta.removes;
}

/** Did this window's listings add the record (among others, or alone)? A window with no after-listing measured no delta. */
function addedIncludes(window: DelegationListingWindow, adminRecord: string): boolean {
  return listingDeltaOf(window)?.added.has(adminRecord) === true;
}

/** I-1 and 2c d: may this window be on `repository`? Its session's own repository, the repository its listing is attributed to, or
 *  either one the caller cannot name (null: UNKNOWN, so possibly this one). An absent `listedRepository` is not read. */
const mayBeOn = (w: DelegationListingWindow, repository: string): boolean =>
  w.repository === null || w.repository === repository
  || (w.listedRepository !== undefined && (w.listedRepository === null || w.listedRepository === repository));

/** A window as epoch milliseconds; an open-ended one runs for ever. Throws the model's error for an instant that is not canonical. */
const spanOf = (w: DelegationListingWindow): [number, number] =>
  [parseDelegationInstant(w.startedAt), w.endedAt === null ? Number.POSITIVE_INFINITY : parseDelegationInstant(w.endedAt)];

/**
 * X1 (R84; coordinator 5477, 5484): could evidence the caller LOST have held the Bash call that created this tree? Rung 4 found no
 * candidate, and rung 3 may be about to link; with the creator's window held, the two might have disagreed (a final conflict), so a link
 * that rests on its absence rests on lost evidence (spec §5.3). The creator's call began in the bracket [after - margin, at] (the tree
 * was born between a census that did not list it and the first that did; a call lasts at most the margin), or anywhere up to `at` when
 * `after` is unknown. The census instants are the server's clock and the windows the fleet's, so both ends widen by the clock skew
 * allowance (`DELEGATION_CLOCK_SKEW_MS`). True when:
 *   - the evidence horizon reaches the bracket (an evicted window may have begun inside it); or
 *   - a lost window that may be on the tree's repository (a shed listing, an unmeasured hour, the retention floor) overlaps the bracket; or
 *   - a HELD window that may have been the creator but cannot be a candidate because part of its evidence is missing (`heldCreators`,
 *     R85) BEGAN inside the bracket: a creator's call began there, and a call lasts at most the margin, so one begun before it cannot be
 *     the creator.
 * An instant that is not canonical fails SAFE: the bracket is then all of time. The census bracket only ever VETOES: it never links.
 */
function creatorMayBeLost(input: DelegationCorrelationInput, lostWindows: readonly DelegationListingWindow[], heldCreators: readonly DelegationListingWindow[]): boolean {
  const horizon = horizonMsOf(input);
  if (horizon === null && lostWindows.length === 0 && heldCreators.length === 0) return false;
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  try {
    hi = parseDelegationInstant(input.firstSighting.at) + DELEGATION_CLOCK_SKEW_MS;
    if (input.firstSighting.after !== null) lo = parseDelegationInstant(input.firstSighting.after) - DELEGATION_EVIDENCE_MARGIN_MS - DELEGATION_CLOCK_SKEW_MS;
  } catch (err) {
    if (!(err instanceof DelegationModelError)) throw err;
    lo = Number.NEGATIVE_INFINITY;
    hi = Number.POSITIVE_INFINITY;
  }
  if (horizon !== null && (Number.isNaN(horizon) || lo <= horizon)) return true;
  for (const w of lostWindows) {
    let span: [number, number];
    try { span = spanOf(w); } catch (err) { if (err instanceof DelegationModelError) return true; throw err; }
    if (span[0] <= hi && lo <= span[1]) return true;
  }
  for (const w of heldCreators) {
    let start: number;
    try { start = parseDelegationInstant(w.startedAt); } catch (err) { if (err instanceof DelegationModelError) return true; throw err; }
    if (lo <= start && start <= hi) return true;
  }
  return false;
}

/**
 * Rung 4. A window whose repository the caller cannot name (null; I-1: a session whose registry row is gone, after a restart) is never
 * a candidate, and it counts as a window ON EVERY repository for the overlap and the horizon tests: overlapping a candidate in time makes
 * the tree `unresolved`, and an open-ended or early one makes it `unmeasured('evidence-horizon')`. An unknown repository therefore moves
 * a verdict toward unresolved or unmeasured, never toward a link. A window whose LISTING the caller attributes to another repository, or
 * cannot attribute (2c d, `listedRepository`), counts the same way for the tests that veto, and never makes a candidate.
 *
 * LOST WINDOWS (2c, R84). A window whose listings were lost (a shed listing, an unmeasured hour) is never a candidate and never a held
 * window to the horizon test. A candidate it may overlap, on the candidate's repository, is `unmeasured('evidence-horizon')`, whichever
 * session it belongs to (the candidate's own session included: it may have been a second call that added the record), except the
 * candidate's own call. And with NO candidate, a lost window or an eviction that may have held the creator answers
 * `unmeasured('evidence-horizon')` too (X1, `creatorMayBeLost`), which only ever stops a link beside it (`combine`). Each of these only
 * ever turns a would-be LINK into a non-answer: a verdict that was not a link is never touched.
 */
function rung4(input: DelegationCorrelationInput, x1: boolean): Answer | null {
  const { record } = input;
  const held = input.listingWindows.filter((w) => w.lost !== true);
  const lostWindows = input.listingWindows.filter((w) => w.lost === true && mayBeOn(w, record.project));
  const candidates = held.filter((w) => w.repository !== null && w.repository === record.project && addedExactly(w, record.adminRecord));
  if (candidates.length === 0) {
    // R85 (B-F1; spec §5.3: "a held Pre with no Post is a lost Post"): a HELD window that may be on this repository and may have been the
    // creator, but cannot be a candidate because part of its evidence is missing, is lost evidence for X1 too: one that is OPEN-ENDED (its
    // PostToolUse never came), or one whose session's project was lost at a restart (a null repository) that ADDS the record. Exactly
    // that narrow (it is liveness): a closed window that does not add the record is evidence of nothing here, and vetoes nothing.
    const heldCreators = held.filter((w) => mayBeOn(w, record.project) && (w.endedAt === null || (w.repository === null && addedIncludes(w, record.adminRecord))));
    return x1 && creatorMayBeLost(input, lostWindows, heldCreators) ? { ...unmeasured('evidence-horizon'), lostCreator: true } : null;
  }
  let ambiguous = false;
  try {
    // Overlap first: a delta that another session's window overlaps is `unresolved` however many windows also show the record.
    for (const mine of candidates) {
      const [start, end] = spanOf(mine);
      const mineKey = parentKey(mine.sessionId, mine.parentIncarnation);
      for (const other of held) {
        if (other === mine || !mayBeOn(other, record.project)) continue;
        const [otherStart, otherEnd] = spanOf(other);
        if (!(start <= otherEnd && otherStart <= end)) continue;
        if (parentKey(other.sessionId, other.parentIncarnation) !== mineKey) return unresolved('overlapping-listing-window');
        // E2 (R84): "one Bash tool call of S". A window of the SAME session that overlaps the candidate and also added the record (with
        // others or alone) may be the call that made it: ambiguous, never a link to the first toolUseId. So may an OPEN-ENDED one (R85,
        // B-F2), whose after-listing is unknown: a lease must name the call that made the tree (5480).
        if (addedIncludes(other, record.adminRecord) || other.endedAt === null) ambiguous = true;
      }
    }
  } catch (err) {
    if (err instanceof DelegationModelError) return unmeasured('listing-window-instant-unreadable');
    throw err;
  }
  if (ambiguous || candidates.length > 1) return unresolved('ambiguous-listing-windows');
  const [mine] = candidates;
  if (mine === undefined) return null;
  // 2c step 1: a lost window over the candidate may have been another session's call (an overlap) or a second call that added the record.
  try {
    const [start, end] = spanOf(mine);
    for (const w of lostWindows) {
      if (w.sessionId === mine.sessionId && w.parentIncarnation === mine.parentIncarnation && w.toolUseId === mine.toolUseId) continue;
      const [lostStart, lostEnd] = spanOf(w);
      if (start <= lostEnd && lostStart <= end) return unmeasured('evidence-horizon');
    }
  } catch (err) {
    if (err instanceof DelegationModelError) return unmeasured('listing-window-instant-unreadable');
    throw err;
  }
  const activity = input.activities.find((a) => a.sourceKind === 'bash-worktree' && a.upstreamId === mine.toolUseId && a.parentId === mine.sessionId && a.parentIncarnation === mine.parentIncarnation);
  if (activity === undefined) return unmeasured('activity-not-durably-open');
  const call = input.acceptedEvidence
    .filter(({ event }) => event.sessionId === mine.sessionId && event.parentIncarnation === mine.parentIncarnation
      && (event.eventKind === 'PreToolUse' || event.eventKind === 'PostToolUse') && event.toolName === 'Bash' && event.toolUseId === mine.toolUseId)
    .map(({ journalId }) => journalId);
  // R57: the overlap rule above is negative evidence. A window whose pre-listing was evicted is a window that is not there to overlap.
  // The link stands only if every window the caller HOLDS (a lost window is not held: 2c) on this repository is closed and began after
  // the horizon, and the candidate
  // began MORE than a full margin after it (`DELEGATION_EVIDENCE_MARGIN_MS`; the boundary is closed, like the overlap test). An index
  // the caller has not measured says nothing about what it dropped: no link.
  const horizon = horizonMsOf(input);
  if (horizon !== null || !input.droppedEvidence.measured) {
    let reaches: boolean;
    try {
      reaches = horizon === null || Number.isNaN(horizon)
        || held.some((w) => mayBeOn(w, record.project) && (w.endedAt === null || parseDelegationInstant(w.startedAt) <= horizon))
        || parseDelegationInstant(mine.startedAt) <= horizon + DELEGATION_EVIDENCE_MARGIN_MS;
    } catch (err) {
      if (!(err instanceof DelegationModelError)) throw err;
      reaches = true;
    }
    if (reaches) return unmeasured('evidence-horizon', [...call, activity.identityJournalId]);
  }
  return linked(activity.activityId, 4, [...call, activity.identityJournalId]);
}

/**
 * Rungs 3 and 4 are both tried, and a conflict at either is final. Two linked answers that name different PARENTS conflict; two that
 * name the same parent agree, and the lowest rung's activity is the answer. A link beside a merely unresolved or unmeasured answer is
 * the link (a linked answer decides) EXCEPT beside an `evidence-horizon` answer (R65, N1): a rung that answered that had found an
 * activity and was about to link, so the full evidence may have made it a link to ANOTHER parent, which is a conflict and a final
 * state. A link never beats a horizon; the pair is itself `unmeasured('evidence-horizon')`, and is retried.
 */
function combine(input: DelegationCorrelationInput, answers: readonly (Answer | null)[]): Answer {
  const present = answers.filter((a): a is Answer => a !== null);
  const everything = present.flatMap((a) => a.evidenceJournalIds);       // for a disagreement: every witness
  const conflict = present.find((a): a is Unlinked => a.kind === 'conflicting');
  if (conflict !== undefined) return conflicting(conflict.reason, [...conflict.evidenceJournalIds, ...present.filter((a) => a.kind === 'linked').flatMap((a) => a.evidenceJournalIds)]);
  const links = present.filter((a): a is DelegationLinkedVerdict => a.kind === 'linked');
  const [lowest] = links;
  if (lowest !== undefined && present.some((a) => a.kind === 'unmeasured' && a.reason === 'evidence-horizon')) return unmeasured('evidence-horizon', everything);
  if (lowest !== undefined) {
    const parentOf = (v: DelegationLinkedVerdict): string => {
      const a = input.activities.find((row) => row.activityId === v.activityId);
      return a === undefined ? JSON.stringify(['missing', v.activityId]) : parentKey(a.parentId, a.parentIncarnation);
    };
    if (new Set(links.map(parentOf)).size > 1) return conflicting('rungs-disagree', everything);
    // The proof of a link is the links' own evidence: a non-answer beside it (a refused parent-cwd, an overlap) proves nothing.
    return linked(lowest.activityId, lowest.rung, links.flatMap((l) => l.evidenceJournalIds));
  }
  // X1: a lost creator stops a link (above) and decides nothing by itself, so a tree with no link keeps the answer it had.
  return present.find((a) => !('lostCreator' in a)) ?? unresolved('no-correlating-evidence');
}

// ── The ladder ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function correlateDelegation(input: DelegationCorrelationInput): DelegationCorrelationVerdict {
  return correlate(input, true);
}

/** The ladder; `x1: false` leaves out rung 4's lost-creator arm, for `delegationLostEvidenceForced` alone. */
function correlate(input: DelegationCorrelationInput, x1: boolean): DelegationCorrelationVerdict {
  const { record } = input;
  // Rung 1: the existing model owns the workspace. Terminal, and never a lease.
  if (input.runChildAgreement !== null) {
    return { kind: 'run-child-owned', activityId: input.runChildAgreement.activityId, evidenceJournalIds: [...input.runChildAgreement.evidenceJournalIds] };
  }
  if (record.state === 'unreadable') return unmeasured('record-unreadable');
  if (record.state === 'absent') return unresolved('record-absent');
  // A tree that has gained a registry row or a `.child` is a ccd workspace (born or not), never a lease.
  if (input.hasRegistryRow || input.hasChildMarker) return unresolved('ccd-workspace-not-a-lease');
  // A tree seen for the first time is inside the two-pass wait: it may yet be a ccd workspace being born.
  if (input.birthPassesRemaining > 0) return unresolved('ccrc-birth-wait');
  const canonical = record.canonicalPath;
  if (canonical === null) return unmeasured('canonical-path-unmeasured');

  // Rung 2 is the END of the road for a tree whose NAME routes it there: the name never links, and it never reaches rungs 3 and 4.
  if (record.adminRecord.startsWith(AGENT_PREFIX)) return rung2(input, 'agent', record.adminRecord.slice(AGENT_PREFIX.length), canonical);
  if (record.adminRecord.startsWith(WORKFLOW_PREFIX)) return rung2(input, 'workflow', record.adminRecord, canonical);
  return combine(input, [rung3(input, canonical), rung4(input, x1)]);
}

/**
 * The lease provenance of a linked verdict's activity: `agent` and `workflow` for themselves, `raw` for a `bash-worktree` activity.
 * Wave 3 has no writer of `attached`, and none of the three can produce it. The activity must be one the caller has: there is no
 * default for a missing one.
 */
export function delegationLeaseSourceOfLinked(verdict: DelegationLinkedVerdict, activities: readonly DelegationActivityRow[]): DelegationLeaseSourceKind {
  const activity = activities.find((a) => a.activityId === verdict.activityId);
  if (activity === undefined) throw new DelegationModelError('bad-row', `the linked activity ${verdict.activityId} is not among the activities handed over`);
  return leaseSourceKindOfActivity(activity.sourceKind);
}

// ── The words this file spells, for the coordination scanner ─────────────────────────────────────────────────────────

/** The verdict kinds, as a TOTAL table over `DelegationCorrelationVerdict['kind']`. */
const DELEGATION_CORRELATION_VERDICT_KINDS: Readonly<Record<DelegationCorrelationVerdict['kind'], true>> = {
  'run-child-owned': true, linked: true, unresolved: true, conflicting: true, unmeasured: true,
};

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: the verdict kinds, every reason a
 *  non-answer carries (`DELEGATION_CORRELATION_REASONS`, declared once above), `bash-worktree` from `shared/api.ts`'s activity
 *  source kinds and the model refusal it throws (`bad-row`), read from the model's table, never re-spelled. Derived from tables,
 *  so a word added to a union is admitted and a typo is not. None is a mail rejection or a run refusal: a verdict rides the
 *  projection and the lease request, and no route answers with one. */
export function isDelegationCorrelationKebab(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(DELEGATION_CORRELATION_VERDICT_KINDS, v)
    || (DELEGATION_CORRELATION_REASONS as readonly string[]).includes(v)
    || (DELEGATION_ACTIVITY_SOURCE_KINDS as readonly string[]).includes(v)
    || Object.prototype.hasOwnProperty.call(DELEGATION_MODEL_REFUSALS, v);
}
