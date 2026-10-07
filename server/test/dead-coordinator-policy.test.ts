// The dead-coordinator lane's DECISIONS, table-driven (workspace lifecycle spec 2026-09-24 §5.4, wave 4).
// `deadCoordinator.ts` is L1: every verdict, fold and word is a pure function, so every fail direction is a row here.
// What only the lane can prove — what reaches the store and the serialiser, when, and how often — is
// `dead-coordinator-lane.test.ts`'s; the executor's re-measure and compare-and-set are `end-dead-coordinator.test.ts`'s.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEAD_COORDINATOR_AFTER_MS, DEAD_COORDINATOR_BACKOFF_CEILING_MS, DEAD_COORDINATOR_BREAKER_WINDOW_MS,
  DEAD_COORDINATOR_DELIBERATE_ACTS, DEAD_COORDINATOR_GAP_MS, DEAD_COORDINATOR_JOURNAL_ACTS,
  DEAD_COORDINATOR_JOURNAL_MARGIN_MS, DEAD_COORDINATOR_JOURNAL_TRUSTED, deadAnchorNext, deadCoordinatorAttention,
  deadCoordinatorBackoffMs, deadCoordinatorBreaker, deadCoordinatorBreakerFeedRow, deadCoordinatorBreakerKey,
  deadCoordinatorCrash, deadCoordinatorDue, deadCoordinatorEntry, deadCoordinatorFeedRows, deadCoordinatorJournal,
  deadCoordinatorNextEntry, deadCoordinatorReportSentence, deadCoordinatorSighted, deadCoordinatorSince,
  deadCoordinatorThrew, isDeadCoordinatorKebab,
  type ClaimantReading, type DeadCoordinatorJournal, type DeadCoordinatorJournalRow, type DeadCoordinatorJournalTrust,
} from '../src/deadCoordinator.js';
import { LIFECYCLE_ACTS } from '../../shared/api.js';

const NOW = 1_790_000_000_000;
const PASS = 60_000;
const GEN = '1790000000000000000';
const OLDER_GEN = '1780000000000000000';
const NEWER_GEN = '1795000000000000000';
const T = DEAD_COORDINATOR_JOURNAL_TRUSTED;
const row = (act: DeadCoordinatorJournalRow['act'], over: Partial<DeadCoordinatorJournalRow> = {}): DeadCoordinatorJournalRow =>
  ({ act, outcome: 'done', at: NOW, gen: GEN, dec: null, meas: null, raw: '{}', ...over });
/** A `spawn` line as ccd writes it: `_lc_json` puts every meas value on the wire as a STRING, so the mirror's typed
 *  `meas.rc` is null and the rc is read off the line's own bytes. */
const spawned = (rc: number): DeadCoordinatorJournalRow =>
  row('spawn', { raw: JSON.stringify({ v: 1, act: 'spawn', outcome: 'done', meas: { rc: String(rc), wrapper: 'claude' } }) });

