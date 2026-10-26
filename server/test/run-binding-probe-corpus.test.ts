// ARCH-60 follow-up (#1407, part of #795): THE PROBE CORPUS of PR #1573. One case per shape a review round reported (rounds
// 1 to 7), each read back the way the server reads it: the child's parent (`childParentOf`), its claimants
// (`claimantsOf`), the card (`sessionRunRead`), the coordinators' `childIds` (`withChildIds`), the hold (`heldFor`) and,
// where the shape has one, the birth a later wave was stamped with.
//
// THE ACCEPTANCE BAR: on every shape, this branch answers what the merge base answers, or a better answer. Each case pins
// the merge base's answer (`base`, recorded by running this file over the merge-base sources with
// BINDING_CORPUS_EXPECT=base, which asserts that column there) and, where this branch answers differently, its answer
// (`head`) with why it is better. Without that variable the file asserts this branch's answer. A case whose two answers are the same wrong answer is an
// INHERITED residual: out of scope for this PR, named in the plan note's "Residuals, inherited from main" section and
// left to the follow-up for D6 gap 1 (an unborn incarnation that reuses a workspace name still inherits a ghost run).
//
// The file uses only what the merge base also exports, so it runs over either source tree unchanged. A fixture writes
// the rows a build would write; where the shape says an OLDER build or the merge-base build wrote a row, the fixture
// writes that build's columns itself, so the rows are the same under either source tree.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { childParentOf, claimantsOf } from '../src/coord/runBinding.js';
import { incarnationsOfSessions, sessionRunRead, withChildIds } from '../src/coord/runWire.js';
import { heldFor } from '../src/coord/heldFor.js';
import { mkTmp } from './tmpHelpers.js';

const W = 'demo-w';
const T0 = 1_700_000_000_000;
/** Instant `k` of a fixture: T0, T1, ... one hour apart, so an answer names its birth as `T<k>`. */
const t = (k: number): number => T0 + k * 3_600_000;
const tName = (ms: number | null): string | null => {
  if (ms === null) return null;
  const k = (ms - T0) / 3_600_000;
  return Number.isInteger(k) ? `T${k}` : `T0+${ms - T0}ms`;
};

class Fixture {
  readonly s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-binding-corpus-'), '.ccrc', 'coord.db')));
  private readonly labels = new Map<number, string>();
  label = (id: number | null | undefined): string | null => (id === null || id === undefined ? null : this.labels.get(id) ?? `#${id}`);
  /** A run planned by `claimedBy`, opened at `openedAt`. */
  open(label: string, claimedBy: string | null, openedAt: number): number {
    const id = (this.s.openRun({ program: `prog-${label}`, title: label, project: 'p', wave: 1, waveOf: null, claimedBy: claimedBy ?? 'nobody' }) as { id: number }).id;
    this.s.db.prepare('UPDATE runs SET openedAt = ?, claimedBy = ?, coordProject = ? WHERE id = ?').run(openedAt, claimedBy, 'p', id);
    this.labels.set(id, label);
    return id;
  }
  /** The fresh-spawn arm: the dispatch starts at `at` and the bind records `at` as the birth (placeable). */
  mint(id: number, at: number, session = W): void { this.s.markDispatchStarted(id, at); this.s.setSession(id, session, at); }
  /** A birth recorded on the run with no matching `dispatchStartedAt` (unplaceable: the re-stamped arm). */
  recordUnplaceable(id: number, at: number, session = W): void { this.s.setSession(id, session, at); }
  /** The adopted arm of `spawnFresh`: the dispatch starts at `at`, the bind names the id with an explicit null birth. */
  adopt(id: number, at: number, session = W): void { this.s.markDispatchStarted(id, at); this.s.setSession(id, session, null); }
  /** THIS build's later-wave bind (two-argument `setSession`: the occupant stamp). */
  bind(id: number, session = W): void { this.s.setSession(id, session); }
  /** A bind written by a build with its own birth columns: `at` (the merge-base build's stamp) or none (an OLDER build). */
  bindAs(id: number, at: number | null, session = W): void {
    this.s.setSession(id, session);
    this.s.db.prepare('UPDATE runs SET sessionBornAt = ?, sessionBornFor = ? WHERE id = ?').run(at, at === null ? null : session, id);
  }
  /** An OLDER build redraws the same id on run `id`: only its `dispatchStartedAt` moves. */
  redraw(id: number, at: number): void { this.s.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(at, id); }
  /** An OLDER build moves run `id`'s `sessionId` (to another id, or clears it) and leaves both birth columns alone. */
  olderMove(id: number, session: string | null): void { this.s.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(session, id); }
  /** A failed fresh-spawn attempt: the dispatch started at `at`, no session was bound. */
  dispatchStarted(id: number, at: number): void { this.s.markDispatchStarted(id, at); }
  done(id: number): void { this.s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id); }
  stampOf(id: number): string | null {
    const r = this.s.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(id) as { sessionBornAt: number | null; sessionBornFor: string | null };
    return r.sessionBornAt === null ? null : `${tName(r.sessionBornAt)} for ${r.sessionBornFor}`;
  }
}

