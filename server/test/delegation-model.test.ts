// Delegation broker wave 3, Task 7: the PURE model behind the report-only coordination projection.
//
// `delegation-model.ts` is L1: no fs, no fastify, no node:sqlite, no CoordStore. It owns the journal and checkpoint
// vocabulary Task 8 builds on, the RFC 8785 encoder every journal preimage goes through, the activity natural key and
// the activity ID derived from it, the wave-3 lease guard, and the row codecs between the checkpoint's shapes and the
// six tables' columns. Every vector below is computed independently of the implementation (Python's `hashlib` and
// `json`), never by running the function under test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DELEGATION_ACTIVITY_SOURCE_KINDS,
  DELEGATION_ATTEMPT_VERDICTS,
  DELEGATION_CLEANUP_STATES,
  DELEGATION_DISPOSITIONS,
  DELEGATION_EVENT_KINDS,
  DELEGATION_EXECUTION_STATES,
  DELEGATION_INTENT_SOURCES,
  DELEGATION_LEASE_SOURCE_KINDS,
  DELEGATION_PARENTAGE_STATES,
  DELEGATION_WORKSPACE_STATES,
  type DelegationActivityNaturalKey,
} from '../../shared/api.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import {
  DelegationJsonError,
  DelegationModelError,
  assertDelegationCheckpointIdentity,
  assertWave3Lease,
  WAVE3_LEASE_SOURCE_KINDS,
  assertWave3Leases,
  canonicalDelegationJson,
  delegationActivityCodec,
  delegationAttemptCodec,
  delegationEventCodec,
  delegationLeaseCodec,
  delegationLineageCodec,
  delegationSessionCodec,
  delegationSha256Hex,
  deriveCoordinatorIntentByParent,
  deriveDelegationActivityId,
  deriveDelegationLineageId,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  leaseSourceKindOfActivity,
  parseDelegationInstant,
  projectionViewOfDelegationCheckpoint,
  restoreOrAllocateActivityId,
  type DelegationActivityRow,
  type DelegationAttemptRow,
  type DelegationCheckpointV1,
  type DelegationEventRow,
  type DelegationLeaseRow,
  type DelegationLineageRow,
  type DelegationSessionRow,
} from '../src/coord/delegation-model.js';

// ── fixed inputs (Python hashlib/json, not this module) ───────────────────────────────────────────────────────────
const J = '842563601695ebb48c8fbb35e752df0c7c36923d6c8dea27f0602367d17add3b';   // sha256(b'fixture-journal-record-1')
const ENVELOPE_EVENT_ID = '4c746b86f603359c081652227f547ce4c266b7564d5f50ea036e24b44d434318';
//   ^ the plan's eventId formula over ('lane-a-demo', 'g1', '2026-10-14T00', 0, 34, sha256(rawLine)) — a 64-hex value
//     that is NOT a journalId, so substituting it for one is the exact mistake W3-M59 names.
const KEY: DelegationActivityNaturalKey = {
  parentId: 'lane-a-demo', parentIncarnation: 'g1', sourceKind: 'agent', upstreamId: 'agent-abc123',
};
const KEY_ENCODING = '11:lane-a-demo2:g15:agent12:agent-abc123';
const ACTIVITY_ID_FROM_JOURNAL = '9239bd0ac5b8d4af700cd38ae205546b428bc6b605ef1d9adcd09c1796afcbfc';
const ACTIVITY_ID_FROM_EVENT = '190295c46781e890b4d6fe31b8177719e79d22234a52de3565025362ec8320f4';
const PREVIOUS_DIGEST = 'f1a9e9b86dd342f3dcba4e0c6e667cf21f3cb6dc7773dca8aa10778a1f9fa366';
const LINEAGE_ID = 'ebbdf66782dcfacea85082dd2f861c9eb326d6373b945b7210816474bdf027bd';
const JOURNAL_ID = 'bf02a95e96c8e7d6610086f60b45409c434bd0bab1e77b60493cf365ebb7da96';
const JOURNAL_DIGEST = 'e70e4034ed7ca41e1c9c924ae62ad2597f60be54f9c12aa5d7761fc11e2f3206';

const T0 = '2026-10-14T00:00:00.000Z';
const T1 = '2026-10-14T00:10:00.000Z';
const T2 = '2026-10-14T00:20:00.000Z';

