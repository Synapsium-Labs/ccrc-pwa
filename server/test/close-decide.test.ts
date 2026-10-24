// ARCH-35 (GitHub #556): `decideClose`, the L1 decider that takes `closeRun`'s preconditions as data.
//
// WHAT IS HELD HERE. The decider is driven with facts and no I/O: every refusal the old inline code returned is a row,
// every adjacent pair of gates that one input can trip together has a row naming the EARLIER gate as the answer (the
// recorded reorder mutants are in the PR body), and the lazy reads are counted so a refusal costs only the reads ahead
// of it. `close-gate-order.test.ts` holds the same order through `closeRun` itself; the behaviour suites
// (`coord-abandon`, `sweep-close`, `child-reclaim-close`, ...) hold the acts.
//
// THE ACCEPTANCE PINS at the end (#556): `closeRun` is at least 40% smaller in code lines, `decideClose` has the
// gate-order rows, and the executor's switch over the decision's arms is exhaustive (`satisfies never`).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type OpenSiblingsResult } from '../src/coord/store.js';
import {
  abandonMove, decideClose, type AbandonFacts, type CloseDecision, type CloseFacts, type CommitFacts, type RequestFacts,
} from '../src/coord/closeDecide.js';
import type { ChildGate } from '../src/coord/close.js';
import { codeLines } from './growthCheck.js';
import { REPO_ROOT, parsedFile, sourceOfSymbol } from './scan/symbols.js';
import { mkTmp } from './tmpHelpers.js';

const SHA = 'a'.repeat(40);
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-decide-close-'), 'coord.db')));

/** A dispatched, working run bound to `demo-w`. */
function working(c: CoordStore, over: { wave?: number } = {}): number {
  const o = c.openRun({ program: 'p', title: 't', project: 'demo', wave: over.wave ?? 1, waveOf: 3, claimedBy: 'c' });
  if (!('id' in o)) throw new Error('openRun refused');
  c.markDispatched(o.id, 'demo-w', 'w', 'ws/w', false);
  for (const to of ['dispatched', 'working'] as const) c.advance(o.id, to, 'coordinator');
  return o.id;
}
function planned(c: CoordStore): number {
  const o = c.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 3, claimedBy: 'c' });
  if (!('id' in o)) throw new Error('openRun refused');
  return o.id;
}
function badHold(c: CoordStore): number {
  const rec = c.reconstruct({
    ledger: { slug: 'bad program', title: 'Recovered', waves: [{ wave: 1, of: 2, handoffCommit: null }] },
    registry: { sessionId: 'demo-recovered', project: 'demo', workspace: 'recovered', branch: 'ws/recovered', held: 'legacy hold' },
    prHistory: [],
  })[0]!;
  c.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(rec.id);
  return rec.id;
}

const outcomeOf = (d: CloseDecision<unknown>): unknown => (d.kind === 'go' ? null : d.outcome);
const fp = (over: Record<string, unknown> = {}) => ({ branchTip: SHA, prNumber: null, prPhase: 'none', handoffCommit: SHA, ...over });
const request = (c: CoordStore, id: number, over: Partial<RequestFacts> = {}): RequestFacts =>
  ({ step: 'request', read: c.run(id), body: { fingerprint: fp(), final: true }, causedBy: 'coordinator', ...over });

