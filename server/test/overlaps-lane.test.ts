// Overlord W2, plan w2-overlaps.md Task 4: the overlaps arm's one pass (`overlapsPass`) over a fake `OverlapsCoord` and fake
// landings, and its wiring through `FleetWatcher#sweepOverlaps` over a real store. The pass gathers and applies; the deciders
// (`overlaps.ts`) are real here, so a case reads the arm and its deciders together, exactly as the lane runs them.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import type { SessionLanding } from '../../shared/api.js';
import type { PairEvidence } from '../../shared/programmeFacts.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { overlapsPass, type OverlapsCoord, type OverlapsPassDeps } from '../src/coord/overlapsLane.js';
import type { ClaimHistoryRow, PairMoves, StandingPairRow } from '../src/coord/overlaps.js';
import type { CollisionRow } from '../src/coord/claimCollisions.js';
import { CoordStore, type OpenSiblingsResult } from '../src/coord/store.js';
import { FleetWatcher } from '../src/watch.js';
import { seedRoster, testDeps } from './helpers.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const NOW = 1_786_000_000_000;
const MIN = 60_000;
const H = 3_600_000;
const DAY = 24 * H;
const IO = 'server/src/io.ts';

const evidence = (over: Partial<PairEvidence> = {}): PairEvidence => ({
  sources: ['claim-collision'], paths: [IO], pathsCut: false, claimIds: [1], prs: [], triples: 0, hotPaths: [], ...over,
});

type Hist = { ok: true; rows: readonly ClaimHistoryRow[]; cut: boolean } | { ok: false; detail: string };
type Cols = { ok: true; rows: readonly CollisionRow[] } | { ok: false; detail: string };
type Binding = { worker: OpenSiblingsResult | 'throw'; claimant: OpenSiblingsResult | 'throw' };

/** The in-memory coord: every member the pass may reach, a call log, and `applyPairMoves` that applies the moves. */
interface Fake {
  readonly coord: OverlapsCoord;
  readonly calls: string[];
  standing: StandingPairRow[];
  collisions: Cols;
  history: Hist;
  standingRead: 'ok' | 'fail';
  live: (slug: string) => boolean;
  openRun: (slug: string) => boolean;
  stamp: (slug: string) => string;
  bindings: Map<string, Binding>;
  applied: PairMoves[];
}
const RUN_FAIL: OpenSiblingsResult = { ok: false, kind: 'run-unreadable', detail: 'x' };
const sibs = (...programs: string[]): OpenSiblingsResult =>
  ({ ok: true, siblings: programs.map((program, i) => ({ id: i + 1, program, wave: 1, waveOf: 1 })) });

const ALLOWED = ['collisionsSince', 'claimHistory', 'standingPairs', 'newestEpisodes', 'applyPairMoves', 'programmeLive',
  'programmeHasOpenRun', 'goalsStamp', 'bindingsOf'];

function fake(): Fake {
  let nextId = 100;
  const f: Fake = {
    calls: [], standing: [], collisions: { ok: true, rows: [] }, history: { ok: true, rows: [], cut: false },
    standingRead: 'ok', live: () => true, openRun: () => false, stamp: (s) => `stamp-${s}`, bindings: new Map(), applied: [],
    coord: undefined as never,
  };
  const impl = {
    collisionsSince: () => f.collisions,
    claimHistory: () => f.history,
    standingPairs: () => (f.standingRead === 'fail' ? { ok: false as const, detail: 'pairs-x' }
      : { ok: true as const, rows: f.standing, unreadable: [] }),
    newestEpisodes: () => {
      const m = new Map<string, number>();
      for (const r of f.standing) m.set(r.key, Math.max(m.get(r.key) ?? 0, r.episode));
      return { ok: true as const, episodes: m };
    },
    programmeLive: (s: string) => f.live(s),
    programmeHasOpenRun: (s: string) => f.openRun(s),
    goalsStamp: (s: string) => f.stamp(s),
    bindingsOf: (id: string) => {
      const b = f.bindings.get(id) ?? { worker: sibs(), claimant: sibs() };
      const answer = (a: OpenSiblingsResult | 'throw'): OpenSiblingsResult => { if (a === 'throw') throw new Error('bindings threw'); return a; };
      return { sessionId: id, worker: () => answer(b.worker), claimant: () => answer(b.claimant) };
    },
    applyPairMoves: (moves: PairMoves, now: number): number[] => {
      f.applied.push(moves);
      const ids: number[] = [];
      for (const c of moves.close) f.standing = f.standing.filter((r) => r.id !== c.id);
      for (const r of moves.refresh) {
        f.standing = f.standing.map((x) => (x.id !== r.id ? x
          : { ...x, lastSeenAt: r.lastSeenAt, evidence: r.evidence, goalsA: r.goalsA ?? x.goalsA, goalsB: r.goalsB ?? x.goalsB }));
      }
      for (const o of moves.open) {
        const id = nextId++;
        ids.push(id);
        f.standing.push({ id, key: o.sighting.key, kind: o.sighting.kind, a: o.sighting.a, b: o.sighting.b, episode: o.episode,
          firstSeenAt: now, lastSeenAt: o.sighting.newestAt, evidence: o.sighting.evidence, goalsA: o.goalsA, goalsB: o.goalsB, ruled: null });
      }
      return ids;
    },
  };
  // A Proxy so a member outside the allowed nine fails loudly, and every member used is logged.
  (f as { coord: OverlapsCoord }).coord = new Proxy(impl, {
    get(t, k: string) {
      if (!ALLOWED.includes(k)) throw new Error(`the pass reached a member it may not: ${k}`);
      f.calls.push(k);
      return (t as never)[k];
    },
  }) as unknown as OverlapsCoord;
  return f;
}

