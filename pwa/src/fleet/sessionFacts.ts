// THE SESSION'S FACTS (D-5545): ONE pure model that decides, for both skins,
// what a session's fleet CARD says and what its session HEADER says.
//
// THE RULE (D-5545, operator ruling 2026-10-18: "I should be able to see at
// least the same info on the top bar of the session as I see in the little
// sidebar … OR show less stuff in the sidebar cards"). Both halves:
//   • The CARD is a glance: the name, the status lamp with its word, ONE context
//     line in the operator's terms (`<programme> · wave N of M`, or `· review of
//     wave N`; for a session no run names, its PR or its branch, or nothing), at
//     most ONE attention marker chosen by the fixed priority `MARKER_ORDER`, and
//     the cross-project chip (D-5527). No bookkeeping ids, no fragment cut mid-token:
//     below the 900px desk a long name or programme is shortened HERE, by whole tokens
//     (`shortenByToken`), and from 900px up the full form draws (a name or branch past
//     two lines ends in the browser's clamp `…`, D-6332); the full text rides `title`.
//     D-8142 (operator ruling 2026-11-09) overturns this for ONE fact: a coordinator's card also says
//     `coordinator`, first on the context line, because every session the operator creates is one from its first
//     turn and the operator should see which rows are. The branch beside it shortens to what is left of the budget.
//   • The HEADER is the full set — a SUPERSET of the card: every card fact under
//     the same key, with its full text, plus everything the card leaves out but a session's helpers, which its
//     Helpers section lists and counts once (session helpers H3, D-8875). There is ONE allowance (D-8771): the
//     status word's background count, which the header keeps and the card drops (`HEADER_COUNT_ALLOWANCES`).
//     `cardFacts(f)` ⊆ `headerFacts(f)` is pinned by `card-header-facts.test.tsx`.
//
// Measured before this file (390px, both skins): a child's card read `idle ·
// program:… · run not on the board · lane-a` with a second line under it
// repeating its programme and wave (`⇄ terminal-drawer-fit wave 3/5 · coordinator
// gone`), 15 of its cells were cut by an ellipsis, and the session header showed
// none of the hold, the task tally, the subagents, the context pressure, the
// limit, the swap refusal or the coordinator's absence.
import {
  ASK_OPERATOR_PRINCIPAL, backgroundWork, backgroundWords, ctxPressure, graphGateCount, graphReadCount,
  sessionAsk, sessionWithCoordinator, substrateFault, turnStall, unmeasuredFields, withCoordinatorWords,
  type FleetSession, type ProjectPoolWire, type RosterWire, type SessionBucket,
} from '../../../shared/api';
import { accountLabel, accountPool } from '../lib/accounts';
import { elapsedShort, elapsedWords, statusLabel } from '@ccrc/ui';
import { restartWords, type RestartWords } from '../lib/restart';
import { humanBytes } from '../lib/format';
import { lifecycleQualifier } from './lifecycleWords';
import { hibernatedSince, hibernatedWords } from './hibernated';
import { paneGone } from './presence';
import {
  childOfRunLabel, programmeWave, programmeWaveTail, runSentence,
  type ChildOfRunLabel, type ChildRunContext,
} from './runWords';
import { spawnChip, type SpawnChip } from './spawnWords';
import { substrateFaultText } from './substrateWords';
import type { CoordinatorPresence } from './presence';
import { sessionLabel } from './sessionLabel';
import { unmeasuredTitle } from './unmeasuredWords';
import type { SessionWorktree } from './sessionWorktrees';
import { claudeBuildOf, type ClaudeBuildFact } from '../../../shared/claudeVersion';
import { behindFact, buildText } from './buildWords';

/** Routing policy calls a window critical above this. */
export const CRITICAL = 75;
/** Context-pressure floor (D-2011), statusline-command.sh's own. */
export const CTX_PRESSURE = 80;
/** The PHONE's name budget, in characters, and its programme budget: the length of the token-shortened form
 *  (`Fit`) a card draws below the 900px desk breakpoint. Chosen by measurement at 360px (both skins): the card's text
 *  column is 226px — ~30 label characters at 7.4px, ~31 mono characters at 7.2px — and the context line holds the
 *  programme plus its wave (` · wave 3 of 5`, 14 characters). From 900px up the full form draws instead, a name and
 *  a branch on up to two lines and a programme slug whole (fleet.css, D-6332, `desk-rule-not-container-threshold`),
 *  so no budget applies at the desk. */
export const NAME_BUDGET = 28;
export const PROGRAMME_BUDGET = 16;

/** The ROW's state word for every bucket (the card's and the header's fact). */
export const STATE_WORD: Record<SessionBucket, string> = {
  attention: 'waiting', working: 'working', done: 'done', idle: 'idle',
  cleanup: 'merged', archived: 'archived', dead: 'exited',
};

