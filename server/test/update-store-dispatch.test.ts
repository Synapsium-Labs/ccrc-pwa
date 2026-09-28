// Design 2026-09-20 §6/§10/§12 (programme wave 5 — spec W4's server half,
// Task 3) — the writers W2 named and left unwritten, and the refusal note:
//   requestNode         — the request group's SETTER (the apply/rollback routes, Task 6);
//   dispatchNode        — the lease group's ONE ACQUIRE (the dispatcher's act, Task 5);
//   noteDispatchRefusal — `updateDetail` on an idle row, once per change of text
//                         (D-3375).
// W2's update-store-nodes.test.ts PLANTED every busy row "for W4's dispatcher
// to reach"; here `dispatchNode` makes them for real, and only the rows the
// store must refuse (a state this wave never writes) are planted by raw SQL.
// "Writes nothing" is measured with SQLite's own `total_changes()` on the
// store's connection, never inferred from a re-read that could miss a column.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  UPDATE_STORE_REFUSE_CODES, isUpdateStoreRefuseCode, type RequestKind, type UpdateStoreRefuseCode,
} from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import {
  CoordStore, type DispatchNodeResult, type NodeMeasurement, type NoteDispatchRefusalResult, type RequestNodeResult,
} from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const UUID_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';   // the fleet box
const UUID_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';   // no row carries it
const UUID_S = '05050505-0505-4505-8505-050505050505';   // the server box

const fresh = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('update-store-dispatch-'), 'coord.db')));

/** A clean fleet-node measurement (W2 Task 5's fixture shape); each case overrides what it is about. */
const meas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: 'fleet', role: 'fleet', label: 'fleet',
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'detach', 'rollback'], agentOps: ['update'], highestVersion: 'v0.0.9',
  previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux', measuredAt: T0, report: null, ...over,
});

/** The two live nodes the fleet has: the fleet box (A, agent-reached) and the server box (S, no agent). */
const twoNodes = (): CoordStore => {
  const s = fresh();
  expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_A })).ok).toBe(true);
  expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null })).ok).toBe(true);
  return s;
};

/** A store whose label-keyed row `fleet` is superseded by UUID_A (W2's `rekeyNode` does it). */
const superseded = (): CoordStore => {
  const s = fresh();
  s.upsertNodeMeasurement(meas());
  s.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
  expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'superseded', retired: 0, revived: false });
  return s;
};

/** A lease state this wave never writes, planted — `state` is a raw string so a
 *  token outside `UpdateState` can be planted too. */
const plantState = (s: CoordStore, nodeId: string, state: string, detail = 'planted'): void => {
  s.db.prepare('UPDATE nodes SET updateState = ?, updateDetail = ? WHERE nodeId = ?').run(state, detail, nodeId);
};

