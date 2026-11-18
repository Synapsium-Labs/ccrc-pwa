// Overlord W1, portfolio (plan w1-portfolio.md, Task 1 Step 2): the cases over `portfolioOrder`, `itemWaitMs` and
// `portfolioFor`, each over hand-built facts. `portfolio.test.ts` runs them against the real module and
// `sim/portfolioSets.ts` against each mutant, so one list of cases is both the suite and the mutation floor's judge.
import { expect } from 'vitest';
import type {
  LiveSpendReading, PortfolioAsk, PortfolioFacts, PortfolioItem, PortfolioProgramme, PortfolioRun, PortfolioW2Facts, RankRow, ServiceClass,
} from '../../shared/portfolio.js';
import type { Forecast, HealthRow, ProgrammeEdge, RunSpendRow, SealedForecast } from '../../shared/programmeFacts.js';
import type * as Portfolio from '../src/coord/portfolio.js';

export type PortfolioModule = Pick<typeof Portfolio, 'portfolioOrder' | 'itemWaitMs' | 'portfolioFor'>;

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const NOW = 1_790_000_000_000;

export const prog = (slug: string, createdAt = NOW - 100 * DAY): PortfolioProgramme => ({ slug, title: `Title of ${slug}`, createdAt });
export const rank = (program: string, cls: ServiceClass | string, position: number, fixedDate: string | null = null): RankRow => ({
  program, position, cls: (['expedite', 'fixed-date', 'standard', 'background'].includes(cls) ? cls : null) as ServiceClass | null,
  clsRaw: cls, fixedDate, setAt: NOW - DAY, setBy: 'op-a',
});
let nextId = 1;
export const run = (o: Partial<PortfolioRun> & { program?: string }): PortfolioRun => ({
  id: o.id ?? nextId++, program: o.program ?? 'prog-a', wave: o.wave ?? 1, kind: o.kind ?? 'work', reviews: o.reviews ?? null,
  state: o.state ?? 'working', openedAt: o.openedAt ?? NOW - 20 * DAY,
  dispatchedAt: o.dispatchedAt === undefined ? NOW - 20 * DAY : o.dispatchedAt,
  closedAt: o.closedAt === undefined ? (o.state === 'done' || o.state === 'failed' ? NOW - HOUR : null) : o.closedAt,
  closeDetail: o.closeDetail ?? null, ...(o.rebuilt === true ? { rebuilt: true as const } : {}),
});
export const item = (o: Partial<PortfolioItem>): PortfolioItem => ({
  id: o.id ?? nextId++, program: o.program ?? 'prog-a', title: o.title ?? 'an item', neededBy: o.neededBy ?? 'soon',
  state: o.state ?? 'open', raisedAt: o.raisedAt ?? NOW - 10 * HOUR, heldUntil: o.heldUntil ?? null, tickedAt: o.tickedAt ?? null,
  closedAt: o.closedAt ?? null, events: o.events ?? [],
});
export const ask = (o: Partial<PortfolioAsk>): PortfolioAsk => ({
  id: o.id ?? nextId++, program: o.program ?? 'prog-a', state: o.state ?? 'released', releasedAt: o.releasedAt === undefined ? NOW - 5 * HOUR : o.releasedAt,
  answeredAt: o.answeredAt ?? null, answeredBy: o.answeredBy ?? null, live: o.live === undefined ? null : o.live,
});
export const facts = (o: Partial<PortfolioFacts>): PortfolioFacts => ({
  programmes: o.programmes ?? [prog('prog-a')], ranks: o.ranks ?? [], revision: o.revision ?? 0,
  runs: o.runs ?? [run({})], items: o.items ?? [], asks: o.asks ?? [],
});

export interface PortfolioCase { name: string; run: (m: PortfolioModule) => void }

const entry = (m: PortfolioModule, f: PortfolioFacts, slug = 'prog-a') => {
  const e = m.portfolioFor(f, NOW).programmes.find((p) => p.slug === slug);
  if (e === undefined) throw new Error(`no entry for ${slug}`);
  return e;
};
const waitOf = (m: PortfolioModule, items: PortfolioItem[], asks: PortfolioAsk[] = []) => entry(m, facts({ items, asks }));
const ev = (act: string, at: number) => ({ act, at });