/**
 * Shorten `text` to at most `max` characters by WHOLE tokens — a token ends at
 * `-`, `/`, `_`, `.` or a space, and keeps its separator — and mark the cut with
 * `…`. Never cuts inside a token: when even the first token is longer than
 * `max`, that token is kept whole. Returns `text` itself when it fits.
 */
export function shortenByToken(text: string, max: number): string {
  if (text.length <= max) return text;
  const tokens = text.match(/[^-/_. ]+[-/_. ]*|[-/_. ]+/g) ?? [text];
  let out = '';
  for (const t of tokens) {
    const word = t.replace(/[-/_. ]+$/, '');
    // The first WORD is kept whole whatever the budget — a separator-led text (`.cache-…`) included — so the
    // result is never a bare `…` (verifier round 1).
    const hasWord = /[^-/_. ]/.test(out);
    if (hasWord && (out + word).length > max - 1) break;
    out += t;
    if (/[^-/_. ]/.test(out) && out.length >= max - 1) break;
  }
  out = out.replace(/[-/_. ]+$/, '');
  return out.length >= text.length ? text : `${out}…`;
}

/** Every fact a session can carry, by key. A card fact and its header fact share the key. */
export type FactKey =
  | 'name' | 'status' | 'role' | 'working-on'
  | 'programme' | 'coordinator' | 'run' | 'child-marker' | 'hold'
  | 'pr' | 'branch' | 'tasks' | 'graph' | 'cleanup' | 'lane'
  | 'ask-state' | 'build' | MarkerKey;

/** The attention markers, in their FIXED priority: the card shows the first one present. `behind` (D-8276: an older
 *  Claude Code build than the fleet's newest) is the quietest, last: a tracking fact, which a roll fixes only where the
 *  session's own lane runs a newer build. */
export const MARKER_ORDER = [
  'unreachable', 'coordinator-gone', 'spawn', 'needs-you', 'with-coordinator', 'lifecycle', 'stranded',
  'swap-blocked', 'stalled', 'limit', 'ctx', 'coordinator-hibernated', 'restarted', 'unreadable', 'off-pool', 'behind',
] as const;
export type MarkerKey = typeof MARKER_ORDER[number];

/** One fact: what it says in full, a shorter form for the card when it has one, and its tooltip. */
export interface Fact {
  readonly key: FactKey;
  readonly text: string;
  readonly short?: string;
  readonly title?: string;
}

/** What the model is told. Everything a CARD knows is here; the header passes the same. */
export interface FactInput {
  readonly session: FleetSession;
  readonly now: number;
  readonly roster?: readonly RosterWire[];
  readonly projectPool?: ProjectPoolWire | null;
  /** The active run bound to this session and its coordinator's name (`childRunContext`). */
  readonly childRun?: ChildRunContext;
  /** The project whose code it works on, when it renders under another (D-5527). */
  readonly workingOn?: string | null;
  /** The presence of its coordinator when that coordinator is not a live row beside it
   *  (`orphanNote`'s `presence`): `dead` is "coordinator gone", `hibernated` says so. */
  readonly coordinator?: CoordinatorPresence | null;
  /** The orphan marker's guidance (`orphanGuidance`): the card and the header both put it on the marker. */
  readonly coordinatorTitle?: string | null;
  /** The session's worktrees, for the header's details (`worktreesOf`, D-8782: the fleet list draws none). Absent or `null` = none known. */
  readonly worktrees?: readonly SessionWorktree[] | null;
  /** D-8276: the newest Claude Code build an awake session on the fleet runs (`fleetClaudeLatest` over the fleet store's
   *  rows). Absent or `null` = unknown, and nothing is said to be behind. */
  readonly claudeLatest?: string | null;
  /** D-8276: the newest build an awake session on THIS session's lane runs (`laneClaudeLatest`): what a restart reaches.
   *  Absent or `null` = unknown, and the words promise no roll. */
  readonly claudeLaneLatest?: string | null;
}

/** Everything the session's rows render, decided once. The cells read these values;
 *  `cardFacts` and `headerFacts` read the same set, so the two can never disagree. */
