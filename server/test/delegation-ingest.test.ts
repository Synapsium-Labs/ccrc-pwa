// Delegation broker wave 3, Task 9: per-bucket ingestion with honest gaps.
//
// The hook (Task 5) appends one bounded JSON line per delegation event to an owner's hourly spool bucket; the server reads a bucket
// by byte range, frames COMPLETE lines, validates each against the closed `DelegationSpoolLineV1` union, derives each event's ID
// from its coordinates and bytes, and hands the accepted events, the bucket cursor and the hour's interval to Task 8's durable
// applier as ONE application. Rows here hold it to the plan's Task 9 steps 1 to 3 and to W3-M07 to M11, M60, M61 (the read side),
// M69 and M70. Every event-ID vector below is computed independently of the implementation (Python's hashlib over a preimage spelled
// out byte by byte), and every file is in a FIXTURE directory: nothing here reads or writes a live `~/.ccrc` or `~/.cc-sessions`.
//
//   W3-M07  advance the cursor over a torn tail                     -> 'torn tail' rows
//   W3-M08  treat a malformed complete line as measured empty       -> 'malformed complete line' rows
//   W3-M09  treat a vanished unread suffix as healthy               -> 'vanished bucket' rows
//   W3-M10  accept an envelope sessionId other than the spool owner -> 'owner mismatch' rows
//   W3-M11  remove eventId idempotency                              -> 'duplicate re-read' rows
//   W3-M60  omit the parent incarnation, or accept it after reuse   -> 'incarnation binding' rows
//   W3-M61  rebuild bytes from decoded text (the read side)         -> 'transport' rows (the reader's own half; remote-io.test.ts owns the wire)
//   W3-M69  omit a variant or required field, or keep arbitrary content -> 'closed envelope' rows
//   W3-M70  change the event-ID preimage                            -> 'event-ID vectors' rows
import { afterEach, describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DELEGATION_EVENT_KINDS, DELEGATION_SPOOL_BOUNDS, type DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';
import { createIo } from '../src/remote/io.js';
import type { FleetClient } from '../src/remote/client.js';
import { localIO, type FleetIO, type MeasuredByteRangeRead, type MeasuredDirectoryRead } from '../src/io.js';
import {
  emptyDelegationCheckpoint,
  type DeepReadonly,
  type DelegationBucketCursor,
  type DelegationRecoveryState,
} from '../src/coord/delegation-model.js';
import {
  DelegationDurability,
  type DelegationApplyOutcome,
  type DelegationCheckpointChange,
  type DelegationDurabilityDeps,
} from '../src/coord/delegation-checkpoint.js';
import {
  DELEGATION_BUCKET_REPLACED,
  DELEGATION_EVENT_ID_DOMAIN,
  DELEGATION_LINE_REJECTIONS,
  delegationBucketDurabilityOf,
  delegationBucketUtcHour,
  deriveDelegationEventId,
  ingestAndApplyDelegationBucket,
  ingestDelegationBucket,
  parseDelegationSpoolLine,
  readDelegationBucket,
  unreadableDelegationBucketResult,
  type DelegationBucketDurability,
  type DelegationBucketInput,
  type DelegationBucketResult,
} from '../src/coord/delegation-ingest.js';
import { mkTmp } from './tmpHelpers.js';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const OWNER = 'lane-a-demo';
const INC = '0189abcd-1234-5678-9abc-0123456789ab';
const OTHER_INC = '7f3c9a10-5555-4aaa-8bbb-0123456789cd';
const CLAUDE = '6350faa0-a1be-4e78-939c-57485268f6fc';
const BUCKET = '2026101412';
const HOUR = '2026-10-14T12:00:00.000Z';
const B = DELEGATION_SPOOL_BOUNDS;

const enc = new TextEncoder();
const dec = new TextDecoder();
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const cat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
/** A line as the hook writes it: compact JSON, then LF. */
const lineOf = (obj: unknown): Uint8Array => enc.encode(`${JSON.stringify(obj)}\n`);

type Obj = Record<string, unknown>;
const common = (eventKind: string, extra: Obj = {}, over: Obj = {}): Obj =>
  ({ v: 1, eventKind, observedAt: '2026-10-14T12:00:00.000Z', sessionId: OWNER, parentIncarnation: INC, claudeSessionId: CLAUDE, ...extra, ...over });

const AGENT_LAUNCH = { status: 'async-launched', agentId: 'agent-abc123', isAsync: true };
const WORKFLOW_LAUNCH = {
  status: 'async-launched', taskId: 'task_1', taskType: 'local_workflow', workflowName: 'review-pass', runId: 'run-9f',
  transcriptDir: '/work/.claude/workflows/run-9f', scriptPath: '/work/.claude/workflows/review-pass.js',
};

/** Every variant of the closed union, valid, with the keys it REQUIRES beyond the common required ones. */
const COMMON_REQUIRED = ['v', 'eventKind', 'observedAt', 'sessionId', 'parentIncarnation', 'claudeSessionId'];
const VARIANTS: ReadonlyArray<readonly [string, Obj, readonly string[]]> = [
  ['SessionStart', common('SessionStart', { source: 'startup' }), ['source']],
  ['SessionStart (compact, every optional common field)', common('SessionStart', {
    source: 'compact', claudeVersion: '2.1.299', cwd: '/work/repo', transcriptPath: '/work/t.jsonl', agentId: 'agent-abc123', agentType: 'general-purpose', truncated: true,
  }), ['source']],
  ['SessionEnd', common('SessionEnd', { reason: 'clear' }), ['reason']],
  ['SubagentStart', common('SubagentStart', { agentId: 'agent-abc123', agentType: null }), ['agentId', 'agentType']],
  ['SubagentStop (path)', common('SubagentStop', { agentId: 'agent-abc123', agentType: 'general-purpose', agentTranscriptPath: '/work/agent-abc123.jsonl' }), ['agentId', 'agentType', 'agentTranscriptPath']],
  ['SubagentStop (null path)', common('SubagentStop', { agentId: 'agent-abc123', agentType: null, agentTranscriptPath: null }), ['agentId', 'agentType', 'agentTranscriptPath']],
  ['UserPromptSubmit', common('UserPromptSubmit', { notification: { taskId: 'task_1', toolUseId: 'toolu_1', status: 'completed' } }), ['notification']],
  ['PreToolUse Agent', common('PreToolUse', { toolName: 'Agent', toolUseId: 'toolu_2', isolation: null }), ['toolName', 'toolUseId', 'isolation']],
  ['PreToolUse Task', common('PreToolUse', { toolName: 'Task', toolUseId: 'toolu_2', isolation: 'worktree' }), ['toolName', 'toolUseId', 'isolation']],
  ['PreToolUse Workflow', common('PreToolUse', { toolName: 'Workflow', toolUseId: 'toolu_2', isolation: null }), ['toolName', 'toolUseId', 'isolation']],
  ['PreToolUse Bash (listing)', common('PreToolUse', { toolName: 'Bash', toolUseId: 'toolu_3', listing: ['agent-a1b2', 'wt.1@x+y'] }), ['toolName', 'toolUseId']],
  ['PreToolUse Bash (no listing)', common('PreToolUse', { toolName: 'Bash', toolUseId: 'toolu_3' }), ['toolName', 'toolUseId']],
  ['PostToolUse Agent (launch)', common('PostToolUse', { toolName: 'Agent', toolUseId: 'toolu_4', outcome: 'async-launched', launch: AGENT_LAUNCH }), ['toolName', 'toolUseId', 'outcome', 'launch']],
  ['PostToolUse Task (null launch)', common('PostToolUse', { toolName: 'Task', toolUseId: 'toolu_4', outcome: 'failed', launch: null }), ['toolName', 'toolUseId', 'outcome', 'launch']],
  ['PostToolUse Workflow (launch)', common('PostToolUse', { toolName: 'Workflow', toolUseId: 'toolu_5', outcome: 'async-launched', launch: WORKFLOW_LAUNCH }), ['toolName', 'toolUseId', 'outcome', 'launch']],
  ['PostToolUse Workflow (null launch)', common('PostToolUse', { toolName: 'Workflow', toolUseId: 'toolu_5', outcome: 'unknown', launch: null }), ['toolName', 'toolUseId', 'outcome', 'launch']],
  ['PostToolUse Bash (empty listing)', common('PostToolUse', { toolName: 'Bash', toolUseId: 'toolu_6', outcome: 'completed', listing: [] }), ['toolName', 'toolUseId', 'outcome']],
  ['PostToolUse Bash', common('PostToolUse', { toolName: 'Bash', toolUseId: 'toolu_6', outcome: 'failed' }), ['toolName', 'toolUseId', 'outcome']],
];

const cursorRow = (cursor: number, lastSize: number, over: Partial<DelegationBucketCursor> = {}): DelegationBucketCursor =>
  ({ sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, cursor, lastSize, lastCompleteAt: null, intervalState: 'measured', detail: null, ...over });
const stateWith = (rows: readonly DelegationBucketCursor[] = [], phase: 'ready' | 'reconstructing' = 'ready'): DelegationRecoveryState =>
  ({ checkpoint: { ...emptyDelegationCheckpoint(), bucketCursors: rows }, phase });
const inputOf = (bytes: Uint8Array, over: Partial<DelegationBucketInput> = {}): DelegationBucketInput =>
  ({ sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, cursor: 0, lastSize: 0, size: bytes.length, bytes, bucketPresent: true, capabilityPresent: true, ...over });
const ingest = (bytes: Uint8Array, over: Partial<DelegationBucketInput> = {}, state: DelegationRecoveryState = stateWith()): DelegationBucketResult =>
  ingestDelegationBucket(inputOf(bytes, over), state);
const eventsOf = (r: DelegationBucketResult): DelegationEventEnvelopeV1[] =>
  r.accepted.map((a) => a.entry.event as DelegationEventEnvelopeV1);
/** The input a driver builds for its NEXT read from the cursor a result left, with `more` bytes appended to the bucket. */
const nextRead = (prev: DelegationBucketResult, bytes: Uint8Array, size: number, over: Partial<DelegationBucketInput> = {}) =>
  ({ input: inputOf(bytes, { cursor: prev.cursor.cursor, lastSize: prev.cursor.lastSize, size, ...over }), state: stateWith([prev.cursor]) });

// ── Step 1: framing, offsets, and the server-derived event ID ─────────────────────────────────────────────────────────

describe('event-ID vectors (W3-M70): the preimage is exact, in this order and encoding', () => {
  // Python: lp = lambda s: struct.pack('>I', len(s.encode())) + s.encode(); sha256(b"ccrc-delegation-event-v1\0" + lp(sessionId) +
  //   lp(parentIncarnation) + lp(bucket) + struct.pack('>Q', start) + struct.pack('>Q', end) + sha256(rawLine).digest()).hexdigest()
  const RAW = enc.encode('{"v":1,"eventKind":"SessionStart","observedAt":"2026-10-14T12:00:00.000Z","sessionId":"lane-a-demo","parentIncarnation":"0189abcd-1234-5678-9abc-0123456789ab","claudeSessionId":"6350faa0-a1be-4e78-939c-57485268f6fc","source":"startup"}');
  const RAW_MULTIBYTE = enc.encode('{"v":1,"eventKind":"SessionStart","observedAt":"2026-10-14T12:00:00.000Z","sessionId":"lane-a-demo","parentIncarnation":"0189abcd-1234-5678-9abc-0123456789ab","claudeSessionId":"6350faa0-a1be-4e78-939c-57485268f6fc","cwd":"/work/é-日本-😀","source":"startup"}');
  const RAW_RESUME = enc.encode(dec.decode(RAW).replace('startup', 'resume'));
  const N = RAW.length;
  const id = (over: Partial<Parameters<typeof deriveDelegationEventId>[0]> = {}): string => deriveDelegationEventId({
    sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, startOffset: 0, endOffset: N + 1, rawLine: RAW, ...over,
  });

  const VECTORS: ReadonlyArray<readonly [string, string, string]> = [
    ['the base line at offsets 0..N+1', id(), 'cc7194ab51957d6cf7b4c2c5c7d46f16fd680c3e92f29d51f4f88b858d128c72'],
    ['the same bytes at another coordinate', id({ startOffset: 4096, endOffset: 4096 + N + 1 }), '96a8a0a4c531c495a4df83e6a68685e7bde2610ed3954a62122c3d90e7582c13'],
    ['an offset above 2^32 (the U64 is eight bytes, not four)', id({ startOffset: 4294967296, endOffset: 4294967296 + N + 1 }), '926a6c2079fc5dc1e5053090f0a8fb6fd32e526c9bcc80d2a263b1ec7f282374'],
    ['another bucket', id({ bucket: '2026101413' }), 'bf49b5650ca0aff68be06c07a5f376c64a39fff7e3c0cafaacec6df47ae24233'],
    ['another owner session', id({ sessionId: 'lane-a-demo2' }), 'f7fcef46053d01775fbe1dea4f5d1cab752da546183ba5d8488f4997458a6ccd'],
    ['another incarnation', id({ parentIncarnation: OTHER_INC }), '23cac7211af16b5ee4b38365ab5fd48af6c6572348f86d4567775047fa081a05'],
    ['other raw bytes', id({ rawLine: RAW_RESUME, endOffset: RAW_RESUME.length + 1 }), 'f68af6269582a3328447850b6affde07512b1c065cea2e80f21d2ec011b8c867'],
    ['multibyte raw bytes (lengths are bytes, not characters)', id({ rawLine: RAW_MULTIBYTE, endOffset: RAW_MULTIBYTE.length + 1 }), 'c2146fe96a4f3ad37ccbc3d05e3c5acedfdf163aadad114b34215bea7dc5207c'],
    ['multibyte raw bytes at another coordinate', id({ rawLine: RAW_MULTIBYTE, startOffset: 77, endOffset: 77 + RAW_MULTIBYTE.length + 1 }), 'ee05379e1cc9d1e411351bb778fc038bbe6b2e3b1601fe7c79045822a83ec02e'],
  ];
  it.each(VECTORS)('%s', (_label, actual, expected) => { expect(actual).toBe(expected); });

  it('the vectors are all different, so changing any one component changes the ID', () => {
    expect(new Set(VECTORS.map((v) => v[1])).size).toBe(VECTORS.length);
  });

  it('the preimage is spelled out here byte by byte and equals the implementation (domain, then LP-UTF8 x3, then U64BE x2, then the raw digest)', () => {
    const lp = (s: string): Uint8Array => { const b = enc.encode(s); const h = new Uint8Array(4); new DataView(h.buffer).setUint32(0, b.length, false); return cat(h, b); };
    const u64 = (n: number): Uint8Array => { const h = new Uint8Array(8); new DataView(h.buffer).setBigUint64(0, BigInt(n), false); return h; };
    const pre = cat(enc.encode('ccrc-delegation-event-v1\0'), lp(OWNER), lp(INC), lp(BUCKET), u64(0), u64(N + 1), createHash('sha256').update(RAW).digest());
    expect(sha(pre)).toBe(id());
    expect(DELEGATION_EVENT_ID_DOMAIN).toBe('ccrc-delegation-event-v1\0');
  });

  it('the inner hash is the 32 raw digest bytes, not their hex spelling', () => {
    const lp = (s: string): Uint8Array => { const b = enc.encode(s); const h = new Uint8Array(4); new DataView(h.buffer).setUint32(0, b.length, false); return cat(h, b); };
    const u64 = (n: number): Uint8Array => { const h = new Uint8Array(8); new DataView(h.buffer).setBigUint64(0, BigInt(n), false); return h; };
    const hexVariant = cat(enc.encode('ccrc-delegation-event-v1\0'), lp(OWNER), lp(INC), lp(BUCKET), u64(0), u64(N + 1), enc.encode(sha(RAW)));
    expect(sha(hexVariant)).not.toBe(id());
  });

  it('PID and timestamp reuse are irrelevant: the same bytes at the same coordinate are the same ID on every call, whatever else changed', () => {
    const a = id();
    const clock = Date.now;
    expect(id()).toBe(a);
    expect(id({ rawLine: RAW.slice() })).toBe(a);
    expect(typeof clock).toBe('function');
  });

  it('concurrent appends have DISJOINT offsets, so two different lines can never collide, and identical bytes at disjoint offsets are distinct events', () => {
    const l = lineOf(common('SessionStart', { source: 'startup' }));
    const r = ingest(cat(l, l, l));
    const ids = eventsOf(r).map((e) => e.eventId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(eventsOf(r).map((e) => [e.startOffset, e.endOffset])).toEqual([[0, l.length], [l.length, 2 * l.length], [2 * l.length, 3 * l.length]]);
  });

  it('ingestion derives each accepted event\'s ID from the raw line EXCLUDING its LF, with offsets covering the LF', () => {
    const l = lineOf(common('SessionStart', { source: 'startup' }));
    const r = ingest(l, { cursor: 0 });
    const e = eventsOf(r)[0]!;
    expect(e.eventId).toBe(deriveDelegationEventId({ sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, startOffset: 0, endOffset: l.length, rawLine: l.subarray(0, l.length - 1) }));
    expect(e.endOffset).toBe(l.length);
  });
});

describe('framing: byte offsets, complete lines only', () => {
  const l1 = lineOf(common('SessionStart', { source: 'startup' }));
  const l2 = lineOf(common('SessionEnd', { reason: 'clear' }, { observedAt: '2026-10-14T12:00:05.000Z' }));
  const l3 = lineOf(common('SubagentStart', { agentId: 'agent-abc123', agentType: null }, { observedAt: '2026-10-14T12:00:09.000Z' }));

  it('complete lines are accepted in order with byte offsets, and the cursor lands just past the last LF', () => {
    const r = ingest(cat(l1, l2, l3));
    expect(eventsOf(r).map((e) => [e.eventKind, e.startOffset, e.endOffset, e.bucket])).toEqual([
      ['SessionStart', 0, l1.length, BUCKET],
      ['SessionEnd', l1.length, l1.length + l2.length, BUCKET],
      ['SubagentStart', l1.length + l2.length, l1.length + l2.length + l3.length, BUCKET],
    ]);
    expect(r.cursor).toMatchObject({ sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, cursor: l1.length + l2.length + l3.length, lastSize: l1.length + l2.length + l3.length, intervalState: 'measured', detail: null });
    expect([r.interval, r.detail]).toEqual(['measured', null]);
  });

  it('a read that starts at a nonzero cursor offsets from that cursor', () => {
    const state = stateWith([cursorRow(500, 500)]);
    const r = ingest(cat(l1, l2), { cursor: 500, lastSize: 500, size: 500 + l1.length + l2.length }, state);
    expect(eventsOf(r).map((e) => [e.startOffset, e.endOffset])).toEqual([[500, 500 + l1.length], [500 + l1.length, 500 + l1.length + l2.length]]);
    expect(r.cursor.cursor).toBe(500 + l1.length + l2.length);
  });

  it('offsets are BYTES: a multibyte line (two-, three- and four-byte characters) shifts every later offset by its byte length, not its character count', () => {
    const wide = lineOf(common('SessionStart', { source: 'startup', cwd: '/work/é-日本-😀' }));
    expect(wide.length).toBeGreaterThan(dec.decode(wide).length);
    const r = ingest(cat(wide, l2));
    const evs = eventsOf(r);
    expect(evs.map((e) => [e.startOffset, e.endOffset])).toEqual([[0, wide.length], [wide.length, wide.length + l2.length]]);
    expect(evs[0]).toMatchObject({ cwd: '/work/é-日本-😀' });
    expect(r.cursor.cursor).toBe(wide.length + l2.length);
  });

  it('a bucket with no newline yet accepts nothing and leaves the cursor where it was', () => {
    const r = ingest(l1.subarray(0, 40));
    expect(r.accepted).toEqual([]);
    expect(r.cursor.cursor).toBe(0);
    expect(r.interval).toBe('measured');   // nothing is lost: the line is still being written
  });

  describe('a torn tail (W3-M07)', () => {
    it('complete lines before a torn tail are accepted, the cursor stops at the end of the last LF, and the tail is named', () => {
      const r = ingest(cat(l1, l2.subarray(0, 25)));
      expect(eventsOf(r)).toHaveLength(1);
      expect(r.cursor.cursor).toBe(l1.length);
      expect(r.cursor.lastSize).toBe(l1.length + 25);
      expect(r.interval).toBe('measured');
      expect(r.detail).toBe('torn-tail: 25 unframed bytes after offset ' + l1.length);
      expect(r.cursor.detail).toBe(r.detail);
    });

    it('then completion: the next read from that cursor accepts the line with the SAME ID a single full read gives it', () => {
      const first = ingest(cat(l1, l2.subarray(0, 25)));
      const { input, state } = nextRead(first, l2, l1.length + l2.length);
      const second = ingestDelegationBucket(input, state);
      expect(eventsOf(second)).toHaveLength(1);
      expect(second.cursor.cursor).toBe(l1.length + l2.length);
      expect([second.interval, second.detail]).toEqual(['measured', null]);
      const whole = ingest(cat(l1, l2));
      expect(eventsOf(second)[0]!.eventId).toBe(eventsOf(whole)[1]!.eventId);
      expect(eventsOf(second)[0]).toEqual(eventsOf(whole)[1]);
    });

    it('a torn tail that has already outgrown any valid line can never complete into one: the interval is unmeasured and the cursor still does not move', () => {
      const tail = enc.encode('{"v":1,"x":"' + 'a'.repeat(B.lineBytesBelow));
      const r = ingest(cat(l1, tail));
      expect(eventsOf(r)).toHaveLength(1);
      expect(r.cursor.cursor).toBe(l1.length);
      expect(r.interval).toBe('unmeasured');
      expect(r.detail).toMatch(/^torn-tail-over-long: /);
    });

    it('a multibyte character split by the end of the read is a torn tail, not a decode error', () => {
      const wide = lineOf(common('SessionStart', { source: 'startup', cwd: '/é' }));
      const cut = wide.indexOf(0xc3) + 1;     // between the two bytes of é
      const r = ingest(wide.subarray(0, cut));
      expect(r.accepted).toEqual([]);
      expect([r.interval, r.cursor.cursor]).toEqual(['measured', 0]);
    });
  });

  describe('shrink and rewrite: an unmeasured replacement, never a new identity at an old coordinate', () => {
    it('size below the cursor', () => {
      const state = stateWith([cursorRow(100, 100)]);
      const r = ingest(new Uint8Array(0), { cursor: 100, lastSize: 100, size: 90 }, state);
      expect(r.accepted).toEqual([]);
      expect(r.interval).toBe('unmeasured');
      expect(r.cursor).toMatchObject({ cursor: 100, lastSize: 100, intervalState: 'unmeasured' });
      expect(r.detail).toBe(`${DELEGATION_BUCKET_REPLACED}: size 90 is below the cursor 100`);
    });

    it('size below the last-seen size, even while it stays ahead of the cursor (a cut that ordinary growth arithmetic would call growth)', () => {
      const state = stateWith([cursorRow(50, 400)]);
      const r = ingest(l1, { cursor: 50, lastSize: 400, size: 50 + l1.length }, state);
      expect(50 + l1.length).toBeLessThan(400);
      expect(50 + l1.length).toBeGreaterThan(50);
      expect(r.accepted).toEqual([]);
      expect(r.interval).toBe('unmeasured');
      expect(r.cursor).toMatchObject({ cursor: 50, lastSize: 400 });
      expect(r.detail).toBe(`${DELEGATION_BUCKET_REPLACED}: size ${50 + l1.length} is below the last-seen size 400`);
      expect(r.detail).toMatch(new RegExp(`^${DELEGATION_BUCKET_REPLACED}: `));
    });

    it('once replaced the bucket stays unmeasured: regrowing past the old size does not accept bytes at the old coordinates', () => {
      const replaced = ingest(new Uint8Array(0), { cursor: 100, lastSize: 100, size: 90 }, stateWith([cursorRow(100, 100)]));
      const regrown = ingestDelegationBucket(
        inputOf(cat(l1, l2), { cursor: 100, lastSize: 100, size: 100 + l1.length + l2.length }),
        stateWith([replaced.cursor]),
      );
      expect(regrown.accepted).toEqual([]);
      expect(regrown.interval).toBe('unmeasured');
      expect(regrown.cursor).toMatchObject({ cursor: 100, lastSize: 100, intervalState: 'unmeasured' });
      expect(regrown.detail).toBe(replaced.detail);
    });

    it('a read that disagrees with the accepted coordinate (changed bytes before it, or a stale cursor) is unmeasured, and the durable row is what survives', () => {
      const state = stateWith([cursorRow(200, 260, { lastCompleteAt: '2026-10-14T12:00:01.000Z' })]);
      for (const [label, over] of [
        ['a cursor behind the accepted one', { cursor: 0, lastSize: 260 }],
        ['a cursor ahead of the accepted one', { cursor: 230, lastSize: 260 }],
        ['a last-seen size that is not the accepted one', { cursor: 200, lastSize: 100 }],
      ] as const) {
        const r = ingest(l1, { ...over, size: 400 }, state);
        expect(r.accepted, label).toEqual([]);
        expect(r.interval, label).toBe('unmeasured');
        expect(r.cursor, label).toMatchObject({ cursor: 200, lastSize: 260, lastCompleteAt: '2026-10-14T12:00:01.000Z', intervalState: 'unmeasured' });
        expect(r.detail, label).toMatch(/^cursor-disagrees-with-durable-state: /);
      }
    });

    it('a first read of a bucket the checkpoint has no row for must start at zero', () => {
      const r = ingest(l1, { cursor: 7, lastSize: 7, size: 7 + l1.length });
      expect(r.accepted).toEqual([]);
      expect(r.interval).toBe('unmeasured');
      expect(r.cursor).toMatchObject({ cursor: 0, lastSize: 0 });
      expect(r.detail).toMatch(/^cursor-disagrees-with-durable-state: /);
    });

    it('more bytes than the file has beyond the cursor is a transport inconsistency, not a measurement', () => {
      const r = ingest(cat(l1, l2), { size: l1.length });
      expect(r.accepted).toEqual([]);
      expect([r.interval, r.cursor.cursor]).toEqual(['unmeasured', 0]);
      expect(r.detail).toMatch(/^range-inconsistent: /);
    });
  });

  describe('a vanished bucket (W3-M09)', () => {
    it('a bucket that is gone while its suffix was never read is unmeasured, whatever the bytes say', () => {
      const state = stateWith([cursorRow(40, 80)]);
      const r = ingest(new Uint8Array(0), { cursor: 40, lastSize: 80, size: 0, bucketPresent: false }, state);
      expect(r.accepted).toEqual([]);
      expect(r.interval).toBe('unmeasured');
      expect(r.cursor).toMatchObject({ cursor: 40, lastSize: 80, intervalState: 'unmeasured' });
      expect(r.detail).toBe('bucket-vanished-unread: the bucket is gone with 40 bytes after offset 40 never read');
    });

    it('a bucket that is gone after everything in it was read is healthy (the hook\'s own prune)', () => {
      const state = stateWith([cursorRow(80, 80)]);
      const r = ingest(new Uint8Array(0), { cursor: 80, lastSize: 80, size: 0, bucketPresent: false }, state);
      expect([r.interval, r.detail, r.accepted]).toEqual(['measured', null, []]);
      expect(r.cursor).toMatchObject({ cursor: 80, lastSize: 80, intervalState: 'measured' });
    });

    it('a bucket that was listed absent and was never seen is a measured nothing', () => {
      const r = ingest(new Uint8Array(0), { size: 0, bucketPresent: false });
      expect([r.interval, r.detail, r.accepted]).toEqual(['measured', null, []]);
      expect(r.cursor).toMatchObject({ cursor: 0, lastSize: 0 });
    });

    it('an absent bucket that nonetheless carries bytes contradicts itself and is unmeasured', () => {
      const r = ingest(l1, { bucketPresent: false });
      expect(r.accepted).toEqual([]);
      expect(r.interval).toBe('unmeasured');
      expect(r.detail).toMatch(/^input-inconsistent: /);
    });
  });

  it('an empty readable bucket is a measured read with nothing in it', () => {
    const r = ingest(new Uint8Array(0), { size: 0 });
    expect(r.accepted).toEqual([]);
    expect([r.interval, r.detail]).toEqual(['measured', null]);
    expect(r.cursor).toMatchObject({ cursor: 0, lastSize: 0, intervalState: 'measured', lastCompleteAt: null });
  });

  it('an idle bucket (cursor at the end of the file) is measured and leaves the row alone', () => {
    const state = stateWith([cursorRow(300, 300, { lastCompleteAt: '2026-10-14T12:00:09.000Z' })]);
    const r = ingest(new Uint8Array(0), { cursor: 300, lastSize: 300, size: 300 }, state);
    expect([r.interval, r.detail, r.accepted]).toEqual(['measured', null, []]);
    expect(r.cursor).toEqual(cursorRow(300, 300, { lastCompleteAt: '2026-10-14T12:00:09.000Z' }));
  });

  it('lastCompleteAt is the latest accepted line\'s own observedAt (no pure code reads a clock) and is carried over when a read accepts nothing', () => {
    const r = ingest(cat(l1, l3));
    expect(r.cursor.lastCompleteAt).toBe('2026-10-14T12:00:09.000Z');
  });

  describe('a malformed complete line (W3-M08): the cursor steps over it, nothing is accepted from it, and the interval is a gap', () => {
    it.each([
      ['not JSON at all', enc.encode('this is not json\n'), 'malformed-json'],
      ['a blank line', enc.encode('\n'), 'blank-line'],
      ['invalid UTF-8', cat(Uint8Array.of(0xff, 0xfe), enc.encode('{}'), Uint8Array.of(0x0a)), 'invalid-utf8'],
      ['a CRLF line ending', enc.encode(JSON.stringify(common('SessionStart', { source: 'startup' })) + '\r\n'), 'malformed-json'],
      ['a UTF-8 byte-order mark', cat(Uint8Array.of(0xef, 0xbb, 0xbf), lineOf(common('SessionStart', { source: 'startup' }))), 'malformed-json'],
      ['leading whitespace', enc.encode(' ' + JSON.stringify(common('SessionStart', { source: 'startup' })) + '\n'), 'malformed-json'],
      ['a JSON array', enc.encode('[1,2]\n'), 'not-an-object'],
      ['a duplicate key', enc.encode(JSON.stringify(common('SessionStart', { source: 'startup' })).replace('"v":1', '"v":1,"v":1') + '\n'), 'duplicate-key'],
    ])('%s', (_label, bytes, code) => {
      const r = ingest(bytes);
      expect(r.accepted).toEqual([]);
      expect(r.interval).toBe('unmeasured');
      expect(r.detail).toBe(`1 of 1 complete lines refused: ${code}=1`);
      expect(r.cursor.cursor).toBe(bytes.length);
      expect(r.cursor).toMatchObject({ intervalState: 'unmeasured', detail: r.detail });
    });

    it('good lines on either side of a bad one are still accepted, at their own offsets, and the interval is still a gap', () => {
      const bad = enc.encode('garbage\n');
      const r = ingest(cat(l1, bad, l2));
      expect(eventsOf(r).map((e) => [e.eventKind, e.startOffset])).toEqual([['SessionStart', 0], ['SessionEnd', l1.length + bad.length]]);
      expect(r.interval).toBe('unmeasured');
      expect(r.detail).toBe('1 of 3 complete lines refused: malformed-json=1');
      expect(r.cursor.cursor).toBe(l1.length + bad.length + l2.length);
    });

    it('the detail names every refusal code with its count, in code order, so the same bytes always read the same', () => {
      const r = ingest(cat(enc.encode('x\n'), enc.encode('y\n'), enc.encode('\n'), l1));
      expect(r.detail).toBe('3 of 4 complete lines refused: blank-line=1, malformed-json=2');
    });

    it('a line of 4096 bytes counting its LF is refused; 4095 is the most a line may be (the plan says LESS than 4096, not less than or equal)', () => {
      const padded = (rawLength: number): Uint8Array => {
        const base = common('PreToolUse', { toolName: 'Bash', toolUseId: 'toolu_3' });
        const names: string[] = [];
        let s = JSON.stringify({ ...base, listing: names });
        while (Buffer.byteLength(s) + 67 + 9 <= rawLength) { names.push('n'.repeat(B.listingNameBytes)); s = JSON.stringify({ ...base, listing: names }); }
        const rest = rawLength - Buffer.byteLength(s) - 9;
        const out = JSON.stringify({ ...base, listing: names, cwd: 'c'.repeat(rest) });
        expect(Buffer.byteLength(out)).toBe(rawLength);
        return enc.encode(`${out}\n`);
      };
      const ok = ingest(padded(B.lineBytesBelow - 2));
      expect(ok.accepted).toHaveLength(1);
      expect(ok.interval).toBe('measured');
      const over = ingest(padded(B.lineBytesBelow - 1));
      expect(over.accepted).toEqual([]);
      expect(over.interval).toBe('unmeasured');
      expect(over.detail).toBe('1 of 1 complete lines refused: line-too-long=1');
      expect(over.cursor.cursor).toBe(B.lineBytesBelow);
    });
  });
});

describe('duplicate re-read (W3-M11): the event ID is the idempotency key', () => {
  const l1 = lineOf(common('SessionStart', { source: 'startup' }));
  const l2 = lineOf(common('SessionEnd', { reason: 'clear' }, { observedAt: '2026-10-14T12:00:05.000Z' }));

  it('reading the same bytes twice yields the identical events, IDs included', () => {
    const a = ingest(cat(l1, l2));
    const b = ingest(cat(l1, l2));
    expect(eventsOf(b)).toEqual(eventsOf(a));
    expect(eventsOf(a).map((e) => e.eventId)).toEqual([...new Set(eventsOf(a).map((e) => e.eventId))]);
  });

  it('the same line framed by a different read window has the same ID (an ID is a property of the bytes and their coordinate, not of the read)', () => {
    const whole = ingest(cat(l1, l2));
    const { input, state } = nextRead(ingest(l1), l2, l1.length + l2.length);
    expect(eventsOf(ingestDelegationBucket(input, state))[0]!.eventId).toBe(eventsOf(whole)[1]!.eventId);
  });

  it('applied twice, the journal holds each event once: the second application skips every event as a duplicate', async () => {
    const h = await openDurability();
    const durable = delegationBucketDurabilityOf(h.dur, h.now);
    const result = ingest(cat(l1, l2));
    await durable.applyBucketResult(result);
    const second = await durable.applyBucketResult(result);
    expect(journalLines(h.dir)).toHaveLength(2);
    expect(second.checkpoint.bucketCursors).toHaveLength(1);
  });

  it('a lost cursor row (restored from an older backup) re-reads from zero and the journal still keeps each event once', async () => {
    const h = await openDurability();
    const durable = delegationBucketDurabilityOf(h.dur, h.now);
    await durable.applyBucketResult(ingest(cat(l1, l2)));
    const again = ingest(cat(l1, l2), {}, stateWith());      // the checkpoint has no row, so the driver starts at 0
    expect(eventsOf(again).map((e) => e.eventId)).toEqual(eventsOf(ingest(cat(l1, l2))).map((e) => e.eventId));
    await durable.applyBucketResult(again);
    expect(journalLines(h.dir)).toHaveLength(2);
  });
});

// ── Step 2: the closed envelope ───────────────────────────────────────────────────────────────────────────────────────

describe('closed envelope (W3-M69): each variant accepts exactly its own keys', () => {
  it.each(VARIANTS)('%s is accepted and keeps exactly its own keys', (_name, obj) => {
    const bytes = lineOf(obj);
    const r = ingest(bytes);
    expect(r.interval).toBe('measured');
    expect(eventsOf(r)).toHaveLength(1);
    expect(eventsOf(r)[0]).toEqual({ ...obj, eventId: expect.stringMatching(/^[0-9a-f]{64}$/), bucket: BUCKET, startOffset: 0, endOffset: bytes.length });
    expect(Object.keys(eventsOf(r)[0]!).sort()).toEqual([...Object.keys(obj), 'bucket', 'endOffset', 'eventId', 'startOffset'].sort());
  });

  const rejects = (obj: Obj, code?: string): void => {
    const bytes = lineOf(obj);
    const r = ingest(bytes);
    expect(r.accepted).toEqual([]);
    expect(r.interval).toBe('unmeasured');
    expect(r.cursor.cursor, 'a complete line is stepped over').toBe(bytes.length);
    if (code !== undefined) expect(r.detail).toBe(`1 of 1 complete lines refused: ${code}=1`);
    else expect(r.detail).toMatch(/^1 of 1 complete lines refused: /);
  };

  describe('a required property that is missing', () => {
    for (const [name, obj, required] of VARIANTS) {
      for (const key of [...COMMON_REQUIRED, ...required]) {
        it(`${name} without ${key}`, () => {
          const { [key]: _gone, ...rest } = obj;
          rejects(rest, 'missing-key');
        });
      }
    }
  });

  describe('an unknown key, on every variant', () => {
    for (const [name, obj] of VARIANTS) {
      it(name, () => { rejects({ ...obj, extra: 'x' }, 'unknown-key'); });
    }
  });

  it('arbitrary tool content is never kept: a tool response, scratchpad_dir and Agent outputFile each close the line', () => {
    const post = common('PostToolUse', { toolName: 'Agent', toolUseId: 'toolu_4', outcome: 'completed', launch: AGENT_LAUNCH });
    rejects({ ...post, tool_response: { status: 'completed', content: 'anything' } }, 'unknown-key');
    rejects({ ...post, toolResponse: 'anything' }, 'unknown-key');
    rejects({ ...post, scratchpad_dir: '/tmp/scratch' }, 'unknown-key');
    rejects({ ...post, launch: { ...AGENT_LAUNCH, outputFile: '/tmp/out' } }, 'unknown-key');
    rejects({ ...post, launch: { ...AGENT_LAUNCH, scratchpad_dir: '/tmp/scratch' } }, 'unknown-key');
    const wf = common('PostToolUse', { toolName: 'Workflow', toolUseId: 'toolu_5', outcome: 'completed', launch: WORKFLOW_LAUNCH });
    rejects({ ...wf, launch: { ...WORKFLOW_LAUNCH, output: 'x' } }, 'unknown-key');
    rejects(common('SessionStart', { source: 'startup', scratchpad_dir: '/tmp/s' }), 'unknown-key');
  });

  it('a task notification keeps taskId, toolUseId and a terminal status and NOTHING else: a prompt, result or diagnostics closes the line', () => {
    const n = { taskId: 'task_1', toolUseId: 'toolu_1', status: 'completed' };
    for (const extra of [{ prompt: 'full prompt text' }, { result: 'the whole result' }, { diagnostics: 'stack' }, { outputFile: '/tmp/o' }, { summary: 's' }]) {
      rejects(common('UserPromptSubmit', { notification: { ...n, ...extra } }), 'unknown-key');
    }
    rejects(common('UserPromptSubmit', { notification: { taskId: 'task_1', toolUseId: 'toolu_1' } }), 'missing-key');
    rejects(common('UserPromptSubmit', { notification: 'a string' }), 'bad-field');
    rejects(common('UserPromptSubmit', { notification: null }), 'bad-field');
    rejects(common('UserPromptSubmit', { notification: { ...n, status: 'killed' } }), 'bad-field');
  });

  it('Workflow transcriptDir and scriptPath are RETAINED: they are approved closed launch fields, not arbitrary output', () => {
    const r = ingest(lineOf(common('PostToolUse', { toolName: 'Workflow', toolUseId: 'toolu_5', outcome: 'async-launched', launch: WORKFLOW_LAUNCH })));
    const e = eventsOf(r)[0] as Extract<DelegationEventEnvelopeV1, { eventKind: 'PostToolUse'; toolName: 'Workflow' }>;
    expect(e.launch).toEqual(WORKFLOW_LAUNCH);
    expect(e.launch!.transcriptDir).toBe('/work/.claude/workflows/run-9f');
    expect(e.launch!.scriptPath).toBe('/work/.claude/workflows/review-pass.js');
  });

  it('an event kind or tool outside the closed set is refused: ToolSearch, Stop, WorktreeCreate and WorktreeRemove are not delegation events', () => {
    expect([...DELEGATION_EVENT_KINDS].sort()).toEqual(['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
    for (const kind of ['Stop', 'WorktreeCreate', 'WorktreeRemove', 'Notification', 'PreCompact', '']) rejects(common(kind, { source: 'x' }), 'bad-event-kind');
    rejects(common('PreToolUse', { toolName: 'ToolSearch', toolUseId: 'toolu_1', isolation: null }), 'bad-event-kind');
    rejects(common('PostToolUse', { toolName: 'Read', toolUseId: 'toolu_1', outcome: 'completed' }), 'bad-event-kind');
    rejects(common('PreToolUse', { toolUseId: 'toolu_1', isolation: null }), 'missing-key');
    rejects({ ...common('SessionStart', { source: 'startup' }), eventKind: 7 }, 'bad-event-kind');
  });

  describe('owner mismatch (W3-M10)', () => {
    it('a line whose sessionId is not the spool owner is refused, even though it is otherwise perfect', () => {
      rejects(common('SessionStart', { source: 'startup' }, { sessionId: 'lane-b-demo' }), 'owner-mismatch');
      rejects(common('SessionStart', { source: 'startup' }, { sessionId: OWNER + 'x' }), 'owner-mismatch');
      rejects(common('SessionStart', { source: 'startup' }, { sessionId: '' }), 'owner-mismatch');
      rejects(common('SessionStart', { source: 'startup' }, { sessionId: 7 }), 'bad-field');
    });
    it('the spool owner is the INPUT\'s sessionId: the same line is accepted for its own owner and refused for another', () => {
      const l = lineOf(common('SessionStart', { source: 'startup' }));
      expect(ingest(l).accepted).toHaveLength(1);
      const other = ingestDelegationBucket(inputOf(l, { sessionId: 'lane-b-demo' }), stateWith());
      expect(other.accepted).toEqual([]);
      expect(other.interval).toBe('unmeasured');
    });
  });

  describe('incarnation binding (W3-M60)', () => {
    it('a line of another incarnation (the row was reused under a new generation) is refused as the old incarnation\'s', () => {
      rejects(common('SessionStart', { source: 'startup' }, { parentIncarnation: OTHER_INC }), 'incarnation-mismatch');
    });
    it('a line without an incarnation, or with a malformed one, is refused', () => {
      const { parentIncarnation: _p, ...none } = common('SessionStart', { source: 'startup' });
      rejects(none, 'missing-key');
      rejects(common('SessionStart', { source: 'startup' }, { parentIncarnation: 'g1' }), 'bad-field');
      rejects(common('SessionStart', { source: 'startup' }, { parentIncarnation: INC.toUpperCase() }), 'bad-field');
      rejects(common('SessionStart', { source: 'startup' }, { parentIncarnation: null }), 'bad-field');
    });
    it('the same line is accepted for the incarnation that wrote it and refused for the incarnation that reused the row', () => {
      const l = lineOf(common('SessionStart', { source: 'startup' }));
      expect(ingestDelegationBucket(inputOf(l, { parentIncarnation: INC }), stateWith()).accepted).toHaveLength(1);
      const reused = ingestDelegationBucket(inputOf(l, { parentIncarnation: OTHER_INC }), stateWith());
      expect(reused.accepted).toEqual([]);
      expect(reused.interval).toBe('unmeasured');
    });
  });

  describe('values: timestamps, identifiers and bounds', () => {
    it.each([
      ['no milliseconds', '2026-10-14T12:00:00Z'],
      ['an offset', '2026-10-14T12:00:00.000+00:00'],
      ['a date that rolls over', '2026-02-30T12:00:00.000Z'],
      ['hour 24', '2026-10-14T24:00:00.000Z'],
      ['lowercase z', '2026-10-14T12:00:00.000z'],
      ['not a string', 1760443200000],
      ['empty', ''],
    ])('an invalid UTC timestamp: %s', (_label, observedAt) => {
      rejects(common('SessionStart', { source: 'startup' }, { observedAt }), typeof observedAt === 'string' ? 'bad-timestamp' : 'bad-field');
    });

    it('v must be exactly 1', () => {
      for (const v of [0, 2, '1', true, null]) rejects(common('SessionStart', { source: 'startup' }, { v }), 'bad-version');
    });

    it('identifiers are [A-Za-z0-9_-] and at most the bound', () => {
      const longId = 'a'.repeat(B.idBytes + 1);
      const okId = 'a'.repeat(B.idBytes);
      expect(ingest(lineOf(common('SubagentStart', { agentId: okId, agentType: null }))).accepted).toHaveLength(1);
      rejects(common('SubagentStart', { agentId: longId, agentType: null }), 'bad-field');
      rejects(common('SubagentStart', { agentId: 'has space', agentType: null }), 'bad-field');
      rejects(common('SubagentStart', { agentId: '', agentType: null }), 'bad-field');
      rejects(common('SessionStart', { source: 'startup' }, { claudeSessionId: longId }), 'bad-field');
      rejects(common('PreToolUse', { toolName: 'Bash', toolUseId: longId }), 'bad-field');
      rejects(common('PostToolUse', { toolName: 'Agent', toolUseId: 'toolu_4', outcome: 'completed', launch: { ...AGENT_LAUNCH, agentId: longId } }), 'bad-field');
      rejects(common('UserPromptSubmit', { notification: { taskId: longId, toolUseId: 'toolu_1', status: 'completed' } }), 'bad-field');
    });

    it('labels, paths and the agent type are bounded in UTF-8 BYTES, not characters', () => {
      const okLabel = 'é'.repeat(B.labelBytes / 2);
      expect(Buffer.byteLength(okLabel)).toBe(B.labelBytes);
      expect(ingest(lineOf(common('SessionStart', { source: okLabel }))).accepted).toHaveLength(1);
      rejects(common('SessionStart', { source: okLabel + 'x' }), 'bad-field');
      rejects(common('SessionStart', { source: '' }), 'bad-field');
      rejects(common('SessionEnd', { reason: '' }), 'bad-field');
      rejects(common('SessionStart', { source: 'startup', agentType: 'é'.repeat(B.labelBytes / 2 + 1) }), 'bad-field');
      const okPath = '/' + 'é'.repeat((B.pathBytes - 1) / 2 | 0);
      expect(Buffer.byteLength(okPath)).toBeLessThanOrEqual(B.pathBytes);
      expect(ingest(lineOf(common('SessionStart', { source: 'startup', cwd: okPath }))).accepted).toHaveLength(1);
      rejects(common('SessionStart', { source: 'startup', cwd: '/' + 'é'.repeat(B.pathBytes / 2) }), 'bad-field');
      rejects(common('SessionStart', { source: 'startup', transcriptPath: 'p'.repeat(B.pathBytes + 1) }), 'bad-field');
      rejects(common('SubagentStop', { agentId: 'agent-abc123', agentType: null, agentTranscriptPath: 'p'.repeat(B.pathBytes + 1) }), 'bad-field');
      rejects(common('PostToolUse', { toolName: 'Workflow', toolUseId: 'toolu_5', outcome: 'completed', launch: { ...WORKFLOW_LAUNCH, scriptPath: 'p'.repeat(B.pathBytes + 1) } }), 'bad-field');
      rejects(common('PostToolUse', { toolName: 'Workflow', toolUseId: 'toolu_5', outcome: 'completed', launch: { ...WORKFLOW_LAUNCH, transcriptDir: '' } }), 'bad-field');
    });

    it('a lone surrogate (which UTF-8 and the journal cannot carry) is refused rather than reaching the journal', () => {
      const bytes = enc.encode(JSON.stringify(common('SessionStart', { source: 'startup' })).replace('"startup"', '"a\\ud800b"') + '\n');
      const r = ingest(bytes);
      expect(r.accepted).toEqual([]);
      expect(r.detail).toBe('1 of 1 complete lines refused: bad-field=1');
    });

    it('truncated is true or absent, never false', () => {
      rejects(common('SessionStart', { source: 'startup', truncated: false }), 'bad-field');
      rejects(common('SessionStart', { source: 'startup', truncated: 1 }), 'bad-field');
    });

    it('outcome words are closed, and Bash has no async-launched', () => {
      rejects(common('PostToolUse', { toolName: 'Agent', toolUseId: 'toolu_4', outcome: 'done', launch: null }), 'bad-field');
      rejects(common('PostToolUse', { toolName: 'Bash', toolUseId: 'toolu_6', outcome: 'async-launched' }), 'bad-field');
      rejects(common('PostToolUse', { toolName: 'Agent', toolUseId: 'toolu_4', outcome: 'completed', launch: { ...AGENT_LAUNCH, status: 'running' } }), 'bad-field');
      rejects(common('PostToolUse', { toolName: 'Agent', toolUseId: 'toolu_4', outcome: 'completed', launch: { ...AGENT_LAUNCH, isAsync: 'yes' } }), 'bad-field');
    });

    it('a Workflow launch must not be shaped like an Agent launch, nor the reverse', () => {
      rejects(common('PostToolUse', { toolName: 'Workflow', toolUseId: 'toolu_5', outcome: 'completed', launch: AGENT_LAUNCH }));
      rejects(common('PostToolUse', { toolName: 'Agent', toolUseId: 'toolu_4', outcome: 'completed', launch: WORKFLOW_LAUNCH }), 'unknown-key');
    });

    it('a listing is a bounded list of admin-record NAMES: overbound count, overbound name, a non-string entry and a path-shaped entry are all refused', () => {
      const bash = (listing: unknown): Obj => common('PreToolUse', { toolName: 'Bash', toolUseId: 'toolu_3', listing });
      expect(ingest(lineOf(bash(Array.from({ length: 30 }, (_, i) => `wt-${i}`)))).accepted).toHaveLength(1);
      rejects(bash(Array.from({ length: B.listingNames + 1 }, (_, i) => `w${i}`)));       // the count: refused (by the count, or by the line cap)
      rejects(bash(['n'.repeat(B.listingNameBytes + 1)]), 'bad-field');
      rejects(bash([7]), 'bad-field');
      rejects(bash([null]), 'bad-field');
      rejects(bash(['/abs/path']), 'bad-field');
      rejects(bash(['has space']), 'bad-field');
      rejects(bash(['']), 'bad-field');
      rejects(bash('agent-1'), 'bad-field');
      rejects(bash({ name: 'agent-1' }), 'bad-field');
      rejects(bash([{ name: 'agent-1', path: '/x' }]), 'bad-field');
    });

    it('the list-count bound alone refuses a listing of 257 SHORT names (a line well under the byte cap)', () => {
      const names = Array.from({ length: B.listingNames + 1 }, (_, i) => `${i}`);
      const bytes = lineOf(common('PreToolUse', { toolName: 'Bash', toolUseId: 'toolu_3', listing: names }));
      expect(bytes.length).toBeLessThan(B.lineBytesBelow);
      const r = ingest(bytes);
      expect(r.detail).toBe('1 of 1 complete lines refused: bad-field=1');
    });

    it('every refusal code is in the closed list, and parseDelegationSpoolLine answers one of them', () => {
      const probe = (b: Uint8Array) => parseDelegationSpoolLine(b, { sessionId: OWNER, parentIncarnation: INC });
      const bad = probe(enc.encode('nope'));
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(DELEGATION_LINE_REJECTIONS).toContain(bad.code);
      expect(new Set(DELEGATION_LINE_REJECTIONS).size).toBe(DELEGATION_LINE_REJECTIONS.length);
    });
  });

  it('what is retained is a COPY: an accepted event shares nothing with the bytes it came from', () => {
    const bytes = lineOf(common('PreToolUse', { toolName: 'Bash', toolUseId: 'toolu_3', listing: ['agent-a1'] }));
    const r = ingest(bytes);
    const before = JSON.stringify(eventsOf(r));
    bytes.fill(0x20);
    expect(JSON.stringify(eventsOf(r))).toBe(before);
  });
});

// ── Step 3: capability, transport and recovery ───────────────────────────────────────────────────────────────────────

describe('capability, transport and recovery: an unmeasured interval, never fabricated bytes or an empty measurement', () => {
  const l1 = lineOf(common('SessionStart', { source: 'startup' }));

  it.each([
    ['the capability is absent', false, 'capability-absent'],
    ['the capability is unmeasured', null, 'capability-unmeasured'],
  ] as const)('%s: nothing is accepted, even from perfectly good bytes, and the interval is a gap', (_label, capabilityPresent, detail) => {
    const r = ingest(l1, { capabilityPresent });
    expect(r.accepted).toEqual([]);
    expect(r.interval).toBe('unmeasured');
    expect(r.detail).toBe(detail);
    expect(r.cursor).toMatchObject({ cursor: 0, lastSize: 0, intervalState: 'unmeasured', detail });
  });

  it('a recovery that has not finished (phase reconstructing) is a gap: nothing is accepted and no cursor moves', () => {
    const state = stateWith([cursorRow(30, 30)], 'reconstructing');
    const r = ingest(l1, { cursor: 30, lastSize: 30, size: 30 + l1.length }, state);
    expect(r.accepted).toEqual([]);
    expect(r.interval).toBe('unmeasured');
    expect(r.detail).toBe('recovery-not-ready: the observation lane is reconstructing');
    expect(r.cursor).toMatchObject({ cursor: 30, lastSize: 30 });
    expect(r.state).toBe(state);
  });

  it('input that is not a bucket read at all (an empty owner, a bucket that is not ten digits, a non-integer offset) is a gap', () => {
    for (const over of [{ sessionId: '' }, { bucket: '20261014' }, { bucket: '2026101424' }, { cursor: 1.5 }, { size: -1 }, { lastSize: Number.NaN }] as const) {
      const r = ingest(l1, over);
      expect(r.accepted, JSON.stringify(over)).toEqual([]);
      expect(r.interval, JSON.stringify(over)).toBe('unmeasured');
      expect(r.detail, JSON.stringify(over)).toMatch(/^input-invalid: /);
    }
  });

  describe('the reader (readDelegationBucket): every transport failure is unmeasured and builds no input', () => {
    const owner = '/fixture/delegation/spool/lane-a-demo';
    const listed = (...names: string[]): MeasuredDirectoryRead => ({ ok: true, entries: names });
    const req = (listing: MeasuredDirectoryRead, over: Record<string, unknown> = {}) => ({
      ownerDir: owner, sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, cursor: 0, lastSize: 0, capabilityPresent: true as boolean | null, listing, ...over,
    });
    /** An io whose byte-range read answers `answer` and remembers what it was asked. */
    const ioAnswering = (answer: MeasuredByteRangeRead) => {
      const calls: Array<{ path: string; offset: number; maxBytes: number }> = [];
      const io: Pick<FleetIO, 'readFileFromBytesMeasured'> = {
        readFileFromBytesMeasured: async (p, offset, maxBytes) => { calls.push({ path: p, offset, maxBytes }); return answer; },
      };
      return { io, calls };
    };

    it('a bucket in the listing is read by byte range from the cursor, at the largest bound, from the owner directory', async () => {
      const { io, calls } = ioAnswering({ ok: true, bytes: l1, size: l1.length });
      const read = await readDelegationBucket(io, req(listed(`${BUCKET}.spool`)));
      expect(calls).toEqual([{ path: `${owner}/${BUCKET}.spool`, offset: 0, maxBytes: READ_FROM_MAX_BYTES }]);
      expect(read).toEqual({ ok: true, input: inputOf(l1, { size: l1.length }) });
    });

    it.each([
      ['the capability is absent', { capabilityPresent: false }, 'capability-absent'],
      ['the capability is unmeasured', { capabilityPresent: null }, 'capability-unmeasured'],
    ] as const)('%s: nothing is read at all', async (_label, over, reason) => {
      const { io, calls } = ioAnswering({ ok: true, bytes: l1, size: l1.length });
      const read = await readDelegationBucket(io, req(listed(`${BUCKET}.spool`), over));
      expect(read).toMatchObject({ ok: false, reason });
      expect(calls).toEqual([]);
    });

    it.each([
      ['the owner directory is absent', { ok: false, reason: 'absent' } as const, 'directory-absent'],
      ['the owner directory is unreadable', { ok: false, reason: 'unreadable' } as const, 'directory-unreadable'],
    ])('%s: unmeasured, nothing is read, and absent is told apart from unreadable', async (_label, listing, reason) => {
      const { io, calls } = ioAnswering({ ok: true, bytes: l1, size: l1.length });
      const read = await readDelegationBucket(io, req(listing));
      expect(read).toMatchObject({ ok: false, reason });
      expect(calls).toEqual([]);
    });

    it('an unreadable byte range (an old peer answering decoded data only, malformed base64, a byte-count mismatch, a size regression) is unmeasured, never an empty bucket', async () => {
      const { io } = ioAnswering({ ok: false, reason: 'unreadable' });
      const read = await readDelegationBucket(io, req(listed(`${BUCKET}.spool`)));
      expect(read).toMatchObject({ ok: false, reason: 'range-unreadable' });
    });

    it('a bucket not in a SUCCESSFUL listing is a measured absence: no read is made and the input says absent with no bytes', async () => {
      const { io, calls } = ioAnswering({ ok: true, bytes: l1, size: l1.length });
      const read = await readDelegationBucket(io, req(listed('2026101411.spool', 'notes.txt')));
      expect(calls).toEqual([]);
      expect(read).toEqual({ ok: true, input: inputOf(new Uint8Array(0), { size: 0, bucketPresent: false }) });
    });

    it('a bucket that vanished between the listing and the read (ENOENT) is absent; any other read failure is not', async () => {
      const gone = await readDelegationBucket(ioAnswering({ ok: false, reason: 'absent' }).io, req(listed(`${BUCKET}.spool`)));
      expect(gone).toEqual({ ok: true, input: inputOf(new Uint8Array(0), { size: 0, bucketPresent: false }) });
    });

    it('a request that is not a bucket (a bucket that is not ten digits, an owner that would leave its directory) reads nothing', async () => {
      const { io, calls } = ioAnswering({ ok: true, bytes: l1, size: l1.length });
      for (const over of [{ bucket: '../etc/passwd' }, { bucket: '20261014' }, { sessionId: 'a/b' }, { sessionId: '' }, { cursor: -1 }]) {
        expect(await readDelegationBucket(io, req(listed(`${BUCKET}.spool`), over)), JSON.stringify(over)).toMatchObject({ ok: false, reason: 'input-invalid' });
      }
      expect(calls).toEqual([]);
    });

    it('an unreadable read becomes a result that keeps the durable cursor, accepts nothing and is a gap with the reason', () => {
      const state = stateWith([cursorRow(70, 90, { lastCompleteAt: '2026-10-14T12:00:01.000Z' })]);
      const result = unreadableDelegationBucketResult(
        { sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET }, state, { reason: 'range-unreadable', detail: 'the byte range of the bucket could not be read' },
      );
      expect(result.accepted).toEqual([]);
      expect(result.interval).toBe('unmeasured');
      expect(result.detail).toBe('range-unreadable: the byte range of the bucket could not be read');
      expect(result.cursor).toEqual(cursorRow(70, 90, { lastCompleteAt: '2026-10-14T12:00:01.000Z', intervalState: 'unmeasured', detail: result.detail }));
      expect(result.state).toBe(state);
    });

    it('with no durable row an unreadable read starts one at zero, so the hour is still counted', () => {
      const result = unreadableDelegationBucketResult({ sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET }, stateWith(), { reason: 'directory-unreadable', detail: 'x' });
      expect(result.cursor).toEqual(cursorRow(0, 0, { intervalState: 'unmeasured', detail: 'directory-unreadable: x' }));
    });

    describe('over the REAL remote byte reader: an old peer that answers decoded `data` only never yields bytes (W3-M61, the consumer\'s half)', () => {
      const client = (res: unknown): FleetClient => ({ request: async () => res }) as unknown as FleetClient;
      const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');
      const readVia = (res: unknown) => readDelegationBucket(createIo(client(res)), req(listed(`${BUCKET}.spool`)));

      it('a modern answer is byte-exact', async () => {
        expect(await readVia({ data: dec.decode(l1), dataB64: b64(l1), size: l1.length })).toEqual({ ok: true, input: inputOf(l1, { size: l1.length }) });
      });
      it.each([
        ['an old peer: decoded data only', { data: dec.decode(l1), size: l1.length }],
        ['malformed base64', { data: '', dataB64: 'not base64!', size: l1.length }],
        ['non-canonical base64', { data: '', dataB64: b64(l1).replace(/=*$/, '') + '\n', size: l1.length }],
        ['a decoded length that disagrees with the size', { data: '', dataB64: b64(l1.subarray(0, 10)), size: l1.length }],
        ['a size that regressed below the cursor', { data: '', dataB64: '', size: -1 }],
      ])('%s is unmeasured: no input, no empty bucket', async (_label, res) => {
        expect(await readVia(res)).toMatchObject({ ok: false, reason: 'range-unreadable' });
      });
    });
  });
});

// ── the adapter: one durable application, and nothing exposed before it returns ──────────────────────────────────────────

interface Harness { dir: string; dur: DelegationDurability; now: () => number; clock: { ms: number }; }
const opened: DelegationDurability[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined))); });
async function openDurability(over: Partial<DelegationDurabilityDeps> = {}): Promise<Harness> {
  const dir = over.dir ?? mkTmp('ccrc-deleg-ingest-');
  const clock = { ms: Date.UTC(2026, 9, 14, 12, 30) };
  const now = (): number => clock.ms;
  const dur = await DelegationDurability.open({ dir, projection: null, now, randomUUID: () => '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', ...over });
  opened.push(dur);
  return { dir, dur, now, clock };
}
const journalLines = (dir: string): string[] => {
  try { return readFileSync(path.join(dir, 'delegation-events.log'), 'utf8').split('\n').filter((l) => l !== ''); } catch { return []; }
};

