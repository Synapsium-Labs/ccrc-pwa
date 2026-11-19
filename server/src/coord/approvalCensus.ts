// THE APPROVAL CENSUS'S DECISIONS (approvals plan 2026-11-18, §3.1, Tasks 1.3 and 1.4). Ring L1, context C6: pure, no I/O,
// no clock, imports `shared/` and types only. Four decisions, each made once:
//  - `censusSightingOf`: whether a painted permission prompt this tick leaves no approvals row, and so owes one census
//    row, with its path, route, thread and the key of its sighting (the questions owner writes it, `observeCensus`);
//  - `approvalShapedMenu`: whether a menu the pane shows is a permission prompt's (Yes ... No), for the erased envelope;
//  - `censusPathOfApproval`: where a minted approvals row went (Table 2a), whose answer settled it, and whether it
//    reached the operator;
//  - `approvalCensusOf`: the census read's answer, counts and the redacted rows, from the rows the store read.
// The read never answers an input: a minted row carries its masked, redacted `inputRedacted` cut to the envelope's 200
// characters, and a census row the envelope's summary as its writer masked it.
import type { Dialog, HookAsk } from '../../../shared/api.js';
import {
  READ_PROMPT_COMMANDS, parseApprovalRoute,
  type ApprovalCensusAuthority, type ApprovalCensusPath, type ApprovalCensusRowPath, type ApprovalCensusRowWire,
  type ApprovalCensusDenyCurrency, type ApprovalCensusUnmeasured, type ApprovalCensusWire,
} from '../../../shared/approval-census.js';
import { APPROVAL_HOOK_WAIT_S } from '../../../shared/api.js';
import { ASK_SETTLE_TICKS } from '../askwindow.js';

/** The summary's cut, the hook's own (`ask.approval.summary` is `.[0:200]`). */
export const CENSUS_SUMMARY_MAX = 200;
/** The newest rows the read lists; the counts are over every row in the window. */
export const CENSUS_ROWS_MAX = 500;

// ── the sighting ───────────────────────────────────────────────────────────────────────────────────────────────

/** The watcher's tick (`FleetWatcher`'s default interval), which turns the settle window's ticks into time. */
export const CENSUS_TICK_MS = 2_000;
/** A TIGHT match (review 2638 F5): a minted row's `askAt` within the settle window of the menu's first sighting. The
 *  hook writes its envelope, then mints; the menu paints beside it and is first seen up to a tick later. */
export const CENSUS_MATCH_MS = (ASK_SETTLE_TICKS + 1) * CENSUS_TICK_MS;
/** How long a `sent` envelope waits for its minted row before the census calls it `sent-no-row` (F6): the request is
 *  made right after the envelope's write, so a row later than this is lost or very late. */
export const CENSUS_ROW_WAIT_MS = 60_000;

/** One of the child's minted approvals rows, as the sighting matches it (the owner reads the child's rows minted since
 *  the hook's longest wait before the first sighting). */
export interface CensusMintedRow {
  readonly id: number; readonly askAt: number; readonly agentId: string; readonly state: string;
}

/** The last approval envelope a sighting saw: its ask, the hook state's stamp and its thread. */
export interface CensusEnvelope {
  readonly ask: Extract<HookAsk, { approval: unknown }>; readonly updatedAt: number; readonly waitBy: 'subagent' | null;
}

/** What the owner knows of a painted prompt when it decides: this tick's hook state, and the sighting's memory. */
export interface CensusSightingInput {
  /** Some tick of this sighting read a hook state for the child (one never present, or aged out before, is `false`). */
  readonly hsPresent: boolean;
  /** This tick's ask (null at the sighting's end). */
  readonly ask: HookAsk | null;
  /** The last approval envelope this sighting saw, on any tick (review 2667 F-B): once one was seen, it decides. */
  readonly envelope: CensusEnvelope | null;
  /** The first hook-state stamp this sighting saw: with the dialog id, the key of a menu's row (F-C). */
  readonly menuStamp: number | null;
  readonly dialog: Pick<Dialog, 'id' | 'parsed' | 'options' | 'ask' | 'multi'>;
  /** When the owner first saw `dialog` on this pane, and this tick's time (the server's clock, both). */
  readonly firstSeenAt: number;
  readonly now: number;
  /** The ticks this sighting has been painted. */
  readonly ticks: number;
  /** The sighting is ending (its menu cleared or was replaced): a menu with no envelope is decided only then (F-A). */
  readonly ending: boolean;
  readonly minted: readonly CensusMintedRow[];
}

