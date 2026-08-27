# macOS port — rebase onto main and fix the confirmed review findings

**Branch:** `ws/macos-fixes`. **Subject:** GitHub PR #11 (`feat/macos-port`, a
teammate's single commit, +3,907/−328 over 40 files), which was CONFLICTING
with main and had never run CI (GitHub computes no merge ref for a conflicting
PR, so `pull_request` never fired). The tasking arrived as coordinator mail
(delivery 82) with two artifacts: the review synthesis and the 19 findings
that survived adversarial refutation (19 more were refuted and deliberately
absent).

The port is merged INTACT — a true merge, their authorship preserved — with
the fixes as separate commits on top. Resolution decisions, the re-run
portability sweep over main's movement (~600 imported lines of `ccd/ccd`,
plus `ccrc-api` wholesale), and the per-finding disposition live in the PR
body and the individual commit messages; this document exists to carry the
work's deviation ledger, per the convention that D-numbers are allocated from
`POST /api/ledger/deviations` and every tracked ref is ledgered here.

## Deviations found

- **D-944** — the review's two epoch-ms findings each offered a pair of
  remedies: raise the Darwin bash floor to 5.0 (making `EPOCHREALTIME`
  universal), or fix the `date +%s%3N` fallback. The floor raise was NOT
  taken, deviating from the "raise both gates" spelling: with the fallback
  made correct (validate, then degrade to whole seconds ×1000 — precision
  lost, the write kept), a bash 4.2–4.4 box WORKS, where the raised floor
  would refuse a box that now functions. Applied to all three copies —
  `_plat_epoch_ms` in both platform blocks and `session-hook.sh`'s
  `_hook_epoch_ms` — with a new pin holding the hook's copy byte-identical
  to the block's, and a behavioral test driving the fallback through a
  BSD-shaped `date` on every platform. The floor stays 4.2, now pinned to
  ONE value across install.sh / ccd/ccrc / README by a source pin
  (ccrc-update.test.ts), which was the review's other floor finding.

- **D-945** — `_plat_mode`'s corrected Darwin arm strips ALL leading zeros
  (`sed 's/^0*\(.\)/\1/'`), not the single `%Mp` zero the review's caution
  described. Whether BSD `stat` pads `%Lp` on a sub-three-digit mode (007 as
  `007` or `7`) is unmeasured from a Linux box; the all-zero strip answers
  GNU `%a`'s bare digits under either padding behaviour, and collapses an
  all-zero mode to `0`, GNU's own answer. The Darwin behavioral case
  (4755/600/7) pins the choice on the platform that can measure it, under
  the `test-macos` CI leg this branch adds.