describe('the adapter: ingestAndApplyDelegationBucket', () => {
  const l1 = lineOf(common('SessionStart', { source: 'startup' }));
  const l2 = lineOf(common('SubagentStart', { agentId: 'agent-abc123', agentType: null }, { observedAt: '2026-10-14T12:00:05.000Z' }));

  it('journals the accepted events, the cursor and the hour\'s interval as ONE application and returns the state AFTER it', async () => {
    const h = await openDurability();
    const durable = delegationBucketDurabilityOf(h.dur, h.now);
    const state = await ingestAndApplyDelegationBucket(inputOf(cat(l1, l2)), h.dur.state(), durable);
    expect(journalLines(h.dir)).toHaveLength(2);
    expect(state.checkpoint.bucketCursors).toEqual([{
      sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, cursor: l1.length + l2.length, lastSize: l1.length + l2.length,
      lastCompleteAt: '2026-10-14T12:00:05.000Z', intervalState: 'measured', detail: null,
    }]);
    expect(state.checkpoint.observationIntervals).toEqual([{ sessionId: OWNER, parentIncarnation: INC, utcHour: HOUR, state: 'measured', detail: null, recordedAt: '2026-10-14T12:30:00.000Z' }]);
    expect(state.checkpoint.appliedJournalSequence).toBe(2);
    expect(state).toBe(h.dur.state());
  });

  it('a gap is made durable too: the interval for the hour is unmeasured with its detail, recorded at the injected clock', async () => {
    const h = await openDurability();
    const durable = delegationBucketDurabilityOf(h.dur, h.now);
    const state = await ingestAndApplyDelegationBucket(inputOf(cat(l1, enc.encode('garbage\n'))), h.dur.state(), durable);
    expect(journalLines(h.dir)).toHaveLength(1);
    expect(state.checkpoint.observationIntervals).toEqual([{ sessionId: OWNER, parentIncarnation: INC, utcHour: HOUR, state: 'unmeasured', detail: '1 of 2 complete lines refused: malformed-json=1', recordedAt: '2026-10-14T12:30:00.000Z' }]);
  });

  it('an unmeasured hour stays unmeasured when a later read of it is clean (the checkpoint\'s sticky merge), while the cursor row tells the latest read', async () => {
    const h = await openDurability();
    const durable = delegationBucketDurabilityOf(h.dur, h.now);
    let state = await ingestAndApplyDelegationBucket(inputOf(enc.encode('garbage\n')), h.dur.state(), durable);
    h.clock.ms += 60_000;
    const row = state.checkpoint.bucketCursors[0]!;
    state = await ingestAndApplyDelegationBucket(inputOf(l1, { cursor: row.cursor, lastSize: row.lastSize, size: row.cursor + l1.length }), state, durable);
    expect(state.checkpoint.observationIntervals.map((i) => i.state)).toEqual(['unmeasured']);
    expect(state.checkpoint.bucketCursors[0]).toMatchObject({ intervalState: 'measured', detail: null });
  });

  it('the cursor, the interval and the accepted IDs are not visible anywhere before the durable call returns (O5): the checkpoint rename has not happened when the applier is mid-write', async () => {
    const seen: Array<{ edge: string; cursors: number; intervals: number; sequence: number; settled: boolean }> = [];
    let settled = false;
    const probe: { dur: DelegationDurability | null } = { dur: null };
    const h = await openDurability({
      onEdge: (edge, when) => {
        if (when === 'before' && probe.dur !== null) {
          const cp = probe.dur.state().checkpoint;
          seen.push({ edge, cursors: cp.bucketCursors.length, intervals: cp.observationIntervals.length, sequence: cp.appliedJournalSequence, settled });
        }
      },
    });
    probe.dur = h.dur;
    const pending = ingestAndApplyDelegationBucket(inputOf(cat(l1, l2)), h.dur.state(), delegationBucketDurabilityOf(h.dur, h.now)).finally(() => { settled = true; });
    const after = await pending;
    expect(seen.map((s) => s.edge)).toEqual(['journal-write', 'journal-fsync', 'journal-write', 'journal-fsync', 'build', 'checkpoint-write', 'checkpoint-fsync', 'checkpoint-rename', 'directory-fsync']);
    for (const s of seen) expect(s, s.edge).toMatchObject({ cursors: 0, intervals: 0, sequence: 0, settled: false });
    expect(after.checkpoint.bucketCursors).toHaveLength(1);
  });

  it('a failed durable application rejects and returns no state: the caller never sees a cursor that did not become durable', async () => {
    const h = await openDurability({ onEdge: (edge, when) => { if (edge === 'journal-fsync' && when === 'before') throw new Error('disk full'); } });
    await expect(ingestAndApplyDelegationBucket(inputOf(l1), h.dur.state(), delegationBucketDurabilityOf(h.dur, h.now))).rejects.toThrow('disk full');
    expect(h.dur.state().phase).toBe('reconstructing');
    expect(h.dur.state().checkpoint.bucketCursors).toEqual([]);
  });

  it('the pure result is handed to the durable call EXACTLY once, and it is the only stateful call', async () => {
    const calls: DelegationBucketResult[] = [];
    const returned = stateWith();
    const fake: DelegationBucketDurability = { applyBucketResult: async (r) => { calls.push(r); return returned; } };
    const state = stateWith();
    const out = await ingestAndApplyDelegationBucket(inputOf(l1), state, fake);
    expect(out).toBe(returned);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(ingestDelegationBucket(inputOf(l1), state));
  });

  it('a reconstructing applier is handed the unmeasured result and refuses it (not-ready), so nothing is journaled', async () => {
    const calls: DelegationBucketResult[] = [];
    const fake: DelegationBucketDurability = { applyBucketResult: async (r) => { calls.push(r); throw new Error('not-ready'); } };
    await expect(ingestAndApplyDelegationBucket(inputOf(l1), stateWith([], 'reconstructing'), fake)).rejects.toThrow('not-ready');
    expect(calls[0]).toMatchObject({ interval: 'unmeasured', accepted: [] });
  });

  it('the adapter hands the applier copies of the cursor and the interval, so a caller who keeps the result cannot rewrite the applier\'s rows', async () => {
    const h = await openDurability();
    const result = ingest(l1);
    const out = await delegationBucketDurabilityOf(h.dur, h.now).applyBucketResult(result);
    expect(out.checkpoint.bucketCursors[0]).not.toBe(result.cursor);
    (result.cursor as { cursor: number }).cursor = 99999;
    expect(h.dur.state().checkpoint.bucketCursors[0]!.cursor).toBe(l1.length);
  });

  it('delegationBucketUtcHour is the hour\'s canonical start instant, and refuses a bucket that is not an hour', () => {
    expect(delegationBucketUtcHour('2026101412')).toBe(HOUR);
    expect(delegationBucketUtcHour('2026123123')).toBe('2026-12-31T23:00:00.000Z');
    for (const bad of ['2026101424', '2026133112', '20261014', '202610141200', '', '2026-10-14']) expect(() => delegationBucketUtcHour(bad), bad).toThrow();
  });
});