const standingRow = (key: string, over: Partial<StandingPairRow> = {}): StandingPairRow => {
  const [kind, a, b] = key.split(':') as ['overlap' | 'goal-conflict', string, string];
  return { id: 1, key, kind, a, b, episode: 1, firstSeenAt: NOW - 40 * H, lastSeenAt: NOW - 30 * H, evidence: evidence(),
    goalsA: kind === 'goal-conflict' ? 'old-a' : null, goalsB: kind === 'goal-conflict' ? 'old-b' : null, ruled: null, ...over };
};
const collision = (requesterProgram: string | null, holderProgram: string | null, at = NOW - H, o: Partial<CollisionRow> = {}): CollisionRow => ({
  id: 1, at, project: 'project-a', path: IO, claimedPath: IO, requesterId: 'lane-b-project-a', requesterRun: 2,
  requesterProgram, holderClaimId: 7, holderId: 'lane-a-project-a', holderRun: 1, holderProgram, ...o,
});
const landing = (pr: number, conflicts: { pr: number; paths?: string[] }[] = []): SessionLanding => ({
  at: new Date(NOW).toISOString(), pr, head: 'h', baseRef: 'main', base: { state: 'clean' }, paired: true,
  conflicts: conflicts.map((c) => ({ pr: c.pr, paths: c.paths ?? [IO], pathsCut: false })), unmeasuredWith: [],
  cut: { heads: false, pairs: false, unbound: false },
});
const hist = (claimId: number, program: string | null, ageMin: number, paths: string[] = [IO], project = 'project-a'): ClaimHistoryRow =>
  ({ claimId, project, program, createdAt: NOW - ageMin * MIN, paths });

/** The history A, B, A, B, A on one path, newest first as the store answers. */
const ababa = (): ClaimHistoryRow[] => [
  hist(1, 'prog-a', 50), hist(2, 'prog-b', 40), hist(3, 'prog-a', 30), hist(4, 'prog-b', 20), hist(5, 'prog-a', 10),
].reverse();

const deps = (f: Fake, over: Partial<OverlapsPassDeps> = {}): OverlapsPassDeps => ({
  coord: f.coord, now: () => NOW, landings: () => new Map(), projectOf: () => 'project-a', radarUnread: () => new Set(), ...over,
});
const warnSpy = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

/** Two landings in project-a that conflict: s-a (pr 10) and s-b (pr 20). */
const radarPair = (): { landings: () => Map<string, SessionLanding>; projectOf: (id: string) => string | null } => ({
  landings: () => new Map([['s-a', landing(10, [{ pr: 20 }])], ['s-b', landing(20, [{ pr: 10 }])]]),
  projectOf: () => 'project-a',
});

