// Overlord W1, journal kernel, Task 1: a characterization of the delegation journal's codec and chain, and of the canonical
// encodings under them (`canonicalDelegationJson`, `delegationSha256Hex`, `isLowerHex64`, `parseDelegationInstant`).
//
// Every expected value below is a LITERAL measured on `main` before the kernel move and pasted in: none is computed here from the
// code under test. The file reaches the code only through the names `delegation-journal.ts` and `delegation-model.ts` export, so the
// move commits that relocate the canonical writer, the hashing and the chain into the shared kernels leave it untouched, and it stays
// green after each of them. It is never edited by a move commit: an intended behaviour change is a commit of its own.
//
// What it pins: the exact bytes, `journalId` and `digest` of one record of each entry kind; the canonical JSON of the domain's edge
// values and the exact message of each value it refuses; and every refusal SITE of the line decoder, the chain, the torn-tail error and
// the two whole-journal readers (class, `code`, message and `where`, `where` absent where a site passes none), plus the order in which a
// line or journal with two defects reports them.
import { describe, expect, it } from 'vitest';
import {
  DELEGATION_JOURNAL_ERROR_CODES,
  DelegationJournalChain,
  DelegationJournalError,
  DelegationJournalLineSplitter,
  buildDelegationJournalRecord,
  decodeDelegationJournalLine,
  delegationJournalDigest,
  delegationJournalId,
  delegationLeaseIdentityKey,
  delegationTailHealPlan,
  delegationTornTailError,
  encodeDelegationJournalRecord,
  findDelegationJsonDefect,
  isDelegationJournalKebab,
  parseDelegationJournal,
  planDelegationJournalAppend,
  validateDelegationJournalBytes,
  type DelegationJournalChainOptions,
  type DelegationLeaseView,
} from '../src/coord/delegation-journal.js';
import {
  DelegationJsonError,
  DelegationModelError,
  canonicalDelegationJson,
  delegationSha256Hex,
  formatDelegationInstant,
  isLowerHex64,
  parseDelegationInstant,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Inputs only. No expected value below is computed from the code under test: every `expect` carries a pasted literal.

type Entry = DelegationJournalEntryV1;
type Rec = DelegationJournalRecordV1;
type Ev = Extract<Entry, { kind: 'evidence-accepted' }>['event'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const H = (c: string): string => c.repeat(64);
const U8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const TXT = (b: Uint8Array): string => new TextDecoder().decode(b);
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const thrown = (e: Error): never => { throw e; };

const ev = (n: number, extra: Record<string, unknown> = {}): Ev => ({
  v: 1, observedAt: T(n), sessionId: 'lane-a-project-a', parentIncarnation: 'g1', claudeSessionId: '11111111-2222-3333-4444-555555555555',
  eventId: H('0123456789abcdef'.charAt(n)), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
  eventKind: 'SessionStart', source: 'startup', ...extra,
}) as unknown as Ev;
const evidence = (n: number, extra: Record<string, unknown> = {}): Entry => ({ kind: 'evidence-accepted', event: ev(n, extra) });
const LEASE_CREATED: Entry = {
  kind: 'lease-created', leaseId: 'lease-1', generation: 0, activityId: H('a'), parentId: 'lane-a-project-a', parentIncarnation: 'g1',
  project: 'project-a', adminRecord: 'wt-1', canonicalPath: '/work/project-a/wt-1', creationBase: 'main', sourceKind: 'agent',
  correlationJournalIds: [H('b')], firstObservedAt: T(5), lineageId: H('c'),
};
const LEASE_TRANSITION: Entry = {
  kind: 'lease-transition', leaseId: 'lease-1', generation: 1, reason: 'carrier', to: 'adopted', at: T(6), expiresAt: T(600),
  terminalEvidenceAt: null, runId: 7, promotedSession: null, auditEvidence: null, lineageClose: null, lineageOpenRun: null,
  resolvesThrough: { attemptedAt: T(5), attemptId: 'attempt-1' },
};
const LEASE_RELEASED: Entry = {
  kind: 'lease-released', leaseId: 'lease-1', generation: 2, releaseReason: 'native-removed', at: T(7), lastHeadSha: 'abc1234', resolvesThrough: null,
};
const LEASE_SEEN: Entry = { kind: 'lease-carrier-seen', leaseId: 'lease-1', generation: 1, at: T(8) };

const rec = (sequence: number, entry: Entry, previousDigest: string | null = null, acceptedAt: string = T(1000 + sequence)): Rec =>
  buildDelegationJournalRecord({ sequence, acceptedAt, previousDigest, entry });
function chainOf(entries: readonly Entry[], first = 1, previous: string | null = null): Rec[] {
  const out: Rec[] = [];
  let prev = previous;
  entries.forEach((entry, i) => { const r = rec(first + i, entry, prev); out.push(r); prev = r.digest; });
  return out;
}
const lineOf = (r: Rec): string => TXT(encodeDelegationJournalRecord(r)).slice(0, -1);
const bytesOf = (records: readonly Rec[]): Uint8Array => cat(...records.map(encodeDelegationJournalRecord));
const tweak = (r: Rec, f: (o: Loose) => void): string => { const o = JSON.parse(lineOf(r)) as Loose; f(o); return JSON.stringify(o); };
const badEntry = (entry: Entry, f: (e: Loose) => void): Uint8Array => U8(tweak(rec(1, entry), (o) => f(o.entry)));
/** Replaces the LAST occurrence: the record's own trailing key, not identical text nested inside its event. */
const replaceLast = (s: string, from: string, to: string): string => {
  const at = s.lastIndexOf(from);
  if (at < 0) throw new Error(`${from} not found`);
  return s.slice(0, at) + to + s.slice(at + from.length);
};
/** Valid JSON for the same value that is NOT the canonical encoding: the keys written in reverse order. */
const uncanonical = (canonicalText: string): string => {
  const reversed = (v: unknown): unknown => (Array.isArray(v) ? v.map(reversed) : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v);
  return JSON.stringify(reversed(JSON.parse(canonicalText)));
};

const [R1, R2, R3] = chainOf([evidence(1), evidence(2), evidence(3)]) as [Rec, Rec, Rec];
const LINE1 = lineOf(R1);
const JOURNAL3 = bytesOf([R1, R2, R3]);
/** A chain that starts at sequence 5, as a compacted journal would. */
const [S5, S6] = chainOf([evidence(4), evidence(5)], 5, H('9')) as [Rec, Rec];

class Plain { x = 1; }
const NO_LEASES: DelegationLeaseView = { byIdentity: () => undefined, byPath: () => undefined };

function caught(fn: () => unknown): Error {
  try { fn(); } catch (err) {
    if (err instanceof Error) return err;
    throw err;
  }
  throw new Error('expected a refusal, but nothing was thrown');
}
/** Class, code, message and `where` of a refusal, each exactly. `where` is `undefined` for a site that passes none. */
function expectRefusal(fn: () => unknown, cls: new (...args: never[]) => Error, code: string | undefined, message: string, where: { line?: number; offset?: number } | undefined): void {
  const err = caught(fn);
  expect(err.constructor).toBe(cls);
  expect(err).toBeInstanceOf(cls);
  expect((err as { code?: unknown }).code).toBe(code);
  expect(err.message).toBe(message);
  expect((err as { where?: unknown }).where).toStrictEqual(where);
}

/** The chain's every observable after feeding `records`: a refusal (with how far it got) or the readers and the coverage. */
function chainSnap(opts: DelegationJournalChainOptions, records: readonly Rec[]): unknown {
  const c = new DelegationJournalChain(opts);
  const refusal = (err: unknown): { code: string; message: string; where: unknown } => {
    if (err instanceof DelegationJournalError) return { code: err.code, message: err.message, where: err.where === undefined ? 'none' : err.where };
    throw err;
  };
  try { for (const r of records) c.accept(r); } catch (err) { return { acceptRefused: refusal(err), recordCount: c.recordCount(), head: c.head() }; }
  const readers = { head: c.head(), recordCount: c.recordCount(), firstRecord: c.firstRecord(), anchorWasSeen: c.anchorWasSeen() };
  try { return { ...readers, finish: c.finish() }; } catch (err) { return { ...readers, finishRefused: refusal(err) }; }
}

/** The lines and the leftover of a stream cut into two chunks at `k`. */
function splitAt(bytes: Uint8Array, k: number): { lines: string[]; leftover: string } {
  const s = new DelegationJournalLineSplitter();
  const lines = [...s.push(bytes.subarray(0, k)), ...s.push(bytes.subarray(k))].map((l) => TXT(l));
  return { lines, leftover: TXT(s.leftover()) };
}

describe("golden records: bytes, journalId, digest", () => {
  it("golden evidence-accepted", () => {
    expect(TXT(encodeDelegationJournalRecord(rec(1, evidence(1), null)))).toEqual("{\"acceptedAt\":\"2026-10-14T00:16:41.000Z\",\"digest\":\"ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9\",\"entry\":{\"event\":{\"bucket\":\"2026101400\",\"claudeSessionId\":\"11111111-2222-3333-4444-555555555555\",\"endOffset\":199,\"eventId\":\"1111111111111111111111111111111111111111111111111111111111111111\",\"eventKind\":\"SessionStart\",\"observedAt\":\"2026-10-14T00:00:01.000Z\",\"parentIncarnation\":\"g1\",\"sessionId\":\"lane-a-project-a\",\"source\":\"startup\",\"startOffset\":100,\"v\":1},\"kind\":\"evidence-accepted\"},\"journalId\":\"c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502\",\"previousDigest\":null,\"sequence\":1,\"v\":1}\n");
    expect(rec(1, evidence(1), null).journalId).toEqual("c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502");
    expect(rec(1, evidence(1), null).digest).toEqual("ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9");
    expect(rec(1, evidence(1), null).previousDigest).toEqual(null);
    expect(decodeDelegationJournalLine(encodeDelegationJournalRecord(rec(1, evidence(1), null)).subarray(0, -1))).toEqual(rec(1, evidence(1), null));
  });
  it("golden evidence-accepted with an opaque variant field", () => {
    expect(TXT(encodeDelegationJournalRecord(rec(2, evidence(2, { toolName: 'Bash', nested: { b: [1, 2.5, 7], a: null } }), H('d'))))).toEqual("{\"acceptedAt\":\"2026-10-14T00:16:42.000Z\",\"digest\":\"48c8e45968e79ecb18c88913cf6400550ea51467acab7aedc127a88a3dd721bc\",\"entry\":{\"event\":{\"bucket\":\"2026101400\",\"claudeSessionId\":\"11111111-2222-3333-4444-555555555555\",\"endOffset\":299,\"eventId\":\"2222222222222222222222222222222222222222222222222222222222222222\",\"eventKind\":\"SessionStart\",\"nested\":{\"a\":null,\"b\":[1,2.5,7]},\"observedAt\":\"2026-10-14T00:00:02.000Z\",\"parentIncarnation\":\"g1\",\"sessionId\":\"lane-a-project-a\",\"source\":\"startup\",\"startOffset\":200,\"toolName\":\"Bash\",\"v\":1},\"kind\":\"evidence-accepted\"},\"journalId\":\"d9b4dcbffe4ad59081167d0d358dcf6bcf1032d968b1494314ce13fd554412d9\",\"previousDigest\":\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\",\"sequence\":2,\"v\":1}\n");
    expect(rec(2, evidence(2, { toolName: 'Bash', nested: { b: [1, 2.5, 7], a: null } }), H('d')).journalId).toEqual("d9b4dcbffe4ad59081167d0d358dcf6bcf1032d968b1494314ce13fd554412d9");
    expect(rec(2, evidence(2, { toolName: 'Bash', nested: { b: [1, 2.5, 7], a: null } }), H('d')).digest).toEqual("48c8e45968e79ecb18c88913cf6400550ea51467acab7aedc127a88a3dd721bc");
    expect(rec(2, evidence(2, { toolName: 'Bash', nested: { b: [1, 2.5, 7], a: null } }), H('d')).previousDigest).toEqual("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");
    expect(decodeDelegationJournalLine(encodeDelegationJournalRecord(rec(2, evidence(2, { toolName: 'Bash', nested: { b: [1, 2.5, 7], a: null } }), H('d'))).subarray(0, -1))).toEqual(rec(2, evidence(2, { toolName: 'Bash', nested: { b: [1, 2.5, 7], a: null } }), H('d')));
  });
  it("golden lease-created", () => {
    expect(TXT(encodeDelegationJournalRecord(rec(3, LEASE_CREATED, H('d'))))).toEqual("{\"acceptedAt\":\"2026-10-14T00:16:43.000Z\",\"digest\":\"842bd6f50962ca5f095a2ba767ff259d032e62ae59245456da640c3bc61d189d\",\"entry\":{\"activityId\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"adminRecord\":\"wt-1\",\"canonicalPath\":\"/work/project-a/wt-1\",\"correlationJournalIds\":[\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"],\"creationBase\":\"main\",\"firstObservedAt\":\"2026-10-14T00:00:05.000Z\",\"generation\":0,\"kind\":\"lease-created\",\"leaseId\":\"lease-1\",\"lineageId\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"parentId\":\"lane-a-project-a\",\"parentIncarnation\":\"g1\",\"project\":\"project-a\",\"sourceKind\":\"agent\"},\"journalId\":\"3bf93f483394360ae9d7edb721e775376f14dd36fcbaed2cca97b9d066d70dea\",\"previousDigest\":\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\",\"sequence\":3,\"v\":1}\n");
    expect(rec(3, LEASE_CREATED, H('d')).journalId).toEqual("3bf93f483394360ae9d7edb721e775376f14dd36fcbaed2cca97b9d066d70dea");
    expect(rec(3, LEASE_CREATED, H('d')).digest).toEqual("842bd6f50962ca5f095a2ba767ff259d032e62ae59245456da640c3bc61d189d");
    expect(rec(3, LEASE_CREATED, H('d')).previousDigest).toEqual("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");
    expect(decodeDelegationJournalLine(encodeDelegationJournalRecord(rec(3, LEASE_CREATED, H('d'))).subarray(0, -1))).toEqual(rec(3, LEASE_CREATED, H('d')));
  });
  it("golden lease-transition", () => {
    expect(TXT(encodeDelegationJournalRecord(rec(4, LEASE_TRANSITION, H('e'))))).toEqual("{\"acceptedAt\":\"2026-10-14T00:16:44.000Z\",\"digest\":\"e883b35338e3662b39ca27c23f0c071e8053231781e120bed63753469eb46eb0\",\"entry\":{\"at\":\"2026-10-14T00:00:06.000Z\",\"auditEvidence\":null,\"expiresAt\":\"2026-10-14T00:10:00.000Z\",\"generation\":1,\"kind\":\"lease-transition\",\"leaseId\":\"lease-1\",\"lineageClose\":null,\"lineageOpenRun\":null,\"promotedSession\":null,\"reason\":\"carrier\",\"resolvesThrough\":{\"attemptId\":\"attempt-1\",\"attemptedAt\":\"2026-10-14T00:00:05.000Z\"},\"runId\":7,\"terminalEvidenceAt\":null,\"to\":\"adopted\"},\"journalId\":\"d03bb84d025f56d08661493fad1b2ccc653101d531e261587b96e4f45eb4bdb7\",\"previousDigest\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\",\"sequence\":4,\"v\":1}\n");
    expect(rec(4, LEASE_TRANSITION, H('e')).journalId).toEqual("d03bb84d025f56d08661493fad1b2ccc653101d531e261587b96e4f45eb4bdb7");
    expect(rec(4, LEASE_TRANSITION, H('e')).digest).toEqual("e883b35338e3662b39ca27c23f0c071e8053231781e120bed63753469eb46eb0");
    expect(rec(4, LEASE_TRANSITION, H('e')).previousDigest).toEqual("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    expect(decodeDelegationJournalLine(encodeDelegationJournalRecord(rec(4, LEASE_TRANSITION, H('e'))).subarray(0, -1))).toEqual(rec(4, LEASE_TRANSITION, H('e')));
  });
  it("golden lease-released", () => {
    expect(TXT(encodeDelegationJournalRecord(rec(5, LEASE_RELEASED, H('f'))))).toEqual("{\"acceptedAt\":\"2026-10-14T00:16:45.000Z\",\"digest\":\"6a7dc958a0dd00e876708c4b92b106906dcb2c78092ae04275debc90484b7c17\",\"entry\":{\"at\":\"2026-10-14T00:00:07.000Z\",\"generation\":2,\"kind\":\"lease-released\",\"lastHeadSha\":\"abc1234\",\"leaseId\":\"lease-1\",\"releaseReason\":\"native-removed\",\"resolvesThrough\":null},\"journalId\":\"f0b19802ee7bd16a945a357c2544388eea90343cded63a4c572803099bdc37a0\",\"previousDigest\":\"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\",\"sequence\":5,\"v\":1}\n");
    expect(rec(5, LEASE_RELEASED, H('f')).journalId).toEqual("f0b19802ee7bd16a945a357c2544388eea90343cded63a4c572803099bdc37a0");
    expect(rec(5, LEASE_RELEASED, H('f')).digest).toEqual("6a7dc958a0dd00e876708c4b92b106906dcb2c78092ae04275debc90484b7c17");
    expect(rec(5, LEASE_RELEASED, H('f')).previousDigest).toEqual("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    expect(decodeDelegationJournalLine(encodeDelegationJournalRecord(rec(5, LEASE_RELEASED, H('f'))).subarray(0, -1))).toEqual(rec(5, LEASE_RELEASED, H('f')));
  });
  it("golden lease-carrier-seen", () => {
    expect(TXT(encodeDelegationJournalRecord(rec(6, LEASE_SEEN, H('1'))))).toEqual("{\"acceptedAt\":\"2026-10-14T00:16:46.000Z\",\"digest\":\"9c2c8235e99cda0df87b5f84175b4a7e86a64aa952a5bcce58c26d17cb248b78\",\"entry\":{\"at\":\"2026-10-14T00:00:08.000Z\",\"generation\":1,\"kind\":\"lease-carrier-seen\",\"leaseId\":\"lease-1\"},\"journalId\":\"4606af9631afb5eddfa6e8085a54ed033d3e78198d0c6b7df4d58fdd07620d44\",\"previousDigest\":\"1111111111111111111111111111111111111111111111111111111111111111\",\"sequence\":6,\"v\":1}\n");
    expect(rec(6, LEASE_SEEN, H('1')).journalId).toEqual("4606af9631afb5eddfa6e8085a54ed033d3e78198d0c6b7df4d58fdd07620d44");
    expect(rec(6, LEASE_SEEN, H('1')).digest).toEqual("9c2c8235e99cda0df87b5f84175b4a7e86a64aa952a5bcce58c26d17cb248b78");
    expect(rec(6, LEASE_SEEN, H('1')).previousDigest).toEqual("1111111111111111111111111111111111111111111111111111111111111111");
    expect(decodeDelegationJournalLine(encodeDelegationJournalRecord(rec(6, LEASE_SEEN, H('1'))).subarray(0, -1))).toEqual(rec(6, LEASE_SEEN, H('1')));
  });
  it("the preimages of one fixed field set", () => {
    expect(delegationJournalId({ sequence: 1, acceptedAt: T(1), previousDigest: null, entry: evidence(1) })).toEqual("986442f245b72db5d6b782a661cae61b8652c8f3141946eb2be6241e6099db6c");
    expect(delegationJournalDigest({ sequence: 1, journalId: H('a'), acceptedAt: T(1), previousDigest: null, entry: evidence(1) })).toEqual("de2cb7f0b45f668db7ac2b89f842e6c8bbd4aeadb2478ba7e737f946d9a95932");
    expect(delegationJournalDigest({ sequence: 2, journalId: H('a'), acceptedAt: T(1), previousDigest: H('b'), entry: LEASE_SEEN })).toEqual("3d5f51fb61f0b16e52f594e4a78a4779a57430392ebec208dcebb9a7f90cad0c");
    expect(delegationLeaseIdentityKey({ project: 'project-a', adminRecord: 'wt-1', creationBase: null, canonicalPath: '/work/project-a/wt-1' })).toEqual("[\"project-a\",\"wt-1\",null,\"/work/project-a/wt-1\"]");
    expect(delegationLeaseIdentityKey({ project: 'project-a', adminRecord: 'wt-1', creationBase: 'main', canonicalPath: '/work/project-a/wt-1' })).toEqual("[\"project-a\",\"wt-1\",\"main\",\"/work/project-a/wt-1\"]");
  });
  it("a three-record chain from the append planner, one item skipped as a duplicate event (head null)", () => {
    expect(planDelegationJournalAppend({ head: null, eventIds: new Set<string>(), leases: NO_LEASES, items: [{ entry: evidence(1), acceptedAt: T(10) }, { entry: evidence(2), acceptedAt: T(11) }, { entry: evidence(1), acceptedAt: T(12) }, { entry: LEASE_CREATED, acceptedAt: T(13) }] }).records.map((r) => [r.sequence, r.journalId, r.previousDigest, r.digest])).toEqual([
      [
        1,
        "bc3cfdb503eb8f0cf10deb873baecf161787e7571cc90d49d43e8f328c3a3594",
        null,
        "24744d77e0e344724d8cc6b1efd06c5357574071064ce27aae14e003f00b9ee4"
      ],
      [
        2,
        "0d03754f5e16fd859158e4b3148c02b3033bf65ad414a648e912a1068ed9c85e",
        "24744d77e0e344724d8cc6b1efd06c5357574071064ce27aae14e003f00b9ee4",
        "e2f1dd4790633fbc3875c146520208df19c4f7fb4f9917fa009319ece8fd77da"
      ],
      [
        3,
        "e078f395017b1bcd3d17e189522731493a43b40230ac0a846ae87810719a608e",
        "e2f1dd4790633fbc3875c146520208df19c4f7fb4f9917fa009319ece8fd77da",
        "2417510bb9ab97975b1f18cef06fe3980e9cb21763637ac23019f5ecfb77bad9"
      ]
    ]);
    expect(planDelegationJournalAppend({ head: null, eventIds: new Set<string>(), leases: NO_LEASES, items: [{ entry: evidence(1), acceptedAt: T(10) }, { entry: evidence(2), acceptedAt: T(11) }, { entry: evidence(1), acceptedAt: T(12) }, { entry: LEASE_CREATED, acceptedAt: T(13) }] }).skipped).toEqual([{"index":2,"reason":"duplicate-event"}]);
  });
  it("the append planner from a head, skipping a known event id, a duplicate lease and a held path", () => {
    expect(planDelegationJournalAppend({ head: { sequence: 3, journalId: H('a'), digest: H('b') }, eventIds: new Set([H('1')]), leases: NO_LEASES, items: [{ entry: evidence(1), acceptedAt: T(10) }, { entry: evidence(4), acceptedAt: T(11) }, { entry: LEASE_SEEN, acceptedAt: T(12) }] }).records.map((r) => [r.sequence, r.journalId, r.previousDigest, r.digest])).toEqual([
      [
        4,
        "4cebcf52d10b24554ddfa55980363a73e048cef1c8b60b62efcb552c42301258",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "d93cf60aed1856db30b5e144a10a40fce7c2871f925415691b320690d468865d"
      ],
      [
        5,
        "edcd33352f0f02ba7b7b712d437c48712ba4022c84a03c3eddca69d21e3eae98",
        "d93cf60aed1856db30b5e144a10a40fce7c2871f925415691b320690d468865d",
        "d448ab740966731ab035a08acb2ac77075cbc74a7a847010a4bc1d924daa4623"
      ]
    ]);
    expect(planDelegationJournalAppend({ head: { sequence: 3, journalId: H('a'), digest: H('b') }, eventIds: new Set([H('1')]), leases: NO_LEASES, items: [{ entry: evidence(1), acceptedAt: T(10) }, { entry: evidence(4), acceptedAt: T(11) }, { entry: LEASE_SEEN, acceptedAt: T(12) }] }).skipped).toEqual([{"index":0,"reason":"duplicate-event"}]);
    expect(planDelegationJournalAppend({ head: null, eventIds: new Set<string>(), leases: { byIdentity: (k) => (k === '["project-a","wt-1",null,"/work/project-a/wt-1"]' ? 'lease-x' : undefined), byPath: (p) => (p === '/work/project-a/wt-2' ? 'lease-y' : undefined) }, items: [{ entry: { ...LEASE_CREATED, creationBase: null } as Entry, acceptedAt: T(10) }, { entry: { ...LEASE_CREATED, leaseId: 'lease-2', canonicalPath: '/work/project-a/wt-2' } as Entry, acceptedAt: T(11) }, { entry: { ...LEASE_CREATED, leaseId: 'lease-3', canonicalPath: '/work/project-a/wt-3' } as Entry, acceptedAt: T(12) }, { entry: { ...LEASE_CREATED, leaseId: 'lease-4', adminRecord: 'wt-4' } as Entry, acceptedAt: T(13) }, { entry: { ...LEASE_CREATED, leaseId: 'lease-5', canonicalPath: '/work/project-a/wt-3', adminRecord: 'wt-5' } as Entry, acceptedAt: T(14) }] }).skipped).toEqual([
      {
        "index": 0,
        "reason": "duplicate-lease",
        "leaseId": "lease-x"
      },
      {
        "index": 1,
        "reason": "lease-path-held",
        "leaseId": "lease-y"
      },
      {
        "index": 4,
        "reason": "lease-path-held",
        "leaseId": "lease-3"
      }
    ]);
  });
  it("the append planner refuses an invalid item and an empty plan is empty", () => {
    expectRefusal(() => planDelegationJournalAppend({ head: null, eventIds: new Set<string>(), leases: NO_LEASES, items: [{ entry: { kind: 'nope' } as unknown as Entry, acceptedAt: T(1) }] }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry kind \"nope\" is not in the closed grammar", undefined);
    expect(planDelegationJournalAppend({ head: null, eventIds: new Set<string>(), leases: NO_LEASES, items: [] })).toEqual({"records":[],"skipped":[]});
  });
});

describe("canonical JSON: encodings", () => {
  it("key order is by UTF-16 code units, not code points", () => {
    expect(canonicalDelegationJson({ '\uFF21': 1, '\u{1F600}': 2 })).toEqual("{\"\uD83D\uDE00\":2,\"\uFF21\":1}");
    expect(canonicalDelegationJson({ '\uE000': 1, '\u{1F600}': 2, b: 3, a: 4, '': 5 })).toEqual("{\"\":5,\"a\":4,\"b\":3,\"\uD83D\uDE00\":2,\"\uE000\":1}");
    expect(canonicalDelegationJson({ b: 1, a: 2, B: 3, aa: 4, '10': 5, '9': 6 })).toEqual("{\"10\":5,\"9\":6,\"B\":3,\"a\":2,\"aa\":4,\"b\":1}");
  });
  it("string escapes", () => {
    expect(canonicalDelegationJson('a"b\\c/d')).toEqual("\"a\\\"b\\\\c/d\"");
    expect(canonicalDelegationJson('\u0000\u0001\u0008\t\n\u000b\f\r\u001f\u007f')).toEqual("\"\\u0000\\u0001\\b\\t\\n\\u000b\\f\\r\\u001f\u007F\"");
    expect(canonicalDelegationJson('\u2028\u2029é€\u{1F600}')).toEqual("\"\u2028\u2029\u00E9\u20AC\uD83D\uDE00\"");
  });
  it("numbers", () => {
    expect(canonicalDelegationJson(-0)).toEqual("0");
    expect(canonicalDelegationJson(0)).toEqual("0");
    expect(canonicalDelegationJson(1e-7)).toEqual("1e-7");
    expect(canonicalDelegationJson(0.1)).toEqual("0.1");
    expect(canonicalDelegationJson(2 ** 53 - 1)).toEqual("9007199254740991");
    expect(canonicalDelegationJson(-(2 ** 53 - 1))).toEqual("-9007199254740991");
    expect(canonicalDelegationJson(4.35)).toEqual("4.35");
  });
  it("nested values", () => {
    expect(canonicalDelegationJson({ z: [1, { y: null, x: [true, false, []] }, 'q'], a: {}, m: { b: { d: 1, c: 2 } } })).toEqual("{\"a\":{},\"m\":{\"b\":{\"c\":2,\"d\":1}},\"z\":[1,{\"x\":[true,false,[]],\"y\":null},\"q\"]}");
    expect(canonicalDelegationJson(null)).toEqual("null");
    expect(canonicalDelegationJson([])).toEqual("[]");
    expect(canonicalDelegationJson({})).toEqual("{}");
    expect(canonicalDelegationJson(Object.assign(Object.create(null), { b: 1, a: 2 }))).toEqual("{\"a\":2,\"b\":1}");
  });
});

describe("canonical JSON: refused domain values", () => {
  it("numbers", () => {
    expectRefusal(() => canonicalDelegationJson(2 ** 53), DelegationJsonError, undefined, "delegation canonical JSON: $ is an integer outside the JavaScript safe range", undefined);
    expectRefusal(() => canonicalDelegationJson(1e21), DelegationJsonError, undefined, "delegation canonical JSON: $ is an integer outside the JavaScript safe range", undefined);
    expectRefusal(() => canonicalDelegationJson(123456789012345680000), DelegationJsonError, undefined, "delegation canonical JSON: $ is an integer outside the JavaScript safe range", undefined);
    expectRefusal(() => canonicalDelegationJson(1.5e300), DelegationJsonError, undefined, "delegation canonical JSON: $ is an integer outside the JavaScript safe range", undefined);
    expectRefusal(() => canonicalDelegationJson({ n: -(2 ** 53) }), DelegationJsonError, undefined, "delegation canonical JSON: $.n is an integer outside the JavaScript safe range", undefined);
    expectRefusal(() => canonicalDelegationJson([1, 1e300]), DelegationJsonError, undefined, "delegation canonical JSON: $[1] is an integer outside the JavaScript safe range", undefined);
    expectRefusal(() => canonicalDelegationJson(NaN), DelegationJsonError, undefined, "delegation canonical JSON: $ is not a finite number", undefined);
    expectRefusal(() => canonicalDelegationJson({ a: [Infinity] }), DelegationJsonError, undefined, "delegation canonical JSON: $.a[0] is not a finite number", undefined);
    expectRefusal(() => canonicalDelegationJson(-Infinity), DelegationJsonError, undefined, "delegation canonical JSON: $ is not a finite number", undefined);
  });
  it("a lone surrogate in a value and in a key", () => {
    expectRefusal(() => canonicalDelegationJson('\ud800'), DelegationJsonError, undefined, "delegation canonical JSON: $ holds a lone surrogate", undefined);
    expectRefusal(() => canonicalDelegationJson({ a: ['x', 'ok\udc00'] }), DelegationJsonError, undefined, "delegation canonical JSON: $.a[1] holds a lone surrogate", undefined);
    expectRefusal(() => canonicalDelegationJson({ '\ud83d': 1 }), DelegationJsonError, undefined, "delegation canonical JSON: $ key holds a lone surrogate", undefined);
    expectRefusal(() => canonicalDelegationJson({ outer: { '\udc00x': 1 } }), DelegationJsonError, undefined, "delegation canonical JSON: $.outer key holds a lone surrogate", undefined);
  });
  it("arrays", () => {
    expectRefusal(() => canonicalDelegationJson([1, , 2]), DelegationJsonError, undefined, "delegation canonical JSON: $ is a sparse array or has extra properties", undefined);
    expectRefusal(() => canonicalDelegationJson(Object.assign([1], { extra: 2 })), DelegationJsonError, undefined, "delegation canonical JSON: $ is a sparse array or has extra properties", undefined);
    expectRefusal(() => canonicalDelegationJson(Object.defineProperty([1], 0, { get: () => 1, enumerable: true })), DelegationJsonError, undefined, "delegation canonical JSON: $[0] is not a data element", undefined);
    expectRefusal(() => canonicalDelegationJson(Object.assign([1], { [Symbol('s')]: 1 })), DelegationJsonError, undefined, "delegation canonical JSON: $ has a symbol key", undefined);
    expectRefusal(() => canonicalDelegationJson(Object.setPrototypeOf([1], null)), DelegationJsonError, undefined, "delegation canonical JSON: $ is not a plain array", undefined);
  });
  it("values outside the JSON domain", () => {
    expectRefusal(() => canonicalDelegationJson(undefined), DelegationJsonError, undefined, "delegation canonical JSON: $ is undefined, which is outside the JSON domain", undefined);
    expectRefusal(() => canonicalDelegationJson({ a: undefined }), DelegationJsonError, undefined, "delegation canonical JSON: $.a is undefined, which is outside the JSON domain", undefined);
    expectRefusal(() => canonicalDelegationJson([undefined]), DelegationJsonError, undefined, "delegation canonical JSON: $[0] is undefined, which is outside the JSON domain", undefined);
    expectRefusal(() => canonicalDelegationJson(5n), DelegationJsonError, undefined, "delegation canonical JSON: $ is bigint, which is outside the JSON domain", undefined);
    expectRefusal(() => canonicalDelegationJson(Symbol('s')), DelegationJsonError, undefined, "delegation canonical JSON: $ is symbol, which is outside the JSON domain", undefined);
    expectRefusal(() => canonicalDelegationJson(() => 1), DelegationJsonError, undefined, "delegation canonical JSON: $ is function, which is outside the JSON domain", undefined);
  });
  it("objects that are not plain", () => {
    expectRefusal(() => canonicalDelegationJson(new Plain()), DelegationJsonError, undefined, "delegation canonical JSON: $ is not a plain object", undefined);
    expectRefusal(() => canonicalDelegationJson({ a: { b: new Plain() } }), DelegationJsonError, undefined, "delegation canonical JSON: $.a.b is not a plain object", undefined);
    expectRefusal(() => canonicalDelegationJson(new Date(0)), DelegationJsonError, undefined, "delegation canonical JSON: $ is not a plain object", undefined);
    expectRefusal(() => canonicalDelegationJson(new Map()), DelegationJsonError, undefined, "delegation canonical JSON: $ is not a plain object", undefined);
    expectRefusal(() => canonicalDelegationJson({ [Symbol('s')]: 1 }), DelegationJsonError, undefined, "delegation canonical JSON: $ has a symbol key", undefined);
    expectRefusal(() => canonicalDelegationJson({ get a() { return 1; } }), DelegationJsonError, undefined, "delegation canonical JSON: $.a is not an enumerable data property", undefined);
    expectRefusal(() => canonicalDelegationJson(Object.defineProperty({}, 'hidden', { value: 1, enumerable: false })), DelegationJsonError, undefined, "delegation canonical JSON: $.hidden is not an enumerable data property", undefined);
  });
  it("cycles", () => {
    expectRefusal(() => (() => { const o: Record<string, unknown> = {}; o['self'] = o; return canonicalDelegationJson(o); })(), DelegationJsonError, undefined, "delegation canonical JSON: $.self is a cycle", undefined);
    expectRefusal(() => (() => { const a: unknown[] = []; a.push({ k: a }); return canonicalDelegationJson(a); })(), DelegationJsonError, undefined, "delegation canonical JSON: $[0].k is a cycle", undefined);
    expect((() => { const shared = { s: 1 }; return canonicalDelegationJson({ a: shared, b: shared }); })()).toEqual("{\"a\":{\"s\":1},\"b\":{\"s\":1}}");
  });
});

describe("hashing, hex and instants", () => {
  it("delegationSha256Hex", () => {
    expect(delegationSha256Hex('abc')).toEqual("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(delegationSha256Hex('')).toEqual("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(delegationSha256Hex('é\u{1F600}')).toEqual("1184d1f608158eea09d297565575892231550c403aaa913008d867a97cfd5c76");
    expectRefusal(() => delegationSha256Hex('\ud800'), DelegationJsonError, undefined, "delegation canonical JSON: the hashed text holds a lone surrogate", undefined);
    expectRefusal(() => delegationSha256Hex('ok\udc00'), DelegationJsonError, undefined, "delegation canonical JSON: the hashed text holds a lone surrogate", undefined);
  });
  it("isLowerHex64", () => {
    expect(isLowerHex64('0123456789abcdef'.repeat(4))).toEqual(true);
    expect(isLowerHex64('0123456789ABCDEF'.repeat(4))).toEqual(false);
    expect(isLowerHex64('a'.repeat(63))).toEqual(false);
    expect(isLowerHex64('a'.repeat(65))).toEqual(false);
    expect(isLowerHex64('g'.repeat(64))).toEqual(false);
    expect(isLowerHex64(5)).toEqual(false);
    expect(isLowerHex64(null)).toEqual(false);
    expect(isLowerHex64(undefined)).toEqual(false);
    expect(isLowerHex64('a'.repeat(64) + '\n')).toEqual(false);
  });
  it("parseDelegationInstant accepts a canonical instant", () => {
    expect(parseDelegationInstant('2026-10-14T00:15:00.000Z')).toEqual(1791936900000);
    expect(parseDelegationInstant('1970-01-01T00:00:00.000Z')).toEqual(0);
    expect(parseDelegationInstant('2026-10-14T00:15:00.123Z')).toEqual(1791936900123);
    expect(parseDelegationInstant('9999-12-31T23:59:59.999Z')).toEqual(253402300799999);
    expect(parseDelegationInstant('2024-02-29T12:00:00.000Z')).toEqual(1709208000000);
  });
  it("parseDelegationInstant refuses", () => {
    expectRefusal(() => parseDelegationInstant('2026-10-14T00:15:00Z'), DelegationModelError, "bad-instant", "bad-instant: \"2026-10-14T00:15:00Z\" is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => parseDelegationInstant('2026-10-14T00:15:00.000+00:00'), DelegationModelError, "bad-instant", "bad-instant: \"2026-10-14T00:15:00.000+00:00\" is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => parseDelegationInstant('2026-10-14T00:15:00.000'), DelegationModelError, "bad-instant", "bad-instant: \"2026-10-14T00:15:00.000\" is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => parseDelegationInstant('2026-02-30T00:00:00.000Z'), DelegationModelError, "bad-instant", "bad-instant: 2026-02-30T00:00:00.000Z is not an instant a table can hold", undefined);
    expectRefusal(() => parseDelegationInstant('2026-10-14T24:00:00.000Z'), DelegationModelError, "bad-instant", "bad-instant: 2026-10-14T24:00:00.000Z is not an instant a table can hold", undefined);
    expectRefusal(() => parseDelegationInstant('1969-12-31T23:59:59.999Z'), DelegationModelError, "bad-instant", "bad-instant: 1969-12-31T23:59:59.999Z is not an instant a table can hold", undefined);
    expectRefusal(() => parseDelegationInstant('0000-01-01T00:00:00.000Z'), DelegationModelError, "bad-instant", "bad-instant: 0000-01-01T00:00:00.000Z is not an instant a table can hold", undefined);
    expectRefusal(() => parseDelegationInstant(' 2026-10-14T00:15:00.000Z'), DelegationModelError, "bad-instant", "bad-instant: \" 2026-10-14T00:15:00.000Z\" is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => parseDelegationInstant(5 as unknown as string), DelegationModelError, "bad-instant", "bad-instant: 5 is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => parseDelegationInstant(undefined as unknown as string), DelegationModelError, "bad-instant", "bad-instant: undefined is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => parseDelegationInstant(null as unknown as string), DelegationModelError, "bad-instant", "bad-instant: null is not a canonical UTC millisecond instant", undefined);
  });
});

describe("decodeDelegationJournalLine: every refusal site", () => {
  it("a canonical line decodes (control)", () => {
    expect(decodeDelegationJournalLine(U8(LINE1), { line: 7 })).toEqual({
      "v": 1,
      "sequence": 1,
      "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
      "acceptedAt": "2026-10-14T00:16:41.000Z",
      "previousDigest": null,
      "entry": {
        "kind": "evidence-accepted",
        "event": {
          "bucket": "2026101400",
          "claudeSessionId": "11111111-2222-3333-4444-555555555555",
          "endOffset": 199,
          "eventId": "1111111111111111111111111111111111111111111111111111111111111111",
          "eventKind": "SessionStart",
          "observedAt": "2026-10-14T00:00:01.000Z",
          "parentIncarnation": "g1",
          "sessionId": "lane-a-project-a",
          "source": "startup",
          "startOffset": 100,
          "v": 1
        }
      },
      "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
    });
  });
  it("bom (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(cat(Uint8Array.of(0xef, 0xbb, 0xbf), U8(LINE1)), { line: 7 }), DelegationJournalError, "bom", "delegation journal bom: a byte-order mark (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(Uint8Array.of(0xef, 0xbb, 0xbf), { line: 7 }), DelegationJournalError, "bom", "delegation journal bom: a byte-order mark (line 7)", {"line":7});
  });
  it("blank-line (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(new Uint8Array(0), { line: 7 }), DelegationJournalError, "blank-line", "delegation journal blank-line: an empty line (line 7)", {"line":7});
  });
  it("crlf (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(LINE1 + '\r'), { line: 7 }), DelegationJournalError, "crlf", "delegation journal crlf: a line ends in CR before its LF (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(Uint8Array.of(0x0d), { line: 7 }), DelegationJournalError, "crlf", "delegation journal crlf: a line ends in CR before its LF (line 7)", {"line":7});
  });
  it("invalid-utf8 (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(Uint8Array.of(0xff, 0xfe), { line: 7 }), DelegationJournalError, "invalid-utf8", "delegation journal invalid-utf8: the line is not valid UTF-8 (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(cat(U8('{"a":"'), Uint8Array.of(0xc3), U8('"}')), { line: 7 }), DelegationJournalError, "invalid-utf8", "delegation journal invalid-utf8: the line is not valid UTF-8 (line 7)", {"line":7});
  });
  it("malformed-json (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8('{'), { line: 7 }), DelegationJournalError, "malformed-json", "delegation journal malformed-json: the line is not JSON (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(LINE1 + ' x'), { line: 7 }), DelegationJournalError, "malformed-json", "delegation journal malformed-json: the line is not JSON (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8('not json'), { line: 7 }), DelegationJournalError, "malformed-json", "delegation journal malformed-json: the line is not JSON (line 7)", {"line":7});
  });
  it("not an object (bad-field, with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8('[1]'), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: the line is not a JSON object (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8('null'), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: the line is not a JSON object (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8('"s"'), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: the line is not a JSON object (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8('5'), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: the line is not a JSON object (line 7)", {"line":7});
  });
  it("record keys: unknown and missing (exactKeys, no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.extra = 1; })), { line: 7 }), DelegationJournalError, "unknown-key", "delegation journal unknown-key: a record has the unknown key \"extra\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { delete o.digest; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: a record is missing \"digest\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8('{}'), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: a record is missing \"v\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { delete o.entry; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: a record is missing \"entry\"", undefined);
  });
  it("v is not 1 (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.v = 2; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: v is not 1 (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.v = '1'; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: v is not 1 (line 7)", {"line":7});
  });
  it("sequence-domain (no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.sequence = 0; })), { line: 7 }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 0 is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.sequence = 1.5; })), { line: 7 }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 1.5 is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.sequence = '1'; })), { line: 7 }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 1 is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.sequence = -3; })), { line: 7 }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: -3 is not a positive safe integer", undefined);
  });
  it("acceptedAt (bad-field, no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.acceptedAt = '2026-10-14'; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: acceptedAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.acceptedAt = 5; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: acceptedAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.acceptedAt = '2026-02-30T00:00:00.000Z'; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: acceptedAt is not a canonical UTC millisecond instant", undefined);
  });
  it("previousDigest (bad-field, with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.previousDigest = 'ABC'; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: previousDigest is neither null nor a lowercase 64-hex SHA-256 (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.previousDigest = 5; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: previousDigest is neither null nor a lowercase 64-hex SHA-256 (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.previousDigest = 'A'.repeat(64); })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: previousDigest is neither null nor a lowercase 64-hex SHA-256 (line 7)", {"line":7});
  });
  it("journalId and digest not 64-hex (no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.journalId = 'A'.repeat(64); })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: journalId is not a lowercase 64-hex SHA-256", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.journalId = 'a'.repeat(63); })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: journalId is not a lowercase 64-hex SHA-256", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.digest = 'A'.repeat(64); })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: digest is not a lowercase 64-hex SHA-256", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.digest = null; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: digest is not a lowercase 64-hex SHA-256", undefined);
  });
  it("entry: not an object, kind outside the grammar (no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.entry = 5; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry is not an object", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.entry = null; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry is not an object", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.entry = []; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry is not an object", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.entry = { kind: 'nope' }; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry kind \"nope\" is not in the closed grammar", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.entry = {}; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry kind undefined is not in the closed grammar", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.entry = { kind: 5 }; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry kind 5 is not in the closed grammar", undefined);
  });
  it("evidence-accepted entry (no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.extra = 1; }), { line: 7 }), DelegationJournalError, "unknown-key", "delegation journal unknown-key: an evidence-accepted entry has the unknown key \"extra\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { delete e.event; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry is missing \"event\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.event = 5; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry's event is not an envelope with the keys the journal reads", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.event.eventId = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry's event is not an envelope with the keys the journal reads", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.event.eventKind = 'Nope'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry's event is not an envelope with the keys the journal reads", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.event.v = 2; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry's event is not an envelope with the keys the journal reads", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.event.endOffset = e.event.startOffset; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry's event is not an envelope with the keys the journal reads", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.event.startOffset = -1; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry's event is not an envelope with the keys the journal reads", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.event.observedAt = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry's event is not an envelope with the keys the journal reads", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(evidence(1), (e) => { e.event.agentId = 5; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: an evidence-accepted entry's event is not an envelope with the keys the journal reads", undefined);
  });
  it("lease-created entry (no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.generation = 1; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: a lease-created entry is generation 0: the first carrier generation is a later wave's", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.sourceKind = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: sourceKind is not a lease source kind", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.correlationJournalIds = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: correlationJournalIds is not a list", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.correlationJournalIds = ['ABC']; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: correlationJournalIds is not a list of lowercase 64-hex SHA-256 values", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.creationBase = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: creationBase is neither null nor a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.creationBase = 5; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: creationBase is neither null nor a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.firstObservedAt = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: firstObservedAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.leaseId = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: leaseId is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.activityId = 'A'.repeat(64); }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: activityId is not a lowercase 64-hex SHA-256", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.lineageId = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: lineageId is not a lowercase 64-hex SHA-256", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.parentId = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: parentId is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.parentIncarnation = 5; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: parentIncarnation is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.project = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: project is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.adminRecord = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: adminRecord is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.canonicalPath = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: canonicalPath is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { delete e.project; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: a lease-created entry is missing \"project\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_CREATED, (e) => { e.extra = 1; }), { line: 7 }), DelegationJournalError, "unknown-key", "delegation journal unknown-key: a lease-created entry has the unknown key \"extra\"", undefined);
  });
  it("lease-transition entry (no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.reason = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: reason is not one of carrier, adopt, retain, operator-retain, attach, transfer, transfer-refused, transfer-recovered, promote", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.to = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: to is not one of ephemeral, adopted, retained, promoted, transferring, released", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.at = 5; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: at is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.expiresAt = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: expiresAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.terminalEvidenceAt = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: terminalEvidenceAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.runId = 0; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: runId is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.promotedSession = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: promotedSession is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.auditEvidence = 5; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: auditEvidence is neither null nor a string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.lineageClose = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: lineageClose is not one of native-removed, transferred, foreign, transfer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.lineageOpenRun = 0; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: lineageOpenRun is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.resolvesThrough = 5; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: resolvesThrough is neither null nor an object", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.resolvesThrough.attemptId = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: resolvesThrough.attemptId is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.resolvesThrough.attemptedAt = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: resolvesThrough.attemptedAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.resolvesThrough.extra = 1; }), { line: 7 }), DelegationJournalError, "unknown-key", "delegation journal unknown-key: resolvesThrough has the unknown key \"extra\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { delete e.resolvesThrough.attemptId; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: resolvesThrough is missing \"attemptId\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.generation = 0; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: generation is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { delete e.runId; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: a lease-transition entry is missing \"runId\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_TRANSITION, (e) => { e.leaseId = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: leaseId is not a non-empty string", undefined);
  });
  it("lease-released and lease-carrier-seen entries (no where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_RELEASED, (e) => { e.releaseReason = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: releaseReason is not one of native-removed, transferred, foreign", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_RELEASED, (e) => { e.lastHeadSha = ''; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: lastHeadSha is not a non-empty string", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_RELEASED, (e) => { e.at = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: at is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_RELEASED, (e) => { e.generation = 0; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: generation is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_RELEASED, (e) => { e.extra = 1; }), { line: 7 }), DelegationJournalError, "unknown-key", "delegation journal unknown-key: a lease-released entry has the unknown key \"extra\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_SEEN, (e) => { e.extra = 1; }), { line: 7 }), DelegationJournalError, "unknown-key", "delegation journal unknown-key: a lease-carrier-seen entry has the unknown key \"extra\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_SEEN, (e) => { e.generation = 'x'; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: generation is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_SEEN, (e) => { delete e.at; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: a lease-carrier-seen entry is missing \"at\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(badEntry(LEASE_SEEN, (e) => { e.leaseId = 5; }), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: leaseId is not a non-empty string", undefined);
  });
  it("invalid-domain (with where; the message carries the model's prefix)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(rec(1, evidence(1, { note: 'x' })), (o) => { o.entry.event.note = '\ud800'; })), { line: 7 }), DelegationJournalError, "invalid-domain", "delegation journal invalid-domain: delegation canonical JSON: $.entry.event.note holds a lone surrogate (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(rec(1, evidence(1, { note: 'x' })), (o) => { o.entry.event.note = 2 ** 60; })), { line: 7 }), DelegationJournalError, "invalid-domain", "delegation journal invalid-domain: delegation canonical JSON: $.entry.event.note is an integer outside the JavaScript safe range (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(rec(1, evidence(1, { note: 'x' })), (o) => { o.entry.event.nested = { '\udc00': 1 }; })), { line: 7 }), DelegationJournalError, "invalid-domain", "delegation journal invalid-domain: delegation canonical JSON: $.entry.event.nested key holds a lone surrogate (line 7)", {"line":7});
  });
  it("duplicate-key (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(replaceLast(LINE1, '"v":1', '"v":1,"v":1')), { line: 7 }), DelegationJournalError, "duplicate-key", "delegation journal duplicate-key: an object repeats a key (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(replaceLast(LINE1, '"v":1', '"v":2,"v":1')), { line: 7 }), DelegationJournalError, "duplicate-key", "delegation journal duplicate-key: an object repeats a key (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(LINE1.replace('"entry":{', '"entry":{"kind":"evidence-accepted",')), { line: 7 }), DelegationJournalError, "duplicate-key", "delegation journal duplicate-key: an object repeats a key (line 7)", {"line":7});
  });
  it("noncanonical (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(uncanonical(LINE1)), { line: 7 }), DelegationJournalError, "noncanonical", "delegation journal noncanonical: the line is not the canonical encoding of its own value (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(LINE1.replace('{"', '{ "')), { line: 7 }), DelegationJournalError, "noncanonical", "delegation journal noncanonical: the line is not the canonical encoding of its own value (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(LINE1.replace('"v":1', '"v":1.0')), { line: 7 }), DelegationJournalError, "noncanonical", "delegation journal noncanonical: the line is not the canonical encoding of its own value (line 7)", {"line":7});
  });
  it("journal-id-mismatch and digest-mismatch (with where)", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(canonicalDelegationJson({ ...R1, journalId: H('e') })), { line: 7 }), DelegationJournalError, "journal-id-mismatch", "delegation journal journal-id-mismatch: journalId is not SHA-256 of its preimage (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(canonicalDelegationJson({ ...R1, digest: H('e') })), { line: 7 }), DelegationJournalError, "digest-mismatch", "delegation journal digest-mismatch: digest is not SHA-256 of its preimage (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(canonicalDelegationJson({ ...R1, acceptedAt: T(99) })), { line: 7 }), DelegationJournalError, "journal-id-mismatch", "delegation journal journal-id-mismatch: journalId is not SHA-256 of its preimage (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(canonicalDelegationJson({ ...R1, previousDigest: H('e') })), { line: 7 }), DelegationJournalError, "journal-id-mismatch", "delegation journal journal-id-mismatch: journalId is not SHA-256 of its preimage (line 7)", {"line":7});
  });
});

