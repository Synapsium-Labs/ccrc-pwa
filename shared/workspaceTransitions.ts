/**
 * The workspace lifecycle's refusal edges, as ONE table (ARCH-41, #776; consolidation-wave spec §2.5 C4). L0: pure
 * vocabulary; this file imports only `./api.js`, and nothing here may ever import from `server/`.
 *
 * `WORKSPACE_TRANSITIONS` is `RUN_TRANSITIONS`'s sibling for a session's workspace: each row is one edge a client reads
 * as a refusal today, taken from the verb's own refusal and pinned by `server/test/workspace-refusal-census.test.ts`
 * (76 edges, well past the spec's ~10-edge test). A row is (verb, the states the verb is refused in, the refusal code,
 * who enforces it, the precondition). The codes are the three vocabularies clients already read, unrenamed:
 * `ARCHIVE_REFUSALS` (the archive door's wire words), `SENTENCES` (`server/src/wsaudit.ts`) and `LC_REFUSAL_WORD`
 * (`./api.ts`); this table adds the missing half of each word, WHICH state refuses WHICH verb and WHY.
 *
 * WHO WRITES WHAT. `by: 'server'` rows are decided in TS (`server/src/coord/archiveDoor.ts`, which reads its code and
 * HTTP status from `workspaceEdge`, never spells them). `by: 'ccd'` rows are decided in bash, on the box, and re-proven
 * there at the act (the anti-corruption layer owns them: this table records them, it does not move them); the server only
 * renders their words. A row is added here first, then enforced.
 *
 * States are facets the verb can be refused on, not a partition: `live`, `stopped`, `asleep` (hibernated), `archived`,
 * `main` (a project's main checkout, not a workspace), `workspace` (the row is a workspace), `held` (a program holds it)
 * and `rowless` (no registry row names the id).
 */
import type { ArchiveRefusal } from './api.js';

export type WorkspaceVerb = 'archive' | 'restore' | 'forget' | 'reap' | 'expire' | 'reclaim' | 'collect';
const WORKSPACE_VERB_MAP: Record<WorkspaceVerb, true> = {
  archive: true, restore: true, forget: true, reap: true, expire: true, reclaim: true, collect: true,
};
export const WORKSPACE_VERBS: readonly WorkspaceVerb[] = Object.keys(WORKSPACE_VERB_MAP) as WorkspaceVerb[];
export const isWorkspaceVerb = (v: unknown): v is WorkspaceVerb =>
  typeof v === 'string' && (WORKSPACE_VERBS as readonly string[]).includes(v);

export type WorkspaceState = 'live' | 'stopped' | 'asleep' | 'archived' | 'main' | 'workspace' | 'held' | 'rowless';
const WORKSPACE_STATE_MAP: Record<WorkspaceState, true> = {
  live: true, stopped: true, asleep: true, archived: true, main: true, workspace: true, held: true, rowless: true,
};
export const WORKSPACE_STATES: readonly WorkspaceState[] = Object.keys(WORKSPACE_STATE_MAP) as WorkspaceState[];
export const isWorkspaceState = (v: unknown): v is WorkspaceState =>
  typeof v === 'string' && (WORKSPACE_STATES as readonly string[]).includes(v);

/** An edge the server decides: its code is an `ARCHIVE_REFUSALS` word and its HTTP status rides the row. */
export interface ServerWorkspaceEdge {
  readonly verb: 'archive';
  readonly from: readonly WorkspaceState[];
  readonly refusal: ArchiveRefusal;
  readonly by: 'server';
  readonly status: number;
  readonly precondition: string;
}
/** An edge ccd decides on the box; the server renders its word. */
export interface CcdWorkspaceEdge {
  readonly verb: WorkspaceVerb;
  readonly from: readonly WorkspaceState[];
  readonly refusal: string;
  readonly by: 'ccd';
  readonly precondition: string;
}
export type WorkspaceTransition = ServerWorkspaceEdge | CcdWorkspaceEdge;

