// ARCH-22 (GitHub #553): `decideDispatch`, the L1 decider that finishes increment 4 inside `dispatchRun`.
//
// WHAT IS HELD HERE. The decider is driven with facts and no I/O: every refusal the old inline code returned is a row,
// every adjacent pair of gates that one input can trip together has a row naming the EARLIER gate as the answer (the
// recorded reorder mutants are in the PR body), and the lazy reads are counted so a refusal costs only the reads ahead
// of it. `dispatch-gate-order.test.ts` holds the same order through `dispatchRun` itself; the behaviour suites
// (`dispatch-route`, `dispatch-live-gate`, `dispatch-adopt`, ...) hold the acts.
//
// THE ACCEPTANCE PINS at the end: `dispatch.ts` imports no `inject/send.js` at runtime and the ARCH-04 exemption for
// that edge is gone; both executors switch exhaustively (`satisfies never`); `dispatchRun` is at least 40% smaller.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  decideDispatch, type ActFacts, type AdmitFacts, type BindFacts, type CapsReading, type DispatchDecision,
  type RequestFacts, type ResumeFacts,
} from '../src/coord/dispatchDecide.js';
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';
import type { SessionRecord, RegistryRead } from '../src/registry.js';
import { MAIL_BODY_MAX_BYTES } from '../../shared/api.js';
import { codeLines } from './growthCheck.js';
import { REPO_ROOT, sourceOfSymbol } from './scan/symbols.js';
import { mkTmp } from './tmpHelpers.js';

const PREFIXES = { work: 'WORK\n', review: 'REVIEW\n' };
const PROJECT = 'demo';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-decide-dispatch-'), 'coord.db')));

function planned(c: CoordStore, over: { wave?: number } = {}): number {
  const o = c.openRun({ program: 'p', title: 't', project: PROJECT, wave: over.wave ?? 1, waveOf: 2, claimedBy: 'c' });
  if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
  return o.id;
}

function request(c: CoordStore, id: number, over: Partial<RequestFacts> = {}): RequestFacts {
  return { step: 'request', read: c.run(id), brief: 'go', items: undefined, route: undefined, slug: undefined,
    prefixes: PREFIXES, ...over };
}

/** A decision narrowed to its refusal, for the row assertions. */
const outcomeOf = <P>(d: DispatchDecision<P>): unknown => (d.kind === 'go' ? { go: d.plan } : d.outcome);

