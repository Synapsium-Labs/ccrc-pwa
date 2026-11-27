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
// three columns) is called once per board read. A stored word this build does not know is `unknown`, never the stored text.
import type { CcrcConfig } from '../config.js';
import type { FleetIO } from '../io.js';
import { listProjectsWalked, type ProjectWalkCache } from '../lifecycle.js';
import { readCcrcFileSwitches } from '../overridesRead.js';
import { isCollectLaneChoice, type ProgrammesAnswer, type SessionStatus } from '../../../shared/api.js';
import { readSwitches, settingSwitchNames, type SettingSwitchName } from '../../../shared/switches.js';
import { isClaudeRollTargets } from '../../../shared/claudeVersion.js';
import { isDispatchAbandonChoice } from '../../../shared/dispatch-abandon.js';
import { isPlainAutoMemoryChoice } from '../../../shared/plainAutoMemory.js';
import { isAdvisorChoice } from '../../../shared/coordinatorAdvisor.js';
import type { IsolationRead } from '../../../shared/isolation.js';
import type { PortfolioView } from '../../../shared/portfolio.js';
import type { ReadinessWire } from '../../../shared/overlord-readiness.js';
import type { BoardSettingStored, BoardSettingWord, BoardUnmeasured } from '../../../shared/overlordBoard.js';
import type { CoordCapNow } from '../../../shared/runCap.js';
import type { CoordStore } from './store.js';
import type { RunVerdicts } from './runVerdicts.js';
import { ladderWire, type LadderRead } from './overlordLadderRead.js';
import { STALL_NOTICE_WINDOW_MS, parseStallSettings, stallNoticeCounts } from './stallsettings.js';
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
const NO_ROW = setting('absent', null);
/** A stored word through its row's own predicate: the word, or `unknown`, never the stored text. */
const wordOf = <W extends BoardSettingWord>(is: (v: unknown) => v is W, v: unknown): W | 'unknown' => (is(v) ? v : 'unknown');
/** The common read shape (a row, no row, or a read that failed), the row's word from `value`. */
const rowOf = <T extends { readonly kind: string }>(read: T,
  value: (row: Extract<T, { readonly kind: 'row' }>) => BoardSettingWord | 'unknown'): BoardRead<BoardSettingIn> =>
  (read.kind === 'unreadable' ? fail('read-failed') : read.kind === 'absent' ? NO_ROW : setting('row', value(read as Extract<T, { readonly kind: 'row' }>)));
/** The run-close row's three columns, from its reader's one read; it reads a lost row as shadow, so it cannot say `stored`. */
const runCloseRow = (r: SettingReads, field: 'neverStarted' | 'claimantCrashed' | 'claimantGone'): BoardRead<BoardSettingIn> => {
  const x = r.runClose();
  return x.kind === 'row' ? setting(null, x[field]) : fail('read-failed');
};

/** Each settings row of the switchboard, read through its store's own reader and its own predicate. */
const SETTING_ROWS: { readonly [K in SettingSwitchName]: (r: SettingReads) => BoardRead<BoardSettingIn> } = {
  'stall-watch-level': (r) => {
    const p = parseStallSettings(r.stall());
    if (p.stored === 'unreadable') return fail('read-failed');
    if (p.stored === 'absent') return NO_ROW;
    return setting('row', p.level.kind === 'follow' ? 'follow' : p.level.kind === 'chosen' ? p.level.level : 'unknown');
  },
  'collect-lane-choice': (r) => rowOf(r.collect(), (x) => wordOf(isCollectLaneChoice, x.row.choice)),
  'roll-idle-targets': (r) => {
    const x = r.roll();
    return x.kind === 'row' ? setting(x.seeded ? 'seed' : 'row', wordOf(isClaudeRollTargets, x.targets)) : rowOf(x, () => 'unknown');
  },
  'dispatch-abandon-choice': (r) => rowOf(r.abandon(), (x) => wordOf(isDispatchAbandonChoice, x.choice)),
  'run-close-never-started-choice': (r) => runCloseRow(r, 'neverStarted'),
  'run-close-claimant-crashed-choice': (r) => runCloseRow(r, 'claimantCrashed'),
  'run-close-claimant-gone-choice': (r) => runCloseRow(r, 'claimantGone'),
  'plain-auto-memory': (r) => rowOf(r.plainMemory(), (x) => wordOf(isPlainAutoMemoryChoice, x.choice)),
  'coordinator-advisor': (r) => rowOf(r.advisor(), (x) => wordOf(isAdvisorChoice, x.choice)),
  'overlord-rung': (r) => {
    const x = r.rung();
    if (x.kind === 'unmeasured') return fail('read-failed');
    return x.current.kind === 'default' ? NO_ROW : setting('row', x.current.kind === 'rung' ? x.current.rung : 'unknown');
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
