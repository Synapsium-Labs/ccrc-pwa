# Program: ccrc-history

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.5; operator-approved design,
rulings Q1–Q14 of 2026-10-05 and Q15–Q19 of 2026-10-07; rev 3.5 folds in the refresh reviews' rulings, below)
Plans: `docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md` (waves 1 and 2: W1 Part A and W1-B1, merged);
`2026-10-06-ccrc-history-w1-b2-recall.md` (wave 3), `2026-10-07-ccrc-history-w1-b3-card-line.md` (wave 4) and
`2026-10-07-ccrc-history-w1-b4-export.md` (wave 5), operator-approved 2026-10-07 and refreshed on B1's merged code.
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-ridge`   Workspace: **a fresh child per wave** (one PR per child)

**What this program is.** ccrc keeps its own lossless, searchable copy of every Claude Code session transcript on
each box that hosts sessions, and gives a session a way to recall what it compacted away: a per-box SQLite store
(node:sqlite + FTS5) fed by a sole-writer indexer from hook spool lines, a DAG of summaries (native leaves first,
session-written leaves in W3), and a `ccrc history` CLI plus a skill. Modelled on lossless-claw (MIT), ported rather
than depended on (spec §11–§12). A replay eval (W2) decides whether W3 and W4 ship at all.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | W1 Part A: Node floor `>=22.16.0` in the three engines, node-floor assertion 4, the `node floor (22.16.0)` CI leg (plan Tasks 1–2) | engines + CI; full suite | #300 | **merged** 2026-10-06 16:53Z as `f7e51156f` (run 293, after review 298, fix round 1 and review 301) |
| 2 | W1-B1 "capture": `lib.mjs`, `store.mjs`, `sweep.mjs`, the shim, the hook's spool line, journal + pre-migration snapshot + purge carve-out, `status`, install/uninstall/deploy, doctor `history`, lifecycle rows, `measure-history.py` (plan Tasks 3–36). Sessions see no change | fleet (shim + timer); full suite (ci.yml) | #315 | **merged** 2026-10-09 02:12Z as `69ef7102b` at head `561609adc` (run 302, after reviews 316, 344, 351 and 353 and fix rounds 1–3) |
| 3 | W1-B2 "recall": read verbs, parser, native leaves, the skill, operator verbs (`prune`, `doctor --repair/--backup/--adopt/--restore/--rebuild/--migrate`, `reparse`), recovery step | fleet + skills | — | run 354 open (planned); dispatched once this ledger's docs PR merges |
| 4 | W1-B3 "card line": scope marker, `_hook_history_card`, the S6-R11 census re-measure | fleet (hook) | — | plan on `main` with this ledger; after wave 3 |
| 5 | W1-B4 "sole-copy export" (ruled Q6, e) | fleet | — | plan on `main` with this ledger; after wave 3 (B3 first by default; B3's tick-order script is order-independent); **live on every session-hosting node before the earliest W1-k date, at the latest 2026-12-19** |
| 6 | W2: the headless seam, the replay driver, the quiz and the live A/B; the gate (ruled Q7, Q14) | fleet | — | after waves 3 and the backfill |
| 7 | W3: steering (session-written leaves) | fleet (hook) | — | only if the W2 gate passes |
| 8 | W4: subagents and `touched` | fleet | — | only if the W2 gate passes, and never before wave 5 is live |

## Decisions & deviations

- **Operator rulings 2026-10-05** (spec §15.1): Q1 fixed root + `db/` symlink; Q2 spool on PostCompact, Stop,
  SessionStart(startup|resume|clear); Q3 many fleet and many server boxes (one store per session-hosting box, none on
  a server box); Q4 the disk spec's `history` role; Q5 exact span partition; Q6 backup = pre-migration snapshot +
  retained journal + purge keeps the store + restore/rebuild in W1, sole-copy export before retention bites, no
  scheduled full copies; Q7 cluster-bootstrap gate; Q8 recall on every provider and lane, surviving provider
  migration; Q9 archive-quoted gists; Q10–Q14 as recommended.
- **Operator rulings 2026-10-07** (spec rev 3.4): Q15 per-copy export due (B2 Task 35 makes it the default); Q16
  `SessionStart(fork)` spools from W1-B2 (B2 Task 34); Q17 `--purge` keeps history with a warning, `--purge-history`
  removes it; Q18 the smallest uptake that can pass the statistical gate (W2); Q19 no W1 hand-mapping mode; `prune
  --apply` may run below the free-space floor.
- **Coordinator rulings at plan review (2026-10-06):** R1 — `sweep.mjs` and `cli.mjs` end in their entry guard, with
  no top-level await, and every later block is inserted above it; R2 — redaction catches a `RangeError` from the
  shape regexes on a multi-MiB run and redacts the whole run (fail closed), pinned at 16 MiB; R3 — a `statfs` that
  throws reads `low-disk` (spec §9.10's failure table).
- **How the plan was checked.** Eight batch reviewers, an integration reviewer and a refute pass per reviewer, then
  two smoke runs that transcribed every task into a throwaway worktree at `d12b5aba0` and ran it: every new
  history suite and every existing suite the plan edits passed (the one red, `tmp-sweep`, is red at the base too).
- **Departures.** The wave-1 plan's 95 departures were issued in one block by the allocator on 2026-10-06 (95
  numbers starting at D-4165) and are defined in the plan's `## Deviations found`, each beside its spec §16 slug.
  Each wave's run gets its own small block at run-open, named in its brief and written bare here until a plan on
  `main` defines it.
  - Run 293 (wave 1) held 4260 to 4265. It defined D-4260, D-4261 and D-4262 in the plan (on `main` with #300).
    4263, 4264 and 4265 were never used and stay unassigned.
  - Run 302 (wave 2) used 35 numbers, all defined in the wave-1 plan on `main` (#315): 4296–4315 (its brief's
    block), 4336–4347 (an extension), 4418 and 4419 (fix round 1; 4418 is RF6's hook regular-file append), and 4550
    (fix round 2, the USAGE_PROSE allowance). None was left unused.
  - The B2, B3 and B4 plans' own departures were issued in one block on 2026-10-09 (D-4675 through D-4767: B2
    4675–4735, B3 4736–4753, B4 4754–4767) and are defined in each plan's `## Deviations found`; B3 and B4 cite B2's
    numbers for the slugs B2 defines first.
  - Run 354 (wave 3) holds the 30 numbers 4587 to 4616, listed one by one in its brief.
- **Wave 1 reviews.**
  - **Review 298** (at `4f2ba96e9`) raised F1 to F6. Rulings:
    - F1 strengthen the O18 pin (D-4261);
    - F2, F3 and F6 prose fixes (D-4260);
    - F4 the probe child's spawn error surfaces as itself, under a timeout (D-4262);
    - F5 no change (squash merge).
    The worker ran one fix round.
  - **Review 301** (at `ea3b8f7d1`, the fix round) found every ruling landed as ruled, with each mutant red-first measured. Rulings:
    - F1 (a quoted `uses:` plus an expression `node-version:` still evades the pin) is the accepted stopping line for this regex guard: two deliberate evasions at once, while every ordinary spelling reds. No action.
    - F2: Part A's floor remedy in `ccrc-doctor-checks` and `install.sh` says a server below the floor "boots without ccrc history's search". History lives only on session-hosting boxes (Q3), and no server code uses FTS5. Carried into wave 2, which rewords both lines in place once the store exists.
    - The refuted finding (spec §9.9 "past 500 rows") needs no edit: §9.9 already names the forced `gc()` every 100 rows, and "past 500" is the row count.
- **Wave 2 (B1) reviews**, each a held-out panel (three or more Opus · high lenses, three Sonnet · high refuters per
  finding, majority deciding; no lens dead or unexamined in any):
  - **Review 316** (at `6a6987532`): 42 findings, 10 critical (redaction, FTS candidate discovery, unbounded reads,
    wedging inputs), 6 important, 26 minor; all accepted. Fix round 1 (RF1a–RF8, FU1–FU10) with departures
    D-4343–D-4347, D-4418 and D-4419.
  - **Review 344** (at `be9df58ba`): 42 of 42 closed; 9 minor confirmed, 3 refuted. Rulings (mail 4019): fix all
    nine; D-4307's stopping line stands for B1 (its measured price, 31 of 32 characters, is carried into B2's
    substring belt); `store-read-failed` ledgered under D-4313; the USAGE_PROSE allowance takes D-4550.
  - **Review 351** (at `aa42a3972`): 9 of 9 closed, the main merge a pure keep-both; 4 minor confirmed, 3 refuted.
    Ruling (mail 4043): close bare-name arithmetic in the S1 pins in B1 (CLOSED class), LIST four deliberate evasions.
  - **Review 353** (at `561609adc`): 3 of 3 closed; 5 minor, all S1 static-pin precision with no live exposure.
    Ruling: stop iterating the regex guard (the stopping-line rule); accept the worker's extensions and listed
    evasions; carry the housekeeping into B2 Task 34. Merged.
