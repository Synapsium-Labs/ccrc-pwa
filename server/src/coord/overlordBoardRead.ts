// The Overlord's board, gathered (Overlord W1, PR B2; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`
// Task 6 and Table 1). Ring L3, context C5: one call of each existing reader per board read, with its exact arguments, each
// inside its own try, so a reader that throws or answers that it could not read is that input's closed reason and never the
// board's failure. `goalsFor` and `itemsFor` are called once per programme. The store, the io, the clock and the other readers
// are injected; this file decides nothing (`composeBoard`, L1, maps what it gathers).
//
// NO TEXT CROSSES THAT A PART DOES NOT CARRY: an item is reduced to its id, kind, state, urgency and title here, so its `why`, its
// steps or an answer never reach the composer (C44). A timer keeps its note as far as `timersByProgramme`, which never reads it.
// A reader's own error text stays here: an input that failed carries a closed word only (slug
// `board-unmeasured-reasons-are-closed-words`).
import type { CcrcConfig } from '../config.js';
import type { FleetIO } from '../io.js';
import { listProjects, type ProjectWalkCache } from '../lifecycle.js';
import type { ProgrammesAnswer, SessionStatus } from '../../../shared/api.js';
import { readSwitches } from '../../../shared/switches.js';
import type { IsolationRead } from '../../../shared/isolation.js';
import type { PortfolioView } from '../../../shared/portfolio.js';
import type { ReadinessWire } from '../../../shared/overlord-readiness.js';
import type { BoardUnmeasured } from '../../../shared/overlordBoard.js';
import type { CoordStore } from './store.js';
import type { RunVerdicts } from './runVerdicts.js';
import type { LadderRead } from './overlordLadderRead.js';
import { STALL_NOTICE_WINDOW_MS, stallNoticeCounts } from './stallsettings.js';
import type { BoardInputs, BoardRead } from './overlordBoard.js';

/** How far back the programmes read looks for closed runs: `GET /api/programmes`' own default (the last 24 hours). */
export const BOARD_PROGRAMMES_SINCE_MS = 24 * 3_600_000;

/** The store reads the board takes, named (plan Task 6: the members, never the whole store). */
export type BoardStore = Pick<CoordStore, 'readProgrammes' | 'goalsFor' | 'itemsFor' | 'stallObservationsSince' | 'caps' | 'capsUsage' | 'pendingTimers'>;

export interface BoardGatherPorts {
  /** The coordination store; undefined on a server that opened none (every store input reads `no-store`). */
  readonly coord: BoardStore | undefined;
  /** The watcher's stuck pass's verdicts, as `GET /api/programmes` passes them. */
  readonly verdicts: () => RunVerdicts;
  /** The lifecycle fields over the programmes read (`programmesWithLifecycle`, bound to its registry port). */
  readonly lifecycle: (answer: ProgrammesAnswer) => Promise<ProgrammesAnswer>;
  /** The watcher's listing, or null before its first pass. */
  readonly listing: () => { readonly sessions: readonly { readonly id: string; readonly status: SessionStatus }[] } | null;
  /** `listProjects`' io, config and the server's one project-walk cache, so a board read does not walk the projects again. */
  readonly projects: { readonly io: FleetIO; readonly cfg: CcrcConfig; readonly cache: ProjectWalkCache };
  /** The portfolio's one composition (`portfolioFor` over the store's facts), as `GET /api/portfolio` composes it. */
  readonly portfolio: (() => PortfolioView) | undefined;
  /** The ladder's composed read, or undefined where it is not built. */
  readonly ladder: (() => LadderRead) | undefined;
  /** The readiness lane's read, or undefined where no lane runs. */
  readonly readiness: (() => { readonly ok: true; readonly wire: ReadinessWire } | { readonly ok: false; readonly detail: string }) | undefined;
  /** The isolation word's reader, or undefined where it is not wired. */
  readonly isolation: (() => IsolationRead) | undefined;
  readonly now: () => number;
}