describe('decideDispatch, the request step (ARCH-22)', () => {
  it('a clean request goes, carrying the mail, the items, the route fields, the slug and the hold', () => {
    const c = store(); const id = planned(c);
    const d = decideDispatch(request(c, id, { items: ['a', 'b'], route: { effort: 'high' }, slug: 'next-one' }));
    expect(d.kind).toBe('go');
    if (d.kind !== 'go') return;
    expect(d.plan.body).toBe('WORK\ngo');
    expect(d.plan.itemTitles).toEqual(['a', 'b']);
    expect(d.plan.routeFields).toEqual({ effort: 'high' });
    expect(d.plan.childSlug).toBe('next-one');
    expect(d.plan.hold.ok).toBe(true);
  });

  it('a review run composes the reviewer prefix', () => {
    const c = store(); const id = planned(c);
    c.db.prepare("UPDATE runs SET kind = 'review' WHERE id = ?").run(id);
    const d = decideDispatch(request(c, id));
    expect(d.kind === 'go' ? d.plan.body : null).toBe('REVIEW\ngo');
  });

  it('the rows, one gate each', () => {
    const c = store(); const id = planned(c);
    const rows: [string, RequestFacts, unknown][] = [
      ['unreadable row', request(c, id, { read: { ok: false, detail: 'wave: not representable' } as never }),
        { ok: false, kind: 'hold-invalid', detail: 'wave: not representable' }],
      ['no such row', request(c, id, { read: { ok: true, run: null } as never }), { ok: false, kind: 'unknown-run' }],
      ['empty brief', request(c, id, { brief: '  ' }), { ok: false, kind: 'bad-request' }],
      ['items not an array', request(c, id, { items: 'x' }), { ok: false, kind: 'bad-request' }],
      ['a blank item', request(c, id, { items: ['ok', ' '] }), { ok: false, kind: 'bad-request' }],
      ['slug grammar', request(c, id, { slug: 'Bad Slug!' }),
        { ok: false, kind: 'bad-request', detail: 'slug: must match ^[a-z0-9][a-z0-9-]{1,30}$' }],
    ];
    for (const [name, facts, want] of rows) expect(outcomeOf(decideDispatch(facts)), name).toEqual(want);
  });

  it('a slug on a run that resumes its bound session is refused, not dropped', () => {
    const c = store(); const id = planned(c, { wave: 2 });
    c.setSession(id, 'demo-bound');
    expect(outcomeOf(decideDispatch(request(c, id, { slug: 'next-one' }))))
      .toEqual({ ok: false, kind: 'bad-request', detail: 'slug: this run resumes its bound session; a slug names a fresh spawn only' });
  });

  it('a stored session id that is not a registry id is bad-session', () => {
    const c = store(); const id = planned(c);
    c.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('a/b', id);
    expect(outcomeOf(decideDispatch(request(c, id)))).toEqual({ ok: false, kind: 'bad-session' });
  });

  // THE GATE-ORDER TABLE. Each row trips two adjacent gates with one input and names the earlier one.
  it('gate order: transition, then brief', () => {
    const c = store(); const id = planned(c);
    c.db.prepare("UPDATE runs SET state = 'dispatched' WHERE id = ?").run(id);
    expect(outcomeOf(decideDispatch(request(c, id, { brief: '' }))))
      .toEqual({ ok: false, kind: 'bad-transition', from: 'dispatched', to: 'dispatched' });
  });
  it('gate order: oversize, then items', () => {
    const c = store(); const id = planned(c);
    const d = decideDispatch(request(c, id, { brief: 'x'.repeat(MAIL_BODY_MAX_BYTES), items: [7] }));
    expect(d.kind === 'refused' ? d.outcome : null).toMatchObject({ ok: false, kind: 'oversize', limit: MAIL_BODY_MAX_BYTES });
  });
  it('gate order: items, then route', () => {
    const c = store(); const id = planned(c);
    expect(outcomeOf(decideDispatch(request(c, id, { items: [7], route: { nonsense: 'x' } }))))
      .toEqual({ ok: false, kind: 'bad-request' });
  });
  it('gate order: route, then slug', () => {
    const c = store(); const id = planned(c);
    const d = decideDispatch(request(c, id, { route: { nonsense: 'x' }, slug: 'Bad Slug!' }));
    expect(d.kind === 'refused' && d.outcome.kind === 'bad-request' ? d.outcome.detail : null).toMatch(/^route: /);
  });
  it('gate order: slug, then hold', () => {
    const c = store(); const id = badHold(c);
    c.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(id);
    const d = decideDispatch(request(c, id, { slug: 'Bad Slug!' }));
    expect(d.kind === 'refused' && d.outcome.kind === 'bad-request' ? d.outcome.detail : null).toMatch(/^slug: must match /);
  });
  it('gate order: hold, then stored session', () => {
    const c = store(); const id = badHold(c);
    c.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run('a/b', id);
    const d = decideDispatch(request(c, id));
    expect(d.kind === 'refused' ? d.outcome.kind : null).toBe('hold-invalid');
  });
});

