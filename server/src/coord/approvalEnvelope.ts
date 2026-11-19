// THE PER-AGENT APPROVAL ENVELOPE (approvals plan 2026-11-18, §3.2.2 and Task 2.1; Table 2a, path 6). Ring L1, context
// C6: pure, no I/O, no clock, imports `shared/` and types only.
//
// The session hook keeps a subagent's permission prompt in hook state's `approvals` list, one entry per agent, until that
// agent's own next tool event, its SubagentStop or the transcript tie removes it. Neither the main thread's events nor a
// sibling's erase it, so a subagent's menu painted after its hook returned still has its envelope, though `ask` itself
// was overwritten (the trigger prompt of §2.1). `hookstate.ts` is the list's one reader (`reviveApprovalEntries`); every
// reader of the painted prompt asks `paintedApprovalOf` here: the session stream's ask frame (the console's approval
// surface), the approval hold and the census.
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

/** How many leading non-space characters of an entry's summary must appear in the painted menu's text. The pane wraps a
 *  long command, mid-word too, so both sides are compared with every whitespace character removed. */
export const APPROVAL_MATCH_CHARS = 60;

const squeeze = (s: string): string => s.replace(/\s+/g, '');

/**
 * The entry whose prompt the pane is painting, or null. The menu must be approval-shaped (`approvalShapedMenu`: Yes ...
 * No), and the entry's summary, with whitespace removed, must have its first `APPROVAL_MATCH_CHARS` characters in the
 * menu's title and body. An entry with an empty summary matches nothing: there is no text to tie it to the pane. With
 * more than one match, one whose tool name the menu names is preferred, then the newest (`at`), then the later entry.
 */
export function approvalEntryFor(
  entries: readonly HookApprovalEntry[], dialog: Pick<Dialog, 'title' | 'body' | 'parsed' | 'options' | 'ask' | 'multi'> | null,
): HookApprovalEntry | null {
  if (dialog === null || entries.length === 0 || !approvalShapedMenu(dialog)) return null;
  const text = squeeze(`${dialog.title}\n${dialog.body ?? ''}`);
  let best: HookApprovalEntry | null = null;
  let bestTool = false;
  for (const e of entries) {
    const want = squeeze(e.summary).slice(0, APPROVAL_MATCH_CHARS);
    if (want === '' || !text.includes(want)) continue;
    const tool = e.tool !== '' && text.includes(squeeze(e.tool));
    if (best === null || (tool && !bestTool) || (tool === bestTool && e.at >= best.at)) { best = e; bestTool = tool; }
  }
  return best;
}

/** What the painted prompt is, for every reader of it: the ask to treat as the envelope, and the subagent entry it came
 *  from (null when it is hook state's own `ask`). */
export interface PaintedApproval {
  readonly ask: HookAsk | null;
  readonly entry: HookApprovalEntry | null;
}

/**
 * The envelope of the prompt the pane paints. A subagent entry that matches the painted menu (`approvalEntryFor`) is
 * that prompt, whatever hook state's own `ask` says now (a main-thread question a sibling's event restored, or another
 * subagent's newer prompt); its ask is `{approval: {tool, summary, route?, thread: 'subagent'}}`. Otherwise hook state's
 * own `ask` stands, exactly as before. With no hook state there is no envelope.
 */
export function paintedApprovalOf(
  hs: { readonly ask: HookAsk | null; readonly approvals: readonly HookApprovalEntry[] } | null,
  dialog: Pick<Dialog, 'title' | 'body' | 'parsed' | 'options' | 'ask' | 'multi'> | null,
): PaintedApproval {
  if (hs === null) return { ask: null, entry: null };
  const entry = approvalEntryFor(hs.approvals, dialog);
  if (entry === null) return { ask: hs.ask, entry: null };
  const approval = {
    tool: entry.tool, summary: entry.summary, ...(entry.route === undefined ? {} : { route: entry.route }), thread: 'subagent' as const,
  };
  return { ask: { approval }, entry };
}
