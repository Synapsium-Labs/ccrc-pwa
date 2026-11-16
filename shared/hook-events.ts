// The hook events ccrc's session hook handles: one L0 vocabulary (D-8613, ARCH-26's deferred union). Imports nothing.
//
// The set is the hook's own: `ccd/session-hook.sh`'s `case "$event"` arms, which `ccd/install-session-hooks.sh`
// registers (its `EVENTS_JSON` plus PreToolUse); `install-session-hooks.test.ts` holds this map to those arms as a set,
// both directions. Claude Code owns the full list and grows it between builds, so a hookstate read keeps its `event`
// as an open string and never narrows it (`server/src/hookstate.ts`): a name this build does not know is simply not
// the one a consumer looks for. A consumer names an event only as a `HookEvent`, through `hookEventIs` or a list
// typed by the union, so a misspelt name is a compile error instead of a compare that never matches.

/** Each event the hook handles, with what it marks for ccrc. One total map; the runtime list is its keys. */
const HOOK_EVENT_MAP = {
  SessionStart: 'a session started, resumed, cleared or compacted (its `source` says which)',
  UserPromptSubmit: 'a prompt was submitted: the main turn opens',
  PreToolUse: 'a tool is about to run (matcher `*`): the deny, nudge and delegation spool arms',
  PostToolUse: 'a tool returned',
  PermissionRequest: 'a permission prompt is open: an approval ask',
  Stop: 'the main turn ended, listing the background work it left running',
  StopFailure: 'the main turn ended on an API error',
  SubagentStart: 'a subagent started',
  SubagentStop: 'a subagent ended',
  PreCompact: 'a compaction is about to run',
  PostCompact: 'a compaction finished',
  SessionEnd: 'the session ended or was cleared',
} as const;

export type HookEvent = keyof typeof HOOK_EVENT_MAP;

/** Every hook event the hook handles, in the map's order. */
export const HOOK_EVENTS: readonly HookEvent[] =
  Object.keys(HOOK_EVENT_MAP) as HookEvent[];

/** True when `v` is one of the handled events' names, exactly. */
export function isHookEvent(v: unknown): v is HookEvent {
  return typeof v === 'string' && Object.hasOwn(HOOK_EVENT_MAP, v);
}

/** The one way a consumer tests a raw hook event (an open string, or null when absent) against a named event. */
export function hookEventIs(event: string | null | undefined, name: HookEvent): boolean {
  return event === name;
}