describe('overlaps from refused claims', () => {
  it('a collision between prog-a and prog-b runs opens overlap:prog-a:prog-b episode 1, and the next pass refreshes it', async () => {
    const f = fake();
    f.collisions = { ok: true, rows: [collision('prog-b', 'prog-a')] };
    expect(await overlapsPass(deps(f))).toEqual({ opened: 1, refreshed: 0, closed: 0, unattributed: 0, unread: null, historyCut: false, signalCut: false });
    expect(f.standing).toHaveLength(1);
    expect(f.standing[0]).toMatchObject({ key: 'overlap:prog-a:prog-b', episode: 1, kind: 'overlap' });
    expect(f.standing[0]!.evidence).toMatchObject({ sources: ['claim-collision'], paths: [IO], claimIds: [7] });
    expect(await overlapsPass(deps(f))).toMatchObject({ opened: 0, refreshed: 1, closed: 0, unread: null });
    expect(f.standing).toHaveLength(1);
    expect(f.standing[0]).toMatchObject({ episode: 1 });
  });

  it('a collision whose side has no run is counted unattributed and sights nothing', async () => {
    const f = fake();
    f.collisions = { ok: true, rows: [collision(null, 'prog-a')] };
    expect(await overlapsPass(deps(f))).toMatchObject({ opened: 0, unattributed: 1, unread: null });
    expect(f.standing).toEqual([]);
  });
});

describe('overlaps from the radar', () => {
  it('two conflicting landings in project-a, a prog-a worker and a prog-b coordinator, open one overlap naming both pull requests', async () => {
    const f = fake();
    f.bindings.set('s-a', { worker: sibs('prog-a'), claimant: sibs() });
    f.bindings.set('s-b', { worker: sibs(), claimant: sibs('prog-b') });
    const r = await overlapsPass(deps(f, radarPair()));
    expect(r).toMatchObject({ opened: 1, unattributed: 0, unread: null });
    expect(f.standing).toHaveLength(1);
    expect(f.standing[0]).toMatchObject({ key: 'overlap:prog-a:prog-b' });
    expect(f.standing[0]!.evidence).toMatchObject({ sources: ['radar'], prs: [10, 20], paths: [IO] });
  });

  it('the same pull request number in project-a and project-b never pairs across projects', async () => {
    const f = fake();
    f.bindings.set('s-a', { worker: sibs('prog-a'), claimant: sibs() });
    f.bindings.set('s-x', { worker: sibs('prog-b'), claimant: sibs() });
    const projects: Record<string, string> = { 's-a': 'project-a', 's-x': 'project-b' };
    const landings = new Map([['s-a', landing(10, [{ pr: 20 }])], ['s-x', landing(20)]]);
    const r = await overlapsPass(deps(f, { landings: () => landings, projectOf: (id) => projects[id] ?? null }));
    expect(r).toMatchObject({ opened: 0, unattributed: 1, unread: null });
    expect(f.standing).toEqual([]);
    // Control: the same two sessions in one project do pair.
    const g = fake();
    g.bindings = f.bindings;
    expect(await overlapsPass(deps(g, { landings: () => landings, projectOf: () => 'project-a' }))).toMatchObject({ opened: 1, unattributed: 0 });
  });

  it('a session with no open run is counted unattributed and makes no pair', async () => {
    const f = fake();
    f.bindings.set('s-a', { worker: sibs('prog-a'), claimant: sibs() });
    // s-b has no open run as worker or coordinator.
    const r = await overlapsPass(deps(f, radarPair()));
    expect(r).toMatchObject({ opened: 0, unattributed: 1, unread: null });
    expect(f.standing).toEqual([]);
  });

  it.each([
    ['worker read fails', { worker: RUN_FAIL, claimant: sibs() } as Binding],
    ['claimant read fails', { worker: sibs(), claimant: RUN_FAIL } as Binding],
    ['worker read throws', { worker: 'throw', claimant: sibs() } as Binding],
    ['claimant read throws', { worker: sibs(), claimant: 'throw' } as Binding],
  ])('a bindingsOf whose %s answers unread sides and counts nothing unattributed', async (_n, bad) => {
    const f = fake();
    warnSpy();
    f.bindings.set('s-a', { worker: sibs('prog-a'), claimant: sibs() });
    f.bindings.set('s-b', bad);
    const r = await overlapsPass(deps(f, radarPair()));
    expect(r).toMatchObject({ opened: 0, unattributed: 0, unread: 'sides' });
    expect(f.standing).toEqual([]);
  });

  it('a failing bindingsOf lapses no standing overlap that would otherwise lapse', async () => {
    const f = fake();
    warnSpy();
    f.standing = [standingRow('overlap:prog-a:prog-b')];
    f.bindings.set('s-b', { worker: RUN_FAIL, claimant: sibs() });
    expect(await overlapsPass(deps(f, radarPair()))).toMatchObject({ closed: 0, unread: 'sides' });
    expect(f.standing).toHaveLength(1);
  });
});