describe("buildDelegationJournalRecord and encodeDelegationJournalRecord: refusals", () => {
  it("sequence-domain, acceptedAt, previousDigest (no where)", () => {
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 0, acceptedAt: T(1), previousDigest: null, entry: evidence(1) }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 0 is not a positive safe integer", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 2 ** 53, acceptedAt: T(1), previousDigest: null, entry: evidence(1) }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 9007199254740992 is not a positive safe integer", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1.5, acceptedAt: T(1), previousDigest: null, entry: evidence(1) }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 1.5 is not a positive safe integer", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: '2026-10-14', previousDigest: null, entry: evidence(1) }), DelegationJournalError, "bad-field", "delegation journal bad-field: acceptedAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: 5 as unknown as string, previousDigest: null, entry: evidence(1) }), DelegationJournalError, "bad-field", "delegation journal bad-field: acceptedAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: T(1), previousDigest: 'ABC', entry: evidence(1) }), DelegationJournalError, "bad-field", "delegation journal bad-field: previousDigest is neither null nor a lowercase 64-hex SHA-256", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: T(1), previousDigest: 'A'.repeat(64), entry: evidence(1) }), DelegationJournalError, "bad-field", "delegation journal bad-field: previousDigest is neither null nor a lowercase 64-hex SHA-256", undefined);
  });
  it("an invalid entry (no where)", () => {
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: T(1), previousDigest: null, entry: { kind: 'nope' } as unknown as Entry }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry kind \"nope\" is not in the closed grammar", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: T(1), previousDigest: null, entry: { ...LEASE_CREATED, generation: 1 } as unknown as Entry }), DelegationJournalError, "bad-field", "delegation journal bad-field: a lease-created entry is generation 0: the first carrier generation is a later wave's", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: T(1), previousDigest: null, entry: 5 as unknown as Entry }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry is not an object", undefined);
  });
  it("a DelegationJsonError escapes unmapped", () => {
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: T(1), previousDigest: null, entry: evidence(1, { n: 2 ** 60 }) }), DelegationJsonError, undefined, "delegation canonical JSON: $.entry.event.n is an integer outside the JavaScript safe range", undefined);
    expectRefusal(() => buildDelegationJournalRecord({ sequence: 1, acceptedAt: T(1), previousDigest: null, entry: evidence(1, { s: '\ud800' }) }), DelegationJsonError, undefined, "delegation canonical JSON: $.entry.event.s holds a lone surrogate", undefined);
    expectRefusal(() => encodeDelegationJournalRecord({ ...R1, sequence: NaN }), DelegationJsonError, undefined, "delegation canonical JSON: $.sequence is not a finite number", undefined);
    expectRefusal(() => encodeDelegationJournalRecord({ ...R1, entry: evidence(1, { s: '\ud800' }) }), DelegationJsonError, undefined, "delegation canonical JSON: $.entry.event.s holds a lone surrogate", undefined);
  });
});

