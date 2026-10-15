// Delegation broker wave 3, Task 9: per-bucket ingestion with honest gaps.
//
// The fleet's hook (Task 5) appends one bounded JSON line per delegation event to an owner's hourly spool bucket
// (`<spool>/<owner>/<YYYYMMDDHH>.spool`). The server reads a bucket by byte range, FRAMES COMPLETE LINES only, validates each against
// the closed `DelegationSpoolLineV1` union, derives each event's ID from its owner, incarnation, bucket, byte coordinates and raw bytes,
// and hands the accepted events, the bucket's cursor and the hour's interval to Task 8's durable applier as ONE application.
//
// WHAT THIS FILE IS:
//   - PURE, above the IMPURE SHELL banner: `ingestDelegationBucket` (bytes in, a result out), the line grammar, the event-ID derivation.
//     It imports no filesystem and reads no clock; the one hash is `node:crypto`'s SHA-256, a computation.
//   - IMPURE, below it: the reader that turns two measured reads (a directory listing and a byte range) into a bucket input or an
//     honest "could not measure", and the adapter that hands one result to the durable applier.
//
// HONEST GAPS. Every condition that makes an hour less than fully observed is an `unmeasured` interval with a detail, never an empty
// measurement: an absent or unmeasured capability, a recovery that has not finished, an unreadable directory or range, a bucket that
// shrank or whose bytes cannot be proved the same, a bucket that vanished with an unread suffix, a complete line that is not a valid
// event (the cursor steps over it, because the only way on is past a complete line, but the hour is a gap), and a torn tail that can
// never become a valid line. A torn tail that may yet be completed is NOT a gap: nothing is lost yet, and the cursor does not move.
//
// THE CURSOR advances only to the end of the last COMPLETE line the read contained, and only on a read that was itself measured
// (not on a capability, recovery, disagreement, replacement or transport gap). The durable cursor row is the authority: a read that
// does not start at the accepted coordinate, or whose last-seen size is not the accepted one, cannot be proved to be the same bytes,
// so it is unmeasured and the durable row survives untouched.
//
// THE ANCHOR (D-4647). The cursor row also holds the start offset and SHA-256 of the last complete line it stepped over, and every
// read starts there: it re-reads that one line and proves it is still exactly one complete line with the same bytes. That is how
// "bytes changed before an accepted offset" is detected without re-reading the bucket: an in-place rewrite, or a cut and a regrow past
// the old size, fails the anchor. It proves the LAST line only: a change to an earlier line that keeps every later byte in place
// is outside what one anchor shows. A bucket that fails it, or that shrank, is a REPLACEMENT and stays one (the row's `replaced`
// flag, R33): no bytes are accepted at an old coordinate again, however the file regrows, and no other gap clears the flag.
import { createHash } from 'node:crypto';
import { READ_FROM_MAX_BYTES } from '../../../shared/agent-protocol.js';
import {
  DELEGATION_SPOOL_BOUNDS,
  type DelegationEventEnvelopeV1,
  type DelegationSpoolLineV1,
} from '../../../shared/api.js';
import type { FleetIO, MeasuredDirectoryRead } from '../io.js';
import type { DelegationDurableBatch } from './delegation-checkpoint.js';
import { findDelegationJsonDefect } from './delegation-journal.js';
import {
  formatDelegationInstant,
  parseDelegationInstant,
  type DeepReadonly,
  type DelegationBucketCursor,
  type DelegationJournalEntryV1,
  type DelegationObservationInterval,
  type DelegationRecoveryState,
} from './delegation-model.js';

const B = DELEGATION_SPOOL_BOUNDS;

// ── the event ID ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The domain separator of the event-ID preimage, NUL included. The hook never hashes, locks, counts or forks for an ID. */
export const DELEGATION_EVENT_ID_DOMAIN = 'ccrc-delegation-event-v1\0';