export interface SessionFactSet {
  readonly session: FleetSession;
  /** The clock these facts were decided at. */
  readonly now: number;
  readonly dead: boolean;
  readonly asleepAt: number | null;
  readonly name: string;
  readonly state: string;
  readonly statusText: string;
  readonly statusTitle: string | undefined;
  /** The state word's ink: the bucket's, or `coordinator` while a parent holds the question (D-5296). */
  readonly stateTone: string;
  readonly coordinatorRole: boolean;
  readonly workingOn: string | null;
  readonly childOf: ChildOfRunLabel | null;
  readonly activeRun: NonNullable<ChildRunContext['run']> | null;
  readonly coordinatorName: string | null;
  /** The run that explains the hold — the hold cell then reads programme and wave. */
  readonly heldRun: NonNullable<ChildRunContext['run']> | null;
  readonly heldTitle: string | null;
  readonly spawn: SpawnChip | null;
  readonly restart: RestartWords | null;
  readonly unmeasured: readonly string[];
  readonly substrate: { readonly text: string; readonly title: string } | null;
  readonly askState: { readonly state: string; readonly label: string; readonly title: string } | null;
  readonly withCoordinator: { readonly text: string; readonly title: string } | null;
  readonly needsYou: boolean;
  readonly lifecycle: string | null;
  readonly swap: { readonly note: string; readonly title: string } | null;
  readonly strand: { readonly note: string; readonly title: string } | null;
  readonly cleanup: readonly string[];
  readonly tasks: { readonly done: number; readonly total: number } | null;
  readonly graph: { readonly reads: number; readonly gated: number | null } | null;
  readonly background: { readonly text: string; readonly title: string } | null;
  readonly ctx: { readonly pct: number; readonly wedged: boolean; readonly text: string; readonly title: string } | null;
  readonly limit: { readonly text: string } | null;
  readonly lane: { readonly name: string; readonly away: boolean; readonly label: string | undefined };
  readonly offPool: string | null;
  readonly orphan: 'gone' | 'hibernated' | null;
  readonly orphanTitle: string | null;
  /** The session's worktrees (D-8782): drawn in the header's details with their controls, never on the card. Empty when none. */
  readonly worktrees: readonly SessionWorktree[];
  /** D-8276: the session's Claude Code build against the fleet's newest (`claudeBuildOf`). */
  readonly build: ClaudeBuildFact;
}

function askWords(ask: { state: string; parentId: string; answeredBy: string | null }):
  { label: string; title: string } {
  if (ask.state === 'held') {
    return {
      label: `held — ${ask.parentId} may answer`,
      title: `${ask.parentId} may answer this question before the operator is notified`,
    };
  }
  if (ask.answeredBy === ASK_OPERATOR_PRINCIPAL) {
    return { label: 'answered by you', title: 'you answered this question yourself, before its parent pre-empted it' };
  }
  if (ask.answeredBy === null) {
    return {
      label: 'answered',
      title: 'this question was answered before the operator was notified; the row names no principal',
    };
  }
  return {
    label: `ruled by ${ask.answeredBy}`,
    title: `${ask.answeredBy} answered this question before the operator was notified`,
  };
}

const markerNote = (
  marker: { reason?: unknown } | null | undefined, word: string,
): { note: string; title: string } | null => {
  if (marker === null || marker === undefined) return null;
  const reason = typeof marker.reason === 'string' && marker.reason !== '' ? marker.reason : null;
  const note = reason === null ? word : `${word} — ${reason}`;
  return { note, title: reason ?? note };
};

/** The word a row says for its state: `asleep` for a hibernated row, otherwise its bucket's `STATE_WORD`. The one
 *  spelling, read by the row's facts below and by the rollup's worker line (D-6088), which counts rows by it. */
export const rowStateWord = (session: FleetSession): string =>
  hibernatedSince(session) !== null ? 'asleep' : STATE_WORD[session.bucket];

/** Is this session its project's coordinator? `role === 'coordinator'` and nothing else: a null or absent role (an older
 *  server) is a worker, and claiming a run never makes a session one. THE ONE READER of `FleetSession.role` in
 *  `pwa/src` (D-5301): the row's facts below and the palette's session entries (`sessionEntries.ts`, D-6714) ask it. */
export function coordinatorRole(session: FleetSession): boolean {
  const role: unknown = (session as { role?: unknown }).role;
  return role === 'coordinator';
}

/** The word a coordinator is called: the badge's accessible name (D-8817), and the palette's session entries' text, which
 *  the operator types to search. No row or header draws it as visible text any more. */
export const COORDINATOR_WORD = 'coordinator';

/** The role's hover title, written once: the card's role badge and the header's read it. */
export const COORDINATOR_ROLE_TITLE = 'this session is its project\'s coordinator';

/** THE coordinator badge (the operator's note of 2026-11-19, D-8817), spelt once: the icon, the accessible name and the
 *  hover title `RoleBadge` (`@ccrc/ui`) draws, which the card's role cell and the header's role detail both spread. */
export const COORDINATOR_BADGE = { icon: 'network', label: COORDINATOR_WORD, title: COORDINATOR_ROLE_TITLE } as const;