describe('canonicalDelegationJson — RFC 8785 over the closed JSON domain', () => {
  it('orders properties by UTF-16 code units, RFC 8785 §3.2.3 vector (the emoji sorts BEFORE U+FB33)', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    };
    expect(canonicalDelegationJson(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis",'
      + '"€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it('sorts nested objects at every depth and leaves array order alone', () => {
    expect(canonicalDelegationJson({ b: [{ z: 1, a: 2 }, { y: 3 }], a: { d: null, c: true } }))
      .toBe('{"a":{"c":true,"d":null},"b":[{"a":2,"z":1},{"y":3}]}');
  });

  it('writes ECMAScript string escapes and nothing else (RFC 8785 §3.2.2 vector)', () => {
    const input = '€$\u000f\nA\'B"\\\\"/';
    expect(canonicalDelegationJson(input)).toBe(String.raw`"€$\u000f\nA'B\"\\\\\"/"`);
  });

  it.each([
    [0x00, '"\\u0000"'], [0x08, '"\\b"'], [0x09, '"\\t"'], [0x0a, '"\\n"'], [0x0b, '"\\u000b"'], [0x0c, '"\\f"'],
    [0x0d, '"\\r"'], [0x1f, '"\\u001f"'], [0x22, '"\\""'], [0x5c, '"\\\\"'],
  ])('escapes U+%s as %s', (code, expected) => {
    expect(canonicalDelegationJson(String.fromCharCode(code))).toBe(expected);
  });

  it.each([0x2f, 0x7f, 0x80, 0x2028, 0x2029, 0xfeff])('writes U+%s raw (no optional escape)', (code) => {
    const ch = String.fromCharCode(code);
    expect(canonicalDelegationJson(ch)).toBe(`"${ch}"`);
  });

  it('writes multibyte text as UTF-8 without a BOM, and adds no whitespace', () => {
    const out = canonicalDelegationJson({ 'é': '日本語😀' });
    expect(out).toBe('{"é":"日本語😀"}');
    expect(Buffer.from(out, 'utf8').toString('hex')).toBe('7b22c3a9223a22e697a5e69cace8aa9ef09f9880227d');
  });

  it('writes true, false and null in lowercase and empty containers as [] and {}', () => {
    expect(canonicalDelegationJson([true, false, null, [], {}])).toBe('[true,false,null,[],{}]');
  });

  it.each([
    [0, '0'], [-0, '0'], [1, '1'], [100, '100'], [-4.5, '-4.5'], [4.5, '4.5'],
    [0.1 + 0.2, '0.30000000000000004'], [123456789.125, '123456789.125'],
    [0.000001, '0.000001'], [9.999999999999997e-7, '9.999999999999997e-7'], [1e-7, '1e-7'], [1.5e-10, '1.5e-10'],
    [5e-324, '5e-324'], [333333333.3333333, '333333333.3333333'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'], [-Number.MAX_SAFE_INTEGER, '-9007199254740991'],
  ])('serialises the number %s as %s (ECMAScript Number-to-String, -0 is 0)', (n, expected) => {
    expect(canonicalDelegationJson(n)).toBe(expected);
    expect(canonicalDelegationJson([n])).toBe(`[${expected}]`);
  });

  it.each([
    ['2**53', 2 ** 53], ['-(2**53)', -(2 ** 53)], ['2**60', 2 ** 60], ['1e21', 1e21], ['1e300', 1e300],
    ['NaN', Number.NaN], ['Infinity', Infinity], ['-Infinity', -Infinity],
  ])('rejects the number %s before encoding', (_label, n) => {
    expect(() => canonicalDelegationJson(n)).toThrow(DelegationJsonError);
    expect(() => canonicalDelegationJson({ n })).toThrow(DelegationJsonError);
  });

  it.each([
    ['a lone high surrogate in a value', '\ud83d'],
    ['a lone low surrogate in a value', '\ude00'],
    ['a reversed pair in a value', '\ude00\ud83d'],
    ['a high surrogate followed by a plain character', '\ud83dx'],
  ])('rejects %s', (_label, s) => {
    expect(() => canonicalDelegationJson(s)).toThrow(DelegationJsonError);
    expect(() => canonicalDelegationJson([s])).toThrow(DelegationJsonError);
  });

  it('rejects a lone surrogate in a KEY, and accepts a well-formed pair there', () => {
    expect(() => canonicalDelegationJson({ ['\ud83d']: 1 })).toThrow(DelegationJsonError);
    expect(canonicalDelegationJson({ '😀': 1 })).toBe('{"😀":1}');
  });

  class Plain { a = 1; }
  const accessor = Object.defineProperty({}, 'a', { get: () => 1, enumerable: true });
  const symbolKeyed = { [Symbol('s')]: 1 };
  const hidden = Object.defineProperty({ visible: 1 }, 'hidden', { value: 2, enumerable: false });
  const arrayWithExtra = Object.assign([1], { extra: 1 });
  const sparse: unknown[] = [1, 2, 3];
  delete sparse[1];
  const holes: unknown[] = new Array(3);
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  const dupKeys = new Proxy({}, {
    ownKeys: () => ['a', 'a'],
    getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }),
  });
  it.each([
    ['undefined at the top', undefined],
    ['undefined in an object', { a: undefined }],
    ['undefined in an array', [1, undefined]],
    ['a sparse array (deleted element)', sparse],
    ['a sparse array (holes)', holes],
    ['an array with an extra property', arrayWithExtra],
    ['a Date', new Date(0)],
    ['a Map', new Map([['a', 1]])],
    ['a Set', new Set([1])],
    ['a class instance', new Plain()],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a bigint', 1n],
    ['an object with a symbol key', symbolKeyed],
    ['an accessor property', accessor],
    ['a non-enumerable data property', hidden],
    ['a cycle', cyclic],
    ['duplicate input keys (a proxy whose ownKeys repeats one)', dupKeys],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalDelegationJson(value)).toThrow(DelegationJsonError);
  });

  it('names an accessor array element as one, rather than as a missing value', () => {
    const arr: unknown[] = [1];
    Object.defineProperty(arr, 1, { get: () => 2, enumerable: true });
    expect(() => canonicalDelegationJson(arr)).toThrow(/not a data element/);
  });

  it('accepts a null-prototype object and an object built with a property named __proto__', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['b'] = 1; bare['a'] = 2;
    expect(canonicalDelegationJson(bare)).toBe('{"a":2,"b":1}');
    const proto = JSON.parse('{"__proto__":1,"a":2}') as unknown;
    expect(canonicalDelegationJson(proto)).toBe('{"__proto__":1,"a":2}');
  });

  describe('the two journal preimages, nonrecursive and exact', () => {
    const entry = {
      kind: 'lease-created', leaseId: '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', generation: 0,
      activityId: ACTIVITY_ID_FROM_JOURNAL, parentId: 'lane-a-demo', parentIncarnation: 'g1', project: 'project-a',
      adminRecord: 'wt-1', canonicalPath: '/work/project-a/.claude/worktrees/wt-1', creationBase: null,
      sourceKind: 'agent', correlationJournalIds: [J], firstObservedAt: '2026-10-14T00:14:59.000Z', lineageId: LINEAGE_ID,
    };
    const record = { v: 1, sequence: 7, acceptedAt: '2026-10-14T00:15:00.000Z', previousDigest: PREVIOUS_DIGEST, entry };

    it('journalId is SHA-256 of the canonical {v, sequence, acceptedAt, previousDigest, entry}', () => {
      const pre = canonicalDelegationJson(record);
      expect(pre.startsWith('{"acceptedAt":"2026-10-14T00:15:00.000Z","entry":{"activityId":')).toBe(true);
      expect(pre.endsWith(`,"previousDigest":"${PREVIOUS_DIGEST}","sequence":7,"v":1}`)).toBe(true);
      expect(delegationSha256Hex(pre)).toBe(JOURNAL_ID);
    });

    it('digest is SHA-256 of the canonical {v, sequence, journalId, acceptedAt, previousDigest, entry}', () => {
      const pre = canonicalDelegationJson({ ...record, journalId: JOURNAL_ID });
      expect(pre).toContain(`"journalId":"${JOURNAL_ID}"`);
      expect(delegationSha256Hex(pre)).toBe(JOURNAL_DIGEST);
    });

    it('changing journalId moves the digest preimage but not the journalId preimage', () => {
      const idPre = canonicalDelegationJson(record);
      expect(idPre).not.toContain('journalId');
      const a = canonicalDelegationJson({ ...record, journalId: JOURNAL_ID });
      const b = canonicalDelegationJson({ ...record, journalId: J });
      expect(delegationSha256Hex(a)).not.toBe(delegationSha256Hex(b));
    });

    it('a first record carries previousDigest null, written as the literal null', () => {
      const first = canonicalDelegationJson({ ...record, sequence: 1, previousDigest: null });
      expect(first).toContain('"previousDigest":null,"sequence":1');
      expect(delegationSha256Hex(first)).toBe('24f68836ba314588b2b892d9ae0e3ada33fb4862fab5ac3ed77fb05bf313cff8');
    });
  });
});

describe('the activity natural key — a canonical length-prefixed encoding, never delimiter joining', () => {
  const key = (over: Partial<DelegationActivityNaturalKey>): DelegationActivityNaturalKey => ({ ...KEY, ...over });

  it('is a fixed vector: each of the four strings as its UTF-8 byte length, a colon, then the string', () => {
    expect(encodeDelegationNaturalKey(KEY)).toBe(KEY_ENCODING);
  });

  it('counts BYTES, not characters, so a multibyte id prefixes its UTF-8 length', () => {
    const k = key({ parentId: 'é-lane', sourceKind: 'workflow', upstreamId: 'run-1#0' });
    expect(encodeDelegationNaturalKey(k)).toBe('7:é-lane2:g18:workflow7:run-1#0');
  });

  it('has no delimiter collision: the pairs a joined key would confuse encode differently', () => {
    const pairs: Array<[DelegationActivityNaturalKey, DelegationActivityNaturalKey]> = [
      [key({ parentId: 'a', parentIncarnation: 'b:c' }), key({ parentId: 'a:b', parentIncarnation: 'c' })],
      [key({ parentId: 'a', parentIncarnation: 'b|c' }), key({ parentId: 'a|b', parentIncarnation: 'c' })],
      [key({ parentId: 'a\u0000b', parentIncarnation: 'c' }), key({ parentId: 'a', parentIncarnation: 'b\u0000c' })],
      [key({ upstreamId: 'x:agent' }), key({ sourceKind: 'agent', upstreamId: 'x:agent' })],
      [key({ parentId: '', parentIncarnation: 'ab' }), key({ parentId: 'a', parentIncarnation: 'b' })],
      [key({ parentId: '1', parentIncarnation: ':a' }), key({ parentId: '1:', parentIncarnation: 'a' })],
    ];
    for (const [x, y] of pairs) {
      if (JSON.stringify(x) === JSON.stringify(y)) continue;          // a deliberately identical row proves the others differ
      expect(encodeDelegationNaturalKey(x)).not.toBe(encodeDelegationNaturalKey(y));
    }
    // And the premise: a naive ':' join WOULD have collided on the first pair.
    const naive = (k: DelegationActivityNaturalKey): string =>
      [k.parentId, k.parentIncarnation, k.sourceKind, k.upstreamId].join(':');
    expect(naive(pairs[0]![0])).toBe(naive(pairs[0]![1]));
  });

  it.each([
    ['a number where a string belongs', { ...KEY, parentId: 7 }],
    ['null', { ...KEY, upstreamId: null }],
    ['an unknown source kind', { ...KEY, sourceKind: 'carrier' }],
    ['the lease word raw as an ACTIVITY source', { ...KEY, sourceKind: 'raw' }],
    ['a lone surrogate (it would hash as U+FFFD)', { ...KEY, upstreamId: '\ud83d' }],
  ])('refuses %s', (_label, bad) => {
    expect(() => encodeDelegationNaturalKey(bad as unknown as DelegationActivityNaturalKey))
      .toThrowError(expect.objectContaining({ code: 'bad-natural-key' }));
  });
});

