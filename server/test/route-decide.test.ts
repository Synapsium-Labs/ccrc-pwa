// ARCH-20 (GitHub #546): `POST /api/runs/:id/route`'s decision, as a pure L1
// decider (`coord/route.ts`'s `decideRoute`). The HTTP behaviour is pinned by
// `run-route-route.test.ts` and `run-route-order.test.ts`; this file drives the
// decider with no server, so the fold, the S5-R17 override and the ceiling each
// have a unit row that a deleted or reordered line turns red. The lazy-read
// rows count the lookups, because the inline handler read nothing it did not
// need and the decider keeps that.
import { describe, it, expect } from 'vitest';
import {
  decideRoute, foldRouteTrail, parseRouteRequest,
  type RegistryRead, type RouteAsk, type RouteFacts, type RouteTrailEvent,
} from '../src/coord/route.js';
import { RUN_ROUTE_REFUSE_CODES } from '../../shared/api.js';
import { parsedFile } from './scan/symbols.js';
import { stripTs } from './growthCheck.js';

const SID = 'lane-a-1';
const ok = (content: string): RegistryRead => ({ ok: true, content });
const worker = (how: RouteAsk['how'], target: RouteAsk['target'] = 'worker'): RouteAsk => ({ target, why: 'because', how });
const ev = (detail: string | null, at = 1, runId = 1, runSessionId: string | null = SID): RouteTrailEvent =>
  ({ at, runId, runSessionId, detail });

interface Spy { facts: RouteFacts; reads: string[]; trails: string[] }
function facts(ask: RouteAsk, over: {
  run?: RouteFacts['run']; can?: boolean; trail?: readonly RouteTrailEvent[]; trailRead?: ReturnType<RouteFacts['trail']>;
  reg?: Partial<Record<'class' | 'effort' | 'degraded', RegistryRead>>;
} = {}): Spy {
  const reads: string[] = []; const trails: string[] = [];
  const reg = { class: ok('opus'), effort: ok('high'), degraded: { ok: false, reason: 'absent' } as RegistryRead, ...over.reg };
  return {
    reads, trails,
    facts: {
      ask,
      run: over.run ?? { ok: true, run: { state: 'working', sessionId: SID, claimedBy: 'coord-1' } },
      ccdCanRoute: over.can ?? true,
      trail: (sid) => { trails.push(sid); return over.trailRead ?? { ok: true, events: over.trail ?? [] }; },
      measure: async (_sid, field) => { reads.push(field); return reg[field]; },
    },
  };
}
const demoteEv = (field: string, from: string, to: string, at = 1) => ev(`route:demote:${field}:${from}->${to}:manual:${SID}`, at);
const moveOf = async (s: Spy) => {
  const d = await decideRoute(s.facts);
  if (!d.ok) throw new Error(`refused ${d.refused}`);
  return d.move;
};

