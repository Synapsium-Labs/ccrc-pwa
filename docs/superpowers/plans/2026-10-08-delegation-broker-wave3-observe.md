# Delegation broker wave 3 — Observe (report-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture bounded delegation evidence, durably reconstruct immutable activity identity, correlate worktrees without guessing, and report observation health without creating a run, carrier, lease clock, adoption, promotion, cleanup candidate, audit token, or filesystem action.

**Architecture:** Fleet hooks append evidence to owner-scoped hourly spools. The server validates complete lines, appends accepted events to a hash-chained journal, atomically replaces a recovery checkpoint, and only then repairs the disposable synchronous `coord.db` projection. Pure correlation and reconciliation modules decide report effects from measured inputs; the existing watcher performs IO at its bounded cadence and exposes only an optional health projection.

**Tech Stack:** TypeScript ESM, Node.js `>=22.16.0`, synchronous `node:sqlite` `DatabaseSync`, Bash hooks and generated ccd, Fastify, Vitest, JSONL sidecars with SHA-256, existing agent WebSocket file operations.

**Spec:** `docs/superpowers/specs/2026-10-04-delegation-broker-design.md` (approved 2026-10-05, revisions R1–R9). Spec stage 2 “Observe” is programme wave 3 because programme wave 2 is the separately approved measurement close-out.

## Global Constraints

- This is wave 3 of 7 and spec stage 2 of 6. Wave 4 owns fleet/PWA delegation rows; wave 5 owns carriers, adoption, retain/resolve, promotion, and `ws-add --base`; wave 6 owns cleanup shadow and audit tokens; wave 7 owns cleanup execution.
- Hooks are evidence, never authority. They exit 0, make no network call, take no lock, wait for no process, and add no fork to the probe path.
- Generic `Agent`, `Task`, `Workflow`, and raw Bash worktree use remains permitted. This wave does not force isolation or turn every delegation into a run.
- The parent identity is `(ccd id, registry incarnation)`, with incarnation read from `$REG/<id>.generation`. Missing, malformed, changing, or unreadable incarnation is `unmeasured`.
- Carry all eight accepted real-lane amendments literally: `agent-input-keys-are-the-callers`, `post-turn-subagentstop-is-unpaired`, `real-payloads-carry-scratchpad-dir`, `toolsearch-may-precede-a-workflow-call`, `parent-stop-does-not-bound-workflow-start`, `workflow-phase-is-not-always-written`, `teardown-hook-event-names-another-session`, and `tool-agent-id-alone-is-unjoined-evidence`. Their owning tests are Tasks 1, 2, 5, 9, and 11; no parser may rely on the disproved shape.
- `shared/api.ts` is the sole source of each new closed vocabulary. Derive lists from types and extend `single-definition.test.ts`; do not add a second spelling elsewhere.
- L0 files import nothing. Pure L1 policy imports no filesystem, Fastify, `node:sqlite`, or `CoordStore`. Adapters preserve every distinction they receive.
- Keep `CoordStore` synchronous. Do not introduce an asynchronous repository or wrap `DatabaseSync` in promises.
- Append exactly one migration with exactly the six spec tables. At plan time the measured slot is `user_version 18 -> 19`; remeasure against `origin/main` before implementation, before the PR, and before merge, and move the untouched migration to the next free slot if another migration lands first.
- Wire changes are additive-only. Keep `FLEET_PROTO = 1` and `FLEET_PROTO_MIN = 1`. An older peer omitting `absent` is unreadable, never measured absence.
- Reuse the existing `readdir` and `readFrom` requests. Add only optional `maxBytes` plus response `dataB64` to `readFrom`; do not add another request-union member, an IO capability word, or a protocol bump. An old peer without `dataB64` is unmeasured for spool ingestion.
- The only wave-3 capability is `delegation-events-v1`: spool grammar plus ccd-created spool directories. Hook installation is measured separately by doctor and tests.
- ccrc never registers `WorktreeCreate` or `WorktreeRemove`. `ToolSearch` is not a delegation event. A parent `Stop` neither opens nor closes a workflow activity. An unpaired `SubagentStop` never opens an activity.
- The spool line is strict UTF-8 JSON plus LF and is **less than 4096 bytes**, not less than or equal. Optional fields are dropped in a deterministic order with `listing` first and `truncated:true`; required identity fields are never dropped.
- `listing` is a bounded `readonly string[]` of admin-record names. It is never a path-bearing object. Do not persist `scratchpad_dir`.
- The server alone parses, correlates, reconciles, appends the journal, advances cursors, replaces checkpoints, repairs projections, and recovers. The hook and agent make no parentage decision.
- A carrier without its journal event is unowned and never cleanup-eligible. Wave 3 may journal a linked lease identity so later projection has durable data, but writes no carrier, starts no cleanup clock, mints no token, and admits no action from that lease.
- Report effects are closed and non-executable. A `lease-created` journal entry is authority only for immutable lease identity and lineage; without a corroborating carrier it is `unmeasured` for every later action. No effect may dispatch, adopt, retain, promote, write a carrier, nominate cleanup, audit a tree, delete, or weaken admission.
- Preserve the existing once-per-minute census and watcher sibling scheduling. Do not add a faster duplicate read; slow remote IO must not block console, dialog, statusline, mail, or other sibling sweeps.
- Tests use fixture HOMEs, fixture registries, contained git/GitHub environments, and private tmux sockets only. Never run ccd against live `$HOME`, touch live tmux/session files, or read credential contents.
- Changes to generated `ccd/ccd` require the repository’s generated-mark workflow, Bash syntax, citation census, ownership guards, and focused ccd tests before commit.
- Do not edit CI selection files unless a failing selector test proves an actual omission.
- Do not merge `origin/main` into an execution workspace without a measured conflict. Never use `update-branch`, rebase, squash, or admin merge.
- Every production behavior is written red-first, observed failing for the intended reason, made minimally green, and mutation-checked before its task review.

## Review Focus

1. **Recovery around a checkpoint boundary:** retained evidence before `appliedJournalSequence` can still open an activity absent from the checkpoint; `delegation-recovery.test.ts` must prove it is considered and that IDs already mapped are restored verbatim.
2. **Unavailable versus measured empty:** old peers, an unreadable registry/admin record, missing capability, a zero denominator, or an incomplete seven-day window must remain `unmeasured`; `remote-io.test.ts`, `divergence-sweep.test.ts`, and `delegation-health.test.ts` own the distinction.
3. **Identity evidence that arrives out of order:** bare `agent_id`, launch response, `SubagentStart`, positive meta, and unpaired stop can arrive in any measured order; `delegation-correlation.test.ts` must prove only a qualifying join opens the activity, the earliest retained naming record's accepted `journalId` fixes its ID once that join is durably applied, and a bare occurrence pruned before any qualifying join for that ID is durably applied is permanently gone.
4. **Durable sidecars during update, backup, restore, and rollback:** no snapshot may commit a mismatched checkpoint/journal pair, and ordinary tree rollback must never restore authoritative sidecars; `coordination-snapshot.test.ts`, `ccrc-update.test.ts`, and `deploy-verify.test.ts` own those boundaries.
5. **Wave-3 authority leakage:** every state and effect remains observation-only even when future-facing columns exist; `delegation-policy.test.ts` plus a source/prose scope census must fail on carrier, lease-clock, adoption, promotion, audit-token, cleanup, dispatch, or PWA-frame behavior.

---

## Fixed Vocabulary and Interfaces

The following definitions are the contract between tasks. Implementers may split helper-only types within the named focused modules, but must not rename properties or collapse union members.

### Shared event and state vocabulary

Add to `shared/api.ts`:

```ts
export const DELEGATION_EVENT_KINDS = [
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'UserPromptSubmit',
  'SessionEnd',
] as const;
export type DelegationEventKind = (typeof DELEGATION_EVENT_KINDS)[number];

export const DELEGATION_ACTIVITY_SOURCE_KINDS = [
  'agent',
  'workflow',
  'bash-worktree',
] as const;
export type DelegationActivitySourceKind =
  (typeof DELEGATION_ACTIVITY_SOURCE_KINDS)[number];

export const DELEGATION_LEASE_SOURCE_KINDS = [
  'agent',
  'workflow',
  'raw',
  'attached',
] as const;
export type DelegationLeaseSourceKind =
  (typeof DELEGATION_LEASE_SOURCE_KINDS)[number];

export const DELEGATION_EXECUTION_STATES = ['active', 'ended', 'unknown'] as const;
export type DelegationExecutionState = (typeof DELEGATION_EXECUTION_STATES)[number];

export const DELEGATION_PARENTAGE_STATES = [
  'linked', 'unresolved', 'conflicting', 'unmeasured',
] as const;
export type DelegationParentageState = (typeof DELEGATION_PARENTAGE_STATES)[number];

export const DELEGATION_WORKSPACE_STATES = [
  'none', 'provisioning', 'present', 'absent', 'unmeasured',
] as const;
export type DelegationWorkspaceState = (typeof DELEGATION_WORKSPACE_STATES)[number];

export const DELEGATION_DISPOSITIONS = [
  'ephemeral', 'adopted', 'retained', 'promoted',
] as const;
export type DelegationDisposition = (typeof DELEGATION_DISPOSITIONS)[number];

export const DELEGATION_CLEANUP_STATES = [
  'not-due', 'pending', 'running', 'refused', 'reclaimed', 'unmeasured',
] as const;
export type DelegationCleanupState = (typeof DELEGATION_CLEANUP_STATES)[number];

export const DELEGATION_CLEANUP_POPULATIONS = [
  'ephemeral-lease',
] as const;
export type DelegationCleanupPopulation =
  (typeof DELEGATION_CLEANUP_POPULATIONS)[number];

export const DELEGATION_INTENT_SOURCES = [
  'explicit', 'run-owner', 'delegation-inferred', 'retained-lineage',
] as const;
export type DelegationIntentSource = (typeof DELEGATION_INTENT_SOURCES)[number];

export const DELEGATION_ATTEMPT_VERDICTS = [
  'linked', 'unresolved', 'conflicting', 'unmeasured',
] as const;
export type DelegationAttemptVerdict = (typeof DELEGATION_ATTEMPT_VERDICTS)[number];

export interface DelegationSpoolCommonV1 {
  v: 1;
  eventKind: DelegationEventKind;
  observedAt: string;
  sessionId: string;
  parentIncarnation: string;
  claudeSessionId: string;
  claudeVersion?: string;
  cwd?: string;
  transcriptPath?: string;
  agentId?: string;
  agentType?: string | null;
  truncated?: true;
}

export type DelegationPreToolUseEvidenceV1 =
  | (DelegationSpoolCommonV1 & {
      eventKind: 'PreToolUse';
      toolName: 'Agent' | 'Task' | 'Workflow';
      toolUseId: string;
      isolation: string | null;
    })
  | (DelegationSpoolCommonV1 & {
      eventKind: 'PreToolUse';
      toolName: 'Bash';
      toolUseId: string;
      listing?: readonly string[];
    });

export interface DelegationAgentLaunchV1 {
  status: 'async-launched' | 'completed';
  agentId: string;
  isAsync: boolean;
}

export interface DelegationWorkflowLaunchV1 {
  status: 'async-launched' | 'completed';
  taskId: string;
  taskType: string;
  workflowName: string;
  runId: string;
  transcriptDir: string;
  scriptPath: string;
}

export type DelegationPostToolUseEvidenceV1 =
  | (DelegationSpoolCommonV1 & {
      eventKind: 'PostToolUse';
      toolName: 'Agent' | 'Task';
      toolUseId: string;
      outcome: 'completed' | 'failed' | 'async-launched' | 'unknown';
      launch: DelegationAgentLaunchV1 | null;
    })
  | (DelegationSpoolCommonV1 & {
      eventKind: 'PostToolUse';
      toolName: 'Workflow';
      toolUseId: string;
      outcome: 'completed' | 'failed' | 'async-launched' | 'unknown';
      launch: DelegationWorkflowLaunchV1 | null;
    })
  | (DelegationSpoolCommonV1 & {
      eventKind: 'PostToolUse';
      toolName: 'Bash';
      toolUseId: string;
      outcome: 'completed' | 'failed' | 'unknown';
      listing?: readonly string[];
    });

export type DelegationSpoolLineV1 =
  | (DelegationSpoolCommonV1 & {
      eventKind: 'SessionStart';
      source: string;
    })
  | DelegationPreToolUseEvidenceV1
  | DelegationPostToolUseEvidenceV1
  | (DelegationSpoolCommonV1 & {
      eventKind: 'SubagentStart';
      agentId: string;
      agentType: string | null;
    })
  | (DelegationSpoolCommonV1 & {
      eventKind: 'SubagentStop';
      agentId: string;
      agentType: string | null;
      agentTranscriptPath: string | null;
    })
  | (DelegationSpoolCommonV1 & {
      eventKind: 'UserPromptSubmit';
      notification: {
        taskId: string;
        toolUseId: string;
        status: 'completed' | 'failed' | 'cancelled' | 'unknown';
      };
    })
  | (DelegationSpoolCommonV1 & {
      eventKind: 'SessionEnd';
      reason: string;
    });

export type DelegationEventEnvelopeV1 = DelegationSpoolLineV1 & {
  eventId: string;
  bucket: string;
  startOffset: number;
  endOffset: number;
};

export interface DelegationActivityNaturalKey {
  parentId: string;
  parentIncarnation: string;
  sourceKind: DelegationActivitySourceKind;
  upstreamId: string;
}

export interface DelegationObservationHealth {
  mode: 'report-only';
  windowStartedAt: string | null;
  windowEndedAt: string | null;
  measuredSessionHours: number;
  unmeasuredSessionHours: number;
  unmeasuredRate: number | null;
  stageGate: 'eligible' | 'ineligible' | 'unmeasured';
  circuitBreaker: 'clear' | 'suspended' | 'unmeasured';
  unresolved: number;
  conflicting: number;
  unmeasured: number;
  lastJournalSequence: number | null;
  lastCheckpointRevision: number | null;
  lastIngestedAt: string | null;
}

export interface DelegationHealthInput {
  windowStartedAt: string | null;
  windowEndedAt: string | null;
  windowComplete: boolean;
  measuredSessionHours: number;
  unmeasuredSessionHours: number;
  capabilityState: 'present' | 'absent' | 'unmeasured';
  registryReadable: boolean;
  recoveryPhase: 'reconstructing' | 'ready';
  circuitBreaker: 'clear' | 'suspended' | 'unmeasured';
  unresolved: number;
  conflicting: number;
  unmeasured: number;
  lastJournalSequence: number | null;
  lastCheckpointRevision: number | null;
  lastIngestedAt: string | null;
}
```

`FleetHealth` gains `delegation?: DelegationObservationHealth`. Absence means unknown. Wave 3 adds no fleet frame and no PWA state.

The raw spool line is a closed discriminated union: each variant accepts only its named keys. The hook normalizes launch responses instead of retaining arbitrary `tool_response`, and a task notification retains only `taskId`, `toolUseId`, and terminal `status` from a syntactically valid `<task-notification>` block. It never persists `prompt`, `result`, `diagnostics`, tool input text, `scratchpad_dir`, or Agent `outputFile`; normalized Workflow `transcriptDir` and `scriptPath` are the only retained launch paths. `SessionStart` is captured before the compact early exit; `SessionEnd.reason` is required. String and array bounds are fixed in Task 5's validation table.

`eventId` is deliberately server-derived, not a hook nonce. For a complete raw line excluding LF, compute:

```text
SHA256(
  UTF8("ccrc-delegation-event-v1\0") ||
  LP_UTF8(sessionId) || LP_UTF8(parentIncarnation) || LP_UTF8(bucket) ||
  U64BE(startOffset) || U64BE(endOffset) || SHA256(rawLineBytes)
)
```

`LP_UTF8` is an unsigned 32-bit big-endian byte length followed by the bytes. Offsets are byte offsets in that immutable bucket read. Concurrent appends have disjoint offsets; replay of the same line has the same ID; PID and timestamp reuse cannot collide because neither is the uniqueness mechanism. A bucket that shrinks or changes bytes before an already accepted offset is an unmeasured replacement, never a new identity at the old coordinate. The hook therefore does not hash, lock, allocate a counter, or add another hot-path fork.

Activity upstream IDs are derived exactly once: Agent/Task uses normalized `agentId`; Workflow uses normalized `runId` plus the zero-based worker index from the exact workflow meta; `toolUseId` is the fallback only for a source whose approved evidence has no stronger upstream ID. `bash-worktree` maps to lease provenance `raw`; `attached` is representable in the complete migration but wave 3 has no writer for it.

### Measured directory and byte-range reads

Keep the existing requests and add no operation:

```ts
export interface ReaddirReq {
  t: 'req';
  id: number;
  op: 'readdir';
  path: string;
}

export interface ReadFromReq {
  t: 'req';
  id: number;
  op: 'readFrom';
  path: string;
  offset: number;
  maxBytes?: number;
}
```

Additively widen `readdir` from `{names: string[] | null}` to either `{names: string[]}` or `{names: null, absent?: true}`. `ReadFailure` remains canonically declared once in `shared/agent-protocol.ts`; `server/src/io.ts` imports and re-exports that type. Add the consumer shapes there:

```ts
export type MeasuredDirectoryRead =
  | { ok: true; entries: readonly string[] }
  | { ok: false; reason: ReadFailure };

export type MeasuredByteRangeRead =
  | { ok: true; bytes: Uint8Array; size: number }
  | { ok: false; reason: ReadFailure };

export interface FleetIO {
  readdirMeasured(
    path: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<MeasuredDirectoryRead>;
  readFileFromBytesMeasured(
    path: string,
    offset: number,
    maxBytes: number,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<MeasuredByteRangeRead>;
}
```

