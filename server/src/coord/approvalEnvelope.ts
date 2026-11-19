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
// HONEST ATTRIBUTION (review 2752 F1, F2). The console shows the envelope's text over a menu the operator is about to
// answer, so an entry is the painted prompt only when it is the best and an honest match, and never when it is old:
//   - hook state's own `ask`, an approval whose text the menu paints, wins over every entry (it is the prompt the hook
//     saw last), except that a subagent's `ask` and an entry for the same call are one prompt, and the entry is taken;
//   - a summary under `APPROVAL_MATCH_CHARS` non-space characters must appear whole, and one under
//     `APPROVAL_MATCH_MIN_CHARS` only as the menu's whole command text (a line, or wrapped lines, of nothing else);
//   - candidates rank by an exact match (the whole command text), then the longest match, then the tool the menu names,
//     and only then the newest;
//   - an entry older than `APPROVAL_ENTRY_MAX_AGE_MS` is ignored, so its menu falls back to path 6, the bare menu.
// Lengths count code points, as the hook's jq cuts the summary (`.[0:200]`).
import type { Dialog, HookAsk } from '../../../shared/api.js';
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

/** An entry older than this (by its own stamp) is ignored: no event removed it (a refused route, a background agent's
 *  menu, an agent that died without its SubagentStop), and a stale entry must never name a later menu. 15 minutes. */
export const APPROVAL_ENTRY_MAX_AGE_MS = 15 * 60 * 1_000;

type Menu = Pick<Dialog, 'title' | 'body' | 'parsed' | 'options' | 'ask' | 'multi'>;

const squeeze = (s: string): string => s.replace(/\s+/g, '');
const codePoints = (s: string): string[] => Array.from(s);

/** The painted menu's text, once: all of it squeezed, and each line squeezed (for the whole-command test). */
interface MenuText { readonly all: string; readonly lines: readonly string[] }
const menuTextOf = (d: Menu): MenuText => {
  const raw = `${d.title}\n${d.body ?? ''}`;
  return { all: squeeze(raw), lines: raw.split('\n').map(squeeze) };
};

/** Whether `want` is one line of the menu, or consecutive wrapped lines, with nothing else on them. An empty `want` is
 *  never one: the loop compares only once something is gathered. */
const isWholeCommand = (lines: readonly string[], want: string): boolean => {
  for (let i = 0; i < lines.length; i++) {
    let acc = '';
    for (let j = i; j < lines.length && acc.length < want.length; j++) {
      acc += lines[j]!;
      if (acc === want) return true;
    }
  }
  return false;
};

/** How a summary matches the menu, or null when it does not honestly match. `exact`: it is the whole command text.
 *  `chars`: how many of its characters matched (the rank's "longest match"). An empty summary matches nothing: it is
 *  under `APPROVAL_MATCH_MIN_CHARS` and is no menu's whole command text. */
interface MenuMatch { readonly exact: boolean; readonly chars: number }
const matchOf = (summary: string, menu: MenuText): MenuMatch | null => {
  const want = squeeze(summary);
  const n = codePoints(want).length;
  if (isWholeCommand(menu.lines, want)) return { exact: true, chars: n };
  if (n < APPROVAL_MATCH_MIN_CHARS) return null;
  const head = n <= APPROVAL_MATCH_CHARS ? want : codePoints(want).slice(0, APPROVAL_MATCH_CHARS).join('');
  return menu.all.includes(head) ? { exact: false, chars: Math.min(n, APPROVAL_MATCH_CHARS) } : null;
};

/** The rank of a candidate, compared left to right: exact, longest, the tool the menu names, newest. */
const rankOf = (m: MenuMatch, tool: boolean, at: number): readonly number[] => [m.exact ? 1 : 0, m.chars, tool ? 1 : 0, at];
const atLeast = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
};

/**
 * The entry whose prompt the pane is painting, or null. The menu must be approval-shaped (`approvalShapedMenu`: Yes ...
 * No), the entry no older than `APPROVAL_ENTRY_MAX_AGE_MS` at `now`, and its summary an honest match (see the head of this
 * file). With more than one match, the best rank wins, and on a full tie the later entry.
 */
export function approvalEntryFor(entries: readonly HookApprovalEntry[], dialog: Menu | null, now: number): HookApprovalEntry | null {
  if (dialog === null || entries.length === 0 || !approvalShapedMenu(dialog)) return null;
  const menu = menuTextOf(dialog);
  let best: HookApprovalEntry | null = null;
  let bestRank: readonly number[] = [];
  for (const e of entries) {
    if (now - e.at > APPROVAL_ENTRY_MAX_AGE_MS) continue;
    const m = matchOf(e.summary, menu);
    if (m === null) continue;
    const rank = rankOf(m, e.tool !== '' && menu.all.includes(squeeze(e.tool)), e.at);
    if (best === null || atLeast(rank, bestRank)) { best = e; bestRank = rank; }
  }
  return best;
}

/** What the painted prompt is, for every reader of it: the ask to treat as the envelope, and the subagent entry it came
 *  from (null when it is hook state's own `ask`). */
export interface PaintedApproval {
  readonly ask: HookAsk | null;
  readonly entry: HookApprovalEntry | null;
}

/** What this decider reads of hook state (`hookstate.ts#HookState` has these fields). */
export interface PaintedHookState {
  readonly ask: HookAsk | null;
  readonly approvals?: readonly HookApprovalEntry[] | undefined;
  readonly waitBy?: 'subagent' | undefined;
}

const entryAsk = (entry: HookApprovalEntry): PaintedApproval => ({
  ask: { approval: { tool: entry.tool, summary: entry.summary, ...(entry.route === undefined ? {} : { route: entry.route }), thread: 'subagent' as const } },
  entry,
});

/**
 * The envelope of the prompt the pane paints, at `now`.
 *  - Hook state's own `ask`, when it is an approval whose text the approval-shaped menu honestly matches, is that prompt,
 *    whatever entry also matches; but when a subagent raised it (`waitBy`) and an entry carries the same call (tool and
 *    summary), they are one prompt, and the entry is taken (its agent and its own stamp; the newest such entry, of any age).
 *  - Otherwise the best matching entry (`approvalEntryFor`) is the prompt, marked `thread: 'subagent'`.
 *  - Otherwise hook state's own `ask` stands, exactly as before. With no hook state there is no envelope.
 */
export function paintedApprovalOf(hs: PaintedHookState | null, dialog: Menu | null, now: number): PaintedApproval {
  if (hs === null) return { ask: null, entry: null };
  const entries = hs.approvals ?? [];
  const own = hs.ask !== null && 'approval' in hs.ask ? hs.ask.approval : null;
  if (own !== null && dialog !== null && approvalShapedMenu(dialog) && matchOf(own.summary, menuTextOf(dialog)) !== null) {
    let same: HookApprovalEntry | null = null;
    if (hs.waitBy === 'subagent') {
      for (const e of entries) if (e.tool === own.tool && e.summary === own.summary && (same === null || e.at >= same.at)) same = e;
    }
    return same === null ? { ask: hs.ask, entry: null } : entryAsk(same);
  }
  const entry = approvalEntryFor(entries, dialog, now);
  return entry === null ? { ask: hs.ask, entry: null } : entryAsk(entry);
}