describe("DelegationJournalChain: every refusal (no where)", () => {
  it("refusals", () => {
    expectRefusal(() => new DelegationJournalChain().accept({ ...R1, sequence: 0 }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 0 is not a positive safe integer", undefined);
    expectRefusal(() => new DelegationJournalChain({ completeFromStart: true }).accept(R2), DelegationJournalError, "sequence-start", "delegation journal sequence-start: a complete journal begins at sequence 1, not 2", undefined);
    expectRefusal(() => new DelegationJournalChain({ completeFromStart: true }).accept({ ...R1, previousDigest: H('a') }), DelegationJournalError, "previous-digest", "delegation journal previous-digest: the first record of a complete journal has previousDigest null", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R1); c.accept(R1); })(), DelegationJournalError, "sequence-duplicate", "delegation journal sequence-duplicate: sequence 1 appears twice", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R2); c.accept(R1); })(), DelegationJournalError, "sequence-descent", "delegation journal sequence-descent: sequence 1 follows 2", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R1); c.accept(R3); })(), DelegationJournalError, "sequence-gap", "delegation journal sequence-gap: sequence 3 follows 1", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R1); c.accept({ ...R2, previousDigest: H('a') }); })(), DelegationJournalError, "previous-digest", "delegation journal previous-digest: record 2's previousDigest is not record 1's digest", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R1); c.accept({ ...R2, previousDigest: null }); })(), DelegationJournalError, "previous-digest", "delegation journal previous-digest: record 2's previousDigest is not record 1's digest", undefined);
    expectRefusal(() => new DelegationJournalChain({ anchor: { sequence: 1, journalId: H('a'), digest: R1.digest } }).accept(R1), DelegationJournalError, "anchor-journal-id", "delegation journal anchor-journal-id: the record at sequence 1 has another journalId", undefined);
    expectRefusal(() => new DelegationJournalChain({ anchor: { sequence: 1, journalId: R1.journalId, digest: H('a') } }).accept(R1), DelegationJournalError, "anchor-digest", "delegation journal anchor-digest: the record at sequence 1 has another digest", undefined);
    expectRefusal(() => new DelegationJournalChain({ anchor: { sequence: 5, journalId: R1.journalId, digest: R1.digest } }).accept(R1), DelegationJournalError, "anchor-sequence", "delegation journal anchor-sequence: the anchor's journalId is at sequence 1, not 5", undefined);
    expectRefusal(() => new DelegationJournalChain({ anchor: { sequence: 1, journalId: R1.journalId, digest: R1.digest } }).finish(), DelegationJournalError, "anchor-missing", "delegation journal anchor-missing: no retained record at the anchor's sequence 1", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain({ anchor: { sequence: 9, journalId: H('a'), digest: H('b') } }); c.accept(R1); c.accept(R2); c.finish(); })(), DelegationJournalError, "anchor-missing", "delegation journal anchor-missing: no retained record at the anchor's sequence 9", undefined);
  });
});

