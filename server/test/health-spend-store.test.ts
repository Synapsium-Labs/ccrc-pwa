// Overlord W2, forecasts B (plan w2-forecasts-health.md, Task 7): `programme_health` and `run_spend`'s writers and the
// reads the forecast lane and the portfolio make of them, over a fixture coord.db: `appendHealth`, `newestHealthOf`,
// `healthNoticedSince`, `recordRunSpend`, `unspentClosesOf`, `spendOf`, plus the two reads this PR widens,
// `forecastsOf({ scoredSince })` and `remainingSince`, which the portfolio's facts read calls on the module (the store keeps
// no delegate for either).
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { redactCommand } from '../src/coord/redact.js';
import { forecastsOf, remainingSince } from '../src/coord/programmeFactsStore.js';
import type { Forecast, HealthVerdict } from '../../shared/programmeFacts.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let coord: CoordStore;
beforeEach(() => {
  coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-health-spend-store-'), '.ccrc', 'coord.db')));
  for (const slug of ['prog-a', 'prog-b']) {
    coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, 'active')").run(slug, `Title of ${slug}`, NOW - 90 * DAY);
  }
});

interface R { program?: string; wave?: number; kind?: string; state?: string; openedAt?: number; dispatchedAt?: number | null;
  closedAt?: number | null; sessionId?: string | null }
const run = (o: R = {}): number => Number(coord.db.prepare(
  'INSERT INTO runs (program, wave, project, state, kind, openedAt, dispatchedAt, closedAt, sessionId, claimedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
).run(o.program ?? 'prog-a', o.wave ?? 1, 'project-a', o.state ?? 'done', o.kind ?? 'work', o.openedAt ?? NOW - 10 * DAY,
  o.dispatchedAt === undefined ? (o.openedAt ?? NOW - 10 * DAY) + MIN : o.dispatchedAt,
  o.closedAt === undefined ? NOW - HOUR : o.closedAt, o.sessionId === undefined ? null : o.sessionId, 'lane-a-project-a').lastInsertRowid);

const verdict = (word: HealthVerdict['word'], matched: string | null = `${word}:arm`): HealthVerdict =>
  ({ word, evidence: { matched, values: { lastMoveAt: 5, flag: true, none: null }, unmeasured: ['spendRecent'] } });
const rawHealth = (program: string, at: number, word: string, evidence: string): void => {
  coord.db.prepare('INSERT INTO programme_health (program, at, word, evidence) VALUES (?, ?, ?, ?)').run(program, at, word, evidence);
};

describe('appendHealth and newestHealthOf', () => {
  it('appendHealth writes one row: the word, the evidence as JSON and noticed as 0 or 1', () => {
    const a = coord.appendHealth('prog-a', verdict('stalled'), true, NOW);
    const b = coord.appendHealth('prog-a', verdict('steady', null), false, NOW + MIN);
    expect(b.id).toBeGreaterThan(a.id);
    expect(coord.db.prepare('SELECT id, program, at, word, evidence, noticed FROM programme_health ORDER BY id').all()).toEqual([
      { id: a.id, program: 'prog-a', at: NOW, word: 'stalled', noticed: 1,
        evidence: JSON.stringify({ matched: 'stalled:arm', values: { lastMoveAt: 5, flag: true, none: null }, unmeasured: ['spendRecent'] }) },
      { id: b.id, program: 'prog-a', at: NOW + MIN, word: 'steady', noticed: 0,
        evidence: JSON.stringify({ matched: null, values: { lastMoveAt: 5, flag: true, none: null }, unmeasured: ['spendRecent'] }) },
    ]);
  });

  it('newestHealthOf answers each listed programme\'s newest row, and no entry for one with none', () => {
    coord.appendHealth('prog-a', verdict('aging'), false, NOW - 2 * DAY);
    coord.appendHealth('prog-b', verdict('burning'), false, NOW - DAY);
    coord.appendHealth('prog-a', verdict('stalled'), true, NOW);
    const rows = coord.newestHealthOf(['prog-a', 'prog-b', 'prog-c']);
    expect(rows.map((r) => [r.program, r.word, r.at])).toEqual([['prog-a', 'stalled', NOW], ['prog-b', 'burning', NOW - DAY]]);
    expect(rows[0]!.evidence).toEqual({ matched: 'stalled:arm', values: { lastMoveAt: 5, flag: true, none: null }, unmeasured: ['spendRecent'] });
    expect(coord.newestHealthOf(['prog-a']).map((r) => r.program)).toEqual(['prog-a']);
    expect(coord.newestHealthOf([])).toEqual([]);
  });

  it('a stored word this build cannot read is carried as unreadable, never dropped and never the older row', () => {
    coord.appendHealth('prog-a', verdict('steady'), false, NOW - DAY);
    rawHealth('prog-a', NOW, 'on-fire', JSON.stringify(verdict('steady').evidence));
    const [row] = coord.newestHealthOf(['prog-a']);
    expect(row).toMatchObject({ program: 'prog-a', at: NOW, word: 'unreadable' });
    expect(row!.evidence).not.toBe('unreadable');
  });

  it.each([
    ['not JSON', 'not json'],
    ['a list', '[1]'],
    ['null', 'null'],
    ['a matched that is neither text nor null', '{"matched":3,"values":{},"unmeasured":[]}'],
    ['values that are a list', '{"matched":null,"values":[],"unmeasured":[]}'],
    ['values missing', '{"matched":null,"unmeasured":[]}'],
    ['unmeasured that is not a list of text', '{"matched":null,"values":{},"unmeasured":[1]}'],
    ['unmeasured missing', '{"matched":null,"values":{}}'],
  ])('a stored evidence that is %s reads as unreadable, the word still read', (_name, evidence) => {
    rawHealth('prog-a', NOW, 'steady', evidence);
    expect(coord.newestHealthOf(['prog-a'])).toMatchObject([{ word: 'steady', evidence: 'unreadable' }]);
  });
});