describe('the journal clause — one reader, four answers', () => {
  it('no row of any act is NO HISTORY; rows with nothing deliberate since the last successful start are QUIET', () => {
    expect(deadCoordinatorJournal([], false, T)).toEqual({ kind: 'no-history' });
    expect(deadCoordinatorJournal([], true, T), 'history, none of it the clause’s acts').toEqual({ kind: 'quiet', started: false });
    expect(deadCoordinatorJournal([row('create'), row('start'), spawned(0), row('hold'), row('swap')], true, T))
      .toEqual({ kind: 'quiet', started: true });
  });

  it('a deliberate act since the last successful start is DELIBERATE — each of the eight, and a declared unsupervise', () => {
    for (const act of DEAD_COORDINATOR_DELIBERATE_ACTS) {
      expect(deadCoordinatorJournal([spawned(0), row(act, { at: NOW + 1 })], true, T), act).toEqual({ kind: 'deliberate', act, at: NOW + 1 });
    }
    expect(deadCoordinatorJournal([spawned(0), row('unsupervise', { dec: { surface: 'pwa' } })], true, T).kind).toBe('deliberate');
    expect(deadCoordinatorJournal([spawned(0), row('unsupervise', { dec: { surface: 'none' } })], true, T),
      'ccd acting on its own account declares nothing').toEqual({ kind: 'quiet', started: true });
  });

  it('a stop BEFORE the last successful start is history — the session came back since', () => {
    expect(deadCoordinatorJournal([row('stop'), row('start'), spawned(0)], true, T)).toEqual({ kind: 'quiet', started: true });
  });

  it('the start is read off the spawn line’s OWN bytes, as ccd wrote them; a line whose rc cannot be read proves no start', () => {
    // MEASURED: ccd's encoder writes `meas.rc` as the string "0", and the mirror's `n()` keeps only a JSON number, so
    // the typed field is null on every real line (`journalparse.test.ts` pins that degrade). A typed 0 counts too.
    expect(deadCoordinatorJournal([row('stop'), row('spawn', { meas: { rc: 0 } })], true, T)).toEqual({ kind: 'quiet', started: true });
    for (const raw of ['not json', JSON.stringify({ meas: { rc: '00' } }), JSON.stringify({ meas: null }), JSON.stringify({ meas: { rc: '1' } })]) {
      expect(deadCoordinatorJournal([row('stop'), row('spawn', { raw })], true, T).kind, raw).toBe('deliberate');
    }
  });

  it('THE CASE THE CLAUSE EXISTS FOR: stopped, then a revive that FAILED — `start` and `ensure` journal at the top, so only a spawn with rc 0 is a start', () => {
    expect(deadCoordinatorJournal([spawned(0), row('stop'), row('ensure'), row('start'), spawned(1)], true, T))
      .toEqual({ kind: 'deliberate', act: 'stop', at: NOW });
  });

  it('a REFUSED act did nothing; an act this build cannot name, and an unsupervise whose surface cannot be read, are doubt — never a crash', () => {
    expect(deadCoordinatorJournal([spawned(0), row('stop', { outcome: 'refused' })], true, T)).toEqual({ kind: 'quiet', started: true });
    expect(deadCoordinatorJournal([spawned(0), row('unknown')], true, T).kind).toBe('deliberate');
    expect(deadCoordinatorJournal([spawned(0), row('unsupervise')], true, T).kind).toBe('deliberate');
  });

  it('a journal the lane cannot TRUST is unreadable, never quiet: a mirror not ok, a gap that may hold the act, a write ccd could not make', () => {
    const trust = (o: Partial<DeadCoordinatorJournalTrust>): DeadCoordinatorJournalTrust => ({ ...T, ...o });
    const after = [spawned(0), row('hold')];
    expect(deadCoordinatorJournal(after, true, trust({ untrusted: 'the lifecycle mirror is unavailable' })))
      .toEqual({ kind: 'unreadable', detail: 'the lifecycle mirror is unavailable' });
    expect(deadCoordinatorJournal([], false, trust({ untrusted: 'the lifecycle mirror is stale' })).kind, 'not even no-history').toBe('unreadable');
    // A gap in a generation OLDER than the last start lost only lines from before it.
    expect(deadCoordinatorJournal(after, true, trust({ gapGens: [OLDER_GEN] }))).toEqual({ kind: 'quiet', started: true });
    for (const g of [GEN, NEWER_GEN, 'lifecycle.unplaceable.jsonl']) {
      expect(deadCoordinatorJournal(after, true, trust({ gapGens: [g] })).kind, g).toBe('unreadable');
    }
    expect(deadCoordinatorJournal([row('hold')], true, trust({ gapGens: [OLDER_GEN] })).kind, 'no start bounds the loss').toBe('unreadable');
    expect(deadCoordinatorJournal([], false, trust({ gapGens: [OLDER_GEN] })).kind, 'nor an empty history').toBe('unreadable');
    // ccd's last counted write failure, placed against the start on ccd's own clock.
    expect(deadCoordinatorJournal(after, true, trust({ lastWriteErrorAt: NOW - DEAD_COORDINATOR_JOURNAL_MARGIN_MS - 1 })))
      .toEqual({ kind: 'quiet', started: true });
    expect(deadCoordinatorJournal(after, true, trust({ lastWriteErrorAt: NOW + 5_000 })).kind).toBe('unreadable');
    expect(deadCoordinatorJournal(after, true, trust({ lastWriteErrorAt: 'unknown' })).kind).toBe('unreadable');
    expect(deadCoordinatorJournal([row('hold')], true, trust({ lastWriteErrorAt: NOW - 86_400_000 })).kind).toBe('unreadable');
  });

  it('every act the clause reads is one of L0’s — ccd’s own and the we-do-not-know `unknown`', () => {
    for (const act of DEAD_COORDINATOR_JOURNAL_ACTS) expect(LIFECYCLE_ACTS, act).toContain(act);
    expect(DEAD_COORDINATOR_JOURNAL_ACTS).toEqual(expect.arrayContaining([...DEAD_COORDINATOR_DELIBERATE_ACTS, 'unsupervise', 'spawn', 'unknown']));
  });
});