Directory mapping is exact: an array is success; `names:null, absent:true` is `absent`; an omitted marker, malformed response, refusal, timeout, or disconnect is `unreadable`. Existing `readdir(...)` derives from `readdirMeasured(...)` and preserves its compatibility collapse to `string[] | null`. Local and agent adapters use the existing `failureFor`: ENOENT alone is `absent`; all other failures are `unreadable`. Existing path-whitelist validation still precedes filesystem access.

For `readFrom`, old callers omit `maxBytes` and retain the existing decoded-string arm. The new spool reader passes `1..262144`; the new agent reads no more than that count and additively answers `{data, dataB64, size}` so old servers retain `data` while new servers consume byte-exact `dataB64`. The remote byte reader requires canonical base64, decodes it, and checks decoded length against `min(maxBytes, size - offset)`. An old peer returning only `data`, malformed base64, a size regression, refusal, timeout, or disconnect is `unreadable` for spool ingestion; bytes are never reconstructed from decoded text. Local IO reads the same bounded byte range directly. Ingestion applies `TextDecoder('utf-8', {fatal:true})` only after complete-line framing, so invalid UTF-8 is an honest unmeasured interval. This is an additive field on an existing operation, not a new ready-op word or protocol bump.

### Durable journal and checkpoint

Create in the focused server modules:

```ts
export type DelegationJournalEntryV1 =
  | { kind: 'evidence-accepted'; event: DelegationEventEnvelopeV1 }
  | {
      kind: 'lease-created';
      leaseId: string;
      generation: 0;
      activityId: string;
      parentId: string;
      parentIncarnation: string;
      project: string;
      adminRecord: string;
      canonicalPath: string;
      creationBase: string | null;
      sourceKind: DelegationLeaseSourceKind;
      correlationJournalIds: readonly string[];
      firstObservedAt: string;
      lineageId: string;
    };

export interface DelegationJournalRecordV1 {
  v: 1;
  sequence: number;
  journalId: string;
  acceptedAt: string;
  previousDigest: string | null;
  entry: DelegationJournalEntryV1;
  digest: string;
}

export interface DelegationSessionRow {
  sessionId: string;
  parentIncarnation: string;
  explicitIntentAt: string | null;
  effective: boolean;
  effectiveBasis: readonly DelegationIntentSource[];
  claudeSessionIds: readonly string[];
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface DelegationAttemptRow {
  attemptId: string;
  parentId: string;
  parentIncarnation: string;
  project: string;
  adminRecord: string;
  canonicalPath: string | null;
  attemptedAt: string;
  rung: 1 | 2 | 3 | 4 | null;
  verdict: DelegationAttemptVerdict;
  evidenceJournalIds: readonly string[];
  detail: string | null;
}

export interface DelegationActivityRow {
  activityId: string;
  parentId: string;
  parentIncarnation: string;
  sourceKind: DelegationActivitySourceKind;
  upstreamId: string;
  identityJournalId: string;
  displayName: string | null;
  executionState: DelegationExecutionState;
  openedAt: string;
  endedAt: string | null;
  lastEventAt: string;
}

export interface DelegationLeaseRow {
  leaseId: string;
  generation: number;
  creatingJournalSequence: number;
  currentJournalSequence: number;
  activityId: string;
  parentId: string;
  parentIncarnation: string;
  project: string;
  adminRecord: string;
  canonicalPath: string;
  creationBase: string | null;
  sourceKind: DelegationLeaseSourceKind;
  parentageState: DelegationParentageState;
  workspaceState: DelegationWorkspaceState;
  disposition: DelegationDisposition;
  cleanupState: DelegationCleanupState;
  cleanupPopulation: DelegationCleanupPopulation;
  firstObservedAt: string;
  lastObservedAt: string;
  terminalEvidenceAt: string | null;
  adoptedAt: string | null;
  retainedAt: string | null;
  promotedAt: string | null;
  cleanupDueAt: string | null;
  cleanupStartedAt: string | null;
  cleanupFinishedAt: string | null;
  cleanupEvidenceJson: string | null;
  carrierGenerationSeen: number | null;
  releasedAt: string | null;
}

export interface DelegationLineageRow {
  lineageId: string;
  parentId: string;
  parentIncarnation: string;
  activityId: string | null;
  leaseId: string | null;
  runId: number | null;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
}

export interface DelegationEventRow {
  eventId: string;
  journalSequence: number;
  journalDigest: string;
  acceptedAt: string;
  sessionId: string;
  parentIncarnation: string;
  claudeSessionId: string;
  eventKind: DelegationEventKind;
  observedAt: string;
  payloadJson: string;
}

export interface DelegationBucketCursor {
  sessionId: string;
  parentIncarnation: string;
  bucket: string;
  cursor: number;
  lastSize: number;
  lastCompleteAt: string | null;
  intervalState: 'measured' | 'unmeasured';
  detail: string | null;
}

export interface DelegationObservationInterval {
  sessionId: string;
  parentIncarnation: string;
  utcHour: string;
  state: 'measured' | 'unmeasured';
  detail: string | null;
  recordedAt: string;
}

export interface DelegationPruningHold {
  journalId: string;
  reason: 'checkpoint-anchor' | 'open-lease' | 'open-lineage' | 'identity-candidate';
  ownerId: string;
}

export interface DelegationCheckpointV1 {
  v: 1;
  revision: number;
  appliedJournalSequence: number;
  appliedJournalId: string | null;
  appliedJournalDigest: string | null;
  activityIdsByNaturalKey: Readonly<Record<string, string>>;
  coordinatorIntentByParent: Readonly<Record<string, string>>;
  sessions: readonly DelegationSessionRow[];
  attempts: readonly DelegationAttemptRow[];
  activities: readonly DelegationActivityRow[];
  leases: readonly DelegationLeaseRow[];
  lineage: readonly DelegationLineageRow[];
  bucketCursors: readonly DelegationBucketCursor[];
  observationIntervals: readonly DelegationObservationInterval[];
  pruningHolds: readonly DelegationPruningHold[];
}

export interface DelegationRecoveryState {
  checkpoint: DelegationCheckpointV1;
  phase: 'reconstructing' | 'ready';
}

export function encodeDelegationNaturalKey(
  key: DelegationActivityNaturalKey,
): string;

export function restoreOrAllocateActivityId(
  key: DelegationActivityNaturalKey,
  identityJournalId: string | null,
  checkpoint: DelegationCheckpointV1,
): { activityId: string; checkpoint: DelegationCheckpointV1 };

export function recoverDelegationState(
  checkpointBytes: Uint8Array | null,
  retainedJournal: readonly DelegationJournalRecordV1[],
): DelegationRecoveryState;
```

`encodeDelegationNaturalKey` is a canonical length-prefixed encoding of the four natural-key strings, not delimiter joining. Activity IDs are lowercase SHA-256 of the same encoding extended by selected `identityJournalId`. `restoreOrAllocateActivityId` reads `activityIdsByNaturalKey` first; a missing mapping requires the `journalId` of an accepted qualifying retained record and does not expose the new ID until the checkpoint replacement in O1 completes. A fixed-vector test substitutes the raw envelope `eventId` and must produce a different, rejected value.

`canonicalDelegationJson(value)` is a focused RFC 8785 JSON Canonicalization Scheme encoder over the plan's closed JSON domain: UTF-8 without BOM; lexicographic UTF-16 property ordering; ECMAScript JSON string escaping with no optional whitespace; lowercase `true`/`false`/`null`; and RFC 8785/ECMAScript finite-number serialization. Integers outside the JavaScript safe range, non-finite numbers, lone surrogates, duplicate input keys, sparse arrays, `undefined`, and non-plain objects are rejected before encoding. The implementation carries fixed vectors for property order, escaping, multibyte text, `-0`, decimal/exponent boundaries, and the two journal preimages below; no generic application JSON writer may substitute.

The journal preimages are nonrecursive and exact:

```text
journalId = SHA256(canonicalDelegationJson({
  v, sequence, acceptedAt, previousDigest, entry
}))

digest = SHA256(canonicalDelegationJson({
  v, sequence, journalId, acceptedAt, previousDigest, entry
}))
```

Journal validation is closed: positive contiguous safe-integer sequences; unique lowercase 64-hex `journalId`; canonical UTC millisecond `acceptedAt`; lowercase 64-hex SHA-256 `digest`; `previousDigest` equals the prior complete record's digest; and both hashes match the exact preimages above. Each record is canonical UTF-8 JSON plus LF. Reject BOM, CRLF, blank lines, duplicate keys, unknown keys, invalid UTF-8, noncanonical encoding, missing final LF, sequence gaps/duplicates/descents, digest mismatch, and anchor mismatch. The serialized writer owns `O_APPEND`, one complete write, then `fsync`; duplicate evidence `eventId` and duplicate unreleased lease identity are not appended. `lease-created` is the only non-evidence entry wave 3 may write. After deduplication, the serialized journal adapter calls `randomUUID()`, constructs the generation-0 entry, appends it, checkpoints it, and projects it. Pure policy has no randomness import and emits only measured identity for a creation request. No transition entry kind ships in this wave. Later waves may add closed entry variants additively, but may not reinterpret either wave-3 variant.

Wave 3 performs no physical journal compaction. It retains the complete journal, which satisfies the spec's proposed “at least 30 days” floor without a crash-unsafe rewrite. It still computes and tests `DelegationPruningHold` planning and keeps pruning disabled during reconstruction, but no production caller rewrites or truncates `delegation-events.log`; a separately approved later plan must specify temp-file rewrite, fsync, rename, parent-directory fsync, append-FD reopen, concurrent-append serialization, and fault injection before physical pruning may ship.

### Ingestion, correlation, census, and report effects

```ts
export interface DelegationBucketInput {
  sessionId: string;
  parentIncarnation: string;
  bucket: string;
  cursor: number;
  lastSize: number;
  size: number;
  bytes: Uint8Array;
  bucketPresent: boolean;
  capabilityPresent: boolean | null;
}

export interface DelegationBucketResult {
  state: DelegationRecoveryState;
  accepted: readonly DelegationJournalRecordV1[];
  cursor: DelegationBucketCursor;
  interval: 'measured' | 'unmeasured';
  detail: string | null;
}

export interface DelegationCensusRecord {
  project: string;
  adminRecord: string;
  canonicalPath: string | null;
  headBranch: string | null;
  headSha: string | null;
  claudeBase: string | null;
  locked: boolean;
  baseAgreesFirstLog: boolean | null;
  state: 'present' | 'absent' | 'unreadable';
  diagnostic: string | null;
}

export interface DelegationListingWindow {
  sessionId: string;
  parentIncarnation: string;
  toolUseId: string;
  repository: string;
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

export function ingestDelegationBucket(
  input: DelegationBucketInput,
  state: DelegationRecoveryState,
): DelegationBucketResult;

export interface DelegationBucketDurability {
  applyBucketResult(result: DelegationBucketResult): DelegationRecoveryState;
}

export function ingestAndApplyDelegationBucket(
  input: DelegationBucketInput,
  state: DelegationRecoveryState,
  durability: DelegationBucketDurability,
): DelegationRecoveryState;

export function correlateDelegation(
  input: DelegationCorrelationInput,
): DelegationCorrelationVerdict;

export interface DelegationLeaseCreationRequest {
  activityId: string;
  parentId: string;
  parentIncarnation: string;
  project: string;
  adminRecord: string;
  canonicalPath: string;
  creationBase: string | null;
  sourceKind: DelegationLeaseSourceKind;
  correlationJournalIds: readonly string[];
  firstObservedAt: string;
}

export type DelegationReportEffect =
  | {
      kind: 'request-linked-lease-identity';
      attempt: DelegationAttemptRow;
      request: DelegationLeaseCreationRequest;
    }
  | { kind: 'record-run-child-owned'; attempt: DelegationAttemptRow }
  | { kind: 'record-measured-absence'; project: string; adminRecord: string; observedAt: string }
  | { kind: 'record-unowned-worktree'; attempt: DelegationAttemptRow }
  | { kind: 'repair-report-projection'; checkpointRevision: number }
  | { kind: 'record-observation-interval'; interval: DelegationObservationInterval };

export interface DelegationReconciliationInput {
  now: string;
  recovery: DelegationRecoveryState;
  census: readonly DelegationCensusRecord[];
  correlations: readonly DelegationCorrelationVerdict[];
  registryReadable: boolean;
  firstDeadParents: readonly { parentId: string; firstMeasuredDeadAt: string }[];
  previousSuccessfulCensus: readonly DelegationCensusRecord[] | null;
}

export function planDelegationReconciliation(
  input: DelegationReconciliationInput,
): readonly DelegationReportEffect[];
```

`run-child-owned` is rung 1's terminal report verdict. Policy may emit only `record-run-child-owned` for it; it never requests a lease, because the existing run/child model already owns that workspace. Only a rung-2/3/4 `linked` verdict with a non-null canonical path may emit `request-linked-lease-identity`. The pure request carries measured identity but no UUID, generation, journal sequence, clocks, transition state, token, or executable action.

The serialized journal adapter deduplicates the unreleased identity tuple, calls `randomUUID()` only after deduplication, derives `lineageId` as lowercase SHA-256 of the domain-separated canonical length-prefixed tuple `(leaseId, parentId, parentIncarnation, activityId)`, and constructs a generation-`0` `lease-created` entry. The entry carries the request's canonical UTC-millisecond `firstObservedAt`; replay sets both lease `firstObservedAt` and `lastObservedAt`, plus lineage `openedAt`, to that value. It appends and fsyncs the entry, checkpoints it, and finally projects exactly those reconstructed rows. Thus neither wall-clock replay time nor journal `acceptedAt` can change lease or lineage identity/history. That entry is the sole authority for immutable lease identity and its opening lineage, as spec §5.12 requires; it is not authority for a carrier, disposition transition, cleanup clock, token, audit result, or executable action. Wave 3 initializes the future-facing fields to `disposition:'ephemeral'`, `cleanupState:'not-due'`, `cleanupPopulation:'ephemeral-lease'`, null clocks/evidence, and `carrierGenerationSeen:null`; its closed policy cannot change them. Without a corroborating carrier, later-wave admission must treat the lease as `unmeasured`. Later waves activate these already-migrated fields through separately approved code, not another schema migration.

### Coordination snapshot manifest

Authoritative live files:

```text
~/.ccrc/delegation-events.log
~/.ccrc/delegation-checkpoint.json
```

The snapshot commit marker is exactly `coordination-snapshot.json`:

```ts
type CoordinationSnapshotMember<F extends string> =
  | { filename: F; present: false }
  | { filename: F; present: true; bytes: number; sha256: string };

interface DelegationJournalPosition {
  sequence: number;
  journalId: string;
  digest: string;
}

interface DelegationJournalCoverage {
  firstSequence: number | null;
  lastSequence: number | null;
  recordCount: number;
  firstPreviousDigest: string | null;
  copiedEof: DelegationJournalPosition | null;
}

interface CoordinationSnapshotManifestV1 {
  format: 'ccrc-coordination-snapshot';
  version: 1;
  capturedAt: string;
  members: {
    delegationJournal: CoordinationSnapshotMember<'delegation-events.log'>;
    delegationCheckpoint: CoordinationSnapshotMember<'delegation-checkpoint.json'>;
    coordDb: CoordinationSnapshotMember<'coord.db'>;
  };
  delegation:
    | { state: 'absent'; checkpointRevision: null; anchor: null; journal: null }
    | {
        state: 'initialized';
        checkpointRevision: number;
        anchor: DelegationJournalPosition | null;
        journal: DelegationJournalCoverage;
      };
}
```

A snapshot manifest describes the authoritative pair plus the SQLite projection. WAL/SHM are restore-set members, not manifest members: the existing SQLite helper creates a consistent `coord.db` with no live WAL dependency.

## O1–O5 Implementation Decisions Approved for Wave 3

These five items originated as review-332 implementation questions. They are not retroactive requirements of the approved spec. The operator approved this plan on 2026-10-09, approving these implementation answers for wave 3 without turning them into prior spec requirements. Any later change to one requires an operator ruling; rejection blocks the owning durability task rather than licensing a weaker fallback.

- **O1 — ID escape:** A meta-opened activity ID cannot be returned, inserted into `coord.db`, logged as an outcome, or included in a report until an atomic checkpoint contains its natural-key mapping and activity row.
- **O2 — pruning:** Disable pruning from reconstruction entry through checkpoint validation, processing all retained evidence applicable to checkpoint-missing activities (including records before `appliedJournalSequence`), retained-suffix replay, natural-key restoration, and restoration of every pruning hold. Failure leaves phase `reconstructing` and pruning disabled.
- **O3 — checkpoint and backup:** The journal and checkpoint live at the authoritative paths above. Every coordination backup/update snapshot and fallback server deployment snapshot contains both sidecars, the existing consistent SQLite snapshot when present, and `coordination-snapshot.json`. Restore fails closed unless journal, checkpoint, manifest, retained pre-anchor evidence, and suffix coverage agree.
- **O4 — immutable mapping:** Persist `(parent id, parent incarnation, source kind, upstream id) -> activity id` in `activityIdsByNaturalKey`; restore that exact ID. Never hash a later event because the original identity event was pruned.
- **O5 — durable application:** (1) append a complete journal record, (2) `fsync` journal, (3) build next state, (4) write checkpoint temp in the same directory, (5) `fsync` temp, (6) atomic rename, (7) `fsync` parent directory, and only then (8) repair/commit `coord.db`. Positive meta has no journal event and becomes durable only after the same checkpoint replacement. SQLite commit alone is not durable application.

## Complete Migration DDL