describe('healthNoticedSince', () => {
  it('is true only for a noticed row of that programme and word at or after since', () => {
    coord.appendHealth('prog-a', verdict('stalled'), true, NOW);
    expect(coord.healthNoticedSince('prog-a', 'stalled', NOW)).toBe(true);
    expect(coord.healthNoticedSince('prog-a', 'stalled', NOW - DAY)).toBe(true);
    expect(coord.healthNoticedSince('prog-a', 'stalled', NOW + 1)).toBe(false);
    expect(coord.healthNoticedSince('prog-a', 'aging', NOW - DAY)).toBe(false);
    expect(coord.healthNoticedSince('prog-b', 'stalled', NOW - DAY)).toBe(false);
  });

  it('a row with noticed 0 never counts, however recent', () => {
    coord.appendHealth('prog-a', verdict('stalled'), false, NOW);
    expect(coord.healthNoticedSince('prog-a', 'stalled', NOW - DAY)).toBe(false);
  });
});

describe('recordRunSpend, the one writer of run_spend', () => {
  it('writes one row per run; a second is a no-op that changes nothing; startCost stays NULL', () => {
    const r = run({ sessionId: 'sess-a' });
    expect(coord.recordRunSpend({ runId: r, state: 'measured', cost: 4.5, class: 'opus', readAt: NOW - MIN }, NOW)).toEqual({ written: true });
    expect(coord.recordRunSpend({ runId: r, state: 'absent', cost: null, class: null, readAt: null }, NOW + DAY)).toEqual({ written: false });
    expect(coord.db.prepare('SELECT runId, at, state, cost, class, readAt, startCost FROM run_spend').all())
      .toEqual([{ runId: r, at: NOW, state: 'measured', cost: 4.5, class: 'opus', readAt: NOW - MIN, startCost: null }]);
  });
});