describe("torn tails: delegationTornTailError", () => {
  it("missing-final-lf for a complete record, torn-tail for a fragment, where passed through", () => {
    expectRefusal(() => thrown(delegationTornTailError(U8(LINE1), { line: 4 })), DelegationJournalError, "missing-final-lf", "delegation journal missing-final-lf: the last record has no LF after it (line 4)", {"line":4});
    expectRefusal(() => thrown(delegationTornTailError(U8(LINE1))), DelegationJournalError, "missing-final-lf", "delegation journal missing-final-lf: the last record has no LF after it", undefined);
    expectRefusal(() => thrown(delegationTornTailError(U8(LINE1.slice(0, 40)), { line: 4 })), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 40 bytes follow the last LF and are not a complete record (line 4)", {"line":4});
    expectRefusal(() => thrown(delegationTornTailError(U8('{"a"'), { line: 9, offset: 12 })), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 4 bytes follow the last LF and are not a complete record (line 9)", {"line":9,"offset":12});
    expectRefusal(() => thrown(delegationTornTailError(U8(uncanonical(LINE1)), { line: 2 })), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 622 bytes follow the last LF and are not a complete record (line 2)", {"line":2});
    expectRefusal(() => thrown(delegationTornTailError(new Uint8Array(0))), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 0 bytes follow the last LF and are not a complete record", undefined);
    expectRefusal(() => thrown(delegationTornTailError(U8(LINE1 + '\r'), { line: 2 })), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 623 bytes follow the last LF and are not a complete record (line 2)", {"line":2});
  });
});

describe("validateDelegationJournalBytes and parseDelegationJournal", () => {
  it("a sound journal: coverage and records", () => {
    expect(validateDelegationJournalBytes(JOURNAL3)).toEqual({
      "firstSequence": 1,
      "lastSequence": 3,
      "recordCount": 3,
      "firstPreviousDigest": null,
      "copiedEof": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      }
    });
    expect(validateDelegationJournalBytes(JOURNAL3, { completeFromStart: true })).toEqual({
      "firstSequence": 1,
      "lastSequence": 3,
      "recordCount": 3,
      "firstPreviousDigest": null,
      "copiedEof": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      }
    });
    expect(validateDelegationJournalBytes(new Uint8Array(0))).toEqual({
      "firstSequence": null,
      "lastSequence": null,
      "recordCount": 0,
      "firstPreviousDigest": null,
      "copiedEof": null
    });
    expect(validateDelegationJournalBytes(bytesOf([S5, S6]))).toEqual({
      "firstSequence": 5,
      "lastSequence": 6,
      "recordCount": 2,
      "firstPreviousDigest": "9999999999999999999999999999999999999999999999999999999999999999",
      "copiedEof": {
        "sequence": 6,
        "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
        "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
      }
    });
    expect(validateDelegationJournalBytes(JOURNAL3, { anchor: { sequence: 2, journalId: R2.journalId, digest: R2.digest }, heldJournalIds: [R1.journalId, R3.journalId] })).toEqual({
      "firstSequence": 1,
      "lastSequence": 3,
      "recordCount": 3,
      "firstPreviousDigest": null,
      "copiedEof": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      }
    });
    expect(parseDelegationJournal(JOURNAL3).map((r) => r.journalId)).toEqual([
      "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
      "4df998ba102beb5c37a55d9adb39325eb527de76aefd058282377b51a5682725",
      "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1"
    ]);
    expect(parseDelegationJournal(new Uint8Array(0))).toEqual([]);
  });
  it("a decode refusal on line 2 carries { line: 2 }", () => {
    expectRefusal(() => validateDelegationJournalBytes(cat(encodeDelegationJournalRecord(R1), U8('garbage\n'), encodeDelegationJournalRecord(R3))), DelegationJournalError, "malformed-json", "delegation journal malformed-json: the line is not JSON (line 2)", {"line":2});
    expectRefusal(() => parseDelegationJournal(cat(encodeDelegationJournalRecord(R1), U8('garbage\n'), encodeDelegationJournalRecord(R3))), DelegationJournalError, "malformed-json", "delegation journal malformed-json: the line is not JSON (line 2)", {"line":2});
    expectRefusal(() => validateDelegationJournalBytes(cat(encodeDelegationJournalRecord(R1), U8(uncanonical(lineOf(R2)) + '\n'))), DelegationJournalError, "noncanonical", "delegation journal noncanonical: the line is not the canonical encoding of its own value (line 2)", {"line":2});
  });
  it("a torn tail carries { line: lineCount + 1 }", () => {
    expectRefusal(() => validateDelegationJournalBytes(cat(JOURNAL3, U8('{"ab'))), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 4 bytes follow the last LF and are not a complete record (line 4)", {"line":4});
    expectRefusal(() => parseDelegationJournal(cat(JOURNAL3, U8('{"ab'))), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 4 bytes follow the last LF and are not a complete record (line 4)", {"line":4});
    expectRefusal(() => validateDelegationJournalBytes(cat(JOURNAL3, U8(lineOf(rec(4, evidence(4), R3.digest))))), DelegationJournalError, "missing-final-lf", "delegation journal missing-final-lf: the last record has no LF after it (line 4)", {"line":4});
    expectRefusal(() => parseDelegationJournal(cat(JOURNAL3, U8(lineOf(rec(4, evidence(4), R3.digest))))), DelegationJournalError, "missing-final-lf", "delegation journal missing-final-lf: the last record has no LF after it (line 4)", {"line":4});
    expectRefusal(() => validateDelegationJournalBytes(U8('{"ab')), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 4 bytes follow the last LF and are not a complete record (line 1)", {"line":1});
    expectRefusal(() => parseDelegationJournal(U8('{"ab')), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 4 bytes follow the last LF and are not a complete record (line 1)", {"line":1});
  });
  it("a chain refusal inside a journal carries no where", () => {
    expectRefusal(() => validateDelegationJournalBytes(bytesOf([R1, R3])), DelegationJournalError, "sequence-gap", "delegation journal sequence-gap: sequence 3 follows 1", undefined);
    expectRefusal(() => parseDelegationJournal(bytesOf([R1, R3])), DelegationJournalError, "sequence-gap", "delegation journal sequence-gap: sequence 3 follows 1", undefined);
    expectRefusal(() => validateDelegationJournalBytes(bytesOf([R2, R3]), { completeFromStart: true }), DelegationJournalError, "sequence-start", "delegation journal sequence-start: a complete journal begins at sequence 1, not 2", undefined);
    expectRefusal(() => parseDelegationJournal(bytesOf([R2, R3]), { completeFromStart: true }), DelegationJournalError, "sequence-start", "delegation journal sequence-start: a complete journal begins at sequence 1, not 2", undefined);
  });
  it("held-evidence-missing (validate only, no where)", () => {
    expectRefusal(() => validateDelegationJournalBytes(JOURNAL3, { heldJournalIds: [H('f'), H('9')] }), DelegationJournalError, "held-evidence-missing", "delegation journal held-evidence-missing: 2 held journal ID(s) are not retained, first ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", undefined);
    expectRefusal(() => validateDelegationJournalBytes(JOURNAL3, { heldJournalIds: [R1.journalId, H('9'), H('f')] }), DelegationJournalError, "held-evidence-missing", "delegation journal held-evidence-missing: 2 held journal ID(s) are not retained, first 9999999999999999999999999999999999999999999999999999999999999999", undefined);
    expectRefusal(() => validateDelegationJournalBytes(JOURNAL3, { heldJournalIds: [H('9'), H('9')] }), DelegationJournalError, "held-evidence-missing", "delegation journal held-evidence-missing: 1 held journal ID(s) are not retained, first 9999999999999999999999999999999999999999999999999999999999999999", undefined);
    expect(parseDelegationJournal(JOURNAL3, { heldJournalIds: [H('f')] } as DelegationJournalChainOptions).length).toEqual(3);
  });
  it("anchors in a whole journal", () => {
    expectRefusal(() => validateDelegationJournalBytes(JOURNAL3, { anchor: { sequence: 9, journalId: H('a'), digest: H('b') } }), DelegationJournalError, "anchor-missing", "delegation journal anchor-missing: no retained record at the anchor's sequence 9", undefined);
    expectRefusal(() => parseDelegationJournal(JOURNAL3, { anchor: { sequence: 9, journalId: H('a'), digest: H('b') } }), DelegationJournalError, "anchor-missing", "delegation journal anchor-missing: no retained record at the anchor's sequence 9", undefined);
    expectRefusal(() => validateDelegationJournalBytes(JOURNAL3, { anchor: { sequence: 2, journalId: R2.journalId, digest: H('b') } }), DelegationJournalError, "anchor-digest", "delegation journal anchor-digest: the record at sequence 2 has another digest", undefined);
  });
});

describe("order rows: a line or journal with two defects reports the first", () => {
  it("a BOM and a CR on one line: bom wins", () => {
    expectRefusal(() => decodeDelegationJournalLine(cat(Uint8Array.of(0xef, 0xbb, 0xbf), U8(LINE1 + '\r')), { line: 7 }), DelegationJournalError, "bom", "delegation journal bom: a byte-order mark (line 7)", {"line":7});
  });
  it("a blank line is checked before a CR (empty has no CR); a CR before invalid UTF-8", () => {
    expectRefusal(() => decodeDelegationJournalLine(cat(Uint8Array.of(0xff), U8('\r')), { line: 7 }), DelegationJournalError, "crlf", "delegation journal crlf: a line ends in CR before its LF (line 7)", {"line":7});
  });
  it("invalid UTF-8 before malformed JSON", () => {
    expectRefusal(() => decodeDelegationJournalLine(cat(U8('{'), Uint8Array.of(0xff)), { line: 7 }), DelegationJournalError, "invalid-utf8", "delegation journal invalid-utf8: the line is not valid UTF-8 (line 7)", {"line":7});
  });
  it("a repeated key that also makes the text noncanonical: duplicate-key wins", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(uncanonical(replaceLast(LINE1, '"v":1', '"v":1,"v":1'))), { line: 7 }), DelegationJournalError, "noncanonical", "delegation journal noncanonical: the line is not the canonical encoding of its own value (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(replaceLast(LINE1, '"v":1', '"v":1, "v":1')), { line: 7 }), DelegationJournalError, "duplicate-key", "delegation journal duplicate-key: an object repeats a key (line 7)", {"line":7});
  });
  it("a bad journalId together with a bad digest: journalId wins", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.journalId = 'A'.repeat(64); o.digest = 'B'.repeat(64); })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: journalId is not a lowercase 64-hex SHA-256", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(canonicalDelegationJson({ ...R1, journalId: H('e'), digest: H('f') })), { line: 7 }), DelegationJournalError, "journal-id-mismatch", "delegation journal journal-id-mismatch: journalId is not SHA-256 of its preimage (line 7)", {"line":7});
  });
  it("a bad record key before a bad field value; a bad sequence before a bad acceptedAt before a bad previousDigest", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.extra = 1; o.v = 2; })), { line: 7 }), DelegationJournalError, "unknown-key", "delegation journal unknown-key: a record has the unknown key \"extra\"", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.v = 2; o.sequence = 0; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: v is not 1 (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.sequence = 0; o.acceptedAt = 'x'; })), { line: 7 }), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 0 is not a positive safe integer", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.acceptedAt = 'x'; o.previousDigest = 'x'; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: acceptedAt is not a canonical UTC millisecond instant", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.previousDigest = 'x'; o.journalId = 'x'; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: previousDigest is neither null nor a lowercase 64-hex SHA-256 (line 7)", {"line":7});
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(R1, (o) => { o.digest = 'x'; o.entry = 5; })), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: digest is not a lowercase 64-hex SHA-256", undefined);
  });
  it("a bad entry together with a noncanonical text: the entry wins; a lone surrogate together with a bad hash: invalid-domain wins", () => {
    expectRefusal(() => decodeDelegationJournalLine(U8(uncanonical(tweak(R1, (o) => { o.entry = 5; }))), { line: 7 }), DelegationJournalError, "bad-field", "delegation journal bad-field: entry is not an object", undefined);
    expectRefusal(() => decodeDelegationJournalLine(U8(tweak(rec(1, evidence(1, { note: 'x' })), (o) => { o.entry.event.note = '\ud800'; o.journalId = H('e'); })), { line: 7 }), DelegationJournalError, "invalid-domain", "delegation journal invalid-domain: delegation canonical JSON: $.entry.event.note holds a lone surrogate (line 7)", {"line":7});
  });
  it("a torn tail and an anchor no record satisfies: torn-tail wins", () => {
    expectRefusal(() => validateDelegationJournalBytes(cat(JOURNAL3, U8('{"ab')), { anchor: { sequence: 9, journalId: H('a'), digest: H('b') } }), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 4 bytes follow the last LF and are not a complete record (line 4)", {"line":4});
    expectRefusal(() => parseDelegationJournal(cat(JOURNAL3, U8('{"ab')), { anchor: { sequence: 9, journalId: H('a'), digest: H('b') } }), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 4 bytes follow the last LF and are not a complete record (line 4)", {"line":4});
    expectRefusal(() => validateDelegationJournalBytes(cat(JOURNAL3, U8('{"ab')), { heldJournalIds: [H('f')] }), DelegationJournalError, "torn-tail", "delegation journal torn-tail: 4 bytes follow the last LF and are not a complete record (line 4)", {"line":4});
  });
  it("an unsatisfied anchor and a held ID not retained: anchor-missing wins, then held-evidence-missing", () => {
    expectRefusal(() => validateDelegationJournalBytes(JOURNAL3, { anchor: { sequence: 9, journalId: H('a'), digest: H('b') }, heldJournalIds: [H('f')] }), DelegationJournalError, "anchor-missing", "delegation journal anchor-missing: no retained record at the anchor's sequence 9", undefined);
    expectRefusal(() => validateDelegationJournalBytes(JOURNAL3, { anchor: { sequence: 3, journalId: R3.journalId, digest: R3.digest }, heldJournalIds: [H('f')] }), DelegationJournalError, "held-evidence-missing", "delegation journal held-evidence-missing: 1 held journal ID(s) are not retained, first ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", undefined);
  });
  it("a decode refusal before a chain refusal before a torn tail", () => {
    expectRefusal(() => validateDelegationJournalBytes(cat(encodeDelegationJournalRecord(R1), encodeDelegationJournalRecord(R3), U8('{"ab'))), DelegationJournalError, "sequence-gap", "delegation journal sequence-gap: sequence 3 follows 1", undefined);
    expectRefusal(() => validateDelegationJournalBytes(cat(encodeDelegationJournalRecord(R1), U8('garbage\n'), U8('{"ab'))), DelegationJournalError, "malformed-json", "delegation journal malformed-json: the line is not JSON (line 2)", {"line":2});
  });
  it("chain order: sequence-start before previous-digest; duplicate before descent before gap before previous-digest; sequence-domain first", () => {
    expectRefusal(() => new DelegationJournalChain({ completeFromStart: true }).accept({ ...R2, previousDigest: H('a') }), DelegationJournalError, "sequence-start", "delegation journal sequence-start: a complete journal begins at sequence 1, not 2", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R2); c.accept({ ...R2, previousDigest: H('a') }); })(), DelegationJournalError, "sequence-duplicate", "delegation journal sequence-duplicate: sequence 2 appears twice", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R3); c.accept({ ...R1, previousDigest: H('a') }); })(), DelegationJournalError, "sequence-descent", "delegation journal sequence-descent: sequence 1 follows 3", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R1); c.accept({ ...R3, previousDigest: H('a') }); })(), DelegationJournalError, "sequence-gap", "delegation journal sequence-gap: sequence 3 follows 1", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain(); c.accept(R1); c.accept({ ...R2, sequence: 1.5 }); })(), DelegationJournalError, "sequence-domain", "delegation journal sequence-domain: 1.5 is not a positive safe integer", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain({ anchor: { sequence: 2, journalId: H('a'), digest: H('b') } }); c.accept(R1); c.accept({ ...R2, previousDigest: H('c') }); })(), DelegationJournalError, "previous-digest", "delegation journal previous-digest: record 2's previousDigest is not record 1's digest", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain({ anchor: { sequence: 2, journalId: H('a'), digest: H('b') } }); c.accept(R1); c.accept(R2); })(), DelegationJournalError, "anchor-journal-id", "delegation journal anchor-journal-id: the record at sequence 2 has another journalId", undefined);
    expectRefusal(() => (() => { const c = new DelegationJournalChain({ anchor: { sequence: 2, journalId: R2.journalId, digest: H('b') } }); c.accept(R1); c.accept(R2); })(), DelegationJournalError, "anchor-digest", "delegation journal anchor-digest: the record at sequence 2 has another digest", undefined);
    expectRefusal(() => new DelegationJournalChain({ anchor: { sequence: 1, journalId: R1.journalId, digest: H('b') } }).accept(R1), DelegationJournalError, "anchor-digest", "delegation journal anchor-digest: the record at sequence 1 has another digest", undefined);
  });
});