describe('decideClose, the request step', () => {
  it('a work close that is well-formed goes, with the claim and the flags the body carried', () => {
    const c = store(); const id = working(c);
    const d = decideClose(request(c, id, { body: { fingerprint: fp(), final: false, archive: true } }));
    expect(d.kind === 'go' && d.plan.arm === 'work' ? [d.plan.final, d.plan.archive, d.plan.state, d.plan.verify, d.plan.handoffCommit] : null)
      .toEqual([false, true, 'done', true, SHA]);
  });

  it('a failed close skips the measurement, and a commit that is no 40-hex sha is written as null', () => {
    const c = store(); const id = working(c);
    const d = decideClose(request(c, id, { body: { fingerprint: fp({ handoffCommit: 'x', branchTip: 'x' }), final: true, state: 'failed' } }));
    expect(d.kind === 'go' && d.plan.arm === 'work' ? [d.plan.verify, d.plan.handoffCommit] : null).toEqual([false, null]);
  });

  it('a review run goes to the review arm; a body with intent abandon goes to the abandon arm', () => {
    const c = store(); const id = working(c);
    c.db.prepare("UPDATE runs SET kind = 'review' WHERE id = ?").run(id);
    expect(decideClose(request(c, id, { body: {} })).kind === 'go').toBe(true);
    const d = decideClose(request(c, id, { body: {} }));
    expect(d.kind === 'go' ? d.plan.arm : null).toBe('review');
    const c2 = store(); const id2 = working(c2);
    const a = decideClose(request(c2, id2, { body: { intent: 'abandon' }, causedBy: 'operator' }));
    expect(a.kind === 'go' && a.plan.arm === 'abandon' ? [a.plan.target, a.plan.unnamed] : null).toEqual(['closing', false]);
  });

  it('the rows, one gate each', () => {
    const c = store(); const id = working(c);
    const rows: [string, RequestFacts, unknown][] = [
      ['unreadable row', request(c, id, { read: { ok: false, detail: 'wave: not representable' } as never }),
        { ok: false, kind: 'hold-invalid', detail: 'wave: not representable' }],
      ['no such row', request(c, id, { read: { ok: true, run: null } as never }), { ok: false, kind: 'unknown-run' }],
      ['null body', request(c, id, { body: null }), { ok: false, kind: 'bad-request' }],
      ['final not a boolean', request(c, id, { body: { fingerprint: fp(), final: 'yes' } }), { ok: false, kind: 'bad-request' }],
      ['state a stranger', request(c, id, { body: { fingerprint: fp(), final: true, state: 'x' } }), { ok: false, kind: 'bad-request' }],
      ['archive not a boolean', request(c, id, { body: { fingerprint: fp(), final: true, archive: 'y' } }), { ok: false, kind: 'bad-request' }],
      ['prNumber a string', request(c, id, { body: { fingerprint: fp({ prNumber: '3' }), final: true } }), { ok: false, kind: 'bad-request' }],
      ['branchTip a number', request(c, id, { body: { fingerprint: fp({ branchTip: 1 }), final: true } }), { ok: false, kind: 'bad-request' }],
      ['sweep with a close body', request(c, id, { causedBy: 'sweep' }), { ok: false, kind: 'bad-request' }],
      ['abandon with a claim', request(c, id, { body: { intent: 'abandon', final: true }, causedBy: 'operator' }), { ok: false, kind: 'bad-request' }],
    ];
    for (const [name, facts, want] of rows) expect(outcomeOf(decideClose(facts)), name).toEqual(want);
  });

  // THE GATE-ORDER TABLE. Each row trips two adjacent gates with one input and names the earlier one.
  it('gate order: the row, then the mixed abandon shape', () => {
    const c = store(); const id = working(c);
    expect(outcomeOf(decideClose(request(c, id, { read: { ok: true, run: null } as never, body: { intent: 'abandon', final: true } }))))
      .toEqual({ ok: false, kind: 'unknown-run' });
  });
  it('gate order: the mixed abandon shape, then the abandon move', () => {
    const c = store(); const id = working(c);
    c.advance(id, 'closing', 'coordinator');
    expect(outcomeOf(decideClose(request(c, id, { body: { intent: 'abandon', state: 'failed' }, causedBy: 'operator' }))))
      .toEqual({ ok: false, kind: 'bad-request' });
  });
  it('gate order: the sweep word, then the work close’s not-dispatched', () => {
    const c = store(); const id = planned(c);
    expect(outcomeOf(decideClose(request(c, id, { causedBy: 'sweep' })))).toEqual({ ok: false, kind: 'bad-request' });
  });
  it('gate order: not-dispatched, then the body', () => {
    const c = store(); const id = planned(c);
    expect(outcomeOf(decideClose(request(c, id, { body: {} })))).toEqual({ ok: false, kind: 'refused', code: 'not-dispatched' });
  });
  it('gate order: the stored session, then the transition', () => {
    const c = store(); const id = planned(c);
    c.db.prepare("UPDATE runs SET sessionId = 'a/b' WHERE id = ?").run(id);
    expect(outcomeOf(decideClose(request(c, id)))).toEqual({ ok: false, kind: 'bad-session' });
  });
  it('gate order: the stored session, then the review arm', () => {
    const c = store(); const id = working(c);
    c.db.prepare("UPDATE runs SET sessionId = 'a/b', kind = 'review' WHERE id = ?").run(id);
    expect(outcomeOf(decideClose(request(c, id, { body: {} })))).toEqual({ ok: false, kind: 'bad-session' });
  });
  it('gate order: the transition, then the body', () => {
    const c = store(); const id = working(c);
    for (const to of ['closing', 'done'] as const) c.advance(id, to, 'coordinator');
    expect(outcomeOf(decideClose(request(c, id, { body: {} })))).toEqual({ ok: false, kind: 'bad-transition', from: 'done', to: 'closing' });
  });

  it('the abandon move: a planned or review run fails directly; the rest go through closing; a closing run is refused', () => {
    const c = store(); const b = working(c);
    expect(abandonMove({ state: 'planned', kind: 'work' })).toEqual({ ok: true, to: 'failed' });
    expect(abandonMove({ state: 'working', kind: 'work' })).toEqual({ ok: true, to: 'closing' });
    expect(abandonMove({ state: 'working', kind: 'review' })).toEqual({ ok: true, to: 'failed' });
    c.advance(b, 'closing', 'coordinator');
    expect(abandonMove({ state: 'closing', kind: 'work' })).toEqual({ ok: false, kind: 'bad-transition', from: 'closing', to: 'closing' });
  });

  it('a stored id no verb may name is `unnamed` on the abandon arm', () => {
    const c = store(); const id = planned(c);
    c.db.prepare("UPDATE runs SET sessionId = 'a/b' WHERE id = ?").run(id);
    const d = decideClose(request(c, id, { body: { intent: 'abandon' }, causedBy: 'operator' }));
    expect(d.kind === 'go' && d.plan.arm === 'abandon' ? d.plan.unnamed : null).toBe(true);
  });
});