describe('parseRouteRequest', () => {
  const good = { target: 'worker', why: 'x', kind: 'shallow' };
  it('accepts each of the three ways to ask', () => {
    expect(parseRouteRequest(7, good)).toEqual({ ok: true, id: 7, ask: { target: 'worker', why: 'x', how: { by: 'kind', kind: 'shallow' } } });
    expect(parseRouteRequest(7, { target: 'coordinator', why: 'x', demote: 'class' })).toMatchObject({ ok: true, ask: { how: { by: 'demote', field: 'class' } } });
    expect(parseRouteRequest(7, { target: 'worker', why: 'x', field: 'effort', value: 'low' })).toMatchObject({ ok: true, ask: { how: { by: 'manual', field: 'effort', value: 'low' } } });
  });
  it.each([
    ['id', null, good, 'id must be a positive safe integer'],
    ['target', 7, { ...good, target: 'x' }, 'target must be "worker" or "coordinator"'],
    ['why type', 7, { ...good, why: 3 }, 'why must be a string'],
    ['why empty', 7, { ...good, why: '' }, 'why must be 1..400 bytes with no control characters'],
    ['why control', 7, { ...good, why: 'a\nb' }, 'why must be 1..400 bytes with no control characters'],
    ['why long', 7, { ...good, why: 'é'.repeat(201) }, 'why must be 1..400 bytes with no control characters'],
    ['two hows', 7, { ...good, demote: 'class' }, 'exactly one of kind, demote, or field+value is required'],
    ['no how', 7, { target: 'worker', why: 'x' }, 'exactly one of kind, demote, or field+value is required'],
    ['kind', 7, { ...good, kind: 'nope' }, 'kind must be one of shallow/ceiling/unclear'],
    ['demote', 7, { target: 'worker', why: 'x', demote: 'subagent' }, 'demote must be "class" or "effort"'],
    ['field only', 7, { target: 'worker', why: 'x', field: 'effort' }, 'field/value invalid: effort must be a non-empty string'],
  ])('refuses a bad %s', (_n, id, body, detail) => {
    const r = parseRouteRequest(id, body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain(detail.split(':')[0]);
  });
  it('treats a missing body as empty', () => {
    expect(parseRouteRequest(7, undefined)).toMatchObject({ ok: false, detail: 'target must be "worker" or "coordinator"' });
  });
});

describe('decideRoute: the run and the session', () => {
  it('run-unreadable carries the store detail', async () => {
    const s = facts(worker({ by: 'kind', kind: 'shallow' }), { run: { ok: false, detail: 'disk' } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'run-unreadable', extra: { detail: 'disk' } });
  });
  it('unknown-run', async () => {
    const s = facts(worker({ by: 'kind', kind: 'shallow' }), { run: { ok: true, run: null } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'unknown-run', extra: {} });
  });
  it.each(['done', 'failed'] as const)('run-closed on a %s run', async (state) => {
    const s = facts(worker({ by: 'kind', kind: 'shallow' }), { run: { ok: true, run: { state, sessionId: SID, claimedBy: 'c' } } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'run-closed', extra: { detail: `run is ${state}` } });
  });
  it.each(['unknown', 'merging', 'planned', 'closing'] as const)('a %s run is routable', async (state) => {
    const s = facts(worker({ by: 'kind', kind: 'shallow' }), { run: { ok: true, run: { state, sessionId: SID, claimedBy: 'c' } } });
    expect((await decideRoute(s.facts)).ok).toBe(true);
  });
  it('picks the worker for target worker and the claimant for coordinator', async () => {
    const run = { ok: true as const, run: { state: 'working' as const, sessionId: 'w-1', claimedBy: 'c-1' } };
    expect((await moveOf(facts(worker({ by: 'kind', kind: 'shallow' }), { run }))).sid).toBe('w-1');
    expect((await moveOf(facts(worker({ by: 'kind', kind: 'shallow' }, 'coordinator'), { run }))).sid).toBe('c-1');
  });
  it.each([null, ''])('no-session on %j', async (sessionId) => {
    const s = facts(worker({ by: 'kind', kind: 'shallow' }), { run: { ok: true, run: { state: 'working', sessionId, claimedBy: 'c' } } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'no-session', extra: {} });
  });
  it('bad-session on a stored id that is not a registry id', async () => {
    const s = facts(worker({ by: 'kind', kind: 'shallow' }), { run: { ok: true, run: { state: 'working', sessionId: '--actor', claimedBy: 'c' } } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'bad-session', extra: {} });
  });
  it('unsupported when ccd has no route capability, before any read', async () => {
    const s = facts(worker({ by: 'kind', kind: 'shallow' }), { can: false });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'unsupported', extra: {} });
    expect(s.reads).toEqual([]); expect(s.trails).toEqual([]);
  });
});

describe('decideRoute: a manual write', () => {
  it('forwards field and value, from "?", and reads nothing', async () => {
    const s = facts(worker({ by: 'manual', field: 'effort', value: 'low' }));
    expect(await decideRoute(s.facts)).toEqual({ ok: true, move: {
      sid: SID, mode: 'manual', field: 'effort', from: '?', to: 'low', kind: null, effortReset: null } });
    expect(s.reads).toEqual([]); expect(s.trails).toEqual([]);
  });
});