describe("the chain: verdict table", () => {
  it("sequences against completeFromStart and an anchor", () => {
    expect(chainSnap({}, [R1, R2, R3])).toEqual({
      "head": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      },
      "recordCount": 3,
      "firstRecord": {
        "sequence": 1,
        "previousDigest": null
      },
      "anchorWasSeen": false,
      "finish": {
        "firstSequence": 1,
        "lastSequence": 3,
        "recordCount": 3,
        "firstPreviousDigest": null,
        "copiedEof": {
          "sequence": 3,
          "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
          "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
        }
      }
    });
    expect(chainSnap({ completeFromStart: true }, [R1, R2, R3])).toEqual({
      "head": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      },
      "recordCount": 3,
      "firstRecord": {
        "sequence": 1,
        "previousDigest": null
      },
      "anchorWasSeen": false,
      "finish": {
        "firstSequence": 1,
        "lastSequence": 3,
        "recordCount": 3,
        "firstPreviousDigest": null,
        "copiedEof": {
          "sequence": 3,
          "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
          "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
        }
      }
    });
    expect(chainSnap({}, [])).toEqual({
      "head": null,
      "recordCount": 0,
      "firstRecord": null,
      "anchorWasSeen": false,
      "finish": {
        "firstSequence": null,
        "lastSequence": null,
        "recordCount": 0,
        "firstPreviousDigest": null,
        "copiedEof": null
      }
    });
    expect(chainSnap({ completeFromStart: true }, [])).toEqual({
      "head": null,
      "recordCount": 0,
      "firstRecord": null,
      "anchorWasSeen": false,
      "finish": {
        "firstSequence": null,
        "lastSequence": null,
        "recordCount": 0,
        "firstPreviousDigest": null,
        "copiedEof": null
      }
    });
    expect(chainSnap({}, [R1])).toEqual({
      "head": {
        "sequence": 1,
        "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
        "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
      },
      "recordCount": 1,
      "firstRecord": {
        "sequence": 1,
        "previousDigest": null
      },
      "anchorWasSeen": false,
      "finish": {
        "firstSequence": 1,
        "lastSequence": 1,
        "recordCount": 1,
        "firstPreviousDigest": null,
        "copiedEof": {
          "sequence": 1,
          "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
          "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
        }
      }
    });
    expect(chainSnap({}, [S5, S6])).toEqual({
      "head": {
        "sequence": 6,
        "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
        "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
      },
      "recordCount": 2,
      "firstRecord": {
        "sequence": 5,
        "previousDigest": "9999999999999999999999999999999999999999999999999999999999999999"
      },
      "anchorWasSeen": false,
      "finish": {
        "firstSequence": 5,
        "lastSequence": 6,
        "recordCount": 2,
        "firstPreviousDigest": "9999999999999999999999999999999999999999999999999999999999999999",
        "copiedEof": {
          "sequence": 6,
          "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
          "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
        }
      }
    });
    expect(chainSnap({ completeFromStart: false }, [S5, S6])).toEqual({
      "head": {
        "sequence": 6,
        "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
        "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
      },
      "recordCount": 2,
      "firstRecord": {
        "sequence": 5,
        "previousDigest": "9999999999999999999999999999999999999999999999999999999999999999"
      },
      "anchorWasSeen": false,
      "finish": {
        "firstSequence": 5,
        "lastSequence": 6,
        "recordCount": 2,
        "firstPreviousDigest": "9999999999999999999999999999999999999999999999999999999999999999",
        "copiedEof": {
          "sequence": 6,
          "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
          "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
        }
      }
    });
    expect(chainSnap({ completeFromStart: true }, [S5, S6])).toEqual({
      "acceptRefused": {
        "code": "sequence-start",
        "message": "delegation journal sequence-start: a complete journal begins at sequence 1, not 5",
        "where": "none"
      },
      "recordCount": 0,
      "head": null
    });
    expect(chainSnap({ anchor: { sequence: 2, journalId: R2.journalId, digest: R2.digest } }, [R1, R2, R3])).toEqual({
      "head": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      },
      "recordCount": 3,
      "firstRecord": {
        "sequence": 1,
        "previousDigest": null
      },
      "anchorWasSeen": true,
      "finish": {
        "firstSequence": 1,
        "lastSequence": 3,
        "recordCount": 3,
        "firstPreviousDigest": null,
        "copiedEof": {
          "sequence": 3,
          "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
          "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
        }
      }
    });
    expect(chainSnap({ anchor: { sequence: 3, journalId: R3.journalId, digest: R3.digest }, completeFromStart: true }, [R1, R2, R3])).toEqual({
      "head": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      },
      "recordCount": 3,
      "firstRecord": {
        "sequence": 1,
        "previousDigest": null
      },
      "anchorWasSeen": true,
      "finish": {
        "firstSequence": 1,
        "lastSequence": 3,
        "recordCount": 3,
        "firstPreviousDigest": null,
        "copiedEof": {
          "sequence": 3,
          "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
          "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
        }
      }
    });
    expect(chainSnap({ anchor: { sequence: 1, journalId: R1.journalId, digest: R1.digest } }, [R1])).toEqual({
      "head": {
        "sequence": 1,
        "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
        "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
      },
      "recordCount": 1,
      "firstRecord": {
        "sequence": 1,
        "previousDigest": null
      },
      "anchorWasSeen": true,
      "finish": {
        "firstSequence": 1,
        "lastSequence": 1,
        "recordCount": 1,
        "firstPreviousDigest": null,
        "copiedEof": {
          "sequence": 1,
          "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
          "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
        }
      }
    });
    expect(chainSnap({ anchor: { sequence: 2, journalId: R2.journalId, digest: R2.digest } }, [R1])).toEqual({
      "head": {
        "sequence": 1,
        "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
        "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
      },
      "recordCount": 1,
      "firstRecord": {
        "sequence": 1,
        "previousDigest": null
      },
      "anchorWasSeen": false,
      "finishRefused": {
        "code": "anchor-missing",
        "message": "delegation journal anchor-missing: no retained record at the anchor's sequence 2",
        "where": "none"
      }
    });
    expect(chainSnap({ anchor: { sequence: 2, journalId: R2.journalId, digest: R2.digest } }, [])).toEqual({
      "head": null,
      "recordCount": 0,
      "firstRecord": null,
      "anchorWasSeen": false,
      "finishRefused": {
        "code": "anchor-missing",
        "message": "delegation journal anchor-missing: no retained record at the anchor's sequence 2",
        "where": "none"
      }
    });
    expect(chainSnap({ anchor: { sequence: 2, journalId: R2.journalId, digest: R2.digest } }, [R3, R3])).toEqual({
      "acceptRefused": {
        "code": "sequence-duplicate",
        "message": "delegation journal sequence-duplicate: sequence 3 appears twice",
        "where": "none"
      },
      "recordCount": 1,
      "head": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      }
    });
    expect(chainSnap({ anchor: { sequence: 5, journalId: S5.journalId, digest: S5.digest } }, [S5, S6])).toEqual({
      "head": {
        "sequence": 6,
        "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
        "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
      },
      "recordCount": 2,
      "firstRecord": {
        "sequence": 5,
        "previousDigest": "9999999999999999999999999999999999999999999999999999999999999999"
      },
      "anchorWasSeen": true,
      "finish": {
        "firstSequence": 5,
        "lastSequence": 6,
        "recordCount": 2,
        "firstPreviousDigest": "9999999999999999999999999999999999999999999999999999999999999999",
        "copiedEof": {
          "sequence": 6,
          "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
          "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
        }
      }
    });
    expect(chainSnap({ anchor: { sequence: 6, journalId: S6.journalId, digest: S6.digest } }, [S5, S6])).toEqual({
      "head": {
        "sequence": 6,
        "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
        "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
      },
      "recordCount": 2,
      "firstRecord": {
        "sequence": 5,
        "previousDigest": "9999999999999999999999999999999999999999999999999999999999999999"
      },
      "anchorWasSeen": true,
      "finish": {
        "firstSequence": 5,
        "lastSequence": 6,
        "recordCount": 2,
        "firstPreviousDigest": "9999999999999999999999999999999999999999999999999999999999999999",
        "copiedEof": {
          "sequence": 6,
          "journalId": "5d475fe87b54dd794aa2972dbdf7b19116917d42b5e1a3d6e9a43d8612a6216e",
          "digest": "8e603dbbfa3fd21f9cd604f99605788e6ff7f9641678359f65391f4a29ae8d19"
        }
      }
    });
    expect(chainSnap({ anchor: { sequence: 4, journalId: S5.journalId, digest: S5.digest } }, [S5, S6])).toEqual({
      "acceptRefused": {
        "code": "anchor-sequence",
        "message": "delegation journal anchor-sequence: the anchor's journalId is at sequence 5, not 4",
        "where": "none"
      },
      "recordCount": 0,
      "head": null
    });
    expect(chainSnap({ anchor: null }, [R1, R2])).toEqual({
      "head": {
        "sequence": 2,
        "journalId": "4df998ba102beb5c37a55d9adb39325eb527de76aefd058282377b51a5682725",
        "digest": "4ad044894efe261770346059e93d0739b46475ae652b2c5dcae5a935c7dd7230"
      },
      "recordCount": 2,
      "firstRecord": {
        "sequence": 1,
        "previousDigest": null
      },
      "anchorWasSeen": false,
      "finish": {
        "firstSequence": 1,
        "lastSequence": 2,
        "recordCount": 2,
        "firstPreviousDigest": null,
        "copiedEof": {
          "sequence": 2,
          "journalId": "4df998ba102beb5c37a55d9adb39325eb527de76aefd058282377b51a5682725",
          "digest": "4ad044894efe261770346059e93d0739b46475ae652b2c5dcae5a935c7dd7230"
        }
      }
    });
    expect(chainSnap({ completeFromStart: true }, [R1, R1])).toEqual({
      "acceptRefused": {
        "code": "sequence-duplicate",
        "message": "delegation journal sequence-duplicate: sequence 1 appears twice",
        "where": "none"
      },
      "recordCount": 1,
      "head": {
        "sequence": 1,
        "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
        "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
      }
    });
    expect(chainSnap({ completeFromStart: true }, [R1, R3])).toEqual({
      "acceptRefused": {
        "code": "sequence-gap",
        "message": "delegation journal sequence-gap: sequence 3 follows 1",
        "where": "none"
      },
      "recordCount": 1,
      "head": {
        "sequence": 1,
        "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
        "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
      }
    });
    expect(chainSnap({}, [R3, R2])).toEqual({
      "acceptRefused": {
        "code": "sequence-descent",
        "message": "delegation journal sequence-descent: sequence 2 follows 3",
        "where": "none"
      },
      "recordCount": 1,
      "head": {
        "sequence": 3,
        "journalId": "3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1",
        "digest": "bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a"
      }
    });
    expect(chainSnap({ anchor: { sequence: 1, journalId: R1.journalId, digest: R1.digest } }, [R1, { ...R2, journalId: R1.journalId }])).toEqual({
      "acceptRefused": {
        "code": "anchor-sequence",
        "message": "delegation journal anchor-sequence: the anchor's journalId is at sequence 2, not 1",
        "where": "none"
      },
      "recordCount": 1,
      "head": {
        "sequence": 1,
        "journalId": "c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502",
        "digest": "ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9"
      }
    });
  });
});

