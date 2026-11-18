// Overlord W1, portfolio (plan w1-portfolio.md Task 2): `portfolio_rank`'s one writer, `setPortfolioRank`, and the facts
// `portfolioFor` reads, over a fixture coord.db.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { LiveAskRead } from '../src/coord/ports.js';
import type { RankOrderEntry } from '../../shared/portfolio.js';
import type { SpendUsageRead } from '../src/coord/portfolioStore.js';
import { portfolioFor } from '../src/coord/portfolio.js';
import type { Forecast, SpendReading } from '../../shared/programmeFacts.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let coord: CoordStore;
beforeEach(() => { coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-portfolio-store-'), '.ccrc', 'coord.db'))); });

const programme = (slug: string, createdAt = NOW - 50 * DAY): void => {
  coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, 'active')").run(slug, `Title of ${slug}`, createdAt);
};
const run = (program: string, state = 'working', o: { kind?: string; closedAt?: number | null } = {}): number => Number(coord.db.prepare(
  'INSERT INTO runs (program, wave, project, state, kind, openedAt, dispatchedAt, closedAt) VALUES (?, 1, ?, ?, ?, ?, ?, ?)',
).run(program, 'project-a', state, o.kind ?? 'work', NOW - 10 * DAY, NOW - 9 * DAY,
  o.closedAt === undefined ? (state === 'done' || state === 'failed' ? NOW - HOUR : null) : o.closedAt).lastInsertRowid);
const rows = () => coord.db.prepare('SELECT program, position, cls, fixedDate, setAt, setBy FROM portfolio_rank ORDER BY cls, position').all();
const revisionRow = () => coord.db.prepare('SELECT id, revision, setAt, setBy FROM portfolio_rank_revision').all();
const e = (slug: string, cls: RankOrderEntry['cls'] = 'standard', fixedDate: string | null = null): RankOrderEntry => ({ slug, cls, fixedDate });
const none: LiveAskRead = () => ({ kind: 'unmeasured' });
const noUsage: SpendUsageRead = () => ({ kind: 'none' });
const write = (basedOn: number, seen: string[], order: RankOrderEntry[], actor = 'op-a', now = NOW) =>
  coord.setPortfolioRank({ basedOn, seen, order }, actor, now);

describe('portfolio_rank and its one writer', () => {
  it('a fresh database has both tables, no rank row and no revision row, and the facts read answers revision 0', () => {
    expect(rows()).toEqual([]);
    expect(revisionRow()).toEqual([]);
    expect(coord.portfolioFacts(NOW, none, noUsage).revision).toBe(0);
  });

  it('a write based on 0 stores the order at revision 1, and a second based on 1 at revision 2', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    expect(write(0, ['prog-a', 'prog-b'], [e('prog-b'), e('prog-a')])).toEqual({ ok: true, revision: 1 });
    expect(rows()).toEqual([
      { program: 'prog-b', position: 1, cls: 'standard', fixedDate: null, setAt: NOW, setBy: 'op-a' },
      { program: 'prog-a', position: 2, cls: 'standard', fixedDate: null, setAt: NOW, setBy: 'op-a' },
    ]);
    expect(write(1, ['prog-a', 'prog-b'], [e('prog-a'), e('prog-b')])).toEqual({ ok: true, revision: 2 });
    expect(coord.portfolioFacts(NOW, none, noUsage).revision).toBe(2);
  });

  it('a stale basedOn answers rank-changed with the current revision and changes no row', () => {
    programme('prog-a');
    write(0, ['prog-a'], [e('prog-a', 'expedite')], 'op-a', NOW - HOUR);
    const before = [rows(), revisionRow()];
    expect(write(0, ['prog-a'], [e('prog-a', 'background')])).toEqual({ ok: false, why: 'rank-changed', revision: 1 });
    expect(write(5, ['prog-a'], [e('prog-a', 'background')])).toEqual({ ok: false, why: 'rank-changed', revision: 1 });
    expect([rows(), revisionRow()]).toEqual(before);
  });

  it('an unknown slug with a stale basedOn answers the unknown slug first and changes no row', () => {
    programme('prog-a');
    write(0, ['prog-a'], [e('prog-a')]);
    const before = [rows(), revisionRow()];
    expect(write(0, ['prog-a', 'prog-x'], [e('prog-x'), e('prog-a')])).toEqual({ ok: false, unknownSlug: 'prog-x' });
    expect([rows(), revisionRow()]).toEqual(before);
  });

  it('a programme listed in seen but not in order loses its row', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    write(0, ['prog-a', 'prog-b'], [e('prog-a'), e('prog-b')]);
    write(1, ['prog-a', 'prog-b'], [e('prog-b')]);
    expect(rows()).toEqual([{ program: 'prog-b', position: 1, cls: 'standard', fixedDate: null, setAt: NOW, setBy: 'op-a' }]);
  });

  it('a ranked programme absent from seen keeps its class, date and relative place, after the listed entries of its band', () => {
    for (const s of ['prog-a', 'prog-b', 'prog-c', 'prog-q']) programme(s);
    write(0, ['prog-a', 'prog-b', 'prog-q', 'prog-c'],
      [e('prog-q', 'fixed-date', '2026-12-01'), e('prog-a'), e('prog-b'), e('prog-c')], 'op-a', NOW - DAY);
    // The console now lists only prog-a and prog-c (prog-b and prog-q went quiet), and moves prog-c first.
    write(1, ['prog-a', 'prog-c'], [e('prog-c'), e('prog-a')], 'op-b', NOW);
    expect(rows()).toEqual([
      { program: 'prog-q', position: 1, cls: 'fixed-date', fixedDate: '2026-12-01', setAt: NOW - DAY, setBy: 'op-a' },
      { program: 'prog-c', position: 1, cls: 'standard', fixedDate: null, setAt: NOW, setBy: 'op-b' },
      { program: 'prog-a', position: 2, cls: 'standard', fixedDate: null, setAt: NOW, setBy: 'op-b' },
      { program: 'prog-b', position: 3, cls: 'standard', fixedDate: null, setAt: NOW - DAY, setBy: 'op-a' },
    ]);
  });

  it('a write that unranks every programme leaves the revision at its next value, so an older tab stays refused', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    write(0, ['prog-a', 'prog-b'], [e('prog-a'), e('prog-b')]);
    expect(write(1, ['prog-a', 'prog-b'], [])).toEqual({ ok: true, revision: 2 });
    expect(rows()).toEqual([]);
    expect(revisionRow()).toEqual([{ id: 1, revision: 2, setAt: NOW, setBy: 'op-a' }]);
    for (const old of [0, 1]) expect(write(old, ['prog-a'], [e('prog-a')])).toEqual({ ok: false, why: 'rank-changed', revision: 2 });
  });

  it('positions restart at 1 in each class band', () => {
    for (const s of ['prog-a', 'prog-b', 'prog-c', 'prog-d']) programme(s);
    write(0, ['prog-a', 'prog-b', 'prog-c', 'prog-d'], [e('prog-a', 'expedite'), e('prog-b'), e('prog-c', 'expedite'), e('prog-d', 'background')]);
    expect(rows().map((r) => [(r as { program: string }).program, (r as { position: number }).position])).toEqual([
      ['prog-d', 1], ['prog-a', 1], ['prog-c', 2], ['prog-b', 1],
    ]);
  });

  it('setBy and setAt are stored as given, on the rows placed and on the revision row', () => {
    programme('prog-a');
    write(0, ['prog-a'], [e('prog-a')], 'flag-off', NOW + 7);
    expect(rows()).toEqual([{ program: 'prog-a', position: 1, cls: 'standard', fixedDate: null, setAt: NOW + 7, setBy: 'flag-off' }]);
    expect(revisionRow()).toEqual([{ id: 1, revision: 1, setAt: NOW + 7, setBy: 'flag-off' }]);
  });
});