/** Rows modified on the store's connection so far (SQLite's `total_changes()`). */
const writes = (s: CoordStore): number =>
  (s.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

/** Run one store call and assert it modified no row. */
const quiet = <T>(s: CoordStore, call: () => T, label = ''): T => {
  const before = writes(s);
  const out = call();
  expect(writes(s), `${label} wrote a row`).toBe(before);
  return out;
};

// The refusal words: every kebab `why` of the three results is an
// `UpdateStoreRefuseCode` (W2 ruling R5 — one vocabulary, appended to). The
// one-word arms (`superseded`, `busy`) are below the kebab scan's reach, as
// W2's own `superseded`/`busy`/`halted` are, and are not declared there.
// Held against the result types BOTH ways at compile time
// (`typecheck-tests.test.ts`), asserted below so the lines are read.
type Why = Extract<RequestNodeResult | DispatchNodeResult | NoteDispatchRefusalResult, { ok: false }>['why'];
const KEBAB_WHYS = ['unknown-node', 'bad-tag', 'bad-kind', 'no-request', 'not-idle'] as const satisfies readonly Why[];
const ONE_WORD_WHYS = ['superseded', 'busy'] as const satisfies readonly Why[];
const everyWhyListed: [Exclude<Why, (typeof KEBAB_WHYS)[number] | (typeof ONE_WORD_WHYS)[number]>] extends [never]
  ? true : never = true;
const everyKebabWhyDeclared: [Exclude<(typeof KEBAB_WHYS)[number], UpdateStoreRefuseCode>] extends [never]
  ? true : never = true;
// §18 "a refusing write never returns void": a writer whose return type is
// `void` makes its line `never`, and `= true` stops compiling.
const requestNeverVoid: [ReturnType<CoordStore['requestNode']>] extends [void] ? never : true = true;
const dispatchNeverVoid: [ReturnType<CoordStore['dispatchNode']>] extends [void] ? never : true = true;
const noteNeverVoid: [ReturnType<CoordStore['noteDispatchRefusal']>] extends [void] ? never : true = true;

describe("requestNode — the request group's setter (design 2026-09-20 §6, §12)", () => {
  it('writes the three request columns and nothing else, and says which request it overwrote (decision 7)', () => {
    const s = twoNodes();
    const before = s.node(UUID_A)!;
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0 + 5)).toEqual({ ok: true, replaced: null });
    expect(s.node(UUID_A)).toEqual({ ...before, requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0 + 5 });
    expect(s.requestNode(UUID_A, 'v0.0.8', 'rollback', T0 + 9))
      .toEqual({ ok: true, replaced: { tag: 'v0.0.10', kind: 'update' } });
    expect(s.node(UUID_A)).toEqual({ ...before, requestedTag: 'v0.0.8', requestedKind: 'rollback', requestedAt: T0 + 9 });
    expect(s.node(UUID_S)!.requestedTag).toBeNull();   // another node's request group is not this one's
  });

  it('reports a stored kind this build cannot name as null — never folded into a word it is not', () => {
    const s = twoNodes();
    s.db.prepare("UPDATE nodes SET requestedTag = 'v0.0.9', requestedKind = 'reinstall', requestedAt = ? WHERE nodeId = ?")
      .run(T0, UUID_A);
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0 + 1))
      .toEqual({ ok: true, replaced: { tag: 'v0.0.9', kind: null } });
    expect(s.node(UUID_A)).toMatchObject({ requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0 + 1 });
  });

  it('writes a request beside a held lease and leaves the lease exactly as it was — the WRITER does not refuse it (D-3406: the routes keep one there anyway)', () => {
    const s = twoNodes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'auto: v0.0.10')).toEqual({ ok: true });
    const leased = s.node(UUID_A)!;
    expect(s.requestNode(UUID_A, 'v0.0.11', 'update', T0 + 1)).toEqual({ ok: true, replaced: null });
    expect(s.node(UUID_A)).toEqual({ ...leased, requestedTag: 'v0.0.11', requestedKind: 'update', requestedAt: T0 + 1 });
  });

  it('refuses an unknown id, a superseded row, a non-tag and an unknown kind, writing nothing', () => {
    const s = superseded();
    expect(quiet(s, () => s.requestNode(UUID_B, 'v0.0.10', 'update', T0), 'unknown'))
      .toEqual({ ok: false, why: 'unknown-node' });
    expect(quiet(s, () => s.requestNode('fleet', 'v0.0.10', 'update', T0), 'superseded'))
      .toEqual({ ok: false, why: 'superseded', supersededBy: UUID_A });
    for (const tag of ['0.0.10', 'v0.0', 'v0.0.10\n', '', '; rm -rf ~']) {
      expect(quiet(s, () => s.requestNode(UUID_A, tag, 'update', T0), JSON.stringify(tag)), JSON.stringify(tag))
        .toEqual({ ok: false, why: 'bad-tag' });
    }
    for (const kind of ['sideways', '', 'UPDATE']) {
      expect(quiet(s, () => s.requestNode(UUID_A, 'v0.0.10', kind as RequestKind, T0), kind), kind)
        .toEqual({ ok: false, why: 'bad-kind' });
    }
    expect(s.node(UUID_A)).toMatchObject({ requestedTag: null, requestedKind: null, requestedAt: null });
  });

  it('an `at` that is not a non-negative integer throws before any SQL — SQLite would bind NaN as NULL', () => {
    const s = twoNodes();
    const before = writes(s);
    for (const at of [Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY]) {
      expect(() => s.requestNode(UUID_A, 'v0.0.10', 'update', at), String(at)).toThrow(RangeError);
    }
    expect(writes(s)).toBe(before);
  });
});