describe('activity IDs — SHA-256 of the natural-key encoding extended by the accepted identity journalId', () => {
  it('identity-journal fixed vector: the ID is sha256(encoding + 64:<journalId>)', () => {
    expect(deriveDelegationActivityId(KEY, J)).toBe(ACTIVITY_ID_FROM_JOURNAL);
    expect(delegationSha256Hex(`${KEY_ENCODING}64:${J}`)).toBe(ACTIVITY_ID_FROM_JOURNAL);
  });

  it('substituting the raw envelope eventId yields a DIFFERENT value, which is therefore the wrong one', () => {
    expect(ENVELOPE_EVENT_ID).toMatch(/^[0-9a-f]{64}$/);
    expect(ENVELOPE_EVENT_ID).not.toBe(J);
    expect(deriveDelegationActivityId(KEY, ENVELOPE_EVENT_ID)).toBe(ACTIVITY_ID_FROM_EVENT);
    expect(ACTIVITY_ID_FROM_EVENT).not.toBe(ACTIVITY_ID_FROM_JOURNAL);
  });

  it('is lowercase 64-hex, and any change to any of the five components changes it', () => {
    const base = deriveDelegationActivityId(KEY, J);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    const seen = new Set([base]);
    for (const k of [
      { ...KEY, parentId: 'lane-b-demo' }, { ...KEY, parentIncarnation: 'g2' },
      { ...KEY, sourceKind: 'workflow' as const }, { ...KEY, upstreamId: 'agent-abc124' },
    ]) seen.add(deriveDelegationActivityId(k, J));
    seen.add(deriveDelegationActivityId(KEY, ENVELOPE_EVENT_ID));
    expect(seen.size).toBe(6);
  });

  it.each([
    ['empty', ''], ['63 hex characters', J.slice(1)], ['65 hex characters', `${J}0`],
    ['uppercase hex', J.toUpperCase()], ['not hex', 'z'.repeat(64)],
  ])('refuses an identity journalId that is %s', (_label, bad) => {
    expect(() => deriveDelegationActivityId(KEY, bad))
      .toThrowError(expect.objectContaining({ code: 'bad-identity-journal-id' }));
  });
});

