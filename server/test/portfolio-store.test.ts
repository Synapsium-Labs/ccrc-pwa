// Overlord W1, portfolio (plan w1-portfolio.md Task 2): `portfolio_rank`'s one writer, `setPortfolioRank`, and the facts
// `portfolioFor` reads, over a fixture coord.db.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { LiveAskRead } from '../src/coord/ports.js';
import type { RankOrderEntry } from '../../shared/portfolio.js';
import { portfolioFor } from '../src/coord/portfolio.js';
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
const write = (basedOn: number, seen: string[], order: RankOrderEntry[], actor = 'op-a', now = NOW) =>
  coord.setPortfolioRank({ basedOn, seen, order }, actor, now);

describe('portfolio_rank and its one writer', () => {
  it('a fresh database has both tables, no rank row and no revision row, and the facts read answers revision 0', () => {
    expect(rows()).toEqual([]);
    expect(revisionRow()).toEqual([]);
    expect(coord.portfolioFacts(NOW, none).revision).toBe(0);
  });

  it('a write based on 0 stores the order at revision 1, and a second based on 1 at revision 2', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    expect(write(0, ['prog-a', 'prog-b'], [e('prog-b'), e('prog-a')])).toEqual({ ok: true, revision: 1 });
    expect(rows()).toEqual([
      { program: 'prog-b', position: 1, cls: 'standard', fixedDate: null, setAt: NOW, setBy: 'op-a' },
      { program: 'prog-a', position: 2, cls: 'standard', fixedDate: null, setAt: NOW, setBy: 'op-a' },
    ]);
    expect(write(1, ['prog-a', 'prog-b'], [e('prog-a'), e('prog-b')])).toEqual({ ok: true, revision: 2 });
    expect(coord.portfolioFacts(NOW, none).revision).toBe(2);
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
    expect(coord.portfolioFacts(NOW, none).ranks).toEqual([
      { program: 'prog-a', position: 1, cls: null, clsRaw: 'urgent', fixedDate: null, setAt: 5, setBy: 'op-a' },
    ]);
  });

  it('lists a programme with an open run and no rank, a ranked one with no open run, and leaves out one with neither', () => {
    for (const s of ['prog-open', 'prog-ranked', 'prog-quiet']) programme(s);
    run('prog-open', 'working');
    run('prog-ranked', 'done');
    run('prog-quiet', 'done');
    write(0, ['prog-ranked'], [e('prog-ranked')]);
    const f = coord.portfolioFacts(NOW, none);
    expect(f.programmes.map((p) => p.slug)).toEqual(['prog-open', 'prog-ranked']);
    expect(f.programmes[0]).toEqual({ slug: 'prog-open', title: 'Title of prog-open', createdAt: NOW - 50 * DAY });
    expect(new Set(f.runs.map((r) => r.program))).toEqual(new Set(['prog-open', 'prog-ranked']));
  });

  it('a run kind this build does not know reads unknown', () => {
    programme('prog-a');
    run('prog-a', 'working', { kind: 'audit' });
    expect(coord.portfolioFacts(NOW, none).runs.map((r) => r.kind)).toEqual(['unknown']);
  });

  const ask = (runId: number, childId: string, state: string, askKey: string, releasedAt: number | null): number => Number(coord.db.prepare(
    "INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state, releasedAt) VALUES (?, ?, 'lane-a-parent', ?, ?, 1, 'd', 'q?', '[]', ?, ?)",
  ).run(NOW - 6 * HOUR, childId, runId, askKey, state, releasedAt).lastInsertRowid);

  it('an ask on another programme\'s run is not in this programme\'s asks', () => {
    for (const s of ['prog-a', 'prog-b']) programme(s);
    const ra = run('prog-a'), rb = run('prog-b');
    ask(ra, 'lane-a-child-a', 'released', 'k1', NOW - HOUR);
    ask(rb, 'lane-a-child-b', 'released', 'k2', NOW - HOUR);
    expect(coord.portfolioFacts(NOW, none).asks.map((a) => [a.program, a.state])).toEqual([['prog-a', 'released'], ['prog-b', 'released']]);
  });

  it('the newest released ask of a child reads the live port: match true, mismatch false, unmeasured kept; an older row null', () => {
    programme('prog-a');
    const r = run('prog-a');
    const older = ask(r, 'lane-a-child', 'released', 'k-old', NOW - 3 * HOUR);
    const newest = ask(r, 'lane-a-child', 'released', 'k-new', NOW - HOUR);
    const declined = ask(r, 'lane-a-other', 'declined', 'k-d', NOW - HOUR);
    const answered = ask(r, 'lane-a-third', 'answered', 'k-a', NOW - HOUR);
    const liveOf = (port: LiveAskRead) => Object.fromEntries(coord.portfolioFacts(NOW, port).asks.map((a) => [a.id, a.live]));
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
  const entryOf = (port: LiveAskRead = none) => portfolioFor(coord.portfolioFacts(NOW, port), NOW).programmes[0]!;
  const fetched = (port: LiveAskRead = none) => coord.portfolioFacts(NOW, port).asks.map((a) => a.id);

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
    const f = coord.portfolioFacts(NOW, none);
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
    const facts = coord.portfolioFacts(NOW, none);
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
    const facts = coord.portfolioFacts(NOW, none);
    expect(facts.runs.find((r) => r.id === claimed)).not.toHaveProperty('rebuilt');
    const view = portfolioFor(facts, NOW);
    expect(view.programmes.find((p) => p.slug === 'prog-a')).toMatchObject({ cycle: { n: 0, medianMs: null, p85Ms: null }, cycleUnmeasured: 1 });
    expect(view.programmes.find((p) => p.slug === 'prog-b')).toMatchObject({ cycle: { n: 1, medianMs: 3 * DAY - HOUR }, cycleUnmeasured: 0 });
  });
});
