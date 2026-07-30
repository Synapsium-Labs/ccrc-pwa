// Shared API types — single source of truth between ccrc-server and the PWA.

export type SessionStatus = 'busy' | 'idle' | 'dead';

export interface FleetSession {
  id: string; wrapper: string; home: string; project: string; workdir: string;
  /** The worktree slug when this session is a workspace; null for a project's
   *  main checkout. Grouping and ws-rm both key off its presence. */
  workspace: string | null;
  name: string | null;                       // live display name from sessions/<pid>.json
  status: SessionStatus;
  statusUpdatedAt: number | null;            // epoch ms
  limits: { five: number | null; seven: number | null } | null;  // account of current wrapper
  dialogPending: boolean;                    // watcher saw an unanswered pane menu
  version: string | null;
  // Read from the pane statusline/mode-line the watcher already captures.
  model: string | null;                      // display name, e.g. "Opus 4.8 (1M context)"
  effort: string | null;                     // effort level, e.g. "xhigh"
  ultracode: boolean;                        // ultracode super-mode active
  branch: string | null;                     // current git branch
  tasks: TaskProgress | null;                // plan progress; null = this session has no task list
  /** This workspace's pull request, or null for a main checkout — which is the
   *  ONLY thing that suppresses the header control. */
  pr: PrState | null;
  /** Epoch SECONDS this workspace was archived (ccd writes `$REG/<id>.archived`
   *  as an epoch), or null. Every piece of archive copy in the UI derives from
   *  THIS, never from `pr.phase`: a merged PR whose archive was deferred
   *  because the session was busy must not claim it was archived. */
  archivedAt: number | null;
}

/** The task list Claude Code keeps for a session, as the TUI's widget shows it:
 *  `subject` is the row label, `activeForm` the present-participle line the
 *  spinner wears while the task runs ("Building claude_spend_reader…"). */
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskItem {
  id: string;            // numeric string — Claude Code's own file name / task number
  subject: string;
  activeForm: string;
  description: string;
  status: TaskStatus;
}

/** Card-sized summary of the same list — what a glance needs, without the rows. */
export interface TaskProgress {
  total: number;
  done: number;
  running: number;
  active: string | null; // activeForm of the first in-progress task, else null
}

/** Where a workspace's pull request is, as ccrc last managed to find out.
 *
 *  `unchecked` is a FIRST-CLASS state, not a synonym for "no PR": keying the
 *  header control's visibility on `pr !== null` would make its absence an
 *  affirmative claim ("this session cannot have a PR") rendered identically to
 *  "we have not looked", and would put the retry affordance behind a control
 *  that is not on screen. */
export type PrPhase =
  | 'unchecked' | 'none' | 'no-commits' | 'open' | 'draft' | 'merged' | 'closed' | 'unknown';

/** CI rollup. `null` means NO CHECKS ARE CONFIGURED — distinct from 'pending',
 *  and rendered with different words. */
export type PrChecks = 'pass' | 'fail' | 'pending' | null;

export interface PrState {
  phase: PrPhase;
  number: number | null;
  url: string | null;
  title: string | null;
  checks: PrChecks;
  /** Names of the FAILING checks. GitHub-sourced and attacker-controllable on
   *  any repo that accepts fork PRs, so this is inert text everywhere it is
   *  rendered: never a prompt, never an argv, never a shell word. */
  checkNames: string[] | null;
  ahead: number;                 // commits past base
  /** Why `phase` is `unknown`. Every member but `merge-unproven` is a FAILED
   *  READ; `merge-unproven` is the opposite — GitHub answered fine and said
   *  MERGED, and a conjunct of the merge predicate did not hold, so ccrc
   *  declines to call it merged. It exists because `error` renders as "GitHub
   *  could not be read", which in that case is simply untrue. */
  reason:
    | 'timeout' | 'offline' | 'unauthenticated' | 'rate-limit'
    | 'no-remote' | 'unsupported' | 'agent-down' | 'error'
    | 'merge-unproven' | null;
  checkedAt: number | null;      // epoch ms of the gh read that produced this
  mergedAt: number | null;
  /** Epoch ms the sweep will next try this project, or null when nothing is
   *  scheduled. §6's rate-limit row promises the UI shows the reason AND the
   *  retry time, and `prBackoff` is the only thing that knows it — 15 minutes
   *  of a greyed cap with no explanation reads as broken rather than as
   *  waiting. Null on a ROUTE read failure, which backs nothing off and must
   *  not borrow the lane's clock. */
  retryAt: number | null;
}