/** An unsigned 32-bit big-endian byte length, then the bytes. */
function lengthPrefixed(text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

function u64be(n: number): Buffer {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${String(n)} is not a byte offset`);
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(n), 0);
  return out;
}

/**
 * The server-derived ID of one complete spool line (`eventId` is deliberately NOT a hook nonce):
 *
 *   SHA256( UTF8("ccrc-delegation-event-v1\0") || LP(sessionId) || LP(parentIncarnation) || LP(bucket)
 *           || U64BE(startOffset) || U64BE(endOffset) || SHA256(rawLine) )
 *
 * `rawLine` is the line WITHOUT its LF; `LP` is a 32-bit big-endian byte length then the UTF-8 bytes; the inner hash is the 32 raw
 * digest bytes. Concurrent appends have disjoint offsets, so two lines cannot share an ID; the same bytes at the same coordinate
 * always do, so a re-read is a duplicate and the journal's own deduplication drops it. Neither a PID nor a timestamp is in the
 * preimage. A bucket that changed bytes before an accepted offset is never given a new identity at the old coordinate: that is a
 * replacement, and it is unmeasured (see `ingestDelegationBucket`).
 */
export function deriveDelegationEventId(p: {
  sessionId: string;
  parentIncarnation: string;
  bucket: string;
  startOffset: number;
  endOffset: number;
  rawLine: Uint8Array;
}): string {
  const preimage = Buffer.concat([
    Buffer.from(DELEGATION_EVENT_ID_DOMAIN, 'utf8'),
    lengthPrefixed(p.sessionId), lengthPrefixed(p.parentIncarnation), lengthPrefixed(p.bucket),
    u64be(p.startOffset), u64be(p.endOffset), createHash('sha256').update(p.rawLine).digest(),
  ]);
  return createHash('sha256').update(preimage).digest('hex');
}

// ── the line grammar ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Why one complete line is not an accepted event. Closed, so a detail and a test name a refusal without reading prose. */
export const DELEGATION_LINE_REJECTIONS = [
  'blank-line',            // an empty complete line (the hook writes no fence, so it is never one of its lines)
  'line-too-long',         // the line plus its LF is not LESS than the spool's line bound
  'invalid-utf8',
  'not-an-object',         // valid JSON that is not an object (an array, a number)
  'malformed-json',        // not JSON, or JSON with whitespace or a BOM around the braces (the hook writes none)
  'duplicate-key',
  'bad-version',           // `v` is not the number 1
  'bad-event-kind',        // an event kind, or a kind's tool, outside the closed set
  'unknown-key',
  'missing-key',
  'bad-timestamp',         // `observedAt` is not a canonical UTC millisecond instant
  'owner-mismatch',        // `sessionId` is not the spool owner
  'incarnation-mismatch',  // `parentIncarnation` is not the incarnation this read is bound to
  'bad-field',             // a value of the wrong type, shape, word or bound
] as const;
export type DelegationLineRejection = (typeof DELEGATION_LINE_REJECTIONS)[number];

class LineRejected extends Error {
  constructor(readonly code: DelegationLineRejection) { super(code); this.name = 'LineRejected'; }
}
function reject(code: DelegationLineRejection): never { throw new LineRejected(code); }

/** The bound-derived grammars. Each number comes from `DELEGATION_SPOOL_BOUNDS`; none is restated. */
const ID = new RegExp(`^[A-Za-z0-9_-]{1,${B.idBytes}}$`);
const LISTING_NAME = new RegExp(`^[A-Za-z0-9._@+-]{1,${B.listingNameBytes}}$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A high surrogate without a low one, or the reverse: UTF-8 cannot carry either and the journal's canonical JSON refuses both. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown, maxBytes: number, nonEmpty = false): string => {
  if (typeof v !== 'string' || LONE_SURROGATE.test(v) || Buffer.byteLength(v, 'utf8') > maxBytes || (nonEmpty && v === '')) return reject('bad-field');
  return v;
};
const label = (v: unknown): string => text(v, B.labelBytes);
const requiredLabel = (v: unknown): string => text(v, B.labelBytes, true);
const requiredPath = (v: unknown): string => text(v, B.pathBytes, true);
const path = (v: unknown): string => text(v, B.pathBytes);
const id = (v: unknown): string => (typeof v === 'string' && ID.test(v) ? v : reject('bad-field'));
const nullable = <T>(read: (v: unknown) => T) => (v: unknown): T | null => (v === null ? null : read(v));
const word = <T extends string>(words: readonly T[]) => (v: unknown): T => {
  const hit = words.find((w) => w === v);
  return hit === undefined ? reject('bad-field') : hit;
};
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : reject('bad-field'));

/** A closed object: the keys a variant allows are decided BEFORE any value is read, so a stray key and a missing one never hide
 *  behind a bad value, and the code a refusal carries does not depend on field order. */
function closedKeys(o: Record<string, unknown>, required: readonly string[], optional: readonly string[]): void {
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(o)) if (!allowed.has(k)) reject('unknown-key');
  for (const k of required) if (!Object.hasOwn(o, k)) reject('missing-key');
}

const COMMON_REQUIRED = ['v', 'eventKind', 'observedAt', 'sessionId', 'parentIncarnation', 'claudeSessionId'] as const;
const COMMON_OPTIONAL = ['claudeVersion', 'cwd', 'transcriptPath', 'agentId', 'agentType', 'truncated'] as const;

type Variant =
  | 'SessionStart' | 'SessionEnd' | 'SubagentStart' | 'SubagentStop' | 'UserPromptSubmit'
  | 'PreAgentic' | 'PreBash' | 'PostAgent' | 'PostWorkflow' | 'PostBash';

/** The variant a line names, from its `eventKind` and (for a tool event) its `toolName`; anything outside the closed set is refused. */
function variantOf(o: Record<string, unknown>): Variant {
  if (!Object.hasOwn(o, 'eventKind')) return reject('missing-key');
  const kind = o['eventKind'];
  const tool = o['toolName'];
  switch (kind) {
    case 'SessionStart': case 'SessionEnd': case 'SubagentStart': case 'SubagentStop': case 'UserPromptSubmit': return kind;
    case 'PreToolUse':
      if (!Object.hasOwn(o, 'toolName')) return reject('missing-key');
      if (tool === 'Agent' || tool === 'Task' || tool === 'Workflow') return 'PreAgentic';
      return tool === 'Bash' ? 'PreBash' : reject('bad-event-kind');
    case 'PostToolUse':
      if (!Object.hasOwn(o, 'toolName')) return reject('missing-key');
      if (tool === 'Agent' || tool === 'Task') return 'PostAgent';
      if (tool === 'Workflow') return 'PostWorkflow';
      return tool === 'Bash' ? 'PostBash' : reject('bad-event-kind');
    default: return reject('bad-event-kind');
  }
}

/** The variant-specific keys a line REQUIRES and MAY carry, beyond the common ones. */
const VARIANT_KEYS: Record<Variant, { required: readonly string[]; optional: readonly string[] }> = {
  SessionStart: { required: ['source'], optional: [] },
  SessionEnd: { required: ['reason'], optional: [] },
  SubagentStart: { required: ['agentId', 'agentType'], optional: [] },
  SubagentStop: { required: ['agentId', 'agentType', 'agentTranscriptPath'], optional: [] },
  UserPromptSubmit: { required: ['notification'], optional: [] },
  PreAgentic: { required: ['toolName', 'toolUseId', 'isolation'], optional: [] },
  PreBash: { required: ['toolName', 'toolUseId'], optional: ['listing'] },
  PostAgent: { required: ['toolName', 'toolUseId', 'outcome', 'launch'], optional: [] },
  PostWorkflow: { required: ['toolName', 'toolUseId', 'outcome', 'launch'], optional: [] },
  PostBash: { required: ['toolName', 'toolUseId', 'outcome'], optional: ['listing'] },
};

