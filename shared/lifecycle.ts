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
  // Session-continuity wave 4: the pane-scope sweep's verdict record. Rolling (R):
  // rewritten whole by rename every tick, so it holds only the scopes dead NOW;
  // it lives in the runtime dir, so a reboot empties it — the safe direction for
  // the first-seen clocks it keeps.
  { name: 'scope-sweep-verdicts', root: '$XDG_RUNTIME_DIR/ccd-scope-sweep.state', pattern: 'R',
    creators: ['ccd-scope-sweep'], collector: 'ccd-scope-sweep (rewritten whole each minute; emptied by a reboot)',
    bound: 'the scopes dead at the last tick', tier: 'one line per dead pane scope and per process older than a day in a live one',
    ruling: null },
  { name: 'project-pool-tag', root: '~/.cc-sessions/pools/<project>', pattern: 'O',
    creators: ['ccd project-pool', 'operator shell'], collector: null,
    bound: 'until cleared', tier: '<64 bytes per tagged project, one file per project',
    ruling: 'Operator intent on the record: persists until `ccd project-pool --project <p> --clear` or `rm`. A tag whose project directory and registry rows are both gone is inert — no lane reads it — and `ccrc doctor` lists it as WARN `pools-stale`.' },
  // ccrc history, W1-B1 (spec 2026-10-05 §9.4): six of the thirteen classes that table names; each later PR adds
  // its own (`lifecycle.test.ts`'s HISTORY_ROWS_BY_PR says which). The store is operator-collected (`prune`), the
  // spool and the migration snapshot are the sweep's, and the id, journal and switch files go only with the store.
  { name: 'history-store', root: '~/.ccrc/history/db/history.db{,-wal,-shm,-journal}, and the writer\'s temps history.db.new.<pid> (first creation) and .history.db.restore.<pid> (restore), each with its -wal, -shm and -journal, while one is written', pattern: 'O',
    creators: ['ccd/history/sweep.mjs (through store.mjs)'],
    collector: 'ccrc history prune (operator; dry run by default; tombstones content, never rows); a stale temp is removed, with its sidecars, by the pass that takes the lock, and is never opened',
    bound: 'until pruned; a temp until the next pass', tier: '~4-5.5 GB/month in W1, main JSONL plus sidecars (inferred); cap ~/.ccrc/history-max-gb, default 50; the free-space floor; a temp is one store size until the next pass', ruling: null },
  { name: 'history-migration-snapshot', root: '~/.ccrc/history/db/backups/pre-v<N>.db, its .tmp while one is written, and the attempt marker .pre-v<N>.attempt until the migration commits', pattern: 'R',
    creators: ['ccd/history/sweep.mjs'],
    collector: 'ccd-history-sweep (keeps the newest: an older pre-v*.db is removed once a newer one is renamed into place; a stale .tmp is removed before the next try; the marker is removed when its migration commits, or by any pass at version >= N)',
    bound: 'the newest snapshot', tier: 'one store size, from the first migration on; the marker <64 B', ruling: null },
  { name: 'history-store-id', root: '~/.ccrc/history/store.id, store.writer, store.id.pending while a binding is in flight, and op while an --op pass runs', pattern: 'O',
    creators: ['ccd/history/sweep.mjs'], collector: null, bound: 'store lifetime', tier: '<64 B each',
    ruling: 'kept with the store; removed only with it (the writer renames or removes a pending marker itself; an --op pass removes op on exit, and the next pass removes a dead pid\'s op)' },
  { name: 'history-spool', root: '~/.ccrc/history/spool/, with .draining/ holding each draining file and its .obs observation sidecar', pattern: 'R',
    creators: ['ccd/session-hook.sh', 'ccd/history/cli.mjs', 'ccd/history/sweep.mjs'],
    collector: 'ccd-history-sweep (two-phase drain; each drained file\'s lines and verdicts journaled and fsynced before it and its sidecar are unlinked; held, journaled once, while the DB cannot be written)',
    bound: 'one tick, or as long as a hold lasts', tier: '~0.6 MB/day if the sweep is down or holding (inferred); epoch lines only while capture is switched off; doctor FAILs a stale tick and every cause of a hold but a recovery step, which WARNs', ruling: null },
  { name: 'history-journal', root: '~/.ccrc/history/journal/<store_id>/<YYYY-MM>.<writer>.jsonl', pattern: 'O',
    creators: ['ccd/history/sweep.mjs'], collector: null, bound: 'store lifetime',
    tier: '~0.2-0.25 GB/year (inferred); one file per UTC month and writer, never rewritten; doctor WARNs journal-growth above 40 MB in a trailing 30 days',
    ruling: 'kept with the store; removed only with it (uninstall --purge --purge-history)' },
  { name: 'history-switches', root: '~/.ccrc/history-off, ~/.ccrc/history-max-gb', pattern: 'O',
    creators: ['operator shell'], collector: null, bound: 'until removed', tier: '<64 B each',
    ruling: 'touched by hand; persists until removed (no writer in the tree, pinned by single-definition.test.ts)' },
];