/** The eight phases as a runtime value, so a string read off disk (written by
 *  ccd, possibly a version behind) can be validated rather than trusted. */
export const PR_PHASES: readonly PrPhase[] =
  ['unchecked', 'none', 'no-commits', 'open', 'draft', 'merged', 'closed', 'unknown'];

/** `/api/fleet/health` — degraded-mode signal for the remote fleet host.
 *  `mode: 'local'` is always `{connected: true, downSince: null}` — there is
 *  no separate fleet host to lose. */
export interface FleetHealth {
  mode: 'local' | 'remote';
  connected: boolean;
  downSince: number | null;   // epoch ms since the agent connection dropped
}

/** One account's usage, read from telemetry (cc-limits) independent of whether a
 *  session is currently on it — so the display survives restarts/respawns/swaps.
 *  `ts` is epoch seconds of the last report. Telemetry is a byproduct of a
 *  session rendering its statusline, so an idle account simply stops reporting —
 *  which is why the rolledOver flags exist. */
export interface AccountUsage {
  wrapper: string;
  five: number | null;
  seven: number | null;
  ts: number | null;
  fiveResetAt: number | null;   // epoch seconds the 5h window resets
  sevenResetAt: number | null;  // epoch seconds the 7d window resets
  fiveRolledOver: boolean;      // the 5h window reset; the 0 above is inferred, not measured
  sevenRolledOver: boolean;     // the 7d window reset; the 0 above is inferred, not measured
  disabled: boolean;            // ccd's kill-switch for this lane is on
}

/** The account a new workspace would land on, projected server-side.
 *
 *  The routing rule lives in ccd (`_ws_least_loaded`) and the server owns the
 *  only other copy — the PWA must never compute a third, which would drift
 *  from both. `score` is the account's pressure, max(5h%, 7d%), so headroom is
 *  `100 - score`. It can exceed the swap ceiling: the rule returns the least
 *  loaded account even when every account is pinned, and saying so before the
 *  tap is the entire point of showing it. */
export interface ProjectedHome {
  wrapper: string;
  score: number;
}

/** A `/`-command the composer can autocomplete. `insert` is what gets typed
 *  (with a trailing space so arguments follow naturally). */
export interface SlashCommand {
  name: string;                 // e.g. "compact" or "superpowers:brainstorming"
  desc: string;
  kind: 'builtin' | 'skill';
}

export type ChatEvent =
  | { kind: 'user'; uuid: string; ts: string; text: string }
  | { kind: 'assistant'; uuid: string; ts: string; text: string }
  | { kind: 'tool_use'; uuid: string; ts: string; toolId: string; name: string; input: string }
  | { kind: 'tool_result'; ts: string; toolId: string; text: string; isError: boolean }
  | { kind: 'system'; uuid: string; ts: string; text: string };

export interface AskOption { label: string; description?: string; preview?: string }
export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: AskOption[];
}

/** An AskQuestion as it rides a Dialog: `options` is head-anchored to the PANE's
 *  rows by POSITION — entry k is the copy for row k+1 — and carries `null`
 *  wherever that row and the transcript disagreed (as do the rows past its end,
 *  the TUI's own, by simply not being there). The alignment tolerates one such
 *  disagreement from four options up — a capture taken mid-redraw loses a row —
 *  and that row is precisely the one whose copy is known to be wrong. Its index
 *  still types the pane's option, so the sheet keeps the pane's own label,
 *  description and no preview there rather than describe an answer the tap does
 *  not send. */
export interface DialogAsk extends Omit<AskQuestion, 'options'> {
  options: (AskOption | null)[];
}

