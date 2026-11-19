/** The session hook's reports, on the wire (Overlord design spec §3.6 H1, §3.3.10 C55, §3.3.11 H12, §3.8, §7.4, Table 11.1e
 *  "The hook's reports"; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`, Task 7). Ring L0, context K:
 *  pure vocabulary, no import.
 *
 *  The hook reports what the session really did through ONE door, `POST /api/sessions/:id/report`, one kind a body (slug
 *  `hook-reports-share-one-door`): the witness of a door tool call (gates B's step 7a looks it up), a reader's start and stop,
 *  a quiet turn's end clearing the readers, a model switch (door process B2 sends it), and "picked up", the id of an operator
 *  message whose nudge line the prompt carried. Each report fails open on the hook's side: one it cannot send is lost, never
 *  retried, so nothing graded from the hook's side alone may claim more than the reports prove (closed-book reads the
 *  server's read ledger instead, ruled F10). The witness key's header is `continuity-door.ts#WITNESS_KEY_HEADER`. */

/** The report kinds, each with what it says. Every body names one. */
const HOOK_REPORT_KIND_MAP = {
  witness: 'a door tool call the hook let through, keyed by the call digest (plan question 6)',
  'reader-start': 'a subagent started, with its agent id and type',
  'reader-stop': 'a subagent stopped, with its agent id',
  'readers-clear': 'a main-thread turn ended with no background work: no reader runs',
  'model-switch': "the session's model changed inside a generation (door process B2's events)",
  'picked-up': "the prompt carried an operator message's nudge line: that message was picked up",
} as const;
export type HookReportKind = keyof typeof HOOK_REPORT_KIND_MAP;
export const HOOK_REPORT_KINDS = Object.keys(HOOK_REPORT_KIND_MAP) as HookReportKind[];
export function isHookReportKind(v: unknown): v is HookReportKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(HOOK_REPORT_KIND_MAP, v);
}

/** How a reported model switch came about (door process B2): `switched` is a change Claude Code reported, `typed-refused` a
 *  typed `/model` the prompt arm refused, which changed nothing and is never drift. */
const MODEL_SWITCH_HOW_MAP = {
  switched: 'the model changed (PostModelSwitch)',
  'typed-refused': 'a typed /model the prompt arm refused; nothing changed',
} as const;
export type ModelSwitchHow = keyof typeof MODEL_SWITCH_HOW_MAP;
export const MODEL_SWITCH_HOWS = Object.keys(MODEL_SWITCH_HOW_MAP) as ModelSwitchHow[];
export function isModelSwitchHow(v: unknown): v is ModelSwitchHow {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MODEL_SWITCH_HOW_MAP, v);
}

/** One report as the door takes it, after `hookReportOf` (`server/src/continuity/hookReports.ts`) narrowed the body. `at` is
 *  the hook's clock; every window the server reads uses its own `receivedAt` instead. */
export type HookReport =
  | { readonly kind: 'witness'; readonly key: string; readonly tool: string; readonly agentId: string | null; readonly at: number }
  | { readonly kind: 'reader-start'; readonly agentId: string; readonly agentType: string | null; readonly at: number }
  | { readonly kind: 'reader-stop'; readonly agentId: string; readonly at: number }
  | { readonly kind: 'readers-clear'; readonly at: number }
  | { readonly kind: 'model-switch'; readonly how: ModelSwitchHow; readonly from: string | null; readonly to: string | null; readonly at: number }
  | { readonly kind: 'picked-up'; readonly messageId: number; readonly at: number };

/** The witness key (plan question 6, slug `witness-key-is-the-call-digest`): the sha256, as 64 lowercase hex, of the tool's full
 *  name (`mcp__door__<name>`), one newline, and the tool input printed by `jq -cS` with its trailing newline removed (`{}` for
 *  an absent input). The hook computes it from the `PreToolUse` payload and the door process from the MCP call, both through
 *  `jq -cS`. It is not W2's dedupe key (slug `witness-key-is-not-the-dedupe-key`). */
export const WITNESS_KEY_SHAPE = /^[0-9a-f]{64}$/;
/** A door tool's full name as the hook sees it: Claude Code's prefix for the `door` tool server, then the tool's own name. */
export const DOOR_TOOL_PREFIX = 'mcp__door__';
/** A door tool name's grammar after the prefix: the door names, each space as `_` (`door-tools.test.ts` holds the table to it). */
export const DOOR_TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
/** An agent id, as the hook's roster keeps it (D-5232): wholly `[A-Za-z0-9_-]`, 1 to 64 characters. */
export const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** An agent type, a model name: printable text up to these many characters. */
export const AGENT_TYPE_MAX = 128;
export const REPORT_MODEL_MAX = 128;

/** STARTING VALUES (plan question 12; the spec-fixes run adds them to Table 11.5b). */
/** A witness counts for a write received at most this long after it, by the server's clock. */
export const WITNESS_WINDOW_MS = 120_000;
/** Witness rows are kept this long. */
export const WITNESS_KEEP_MS = 24 * 3_600_000;
/** Reader and model-switch rows, and the witness checks, are kept this long. */
export const REPORT_KEEP_MS = 7 * 24 * 3_600_000;
/** A reader start with no stop and no turn-end clear this old makes `readersRunning` unmeasured. */
export const READER_STALE_MS = 30 * 60_000;
/** The hook's bound on one report's send, in seconds (`_hook_timeout`). ccd/session-hook.sh carries a copy, held equal by its test. */
export const REPORT_TIMEOUT_S = 3;