export const ORDER_CASES: PortfolioCase[] = [
  { name: 'two ranked standard programmes and one unranked come out ranked, ranked, unranked', run: (m) => {
    const ps = [prog('prog-u', NOW - 300 * DAY), prog('prog-b'), prog('prog-a')];
    expect(m.portfolioOrder([rank('prog-b', 'standard', 2), rank('prog-a', 'standard', 1)], ps)).toEqual(['prog-a', 'prog-b', 'prog-u']);
  } },
  { name: 'an expedite row at position 9 comes before a standard row at position 1', run: (m) => {
    const ps = [prog('prog-s'), prog('prog-e')];
    expect(m.portfolioOrder([rank('prog-s', 'standard', 1), rank('prog-e', 'expedite', 9)], ps)).toEqual(['prog-e', 'prog-s']);
  } },
  { name: 'fixed-date comes between expedite and standard', run: (m) => {
    const ps = [prog('prog-s'), prog('prog-f'), prog('prog-e')];
    const r = [rank('prog-s', 'standard', 1), rank('prog-f', 'fixed-date', 1, '2026-12-01'), rank('prog-e', 'expedite', 1)];
    expect(m.portfolioOrder(r, ps)).toEqual(['prog-e', 'prog-f', 'prog-s']);
  } },
  { name: 'two unranked programmes come oldest first, and on equal createdAt by slug', run: (m) => {
    const ps = [prog('prog-z', NOW - 2 * DAY), prog('prog-y', NOW - 5 * DAY), prog('prog-b', NOW - 2 * DAY)];
    expect(m.portfolioOrder([], ps)).toEqual(['prog-y', 'prog-b', 'prog-z']);
  } },
  { name: 'a background row comes after every unranked programme', run: (m) => {
    const ps = [prog('prog-bg'), prog('prog-u')];
    expect(m.portfolioOrder([rank('prog-bg', 'background', 1)], ps)).toEqual(['prog-u', 'prog-bg']);
  } },
  { name: 'a rank row for a programme not listed is ignored', run: (m) => {
    expect(m.portfolioOrder([rank('prog-gone', 'expedite', 1)], [prog('prog-a')])).toEqual(['prog-a']);
  } },
  { name: 'an unreadable class reads unranked, with rankUnreadable', run: (m) => {
    const f = facts({ programmes: [prog('prog-a'), prog('prog-b', NOW - 300 * DAY)], ranks: [rank('prog-a', 'urgent', 1)],
      runs: [run({ program: 'prog-a' }), run({ program: 'prog-b' })] });
    const v = m.portfolioFor(f, NOW);
    expect(v.programmes.map((p) => p.slug)).toEqual(['prog-b', 'prog-a']);
    const a = v.programmes[1]!;
    expect(a.rank).toBeNull();
    expect(a.cls).toBe('standard');
    expect(a.rankUnreadable).toBe(true);
    expect(v.programmes[0]!.rankUnreadable).toBeUndefined();
  } },
  { name: 'a ranked entry carries its rank and class', run: (m) => {
    const e = entry(m, facts({ ranks: [rank('prog-a', 'fixed-date', 3, '2026-12-01')] }));
    expect(e.rank).toEqual({ position: 3, cls: 'fixed-date', fixedDate: '2026-12-01' });
    expect(e.cls).toBe('fixed-date');
  } },
];

export const LIST_CASES: PortfolioCase[] = [
  { name: 'a ranked programme whose run closed exactly 28 days ago is still listed', run: (m) => {
    const edge = [run({ state: 'done', closedAt: NOW - 28 * DAY })];
    expect(m.portfolioFor(facts({ runs: edge, ranks: [rank('prog-a', 'standard', 1)] }), NOW).programmes.map((p) => p.slug))
      .toEqual(['prog-a']);
  } },
  { name: 'only closed runs older than the window: listed neither unranked nor ranked; ranked with a recent close it is', run: (m) => {
    const old = [run({ state: 'done', closedAt: NOW - 30 * DAY })];
    expect(m.portfolioFor(facts({ runs: old }), NOW).programmes).toEqual([]);
    expect(m.portfolioFor(facts({ runs: old, ranks: [rank('prog-a', 'standard', 1)] }), NOW).programmes).toEqual([]);
    const recent = [run({ state: 'done', closedAt: NOW - 3 * DAY })];
    expect(m.portfolioFor(facts({ runs: recent, ranks: [rank('prog-a', 'standard', 1)] }), NOW).programmes.map((p) => p.slug))
      .toEqual(['prog-a']);
    expect(m.portfolioFor(facts({ runs: recent }), NOW).programmes).toEqual([]);
  } },
  { name: 'an open review run lists its programme', run: (m) => {
    const v = m.portfolioFor(facts({ runs: [run({ state: 'done', closedAt: NOW - 40 * DAY }), run({ kind: 'review', state: 'working' })] }), NOW);
    expect(v.programmes.map((p) => p.slug)).toEqual(['prog-a']);
  } },
  { name: 'the view carries the revision and the time', run: (m) => {
    const v = m.portfolioFor(facts({ revision: 7 }), NOW);
    expect(v.revision).toBe(7);
    expect(v.at).toBe(NOW);
  } },
];

export const WAVE_CASES: PortfolioCase[] = [
  { name: 'a newer planned run with an older working one counts the wave queued', run: (m) => {
    const e = entry(m, facts({ runs: [run({ id: 1, state: 'working' }), run({ id: 2, state: 'planned', dispatchedAt: null })] }));
    expect(e.wip).toEqual({ working: 0, waiting: 0, queued: 1 });
  } },
  { name: 'an older working run with a newer failed one counts the wave working', run: (m) => {
    const e = entry(m, facts({ runs: [run({ id: 1, state: 'working' }), run({ id: 2, state: 'failed' })] }));
    expect(e.wip).toEqual({ working: 1, waiting: 0, queued: 0 });
    expect(e.closedWaves).toEqual({ days7: 0, days28: 0 });
  } },
  { name: 'a review run never counts as a wave, nor a run of kind unknown', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 1, state: 'awaiting-review' }), run({ wave: 2, kind: 'review', state: 'working' }),
      run({ wave: 3, kind: 'unknown', state: 'working' })] }));
    expect(e.wip).toEqual({ working: 0, waiting: 1, queued: 0 });
  } },
  { name: 'a state outside RUN_STATES buckets working', run: (m) => {
    expect(entry(m, facts({ runs: [run({ state: 'teleporting' })] })).wip).toEqual({ working: 1, waiting: 0, queued: 0 });
  } },
  { name: 'closed waves count in 7 and 28 days by their close', run: (m) => {
    const e = entry(m, facts({ runs: [run({ state: 'working', wave: 9 }), run({ wave: 1, state: 'done', closedAt: NOW - 2 * DAY }),
      run({ wave: 2, state: 'failed', closedAt: NOW - 10 * DAY }), run({ wave: 3, state: 'done', closedAt: NOW - 29 * DAY })] }));
    expect(e.closedWaves).toEqual({ days7: 1, days28: 2 });
  } },
  { name: 'a wave closed exactly 7 days ago counts in both; one exactly 28 days ago in days28 only', run: (m) => {
    const e = entry(m, facts({ runs: [run({ state: 'working', wave: 9 }), run({ wave: 1, state: 'done', closedAt: NOW - 7 * DAY }),
      run({ wave: 2, state: 'done', closedAt: NOW - 28 * DAY })] }));
    expect(e.closedWaves).toEqual({ days7: 1, days28: 2 });
    expect(e.ended28.done).toBe(2);
  } },
  { name: 'the oldest started open wave is aged from its earliest dispatch', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 1, state: 'working', dispatchedAt: NOW - 5 * HOUR }),
      run({ wave: 2, state: 'awaiting-review', dispatchedAt: NOW - 9 * HOUR }), run({ wave: 3, state: 'planned', dispatchedAt: null })] }));
    expect(e.oldestOpenMs).toBe(9 * HOUR);
  } },
  { name: 'no started open wave reads null, never 0', run: (m) => {
    expect(entry(m, facts({ runs: [run({ state: 'planned', dispatchedAt: null })] })).oldestOpenMs).toBeNull();
  } },
  { name: 'F10: a dispatch stamped after now (clock skew) ages the wave 0, never negative', run: (m) => {
    const e = entry(m, facts({ runs: [run({ state: 'working', dispatchedAt: NOW + HOUR })] }));
    expect(e.oldestOpenMs).toBe(0);
    expect(e.oldestOpenUnmeasured).toBe(0);
  } },
  { name: 'F10: a rebuilt open wave is never aged from the rebuild\'s stand-in; it counts in oldestOpenUnmeasured', run: (m) => {
    const rebuiltOnly = entry(m, facts({ runs: [run({ wave: 1, state: 'working', dispatchedAt: NOW - HOUR, rebuilt: true })] }));
    expect(rebuiltOnly.oldestOpenMs).toBeNull();
    expect(rebuiltOnly.oldestOpenUnmeasured).toBe(1);
    const both = entry(m, facts({ runs: [run({ wave: 1, state: 'working', dispatchedAt: NOW - HOUR, rebuilt: true }),
      run({ wave: 2, state: 'awaiting-review', dispatchedAt: NOW - 3 * HOUR })] }));
    expect(both.oldestOpenMs).toBe(3 * HOUR);
    expect(both.oldestOpenUnmeasured).toBe(1);
  } },
];

