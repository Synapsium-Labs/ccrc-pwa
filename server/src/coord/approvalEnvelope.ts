// THE PER-AGENT APPROVAL ENVELOPE (approvals plan 2026-11-18, §3.2.2 and Task 2.1; Table 2a, path 6). Ring L1, context
// C6: pure, no I/O, no clock (the caller hands in `now`), imports `shared/` and types only.
//
// The session hook keeps a subagent's permission prompt in hook state's `approvals` list, one entry per call, until that
// agent's own event for the same call, its SubagentStop or the transcript tie removes it. Neither the main thread's events
// nor a sibling's erase it, so a subagent's menu painted after its hook returned still has its envelope, though `ask`
// itself was overwritten (the trigger prompt of §2.1). `hookstate.ts` is the list's one reader (`reviveApprovalEntries`);
// the three converted readers of the painted prompt ask `paintedApprovalOf` here: the session stream's ask frame (the
// console's approval surface), the approval hold and the census.
//
// HONEST ATTRIBUTION (reviews 2752 F1, F2, 2774 F1 to F5 and 2800 F1 to F5). The console shows the envelope's text over
// a menu the operator is about to answer, so an entry is the painted prompt only when it is the best and an honest match,
// and never when it is old:
//   - a summary under `APPROVAL_MATCH_CHARS` non-space characters must appear whole, and one under
//     `APPROVAL_MATCH_MIN_CHARS` only as the menu's command block (`commandBlocksOf`: every command row between the menu's
//     own boundaries, blank rows included, in the shape Claude Code 2.1.299 paints and in the cc280 shape), never one row
//     or one paragraph inside it;
//   - candidates rank by a full 60-character match, then an exact one (the command block), then the longest, then the
//     tool the menu names, and only then the newest, so a short exact match never outranks a 60-character one;
//   - hook state's own `ask` competes on the same match ranking and wins its ties: it is the prompt the hook saw last.
//     When a subagent raised it (`waitBy`), its entry is the one the same write added (the same call, the same stamp),
//     and that entry is taken, under the same age rule; with none, there is no entry;
//   - an AMBIGUOUS TIE shows no one (2800 F1): when the best candidates tie at the full 60-character tier, none exact,
//     and belong to different agents (two entries, or an entry and the own ask), there is no envelope at all;
//   - hook state's own approval that the approval-shaped menu does not match is no envelope either when another agent's
//     live entry exists (2800 F5, as the coordinator narrowed it): with none, it stands as before this PR, so a main
//     thread's prompt this matcher cannot read (a Write or Edit preview paints a relative path) keeps its surface;
//   - an entry is ignored when the menu has had `APPROVAL_MENU_ANSWER_MS` after the hook's longest wait
//     (`APPROVAL_ENTRY_MAX_AGE_MS`, counted from the request's stamp), or when its stamp is more than
//     `APPROVAL_ENTRY_MAX_AHEAD_MS` ahead of `now`.
// No envelope is path 6, the bare menu: the safe direction. Lengths count code points, as the hook's jq cuts the summary
// (`.[0:200]`).
import { APPROVAL_HOOK_WAIT_S, type Dialog, type HookAsk } from '../../../shared/api.js';
import { approvalShapedMenu } from './approvalCensus.js';

/** One subagent's permission prompt, as the hook keeps it (`approvals[]` in hook state). `at` is the hook state's stamp
 *  of the PermissionRequest that added it, so it is the envelope's own stamp, the census's key (`env:<at>`). */
export interface HookApprovalEntry {
  readonly agentId: string;
  readonly tool: string;
  readonly summary: string;
  readonly route?: string;
  readonly at: number;
}

/** The hook's bound on the list (`.[-16:]` in the hookstate write): the newest entries are kept. */
export const HOOK_APPROVALS_MAX = 16;

/** How many leading non-space characters of a long summary must appear in the painted menu's text. The pane wraps a long
 *  command, mid-word too, so both sides are compared with every whitespace character removed. A shorter summary must
 *  appear whole. */
export const APPROVAL_MATCH_CHARS = 60;

/** Below this many non-space characters a summary matches only as the menu's whole command text: a short command
 *  (`ls`, `npm run`, `git status`) is a substring of too many others to tie it to the pane. */
export const APPROVAL_MATCH_MIN_CHARS = 12;

/** How long the operator has to answer a background menu once the hook stops waiting: 15 minutes. A stale entry (no event
 *  removed it: a refused route, a background agent's menu, an agent that died without its SubagentStop) must never name a
 *  later menu. */
export const APPROVAL_MENU_ANSWER_MS = 15 * 60 * 1_000;

/** An entry older than this, by the request's own stamp, is ignored: a background subagent's menu paints after its hook
 *  returns, at the latest at the hook's wait ceiling (`APPROVAL_HOOK_WAIT_S`), and still has `APPROVAL_MENU_ANSWER_MS`. */
export const APPROVAL_ENTRY_MAX_AGE_MS = APPROVAL_HOOK_WAIT_S * 1_000 + APPROVAL_MENU_ANSWER_MS;