/** A census row to write. */
export interface CensusWrite {
  readonly kind: 'write'; readonly path: ApprovalCensusRowPath; readonly why: ApprovalCensusUnmeasured | null;
  readonly route: string | null; readonly thread: 'main' | 'subagent' | null; readonly tool: string | null;
  readonly summary: string | null; readonly sightingKey: string;
}

/** A sighting's decision. `wait`: not decidable yet (a menu with no envelope until its sighting ends, or a sent request
 *  until its row arrives). `none`: decided, no census row (a minted row counts, `mintedId`; or no permission prompt).
 *  `write`: decided, one census row. The owner decides each sighting ONCE. */
export type CensusSighting =
  | { readonly kind: 'wait' }
  | { readonly kind: 'none'; readonly mintedId: number | null }
  | CensusWrite;

const NONE: CensusSighting = { kind: 'none', mintedId: null };
const WAIT: CensusSighting = { kind: 'wait' };
const OPEN_STATES: ReadonlySet<string> = new Set(['held', 'released']);
const HOOK_WAIT_MS = APPROVAL_HOOK_WAIT_S * 1000;

/** The summary as the census keeps it (F8): the hook cuts at 200 characters BEFORE the server can mask, so a cut summary
 *  loses its trailing word, which may be the front of a secret the masker could no longer match. */
export function censusSummaryOf(summary: string): string {
  if (summary.length < CENSUS_SUMMARY_MAX) return summary;
  return `${summary.slice(0, CENSUS_SUMMARY_MAX).replace(/\S+$/, '').trimEnd()}…`;
}

const threadOf = (agentId: string): 'main' | 'subagent' => (agentId === '' ? 'main' : 'subagent');

/** A request's own minted row (review 2667 F-C): the newest row of the thread that is still open (held or released, so
 *  its menu still stands) within the hook's whole wait before the first sighting, or any row of the thread minted
 *  beside the sighting. A sighting that starts late (a restart, a repaint, a flicker) still finds its row. */
function ownRow(x: CensusSightingInput, thread: 'main' | 'subagent'): CensusMintedRow | undefined {
  return [...x.minted].reverse().find((m) => threadOf(m.agentId) === thread
    && ((OPEN_STATES.has(m.state) && m.askAt >= x.firstSeenAt - HOOK_WAIT_MS) || m.askAt >= x.firstSeenAt - CENSUS_MATCH_MS));
}

/** Whether a painted prompt owes a census row (reviews 2638 and 2667). An approval envelope (this tick's, or the last the
 *  sighting saw, F-B) decides: `sent` (or a request answered `approval-released`) counts as its own minted row
 *  (`ownRow`), and is `sent-no-row` when none arrives within `CENSUS_ROW_WAIT_MS` or before the sighting ends; a skip
 *  word is path 1 (path 7 for `not-a-child`); `request-failed` counts as its own row when the client gave up after the
 *  mint, else path 2; any other refusal is path 2 (path 7 for the route's own `not-a-child`), with no row match (F-F);
 *  an envelope with no route word or one this build does not know is `unmeasured`. A menu with no envelope waits until
 *  its sighting ENDS (F-A), then: no hook state on any tick is `hookstate-gone`; a tight match (a row held or released,
 *  `askAt` within `CENSUS_MATCH_MS` of the first sighting, any thread, F-E) counts as that row; a menu that stood no
 *  longer than the watcher's settle window is `cleared-early`; any other row of the child near it is `near-miss`; none
 *  is path 6. Its key is the dialog and the first hook-state stamp, so a restart, a repaint or a flicker of one prompt
 *  lands on one row (F-C). An AskUserQuestion, and a menu that is not approval-shaped, is none. */
