// Shared API types — single source of truth between ccrc-server and the PWA.

export type SessionStatus = 'busy' | 'idle' | 'dead';

export interface FleetSession {
  id: string; wrapper: string; home: string; project: string; workdir: string;
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
}

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
 *  `ts` is epoch seconds of the last report; the UI marks it stale when old. */
export interface AccountUsage {
  wrapper: string;
  five: number | null;
  seven: number | null;
  ts: number | null;
  fiveResetAt: number | null;   // epoch seconds the 5h window resets
  sevenResetAt: number | null;  // epoch seconds the 7d window resets
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

export interface Dialog {
  id: string;               // sha1 of the option block text
  title: string;            // nearest non-empty line above the options
  body?: string;            // the full question / preamble above the options (multi-line)
  options: { index: number; label: string; description?: string }[]; // description = the option's sub-text
  selectedIndex: number;    // option with the ❯ marker
  parsed: boolean;          // false → render raw + point to terminal drawer
  raw: string;              // full pane tail for the unparsed case
}

export type SessionStreamMsg =
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean }  // missing=true → transcript file not found at `file`; UI shows a diagnostic banner
  | { type: 'events'; uuid: string; events: ChatEvent[]; offset: number }
  | { type: 'status'; status: SessionStatus; statusUpdatedAt: number | null }
  | { type: 'dialog'; dialog: Dialog }            // a pane menu is awaiting an answer
  | { type: 'dialog_cleared' }
  | { type: 'rotated'; uuid: string }             // transcript switched (clear/compact/swap) — client refetches
  | { type: 'notice'; message: string };