describe('dispatchNode — the ONE lease acquire (design 2026-09-20 §6, §10)', () => {
  it('acquires an idle row: pending, with the target, the start and the detail; the request columns unchanged', () => {
    const s = twoNodes();
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0).ok).toBe(true);
    const before = s.node(UUID_A)!;
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0 + 7, 'request: v0.0.10')).toEqual({ ok: true });
    expect(s.node(UUID_A)).toEqual({ ...before, updateState: 'pending', updateTarget: 'v0.0.10',
      updateStartedAt: T0 + 7, updateDetail: 'request: v0.0.10' });
  });

  it('acquires an update with no request standing — an auto-driven move has none (§9)', () => {
    const s = twoNodes();
    expect(s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0, 'auto: v0.0.10')).toEqual({ ok: true });
    expect(s.node(UUID_S)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10', requestedTag: null });
  });

  it('refuses a second node while the first holds the lease, naming the holder and writing nothing (§18 "one dispatch per sweep")', () => {
    const s = twoNodes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'a')).toEqual({ ok: true });
    const other = s.node(UUID_S)!;
    expect(quiet(s, () => s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0 + 1, 's'), 'second node'))
      .toEqual({ ok: false, why: 'busy', heldBy: UUID_A });
    expect(s.node(UUID_S)).toEqual(other);
    // The holder's own second acquire is busy too — held by itself — and its lease is untouched.
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.11', 'update', T0 + 2, 'again'), 'own row'))
      .toEqual({ ok: false, why: 'busy', heldBy: UUID_A });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T0,
      updateDetail: 'a' });
  });

  it('counts applying, unknown AND a token this build cannot name as a held lease (§18 "unknown is busy")', () => {
    for (const state of ['applying', 'unknown', 'paused']) {
      const s = twoNodes();
      plantState(s, UUID_S, state);
      expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'a'), state), state)
        .toEqual({ ok: false, why: 'busy', heldBy: UUID_S });
      expect(quiet(s, () => s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0, 's'), state), state)
        .toEqual({ ok: false, why: 'busy', heldBy: UUID_S });
      expect(s.node(UUID_A)!.updateState, state).toBe('idle');
    }
  });

  it("acquires a failed or a reverted row, and a failed row elsewhere blocks nothing — the halt is the planner's (Task 4)", () => {
    for (const state of ['failed', 'reverted'] as const) {
      const s = twoNodes();
      plantState(s, UUID_A, state);
      expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'x'), state).toEqual({ ok: true });
      expect(s.node(UUID_A)!.updateState, state).toBe('pending');
    }
    const s = twoNodes();
    plantState(s, UUID_S, 'failed', 'provenance: sigstore refused v0.0.10');
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'x')).toEqual({ ok: true });
  });

  it("a superseded row's stale busy lease blocks nothing — the NOT EXISTS reads live rows only (§8 \"a superseded row is invisible\")", () => {
    const s = superseded();
    plantState(s, 'fleet', 'applying');
    expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null })).ok).toBe(true);
    expect(s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0, 's')).toEqual({ ok: true });
  });

  it('acquires a rollback only for the rollback an operator requested (D-3376)', () => {
    const s = twoNodes();
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0, 'r'), 'no request'))
      .toEqual({ ok: false, why: 'no-request' });
    expect(s.requestNode(UUID_A, 'v0.0.8', 'update', T0).ok).toBe(true);        // an UPDATE request for that tag
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0, 'r'), 'update request'))
      .toEqual({ ok: false, why: 'no-request' });
    expect(s.requestNode(UUID_A, 'v0.0.7', 'rollback', T0).ok).toBe(true);      // a rollback to ANOTHER tag
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0, 'r'), 'other tag'))
      .toEqual({ ok: false, why: 'no-request' });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateTarget: null, updateDetail: null });
    expect(s.requestNode(UUID_A, 'v0.0.8', 'rollback', T0 + 1).ok).toBe(true);
    const before = s.node(UUID_A)!;
    expect(s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0 + 2, 'rollback: v0.0.8')).toEqual({ ok: true });
    expect(s.node(UUID_A)).toEqual({ ...before, updateState: 'pending', updateTarget: 'v0.0.8',
      updateStartedAt: T0 + 2, updateDetail: 'rollback: v0.0.8' });
  });

  it("a superseded row's stale busy lease is never the holder NAMED in a refusal either — a rollback with no " +
    'request over a live, settled row reads no-request, not busy (Task 3 review Minor, D-3406)', () => {
    const s = superseded();
    // 'fleet' is the retired row (superseded by UUID_A) and still carries a stale busy lease from before
    // it was superseded. UUID_A is live and settled and has NO rollback request — a real op would refuse it
    // `no-request`, and the retired row's stale lease must not be read as holding the fleet's one lease.
    plantState(s, 'fleet', 'pending', 'stale lease on the retired row');
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0, 'r'), 'superseded-busy'))
      .toEqual({ ok: false, why: 'no-request' });
  });

  it('refuses an unknown id, a superseded row, a non-tag and an unknown kind, writing nothing', () => {
    const s = superseded();
    expect(quiet(s, () => s.dispatchNode(UUID_B, 'v0.0.10', 'update', T0, 'x'), 'unknown'))
      .toEqual({ ok: false, why: 'unknown-node' });
    expect(quiet(s, () => s.dispatchNode('fleet', 'v0.0.10', 'update', T0, 'x'), 'superseded'))
      .toEqual({ ok: false, why: 'superseded', supersededBy: UUID_A });
    for (const tag of ['0.0.10', 'v0.0', 'v0.0.10 ', '', '; rm -rf ~']) {
      expect(quiet(s, () => s.dispatchNode(UUID_A, tag, 'update', T0, 'x'), JSON.stringify(tag)), JSON.stringify(tag))
        .toEqual({ ok: false, why: 'bad-tag' });
    }
    for (const kind of ['sideways', '', 'ROLLBACK']) {
      expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.10', kind as RequestKind, T0, 'x'), kind), kind)
        .toEqual({ ok: false, why: 'bad-kind' });
    }
    expect(s.node(UUID_A)!.updateState).toBe('idle');
  });

  it('a startedAt that is not a non-negative integer throws before any SQL', () => {
    const s = twoNodes();
    const before = writes(s);
    for (const at of [Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY]) {
      expect(() => s.dispatchNode(UUID_A, 'v0.0.10', 'update', at, 'x'), String(at)).toThrow(RangeError);
    }
    expect(writes(s)).toBe(before);
    expect(s.node(UUID_A)!.updateState).toBe('idle');
  });

  it('releaseLease after a real acquire leaves the request standing and frees the lease (§18 "a refusal does not consume the request")', () => {
    const s = twoNodes();
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0).ok).toBe(true);
    expect(s.requestNode(UUID_S, 'v0.0.10', 'update', T0).ok).toBe(true);
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0 + 1, 'request: v0.0.10')).toEqual({ ok: true });
    expect(s.releaseLease(UUID_A, 'idle', 'busy — update.json says installing', null)).toEqual({ ok: true, state: 'idle' });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateDetail: 'busy — update.json says installing',
      requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0 });
    expect(s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0 + 2, 'request: v0.0.10')).toEqual({ ok: true });
  });
});

