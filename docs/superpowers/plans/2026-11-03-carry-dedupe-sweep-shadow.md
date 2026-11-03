# Carry dedupe sweep: a daily shadow unit, its record, and the doctor carry-copies row

**Goal:** make the swap carry's copy cost visible, and run `ccd carry-dedupe` on a schedule in shadow, with the operator
arming `--apply` (#317). `ccd/ccd` does not change: the verb, its proofs and refusals, and the swap.log grammar stay as
they are, and so does every carry.

- **D-7857 (2026-11-03)** — carry-dedupe sweep: a daily shadow unit, its record, and the doctor carry-copies row.
  `ccd/ccd-carry-dedupe-sweep` runs `ccd carry-dedupe --identical-only` from `ccd-carry-dedupe.timer`, daily
  (`OnUnitInactiveSec=24h`, first an hour after arming, spread by `RandomizedDelaySec=1h`). It adds `--apply` only
  while `$REG/carry-dedupe-live` exists. That line is the one read of the marker in the tree, and nothing writes the
  marker: the operator touches it after a shadow week. Each pass appends one line to `$REG/carry-dedupe.record`, which
  keeps its last 400 lines:
  `<stamp> mode=<shadow|live> rc=<n> uuids=<n> copies=<n> <reclaimable|reclaimed>=<bytes> refused=<n> by=<word:n,…|->`.
  The figures come from the verb's own `total:` line, and the refusals are counted by word from its table. Output with
  no total records `unmeasured=no-total` and fails the unit. `ccrc doctor`'s new `carry-copies` check reads two
  figures: the bytes swap carries copied in the last 7 days (swap.log's `(copy: <cause> <bytes> bytes)` and
  `, copy: <cause> <F> files <B> bytes` forms), and the reclaimable bytes on the record's latest line. It WARNs when
  either is over `CCRC_CARRY_COPY_WARN_BYTES`, a new ccrc setting read in `file` mode, default 10737418240 (10 GiB, a
  round figure and not a measurement). It also WARNs when the latest pass did not measure or exited non-zero. Otherwise
  it PASSes with both figures. Its remedy is to read the record, then arm the sweep. It SKIPs on a server-role box and
  where no registry exists.

**Change:**
- `ccd/ccd-carry-dedupe-sweep` (new), `deploy/systemd/ccd-carry-dedupe.{service,timer}` (new). The service is
  `Type=oneshot` with `MemoryMax=1G`, `MemorySwapMax=256M`, `Nice=19` and `IOSchedulingClass=idle`.
- `ccd/ccrc`:
  - `_inst_bins` places the sweep on the radar's terms (not on Darwin).
  - `_inst_units` and `_inst_enable` place the pair and enable the timer, `!= server`, inside the Darwin arm's skip.
  - `_uninst_units`, `_uninst_wrappers` and `_uninst_tree_bins` remove them.
  - `CCRC_SETTINGS` gains `CCRC_CARRY_COPY_WARN_BYTES`, and `ccd/lib/ccrc-settings.sh` is regenerated.
- `deploy/deploy.sh` (agent lane) and `deploy/gen-wrappers.mjs` (`TOOLCHAIN_EXECUTABLES`) list the sweep the same way.
- `ccd/ccrc-doctor-checks`: `carry-copies`, on the `disk box-settings` line of the table, is appended at the end of the
  file.
- `deploy/ccrc.env.example`, `README.md` (the timers row, the doctor row, the settings paragraph and a section) and
  `shared/lifecycle.ts` (the record's class) describe the change.

**Tests:**
- `server/test/ccd-carry-dedupe-sweep.test.ts` (new) uses a fixture HOME and a stub ccd. It holds that:
  - shadow never passes `--apply`, and only the exact marker adds it;
  - the record line has the stated format, including one case run on the real program's dry-run output;
  - the rc is recorded, and output with no total records `unmeasured=no-total`;
  - the record keeps 400 lines;
  - a box with no registry or no ccd is handled.
- `server/test/ccrc-doctor-carry-copies.test.ts` (new) covers:
  - the SKIP and PASS rows;
  - both copy forms and the 7-day window;
  - each threshold edge, in pairs: at the bound is a PASS, one byte over is a WARN;
  - live and shadow remedies, the unmeasured record lines, and the knob's validation.
- `single-definition/switches-history.test.ts` pins the marker's holders. The sweep's one read is the only existence
  test in the tree, and the doctor names the marker only inside its remedy string.
- The install-role, install-units, install-landing, uninstall, install fixture (`UNIT_FILES`, `TREE_FILES`,
  `FLEET_BOX_CLASSES`), `HEALTHY_SKIPS` and agent `deploy-verify` rows list the new bin, pair and timer.

**Mutants run** (each one reverted after its run):

| Mutant | Suite | Red |
|---|---|---|
| `copied >= thr` | doctor carry-copies | the copied-bytes edge pair |
| `rbytes >= thr` | doctor carry-copies | the reclaimable edge pair |
| reclaimable not compared | doctor carry-copies | the reclaimable edge pair |
| merge bytes not added | doctor carry-copies | the sum, the edge and the merge-only rows |
| window of 8 days | doctor carry-copies | the sum and window rows |
| a live pass's reclaimed bytes compared | doctor carry-copies | the live rows |
| always live | sweep | 7 rows |
| never `--apply` | sweep | the live row |
| bound of 401 lines | sweep | the bound row |
| no-total exits 0 | sweep | the no-total row |

**Operator act after deploy:** after a week of shadow lines, read `~/.cc-sessions/carry-dedupe.record` on the fleet
box, then `touch ~/.cc-sessions/carry-dedupe-live`. Deploy class: agent lane first.

**Follow-up:** #317's proposal 3 (drop the source after a verified carry) is filed as its own issue. It changes carry
behaviour, which this change does not.