describe('a crash, and only a crash (spec §5.4)', () => {
  const dead = (cause: 'absent' | 'stopped' | 'orphan' | 'never-started'): ClaimantReading => ({ state: 'dead', cause });
  const quiet: DeadCoordinatorJournal = { kind: 'quiet', started: true };
  const unstarted: DeadCoordinatorJournal = { kind: 'quiet', started: false };
  const none: DeadCoordinatorJournal = { kind: 'no-history' };
  it('the table', () => {
    const cases: [string, ClaimantReading, DeadCoordinatorJournal, string][] = [
      ['a live pane', { state: 'alive', why: 'tmux reports the pane live' }, quiet, 'alive'],
      ['restarting is alive', { state: 'alive', why: 'the pane is gone but the lifecycle reads restarting' }, quiet, 'alive'],
      ['unmeasurable is never dead', { state: 'unmeasurable', why: 'tmux did not answer' }, quiet, 'unmeasurable'],
      ['stopped is never a crash', dead('stopped'), quiet, 'stopped'],
      ['orphan, quiet', dead('orphan'), quiet, 'crashed'],
      ['never-started after a successful spawn', dead('never-started'), quiet, 'crashed'],
      ['never-started with no successful spawn never ran: unmeasured', dead('never-started'), unstarted, 'unmeasured'],
      ['never-started with no history at all', dead('never-started'), none, 'unmeasured'],
      ['orphan with history but no spawn line', dead('orphan'), unstarted, 'crashed'],
      ['absent, quiet: removed with no deliberate act', dead('absent'), quiet, 'crashed'],
      ['orphan with no history', dead('orphan'), none, 'crashed'],
      ['absent with NO history: unmeasured, listed, never acted on', dead('absent'), none, 'unmeasured'],
      ['an unreadable journal is unmeasured, never no-history', dead('orphan'), { kind: 'unreadable', detail: 'x' }, 'unmeasured'],
      ['a deliberate act since the last start', dead('orphan'), { kind: 'deliberate', act: 'stop', at: NOW }, 'deliberate'],
      ['an expired row', dead('absent'), { kind: 'deliberate', act: 'expire', at: NOW }, 'deliberate'],
    ];
    for (const [name, m, j, kind] of cases) expect(deadCoordinatorCrash(m, j).kind, name).toBe(kind);
    expect(deadCoordinatorCrash(dead('never-started'), quiet)).toEqual({ kind: 'crashed', cause: 'never-started' });
  });
});