export function censusSightingOf(x: CensusSightingInput): CensusSighting {
  // The owner records this tick's approval envelope on the sighting before it asks, so `envelope` covers this tick too.
  const env = x.envelope;
  if (env !== null) {
    const ask = env.ask;
    const thread = env.waitBy === 'subagent' ? 'subagent' : 'main';
    const write = (path: ApprovalCensusRowPath, why: ApprovalCensusUnmeasured | null): CensusWrite => ({
      kind: 'write', path, why, route: ask.approval.route ?? null, thread, tool: ask.approval.tool,
      summary: censusSummaryOf(ask.approval.summary), sightingKey: `env:${env.updatedAt}`,
    });
    if (ask.approval.route === undefined) return write('unmeasured', 'no-route');
    const route = parseApprovalRoute(ask.approval.route);
    if (route === null) return write('unmeasured', 'unknown-route');
    if (route.kind === 'skip') return write(route.word === 'not-a-child' ? 'not-a-child' : 'hook-skipped', null);
    if (route.kind === 'refused' && route.word !== 'approval-released') {
      return write(route.word === 'not-a-child' ? 'not-a-child' : 'refused-at-mint', null);
    }
    const row = ownRow(x, thread);
    if (row !== undefined) return { kind: 'none', mintedId: row.id };
    if (route.kind === 'failed') return write('refused-at-mint', null);
    return x.ending || x.now - x.firstSeenAt >= CENSUS_ROW_WAIT_MS ? write('unmeasured', 'sent-no-row') : WAIT;
  }
  if (x.ask !== null || !approvalShapedMenu(x.dialog)) return NONE;
  if (!x.ending) return WAIT;
  const menu = (path: ApprovalCensusRowPath, why: ApprovalCensusUnmeasured | null): CensusWrite => ({
    kind: 'write', path, why, route: null, thread: null, tool: null, summary: null,
    sightingKey: `menu:${x.dialog.id}:${x.menuStamp ?? 'none'}`,
  });
  if (!x.hsPresent) return menu('unmeasured', 'hookstate-gone');
  const tight = [...x.minted].reverse().find((m) => OPEN_STATES.has(m.state) && Math.abs(m.askAt - x.firstSeenAt) <= CENSUS_MATCH_MS);
  if (tight !== undefined) return { kind: 'none', mintedId: tight.id };
  if (x.ticks <= ASK_SETTLE_TICKS) return menu('unmeasured', 'cleared-early');
  return x.minted.length > 0 ? menu('unmeasured', 'near-miss') : menu('envelope-erased', null);
}

/** A permission prompt's menu as Claude Code paints it: a parsed scraped menu (no AskUserQuestion, no multiSelect) whose
 *  first option is `Yes` and one of whose options begins `No`. A `/model` or `/effort` confirm has neither. */
export function approvalShapedMenu(d: Pick<Dialog, 'parsed' | 'options' | 'ask' | 'multi'>): boolean {
  if (!d.parsed || d.ask !== undefined || d.multi !== undefined || d.options.length < 2) return false;
  const label = (i: number): string => (d.options[i]?.label ?? '').trim();
  return label(0) === 'Yes' && d.options.some((o) => /^No\b/.test(o.label.trim()));
}

// ── a minted row ───────────────────────────────────────────────────────────────────────────────────────────────

export interface CensusApprovalFacts {
  readonly state: string; readonly releaseReason: string | null; readonly class: string;
  /** When the claimant's window ended, and when the row was answered (the operator's mark or the claimant's hand-over). */
  readonly notifyAt: number | null; readonly ruledAt: number | null;
}

type MintedPath = { readonly path: ApprovalCensusPath; readonly authority: ApprovalCensusAuthority; readonly reachedOperator: boolean };
const OPERATOR = (path: ApprovalCensusPath): MintedPath => ({ path, authority: 'operator', reachedOperator: true });

/** Where a minted approvals row went (Table 2a, and the coordinator's ruling on review 2638 F3): ruled by the claimant
 *  (path 0); still held; minted released (path 3); handed over by the claimant (`declined`); past the hook's ceiling
 *  with no principal (`stale`, which reached the operator: the menu stood and only they could answer); answered by the
 *  operator inside the claimant's window (`operator-first`); or a lapse: released at `notifyAt`, or answered by the
 *  operator after it, `escalate` (path 5) when the claimant could never allow it and `lapsed` (path 4) otherwise. A
 *  state this build does not know is `unmeasured` (`unknown-state`): it reached nobody the census can name, and is
 *  never in M38's numerator. */
