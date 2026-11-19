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
// HONEST ATTRIBUTION (reviews 2752 F1, F2 and 2774 F1 to F5). The console shows the envelope's text over a menu the
// operator is about to answer, so an entry is the painted prompt only when it is the best and an honest match, and never
// when it is old:
//   - a summary under `APPROVAL_MATCH_CHARS` non-space characters must appear whole, and one under
//     `APPROVAL_MATCH_MIN_CHARS` only as the menu's command block (a paragraph of the menu, less at most its last line,
//     the tool's description), never one line inside it;
//   - candidates rank by a full 60-character match, then an exact one (the command block), then the longest, then the
//     tool the menu names, and only then the newest, so a short exact match never outranks a 60-character one;
//   - hook state's own `ask` competes on the same match ranking and wins its ties: it is the prompt the hook saw last.
//     When a subagent raised it (`waitBy`), its entry is the one the same write added (the same call, the same stamp),
//     and that entry is taken, under the same age rule; with none, there is no entry;
//   - an entry is ignored when the menu has had `APPROVAL_MENU_ANSWER_MS` after the hook's longest wait
//     (`APPROVAL_ENTRY_MAX_AGE_MS`, counted from the request's stamp), or when its stamp is more than
//     `APPROVAL_ENTRY_MAX_AHEAD_MS` ahead of `now`; its menu then falls back to path 6, the bare menu.
// Lengths count code points, as the hook's jq cuts the summary (`.[0:200]`).
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

/** The painted menu's text, once: all of it squeezed (the title too), and the body's blocks, each a paragraph's squeezed
 *  lines (a blank line ends a paragraph; a real capture paints one around the command block, `cc280-permission.txt`). */
interface MenuText { readonly all: string; readonly blocks: readonly (readonly string[])[] }
const menuTextOf = (d: Menu): MenuText => {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of (d.body ?? '').split('\n').map(squeeze)) {
    if (line !== '') { cur.push(line); continue; }
    if (cur.length > 0) blocks.push(cur);
    cur = [];
  }
  if (cur.length > 0) blocks.push(cur);
  return { all: squeeze(`${d.title}\n${d.body ?? ''}`), blocks };
};

/** Whether `want` is the menu's command block: a whole paragraph, or a paragraph less its last line (the tool's
 *  description), the pane's wraps joined. Never one line inside a paragraph, and never an empty `want`. */
const isCommandBlock = (blocks: readonly (readonly string[])[], want: string): boolean =>
  want !== '' && blocks.some((b) => b.join('') === want || b.slice(0, -1).join('') === want);

/** How a summary matches the menu, or null when it does not honestly match. `exact`: it is the command block. `chars`:
 *  how many of its characters matched (the rank's "longest match"). An empty summary matches nothing. */
interface MenuMatch { readonly exact: boolean; readonly chars: number }
const matchOf = (summary: string, menu: MenuText): MenuMatch | null => {
  const want = squeeze(summary);
  const n = codePoints(want).length;
  if (isCommandBlock(menu.blocks, want)) return { exact: true, chars: n };
  if (n < APPROVAL_MATCH_MIN_CHARS) return null;
  const head = n <= APPROVAL_MATCH_CHARS ? want : codePoints(want).slice(0, APPROVAL_MATCH_CHARS).join('');
  return menu.all.includes(head) ? { exact: false, chars: Math.min(n, APPROVAL_MATCH_CHARS) } : null;
};

/** A match's strength, compared left to right: a full 60-character match, exact, longest. */
const strengthOf = (m: MenuMatch): readonly number[] => [m.chars >= APPROVAL_MATCH_CHARS ? 1 : 0, m.exact ? 1 : 0, m.chars];
const atLeast = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
};

interface Best { readonly entry: HookApprovalEntry; readonly match: MenuMatch }
/** The best live, honestly matching entry: by strength, then the tool the menu names, then the newest; a full tie goes to
 *  the later entry. */
const bestEntry = (entries: readonly HookApprovalEntry[], menu: MenuText, now: number): Best | null => {
  let best: Best | null = null;
  let bestRank: readonly number[] = [];
  for (const e of entries) {
    if (!isLive(e, now)) continue;
    const m = matchOf(e.summary, menu);
    if (m === null) continue;
    const rank = [...strengthOf(m), e.tool !== '' && menu.all.includes(squeeze(e.tool)) ? 1 : 0, e.at];
    if (best === null || atLeast(rank, bestRank)) { best = { entry: e, match: m }; bestRank = rank; }
  }
  return best;
};

/**
 * The entry whose prompt the pane is painting, or null. The menu must be approval-shaped (`approvalShapedMenu`: Yes ...
 * No), the entry live at `now` (`isLive`), and its summary an honest match (see the head of this file).
 */
export function approvalEntryFor(entries: readonly HookApprovalEntry[], dialog: Menu | null, now: number): HookApprovalEntry | null {
  if (dialog === null || !approvalShapedMenu(dialog)) return null;
  return bestEntry(entries, menuTextOf(dialog), now)?.entry ?? null;
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

/**
 * The envelope of the prompt the pane paints, at `now`.
 *  - Hook state's own `ask`, when it is an approval whose text the approval-shaped menu honestly matches at least as
 *    strongly as the best live entry, is that prompt; but when a subagent raised it (`waitBy`), its own entry (the same
 *    tool and summary, stamped by the same write) is taken when it is live, and otherwise there is no entry.
 *  - Otherwise the best live matching entry is the prompt, marked `thread: 'subagent'`.
 *  - Otherwise hook state's own `ask` stands, exactly as before. With no hook state there is no envelope.
 */
export function paintedApprovalOf(hs: PaintedHookState | null, dialog: Menu | null, now: number): PaintedApproval {
  if (hs === null) return { ask: null, entry: null };
  const kept: PaintedApproval = { ask: hs.ask, entry: null };
  if (dialog === null || !approvalShapedMenu(dialog)) return kept;
  const entries = hs.approvals ?? [];
  const menu = menuTextOf(dialog);
  const best = bestEntry(entries, menu, now);
  const own = hs.ask !== null && 'approval' in hs.ask ? hs.ask.approval : null;
  const ownMatch = own === null ? null : matchOf(own.summary, menu);
  if (own !== null && ownMatch !== null && (best === null || atLeast(strengthOf(ownMatch), strengthOf(best.match)))) {
    const same = hs.waitBy !== 'subagent' ? undefined
      : entries.find((e) => e.at === hs.updatedAt && e.tool === own.tool && e.summary === own.summary && isLive(e, now));
    return same === undefined ? kept : entryAsk(same);
  }
  return best === null ? kept : entryAsk(best.entry);
}
