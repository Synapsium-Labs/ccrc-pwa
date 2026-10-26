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
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { decideArchive, refusedAtStop, archiveOutcome, edgeStatus, type ArchiveMeasure } from '../src/coord/archiveDoor.js';
import { SENTENCES } from '../src/wsaudit.js';
import { parseFile } from './scan/parse.js';
import { EXPIRE_TOKEN_KIND, expireTokenKind, parseExpireResult } from '../src/archivedExpiry.js';
import { CHILD_RECLAIM_TOKEN_KIND, childReclaimTokenKind, isChildReclaimToken, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { COLLECT_REFUSAL_CLASS, COLLECT_REFUSAL_WORDS, collectRefusalClass } from '../src/collectLane.js';
import {
  WORKSPACE_TRANSITIONS, WORKSPACE_VERBS, WORKSPACE_STATES, WORKSPACE_REFUSALS_BY_VERB, isWorkspaceRefusal,
  isWorkspaceVerb, isWorkspaceState, workspaceEdge, WORKSPACE_POST_ACT_WORDS,
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
  e('restore', 'rowless', 'no-such-session', 'ccd', 'no registry row names the id'),
  // forget: a non-workspace row -> removed.
  e('forget', 'workspace', 'is-a-workspace', 'ccd', 'the row is a workspace, whose removal is audited and confirmed'),
  e('forget', 'held', 'held', 'ccd', 'a program holds the row'),
  e('forget', 'asleep', 'hibernated', 'ccd', 'the row is asleep, not gone'),
  e('forget', 'live', 'session-live', 'ccd', 'the session is still running'),
  e('forget', 'live', 'session-verdict-unknown', 'ccd', 'tmux did not answer, so liveness is unproven'),
  e('forget', 'rowless', 'no-such-session', 'ccd', 'no registry row names the id'),
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
  e('reap', 'archived', 'expire-in-progress', 'ccd', 'an interrupted expiry breadcrumb stands; reap never finishes it'),
  e('reap', 'archived', 'reaping-phase-unknown', 'ccd', 'a cleanup breadcrumb stands but cannot be read, so reap never takes its fresh arm over it'),
  e('reap', 'archived', 'child-branch-unmerged-locally', 'ccd', 'a nested checkout is merged at origin but not reachable from the project checkout, a probe that touches nothing'),
  e('reap', 'archived', 'branch-moved', 'ccd', 'the resumed cleanup has no tombstone tip, or the branch moved after it was pinned; nothing further is deleted'),
  // expire (ws-expire): archived -> retired after the seven-day window; it runs reclaim's ladder (`_ws_reclaim_ladder`).
  e('expire', 'live|stopped|asleep', 'not-archived', 'ccd', 'the workspace is not archived'),
  e('expire', 'archived', 'not-expired', 'ccd', 'archived less than seven days ago'),
  e('expire', 'archived', 'child', 'ccd', 'a run-created workspace is cleaned up when its run closes'),
  e('expire', 'archived', 'live', 'ccd', 'a pane or a service that would start one stands'),
  e('expire', 'archived', 'in-use', 'ccd', 'a process has its working directory inside the workspace'),
  e('expire', 'archived', 'in-progress', 'ccd', 'another cleanup holds the lock'),
  e('expire', 'rowless', 'no-such-session', 'ccd', 'no registry row names the id'),
  e('expire', 'main', 'not-a-workspace', 'ccd', 'the row is a main checkout'),
  e('expire', 'archived', 'branch-elsewhere', 'ccd', 'the branch is checked out somewhere else'),
  e('expire', 'archived', 'tree-unreadable', 'ccd', 'the worktree could not be read'),
  e('expire', 'archived', 'containment-unproven', 'ccd', 'the tree at the path is not proven the workspace’s own'),
  e('expire', 'archived', 'no-worktree-record', 'ccd', 'git has no worktree record for the directory'),
  e('expire', 'archived', 'paused', 'ccd', 'reclamation is paused fleet-wide'),
  e('expire', 'archived', 'held', 'ccd', 'a program holds the workspace'),
  e('expire', 'archived', 'attached', 'ccd', 'a terminal is attached'),
  e('expire', 'archived', 'tree-busy', 'ccd', 'a git operation or an index lock stands in the tree'),
  e('expire', 'archived', 'state-changed', 'ccd', 'the workspace changed since the audit the token fingerprints'),
  e('expire', 'archived', 'reap-in-progress', 'ccd', 'an interrupted reap breadcrumb stands; expiry never finishes it'),
  e('expire', 'archived', 'reclaim-in-progress', 'ccd', 'an interrupted reclaim breadcrumb stands; expiry never finishes it'),
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
  e('reclaim', 'live|asleep', 'branch-elsewhere', 'ccd', 'the branch is checked out somewhere else'),
  e('reclaim', 'live|asleep', 'tree-unreadable', 'ccd', 'the worktree could not be read'),
  e('reclaim', 'live|asleep', 'no-worktree-record', 'ccd', 'git has no worktree record for the directory'),
  e('reclaim', 'live|asleep', 'state-changed', 'ccd', 'the child changed since the audit the token fingerprints'),
  // collect (ws-collect): a rowless, witnessed temp root -> quarantined.
  e('collect', 'rowless', 'not-witnessed', 'ccd', 'no witness and no quarantine record names the id'),
  e('collect', 'rowless', 'registered', 'ccd', 'a registry row or what one left behind still stands'),
  e('collect', 'rowless', 'changed-recently', 'ccd', 'the newest change is younger than the idle floor'),
  e('collect', 'rowless', 'witness-mismatch', 'ccd', 'the directory is not the one its witness names'),
  e('collect', 'rowless', 'quarantine-kept', 'ccd', 'a quarantine record or slot cannot be read, proved or cleared'),
  e('collect', 'rowless', 'containment-unproven', 'ccd', 'the temp root is not proven the witnessed directory’s own'),
  e('collect', 'rowless', 'state-changed', 'ccd', 'the temp root changed since the audit the token fingerprints'),
  e('collect', 'rowless', 'in-use', 'ccd', 'a process has its working directory inside the temp root'),
  e('collect', 'rowless', 'in-progress', 'ccd', 'another collection holds the lock'),
  e('collect', 'rowless', 'paused', 'ccd', 'collection is paused fleet-wide'),
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
    expect(counts).toEqual({ archive: 7, restore: 4, forget: 6, reap: 43, expire: 19, reclaim: 15, collect: 10 });
    expect(WORKSPACE_REFUSAL_CENSUS.length).toBe(104);
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

  // Completeness (ARCH-41 fix round): ccd's emitted words reach clients through two vocabularies, `SENTENCES` and
  // `LC_REFUSAL_WORD`. Every key of both is a census code or is named here, with the reason it is not a workspace-state
  // edge. A new ccd refusal word therefore turns this red until it is a census edge or an explicit exclusion.
  const EXCLUDED: Readonly<Record<string, string>> = {
    // ws-rename's tokens: a rename is not a lifecycle verb of this table.
    'registry-branch-drift': 'ws-rename', 'worktree-unregistered': 'ws-rename', 'worktree-foreign': 'ws-rename',
    'detached': 'ws-rename', 'unchanged': 'ws-rename', 'has-upstream': 'ws-rename', 'bad-branch': 'ws-rename',
    'name-taken-local': 'ws-rename', 'name-taken-origin': 'ws-rename',
    // post-act tail failures: they report an act that began, not a refusal that touched nothing.
    'tombstone-unwritable': 'post-act', 'worktree-remove-failed': 'post-act',
    'nested-rescue-too-large': 'post-act', 'nested-rescue-failed': 'post-act',
    // the reap-interrupted verdict, and copy for a rung ccd no longer emits.
    'reap-interrupted': 'verdict', 'not-merged': 'copy-only, ccd emits no-bound-pr',
    // flag parsing and route-shape words: no state of the workspace causes them.
    'bad-args': 'flag-parsing', 'bad-session-id': 'route-shape',
    // the lifecycle journal's operational words (an act that failed, not a precondition of state).
    'scratch-unwritable': 'journal', 'tip-unreadable': 'journal', 'flock-unavailable': 'journal', 'lock-unopenable': 'journal',
    'spawn-failed': 'journal', 'purge-refused': 'journal', 'purge-incomplete': 'journal', 'purge-mechanism-absent': 'journal',
    'pin-failed': 'journal', 'unit-still-active': 'journal', 'branch-unmeasured': 'journal', 'probe-unmeasured': 'journal',
    'token-malformed': 'journal', 'run-id-malformed': 'journal', 'containment-refuted': 'journal',
  };
  it('every client-read word is a census code or on the named exclusion list (a new ccd refusal turns this red)', () => {
    const codes = new Set(WORKSPACE_REFUSAL_CENSUS.map((x) => x.code));
    const unaccounted = [...Object.keys(SENTENCES), ...Object.keys(LC_REFUSAL_WORD)].filter((k) => !codes.has(k) && !(k in EXCLUDED));
    expect(unaccounted).toEqual([]);
    for (const k of Object.keys(EXCLUDED)) expect(codes.has(k), `${k} is both a census edge and excluded`).toBe(false);
    for (const k of Object.keys(EXCLUDED)) expect(k in SENTENCES || k in LC_REFUSAL_WORD, `${k} is stale`).toBe(true);
  });

  // Per verb, not just per word (ARCH-41 fix round 3): each verb's census codes equal the words that verb's own ccd-pinned
  // set holds, less the named exclusions. Expire, reclaim and collect: the lane sets the server already holds equal to
  // ccd's text in both directions (`archived-expiry-policy.test.ts`, `child-reclaim.test.ts`, `collect-readers.test.ts`),
  // less WORKSPACE_POST_ACT_WORDS. Restore, forget and reap have no server set, so their words are harvested from ccd's
  // own refusal sites here, less EXCLUDED. A word one verb emits and another does not is therefore pinned to the verb.
  const censusOf = (v: Verb): string[] => [...new Set(WORKSPACE_REFUSAL_CENSUS.filter((x) => x.verb === v).map((x) => x.code))].sort();
  const less = (ws: Iterable<string>, out: readonly string[]): string[] => [...new Set([...ws].filter((w) => !out.includes(w)))].sort();
  it('expire, reclaim and collect: each verb’s codes equal its lane set, less the post-act words', () => {
    expect(WORKSPACE_POST_ACT_WORDS.every((w) => EXCLUDED[w] === 'post-act'), 'a post-act word is an EXCLUDED post-act word').toBe(true);
    expect(censusOf('expire')).toEqual(less(Object.keys(EXPIRE_TOKEN_KIND), WORKSPACE_POST_ACT_WORDS));
    expect(censusOf('reclaim')).toEqual(less(Object.keys(CHILD_RECLAIM_TOKEN_KIND), WORKSPACE_POST_ACT_WORDS));
    expect(censusOf('collect')).toEqual(less(COLLECT_REFUSAL_WORDS, WORKSPACE_POST_ACT_WORDS));
  });

  const nonComment = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const bodyOf = (name: string): string => {
    const from = CCD.indexOf(`\n${name}() {`);
    expect(from, `${name} is in ccd`).toBeGreaterThan(-1);
    return nonComment(CCD.slice(from, CCD.indexOf('\n}\n', from)));
  };
  const lcRefused = (t: string, act: string): string[] =>
    [...t.matchAll(new RegExp(`_lc_refuse ${act} (?:"[^"]*"|\\S+) ([a-z][a-z-]*)`, 'g'))].map((m) => m[1]!);
  const excluded = Object.keys(EXCLUDED);
  it('restore and forget: each verb’s codes equal what its ccd verb refuses with, less EXCLUDED', () => {
    const restore = lcRefused(bodyOf('cmd_ws_restore'), 'restore');
    const forget = lcRefused(bodyOf('cmd_forget'), 'forget');
    expect(restore.length, 'guards the guard: an empty harvest').toBeGreaterThan(5);
    expect(forget.length, 'guards the guard: an empty harvest').toBeGreaterThan(5);
    expect(censusOf('restore')).toEqual(less(restore, excluded));
    expect(censusOf('forget')).toEqual(less(forget, excluded));
  });
  it('reap: its codes equal what ws-reap and ws-rm refuse with, less EXCLUDED', () => {
    const from = CCD.indexOf('\ncmd_ws_reap() {');
    const span = nonComment(CCD.slice(from, CCD.indexOf('\n# ── reclamation ──', from)));
    const mirror = nonComment(CCD.slice(CCD.indexOf('MIRROR-BEGIN'), CCD.indexOf('MIRROR-END')));
    expect(from).toBeGreaterThan(-1);
    expect(mirror.length).toBeGreaterThan(0);
    const harvested = [
      ...[...bodyOf('_ws_reap_eval').matchAll(/_reap_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!),
      ...[...(span + mirror).matchAll(/"refused":"([a-z][a-z-]*)"/g)].map((m) => m[1]!),
      ...lcRefused(nonComment(CCD), 'reap'),
      ...lcRefused(bodyOf('cmd_ws_rm'), '[a-z]+'),
    ];
    expect(new Set(harvested).size, 'guards the guard: an empty harvest').toBeGreaterThan(30);
    expect(censusOf('reap')).toEqual(less(harvested, excluded));
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
    for (const code of ARCHIVE_REFUSAL_CODES) expect(workspaceEdge('archive', code).refusal, code).toBe(code);
    for (const t of WORKSPACE_TRANSITIONS) expect('status' in t, t.refusal).toBe(false);
    expect(() => workspaceEdge('archive', 'nope' as never)).toThrow(/no archive edge/);
    // The door's status reads the table: a word with no row is never sent (deleting the table read turns this red).
    expect(() => edgeStatus('nope' as never)).toThrow(/no archive edge/);
    for (const code of ARCHIVE_REFUSAL_CODES) expect(edgeStatus(code), code).toBe(REFUSAL_STATUS[code]);
    expect(isWorkspaceRefusal('reap', 'expire-in-progress')).toBe(true);
  });

  // COUNTED EXIT: refusal edges not answered from WORKSPACE_TRANSITIONS go to 0, and the status of each is
  // REFUSAL_STATUS's (ARCH-36), declared once. Asserted behaviourally: every refusal the door can send, through all three
  // functions that send one, carries REFUSAL_STATUS[word]; and no numeric status literal is left beside a refusal word.
  it('archiveDoor.ts answers every refusal from the table and REFUSAL_STATUS, through all three senders', async () => {
    const m = (o: Partial<ArchiveMeasure>): ArchiveMeasure => ({ workspace: true, turn: 'idle', worktree: 'present', verbSupported: true, ...o });
    const flags = { force: false, interrupt: false, programmeEnd: false };
    const idle = { ok: true as const, siblings: [] };
    const open = { ok: true as const, siblings: [{ id: 1 } as never] };
    const port = (o: object) => ({ openRunsForSession: () => idle, openRunsClaimedBy: () => idle, abandonRefusal: () => null, abandon: async () => ({ ok: true }) as never, ...o });
    const decided = [
      await decideArchive(null, 's', flags, m({ turn: 'unmeasured' })),
      await decideArchive(null, 's', flags, m({ turn: 'busy' })),
      await decideArchive(null, 's', flags, m({ worktree: 'absent' })),
      await decideArchive(port({ openRunsForSession: () => open }), 's', flags, m({})),
      await decideArchive(port({ openRunsClaimedBy: () => open }), 's', flags, m({})),
      await decideArchive(port({ openRunsClaimedBy: () => open, abandonRefusal: () => ({ ok: false, kind: 'x' }) as never }), 's', { ...flags, programmeEnd: true }, m({})),
    ];
    expect(decided.map((d) => !d.ok && d.reply.body.error)).toEqual(
      ['status-unknown', 'session-busy', 'worktree-gone', 'run-open', 'coordinator-has-open-runs', 'programme-partly-ended']);
    for (const d of decided) if (!d.ok) expect(d.reply.status, String(d.reply.body.error)).toBe(REFUSAL_STATUS[d.reply.body.error as keyof typeof REFUSAL_STATUS]);
    for (const v of ['busy', 'unmeasured'] as const) {
      const r = refusedAtStop(v, []);
      expect(r.status).toBe(REFUSAL_STATUS[r.body.error as keyof typeof REFUSAL_STATUS]);
    }
    const stderrs = ['ccd: session-busy', 'ccd: status-unknown', 'ccd: worktree is gone: /w', 'ccd: empty archive manifest for s — nothing was touched'];
    const words = stderrs.map((stderr) => archiveOutcome(false, [], { ok: false, stderr, ran: true }));
    expect(words.map((r) => r.body.error)).toEqual(['session-busy', 'status-unknown', 'worktree-gone', 'manifest-unbuildable']);
    for (const r of words) expect(r.status, String(r.body.error)).toBe(REFUSAL_STATUS[r.body.error as keyof typeof REFUSAL_STATUS]);
    const door = parseFile(path.join(ROOT, 'server/src/coord/archiveDoor.ts'));
    const fromTable = door.imports.filter((i) => /shared\/workspaceTransitions\.js$/.test(i.specifier)).flatMap((i) => i.names);
    expect(fromTable).toContain('workspaceEdge');
    // `reply(` is called twice and only twice: inside `refuseEdge` (whose status is `edgeStatus`, the table read) and inside
    // `unsupported` (a route-shape word). A refusal branch that calls `reply` itself bypasses the table, and turns this red.
    expect([...DOOR.matchAll(/\breply\(([^,]*),/g)].map((x) => x[1])).toEqual(['edgeStatus(code)', '501']);
    // The only numeric statuses left: 200 (success and the partial outcome), 501 (`unsupported()`, a route-shape word) and 502.
    expect([...DOOR.matchAll(/\b(?:refuse|reply)\(\s*\d{3}\b|\bstatus:\s*\d{3}\b/g)].map((x) => x[0].replace(/\s+/g, ''))).toEqual(
      ['reply(501', 'status:200', 'status:200', 'status:502']);
  });
});

// ── Characterization of the three TS lanes that read these refusals (ARCH-41 fix round 3), green on the old code. ────
// `archivedExpiry.ts`, `coord/childReclaim.ts` and `collectLane.ts` each classify a ccd refusal word and narrow it to a
// known word. This pins today's answers, word for word, so moving their vocabularies onto WORKSPACE_TRANSITIONS is
// provably behaviour-identical.
describe('the expire, reclaim and collect lanes read refusals as they do today (characterization)', () => {
  const PROBES = ['toString', '__proto__', 'nope', 'dirty-tree', 'expire-in-progress', 'not-witnessed', 'not-idle', ''];
  const EXPIRE_KINDS = {
    'no-such-session': 'gone', 'not-archived': 'gone', 'not-a-workspace': 'terminal', 'branch-elsewhere': 'terminal',
    'tree-unreadable': 'terminal', 'containment-unproven': 'terminal', 'no-worktree-record': 'terminal',
    'not-expired': 'retry', child: 'retry', paused: 'retry', held: 'retry', attached: 'retry', live: 'retry',
    'in-use': 'retry', 'tree-busy': 'retry', 'state-changed': 'retry', 'in-progress': 'retry',
    'reap-in-progress': 'retry', 'reclaim-in-progress': 'retry', 'nested-rescue-too-large': 'terminal',
    'nested-rescue-failed': 'retry',
  };
  const RECLAIM_KINDS = {
    'no-such-session': 'gone', 'not-a-workspace': 'terminal', 'not-a-child': 'terminal', 'branch-elsewhere': 'terminal',
    'tree-unreadable': 'terminal', 'containment-unproven': 'terminal', 'no-worktree-record': 'terminal',
    paused: 'retry', held: 'retry', attached: 'retry', 'tree-busy': 'retry', 'state-changed': 'retry',
    'in-progress': 'retry', 'reap-in-progress': 'retry', 'nested-rescue-too-large': 'terminal',
    'nested-rescue-failed': 'retry', 'not-idle': 'retry',
  };
  const COLLECT_CLASSES = {
    'witness-mismatch': 'terminal', 'quarantine-kept': 'terminal', 'containment-unproven': 'terminal',
    'not-witnessed': 'retry', registered: 'retry', 'changed-recently': 'retry',
    'state-changed': 'retry', 'in-use': 'retry', 'in-progress': 'retry', paused: 'retry',
  };
  const refusedDoc = (w: string): string => JSON.stringify({ refused: w, detail: 'd' });

  it('expire: every word’s kind, and the result parser narrows exactly those words', () => {
    expect(EXPIRE_TOKEN_KIND).toEqual(EXPIRE_KINDS);
    for (const [w, k] of Object.entries(EXPIRE_KINDS)) {
      expect(expireTokenKind(w), w).toBe(k);
      expect(parseExpireResult('s', refusedDoc(w), ''), w).toEqual({ kind: 'refused', token: w, detail: 'd' });
    }
    for (const w of PROBES.filter((p) => !(p in EXPIRE_KINDS))) {
      expect(expireTokenKind(w), w).toBeNull();
      expect(parseExpireResult('s', refusedDoc(w), '').kind, w).toBe('failed');
    }
  });

  it('reclaim: every word’s kind, and the guard and result parser narrow exactly those words', () => {
    expect(CHILD_RECLAIM_TOKEN_KIND).toEqual(RECLAIM_KINDS);
    for (const [w, k] of Object.entries(RECLAIM_KINDS)) {
      expect(childReclaimTokenKind(w), w).toBe(k);
      expect(isChildReclaimToken(w), w).toBe(true);
      expect(parseChildReclaimResult('s', refusedDoc(w), ''), w).toEqual({ kind: 'refused', token: w, detail: 'd' });
    }
    for (const w of PROBES.filter((p) => !(p in RECLAIM_KINDS))) {
      expect(childReclaimTokenKind(w), w).toBeNull();
      expect(isChildReclaimToken(w), w).toBe(false);
      expect(parseChildReclaimResult('s', refusedDoc(w), '').kind, w).toBe('failed');
    }
  });

  it('collect: every word’s class in its order, and an unknown word is a retry', () => {
    expect(COLLECT_REFUSAL_CLASS).toEqual(COLLECT_CLASSES);
    expect(COLLECT_REFUSAL_WORDS).toEqual(Object.keys(COLLECT_CLASSES));
    for (const [w, c] of Object.entries(COLLECT_CLASSES)) expect(collectRefusalClass(w), w).toBe(c);
    for (const w of PROBES.filter((p) => !(p in COLLECT_CLASSES))) expect(collectRefusalClass(w), w).toBe('retry');
  });
});

// ── COUNTED EXIT (ARCH-41, #776): refusal edges a TS reader answers other than from WORKSPACE_TRANSITIONS: 0. ─────────
// The four TS deciders that read workspace-verb refusals each type their words from the table (`WorkspaceRefusal<verb>`,
// with `WorkspacePostActWord` beside it on the two lanes whose act prints one) and narrow them through
// `isWorkspaceRefusal`, so a word the table lacks does not compile there and is not narrowed at run time. The archive
// door reads its edge through `workspaceEdge` (above). ccd's edges stay enforced in bash, which cannot read a TS table:
// those are held to ccd's text per verb by the census above, not answered from the table.
describe('counted exit: every TS reader of a workspace refusal answers from WORKSPACE_TRANSITIONS', () => {
  const LANES = [
    { file: 'server/src/archivedExpiry.ts', verb: 'expire', keys: Object.keys(EXPIRE_TOKEN_KIND), postAct: true,
      narrows: (w: string) => expireTokenKind(w) !== null },
    { file: 'server/src/coord/childReclaim.ts', verb: 'reclaim', keys: Object.keys(CHILD_RECLAIM_TOKEN_KIND), postAct: true,
      narrows: (w: string) => isChildReclaimToken(w) },
    { file: 'server/src/collectLane.ts', verb: 'collect', keys: [...COLLECT_REFUSAL_WORDS], postAct: false,
      narrows: (w: string) => Object.prototype.hasOwnProperty.call(COLLECT_REFUSAL_CLASS, w) },
  ] as const;
  const ALL_WORDS = [...new Set([...WORKSPACE_TRANSITIONS.map((t) => t.refusal), ...Object.keys(SENTENCES),
    ...Object.keys(LC_REFUSAL_WORD), 'toString', '__proto__', 'nope'])];

  it('each lane imports its words and its guard from the table', () => {
    for (const l of LANES) {
      const names = parseFile(path.join(ROOT, l.file)).imports
        .filter((i) => /shared\/workspaceTransitions\.js$/.test(i.specifier)).flatMap((i) => i.names);
      expect(names, l.file).toEqual(expect.arrayContaining(['isWorkspaceRefusal', 'WorkspaceRefusal']));
      if (l.postAct) expect(names, l.file).toEqual(expect.arrayContaining(['isWorkspacePostActWord', 'WorkspacePostActWord']));
    }
  });

  it('counts 0 edges not answered from the table: each lane knows exactly its verb’s rows (plus the post-act words)', () => {
    let unanswered = 0;
    for (const l of LANES) {
      const want = new Set<string>([...WORKSPACE_REFUSALS_BY_VERB[l.verb], ...(l.postAct ? WORKSPACE_POST_ACT_WORDS : [])]);
      unanswered += l.keys.filter((k) => !want.has(k)).length + [...want].filter((w) => !(l.keys as readonly string[]).includes(w)).length;
      // At run time too: the lane narrows a word iff the table (or the post-act list) holds it for the verb.
      const narrowed = ALL_WORDS.filter((w) => l.narrows(w));
      expect(narrowed.sort(), l.file).toEqual([...want].sort());
    }
    expect(unanswered).toBe(0);
  });
});