Append this as one migration, changing only the measured slot number if `origin/main` has advanced. Columns use the repository’s camelCase convention; table and index names use snake_case. Cursors and pruning holds stay checkpoint-only.

```sql
CREATE TABLE delegation_sessions (
  sessionId            TEXT NOT NULL,
  parentIncarnation    TEXT NOT NULL,
  explicitIntentAt     INTEGER,
  effective            INTEGER NOT NULL CHECK (effective IN (0, 1)),
  effectiveBasisJson   TEXT NOT NULL,
  claudeSessionIdsJson TEXT NOT NULL,
  firstObservedAt      INTEGER NOT NULL,
  lastObservedAt       INTEGER NOT NULL,
  PRIMARY KEY (sessionId, parentIncarnation),
  CHECK (lastObservedAt >= firstObservedAt)
);
CREATE INDEX delegation_sessions_by_effective
  ON delegation_sessions(effective, lastObservedAt);

CREATE TABLE delegation_attempts (
  attemptId         TEXT NOT NULL PRIMARY KEY,
  parentId          TEXT NOT NULL,
  parentIncarnation TEXT NOT NULL,
  project           TEXT NOT NULL,
  adminRecord       TEXT NOT NULL,
  canonicalPath     TEXT,
  attemptedAt       INTEGER NOT NULL,
  rung              INTEGER CHECK (rung IS NULL OR rung BETWEEN 1 AND 4),
  verdict           TEXT NOT NULL CHECK (verdict IN ('linked', 'unresolved', 'conflicting', 'unmeasured')),
  evidenceJournalIdsJson TEXT NOT NULL,
  detail            TEXT,
  CHECK (verdict != 'linked' OR canonicalPath IS NOT NULL),
  FOREIGN KEY (parentId, parentIncarnation)
    REFERENCES delegation_sessions(sessionId, parentIncarnation)
);
CREATE INDEX delegation_attempts_by_parent
  ON delegation_attempts(parentId, parentIncarnation, attemptedAt);
CREATE INDEX delegation_attempts_by_path
  ON delegation_attempts(project, adminRecord, attemptedAt);

CREATE TABLE delegation_activities (
  activityId         TEXT NOT NULL PRIMARY KEY,
  parentId           TEXT NOT NULL,
  parentIncarnation  TEXT NOT NULL,
  sourceKind         TEXT NOT NULL CHECK (sourceKind IN ('agent', 'workflow', 'bash-worktree')),
  upstreamId         TEXT NOT NULL,
  identityJournalId  TEXT NOT NULL CHECK (length(identityJournalId) = 64),
  displayName        TEXT,
  executionState     TEXT NOT NULL CHECK (executionState IN ('active', 'ended', 'unknown')),
  openedAt           INTEGER NOT NULL,
  endedAt            INTEGER,
  lastEventAt        INTEGER NOT NULL,
  UNIQUE (parentId, parentIncarnation, sourceKind, upstreamId),
  FOREIGN KEY (parentId, parentIncarnation)
    REFERENCES delegation_sessions(sessionId, parentIncarnation),
  CHECK (endedAt IS NULL OR endedAt >= openedAt),
  CHECK (lastEventAt >= openedAt)
);
CREATE INDEX delegation_activities_by_parent
  ON delegation_activities(parentId, parentIncarnation, executionState);

CREATE TABLE delegation_leases (
  leaseId                 TEXT NOT NULL PRIMARY KEY,
  generation              INTEGER NOT NULL CHECK (generation >= 0),
  creatingJournalSequence INTEGER NOT NULL UNIQUE CHECK (creatingJournalSequence > 0),
  currentJournalSequence  INTEGER NOT NULL CHECK (currentJournalSequence >= creatingJournalSequence),
  activityId              TEXT NOT NULL REFERENCES delegation_activities(activityId),
  parentId                TEXT NOT NULL,
  parentIncarnation       TEXT NOT NULL,
  project                 TEXT NOT NULL,
  adminRecord             TEXT NOT NULL,
  canonicalPath           TEXT NOT NULL,
  creationBase            TEXT,
  sourceKind              TEXT NOT NULL CHECK (sourceKind IN ('agent', 'workflow', 'raw', 'attached')),
  parentageState          TEXT NOT NULL CHECK (parentageState IN ('linked', 'unresolved', 'conflicting', 'unmeasured')),
  workspaceState          TEXT NOT NULL CHECK (workspaceState IN ('none', 'provisioning', 'present', 'absent', 'unmeasured')),
  disposition             TEXT NOT NULL CHECK (disposition IN ('ephemeral', 'adopted', 'retained', 'promoted')),
  cleanupState            TEXT NOT NULL CHECK (cleanupState IN ('not-due', 'pending', 'running', 'refused', 'reclaimed', 'unmeasured')),
  cleanupPopulation       TEXT NOT NULL CHECK (cleanupPopulation = 'ephemeral-lease'),
  firstObservedAt         INTEGER NOT NULL,
  lastObservedAt          INTEGER NOT NULL,
  terminalEvidenceAt      INTEGER,
  adoptedAt               INTEGER,
  retainedAt              INTEGER,
  promotedAt              INTEGER,
  cleanupDueAt            INTEGER,
  cleanupStartedAt        INTEGER,
  cleanupFinishedAt       INTEGER,
  cleanupEvidenceJson     TEXT,
  carrierGenerationSeen   INTEGER CHECK (carrierGenerationSeen IS NULL OR carrierGenerationSeen >= 1),
  releasedAt              INTEGER,
  FOREIGN KEY (parentId, parentIncarnation)
    REFERENCES delegation_sessions(sessionId, parentIncarnation),
  CHECK (lastObservedAt >= firstObservedAt),
  CHECK (terminalEvidenceAt IS NULL OR terminalEvidenceAt >= firstObservedAt),
  CHECK (adoptedAt IS NULL OR adoptedAt >= firstObservedAt),
  CHECK (retainedAt IS NULL OR retainedAt >= firstObservedAt),
  CHECK (promotedAt IS NULL OR promotedAt >= firstObservedAt),
  CHECK (cleanupDueAt IS NULL OR cleanupDueAt >= firstObservedAt),
  CHECK (cleanupStartedAt IS NULL OR cleanupStartedAt >= firstObservedAt),
  CHECK (cleanupFinishedAt IS NULL OR cleanupFinishedAt >= firstObservedAt),
  CHECK (cleanupFinishedAt IS NULL OR cleanupStartedAt IS NOT NULL),
  CHECK (releasedAt IS NULL OR releasedAt >= firstObservedAt)
);
CREATE UNIQUE INDEX delegation_leases_identity_null_base
  ON delegation_leases(project, adminRecord, canonicalPath)
  WHERE creationBase IS NULL AND releasedAt IS NULL;
CREATE UNIQUE INDEX delegation_leases_identity_with_base
  ON delegation_leases(project, adminRecord, creationBase, canonicalPath)
  WHERE creationBase IS NOT NULL AND releasedAt IS NULL;
CREATE UNIQUE INDEX delegation_leases_one_active_path
  ON delegation_leases(canonicalPath)
  WHERE releasedAt IS NULL;
CREATE INDEX delegation_leases_by_parent
  ON delegation_leases(parentId, parentIncarnation, releasedAt);
CREATE INDEX delegation_leases_by_activity
  ON delegation_leases(activityId);
CREATE INDEX delegation_leases_by_cleanup
  ON delegation_leases(cleanupPopulation, cleanupState, cleanupDueAt);

CREATE TABLE delegation_lineage (
  lineageId          TEXT NOT NULL PRIMARY KEY,
  parentId           TEXT NOT NULL,
  parentIncarnation  TEXT NOT NULL,
  activityId         TEXT REFERENCES delegation_activities(activityId),
  leaseId            TEXT REFERENCES delegation_leases(leaseId),
  runId              INTEGER REFERENCES runs(id),
  openedAt           INTEGER NOT NULL,
  closedAt           INTEGER,
  closeReason        TEXT,
  FOREIGN KEY (parentId, parentIncarnation)
    REFERENCES delegation_sessions(sessionId, parentIncarnation),
  CHECK (((activityId IS NOT NULL) + (leaseId IS NOT NULL) + (runId IS NOT NULL)) = 1),
  CHECK ((closedAt IS NULL) = (closeReason IS NULL)),
  CHECK (closedAt IS NULL OR closedAt >= openedAt)
);
CREATE INDEX delegation_lineage_by_parent
  ON delegation_lineage(parentId, parentIncarnation, closedAt);
CREATE INDEX delegation_lineage_by_activity
  ON delegation_lineage(activityId, closedAt);
CREATE INDEX delegation_lineage_by_lease
  ON delegation_lineage(leaseId, closedAt);
CREATE INDEX delegation_lineage_by_run
  ON delegation_lineage(runId, closedAt);

CREATE TABLE delegation_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId            TEXT NOT NULL UNIQUE,
  journalSequence    INTEGER NOT NULL UNIQUE CHECK (journalSequence > 0),
  journalDigest      TEXT NOT NULL CHECK (length(journalDigest) = 64),
  acceptedAt         INTEGER NOT NULL,
  sessionId          TEXT NOT NULL,
  parentIncarnation  TEXT NOT NULL,
  claudeSessionId    TEXT NOT NULL,
  eventKind          TEXT NOT NULL CHECK (eventKind IN ('SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit', 'SessionEnd')),
  observedAt         INTEGER NOT NULL,
  payloadJson        TEXT NOT NULL,
  FOREIGN KEY (sessionId, parentIncarnation)
    REFERENCES delegation_sessions(sessionId, parentIncarnation)
);
CREATE INDEX delegation_events_by_parent
  ON delegation_events(sessionId, parentIncarnation, journalSequence);
CREATE INDEX delegation_events_by_observed
  ON delegation_events(observedAt);
```

This is the spec §5.2 complete future-facing six-table migration; waves 4–7 add code only. Wave 3 writes a `delegation_leases` row only by replaying its durable `lease-created` journal entry. It fixes `generation = 0`, `creatingJournalSequence = currentJournalSequence`, `disposition = 'ephemeral'`, `cleanupState = 'not-due'`, `cleanupPopulation = 'ephemeral-lease'`, and every transition clock/evidence/carrier field to null. No wave-3 method updates those future fields. Generation `0` is pre-carrier: the first later-wave carrier generation is `1`. The two partial identity indexes deliberately separate null and non-null `creationBase`, avoid SQLite's null-distinct UNIQUE behavior, and apply only to unreleased rows so the exact tuple can be reused after release; the active-path index independently prevents two unreleased leases from owning one canonical path. An unresolved, conflicting, or unmeasured attempt may retain `canonicalPath = NULL`; a linked attempt may not.

`projectDelegationCheckpoint` replaces the disposable projection synchronously inside one transaction with foreign keys enabled. Delete in the exact order `delegation_lineage`, `delegation_leases`, `delegation_events`, `delegation_attempts`, `delegation_activities`, `delegation_sessions`; insert in the exact order `delegation_sessions`, then `delegation_activities`/`delegation_attempts`/`delegation_events`, then `delegation_leases`, then `delegation_lineage`. A fault at any statement rolls back the complete replacement. The checkpoint and journal remain authoritative; SQLite never becomes a second identity source.

## Mutation Matrix

Every applicable spec §8.4 guard and every additional O1–O5 boundary has one named red owner. Apply one mutant at a time from a saved copy, run the named test, record `N failed | M passed`, restore exactly, and re-run green. Where a mutation touches generated ccd, restamp after both mutation and restoration.

| ID | Mutant | Red owner |
|---|---|---|
| W3-M01 | Remove exact `-t "$TMUX_PANE"` lookup | `session-hook.test.ts` exact-pane teardown row |
| W3-M02 | Treat any non-empty `agent_id` as subagent placement | `session-hook-turnmark.test.ts` phantom-main-turn row |
| W3-M03 | Let the hook create its spool directory | `delegation-spool.test.ts` missing-directory row |
| W3-M04 | Permit a serialized line of 4096 bytes or more | `delegation-spool.test.ts` strict-line-cap row |
| W3-M05 | Register `WorktreeCreate` or `WorktreeRemove` | `install-session-hooks.test.ts` delegation event-set row |
| W3-M06 | Widen hook prune outside its owner directory | `delegation-spool.test.ts` prune-containment row |
| W3-M07 | Advance the cursor over a torn tail | `delegation-ingest.test.ts` torn-tail completion row |
| W3-M08 | Treat a malformed complete line as measured empty | `delegation-ingest.test.ts` malformed-complete-line row |
| W3-M09 | Treat a vanished unread suffix as healthy | `delegation-ingest.test.ts` vanished-bucket row |
| W3-M10 | Accept envelope `sessionId` different from spool owner | `delegation-ingest.test.ts` owner-mismatch row |
| W3-M11 | Remove `eventId` idempotency | `delegation-ingest.test.ts` duplicate-reread row |
| W3-M12 | Expose a meta-opened ID before checkpoint replacement | `delegation-recovery.test.ts` O1 crash-window row |
| W3-M13 | Permit pruning during reconstruction or after failed reconstruction | `delegation-recovery.test.ts` O2 pruning-barrier rows |
| W3-M14 | Rehash after the selected identity event is pruned | `delegation-recovery.test.ts` O4 immutable-natural-key row |
| W3-M15 | Skip any append/fsync/temp/fsync/rename/dir-fsync ordering edge | `delegation-recovery.test.ts` O5 fault matrix |
| W3-M16 | Ignore retained pre-checkpoint evidence for an activity absent from checkpoint | `delegation-recovery.test.ts` sequence-10/position-20 row |
| W3-M17 | Let positional checkpoint coverage substitute for selected-ID coverage | `delegation-recovery.test.ts` identity-hold row |
| W3-M18 | Let replay change projected ID or generation | `delegation-recovery.test.ts` replay-preserves-projection row |
| W3-M18A | Insert a lease without a `lease-created` journal entry, mint a nonzero initial generation, or derive its UUID from report data | `delegation-recovery.test.ts` journal-alone-creates-lease table |
| W3-M18B | Collapse null `creationBase` through SQLite's null-distinct UNIQUE behavior | `coord-store.test.ts` null-base-identity row |
| W3-M18C | Transition or populate any future-facing lease field in wave 3 | `delegation-policy.test.ts` inert-future-fields table |
| W3-M19 | Omit journal, checkpoint, or manifest from backup | `coordination-snapshot.test.ts` required-members rows |
| W3-M20 | Accept anchor sequence, journal-ID, or digest mismatch | `coordination-snapshot.test.ts` anchor-triple table |
| W3-M21 | Compute digest without `previousDigest` | `coordination-snapshot.test.ts` chain-input row |
| W3-M22 | Accept any torn journal-tail position | `coordination-snapshot.test.ts` torn-position table |
| W3-M23 | Accept duplicate, gapped, or descending journal sequences | `coordination-snapshot.test.ts` sequence table |
| W3-M24 | Drop retained pre-anchor identity evidence | `coordination-snapshot.test.ts` pre-anchor-identity row |
| W3-M25 | Accept a checkpoint that moves during capture | `coordination-snapshot.test.ts` retry-on-move row |
| W3-M26 | Use other than exactly five attempts or 10/25/50/100 ms delays | `coordination-snapshot.test.ts` retry-schedule row |
| W3-M27 | Write manifest before every member is durable | `coordination-snapshot.test.ts` manifest-last fault row |
| W3-M28 | Discard a valid sidecar snapshot because `coord.db` is absent | `ccrc-update.test.ts` sidecars-without-db retention row |
| W3-M29 | Fall back to a healthy DB when a present manifest is invalid | `coordination-snapshot.test.ts` no-v1-fallback row |
| W3-M30 | Treat manifest-less DB containing `delegation_*` tables as legacy | `coordination-snapshot.test.ts` legacy-classifier row |
| W3-M31 | Restore sidecars through ordinary rollback arm 3 | `ccrc-update.test.ts` authoritative-sidecars exclusion row |
| W3-M32 | Run fallback capture after rsync | `deploy-verify.test.ts` pre-rsync capture row |
| W3-M33 | Mutate live files before source validation | `coordination-snapshot.test.ts` invalid-source row |
| W3-M34 | Restore while service is active or unmeasurable | `coordination-snapshot.test.ts` service-state table |
| W3-M35 | Leave a mixed old/new five-member set on replacement failure | `coordination-snapshot.test.ts` replacement-fault matrix |
| W3-M36 | Remove DB/WAL/SHM for an absent DB without explicit manifest acknowledgement | `coordination-snapshot.test.ts` absent-db acknowledgement row |
| W3-M37 | Recover interrupted restore contrary to its commit marker | `coordination-snapshot.test.ts` interrupted-restore table |
| W3-M38 | Add a production journal rewrite/truncate caller or drop a required planning hold | `delegation-recovery.test.ts` no-compaction/hold table |
| W3-M39 | Couple coordination and tree keeps so one evicts the other | `ccrc-update.test.ts` independent-keep-set row |
| W3-M40 | Change `backup-coord.mjs` from SQLite-only behavior | `coordination-snapshot.test.ts` helper-separation row |
| W3-M41 | Let bare `agent_id` open an activity | `delegation-correlation.test.ts` qualifying-join table |
| W3-M42 | Let unpaired `SubagentStop` open an activity | `delegation-correlation.test.ts` unpaired-stop row |
| W3-M43 | Let `agent-*` or `wf_*` fall through rung 2 | `delegation-correlation.test.ts` stop-at-rung-2 row |
| W3-M44 | Drop exact canonical `worktreePath` equality at rung 2 | `delegation-correlation.test.ts` exact-path near-miss row |
| W3-M45 | Link on display name, name pattern, branch prefix, timestamp, census bracket, nesting, ancestry, or parent `cwd` | `delegation-correlation.test.ts` forbidden-heuristics table |
| W3-M46 | Take first evidence or let a lower rung override conflict | `delegation-correlation.test.ts` conflicting-finality table |
| W3-M47 | Ignore overlapping listing windows | `delegation-correlation.test.ts` overlap-unresolved row |
| W3-M48 | Skip the two-pass wait when registry row or `.child` appears | `delegation-correlation.test.ts` run-child-birth row |
| W3-M49 | Use failed lock stat, unreadable first log, or unreadable `gitdir` as positive evidence | `divergence-sweep.test.ts` D-4008 table |
| W3-M50 | Treat unreadable admin record as measured absence | `divergence-sweep.test.ts` unreadable-record row |
| W3-M51 | Reclaim an ended activity, end a paused workflow, or call a restarting supervisor dead | `delegation-policy.test.ts` terminality table |
| W3-M52 | Recover authority from a carrier without a journal event | `delegation-policy.test.ts` carrier-alone row |
| W3-M53 | Add adopt, retain, promote, dispatch, audit-token, cleanup, carrier, or delete effect | `delegation-policy.test.ts` closed-effect census |
| W3-M54 | Let the circuit breaker emit an executable action | `delegation-policy.test.ts` breaker-report-only row |
| W3-M55 | Allow session A to declare intent for session B, or expose a declaration before checkpoint durability | `coordinator-intent-route.test.ts` attribution and checkpoint-fault rows |
| W3-M56 | Clear run-owner, inferred, or retained-lineage identity with explicit intent, or make SQLite the intent authority | `coordinator-intent-route.test.ts` clear-preserves-bases and reproject-after-DB-loss rows |
| W3-M57 | Render old fleet, unavailable registry, missing capability, recovery failure, zero denominator, or incomplete window as zero/healthy | `delegation-health.test.ts` unavailable table |
| W3-M58 | Make 1.00% eligible or 0.99% ineligible | `delegation-health.test.ts` strict-threshold table |
| W3-M59 | Hash envelope `eventId` instead of the accepted naming record’s `journalId` | `delegation-model.test.ts` identity-journal fixed-vector row |
| W3-M60 | Omit parent incarnation from a spool line or accept it after owner-generation reuse | `delegation-spool.test.ts` incarnation binding table |
| W3-M61 | Reconstruct byte evidence from decoded `data`, accept noncanonical base64, or skip decoded-length validation | `remote-io.test.ts` measured-byte-range table |
| W3-M62 | Let pure policy mint a UUID/full lease, call randomness before identity deduplication, or reconstruct lineage/time from replay clock | `delegation-recovery.test.ts` adapter-owned UUID and replay-stable-lineage table |
| W3-M63 | Let `run-child-owned` enter lease creation | `delegation-policy.test.ts` rung-one ownership row |
| W3-M64 | Keep the lease identity unique after release | `coord-store.test.ts` released-identity-reuse table |
| W3-M65 | Drop or conflate creating/current journal sequence | `coord-store.test.ts` lease-sequence round-trip table |
| W3-M66 | Conflate activity source `bash-worktree` with carrier source, or omit future `attached` vocabulary | `delegation-model.test.ts` split-source-domain table |
| W3-M67 | Require a path for unresolved/conflicting/unmeasured attempt or permit null on linked | `coord-store.test.ts` nullable-attempt-path table |
| W3-M68 | Derive health only from SQLite or lose an unmeasured session-hour on restart | `delegation-health.test.ts` checkpoint-interval restart table |
| W3-M69 | Omit any event variant/required lifecycle field or retain arbitrary notification/tool-response content | `delegation-ingest.test.ts` closed-event-union table |
| W3-M70 | Change any component/order/encoding of the server-derived event-ID preimage | `delegation-ingest.test.ts` event-ID fixed-vector table |
| W3-M71 | Recurse journal ID/digest preimages, use noncanonical JSON, or accept an invalid canonical domain value | `delegation-recovery.test.ts` canonical-preimage vectors |
| W3-M72 | Project in FK-unsafe order or leave a partial replacement after injected failure | `coord-store.test.ts` projection-order fault matrix |
| W3-M73 | Omit current-version recapture before parser implementation | `delegation-fixtures.test.ts` current-lane fixture census |
| W3-M74 | Misclassify `delegation-hooks` readiness, skip a rostered home, or omit a remedy | `ccrc-doctor.test.ts` delegation-hooks table |