/** The role fact: the card's (D-8142) and the header's one object. It is the name and title the badge carries (the same two
 *  constants as `COORDINATOR_BADGE`), as a `Fact`, for the one place that asks whether a card has a role cell. */
const ROLE_FACT: Fact = { key: 'role', text: COORDINATOR_WORD, title: COORDINATOR_ROLE_TITLE };

/** The width the card's role cell takes on the context line, in characters of the meta line's mono face (D-8142, D-8817):
 *  the badge's 16px icon, 2.2 characters at the meta line's `--fs-xs` (12px), rounded up to 3, and its middot separator. A
 *  branch beside it shortens to `NAME_BUDGET` less this, so the one line holds both whole. The cell was 11 characters and
 *  the separator (14) when it drew the word. */
export const ROLE_CELL_CHARS = 3 + ' · '.length;

/** D-8771: the words `backgroundWords` puts after its count (`in background`), TAKEN FROM ITS OWN OUTPUT, so the words are
 *  spelt once, in `shared/api.ts`: a reword there reaches the card's uncounted form and the allowance below together. */
const BACKGROUND_UNCOUNTED = backgroundWords({ count: 1, kinds: [] }).text.replace(/^\d+ /, '');

/** D-8771: the card's words for a working row's delegated background work (D-5231): the words with no count; the
 *  title carries the count and the kinds. The header's own words are `backgroundWords` (`N in background`). */
function cardBackgroundWords(b: { count: number; kinds: string[] }): { text: string; title: string } {
  return { text: BACKGROUND_UNCOUNTED, title: `${b.count} ${backgroundWords(b).title}` };
}