describe('decideRoute: the registry reads', () => {
  const ask = worker({ by: 'kind', kind: 'shallow' });
  it('no-record naming class on an absent .class, before .effort is read', async () => {
    const s = facts(ask, { reg: { class: { ok: false, reason: 'absent' } } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'no-record', extra: { field: 'class' } });
    expect(s.reads).toEqual(['class']);
  });
  it('registry-unreadable naming class on an unreadable .class', async () => {
    const s = facts(ask, { reg: { class: { ok: false, reason: 'unreadable' } } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'registry-unreadable', extra: { file: 'class' } });
  });
  it('an absent .effort is auto (S5-R18), an unreadable one is refused', async () => {
    const a = await moveOf(facts(ask, { reg: { effort: { ok: false, reason: 'absent' } } }));
    expect(a).toMatchObject({ field: 'effort', from: 'auto', to: 'xhigh' });
    const u = facts(ask, { reg: { effort: { ok: false, reason: 'unreadable' } } });
    expect(await decideRoute(u.facts)).toEqual({ ok: false, refused: 'registry-unreadable', extra: { file: 'effort' } });
  });
  it('an unreadable .degraded is refused', async () => {
    const s = facts(ask, { reg: { degraded: { ok: false, reason: 'unreadable' } } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'registry-unreadable', extra: { file: 'degraded' } });
  });
  it('the unreadable refusals come before the vocabulary refusals', async () => {
    const s = facts(ask, { reg: { class: ok('default'), effort: { ok: false, reason: 'unreadable' } } });
    expect(await decideRoute(s.facts)).toMatchObject({ refused: 'registry-unreadable', extra: { file: 'effort' } });
  });
  it.each([
    ['class', { class: ok('default') }],
    ['effort', { effort: ok('bogus') }],
    ['degraded', { degraded: ok('bogus') }],
  ] as const)('unrouteable-record naming %s, in that order', async (field, reg) => {
    const d = await decideRoute(facts(ask, { reg }).facts);
    expect(d).toMatchObject({ ok: false, refused: 'unrouteable-record', extra: { field } });
    if (!d.ok) expect(d.extra.detail).toContain('is not a rung of the ladder (a record, not a rung)');
  });
  it('a blank .degraded is no degrade', async () => {
    expect((await decideRoute(facts(ask, { reg: { degraded: ok('') } }).facts)).ok).toBe(true);
  });
  it('an ultracode effort is a rung the ladder answers for', async () => {
    const d = await decideRoute(facts(ask, { reg: { effort: ok('ultracode') } }).facts);
    expect(d).toMatchObject({ ok: false, refused: 'no-effort-rungs' });
  });
});

