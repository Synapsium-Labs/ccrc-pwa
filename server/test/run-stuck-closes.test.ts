// D-8077 (spec 2026-11-04 §7 "What 'in 20 h' counts down to", A35, A57): the run-close lane writes `closes` into its own map and
// the stuck verdict's pass leaves that map alone, so the two clocks never fight. A read joins them. Every lane row maps to a
// reason: E1 reads `never-started` through its quiet arm, E1r reads `review-of-closed` (`target-closed` or `later-review`).
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO } from '../src/io.js';
import type { SessionVerdict } from '../src/exec.js';
import { DEAD_COORDINATOR_JOURNAL_TRUSTED } from '../src/deadCoordinator.js';
import { createRunVerdicts } from '../src/coord/runVerdicts.js';
import { runStuckPass } from '../src/coord/runStuckPass.js';
import { createRunCloseMemory, runClosePass } from '../src/coord/runCloseLane.js';
import type { ClaimantVerdict } from '../src/coord/reclaim.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const H = 3_600_000;
const D = 24 * H;
const COORD = 'demo-quiet-mesa';
const ALIVE: ClaimantVerdict = { state: 'alive', why: 'live' };
const DEAD: ClaimantVerdict = { state: 'dead', cause: 'orphan', why: 'gone' };

/** E1's quiet arm reads the lane's durable first-pass anchor: the lane anchors the programme, then 48 hours pass. */
const quietFor48h = async (s: { lane: () => Promise<unknown>; clock: { now: number } }): Promise<void> => {
  await passesFor(s, 48 * H);
};
/** Lane passes every 5 minutes across `ms`: a longer silence is a gap, and a gap restarts the anchor (R5). */
const passesFor = async (s: { lane: () => Promise<unknown>; clock: { now: number } }, ms: number): Promise<void> => {
  for (let spent = 0; spent < ms; spent += 5 * 60_000) { await s.lane(); s.clock.now += 5 * 60_000; }
};