/** An entry stamped more than this ahead of `now` is ignored: the fleet box stamps it and the server reads it, so a little
 *  clock skew is allowed, and a wild stamp never stays forever. One minute. */
export const APPROVAL_ENTRY_MAX_AHEAD_MS = 60 * 1_000;

/** Whether an entry is young enough to name a menu at `now` (both bounds inclusive). */
const isLive = (e: HookApprovalEntry, now: number): boolean =>
  now - e.at <= APPROVAL_ENTRY_MAX_AGE_MS && e.at - now <= APPROVAL_ENTRY_MAX_AHEAD_MS;

type Menu = Pick<Dialog, 'title' | 'body' | 'parsed' | 'options' | 'ask' | 'multi'>;

const squeeze = (s: string): string => s.replace(/\s+/g, '');
const codePoints = (s: string): string[] => Array.from(s);

/** The dashed rule Claude Code 2.1.299 paints above and below a command's rows (`pwa/test/fixtures/drawer/recorded/2.1.299/
 *  permission.json`), and the gutter it paints before each row. */
const isDashedRule = (line: string): boolean => /^\s*╌+\s*$/.test(line);
const GUTTER = /^\s*│ ?/;
/** A row indented as the cc280 shape indents a command and its description (`fixtures/panes/cc280-permission.txt`). */
const isDeep = (line: string): boolean => /^\s{2,}\S/.test(line);

/**
 * The menu's command block, as the squeezed texts that count as exact. In the 2.1.299 shape it is every row between the
 * first two dashed rules, its gutter removed (the description is painted above the rules). In the cc280 shape it is the
 * last run of indented rows, blank rows included, which ends with the description: the run, or the run less its last row.
 * `parseDialog` trims the body's first row, so a first row followed at once by an indented one belongs to the run.
 */
const commandBlocksOf = (lines: readonly string[]): readonly string[] => {
  const rules = lines.flatMap((l, i) => (isDashedRule(l) ? [i] : []));
  if (rules.length >= 2) return [squeeze(lines.slice(rules[0]! + 1, rules[1]).map((l) => l.replace(GUTTER, '')).join(''))];
  let end = lines.length - 1;
  while (end >= 0 && !isDeep(lines[end]!)) end--;
  let start = end;
  while (start > 0 && (isDeep(lines[start - 1]!) || lines[start - 1]!.trim() === '')) start--;
  if (start === 1 && isDeep(lines[1]!)) start = 0;
  const rows = lines.slice(start, end + 1);
  return [squeeze(rows.join('')), squeeze(rows.slice(0, -1).join(''))];
};

/** The painted menu's text, once: all of it squeezed (the title too; gutters removed, so a wrapped command reads whole),
 *  and its command block (`commandBlocksOf`). */
interface MenuText { readonly all: string; readonly blocks: readonly string[] }
const menuTextOf = (d: Menu): MenuText => {
  const lines = (d.body ?? '').split('\n');
  const text = lines.map((l) => l.replace(GUTTER, '')).join('\n');
  return { all: squeeze(`${d.title}\n${text}`), blocks: commandBlocksOf(lines) };
};

/** How a summary matches the menu, or null when it does not honestly match. `exact`: it is the command block. `chars`:
 *  how many of its characters matched (the rank's "longest match"). An empty summary matches nothing. */
interface MenuMatch { readonly exact: boolean; readonly chars: number }
const matchOf = (summary: string, menu: MenuText): MenuMatch | null => {
  const want = squeeze(summary);
  const n = codePoints(want).length;
  if (want !== '' && menu.blocks.includes(want)) return { exact: true, chars: n };
  if (n < APPROVAL_MATCH_MIN_CHARS) return null;
  const head = n <= APPROVAL_MATCH_CHARS ? want : codePoints(want).slice(0, APPROVAL_MATCH_CHARS).join('');
  return menu.all.includes(head) ? { exact: false, chars: Math.min(n, APPROVAL_MATCH_CHARS) } : null;
};

/** A match's strength, compared left to right: a full 60-character match, exact, longest. */
const strengthOf = (m: MenuMatch): readonly number[] => [m.chars >= APPROVAL_MATCH_CHARS ? 1 : 0, m.exact ? 1 : 0, m.chars];
/** Left to right: negative when `a` ranks below `b`, zero on a tie, positive above. */
const compare = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};
/** The tier where two different commands can tie: a full 60-character match that is not exact (2800 F1). */
const isHeadTier = (m: MenuMatch): boolean => m.chars >= APPROVAL_MATCH_CHARS && !m.exact;

/** The best live, honestly matching entry, and every agent whose entry ties its strength. */
interface Best { readonly entry: HookApprovalEntry; readonly match: MenuMatch; readonly agents: ReadonlySet<string> }
/** The best live, honestly matching entry: by strength, then the tool the menu names, then the newest; a full tie goes to
 *  the later entry. */
