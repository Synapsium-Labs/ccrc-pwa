// Overlord W1, portfolio (plan w1-portfolio.md, Task 1 Step 2): the cases over `portfolioOrder`, `itemWaitMs` and
// `portfolioFor`, each over hand-built facts. `portfolio.test.ts` runs them against the real module and
// `sim/portfolioSets.ts` against each mutant, so one list of cases is both the suite and the mutation floor's judge.
import { expect } from 'vitest';
import type {
  PortfolioAsk, PortfolioFacts, PortfolioItem, PortfolioProgramme, PortfolioRun, RankRow, ServiceClass,
} from '../../shared/portfolio.js';
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

export const ALL_PORTFOLIO_CASES: PortfolioCase[] = [
  ...ORDER_CASES, ...LIST_CASES, ...WAVE_CASES, ...CYCLE_CASES, ...ENDING_CASES, ...ITEM_CASES, ...ASK_CASES, ...BLOCKING_CASES,
  ...PURITY_CASES,
];
