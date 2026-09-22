// L0. The artifact-lifecycle policy's §4(a) machine-readable manifest
// (docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md) — first
// created for the graphify classes (spec §7); other artifact classes join as
// they are declared. Imports NOTHING: the PWA bundles shared/*.ts.
export interface LifecycleClass {
  readonly name: string;
  readonly root: string;          // path pattern, $HOME-relative or per-tree
  readonly pattern: 'W' | 'S' | 'P' | 'R' | 'X' | 'E' | 'O';
  readonly creators: readonly string[];
  readonly collector: string | null;   // null REQUIRES `ruling`
  readonly bound: string;
  readonly tier: string;               // affordability note, measured
  readonly ruling: string | null;      // operator sentence when collector is null
}

export const LIFECYCLE: readonly LifecycleClass[] = [
  { name: 'workspace-graph-store', root: '<workdir>/graphify-out/', pattern: 'W',
    creators: ['ccd-graph-sweep'],
    collector: 'git worktree remove via cmd_ws_rm / reap tail / ws-gc orphan arm (ccd:4225-4232, :9298, :9989)',
    bound: 'workspace lifetime', tier: '~11 MB/tree measured (ccrc, 763 files)', ruling: null },
  { name: 'project-graph-store', root: '<projects-root>/<repo>/graphify-out/', pattern: 'O',
    creators: ['ccd-graph-sweep'], collector: null, bound: 'repo lifetime',
    tier: '~11 MB/repo, AST-only, backups disabled',
    ruling: '~11 MB per repo, AST-only, backups disabled, regenerable at any time; persists for the repo\'s lifetime; reclaim manually (rm -rf <repo>/graphify-out) if ever needed.' },
  { name: 'graph-corpus-filter', root: '<tree>/.graphifyignore', pattern: 'E',
    creators: ['ccd-graph-sweep'], collector: 'ccd-graph-sweep (trap EXIT INT TERM + stray sweep)',
    bound: 'one build', tier: '<1 KB', ruling: null },
  { name: 'graph-build-lock', root: '<tree>/graphify-out/.rebuild.lock', pattern: 'E',
    creators: ['graphify'], collector: 'graphify', bound: 'one build', tier: 'negligible', ruling: null },
  { name: 'graph-sweep-census', root: '~/.ccrc/graph-sweep.json', pattern: 'R',
    creators: ['ccd-graph-sweep'], collector: 'ccd-graph-sweep (last 10 passes kept)',
    bound: 'rolling', tier: 'bounded by pass count', ruling: null },
  // Policy row #9: "a root we declare to agents in their own system prompt and
  // then never collect". Session-bound (S), collected by age PLUS the absence of
  // a live owner — the live-session, open-fd and newest-mtime checks the
  // collector's own header states.
  { name: 'claude-tmp-session-dirs', root: '${TMPDIR:-/tmp}/claude-<uid>/<project>/<session-uuid>/ + loose top-level entries', pattern: 'S',
    creators: ['claude (Claude Code: scratchpad, background-task output)', 'agents writing into the root'],
    collector: 'ccd-tmp-sweep (hourly; not live, not in use, nothing newer than CCD_TMP_SWEEP_MAX_AGE_DAYS=7)',
    bound: 'session lifetime + 7 days', tier: '138G uncollected on the fleet host 2026-09-22; single task .output files 1-4G', ruling: null },
  { name: 'project-pool-tag', root: '~/.cc-sessions/pools/<project>', pattern: 'O',
    creators: ['ccd project-pool', 'operator shell'], collector: null,
    bound: 'until cleared', tier: '<64 bytes per tagged project, one file per project',
    ruling: 'Operator intent on the record: persists until `ccd project-pool --project <p> --clear` or `rm`. A tag whose project directory and registry rows are both gone is inert — no lane reads it — and `ccrc doctor` lists it as WARN `pools-stale`.' },
];