export function censusPathOfApproval(r: CensusApprovalFacts): MintedPath {
  const lapse = OPERATOR(r.class === 'escalate' ? 'escalate' : 'lapsed');
  switch (r.state) {
    case 'allowed': case 'denied': return { path: 'ruled', authority: 'coordinator', reachedOperator: false };
    case 'held': return { path: 'held', authority: 'none', reachedOperator: false };
    case 'declined': case 'released': case 'operator': case 'stale':
      if (r.releaseReason !== null) return OPERATOR('released-at-mint');
      if (r.state === 'declined') return OPERATOR('declined');
      if (r.state === 'stale') return OPERATOR('stale');
      if (r.state === 'operator' && r.ruledAt !== null && r.notifyAt !== null && r.ruledAt < r.notifyAt) return OPERATOR('operator-first');
      return lapse;
    default: return { path: 'unmeasured', authority: 'none', reachedOperator: false };
  }
}

/** PR 6's gate (§3.1, F7): a held, deny-current, `escalate` row that reached the operator, every command one of the six
 *  read commands, and `literalInRoot` true. A row minted before the facts were kept never counts. */
export function isReadPrompt(r: CensusApprovalFacts & {
  readonly denyCurrent: boolean | null; readonly commandWords: readonly string[] | null; readonly literalInRoot: boolean | null;
}): boolean {
  if (!censusPathOfApproval(r).reachedOperator || r.releaseReason !== null) return false;
  if (r.class !== 'escalate' || r.denyCurrent === false || r.literalInRoot !== true) return false;
  const words = r.commandWords;
  return words !== null && words.length > 0 && words.every((w) => (READ_PROMPT_COMMANDS as readonly string[]).includes(w));
}

// ── the read ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface CensusApprovalRow extends CensusApprovalFacts {
  readonly id: number; readonly childId: string; readonly agentId: string; readonly tool: string;
  readonly inputRedacted: string | null; readonly askAt: number; readonly programme: string | null;
  readonly denyCurrent: boolean | null; readonly commandWords: readonly string[] | null; readonly literalInRoot: boolean | null;
}
export interface CensusOwnRow {
  readonly id: number; readonly sessionId: string; readonly path: ApprovalCensusRowPath; readonly why: ApprovalCensusUnmeasured | null;
  readonly route: string | null; readonly thread: 'main' | 'subagent' | null; readonly tool: string | null;
  readonly summary: string | null; readonly programme: string | null; readonly seenAt: number;
}
/** A run, for M38's programme-days: its programme, and when it opened and closed (`null` while open). */
export interface CensusRunSpan { readonly programme: string; readonly openedAt: number; readonly closedAt: number | null }
export interface CensusReadInput {
  readonly days: number; readonly fromMs: number; readonly toMs: number;
  readonly approvals: readonly CensusApprovalRow[];
  readonly census: readonly CensusOwnRow[];
  readonly runs: readonly CensusRunSpan[];
  readonly pushesBySource: Readonly<Record<string, number>>;
}

/** A UTC day, `YYYY-MM-DD`. */
export const censusDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/** The read's window (review 2667 F-D): the last `days` whole UTC days, today's included, so N days span N
 *  programme-days for a programme open throughout. `toMs` is now; `fromMs` is a UTC midnight. */
export function censusWindow(nowMs: number, days: number): { readonly fromMs: number; readonly toMs: number } {
  return { fromMs: Math.floor(nowMs / DAY_MS) * DAY_MS - (days - 1) * DAY_MS, toMs: nowMs };
}

const bump = (m: Record<string, number>, k: string): void => { m[k] = (m[k] ?? 0) + 1; };

/** M38's denominator (the coordinator's ruling on review 2638 F4): the distinct (programme, UTC day) pairs in
 *  `[fromMs, toMs)` on which the programme had a run open, whether or not it raised a prompt, so a day prevention
 *  emptied still counts. */
export function programmeDaysOf(runs: readonly CensusRunSpan[], fromMs: number, toMs: number): number {
  const pairs = new Set<string>();
  for (const r of runs) {
    const start = Math.max(r.openedAt, fromMs);
    const end = Math.min(r.closedAt ?? toMs, toMs);
    if (end < start) continue;
    // The end is exclusive (review 2667 F-H): a run closed at 00:00 UTC does not count the day it closed into.
    const last = end > start ? end - 1 : start;
    for (let d = Math.floor(start / DAY_MS) * DAY_MS; d <= last && d < toMs; d += DAY_MS) pairs.add(`${r.programme}\u0000${censusDay(d)}`);
  }
  return pairs.size;
}

/** The census read's answer (`approvalCensusOf`, Task 1.4): every count over every row in the window, the redacted rows
 *  (the newest `CENSUS_ROWS_MAX`), and M38: a programme's prompts that reached the operator over the programme-days.
 *  Prompts with no programme (root sessions) are reported beside it (`rootReached`), the unmeasured on their own. */
