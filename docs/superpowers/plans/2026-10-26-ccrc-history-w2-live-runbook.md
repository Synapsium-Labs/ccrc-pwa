# W2 live evaluation runbook: the fleet box (decisions §5, acts 7 to 29)

The operator's runbook for W2's live evaluation, with the coordinator's checkpoints (CP-40 of the ccrc-history completion plan). One named node: **the fleet box** (operator ruling, 2026-10-25). Every
command is cited to the decisions document (`docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`, "§5 act N",
"W2-Dn") or to the plan task that ships it (W2-3, W2-4, W2-5a, W2-5b1, W2-5b2, W2-6, W2-7). Every verb, flag,
refusal word and output path below was checked against the code of `v0.0.740`. By the operator's ruling of 2026-10-26
(R-B1), the final W2 release carries the budget-amendment wave, W2-7 (#1641, `c1770fbf4`, first released as
`v0.0.740`), not `v0.0.730`: it is the fleet box's release at act 6, `v0.0.740` or a later one with the same history
code (see "Before act 7"). On that tag, re-read each verb's usage before running it. Plan text is never ground truth;
the merged code is.

## In short

- **What the window is.** A pre-registered live A/B over the fleet box's session families active at W2 open, plus a frozen
  quiz run in both arms. Control families get a `recall-off/<id>` file (the CLI exits 8 for them). Treatment families keep
  recall and the card line. The gate (W2-D89: accuracy, fabrication, uptake) is computed once, after window end, by
  `report`. Nothing that scores moves between part 1 and close (W2-D6 build freeze, W2-D7 maintenance freeze). From act 6 to act 28
  no release is installed and the account's wrapper does not change. If either is forced, W2 halts and closes with no
  verdict (the operator's ruling of 2026-10-26, R-B2).
- **Minimum calendar time: about 15 to 17 days.** The window is `planned_days` long, 14 by default, and may be up to one
  day longer, never shorter (W2-D25). Before it come step 0a, pilot sourcing, the census, Q18, the pilot, quiz sourcing and
  part 2. That takes hours to a few days, and it depends on the account's limits: every batch stops at 70% (W2-D55). After
  it come the counters, the hand-check labelling and the report, about a day. The quiz arms (about 30M token-equivalents,
  spec §10.2 "The cost", **I**) run during the window (W2-D77), paced by the same limits stop.
- **Who does what.**
  - **The operator** runs every command on the fleet box and labels the hand-check sheet (W2-D81). The operator also owns
    the update intent, both freezes, the markers and the rulings.
  - **The coordinator** sees only shas, counts and aggregates. Its jobs: re-measure the release stamp and the Claude Code
    version at window start and end (acts 20 and 23), record each halt with its time, record
    every amendment, every `--accept-failed-pilot` use and every forced act in the programme ledger, and compute and post
    the gate (Q7, Q14).
- **Only shas, counts and aggregates go public** (W2-D25). Never public: store ids, ccrc ids, generations, the account,
  the node label, any marker or `recall-off` line, and the seed until close.

```mermaid
flowchart LR
  A[7 step 0a] --> B[8 maintenance freeze] --> C[9 pilot-source] --> D[10 part 1]
  D --> E[11 census + verify registry] --> F[12 power + Q18 decision]
  F --> G[13 pilot marker] --> H[14 step 0b, fidelity, usage pilot, pilot-result] --> I[15 rm marker]
  I --> J[16 quiz-source + freeze] --> K[17 part 2]
  K --> L[18 recall-off writes] --> M[19 quiz marker + verify] --> N[20 stamps at start]
  N --> O[21 arms + judge in window] --> P[22 hand-check sheet]
  P --> Q[23 stamps at end; measure; counters] --> R[24 report] --> S[25 gate decision]
  S --> T[26-29 close]
```
*Figure 1. Acts 7 to 29 on the fleet box. Acts 8, 20, 23's re-measure and 25's posting are checkpoints. Halts branch off at
14, 16, 21 and 24 (see "Halts and the abort path").*

### Conventions used below

- `replay` means `node --no-warnings <home>/ccrc/deploy/history-replay.mjs`. `<home>/ccrc` is the node's installed tree,
  the symlink to `~/ccrc-versions/<tag>`. The driver must run from that tree, because `codeShas()` hashes the tree the
  driver is loaded from, and the release stamp it compares is `version` in `~/.ccrc/build.json` (W2-D24, W2-D56). The shebang is `#!/usr/bin/env -S node --no-warnings` (W2-5a's drift table).
  The release tarball carries the whole tracked `deploy/` directory, so `deploy/history-*.mjs` and
  `deploy/measure-history.py` sit under `<home>/ccrc/deploy/`.
- `measure` means `python3 <home>/ccrc/deploy/measure-history.py`. Run it as the store's own user, never under `sudo`
  (its docstring).
- `counters` means `node --no-warnings <home>/ccrc/deploy/history-counters.mjs` (W2-6).
- `ccrc` means `<home>/.local/bin/ccrc`, by absolute path. `~/.local/bin` is not on a fleet unit's PATH.
- **Shell.** Use a shell outside every tmux pane: `TMUX_PANE` set at all, even empty, refuses `in-pane` before anything
  else (RP2, W2-D45, W2-4 Task 1). Use one outside every Claude Code session too: `CLAUDECODE` set refuses `recall-off`
  and every other writing `ccrc history` verb (`apply-in-session`). Run `umask 077` and `set -o noclobber` first, so a
  redirect never overwrites a record or an output already posted. If a command refuses, `rm` the empty file its
  redirect left before re-running. Where an act is deliberately redone (a superseding draft's acts 11 to 16, a `verify`
  under an amended record), write to a new versioned name, such as `<P>/census.v2.json`, post its new sha, and pass
  that name from then on wherever a command below names the old one. Never use `>|` on a record, census, verify or
  power file. Every subcommand prints `sha256 <hex>` of its output on
  stderr (W2-D57's printed-sha convention). One that takes `--out` writes its output file under it and leaves stdout
  empty. `open`, `power` and `verify` print canonical JSON and one newline on stdout, and `marker` prints the marker's
  exact text: redirect stdout to a file. Either way, check `sha256sum <file>` against the printed sha.
- `<P>` is a private directory, mode 0700, outside every git tree and outside every `--out`. Both record parts must live
  there (W2-D25). A record inside a git tree is refused.
- Each `<OUT_*>` is an absolute path that does not yet exist, whose parent directory already exists, outside every git
  tree, with no `:` in it. The driver creates it 0700 with its marker (W2-D53); it never creates a parent. Reuse one only
  to resume the same act. Append every `--out` path to a private list, `<P>/outs.txt`, the moment you create it,
  including every fresh one a remedy sends you to: act 29 removes them all. The `--out`s are:
  - `<OUT_0A>` (step 0a);
  - `<OUT_PS>` (pilot-source);
  - `<OUT_PILOT>` (the pilot acts; Q25 refuses pilot-source's `--out`);
  - `<OUT_QUIZ>` (quiz-source and freeze);
  - `<OUT_ARMS>` (the window's arms and judge);
  - `<OUT_REPILOT_m>` (one per re-pilot, K22 (b));
  - `<OUT_REPORT>` (hand-check and report);
  - `<OUT_COUNT>` and `<OUT_COMBINE>` (W2-6, which refuses an existing `--out`).

  `quiz-source` and `freeze` share `<OUT_QUIZ>`. The driver would not refuse `arms --section quiz` there (it refuses
  only pilot-source's `--out`), but the spend ledger is per `--out` and the arms' budget gate sums all of it, so
  quiz-source's writer spend would count against the node's spend share. Keep `<OUT_ARMS>` apart.
- Shas are named `H_<thing>`: `H1` is part 1, `H2` the current part 2, `H_PF` the pilot frozen list, `H_Q` the quiz
  frozen list, and so on.
- `<cur part2>` is the current part 2: act 17's `<P>/part2.v<k>.json` (`k` is 1 for the first final), or the newest
  `open --amend` output (act 21). `H2` is always its sha, and `[--supersedes …]` names the final it supersedes, if any.

### The stop and refusal table (cited by every act)

W2-5b1 Task 1 splits `DRIVER_REASONS` into stops and refusals; W2-5b2 Task 1 adds `pilot-failed` as a refusal. **A stop
never fails a question:** it is `not-run`, it never uses up a re-run, and it resumes when the same command is re-run on the
same `--out` (W2-D80 and §7, the classification of the unmeasured and driver words).

| Word | Class | Remedy |
|---|---|---|
| `limits-threshold` | stop | Wait until `max(five, seven)` < `limits.threshold_pct` (70), then re-run the same command (W2-D55). |
| `limits-stale` | stop | Refresh the limits row with one interactive statusline render on the account, then re-run. Never edit `~/.cc-limits` (W2-D55, §5 act 21). |
| `budget-exhausted` | stop | The budget in force is spent. Before part 1, re-run with a larger `--budget`. Part 1 to part 2: part 1's `pilot_budget` binds, so raising it needs a superseding draft, which is a ruling: it re-runs acts 12 to 17, a full re-pilot included (act 12, "Any superseding draft"). From part 2: `spend_budget` is signed. `open --finalize` derives it from the pilot's usage extrapolation and refuses any other `--spend-budget`. The budget in force is the newest `budget-raise` amendment's figure, else the signed `spend_budget` (W2-D55 as D-7063 amends it). The remedy is `open --amend --kind budget-raise --spend-budget <N>` on the operator's ruling (R-B1; W2-7), its sha posted, then the batches resume under the new record (act 21). `arms` and `judge` resume on their own `--out`. A quiz re-pilot (step 0b and fidelity, `--section quiz`) does not: its version pin holds the old record's sha, so it is refused `out-refused` before any spawn, and it re-runs whole on a fresh `--out` under the raised record. Its earlier spend does not carry into the fresh ledger: size the raise knowing that (review 1030 F1). |
| `claude-version-moved` | stop | Before part 2: a ruling; the likely remedy is step 0a on a fresh `--out`, a superseding draft and a re-pilot (W2-D6, W2-D56). After part 2: the act 21 re-pilot and a `version-move` amendment. |
| `tree-moved`, `code-changed` | stop | The build freeze was breached: a release was installed. From act 6 to act 28 no release is installed, and there is no freeze exception (the operator's ruling of 2026-10-26, R-B2). Do not roll back and resume. W2 halts and closes with no verdict: acts 26 to 29, as the halts table says. The code would refuse an amendment anyway once a `gate_code` file differs: `open --amend` takes no `--allow-code-change` and refuses `code-changed`. |
| `wrapper-moved` | stop | A generated account's wrapper changed. From act 6 to act 28 the account's wrapper does not change (the operator's ruling of 2026-10-26, R-B2). W2 halts and closes with no verdict: acts 26 to 29, as the halts table says. |
| `code-unmeasured`, `version-unmeasured`, `tree-unmeasured`, `wrapper-unmeasured` | stop | Make the input readable: the code file, the launcher's `--version`, a tagged release stamp, the wrapper. Then re-run. `--allow-code-change` never covers these (W2-D24, W2-D56). |
| `out-refused` | stop | Read the detail. `create-failed`/`marker-unwritable`: remove `--out` by hand, then re-run (W2-D53). `relative` or `parent-absent`: pass an absolute path whose parent directory exists (the driver never creates a parent). `in-git-tree`: choose a path outside every git tree. `pilot-source.json is here`: use a fresh `--out` (Q25). `run-json-mismatch`: re-run with the original flags or on a fresh `--out`. A `.pid` that is not regular, or an unreadable ledger: inspect, then a ruling. |
| `run-live` | stop | A leftover run's child is alive or cannot be measured. Wait for it to exit, then re-run. Never kill it, charge it or remove it by hand (W2-D55). |
| `out-in-use` | stop | Another driver holds the `--out` lock. Run one driver per `--out`. |
| `interrupted` | stop | Re-run the same command. |
| `store-unreadable` | stop | Check `ccrc history status` and read-only `ccrc history doctor`, which W2-D7 allows. Re-run. |
| `family-unlisted` | refusal | The headless-on marker is absent, unreadable, names another store, or does not list a batch family by id and generation. Rewrite them from `marker`, then `verify` (W2-D78 (i)). |
| `family-recall-off` | refusal | A `recall-off/<id>` exists, or cannot be measured, for a batch family. That should be impossible for quiz families (W2-D77). Ruling. |
| `quiz-unanswerable` | refusal | A frozen question's fact is no longer answerable: pruned, redaction widened, or hidden (W2-D78 (iii)). It is never dropped silently. Ruling on whether the quiz stands (W2-D7). |
| `quiz-sha-mismatch`, `record-sha-mismatch`, `input-sha-mismatch` | refusal | A wrong sha or a changed file was passed. Re-measure with `sha256sum`. Never edit a signed file. |
| `record-invalid` | refusal | The validator's `path word` list (W2-D25). Fix the input named; see each act. |
| `assignment-mismatch` | refusal | The census or verify inputs differ from the ones `quiz-source` used. Pass the same files (W2-D73). |
| `args-invalid`, `input-invalid` | refusal | Read the detail; fix the flag or the input. |
| `in-pane` | refusal | Use a shell with no `TMUX_PANE`. |
| `roster-invalid`, `account-refused` | refusal | The account is not admissible (W2-D52). Act 1's naming changes: ruling. |
| `pilot-failed` | refusal | The pilot failed. From `step0b`, `fidelity` and `pilot-result`, the file and its sha were written first (K3); `open --finalize` refuses it again unless `--accept-failed-pilot` carries the ruling (Q27). From `step0b`, W2 halts and re-pilots, and nothing is accepted (the operator's ruling of 2026-10-26, R-B3; act 14a). From `fidelity` or `pilot-result`, W2 halts for the operator's ruling (W2-D57, §5 act 14). |

## Before act 7

Every line must be measured and recorded before step 0a.

- [ ] **Act 1 names (§5 act 1).**
  - The node: the fleet box only (ruling 2026-10-25).
  - The account: an id the roster declares `upstream` (its config dir exactly `$HOME/.claude`; no wrapper and no
    secrets file), or `generated` with `provider: 'anthropic'`, whose `secretsFile` is declared and readable. It must
    not be `hidden` (W2-D52, RP3, RP9).
  - The model ids, each exact and never an alias: an arm model that does not match `/fable/i`, and a writer and judge
    model matching `/^claude-opus-/` (W2-D25).
  - 5h-1's plan approved and 5h-2's redaction questions ruled.
- [ ] **Every W2 PR merged.** On `main` today: 5h-1 (#737), 5h-2 (#1010), W2-1 (#1105), W2-2a (#1126), W2-2b (#1154), W2-3
  (#856), W2-4 (#826) and W2-5a (#1134). Since merged: W2-5b1 (#1497), W2-6 (#1547) and W2-5b2 with the coordinator's K25 to
  K27 amendment (#1560) (W2-D6, §5 act 5). Last: W2-7, the budget-amendment wave (#1641), which adds the amendment kind
  `budget-raise` (the operator's ruling of 2026-10-26, R-B1; D-7063). The final W2 release is the release on the
  fleet box at act 6: `v0.0.740` (#1641's merge, `c1770fbf4`) or a later release whose history code (the four
  `gate_code` files and `ccd/history/`) is byte-identical to `v0.0.740`'s, never `v0.0.730`. Before act 5 the
  coordinator measures that diff and posts the tag; on 2026-10-27 the fleet box was on `v0.0.745`, whose history code
  is `v0.0.740`'s. `<tag>` below is that tag. Act 6 pins it (rolling it first only if the box is not on it), and
  acts 7 onward run only on it: part 1 refuses a step 0a or pilot-source record stamped with another release (`release-mismatch`).
- [ ] **That release is on the fleet box (§5 act 6).** Rolled out through the release lane (`ccrc rollout --to <tag>`, or
  `ccrc update --to <tag>` on the box). `ccrc version` names `<tag>` with a complete, signed `install:` line. Step 0a
  reads only `version` in `~/.ccrc/build.json`: an untagged build (no `version`), or a stamp that is absent, unreadable
  or malformed, refuses `tree-unmeasured` (W2-4 Task 8).
- [ ] **Update intent is off, or pinned to `<tag>`, and the time is recorded (§5 act 6, W2-D6).** It stays that way until
  act 28. First record, from `GET /api/updates`, the node's intent row (absent, or its `channel`, `pinnedTag`, `auto` and
  `notify`) and the fleet row `*` (the same keys): act 28 restores both. Then prefer a node-scoped write: `POST
  /api/updates/intent` from a signed-in session with `{"scope": "<node>", "pinnedTag": "<tag>"}` (a pin) or
  `{"scope": "<node>", "auto": "off"}`. The PWA has no pin form, and its Settings, Updates, Auto-install "Off" writes
  `auto: 'off'` on the fleet scope `*`, which changes every node's intent; if you use it, act 28 must restore `*` too. A
  node's own intent row decides over `*`. The coordinator reads `GET /api/updates` to confirm the intent row (`auto`,
  `pinnedTag`) and the node's `desiredTag`. Nobody taps Install, Update or Roll back for the node until act 28: a tap
  moves it whatever `auto` says. Once a node row exists it decides for the node from then on
  (`server/src/update/resolve.ts`: no row means the fleet row decides), and no route deletes a row. From act 6 to act 28
  no release is installed and the account's wrapper does not change. If either is forced (a security fix, an account
  outage), W2 halts and closes with no verdict (the operator's ruling of 2026-10-26, R-B2).
- [ ] **5h-1 and 5h-2 on the node, and the 5h-2 re-clean measured complete and recorded (§5 acts 2-3, W2-D8).**
- [ ] **Backfill re-run complete and recorded (§5 act 4, W2-D8).** From a terminal outside every session (`--apply`
  refuses `apply-in-session` inside one): pause with `systemctl --user stop ccd-history-sweep.timer`, run
  `ccrc history import` (the dry run: its `mapped` and `unmapped` lines), then `ccrc history import --apply`, then
  resume with `systemctl --user start ccd-history-sweep.timer`. B2's CLI `import` verb runs the shim's
  `--op import --apply`. Do not pause with `~/.ccrc/history-off`: `import --apply` refuses `history-off`. Exit 4
  `writer-busy` means a pass still holds the lock: re-run when it ends. This must finish before act 8, because the
  maintenance freeze then forbids `import --apply`.
- [ ] **B4 live (W1-k, spec §10.6 item 3, §10.7).** B4's export is live on the node before the earliest first due date
  that `status` reports, and at the latest by 2026-12-19. The node's doctor shows no `export-overdue`.
- [ ] **No migration owed (W2-D10).** `SCHEMA_VERSION` is still 2.
- [ ] **The account's limits row is fresh** (under 1 h old) and below 70%. Step 0a refuses before any spawn otherwise
  (W2-D55).
- [ ] **What the maintenance freeze will mean, from act 8 to close (W2-D7).**
  - Forbidden on the node: `prune --apply`, `reparse`, `import --apply` in any form, and
    `doctor --repair|--adopt|--restore|--rebuild|--migrate`. Also no `history-off` (except under §10.7's W1 kill rule), and
    no lowering of `history-max-gb`.
  - Allowed: scheduled ticks, B4's export as ticks run it, `status`, read-only `doctor`, `doctor --backup`, and the
    `recall-off` verb at window start (act 18) and at close (act 26).
  - A forced frozen act (cap or disk emergency) is done, timed and recorded. After part 2 it is recorded as an amendment
    (act 21).
- [ ] **Optional early check.** W2-4's `probe` is a box verb and an early check only (W2-D58):
  `replay probe --out <OUT_PROBE> --account <account> --budget <N> --arm-model <arm-id> [--settings-mode restricted|fallback]`
  (W2-4 Task 9). It spends.

## Act 7: step 0a (operator)

- **Command** (§5 act 7, W2-D57, W2-D55, W2-D52; W2-4 Task 8). Every flag except `--settings-mode` is required, and the
  default mode is `restricted`.
  ```
  replay step0a --out <OUT_0A> --account <account> --budget <N_0A> \
    --writer-model <writer-id> --judge-model <judge-id> --arm-model <arm-id> [--settings-mode restricted|fallback]
  ```
- **Inputs:** the act 1 names and the installed release.
- **Outputs:** `<OUT_0A>/step0a.json` (15 keys) and `sha256 <H_0A>` on stderr.
- **Check before act 10.** Step 0a records a rejected flag and still exits 0. Part 1 refuses it later as `flag-rejected`
  (W2-D25). So read the record now:
  - every `flags_accepted` value is `true`;
  - `writer_init`, `judge_init` and `box_init` are each non-null;
  - `release_stamp` is `<tag>`;
  - `settings_mode` is the mode you will sign in part 1.
- **Post:** `H_0A`.
- **Words:** `args-invalid` (`<flag>-required`, `settings-mode <v>`, `HOME is unset or not absolute`, or a flag step 0a
  never reads, a model flag that is not a model id, or a `:` in HOME or `--out`), `account-refused`, `roster-invalid`, `code-unmeasured`, `tree-unmeasured`, `wrapper-unmeasured`,
  `version-unmeasured`, and the limits and budget stops. See the table.
- **Remedy for a record part 1 would refuse:** re-run on a **fresh** `--out`. The same `--out` re-reads the same finished
  runs (W2-D57 amendment, F16), and refuses `claude-version-moved` or `wrapper-moved` if either moved since, or
  `out-refused` for another account.
- **Budget:** a soft stop on admission, at concurrency 1. Set `<N_0A>` at least one run's spend below any total you must
  not cross (W2-D55; W2-4 ruling 3).

## Act 8: the maintenance freeze begins (operator; checkpoint)

- **Act:** the freeze of "Before act 7" now holds (W2-D7). Record the UTC time with `date -u +%FT%TZ`, rounded down.
- **Post:** the time, to the coordinator, who records it in the ledger.
- **Precondition:** acts 3 and 4 are complete (§5 act 4; W2-D8).

## Act 9: pilot-source (operator)

- **Command** (§5 act 9 as amended 2026-10-22: one pilot node, run once). W2-5a Task 7 gives the full argv, and act 9's
  line is an abbreviation of it (W2-D71, W2-D73, W2-D76, W2-D56; D-6313).
  ```
  replay pilot-source --out <OUT_PS> --account <account> --budget <N_PS> --writer-model <writer-id> \
    --step0a <OUT_0A>/step0a.json --step0a-sha256 <H_0A> \
    [--sha-min-prefix 7|40] [--writer-input excerpt|leaf-span] [--n-fidelity 5] [--n-usage 5]
  ```
- **What it does:** it spends on the account and reads every rostered home's CLAUDE.md and memory files for Baseline B
  (W2-D69). Before every writer batch it runs a preflight against the step 0a output.
- **Outputs:**
  - `<OUT_PS>/pilot-source.json` (`sha256 <H_PS>` on stderr);
  - `<OUT_PS>/pilot/frozen.json`, the pilot list (W2-D73). Its sha is `H_PF`; measure it with `sha256sum`, and check it
    equals the value recorded in pilot-source.json as `frozen_sha256` (part 1 copies it as `pilot.frozen_sha256`).
  - one warning line if any writer run failed (R6).
- **Post:** `H_PS` and `H_PF` (a frozen-list sha is public, W2-D25), plus counts only.
- **Resume after a stop:** the same command on the same `--out`. The seed is pinned in `<OUT_PS>/pilot/seed`, so the same
  questions are asked (D-6313).
- **Words:**
  - `input-invalid`: `step0a account … is not --account`, or a step 0a whose shape is wrong (a wrong sha is
    `input-sha-mismatch`);
  - `args-invalid`: `sha-min-prefix`/`writer-input` outside their sets, a non-Opus writer model (refused before `--out`),
    or a missing flag;
  - the preflight words (`claude-version-moved`, `tree-moved`, `wrapper-moved`, `code-changed` against step 0a's
    record, and `tree-unmeasured`, `code-unmeasured`);
  - the admission words before `--out` exists: `roster-invalid`, `account-refused`, `wrapper-unmeasured`, and
    `store-unreadable`;
  - the limits and budget stops.

## Act 10: open --draft, part 1 (operator)

- **Find the store id first:** `ccrc history status --json`, field `store_id` (spec §8.3: "`status` and every `--json`
  envelope carry `store_id`"). It is a top-level key of the envelope, beside `coverage`; a null there names no store, so do not go on.
- **Command** (§4 step 1, §5 act 10; W2-D25, W2-D18, W2-D24; W2-5a Task 7). `open` writes no file.
  ```
  replay open --draft --step0a <OUT_0A>/step0a.json --step0a-sha256 <H_0A> \
    --node-label <node-label> --node-store-id <store-id> \
    --pilot <OUT_PS>/pilot-source.json --pilot-sha256 <H_PS> \
    --account <account> --arm-model <arm-id> --writer-model <writer-id> --judge-model <judge-id> \
    [--overrides <P>/overrides.json] [--supersedes <P>/part1.v<k-1>.json --supersedes-sha256 <H1_prev>] \
    > <P>/part1.v<k>.json
  sha256sum <P>/part1.v<k>.json        # equals the printed sha256 <H1>
  ```
- **`--overrides`.** A JSON object of part 1 fields whose status is `default`, nested as in part 1. Examples:
  - `{"settings_mode": "fallback"}`, if step 0a ran under `fallback`, since part 1's mode binds every step 0a entry;
  - `window_plan.planned_days`, `limits`, `pilot_budget`, `halts`, `handcheck.share`, `rubric_id`, `q18_settings`,
    `active_rule.lookback_ms`.

  Refused overrides: a fixed, measured, derived or operator field; a field `pilot-source` set
  (`labeller.sha_min_prefix`, `quiz.writer_input`, `quiz.baseline_files`, `pilot.n_fidelity`, `pilot.n_usage`); and
  `rubric_sha256`.

  For a superseding draft, pass the superseded draft's overrides file with only the new key added: `--supersedes`
  carries only the seed (act 12, "Any superseding draft").

  Confirm the fixed `row_cap` of 400 when signing (part 1 table).
- **Inputs:** `H_0A` and `H_PS`.
- **Output:** part 1, saved 0600 off-repo and outside every `--out` (the redirect under `umask 077` gives 0600; no code checks the mode). In later commands `<P>/part1.json` stands for the current
  `<P>/part1.v<k>.json`: type that file's own path. No act creates a file named `part1.json`, and a symlink to it is
  refused (`not-regular`): the driver reads every input without following links. Through act 17, a superseding draft's
  consumers also pass `--supersedes <P>/part1.v<k-1>.json --supersedes-sha256 <H1_prev>` (act 12, "Any superseding
  draft").
- **Post:** `H1`.
- **Words:**
  - `record-invalid` with the validator's `path word` list (W2-D25):
    - `flag-rejected` at `step0a[0].flags_accepted…`, or `field-missing` at `step0a[0].box_init` (or `writer_init`,
      `judge_init`): re-run act 7 on a fresh `--out`, then this act;
    - `value-outside-set` at `step0a[0].settings_mode` or `.account`: fix the override or the account;
    - `pilot-drift` at `pilot.writer_model`: pass the writer model act 9 used. Any other `pilot.*` path (`pilot-drift`,
      `code-changed` at `pilot.code_shas`, `release-mismatch` at `pilot.release_stamp`): re-run act 9 on a fresh `--out`
      (a frozen list is never replaced), then this act. The same two build words at `step0a[0].code_shas` or
      `.release_stamp`: re-run act 7 on a fresh `--out`;
  - `input-invalid` `step0a <label> flags-incomplete …`: W2-5a's parity pin, which needs a build ruling;
  - `code-unmeasured`, `tree-unmeasured`;
  - `args-invalid`: the counts of `--step0a`, `--node-label` and `--node-store-id` differ, or an override is refused.

## Act 11: census and verify --registry (operator)

- **Commands** (§5 act 11, §4 step 2; W2-D13, W2-D20, W2-D84; W2-3 Task 4, W2-5a Task 7):
  ```
  T0=$(date +%s%3N)                                     # W2 open: the census instant, epoch ms
  measure --census --as-of "$T0" --since "$((T0 - 1209600000))" --row-cap 400 > <P>/census.json
  sha256sum <P>/census.json                             # H_C
  replay verify --registry --record <P>/part1.json --record-sha256 <H1> \
    --census <P>/census.json --census-sha256 <H_C> > <P>/verify-registry.json     # sha256 <H_VR> on stderr
  ```
- **`--since`:** T0 minus 14 days, as act 11 writes it. It must equal `q18_settings.lookback_days` (14) exactly: `power`
  refuses `input-invalid` `census <store_id> since-mismatch` unless `--as-of` minus `--since` is that many days, so an
  overridden `lookback_days` needs `--since "$((T0 - <days> * 86400000))"`. The active rule's 7-day look-back reads each
  family's last main entry before T0, which `--since` does not bound.
- **Check:** every active family is `ok`, `registry-mismatch`, `registry-absent` or `unreadable`, never folded. Non-`ok`
  families are dropped before Q18 and the flip, and the drops go into part 2 (W2-D20).
- **Post:** `H_C` and `H_VR`, plus counts per registry state.
- **Keep both files unchanged.** Acts 12, 16 and 17 must pass these same bytes; a change refuses `assignment-mismatch`
  (W2-D73).
- **Words:**
  - from `measure`: exit 2 with `--census needs --as-of, --since and --row-cap`, or a refused missing store;
  - from `verify`: `input-invalid` (`census store-id … is not this node's store`, a census shape error, or a family id
    that is not a session id, or a store that is not one of the record's nodes), `args-invalid` for a second
    `--census`, `store-unreadable`, `record-*`, `code-*`.

## Act 12: power and the Q18 decision (operator, coordinator posts)

- **Command** (§5 act 12, §4 step 2; W2-D21; W2-5a Task 7):
  ```
  replay power --record <P>/part1.json --record-sha256 <H1> \
    --census <P>/census.json --census-sha256 <H_C> --verify <P>/verify-registry.json --verify-sha256 <H_VR> \
    > <P>/power.json                                       # sha256 <H_PW> on stderr
  ```
- **Decide:** one of the words `keep`, `lengthen` or `add-nodes` (`Q18_DECISIONS`). Read the headline figure, the 80%
  figure and the rho 0 figure from the output.
- **Post, before step 0b:** `H_PW`, the decision, and only these scalar figures from `power.json`: `headline`,
  `at_power_80`, `at_rho_0`, `rho_hat`, `population` and `registry_drops` (a count). Post nothing else from the file:
  `inputs`, `n_f`, `coverage` and `pre_window_uptake` are keyed by store id, and `n_f.per_family` by family key (store
  id, ccrc id and generation), which W2-D25 keeps private.
- **On `lengthen`:** supersede the draft with the same seed, as below, with `window_plan.planned_days` the one key
  added. Then repeat acts 11 and 12 under the new part 1, with a new T0, writing to new versioned names (Conventions).
- **Any superseding draft** (`lengthen`, the quiz-floor remedy, a raised `pilot_budget`, the re-pilot after a failed
  step 0b (R-B3, act 14a), whose new key is the one its fix changes, if any):
  - Re-run act 10 with the same flags and the SAME overrides file as the draft it supersedes, with only the new key
    added, plus `--supersedes <old part 1> --supersedes-sha256 <old H1>`. `--supersedes` carries only the seed: every
    other field is rebuilt from the defaults and this call's `--overrides`, so an override left out silently reverts to
    its default. The chain check refuses a seed change, and nothing else that differs.
  - Before posting the new `H1`, diff the two parts:
    `diff <(jq -S 'del(.drafted_ms, .supersedes)' <old part 1>) <(jq -S 'del(.drafted_ms, .supersedes)' <new part 1>)`.
    Only the intended key may differ. Keep the diff private: it shows store ids.
  - Every later act that reads the new part 1 also takes `--supersedes <old part 1> --supersedes-sha256 <old H1>`, or
    refuses `args-invalid` `supersedes-required`, through act 17, `open --finalize` included. From part 2 on, `--part1`
    carries the superseding draft and `--supersedes` names only a final that part 2 supersedes.
  - Signed after act 13 has run (the quiz-floor remedy, a raised `pilot_budget`, a step 0b re-pilot), it voids every output bound to the old
    part 1's sha. `open --finalize` refuses `input-invalid` `quiz-meta record-mismatch`, then `power record-mismatch`,
    then `pilot-result record-mismatch`; `pilot-result` refuses the old fidelity, arms and judged files, and `freeze`
    refuses the old `sourced.json` (`sourced record-mismatch`). So re-run act 12 (`power`; act 11's census and
    `verify --registry` files are not bound to part 1 and carry over while `active_rule.lookback_ms` is unchanged), act 13
    (marker and verify under the new part 1), all of act 14 on a fresh `<OUT_PILOT>`, act 15, and act 16 on a fresh
    `<OUT_QUIZ>`. Only then run act 17. The new pilot spends `pilot_budget` again, on a new ledger.
- **On `add-nodes`:** this contradicts the one-node ruling. It needs an operator ruling, and then W2-D8's added-node
  checks: acts 2-4, 6 and 7 on the new node, and its own maintenance-freeze start.
- **Note:** `power` has no upper bound on `sims` (section 7 residual). A huge value runs without practical end; supersede
  such a draft.
- **Words:** `input-invalid` (`census <store_id> since-mismatch`, `census <store_id> no-tick-coverage`, or a verify
  output whose census, look-back or families differ from the census given), `record-*`, `code-*`.

## Act 13: the pilot marker (operator)

- **Commands** (§5 act 13; W2-D76, W2-D84; W2-5b1 Task 3; D-5781). `marker` writes nothing: its stdout is the exact
  headless-on content and its stderr is that content's sha.
  ```
  replay marker --section pilot --record <P>/part1.json --record-sha256 <H1> --node-label <node-label> \
    > <P>/headless-on.pilot                                # sha256 <H_MP> on stderr
  install -m 0600 <P>/headless-on.pilot <home>/.ccrc/history/headless-on
  replay verify --section pilot --record <P>/part1.json --record-sha256 <H1> > <P>/verify-pilot.json
  ```
  The `install -m 0600` mode is this runbook's choice: README's driver paragraph names none, and the seam reads the
  marker as a regular file, never through a link, with no mode check.
- **Check:** `verify` reports eight states apart. The headless-on bytes' sha must equal `H_MP`. The pilot report's
  `over_hide` is null: D-6284's over-hide is counted per node by `verify --section quiz` only.
- **Post:** `H_MP` and the verify output's sha.
- **Words:** `args-invalid` (`section-required`, `node-label-required`), `record-*`, `code-*`.

## Act 14: step 0b, fidelity, the usage pilot, pilot-result (operator)

- **Shared rules.**
  - All of this act shares one **fresh** `<OUT_PILOT>`. An `--out` holding `pilot-source.json` is refused (Q25).
  - All of it runs under part 1's `pilot_budget` (default 3,000,000) on one ledger (W2-D55).
  - Each act that fails writes its file and prints its sha first, then refuses `pilot-failed` (K3).
  - No pilot act takes `--allow-code-change` (W2-D6, Q23).
- **14a step 0b** (W2-D57, W2-D58; W2-5b2 Task 1; Q11, Q26):
  ```
  replay step0b --section pilot --out <OUT_PILOT> --record <P>/part1.json --record-sha256 <H1> \
    --frozen <OUT_PS>/pilot/frozen.json --frozen-sha256 <H_PF> [--settings-mode restricted|fallback]
  ```
  - Output: `<OUT_PILOT>/pilot/step0b/<mode>.json`, sha `H_0B`. Each check is `pass`, `fail` or `unmeasured`.
  - If the `ccrc-history` skill is missing under `restricted` (Q26, W2-D58): re-run the same command with
    `--settings-mode fallback`. Its result lands beside the first, and 14b to 14d then take
    `--step0b <OUT_PILOT>/pilot/step0b/fallback.json --step0b-sha256 <H_0B>`, `<H_0B>` being the fallback run's sha (K2). If
    fidelity or the usage pilot already ran without it, run 14b to 14d again on a fresh `--out`, each with `--step0b`, because
    `pilot-result` reads them from one `--out`.
  - If the turn bound reads `unmeasured` because the max-turns stop is spelled other than `error_max_turns`, step 0b did
    not pass. The coordinator's ruling on the spelling (W2-D57 amendment) names the cause; the rest is as below.
  - Any other failure, too: W2 halts. By the operator's ruling of 2026-10-26 (R-B3, K2's letter), nothing is accepted past a
    failed step 0b. Fix the cause, then re-pilot on a superseding draft: act 10 again, then acts 12 to 17, with all of
    act 14 on a fresh `<OUT_PILOT>` (act 12, "Any superseding draft"). Never run 14b to 14d without `--step0b` after a
    failed step 0b, and never take it to act 17 with `--accept-failed-pilot`. If the fix needs a release install, R-B2's
    bar applies: W2 halts and closes with no verdict. To abort, follow the halts table.
- **14b fidelity** (W2-D76; W2-5b2 Task 2; Q8, Q9, K13). It runs in box mode with no marker.
  ```
  replay fidelity --section pilot --out <OUT_PILOT> --record <P>/part1.json --record-sha256 <H1> \
    --pilot <OUT_PS>/pilot-source.json --pilot-sha256 <H_PS> [--step0b <step0b file> --step0b-sha256 <H_0B>]
  ```
  Output: `<OUT_PILOT>/fidelity.json`, its sha printed. A boundary unmeasured or outside `pilot.tolerance`, and fewer
  boundaries than `n_fidelity` (`fidelity short`), refuse `pilot-failed` after the file is written. The settings-mode
  mismatch (K13) is `pilot-result`'s check. If the operator rules to accept a 14b failure, still run 14c and 14d:
  `fidelity.json` is written before the refusal, and `pilot-result` needs it.
  - **Run it while the sources are on disk (K29, D-6694).** `fidelity` reads each boundary's original-side usage from its
    source transcript line, so the pilot must run while its boundaries' sources are on disk, within each home's retention.
    A boundary whose source file has passed its home's retention, or was rewritten, answers unmeasured
    (`source-missing`, `source-refused-…`), and that fails the pilot.
- **14c the usage pilot, 5+5** (W2-D58, W2-D78, W2-D79; W2-5b1 Tasks 4-5). Act 13's marker must still be in place, or
  `family-unlisted` refuses (W2-D78 (i)).
  ```
  replay arms  --section pilot --out <OUT_PILOT> --record <P>/part1.json --record-sha256 <H1> \
    --frozen <OUT_PS>/pilot/frozen.json --frozen-sha256 <H_PF> [--step0b <step0b file> --step0b-sha256 <H_0B>]
  replay judge --section pilot --out <OUT_PILOT> --record <P>/part1.json --record-sha256 <H1> \
    --frozen <OUT_PS>/pilot/frozen.json --frozen-sha256 <H_PF> [--step0b <step0b file> --step0b-sha256 <H_0B>]
  ```
  Outputs: `<OUT_PILOT>/pilot/arms/summary.json` (its sha printed) and `<OUT_PILOT>/pilot/judged.json`. Run `judge` only
  after `arms` has settled every question: it refuses an unsettled section, `input-invalid` `arms-unsettled` (R20).
- **14d pilot-result** (W2-D64, W2-D82; W2-5b2 Task 2; Q6, Q7, Q10, K14, K15):
  ```
  replay pilot-result --section pilot --out <OUT_PILOT> --record <P>/part1.json --record-sha256 <H1> \
    --step0b <step0b file> --step0b-sha256 <H_0B>
  ```
  - Output: `<OUT_PILOT>/pilot-result.json`, sha `H_PR`. It holds the extrapolation (formula, margin 5/4, `at_target`),
    the absent rate per arm, the uptake reading (`is-error`, `not-error` or `unseen`), both spend readings, step 0b's sha
    and mode, and `failures`.
  - On failure: `pilot-failed`, and W2 halts for the operator's ruling (§5 act 14). The only way forward without a
    re-pilot is `--accept-failed-pilot` at act 17, and the coordinator records that use (Q27, K14). That way is closed
    to a failed step 0b, which never reaches 14d (R-B3, act 14a).
- **Post:** `H_0B`, the fidelity sha, the arms summary sha, `H_PR`, pass or fail, and the extrapolation's `at_target` figure (for `quiz.target` questions; act 17 derives the signed budget for the frozen count).
- **Waits:** every batch stops at 70% and resumes when re-run (W2-D55). Run at most 2 concurrent runs, in a low-usage
  window (spec §10.2).
- **C6.** Whether the result event's usage includes Agent-subagent spend is measured here. D-6467 charges the larger
  reading.

## Act 15: remove the pilot marker (operator)

- **Command** (§5 act 15; W2-D76): `rm <home>/.ccrc/history/headless-on`, then `test ! -e <home>/.ccrc/history/headless-on`.
- **Words:** none. No verb removes it.

## Act 16: quiz-source and freeze (operator)

- **Commands** (§5 act 16; W2-D19, W2-D71, W2-D73, W2-D77; W2-5a Task 7). `quiz-source` runs under part 1's
  `pilot_budget` and preflights against part 1; `freeze` spawns nothing.
  ```
  replay quiz-source --out <OUT_QUIZ> --record <P>/part1.json --record-sha256 <H1> \
    --census <P>/census.json --census-sha256 <H_C> --verify <P>/verify-registry.json --verify-sha256 <H_VR>
  #   → <OUT_QUIZ>/quiz/sourced.json, sha256 <H_SRC> on stderr
  replay freeze --out <OUT_QUIZ> --record <P>/part1.json --record-sha256 <H1> \
    --sourced <OUT_QUIZ>/quiz/sourced.json --sourced-sha256 <H_SRC>
  #   → <OUT_QUIZ>/quiz/frozen.json (sha256 <H_Q> on stderr) and <OUT_QUIZ>/quiz/frozen.meta.json (H_QM by sha256sum)
  ```
- **What happens:** the assignment is derived from the census and verify inputs. Control-held ids and pilot families are
  excluded automatically (W2-D77).
- **Floor check (§5 act 16):** read `frozen.meta.json` for `below_floor`, `n_questions` and `n_families`. `below_floor` is
  true below part 1's `quiz.halt_floor` (default 60 questions or 12 families; exactly the floor passes): **stop and rule**.
  `freeze` does not refuse it; act 17 does. `short_of_min_families` (fewer than `quiz.min_families`, default 20) is a report
  only, never a stop.
- **Post:** `H_Q`, `n_questions` and `n_families`.
- **Words:** `assignment-mismatch` (the sourced lists disagree), `input-invalid` (`sourced node-missing`, a qid or store
  mismatch), `out-refused` (`--out` already holds another frozen list, which is never replaced), the writer's preflight
  words, and the limits and budget stops.

## Act 17: open --finalize, part 2 (operator)

- **Command** (§4 step 5, §5 act 17; W2-D25, W2-D73; W2-5a Task 7 with W2-5b2 Task 2's edits; D-6280, Q27, K21):
  ```
  replay open --finalize --record <P>/part1.json --record-sha256 <H1> \
    --census <P>/census.json --census-sha256 <H_C> --verify <P>/verify-registry.json --verify-sha256 <H_VR> \
    --power <P>/power.json --power-sha256 <H_PW> \
    --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> \
    --quiz-meta <OUT_QUIZ>/quiz/frozen.meta.json --quiz-meta-sha256 <H_QM> \
    --pilot-result <OUT_PILOT>/pilot-result.json --pilot-result-sha256 <H_PR> \
    --spend-budget <B> --window-start <S_ms> --window-end <E_ms> --q18-decision keep|lengthen|add-nodes \
    [--accept-failed-pilot] [--prior-final <P>/part2.v<k-1>.json --prior-final-sha256 <H2_prev>] \
    > <P>/part2.v<k>.json                                  # <cur part2>; k is 1 for the first final
  ```
- **`--spend-budget <B>`** is your echo of the derived figure:
  `ceil(5 × n_questions × pilot spend / (4 × pilot questions))`, in BigInt, over the frozen list's entry count. A mismatch
  refuses `args-invalid`, and the refusal prints the derived figure and its inputs: `spend-budget <given> is not the derived
  <B> = ceil(5 x <n> x <total> / (4 x <pilot questions>))`. `pilot-result.json`'s `at_target` figure is for `quiz.target`
  questions, not the frozen count, so echo the derived figure, never `at_target`'s.
- **The window.** `<E_ms> − <S_ms>` must lie in [planned_days × 86,400,000, planned_days × 86,400,000 + 86,400,000]
  (W2-D25).
  - Choose `<S_ms>` far enough ahead to finish acts 18 and 19 plus at least one sweep tick.
  - After `<S_ms>`, part 2 can be superseded only by `open --amend` (W2-D90). Before it, a pre-window amendment may
    supersede part 2 wholesale, through `--prior-final`.
- **Post `H2` before `<S_ms>`.** Part 2 must also be signed before any `recall-off` file is written.
- **Words:**
  - `assignment-mismatch`: different census or verify files from act 16;
  - `quiz-sha-mismatch`;
  - `input-invalid`: `quiz-meta below-floor` (the remedy is a superseding draft that lowers `quiz.halt_floor`, which is a
    ruling: it re-runs acts 12 to 17, a full re-pilot and its spend included; see act 12, "Any superseding draft"); `power inputs-mismatch`; a pilot result written under another part 1 (K21);
  - `pilot-failed`: a failed pilot without `--accept-failed-pilot`. The flag on a passed pilot is refused;
  - `args-invalid`: the spend-budget echo, `q18-decision`, or `--accept-failed-pilot` on a passed pilot;
  - `record-invalid`: for example a 13-day window.

## Act 18: the recall-off writes (operator)

- **Commands** (§5 act 18; W2-D27, W2-D84, W2-D26; W2-5b1 Task 3):
  ```
  replay marker --section ab --record <cur part2> --record-sha256 <H2> --part1 <P>/part1.json --part1-sha256 <H1> \
    --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> --node-label <node-label> [--supersedes …] > <P>/ab-lines.txt
  # each line reads: ccrc history recall-off <id> --generation <G>
  # run each line with <home>/.local/bin/ccrc in place of ccrc
  ```
- **`recall-off` writes as invoked.** It has no dry run (W2-D26).
- **A refused write** (`generation-malformed`, `generation-mismatch` or `generation-unreadable`, exit 2) leaves that family
  `assignment-unrealised`. **Never retry it with another generation** (W2-D23, W2-D27). Record each refusal as a count.
- **Exit 4 `writer-busy` is not a refusal:** a sweep pass holds the lock, and nothing was written. Re-run the same line
  unchanged when the pass ends, and do not count it. Only exit 2 with `generation-malformed`, `generation-mismatch` or
  `generation-unreadable` is a refusal. A control family left unwritten reads `control-absent` at act 19 and keeps
  recall.
- **`ab-lines.txt` is private.** It holds ids and generations.
- **Post:** the count of lines run and the count refused.

## Act 19: the quiz marker and verification (operator)

- **Commands** (§5 act 19; W2-D84, W2-D31; W2-5a and W2-5b1 Task 3). Everything here happens before `<S_ms>`.
  ```
  replay marker --section quiz --record <cur part2> --record-sha256 <H2> --part1 <P>/part1.json --part1-sha256 <H1> \
    --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> --node-label <node-label> [--supersedes …] > <P>/headless-on.quiz
  install -m 0600 <P>/headless-on.quiz <home>/.ccrc/history/headless-on
  # wait at least one sweep tick after the last recall-off write
  replay verify --section ab   --record <cur part2> --record-sha256 <H2> --part1 <P>/part1.json --part1-sha256 <H1> \
    --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> [--supersedes …] > <P>/verify-ab.start.json
  replay verify --section quiz --record <cur part2> --record-sha256 <H2> --part1 <P>/part1.json --part1-sha256 <H1> \
    --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> [--supersedes …] > <P>/verify-quiz.start.json
  ccrc history status --json            # recall_off.seen_ms must be later than the newest write
  ```
- **Check.**
  - `verify --section ab`: each family `ok`, `control-absent`, `control-mismatch`, `treatment-named` or `unreadable`,
    never folded. A non-`ok` family leaves every per-arm figure (V1).
  - `verify --section quiz`: `ok` (the headless-on sha equals the marker's), and `over_hide` counts D-6284's over-hide on
    this node.
  - `seen_ms` is later than the presence directory's mtime: `seen_after_write` is `true` in `verify-ab.start.json`.
- **Post:** both verify shas and the counts per state.

## Act 20: stamps and versions at window start (coordinator; checkpoint)

- **Act** (§5 act 20; W2-D6). At `<S_ms>`, re-measure the fleet box's release stamp and its live Claude Code version, and
  record both in the ledger.
  - The stamp comes from `ccrc version` or `GET /api/updates`, and must be `<tag>`.
  - The version comes from `<launcher> --version`, W2-D56's instrument and the driver's own: the account's launcher under
    `<home>/.local/bin`, its first stdout line. It spends nothing and reads no store; the release has no read-only reader of
    the live version. The first window batch's manifest (`<OUT_ARMS>/quiz/arms/batches/0001.json`, `claude_code_version`)
    records what that batch's preflight measured.
- **Waits:** act 21's first batch waits until the coordinator has recorded both values for `<S_ms>` (§5: an italic act
  gates the next operator act). A stamp other than `<tag>` is a `tree-moved` breach: see the table.

## Act 21: the arm and judge batches during the window (operator)

- **Commands** (§5 act 21; W2-D78, W2-D80, W2-D56, W2-D55; W2-5b1 Tasks 4-5; Q5, K25 to K27). Both arms of each question
  run side by side, `floor(batch_max/2)` questions per batch, and the batches loop within one invocation.
  ```
  replay arms  --section quiz --out <OUT_ARMS> --record <cur part2> --record-sha256 <H2> \
    --part1 <P>/part1.json --part1-sha256 <H1> --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> \
    [--supersedes <P>/part2.v<k-1>.json --supersedes-sha256 <H2_prev>]
  #   stderr: "spend share <s> = ceil(<B> x <n> / <N>)", <B> the budget in force, then sha256 of <OUT_ARMS>/quiz/arms/summary.json
  replay judge --section quiz --out <OUT_ARMS> (the same record, part1, frozen and supersedes flags)
  #   → <OUT_ARMS>/quiz/judged.json and <OUT_ARMS>/quiz/judge/<id>.input.json
  ```
  Pass `--supersedes` only once part 2 supersedes an earlier final (an amendment, or a pre-window `--prior-final`),
  naming the final the current one supersedes (W2-D25). The chain is checked one link at a time, so after any number
  of amendments `--supersedes` names only the current record's direct predecessor (for the second amendment's
  consumers, `--record <P>/part2.v3.json --supersedes <P>/part2.v2.json`). An amended record read without it refuses
  `record-invalid`. Never pass `--allow-code-change`: there is no freeze exception in this window (R-B2).
- **Stops:** re-run the same command on the same `--out` (see the table). Stopped questions are `not-run`, not failed
  (W2-D80).
  - On a second infrastructure failure, the question is `run-failed` and excluded from both arms.
  - The budget remains a soft stop. K25 reads the judge's gate as judge spend only, while `arms` counts all spend; the
    overshoot is disclosed, not capped.
  - A `budget-exhausted` stop: on the operator's ruling, write a budget raise (R-B1; "A budget raise" below), then
    follow every amendment's rules (W2-D90, K8).
- **After a `claude-version-moved` stop** (W2-D56, W2-D90; W2-5b2 Task 3; Q12, K1, K7, K22). Each re-pilot gets a fresh
  `<OUT_REPILOT_m>`.
  ```
  replay step0b       --section quiz --out <OUT_REPILOT_m> --record <cur part2> --record-sha256 <H2> \
    --part1 <P>/part1.json --part1-sha256 <H1> --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> [--supersedes …]
  replay fidelity     --section quiz --out <OUT_REPILOT_m> (the same flags)
  replay pilot-result --section quiz --out <OUT_REPILOT_m> (the same flags) \
    --step0b <OUT_REPILOT_m>/quiz/step0b/<mode>.json --step0b-sha256 <h> \
    --fidelity <OUT_REPILOT_m>/quiz/fidelity.json --fidelity-sha256 <h>
  #   → <OUT_REPILOT_m>/quiz/repilot-result.json, sha256 <H_RP>
  replay open --amend --kind version-move --record <cur part2> --record-sha256 <H2> \
    --part1 <P>/part1.json --part1-sha256 <H1> --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> [--supersedes …] \
    --node-label <node-label> --claude-code-version "$(jq -r .claude_code_version <OUT_REPILOT_m>/quiz/repilot-result.json)" \
    --repilot <OUT_REPILOT_m>/quiz/repilot-result.json --repilot-sha256 <H_RP> > <P>/part2.v<k+1>.json
  ```
  - `--claude-code-version` must equal, byte for byte, the version the re-pilot recorded: the whole first stdout line
    of `<launcher> --version`, trimmed, not a bare version number. Otherwise `input-invalid` `repilot version-mismatch`.
  - **Post the new `H2` before the next batch** (W2-D90).
  - Then re-run `arms`, `judge` and both `verify` sections under the new record (K8), each verify to a new name:
    `replay verify --section quiz … > <P>/verify-quiz.v<k+1>.json` and
    `replay verify --section ab … > <P>/verify-ab.v<k+1>.json`. Never write over `*.start.json`. A question half done on the old
    version re-runs both arms under `<arm>.m<i>.a<n>`, with attempts starting at 1 (K7, K27).
  - A failed re-pilot cannot be amended (K22 (c)). The operator rules whether the window stands.
- **A forced frozen act** (W2-D7; W2-5b2 Task 3 `AMEND_DETAILS`):
  ```
  replay open --amend --kind forced-act       … --act <name> --act-ms <ms> [--node-label <node-label>] > <P>/part2.v<k+1>.json
  ```
  - Post the sha before the next batch. The next `arms` batch's W2-D78 (iii) re-check must pass, and the operator rules
    whether the quiz and the window stand (W2-D7).
- **A budget raise** (W2-D90, W2-D55 as D-7063 amends it; W2-7 Tasks 1 and 2; R-B1). Only on the operator's ruling, from
  part 2 on, before window start or during it:
  ```
  replay open --amend --kind budget-raise --spend-budget <N> --record <cur part2> --record-sha256 <H2> \
    --part1 <P>/part1.json --part1-sha256 <H1> --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> [--supersedes …] \
    > <P>/part2.v<k+1>.json
  ```
  - `<N>` is the whole new budget, not an increment. It must be strictly above the budget in force: the signed
    `spend_budget`, or the newest earlier raise. A raise names no node: the budget is the record's, and each node's share
    is `ceil(<N> × n_node / n_all)` (Q5), so one raise moves every node's share. `--node-label` is not a `budget-raise`
    flag. A pre-window `open --finalize --prior-final` rebuilds part 2 with no amendments, so a raise made before it is
    dropped: raise again after it if needed.
  - Like every amendment it prints the superseding part 2 on stdout and `sha256 <hex>` on stderr, and writes nothing.
    Save it 0600 off-repo, outside every `--out`. **Post the new `H2` before the next batch** (W2-D90).
  - Words:
    - `record-invalid` naming `<path> <word>`: `budget-not-raised` at `amendments[<i>].detail.spend_budget` (at or below
      the budget in force); `field-missing` or `field-malformed` there (absent or null, or no safe integer); `field-unknown`
      at another detail key; `value-outside-set` at `amendments[<i>].node_label_ref`. All but `budget-not-raised` arise
      only from a hand-written record, which every part 2 consumer refuses the same way;
    - `args-invalid`: `spend-budget-required`, `--spend-budget wants a positive integer, got "<text>"`, or
      `--<flag> is not a budget-raise flag`;
    - `record-*`, `code-*`, as for every amendment.
  - **A pending version move is written before a raise.** A raise appended between a re-pilot and its version-move
    changes the record's sha, so `open --amend --kind version-move` refuses `input-invalid` `repilot record-mismatch:
    re-piloted under <A>, amending <B>`, prints nothing, and the re-pilot, which spends, runs again. A raise owed before
    any re-pilot runs (for instance because the re-pilot itself stopped on a spent budget) is written first, and the
    re-pilot then runs under the raised record, on a fresh `--out` (below).
  - **A quiz re-pilot stopped on a spent budget re-runs whole** (review 1030 F1). Its version pin holds the old record's
    sha, so on its own `--out` after a raise it is refused `out-refused` (`quiz/repilot-version.json is another
    re-pilot's (record <sha>, store <id>): one re-pilot per --out, …`) before any spawn. Run step 0b and fidelity again,
    under one record, on a fresh `<OUT_REPILOT_m>` under the raised record. Its earlier spend does not carry into the fresh
    spend ledger, so size the raise knowing that. `arms` and `judge` do resume on their own `--out`.
  - **After the raise**, as after every amendment: each node's arms summary, `judged.json` and verify outputs written
    under the old record refuse `input-invalid` `record-mismatch` at `report`. Each affected node re-runs `arms` (a
    settled question spawns nothing), `judge` and both `verify` sections under the new record (act 24, "The record").
- **No release install and no wrapper change** (the operator's ruling of 2026-10-26, R-B2). From act 6 to act 28 no release is
  installed and the account's wrapper does not change. There is no freeze exception: the `freeze-exception` amendment
  kind and `--allow-code-change` are not used. If an install or a wrapper change is forced (a security fix, an account
  outage), W2 halts and closes with no verdict: acts 26 to 29 (see the halts table). The code would refuse the
  amendment anyway once a `gate_code` file differs: `open --amend` takes no `--allow-code-change` and refuses
  `code-changed`.
- **Waits:**
  - the 70% threshold;
  - `limits-stale`: a statusline render;
  - every question must be settled before `judge`, act 22 and act 24: `judge` and `report` refuse an unsettled one
    (`input-invalid` `arms-unsettled`).

## Act 22: the hand-check sheet (operator labels; nobody else does)

- **Command** (§5 act 22; W2-D81, W2-D54; W2-5b2 Task 4; Q18, Q19, K9, K10). With one node, the reporting node is the
  fleet box, and `--judged` names act 21's file in place.
  ```
  replay handcheck --sheet --out <OUT_REPORT> --record <cur part2> --record-sha256 <H2> \
    --part1 <P>/part1.json --part1-sha256 <H1> --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> \
    --judged <OUT_ARMS>/quiz/judged.json --judged-sha256 <H_J> [--supersedes …]
  #   → <OUT_REPORT>/handcheck/sheet.txt and sheet.json (sha256 of sheet.json on stderr)
  ```
  With one node there is nothing to gather: act 24 passes every input in place, by path and sha. `report` reads the
  answer records beside `--arms-summary`, which must sit at `<OUT_ARMS>/quiz/arms/summary.json`, and both `handcheck`
  and `report` read each sampled judge input beside `--judged` (`<OUT_ARMS>/quiz/judge/<id>.input.json`).
- **Label file.** You write it yourself, e.g. `<OUT_REPORT>/handcheck/labels.txt`.
  - Format: one `<id> uncertain` or `<id> fabricated` per line. Blank lines and `#` lines are allowed. No trailing
    comment, no CR.
  - Every sampled judged id must be labelled, or act 24's `report` refuses `labels-missing`. It also refuses every
    label-line error (`labels line <n> …`, `labels not-utf8`): `handcheck --sheet` never reads the label file.
  - Label every `judge-failed` id too. One left unlabelled makes the verdict `incomplete` (W2-D89).
- **Words:** `input-invalid` (`judged <k> …`, `judged-missing`), `out-refused`
  (`handcheck-sheet-changed` or `handcheck-manifest-changed`: the judged input or the record changed since the sheet was
  made; make the sheet on a fresh `<OUT_REPORT_n>` and label it again).
- **Post:** nothing but the sheet manifest's sha. The coordinator sees aggregates only (W2-D81).

## Act 23: window end: stamps, measure, counters (coordinator re-measures; operator runs)

- **Coordinator, at `<E_ms>`** (§5 act 23; W2-D6): re-measure the release stamp and the live Claude Code version, as at
  act 20, and record both.
- **Operator, at or after `<E_ms>` and after the coordinator has recorded the window-end stamp and version**, while the `recall-off` files and the marker are still in place (they go at acts 26
  and 27):
  ```
  jq -c '[.assignment[] | {store_id, ccrc_id, generation}]' <cur part2> > <P>/families.json
  measure --families <P>/families.json --window-start <S_ms> --window-end <E_ms> --row-cap 400 > <P>/measure.json
  sha256sum <P>/measure.json                                                     # H_M
  replay verify --section ab --record <cur part2> --record-sha256 <H2> --part1 <P>/part1.json --part1-sha256 <H1> \
    --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> [--supersedes …] > <P>/verify-ab.end.json   # H_VAE
  counters count --record <cur part2> --record-sha256 <H2> --part1 <P>/part1.json --part1-sha256 <H1> \
    --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> [--supersedes …] \
    --measure <P>/measure.json --measure-sha256 <H_M> --verify-ab <P>/verify-ab.end.json --verify-ab-sha256 <H_VAE> \
    --store <home>/.ccrc/history/db/history.db --out <OUT_COUNT>
  #   → <OUT_COUNT>/counters.json, sha256 <H_CT> on stderr
  counters combine --node-report <OUT_COUNT>/counters.json --node-report-sha256 <H_CT> --out <OUT_COMBINE>
  #   → <OUT_COMBINE>/counters-combined.json
  ```
  - `--families` must list exactly the assignment, both arms. No subcommand prints that list, so this runbook derives it
    from part 2. An assigned family left out is excluded from the report as `not_listed`.
  - Counters (W2-D86, W2-D87, W2-D88; W2-6 Tasks 1 and 3) are report-only: `report` never reads them.
  - `combine` is W2-6's act 24 step; it is run here so act 24 has its inputs.
  - The verify output is re-run here because `count` and `report` both refuse one whose presence record is stale
    (`seen_after_write` not `true`; W2-6 V2, W2-5b2 K11).
- **Words:**
  - from `measure`: exit 2 with `--families needs --row-cap`;
  - from `count`:
    - `input-invalid`: `window-open` before `<E_ms>`, `measure-store-mismatch`, `verify-ab-…`, or
      `verify-ab-presence-stale`;
    - `record-invalid`: `counters_def` is not `v1`;
    - `args-invalid`: `--store names no absolute path`;
    - an existing `--out`, which is refused;
    - `assembleReports`' refusals, such as a row-cap or window mismatch (W2-D22).
- **Post:** the counter aggregates by arm and producer, and `H_CT`.

## Act 24: the report (operator)

- **Command** (§5 act 24; W2-D85, W2-D89, W2-D22, W2-D23; W2-5b2 Task 5; K8, K11, D-6646). Every input is sha-checked
  before a byte is parsed, and every refusal comes before `--out`.
  ```
  replay report --out <OUT_REPORT> --record <cur part2> --record-sha256 <H2> \
    --part1 <P>/part1.json --part1-sha256 <H1> --frozen <OUT_QUIZ>/quiz/frozen.json --frozen-sha256 <H_Q> \
    --arms-summary <OUT_ARMS>/quiz/arms/summary.json --arms-summary-sha256 <H_AS> \
    --judged <OUT_ARMS>/quiz/judged.json --judged-sha256 <H_J> \
    --verify-quiz <P>/verify-quiz.v<k>.json --verify-quiz-sha256 <h> \
    --sourced <OUT_QUIZ>/quiz/sourced.json --sourced-sha256 <H_SRC> \
    --verify-ab <P>/verify-ab.end.json --verify-ab-sha256 <H_VAE> \
    --measure <P>/measure.json --measure-sha256 <H_M> \
    --labels <labels file> --labels-sha256 <H_L> [--supersedes …]
  #   → <OUT_REPORT>/verdict.json, written once, sha256 <H_V> on stderr
  ```
- **The record:** every node output must name the current record's sha. After any amendment, re-run `arms`, `judge` and
  both `verify` sections first (K8). `--verify-quiz` names the quiz verify output written under `<cur part2>`:
  `<P>/verify-quiz.v<k>.json`, or `<P>/verify-quiz.start.json` if part 2 was never amended.
- **Words:**
  - `input-invalid`: a stale verify output (K11), an output of another record, or `window-open` before `<E_ms>`;
  - `input-invalid` `arms-summary <store>: quiz/answers/<qid>.<arm>.json is not a settled answer record`: an answer
    record edited or damaged, such as one marked correct whose answer state is not `value` (W2-7, CP-27 F1; see the
    halts table);
  - `input-invalid` `verify-ab <store> lists "<id>" …`, one detail per defect (W2-7, CP-27 A10): `off the record's
    assignment` (an entry that is no object, or names no assigned family of this store), `under arm "<a>", not the
    record's "<b>"`, or `in state "<s>", not one of AB_STATES`. Pass the verify output act 23 wrote under `<cur part2>`; if that output
    itself gives one of these, it was edited or damaged: re-run act 23's verify;
  - `out-refused`: `verdict.json` already exists in `--out` (use a fresh one);
  - `input-invalid` `arms-unsettled` (or `decideGate`'s `question-not-run`, printed as `input-invalid` too): resume act
    21, since it is not a halt (W2-D89 amendment);
  - `assembleReports`' words, mapped to driver words (W2-D22);
  - `record-*`, `code-*`.

## Act 25: the gate decision (operator records; coordinator computes and posts)

- **Act** (§5 act 25; W2-D89; Q7, Q14).
  - Read `verdict.json`: `pass`, `fail`, `halt` or `incomplete`, with every criterion that could be computed. A
    `code-changed` stamp is carried onto the verdict; under R-B2 no batch carries one.
  - Record the decision: pass, fail, or a ruling on any halt, with `H_V`.
- **Post:** the aggregates and the decision:
  - the arm accuracies and fabrication rates with their CIs;
  - live uptake per window and per turn by arm and producer;
  - the first-call difference;
  - the drop counts;
  - the absent and run-failed rates;
  - judge and hand-check agreement by arm;
  - `H_V`.

## Act 26: clear the recall-off files (operator)

- **Command** (§5 act 26; spec §10.6 item 4, RP10; W2-D7): `ccrc history recall-off --clear-all`. Exit 4 `writer-busy`
  is not a refusal: a sweep pass holds the lock, so re-run it when the pass ends.
- **Check:** `skipped` must be `[]`. Otherwise remove each named entry under `<home>/.ccrc/history/recall-off/` by hand
  (`rm` for a FIFO, socket or device, `rmdir` or `rm -r` for a directory), and re-run `--clear-all` until `skipped` is
  empty. The names are family ids: never post them.
- **Post:** only the count cleared.

## Act 27: remove headless-on (operator)

- **Command** (§5 act 27): `rm <home>/.ccrc/history/headless-on`. No verb removes it.

## Act 28: restore update intent; lift the maintenance freeze (operator)

- **Act** (§5 act 28; W2-D6, W2-D7): set the fleet box's update intent back to its value before act 6. Record the time the
  freeze lifted. Merges since the freeze reach the node only from here on.
- **How:** `POST /api/updates/intent` from a signed-in session with `"scope": "<node>"` and exactly the node row's
  recorded `channel`, `pinnedTag`, `auto` and `notify`. The route patches only the keys it is sent. `pinnedTag: null`
  clears a pin: send it only when the recorded row had none. If the node had no row before act 6, there is no way back
  to "no row": set the node row to the `*` values recorded before act 6, not the current ones, and record that the
  node now carries its own row. If the `*` row was changed (the PWA's "Off"), also POST `"scope": "*"` back to its
  recorded values. The coordinator reads `GET /api/updates` to confirm both rows and the node's `desiredTag`, and posts
  the time.

## Act 29: archive and remove the --outs (operator)

- **Act** (§5 act 29; W2-D53, spec §9.4 `history-replay-out`).
  - Copy into private storage: `verdict.json`; `counters.json` and `counters-combined.json`; both record parts with every
    amendment; the hand-check aggregates (sheet.json and the label file).
  - Then remove by hand every directory listed in `<P>/outs.txt`: `<OUT_0A>`, `<OUT_PS>`, `<OUT_PILOT>`, `<OUT_QUIZ>`,
    `<OUT_ARMS>`, each `<OUT_REPILOT_m>`, `<OUT_REPORT>` and each `<OUT_REPORT_n>`, `<OUT_COUNT>`, `<OUT_COMBINE>`,
    `<OUT_PROBE>` if it was made, and every superseded fresh `--out` from a re-run of acts 7, 9, 14, 16, 22, 23 or 24.
    They hold transcripts, scores and spend ledgers. Before `rm -r <dir>`, check that `<dir>/.ccrc-history-replay` reads
    `ccrc-history-replay-out`. Nothing in the tree removes them.
- **The seed may now be published** (W2-D25).

## Halts and the abort path

The **markers in place** at each point:
- `freeze` is the maintenance freeze, from act 8;
- `intent` is update intent pinned or off, from act 6;
- `pilot-HO` is the pilot headless-on, acts 13 to 15;
- `RO` is the `recall-off` files, from act 18;
- `quiz-HO` is the quiz headless-on, from act 19;
- `outs` is the `--out`s that exist.

**Undo** names the close acts to run.

| Halt | Raised by | Markers in place | Undo | W2-D86 counters? |
|---|---|---|---|---|
| Step 0b fails (W2-D57, W2-D58) | act 14a `pilot-failed` | freeze, intent, pilot-HO, outs | none: re-pilot (the operator's ruling of 2026-10-26, R-B3). Fix the cause, then a superseding draft and acts 12 to 17, as act 14a says. Nothing is accepted. If W2 closes instead: 27 (pilot-HO), 28, 29; 26 is not needed | No: a halt before window start closes W2 without W2-D86's counter report, and the ledger records the halt (the operator's ruling of 2026-10-26, R-B4). With no part 2 there is nothing to count. |
| Fidelity or usage pilot fails (W2-D76, K13) | acts 14b and 14d `pilot-failed` | the same | by ruling: re-pilot as for step 0b, or close with 27 (pilot-HO), 28, 29. Or, to accept: after a 14b failure, finish 14c and 14d (after a 14d failure `pilot-result.json` already exists), then act 17 with `--accept-failed-pilot` | No (as above) |
| A failed fidelity or usage pilot accepted (never a failed step 0b, R-B3) | act 17 `--accept-failed-pilot` (Q27) | none extra | none: continue | Yes, at act 23. The coordinator records the use (K14). |
| Q18 change (`lengthen` or `add-nodes`) | act 12 | freeze, intent, outs | none for `lengthen`: supersede the draft and repeat 11-12. `add-nodes` needs a ruling. | n/a (no halt) |
| Quiz floor (fewer than 60 questions or 12 families) | act 16; finalize refuses `below-floor` | freeze, intent, outs (pilot-HO already gone) | to abort: 28, 29. To proceed: a ruling, then a superseding draft that lowers `quiz.halt_floor`, built from the old draft's overrides file with that key added (act 12, "Any superseding draft"). That draft changes `H1`, so pilot-result's `record_sha256` no longer matches (K21). Finalize binds power, the quiz meta and the pilot result to part 1's sha, so acts 12-17 re-run. Act 11's census and `verify --registry` outputs are not bound to `H1` and carry over while `active_rule.lookback_ms` is unchanged. | No: an abort here closes W2 without W2-D86's counter report (R-B4) |
| Failed re-pilot (K22 (c)) | act 21 | all, incl. RO and quiz-HO | if the window does not stand: 26, 27, 28, 29 | Only at or after `<E_ms>` (`window-open` otherwise). Either keep the markers until `<E_ms>` and run act 23, or record an operator ruling to close without it. |
| A release install or a wrapper change from act 6 to act 28 (`tree-moved`, `code-changed`, `wrapper-moved`; the operator's ruling of 2026-10-26, R-B2) | any preflight or batch | all present at that point | 26 (only if act 18 ran), 27, 28, 29, with no verdict. There is no freeze exception and no roll back and resume | No: R-B2 closes W2 with acts 26 to 29 only. Before window start, R-B4 says the same |
| Absent rate over `absent_rate_max` in either arm (W2-D64, W2-D89) | act 24 verdict `halt` | RO and quiz-HO already handled by the order 23 → 24; clearing waits for 26 | 26-29 after the ruling | Yes: act 23 ran before the report |
| Run-failed over `run_failed_max` (5%) (W2-D80, W2-D89) | act 24 `halt`; criteria 1 and 2 not computed | the same | the same | Yes |
| Hand-check agreement under 0.8 (W2-D81, W2-D89) | act 24 `halt` | the same | the same | Yes |
| `empty-arm` (W2-D89) | act 24 `halt` for criterion 1 or 3 | the same | the same | Yes |
| A judge-failed item unlabelled | act 24 `incomplete` (a hold) | the same | none: label it (act 22) and re-run act 24 on a fresh report `--out`: `verdict.json` is written once, and the old `--out` refuses `out-refused` | Yes |
| An unsettled question at gate time | act 24 `input-invalid` `arms-unsettled` (not a halt) | the same | none: resume act 21, then re-run act 22 on a fresh `<OUT_REPORT_n>`, label its sample, and run act 24 there. Act 23's outputs stand while the record is unchanged. | Yes |
| Answer records edited or corrupted: two records of one arm on one node with their `answer_field.state` swapped, under an unchanged per-arm arms summary (a W2-5b2 residual, closed by W2-7, CP-27 F1) | act 24 `report` refuses `input-invalid` `arms-summary <store>: quiz/answers/<qid>.<arm>.json is not a settled answer record`, naming the record marked correct, before `--out`; nothing is written | the same | none: restore the answer records `arms` wrote under `<OUT_ARMS>/quiz/answers/`, then re-run act 24 on a fresh report `--out` | Yes |

In every abort, the order is fixed: 26 (only if act 18 ran), then 27 (if a marker is on disk), then 28, then 29. Record each
time, and the ruling's own time, in the ledger. A halt before window start closes W2 without W2-D86's counter report,
and the ledger records the halt (the operator's ruling of 2026-10-26, R-B4).

## Coordinator duties during the window

- **No freeze exception (W2-D6; the operator's ruling of 2026-10-26, R-B2).** From act 6 to act 28 no release is installed
  and the account's wrapper does not change. If either is forced (a security fix, an account outage), W2 halts and closes
  with no verdict (acts 26 to 29). Record the halt, its cause and its time in the ledger.
- **Record every `--accept-failed-pilot` use** in the ledger as the operator's act, with the failures it printed (Q27, K14).
- **Record each forced frozen act** with its time, its amendment's sha, and the result of the next
  arms batch's W2-D78 (iii) re-check, which must pass (W2-D7).
- **Record each budget raise** in the programme ledger, like every amendment: its time, its figure and its amendment's
  sha (R-B1, D-7063).
- **Re-measure the release stamp and the live Claude Code version** at window start (act 20) and at window end (act 23).
  Both go in the report (W2-D6).
- **Record every posted sha** (`H_0A`, `H_PS`, `H_PF`, `H1`, `H_C`, `H_VR`, `H_PW` with the Q18 decision and its scalar figures, `H_0B`, `H_PR`,
  `H_Q`, `H2` and every amended `H2`, `H_V`) and the freeze start and end times. Check each public line against the
  private-name rule before posting.
- **Compute and post the gate** from `verdict.json`'s aggregates, as W2-D89 restates Q7 and Q14:
  - treatment point accuracy ≥ 0.40, and the paired CI lower bound of (treatment − control) > 0;
  - treatment fabrication ≤ control + 0.03;
  - the within-arm CI lower bound of the treatment window share ≥ 0.10.

## Where things stand

**Agreed**
- One named node, the fleet box (ruling 2026-10-25). Acts 7 to 29 run there in §5's order.
- Every W2 PR is merged; W2-5b1 (#1497), W2-6 (#1547), W2-5b2 with K25 to K27 (#1560) and W2-7 (#1641) were the last.
  Every verb, flag, refusal word and output path here was checked against `v0.0.740`'s code, which `v0.0.745` carries
  unchanged.
- The two-part record, saved 0600 off-repo, with only shas, counts and aggregates public (W2-D25).
- Stops resume and refusals need a changed input (`DRIVER_STOPS` and `DRIVER_REFUSALS`). `pilot-failed` halts (K3).
- A quiz-floor superseding draft cannot reuse the pilot result: `open --finalize` refuses one written under another
  part 1 (K21), so acts 12 to 17 re-run.
- A spent budget after part 2 (the operator's ruling of 2026-10-26, R-B1): built by W2-7 (#1641, D-7063) as the
  amendment kind `budget-raise`, which only raises the budget in force and moves nothing that scores. The final W2
  release carries its merge (`c1770fbf4`, first released as `v0.0.740`): the fleet box's release at act 6 with the
  same history code (`v0.0.745` on 2026-10-27), not `v0.0.730`, and acts 7 onward run only on it.
- No release install and no change to the account's wrapper from act 6 to act 28 (R-B2). There is no freeze exception.
  If either is forced, W2 halts and closes with no verdict (acts 26 to 29). `tree-moved`, `code-changed` and
  `wrapper-moved` are halts. This settles both freeze-exception questions: no release is installed in the window, so
  no `gate_code` file moves under the record and no re-pilot runs under a moved tree.
- A failed step 0b halts and re-pilots (R-B3, K2's letter): fix the cause, then a superseding draft. Nothing is accepted
  past it, and no pilot act runs without `--step0b` after it.
- A halt before window start closes W2 without W2-D86's counter report (R-B4). With no part 2 there is nothing to count.
  The close acts 26 to 29 run, and the ledger records the halt.

**Waiting on you**
- Act 1's account and the three exact model ids (arm, writer, judge).
- Acts 5 and 6: the coordinator posts the final W2 release's tag (`v0.0.745` as measured on 2026-10-27); roll it onto
  the fleet box only if the box is not on it, then pin its update intent to that tag (or set it off) and record the
  time. The rest of "Before act 7" follows.
- Rulings this runbook cannot make: none left. The operator's ruling of 2026-10-26 settled all six.

**Later**
- Publishing the seed after close (W2-D25).
- W3 and W4, only on a pass (spec §10.6 item 5).