describe('the hour, made durable', () => {
  it('the first crashed pass writes firstDeadAt; later ones move lastDeadAt alone', () => {
    const a = deadAnchorNext(null, NOW);
    expect(a).toEqual({ firstDeadAt: NOW, lastDeadAt: NOW });
    expect(deadAnchorNext(a, NOW + PASS)).toEqual({ firstDeadAt: NOW, lastDeadAt: NOW + PASS });
  });

  it('a gap nothing measured — a server down, an older build running after a rollback — restarts the episode; so does a stamp from the future', () => {
    const a = { firstDeadAt: NOW, lastDeadAt: NOW };
    expect(deadAnchorNext(a, NOW + DEAD_COORDINATOR_GAP_MS)).toEqual({ firstDeadAt: NOW, lastDeadAt: NOW + DEAD_COORDINATOR_GAP_MS });
    expect(deadAnchorNext(a, NOW + DEAD_COORDINATOR_GAP_MS + 1)).toEqual({ firstDeadAt: NOW + DEAD_COORDINATOR_GAP_MS + 1,
      lastDeadAt: NOW + DEAD_COORDINATOR_GAP_MS + 1 });
    expect(deadAnchorNext({ firstDeadAt: NOW, lastDeadAt: NOW + 5 }, NOW)).toEqual({ firstDeadAt: NOW, lastDeadAt: NOW });
  });

  it('the supervisor stamp may RAISE the anchor and never lower it; absent, unparseable and future stamps are ignored', () => {
    const a = { firstDeadAt: NOW, lastDeadAt: NOW };
    const later = NOW + 5 * PASS;
    expect(deadCoordinatorSince(a, (NOW + 60_000) / 1000, later)).toBe(NOW + 60_000);
    expect(deadCoordinatorSince(a, (NOW - 86_400_000) / 1000, later), 'a days-old frozen stamp').toBe(NOW);
    for (const s of [null, 0, -5, 1.5, Number.NaN, (later + 1000) / 1000]) expect(deadCoordinatorSince(a, s, later), String(s)).toBe(NOW);
  });

  it('due: an hour since the anchor AND two crashed passes in a row', () => {
    expect(deadCoordinatorDue(NOW, 2, NOW + DEAD_COORDINATOR_AFTER_MS)).toBe(true);
    expect(deadCoordinatorDue(NOW, 2, NOW + DEAD_COORDINATOR_AFTER_MS - 1)).toBe(false);
    expect(deadCoordinatorDue(NOW, 1, NOW + 10 * DEAD_COORDINATOR_AFTER_MS), 'one pass is never enough').toBe(false);
  });
});