/** Decide every fact of one session. Pure: the clock comes in as `now`. */
export function sessionFacts(input: FactInput): SessionFactSet {
  const {
    session, now, roster = [], projectPool = null, childRun, workingOn = null, coordinator = null,
    coordinatorTitle = null, worktrees = null, claudeLatest = null, claudeLaneLatest = null,
  } = input;
  const dead = paneGone(session);
  const asleepAt = hibernatedSince(session);
  const state = rowStateWord(session);

  const childOf = childOfRunLabel(session, childRun);
  const activeRun = childRun?.run ?? null;
  const heldRun = session.held !== null && activeRun !== null && childOf?.data !== 'unreadable' ? activeRun : null;
  const heldTitle = heldRun === null || session.held === null ? session.held
    : `${childOf?.title ?? runSentence(heldRun, childRun?.coordinator ?? null, false)} — ${heldWords(session.held)}`;

  const askRaw = sessionAsk(session);
  const wc = dead || state !== 'working' ? null : sessionWithCoordinator(session);
  const wcWords = wc === null ? null : withCoordinatorWords(wc, session.project);
  const ask = askRaw !== null && (askRaw.state === 'answered' || (askRaw.state === 'held' && wc === null)) ? askRaw : null;
  const askState = ask === null ? null : { state: ask.state, ...askWords(ask) };
  // A held ask is the coordinator answering first: on the card that is "with coordinator", not "needs you".
  const heldAsk = askRaw !== null && askRaw.state === 'held';

  const ctxPct = dead ? null : ctxPressure(session);
  const ctxHigh = ctxPct !== null && ctxPct >= CTX_PRESSURE;
  const bg = dead ? null : backgroundWork(session);
  const wedged = ctxHigh && !dead && session.status === 'busy' && !session.dialogPending && bg === null
    && turnStall(session, now);
  const turnAge = wedged && session.statusUpdatedAt !== null ? elapsedWords(now - session.statusUpdatedAt) : null;
  const bgWords = state === 'working' && bg !== null ? backgroundWords(bg) : null;
  // D-8771: the card says `in background` and not how many (the operator ruled a count of a session's delegated work noise
  // in the fleet list); the count and the kinds stay in the word's title, and the header keeps its count (`bgWords`).
  const cardBgWords = state === 'working' && bg !== null ? cardBackgroundWords(bg) : null;

  const fault = substrateFault(session);
  const substrate = fault === null ? null : {
    text: 'unreachable tmux',
    title: fault.at === 0 ? substrateFaultText(fault)
      : `tmux unreachable since ${new Date(fault.at).toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })} — ${fault.text}`,
  };

  const reads = dead ? null : graphReadCount(session);
  const gateDenials = graphGateCount(session);
  const five = session.limits?.five ?? null;
  const seven = session.limits?.seven ?? null;
  const critical = !dead && ((five !== null && five > CRITICAL) || (seven !== null && seven > CRITICAL));
  const worst = Math.max(five ?? 0, seven ?? 0);

  const away = !dead && session.wrapper !== session.home;
  const acctPool = accountPool(roster, session.wrapper);
  const projPoolName = projectPool !== null && projectPool.state === 'tagged' ? projectPool.name : null;
  const offPool = !dead && acctPool !== null && projPoolName !== null && acctPool !== projPoolName
    ? `running on ${accountLabel(roster, session.wrapper)} (pool ${acctPool}), project is pool ${projPoolName}`
    : null;

  return {
    session, now, dead, asleepAt,
    name: sessionLabel(session),
    state,
    // The status word carries its own qualifiers, as it did on the one-line row: the hibernated age (D-5242),
    // `with coordinator · <parent>` while a parent holds the question (D-5296, D-5390), and the delegated
    // background work (D-5231). They are WHAT the lamp means, not extra facts.
    statusText: asleepAt !== null ? hibernatedWords(asleepAt, now)
      : wcWords !== null ? wcWords.text
      : cardBgWords !== null ? `${state} · ${cardBgWords.text}` : state,
    statusTitle: wcWords?.title ?? cardBgWords?.title,
    stateTone: wcWords !== null ? 'coordinator' : state,
    coordinatorRole: coordinatorRole(session),
    workingOn,
    childOf, activeRun, coordinatorName: childRun?.coordinator ?? null, heldRun, heldTitle,
    spawn: spawnChip(session),
    restart: dead ? null : restartWords(session, now),
    unmeasured: unmeasuredFields(session),
    substrate,
    askState,
    // The marker only when the status word does not already say so (a held ask on a row the server has not
    // filed `working` with the field — an older server, or a lapsed hold).
    withCoordinator: wcWords === null && !dead && heldAsk && askRaw !== null
      ? { text: 'with coordinator', title: askWords(askRaw).title } : null,
    needsYou: !dead && session.bucket === 'attention' && !heldAsk,
    lifecycle: asleepAt !== null ? null : lifecycleQualifier(session, now),
    swap: (() => { const m = markerNote(session.swapBlocked, 'swap blocked'); return m; })(),
    strand: dead ? null : markerNote(session.stranded, 'stranded'),
    // The merged PR's number is the `pr` fact (the card's context, the header's detail); the cleanup bucket adds
    // only its reclaimable size — the header used to print `#77` three times.
    cleanup: session.bucket === 'cleanup' && session.archivedBytes !== null ? [humanBytes(session.archivedBytes)] : [],
    tasks: !dead && session.tasks !== null ? { done: session.tasks.done, total: session.tasks.total } : null,
    graph: reads === null ? null : { reads, gated: gateDenials !== null && gateDenials > 0 ? gateDenials : null },
    background: bgWords,
    ctx: !ctxHigh || ctxPct === null ? null : {
      pct: ctxPct, wedged,
      text: `ctx ${ctxPct}%${wedged ? ` · stalled ${turnAge}` : ''}`,
      title: wedged
        ? `context ${ctxPct}% · no turn boundary for ${turnAge} — may be wedged in a blocking compaction`
        : `context window ${ctxPct}% (Claude Code's own reading of its window, not this account's usable wall)`,
    },
    limit: critical ? { text: `limit ${worst}%` } : null,
    lane: {
      name: accountLabel(roster, session.wrapper),
      away,
      label: offPool ?? (away
        ? `running on ${accountLabel(roster, session.wrapper)}, pinned to ${accountLabel(roster, session.home)}`
        : undefined),
    },
    offPool,
    orphan: coordinator === 'dead' ? 'gone' : coordinator === 'hibernated' ? 'hibernated' : null,
    orphanTitle: coordinator === 'dead' || coordinator === 'hibernated' ? coordinatorTitle : null,
    worktrees: worktrees ?? [],
    build: claudeBuildOf(session, claudeLatest, claudeLaneLatest),
  };
}


