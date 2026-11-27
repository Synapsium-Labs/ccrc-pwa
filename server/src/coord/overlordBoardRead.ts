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
//
// THE BRAKES' ROWS (board B3) are the switchboard's (`SWITCHES`, `shared/switches.ts`): the marker rows from the registry's one
// listing (`readSwitches`), each settings row through its store's own reader and that row's own predicate (`SETTING_ROWS`, keyed by
// the table's names, so a settings row added to the table is a type error here until it has a reader), and the fleet host's files
// through the Overrides read's own reader (`readCcrcFileSwitches`). A store reader that serves several rows (the run-close row's
// three columns) is called once per board read. Each row's value is the word its OWNER's reader reads in force, a seeded or lost
// row included (fix round 1, F1). A stored word this build does not know is `unknown`, never the stored text.
import type { CcrcConfig } from '../config.js';
import type { FleetIO } from '../io.js';
import { listProjectsWalked, type ProjectWalkCache } from '../lifecycle.js';
import { readCcrcFileSwitches } from '../overridesRead.js';
import { isCollectLaneChoice, type ProgrammesAnswer, type SessionStatus } from '../../../shared/api.js';
import { readSwitches, settingSwitchNames, type SettingSwitchName } from '../../../shared/switches.js';
import { LADDER_DEFAULT_RUNG } from '../../../shared/overlord-ladder.js';
import { measureCollectLaneRow } from '../collectLane.js';
import { plainAutoMemoryOf } from '../continuity/profileFor.js';
import { coordinatorAdvisorOf } from '../continuity/advisorPolicy.js';
import { rollTargetsOf } from './rollTarget.js';
import { dispatchAbandonViewOf } from './deadDispatch.js';
import type { IsolationRead } from '../../../shared/isolation.js';
import type { PortfolioView } from '../../../shared/portfolio.js';
import type { ReadinessWire } from '../../../shared/overlord-readiness.js';
import type { BoardSettingStored, BoardSettingWord, BoardUnmeasured } from '../../../shared/overlordBoard.js';
import type { CoordCapNow } from '../../../shared/runCap.js';
import type { CoordStore } from './store.js';
import type { RunVerdicts } from './runVerdicts.js';
import { ladderWire, type LadderRead } from './overlordLadderRead.js';
import { STALL_NOTICE_WINDOW_MS, parseStallSettings, resolveStallWatch, stallBoxArmingOf, stallNoticeCounts } from './stallsettings.js';
import type { BoardInputs, BoardRead, BoardSettingIn } from './overlordBoard.js';

/** How far back the programmes read looks for closed runs: `GET /api/programmes`' own default (the last 24 hours). */
export const BOARD_PROGRAMMES_SINCE_MS = 24 * 3_600_000;

/** The store reads the board takes, named (plan Task 6: the members, never the whole store). */
export type BoardStore = Pick<CoordStore, 'readProgrammes' | 'goalsFor' | 'itemsFor' | 'stallObservationsSince' | 'capsUsage' | 'pendingTimers'
  // The settings rows' own readers (board B3).
  | 'stallSettings' | 'collectLaneRow' | 'rollSettings' | 'dispatchAbandonSetting' | 'runCloseSetting' | 'plainAutoMemorySettings'
  | 'coordinatorAdvisorSettings' | 'ladderRungRead'>;

