// D-8071 (spec 2026-11-04 §7, "Cadence and where the answer lives", A45, A55, A56, A63): ONE PASS OF THE STUCK VERDICT. It
// is a read-only row of `LANE_SCHEDULE` (`runStuck`, a minute), run on the watcher's registry pass, and adds no statement to
// the 2-second tick. It decides nothing itself: `runStuck`, `runWaitsOn` and `blockedByOf` (`runStuck.ts`, L1) are the
// decisions, `RunVerdicts` (`runVerdicts.ts`) is where the answer lives, and this file only gathers.
//
// WHAT IT GATHERS. Every open run, in one read; each distinct claimant and each started run's worker, measured ONCE by the
// reclaim door's own ladder (`verdictOfFacts` over one registry read, which also hands back the row's stamps); the
// journal clause for the dead ones in one store read (`deadCoordinatorJournalRows`); the dead-coordinator lane's anchors
// (`dead_claimants`); and this pass's own `gone_since` rows. It writes nothing else: no run, no registry file, no lane row.
//
// `gone_since` (A63) is the one thing it writes, for a person it reads gone who has no other stored time, following
// `deadAnchorNext`'s rule. A person who reads alive or asleep, or who holds no open run, loses the row. An uncertain pass
// moves `lastGoneAt` alone, so a long uncertain spell does not restart the clock: uncertain is not evidence the person
// came back. A pass that fails at any read leaves the reader as it was (a verdict lags by a pass, never lies).
import type { RunKind, RunState } from '../../../shared/api.js';
import type { CcrcConfig } from '../config.js';
import type { SessionVerdict } from '../exec.js';
import type { FleetIO } from '../io.js';
import {
  DEAD_COORDINATOR_GAP_MS, deadCoordinatorJournal, type DeadCoordinatorJournal, type DeadCoordinatorJournalTrust,
} from '../deadCoordinator.js';
import { claimantFacts, verdictOfFacts, type ClaimantVerdict } from './reclaim.js';
import type { WatcherCoordPort } from './ports.js';
import type { GoneAnchor } from './store.js';
import {
  blockedByOf, claimantGone, claimantReading, runStuck, runWaitsOn, secondsToMs, stuckCause, stuckSince,
  type PersonFacts, type PersonReading, type RunStuckFacts, type StoredTimes,
} from './runStuck.js';
import type { RunVerdict, RunVerdicts } from './runVerdicts.js';

/** A closed run's header keeps its programme's `coordinatorGone` for this long after the programme's last close (A55). */
export const PROGRAMME_GONE_KEEP_MS = 168 * 60 * 60_000;

export interface RunStuckPassDeps {
  readonly coord: WatcherCoordPort;
  readonly io: FleetIO;
  readonly cfg: CcrcConfig;
  readonly tmux: { sessionVerdict(id: string): Promise<SessionVerdict> };
  readonly verdicts: RunVerdicts;
  /** The journal's trust, read by the watcher beside the dead-coordinator lane (`readDeadCoordinatorJournalTrust`). */
  readonly journalTrust: () => Promise<{ readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }>;
  readonly now: () => number;
}

interface Measured {
  readonly person: PersonFacts;
  readonly reading: PersonReading;
  readonly stoppedAt: number | null;
  readonly supervisedAt: number | null;
}

const idsOf = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];

/** The `gone_since` row after a pass that read the person gone (`deadAnchorNext`'s rule). */
function goneNext(prev: GoneAnchor | undefined, nowMs: number): GoneAnchor {
  if (prev === undefined || nowMs < prev.lastGoneAt || nowMs - prev.lastGoneAt > DEAD_COORDINATOR_GAP_MS) {
    return { firstGoneAt: nowMs, lastGoneAt: nowMs };
  }
  return { firstGoneAt: prev.firstGoneAt, lastGoneAt: nowMs };
}

/** One pass. Never throws: a failure is warned and leaves the reader as it was. */
export async function runStuckPass(deps: RunStuckPassDeps): Promise<void> {
  try {
    await pass(deps);
  } catch (err) {
    console.warn(`ccrc-server: runStuck: the pass failed (${err instanceof Error ? err.message : String(err)}) — the reader keeps its last answer`);
  }
}