describe('decideClose, the verified step', () => {
  it('a verdict that holds goes with its measured line', () => {
    const d = decideClose({ step: 'verified', verdict: { ok: true, measured: {}, line: null } as never });
    expect(d).toEqual({ kind: 'go', plan: { line: null } });
  });
  it('a verdict that fails is refused as doneVerdict and carries the rejection to record and mail', () => {
    const d = decideClose({ step: 'verified', verdict: { ok: false, code: 'no-handoff-commit', detail: 'why' } });
    expect(d).toEqual({ kind: 'refused', outcome: { ok: false, kind: 'doneVerdict', code: 'no-handoff-commit', detail: 'why' },
      rejection: { code: 'no-handoff-commit', detail: 'why' } });
  });
});

const NO_GATE: ChildGate = { decision: { reclaim: false, why: 'not-a-child' }, request: null };
const RECLAIM_GATE: ChildGate = { decision: { reclaim: true }, request: null };
const sibs = (c: CoordStore, id: number): OpenSiblingsResult => c.openRunsForSession('demo-w', id);

describe('decideClose, the close step (the work close’s hold)', () => {
  const act = (c: CoordStore, id: number, over: Partial<Extract<CloseFacts, { step: 'close' }>> = {}, trace: string[] = []) => {
    const run = (c.run(id) as { run: never }).run;
    return decideClose({ step: 'close', run, siblings: sibs(c, id), final: true, state: 'done', archive: false,
      gate: async () => { trace.push('gate'); return NO_GATE; }, ...over });
  };
  it('a final close with no sibling releases', async () => {
    const c = store(); const id = working(c);
    const d = await act(c, id);
    expect(d.kind === 'go' ? [d.plan.fleet, d.plan.released] : null).toEqual([{ verb: 'wsRelease' }, true]);
  });
  it('a non-final close holds for the next wave with the wave+1 reason', async () => {
    const c = store(); const id = working(c);
    const d = await act(c, id, { final: false });
    expect(d.kind === 'go' ? [d.plan.fleet.verb, d.plan.released] : null).toEqual(['wsHold', false]);
  });
  it('a failed close with archive archives, unless the workspace is a finished child (the release wins)', async () => {
    const c = store(); const id = working(c);
    const a = await act(c, id, { state: 'failed', archive: true, final: false });
    expect(a.kind === 'go' ? a.plan.fleet.verb : null).toBe('wsArchive');
    const r = await act(c, id, { state: 'failed', archive: true, final: false, gate: async () => RECLAIM_GATE });
    expect(r.kind === 'go' ? [r.plan.fleet.verb, r.plan.released] : null).toEqual(['wsRelease', true]);
  });
  it('a sibling hands the claim over with its own reason, never an archive or a release', async () => {
    const c = store(); const id = working(c);
    const s = c.openRun({ program: 'q', title: 'q', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'd' });
    if (!('id' in s)) throw new Error('openRun refused');
    c.markDispatched(s.id, 'demo-w', 'w', 'ws/w', false);
    for (const to of ['dispatched', 'working'] as const) c.advance(s.id, to, 'coordinator');
    const d = await act(c, id, { state: 'failed', archive: true });
    expect(d.kind === 'go' ? [d.plan.fleet.verb, d.plan.released] : null).toEqual(['wsHold', false]);
  });
  it('gate order: the sibling read, then the child gate (not called on an unreadable list)', async () => {
    const c = store(); const id = working(c); const trace: string[] = [];
    const d = await act(c, id, { siblings: { ok: false, kind: 'run-unreadable', detail: 'siblings: unreadable' } }, trace);
    expect(outcomeOf(d)).toEqual({ ok: false, kind: 'hold-invalid', detail: 'siblings: unreadable' });
    expect(trace).toEqual([]);
  });
  it('gate order: the child gate, then the hold verdict (the gate is read before an unrepresentable hold refuses)', async () => {
    const c = store(); const id = badHold(c); const trace: string[] = [];
    const d = await act(c, id, { final: false }, trace);
    expect(d.kind === 'refused' ? d.outcome.kind : null).toBe('hold-invalid');
    expect(trace).toEqual(['gate']);
  });
});

