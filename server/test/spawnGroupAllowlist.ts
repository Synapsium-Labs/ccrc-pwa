// The timed spawns `spawn-group-pin.test.ts` still lets bypass `spawnSyncGroup` (#896). A row is one file's timed
// `spawnSync`/`execFileSync` calls of one command (its source text, as `spawnGroupScan.ts` reads it), and `count`
// is how many there are. The pin holds the tree to this list EXACTLY: a new timed spawn of a shell or a script is
// red until it goes through `spawnSyncGroup`, and a converted one is red until its row is lowered or removed.
//
// THIS LIST MAY ONLY SHRINK. Lower or delete a row when its spawns move to `spawnSyncGroup`; never add a row or raise
// a count. A row with `keep` is a command verified not to fork, with the reason; a row without one is still to convert.
export interface AllowedTimedSpawn {
  /** Relative to server/test. */
  file: string;
  /** The command argument's source text. */
  command: string;
  count: number;
  /** Why this command may stay a plain timed spawn: it does not fork. Absent while the row is still to convert. */
  keep?: string;
}

export const SPAWN_GROUP_ALLOWLIST: readonly AllowedTimedSpawn[] = [
// ROWS
  { file: 'authAttemptFixture.ts', command: 'BASH', count: 2 },
  { file: 'ccd-account-auth.test.ts', command: "'bash'", count: 6 },
  { file: 'ccd-child-reclaim-entry.test.ts', command: "'bash'", count: 1 },
  { file: 'ccd-child-reclaim-entry.test.ts', command: 'o.entry ?? de.entry', count: 1 },
  { file: 'ccd-lifecycle-emit.test.ts', command: "'bash'", count: 1 },
  { file: 'ccd-project-pool.test.ts', command: "'bash'", count: 1 },
  { file: 'ccd-scratch-rescue-reach.test.ts', command: 'file', count: 1 },
  { file: 'ccd-workspaces.test.ts', command: "'bash'", count: 2 },
  { file: 'ccd-ws-collect-reach.test.ts', command: 'file', count: 1 },
  { file: 'ccd-ws-shed-deps-reach.test.ts', command: 'file', count: 1 },
  { file: 'ccdDocsHelpers.ts', command: "'bash'", count: 2 },
  { file: 'ccdLandProbeFixture.ts', command: "'bash'", count: 2 },
  { file: 'ccdTickDietRunner.ts', command: "'bash'", count: 1 },
  { file: 'ccgpt-runtime.test.ts', command: 'py', count: 2 },
  { file: 'ccgptHarness.ts', command: 'py', count: 1 },
  { file: 'ccrc-account-lock.test.ts', command: 'BASH', count: 1 },
  { file: 'ccrc-cli.test.ts', command: "'bash'", count: 1 },
  { file: 'ccrc-codex-bridge.test.ts', command: 'BASH', count: 2 },
  { file: 'ccrc-codex-launcher.test.ts', command: 'o.file ?? launcher()', count: 1 },
  { file: 'ccrc-codex-lifecycle.test.ts', command: 'BASH', count: 3 },
  { file: 'ccrc-codex.test.ts', command: 'BASH', count: 1 },
  { file: 'ccrc-containment.test.ts', command: "'/bin/sh'", count: 1 },
  { file: 'ccrc-darwin-job-helpers.test.ts', command: 'BASH', count: 2 },
  { file: 'ccrc-doctor-carry-copies.test.ts', command: 'BASH', count: 1 },
  { file: 'ccrc-doctor-codex.test.ts', command: 'BASH', count: 1 },
  { file: 'ccrc-doctor-core.test.ts', command: 'BASH', count: 1 },
  { file: 'ccrc-models-advance.test.ts', command: 'BASH', count: 1 },
  { file: 'ccrc-models-lock.test.ts', command: 'BASH', count: 2 },
  { file: 'ccrc-test-wrapper.test.ts', command: "'bash'", count: 4 },
  { file: 'ccrc-update-fetch.test.ts', command: 'BASH', count: 2 },
  { file: 'ccrc-update-flip-backups.test.ts', command: 'BASH', count: 1 },
  { file: 'ccrc-update-kept.test.ts', command: 'BASH', count: 1 },
  { file: 'ccrc-update-phases.test.ts', command: 'BASH', count: 2 },
  { file: 'ccrc-versions-warn-arms.test.ts', command: 'BASH', count: 2 },
  { file: 'ccrc-wrappers.test.ts', command: "'bash'", count: 1 },
  { file: 'ccrcCodexFixture.ts', command: 'BASH', count: 2 },
  { file: 'ci-pipeline.test.ts', command: "real('bash')", count: 3 },
  { file: 'coordinator-landing-verdict.test.ts', command: "'bash'", count: 1 },
  { file: 'delegation-rig.test.ts', command: "'bash'", count: 13 },
  { file: 'delegation-rig.test.ts', command: "path.join(bin, 'bash')", count: 1 },
  { file: 'delegation-spool.test.ts', command: "'bash'", count: 4 },
  { file: 'delegation-wave3.integration.test.ts', command: "'bash'", count: 1 },
  { file: 'doctor-cadence.test.ts', command: 'BASH', count: 3 },
  { file: 'graph-build.test.ts', command: 'driver', count: 1 },
  { file: 'graph-build.test.ts', command: "o.python ?? 'python3'", count: 1 },
  { file: 'graph-knobs.test.ts', command: "'bash'", count: 3 },
  { file: 'graph-migrate.test.ts', command: "'bash'", count: 1 },
  { file: 'graph-repo-sweep.test.ts', command: "'bash'", count: 1 },
  { file: 'graph-resolve.test.ts', command: "'bash'", count: 1 },
  { file: 'history-maint.test.ts', command: "'bash'", count: 1 },
  { file: 'history-recall.test.ts', command: "'bash'", count: 1 },
  { file: 'history-replay.test.ts', command: "'/usr/bin/prlimit'", count: 4, keep: 'prlimit execs node in place, on a script that starts no child' },
  { file: 'historyHelpers.ts', command: "'bash'", count: 1 },
  { file: 'install-sh.test.ts', command: 'BASH', count: 1 },
  { file: 'macos-platform.test.ts', command: "'bash'", count: 2 },
  { file: 'notify-push.test.ts', command: 'BASH', count: 1 },
  { file: 'pane-busy-corpus.test.ts', command: "'bash'", count: 1 },
  { file: 'paneScopeFixture.ts', command: "'bash'", count: 1 },
  { file: 'platform-hazards.test.ts', command: "'bash'", count: 2 },
  { file: 'pool-tag-parity.test.ts', command: "'bash'", count: 1 },
  { file: 'run-tmp.test.ts', command: "'unshare'", count: 1 },
  { file: 'scope-sweep.test.ts', command: "'bash'", count: 2 },
  { file: 'script-shim-platform.test.ts', command: "'bash'", count: 1 },
  { file: 'session-hook-append-race.test.ts', command: "'bash'", count: 1 },
  { file: 'session-hook-approval-wait.test.ts', command: "'bash'", count: 2 },
  { file: 'session-hook-turnmark.test.ts', command: "'bash'", count: 2 },
  { file: 'session-hook.test.ts', command: "'bash'", count: 8 },
  { file: 'sweepFixture.ts', command: 'BASH', count: 2 },
  { file: 'testbox-knobs.test.ts', command: "'bash'", count: 4 },
  { file: 'testbox-pins.test.ts', command: "'bash'", count: 1 },
  { file: 'testbox-wrapper.test.ts', command: "'bash'", count: 1 },
  { file: 'tmp-sweep-live.test.ts', command: "'bash'", count: 1 },
  { file: 'tmp-sweep-output-cap.test.ts', command: "'bash'", count: 1 },
  { file: 'tmp-sweep-test-runs.test.ts', command: "'bash'", count: 1 },
  { file: 'update-resolve.test.ts', command: "'bash'", count: 1 },
  { file: 'update-semver.test.ts', command: "'bash'", count: 3 },
  { file: 'update-spawn.test.ts', command: 'file', count: 1 },
  { file: 'update-states.test.ts', command: "'bash'", count: 1 },
];
