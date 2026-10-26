// ARCH-41 (#776), the CENSUS commit: every workspace verb's CLIENT-READ refusal edge, as data, taken from today's
// routes and deciders (consolidation-wave spec §2.5, C4). A characterization: it pins what the code does today, green on
// the old code, and decides whether a `WORKSPACE_TRANSITIONS` table is warranted (spec: roughly ten or more client-read
// edges). An edge is (verb, the state the workspace is in, the refusal code, the precondition that refuses). "Client-read"
// means a person or the PWA reads the code: `ARCHIVE_REFUSALS` (the archive door's wire words), `SENTENCES`
// (`wsaudit.ts`, the sheet's copy for ccd's reap/expire/reclaim/restore/collect tokens) or `LC_REFUSAL_WORD`
// (`shared/api.ts`, the lifecycle journal's copy). Not counted: the route-shape words (`bad-session-id`,
// `unknown-session`, `registry-unmeasurable`, `unsupported`, which no state of the workspace can cause), the idle-policy
// verdicts of the hibernate and stop-done lanes (logged, never shown to a client), and flag-parsing `bad-args`.
// Who ENFORCES an edge is recorded too: `server` (a TS decider, `coord/archiveDoor.ts`) or `ccd` (bash, re-proven on the
// box). The ccd arm's code must still appear in `ccd/ccd`; the server arm's in its decider.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_REFUSAL_CODES, LC_REFUSAL_WORD } from '../../shared/api.js';
import { SENTENCES } from '../src/wsaudit.js';
import {
  WORKSPACE_TRANSITIONS, WORKSPACE_VERBS, WORKSPACE_STATES, WORKSPACE_REFUSALS_BY_VERB, isWorkspaceRefusal,
  isWorkspaceVerb, isWorkspaceState, workspaceEdge,
} from '../../shared/workspaceTransitions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8');

type Verb = 'archive' | 'restore' | 'forget' | 'reap' | 'expire' | 'reclaim' | 'collect';
type Enforcer = 'server' | 'ccd';
interface CensusEdge {
  readonly verb: Verb; readonly from: string; readonly code: string; readonly by: Enforcer; readonly precondition: string;
}
const e = (verb: Verb, from: string, code: string, by: Enforcer, precondition: string): CensusEdge =>
  ({ verb, from, code, by, precondition });

/** Today's edges, in verb order. `from` is the workspace state the verb is asked in: `live`, `stopped`, `asleep`
 *  (hibernated), `archived`, `main` (a project's main checkout, not a workspace), `rowless` (no registry row). */
