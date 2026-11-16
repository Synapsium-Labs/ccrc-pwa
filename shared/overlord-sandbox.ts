/** The Overlord's sandbox check: its vocabulary and the loads report's wire shape (Overlord spec §3.6 H4; plan
 *  `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`, Task 2). Ring L0, context K: pure vocabulary, no import
 *  at all, because the PWA bundles this directory.
 *
 *  The hook reads what a running session loaded from its transcript's start attachments (slug
 *  `loaded-sets-read-from-the-transcript`) and sends it to `POST /api/sessions/:id/start/loads`, once per `startup` or
 *  `resume` start of a session that carries `CCRC_LAUNCH_PROFILE`. The server keeps the report (`continuity_start_loads`)
 *  and computes the verdict on read (PR B), so nothing here decides.
 *
 *  Derived-enumeration discipline: each list is `as const` and its type derives from it, so a reader never restates one. */

/** The properties the check rules on (spec §3.6 H4), in the order the board shows them. */
export const SANDBOX_PROPERTIES = [
  'profile', 'tools', 'tool-servers', 'instructions', 'skills', 'agents', 'hooks', 'remote-control', 'permission-mode',
  'workspace',
] as const;
export type SandboxProperty = (typeof SANDBOX_PROPERTIES)[number];

/** The kinds a loads report carries (Task 1, M4 and M7). Each is the sorted list the hook measured, or the word
 *  `unmeasured`: a kind the transcript window did not hold, could not be read, or held in a shape this build does not know.
 *  `tools` is the offered tool list of the first tool-bearing `prompt_snapshot` after the start's first request, and
 *  `toolServers` the servers its tools name (ruled 2026-11-15, slug `tools-read-from-the-prompt-snapshot`: the door's tools
 *  are offered directly, so no deferred-tools kind is read). */
export const START_LOAD_KINDS = ['instructions', 'hooks', 'skills', 'agents', 'tools', 'toolServers'] as const;
export type StartLoadKind = (typeof START_LOAD_KINDS)[number];

/** The word a kind carries when it was not measured. Never read as an empty list (Review Focus 3). A second spelling
 *  beside `server/src/unmeasured.ts#UNMEASURED`, legitimately: this file is L0 and imports nothing, and the hook and the
 *  wire read the word from here, so it cannot import the server's (review 2135 nit). `continuity-start-loads-route.test.ts`
 *  pins the two equal. */
export const UNMEASURED = 'unmeasured' as const;

/** One instruction file the session loaded (`instructions` attachment): its type as Claude Code names it (`Project`,
 *  `User`, ...), its file name, whether it lies in the session's workspace, and the sha256 of its content. The content
 *  itself never leaves the box. */
export interface LoadedInstruction {
  readonly type: string;
  readonly name: string;
  readonly inWorkspace: boolean;
  readonly sha256: string;
}

/** One entry of a kind's list: an instruction file for `instructions`; a name (a skill, an agent type, a tool server, a
 *  deferred tool) or a hook command's sha256 for every other kind. */
export type LoadedEntry = LoadedInstruction | string;

/** A kind's measurement. */
export type LoadedKind = readonly LoadedEntry[] | typeof UNMEASURED;

/** The longest list the door accepts for one kind. */
export const START_LOADS_MAX_LIST = 200;

/** The loads report the hook sends (`ccrc-api sessions loads <id>`). `reportId` is the start report's own, so the door
 *  joins the report to the start it completes; `reportedAt` is the hook's clock and is left out of the body's hash, so a
 *  resent body is never a second one. A newer hook's kind this build does not know is dropped at the door, never refused. */
export interface StartLoadsBody {
  readonly fromId: string;
  readonly fromUuid: string;
  readonly reportId: string;
  /** From `CCRC_LAUNCH_PROFILE` (`<role>:<digest>`), or null when the session had none. */
  readonly profileRole: string | null;
  readonly profileDigest: string | null;
  /** `CCRC_LAUNCH_RC`, ccd's record of the flags it spliced, or null. */
  readonly launchRc: 'on' | 'off' | null;
  /** The Claude Code build, from `CLAUDE_CODE_EXECPATH`, or null. */
  readonly claudeVersion: string | null;
  /** The hook payload's `permission_mode`, or null. */
  readonly permissionMode: string | null;
  /** Whether the payload's `cwd` lies in the registry row's `workdir`, or null when unmeasured. */
  readonly cwdInWorkspace: boolean | null;
  readonly loaded: Readonly<Record<StartLoadKind, LoadedKind>>;
  /** At a resume, the `reportId` of the newest reported `startup` of the same transcript whose digest and build equal this
   *  report's, when `instructions` or `hooks` was carried from it (ruled 2026-11-15, slug `resume-carries-its-own-start`);
   *  absent otherwise. */
  readonly carriedFrom?: string;
  readonly reportedAt: number;
}

/** Claude Code's own agent types and skills, which a session lists whatever its setting sources, keyed by the build they
 *  were measured on (question 4, slug `claude-code-own-lists-are-keyed-by-build`). The check allows exactly the profile's
 *  names plus the report build's lists; a build with no entry reads `skills` and `agents` `unmeasured`, naming the build.
 *
 *  A RIG LOWER BOUND (ruled 2026-11-15, slug `own-lists-are-a-rig-lower-bound`): measured in the W0 rig (Task 1, M5:
 *  `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox/load-path.md`) under the Overlord's pinned launch against the
 *  mock API, from the `agent_listing_delta` attachment's `builtInTypes` and the `skill_listing` names less the profile's
 *  own. A live account lists more bundled skills than the mock does, so nothing in PR A judges against these lists, and a
 *  live read is a Needs-first of PR B. */
export const CLAUDE_CODE_OWN_LISTS: Readonly<Record<string, { readonly agents: readonly string[]; readonly skills: readonly string[] }>> = {
  '2.1.323': {
    agents: ['Explore', 'Plan', 'general-purpose'],
    skills: ['claude-api', 'code-review', 'dataviz', 'fewer-permission-prompts', 'init', 'keybindings-help', 'loop',
      'plugin-authoring', 'run', 'security-review', 'simplify', 'update-config'],
  },
  '2.1.325': {
    agents: ['Explore', 'Plan', 'general-purpose'],
    skills: ['claude-api', 'code-review', 'dataviz', 'fewer-permission-prompts', 'init', 'keybindings-help', 'loop',
      'plugin-authoring', 'run', 'security-review', 'simplify', 'update-config'],
  },
};
