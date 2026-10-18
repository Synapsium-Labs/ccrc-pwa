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
    - The server: a `console.warn('ccrc-server: …')` line, plus `/api/fleet/health`'s `delegation.lastTailHeal {at, bytes, quarantinePath}`. A heal is never a failure, and it never makes health unmeasured.
    - Capture: the stderr line, plus the manifest field.
  - **#384.** Its `collect-lane-generation.log` is never captured, restored or quarantined, and a row pins it.

  Commit `3075c75ff`.

  **Amended after the held-out review of run 518 (F8; coordinator mails 5424, 5443 and 5504).** The server surface above is no longer "in memory". The quarantine directory `delegation-events.torn/` is read at every boot and every recovery, after any heal (`reportQuarantineLocked`, `server/src/coord/delegation-checkpoint.ts`). Two additive, optional fields carry what that read finds. Mail 5504 licensed both as D-4655's own surface, with no `FLEET_PROTO` change:
  - **`foundAtBoot?: true` on `DelegationTailHeal`** (`shared/api.ts`). The read writes nothing, so no "reported" marker exists. A quarantined tail that no report of this process covers sets `lastTailHeal` at every boot, with the file's own modification time as `at` and its size as `bytes`, until an operator removes the file. The newest such file wins, unless this process reported a later heal itself. The field is absent for a heal this process made and reported.
  - **`tailQuarantineUnmeasured?: true` on `DelegationObservationHealth`** (`shared/api.ts`). A quarantine directory that cannot be listed, a file in it that cannot be stat'ed, or a file whose time is no instant sets it. It is added to the member after the health is computed (`DelegationLane.health`, `server/src/watch.ts`), so it never moves `stageGate`, `circuitBreaker` or `unmeasuredRate`: it marks the heal REPORT unmeasured, not the health. An unlistable quarantine is no heal, so `lastTailHeal` stays absent for it.
  - **Readers.** `server/src/server.ts` passes the member through to `/api/fleet/health`. No PWA, ui, agent or ccd code names either field. A wave-4 reader must read their absence as "not reported", never as "measured clean".
  - **Rows.** In `delegation-recovery.test.ts`, "MUST 1: killed between the cut and the report, the NEXT boot reports the heal from the quarantine" and "MUST 1: every boot reports the newest quarantined tail again until it is removed" assert `foundAtBoot: true` and go red when it stops being set. "MUST 1: a quarantine that cannot be listed is UNMEASURED, never \"no heal\"" pins `tailQuarantineUnmeasured` at the durability level. In `delegation-watch.test.ts`, "MUST 1: a heal no report of this process covers … is on the health" pins `foundAtBoot` through the lane. The R86 row, "MUST 1: an unlistable quarantine is on the health as tailQuarantineUnmeasured, and the health's own verdict is unchanged by it", pins the second field and that every other member equals a run whose quarantine could be listed. In `fleet-health.test.ts`, "a healed torn journal tail (D-4655)" pins that `lastTailHeal` reaches `/api/fleet/health` and, through its exact key list, that `tailQuarantineUnmeasured` is absent when the quarantine listed. No `fleet-health` row sets `foundAtBoot` or `tailQuarantineUnmeasured`.

  Commits `4690b2537` (the boot report and both fields) and `6a4e7d7ee` (the R86 row).
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
  - **Recovery.** Suppose a crash comes after k > 1 records were appended and fsynced, either before the checkpoint rename or between two record fsyncs. Recovery replays every one of those records, and the crash loses only the batch's cursors and intervals. The next pass re-reads those buckets, and the eventIds dedupe what the journal already holds. After that re-read, the state and projection equal those of k unbatched applications. That equality is what the crash rows prove.
  - **The compare is skipped only when the applied position moved.** The two canonical encodings exist to stop a no-op from writing, projecting and spending a revision; a no-op is a re-applied bucket whose events all dedupe. An application whose built state has a different applied journal position from the prior state cannot be a no-op. So the compare is skipped exactly then, as read from the two MEASURED states, never from the items the caller handed over, which may all dedupe. A skip can only lead to a write. A row pins three cases:
    - a deduped re-application writes nothing;
    - a removal without an append is written;
    - a deduped re-application that moves a cursor is written.
  - **A refusal stays per bucket (R82; found by an automated security review of the first batching commit).** Before R82, one result refused before the write would have refused the whole batch on every pass: no owner's cursor or interval would advance, and every owner's buckets would age out unread. Unbatched, only that bucket was refused. The lane now tells the two failures apart by the applier's own state, never by an error's words. A refusal before the first byte leaves the applier ready. On such a refusal the lane bisects the staged list until the refusing result stands alone, and every other result becomes durable in that same pass. The refused result gets its own warn line, and no cursor, interval or settle key. A refused bucket is remembered in lane memory for this process only, and on later passes it is applied alone, first, with the rest as one application. So a standing refusal costs at most one more application a pass (about 0 to 0.15 s at the day-7 size). The first pass of a new refusal costs one bisection (about 2.1 s of blocking work at the day-7 size for 20 results), paid once per process. The checks that can refuse before the write are the checkpoint's `readCursor` and `readInterval`, the journal's `validateEntry`, and the fold, `mergeInterval` and `build()`. Ingestion builds every result inside those shapes, so no spool content is known to reach one; the isolation exists because the applier re-validates on its own. A failure after the first byte still fails the applier closed and stops the whole pass. A remembered refusal is forgotten once it applies, or once its bucket's hour passes the read horizon, so the memory is bounded (R85, `f92bc4bc3`).
  - **Cost after batching** (condition 5, box load 17–33):
    - day 7: 0.44–0.53 s synchronous for a pass of 20 results, with the longest block about 0.2 s. The reconcile's projection repair adds 0.20–0.22 s, for about 0.7 s a minute.
    - day 30: about 2.1–2.2 s, plus about 1 s for the repair.
    - a per-record fsync: 6.6–8.4 ms of IO wait.

    One checkpoint encode, build and projection per pass, and the repair, remain linear in retained evidence. Wave 4's journal compaction is what bounds them.
  - **Bounds:** no new file, no SQLite-only state, no snapshot or journal-format change, and no O5 order change.

  Rows cover crashes after k records, an input-invalid result in the middle of a batch, per-bucket cursors and `replaced`, the compare, the refusal isolation, and the realistic pass (1 application, 1 checkpoint replacement, 1 projection, 1 repair). Commits `4690b2537`, `8e55d7241`.