describe('goal conflicts from the claims history', () => {
  it('A, B, A, B, A opens goal-conflict:prog-a:prog-b with both goals stamps', async () => {
    const f = fake();
    f.history = { ok: true, rows: ababa(), cut: false };
    expect(await overlapsPass(deps(f))).toMatchObject({ opened: 1, unread: null, historyCut: false, signalCut: false });
    expect(f.standing).toHaveLength(1);
    expect(f.standing[0]).toMatchObject({ key: 'goal-conflict:prog-a:prog-b', kind: 'goal-conflict', episode: 1,
      goalsA: 'stamp-prog-a', goalsB: 'stamp-prog-b' });
    expect(f.standing[0]!.evidence).toMatchObject({ sources: ['claim-history'], triples: 2 });
  });

  it('A, B, A alone opens nothing', async () => {
    const f = fake();
    f.history = { ok: true, rows: [hist(3, 'prog-a', 10), hist(2, 'prog-b', 20), hist(1, 'prog-a', 30)], cut: false };
    expect(await overlapsPass(deps(f))).toMatchObject({ opened: 0, unread: null });
    expect(f.standing).toEqual([]);
  });

  it('a failing history read answers unread history and lapses no goal conflict that would otherwise lapse', async () => {
    const f = fake();
    warnSpy();
    f.standing = [standingRow('goal-conflict:prog-a:prog-b', { lastSeenAt: NOW - 15 * DAY })];
    f.history = { ok: false, detail: 'hist-x' };
    expect(await overlapsPass(deps(f))).toMatchObject({ closed: 0, unread: 'history' });
    expect(f.standing).toHaveLength(1);
    // Control: the same standing row with a history that was read (and shows nothing) lapses.
    f.history = { ok: true, rows: [], cut: false };
    expect(await overlapsPass(deps(f))).toMatchObject({ closed: 1, unread: null });
    expect(f.standing).toEqual([]);
  });

  it('a throwing goalsStamp moves nothing for that key and still opens an overlap elsewhere', async () => {
    const f = fake();
    f.history = { ok: true, rows: ababa(), cut: false };
    f.collisions = { ok: true, rows: [collision('prog-d', 'prog-c')] };
    f.stamp = (s) => { if (s === 'prog-a') throw new Error('stamp threw'); return `stamp-${s}`; };
    expect(await overlapsPass(deps(f))).toMatchObject({ opened: 1, closed: 0, unread: null });
    expect(f.standing.map((r) => r.key)).toEqual(['overlap:prog-c:prog-d']);
  });
});

describe('a source the pass could not read closes nothing', () => {
  it('a failed collisions read closes no overlap that would otherwise lapse (and answers unread collisions)', async () => {
    const f = fake();
    const warn = warnSpy();
    f.standing = [standingRow('overlap:prog-a:prog-b')];   // lastSeenAt 30 h ago: lapses at 24 h
    f.collisions = { ok: false, detail: 'col-x' };
    expect(await overlapsPass(deps(f))).toMatchObject({ closed: 0, unread: 'collisions' });
    expect(f.standing).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe('ccrc-server: overlaps: collisions read failed: col-x');
    // Control: with the read made, the same row lapses.
    f.collisions = { ok: true, rows: [] };
    expect(await overlapsPass(deps(f))).toMatchObject({ closed: 1, unread: null });
    expect(f.standing).toEqual([]);
  });

  it.each([
    ['names project-a', () => new Set(['project-a']) as ReadonlySet<string> | 'listing'],
    ['answers listing', () => 'listing' as ReadonlySet<string> | 'listing'],
  ])('a radarUnread that %s answers unread radar and closes no overlap that would otherwise lapse', async (_n, radarUnread) => {
    const f = fake();
    const warn = warnSpy();
    f.standing = [standingRow('overlap:prog-a:prog-b')];
    expect(await overlapsPass(deps(f, { radarUnread }))).toMatchObject({ closed: 0, unread: 'radar' });
    expect(f.standing).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^ccrc-server: overlaps: radar read failed: /);
    // Control: the same pass with the radar read lapses it.
    expect(await overlapsPass(deps(f))).toMatchObject({ closed: 1, unread: null });
  });

  it('a failed pairs read records nothing and answers unread pairs', async () => {
    const f = fake();
    warnSpy();
    f.standingRead = 'fail';
    f.collisions = { ok: true, rows: [collision('prog-b', 'prog-a')] };
    expect(await overlapsPass(deps(f))).toEqual({ opened: 0, refreshed: 0, closed: 0, unattributed: 0, unread: 'pairs', historyCut: false, signalCut: false });
    expect(f.applied).toEqual([]);
  });
});