export const WORKSPACE_REFUSAL_CENSUS: readonly CensusEdge[] = [
  // archive: live|stopped|asleep -> archived. The server decides first (`decideArchive`), ccd re-measures the turn.
  e('archive', 'live', 'status-unknown', 'server', 'the turn could not be measured, whatever the consents'),
  e('archive', 'live', 'session-busy', 'server', 'the turn is in progress and `interrupt` was not given'),
  e('archive', 'live|stopped', 'worktree-gone', 'server', 'a workspace whose worktree the box proved gone'),
  e('archive', 'live', 'run-open', 'server', 'the session is the worker of a non-terminal run and `force` was not given'),
  e('archive', 'live', 'coordinator-has-open-runs', 'server', 'the session claims a non-terminal run and `programme:end` was not given, or the store is unreadable'),
  e('archive', 'live', 'programme-partly-ended', 'server', 'ending the programme was refused or threw part-way, so nothing is stopped or archived'),
  e('archive', 'live|stopped', 'manifest-unbuildable', 'server', 'ccd could not build the archive manifest (ccd refuses; the door reads its answer, ccdArchiveRefusal)'),
  // restore: archived -> live.
  e('restore', 'live|stopped|asleep', 'not-archived', 'ccd', 'no archive stamp stands for the session'),
  e('restore', 'archived', 'worktree-missing', 'ccd', 'the recorded worktree directory is gone'),
  e('restore', 'archived', 'in-progress', 'ccd', 'an expiry or reclaim breadcrumb of the workspace stands'),
  // forget: a non-workspace row -> removed.
  e('forget', 'workspace', 'is-a-workspace', 'ccd', 'the row is a workspace, whose removal is audited and confirmed'),
  e('forget', 'held', 'held', 'ccd', 'a program holds the row'),
  e('forget', 'asleep', 'hibernated', 'ccd', 'the row is asleep, not gone'),
  e('forget', 'live', 'session-live', 'ccd', 'the session is still running'),
  e('forget', 'live', 'session-verdict-unknown', 'ccd', 'tmux did not answer, so liveness is unproven'),
  // reap (ws-reap, ws-rm): archived -> retired, with a proof ladder every rung of which is a refusal.
  e('reap', 'rowless', 'no-such-session', 'ccd', 'no registry row names the id'),
  e('reap', 'main', 'not-a-workspace', 'ccd', 'the row is a main checkout'),
  e('reap', 'live|stopped|asleep', 'not-archived', 'ccd', 'archive is the staging step and has not happened'),
  e('reap', 'archived', 'incomplete-registry', 'ccd', 'the row lacks its project, workdir or branch'),
  e('reap', 'archived', 'worktree-missing', 'ccd', 'the worktree is gone and no cleanup breadcrumb stands'),
  e('reap', 'archived', 'no-worktree-record', 'ccd', 'git has no worktree record for the directory'),
  e('reap', 'archived', 'detached-head', 'ccd', 'the worktree is on a detached HEAD'),
  e('reap', 'archived', 'foreign-worktree', 'ccd', 'the worktree belongs to another repository'),
  e('reap', 'archived', 'branch-elsewhere', 'ccd', 'the branch is checked out somewhere else'),
  e('reap', 'archived', 'dirty-tree', 'ccd', 'uncommitted or untracked changes stand'),
  e('reap', 'archived', 'tree-unreadable', 'ccd', 'the worktree could not be read'),
  e('reap', 'archived', 'sensitive-ignored', 'ccd', 'secret-shaped ignored files stand'),
  e('reap', 'archived', 'nested-checkouts-present', 'ccd', 'stray checkouts live under the workspace'),
  e('reap', 'archived', 'child-dirty', 'ccd', 'a nested registered checkout has work in no commit'),
  e('reap', 'archived', 'child-busy', 'ccd', 'a nested checkout is mid-operation'),
  e('reap', 'archived', 'child-unpushed', 'ccd', 'a nested checkout has commits not reachable from origin'),
  e('reap', 'archived', 'child-branch-elsewhere', 'ccd', 'a nested checkout branch is checked out elsewhere'),
  e('reap', 'archived', 'child-record-stale', 'ccd', 'git records a nested worktree whose directory is gone'),
  e('reap', 'archived', 'stashes-present', 'ccd', 'the branch has stashed changes'),
  e('reap', 'archived', 'stash-unreadable', 'ccd', 'the stash list could not be read'),
  e('reap', 'archived', 'no-upstream', 'ccd', 'the branch was never pushed'),
  e('reap', 'archived', 'unpushed-commits', 'ccd', 'commits are not on the remote'),
  e('reap', 'archived', 'branch-missing', 'ccd', 'the named branch does not resolve'),
  e('reap', 'archived', 'no-remote', 'ccd', 'the project has no origin remote'),
  e('reap', 'archived', 'gh-unreadable', 'ccd', 'GitHub could not be reached'),
  e('reap', 'archived', 'no-bound-pr', 'ccd', 'no merged pull request belongs to the branch'),
  e('reap', 'archived', 'pr-head-not-ours', 'ccd', 'the matching pull request was opened from another commit'),
  e('reap', 'archived', 'pr-fields-malformed', 'ccd', 'GitHub returned unusable commit ids'),
  e('reap', 'archived', 'fetch-failed', 'ccd', 'origin could not be fetched'),
  e('reap', 'archived', 'merge-commit-missing', 'ccd', 'the named merge commit is not in the repository'),
  e('reap', 'archived', 'base-missing', 'ccd', 'the base branch no longer resolves'),
  e('reap', 'archived', 'tree-differs', 'ccd', 'the merge cannot be proven to hold the branch work'),
  e('reap', 'archived', 'clips-unreadable', 'ccd', 'the pasted-image directory could not be listed'),
  e('reap', 'archived', 'session-busy', 'ccd', 'the session is mid-turn'),
  e('reap', 'archived', 'status-unknown', 'ccd', 'the session status could not be read'),
  e('reap', 'archived', 'held', 'ccd', 'a program holds the workspace'),
  e('reap', 'archived', 'in-progress', 'ccd', 'another cleanup of the workspace holds the lock'),
  e('reap', 'archived', 'state-changed', 'ccd', 'the workspace changed since the audit the token fingerprints'),
  e('reap', 'archived', 'reclaim-in-progress', 'ccd', 'an interrupted reclaim breadcrumb stands; reap never finishes it'),
  // expire (ws-expire): archived -> retired after the seven-day window; its other refusals are reap's.
  e('expire', 'live|stopped|asleep', 'not-archived', 'ccd', 'the workspace is not archived'),
  e('expire', 'archived', 'not-expired', 'ccd', 'archived less than seven days ago'),
  e('expire', 'archived', 'child', 'ccd', 'a run-created workspace is cleaned up when its run closes'),
  e('expire', 'archived', 'live', 'ccd', 'a pane or a service that would start one stands'),
  e('expire', 'archived', 'in-use', 'ccd', 'a process has its working directory inside the workspace'),
  e('expire', 'archived', 'in-progress', 'ccd', 'another cleanup holds the lock'),
  // reclaim (ws-reclaim): live|asleep child -> retired.
  e('reclaim', 'rowless', 'no-such-session', 'ccd', 'no registry row names the id'),
  e('reclaim', 'main', 'not-a-workspace', 'ccd', 'the row is a main checkout'),
  e('reclaim', 'live|asleep', 'not-a-child', 'ccd', 'the child marker and the run id do not agree'),
  e('reclaim', 'live|asleep', 'held', 'ccd', 'a program holds the workspace'),
  e('reclaim', 'live|asleep', 'paused', 'ccd', 'reclamation is paused fleet-wide'),
  e('reclaim', 'live|asleep', 'attached', 'ccd', 'a terminal is attached'),
  e('reclaim', 'live|asleep', 'tree-busy', 'ccd', 'a git operation or an index lock stands in the tree'),
  e('reclaim', 'live|asleep', 'not-idle', 'ccd', 'the child worked within the stale window'),
  e('reclaim', 'live|asleep', 'containment-unproven', 'ccd', 'the tree at the path is not proven the child’s own'),
  e('reclaim', 'live|asleep', 'in-progress', 'ccd', 'another cleanup holds the lock'),
  e('reclaim', 'live|asleep', 'reap-in-progress', 'ccd', 'an interrupted reap breadcrumb stands; reclaim never finishes it'),
  // collect (ws-collect): a rowless, witnessed temp root -> quarantined.
  e('collect', 'rowless', 'not-witnessed', 'ccd', 'no witness and no quarantine record names the id'),
  e('collect', 'rowless', 'registered', 'ccd', 'a registry row or what one left behind still stands'),
  e('collect', 'rowless', 'changed-recently', 'ccd', 'the newest change is younger than the idle floor'),
  e('collect', 'rowless', 'witness-mismatch', 'ccd', 'the directory is not the one its witness names'),
  e('collect', 'rowless', 'quarantine-kept', 'ccd', 'a quarantine record or slot cannot be read, proved or cleared'),
];