const AGENT_OUTCOMES = ['completed', 'failed', 'async-launched', 'unknown'] as const;
const BASH_OUTCOMES = ['completed', 'failed', 'unknown'] as const;
const LAUNCH_STATUSES = ['async-launched', 'completed'] as const;
const NOTIFICATION_STATUSES = ['completed', 'failed', 'cancelled', 'unknown'] as const;

function readListing(v: unknown): readonly string[] {
  if (!Array.isArray(v) || v.length > B.listingNames) return reject('bad-field');
  return v.map((n: unknown) => (typeof n === 'string' && LISTING_NAME.test(n) ? n : reject('bad-field')));
}

function readNotification(v: unknown): { taskId: string; toolUseId: string; status: (typeof NOTIFICATION_STATUSES)[number] } {
  if (!isRecord(v)) return reject('bad-field');
  closedKeys(v, ['taskId', 'toolUseId', 'status'], []);
  return { taskId: id(v['taskId']), toolUseId: id(v['toolUseId']), status: word(NOTIFICATION_STATUSES)(v['status']) };
}

function readAgentLaunch(v: unknown) {
  if (!isRecord(v)) return reject('bad-field');
  closedKeys(v, ['status', 'agentId', 'isAsync'], []);
  return { status: word(LAUNCH_STATUSES)(v['status']), agentId: id(v['agentId']), isAsync: bool(v['isAsync']) };
}

function readWorkflowLaunch(v: unknown) {
  if (!isRecord(v)) return reject('bad-field');
  closedKeys(v, ['status', 'taskId', 'taskType', 'workflowName', 'runId', 'transcriptDir', 'scriptPath'], []);
  return {
    status: word(LAUNCH_STATUSES)(v['status']), taskId: id(v['taskId']), taskType: requiredLabel(v['taskType']),
    workflowName: requiredLabel(v['workflowName']), runId: id(v['runId']),
    transcriptDir: requiredPath(v['transcriptDir']), scriptPath: requiredPath(v['scriptPath']),
  };
}

/** The parsed, owner-bound line, or the closed code that refused it. Throws only `LineRejected`. */
function readLine(raw: Record<string, unknown>, owner: { sessionId: string; parentIncarnation: string }): DelegationSpoolLineV1 {
  const variant = variantOf(raw);
  const keys = VARIANT_KEYS[variant];
  // agentId and agentType are optional on every line but REQUIRED on the two subagent lifecycle lines.
  const lifecycle = variant === 'SubagentStart' || variant === 'SubagentStop';
  closedKeys(
    raw,
    [...COMMON_REQUIRED, ...keys.required],
    [...COMMON_OPTIONAL.filter((k) => !(lifecycle && (k === 'agentId' || k === 'agentType'))), ...keys.optional],
  );
  if (raw['v'] !== 1) reject('bad-version');
  const observedAt = raw['observedAt'];
  if (typeof observedAt !== 'string') reject('bad-field');
  try { parseDelegationInstant(String(observedAt)); } catch { reject('bad-timestamp'); }
  const sessionId = raw['sessionId'];
  if (typeof sessionId !== 'string') reject('bad-field');
  if (sessionId !== owner.sessionId) reject('owner-mismatch');
  const incarnation = raw['parentIncarnation'];
  if (typeof incarnation !== 'string' || !UUID.test(incarnation)) reject('bad-field');
  if (incarnation !== owner.parentIncarnation) reject('incarnation-mismatch');

  // Optional members are added ONLY when present: the journal's canonical JSON refuses `undefined`, so a key is absent or it has a value.
  const optional: {
    claudeVersion?: string; cwd?: string; transcriptPath?: string; agentId?: string; agentType?: string | null; truncated?: true;
  } = {};
  if (Object.hasOwn(raw, 'claudeVersion')) optional.claudeVersion = label(raw['claudeVersion']);
  if (Object.hasOwn(raw, 'cwd')) optional.cwd = path(raw['cwd']);
  if (Object.hasOwn(raw, 'transcriptPath')) optional.transcriptPath = path(raw['transcriptPath']);
  if (Object.hasOwn(raw, 'agentId')) optional.agentId = id(raw['agentId']);
  if (Object.hasOwn(raw, 'agentType')) optional.agentType = nullable(label)(raw['agentType']);
  if (Object.hasOwn(raw, 'truncated')) { if (raw['truncated'] !== true) reject('bad-field'); optional.truncated = true; }
  const base = {
    v: 1 as const, observedAt: String(observedAt), sessionId: owner.sessionId, parentIncarnation: owner.parentIncarnation,
    claudeSessionId: id(raw['claudeSessionId']), ...optional,
  };

  switch (variant) {
    case 'SessionStart': return { ...base, eventKind: 'SessionStart', source: requiredLabel(raw['source']) };
    case 'SessionEnd': return { ...base, eventKind: 'SessionEnd', reason: requiredLabel(raw['reason']) };
    case 'SubagentStart':
      return { ...base, eventKind: 'SubagentStart', agentId: id(raw['agentId']), agentType: nullable(label)(raw['agentType']) };
    case 'SubagentStop':
      return {
        ...base, eventKind: 'SubagentStop', agentId: id(raw['agentId']), agentType: nullable(label)(raw['agentType']),
        agentTranscriptPath: nullable(path)(raw['agentTranscriptPath']),
      };
    case 'UserPromptSubmit': return { ...base, eventKind: 'UserPromptSubmit', notification: readNotification(raw['notification']) };
    case 'PreAgentic': {
      const toolName = word(['Agent', 'Task', 'Workflow'] as const)(raw['toolName']);
      return { ...base, eventKind: 'PreToolUse', toolName, toolUseId: id(raw['toolUseId']), isolation: nullable(label)(raw['isolation']) };
    }
    case 'PreBash':
      return {
        ...base, eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: id(raw['toolUseId']),
        ...(Object.hasOwn(raw, 'listing') ? { listing: readListing(raw['listing']) } : {}),
      };
    case 'PostAgent': {
      const toolName = word(['Agent', 'Task'] as const)(raw['toolName']);
      return {
        ...base, eventKind: 'PostToolUse', toolName, toolUseId: id(raw['toolUseId']), outcome: word(AGENT_OUTCOMES)(raw['outcome']),
        launch: nullable(readAgentLaunch)(raw['launch']),
      };
    }
    case 'PostWorkflow':
      return {
        ...base, eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: id(raw['toolUseId']), outcome: word(AGENT_OUTCOMES)(raw['outcome']),
        launch: nullable(readWorkflowLaunch)(raw['launch']),
      };
    case 'PostBash':
      return {
        ...base, eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: id(raw['toolUseId']), outcome: word(BASH_OUTCOMES)(raw['outcome']),
        ...(Object.hasOwn(raw, 'listing') ? { listing: readListing(raw['listing']) } : {}),
      };
  }
}