export interface Dialog {
  id: string;               // sha1 of the option block text
  title: string;            // nearest non-empty line above the options
  body?: string;            // the full question / preamble above the options (multi-line)
  options: { index: number; label: string; description?: string }[]; // description = the option's sub-text
  selectedIndex: number;    // option with the ❯ marker
  parsed: boolean;          // false → render raw + point to terminal drawer
  raw: string;              // full pane tail for the unparsed case
  /** The real question, when the live menu is an AskUserQuestion and the
   *  transcript could be matched to it. Absent for scraped confirms (/model,
   *  /effort, permission prompts), which render exactly as they do today. */
  ask?: DialogAsk;
}

export type SessionStreamMsg =
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean }  // missing=true → transcript file not found at `file`; UI shows a diagnostic banner
  | { type: 'events'; uuid: string; events: ChatEvent[]; offset: number }
  | { type: 'status'; status: SessionStatus; statusUpdatedAt: number | null }
  | { type: 'dialog'; dialog: Dialog }            // a pane menu is awaiting an answer
  | { type: 'dialog_cleared' }
  | { type: 'tasks'; tasks: TaskItem[] }          // the session's task list changed (or first read)
  | { type: 'rotated'; uuid: string }             // transcript switched (clear/compact/swap) — client refetches
  | { type: 'notice'; message: string };

/** A file staged into ~/.cc-clips/<id>/, ready to be named in a prompt. The
 *  server reports no dimensions — it has no image decoder, and never will. */
export interface StagedClip { path: string; name: string; bytes: number }

/**
 * A clip path anywhere in a string: `…/.cc-clips/<session>/clip-<stem>.<ext>`.
 * Matched by SHAPE, never by touching the filesystem, so it works client-side.
 * Exported WITHOUT the `g` flag to avoid stateful `lastIndex` — a g-flagged
 * module-scope regex returns alternating true/false on successive `.test()` calls.
 * Internal consumers build their own `new RegExp(CLIP_PATH_RE.source, 'g')`.
 */
export const CLIP_PATH_RE =
  /\/[^\s]*\/\.cc-clips\/[^/\s]+\/clip-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)/;

/** Attachment paths first, each on its own line, then the user's text. Paths
 *  lead so the transcript reads image-above-caption. */
export function composePrompt(text: string, attachments: readonly string[]): string {
  return [...attachments, text].filter((part) => part !== '').join('\n');
}

/**
 * Inverse of composePrompt, for rendering. Pulls every clip path out wherever it
 * sits — own line, leading, trailing or mid-line — because `ccd clip` types the
 * path with no Enter, so the user's prose lands on either side of it. Paths come
 * back in document order and deduplicated; the prose has the holes closed up.
 *
 * Whitespace is touched on the lines a path came OUT of and nowhere else. An
 * earlier revision collapsed space runs on every line, and MessageBubble runs
 * this over every user turn into a `white-space: pre-wrap` bubble — so every
 * pasted code block, stack trace, log line and aligned table in the entire
 * history rendered flattened, attachment or not.
 */
export function splitClipPaths(text: string): { paths: string[]; rest: string } {
  const paths: string[] = [];

  const cleanedLines = text.split('\n').map((line) => {
    let hit = false;
    const stripped = line.replace(new RegExp(CLIP_PATH_RE.source, 'g'), (match) => {
      hit = true;
      if (!paths.includes(match)) paths.push(match);
      return '';
    });
    // No path left this line: hand it back byte-identical, indentation and all.
    if (!hit) return line;
    // A path DID leave a hole here — close it up. `ccd clip` types the path with
    // a trailing space, and pulling one out mid-line would leave a double space.
    const cleaned = stripped.replace(/[^\S\n]+/g, ' ').trim();
    // Non-empty before, empty now: the line held only a path. Drop it entirely
    // rather than leave a blank that merges nothing and separates nothing.
    return cleaned === '' ? null : cleaned;
  });

  const kept = cleanedLines.filter((line): line is string => line !== null);
  // Trim by LINE, not by character: a `.trim()` over the joined result would eat
  // the indentation of a message that opens on an indented line.
  while (kept.length > 0 && kept[0]!.trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();

  return { paths, rest: kept.join('\n') };
}
