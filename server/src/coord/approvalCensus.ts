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
  type ApprovalCensusWire,
} from '../../../shared/approval-census.js';

/** The summary's cut, the hook's own (`ask.approval.summary` is `.[0:200]`). */
export const CENSUS_SUMMARY_MAX = 200;
/** The newest rows the read lists; the counts are over every row in the window. */
export const CENSUS_ROWS_MAX = 500;

// ── the sighting ───────────────────────────────────────────────────────────────────────────────────────────────

/** What one tick shows of a painted prompt: the hook state's ask and stamp, the menu, and whether the child has an
 *  approvals row recent enough to be this prompt's (the read the owner makes before asking, for the erased case only). */
export interface CensusSightingInput {
  readonly ask: HookAsk | null;
  readonly updatedAt: number | null;
  readonly waitBy: 'subagent' | null;
  readonly dialog: Pick<Dialog, 'id' | 'parsed' | 'options' | 'ask' | 'multi'>;
  /** When this tick's sighting of `dialog` began (the owner's first sighting of it on this pane). */
  readonly firstSeenAt: number;
  /** The child has an approvals row minted within the hook's longest wait before `firstSeenAt`. */
  readonly recentMinted: boolean;
}

export type CensusSighting =
  | { readonly kind: 'none' }
  | {
    readonly kind: 'write'; readonly path: ApprovalCensusRowPath; readonly route: string | null;
    readonly thread: 'main' | 'subagent' | null; readonly tool: string | null; readonly summary: string | null;
    readonly sightingKey: string;
  };

const NONE: CensusSighting = { kind: 'none' };

/** Whether a painted prompt owes a census row. An approval envelope decides by its route word: `sent` (and a request the
 *  server answered `approval-released`) names a minted row, so nothing is written; a skip word is path 1 (path 7 for
 *  `not-a-child`); a refusal or a lost answer is path 2 (path 7 for the route's own `not-a-child`); an envelope with no
 *  route word (an older hook) is not counted. With no envelope at all, an approval-shaped menu is path 6, unless the
 *  child has a row recent enough to be this prompt's. An AskUserQuestion's envelope is no permission prompt. */
export function censusSightingOf(x: CensusSightingInput): CensusSighting {
  const ask = x.ask;
  if (ask !== null && 'approval' in ask) {
    const route = parseApprovalRoute(ask.approval.route);
    if (route === null || route.kind === 'sent' || x.updatedAt === null) return NONE;
    if (route.kind === 'refused' && route.word === 'approval-released') return NONE;
    const path: ApprovalCensusRowPath = route.kind === 'skip' ? (route.word === 'not-a-child' ? 'not-a-child' : 'hook-skipped')
      : route.kind === 'refused' && route.word === 'not-a-child' ? 'not-a-child' : 'refused-at-mint';
    return {
      kind: 'write', path, route: ask.approval.route ?? null, thread: x.waitBy === 'subagent' ? 'subagent' : 'main',
      tool: ask.approval.tool, summary: ask.approval.summary.slice(0, CENSUS_SUMMARY_MAX), sightingKey: `env:${x.updatedAt}`,
    };
  }
  if (ask !== null) return NONE;
  if (!approvalShapedMenu(x.dialog) || x.recentMinted) return NONE;
  return {
    kind: 'write', path: 'envelope-erased', route: null, thread: null, tool: null, summary: null,
    sightingKey: `menu:${x.dialog.id}:${x.firstSeenAt}`,
  };
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
}

/** Where a minted approvals row went (Table 2a): ruled by the claimant (path 0), still held, minted released (path 3),
 *  or held and then reached the operator unruled: `escalate` (path 5) when the claimant could never allow it, `lapsed`
 *  (path 4) otherwise. A state this build does not know reached nobody it can name, and is counted as reaching the
 *  operator by its class. */
export function censusPathOfApproval(r: CensusApprovalFacts): { readonly path: ApprovalCensusPath; readonly authority: ApprovalCensusAuthority; readonly reachedOperator: boolean } {
  if (r.state === 'allowed' || r.state === 'denied') return { path: 'ruled', authority: 'coordinator', reachedOperator: false };
  if (r.state === 'held') return { path: 'held', authority: 'none', reachedOperator: false };
  if (r.releaseReason !== null) return { path: 'released-at-mint', authority: 'operator', reachedOperator: true };
  return { path: r.class === 'escalate' ? 'escalate' : 'lapsed', authority: 'operator', reachedOperator: true };
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
  readonly id: number; readonly sessionId: string; readonly path: ApprovalCensusRowPath; readonly route: string | null;
  readonly thread: 'main' | 'subagent' | null; readonly tool: string | null; readonly summary: string | null;
  readonly programme: string | null; readonly seenAt: number;
}
export interface CensusReadInput {
  readonly days: number; readonly fromMs: number; readonly toMs: number;
  readonly approvals: readonly CensusApprovalRow[];
  readonly census: readonly CensusOwnRow[];
  readonly pushesBySource: Readonly<Record<string, number>>;
}