describe('unspentClosesOf, the spend arm\'s read', () => {
  const FIRST = NOW - 6 * HOUR;
  const spent = (runId: number, at: number): void => {
    coord.db.prepare("INSERT INTO run_spend (runId, at, state) VALUES (?, ?, 'absent')").run(runId, at);
  };

  it('lists work and review runs closed at or after the cutoff with no row, oldest close first', () => {
    const late = run({ wave: 2, closedAt: NOW - HOUR, sessionId: 'sess-b' });
    const early = run({ wave: 1, closedAt: FIRST, sessionId: 'sess-a' });
    const review = run({ wave: 3, kind: 'review', closedAt: NOW - 2 * HOUR, sessionId: 'sess-c' });
    run({ wave: 4, kind: 'unknown', closedAt: NOW - HOUR });
    run({ wave: 5, state: 'working', closedAt: null });
    const got = coord.unspentClosesOf(FIRST);
    expect(got.map((c) => c.runId)).toEqual([early, review, late]);
    expect(got[0]).toEqual({ runId: early, sessionId: 'sess-a', dispatchedAt: NOW - 10 * DAY + MIN, closedAt: FIRST, redispatched: false,
      resumed: false, clearedAt: null, conversation: null });
  });

  it('carries what the dispatch recorded: resumed, its /clear and the conversation (fix round 1, F3 and F10\')', () => {
    const r = run({ wave: 1, closedAt: NOW - HOUR, sessionId: 'sess-a' });
    coord.db.prepare("UPDATE runs SET resumed = 1, clearedAt = ?, dispatchConversation = 'conv-a' WHERE id = ?").run(NOW - 2 * HOUR, r);
    expect(coord.unspentClosesOf(FIRST)[0]).toMatchObject({ runId: r, resumed: true, clearedAt: NOW - 2 * HOUR, conversation: 'conv-a' });
  });

  it('leaves out a run closed before the cutoff (no backfill), and one that has a row', () => {
    run({ closedAt: FIRST - 1, sessionId: 'sess-a' });
    const has = run({ wave: 2, closedAt: NOW - HOUR, sessionId: 'sess-b' });
    const none = run({ wave: 3, closedAt: NOW - HOUR, sessionId: 'sess-c' });
    spent(has, NOW);
    // The newest row (NOW) is later than FIRST, so the cutoff is FIRST still.
    expect(coord.unspentClosesOf(FIRST).map((c) => c.runId)).toEqual([none]);
  });

  it('the cutoff is the EARLIER of the first pass and the newest row\'s time', () => {
    const before = run({ wave: 1, closedAt: NOW - 3 * DAY, sessionId: 'sess-a' });
    const between = run({ wave: 2, closedAt: NOW - 2 * DAY, sessionId: 'sess-b' });
    const had = run({ wave: 3, closedAt: NOW - 2 * DAY, sessionId: 'sess-c' });
    // A previous process wrote a row at NOW - 3 days; this process's first pass is later, so the row's time reaches back.
    spent(had, NOW - 3 * DAY);
    expect(coord.unspentClosesOf(NOW - HOUR).map((c) => c.runId)).toEqual([before, between]);
    // With no row at all the first pass alone is the cutoff: nothing is backfilled.
    const fresh = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-health-spend-store-'), '.ccrc', 'coord.db')));
    fresh.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 't', 1, 'active')").run();
    fresh.db.prepare("INSERT INTO runs (program, wave, project, state, kind, openedAt, dispatchedAt, closedAt, sessionId) VALUES ('prog-a', 1, 'project-a', 'done', 'work', 1, 2, ?, 'sess-a')")
      .run(NOW - 3 * DAY);
    expect(fresh.unspentClosesOf(NOW - HOUR)).toEqual([]);
  });

  it('redispatched is true when a later run names the same session with a later dispatchedAt', () => {
    const first = run({ wave: 1, openedAt: NOW - 5 * DAY, dispatchedAt: NOW - 5 * DAY, closedAt: NOW - 4 * HOUR, sessionId: 'sess-a' });
    const later = run({ wave: 2, openedAt: NOW - 3 * HOUR, dispatchedAt: NOW - 3 * HOUR, closedAt: NOW - HOUR, sessionId: 'sess-a' });
    const other = run({ wave: 3, openedAt: NOW - 3 * HOUR, dispatchedAt: NOW - 3 * HOUR, closedAt: NOW - HOUR, sessionId: 'sess-b' });
    // The same session's earlier dispatch is not "later", and a null session never matches another null session.
    const n1 = run({ wave: 4, closedAt: NOW - HOUR, sessionId: null });
    const n2 = run({ wave: 5, dispatchedAt: NOW - 20 * MIN, closedAt: NOW - HOUR, sessionId: null });
    const flags = Object.fromEntries(coord.unspentClosesOf(NOW - DAY).map((c) => [c.runId, c.redispatched]));
    expect(flags).toEqual({ [first]: true, [later]: false, [other]: false, [n1]: false, [n2]: false });
  });
});