describe('the facts portfolioFor reads', () => {
  it('a class word a newer build wrote reads cls null, with clsRaw', () => {
    programme('prog-a');
    coord.db.prepare("INSERT INTO portfolio_rank (program, position, cls, fixedDate, setAt, setBy) VALUES ('prog-a', 1, 'urgent', NULL, 5, 'op-a')").run();
    expect(coord.portfolioFacts(NOW, none, noUsage).ranks).toEqual([
      { program: 'prog-a', position: 1, cls: null, clsRaw: 'urgent', fixedDate: null, setAt: 5, setBy: 'op-a' },
    ]);
  });

  it('lists a programme with an open run and no rank, a ranked one with no open run, and leaves out one with neither', () => {
    for (const s of ['prog-open', 'prog-ranked', 'prog-quiet']) programme(s);
    run('prog-open', 'working');
    run('prog-ranked', 'done');
    run('prog-quiet', 'done');
    write(0, ['prog-ranked'], [e('prog-ranked')]);
    const f = coord.portfolioFacts(NOW, none, noUsage);
    expect(f.programmes.map((p) => p.slug)).toEqual(['prog-open', 'prog-ranked']);
    expect(f.programmes[0]).toEqual({ slug: 'prog-open', title: 'Title of prog-open', createdAt: NOW - 50 * DAY });
    expect(new Set(f.runs.map((r) => r.program))).toEqual(new Set(['prog-open', 'prog-ranked']));
  });

  it('a run kind this build does not know reads unknown', () => {
    programme('prog-a');
    run('prog-a', 'working', { kind: 'audit' });
    expect(coord.portfolioFacts(NOW, none, noUsage).runs.map((r) => r.kind)).toEqual(['unknown']);
  });

  const ask = (runId: number, childId: string, state: string, askKey: string, releasedAt: number | null): number => Number(coord.db.prepare(
    "INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state, releasedAt) VALUES (?, ?, 'lane-a-parent', ?, ?, 1, 'd', 'q?', '[]', ?, ?)",
  ).run(NOW - 6 * HOUR, childId, runId, askKey, state, releasedAt).lastInsertRowid);

  it('an ask on another programme\'s run is not in this programme\'s asks', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    const ra = run('prog-a'), rb = run('prog-b');
    ask(ra, 'lane-a-child-a', 'released', 'k1', NOW - HOUR);
    ask(rb, 'lane-a-child-b', 'released', 'k2', NOW - HOUR);
    expect(coord.portfolioFacts(NOW, none, noUsage).asks.map((a) => [a.program, a.state])).toEqual([['prog-a', 'released'], ['prog-b', 'released']]);
  });

  it('the newest released ask of a child reads the live port: match true, mismatch false, unmeasured kept; an older row null', () => {
    programme('prog-a');
    const r = run('prog-a');
    const older = ask(r, 'lane-a-child', 'released', 'k-old', NOW - 3 * HOUR);
    const newest = ask(r, 'lane-a-child', 'released', 'k-new', NOW - HOUR);
    const declined = ask(r, 'lane-a-other', 'declined', 'k-d', NOW - HOUR);
    const answered = ask(r, 'lane-a-third', 'answered', 'k-a', NOW - HOUR);
    const liveOf = (port: LiveAskRead) => Object.fromEntries(coord.portfolioFacts(NOW, port, noUsage).asks.map((a) => [a.id, a.live]));
    const keys: Record<string, string | null> = { 'lane-a-child': 'k-new', 'lane-a-other': 'k-d', 'lane-a-third': 'k-a' };
    expect(liveOf((c) => ({ kind: 'read', key: keys[c] ?? null }))).toEqual({ [older]: null, [newest]: true, [declined]: true, [answered]: null });
    expect(liveOf(() => ({ kind: 'read', key: 'k-other' }))).toEqual({ [older]: null, [newest]: false, [declined]: false, [answered]: null });
    expect(liveOf(() => ({ kind: 'read', key: null }))).toEqual({ [older]: null, [newest]: false, [declined]: false, [answered]: null });
    expect(liveOf(() => ({ kind: 'unmeasured' })))
      .toEqual({ [older]: null, [newest]: 'unmeasured', [declined]: 'unmeasured', [answered]: null });
  });

  const answer = (id: number, answeredAt: number, answeredBy = 'operator'): void => {
    coord.db.prepare("UPDATE asks SET state = 'answered', answeredAt = ?, answeredBy = ? WHERE id = ?").run(answeredAt, answeredBy, id);
  };
  const entryOf = (port: LiveAskRead = none) => portfolioFor(coord.portfolioFacts(NOW, port, noUsage), NOW).programmes[0]!;
  const fetched = (port: LiveAskRead = none) => coord.portfolioFacts(NOW, port, noUsage).asks.map((a) => a.id);

  it('an ask released 29 days ago and answered by the operator yesterday is fetched, and its wait is clipped to the window', () => {
    programme('prog-a');
    const r = run('prog-a');
    const id = ask(r, 'lane-a-child', 'released', 'k1', NOW - 29 * DAY);
    answer(id, NOW - DAY);
    expect(fetched()).toEqual([id]);
    expect(entryOf()).toMatchObject({ waitingOnOperatorMs28: 27 * DAY, asksUnmeasured: 0 });
  });

  it('an ask released and answered before the window is not fetched', () => {
    programme('prog-a');
    const r = run('prog-a');
    answer(ask(r, 'lane-a-child', 'released', 'k1', NOW - 40 * DAY), NOW - 29 * DAY);
    expect(fetched()).toEqual([]);
  });

  it('an answering ask released 40 days ago is fetched and counts in asksUnmeasured', () => {
    programme('prog-a');
    const id = ask(run('prog-a'), 'lane-a-child', 'answering', 'k1', NOW - 40 * DAY);
    expect(fetched()).toEqual([id]);
    expect(entryOf()).toMatchObject({ waitingOnOperatorMs28: 0, asksUnmeasured: 1 });
  });

  it('asks-unmeasured-is-windowed: an older released ask before the window is not fetched; one inside it still counts', () => {
    programme('prog-a');
    const r = run('prog-a');
    ask(r, 'lane-a-child', 'released', 'k-old', NOW - 40 * DAY);
    ask(r, 'lane-a-child', 'declined', 'k-older', NOW - 29 * DAY);
    const inside = ask(r, 'lane-a-child', 'released', 'k-in', NOW - 2 * DAY);
    const newest = ask(r, 'lane-a-child', 'released', 'k-new', NOW - HOUR);
    const port: LiveAskRead = () => ({ kind: 'read', key: 'k-new' });
    expect(fetched(port)).toEqual([inside, newest]);
    expect(entryOf(port)).toMatchObject({ waitingOnOperatorMs28: HOUR, asksUnmeasured: 1 });
  });

  it('asks-unmeasured-is-windowed: the newest ask released before the window is fetched, and counts only while its live read is unmeasured', () => {
    programme('prog-a');
    const id = ask(run('prog-a'), 'lane-a-child', 'declined', 'k1', NOW - 29 * DAY);
    expect(fetched()).toEqual([id]);
    expect(entryOf(() => ({ kind: 'read', key: null }))).toMatchObject({ waitingOnOperatorMs28: 0, asksUnmeasured: 0 });
    expect(entryOf(() => ({ kind: 'unmeasured' }))).toMatchObject({ waitingOnOperatorMs28: 0, asksUnmeasured: 1 });
    expect(entryOf(() => ({ kind: 'read', key: 'k1' }))).toMatchObject({ waitingOnOperatorMs28: 28 * DAY, asksUnmeasured: 0 });
  });

  it('an item\'s events come back oldest first, and an item closed before the window is left out', () => {
    programme('prog-a');
    run('prog-a');
    const item = (state: string, closedAt: number | null): number => Number(coord.db.prepare(
      "INSERT INTO operator_items (program, raisedBy, kind, title, why, how, neededBy, state, raisedAt, closedAt) VALUES ('prog-a', 'coordinator', 'do', 't', 'w', '[]', 'blocking', ?, ?, ?)",
    ).run(state, NOW - 40 * DAY, closedAt).lastInsertRowid);
    const live = item('open', null);
    item('done', NOW - 30 * DAY);
    const recent = item('done', NOW - 2 * DAY);
    const ev = coord.db.prepare("INSERT INTO operator_item_events (itemId, at, act, actor) VALUES (?, ?, ?, 'operator')");
    ev.run(live, NOW - 2 * HOUR, 'tick');
    ev.run(live, NOW - 40 * DAY, 'raise');
    ev.run(live, NOW - HOUR, 'return');
    const f = coord.portfolioFacts(NOW, none, noUsage);
    expect(f.items.map((i) => i.id)).toEqual([live, recent]);
    expect(f.items[0]!.events).toEqual([{ at: NOW - 40 * DAY, act: 'raise' }, { at: NOW - 2 * HOUR, act: 'tick' }, { at: NOW - HOUR, act: 'return' }]);
  });
});

