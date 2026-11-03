# A registry copied to new hardware: notes

This note records the deviation number of the fix for a registry copied onto new hardware, where every row's entry
field still named the old host's device and inode and the rows rung held every child reclaim as
`probe-unmeasured`. The design is in the PR body; the box-move runbook note is in `README.md`, under
**After a box move**.

## Deviations found

- **D-7302 (2026-10-28)** — `workdirid-box-move-growth-waiver`: the fix grows `ccd/ccd` by +60 net code lines, past
  the 40-line limit, so it carries the waiver `server/test/growth-waivers/D-7302-ccd-ccd.json` (`maxDelta` 60). The
  lines extend two existing owners and add no mechanism beside them: the one bounded walk (`_ws_reclaim_idwalk`)
  gains a `D` request and its mount-table reader, rule (d) of the rows rung (`_ws_reclaim_workdir_shared`) gains its
  one release, which places a row by path only and writes nothing, and the journal emitter (`_lc_json`) gains the
  rung that cuts an over-cap `detail` to fit. Narrowing the rung's refusal to rows that could overlap is not done:
  the rows that stay unplaceable are unplaceable because their path does not prove where the session is, and
  releasing a pending row on its spelling would be a new accepted residual, which needs a ruling.