Later-wave-only §8.4 behavior rows are explicitly deferred: lease carrier flock/generation/containment; promotion; lease disposition transitions; cleanup clock activation and admission rungs; `ws-lease-audit`; `ws-lease-clean`; `ws-add --base`; adoption, retain, resolve, mail, and stage markers; cleanup executor; fleet `delegation` frame and PWA nesting; lease capacity behavior; `ws-reclaim`/`ws-expire` population guards. The complete future-facing columns land inertly now under spec §5.2; wave 3’s scope census proves none of their later behavior landed early.

## File Map and Ownership

**Create**

- `server/src/coord/delegation-model.ts` — pure canonical validation, natural keys, closed projection types, ID selection, health arithmetic.
- `server/src/coord/delegation-checkpoint.ts` — canonical checkpoint codec, atomic replacement, recovery phases, pruning holds.
- `server/src/coord/delegation-journal.ts` — canonical journal codec, hash chain, serialized append/fsync, validation and retention planning.
- `server/src/coord/delegation-ingest.ts` — pure complete-line framing, envelope validation, cursor/gap result.
- `server/src/coord/delegation-correlation.ts` — pure qualifying joins and four-rung ladder.
- `server/src/coord/delegation-policy.ts` — pure report-only reconciliation and circuit-breaker decisions.
- `deploy/coordination-snapshot.mjs` — self-contained stable capture, classify/validate, transactional restore, interrupted recovery.
- `server/test/delegation-model.test.ts`, `delegation-recovery.test.ts`, `delegation-ingest.test.ts`, `delegation-correlation.test.ts`, `delegation-policy.test.ts`, `delegation-watch.test.ts`, `delegation-health.test.ts`, `delegation-spool.test.ts`, `coordination-snapshot.test.ts`, `coordinator-intent-route.test.ts`, `delegation-wave3.integration.test.ts` — focused owners named below.

**Modify**

- `ccd/session-hook.sh` — exact-pane correction first; later turn classification and spool append/prune.
- `server/test/session-hook.test.ts` — exact-pane and spool hot-path integration.
- `server/test/session-hook-turnmark.test.ts` — bare-agent phantom-main-turn correction.
- `server/test/delegation-rig/recapture.sh`, `server/test/delegation-rig/rig.sh`, `server/test/delegation-rig.test.ts` — D-3999 tooling obligations; no speculative nested test file.
- `shared/api.ts`, `server/test/single-definition.test.ts` — closed vocabulary and optional health type.
- `shared/agent-protocol.ts`, `agent/src/fileops.ts`, `agent/src/server.ts`, `server/src/remote/io.ts`, `server/src/io.ts`; existing `agent/test/fileops.test.ts` and `server/test/remote-io.test.ts` — additive measured `readdir` response, bounded byte-range `readFrom` response, and compatibility derivation.
- `ccd/ccd`, `server/test/ccd-ws-add*.test.ts` only where the existing spawn-directory owner is pinned — create owner spool directory and advertise `delegation-events-v1`; restamp generated file.
- `ccd/install-session-hooks.sh`, `server/test/install-session-hooks.test.ts` — event registration; never native Worktree hooks.
- `server/src/coord/schema.ts`, `server/src/coord/store.ts`, `server/test/coord-db.test.ts`, `server/test/coord-store.test.ts` — one migration and synchronous projection repair only; coordinator intent is checkpoint-owned, never a direct SQLite mutation. `server/src/coord/db.ts` changes only if a red migration fault test proves its existing loop lacks a required seam.
- `server/src/coord/gitref.ts`, `server/test/divergence-sweep.test.ts` — additive census records and explicit unreadable rows; do not create a competing census owner.
- `server/src/watch.ts`, `server/src/server.ts`, `server/test/fleet-health.test.ts` — non-awaited sibling lane and optional health assembly from checkpoint-owned intervals. Modify `server/src/fleetstate.ts` only if a red test proves it owns the relevant assembly.
- `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor.test.ts` — `delegation-hooks` PASS/WARN/FAIL/SKIP owner, every-home registration and spool-directory measurement, foreign Worktree-hook warning, role-aware SKIP, and remedy line.
- `server/src/coord/routes.ts`, `server/src/auth/gate.ts`, `ccd/ccrc-api`; `server/test/auth-gate.test.ts`, `box-token-census.test.ts`, `coord-pause-route.test.ts`, `ccrc-api.test.ts`, `ccrc-api-closed.test.ts` — intent door, census, CLI parser and attribution transport.
- `ccd/coordinator-skill/SKILL.md`, `server/test/coordinator-skill.test.ts`, `server/test/install-coordinator-skill.test.ts`, `CLAUDE.md` — exact clause 17, count/census, box-token prose only. No later-wave lease/cleanup verbs in the skill.
- `ccd/ccrc`, `deploy/deploy.sh`, `server/test/ccrc-update.test.ts`, `agent/test/deploy-verify.test.ts`, `server/test/install-census.test.ts` — invoke coordination snapshot after SQLite snapshot and backup set, before fallback rsync; preserve ordinary rollback exclusion.
- `README.md` — current backup outputs, new optional health, capability, and report-only operator semantics after behavior is green.

`deploy/backup-coord.mjs` remains byte-for-byte SQLite-only unless an existing test fixture must update an import path; no delegation logic enters it. Sidecars and manifest do not enter `_upd_backup_set` or `_upd_backup_pairs` because those structures also drive ordinary tree restoration.

---

### Task 1: Exact-pane hook ownership — mandatory first implementation commit

**Files:** modify `ccd/session-hook.sh`; test `server/test/session-hook.test.ts`.

**Interfaces**

- Consumes: `TMUX_PANE`, existing hook timeout wrapper and capture/hookstate writers.
- Produces: `tname` only from `tmux display-message -p -t "$TMUX_PANE" '#S'`; failure exits 0 before attribution.

- [ ] **Step 1: Write the failing exact-pane ownership tests.** Add a private-socket case with another pane current while `TMUX_PANE` names the owner, a teardown case where that exact pane is gone but another ccrc pane remains, and a timeout/failure case. Assert the first attributes to the exact pane and the latter two write neither hookstate, capture, nor delegation spool.
- [ ] **Step 2: Run RED.** From `server/`: `./node_modules/.bin/vitest run test/session-hook.test.ts`. Expected: the owner/current-pane case and gone-pane no-attribution case fail against untargeted lookup.
- [ ] **Step 3: Implement only the correction.** Use:

```bash
tname=""
[[ -n "$hooktmo" ]] &&
  tname=$("$hooktmo" 2 tmux display-message -p -t "$TMUX_PANE" '#S' 2>/dev/null)
[[ -n "$tname" ]] || exit 0
```

Keep any lines above the frozen anchor line-neutral.
- [ ] **Step 4: Run GREEN and mutation W3-M01.** Re-run the focused file; then remove only `-t "$TMUX_PANE"`, confirm the named rows fail, restore, and confirm green. Run `bash -n ../ccd/session-hook.sh`.
- [ ] **Step 5: Commit this change alone.** Stage only the hook and its exact tests. Commit message: `fix(hooks): resolve ownership from the exact pane` plus the required co-author trailer.

### Task 2: Bare `agent_id` main-turn classification — separate second commit

**Files:** modify `ccd/session-hook.sh`; test `server/test/session-hook-turnmark.test.ts` and focused integration in `server/test/session-hook.test.ts`.

**Interfaces**

- Consumes: raw hook `agent_id`, qualifying `SubagentStart` membership already recorded in owner-scoped hook state.
- Produces: main-turn suppression only for an agent ID with a qualifying join; unknown raw IDs remain evidence for the later spool and do not suppress the main turn marker.

- [ ] **Step 1: Write failing cases.** A main-thread PreToolUse with unknown non-empty `agent_id` must stamp `working`; a qualifying `SubagentStart` followed by its event must not; empty `agent_type` changes neither answer; an unpaired `SubagentStop` does not qualify membership.
- [ ] **Step 2: Run RED.** `./node_modules/.bin/vitest run test/session-hook-turnmark.test.ts test/session-hook.test.ts`. Expected: unknown-agent main-turn case fails because current `paid` treats any ID as placement.
- [ ] **Step 3: Implement the smallest owner-scoped membership reader.** Do not use `agent_type`, display name, or path. Preserve raw ID for Task 5 evidence capture.
- [ ] **Step 4: Run GREEN and W3-M02/W3-M42.** Mutate back to non-empty-ID classification and separately let an unpaired stop admit membership; each named row must fail, then restore and rerun green. Run Bash syntax.
- [ ] **Step 5: Commit.** `fix(hooks): require a qualifying join for subagent placement` with trailer.

### Task 3: Close D-3999 recapture obligations before using `--missing`

**Files:** modify `server/test/delegation-rig/recapture.sh`, `server/test/delegation-rig/rig.sh`, and established owner `server/test/delegation-rig.test.ts`.

**Interfaces**

- Consumes: current rig run statuses, versions directory, raw-root cleanup path.
- Produces: aggregate nonzero on any constituent failure; unreadable versions is measurement failure; shell-round-trippable cleanup hint using `%q` for real and dry-run paths.

- [ ] **Step 1: Add failing rows** for a failed single run despite `.done`, unreadable versions, a spaced/metacharacter raw root, and dry-run `<raw>` quoted exactly once. Name both rows affected by `%q`.
- [ ] **Step 2: Run RED.** `./node_modules/.bin/vitest run test/delegation-rig.test.ts`. Expected: all three carried obligations fail for their intended current behavior.
- [ ] **Step 3: Implement minimal shell changes** with no fixture recapture. Keep failure aggregation distinct from “already complete.”
- [ ] **Step 4: Run GREEN.** Re-run the focused file and `bash -n test/delegation-rig/recapture.sh test/delegation-rig/rig.sh`.
- [ ] **Step 5: Commit.** `fix(delegation-rig): fail closed before missing captures` with trailer. Only after this commit may a later execution task run `recapture.sh --missing`.

### Task 4: Shared vocabulary and additive measured IO

**Files:** modify `shared/api.ts`, `shared/agent-protocol.ts`, `agent/src/fileops.ts`, `agent/src/server.ts`, `server/src/io.ts`, `server/src/remote/io.ts`, `server/test/single-definition.test.ts`, `agent/test/fileops.test.ts`, `server/test/remote-io.test.ts`.

**Interfaces**

- Produces exactly the shared vocabulary, `MeasuredDirectoryRead`, `MeasuredByteRangeRead`, and the two `FleetIO` methods above.
- Existing `readdir` and decoded-string `readFileFromMeasured` derive from or coexist with the measured additions and preserve every old caller’s collapse/decoded behavior.

- [ ] **Step 1: Add RED directory adapter tables.** Pin local readable empty, ENOENT, EACCES/EIO; remote array, `absent:true`, old-agent `{names:null}`, malformed, refusal, timeout, and disconnect. Pin path validation before filesystem access and the old compatibility method’s unchanged collapse.
- [ ] **Step 2: Add RED byte-range tables.** Pin local and remote offsets at start/middle/EOF, `maxBytes` values 1 and 262144, multibyte splits, canonical base64, decoded-length equality, old peer with `data` only, malformed/noncanonical base64, negative/regressing size, refusal, timeout, and disconnect. Prove spool callers never reconstruct bytes from decoded `data`, while an old caller omitting `maxBytes` receives unchanged decoded-string behavior.
- [ ] **Step 3: Add RED single-definition scans** for every new closed vocabulary and canonical `ReadFailure` ownership.
- [ ] **Step 4: Run RED.** From `agent/`: `./node_modules/.bin/vitest run test/fileops.test.ts`; from `server/`: `./node_modules/.bin/vitest run test/remote-io.test.ts test/single-definition.test.ts`. Expected: measured methods, `absent` marker, `maxBytes`, and `dataB64` are missing.
- [ ] **Step 5: Implement additive response widening.** Reuse `ReaddirReq` and `ReadFromReq`; make agent `listDirMeasured` use the existing failure mapper; derive `listDir`; add `absent:true` only for ENOENT; bound byte reads to `maxBytes`; return old `data` plus canonical `dataB64`; implement local/remote consumers and preserve compatibility methods.
- [ ] **Step 6: Implement shared types and guards** with names exactly as fixed above. Do not add an IO capability word or protocol bump.
- [ ] **Step 7: Run GREEN and adapter mutations.** Re-run both packages’ focused files. Mutate old-peer null→absent, EACCES→absent, empty→failure, `data`→byte fallback, omitted `maxBytes` bound, malformed-base64 acceptance, and decoded-length check independently; each named row must red. Restore and rerun green.
- [ ] **Step 8: Commit.** `feat(delegation): preserve measured filesystem evidence` with trailer.

### Task 5: Fleet spool writer and hook registration

**Files:** modify `ccd/ccd`, `ccd/session-hook.sh`, `ccd/install-session-hooks.sh`; create `server/test/delegation-spool.test.ts`; extend `server/test/session-hook.test.ts` and `install-session-hooks.test.ts`.

**Interfaces**

- Consumes event vocabulary from Task 4 and existing hook’s single `jq` construction path.
- Produces `$REG/delegation/spool/<ccd-id>/<YYYYMMDDHH>.spool`, one complete line per append, and `delegation-events-v1` in ccd capabilities.