/** What the server answers about the worker: every reader that takes its incarnation, from its registry mark. */
interface Answer {
  readonly parent: string | null;
  readonly claimants: readonly string[];
  readonly card: string | null;
  readonly childIds: Readonly<Record<string, readonly (string | null)[]>>;
  readonly held: string;
  readonly stamp?: string | null;
}

interface Shape {
  readonly f: Fixture;
  /** The run the worker's `.child` mark names, or `null` for a session with no mark. */
  readonly mark: number | null;
  /** The coordinators whose `childIds` the answer lists. */
  readonly coords: readonly string[];
  /** The later wave whose recorded birth the answer reports. */
  readonly wave?: number;
}

async function answer({ f, mark, coords, wave }: Shape): Promise<Answer> {
  const { s } = f;
  const child = mark === null ? { kind: 'none' as const } : { kind: 'child' as const, runId: mark };
  const inc = incarnationsOfSessions(s, [{ id: W, child }]).get(W)!;
  const minting = mark === null ? null : s.run(mark);
  const series = s.bindingRunsOf(W);
  if (!series.ok) throw new Error(series.detail);
  const minter = minting !== null && minting.ok && minting.run !== null ? minting.run.claimedBy : null;
  const card = sessionRunRead(s, W, inc);
  const summaries = coords.map((c) => ({ id: 0, claimedBy: c })) as never;
  const withIds = withChildIds(s, summaries, new Map([[W, inc]]), () => undefined) as unknown as { childIds?: number[] }[];
  const verdict = await heldFor({ coord: s } as never, W, child, [], t(99));
  const held = [verdict.kind, 'parent' in verdict ? verdict.parent : null, 'reason' in verdict ? verdict.reason : null]
    .filter((x) => x !== null).join(':');
  return {
    parent: childParentOf(series.runs, minter, inc),
    claimants: claimantsOf(series.runs, inc),
    card: card.ok ? f.label(card.openRun?.id) : `unreadable: ${card.detail}`,
    childIds: Object.fromEntries(coords.map((c, i) => [c, (withIds[i]!.childIds ?? []).map((id) => f.label(id))])),
    held,
    ...(wave === undefined ? {} : { stamp: f.stampOf(wave) }),
  };
}

type Verdict = 'better' | 'same';
interface Case {
  readonly shape: string;
  /** The review round that reported it. */
  readonly round: string;
  readonly build: () => Shape;
  readonly base: Answer;
  /** This branch's answer, when it differs from the merge base's; absent, it is the merge base's. */
  readonly head?: Answer;
  readonly verdict: Verdict;
  /** Why `head` is better, or for a `same` case that is wrong on both, the residual it is. */
  readonly why?: string;
  readonly residual?: 'inherited';
}