describe('foldRouteTrail (S5-R2, S5-R5)', () => {
  const fold = (events: RouteTrailEvent[], kind: 'shallow' | null = null) => foldRouteTrail(events, SID, kind);
  it('a demote stands until a reversal clears it', () => {
    expect(fold([demoteEv('effort', 'high', 'medium')]).lastDemotion).toEqual({ field: 'effort', from: 'high', to: 'medium' });
    expect(fold([demoteEv('effort', 'high', 'medium'), ev(`route:reverse-demotion:effort:medium->high:shallow:${SID}`, 2)]).lastDemotion).toBeNull();
  });
  it('a later demote wins over an earlier one', () => {
    expect(fold([demoteEv('effort', 'high', 'medium'), demoteEv('class', 'opus', 'sonnet', 2)]).lastDemotion).toMatchObject({ field: 'class' });
  });
  it('a manual write on the demoted field clears it; on another field it does not', () => {
    const manual = (field: string, at: number) => ev(`route:manual:${field}:?->max:manual:${SID}`, at);
    expect(fold([demoteEv('effort', 'high', 'medium'), manual('effort', 2)]).lastDemotion).toBeNull();
    expect(fold([demoteEv('effort', 'high', 'medium'), manual('class', 2)]).lastDemotion).not.toBeNull();
  });
  it('events replay by at, then run id, whatever order they arrive in', () => {
    const late = demoteEv('effort', 'high', 'medium', 5);
    const early = ev(`route:reverse-demotion:effort:medium->high:shallow:${SID}`, 2, 1);
    expect(fold([late, early]).lastDemotion).not.toBeNull();
    const a = ev(`route:demote:effort:high->medium:manual:${SID}`, 3, 2);
    const b = ev(`route:reverse-demotion:effort:medium->high:shallow:${SID}`, 3, 1);
    expect(fold([a, b]).lastDemotion).not.toBeNull();
    expect(fold([b, a]).lastDemotion).not.toBeNull();
  });
  it('counts prior escalations of the asked kind only', () => {
    const esc = (kind: string, at: number) => ev(`route:escalate:effort:high->xhigh:${kind}:${SID}`, at);
    expect(fold([esc('shallow', 1), esc('ceiling', 2), esc('shallow', 3)], 'shallow').priorSameKind).toBe(2);
    expect(fold([esc('shallow', 1)], null).priorSameKind).toBe(0);
  });
  it('a six-segment event counts for the session it names, a five-segment one for its run\'s worker', () => {
    const other = ev('route:demote:effort:high->medium:manual:lane-b-9');
    expect(fold([other]).lastDemotion).toBeNull();
    const five = ev('route:demote:effort:high->medium:manual', 1, 1, SID);
    expect(fold([five]).lastDemotion).not.toBeNull();
    expect(fold([ev('route:demote:effort:high->medium:manual', 1, 1, 'lane-b-9')]).lastDemotion).toBeNull();
  });
  it('skips unparseable and null details', () => {
    expect(fold([ev(null), ev('junk'), demoteEv('effort', 'high', 'medium', 3)]).lastDemotion).not.toBeNull();
  });
});

