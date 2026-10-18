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
//     the cross-project chip (D-5527). No bookkeeping ids, no fragment cut by an
//     ellipsis: a long name or programme is shortened HERE, by whole tokens
//     (`shortenByToken`), never mid-token, and the full text rides `title`.
//   • The HEADER is the full set — a SUPERSET of the card: every card fact under
//     the same key, with its full text, plus everything the card leaves out.
//     `cardFacts(f)` ⊆ `headerFacts(f)` is pinned by `session-facts.test.ts`.
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
import { humanBytes } from '../screens/ArchiveScreen';
import { lifecycleQualifier } from './lifecycleWords';
import { hibernatedSince, hibernatedWords } from './hibernated';
import {
  childOfRunLabel, programmeWave, programmeWaveTail, runSentence,
  type ChildOfRunLabel, type ChildRunContext,
} from './runWords';
import { spawnChip, type SpawnChip } from './spawnWords';
import { substrateFaultText } from './substrateWords';
import type { CoordPresence } from './coordWords';
import { sessionLabel } from './sessionLabel';
import { unmeasuredTitle } from './chips';

/** Routing policy calls a window critical above this. */
export const CRITICAL = 75;
/** Context-pressure floor (D-2011), statusline-command.sh's own. */
export const CTX_PRESSURE = 80;
/** The card's name budget, in characters, and its programme budget. Chosen by
 *  measurement at 360px (both skins): the card's text column is 226px — ~30
 *  label characters at 7.4px, ~31 mono characters at 7.2px — and the context
 *  line holds the programme plus its wave (` · wave 3 of 5`, 14 characters). */
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
  | 'pr' | 'branch' | 'tasks' | 'subagents' | 'graph' | 'cleanup' | 'lane'
  | 'ask-state' | MarkerKey;

/** The attention markers, in their FIXED priority: the card shows the first one present. */
export const MARKER_ORDER = [
  'unreachable', 'coordinator-gone', 'spawn', 'needs-you', 'with-coordinator', 'lifecycle', 'stranded',
  'swap-blocked', 'stalled', 'limit', 'ctx', 'coordinator-hibernated', 'restarted', 'unreadable', 'off-pool',
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
  readonly coordinator?: CoordPresence | null;
  /** The orphan marker's guidance (`orphanGuidance`): the card and the header both put it on the marker. */
  readonly coordinatorTitle?: string | null;
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
  readonly subagents: FleetSession['subagents'] | null;
  readonly background: { readonly text: string; readonly title: string } | null;
  readonly ctx: { readonly pct: number; readonly wedged: boolean; readonly text: string; readonly title: string } | null;
  readonly limit: { readonly text: string } | null;
  readonly lane: { readonly name: string; readonly away: boolean; readonly label: string | undefined };
  readonly offPool: string | null;
  readonly orphan: 'gone' | 'hibernated' | null;
  readonly orphanTitle: string | null;
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

/** Decide every fact of one session. Pure: the clock comes in as `now`. */
export function sessionFacts(input: FactInput): SessionFactSet {
  const {
    session, now, roster = [], projectPool = null, childRun, workingOn = null, coordinator = null,
    coordinatorTitle = null,
  } = input;
  const dead = session.status === 'dead';
  const asleepAt = hibernatedSince(session);
  const state = asleepAt !== null ? 'asleep' : STATE_WORD[session.bucket];

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

  const role: unknown = (session as { role?: unknown }).role;

  return {
    session, now, dead, asleepAt,
    name: sessionLabel(session),
    state,
    // The status word carries its own qualifiers, as it did on the one-line row: the hibernated age (D-5242),
    // `with coordinator · <parent>` while a parent holds the question (D-5296, D-5390), and the delegated
    // background work (D-5231). They are WHAT the lamp means, not extra facts.
    statusText: asleepAt !== null ? hibernatedWords(asleepAt, now)
      : wcWords !== null ? wcWords.text
      : bgWords !== null ? `${state} · ${bgWords.text}` : state,
    statusTitle: wcWords?.title ?? bgWords?.title,
    stateTone: wcWords !== null ? 'coordinator' : state,
    coordinatorRole: role === 'coordinator',
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
    subagents: dead ? null : session.subagents,
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
  readonly marker: Fact | null;
  readonly workingOn: Fact | null;
}

export function cardFacts(f: SessionFactSet): CardFacts {
  const short = shortenByToken(f.name, NAME_BUDGET);
  return {
    name: { key: 'name', text: f.name, short, title: f.name },
    status: { key: 'status', text: f.statusText, ...(f.statusTitle === undefined ? {} : { title: f.statusTitle }) },
    context: contextFact(f),
    marker: markers(f)[0] ?? null,
    workingOn: f.workingOn === null ? null : { key: 'working-on', text: f.workingOn, title: `works on ${f.workingOn}’s code` },
  };
}

/** What the HEADER shows: every fact, in reading order. A superset of `cardFacts`. */
export function headerFacts(f: SessionFactSet): Fact[] {
  const s = f.session;
  const out: Fact[] = [
    { key: 'name', text: f.name },
    { key: 'status', text: headerStatusText(f), ...(f.statusTitle === undefined ? {} : { title: f.statusTitle }) },
    { key: 'lane', text: f.lane.name, ...(f.lane.label === undefined ? {} : { title: f.lane.label }) },
  ];
  if (f.coordinatorRole) out.push({ key: 'role', text: 'coordinator' });
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
  if (f.subagents !== null && f.subagents.length > 0) {
    out.push({ key: 'subagents', text: `${f.subagents.length} subagent${f.subagents.length === 1 ? '' : 's'}` });
  }
  if (f.askState !== null) out.push({ key: 'ask-state', text: f.askState.label, title: f.askState.title });
  if (f.graph !== null) {
    out.push({ key: 'graph', text: `graph ${f.graph.reads}${f.graph.gated === null ? '' : ` · gated ${f.graph.gated}`}` });
  }
  for (const c of f.cleanup) out.push({ key: 'cleanup', text: c });
  for (const m of markers(f)) out.push({ key: m.key, text: m.text, ...(m.title === undefined ? {} : { title: m.title }) });
  return out;
}

/** The subset rule, as a predicate the test and the harness both call: every card
 *  fact has a header fact under its key carrying its FULL text. */
export function cardWithinHeader(card: CardFacts, header: readonly Fact[]): Fact[] {
  const shown = [card.name, card.status, card.context, card.marker, card.workingOn].filter((x): x is Fact => x !== null);
  // The header's form BEGINS with the card's: the same words, the header adding what the glance leaves out
  // (`waiting` → `waiting on you`, `idle` → `idle · 2m ago`, `held` → `held: <the verbatim hold>`).
  return shown.filter((c) => !header.some((h) => h.key === c.key && h.text.startsWith(c.text)));
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
    case 'archived': return STATE_WORD.archived;
    case 'dead': return STATE_WORD.dead;
  }
}

/** The header's status fact for the model's own row: the clock-free form of `headerStatusWord`. The
 *  with-coordinator words are the card's verbatim (the header draws them in two spans). */
function headerStatusText(f: SessionFactSet): string {
  if (f.asleepAt !== null || f.stateTone === 'coordinator') return f.statusText;
  return headerStatusWord({
    bucket: f.session.bucket, asleepAt: null, background: f.background, at: f.session.statusUpdatedAt, now: f.now,
  });
}