function badHold(c: CoordStore): number {
  const rec = c.reconstruct({
    ledger: { slug: 'bad program', title: 'Recovered', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
    registry: { sessionId: 'demo-recovered', project: PROJECT, workspace: 'recovered', branch: 'ws/recovered', held: 'legacy hold' },
    prHistory: [],
  })[0]!;
  c.db.prepare("UPDATE runs SET state = 'planned' WHERE id = ?").run(rec.id);
  return rec.id;
}

describe('decideDispatch, the admit step', () => {
  const caps = (over: Partial<CapsReading> = {}): CapsReading => ({
    caps: { maxConcurrentWorkers: 3 }, usage: { running: 0 },
    overConcurrency: null, ...over,
  });
  const admit = (names: readonly string[] | null, reading: CapsReading, reads: { n: number }): AdmitFacts =>
    ({ step: 'admit', names, caps: () => { reads.n++; return reading; } });

  it('an unlistable directory is paused (fail-shut), and the caps are not read', () => {
    const reads = { n: 0 };
    expect(outcomeOf(decideDispatch(admit(null, caps(), reads)))).toEqual({ ok: false, kind: 'refused', code: 'paused' });
    expect(reads.n).toBe(0);
  });
  it('gate order: pause, then mail-disabled', () => {
    expect(outcomeOf(decideDispatch(admit([COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER], caps(), { n: 0 }))))
      .toEqual({ ok: false, kind: 'refused', code: 'paused' });
  });
  it('gate order: mail-disabled, then the caps (not read)', () => {
    const reads = { n: 0 };
    expect(outcomeOf(decideDispatch(admit([MAIL_DISABLED_MARKER], caps({ overConcurrency: { limit: 0, running: 0 } }), reads))))
      .toEqual({ ok: false, kind: 'refused', code: 'mail-disabled' });
    expect(reads.n).toBe(0);
  });
  // The daily cap that once followed concurrency is retired (D-7068): concurrency is the last
  // admission gate, and past it a clean listing goes.
  it('gate order: concurrency is the last admission gate', () => {
    const full = caps({ overConcurrency: { limit: 3, running: 3 }, usage: { running: 3 } });
    expect(outcomeOf(decideDispatch(admit([], full, { n: 0 }))))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 3, running: 3 });
  });
  it('a clean listing goes', () => {
    expect(decideDispatch(admit([], caps(), { n: 0 })).kind).toBe('go');
  });
});

describe('decideDispatch, the before step', () => {
  it('an unlistable registry refuses; a listable one answers the ids it held, refused names included', () => {
    expect(outcomeOf(decideDispatch({ step: 'before', read: { listed: false } })))
      .toEqual({ ok: false, kind: 'registry-unmeasurable' });
    const d = decideDispatch({ step: 'before', read: { listed: true, records: [{ id: 'a' } as never], refused: new Set(['b/c']) } as unknown as RegistryRead });
    expect(d.kind === 'go' ? [...d.plan].sort() : null).toEqual(['a', 'b/c']);
  });
});

const rec = (id: string, over: Record<string, unknown> = {}): SessionRecord => ({
  id, project: PROJECT, workspace: `/w/${id}`, branch: `ws/${id}`, wrapper: 'claude', uuid: `u-${id}`, held: null,
  spawn: null, unmeasured: [], ...over,
}) as unknown as SessionRecord;

