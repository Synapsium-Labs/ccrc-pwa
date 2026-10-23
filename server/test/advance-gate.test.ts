// D-TBD-arch33-advance-gate (audit ticket ARCH-33, GitHub #550): `POST /api/runs/:id/advance`'s ordered gates,
// decided by one pure L1 decider, `coord/advance.ts`'s `advanceGate`, with `advanceRequest` ahead of it.
//
// THE GATE-ORDER TABLE. Every gate has a row that trips it alone, and every adjacent pair of gates that one input
// can trip together has a row that trips BOTH and names the earlier one as the answer. Swapping any such pair in
// `ADVANCE_GATES` turns its row red: that is the recorded reorder mutant per pair (the PR body's mutation table).
// Pairs no single input can trip together are listed in `EXCLUSIVE_PAIRS` with the reason and bridged to the next
// gate they can meet. Nothing here asserts the order list itself — a swap must be caught by what the decider
// ANSWERS, not by a copy of its spelling. The wire over the same order is `advance-gate-order-route.test.ts`.
import { describe, it, expect } from 'vitest';
import { parsedFile } from './scan/symbols.js';
import {
  ADVANCE_GATES, ADVANCE_TARGETS, advanceGate, advanceRequest,
  type AdvanceGate, type AdvanceGateFacts, type AdvanceRefusal, type AdvanceRunFacts,
} from '../src/coord/advance.js';

const run = (over: Partial<AdvanceRunFacts> = {}): AdvanceRunFacts =>
  ({ kind: 'work', state: 'working', sessionId: 'ws-1', ...over });

/** Facts that admit by default; every lookup is a counter, so laziness is observable. */
function facts(over: Partial<AdvanceGateFacts> & { to: AdvanceGateFacts['to'] }, r: AdvanceRunFacts | null = run()) {
  const calls = { read: 0, review: 0, caps: 0 };
  const f: AdvanceGateFacts = {
    read: () => { calls.read++; return { ok: true, run: r }; },
    reviewInFlight: () => { calls.review++; return null; },
    overConcurrency: () => { calls.caps++; return null; },
    ...over,
  };
  return { f, calls };
}
const FULL = { limit: 1, running: 1 };
const refused = (refusal: AdvanceRefusal) => ({ ok: false, refusal });

interface Row { name: string; gate: AdvanceGate; f: AdvanceGateFacts; refusal: AdvanceRefusal }
interface Pair extends Row { pair: [AdvanceGate, AdvanceGate] }

const SINGLE: Row[] = [
  { name: 'an unreadable store', gate: 'read', refusal: { error: 'run-unreadable', detail: 'db locked' },
    f: facts({ to: 'working', read: () => ({ ok: false, detail: 'db locked' }) }).f },
  { name: 'no such run', gate: 'read', refusal: { reject: { code: 'unknown-run' } }, f: facts({ to: 'working' }, null).f },
  { name: 'an edge the machine lacks', gate: 'edge', refusal: { reject: { code: 'bad-transition', from: 'planned', to: 'merging' } },
    f: facts({ to: 'merging' }, run({ state: 'planned' })).f },
  { name: 'a run with no session', gate: 'dispatched', refusal: { reject: { code: 'not-dispatched' } },
    f: facts({ to: 'awaiting-review' }, run({ sessionId: null })).f },
  { name: 'a review in flight', gate: 'reviewInFlight', refusal: { reject: { code: 'review-in-flight', reviewRunId: 9 } },
    f: facts({ to: 'working', reviewInFlight: () => 9 }, run({ state: 'awaiting-review' })).f },
  { name: 'a full fleet on re-entry', gate: 'cap', refusal: { reject: { code: 'cap-concurrency', limit: 1, running: 1 } },
    f: facts({ to: 'working', overConcurrency: () => FULL }, run({ state: 'merging' })).f },
  { name: 'a stored id ccd would read as a flag', gate: 'storedId', refusal: { reject: { code: 'bad-session' } },
    f: facts({ to: 'awaiting-review' }, run({ sessionId: '--actor' })).f },
];