const doneWave = (wave: number, hours: number, o: Partial<PortfolioRun> = {}) =>
  run({ wave, state: 'done', closedAt: NOW - DAY, dispatchedAt: NOW - DAY - hours * HOUR, ...o });

export const CYCLE_CASES: PortfolioCase[] = [
  { name: 'done waves of 2, 4 and 10 hours give a median of 4 and a p85 of 10, with n 3', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 9 }), doneWave(1, 2), doneWave(2, 4), doneWave(3, 10)] }));
    expect(e.cycle).toEqual({ n: 3, medianMs: 4 * HOUR, p85Ms: 10 * HOUR });
    expect(e.cycleUnmeasured).toBe(0);
  } },
  { name: 'no done wave gives n 0 and both null, never 0', run: (m) => {
    expect(entry(m, facts({ runs: [run({})] })).cycle).toEqual({ n: 0, medianMs: null, p85Ms: null });
  } },
  { name: 'a done wave with no dispatch is left out of n and counts in cycleUnmeasured', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 9 }), doneWave(1, 2), doneWave(2, 0, { dispatchedAt: null })] }));
    expect(e.cycle.n).toBe(1);
    expect(e.cycleUnmeasured).toBe(1);
  } },
  { name: 'F10: a close stamped before its dispatch (clock skew) is a cycle of 0, never negative', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 9 }), doneWave(1, -2)] }));
    expect(e.cycle).toEqual({ n: 1, medianMs: 0, p85Ms: 0 });
  } },
  { name: 'F10: a done wave whose dispatch a rebuild stood in for is left out of n and counts in cycleUnmeasured', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 9 }), doneWave(1, 2), doneWave(2, 1, { rebuilt: true })] }));
    expect(e.cycle).toEqual({ n: 1, medianMs: 2 * HOUR, p85Ms: 2 * HOUR });
    expect(e.cycleUnmeasured).toBe(1);
  } },
  { name: 'the cycle starts at the wave\'s earliest dispatch across its work runs', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 9 }), run({ id: 50, wave: 1, state: 'failed', dispatchedAt: NOW - DAY - 8 * HOUR }),
      doneWave(1, 3, { id: 51 })] }));
    expect(e.cycle).toEqual({ n: 1, medianMs: 8 * HOUR, p85Ms: 8 * HOUR });
  } },
  { name: 'review rounds count review runs over done waves, with the done-wave count', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 9 }), doneWave(1, 2, { id: 60 }), doneWave(2, 2, { id: 61 }),
      run({ kind: 'review', wave: 1, reviews: 60, state: 'done' }), run({ kind: 'review', wave: 1, reviews: 60, state: 'done' }),
      run({ kind: 'review', wave: 9, reviews: 999, state: 'done' })] }));
    expect(e.reviewRounds).toEqual({ rounds: 2, waves: 2 });
  } },
];

export const ENDING_CASES: PortfolioCase[] = [
  { name: 'a never-started failed wave counts in failed and neverStarted; one 29 days ago counts in neither', run: (m) => {
    const e = entry(m, facts({ runs: [run({ wave: 9 }),
      run({ wave: 1, state: 'failed', closedAt: NOW - 2 * DAY, closeDetail: 'abandon:never-started' }),
      run({ wave: 2, state: 'failed', closedAt: NOW - 29 * DAY, closeDetail: 'abandon:never-started' }),
      run({ wave: 3, state: 'done', closedAt: NOW - 2 * DAY }), run({ wave: 4, state: 'failed', closedAt: NOW - 2 * DAY })] }));
    expect(e.ended28).toEqual({ done: 1, failed: 2, neverStarted: 1 });
  } },
];