export function approvalCensusOf(x: CensusReadInput): ApprovalCensusWire {
  const rows: ApprovalCensusRowWire[] = [];
  for (const a of x.approvals) {
    const p = censusPathOfApproval(a);
    rows.push({
      source: 'approval', id: a.id, at: a.askAt, day: censusDay(a.askAt), sessionId: a.childId, programme: a.programme,
      thread: a.agentId === '' ? 'main' : 'subagent', tool: a.tool,
      summary: a.inputRedacted === null ? null : a.inputRedacted.slice(0, CENSUS_SUMMARY_MAX),
      path: p.path, why: p.path === 'unmeasured' ? 'unknown-state' : null, route: null, state: a.state,
      releaseReason: a.releaseReason, class: a.class, denyCurrent: a.denyCurrent,
      authority: p.authority, reachedOperator: p.reachedOperator, readPrompt: isReadPrompt(a),
    });
  }
  for (const c of x.census) {
    const measured = c.path !== 'unmeasured';
    rows.push({
      source: 'census', id: c.id, at: c.seenAt, day: censusDay(c.seenAt), sessionId: c.sessionId, programme: c.programme,
      thread: c.thread, tool: c.tool, summary: c.summary, path: c.path, why: measured ? null : c.why, route: c.route,
      state: null, releaseReason: null, class: null, denyCurrent: null,
      authority: measured ? 'operator' : 'none', reachedOperator: measured, readPrompt: false,
    });
  }
  rows.sort((a, b) => b.at - a.at || (a.source === b.source ? b.id - a.id : a.source < b.source ? -1 : 1));
  const byPath: Record<string, number> = {}; const byState: Record<string, number> = {}; const byReleaseReason: Record<string, number> = {};
  const byClass: Record<string, number> = {}; const byThread: Record<string, number> = {}; const byDenyCurrent: Record<string, number> = {};
  const byProgramme: Record<string, number> = {}; const byAuthority: Record<string, number> = {}; const byRoute: Record<string, number> = {};
  const byUnmeasured: Record<string, number> = {};
  const days = new Map<string, { reached: number; byPath: Record<string, number> }>();
  let reached = 0; let reads = 0; let unmeasured = 0; let programmeReached = 0; let rootReached = 0;
  for (const r of rows) {
    bump(byPath, r.path);
    if (r.path === 'unmeasured') { unmeasured += 1; bump(byUnmeasured, r.why ?? 'unknown-state'); }
    if (r.state !== null) bump(byState, r.state);
    if (r.releaseReason !== null) bump(byReleaseReason, r.releaseReason);
    if (r.class !== null) bump(byClass, r.class);
    bump(byThread, r.thread ?? 'unknown');
    const deny: ApprovalCensusDenyCurrency = r.denyCurrent === null ? 'unmeasured' : r.denyCurrent ? 'current' : 'not-current';
    bump(byDenyCurrent, deny);
    bump(byProgramme, r.programme ?? '(none)');
    bump(byAuthority, r.authority);
    if (r.route !== null) bump(byRoute, r.route);
    if (r.readPrompt) reads += 1;
    if (r.reachedOperator) {
      reached += 1;
      if (r.programme === null) { rootReached += 1; continue; }
      programmeReached += 1;
      const d = days.get(r.day) ?? { reached: 0, byPath: {} };
      d.reached += 1; bump(d.byPath, r.path); days.set(r.day, d);
    }
  }
  const programmeDays = programmeDaysOf(x.runs, x.fromMs, x.toMs);
  return {
    ok: true, days: x.days, fromMs: x.fromMs, toMs: x.toMs, total: rows.length, reachedOperator: reached,
    unmeasured, byUnmeasured,
    byPath, byState, byReleaseReason, byClass, byThread, byDenyCurrent, byProgramme, byAuthority, byRoute, readPrompts: reads,
    m38: {
      programmeDays, programmeReached, rootReached,
      perProgrammeDay: programmeDays === 0 ? null : programmeReached / programmeDays,
      byDay: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([day, d]) => ({ day, reachedOperator: d.reached, byPath: d.byPath })),
    },
    pushesBySource: { ...x.pushesBySource },
    rows: rows.slice(0, CENSUS_ROWS_MAX),
  };
}