describe('decideClose, the abandon step', () => {
  const act = (c: CoordStore, id: number, over: Partial<AbandonFacts> = {}, trace: string[] = []) => {
    const run = (c.run(id) as { run: never }).run;
    return decideClose({ step: 'abandon', run, siblings: sibs(c, id),
      gate: async () => { trace.push('gate'); return NO_GATE; }, ...over });
  };
  it('no sibling releases', async () => {
    const c = store(); const id = working(c);
    const d = await act(c, id);
    expect(d.kind === 'go' ? [d.plan.fleet, d.plan.released] : null).toEqual([{ verb: 'wsRelease' }, true]);
  });
  it('a surviving sibling’s claim is handed over: a hold with its reason, released false', async () => {
    const c = store(); const id = working(c);
    const s = c.openRun({ program: 'q', title: 'q', project: 'demo', wave: 2, waveOf: 3, claimedBy: 'd' });
    if (!('id' in s)) throw new Error('openRun refused');
    c.markDispatched(s.id, 'demo-w', 'w', 'ws/w', false);
    for (const to of ['dispatched', 'working'] as const) c.advance(s.id, to, 'coordinator');
    const d = await act(c, id);
    expect(d.kind === 'go' ? [d.plan.fleet.verb, d.plan.released] : null).toEqual(['wsHold', false]);
  });
  it('gate order: the sibling read, then the child gate', async () => {
    const c = store(); const id = working(c); const trace: string[] = [];
    const d = await act(c, id, { siblings: { ok: false, kind: 'run-unreadable', detail: 'x' } }, trace);
    expect(outcomeOf(d)).toEqual({ ok: false, kind: 'hold-invalid', detail: 'x' });
    expect(trace).toEqual([]);
  });
});