const CCD = read('ccd/ccd');
const DOOR = read('server/src/coord/archiveDoor.ts');
const key = (x: CensusEdge): string => `${x.verb}|${x.from}|${x.code}`;

describe('workspace refusal census (ARCH-41, #776): today’s client-read refusal edges, pinned', () => {
  it('CONTROL: the census is non-empty and every edge is unique', () => {
    expect(WORKSPACE_REFUSAL_CENSUS.length).toBeGreaterThan(0);
    expect(new Set(WORKSPACE_REFUSAL_CENSUS.map(key)).size).toBe(WORKSPACE_REFUSAL_CENSUS.length);
  });

  it('pins the per-verb edge counts exactly (a verb gaining or losing a refusal is a decision, not drift)', () => {
    const counts: Record<string, number> = {};
    for (const x of WORKSPACE_REFUSAL_CENSUS) counts[x.verb] = (counts[x.verb] ?? 0) + 1;
    expect(counts).toEqual({ archive: 7, restore: 3, forget: 5, reap: 39, expire: 6, reclaim: 11, collect: 5 });
    expect(WORKSPACE_REFUSAL_CENSUS.length).toBe(76);
  });

  it('every edge’s code is read by a client: an archive wire word, a SENTENCES key or an LC_REFUSAL_WORD key', () => {
    const archive: readonly string[] = ARCHIVE_REFUSAL_CODES;
    for (const x of WORKSPACE_REFUSAL_CENSUS) {
      const read = x.verb === 'archive' ? archive.includes(x.code) : x.code in SENTENCES || x.code in LC_REFUSAL_WORD;
      expect(read, key(x)).toBe(true);
    }
  });

  it('every edge is really enforced where it says: a server edge in the archive decider, a ccd edge in ccd/ccd', () => {
    for (const x of WORKSPACE_REFUSAL_CENSUS) {
      if (x.by === 'server') {
        const name = x.code.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        expect(DOOR.includes(`ARCHIVE_REFUSALS.${name}`), key(x)).toBe(true);
      } else {
        expect(new RegExp(`[ "'|]${x.code}[ "'|\\\\]`).test(CCD), key(x)).toBe(true);
      }
    }
  });

  it('every archive wire word is a census edge (the door has no refusal the census missed)', () => {
    const covered = new Set(WORKSPACE_REFUSAL_CENSUS.filter((x) => x.verb === 'archive').map((x) => x.code));
    expect([...covered].sort()).toEqual([...ARCHIVE_REFUSAL_CODES].sort());
  });
});