describe("the tail: delegationTailHealPlan", () => {
  it("null, unsound prefix, and each code", () => {
    expect(delegationTailHealPlan(null, true)).toEqual(null);
    expect(delegationTailHealPlan(null, false)).toEqual(null);
    expect(delegationTailHealPlan({ offset: 123, bytes: U8('{"ab'), sha256: H('c'), code: 'torn-tail' }, false)).toEqual(null);
    expect(delegationTailHealPlan({ offset: 123, bytes: U8('{"ab'), sha256: H('c'), code: 'torn-tail' }, true)).toEqual({
      "offset": 123,
      "bytes": 4,
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "code": "torn-tail",
      "name": "123-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.tail"
    });
    expect(delegationTailHealPlan({ offset: 456, bytes: U8(LINE1), sha256: H('d'), code: 'missing-final-lf' }, true)).toEqual({
      "offset": 456,
      "bytes": 622,
      "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "code": "missing-final-lf",
      "name": "456-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.tail"
    });
    expect(delegationTailHealPlan({ offset: 0, bytes: new Uint8Array(0), sha256: H('e'), code: 'torn-tail' }, true)).toEqual({
      "offset": 0,
      "bytes": 0,
      "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "code": "torn-tail",
      "name": "0-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.tail"
    });
  });
});

