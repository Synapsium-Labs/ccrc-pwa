# Backup health in the UI

**Goal:** the fleet box's backup health is visible in the console. A failed or stale backup shows a banner within one
fleet-health cycle at every width in both skins; a healthy backup and a box without backups show none. Settings ›
Automation carries a quiet line for every status.

**Model:** the disk block (#1251, D-6615) and the host-pressure block (#1170): an L0 vocabulary in `shared/`, an agent
op that reads and decides nothing, a `FleetIO` member with a local and a remote adapter, a lane on the watcher's tick,
an optional block on `GET /api/fleet/health`, and a banner in the one banner stack.

## What ships

1. `shared/backup.ts` (L0, imports nothing): the five state files (`last-success`, `last-failure`, `last-skip`,
   `last-warning`, `stale`), the line parser (`<ISO>Z k=v ... words`, unknown keys kept and ignored, the other words
   the note), the agent's reply (`BackupRead`), the pure decider `backupVerdict` and the wire block `BackupHealth`,
   each with its one reader (`readBackupRead`, `readBackupHealth`), and `backupStaleHoursOf`.
2. The agent's `backup` op (`agent/src/backup.ts`): no argument, the directory from `CCRC_BACKUP_STATE_DIR` in the
   agent's environment, every read bounded (`O_NONBLOCK`, `O_NOFOLLOW`, regular files only, 4096 bytes, first line).
   Advertised in `ready.ops`; an older agent is never sent it.
3. `FleetIO.backupMeasured` (local: the same body over the server's environment; remote: the op), `BackupLane` (one read
   a minute, judged when the block is read, so staleness advances between reads), and the optional `backup` block on
   `/api/fleet/health` in both modes. The other blocks and their wire shapes are unchanged.
4. PWA: `BackupBanner` in the banner stack (rank 3.5, after the disk alarm), shown only for `failed` or `stale`; the
   Backups card in Settings › Automation, before Test box, reading the shell's one health poll.
5. Settings: `CCRC_BACKUP_STALE_HOURS` (server, default 36) in `deploy/ccrc.env.example`; `CCRC_BACKUP_STATE_DIR` in
   `deploy/ccrc-agent.env.example` (a fleet box) and in `deploy/ccrc.env.example` (a local-mode server only).

## Box step (the operator's infra, not this change)

Make the state files readable by the fleet user, then set `CCRC_BACKUP_STATE_DIR` in the fleet box's
`~/.ccrc/agent.env` and restart the agent. Until then the console says "Backups not configured" (unset) or "Backup
status unreadable" (set, not yet readable), never an alarm.

## Deviations found

- **D-7858 (2026-11-03)** — Backup health on /api/fleet/health: the backup op, the decider and the block. Precedence
  stale > failed > warning > ok. Stale is the job's own marker newer than the last success, no success at all, or a
  last success older than `CCRC_BACKUP_STALE_HOURS`; a marker older than the last success is the marker job's lag and is
  ignored. A present file in no known shape, a missing directory and a relative setting are `unreadable` (each with
  its word), never `ok` and never an absent file. Known limit, measured on a real job: a job that writes its warning
  line before its success line in the same run (a warning is written mid-run, the success at exit) reads `ok`, because
  the warning is not newer than the success; the block still carries `lastWarning`. The job writing its warning after
  its success, or stamping the success line, would make the warning visible; that is the job's change, not ccrc's.
- **D-7859 (2026-11-03)** — Backup state directory read from the reading process's environment, not the bash settings
  reader. The triage spec asked for both settings through `ccd/ccrc`'s one `ccrc.env` reader (`_ccrc_knob`). Nothing in
  bash reads either value: the files are read by the agent on a fleet box, whose unit reads `agent.env` and no
  `ccrc.env`, and the only route from the agent to `_ccrc_knob` is a fixed spawn of the launcher, which would be a fifth
  wire-triggered spawn class outside the exec whitelist, for two read-only values. So the directory follows the disk
  op's `CCRC_WORK_MOUNTS` rule (the reading process's own environment: `agent.env` on a fleet box, `ccrc.env` for a
  local-mode server), and the staleness, which only the server's decider reads, is read by `loadConfig` from the
  server's `ccrc.env`. Both are documented in the example files; the settings census (`ccrc-settings-census.test.ts`)
  covers names `ccd/ccrc` reads and so does not list them.
- **D-7860 (2026-11-03)** — Backup banner for failed or stale and the quiet Backups line in Settings › Automation. The
  banner reads the block through `readBackupHealth` alone and decides nothing; stale wears the dead tone, a failed run
  the attention amber. The card reads the shell's health poll through `useChromeHealthIfMounted`, which answers
  `undefined` outside the provider (a Settings page mounted alone in a test), said as "Backup status not known yet":
  mounting the whole shell chrome there would start its three polls in every Settings suite.

## Verification

- `server/test/backup-verdict.test.ts`: one row per status and per precedence edge, each with a mutant measured red.
- `agent/test/backup-op.test.ts`: a fixture directory (unset, relative, missing, empty, each file, the bound, chmod 000
  on a file and on the directory, a symlink, a FIFO) and the op on the wire.
- `server/test/backup-health.test.ts`: the lane, the route in both modes (a failed fixture shows on the next cycle,
  nothing else on the route changes), and the local adapter.
- `pwa/test/backup-banner.test.tsx` and `pwa/browser/backup-banner.browser.test.ts` (360, 390, 1280, 1920, both skins,
  both themes).