describe('the circuit breaker (spec §5.4)', () => {
  const at = (id: string, firstDeadAt: number) => ({ id, firstDeadAt });
  it('two claimants first measured crashed within ten minutes of each other trip it, naming both', () => {
    expect(deadCoordinatorBreaker([at('c-a', NOW), at('c-b', NOW + DEAD_COORDINATOR_BREAKER_WINDOW_MS)], [], [], 2, null, NOW))
      .toEqual({ tripped: true, why: 'clustered', claimants: ['c-a', 'c-b'], since: NOW,
        members: [at('c-a', NOW), at('c-b', NOW + DEAD_COORDINATOR_BREAKER_WINDOW_MS)] });
    expect(deadCoordinatorBreaker([at('c-a', NOW), at('c-b', NOW + DEAD_COORDINATOR_BREAKER_WINDOW_MS + 1)], [], [], 2, null, NOW))
      .toEqual({ tripped: false });
  });

  it('only the clustered are named; one crash alone never trips it', () => {
    const b = deadCoordinatorBreaker([at('c-a', NOW - 5 * 3_600_000), at('c-b', NOW), at('c-c', NOW + PASS)], [], [], 3, null, NOW);
    expect(b).toMatchObject({ tripped: true, why: 'clustered', claimants: ['c-b', 'c-c'], since: NOW });
    expect(deadCoordinatorBreaker([at('c-a', NOW)], [], [], 1, null, NOW)).toEqual({ tripped: false });
  });

  it('IT REMEMBERS: a held member keeps its first instant through a re-anchor, and holds while it only reads doubtful', () => {
    // A and B died together at NOW; A read unmeasurable once, lost its anchor, and was re-anchored half an hour later.
    const held = [at('c-a', NOW), at('c-b', NOW + PASS)];
    expect(deadCoordinatorBreaker([at('c-a', NOW + 31 * PASS), at('c-b', NOW + PASS)], held, [], 2, null, NOW + 62 * PASS))
      .toMatchObject({ tripped: true, why: 'clustered', claimants: ['c-a', 'c-b'], since: NOW });
    // On the due pass B is the one that reads unmeasurable: still held, by memory alone.
    expect(deadCoordinatorBreaker([at('c-a', NOW)], held, ['c-b'], 2, null, NOW + 62 * PASS))
      .toMatchObject({ tripped: true, why: 'clustered', claimants: ['c-a', 'c-b'] });
    // Without the memory both would have fallen apart — the defect this guards.
    expect(deadCoordinatorBreaker([at('c-a', NOW + 31 * PASS), at('c-b', NOW + PASS)], [], [], 2, null, NOW + 62 * PASS))
      .toEqual({ tripped: false });
  });

  it('a FLEET-WIDE doubt (tmux did not answer) trips it whatever the count, naming every claimant it could not clear', () => {
    // One claimant reads crashed (its row is gone: the ladder answers before tmux), the other could not be measured.
    expect(deadCoordinatorBreaker([at('c-a', NOW)], [], ['c-b'], 2, 'tmux did not answer for c-b: no server', NOW))
      .toEqual({ tripped: true, why: 'unmeasurable', claimants: ['c-a', 'c-b'], since: NOW, members: [],
        detail: 'tmux did not answer for c-b: no server' });
    expect(deadCoordinatorBreaker([], [], ['c-a'], 1, 'tmux did not answer for c-a: x', NOW), 'one claimant too')
      .toMatchObject({ tripped: true, why: 'unmeasurable', claimants: ['c-a'] });
  });

  it('a pass that could measure none of two or more claimants trips it; one unmeasurable of several, with tmux answering, does not', () => {
    expect(deadCoordinatorBreaker([], [], ['c-b', 'c-a'], 2, null, NOW))
      .toMatchObject({ tripped: true, why: 'unmeasurable', claimants: ['c-a', 'c-b'], since: NOW });
    expect(deadCoordinatorBreaker([], [], ['c-a'], 2, null, NOW)).toEqual({ tripped: false });
    expect(deadCoordinatorBreaker([], [], ['c-a'], 1, null, NOW)).toEqual({ tripped: false });
  });

  it('its key changes only when the trip, or the set it holds, does — the feed row is written once per trip', () => {
    const b = deadCoordinatorBreaker([at('c-a', NOW), at('c-b', NOW)], [], [], 2, null, NOW);
    expect(deadCoordinatorBreakerKey(b)).toBe('clustered:c-a,c-b');
    expect(deadCoordinatorBreakerKey({ tripped: false })).toBeNull();
    if (!b.tripped) throw new Error('not tripped');
    expect(deadCoordinatorBreakerFeedRow(b)).toEqual({ title: 'dead coordinator: breaker tripped',
      body: expect.stringContaining('(holding since 2026-09-21 14:13 UTC)') });
  });
});