const fail = (reason: BoardUnmeasured): { readonly ok: false; readonly reason: BoardUnmeasured } => ({ ok: false, reason });
/** One reader, once, inside its own try: a throw is `threw`, never the board's failure. */
function once<T>(f: () => BoardRead<T>): BoardRead<T> {
  try { return f(); } catch { return fail('threw'); }
}
async function onceAsync<T>(f: () => Promise<BoardRead<T>>): Promise<BoardRead<T>> {
  try { return await f(); } catch { return fail('threw'); }
}

/** Gather every input of one board read. Each reader is called once; the per-programme reads once per programme. */
export async function gatherBoard(p: BoardGatherPorts): Promise<BoardInputs> {
  const now = p.now();
  const coord = p.coord;
  const noStore = fail('no-store');
  const programmes = await onceAsync(async () => {
    if (coord === undefined) return noStore;
    const answer = await p.lifecycle(coord.readProgrammes({ since: now - BOARD_PROGRAMMES_SINCE_MS, now }, p.verdicts()));
    return { ok: true, value: answer.programmes };
  });
  const slugs = programmes.ok ? programmes.value.map((r) => r.slug) : [];
  const goals = new Map(slugs.map((slug) => [slug, once(() => (coord === undefined ? noStore : { ok: true as const, value: coord.goalsFor(slug) }))] as const));
  const items = new Map(slugs.map((slug) => [slug, once(() => {
    if (coord === undefined) return noStore;
    return { ok: true as const, value: coord.itemsFor(slug, now).open.map((t) => ({ id: t.id, kind: t.kind, state: t.state, neededBy: t.neededBy, title: t.title })) };
  })] as const));
  const listing = once(() => {
    const l = p.listing();
    return l === null ? fail('no-listing') : { ok: true, value: l.sessions.map((s) => ({ id: s.id, status: s.status })) };
  });
  const stallNotices = once(() => {
    if (coord === undefined) return noStore;
    const since = now - STALL_NOTICE_WINDOW_MS;
    const read = coord.stallObservationsSince(since);
    return read.ok ? { ok: true, value: { since, windowMs: STALL_NOTICE_WINDOW_MS, counts: stallNoticeCounts(read.rows) } } : fail('read-failed');
  });
  const portfolio = once(() => (p.portfolio === undefined ? fail('not-wired') : { ok: true, value: p.portfolio() }));
  const capacity = once(() => (coord === undefined ? noStore
    : { ok: true, value: { maxConcurrentWorkers: coord.caps().maxConcurrentWorkers, running: coord.capsUsage().running } }));
  const projects = await onceAsync(async () => {
    const l = await listProjects(p.projects.io, p.projects.cfg, undefined, p.projects.cache);
    return { ok: true, value: { registry: l.registry, names: l.projects.map((r) => r.name) } };
  });
  const switches = await onceAsync(async () => ({ ok: true, value: readSwitches(await p.projects.io.readdir(p.projects.cfg.registryDir)) }));
  const ladder = once(() => {
    if (p.ladder === undefined) return fail('not-wired');
    const r = p.ladder();
    return r.kind === 'measured' ? { ok: true, value: { rung: r.effective.rung, operatorRung: r.effective.operatorRung } } : fail('read-failed');
  });
  const readiness = once(() => {
    if (p.readiness === undefined) return fail('not-wired');
    const r = p.readiness();
    return r.ok ? { ok: true, value: { word: r.wire.word, since: r.wire.since, until: r.wire.until } } : fail('read-failed');
  });
  const isolation = once(() => (p.isolation === undefined ? fail('not-wired') : { ok: true, value: p.isolation() }));
  // The sandbox check's facts have no reader a read door can call (Step 1): the settle step reads them inside the loads door.
  const sandbox: BoardRead<{ readonly held: boolean }> = fail('no-reader');
  const timers = once(() => {
    if (coord === undefined) return noStore;
    const read = coord.pendingTimers();
    return read.ok ? { ok: true, value: read.rows.map((t) => ({ setter: t.setter, dueAt: t.dueAt, note: t.note })) } : fail('read-failed');
  });
  return { programmes, listing, goals, items, stallNotices, portfolio, capacity, projects, switches, ladder, readiness, isolation, sandbox, timers };
}