describe('a rebuilt run (review 2130 F10)', () => {
  it('a run reconstruct minted reads rebuilt, and its open wave is never aged from the rebuild; an ordinary run reads no flag', () => {
    const [rebuilt] = coord.reconstruct({
      ledger: { slug: 'prog-a', title: 'Prog A', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
      registry: { sessionId: 'lane-a-project-a', project: 'project-a', workspace: 'ws-a', branch: 'ws/a', held: 'program:prog-a wave:1/1' },
      prHistory: [],
    });
    programme('prog-b');
    const plain = run('prog-b');
    const facts = coord.portfolioFacts(NOW, none, noUsage);
    expect(facts.runs.find((r) => r.id === rebuilt!.id)).toMatchObject({ state: 'working', rebuilt: true });
    expect(facts.runs.find((r) => r.id === plain)).not.toHaveProperty('rebuilt');
    const entry = portfolioFor(facts, Date.now()).programmes.find((p) => p.slug === 'prog-a')!;
    expect(entry).toMatchObject({ oldestOpenMs: null, oldestOpenUnmeasured: 1 });
  });

  it('characterization (forecasts A, before the rule moves to shared/programmes.ts): a done rebuilt wave is cycle-unmeasured, '
    + 'and a claimed run whose dispatch equals its open is not rebuilt', () => {
    const [rebuilt] = coord.reconstruct({
      ledger: { slug: 'prog-a', title: 'Prog A', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
      registry: { sessionId: 'lane-a-project-a', project: 'project-a', workspace: 'ws-a', branch: 'ws/a', held: 'program:prog-a wave:1/1' },
      prHistory: [],
    });
    coord.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE id = ?").run(NOW - HOUR, rebuilt!.id);
    programme('prog-b');
    const claimed = Number(coord.db.prepare(
      "INSERT INTO runs (program, wave, project, state, kind, openedAt, dispatchedAt, closedAt, claimedBy) VALUES ('prog-b', 1, 'project-a', 'done', 'work', ?, ?, ?, 'lane-a-project-a')",
    ).run(NOW - 3 * DAY, NOW - 3 * DAY, NOW - HOUR).lastInsertRowid);
    coord.db.prepare("INSERT INTO runs (program, wave, project, state, kind, openedAt) VALUES ('prog-b', 2, 'project-a', 'planned', 'work', ?)").run(NOW - HOUR);
    coord.setPortfolioRank({ basedOn: 0, seen: [], order: [e('prog-a')] }, 'op-a', NOW);
    const facts = coord.portfolioFacts(NOW, none, noUsage);
    expect(facts.runs.find((r) => r.id === claimed)).not.toHaveProperty('rebuilt');
    const view = portfolioFor(facts, NOW);
    expect(view.programmes.find((p) => p.slug === 'prog-a')).toMatchObject({ cycle: { n: 0, medianMs: null, p85Ms: null }, cycleUnmeasured: 1 });
    expect(view.programmes.find((p) => p.slug === 'prog-b')).toMatchObject({ cycle: { n: 1, medianMs: 3 * DAY - HOUR }, cycleUnmeasured: 0 });
  });
});

// ── Overlord W2, forecasts B (plan w2-forecasts-health.md, Task 8): the `w2` facts the read fills ──────────────────────

describe('portfolioFacts fills w2 (forecasts B)', () => {
  const MIN = 60_000;
  interface RunOpts { wave?: number; kind?: string; state?: string; openedAt?: number; closedAt?: number | null; sessionId?: string | null }
  const mk = (program: string, o: RunOpts = {}): number => {
    const state = o.state ?? 'working';
    return Number(coord.db.prepare(
      'INSERT INTO runs (program, wave, project, state, kind, openedAt, dispatchedAt, closedAt, sessionId, claimedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(program, o.wave ?? 1, 'project-a', state, o.kind ?? 'work', o.openedAt ?? NOW - 10 * DAY, (o.openedAt ?? NOW - 10 * DAY) + MIN,
      o.closedAt === undefined ? (state === 'done' || state === 'failed' ? NOW - HOUR : null) : o.closedAt, o.sessionId ?? null, 'lane-a-project-a').lastInsertRowid);
  };
  const DATED: Forecast = { kind: 'forecast', medianAt: NOW + DAY, p85At: NOW + 2 * DAY, n: 20, source: 'own', seed: 7 };
  const sealOf = (program: string, runId: number, forecast: Forecast, at = NOW - DAY): number => {
    coord.sealForecast({ program, closingRunId: runId, asOf: at, statementId: null, lo: 1, hi: 2, forecast }, at);
    return coord.forecastsOf({ program }).find((s) => s.closingRunId === runId)!.id;
  };
  const say = (program: string, at: number, reason = 'left', runId: number | null = null, edges: Parameters<CoordStore['insertRemaining']>[3] = []): number => {
    const r = coord.insertRemaining(program, 'lane-a-project-a', { lo: 1, hi: 2, reason, runId }, edges, null, at);
    if (!r.ok) throw new Error(r.detail);
    return r.id;
  };
  const w2 = (usage: SpendUsageRead = noUsage, now = NOW) => coord.portfolioFacts(now, none, usage).w2!;

  it('a fresh database answers every list empty', () => {
    expect(coord.portfolioFacts(NOW, none, noUsage).w2).toEqual({
      seals: [], scored: [], health: [], edges: [], edgeRuns: [], newestDated: [], spend: [], live: [], statements: [], lastMoves: [],
    });
  });

  it('seals and health are the listed programmes\' alone, scored seals and newest dates are fleet-wide, scored ones bounded to 49 days', () => {
    for (const s of ['prog-a', 'prog-b', 'prog-c']) programme(s);
    mk('prog-a'); mk('prog-b');                                  // listed: an open run each; prog-c is not listed
    const a1 = mk('prog-a', { wave: 2, state: 'done' }), a2 = mk('prog-a', { wave: 3, state: 'done' });
    const c1 = mk('prog-c', { state: 'done' }), c2 = mk('prog-c', { wave: 2, state: 'done' }), c3 = mk('prog-c', { wave: 3, state: 'done' });
    const sa1 = sealOf('prog-a', a1, DATED, NOW - 3 * DAY);
    const sa2 = sealOf('prog-a', a2, { kind: 'unforecastable', reason: 'no-remaining' }, NOW - 2 * DAY);
    const sc1 = sealOf('prog-c', c1, DATED, NOW - 60 * DAY);
    const sc2 = sealOf('prog-c', c2, DATED, NOW - 50 * DAY);
    sealOf('prog-c', c3, { ...DATED, p85At: NOW + 5 * DAY }, NOW - DAY);
    coord.scoreForecast(sa1, 'met', NOW - 2 * DAY);
    coord.scoreForecast(sc1, 'missed', NOW - 50 * DAY);   // 50 days: older than the 49-day span
    coord.scoreForecast(sc2, 'met', NOW - 49 * DAY);      // exactly at the span: kept
    coord.appendHealth('prog-a', { word: 'aging', evidence: { matched: 'aging:x', values: {}, unmeasured: [] } }, false, NOW - 2 * DAY);
    coord.appendHealth('prog-a', { word: 'stalled', evidence: { matched: 'stalled:x', values: {}, unmeasured: [] } }, true, NOW - DAY);
    coord.appendHealth('prog-c', { word: 'steady', evidence: { matched: null, values: {}, unmeasured: [] } }, false, NOW - DAY);
    const f = w2();
    expect(f.seals.map((s) => s.id)).toEqual([sa1, sa2]);
    expect(f.scored.map((s) => s.id)).toEqual([sa1, sc2]);
    expect(f.health.map((h) => [h.program, h.word])).toEqual([['prog-a', 'stalled']]);
    // The newest seal of each programme with any: an unforecastable newest seal has no date.
    expect(f.newestDated).toEqual([{ program: 'prog-a', p85At: null }, { program: 'prog-c', p85At: NOW + 5 * DAY }]);
  });

  it('edges are every edge not met, fleet-wide, with each run-closed target\'s programme and the statement\'s sender', () => {
    for (const s of ['prog-a', 'prog-b', 'prog-c']) programme(s);
    mk('prog-a');
    const targetB = mk('prog-b', { state: 'done' });
    const targetC = mk('prog-c', { state: 'done' });
    say('prog-a', NOW - 3 * DAY, 'wait', null, [
      { kind: 'needs-landed', target: { predicate: 'run-closed', runId: targetB }, why: 'on b' },
      { kind: 'needs-landed', target: { predicate: 'pr-merged', runId: targetB, pr: 12 }, why: 'pr' },
      { kind: 'needs-landed', target: { predicate: 'run-closed', runId: 424242 }, why: 'a run that is gone' },
    ]);
    say('prog-c', NOW - 2 * DAY, 'wait', null, [
      { kind: 'needs-landed', target: { predicate: 'run-closed', runId: targetC }, why: 'on itself' },
      { kind: 'needs-landed', target: { predicate: 'run-closed', runId: targetB }, why: 'met later' },
    ]);
    coord.db.prepare("UPDATE programme_edges SET state = 'met' WHERE why = 'met later'").run();
    coord.db.prepare("UPDATE programme_edges SET state = 'target-ended' WHERE why = 'on itself'").run();
    const f = w2();
    expect(f.edges.map((e) => [e.program, e.why, e.state, e.openedBy])).toEqual([
      ['prog-a', 'on b', 'open', 'lane-a-project-a'], ['prog-a', 'pr', 'open', 'lane-a-project-a'],
      ['prog-a', 'a run that is gone', 'open', 'lane-a-project-a'], ['prog-c', 'on itself', 'target-ended', 'lane-a-project-a'],
    ]);
    // One entry per distinct run-closed target whose run exists; a pr-merged target and a gone run have none.
    expect(f.edgeRuns).toEqual([{ runId: targetB, program: 'prog-b' }, { runId: targetC, program: 'prog-c' }].sort((x, y) => x.runId - y.runId));
  });

  it('spend is the listed programmes\' run_spend rows alone', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    mk('prog-a');
    const a = mk('prog-a', { wave: 2, state: 'done' });
    const b = mk('prog-b', { state: 'done' });
    coord.recordRunSpend({ runId: a, state: 'measured', cost: 2.5, class: 'opus', readAt: NOW - 2 * HOUR }, NOW - HOUR);
    coord.recordRunSpend({ runId: b, state: 'measured', cost: 9, class: 'opus', readAt: NOW - 2 * HOUR }, NOW - HOUR);
    // prog-b has no open run and no rank row: not listed, so its row is not read.
    expect(w2().spend).toEqual([{ runId: a, at: NOW - HOUR, state: 'measured', cost: 2.5, class: 'opus', readAt: NOW - 2 * HOUR }]);
  });

  it('live is each open run with a session, with the usage port\'s answer and its dispatch facts; a closed run and a run with no session have none', () => {
    programme('prog-a');
    const withA = mk('prog-a', { wave: 1, sessionId: 'sess-a' });
    const withB = mk('prog-a', { wave: 2, kind: 'review', sessionId: 'sess-b' });
    mk('prog-a', { wave: 3 });
    mk('prog-a', { wave: 4, state: 'done', sessionId: 'sess-closed' });
    coord.db.prepare("UPDATE runs SET resumed = 1, clearedAt = ?, dispatchConversation = 'conv-a' WHERE id = ?").run(NOW - DAY, withA);
    const r: SpendReading = { readAt: NOW - HOUR, cost: 1.25, class: 'opus', sidecarUuid: 'conv-a', conversationUuid: 'conv-a', turn: { kind: 'read', turnAt: null, background: 0 } };
    const asked: string[] = [];
    const usage: SpendUsageRead = (id) => {
      asked.push(id);
      return id === 'sess-a' ? { kind: 'reading', ...r } : { kind: 'not-ready' };
    };
    expect(w2(usage).live).toEqual([
      { runId: withA, sessionId: 'sess-a', reading: { kind: 'reading', ...r }, redispatched: false, resumed: true, clearedAt: NOW - DAY, conversation: 'conv-a' },
      { runId: withB, sessionId: 'sess-b', reading: { kind: 'not-ready' }, redispatched: false, resumed: false, clearedAt: null, conversation: null },
    ]);
    expect(asked).toEqual(['sess-a', 'sess-b']);
  });

  it('live marks an open run whose session a later run was dispatched to (F1: the same rule the spend arm reads)', () => {
    programme('prog-a');
    const early = mk('prog-a', { wave: 1, sessionId: 'sess-a', openedAt: NOW - 3 * DAY });
    const later = mk('prog-a', { wave: 2, sessionId: 'sess-a', openedAt: NOW - DAY });
    const live = w2(() => ({ kind: 'none' })).live;
    expect(live.find((l) => l.runId === early)).toMatchObject({ redispatched: true });
    expect(live.find((l) => l.runId === later)).toMatchObject({ redispatched: false });
  });

  it('statements are the listed programmes\' in the 28-day window, masked', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    mk('prog-a');
    mk('prog-b', { state: 'done' });                                      // not listed
    say('prog-a', NOW - 29 * DAY, 'too old');
    const inside = say('prog-a', NOW - 28 * DAY, 'at the edge');
    const recent = say('prog-a', NOW - HOUR, 'left');
    say('prog-b', NOW - HOUR, 'not listed');
    expect(w2().statements.map((s) => s.id)).toEqual([inside, recent]);
  });

  it('lastMoves: the newest state change of an open work run, else its dispatch; null with no open work run; a statement never counts', () => {
    for (const s of ['prog-a', 'prog-b', 'prog-c', 'prog-d']) programme(s);
    const ev = coord.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy) VALUES (?, ?, ?, ?, 'coordinator')");
    // prog-a: one run with state changes (the newest wins) and a non-change after them, one run with none (its open counts).
    const a1 = mk('prog-a', { wave: 1, openedAt: NOW - 9 * DAY });
    ev.run(a1, NOW - 8 * DAY, 'planned', 'dispatched');
    ev.run(a1, NOW - 5 * DAY, 'dispatched', 'working');
    ev.run(a1, NOW - HOUR, 'working', 'working');
    mk('prog-a', { wave: 2, openedAt: NOW - 6 * DAY });
    // prog-b: its only open run is a review run, and its work run is closed: no open work run.
    mk('prog-b', { wave: 1, kind: 'review' });
    const closed = mk('prog-b', { wave: 2, state: 'done' });
    ev.run(closed, NOW - 2 * HOUR, 'working', 'done');
    // prog-c: an open work run that never changed state (its dispatch counts, a minute after its open), and a statement
    // made after it.
    mk('prog-c', { openedAt: NOW - 4 * DAY });
    say('prog-c', NOW - MIN);
    // prog-d: a closed run only, and not ranked: not listed at all.
    mk('prog-d', { state: 'done' });
    coord.setPortfolioRank({ basedOn: 0, seen: [], order: [e('prog-b')] }, 'op-a', NOW);
    expect(w2().lastMoves).toEqual([
      { program: 'prog-a', at: NOW - 5 * DAY }, { program: 'prog-b', at: null }, { program: 'prog-c', at: NOW - 4 * DAY + MIN },
    ]);
  });

  it('lastMoves: a planned run\'s open is not a move, so a stuck wave beside a freshly opened next wave still reads its own last move (F5)', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    const ev = coord.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy) VALUES (?, ?, ?, ?, 'coordinator')");
    const planned = coord.db.prepare(
      "INSERT INTO runs (program, wave, project, state, kind, openedAt, claimedBy) VALUES (?, ?, 'project-a', 'planned', 'work', ?, 'lane-a-project-a')");
    // prog-a: wave 1 stuck since its last move three days ago; wave 2 opened an hour ago, still planned.
    const stuck = mk('prog-a', { wave: 1, openedAt: NOW - 9 * DAY });
    ev.run(stuck, NOW - 3 * DAY, 'dispatched', 'working');
    planned.run('prog-a', 2, NOW - HOUR);
    // prog-b: only a planned run, opened an hour ago: no move at all.
    planned.run('prog-b', 1, NOW - HOUR);
    coord.setPortfolioRank({ basedOn: 0, seen: [], order: [e('prog-b')] }, 'op-a', NOW);
    expect(w2().lastMoves).toEqual([{ program: 'prog-a', at: NOW - 3 * DAY }, { program: 'prog-b', at: null }]);
  });
});