export const ITEM_CASES: PortfolioCase[] = [
  { name: 'an item held until t1 and ticked at t2 adds t2 - t1', run: (m) => {
    const i = item({ raisedAt: NOW - 10 * HOUR, heldUntil: NOW - 8 * HOUR, state: 'checking', tickedAt: NOW - 5 * HOUR,
      events: [ev('raise', NOW - 10 * HOUR), ev('tick', NOW - 5 * HOUR)] });
    expect(m.itemWaitMs(i, NOW - 28 * DAY, NOW)).toBe(3 * HOUR);
    expect(waitOf(m, [i]).waitingOnOperatorMs28).toBe(3 * HOUR);
  } },
  { name: 'ticked, returned, ticked again and confirmed adds its two open spans, never its checking time', run: (m) => {
    const i = item({ raisedAt: NOW - 10 * HOUR, state: 'done', closedAt: NOW - HOUR, events: [ev('raise', NOW - 10 * HOUR),
      ev('tick', NOW - 9 * HOUR), ev('return', NOW - 6 * HOUR), ev('tick', NOW - 4 * HOUR), ev('confirm', NOW - HOUR)] });
    expect(m.itemWaitMs(i, NOW - 28 * DAY, NOW)).toBe(3 * HOUR);
  } },
  { name: 'an open item adds up to now; one raised 40 days ago adds 28 days, clipped', run: (m) => {
    expect(m.itemWaitMs(item({ raisedAt: NOW - 6 * HOUR }), NOW - 28 * DAY, NOW)).toBe(6 * HOUR);
    expect(m.itemWaitMs(item({ raisedAt: NOW - 40 * DAY }), NOW - 28 * DAY, NOW)).toBe(28 * DAY);
    expect(waitOf(m, [item({ raisedAt: NOW - 40 * DAY })]).waitingOnOperatorMs28).toBe(28 * DAY);
  } },
  { name: 'an item closed inside its hold adds nothing', run: (m) => {
    const i = item({ raisedAt: NOW - 10 * HOUR, heldUntil: NOW - 5 * HOUR, state: 'done', closedAt: NOW - 7 * HOUR,
      events: [ev('raise', NOW - 10 * HOUR), ev('settle', NOW - 7 * HOUR)] });
    expect(m.itemWaitMs(i, NOW - 28 * DAY, NOW)).toBe(0);
  } },
  { name: 'a held item not yet shown adds nothing', run: (m) => {
    expect(m.itemWaitMs(item({ raisedAt: NOW - 2 * HOUR, heldUntil: NOW + HOUR }), NOW - 28 * DAY, NOW)).toBe(0);
  } },
  { name: 'two items waiting at once add twice', run: (m) => {
    expect(waitOf(m, [item({ raisedAt: NOW - 2 * HOUR }), item({ raisedAt: NOW - 2 * HOUR })]).waitingOnOperatorMs28).toBe(4 * HOUR);
  } },
  { name: 'an item with an unknown event act adds nothing and counts in itemsUnmeasured', run: (m) => {
    const i = item({ raisedAt: NOW - 2 * HOUR, events: [ev('raise', NOW - 2 * HOUR), ev('teleport', NOW - HOUR)] });
    expect(m.itemWaitMs(i, NOW - 28 * DAY, NOW)).toBe('unmeasured');
    const e = waitOf(m, [i, item({ raisedAt: NOW - HOUR })]);
    expect(e.itemsUnmeasured).toBe(1);
    expect(e.waitingOnOperatorMs28).toBe(HOUR);
  } },
  { name: 'block and unblock do not move the item', run: (m) => {
    const i = item({ raisedAt: NOW - 4 * HOUR, events: [ev('raise', NOW - 4 * HOUR), ev('block', NOW - 3 * HOUR), ev('unblock', NOW - 2 * HOUR)] });
    expect(m.itemWaitMs(i, NOW - 28 * DAY, NOW)).toBe(4 * HOUR);
  } },
];

const askWait = (m: PortfolioModule, a: PortfolioAsk) => {
  const e = waitOf(m, [], [a]);
  return { ms: e.waitingOnOperatorMs28, unmeasured: e.asksUnmeasured };
};