- [ ] **Step 1: Add RED session-spawn tests** proving ccd creates owner directory mode `0700`, and hook tests proving a missing directory is skipped without `mkdir`.
- [ ] **Step 2: Add RED closed-event tables** for compact/noncompact `SessionStart.source`; PreToolUse Agent/Task/Workflow/Bash; normalized Agent/Task and Workflow launch responses in PostToolUse; SubagentStart; SubagentStop including `agentTranscriptPath`; syntactically valid terminal task notification in `UserPromptSubmit`; and `SessionEnd.reason`. The compact SessionStart record must occur before the existing compact early exit. Prove ToolSearch, Stop, WorktreeCreate, and WorktreeRemove do not produce records; prove arbitrary tool response, full prompt/result/diagnostics, Agent `outputFile`, and `scratchpad_dir` never persist; and prove approved Workflow `transcriptDir`/`scriptPath` do persist.
- [ ] **Step 3: Add RED envelope and cap tests.** Pin parent incarnation read at write time, required-field validation, owner equality, canonical millisecond UTC timestamp, identifier/list bounds, names-only listing, no `scratchpad_dir`, listing dropped first at the measured ~3.9 KiB case, `truncated:true`, and byte length `<4096` for multibyte input. Missing/malformed/changing/unreadable generation exits 0 without a line; ingestion of a formerly valid line after owner-generation reuse is unmeasured.
- [ ] **Step 4: Add RED append/prune tests.** Concurrent writes remain complete lines; current-owner buckets older than 24 hours alone are removed; prune runs at most once per UTC hour and cannot traverse/symlink outside owner spool.
- [ ] **Step 5: Run RED.** `./node_modules/.bin/vitest run test/delegation-spool.test.ts test/session-hook.test.ts test/install-session-hooks.test.ts`. Expected: spool and registration rows fail because behavior is absent.
- [ ] **Step 6: Implement ccd directory creation and capability, then restamp.** The hook never creates the directory.
- [ ] **Step 7: Implement the hook append in its existing `jq` call,** deterministic optional shedding, compact-before-exit capture, bounded listing trigger, and contained hourly prune. Preserve hot-path budget and exit 0.
- [ ] **Step 8: Register only approved hooks.** Keep native Worktree hooks absent.
- [ ] **Step 9: Run GREEN and W3-M03–M06.** Run focused tests, Bash syntax, generated mark/citation/install census; execute each named mutation independently and restore.
- [ ] **Step 10: Commit.** `feat(delegation): append bounded owner-scoped evidence` with trailer.

### Task 6: Recapture the current supported Claude lanes

**Files:** create only missing version directories/files under `server/test/fixtures/delegation/<version>/` through `server/test/delegation-rig/recapture.sh`; modify the fixture matrix only through the rig’s generated output; test `server/test/delegation-rig.test.ts`, `server/test/delegation-fixtures.test.ts`, `server/test/public-content.test.ts`, and `server/test/topology-clean.test.ts`.

**Interfaces**

- Consumes: Task 3’s fail-closed `recapture.sh --missing`, the current rostered Claude lane versions measured at execution time, and an empty new raw-capture directory per untrusted capture.
- Produces: committed immutable fixtures for every current missing supported version before parser/correlation implementation relies on their shapes.

- [ ] **Step 1: Measure the current lane versions** from the repository’s canonical lane/version source and compare them with fixture directories. Record the exact missing set; do not infer it from this dated plan.
- [ ] **Step 2: Run the repaired missing-only capture.** Use `server/test/delegation-rig/recapture.sh --missing` exactly as documented by the rig, preserving each capture in its own new empty raw directory. A nonzero constituent result blocks the task; do not hand-edit a failed fixture into existence.
- [ ] **Step 3: Inspect every new fixture** for the closed fields used by this plan: SessionStart source, SessionEnd reason, Agent/Task launch response, Workflow launch response/meta, task notification, order variance, worktree path, and parent/subagent IDs. Record an explicit absence where a current version does not emit a field; parser policy must not invent it.
- [ ] **Step 4: Run fixture and public-content guards plus W3-M73.** From `server/`: `./node_modules/.bin/vitest run test/delegation-rig.test.ts test/delegation-fixtures.test.ts test/public-content.test.ts test/topology-clean.test.ts`. Temporarily remove one current-lane fixture from the fixture copy used by the census and prove the current-lane row fails, restore it, then require every captured fixture to pass schema/redaction/topology checks.
- [ ] **Step 5: Commit captures before parser code.** `test(delegation): recapture current Claude evidence` with trailer. Stage only Task 6 fixture/matrix changes.

### Task 7: One six-table migration and synchronous projection

**Files:** create `server/src/coord/delegation-model.ts` and `server/test/delegation-model.test.ts`; modify `server/src/coord/schema.ts`, `server/src/coord/store.ts`, `server/test/coord-db.test.ts`, `server/test/coord-store.test.ts`.

**Interfaces**

- Consumes row definitions and complete DDL above.
- Produces synchronous methods:

```ts
projectDelegationCheckpoint(checkpoint: DelegationCheckpointV1): void;
insertDelegationEvent(row: DelegationEventRow): 'inserted' | 'duplicate';
readDelegationProjection(): DelegationCheckpointV1;
```

Health and coordinator intent are not read back from SQLite. Task 13 derives health from `DelegationCheckpointV1.observationIntervals`, and Task 15 mutates `DelegationCheckpointV1.coordinatorIntentByParent` through Task 8's serialized checkpoint adapter before projecting the derived session rows. Projection rows are repairable output only.

- [ ] **Step 1: Remeasure migration slot.** Run `git fetch origin main` and count migration headings in `origin/main`; record the result in the task log. If not 18, change only the slot comment/version expectation, never an applied migration.
- [ ] **Step 2: Add RED migration tests.** Fresh DB and exact prior-version DB create all six tables in one step; constraints/indexes match the DDL; injected statement failure leaves prior `user_version` and no partial table; an older-build fixture can still read/write its known tables after opening the newer additive DB.
- [ ] **Step 3: Add RED model/store tests.** Canonical natural-key encoding has no delimiter collision; substituting envelope `eventId` for accepted `identityJournalId` is rejected; duplicate evidence event and duplicate unreleased `lease-created` identity are idempotent; natural key cannot mint a second activity; null and non-null `creationBase` each enforce the exact unreleased lease identity and the same tuple is reusable after release; nullable unresolved/conflicting/unmeasured attempts round-trip while a linked null-path attempt fails; activity and lease source domains stay distinct; active path is unique while released path can be reused; checkpoint projection round-trips server-minted lease ID, deterministic lineage ID, both journal sequences, generation 0, coordinator-intent map, and every future-facing field; wave-3 store methods reject nonzero generation, unequal creation/current sequences at generation 0, non-ephemeral disposition, cleanup state other than `not-due`, every non-null transition clock/evidence/carrier generation, and an event-less lease; replacing or deleting SQLite and reprojecting the same checkpoint restores explicit intent and does not invent it from projection state.
- [ ] **Step 4: Add RED replacement-order tests.** With foreign keys enabled, capture statement order and inject a fault at every delete/insert. Require the exact delete and insert orders above, no FK error, complete rollback on every fault, and exact checkpoint projection after success.
- [ ] **Step 5: Run RED.** `./node_modules/.bin/vitest run test/delegation-model.test.ts test/coord-db.test.ts test/coord-store.test.ts`. Expected: migration/model/store methods are absent.
- [ ] **Step 6: Append the DDL and implement pure codecs/guards.** Do not edit `db.ts` unless an injected migration fault first proves its current transaction loop inadequate.
- [ ] **Step 7: Implement synchronous store methods** in one SQLite transaction using the fixed FK-safe order. Validate JSON through typed readers; never cast unknown enum text; do not add a SQLite health authority.
- [ ] **Step 8: Run GREEN and storage mutations.** Execute W3-M18B/M59/M64–M67/M72 plus every required unique/check/FK/partial predicate independently; remove a release predicate, current sequence, linked-path check, split source check, or reorder each dependency edge and prove its named row fails. Restore and rerun green.
- [ ] **Step 9: Commit.** `feat(delegation): add report-only coordination projection` with trailer.

### Task 8: Journal, checkpoint, recovery, retention, backup, and restore

**Files:** create `server/src/coord/delegation-journal.ts`, `server/src/coord/delegation-checkpoint.ts`, `deploy/coordination-snapshot.mjs`, `server/test/delegation-recovery.test.ts`, `server/test/coordination-snapshot.test.ts`; modify `ccd/ccrc`, `deploy/deploy.sh`, `server/test/ccrc-update.test.ts`, `agent/test/deploy-verify.test.ts`, `server/test/install-census.test.ts`, and backup prose. Keep `deploy/backup-coord.mjs` SQLite-only.

**Interfaces**

- Consumes O1–O5 and manifest contract above.
- Produces canonical journal append/validation, atomic checkpoint, `recoverDelegationState`, pruning plan, and CLI:

```text
ccrc coordination-snapshot validate --from <timestamp-directory>
ccrc coordination-snapshot restore --from <timestamp-directory>
ccrc coordination-snapshot recover
```

Classifier exits: `v1` output/0; `legacy` output/0; `none`/1; `invalid`/2; helper or usage failure/70.

- [ ] **Step 1: Add RED canonical journal tests** for every accepted/rejected grammar and W3-M20–M24. Pin RFC 8785 vectors for property order, escaping, multibyte strings, `-0`, decimal/exponent boundaries, unsafe/nonfinite numbers, lone surrogates, duplicate keys, sparse arrays, `undefined`, and non-plain objects. Pin both exact nonrecursive preimages; prove changing `journalId` affects `digest` but not its own preimage. Prove duplicate event and duplicate unreleased lease identity are not appended and one append call writes record plus LF before fsync.
- [ ] **Step 2: Add RED O1/O2/O4/O5 crash tests.** Inject failure at each durability edge. Include the retained-pre-checkpoint trap: E1 sequence 10, checkpoint position 20, activity absent; retained E1 still selects identity by accepted `journalId`, while raw envelope `eventId` cannot. Prove phase remains `reconstructing` and pruning disabled on every recovery failure.
- [ ] **Step 3: Add RED UUID/lease-creation tests.** Pure policy cannot import/call randomness and returns only `DelegationLeaseCreationRequest`; the serialized adapter deduplicates first, calls injected `randomUUID` exactly once for a new identity and zero times for duplicate/run-child-owned/unmeasured inputs, derives the fixed-vector `lineageId`, appends generation 0 with equal creation/current sequence and canonical `firstObservedAt`, checkpoints, then projects. Replay reconstructs lease first/last observation and lineage opening from the entry's `firstObservedAt`, not replay time or `acceptedAt`. A crash before checkpoint exposes neither UUID nor ID mapping.
- [ ] **Step 4: Add RED retention-planning tests.** Compute holds for the complete journal, checkpoint anchor, open lease/lineage evidence, and identity candidates. Prove no production call path opens a rewrite/truncate/rename target for `delegation-events.log`; reconstruction failure keeps pruning disabled. Physical compaction is deferred, so no test may claim a wave-3 journal rewrite occurred.
- [ ] **Step 5: Add RED stable-capture tests.** Exactly five attempts with delays 10/25/50/100 ms: checkpoint A; open journal without following symlinks; `fstat` and copy exactly that opened inode’s byte count; checkpoint B; require byte equality; validate checkpoint, complete copied journal including pre-anchor records, anchor, suffix and copied EOF; validate/hash expected SQLite snapshot; write manifest last. Exhaustion removes helper-owned partials, writes no manifest, returns nonzero.
- [ ] **Step 6: Add RED classifier/retention tests.** `v1` requires valid manifest; `legacy` requires no manifest/sidecars, valid DB, and no `delegation_*` tables; present invalid manifest never falls back; valid v1 may have absent DB. Keep newest N timestamp dirs, current operation dir, newest valid pre-operation coordination snapshot, and newest pre-operation tree backup independently. Classifier failure deletes nothing and warns.
- [ ] **Step 7: Add RED restore fault matrix.** Require service stopped and measured inactive; validate before live mutation; stage old/new `delegation-events.log`, `delegation-checkpoint.json`, `coord.db`, `coord.db-wal`, `coord.db-shm`; publish active restore marker; all-old or all-new before durable `COMMITTED`; pre-commit recovery restores old, post-commit recovery finalizes new; startup refuses active marker. Explicit absent-DB manifest acknowledgment alone removes DB/WAL/SHM.
- [ ] **Step 8: Add RED integration tests for callers.** `_upd_backup`: unique directory, existing SQLite snapshot, existing `_upd_backup_set`, then coordination capture last; continue only after durable manifest. Sidecars never enter `_upd_backup_set`/pairs or rollback arm 3. Fallback deploy captures before rsync and aborts on failure.
- [ ] **Step 9: Run RED.** `./node_modules/.bin/vitest run test/delegation-recovery.test.ts test/coordination-snapshot.test.ts test/ccrc-update.test.ts test/install-census.test.ts`; in `agent/`, run `./node_modules/.bin/vitest run test/deploy-verify.test.ts`. Expected: focused modules/helper/callers absent.
- [ ] **Step 10: Implement O1–O5 in focused modules** and project to SQLite only after checkpoint durability. Positive meta advances checkpoint revision without inventing a journal sequence.
- [ ] **Step 11: Implement the helper and callers.** Do not change SQLite helper semantics. Include manifest/output names in current backup prose and installation census.
- [ ] **Step 12: Run GREEN and durability mutations.** Execute W3-M12–M40 and W3-M59/M62/M65/M71 independently where owned by this task. Run Bash syntax and the focused server/agent files again.
- [ ] **Step 13: Commit.** `feat(delegation): make observation recovery durable` with trailer.

### Task 9: Per-bucket ingestion with honest gaps

**Files:** create `server/src/coord/delegation-ingest.ts`, `server/test/delegation-ingest.test.ts`; wire through existing `server/src/io.ts` methods only.

**Interfaces:** implements pure `ingestDelegationBucket` plus `ingestAndApplyDelegationBucket` exactly as fixed above. The adapter passes the pure result to `DelegationBucketDurability.applyBucketResult`, whose Task 8 implementation serializes all accepted journal appends, journal fsync, next-state construction, checkpoint temp/fsync/rename/directory-fsync, and only then Task 7 projection. The pure function performs no IO and the adapter exposes no accepted ID, cursor, or interval before the durable call returns.

- [ ] **Step 1: Add RED framing/event-ID table.** Byte offsets, complete lines, multibyte data, no newline, torn tail then completion, size below cursor, size below last-seen size, changed bytes before an accepted coordinate, complete malformed line, vanished unread suffix, empty readable bucket. Pin fixed event-ID vectors from owner session, bound incarnation, UTC bucket, U64BE start/end offsets, and raw-line SHA-256; changing any component changes the ID, while replaying the same bytes at the same coordinate does not. Prove concurrent disjoint offsets cannot collide and PID/timestamp reuse is irrelevant.
- [ ] **Step 2: Add RED closed-envelope table.** Every event variant above accepts exactly its own keys. Test owner mismatch, current-generation mismatch/reuse, missing required property, invalid UTC timestamp, unknown key, overbound IDs/list, non-string list entry, arbitrary tool response, full notification prompt/result/diagnostics, Agent `outputFile`, `scratchpad_dir`, and serialized line `>=4096`; all make the interval unmeasured while complete-line cursor advances only where specified. Separately prove normalized Workflow `transcriptDir` and `scriptPath` are retained because they are approved closed fields, not arbitrary output data.
- [ ] **Step 3: Add RED capability/transport table.** Missing capability, old peer returning only decoded `data`, malformed base64, byte-count mismatch, unavailable owner directory, and recovery failure are unmeasured; no condition fabricates bytes or an empty measurement.
- [ ] **Step 4: Run RED.** `./node_modules/.bin/vitest run test/delegation-ingest.test.ts`. Expected: module absent.
- [ ] **Step 5: Implement pure framing/validation** following `mirrorplan.ts` complete-line precedent, then implement `ingestAndApplyDelegationBucket` as the named IO boundary. Its only stateful call is `durability.applyBucketResult(result)`, and Task 8's implementation owns journal → checkpoint → projection/cursor ordering.
- [ ] **Step 6: Run GREEN and ingestion mutations.** Execute W3-M07–M11 and W3-M60/M61/M69/M70 independently, restore, and rerun green.
- [ ] **Step 7: Commit.** `feat(delegation): ingest complete evidence without hiding gaps` with trailer.

### Task 10: Extend the existing worktree census without narrowing failures

**Files:** modify `server/src/coord/gitref.ts`, `server/test/divergence-sweep.test.ts`; prepare additive watcher input in `server/src/watch.ts` only after pure census is green.

**Interfaces:** extends `WorktreeRecord`/`WorktreeRead` through `DelegationCensusRecord`; retains existing callers’ semantics.

- [ ] **Step 1: Add RED census rows** for attached/detached HEAD, `CLAUDE_BASE`, first `logs/HEAD`, lock, exact canonical path, absent record, unreadable `gitdir`, unreadable HEAD, unreadable first log, and individual unreadable admin record retained in result.
- [ ] **Step 2: Add RED incarnation rows** for valid, absent, malformed, changing, and unreadable `$REG/<id>.generation`; every non-valid result is unmeasured.
- [ ] **Step 3: Add RED D-4008 table** proving failed lock stat→`locked:false`, unreadable first log→`baseAgreesFirstLog:null`, unreadable `gitdir`→correlation-absent plus diagnostic; none is positive evidence.
- [ ] **Step 4: Run RED.** `./node_modules/.bin/vitest run test/divergence-sweep.test.ts`. Expected: additive fields and explicit unreadable rows missing.
- [ ] **Step 5: Implement through measured reads.** Preserve old `WorktreeRead` distinctions and existing project guard. Reuse the once-per-minute result; do not schedule another census.
- [ ] **Step 6: Run GREEN and W3-M49/M50.** Mutate each fold into positive evidence and unreadable into absent; named rows must fail.
- [ ] **Step 7: Commit.** `feat(delegation): extend the bounded worktree census` with trailer.