describe('spendOf', () => {
  it('reads the rows of the listed programmes\' runs, and an unknown state word reads unreadable', () => {
    const a1 = run({ sessionId: 'sess-a' });
    const a2 = run({ wave: 2, sessionId: 'sess-b' });
    const b1 = run({ program: 'prog-b', sessionId: 'sess-c' });
    coord.recordRunSpend({ runId: a1, state: 'measured', cost: 2, class: 'opus', readAt: NOW - MIN }, NOW);
    coord.db.prepare("INSERT INTO run_spend (runId, at, state, cost) VALUES (?, ?, 'refunded', 9)").run(a2, NOW);
    coord.recordRunSpend({ runId: b1, state: 'outside', cost: null, class: null, readAt: null }, NOW);
    expect(coord.spendOf(['prog-a'])).toEqual([
      { runId: a1, at: NOW, state: 'measured', cost: 2, class: 'opus', readAt: NOW - MIN },
      { runId: a2, at: NOW, state: 'unreadable', cost: 9, class: null, readAt: null },
    ]);
    expect(coord.spendOf(['prog-b']).map((r) => r.runId)).toEqual([b1]);
    expect(coord.spendOf(['prog-a', 'prog-b'])).toHaveLength(3);
    expect(coord.spendOf([])).toEqual([]);
  });
});

describe('forecastsOf({ scoredSince })', () => {
  const DATED: Forecast = { kind: 'forecast', medianAt: NOW + DAY, p85At: NOW + 2 * DAY, n: 20, source: 'own', seed: 7 };
  const sealOf = (program: string, wave: number, outcome: 'met' | 'missed' | null, scoredAt: number): number => {
    const r = run({ program, wave });
    coord.sealForecast({ program, closingRunId: r, asOf: NOW - HOUR, statementId: null, lo: 1, hi: 3, forecast: DATED }, NOW - DAY);
    const id = coord.forecastsOf({ program }).find((s) => s.closingRunId === r)!.id;
    if (outcome !== null) coord.scoreForecast(id, outcome, scoredAt);
    return id;
  };

  it('answers only met and missed seals scored at or after it, fleet-wide', () => {
    const old = sealOf('prog-a', 1, 'met', NOW - 60 * DAY);
    const edge = sealOf('prog-a', 2, 'missed', NOW - 30 * DAY);
    const met = sealOf('prog-b', 1, 'met', NOW - DAY);
    sealOf('prog-b', 2, null, 0);
    expect(old).toBeLessThan(edge);
    expect(forecastsOf(coord.db, { scoredSince: NOW - 30 * DAY }).map((s) => [s.id, s.outcome])).toEqual([[edge, 'missed'], [met, 'met']]);
    expect(forecastsOf(coord.db, { scoredSince: NOW - 30 * DAY + 1 }).map((s) => s.id)).toEqual([met]);
  });
});

describe('remainingSince', () => {
  it('answers the listed programmes\' statements made at or after since, oldest first, masked', () => {
    const say = (program: string, at: number, reason: string): number => {
      const r = coord.insertRemaining(program, 'lane-a-project-a', { lo: 1, hi: 2, reason, runId: null }, [], null, at);
      if (!r.ok) throw new Error(r.detail);
      return r.id;
    };
    // Built at run time: a literal token-shaped string in a fixture trips push protection.
    const secret = ['sk', 'x'.repeat(40)].join('-');
    say('prog-a', NOW - 10 * DAY, 'too old');
    const a = say('prog-a', NOW - DAY, 'left');
    const b = say('prog-b', NOW - 2 * DAY, 'other programme');
    const c = say('prog-a', NOW, `token ${secret} leaked`);
    expect(remainingSince(coord.db, ['prog-a', 'prog-b'], NOW - 2 * DAY).map((s) => s.id)).toEqual([a, b, c]);
    expect(remainingSince(coord.db, ['prog-a'], NOW - 2 * DAY).map((s) => s.id)).toEqual([a, c]);
    expect(remainingSince(coord.db, ['prog-a'], NOW).map((s) => s.id)).toEqual([c]);
    const reason = remainingSince(coord.db, ['prog-a'], NOW)[0]!.reason;
    expect(reason).not.toContain(secret);
    expect(reason).toBe(redactCommand(`token ${secret} leaked`));
    expect(remainingSince(coord.db, [], NOW - DAY)).toEqual([]);
  });
});
