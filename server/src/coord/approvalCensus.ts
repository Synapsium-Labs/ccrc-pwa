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

/** What one tick shows of a painted prompt. */
export interface CensusSightingInput {
  /** A hook state was read for the child this tick (an absent or aged-out one is `false`). */
  readonly hsPresent: boolean;
  readonly ask: HookAsk | null;
  readonly updatedAt: number | null;
  readonly waitBy: 'subagent' | null;
  readonly dialog: Pick<Dialog, 'id' | 'parsed' | 'options' | 'ask' | 'multi'>;
  /** When the owner first saw `dialog` on this pane, and this tick's time (the server's clock, both). */
  readonly firstSeenAt: number;
  readonly now: number;
  /** The ticks this sighting has been painted, this one included. */
  readonly ticks: number;
  readonly minted: readonly CensusMintedRow[];
}

/** A census row to write. */
export interface CensusWrite {
  readonly kind: 'write'; readonly path: ApprovalCensusRowPath; readonly why: ApprovalCensusUnmeasured | null;
  readonly route: string | null; readonly thread: 'main' | 'subagent' | null; readonly tool: string | null;
  readonly summary: string | null; readonly sightingKey: string;
}

/** A sighting's decision. `wait`: not decidable yet, and `ifCleared` is the decision if the menu clears first (a row, or
 *  nothing when a minted row already counts). `none`: decided, no census row (a minted row counts, `mintedId`; or no
 *  permission prompt). `write`: decided, one census row. The owner decides each sighting ONCE. */
export type CensusSighting =
  | { readonly kind: 'wait'; readonly ifCleared: CensusWrite | null }
  | { readonly kind: 'none'; readonly mintedId: number | null }
  | CensusWrite;

const NONE: CensusSighting = { kind: 'none', mintedId: null };

/** The summary as the census keeps it (F8): the hook cuts at 200 characters BEFORE the server can mask, so a cut summary
 *  loses its trailing word, which may be the front of a secret the masker could no longer match. */
export function censusSummaryOf(summary: string): string {
  if (summary.length < CENSUS_SUMMARY_MAX) return summary;
  return `${summary.slice(0, CENSUS_SUMMARY_MAX).replace(/\S+$/, '').trimEnd()}…`;
}

const threadOf = (agentId: string): 'main' | 'subagent' => (agentId === '' ? 'main' : 'subagent');

/** Whether a painted prompt owes a census row (F1 to F7 of review 2638 decided here). An approval envelope decides at
 *  once by its route word: `sent` (or a request answered `approval-released`) names a minted row, which counts, so
 *  nothing is written once it is found, and `sent-no-row` is written if none arrives within `CENSUS_ROW_WAIT_MS`; a
 *  skip word is path 1 (path 7 for `not-a-child`); a refusal or a lost answer is path 2 (path 7 for the route's own
 *  `not-a-child`), unless a minted row of the same thread arrived for it (the client gave up after the mint), which
 *  counts instead; an envelope with no route word or one this build does not know is `unmeasured`. With no envelope,
 *  an approval-shaped menu waits out the watcher's settle window (`ASK_SETTLE_TICKS`, D-5290), then: a tight match (the
 *  same thread, a row held or released, `askAt` within `CENSUS_MATCH_MS` of the first sighting) counts as that row;
 *  any other row near it is `unmeasured` (`near-miss`); none is path 6. A missing hook state is `unmeasured`
 *  (`hookstate-gone`), never path 6. An AskUserQuestion's envelope, and a menu that is not approval-shaped, is none. */
export function censusSightingOf(x: CensusSightingInput): CensusSighting {
  const ask = x.ask;
  const thread = x.waitBy === 'subagent' ? 'subagent' : 'main';
  const menuKey = `menu:${x.dialog.id}:${x.firstSeenAt}`;
  const settled = x.ticks > ASK_SETTLE_TICKS;
  if (ask !== null && 'approval' in ask) {
    if (x.updatedAt === null) return NONE;
    const env = (path: ApprovalCensusRowPath, why: ApprovalCensusUnmeasured | null): CensusWrite => ({
      kind: 'write', path, why, route: ask.approval.route ?? null, thread, tool: ask.approval.tool,
      summary: censusSummaryOf(ask.approval.summary), sightingKey: `env:${x.updatedAt}`,
    });
    if (ask.approval.route === undefined) return env('unmeasured', 'no-route');
    const route = parseApprovalRoute(ask.approval.route);
    if (route === null) return env('unmeasured', 'unknown-route');
    // The minted row a sent (or failed after the mint) request leaves: the same thread, minted since just before the
    // first sighting, matched on the server's clock (never the fleet box's `updatedAt`, F9).
    const row = [...x.minted].reverse().find((m) => threadOf(m.agentId) === thread && m.askAt >= x.firstSeenAt - CENSUS_MATCH_MS);
    if (route.kind === 'sent' || (route.kind === 'refused' && route.word === 'approval-released')) {
      if (row !== undefined) return { kind: 'none', mintedId: row.id };
      const noRow = env('unmeasured', 'sent-no-row');
      return x.now - x.firstSeenAt < CENSUS_ROW_WAIT_MS ? { kind: 'wait', ifCleared: noRow } : noRow;
    }
    if (route.kind === 'skip') return env(route.word === 'not-a-child' ? 'not-a-child' : 'hook-skipped', null);
    if (row !== undefined) return { kind: 'none', mintedId: row.id };
    return env(route.kind === 'refused' && route.word === 'not-a-child' ? 'not-a-child' : 'refused-at-mint', null);
  }
  if (ask !== null || !approvalShapedMenu(x.dialog)) return NONE;
  const menu = (path: ApprovalCensusRowPath, why: ApprovalCensusUnmeasured | null): CensusWrite => ({
    kind: 'write', path, why, route: null, thread: null, tool: null, summary: null, sightingKey: menuKey,
  });
  if (!x.hsPresent) {
    const gone = menu('unmeasured', 'hookstate-gone');
    return settled ? gone : { kind: 'wait', ifCleared: gone };
  }
  const tight = [...x.minted].reverse().find((m) => threadOf(m.agentId) === thread && (m.state === 'held' || m.state === 'released')
    && Math.abs(m.askAt - x.firstSeenAt) <= CENSUS_MATCH_MS);
  if (tight !== undefined) return { kind: 'none', mintedId: tight.id };
  // Inside the settle window a late envelope cannot be told from an erased one: cleared there, it is unmeasured.
  if (!settled) return { kind: 'wait', ifCleared: menu('unmeasured', 'cleared-early') };
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
    for (let d = Math.floor(start / DAY_MS) * DAY_MS; d <= end && d < toMs; d += DAY_MS) pairs.add(`${r.programme}\u0000${censusDay(d)}`);
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