describe('the cuts', () => {
  it('a history at the cap answers historyCut with exactly one warning', async () => {
    const f = fake();
    const warn = warnSpy();
    f.history = { ok: true, rows: [], cut: true };
    expect(await overlapsPass(deps(f))).toMatchObject({ historyCut: true, signalCut: false, unread: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^ccrc-server: overlaps: the claims history is cut at 5000 rows/);
  });

  it('a decider cut answers signalCut with exactly one warning', async () => {
    // One path claimed by two programmes in turn, 2100 rows: the index compares every earlier row (about n^2 / 2 = 2.2M steps),
    // past GOAL_CONFLICT_STEPS_MAX (2M), so the decider stops and answers cut. The real decider, not a stub.
    const f = fake();
    const warn = warnSpy();
    const rows: ClaimHistoryRow[] = [];
    for (let i = 0; i < 2100; i++) rows.push(hist(i + 1, i % 2 === 0 ? 'prog-a' : 'prog-b', 2100 - i));
    f.history = { ok: true, rows: rows.reverse(), cut: false };
    const r = await overlapsPass(deps(f));
    expect(r).toMatchObject({ signalCut: true, historyCut: false, unread: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^ccrc-server: overlaps: the goal-conflict signal stopped at its step bound/);
  }, 60_000);

  it('a pass with nothing wrong warns nothing', async () => {
    const f = fake();
    const warn = warnSpy();
    await overlapsPass(deps(f));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('what the pass touches', () => {
  it('reads through the nine members and writes only through applyPairMoves, once, with no mail', async () => {
    const f = fake();
    f.collisions = { ok: true, rows: [collision('prog-b', 'prog-a')] };
    f.history = { ok: true, rows: ababa(), cut: false };
    f.bindings.set('s-a', { worker: sibs('prog-a'), claimant: sibs() });
    f.bindings.set('s-b', { worker: sibs(), claimant: sibs('prog-c') });
    await overlapsPass(deps(f, radarPair()));
    // The Proxy would have thrown on any other member (mail, a feed row, a push are not on the type or the fake).
    // `programmeHasOpenRun` is asked only to lapse a goal conflict, which this pass has none to lapse.
    expect(new Set(f.calls)).toEqual(new Set(ALLOWED.filter((m) => m !== 'programmeHasOpenRun')));
    expect(f.calls.filter((c) => c === 'applyPairMoves')).toHaveLength(1);
    expect(f.applied).toHaveLength(1);
    // The read members never changed the fake's rows except through the one apply.
    expect(f.standing.map((r) => r.key).sort()).toEqual([
      'goal-conflict:prog-a:prog-b', 'overlap:prog-a:prog-b', 'overlap:prog-a:prog-c']);
  });
});

describe('the watcher wiring', () => {
  it('sweepOverlaps runs one pass over the store and records the pair a refused claim made', async () => {
    const home = mkTmp('ccrc-overlaps-wire-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const addProgram = (slug: string): void => {
      coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, 1, 'active')").run(slug, slug);
    };
    const addRun = (program: string): number => Number(coord.db.prepare(
      "INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, 1, 1, 'project-a', 'working', 'op-a', 1)",
    ).run(program).lastInsertRowid);
    addProgram('prog-a'); addProgram('prog-b');
    const runA = addRun('prog-a');
    const runB = addRun('prog-b');
    const at = Date.now();
    const held = coord.claimAttempt({ project: 'project-a', paths: [IO], sessionId: 'lane-a-project-a', uuid: 'u-1', runId: runA,
      intent: 'holding', now: at - 2000 });
    expect(held).toMatchObject({ ok: true });
    const refused = coord.claimAttempt({ project: 'project-a', paths: [IO], sessionId: 'lane-b-project-a', uuid: 'u-2', runId: runB,
      intent: 'colliding', now: at - 1000 });
    expect(refused).toMatchObject({ ok: false, why: 'conflict' });

    const wdeps = { ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg, coord };
    const w = quietAtTestEnd(new FleetWatcher(wdeps as never, new Bus(), 10_000));
    warnSpy();   // the radar has not run, so the pass warns that it read no radar: expected and not the case's subject
    await w.sweepOverlaps([]);
    const read = coord.standingPairs();
    if (!read.ok) throw new Error('unreachable');
    expect(read.rows.map((r) => [r.key, r.episode])).toEqual([['overlap:prog-a:prog-b', 1]]);
    expect(read.rows[0]!.evidence).toMatchObject({ sources: ['claim-collision'], paths: [IO] });
  });
});