export const WORKSPACE_TRANSITIONS: readonly WorkspaceTransition[] = [
  { verb: 'archive', from: ['live'], refusal: 'status-unknown', by: 'server', status: 409, precondition: 'the turn could not be measured, whatever the consents' },
  { verb: 'archive', from: ['live'], refusal: 'session-busy', by: 'server', status: 409, precondition: 'the turn is in progress and `interrupt` was not given' },
  { verb: 'archive', from: ['live', 'stopped'], refusal: 'worktree-gone', by: 'server', status: 409, precondition: 'a workspace whose worktree the box proved gone' },
  { verb: 'archive', from: ['live'], refusal: 'run-open', by: 'server', status: 409, precondition: 'the session is the worker of a non-terminal run and `force` was not given' },
  { verb: 'archive', from: ['live'], refusal: 'coordinator-has-open-runs', by: 'server', status: 409, precondition: 'the session claims a non-terminal run and `programme:end` was not given, or the store is unreadable' },
  { verb: 'archive', from: ['live'], refusal: 'programme-partly-ended', by: 'server', status: 409, precondition: 'ending the programme was refused or threw part-way, so nothing is stopped or archived' },
  { verb: 'archive', from: ['live', 'stopped'], refusal: 'manifest-unbuildable', by: 'server', status: 409, precondition: 'ccd could not build the archive manifest (ccd refuses; the door reads its answer, ccdArchiveRefusal)' },
  { verb: 'restore', from: ['live', 'stopped', 'asleep'], refusal: 'not-archived', by: 'ccd', precondition: 'no archive stamp stands for the session' },
  { verb: 'restore', from: ['archived'], refusal: 'worktree-missing', by: 'ccd', precondition: 'the recorded worktree directory is gone' },
  { verb: 'restore', from: ['archived'], refusal: 'in-progress', by: 'ccd', precondition: 'an expiry or reclaim breadcrumb of the workspace stands' },
  { verb: 'forget', from: ['workspace'], refusal: 'is-a-workspace', by: 'ccd', precondition: 'the row is a workspace, whose removal is audited and confirmed' },
  { verb: 'forget', from: ['held'], refusal: 'held', by: 'ccd', precondition: 'a program holds the row' },
  { verb: 'forget', from: ['asleep'], refusal: 'hibernated', by: 'ccd', precondition: 'the row is asleep, not gone' },
  { verb: 'forget', from: ['live'], refusal: 'session-live', by: 'ccd', precondition: 'the session is still running' },
  { verb: 'forget', from: ['live'], refusal: 'session-verdict-unknown', by: 'ccd', precondition: 'tmux did not answer, so liveness is unproven' },
  { verb: 'reap', from: ['rowless'], refusal: 'no-such-session', by: 'ccd', precondition: 'no registry row names the id' },
  { verb: 'reap', from: ['main'], refusal: 'not-a-workspace', by: 'ccd', precondition: 'the row is a main checkout' },
  { verb: 'reap', from: ['live', 'stopped', 'asleep'], refusal: 'not-archived', by: 'ccd', precondition: 'archive is the staging step and has not happened' },
  { verb: 'reap', from: ['archived'], refusal: 'incomplete-registry', by: 'ccd', precondition: 'the row lacks its project, workdir or branch' },
  { verb: 'reap', from: ['archived'], refusal: 'worktree-missing', by: 'ccd', precondition: 'the worktree is gone and no cleanup breadcrumb stands' },
  { verb: 'reap', from: ['archived'], refusal: 'no-worktree-record', by: 'ccd', precondition: 'git has no worktree record for the directory' },
  { verb: 'reap', from: ['archived'], refusal: 'detached-head', by: 'ccd', precondition: 'the worktree is on a detached HEAD' },
  { verb: 'reap', from: ['archived'], refusal: 'foreign-worktree', by: 'ccd', precondition: 'the worktree belongs to another repository' },
  { verb: 'reap', from: ['archived'], refusal: 'branch-elsewhere', by: 'ccd', precondition: 'the branch is checked out somewhere else' },
  { verb: 'reap', from: ['archived'], refusal: 'dirty-tree', by: 'ccd', precondition: 'uncommitted or untracked changes stand' },
  { verb: 'reap', from: ['archived'], refusal: 'tree-unreadable', by: 'ccd', precondition: 'the worktree could not be read' },
  { verb: 'reap', from: ['archived'], refusal: 'sensitive-ignored', by: 'ccd', precondition: 'secret-shaped ignored files stand' },
  { verb: 'reap', from: ['archived'], refusal: 'nested-checkouts-present', by: 'ccd', precondition: 'stray checkouts live under the workspace' },
  { verb: 'reap', from: ['archived'], refusal: 'child-dirty', by: 'ccd', precondition: 'a nested registered checkout has work in no commit' },
  { verb: 'reap', from: ['archived'], refusal: 'child-busy', by: 'ccd', precondition: 'a nested checkout is mid-operation' },
  { verb: 'reap', from: ['archived'], refusal: 'child-unpushed', by: 'ccd', precondition: 'a nested checkout has commits not reachable from origin' },
  { verb: 'reap', from: ['archived'], refusal: 'child-branch-elsewhere', by: 'ccd', precondition: 'a nested checkout branch is checked out elsewhere' },
  { verb: 'reap', from: ['archived'], refusal: 'child-record-stale', by: 'ccd', precondition: 'git records a nested worktree whose directory is gone' },
  { verb: 'reap', from: ['archived'], refusal: 'stashes-present', by: 'ccd', precondition: 'the branch has stashed changes' },
  { verb: 'reap', from: ['archived'], refusal: 'stash-unreadable', by: 'ccd', precondition: 'the stash list could not be read' },
  { verb: 'reap', from: ['archived'], refusal: 'no-upstream', by: 'ccd', precondition: 'the branch was never pushed' },
  { verb: 'reap', from: ['archived'], refusal: 'unpushed-commits', by: 'ccd', precondition: 'commits are not on the remote' },
  { verb: 'reap', from: ['archived'], refusal: 'branch-missing', by: 'ccd', precondition: 'the named branch does not resolve' },
  { verb: 'reap', from: ['archived'], refusal: 'no-remote', by: 'ccd', precondition: 'the project has no origin remote' },
  { verb: 'reap', from: ['archived'], refusal: 'gh-unreadable', by: 'ccd', precondition: 'GitHub could not be reached' },
  { verb: 'reap', from: ['archived'], refusal: 'no-bound-pr', by: 'ccd', precondition: 'no merged pull request belongs to the branch' },
  { verb: 'reap', from: ['archived'], refusal: 'pr-head-not-ours', by: 'ccd', precondition: 'the matching pull request was opened from another commit' },
  { verb: 'reap', from: ['archived'], refusal: 'pr-fields-malformed', by: 'ccd', precondition: 'GitHub returned unusable commit ids' },
  { verb: 'reap', from: ['archived'], refusal: 'fetch-failed', by: 'ccd', precondition: 'origin could not be fetched' },
  { verb: 'reap', from: ['archived'], refusal: 'merge-commit-missing', by: 'ccd', precondition: 'the named merge commit is not in the repository' },
  { verb: 'reap', from: ['archived'], refusal: 'base-missing', by: 'ccd', precondition: 'the base branch no longer resolves' },
  { verb: 'reap', from: ['archived'], refusal: 'tree-differs', by: 'ccd', precondition: 'the merge cannot be proven to hold the branch work' },
  { verb: 'reap', from: ['archived'], refusal: 'clips-unreadable', by: 'ccd', precondition: 'the pasted-image directory could not be listed' },
  { verb: 'reap', from: ['archived'], refusal: 'session-busy', by: 'ccd', precondition: 'the session is mid-turn' },
  { verb: 'reap', from: ['archived'], refusal: 'status-unknown', by: 'ccd', precondition: 'the session status could not be read' },
  { verb: 'reap', from: ['archived'], refusal: 'held', by: 'ccd', precondition: 'a program holds the workspace' },
  { verb: 'reap', from: ['archived'], refusal: 'in-progress', by: 'ccd', precondition: 'another cleanup of the workspace holds the lock' },
  { verb: 'reap', from: ['archived'], refusal: 'state-changed', by: 'ccd', precondition: 'the workspace changed since the audit the token fingerprints' },
  { verb: 'reap', from: ['archived'], refusal: 'reclaim-in-progress', by: 'ccd', precondition: 'an interrupted reclaim breadcrumb stands; reap never finishes it' },
  { verb: 'expire', from: ['live', 'stopped', 'asleep'], refusal: 'not-archived', by: 'ccd', precondition: 'the workspace is not archived' },
  { verb: 'expire', from: ['archived'], refusal: 'not-expired', by: 'ccd', precondition: 'archived less than seven days ago' },
  { verb: 'expire', from: ['archived'], refusal: 'child', by: 'ccd', precondition: 'a run-created workspace is cleaned up when its run closes' },
  { verb: 'expire', from: ['archived'], refusal: 'live', by: 'ccd', precondition: 'a pane or a service that would start one stands' },
  { verb: 'expire', from: ['archived'], refusal: 'in-use', by: 'ccd', precondition: 'a process has its working directory inside the workspace' },
  { verb: 'expire', from: ['archived'], refusal: 'in-progress', by: 'ccd', precondition: 'another cleanup holds the lock' },
  { verb: 'reclaim', from: ['rowless'], refusal: 'no-such-session', by: 'ccd', precondition: 'no registry row names the id' },
  { verb: 'reclaim', from: ['main'], refusal: 'not-a-workspace', by: 'ccd', precondition: 'the row is a main checkout' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'not-a-child', by: 'ccd', precondition: 'the child marker and the run id do not agree' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'held', by: 'ccd', precondition: 'a program holds the workspace' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'paused', by: 'ccd', precondition: 'reclamation is paused fleet-wide' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'attached', by: 'ccd', precondition: 'a terminal is attached' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'tree-busy', by: 'ccd', precondition: 'a git operation or an index lock stands in the tree' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'not-idle', by: 'ccd', precondition: 'the child worked within the stale window' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'containment-unproven', by: 'ccd', precondition: 'the tree at the path is not proven the child’s own' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'in-progress', by: 'ccd', precondition: 'another cleanup holds the lock' },
  { verb: 'reclaim', from: ['live', 'asleep'], refusal: 'reap-in-progress', by: 'ccd', precondition: 'an interrupted reap breadcrumb stands; reclaim never finishes it' },
  { verb: 'collect', from: ['rowless'], refusal: 'not-witnessed', by: 'ccd', precondition: 'no witness and no quarantine record names the id' },
  { verb: 'collect', from: ['rowless'], refusal: 'registered', by: 'ccd', precondition: 'a registry row or what one left behind still stands' },
  { verb: 'collect', from: ['rowless'], refusal: 'changed-recently', by: 'ccd', precondition: 'the newest change is younger than the idle floor' },
  { verb: 'collect', from: ['rowless'], refusal: 'witness-mismatch', by: 'ccd', precondition: 'the directory is not the one its witness names' },
  { verb: 'collect', from: ['rowless'], refusal: 'quarantine-kept', by: 'ccd', precondition: 'a quarantine record or slot cannot be read, proved or cleared' },
];