const CORPUS: readonly Case[] = [
  {
    shape: 'GAP 2: a later wave bound to a worker whose minting run recorded a birth it cannot place',
    round: 'PR scope (gap 2)',
    build: () => {
      const f = new Fixture();
      const w1 = f.open('w1', 'coord-1', t(5) - 1000);
      f.recordUnplaceable(w1, t(5));
      const w2 = f.open('w2', 'coord-1', t(5) - 1000);
      f.bind(w2);
      return { f, mark: w1, coords: ['coord-1'], wave: w2 };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'w2', childIds: { 'coord-1': ['w1', 'w2'] }, held: 'released:coord-1:parent-not-live', stamp: null },
    head: { parent: 'coord-1', claimants: ['coord-1'], card: 'w2', childIds: { 'coord-1': ['w1', 'w2'] }, held: 'released:coord-1:parent-not-live', stamp: 'T5 for demo-w' },
    verdict: 'better',
    why: 'the later wave records the birth the worker\'s own minting run recorded (T5); the merge base recorded none',
  },
  {
    shape: 'the dup-arm re-open over an unplaceable wave 1, wave 1 then done',
    round: 'PR scope (dup arm)',
    build: () => {
      const f = new Fixture();
      const wave2 = f.open('wave2', 'coord-1', t(5) - 1000);
      const wave1 = f.open('wave1', 'coord-1', t(5) - 10);
      f.recordUnplaceable(wave1, t(5));
      f.bind(wave2);
      f.done(wave1);
      return { f, mark: wave1, coords: ['coord-1'], wave: wave2 };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'wave2', childIds: { 'coord-1': ['wave2'] }, held: 'released:coord-1:parent-not-live', stamp: null },
    head: { parent: 'coord-1', claimants: ['coord-1'], card: 'wave2', childIds: { 'coord-1': ['wave2'] }, held: 'released:coord-1:parent-not-live', stamp: 'T5 for demo-w' },
    verdict: 'better',
    why: 'wave 2 records the birth wave 1 recorded (T5); the merge base recorded none',
  },
  {
    shape: 'the dup-arm re-open over a placeable wave 1, wave 1 then done',
    round: 'PR scope (dup arm)',
    build: () => {
      const f = new Fixture();
      const wave2 = f.open('wave2', 'coord-1', t(5) - 1000);
      const wave1 = f.open('wave1', 'coord-1', t(5) - 10);
      f.mint(wave1, t(5));
      f.bind(wave2);
      f.done(wave1);
      return { f, mark: wave1, coords: ['coord-1'], wave: wave2 };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'wave2', childIds: { 'coord-1': ['wave2'] }, held: 'released:coord-1:parent-not-live', stamp: 'T5 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'GAP 1 (unplaceable): an earlier occupant\'s run still open, the live minting run done',
    round: 'PR scope (gap 1); round 4 (card vs ghost childIds)',
    build: () => {
      const f = new Fixture();
      const ghost = f.open('ghost', 'coord-gone', t(0));
      f.recordUnplaceable(ghost, t(0));
      const live = f.open('live', 'coord-live', t(5) + 1000);
      f.recordUnplaceable(live, t(5));
      f.done(live);
      return { f, mark: live, coords: ['coord-gone', 'coord-live'] };
    },
    base: { parent: 'coord-gone', claimants: ['coord-gone'], card: 'ghost', childIds: { 'coord-gone': ['ghost'], 'coord-live': [] }, held: 'released:operator:run-other-programme' },
    verdict: 'same',
    why: 'D6 gap 1: the earlier occupant\'s open run is the parent (coord-gone), and the card and coord-gone\'s childIds show it',
    residual: 'inherited',
  },
  {
    shape: 'GAP 1 (not-a-child): a manual workspace with no mark',
    round: 'PR scope (gap 1)',
    build: () => {
      const f = new Fixture();
      const manual = f.open('manual', 'coord-1', t(0));
      f.bind(manual);
      return { f, mark: null, coords: ['coord-1'] };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'manual', childIds: { 'coord-1': ['manual'] }, held: 'not-a-child' },
    verdict: 'same',
  },
  {
    shape: 'a placeable older birth, a newer unplaceable one, then a later wave',
    round: 'round 1 (bound-birth pin)',
    build: () => {
      const f = new Fixture();
      const a = f.open('a', 'coord-1', t(0));
      f.mint(a, t(0));
      const minting = f.open('minting', 'coord-1', t(0) + 1);
      f.recordUnplaceable(minting, t(5));
      const c = f.open('c', 'coord-1', t(5) + 2000);
      f.bind(c);
      return { f, mark: minting, coords: ['coord-1'], wave: c };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'c', childIds: { 'coord-1': ['a', 'minting', 'c'] }, held: 'released:coord-1:parent-not-live', stamp: 'T0 for demo-w' },
    verdict: 'same',
    why: 'the stamp is the merge base\'s (T0, the newest placeable birth): preferring the newer unplaceable birth made a born worker worse (round 6, S4). coord-1\'s childIds list the earlier occupant\'s open run a on both (inherited, D6 gap 1)',
  },
  {
    shape: 'a reused name (earlier occupant placeable and done), the live minting run unplaceable and open, then a later wave',
    round: 'round 1 (stamp equals anchor)',
    build: () => {
      const f = new Fixture();
      const earlier = f.open('earlier', 'coord-gone', t(0));
      f.mint(earlier, t(0));
      f.done(earlier);
      const minting = f.open('minting', 'coord-1', t(5) - 1000);
      f.recordUnplaceable(minting, t(5));
      const c = f.open('c', 'coord-1', t(5) + 10);
      f.bind(c);
      return { f, mark: minting, coords: ['coord-1', 'coord-gone'], wave: c };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'c', childIds: { 'coord-1': ['minting', 'c'], 'coord-gone': [] }, held: 'released:coord-1:parent-not-live', stamp: 'T0 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'a reused name, the live minting run unplaceable and done, then a later wave',
    round: 'round 1 (the wave keeps its parent)',
    build: () => {
      const f = new Fixture();
      const earlier = f.open('earlier', 'coord-gone', t(0));
      f.mint(earlier, t(0));
      f.done(earlier);
      const minting = f.open('minting', 'coord-1', t(5) - 1000);
      f.recordUnplaceable(minting, t(5));
      f.done(minting);
      const c = f.open('c', 'coord-1', t(5) + 10);
      f.bind(c);
      return { f, mark: minting, coords: ['coord-1'], wave: c };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'c', childIds: { 'coord-1': ['c'] }, held: 'released:coord-1:parent-not-live', stamp: 'T0 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'a pre-planned wave 2 bound after wave 1 recorded its birth and before wave 1\'s dispatch moved to it, wave 1 done',
    round: 'round 1 (readers: the original order)',
    build: () => {
      const f = new Fixture();
      const w1 = f.open('w1', 'coord-1', t(5) - 1000);
      const w2 = f.open('w2', 'coord-1', t(5) - 1000);
      const g = f.open('g', 'coord-ghost', t(5) - 1000);
      f.bindAs(g, null);
      f.recordUnplaceable(w1, t(5));
      f.bind(w2);
      f.redraw(w1, t(5));
      f.done(w1);
      return { f, mark: w1, coords: ['coord-1', 'coord-ghost'], wave: w2 };
    },
    base: { parent: 'coord-1', claimants: [], card: null, childIds: { 'coord-1': [], 'coord-ghost': [] }, held: 'released:coord-1:parent-not-live', stamp: null },
    head: { parent: 'coord-1', claimants: ['coord-1'], card: 'w2', childIds: { 'coord-1': ['w2'], 'coord-ghost': [] }, held: 'released:coord-1:parent-not-live', stamp: 'T5 for demo-w' },
    verdict: 'better',
    why: 'wave 2 records T5 and is bound to the live worker (claimants, card, coord-1\'s childIds); the merge base left it undecided, so the card showed no open run',
  },
  {
    shape: 'a newer birth for the id on a run an older build rebound away, then a later wave',
    round: 'round 2 (rebound-run pin)',
    build: () => {
      const f = new Fixture();
      const earlier = f.open('earlier', 'coord-gone', t(0));
      f.mint(earlier, t(0));
      f.done(earlier);
      const minting = f.open('minting', 'coord-1', t(5) - 1000);
      f.recordUnplaceable(minting, t(5));
      const rebound = f.open('rebound', 'coord-x', t(5) + 100);
      f.recordUnplaceable(rebound, t(6));
      f.s.db.prepare("UPDATE runs SET sessionId = 'demo-other' WHERE id = ?").run(rebound);
      const c = f.open('c', 'coord-1', t(5) + 10);
      f.bind(c);
      return { f, mark: minting, coords: ['coord-1'], wave: c };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'c', childIds: { 'coord-1': ['minting', 'c'] }, held: 'released:coord-1:parent-not-live', stamp: 'T0 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'the adopted arm under a recycled name, the earlier occupant\'s run still open with the LOWER id, then a later wave',
    round: 'round 3 (adopted read-back)',
    build: () => {
      const f = new Fixture();
      const earlier = f.open('earlier', 'coord-gone', t(0));
      f.mint(earlier, t(1));
      const adopting = f.open('adopting', 'coord-live', t(0) + 1000);
      f.adopt(adopting, t(2));
      const wave2 = f.open('wave2', 'coord-live', t(3));
      f.bind(wave2);
      return { f, mark: adopting, coords: ['coord-live', 'coord-gone'], wave: wave2 };
    },
    base: { parent: 'coord-live', claimants: ['coord-live', 'coord-gone'], card: 'wave2', childIds: { 'coord-live': ['adopting', 'wave2'], 'coord-gone': ['earlier'] }, held: 'released:coord-live:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'a cross-build rollback with a same-id redraw after a later mint (minting run done)',
    round: 'round 4 (rollback probe)',
    build: () => {
      const f = new Fixture();
      const r = f.open('R', 'coord-live', t(1) - 100);
      f.mint(r, t(1));
      const wa = f.open('WA', 'coord-gone', t(1) + 100);
      f.bind(wa);
      const rx = f.open('Rx', 'coord-x', t(2) - 100);
      f.mint(rx, t(2));
      f.done(rx);
      f.redraw(r, t(4));
      f.done(r);
      const w2 = f.open('W2', 'coord-live', t(4) + 100);
      f.bind(w2);
      return { f, mark: r, coords: ['coord-live', 'coord-gone'], wave: w2 };
    },
    base: { parent: 'coord-live', claimants: ['coord-live', 'coord-gone'], card: 'W2', childIds: { 'coord-live': ['W2'], 'coord-gone': ['WA'] }, held: 'released:coord-live:parent-not-live', stamp: 'T2 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'R1: a cross-build rollback where the live occupant\'s wave carries an OLDER birth (the merge-base build\'s stamp)',
    round: 'round 5 (R1)',
    build: () => {
      const f = new Fixture();
      const r0 = f.open('R0', 'coord-r0', t(0) - 100);
      f.mint(r0, t(0));
      f.done(r0);
      const r = f.open('R', 'coord-live', t(1) - 100);
      f.mint(r, t(1));
      const wa = f.open('WA', 'coord-gone', t(1) + 100);
      f.bindAs(wa, t(1));
      f.redraw(r, t(4));
      const w2 = f.open('W2', 'coord-live', t(4) + 100);
      f.bindAs(w2, t(0));
      return { f, mark: r, coords: ['coord-live', 'coord-gone'] };
    },
    base: { parent: 'coord-live', claimants: ['coord-live', 'coord-gone'], card: 'W2', childIds: { 'coord-live': ['R', 'W2'], 'coord-gone': ['WA'] }, held: 'released:coord-live:parent-not-live' },
    verdict: 'same',
  },
  {
    shape: 'R2: an older build binds the live occupant\'s pre-planned wave with no stamp',
    round: 'round 5 (R2)',
    build: () => {
      const f = new Fixture();
      const r = f.open('R', 'coord-live', t(0));
      const wa = f.open('WA', 'coord-gone', t(0));
      const l = f.open('L', 'coord-live', t(0));
      f.mint(r, t(1));
      f.bindAs(wa, t(1));
      f.redraw(r, t(4));
      f.bindAs(l, null);
      return { f, mark: r, coords: ['coord-live', 'coord-gone'] };
    },
    base: { parent: 'coord-live', claimants: ['coord-live', 'coord-gone'], card: 'L', childIds: { 'coord-live': ['R', 'L'], 'coord-gone': ['WA'] }, held: 'released:coord-live:parent-not-live' },
    verdict: 'same',
  },
  {
    shape: 'R3: a run planned before the birth, a failed fresh-spawn attempt after it, then rebound to the worker by the dup arm',
    round: 'round 5 (R3)',
    build: () => {
      const f = new Fixture();
      const x = f.open('X', 'coord-b', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      f.dispatchStarted(x, t(2));
      f.bind(x);
      return { f, mark: m, coords: ['coord-a', 'coord-b'], wave: x };
    },
    base: { parent: 'coord-b', claimants: ['coord-b'], card: 'X', childIds: { 'coord-a': [], 'coord-b': ['X'] }, held: 'released:operator:run-other-programme', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'residual: the adopted arm with the earlier occupant\'s open run holding the HIGHER id',
    round: 'round 5 (inherited)',
    build: () => {
      const f = new Fixture();
      const adopting = f.open('adopting', 'coord-live', t(0));
      const earlier = f.open('earlier', 'coord-gone', t(0) + 1000);
      f.mint(earlier, t(1));
      f.adopt(adopting, t(2));
      return { f, mark: adopting, coords: ['coord-live', 'coord-gone'] };
    },
    base: { parent: 'coord-gone', claimants: ['coord-gone', 'coord-live'], card: 'earlier', childIds: { 'coord-live': ['adopting'], 'coord-gone': ['earlier'] }, held: 'released:operator:run-other-programme' },
    verdict: 'same',
    why: 'D-6993 under D6 gap 1: the earlier occupant\'s open run holds the higher id, so it is the parent (coord-gone)',
    residual: 'inherited',
  },
  {
    shape: 'residual: a cross-build rollback with C\'s minting run R still open and a third coordinator\'s open wave',
    round: 'round 5 (inherited)',
    build: () => {
      const f = new Fixture();
      const r = f.open('R', 'coord-live', t(1) - 100);
      f.mint(r, t(1));
      const w3 = f.open('W3', 'coord-third', t(1) + 100);
      f.bind(w3);
      f.redraw(r, t(4));
      return { f, mark: r, coords: ['coord-live', 'coord-third'] };
    },
    base: { parent: 'coord-third', claimants: ['coord-third', 'coord-live'], card: 'W3', childIds: { 'coord-live': ['R'], 'coord-third': ['W3'] }, held: 'released:operator:run-other-programme' },
    verdict: 'same',
    why: 'D6 gap 1: the third coordinator\'s wave, bound to an earlier occupant, is the parent (coord-third), not the minting run\'s coord-live',
    residual: 'inherited',
  },
  // Round 6. An OLDER build (every build before the bind cleared the births and stamped nothing) left a run R that names the
  // worker, records no birth and has a dispatchStartedAt after the birth: a failed fresh spawn, then an open-route or
  // dup-arm rebind to the worker. Live databases hold this shape. A later wave bound by THIS build must still record the
  // placeable birth of the worker's own minting run.
  {
    shape: 'V1: a pre-planned wave of the minter, an older build\'s rebind of a failed spawn after the birth (R open), the minting run open',
    round: 'round 6 (V1)',
    build: () => {
      const f = new Fixture();
      const w = f.open('W', 'coord-a', t(0));
      const r = f.open('R', 'coord-b', t(0) + 50);
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.dispatchStarted(r, t(2));
      f.bindAs(r, null);
      f.bind(w);
      return { f, mark: m, coords: ['coord-a', 'coord-b'], wave: w };
    },
    base: { parent: 'coord-a', claimants: ['coord-a'], card: 'M', childIds: { 'coord-a': ['W', 'M'], 'coord-b': [] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'V1b: a pre-planned wave of the minter, an older build\'s rebind of a failed spawn after the birth (R open), the minting run done',
    round: 'round 6 (V1b)',
    build: () => {
      const f = new Fixture();
      const w = f.open('W', 'coord-a', t(0));
      const r = f.open('R', 'coord-b', t(0) + 50);
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      f.dispatchStarted(r, t(2));
      f.bindAs(r, null);
      f.bind(w);
      return { f, mark: m, coords: ['coord-a', 'coord-b'], wave: w };
    },
    base: { parent: 'coord-a', claimants: ['coord-a'], card: 'W', childIds: { 'coord-a': ['W'], 'coord-b': [] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'V1c: a third coordinator\'s pre-planned wave, an older build\'s rebind of a failed spawn after the birth (R done), the minting run done',
    round: 'round 6 (V1c)',
    build: () => {
      const f = new Fixture();
      const w = f.open('W', 'coord-c', t(0));
      const r = f.open('R', 'coord-b', t(0) + 50);
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      f.dispatchStarted(r, t(2));
      f.bindAs(r, null);
      f.done(r);
      f.bind(w);
      return { f, mark: m, coords: ['coord-a', 'coord-b', 'coord-c'], wave: w };
    },
    base: { parent: 'coord-c', claimants: ['coord-c'], card: 'W', childIds: { 'coord-a': [], 'coord-b': [], 'coord-c': ['W'] }, held: 'released:operator:run-other-programme', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'V1d: as V1c, but R first minted another session and an older build then rebound it to the worker',
    round: 'round 6 (V1d)',
    build: () => {
      const f = new Fixture();
      const w = f.open('W', 'coord-c', t(0));
      const r = f.open('R', 'coord-b', t(0) + 50);
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      f.mint(r, t(2), 'demo-y');
      f.bindAs(r, null);
      f.done(r);
      f.bind(w);
      return { f, mark: m, coords: ['coord-a', 'coord-b', 'coord-c'], wave: w };
    },
    base: { parent: 'coord-c', claimants: ['coord-c'], card: 'W', childIds: { 'coord-a': [], 'coord-b': [], 'coord-c': ['W'] }, held: 'released:operator:run-other-programme', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'V9: a third coordinator\'s pre-planned wave, an older build\'s rebind of a failed spawn on a run opened after the birth (R open)',
    round: 'round 6 (V9)',
    build: () => {
      const f = new Fixture();
      const w = f.open('W', 'coord-c', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      const r = f.open('R', 'coord-b', t(1) + 50);
      f.dispatchStarted(r, t(2));
      f.bindAs(r, null);
      f.bind(w);
      return { f, mark: m, coords: ['coord-a', 'coord-b', 'coord-c'], wave: w };
    },
    base: { parent: 'coord-b', claimants: ['coord-b', 'coord-c'], card: 'R', childIds: { 'coord-a': [], 'coord-b': ['R'], 'coord-c': ['W'] }, held: 'released:operator:run-other-programme', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'S1: the minter\'s pre-planned wave, an older build\'s rebind of the minter\'s own failed spawn (F open), the minting run done',
    round: 'round 6 (S1)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-a', t(0));
      const fr = f.open('F', 'coord-a', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      f.dispatchStarted(fr, t(2));
      f.bindAs(fr, null);
      f.bind(l);
      return { f, mark: m, coords: ['coord-a'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a'], card: 'L', childIds: { 'coord-a': ['L'] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'S1b: as S1, the minting run left open',
    round: 'round 6 (S1b)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-a', t(0));
      const fr = f.open('F', 'coord-a', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.dispatchStarted(fr, t(2));
      f.bindAs(fr, null);
      f.bind(l);
      return { f, mark: m, coords: ['coord-a'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a'], card: 'M', childIds: { 'coord-a': ['L', 'M'] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'S2: another coordinator\'s pre-planned wave, an older build\'s rebind of a failed spawn (F done), the minting run done',
    round: 'round 6 (S2)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-b', t(0));
      const fr = f.open('F', 'coord-a', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      f.dispatchStarted(fr, t(2));
      f.bindAs(fr, null);
      f.done(fr);
      f.bind(l);
      return { f, mark: m, coords: ['coord-a', 'coord-b'], wave: l };
    },
    base: { parent: 'coord-b', claimants: ['coord-b'], card: 'L', childIds: { 'coord-a': [], 'coord-b': ['L'] }, held: 'released:operator:run-other-programme', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'S3: an adopted-arm row after a live placeable mint, then the minter\'s pre-planned wave',
    round: 'round 6 (S3)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-a', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      const a = f.open('A', 'coord-a', t(1) + 100);
      f.adopt(a, t(2));
      f.done(a);
      f.bind(l);
      return { f, mark: m, coords: ['coord-a'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a'], card: 'L', childIds: { 'coord-a': ['L'] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'S4: a born worker, a NEWER unplaceable birth for the id on another run, then the minter\'s pre-planned wave',
    round: 'round 6 (S4)',
    build: () => {
      const f = new Fixture();
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.done(m);
      const q = f.open('Q', 'coord-q', t(3) - 100);
      f.recordUnplaceable(q, t(3));
      f.done(q);
      const l = f.open('L', 'coord-a', t(0));
      f.bind(l);
      return { f, mark: m, coords: ['coord-a', 'coord-q'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a'], card: 'L', childIds: { 'coord-a': ['L'], 'coord-q': [] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  // Round 7: the shapes round 6's verifiers found. Two P1 families, named apart: P1*-back (an older build moves the minting
  // run away and back, birth columns untouched, while this build binds a pre-planned wave in between) and P1*-q (a NEWER
  // unplaceable birth for the id on another run Q, then the minting run's dispatch moves onto its birth). P2 and P3 keep a
  // placeable birth on a run moved to another id. P10, P10b and P6d rebind the minting run back through the dup arm.
  {
    shape: 'P1-back: an older build clears the minting run M, this build binds the pre-planned L, the older build moves M back (M open)',
    round: 'round 7 (P1-back)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-b', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.olderMove(m, null);
      f.bind(l);
      f.olderMove(m, W);
      return { f, mark: m, coords: ['coord-a', 'coord-b'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a', 'coord-b'], card: 'M', childIds: { 'coord-a': ['M'], 'coord-b': ['L'] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'P1b-back: as P1-back, the older build moves M to another id and back, M done',
    round: 'round 7 (P1b-back)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-b', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.olderMove(m, 'demo-other');
      f.bind(l);
      f.olderMove(m, W);
      f.done(m);
      return { f, mark: m, coords: ['coord-a', 'coord-b'], wave: l };
    },
    base: { parent: 'coord-b', claimants: ['coord-b'], card: 'L', childIds: { 'coord-a': [], 'coord-b': ['L'] }, held: 'released:operator:run-other-programme', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'P1d-back: as P1-back, with an earlier occupant whose only birth is unplaceable',
    round: 'round 7 (P1d-back)',
    build: () => {
      const f = new Fixture();
      const e = f.open('E', 'coord-gone', t(-2));
      f.mint(e, t(-2));
      f.redraw(e, t(-1));
      f.done(e);
      const l = f.open('L', 'coord-b', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.olderMove(m, null);
      f.bind(l);
      f.olderMove(m, W);
      return { f, mark: m, coords: ['coord-a', 'coord-b', 'coord-gone'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a', 'coord-b'], card: 'M', childIds: { 'coord-a': ['M'], 'coord-b': ['L'], 'coord-gone': [] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'P1e-back: as P1-back, with an earlier occupant whose minting run an older build cleared and whose stamped wave is done',
    round: 'round 7 (P1e-back)',
    build: () => {
      const f = new Fixture();
      const e = f.open('E', 'coord-gone', t(-2));
      f.mint(e, t(-2));
      const e2 = f.open('E2', 'coord-gone', t(-2) + 50);
      f.bind(e2);
      f.done(e);
      f.olderMove(e, null);
      const l = f.open('L', 'coord-b', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      f.olderMove(m, null);
      f.done(e2);
      f.bind(l);
      f.olderMove(m, W);
      return { f, mark: m, coords: ['coord-a', 'coord-b', 'coord-gone'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a', 'coord-b'], card: 'M', childIds: { 'coord-a': ['M'], 'coord-b': ['L'], 'coord-gone': [] }, held: 'released:coord-a:parent-not-live', stamp: 'T1 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'P1-q: the pre-planned-wave redraw shape plus a NEWER unplaceable birth for the id on another run Q (Q done)',
    round: 'round 7 (P1-q)',
    build: () => {
      const f = new Fixture();
      const w1 = f.open('w1', 'coord-1', t(5) - 1000);
      const w2 = f.open('w2', 'coord-1', t(5) + 10);
      const q = f.open('Q', 'coord-q', t(6) - 100);
      f.recordUnplaceable(q, t(6));
      f.done(q);
      f.recordUnplaceable(w1, t(5));
      f.bind(w2);
      f.redraw(w1, t(5));
      return { f, mark: w1, coords: ['coord-1', 'coord-q'], wave: w2 };
    },
    base: { parent: 'coord-1', claimants: ['coord-1'], card: 'w2', childIds: { 'coord-1': ['w1', 'w2'], 'coord-q': [] }, held: 'released:coord-1:parent-not-live', stamp: null },
    verdict: 'same',
  },
  {
    shape: 'P1b-q: as P1-q, w2 planned before the birth and w1 done',
    round: 'round 7 (P1b-q)',
    build: () => {
      const f = new Fixture();
      const w1 = f.open('w1', 'coord-1', t(5) - 1000);
      const w2 = f.open('w2', 'coord-1', t(5) - 1000);
      const q = f.open('Q', 'coord-q', t(6) - 100);
      f.recordUnplaceable(q, t(6));
      f.done(q);
      f.recordUnplaceable(w1, t(5));
      f.bind(w2);
      f.redraw(w1, t(5));
      f.done(w1);
      return { f, mark: w1, coords: ['coord-1', 'coord-q'], wave: w2 };
    },
    base: { parent: 'coord-1', claimants: [], card: null, childIds: { 'coord-1': [], 'coord-q': [] }, held: 'released:coord-1:parent-not-live', stamp: null },
    verdict: 'same',
  },
  {
    shape: 'P2: a born worker, a newer placeable birth for the id on a run R an older build moved to another id, then a pre-planned wave',
    round: 'round 7 (P2)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-a', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      const r = f.open('R', 'coord-r', t(3) - 100);
      f.mint(r, t(3));
      f.olderMove(r, 'demo-other');
      f.bind(l);
      return { f, mark: m, coords: ['coord-a', 'coord-r'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a'], card: 'M', childIds: { 'coord-a': ['M'], 'coord-r': ['R'] }, held: 'released:coord-a:parent-not-live', stamp: 'T3 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'P3: an unplaceable mark M, an older placeable birth for the id on a run R moved to another id, a wave opened after, then M redrawn',
    round: 'round 7 (P3)',
    build: () => {
      const f = new Fixture();
      const r = f.open('R', 'coord-r', t(2) - 100);
      f.mint(r, t(2));
      f.olderMove(r, 'demo-other');
      const m = f.open('M', 'coord-a', t(5) - 100);
      f.recordUnplaceable(m, t(5));
      const l = f.open('L', 'coord-a', t(5) + 10);
      f.bind(l);
      f.redraw(m, t(5));
      return { f, mark: m, coords: ['coord-a', 'coord-r'], wave: l };
    },
    base: { parent: 'coord-a', claimants: ['coord-a'], card: 'M', childIds: { 'coord-a': ['M'], 'coord-r': ['R'] }, held: 'released:coord-a:parent-not-live', stamp: 'T2 for demo-w' },
    verdict: 'same',
  },
  {
    shape: 'P10: the merge-base build mints M, stamps L2, rebinds M away and binds the pre-planned L with no stamp; this build\'s dup arm rebinds M back',
    round: 'round 7 (P10)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-b', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      const l2 = f.open('L2', 'coord-a', t(1) + 50);
      f.bindAs(l2, t(1));
      f.bind(m, 'demo-x');
      f.bindAs(l, null);
      f.bind(m);
      return { f, mark: m, coords: ['coord-a', 'coord-b'], wave: m };
    },
    base: { parent: 'coord-a', claimants: ['coord-a', 'coord-b'], card: 'L2', childIds: { 'coord-a': ['M', 'L2'], 'coord-b': ['L'] }, held: 'released:coord-a:parent-not-live', stamp: null },
    verdict: 'same',
  },
  {
    shape: 'P10b: as P10, L and L2 done, a third coordinator\'s pre-planned K bound by the merge-base build, M done',
    round: 'round 7 (P10b)',
    build: () => {
      const f = new Fixture();
      const k = f.open('K', 'coord-c', t(0) + 10);
      const l = f.open('L', 'coord-b', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      const l2 = f.open('L2', 'coord-a', t(1) + 50);
      f.bindAs(l2, t(1));
      f.done(l2);
      f.bind(m, 'demo-x');
      f.bindAs(l, null);
      f.bindAs(k, null);
      f.done(l);
      f.bind(m);
      f.done(m);
      return { f, mark: m, coords: ['coord-a', 'coord-b', 'coord-c'], wave: m };
    },
    base: { parent: 'coord-c', claimants: ['coord-c'], card: 'K', childIds: { 'coord-a': [], 'coord-b': [], 'coord-c': ['K'] }, held: 'released:operator:run-other-programme', stamp: null },
    verdict: 'same',
  },
  {
    shape: 'P6d: an older build binds the pre-planned L with no stamp and clears M; this build\'s dup arm rebinds M',
    round: 'round 7 (P6d)',
    build: () => {
      const f = new Fixture();
      const l = f.open('L', 'coord-b', t(0));
      const m = f.open('M', 'coord-a', t(1) - 100);
      f.mint(m, t(1));
      const l2 = f.open('L2', 'coord-c', t(2));
      f.bind(l2);
      f.bindAs(l, null);
      f.olderMove(m, null);
      f.bind(m);
      return { f, mark: m, coords: ['coord-a', 'coord-b', 'coord-c'], wave: m };
    },
    base: { parent: 'coord-c', claimants: ['coord-c', 'coord-a', 'coord-b'], card: 'L2', childIds: { 'coord-a': ['M'], 'coord-b': ['L'], 'coord-c': ['L2'] }, held: 'released:operator:run-other-programme', stamp: null },
    verdict: 'same',
  },
];

const EXPECT: 'base' | 'head' = process.env['BINDING_CORPUS_EXPECT'] === 'base' ? 'base' : 'head';
const RECORD = process.env['BINDING_CORPUS_RECORD'] === '1';

describe(`the probe corpus of #1573 (expecting the ${EXPECT} answers)`, () => {
  it.each(CORPUS.map((c) => [c.shape, c] as const))('%s', async (_shape, c) => {
    const got = await answer(c.build());
    if (RECORD) console.log(`CORPUS ${JSON.stringify({ shape: c.shape, got })}`);
    expect(got).toEqual(EXPECT === 'base' ? c.base : c.head ?? c.base);
  });

  it('no case is worse: a "same" case pins one answer, a "better" one says why, and a residual is a "same" case', () => {
    for (const c of CORPUS) {
      if (c.verdict === 'same') expect(c.head, c.shape).toBeUndefined();
      else { expect(c.head, c.shape).toBeDefined(); expect(c.head, c.shape).not.toEqual(c.base); expect(c.why, c.shape).toBeTruthy(); }
      if (c.residual !== undefined) { expect(c.verdict, c.shape).toBe('same'); expect(c.why, c.shape).toBeTruthy(); }
    }
  });
});