const bestEntry = (entries: readonly HookApprovalEntry[], menu: MenuText, now: number): Best | null => {
  let best: { entry: HookApprovalEntry; match: MenuMatch; rank: readonly number[] } | null = null;
  const live: Array<{ entry: HookApprovalEntry; match: MenuMatch }> = [];
  for (const e of entries) {
    if (!isLive(e, now)) continue;
    const m = matchOf(e.summary, menu);
    if (m === null) continue;
    live.push({ entry: e, match: m });
    const rank = [...strengthOf(m), e.tool !== '' && menu.all.includes(squeeze(e.tool)) ? 1 : 0, e.at];
    if (best === null || compare(rank, best.rank) >= 0) best = { entry: e, match: m, rank };
  }
  if (best === null) return null;
  const top = strengthOf(best.match);
  const agents = new Set(live.filter((c) => compare(strengthOf(c.match), top) === 0).map((c) => c.entry.agentId));
  return { entry: best.entry, match: best.match, agents };
};
/** Whether the best entries tie at the head tier across agents: no one is shown (2800 F1). */
const isAmbiguous = (b: Best): boolean => isHeadTier(b.match) && b.agents.size > 1;

/**
 * The entry whose prompt the pane is painting, or null. The menu must be approval-shaped (`approvalShapedMenu`: Yes ...
 * No), the entry live at `now` (`isLive`), its summary an honest match, and the best not an ambiguous tie (see the head
 * of this file).
 */
export function approvalEntryFor(entries: readonly HookApprovalEntry[], dialog: Menu | null, now: number): HookApprovalEntry | null {
  if (dialog === null || !approvalShapedMenu(dialog)) return null;
  const best = bestEntry(entries, menuTextOf(dialog), now);
  return best === null || isAmbiguous(best) ? null : best.entry;
}

/** What the painted prompt is, for every reader of it: the ask to treat as the envelope, and the subagent entry it came
 *  from (null when it is hook state's own `ask`). */
export interface PaintedApproval {
  readonly ask: HookAsk | null;
  readonly entry: HookApprovalEntry | null;
}

/** What this decider reads of hook state (`hookstate.ts#HookState` has these fields). `updatedAt` is the stamp of the
 *  write that set `ask`, so a subagent's own entry for that ask carries it as its `at`. */
export interface PaintedHookState {
  readonly ask: HookAsk | null;
  readonly updatedAt: number;
  readonly approvals?: readonly HookApprovalEntry[] | undefined;
  readonly waitBy?: 'subagent' | undefined;
}

const entryAsk = (entry: HookApprovalEntry): PaintedApproval => ({
  ask: { approval: { tool: entry.tool, summary: entry.summary, ...(entry.route === undefined ? {} : { route: entry.route }), thread: 'subagent' as const } },
  entry,
});
const NO_ENVELOPE: PaintedApproval = { ask: null, entry: null };

/**
 * The envelope of the prompt the pane paints, at `now`. With no hook state, no menu, or a menu that is no permission
 * prompt, hook state's own `ask` stands, exactly as before. Over a permission prompt:
 *  - hook state's own approval, when the menu matches it at least as strongly as the best live entry, is that prompt;
 *    when a subagent raised it (`waitBy`), its own entry (the same tool and summary, stamped by the same write) is taken
 *    when it is live, and otherwise there is no entry. A tie at the head tier with another agent's entry is no envelope;
 *  - otherwise the best live matching entry is the prompt, marked `thread: 'subagent'`, unless the best are an ambiguous
 *    tie across agents (no envelope);
 *  - otherwise an own approval the menu does not match is no envelope when another agent's live entry exists, and any
 *    other own `ask` stands.
 */
export function paintedApprovalOf(hs: PaintedHookState | null, dialog: Menu | null, now: number): PaintedApproval {
  if (hs === null) return NO_ENVELOPE;
  const kept: PaintedApproval = { ask: hs.ask, entry: null };
  if (dialog === null || !approvalShapedMenu(dialog)) return kept;
  const entries = hs.approvals ?? [];
  const menu = menuTextOf(dialog);
  const best = bestEntry(entries, menu, now);
  const fromEntries = (): PaintedApproval => (best === null ? kept : isAmbiguous(best) ? NO_ENVELOPE : entryAsk(best.entry));
  const own = hs.ask !== null && 'approval' in hs.ask ? hs.ask.approval : null;
  if (own === null) return fromEntries();
  const same = hs.waitBy !== 'subagent' ? undefined
    : entries.find((e) => e.at === hs.updatedAt && e.tool === own.tool && e.summary === own.summary && isLive(e, now));
  const ownMatch = matchOf(own.summary, menu);
  if (ownMatch === null) {
    if (best !== null) return fromEntries();
    return entries.some((e) => isLive(e, now) && e.agentId !== (same?.agentId ?? '')) ? NO_ENVELOPE : kept;
  }
  const order = best === null ? 1 : compare(strengthOf(ownMatch), strengthOf(best.match));
  if (order < 0) return fromEntries();
  if (best !== null && order === 0 && isHeadTier(ownMatch) && [...best.agents].some((a) => a !== (same?.agentId ?? ''))) return NO_ENVELOPE;
  return same === undefined ? kept : entryAsk(same);
}