describe('restoreOrAllocateActivityId — the mapping is read first and is immutable (O1, O4)', () => {
  const deepFreeze = <T>(o: T): T => {
    if (o !== null && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
    return o;
  };

  it('allocates from the accepted journalId, and returns a NEW checkpoint carrying the mapping', () => {
    const before = deepFreeze(emptyDelegationCheckpoint());
    const out = restoreOrAllocateActivityId(KEY, J, before);
    expect(out.activityId).toBe(ACTIVITY_ID_FROM_JOURNAL);
    expect(out.checkpoint.activityIdsByNaturalKey).toEqual({ [KEY_ENCODING]: ACTIVITY_ID_FROM_JOURNAL });
    expect(out.checkpoint).not.toBe(before);
    expect(before.activityIdsByNaturalKey).toEqual({});                // the caller's checkpoint did not gain the ID
    expect(out.checkpoint.revision).toBe(before.revision);              // the revision belongs to Task 8's replacement
    expect(out.checkpoint.sessions).toBe(before.sessions);
  });

  it('restores the EXACT mapped ID and does not need a journalId once the mapping exists', () => {
    const cp = { ...emptyDelegationCheckpoint(), activityIdsByNaturalKey: { [KEY_ENCODING]: 'f'.repeat(64) } };
    const out = restoreOrAllocateActivityId(KEY, null, deepFreeze(cp));
    expect(out.activityId).toBe('f'.repeat(64));
    expect(out.checkpoint).toBe(cp);                                    // nothing to add, nothing replaced
  });

  it('a natural key cannot mint a second activity: a later, different journalId changes nothing', () => {
    const first = restoreOrAllocateActivityId(KEY, J, emptyDelegationCheckpoint());
    const second = restoreOrAllocateActivityId(KEY, ENVELOPE_EVENT_ID, first.checkpoint);
    expect(second.activityId).toBe(ACTIVITY_ID_FROM_JOURNAL);
    expect(second.checkpoint).toBe(first.checkpoint);
    expect(Object.keys(second.checkpoint.activityIdsByNaturalKey)).toHaveLength(1);
  });

  it('refuses to allocate without the accepted record’s journalId, and on a malformed one', () => {
    const cp = emptyDelegationCheckpoint();
    expect(() => restoreOrAllocateActivityId(KEY, null, cp))
      .toThrowError(expect.objectContaining({ code: 'identity-journal-id-required' }));
    expect(() => restoreOrAllocateActivityId(KEY, 'not-a-journal-id', cp))
      .toThrowError(expect.objectContaining({ code: 'bad-identity-journal-id' }));
  });

  it('reads an own property only: an inherited name is never a mapping', () => {
    const cp = { ...emptyDelegationCheckpoint(), activityIdsByNaturalKey: Object.create({ [KEY_ENCODING]: 'e'.repeat(64) }) as Record<string, string> };
    expect(restoreOrAllocateActivityId(KEY, J, cp).activityId).toBe(ACTIVITY_ID_FROM_JOURNAL);
  });
});

describe('split source domains — an ACTIVITY source and a LEASE source are different vocabularies', () => {
  /** The `IN ('a', 'b')` set of one column of one table, read from the migration's DDL. */
  const ddl = MIGRATIONS.find((m) => m.includes('CREATE TABLE delegation_sessions')) ?? '';
  const checkSet = (table: string, column: string): string[] => {
    const start = ddl.indexOf(`CREATE TABLE ${table} (`);
    expect(start, `${table} is created by the migration`).toBeGreaterThanOrEqual(0);
    const next = /\n\s*CREATE /.exec(ddl.slice(start + 1));
    const block = ddl.slice(start, next === null ? undefined : start + 1 + next.index);
    const m = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(block);
    expect(m, `${table}.${column} has an IN check`).not.toBeNull();
    return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  };

  it('bash-worktree is an ACTIVITY word only; raw and attached are LEASE words only', () => {
    const activity = new Set<string>(DELEGATION_ACTIVITY_SOURCE_KINDS);
    const lease = new Set<string>(DELEGATION_LEASE_SOURCE_KINDS);
    expect(activity.has('bash-worktree')).toBe(true);
    expect(lease.has('bash-worktree')).toBe(false);
    expect(lease.has('raw')).toBe(true);
    expect(lease.has('attached')).toBe(true);
    expect(activity.has('raw')).toBe(false);
    expect(activity.has('attached')).toBe(false);
  });

  it('the migration’s two CHECK sets are the two shared lists, member for member (attached is representable)', () => {
    expect(checkSet('delegation_activities', 'sourceKind')).toEqual([...DELEGATION_ACTIVITY_SOURCE_KINDS]);
    expect(checkSet('delegation_leases', 'sourceKind')).toEqual([...DELEGATION_LEASE_SOURCE_KINDS]);
    expect(checkSet('delegation_leases', 'sourceKind')).toContain('attached');
  });

  it('maps an activity source to its lease provenance: bash-worktree is raw, never itself', () => {
    expect(DELEGATION_ACTIVITY_SOURCE_KINDS.map((k) => [k, leaseSourceKindOfActivity(k)])).toEqual([
      ['agent', 'agent'], ['workflow', 'workflow'], ['bash-worktree', 'raw'],
    ]);
    for (const k of DELEGATION_ACTIVITY_SOURCE_KINDS) {
      expect(DELEGATION_LEASE_SOURCE_KINDS).toContain(leaseSourceKindOfActivity(k));
    }
  });

  it('every other CHECK set in the migration is the shared list it spells', () => {
    expect(checkSet('delegation_activities', 'executionState')).toEqual([...DELEGATION_EXECUTION_STATES]);
    expect(checkSet('delegation_attempts', 'verdict')).toEqual([...DELEGATION_ATTEMPT_VERDICTS]);
    expect(checkSet('delegation_leases', 'parentageState')).toEqual([...DELEGATION_PARENTAGE_STATES]);
    expect(checkSet('delegation_leases', 'workspaceState')).toEqual([...DELEGATION_WORKSPACE_STATES]);
    expect(checkSet('delegation_leases', 'disposition')).toEqual([...DELEGATION_DISPOSITIONS]);
    expect(checkSet('delegation_leases', 'cleanupState')).toEqual([...DELEGATION_CLEANUP_STATES]);
    expect(checkSet('delegation_events', 'eventKind')).toEqual([...DELEGATION_EVENT_KINDS]);
  });
});

// ── fixtures for the guard, the codecs and the projection view ───────────────────────────────────────────────────────
const lease = (over: Partial<DelegationLeaseRow> = {}): DelegationLeaseRow => ({
  leaseId: '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', generation: 0, creatingJournalSequence: 5, currentJournalSequence: 5,
  activityId: ACTIVITY_ID_FROM_JOURNAL, parentId: 'lane-a-demo', parentIncarnation: 'g1', project: 'project-a',
  adminRecord: 'wt-1', canonicalPath: '/work/project-a/.claude/worktrees/wt-1', creationBase: null, sourceKind: 'agent',
  parentageState: 'linked', workspaceState: 'unmeasured', disposition: 'ephemeral', cleanupState: 'not-due',
  cleanupPopulation: 'ephemeral-lease', firstObservedAt: T0, lastObservedAt: T0, terminalEvidenceAt: null,
  adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null,
  cleanupFinishedAt: null, cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null, ...over,
});
const session = (over: Partial<DelegationSessionRow> = {}): DelegationSessionRow => ({
  sessionId: 'lane-a-demo', parentIncarnation: 'g1', explicitIntentAt: null, effective: false, effectiveBasis: [],
  claudeSessionIds: [], firstObservedAt: T0, lastObservedAt: T2, ...over,
});
const activity = (over: Partial<DelegationActivityRow> = {}): DelegationActivityRow => ({
  activityId: ACTIVITY_ID_FROM_JOURNAL, parentId: 'lane-a-demo', parentIncarnation: 'g1', sourceKind: 'agent',
  upstreamId: 'agent-abc123', identityJournalId: J, displayName: null, executionState: 'active', openedAt: T0,
  endedAt: null, lastEventAt: T1, ...over,
});
const attempt = (over: Partial<DelegationAttemptRow> = {}): DelegationAttemptRow => ({
  attemptId: 'attempt-1', parentId: 'lane-a-demo', parentIncarnation: 'g1', project: 'project-a', adminRecord: 'wt-1',
  canonicalPath: '/work/project-a/.claude/worktrees/wt-1', attemptedAt: T1, rung: 2, verdict: 'linked',
  evidenceJournalIds: [J], detail: null, ...over,
});
const lineage = (over: Partial<DelegationLineageRow> = {}): DelegationLineageRow => ({
  lineageId: LINEAGE_ID, parentId: 'lane-a-demo', parentIncarnation: 'g1', activityId: null, leaseId: null, runId: null,
  openedAt: T0, closedAt: null, closeReason: null, ...over,
});
const eventRow = (over: Partial<DelegationEventRow> = {}): DelegationEventRow => ({
  eventId: ENVELOPE_EVENT_ID, journalSequence: 1, journalDigest: JOURNAL_DIGEST, acceptedAt: T1,
  sessionId: 'lane-a-demo', parentIncarnation: 'g1', claudeSessionId: 'cs-1', eventKind: 'PostToolUse', observedAt: T0,
  payloadJson: '{"v":1}', ...over,
});

const refusal = (fn: () => unknown, code: string): void => {
  expect(fn).toThrowError(expect.objectContaining({ name: 'DelegationModelError', code }));
};

describe('assertWave3Lease — what wave 3 may write to delegation_leases', () => {
  it('accepts the one shape wave 3 writes, null creationBase and non-null alike', () => {
    expect(() => assertWave3Lease(lease(), 5)).not.toThrow();
    expect(() => assertWave3Lease(lease({ creationBase: 'abc123' }), 9)).not.toThrow();
  });

  it('accepts every future-facing value that is not a TRANSITION: workspace, parentage and source vocabularies stay open', () => {
    for (const workspaceState of DELEGATION_WORKSPACE_STATES) {
      for (const parentageState of DELEGATION_PARENTAGE_STATES) {
        expect(() => assertWave3Lease(lease({ workspaceState, parentageState }), 5)).not.toThrow();
      }
    }
    for (const sourceKind of DELEGATION_LEASE_SOURCE_KINDS) {
      expect(() => assertWave3Lease(lease({ sourceKind }), 5)).not.toThrow();
    }
  });

  const refusals: Array<[string, Partial<DelegationLeaseRow>, number, string]> = [
    ['a nonzero generation', { generation: 1 }, 5, 'lease-generation'],
    ['a negative generation', { generation: -1 }, 5, 'lease-generation'],
    ['unequal creating and current sequences at generation 0', { currentJournalSequence: 6 }, 6, 'lease-sequences'],
    ['a current sequence below the creating one', { currentJournalSequence: 4 }, 5, 'lease-sequences'],
    ['a zero creating sequence', { creatingJournalSequence: 0, currentJournalSequence: 0 }, 5, 'lease-sequences'],
    ['a non-integer sequence', { creatingJournalSequence: 1.5, currentJournalSequence: 1.5 }, 5, 'lease-sequences'],
    ['a non-ephemeral disposition (adopted)', { disposition: 'adopted' }, 5, 'lease-disposition'],
    ['a non-ephemeral disposition (retained)', { disposition: 'retained' }, 5, 'lease-disposition'],
    ['a non-ephemeral disposition (promoted)', { disposition: 'promoted' }, 5, 'lease-disposition'],
    ['cleanup state pending', { cleanupState: 'pending' }, 5, 'lease-cleanup-state'],
    ['cleanup state unmeasured', { cleanupState: 'unmeasured' }, 5, 'lease-cleanup-state'],
    ['a lastObservedAt that is not its firstObservedAt (replay sets both to the entry’s instant)', { lastObservedAt: T1 }, 5, 'lease-last-observed'],
    ['an event-less lease: its creating sequence is past the applied journal', {}, 4, 'lease-without-journal-entry'],
    ['an event-less lease against an empty journal', {}, 0, 'lease-without-journal-entry'],
    ['terminalEvidenceAt set', { terminalEvidenceAt: T1 }, 5, 'lease-transition-field'],
    ['adoptedAt set', { adoptedAt: T1 }, 5, 'lease-transition-field'],
    ['retainedAt set', { retainedAt: T1 }, 5, 'lease-transition-field'],
    ['promotedAt set', { promotedAt: T1 }, 5, 'lease-transition-field'],
    ['cleanupDueAt set', { cleanupDueAt: T1 }, 5, 'lease-transition-field'],
    ['cleanupStartedAt set', { cleanupStartedAt: T1 }, 5, 'lease-transition-field'],
    ['cleanupFinishedAt set', { cleanupFinishedAt: T1 }, 5, 'lease-transition-field'],
    ['cleanupEvidenceJson set', { cleanupEvidenceJson: '{}' }, 5, 'lease-transition-field'],
    ['carrierGenerationSeen set', { carrierGenerationSeen: 1 }, 5, 'lease-transition-field'],
    ['releasedAt set', { releasedAt: T1 }, 5, 'lease-transition-field'],
  ];
  it.each(refusals)('refuses %s', (_label, over, applied, code) => {
    expect(() => assertWave3Lease(lease(over), applied))
      .toThrowError(expect.objectContaining({ name: 'DelegationModelError', code }));
  });

  it('names the offending field in a transition refusal', () => {
    expect(() => assertWave3Lease(lease({ adoptedAt: T1 }), 5)).toThrow(/adoptedAt/);
    expect(() => assertWave3Lease(lease({ carrierGenerationSeen: 3 }), 5)).toThrow(/carrierGenerationSeen/);
  });

  it('is a DelegationModelError, so a caller tells it from a SQLite error', () => {
    try { assertWave3Lease(lease({ generation: 2 }), 5); expect.unreachable(); } catch (err) {
      expect(err).toBeInstanceOf(DelegationModelError);
    }
  });
});

describe('assertWave3Leases — the checkpoint-level wave-3 invariants (plan: replay opens each lease’s lineage)', () => {
  const opening = (l: DelegationLeaseRow, over: Partial<DelegationLineageRow> = {}): DelegationLineageRow => ({
    lineageId: delegationSha256Hex(`opening-${l.leaseId}`), parentId: l.parentId, parentIncarnation: l.parentIncarnation,
    activityId: null, leaseId: l.leaseId, runId: null, openedAt: l.firstObservedAt, closedAt: null, closeReason: null, ...over,
  });
  const checkpoint = (leases: DelegationLeaseRow[], lineage: DelegationLineageRow[], applied = 9): DelegationCheckpointV1 =>
    ({ ...emptyDelegationCheckpoint(), appliedJournalSequence: applied, leases, lineage });
  const a = lease({ leaseId: 'lease-a' });
  const b = lease({ leaseId: 'lease-b', creatingJournalSequence: 6, currentJournalSequence: 6, canonicalPath: '/work/other', adminRecord: 'wt-2' });

  it('accepts leases that each have their lease-owned opening lineage row opened at the lease’s firstObservedAt', () => {
    expect(() => assertWave3Leases(checkpoint([a, b], [opening(a), opening(b)]))).not.toThrow();
    expect(() => assertWave3Leases(checkpoint([], []))).not.toThrow();
  });

  it('keeps the per-lease invariants: the row-level refusals fire from the checkpoint-level guard too', () => {
    refusal(() => assertWave3Leases(checkpoint([{ ...a, generation: 1 }], [opening(a)])), 'lease-generation');
    refusal(() => assertWave3Leases(checkpoint([a], [opening(a)], 4)), 'lease-without-journal-entry');
    refusal(() => assertWave3Leases(checkpoint([{ ...a, lastObservedAt: T1 }], [opening(a, { openedAt: T0 })])), 'lease-last-observed');
  });

  it.each([
    ['no lineage row at all', () => checkpoint([a], [])],
    ['lineage that belongs to another lease', () => checkpoint([a], [opening(b)])],
    ['an opening row opened at another instant', () => checkpoint([a], [opening(a, { openedAt: T1 })])],
    ['an activity-owned row that merely shares the parent', () => checkpoint([a], [opening(a, { leaseId: null, activityId: ACTIVITY_ID_FROM_JOURNAL })])],
    ['a run-owned row that merely shares the parent', () => checkpoint([a], [opening(a, { leaseId: null, runId: 7 })])],
    ['one lease covered and the other not', () => checkpoint([a, b], [opening(a)])],
  ])('refuses %s', (_label, make) => {
    refusal(() => assertWave3Leases(make()), 'lease-opening-lineage');
  });

  it('names the lease that lacks its opening row', () => {
    expect(() => assertWave3Leases(checkpoint([a, b], [opening(a)]))).toThrow(/lease-b/);
  });
});

describe('instants — canonical UTC millisecond strings only', () => {
  it('round-trips a canonical instant through epoch milliseconds', () => {
    expect(parseDelegationInstant('2026-10-14T00:15:00.000Z')).toBe(Date.UTC(2026, 9, 14, 0, 15, 0, 0));
    expect(formatDelegationInstant(Date.UTC(2026, 9, 14, 0, 15, 0, 123))).toBe('2026-10-14T00:15:00.123Z');
    expect(formatDelegationInstant(parseDelegationInstant(T1))).toBe(T1);
  });

  it.each([
    ['no milliseconds', '2026-10-14T00:15:00Z'],
    ['a numeric offset', '2026-10-14T00:15:00.000+00:00'],
    ['a lowercase z', '2026-10-14T00:15:00.000z'],
    ['a date with no time', '2026-10-14'],
    ['a space separator', '2026-10-14 00:15:00.000Z'],
    ['leading whitespace', ' 2026-10-14T00:15:00.000Z'],
    ['a day the month lacks (Feb 30 rolls over)', '2026-02-30T00:00:00.000Z'],
    ['hour 24', '2026-10-14T24:00:00.000Z'],
    ['a five-digit year', '+012026-10-14T00:15:00.000Z'],
    ['an instant before 1970', '1969-12-31T23:59:59.999Z'],
    ['an empty string', ''],
  ])('refuses %s', (_label, s) => {
    expect(() => parseDelegationInstant(s)).toThrowError(expect.objectContaining({ code: 'bad-instant' }));
  });

  it.each([[1.5], [Number.NaN], [-1], [Number.MAX_SAFE_INTEGER], [253402300800000]])('refuses to format %s', (ms) => {
    expect(() => formatDelegationInstant(ms)).toThrowError(expect.objectContaining({ code: 'bad-instant' }));
  });
});

describe('the row codecs — checkpoint shapes to table columns and back, with typed readers', () => {
  it('the lease codec writes BOTH journal sequences from their own fields (never one for the other)', () => {
    const row = lease({ generation: 3, creatingJournalSequence: 4, currentJournalSequence: 9 });
    const db = delegationLeaseCodec.toDb(row);
    expect(db['creatingJournalSequence']).toBe(4);
    expect(db['currentJournalSequence']).toBe(9);
    expect(db['generation']).toBe(3);
    const back = delegationLeaseCodec.fromDb(db);
    expect(back.creatingJournalSequence).toBe(4);
    expect(back.currentJournalSequence).toBe(9);
    expect(back).toEqual(row);
  });

  describe('a later wave’s lease: every clock and number is its own column (codec conflation, in both directions)', () => {
    /** Codec-only fixture (no wave-3 guard runs on it): every clock a DIFFERENT instant and every number a different integer,
     *  so a codec that reads or writes one from another's column cannot round-trip. */
    const M = (k: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14, 0, k, 0, 0));
    const CLOCKS = ['firstObservedAt', 'lastObservedAt', 'terminalEvidenceAt', 'adoptedAt', 'retainedAt', 'promotedAt', 'cleanupDueAt',
      'cleanupStartedAt', 'cleanupFinishedAt', 'releasedAt'] as const;
    const clocked = (): DelegationLeaseRow => lease({
      generation: 3, creatingJournalSequence: 4, currentJournalSequence: 9, creationBase: 'abc123', parentageState: 'conflicting',
      workspaceState: 'absent', disposition: 'promoted', cleanupState: 'reclaimed', cleanupEvidenceJson: '{"audit":"x"}', carrierGenerationSeen: 2,
      firstObservedAt: M(1), lastObservedAt: M(2), terminalEvidenceAt: M(3), adoptedAt: M(4), retainedAt: M(5), promotedAt: M(6),
      cleanupDueAt: M(7), cleanupStartedAt: M(8), cleanupFinishedAt: M(9), releasedAt: M(10),
    });

    it('the fixture really has ten different clocks and four different integers', () => {
      const row = clocked();
      expect(new Set(CLOCKS.map((c) => row[c])).size).toBe(10);
      expect(new Set([row.generation, row.creatingJournalSequence, row.currentJournalSequence, row.carrierGenerationSeen]).size).toBe(4);
    });

    it.each(CLOCKS.map((c, i) => [c, i + 1] as const))('toDb writes %s from its own field', (clock, minute) => {
      expect(delegationLeaseCodec.toDb(clocked())[clock]).toBe(Date.parse(M(minute)));
    });

    it('toDb writes every integer column from its own field', () => {
      const db = delegationLeaseCodec.toDb(clocked());
      expect([db['generation'], db['creatingJournalSequence'], db['currentJournalSequence'], db['carrierGenerationSeen']]).toEqual([3, 4, 9, 2]);
    });

    it.each(CLOCKS.map((c, i) => [c, i + 1] as const))('fromDb reads %s from its own column', (clock, minute) => {
      const raw = delegationLeaseCodec.toDb(clocked());
      const distinct: Record<string, unknown> = { ...raw };
      for (const c of CLOCKS) distinct[c] = Date.parse(M(CLOCKS.indexOf(c) + 1));
      expect(delegationLeaseCodec.fromDb(distinct)[clock]).toBe(M(minute));
    });

    it('round-trips the whole row', () => {
      const row = clocked();
      expect(delegationLeaseCodec.fromDb(delegationLeaseCodec.toDb(row))).toEqual(row);
    });

    it('fromDb reads every integer column from its own column', () => {
      const back = delegationLeaseCodec.fromDb(delegationLeaseCodec.toDb(clocked()));
      expect([back.generation, back.creatingJournalSequence, back.currentJournalSequence, back.carrierGenerationSeen]).toEqual([3, 4, 9, 2]);
    });
  });

  it('lists exactly the DDL’s columns, in the DDL’s order', () => {
    expect(delegationSessionCodec.columns).toEqual([
      'sessionId', 'parentIncarnation', 'explicitIntentAt', 'effective', 'effectiveBasisJson',
      'claudeSessionIdsJson', 'firstObservedAt', 'lastObservedAt',
    ]);
    expect(delegationAttemptCodec.columns).toEqual([
      'attemptId', 'parentId', 'parentIncarnation', 'project', 'adminRecord', 'canonicalPath', 'attemptedAt', 'rung',
      'verdict', 'evidenceJournalIdsJson', 'detail',
    ]);
    expect(delegationActivityCodec.columns).toEqual([
      'activityId', 'parentId', 'parentIncarnation', 'sourceKind', 'upstreamId', 'identityJournalId', 'displayName',
      'executionState', 'openedAt', 'endedAt', 'lastEventAt',
    ]);
    expect(delegationLeaseCodec.columns).toEqual([
      'leaseId', 'generation', 'creatingJournalSequence', 'currentJournalSequence', 'activityId', 'parentId', 'parentIncarnation',
      'project', 'adminRecord', 'canonicalPath', 'creationBase', 'sourceKind', 'parentageState', 'workspaceState', 'disposition',
      'cleanupState', 'cleanupPopulation', 'firstObservedAt', 'lastObservedAt', 'terminalEvidenceAt', 'adoptedAt', 'retainedAt',
      'promotedAt', 'cleanupDueAt', 'cleanupStartedAt', 'cleanupFinishedAt', 'cleanupEvidenceJson', 'carrierGenerationSeen',
      'releasedAt',
    ]);
    expect(delegationLineageCodec.columns).toEqual([
      'lineageId', 'parentId', 'parentIncarnation', 'activityId', 'leaseId', 'runId', 'openedAt', 'closedAt', 'closeReason',
    ]);
    expect(delegationEventCodec.columns).toEqual([
      'eventId', 'journalSequence', 'journalDigest', 'acceptedAt', 'sessionId', 'parentIncarnation', 'claudeSessionId',
      'eventKind', 'observedAt', 'payloadJson',
    ]);
  });

  it('writes instants as epoch milliseconds, booleans as 0/1 and the two lists as canonical JSON text', () => {
    const db = delegationSessionCodec.toDb(session({
      explicitIntentAt: T1, effective: true, effectiveBasis: ['explicit', 'delegation-inferred'], claudeSessionIds: ['cs-1'],
    }));
    expect(db).toEqual({
      sessionId: 'lane-a-demo', parentIncarnation: 'g1', explicitIntentAt: Date.parse(T1), effective: 1,
      effectiveBasisJson: '["explicit","delegation-inferred"]', claudeSessionIdsJson: '["cs-1"]',
      firstObservedAt: Date.parse(T0), lastObservedAt: Date.parse(T2),
    });
  });

  it('round-trips every row shape, nulls included', () => {
    const s = session({ explicitIntentAt: T1, effective: true, effectiveBasis: ['explicit'], claudeSessionIds: ['a', 'b'] });
    expect(delegationSessionCodec.fromDb(delegationSessionCodec.toDb(s))).toEqual(s);
    for (const a of [attempt(), attempt({ verdict: 'unresolved', canonicalPath: null, rung: null, detail: 'no record' })]) {
      expect(delegationAttemptCodec.fromDb(delegationAttemptCodec.toDb(a))).toEqual(a);
    }
    const act = activity({ displayName: 'reviewer', executionState: 'ended', endedAt: T2 });
    expect(delegationActivityCodec.fromDb(delegationActivityCodec.toDb(act))).toEqual(act);
    for (const l of [lineage({ activityId: ACTIVITY_ID_FROM_JOURNAL }), lineage({ runId: 12, closedAt: T2, closeReason: 'done' })]) {
      expect(delegationLineageCodec.fromDb(delegationLineageCodec.toDb(l))).toEqual(l);
    }
    const ev = eventRow();
    expect(delegationEventCodec.fromDb(delegationEventCodec.toDb(ev))).toEqual(ev);
  });

  it('refuses on WRITE what its own reader would refuse on READ: a projection cannot commit an unreadable row', () => {
    const bad = (fn: () => unknown) => expect(fn).toThrowError(expect.objectContaining({ name: 'DelegationModelError', code: 'bad-row' }));
    bad(() => delegationSessionCodec.toDb(session({ effectiveBasis: ['made-up'] as unknown as DelegationSessionRow['effectiveBasis'] })));
    bad(() => delegationSessionCodec.toDb(session({ effectiveBasis: ['explicit', 'run-owner ' as never] })));
    bad(() => delegationSessionCodec.toDb(session({ effectiveBasis: 'explicit' as unknown as DelegationSessionRow['effectiveBasis'] })));
    bad(() => delegationSessionCodec.toDb(session({ claudeSessionIds: [1] as unknown as DelegationSessionRow['claudeSessionIds'] })));
    bad(() => delegationAttemptCodec.toDb(attempt({ evidenceJournalIds: [null] as unknown as DelegationAttemptRow['evidenceJournalIds'] })));
    bad(() => delegationAttemptCodec.toDb(attempt({ evidenceJournalIds: 'x' as unknown as DelegationAttemptRow['evidenceJournalIds'] })));
    // and every row it DOES write reads back:
    for (const basis of DELEGATION_INTENT_SOURCES) {
      const row = session({ effectiveBasis: [basis], claudeSessionIds: ['a'] });
      expect(delegationSessionCodec.fromDb(delegationSessionCodec.toDb(row))).toEqual(row);
    }
  });

  it('reads an unknown enum word as an unreadable row; it never casts the text', () => {
    const bad = (codec: { fromDb(raw: Readonly<Record<string, unknown>>): unknown }, raw: Record<string, unknown>) =>
      expect(() => codec.fromDb(raw)).toThrowError(expect.objectContaining({ code: 'unreadable-row' }));
    bad(delegationActivityCodec, { ...delegationActivityCodec.toDb(activity()), executionState: 'running' });
    bad(delegationActivityCodec, { ...delegationActivityCodec.toDb(activity()), sourceKind: 'raw' });
    bad(delegationAttemptCodec, { ...delegationAttemptCodec.toDb(attempt()), verdict: 'maybe' });
    bad(delegationLeaseCodec, { ...delegationLeaseCodec.toDb(lease()), sourceKind: 'bash-worktree' });
    bad(delegationLeaseCodec, { ...delegationLeaseCodec.toDb(lease()), disposition: 'abandoned' });
    bad(delegationLeaseCodec, { ...delegationLeaseCodec.toDb(lease()), cleanupPopulation: 'persistent-lease' });
    bad(delegationEventCodec, { ...delegationEventCodec.toDb(eventRow()), eventKind: 'Stop' });
    bad(delegationAttemptCodec, { ...delegationAttemptCodec.toDb(attempt()), rung: 5 });
    bad(delegationAttemptCodec, { ...delegationAttemptCodec.toDb(attempt()), rung: 0 });
    bad(delegationLeaseCodec, { ...delegationLeaseCodec.toDb(lease()), generation: 1.5 });
    bad(delegationLeaseCodec, { ...delegationLeaseCodec.toDb(lease()), creatingJournalSequence: '5' });
    bad(delegationLineageCodec, { ...delegationLineageCodec.toDb(lineage({ runId: 3 })), runId: 3.5 });
  });

  it('reads a malformed list, a wrong storage class or a missing column as an unreadable row', () => {
    const base = delegationSessionCodec.toDb(session());
    const bad = (raw: Record<string, unknown>) =>
      expect(() => delegationSessionCodec.fromDb(raw)).toThrowError(expect.objectContaining({ code: 'unreadable-row' }));
    bad({ ...base, effectiveBasisJson: 'not json' });
    bad({ ...base, effectiveBasisJson: '{"a":1}' });
    bad({ ...base, effectiveBasisJson: '["explicit","made-up"]' });
    bad({ ...base, claudeSessionIdsJson: '[1]' });
    bad({ ...base, effective: 2 });
    bad({ ...base, effective: '1' });
    bad({ ...base, firstObservedAt: 1.5 });
    bad({ ...base, firstObservedAt: 'T0' });
    bad({ ...base, explicitIntentAt: undefined });
    const { sessionId: _omitted, ...missing } = base;
    bad(missing);
  });
});