// ── End to end over the real local reader, in a fixture spool ────────────────────────────────────────────────────────────

describe('end to end: a fixture spool, the local byte reader, the applier', () => {
  it('reads the bucket in ticks as it grows: each tick accepts only the new complete lines, and a torn append waits for its LF', async () => {
    const h = await openDurability();
    const spool = mkTmp('ccrc-deleg-spool-');
    const ownerDir = path.join(spool, 'delegation', 'spool', OWNER);
    mkdirSync(ownerDir, { recursive: true });
    const file = path.join(ownerDir, `${BUCKET}.spool`);
    const durable = delegationBucketDurabilityOf(h.dur, h.now);
    const a = lineOf(common('SessionStart', { source: 'startup' }));
    const b = lineOf(common('SubagentStart', { agentId: 'agent-abc123', agentType: null }, { observedAt: '2026-10-14T12:00:05.000Z' }));
    const c = lineOf(common('SubagentStop', { agentId: 'agent-abc123', agentType: null, agentTranscriptPath: null }, { observedAt: '2026-10-14T12:00:09.000Z' }));

    const tick = async () => {
      const row = h.dur.state().checkpoint.bucketCursors.find((r) => r.bucket === BUCKET);
      const read = await readDelegationBucket(localIO, {
        ownerDir, sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, cursor: row?.cursor ?? 0, lastSize: row?.lastSize ?? 0,
        capabilityPresent: true, listing: await localIO.readdirMeasured(ownerDir),
      });
      if (!read.ok) return ingestAndApplyDelegationBucket(inputOf(new Uint8Array(0)), h.dur.state(), { applyBucketResult: async () => h.dur.state() });
      return ingestAndApplyDelegationBucket(read.input, h.dur.state(), durable);
    };

    // before the file exists: a measured absence
    await tick();
    expect(h.dur.state().checkpoint.bucketCursors).toMatchObject([{ cursor: 0, lastSize: 0, intervalState: 'measured' }]);
    writeFileSync(file, cat(a, b.subarray(0, 30)));
    await tick();
    expect(journalLines(h.dir)).toHaveLength(1);
    expect(h.dur.state().checkpoint.bucketCursors[0]).toMatchObject({ cursor: a.length, lastSize: a.length + 30, intervalState: 'measured' });
    appendFileSync(file, cat(b.subarray(30), c));
    await tick();
    expect(journalLines(h.dir)).toHaveLength(3);
    expect(h.dur.state().checkpoint.bucketCursors[0]).toMatchObject({ cursor: a.length + b.length + c.length, lastSize: a.length + b.length + c.length, intervalState: 'measured', detail: null });
    // an idle tick changes nothing in the journal
    await tick();
    expect(journalLines(h.dir)).toHaveLength(3);
    expect(h.dur.state().checkpoint.observationIntervals).toHaveLength(1);
  });

  it('a bucket cut shorter than it was is unmeasured and accepts nothing', async () => {
    const h = await openDurability();
    const spool = mkTmp('ccrc-deleg-spool-');
    const ownerDir = path.join(spool, 'delegation', 'spool', OWNER);
    mkdirSync(ownerDir, { recursive: true });
    const file = path.join(ownerDir, `${BUCKET}.spool`);
    const a = lineOf(common('SessionStart', { source: 'startup' }));
    writeFileSync(file, cat(a, a));
    const durable = delegationBucketDurabilityOf(h.dur, h.now);
    const run = async () => {
      const row = h.dur.state().checkpoint.bucketCursors[0];
      const read = await readDelegationBucket(localIO, {
        ownerDir, sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET, cursor: row?.cursor ?? 0, lastSize: row?.lastSize ?? 0,
        capabilityPresent: true, listing: await localIO.readdirMeasured(ownerDir),
      });
      if (read.ok) return ingestAndApplyDelegationBucket(read.input, h.dur.state(), durable);
      return durable.applyBucketResult(unreadableDelegationBucketResult({ sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET }, h.dur.state(), read));
    };
    await run();
    expect(journalLines(h.dir)).toHaveLength(2);
    writeFileSync(file, a.subarray(0, 20));         // cut below the cursor
    await run();
    expect(journalLines(h.dir)).toHaveLength(2);
    expect(h.dur.state().checkpoint.observationIntervals.map((i) => i.state)).toEqual(['unmeasured']);
    expect(h.dur.state().checkpoint.bucketCursors[0]).toMatchObject({ cursor: a.length * 2, intervalState: 'unmeasured' });
  });
});