describe('decideDispatch, the bind step', () => {
  const listed = (records: SessionRecord[], refused: string[] = []): RegistryRead =>
    ({ listed: true, records, refused: new Set(refused) }) as unknown as RegistryRead;
  const bind = (over: Partial<BindFacts>): BindFacts => ({
    step: 'bind', project: PROJECT, childSlug: null, beforeIds: new Set(['old']), after: listed([rec('old'), rec('new')]),
    res: { ok: true }, ...over,
  });

  it('exactly one new row is the winner of a clean spawn, not adopted', () => {
    const d = decideDispatch(bind({}));
    expect(d.kind === 'go' ? [d.plan.winner.id, d.plan.adopted, d.plan.adoptedSpawn] : null).toEqual(['new', false, null]);
  });
  it('an unlistable AFTER, an unmeasured same-project row, and a refused name new since BEFORE are registry-unmeasurable', () => {
    for (const after of [{ listed: false } as unknown as RegistryRead, listed([rec('new', { unmeasured: ['uuid'] })]), listed([rec('new')], ['x/y'])]) {
      expect(outcomeOf(decideDispatch(bind({ after })))).toEqual({ ok: false, kind: 'registry-unmeasurable' });
    }
  });
  it("ccd's own words ride along on registry-unmeasurable only when ccd also failed", () => {
    expect(outcomeOf(decideDispatch(bind({ after: { listed: false } as unknown as RegistryRead, res: { ok: false, stderr: 'boom', cutShort: true } }))))
      .toEqual({ ok: false, kind: 'registry-unmeasurable', stderr: 'boom' });
  });
  it('two candidates after a clean ws-add are ambiguous, with no event; none after a failed one is fleetFailed WITH one', () => {
    const two = decideDispatch(bind({ after: listed([rec('n1'), rec('n2')]) }));
    expect(two).toEqual({ kind: 'refused', outcome: { ok: false, kind: 'refused', code: 'ambiguous-dispatch', candidates: 2 } });
    const none = decideDispatch(bind({ after: listed([rec('old')]), res: { ok: false, stderr: 'no', cutShort: false } }));
    expect(none).toEqual({ kind: 'refused', outcome: { ok: false, kind: 'fleetFailed', stderr: 'no' }, event: 'dispatch-refused:fleetFailed candidates=' });
    const failedTwo = decideDispatch(bind({ after: listed([rec('n1'), rec('n2')]), res: { ok: false, stderr: 'no', cutShort: true } }));
    expect(failedTwo).toMatchObject({ event: 'dispatch-refused:ambiguous-dispatch candidates=n1,n2' });
  });
  it('a named spawn binds only <project>-<slug>; a stranger is never bound in its place', () => {
    const stranger = bind({ childSlug: 'mine', after: listed([rec('demo-other')]) });
    expect(outcomeOf(decideDispatch(stranger))).toMatchObject({ code: 'ambiguous-dispatch', candidates: 0 });
    const mine = decideDispatch(bind({ childSlug: 'mine', after: listed([rec('demo-other'), rec('demo-mine')]) }));
    expect(mine.kind === 'go' ? mine.plan.winner.id : null).toBe('demo-mine');
  });
  it('a failed ws-add is adopted only on cutShort === true AND no hold; the verdict rides the winner', () => {
    const cut = { ok: false as const, stderr: 'killed', cutShort: true as const };
    const adopt = decideDispatch(bind({ res: cut, after: listed([rec('new', { spawn: { rc: 3 } })]) }));
    expect(adopt.kind === 'go' ? [adopt.plan.adopted, adopt.plan.adoptedSpawn] : null).toEqual([true, expect.anything()]);
    for (const [name, res, winner] of [
      ['exit 1 (a ccd die)', { ...cut, cutShort: false }, rec('new')],
      ['an unmeasured ending', { ...cut, cutShort: 'unmeasured' as never }, rec('new')],
      ['a held workspace', cut, rec('new', { held: 'a reason' })],
    ] as const) {
      expect(decideDispatch(bind({ res, after: listed([winner]) })), name)
        .toEqual({ kind: 'refused', outcome: { ok: false, kind: 'fleetFailed', stderr: 'killed' }, event: 'dispatch-refused:fleetFailed candidates=new' });
    }
  });
});

