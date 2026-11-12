# Residue R50: four minor update advisories

- **D-8390 (2026-11-12)** — Residue R50's four advisories: an undecided update deadline is said in the knob readers' words and never lets the watchdog write a live updater over as wedged; a `--detach` parent reads its settings from ccrc.env alone, as its detached child does; a rollback by flip bounds its keep-set by its own start chain (58 s, no fleet-health call); and the updater and install.sh check the tarball against its own SHA256SUMS line, never `sha256sum -c`.

## Why

R50 was carried past the centralised-update programme's close (#2083) from wave 24's in-session review. Each item was
still open on `main`.

## What changed

- **(a) The watchdog's undecided deadline.** `_upd_deadline_ms` sets `UPD_DEADLINE_WHY`, the first undecided reading's
  sentence: `_ccrc_knob`'s `KNOB_WHY` for a file it cannot measure, else
  `CCRC_UPDATE_DEADLINE_MS='<value>' is not <_upd_deadline_says>, as set in <the environment | the box's ccrc.env | the
  exposure file>` (`_keep_why`'s shape: the value capped at 32 characters, a non-printable byte written `?`). With `max`
  undecided, `cmd_watchdog` prints `watchdog: WARN: <that sentence> — using <ms> ms, the largest reading ccrc could decide,
  for a dead updater; a live one is never recorded as wedged while a reading is undecided`, and refuses the wedged verdict.
  The server reads `2e6` as 2000000 ms, so a bash that could only decide 900000 judged a live updater wedged at 1800 s,
  inside the server's deadline. A dead updater (the lock free) is still measured past the largest decided reading, as
  before.
- **(b) One settings source for a console-driven move.** `KNOB_FILE_ONLY=1` makes every `_ccrc_knob` call `file` mode.
  `cmd_update` and `cmd_rollback` set it after their argument loops when `--detach` is parsed, before any setting is
  read. The parent the server starts holds the environment systemd parsed from ccrc.env when the server started; the
  detached child runs under the user manager's, which carries no setting (W24-P5), and reads the file. A ccrc.env
  edited since the server started made a rollback's existence probe ask one release base and its child fetch from
  another. It is cleared at file scope in `ccd/ccrc`, so no environment sets it; the generated settings library reads it
  as `${KNOB_FILE_ONLY:-}`.
- **(c) The flip's own hard-cap term.** `_bak_gc`'s hard cap subtracts `chain`: 63 s for an update (a re-install rollback
  runs `cmd_update` and leads `update`), 58 s for a rollback by flip, the spawn and the two release-host probes without
  `_upd_fleet_warn`'s health call, which only `cmd_update` makes. W24-K6 derives both literals from their sources and
  pins `_upd_fleet_warn`'s one caller.
- **(d) The tarball's own line.** `_upd_resolve` keeps the digest of the line it took the tarball name from
  (`UPD_TARSUM`), and `_upd_fetch` compares the staged tarball's digest, read on stdin, with it: 64 lowercase hex, as
  `deploy/build-release.sh` writes it. install.sh does the same with its `_sum` (its checksum block only; its
  tag-binding lines and curl front are untouched). `sha256sum -c` opened every path SHA256SUMS names: any file on the
  box, a FIFO that blocks, `/dev/zero` read while `update.lock` is held.

## Tests

- `ccrc-update-phases.test.ts`: W24-D4 pins the new sentence for ccrc.env and the environment; an undecided `2e6` never
  writes a live holder's 1900 s report over (the report byte-identical); a dead updater at 1000 s is still measured;
  a `--detach` rollback parent started with another base in its environment asks ccrc.env's, and its child, run with no
  setting in its environment, asks the same base (Linux rows).
- `ccrc-update-flip-backups.test.ts`: `UPD_DEADLINE_WHY` for each source and the capped value; `KNOB_FILE_ONLY` makes
  file mode, an exported one is cleared, and both verbs set it after their argument loop and before any read; the
  flip's keep-set bound is `started + 4 × deadline − 58 − 235` and an update's `− 63 − 235`; W24-K6 derives both.
- `ccrc-update-fetch.test.ts` and `install-sh.test.ts`: a SHA256SUMS that also names `../../…/etc/passwd`, a relative
  FIFO outside the staging dir and the FIFO's absolute path installs, under a bound (a verifier that opened the FIFO
  never answers); a wrong digest on the tarball's own line is refused though a later line holds the right one; the
  binary marker `*` still verifies, and a digest that is not 64 lowercase hex is refused.

## Deviations found

- R50 has a fifth bullet, `ccrc-uninstall` exiting 1 with every row passing when a fake supervisor outlives its test under
  load. It was not in this change's task, so the ledger row marks the first four fixed and leaves it open.
- A digest in uppercase hex was accepted by `sha256sum -c` and is refused now. No release this tree builds writes one.
- (a) keeps the dead-updater probe on the largest decided reading rather than refusing the whole tick: the free lock
  proves the updater gone, and the header of `cmd_watchdog`'s threshold already rules that a larger in-progress
  threshold only delays that probe.