// ── R27: the applier's live rows are read-only to a caller, by TYPE ────────────────────────────────────────────────────────

describe('R27: state(), the outcomes and a checkpoint change\'s result are deep-readonly (a compile-time guarantee)', () => {
  // These statements are never executed: `tsc` (the typecheck-tests suite compiles this file) is the test. Each `@ts-expect-error`
  // goes unused, and so is itself an error, the moment the type stops being deep-readonly.
  const compileOnly = (d: DelegationDurability, outcome: DelegationApplyOutcome, change: ReturnType<DelegationCheckpointChange>): void => {
    // @ts-expect-error the applier's checkpoint is read-only at the top
    d.state().checkpoint.revision = 1;
    // @ts-expect-error and through its rows: this property is the applier's own live row
    d.state().checkpoint.sessions[0].lastObservedAt = 'x';
    // @ts-expect-error and through the cursor rows an ingestion reads
    d.state().checkpoint.bucketCursors[0].cursor += 1;
    // @ts-expect-error and through a map
    d.state().checkpoint.activityIdsByNaturalKey['k'] = 'v';
    // @ts-expect-error the phase too
    d.state().phase = 'ready';
    // @ts-expect-error an outcome's state is the applier's own
    outcome.state.checkpoint.leases[0].releasedAt = null;
    // @ts-expect-error the records an application appended
    outcome.appended[0].acceptedAt = 'x';
    // @ts-expect-error the activities it opened
    outcome.openedActivities[0].endedAt = 'x';
    // @ts-expect-error and what a checkpoint change returns becomes the applier's rows
    change.sessions[0].sessionId = 'x';
    // @ts-expect-error at the top as well
    change.revision = 2;
    // The positive controls: reading, and handing the read-only view on to anything that takes the mutable types, still compile.
    const view: DeepReadonly<DelegationRecoveryState> = d.state();
    const asMutableParam: DelegationRecoveryState = view;
    void asMutableParam;
    void outcome.state.checkpoint.sessions.map((s) => s.sessionId);
  };
  it('the compile-only rows exist and are never run', () => { expect(typeof compileOnly).toBe('function'); });

  it('an adapter that receives a state and bytes mutates neither (a deep-frozen state and a copied byte array come back unchanged)', () => {
    const deepFreeze = <T>(v: T): T => {
      if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]); }
      return v;
    };
    const state = deepFreeze(stateWith([cursorRow(40, 80, { lastCompleteAt: '2026-10-14T12:00:01.000Z' })]));
    const bytes = cat(lineOf(common('SessionStart', { source: 'startup' })), enc.encode('garbage\n'));
    const copy = bytes.slice();
    const before = JSON.stringify(state);
    const input = inputOf(bytes, { cursor: 40, lastSize: 80, size: 40 + bytes.length });
    const r1 = ingestDelegationBucket(input, state);
    const r2 = unreadableDelegationBucketResult({ sessionId: OWNER, parentIncarnation: INC, bucket: BUCKET }, state, { reason: 'range-unreadable', detail: 'x' });
    expect(JSON.stringify(state)).toBe(before);
    expect(bytes).toEqual(copy);
    expect(r1.state).toBe(state);
    expect(r2.cursor).not.toBe(state.checkpoint.bucketCursors[0]);
  });
});