const PAIRS: Pair[] = [
  { name: 'a run with no session on an edge it lacks', pair: ['edge', 'dispatched'], gate: 'edge',
    refusal: { reject: { code: 'bad-transition', from: 'working', to: 'working' } },
    f: facts({ to: 'working' }, run({ sessionId: null })).f },
  { name: 'a run with no session, a review in flight', pair: ['dispatched', 'reviewInFlight'], gate: 'dispatched',
    refusal: { reject: { code: 'not-dispatched' } },
    f: facts({ to: 'working', reviewInFlight: () => 9 }, run({ state: 'awaiting-review', sessionId: null })).f },
  { name: 'a review in flight on a full fleet', pair: ['reviewInFlight', 'cap'], gate: 'reviewInFlight',
    refusal: { reject: { code: 'review-in-flight', reviewRunId: 9 } },
    f: facts({ to: 'working', reviewInFlight: () => 9, overConcurrency: () => FULL }, run({ state: 'awaiting-review' })).f },
  // The bridges of the exclusive pairs: `edge`/`dispatched` against `storedId`, which the middle gates cannot meet.
  { name: 'an unreachable edge with a bad stored id', pair: ['edge', 'storedId'], gate: 'edge',
    refusal: { reject: { code: 'bad-transition', from: 'planned', to: 'merging' } },
    f: facts({ to: 'merging' }, run({ state: 'planned', sessionId: '--actor' })).f },
  { name: 'a null session on a forward edge', pair: ['dispatched', 'storedId'], gate: 'dispatched',
    refusal: { reject: { code: 'not-dispatched' } },
    f: facts({ to: 'awaiting-review' }, run({ sessionId: null })).f },
];

/** Adjacent pairs no single input trips together, and why. Each is bridged by a PAIRS row. */
const EXCLUSIVE_PAIRS: { pair: [AdvanceGate, AdvanceGate]; why: string }[] = [
  { pair: ['read', 'edge'], why: 'the first refuses when there is no run to read, the second needs the run it read' },
  { pair: ['cap', 'storedId'], why: 'the first trips only a move to `working`, the second only a forward move' },
];

describe('advanceGate — one row per gate (ARCH-33)', () => {
  it('covers every gate in ADVANCE_GATES with a single-gate row, and names no other', () => {
    const names = ADVANCE_GATES.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    expect([...new Set(SINGLE.map((r) => r.gate))].sort()).toEqual([...names].sort());
  });

  for (const r of SINGLE) {
    it(`${r.gate}: ${r.name}`, () => expect(advanceGate(r.f)).toStrictEqual(refused(r.refusal)));
  }

  it('admits a retreat to working whatever the stored session id: it composes no argv', () => {
    const r = run({ state: 'awaiting-review', sessionId: '--actor' });
    expect(advanceGate(facts({ to: 'working' }, r).f)).toStrictEqual({ ok: true, run: r });
  });

  it('admits a run, handing the route the run it read', () => {
    const r = run();
    expect(advanceGate(facts({ to: 'awaiting-review' }, r).f)).toStrictEqual({ ok: true, run: r });
  });
});

describe('advanceGate — the gate-order table (ARCH-33)', () => {
  for (const r of PAIRS) {
    it(`${r.pair[0]} before ${r.pair[1]}: ${r.name}`, () => expect(advanceGate(r.f)).toStrictEqual(refused(r.refusal)));
  }

  it('every adjacent pair in ADVANCE_GATES is a table row or a stated exclusive pair', () => {
    const names = ADVANCE_GATES.map(([n]) => n);
    const covered = new Set([...PAIRS, ...EXCLUSIVE_PAIRS].map((p) => p.pair.join('>')));
    const missing: string[] = [];
    for (let i = 0; i + 1 < names.length; i++) {
      const k = `${names[i]}>${names[i + 1]}`;
      if (!covered.has(k)) missing.push(k);
    }
    expect(missing).toEqual([]);
  });
});

describe('advanceGate — lookups are lazy (ARCH-33)', () => {
  it('reads the review only for a work run sent back to working', () => {
    for (const [to, r, n] of [
      ['working', run({ state: 'awaiting-review' }), 1],
      ['working', run({ state: 'dispatched', kind: 'review' }), 0],
      ['awaiting-review', run(), 0],
    ] as const) {
      const { f, calls } = facts({ to }, r);
      advanceGate(f);
      expect(calls.review, `${to} ${r.kind}`).toBe(n);
    }
  });

  it('reads the caps only for a move to working from an idle state', () => {
    for (const [state, n] of [['awaiting-review', 1], ['merging', 1], ['dispatched', 0], ['working', 0]] as const) {
      const { f, calls } = facts({ to: 'working' }, run({ state }));
      advanceGate(f);
      expect(calls.caps, state).toBe(n);
    }
  });

  it('reads nothing past the first refusal and the run once', () => {
    const { f, calls } = facts({ to: 'working' }, run({ state: 'planned', sessionId: null }));
    advanceGate(f);
    expect(calls).toEqual({ read: 1, review: 0, caps: 0 });
  });
});