- **The B2–B4 refresh after B1 merged (2026-10-08/09).** The plans were re-anchored on B1's real code (2,253
  anchors checked, 91 mismatches), then took the coordinator-owed amendments (the substring belt as B2 Tasks 7A/7B,
  search reach, README residuals, the B1 worker's notes, B4's due-since fix) and four reviews: a 330-agent review of
  the refresh (77 confirmed), a verification review (38), and a focused attack on the three redesigns (7). Their
  rulings are spec rev 3.5's rules: the belt (layer 4 and glue windows, version-tagged generations, a witness that
  records the belt due after a build without the belt ran, linear cost, unicode61's exact fold), windowed display
  redaction (window plus margins read as one text, exact or fail-closed), journal redact pairs applied before a
  restore links, the operator passes' belt rule, B3's scope marker on B1's regular-file rule, and recall-off parity
  between the CLI and B3's hook. One coordinator confirmation the operator should see in the docs PR: the CLI and
  its `--regex` child hold registered secret values in process memory (read from the frozen list and the declared
  files named in meta `redact_sources`); nothing persists, journals or prints them.
- **Routing (clause 13).** Wave 1 is a dependent chain that fits one context: Opus · high main loop, Sonnet · high
  implementers, Opus · high per-task reviewer, workflows off, `compact 40`. Wave 2 (34 tasks) outgrows one context:
  the bulk row — Opus · ultracode orchestrating, Sonnet · high workers (implementation never below Sonnet · high),
  workflows on. Wave 2 also carries `compact 40`: its tasks are a dependent chain (lib, then store, then sweep), so
  later tasks should start lean even under an orchestrating main loop. Wave 3 (38 tasks, B2) keeps wave 2's row:
  wave 2's evidence (42 held-out findings at its first review, three fix rounds) argues for its whole-branch review
  before wave-done, which the brief asks for, not for a different class.