// ── source scans ───────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the pure/impure split and the single definition of every bound', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord');
  const src = readFileSync(path.join(dir, 'delegation-ingest.ts'), 'utf8');
  const strip = (s: string): string => s.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  const BANNER = /^\/\/ IMPURE SHELL:/m;
  const pure = strip(src.slice(0, src.search(BANNER)));

  it('there is an IMPURE SHELL banner, and above it the code names no filesystem, no SQLite, no store, no clock and no randomness', () => {
    expect(src.search(BANNER)).toBeGreaterThan(0);
    expect(pure).not.toMatch(/node:fs|fsp\.|node:sqlite|\.\/db\.js|\.\/store\.js|CoordStore|process\.|readFileSync|Date\.now|new Date\(|performance\.now|Math\.random|randomUUID|randomBytes|setTimeout|await /);
    const imports = [...pure.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../../../shared/agent-protocol.js', '../../../shared/api.js', '../io.js', './delegation-checkpoint.js', './delegation-journal.js', './delegation-model.js', 'node:crypto'].sort());
  });

  it('no clock and no randomness anywhere in the module: the one clock is the injected `now` of the adapter', () => {
    expect(strip(src)).not.toMatch(/Date\.now|new Date\(|performance\.now|Math\.random|randomUUID|randomBytes/);
  });

  it('the module reads no bound from a literal: every number comes from DELEGATION_SPOOL_BOUNDS or READ_FROM_MAX_BYTES', () => {
    expect(strip(src)).not.toMatch(/\b(4096|262144|4095|4094)\b/);
    expect(strip(src)).toMatch(/DELEGATION_SPOOL_BOUNDS/);
    expect(strip(src)).toMatch(/READ_FROM_MAX_BYTES/);
  });

  it('the adapter makes exactly one stateful call, durability.applyBucketResult(result)', () => {
    const body = src.slice(src.indexOf('export async function ingestAndApplyDelegationBucket'));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    expect(fn.match(/durability\./g)).toHaveLength(1);
    expect(fn).toMatch(/return durability\.applyBucketResult\(result\)/);
  });

  it('the event-ID domain, offsets and digest are built in ONE place', () => {
    expect(strip(src).match(/ccrc-delegation-event-v1/g)).toHaveLength(1);
  });
});