async function pass(deps: RunStuckPassDeps): Promise<void> {
  const { coord } = deps;
  const read = coord.runs();
  if (!read.ok) throw new Error(read.detail);
  const open = read.runs;
  const moves = coord.runLastMoves(open.map((r) => r.id));
  const lastMoveOf = (id: number): number | null => (moves.ok ? moves.moves.get(id) ?? null : null);

  // WHO: each claimant once, and the worker of each started run.
  const claimants = idsOf(open.flatMap((r) => (r.claimedBy === null ? [] : [r.claimedBy])));
  const workers = idsOf(open.flatMap((r) => (r.state === 'planned' || r.sessionId === null ? [] : [r.sessionId])));
  const closedProgrammes = coord.closedProgrammeClaimants(deps.now() - PROGRAMME_GONE_KEEP_MS);
  const people = idsOf([...claimants, ...workers, ...closedProgrammes.map((c) => c.claimedBy)]);
  const measured = new Map<string, Measured>();
  const verdictOf = new Map<string, ClaimantVerdict>();
  for (const id of people) {
    const at = deps.now();
    const { facts, sv, record } = await claimantFacts(deps, id, at);
    const verdict = verdictOfFacts(id, facts, sv);
    verdictOf.set(id, verdict);
    const supervisedMs = secondsToMs(record?.supervisedAt);
    const person: PersonFacts = {
      verdict: verdict.state === 'dead' ? { state: 'dead', cause: verdict.cause } : { state: verdict.state === 'alive' ? 'alive' : 'unmeasurable' },
      hibernatedAt: facts.hibernatedAt,
      substrate: record?.substrate ?? null,
      archivedAt: secondsToMs(record?.archivedAt),
    };
    measured.set(id, {
      person, reading: claimantGone(person), stoppedAt: secondsToMs(record?.stoppedAt),
      supervisedAt: supervisedMs !== null && supervisedMs <= at ? supervisedMs : null,
    });
  }

  // THE JOURNAL for the dead ones, in one read; a read that throws is `unreadable`, never "no history".
  const trust = await deps.journalTrust();
  const dead = people.filter((id) => measured.get(id)!.person.verdict.state === 'dead');
  let journalOf: (id: string) => DeadCoordinatorJournal;
  try {
    const rows = coord.deadCoordinatorJournalRows(dead);
    journalOf = (id) => {
      const j = rows.get(id);
      return j === undefined ? { kind: 'no-history' } : deadCoordinatorJournal(j.rows, j.hasHistory, trust.trust);
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    journalOf = () => ({ kind: 'unreadable', detail });
  }
  const anchors = coord.deadAnchors();
  if (!anchors.ok) throw new Error(anchors.detail);
  const prevGone = coord.goneSince();

  // GONE_SINCE (A63): a row only for a person read gone with no other stored time.
  const at = deps.now();
  const holding = new Set([...claimants, ...workers]);
  const goneRows = new Map(prevGone);
  for (const id of people) {
    const m = measured.get(id)!;
    const held = holding.has(id);
    const j = journalOf(id);
    const reading = claimantReading(m.person, j);
    if (!held || reading === 'alive' || reading === 'asleep') {
      if (goneRows.has(id)) { coord.deleteGoneSince(id); goneRows.delete(id); }
      continue;
    }
    if (reading === 'uncertain') {
      const prev = goneRows.get(id);
      if (prev !== undefined) { const n = { firstGoneAt: prev.firstGoneAt, lastGoneAt: at }; coord.setGoneSince(id, n); goneRows.set(id, n); }
      continue;
    }
    // Gone. Does any other stored time already answer? A coordinator's journal act, archive or stop stamp, or the lane's
    // anchor; a worker's stop stamp.
    const role = claimants.includes(id) ? 'coordinator' : 'worker';
    const cause = stuckCause(m.person, j, role);
    const other = stuckSince(cause, 'owner-gone', {
      ...emptyTimes, journalAt: j.kind === 'deliberate' ? j.at : null, archivedAt: m.person.archivedAt ?? null, stoppedAt: m.stoppedAt,
      workerStoppedAt: m.stoppedAt, deadFirstAt: anchors.anchors.get(id)?.firstDeadAt ?? null, supervisedAt: m.supervisedAt,
    });
    if (other !== null) continue;
    const n = goneNext(goneRows.get(id), at);
    coord.setGoneSince(id, n);
    goneRows.set(id, n);
  }
  // A person with no open run loses the row.
  for (const id of [...goneRows.keys()]) {
    if (!holding.has(id)) { coord.deleteGoneSince(id); goneRows.delete(id); }
  }

  // THE FACTS of each open run, and the verdict.
  const reviewedOpen = new Set(open.flatMap((r) => (r.kind === 'review' && r.reviews !== null ? [r.reviews] : [])));
  const factsOf = new Map<number, RunStuckFacts>();
  for (const r of open) {
    const c = r.claimedBy === null ? null : measured.get(r.claimedBy) ?? null;
    const w = r.state === 'planned' || r.sessionId === null ? null : measured.get(r.sessionId) ?? null;
    const cj = r.claimedBy === null ? null : journalOf(r.claimedBy);
    const wj = r.sessionId === null || w === null ? null : journalOf(r.sessionId);
    let targetClosedAt: number | null = null;
    let target: RunStuckFacts['target'] = null;
    if (r.kind === 'review' && r.reviews !== null) {
      const t = coord.run(r.reviews);
      if (t.ok && t.run !== null) { target = { closed: t.run.closedAt !== null }; targetClosedAt = t.run.closedAt; }
    }
    const overtakenAt = r.state === 'planned' && r.kind === 'work' ? coord.programmeLeftPlannedAt(r.program, r.wave) : null;
    const j = cj ?? { kind: 'no-history' as const };
    const times: StoredTimes = {
      ...emptyTimes,
      journalAt: j.kind === 'deliberate' ? j.at : null,
      archivedAt: c?.person.archivedAt ?? null,
      stoppedAt: c?.stoppedAt ?? null,
      workerStoppedAt: w?.stoppedAt ?? null,
      deadFirstAt: r.claimedBy === null ? null : anchors.anchors.get(r.claimedBy)?.firstDeadAt ?? null,
      supervisedAt: c?.supervisedAt ?? null,
      goneSinceCoordinator: r.claimedBy === null ? null : goneRows.get(r.claimedBy)?.firstGoneAt ?? null,
      goneSinceWorker: r.sessionId === null ? null : goneRows.get(r.sessionId)?.firstGoneAt ?? null,
      openedAt: r.openedAt, dispatchStartedAt: r.dispatchStartedAt, targetClosedAt, overtakenAt,
    };
    factsOf.set(r.id, {
      id: r.id, state: r.state as RunState, kind: r.kind as RunKind, dispatchStartedAt: r.dispatchStartedAt,
      dispatchedAt: r.dispatchedAt, lastMoveAt: lastMoveOf(r.id),
      claimant: c?.person ?? null, claimantJournal: cj, worker: w?.person ?? null, workerJournal: wj,
      target, laterReviewMoved: false, overtaken: overtakenAt !== null,
      aloneInProgramme: false,
      reviewOpen: r.state === 'awaiting-review' ? reviewedOpen.has(r.id) : null,
      behind: null, times,
    });
  }

  // PHASE ONE: each run's verdict. PHASE TWO: a planned run behind the nearest earlier wave that is stuck.
  const now = deps.now();
  // R1 (2026-11-08): "nothing else open" counts only open runs that are not themselves stuck. A run's own never-started
  // verdict depends on its neighbours' verdicts, so every run is read first with `aloneInProgramme` false (no
  // never-started), then re-read until no verdict changes. A verdict only ever turns on, so the loop ends.
  const stuck = new Map(open.map((r) => [r.id, runStuck(factsOf.get(r.id)!, now)] as const));
  for (let changed = true; changed;) {
    changed = false;
    const unstuckOpen = new Map<string, number>();
    for (const r of open) if (stuck.get(r.id) === null) unstuckOpen.set(r.program, (unstuckOpen.get(r.program) ?? 0) + 1);
    for (const r of open) {
      if (stuck.get(r.id) !== null || (unstuckOpen.get(r.program) ?? 0) !== 1) continue;
      factsOf.set(r.id, { ...factsOf.get(r.id)!, aloneInProgramme: true });
      const v = runStuck(factsOf.get(r.id)!, now);
      stuck.set(r.id, v);
      if (v !== null) changed = true;
    }
  }
  const answers = new Map<number, RunVerdict>();
  for (const r of open) {
    const f = factsOf.get(r.id)!;
    let behind: number | null = null;
    if (r.state === 'planned') {
      let best: { id: number; wave: number } | null = null;
      for (const o of open) {
        if (o.program !== r.program || o.wave >= r.wave || stuck.get(o.id) === null) continue;
        if (best === null || o.wave > best.wave) best = { id: o.id, wave: o.wave };
      }
      behind = best === null ? null : best.id;
    }
    const withBehind: RunStuckFacts = { ...f, behind };
    const waitsOn = runWaitsOn(withBehind);
    const gone = f.claimant !== null && claimantReading(f.claimant, f.claimantJournal) === 'gone';
    answers.set(r.id, {
      stuck: stuck.get(r.id)!, ...(waitsOn === undefined ? {} : { waitsOn }),
      blockedBy: blockedByOf(withBehind), coordinatorGone: gone,
    });
  }
  const programmes = new Map<string, boolean>();
  for (const { program, claimedBy } of closedProgrammes) {
    const m = measured.get(claimedBy);
    if (m !== undefined) programmes.set(program, claimantReading(m.person, journalOf(claimedBy)) === 'gone');
  }
  deps.verdicts.replace(answers, programmes);
}

const emptyTimes: StoredTimes = {
  journalAt: null, archivedAt: null, stoppedAt: null, workerStoppedAt: null, deadFirstAt: null, supervisedAt: null,
  goneSinceCoordinator: null, goneSinceWorker: null, openedAt: 0, dispatchStartedAt: null, targetClosedAt: null,
  laterReviewAt: null, overtakenAt: null, nameReusedAt: null,
};