describe("findDelegationJsonDefect", () => {
  it("the duplicate-key scanner", () => {
    expect(findDelegationJsonDefect('{"a":1,"a":2}')).toEqual("duplicate-key");
    expect(findDelegationJsonDefect('{"a":{"b":1,"b":2}}')).toEqual("duplicate-key");
    expect(findDelegationJsonDefect('[{"a":1},{"a":2}]')).toEqual(null);
    expect(findDelegationJsonDefect('{"a":1,"b":[1,2,{"c":null}]}')).toEqual(null);
    expect(findDelegationJsonDefect('{')).toEqual("malformed-json");
    expect(findDelegationJsonDefect('{"a":1} x')).toEqual("malformed-json");
    expect(findDelegationJsonDefect('{"a":1,"a":2}')).toEqual("duplicate-key");
    expect(findDelegationJsonDefect('')).toEqual("malformed-json");
    expect(findDelegationJsonDefect('[' .repeat(70))).toEqual("malformed-json");
    expect(findDelegationJsonDefect(LINE1)).toEqual(null);
  });
});

describe('the splitter', () => {
  const expected = {
    "lines": [
      "{\"acceptedAt\":\"2026-10-14T00:16:41.000Z\",\"digest\":\"ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9\",\"entry\":{\"event\":{\"bucket\":\"2026101400\",\"claudeSessionId\":\"11111111-2222-3333-4444-555555555555\",\"endOffset\":199,\"eventId\":\"1111111111111111111111111111111111111111111111111111111111111111\",\"eventKind\":\"SessionStart\",\"observedAt\":\"2026-10-14T00:00:01.000Z\",\"parentIncarnation\":\"g1\",\"sessionId\":\"lane-a-project-a\",\"source\":\"startup\",\"startOffset\":100,\"v\":1},\"kind\":\"evidence-accepted\"},\"journalId\":\"c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502\",\"previousDigest\":null,\"sequence\":1,\"v\":1}",
      "{\"acceptedAt\":\"2026-10-14T00:16:42.000Z\",\"digest\":\"4ad044894efe261770346059e93d0739b46475ae652b2c5dcae5a935c7dd7230\",\"entry\":{\"event\":{\"bucket\":\"2026101400\",\"claudeSessionId\":\"11111111-2222-3333-4444-555555555555\",\"endOffset\":299,\"eventId\":\"2222222222222222222222222222222222222222222222222222222222222222\",\"eventKind\":\"SessionStart\",\"observedAt\":\"2026-10-14T00:00:02.000Z\",\"parentIncarnation\":\"g1\",\"sessionId\":\"lane-a-project-a\",\"source\":\"startup\",\"startOffset\":200,\"v\":1},\"kind\":\"evidence-accepted\"},\"journalId\":\"4df998ba102beb5c37a55d9adb39325eb527de76aefd058282377b51a5682725\",\"previousDigest\":\"ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9\",\"sequence\":2,\"v\":1}",
      "{\"acceptedAt\":\"2026-10-14T00:16:43.000Z\",\"digest\":\"bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a\",\"entry\":{\"event\":{\"bucket\":\"2026101400\",\"claudeSessionId\":\"11111111-2222-3333-4444-555555555555\",\"endOffset\":399,\"eventId\":\"3333333333333333333333333333333333333333333333333333333333333333\",\"eventKind\":\"SessionStart\",\"observedAt\":\"2026-10-14T00:00:03.000Z\",\"parentIncarnation\":\"g1\",\"sessionId\":\"lane-a-project-a\",\"source\":\"startup\",\"startOffset\":300,\"v\":1},\"kind\":\"evidence-accepted\"},\"journalId\":\"3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1\",\"previousDigest\":\"4ad044894efe261770346059e93d0739b46475ae652b2c5dcae5a935c7dd7230\",\"sequence\":3,\"v\":1}"
    ],
    "leftover": ""
  };
  const total = 1993;
  it('a three-record journal cut into two chunks at every byte offset gives the same lines and the same leftover', () => {
    expect(JOURNAL3.length).toBe(total);
    for (let k = 0; k <= JOURNAL3.length; k++) expect(splitAt(JOURNAL3, k)).toEqual(expected);
  });
  it('a trailing fragment stays the leftover at every offset', () => {
    const withFragment = cat(JOURNAL3, U8('{"ab'));
    const expectedFragment = {
      "lines": [
        "{\"acceptedAt\":\"2026-10-14T00:16:41.000Z\",\"digest\":\"ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9\",\"entry\":{\"event\":{\"bucket\":\"2026101400\",\"claudeSessionId\":\"11111111-2222-3333-4444-555555555555\",\"endOffset\":199,\"eventId\":\"1111111111111111111111111111111111111111111111111111111111111111\",\"eventKind\":\"SessionStart\",\"observedAt\":\"2026-10-14T00:00:01.000Z\",\"parentIncarnation\":\"g1\",\"sessionId\":\"lane-a-project-a\",\"source\":\"startup\",\"startOffset\":100,\"v\":1},\"kind\":\"evidence-accepted\"},\"journalId\":\"c418cb43189cc46e9a7388533bfc22fdc24360fe35ed2cc60a243ad30b812502\",\"previousDigest\":null,\"sequence\":1,\"v\":1}",
        "{\"acceptedAt\":\"2026-10-14T00:16:42.000Z\",\"digest\":\"4ad044894efe261770346059e93d0739b46475ae652b2c5dcae5a935c7dd7230\",\"entry\":{\"event\":{\"bucket\":\"2026101400\",\"claudeSessionId\":\"11111111-2222-3333-4444-555555555555\",\"endOffset\":299,\"eventId\":\"2222222222222222222222222222222222222222222222222222222222222222\",\"eventKind\":\"SessionStart\",\"observedAt\":\"2026-10-14T00:00:02.000Z\",\"parentIncarnation\":\"g1\",\"sessionId\":\"lane-a-project-a\",\"source\":\"startup\",\"startOffset\":200,\"v\":1},\"kind\":\"evidence-accepted\"},\"journalId\":\"4df998ba102beb5c37a55d9adb39325eb527de76aefd058282377b51a5682725\",\"previousDigest\":\"ee1346aa3225c55b96c9dd5dad3ea0136bc97ff3d4b242532b341310107f3bc9\",\"sequence\":2,\"v\":1}",
        "{\"acceptedAt\":\"2026-10-14T00:16:43.000Z\",\"digest\":\"bdae749b5e5bb75bfbefae5a61c14af086dc775fb2a4126b485c52374175724a\",\"entry\":{\"event\":{\"bucket\":\"2026101400\",\"claudeSessionId\":\"11111111-2222-3333-4444-555555555555\",\"endOffset\":399,\"eventId\":\"3333333333333333333333333333333333333333333333333333333333333333\",\"eventKind\":\"SessionStart\",\"observedAt\":\"2026-10-14T00:00:03.000Z\",\"parentIncarnation\":\"g1\",\"sessionId\":\"lane-a-project-a\",\"source\":\"startup\",\"startOffset\":300,\"v\":1},\"kind\":\"evidence-accepted\"},\"journalId\":\"3ffb3a94b12e5c16736383fca0b7ccbcd96926cc60b4efb46fe745b37b2539f1\",\"previousDigest\":\"4ad044894efe261770346059e93d0739b46475ae652b2c5dcae5a935c7dd7230\",\"sequence\":3,\"v\":1}"
      ],
      "leftover": "{\"ab"
    };
    for (let k = 0; k <= withFragment.length; k++) expect(splitAt(withFragment, k)).toEqual(expectedFragment);
  });
  it('empty lines and an empty stream', () => {
    expect(splitAt(U8('\n\nabc\n'), 3)).toEqual({"lines":["","","abc"],"leftover":""});
    expect(splitAt(new Uint8Array(0), 0)).toEqual({"lines":[],"leftover":""});
  });
});