describe('the projection view — what a checkpoint looks like once projected and read back', () => {
  const checkpoint = (): DelegationCheckpointV1 => ({
    ...emptyDelegationCheckpoint(),
    revision: 9, appliedJournalSequence: 8, appliedJournalId: J, appliedJournalDigest: JOURNAL_DIGEST,
    activityIdsByNaturalKey: { stale: 'x'.repeat(64) },
    coordinatorIntentByParent: { 'lane-a-demo': T1 },
    sessions: [
      session({ sessionId: 'lane-b-demo' }),
      session({ parentIncarnation: 'g2', explicitIntentAt: T1 }),
      session({ explicitIntentAt: T1 }),
    ],
    activities: [activity({ activityId: 'b'.repeat(64), upstreamId: 'agent-2' }), activity()],
    leases: [lease({ leaseId: 'z' }), lease({ leaseId: 'a' })],
    bucketCursors: [{ sessionId: 's', parentIncarnation: 'g1', bucket: 'b', cursor: 1, lastSize: 1, lastCompleteAt: null, intervalState: 'measured', detail: null, anchor: null, replaced: false }],
    observationIntervals: [{ sessionId: 's', parentIncarnation: 'g1', utcHour: T0, state: 'measured', detail: null, recordedAt: T0 }],
    pruningHolds: [{ journalId: J, reason: 'checkpoint-anchor', ownerId: 'x' }],
  });

  it('an empty checkpoint is version 1, revision 0, no anchor, every collection empty', () => {
    expect(emptyDelegationCheckpoint()).toEqual({
      v: 1, revision: 0, appliedJournalSequence: 0, appliedJournalId: null, appliedJournalDigest: null,
      activityIdsByNaturalKey: {}, coordinatorIntentByParent: {}, sessions: [], attempts: [], activities: [], leases: [],
      lineage: [], bucketCursors: [], observationIntervals: [], pruningHolds: [],
    });
  });

  it('zeroes the checkpoint-only members; they are never read back as authority', () => {
    const view = projectionViewOfDelegationCheckpoint(checkpoint());
    expect(view.revision).toBe(0);
    expect(view.appliedJournalSequence).toBe(0);
    expect(view.appliedJournalId).toBeNull();
    expect(view.appliedJournalDigest).toBeNull();
    expect(view.bucketCursors).toEqual([]);
    expect(view.observationIntervals).toEqual([]);
    expect(view.pruningHolds).toEqual([]);
  });

  it('derives the natural-key map from the activity rows and the intent map from the session rows', () => {
    const view = projectionViewOfDelegationCheckpoint(checkpoint());
    expect(view.coordinatorIntentByParent).toEqual({ 'lane-a-demo': T1 });
    expect(view.activityIdsByNaturalKey).toEqual({
      [KEY_ENCODING]: ACTIVITY_ID_FROM_JOURNAL,
      '11:lane-a-demo2:g15:agent7:agent-2': 'b'.repeat(64),
    });
    expect(view.activityIdsByNaturalKey).not.toHaveProperty('stale');
  });

  it('takes the LATEST explicit intent when a parent’s incarnations disagree, and none for a parent without one', () => {
    const cp = {
      ...emptyDelegationCheckpoint(),
      sessions: [session({ explicitIntentAt: T0 }), session({ parentIncarnation: 'g2', explicitIntentAt: T2 }), session({ sessionId: 'lane-b-demo' })],
    };
    expect(projectionViewOfDelegationCheckpoint(cp).coordinatorIntentByParent).toEqual({ 'lane-a-demo': T2 });
  });

  it('orders every row array by its primary key in UTF-8 byte order, the order the store reads them in', () => {
    const view = projectionViewOfDelegationCheckpoint(checkpoint());
    expect(view.sessions.map((s) => `${s.sessionId}/${s.parentIncarnation}`)).toEqual(['lane-a-demo/g1', 'lane-a-demo/g2', 'lane-b-demo/g1']);
    expect(view.activities.map((a) => a.activityId)).toEqual([ACTIVITY_ID_FROM_JOURNAL, 'b'.repeat(64)]);
    expect(view.leases.map((l) => l.leaseId)).toEqual(['a', 'z']);
    const wide = projectionViewOfDelegationCheckpoint({
      ...emptyDelegationCheckpoint(),
      leases: [lease({ leaseId: '😀' }), lease({ leaseId: '￿' })],
    });
    // U+FFFF is EF BF BF, the emoji F0 9F 98 80: byte order puts the emoji LAST, where UTF-16 order would put it first.
    expect(wide.leases.map((l) => l.leaseId)).toEqual(['￿', '😀']);
  });

  it('does not mutate the checkpoint it is given', () => {
    const cp = checkpoint();
    const before = canonicalDelegationJson(cp);
    projectionViewOfDelegationCheckpoint(cp);
    expect(canonicalDelegationJson(cp)).toBe(before);
  });
});