### Task 11: Pure join qualification and correlation ladder

**Files:** create `server/src/coord/delegation-correlation.ts`, `server/test/delegation-correlation.test.ts`.

**Interfaces:** implements `correlateDelegation`, consumes Task 7 rows and Task 10 census, emits no IO or effect.

- [ ] **Step 1: Add RED join-order table** for launch-before-start, start-before-launch, positive meta after bare event, bare event after join, unpaired stop, parent Stop, empty `agent_type`, ToolSearch before Workflow, and SessionEnd `/clear` ID rotation. Prove the earliest retained naming record’s accepted `journalId` is identity once a qualifying join for that ID is durably applied; a bare occurrence pruned before that join cannot later become identity, and envelope `eventId` never substitutes.
- [ ] **Step 2: Add RED rung tables.** Positive and near-miss for run-child agreement, requiring distinct `run-child-owned`; exact meta/path for agent/workflow; subagent-emitted exact path only after qualification; raw one-record listing delta without overlap. Prove `bash-worktree` activity maps to lease source `raw` and no wave-3 path emits `attached`.
- [ ] **Step 3: Add RED refusal tables** for run-child-owned flowing into lease creation, rung-2 stop, exact-path mismatch, duplicate parent evidence, conflict finality, overlap, two-pass ccrc-birth wait, every forbidden heuristic, and every D-4008 fold.
- [ ] **Step 4: Run RED.** `./node_modules/.bin/vitest run test/delegation-correlation.test.ts`. Expected: module absent.
- [ ] **Step 5: Implement pure ladder** with `conflicting` spelling everywhere. `agent-*`/`wf_*` route to rung 2 but names never link.
- [ ] **Step 6: Run GREEN and correlation mutations.** Apply W3-M41–M50, W3-M59, W3-M63, and W3-M66 independently and record the failing row.
- [ ] **Step 7: Commit.** `feat(delegation): correlate only exact retained evidence` with trailer.

### Task 12: Pure report-only reconciliation and circuit breaker

**Files:** create `server/src/coord/delegation-policy.ts`, `server/test/delegation-policy.test.ts`.

**Interfaces:** implements `planDelegationReconciliation`; output is the six-member `DelegationReportEffect` union only. Pure policy returns an identity-only `DelegationLeaseCreationRequest`; it never returns a UUID or `DelegationLeaseRow`.

- [ ] **Step 1: Add RED state-transition table** for candidate present, run-child-owned, measured absence on two successful censuses, unreadable record, ended activity, paused workflow, restarting supervisor, registry unreadable, carrier-alone, and ccrc workspace being born.
- [ ] **Step 2: Add RED effect census** that switches exhaustively over the six allowed tags and scans source for forbidden effects/verbs/randomness imports. Prove rung 1 emits only `record-run-child-owned`; rung 2/3/4 linked evidence may emit only `request-linked-lease-identity`; unresolved/conflicting/unmeasured evidence never requests a lease. The request has no UUID/generation/journal sequence/clock/transition field and cannot transition disposition/cleanup, write a carrier, mint a token, or confer action eligibility.
- [ ] **Step 3: Add RED breaker rows.** One/two parents first measured dead inside ten minutes; old death outside window; unreadable registry. Breaker is report-only and returns no action.
- [ ] **Step 4: Run RED.** `./node_modules/.bin/vitest run test/delegation-policy.test.ts`. Expected: module absent.
- [ ] **Step 5: Implement pure exhaustive policy.** Unknown/unavailable stays unmeasured; measured absence is report projection, not native removal or reclaim.
- [ ] **Step 6: Run GREEN and policy mutations.** Execute W3-M51–M54 and W3-M62/M63 independently; restore after each.
- [ ] **Step 7: Commit.** `feat(delegation): reconcile observation without authority` with trailer.

### Task 13: Watcher sibling lane and seven-day health

**Files:** modify `server/src/watch.ts`, `server/src/server.ts`, `shared/api.ts`, `server/test/fleet-health.test.ts`; create `server/test/delegation-watch.test.ts`, `server/test/delegation-health.test.ts`. Modify `server/src/fleetstate.ts` only on a red ownership test.

**Interfaces**

- Consumes Tasks 9–12 and synchronous Task 7 projection.
- Produces optional `FleetHealth.delegation`; no new frame or PWA state.

- [ ] **Step 1: Add RED scheduling rows.** Delegation ingestion/reconciliation is a non-awaited sibling at the existing 60-second cadence; one slow/failed remote read does not block other watcher lanes; identical snapshots feed pure policy; restart does not double-apply; projection drift repairs from checkpoint.
- [ ] **Step 2: Add RED durable-interval rows.** Each observed session/incarnation/UTC-hour has one checkpoint-owned `measured` or `unmeasured` interval with detail and recorded time. Missing capability, unreadable directory/range, malformed evidence, generation disagreement, and recovery failure persist as unmeasured across restart. Replacement/merge is deterministic, retains at least seven complete days, and SQLite deletion cannot erase the health basis.
- [ ] **Step 3: Add RED health arithmetic.** Aggregate only from checkpoint-owned intervals over a rolling seven-day UTC session-hour window; complete window with 0.99% eligible; exactly 1.00% ineligible; incomplete window, zero denominator, old fleet, missing capability, unavailable registry, or recovery failure unmeasured. Absence from older server is unknown to readers.
- [ ] **Step 4: Run RED.** `./node_modules/.bin/vitest run test/delegation-watch.test.ts test/delegation-health.test.ts test/fleet-health.test.ts`. Expected: lane, durable intervals, and health are absent.
- [ ] **Step 5: Implement watcher IO/apply only.** Policy stays in pure modules. Durably replace checkpoint with interval/cursor changes before repairing SQLite; never call a SQLite-only health-window reader.
- [ ] **Step 6: Add optional health assembly** at the existing `/api/fleet/health` owner from checkpoint intervals. Do not touch PWA.
- [ ] **Step 7: Run GREEN and health mutations.** Execute W3-M57/M58/M68 independently: mutate interval durability, restart restoration, unavailable→zero, and threshold comparison; named rows fail.
- [ ] **Step 8: Commit.** `feat(delegation): report observation health` with trailer.

### Task 14: Doctor ownership and remedies

**Files:** modify `ccd/ccrc-doctor-checks`; test `server/test/ccrc-doctor.test.ts`.

**Interfaces**

- Produces one `delegation-hooks` doctor check with `PASS`, `WARN`, `FAIL`, or role-aware `SKIP` plus a concrete remedy line on WARN/FAIL.
- Consumes the canonical roster and shipped hook registration, the ccd-created owner spool-directory contract, and the approved event set; it reads no secret contents and mutates nothing.

- [ ] **Step 1: Add RED doctor table.** Agent/both role with every roster-home registration and spool directory healthy is PASS; missing registration or directory is FAIL; unreadable roster/home/registration/directory is FAIL, never absence; foreign `WorktreeCreate`/`WorktreeRemove` registration is WARN; server-only role is SKIP. Multiple defects report deterministically without hiding a FAIL behind a WARN.
- [ ] **Step 2: Add RED remedy rows.** Missing shipped registration points to `ccrc doctor --fix`; missing owner directory points to restarting/installing the owning ccd supervision through supported ccrc operations; foreign Worktree hooks name manual inspection/removal without deleting them. No remedy prints hook payload, token, or other secret content.
- [ ] **Step 3: Run RED.** From `server/`: `./node_modules/.bin/vitest run test/ccrc-doctor.test.ts`. Expected: `delegation-hooks` is absent.
- [ ] **Step 4: Implement `_check_delegation_hooks`** using existing doctor result helpers and role/roster readers. Measure every rostered home; do not add a second hook installer or create spool directories from doctor.
- [ ] **Step 5: Run GREEN and W3-M74.** Delete one registration, hide one home, make a directory unreadable, add each foreign Worktree event, omit each remedy, and switch roles; every named row must red under the corresponding mutant and pass after restoration. Run `bash -n ../ccd/ccrc-doctor-checks`.
- [ ] **Step 6: Commit.** `feat(doctor): measure delegation hook readiness` with trailer.

### Task 15: Coordinator intent route, exact CLI syntax, and clause 17

**Files:** modify `server/src/coord/routes.ts`, `server/src/auth/gate.ts`, `ccd/ccrc-api`, `ccd/coordinator-skill/SKILL.md`, `CLAUDE.md`; create `server/test/coordinator-intent-route.test.ts`; modify `server/test/coord-pause-route.test.ts`, `auth-gate.test.ts`, `box-token-census.test.ts`, `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`, `coordinator-skill.test.ts`, `install-coordinator-skill.test.ts`.

**Interfaces**

- Route: `POST /api/coordinators/:id/intent`.
- Request body transported by ccrc-api:

```ts
interface CoordinatorIntentBody {
  action: 'set' | 'clear';
  byId: string;
  byUuid: string;
}
```

- CLI: `ccrc-api coordinators intent set --session <id>` and `... clear ...`.

- [ ] **Step 1: Add RED route rows.** Ordering is configured coordination-durability check → box token → closed body validation → `requireAttribution(reply, byId, byUuid, 'byUuid')` → current registry incarnation read → serialized checkpoint mutation → disposable projection repair. Pin 501 not-configured, 401 missing token, malformed action/extra key, stale UUID, `byId != :id`, current incarnation only, idempotent set/clear, and clear preserving run-owner/inferred/retained bases. Inject failure before checkpoint rename, after rename, and before projection; intent is visible only from a durably replaced checkpoint, survives SQLite deletion/reprojection, and a projection failure cannot erase the checkpointed declaration.
- [ ] **Step 2: Add RED CLI parser rows.** Implement a focused special case before the generic two-word route parser: accept exactly `coordinators intent <set|clear> --session <id>`, derive current `id` and UUID with existing exact-pane `derive_identity`, require supplied session equals derived ID, synthesize JSON body with `action`, `byId`, `byUuid`, and reject missing/duplicate/extra flags. Token remains internal curl-config input and never argv/output. Update closed route count from its measured current value by exactly one.
- [ ] **Step 3: Add RED door/prose rows.** Box-token census, auth-gate EXEMPT reason, coord route sets, and CLAUDE.md sentence agree. This is box-token gated and session-gated when auth is armed; it is not an ungated release valve.
- [ ] **Step 4: Add RED skill rows** for exact clause 17, count “seventeen,” workflow mode preserved, generic delegation permitted, and no later-wave lease/cleanup verb in skill text.
- [ ] **Step 5: Run RED.** `./node_modules/.bin/vitest run test/coordinator-intent-route.test.ts test/coord-pause-route.test.ts test/auth-gate.test.ts test/box-token-census.test.ts test/ccrc-api.test.ts test/ccrc-api-closed.test.ts test/coordinator-skill.test.ts test/install-coordinator-skill.test.ts`. Expected: route/parser/clause absent and census counts fail.
- [ ] **Step 6: Implement the route and serialized checkpoint call** without mutating historical incarnations. Encode the `(sessionId, parentIncarnation)` key canonically in `coordinatorIntentByParent`; set stores canonical `declaredAt`, clear removes only that key, and both rebuild `DelegationSessionRow.explicitIntentAt`/`effectiveBasis` before Task 7 projection. Do not add a direct SQLite intent writer.
- [ ] **Step 7: Implement the focused CLI grammar** while preserving every generic route. Do not add an untyped arbitrary URL path.
- [ ] **Step 8: Append clause 17 verbatim:**

> 17. Before delegating, declare coordinator intent for this session with `ccrc-api coordinators intent set --session <id>`; clear that declaration when the coordinator role ends. This is an identity declaration, not a restriction on ordinary Agent or Workflow use.

- [ ] **Step 9: Run GREEN and W3-M55/M56.** Mutate attribution and clear behavior independently; run `bash -n ../ccd/ccrc-api` and focused files again.
- [ ] **Step 10: Commit.** `feat(delegation): declare coordinator intent explicitly` with trailer.

### Task 16: Integrated compatibility, recovery, scope, and rollout gate

**Files:** create `server/test/delegation-wave3.integration.test.ts`; modify `README.md`; modify `.github/ci/select-tests.mjs` or `.github/ci/testmap.mjs` only if a new failing selection test proves omission.

**Interfaces:** no new production API. This task verifies the assembled wave and documents measured behavior.

- [ ] **Step 1: Add RED/green integration scenarios.** New fleet/old server: spools fill/expire and no carrier/cleanup exists. New server/old fleet or old peer without byte response: health unmeasured. DB deletion: checkpoint/journal restore exact IDs and interval health. Checkpoint mismatch: startup refuses observation lane. Retained pre-checkpoint evidence opens missing activity from its accepted journal ID. Run-child agreement remains owned without a lease. Seven complete days below 1% becomes eligible without enabling later waves.
- [ ] **Step 2: Add a closed scope census.** Assert no new PWA source/state/frame; no `delegation` frame; no carrier command/file; complete future disposition/cleanup columns exist but no wave-3 writer can transition or populate them beyond inert initialization; no adoption/promotion/retain/resolve route; no cleanup/audit token/queue/executor; no physical journal compaction/truncation; no `ws-*lease*` skill text; no new agent request operation/capability/protocol bump; pure policy has no randomness import and cannot produce a completed lease row; doctor is read-only.
- [ ] **Step 3: Add selector test only if needed.** Run the existing selector against every new source/test. If any owner is omitted, first add a failing selector assertion, then the minimal map fix. Otherwise leave CI files untouched.
- [ ] **Step 4: Run the integrated file and docs guards.** `./node_modules/.bin/vitest run test/delegation-wave3.integration.test.ts test/single-definition.test.ts test/box-token-census.test.ts test/coordinator-skill.test.ts test/deviation-refs.test.ts test/topology-clean.test.ts test/typecheck-tests.test.ts` after `git fetch origin main`. Expected: all named files pass; no placeholder or topology leakage.
- [ ] **Step 5: Run complete package verification in the foreground, timeout at least 600000 ms.** In order: `cd server && npm run test`; `cd agent && npm run test`; `cd pwa && npm run test`; then the repository build commands named by package scripts. Re-run known load flakes in isolation before classification and report every red honestly.
- [ ] **Step 6: Run shell/generated/docs verification.** Bash syntax for every changed shell file; generated-mark/citation/install census; `git diff --check`; placeholder scan; type/property/function consistency scan; mutation ledger completeness; inspect final diff for wave-4–7 authority.
- [ ] **Step 7: Remeasure migration and branch integration.** Fetch `origin/main`, re-count migration slots, inspect merge-tree/conflicts. Absorb main only if a conflict is measured and clause 15 permits it; otherwise do not merge it merely because the plan is ending.
- [ ] **Step 8: Commit docs/integration residue.** `docs(delegation): pin wave 3 report-only rollout` with trailer.

## Rollout and Verification

Implementation does not perform rollout. After implementation review, merge, and a release artifact, the operator uses ccrc’s release/rollout path:

1. Build one artifact containing spool-capable hooks, ccd owner-directory creation, additive measured directory response, `delegation-events-v1`, server journal/checkpoint, snapshot helper, and report-only server lane.
2. Roll out **fleet first**. Old servers ignore spools; hooks retain only their own 24-hour buckets and cannot create authority or cleanup.
3. Run doctor on every rostered home. Hook registration and spool directory are measured separately from the capability. Missing registration or directory is unavailable, not healthy. Foreign Worktree hooks warn.
4. Roll out the server. Recovery validates journal/checkpoint before watcher scheduling; mismatch keeps observation unavailable and pruning disabled.
5. Validate a fresh coordination snapshot and fixture restore. Do not start the stage clock until journal/checkpoint backup and recovery are measured.
6. Confirm old fleet and missing capability show `unmeasured`, and no health surface renders them as empty or zero.
7. Start the rolling seven-day UTC session-hour window only when capability, doctor registration, server recovery, and health reporting are all measured.
8. During the window inspect malformed lines, vanished buckets, unresolved/conflicting/unmeasured counts, circuit-breaker periods, snapshot validation, projection repair, and retention daily.
9. The gate is eligible only after a complete seven-day window with `unmeasuredSessionHours / totalSessionHours < 0.01`; 0.99% passes, 1.00% does not. Zero denominator or any incomplete/unavailable basis is unmeasured.
10. Eligibility does not activate Project, Adopt, Clean-shadow, or Clean-live. Waves 4–7 remain separately planned, approved, opened, reviewed, and gated.

Deployment order is agent/fleet first, then server, then skills/doctor verification. No PWA deployment is required for behavior, but the ordinary artifact may contain an unchanged PWA build. No deployment, marker touch, stable promotion, cleanup, or run dispatch belongs to this planning task.

## Plan Self-Review Checklist

Before requesting the independent review:

- [ ] Map spec §§5.1–5.5, 5.12–5.14, 6, 7 stage 2, 8.3–8.5 wave-3 rows, 9 health/doctor, 10 sequencing, and 13 clause/prose to owning tasks.
- [ ] Run the documented placeholder-pattern scan case-insensitively, inspect every hit, and remove every instruction-placeholder occurrence; quoted scan terms in this checklist are exempt only when the scan proves they are not an implementation gap.
- [ ] Compare every interface use to the Fixed Vocabulary block; verify `conflicting`, `bash-worktree`, names-only `listing`, and `ReadFailure` spellings.
- [ ] Verify each Review Focus item names a concrete test in its owner task.
- [ ] Verify every wave-3-applicable spec §8.4 row and every W3-M01–W3-M74 plus W3-M18A–M18C row has one red owner, and every later-wave behavior row is explicitly deferred.
- [ ] Search the plan and intended source map for authority leakage: carrier writes, generation >0, disposition/cleanup transitions, non-null transition clocks/evidence/carrier generation, adoption, retain/resolve, promotion, dispatch, audit tokens, cleanup nomination/execution, deletion, PWA state/frame. Future-facing columns and their inert initialization are required by spec §5.2 and are not leakage.
- [ ] Verify O1–O5 provenance remains “proposed answers to implementation questions,” never “approved spec requirements.”
- [ ] Verify wave count stays `wave:3`, `waveOf:7`, and no sentence claims PR #321 merged.