describe('the lane’s memory of one claimant', () => {
  it('a crashed pass extends the run; any other reading ends it, and its would-end report with it', () => {
    let e = deadCoordinatorSighted(deadCoordinatorEntry(), { kind: 'crashed', cause: 'orphan' }, NOW);
    e = deadCoordinatorSighted(e, { kind: 'crashed', cause: 'orphan' }, NOW + PASS);
    expect(e.crashedPasses).toBe(2);
    const shadow = deadCoordinatorNextEntry(e, { kind: 'would-end', programmes: [{ slug: 'p', runIds: [1] }] }, 'orphan', NOW, NOW, PASS);
    expect(shadow.report).toMatchObject({ kind: 'would-end', at: NOW });
    const back = deadCoordinatorSighted(shadow, { kind: 'alive', why: 'tmux reports the pane live' }, NOW + 2 * PASS);
    expect(back).toMatchObject({ crashedPasses: 0, report: null });
  });

  it('unmeasured IS a report, kept with its first instant until a pass can tell; stuck stands until its runs move', () => {
    const u = deadCoordinatorSighted(deadCoordinatorEntry(), { kind: 'unmeasured', why: 'w' }, NOW);
    expect(deadCoordinatorSighted(u, { kind: 'unmeasured', why: 'w' }, NOW + PASS).report).toEqual({ kind: 'unmeasured', at: NOW, why: 'w' });
    expect(deadCoordinatorSighted(u, { kind: 'crashed', cause: 'orphan' }, NOW + PASS).report, 'a crashed pass could tell').toBeNull();
    const stuck = { ...deadCoordinatorEntry(), report: { kind: 'stuck', at: NOW, runs: [{ runId: 4, why: 'bad-transition' }] } } as const;
    expect(deadCoordinatorSighted(stuck, { kind: 'alive', why: 'x' }, NOW).report).toEqual(stuck.report);
  });

  it('an act that closed everything finishes the claimant; runs it could not move are reported and asked again only after a backoff', () => {
    const e = { ...deadCoordinatorEntry(), crashedPasses: 2 };
    expect(deadCoordinatorNextEntry(e, { kind: 'ended', programmes: [{ slug: 'p', runIds: [1, 2] }], open: [], stuck: [], stoppedBy: null },
      'orphan', NOW, NOW, PASS)).toMatchObject({ report: null, attempts: 0 });
    const s = deadCoordinatorNextEntry(e, { kind: 'ended', programmes: [], open: [{ slug: 'p', runIds: [3] }],
      stuck: [{ runId: 3, why: 'bad-transition' }], stoppedBy: null }, 'orphan', NOW, NOW, PASS);
    expect(s).toMatchObject({ attempts: 1, nextAskAt: NOW + 2 * PASS, report: { kind: 'stuck', at: NOW } });
    expect(deadCoordinatorBackoffMs(30, PASS)).toBe(DEAD_COORDINATOR_BACKOFF_CEILING_MS);
  });

  it('an act that STOPPED on a re-measure or a switch forgets its passes; a successor does not', () => {
    const e = { ...deadCoordinatorEntry(), crashedPasses: 61 };
    const ended = (stoppedBy: { kind: 'remeasured' | 'switch' | 'successor'; why: string }) =>
      deadCoordinatorNextEntry(e, { kind: 'ended', programmes: [], open: [{ slug: 'p', runIds: [1] }], stuck: [], stoppedBy },
        'orphan', NOW, NOW, PASS);
    expect(ended({ kind: 'remeasured', why: 're-measured alive' })).toMatchObject({ crashedPasses: 0, nextAskAt: 0 });
    expect(ended({ kind: 'switch', why: 'reclaim-paused was raised' })).toMatchObject({ crashedPasses: 0, nextAskAt: NOW + PASS });
    expect(ended({ kind: 'successor', why: 'x' })).toMatchObject({ crashedPasses: 61 });
  });

  it('an act that THREW is reported and asked again only after the backoff, never every pass', () => {
    const t = deadCoordinatorThrew({ ...deadCoordinatorEntry(), crashedPasses: 3 }, 'SQLITE_FULL', NOW, PASS);
    expect(t).toMatchObject({ attempts: 1, nextAskAt: NOW + 2 * PASS, crashedPasses: 3,
      report: { kind: 'stuck', at: NOW, runs: [], error: 'SQLITE_FULL' } });
    expect(deadCoordinatorThrew(t, 'SQLITE_FULL', NOW + 2 * PASS, PASS)).toMatchObject({ attempts: 2, nextAskAt: NOW + 6 * PASS,
      report: { at: NOW } });
    expect(deadCoordinatorReportSentence('demo-coord', t.report!)).toContain('the lane’s act on coordinator demo-coord failed (SQLITE_FULL)'.replace('’', "'"));
  });

  it('a pause or an unreadable store at the act forgets the sighting — a lowered switch needs two FRESH passes', () => {
    const e = { ...deadCoordinatorEntry(), crashedPasses: 5 };
    expect(deadCoordinatorNextEntry(e, { kind: 'paused-at-server', detail: 'd' }, 'orphan', NOW, NOW, PASS).crashedPasses).toBe(0);
  });
});