describe('decideDispatch, the resume step', () => {
  type Trace = string[];
  const identity = { unmeasured: [] };
  function resume(trace: Trace, over: {
    registry?: RegistryRead; project?: Awaited<ReturnType<ResumeFacts['projectField']>>; hook?: Awaited<ReturnType<ResumeFacts['hookState']>>;
    verdicts?: Array<'idle' | 'busy' | 'unmeasured'>; ensureStarted?: boolean; workspaceNull?: boolean;
  } = {}): ResumeFacts {
    const verdicts = [...(over.verdicts ?? ['idle'])];
    return {
      step: 'resume', project: PROJECT, sessionId: 'demo-s', runWorkspace: 'run-ws', runBranch: 'run-br',
      ensureStarted: over.ensureStarted ?? false,
      registry: async () => { trace.push('registry'); return over.registry ?? { listed: true, records: [rec('demo-s', over.workspaceNull ? { workspace: null, branch: null } : {})], refused: new Set() } as unknown as RegistryRead; },
      projectField: async () => { trace.push('project'); return over.project ?? { ok: true, content: PROJECT }; },
      hookState: async () => { trace.push('hook'); return over.hook ?? ({ ok: true, state: { state: 'done' } } as never); },
      turnVerdict: async () => { trace.push('verdict'); return verdicts.shift() ?? 'idle'; },
    };
  }
  const unmeasurable = { ok: false, kind: 'registry-unmeasurable' };

  it('a measured, done, idle session goes, with its workspace, branch, wrapper and the gate to re-read', async () => {
    const trace: Trace = [];
    const d = await decideDispatch(resume(trace));
    expect(d.kind === 'go' ? [d.plan.workspace, d.plan.branch, d.plan.wrapper, d.plan.liveGate.uuid] : null)
      .toEqual(['/w/demo-s', 'ws/demo-s', 'claude', 'u-demo-s']);
    expect(trace).toEqual(['registry', 'project', 'hook', 'verdict']);
  });
  it('the run row is the fallback for a workspace and branch the registry row does not carry', async () => {
    const d = await decideDispatch(resume([], { workspaceNull: true }));
    expect(d.kind === 'go' ? [d.plan.workspace, d.plan.branch] : null).toEqual(['run-ws', 'run-br']);
  });
  it('an unlistable registry refuses before any other read', async () => {
    const trace: Trace = [];
    expect(outcomeOf(await decideDispatch(resume(trace, { registry: { listed: false } as unknown as RegistryRead })))).toEqual(unmeasurable);
    expect(trace).toEqual(['registry']);
  });
  it('HONEST STALE: a session absent from a LISTABLE registry is its own arm, answered status-unmeasurable, reading nothing more', async () => {
    const trace: Trace = [];
    const d = await decideDispatch(resume(trace, { registry: { listed: true, records: [], refused: new Set() } as unknown as RegistryRead }));
    expect(d).toEqual({ kind: 'stale', outcome: { ok: false, kind: 'refused', code: 'status-unmeasurable' } });
    expect(trace).toEqual(['registry']);
  });
  it('a row whose identity is unmeasured refuses before the project field is read', async () => {
    const trace: Trace = [];
    const registry = { listed: true, records: [rec('demo-s', { unmeasured: ['uuid'] })], refused: new Set() } as unknown as RegistryRead;
    expect(outcomeOf(await decideDispatch(resume(trace, { registry })))).toEqual(unmeasurable);
    expect(trace).toEqual(['registry']);
  });
  it('gate order: project field (unreadable, then mismatch) ahead of the hook state', async () => {
    const trace: Trace = [];
    expect(outcomeOf(await decideDispatch(resume(trace, { project: { ok: false, reason: 'unreadable' } as never })))).toEqual(unmeasurable);
    expect(trace).toEqual(['registry', 'project']);
    expect(outcomeOf(await decideDispatch(resume([], { project: { ok: true, content: 'other' }, hook: { ok: false, reason: 'unmeasured' } as never }))))
      .toEqual({ ok: false, kind: 'refused', code: 'project-mismatch', by: 'other' });
    // absent or empty compares nothing
    expect((await decideDispatch(resume([], { project: { ok: true, content: '' } }))).kind).toBe('go');
    expect((await decideDispatch(resume([], { project: { ok: false, reason: 'absent' } as never }))).kind).toBe('go');
  });
  it('gate order: hook unmeasured, then hook not done, then the live verdict', async () => {
    const trace: Trace = [];
    expect(outcomeOf(await decideDispatch(resume(trace, { hook: { ok: false, reason: 'unmeasured' } as never, verdicts: ['busy'] }))))
      .toEqual({ ok: false, kind: 'refused', code: 'hookstate-unmeasurable' });
    expect(trace).not.toContain('verdict');
    const t2: Trace = [];
    expect(outcomeOf(await decideDispatch(resume(t2, { hook: { ok: true, state: { state: 'working' } } as never, verdicts: ['unmeasured'] }))))
      .toEqual({ ok: false, kind: 'refused', code: 'worker-busy' });
    expect(t2).not.toContain('verdict');
  });
  it('the live verdict: busy refuses; unmeasured is worker-starting after an ensure that started the pane, else status-unmeasurable', async () => {
    expect(outcomeOf(await decideDispatch(resume([], { verdicts: ['busy'] })))).toEqual({ ok: false, kind: 'refused', code: 'worker-busy' });
    const starting = await decideDispatch(resume([], { verdicts: ['unmeasured'], ensureStarted: true }));
    expect(starting.kind === 'refused' ? starting.outcome : null).toMatchObject({ ok: false, kind: 'worker-starting', poll: { uuid: 'u-demo-s' } });
    expect(outcomeOf(await decideDispatch(resume([], { verdicts: ['unmeasured'], ensureStarted: false }))))
      .toEqual({ ok: false, kind: 'refused', code: 'status-unmeasurable' });
  });
  void identity;
});

