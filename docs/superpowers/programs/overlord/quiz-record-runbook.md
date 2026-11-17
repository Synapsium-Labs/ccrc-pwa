# The replay quiz's single-arm run: the operator's runbook

The steps the operator takes to run the replay quiz once a week, recall on, with no A/B window, and to record it
(plan `docs/superpowers/plans/2026-11-17-overlord-quiz-record.md` §7). The module is
`deploy/history-quiz-single.mjs`; recording and confirming the run arrive with PR 2 (`ccrc quiz-record` and the Shadow
lanes card).

## Where and when

- Every command runs on the fleet box, in the operator's own shell, outside tmux and outside any Claude Code session.
  The module refuses `in-pane` when `TMUX_PANE` is set and `in-session` when `CLAUDECODE` is set.
- Never run it while a W2 window is open (the history coordinator's skip condition 3). What a weekly run does during an
  open W2 window is settled before any W2 window opens.
- A single-arm run is not a W2 pilot and does not resume the W2 study. Nothing it writes is W2 pilot evidence, W2's budget
  extrapolation or W2's quiz list (skip condition 2).

## The directories

- `<OUT>` is a directory of the operator's choosing, outside every work tree, made once. It holds the setup and the
  frozen questions, and lives as long as the quiz lane runs.
- `<WEEK>` is a fresh directory for each run. Remove it by hand once its run is confirmed or discarded.
- Both are the lifecycle class `history-quiz-single-out` (`shared/lifecycle.ts`): mode 0700, marked by
  `.ccrc-history-quiz-single` beside the driver's own marker.
- Each `--x-sha256` is the hex the previous command printed as `sha256 <hex>` on stderr.

## The commands

```bash
Q="node --no-warnings $HOME/ccrc/deploy/history-quiz-single.mjs"

# Once: the setup and the frozen questions (every later run reuses them).
$Q setup  --out <OUT> --account <account> --budget 5000000 --settings-mode <restricted|fallback> \
          --writer-model <exact opus id> --judge-model <exact opus id> --arm-model <exact model id>
$Q source --out <OUT> --setup <OUT>/setup.json --setup-sha256 <H_SETUP>
$Q freeze --out <OUT> --setup <OUT>/setup.json --setup-sha256 <H_SETUP> \
          --sourced <OUT>/quiz/sourced.json --sourced-sha256 <H_SOURCED>
$Q marker --frozen <OUT>/quiz/frozen.json --frozen-sha256 <H_FROZEN>
#   then write the printed lines into ~/.ccrc/history/headless-on yourself (the marker is yours; nothing writes it)

# Each week, the baseline first, before arming any W1a lane. arms runs step 0b's probes first and stops if one fails.
$Q arms   --out <WEEK> --setup <OUT>/setup.json --setup-sha256 <H_SETUP> --frozen <OUT>/quiz/frozen.json --frozen-sha256 <H_FROZEN>
$Q judge  --out <WEEK> --setup <OUT>/setup.json --setup-sha256 <H_SETUP> --frozen <OUT>/quiz/frozen.json --frozen-sha256 <H_FROZEN> \
          --arms-summary <WEEK>/quiz/arms-summary.json --arms-summary-sha256 <H_ARMS>
$Q report --out <WEEK> --setup <OUT>/setup.json --setup-sha256 <H_SETUP> --frozen <OUT>/quiz/frozen.json --frozen-sha256 <H_FROZEN> \
          --arms-summary <WEEK>/quiz/arms-summary.json --arms-summary-sha256 <H_ARMS> \
          --judged <WEEK>/quiz/judged.json --judged-sha256 <H_JUDGED>

# Record it, within 8 days of the arms run (arrives with PR 2).
ccrc quiz-record --report <WEEK>/single-report.json --sha <H_REPORT>
```

`ccrc quiz-record` validates and packages the report and posts it through `ccrc-api`, and the run is recorded as pending
until it is confirmed. Then open the console's Shadow lanes card and press **Confirm** (or **Discard**) on the pending run.
Confirming the first run while all three W1a rows read Shadow makes it the baseline.

## What each step can say

- `setup` has no default settings mode: pass `restricted` or `fallback`. The writer and the judge must be exact Opus ids;
  the arm model is never a Fable one.
- `arms` runs step 0b's probes (the turn bound, persistence, the tools, no MCP server, no plugin, the `ccrc-history` skill,
  each taught spelling and the three denials) before any question. A failure refuses `pilot-failed` and writes
  `<WEEK>/quiz/step0b/<mode>.json`. A skill missing under `restricted` is one such failure: run the week again on a fresh
  `<WEEK>` with a setup made under `--settings-mode fallback`.
- `arms` stops at the 70% limits threshold or at the setup's `--budget`, whichever comes first, writing the summary with
  its stop. Run it again on the same `<WEEK>` once the cause clears: finished questions are skipped.
- One week runs on one release: an `arms` resumed on another release refuses `release-moved`, and so does `report` when
  `arms` and `judge` ran on different releases. Run the week again on a fresh `<WEEK>`.
- A version move of Claude Code since `setup` is not refused: `arms` and `judge` each measure the node at their own start.

## What a run spends and touches

- The spawns run with the named account's real `HOME` and `CLAUDE_CONFIG_DIR` and spend its pool, up to the
  `--budget` of 5M token-equivalents, the weekly cap. The spend ledger under `<WEEK>` says what the run used.
- Each spawn's working directory is a transient directory under the system temp.
- An arm's admitted `ccrc history` read appends one arm-tagged counter line to the live spool, as W2's arms do.
- The store is read read-only; no history marker is written, and no writing form of `ccrc history` runs.