/** Every attention marker present, in `MARKER_ORDER`, each with its full text and a short card form. */
export function markers(f: SessionFactSet): Fact[] {
  const out: Fact[] = [];
  const add = (key: MarkerKey, text: string, short: string = text, title?: string): void => {
    out.push({ key, text, short, ...(title === undefined ? {} : { title }) });
  };
  if (f.substrate !== null) add('unreachable', f.substrate.text, f.substrate.text, f.substrate.title);
  if (f.orphan === 'gone') add('coordinator-gone', 'coordinator gone', 'coordinator gone', f.orphanTitle ?? undefined);
  // A spawn that did not come up healthy (`login`, `blocked`, `vanished`, `unstarted`, …) asks the operator to act.
  if (f.spawn !== null) add('spawn', f.spawn.word, f.spawn.word, `last spawn: ${f.spawn.data}`);
  if (f.needsYou) add('needs-you', 'needs you');
  if (f.withCoordinator !== null) add('with-coordinator', f.withCoordinator.text, 'with coordinator', f.withCoordinator.title);
  // Whole: which kind of dead a row is names its remedy (`orphan — nothing is watching it` vs `unclaimed — a live
  // pane with no claim`), so the card keeps the words and lets them wrap rather than cut them to a fragment.
  if (f.lifecycle !== null) add('lifecycle', f.lifecycle, f.lifecycle, f.lifecycle);
  if (f.strand !== null) add('stranded', f.strand.note, 'stranded', f.strand.title);
  if (f.swap !== null) add('swap-blocked', f.swap.note, 'swap blocked', f.swap.title);
  if (f.ctx !== null && f.ctx.wedged) add('stalled', f.ctx.text, f.ctx.text, f.ctx.title);
  if (f.limit !== null) add('limit', f.limit.text, f.limit.text, 'account limit near');
  if (f.ctx !== null && !f.ctx.wedged) add('ctx', f.ctx.text, f.ctx.text, f.ctx.title);
  if (f.orphan === 'hibernated') {
    add('coordinator-hibernated', 'coordinator hibernated', 'coordinator hibernated', f.orphanTitle ?? undefined);
  }
  if (f.restart !== null) add('restarted', f.restart.text, 'restarted', f.restart.title);
  if (f.unmeasured.length > 0) {
    add('unreadable', 'unreadable', 'unreadable', unmeasuredTitle(f.unmeasured));
  }
  if (f.offPool !== null) add('off-pool', 'off-pool', 'off-pool', f.offPool);
  if (f.build.kind === 'behind') {
    const b = behindFact(f.build);
    add('behind', b.text, b.short, b.title);
  }
  return out.sort((a, b) => MARKER_ORDER.indexOf(a.key as MarkerKey) - MARKER_ORDER.indexOf(b.key as MarkerKey));
}

/** The card's ONE context fact: a child's programme and wave; a child no open run
 *  names, or an unreadable marker, says so; a hand hold says `held`; otherwise the
 *  PR, else a branch the name does not already show; else nothing. */
export function contextFact(f: SessionFactSet): Fact | null {
  const s = f.session;
  const run = f.heldRun ?? (f.childOf?.data === 'child' ? f.activeRun : null);
  if (run !== null) {
    const full = programmeWave(run);
    return { key: 'programme', text: full, short: `${shortenByToken(run.program, PROGRAMME_BUDGET)}${programmeWaveTail(run)}`,
      title: f.heldTitle ?? f.childOf?.title ?? full };
  }
  if (f.childOf !== null) return { key: 'child-marker', text: f.childOf.text, title: f.childOf.title };
  if (s.held !== null) return { key: 'hold', text: 'held', title: s.held };
  if (s.workspace !== null && s.pr?.number != null) return { key: 'pr', text: `PR #${s.pr.number}` };
  if (s.workspace !== null && s.branch !== null && s.branch !== f.name) {
    return { key: 'branch', text: s.branch, short: shortenByToken(s.branch, NAME_BUDGET), title: s.branch };
  }
  return null;
}

/** What the CARD shows: a glance. */
export interface CardFacts {
  readonly name: Fact;
  readonly status: Fact;
  readonly context: Fact | null;
  /** `coordinator`, for a session that is its project's coordinator; never a child's (D-8142). */
  readonly role: Fact | null;
  readonly marker: Fact | null;
  readonly workingOn: Fact | null;
}

export function cardFacts(f: SessionFactSet): CardFacts {
  const short = shortenByToken(f.name, NAME_BUDGET);
  const role: Fact | null = f.coordinatorRole ? ROLE_FACT : null;
  const ctx = contextFact(f);
  // The role cell takes the front of the context line, so a branch beside it shortens to what is left of the budget.
  const context = role !== null && ctx !== null && ctx.key === 'branch'
    ? { ...ctx, short: shortenByToken(ctx.text, NAME_BUDGET - ROLE_CELL_CHARS) } : ctx;
  return {
    name: { key: 'name', text: f.name, short, title: f.name },
    status: { key: 'status', text: f.statusText, ...(f.statusTitle === undefined ? {} : { title: f.statusTitle }) },
    context,
    role,
    marker: markers(f)[0] ?? null,
    workingOn: f.workingOn === null ? null : { key: 'working-on', text: f.workingOn, title: `works on ${f.workingOn}’s code` },
  };
}

/** One cell of the header's meta row (`SessionMeta`, header mode): which fact it draws, and for a marker or a cleanup fact,
 *  which one. */
export type HeaderMetaCell =
  | { readonly key: 'hold' | 'child' | 'spawn' | 'ask-state' | 'tasks' | 'graph' | 'build' }
  | { readonly key: 'cleanup'; readonly text: string; readonly at: number }
  | { readonly key: 'marker'; readonly fact: Fact };