describe('the words', () => {
  const CODES = [
    "anchor-digest",
    "anchor-journal-id",
    "anchor-missing",
    "anchor-sequence",
    "bad-field",
    "blank-line",
    "bom",
    "carried-order",
    "carried-past-applied",
    "carried-past-journal",
    "crlf",
    "digest-mismatch",
    "duplicate-key",
    "held-evidence-missing",
    "invalid-domain",
    "invalid-utf8",
    "journal-id-mismatch",
    "malformed-json",
    "missing-final-lf",
    "noncanonical",
    "previous-digest",
    "sequence-descent",
    "sequence-domain",
    "sequence-duplicate",
    "sequence-gap",
    "sequence-start",
    "short-copy",
    "short-write",
    "torn-tail",
    "unknown-key",
    "writer-unusable"
  ];
  it('DELEGATION_JOURNAL_ERROR_CODES is exactly these 31 words', () => {
    expect(Object.keys(DELEGATION_JOURNAL_ERROR_CODES).sort()).toEqual(CODES);
  });
  it('isDelegationJournalKebab is true for each code, each skip reason, each entry kind and bad-event', () => {
    for (const w of CODES) expect(isDelegationJournalKebab(w)).toBe(true);
    for (const w of ['duplicate-event', 'duplicate-lease', 'lease-path-held']) expect(isDelegationJournalKebab(w)).toBe(true);
    for (const w of ['evidence-accepted', 'lease-created', 'lease-transition', 'lease-released', 'lease-carrier-seen']) expect(isDelegationJournalKebab(w)).toBe(true);
    expect(isDelegationJournalKebab('bad-event')).toBe(true);
  });
  it('isDelegationJournalKebab is false for anything else, including inherited object keys', () => {
    for (const w of ['not-a-word', '', 'Bom', 'toString', '__proto__', 'constructor']) expect(isDelegationJournalKebab(w)).toBe(false);
  });
});