const setup = (o: { archived?: boolean } = {}) => {
  const home = mkTmp('ccrc-stuck-closes-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${COORD}`, uuid: `u-${COORD}`, started: '1', workspace: COORD,
    branch: `ws/${COORD}`, base: 'origin/main', ...(o.archived === true ? { archived: String((T - 49 * D) / 1000), supervised: String((T - 7200_000) / 1000) } : {}),
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${COORD}.${k}`), v);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const verdicts = createRunVerdicts();
  const clock = { now: T };
  const pane: SessionVerdict = o.archived === true ? { verdict: 'gone' } : { verdict: 'live' };
  const stuck = () => runStuckPass({
    coord, io: localIO, cfg: testDeps(home).cfg, tmux: { sessionVerdict: async () => pane }, verdicts,
    journalTrust: async () => ({ hold: null, trust: DEAD_COORDINATOR_JOURNAL_TRUSTED }), now: () => clock.now, claimantBusyAt: () => null,
  });
  const memory = createRunCloseMemory();
  const names: { list: string[] | null } = { list: [] };
  const lane = () => runClosePass({
    coord, verdicts, memory, now: () => clock.now, registryNames: async () => names.list,
    measure: async (id) => (id === COORD && o.archived === true ? DEAD : ALIVE),
    claimantBusyAt: () => null, abandonRefusal: () => null, branchFacts: async () => ({ readAt: clock.now, openPr: false, unpushed: false }),
    childMark: async () => ({ kind: 'none' }), serial: null,
  });
  const open = (program: string, wave: number, openedAgo: number, extra: Record<string, unknown> = {}): number => {
    const r = coord.openRun({ program, title: `Lane ${wave}`, project: 'demo', wave, waveOf: 3, claimedBy: COORD, ...extra });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    coord.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(T - openedAgo, r.id);
    return r.id;
  };
  return { coord, verdicts, clock, stuck, lane, open, names };
};

describe('E1 reads never-started through its quiet arm', () => {
  it('a planned run on day 4 of a quiet programme reads never-started and carries closes', async () => {
    const s = setup();
    const id = s.open('programme-a', 1, 4 * D);
    await quietFor48h(s);
    await s.stuck(); await s.lane();
    expect(s.verdicts.of(id)!.stuck).toMatchObject({ reason: 'never-started', cause: null, since: T - 4 * D, closes: { at: T + 72 * H, armed: false } });
  });

  it('a quiet programme with two planned waves carries closes on both', async () => {
    const s = setup();
    const a = s.open('programme-a', 1, 4 * D);
    const b = s.open('programme-a', 2, 4 * D);
    await quietFor48h(s);
    await s.stuck(); await s.lane();
    for (const id of [a, b]) expect(s.verdicts.of(id)!.stuck).toMatchObject({ reason: 'never-started', closes: { armed: false } });
    expect(s.verdicts.of(a)!.stuck!.closes).not.toBeNull();
    expect(s.verdicts.of(b)!.stuck!.closes).not.toBeNull();
  });

  it('a programme quiet for 47 h has no quiet-arm verdict, and 48 h has', async () => {
    const s = setup();
    const id = s.open('programme-a', 1, 4 * D);
    s.open('programme-a', 2, 4 * D);
    await passesFor(s, 47 * H);
    await s.stuck();
    expect(s.verdicts.of(id)!.stuck).toBeNull();
    await passesFor(s, H);
    await s.stuck();
    expect(s.verdicts.of(id)!.stuck).toMatchObject({ reason: 'never-started' });
  });

  it('a programme the lane has not anchored yet has no quiet-arm verdict, however old its runs are (the one place activity enters)', async () => {
    const s = setup();
    const id = s.open('programme-a', 1, 50 * D);
    s.open('programme-a', 2, 50 * D);
    await s.stuck();
    expect(s.verdicts.of(id)!.stuck).toBeNull();
    await s.lane(); await s.stuck();
    expect(s.verdicts.of(id)!.stuck).toBeNull();
    await passesFor(s, 47 * H); await s.stuck();
    expect(s.verdicts.of(id)!.stuck).toBeNull();
    await passesFor(s, H); await s.stuck(); await s.lane();
    expect(s.verdicts.of(id)!.stuck).toMatchObject({ reason: 'never-started', closes: { at: T + 72 * H } });
  });

  it('an unread busy turn after a restart gives no quiet-arm verdict (R2)', async () => {
    const s = setup();
    const id = s.open('programme-a', 1, 4 * D);
    await runStuckPass({
      coord: s.coord, io: localIO, cfg: testDeps(mkTmp('ccrc-x-')).cfg, tmux: { sessionVerdict: async () => ({ verdict: 'live' }) }, verdicts: s.verdicts,
      journalTrust: async () => ({ hold: null, trust: DEAD_COORDINATOR_JOURNAL_TRUSTED }), now: () => T, claimantBusyAt: () => 'unread',
    });
    expect(s.verdicts.of(id)!.stuck).toBeNull();
  });

  it('a mail from the coordinator about the programme moves the quiet arm', async () => {
    const s = setup();
    const id = s.open('programme-a', 1, 4 * D);
    s.coord.db.prepare("INSERT INTO mail (fromId, fromUuid, toId, runId, kind, subject, body, at, artifacts) VALUES (?, 'u', 'w', ?, 'status', 's', 'b', ?, '[]')").run(COORD, id, T - 2 * H);
    await s.stuck();
    expect(s.verdicts.of(id)!.stuck).toBeNull();
  });

  it('an archived coordinator\'s planned runs read E1 with hours (o2), not a close it cannot warn', async () => {
    const s = setup({ archived: true });
    const id = s.open('programme-a', 1, 60 * D);
    await s.stuck(); await s.lane();
    const v = s.verdicts.of(id)!;
    expect(v.stuck).toMatchObject({ reason: 'owner-gone', cause: 'coordinator-archived' });
    expect(v.stuck!.closes).toEqual({ at: T + 72 * H, armed: false });
  });

  it('an overtaken run E1 reaches keeps its reason and carries closes', async () => {
    const s = setup();
    const first = s.open('programme-a', 1, 40 * D);
    const second = s.open('programme-a', 2, 39 * D);
    s.coord.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, 'planned', 'working', 'coordinator', NULL)").run(second, T - 30 * D);
    s.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = ? WHERE id = ?").run(T - 29 * D, second);
    await s.stuck(); await s.lane();
    expect(s.verdicts.of(first)!.stuck).toMatchObject({ reason: 'overtaken', closes: { at: T + 72 * H } });
  });
});

describe('E1r reads review-of-closed', () => {
  it('target-closed: the review reads review-of-closed and carries closes', async () => {
    const s = setup();
    const work = s.open('programme-a', 1, 40 * D);
    s.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE id = ?").run(T - 30 * D, work);
    const review = s.open('programme-a', 1, 30 * D, { kind: 'review', reviews: work });
    await s.stuck(); await s.lane();
    expect(s.verdicts.of(review)!.stuck).toMatchObject({ reason: 'review-of-closed', cause: 'target-closed', closes: { at: T + H, armed: false } });
  });

  it('E1r\'s later-review arm reads review-of-closed with later-review', async () => {
    const s = setup();
    const work = s.open('programme-a', 1, 40 * D);
    const first = s.open('programme-a', 1, 30 * D, { kind: 'review', reviews: work });
    s.coord.db.prepare("UPDATE runs SET state = 'failed', closedAt = 5 WHERE id = ?").run(first);
    const second = s.open('programme-a', 2, 20 * D, { kind: 'review', reviews: work });
    s.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = 8 WHERE id = ?").run(second);
    s.coord.db.prepare("UPDATE runs SET state = 'planned', closedAt = NULL WHERE id = ?").run(first);
    s.coord.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, 'planned', 'working', 'coordinator', NULL)").run(second, T - 5 * D);
    await s.stuck(); await s.lane();
    expect(s.verdicts.of(first)!.stuck).toMatchObject({ reason: 'review-of-closed', cause: 'later-review', since: T - 5 * D, closes: { armed: false } });
  });
});

describe('the reader joins two clocks and keeps them apart', () => {
  it('a verdict pass keeps closes, and a row never flips to Nothing closes between a verdict pass and a lane pass', async () => {
    const s = setup();
    const id = s.open('programme-a', 1, 4 * D);
    await quietFor48h(s);
    await s.stuck(); await s.lane();
    const closes = s.verdicts.of(id)!.stuck!.closes;
    expect(closes).not.toBeNull();
    for (let i = 0; i < 3; i += 1) {
      s.clock.now += 60_000;
      await s.stuck();
      expect(s.verdicts.of(id)!.stuck!.closes, 'after a verdict pass').not.toBeNull();
      await s.lane();
      expect(s.verdicts.of(id)!.stuck!.closes, 'after a lane pass').not.toBeNull();
    }
  });

  it('a run the lane no longer lists loses closes, and a holding lane clears the map', async () => {
    const s = setup();
    const id = s.open('programme-a', 1, 4 * D);
    await quietFor48h(s);
    await s.stuck(); await s.lane();
    expect(s.verdicts.of(id)!.stuck!.closes).not.toBeNull();
    s.names.list = ['reclaim-paused'];
    await s.lane();
    expect(s.verdicts.of(id)!.stuck!.closes, 'the lane holds').toBeNull();
    s.names.list = [];
    await s.lane();
    expect(s.verdicts.of(id)!.stuck!.closes).not.toBeNull();
    s.coord.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(id);
    await s.lane();
    expect(s.verdicts.of(id)!.stuck?.closes ?? null).toBeNull();
  });

  it('every run the lane lists has a verdict (E1 and E1r)', async () => {
    const s = setup();
    const e1 = s.open('programme-a', 1, 4 * D);
    const work = s.open('programme-b', 1, 40 * D);
    s.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE id = ?").run(T - 30 * D, work);
    const e1r = s.open('programme-b', 1, 30 * D, { kind: 'review', reviews: work });
    await quietFor48h(s);
    await s.stuck(); await s.lane();
    await passesFor(s, 61 * 60_000);
    for (let i = 0; i < 7; i += 1) { await s.lane(); s.clock.now += 9 * 60_000; }
    await s.stuck();
    for (const id of [e1, e1r]) expect(s.verdicts.of(id)!.stuck, `run ${id}`).not.toBeNull();
  });
});
