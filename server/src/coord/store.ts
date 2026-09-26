import type { DatabaseSync } from 'node:sqlite';
import { tx } from './db.js';
import { renderEnvelope } from './envelope.js';
import { decideClaim, type ClaimRow } from './claims.js';
import { decideAllocation } from './ledger.js';
// D-2921: `CoordPlacementStamp` is declared by its CONSUMER, the L1 placement
// policy — the house port pattern. This read exists to feed that policy and
// nothing else, so the shape it returns is the policy's to define.
import type { CoordPlacementStamp } from './placement.js';
import type { LedgerLog } from './ledgerlog.js';
import type { PoolEdgeLog } from './pooledgelog.js';
import type { UpdateIntentLog } from './updateintentlog.js';
// `bodyDigest` comes from `shared/mark.mjs` — `server.ts:30` imports it as
// `'../../shared/mark.mjs'`; from `server/src/coord/` the path is one level
// deeper.
import { bodyDigest } from '../../../shared/mark.mjs';
// Fix round 1, item 5 (ruling A): the same tag comparator every other
// ordering in this design uses — never `publishedAt` — for `newestUnyankedStable`.
import { newestTag } from '../../../shared/semver.js';
import {
  CLEAR_REFUSED_STRANDS_TEXT,
  holdReasonVerdict,
  type HoldReasonVerdict,
} from './rundefs.js';
import { reviveDec, reviveMeas, reviveObs, type JournalRow } from './journalparse.js';
import {
  CLAIM_HARD_CAP_MS, CLAIM_LEASE_MS, DONE_AUTHORITY_CODES,
  isAskState, isClaimState, isDeviationAllocState, isLifecycleAct, isLifecycleGapReason,
  isLifecycleOutcome,
  isMailDeliveryState, isMailGate, isMailKind, isNotifyKind, isProgramState, isRunKind, isRunState,
  isWorkItemState,
  // design 2026-09-20 §6/§7 (W2): the release catalogue's tag guard and channel vocabulary.
  isReleaseTag, isUpdateChannel,
  // design 2026-09-20 §6/§8/§10 (W2): the node inventory's vocabularies and the lease's two lists.
  BUSY_UPDATE_STATES, isInstallState, isNodeOs, isNodeRole, isProvenanceState, isRequestKind, isStampRead,
  isUpdatePhase, isUpdateState, SETTLED_UPDATE_STATES, validCapWords,
  // fix round 1, D-3213: the floor/previous read-state vocabulary beside `highestVersion`/`previousVersion`.
  isTagFileRead,
  // design 2026-09-20 §6/§9 (W2): the intent row's vocabularies, and the fleet-default scope — declared ONCE in
  // shared/api.ts (ruling R4), imported here and never spelled.
  FLEET_SCOPE, isAutoMode, isNotifyMode,
  LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,
  // D-1143: the kickoff cancellation keys on the SUBJECT, and the subject has
  // exactly one home — `shared/api.ts`, beside the body it labels. Its own
  // docstring gives the second reason it lives there rather than in
  // `coord/kickoff.ts`: "no hyphenated literal under `server/src/coord` for
  // `mail-routes.test.ts`'s scanner to arbitrate". Imported, never retyped.
  isPositiveDecimalSafeInteger,
  parseArmEventDetail,
  parseRouteEventDetail,
  parseWaveDoneSignals,
  PROGRAM_KICKOFF_SUBJECT,
  RUN_HOLD_NUMBER_MAX,
  IDLE_RUN_STATES, transitionsFor, TERMINAL_DELIVERY_STATES, TERMINAL_RUN_STATES,
  WAVE_DONE_SUBJECT,
  type AskState,
  type ClaimConflict, type ClaimState, type ClaimSummary,
  type CoordCaps, type DeviationAllocation, type DeviationAllocState,
  type LifecycleGap, type LifecycleGapReason,
  type MailDeliveryState, type MailGate,
  type MailKind, type MailRejectCode, type MailSummary, type MirroredLifecycleEvent,
  type NotifyEvent, type PeerDeliverable, type ProgramState,
  type RouteFields, type RoutingEvent,
  type RunHealth, type RunItemTally, type RunKind, type RunSignals, type RunState,
  type RunSummary,
  type SetAccountPoolsRefuseCode,
  type UpdateChannel,
  type BusyUpdateState, type InstallState, type NodeOs, type NodeRole, type ProvenanceState, type RequestKind,
  type SettledUpdateState, type StampRead, type TagFileRead, type UpdatePhase, type UpdateState,
  type AutoMode, type NotifyMode,
  type WorkItemState,
} from '../../../shared/api.js';

/** One entry in `$REG/<id>.prhistory` (ccd/ccd:2252-2253). Re-declared as a TYPE
 *  here rather than parsed twice: `coord/prhistory.ts` owns the reader. */
export interface PrLineageEntry { pr: number; branch: string; phase: string; recordedAt: number }

/**
 * A run row as the STORE reads it: `RunSummary` (the wire shape) plus
 * `prLineage`, which is server-internal review material — folded once, at
 * close, from `.prhistory` — and deliberately absent from `RunSummary`
 * itself. `RunSummary`'s own docstring says why: it "rides the fleet socket
 * alongside a full session snapshot on every change", and `prLineage` is
 * neither small nor something that changes on every frame. `PrLineageEntry`
 * cannot live in `shared/` without `RunSummary` importing server-only
 * knowledge of `.prhistory`'s shape, so this stays a server-side supertype
 * rather than growing the wire type.
 *
 * `coordProject` (migration 12) is the same idea for a second field: the
 * coordinator's project, stamped at open time from a registry read the caller
 * made, kept here for the board-placement policy to read server-side. It is
 * NOT one of the design's two wire additions, so it stays off `RunSummary`
 * and gets stripped by `toRunSummary` alongside `prLineage`.
 */
export interface RunRow extends RunSummary { prLineage: PrLineageEntry[]; coordProject: string | null }

/** One open run naming a session. NOT a `RunRow`: these four columns are all
 *  the three consumers (`closeRun`, `FleetWatcher.sweepMerged`, the by-hand
 *  archive route) need, and hydrating a whole run to answer "is this
 *  workspace still claimed?" would drag `prLineage` JSON and a `programs`
 *  join through a decision that turns on four integers and a slug. */
export interface OpenSibling {
  id: number; program: string; wave: number; waveOf: number | null;
}

/** The columns `boardPlacement`'s port supply needs from a run, and nothing
 *  else — `OpenSibling`'s own reasoning above, restated for this consumer:
 *  hydrating a whole run (`itemTally`, `unreadMailCount`, batch health, a
 *  `prLineage` JSON parse) to answer "who coordinates this session, and where
 *  do they live" would drag all of that through a decision that turns on three
 *  strings and an id.
 *
 *  DECLARED BY THE CONSUMER (`coord/placement.ts`), re-exported here so the
 *  store's own result type reads in one place. D-2921 also dropped `project`
 *  from it: that column is the WORKER's project, the policy no longer keys
 *  anything on it, and a field nobody reads is an invitation to key on it
 *  again — which is the defect that number was spent on. */
export type { CoordPlacementStamp };

/** `RunRow` -> `RunSummary`: strips `prLineage`, server-internal review
 *  material `RunSummary`'s own docstring says is "deliberately absent" from
 *  the wire shape — "neither small nor something that changes on every
 *  frame." Also strips `coordProject` (migration 12, Task 1): the
 *  coordinator's project, stamped for the board-placement policy to read
 *  server-side, and NOT one of that design's two wire additions — see
 *  `RunRow`'s own docstring. Shared by `GET /api/runs` (`coord/routes.ts`)
 *  and the `runs` WS frame's own emitter (`watch.ts`'s `emitRuns`, Task 10)
 *  rather than each holding its own copy of the strip. */
export const toRunSummary = (row: RunRow): RunSummary => {
  const { prLineage: _prLineage, coordProject: _coordProject, ...summary } = row;
  return summary;
};

type HoldReasonRefusal = Extract<HoldReasonVerdict, { ok: false }>;

export type OpenRunResult =
  | { id: number; program: string; state: RunState; holdReason: string }
  | { refused: 'claimed-by-another' | 'review-in-flight'; by: string }
  | HoldReasonRefusal;

/** A fresh run's exact id is known only after its INSERT. Throwing this private
 * sentinel makes `tx` roll that INSERT and the programme up together, while the
 * public seam still returns the same typed refusal as the no-write duplicate arm. */
class OpenRunHoldRefused extends Error {
  constructor(readonly refusal: HoldReasonRefusal) {
    super(refusal.detail);
  }
}

export type AdvanceResult =
  | { ok: true; from: RunState; to: RunState }
  | { ok: false; error: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; error: 'unknown-run' };

/** `setAccountPools`'s answer (T6-R4, fix round 1; `error`'s vocabulary moved
 *  to `shared/api.ts`'s `SetAccountPoolsRefuseCode` in fix round 2 — see C1
 *  below). Wave 1 allows at most one pool per account —
 *  `pool_edges_one_per_account`'s own partial-unique shape — and a caller
 *  that asks for more gets this NAMED refusal instead of the raw `UNIQUE
 *  constraint failed` the store used to let escape.
 *
 *  C2 (fix round 2): the type system will NOT stop a caller from discarding
 *  this return value outright. Reading `.epoch` without narrowing `.ok` is a
 *  compile error, but `store.setAccountPools(input, log);` with the result
 *  unbound compiles clean and silent — a refusal then reads as a success at
 *  the call site, because nothing ran. THE RESULT MUST BE BOUND AND ITS `.ok`
 *  DISCRIMINATED before any effect is drawn from a call to this method. */
export type SetAccountPoolsResult =
  | { ok: true; epoch: number }
  | { ok: false; error: SetAccountPoolsRefuseCode; pools: readonly string[] };

/** Design 2026-09-20 §7 (W2). One element of a release listing, in the shape
 *  the catalogue poller (`update/catalogue.ts`) has already parsed and
 *  defensively validated; `applyReleaseListing` re-checks what the TABLE needs
 *  (a tag, a channel, an integer `publishedAt`) and refuses the whole listing
 *  otherwise. `draft` is GitHub's own flag: a draft is stored `yanked = 1`,
 *  never offered. `tarballUrl` is `null` (fix round 1, D-3216, F10) when the
 *  poller's own parse refused the listed download URL — a scheme other than
 *  `https:`, a non-ASCII or control byte, userinfo, or a length over
 *  `DOWNLOAD_URL_MAX` — because a release itself is real even when its one
 *  untrusted field is not; the release stays listed and this column alone
 *  goes NULL, never `''`, which the table's `NOT NULL` column cannot hold
 *  directly (`schema.ts`'s `tarballUrl TEXT NOT NULL` — untouched this wave):
 *  `''` is the ONE on-disk sentinel for "no url", written and read back at
 *  this single seam (the `INSERT` and `releases()` below) and never handed to
 *  a caller as anything but `null`. */
export interface ReleaseListingRow {
  tag: string; channel: UpdateChannel; publishedAt: number; commitSha: string | null;
  tarballUrl: string | null; bundleListed: boolean; notes: string | null; draft: boolean;
}

/** What the listing COVERS (D-3185). `complete` = the listing is
 *  the whole catalogue (GitHub answered fewer elements than a page), so
 *  every known row missing from it was yanked. `newest-page` = a full page:
 *  only a known row published at or after the oldest LISTED one can have been
 *  observed missing; an older row fell off the page, it was not yanked.
 *  `single` (fix round 1, D-3215) = ONE release upserted with NO absence
 *  judgment at all — the `/releases/latest` probe, which names one release
 *  outside any window and proves nothing about any other row's presence;
 *  the yank `UPDATE` below never runs under it. A listing of any length
 *  other than 1 under `single` is refused outright (`single-not-one`) —
 *  the coverage name is a promise about its own argument, not just about
 *  what happens next (fix round 1, review round 2, minor). `withdrawn`
 *  (fix round 1, item 5, ruling A, D-3215) = an EMPTY listing that yanks
 *  EXACTLY the one tag named by `withdrawTag`, and nothing else — the
 *  poller's own targeted `GET /releases/tags/{K}` answered 404, confirming
 *  the kept tag K itself is gone (never inferred from its mere absence off
 *  `/releases/latest` or off a listing page, which prove nothing about a
 *  release outside their own window). */
export type ListingCoverage = 'complete' | 'newest-page' | 'single' | 'withdrawn';

/** `applyReleaseListing`'s answers. `yanked` counts rows THIS listing newly
 *  marked absent; `unyanked` counts rows that were yanked and are listed again,
 *  not as drafts. Every refusal is decided before the transaction opens, so a
 *  refused listing writes nothing at all — not even its valid rows. */
export type ApplyReleaseListingResult =
  | { ok: true; upserted: number; yanked: number; unyanked: number }
  | { ok: false; why: 'bad-tag'; tag: string }
  | { ok: false; why: 'duplicate-tag'; tag: string }
  | { ok: false; why: 'bad-row'; tag: string; field: 'channel' | 'publishedAt' | 'tarballUrl' }
  | { ok: false; why: 'empty-listing'; known: number }
  | { ok: false; why: 'single-not-one'; count: number }
  | { ok: false; why: 'withdrawn-not-empty'; count: number };

/** One `releases` row on the way OUT. `channel` is `null` for a stored token
 *  outside `UpdateChannel` — the ClaimState stance (`ClaimEndResult`, below):
 *  no we-do-not-know member, so nothing, never the fleet default
 *  (D-3181). `refused` is a DISPLAY roll-up of
 *  `node_release_refusals` for live nodes — never an eligibility predicate;
 *  the resolver asks `refusalsFor(nodeId)` about the one node it resolves.
 *  `tarballUrl` is `null` for the on-disk `''` sentinel (D-3216, F10) — the
 *  one place that folds it back, so nothing outside this file ever reads the
 *  sentinel value itself. */
export interface ReleaseRow {
  tag: string; version: string; channel: UpdateChannel | null; publishedAt: number; commitSha: string | null;
  tarballUrl: string | null; bundleListed: boolean; notes: string | null; yanked: boolean; observedAt: number;
  notifiedAt: number | null;
  refused: { by: string; at: number }[];
}

export interface RefusalRow { nodeId: string; tag: string; at: number; detail: string }

/** `inserted: false` = this node had already refused this tag: its FIRST
 *  verdict (time and detail) stands. */
export type RefuseReleaseResult =
  | { ok: true; inserted: boolean }
  | { ok: false; why: 'bad-tag' }
  | { ok: false; why: 'unknown-node' };

export type ClearRefusalsResult =
  | { ok: true; cleared: number }
  | { ok: false; why: 'unknown-node' };

/** Design 2026-09-20 §13 (W3). `markReleaseNotified`'s answers. `bad-tag` is
 *  decided before any SQL. `already-notified` carries the value that STANDS —
 *  the first marker's, which this call did not change — so a caller that lost
 *  the race knows when the tag was announced; `unknown-release` means no
 *  catalogue row carries the tag. Both are read back after the zero-change
 *  write, inside its transaction. The C2 warning `setAccountPools` carries
 *  applies: the type system will NOT stop a caller discarding this value, so
 *  bind it and discriminate `.ok` before anything is sent. */
export type MarkReleaseNotifiedResult =
  | { ok: true; notifiedAt: number }
  | { ok: false; why: 'bad-tag'; tag: string }
  | { ok: false; why: 'unknown-release'; tag: string }
  | { ok: false; why: 'already-notified'; notifiedAt: number };

/** The columns `releases()` reads, as SQLite hands them back. */
interface RawReleaseRow {
  tag: string; version: string; channel: string; publishedAt: number; commitSha: string | null;
  tarballUrl: string; bundleListed: number; notes: string | null; yanked: number; observedAt: number;
  notifiedAt: number | null;
}

/** Design 2026-09-20 §8 (W2). A node's `~/.ccrc/update.json`, validated by the
 *  inventory sweep. Times are epoch MS here — the sweep converts the file's
 *  unix seconds (×1000, the second's FIRST ms) at its one validator, so this
 *  store holds ms in every column. */
export interface NodeReport {
  phase: UpdatePhase; target: string | null; startedAt: number | null; updatedAt: number | null; detail: string | null;
}

/** One sweep's measurement of one node: the MEASUREMENT and REPORT column
 *  groups (§6) and nothing else — which is what makes `upsertNodeMeasurement`
 *  the writer that can never move a lease, a resolution, a request or an
 *  identity. `nodeId` is a measured node-id (`NODE_ID_RE`), or the connection
 *  label when none was measured (a pre-W1 node, keyed by label, §8). */
export interface NodeMeasurement {
  nodeId: string;
  role: NodeRole; label: string;
  currentVersion: string | null; currentSha: string | null; currentRef: string | null;
  currentBuiltAt: string | null; currentDirty: boolean | null;
  stampRead: StampRead; installState: InstallState; provenance: ProvenanceState;
  /** Validated words (`validCapWords`); `[]` is stored as `''`. */
  caps: readonly string[];
  /** `null` = no agent by construction (the server's own row, decision 11);
   *  `[]` = an agent too old to say. Stored NULL and `''` — never folded. */
  agentOps: readonly string[] | null;
  highestVersion: string | null; previousVersion: string | null;
  /** fix round 1, D-3213 (re-review N-1): the STORED read state of the
   *  floor/previous files — a fact about the ROW, not just about the sweep
   *  that last touched it. `highestVersion`/`previousVersion` NULL means "no
   *  floor" only when the matching `*Read` is `absent`; `unmeasured` means
   *  NEVER MEASURED — no sweep, this one or an earlier one, has read this
   *  file — because `applyMeasurement` carries the PAIR (value AND state)
   *  forward from the row when THIS sweep's own raw read comes back
   *  `unmeasured` and the row already held something better, rather than
   *  overwrite a floor a past sweep did measure with `unmeasured`/NULL. */
  floorRead: TagFileRead; previousRead: TagFileRead;
  os: NodeOs;
  measuredAt: number;
  /** `null` = no `update.json` on the node. */
  report: NodeReport | null;
}

/** One `nodes` row on the way OUT. Every enum column reads through its L0 guard
 *  to the fallback §6 names (D-3181): `role`, `channel`,
 *  `requestedKind` → `null`; `stampRead` → `unreadable`; `installState`,
 *  `provenance`, `os`, `updateState` and a non-NULL `reportedPhase` →
 *  `unknown`. `measuredAt: null` = never measured; `reportedPhase: null` = no
 *  report file, distinct from `unknown` = a phase this build cannot name. */
export interface NodeRow {
  nodeId: string; role: NodeRole | null; label: string;
  currentVersion: string | null; currentSha: string | null; currentRef: string | null;
  currentBuiltAt: string | null; currentDirty: boolean | null;
  stampRead: StampRead; installState: InstallState; provenance: ProvenanceState;
  caps: string[]; agentOps: string[] | null; highestVersion: string | null; previousVersion: string | null;
  floorRead: TagFileRead; previousRead: TagFileRead; os: NodeOs;
  measuredAt: number | null; reachable: boolean; unreachableSince: number | null;
  reportedPhase: UpdatePhase | null; reportedTarget: string | null; reportedStartedAt: number | null;
  reportedUpdatedAt: number | null; reportedDetail: string | null;
  updateState: UpdateState; updateTarget: string | null; updateStartedAt: number | null; updateDetail: string | null;
  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;
  requestedTag: string | null; requestedKind: RequestKind | null; requestedAt: number | null;
  supersededBy: string | null;
}

/** The resolved group (§6) — the resolver's answer for one node, and
 *  `Resolution`'s first three fields structurally (Task 12). */
export interface NodeResolvedColumns { channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null }

export type UpsertNodeResult =
  | { ok: true; created: boolean }
  | { ok: false; why: 'superseded'; supersededBy: string };

/** `how` says what happened to the LABEL-keyed row; `retired` counts OTHER live
 *  rows carrying the same label under a different node id, now superseded by
 *  this one — a box uninstalled and re-installed mints a new id, and its old
 *  identity must not stay live beside the new one for ever
 *  (D-3193). `revived` is true only when the `nodeId` row itself was
 *  superseded and this call cleared it — a retired identity that comes back
 *  is revived, never left to close a cycle with the id that superseded it. */
export type RekeyNodeResult =
  | { ok: true; how: 'rekeyed' | 'superseded' | 'no-label-row'; retired: number; revived: boolean }
  | { ok: false; why: 'bad-node-id' };

/** `label-key-taken` = no live row carries the label AND the label-keyed
 *  placeholder cannot be written, because a row already holds that key —
 *  superseded (`supersededBy` names its heir) or, `null`, live under another
 *  label. Never folded into success: the caller would report a row that is
 *  not there. */
export type MarkUnreachableResult =
  | { ok: true; nodeId: string; created: boolean; since: number }
  | { ok: false; why: 'label-key-taken'; supersededBy: string | null };

export type ReleaseLeaseResult =
  | { ok: true; state: SettledUpdateState }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'not-busy'; state: UpdateState }
  | { ok: false; why: 'stale-report'; updateStartedAt: number };

export type SettleNodeResult =
  | { ok: true; clearedRequest: boolean }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'halted'; state: 'failed' | 'reverted' }
  | { ok: false; why: 'stale-report'; updateStartedAt: number };

export type ResolveNodeResult =
  | { ok: true; changed: boolean }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string };

export type AckNodeResult =
  | { ok: true; clearedRequest: boolean; clearedRefusals: number }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'busy'; state: BusyUpdateState };

/** A partial intent write. `undefined` = leave the field as it stands;
 *  `pinnedTag: null` = CLEAR the pin — two different requests, never folded. */
export interface UpdateIntentPatch { channel?: UpdateChannel; pinnedTag?: string | null; auto?: AutoMode; notify?: NotifyMode }

/** One `update_intent` row as the READ side sees it (D-3181):
 *  an out-of-vocabulary `channel` reads `null` (spec §6's ClaimState stance —
 *  never the fleet default, which would be fail-open), `auto` reads `'off'`
 *  (nothing unattended), `notify` reads `'channel'` (the operator hears of more,
 *  never of nothing). `pinnedTag` is returned as stored: a malformed pin is
 *  still a pin, and the resolver finds it ineligible rather than reading it as
 *  "unpinned, so newest". */
export interface UpdateIntentRow {
  scope: string; channel: UpdateChannel | null; pinnedTag: string | null; auto: AutoMode; notify: NotifyMode;
  setAt: number; setBy: string;
}

/** `setIntent`'s answer. Every refusal is its own arm, each word a member of
 *  the ONE update-store vocabulary (`UpdateStoreRefuseCode`, `shared/api.ts`,
 *  ruling R5), and every one but the two journal arms is decided before the
 *  transaction opens, so a refused write leaves no journal line.
 *
 *  `setAccountPools`'s C2 warning applies verbatim: the type system will NOT
 *  stop a caller discarding this value — `store.setIntent(…);` unbound compiles
 *  clean — so THE RESULT MUST BE BOUND AND ITS `.ok` DISCRIMINATED before any
 *  effect is drawn from the call. */
export type SetIntentResult =
  | { ok: true; row: UpdateIntentRow; epoch: number }
  | { ok: false; why: 'empty-patch' }
  | { ok: false; why: 'bad-field'; field: keyof UpdateIntentPatch }
  | { ok: false; why: 'unknown-scope'; scope: string }
  | { ok: false; why: 'no-channel'; scope: string; base: string }
  | { ok: false; why: 'journal-unreadable'; detail: string }
  | { ok: false; why: 'journal-unwritable'; detail: string };

/** The columns `NODE_COLUMNS` names, as SQLite hands them back. */
interface RawNodeRow {
  nodeId: string; role: string; label: string;
  currentVersion: string | null; currentSha: string | null; currentRef: string | null;
  currentBuiltAt: string | null; currentDirty: number | null;
  stampRead: string; installState: string; provenance: string; caps: string; agentOps: string | null;
  highestVersion: string | null; previousVersion: string | null; floorRead: string; previousRead: string; os: string;
  measuredAt: number | null; reachable: number; unreachableSince: number | null;
  reportedPhase: string | null; reportedTarget: string | null; reportedStartedAt: number | null;
  reportedUpdatedAt: number | null; reportedDetail: string | null;
  updateState: string; updateTarget: string | null; updateStartedAt: number | null; updateDetail: string | null;
  channel: string | null; desiredTag: string | null; resolveDetail: string | null;
  requestedTag: string | null; requestedKind: string | null; requestedAt: number | null;
  supersededBy: string | null;
}

/** A stored word list back to words: `null` stays `null` (agentOps: no agent),
 *  `''` is `[]`, and anything that no longer passes `validCapWords` reads `[]`
 *  — §8's one-bad-word-drops-the-file rule, applied again on the way out. */
function wordsOf(text: string | null): string[] | null {
  if (text === null) return null;
  return validCapWords(text === '' ? [] : text.split(' ')) ?? [];
}

function nodeRowOf(r: RawNodeRow): NodeRow {
  return {
    nodeId: r.nodeId, role: isNodeRole(r.role) ? r.role : null, label: r.label,
    currentVersion: r.currentVersion, currentSha: r.currentSha, currentRef: r.currentRef,
    currentBuiltAt: r.currentBuiltAt, currentDirty: r.currentDirty === null ? null : r.currentDirty === 1,
    stampRead: isStampRead(r.stampRead) ? r.stampRead : 'unreadable',
    installState: isInstallState(r.installState) ? r.installState : 'unknown',
    provenance: isProvenanceState(r.provenance) ? r.provenance : 'unknown',
    caps: wordsOf(r.caps) ?? [], agentOps: wordsOf(r.agentOps),
    highestVersion: r.highestVersion, previousVersion: r.previousVersion,
    // fix round 1, D-3213: an out-of-vocabulary token reads `unmeasured` — the
    // direction that never licenses a floor this build cannot vouch for.
    floorRead: isTagFileRead(r.floorRead) ? r.floorRead : 'unmeasured',
    previousRead: isTagFileRead(r.previousRead) ? r.previousRead : 'unmeasured',
    os: isNodeOs(r.os) ? r.os : 'unknown',
    measuredAt: r.measuredAt, reachable: r.reachable === 1, unreachableSince: r.unreachableSince,
    reportedPhase: r.reportedPhase === null ? null : (isUpdatePhase(r.reportedPhase) ? r.reportedPhase : 'unknown'),
    reportedTarget: r.reportedTarget, reportedStartedAt: r.reportedStartedAt,
    reportedUpdatedAt: r.reportedUpdatedAt, reportedDetail: r.reportedDetail,
    updateState: isUpdateState(r.updateState) ? r.updateState : 'unknown',
    updateTarget: r.updateTarget, updateStartedAt: r.updateStartedAt, updateDetail: r.updateDetail,
    channel: isUpdateChannel(r.channel) ? r.channel : null, desiredTag: r.desiredTag, resolveDetail: r.resolveDetail,
    requestedTag: r.requestedTag, requestedKind: isRequestKind(r.requestedKind) ? r.requestedKind : null,
    requestedAt: r.requestedAt, supersededBy: r.supersededBy,
  };
}

/** A read-back state that halts (`settleNode`'s refusal arm), or `null`. */
function haltedOf(s: UpdateState): Exclude<SettledUpdateState, 'idle'> | null {
  return (HALTED_UPDATE_STATES as readonly string[]).includes(s) ? (s as Exclude<SettledUpdateState, 'idle'>) : null;
}

/** A read-back state that is busy (`ackNode`'s refusal arm), or `null`. */
function busyOf(s: UpdateState): BusyUpdateState | null {
  return (BUSY_UPDATE_STATES as readonly string[]).includes(s) ? (s as BusyUpdateState) : null;
}

/** The reclaim's three answers. `kind`, not `error`, because these are not
 *  `advance`'s arms and folding them into `AdvanceResult` would put two
 *  vocabularies behind one discriminant. `unknown-run` is spelled the way its
 *  `MailRejectCode` twin is (shared/api.ts:4260); `no-claimant` is this wave's
 *  own word, admitted to `mail-routes.test.ts`'s scanner through the exported
 *  `isReclaimRefuseCode` guard rather than an allowlist entry — the standing
 *  remedy that file states for every union after the first. */
export type ReclaimProgramResult =
  | { ok: true; program: string; runIds: number[]; from: string }
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'no-claimant' };

/** The three terminal members, ONCE (spec §3.2). The SQL literal in
 *  `setWorkItemState`'s `WHERE` is BUILT from this list and `settleItems`'
 *  pre-pass READS it, so the guard and the precheck cannot drift — and
 *  `single-definition.test.ts` pins that this is the only place the trio is
 *  spelled as one adjacent list under any of the four roots. */
export const TERMINAL_ITEM_STATES = ['done', 'failed', 'abandoned'] as const satisfies
  readonly WorkItemState[];

/** `setWorkItemState` stops returning `void` — the exact defect
 *  `architecture:25-30` names for `markDelivered`. A refusal that the caller
 *  cannot see is a refusal that reads as a success. */
export type SetWorkItemResult =
  | { ok: true; state: WorkItemState }
  | { ok: false; why: 'unknown-item' }
  | { ok: false; why: 'terminal'; state: WorkItemState };

export interface SettleItem { id: number; state: WorkItemState; claimedBy: string | null }

/** A batch is all-or-nothing, so its refusal names WHICH id refused it —
 *  "partial success on a ledger write is how tallies drift" (spec §3.2), and
 *  a caller told only that something in its body was bad cannot fix it. */
export type SettleItemsResult =
  | { ok: true; items: RunItemTally }
  | { ok: false; itemId: number; why: 'unknown-item' }
  | { ok: false; itemId: number; why: 'terminal'; state: WorkItemState };

/** Build 9 wave 7 (D12). The failure arms are `decideClaim`'s own, verbatim —
 *  the store adds nothing to a refusal and takes nothing from it (the payloads
 *  pass through untouched; only the `ok`/`why` discriminant is the store's,
 *  so this union reads like its `SetWorkItemResult` neighbours). */
export type ClaimAttemptResult =
  | { ok: true; claims: ClaimSummary[] }
  | { ok: false; why: 'bad-path'; paths: readonly string[] }
  | { ok: false; why: 'conflict'; conflicts: readonly ClaimConflict[] };

/** Release and break share this shape — `setWorkItemState`'s refusal family:
 *  a caller must be able to see that ITS call was not the one that landed.
 *  `state` on the not-live arm is `null` for exactly ONE condition, a stored
 *  token this build cannot model (a newer build's word — coord/db.ts rule 3:
 *  a rollback must be able to READ, and reading is `isClaimState`, never a
 *  cast; `ClaimState` has no designated we-do-not-know member to degrade to,
 *  by the L0 pin). */
export type ClaimEndResult =
  | { ok: true; state: 'released' | 'broken' }
  | { ok: false; why: 'unknown-claim' }
  | { ok: false; why: 'not-live'; state: ClaimState | null };

/** One `ledger_alloc` row on the way OUT — the L0 wire row's own fields
 *  (`DeviationAllocation`) minus `stale`, which is DERIVED by the READER
 *  from a clock this store does not own (`allocatedAt + LEDGER_STALE_MS`,
 *  the watcher's and the route's policy, never stored) — and with `state`
 *  read through the same we-do-not-know rule as every enum column in this
 *  file: `DeviationAllocState` has no designated unknown member (the L0 pin
 *  stores exactly two words), so the store's row widens it rather than
 *  degrading a token a newer build wrote to a guess. */
export interface LedgerRow extends Omit<DeviationAllocation, 'state' | 'stale'> {
  state: DeviationAllocState | 'unknown';
}

/** The ok payload of `allocateDeviations` — one allocated BLOCK. The L0
 *  wire row is one row PER NUMBER; the allocator decides per BLOCK
 *  (contiguous `numbers` from one floor read), so the ok arm carries the
 *  block's shared identity plus the numbers, not N copies of a row. */
export interface AllocatedBlock extends Pick<DeviationAllocation,
  'project' | 'title' | 'allocatedTo' | 'runId' | 'allocatedAt'> {
  numbers: readonly number[];
  floor: number;
}

/** The failure arms are `decideAllocation`'s own (`ledger.js`), re-keyed to
 *  this file's `ok`/`why` house shape — the `ClaimAttemptResult` stance: the
 *  store adds nothing to a refusal and takes nothing from it. */
export type AllocateResult =
  | { ok: true; allocation: AllocatedBlock }
  | { ok: false; why: 'not-seeded' }
  | { ok: false; why: 'bad-count' };

/** One `asks` row, options JSON-decoded and `state` read through `isAskState`
 *  — never a bare cast, the same we-do-not-know rule every enum column in
 *  this file follows (schema.ts's own comment on the column). */
export interface AskRow {
  id: number; at: number; childId: string; parentId: string; runId: number | null;
  askKey: string; askAt: number; dialogId: string;
  question: string; options: string[];
  state: AskState;
  answeredBy: string | null; answer: string | null;
  answeredAt: number | null; releasedAt: number | null;
}

/** `takeAskForAnswer`'s two refusals are DIFFERENT conditions a caller acts on
 *  differently (D-2170/D-2171): `not-held` means THE ROW IS NO LONGER
 *  PRE-EMPTIBLE; `ask-moved` is the child repainting an identical question,
 *  so the menu on screen may be a different instance. Collapsing them would
 *  be an overloaded value at a seam.
 *
 *  `not-held` is NOT "another principal already took this row" — this
 *  docstring said exactly that for a wave, and the gloss SPREAD from here
 *  into the shipped coordinator contract (whole-branch review M3, corrected
 *  in `ccd/coordinator-skill/references/wave-lifecycle.md` too). The CAS
 *  source is the single state `'held'`, so every other state answers it:
 *  `answering` (the lost race the old sentence described), and equally
 *  `released` (the grace window lapsed and the operator's push has already
 *  fired), `stale` (the dialog is gone) and `answered` (someone already
 *  ruled). Only the first of those four is a race, and only the first is
 *  worth a retry — which is precisely why the false gloss mattered on a
 *  surface a coordinator reads. */
export type AskTakeResult =
  | { ok: true; row: AskRow }
  | { ok: false; why: 'unknown-ask' | 'not-held' | 'ask-moved' };

/**
 * D-2545 — THE FIVE READ ANSWERS, and the one rule that makes them worth
 * having: **ABSENT IS NOT UNREADABLE.**
 *
 * `{ ok: true, run: null }` means NO SUCH ROW. `{ ok: false, … }` means the row
 * EXISTS and one of its persisted integers is unrepresentable in JavaScript.
 * Before this, `run(id): RunRow | null` and `askById(id): AskRow | null` had no
 * slot for the second condition at all, and the naive fix — catch the
 * `RangeError` and return `null` — is precisely the **overloaded null at a
 * seam** this codebase bans
 * (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md:99-100`),
 * with `store.ts` named there as the L3 adapter bound by "an adapter may not
 * narrow a distinction it received" (`:86-89`). The two conditions travel
 * apart, all the way to every consumer.
 *
 * ALL-OR-FAILURE on the list reads: one unreadable row fails the WHOLE read.
 * Never a partial list — a board that silently drops the run an operator is
 * looking for is worse than a board that says it could not be read.
 *
 * Shaped on `HoldReasonVerdict` (`coord/rundefs.ts:97-100`) and on this file's
 * own `SetEnvelopeResult`/`MarkAckedResult`/`AskTakeResult` above. SERVER-
 * INTERNAL: none of these types reaches a wire — every consumer maps its own
 * refusal onto its own vocabulary.
 */
export type RunReadResult =
  | { ok: true; run: RunRow | null }
  | { ok: false; kind: 'run-unreadable'; detail: string };

export type RunsReadResult =
  | { ok: true; runs: RunRow[] }
  | { ok: false; kind: 'run-unreadable'; detail: string };

export type OpenSiblingsResult =
  | { ok: true; siblings: OpenSibling[] }
  | { ok: false; kind: 'run-unreadable'; detail: string };

export type CoordPlacementStampsResult =
  | { ok: true; stamps: CoordPlacementStamp[] }
  | { ok: false; kind: 'run-unreadable'; detail: string };

export type AskReadResult =
  | { ok: true; ask: AskRow | null }
  | { ok: false; kind: 'ask-unreadable'; detail: string };

export type AsksReadResult =
  | { ok: true; asks: AskRow[] }
  | { ok: false; kind: 'ask-unreadable'; detail: string };

/** `AsksReadResult`'s KEYED sibling, for `currentAsksFor` alone — the one ask
 *  reader whose answer is a map rather than a list, because `assembleFleet`
 *  asks "the newest ask row PER CHILD" for the whole registry every tick. A
 *  sixth type rather than returning the array and re-keying at the caller:
 *  the keying is the store's own (a child with no row is ABSENT from the map,
 *  which is what the caller's `.get(id) ?? null` fold reads), and moving it out
 *  would put a store concern in `fleet.ts` to save a type alias. */
export type AsksByChildResult =
  | { ok: true; asks: Map<string, AskRow> }
  | { ok: false; kind: 'ask-unreadable'; detail: string };

/** The raw row shape common to `run(id)` and `runs()` — named columns only
 *  (no `SELECT *` anywhere in this file), joined once against `programs` for
 *  its title.
 *
 *  THE THREE `*Text` FIELDS ARE THE WHOLE OF D-2545 (see `persistedInt` below).
 *  `node:sqlite` throws a bare `RangeError` while CONVERTING a persisted
 *  INTEGER wider than `Number.MAX_SAFE_INTEGER` into a JavaScript number, so a
 *  row a newer build wrote and a rollback left behind used to crash the read
 *  before any boundary could refuse in words — and there is no
 *  `app.setErrorHandler` anywhere in `server/src`, so that became Fastify's
 *  default bare 500. Reading them as TEXT and proving them afterwards is the
 *  idiom `openRun`'s already-protected duplicate-row arm uses (`:647`), reached
 *  here for the read surface. `CAST(NULL AS TEXT)` is `NULL`, so `waveOf`'s
 *  nullability survives unchanged. */
interface RunRowDb {
  idText: string; program: string; programTitle: string;
  waveText: string; waveOfText: string | null; reviewsText: string | null;
  homeProject: string | null;
  project: string; sessionId: string | null; workspace: string | null; branch: string | null;
  state: string; kind: string; claimedBy: string | null;
  resumed: number; clearedAt: number | null; openedAt: number;
  dispatchStartedAt: number | null; dispatchedAt: number | null; closedAt: number | null;
  handoffCommit: string | null;
  prLineage: string | null;
  briefQueued: number | null;
  clearError: string | null;
  coordProject: string | null;
}

/** CAST-to-TEXT rather than `setReadBigInts(true)` (D-2590, a deliberate
 *  departure from the wave-1 ruling's parenthetical): `setReadBigInts` is
 *  per-STATEMENT, not per-column, so turning it on here would convert EVERY
 *  integer column of this SELECT to `bigint` — `openedAt`, `resumed`,
 *  `clearedAt`, `dispatchedAt`, `closedAt`, `briefQueued` and more — forcing a
 *  bigint->number conversion on a dozen columns outside this defect's domain.
 *  `CAST(col AS TEXT)` is surgical, and it is the spelling the store's
 *  already-protected sibling arm at `:647` already uses.
 *
 *  `ORDER BY r.id` and the `includeClosed` subquery below still order on the
 *  real INTEGER column; only the projection changes. */
const RUN_ROW_COLUMNS =
  'CAST(r.id AS TEXT) AS idText, r.program, p.title AS programTitle, p.homeProject AS homeProject, ' +
  'CAST(r.wave AS TEXT) AS waveText, CAST(r.waveOf AS TEXT) AS waveOfText, r.project, r.sessionId, ' +
  'r.workspace, r.branch, r.state, r.kind, CAST(r.reviews AS TEXT) AS reviewsText, r.claimedBy, ' +
  'r.resumed, r.clearedAt, r.openedAt, r.dispatchStartedAt, ' +
  'r.dispatchedAt, r.closedAt, ' +
  'r.handoffCommit, r.prLineage, r.briefQueued, r.clearError, r.coordProject';

/** ONE persisted integer, read as TEXT and proven representable.
 *
 *  A DISCRIMINATED RESULT, never a three-valued return: SQL `NULL` is decided
 *  at the CALL SITE (the nullable `waveOf` column below), so this helper only
 *  ever sees a string and never has to overload its own answer.
 *
 *  The predicate is `shared/api.ts`'s `isPositiveDecimalSafeInteger`, imported
 *  rather than respelled — `single-definition.test.ts` text-scans four roots
 *  and fails the build on a second copy of a single-source value.
 *
 *  `detail` NAMES THE COLUMN AND NOTHING ELSE. The offending value never
 *  leaves this function — not as a bigint, not as a rounded number, not in a
 *  log line and not in a reply — for `RUN_ID_MAX_DECIMAL`'s own stated reason:
 *  a value this process cannot represent cannot be quoted without being
 *  falsified in the quoting. The wording matches `openRun`'s existing details
 *  verbatim in style (`'reused run id is not a positive safe integer'`). */
type PersistedInt = { ok: true; value: number } | { ok: false; detail: string };

const persistedInt = (text: string, column: string): PersistedInt => {
  const value = Number(text);
  return isPositiveDecimalSafeInteger(value)
    ? { ok: true, value }
    : { ok: false, detail: `${column} is not a positive safe integer` };
};

/** The four persisted integers every run-shaped read carries, proven. */
interface RunNumbers { id: number; wave: number; waveOf: number | null; reviews: number | null }

type RunNumbersResult = { ok: true; nums: RunNumbers } | { ok: false; detail: string };

/** `RunRowDb`'s (and `openRunsForSession`'s narrower row's) four integers,
 *  measured together so the two reads cannot come to disagree about which
 *  columns are in the domain or how they are worded. */
const measureRunNumbers = (
  r: { idText: string; waveText: string; waveOfText: string | null; reviewsText: string | null },
): RunNumbersResult => {
  const id = persistedInt(r.idText, 'run id');
  if (!id.ok) return id;
  const wave = persistedInt(r.waveText, 'run wave');
  if (!wave.ok) return wave;
  // Same NULL rule as `waveOf`: absent is legitimate (every work run), and
  // `persistedInt` must not be asked to answer "absent" as well as "unrepresentable".
  const reviews: { ok: true; value: number | null } | { ok: false; detail: string } =
    r.reviewsText === null ? { ok: true, value: null } : persistedInt(r.reviewsText, 'run reviews');
  if (!reviews.ok) return reviews;
  // NULL IS DECIDED HERE, not inside `persistedInt` — `waveOf` is legitimately
  // absent (the two documented display forms omit it), and a helper that had to
  // answer "absent" as well as "present but unrepresentable" would be the
  // overloaded value this whole change exists to remove.
  if (r.waveOfText === null) {
    return { ok: true, nums: { id: id.value, wave: wave.value, waveOf: null, reviews: reviews.value } };
  }
  const waveOf = persistedInt(r.waveOfText, 'run waveOf');
  if (!waveOf.ok) return waveOf;
  return { ok: true, nums: { id: id.value, wave: wave.value, waveOf: waveOf.value, reviews: reviews.value } };
};

/** A `RunRowDb` whose four integers are proven — what `healthFor` and
 *  `hydrateRun` take now that the numeric ids do not exist until after
 *  validation. The order is: read rows -> validate every row -> on any failure
 *  return the refusal -> only then `healthFor` -> then hydrate. */
interface MeasuredRunRow { row: RunRowDb; nums: RunNumbers }

/**
 * Coordination's own terminal-state rule, spelled ONCE (bounded context 5:
 * "acked and rejected are terminal" — `docs/superpowers/specs/2026-08-10-
 * architecture-ddd-clean-solid.md`): the states a delivery sits in while it
 * is still "outstanding". Before fix round 1 (findings 2/4) this predicate
 * was spelled independently, in SQL, at three call sites in this file
 * (`cancelOutstandingDeliveries`, `unreadMailCount`, `hasOutstandingMail`) —
 * and a FOURTH copy, re-implemented as a JS `.filter()`, lived outside the
 * store entirely, in `sessionws.ts`'s `checkMail`, on the wrong side of
 * `mailForRecipient`'s own `LIMIT`: applied to a 100-row *history* window
 * rather than to the query that produces it, so an old unacked delivery
 * could fall out of that window and read as gone while still genuinely
 * queued. `outstandingMailFor` below is the store-side fix; this constant is
 * what lets every "is this delivery outstanding" query converge on one
 * fragment instead of independently agreeing four times.
 */
const OUTSTANDING_STATES_SQL = "('queued','delivered')";

/** The WRITE-side complement of `OUTSTANDING_STATES_SQL` above, built from L0's
 *  `TERMINAL_DELIVERY_STATES` by the same `.join` interpolation
 *  `CoordStore.TERMINAL_SQL` already uses for work items. Every delivery-row
 *  `UPDATE` in this file names one of these two fragments and never a literal —
 *  pinned in both directions by `single-definition.test.ts`'s two pair scans and
 *  by `mail-hardening.test.ts`'s writer scan.
 *
 *  NOT the complement of `OUTSTANDING_STATES_SQL` for a token in NEITHER list: a
 *  row holding an out-of-vocabulary `state` is not-outstanding to the positive
 *  form and still-live to this one. That asymmetry is deliberate, unchanged by
 *  this wave, and recorded as an open design question
 *  (D-1406). */
const TERMINAL_DELIVERY_SQL = `('${TERMINAL_DELIVERY_STATES.join("','")}')`;

/** The cap's predicate, NEGATIVE over everything that is not active — the idle
 *  and terminal lists, both L0, joined the way `TERMINAL_DELIVERY_SQL` is
 *  (design 2026-09-14 §7.1 as corrected by D-2803): a raw state token this build
 *  cannot name is neither idle nor terminal and so COUNTS, which is the safe
 *  direction for a cap and the reason `unknown` sits in `ACTIVE_RUN_STATES`. */
const INACTIVE_RUN_STATES_SQL = `('${[...IDLE_RUN_STATES, ...TERMINAL_RUN_STATES].join("','")}')`;
/** Every "still open" predicate in this file — `runs()`, `programOpenRunCount`,
 *  `openRunsForSession`, the strands query, `advanceInner`'s `closedAt` CASE —
 *  names this fragment and never the literal pair (D-2800), except the
 *  strands query, which binds the same L0 constant as bound placeholders
 *  (D-2794). */
const TERMINAL_RUN_STATES_SQL = `('${TERMINAL_RUN_STATES.join("','")}')`;

/** Design 2026-09-20 §6/§10 (W2): the node lease's predicates, built from L0's
 *  `SETTLED_UPDATE_STATES` by the `.join` `TERMINAL_DELIVERY_SQL` uses — never
 *  a hand-typed tuple. There is deliberately NO busy fragment: busy is spelled
 *  `NOT IN` this one, the `INACTIVE_RUN_STATES_SQL` stance above (D-2803). A
 *  stored `updateState` this build cannot name reads `unknown` on the read
 *  side, and `unknown` is busy, so the write side counts it busy too — an
 *  `IN (busy)` fragment would call that row settled for an `ack` and not-busy
 *  for a release, the one direction that is not safe. */
const SETTLED_UPDATE_SQL = `('${SETTLED_UPDATE_STATES.join("','")}')`;

/** The settled states that HALT dispatch until `ack` (design §10): every
 *  settled state but `idle`. `settleNode` refuses a row in one of them, so
 *  convergence can never silently clear a failure the operator has not seen. */
const HALTED_UPDATE_STATES = SETTLED_UPDATE_STATES.filter(
  (s): s is Exclude<SettledUpdateState, 'idle'> => s !== 'idle');
const HALTED_UPDATE_SQL = `('${HALTED_UPDATE_STATES.join("','")}')`;

/** The shape of a node id: the lowercase uuid `_inst_node_id` mints
 *  (`ccd/ccrc:9494-9513`) and nothing else, so an uppercase, padded or
 *  CR-terminated `~/.ccrc/node-id` never becomes a row key. Declared ONCE,
 *  here, beside the one writer that re-keys by it; the inventory's validator
 *  (`update/inventory.ts`, Task 11) imports it. */
export const NODE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `ackNode`'s `updateDetail`: the row went back to idle because a person
 *  said so, not because anything converged. */
const ACK_DETAIL = 'acknowledged by the operator';

/** The columns every `nodes` read names — explicitly, never `SELECT *` (this
 *  file's rule, stated above `CoordStore`). */
const NODE_COLUMNS =
  'nodeId, role, label, currentVersion, currentSha, currentRef, currentBuiltAt, currentDirty, stampRead, ' +
  'installState, provenance, caps, agentOps, highestVersion, previousVersion, floorRead, previousRead, os, ' +
  'measuredAt, reachable, ' +
  'unreachableSince, reportedPhase, reportedTarget, reportedStartedAt, reportedUpdatedAt, reportedDetail, ' +
  'updateState, updateTarget, updateStartedAt, updateDetail, channel, desiredTag, resolveDetail, ' +
  'requestedTag, requestedKind, requestedAt, supersededBy';

/** `setDeliveryEnvelope`'s answer — `SetWorkItemResult`'s shape, for
 *  `SetWorkItemResult`'s reason. `'absent'` and `'terminal'` are kept apart
 *  because the first says this transaction has already lost the row it just
 *  inserted and the second says another writer finished the delivery: no
 *  overloaded null at a seam (D-1409). */
export type SetEnvelopeResult =
  | { ok: true }
  | { ok: false; why: 'absent' }
  | { ok: false; why: 'terminal'; state: MailDeliveryState };

/** `markAcked`'s answer. The boolean it replaces collapsed the store's refusal
 *  reasons into one value, and at the HTTP seam collapsed ALREADY-ACKED with
 *  PARKED — `already: !landed` said the same thing about "somebody already
 *  acked this" and "this delivery was parked and your ack changed nothing".
 *  Worker-skill clause 3 is "Ack before you act", so the second one, read as
 *  the first, is a worker starting a wave on a brief the lane has abandoned.
 *  Same remedy as `bumpReplayCount`'s union below and `SetWorkItemResult`
 *  above: the union is the fix; the guard alone is not
 *  (D-1410). */
export type MarkAckedResult =
  | { ok: true; state: 'acked' }
  | { ok: false; why: 'absent' }
  | { ok: false; why: 'already-acked'; state: MailDeliveryState }
  | { ok: false; why: 'parked'; state: MailDeliveryState; lastError: string | null };

/** WHOSE undelivered mail a re-queue is moving, and to which scope. A
 *  CORRELATED union rather than two loose parameters: the coordinator arm is
 *  scoped to a PROGRAMME (a chair is a programme's), the worker arm to a RUN (a
 *  worker is a run's), and a `role` beside an independent scope would admit two
 *  combinations that mean nothing. */
export type RequeueRole =
  | { role: 'coordinator'; program: string }
  | { role: 'worker'; runId: number };

/** `?,?,?` for an `IN (...)` bound to a JS array (D-1141). `node:sqlite` has no
 *  array bind, so the list has to be BUILT — and a built SQL fragment is exactly
 *  where a value would slip into the statement text. One home, and it can emit
 *  nothing but question marks whatever it is handed: every value still travels as
 *  a positional bind. Callers guard `n > 0` themselves — an empty `IN ()` is a
 *  syntax error in SQLite, and a helper that silently returned a
 *  matches-nothing fragment would hide the caller's own missing guard. */
const placeholders = (n: number): string => new Array(n).fill('?').join(',');

/** The three lifecycle acts `runSignals`' window arithmetic reads (§6), spelled
 *  ONCE: the in-window scan and the unstamped-row count below it ask about the
 *  same rows from two directions, and a second hand-written act list is how the
 *  two would come to disagree about what "the window" contained. Bound
 *  positionally through `placeholders`, never interpolated. */
const LIFECYCLE_WINDOW_ACTS = ['swap', 'hold', 'release'] as const;

/** The replay-ceiling park's own `lastError`, written by exactly one call
 *  site (`watch.ts`'s `sweepMail`, `store.rejectDelivery(d.id, 'undeliverable',
 *  MAIL_REPLAY_CEILING_ERROR)`) and read back by exactly one other
 *  (`markAcked` below, deviation D-67-b / orchestrator ruling I2): a shared
 *  constant rather than the same string literal typed twice, so the two can
 *  never drift apart and silently stop recognising each other's writes. */
export const MAIL_REPLAY_CEILING_ERROR = 'replayed without ack past the replay ceiling';

/** `cancelOutstandingDeliveries`'s own park sentence, promoted to a constant on
 *  `MAIL_REPLAY_CEILING_ERROR`'s exact argument (D-1143). It was already typed
 *  twice — once by the writer at `cancelOutstandingDeliveries`, once by the
 *  READ-side exclusion in `OUTSTANDING_OR_ABANDONED_SQL` below — which is the
 *  drift the constant above exists to forbid: the day one of the two is reworded
 *  the park silently stops being recognised as deliberate and every closed run's
 *  cancelled mail reappears as "still needs a human's attention". Two literals
 *  that MUST match are one definition, wherever they happen to live. */
export const MAIL_RUN_CLOSED_ERROR = 'run closed';

/**
 * The reclaim's own park sentence (D-1143), and the second member of the pair
 * below. Written by `reclaimProgram`'s kickoff cancellation and read back by the
 * same READ-side exclusion — the identical writer/reader pair the constant above
 * describes, minted as a constant from the start rather than as two literals a
 * later fix round has to notice.
 *
 * IT IS NOT `MAIL_RUN_CLOSED_ERROR`, and reusing that string would have been the
 * cheap way to inherit the exclusion for free: no run closed here. A reclaim
 * moves the chair while every run of the program stays exactly as open as it
 * was, and `lastError` is free text a maintainer greps for the ROW's own history
 * — a park that lies about why it happened is worse than a park nobody
 * excluded. Contains no apostrophe, deliberately: it is interpolated into the
 * SQL fragment below, where the surrounding quotes are the only escaping there
 * is.
 */
export const MAIL_RECLAIM_CANCELLED_ERROR = 'coordinator reclaimed';

/**
 * The occupant-change park (design 2026-09-08 §4), and it is its OWN sentence
 * rather than a reuse of the two above. `MAIL_RECLAIM_CANCELLED_ERROR` reads
 * `'coordinator reclaimed'`, which is FALSE of a worker whose run was re-bound,
 * and `lastError` reaches an operator's eye through `MailSummary.lastError`; a
 * park that lies about why it parked is worse than no park. Same shape, same
 * exclusion, different fact.
 *
 * A DELIBERATE cancel, so it joins `DELIBERATE_CANCEL_ERRORS_SQL` below: the
 * predecessor is not being abandoned, it is being SUPERSEDED — the heir already
 * holds a freshly rendered delivery of the same mail — and a row that stayed
 * visible as "this park still needs a human" would ask a human to act on a
 * message that has already been re-sent.
 */
export const MAIL_REBIND_SUPERSEDED_ERROR = 'recipient rebound';

/**
 * The child-reclaim park (child-reclamation spec 2026-09-22 §5.6): every
 * outstanding delivery ADDRESSED TO a child workspace the server has just
 * reclaimed, parked by `cancelDeliveriesTo`. Its OWN sentence, for
 * `MAIL_REBIND_SUPERSEDED_ERROR`'s reason: `'run closed'` is false of a
 * delivery from an earlier wave's run or from a peer (no run at all), and
 * `lastError` reaches an operator's eye through `MailSummary.lastError`.
 *
 * A DELIBERATE cancel, so it joins `DELIBERATE_CANCEL_ERRORS_SQL` below — and
 * it is not "a purged recipient", the abandonment park that set must never
 * hold. That park (`watch.ts`'s `sweepMail`) is the lane DISCOVERING a
 * recipient gone from under it, ~26 minutes after the fact, which is worth a
 * human's look. This one is the server's own act, taken the instant the
 * reclaim it caused succeeded: the recipient was removed ON PURPOSE because
 * its run had closed, and a row that stayed visible as "this still needs a
 * human" would ask a human to act on mail to a workspace that, by rule 4, no
 * human was ever meant to open. It is also what ends the recycled-slug hazard
 * `sweepMail`'s own comment names: `_ws_slug_new` re-mints a purged id, and a
 * delivery left outstanding would be typed into the stranger that inherits
 * it. No apostrophe: it is interpolated into the SQL fragment below.
 */
export const MAIL_CHILD_RECLAIMED_ERROR = 'child workspace reclaimed';

/** The four parks that are DECISIONS rather than abandonment — a run closing
 *  (`closeRun`), a chair changing hands (`reclaimProgram`), an occupant
 *  changing (`bindSession`) and a child workspace reclaimed
 *  (`cancelDeliveriesTo`, child-reclamation wave 3) — as one SQL list, so the
 *  read-side exclusion below names a set rather than growing a second
 *  hand-written `!=` per writer. Every future "this delivery was cancelled on
 *  purpose" park joins HERE and inherits the exclusion; a park that means "we
 *  gave up" (the replay ceiling, the attempt ceiling, a purged recipient)
 *  must never be added, because those are exactly the rows that predicate
 *  exists to keep visible. */
const DELIBERATE_CANCEL_ERRORS_SQL =
  `('${MAIL_RUN_CLOSED_ERROR}','${MAIL_RECLAIM_CANCELLED_ERROR}','${MAIL_REBIND_SUPERSEDED_ERROR}','${MAIL_CHILD_RECLAIMED_ERROR}')`;

/** The ABANDONMENT half of the predicate below, lifted into its own name because
 *  it is about to have a second reader: `requeueAbandonedMail`
 *  selects exactly the rows a mailbox shows as an abandoned park, and a re-queue
 *  that respelled these clauses would drift from the thing it is meant to
 *  mirror — the same argument `DELIBERATE_CANCEL_ERRORS_SQL` above makes about
 *  its two literals, one level up. Pinned by `single-definition.test.ts`'s
 *  "spells the abandonment predicate ONCE".
 *
 *  THE ALIASES ARE THE CALLER'S: `d` is `mail_deliveries` and `rr` is the
 *  delivery's own run, joined on `m.runId`. `COALESCE(rr.state, '')` is what
 *  makes the fragment indifferent to the JOIN KIND the caller brings, which is
 *  the whole reason a read path may reach it through a LEFT join and a write
 *  path through an inner one. */
const ABANDONED_PARK_SQL =
  "(d.state = 'rejected' " +
  `AND COALESCE(d.lastError, '') NOT IN ${DELIBERATE_CANCEL_ERRORS_SQL} ` +
  `AND COALESCE(rr.state, '') NOT IN ${TERMINAL_RUN_STATES_SQL})`;

/**
 * The READ-side "still needs a human's attention" predicate (fix, review
 * finding 2) — `OUTSTANDING_STATES_SQL` above, unioned with a `rejected`
 * delivery THIS BUILD gave up retrying before anyone ever acted on it: the
 * replay-ceiling park (`watch.ts`'s `MAIL_REPLAY_MAX_ATTEMPTS`), a delivery
 * that never sent at all past `MAIL_MAX_ATTEMPTS`, or a recipient the
 * registry no longer lists. `renderEnvelope`'s own ack line promises
 * replay "until you ack" — true only up to that ceiling, never past it —
 * and before this fix, the moment a park landed, the row vanished from
 * every reader built on `OUTSTANDING_STATES_SQL` alone: `RunSummary.unreadMail`
 * silently dropped to 0, `MailStrip` unmounted itself, and only a full
 * `?all=1` history read still knew. A message that was never acked and
 * never acted on does not stop being a fact worth surfacing just because
 * the lane stopped trying to hand it over.
 *
 * DELIBERATELY EXCLUDES `cancelOutstandingDeliveries`'s own park
 * (`MAIL_RUN_CLOSED_ERROR`): that one is not abandonment, it is the run
 * closing making the delivery moot BY DESIGN — surfacing it as "still needs
 * attention" would be exactly the false alarm this predicate exists to
 * avoid on the other end.
 *
 * …AND, SINCE D-1143, `MAIL_RECLAIM_CANCELLED_ERROR` BESIDE IT — the same
 * argument, measured rather than assumed. `reclaimProgram`'s kickoff
 * cancellation writes a `rejected` row whose `mail.runId` IS NULL (the program
 * kickoff names no run, by construction — `kickoff.ts`'s own docstring), so the
 * `LEFT JOIN runs rr` arm two paragraphs down cannot help: `rr.state` is NULL,
 * `COALESCE(rr.state,'')` is `''`, and the row would have stayed abandoned-and-
 * visible FOREVER, on the corpse's own `toId`. Every reader was walked before
 * this clause was written, and the answer differs per reader — which is why the
 * fix is here and not in a writer:
 *   `outstandingMailFor(toId)` — the one that breaks. `GET /api/mail?to=<dead
 *     id>` and `sessionws.ts`'s `checkMail` both read it, and `checkMail` is
 *     keyed on the SESSION's own id. A reclaimed workspace id is not gone for
 *     good: `ccd start` / `ws-restore` bring the same id back, and `_ws_slug_new`
 *     recycles a purged slug outright (`ccd/ccd:3653`) — so the returning
 *     session's mail strip would open on a kickoff briefing it to coordinate a
 *     program somebody else now holds. That is MINOR 9's own two-coordinator
 *     hazard, re-entered through the READ side after the write side closed it.
 *   `unreadMailCount(runId, sessionId)` — unaffected, and not by luck: its
 *     `WHERE m.runId = ?` cannot match a NULL `runId` at all, so no
 *     `RunSummary.unreadMail` ever counted the kickoff, before or after the
 *     cancellation.
 *   `mailForRecipient` (`?all=1`) — unaffected ON PURPOSE. It is the history
 *     read; a cancelled kickoff is exactly the kind of fact an operator
 *     inspecting `/mail` should still find.
 *   `hasOutstandingMail` / `dueDeliveries` / the peer-quota reads — all built on
 *     the narrower `OUTSTANDING_STATES_SQL`, for which `rejected` is simply
 *     terminal. The lane stops replaying and the dedupe slot frees up, which is
 *     the correct consequence: the cancelled kickoff no longer blocks a fresh
 *     one to that same id.
 *
 * `COALESCE(d.lastError, '')` (nit I7): SQLite's `!=` — and `NOT IN`, which
 * D-1143 widened it to for the second member, on the identical NULL rule —
 * is NULL, not true, against a NULL `lastError` (a delivery rejected for a
 * reason that never wrote one), and NULL is FALSY in a `WHERE` — the bare
 * comparison silently dropped exactly that row out of the whole OR chain
 * instead of counting it as abandoned.
 *
 * ALSO EXCLUDES an abandoned row whose OWN run has since reached a terminal
 * state (orchestrator ruling I2, part (a) — "run close clears by
 * derivation, not mutation"): before this clause, an abandoned delivery
 * (parked at the replay ceiling, `MAIL_REPLAY_CEILING_ERROR` above) was
 * permanently outstanding — `cancelOutstandingDeliveries` only ever matches
 * `queued`/`delivered` rows, so a run's close never touches a delivery that
 * was already `rejected` for a DIFFERENT reason, and `markAcked` refused
 * every `rejected` row outright. The MailStrip row and `unreadMail` count
 * survived both acking and run close, forever. Rather than teach a writer to
 * chase this (another mutation, another race with the same close-time park
 * this file's other comments spend so many words guarding against), the
 * READ derives it: `rr.state` (via the `runs rr ON rr.id = m.runId` join each
 * caller of this fragment brings — LEFT in the read paths, INNER in
 * `requeueAbandonedMail`, and `COALESCE` below is what makes the
 * predicate indifferent to which) is checked directly,
 * and `COALESCE(rr.state, '')` — not a bare `rr.state NOT IN (...)` — is
 * deliberate: SQLite's `IN` against a NULL `rr.state` (no run named at all,
 * `m.runId IS NULL`, or a runId the `runs` table has no row for) is NULL,
 * and `NOT NULL` is NULL, not TRUE, which would silently exclude a
 * NULL-runId abandoned row instead of leaving it visible until acked —
 * exactly the outcome the ruling's own text calls out. Written entirely on the
 * READ, in SQL, and now in two composed definitions — `ABANDONED_PARK_SQL`
 * above is the abandonment half, and this constant is that half unioned with
 * `OUTSTANDING_STATES_SQL`. Neither is a writer: no park restamped, every
 * existing park-immutability guard in this file (`markDelivered`/
 * `backOff`/`rejectDelivery`'s own `NOT IN ${TERMINAL_DELIVERY_SQL}` guards)
 * unchanged.
 *
 * DELIBERATELY NOT threaded through `hasOutstandingMail` (the dedupe guard
 * on `queueSystemMail`'s own retry loop) or `dueDeliveries`/`markDelivered`/
 * `rejectDelivery`'s own `NOT IN ${TERMINAL_DELIVERY_SQL}` write-guards — this
 * predicate answers "is this worth a human's attention", a UI-facing
 * question, not "should the delivery lane act on this again", which stays
 * exactly `'rejected'`-is-terminal (bounded context 5) for every one of
 * those.
 */
const OUTSTANDING_OR_ABANDONED_SQL =
  `(d.state IN ${OUTSTANDING_STATES_SQL} OR ${ABANDONED_PARK_SQL})`;

/** The joined row shape `mailForRecipient` and `outstandingMailFor` both
 *  read — they differ only in their WHERE clause, never in these columns.
 *
 *  `d.id AS deliveryId` ALONGSIDE `m.id AS id` (blocking review finding,
 *  re-opened D-41): `m.id` (`mail.id`) and `d.id` (`mail_deliveries.id`) are
 *  two independent `AUTOINCREMENT` sequences (`schema.ts`) that only walk
 *  together while every mail resolves to exactly one delivery. Both
 *  `GET /api/mail/:id` (`deliveryEnvelope`) and `POST /api/mail/:id/ack`
 *  (`coord.delivery`) key on the DELIVERY id, and the reference-nudge
 *  protocol (`renderMailNudge`, `coord/envelope.ts`) sends a worker straight
 *  from this listing into both of those routes — without this column the
 *  only id on offer was `mail.id`, which resolves the WRONG row (or 404s)
 *  the moment one mail fans out to more than one recipient. */
const MAIL_ROW_COLUMNS =
  'm.id AS id, d.id AS deliveryId, m.at AS at, m.fromId AS fromId, d.toId AS toId, m.runId AS runId, ' +
  'm.kind AS kind, m.subject AS subject, m.artifacts AS artifacts, d.state AS state, ' +
  // Task 408: the two columns the lane has always WRITTEN and nothing ever
  // read. `state` alone cannot tell a delivery blocked against a dirty input
  // box from one merely waiting for its next attempt window.
  'd.attempts AS attempts, d.lastError AS lastError, ' +
  // D-792: WHAT refused it, and for how long. Both mail reads share this
  // one list, so the gate reaches every consumer through a single reader
  // (`hydrateMail`) rather than being added to each query in turn.
  'd.lastGate AS lastGate, d.gateCount AS gateCount, ' +
  'd.gateSince AS gateSince, d.gateAt AS gateAt';

interface MailRowDb {
  id: number; deliveryId: number; at: number; fromId: string; toId: string; runId: number | null;
  kind: string; subject: string; artifacts: string; state: string;
  attempts: number; lastError: string | null;
  lastGate: string | null; gateCount: number; gateSince: number | null; gateAt: number | null;
}

/** A route argument can never ask either mail read to walk more history (or
 *  more outstanding rows) than is reasonable to JSON-stringify into one
 *  response — the same clamp `mailForRecipient` has always applied, now
 *  shared with `outstandingMailFor`. */
const clampMailLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 100;

/** One row of `lifecycle_generations`. `retired` is a boolean here and an
 *  INTEGER in the column — the narrowing happens once, in
 *  `journalGenerations`, so no caller ever sees SQLite's 0/1. */
export interface JournalGeneration {
  gen: string; firstSeenAt: number; lastSweepAt: number;
  cursor: number; size: number; retired: boolean;
}

/**
 * One `(observed class, declared surface)` pair off a lifecycle row — the only
 * type that crosses the L1/L3 seam carrying two of the three identity
 * families, and the one place their two legitimate spellings are reconciled.
 *
 * THE WIRE/JOURNAL FIELDS ARE `obs.cg` AND `dec.surface`; the DERIVED PAIR is
 * `obsClass`/`decSurface`, matching `corroboration(obsClass, decSurface)`'s own
 * parameter names. Both spellings are correct at their own layer; this
 * docstring is what stops a later reader "fixing" either one. Likewise `id`:
 * the COLUMN is `sessionId` (because `id` is `lifecycle_events`' autoincrement
 * key) and the SQL below aliases it back.
 *
 * Both strings are RAW. Narrowing them is `corroboration`'s job and
 * `divergence.ts`'s call, and this type must not pre-empt it by claiming they
 * are members of anything.
 */
export interface ProvenancePair {
  readonly id: string;
  readonly at: number | null;
  readonly obsClass: string;
  readonly decSurface: string;
}

/** JSON text out of a column back to `unknown`, or null. Never throws: a
 *  column this process wrote can still be a column an older build wrote. */
const jsonOrNull = (s: string | null): unknown => {
  if (s === null) return null;
  try { return JSON.parse(s); } catch { return null; }
};

/** `update_intent`'s read-side fallbacks (D-3181), ONCE: the
 *  row reader and `setIntent`'s merge base both name them. */
const INTENT_AUTO_FALLBACK: AutoMode = 'off';
const INTENT_NOTIFY_FALLBACK: NotifyMode = 'channel';
/** Who `setIntent` records (spec §6 DDL: `'pwa' | 'migration'`). Its one caller
 *  is the PWA's intent route; the migration writes the other word. */
const INTENT_SET_BY = 'pwa';
const INTENT_COLUMNS_SQL = 'scope, channel, pinnedTag, auto, notify, setAt, setBy';

interface IntentRowDb {
  scope: string; channel: string; pinnedTag: string | null; auto: string; notify: string; setAt: number; setBy: string;
}

const intentOfDb = (r: IntentRowDb): UpdateIntentRow => ({
  scope: r.scope,
  channel: isUpdateChannel(r.channel) ? r.channel : null,
  pinnedTag: r.pinnedTag,
  auto: isAutoMode(r.auto) ? r.auto : INTENT_AUTO_FALLBACK,
  notify: isNotifyMode(r.notify) ? r.notify : INTENT_NOTIFY_FALLBACK,
  setAt: r.setAt,
  setBy: r.setBy,
});

/** The first named patch field whose value is outside its vocabulary, in a
 *  fixed order, or null. Reads the values as `unknown`: the route hands over
 *  parsed JSON, and `UpdateIntentPatch` is a claim about the caller, not a
 *  measurement of it. `pinnedTag: null` is a valid value (clear the pin). */
const badIntentField = (patch: UpdateIntentPatch): keyof UpdateIntentPatch | null => {
  const p: { [K in keyof UpdateIntentPatch]?: unknown } = patch;
  if (p.channel !== undefined && !isUpdateChannel(p.channel)) return 'channel';
  if (p.pinnedTag !== undefined && p.pinnedTag !== null && !isReleaseTag(p.pinnedTag)) return 'pinnedTag';
  if (p.auto !== undefined && !isAutoMode(p.auto)) return 'auto';
  if (p.notify !== undefined && !isNotifyMode(p.notify)) return 'notify';
  return null;
};

/** A journal failure inside `setIntent`'s transaction, carried OUT of `tx()` as
 *  a throw — so `tx` rolls the transaction back — and turned into a result arm
 *  at the method's edge. Module-private: nothing but `setIntent` throws or
 *  catches it, and any other error still propagates as itself. */
class IntentJournalFault extends Error {
  constructor(readonly why: 'journal-unreadable' | 'journal-unwritable', cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/**
 * Every read and every write of the coordination database, in one class, and
 * SYNCHRONOUS throughout — `DatabaseSync` has no async surface, so a whole
 * transaction runs without yielding the event loop and nothing can interleave
 * inside one. That is why there is no `KeyedQueue` here and no lock: the
 * serialisation the `KeyedQueue` gives injection (`server/src/inject/queue.ts`)
 * is already given here by the runtime.
 *
 * NO `SELECT *` ANYWHERE IN THIS FILE. Columns are named explicitly on every
 * read, which is exactly what makes "an older build ignores unknown columns"
 * (spec:78-81) true rather than aspirational.
 */
export class CoordStore {
  constructor(readonly db: DatabaseSync) {}

  // ── programs & runs ────────────────────────────────────────────────────────

  openRun(input: {
    program: string; title: string; project: string;
    wave: number; waveOf: number | null; claimedBy: string;
    /** The project whose repository holds this programme's ledger (design §3
     *  F2). Written on the programme row's FIRST insert ONLY — the `ON
     *  CONFLICT` arm below updates `title` and nothing else — so a later open
     *  can never silently re-home a programme. Backfilling a stored NULL is
     *  `setProgramHome`'s job, deliberately a second, narrower write.
     *  OPTIONAL: during the legacy generation an open carries none, and the
     *  column then stays NULL rather than taking a guess. */
    homeProject?: string;
    /** Design 2026-09-14 §5.1. Absent means `'work'` — every caller that
     *  predates review runs. `'unknown'` is refused at the route; the store
     *  writes only the two real kinds. */
    kind?: Extract<RunKind, 'work' | 'review'>;
    /** The work run a review run reads. Required by the ROUTE when
     *  `kind:'review'`; written as-is here. MUST name an existing run — the
     *  route proves it before calling (400 `reviews names no run`); the FK
     *  is enforced at runtime, so a dangling id here would throw SQLite's
     *  constraint error rather than answer in words, which is why no other
     *  caller may pass one. */
    reviews?: number | null;
    /** The project of the session in `claimedBy`, measured by the CALLER from
     *  the registry and stamped here for the run's whole life. Optional, and
     *  its absence is a real answer: an older row, or an open where the
     *  coordinator's registry record could not be read. */
    coordProject?: string;
  }): OpenRunResult {
    try {
      return tx(this.db, () => {
        // `AND claimedBy IS NOT NULL` (deviation D-12, found in Task 3 review —
        // the original query read the absolute first row regardless of whether
        // it was ever claimed): `reconstruct` inserts every rebuilt run with
        // `claimedBy` bound to NULL — it has no way to know who will resume the
        // program — so without this clause the lowest-id row of a reconstructed
        // program pinned the guard at NULL forever and a second coordinator was
        // never refused. Skipping the unclaimed rows finds the first row a real
        // `openRun` actually claimed, which is the one the refusal must read.
        const existing = this.db.prepare(
          'SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1',
        ).get(input.program) as { claimedBy: string | null } | undefined;
        // spec:291-292: multi-coordinator arbitration is a NON-GOAL. A second
        // coordinator is refused AT OPEN TIME, in words, rather than silently
        // allowed to interleave dispatches with the first one's. What this refusal
        // no longer means is "forever": `reclaimProgram` below rewrites the column
        // this reads, for a claimant measured dead. The refusal is still the only
        // answer to two LIVE coordinators — nothing arbitrates between them — and
        // that is the non-goal spec:291-292 actually names.
        if (existing?.claimedBy != null && existing.claimedBy !== input.claimedBy) {
          return { refused: 'claimed-by-another' as const, by: existing.claimedBy };
        }
        // Idempotent retry (fix — review findings 19/32): a run already open,
        // `planned`, and claimed by the SAME coordinator for this exact
        // (program, wave, waveOf) is REUSED rather than duplicated. Without
        // this, an HTTP retry after a client timeout on a successful open, or
        // after a transient `ws-hold` 501/502 on the wave N>=2 reclaim path
        // below (the row is already committed by the time that call runs),
        // minted a SECOND `planned` row pointing at the same claim — two
        // dispatchable runs for one piece of work, and (finding 32)
        // `programOpenRunCount` counting the orphan forever, wedging
        // `resolveCoordinator(null)`'s "exactly one active program" guard the
        // same way D-26/D-51 were filed to prevent. Scoped to `state =
        // 'planned'`: a run that has already dispatched, closed, or failed is
        // never a stand-in for a fresh open call naming the same wave.
        const dup = this.db.prepare(
          "SELECT CAST(id AS TEXT) AS idText, state FROM runs " +
          "WHERE program = ? AND wave = ? AND (waveOf IS ?) " +
          "AND claimedBy = ? AND state = 'planned' AND kind = ? ORDER BY id LIMIT 1",
        ).get(input.program, input.wave, input.waveOf, input.claimedBy, input.kind ?? 'work') as
          { idText: string; state: string } | undefined;
        if (dup) {
          // Read as TEXT first: node:sqlite otherwise throws while converting an
          // out-of-safe-range INTEGER, before this boundary can return its typed
          // refusal. A retry reuses the exact persisted decimal only after it is
          // proven representable in the run-id domain.
          const id = Number(dup.idText);
          const hold = isPositiveDecimalSafeInteger(id)
            ? holdReasonVerdict(input.program, input.wave, input.waveOf, id)
            : {
                ok: false as const,
                kind: 'hold-invalid' as const,
                detail: 'reused run id is not a positive safe integer',
              };
          if (!hold.ok) return hold;
          return {
            id,
            program: input.program,
            state: isRunState(dup.state) ? dup.state : 'unknown',
            holdReason: hold.reason,
          };
        }
        // Design 2026-09-14 §5.1: one review run per work run at a time. Inside
        // the transaction so two opens cannot both pass the read; AFTER the dup
        // arm so a retried open of the same planned review row stays idempotent.
        if (input.kind === 'review') {
          const inflight = this.reviewInFlightFor(input.reviews ?? -1);
          if (inflight !== null) return { refused: 'review-in-flight' as const, by: String(inflight) };
        }
        const now = Date.now();
        this.db.prepare(
          'INSERT INTO programs (slug, title, createdAt, state, homeProject) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(slug) DO UPDATE SET title = excluded.title',
        ).run(input.program, input.title, now, 'active', input.homeProject ?? null);
        const insertRun = this.db.prepare(
          'INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt, kind, reviews, coordProject) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        // Keep SQLite's exact INTEGER result until the safe-integer check below;
        // converting first can round an out-of-domain id into another number.
        insertRun.setReadBigInts(true);
        const res = insertRun.run(
          input.program, input.wave, input.waveOf, input.project, 'planned', input.claimedBy, now,
          input.kind ?? 'work', input.reviews ?? null, input.coordProject ?? null,
        );
        const exactId = res.lastInsertRowid;
        const id = Number(exactId);
        // AUTOINCREMENT's exact value is part of the serialized hold. Validate
        // only after SQLite assigns it: conversion alone does not prove the
        // bigint stayed exact in JavaScript, and the sentinel rolls both inserts
        // back on either an invalid number or an invalid complete hold.
        const hold = typeof exactId === 'bigint'
          && exactId <= BigInt(RUN_HOLD_NUMBER_MAX)
          && exactId >= 1n
          && isPositiveDecimalSafeInteger(id)
          ? holdReasonVerdict(input.program, input.wave, input.waveOf, id)
          : {
              ok: false as const,
              kind: 'hold-invalid' as const,
              detail: 'generated run id is not a positive safe integer',
            };
        if (!hold.ok) throw new OpenRunHoldRefused(hold);
        return {
          id,
          program: input.program,
          state: 'planned' as const,
          holdReason: hold.reason,
        };
      });
    } catch (err) {
      if (err instanceof OpenRunHoldRefused) return err.refusal;
      throw err;
    }
  }

  /**
   * WHICH PROJECT A REUSED SESSION BELONGS TO, measured from this store's own
   * history: the project of the FIRST run that ever named it.
   *
   * `ORDER BY id LIMIT 1` and not "the newest row", deliberately. The question
   * is which repository this session's WORKSPACE is a worktree of, and a ccd
   * workspace is created once, in one project, by the `ws-add` that minted it
   * (`dispatch.ts`'s `CCD_ARGV.wsAddWorker(run.project, …)`). No later run can
   * re-home it — the whitelisted verbs cannot re-point a workspace and will not
   * learn to (design §6) — so the earliest claim is the true one and a later
   * disagreeing row is the very defect the caller refuses.
   *
   * NULL IS AN ANSWER, NOT A FAILURE, and the caller must treat it as one: a
   * session no run has ever named is every wave-1 open that adopts an
   * operator-made workspace. Absence permits. There is no third condition here
   * to collapse — this is one indexed read of one local table
   * (`runs_by_session`, migration 2), never an I/O that can fail halfway; the
   * registry-backed rung that CAN fail lives at the dispatch resume arm and
   * answers `registry-unmeasurable` in its own words.
   */
  sessionProject(sessionId: string): string | null {
    const row = this.db.prepare(
      'SELECT project FROM runs WHERE sessionId = ? ORDER BY id LIMIT 1',
    ).get(sessionId) as { project: string } | undefined;
    return row?.project ?? null;
  }

  /**
   * Every run this session touches — as WORKER (`sessionId`) or as
   * COORDINATOR (`claimedBy`) — ANY state, ordered by id (routing spec
   * 2026-09-14 §3, routing slice 6, Task 1). This is the routing door's
   * (`routes.ts`) own read: the ladder's history ("the last unreversed
   * demotion", the same-kind count that gates `max`) is a property of the
   * SESSION, not of one run row, so the door walks the union of
   * `runEvents(r.id)` over what this method answers rather than one run's
   * trail alone. A session can be the worker of one run and the
   * coordinator of another at once — both belong in the walk, which is why
   * this is an OR, not an either/or pick.
   */
  runsTouching(sessionId: string): { id: number; sessionId: string | null; claimedBy: string | null }[] {
    return this.db.prepare(
      'SELECT id, sessionId, claimedBy FROM runs WHERE sessionId = ? OR claimedBy = ? ORDER BY id',
    ).all(sessionId, sessionId) as { id: number; sessionId: string | null; claimedBy: string | null }[];
  }

  /**
   * The whole reclaim commit, as ONE transaction — `dispatchRun`/`closeRun`'s
   * shape (D-277's argument applied to a batch instead of a sequence). It is
   * ONE `tx()` and it calls no public method that opens its own:
   * `DatabaseSync` transactions do not nest, the rule `advanceInner`'s
   * docstring (:514-520) states in full. `recordRunEvent` is safe here for the
   * same reason `cancelOutstandingDeliveries` is safe inside `closeRun` — it
   * holds no `tx()`.
   *
   * EVERY RUN OF THE PROGRAM IS REWRITTEN, TERMINAL ONES INCLUDED (operator
   * ruling R1, D-1123). Both readers of this column — `openRun`'s
   * one-coordinator guard (:381-383) and `resolveCoordinator(null)`
   * (:1282-1284) — run the identical
   * `SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL
   * ORDER BY id LIMIT 1`, with NO state predicate and lowest id first. On a
   * program standing at wave 5 the lowest claimed id IS wave 1's closed run, so
   * a rewrite scoped to non-terminal runs leaves both readers answering the dead
   * session and the wedge outlives the door built to clear it. Terminality is
   * about what may still HAPPEN to a run; this column is about who is driving
   * the program, and those are not the same question.
   *
   * SO THIS `WHERE` CARRIES NO STATE PREDICATE AT ALL, and the omission is a
   * decision rather than an oversight (D-1135): this file used to hold two
   * disagreeing answers to "terminal" — a private derivation from
   * `RUN_TRANSITIONS` that yielded three words, while eight SQL predicates
   * here hand-wrote two — and a method that needed the word would have had to
   * pick one. Since design 2026-09-14 §7.1 (D-2794) `TERMINAL_RUN_STATES` is
   * L0's own pair (`shared/api.ts`), imported rather than derived, and it
   * agrees with the hand-written predicates by construction. Ruling R1 means
   * this method still carries no state predicate at all, so it does not
   * inherit whatever `TERMINAL_RUN_STATES` names.
   *
   * A row whose `claimedBy` IS NULL STAYS NULL. `reconstruct` mints rebuilt runs
   * that way because it cannot know who will resume the program, and D-12's
   * clause exists to skip them; writing a claimant into one here would hand the
   * guard a row it was deliberately taught to ignore.
   *
   * `causedBy` is the literal `operator`, hardcoded at this one call site and
   * never read from a request body. Attribution, not authentication
   * (spec:26-30) — and on an operator door that carries no box token, a
   * body-supplied `causedBy` is a free-text field writing the audit trail.
   *
   * THE MAIL MOVES WITH THE CHAIR, IN THIS SAME TRANSACTION (D-1141/D-1143,
   * blocking review MAJOR 1 and MINOR 9). Until this round the reclaim rewrote
   * `runs.claimedBy` and NOTHING else, and `mail_deliveries.toId` is frozen to
   * the RESOLVED id at queue time — `coord/routes.ts` resolves `coordinator` once
   * through `resolveCoordinator` and hands the answer to `queueDelivery`, which
   * is the only writer of that column in the tree. `GET /api/mail` is
   * recipient-scoped. So a wave-done the worker sent minutes before the reclaim
   * stayed addressed to the corpse while `resolveCoordinator(runId)` answered the
   * heir: the heir's box read empty, the sweep walked the report to
   * `rejected('undeliverable')`, and the wave's own report was lost — with the
   * coordinator corpus (`ccd/coordinator-skill/references/resume.md`) sending the
   * heir to that empty box in as many words, "read outstanding mail before
   * deciding anything".
   *
   * `mail.toId` DECIDES, because it already records the addressing. It keeps the
   * PRE-resolution recipient — the literal role `coordinator`, or a literal
   * session id — beside `mail_deliveries.toId`'s resolved answer, which is
   * exactly the distinction this fix turns on and the reason no new column is
   * needed for it:
   *   (a) role-addressed (`mail.toId = 'coordinator'`), naming a run of THIS
   *       program, still outstanding, addressed to a displaced claimant ->
   *       REPOINTED. Mail sent to a ROLE follows the role.
   *   (b) addressed to a literal session id -> LEFT. It was sent to a session,
   *       not to a chair, and the session is the same session it always was.
   *   (c) already `acked` or otherwise terminal -> NEVER MOVED. That is
   *       `OUTSTANDING_STATES_SQL`, the constant, not a fourth hand-written pair
   *       of words.
   *   (d) role-addressed with `mail.runId` NULL -> LEFT. See D-1142 on
   *       `repointCoordinatorMail` below: it cannot be PROVEN to be this
   *       program's, and the fold is recorded rather than opened.
   *   (e) role-addressed, naming a run of THIS program, ABANDONED against a
   *       displaced claimant — a park this lane GAVE UP on, never a deliberate
   *       cancel, on a run that is not itself terminal -> the heir is queued a
   *       NEW delivery for the same `mail` row. Arm (c) stands exactly as
   *       written and is not weakened by this: the parked row is not moved and
   *       not reopened. What the heir gets is a SECOND delivery of one mail,
   *       which is what two delivery attempts to two recipients have always
   *       looked like in this schema — `mail` and `mail_deliveries` are separate
   *       tables for exactly that reason. The set is not hand-written here
   *       either: it is `ABANDONED_PARK_SQL`, the same predicate
   *       `outstandingMailFor(<corpse>)` uses to decide a park still needs a
   *       human, so "what the heir inherits" and "what the corpse's box was
   *       showing" cannot drift apart. (D-1425,
   *       `requeueAbandonedMail` below.)
   * …and, in the opposite direction, an outstanding `program-kickoff` to a
   * displaced claimant is CANCELLED rather than repointed (D-1143,
   * `cancelKickoffsTo`): a re-kickoff queued minutes before a reclaim would
   * otherwise still brief the session the reclaim just displaced, which is two
   * coordinators — the exact state the skill's clause 8 exists to prevent.
   *
   * THE COUNTERS ARE NOT TOUCHED, measured rather than assumed. A repointed row
   * keeps its `attempts`, its `nextAttemptAt` and its gate columns, all of them
   * accumulated against the corpse. That reads wrong and is not: `attempts` only
   * ever ratchets on a SEND FAILURE or a provably-dead recipient (`watch.ts`'s
   * two dead rungs) — every gate (`not-idle`, `not-quiet`, `pending-ask`,
   * cooldown) `continue`s without touching it — so against a LIVE heir the very
   * next due sweep delivers and the ratchet stops. The whole cost is one backoff
   * step of delay, at most `MAIL_BACKOFF_BASE_MS * 2^4` = 8 minutes, and the
   * benefit of resetting them would be to erase the row's own record of what
   * already happened to it. What DOES bound this fix is arm (c) and it is worth
   * knowing: `MAIL_MAX_ATTEMPTS` is 6 on a 30 s doubling, so a never-delivered
   * mail to a provably-dead coordinator parks itself `undeliverable` about
   * fifteen and a half minutes after it was queued. Past that window there is
   * nothing outstanding left to repoint and the report stays on the corpse,
   * visible to `outstandingMailFor(<corpse>)` and to nobody else — and that is
   * now arm (e)'s half of the job rather than a hole:
   * `requeueAbandonedMail` queues the heir a NEW delivery for exactly
   * the parks that mailbox was showing. Reopening the parked row is still a
   * decision this store does not make. The row stays `rejected`, and the reason
   * it parked stays readable on it.
   *
   * THE ENVELOPE IS NOT RE-RENDERED, deliberately (D-1142). `renderEnvelope`
   * runs exactly ONCE, at queue time (spec:174-177, "verbatim, never
   * re-rendered"; `setDeliveryEnvelope`'s own docstring calls itself the second
   * half of that one INSERT and not a second render). A repointed delivery
   * therefore still carries a `to:` line naming the OUTGOING id, and that is
   * accepted rather than papered over: it is a TRUE record of who held the chair
   * when the message was queued, the `ack:` line names the DELIVERY id — which
   * this statement does not change — and the nudge the lane actually types is
   * `renderMailNudge(d.toId)`, a function of the row's CURRENT recipient, so the
   * heir is nudged correctly and finds the stale `to:` only inside the body it
   * fetches. Re-rendering it here would trade a true historical line for a
   * violation of the one rule the mail body has.
   */
  reclaimProgram(runId: number, to: string, at: number, coordProject: string | null): ReclaimProgramResult {
    return tx(this.db, () => {
      const run = this.db.prepare('SELECT program, claimedBy FROM runs WHERE id = ?')
        .get(runId) as { program: string; claimedBy: string | null } | undefined;
      if (!run) return { ok: false as const, kind: 'unknown-run' as const };
      // Refused BEFORE the UPDATE, so a refusal writes nothing at all: an
      // unclaimed run names no handover to make, and rewriting its siblings off a
      // row that never had a claimant is a reassignment nobody asked for.
      if (run.claimedBy === null) return { ok: false as const, kind: 'no-claimant' as const };
      // Read before the write, and excluding rows ALREADY naming `to`: the
      // attribution rows record a CHANGE, so re-running the same reclaim writes
      // none rather than a second identical trail. `ORDER BY id` so `runIds` is
      // the same list twice — the query planner may reach these rows through
      // `runs_by_program` (schema.ts:88) rather than by rowid.
      const moved = this.db.prepare(
        'SELECT id, claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ' +
        'AND claimedBy != ? ORDER BY id',
      ).all(run.program, to) as { id: number; claimedBy: string }[];
      // D-2922: `claimedBy` and `coordProject` move TOGETHER, under one WHERE.
      // They are two facts about the same coordinator — who holds the chair,
      // and which card that chair's workers render on — and rewriting only the
      // first left every row of the program boarding on the coordinator this
      // statement had just displaced, until wave N+1 opened (days, on a real
      // programme). Spec section 7 rules this move CORRECT: "Reclaim moves
      // every worker of a programme at once, because the programme genuinely
      // has a new coordinator."
      //
      // NOT a contradiction of section 4's "stamped at open time, never
      // re-derived from a live read of the coordinator's registry record":
      // that rule forbids re-deriving a placement on every READ, so a worker
      // keeps its card when its coordinator dies. This writes at the other
      // moment the coordinator is DECIDED. The stamp still never chases a
      // live record.
      //
      // `coordProject` is the caller's MEASUREMENT or null — the store does not
      // read the registry and does not guess. Null over the displaced
      // coordinator's project is deliberate: a null stamp places the row at
      // home (`boardPlacement`'s own contract), while the stale value would
      // have the board assert a coordinator this very statement retired.
      this.db.prepare('UPDATE runs SET claimedBy = ?, coordProject = ? WHERE program = ? AND claimedBy IS NOT NULL')
        .run(to, coordProject, run.program);
      for (const m of moved) {
        // One `at` for N rows (D-1134): the operator acted once, and a trail that
        // reads five clock samples describes five acts.
        this.recordRunEvent(m.id, 'operator', `reclaim:${m.claimedBy} -> ${to}`, at);
      }
      // EVERY id THIS RECLAIM DISPLACED, not just `run.claimedBy`. The result's
      // `from` names one row's claimant; `moved` is the set the UPDATE above
      // actually rewrote, and on a program whose rows somehow disagree (a
      // hand-recovered row, a `reconstruct` a human finished by hand) that set
      // has more than one member. The runs half already rewrites all of them —
      // the mail half addressed to only one of them would leave the others'
      // reports on corpses the same rewrite just declared displaced. `to` is
      // never in this set: the `claimedBy != ?` selection above excludes it.
      const displaced = [...new Set(moved.map((m) => m.claimedBy))];
      if (displaced.length > 0) {
        this.cancelKickoffsTo(displaced);
        this.repointCoordinatorMail(run.program, to, displaced);
        // LAST, and the position is LOAD-BEARING — but not for `cancelKickoffsTo`'s
        // reason above, which is about a narrowing statement running before a
        // widening one and does not apply here. This statement's `NOT EXISTS`
        // clause reads `mail_deliveries` as the two above left it, so a mail the
        // repoint just moved to `to` is SEEN and skipped. Run first, that row
        // would still name the corpse, the guard would miss it, and the heir
        // would be handed two copies of one report.
        this.requeueAbandonedMail({ role: 'coordinator', program: run.program }, to, displaced);
      }
      return {
        ok: true as const, program: run.program,
        runIds: moved.map((m) => m.id), from: run.claimedBy,
      };
    });
  }

  /**
   * D-1143 (blocking review MINOR 9) — the reclaim's OPPOSITE verb, and the
   * reason it is a second statement rather than a widening of the repoint below.
   *
   * `queueProgramKickoff` addresses the kickoff to a LITERAL session id with
   * `runId: null` (`coord/kickoff.ts`: "It names NO run, because there is none"),
   * so the repoint's own `mail.toId = 'coordinator'` filter already declines it —
   * arm (b). Left at that, a re-kickoff queued minutes before a reclaim goes on
   * briefing the session the reclaim just displaced: two sessions each told they
   * coordinate this program, which is precisely the state
   * `ccd/coordinator-skill/SKILL.md`'s clause 8 exists to prevent. A kickoff is
   * not a report that needs a new reader; it is an INSTRUCTION to take a chair
   * that has just been given to somebody else, and the only honest thing to do
   * with it is to end it.
   *
   * THE PARK IS `cancelOutstandingDeliveries`'s, precedent for precedent:
   * `rejected` + `undeliverable` + a `lastError` of its own
   * (`MAIL_RECLAIM_CANCELLED_ERROR`, excluded from the read-side "needs
   * attention" predicate by `DELIBERATE_CANCEL_ERRORS_SQL` — see that constant
   * and `OUTSTANDING_OR_ABANDONED_SQL`'s own docstring for the reader-by-reader
   * measurement). Not a DELETE: nothing in this tree deletes from
   * `mail_deliveries` ("bound the producer, never the record").
   *
   * THE KEY IS `queueProgramKickoff`'S DEDUPE KEY, three quarters of it: the same
   * `(fromId, runId, subject)` triple `hasOutstandingMail` reads, with `toId`
   * bound to each displaced claimant instead of to one recipient. Written that
   * way on purpose and not as `subject = ?` alone — peer `subject` is
   * caller-chosen free text (D-1041's own finding), so a peer mail that happened
   * to carry this subject would otherwise be parked by an act that has nothing to
   * do with it. The pleasant consequence of matching the key exactly: once these
   * rows are terminal the dedupe slot is free, so a fresh kickoff to that same id
   * is no longer swallowed by the one this cancelled.
   *
   * IT RUNS BEFORE THE REPOINT, and the order is a deliberate choice about
   * MEASURABILITY rather than about behaviour. The two statements are disjoint by
   * construction — this one matches only `mail.runId IS NULL`, the repoint only
   * rows that JOIN a `runs` row — so on correct code the order cannot change the
   * outcome. On INCORRECT code it can: an over-broad cancel running first
   * swallows the row the repoint was supposed to move, and the repoint's own
   * `state IN` guard then leaves it visibly parked. Run second, the same
   * over-broad cancel would find that row already repointed to `to` (never a
   * member of `displaced`) and quietly miss it — a mutation that cannot go red.
   * Narrowing statement first, so a widened one is caught by the suite instead of
   * by a program.
   */
  private cancelKickoffsTo(displaced: readonly string[]): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable', " +
      `lastError = '${MAIL_RECLAIM_CANCELLED_ERROR}' ` +
      `WHERE state IN ${OUTSTANDING_STATES_SQL} AND toId IN (${placeholders(displaced.length)}) ` +
      'AND mailId IN (SELECT id FROM mail WHERE runId IS NULL AND fromId = ? AND subject = ?)',
    ).run(...displaced, 'operator', PROGRAM_KICKOFF_SUBJECT);
  }

  /**
   * D-1141 (blocking review MAJOR 1) — role-addressed mail follows the role.
   *
   * Every arm of the ruling is one clause of this one statement, and none of them
   * is a branch in TypeScript:
   *   `state IN OUTSTANDING_STATES_SQL` is arm (c) — an `acked` delivery, or one
   *     already parked by any writer, is never moved. The CONSTANT, so this query
   *     agrees with `cancelOutstandingDeliveries`, `hasOutstandingMail` and the
   *     read-side predicate by construction rather than by four texts matching.
   *   `d.toId IN (<displaced>)` scopes it to the ids this reclaim actually took
   *     the chair from — never a delivery already addressed to `to`, and never
   *     one addressed to a third session that has nothing to do with this act.
   *   `m.toId = 'coordinator'` is arm (b), and it is the whole reason no new
   *     column is needed: `mail.toId` keeps the PRE-resolution addressing while
   *     `mail_deliveries.toId` carries the resolved answer, so "sent to the
   *     chair" and "sent to that session" are already two distinguishable facts
   *     in this schema.
   *   `JOIN runs r ON r.id = m.runId` scopes it to THIS program — and, being an
   *     inner join, drops every `m.runId IS NULL` row on the way, which is arm
   *     (d) falling out of the SQL rather than needing a branch of its own.
   *
   * D-1142 — THE `runId IS NULL` FOLD, RECORDED AND DELIBERATELY LEFT CLOSED,
   * beside D-1132's own entry in this wave (`coord-kickoff.test.ts`'s
   * `THE FOLD (D-1132)` and the plan's ledger) and for the same shape of reason.
   * A mail addressed to the ROLE with no run named IS reachable: `POST /api/mail`
   * accepts `{toId:'coordinator', runId:null}` and resolves it through
   * `resolveCoordinator(null)`, the single-active-program arm. Once queued,
   * nothing about that row records WHICH program the sender meant — the
   * resolution is spent, `mail.runId` is NULL, and `resolveCoordinator(null)`'s
   * own answer is a function of the fleet's state at the moment it ran, not a
   * fact stored anywhere. Measured: no column, no join and no read in this store
   * can recover it. So repointing such a row would be this method GUESSING that a
   * message with no program on it belonged to the program being reclaimed, on a
   * door whose entire discipline is refusing to guess (`resolveCoordinator`'s own
   * "no guessing", `measureClaimant`'s "doubt is not evidence"). It stays on the
   * outgoing claimant, outstanding and visible at `outstandingMailFor(<that
   * id>)` — the honest outcome, since the party that can tell which program it
   * meant is the human reading it. Recorded here rather than opened; an operator
   * door that re-points one by id is a decision somebody makes on purpose.
   */
  private repointCoordinatorMail(program: string, to: string, displaced: readonly string[]): void {
    this.db.prepare(
      `UPDATE mail_deliveries SET toId = ? WHERE state IN ${OUTSTANDING_STATES_SQL} ` +
      `AND toId IN (${placeholders(displaced.length)}) AND mailId IN (` +
      'SELECT m.id FROM mail m JOIN runs r ON r.id = m.runId ' +
      "WHERE m.toId = 'coordinator' AND r.program = ?)",
    ).run(to, ...displaced, program);
  }

  /**
   * D-1425 — the arm (a) could not reach. A role-addressed report the
   * lane had ALREADY GIVEN UP on is delivered to the heir as a NEW row.
   *
   * WHY A SECOND DELIVERY AND NOT AN UN-PARK. Un-parking is one statement and
   * three problems. It would be the first writer in this tree to return a
   * terminal row to a NON-TERMINAL state — not the first to reopen a terminal
   * row, which `markAcked` below already does for one park, and the broader
   * sentence would itself be a false claim. It would force a ruling on
   * `deliveredAt` that has no true answer: `sweepMail` branches on it (the
   * replay bump and the session-dead rung both read it), so keeping the corpse's
   * value counts the HEIR's first receipt as a replay, and nulling it denies a
   * delivery that happened — one column carrying two conditions a consumer
   * handles differently. And it would falsify arm (c) here, the bound paragraph
   * above, and `ccd/coordinator-skill/references/mail-envelope.md`'s "the park
   * is terminal for that delivery". A new row makes every one of those sentences
   * stay true, and its zeroed counters are TRUE OF IT rather than reset.
   *
   * NOT A RE-RENDER OF A REPLAY. spec:176-177 is "Until acked, the delivery
   * replays — verbatim, never re-rendered". That binds a DELIVERY replaying;
   * this is a second delivery, so it renders its own envelope, naming the heir
   * in `to:` and its own id in `ack:` — the `queueDelivery(…, '') ->
   * renderEnvelope(delivery.id) -> setDeliveryEnvelope` pair `routes.ts` and
   * `rundefs.ts` already use, for the same reason (the delivery id does not
   * exist until the row does).
   *
   * THE PREDICATE IS NOT HAND-WRITTEN. `ABANDONED_PARK_SQL` is the mailbox's own
   * "this park still needs a human" clause, so the deliberate-cancel parks (a
   * run closing, a chair changing hands) and the parks whose own run has since
   * finished are excluded BY THE CONSTANT rather than by three more words here.
   * The rest are the repoint's clauses, unchanged in meaning: `d.toId IN
   * (<displaced>)` (never `to`, never a bystander), `m.toId = 'coordinator'`
   * (arm (b)), the INNER join to `runs` (arm (d) — every `m.runId IS NULL` row
   * drops out on the way), and `rr.program = ?`.
   *
   * TWO CLAUSES ARE THIS METHOD'S OWN, and they exist because this is the FIRST
   * writer in the tree to give one `mail` row a second delivery. Nothing else
   * ever did — `queueDelivery` has exactly two other call sites and each follows
   * an `insertMail` — and `mail_deliveries` carries no unique key on
   * `(mailId, toId)` to fall back on (`schema.ts`: the one index is
   * `mail_deliveries_due`). So:
   *   `GROUP BY m.id` — a program whose rows disagree about the claimant (the
   *     hand-recovered row the caller's own comment describes) puts TWO
   *     displaced ids in `displaced`, and one mail parked against both would
   *     otherwise be queued to the heir twice. SQLite's bare-column rule makes
   *     the selected `m.*`/`rr.*` values well defined here: `m.id` is the
   *     grouping key and `rr` joins it one-to-one on `m.runId`.
   *   `NOT EXISTS (… x.toId = ? AND x.state IN OUTSTANDING_STATES_SQL)` — the
   *     heir may ALREADY be able to read this message, most often because
   *     `repointCoordinatorMail` handed it to them one statement ago. This is
   *     why this call is last: run before the repoint, the guard would look at a
   *     row still naming the corpse and mint a duplicate.
   *   `ORDER BY MIN(d.id)` is NOT a third dedupe clause, and it is deliberately
   *     NOT pinned. SQLite promises no row order for a `GROUP BY`, and this loop
   *     mints one delivery id per row it walks, so without it the heir's new ids
   *     would come back in whatever order the planner chose. No test can red on
   *     its removal, because on REACHABLE state there is nothing to observe:
   *     `insertMail` and `queueDelivery` are adjacent at every call site in this
   *     tree, so `m.id` order and `MIN(d.id)` order are the same order, and a
   *     fixture that pulled them apart would exist only to be ordered. Said out
   *     loud rather than guarded by a test that would be green either way.
   *
   * THE READERS OF BOTH PREDICATES WERE WALKED, as `OUTSTANDING_OR_ABANDONED_SQL`'s
   * own docstring does for D-1143 — and the walk is DERIVED, not typed.
   * `single-definition.test.ts`'s "the re-queue's reader walk names every holder
   * the file actually has" scans this file for both interpolations, maps each hit
   * to the declaration it sits in, and reds if any name is missing from the list
   * below: the same move as the two cases beside it, one level up from a
   * duplicated VALUE to a duplicated CLAIM. It is derived because the hand-typed
   * first version was WRONG (D-1426) — it claimed "all four", named a reader on
   * the narrow side (`dueDeliveries`) that does not use the constant at all, and
   * omitted `runHealth`, which is the single reader whose OUTPUT this arm moves.
   *
   * On the composed `OUTSTANDING_OR_ABANDONED_SQL` — four readers:
   *   `outstandingMailFor(<heir>)` — the point. Reached from `GET /api/mail?to=`
   *     and from `sessionws.ts`'s `checkMail`, so the heir's live socket shows
   *     it with no wire change.
   *   `unreadMailCount(runId, sessionId)` — NOT reached, and not by luck:
   *     `hydrateRun` calls it with `row.sessionId`, the run's WORKER, never with
   *     `claimedBy`. A delivery to the heir CHAIR therefore leaves
   *     `RunSummary.unreadMail` — the badge the MailStrip renders — exactly
   *     where it was. Measured by "the re-queue leaves the wave unread badge
   *     alone" in `coord-store.test.ts`.
   *   `runHealth`'s coordinator-kickoff-wedge query — unreachable: it is
   *     `m.runId IS NULL`-scoped, and every row this method inserts belongs to a
   *     mail that survived an INNER join on `m.runId`. (The hand-typed version
   *     put this query in `healthFor`, which only CALLS `runHealth`.)
   *   `mailForProgram(<program>)` (cross-repo programmes wave 1, Task 7) — a
   *     NEW holder, joining `m.runId` to `runs rr` INNER rather than LEFT, so
   *     `OUTSTANDING_OR_ABANDONED_SQL`'s `COALESCE(rr.state, '')` reads a
   *     non-NULL state on every row it can select. It is `GET
   *     /api/mail?program=`'s default, non-`all`, arm.
   *
   * On the narrower `OUTSTANDING_STATES_SQL` — eleven holders, in file order:
   *   `OUTSTANDING_OR_ABANDONED_SQL`'s own definition — the composed constant,
   *     no reader of its own.
   *   `cancelKickoffsTo` and `repointCoordinatorMail` — both run BEFORE this
   *     method inside the one `reclaimProgram` transaction, so neither can see a
   *     row it inserted; that ordering is argued above and at each of their own
   *     definitions. A LATER reclaim is the reachable case, and both stay right:
   *     the cancel matches `mail.runId IS NULL` kickoffs only and every row here
   *     has a run, and the repoint moving a still-outstanding re-queued row on
   *     to the NEXT heir is arm (a) doing exactly its job.
   *   `requeueAbandonedMail` — this method's own `NOT EXISTS` dedupe, above,
   *     and its `source` ternary's worker branch: two interpolations inside
   *     this same method body, so the derived scan still reports ONE holder
   *     for it, not two.
   *   `parkSupersededDeliveries` — the worker arm's park, split into its own
   *     single-line-signature method (D-2338; see `requeueAbandonedMail`'s
   *     call site) rather than inlined, and therefore a THIRD, separate
   *     holder: its own `WHERE state IN` guards exactly which outstanding
   *     rows the predecessor loses. This whole bullet, and the tenth holder
   *     counted above, is itself a consequence of D-2338 — the brief's own
   *     verbatim replacement text for this docstring (Step 7) named nine and
   *     said nothing about this method, because it assumed the inline shape.
   *   `cancelOutstandingDeliveries` — reached, and correctly. A new row belongs
   *     to a mail with a run, so when that run closes the row is parked like any
   *     other outstanding delivery, with `MAIL_RUN_CLOSED_ERROR` — a DELIBERATE
   *     cancel, which `ABANDONED_PARK_SQL` excludes, so it cannot come back
   *     round through this arm on a later reclaim.
   *   `cancelDeliveriesTo` (child reclamation, wave 3) — reached only if an
   *     operator named a CHILD workspace as the heir chair, and correct then
   *     too: it runs after that child has been reclaimed, so the re-queued row
   *     is parked like every other delivery to it, with
   *     `MAIL_CHILD_RECLAIMED_ERROR` — a DELIBERATE cancel, which
   *     `ABANDONED_PARK_SQL` excludes, so it cannot come back round through
   *     this arm either.
   *   `runHealth`'s outstanding-vs-parked count — THE ONE READER WHOSE OUTPUT
   *     THIS ARM CHANGES, and the one the hand-typed walk omitted. Both halves
   *     of that query are per-DELIVERY, exactly as `RunHealth.mailOutstanding`
   *     and `mailParked` are documented (`shared/api.ts`), so for a single
   *     re-queued report the run's `mailOutstanding` goes 0 -> 1 while
   *     `mailParked` stays 1, and `pwa/src/fleet/runWords.ts` renders
   *     "1 parked ... (1 still outstanding)" about ONE message. Nothing here is
   *     wrong: the park is still a park, the new delivery is still outstanding,
   *     each field says what it is documented to say, and the outstanding half
   *     clears on the heir's ack. It is written down because the sentence an
   *     operator READS counts one message twice, and a walk that skipped this
   *     reader would have shipped that surprise unannounced.
   *   `hasOutstandingMail` — its slot cannot be swallowed, but NOT for the
   *     reason this walk first gave. That version said the slot is "keyed by
   *     SENDER" and then argued from `queueSystemMail`'s ADDRESSEE ("no call
   *     site addressing the ROLE") — two different axes, so a true premise sat
   *     under a conclusion it did not carry. The key is
   *     `(m.fromId, m.runId, d.toId, m.subject)`; `m.toId`, the column THIS
   *     query selects on, is not in it at all. What protects the slot is that a
   *     re-queued row is the opposite of a system mail on BOTH keyed axes.
   *     RECIPIENT: `queueSystemMail`'s four call sites (`dispatch.ts:783`,
   *     `close.ts:261`, `routes.ts:1554`, `kickoff.ts:157` — re-measured; the
   *     census is the FOUR, and the line numbers drift with every edit above
   *     them) each pass a WORKER
   *     session id — `run.sessionId`, or the id the kickoff route was given —
   *     never the chair, while `d.toId` here is `to`, the heir CHAIR. SENDER:
   *     the probe's `fromId` is a `SystemMailSender`, the role pair, whereas
   *     every row this method can select arrived through `POST /api/mail`, which
   *     refuses a `fromId` with no registry row (`routes.ts:543-558`) — so
   *     `m.fromId` on it is a session id. The SENDER axis is the load-bearing
   *     one: `to` is operator-typed free text (`POST /api/runs/:id/reclaim`
   *     reads `claimedBy` off the body), so nothing structurally stops an
   *     operator naming a run's own worker as the heir, and the recipient axis
   *     alone would then be resting on `m.subject` happening to differ.
   *   `hasOutstandingPeerDuplicate` and `outstandingPeerCount` are
   *     `m.runId IS NULL`-scoped and therefore unreachable too.
   *
   * BOUNDED by the role-addressed reports of ONE program that parked while its
   * coordinator was dead, at most one new row per `mail` row, and deliberately
   * NOT capped beyond that: a cap here would drop mail silently, which is the
   * failure this method exists to end.
   */
  // THIS SIGNATURE IS MULTI-LINE, AND THAT IS A DECLARED EXEMPTION, NOT AN
  // OVERSIGHT. Task 24 requires delivery-row WRITERS to keep their signature on
  // one line, because Task 26's writer census walks back from each prepared
  // statement to the nearest single-line signature and a wrapped one silently
  // mis-attributes. This method is not such a writer: it prepares a SELECT and
  // reaches the delivery rows only through `queueDelivery` and
  // `setDeliveryEnvelope`, each of which carries its own one-line signature and
  // is named by the census in its own right. The exemption is stated rather
  // than relied on: `mail-hardening.test.ts` — Task 26's census, which landed
  // earlier in this wave — is re-run AFTER this method exists, so if the walk
  // ever does reach back past this signature, it reds here rather than in the
  // field.
  /**
   * PARAMETERISED BY ROLE (design 2026-09-08 §4), and the role varies FOUR
   * things, which is more than the spec's "one method, parameterised by role"
   * suggests and is what its own two sentences require:
   *   `m.toId` — the literal the mail was addressed to.
   *   the SCOPE clause — `rr.program = ?` for a chair, `m.runId = ?` for a
   *     worker. A chair belongs to a programme; a worker belongs to one run.
   *   the SOURCE predicate — `ABANDONED_PARK_SQL` for the coordinator (arm (e)
   *     of `reclaimProgram`'s ruling: the parks the lane had already given up
   *     on, because `repointCoordinatorMail` has already moved the outstanding
   *     ones), and `OUTSTANDING_STATES_SQL` for the worker (there is no
   *     repoint on that path, so the outstanding rows are exactly what a
   *     replacement must inherit).
   *   whether the predecessor's row is PARKED — no for the coordinator, whose
   *     source rows are already terminal and stay exactly as they are; yes for
   *     the worker, because an outstanding row left naming the predecessor
   *     would have the sweep go on injecting a superseded message.
   * The name still says "Abandoned", which is true of the coordinator arm only.
   */
  private requeueAbandonedMail(
    role: RequeueRole, to: string, displaced: readonly string[],
  ): number {
    const source = role.role === 'coordinator'
      ? ABANDONED_PARK_SQL : `d.state IN ${OUTSTANDING_STATES_SQL}`;
    const scope = role.role === 'coordinator' ? 'rr.program = ?' : 'm.runId = ?';
    const scopeArg: string | number = role.role === 'coordinator' ? role.program : role.runId;
    const rows = this.db.prepare(
      'SELECT m.id AS mailId, m.fromId AS fromId, m.kind AS kind, m.subject AS subject, ' +
      'm.body AS body, m.artifacts AS artifacts, m.runId AS runId, ' +
      'rr.program AS program, rr.wave AS wave, rr.waveOf AS waveOf ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
      'JOIN runs rr ON rr.id = m.runId ' +
      `WHERE ${source} AND d.toId IN (${placeholders(displaced.length)}) ` +
      `AND m.toId = '${role.role}' AND ${scope} ` +
      'AND NOT EXISTS (SELECT 1 FROM mail_deliveries x ' +
      `WHERE x.mailId = m.id AND x.toId = ? AND x.state IN ${OUTSTANDING_STATES_SQL}) ` +
      'GROUP BY m.id ORDER BY MIN(d.id)',
    ).all(...displaced, scopeArg, to) as {
      mailId: number; fromId: string; kind: string; subject: string; body: string;
      artifacts: string; runId: number; program: string; wave: number; waveOf: number | null;
    }[];
    for (const r of rows) {
      const delivery = this.queueDelivery(r.mailId, to, '');
      // THE RESULT IS READ, NOT DROPPED. Task 24 gave `setDeliveryEnvelope` a
      // `SetEnvelopeResult` precisely because "a writer whose safety rests on its
      // two callers' shape breaks silently the day a third one appears" — this IS
      // that third caller, and TypeScript does not complain about a discarded
      // return, so dropping it here would re-mint the defect one task after it was
      // fixed. Same handling as the other two: unstampable is a bug, not a state.
      const stamped = this.setDeliveryEnvelope(delivery.id, renderEnvelope({
        id: delivery.id, fromId: r.fromId, toId: to, runId: r.runId,
        program: r.program, wave: r.wave, waveOf: r.waveOf,
        // Narrowed the way `hydrateMail` narrows it, not cast: `kind` is a
        // CLOSED union and `'unknown'` is a real member. The branch is dead in
        // practice (`insertMail`'s parameter is already `MailKind`), and a cast
        // would have been this method quietly asserting what it did not check.
        kind: isMailKind(r.kind) ? r.kind : 'unknown',
        subject: r.subject, body: r.body,
        artifacts: JSON.parse(r.artifacts) as string[],
      }));
      if (!stamped.ok) {
        throw new Error(`delivery ${delivery.id} unstampable: ${stamped.why}`);
      }
    }
    // THE PREDECESSOR'S ROWS, PARKED — worker only. The coordinator arm's
    // source rows are already terminal (`ABANDONED_PARK_SQL`), and arm (c) of
    // `reclaimProgram`'s ruling says a park is never moved or reopened; this
    // arm's source rows are OUTSTANDING, and one left naming the predecessor
    // would have `sweepMail` go on injecting a message the heir has already
    // been sent a fresh copy of. Scoped to the mails this call actually
    // re-issued, so a row it declined to move (the `NOT EXISTS` dedupe) is not
    // parked by a statement that did nothing for it. Split into its own
    // single-line-signature method (below) rather than inlined here — a
    // departure from the brief's own text, which put this `UPDATE` inline;
    // recorded as **D-2338**, because D-1425 (above) and D-2059 (below) argue
    // the SQL and the role-generalisation, not this method's existence: this
    // method's own signature is a DECLARED multi-line exemption on the
    // premise that it reaches delivery rows only through `queueDelivery` and
    // `setDeliveryEnvelope` — an `UPDATE mail_deliveries` inlined here would
    // have Task 26's writer census walk back past this multi-line signature
    // and mis-attribute the write to whatever method happens to sit above it
    // in the file, exactly the failure the exemption comment above warns
    // about. Measured: it does, `mail-hardening.test.ts`'s "crossed a method
    // close" the moment this statement is inlined.
    if (role.role === 'worker' && rows.length > 0) {
      this.parkSupersededDeliveries(displaced, rows.map((r) => r.mailId));
    }
    return rows.length;
  }

  /** `requeueAbandonedMail`'s worker-arm park, split out so it carries its OWN
   *  single-line signature (Task 24's rule for delivery-row writers) — see the
   *  comment at its one call site above for why inlining it there is unsafe.
   *  This EXTRACTION itself is **D-2338** — Task 6's brief put this `UPDATE`
   *  inline in `requeueAbandonedMail`'s own body; the split is a departure
   *  from that verbatim text, not from anything the plan's D-2059 decided.
   *  `mailIds` is always `rows.map(r => r.mailId)` from that call's own
   *  re-queue, so a row the `NOT EXISTS` dedupe declined to move is never
   *  reached by this statement either. */
  private parkSupersededDeliveries(displaced: readonly string[], mailIds: readonly number[]): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable', " +
      `lastError = '${MAIL_REBIND_SUPERSEDED_ERROR}' ` +
      `WHERE state IN ${OUTSTANDING_STATES_SQL} AND toId IN (${placeholders(displaced.length)}) ` +
      `AND mailId IN (${placeholders(mailIds.length)})`,
    ).run(...displaced, ...mailIds);
  }

  /**
   * The ONLY way a run's state changes, and the only place a `run_events` row
   * naming a TRANSITION is written — one call, so "every transition records
   * who caused it" (spec:126) is a property of the code rather than of
   * everyone remembering. (Amended for §1.5: `recordRunEvent` below writes the
   * same table for facts that are NOT transitions, and cannot reach `state`.)
   *
   * `causedBy` is `'coordinator' | 'operator' | <session id>` and is NOT
   * validated against the registry: it is attribution, not authentication
   * (spec:26-30), and pretending otherwise in a column comment would be the
   * kind of claim this repo has already had to retract elsewhere.
   *
   * The table consulted is the run's KIND's (`transitionsFor`, design
   * 2026-09-14 §5.2) — this is the LAST gate; the routes' checks are the
   * first, and both read one table.
   */
  advance(runId: number, to: RunState, causedBy: string, detail?: string): AdvanceResult {
    return tx(this.db, () => this.advanceInner(runId, to, causedBy, detail));
  }

  /** `advance`'s body, WITHOUT its own `tx()` wrapper — split out (fix,
   *  review finding 25/D-25's own wedge, reached a second way) so `closeRun`
   *  below can commit `closing` and the final state as ONE transaction
   *  instead of two independent ones. `DatabaseSync`'s transactions do not
   *  nest (a second `BEGIN` while one is open throws), so a caller that needs
   *  atomicity across more than one state write must call THIS, inside its
   *  own single `tx()`, never the public `advance` twice. */
  private advanceInner(runId: number, to: RunState, causedBy: string, detail?: string): AdvanceResult {
    const row = this.db.prepare('SELECT state, kind FROM runs WHERE id = ?').get(runId) as
      { state: string; kind: string } | undefined;
    if (!row) return { ok: false as const, error: 'unknown-run' as const };
    const from = isRunState(row.state) ? row.state : 'unknown';
    const kind = isRunKind(row.kind) ? row.kind : 'unknown';
    if (!(transitionsFor(kind)[from] as readonly string[]).includes(to)) {
      return { ok: false as const, error: 'bad-transition' as const, from, to };
    }
    const now = Date.now();
    this.db.prepare(
      `UPDATE runs SET state = ?, closedAt = CASE WHEN ? IN ${TERMINAL_RUN_STATES_SQL} THEN ? ELSE closedAt END ` +
      'WHERE id = ?',
    ).run(to, to, now, runId);
    this.db.prepare(
      'INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(runId, now, from, to, causedBy, detail ?? null);
    return { ok: true as const, from, to };
  }

  /**
   * A `run_events` row for something that HAPPENED TO a run without changing
   * its state — §1.5's `dispatch-refused:…`, the first such fact this build
   * has. `advance` above stays "the only place a run's state changes"; it is
   * no longer the only place `run_events` is WRITTEN, and that sentence in its
   * docstring has been amended rather than quietly left wrong.
   *
   * `fromState` and `toState` are both the run's CURRENT state, which is the
   * honest encoding of "no transition occurred" — not a sentinel, and not a
   * fabricated hop the `RUN_TRANSITIONS` table would refuse. Unknown run: a
   * silent no-op, because the column is `REFERENCES runs(id)` and the caller
   * (a refusal path) has nothing better to do with the failure than the row
   * itself was going to record.
   *
   * ON THE NOTIFY LANE (amended, wave 2 F2 — the future this paragraph warned
   * about arrived): `FleetWatcher.pushNewRuns` skips any `run_events` row whose
   * run carries no `sessionId`, and §1.5's two callers record BEFORE
   * `coord.setSession` on a wave-1 run, so those still write to the feed and
   * push nothing.
   *
   * The skill preflight (`dispatch.ts`) is the first caller on a BOUND run, and
   * it did exactly what was predicted here: a second `▸ <state>` naming a state
   * the run was already resting in, tagged identically to the transition's own
   * push and carrying none of the preflight fact that motivated the row. The
   * tray collapsed it by tag; the NotifyLog ring and the durable feed did not.
   *
   * So the notify lane now SKIPS any row where `fromState === toState` — every
   * row this method writes, by construction. A non-transition is not a
   * transition notification. The row still lands in `run_events`, which is the
   * trail callers want; what it no longer does is impersonate a state change.
   *
   * `at` IS THE CALLER'S NOW (wave 5, D-1134). The `markDispatchStarted`/
   * `markDispatched` precedent, said there in full: "the caller owns the moment
   * being recorded." Defaulted, so every existing call site (`dispatch.ts:370`,
   * `:409`, `:615`) is unchanged — one call site, one fact, one clock read. The
   * reason it had to become a parameter: a batch that writes N attribution rows
   * for ONE operator act must stamp them with ONE moment, or the trail says the
   * operator acted N times. `reclaimProgram` above is that batch.
   */
  recordRunEvent(runId: number, causedBy: string, detail: string, at: number = Date.now()): void {
    const row = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as
      { state: string } | undefined;
    if (!row) return;
    this.db.prepare(
      'INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(runId, at, row.state, row.state, causedBy, detail);
  }

  /**
   * The WHOLE dispatch commit, as ONE transaction (D-277 (was D-B4-4)). Before this, the
   * dispatch route ran `markDispatched`, `setClearedAt` and `advance` as three
   * independent `tx()`s — the identical split `closeRun` below was created to
   * close (review finding 25). The work items make it load-bearing rather than
   * merely tidy: spec §3.1 requires that "a refused or failed dispatch leaves
   * no orphan rows", and rows inserted by a fourth independent statement after
   * a crashed third are exactly such orphans — a `planned` run carrying a
   * ledger nothing ever dispatched.
   *
   * Items are inserted AFTER the transition succeeds and INSIDE the same
   * transaction: `advanceInner`'s write is visible to the reads that follow it
   * within one `tx()`, and a refused transition returns before any INSERT
   * runs. What the ONE transaction buys over four independent ones is the
   * THROW case, not the refusal case (both shapes return early on a refused
   * transition): a `node:sqlite` write failure part-way through the ledger
   * rolls the session binding and the `dispatched` state back with it, so the
   * coordinator's retry gets a genuinely fresh dispatch rather than a
   * dispatched run carrying half a ledger. `run-routes.test.ts`'s "rolls the
   * WHOLE dispatch back when an item INSERT throws" is the test that can see
   * the difference; the refusal-shaped cases cannot, and do not claim to.
   */
  dispatchRun(input: {
    runId: number; sessionId: string; workspace: string | null; branch: string | null;
    resumed: boolean; clearedAt: number | null; items: readonly string[]; detail?: string;
    /** F7 (D-1298): what this dispatch DECIDED about the brief, and the
     *  `sendPrompt` refusal that made it false. OPTIONAL on the input so the
     *  disaster-recovery and test callers that know neither may omit both — an
     *  omitted pair leaves the columns NULL, which is exactly the "no dispatch
     *  decided anything here" reading migration 7 reserves for null. */
    briefQueued?: boolean; clearError?: string | null;
  }): AdvanceResult {
    return tx(this.db, () => {
      this.markDispatched(input.runId, input.sessionId, input.workspace, input.branch, input.resumed);
      if (input.clearedAt !== null) this.setClearedAt(input.runId, input.clearedAt);
      // Written UNCONDITIONALLY once `briefQueued` is given, both columns
      // together: recording only the interesting branch would make an older row
      // and a dispatch that queued its brief cleanly indistinguishable, which is
      // the same overloaded null the column's nullability exists to prevent.
      if (input.briefQueued !== undefined) {
        this.db.prepare('UPDATE runs SET briefQueued = ?, clearError = ? WHERE id = ?')
          .run(input.briefQueued ? 1 : 0, input.clearError ?? null, input.runId);
      }
      const adv = this.advanceInner(input.runId, 'dispatched', 'coordinator', input.detail);
      if (!adv.ok) return adv;
      for (const title of input.items) this.addWorkItem(input.runId, title, []);
      return adv;
    });
  }

  /**
   * The WHOLE close-time commit, as ONE transaction (fix — review finding 25,
   * D-25's wedge reached through a different door than the one D-25 itself
   * closed): the close route used to run `advance(id,'closing')` and
   * `advance(id, state)` as two INDEPENDENT transactions. A crash, a
   * `node:sqlite` write failure on a full disk, or a SIGTERM landing between
   * the two left the run wedged in `closing` PERMANENTLY — `RUN_TRANSITIONS.
   * closing = ['done','failed']` has no self-edge, no route in this build
   * exposes `POST /api/runs/:id/advance`'s `to:'closing'`, and every retried
   * close 409s at the route's own precondition before touching anything —
   * verbatim the harm D-48 already named for the OTHER ordering bug. Folding
   * both `advance` calls, the handoff-commit write, the outstanding-delivery
   * cancellation (review findings 8/14 — a run's own queued/delivered-unacked
   * mail must not survive its close and replay into the NEXT wave's freshly
   * `/clear`ed context) and the program-retirement check into one `tx()`
   * means a crash between any two of these statements rolls the WHOLE close
   * back to the run's PRE-close state — still `dispatched`/`working`/
   * `awaiting-review`/`merging` (widened, scoped-verify H5: the other two
   * gained their own direct `closing` edge in `RUN_TRANSITIONS` — see that
   * table's own docstring, "D-9's own text no longer describes this tree" —
   * so a crash mid-close can now roll back to either of them too), legally
   * retryable — rather than to a state with no way out.
   */
  closeRun(input: {
    runId: number; finalState: 'done' | 'failed'; causedBy: string;
    handoffCommit: string | null; program: string; viaClosing: boolean;
  }): AdvanceResult {
    return tx(this.db, () => {
      // `viaClosing: false` is the ABANDON of a `planned` run (D-281 (was D-B4-8)).
      // `RUN_TRANSITIONS.planned` has a `failed` edge and deliberately no
      // `closing` one (`shared/api.ts`'s own docstring), and that table is NOT
      // edited here — clients read it as a refusal vocabulary. So the hop is
      // skipped rather than the table widened; every other statement in this
      // transaction (the handoff write, the delivery cancellation, the
      // program-retirement check) is unchanged and still one commit.
      //
      // No default, for the D-279 (was D-B4-6) reason applied to this parameter: a default
      // is exactly how the abandon path would silently take the ordinary hop
      // and 409 on every wedged `planned` run.
      if (input.viaClosing) {
        const closingAdv = this.advanceInner(input.runId, 'closing', input.causedBy);
        if (!closingAdv.ok) return closingAdv;
      }
      const finalAdv = this.advanceInner(input.runId, input.finalState, input.causedBy);
      if (!finalAdv.ok) return finalAdv;
      // Only a SHAPE-VALID handoff commit is ever written (fix — review
      // findings 6/18): the caller (the close route) runs the same 40-hex
      // `SHA` test `verifyDone` uses, independent of whether `verifyDone`
      // itself ran (it is skipped entirely on an explicit abandon, D-49) —
      // `null` is left standing rather than writing a claim this database has
      // never measured or even shape-checked.
      if (input.handoffCommit !== null) this.setHandoffCommit(input.runId, input.handoffCommit);
      // Review findings 8/14: cancel this run's own outstanding mail rather
      // than leave it to replay into whatever session (this run's own, next
      // wave, or — once a purged workspace slug is re-minted — an unrelated
      // program entirely) next satisfies `dueDeliveries`'s gate.
      this.cancelOutstandingDeliveries(input.runId);
      // Build 9 D12: the run's claims are released in the SAME transaction as
      // the close — after the final advance succeeded (a refused close
      // releases nothing), beside the delivery cancellation it mirrors. The
      // watcher's `divergence.claim-orphan` is the alarm for the close that
      // never got here.
      this.releaseClaimsForRun(input.runId, Date.now());
      // D-51's program-retirement check, run inside the SAME transaction:
      // the run just closed already reads as terminal to this COUNT, because
      // the write above is visible to a later read within one `tx()`.
      if (this.programOpenRunCount(input.program) === 0) {
        this.setProgramState(input.program, input.finalState === 'failed' ? 'abandoned' : 'done');
      }
      return finalAdv;
    });
  }

  /** Review findings 8/14: every `queued` or `delivered`-but-unacked delivery
   *  of this run's OWN mail, parked `rejected('undeliverable')` — the same
   *  typed park `sweepMail` already uses for a delivery that cannot be
   *  completed. Called from `closeRun`'s own transaction, but plain enough
   *  (no nested `tx()`) to also call standalone, which `mail-sweep.test.ts`'s
   *  unit-level coverage of this method does. An already-`acked` row is left
   *  alone — it is not outstanding, and this is not the ack-race guard
   *  `markDelivered`/`rejectDelivery` carry for THEIR own callers. */
  cancelOutstandingDeliveries(runId: number): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable', " +
      `lastError = '${MAIL_RUN_CLOSED_ERROR}' WHERE state IN ${OUTSTANDING_STATES_SQL} ` +
      'AND mailId IN (SELECT id FROM mail WHERE runId = ?)',
    ).run(runId);
  }

  /** Child reclamation (spec 2026-09-22 §5.6): every outstanding delivery
   *  ADDRESSED TO `toId`, parked `rejected('undeliverable')` with
   *  `MAIL_CHILD_RECLAIMED_ERROR` — called by `reclaimChild` ONLY once the
   *  child is gone: after `ws-reclaim` answered `reclaimed`, or when its own
   *  registry read MEASURED the row absent — confirmed by a second listing
   *  naming no `.uuid`/`.child` for the id (an earlier attempt's box half
   *  finished without reaching this call). Never before, and never on a
   *  refusal or a failure — those leave a live recipient that may still read
   *  its mail.
   *
   *  KEYED ON THE RECIPIENT, and that is why it is its own writer rather than
   *  `cancelOutstandingDeliveries` above: that one is keyed on `mail.runId`, so
   *  it cannot reach a delivery from an EARLIER wave's run that the child never
   *  acked, nor peer mail with no run at all. `mail_deliveries.toId` is the
   *  RESOLVED session, never the `'coordinator'`/`'worker'` role `mail.toId`
   *  may carry, so this parks exactly what was sent to the child.
   *
   *  RETURNS the number of rows it parked, never `void` — so it is not one of
   *  the writers CLAUDE.md lists as returning `void`, and a caller can tell a
   *  park from a no-op. An already-`acked` or already-parked row is left
   *  alone: `OUTSTANDING_STATES_SQL` is the whole guard. Plain enough (no
   *  nested `tx()`) to call standalone, like its sibling. */
  cancelDeliveriesTo(toId: string): number {
    const res = this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable', " +
      `lastError = '${MAIL_CHILD_RECLAIMED_ERROR}' WHERE state IN ${OUTSTANDING_STATES_SQL} AND toId = ?`,
    ).run(toId);
    return Number(res.changes);
  }

  /**
   * THE ONE WRITER that can RE-BIND `runs.sessionId` (design 2026-09-08 §4).
   *
   * The other writer of this column, named honestly rather than hidden:
   * `reconstruct`'s `INSERT INTO` statement for `runs` lists `sessionId` and
   * makes a FRESH row off the registry, with no predecessor and no mail to
   * inherit, so it is not a
   * re-bind and the funnel has nothing to do for it. `coord-store.test.ts`'s
   * one-writer scan counts BOTH shapes and argues the second. Two writers
   * existed before this method: `setSession`
   * (the open route's wave-N>=2 reclaim, and the fresh-spawn arm of dispatch)
   * and `markDispatched`. Each was an unconditional UPDATE, so the day a
   * recovery re-binds a live run — a held workspace reaped, a fresh `ws-add`
   * into the same run — the mail already addressed to the outgoing occupant
   * would sit in a mailbox nobody reads, and `sweepMail` would go on
   * injecting it there.
   *
   * MEASURED, NOT ASSUMED: a route DOES re-bind a live run today. The open
   * route (`routes.ts`, `POST /api/runs`) calls `setSession` whenever the
   * request names a `sessionId` AND its `ws-hold` has succeeded, and
   * `openRun`'s dup arm keys its reuse on `(program, wave, waveOf, claimedBy,
   * state = 'planned')` — NOT on `sessionId`. So a second
   * open of the same still-`planned` wave, naming a DIFFERENT sessionId than
   * the first, finds the dup row, returns it unchanged, and — once the hold
   * on the new session's workspace holds — the open route's `setSession` call
   * re-binds it, re-issuing (or parking) whatever worker mail the predecessor
   * session was owed, and records a `session-rebound: <predecessor> ->
   * <heir>, <n> re-issued` event naming both occupants. The `rebound` branch
   * below is reached by this live path, not only by the store test that
   * drives it directly.
   *
   * NO `tx()` OF ITS OWN. `DatabaseSync` transactions do not nest, so both
   * callers own the transaction around this funnel. `markDispatched` reaches
   * it from inside the `tx()` of the store method whose docstring opens "The
   * WHOLE dispatch commit, as ONE transaction" (`dispatchRun` — there is no
   * `commitDispatch` in this file). The open route performs `ws-hold` first,
   * then wraps its predecessor read, `setSession` call and rebound event in one
   * `tx()`. Thus a refused external hold makes no database write, while any
   * later SQLite failure rolls the binding, re-issued delivery and event back
   * together (D-2505).
   */
  bindSession(runId: number, sessionId: string): { rebound: boolean; reissued: number } {
    const row = this.db.prepare('SELECT sessionId FROM runs WHERE id = ?')
      .get(runId) as { sessionId: string | null } | undefined;
    const predecessor = row?.sessionId ?? null;
    this.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(sessionId, runId);
    // NULL is a FIRST bind, not a re-bind, and it re-issues nothing: there is no
    // predecessor to inherit from, and every wave-1 dispatch on the box lands
    // here. The same-session case is a re-statement, not a change of occupant.
    if (predecessor === null || predecessor === sessionId) return { rebound: false, reissued: 0 };
    const reissued = this.requeueAbandonedMail({ role: 'worker', runId }, sessionId, [predecessor]);
    return { rebound: true, reissued };
  }

  /**
   * Deviation (found while executing Task 9; not in the plan's own Task 9
   * File Structure entry, which named only `routes.ts` — see the plan's D-45):
   * `POST /api/runs`'s body may name an existing workspace (`sessionId?`,
   * wave N>=2 reclaiming the workspace it held since wave 1) and the OPEN
   * route places the hold immediately — spec:120-123, "When sessionId names
   * an existing workspace, places the hold immediately." Task 9's dispatch
   * route then needs to read `run.sessionId` back OFF THE ROW to decide
   * `CCD_ARGV.wsAdd` vs `CCD_ARGV.ensure` (D-1: "No sessionId on the run ->
   * ws-add; otherwise -> ensure") — but `openRun`'s own signature never took
   * a `sessionId`, and no writer of the column existed for anything but
   * `markDispatched` (a DISPATCH-time write that also stamps
   * `dispatchedAt`/`resumed`, both false of an open-time claim). This is the
   * matching open-time write, on `foldPrLineage`/`setHandoffCommit`'s single-
   * column-`UPDATE` pattern, deliberately NOT touching `dispatchedAt` or
   * `resumed` — a run whose wave N>=2 open just reclaimed its workspace has
   * not been dispatched yet, and must not read as though it had.
   *
   * AMENDED (design 2026-09-08 §4): the single-column `UPDATE` moved into
   * `bindSession` above, which is now the one writer of this column. Every
   * sentence in the paragraph above is still true of what this method DOES;
   * what changed is only where the statement lives.
   */
  setSession(runId: number, sessionId: string): { rebound: boolean; reissued: number } {
    // Delegated, not re-implemented: `bindSession` above is the writer of this
    // column. Its answer is RETURNED, not dropped (D-2351; PR #75 review
    // round 1, store-2): the open route is a live RE-bind path — a retried open of a
    // still-`planned` wave naming a different session reaches it with a
    // predecessor — and records what it was told on the run's trail. The
    // fresh-spawn arm (`dispatch.ts`) binds a run that names no session yet,
    // where the answer is always `{rebound:false, reissued:0}` and is ignored.
    return this.bindSession(runId, sessionId);
  }

  /**
   * THE ONE UNBIND (child-reclamation wave 2, spec §5.4): `runs.sessionId`
   * back to NULL on a `planned` run, with `workspace`/`branch` beside it, and
   * the act attributed on the run's own trail — ONE transaction, so a run is
   * never unbound without its `session-unbound` event, nor the reverse.
   *
   * Its one caller is dispatch's resume arm, AFTER the fleet act (D-48's
   * order): the spent child's claim is released, or handed to a surviving
   * sibling, first, and only a fleet act that succeeded unbinds the row. The
   * run stays `planned` — where a run awaiting dispatch already sits — so no
   * backwards transition is invented, and the next dispatch takes the
   * fresh-spawn arm and mints a new child.
   *
   * NOT A RE-BIND, which is why it is not `bindSession` and why
   * `coord-store.test.ts`'s one-writer scan names it separately: it binds no
   * value to the column, so it can hand the run to nobody. What it does NOT
   * do, stated rather than hidden: worker mail this run's worker was sent on
   * the spent child stays addressed to the spent child — the next
   * `bindSession` sees a NULL predecessor and re-issues nothing. On the one
   * path that calls this (a `planned` run whose dispatch never queued its
   * brief) that set is empty unless a coordinator mailed the run's worker
   * before dispatching it.
   *
   * `pr` rides in for the event's words only: the store holds no PR for a run
   * that has not closed. `cleared: false` — and nothing written — when no
   * `planned` row with a binding matched: an unknown id, a run that has left
   * `planned`, or one already unbound.
   */
  clearSession(runId: number, pr: number): { ok: true; cleared: boolean } {
    return tx(this.db, () => {
      const row = this.db.prepare("SELECT sessionId FROM runs WHERE id = ? AND state = 'planned'")
        .get(runId) as { sessionId: string | null } | undefined;
      if (row === undefined || row.sessionId === null) return { ok: true as const, cleared: false };
      this.db.prepare(
        "UPDATE runs SET sessionId = NULL, workspace = NULL, branch = NULL WHERE id = ? AND state = 'planned'",
      ).run(runId);
      this.recordRunEvent(runId, 'coordinator', `session-unbound: ${row.sessionId} (workspace-spent #${pr})`);
      return { ok: true as const, cleared: true };
    });
  }

  /**
   * `runs.clearedAt` — the proof D-1's post-resume `/clear` actually
   * committed (`RunSummary.clearedAt`'s own docstring; the column landed in
   * Task 2's v1 DDL, unwritten, per D-1's own amendment). Mirrors
   * `foldPrLineage`/`setHandoffCommit`: a single-column `UPDATE`, called once,
   * by the dispatch route, and ONLY when the injected `/clear` actually
   * verified — a refused send (dialog open, draft present) leaves this
   * column honestly null, never called with a guess. */
  setClearedAt(runId: number, at: number): void {
    this.db.prepare('UPDATE runs SET clearedAt = ? WHERE id = ?').run(at, runId);
  }

  /**
   * Did a LIVE run's dispatch record that it typed `/clear` into this
   * session's box and never had it taken? (Task 407.)
   *
   * The provenance half of `sendPrompt`'s `ownStrandedClear` gate, and the
   * only thing in this system that can answer it. `dispatch.ts` types the
   * literal `/clear` into a resumed worker before its wave brief; when the
   * Enter is swallowed it writes `clear-refused:enter-ignored` onto the run
   * (D-47). That row is the record — the text in the box is not, because
   * `/clear` is four characters a human plausibly types and leaves sitting,
   * and nothing about the STRING distinguishes ours from theirs. No row, no
   * permission: `sendPrompt` refuses `draft-present` exactly as it does today,
   * which is the default rather than a fallback (operator ruling).
   *
   * THREE NARROWINGS, all deliberate:
   *  - `CLEAR_REFUSED_STRANDS_TEXT` only — see its own docstring for why
   *    `verify-failed`, which since Build 8 also leaves text in the box, is
   *    NOT proof of what is in it.
   *  - a run in a TERMINAL state grants nothing: a run nobody is waiting on
   *    is not a run whose box anyone is about to read.
   *  - AND THE PROOF IS SPENT BY THE FIRST DELIVERY THAT LANDS (review, W4c
   *    finding 1). Without this the row licensed a C-u at that box on EVERY
   *    later delivery for the whole life of the run — `run_events` rows are
   *    durable forever — so one strand, once, permanently defeated the
   *    operator ruling for that session: refuse-only EXCEPT where the lane
   *    can prove it typed THAT text. A proof that outlives the text it is
   *    about is not a proof of it.
   *
   * WHAT SPENDS IT, and why that fact and not a clock. `sweepMail` calls
   * `markDelivered` only on `sendPrompt`'s `ok`, which means the box echoed
   * our text and was EMPTY after Enter — so a delivery landed in this session
   * at or after the strand is durable, server-MEASURED evidence that the
   * stranded `/clear` is no longer in that box. Anything typed there since is
   * somebody else's, and gets the ordinary `draft-present` refusal. A time or
   * attempt bound was the alternative and is strictly worse here: the wedge
   * survives untouched for as long as no mail is due, so a clock would revoke
   * a proof that is still exactly true, and grant one that is not, purely on
   * how busy the program happened to be. `>=`, not `>`: a same-millisecond
   * tie retires the proof, biasing the ambiguous case toward the refusal. A
   * row still QUEUED carries a null `deliveredAt` and fails that comparison
   * on its own (SQLite's three-valued logic), so there is deliberately no
   * separate null check — it would be a conjunct no mutation could turn red.
   *
   * WHAT IT DOES NOT COVER, stated rather than discovered: a box emptied by
   * something this store cannot see — a later dispatch's own `/clear`, or an
   * operator (or the PWA composer) sending a turn by hand — leaves the proof
   * standing, because none of those write a durable row here. The terminal-
   * state narrowing above is the only backstop for that case. Closing it
   * properly means a fact about the BOX, which nothing in this system records
   * today.
   *
   * SYNCHRONOUS, like everything here, and a dedicated one-row read: it runs
   * only for a delivery that has already cleared every gate and is about to
   * be typed, never over every due row on every sweep. The `mail_deliveries`
   * arm has no index to use (`toId` carries none — `mailForRecipient` scans
   * it too), which is affordable at exactly that call rate and would not be
   * on a per-row one.
   */
  strandedClear(sessionId: string): boolean {
    // D-2794: the pair is L0's; an `unknown` row is LIVE here, as everywhere.
    const row = this.db.prepare(
      'SELECT 1 AS x FROM run_events e JOIN runs r ON r.id = e.runId ' +
      `WHERE r.sessionId = ? AND e.detail = ? AND r.state NOT IN (${TERMINAL_RUN_STATES.map(() => '?').join(', ')}) ` +
      'AND NOT EXISTS (SELECT 1 FROM mail_deliveries d ' +
      'WHERE d.toId = r.sessionId AND d.deliveredAt >= e.at) ' +
      'LIMIT 1',
    ).get(sessionId, CLEAR_REFUSED_STRANDS_TEXT, ...TERMINAL_RUN_STATES);
    return row !== undefined;
  }

  /** Stamped immediately BEFORE the `ws-add` that mints a fresh workspace —
   *  the one moment the run knows a dispatch is in flight and the session id
   *  does not exist yet (the server learns that id by registry diff, after the
   *  call returns). A MEASUREMENT, not a mode flag: nothing clears it, `state`
   *  moving to `dispatched` is what ends the "dispatching" render, and
   *  `dispatchedAt - dispatchStartedAt` is then how long the spawn took. A
   *  retry overwrites it with the new attempt's start, which is the honest
   *  answer to "when did the dispatch that is running now begin".
   *
   *  ONE CALL SITE, AND IT IS THE FRESH-SPAWN ARM: the wave N>=2 resume (D-1)
   *  deliberately does not call this, so NULL means "no fresh-spawn dispatch
   *  has started" and not "nothing has been dispatched" — see
   *  `RunSummary.dispatchStartedAt`, which names both conditions, and the pin
   *  in `run-routes.test.ts` that makes the scope cost a test to change.
   *
   *  `setClearedAt`/`setHandoffCommit`'s single-column `UPDATE`, and
   *  deliberately touching NOTHING else — least of all `state`, which is a
   *  separate write with its own `run_events` attribution. Takes `at` rather
   *  than reading a clock, on `markDispatched`'s precedent: the caller owns the
   *  moment being recorded. */
  markDispatchStarted(runId: number, at: number): void {
    this.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(at, runId);
  }

  /** Dispatch's write: the workspace a run landed in, and whether it was a
   *  fresh spawn or D-1's resume+`/clear`. Does NOT itself advance `state` —
   *  the caller (Task 9's dispatch route) calls `advance` separately, so the
   *  two writes stay independently attributable in `run_events`.
   *
   *  `workspace`/`branch` are nullable, matching the column (`runs.workspace`/
   *  `runs.branch`, both `TEXT` with no `NOT NULL`) and `RunSummary`'s own
   *  wire type — Task 9's dispatch route resolves both from the live
   *  registry (falling back to the run row on wave N>=2, the identical
   *  fallback `fingerprint.ts`'s `verifyDone` uses), which can genuinely come
   *  back empty for a registry row `readRegistry` otherwise accepted. */
  markDispatched(runId: number, sessionId: string, workspace: string | null, branch: string | null,
                 resumed: boolean, at: number = Date.now()): void {
    // The session goes through the funnel; the other four columns are this
    // method's own single UPDATE, exactly as before. Splitting the statement is
    // what makes `bindSession` the ONE writer of `sessionId` — a claim
    // `coord-store.test.ts` scans this file for rather than trusting.
    this.bindSession(runId, sessionId);
    this.db.prepare(
      'UPDATE runs SET workspace = ?, branch = ?, resumed = ?, dispatchedAt = ? WHERE id = ?',
    ).run(workspace, branch, resumed ? 1 : 0, at, runId);
  }

  /** `runs.prLineage`, written once at close from a `.prhistory` read
   *  (`coord/prhistory.ts`). Stored as JSON (spec:92-95's fold), never
   *  reconstructed lazily on read — the same "store the render, don't defer
   *  it" reasoning `mail_deliveries.envelope`'s own column comment states. */
  foldPrLineage(runId: number, lineage: readonly PrLineageEntry[]): void {
    this.db.prepare('UPDATE runs SET prLineage = ? WHERE id = ?').run(JSON.stringify(lineage), runId);
  }

  /**
   * `runs.handoffCommit`, written once at close (fix, found in a later Task 3
   * review — D-25): before this method the column had exactly one writer in
   * the whole tree, `reconstruct`'s disaster-recovery INSERT, so every run
   * this build actually closed could only ever read `handoffCommit: null` on
   * the wire — silently disagreeing with the fingerprint the close route
   * re-measures and rejects a claim over (`fingerprint.ts`'s `no-handoff-
   * commit`, D-2). Mirrors `foldPrLineage`'s shape on purpose: a single-
   * column UPDATE, called once, at close. `closeRun` above is the caller
   * (fix, review finding 28: this docstring called Task 9's close route
   * "not yet written in this tree" for two fix rounds after it was — the
   * same staleness D-51 was filed against a neighbouring comment for, not
   * caught here at the time).
   */
  setHandoffCommit(runId: number, handoffCommit: string): void {
    this.db.prepare('UPDATE runs SET handoffCommit = ? WHERE id = ?').run(handoffCommit, runId);
  }

  /** ONE run, or the two answers that are not one run (D-2545). `{ok:true,
   *  run:null}` is "no such row"; `{ok:false}` is "the row is there and this
   *  process cannot represent its integers". See `RunReadResult`. */
  run(id: number): RunReadResult {
    const row = this.db.prepare(
      `SELECT ${RUN_ROW_COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program WHERE r.id = ?`,
    ).get(id) as RunRowDb | undefined;
    if (!row) return { ok: true, run: null };
    const m = measureRunNumbers(row);
    if (!m.ok) return { ok: false, kind: 'run-unreadable', detail: m.detail };
    const measured: MeasuredRunRow = { row, nums: m.nums };
    return { ok: true, run: this.hydrateRun(measured, this.healthFor([measured]).get(m.nums.id)!) };
  }

  /** Rows -> the whole answer, ALL-OR-FAILURE. The order is forced by the
   *  CAST: `healthFor` reads `id` and `claimedBy`, and the numeric ids do not
   *  exist until every row has been validated, so validation runs over the
   *  whole batch BEFORE the four health statements are spent on it. */
  private hydrateRuns(rows: readonly RunRowDb[]): RunsReadResult {
    const measured: MeasuredRunRow[] = [];
    for (const row of rows) {
      const m = measureRunNumbers(row);
      if (!m.ok) return { ok: false, kind: 'run-unreadable', detail: m.detail };
      measured.push({ row, nums: m.nums });
    }
    const health = this.healthFor(measured);
    return { ok: true, runs: measured.map((m) => this.hydrateRun(m, health.get(m.nums.id)!)) };
  }

  /**
   * `includeClosed` (fix, review finding 24): the archive half was the one
   * read on this whole branch with no clamp on either side — `?closed=1`
   * walked the entire `runs` table, forever, with no LIMIT and no
   * retention, unlike every sibling read this build added or touched
   * (`feedEvents` clamps into `FEED_RETENTION`; `mailForRecipient`/
   * `outstandingMailFor` clamp at `clampMailLimit`'s 500). After a year of
   * programs this was every run ever recorded, rendered into one unbounded
   * DOM list, plus a per-row `unreadMailCount` subquery apiece.
   *
   * The clamp is asymmetric ON PURPOSE: an ACTIVE run (`state NOT IN
   * TERMINAL_RUN_STATES_SQL`) is never dropped by it, however old — the live
   * board's whole job is showing every run still moving, and a program that
   * has been open for a year is exactly the one an operator most needs to
   * see, not the one to hide behind a LIMIT. Only the FINISHED half — which
   * grows without bound and is read-once-per-mount archive material, not a
   * live signal — is capped, to the newest `closedLimit` rows by id (a
   * closed run's id only ever moves forward). `runsFrameSeen`+the live
   * `{type:'runs'}` frame is what proves an active run "still there" isn't
   * silently truncated: this method's own `includeClosed:false` branch
   * (used by that frame) carries no LIMIT at all, clamped or otherwise.
   */
  runs(opts: { includeClosed?: boolean; closedLimit?: number } = {}): RunsReadResult {
    if (!opts.includeClosed) {
      return this.hydrateRuns(this.db.prepare(
        `SELECT ${RUN_ROW_COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program ` +
        `WHERE r.state NOT IN ${TERMINAL_RUN_STATES_SQL} ORDER BY r.id`,
      ).all() as unknown as RunRowDb[]);
    }
    const n = clampMailLimit(opts.closedLimit ?? 500);
    return this.hydrateRuns(this.db.prepare(
      `SELECT ${RUN_ROW_COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program ` +
      `WHERE r.state NOT IN ${TERMINAL_RUN_STATES_SQL} OR r.id IN ` +
      `(SELECT id FROM runs WHERE state IN ${TERMINAL_RUN_STATES_SQL} ORDER BY id DESC LIMIT ?) ` +
      'ORDER BY r.id',
    ).all(n) as unknown as RunRowDb[]);
  }

  /**
   * `runs({includeClosed:true})`'s narrow sibling, for `fleet.ts`'s
   * `readCoordPlacements` alone. `runs()` prices a full read at "~3,000 [SQL
   * statements] for one [on-demand] board load" (this docstring's own
   * estimate, `:2521-2524` below) — `itemTally` (two statements),
   * `unreadMailCount` (one), batch health and a `prLineage` JSON parse, PER
   * ROW, over every open run and up to 500 closed. That is an on-demand-load
   * price. `readCoordPlacements` runs on `FleetWatcher`'s 2s tick and every
   * `/ws/fleet` connect, so paying it there would be roughly 200-1,500
   * statements every couple of seconds to obtain three columns — `OpenSibling`
   * and `openCoordinatorIds` above make the identical trade for the identical
   * reason.
   *
   * `claimedBy` rides in the SAME row as `coordProject` (D-2921), never as a
   * second read: they are two facts about one coordinator, and the walk that
   * consumes them is a chain of "who coordinates THIS session" — whose answer
   * is a project (where the row renders) and a session id (the next question).
   * Splitting them would let a stamp and a claimant disagree about which
   * coordinator a run has. `runs.project` is deliberately NOT selected: it is
   * the WORKER's project — the column `POST /api/runs`' `project-mismatch`
   * rung compares `sessionProject(sessionId)` against — and keying a hop on it
   * is the defect D-2921 repairs.
   *
   * `WHERE coordProject IS NOT NULL` is pushed into SQL, not left to the
   * caller: an unstamped run can never change a placement (`boardPlacement`'s
   * own contract — a session whose lookup answers null degrades to
   * `ownProject`), so filtering it out here is strictly narrower than filtering
   * it out in `fleet.ts`, at no cost to correctness.
   *
   * Closed runs stay visible (same `includeClosed:true` shape as `runs()`,
   * same `closedLimit` clamp) — DELIBERATE, not a narrowing this method may
   * drop: a placement keyed on open runs alone would bounce a worker between
   * cards at the close-then-open wave boundary (Task 3's own brief).
   *
   * `id` rides CAST to TEXT and proven by `persistedInt`, D-2545's reason:
   * `foldCoordPlacements` (`coord/placement.ts`) uses it to pick the NEWEST
   * stamp per session regardless of which order these rows arrive in — this
   * method still orders by `id` for determinism, but that ordering is not a
   * contract the caller may rely on (that fold's own ruling). ALL-OR-FAILURE on an unrepresentable id, the
   * same rule `openRunsForSession` follows: a partial stamp set is how a
   * session's card could silently jump to the wrong coordinator.
   */
  coordPlacementStamps(closedLimit?: number): CoordPlacementStampsResult {
    const n = clampMailLimit(closedLimit ?? 500);
    const rows = this.db.prepare(
      'SELECT CAST(id AS TEXT) AS idText, sessionId, claimedBy, coordProject FROM runs ' +
      `WHERE coordProject IS NOT NULL AND (state NOT IN ${TERMINAL_RUN_STATES_SQL} OR id IN ` +
      `(SELECT id FROM runs WHERE state IN ${TERMINAL_RUN_STATES_SQL} ORDER BY id DESC LIMIT ?)) ` +
      'ORDER BY id',
    ).all(n) as unknown as { idText: string; sessionId: string | null; claimedBy: string | null; coordProject: string }[];
    const stamps: CoordPlacementStamp[] = [];
    for (const r of rows) {
      const id = persistedInt(r.idText, 'run id');
      if (!id.ok) return { ok: false, kind: 'run-unreadable', detail: id.detail };
      stamps.push({ id: id.value, sessionId: r.sessionId, claimedBy: r.claimedBy, coordProject: r.coordProject });
    }
    return { ok: true, stamps };
  }

  /**
   * "Which OPEN runs name this session?" — the question the hold file
   * structurally cannot answer, asked at three destructive decision points.
   *
   * SYNCHRONOUS, like the rest of `CoordStore`. DO NOT WRAP IT ASYNC: the
   * store's synchrony is a stated concurrency invariant, and this read sits
   * OUTSIDE any transaction, so it neither lengthens one nor introduces an
   * `await` inside one — wrapping it is the only move that would threaten
   * the invariant.
   *
   * NO `AND dispatchedAt IS NOT NULL`. It looks like D-13's predicate on
   * `capsUsage`, but D-13 guards a GLOBAL, SESSION-LESS count whose problem
   * class is `planned` rows with no session — already excluded here by
   * `WHERE sessionId = ?`. Importing it would REINTRODUCE F9, because
   * `POST /api/runs` places the wave-N+1 hold at OPEN time, before any
   * dispatch, so a live claim legitimately belongs to a run with
   * `dispatchedAt IS NULL`. This sentence exists so a later reviewer does
   * not "fix" it.
   *
   * Nothing at this layer prevents two open runs naming one session
   * (`bindSession`/`markDispatched` are bare UPDATEs with no uniqueness
   * constraint) and that is CORRECT — the coordinator protocol deliberately
   * creates that state by opening wave N+1 before closing wave N.
   *
   * `excludeRunId` defaults to `-1`, an id AUTOINCREMENT never mints, so the
   * "no exclusion" call and the excluding call are ONE query, not two.
   */
  openRunsForSession(sessionId: string, excludeRunId?: number): OpenSiblingsResult {
    // Four of the five columns are CAST to TEXT and proven, for
    // `RUN_ROW_COLUMNS`'s reason (D-2545) — this read's three consumers are all
    // DESTRUCTIVE decision points, so an unrepresentable row here must refuse
    // in words rather than throw out of a sweep or a fleet act.
    const rows = this.db.prepare(
      'SELECT CAST(id AS TEXT) AS idText, program, CAST(wave AS TEXT) AS waveText, ' +
      'CAST(waveOf AS TEXT) AS waveOfText, CAST(reviews AS TEXT) AS reviewsText FROM runs ' +
      `WHERE sessionId = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} AND id != ? ORDER BY id`,
    ).all(sessionId, excludeRunId ?? -1) as unknown as
      { idText: string; program: string; waveText: string; waveOfText: string | null;
        reviewsText: string | null }[];
    const siblings: OpenSibling[] = [];
    for (const r of rows) {
      const m = measureRunNumbers(r);
      // ALL-OR-FAILURE (`RunReadResult`'s own docstring): a partial sibling
      // list is how "nothing else claims this workspace" gets asserted about a
      // workspace something else claims.
      if (!m.ok) return { ok: false, kind: 'run-unreadable', detail: m.detail };
      siblings.push({ id: m.nums.id, program: r.program, wave: m.nums.wave, waveOf: m.nums.waveOf });
    }
    return { ok: true, siblings };
  }

  /** The sessions COORDINATING something live: every distinct `claimedBy` of a
   *  run this build calls non-terminal. NOT `openRunsForSession`'s question one
   *  method up — that one keys on `sessionId`, the WORKER column, which is the
   *  opposite fact about the same row (D-1241).
   *
   *  Two columns, no JOIN and no `hydrateRun`, for `OpenSibling`'s own stated
   *  reason (`:53-57`): dragging `prLineage` JSON and a `programs` join through
   *  a question that turns on one column is a cost this file does not pay.
   *  `runs({includeClosed:false})` would answer and would pay it, per row, on
   *  the box's busiest loop.
   *
   *  The predicate is `programOpenRunCount`'s (`:1284`), COPIED rather than
   *  re-derived. `RUN_TRANSITIONS` would answer differently — it gives
   *  `'unknown'` an empty target list, so a table-derived predicate would call
   *  an `'unknown'` row terminal while every shipped query here counts it open.
   *  That divergence is latent (this build never writes `'unknown'`; it is what
   *  a newer build's row degrades to on read), and it stays latent only while
   *  new predicates copy the SQL spelling instead of re-deriving one.
   *
   *  A row whose `claimedBy` was rewritten onto a TERMINAL run by
   *  `reclaimProgram` (`:620-660`) does not appear here, and must not: that
   *  rewrite deliberately covers every run of a programme, so appearing in some
   *  `claimedBy` is not evidence of coordinating anything live.
   *
   *  Synchronous, like every other read on this store — its synchrony is a
   *  stated concurrency invariant, not an oversight to be wrapped. */
  openCoordinatorIds(): string[] {
    return (this.db.prepare(
      'SELECT DISTINCT claimedBy FROM runs ' +
      `WHERE claimedBy IS NOT NULL AND state NOT IN ${TERMINAL_RUN_STATES_SQL}`,
    ).all() as { claimedBy: string }[]).map((r) => r.claimedBy);
  }

  /** `detail` joins the SELECT (fix, found in Task 9 review — D-47): `advance`
   *  has always taken a `detail` parameter, but until the dispatch route's
   *  refused-`/clear` fix started passing one, nothing in this file ever
   *  wrote a non-null value, so no reader had ever needed the column back.
   *  Widening the return type is additive-only — every existing caller reads
   *  a subset of these fields, never the whole shape by positional index. */
  runEvents(runId: number): { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[] {
    return this.db.prepare(
      'SELECT at, fromState, toState, causedBy, detail FROM run_events WHERE runId = ? ORDER BY id',
    ).all(runId) as { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[];
  }

  /** Routing spec 2026-09-14 §6 "Arms" — this run's OWN event trail, parsed
   *  into the writer's `arm:`/`route:` vocabulary (`parseArmEventDetail`/
   *  `parseRouteEventDetail`, `shared/api.ts`). Read-only, callable on its
   *  own so a caller that only wants the routing trail can get it without
   *  reaching for `runSignals`' whole shape. Delegates to the private
   *  `routingFromEvents` (fix round 2, finding #3) so `runSignals`, which
   *  already holds this run's `runEvents(runId)` result, can compute the
   *  same trail from that ARRAY rather than this method re-issuing the
   *  identical SELECT a second time per `runSignals` call. */
  runRoutingEvents(runId: number): { arm: RouteFields | null; armUnparsed: number; routing: RoutingEvent[]; routingUnparsed: number } {
    return this.routingFromEvents(this.runEvents(runId));
  }

  /** The actual walk `runRoutingEvents` and `runSignals` share (fix round 2,
   *  finding #3) — takes an already-fetched `runEvents(runId)` array so
   *  neither caller issues the SELECT twice.
   *
   *  `arm` is the FIRST WELL-FORMED `arm:` event's fields, by position in
   *  the trail (fix round 2, finding #2, controller ruling S5-R9): a
   *  malformed `arm:` row no longer collapses to the same `null` a run with
   *  NO arm at all reports — two conditions a reader handles differently
   *  ("no routing was seeded" vs "the arm event could not be parsed") must
   *  not share a value. Every malformed `arm:` row encountered before the
   *  first well-formed one is counted in `armUnparsed`; once a well-formed
   *  `arm:` is found, later `arm:` rows are ignored entirely (a
   *  dispatcher-written `arm:` is never rewritten by design — §6's
   *  first-wins rule — so nothing after the first well-formed one is worth
   *  reading). A trail with no well-formed `arm:` row at all answers
   *  `arm: null, armUnparsed: <every malformed arm: row seen>`.
   *
   *  `routing` is every `route:` event in order; a detail that starts
   *  `route:` but does not parse is skipped and counted in
   *  `routingUnparsed`, never thrown — the same never-crash-the-signals
   *  contract `runSignals` keeps everywhere else. */
  private routingFromEvents(
    events: { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[],
  ): { arm: RouteFields | null; armUnparsed: number; routing: RoutingEvent[]; routingUnparsed: number } {
    let arm: RouteFields | null = null;
    let armFound = false;
    let armUnparsed = 0;
    const routing: RoutingEvent[] = [];
    let routingUnparsed = 0;
    for (const e of events) {
      if (e.detail === null) continue;
      if (!armFound && e.detail.startsWith('arm:')) {
        const parsed = parseArmEventDetail(e.detail);
        if (parsed === null) { armUnparsed++; continue; }
        arm = parsed;
        armFound = true;
        continue;
      }
      if (e.detail.startsWith('route:')) {
        const parsed = parseRouteEventDetail(e.detail);
        if (parsed === null) { routingUnparsed++; continue; }
        // `parsed.session` (routing slice 6, Task 1) rides the spread below
        // unchanged — this walk needs no session-aware branch of its own,
        // because it is `runSignals`'s per-RUN trail, not the routing
        // door's per-SESSION one (`routes.ts`'s own walk over
        // `runsTouching`); `RoutingEvent.session` is simply carried through
        // for whoever reads a run's `routing` array off the wire.
        routing.push({ at: e.at, causedBy: e.causedBy, ...parsed });
      }
    }
    return { arm, armUnparsed, routing, routingUnparsed };
  }

  /** Routing spec 2026-09-14 §6 — speed and quality per run, read-only. The
   *  worker is `runs.sessionId` (never `claimedBy`, the coordinator). Holds
   *  pair `hold done` with the next `release done`; a swap is ONE `done` row
   *  in ccd's journal (no intent, no landing pair — `ccd/ccd:17166`), so it is
   *  COUNTED and flagged, never timed. Refused wave-dones are the
   *  `mail_rejections` rows `closeRun` records with a DONE_AUTHORITY code,
   *  counted through `doneRejectCount` — the SAME private statement
   *  `runHealth`'s `doneRejects` rides, so `GET /api/runs` and
   *  `GET /api/runs/:id/signals` cannot drift apart (R7-3).
   *
   *  `excludedUnmeasured` is TRUE UNLESS THE WINDOW WAS SCANNED AND EVERYTHING
   *  IN IT PAIRED — see the flag's own paragraph below for the three windows
   *  nobody scans and for the open-run ruling. It is the field that keeps
   *  `activeMs` honest: a ceiling flagged as one, never a total. */
  runSignals(runId: number): RunSignals | null {
    const run = this.db.prepare('SELECT sessionId FROM runs WHERE id = ?').get(runId) as
      { sessionId: string | null } | undefined;
    if (!run) return null;
    const events = this.runEvents(runId);
    const transition = (to: (s: string) => boolean) => events.find((e) => e.fromState !== e.toState && to(e.toState));
    const dispatchedAt = transition((s) => s === 'dispatched')?.at ?? null;
    const final = transition((s) => s === 'done' || s === 'failed');
    const closedAt = final?.at ?? null;
    const finalState = final ? (final.toState as 'done' | 'failed') : null;
    const closeRefusals = this.doneRejectCount([runId]).get(runId)?.count ?? 0;
    const wallMs = dispatchedAt !== null && closedAt !== null ? closedAt - dispatchedAt : null;
    let holdMs = 0;
    let swaps = 0;
    // TRUE UNTIL THE WINDOW IS ACTUALLY SCANNED (R7-1, D-2785).
    // `holdMs: 0, swaps: 0, excludedUnmeasured: false` is an affirmative claim
    // that the lifecycle window WAS read and held nothing — and the three
    // conditions below reach the `return` without reading a single row: a run
    // whose `sessionId` is still null, a RECONSTRUCTED run (rebuilt from ccd's
    // flat files, so it has no `run_events` and therefore no `dispatched`
    // transition), and every OPEN run. Initialising the flag `false` collapsed
    // "measured, nothing to exclude" into "never examined", which is the
    // overloaded-null defect this codebase refuses at a seam, and §6's
    // arm-attribution is precisely the consumer that would average an
    // unexamined run into an arm's mean.
    //
    // AN OPEN RUN COUNTS AS UNSCANNED — the choice R7-1 left to this fix, made
    // here and not left implicit. The flag is NOT scoped to closed runs: it
    // answers one question, "was this window measured", and an open run's
    // window has no end to scan to, so its `holdMs`/`swaps` zeroes are
    // initialisers, not readings. A closed-runs-only flag would have made the
    // zeroes honest only for a reader that ALSO tested `closedAt`, i.e. a
    // second condition every consumer must remember — the same defect one
    // field along. `run-signals.test.ts`'s open-run case asserts `true`.
    let excludedUnmeasured = true;
    if (run.sessionId !== null && dispatchedAt !== null && closedAt !== null) {
      excludedUnmeasured = false;
      const acts = placeholders(LIFECYCLE_WINDOW_ACTS.length);
      const rows = this.db.prepare(
        'SELECT at, act FROM lifecycle_events ' +
        `WHERE sessionId = ? AND outcome = 'done' AND at IS NOT NULL AND at >= ? AND at <= ? AND act IN (${acts}) ` +
        'ORDER BY at, id',
      ).all(run.sessionId, dispatchedAt, closedAt, ...LIFECYCLE_WINDOW_ACTS) as { at: number; act: string }[];
      let holdOpenAt: number | null = null;
      for (const r of rows) {
        if (r.act === 'swap') swaps += 1;
        // A SECOND `hold` WHILE ONE IS OPEN is not a no-op (R7-2): ccd pairs
        // `hold done` with the next `release done`, so a second open hold means
        // the journal is telling us something this pairing cannot model — the
        // first hold's end is unknown, and the second's whole span is
        // unaccounted. Keeping the first `holdOpenAt` keeps `holdMs` a floor;
        // the flag is what stops the floor being read as a total. Dropping the
        // row silently, as this arm did, left `activeMs` looking measured.
        else if (r.act === 'hold') { if (holdOpenAt === null) holdOpenAt = r.at; else excludedUnmeasured = true; }
        else if (r.act === 'release') {
          if (holdOpenAt === null) excludedUnmeasured = true;
          else { holdMs += r.at - holdOpenAt; holdOpenAt = null; }
        }
      }
      if (holdOpenAt !== null) excludedUnmeasured = true;
      // ROWS THE WINDOW QUERY COULD NOT SEE (R7-2, the other direction). `at`
      // is NULL when ccd could not stamp the line (`schema.ts`: "NULL = the
      // line carried no readable `at`"), and `at IS NOT NULL` above filters
      // those out — so an unstampable swap inside this window reported
      // `swaps: 0` and read as measured. COUNTED, never inferred from the
      // filtered result set, because absence from a filtered set says nothing
      // about why a row is missing.
      //
      // DELIBERATELY UNBOUNDED BY THE WINDOW: a row with no `at` cannot be
      // placed in time at all, and `ingestedAt` is the SERVER's clock, never
      // read as an event time (D8). So any unstamped hold/release/swap this
      // worker session carries makes the window unmeasurable — conservative by
      // construction, which is the direction R7 chose.
      const unstamped = (this.db.prepare(
        'SELECT COUNT(*) AS n FROM lifecycle_events ' +
        `WHERE sessionId = ? AND outcome = 'done' AND at IS NULL AND act IN (${acts})`,
      ).get(run.sessionId, ...LIFECYCLE_WINDOW_ACTS) as { n: number }).n;
      if (unstamped > 0) excludedUnmeasured = true;
    }
    if (swaps > 0) excludedUnmeasured = true;
    // The worker's own done-claims, in order. `fromId = runs.sessionId` is the
    // filter, not `toId`: the coordinator role resolves per run, and any
    // session on the box can name a runId (attribution, not authentication).
    const waveDone = run.sessionId === null ? [] : this.db.prepare(
      "SELECT body FROM mail WHERE runId = ? AND fromId = ? AND kind = 'status' AND subject = ? ORDER BY id",
    ).all(runId, run.sessionId, WAVE_DONE_SUBJECT) as { body: string }[];
    const last = waveDone[waveDone.length - 1];
    const routingInfo = this.routingFromEvents(events);
    return {
      runId, dispatchedAt, closedAt, finalState, wallMs, holdMs, swaps, excludedUnmeasured,
      activeMs: wallMs === null ? null : Math.max(0, wallMs - holdMs),
      closeRefusals,
      firstSubmission: finalState === 'done' ? closeRefusals === 0 : null,
      waveDoneMails: waveDone.length,
      signals: last === undefined ? null : parseWaveDoneSignals(last.body),
      arm: routingInfo.arm, armUnparsed: routingInfo.armUnparsed,
      routing: routingInfo.routing, routingUnparsed: routingInfo.routingUnparsed,
    };
  }

  /**
   * The writer `programs.state` had none of, outside `openRun`'s hardcoded
   * `'active'` at first open (fix, found in a later Task 3 review — D-26):
   * the two `INSERT … ON CONFLICT(slug) DO UPDATE` sites (`openRun`,
   * `reconstruct`) both only ever touch `title` in their conflict arm, so a
   * program could never be retired. That silently disarmed
   * `resolveCoordinator(null)` the moment a SECOND program existed — its
   * "single active program" guard reads `ambiguous` (`active.length !== 1`)
   * forever once a prior program's runs finish and nothing ever moves it out
   * of `active`, which is this build's ordinary steady state, not an edge
   * case. Mirrors `setWorkItemState`'s shape.
   *
   * *Who* calls this and *when* a program should retire was deliberately left
   * to "whichever task closes the last run of a program" — Task 9's close
   * route now does (deviation D-51, found in Task 9 review: this writer had
   * ZERO callers in the tree Task 9 actually shipped, and this very
   * docstring still said "not yet written" about the task that had, by then,
   * been written for two commits). It checks `programOpenRunCount` below
   * immediately after its own final `advance()` succeeds, and calls this
   * with `'done'` or `'abandoned'` depending on how the closing run itself
   * ended — see the close route's own comment for the policy and its stated
   * limitation.
   */
  setProgramState(slug: string, state: ProgramState): void {
    this.db.prepare('UPDATE programs SET state = ? WHERE slug = ?').run(state, slug);
  }

  /** Count of this program's runs still in a NON-terminal state — the
   *  question `setProgramState`'s caller (the close route, D-51) needs
   *  answered to know whether the run it just closed was the LAST one: zero
   *  remaining means nothing under this program can dispatch, mail, or hold
   *  a workspace open any more, so `resolveCoordinator`'s "exactly one
   *  active program" guard (D-26) must stop counting it. NOT the same
   *  question `capsUsage().running` asks since design 2026-09-14 §7.1 (as
   *  corrected by D-2803): that one now names `INACTIVE_RUN_STATES_SQL`
   *  (idle ∪ terminal, dispatched/working/unknown sessions only survive it),
   *  while this one still names `TERMINAL_RUN_STATES_SQL`'s complement
   *  (every non-terminal state, IDLE included) — a program with every run
   *  parked at `awaiting-review` is still open, and must stay so.
   *
   *  `excludeRunId` (child reclamation, wave 3) asks the SAME question with one
   *  run set aside: "would closing THIS run retire the program?", which
   *  `closeRun` in `coord/close.ts` must answer BEFORE its fleet act, while the
   *  closing run is still non-terminal. One predicate, two askers — the
   *  retirement check above passes no exclusion, because by then the closing
   *  run already reads terminal inside its own transaction. `-1` when absent,
   *  an id AUTOINCREMENT never mints, so both are ONE query —
   *  `openRunsForSession`'s own idiom. */
  programOpenRunCount(program: string, excludeRunId?: number): number {
    return (this.db.prepare(
      `SELECT count(*) AS c FROM runs WHERE program = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} AND id != ?`,
    ).get(program, excludeRunId ?? -1) as { c: number }).c;
  }

  /** The one NON-TERMINAL review run naming `workRunId`, or null (design
   *  2026-09-14 §5.1 — "one review run per work run at a time"). Read fresh at
   *  both decision points that need it: the review OPEN (inside `openRun`'s own
   *  transaction) and the send-back ADVANCE (routes). `TERMINAL_RUN_STATES_SQL`
   *  is L0's pair; an `unknown`-state review run is LIVE here (D-2794).
   *
   *  An unrepresentable id answers null — D-2545's family; the route's `run()`
   *  read of the same row will refuse first on every path that reaches it. */
  reviewInFlightFor(workRunId: number): number | null {
    const row = this.db.prepare(
      `SELECT CAST(id AS TEXT) AS idText FROM runs WHERE reviews = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} ORDER BY id LIMIT 1`,
    ).get(workRunId) as { idText: string } | undefined;
    if (!row) return null;
    const id = Number(row.idText);
    return isPositiveDecimalSafeInteger(id) ? id : null;
  }

  programs(): { slug: string; title: string; state: ProgramState }[] {
    const rows = this.db.prepare('SELECT slug, title, state FROM programs ORDER BY slug')
      .all() as { slug: string; title: string; state: string }[];
    // D-8: read through the guard, never a cast — the same rule `run()` below
    // holds for `RunState`.
    return rows.map((r) => ({ slug: r.slug, title: r.title, state: isProgramState(r.state) ? r.state : 'unknown' }));
  }

  /**
   * The project whose repository holds this programme's ledger, spec and plan —
   * or `null` when the row stores none (design §3 F2).
   *
   * TWO CONDITIONS ANSWER NULL and the caller must not fold them: a programme
   * row whose `homeProject` IS NULL, and a slug with no programme row at all.
   * The open route establishes existence first (`programs()`) and only then
   * asks this method, because it records `home-project-backfilled` for the
   * first and nothing for the second. Stated here rather than encoded in the
   * return type, which is a compromise this build wrote down rather than hid.
   */
  programHome(slug: string): string | null {
    const row = this.db.prepare('SELECT homeProject FROM programs WHERE slug = ?')
      .get(slug) as { homeProject: string | null } | undefined;
    return row?.homeProject ?? null;
  }

  /**
   * Backfill a programme's home — and ONLY a backfill (design §3 F2, "first
   * writer wins").
   *
   * `WHERE homeProject IS NULL` is the whole method. A programme's home is a
   * fact it carries forever, and an unconditional UPDATE here would make
   * `home-mismatch` decorative: the route refuses a differing home, and a write
   * that could overwrite one would be a second, quieter path to the same move.
   * The predicate is in SQL rather than in a route branch so it holds for every
   * future caller, not just today's one.
   */
  setProgramHome(slug: string, home: string): void {
    this.db.prepare('UPDATE programs SET homeProject = ? WHERE slug = ? AND homeProject IS NULL')
      .run(home, slug);
  }

  /** `MeasuredRunRow` -> `RunRow`. The one place a raw `runs` row becomes the
   *  typed shape everything else in this class and its callers use — every enum
   *  column goes through its guard here, never a cast, so this is also the
   *  one place that rule could be forgotten for a future column.
   *
   *  It takes a MEASURED row rather than a raw one (D-2545) so that the four
   *  persisted integers cannot arrive here unproven: the proof is a
   *  precondition of the type, not a step a future caller could skip. */
  private hydrateRun(m: MeasuredRunRow, health: RunHealth): RunRow {
    const row = m.row;
    return {
      // The four PROVEN integers (D-2545), never `Number(row.…)` here: this
      // method is handed a row whose id, wave, waveOf and reviews have already
      // been measured, precisely so it cannot be the place the proof is
      // forgotten.
      id: m.nums.id, program: row.program, programTitle: row.programTitle,
      // Straight off the `programs` join, on `programTitle`'s idiom: a free-form
      // project name, no vocabulary to read it through. NULL means the programme
      // row stores no home — never a value this build could not read.
      homeProject: row.homeProject,
      wave: m.nums.wave, waveOf: m.nums.waveOf, project: row.project,
      sessionId: row.sessionId, workspace: row.workspace, branch: row.branch,
      state: isRunState(row.state) ? row.state : 'unknown',
      kind: isRunKind(row.kind) ? row.kind : 'unknown',
      reviews: m.nums.reviews,
      // `runs.claimedBy` — TEXT, nullable — read straight through on
      // `sessionId`/`workspace`/`branch`'s idiom two lines up, with no guard
      // of its own: it is a free-form tmux-derived session id, not an enum, so
      // there is no vocabulary to read it through. NULL means no owner was
      // recorded (an older row, a hand-inserted recovery row), never a value
      // this build could not read; `RunSummary.claimedBy` says what a reader
      // does with that.
      claimedBy: row.claimedBy,
      resumed: row.resumed !== 0,
      // A real column (`runs.clearedAt`), read straight through — not a
      // placeholder. `setClearedAt` is Task 9's dispatch route's own write
      // (fix, review finding 28: this comment called that route "Task 9's"
      // as future tense for two fix rounds after it landed and started
      // calling `setClearedAt`) — null still means exactly what it always
      // did for a run that has not resumed-and-cleared: "nothing has
      // cleared anything," never a stand-in for a missing column.
      clearedAt: row.clearedAt,
      // A real column too (`runs.dispatchStartedAt`, migration 5), read
      // straight through on `clearedAt`'s idiom directly above. NULL means no
      // FRESH-SPAWN dispatch has started — which is two named conditions, not
      // one: nobody has dispatched this run, OR every dispatch it has had was a
      // wave N>=2 resume (D-1), which mints no workspace and stamps nothing.
      // Both are stated on `RunSummary.dispatchStartedAt`; neither is ever a
      // stand-in for a column this build could not read.
      dispatchStartedAt: row.dispatchStartedAt,
      openedAt: row.openedAt, dispatchedAt: row.dispatchedAt, closedAt: row.closedAt,
      handoffCommit: row.handoffCommit,
      items: this.itemTally(m.nums.id),
      unreadMail: this.unreadMailCount(m.nums.id, row.sessionId),
      // F7. Passed IN rather than measured here, and that is the whole design:
      // `hydrateRun` runs once per row, and four more per-row reads would cost
      // the board 2,000 more statements on a `?closed=1` load. `runHealth` answers
      // for the whole batch in four (D-1299). A REQUIRED parameter, so a caller
      // cannot forget it and quietly ship a zeroed health object.
      health,
      prLineage: row.prLineage ? (JSON.parse(row.prLineage) as PrLineageEntry[]) : [],
      // Read straight through, on `homeProject`'s idiom: a free-form project
      // name stamped once at open time (migration 12), never re-derived here.
      // NULL means "not stamped" — an older row, or an open whose registry
      // read came back absent/unlistable — and `RunRow`'s own docstring says
      // this stays off the wire (`toRunSummary` strips it alongside
      // `prLineage`).
      coordProject: row.coordProject,
    };
  }

  private unreadMailCount(runId: number, sessionId: string | null): number {
    if (sessionId === null) return 0;
    return (this.db.prepare(
      'SELECT count(*) AS c FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
      'LEFT JOIN runs rr ON rr.id = m.runId ' +
      `WHERE m.runId = ? AND d.toId = ? AND ${OUTSTANDING_OR_ABANDONED_SQL}`,
    ).get(runId, sessionId) as { c: number }).c;
  }

  /** `runHealth` for a batch of rows already read AND MEASURED — the shape
   *  `runs()`/`run()` hold. Keeps the id/coordinator extraction in one place so
   *  the two call sites cannot disagree about which sessions count as
   *  coordinators. `MeasuredRunRow`, not `RunRowDb`: it reads `id`, and with
   *  the id read as TEXT (D-2545) the number does not exist until validation
   *  has run — which is why validation now precedes this call rather than
   *  following it. */
  private healthFor(rows: readonly MeasuredRunRow[]): Map<number, RunHealth> {
    const coords = [...new Set(rows.map((r) => r.row.claimedBy).filter((c): c is string => c !== null))];
    return this.runHealth(rows.map((r) => r.nums.id), coords);
  }

  /**
   * THE ONE COUNT of a run's refused wave-dones — the `mail_rejections` rows
   * `closeRun` writes through `recordRejection` with a `DONE_AUTHORITY_CODES`
   * code — and, riding the same statement, the newest one's code.
   *
   * Private because it is a measurement two PUBLIC surfaces must agree on, not
   * a surface of its own: `runHealth`'s `doneRejects`/`lastRejectCode` (what
   * `GET /api/runs` ships) and `runSignals`' `closeRefusals` (what
   * `GET /api/runs/:id/signals` ships, and what `firstSubmission` is derived
   * from). Those were TWO hand-written `SELECT COUNT(*) … code IN (…)`
   * statements over the same rows (R7-3), which is the shape this file spends
   * its own doctrine on: a later edit to either predicate — an `outcome`
   * filter, a deliberate-cancel exclusion of the kind statement (1) already
   * carries — would have moved one surface and not the other, and
   * `single-definition.test.ts` cannot see it, because it scans for KNOWN
   * fragments, not for a second count of one table. `run-signals.test.ts`
   * holds the two surfaces equal for a run with a refusal, which is the
   * mechanism this comment would otherwise only be requesting.
   *
   * The correlated subquery orders by `at` and then `id`, because
   * `recordRejection` stamps its own `Date.now()` and a retried close can write
   * two rows inside one millisecond.
   *
   * ONE statement, whatever the row count — `runHealth`'s "at most four
   * statements TOTAL" budget is stated in terms of this being one of them.
   * A run with no refusals gets NO entry (the `GROUP BY` emits none); both
   * callers supply their own zero, as they always did.
   */
  private doneRejectCount(runIds: readonly number[]): Map<number, { count: number; lastCode: string | null }> {
    const out = new Map<number, { count: number; lastCode: string | null }>();
    // The caller's guard, here: `placeholders(0)` is an empty `IN ()`, a SQLite
    // syntax error.
    if (runIds.length === 0) return out;
    const ph = placeholders(runIds.length);
    const codes = placeholders(DONE_AUTHORITY_CODES.length);
    for (const row of this.db.prepare(
      'SELECT r.runId AS runId, count(*) AS c, ' +
      '(SELECT x.code FROM mail_rejections x WHERE x.runId = r.runId ' +
      `AND x.code IN (${codes}) ORDER BY x.at DESC, x.id DESC LIMIT 1) AS lastCode ` +
      `FROM mail_rejections r WHERE r.runId IN (${ph}) AND r.code IN (${codes}) GROUP BY r.runId`,
    ).all(...DONE_AUTHORITY_CODES, ...runIds, ...DONE_AUTHORITY_CODES) as unknown as
      { runId: number; c: number; lastCode: string | null }[]) {
      out.set(row.runId, { count: row.c, lastCode: row.lastCode });
    }
    return out;
  }

  /**
   * F7: every health fact for a set of runs, in FOUR statements TOTAL — not four
   * per row.
   *
   * The cost is the design (D-1299). `hydrateRun` already spends two statements per
   * row (`itemTally`, `unreadMailCount`), and `runs({includeClosed:true})` returns
   * every open run — deliberately uncapped — plus up to 500 closed ones. Four naive
   * per-row health reads would make six statements per row: ~3,000 for one board
   * load. This spends AT MOST FOUR in total, whatever the row count.
   *
   * At most, not exactly: statement (4) runs only when some run names a
   * coordinator, so the real count is three or four. The first version of this
   * sentence said "FOUR TOTAL" and issued FIVE whenever a kickoff was actually
   * outstanding — the one case the facet exists for — because it re-read `runs` a
   * second time for `claimedBy`. That read now rides statement (3), which was
   * already selecting from the same table by the same key.
   *
   * EVERY id in `runIds` gets a row, including a run with no mail at all. A caller
   * forced to supply a default for a missing key is where an overloaded null is
   * born, and this method exists to remove those, not to add one.
   *
   * SYNCHRONOUS, like the rest of this class. Reads only; writes nothing.
   */
  runHealth(runIds: readonly number[], coordIds: readonly string[]): Map<number, RunHealth> {
    const out = new Map<number, RunHealth>();
    for (const id of runIds) {
      out.set(id, { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
                    lastRejectCode: null, briefQueued: null, clearError: null,
                    coordKickoffPendingSince: null });
    }
    // `placeholders` refuses nothing, but an empty `IN ()` is a SQLite syntax
    // error and the guard is the caller's — this method's own, here.
    if (runIds.length === 0) return out;
    const ph = placeholders(runIds.length);

    // (1) outstanding vs parked, and the replay high-water. The deliberate-cancel
    //     exclusion reuses DELIBERATE_CANCEL_ERRORS_SQL rather than respelling the
    //     two literals, because a second copy is how the two lists would come to
    //     disagree — and `single-definition.test.ts`'s "spells the deliberate-cancel
    //     pair ONCE" is what stops one, in both directions: a hand-written SQL list
    //     of the pair anywhere in the four source roots, and a reader that drops the
    //     exclusion instead of copying it.
    //
    //     THAT SENTENCE NAMED A GUARD THAT DID NOT EXIST (D-1319). It shipped one
    //     wave earlier reading "`single-definition.test.ts` forbids the second copy"
    //     while that file had never mentioned this pair; the review measured a
    //     respelled list in this very query passing the whole suite green. The
    //     doctrine is the wave's own — a comment is a request, a red suite is a
    //     mechanism — and it was broken in the wave that restated it.
    for (const row of this.db.prepare(
      'SELECT m.runId AS runId, ' +
      `SUM(CASE WHEN d.state IN ${OUTSTANDING_STATES_SQL} THEN 1 ELSE 0 END) AS outstanding, ` +
      "SUM(CASE WHEN d.state = 'rejected' AND " +
      `COALESCE(d.lastError, '') NOT IN ${DELIBERATE_CANCEL_ERRORS_SQL} ` +
      'THEN 1 ELSE 0 END) AS parked, ' +
      'MAX(d.replayCount) AS replayMax ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
      `WHERE m.runId IN (${ph}) GROUP BY m.runId`,
    ).all(...runIds) as unknown as
      { runId: number; outstanding: number; parked: number; replayMax: number | null }[]) {
      const h = out.get(row.runId);
      if (h === undefined) continue;
      out.set(row.runId, { ...h, mailOutstanding: row.outstanding, mailParked: row.parked,
                           mailReplayMax: row.replayMax ?? 0 });
    }

    // (2) done-claim refusals: how many, and the newest one's code — through
    //     `doneRejectCount` above, which is where the statement itself lives
    //     (R7-3). It is STILL ONE statement, so the budget this method's own
    //     docstring states is unchanged; what moved is the ownership of the
    //     predicate, because `runSignals` counts the very same rows for
    //     `closeRefusals` and used to spell its own.
    for (const [id, rej] of this.doneRejectCount(runIds)) {
      const h = out.get(id);
      if (h === undefined) continue;
      out.set(id, { ...h, doneRejects: rej.count, lastRejectCode: rej.lastCode });
    }

    // (3) what the last committed dispatch decided, straight off the run row.
    //     `briefQueued === null` is carried through as null, never coerced: the
    //     column is nullable precisely so "no dispatch committed" and "queued no
    //     brief" stay two facts (migration 7, D-1298).
    const claimedBy = new Map<number, string>();
    for (const row of this.db.prepare(
      `SELECT id, briefQueued, clearError, claimedBy FROM runs WHERE id IN (${ph})`,
    ).all(...runIds) as unknown as
      { id: number; briefQueued: number | null; clearError: string | null;
        claimedBy: string | null }[]) {
      const h = out.get(row.id);
      if (h === undefined) continue;
      // `claimedBy` rides this pass rather than earning a fifth statement of its
      // own: the first draft re-read it below, which made this method's own
      // "four statements" sentence false exactly when the kickoff facet was
      // doing its job (review finding).
      if (row.claimedBy !== null) claimedBy.set(row.id, row.claimedBy);
      out.set(row.id, { ...h,
        briefQueued: row.briefQueued === null ? null : row.briefQueued !== 0,
        clearError: row.clearError });
    }

    // (4) the un-briefed coordinator: an OUTSTANDING operator kickoff addressed to
    //     a run's `claimedBy`.
    //
    //     `MIN(m.at)` — WHEN IT WAS FIRST SENT, which is what the wire field
    //     promises and the only one of the three available instants that is never
    //     rewritten. The first draft wrote
    //     `MIN(COALESCE(d.ingestedAt, d.deliveredAt, m.at))`, borrowing
    //     `dueDeliveries`' shape, and that made the whole facet DEAD — measured,
    //     not argued. `ingestedAt` is stamped only on an observed
    //     `UserPromptSubmit` edge, so it stays NULL for exactly the population this
    //     fact exists to name (a chair nobody ever sat in); the COALESCE then fell
    //     through to `deliveredAt`, which `markDelivered` re-stamps on EVERY
    //     replay, every `MAIL_REPLAY_MS` (600 000 ms). Against a
    //     `KICKOFF_UNACKED_MS` of 900 000 the reported age topped out at 599 999
    //     and the warning fired ZERO times across 25 replays — then the row parked
    //     at the replay ceiling, left `OUTSTANDING_STATES_SQL`, and the fact went
    //     null forever, indistinguishable from "acked, healthy".
    //
    //     The borrowed idiom was also the wrong precedent: `dueDeliveries` answers
    //     "when may this be sent again", and its own docstring records
    //     `COALESCE(ingestedAt, deliveredAt)` as a review-found defect it was fixed
    //     AWAY from, for freezing the very clock this one needs to keep moving.
    //
    //     "THEN THE ROW PARKED … AND THE FACT WENT NULL FOREVER" — the clause two
    //     paragraphs up, written as part of a DEFEATED first draft — WAS STILL TRUE
    //     OF THE FIX, and the review is what said so (D-1318).
    //     `MIN(m.at)` corrected WHEN the warning starts; it did nothing about the
    //     warning STOPPING. A kickoff nobody ever acked parks at the replay ceiling
    //     (or on a registry-absent recipient), leaves `OUTSTANDING_STATES_SQL`, and
    //     the fact goes null — and null on this field already means "acked" and
    //     "no coordinator", so the one caller renders identical silence for the
    //     wedge, which is the overloaded null this wave forbids. Statement (1)
    //     cannot compensate: a `program-kickoff` carries `m.runId IS NULL` by
    //     construction, so it is not in any run's mail at all and `mailParked`
    //     stays 0. The whole `RunHealth` came back byte-identical to a run nobody
    //     ever mailed.
    //
    //     So the predicate is `OUTSTANDING_OR_ABANDONED_SQL`, which this file
    //     already owns and whose docstring states the principle in the general
    //     case: "A message that was never acked and never acted on does not stop
    //     being a fact worth surfacing just because the lane stopped trying to hand
    //     it over." It brings the `LEFT JOIN runs rr` its `rr.state` arm needs —
    //     INERT here, and provably so rather than incidentally: `m.runId IS NULL`
    //     is in this WHERE clause, so the join matches nothing, `rr.state` is NULL
    //     and `COALESCE(rr.state,'')` is `''`. What the predicate DOES bring is the
    //     deliberate-cancel exclusion, and that arm is live and wanted:
    //     `reclaimProgram` parks the dead coordinator's kickoff with
    //     `MAIL_RECLAIM_CANCELLED_ERROR` and sends a fresh one to the new chair
    //     (D-1143's own worked example), so a reclaimed program must NOT keep
    //     drawing the corpse's wedge.
    if (coordIds.length > 0) {
      const since = new Map<string, number>();
      for (const row of this.db.prepare(
        'SELECT d.toId AS toId, MIN(m.at) AS since ' +
        'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
        'LEFT JOIN runs rr ON rr.id = m.runId ' +
        "WHERE m.fromId = 'operator' AND m.runId IS NULL AND m.subject = ? " +
        `AND d.toId IN (${placeholders(coordIds.length)}) ` +
        `AND ${OUTSTANDING_OR_ABANDONED_SQL} GROUP BY d.toId`,
      ).all(PROGRAM_KICKOFF_SUBJECT, ...coordIds) as unknown as
        { toId: string; since: number }[]) {
        since.set(row.toId, row.since);
      }
      for (const [id, h] of out) {
        const owner = claimedBy.get(id);
        const at = owner === undefined ? undefined : since.get(owner);
        if (at !== undefined) out.set(id, { ...h, coordKickoffPendingSince: at });
      }
    }
    return out;
  }

  // ── caps ───────────────────────────────────────────────────────────────────

  caps(): CoordCaps {
    const row = this.db.prepare(
      'SELECT maxConcurrentWorkers, maxSessionsPerDay FROM coordinator_state WHERE id = 1',
    ).get() as { maxConcurrentWorkers: number; maxSessionsPerDay: number };
    return { maxConcurrentWorkers: row.maxConcurrentWorkers, maxSessionsPerDay: row.maxSessionsPerDay };
  }

  /** D-1169. `at` IS THE CALLER'S NOW, the rule `recordRunEvent` states in full
   *  and `markDispatched`/`capsUsage` — the method directly below this one —
   *  already follow: the caller owns the moment being recorded. `setCaps` was the
   *  lone exception in its own neighbourhood, and the cost was concrete rather
   *  than aesthetic: a fixture that needed to pin a caps timestamp could not.
   *
   *  The clock stays where it already was, in L4 — `routes.ts` reads it INSIDE
   *  `coordMutex.run`, which `dispatch-mutex-gate.test.ts` requires of every
   *  `coord.setCaps` call site. Nothing moves into `caps.ts`, so its purity scan
   *  is untouched; the red that scan warns about is for a DEFAULTED clock
   *  parameter inside `decideCaps`, which this is not. */
  setCaps(next: CoordCaps, at: number = Date.now()): void {
    this.db.prepare(
      'UPDATE coordinator_state SET maxConcurrentWorkers = ?, maxSessionsPerDay = ?, updatedAt = ? WHERE id = 1',
    ).run(next.maxConcurrentWorkers, next.maxSessionsPerDay, at);
  }

  /** D-1169's read half. `coordinator_state.updatedAt` has been written since
   *  migration 1 and read by NOTHING — `caps()`'s SELECT does not even list the
   *  column. It rides `CoordCapsView`, the read-side shape, rather than
   *  `CoordCaps`, which is the stored value and which wave 6 declined to widen
   *  for good reason: a timestamp is not a cap.
   *
   *  `0` is the seed migration 1 writes, and it is returned as `null` here —
   *  "nobody has ever moved these caps" is a different fact from "they were moved
   *  at the epoch", and the column has no way to say the second. */
  capsUpdatedAt(): number | null {
    const row = this.db.prepare('SELECT updatedAt FROM coordinator_state WHERE id = 1')
      .get() as { updatedAt: number } | undefined;
    return row === undefined || row.updatedAt === 0 ? null : row.updatedAt;
  }

  /**
   * The two COUNTS, derived. `spec:201` says "rows in `coordinator_state`",
   * and the limits ARE rows there — but a stored counter beside them would be a
   * second copy of what `runs` already knows, and the copy is always the one
   * that drifts (`server/src/limits.ts:34-40` states the same lesson about
   * mirroring `_ws_least_loaded`: "put the authority in one place and let the
   * other predict"). Here there is no second box to predict for, so there is no
   * excuse for a second copy at all.
   */
  capsUsage(now: number = Date.now()): { running: number; dispatchedIn24h: number } {
    // `dispatchedAt IS NOT NULL` (deviation D-13, found in Task 3 review):
    // a bare "state is not terminal" predicate alone also matched `planned` —
    // the state `openRun` writes and Task 9's `ambiguous-dispatch` refusal
    // deliberately leaves a run in, with no session and no workspace. Three
    // botched dispatches on one program would otherwise pin `running` at the
    // default `maxConcurrentWorkers` forever. In normal dispatch flow
    // `dispatchedAt` is the one column only `markDispatched` ever sets, so it
    // names the runs that actually hold a session rather than every
    // non-terminal state; `reconstruct`'s `working` wave (below) is the one
    // other writer, and for the same reason — it too holds a live session,
    // just one the database lost track of rather than one `markDispatched`
    // just minted.
    //
    // Since design 2026-09-14 §7.1 (as corrected by D-2803) the predicate
    // excludes the IDLE and TERMINAL lists — `state NOT IN idle ∪ terminal`
    // — so a run at `awaiting-review`, `merging` or `closing` stops counting
    // the moment it gets there: the session beneath those states is idle by
    // contract, and an idle worker holding a fleet slot is what blocked
    // wave 6 of account-pools on 2026-09-14 (runs 39/40, 110 h at
    // awaiting-review). D-13's principle is kept and sharpened: this names
    // the runs whose session is WORKING.
    const running = (this.db.prepare(
      `SELECT count(*) AS c FROM runs WHERE dispatchedAt IS NOT NULL AND state NOT IN ${INACTIVE_RUN_STATES_SQL}`,
    ).get() as { c: number }).c;
    const dispatchedIn24h = (this.db.prepare(
      'SELECT count(*) AS c FROM runs WHERE dispatchedAt IS NOT NULL AND dispatchedAt > ?',
    ).get(now - 24 * 3600_000) as { c: number }).c;
    return { running, dispatchedIn24h };
  }

  // ── work items ─────────────────────────────────────────────────────────────

  addWorkItem(runId: number, title: string, blockedBy: readonly number[]): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO work_items (runId, title, state, blockedBy) VALUES (?, ?, ?, ?)',
    ).run(runId, title, 'pending', JSON.stringify(blockedBy));
    return { id: Number(res.lastInsertRowid) };
  }

  /** Work items have ONE invariant — `done`/`failed`/`abandoned` are terminal —
   *  and per `architecture:145-147` it gets one enforcement point rather than a
   *  `WORK_ITEM_TRANSITIONS` table (`RUN_TRANSITIONS` earns its place by
   *  encoding ~15 edges clients read as refusals; this encodes one).
   *
   *  THE GUARD IS IN THE `WHERE`, not in a read above it. A read-then-write
   *  would answer `ok` for a row a concurrent writer settled between the two
   *  statements — and, worse under a careless edit, would MOVE the row and then
   *  report the refusal. `changes === 0` past a successful lookup means exactly
   *  one thing: the row was already terminal. Mutant duty: deleting the
   *  `state NOT IN` clause, and moving the guard after the UPDATE, each go red
   *  (`coord-store.test.ts`'s two `setWorkItemState` refusal cases, which call
   *  this method DIRECTLY — `settleItems` below refuses earlier, so only a
   *  direct call can discriminate this clause).
   *
   *  RUN-SCOPED (D-278 (was D-B4-5)): `unknown-item` is spec §3.2's "an item id that is not
   *  THIS RUN's", so `runId` is part of both statements and an item of another
   *  run is unknown here, never moved. */
  private static readonly TERMINAL_SQL = `('${TERMINAL_ITEM_STATES.join("','")}')`;

  setWorkItemState(runId: number, id: number, state: WorkItemState,
                   claimedBy: string | null): SetWorkItemResult {
    const row = this.db.prepare('SELECT state FROM work_items WHERE id = ? AND runId = ?')
      .get(id, runId) as { state: string } | undefined;
    if (!row) return { ok: false, why: 'unknown-item' };
    const res = this.db.prepare(
      'UPDATE work_items SET state = ?, claimedBy = ? WHERE id = ? AND runId = ? ' +
      `AND state NOT IN ${CoordStore.TERMINAL_SQL}`,
    ).run(state, claimedBy, id, runId);
    if (Number(res.changes) === 0) {
      return { ok: false, why: 'terminal', state: isWorkItemState(row.state) ? row.state : 'unknown' };
    }
    return { ok: true, state };
  }

  /**
   * The settle batch, as ONE transaction (D-289 (was D-B4-16)) — the third member of the
   * family `dispatchRun` and `closeRun` already belong to (D-277, review
   * finding 25), and here for the same reason plus one more: spec §3.2
   * requires that "a body naming one bad id settles nothing", because
   * "partial success on a ledger write is how tallies drift".
   *
   * WHY THE PRE-PASS AND NOT A THROW. `tx` rolls back on a throw and only on a
   * throw (`db.ts`), so an in-flight refusal would otherwise need a private
   * sentinel class to travel out — in an L1 file that has no business holding
   * this handle at all (D-289). It does not need one HERE: `tx` takes the
   * write lock at `BEGIN IMMEDIATE` and `DatabaseSync` never yields the event
   * loop mid-transaction (`db.ts`'s own `tx` docstring: "no route, sweep or
   * socket can interleave inside one"), so a read taken in the pre-pass cannot
   * be overtaken before the writes below it. A refusal therefore returns
   * BEFORE anything is written, and there is nothing to roll back.
   *
   * The pre-pass carries the batch's OWN effect forward in `effective`: a body
   * naming the same id twice sees the first settle, so a second write onto a
   * now-terminal row is refused — the refusal it would earn from the `WHERE`
   * clause anyway, reached before the first write instead of after it.
   *
   * `setWorkItemState`'s `WHERE` guard stays exactly where it is and is still
   * the invariant's one home. This pass is a PRECHECK, not a second guard, and
   * it reads `TERMINAL_ITEM_STATES` — the same list the SQL literal is built
   * from — so the two cannot drift. If they somehow do, the write loop throws
   * rather than half-writing, and `tx` rolls the whole batch back.
   */
  settleItems(runId: number, items: readonly SettleItem[]): SettleItemsResult {
    return tx(this.db, () => {
      const effective = new Map<number, string>();
      for (const it of items) {
        const current = effective.get(it.id) ?? (this.db
          .prepare('SELECT state FROM work_items WHERE id = ? AND runId = ?')
          .get(it.id, runId) as { state: string } | undefined)?.state;
        if (current === undefined) return { ok: false as const, itemId: it.id, why: 'unknown-item' as const };
        if ((TERMINAL_ITEM_STATES as readonly string[]).includes(current)) {
          return { ok: false as const, itemId: it.id, why: 'terminal' as const,
            state: isWorkItemState(current) ? current : 'unknown' };
        }
        effective.set(it.id, it.state);
      }
      for (const it of items) {
        const res = this.setWorkItemState(runId, it.id, it.state, it.claimedBy);
        if (!res.ok) {
          throw new Error(
            `settleItems: item ${it.id} refused '${res.why}' inside its own transaction — ` +
            'the pre-pass and the WHERE guard disagree, which is a bug, not a refusal',
          );
        }
      }
      return { ok: true as const, items: this.itemTally(runId) };
    });
  }

  /** One run's ledger, in insertion order. Every enum read through
   *  `isWorkItemState`, never a cast — `hydrateRun`'s rule a few hundred lines
   *  up, and for its reason: a token this build does not know (a newer
   *  server's, a rolled-back binary's) reads as the designated `unknown`
   *  member rather than as a raw string nothing downstream can narrow. */
  workItems(runId: number): { id: number; title: string; state: WorkItemState; claimedBy: string | null }[] {
    const rows = this.db.prepare(
      'SELECT id, title, state, claimedBy FROM work_items WHERE runId = ? ORDER BY id',
    ).all(runId) as { id: number; title: string; state: string; claimedBy: string | null }[];
    return rows.map((r) => ({
      id: Number(r.id), title: r.title,
      state: isWorkItemState(r.state) ? r.state : 'unknown',
      claimedBy: r.claimedBy,
    }));
  }

  itemTally(runId: number): RunItemTally {
    const total = (this.db.prepare('SELECT count(*) AS c FROM work_items WHERE runId = ?')
      .get(runId) as { c: number }).c;
    const done = (this.db.prepare("SELECT count(*) AS c FROM work_items WHERE runId = ? AND state = 'done'")
      .get(runId) as { c: number }).c;
    return { done, total };
  }

  // ── mail (rows only; ingress validation is routes.ts, delivery is watch.ts) ─

  insertMail(m: { fromId: string; fromUuid: string; toId: string; runId: number | null;
                  kind: MailKind; subject: string; body: string;
                  artifacts: readonly string[] }): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body, artifacts) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(Date.now(), m.fromId, m.fromUuid, m.toId, m.runId, m.kind, m.subject, m.body,
      JSON.stringify(m.artifacts));
    return { id: Number(res.lastInsertRowid) };
  }

  /**
   * `'coordinator'` is a ROLE, not a session id (Task 7's own docstring on the
   * ingress route). With a `runId`, it is that run's own claim; with none, it
   * is the claim of the ONE active program — ambiguous (more than one active
   * program) or absent (no program is both active and claimed) both answer
   * `null`, which the caller turns into `unknown-recipient`: "no guessing" —
   * an agent-to-agent message delivered to the wrong session is worse than
   * one refused with a reason.
   *
   * Mirrors `openRun`'s own one-coordinator guard query (`claimedBy IS NOT
   * NULL ORDER BY id LIMIT 1`) rather than re-deriving a different rule for
   * the same fact.
   */
  resolveCoordinator(runId: number | null): string | null {
    if (runId !== null) {
      const row = this.db.prepare('SELECT claimedBy FROM runs WHERE id = ?')
        .get(runId) as { claimedBy: string | null } | undefined;
      return row?.claimedBy ?? null;
    }
    const active = this.db.prepare("SELECT slug FROM programs WHERE state = 'active'")
      .all() as { slug: string }[];
    if (active.length !== 1) return null;   // no single active program: ambiguous or absent
    const row = this.db.prepare(
      'SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1',
    ).get(active[0]!.slug) as { claimedBy: string | null } | undefined;
    return row?.claimedBy ?? null;
  }

  /**
   * `'worker'` is the second ROLE recipient (design 2026-09-08 §4), and it is
   * simpler than `'coordinator'` in exactly one way that matters: it is ALWAYS
   * per run. A worker is the session a run dispatched into — `runs.sessionId` —
   * so there is no single-active-programme arm here and there must not be one.
   * `resolveCoordinator(null)` can fall back because a coordinator owns a
   * PROGRAMME; nothing owns "the worker" of a fleet.
   *
   * NULL FOR TWO CONDITIONS THAT ARE ONE FACT AT THIS SEAM: the run does not
   * exist, or it has not been dispatched yet. The caller refuses both with
   * `unknown-recipient` and could not act differently on them — and the route
   * has already refused a runId naming no run at all (check 8) before it gets
   * here, so the reachable condition is the second alone.
   */
  resolveWorker(runId: number): string | null {
    const row = this.db.prepare('SELECT sessionId FROM runs WHERE id = ?')
      .get(runId) as { sessionId: string | null } | undefined;
    return row?.sessionId ?? null;
  }

  /** One delivery row by id, for the ack route: it must know who a delivery
   *  is ADDRESSED TO before deciding whether the acking session may touch it
   *  — `dueDeliveries` cannot answer that, it is scoped to what a SWEEP should
   *  inject, not to one row by id. */
  delivery(id: number): { id: number; mailId: number; toId: string; state: MailDeliveryState } | null {
    const row = this.db.prepare('SELECT id, mailId, toId, state FROM mail_deliveries WHERE id = ?')
      .get(id) as { id: number; mailId: number; toId: string; state: string } | undefined;
    if (!row) return null;
    return { id: row.id, mailId: row.mailId, toId: row.toId,
             state: isMailDeliveryState(row.state) ? row.state : 'unknown' };
  }

  /** The stored envelope for one delivery, for GET /api/mail/:id — the body
   *  channel the reference nudge (robust-mail-delivery spec §1.1/1.2) points
   *  at instead of a typed payload. Separate from `delivery()` so that route's
   *  hot path keeps its narrow 4-column select; this one adds only the single
   *  extra column a body-serving route needs. */
  deliveryEnvelope(id: number): { id: number; toId: string; state: MailDeliveryState; envelope: string } | null {
    const row = this.db.prepare('SELECT id, toId, state, envelope FROM mail_deliveries WHERE id = ?')
      .get(id) as { id: number; toId: string; state: string; envelope: string } | undefined;
    if (!row) return null;
    return { id: row.id, toId: row.toId,
             state: isMailDeliveryState(row.state) ? row.state : 'unknown', envelope: row.envelope };
  }

  /**
   * Every delivery ADDRESSED TO `toId`, newest first, as `MailSummary` — the
   * read side of `GET /api/mail?to=<id>` (review finding 15: this route fell
   * in the seam between the two plans, each naming the other as its author —
   * PR I's own D-9 said "PR J's `POST /api/runs/:id/advance`", PR J's own
   * interface list named PR I as the author of this GET route, and neither
   * shipped it). Joins through `mail_deliveries.toId` — the RESOLVED
   * recipient session, never the literal `'coordinator'` role `mail.toId`
   * may still carry (the same resolution `resolveCoordinator` already
   * performs before `queueDelivery` is ever called) — so a session reading
   * its own outstanding mail sees exactly what it was actually sent.
   * `limit` clamped the same way `feedEvents` clamps its own: a route
   * argument can never ask this table to walk more history than is
   * reasonable to JSON-stringify into one response.
   */
  mailForRecipient(toId: string, limit = 100): MailSummary[] {
    const n = clampMailLimit(limit);
    const rows = this.db.prepare(
      `SELECT ${MAIL_ROW_COLUMNS} FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ` +
      'WHERE d.toId = ? ORDER BY d.id DESC LIMIT ?',
    ).all(toId, n) as unknown as MailRowDb[];
    return this.hydrateMail(rows);
  }

  /**
   * Every delivery addressed to `toId` that still needs a human's attention,
   * newest first — `checkMail`'s (`sessionws.ts`) only caller, and the fix
   * for findings 2/4 (fix round 1): unlike `mailForRecipient`, the state
   * predicate is in the WHERE clause, so `limit` bounds these rows rather
   * than history. Before this method existed, `checkMail` filtered
   * `mailForRecipient`'s own 100-row history window in JS, AFTER the cap —
   * a delivery that was still genuinely queued, but older than the newest
   * 100 deliveries to that recipient, silently fell out of the window the
   * session mail strip watches. The coordinator session is the run-of-the-
   * mill victim: every worker's mail resolves to it (`resolveCoordinator`)
   * across every wave of a program.
   *
   * `OUTSTANDING_OR_ABANDONED_SQL`, not the narrower `OUTSTANDING_STATES_SQL`
   * (fix, review finding 2): a delivery the lane gave up retrying past its
   * own replay/attempt ceiling is `state:'rejected'` on the wire, distinct
   * from `'queued'`/`'delivered'` — a reader that cares can tell the
   * difference — but it stays in THIS list rather than disappearing from it,
   * because it was never acked and never acted on. Excludes the two
   * `'rejected'` shapes that are not abandonment (`DELIBERATE_CANCEL_ERRORS_SQL`
   * — `cancelOutstandingDeliveries`'s park, the run closing making the delivery
   * moot on purpose, and D-1143's reclaim park, the chair changing hands making
   * a kickoff moot the same way) AND, since orchestrator ruling I2(a), an abandoned row whose
   * OWN run has since reached a terminal state — see the predicate's own
   * docstring for why that is derived here, in the `LEFT JOIN runs rr` below,
   * rather than written by any mutation.
   */
  outstandingMailFor(toId: string, limit = 100): MailSummary[] {
    const n = clampMailLimit(limit);
    const rows = this.db.prepare(
      `SELECT ${MAIL_ROW_COLUMNS} FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ` +
      'LEFT JOIN runs rr ON rr.id = m.runId ' +
      `WHERE d.toId = ? AND ${OUTSTANDING_OR_ABANDONED_SQL} ORDER BY d.id DESC LIMIT ?`,
    ).all(toId, n) as unknown as MailRowDb[];
    return this.hydrateMail(rows);
  }

  /**
   * Every delivery of a mail belonging to THIS PROGRAMME (design §4), newest
   * first — the read side of `GET /api/mail?program=<slug>`.
   *
   * The join is the one `resolveCoordinator` already walks: `mail.runId` →
   * `runs.program`. An INNER join, deliberately, and it is the whole filter: a
   * mail with no `runId` cannot be PROVEN to belong to any programme — the
   * resolution that placed it is spent, and no column records which programme
   * the sender meant (D-1142's own measurement on `repointCoordinatorMail`) —
   * so it drops out here and appears only in the unfiltered reads. Guessing it
   * into a programme would be this store deciding a thing it cannot measure.
   *
   * `all` mirrors `GET /api/mail?to=`'s own flag exactly, so one word means one
   * thing on both filters: default is "still needs a human's attention"
   * (`OUTSTANDING_OR_ABANDONED_SQL`), `all` is the unfiltered history. The
   * `JOIN runs rr` the predicate needs is the SAME join the filter uses —
   * `ABANDONED_PARK_SQL` reads `COALESCE(rr.state, '')` precisely so it is
   * indifferent to the join kind its caller brings — so this query needs one
   * join, not two.
   */
  mailForProgram(program: string, opts: { limit?: number; all?: boolean }): MailSummary[] {
    const n = clampMailLimit(opts.limit ?? 100);
    const where = opts.all === true
      ? 'rr.program = ?' : `rr.program = ? AND ${OUTSTANDING_OR_ABANDONED_SQL}`;
    const rows = this.db.prepare(
      `SELECT ${MAIL_ROW_COLUMNS} FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ` +
      'JOIN runs rr ON rr.id = m.runId ' +
      `WHERE ${where} ORDER BY d.id DESC LIMIT ?`,
    ).all(program, n) as unknown as MailRowDb[];
    return this.hydrateMail(rows);
  }

  /** Who sent a mail, under which run, and about what — the three fields a
   *  SENDER-SIDE notification needs and `dueDeliveries` deliberately does not
   *  select. A dedicated one-row read rather than a JOIN widening
   *  `dueDeliveries`: that query runs over every due row on every sweep, and
   *  this runs only when a notification is actually about to be raised.
   *  SYNCHRONOUS, like everything here.
   *
   *  `fromId` is returned RAW, including the literal `'coordinator'`, which is
   *  a ROLE rather than a session id. Resolving it is the caller's job
   *  (`resolveCoordinator`) because only the caller knows whether it is about
   *  to push, and resolving here would hide the unresolvable case behind a
   *  value that looks like an id. */
  mailOrigin(mailId: number): { fromId: string; runId: number | null; subject: string } | null {
    const row = this.db.prepare('SELECT fromId, runId, subject FROM mail WHERE id = ?')
      .get(mailId) as { fromId: string; runId: number | null; subject: string } | undefined;
    return row ?? null;
  }

  /** `MailRowDb` -> `MailSummary`: the one place a raw joined mail/delivery
   *  row becomes the typed shape, shared by `mailForRecipient` and
   *  `outstandingMailFor` — they differ only in their WHERE clause, never in
   *  how a row is read. */
  private hydrateMail(rows: readonly MailRowDb[]): MailSummary[] {
    return rows.map((r) => ({
      id: r.id, deliveryId: r.deliveryId, at: r.at, fromId: r.fromId, toId: r.toId, runId: r.runId,
      kind: isMailKind(r.kind) ? r.kind : 'unknown', subject: r.subject,
      artifacts: JSON.parse(r.artifacts) as string[],
      state: isMailDeliveryState(r.state) ? r.state : 'unknown',
      // RAW, both of them. `lastError` is free text — see
      // `MailSummary.lastError`'s own docstring for the rule every client owes
      // it; narrowing it HERE would be this store deciding
      // a display question on the reader's behalf, and would drop exactly the
      // detail a maintainer greps the column for.
      attempts: r.attempts, lastError: r.lastError,
      // The gate half is NARROWED here and `lastError` above is not, and the
      // difference is the point: `lastGate` is a CLOSED union, so an
      // unrecognised token is a server/client version mismatch that must not
      // reach a client as a `MailGate` it will key a total record off. It
      // degrades to null — "nothing to say about a gate" — which is the same
      // thing absence means on the wire.
      lastGate: isMailGate(r.lastGate) ? r.lastGate : null,
      gateCount: r.gateCount, gateSince: r.gateSince, gateAt: r.gateAt,
    }));
  }

  /** Whether an OUTSTANDING (`queued` or `delivered`, unacked) mail already
   *  exists for this (runId, toId, subject) — review finding 33: a retried
   *  close re-entering the SAME done-claim rejection queued a fresh mail +
   *  delivery row, and a fresh non-collapsing push (spec:236-237), on EVERY
   *  retry, with no dedupe and no rate limit. `subject` alone identifies
   *  "the same fact restated" for the two system-mail subjects this build
   *  ever sends on a retry loop (`wave-brief`, `wave-done-rejected`) —
   *  `queueSystemMail`'s own call sites are the only run-mail callers.
   *
   *  `m.runId IS ?`, not `= ?` (Build 9b wave 0, D10 hole 1): `runId` is
   *  nullable — peer mail is `runId:null` by definition — and a bound NULL
   *  under `=` equals nothing, so for exactly the traffic Wave 7 adds a
   *  second producer for, the dedupe guard structurally could not fire.
   *  SQLite's `IS` is null-safe on both arms, so a number still matches its
   *  own rows and ONLY a null matches the null ones: one query, one reader,
   *  no second method.
   *
   *  `m.fromId = ?` since program-leverage wave 4 (D-1041). The paragraph above
   *  used to end "…keyed WITHOUT the sender, because the coordinator is its only
   *  sender", and that premise was true only while every system mail carried a
   *  RUN. Wave 4 queues one that does not — the program kickoff, sent before the
   *  coordinator has opened anything to be the coordinator OF — so system mail
   *  and PEER mail now share the `runId IS NULL` key space, and peer `subject` is
   *  caller-chosen free text bounded only in bytes. Un-scoped, a peer mail that
   *  happened to carry the kickoff's subject would have made `queueSystemMail`
   *  return with no row, no error and no record. The collision was one-way, which
   *  is why nothing had caught it: `hasOutstandingPeerDuplicate` below was
   *  sender-scoped from the start, so a kickoff never blocked a peer — only a
   *  peer could swallow a kickoff. */
  hasOutstandingMail(fromId: string, runId: number | null, toId: string, subject: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      'WHERE m.fromId = ? AND m.runId IS ? AND d.toId = ? AND m.subject = ? ' +
      `AND d.state IN ${OUTSTANDING_STATES_SQL} LIMIT 1`,
    ).get(fromId, runId, toId, subject);
    return row !== undefined;
  }

  /** Whether an OUTSTANDING peer mail with this exact (fromId, toId, subject)
   *  triple exists — the 409 'duplicate' probe (Build 9b wave 0, D10 hole 2).
   *  `runId IS NULL` no longer scopes it to the peer lane by construction —
   *  program-leverage wave 4 (D-1041) put a run-less SYSTEM mail in that space,
   *  the program kickoff — but `m.fromId = ?` still does, and always did. System
   *  mail has its own dedupe (`hasOutstandingMail` above, via `queueSystemMail`),
   *  now keyed by sender for the same reason this one always was. `toId`
   *  here is the RESOLVED recipient — the id `mail_deliveries.toId` actually
   *  carries — never the pre-resolution role. */
  hasOutstandingPeerDuplicate(fromId: string, toId: string, subject: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      'WHERE m.runId IS NULL AND m.fromId = ? AND d.toId = ? AND m.subject = ? ' +
      `AND d.state IN ${OUTSTANDING_STATES_SQL} LIMIT 1`,
    ).get(fromId, toId, subject);
    return row !== undefined;
  }

  /** How many peer mails from `fromId` to `toId` are OUTSTANDING (`queued` or
   *  `delivered`, unacked) — the pair arm of the 429 'peer-quota' bound. An
   *  ack or a park frees the slot: the bound is on standing pressure against
   *  one recipient, not on history (the hourly arm below is the one history
   *  bound, and it deliberately uses a different denominator). */
  outstandingPeerCount(fromId: string, toId: string): number {
    return (this.db.prepare(
      'SELECT COUNT(*) AS n FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ' +
      `WHERE m.runId IS NULL AND m.fromId = ? AND d.toId = ? AND d.state IN ${OUTSTANDING_STATES_SQL}`,
    ).get(fromId, toId) as { n: number }).n;
  }

  /** How many peer mails `fromId` has had ACCEPTED in the sliding hour before
   *  `now` — the per-sender arm of the 429 'peer-quota' bound. Counts `mail`
   *  ROWS (inserts), not deliveries and not delivery state: a refusal inserts
   *  no row and charges nothing; an ack does not refund the hour. `now` is
   *  the caller's clock, passed in rather than read here — the same
   *  policy-stays-with-the-caller reason `dueDeliveries`/`capsUsage` already
   *  take theirs. */
  peerMailInLastHour(fromId: string, now: number): number {
    return (this.db.prepare(
      'SELECT COUNT(*) AS n FROM mail WHERE runId IS NULL AND fromId = ? AND at > ?',
    ).get(fromId, now - 3_600_000) as { n: number }).n;
  }

  queueDelivery(mailId: number, toId: string, envelope: string): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO mail_deliveries (mailId, toId, state, envelope) VALUES (?, ?, ?, ?)',
    ).run(mailId, toId, 'queued', envelope);
    return { id: Number(res.lastInsertRowid) };
  }

  /**
   * Overwrites a delivery's stored `envelope`, once, immediately after
   * `queueDelivery`. THREE direct callers, each doing exactly that and none of
   * them a re-render: the ingress route in `routes.ts`, the system-mail queue
   * in `rundefs.ts` (which has called it since Build 7 — this sentence said
   * "the ingress route ONLY" for two builds while it did: D-1426), and
   * `requeueAbandonedMail` in this file, which renders the heir's own envelope
   * for a second delivery of one mail. Pinned by `single-definition.test.ts`'s
   * "setDeliveryEnvelope names every caller it has", which derives the caller
   * set from `server/src` rather than reading this sentence. It exists to
   * close a bug fix-round finding 5 / D-41 named: the envelope's own `ack:`
   * line has to name the DELIVERY id (what `delivery(id)`/`markAcked` resolve
   * by, both above), but `mail.id` and `mail_deliveries.id` are two SEPARATE
   * `AUTOINCREMENT` sequences (`schema.ts`) that only happen to walk together
   * while every mail resolves to exactly one delivery. The delivery id does
   * not exist until the row is inserted, so each caller inserts the row with
   * an empty envelope, renders the real one now that it can name the
   * delivery's own id, and calls this to land it. This is the second half of
   * that one INSERT, not a re-render: `renderEnvelope` itself still runs
   * exactly once, at queue time (spec:176-177, "verbatim, never re-rendered"),
   * and this method never re-derives its argument — it only stores what the
   * caller already computed.
   *
   * GUARDED. The three direct callers expand to FIVE reachable paths, all in
   * the same transaction as their `queueDelivery`: the mail route's send `tx`,
   * the system-mail queue's own `tx`, `dispatchRun`'s dispatch `tx` through
   * `markDispatched` -> `bindSession` -> `requeueAbandonedMail`,
   * `reclaimProgram`'s `tx`, and the open route's post-hold `tx` through
   * `setSession` -> `bindSession` (D-2505). `tx` is `BEGIN IMMEDIATE` over a
   * synchronous `DatabaseSync`, so those paths see no concurrent writer and
   * the row this stamps is provably `'queued'`. The `state NOT IN
   * ${TERMINAL_DELIVERY_SQL}` guard and the result union still refuse and expose
   * a row that is already terminal rather than silently overwriting it. The guard is
   * here because a writer whose safety rests on its callers' shape breaks
   * silently when an unguarded path appears — as one did in this wave — and
   * because an audit with one exception in it is an audit nobody finishes. DO
   * NOT "simplify" it away: it costs one `AND`, and it is what lets
   * `mail-hardening.test.ts`'s writer scan say EVERY with no carve-out
   * (D-1409).
   *
   * The result is a union rather than `void` for the reason `bumpReplayCount`
   * states below — "the union is the fix; the guard alone is not". Adding a
   * guard and keeping `void` would have put a caller-invisible refusal into one
   * of the very methods this wave exists to fix. `'absent'` and `'terminal'`
   * are separated because they are two conditions a caller handles differently:
   * the first means the row this transaction just inserted is gone, the second
   * means someone else finished this delivery. */
  setDeliveryEnvelope(id: number, envelope: string): SetEnvelopeResult {
    const res = this.db.prepare(
      `UPDATE mail_deliveries SET envelope = ? WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`,
    ).run(envelope, id);
    if (Number(res.changes) > 0) return { ok: true };
    const row = this.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?')
      .get(id) as { state: string } | undefined;
    if (!row) return { ok: false, why: 'absent' };
    return { ok: false, why: 'terminal',
             state: isMailDeliveryState(row.state) ? row.state : 'unknown' };
  }

  /**
   * The due set for one sweep — two arms, not one (deviation, found in Task 3
   * review — see the plan's D-10). Spec:174-177 requires replay: "Until
   * acked, the delivery replays — verbatim, never re-rendered — on later
   * sweeps after cooldown." Only the `queued` arm shipped originally —
   * `markDelivered` moves a row OUT of `queued` and nothing ever moved it
   * back, so an unacked delivery could never be re-selected once injected,
   * which made replay-until-ack structurally impossible.
   *
   * `replayMs` is the caller's `MAIL_REPLAY_MS` (Task 8, `watch.ts`), passed
   * in rather than owned here: this file stores rows, it does not own mail
   * delivery POLICY — the same reason `capsUsage`/`markDispatched` take `now`
   * from the caller instead of calling `Date.now()` internally.
   *
   * The replay arm ALSO gates on `nextAttemptAt` (fix, found in Task 3
   * review — the two arms were asymmetric: `queued`'s arm always read it,
   * `delivered`'s never did). `backOff` writes `attempts`/`lastError`/
   * `nextAttemptAt` on whatever row it is given, delivered rows included —
   * it never moves a row's `state` — so a delivered row that just backed off
   * was selected again on the very next sweep regardless of the spacing
   * `backOff` had just written, making exponential backoff a no-op for
   * every replay (spec:170-172 held only for a delivery's first attempt).
   * The column defaults to 0, so a delivered row that has never backed off
   * is unaffected by this clause.
   *
   * `MAX(COALESCE(ingestedAt, 0), COALESCE(deliveredAt, 0))`, not
   * `COALESCE(ingestedAt, deliveredAt)` (fix, review findings 2/6): a REPLAY
   * calls only `markDelivered`, which writes a fresh `deliveredAt` and never
   * touches `ingestedAt` (`markIngested`'s own docstring). Under the old
   * `COALESCE`, once `ingestedAt` had ever been written once it was picked
   * forever and the new, later `deliveredAt` a replay just wrote was
   * silently ignored — so the clock froze at the FIRST `UserPromptSubmit`
   * edge and every replay after that one was due again almost immediately,
   * spaced only by the per-session `MAIL_COOLDOWN_MS` instead of
   * `MAIL_REPLAY_MS` (a 120 s floor standing in for the intended 10
   * minutes). `MAX` always picks whichever of the two actually happened
   * last, so a fresh replay's `deliveredAt` re-dates the clock exactly the
   * way the first delivery's did. Both arguments are `COALESCE`d to `0`
   * because SQLite's multi-argument `max()` returns NULL — not the other
   * argument — the instant ANY argument is NULL, and `ingestedAt` is NULL
   * until the first edge is ever observed.
   */
  dueDeliveries(now: number, replayMs: number): { id: number; mailId: number; toId: string;
                                attempts: number; lastError: string | null; envelope: string;
                                deliveredAt: number | null; ingestedAt: number | null;
                                lastGate: string | null; gateSince: number | null }[] {
    return this.db.prepare(
      // `lastError` (Task 409) is the row's INCOMING failure — what it already
      // carried before this sweep touched it — which is how `sweepMail` tells
      // a NEW block from a repeat of the same one without re-reading the row
      // it is about to write and racing itself.
      // `lastGate`/`gateSince` ride along for the SAME reason `lastError` does
      // (D-792): `noteGate` must tell a repeat of the same gate from a change
      // of gate, and reading the row again at write time would race the sweep
      // against itself on exactly the rows it is deciding about.
      'SELECT id, mailId, toId, attempts, lastError, envelope, deliveredAt, ingestedAt, ' +
      'lastGate, gateSince FROM mail_deliveries ' +
      "WHERE (state = 'queued' AND nextAttemptAt <= ?) " +
      "OR (state = 'delivered' AND MAX(COALESCE(ingestedAt, 0), COALESCE(deliveredAt, 0)) + ? <= ? " +
      'AND nextAttemptAt <= ?) ' +
      'ORDER BY id',
    ).all(now, replayMs, now, now) as { id: number; mailId: number; toId: string; attempts: number;
                    lastError: string | null; envelope: string;
                    deliveredAt: number | null; ingestedAt: number | null;
                    lastGate: string | null; gateSince: number | null }[];
  }

  /**
   * Every `delivered`, unacked row, with NO timing filter — unlike
   * `dueDeliveries` above, which only surfaces a `delivered` row once
   * `replayMs` has already elapsed since it last moved the clock. That is
   * exactly wrong for the ONE thing `ingestedAt` exists to do (review
   * finding 3): `hookstate.ts`'s own docstring calls a `UserPromptSubmit`
   * newer than delivery "the cheapest available proof that the injected
   * turn actually STARTED" — proof that is only worth anything while the
   * turn it is proving might still be running, i.e. in the minutes right
   * after delivery, not ten minutes later once `dueDeliveries` finally
   * agrees to look. A sweep that samples the edge only through
   * `dueDeliveries`'s own result can therefore never observe it before the
   * replay it was supposed to prevent. This is the set that sweep instead
   * walks EVERY tick of its own clock, independent of due-ness, purely to
   * keep `ingestedAt` current.
   */
  deliveredUnacked(): { id: number; toId: string; deliveredAt: number | null; ingestedAt: number | null }[] {
    return this.db.prepare(
      "SELECT id, toId, deliveredAt, ingestedAt FROM mail_deliveries WHERE state = 'delivered'",
    ).all() as { id: number; toId: string; deliveredAt: number | null; ingestedAt: number | null }[];
  }

  /** `WHERE state NOT IN ${TERMINAL_DELIVERY_SQL}` (fix — review finding 22,
   *  widened by a scoped-verify fix — a park must not be reopened either):
   *  `sweepMail` reads the row it is about to (re)send BEFORE
   *  `await sendPrompt(...)`, and writes the outcome AFTER — a window of
   *  several seconds to half a minute in which `POST /api/mail/:id/ack` can
   *  land on the SAME row via `markAcked`, exactly finding 22's race. The
   *  identical window also lets a PARK land on the row: `POST
   *  /api/runs/:id/close` -> `cancelOutstandingDeliveries`, or `sweepMail`'s
   *  own replay-ceiling/reaped-recipient calls to `rejectDelivery` below —
   *  all write `state='rejected'` from a SEPARATE code path than the one
   *  whose in-flight send this row belongs to. `!= 'acked'` alone let that
   *  in-flight send's `ok` resolve AFTER the park committed and overwrite it
   *  right back to `state='delivered'`, leaving the row self-contradictory
   *  (`rejectCode` non-null, `state='delivered'`) and — the harm
   *  `cancelOutstandingDeliveries` exists to prevent — re-eligible for
   *  `dueDeliveries`'s replay arm again: wave N's mail replaying into wave
   *  N+1's freshly `/clear`-ed context. `'acked'` and `'rejected'` are this
   *  build's only two states a send racing a concurrent writer must never
   *  reopen; every other three-writers-of-this-column guard
   *  (`rejectDelivery` below) carries the identical `NOT IN` list for the
   *  same reason. `markAcked` itself refuses a terminal row in its own
   *  `WHERE` for the identical reason (see its own docstring). */
  markDelivered(id: number, at: number): void {
    this.db.prepare(
      // The gate columns clear IN THE SAME STATEMENT as the move (D-792), so
      // the existing `state NOT IN (...)` guard covers them too and a row the
      // guard skips keeps its gate. A second UPDATE could clear a gate off a
      // row this one declined to touch.
      "UPDATE mail_deliveries SET state = 'delivered', deliveredAt = ?, " +
      `lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`,
    ).run(at, id);
  }

  /**
   * `mail_deliveries.replayCount + 1`, answered as a STATE (review finding
   * 20; union — Build 9b wave 0, D10 hole 4). Called by the sweep AFTER
   * `markDelivered`, and ONLY when the row it read was already `delivered`
   * before this send — i.e. this send was a REPLAY, not the first delivery.
   * Kept independent of `attempts` (`MAIL_MAX_ATTEMPTS`'s own docstring:
   * SEND FAILURES only) on purpose: without a separate counter,
   * spec:174-177's replay-until-ack has no ceiling at all once a delivery
   * succeeds even once — `MAIL_COOLDOWN_MS` only SPACES the injections, it
   * was never a bound on their number, and a delivery that keeps succeeding
   * can never fail its way into `MAIL_MAX_ATTEMPTS`. This is the ceiling
   * that lets a delivery no one ever acks eventually reach
   * `rejected('undeliverable')` — the spec's own terminal state, otherwise
   * structurally unreachable for exactly the deliveries that succeed.
   *
   * `AND state NOT IN ${TERMINAL_DELIVERY_SQL}` — the same guard every other
   * writer of this table carries (`markDelivered`/`backOff`/`rejectDelivery`
   * above and below), closing the same seconds-to-half-a-minute window in
   * which an ack or a park lands from a separate code path between the
   * sweep's read and this write. And the RETURN is a union, not a bare
   * number, because the guard alone would hand the caller the row's
   * unchanged count — a value that reads as "not yet at the ceiling" for a
   * row already parked: two conditions, one value, at a seam (D10: "the
   * union is the fix; the guard alone is not"). `{state:'terminal'}` also
   * answers for a row that does not exist at all — collapsed deliberately
   * and stated here rather than papered over: nothing in this tree DELETEs
   * from `mail_deliveries` (D10's own measurement — "bound the producer,
   * never the record"), and the single caller's handling of the two is
   * identical (skip the ceiling check), so the collapse is of two conditions
   * no caller distinguishes.
   */
  bumpReplayCount(id: number): { state: 'counted'; replayCount: number } | { state: 'terminal' } {
    const res = this.db.prepare(
      `UPDATE mail_deliveries SET replayCount = replayCount + 1 WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`,
    ).run(id);
    if (res.changes === 0) return { state: 'terminal' };
    return {
      state: 'counted',
      replayCount: (this.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?')
        .get(id) as { replayCount: number }).replayCount,
    };
  }

  /** The `UserPromptSubmit` edge (`hookstate.ts:23-34`). Deliberately does
   *  NOT touch `deliveredAt` — a REPLAY re-dates the clock through its own
   *  fresh `markDelivered` call, and `dueDeliveries`'s `MAX(...)` above is
   *  what combines the two rather than either writer clobbering the other's
   *  column. `AND state NOT IN ${TERMINAL_DELIVERY_SQL}` (Build 9b wave 0, D10
   *  hole 3): shielded until now only by its caller's query filter
   *  (`deliveredUnacked()` selects `delivered` rows) — a filter is a
   *  courtesy of one caller, a guard is a property of the row; the same
   *  ack-or-park-lands-mid-window race every sibling writer here already
   *  guards against. */
  markIngested(id: number, at: number): void {
    this.db.prepare(
      `UPDATE mail_deliveries SET ingestedAt = ? WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`,
    ).run(at, id);
  }

  /** Refuses — and NAMES the refusal — when already acked, absent, or PARKED
   *  (D-1410). An ack is idempotent, but the CALLER (the ack route) needs to
   *  know whether ITS call was the one that landed, so a double-ack (or a late
   *  ack racing a park) answers honestly rather than reporting success twice;
   *  and it needs the two refusals APART, which one boolean could not give it.
   *  `'rejected'` joins `'acked'` in the refusal (fix — scoped-verify H2): a
   *  park is a DECISION that this delivery is done — undeliverable, and
   *  terminal — the same reason `markDelivered` above and `rejectDelivery`
   *  below both refuse to reopen a `'rejected'` row; an ack landing after
   *  `POST /api/runs/:id/close` ->
   *  `cancelOutstandingDeliveries` (or a replay-ceiling/reaped-recipient
   *  park) already committed had no such guard, so it flipped the row to
   *  `{state:'acked', rejectCode:'undeliverable'}` — self-contradictory, and
   *  the gap `markDelivered`'s own docstring already claimed shut ("`acked`
   *  and `rejected` are this build's only two states a concurrent writer
   *  must never reopen... `markAcked` itself refuses a terminal row in its
   *  own `WHERE` for the identical reason") before this fix made that claim
   *  true here too. Harmless for replay either way (`dueDeliveries` selects
   *  neither `acked` nor `rejected`), but a row is not allowed to claim both
   *  an ack and a park happened to it.
   *
   *  ONE NAMED EXCEPTION (orchestrator ruling I2, part (b)): a row whose
   *  rejection is EXACTLY the replay-ceiling park — `rejectCode:'undeliverable'`
   *  and `lastError:MAIL_REPLAY_CEILING_ERROR`, the two columns
   *  `watch.ts`'s `sweepMail` writes together and only there — may still be
   *  acked. D-67/H2 above refuse a LATE ack racing a park so a
   *  self-contradictory row can never appear silently; this is a DIFFERENT
   *  act, requested explicitly, well after the park already committed and
   *  nothing is racing it: the recipient FINALLY SEEING an abandoned message
   *  is exactly what "acked" means, and the resulting row — `state:'acked'`,
   *  its park still readable in `lastError` — is the honest record of both
   *  things that happened to it, in order. The match is narrow and exact
   *  (both columns, not merely `state='rejected'`) so no OTHER park —
   *  `cancelOutstandingDeliveries`'s `'run closed'`, the never-delivered
   *  `MAIL_MAX_ATTEMPTS` park, an `enter-ignored` park — is ever let back in
   *  through this door; every one of those stays refused, unchanged.
   *
   *  THE GUARD IS NOW IN THE `WHERE`, not in the two `if`s that used to precede
   *  the write, and the I2(b) exception rides in the same clause as an `OR` on
   *  both columns. The SELECT no longer DECIDES — it only LABELS a refusal the
   *  UPDATE already made, which closes the read-then-write window this method
   *  carried: in-process it was airtight (synchronous `DatabaseSync`, no
   *  `await` between the two statements), but that safety was a property of the
   *  runtime, not of the row, and one added `await` would have removed it
   *  silently. An out-of-vocabulary `state` token still passes — the negative
   *  form is true of anything that is not in `TERMINAL_DELIVERY_STATES` — which
   *  is exactly the behaviour this method had before and is deliberately NOT
   *  changed here: whether an unnameable state is terminal is an open design
   *  question (D-1406), and answering it inside a refactor
   *  would be deciding it by accident. */
  markAcked(id: number, at: number): MarkAckedResult {
    // UPDATE FIRST, then label. One statement decides; the read that follows is
    // only there to say WHICH refusal it was.
    const res = this.db.prepare(
      'UPDATE mail_deliveries SET state = ?, ackedAt = ?, '
      + 'lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL '
      + `WHERE id = ? AND (state NOT IN ${TERMINAL_DELIVERY_SQL} `
      + "OR (state = 'rejected' AND rejectCode = 'undeliverable' AND lastError = ?))",
    ).run('acked', at, id, MAIL_REPLAY_CEILING_ERROR);
    if (Number(res.changes) > 0) return { ok: true, state: 'acked' };
    const row = this.db.prepare('SELECT state, lastError FROM mail_deliveries WHERE id = ?')
      .get(id) as { state: string; lastError: string | null } | undefined;
    if (!row) return { ok: false, why: 'absent' };
    const state: MailDeliveryState = isMailDeliveryState(row.state) ? row.state : 'unknown';
    if (row.state === 'acked') return { ok: false, why: 'already-acked', state };
    return { ok: false, why: 'parked', state, lastError: row.lastError };
  }

  /** `WHERE state NOT IN ${TERMINAL_DELIVERY_SQL}` (fix — scoped-verify H1, the
   *  same guard `markDelivered`/`rejectDelivery` below carry): this is the
   *  sweep's own SEND-FAILURE path, resolving on `sendPrompt`'s own delayed
   *  timeline, so a send that was in flight when a SEPARATE park
   *  (`cancelOutstandingDeliveries` on close, or this same sweep's own
   *  replay-ceiling/reaped-recipient `rejectDelivery`) already landed on the
   *  row could still resolve after it and clobber the park's own
   *  `lastError` (and bump `attempts`) even though `rejectDelivery`'s guard
   *  already protects `state`/`rejectCode` from that identical race. Left
   *  unguarded, that was exactly the gap `rejectDelivery`'s own docstring
   *  below claims closed for "a second writer" in general — true of
   *  `rejectDelivery` itself, false of this method until this fix.
   *  `dueDeliveries` never reads `attempts`/`lastError` on a `rejected` row
   *  (selected by neither arm), so the harm before this fix was a
   *  cosmetically wrong `lastError`/`attempts` on an already-closed row,
   *  never a resurrected replay — guarded anyway, for the same reason every
   *  other writer of this column is: the row's recorded reason for its own
   *  terminal state should name the write that actually caused it.
   *
   *  `countsAsAttempt` (default `true`): `false` belongs to three refusal paths
   *  that are not send failures. The registry-unmeasurable and tmux-unknown
   *  branches never reach `sendPrompt`; D-2369's `auto-continue-armed` hold
   *  reaches it but refuses before any keystroke. `attempts` is SEND-FAILURE
   *  budget (`MAIL_MAX_ATTEMPTS`'s own docstring), so none may march toward the
   *  same park ceiling as a prompt that was actually attempted and failed. */
  backOff(id: number, lastError: string, nextAttemptAt: number, countsAsAttempt = true): void {
    this.db.prepare(
      'UPDATE mail_deliveries SET attempts = attempts + ?, lastError = ?, nextAttemptAt = ? ' +
      `WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`,
    ).run(countsAsAttempt ? 1 : 0, lastError, nextAttemptAt, id);
  }

  /**
   * D-792: WHAT REFUSED THIS DELIVERY, recorded without changing what happens
   * to it. `sweepMail` calls this at every ordinary gate; it writes four
   * columns and reads none of them back into a decision.
   *
   * NOT A BACKOFF AND NOT AN ATTEMPT. `nextAttemptAt` is untouched, so the row
   * stays due on the next sweep exactly as it did before — an ordinary gate is
   * expected to hold for a busy session and must never approach
   * `MAIL_MAX_ATTEMPTS`. `attempts` is untouched for the same reason: it is
   * SEND-FAILURE budget (its own docstring), and no send was attempted here.
   * The two gates that ALSO back off call this in ADDITION, because "when may
   * this be retried" and "what refused it" are different questions and
   * collapsing them is the defect this repo bans by name.
   *
   * `sinceIfSame` is the row's CURRENT `gateSince`, handed in by the caller
   * from `dueDeliveries` rather than re-read here: a repeat of the same gate
   * keeps it, and a CHANGE of gate restarts it, because the question is "how
   * long has THIS gate been holding it", not "how long has it been stuck at
   * anything".
   */
  noteGate(id: number, gate: MailGate, now: number, same: boolean, sinceIfSame: number | null): void {
    this.db.prepare(
      'UPDATE mail_deliveries SET lastGate = ?, gateAt = ?, ' +
      'gateCount = CASE WHEN ? THEN gateCount + 1 ELSE 1 END, gateSince = ? ' +
      `WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`,
    ).run(gate, now, same ? 1 : 0, same ? (sinceIfSame ?? now) : now, id);
  }

  /** `WHERE state NOT IN ${TERMINAL_DELIVERY_SQL}` (fix — review finding 22, the
   *  same ack-race guard `markDelivered` above now carries, applied to this
   *  writer's own unconditional `state` overwrite, and widened for the same
   *  reason): a `sendPrompt` failure resolving after a concurrent ack landed
   *  on the same row must not turn an ACKED message into a
   *  `rejected('undeliverable')` one, and — the scoped-verify addition — two
   *  parks racing the same row (e.g. `cancelOutstandingDeliveries` on close,
   *  and this same sweep's own replay-ceiling or reaped-recipient call to
   *  THIS method, both resolving against a row already parked by the other)
   *  must not let the SECOND clobber the first's `rejectCode`/`lastError`
   *  with a different, later reason. `state != 'acked'` alone let that
   *  second write through unconditionally; a park is terminal exactly the
   *  way `'acked'` is, so it needs the identical protection. */
  rejectDelivery(id: number, code: MailRejectCode, lastError: string): void {
    this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = ?, lastError = ?, " +
      "lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL " +
      `WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`,
    ).run(code, lastError, id);
  }

  recordRejection(r: { code: MailRejectCode; fromId?: string; fromUuid?: string; toId?: string;
                       runId?: number | null; kind?: string; subject?: string;
                       detail?: string }): void {
    this.db.prepare(
      'INSERT INTO mail_rejections (at, code, fromId, fromUuid, toId, runId, kind, subject, detail) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(Date.now(), r.code, r.fromId ?? null, r.fromUuid ?? null, r.toId ?? null, r.runId ?? null,
      r.kind ?? null, r.subject ?? null, r.detail ?? null);
  }

  /** Every recorded rejection, oldest first — spec:147-148's "a rejected
   *  message is a fact about the fleet" needs a row, not necessarily a
   *  reader; this file's own tests are today's only consumer (PR J's feed is
   *  the eventual one). `code` stays a raw `string`: `mail_rejections.code`
   *  is not one of D-8's five we-do-not-know columns (it is written only from
   *  a typed `MailRejectCode` today, but nothing here re-validates it — the
   *  same honesty `RunRowDb`'s comment gives every OTHER column that IS
   *  guarded, stated instead of silently cast). */
  rejections(): { id: number; at: number; code: string; fromId: string | null; fromUuid: string | null;
                 toId: string | null; runId: number | null; kind: string | null; subject: string | null;
                 detail: string | null }[] {
    return this.db.prepare(
      'SELECT id, at, code, fromId, fromUuid, toId, runId, kind, subject, detail ' +
      'FROM mail_rejections ORDER BY id',
    ).all() as { id: number; at: number; code: string; fromId: string | null; fromUuid: string | null;
                 toId: string | null; runId: number | null; kind: string | null; subject: string | null;
                 detail: string | null }[];
  }

  // ── feed (Task 10, orchestrator-added scope: the durable archive behind ────
  //    NotifyLog's in-memory ring — PR J interface 5)

  /** Newest rows to keep. Also the upper clamp `feedEvents` enforces on its
   *  own `limit` argument, so a route can never be made to walk (and
   *  JSON-stringify) more history than the table is ever allowed to hold. */
  private static readonly FEED_RETENTION = 2000;

  /**
   * Append one notify event to the durable feed, beside `NotifyLog.record`
   * (`FleetWatcher.pushOne`'s own call — see that method's docstring). ALL
   * kinds land here, not just `mail`/`run`: a scrollback that silently
   * dropped `ask`/`done`/`merged` would not be a scrollback. `epoch`/`seq`
   * are `NotifyLog`'s own pair AT RECORD TIME, mirrored for correlation —
   * this table's own `id` is what orders `feedEvents`, since `seq` alone
   * cannot: it resets to 0 on every epoch rotation (a restart with an
   * unreadable watermark file), so two rows from different epochs can carry
   * the same `seq`.
   *
   * Retention (newest `FEED_RETENTION`) is pruned in the SAME transaction as
   * the insert, so a reader can never observe more rows than the retention
   * promise, even mid-write.
   */
  recordFeedEvent(epoch: string, e: NotifyEvent): void {
    tx(this.db, () => {
      this.db.prepare(
        'INSERT INTO feed_events (epoch, seq, at, kind, sessionId, title, body, runId) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(epoch, e.seq, e.at, e.kind, e.sessionId, e.title, e.body, e.runId);
      this.db.prepare(
        'DELETE FROM feed_events WHERE id NOT IN (SELECT id FROM feed_events ORDER BY id DESC LIMIT ?)',
      ).run(CoordStore.FEED_RETENTION);
    });
  }

  /**
   * `GET /api/feed`'s reader — oldest-first (the route's own promise), `limit`
   * clamped into `(0, FEED_RETENTION]` so neither an absent/non-positive
   * value nor one past the table's own retention ceiling can be asked for.
   * `kind` is read back through `isNotifyKind` (review finding 2), degrading
   * an unrecognised token to `'unknown'` — the same guard `isRunState`/
   * `isProgramState`/`isMailDeliveryState` already give the other we-do-not-
   * know columns in this file, never a bare cast. `coord/schema.ts`'s header
   * comment used to exempt this column on the grounds that it is "written
   * only from a value this server itself already typed" — true only until a
   * rollback (`shared/api.ts`'s own rollback paragraph) puts this server
   * behind a store a NEWER build already wrote `feed_events.kind` into.
   */
  feedEvents(limit: number): NotifyEvent[] {
    const n = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CoordStore.FEED_RETENTION)
      : CoordStore.FEED_RETENTION;
    const rows = this.db.prepare(
      'SELECT seq, at, kind, sessionId, title, body, runId FROM ' +
      '(SELECT * FROM feed_events ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
    ).all(n) as { seq: number; at: number; kind: string; sessionId: string; title: string;
                  body: string; runId: number | null }[];
    return rows.map((r) => ({
      seq: r.seq, at: r.at, kind: isNotifyKind(r.kind) ? r.kind : 'unknown', sessionId: r.sessionId,
      // Straight through, on `claimedBy`'s idiom in `hydrateRun`: an integer
      // column with no vocabulary has nothing to read it through, and NULL from
      // a row written before migration 10 means exactly what NULL means for a row
      // written after it — this event is about no run.
      title: r.title, body: r.body, runId: r.runId,
    }));
  }

  /**
   * `GET /api/feed?program=<slug>`'s reader — the events of one programme,
   * oldest-first and clamped exactly as `feedEvents` clamps its own, through
   * the `feed_events.runId` migration 10 added.
   *
   * The subquery against `runs` — `runId IN (SELECT id FROM runs WHERE program
   * = ?)` — is the filter, and it is why a programless event —
   * an `ask`, a `done`, a `merged`, a `coord`, every kind that is about a
   * SESSION rather than a run — never appears here. That is not a gap: those
   * events belong to no programme, and the unfiltered `feedEvents` above is
   * where they live. A row whose `runId` names a run that has since been
   * deleted would drop too; nothing in this tree deletes a run.
   */
  feedEventsForProgram(program: string, limit: number): NotifyEvent[] {
    const n = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CoordStore.FEED_RETENTION)
      : CoordStore.FEED_RETENTION;
    const rows = this.db.prepare(
      'SELECT f.seq AS seq, f.at AS at, f.kind AS kind, f.sessionId AS sessionId, ' +
      'f.title AS title, f.body AS body, f.runId AS runId FROM (' +
      'SELECT * FROM feed_events WHERE runId IN (SELECT id FROM runs WHERE program = ?) ' +
      'ORDER BY id DESC LIMIT ?) f ORDER BY f.id ASC',
    ).all(program, n) as { seq: number; at: number; kind: string; sessionId: string;
                           title: string; body: string; runId: number | null }[];
    return rows.map((r) => ({
      seq: r.seq, at: r.at, kind: isNotifyKind(r.kind) ? r.kind : 'unknown', sessionId: r.sessionId,
      title: r.title, body: r.body, runId: r.runId,
    }));
  }

  // ── notify lanes (Task 10): what FleetWatcher polls to raise `mail`/`run` ──
  //    NotifyEvent pushes — level-triggered watermarks, the same shape every
  //    other lane in this build uses for "what is new since I last looked".

  /** `mail_deliveries`'s current high-water id — `FleetWatcher`'s priming read
   *  (its own `tick()`'s "no storm on boot" rule, extended to the mail lane
   *  per spec's restart semantics), so a restart does not re-notify for every
   *  delivery already queued before this process started. */
  maxMailDeliveryId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM mail_deliveries').get() as { m: number }).m;
  }

  /**
   * Every `mail_deliveries` row with `id > sinceId`, oldest first — mail
   * queued since `FleetWatcher` last looked, regardless of whether the
   * delivery lane (`sweepMail`) has attempted injection yet: spec:243-244's
   * push fires "at queue time (the message exists and is a record then), not
   * at injection — otherwise a message that never becomes deliverable is a
   * fact nothing recorded."
   *
   * `mailId` (for the push's non-collapsing tag, spec:236-237) and
   * `deliveryId` (the watermark's own unit) are deliberately BOTH returned —
   * two independent `AUTOINCREMENT` sequences, the same D-41 reason
   * `setDeliveryEnvelope`'s own comment gives for never assuming they walk
   * together. `workspace`/`project` come from the delivery's RUN when one is
   * named (`mail.runId`, nullable) — the common case, worker<->coordinator
   * mail inside a wave — and are `null` for ad-hoc mail with no run context;
   * the caller degrades both (`workspace ?? toId` for the title, same as
   * `pushOne`'s own fallback chains elsewhere in this file's callers).
   *
   * `fromId` and `runId` (fix round 1, item 1) ride beside `kind`/`subject`
   * for the identical reason: the caller (`FleetWatcher.pushNewMail`) needs
   * them to run `isAskNudgeMail` (`coord/rundefs.ts`) per row — the ask
   * pre-emption lane's own nudge mail must record but never push, and that
   * predicate's shape is exactly `fromId`/`runId`/`subject`. `runId` here is
   * the RAW column (nullable), never coalesced through the `LEFT JOIN` the
   * way `project`/`workspace` are — those degrade because they have no
   * meaning without a run; `runId` itself is the fact the predicate needs
   * verbatim, null included.
   */
  mailQueuedSince(sinceId: number): { deliveryId: number; mailId: number; toId: string; fromId: string;
                                       runId: number | null; kind: string; subject: string;
                                       project: string | null; workspace: string | null }[] {
    return this.db.prepare(
      'SELECT d.id AS deliveryId, m.id AS mailId, d.toId, m.fromId, m.runId, m.kind, m.subject, ' +
      'r.project, r.workspace ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId LEFT JOIN runs r ON r.id = m.runId ' +
      'WHERE d.id > ? ORDER BY d.id',
    ).all(sinceId) as { deliveryId: number; mailId: number; toId: string; fromId: string; runId: number | null;
                         kind: string; subject: string; project: string | null; workspace: string | null }[];
  }

  /** `run_events`'s current high-water id — same priming role as
   *  `maxMailDeliveryId`, over the run-transition notify lane. */
  maxRunEventId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM run_events').get() as { m: number }).m;
  }

  /**
   * Every `run_events` row with `id > sinceId`, oldest first, joined back to
   * the run it belongs to — spec:243-244's `run` push copy needs `state`,
   * `workspace ?? project`, `program:<slug> wave <n>/<of>`, all of which live
   * on `runs` already (`program` IS the slug — `runs.program REFERENCES
   * programs(slug)`; the copy names the slug, never the program's title, so
   * no join to `programs` is needed here, unlike `RUN_ROW_COLUMNS`'s own
   * join for `programTitle`).
   *
   * `sessionId` rides straight off `runs.sessionId` (nullable — a run can
   * transition, e.g. `planned` -> `failed`, before dispatch ever mints one);
   * the caller (`FleetWatcher`) skips a row with no session rather than
   * guess one, since presence-gating and the push's own target both need a
   * real session id.
   */
  runEventsSince(sinceId: number): { eventId: number; runId: number; fromState: string; toState: string;
                                      sessionId: string | null;
                                      project: string; workspace: string | null; program: string;
                                      wave: number; waveOf: number | null }[] {
    return this.db.prepare(
      'SELECT re.id AS eventId, re.runId, re.fromState, re.toState, r.sessionId, r.project, r.workspace, ' +
      'r.program, r.wave, r.waveOf ' +
      'FROM run_events re JOIN runs r ON r.id = re.runId ' +
      'WHERE re.id > ? ORDER BY re.id',
    ).all(sinceId) as { eventId: number; runId: number; fromState: string; toState: string;
                         sessionId: string | null;
                         project: string; workspace: string | null; program: string;
                         wave: number; waveOf: number | null }[];
  }

  // ── disaster recovery (spec:82-85) ─────────────────────────────────────────

  /**
   * Rebuild a program's runs from the three artefacts that survive the database:
   * the markdown ledger (`docs/superpowers/programs/<slug>.md`, parsed by the
   * CALLER — nothing machine-reads it in ccrc, and this signature is what keeps
   * that true: it takes a parsed shape, never a path), the registry row, and
   * `.prhistory`.
   *
   * The drill is a TEST, not an operator tool, and its value is a constraint on
   * future columns: a column that cannot be reconstructed from these three
   * turns `coord-store.test.ts` red and has to justify itself in the diff.
   *
   * Two judgment calls the input does not fully pin, since the registry names
   * only the CURRENT state of one workspace, not each wave's own history:
   *  - every rebuilt run shares the registry's `sessionId`/`workspace`/
   *    `branch` — true by construction under D-1 (a session id is stable
   *    across waves; only its harness uuid rotates on `/clear`).
   *  - `.prhistory` entries fold onto the LAST wave that closed with this
   *    branch, not distributed across every closed wave — the honest
   *    approximation of "whatever `foldPrLineage` would have stored at THAT
   *    close" when the close-time snapshots themselves were lost with the
   *    database. A wave that has not closed gets `[]`, and that is NOT a
   *    stand-in: nothing has folded into it yet (`ccd/ccd:2080-2086`'s
   *    three-answer ladder).
   *
   * A THIRD rule (deviation D-11, found in Task 3 review — the plan's own
   * Step-4 rule 2, dropped on first landing): the LAST wave's state is read
   * from the hold, not guessed from the ledger alone. A wave with no handoff
   * commit is `working` ONLY while `registry.held` says the workspace is
   * still claimed for it; if the hold is gone too, nothing backs a live
   * session and calling it `working` would fabricate one — `spec:82-85`'s
   * "nothing is invented" for the DB-lost path applies to the STATE column
   * exactly as much as to any other field. Such a wave is `failed`: the
   * honest "this did not complete and nothing is running it", not a silent
   * default that also keeps counting against `capsUsage().running` forever.
   * Every wave BEFORE the last one is expected to already carry a handoff
   * commit (the ledger is append-only); the fallback below only ever matters
   * for the last one.
   *
   * A FOURTH rule (fix, found in Task 3 review): the `working` wave — and
   * ONLY that one — gets `dispatchedAt` bound to the reconstruction time,
   * the same honest-approximation reasoning `openedAt` already uses. Without
   * this, `capsUsage().running`'s `dispatchedAt IS NOT NULL` predicate
   * (below) could never count a rebuilt run no matter its state, so the very
   * run a disaster rebuild most needs the cap to see — a live session
   * surviving the database loss — was invisible to it; the THIRD rule's own
   * justification above ("keeps counting against `capsUsage().running`
   * forever" as the reason a hold-less last wave is `failed` rather than a
   * silently-defaulted `working`) only became true once this bound
   * `dispatchedAt` for `working`. A `done` or `failed` wave stays
   * `dispatchedAt = null`: it holds no live session for the cap to count,
   * and stamping the reconstruction time on a wave that in reality
   * dispatched long ago would falsify `dispatchedIn24h` for it too.
   *
   * A FIFTH thing this does NOT carry (D-2352): `programs.homeProject`. None of the
   * three artefacts this rebuilds from names a
   * home — the ledger header carries the slug and title, the registry a
   * project, `.prhistory` a branch — so the programme row this INSERT writes
   * stores a NULL home, exactly like a programme that never had one.
   * `setProgramHome`'s `WHERE homeProject IS NULL` then backfills whatever the
   * NEXT open is told, and `home-mismatch` cannot fire until then: a DB loss
   * forgets the home, and the recovery is the coordinator naming the right one
   * on that next open, not something this procedure can parse from what
   * survives. Named in `reconstruction-drill.test.ts`'s `UNRECOVERABLE`.
   */
  reconstruct(input: {
    ledger: { slug: string; title: string;
              waves: { wave: number; of: number; handoffCommit: string | null }[] };
    registry: { sessionId: string; project: string; workspace: string;
                branch: string; held: string | null };
    prHistory: readonly PrLineageEntry[];
  }): RunRow[] {
    return tx(this.db, () => {
      const now = Date.now();
      this.db.prepare(
        'INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(slug) DO UPDATE SET title = excluded.title',
      ).run(input.ledger.slug, input.ledger.title, now, 'active');

      const doneWaves = input.ledger.waves.filter((w) => w.handoffCommit !== null);
      const lastDoneWave = doneWaves.length > 0 ? doneWaves[doneWaves.length - 1] : null;
      const matchingLineage = input.prHistory.filter((e) => e.branch === input.registry.branch);
      const lastWave = input.ledger.waves[input.ledger.waves.length - 1];

      const ids: number[] = [];
      for (const wave of input.ledger.waves) {
        // The hold-based rule (D-11, above) applies ONLY to the last wave; a
        // done wave is always `done` regardless of position, matching the
        // original formula for every wave that HAS a handoff commit.
        const state: RunState = wave.handoffCommit !== null
          ? 'done'
          : wave === lastWave && input.registry.held === null
            ? 'failed'
            : 'working';
        const prLineage = wave === lastDoneWave ? matchingLineage : [];
        // Fix, found in Task 3 review (see the fourth rule in this method's
        // docstring): ONLY the `working` wave carries a live session, so only
        // it gets `dispatchedAt` bound — the reconstruction time stands in
        // for the real dispatch time nothing in the ledger preserves.
        const dispatchedAt = state === 'working' ? now : null;
        // `coordProject` is deliberately NOT reconstructed: it is a measurement
        // taken at open time from a registry record that may no longer exist,
        // and inventing one here would be a placement nobody measured. A
        // reconstructed run reads as unstamped, which the policy already handles.
        const res = this.db.prepare(
          'INSERT INTO runs (program, wave, waveOf, project, sessionId, workspace, branch, state, ' +
          'dispatchedAt, claimedBy, openedAt, handoffCommit, prLineage) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          input.ledger.slug, wave.wave, wave.of, input.registry.project,
          input.registry.sessionId, input.registry.workspace, input.registry.branch,
          state, dispatchedAt, null, now, wave.handoffCommit, JSON.stringify(prLineage),
        );
        ids.push(Number(res.lastInsertRowid));
      }
      // Rows this transaction just inserted, read back through the measured
      // read (D-2545). A row the rebuild itself produced that cannot be read
      // back must ROLL THE WHOLE RECONSTRUCTION BACK rather than be returned
      // half-typed — the throw is inside `tx()`, which is what makes that true.
      // Unreachable by construction (AUTOINCREMENT has just assigned these ids
      // in this same transaction); it exists so a drift fails loudly.
      return ids.map((id) => {
        const read = this.run(id);
        if (!read.ok) throw new Error(`reconstruct: ${read.detail}`);
        if (read.run === null) throw new Error('reconstruct: a row this transaction inserted read back absent');
        return read.run;
      });
    });
  }

  /* ── the lifecycle journal mirror (build 9) ────────────────────────────── */

  /**
   * Every generation this mirror has ever seen, retired ones included — the
   * retired rows are what make "this generation was rotated away with N bytes
   * undrained" answerable a year later.
   */
  journalGenerations(): JournalGeneration[] {
    const rows = this.db.prepare(
      'SELECT gen, firstSeenAt, lastSweepAt, cursor, size, retired ' +
      'FROM lifecycle_generations ORDER BY gen',
    ).all() as (Omit<JournalGeneration, 'retired'> & { retired: number })[];
    return rows.map((r) => ({ ...r, retired: r.retired !== 0 }));
  }

  /**
   * ONE TRANSACTION FOR THE ROWS AND THE CURSOR, and that is the whole of D6's
   * "the cursor is an optimisation, never a correctness input": it is advanced
   * only inside the same `tx()` as the rows it covers, so it can never move
   * past uncommitted data. A cursor hoisted out of here — even one line above
   * the loop, in its own transaction — is the mutant `lifecycle-store.test.ts`
   * exists to kill.
   *
   * `INSERT OR IGNORE` against the two partial unique indexes is what makes
   * idempotency INTRINSIC rather than positional: a parsed line dedupes on its
   * own `uid`, and a uid-less one on its bytes within its generation. Neither
   * is a function of where in the file the line happened to sit, so re-reading
   * a generation from offset 0 is always no-op-or-catch-up.
   *
   * Returns how many rows actually LANDED — the caller logs nothing on 0,
   * which is the ordinary answer for a sweep that only advanced a cursor.
   *
   * `badoutcome` rides alongside `badact` in the column list — added to
   * `MIGRATIONS[2]` and `JournalRow` by a fix round after this brief was
   * written, because ccd writes it today and `LifecycleEvent.badoutcome`
   * already requires it on every `MirroredLifecycleEvent`. Dropping it here
   * would silently lie on every row where ccd wrote one.
   */
  ingestJournal(input: {
    readonly gen: string;
    readonly rows: readonly JournalRow[];
    readonly cursor: number;
    readonly size: number;
    readonly at: number;
  }): number {
    return tx(this.db, () => {
      const ins = this.db.prepare(
        'INSERT OR IGNORE INTO lifecycle_events ' +
        '(uid, gen, at, ingestedAt, act, badact, outcome, badoutcome, verb, sessionId, tx, refusal, ' +
        'detail, truncated, obsJson, decJson, measJson, raw) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      let inserted = 0;
      for (const r of input.rows) {
        const res = ins.run(
          r.uid, input.gen, r.at, input.at, r.act, r.badact, r.outcome, r.badoutcome, r.verb,
          r.sessionId, r.tx, r.refusal, r.detail, r.truncated ? 1 : 0,
          r.obs === null ? null : JSON.stringify(r.obs),
          r.dec === null ? null : JSON.stringify(r.dec),
          r.meas === null ? null : JSON.stringify(r.meas),
          r.raw,
        );
        inserted += Number(res.changes);
      }
      this.db.prepare(
        'INSERT INTO lifecycle_generations (gen, firstSeenAt, lastSweepAt, cursor, size, retired) ' +
        'VALUES (?, ?, ?, ?, ?, 0) ' +
        'ON CONFLICT(gen) DO UPDATE SET lastSweepAt = excluded.lastSweepAt, ' +
        'cursor = excluded.cursor, size = excluded.size, retired = 0',
      ).run(input.gen, input.at, input.at, input.cursor, input.size);
      return inserted;
    });
  }

  /** A hole in the mirror, recorded rather than skipped (D6). Never pruned:
   *  the gap outlives the generation it is about, which is the only reason it
   *  is worth writing down.
   *
   *  `lostFrom`/`lostTo` are taken AS GIVEN, never constructed here: the
   *  coupling invariant (both null, or both numbers) is `mirrorplan.ts`'s
   *  private `coupledLoss` helper's job, at the one call site that builds a
   *  `PlannedGap`. This method is a pure write of whatever pair its caller
   *  already produced, so it does not re-derive — and cannot drift from —
   *  that invariant. */
  recordGap(g: {
    readonly at: number; readonly gen: string; readonly reason: LifecycleGapReason;
    readonly detail: string; readonly lostFrom: number | null; readonly lostTo: number | null;
  }): void {
    this.db.prepare(
      'INSERT INTO lifecycle_gaps (at, gen, reason, detail, lostFrom, lostTo) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
    ).run(g.at, g.gen, g.reason, g.detail, g.lostFrom, g.lostTo);
  }

  /** RETIRE, NEVER DELETE. A retired generation's cursor and size are the
   *  evidence behind its gap row; destroying them would destroy the record of
   *  what was lost, which is the same mistake `ws-restore` made until wave 3. */
  retireGeneration(gen: string, at: number): void {
    this.db.prepare(
      'UPDATE lifecycle_generations SET retired = 1, lastSweepAt = ? WHERE gen = ?',
    ).run(at, gen);
  }

  /** Bounded like `FEED_RETENTION` is, and for the same reason: a route that
   *  can be asked for the whole table is a route that can be asked for 90 MB. */
  static readonly LIFECYCLE_PAGE_MAX = 500;

  /** The column list, named ONCE. `SELECT *` is banned in this directory —
   *  naming every column is exactly what makes "an older build ignores unknown
   *  columns" true rather than aspirational. Includes `badoutcome`, added to
   *  the schema by a fix round after this brief was written — omitting it
   *  here would silently drop the outcome-side degrade token on every read. */
  private static readonly LC_COLS =
    'id, uid, gen, at, ingestedAt, act, badact, outcome, badoutcome, verb, sessionId, tx, refusal, ' +
    'detail, truncated, obsJson, decJson, measJson, raw';

  /**
   * One session's past tense, oldest-first, newest-`limit` window.
   *
   * ORDERED BY THIS TABLE'S OWN `id`, NEVER BY `at`. `at` is CCD's clock and is
   * nullable; `id` is monotonic across a generation rotation. `feed_events`
   * already relies on the identical argument for `GET /api/feed`.
   */
  lifecycleFor(q: { readonly sessionId?: string | null; readonly limit?: number }): MirroredLifecycleEvent[] {
    const raw = q.limit ?? CoordStore.LIFECYCLE_PAGE_MAX;
    const n = Number.isFinite(raw) && raw > 0
      ? Math.min(Math.floor(raw), CoordStore.LIFECYCLE_PAGE_MAX)
      : CoordStore.LIFECYCLE_PAGE_MAX;
    const c = CoordStore.LC_COLS;
    const rows = (q.sessionId
      ? this.db.prepare(
          `SELECT ${c} FROM (SELECT ${c} FROM lifecycle_events WHERE sessionId = ? ` +
          'ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
        ).all(q.sessionId, n)
      : this.db.prepare(
          `SELECT ${c} FROM (SELECT ${c} FROM lifecycle_events ORDER BY id DESC LIMIT ?) ` +
          'ORDER BY id ASC',
        ).all(n)) as {
          uid: string | null; gen: string; at: number | null; ingestedAt: number;
          act: string; badact: string | null; outcome: string; badoutcome: string | null;
          verb: string | null; sessionId: string | null; tx: string | null;
          refusal: string | null; detail: string | null; truncated: number;
          obsJson: string | null; decJson: string | null; measJson: string | null; raw: string;
        }[];
    return rows.map((r) => ({
      uid: r.uid, gen: r.gen, at: r.at, ingestedAt: r.ingestedAt,
      // Through the guards, never a cast — the same discipline `feedEvents`
      // gives `kind` and `programs()` gives `state`. A token a NEWER build
      // wrote lands somewhere honest, and `raw` still carries the bytes.
      act: isLifecycleAct(r.act) ? r.act : LC_ACT_UNKNOWN,
      badact: r.badact,
      outcome: isLifecycleOutcome(r.outcome) ? r.outcome : LC_OUTCOME_UNKNOWN,
      // `badact`'s twin. Same shape as `badact` above: a free-text echo of
      // whatever ccd (or this build's own degrade) wrote, never re-narrowed
      // here — narrowing already happened once, on the way in.
      badoutcome: r.badoutcome,
      verb: r.verb,
      // The COLUMN is `sessionId`; the WIRE event is `id`. One rename,
      // declared in `journalparse.ts` and undone here — see `ProvenancePair`.
      id: r.sessionId,
      tx: r.tx, refusal: r.refusal, detail: r.detail,
      truncated: r.truncated !== 0,
      // The SAME revivers the parser used on the way in: one definition, both
      // directions, and each returns a literal so a family gaining a field is
      // a compile error rather than a silently-dropped one.
      obs: reviveObs(jsonOrNull(r.obsJson)),
      dec: reviveDec(jsonOrNull(r.decJson)),
      meas: reviveMeas(jsonOrNull(r.measJson)),
      raw: r.raw,
    }));
  }

  /** The holes, newest-first — a timeline with a hole in it says so. */
  lifecycleGaps(limit = 100): LifecycleGap[] {
    const n = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CoordStore.LIFECYCLE_PAGE_MAX)
      : 100;
    const rows = this.db.prepare(
      'SELECT at, gen, reason, detail, lostFrom, lostTo FROM lifecycle_gaps ORDER BY id DESC LIMIT ?',
    ).all(n) as {
      at: number; gen: string; reason: string; detail: string;
      lostFrom: number | null; lostTo: number | null;
    }[];
    return rows.map((r) => ({
      at: r.at, gen: r.gen,
      reason: isLifecycleGapReason(r.reason) ? r.reason : 'unknown',
      detail: r.detail, lostFrom: r.lostFrom, lostTo: r.lostTo,
    }));
  }

  /** What `/api/fleet/health` reports so the operator sees the growth coming
   *  (D8). `oldestAt` IS the reconstruction horizon: below it the mirror holds
   *  history the flat file no longer does. `AS n` and not `AS rows` — `ROWS`
   *  is a SQLite window-frame keyword and only parses here as a fallback
   *  identifier. */
  lifecycleStats(): {
    rows: number; oldestAt: number | null; newestAt: number | null;
    generations: number; gaps: number;
  } {
    const e = this.db.prepare(
      'SELECT count(*) AS n, MIN(at) AS oldestAt, MAX(at) AS newestAt FROM lifecycle_events',
    ).get() as { n: number; oldestAt: number | null; newestAt: number | null };
    const g = this.db.prepare('SELECT count(*) AS c FROM lifecycle_generations').get() as { c: number };
    const p = this.db.prepare('SELECT count(*) AS c FROM lifecycle_gaps').get() as { c: number };
    return { rows: e.n, oldestAt: e.oldestAt, newestAt: e.newestAt, generations: g.c, gaps: p.c };
  }

  /**
   * The pairs `divergence.provenance-mismatch` weighs — rows carrying BOTH a
   * kernel-observed actor class and a declared surface. NOTHING IS DECIDED
   * HERE: `corroboration()` (L0) is the only function allowed to relate the
   * families, and `divergence.ts` is where it is called. This is a read.
   *
   * `json_extract` rather than a second column pair: the families ride as JSON
   * precisely because they never merge, and two more columns would be two more
   * places for a newer ccd's field to be dropped.
   *
   * MAPPED, NOT CAST. `json_extract` answers whatever the JSON held — a
   * number, a boolean, a null — and `as unknown as ProvenancePair[]` would
   * launder that past the only narrowing door there is. A row whose class or
   * surface is not a string cannot be modelled AS A PAIR, and an unmodellable
   * value is not a disagreement, so it is dropped here rather than raised
   * downstream.
   */
  recentProvenance(sinceAt: number, limit: number): ProvenancePair[] {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 500;
    const rows = this.db.prepare(
      "SELECT sessionId AS id, at, json_extract(obsJson, '$.cg') AS obsClass, " +
      // `INDEXED BY lifecycle_by_at`, FORCED rather than left to the planner
      // (Tasks 40/41 review, F1). Measured on an in-memory `node:sqlite` with
      // 500,000 rows over 30 days (~1.5-2yr of growth at schema.ts's own ~90
      // MB/year — this table is NEVER PRUNED): a bare `CREATE INDEX
      // lifecycle_by_at ON lifecycle_events(at)`, with NO hint, is not enough
      // -- SQLite still chose `SCAN lifecycle_events` (confirmed with and
      // without `ANALYZE`), because the WHERE column (`at`) and the ORDER BY
      // column (`id`) differ and the planner prefers the scan order that
      // satisfies `ORDER BY id DESC` for free over paying for an explicit
      // sort, even when that scan is the more expensive plan by orders of
      // magnitude. `INDEXED BY` does not change what this query MEANS —
      // `ORDER BY lifecycle_events.id DESC` below is untouched, byte for
      // byte, so every existing behaviour (the alias-shadowing note two
      // lines down included) still holds. It only forces the ACCESS PATH:
      // seek the `at` index to the window's lower bound (`SEARCH … USING
      // INDEX lifecycle_by_at (at>?)`), then sort ONLY the rows that
      // survived the WHERE (bounded by the window, never by table size) into
      // a temp b-tree for `id DESC` (`USE TEMP B-TREE FOR ORDER BY`).
      // Verified array-order-IDENTICAL to the unindexed query, row for row,
      // on three datasets: a realistic under-limit window, an out-of-order
      // two-generation case built specifically to prove `at` and `id` order
      // can diverge, and that same case pushed past the `limit` where a
      // reshaped `ORDER BY at DESC` (the alternative considered and
      // rejected) would have picked a DIFFERENT top-N.
      "json_extract(decJson, '$.surface') AS decSurface " +
      'FROM lifecycle_events INDEXED BY lifecycle_by_at ' +
      'WHERE sessionId IS NOT NULL AND obsJson IS NOT NULL AND decJson IS NOT NULL ' +
      // `lifecycle_events.id`, QUALIFIED: `id` is now an output alias for
      // `sessionId`, and SQLite resolves a bare `ORDER BY id` to the alias —
      // which would order this window by session name instead of by arrival.
      'AND at IS NOT NULL AND at >= ? ORDER BY lifecycle_events.id DESC LIMIT ?',
    ).all(sinceAt, n) as {
      id: string; at: number | null; obsClass: unknown; decSurface: unknown;
    }[];
    return rows.flatMap((r) => (
      typeof r.obsClass === 'string' && typeof r.decSurface === 'string'
        ? [{ id: r.id, at: r.at, obsClass: r.obsClass, decSurface: r.decSurface }]
        : []
    ));
  }

  /* ── claims (build 9 wave 7, D11/D12) ──────────────────────────────────── */

  /** The column list, named ONCE — `SELECT *` is banned in this directory. */
  private static readonly CLAIM_COLS =
    'id, project, heldBy, heldByUuid, intent, runId, state, ' +
    'createdAt, renewedAt, expiresAt, hardExpiresAt, endedAt, endedBy';

  /** One raw row + its path set -> the typed shape. `state` goes through
   *  `isClaimState`, never a cast — the same rule `hydrateRun`/`feedEvents`
   *  hold. `ClaimState` has no designated we-do-not-know member (the L0 pin:
   *  exactly four stored words), so a token a newer build wrote cannot be
   *  modelled AS A SUMMARY at all — `null`, and the list readers drop the row
   *  (`recentProvenance`'s rule: an unmodellable value is not a disagreement). */
  private hydrateClaim(r: {
    id: number; project: string; heldBy: string; heldByUuid: string | null;
    intent: string; runId: number | null; state: string; createdAt: number;
    renewedAt: number; expiresAt: number; hardExpiresAt: number;
    endedAt: number | null; endedBy: string | null;
  }, paths: readonly string[]): ClaimSummary | null {
    if (!isClaimState(r.state)) return null;
    return {
      id: r.id, project: r.project, paths, heldBy: r.heldBy, heldByUuid: r.heldByUuid,
      intent: r.intent, runId: r.runId, state: r.state,
      createdAt: r.createdAt, renewedAt: r.renewedAt,
      expiresAt: r.expiresAt, hardExpiresAt: r.hardExpiresAt,
      endedAt: r.endedAt, endedBy: r.endedBy,
    };
  }

  /** A claim's path set, fixed at insert — `claim_paths.live` mirrors the
   *  parent's state, it never shrinks the set, so the read is by claimId
   *  alone and an ended claim keeps answering "held ON WHAT until it died". */
  private claimPaths(claimId: number): string[] {
    return (this.db.prepare(
      'SELECT path FROM claim_paths WHERE claimId = ? ORDER BY rowid',
    ).all(claimId) as { path: string }[]).map((r) => r.path);
  }

  private claimRow(id: number): ClaimSummary {
    const row = this.db.prepare(
      `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE id = ?`,
    ).get(id) as Parameters<CoordStore['hydrateClaim']>[0] | undefined;
    if (row === undefined) throw new Error(`claims row ${id} vanished inside its own transaction`);
    const hydrated = this.hydrateClaim(row, this.claimPaths(id));
    // A row THIS transaction wrote carries this build's own state word.
    if (hydrated === null) throw new Error(`claims row ${id} unmodellable inside its own transaction`);
    return hydrated;
  }

  /**
   * Acquire (or renew) a set of path claims, as ONE transaction (D11) —
   * the two mechanisms IN THIS ORDER, so a reviewer does not read either
   * as redundant:
   *
   *  1. THE IN-TRANSACTION READ IS THE CAS. `tx()` is `BEGIN IMMEDIATE` and
   *     `DatabaseSync` has no async surface, so nothing can interleave
   *     between the read below and the inserts under it. `decideClaim` (L1)
   *     owns the conflict rule — exact match AND directory-prefix containment
   *     both ways (`shared` vs `shared/api.ts`), which no index can express.
   *  2. THE PARTIAL UNIQUE INDEX `claim_one_owner` IS THE BACKSTOP: if a
   *     future refactor ever loses the transaction, the failure is a LOUD
   *     constraint violation, never a silent duplicate.
   *
   * All-or-nothing (D12): five paths, one conflict ⇒ zero acquired, and the
   * refusal names EVERY conflicting path. A live claim this session already
   * holds on the exact path is RENEWED — intent re-written, lease re-armed,
   * never past the hard cap ("an intent can be written every ten minutes").
   *
   * `holderDeliverable` is the per-holder measurement the CALLER made
   * (`peerDeliverable` over records the route already holds) — the store
   * cannot measure the fleet, so when the caller did not either, the answer
   * on every conflict is the honest `'unknown'` (D9: unknown is not no).
   */
  claimAttempt(input: {
    project: string; paths: readonly string[]; sessionId: string; uuid: string;
    runId: number | null; intent: string; now?: number;
    holderDeliverable?: (sessionId: string) => PeerDeliverable;
  }): ClaimAttemptResult {
    const now = input.now ?? Date.now();
    const deliverable = input.holderDeliverable ?? ((): PeerDeliverable => 'unknown');
    return tx(this.db, () => {
      // 1 — expire lapsed rows IN THE SAME TX, then read, then insert (D11).
      this.expireLapsedInner(now);
      const liveRows = this.db.prepare(
        'SELECT id, heldBy, heldByUuid, intent, runId, expiresAt FROM claims ' +
        "WHERE project = ? AND state = 'live' ORDER BY id",
      ).all(input.project) as { id: number; heldBy: string; heldByUuid: string;
                                intent: string; runId: number | null; expiresAt: number }[];
      const livePaths = this.db.prepare(
        'SELECT claimId, path FROM claim_paths WHERE project = ? AND live = 1 ORDER BY rowid',
      ).all(input.project) as { claimId: number; path: string }[];
      const pathsOf = new Map<number, string[]>();
      for (const p of livePaths) {
        const list = pathsOf.get(p.claimId);
        if (list === undefined) pathsOf.set(p.claimId, [p.path]); else list.push(p.path);
      }
      // Object literals against the L1 interface — a `ClaimRow` member this
      // file forgets, or invents, is a compile error (the reviveFleetSession
      // mechanism, `decideClaim`'s own conflict literal holds it too).
      const live: ClaimRow[] = liveRows.map((c) => ({
        id: c.id, project: input.project, paths: pathsOf.get(c.id) ?? [],
        heldBy: c.heldBy, heldByUuid: c.heldByUuid, intent: c.intent, runId: c.runId,
        expiresAt: c.expiresAt, holderDeliverable: deliverable(c.heldBy),
      }));
      const decision = decideClaim(live, {
        project: input.project, paths: input.paths, sessionId: input.sessionId,
      });
      if ('refused' in decision) {
        return { ok: false as const, why: 'bad-path' as const, paths: decision.paths };
      }
      if ('conflict' in decision) {
        return { ok: false as const, why: 'conflict' as const, conflicts: decision.conflict };
      }
      // decideClaim's ok arm carries the NORMALIZED, deduped set — the only
      // spelling that may reach `claim_paths` (`normalizeClaimPath`, the
      // schema's own comment on the column).
      const paths = decision.paths;
      // The holder's own live claims: a requested path an own claim already
      // holds EXACTLY renews that whole claim (D12 ruling 3 — re-POSTing the
      // same paths re-writes intent AND re-arms the lease); only the paths no
      // own claim holds become a new row, so the backstop index never fires
      // on a legitimate re-declaration.
      const renewIds: number[] = [];
      const fresh: string[] = [];
      for (const p of paths) {
        const own = live.find((c) => c.heldBy === input.sessionId && c.paths.includes(p));
        if (own !== undefined) { if (!renewIds.includes(own.id)) renewIds.push(own.id); }
        else fresh.push(p);
      }
      const out: ClaimSummary[] = [];
      for (const id of renewIds) {
        this.db.prepare(
          'UPDATE claims SET heldByUuid = ?, runId = ?, intent = ?, renewedAt = ?, ' +
          "expiresAt = MIN(?, hardExpiresAt) WHERE id = ? AND state = 'live'",
        ).run(input.uuid, input.runId, input.intent, now, now + CLAIM_LEASE_MS, id);
        out.push(this.claimRow(id));
      }
      if (fresh.length > 0) {
        const res = this.db.prepare(
          'INSERT INTO claims (project, heldBy, heldByUuid, intent, runId, state, ' +
          'createdAt, renewedAt, expiresAt, hardExpiresAt) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(input.project, input.sessionId, input.uuid, input.intent, input.runId,
          'live', now, now, now + CLAIM_LEASE_MS, now + CLAIM_HARD_CAP_MS);
        const claimId = Number(res.lastInsertRowid);
        const ins = this.db.prepare(
          'INSERT INTO claim_paths (claimId, project, path, live) VALUES (?, ?, ?, 1)');
        for (const p of fresh) ins.run(claimId, input.project, p);
        out.push(this.claimRow(claimId));
      }
      return { ok: true as const, claims: out };
    });
  }

  /** THE GUARD IS IN THE `WHERE`, not in the read above it — `setWorkItemState`'s
   *  exact shape and reason: `changes === 0` past a successful lookup means
   *  exactly one thing, the row was not live. One `tx()` for the state word
   *  AND the `claim_paths.live` mirror bit — the schema's own contract: the
   *  bit is written in the SAME transaction as every `claims.state`
   *  transition, or the partial index answers for a claim that no longer is. */
  private endClaim(id: number, state: 'released' | 'broken', by: string,
                   now: number): ClaimEndResult {
    return tx(this.db, () => {
      const row = this.db.prepare('SELECT state FROM claims WHERE id = ?').get(id) as
        { state: string } | undefined;
      if (!row) return { ok: false as const, why: 'unknown-claim' as const };
      const res = this.db.prepare(
        "UPDATE claims SET state = ?, endedAt = ?, endedBy = ? WHERE id = ? AND state = 'live'",
      ).run(state, now, by, id);
      if (Number(res.changes) === 0) {
        return { ok: false as const, why: 'not-live' as const,
                 state: isClaimState(row.state) ? row.state : null };
      }
      this.db.prepare('UPDATE claim_paths SET live = 0 WHERE claimId = ?').run(id);
      return { ok: true as const, state };
    });
  }

  /** Expire in the same transaction as every claim attempt — the
   *  `feed_events` prune-on-write idiom (D12): a claim route never sees a
   *  stale row even if the watcher is wedged. Hard cap FIRST, so a row past
   *  both bounds records the harder word. LAPSE, NEVER DELETE. Each lane
   *  flips the `claim_paths.live` mirror bit under the SAME predicate before
   *  re-wording the parent — one transition, one transaction, or the partial
   *  index answers for a claim that no longer is. */
  private expireLapsedInner(now: number): void {
    this.db.prepare(
      'UPDATE claim_paths SET live = 0 WHERE claimId IN ' +
      "(SELECT id FROM claims WHERE state = 'live' AND hardExpiresAt <= ?)",
    ).run(now);
    this.db.prepare(
      "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = 'hard-cap' " +
      "WHERE state = 'live' AND hardExpiresAt <= ?",
    ).run(now, now);
    this.db.prepare(
      'UPDATE claim_paths SET live = 0 WHERE claimId IN ' +
      "(SELECT id FROM claims WHERE state = 'live' AND expiresAt <= ?)",
    ).run(now);
    this.db.prepare(
      "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = 'expired' " +
      "WHERE state = 'live' AND expiresAt <= ?",
    ).run(now, now);
  }

  claimRelease(id: number, by: string, now: number = Date.now()): ClaimEndResult {
    return this.endClaim(id, 'released', by, now);
  }

  /** `POST /api/claims/:id/break` — a door the CLAIMANT is not the one to walk
   *  through (the `abandon` shape). Same mechanics as release; a different
   *  word, because "I am done" and "someone pried this open" are different
   *  facts a `?all=1` reader needs to tell apart. */
  claimBreak(id: number, by: string, now: number = Date.now()): ClaimEndResult {
    return this.endClaim(id, 'broken', by, now);
  }

  activeClaims(): ClaimSummary[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE state = 'live' ORDER BY id`,
    ).all() as Parameters<CoordStore['hydrateClaim']>[0][];
    return rows.flatMap((r) => this.hydrateClaim(r, this.claimPaths(r.id)) ?? []);
  }

  /** The no-project `?all=1` arm: every project's rows, ended included — the
   *  same verbatim read `claimsForProject(project, true)` gives one project,
   *  for the PWA's whole-fleet history call (`api.claims({all:true})`). */
  allClaims(): ClaimSummary[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.CLAIM_COLS} FROM claims ORDER BY id`,
    ).all() as Parameters<CoordStore['hydrateClaim']>[0][];
    return rows.flatMap((r) => this.hydrateClaim(r, this.claimPaths(r.id)) ?? []);
  }

  /** `all` includes lapsed/released/broken rows — `?all=1`'s "held by X until
   *  it died" (D12: a destroyed claim is destroyed history). */
  claimsForProject(project: string, all = false): ClaimSummary[] {
    const rows = (all
      ? this.db.prepare(
          `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE project = ? ORDER BY id`)
      : this.db.prepare(
          `SELECT ${CoordStore.CLAIM_COLS} FROM claims WHERE project = ? AND state = 'live' ORDER BY id`)
    ).all(project) as Parameters<CoordStore['hydrateClaim']>[0][];
    return rows.flatMap((r) => this.hydrateClaim(r, this.claimPaths(r.id)) ?? []);
  }

  /** The watcher's renew write (D12: no session-side heartbeat — the SERVER
   *  renews off records it already read). `MIN(?, hardExpiresAt)` is the 8 h
   *  bound no renewal can move; the `state = 'live'` guard keeps a racing
   *  lapse from being silently reopened. No `claim_paths` write: the state
   *  word does not change, so the mirror bit already tells the truth. */
  renewClaimRow(id: number, expiresAt: number, at: number): void {
    this.db.prepare(
      "UPDATE claims SET renewedAt = ?, expiresAt = MIN(?, hardExpiresAt) " +
      "WHERE id = ? AND state = 'live'",
    ).run(at, expiresAt, id);
  }

  /** LAPSE, NEVER DELETE (D12): the row survives with endedAt/endedBy, so
   *  `?all=1` can answer "held by X until it died". A destroyed claim is
   *  destroyed history. One `tx()` for the state word AND the
   *  `claim_paths.live` mirror bit — the schema's own contract, `endClaim`'s
   *  exact shape: the bit is written in the SAME transaction as every
   *  `claims.state` transition, or the partial index answers for a claim
   *  that no longer is. */
  lapseClaimRow(id: number, endedBy: string, at: number): void {
    tx(this.db, () => {
      const res = this.db.prepare(
        "UPDATE claims SET state = 'lapsed', endedAt = ?, endedBy = ? " +
        "WHERE id = ? AND state = 'live'",
      ).run(at, endedBy, id);
      if (Number(res.changes) > 0) {
        this.db.prepare('UPDATE claim_paths SET live = 0 WHERE claimId = ?').run(id);
      }
    });
  }

  /** Run close releases that run's claims IN THE CLOSE TRANSACTION (D12) —
   *  called from `closeRun` only, after the final advance has succeeded,
   *  beside the delivery cancellation it mirrors — and like that method it
   *  takes no `tx()` of its own, because it runs inside `closeRun`'s. The
   *  mirror-bit flip reads the parents through a subquery FIRST
   *  (`expireLapsedInner`'s idiom — it must see them while they still read
   *  live), then the parents take the released word. */
  releaseClaimsForRun(runId: number, at: number): void {
    this.db.prepare(
      'UPDATE claim_paths SET live = 0 WHERE claimId IN ' +
      "(SELECT id FROM claims WHERE runId = ? AND state = 'live')",
    ).run(runId);
    this.db.prepare(
      "UPDATE claims SET state = 'released', endedAt = ?, endedBy = 'run-closed' " +
      "WHERE runId = ? AND state = 'live'",
    ).run(at, runId);
  }

  /* ── the deviation ledger (build 9 wave 7, D8/D13) ─────────────────────── */

  ledgerFloor(project: string): { floor: number; evidence: string; updatedAt: number } | null {
    const row = this.db.prepare(
      'SELECT floor, evidence, updatedAt FROM ledger_floor WHERE project = ?',
    ).get(project) as { floor: number; evidence: string; updatedAt: number } | undefined;
    return row ?? null;
  }

  /** THE FLOOR ONLY EVER RISES (D13) — the conflict arm's WHERE clause is the
   *  mechanism, not caller discipline: a lower scan later (a plan deleted, a
   *  worktree's partial docs) can never walk allocation backward into numbers
   *  already handed out. */
  raiseLedgerFloor(project: string, floor: number, evidence: string, at: number): void {
    this.db.prepare(
      'INSERT INTO ledger_floor (project, floor, evidence, updatedAt) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(project) DO UPDATE SET floor = excluded.floor, ' +
      'evidence = excluded.evidence, updatedAt = excluded.updatedAt ' +
      'WHERE excluded.floor > ledger_floor.floor',
    ).run(project, floor, evidence, at);
  }

  /**
   * Allocate `count` contiguous deviation numbers, as ONE transaction — and
   * the ORDER inside it is the design (D8):
   *
   *   THE FILE FIRST, THE COMMIT SECOND. `log.append` runs before the
   *   INSERTs, inside the same synchronous flow, so a crash — or the
   *   `PRIMARY KEY (project, n)` backstop firing under a future refactor
   *   that loses this transaction — leaves numbers in the file that the
   *   database never committed. Recovery is MAX(file, db): those numbers
   *   are SKIPPED, NEVER REISSUED. Gaps cost nothing; a reissue is the
   *   bb47c9e incident (394 D-ref lines rewritten under merge pressure).
   *
   * Fails shut until seeded (`409 not-seeded` at the route) — `openCoordDb`'s
   * own "refuse to start rather than open empty", one level up. The route
   * owns the 3× in-request retry on a thrown constraint violation.
   *
   * `log` is a PARAMETER, not a constructor field: the route holds the
   * process's one `LedgerLog` (`defaultLedgerLogPath()`), and tests hand in
   * fixture-homed ones — the same reason `dueDeliveries` takes `replayMs`
   * from its caller instead of owning policy here.
   */
  allocateDeviations(input: {
    project: string; count: number; title: string; allocatedTo: string;
    runId: number | null; now?: number;
  }, log: LedgerLog): AllocateResult {
    const now = input.now ?? Date.now();
    return tx(this.db, () => {
      const floorRow = this.ledgerFloor(input.project);
      const dbMax = (this.db.prepare(
        'SELECT MAX(n) AS m FROM ledger_alloc WHERE project = ?',
      ).get(input.project) as { m: number | null }).m;
      const fileMax = log.maxAllocated(input.project);
      // `decideAllocation` (L1) only compares — the store MEASURES maxIssued,
      // and the file's half is what makes recovery MAX(file, db).
      const maxIssued = dbMax === null ? fileMax
        : fileMax === null ? dbMax : Math.max(dbMax, fileMax);
      const d = decideAllocation(floorRow, maxIssued, input.count);
      if (!('ok' in d)) return { ok: false as const, why: d.refused };
      log.append(d.numbers.map((n) => ({
        project: input.project, n, title: input.title,
        allocatedTo: input.allocatedTo, at: now,
      })));
      for (const n of d.numbers) {
        this.db.prepare(
          'INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, state) ' +
          "VALUES (?, ?, ?, ?, ?, ?, 'allocated')",
        ).run(input.project, n, input.title, input.allocatedTo, input.runId, now);
      }
      return {
        ok: true as const,
        allocation: {
          project: input.project, numbers: d.numbers, floor: d.floor,
          title: input.title, allocatedTo: input.allocatedTo,
          runId: input.runId, allocatedAt: now,
        },
      };
    });
  }

  private static readonly LEDGER_COLS =
    'project, n, title, allocatedTo, runId, allocatedAt, state, landedAt, landedIn';

  private hydrateLedger(r: {
    project: string; n: number; title: string; allocatedTo: string; runId: number | null;
    allocatedAt: number; state: string; landedAt: number | null; landedIn: string | null;
  }): LedgerRow {
    // "Read back through the L0 guard, never a cast" — the schema's own rule.
    return { ...r, state: isDeviationAllocState(r.state) ? r.state : 'unknown' };
  }

  ledgerAllocations(project: string): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc WHERE project = ? ORDER BY n`,
    ).all(project) as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }

  /** Every not-yet-landed allocation across every project — what
   *  `sweepLedgerReconcile` walks. */
  openAllocations(): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc WHERE state = 'allocated' ` +
      'ORDER BY project, n',
    ).all() as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }

  /** Every project the allocator has ever issued a number for. The reconcile
   *  sweep's own project list used to be derived from OPEN allocations alone,
   *  which is the right corpus for "did this number land" and the wrong one for
   *  "was this number ever asked for" — a fully-landed project has no open rows
   *  and would never be audited. */
  ledgerProjects(): string[] {
    return (this.db.prepare('SELECT DISTINCT project FROM ledger_alloc ORDER BY project')
      .all() as unknown as { project: string }[]).map((r) => r.project);
  }

  /** Every number ever ISSUED for a project, in any state — the set
   *  `unallocatedDefinitions` measures a plan's definitions against. */
  ledgerIssued(project: string): Set<number> {
    return new Set((this.db.prepare('SELECT n FROM ledger_alloc WHERE project = ?')
      .all(project) as unknown as { n: number }[]).map((r) => r.n));
  }

  /** allocated -> landed, once. `landed` means the number was seen DEFINED in a
   *  plan file of the main checkout's working tree (D13) — not proof of a merge —
   *  and the `state = 'allocated'` guard makes it TERMINAL, so a re-scan never
   *  re-stamps the date and a wrong stamp is never re-decided. */
  markLanded(project: string, n: number, landedIn: string, at: number): void {
    this.db.prepare(
      "UPDATE ledger_alloc SET state = 'landed', landedAt = ?, landedIn = ? " +
      "WHERE project = ? AND n = ? AND state = 'allocated'",
    ).run(at, landedIn, project, n);
  }

  /** Allocated at or before `cutoff`, never landed — REPORTED, never
   *  reclaimed (D13). The cutoff is the CALLER's (the watcher owns the
   *  7-day policy), the `dueDeliveries(replayMs)` pattern. */
  staleAllocations(cutoff: number): LedgerRow[] {
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LEDGER_COLS} FROM ledger_alloc ` +
      "WHERE state = 'allocated' AND allocatedAt <= ? ORDER BY project, n",
    ).all(cutoff) as Parameters<CoordStore['hydrateLedger']>[0][];
    return rows.map((r) => this.hydrateLedger(r));
  }

  /* ── asks (ask pre-emption lane, D-2169..D-2171) ─────────────────────── */

  /** The parent of a dispatched program worker: the coordinator of the run
   *  that dispatched it. DERIVED, never stored — `reclaimProgram` rewrites
   *  `runs.claimedBy` for every run of a program in one transaction, so a
   *  derived answer follows a handover for free while a stored id would name
   *  a corpse.
   *
   *  `state NOT IN ${TERMINAL_RUN_STATES_SQL}` used to be COPIED, hand-written,
   *  from `openRunsForSession` (`:2048`) and `openCoordinatorIds`
   *  (`:2098-2103`), deliberately never the OLD `TERMINAL_RUN_STATES`: that
   *  constant used to be derived from `RUN_TRANSITIONS`, which gives
   *  `'unknown'` an empty outgoing-edge list and so called it terminal — but
   *  every shipped session-keyed query in this file counts an `'unknown'` row
   *  (a token a newer build wrote and this one degrades on read) as OPEN.
   *  Since design 2026-09-14 §7.1 (D-2794) `TERMINAL_RUN_STATES` is L0's own
   *  pair (`shared/api.ts`) and does NOT call `'unknown'` terminal either, so
   *  the divergence this paragraph used to warn about is gone: this query now
   *  names `TERMINAL_RUN_STATES_SQL` directly, agreeing with `rundefs.ts`'s
   *  `survivorOf` (built on `openRunsForSession`) on which run of a session is
   *  open, including on an `'unknown'` row.
   *
   *  ORDER BY id DESC is a CONVENTION, not a guarantee: nothing in the schema
   *  forbids two open runs naming one sessionId, and the coordinator protocol
   *  DELIBERATELY creates that state by opening wave N+1 before closing wave
   *  N. The newest run's claimant is the right answer there, and
   *  `rundefs.ts`'s `survivorOf` documents the same protocol-not-DB-enforced
   *  caveat. Pinned by a two-wave/two-claimant test, verified red under
   *  ASC (fix round 1, finding 2). */
  parentOfSession(childId: string): string | null {
    const row = this.db.prepare(
      `SELECT claimedBy FROM runs WHERE sessionId = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} ` +
      'ORDER BY id DESC LIMIT 1',
    ).get(childId) as { claimedBy: string | null } | undefined;
    return row?.claimedBy ?? null;
  }

  /** EVERY coordinator that currently has `sessionId` working for it: the
   *  DISTINCT non-null `claimedBy` of every non-terminal run naming it as
   *  `sessionId`, newest run first.
   *
   *  A SET, NOT THE NEWEST, and that difference is the whole reason this
   *  method exists beside `parentOfSession` rather than replacing it.
   *  `runs_by_session` (`schema.ts`) is a NON-UNIQUE index, and two shipped
   *  paths deliberately put several open runs on one session: the coordinator
   *  protocol opens wave N+1 before closing wave N, and nothing stops a
   *  session being one programme's worker while another programme's run still
   *  names it. `parentOfSession`'s `LIMIT 1` therefore answers a question
   *  about the NEWEST run — which is the right question for the ask lane, whose
   *  own docstring argues it, and the WRONG one for a guard whose sentence is
   *  "this session is nobody else's worker". Read newest-first so a caller
   *  taking the first offender names the most recent one.
   *
   *  OWNERLESS ROWS CONTRIBUTE NOTHING. `claimedBy IS NOT NULL` is spelled in
   *  the query, so a reconstructed row (D-12, `claimedBy` left NULL because
   *  `reconstruct` cannot know who will resume) is not an entry here and is
   *  not a silent one either — D-3012 ruled that such a run is ADMITTED at the
   *  doors, because `by` is what those refusals are for and there is no `by`
   *  to name. That admission is D-3012's and stays; this method just refuses
   *  to smuggle a `null` into a list of ids.
   *
   *  A FINISHED WORKER IS NOT A WORKER: a session whose runs are all terminal
   *  answers `[]`, the same complement of `TERMINAL_RUN_STATES_SQL` every
   *  session-keyed read in this file uses (including the `'unknown'` token a
   *  newer build may have written, which is OPEN here). Synchronous, like
   *  every read on this store. */
  openClaimantsOf(sessionId: string): string[] {
    const rows = this.db.prepare(
      // D-3054. `GROUP BY claimedBy` is what makes the answer DISTINCT — no `DISTINCT`
      // keyword beside it, which would be a second spelling of the same fact —
      // and `MAX(id)` is what "newest first" is ordered on: each claimant is
      // placed by its most recent open run, so one claimant appearing on three
      // waves is one entry at the newest of them.
      'SELECT claimedBy, MAX(id) AS newest FROM runs ' +
      `WHERE sessionId = ? AND claimedBy IS NOT NULL AND state NOT IN ${TERMINAL_RUN_STATES_SQL} ` +
      'GROUP BY claimedBy ORDER BY newest DESC',
    ).all(sessionId) as { claimedBy: string }[];
    return rows.map((r) => r.claimedBy);
  }

  /** D-2545, the ask half. `id` and `runId` — the two columns in the RUN-ID
   *  DOMAIN (`isPositiveDecimalSafeInteger`) — are CAST to TEXT and proven,
   *  exactly as `RUN_ROW_COLUMNS` does for its four.
   *
   *  THE BOUNDARY, said out loud because the next reader will ask: the four
   *  epoch-millisecond columns (`at`, `askAt`, `answeredAt`, `releasedAt`) are
   *  NOT cast and NOT proven. They are not in this domain — `insertAsk`'s own
   *  ruled guard names `runId` and nothing else — and giving them a
   *  positive-safe-integer guard would invent a contract for them that nothing
   *  in this tree has ruled on. The consequence is stated rather than hidden:
   *  an out-of-safe-range TIMESTAMP still throws out of this method the way
   *  every unguarded persisted read does. That wider surface is D-2560's. */
  private static readonly ASK_COLS =
    'CAST(id AS TEXT) AS idText, at, childId, parentId, CAST(runId AS TEXT) AS runIdText, ' +
    'askKey, askAt, dialogId, question, options, ' +
    'state, answeredBy, answer, answeredAt, releasedAt';

  private hydrateAsk(r: {
    idText: string; at: number; childId: string; parentId: string; runIdText: string | null;
    askKey: string; askAt: number; dialogId: string; question: string; options: string;
    state: string; answeredBy: string | null; answer: string | null;
    answeredAt: number | null; releasedAt: number | null;
  }): { ok: true; ask: AskRow } | { ok: false; detail: string } {
    const id = persistedInt(r.idText, 'ask id');
    if (!id.ok) return id;
    // `runId` is NULLABLE and null is LEGAL — an ask minted for a child with no
    // open run carries none. Decided at this call site, never inside
    // `persistedInt`, for `measureRunNumbers`'s stated reason.
    let runId: number | null = null;
    if (r.runIdText !== null) {
      const measured = persistedInt(r.runIdText, 'ask runId');
      if (!measured.ok) return measured;
      runId = measured.value;
    }
    const { idText: _idText, runIdText: _runIdText, ...rest } = r;
    // Read back through `isAskState`, never a bare cast — an out-of-vocabulary
    // token a newer build wrote degrades honestly to `unknown` instead of
    // being smuggled into the narrow type.
    return {
      ok: true,
      ask: {
        ...rest,
        id: id.value,
        runId,
        options: JSON.parse(r.options) as string[],
        state: isAskState(r.state) ? r.state : 'unknown',
      },
    };
  }

  /** `askById`'s private backer. Every caller across this plan names
   *  `askById`; this exists so `takeAskForAnswer` can read the row inside its
   *  own transaction without going through the public name. */
  private readAsk(id: number): AskReadResult {
    const row = this.db.prepare(
      `SELECT ${CoordStore.ASK_COLS} FROM asks WHERE id = ?`,
    ).get(id) as Parameters<CoordStore['hydrateAsk']>[0] | undefined;
    if (row === undefined) return { ok: true, ask: null };
    const h = this.hydrateAsk(row);
    return h.ok ? { ok: true, ask: h.ask } : { ok: false, kind: 'ask-unreadable', detail: h.detail };
  }

  askById(id: number): AskReadResult {
    return this.readAsk(id);
  }

  /** Minted at hold time (Task 6), state `'held'` — the only state an ask is
   *  ever inserted in; nothing else writes a fresh row.
   *
   *  THE `runId` GUARD IS DEFENSIVE (D-2545) and unreachable by construction
   *  today: its one production call site (`watch.ts`'s `hold`) takes `runId`
   *  straight off `openRunsForSession`, which now proves it before returning
   *  it. It exists for the same reason `hold`'s own `askKey === null` throw
   *  does — so a future drift fails LOUDLY rather than writing a row nothing
   *  can read back — and it THROWS rather than widening this method's return,
   *  because the caller already try/catches into the immediate-operator-push
   *  fallback that is the ruled behaviour for exactly this abort.
   *
   *  `null` IS LEGAL and stays legal: an ask minted for a child with no open
   *  run carries none. Only a NON-NULL value outside the domain is refused —
   *  refused, never coerced. */
  insertAsk(a: {
    childId: string; parentId: string; runId: number | null; askKey: string;
    askAt: number; dialogId: string; question: string; options: string[]; now: number;
  }): number {
    if (a.runId !== null && !isPositiveDecimalSafeInteger(a.runId)) {
      // The COLUMN and nothing else — the offending value never leaves here.
      throw new Error('insertAsk: ask runId is not a positive safe integer');
    }
    const insertAsk = this.db.prepare(
      'INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, ' +
      "question, options, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'held')",
    );
    insertAsk.setReadBigInts(true);

    return tx(this.db, () => {
      const exactId = insertAsk.run(
        a.now, a.childId, a.parentId, a.runId, a.askKey, a.askAt, a.dialogId,
        a.question, JSON.stringify(a.options),
      ).lastInsertRowid;
      if (typeof exactId !== 'bigint' || exactId < 1n || exactId > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('insertAsk: generated ask id is not a positive safe integer');
      }
      return Number(exactId);
    });
  }

  /** The parent's cross-sibling read (Task 11's `GET /api/asks`) — every ask
   *  addressed to this parent, or only those in one `state` when given. */
  asksForParent(parentId: string, state?: AskState): AsksReadResult {
    const rows = (state === undefined
      ? this.db.prepare(
          `SELECT ${CoordStore.ASK_COLS} FROM asks WHERE parentId = ? ORDER BY id`,
        ).all(parentId)
      : this.db.prepare(
          `SELECT ${CoordStore.ASK_COLS} FROM asks WHERE parentId = ? AND state = ? ORDER BY id`,
        ).all(parentId, state)) as Parameters<CoordStore['hydrateAsk']>[0][];
    const asks: AskRow[] = [];
    for (const r of rows) {
      const h = this.hydrateAsk(r);
      // ALL-OR-FAILURE, like every other list read on this surface.
      if (!h.ok) return { ok: false, kind: 'ask-unreadable', detail: h.detail };
      asks.push(h.ask);
    }
    return { ok: true, asks };
  }

  /** Task 12's lookup when the operator answers: the row this child's live
   *  question is held under, if any. At most one `held` row per child is ever
   *  live at a time (a second mint only happens once the first has left
   *  `held`), so the newest is the right — and normally only — answer. */
  heldAskFor(childId: string): AskReadResult {
    const row = this.db.prepare(
      `SELECT ${CoordStore.ASK_COLS} FROM asks ` +
      "WHERE childId = ? AND state = 'held' ORDER BY id DESC LIMIT 1",
    ).get(childId) as Parameters<CoordStore['hydrateAsk']>[0] | undefined;
    if (row === undefined) return { ok: true, ask: null };
    const h = this.hydrateAsk(row);
    return h.ok ? { ok: true, ask: h.ask } : { ok: false, kind: 'ask-unreadable', detail: h.detail };
  }

  /** Task 19's fleet-chip lookup: the newest ask row for this child, in ANY
   *  state — unlike `heldAskFor` above, which is scoped to `'held'` for Task
   *  12's operator-answer lookup and would answer `null` through
   *  `answering`/`answered`/`released`/`stale` alike. This method makes no
   *  judgement about which states are worth showing; `fleet.ts`'s `fleetAsk`
   *  does that folding on the row this returns, the same "hydrate raw, let
   *  the caller fold" split `asksForParent` already keeps. Keyed on
   *  `asks_by_child` (schema.ts) — an indexed read, not a scan. `ORDER BY id
   *  DESC LIMIT 1` names the CURRENT question even once a second ask has
   *  been minted for the same child, because a fresh insert only ever
   *  happens once the previous row has left `held` (`insertAsk`'s own
   *  docstring) — there is never more than one row in flight to disambiguate
   *  by anything other than recency. */
  currentAskFor(childId: string): AskReadResult {
    const row = this.db.prepare(
      `SELECT ${CoordStore.ASK_COLS} FROM asks WHERE childId = ? ORDER BY id DESC LIMIT 1`,
    ).get(childId) as Parameters<CoordStore['hydrateAsk']>[0] | undefined;
    if (row === undefined) return { ok: true, ask: null };
    const h = this.hydrateAsk(row);
    return h.ok ? { ok: true, ask: h.ask } : { ok: false, kind: 'ask-unreadable', detail: h.detail };
  }

  /** `currentAskFor`'s BATCHED form (fix round 1, item 3 — coordinator
   *  review): `assembleFleet` needs "the newest ask row per child" for the
   *  WHOLE registry every tick, and a point lookup per child meant one
   *  `db.prepare` + one indexed `.get` PER SESSION — ~20 statement
   *  compilations every 2s tick alone, before the `/ws/fleet` connect,
   *  `GET /api/fleet`, `GET /api/peers` and `POST /api/claims`-conflict
   *  call sites that each assemble the fleet again. One query instead:
   *  `MAX(id) … GROUP BY childId` names the newest id per matching child in
   *  a single pass keyed on `asks_by_child` (the same index the singular
   *  form already leans on), and the outer `WHERE id IN (…)` is a second,
   *  primary-key lookup for the full rows — cheap, and it keeps this
   *  method, like every other in this file, off `SELECT *`.
   *
   *  `placeholders` (D-1141, above) builds the `IN (...)` — never bare
   *  string interpolation of `childIds` itself, so every value still
   *  travels as a positional bind. Empty `childIds` short-circuits to an
   *  empty map without preparing a statement at all: `assembleFleet` on a
   *  registry with no rows (a fresh box) is the common case this guards,
   *  and `placeholders(0)` would otherwise emit a syntactically invalid
   *  `IN ()`. A child with no ask row at all is simply ABSENT from the
   *  returned map — the caller's `.get(id) ?? null` fold, not a `null`
   *  entry here. */
  currentAsksFor(childIds: readonly string[]): AsksByChildResult {
    const out = new Map<string, AskRow>();
    if (childIds.length === 0) return { ok: true, asks: out };
    const ph = placeholders(childIds.length);
    const rows = this.db.prepare(
      `SELECT ${CoordStore.ASK_COLS} FROM asks WHERE id IN (` +
        `SELECT MAX(id) FROM asks WHERE childId IN (${ph}) GROUP BY childId` +
      ')',
    ).all(...childIds) as Parameters<CoordStore['hydrateAsk']>[0][];
    for (const r of rows) {
      const h = this.hydrateAsk(r);
      // ALL-OR-FAILURE. One unreadable row fails the WHOLE frame rather than
      // silently removing one session's ask chip from the board.
      if (!h.ok) return { ok: false, kind: 'ask-unreadable', detail: h.detail };
      out.set(r.childId, h.ask);
    }
    return { ok: true, asks: out };
  }

  /** THE GUARD IS IN THE `WHERE` (the `endClaim` shape). Two predicates, and
   *  they are DIFFERENT refusals a caller acts on differently: `not-held`
   *  means the row has LEFT `'held'` and is no longer pre-emptible (D-2171);
   *  `ask-moved` means the child has written its hookstate again since the
   *  mint, so the menu on screen may be a DIFFERENT INSTANCE of an identical
   *  question (D-2170). Collapsing them would be an overloaded value at a
   *  seam — one is about the row, the other is a near-miss wrong answer.
   *
   *  CORRECTED (whole-branch review M3): this said `not-held` means "another
   *  principal already took this row", naming ONE of the four states that
   *  answer it. The CAS source is `'held'` alone, so `answering` (the take
   *  it described), `released`, `stale` and `answered` all land here — and
   *  only the first is a lost race a retry could win. See `AskTakeResult`'s
   *  own docstring above for the full list; the same false gloss had reached
   *  `wave-lifecycle.md`, where a coordinator reads it. */
  takeAskForAnswer(id: number, askAt: number): AskTakeResult {
    return tx(this.db, () => {
      const read = this.readAsk(id);
      // UNREADABLE IS NOT UNKNOWN, and `AskTakeResult` has no slot for it
      // (D-2545). Answering `'unknown-ask'` here would be the overloaded value
      // this whole change removes — a coordinator told "no such ask" for a row
      // that is sitting there. It THROWS instead, and it is unreachable by
      // construction from both call sites: `/answer` reads `askById` and
      // `POST /api/sessions/:id/ask` reads `heldAskFor` immediately before,
      // each refusing the unreadable row in its own words first. Widening
      // `AskTakeResult` would put a never-wire word into the ask refusal
      // vocabulary the two routes send verbatim.
      if (!read.ok) throw new Error(`takeAskForAnswer: ${read.detail}`);
      const row = read.ask;
      if (row === null) return { ok: false as const, why: 'unknown-ask' as const };
      if (row.askAt !== askAt) return { ok: false as const, why: 'ask-moved' as const };
      const res = this.db.prepare(
        "UPDATE asks SET state = 'answering' WHERE id = ? AND state = 'held' AND askAt = ?",
      ).run(id, askAt);
      if (Number(res.changes) === 0) return { ok: false as const, why: 'not-held' as const };
      return { ok: true as const, row };
    });
  }

  /** answering -> held, CAS (fix round 1, finding 3).
   *  The rollback `takeAskForAnswer`'s caller reaches for when the take
   *  succeeded but the press itself was refused — a refusal there means no
   *  digit was pressed and the question is still live. CORRECTED (D-2177
   *  fix round 1): NOT because every one of `answerAsk`'s guards precedes
   *  its `sendKey` loop — since D-2177 a failed `sendKey` refuses too
   *  (`inject/ask.ts:136`, `:151`), so a refusal CAN now happen mid-send.
   *  The real reason the conclusion still holds HERE: a row only ever
   *  exists for a SINGLE-SELECT ask. `askActions` returns null whenever
   *  `multiSelect === true` (`askkey.ts:83`), and `actions !== null` is the
   *  sole eligibility gate `hold` checks before minting a row at all
   *  (`watch.ts:3452`, D-2173) — a multi-select ask never gets a row to roll
   *  back in the first place. A single-select answer makes exactly ONE
   *  `sendKey` call and no Enter, so its `false` — send-keys exiting
   *  nonzero — IS "the digit did not land," with no partial-send case a row
   *  here could ever observe. `takeAskForAnswer`'s `askAt` CAS (above) pins
   *  the live envelope to the mint-time one, so the question cannot have
   *  turned multi-select between mint and this rollback either. A DISTINCT
   *  verb from `releaseAsk` on purpose: "I abandoned my attempt" (still
   *  pre-emptible, no push) and "the window is over" (push fires) are
   *  different facts a reader of `state` needs to tell apart, and
   *  `releaseAsk`'s CAS source is `'held'` — it cannot even reach a row
   *  this call finds, which sat in `'answering'`. Returns whether THIS call
   *  moved it, the same "I did it" vs. "someone else already did" shape as
   *  `releaseAsk`/`staleAsk`. */
  untakeAsk(id: number): boolean {
    const res = this.db.prepare(
      "UPDATE asks SET state = 'held' WHERE id = ? AND state = 'answering'",
    ).run(id);
    return Number(res.changes) > 0;
  }

  /** answering -> answered, CAS (fix round 1, finding 4: unguarded, a future
   *  caller that settles without first taking could rewrite a `released` or
   *  `stale` row to `'answered'` with a fabricated `answeredBy`/`answer`/
   *  `answeredAt` — a record asserting an answer nobody gave, in a table
   *  whose whole stated job (schema.ts's own D-2169 comment) is to BE the
   *  record. That is a silent lie, not a silent no-op, so it gets the same
   *  `WHERE` guard as every other conditional write here even though every
   *  path that reaches this method today already holds the row exclusively
   *  at `'answering'` via a preceding `takeAskForAnswer`. `void` stays: no
   *  current caller needs to distinguish "settled" from "lost the row
   *  between take and settle", and inventing that distinction here would be
   *  answering a question nobody asked rather than closing the one that was
   *  asked (a wedge, not a race, is the failure this guard closes). */
  settleAsk(id: number, by: string, answer: string, now: number): void {
    this.db.prepare(
      "UPDATE asks SET state = 'answered', answeredBy = ?, answer = ?, answeredAt = ? " +
      "WHERE id = ? AND state = 'answering'",
    ).run(by, answer, now, id);
  }

  /** held -> released, CAS. Returns whether THIS call applied it, so the
   *  sweep can tell "I released it" (push may proceed) from "someone beat
   *  me" (a principal already took the row; the sweep must not push a stale
   *  payload out from under an in-flight answer). */
  releaseAsk(id: number, now: number): boolean {
    const res = this.db.prepare(
      "UPDATE asks SET state = 'released', releasedAt = ? WHERE id = ? AND state = 'held'",
    ).run(now, id);
    return Number(res.changes) > 0;
  }

  /** held OR answering -> stale, CAS, keyed by the pane's own identity
   *  (`dialogId`) and the child that painted it — the dialog vanishing off
   *  the pane is the only signal `detectDialogs`' clear branch acts on. Same
   *  CAS shape as `releaseAsk`: the return says whether this call is the one
   *  that ended the hold.
   *
   *  BOTH LIVE STATES, not `'held'` alone (whole-branch review F2(a), a
   *  RULING). The narrow form stranded a row FOREVER whenever the dialog
   *  cleared while a principal sat mid-answer: the clear branch deletes its
   *  `heldAsks` entry unconditionally (so `sweepAsks`, the map's only
   *  collector, can never see the row again) while this CAS changed zero
   *  rows — and `fleet.ts`'s `fleetAsk` folds `answering` onto `held`, so the
   *  child wore a permanent "held — <parent> may answer" chip for a question
   *  that no longer exists. No restart is needed to reach it. A vanished
   *  dialog is stale whichever principal was mid-answer, so the source names
   *  both.
   *
   *  TWO STATES, NEVER ALL SIX. `answered`, `released` and `stale` are
   *  decisions that were really taken, and a late clear tick must not rewrite
   *  one — the same reasoning `settleAsk`'s own `WHERE` carries. The residual
   *  the widened arm buys, stated rather than discovered: a digit that lands
   *  and a clear tick that arrives in the microseconds BEFORE the route's
   *  `settleAsk` runs will leave that settle a no-op against a now-`stale`
   *  row, so the answer is not named on the row. That is precisely why both
   *  answer routes write their `feed_events` record BEFORE `settleAsk` and
   *  say so in their own comments: the feed entry, not this column, is the
   *  trace that survives a failure in this window. */
  staleAsk(dialogId: string, childId: string, now: number): boolean {
    const res = this.db.prepare(
      "UPDATE asks SET state = 'stale', releasedAt = ? " +
      "WHERE dialogId = ? AND childId = ? AND state IN ('held','answering')",
    ).run(now, dialogId, childId);
    return Number(res.changes) > 0;
  }

  /** `askAt` ADVANCED, CAS'd on the two witnesses that say the instance did
   *  not change (D-2403). The other half of D-2170's guard, and the half it
   *  shipped without.
   *
   *  `askAt` is a snapshot of the child's hookstate `updatedAt` at mint, and
   *  `takeAskForAnswer` refuses `ask-moved` unless a fresh read still equals
   *  it. `freshAskAt`'s docstring argues that correctly for SUBSTITUTION —
   *  `askKey` hashes CONTENT, so a child looping over identical questions
   *  mints the same key twice and `updatedAt` is what tells instance 1 from
   *  instance 2. What it does not say is that `updatedAt` moves for reasons
   *  that have nothing to do with the dialog: `ccd/session-hook.sh` stamps it
   *  unconditionally on EVERY write, and its `SubagentStart`/`SubagentStop`
   *  arm re-reads `.ask` straight back off the file (`:1227` — D-2404: it is
   *  that re-read, NOT the `:1233` ask-clear exemption two reviewers named,
   *  since `state` is `waiting` on this path and the clear never applies) and
   *  restores `prev_state`, so a subagent event on a session blocked at a dialog
   *  rewrites the identical envelope under a fresh number. Nothing re-stamped
   *  the row, so ONE such bump refused every parent answer for the row's
   *  whole life and the lane degraded, silently and greenly, to the
   *  pre-feature behaviour it was built to replace. Measured across the seam
   *  in `server/test/ask-instance-guard.test.ts` — the real hook writing, the
   *  real CAS refusing, with the control that says the bump is why.
   *
   *  WHY THIS IS NOT A WEAKENING. The `WHERE` demands both witnesses the
   *  guard actually cares about: `dialogId` — the sha1 of the menu painted in
   *  the pane, which `detectDialogs` re-scrapes every tick and which no hook
   *  event can move — and `askKey`, the content the parent would be
   *  answering. The caller passes them from THIS tick's scrape and THIS
   *  tick's hookstate, so an advance is a positive observation that the same
   *  menu is still on screen carrying the same question, not an assumption
   *  that nothing happened. Repaint the dialog, change the question, or lose
   *  the pane, and zero rows change: the stale `askAt` stands and the CAS
   *  refuses exactly as designed. `'held'` alone, never `'answering'`: a
   *  principal mid-answer already took the row against a specific `askAt`,
   *  and moving it under them would be the race this guard exists to lose.
   *
   *  The residual, stated rather than discovered: the scrape is a 2 s poll,
   *  so a bump landing between the last re-stamp and the route's own fresh
   *  read still refuses once. That is a refusal a retry wins — which is what
   *  `wave-lifecycle.md` already tells a coordinator `ask-moved` means —
   *  rather than the permanent wedge it replaces. */
  restampAsk(a: { id: number; dialogId: string; askKey: string; askAt: number }): boolean {
    const res = this.db.prepare(
      "UPDATE asks SET askAt = ? WHERE id = ? AND state = 'held' AND dialogId = ? AND askKey = ?",
    ).run(a.askAt, a.id, a.dialogId, a.askKey);
    return Number(res.changes) > 0;
  }

  // ── pool edges ────────────────────────────────────────────────────────
  //
  // Account-pool membership. `setAccountPools` copies `allocateDeviations`'s
  // sequence exactly: the journal is appended INSIDE the transaction, BEFORE
  // the commit, and recovery takes MAX(file, db) so an epoch is SKIPPED,
  // NEVER REISSUED. See `pooledgelog.ts` for why a reissue is the one
  // outcome this whole design exists to prevent.

  /** T6-R4 (fix round 1): a NAMED refusal rather than the raw `UNIQUE
   *  constraint failed` `pool_edges_one_per_account` used to throw — that
   *  raw throw happened AFTER `log.append` had already committed a journal
   *  line for a membership the store went on to reject, and reached an
   *  uncaught caller as a bare exception (a 500, once a route calls this).
   *  Shaped like `AdvanceResult`/`OpenRunResult` above: a route checks `.ok`
   *  and answers structured, not a 500.
   *
   *  C2 (fix round 2, measured): the caller MUST bind the result and branch
   *  on `.ok` before acting on it — discarding the call entirely compiles
   *  clean and silent, and a refusal then reads as a success at the call
   *  site, because the type system enforces the narrowing only if a caller
   *  reads `.epoch` at all. */
  setAccountPools(input: {
    accountId: string; pools: readonly string[]; addedBy: string | null; now?: number;
  }, log: PoolEdgeLog): SetAccountPoolsResult {
    // Wave 1 is one-pool-per-account (`pool_edges_one_per_account`, migration
    // 13). Refused HERE — before `log.maxEpoch()`/`log.append()` ever run —
    // so a refused write leaves no journal line asserting a membership the
    // store never accepted, and never opens a transaction it would only roll
    // back.
    if (input.pools.length > 1) {
      return { ok: false, error: 'multi-pool-not-supported', pools: input.pools };
    }
    const now = input.now ?? Date.now();
    return tx(this.db, () => {
      const dbMax = (this.db.prepare('SELECT epoch AS e FROM pool_epoch WHERE id = 1')
        .get() as { e: number }).e;
      const fileMax = log.maxEpoch();
      const epoch = (fileMax === null ? dbMax : Math.max(dbMax, fileMax)) + 1;
      log.append([{ epoch, accountId: input.accountId, pools: input.pools,
                    addedBy: input.addedBy, at: now }]);
      this.db.prepare("DELETE FROM pool_edges WHERE subjectKind = 'account' AND subjectId = ?")
        .run(input.accountId);
      for (const p of input.pools) {
        this.db.prepare(
          'INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) ' +
          "VALUES ('account', ?, ?, ?, ?)",
        ).run(input.accountId, p, now, input.addedBy);
      }
      const digest = this.poolEdgeDigest();
      this.db.prepare('UPDATE pool_epoch SET epoch = ?, issuedAt = ?, digest = ? WHERE id = 1')
        .run(epoch, now, digest);
      return { ok: true as const, epoch };
    });
  }

  accountPoolEdges(): Map<string, string[]> {
    const rows = this.db.prepare(
      "SELECT subjectId, pool FROM pool_edges WHERE subjectKind = 'account' ORDER BY subjectId, pool",
    ).all() as { subjectId: string; pool: string }[];
    const out = new Map<string, string[]>();
    for (const r of rows) {
      const cur = out.get(r.subjectId);
      if (cur === undefined) out.set(r.subjectId, [r.pool]); else cur.push(r.pool);
    }
    return out;
  }

  poolEpoch(): { epoch: number; issuedAt: number; digest: string } {
    return this.db.prepare('SELECT epoch, issuedAt, digest FROM pool_epoch WHERE id = 1')
      .get() as { epoch: number; issuedAt: number; digest: string };
  }

  /** T6-R3 (fix round 1): derived FROM `accountPoolEdges()` rather than a
   *  second copy of its SELECT/WHERE/ORDER BY/cast — two copies is an
   *  ORDER BY that can drift out of step with nothing positioned to notice
   *  (F3: nothing asserted this digest at all before this round).
   *  `accountPoolEdges()`'s rows already arrive sorted by `subjectId, pool`,
   *  and `Map` iterates in insertion order, so the concatenation below stays
   *  exactly as sorted as the direct query was.
   *
   *  Purely content-derived: two epochs over identical membership collide on
   *  the same digest. Intended — the digest fingerprints WHAT is tagged, not
   *  WHEN — but stated here since nothing said it before this round.
   *
   *  PROVENANCE, NOT A MECHANISM (item 8): nothing reads `pool_epoch.digest`
   *  back out — `poolEpoch()`'s callers all consume `epoch`/`issuedAt` — so
   *  do not go looking for a consumer. It is written so a later debugging
   *  session can tell two epochs' membership apart (or confirm they match)
   *  without re-deriving this exact concatenation by hand. */
  private poolEdgeDigest(): string {
    const lines: string[] = [];
    for (const [subjectId, pools] of this.accountPoolEdges()) {
      for (const pool of pools) lines.push(`${subjectId} ${pool}`);
    }
    return bodyDigest(lines.join('\n'));
  }

  // ── update catalogue (design 2026-09-20 §6, §7; W2) ────────────────────
  //
  // `releases`' catalogue columns have ONE writer, `applyReleaseListing`
  // (D-3180): the yank mark is a statement about the
  // whole listing, which a per-row upsert cannot make without a second writer
  // on the group. `notifiedAt` is the notification group's, and only
  // `markReleaseNotified` (W3, the last public method of this section) names
  // it. A node's verdict on a release is a `node_release_refusals` row,
  // keyed by node — never a column on `releases` (decision 16). Every
  // signature below is ONE line: Task 7's writer-group scan walks back from
  // each statement to its method the way `mail-hardening.test.ts`'s `SIG`
  // does (the D-2338 precedent).

  /** The one catalogue writer. Upserts every listed row and marks `yanked = 1`
   *  every known, un-yanked row absent from the listing — all of them under
   *  `complete`, only those inside the listed window under `newest-page`
   *  (D-3185), NONE at all under `single` (D-3215: one release, no absence
   *  judgment; a `listing` of any length but 1 under `single` is refused
   *  `single-not-one` before anything else runs). NEVER deletes: a node may
   *  be running a yanked release, and rollback may target one. An empty
   *  listing while rows are known is refused rather than read as "everything
   *  was yanked". "Absent" is absent from THIS argument: an element the
   *  poller could not parse is not here, so its known row is marked too, and
   *  it unyanks on the next poll that parses it (D-3206). `keepTags` (fix
   *  round 1, review round 2, I3) is the LISTING's own exception list, never
   *  itself upserted here — the poller passes the tag its OWN last
   *  successful `single` upsert named, so a `complete`/`newest-page` listing
   *  that omits it (the off-page-stable shape D-3215 exists for) never marks
   *  it `yanked = 1` out from under the latest probe; an invalid entry is
   *  silently dropped, never a reason to refuse the whole listing. `withdrawTag`
   *  (fix round 1, item 5, ruling A) is read ONLY under `'withdrawn'` coverage:
   *  the poller's own targeted tag fetch answered 404, so this call yanks
   *  EXACTLY that one tag — never the general `since`/window judgment below,
   *  which proves nothing about a release outside its own listing. */
  applyReleaseListing(listing: readonly ReleaseListingRow[], now: number, coverage: ListingCoverage, keepTags: readonly string[] = [], withdrawTag: string | null = null): ApplyReleaseListingResult {
    if (coverage === 'single' && listing.length !== 1) {
      return { ok: false, why: 'single-not-one', count: listing.length };
    }
    if (coverage === 'withdrawn') {
      if (listing.length !== 0) return { ok: false, why: 'withdrawn-not-empty', count: listing.length };
      if (!isReleaseTag(withdrawTag ?? '')) return { ok: false, why: 'bad-tag', tag: withdrawTag ?? '' };
      const res = this.db.prepare('UPDATE releases SET yanked = 1 WHERE tag = ? AND yanked = 0').run(withdrawTag);
      return { ok: true, upserted: 0, yanked: Number(res.changes), unyanked: 0 };
    }
    const seen = new Set<string>();
    for (const r of listing) {
      if (!isReleaseTag(r.tag)) return { ok: false, why: 'bad-tag', tag: r.tag };
      if (seen.has(r.tag)) return { ok: false, why: 'duplicate-tag', tag: r.tag };
      if (!isUpdateChannel(r.channel)) return { ok: false, why: 'bad-row', tag: r.tag, field: 'channel' };
      if (!Number.isSafeInteger(r.publishedAt) || r.publishedAt < 0) {
        return { ok: false, why: 'bad-row', tag: r.tag, field: 'publishedAt' };
      }
      // D-3216 (F10): `null` is the caller's honest "no usable url" — the
      // release stays listed with this column alone withheld. `''` remains
      // refused: it is the on-disk sentinel below, never a value a caller
      // may hand in directly.
      if (r.tarballUrl !== null && (typeof r.tarballUrl !== 'string' || r.tarballUrl === '')) {
        return { ok: false, why: 'bad-row', tag: r.tag, field: 'tarballUrl' };
      }
      seen.add(r.tag);
    }
    if (listing.length === 0) {
      const known = (this.db.prepare('SELECT COUNT(*) AS n FROM releases').get() as { n: number }).n;
      return known > 0 ? { ok: false, why: 'empty-listing', known } : { ok: true, upserted: 0, yanked: 0, unyanked: 0 };
    }
    const since = coverage === 'complete' ? Number.MIN_SAFE_INTEGER : Math.min(...listing.map((r) => r.publishedAt));
    // I3: the kept tags join the listing's own in the yank exclusion, never
    // in `seen`/upserted — they are excluded from the WHERE, not written.
    const keep = keepTags.filter((t) => isReleaseTag(t) && !seen.has(t));
    const excludeTags = [...listing.map((r) => r.tag), ...keep];
    const marks = excludeTags.map(() => '?').join(', ');
    return tx(this.db, (): ApplyReleaseListingResult => {
      const wasYanked = new Set((this.db.prepare('SELECT tag FROM releases WHERE yanked = 1')
        .all() as { tag: string }[]).map((r) => r.tag));
      let unyanked = 0;
      for (const r of listing) {
        this.db.prepare(
          'INSERT INTO releases (tag, version, channel, publishedAt, commitSha, tarballUrl, bundleListed, notes, ' +
          'yanked, observedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tag) DO UPDATE SET ' +
          'version = excluded.version, channel = excluded.channel, publishedAt = excluded.publishedAt, ' +
          'commitSha = excluded.commitSha, tarballUrl = excluded.tarballUrl, bundleListed = excluded.bundleListed, ' +
          'notes = excluded.notes, yanked = excluded.yanked, observedAt = excluded.observedAt',
        ).run(r.tag, r.tag, r.channel, r.publishedAt, r.commitSha, r.tarballUrl ?? '', r.bundleListed ? 1 : 0,
          r.notes, r.draft ? 1 : 0, now);
        if (wasYanked.has(r.tag) && !r.draft) unyanked += 1;
      }
      // D-3215: `single` names one release outside any window — it judges no
      // absence, so the yank statement never runs under it.
      if (coverage === 'single') return { ok: true, upserted: listing.length, yanked: 0, unyanked };
      const res = this.db.prepare(
        `UPDATE releases SET yanked = 1 WHERE yanked = 0 AND publishedAt >= ? AND tag NOT IN (${marks})`,
      ).run(since, ...excludeTags);
      return { ok: true, upserted: listing.length, yanked: Number(res.changes), unyanked };
    });
  }

  /** READ, not a writer — the writer-group scan governs writes only. Fix
   *  round 1, item 5 (ruling A): the poller's own reference tag K is never
   *  stored; it is derived on demand, at poller creation and whenever the
   *  poller's remembered tag has gone null (a restart, or a first ever poll),
   *  as the newest un-yanked `channel = 'stable'` release BY TAG — the same
   *  comparator (`newestTag`, `compareReleaseTags`) every other ordering in
   *  this design uses, never `publishedAt`. `null` when no such release is
   *  known yet. */
  newestUnyankedStable(): string | null {
    const rows = this.db.prepare("SELECT tag FROM releases WHERE yanked = 0 AND channel = 'stable'")
      .all() as { tag: string }[];
    return newestTag(rows.map((r) => r.tag));
  }

  /** A node's verdict on a release (§8: a changed `failed` report whose detail
   *  begins `provenance:`). The guard is the statement's own `WHERE EXISTS` —
   *  a refusal for a node that is not a row is never written — and a second
   *  verdict on the same (node, tag) keeps the first. */
  refuseRelease(nodeId: string, tag: string, at: number, detail: string): RefuseReleaseResult {
    if (!isReleaseTag(tag)) return { ok: false, why: 'bad-tag' };
    const res = this.db.prepare(
      'INSERT INTO node_release_refusals (nodeId, tag, at, detail) ' +
      'SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?) ON CONFLICT DO NOTHING',
    ).run(nodeId, tag, at, detail, nodeId);
    if (Number(res.changes) > 0) return { ok: true, inserted: true };
    return this.nodeRowExists(nodeId) ? { ok: true, inserted: false } : { ok: false, why: 'unknown-node' };
  }

  /** This node's verdicts, all of them — `ack` (Task 5's `ackNode`) is the
   *  operator's door; this is the store's. Another node's rows are untouched. */
  clearRefusals(nodeId: string): ClearRefusalsResult {
    const res = this.db.prepare(
      'DELETE FROM node_release_refusals WHERE nodeId = ? AND EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?)',
    ).run(nodeId, nodeId);
    if (Number(res.changes) > 0) return { ok: true, cleared: Number(res.changes) };
    return this.nodeRowExists(nodeId) ? { ok: true, cleared: 0 } : { ok: false, why: 'unknown-node' };
  }

  /** The catalogue, newest first. A superseded node's verdicts are left out of
   *  the roll-up (§8: every reader excludes superseded rows); `refusalsFor`
   *  still names them, keyed by the id they were written under. */
  releases(): ReleaseRow[] {
    const refused = new Map<string, { by: string; at: number }[]>();
    const verdicts = this.db.prepare(
      'SELECT nodeId, tag, at FROM node_release_refusals ' +
      'WHERE nodeId NOT IN (SELECT nodeId FROM nodes WHERE supersededBy IS NOT NULL) ORDER BY at, nodeId',
    ).all() as { nodeId: string; tag: string; at: number }[];
    for (const v of verdicts) {
      const cur = refused.get(v.tag);
      if (cur === undefined) refused.set(v.tag, [{ by: v.nodeId, at: v.at }]);
      else cur.push({ by: v.nodeId, at: v.at });
    }
    const rows = this.db.prepare(
      'SELECT tag, version, channel, publishedAt, commitSha, tarballUrl, bundleListed, notes, yanked, observedAt, ' +
      'notifiedAt FROM releases ORDER BY publishedAt DESC, tag',
    ).all() as unknown as RawReleaseRow[];   // an interface has no index signature — `RunRowDb`'s cast (`:2121`)
    return rows.map((r) => ({
      tag: r.tag, version: r.version, channel: isUpdateChannel(r.channel) ? r.channel : null,
      publishedAt: r.publishedAt, commitSha: r.commitSha, tarballUrl: r.tarballUrl === '' ? null : r.tarballUrl,
      bundleListed: r.bundleListed === 1, notes: r.notes, yanked: r.yanked === 1, observedAt: r.observedAt,
      notifiedAt: r.notifiedAt, refused: refused.get(r.tag) ?? [],
    }));
  }

  refusalsFor(nodeId: string): RefusalRow[] {
    return this.db.prepare(
      'SELECT nodeId, tag, at, detail FROM node_release_refusals WHERE nodeId = ? ORDER BY at, tag',
    ).all(nodeId) as unknown as RefusalRow[];
  }

  /** The notification group's ONE writer (design 2026-09-20 §6, §13; W3).
   *  Stamps `notifiedAt` on one catalogue row, ONCE: the guard is the
   *  statement's own `WHERE … AND notifiedAt IS NULL`, so a second marker —
   *  the other lane in the same tick, or a restarted process over the same
   *  `coord.db` — changes nothing and is told the value that stands. The
   *  caller (`FleetWatcher.pushRelease`) starts a send only after this
   *  returns ok, which is what makes the release push at-most-once per tag
   *  (D-3295). Writes `notifiedAt` and nothing else,
   *  and no method sets it back to NULL. `at` is a caller's clock: a value
   *  that is not a non-negative safe integer throws, because SQLite binds
   *  NaN as NULL — the row would stay unmarked while this answered ok, and
   *  the next sweep would push the tag again. */
  markReleaseNotified(tag: string, at: number): MarkReleaseNotifiedResult {
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new RangeError(`markReleaseNotified: at must be a non-negative integer ms timestamp, got ${String(at)}`);
    }
    if (!isReleaseTag(tag)) return { ok: false, why: 'bad-tag', tag };
    return tx(this.db, (): MarkReleaseNotifiedResult => {
      const res = this.db.prepare('UPDATE releases SET notifiedAt = ? WHERE tag = ? AND notifiedAt IS NULL')
        .run(at, tag);
      if (Number(res.changes) > 0) return { ok: true, notifiedAt: at };
      // The `why` of a zero-change write, read back after it in the same
      // IMMEDIATE transaction: a row that exists failed the IS NULL guard, so
      // its notifiedAt is the first marker's, never NULL.
      const row = this.db.prepare('SELECT notifiedAt FROM releases WHERE tag = ?')
        .get(tag) as { notifiedAt: number } | undefined;
      return row === undefined
        ? { ok: false, why: 'unknown-release', tag }
        : { ok: false, why: 'already-notified', notifiedAt: row.notifiedAt };
    });
  }

  /** Any `nodes` row with this id, superseded included — the read a
   *  zero-change refusal write takes its `why` from, AFTER the write. */
  private nodeRowExists(nodeId: string): boolean {
    return this.db.prepare('SELECT 1 AS one FROM nodes WHERE nodeId = ?').get(nodeId) !== undefined;
  }

  // ── update inventory (design 2026-09-20 §6, §8, §10; W2) ───────────────
  //
  // The node row's writer groups, one method family each (§6): measurement +
  // report (`upsertNodeMeasurement`, `markUnreachable`), identity
  // (`rekeyNode`), lease (`releaseLease`, `settleNode`, `ackNode`; W4 adds
  // `dispatchNode`), resolved (`resolveNode`), request (`settleNode` and
  // `ackNode` clear it; W4's `requestNode` sets it). Every guard is in the
  // `WHERE`; a zero-change write reads its `why` back AFTER the write; every
  // signature is ONE line, so Task 7's writer-group scan can attribute each
  // statement to its method (`mail-hardening.test.ts`'s `SIG`, the D-2338
  // precedent). Nothing in W2 calls a lease writer on a real row — no W2 code
  // acquires a lease — so the release and settle arms are pinned on planted
  // fixtures for W4's dispatcher to reach.

  /** The measurement and report groups, plus `role` and `label`, and nothing
   *  else. A row whose id was superseded is never written again: the heir is
   *  the node now. `reachable = 1` on every measurement — the sweep measured
   *  it, so it was reachable on this sweep. */
  upsertNodeMeasurement(m: NodeMeasurement): UpsertNodeResult {
    const r = m.report;
    const vals: (string | number | null)[] = [
      m.role, m.label, m.currentVersion, m.currentSha, m.currentRef, m.currentBuiltAt,
      m.currentDirty === null ? null : (m.currentDirty ? 1 : 0), m.stampRead, m.installState, m.provenance,
      m.caps.join(' '), m.agentOps === null ? null : m.agentOps.join(' '), m.highestVersion, m.previousVersion,
      m.floorRead, m.previousRead,
      m.os, m.measuredAt,
      r === null ? null : r.phase, r === null ? null : r.target, r === null ? null : r.startedAt,
      r === null ? null : r.updatedAt, r === null ? null : r.detail,
    ];
    return tx(this.db, (): UpsertNodeResult => {
      const ins = this.db.prepare(
        'INSERT INTO nodes (nodeId, role, label, currentVersion, currentSha, currentRef, currentBuiltAt, ' +
        'currentDirty, stampRead, installState, provenance, caps, agentOps, highestVersion, previousVersion, ' +
        'floorRead, previousRead, os, ' +
        'measuredAt, reachable, unreachableSince, reportedPhase, reportedTarget, reportedStartedAt, ' +
        'reportedUpdatedAt, reportedDetail) VALUES (' +
        '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, ?) ON CONFLICT(nodeId) DO NOTHING',
      ).run(m.nodeId, ...vals);
      if (Number(ins.changes) > 0) return { ok: true, created: true };
      const upd = this.db.prepare(
        'UPDATE nodes SET role = ?, label = ?, currentVersion = ?, currentSha = ?, currentRef = ?, ' +
        'currentBuiltAt = ?, currentDirty = ?, stampRead = ?, installState = ?, provenance = ?, caps = ?, ' +
        'agentOps = ?, highestVersion = ?, previousVersion = ?, floorRead = ?, previousRead = ?, ' +
        'os = ?, measuredAt = ?, reachable = 1, ' +
        'unreachableSince = NULL, reportedPhase = ?, reportedTarget = ?, reportedStartedAt = ?, ' +
        'reportedUpdatedAt = ?, reportedDetail = ? WHERE nodeId = ? AND supersededBy IS NULL',
      ).run(...vals, m.nodeId);
      if (Number(upd.changes) > 0) return { ok: true, created: false };
      // The INSERT conflicted, so the row exists; the UPDATE's only other
      // predicate is `supersededBy IS NULL`, so the row names its heir.
      return { ok: false, why: 'superseded', supersededBy: this.nodeLeaseRow(m.nodeId)!.supersededBy! };
    });
  }

  /** A connection absent on this sweep (§8): `reachable = 0` on the live row(s)
   *  carrying its label, `unreachableSince` the FIRST sweep it was missing on.
   *  With no live row, a never-measured placeholder keyed by the label — shown,
   *  never dropped. The placeholder's `agentOps` is `''` for a fleet row (an
   *  agent connection whose ops are not yet known) and NULL for any other role
   *  (no agent by construction). A second measurement-group writer (D-3207):
   *  `upsertNodeMeasurement` cannot make this write, because there is nothing
   *  measured to upsert on the sweep a connection drops. */
  markUnreachable(label: string, role: NodeRole, at: number): MarkUnreachableResult {
    return tx(this.db, (): MarkUnreachableResult => {
      const upd = this.db.prepare(
        'UPDATE nodes SET reachable = 0, unreachableSince = COALESCE(unreachableSince, ?) ' +
        'WHERE label = ? AND supersededBy IS NULL',
      ).run(at, label);
      if (Number(upd.changes) > 0) {
        const row = this.nodeByLabel(label)!;
        return { ok: true, nodeId: row.nodeId, created: false, since: row.unreachableSince! };
      }
      const ins = this.db.prepare(
        'INSERT INTO nodes (nodeId, role, label, stampRead, installState, provenance, caps, agentOps, ' +
        'floorRead, previousRead, os, ' +
        "reachable, unreachableSince) VALUES (?, ?, ?, 'unreadable', 'unknown', 'unknown', '', ?, " +
        "'unmeasured', 'unmeasured', 'unknown', 0, ?) " +
        'ON CONFLICT(nodeId) DO NOTHING',
      ).run(label, role, label, role === 'fleet' ? '' : null, at);
      if (Number(ins.changes) > 0) return { ok: true, nodeId: label, created: true, since: at };
      return { ok: false, why: 'label-key-taken', supersededBy: this.nodeLeaseRow(label)!.supersededBy };
    });
  }

  /** The identity group (§8). A measured node-id on a connection whose label
   *  keys a row re-keys that row IN PLACE — history, lease, request and its
   *  refusal rows carried — unless a row with that id already exists, when the
   *  label row is superseded by it instead. The id measured NOW is the node's
   *  identity (D-3208): if the `nodeId` row itself is currently superseded —
   *  a retired identity has come back, e.g. a `~/.ccrc` restored from a
   *  snapshot — it is REVIVED here, before every OTHER live row carrying the
   *  label is superseded toward it; without the revive the two rows would
   *  point at each other and both read as superseded forever. Then every
   *  OTHER live row carrying the label under a different id is superseded
   *  too: the same connection answering a new id is a re-installed box, and
   *  its old identity is retired (D-3193). One transaction; idempotent. */
  rekeyNode(label: string, nodeId: string): RekeyNodeResult {
    if (!NODE_ID_RE.test(nodeId)) return { ok: false, why: 'bad-node-id' };
    return tx(this.db, (): RekeyNodeResult => {
      let how: 'rekeyed' | 'superseded' | 'no-label-row' = 'no-label-row';
      const sup = this.db.prepare(
        'UPDATE nodes SET supersededBy = ? WHERE nodeId = ? AND supersededBy IS NULL ' +
        'AND EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?)',
      ).run(nodeId, label, nodeId);
      if (Number(sup.changes) > 0) {
        how = 'superseded';
      } else {
        const moved = this.db.prepare('UPDATE nodes SET nodeId = ? WHERE nodeId = ? AND supersededBy IS NULL')
          .run(nodeId, label);
        if (Number(moved.changes) > 0) {
          this.db.prepare('UPDATE node_release_refusals SET nodeId = ? WHERE nodeId = ?').run(nodeId, label);
          how = 'rekeyed';
        }
      }
      const rev = this.db.prepare(
        'UPDATE nodes SET supersededBy = NULL WHERE nodeId = ? AND supersededBy IS NOT NULL',
      ).run(nodeId);
      const revived = Number(rev.changes) > 0;
      const retired = this.db.prepare(
        'UPDATE nodes SET supersededBy = ? WHERE label = ? AND supersededBy IS NULL AND nodeId <> ? AND nodeId <> ?',
      ).run(nodeId, label, nodeId, label);
      return { ok: true, how, retired: Number(retired.changes), revived };
    });
  }

  /** A refusal, a drop, a deadline, or a `failed`/`reverted`/stamp-mismatch
   *  report (§8, §10): a BUSY lease back to a settled state. The request
   *  columns are untouched — a refusal does not consume the request (decision
   *  7). `reportStartedAt` is the report's own start when the release is
   *  report-driven — the LATEST ms its whole-second stamp covers,
   *  `startedAt*1000 + 999`, which the sweep computes
   *  (D-3199) — and `null` otherwise; a report whose
   *  run began before the lease belongs to a previous run and never moves it. */
  releaseLease(nodeId: string, to: SettledUpdateState, detail: string, reportStartedAt: number | null): ReleaseLeaseResult {
    const res = this.db.prepare(
      'UPDATE nodes SET updateState = ?, updateDetail = ? WHERE nodeId = ? AND supersededBy IS NULL ' +
      `AND updateState NOT IN ${SETTLED_UPDATE_SQL} ` +
      'AND (? IS NULL OR updateStartedAt IS NULL OR ? >= updateStartedAt)',
    ).run(to, detail, nodeId, reportStartedAt, reportStartedAt);
    if (Number(res.changes) > 0) return { ok: true, state: to };
    const row = this.nodeLeaseRow(nodeId);
    if (row === null) return { ok: false, why: 'unknown-node' };
    if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
    if ((SETTLED_UPDATE_STATES as readonly string[]).includes(row.updateState)) {
      return { ok: false, why: 'not-busy', state: row.updateState };
    }
    // Live and busy, and still refused: the precedence clause is the only
    // predicate left, and it fails only when `updateStartedAt` is set.
    return { ok: false, why: 'stale-report', updateStartedAt: row.updateStartedAt! };
  }

  /** Convergence (§10): the row back to `idle` and its request cleared — the
   *  only path besides `ack` that clears one. Refused on a HALTED row
   *  (`failed`/`reverted` wait for the operator's `ack`); takes the same
   *  precedence as `releaseLease`. */
  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult {
    return tx(this.db, (): SettleNodeResult => {
      const had = this.requestedTagOf(nodeId) !== null;
      const res = this.db.prepare(
        "UPDATE nodes SET updateState = 'idle', updateDetail = ?, requestedTag = NULL, requestedKind = NULL, " +
        'requestedAt = NULL WHERE nodeId = ? AND supersededBy IS NULL ' +
        `AND updateState NOT IN ${HALTED_UPDATE_SQL} ` +
        'AND (? IS NULL OR updateStartedAt IS NULL OR ? >= updateStartedAt)',
      ).run(detail, nodeId, reportStartedAt, reportStartedAt);
      if (Number(res.changes) > 0) return { ok: true, clearedRequest: had };
      const row = this.nodeLeaseRow(nodeId);
      if (row === null) return { ok: false, why: 'unknown-node' };
      if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
      const halted = haltedOf(row.updateState);
      if (halted !== null) return { ok: false, why: 'halted', state: halted };
      return { ok: false, why: 'stale-report', updateStartedAt: row.updateStartedAt! };
    });
  }

  /** The resolved group (§9): the resolver's three columns and nothing else.
   *  `changed` is decided in the `WHERE` (NULL-safe `IS`), so a resolution that
   *  says what the row already says writes nothing. */
  resolveNode(nodeId: string, r: NodeResolvedColumns): ResolveNodeResult {
    const res = this.db.prepare(
      'UPDATE nodes SET channel = ?, desiredTag = ?, resolveDetail = ? WHERE nodeId = ? AND supersededBy IS NULL ' +
      'AND NOT (channel IS ? AND desiredTag IS ? AND resolveDetail IS ?)',
    ).run(r.channel, r.desiredTag, r.resolveDetail, nodeId, r.channel, r.desiredTag, r.resolveDetail);
    if (Number(res.changes) > 0) return { ok: true, changed: true };
    const row = this.nodeLeaseRow(nodeId);
    if (row === null) return { ok: false, why: 'unknown-node' };
    if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
    return { ok: true, changed: false };
  }

  /** `POST /api/updates/ack` (§12; D-3183): in ONE transaction, a
   *  SETTLED row back to `idle`, its request cleared, and this node's refusals
   *  deleted. A busy row is refused and nothing is written — an ack never
   *  kills a live lease; `unknown` and a token this build cannot name are
   *  busy. `updateTarget` survives, so "last tried v0.0.10" stays readable. */
  ackNode(nodeId: string): AckNodeResult {
    return tx(this.db, (): AckNodeResult => {
      const had = this.requestedTagOf(nodeId) !== null;
      const res = this.db.prepare(
        "UPDATE nodes SET updateState = 'idle', updateDetail = ?, requestedTag = NULL, requestedKind = NULL, " +
        `requestedAt = NULL WHERE nodeId = ? AND supersededBy IS NULL AND updateState IN ${SETTLED_UPDATE_SQL}`,
      ).run(ACK_DETAIL, nodeId);
      if (Number(res.changes) > 0) {
        const cleared = this.db.prepare('DELETE FROM node_release_refusals WHERE nodeId = ?').run(nodeId);
        return { ok: true, clearedRequest: had, clearedRefusals: Number(cleared.changes) };
      }
      const row = this.nodeLeaseRow(nodeId);
      if (row === null) return { ok: false, why: 'unknown-node' };
      if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
      return { ok: false, why: 'busy', state: busyOf(row.updateState) ?? 'unknown' };
    });
  }

  /** Every LIVE node — the inventory every reader starts from; a superseded row
   *  is invisible here (§8). */
  nodes(): NodeRow[] {
    return (this.db.prepare(`SELECT ${NODE_COLUMNS} FROM nodes WHERE supersededBy IS NULL ORDER BY label, nodeId`)
      .all() as unknown as RawNodeRow[]).map(nodeRowOf);
  }

  /** Any row by id, superseded included — so a caller holding an old id can
   *  learn its heir. `null` = no such row. */
  node(nodeId: string): NodeRow | null {
    const r = this.db.prepare(`SELECT ${NODE_COLUMNS} FROM nodes WHERE nodeId = ?`)
      .get(nodeId) as unknown as RawNodeRow | undefined;
    return r === undefined ? null : nodeRowOf(r);
  }

  /** The live row carrying this connection label, the latest measurement
   *  first (a never-measured placeholder last). `null` = none. */
  nodeByLabel(label: string): NodeRow | null {
    const r = this.db.prepare(
      `SELECT ${NODE_COLUMNS} FROM nodes WHERE label = ? AND supersededBy IS NULL ` +
      'ORDER BY measuredAt IS NULL, measuredAt DESC, nodeId LIMIT 1',
    ).get(label) as unknown as RawNodeRow | undefined;
    return r === undefined ? null : nodeRowOf(r);
  }

  /** The lease-state read a zero-change node write takes its `why` from —
   *  AFTER the write, never before it. `null` = no row with this id. */
  private nodeLeaseRow(nodeId: string): { updateState: UpdateState; updateStartedAt: number | null; supersededBy: string | null } | null {
    const r = this.db.prepare('SELECT updateState, updateStartedAt, supersededBy FROM nodes WHERE nodeId = ?')
      .get(nodeId) as { updateState: string; updateStartedAt: number | null; supersededBy: string | null } | undefined;
    if (r === undefined) return null;
    return { updateState: isUpdateState(r.updateState) ? r.updateState : 'unknown',
             updateStartedAt: r.updateStartedAt, supersededBy: r.supersededBy };
  }

  /** Whether a request was outstanding, for `clearedRequest` — a report,
   *  never a guard; the writes' own `WHERE`s are the guards. */
  private requestedTagOf(nodeId: string): string | null {
    const r = this.db.prepare('SELECT requestedTag FROM nodes WHERE nodeId = ?')
      .get(nodeId) as { requestedTag: string | null } | undefined;
    return r === undefined ? null : r.requestedTag;
  }

  // ── update intent ─────────────────────────────────────────────────────
  //
  // Desired state (design 2026-09-20 §6, §9). `setIntent` copies
  // `setAccountPools`'s journal sequence above: every refusal is decided
  // BEFORE the transaction and before either journal call; inside one `tx`
  // the epoch is MAX(db, journal) + 1, the journal line is appended FIRST,
  // the intent row second and the epoch row LAST — so a crash between append
  // and commit SKIPS an epoch and never reissues one. `update_intent` and
  // `update_epoch` have no other writer (Task 7's writer-group scan).

  /** Writes one scope's intent. The merge base is the scope's own row, else —
   *  a node scope written for the first time — the `'*'` row AS IT STANDS NOW:
   *  spec §9 makes `'*'` the fallback for a node with no row, and copying it at
   *  this moment freezes what the operator saw when they made the node its own
   *  scope. A later `'*'` write does not reach a node that has a row. */
  setIntent(scope: string, patch: UpdateIntentPatch, log: UpdateIntentLog, now: number): SetIntentResult {
    // Refused HERE — before `tx()` opens and before `log.maxEpoch()`/
    // `log.append()` run — so a refused write leaves no journal line and opens
    // no transaction it would only roll back. These reads and the transaction
    // below run in one synchronous call on `DatabaseSync`: nothing interleaves.
    if (patch.channel === undefined && patch.pinnedTag === undefined
        && patch.auto === undefined && patch.notify === undefined) {
      return { ok: false, why: 'empty-patch' };
    }
    const bad = badIntentField(patch);
    if (bad !== null) return { ok: false, why: 'bad-field', field: bad };
    // A node scope is a MEASURED node-id (`NODE_ID_RE`, Task 5's one
    // declaration, above in this file) on a live row. A live label-keyed row is
    // refused: `rekeyNode` never carries an `update_intent` row, so intent under
    // a label would be orphaned when the node-id is first measured
    // (D-3194).
    if (scope !== FLEET_SCOPE && (!NODE_ID_RE.test(scope) || this.db.prepare(
      'SELECT 1 AS one FROM nodes WHERE nodeId = ? AND supersededBy IS NULL',
    ).get(scope) === undefined)) {
      return { ok: false, why: 'unknown-scope', scope };
    }
    const own = this.intentFor(scope);
    const base = own ?? this.intentFor(FLEET_SCOPE);
    const channel = patch.channel ?? base?.channel ?? null;
    if (channel === null) {
      return { ok: false, why: 'no-channel', scope, base: own !== null ? scope : FLEET_SCOPE };
    }
    const row: UpdateIntentRow = {
      scope, channel,
      pinnedTag: patch.pinnedTag !== undefined ? patch.pinnedTag : (base?.pinnedTag ?? null),
      auto: patch.auto ?? base?.auto ?? INTENT_AUTO_FALLBACK,
      notify: patch.notify ?? base?.notify ?? INTENT_NOTIFY_FALLBACK,
      setAt: now,
      setBy: INTENT_SET_BY,
    };
    try {
      return tx(this.db, () => {
        const dbMax = (this.db.prepare('SELECT epoch AS e FROM update_epoch WHERE id = 1')
          .get() as { e: number }).e;
        let fileMax: number | null;
        try { fileMax = log.maxEpoch(); } catch (err) { throw new IntentJournalFault('journal-unreadable', err); }
        const epoch = (fileMax === null ? dbMax : Math.max(dbMax, fileMax)) + 1;
        try {
          log.append({ epoch, scope, channel, pinnedTag: row.pinnedTag, auto: row.auto,
                       notify: row.notify, setBy: row.setBy, at: now });
        } catch (err) { throw new IntentJournalFault('journal-unwritable', err); }
        this.db.prepare(
          'INSERT INTO update_intent (scope, channel, pinnedTag, auto, notify, setAt, setBy) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (scope) DO UPDATE SET channel = excluded.channel, ' +
          'pinnedTag = excluded.pinnedTag, auto = excluded.auto, notify = excluded.notify, ' +
          'setAt = excluded.setAt, setBy = excluded.setBy',
        ).run(scope, channel, row.pinnedTag, row.auto, row.notify, now, row.setBy);
        this.db.prepare('UPDATE update_epoch SET epoch = ?, issuedAt = ? WHERE id = 1').run(epoch, now);
        return { ok: true as const, row, epoch };
      });
    } catch (err) {
      if (!(err instanceof IntentJournalFault)) throw err;
      return err.why === 'journal-unreadable'
        ? { ok: false, why: 'journal-unreadable', detail: err.message }
        : { ok: false, why: 'journal-unwritable', detail: err.message };
    }
  }

  /** Every intent row, `'*'` first (`ORDER BY scope`: `'*'` is 0x2A, below
   *  every character a nodeId starts with). */
  intents(): UpdateIntentRow[] {
    return (this.db.prepare(`SELECT ${INTENT_COLUMNS_SQL} FROM update_intent ORDER BY scope`)
      .all() as unknown as IntentRowDb[]).map(intentOfDb);
  }

  /** One scope's row. `null` = no row for that scope — for a node, "the fleet
   *  default applies" (spec §9) — which is a different answer from a row whose
   *  `channel` reads null. */
  intentFor(scope: string): UpdateIntentRow | null {
    const r = this.db.prepare(`SELECT ${INTENT_COLUMNS_SQL} FROM update_intent WHERE scope = ?`)
      .get(scope) as unknown as IntentRowDb | undefined;
    return r === undefined ? null : intentOfDb(r);
  }

  /** The projection's epoch — the migration seeds the one row, so no reader
   *  handles absence. */
  updateEpoch(): { epoch: number; issuedAt: number } {
    return this.db.prepare('SELECT epoch, issuedAt FROM update_epoch WHERE id = 1')
      .get() as { epoch: number; issuedAt: number };
  }
}