describe('decideDispatch, the act step (the injection decision)', () => {
  const gate = { record: rec('demo-s'), uuid: 'u-demo-s' };
  const act = (over: Partial<ActFacts>, trace: string[] = [], verdict: 'idle' | 'busy' | 'unmeasured' = 'idle'): ActFacts =>
    ({ step: 'act', resumed: true, liveGate: gate, turnVerdict: async () => { trace.push('verdict'); return verdict; }, ...over });

  it('a fresh spawn types nothing and reads nothing', async () => {
    const trace: string[] = [];
    expect(await decideDispatch(act({ resumed: false, liveGate: null }, trace))).toEqual({ kind: 'go', plan: { clear: false } });
    expect(trace).toEqual([]);
  });
  it('a resumed worker whose verdict still reads idle at the act is cleared', async () => {
    const trace: string[] = [];
    expect(await decideDispatch(act({}, trace))).toEqual({ kind: 'go', plan: { clear: true } });
    expect(trace).toEqual(['verdict']);
  });
  it('a verdict that turned busy, or unreadable, between the gate and the act is STALE, never a clear', async () => {
    expect(await decideDispatch(act({}, [], 'busy')))
      .toEqual({ kind: 'stale', outcome: { ok: false, kind: 'refused', code: 'worker-busy' } });
    expect(await decideDispatch(act({}, [], 'unmeasured')))
      .toEqual({ kind: 'stale', outcome: { ok: false, kind: 'refused', code: 'status-unmeasurable' } });
  });
});

describe('the acceptance pins (ARCH-22)', () => {
  const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  const BASELINE_DISPATCH_RUN_CODE_LINES = 229;   // measured on origin/main before this change

  it('dispatch.ts has no runtime import of inject/send.js, and the ARCH-04 exemption for that edge is gone', () => {
    const src = read('server/src/coord/dispatch.ts');
    const runtimeImports = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)';/gm)].map((m) => m[1]!);
    expect(runtimeImports.filter((p) => /inject\/send\.js$/.test(p))).toEqual([]);
    expect(src).not.toMatch(/\bsendPrompt\b\s*\(/);
    expect(read('server/test/rings/outward-edges.data.ts')).not.toMatch(/coord\/dispatch\.ts -> server\/src\/inject\/send\.ts/);
  });

  it('the decider has the named stale arm, and both switches over the arms are exhaustive', () => {
    const decider = read('server/src/coord/dispatchDecide.ts');
    expect(decider).toMatch(/kind: 'stale'/);
    expect(decider).toMatch(/default: return f satisfies never;/);
    expect(sourceOfSymbol('server/src/coord/dispatch.ts', 'stopped')).toMatch(/case 'stale':/);
    expect(sourceOfSymbol('server/src/coord/dispatch.ts', 'stopped')).toMatch(/return d satisfies never;/);
  });

  it('dispatchRun lost at least 40% of its code lines', () => {
    const now = codeLines('dispatch.ts', sourceOfSymbol('server/src/coord/dispatch.ts', 'dispatchRun'));
    expect(now).toBeLessThanOrEqual(Math.floor(BASELINE_DISPATCH_RUN_CODE_LINES * 0.6));
  });

  it('dispatchRun only acts: it decides through decideDispatch at each step and imports no gate predicate', () => {
    const run = sourceOfSymbol('server/src/coord/dispatch.ts', 'dispatchRun');
    for (const step of ['request', 'admit', 'act']) expect(run).toContain(`step: '${step}'`);
    expect(run).not.toMatch(/\bisRegistryId\b|\btransitionsFor\b|\bparseRouteFields\b|\bholdReasonVerdict\b/);
  });
});