/** The header's meta row, cell by cell, in `SessionMeta`'s order: the ONE reading of which cells it draws (desktop polish HF2,
 *  D-8877; review 2995 F3). `SessionMeta` draws exactly these, and `headerMetaHasCells` asks whether there is one, so the
 *  details row is decided from the facts (`detailsHaveFacts`, desktop polish C51 review 2963 F3 to F6) and never from a
 *  second reading of the row's conditions. The cells: the hold (unless the context is the programme, which the coordination
 *  row names), the child marker (its hedge, when no held run names it), the last spawn, the ask-state chip, the cleanup
 *  facts, the task tally, the graph counter, the current build, and every marker but the spawn and the restart (the header
 *  draws those as chips of its own). No subagent and no delegated cell (session helpers H3, D-8875). */
export function headerMetaCells(f: SessionFactSet): readonly HeaderMetaCell[] {
  const ctx = contextFact(f);
  const out: HeaderMetaCell[] = [];
  if (f.session.held !== null && ctx?.key !== 'programme') out.push({ key: 'hold' });
  if (ctx?.key === 'child-marker' && f.childOf !== null && f.heldRun === null) out.push({ key: 'child' });
  if (f.spawn !== null) out.push({ key: 'spawn' });
  if (f.askState !== null) out.push({ key: 'ask-state' });
  f.cleanup.forEach((text, at) => { out.push({ key: 'cleanup', text, at }); });
  if (f.tasks !== null) out.push({ key: 'tasks' });
  if (f.graph !== null) out.push({ key: 'graph' });
  if (f.build.kind === 'current') out.push({ key: 'build' });
  for (const m of markers(f)) if (m.key !== 'spawn' && m.key !== 'restarted') out.push({ key: 'marker', fact: m });
  return out;
}

/** Whether the header's meta row draws ANY cell for these facts (`headerMetaCells`, its one reading). */
export function headerMetaHasCells(f: SessionFactSet): boolean {
  return headerMetaCells(f).length > 0;
}

/** What the HEADER shows: every fact, in reading order. A superset of `cardFacts`. */
export function headerFacts(f: SessionFactSet): Fact[] {
  const s = f.session;
  const statusTitle = headerStatusTitle(f);
  const out: Fact[] = [
    { key: 'name', text: f.name },
    { key: 'status', text: headerStatusText(f), ...(statusTitle === undefined ? {} : { title: statusTitle }) },
    { key: 'lane', text: f.lane.name, ...(f.lane.label === undefined ? {} : { title: f.lane.label }) },
  ];
  if (f.coordinatorRole) out.push(ROLE_FACT);
  if (f.workingOn !== null) out.push({ key: 'working-on', text: f.workingOn });
  const ctx = contextFact(f);
  // The context fact under its own key — the programme and wave, the child marker, `held`, the PR or the branch.
  if (ctx !== null && ctx.key !== 'hold') {
    out.push({ key: ctx.key, text: ctx.text, ...(ctx.title === undefined ? {} : { title: ctx.title }) });
  }
  if (f.coordinatorName !== null) out.push({ key: 'coordinator', text: f.coordinatorName });
  // The verbatim hold, whenever there is one — the card's `held` or programme names it, the header spells it.
  if (s.held !== null) out.push({ key: 'hold', text: heldWords(s.held) });
  if (ctx?.key !== 'pr' && s.pr?.number != null) out.push({ key: 'pr', text: `PR #${s.pr.number}` });
  if (ctx?.key !== 'branch' && s.branch !== null && s.branch !== f.name) out.push({ key: 'branch', text: s.branch });
  if (f.tasks !== null) out.push({ key: 'tasks', text: `${f.tasks.done}/${f.tasks.total} tasks` });
  if (f.askState !== null) out.push({ key: 'ask-state', text: f.askState.label, title: f.askState.title });
  if (f.graph !== null) {
    out.push({ key: 'graph', text: `graph ${f.graph.reads}${f.graph.gated === null ? '' : ` · gated ${f.graph.gated}`}` });
  }
  for (const c of f.cleanup) out.push({ key: 'cleanup', text: c });
  // D-8276: the build of a session on the newest one; a session behind says its build in the `behind` marker below.
  if (f.build.kind === 'current') out.push({ key: 'build', text: buildText(f.build.build) });
  for (const m of markers(f)) out.push({ key: m.key, text: m.text, ...(m.title === undefined ? {} : { title: m.title }) });
  return out;
}

/** The ONE allowance to the subset rule (D-8771, the coordinator's ruling of 2026-11-19): the header keeps a count the card
 *  dropped, so the header's `working · 2 in background` holds the card's `working · in background`, and a card that says the
 *  header's own words, count and all, is held too. A row names the fact key it applies to, the header's count (`count`) and
 *  the card's spelling of the same words (`card`), both built from `BACKGROUND_UNCOUNTED`, which is `backgroundWords`' own
 *  words, so nothing is spelt twice; no other key and no other words are allowed, and `card-header-facts.test.tsx` reds if
 *  this table loses its row, gains a wider one or changes the regex's flags. */