/**
 * One complete raw line (WITHOUT its LF) against the closed `DelegationSpoolLineV1` union, bound to a spool owner and an
 * incarnation. UTF-8 is decoded fatally HERE, after complete-line framing, so a split multibyte character at a read boundary is a torn
 * tail and never a decode error, while invalid UTF-8 inside a complete line is a refused line. The returned line is a fresh object
 * sharing nothing with the bytes.
 */
export function parseDelegationSpoolLine(
  rawLine: Uint8Array,
  owner: { sessionId: string; parentIncarnation: string },
): { ok: true; line: DelegationSpoolLineV1 } | { ok: false; code: DelegationLineRejection } {
  try {
    if (rawLine.length === 0) reject('blank-line');
    // The bound counts the LF: a line is LESS than the bound, so 'the line plus its LF' must not reach it.
    if (rawLine.length + 1 >= B.lineBytesBelow) reject('line-too-long');
    let textual: string;
    try { textual = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawLine); } catch { return reject('invalid-utf8'); }
    let parsed: unknown;
    try { parsed = JSON.parse(textual); } catch { return reject('malformed-json'); }
    if (!isRecord(parsed)) reject('not-an-object');
    // JSON.parse forgives whitespace around the object (a CR before the LF, a leading space); the hook writes none, so a line that
    // does not open and close with its braces is not a line the hook wrote.
    if (!textual.startsWith('{') || !textual.endsWith('}')) reject('malformed-json');
    if (findDelegationJsonDefect(textual) === 'duplicate-key') reject('duplicate-key');
    return { ok: true, line: readLine(parsed, owner) };
  } catch (err) {
    if (err instanceof LineRejected) return { ok: false, code: err.code };
    throw err;
  }
}

// ── the bucket ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One read of one owner's bucket. `cursor` and `lastSize` are the DURABLE row's. `bytes` begin at `readStart`, which is the row's
 * ANCHOR start when it has an anchor (D-4647: the read re-reads the last line it already stepped over, to prove the bytes before
 * the cursor are unchanged) and the cursor otherwise (zero, for a bucket with no row). `readStart` is an addition to the plan's
 * fixed shape, so that a caller that reads from the wrong place is a gap and never a false replacement.
 */
export interface DelegationBucketInput {
  sessionId: string;
  parentIncarnation: string;
  bucket: string;
  cursor: number;
  lastSize: number;
  size: number;
  bytes: Uint8Array;
  readStart: number;
  bucketPresent: boolean;
  capabilityPresent: boolean | null;
}

/**
 * One accepted event as the durable applier takes it. The plan's sketch types `accepted` as journal RECORDS, but a record carries a
 * sequence, a chain digest, a journal ID and an acceptance instant that only the serialized applier may assign (it numbers under its
 * lock, so a dropped duplicate cannot break the chain) and no pure code may read a clock for. So the entry is carried alone, in
 * the record's own `entry` shape: `result.accepted[i].entry.event` reads exactly as it would on a record.
 */
export interface DelegationAcceptedEvidence {
  readonly entry: Extract<DelegationJournalEntryV1, { kind: 'evidence-accepted' }>;
}

export interface DelegationBucketResult {
  /** The recovery state this result was computed against, unchanged. */
  state: DeepReadonly<DelegationRecoveryState>;
  accepted: readonly DelegationAcceptedEvidence[];
  /** The cursor row to make durable with the accepted events. */
  cursor: DelegationBucketCursor;
  /** Whether the hour this read belongs to was fully observed by it. */
  interval: 'measured' | 'unmeasured';
  detail: string | null;
  /** False for exactly the results that are not for a bucket (`input-invalid`): the adapter refuses them by name and applies
   *  nothing. Every other result, a gap included, is applicable. Read structurally; never decided from `detail`. */
  applicable: boolean;
}