export const ASK_CASES: PortfolioCase[] = [
  { name: 'released and answered by the operator adds its span', run: (m) => {
    expect(askWait(m, ask({ state: 'answered', releasedAt: NOW - 5 * HOUR, answeredAt: NOW - 2 * HOUR, answeredBy: 'operator' })))
      .toEqual({ ms: 3 * HOUR, unmeasured: 0 });
  } },
  { name: 'released and answered late by the parent adds nothing', run: (m) => {
    expect(askWait(m, ask({ state: 'answered', releasedAt: NOW - 5 * HOUR, answeredAt: NOW - 2 * HOUR, answeredBy: 'lane-a-project-a' })))
      .toEqual({ ms: 0, unmeasured: 0 });
  } },
  { name: 'released and live adds up to now', run: (m) => {
    expect(askWait(m, ask({ state: 'released', releasedAt: NOW - 5 * HOUR, live: true }))).toEqual({ ms: 5 * HOUR, unmeasured: 0 });
  } },
  { name: 'released and not live adds nothing and counts in asksUnmeasured', run: (m) => {
    expect(askWait(m, ask({ state: 'released', live: false }))).toEqual({ ms: 0, unmeasured: 1 });
  } },
  { name: 'released with live unmeasured does the same', run: (m) => {
    expect(askWait(m, ask({ state: 'released', live: 'unmeasured' }))).toEqual({ ms: 0, unmeasured: 1 });
  } },
  { name: 'declined and live adds up to now, from its releasedAt', run: (m) => {
    expect(askWait(m, ask({ state: 'declined', releasedAt: NOW - 2 * HOUR, live: true }))).toEqual({ ms: 2 * HOUR, unmeasured: 0 });
  } },
  { name: 'declined and not live counts unmeasured', run: (m) => {
    expect(askWait(m, ask({ state: 'declined', live: false }))).toEqual({ ms: 0, unmeasured: 1 });
  } },
  { name: 'an ask answered from held (no releasedAt) adds nothing', run: (m) => {
    expect(askWait(m, ask({ state: 'answered', releasedAt: null, answeredAt: NOW - HOUR, answeredBy: 'operator' })))
      .toEqual({ ms: 0, unmeasured: 0 });
  } },
  { name: 'a stale ask adds nothing and is not in asksUnmeasured', run: (m) => {
    expect(askWait(m, ask({ state: 'stale', releasedAt: NOW - HOUR }))).toEqual({ ms: 0, unmeasured: 0 });
  } },
  { name: 'an operator answer from a release 40 days ago is clipped to the window', run: (m) => {
    expect(askWait(m, ask({ state: 'answered', releasedAt: NOW - 40 * DAY, answeredAt: NOW - 27 * DAY, answeredBy: 'operator' })))
      .toEqual({ ms: DAY, unmeasured: 0 });
  } },
  { name: 'a live ask released 40 days ago adds only the window', run: (m) => {
    expect(askWait(m, ask({ state: 'released', releasedAt: NOW - 40 * DAY, live: true }))).toEqual({ ms: 28 * DAY, unmeasured: 0 });
  } },
  // answering-or-unknown-ask-is-unmeasured, one case per arm.
  { name: 'an answering ask with a releasedAt adds nothing and counts in asksUnmeasured', run: (m) => {
    expect(askWait(m, ask({ state: 'answering', releasedAt: NOW - 3 * HOUR }))).toEqual({ ms: 0, unmeasured: 1 });
  } },
  { name: 'an ask in a state this build does not know, with a releasedAt, counts in asksUnmeasured', run: (m) => {
    expect(askWait(m, ask({ state: 'pondering', releasedAt: NOW - 3 * HOUR }))).toEqual({ ms: 0, unmeasured: 1 });
  } },
  { name: 'an operator answer with no answeredAt counts in asksUnmeasured', run: (m) => {
    expect(askWait(m, ask({ state: 'answered', releasedAt: NOW - 3 * HOUR, answeredAt: null, answeredBy: 'operator' })))
      .toEqual({ ms: 0, unmeasured: 1 });
  } },
  // asks-unmeasured-is-windowed: over the last 28 days.
  { name: 'a released or declined ask shown not live, released before the window, is not counted', run: (m) => {
    expect(askWait(m, ask({ state: 'released', releasedAt: NOW - 29 * DAY, live: false }))).toEqual({ ms: 0, unmeasured: 0 });
    expect(askWait(m, ask({ state: 'released', releasedAt: NOW - 29 * DAY, live: null }))).toEqual({ ms: 0, unmeasured: 0 });
    expect(askWait(m, ask({ state: 'declined', releasedAt: NOW - 29 * DAY, live: false }))).toEqual({ ms: 0, unmeasured: 0 });
  } },
  { name: 'one released exactly at the window start, not live, still counts in asksUnmeasured', run: (m) => {
    expect(askWait(m, ask({ state: 'released', releasedAt: NOW - 28 * DAY, live: false }))).toEqual({ ms: 0, unmeasured: 1 });
  } },
  { name: 'one released before the window whose live signal is unmeasured still counts', run: (m) => {
    expect(askWait(m, ask({ state: 'released', releasedAt: NOW - 29 * DAY, live: 'unmeasured' }))).toEqual({ ms: 0, unmeasured: 1 });
  } },
];

export const BLOCKING_CASES: PortfolioCase[] = [
  { name: 'blocking lists an open shown blocking item; not a held, checking or closed one', run: (m) => {
    const e = waitOf(m, [
      item({ id: 101, title: 'shown', neededBy: 'blocking' }),
      item({ id: 102, neededBy: 'blocking', heldUntil: NOW + HOUR }),
      item({ id: 103, neededBy: 'blocking', state: 'checking' }),
      item({ id: 104, neededBy: 'blocking', state: 'done', closedAt: NOW - HOUR }),
      item({ id: 105, neededBy: 'soon' }),
    ]);
    expect(e.blocking.items).toEqual([{ id: 101, title: 'shown' }]);
  } },
  { name: 'a live released ask counts in blocking.asks, and one not live does not', run: (m) => {
    const e = waitOf(m, [], [ask({ live: true }), ask({ live: false }), ask({ live: 'unmeasured' })]);
    expect(e.blocking.asks).toBe(1);
  } },
];

export const PURITY_CASES: PortfolioCase[] = [
  { name: 'no clock: the same input twice gives deep-equal output', run: (m) => {
    const f = facts({ runs: [run({ id: 1 }), doneWave(2, 3, { id: 2 })], items: [item({ id: 3 })], asks: [ask({ id: 4, live: true })] });
    expect(m.portfolioFor(f, NOW)).toEqual(m.portfolioFor(f, NOW));
  } },
];

// ── Overlord W2, forecasts B (plan w2-forecasts-health.md, Task 8): the W2 measures over hand-built `w2` facts ──────────

const w2 = (o: Partial<PortfolioW2Facts> = {}): PortfolioW2Facts => ({
  seals: [], scored: [], health: [], edges: [], edgeRuns: [], newestDated: [], spend: [], live: [], statements: [], lastMoves: [], ...o,
});
const seal = (id: number, forecast: Forecast | 'unreadable', o: Partial<SealedForecast> = {}): SealedForecast => ({
  id, program: 'prog-a', closingRunId: 500 + id, sealedAt: NOW - 3 * DAY + id, asOf: NOW - 3 * DAY, statementId: null, lo: 1, hi: 2,
  forecast, outcome: 'open', scoredAt: null, ...o,
});
const dated = (p85At: number, n = 20): Forecast => ({ kind: 'forecast', medianAt: p85At - DAY, p85At, n, source: 'own', seed: 4 });
const scoredSeal = (id: number, outcome: 'met' | 'missed', scoredAt: number): SealedForecast =>
  seal(id, dated(scoredAt - DAY), { outcome, scoredAt });
