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
  deadCoordinatorBackoffMs, deadCoordinatorBreaker, deadCoordinatorNewEpisode, deadCoordinatorBreakerFeedRow, deadCoordinatorBreakerKey,
  deadCoordinatorCrash, deadCoordinatorDue, deadCoordinatorEntry, deadCoordinatorFeedRows, deadCoordinatorJournal,
  deadCoordinatorNextEntry, deadCoordinatorReportSentence, deadCoordinatorSighted, deadCoordinatorSince, deadCoordinatorThrewFeedRow,
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

  it('rows are read in JOURNAL order — (generation, then the mirror id) — not ingest order: a newer generation ingested FIRST still comes after an older one', () => {
    // A rotation-time read failure lets the mirror commit the newer generation before the older one's tail, so the
    // mirror ids order [stop(new), spawn-ok(old)]. Read by position, the last start is the old spawn and nothing
    // deliberate follows it: a stop the operator made would read as a crash.
    const stopNew = row('stop', { gen: NEWER_GEN, at: NOW + 2 });
    const spawnOld = { ...spawned(0), gen: OLDER_GEN, at: NOW + 1 };
    expect(deadCoordinatorJournal([stopNew, spawnOld], true, T), 'ingested out of journal order')
      .toEqual({ kind: 'deliberate', act: 'stop', at: NOW + 2 });
    expect(deadCoordinatorJournal([spawnOld, stopNew], true, T), 'the same rows in journal order').toEqual({ kind: 'deliberate', act: 'stop', at: NOW + 2 });
    // Within one generation the mirror id order IS line order and is kept (the sort is stable).
    expect(deadCoordinatorJournal([row('stop'), spawned(0)], true, T), 'same generation: position decides').toEqual({ kind: 'quiet', started: true });
    // A newer generation's successful spawn bounds an older generation's stop, wherever it was ingested.
    expect(deadCoordinatorJournal([{ ...spawned(0), gen: NEWER_GEN }, row('stop', { gen: OLDER_GEN })], true, T))
      .toEqual({ kind: 'quiet', started: true });
  });

  it('a row whose generation name cannot be placed makes the journal UNREADABLE — never a guessed order', () => {
    for (const gen of ['journal-x.ndjson', '', 'lifecycle.unplaceable.jsonl', '1'.repeat(26)]) {
      expect(deadCoordinatorJournal([spawned(0), row('hold', { gen })], true, T).kind, gen).toBe('unreadable');
    }
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
    // `journal-x.ndjson` is the REAL shape of an unplaceable name (`journal-<mid>.ndjson`) and SHORT: by `compareGenerations`'s
    // length-first order it would sort before any start, so only the digits guard keeps it from reading "older than the start".
    for (const g of [GEN, NEWER_GEN, 'lifecycle.unplaceable.jsonl', 'journal-x.ndjson', 'journal-1a.ndjson']) {
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

  it('a horizon whose only spawn rows FAILED says so — `failedSpawn`; a horizon with no spawn row at all does not', () => {
    expect(deadCoordinatorJournal([row('start'), spawned(1)], true, T)).toEqual({ kind: 'quiet', started: false, failedSpawn: true });
    expect(deadCoordinatorJournal([row('start'), row('spawn', { raw: 'not json' })], true, T)).toEqual({ kind: 'quiet', started: false, failedSpawn: true });
    expect(deadCoordinatorJournal([row('start'), row('ensure')], true, T), 'no spawn row at all').toEqual({ kind: 'quiet', started: false });
    expect(deadCoordinatorJournal([spawned(1), spawned(0)], true, T), 'a later success wins').toEqual({ kind: 'quiet', started: true });
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
    // A session whose FIRST start failed reads `orphan` (ccd marks it started before it spawns) — it was started and
    // never ran, so it cannot have crashed. A horizon with NO spawn row at all stays crashed: a coordinator started
    // before the mirror existed must remain reachable.
    const failed: DeadCoordinatorJournal = { kind: 'quiet', started: false, failedSpawn: true };
    cases.push(
      ['orphan whose journal holds only a failed spawn: started and never ran', dead('orphan'), failed, 'unmeasured'],
      ['absent whose journal holds only a failed spawn', dead('absent'), failed, 'unmeasured'],
      ['never-started whose journal holds only a failed spawn', dead('never-started'), failed, 'unmeasured'],
      ['orphan after a successful spawn is still a crash even if an earlier spawn failed', dead('orphan'), quiet, 'crashed'],
    );
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

describe('a new spawn starts a new episode (D-4825)', () => {
  const anchor = { firstDeadAt: NOW, lastDeadAt: NOW + PASS };
  const sec = (ms: number): number => Math.floor(ms / 1000);
  it('a heartbeat later than the anchor and not after now is a spawn since it began; nothing else is', () => {
    const now = NOW + 30 * PASS;
    expect(deadCoordinatorNewEpisode(anchor, sec(NOW + 5 * PASS), now)).toBe(true);
    expect(deadCoordinatorNewEpisode(anchor, sec(NOW - PASS), now), 'a heartbeat from before the anchor is this episode').toBe(false);
    expect(deadCoordinatorNewEpisode(anchor, sec(NOW), now), 'the same second is not later').toBe(false);
    expect(deadCoordinatorNewEpisode(anchor, sec(now + PASS), now), 'a stamp from the future is no evidence').toBe(false);
    expect(deadCoordinatorNewEpisode(null, sec(NOW + 5 * PASS), now), 'no anchor: the first crash anchors as it always did').toBe(false);
    for (const bad of [null, 0, -5, 1.5, Number.NaN]) expect(deadCoordinatorNewEpisode(anchor, bad, now), String(bad)).toBe(false);
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

  it('a FALLBACK member clusters with every other entry whatever the instants: it plus one other trips, all named, the flag carried; alone it trips nothing (review 382, R2)', () => {
    const wild = { id: 'c-a', firstDeadAt: NOW, fallback: true as const };
    const far = NOW + 5 * 3_600_000;
    const b = deadCoordinatorBreaker([at('c-z', far)], [wild], [], 2, null, far + PASS);
    expect(b).toMatchObject({ tripped: true, why: 'clustered', claimants: ['c-a', 'c-z'], since: NOW });
    const members = b.tripped ? b.members : [];
    expect(members, 'EVERY member of a trip a flag took part in carries the flag — the swept-in one too (review 382, N1)')
      .toEqual([{ id: 'c-a', firstDeadAt: NOW, fallback: true }, { id: 'c-z', firstDeadAt: far, fallback: true }]);
    // ...on the unmeasurable arm, which builds `members` the same way.
    const u = deadCoordinatorBreaker([at('c-z', far)], [wild], ['c-z'], 2, 'tmux did not answer for c-z: x', far + PASS);
    expect(u).toMatchObject({ tripped: true, why: 'unmeasurable' });
    expect(u.tripped && u.members).toEqual([{ id: 'c-a', firstDeadAt: NOW, fallback: true }, { id: 'c-z', firstDeadAt: far, fallback: true }]);
    // An ordinary trip carries no flag on anyone.
    const ord = deadCoordinatorBreaker([at('c-a', NOW), at('c-b', NOW + PASS)], [], [], 2, null, NOW + PASS);
    expect(ord.tripped && ord.members.some((m) => 'fallback' in m)).toBe(false);
    // Two held, one flagged and one not, hours apart: they cluster too.
    expect(deadCoordinatorBreaker([], [wild, at('c-b', far)], [], 2, null, far)).toMatchObject({ tripped: true, claimants: ['c-a', 'c-b'] });
    // A lone entry is no cluster, flagged or not: the flag is lost with the hold.
    expect(deadCoordinatorBreaker([], [wild], [], 1, null, NOW)).toEqual({ tripped: false });
    expect(deadCoordinatorBreaker([at('c-z', far)], [{ ...wild, id: 'c-z', firstDeadAt: far }], [], 1, null, far)).toEqual({ tripped: false });
    // The same two WITHOUT the flag, hours apart, do not trip: ordinary clustering is unchanged.
    expect(deadCoordinatorBreaker([at('c-z', far)], [at('c-a', NOW)], [], 2, null, far + PASS)).toEqual({ tripped: false });
  });

  it('R5\'s corner is CLOSED: X held at its old instant and re-anchored at T_new beside Y at T_new trips — a held instant never replaces the current anchor (review 384, F1)', () => {
    const old = NOW;
    const fresh = NOW + 5 * 3_600_000;
    const b = deadCoordinatorBreaker([at('c-x', fresh), at('c-y', fresh)], [at('c-x', old)], [], 2, null, fresh + PASS);
    expect(b).toMatchObject({ tripped: true, why: 'clustered', claimants: ['c-x', 'c-y'] });
    // The member keeps its REMEMBERED instant AND accumulates its current anchor (review 384, F1-N1); Y, never held, has its anchor.
    expect(b.tripped && b.members).toEqual([{ id: 'c-x', firstDeadAt: old, instants: [old, fresh] }, at('c-y', fresh)]);
    expect(b.tripped && b.since, 'since is the earliest member instant, as before').toBe(old);
    // An id\'s own two instants never cluster it with itself.
    expect(deadCoordinatorBreaker([at('c-x', fresh)], [at('c-x', old)], [], 1, null, fresh)).toEqual({ tripped: false });
    // ...and the remembered instant still clusters on its own, as before (IT REMEMBERS).
    expect(deadCoordinatorBreaker([at('c-y', old + PASS)], [at('c-x', old)], [], 2, null, fresh)).toMatchObject({ tripped: true, claimants: ['c-x', 'c-y'] });
  });

  it('a held member ACCUMULATES every anchor instant it carries while held, and clusters at all of them (review 384, F1-N1)', () => {
    const t1 = NOW; const t2 = NOW + 5 * 3_600_000; const t3 = t2 + 4 * PASS;
    // Held at t1 and t2 (two episodes while held), crashed again at t3, and beside Y at t3: instants dedupe, ascending.
    const b = deadCoordinatorBreaker([at('c-x', t3), at('c-y', t3)], [{ id: 'c-x', firstDeadAt: t1, instants: [t1, t2] }], [], 2, null, t3);
    expect(b).toMatchObject({ tripped: true, claimants: ['c-x', 'c-y'], since: t1 });
    expect(b.tripped && b.members).toEqual([{ id: 'c-x', firstDeadAt: t1, instants: [t1, t2, t3] }, at('c-y', t3)]);
    // The probe: Y was made a member at 88, was re-anchored at 106 beside Z, and is now unmeasurable (no anchor): it still
    // clusters with Z at its LATER instant, which a member that remembered only its first would not.
    const m88 = NOW + 88 * 60_000; const m106 = NOW + 106 * 60_000;
    expect(deadCoordinatorBreaker([at('c-z', m106)], [{ id: 'c-y', firstDeadAt: m88, instants: [m88, m106] }], ['c-y'], 3, null, m106 + PASS))
      .toMatchObject({ tripped: true, claimants: ['c-y', 'c-z'] });
    expect(deadCoordinatorBreaker([at('c-z', m106)], [at('c-y', m88)], ['c-y'], 3, null, m106 + PASS), 'the first instant alone is 18 minutes away')
      .toEqual({ tripped: false });
    // A repeated instant is one instant; an unflagged single-instant member carries no `instants`.
    const one = deadCoordinatorBreaker([at('c-x', t1), at('c-y', t1)], [at('c-x', t1)], [], 2, null, t1);
    expect(one.tripped && one.members).toEqual([at('c-x', t1), at('c-y', t1)]);
  });

  it('MONOTONE (review 384, F1): adding an entry, an instant or a flag never turns `tripped` false and never drops a member — a seeded grid', () => {
    let seed = 20261011;
    const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
    const ids = ['c-a', 'c-b', 'c-c', 'c-d', 'c-e'];
    const instants = [0, 4, 9, 11, 21, 40, 41, 90].map((m) => NOW + m * 60_000);
    type In = { crashed: Map<string, number>; held: Map<string, { ats: number[]; fallback: boolean }> };
    const run = (i: In) => deadCoordinatorBreaker([...i.crashed].map(([id, firstDeadAt]) => ({ id, firstDeadAt })),
      [...i.held].map(([id, h]) => {
        const ats = [...new Set(h.ats)].sort((x, y) => x - y);
        return { id, firstDeadAt: ats[0]!, ...(ats.length > 1 ? { instants: ats } : {}), ...(h.fallback ? { fallback: true as const } : {}) };
      }),
      [], 0, null, NOW + 200 * 60_000);
    const members = (b: ReturnType<typeof run>): string[] => (b.tripped ? b.members.map((m) => m.id) : []);
    const clone = (i: In): In => ({ crashed: new Map(i.crashed), held: new Map([...i.held].map(([id, h]) => [id, { ats: [...h.ats], fallback: h.fallback }])) });
    let checked = 0; let tripped = 0;
    for (let k = 0; k < 600; k += 1) {
      const base: In = { crashed: new Map(), held: new Map() };
      for (const id of ids) {
        if (rnd(3) === 0) base.crashed.set(id, instants[rnd(instants.length)]!);
        if (rnd(4) === 0) base.held.set(id, { ats: [instants[rnd(instants.length)]!, ...(rnd(3) === 0 ? [instants[rnd(instants.length)]!] : [])], fallback: rnd(6) === 0 });
      }
      const before = run(base);
      const supers: In[] = [];
      for (const id of ids) {
        if (!base.crashed.has(id)) { const s2 = clone(base); s2.crashed.set(id, instants[rnd(instants.length)]!); supers.push(s2); }   // an entry (or an instant, when held)
        const h = base.held.get(id);
        if (h === undefined) { const s2 = clone(base); s2.held.set(id, { ats: [instants[rnd(instants.length)]!], fallback: false }); supers.push(s2); }   // an entry (or an instant, when crashed)
        else {
          const s2 = clone(base); s2.held.get(id)!.ats.push(instants[rnd(instants.length)]!); supers.push(s2);   // another remembered instant
          if (!h.fallback) { const s3 = clone(base); s3.held.get(id)!.fallback = true; supers.push(s3); }   // a flag
        }
      }
      for (const sup of supers) {
        const after = run(sup);
        checked += 1;
        if (before.tripped) {
          tripped += 1;
          expect(after.tripped, JSON.stringify({ base: [[...base.crashed], [...base.held]], sup: [[...sup.crashed], [...sup.held]] })).toBe(true);
          for (const m of members(before)) expect(members(after), `${m} dropped`).toContain(m);
        }
      }
    }
    expect(checked, 'a vacuous grid would pass').toBeGreaterThan(1000);
    expect(tripped, 'and so would one that never trips').toBeGreaterThan(200);
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

describe('the breaker’s words', () => {
  it('a cluster is not blamed on a box fault alone: a lane gap of over ten minutes re-anchors every crashed coordinator together, and it clears when they are revived, reclaimed or abandoned', () => {
    const b = deadCoordinatorBreaker([{ id: 'c-a', firstDeadAt: NOW }, { id: 'c-b', firstDeadAt: NOW }], [], [], 2, null, NOW);
    if (!b.tripped) throw new Error('not tripped');
    const attention = deadCoordinatorAttention(new Map(), b)[0]!;
    const feed = deadCoordinatorBreakerFeedRow(b).body;
    for (const sentence of [attention.sentence, feed]) {
      expect(sentence).toContain('c-a, c-b');
      expect(sentence).toContain('a box fault is likelier than 2 crashes');
      // The other cause: the lane's own gap, which restarts every episode on one pass.
      expect(sentence).toContain('more than 10 minutes');
      expect(sentence).toContain('a restart, a pause, a stale mirror');
      expect(sentence).toContain('re-anchors every crashed coordinator together');
      expect(sentence).toMatch(/clears when .* revived, reclaimed or abandoned/);
    }
    // The fleet-doubt arm is not a cluster and keeps its own sentence.
    const u = deadCoordinatorBreaker([], [], ['c-a', 'c-b'], 2, null, NOW);
    if (!u.tripped) throw new Error('not tripped');
    expect(deadCoordinatorAttention(new Map(), u)[0]!.sentence).not.toContain('re-anchors');
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

  it('a reading that ENDS the episode forgets the last recorded outcome, so a second episode is recorded again (review 339, F2)', () => {
    let e = deadCoordinatorSighted(deadCoordinatorEntry(), { kind: 'crashed', cause: 'orphan' }, NOW);
    e = deadCoordinatorNextEntry(e, { kind: 'would-end', programmes: [{ slug: 'p', runIds: [1] }] }, 'orphan', NOW, NOW, PASS);
    expect(e.lastOutcome, 'the CONTROL: the shadow record is remembered').toBe('would-end:p=1');
    expect(deadCoordinatorSighted(e, { kind: 'crashed', cause: 'orphan' }, NOW + PASS).lastOutcome, 'a crashed pass keeps it').toBe('would-end:p=1');
    for (const c of [{ kind: 'alive', why: 'x' }, { kind: 'stopped' }, { kind: 'deliberate', act: 'stop' },
      { kind: 'unmeasured', why: 'w' }, { kind: 'unmeasurable', why: 'u' }] as const) {
      expect(deadCoordinatorSighted(e, c, NOW + PASS).lastOutcome, c.kind).toBeNull();
    }
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
    const ended = (stoppedBy: { kind: 'remeasured' | 'switch' | 'successor' | 'hold'; why: string }) =>
      deadCoordinatorNextEntry(e, { kind: 'ended', programmes: [], open: [{ slug: 'p', runIds: [1] }], stuck: [], stoppedBy },
        'orphan', NOW, NOW, PASS);
    expect(ended({ kind: 'remeasured', why: 're-measured alive' })).toMatchObject({ crashedPasses: 0, nextAskAt: 0 });
    expect(ended({ kind: 'switch', why: 'reclaim-paused was raised' })).toMatchObject({ crashedPasses: 0, nextAskAt: NOW + PASS });
    expect(ended({ kind: 'successor', why: 'x' })).toMatchObject({ crashedPasses: 61 });
    // A mirror gone stale at the act learned nothing: the passes stand, and it waits one pass (review 339, F4).
    expect(ended({ kind: 'hold', why: 'the lifecycle mirror is stale' })).toMatchObject({ crashedPasses: 61, nextAskAt: NOW + PASS });
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

  it('an act that RELEASED a worker and stopped is recorded though it closed nothing: one row naming the worker, and that the programme is NOT ended', () => {
    const o = { kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [7] }], stuck: [], released: [{ slug: 'alpha', runIds: [7] }],
      stoppedBy: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' } } as const;
    expect(deadCoordinatorFeedRows('demo-coord', o, NOW)).toEqual([{ title: 'dead coordinator: programme partly ended',
      body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme alpha was NOT ended: '
        + '0 of 1 run closed failed and 1 stay open — the act stopped: re-measured alive: tmux reports the pane live; '
        + 'run 7\'s worker was released and is unheld until its coordinator re-holds it.' }]);
    // A programme the act closed in full is announced as ended, and the OTHER programme's released worker is not lost.
    const two = { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7] }], open: [{ slug: 'beta', runIds: [9] }], stuck: [],
      released: [{ slug: 'beta', runIds: [9] }], stoppedBy: { kind: 'remeasured', why: 'x' } } as const;
    expect(deadCoordinatorFeedRows('demo-coord', two, NOW).map((r) => [r.title, /programme (\S+) (?:ended|was NOT ended)/.exec(r.body)?.[1]]))
      .toEqual([['dead coordinator: programme ended', 'alpha'], ['dead coordinator: programme partly ended', 'beta']]);
    // A programme that closed one run AND released the next worker says both.
    const both = deadCoordinatorFeedRows('demo-coord', { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7] }],
      open: [{ slug: 'alpha', runIds: [8] }], stuck: [], released: [{ slug: 'alpha', runIds: [8] }], stoppedBy: { kind: 'remeasured', why: 'x' } }, NOW);
    expect(both).toHaveLength(1);
    expect(both[0]!.body).toContain('1 of 2 runs closed failed and 1 stay open — the act stopped: x; run 8\'s worker was released');
  });

  it('a RE-HELD worker is worded as re-held and still claimed — never as released and unheld (review 339, F3)', () => {
    const o = { kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [7] }], stuck: [], reheld: [{ slug: 'alpha', runIds: [7] }],
      stoppedBy: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' } } as const;
    const rows = deadCoordinatorFeedRows('demo-coord', o, NOW);
    expect(rows).toEqual([{ title: 'dead coordinator: programme partly ended',
      body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme alpha was NOT ended: '
        + '0 of 1 run closed failed and 1 stay open — the act stopped: re-measured alive: tmux reports the pane live; '
        + 'run 7\'s worker was re-held under a surviving run and stays claimed.' }]);
    expect(rows[0]!.body).not.toMatch(/released|unheld/);
    const n = deadCoordinatorNextEntry({ ...deadCoordinatorEntry(), crashedPasses: 3 }, o, 'orphan', NOW, NOW, PASS);
    expect(n.report, 'a re-hold alone is news: the act did something').toMatchObject({ kind: 'stuck', runs: [] });
    const sentence = deadCoordinatorReportSentence('demo-coord', n.report!);
    expect(sentence).toContain('re-held the worker of run 7 of programme alpha under a surviving run (it stays claimed)');
    expect(sentence).not.toMatch(/released|unheld/);
  });

  it('an act that THREW gets ONE row naming what is known, whatever it had done — and that nothing more is known (review 339, F13)', () => {
    const none = deadCoordinatorThrewFeedRow('demo-coord', { kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [7] }],
      stuck: [], stoppedBy: null, failed: 'database or disk is full', failedRun: 7 }, 'database or disk is full', NOW);
    expect(none).toEqual({ title: 'dead coordinator: act failed',
      body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; the lane\'s act failed '
        + '(database or disk is full) before it closed any run; run 7\'s abandon is the one that failed, and whether its worker was '
        + 'released or re-held before the failure is not known. Nothing more is known about which runs or workspaces moved — '
        + 'check its runs on /runs. It is asked again only after a backoff.' });
    expect(deadCoordinatorThrewFeedRow('demo-coord', { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [6] }],
      open: [{ slug: 'beta', runIds: [7] }], stuck: [], stoppedBy: null, failed: 'x', failedRun: 7 }, 'x', NOW).body)
      .toContain('failed (x) after it closed failed 1 run of programme alpha; run 7\'s abandon is the one that failed');
    expect(deadCoordinatorThrewFeedRow('demo-coord', null, 'SQLITE_BUSY', NOW).body, 'the serialiser threw: nothing is known')
      .toContain('failed (SQLITE_BUSY) before it closed any run. Nothing more is known');
  });

  it('an act that FAILED part-way keeps the rows of what it had closed, and says it failed', () => {
    const o = { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7] }, { slug: 'beta', runIds: [8] }],
      open: [{ slug: 'beta', runIds: [9] }, { slug: 'gamma', runIds: [10] }], stuck: [], stoppedBy: null, failed: 'database or disk is full' } as const;
    const rows = deadCoordinatorFeedRows('demo-coord', o, NOW);
    expect(rows.map((r) => r.title)).toEqual(['dead coordinator: programme ended', 'dead coordinator: programme partly ended']);
    expect(rows[1]!.body).toContain('programme beta was NOT ended: 1 of 2 runs closed failed and 1 stay open — the act then failed: database or disk is full.');
  });

  it('the attention entry for a stopped act names what it did and that the programme is NOT ended; a clean finish leaves none', () => {
    const e = { ...deadCoordinatorEntry(), crashedPasses: 3 };
    const o = { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7, 8] }], open: [{ slug: 'beta', runIds: [9] }], stuck: [],
      released: [{ slug: 'beta', runIds: [9] }], stoppedBy: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' } } as const;
    const n = deadCoordinatorNextEntry(e, o, 'orphan', NOW, NOW, PASS);
    expect(n.report).toMatchObject({ kind: 'stuck', at: NOW, runs: [] });
    const sentence = deadCoordinatorReportSentence('demo-coord', n.report!);
    expect(sentence).toContain('the programme is NOT ended');
    expect(sentence).toContain('re-measured alive: tmux reports the pane live');
    expect(sentence).toContain('closed failed 2 runs of programme alpha');
    expect(sentence).toContain('released the worker of run 9 of programme beta');
    expect(sentence).not.toMatch(/could not be moved/);
    expect(deadCoordinatorAttention(new Map([['demo-coord', n]]), { tripped: false }).map((a) => [a.kind, a.claimants]))
      .toEqual([['stuck', ['demo-coord']]]);
    // Nothing closed and nothing released is not news (the old `forgets` row): no entry.
    expect(deadCoordinatorNextEntry(e, { kind: 'ended', programmes: [], open: [{ slug: 'p', runIds: [1] }], stuck: [],
      stoppedBy: { kind: 'remeasured', why: 'x' } }, 'orphan', NOW, NOW, PASS).report).toBeNull();
    // A run the arm could not move keeps its report AND the progress.
    const s = deadCoordinatorNextEntry(e, { ...o, stuck: [{ runId: 9, why: 'bad-transition' }] }, 'orphan', NOW, NOW, PASS);
    expect(deadCoordinatorReportSentence('demo-coord', s.report!)).toMatch(/run 9 \(bad-transition\) could not be moved[\s\S]*released the worker of run 9/);
    // A throw keeps what it had closed.
    const t = deadCoordinatorThrew(e, 'SQLITE_FULL', NOW, PASS, { closed: [{ slug: 'alpha', runIds: [7] }], released: [], reheld: [], stop: null });
    expect(deadCoordinatorReportSentence('demo-coord', t.report!)).toMatch(/failed \(SQLITE_FULL\)[\s\S]*closed failed 1 run of programme alpha/);
  });

  it('the `stuck` sentence of a partly-ended programme never reads as ended — the feed row says NOT ended, so must this', () => {
    const stuck = deadCoordinatorReportSentence('demo-coord', { kind: 'stuck', at: NOW,
      runs: [{ runId: 8, why: 'bad-transition' }, { runId: 9, why: 'stale-tip' }] });
    expect(stuck).not.toMatch(/was ended|programme was ended|has been ended/);
    expect(stuck).toContain('the programme is NOT ended');
    expect(stuck).toContain('run 8 (bad-transition), run 9 (stale-tip) could not be moved');
    expect(stuck).toContain('abandon them by hand');
    expect(deadCoordinatorReportSentence('demo-coord', { kind: 'stuck', at: NOW, runs: [{ runId: 8, why: 'x' }] })).toContain('abandon it by hand');
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