/** What a replaced bucket's detail begins with. Words for a reader of the checkpoint ONLY: the marker nothing reads back is the
 *  structured `replaced` flag on the cursor row (R33). */
export const DELEGATION_BUCKET_REPLACED = 'bucket-replaced';

const BUCKET_NAME = /^\d{10}$/;

/** The canonical start instant of the UTC hour a bucket name (`YYYYMMDDHH`) stands for. Throws for anything that is not an hour. */
export function delegationBucketUtcHour(bucket: string): string {
  if (!BUCKET_NAME.test(bucket)) throw new RangeError(`${JSON.stringify(bucket)} is not a YYYYMMDDHH bucket`);
  const hour = `${bucket.slice(0, 4)}-${bucket.slice(4, 6)}-${bucket.slice(6, 8)}T${bucket.slice(8, 10)}:00:00.000Z`;
  parseDelegationInstant(hour);
  return hour;
}

const isOffset = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** What an owner (a spool directory's name) may be: non-empty, within the owner bound, and no `/` or NUL, so it cannot leave its
 *  directory. The ONE statement: the input check, the adapter and the reader all call it, so they cannot disagree. */
function ownerDefect(owner: unknown): string | null {
  if (typeof owner !== 'string' || owner === '' || Buffer.byteLength(owner, 'utf8') > B.ownerIdBytes || /[/\0]/.test(owner)) return 'sessionId is not an owner';
  return null;
}

/** What is wrong with a bucket's identity (owner, incarnation, bucket name), or null. */
function identityDefect(id: { sessionId: unknown; parentIncarnation: unknown; bucket: unknown }): string | null {
  const owner = ownerDefect(id.sessionId);
  if (owner !== null) return owner;
  if (typeof id.parentIncarnation !== 'string' || id.parentIncarnation === '') return 'parentIncarnation is empty';
  if (typeof id.bucket !== 'string') return 'bucket is not a YYYYMMDDHH hour';
  try { delegationBucketUtcHour(id.bucket); } catch { return 'bucket is not a YYYYMMDDHH hour'; }
  return null;
}

/** The invalid parts of an input, named, or null when it is a bucket read. */
function inputDefect(input: DelegationBucketInput): string | null {
  const identity = identityDefect(input);
  if (identity !== null) return identity;
  for (const k of ['cursor', 'lastSize', 'size', 'readStart'] as const) if (!isOffset(input[k])) return `${k} is not a byte offset`;
  if (!(input.bytes instanceof Uint8Array)) return 'bytes is not a byte array';
  return null;
}

/** The durable row for a bucket as a COPY (the anchor object included), or undefined. */
const durableRow = (state: DeepReadonly<DelegationRecoveryState>, id: { sessionId: string; parentIncarnation: string; bucket: string }): DelegationBucketCursor | undefined => {
  const hit = state.checkpoint.bucketCursors.find((r) => r.sessionId === id.sessionId && r.parentIncarnation === id.parentIncarnation && r.bucket === id.bucket);
  return hit === undefined ? undefined : { ...hit, anchor: hit.anchor === null ? null : { ...hit.anchor } };
};

const freshRow = (id: { sessionId: string; parentIncarnation: string; bucket: string }): DelegationBucketCursor =>
  ({ ...id, cursor: 0, lastSize: 0, lastCompleteAt: null, intervalState: 'measured', detail: null, anchor: null, replaced: false });

/** A read that measured nothing about this hour: the durable row survives untouched (or a fresh row at zero), marked unmeasured. A
 *  gap NEVER clears `replaced` (R33): the flag is copied from the row, whatever else went wrong. */
function gap(
  state: DeepReadonly<DelegationRecoveryState>,
  id: { sessionId: string; parentIncarnation: string; bucket: string },
  detail: string,
  replaced = false,
  applicable = true,
): DelegationBucketResult {
  const row = durableRow(state, id) ?? freshRow(id);
  // A replaced bucket keeps its replaced words on the ROW (N1), however many other gaps come after: the row's detail is what every
  // later tick answers. This read's own reason still goes on the result, for the hour's interval.
  const rowDetail = row.replaced && row.detail !== null ? row.detail : detail;
  return { state, accepted: [], cursor: { ...row, intervalState: 'unmeasured', detail: rowDetail, replaced: row.replaced || replaced }, interval: 'unmeasured', detail, applicable };
}

/** Why a bucket could not be read at all. The reader's and `unreadableDelegationBucketResult`'s shared vocabulary. Server-internal
 *  detail words (R34), not wire words. */
export const DELEGATION_BUCKET_UNREADABLE_REASONS = [
  'capability-absent', 'capability-unmeasured', 'directory-absent', 'directory-unreadable', 'range-unreadable', 'bucket-vanished-unread', 'input-invalid',
] as const;
export type DelegationBucketUnreadableReason = (typeof DELEGATION_BUCKET_UNREADABLE_REASONS)[number];

/** The result for a bucket whose read could not be made: unmeasured, nothing accepted, the durable row kept (the replaced flag too). */
export function unreadableDelegationBucketResult(
  id: { sessionId: string; parentIncarnation: string; bucket: string },
  state: DeepReadonly<DelegationRecoveryState>,
  why: { reason: DelegationBucketUnreadableReason; detail: string },
): DelegationBucketResult {
  return gap(state, id, `${why.reason}: ${why.detail}`, false, why.reason !== 'input-invalid');
}

/** Counts per refusal code, in code order, so the same bytes always read the same. */
const refusalSummary = (counts: ReadonlyMap<DelegationLineRejection, number>, refused: number, complete: number): string =>
  `${refused} of ${complete} complete lines refused: ${[...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([c, n]) => `${c}=${n}`).join(', ')}`;

const LF = 0x0a;
const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Ingests one bucket read. PURE: no IO, no clock, nothing mutated (the state and the bytes are only read).
 *
 * The order of its decisions, each answering before the next is asked:
 *   1. an input that is not a bucket read: a gap (nothing identifies a row).
 *   2. a durable row marked `replaced`: a gap with the replaced detail, however the file has grown since (R33; checked before
 *      everything below, so no other gap can replace it);
 *   3. a recovery that has not finished, or a capability that is not present: a gap;
 *   4. a read that does not start at the durable coordinate (cursor, last-seen size, or the window's start): a gap, row kept;
 *   5. an absent bucket: healthy when everything in it was read, a gap (a vanished unread suffix) when not;
 *   6. a bucket shorter than the cursor or the last-seen size: a REPLACEMENT (sticky);
 *   7. a row with a cursor and no anchor, or more bytes than the file has: a gap;
 *   8. the anchor line (D-4647) re-read from the anchor start must still be exactly one complete line with the anchor's SHA-256,
 *      or the bucket is REPLACED (sticky): this is how "changed bytes before an accepted offset" is detected;
 *   9. otherwise frame the COMPLETE lines after the anchor line, accept the valid ones with their offsets and IDs, step the cursor
 *      over every complete line (accepted or refused) and nothing else, and anchor the last one. Any refused complete line, or a
 *      torn tail too long to ever be a line, makes the interval a gap. A torn tail that may still complete is reported in the
 *      detail and is not a gap; neither is a read capped at the read bound (its unread remainder is named).
 */
export function ingestDelegationBucket(input: DelegationBucketInput, state: DeepReadonly<DelegationRecoveryState>): DelegationBucketResult {
  const id = { sessionId: input.sessionId, parentIncarnation: input.parentIncarnation, bucket: input.bucket };
  const defect = inputDefect(input);
  if (defect !== null) return gap(state, id, `input-invalid: ${defect}`, false, false);

  const prior = durableRow(state, id);
  if (prior !== undefined && prior.replaced) return gap(state, id, prior.detail ?? `${DELEGATION_BUCKET_REPLACED}: this bucket was replaced`);
  if (state.phase !== 'ready') return gap(state, id, 'recovery-not-ready: the observation lane is reconstructing');
  if (input.capabilityPresent === false) return gap(state, id, 'capability-absent');
  if (input.capabilityPresent === null) return gap(state, id, 'capability-unmeasured');

  const durable = prior ?? freshRow(id);
  const expectedStart = durable.anchor?.start ?? durable.cursor;
  if (input.cursor !== durable.cursor || input.lastSize !== durable.lastSize) {
    return gap(state, id, `cursor-disagrees-with-durable-state: the read starts at ${input.cursor} (last seen ${input.lastSize}), the accepted coordinate is ${durable.cursor} (last seen ${durable.lastSize})`);
  }
  if (input.readStart !== expectedStart) {
    return gap(state, id, `read-window-mismatch: the bytes begin at ${input.readStart}, the durable row needs them from ${expectedStart}`);
  }

  if (!input.bucketPresent) {
    if (input.bytes.length > 0 || input.size !== 0) return gap(state, id, 'input-inconsistent: an absent bucket carries bytes or a size');
    if (input.cursor < input.lastSize) {
      return gap(state, id, `bucket-vanished-unread: the bucket is gone with ${input.lastSize - input.cursor} bytes after offset ${input.cursor} never read`);
    }
    return { state, accepted: [], cursor: { ...durable, intervalState: 'measured', detail: null }, interval: 'measured', detail: null, applicable: true };
  }

  if (input.size < input.cursor || input.size < input.lastSize) {
    const below = input.size < input.cursor ? `the cursor ${input.cursor}` : `the last-seen size ${input.lastSize}`;
    return gap(state, id, `${DELEGATION_BUCKET_REPLACED}: size ${input.size} is below ${below}`, true);
  }
  if (input.cursor > 0 && durable.anchor === null) {
    return gap(state, id, `cursor-unanchored: the durable row stands at ${input.cursor} with no anchor line to verify, so the bytes before it cannot be proved`);
  }
  if (input.bytes.length > input.size - input.readStart) {
    return gap(state, id, `range-inconsistent: ${input.bytes.length} bytes read from ${input.readStart} of a file of ${input.size}`);
  }

  // D-4647: the anchor line must read back exactly as it was stepped over: one complete line ending at the cursor, and the same bytes.
  let lineStart = 0;
  if (durable.anchor !== null) {
    const anchorLength = input.cursor - durable.anchor.start;
    const intact = anchorLength >= 1 && input.bytes.length >= anchorLength
      && input.bytes[anchorLength - 1] === LF && input.bytes.indexOf(LF) === anchorLength - 1
      && sha256Hex(input.bytes.subarray(0, anchorLength - 1)) === durable.anchor.sha256;
    if (!intact) {
      return gap(state, id, `${DELEGATION_BUCKET_REPLACED}: the last accepted line at offsets ${durable.anchor.start}..${input.cursor} no longer reads the same`, true);
    }
    lineStart = anchorLength;
  }

  // Frame complete lines. A line is the bytes up to an LF; what follows the last LF is a torn tail and is never consumed.
  const owner = { sessionId: input.sessionId, parentIncarnation: input.parentIncarnation };
  const events: DelegationAcceptedEvidence[] = [];
  const refusals = new Map<DelegationLineRejection, number>();
  let refused = 0;
  let complete = 0;
  let lastCompleteAt = durable.lastCompleteAt;
  let anchor = durable.anchor;
  for (let at = input.bytes.indexOf(LF, lineStart); at >= 0; at = input.bytes.indexOf(LF, lineStart)) {
    const rawLine = input.bytes.subarray(lineStart, at);
    const startOffset = input.readStart + lineStart;
    const endOffset = input.readStart + at + 1;
    complete += 1;
    const parsed = parseDelegationSpoolLine(rawLine, owner);
    if (parsed.ok) {
      const event: DelegationEventEnvelopeV1 = {
        ...parsed.line, eventId: deriveDelegationEventId({ ...id, startOffset, endOffset, rawLine }), bucket: input.bucket, startOffset, endOffset,
      };
      events.push({ entry: { kind: 'evidence-accepted', event } });
      if (lastCompleteAt === null || event.observedAt > lastCompleteAt) lastCompleteAt = event.observedAt;
    } else {
      refused += 1;
      refusals.set(parsed.code, (refusals.get(parsed.code) ?? 0) + 1);
    }
    anchor = { start: startOffset, sha256: sha256Hex(rawLine) };
    lineStart = at + 1;
  }

  const framedTo = input.readStart + lineStart;
  const tail = input.bytes.length - lineStart;
  const unread = input.size - (input.readStart + input.bytes.length);
  // N2: a window that ended before the file did and framed no complete line past the anchor makes no progress, and will make none
  // (a long refused line as the anchor can leave the window too little room). That is a gap with a reason, never "measured".
  if (unread > 0 && complete === 0) {
    return gap(state, id, `window-starved: ${input.bytes.length} bytes read from ${input.readStart} frame no complete line past the cursor ${input.cursor}, and ${unread} bytes beyond the window are unread`);
  }
  const problems: string[] = [];
  if (refused > 0) problems.push(refusalSummary(refusals, refused, complete));
  // The line bound counts the LF: a tail already at one byte short of the bound can only complete into a line that is too long.
  const tailTooLong = tail + 1 >= B.lineBytesBelow;
  if (tailTooLong) problems.push(`torn-tail-over-long: ${tail} bytes after offset ${framedTo} with no LF can never be a line`);
  // A window that ended before the file did leaves bytes UNREAD, not torn: the next tick continues from the anchor.
  const note = unread > 0 ? `capped-read: ${unread} bytes beyond the read window are unread`
    : tail > 0 && !tailTooLong ? `torn-tail: ${tail} unframed bytes after offset ${framedTo}` : null;

  const interval = problems.length > 0 ? 'unmeasured' : 'measured';
  const detail = problems.length > 0 ? problems.join('; ') : note;
  return {
    state,
    accepted: events,
    cursor: { ...id, cursor: framedTo, lastSize: input.size, lastCompleteAt, intervalState: interval, detail, anchor, replaced: false },
    interval,
    detail,
    applicable: true,
  };
}

// IMPURE SHELL: the reader, which turns two measured reads into an input, and the adapter, which makes one result durable.

/** The durable applier as ingestion sees it. R28 (D-4645): file IO makes the plan's synchronous sketch asynchronous. */
export interface DelegationBucketDurability {
  /** Journals the accepted events, checkpoints the cursor and interval, then projects; resolves with the state AFTER the replacement. */
  applyBucketResult(result: DelegationBucketResult): Promise<DeepReadonly<DelegationRecoveryState>>;
}

/**
 * `ingestDelegationBucket`, then one durable application. The ONLY stateful call is `durability.applyBucketResult(result)`; nothing
 * of the result (no accepted ID, cursor or interval) is exposed to the caller before that call resolves. A rejection (a failed
 * durable step, a reconstructing applier) propagates and returns no state.
 */
export async function ingestAndApplyDelegationBucket(
  input: DelegationBucketInput,
  state: DeepReadonly<DelegationRecoveryState>,
  durability: DelegationBucketDurability,
): Promise<DeepReadonly<DelegationRecoveryState>> {
  const result = ingestDelegationBucket(input, state);
  refuseInapplicable(result);
  return durability.applyBucketResult(result);
}

/**
 * The durable applier's bucket door. It maps a result to ONE `applyAccepted` batch: the accepted events (the applier assigns each its
 * sequence and chain under its lock, and stamps `acceptedAt` from its own injected clock), a COPY of the cursor, and the hour's
 * interval, recorded at the injected `now`. It hands over copies of what it keeps, so a caller who holds the result cannot rewrite
 * the applier's rows. `now` is the adapter's one clock (epoch milliseconds); no pure code above reads it.
 */
export function delegationBucketDurabilityOf(
  durable: { applyAccepted(batch: DelegationDurableBatch): Promise<{ state: DeepReadonly<DelegationRecoveryState> }> },
  now: () => number,
): DelegationBucketDurability {
  return {
    async applyBucketResult(result) {
      // No `input-invalid` result is ever applied (M5): the result says so STRUCTURALLY (`applicable`), and a row with a bad identity is
      // refused too, as a second line, so neither can reach the hour arithmetic (a bare RangeError) or the checkpoint's reader.
      refuseInapplicable(result);
      const interval: DelegationObservationInterval = {
        sessionId: result.cursor.sessionId, parentIncarnation: result.cursor.parentIncarnation, utcHour: delegationBucketUtcHour(result.cursor.bucket),
        state: result.interval, detail: result.detail, recordedAt: formatDelegationInstant(now()),
      };
      const outcome = await durable.applyAccepted({
        accepted: result.accepted.map((a) => ({ event: a.entry.event })),
        cursor: { ...result.cursor, anchor: result.cursor.anchor === null ? null : { ...result.cursor.anchor } },
        interval,
      });
      return outcome.state;
    },
  };
}

/** Throws the named refusal for a result that is not for a bucket. Reads `applicable` and the row's identity; never the detail text. */
function refuseInapplicable(result: DelegationBucketResult): void {
  const defect = identityDefect(result.cursor);
  if (!result.applicable || defect !== null) {
    throw new DelegationIngestError('input-invalid', `the result is not for a bucket and was not applied${defect === null ? '' : `: ${defect}`}`);
  }
}

/** Why ingestion refused to hand something to the durable applier. `input-invalid` is the only code: a result that is not for a bucket. */
export class DelegationIngestError extends Error {
  constructor(readonly code: 'input-invalid', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'DelegationIngestError';
  }
}

export interface DelegationBucketReadRequest {
  /** The owner's spool directory (`<spool>/<owner>`). */
  ownerDir: string;
  sessionId: string;
  parentIncarnation: string;
  bucket: string;
  /** The DURABLE row's coordinate (zero and zero for a bucket the checkpoint has no row for). */
  cursor: number;
  lastSize: number;
  /** The durable row's anchor start, or null (D-4647). The read begins HERE, to re-read the line the cursor last stepped over. */
  anchorStart: number | null;
  capabilityPresent: boolean | null;
  /** The owner directory's listing, read once per owner by the caller. A failed listing makes every bucket of the owner unmeasured. */
  listing: MeasuredDirectoryRead;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type DelegationBucketRead =
  | { ok: true; input: DelegationBucketInput }
  | { ok: false; reason: DelegationBucketUnreadableReason; detail: string };

/**
 * Turns a directory listing and (when the bucket is in it) one bounded byte-range read into a bucket input, or says WHY it could not.
 * It reads through the existing `FleetIO` only (the byte reader, and `statMeasured` to tell a cut from a failure), at the largest
 * bound, from the durable row's anchor (else its cursor). Nothing is ever fabricated:
 *   - a missing capability reads nothing;
 *   - a failed or absent owner directory is `ok: false`;
 *   - a range the io cannot prove is `range-unreadable`, EXCEPT when the file now measures SHORTER than the cursor: the io answers
 *     `unreadable` for an offset past the size, so the reader asks `statMeasured` and, on a measured size below the cursor, hands
 *     ingestion that size with no bytes, which it classifies as a replacement (I2);
 *   - a listed bucket that answers ENOENT is a gap (`bucket-vanished-unread`) unless the durable row proves it was read to its end
 *     (the hook's own prune); only a SUCCESSFUL listing without the bucket is a measured absence (I3).
 */
export async function readDelegationBucket(
  io: Pick<FleetIO, 'readFileFromBytesMeasured' | 'statMeasured'>,
  req: DelegationBucketReadRequest,
): Promise<DelegationBucketRead> {
  const bad = (reason: DelegationBucketUnreadableReason, detail: string): DelegationBucketRead => ({ ok: false, reason, detail });
  const owner = req.sessionId;
  if (ownerDefect(owner) !== null || !BUCKET_NAME.test(req.bucket) || !isOffset(req.cursor) || !isOffset(req.lastSize)
      || (req.anchorStart !== null && (!isOffset(req.anchorStart) || req.anchorStart > req.cursor))) {
    return bad('input-invalid', 'the request does not name an owner, an hourly bucket and a durable coordinate');
  }
  if (req.capabilityPresent === false) return bad('capability-absent', 'the fleet does not offer delegation events');
  if (req.capabilityPresent === null) return bad('capability-unmeasured', 'the delegation capability could not be measured');
  if (!req.listing.ok) {
    return req.listing.reason === 'absent'
      ? bad('directory-absent', 'the owner spool directory does not exist')
      : bad('directory-unreadable', 'the owner spool directory could not be listed');
  }
  const readStart = req.anchorStart ?? req.cursor;
  const inputOf = (over: Pick<DelegationBucketInput, 'size' | 'bytes' | 'bucketPresent'>): DelegationBucketRead => ({
    ok: true,
    input: {
      sessionId: req.sessionId, parentIncarnation: req.parentIncarnation, bucket: req.bucket, cursor: req.cursor, lastSize: req.lastSize,
      readStart, capabilityPresent: true, ...over,
    },
  });
  const absent = inputOf({ size: 0, bytes: new Uint8Array(0), bucketPresent: false });
  const name = `${req.bucket}.spool`;
  if (!req.listing.entries.includes(name)) return absent;
  const file = `${req.ownerDir}/${name}`;
  const range = await io.readFileFromBytesMeasured(file, readStart, READ_FROM_MAX_BYTES, req.timeoutMs, req.signal);
  if (range.ok) return inputOf({ size: range.size, bytes: range.bytes, bucketPresent: true });
  if (range.reason === 'absent') {
    // The listing NAMED this bucket, so it existed. Gone now is a healthy prune only if everything in it was already read.
    return req.cursor === req.lastSize && req.cursor > 0
      ? absent
      : bad('bucket-vanished-unread', 'the bucket was listed and is gone before it was fully read');
  }
  // Unreadable. An offset past the end of the file is what the io calls unreadable for a CUT, so measure the size before calling it a failure.
  // An aborted request makes no further call (N3); the stat's own deadline is the io's default, a Task 13 tick-budget note.
  if (req.signal?.aborted === true) return bad('range-unreadable', 'the byte range of the bucket could not be read, and the request was aborted');
  const stat = await io.statMeasured(file);
  if (stat.ok && stat.size < req.cursor) return inputOf({ size: stat.size, bytes: new Uint8Array(0), bucketPresent: true });
  return bad('range-unreadable', 'the byte range of the bucket could not be read');
}