describe('decideClose, the sweep, ledger, verb, fleet and re-measure steps', () => {
  const stop = { kind: 'remeasured', why: 'alive' } as never;
  it('sweep: the re-measure first, and the fresh read is not taken once it stops', () => {
    let reads = 0;
    const fresh = () => { reads += 1; return { ok: true, run: { claimedBy: 'other' } } as never; };
    expect(decideClose({ step: 'sweep', stop, fresh, claimedBy: 'crashed' }))
      .toEqual({ kind: 'refused', outcome: { ok: false, kind: 'sweep-stopped', stop, fleetAct: null } });
    expect(reads).toBe(0);
    expect(outcomeOf(decideClose({ step: 'sweep', stop: null, fresh, claimedBy: 'crashed' })))
      .toEqual({ ok: false, kind: 'claimant-changed', claimedBy: 'other' });
  });
  it('sweep: the fresh read’s own refusals, then the claimant', () => {
    expect(outcomeOf(decideClose({ step: 'sweep', stop: null, fresh: () => ({ ok: false, detail: 'd' }) as never, claimedBy: 'x' })))
      .toEqual({ ok: false, kind: 'hold-invalid', detail: 'd' });
    expect(outcomeOf(decideClose({ step: 'sweep', stop: null, fresh: () => ({ ok: true, run: null }) as never, claimedBy: 'x' })))
      .toEqual({ ok: false, kind: 'unknown-run' });
    expect(decideClose({ step: 'sweep', stop: null, fresh: () => ({ ok: true, run: { claimedBy: 'x' } }) as never, claimedBy: 'x' }).kind).toBe('go');
  });
  it('recheck: a stop after the act is STALE and names which fleet act ran', () => {
    expect(decideClose({ step: 'recheck', stop, release: true }))
      .toEqual({ kind: 'stale', outcome: { ok: false, kind: 'sweep-stopped', stop, fleetAct: 'released' } });
    expect(decideClose({ step: 'recheck', stop, release: false }))
      .toEqual({ kind: 'stale', outcome: { ok: false, kind: 'sweep-stopped', stop, fleetAct: 're-held' } });
    expect(decideClose({ step: 'recheck', stop: null, release: true }).kind).toBe('go');
  });
  it('ledger: an unreadable ledger refuses, a read one goes with its entries', () => {
    expect(outcomeOf(decideClose({ step: 'ledger', history: { ok: false, error: 'unreadable' } })))
      .toEqual({ ok: false, kind: 'refused', code: 'prhistory-unreadable' });
    expect(decideClose({ step: 'ledger', history: { ok: true, entries: [] } })).toEqual({ kind: 'go', plan: { entries: [] } });
  });
  it('verb: a verb the box does not list is unsupported', () => {
    expect(outcomeOf(decideClose({ step: 'verb', verb: 'wsRelease', can: false }))).toEqual({ ok: false, kind: 'unsupported' });
    expect(decideClose({ step: 'verb', verb: 'wsRelease', can: true }).kind).toBe('go');
  });
  it('fleet: a refused act is fleetFailed with ccd’s stderr', () => {
    expect(outcomeOf(decideClose({ step: 'fleet', res: { ok: false, stderr: 'boom' } }))).toEqual({ ok: false, kind: 'fleetFailed', stderr: 'boom' });
    expect(decideClose({ step: 'fleet', res: { ok: true } }).kind).toBe('go');
  });
  const commit = (closed: CommitFacts['closed'], acted: boolean) => decideClose({ step: 'commit', closed, acted });
  it('commit: a refusal BEFORE any act is refused; the same refusal AFTER one is STALE; ok goes', () => {
    const changed = { ok: false, error: 'claimant-changed', claimedBy: 'heir' } as const;
    expect(commit(changed, false)).toEqual({ kind: 'refused', outcome: { ok: false, kind: 'claimant-changed', claimedBy: 'heir' } });
    expect(commit(changed, true)).toEqual({ kind: 'stale', outcome: { ok: false, kind: 'claimant-changed', claimedBy: 'heir' } });
    const bad = { ok: false, error: 'unknown-run' } as const;
    expect(commit(bad, true)).toEqual({ kind: 'stale', outcome: { ok: false, kind: 'advanceFailed', adv: bad } });
    expect(commit({ ok: true, from: 'closing', to: 'failed' }, true).kind).toBe('go');
  });
});

describe('the acceptance pins (ARCH-35)', () => {
  const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  const BASELINE_CLOSE_RUN_CODE_LINES = 183;   // measured on origin/main before this change

  /** `closeRun` is declared three times (two overloads and the body); the body is the longest. */
  const closeRunSource = (): string => {
    const p = parsedFile('server/src/coord/close.ts');
    const s = p.symbols.filter((x) => x.name === 'closeRun').sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]!;
    return p.text.slice(s.start, s.end);
  };

  it('closeRun lost at least 40% of its code lines', () => {
    expect(codeLines('close.ts', closeRunSource())).toBeLessThanOrEqual(Math.floor(BASELINE_CLOSE_RUN_CODE_LINES * 0.6));
  });

  it('the decider has the named stale arm, and both switches over the arms are exhaustive', () => {
    const decider = read('server/src/coord/closeDecide.ts');
    expect(decider).toMatch(/kind: 'stale'/);
    expect(decider).toMatch(/default: return f satisfies never;/);
    expect(sourceOfSymbol('server/src/coord/close.ts', 'stopped')).toMatch(/case 'stale':/);
    expect(sourceOfSymbol('server/src/coord/close.ts', 'stopped')).toMatch(/return d satisfies never;/);
  });

  it('closeRun only acts: it decides through decideClose and names no gate predicate', () => {
    const run = closeRunSource();
    expect(run).toContain("step: 'request'");
    expect(run).not.toMatch(/\bisRegistryId\b|\btransitionsFor\b|\bholdReasonVerdict\b|\bsurvivorOf\b|\breleaseIsSafe\b|\bccdCan\b/);
  });

  it('the work and abandon executors decide every gate through decideClose too', () => {
    for (const fn of ['closeWorkRun', 'abandonRun']) {
      const src = sourceOfSymbol('server/src/coord/close.ts', fn);
      expect(src, fn).toContain('decideClose(');
      expect(src, fn).not.toMatch(/\bisRegistryId\b|\btransitionsFor\b|\bholdReasonVerdict\b|\bsurvivorOf\b|\breleaseIsSafe\b|\bHANDOFF_SHA\b/);
    }
  });
});