const healthRow = (word: HealthRow['word'], at = NOW - HOUR): HealthRow =>
  ({ id: 1, program: 'prog-a', at, word, evidence: { matched: word === 'steady' ? null : `${word}:arm`, values: { x: 1 }, unmeasured: [] } });
const edge = (id: number, o: Partial<ProgrammeEdge> = {}): ProgrammeEdge => ({
  id, program: 'prog-a', kind: 'needs-landed', target: { predicate: 'run-closed', runId: 900 }, why: 'needs it', state: 'open',
  openedAt: NOW - DAY, openedBy: 'lane-a-project-a', endedAt: null, evidence: null, unmeasuredSince: null, ...o,
});
const spendRow = (runId: number, state: RunSpendRow['state'], cost: number | null, cls: string | null = 'opus'): RunSpendRow =>
  ({ runId, at: NOW - HOUR, state, cost, class: cls, readAt: NOW - HOUR });
const reading = (cost: number | null, o: { stale?: boolean; cls?: string | null } = {}): LiveSpendReading =>
  ({ kind: 'reading', cost, class: o.cls === undefined ? 'opus' : o.cls, stale: o.stale === true });
const SPEND_ZERO = { total: 0, byClass: {}, perWaveMedian: null, wavesMeasured: 0, wavesUnmeasured: 0, runsUnmeasured: 0,
  attributed: true, coordinatorExcluded: true, classAtClose: true };
const w2entry = (m: PortfolioModule, f: Partial<PortfolioFacts>, w: Partial<PortfolioW2Facts>) => entry(m, { ...facts(f), w2: w2(w) });