export interface BoardGatherPorts {
  /** The coordination store; undefined on a server that opened none (every store input reads `no-store`). */
  readonly coord: BoardStore | undefined;
  /** The watcher's stuck pass's verdicts, as `GET /api/programmes` passes them. */
  readonly verdicts: () => RunVerdicts;
  /** The lifecycle fields over the programmes read (`programmesWithLifecycle`, bound to its registry port). */
  readonly lifecycle: (answer: ProgrammesAnswer) => Promise<ProgrammesAnswer>;
  /** The watcher's listing, or null before its first pass. */
  readonly listing: () => { readonly sessions: readonly { readonly id: string; readonly status: SessionStatus }[] } | null;
  /** `listProjectsWalked`' io, config and the server's one project-walk cache, so a board read does not walk the projects again; the
   *  same io and config read the registry's listing for the marker rows and the fleet host's switch files. */
  readonly projects: { readonly io: FleetIO; readonly cfg: CcrcConfig; readonly cache: ProjectWalkCache };
  /** The portfolio's one composition (`portfolioFor` over the store's facts), as `GET /api/portfolio` composes it. */
  readonly portfolio: (() => PortfolioView) | undefined;
  /** The cap in force, `dispatch.ts#capNow` over the store and the watcher's host reading, as the caps view composes it (an
   *  automatic cap is the derived one, never the stored number); undefined on a server that opened no store. */
  readonly capNow: (() => CoordCapNow) | undefined;
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

/** A reader called at most once, its answer or its throw kept, so every row it serves reads that one call. */
function memo<T>(f: () => T): () => T {
  let kept: { readonly v: T } | { readonly e: unknown } | null = null;
  return () => {
    if (kept === null) { try { kept = { v: f() }; } catch (e) { kept = { e }; } }
    if ('e' in kept) throw kept.e;
    return kept.v;
  };
}

/** The settings rows' store readers, each called at most once per board read. */
const settingReadsOf = (s: BoardStore) => ({
  stall: memo(() => s.stallSettings()),
  collect: memo(() => s.collectLaneRow()),
  roll: memo(() => s.rollSettings()),
  abandon: memo(() => s.dispatchAbandonSetting()),
  runClose: memo(() => s.runCloseSetting()),
  plainMemory: memo(() => s.plainAutoMemorySettings()),
  advisor: memo(() => s.coordinatorAdvisorSettings()),
  rung: memo(() => s.ladderRungRead()),
});
type SettingReads = ReturnType<typeof settingReadsOf>;

const setting = (stored: BoardSettingStored | null, value: BoardSettingWord | 'unknown' | null): BoardRead<BoardSettingIn> =>
  ({ ok: true, value: { stored, value } });
/** A row or a lost row, once a failed read has been answered. */
const storedOf = (kind: 'row' | 'absent'): BoardSettingStored => kind;
/** A word the owner's reader answers, or `unknown` where it answers none for a row that stands (never the stored text). */
const known = <W extends BoardSettingWord>(w: W | null): W | 'unknown' => w ?? 'unknown';
/** The run-close row's three columns, from its reader's one read. That reader reads a lost row, and any word it does not know, as
 *  shadow (what the lanes do too), so it cannot say `stored` and never answers `unknown`. */
const runCloseRow = (r: SettingReads, field: 'neverStarted' | 'claimantCrashed' | 'claimantGone'): BoardRead<BoardSettingIn> => {
  const x = r.runClose();
  return x.kind === 'row' ? setting(null, x[field]) : fail('read-failed');
};

/** Each settings row of the switchboard, read through its OWNER's reader, so `value` is the word that owner reads in force: for a
 *  seeded or lost row too, where the owner gives it a meaning other than the raw column (fix round 1, F1). Per row:
 *  - the stall watch: its resolver's chosen level (`resolveStallWatch`); a row that does not apply whole (a lost row, or a field
 *    that cannot be read) applies nothing, so the box's files decide, which is `follow`; a level word it does not know is `unknown`;
 *  - the collect lane: its own measure (`measureCollectLaneRow`), which tells the seed apart; a lost row has no word (the lane
 *    reads it as unmeasurable), and a malformed row is `unknown`;
 *  - the idle roll: `rollTargetsOf`, which reads a lost row and the migration's seed as the default (`all`);
 *  - the dispatch abandon: `dispatchAbandonViewOf`; a lost row has no word (it arms nothing);
 *  - the plain sessions' auto memory: `plainAutoMemoryOf`, a lost row the default (`off`);
 *  - the coordinator advisor: `coordinatorAdvisorOf`, a lost row the default (`off`), a row whose cap or scope cannot be read `unknown`;
 *  - the operator's rung: no row is the ladder's default (`LADDER_DEFAULT_RUNG`). */
const SETTING_ROWS: { readonly [K in SettingSwitchName]: (r: SettingReads) => BoardRead<BoardSettingIn> } = {
  'stall-watch-level': (r) => {
    const p = parseStallSettings(r.stall());
    if (p.stored === 'unreadable') return fail('read-failed');
    if (p.stored === 'row' && p.level.kind === 'unreadable') return setting('row', 'unknown');
    return setting(p.stored, resolveStallWatch(stallBoxArmingOf([], false), p).chosen ?? 'follow');
  },
  'collect-lane-choice': (r) => {
    const m = measureCollectLaneRow(r.collect());
    if (m.kind === 'unreadable') return fail('read-failed');
    if (m.kind === 'absent') return setting('absent', null);
    if (m.kind === 'malformed') return setting('row', 'unknown');
    return setting(m.kind, isCollectLaneChoice(m.row.choice) ? m.row.choice : 'unknown');
  },
  'roll-idle-targets': (r) => {
    const x = r.roll();
    if (x.kind === 'unreadable') return fail('read-failed');
    return setting(x.kind === 'row' && x.seeded ? 'seed' : storedOf(x.kind), known(rollTargetsOf(x)));
  },
  'dispatch-abandon-choice': (r) => {
    const v = dispatchAbandonViewOf(r.abandon(), 0);
    if (v.stored === 'unreadable') return fail('read-failed');
    return v.stored === 'absent' ? setting('absent', null) : setting('row', v.stored);
  },
  'run-close-never-started-choice': (r) => runCloseRow(r, 'neverStarted'),
  'run-close-claimant-crashed-choice': (r) => runCloseRow(r, 'claimantCrashed'),
  'run-close-claimant-gone-choice': (r) => runCloseRow(r, 'claimantGone'),
  'plain-auto-memory': (r) => {
    const x = r.plainMemory();
    if (x.kind === 'unreadable') return fail('read-failed');
    return setting(storedOf(x.kind), known(plainAutoMemoryOf(x)));
  },
  'coordinator-advisor': (r) => {
    const x = r.advisor();
    if (x.kind === 'unreadable') return fail('read-failed');
    return setting(storedOf(x.kind), known(coordinatorAdvisorOf(x)?.choice ?? null));
  },
  'overlord-rung': (r) => {
    const x = r.rung();
    if (x.kind === 'unmeasured') return fail('read-failed');
    if (x.current.kind === 'default') return setting('absent', LADDER_DEFAULT_RUNG);
    return setting('row', x.current.kind === 'rung' ? x.current.rung : 'unknown');
  },
};
/** The settings rows' names `SETTING_ROWS` answers, for the census that holds them equal to the table's. */
export const BOARD_SETTING_ROW_NAMES: readonly string[] = Object.keys(SETTING_ROWS);

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
  const capacity = once(() => (coord === undefined ? noStore : p.capNow === undefined ? fail('not-wired')
    : { ok: true, value: { maxConcurrentWorkers: p.capNow().cap, running: coord.capsUsage().running } }));
  const projects = await onceAsync(async () => {
    const l = await listProjectsWalked(p.projects.io, p.projects.cfg, undefined, p.projects.cache);
    // A walk of the projects root that was not measured may be short or empty because nothing was read: the part's
    // `read-failed`, as the switches part reads its own listing (review 4010 F1). The lister's own flag; no second probe.
    if (l.walk !== 'measured') return fail('read-failed');
    return { ok: true, value: { registry: l.registry, names: l.projects.map((r) => r.name), unreadable: l.unreadable } };
  });
  // The measured listing: one that cannot be read is the part's `read-failed`, never a row of `unmeasurable` switches.
  const switches = await onceAsync(async () => {
    const l = await p.projects.io.readdirMeasured(p.projects.cfg.registryDir);
    return l.ok ? { ok: true, value: readSwitches(l.entries) } : fail('read-failed');
  });
  // Each settings row on its own: a reader that throws is the rows it serves, never another row and never the part.
  const reads = coord === undefined ? undefined : settingReadsOf(coord);
  const settings = new Map(settingSwitchNames.map((k) => [k, once(() => (reads === undefined ? noStore : SETTING_ROWS[k](reads)))] as const));
  // The fleet host's switch files, through the Overrides read's own reader (one measured stat each); an unmeasurable file is the
  // composer's `read-failed` for that row.
  const files = await onceAsync(async () => ({ ok: true as const, value: await readCcrcFileSwitches(p.projects.io, p.projects.cfg.ccrcDir) }));
  const ladder = once(() => {
    if (p.ladder === undefined) return fail('not-wired');
    const r = p.ladder();
    if (r.kind !== 'measured') return fail('read-failed');
    // The ladder read's own projection (`ladderWire`, the session-gated read's): the board takes neither its rungs list (so no
    // server words are passed) nor a latch's `detail`, server prose that can name a subject (slug `board-latch-detail-not-carried`).
    const w = ladderWire(r, []);
    return { ok: true, value: {
      rung: w.effectiveRung, operatorRung: w.operatorRung,
      latches: w.latches.map((l) => ({ cause: l.cause, cap: l.cap, raisedAt: l.raisedAt, known: l.known, narrowing: l.narrowing })),
      conditions: w.conditions.map((c) => ({ cause: c.cause, reading: c.reading, effect: c.effect })),
    } };
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
  return {
    programmes, listing, goals, items, stallNotices, portfolio, capacity, projects, switches, settings, files, ladder, readiness, isolation, sandbox, timers,
  };
}