describe('the words', () => {
  it('ONE feed row per ended programme, in the spec’s words and with its first-dead time; the shadow row says nothing was ended', () => {
    const o = { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7, 8] }, { slug: 'beta', runIds: [9] }], open: [], stuck: [],
      stoppedBy: null } as const;
    expect(deadCoordinatorFeedRows('demo-coord', o, NOW)).toEqual([
      { title: 'dead coordinator: programme ended',
        body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme alpha ended, 2 runs closed failed.' },
      { title: 'dead coordinator: programme ended',
        body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme beta ended, 1 run closed failed.' },
    ]);
    const w = deadCoordinatorFeedRows('demo-coord', { kind: 'would-end', programmes: [{ slug: 'alpha', runIds: [7, 8] }] }, NOW);
    expect(w).toEqual([{ title: 'dead coordinator: programme would be ended',
      body: 'would end programme alpha (2 runs): coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour, and the lane is not armed (shadow), so nothing was ended.' }]);
  });

  it('a programme the act closed only PART of is never announced as ended', () => {
    const stopped = deadCoordinatorFeedRows('demo-coord', { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7] }],
      open: [{ slug: 'alpha', runIds: [8] }], stuck: [], stoppedBy: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' } }, NOW);
    expect(stopped).toEqual([{ title: 'dead coordinator: programme partly ended',
      body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme alpha was NOT ended: '
        + '1 of 2 runs closed failed and 1 stay open — the act stopped: re-measured alive: tmux reports the pane live.' }]);
    const stuck = deadCoordinatorFeedRows('demo-coord', { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7] }],
      open: [{ slug: 'alpha', runIds: [8] }], stuck: [{ runId: 8, why: 'bad-transition' }], stoppedBy: null }, NOW);
    expect(stuck[0]!.body).toContain('— the abandon arm could not move the rest.');
    expect(deadCoordinatorFeedRows('demo-coord', { kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [7] }], stuck: [],
      stoppedBy: { kind: 'switch', why: 'x' } }, NOW), 'nothing closed: no row').toEqual([]);
  });

  it('the would-end sentence names the cause, the instant and what an armed lane would end — and the doors that keep it', () => {
    const s = deadCoordinatorReportSentence('demo-coord', { kind: 'would-end', at: NOW, cause: 'orphan', since: NOW,
      programmes: [{ slug: 'alpha', runIds: [7, 8] }] });
    expect(s).toContain('coordinator demo-coord crashed (its pane is gone and nothing is bringing it back)');
    expect(s).toContain('nothing was ended; armed, it would end programme alpha (2 runs)');
    expect(s).toContain('Revive the coordinator or reclaim its programme to keep it.');
  });

  it('the breaker is ONE item, first, naming every claimant it holds; the rest follow newest first', () => {
    const m = new Map([
      ['c-a', { ...deadCoordinatorEntry(), report: { kind: 'unmeasured', at: 10, why: 'w' } } as const],
      ['c-b', { ...deadCoordinatorEntry(), report: { kind: 'stuck', at: 20, runs: [{ runId: 1, why: 'x' }] } } as const],
      ['c-c', deadCoordinatorEntry()],
    ]);
    const list = deadCoordinatorAttention(m, { tripped: true, why: 'clustered', claimants: ['c-d', 'c-e'], since: 5, members: [] });
    expect(list.map((a) => [a.kind, a.claimants])).toEqual([['breaker', ['c-d', 'c-e']], ['stuck', ['c-b']], ['unmeasured', ['c-a']]]);
    expect(list[0]!.sentence).toContain('2 coordinators read crashed within 10 minutes of each other (c-d, c-e)');
    expect(list[0]!.sentence).toContain('so the lane ends nothing');
  });

  it('the vocabulary guard admits the lane’s own words and nothing else', () => {
    for (const w of ['claimant-changed', 'sweep-stopped', 'would-end', 'paused-at-server', 'store-unreadable', 'unmeasured', 'stuck', 'breaker', 'ended']) {
      expect(isDeadCoordinatorKebab(w), w).toBe(true);
    }
    expect(isDeadCoordinatorKebab('claimant-alive')).toBe(false);
  });
});

describe('L1', () => {
  it('imports L0 alone — no node:, no fs, no fastify', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'deadCoordinator.ts'), 'utf8');
    const froms = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(froms).toEqual(['../../shared/api.js']);
  });
});