describe('noteDispatchRefusal — a refusal written where the operator reads it (design §9, §10, §12)', () => {
  const REFUSAL = 'no-detach-cap — fleet cannot run a detached update (no detach cap)';

  it('writes updateDetail on an idle row and nothing else', () => {
    const s = twoNodes();
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0).ok).toBe(true);
    const before = s.node(UUID_A)!;
    expect(s.noteDispatchRefusal(UUID_A, REFUSAL)).toEqual({ ok: true, changed: true });
    expect(s.node(UUID_A)).toEqual({ ...before, updateDetail: REFUSAL });
  });

  it('the same text again is changed: false and writes nothing — a refusal re-planned every sweep is written once (Review Focus 5)', () => {
    const s = twoNodes();
    expect(s.noteDispatchRefusal(UUID_A, REFUSAL)).toEqual({ ok: true, changed: true });
    const noted = s.node(UUID_A)!;
    expect(quiet(s, () => s.noteDispatchRefusal(UUID_A, REFUSAL), 'repeat')).toEqual({ ok: true, changed: false });
    expect(s.node(UUID_A)).toEqual(noted);
    expect(s.noteDispatchRefusal(UUID_A, 'not-newer — v0.0.9 is not newer than v0.0.9')).toEqual({ ok: true, changed: true });
  });

  it('never writes a row that is not idle — a failed row\'s detail is the verdict the halt reads (Review Focus 5)', () => {
    const VERDICT = 'provenance: sigstore refused v0.0.10';
    for (const [stored, read] of [['failed', 'failed'], ['reverted', 'reverted'], ['applying', 'applying'],
      ['unknown', 'unknown'], ['paused', 'unknown']] as const) {
      const s = twoNodes();
      plantState(s, UUID_A, stored, VERDICT);
      expect(quiet(s, () => s.noteDispatchRefusal(UUID_A, REFUSAL), stored), stored)
        .toEqual({ ok: false, why: 'not-idle', state: read });
      expect(s.node(UUID_A)!.updateDetail, stored).toBe(VERDICT);
    }
    const s = twoNodes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'request: v0.0.10')).toEqual({ ok: true });
    expect(quiet(s, () => s.noteDispatchRefusal(UUID_A, REFUSAL), 'pending'))
      .toEqual({ ok: false, why: 'not-idle', state: 'pending' });
    expect(s.node(UUID_A)!.updateDetail).toBe('request: v0.0.10');
  });

  it('refuses an unknown id and a superseded row, writing nothing', () => {
    const s = superseded();
    expect(quiet(s, () => s.noteDispatchRefusal(UUID_B, REFUSAL), 'unknown')).toEqual({ ok: false, why: 'unknown-node' });
    expect(quiet(s, () => s.noteDispatchRefusal('fleet', REFUSAL), 'superseded'))
      .toEqual({ ok: false, why: 'superseded', supersededBy: UUID_A });
  });
});

describe('the refusal words (W2 ruling R5)', () => {
  it('every kebab refusal word is declared, once, in the ONE update-store vocabulary; no writer returns void', () => {
    expect([everyWhyListed, everyKebabWhyDeclared, requestNeverVoid, dispatchNeverVoid, noteNeverVoid])
      .toEqual([true, true, true, true, true]);
    for (const w of KEBAB_WHYS) expect(isUpdateStoreRefuseCode(w), w).toBe(true);
    expect(new Set(UPDATE_STORE_REFUSE_CODES).size, 'a word is declared twice').toBe(UPDATE_STORE_REFUSE_CODES.length);
  });
});