/** The refusal codes a verb can answer, derived from the table in row order (never a second list). */
const refusalsOf = (v: WorkspaceVerb): readonly string[] =>
  [...new Set(WORKSPACE_TRANSITIONS.filter((t) => t.verb === v).map((t) => t.refusal))];
export const WORKSPACE_REFUSALS_BY_VERB: Readonly<Record<WorkspaceVerb, readonly string[]>> = {
  archive: refusalsOf('archive'), restore: refusalsOf('restore'), forget: refusalsOf('forget'), reap: refusalsOf('reap'),
  expire: refusalsOf('expire'), reclaim: refusalsOf('reclaim'), collect: refusalsOf('collect'),
};

/** Is `code` an edge of `verb`'s? The one door a reader narrows a workspace refusal through. */
export const isWorkspaceRefusal = (verb: WorkspaceVerb, code: unknown): boolean =>
  typeof code === 'string' && (WORKSPACE_REFUSALS_BY_VERB[verb] as readonly string[]).includes(code);

/** The archive door's edge for a refusal code: its precondition and HTTP status. Throws on a code with no row, so a
 *  refusal the table does not know cannot be sent. */
export function workspaceEdge(verb: 'archive', code: ArchiveRefusal): ServerWorkspaceEdge {
  const edge = WORKSPACE_TRANSITIONS.find((t): t is ServerWorkspaceEdge => t.verb === verb && t.by === 'server' && t.refusal === code);
  if (edge === undefined) throw new Error(`workspace transitions: no ${verb} edge refuses ${code}`);
  return edge;
}