## Deviations found

No planning-time deviation is defined. After operator approval on 2026-10-09, the allocator issued wave 3's contiguous 32-number block: 4633, 4634, 4635, 4636, 4637, 4638, 4639, 4640, 4641, 4642, 4643, 4644, 4645, 4646, 4647, 4648, 4649, 4650, 4651, 4652, 4653, 4654, 4655, 4656, 4657, 4658, 4659, 4660, 4661, 4662, 4663 and 4664. These remain bare issued numbers until the worker defines an actual departure from this approved plan. The worker takes them in order and records every unused number as unused; no number is repurposed.

Found mid-wave (issued from the block above, taken in order; each defined in the commit after the work that makes it):

- **D-4633** — `exact-pane-fix-is-one-line-in-place` (Task 1): Step 3's four-line block (`tname=""`, the wrapped lookup, `[[ -n "$tname" ]] || exit 0`) cannot hold beside Step 3's own rule that every line above the frozen anchor (hook line 2900) stays line-neutral: the lookup sits at :2760, above it. The lookup was instead changed IN PLACE to `tmux display-message -p -t "$TMUX_PANE" '#S'`, and the existing next line, `[[ "$tname" == cc-?* ]] || exit 0`, already exits 0 on an empty or failed answer (it rejects every value the `-n` test rejects, and more), so failure still exits before any attribution. The comment above it was re-wrapped to keep the count. W3-M01 (drop `-t "$TMUX_PANE"`) reds the named rows as planned. Commit `87e6af1a8`.
- **D-4634** — `join-record-is-its-own-append-only-field` (Task 2): the task consumes "qualifying `SubagentStart` membership already recorded in owner-scoped hook state", but no such record existed (spec §3: the hookstate discards `agent_id`). It was first added as a `joined` key of `$REG/<id>.hookstate.json`; review measured that key losing 20-37% of joins to concurrent hooks, because every event rewrites hookstate whole, and each lost join turns a subagent's later events into a phantom main-thread `working`. Membership therefore lives in its own owner-scoped, dot-free per-session field, `$REG/<id>.joined` (one raw agent id per line, appended with one O_APPEND write by the `SubagentStart` arm only, read with builtins by the turn-marker gate), rotated past 128 lines by an atomic rename to `$REG/<id>.joinedprev` under `flock -n` on the file's own inode plus an `-ef` re-check, so no append is ever dropped; the gate reads both. An id whose raw form is not 1-64 of `[A-Za-z0-9_-]` is unjoinable (fails toward the main turn). `$paid` keeps meaning "any non-empty `agent_id`" for its four other readers (consent 4691). Because an orphaned dot-free field holds a slug (`_ws_slug_free`), the hook re-checks `<id>.generation` after its write and `_reg_purge` removes both names once more after `generation` (one `rm` call: the purge's unlink count goes 28 -> 29 for the round that added the first name, and stays there). Commits `4f1f526ba`, `b273dbcb2`, `020ef29c5`, `5e7be1ac3`.
- **D-4635** — `read-range-bound-is-one-shared-predicate` (Task 4): the plan fixes the new spool reader's `maxBytes` range as `1..262144` but names no validator. `shared/agent-protocol.ts` gains `READ_FROM_MAX_BYTES` (262144) and `isReadFromRange()`, used by the agent and by both server adapters, so the three agree on one predicate. The agent answers `bad-request` to an out-of-range request only when `maxBytes` is present (an old caller omitting it is unchanged); both server adapters answer `unreadable` before touching disk or wire. Later tasks import the constant and never restate 262144. Commit `1c69ba336`.
- **D-4636** — `readdir-non-string-entry-is-malformed` (Task 4): the remote `readdirMeasured` reads a `names` array holding any non-string as malformed (`unreadable`), per the plan's "malformed response is unreadable"; the derived compatibility `readdir` therefore answers `null` for that shape, where it used to return the array cast to `string[]` (a type lie). No real agent produces it (`fs.readdir` yields strings and JSON keeps them), so no old caller can observe the change. Commit `1c69ba336`.
- **D-4637** — `dead-owner-spool-buckets-persist` (Task 5): the hook prunes only its OWN live owner's buckets older than 24 h (spec §5.3, W3-M06 forbids it removing anything outside its own spool directory), and ccd only creates `$REG/delegation/spool/<id>/`; nothing in wave 3 removes it. So a removed owner, or one whose session never runs again, keeps its last 24-25 hourly buckets for good, and the Rollout's "hooks retain only their own 24-hour buckets" holds for live owners only. Measured size: a delegation-class Bash call writes about 1.1 KB of spool (540 B PreToolUse + 563 B PostToolUse at real path lengths); the busiest transcript hours run 140-262 delegation-class calls an hour, so about 165-290 KB an hour, about 0.66 MB stranded for a 4-hour worker and up to about 7.2 MB for 25 hours at peak. These are LOWER bounds: the rate counts each parent transcript's own calls, while an owner's spool also receives its subagents' tool events (about 1.2 KB per subagent Bash call), so a subagent-driven worker strands more. The total grows with workspace churn, without bound. Wave 3 adds no deletion (coordinator ruling, mail 4947): removing the directory in `_reg_purge` would trade un-ingested evidence (a dead session's `SessionEnd` included) against growth, a tradeoff nobody has ruled on. Owner: delegation-broker wave 4 (operator ruling 2026-10-14): a ccd prune of absent-owner spool directories whose newest bucket is over 24 h old (escalated by the coordinator, mail 4946; ruling relayed in mail 4964). Commits `e0cbd11cb`, `8453b53e1` (the comments and the report state what persists; no test pins the gap).
- **D-4638** — `caps-census-test-outside-task-file-list` (Task 5): advertising `delegation-events-v1` in `cmd_caps` reds `server/test/ccd-archive.test.ts`'s exact-equality capability census, which the plan's Task 5 file list does not name; the census gained the token (three lines, no other change). Commit `e0cbd11cb`.
- **D-4639** — `fixture-census-owner-created-and-q6-unmeasured` (Task 6): Step 4 names `server/test/delegation-fixtures.test.ts` (W3-M73's owner) and `server/test/public-content.test.ts`; neither existed and the File Map creates neither. `delegation-fixtures.test.ts` was created as the current-lane census: a committed current-lane list measured on 2026-10-14 from the fleet's running session executables (2.1.291, 2.1.296, 2.1.299), every rig scenario covered per lane, corpus versions equal the matrix's, and the matrix's unmeasured cells equal an explicit expected list. "Public content" is the repository's existing guards: `topology-clean`, `source-bytes`, `gitignore-secrets` and the sanitiser's `--scan`. The `--missing` capture (2.1.294, 2.1.295, 2.1.296, 2.1.299; run from a snapshot of `19c74281e`, no constituent failure, no residue) measured 53 of 56 new cells: `interrupt-exit` (spec §8.1 Q6, exit with a background agent) is `unmeasured` on 2.1.295, 2.1.296 and 2.1.299 (`waitLabels ["sub-hang","main-hang"]: timeout`; the mock never saw the main thread's post-launch call), recorded as unmeasured, never as absence, and listed in the census so a change reds. No parser or correlation may rely on that scenario's shape for those versions. Fixing the scenario and mock for 2.1.295+ is a rig follow-up outside this wave's files. Commit `85384c207`.
- **D-4640** — `projection-upserts-sessions-and-never-inserts-events` (Task 7): the projection paragraph under the migration DDL prescribes a whole replacement that deletes and re-inserts `delegation_events` in a fixed order, but `DelegationCheckpointV1` carries no events. A literal replacement therefore either drops every event or must read every event back and re-insert it, which is synchronous O(events) work on each projection (measured 4.4 s at 100,000 events). `projectDelegationCheckpoint` instead runs one transaction with foreign keys on (asserted before BEGIN). The leaving sessions are those in SQLite but not in the checkpoint. It deletes lineage and leases, then only the leaving sessions' events (by index), then attempts and activities, then the leaving sessions. It upserts the checkpoint's sessions and inserts its activities, attempts, leases and lineage. It never inserts an event. Events reach SQLite only from the journal, through `insertDelegationEvent` or the batch `insertDelegationEvents`, which runs one transaction and reports conflicts rather than throwing. A checkpoint that repeats a session key is refused before BEGIN. Measured: 18 ms at 100,000 events when no session leaves, and 360 ms for a leaving session with 5,000 events (about 70–85 µs per event). Wave 3 never removes a session from the checkpoint (Task 8 pins this), so a leaving session arises only when the repair heals a drifted session. W3-M72 keeps its intent: FK-safe dependency order and a full rollback at every statement fault. It adds a mutant that deletes leaving sessions before their events, and a row proving that a projection over a large events table touches no event row of a staying session. Commits `ec00a2cbe`, `2388d04b5`.
- **D-4641** — `an-empty-snapshot-never-evicts-the-newest-data-bearing-one` (Task 8): Step 6 keeps "the newest valid pre-operation coordination snapshot", and the manifest contract makes a nothing-present snapshot a valid v1 (every member `present:false`, delegation `absent`). Read literally, a backup taken after `coord.db` was lost would take that slot and let the older snapshot that holds data age out past `CCRC_BACKUP_KEEP`. That older snapshot is the only remaining copy of what `coord.db` adds over the flat files. Restoring the newer one would also remove the live DB, through its explicit absent-DB acknowledgement. `_bak_gc` therefore keeps a fifth independent set: the newest valid pre-operation snapshot that holds data (a `v1` with at least one member present, or a `legacy` dir). Both pruners skip it. `coordination-snapshot.mjs validate` prints a second line, `data: yes|no`; the four classifier words and their exits are unchanged. The coordinator licensed this reading because it deletes less (mail 5088). Letting an empty snapshot evict the data-bearing one would need an operator ruling. A mutant that drops the fifth set reds the keep rows in `ccrc-update.test.ts`. Commit `e07f315b6`.
- **D-4642** — `a-torn-journal-blocks-capture-and-every-caller` (Task 8): Steps 5 and 8 make capture validate the live journal and checkpoint, and make `_upd_backup` and the fallback deploy continue only after a durable manifest. Task 8's recovery fails closed on a torn tail and never truncates the journal (W3-M22, W3-M38). Together, once a crash leaves the journal torn, that box can take no `ccrc backup`, no `ccrc update` and no fallback deploy until someone edits `~/.ccrc` by hand, and that includes the release that might repair it. Wave 3 accepts this and adds no override, because an override would change the O3 backup contract, which needs an operator ruling. The coordinator has put a typed as-found capture escape to the operator (mail 5090). The README's backup paragraph states the refusal. Commits `a0c385acc`, `e07f315b6`. **Superseded by D-4655** (the operator's ruling of 2026-10-15, coordinator mail 5246): a torn tail now heals itself, and capture keeps the complete prefix.
- **D-4643** — `restore-measures-the-service-through-systemd-only` (Task 8): Step 7 requires the service "stopped and measured inactive". The helper measures it with `systemctl --user is-active` and treats only `inactive` or `failed` as stopped. Any other word, a missing `systemctl`, a signal or the 10 s timeout is unmeasured, and the restore refuses. So a macOS (launchd) server box can never restore in wave 3. That is the fail-closed direction the ruling chose (unmeasurable refuses, W3-M34). A `launchctl print` probe is a follow-up. The helper also probes again once the restore marker is durable, and the verb takes `~/.ccrc/update.lock` for `restore` and `recover`. Commits `a0c385acc`, `e07f315b6`.
- **D-4644** — `red-first-observed-by-mutants-for-two-caller-files` (Task 8): the Global Constraints require red-first. For `coordination-snapshot`, `delegation-recovery` and `install-census`, Task 8's second half recorded RED before implementing. It first ran `ccrc-update.test.ts` and `agent/test/deploy-verify.test.ts` only after the implementation existed. For those two files the evidence is the mutation record:
  - `deploy-verify`: W3-M32, 1 failed.
  - `ccrc-update`: W3-M28, 6 failed (14 after the fix round); W3-M31, 4 failed; W3-M39a–d, 2/2/2/1 failed (3/3/3/5 after the fix round); plus the fix round's mutants for the classifier pairs, exit 70, the fifth keep set and the `_upd_backup` order (capture before `_upd_backup_set`: 1 failed).

  This shows each row can fail. It does not show that each row failed for the intended reason before the code existed. Commits `a0c385acc`, `e07f315b6`.
- **D-4645** — `bucket-durability-is-async` (Task 9): the plan fixes `DelegationBucketDurability.applyBucketResult(result): DelegationRecoveryState` and a synchronous `ingestAndApplyDelegationBucket`. Task 8's applier does file IO through one promise-chain queue: journal append and fsync, then the checkpoint's temp write, fsync, rename and directory fsync. So both are declared `Promise<DelegationRecoveryState>`. The pure `ingestDelegationBucket` stays synchronous and IO-free, and `CoordStore` is untouched. Commit `d101d1da9`.
- **D-4646** — `bucket-results-carry-entries-not-records` (Task 9): this departure has five parts.
  - **Entries, not records.** `DelegationBucketResult.accepted` carries `{entry: {kind:'evidence-accepted', event}}`, not `DelegationJournalRecordV1`. A record's sequence, `previousDigest`, `journalId`, `digest` and `acceptedAt` can be assigned only by the serialized applier under its lock: O1 lets no ID escape before durability, and no pure code reads a clock. `result.accepted[i].entry.event` reads as it would on a record.
  - **The input state.** `DelegationBucketResult.state` is the input state, unchanged, because the next state is built under the applier's lock.
  - **`endOffset`.** It is the offset just past the line's LF. Every journaled `eventId` now bakes that in.
  - **Three added exports.** `readDelegationBucket`, `unreadableDelegationBucketResult` and `delegationBucketDurabilityOf` exist because `DelegationBucketInput` cannot express a failed read. Reader failures keep these reasons apart: absent, unreadable, capability absent, capability unmeasured, and vanished-unread.
  - **`applicable`.** A required `applicable: boolean` on the result is false exactly for `input-invalid`. Both the adapter and the durability door refuse such a result before building anything, under one owner rule shared with the reader.

  Commits `d101d1da9`, `9f86b3318`, `7ef520188`.
- **D-4647** — `a-cursor-anchors-its-last-accepted-line` (Task 9): the vocabulary says "a bucket that shrinks or changes bytes before an already accepted offset is an unmeasured replacement". The fixed `DelegationBucketCursor` carries no content anchor, so it cannot detect this: a same-size rewrite in place, or a cut that regrows past the old size, reads as a clean measured read.
  - **The anchor.** The cursor gains `anchor: {start, sha256} | null`. That is the start offset and SHA-256 (LF excluded) of the last complete line stepped over, accepted or refused, so the anchor always ends at the cursor.
  - **The `replaced` flag.** The cursor also gains a structured, sticky `replaced: boolean`.
  - **How a read checks it.** Every read starts at `anchor.start` (input field `readStart`, request field `anchorStart`) and re-reads that one line. It must find exactly one complete line ending at the cursor with the same hash. Otherwise the bucket is replaced: it is unmeasured and accepts nothing, from then on.
  - **A cut below the cursor.** Both IO adapters answer a range read past the size as unreadable, so a cut below the cursor reaches ingestion through a `statMeasured` fallback.
  - **The applier.** It ORs `replaced` with the durable row's.
  - **Non-sticky gaps.** These keep a wrong window and an unprovable cursor apart from a replacement:
    - `read-window-mismatch`;
    - `cursor-unanchored`;
    - `window-starved`.
  - **A vanished bucket.** A listed bucket that answers ENOENT before it was read to its end is `bucket-vanished-unread`.
  - **Known limit: earlier lines.** The anchor proves the last line only. A change to an earlier line that keeps every later byte in place is invisible; a row pins this. Such a change needs a foreign writer, because the hook appends with `O_APPEND` and prunes whole buckets.
  - **Known limit: short refused lines.** A short refused line, such as a blank line, is weak evidence, but it falls inside an hour that is already unmeasured.

  The checkpoint stays `v1`, because no cursor has shipped. Commits `9f86b3318`, `7ef520188`.
- **D-4648** — `the-fold-opens-workflow-runs-and-bash-worktrees-itself` (Task 11): the plan has Task 11 consume Task 7's rows and stay pure. Opening Workflow and raw-worktree activities, though, needed the checkpoint fold's own join reading (`namedAgentsOf`/`foldEvidence`), which Task 8 had built for agents only. That reading was extended in place:
  - `namedAgentsOf` became `DelegationNamedUpstream {sourceKind, upstreamId, join, ends}`. A listing-carrying Bash call opens a `bash-worktree` activity on its `tool_use_id`.
  - A Workflow launch response is the run's qualifying join. The run opens as an ordinary activity row (`sourceKind:'workflow'`, `upstreamId` = the run id) with a natural-key mapping. No identity-candidate hold remains, so a launch never pins journal pruning; an unconsumed candidate would have pinned it for good.
  - Workers open through a new non-durable builder door, `openWorkflowWorkerFromMeta`. It derives each worker's identity from the run's checkpointed row and refuses a worker index that is not a non-negative safe integer. Its durable wrapper (the `applyPositiveAgentMeta` shape, with its own O1 row) is Task 13's. Until then rung 2 answers `unmeasured` for `wf_*` in production.
  - The fold's join set widened without a checkpoint version change. A pre-Task-11 wave-3 checkpoint whose covered range holds a listing-carrying Bash record or a Workflow launch as an unmapped candidate would be refused on recovery (`fold-refused`). No wave-3 checkpoint has shipped.

  Commits `1f637853c`, `21fcb2343`.
- **D-4649** — `a-truncated-pre-tool-use-leaves-identity-to-its-post` (Task 11): spec §5.2 takes a `tool_use_id` activity's identity from "the first event naming the upstream id". A Bash PreToolUse whose `listing` was dropped by truncation is skipped as a naming record, so when its PostToolUse carries a listing, the PostToolUse is the identity record. A listing-less Bash call must not become an identity candidate that holds the journal, and most Bash calls carry no worktree listing at all. Commits `1f637853c`, `21fcb2343`.
- **D-4650** — `reconciliation-input-names-its-census-and-pairs-verdicts` (Task 12): the plan's `DelegationReconciliationInput` carries `correlations: readonly DelegationCorrelationVerdict[]` beside `census`, paired by position, and does not say which projects were censused. Two defects follow.
  - A verdict could be applied to the wrong tree after any reordering or filtering.
  - A held tree in a project whose census failed or was never taken read as `record-measured-absence`.

  So the input now carries:
  - `correlations: readonly { record, verdict }[]`, one pair per verdict. A pair whose record is not in `census` (matched by `project` + `adminRecord`) is `bad-row`.
  - `censusedProjects`, plus `previousCensusedProjects` for `previousSuccessfulCensus`.

  `record-measured-absence` is emitted only for a held tree whose project was censused in BOTH passes and whose record is absent from both. The caller (Task 13) builds the pairs in one expression from the census and leaves a project with no census view out of `censusedProjects`. Commit `83f53f51a`.
- **D-4651** — `a-missing-spool-dir-is-a-warn-until-the-next-spawn` (Task 14): the plan and Task 14's context classify a missing owner spool directory as a defect, with a remedy pointing at supported ccrc operations. But ccd creates `$REG/delegation/spool/<id>/` only at spawn (`_spawn_start`), and a supervisor restart leaves a live pane alone (`KillMode=process`; `cmd_ensure`'s `_alive` arm). So right after the rollout, every running session predates the directory. A FAIL there would turn every fleet-box `ccrc update` into exit 3 (D-3114), with no remedy that works.

  So `delegation-hooks` answers **WARN** for a running session whose owner directory is absent. The detail says the session is not yet observed and its directory arrives at its next spawn. The remedy says:
  - nothing is lost by waiting;
  - to observe it now, run `ccd stop <id>` then `ccd start <id>`, which resumes the conversation but ends an in-flight turn.

  Every other defect stays **FAIL**, and a WARN never hides a FAIL. The FAIL cases are:
  - a directory that exists but is unreadable;
  - a spool root that is a symlink or unsearchable, even with no session running;
  - a missing or unreadable registration;
  - an unreadable roster or home.

  Doctor creates no spool directory. W3-M74's row for this input pins WARN, and mutants to PASS and to FAIL both go red. Task 13's health arithmetic keeps an hour from a session with no owner directory UNMEASURED, never measured-empty.

  Basis (coordinator mail 5157):
  - spec §9's doctor bullet does not fix the class;
  - the plan's Rollout step 3 requires "unavailable, not healthy", which WARN meets;
  - spec §5.3 creates the directory only at spawn, and the hook skips when it is missing;
  - the D-3114 exit-3 hazard;
  - no O1–O5 decision is touched.

  Commits `e8ce55f27` (doctor) and `739735f38` (health).
- **D-4652** — `the-lane-reads-retained-evidence-through-the-applier` (Task 13): the plan fixes `DelegationDurability`'s doors, and none lets the watcher lane read retained journal evidence. Its correlation needs that evidence after a restart, and no other production source may name the journal file. So `DelegationDurability` gains one read-only door, `visitRetainedRecords(visit)`. Within the coordinator's bounds (mail 5213 (a)):
  - it enqueues on the applier's own serialized queue, so it never reads a half-appended record and never races a prune;
  - it calls `requireReady()`;
  - it opens no write, rename or truncate target, so Task 8 Step 4's pin stays green, and `delegation-events.log` is still named only inside the durability adapter;
  - a read or validation failure DURING a visit folds the lane to unmeasured, and partial evidence never reaches correlation (D-4008);
  - retained records before `appliedJournalSequence` take part only where the checkpoint lacks the activity, and ids already mapped are used verbatim.

  Rows pin the serialization and the mid-visit failure. Commits `739735f38`, `6dcc8b2ec`.
- **D-4653** — `an-evicted-event-never-decides-a-link` (Task 13): spec §5.3 says a lost event can delay or prevent a link, never create one. The lane holds evidence in memory under a cap, and at a restart `loadEvidence` truncates the whole journal to that cap. Rung 4's overlap rule, and the vetoes of rungs 2 and 3, are NEGATIVE evidence. So eviction could turn an unresolved tree into a permanent `lease-created`. The plan's `DelegationCorrelationInput` has no field that can say this. The fix, built over five review rounds:
  - **Rung 4.** The input gains an evidence horizon. Rung 4 answers `unmeasured('evidence-horizon')` when any same-repository window is open-ended or starts at or before the horizon, or the candidate starts within a 20-minute inclusive margin of it. The margin assumes Bash calls stay within Claude Code's maximum Bash timeout, which `BASH_MAX_TIMEOUT_MS` can raise. A new reason, `evidence-horizon`, joins `DELEGATION_CORRELATION_REASONS`, and policy's total table maps it to not-work.
  - **Rungs 2 and 3.** The lane keeps a dropped-evidence index: distinct keys of every dropped event, including the tuple-mates of an evicted event. A rung-2 or rung-3 link of activity A (parent p, upstream X) at path C answers `unmeasured('evidence-horizon')` if a dropped event either:
    - (a) names X from a parent other than p; or
    - (b) has cwd C and either carries no `agentId` and comes from p, or carries another `agentId` and is not a SubagentStart/Stop.

    `combine` never lets a link beat an `evidence-horizon` answer.
  - **A lost index is not an empty one.** The index is unmeasured until `loadEvidence` has re-streamed the whole retained journal, and every rung-2/3 link (rung 4 too) answers unmeasured until then (D-4008, coordinator mail 5354).
  - **Pruning, rulings R69–R71 and R73–R75.** A key is forgotten only when a census of its project, measured in the same pass, shows every tree it could veto is gone. Otherwise it is replaced by a coarser mark that still forces unmeasured:
    - a 64-bit hash of a forgotten cwd path;
    - a 64-bit hash of a forgotten upstream id;
    - a lost project, at a per-project held-key cap or a mark-set overflow;
    - one global flag, only for marks attributable to no project that exceed the cap.

    Further rules:
    - a transient null-path diagnostic holds only its own project, for at most 3 passes over 10 minutes; a standing one never holds;
    - `refused-project` counts as measured-with-no-trees;
    - `not-a-checkout` counts only after 3 consecutive passes spanning at least 10 minutes;
    - after a restart, remembered paths are seeded from the checkpoint's leases and attempts, and each project waits until it is re-measured.
  - **Liveness (coordinator mail 5406).** Marks last until a restart, whose `loadEvidence` rebuilds the exact keys, because wave 3 never compacts the journal. A mark set for a tree that stays alive therefore keeps that tree's rung-2 and rung-3 links unmeasured until the next restart. An hourly `ccrc-server:` warn line counts, per mark kind, the links each forced to unmeasured. It also names blocked and lost projects and the global flag.
  - **Bounds.** The index and marks live in lane memory only: no file, no SQLite-only state, journal untouched (mails 5213, 5354). Wave 4's journal compaction is what makes marks finite.

  Commits `6dcc8b2ec`, `4f89ae867`, `90c573042`, `46c5ec4bf`, `c689445e2`.
- **D-4654** — `bucket-cursors-retire-past-the-read-horizon` (Task 13): spec §5.3 keeps spool buckets 24 h and gives the server one cursor per (session, bucket). The plan keeps cursors checkpoint-only and sets no retention, so cursor rows grew without bound, and every application rewrites the whole checkpoint. Measured at 20 owners: 166 ms per application at the new retention, against 774 ms with 30 days of cursors.
  - `delegation-model.ts` gains `DELEGATION_CURSOR_RETENTION_HOURS = DELEGATION_SPOOL_LOOKBACK_HOURS + 24` (48 h), a pure `delegationBucketReadable`, and a pure `planDelegationCursorRetention(cursors, intervals, nowMs)`.
  - The lane reads no bucket past the 24 h lookback. `DelegationDurability.pruneBucketCursors(nowMs)` drops, under the applier's own lock and through the normal checkpoint application, only cursors whose interval row is already recorded and whose hour is past 48 h. It runs at most once per UTC hour, and a failed prune retries hourly too.

  It stays within the coordinator's bounds (mail 5213 (b)):
  - no new file, no SQLite-only state, no journal change;
  - a relisted bucket is never read as new evidence, because the read horizon forbids it and eventIds dedupe against the retained journal;
  - intervals and the health arithmetic are identical across a prune. `lastCheckpointRevision` moves by +1 as replacement metadata (mail 5354).

  Commits `6dcc8b2ec`, `4f89ae867`.
- **D-4655** — `a-torn-journal-tail-heals-itself` (Task 8C; the operator's ruling of 2026-10-15, coordinator mail 5246; supersedes D-4642): a crash or failed write in the middle of an append leaves at most one partial line after the last LF, and nothing refers to it. Under O5 a record is applied only after the journal fsync, the checkpoint is replaced only after that, and the bucket cursor still points before its spool line. So the next pass reads the line again and mints the same eventId.
  - **What is healable.** A tail is HEALABLE iff all of these hold:
    - the journal ends in bytes after its last LF;
    - every complete record validates, with an intact chain;
    - the checkpoint's applied position names a complete record, or none.

    `missing-final-lf` is healable unless the checkpoint names that record. Everything else stays fail-closed.
  - **The server heals.** Recovery classifies a healable tail as a successful recovery that carries a heal plan. `DelegationDurability` then, inside its serialized queue and before any append:
    - keeps the bytes in `delegation-events.torn/<offset>-<sha256>.tail` (temp write, fsync, rename, directory fsyncs);
    - cuts the journal to the end of the last complete record;
    - fsyncs the journal and its directory.

    A crash at any step re-heals the same way, with no duplicate. This is the ONE named exception to Task 8 Step 4's no-truncate pin, W3-M22 and W3-M38.
  - **Capture never writes the journal.** Its last attempt copies the complete prefix and the checkpoint, and adds the additive field `delegation.journalTailOmitted {bytes, sha256}` to the version-1 manifest. It prints one warning line on stderr, which `ccrc backup`, `ccrc update` and `deploy.sh` pass through. The restore classifier accepts the field, and such a snapshot restores as a valid pair.
  - **Surfaces.**
    - The server: a `console.warn('ccrc-server: …')` line, plus `/api/fleet/health`'s `delegation.lastTailHeal {at, bytes, quarantinePath}`. That one is in memory, the heal is never a failure, and it never makes health unmeasured.
    - Capture: the stderr line, plus the manifest field.
  - **#384.** Its `collect-lane-generation.log` is never captured, restored or quarantined, and a row pins it.

  Commit `3075c75ff`.
- **D-4656** — `the-intent-door-is-exempt-like-the-claim-lanes` (Task 15): plan Task 15 Step 3 calls `POST /api/coordinators/:id/intent` "box-token gated and session-gated when auth is armed". The spec's route table gives it the credential "box token" and the check "caller is :id". Its census column calls it a box-token lane outside `/api/mail*` and `/api/runs*`, with an `auth/gate.ts` EXEMPT entry that carries a reason. Its only caller is a cookieless fleet session using `ccrc-api`, so session-gating it when armed would make it unreachable whenever auth is armed. On main, every lane such a session writes is EXEMPT, with the box token checked in the route:
  - the claim lanes;
  - the ask answer/release pair;
  - the ledger allocator.

  The plan is therefore corrected to the spec's row (coordinator mail 5354). The route checks, in order:
  1. configured;
  2. box token;
  3. closed body;
  4. `byId === :session`;
  5. attribution;
  6. current incarnation;
  7. serialized checkpoint mutation;
  8. projection.

  The route parameter is spelled `:session`, because `routes.test.ts` integer-parses every `:id` in `coord/routes.ts`. The EXEMPT table, CLAUDE.md and the census all key on that pattern. Task 15's review confirmed all four of these:
  - an armed gate passes only this exact (POST, pattern) pair;
  - a missing or wrong token is refused before any state is touched;
  - a session sets or clears only its own intent;
  - the door is in neither UNGATED nor SESSION_ONLY.

  Commits `ab01f78c8`, `69b605cf4`.
- **D-4657** — `w3-m18c-is-owned-by-the-census-and-the-model-table` (Task 16): the Mutation Matrix names W3-M18C's red owner as `delegation-policy.test.ts`'s "inert-future-fields table", and no such table exists. No mutant had been recorded against W3-M18C until Task 16. Its two halves are owned instead by two pieces that already exist:
  - **Transition:** Task 16's closed scope census row in `server/test/delegation-wave3.integration.test.ts`. Its mutants C7 (a static `UPDATE` of the lease table) and C8 (the generation guard removed) go red. So do R9a and R9b (each door's guard removed) and R4a and R4b (a replay builder writing `disposition:'retained'`, or populating `retainedAt`).
  - **Populate:** `delegation-model.test.ts`'s `assertWave3Lease` table.

  The plan's owner text is corrected here; no code moved. Commits `91545846a`, `70310e6e3`.
- **D-4658** — `one-durable-application-per-pass` (final review I-2; ruling R79, coordinator mail 5443; R82): the plan's lane applies each bucket's result as its own durable application. Every application re-encodes the whole checkpoint, compares it twice, and re-projects every activity and attempt, so the cost of one pass grew with every owner and every day of retained evidence. Measured with the real applier and store, a pass of 20 bucket results took 8.1–9.1 s of synchronous work at the day-7 size (8,400 activities, a 4.4 MB checkpoint), and 40–44 s at the day-30 size, past the 45 s pass budget.
  - **The door.** `DelegationDurability` gains `applyAcceptedBatch(batches)`, in `applyAccepted`'s shape and with one body (`acceptLocked`) for both. The lane stages each bucket's result during a pass and applies them once, at the end of the pass, and also after a cut, for the reads answered before it. The seam `unbatched` keeps the old path as the equality reference.
  - **O5 is unchanged.** Every accepted record of every batch is appended in the order given. Each record is fsynced BEFORE the next is appended, so only the application's last record can tear, and the heal rule (D-4655, bytes after the last LF) still holds. A damaged record before the last is corruption and fails closed. Then ONE checkpoint replacement carries every cursor and interval, in order, through `setCursor` and `mergeInterval`. Then ONE projection.
  - **Recovery.** A crash after k > 1 appended and fsynced records, before the checkpoint rename or between two record fsyncs, recovers to the same state and projection as k unbatched applications would.
  - **The compare is skipped only when the applied position moved.** The two canonical encodings exist to stop a no-op from writing, projecting and spending a revision; a no-op is a re-applied bucket whose events all dedupe. An application whose built state has a different applied journal position from the prior state cannot be a no-op. So the compare is skipped exactly then, as read from the two MEASURED states, never from the items the caller handed over, which may all dedupe. A skip can only lead to a write. A row pins three cases:
    - a deduped re-application writes nothing;
    - a removal without an append is written;
    - a deduped re-application that moves a cursor is written.
  - **A refusal stays per bucket (R82; found by an automated security review of the first batching commit).** Before R82, one result refused before the write would have refused the whole batch on every pass: no owner's cursor or interval would advance, and every owner's buckets would age out unread. Unbatched, only that bucket was refused. The lane now tells the two failures apart by the applier's own state, never by an error's words. A refusal before the first byte leaves the applier ready. On such a refusal the lane bisects the staged list until the refusing result stands alone, and every other result becomes durable in that same pass. The refused result gets its own warn line, and no cursor, interval or settle key. A refused bucket is remembered in lane memory for this process only, and on later passes it is applied alone, first, with the rest as one application. So a standing refusal costs at most one more application a pass (about 0 to 0.15 s at the day-7 size). The first pass of a new refusal costs one bisection (about 2.1 s of blocking work at the day-7 size for 20 results), paid once per process. The checks that can refuse before the write are the checkpoint's `readCursor` and `readInterval`, the journal's `validateEntry`, and the fold, `mergeInterval` and `build()`. Ingestion builds every result inside those shapes, so no spool content is known to reach one; the isolation exists because the applier re-validates on its own. A failure after the first byte still fails the applier closed and stops the whole pass.
  - **Cost after batching** (condition 5, box load 17–33):
    - day 7: 0.44–0.53 s synchronous for a pass of 20 results, with the longest block about 0.2 s. The reconcile's projection repair adds 0.20–0.22 s, for about 0.7 s a minute.
    - day 30: about 2.1–2.2 s, plus about 1 s for the repair.
    - a per-record fsync: 6.6–8.4 ms of IO wait.

    One checkpoint encode, build and projection per pass, and the repair, remain linear in retained evidence. Wave 4's journal compaction is what bounds them.
  - **Bounds:** no new file, no SQLite-only state, no snapshot or journal-format change, and no O5 order change.

  Rows cover crashes after k records, an input-invalid result in the middle of a batch, per-bucket cursors and `replaced`, the compare, the refusal isolation, and the realistic pass (1 application, 1 checkpoint replacement, 1 projection, 1 repair). Commits `4690b2537`, `8e55d7241`.