export const W2_CASES: PortfolioCase[] = [
  { name: 'W2 characterization: facts with empty w2 lists gain exactly edges, spend and criticalPath, and no health and no forecast', run: (m) => {
    const f = facts({ runs: [run({ id: 1, wave: 1 }), run({ id: 2, wave: 2, state: 'done' })] });
    const w1 = entry(m, f);
    for (const k of ['health', 'forecast', 'edges', 'spend', 'criticalPath']) expect(k in w1).toBe(false);
    expect(m.portfolioFor(f, NOW).calibration).toBeUndefined();
    const e = entry(m, { ...f, w2: w2() });
    expect(e).toStrictEqual({
      ...w1,
      edges: { list: [], clearingShipped: false },
      // The closed run has no row: unmeasured, never 0. The open run was dispatched and has no session, so no reading
      // speaks for it: unmeasured too.
      spend: { ...SPEND_ZERO, wavesUnmeasured: 1, runsUnmeasured: 2 },
      criticalPath: { chain: ['prog-a'], latestP85At: null, unmeasured: ['prog-a'], cut: false },
    });
    expect('health' in e).toBe(false);
    expect('forecast' in e).toBe(false);
    // A dispatched open run with no session is unmeasured; one never dispatched has spent nothing and is not counted.
    expect(entry(m, { ...facts({ runs: [run({ id: 1 })] }), w2: w2() }).spend).toEqual({ ...SPEND_ZERO, runsUnmeasured: 1 });
    expect(entry(m, { ...facts({ runs: [run({ id: 1, state: 'planned', dispatchedAt: null })] }), w2: w2() }).spend).toEqual(SPEND_ZERO);
    // A live reading of a run outside the spend kinds is not this programme's spend.
    expect(entry(m, { ...facts({ runs: [run({ id: 1, kind: 'unknown' })] }), w2: w2({ live: [{ runId: 1, sessionId: 'sess-a', reading: reading(5) }] }) }).spend)
      .toEqual(SPEND_ZERO);
    // A closed run outside the spend kinds is never recorded, so its missing row is not unmeasured spend.
    expect(entry(m, { ...facts({ runs: [run({ id: 1, kind: 'unknown', state: 'done' }), run({ id: 2, wave: 2, state: 'planned', dispatchedAt: null })] }), w2: w2() }).spend).toMatchObject({ runsUnmeasured: 0, total: 0 });
  } },

  // ── the forecast ──
  { name: 'an entry carries the newest seal\'s dates, n, source, seal time and outcome', run: (m) => {
    const old = seal(1, dated(NOW + 3 * DAY, 11));
    const newest = seal(2, dated(NOW + 9 * DAY, 23), { sealedAt: NOW - 2 * HOUR });
    const e = w2entry(m, {}, { seals: [old, newest] });
    expect(e.forecast).toStrictEqual({ kind: 'forecast', medianAt: NOW + 8 * DAY, p85At: NOW + 9 * DAY, n: 23, source: 'own', sealedAt: NOW - 2 * HOUR, outcome: 'open' });
    expect(w2entry(m, {}, { seals: [old, { ...newest, outcome: 'met', scoredAt: NOW }] }).forecast).toMatchObject({ outcome: 'met' });
  } },
  { name: 'an unforecastable newest seal carries its reason and no date, and is never pending (F9)', run: (m) => {
    const e = w2entry(m, {}, { seals: [seal(1, dated(NOW + DAY)), seal(2, { kind: 'unforecastable', reason: 'no-remaining' }, { sealedAt: NOW - HOUR })] });
    expect(e.forecast).toStrictEqual({ kind: 'unforecastable', reason: 'no-remaining', sealedAt: NOW - HOUR });
  } },
  { name: 'an unreadable newest seal is carried as unreadable, not dropped and not the older one', run: (m) => {
    const e = w2entry(m, {}, { seals: [seal(1, dated(NOW + DAY)), seal(2, 'unreadable', { outcome: 'unreadable', sealedAt: NOW - HOUR })] });
    expect(e.forecast).toStrictEqual({ kind: 'unreadable', sealedAt: NOW - HOUR });
  } },
  { name: 'a seal of another programme is not this entry\'s', run: (m) => {
    expect(w2entry(m, {}, { seals: [seal(1, dated(NOW + DAY), { program: 'prog-b' })] }).forecast).toBeUndefined();
  } },

  // ── calibration ──
  { name: 'the view\'s calibration reads unmeasured with fewer than 8 scored seals per cut, and measured with 8', run: (m) => {
    const seven = Array.from({ length: 7 }, (_, i) => scoredSeal(i + 1, 'met', NOW - 25 * DAY + i));
    const read = (scored: SealedForecast[]) => m.portfolioFor({ ...facts({}), w2: w2({ scored }) }, NOW).calibration!;
    const few = read(seven);
    expect(few.state).toBe('unmeasured');
    expect(few.cuts).toHaveLength(4);
    expect(few.cuts.map((c) => [c.n, c.share])).toEqual([[7, null], [7, null], [7, null], [7, null]]);
    expect(read([]).cuts.map((c) => c.n)).toEqual([0, 0, 0, 0]);
    // Eight seals scored 25 days ago lie inside all four cuts' windows: 7 met of 8 is inside the band.
    const eight = [...seven, scoredSeal(8, 'missed', NOW - 25 * DAY + 8)];
    expect(read(eight)).toMatchObject({ state: 'calibrated', cuts: [{ n: 8, met: 7, share: 7 / 8 }, { n: 8 }, { n: 8 }, { n: 8 }] });
    // All eight met is a share of 1, outside the band on every cut.
    expect(read([...seven, scoredSeal(8, 'met', NOW - 25 * DAY + 8)]).state).toBe('uncalibrated');
  } },
  { name: 'an open or unreadable seal in the scored list is never read as scored', run: (m) => {
    const scored = Array.from({ length: 8 }, (_, i) => scoredSeal(i + 1, 'met', NOW - 25 * DAY + i));
    const noise = [seal(20, dated(NOW), { outcome: 'open' }), seal(21, dated(NOW), { outcome: 'unreadable', scoredAt: NOW - DAY })];
    expect(m.portfolioFor({ ...facts({}), w2: w2({ scored: [...scored, ...noise] }) }, NOW).calibration!.cuts[0]).toMatchObject({ n: 8 });
  } },

  // ── health: shown, never computed (F7) ──
  { name: 'the entry\'s health is the newest programme_health row, even when the facts would now give another word (F7)', run: (m) => {
    const blocked = { items: [item({ id: 61, neededBy: 'blocking' })] };
    const f = facts({ ...blocked, runs: [run({ id: 1 })] });
    // The facts say blocked-on-you now; the lane recorded `steady` an hour ago, and that is what the entry shows.
    expect(entry(m, f).blocking.items).toHaveLength(1);
    const e = entry(m, { ...f, w2: w2({ health: [healthRow('steady')] }) });
    expect(e.health).toStrictEqual({ word: 'steady', evidence: { matched: null, values: { x: 1 }, unmeasured: [] }, at: NOW - HOUR });
    expect(entry(m, { ...f, w2: w2({ health: [healthRow('stalled', NOW - 2 * HOUR)] }) }).health).toMatchObject({ word: 'stalled', at: NOW - 2 * HOUR });
  } },
  { name: 'a health row this build cannot read is carried as unreadable; another programme\'s row is not this entry\'s', run: (m) => {
    const row: HealthRow = { id: 2, program: 'prog-a', at: NOW - HOUR, word: 'unreadable', evidence: 'unreadable' };
    expect(w2entry(m, {}, { health: [row] }).health).toStrictEqual({ word: 'unreadable', evidence: 'unreadable', at: NOW - HOUR });
    expect(w2entry(m, {}, { health: [{ ...healthRow('steady'), program: 'prog-b' }] }).health).toBeUndefined();
  } },

  // ── edges (F1) ──
  { name: 'a target-ended and a target-unmeasurable edge are listed, and do not block nor enter the critical path', run: (m) => {
    const without = w2entry(m, {}, {});
    const edges = [edge(1, { state: 'target-ended', endedAt: NOW - HOUR }), edge(2, { state: 'target-unmeasurable', unmeasuredSince: NOW - HOUR })];
    const e = w2entry(m, {}, { edges, edgeRuns: [{ runId: 900, program: 'prog-b' }], newestDated: [{ program: 'prog-b', p85At: NOW + DAY }] });
    expect(e.edges).toEqual({ list: edges, clearingShipped: false });
    expect(e.blocking).toEqual(without.blocking);
    expect(e.criticalPath).toEqual(without.criticalPath);
    expect(e.criticalPath!.chain).toEqual(['prog-a']);
  } },
  { name: 'with clearing not shipped, every edge is listed as such and none enters the critical path (F1)', run: (m) => {
    const open = edge(1);
    const decision = edge(2, { kind: 'needs-decision', target: { predicate: 'operator-confirms', itemId: 7 } });
    const other = edge(3, { program: 'prog-b' });
    const e = w2entry(m, {}, { edges: [open, decision, other], edgeRuns: [{ runId: 900, program: 'prog-b' }], newestDated: [{ program: 'prog-b', p85At: NOW + 5 * DAY }] });
    expect(e.edges).toEqual({ list: [open, decision], clearingShipped: false });
    expect(e.criticalPath).toEqual({ chain: ['prog-a'], latestP85At: null, unmeasured: ['prog-a'], cut: false });
    expect(e.blocking).toEqual({ items: [], asks: 0 });
  } },
  { name: 'the critical path carries the programme\'s own newest 85% date, and names a programme with none unmeasured', run: (m) => {
    const e = w2entry(m, {}, { newestDated: [{ program: 'prog-a', p85At: NOW + 4 * DAY }] });
    expect(e.criticalPath).toEqual({ chain: ['prog-a'], latestP85At: NOW + 4 * DAY, unmeasured: [], cut: false });
    expect(w2entry(m, {}, { newestDated: [{ program: 'prog-a', p85At: null }] }).criticalPath).toMatchObject({ latestP85At: null, unmeasured: ['prog-a'] });
  } },

  // ── spend ──
  { name: 'spend sums the measured rows by class, over closed work and review runs', run: (m) => {
    const runs = [run({ id: 71, wave: 1, state: 'done' }), run({ id: 72, wave: 2, state: 'done' }), run({ id: 73, wave: 2, kind: 'review', reviews: 72, state: 'done' }), run({ id: 74, wave: 3, state: 'done' })];
    const e = w2entry(m, { runs, ranks: [rank('prog-a', 'standard', 1)] }, { spend: [spendRow(71, 'measured', 3, 'opus'), spendRow(72, 'measured', 1.5, 'sonnet'), spendRow(73, 'measured', 2, 'opus'), spendRow(74, 'measured', 4, 'opus')] });
    expect(e.spend).toMatchObject({ total: 10.5, byClass: { opus: 9, sonnet: 1.5 }, runsUnmeasured: 0, wavesMeasured: 3, wavesUnmeasured: 0, perWaveMedian: 3.5 });
    expect(e.spend).toMatchObject({ attributed: true, coordinatorExcluded: true, classAtClose: true });
  } },
  { name: 'spend counts an absent, an outside, an unreadable and a missing row, and a measured row with no cost, in runsUnmeasured, never as 0', run: (m) => {
    const runs = [1, 2, 3, 4, 5, 6, 7].map((i) => run({ id: 80 + i, wave: i, state: 'done' }));
    const e = w2entry(m, { runs, ranks: [rank('prog-a', 'standard', 1)] }, { spend: [
      spendRow(81, 'measured', 2), spendRow(82, 'absent', null, null), spendRow(83, 'outside', 9), spendRow(84, 'unreadable', 9),
      spendRow(85, 'measured', null),
      // 86 has no row at all.
      spendRow(87, 'measured', 1),
    ] });
    expect(e.spend).toMatchObject({ total: 3, byClass: { opus: 3 }, runsUnmeasured: 5 });
    // Nothing measured at all: the total is 0 and every run is unmeasured, which is not the same as costing 0.
    const none = w2entry(m, { runs, ranks: [rank('prog-a', 'standard', 1)] }, { spend: [spendRow(82, 'absent', 0, null)] });
    expect(none.spend).toMatchObject({ total: 0, byClass: {}, runsUnmeasured: 7, perWaveMedian: null, wavesUnmeasured: 7 });
  } },
  { name: 'spend adds an open run\'s fresh live reading, and counts a session shared by two open runs once', run: (m) => {
    const runs = [run({ id: 91, wave: 1 }), run({ id: 92, wave: 2 })];
    const e = w2entry(m, { runs }, { live: [
      { runId: 91, sessionId: 'sess-a', reading: reading(2) }, { runId: 92, sessionId: 'sess-a', reading: reading(2) },
    ] });
    expect(e.spend).toMatchObject({ total: 2, byClass: { opus: 2 }, runsUnmeasured: 0 });
    const two = w2entry(m, { runs }, { live: [
      { runId: 91, sessionId: 'sess-a', reading: reading(2) }, { runId: 92, sessionId: 'sess-b', reading: reading(5, { cls: 'sonnet' }) },
    ] });
    expect(two.spend).toMatchObject({ total: 7, byClass: { opus: 2, sonnet: 5 }, runsUnmeasured: 0 });
  } },
  { name: 'spend leaves a stale live reading out and counts the run unmeasured; so for no reading, no cost and not-ready', run: (m) => {
    const runs = [run({ id: 101, wave: 1 }), run({ id: 102, wave: 2 }), run({ id: 103, wave: 3 }), run({ id: 104, wave: 4 })];
    const e = w2entry(m, { runs }, { live: [
      { runId: 101, sessionId: 'sess-a', reading: reading(8, { stale: true }) }, { runId: 102, sessionId: 'sess-b', reading: { kind: 'none' } },
      { runId: 103, sessionId: 'sess-c', reading: reading(null) }, { runId: 104, sessionId: 'sess-d', reading: { kind: 'not-ready' } },
    ] });
    expect(e.spend).toMatchObject({ total: 0, byClass: {}, runsUnmeasured: 4 });
  } },
  { name: 'spend adds the measured rows and the live readings together, and another programme\'s runs are not counted', run: (m) => {
    const runs = [run({ id: 111, wave: 1, state: 'done' }), run({ id: 112, wave: 2 })];
    const e = w2entry(m, { runs }, {
      spend: [spendRow(111, 'measured', 3), spendRow(999, 'measured', 1000)],
      live: [{ runId: 112, sessionId: 'sess-a', reading: reading(4) }, { runId: 998, sessionId: 'sess-z', reading: reading(1000) }],
    });
    expect(e.spend).toMatchObject({ total: 7, byClass: { opus: 7 }, runsUnmeasured: 0 });
  } },
];

export const ALL_PORTFOLIO_CASES: PortfolioCase[] = [
  ...ORDER_CASES, ...LIST_CASES, ...WAVE_CASES, ...CYCLE_CASES, ...ENDING_CASES, ...ITEM_CASES, ...ASK_CASES, ...BLOCKING_CASES,
  ...PURITY_CASES, ...W2_CASES,
];