## Carried constraints

- **Order.** Part A merged first (#300), then B1 (#315). B2 builds on B1's merged code; B3 and B4 build on B2.
- **Peer overlap in wave 3.** At 2026-10-09 18:40Z child reclamation's run 347 claims `single-definition.test.ts`,
  `CLAUDE.md` and `ccd/ccd`, which B2's later tasks also edit. The worker reads the claims before each first edit;
  whichever PR lands second merges main and keeps both sides.
- **Before B1 converges anywhere (still owed by the operator):** on each session-hosting node that keeps its store on a volume, the operator
  links `~/.ccrc/history/db` onto it (spec §9.3: a 0700 root and target) before that node converges, or doctor FAILs.
  After merge, the operator runs the shim's `--op import --apply` from a shell (B1 has no CLI `import`).
- **Operator acts Part A names:** a read-only `node --version` on every node before Part A merges; optionally making
  `node floor (22.16.0)` a required check.
- **Disk-hygiene W2 is not on `main`.** Its pins O30/O31 join whichever of B1 and disk-hygiene W2 lands second
  (plan Task 34 holds the code). The disk spec (`2026-10-03-fleet-disk-hygiene-design.md`) is still on the
  coordinator's branch, awaiting the operator's review; it is not part of this programme.
- **The volume.** `~/.cc-tmp` leaks ccrc test fixtures (2,327 dirs older than 60 min on 2026-10-06); every wave's
  suites add to it until disk-hygiene wave 1 lands. Workers clean up the fixtures their own runs create.
- **Merge conflicts to expect** (spec §10.6): disk-hygiene W2 and GPT-lane Part 3a/3b edit `ccd/ccrc-doctor-checks`;
  landing-order and continuity edit `ccd/session-hook.sh`. The plan's line anchors are at `d12b5aba0`; a worker
  re-anchors by content on its own base.

## Next-wave brief

Wave 3 (W1-B2 "recall") is run 354, and its brief is below as it will be dispatched once this ledger's docs PR
merges (route: opus, ultracode, subagent sonnet, workflow on, compact 40). Wave 2's brief is in this file's history.

```text
Run 354 - programme ccrc-history, wave 3: W1-B2 "recall". Coordinator: ccrc-pwa-quiet-ridge.

Ledger: docs/superpowers/programs/ccrc-history.md (on main).
Plan: docs/superpowers/plans/2026-10-06-ccrc-history-w1-b2-recall.md. Read its header first: Goal, Global Constraints, Review Focus, the pin map, the file map. Then do Tasks 1-36 in order; there are 38 headings, because the lettered Tasks 7A and 7B come before Task 8.
Spec: docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md (rev 3.5). The plan cites the sections each task needs.
B1 is MERGED (PR #315, 69ef7102b). Its code on main is your base. Do not redo or rewrite it, except where a task edits it in place.

Execution skill: superpowers:subagent-driven-development.
Commit on this workspace's own branch. Do not create or switch to a separate feature branch.

What the wave ships (one PR, "B2"):
- the recall verbs (tree, grep, describe, expand), the parser and native leaves;
- the substring belt (7A, 7B) and windowed display redaction;
- the operator verbs (prune, reparse, doctor --repair/--backup/--adopt/--restore/--rebuild/--migrate) and the recovery step;
- the ccrc-history skill and its installer, README's history section;
- fork spooling (Q16) and the per-copy export due (Q15).
Sessions gain the skill and the CLI verbs.

Base: main at 7c71244db or later.
- The plan's anchors were measured on B1's merged code. Re-anchor every Modify by its content; line numbers are hints.
- Edit citation-corpus files in place or end-append them exactly as the plan says.

Measuring:
- Many reds and counts in the plan are marked "predicted": no B2 code existed when it was written. Run each step and record what it actually prints.
- A red at a CONTROL is the fixture's to fix, never the guard's to weaken.
- Every mutant must red when its guard is removed. If one cannot, that is a finding: report it.
- Every vitest -t filter is a regex. Keep each one regex-safe, with each selecting at least one test.

Peers: read GET /api/claims?project=ccrc-pwa before your first edit to any existing file. Child reclamation's run 347 currently claims single-definition.test.ts, CLAUDE.md and ccd/ccd. Never edit a contested path. Agree an in-place or end-append scope by the peer protocol, or do other tasks first and mail me if nothing else is left. Whichever PR lands second merges main and keeps both sides.

Live safety (on top of your skill and CLAUDE.md):
- Never run the shim, sweep.mjs, cli.mjs, any ccrc history verb, any --op or the ccd-history-sweep unit against the live $HOME.
- Never create or touch ~/.ccrc/history. Never enable a timer. Never run ccrc update, deploy or rollout.
- Fixture HOMEs only (historyHelpers.ts). Remove every fixture directory and every Python bytecode file your runs create.
- Never kill processes by pattern (pkill -f, killall). Every session shares one UNIX user, so kill only PIDs or process groups you started.

Suites:
- From inside server/: ./node_modules/.bin/vitest run test/<file>.test.ts, in the foreground, with a Bash timeout of at least 600000.
- Re-run the CLAUDE.md load flakes in isolation before calling a red real.
- tmp-sweep's fail-closed environment case is red on this box at the base. It is not yours.

Departures:
- The plan defines its own: D-4675 through D-4735, already in its Deviations found. Cite them by number.
- For a departure you find while executing, take the next unused number from this run's block: 4587, 4588, 4589, 4590, 4591, 4592, 4593, 4594, 4595, 4596, 4597, 4598, 4599, 4600, 4601, 4602, 4603, 4604, 4605, 4606, 4607, 4608, 4609, 4610, 4611, 4612, 4613, 4614, 4615, 4616.
- Define it in the plan's "## Deviations found" in the same commit that first cites it, as "- **D-<n>** — `<slug>` (Task N): <why>".
- Never call the allocator, and never write a range.
- Run deviation-refs after `git fetch origin main` before each push. Name every number you used in your wave-done.

Not yours, and done by the operator or the coordinator after merge: merging, every rollout, the operator acts B1 still owes (linking ~/.ccrc/history/db, `--op import --apply`), and the B3/B4 waves.

Before wave-done:
- Run a whole-branch review of your own: three Opus · high lenses (correctness, spec conformance, does-it-reproduce) with refuters. Fix what it confirms.
- Then run the full local suite once.
Wave-done when PR B2 is open, its required checks are green (build-pwa, test (pwa), test (agent), test (server); test-macos and probe-macos are advisory), and your branch tip is the PR head. Your fingerprint is the workspace branch tip.

Routing (clause 13; routing-matrix row "bulk work larger than one context", the same as wave 2):
- main loop: Opus, ultracode, orchestrating;
- implementer subagents: Sonnet at effort high (never below);
- per-task reviewer: Opus at effort high;
- scouts: Haiku;
- workflows on, compact threshold 40.
- Name the model and effort explicitly on every Agent and agent() call.
- Commit after each task. If the session dies, the branch is the resume point.

Questions go through the AskUserQuestion rule in your skill. I answer what the spec, the plan and the ledger already decide. Anything new goes to the operator.
```