describe('Task 8A fix round 1: the lease source kinds wave 3 may write', () => {
  it('are the shared lease vocabulary minus `attached`, derived once (no hand-kept second list)', () => {
    expect([...WAVE3_LEASE_SOURCE_KINDS]).toEqual(DELEGATION_LEASE_SOURCE_KINDS.filter((k) => k !== 'attached'));
    expect(WAVE3_LEASE_SOURCE_KINDS).not.toContain('attached');
    for (const kind of WAVE3_LEASE_SOURCE_KINDS) expect(DELEGATION_LEASE_SOURCE_KINDS).toContain(kind);
  });
});

describe('Task 8A additions: the lease lineage ID, the intent derivation and the checkpoint identity invariants', () => {
  // Python: sha256(lp('ccrc-delegation-lineage-v1') + lp(leaseId) + lp(parentId) + lp(parentIncarnation) + lp(activityId)).
  const PARTS = { leaseId: '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', parentId: 'lane-a-demo', parentIncarnation: 'g1', activityId: ACTIVITY_ID_FROM_JOURNAL };

  it('derives the lineage ID from a domain tag and the four length-prefixed strings (fixed vector)', () => {
    expect(deriveDelegationLineageId(PARTS)).toBe('047ea347b1d2689ce34424088dd6e9af1f13eb8d0302b609a205d230322478e6');
  });
  it('is sensitive to every part and to the boundary between parts', () => {
    const id = deriveDelegationLineageId(PARTS);
    for (const k of ['leaseId', 'parentId', 'parentIncarnation', 'activityId'] as const) expect(deriveDelegationLineageId({ ...PARTS, [k]: `${PARTS[k]}x` })).not.toBe(id);
    expect(deriveDelegationLineageId({ ...PARTS, leaseId: 'ab', parentId: 'c' })).not.toBe(deriveDelegationLineageId({ ...PARTS, leaseId: 'a', parentId: 'bc' }));
    expect(() => deriveDelegationLineageId({ ...PARTS, leaseId: '' })).toThrow(DelegationModelError);
  });

  const session = (sessionId: string, inc: string, intent: string | null): DelegationSessionRow => ({
    sessionId, parentIncarnation: inc, explicitIntentAt: intent, effective: intent !== null, effectiveBasis: intent === null ? [] : ['explicit'],
    claudeSessionIds: [], firstObservedAt: T0, lastObservedAt: T0,
  });
  it('derives the intent map from the session rows: the LATEST explicitIntentAt per parent, none for a parent without intent', () => {
    expect(deriveCoordinatorIntentByParent([session('a', 'g1', T1), session('a', 'g2', T2), session('b', 'g1', null)])).toEqual({ a: T2 });
    expect(deriveCoordinatorIntentByParent([])).toEqual({});
  });

  describe('assertDelegationCheckpointIdentity', () => {
    const activity: DelegationActivityRow = {
      activityId: ACTIVITY_ID_FROM_JOURNAL, parentId: KEY.parentId, parentIncarnation: KEY.parentIncarnation, sourceKind: 'agent', upstreamId: KEY.upstreamId,
      identityJournalId: J, displayName: null, executionState: 'active', openedAt: T0, endedAt: null, lastEventAt: T0,
    };
    const cp: DelegationCheckpointV1 = {
      ...emptyDelegationCheckpoint(), activities: [activity], activityIdsByNaturalKey: { [KEY_ENCODING]: ACTIVITY_ID_FROM_JOURNAL },
      sessions: [session('lane-a-demo', 'g1', null)],
    };
    const code = (c: DelegationCheckpointV1): string => {
      try { assertDelegationCheckpointIdentity(c); } catch (err) { if (err instanceof DelegationModelError) return err.code; throw err; }
      return 'accepted';
    };
    it('accepts a consistent checkpoint, and the empty one', () => {
      expect(code(cp)).toBe('accepted');
      expect(code(emptyDelegationCheckpoint())).toBe('accepted');
    });
    it('refuses an ID that is not the derivation from the natural key and identity journalId (the envelope eventId is not one)', () => {
      expect(code({ ...cp, activities: [{ ...activity, activityId: ACTIVITY_ID_FROM_EVENT }], activityIdsByNaturalKey: { [KEY_ENCODING]: ACTIVITY_ID_FROM_EVENT } })).toBe('activity-id-mismatch');
    });
    it('refuses a natural-key map that disagrees with the rows in either direction, and an intent map that disagrees with the sessions', () => {
      expect(code({ ...cp, activityIdsByNaturalKey: {} })).toBe('natural-key-map');
      expect(code({ ...cp, activityIdsByNaturalKey: { ...cp.activityIdsByNaturalKey, '1:x1:y5:agent1:z': ACTIVITY_ID_FROM_EVENT } })).toBe('natural-key-map');
      expect(code({ ...cp, coordinatorIntentByParent: { 'lane-a-demo': T1 } })).toBe('intent-map');
    });
  });
});

describe('the model is L1: pure, with no randomness and no IO of its own', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'delegation-model.ts'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

  it('imports node:crypto and shared/api.ts and nothing else (no fs, no fastify, no node:sqlite, no CoordStore)', () => {
    const specs = [...code.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]);
    expect(specs.sort()).toEqual(['../../../shared/agent-protocol.js', '../../../shared/api.js', 'node:crypto']);
  });

  it('calls no source of randomness or time: the serialized journal adapter owns randomUUID, and pure policy never mints', () => {
    expect(code).not.toMatch(/\brandomUUID\b|\brandomBytes\b|\bMath\.random\b|\bDate\.now\b|\bnew Date\(\)/);
  });
});