/** A UTC day, `YYYY-MM-DD`. */
export const censusDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const bump = (m: Record<string, number>, k: string): void => { m[k] = (m[k] ?? 0) + 1; };

/** The census read's answer (`approvalCensusOf`, Task 1.4): every count over every row in the window, the redacted rows
 *  (the newest `CENSUS_ROWS_MAX`), and M38. Rows that reached the operator are M38's; a root session's prompt counts
 *  under no programme (`(none)` in `byProgramme`). */
export function approvalCensusOf(x: CensusReadInput): ApprovalCensusWire {
  const rows: ApprovalCensusRowWire[] = [];
  for (const a of x.approvals) {
    const p = censusPathOfApproval(a);
    rows.push({
      source: 'approval', id: a.id, at: a.askAt, day: censusDay(a.askAt), sessionId: a.childId, programme: a.programme,
      thread: a.agentId === '' ? 'main' : 'subagent', tool: a.tool,
      summary: a.inputRedacted === null ? null : a.inputRedacted.slice(0, CENSUS_SUMMARY_MAX),
      path: p.path, route: null, state: a.state, releaseReason: a.releaseReason, class: a.class, denyCurrent: a.denyCurrent,
      authority: p.authority, reachedOperator: p.reachedOperator, readPrompt: isReadPrompt(a),
    });
  }
  for (const c of x.census) {
    rows.push({
      source: 'census', id: c.id, at: c.seenAt, day: censusDay(c.seenAt), sessionId: c.sessionId, programme: c.programme,
      thread: c.thread, tool: c.tool, summary: c.summary, path: c.path, route: c.route, state: null, releaseReason: null,
      class: null, denyCurrent: null, authority: 'operator', reachedOperator: true, readPrompt: false,
    });
  }
  rows.sort((a, b) => b.at - a.at || (a.source === b.source ? b.id - a.id : a.source < b.source ? -1 : 1));
  const byPath: Record<string, number> = {}; const byState: Record<string, number> = {}; const byReleaseReason: Record<string, number> = {};
  const byClass: Record<string, number> = {}; const byThread: Record<string, number> = {}; const byDenyCurrent: Record<string, number> = {};
  const byProgramme: Record<string, number> = {}; const byAuthority: Record<string, number> = {}; const byRoute: Record<string, number> = {};
  const pairs = new Set<string>();
  const days = new Map<string, { reached: number; byPath: Record<string, number> }>();
  let reached = 0; let reads = 0;
  for (const r of rows) {
    bump(byPath, r.path);
    if (r.state !== null) bump(byState, r.state);
    if (r.releaseReason !== null) bump(byReleaseReason, r.releaseReason);
    if (r.class !== null) bump(byClass, r.class);
    bump(byThread, r.thread ?? 'unknown');
    bump(byDenyCurrent, r.denyCurrent === null ? 'unmeasured' : r.denyCurrent ? 'current' : 'not-current');
    bump(byProgramme, r.programme ?? '(none)');
    bump(byAuthority, r.authority);
    if (r.route !== null) bump(byRoute, r.route);
    pairs.add(`${r.programme ?? ''}\u0000${r.day}`);
    if (r.readPrompt) reads += 1;
    if (r.reachedOperator) {
      reached += 1;
      const d = days.get(r.day) ?? { reached: 0, byPath: {} };
      d.reached += 1; bump(d.byPath, r.path); days.set(r.day, d);
    }
  }
  return {
    ok: true, days: x.days, fromMs: x.fromMs, toMs: x.toMs, total: rows.length, reachedOperator: reached,
    byPath, byState, byReleaseReason, byClass, byThread, byDenyCurrent, byProgramme, byAuthority, byRoute, readPrompts: reads,
    m38: {
      programmeDays: pairs.size,
      perProgrammeDay: reached === 0 || pairs.size === 0 ? null : reached / pairs.size,
      byDay: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([day, d]) => ({ day, reachedOperator: d.reached, byPath: d.byPath })),
    },
    pushesBySource: { ...x.pushesBySource },
    rows: rows.slice(0, CENSUS_ROWS_MAX),
  };
}