// ── The table (commit 2): WORKSPACE_TRANSITIONS answers every census edge, and the archive decider reads it. ──────────
describe('WORKSPACE_TRANSITIONS answers the census (ARCH-41, #776)', () => {
  const rowKey = (verb: string, from: readonly string[], code: string): string => `${verb}|${[...from].join('|')}|${code}`;

  it('every census edge is a table row, field for field', () => {
    const rows = new Map(WORKSPACE_TRANSITIONS.map((t) => [rowKey(t.verb, t.from, t.refusal), t] as const));
    for (const x of WORKSPACE_REFUSAL_CENSUS) {
      const row = rows.get(rowKey(x.verb, x.from.split('|'), x.code));
      expect(row, key(x)).toBeDefined();
      expect(row!.by, key(x)).toBe(x.by);
      expect(row!.precondition, key(x)).toBe(x.precondition);
    }
  });

  it('the table has no row the census did not see (a new edge is a census edge first)', () => {
    expect(WORKSPACE_TRANSITIONS).toHaveLength(WORKSPACE_REFUSAL_CENSUS.length);
  });

  it('the derived lists and guards are total: every verb and state a row names is listed, and only those', () => {
    for (const t of WORKSPACE_TRANSITIONS) {
      expect(isWorkspaceVerb(t.verb), t.verb).toBe(true);
      for (const f of t.from) expect(isWorkspaceState(f), f).toBe(true);
      expect(isWorkspaceRefusal(t.verb, t.refusal)).toBe(true);
    }
    expect([...WORKSPACE_VERBS].sort()).toEqual(['archive', 'collect', 'expire', 'forget', 'reap', 'reclaim', 'restore']);
    expect(WORKSPACE_STATES).toContain('archived');
    expect(isWorkspaceRefusal('restore', 'dirty-tree')).toBe(false);
    expect(new Set(WORKSPACE_REFUSALS_BY_VERB.archive)).toEqual(new Set(ARCHIVE_REFUSAL_CODES));
  });

  it('workspaceEdge answers each archive wire word and throws on a word with no row', () => {
    for (const code of ARCHIVE_REFUSAL_CODES) expect(workspaceEdge('archive', code).status, code).toBe(409);
    expect(() => workspaceEdge('archive', 'nope' as never)).toThrow(/no archive edge/);
  });

  // COUNTED EXIT: refusal edges not answered from WORKSPACE_TRANSITIONS go to 0. The archive door is the one TS decider
  // of an edge (ccd's bash enforcement is the anti-corruption layer's and is pinned by the census); it must take each
  // refusal's code and status from the table, spelling neither.
  it('archiveDoor.ts takes every refusal from workspaceEdge: no literal status at a refuse() site', () => {
    expect(DOOR).toMatch(/workspaceEdge/);
    expect(DOOR).toMatch(/shared\/workspaceTransitions\.js/);
    expect(DOOR.match(/\brefuse\(\s*\d{3}\b/g) ?? []).toEqual([]);
  });
});