describe('decideRoute: the ladder, S5-R17 and the ceiling', () => {
  const kind = (k: 'shallow' | 'ceiling' | 'unclear' = 'shallow') => worker({ by: 'kind', kind: k });
  it('a kind escalates the measured rung and records no reset on an effort rung', async () => {
    expect(await moveOf(facts(kind()))).toEqual({
      sid: SID, mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null });
  });
  it('a class rung carries the companion effort reset', async () => {
    const m = await moveOf(facts(kind('ceiling'), { reg: { class: ok('sonnet'), effort: ok('xhigh') } }));
    expect(m).toMatchObject({ field: 'class', from: 'sonnet', to: 'opus', effortReset: 'high' });
  });
  it('demote walks down and names the demote mode', async () => {
    const m = await moveOf(facts(worker({ by: 'demote', field: 'effort' })));
    expect(m).toMatchObject({ mode: 'demote', field: 'effort', from: 'high', to: 'medium', kind: null, effortReset: null });
  });
  it('the ladder refusals carry the ladder\'s own why', async () => {
    const f = await decideRoute(facts(worker({ by: 'demote', field: 'effort' }), { reg: { effort: ok('low') } }).facts);
    expect(f).toEqual({ ok: false, refused: 'floor', extra: { detail: 'low is the mechanical floor for effort' } });
  });
  it('a standing demotion is reversed first', async () => {
    const m = await moveOf(facts(kind(), { reg: { effort: ok('medium') }, trail: [demoteEv('effort', 'high', 'medium')] }));
    expect(m).toMatchObject({ mode: 'reverse-demotion', field: 'effort', from: 'medium', to: 'high' });
  });
  it('S5-R17: a reversal whose from is not the measured value is replaced by a plain escalation', async () => {
    const m = await moveOf(facts(kind(), { reg: { effort: ok('low') }, trail: [demoteEv('effort', 'high', 'medium')] }));
    expect(m).toMatchObject({ mode: 'escalate', field: 'effort', from: 'low', to: 'medium' });
  });
  it('S5-R17 runs before the ladder refusals: the replaced escalation can refuse', async () => {
    const d = await decideRoute(facts(kind(), { reg: { effort: ok('ultracode') }, trail: [demoteEv('effort', 'high', 'medium')] }).facts);
    expect(d).toMatchObject({ ok: false, refused: 'no-effort-rungs' });
  });
  it('S5-R17 runs before the ladder: the replaced effort escalation from max is refused by the ladder\'s own ceiling', async () => {
    const d = await decideRoute(facts(kind(), {
      reg: { class: ok('opus'), effort: ok('max'), degraded: ok('sonnet') }, trail: [demoteEv('effort', 'high', 'medium')],
    }).facts);
    expect(d).toMatchObject({ ok: false, refused: 'ceiling' });
  });
  it('S5-R17 runs before the degraded-ceiling guard: the replaced class escalation is judged against the lane, not the stale reversal', async () => {
    // The record intends opus, the lane serves haiku (degraded), and the standing demotion opus->sonnet disagrees with
    // the measured haiku, so S5-R17 replaces its reversal (which would re-intend opus) with the move haiku->sonnet.
    // The guard must judge that replacement; run on the stale reversal it would refuse 'ceiling'.
    const m = await moveOf(facts(kind('ceiling'), {
      reg: { class: ok('opus'), effort: ok('high'), degraded: ok('haiku') }, trail: [demoteEv('class', 'opus', 'sonnet')],
    }));
    expect(m).toMatchObject({ mode: 'escalate', field: 'class', from: 'haiku', to: 'sonnet' });
  });
  it('S5-R17 applies to a kind ask only, never to a demote', async () => {
    const m = await moveOf(facts(worker({ by: 'demote', field: 'effort' }), { reg: { effort: ok('high') }, trail: [demoteEv('effort', 'high', 'medium')] }));
    expect(m.mode).toBe('demote');
  });
  it('the escalation after S5-R17 sees the same prior-same-kind count', async () => {
    const esc = ev(`route:escalate:effort:medium->high:shallow:${SID}`, 1);
    const m = await moveOf(facts(kind(), { reg: { effort: ok('low') }, trail: [esc, demoteEv('effort', 'high', 'medium', 2)] }));
    expect(m.mode).toBe('escalate');
    expect(m).toMatchObject({ from: 'low' });
  });
  it('an unreadable trail refuses runs-unreadable, decided here and not in the handler (ARCH-62, #797)', async () => {
    const s = facts(kind(), { trailRead: { ok: false, detail: 'runsTouching: id out of range' } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'runs-unreadable', extra: { detail: 'runsTouching: id out of range' } });
  });
  it('the trail is read for a ladder ask and for no other', async () => {
    const s = facts(kind()); await decideRoute(s.facts);
    expect(s.trails).toEqual([SID]);
  });
  it('the ceiling: a degraded record already intends the class the ladder computed', async () => {
    const s = facts(kind('ceiling'), { reg: { class: ok('opus'), effort: ok('high'), degraded: ok('sonnet') } });
    expect(await decideRoute(s.facts)).toEqual({ ok: false, refused: 'ceiling', extra: {
      detail: 'the record already intends opus; the lane serves sonnet (degraded)' } });
  });
  it('the ceiling guard is for a class rung to the raw class only', async () => {
    const effort = await moveOf(facts(kind(), { reg: { class: ok('opus'), effort: ok('high'), degraded: ok('sonnet') } }));
    expect(effort.field).toBe('effort');
    const higher = await moveOf(facts(kind('ceiling'), { reg: { class: ok('fable'), effort: ok('high'), degraded: ok('sonnet') } }));
    expect(higher).toMatchObject({ field: 'class', to: 'opus' });
  });
  it('D-6790: a stale fable->opus class demotion (session moved to sonnet out of band) runs the plain ladder', async () => {
    const m = await moveOf(facts(kind(), { reg: { class: ok('sonnet'), effort: ok('high') }, trail: [demoteEv('class', 'fable', 'opus')] }));
    expect(m).toMatchObject({ mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh' });
  });
  it('D-6790: a live fable->opus demotion is not restored and does not freeze the effort ladder', async () => {
    const m = await moveOf(facts(kind(), { reg: { class: ok('opus'), effort: ok('high') }, trail: [demoteEv('class', 'fable', 'opus')] }));
    expect(m).toMatchObject({ mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh' });
  });
  it('a degraded lane is laddered from the served class, not the intended one', async () => {
    const m = await moveOf(facts(kind('ceiling'), { reg: { class: ok('fable'), degraded: ok('haiku'), effort: ok('auto') } }));
    expect(m).toMatchObject({ from: 'haiku', to: 'sonnet' });
  });
});

describe('the refusal vocabulary', () => {
  it('every refusal the decider can answer is typed', async () => {
    const asked = new Set<string>();
    const ask = worker({ by: 'kind', kind: 'shallow' });
    const cases = [
      facts(ask, { run: { ok: false, detail: 'x' } }), facts(ask, { run: { ok: true, run: null } }),
      facts(ask, { run: { ok: true, run: { state: 'done', sessionId: SID, claimedBy: 'c' } } }),
      facts(ask, { run: { ok: true, run: { state: 'working', sessionId: null, claimedBy: 'c' } } }),
      facts(ask, { run: { ok: true, run: { state: 'working', sessionId: '-x', claimedBy: 'c' } } }),
      facts(ask, { can: false }), facts(ask, { reg: { class: { ok: false, reason: 'absent' } } }),
      facts(ask, { reg: { class: ok('default') } }), facts(ask, { reg: { effort: { ok: false, reason: 'unreadable' } } }),
      facts(ask, { reg: { effort: ok('ultracode') } }),
      facts(worker({ by: 'demote', field: 'effort' }), { reg: { effort: ok('low') } }),
      facts(worker({ by: 'kind', kind: 'ceiling' }), { reg: { class: ok('opus'), degraded: ok('sonnet') } }),
      facts(worker({ by: 'manual', field: 'class', value: 'fable' })),
    ];
    for (const c of cases) { const d = await decideRoute(c.facts); if (!d.ok) asked.add(d.refused); }
    const extra = new Set(['run-unreadable', 'unknown-run', 'unsupported']);
    for (const w of asked) expect(extra.has(w) || (RUN_ROUTE_REFUSE_CODES as readonly string[]).includes(w), w).toBe(true);
    for (const w of RUN_ROUTE_REFUSE_CODES) expect(asked.has(w), w).toBe(true);
  });
});

// ARCH-20's acceptance 1: the handler is at most 60 lines with at most 5 ifs,
// and it decides nothing. Measured on the registration call by its path literal
// (the handler is an anonymous arrow, so the call is the symbol the parser
// keys), comments stripped for the `if` count so a comment cannot hide or
// spend one.
describe('the route handler stays a thin delivery (ARCH-20 acceptance)', () => {
  const call = () => {
    const file = parsedFile('server/src/coord/routes.ts');
    const hits = file.calls.filter((c) => c.callee === 'app.post' && c.args[0]?.text === '/api/runs/:id/route');
    expect(hits.length).toBe(1);
    return file.text.slice(hits[0]!.start, hits[0]!.end);
  };
  it('is at most 60 lines', () => {
    expect(call().split('\n').length).toBeLessThanOrEqual(60);
  });
  it('holds at most 5 ifs', () => {
    expect((stripTs(call()).match(/\bif\s*\(/g) ?? []).length).toBeLessThanOrEqual(5);
  });
  it('calls the decider and holds no ladder, fold or registry-vocabulary logic', () => {
    const src = call();
    expect(src).toContain('decideRoute(');
    for (const needle of ['escalate(', 'demote(', 'lastDemotion', 'CLASSES', 'parseRouteEventDetail', 'isRegistryId']) {
      expect(src, needle).not.toContain(needle);
    }
  });
});