export const HEADER_COUNT_ALLOWANCES: readonly { readonly key: FactKey; readonly count: RegExp; readonly card: string }[] = [
  {
    key: 'status',
    count: new RegExp(` · \\d+ ${BACKGROUND_UNCOUNTED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    card: ` · ${BACKGROUND_UNCOUNTED}`,
  },
];

/** The subset rule, as a predicate the test and the harness both call: every card fact has a header fact under its
 *  key carrying its FULL text. */
export function cardWithinHeader(card: CardFacts, header: readonly Fact[]): Fact[] {
  const shown = [card.name, card.status, card.context, card.role, card.marker, card.workingOn]
    .filter((x): x is Fact => x !== null);
  // The header's form BEGINS with the card's: the same words, the header adding what the glance leaves out
  // (`waiting` → `waiting on you`, `idle` → `idle · 2m ago`, `held` → `held: <the verbatim hold>`).
  // D-8771: the card carries no `delegated` fact, so D-7782's comparison of it by count is gone; every key is a prefix test.
  // The header's forms of a fact are its own text and that text with its row of `HEADER_COUNT_ALLOWANCES` applied, if it has
  // one: the single place the prefix rule is bent (D-8771), data in the one comparison, not a second comparison. A card
  // fact equal to the header word for word holds by the first form, one without the count by the second.
  const forms = (h: Fact): string[] => {
    const a = HEADER_COUNT_ALLOWANCES.find((x) => x.key === h.key);
    return a === undefined ? [h.text] : [h.text, h.text.replace(a.count, a.card)];
  };
  const holds = (c: Fact, h: Fact): boolean => h.key === c.key && forms(h).some((t) => t.startsWith(c.text));
  return shown.filter((c) => !header.some((h) => holds(c, h)));
}

/** The verbatim hold, as the header spells it — one prefix wherever it is printed. */
export const heldWords = (held: string): string => `held: ${held}`;

/** '04:12' (or '1:04:12') elapsed — rendered in tabular-nums mono. */
export function clock(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * THE HEADER'S STATUS WORD (verifier round 1: it was the header's own, and a dead row read `exited` on its card
 * and `not running` above its chat). Decided here, from the bucket the header paints, and it always BEGINS with
 * the card's word (`STATE_WORD`): the header only adds what this one screen knows — the live elapsed clock, the
 * age, `on you`, `ready to clean up`. The lamp (`StatusDot`) keeps its own spoken label.
 */
export function headerStatusWord(input: {
  readonly bucket: SessionBucket;
  readonly asleepAt: number | null;
  readonly background: { readonly text: string } | null;
  /** When the status last changed, or `null`. */
  readonly at: number | null;
  readonly now: number;
}): string {
  const { bucket, asleepAt, background, at, now } = input;
  if (asleepAt !== null) return hibernatedWords(asleepAt, now);
  const rel = at === null ? null : elapsedShort(now - at);
  switch (bucket) {
    case 'attention': return `${STATE_WORD.attention} on you`;
    case 'working':
      return background !== null ? `working · ${background.text}` : at !== null ? `working · ${clock(now - at)}` : 'working…';
    case 'done': return rel !== null ? `done · ${rel} ago` : 'done';
    case 'idle': return rel !== null ? `idle · ${rel} ago` : 'idle';
    // `statusLabel('cleanup')` is `merged, ready to clean up` — the card's `merged` and the reason it waits.
    case 'cleanup': return statusLabel('cleanup');
    case 'archived': return statusLabel('archived');
    case 'dead': return STATE_WORD.dead;
  }
}

/** The header's status fact's title (L1-2, D-8771): the header's OWN background words (`backgroundWords`, the kinds, no count), or the
 *  with-coordinator title; never the card's (`statusTitle`, which carries the count and is the card's). */
function headerStatusTitle(f: SessionFactSet): string | undefined {
  return f.stateTone === 'coordinator' ? f.statusTitle : f.background?.title;
}

/** The header's status fact for the model's own row: the clock-free form of `headerStatusWord`. The
 *  with-coordinator words are the card's verbatim (the header draws them in two spans). */
function headerStatusText(f: SessionFactSet): string {
  if (f.asleepAt !== null || f.stateTone === 'coordinator') return f.statusText;
  return headerStatusWord({
    bucket: f.session.bucket, asleepAt: null, background: f.background, at: f.session.statusUpdatedAt, now: f.now,
  });
}