describe('advanceRequest — the body, then the target (ARCH-33)', () => {
  const FP = { branchTip: 'a', prNumber: null, prPhase: 'none', handoffCommit: 'b' };
  const bad = { ok: false, refusal: { error: 'bad-request' } };

  it('accepts a shaped body and hands back the id, the target and the fingerprint', () => {
    expect(advanceRequest('12', { to: 'merging', fingerprint: { ...FP, prNumber: 3 } }))
      .toStrictEqual({ ok: true, req: { id: 12, to: 'merging', fingerprint: { ...FP, prNumber: 3 } } });
  });

  it.each(['1.0', '01', '0', 'x', String(Number.MAX_SAFE_INTEGER + 1)])('refuses the run id %s as bad-request', (id) => {
    expect(advanceRequest(id, { to: 'working', fingerprint: FP })).toStrictEqual(bad);
  });

  it.each([
    ['a non-state target', { to: 'nope', fingerprint: FP }],
    ['no fingerprint', { to: 'working' }],
    ['a null fingerprint', { to: 'working', fingerprint: null }],
    ['a numeric tip', { to: 'working', fingerprint: { ...FP, branchTip: 1 } }],
    ['a numeric commit', { to: 'working', fingerprint: { ...FP, handoffCommit: 1 } }],
    ['a numeric phase', { to: 'working', fingerprint: { ...FP, prPhase: 1 } }],
    ['a string pr number', { to: 'working', fingerprint: { ...FP, prNumber: '7' } }],
    ['an undefined pr number', { to: 'working', fingerprint: { branchTip: 'a', prPhase: 'none', handoffCommit: 'b' } }],
  ])('refuses %s as bad-request', (_n, body) => {
    expect(advanceRequest('1', body as never)).toStrictEqual(bad);
  });

  it('answers the shape before the target scope, and the id before both', () => {
    expect(advanceRequest('1', { to: 'done', fingerprint: null as never })).toStrictEqual(bad);
    expect(advanceRequest('x', { to: 'done', fingerprint: FP })).toStrictEqual(bad);
  });

  it.each(['planned', 'dispatched', 'closing', 'done', 'failed'] as const)('refuses the out-of-scope target %s with a detail', (to) => {
    const r = advanceRequest('1', { to, fingerprint: FP });
    expect(r).toMatchObject({ ok: false, refusal: { reject: { code: 'bad-transition' } } });
    expect((r as { refusal: { reject: { detail: string } } }).refusal.reject.detail).toContain(ADVANCE_TARGETS.join('/'));
  });

  it.each(ADVANCE_TARGETS)('accepts the target %s', (to) => {
    expect(advanceRequest('1', { to, fingerprint: FP }).ok).toBe(true);
  });
});

describe('the /advance handler is act-only (ARCH-33 acceptance)', () => {
  // Keyed on the call site (scan/parse.ts), not on a line of source text, so the pin follows the handler when it moves.
  const parsed = parsedFile('server/src/coord/routes.ts');
  const call = parsed.calls.find((c) => c.callee === 'app.post' && c.args[0]?.text === '/api/runs/:id/advance');
  const handler = call === undefined ? '' : parsed.text.slice(call.start, call.end);

  it('finds the handler', () => {
    expect(call).toBeDefined();
    expect(handler).toContain('advanceGate(');
  });

  it('holds at most 4 ifs', () => {
    expect(handler.match(/\bif\s*\(/g)?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('decides no gate itself: it names none of the decider\'s inputs', () => {
    for (const word of ['transitionsFor', 'IDLE_RUN_STATES', 'isRegistryId', 'isRunState', 'ADVANCE_TARGETS']) {
      expect(handler, word).not.toContain(word);
    }
  });

  it('answers every gate refusal through refuseAdvance, with no inline reject of its own', () => {
    expect(handler).not.toMatch(/reject:\s*\{\s*code:/);
  });
});