- **D-4659** — `lost-evidence-never-decides-a-link` (coordinator mails 5477, 5480 and 5484; ruling R84): spec §5.3 says a lost event can delay or prevent a link, never create one. D-4653 made that true for evicted events, but three other kinds of lost evidence could still decide a link:
  - a Bash listing the hook shed (`truncated:true` with no `listing`);
  - an hour recorded unmeasured;
  - a creator's window lost before rung 3 met it.

  A shed or lost-hour window beside another session's window still led to a rung-4 lease. A lost rung-4 creator turned a final rung-3/rung-4 conflict into a plain rung-3 link (X1). Measured by a read-only analysis with probes and mutants, then fixed. Every arm below moves toward unmeasured, and rung 4's positive rule is unchanged.

  The operator's ruling of 2026-10-16 stands beside this entry, and it is a ruling, not a deviation: rung-4 links are journaled during the soak, and the operator rules their treatment before wave 4 displays them.

  The changes:
  - **Lost windows.** A shed Bash Pre or Post makes a LOST window: from the shed Pre to its Post, or open-ended; a shed Post ends its Pre's window. Every unmeasured hour of any session makes a lost window `[hour, hour + 1 h + margin]` with no repository, because a lost hour cannot say which repository its events touched. A torn tail does the same, read from the cursor's detail and from the measured hour's detail. A retention floor covers hours already pruned. A lost window is never a candidate and never holds the horizon. One that may be on the repository and overlaps the single candidate answers `unmeasured('evidence-horizon')`; this applies to any session's window except the candidate's own call.
  - **The carve-out, a fold toward linking pinned like a guard.** These hours do not veto:
    - a `capability-absent` hour;
    - a `directory-absent` hour of an owner that never had a spool: no cursor row and no measured hour.

    Such a session is in the no-spool class carried to the operator, and rung 4 links across it. A vanished spool vetoes. A home with no hook registered still has its spool directory, because ccd makes it at spawn. Its hours are therefore measured-empty, and the carve-out does not reach them.
  - **The window's repository is also read from its cwd.** The cwd is attributed by the trees: every census canonical path and every remembered path, the nearest winning. The projects root is used too, but only when it resolved. The window's repository is null, meaning every repository, when the cwd is absent or unattributed, or when the Pre and Post cwds disagree.
  - **X1.** With no candidate, rung 4 answers `unmeasured('evidence-horizon')` when the horizon, or a lost window that may be on the repository, reaches the tree's birth bracket. The bracket is `[after − margin − skew, at + skew]`, from the last census of the project that did not list the tree to the first that did. `combine` lets this answer stop a link but never decide alone, so a tree with no evidence stays `unresolved`. The sighting bracket lives in lane memory. A restart empties it, so a tree first listed in the first census after a restart reads `(−∞, at]`, and its rung-3 link stays unmeasured until a measured census omits the tree and a later one lists it again (mail 5354: a lost instant is not an empty one).
  - **E2.** A same-session window that overlaps the candidate and whose added set contains the record is ambiguous ("one Bash tool call of S").
  - **A rung-1 answer after a lease.** A `ccd-workspace-not-a-lease` answer beside an unreleased lease files ONE final `conflicting` attempt under the lease's parent. The lease is untouched, because wave 3 journals no lease-level transition.
  - **Count.** The hourly `ccrc-server:` warn line counts trees held unmeasured by lost evidence, separately from the mark kinds.

  **Measured liveness cost:**
  - Six probe leases and one rung-3 link became unmeasured; one probe lease became unresolved (d).
  - The open-ended window a shed Post used to leave no longer blocks a later clean creation, which now links.
  - After every server restart, a pre-restart tree whose link would come from rung 3 with no rung-4 candidate is unmeasured for as long as it stays listed.
  - A tree whose creator call began at or before the latest ready instant (R88, below), or up to the 1-minute clock skew after it (R104), never links at rung 4. Through X1, a rung-3 link of a tree whose creator bracket reaches back to that window is held too. Measured: a tree whose last census that did not list it was taken at most 22 minutes after the instant (the 20-minute margin, the 1-minute skew of the bracket and the 1-minute skew of the window, R104) is held at rung 3 for as long as it stays listed in that process, and at 23 minutes it links (row "R88 through X1, measured"). The held-back count (the lost-evidence figures) rises after each restart and after each in-process recovery, because each moves the instant later.
  - A session with an unmeasured hour vetoes every repository's overlapping rung-4 candidates.
  - After a restart the ready instant is the boot recovery's return, the instant the first pass's applier answered (R113; R117 for a later pass awaiting it), not that pass's clock, so a recovery that replays a long journal holds every creator call made before it ended, plus the skew.
  - A cut pass's late return from the projects-root resolution after a newer pass has reached the owners moves the ready instant a second time (R114), so a creator call within the skew after the next pass's clock is held although its owners were all read. Making that arm conditional (marking only when no newer pass has reached the owners) was declined for this wave and is left for the operator to place.
  - A pass that runs while a recovery the lane started has not settled reads nothing: no owner, no reconcile, no instant. That includes the repair tail after `recover()` already reports `ready`. The first instant after the settle is no earlier than the settle (R116). After a cut recovery, on a forward clock, the instant is the setting pass's clock, which is later than the settle, and the clamp holds that stretch (R120): so a recovery that outlives its cut pass holds every creator call made before the first pass after it, plus the skew, and every owner's read waits for that pass. On the `appliedAt` arm the clamp holds more only after a backward wall-clock step (R115): the instant is then the setting pass's clock, not the earlier `appliedAt`.
  - **On the live path form:** in the captured corpus, 4 of 4 worktree-token windows came from a main checkout and match no tree while the projects root is unresolved, which in remote mode is always. The census lists linked worktrees only, never the main checkout. So on the live fleet every worktree-naming Bash call made from a main checkout counts for EVERY repository: it vetoes any candidate it overlaps, and an interrupted one (a Pre with no Post) holds every repository's later candidates until it leaves the evidence slice. Expect rung 4 to be largely unresolved or unmeasured live during the soak. The corpus cannot tell whether the hook's main-checkout cwd uses the symlinked or the resolved spelling, because the rig runs under a real temporary directory. Attributing main checkouts is wave 4's, for the operator; nothing here makes the symlinked spelling authoritative.

  **Bounds held:** lane memory only, no new file, no SQLite-only state, no `shared/api.ts` type, no health field, and no journal, snapshot or hook change (5213, 5354).

  - **A held creator with no Post (R85, after the final re-review).** A held Bash Pre whose PostToolUse never came is a lost Post. That covers an interrupted call, a hook that dropped the Post, and a failed call, because the installer does not register `PostToolUseFailure`. When rung 4 has no candidate, X1 counts such a window as lost evidence in either of two cases:
    - it may be on the tree's repository, it began inside the creator bracket, and it is open-ended;
    - it has a null repository and it adds the record.

    Bounding it by the call's start rests on rung 4's existing premise that a Bash call lasts at most the margin. A closed window that does not add the record still lets rung 3 link. E2 likewise counts a same-session open-ended window as ambiguous.

  Rows and 26 mutant runs are in `delegation-correlation`, `delegation-watch` and `delegation-policy`; every new row was red first except the pins and one carve-out guard row, which is pinned by its mutant. Commits `321575468`, `5e7a55223`, `9854b654d`, `cd98cfd85`.

  **Amended after the held-out review of run 518 (W1, W3 and W5; coordinator mails 5512 and 5515; the operator's ruling of 2026-10-16).** The review found two more folds toward linking from a loss the lane itself knew of (D-4008; spec §5.3: a lost event may only delay or prevent a link), and one more the operator placed in wave 4. No sentence above is false. X1's first-sighting rule still stands; the first arm below holds a rung-3 link beside it. Both arms are lane memory only: no durable fact bounds either, and a restart starts from none.
  - **First arm: the latest ready instant (R88; W1, the known part).** The field is `readyAt` in `DelegationLane` (`server/src/watch.ts`).
    - **What sets it.** The first pass of a process that reaches the owners sets it. So does the first pass to reach them after a pass found the lane not ready: no census, no applier, an applier that is not `ready` or has failed, or a recovery the lane started that has not settled (R116, below). It is set to `Math.max(pass.now, recoveredAt ?? appliedAt)`:
      - `recoveredAt` is the instant the last recovery the lane started SETTLED, returned or thrown (R112). It is a lane field, measured in the `finally` of `run()`'s `await durable.recover()` and consumed when the next instant is set, so it reaches whichever pass sets that instant, not only the pass that recovered. When the recovering pass itself sets the instant (R112, not cut), the settle binds on a forward clock. When a later pass sets it (R116's cut order), that pass's clock is later and binds (the clamp, R120). The carried settle decides only after a backward wall-clock step.
      - `appliedAt` is the instant the setting pass's applier answered (R113, review 544 P2), so it covers the boot recovery `open()` makes as well as the in-process one. That one arm covers the pass that started the open (R113) and a later pass that awaits the cached applier after the first was cut (R117, review 556 F2), because the cached promise resolves only after `open()` has recovered.
      - The clamp keeps the instant no earlier than the setting pass's own clock, whatever the wall clock does during the awaits (R115, review 556 F3). A backward step used to put it earlier, toward linking. It is one clamp for both arms. R115 pins the clamp on the appliedAt arm, and R120 pins it on the recoveredAt arm on a forward clock, after a cut recovery.

      Both are measured after the await. That carries the clock-skew allowance from the settle, which covers a call made during the recovery by a hook clock running ahead of the server's. When the clocks agree, the pass budget (45 s) keeps a recovery whose pass is not cut inside the skew (60 s), unless a starved event loop fires the budget timer late (review 544 M1); a recovery whose pass was cut runs on past the budget, and its settle covers that too.

      **A recovery in flight is not ready (R116, review 556 W1; review 518's W1(a)).** `run()` sets the lane field `recovering` just before `await durable.recover()` and clears it in that await's `finally`, so it clears whether the recovery returned or threw. A pass that finds it set, right after its applier answers, marks the lane not ready and returns: it reads no owner, reconciles nothing and sets no instant. That includes the repair tail. `recover()` clears its failure and sets the state `ready` before its projection repair (`repairLocked`) returns, and until `7ac0e54ee` a pass that ran then saw `ready` and set the instant to its own clock, earlier than the recovery's return. So a pass that recovers and is cut before the owners leaves the instant to a later pass: every pass that runs before the recovery settles is held, and the first instant after it is no earlier than the settle. On a forward clock that later pass's clock is later than the settle and is the bound that binds (the clamp, R120); the carried settle decides only after a backward wall-clock step. On a return the evidence clears after the recovery run in the same synchronous continuation as the `finally`, so no pass sees the recovery settled with the old slice still marked loaded. `recover()` throws only before it clears its failure (its projection repair never throws), so after a throw the next pass finds the applier failed and is not ready.

      The no-census and no-applier marks can fire only before a process's first ready pass (review F7): the census is never unset once taken, and the applier is cached once it opens, so within a running process they duplicate the initial not-ready state and stay as defence; no row can pin them. Within a running process the lane is marked not ready by an applier that has failed or is recovering, by a recovery the lane started that has not settled (R116), and by R103: `noteRegistry(false)` (review F3). An unlistable registry makes `tick()` return before the census and before the lane's pass, so nothing is listed while it lasts; that is "no census", and the first pass after it sets the instant. R109 (re-review N3): a pass cut before the owners (in the projects-root resolution or the evidence load) listed no one, so it marks the lane not ready too, at once when the cut fires and again at its late return. Each arm has a row of its own (review 533 F1): R110 pins the mark at the cut, and R111 pins that a pass cut after the owners leaves the instant where it was. For safety, the marks at the late return are redundant with the mark at the cut: a pass's signal is aborted only by the budget timer, whose abort settles the race to `'cut'` in the same dispatch, so the mark at the cut runs before any later pass can start; or by `sweep()`'s `finally`, after `run()` has returned. They are not without effect (review 544 P1), but only one of them has any (review 556 F1):
      - **The projects-root late return** (the check tagged `// R109: cut before the owners, so nothing was listed`, after `resolveProjectsRoot` in `run()`). In R110's order, a late return after a newer pass has reached the owners, it marks the lane again, so the next pass moves the instant a second time and holds a candidate whose owners were all read. "R114 (P1; THIS ROW PINS A LIVENESS COST, …)" pins this arm: its cut pass returns through it and never reaches the evidence load.
      - **The evidence-load late return** (the check tagged `// R109: the same`, after `loadEvidence` in `run()`) has no liveness effect in any order. The evidence load is one shared promise (`evidenceLoading`). A cut pass's continuation is queued on it before that of any newer pass awaiting it, at the same await depth, so the cut pass returns at this check before a newer pass can reach the owners; and once the load has finished, the cut pass returned before a newer pass started. Either way the mark at the cut has already marked the lane, and the newer pass sets the instant whether this mark runs or not. Measured: with only this mark reverted to `if (pass.signal.aborted) return;`, the whole of `delegation-watch.test.ts` is 235/235 at `e320ced5c` (review 556 measured 231/231 at `9ebe539f3`). So it has no row (no R118).

      The 229/229 run of round 4 (both late-return marks reverted to a bare `return`, the mark at the cut kept) measured no effect only because no row then measured the marks. The late-return marks stay: they move toward holding, and they are defence for any future caller of `run()` outside that race. A general time-gap bound was declined: a slow or stalled census cadence is the never-listed class below, which the operator placed in wave 4.
    - **The `tick()` audit (coordinator mail 5587).** Every return or skip between `tick()` and the lane's pass (`server/src/watch.ts`), and whether it marks:
      - the single-flight `if (this.ticking) return;`: not a failure; a tick stalled in flight stretches the census interval, the never-listed class;
      - the unlistable-registry return: MARKS (R103, `noteDelegationRegistry(false)` just before it);
      - the awaited calls before the lane (`emitPools`, `sweepHookStates`, `sweepUsage`, `detectDialogs`, `sweepTasks`, the first heads wait, `assembleFleet`): none returns early; a throw rejects `tick()`, which nothing catches (no `unhandledRejection` handler), so the process exits and starts not ready (R88);
      - the never-awaited lanes (the catalogue poll, the inventory sweep, `sweepDivergences`): they cannot stop the pass; the census's own reads are measured, so only a thrown bug leaves it stale, and the sessions it misses are the never-listed class;
      - inside the lane: no census or no applier MARKS (before the first ready pass only, F7), a failed or recovering applier MARKS, a recovery the lane started that has not settled MARKS (R116), a pass cut before the owners MARKS (R109), and a pass cut at or after the owners keeps the owners it listed (R89, R101, R107); single flight and the cadence are not failures.
    - **What clears it.** Nothing. Only a later ready instant moves it, and a restart starts from none. No durable fact bounds it, and none was added.
    - **What it vetoes.** Correlation gets one lost window `[epoch, readyAt + DELEGATION_CLOCK_SKEW_MS]` on every repository, naming no call (`delegationNotReadyWindowOf`, appended in `reconcile` beside `delegationLostWindowsOf`; the skew is R104's). No rung-4 candidate whose creator call began at or before the instant, or within the skew after it, links: the single-candidate answer is `unmeasured('evidence-horizon')`. With no candidate, X1 holds a rung-3 link whose creator bracket reaches back to the window.
    - **A null instant.** `delegationNotReadyWindowOf(null)` is an open-ended window from the epoch, which vetoes every candidate and holds every X1 bracket. The lane never reaches it, because `reconcile` runs only after the owner loop of the same pass has set the instant. If it were reached it would fail toward unmeasured and never toward a link.
    - **The edge.** `readyAt` is the server's clock and a candidate's start is the hook's `observedAt`. The escape direction is a hook clock AHEAD of the server's: it stamps a call made before the instant up to its lead after it, while a clock behind only over-holds (review F4; an earlier version of this bullet had the direction backwards). R104 closes it within the allowance: the window ends `DELEGATION_CLOCK_SKEW_MS` (1 minute) after `readyAt`, as X1's bracket widens the same comparison. A lead larger than the allowance is outside it, as it is for X1. Cost: one more minute held after each ready instant.
  - **Second arm: the owners a pass listed (R89; W1, the known part).** The field is `pendingOwners` in `DelegationLane`.
    - **What sets it.** Every owner a census lists is remembered, live or not, with the hours it was listed in.
    - **What clears it.** One observation of the owner that completes in a pass that was not cut. An observation that throws is not completed. R101 (review F1): the owner is forgotten only once what that observation read is DURABLE. The owner loop collects the completed owners, and they leave the memory after `flushPass` returns without a failure past the first byte, a cut pass's late flush included. An owner one of whose staged buckets was refused before writing (R82) stays pending, and only the hours the observation covered leave the owner's memory. R107 (re-review N1): those hours are one set per owner, and a cut pass's late flush can land after the next pass has listed or re-pended the same owner in the same hour, so each pending owner carries the sequence of the last pass that listed or re-pended it (`listedBy`), and a pass forgets nothing of an owner a newer pass stamped; that later pass forgets it once its own read is durable. So a later pass's listing keeps its own (an earlier version of this sentence claimed that without the stamp, and it was false within one hour). Until then each listed hour is a lost window on every repository (`pendingWindows`, appended in `reconcile`). This goes beyond the ruling's letter. Without it an owner whose read keeps failing would let rung 4 link in the hours before the expiry, because that pass still reconciles. R106 (review F6): the windows also cover the pending owner's hours the checkpoint holds measured and not yet closed, because lines may have landed there after its last read (an owner read at 10:59:30 whose read throws at 11:00:30 is listed in hour 11 only).
    - **How it is read.** The owner is read as a non-live owner when the census no longer names it alive, so a pass cut before it, or a session gone by the next census, is still read once. R102 (review F2): an owner the last pass listed and this pass does not is pending again, not live, with the hour it was last listed in (`lastListed`, lane memory, bounded by the live sessions), so the lines it wrote after its last read and before it ended or died are read once more before it leaves. The cost is one spool read per session end. `hoursOf` reads every listed hour (R105 pins it), so a gone owner whose late listing fails records that hour `directory-unreadable`, a loss, rather than nothing. An owner whose incarnation was unmeasured gets its `incarnation-unmeasured` gap for every hour it was listed in, live or not; before, it got one for the open hour of a live owner only.
    - **The expiry.** A listed hour that leaves the read horizon (24 hours, `DELEGATION_SPOOL_LOOKBACK_HOURS`) unread is staged as a gap with a LOSS word for the pass's flush, never a carve-out word. The detail is `hour-never-closed: listed in this hour, and never read before the hour left the read horizon`, under the owner's incarnation; an owner whose incarnation was unmeasured keeps its own `incarnation-unmeasured` word. An owner with no listed hour left is forgotten, so its memory is bounded by the read horizon. The hour leaves the memory as it is staged, before that flush is durable: a failed flush is covered by the next recovery's not-ready window, and an R82 pre-write refusal of that gap's own bucket would drop it unrecorded, which nothing known produces.
    - **What stays the carve-out.** A measured `directory-absent` read of a pending owner completes the observation and is still the no-spool carve-out, because ccd makes the spool directory at every spawn and nothing removes it (D-4637).
    - **The residue.** An earlier version of this bullet said that a read lost at the flush was covered because the in-process recovery moves `readyAt` past it. It was not, for an owner gone by the recovery: an open-ended call of that owner runs past the new instant, and an R82 refusal does not move the instant at all (review F1, probe P1). R101 closes both: the owner leaves the memory only once its read is durable, so it is read again after the recovery, and an owner whose bucket was refused stays pending and vetoes through its listed hours until they leave the read horizon.
  - **Counting.** The trees both arms hold count under the EXISTING lost-evidence count: the lane report's `lostEvidence` figures and the hourly warn line's count of trees held unmeasured by lost evidence. Both windows are `lost: true`, so `delegationLostEvidenceForced` counts them and the mark and unknown-window counters ignore them. One change to counting, in `delegation-correlation.ts`: `delegationUnknownWindowForced` took two links as different answers, because a link carries no `reason`. After a restart an unknown window exists (a session gone from the registry) and R88 holds every pre-restart creator, so a tree held by lost evidence alone was counted under `window` as well. Two links to the same activity are now the same answer, so such a tree is counted as lost evidence and not as an unknown-window verdict too. No verdict changes. README's list of what makes a rung-4 link unmeasured as lost evidence names both arms, the owners listed and not yet read (with every hour each was listed in, and its measured hours not yet closed) and the ready-instant window (`b9081a869`, review 544 P3; `e090adcb1`, review 556 W2, names every hour an unread owner was listed in, where it had said only the hours not yet closed).
  - **Rows** (all in `delegation-watch.test.ts` except R95; each is red against the mutant named, except the shape pin).
    - Down: "R88 down: a call made while the server was down …" holds the call: no lease, verdicts `{unresolved: 1, unmeasured: 1}`, and a lost-evidence count of 1. Mutant: the window removed from `reconcile`; at `e320ced5c` it reds 16 rows of the whole file (219 green): "a restart keeps the evidence …", both I-1 LIVENESS rows with a pre-restart creator, "R88 down", "R88 in-process recovery", "R88 through X1, measured", R103, R104, R109, R110, R112, R113, R114, R115, R116 (a) and R117. At `c16bfd137`, with R120, it reds 17 rows (219 green): those 16 and R120. At `4ac776dc6` it was the first 13 of them (218 green).
    - In-process recovery: "R88 in-process recovery: …". Mutant: `readyAt` set only while it is still null, so a recovery does not move it.
    - Liveness: "R88 liveness: a candidate wholly after the ready instant, with every owner read, links at rung 4". Mutant: the window ends at the pass's clock.
    - Through X1: "R88 through X1, measured: …" holds a rung-3 link at 22 minutes and links it at 23. Mutant: the window removed.
    - "R88 pure: …" pins the window's shape and the null case. It has no mutant, because it pins a shape.
    - Cut pass, an owner never reached: "R89: a pass cut before it reaches an owner it listed: …". The owner is gone by the next census, is read anyway, and the overlapping call ends `unresolved('overlapping-listing-window')`, as with the full evidence. Mutant: the pending set never filled.
    - Cut pass, an owner whose read keeps failing: "R89: an owner whose read fails until the hour it was listed in leaves the read horizon: …". The hour vetoes while pending, and after the expiry as a loss. Mutants: the expiry word `directory-absent`; no pending windows in `reconcile`.
    - Unmeasured incarnation: "R89: a listed owner whose incarnation was unmeasured, …". Mutant: the gap noted only when the owner is live.
    - Counting: "LIVENESS: an unknown window that does not overlap the creator's in time leaves the link possible" asserts that the unknown-window count stays 0 while lost evidence holds the tree. Mutant: the linked-and-linked line removed from `delegationUnknownWindowForced`.
    - After review 2 (rows R101 to R106; the rows above are re-timed so that calls that should link begin more than the skew after the ready instant, and "R88 through X1, measured" now holds at 22 minutes and links at 23):
      - "R101 (F1): a read lost at the flush (the journal write fails at its first byte) keeps its owner pending: …" (probe P1). Mutants: the owner forgotten when its observation returns; forgotten after a failed flush.
      - "R101 (F1): an owner one of whose buckets the applier refuses before writing (R82) stays pending, and its listed hour vetoes". Mutant: an owner forgotten though its bucket was refused.
      - "R102 (F2): an owner the last pass listed and this one does not is read once more, …" (probe P2). Mutant: no re-pend when an owner leaves the listing.
      - "R103 (review F3): a registry tick() cannot list marks the lane not ready: …" (probe P4). Mutant: `noteRegistry` marks nothing.
      - "R104 (review F4): a call stamped within the clock skew AFTER the ready instant is held …". Mutant: the window ends at `readyAt` (it also reds "R88 pure" and "R88 through X1, measured").
      - "R105 (review F5): a listed owner, gone by the next census, whose late listing fails is still read for the hour it was listed in: …" (probe P3). Mutant: `hoursOf` ignores the listed hours (MR13).
      - "R106 (F6): a pending owner's MEASURED, UNCLOSED hours veto too: …". Mutant: pending windows from the listed hours only.
      - "LIVENESS, with a lease (review 2 section 5): …" makes the creator call after the restarted lane's ready instant and keeps a real lease beside an unknown window that does not overlap it.
    - After the re-review of round 2 (rows R107 to R109):
      - "R107 (N1, probe P5): a cut pass's late flush, landing after the next pass re-pended the same owner in the same hour, does not forget it: …". The cut pass's application is held open until the next pass reads the owner, whose read then throws. Mutant: no stamp check in `forgetRead`.
      - "R108 (N2, probe P6): a cut pass reading a NON-LIVE, re-pended owner keeps it pending: …". The cut pass's late application lands before the next pass. Mutant: an owner counted as read although the pass was cut (MR4).
      - "R109 (N3): a pass cut before the owners (here in the projects-root resolution) lists no one, so the lane is not ready: …". Mutant: neither the cut nor the late return marks the lane.
    - After review 533 (rows R110 to R112):
      - "R110 (F1 C): a pass cut while its OWN projects-root read is still pending marks the lane not ready AT THE CUT: …". The next passes reach the owners and reconcile before the cut pass returns. Mutant: the mark at the cut in `sweep()` deleted.
      - "R111 (F1 D): a pass cut AFTER the owners leaves the ready instant where it was: …". It expects a lease once every owner is read. Mutant: `reachedOwners` never set, so every cut marks the lane.
      - "R112 (F2 G): the ready instant after an in-process recovery is no earlier than when the recovery SETTLED: …". A creator call stamped inside a held-open `recover()`, after the pass's clock and the skew, is held; the recovering pass is not cut and sets the instant itself. Mutant G (round 4: `readyAt = pass.now`), re-measured at `e320ced5c` as the `recoveredAt` arm removed (`readyAt = Math.max(pass.now, appliedAt)`): it reds R112 only, and at `c16bfd137`, with R120, still R112 only (235 green). R112 is the only row in which the settle binds on a forward clock.
    - After review 544 (rows R113 and R114):
      - "R113 (P2): the ready instant set by a fresh lane's first pass, the one that starts the open, is no earlier than the BOOT recovery's return: …". A creator call stamped inside a held-open `DelegationDurability.open`, more than the skew after the pass's start, is held, on a mocked timeline beyond the budget. Mutant: `appliedAt = pass.now`; at `4ac776dc6` it red this row only, and at `e320ced5c` it reds R113 and R117.
      - "R114 (P1; THIS ROW PINS A LIVENESS COST, not a safety property, as R91 pins today's link): …". R110's sequence with no other session; a creator call at at(6)+20 s, by an owner every later pass read, is held by the second move of the instant. Mutant E (both late-return marks a bare `return`, the mark at the cut kept): it links, and at `e320ced5c` it reds R114 only. R114 pins the projects-root late-return arm only: its cut pass returns through that arm and never reaches the evidence load. The evidence-load arm alone, reverted, reds nothing (235/235 at `e320ced5c`; "What sets it" says why).
    - After review 556 (rows R115 to R117; every mutant measured against the whole file at `e320ced5c`, alone, with the round's other changes kept):
      - "R115 (F3): the ready instant is never earlier than the setting pass's own clock, whatever the wall clock does: …". The wall clock steps back 180 s during a held boot open, so `appliedAt` is before the pass's clock; a creator call at the pass's clock plus 20 s is held. Its comment says one clamp covers both arms, and names the row for each (R120 pins the recoveredAt arm on a forward clock; no row measures that arm after a backward step during a held recover(): no R119). Mutant: the clamp removed (`readyAt = recoveredAt ?? appliedAt`), W1's mechanism kept: at `e320ced5c` it red R115 only (a lease); at `c16bfd137` it reds R115 and R120 (234 green).
      - "R116 (a) (W1): a pass that runs while a recovery the lane started has not settled reads nothing, even once recover() reports ready: …". Pass B recovers through the real `recover()`, whose projection repair is held after it already reports `ready`, and is cut at its budget; pass C runs during the repair and reads no owner; a creator call more than the skew after C's clock, and within the skew after the recovery's return, is held. Mutant: W1's check removed (the `if (this.recovering) …` line): at `e320ced5c` it red R116 (a) only (a lease); at `c16bfd137` it reds R116 (a) and R120 (234 green), since R120's order is R116's.
      - "R116 (b) (W1, liveness): once the recovery has settled, a candidate wholly after its return plus the skew, with every owner read, links". The same order; the creator call comes after the settle. Mutant: the in-flight mark left set after the settle (`this.recovering = false` removed from the `finally`): no pass is ready again, and it reds 6 rows: R116 (b) (no link), R116 (a) (on its lost-evidence count: nothing reconciles), R112, "R88 in-process recovery", "R82 (c): a failure AFTER the first byte …" and "an applier found failed, a recovery, then a load that fails: …", every row that needs a pass to read after an in-process recovery. At `c16bfd137` it reds those 6 and R120 (229 green).
      - "R117 (F2): a pass that awaits the CACHED applier after the opening pass was cut inside the boot open sets an instant no earlier than the open's return: …". R113's second case: the opening pass is cut inside the held open, the next pass awaits the cached applier, and a creator call between that pass's clock plus the skew and the open's return plus the skew is held. Mutant: `appliedAt` stamped only for the pass that started the open (`const opener = this.opening === null;` before the await, then `appliedAt = opener ? Date.now() : pass.now`): it reds R117 only (a lease).
    - After review 563 (row R120; every mutant measured against the whole file at `c16bfd137`, alone, with the round's other changes kept; `c16bfd137` has the same code and tests as `de20f154c`, which changes only this plan):
      - "R120 (review 563 F1): after a cut recovery, on a forward clock, the instant is the setting pass's clock, not the earlier settle: …". R116's order: the recovery settles at at(9), and the first pass after it, at at(10), sets the instant; a creator call at at(10)+20 s, more than the skew after the settle and within the skew after the setting pass's clock, is held (no lease, a lost-evidence count of 1). It pins the clamp on the `recoveredAt` arm, which in the cut order is the bound that binds on a forward clock (review 563 F1, F2). Mutant: the `appliedAt` arm clamped only (`readyAt = recoveredAt ?? Math.max(pass.now, appliedAt)`): it reds R120 only (235 green; a lease).
      - Re-measured with R120 in place: R115's mutant reds R115 and R120 (234 green); R116 (a)'s reds R116 (a) and R120 (234 green); R116 (b)'s reds 7 rows, the 6 above and R120 (229 green); G reds R112 only (235 green); Down reds 17 rows, the 16 above and R120 (219 green).
  - **Within one hour a loss word displaces a carve-out word (R90; W3).** Between two unmeasured words in one hour, a loss word displaces a carve-out word (`directory-absent`, `capability-absent`), and a carve-out word never displaces a loss word, whichever `recordedAt` is later. Before, the later `recordedAt` won in the merge, and the lane's no-op skip kept an hour's first unmeasured word. So an hour first recorded `directory-absent` (an owner with no cursor yet) or `capability-absent` kept that word after a later `range-unreadable`, `directory-unreadable` or `bucket-vanished-unread`, and `delegationLostWindowsOf` applied the carve-out to the stale word.
    - It lives in `mergeDelegationObservationInterval` (`delegation-checkpoint.ts`). The lane's no-op skip re-stages a loss word over a carve-out word in both places that skip, `gateOf`'s `intervalMoves` and `noteGap`'s written-once skip, through one helper (`laneLossOverCarveOut`).
    - The carve-out words are defined once, in `delegation-model.ts` (`DELEGATION_HOUR_NO_SPOOL`, `DELEGATION_HOUR_NO_CAPABILITY`, `isDelegationHourCarveOut`). `a164bda5b` moved them there from `delegation-ingest.ts`, which now builds the reader's vocabulary (`DELEGATION_BUCKET_UNREADABLE_REASONS`) from them. The checkpoint's pure half may import only the shared API, the journal, the model and `node:path`, which `delegation-recovery`'s pure/impure split row pins. `ddecd034c` alone fails that row, and the tip passes.
    - `DelegationObservationInterval`'s shape is unchanged, and there is no new column.
    - **Rows.** "R90 pure merge: …" pins both orders, for both carve-out words, two loss words, and a later carve-out. Mutant: the line that keeps the stored loss against a carve-out removed, so a later carve-out wins. "R90 in the lane: an hour first recorded range-unreadable, then capability-absent …" carries that mutant through the lane. "R90 in the lane: an hour of an owner with no cursor first recorded directory-absent, then directory-unreadable …" is red against `intervalMoves` without the R90 clause. "R90 in the lane: a listed hour that leaves the read horizon unread (R89) is a loss over the carve-out word …" is red against a `noteGap` that skips every unmeasured prior. The existing carve-out-only rows are the liveness: "5484 (1), the carve-out: a directory-absent hour of an owner that NEVER had a spool does not veto: rung 4 links across it" and "5484 (1): a capability-absent hour does not veto (fleet-wide, it captured nothing): once the fleet offers the capability, rung 4 links" stay green.
  - **A session no census listed (W1, the never-listed part; R91; the operator's ruling of 2026-10-16, mail 5515).** A session born and gone between two census passes is never listed, so nothing reads its spool, and rung 4 links across its overlapping call. The lane lists owners from the census only and never lists the spool root. R88 closes the same class for a stretch in which the lane was not ready, because a call overlapping such a session began before the ready instant. The operator placed closing the rest in wave 4, by listing the spool root. Its gap is the census interval, which a loaded box or a stalled tick stretches (coordinator mail 5587), and wave 4's listing of the spool root closes it. Wave 3 discloses it here and in README's "What rung 4 cannot see" bullet, and changes nothing for it. Row: "R91 (W1, the never-listed part; THIS ROW PINS THE GAP): …" pins today's behaviour, that the session's spool is never listed and rung 4 still links. It has no mutant, because it pins an absence. A lane that lists the spool root turns it red, as intended, and its expectation is then flipped; its comment says so, and no mutant demonstrates it.
  - **A parent the server stopped reads as a death (review 578 F4; fixed by D-5433).** Main's stop-done lane (#512) stops a finished run's idle worker, up to 3 a pass. The fleet reads the stopped pane `dead`, so two stops within 10 minutes read `suspended`. That is spec §5.5's letter, "two or more parents first measured dead within 10 minutes". While suspended, `planRecord` withholds rung-2/3/4 lease requests and unowned-work records. A tree still present when the breaker clears is leased on a later pass; one born and gone inside the period is not. That errs toward fewer claims, never a wrong one. In the soak (Rollout and Verification step 8, :1381), stop-done stops would have opened breaker periods. The operator ruled on 2026-10-18, "Fix before soak": D-5433 is the fix.
  - **Where the rung-4 limits are (W5).** This entry does not repeat them: the creators no hook can see, spec §5.1 against §5.3, a tree removed and re-added under one admin name, the one-witness caveat, and how to list the rung-4 leases from the journal. They are in README, in the wave-3 delegation section, under "Rung 4: lost evidence, what it cannot see, and how its leases are listed" and the bullets that follow it.
  - **The liveness cost of an hour that cannot be placed (W5; recorded, no change).** A checkpoint row whose hour is not a canonical instant is kept for ever, because `upkeepDelegationIntervals` prunes only an hour it can place. It fails safe twice. In `delegationLostWindowsOf`, an interval row that counts as lost (an unmeasured one the carve-out does not excuse, or a torn-tail one) whose hour does not parse, and a torn-tail cursor whose bucket name names no hour, each make a lost window over all of time (`delegationLostHourWindow` with a null hour: from the epoch, open-ended). It vetoes every rung-4 candidate on every repository for ever. In the health window, a row whose hour does not parse, or parses but is off the hour boundary, cannot be placed, so the window is never complete and `stageGate` reads `unmeasured` for ever. The lane writes only canonical hours, so only a restore or a hand edit makes such a row. The existing row is "a row whose hour is not a canonical hour boundary cannot be placed, so it makes the window incomplete rather than vanishing" (`delegation-health.test.ts`, about :156). It pins the health half; no row pins the all-time lost window.
  - **R95 (W5): a raw lease resolves from the journal alone.** "R95 (W5): every raw lease resolves from the JOURNAL FILE ALONE to the call that made it: its PreToolUse and PostToolUse records, one toolUseId, both listings", in `delegation-wave3.integration.test.ts`, reads the journal file on disk line by line (not the checkpoint, not SQLite), takes each `lease-created` entry with `sourceKind: "raw"`, and resolves its `correlationJournalIds` to the two accepted records of the creating call, with one `toolUseId` and both listings. Before it, only the pure correlation row (`delegation-correlation.test.ts`) pinned the trail. Mutant: the lease entry loses the first of its `correlationJournalIds`, and the creating call's PostToolUse is missing.

  **Bounds held again:** lane memory, one change to counting and one to the merge's precedence. No new file, column, `shared/api.ts` type or health field, and no journal, snapshot or hook change, except the follow-up's two hook changes to the join record (D-5434, D-5435). Commits `b7f0f5f9e` (R88, R89 and the counting change), `ddecd034c` (R90), `1942fe532` (R91 to R95: the never-listed pin, the census streaks of R92 and R93, two incarnations in R94, and R95) and `a164bda5b` (the carve-out words, once, in the model). After review 2: `6ace6b352` (R101, R102, R106), `be0534fc6` (R103, R104 and the re-timed rows) and `312bece8e` (R105, and the reader's carve-out words spelt through the model's constants, F8); still lane memory only, with no durable fact, file, column, type or health field added. After its re-review: `95ac8eded` (R107, R109) and `cd69c6e6c` (R108). After review 533: `97569e658` (R110 to R112) and `57b425e85` (comments only: the expiring hour is staged, and the ready instant covers the recovery). After review 544: `39976df16` (R113: two code lines, `appliedAt` and `readyAt`'s right-hand side, the M1 comments, and the row R113) and `4ac776dc6` (R114, and the reason in R112's comment and its describe title); still lane memory only. After review 556: `42f817df0` (D-4662), `e090adcb1` (README, W2), `7ac0e54ee` (R115 and R116: the `recovering` and `recoveredAt` lane fields, the check after the applier answers, the clamp, the comments and the rows) and `e320ced5c` (R117, and R112's and R113's comments and titles); still lane memory only, with no durable fact, file, column, type or health field added. In the landing round (review 563): `c16bfd137` (R120, the comments of R112, R115 and R116 (a), two watch.ts comments naming R115 and R120 by arm, and the describe title; comments, a title and a row only) and this entry's edit; still lane memory only. After review 578: `5f87b0859` (R120's comment, F1, and `_check_server-caps`'s header in `ccd/ccrc-doctor-checks`, F5, edited in place; comments only) and this entry's edit (F2 to F4); still lane memory only, with no durable fact, file, column, type or health field added. After the landing merge of #572: `e8caac911` (F7), the semantic merge fix for #572's refusal ratchet (D-5381), in which the intent route's six refusals answer through `refuseRoute` with their words, statuses and bodies unchanged and its three words are declared in main's table; no behaviour change and no D-number.
- **D-4660** — `the-restore-marker-refusal-sits-beside-the-opener` (Task 8; held-out review 518 F7; coordinator mail 5512): Task 8 Step 7 requires that "startup refuses active marker" and names no file for that check. The File Map's ownership note for Task 7's files (`schema.ts`, `store.ts`) and Task 7 Step 6 admit an edit to `server/src/coord/db.ts` only when an injected migration fault first proves its loop inadequate. Neither the File Map nor Task 8 names `server/src/index.ts`. The refusal was built in those two files all the same:
  - `coordinationRestoreRefusal(ccrcDir, markerFile)` is exported from `server/src/coord/db.ts`, after `openCoordDb`, and the file gains one `lstatSync` import. `server/src/index.ts` calls it once, before `new CoordStore(openCoordDb(...))`, prints the answer with `console.error` and exits 1.
  - It returns the refusal text when the restore marker exists, and `null` only on ENOENT. Any other answer (a directory, a dangling link, a parent that is not a directory, a permission error) is a refusal, because a marker that cannot be measured is not a marker that is missing.
  - **Why it lives there.** The check must answer before the coordination database is opened, so that the process stops instead of opening a `coord.db` that disagrees with half-replaced sidecars. `db.ts` is the module that decides whether `coord.db` may be opened, and it already holds the server's other refusal to start (`CoordDbUnmigratable`). `index.ts` is the wiring ring (L5, which decides nothing) and starts the server when it is imported, so a decision placed there could not be called by a row. The marker's file name is handed in by the caller, because `config.ts` imports `db.ts` and the delegation modules must not enter every importer's graph.
  - **What did not change.** `openCoordDb`, its migration loop and the `CoordDbUnmigratable` path are as they were; the diff to `db.ts` is the import and the new function. No migration fault asked for the edit, so Task 7 Step 6's admission is not what licensed it. The review's minority reading, that the note is scoped to the migration loop, is recorded here and not relied on. No code moved in the fix round for review 518.
  - **Rows**, all in `delegation-watch.test.ts`, in "boot refusal (R24): an active restore marker, or one that cannot be measured, stops the server before coord.db is opened":
    - "a marker present is a refusal that names the recovery command and says it is the server";
    - "no marker (ENOENT, even when the directory itself does not exist yet) is no refusal";
    - "fail closed: any other answer than \"absent\" is a refusal, because an unmeasurable marker is not a missing one";
    - "a marker that is a directory or a dangling link is still a marker";
    - "index.ts checks it BEFORE the line that opens coord.db, says it with console.error, and exits nonzero";
    - "the real server process exits 1 with the refusal on stderr and never opens coord.db".

  Commit `739735f38`.
- **D-4661** — `the-worktree-listing-is-spliced-onto-the-jq-line` (Task 5; held-out review 518 F9; coordinator mail 5512): spec §5.3 ("the line is built in the hook's existing single `jq` call") and Task 5 Step 7 ("Implement the hook append in its existing `jq` call") put the whole spool line in that call. Two parts of a Bash worktree line are not built there, and the hook comment "THE LISTING" in `ccd/session-hook.sh` says so:
  - The `listing` is built by a shell function, `_hook_spool_listing`, from the `.git` entry found walking up from the line's cwd. `_hook_spool_append` splices it onto the jq-built line as text.
  - When the listing is dropped, `"truncated":true` is added to the line the same way, by cutting the closing brace and appending the key.

  **Why.** jq cannot list a directory, and the cwd that names the directory is itself learned from the payload by that one jq call. So the listing cannot be built inside the call, and it cannot be built before it, because the cwd is not yet parsed. A second jq call after the cwd is known would add a fork to every Bash worktree event.

  **The hot-path contract still holds.** Each part, checked in the hook at this commit:
  - **No extra fork.** `_hook_spool_listing` runs no external command: it uses `[[ ]]`, `read -N`, parameter expansion, `shopt` and the glob `"$w"/*`. The one jq call stays the payload parse. (The hourly prune's `rm`, only when a stale bucket exists, is older and unrelated.)
  - **One write.** The finished line goes out in one `printf '%s\n' "$dsp_line" >> "$f"` to an O_APPEND descriptor, after the splice.
  - **Under 4 KiB.** `_hook_spool_append` writes nothing unless `${#dsp_line} + 1 < DSP_LINE_BELOW` (4096), under `LC_ALL=C`, so the count is bytes. The spliced candidate is tested against the same bound before it is taken. On a trigger line the jq reserves the 17 bytes of `,"truncated":true` (`$rs`), so the dropped-listing form still fits.
  - **The listing is shed first.** It is added only when the jq line shed nothing (the line does not end in `"truncated":true}`), so a line that already shed fields never carries one. When it does not fit, or a name or the count is out of bound, it is dropped whole and the line is marked truncated. No other optional field is shed for it.

  **Pins.** The review found the splice's two edge conditions unpinned (F1: the 17-byte reservation; F2: the rule that a line that already shed carries no listing). They are pinned in `delegation-spool.test.ts` by R96 (a near-cap worktree Bash line whose listing is dropped is still written) and R97 (a line that already shed fields carries no listing), both added in the fix round for review 518. The contract's other parts are pinned by existing rows in the same file:
  - "listing is dropped FIRST when it cannot fit: the other optional fields stay, truncated is set, the line is under the cap";
  - "when the listing is dropped the line is exactly the line it would have been with no listing, plus truncated:true";
  - "the shed order is listing, claudeVersion, cwd, agentType, transcriptPath: ...";
  - "the strict boundary: a line that is 4095 bytes with its LF is kept whole; 4096 is shed";
  - "a name outside [A-Za-z0-9._@+-] (or over the name bound) drops the WHOLE listing and marks the line; a name at the bound stays";
  - "more names than the count bound drops the whole listing; exactly the bound keeps it";
  - "lines near the cap do not interleave: twelve hooks at once, each writing ~3.9 KiB";
  - under "the append forks nothing the event did not already fork", "PreToolUse Bash that names a worktree: the same externals run whether the spool directory exists or not, so a line costs no fork".

  Commit `e0cbd11cb`.
- **D-4662** — `spool-bounds-and-grammars-are-chosen-in-shared-api` (Task 5; held-out review 518 F10; coordinator mail 5512): the vocabulary (Fixed Vocabulary and Interfaces, under the raw spool line) says "String and array bounds are fixed in Task 5's validation table". Task 5 has no such table. Its Step 3 names "identifier/list bounds" and fixes only the 4096-byte line cap. The worker chose the rest, from measurement, and declared them once:
  - `DELEGATION_SPOOL_BOUNDS` in `shared/api.ts`: `lineBytesBelow` 4096 (the plan's), `idBytes` 64, `ownerIdBytes` 128 (the hook's `CCRC_ID_MAX`), `labelBytes` 128, `pathBytes` 512, `listingNames` 256 and `listingNameBytes` 64. The constant's doc comment gives each value's measured basis. Every count is UTF-8 bytes.
  - The id grammar `[A-Za-z0-9_-]{1,64}`, for agent, tool-use, task, run and Claude session ids. It reuses the hook's own agent-id grammar (`idch`, `idmax`). Ingest spells it as `ID`.
  - The listing-name grammar `[A-Za-z0-9._@+-]{1,64}`, tested in the hook against `DSP_NAME_BYTES` and a `=~` match, and in ingest as `LISTING_NAME`.
  - A hook cannot import the constant, so `session-hook.sh` spells the numbers again (`def idmax:`, `def maxline:`, `def maxlabel:`, `def maxpath:`, `CCRC_ID_MAX`, `DSP_LINE_BELOW`, `DSP_LIST_NAMES`, `DSP_NAME_BYTES`). The server's ingest imports the constant.

  **A hook drop that leaves no trace.** An id outside the grammar is never cleaned into one. An event whose agent id is outside it writes no line, and neither does a SubagentStart or SubagentStop with one; a session id or a tool-use id outside it does the same. The hook exits 0 with nothing printed and nothing recorded: no marker, no counter, no stderr. The server cannot tell such an event from one that never happened, and only the census backstops it. This entry used to end "A lost event can delay or prevent a link and never create one (spec §5.3, D-4659)". At rung 4 that is false for a silent drop (review 556 W3). Take a dropped Bash Pre or Post of ANOTHER session whose window overlaps the creator's and whose listing would have shown the tree. Its loss removes the overlap that keeps the rung-4 candidate ambiguous, so the creator's call becomes "the one Bash call", and it links. D-4659's lost windows cover only a loss the lane can see: a shed listing, an unmeasured hour, a torn tail. A drop that leaves no trace is not one of them.

  **Two more silent exits, before the spool line is written.** Neither is a grammar drop, and each drops the WHOLE event: no join record, no turn mark, no hookstate and no spool line. `runAsync` reads exit 0 as success either way.
  - **The 2 s tmux lookup** (`"$hooktmo" 2 tmux display-message -p -t "$TMUX_PANE" '#S'`). A tmux server that does not answer within 2 s leaves the pane's name empty. A process with a pane has no fallback id, so a live pane's event exits 0 at `[[ -n "$id" ]] || exit 0`. This exit depends on time.
  - **The payload parse's read** (`{ read -r event; … read -r dsp_line; } < <(jq …) || exit 0`). The `||` tests only the last `read`, so it exits 0 whenever jq dies, cannot fork, or prints fewer than eight lines. This exit depends on resources.

  README's "What rung 4 cannot see" list does not name these drops, nor the grammar drops above. Wave 3 makes no hook change. The drops ride the list in coordinator mail 5483, which carries the hook-level drops to the operator with wave 4's plan. The contradiction between spec §5.1 and §5.3 that this exposes is answered in coordinator mail 5472: the operator ruled "keep, decide later" on 2026-10-16, for rung-4 links journaled during the soak.

  **Rows.** In `delegation-spool.test.ts`:
  - "the hook's literal bounds equal DELEGATION_SPOOL_BOUNDS" (the jq defs, and the shell constants, each spelled exactly once);
  - "every bound is a positive integer, and the cap is the plan's 4096";
  - "with every bound at its maximum, the REQUIRED fields of the largest variants still fit one line (so a line that cannot fit is a bug, not a case)";
  - "an agent_id outside [A-Za-z0-9_-]{1,64}: no line, from any event (a cleaned lookalike must not ride, and a line without the id would read as the main thread)";
  - "a PreToolUse with no tool_use_id, or an id outside [A-Za-z0-9_-]{1,64}, records nothing";
  - "the Claude session id is the payload's, not the environment's; a missing or malformed one records nothing";
  - "an owner id at the bound writes a line; one byte over writes nothing";
  - "a source at the label bound is kept; one byte more is not";
  - "an optional path over the byte bound is dropped, never cut, and marks the line; multibyte is counted in BYTES";
  - the two listing rows named in D-4661 for the name grammar and the name and count bounds.

  In `delegation-ingest.test.ts`: "identifiers are [A-Za-z0-9_-] and at most the bound", "labels, paths and the agent type are bounded in UTF-8 BYTES, not characters", "a listing is a bounded list of admin-record NAMES: ...", "the list-count bound alone refuses a listing of 257 SHORT names" and "the module reads no bound from a literal: every number comes from DELEGATION_SPOOL_BOUNDS or READ_FROM_MAX_BYTES".

  Commits `e0cbd11cb` and `8453b53e1` (the bounds comment, and the owner bound read from `CCRC_ID_MAX`).
- **D-4663** — `the-fallback-deploys-prune-takes-no-keep-set` (Task 8 Step 6; held-out review 518 W2; coordinator mails 5512 and 5515): Step 6 says "Keep newest N timestamp dirs, current operation dir, newest valid pre-operation coordination snapshot, and newest pre-operation tree backup independently", and D-4641 added a fifth set. Those keep sets bind only `_bak_prune` and `_bak_gc` in `ccd/ccrc`. A third pruner applies none of them:
  - `prune_backups` in `deploy/deploy.sh` lists `~/ccrc-backups/[0-9]{8}-[0-9]{6}`, sorts by name and runs `rm -rf` on all but the newest `CCRC_BACKUP_KEEP` (default 10), through `head -n -$keep`. That is age only, with no classifier and no update lock. `ccrc update`'s `_upd_backup` names its directories in the same `%Y%m%d-%H%M%S` shape, so the glob reaches them too. The fallback deploy calls it once on each of its two arms, after that arm's own verification.
  - Since this wave, the server arm of the same deploy writes the O3 coordination snapshot into one of those directories (`coordination-snapshot.mjs capture`, before the rsync). So the eviction D-4641 reserves to the operator, an empty snapshot displacing the newest data-bearing one past `CCRC_BACKUP_KEEP`, can happen through this pruner, which counts directories and cannot tell them apart.
  - At `CCRC_BACKUP_KEEP=0`, `head -n -0` lists every directory, so the pruner removes the directory the same run just captured. At the default, the directory just captured always survives.

  Wave 3 makes no `deploy.sh` edit. The file is inside the centralised-update programme's W16 fenced region (PR #444, which replaces the line that reads `CCRC_BACKUP_KEEP` with a check that accepts 0 through 9999).

  **The operator's ruling of 2026-10-16 (mail 5515):**
  1. The fallback deploy's age-only `prune_backups` is accepted for the soak.
  2. Centralised-update W16 (#444) meets the operator's condition as D-5144. At `9c355b049`, #444's `CCRC_BACKUP_KEEP` check accepts 0 through 9999 (`deploy/deploy.sh` line 242). W16 keeps that test byte-equal to `_keep_ok` (D-5142) and adds a second, separate test: `prune_backups` refuses any all-zeros `CCRC_BACKUP_KEEP` (`0`, `00`, `0000`), prunes nothing, warns and returns 1. Its directory selection and its delete line stay byte-unchanged. `_bak_prune` and `_bak_gc` keep accepting 0 through 9999. D-5144 lands in W16's landing round, after #448, so it is pending at this writing (its head is not yet known).
  3. `prune_backups` gets the full keep sets in a later wave, which the coordinator carries on delegation-broker wave 4's list.

  **Rows.** None pins the keep sets on this pruner, because it has none. "both branches prune timestamped backups to a bounded set, without failing a completed deploy" in `agent/test/deploy-verify.test.ts` pins its present shape (timestamped directories only, `head -n -`, `xargs -r rm -rf`, one call per arm).

  Commits: none in this wave changed `prune_backups`; the coordination snapshot that now shares its directories is `a0c385acc`.
- **Unused:** D-4664 was issued to this wave (block D-4633..D-4664) and is unused.

Found in the wave-3 follow-up (run 600, block D-5433..D-5438, taken in order; each defined in the commit after its work):
- **D-5433** — `a-deliberate-stop-is-not-a-death` (item 1; review 578 F4; the operator's ruling of 2026-10-18, "Fix before soak"): the lane's circuit breaker counted every parent it saw alive and then `dead` as a fresh death, so #512's `ccd stop --surface agent`, an operator's `ccd stop`, `ws-archive` and #594's `ccd hibernate` read as deaths, and two of them inside ten minutes read `suspended` (D-4659's F4 bullet). `DelegationLane.noteSessions` now reads the row's stop evidence, `stoppedBy` (epoch ms) or, when there is no stamp, `archivedAt` (epoch seconds, × 1000). A dead row carrying it is not a fresh death, and a death already recorded for it is erased, when the stop's instant is no later than the recorded death plus `DELEGATION_CLOCK_SKEW_MS`, or, with no recorded death, this pass's instant plus that skew. The skew is there because the stamp is the fleet box's clock, and the bound on a recorded death covers the torn tick: `assembleFleet` reads the registry before it probes tmux, so a stop can read as a crash for one pass and show its stamp on the next. A stop stamped later than that leaves the death counted (an operator cleaning up after a crash), and every other dead row counts as before, `restarting` and unmeasurable rows included; a swap stays on wave 4's list. Bounds: lane memory only; `LaneSession`'s Pick gains `stoppedBy` and `archivedAt`; no policy code, constant, signature, file, wire type, health field, column, journal or snapshot change. **Residual:** a crash followed by a stop or an archive within one pass, or within the skew of its recorded death, is not counted; the 60 s cadence and the clocks' sync bound it. The rule bounds the stop's instant from above only, so a stop stamp or an archive marker that outlived its pane (`shared/api.ts`'s note on markers that outlive their pane) also hides that pane's later crash; a lower bound would be a new ruling, and is not taken here. An archive stamps `.stopped` through `_ws_unsupervise` before it kills the pane and writes `.archived` after, so it normally carries `stoppedBy`; the `archivedAt` fallback serves a row with no stop stamp, an archive older than the stamp or one whose stamp a revival cleared. **Rows**, in `delegation-watch.test.ts`'s breaker describe, beside the three existing rows, which are unedited: R1 "two parents stopped on purpose inside ten minutes are not a mass death: the breaker and the health read clear, and the lease is made"; R2 "two unstamped archives (archivedAt set, stoppedBy null) are not a mass death either"; R3 "one parent stopped and one that crashed is one fresh death: clear"; R4 "the torn tick: a stop that read as a crash on one pass and carries its stamp on the next (a stamp before the recorded death) erases that death"; R5 "the torn tick with the fleet clock ahead: a stamp 30 s after the recorded death is inside the skew, so it still erases that death". R1 to R5 are red at main (`expected 'suspended' to be 'clear'`, at `517ed6cba`) and green at the tip. R6 "a stop stamped later than the recorded death plus the skew (an operator cleaning up after a crash) leaves the death counted", R7 "an unstamped archive later than the recorded death plus the skew leaves the death counted (archivedAt is read in seconds)" and R8 "stamps more than the skew past this pass's own instant, on parents first seen dying, are not a stop: both count" pin today's answer, green at both. R9 "stamps 30 s past this pass's own instant (the fleet clock ahead), on parents first seen dying, are inside the skew: neither counts" was added because the table's runs found a mutant R1 to R8 let live (below). `sessionOf` in `delegation-watch.test.ts` and its copy in `delegation-wave3.integration.test.ts` take an optional override, defaulting `stoppedBy` and `archivedAt` to null. **Mutation table, run:** ignore `stoppedBy` reds R1, R3, R4 and R5; ignore `archivedAt` reds R2; never erase a recorded death reds R4 and R5; erase whatever the stop's instant reds R6 and R7; drop the skew from the recorded bound reds R5; read `archivedAt` without the × 1000 reds R7; drop the first-pass bound reds R8. Dropping the skew from the first-pass bound alone survived R1 to R8, because R8's stamps are twice the skew ahead; R9 reds it. Commits `517ed6cba` (the rows, red at main) and `dc5464859` (the fix).
- **D-5434** — `the-first-joins-never-refuse-each-other` (item 2; CI run 39103454968 attempt 1, job `server 7/12`, `expected [ 'w0-1' ] to deeply equal []`; the operator's ruling of 2026-10-18): a bounded diagnosis of the lost join in "a workflow fan-out: eight SubagentStarts at once, three rounds, all recorded". **The paths** by which one SubagentStart can end without its join line durable: (1) the bounded tmux lookup (`"$hooktmo" 2 tmux display-message …`): an empty answer leaves `$id` empty, and the event exits 0 at `[[ -n "$id" ]] || exit 0`; (2) the payload parse's read (`{ read -r event; … } < <(jq …) || exit 0`); (3) `_hook_join_record`'s entry guard, `[[ ! -L "$jf" && ( -f "$jf" || ! -e "$jf" ) ]] || return 1`, which the caller's `|| true` hides. (1) and (2) are D-4662's two silent exits, which drop the whole event. The lock, the rename and the cap rotation run only past `JOIN_ROTATE_AT` (128) lines, which this case's 24 ids never reach. **The reproduction** (in a scratch test, not committed): (1) and (2) are deterministic with a BASH_ENV shadow (`timeout() { return 124; }`, `jq() { return 1; }`): no join line. (3) is a lost update: a first writer sees `-f` false (no file yet), a sibling's `>>` creates the file, and the same writer's `! -e` then sees it, so the guard reads "exists and is not a regular file" and refuses, while every lookup succeeded. Plain rounds of eight simultaneous first Starts on a fresh row, 200 of them, lost nothing either way, because the window lies between two `stat` calls of one `[[ ]]` and the hooks arrive milliseconds apart. With a barrier (a BASH_ENV `set -T` and a DEBUG trap that holds each writer just before the guard until all eight have arrived, changing no hook code and no command's answer): at main, 4 lines lost in 400 rounds, each matched by the guard's `return 1`; with the operands reordered, 0 in 400, and no refusal. The case itself, run 30 times at main (`-t 'a workflow fan-out'`, each under the gate), was green 30 times. **Load, a substitution of the ruling's "under load":** every run was slowed in its own scope (`systemd-run … -p CPUQuota=25%`), never by loading the shared box. **The decision:** a lost update, so a wave-3 defect, fixed. The first fix reordered the operands, `( ! -e "$jf" || -f "$jf" )`; review measured that it opens the mirror race, a sibling rotator's `mv -f` landing between the two reads, so the guard now refuses only a POSITIVE non-regular type: `-L`, `-d`, `-p`, `-S`, `-b` or `-c`. No move between absent and regular makes any of these true, so neither a creation nor a rotation can refuse an append, and a symlink (a dangling one too), directory, FIFO, socket or device is still refused. Measured against a path a background loop creates and renames away, about 4 s per guard: main's order refused 315 of 126,920 checks, the reordered form 416 of 136,130, the positive-type guard 0 of 73,290. **Row:** no shadow can split one `[[ ]]`, and a many-round race row is the flaky row the task text forbids, so the red-first row is a source pin, "the entry guard refuses only on positive non-regular type tests, never on absence or regularity, so neither a creation nor a rotation race refuses an append (D-5434)", red at main and green at the tip. Mutants: main's line and the reordered line each red it; dropping `-p` reds it and "a directory, a symlink or a FIFO at the path joins nobody, is never written through, and never blocks the hook" (which hangs on the FIFO until its timeout); dropping `-d` reds the pin only, because `>>` onto a directory fails and returns 1 anyway. D-4662's two exits are unchanged, and stay on wave 4's list. **Not fixed, the same shape:** `_hook_spool_append` (the delegation spool's append) and `_hook_history_scope` open with the same `( -f || ! -e )` guard, so the spool's first-creation race can lose a spool line in the same way; that is outside this ruling, and goes to wave 4's list. The "concurrent rotators" red (mail 5849) is likely the same cause: a rotation's `mv -f` leaves `joined` absent, so the appenders after it are first writers to a fresh file, and under main's order one whose `-f` saw the path renamed away and whose `! -e` then saw a sibling's new file refused. The positive-type guard closes that too; it was not reproduced separately. D-5435's cause does not apply on Linux. Commits `e4143582e` (the reordered guard and the pin) and `4b0917c2b` (the positive-type guard, after review).
- **D-5435** — `the-join-rotation-runs-on-macos` (item 3; the operator's ruling of 2026-10-18, "Add to the follow-up"; main's daily 39093762060 and full run 39096832066): `full-suite` needs `test-macos`, so 10 macOS reds in wave 3's own files blocked every stable promotion. **The rotation family, 7 cases** ("the record rotates by RENAME …", 4; "no window orphans a join record …", 2; "rotation cannot be turned against a swapped path …", 1): Homebrew's `flock` is installed on the runner, and the cases red even with `flock` shadowed to succeed. A darwin-only probe (full run 39124847732, removed again) measured the cause: `stat` of `/dev/fd/N` on macOS answers the file's inode but the fdesc mount's device, so `[[ "$jf" -ef "/dev/fd/$fd" ]]` was always false there, and the rotation never ran where Homebrew supplies `flock`. The hook already knew this of `/dev/fd` on macOS: `_hook_lock_same`'s comment records the fdesc device, measured there. A code defect, fixed: the re-check compares the locked descriptor with a fresh descriptor of the path (`[[ "/dev/fd/$fd2" -ef "/dev/fd/$fd" ]]`), so both sides read through the same `/dev/fd` on either platform and the inode decides; no fork, no platform branch. On Linux "a rotator whose path no longer names its inode skips: the -ef re-check" stays green and reds when the comparison is made always true. **The doctor's spool cases, 3:** on darwin the check asks `_svc_is_active` per unit (`launchctl print`), never systemd's batched `is-active`. "asks the service manager ONCE for all its pending units, in one is-active call" and "a short answer from the manager (fewer words than units) is never read as "not running"" pin that batched call, so they are Linux-only by design and skip on darwin, each with its reason. "a session the manager could not be asked about is a WARN, never a pass and never a missing directory" holds under launchctl, so it is fixed, not skipped: on darwin it plants the launchctl fixture empty (launchctl then exits 1, which is no answer) and reads launchd's remedy; its Linux arm is unchanged. **Verification:** the darwin cases are unverified until the full run at this wave's tip, named in its wave-done mail, reports `test-macos`. Commit `c992c704e`.
- **D-5436** — `unused` (run 600): issued to this follow-up; no departure took it.
- **D-5437** — `unused` (run 600): issued to this follow-up; no departure took it.
- **D-5438** — `unused` (run 600): issued to this follow-up; no departure took it.
- **Unused:** D-5436, D-5437 and D-5438 were issued to this follow-up and are unused.
