# Program: ccrc-history

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.6; operator-approved design,
rulings Q1–Q14 of 2026-10-05 and Q15–Q19 of 2026-10-07; rev 3.5 folds in the refresh reviews' rulings, rev 3.6 what
W1-B2 shipped, below)
Plans: `docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md` (waves 1 and 2: W1 Part A and W1-B1, merged);
`2026-10-06-ccrc-history-w1-b2-recall.md` (wave 3, merged), `2026-10-07-ccrc-history-w1-b3-card-line.md` (wave 4) and
`2026-10-07-ccrc-history-w1-b4-export.md` (wave 5), operator-approved 2026-10-07, refreshed on B1's merged code, and
B3's re-measured on B2's merged code (2026-10-15). Wave 5h-1:
`2026-10-19-ccrc-history-w5h1-export-hardening.md` (#692), approved under the operator's directive of 2026-10-19 (below).
W2: `2026-10-19-ccrc-history-w2-decisions.md`, the authority every W2 plan cites, with the W2-3 and W2-4 plans
(`2026-10-19-ccrc-history-w2-3-gate-module.md`, `2026-10-19-ccrc-history-w2-4-driver-core.md`); the other W2 plans
are written as their PRs become dispatchable. Wave 5h-2: `2026-10-19-ccrc-history-w5h2-redaction-and-ops.md`. W2-1:
`2026-10-21-ccrc-history-w2-1-recall-off-and-exports.md`; W2-2a: `2026-10-22-ccrc-history-w2-2a-as-of-cut.md`; W2-5a:
`2026-10-22-ccrc-history-w2-5a-quiz-builder.md`; W2-2b: `2026-10-22-ccrc-history-w2-2b-headless-seam.md`; W2-5b1:
`2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md`; each approved under the operator's directive of 2026-10-19.
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
| 3 | W1-B2 "recall": read verbs, parser, native leaves, the skill, operator verbs (`prune`, `doctor --repair/--backup/--adopt/--restore/--rebuild/--migrate`, `reparse`), recovery step; from its reviews, schema v2 (heavy) and doctor's pass-aware freshness | fleet + skills | #404 | **merged** 2026-10-15 06:15Z as `de0ab03e1` at head `15af45165` (run 354, after reviews 441, 462, 466 and 467 and fix rounds 1–3) |
| 4 | W1-B3 "card line": scope marker, `_hook_history_card`, the S6-R11 census re-measure | fleet (hook) | #425 | **merged** 2026-10-18 05:52Z as `7284c8501` (run 468; reviews 476, 479, 495, 503 and 586; four fix rounds and a landing round) |
| 5 | W1-B4 "sole-copy export" (ruled Q6, e) | fleet | #623 | **merged** 2026-10-19 04:14Z as `ad65fb394` at head `2eca753d7` (run 587; reviews 614, 621, 623, 624 and 625; four fix rounds); **live on every session-hosting node before the earliest W1-k date, at the latest 2026-12-19** |
| 5h-1 | B4's export hardening ("Owed from B4", items 1–8): the check after a bind in bounded, resumable batches, with doctor's rule for a check that cannot finish; a carried segment that counts only when whole and this store's; a vanished segment that re-arms the check; replay that marks by the last carrier; `expand`'s variants and `ENTRY_UPSERT`'s tie; the history-off advice for a carry; B4's errata | fleet | #737 | **merged** 2026-10-20 12:58Z as `3af16cf97` at head `adcea723e` (run 626; reviews 644, 675, 689 and 700; three fix rounds) |
| 5h-2 | B2's owed items 1–5 ("Owed from B2") and B3's errata ("Owed from B3"): the named value class widened (the `Bearer` and box-token header classes stay as they are), with stored text re-cleaned as a sweep phase; the relay's look-behind window; the op marker's identity; `lag-high`'s remedy; the errata. B2's item 6 stays later | fleet | #1010 | **merged** 2026-10-21 15:39Z as `02d75ae5f` at head `90bfaadf9` (run 702; reviews 711, 721, 725, 744, 749 and 753; five fix rounds) |
| 6 | W2: the replay eval and its gate (ruled Q7, Q14), in nine PRs on two lanes (rows below; W2-5b split in two, S1); the W2 decisions document is the authority | fleet + deploy | — | the build runs now; the window waits on the operator's acts (decisions §5) |
| W2-1 | the recall-off verb and its generation checks, the per-tick presence record, the exports the deploy lane reads | fleet | #1105 | **merged** 2026-10-22 02:23Z as `cd622b2f6` at head `69105d4f9` (run 755; reviews 761 and 763; one fix round) |
| W2-2a | the as-of cut | fleet | #1126 | **merged** 2026-10-22 15:55Z as `ecbab815e` at head `d119d6e90` (run 764; reviews 778 and 791; one fix round) |
| W2-2b | the headless seam | fleet | #1154 | run 809, dispatched 2026-10-22 after its plan merged (#1146); wave-done at `b25a12846`; review 829 dispatched |
| W2-3 | `deploy/history-gate.mjs`, pure: windows, bootstrap, assignment, the gate, the quiz's labeller and admission, the open-record validator; `measure-history.py`'s raw rows and census | deploy | #856 | **merged** 2026-10-20 08:27Z as `36d0a92c1` at head `99325dc26` (run 636; reviews 664, 680 and 686; two fix rounds) |
| W2-4 | `deploy/history-replay.mjs`, the driver core: the spawn contract, account admission, `--out`, limits and budget, preflights, step 0a and the probe | deploy | #826 | **merged** 2026-10-20 13:28Z as `780c8126c` at head `8660b6cf9` (run 637; reviews 657, 681, 696 and 701; three fix rounds) |
| W2-5a | reconstruction, admission, the quiz builder and the open-record subcommands | deploy | #1134 | **merged** 2026-10-22 17:54Z as `c34f82830` at head `ac30619a3` (run 765; reviews 795 and 811; one fix round) |
| W2-5b1 | the arms and the judge: `marker`, `verify` for the pilot and quiz sections, `arms` and `judge` | deploy | — | run 828; its plan merges first, then it dispatches after W2-2b merges |
| W2-5b2 | the pilot and the verdict: `step0b`, `fidelity`, `pilot-result`, `open --amend`, `handcheck`, `report`, `open --finalize`'s derived budget, README's driver paragraph and the spec errata | deploy | — | after W2-5b1; its plan is drafted while W2-5b1 builds; merges before open-record part 1 |
| W2-6 | the report-only counters | deploy | — | after W2-5b1; beside W2-5b2 only on a line-disjoint plan the coordinator rules on (Q29) |
| 7 | W3: steering (session-written leaves) | fleet (hook) | — | only if the operator records the W2 gate as passed |
| 8 | W4: subagents and `touched` | fleet | — | only if the operator records the W2 gate as passed, and never before wave 5 is live |

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
  - Run 354 (wave 3) held 4587 to 4616 and used 4587 to 4614, all defined in the B2 plan on `main` (#404); 4615 and
    4616 were never used and stay unassigned. Its fix rounds held a second block, 5015 to 5038: 5015 to 5025 (round
    1), 5026 and 5027 (round 2); round 3 needed none, and 5028 to 5038 stay unassigned.
  - Run 468 (wave 4) holds the 30 numbers 5049 to 5078, issued at run-open and listed one by one in its brief.
  - The 5h-1 plan's own departures were issued on 2026-10-19 and are defined in its `## Deviations found`: D-5632,
    D-5633, D-5634, D-5635, D-5636, D-5637 and D-5638. Run 626 (wave 5h-1) held 23 numbers for what it found while
    executing: that block's unused 5639, 5640 and 5641, and 20 issued at run-open, listed one by one in its brief. It
    defined D-5639, D-5640, D-5641, D-5725, D-5726 and D-5727 in the plan (on `main` with #737); the rest stay
    unassigned.
  - The W2 decisions document's 19 departures were issued on 2026-10-19 in one block: D-5763, D-5764, D-5765,
    D-5766, D-5767, D-5768, D-5769, D-5770, D-5771, D-5772, D-5773, D-5774, D-5775, D-5776, D-5777, D-5778, D-5779,
    D-5780 and D-5781. Each is defined once, in the plan of the first W2 PR that ships it (the document's section 6
    names which); the W2-3 plan defines eleven of them. Runs 636 (W2-3) and 637 (W2-4) each held 15 numbers for what
    they found while executing, issued at run-open and listed one by one in their briefs; run 637 also held a block of
    eight issued at its fix-round-1 ruling (below).
  - The 5h-2 plan's departures were issued on 2026-10-19 and are defined in its `## Deviations found`: D-5745,
    D-5746, D-5747 and D-5748. 5749 and 5750 of that block stay unassigned: the coordinator withdrew the JSON key
    rule they would have carried (below). Run 702 (wave 5h-2) holds 20 numbers for what it finds while executing,
    issued at run-open and listed one by one in its brief.
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
  Wave 4 (B3, 14 tasks over a 7,300-line plan) keeps the same row. Its tasks are a dependent chain (lib, then
  `card.mjs`, then the sweep, then the hook), and the plan does not fit one context. Wave 3's evidence: on a GPT
  lane, implementers dropped pins and subagents loaded the worker's role skill. So the brief asks for the
  subagent sentence on every prompt, and a mail at once if the session is moved to a GPT lane. The held-out review
  always runs on an Anthropic lane, which I check before accepting it.

- **Wave 3 (B2) execution.** Run 354 (worker `brisk-meadow`) was dispatched on 2026-10-09 from base `5c922c866`.
  - **Lane.** At 19:55Z that day the session reached its account's limit and was moved to a GPT lane. Tasks 1–12
    and their per-task reviews ran on GPT-5.6 models until the operator moved it back to an Anthropic lane. The
    held-out review found that those tasks had dropped four of the plan's pins (review 441 F3, F4, F5 and F7);
    fix round 1 restored them as the plan wrote them, with no ledgered drop.
  - **False wave-dones.** Twice on that lane a GPT subagent loaded the `ccrc-worker` skill and mailed a false
    wave-done as the worker. Both were refused on re-measurement, and the worker's main loop voided one itself.
    Since then every subagent prompt in a brief opens with the subagent sentence. The lane's fix (Claude Code's
    system prompt kept as the model's instructions) shipped separately in #378.
  - **Push protection (ask 32).** GitHub refused the first push: synthetic AWS-key-shaped test fixtures. The
    operator answered "Bypass: used in tests" from the worker's pane, and four bypasses are recorded. Fixtures in
    later rounds are assembled at runtime.
- **Wave 3 reviews**, each a held-out panel on an Anthropic lane (three Opus · high lenses plus added lenses, three
  Sonnet · high refuters per finding, majority deciding; no lens dead or unexamined in any):
  - **Review 441** (at `63c1b595b`, 78 agents; added lenses redaction, cost, whole-branch): 18 confirmed (1
    critical, 4 important, 13 minor), 6 refuted. Rulings (mail 4901):
    - F1, critical: every healthy pass read the whole `blobs` table cold, +3 to +7 min per pass on a 0.5 GB store.
      B2 does not ship until the owed check is O(owed). Schema v2 became a heavy §6.11 version with a partial index
      and three more indexes (D-5015, D-5017 to D-5020). Measured after: the owed check in 170 to 188 ms cold, against
      18 s.
    - The tick-stale defect (B1's, ruled at 00:55Z on 10-14 for B3) moved into this round, because B2 made passes
      longer (D-5016).
    - F2 and F8: the final lines run the field pass (D-5021). F10: the operator relay holds the shim's stderr and
      redacts it whole (D-5022). F6 and F11 (D-5023), F12 (D-5025) and F13 (D-5024) as recorded.
    - F3, F4, F5 and F7: restore the dropped pins. F9: reword D-4614 only. F15 to F18: the skill, README and usage
      text.
  - **Review 462** (at `eeb1483df`, 48 agents): all 18 closed, each by mutants. New: F1 important (a pass the
    carrier kills leaves a marker that the next live pass masks, so a sweep killed every pass read as a WARN for
    ever), F2 to F8 minor, and suite note S1. Rulings (mail 5049): the death record (D-5026); a held pass is fresh for
    tick-stale (D-5027); pins for the stderr cap, the final pass and the forks scan; `ccrc-install.test.ts` gains the
    per-test fixture cure.
  - **Review 466** (at `70e2d37b0`, 56 agents; added lens pass-death): all closed. 7 minor: D-5027 over-claimed
    `schema-newer` and "alone"; `pass` and `pass-died` were undeclared in the manifest; three pins could not fail
    or bound one side only. Rulings (mail 5080): fix the record and the pins, declare both files; no code change. I
    accepted the worker's four rulings in my rulings' gaps (an off switch or an operator pass holds the death line;
    a thrown pass records itself; the count's wording; status re-reads the marker), which the review had measured.
  - **Review 467** (at `15af45165`, 27 agents): all closed, every named mutant red, no product logic changed. 4
    findings, record only. **Ruling: no fourth fix round.** F2 (the PR body's "alone") was a body edit, with no
    commit. F3 (a stamp from before a store became newer holds tick-stale back for up to 10 min) is a bounded
    residual, now stated in spec §9.6. F1 and F4 are errata, carried to the hardening wave.
  - Merged on that review. CodeQL's one open alert (`js/redos` on test data: catastrophic patterns the test asserts
    the guard refuses) was dismissed as used in tests.
- **The review-close order.** A review run closes from `working`: advance it to `working` with the WORK run's
  fingerprint, then close it with the reviewer's `{reviewedTip, report}`. Closing straight from `dispatched` is
  refused. Every wave-3 review was closed this way.
- **Owed from B2.** Rulings in wave 3's rounds sent these to "B3's list". **Ruling (2026-10-15): they are a hardening
  wave with its own plan (wave 5h, now 5h-2), not part of B3's card-line PR,** so B3's review keeps its own surface. B3 also
  edits the hook, and none of these do.
  1. Value classes end at `"`, `'`, `&`, `;`, `,` and so on (D-5021's residual, single quote included; for
     example `password=abc&def` and `Bearer abc"def`). B1 shipped the same rule. Widen them with a reindex plan for
     rows already indexed.
  2. The operator relay's stdout stays per-line, so a shape split across lines is not seen whole. Add a
     multi-line reading and a per-stream look-behind window (D-5022).
  3. The op marker carries no process identity, and `pidAlive` reads EPERM as alive. So a marker behind a reused
     pid holds the death line until the pid is freed or an operator pass removes it. Give it D-5016's identity
     (D-5026 residual (i)).
  4. `lag-high`'s remedy names a standing hold when one is present, rather than a backlog that cannot drain
     (D-5027).
  5. Errata: D-5022's claim that `(1 << 20) - 1` reds the no-line-break over-cap case holds only on some read
     splits, and `history-maint.test.ts`'s "never on timing" comment over-states the same (review 467 F1). The
     lib.mjs comment on D-5027 and the plan entry should name the stale-stamp window (review 467 F3). "At most 87 B"
     for `pass` is 86, in `shared/lifecycle.ts`, spec §9.4 and D-5016 (review 467 F4).
  6. Later, unless a measurement asks for them sooner: strict O(owed), an ineligible-when-written state (D-5017;
     the check is O(index), 176 ms warm on a harness-heavy fixture), and a rescan from a pinned cursor for the leaves'
     `todo` and fork scans (D-5024).
- **Wave 4 (B3), 2026-10-15 to 10-18.** Reviews 479, 495 and 503 each found only minor items, and four fix rounds
  closed them (mails 5238, 5370 and 5399). Two substitutions by the worker were accepted on review 495's
  measurements:
  - the generation record keeps no window test of its own, because its bounded NUL probe is its one guard;
  - a line-only DIRECT/PROBED strace pair stands in for the `withLine` run, which never reaches the probes.
  #397 and #410 stayed unmerged, and #397 waits on an operator decision, so #425 was landed first (landing round
  6169, base `36d536c99`). The merge met three changes on main, each fixed in B3's tests only:
  - D-5301's role subject: the card-line fixtures now plant a child row;
  - the dispatch-live gate's indent: the scope-marker case now anchors at any indentation;
  - #448's spool `def maxpath: 512;`: the hand-kept-512 scan sets that one token aside. Review 586 judged it a
    separate quantity, the spool's `pathBytes`, so there is no single-definition finding against main.
  A case for a manual (coordinator) session, which gets the role subject and the line together, was added. Before
  the merge, the coordinator re-ran the suites the merge with main `65f4b5ab4` could affect, and all were green.
- **Operator ruling 2026-10-18: segment replay keeps the prune.** A blob the store holds as a prune tombstone stays
  body-less when a segment carries its bytes: replay inserts blobs insert-or-ignore, as B4's plan and the spec read,
  so a recovery never undoes an operator's prune. Ingest's revival on recapture (D-4589) is unchanged.
  **Its scope, as the coordinator read it (2026-10-18, D-5397; put to the operator):** the ruling covers a tombstone
  the store holds before a replay begins. Replay applies every segment's bytes before any segment's stubs, both
  insert-or-ignore, so a stub from an older segment never hides the bytes a later segment carries: those bytes are a
  revival's record (D-4589), or the pruned text §6.6 says a rebuild replays. A held tombstone still takes no bytes,
  and `export_blob_tombstone_kept` counts each body that replay keeps out over one.
- **Owed from B3** (wave 5h-2, errata only, from review 586):
  1. `single-definition.test.ts`'s comment over the set-aside token says "512-character path bound". It is 512
     bytes (`pathBytes`, pinned by `delegation-spool.test.ts`).
  2. "Drop either and only a FIFO changes the verdict" (B3's plan at its line 4934 and in D-5063, and
     `session-hook.test.ts`'s FIFO rows' comment) becomes "only a FIFO (or a device node, which only root can
     plant) changes the verdict". Ruled 2026-10-18.
- **Wave 5 (B4), 2026-10-18 to 10-19.** Five reviews, each the held-out panel. The first two added sole-copy,
  recovery and fleet lenses, and the last three an operator lens.
  - **Review 614** (at `20c3375d1`): 3 important and 11 minor.
    - F1: a pruned lost blob stranded its referrers (D-5396).
    - F2: replay let an older segment's stub hide a later segment's bytes (D-5397).
    - F3: an export step that started on a spent budget held silently.
    - F6: an unlinked sidecar row naming an already-exported blob was never exported again. A grep test scoped to the
      row's own transcript decided it: the reads missed, so it was fixed (D-5399).
    - F4 took D-5398.
  - **Review 621** (at `62fd2b68f`): all 14 closed; 1 important. The check after a bind writes WAL of about 1-2 times
    the cleared blobs' stored bytes, in one transaction, outside the budget. The fix round's 78 B a mark held only
    for narrow rows. **Ruling: restate it; do not bound it in this wave.** A correct bound is a redesign of the
    D-5395/D-5396 path ("Owed from B4", below). The PR body's step 9 asks the operator to check for room first.
  - **Review 623** (at `d5bbfb22c`): 2 minor. Step 8 overstated what catches a bad segment copy on an adopt. An adopt
    registers no recovery step, so the operator's size comparison is the only guard. Fixed in text.
  - **Review 624** (at `c18d60ab3`): no findings. CodeQL alert 135 (`js/shell-command-injection-from-environment`,
    on a test's `sh -c` umask wrapper) then held an open review thread, and the ruleset refuses an admin merge past
    one. Fixed in code: the child sets its own umask.
  - **Review 625** (at `2eca753d7`): 2 wording items, carried below.
  - Departures D-5393, D-5394, D-5395, D-5396, D-5397, D-5398 and D-5399, each defined in the plan. The rest of the
    block is unused.
  - Lesson: read the PR's review threads before the final review, not only at the merge. The CodeQL check read
    green on every run while its thread stayed open.
- **Owed from B4** (wave 5h-1):
  1. Bound the check after a bind:
     - each batch is one transaction that clears its blobs' referrers before those blobs' marks, never the blobs
       first;
     - batches page by a `blob_id` keyset, because `exported_seg` has no index;
     - a batch is bounded by stored bytes and by the existing row cap, which is a memory bound;
     - the WAL is truncated after each batch, and a checkpoint that a reader's snapshot leaves busy is not an error;
     - no batch starts once the run budget is spent;
     - the cleared total accumulates in each batch's transaction, and the done stamp follows the last batch.
     Decide it against D-4762, which keeps the export outside db/'s floor.
  2. A doctor rule for a check that cannot finish. It needs one meta word, saying why the check stopped and since
     when, written by the check and cleared by its done stamp.
  3. An adopt that opens or sizes each carried segment against what it should hold (review 623 F2). Until then, the
     operator's size comparison is the only guard.
  4. `expand --json` reports `variants: []` over a pruned primary body, though a later variant is placed. Recall's
     `expandEntryText` returns before it reads variants, against D-4596's `variants_total`.
  5. On a restore, an entry's structure can move onto its `exported:` dead-file row (review 614 F7, RV15's
     tie-break).
  6. After a rebuild, an earlier segment's mark covers the rows a later segment adds for a blob the earlier one holds,
     D-5399's unlinked rows included. Lose the later segment and rebuild again, and those rows are gone (review 621
     F3; named in the plan's residuals).
  7. Review 624's advice: history-off holds ticks during a late carry, and a move-aside after the first tick clears
     nothing until the next bind.
  8. Errata (review 625): the plan's Global Constraints at its line 118 and Task 4's code block still show the
     `/bin/sh` umask wrapper. `history-store.test.ts`'s modes case title says "inherited umask".
- **Wave 5h-2's plan (2026-10-19).** Seven Opus writers, an integration pass and four Opus review lenses with a Sonnet
  refute pass. A redaction lens then reproduced a regression: the relay's batched reading let a JSON key take the next
  key as its value and print it, where today's line-by-line relay masks it. Three adversarial rounds followed, and each
  found a new input where a widened rule printed what today's rules mask; each fold patched one shape. The coordinator
  then ruled a structural fix instead of a fourth patch (R11, composition): every redaction door is the widened rules
  applied over the base door's output, so no value today's doors mask can print or be stored again. A sixth review
  round could not break it on 60,000 adversarial texts. The JSON key rule (once D-5749) is withdrawn; the relay's
  line-aligned union with today's per-line reading closes the relay case. Named residuals: widening lost where the
  base's mark already took a name (about 0.6% of planted values), about twice the redaction cost, and the JSON-key
  shape in the index, which today's doors share.
- **Operator directive 2026-10-19 12:27Z:** "I want you to proceed through the remaining build waves without stopping
  unless you're blocked by something." The coordinator reads it as follows. Each reading stands until the operator
  says otherwise, and none of it is an operator ruling on a question by name.
  - It approves the wave 5h-1 plan (#692). The coordinator takes R5 as written, in the operator's place: doctor WARNs
    `export-marks-unchecked` while a check of the export marks stands unfinished, and FAILs `export-marks-stalled`
    once `wal-held`, `unlistable` or `failed` has stood longer than 24 h. That FAIL turns doctor red and makes
    `ccrc update` exit 3. `budget` and `off` never escalate.
  - Each later plan (5h-2, then W2, then W3 and W4 if the gate passes) gets the same adversarial review before it
    merges, and merges without a separate approval. Its PR body lists every ruling the coordinator made in the
    operator's place. Build questions a worker raises, the coordinator rules on the same way and records here.
  - The two questions asked on 2026-10-18 (below) stay open. Until they are answered, the coordinator's scope reading
    stands and replay keeps bytes out over a held tombstone, as now. No wave depends on the answers.
  - Wave 5h-2's four redaction questions take the recommendations measured in 5h's scope reading, taken by the
    coordinator in the operator's place:
    1. The named value class widens in its field form only; the final form is unchanged (D-4613's structure safety).
       A quoted value reads to its closing quote on the same line, and an empty quoted value counts as no value. An
       unquoted value still ends at whitespace and the backtick; `&` ends it only before `NAME=`; `,`, `;`, `"` and
       `'` end it only before whitespace, `,`, `;`, a closer (`)`, `}`, `]`) or the end of the text.
    2. The single quote is treated as `"` is: it opens a quoted value, and inside an unquoted value it ends the value
       only under the conditions above. So it widens, and is not a hard end (D-5021's open question).
    3. The `Bearer` and box-token header classes stay as they are: neither token can hold a quote.
    4. Stored text is re-cleaned as a sweep phase, not by an operator op: `BELT_VERSION` goes up, and a layer-2
       rule-hit in the re-derivation probe makes the belt generation rewrite only the rows the widening changes. No
       schema change and no new meta key. Stored node fields heal through the nodes-belt step.
    The trade-off taken with them: quoted values, including prose after `token: "`, are masked whole, so search loses
    those words. The re-clean runs on every node after the rollout, an estimated 0.3 to 1.3 h of ticks on a 2 GB
    store (the live store's indexed share was not measured). A rollback to B4 and forward again pays it twice.
  - W2's plans, reviews and builds go ahead while the backfill question (below) stands. The backfill gates pilot
    sourcing, and so the live window as well as the quiz: the window's pre-registration carries the frozen quiz's
    sha256 (§10.2; W2 decisions, W2-D8). This corrects the sentence that stood here, which said only the quiz waited.
  - It does not cover acts outside the build: re-running the backfill, a rollout, opening or closing W2's live window
    (its pre-registration and the `recall-off` files on live nodes), or any other operator act. Those still come to
    the operator. The coordinator computes W2's gate as Q7 and Q14 define it and reports it; the operator records
    the decision (§10.6), and W3 and W4 open only after that record.
- **W2 decisions (2026-10-19).** Under the operator's directive, the coordinator scoped W2 (six Opus scouts and a
  completeness critic), drafted its rulings by cluster (five Opus drafters, two Opus checkers each, and a
  cross-cluster consistency pass), added the quiz's rulings, and consolidated them into one document,
  `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`, checked by two more Opus lenses. It holds W2-D1
  to W2-D90, the PR split and order, the open record's two-part protocol, the operator's acts in order, and the spec
  errata each W2 PR carries.
  - Coordinator amendment (W2-D3): 5h-2 keeps its `shared/lifecycle.ts` edit (the op marker's bound and the 87 B to 86
    B correction) rather than handing it to W2-1. If W2-4 still holds that file when 5h-2 dispatches, the two edit
    disjoint rows by the coordinator's consent.
  - Coordinator rulings from the W2-3 and W2-4 plan reviews are recorded in the document in place (empty-arm,
    `question-not-run`, a closed and chained open-record validator, window bounds echoed, the turn-bound reading,
    `--verbose`).
  - The live window opens only after every W2 PR has merged and been rolled onto the named nodes, and the open
    record's part 1 is signed. From that rollout to close, the named nodes' trees do not move (W2-D6).
- **Later (coordinator), from 5h-1's first review:** close the successor-premise residual in code with bind facts
  (the names each bind replayed whole), so a segment absent or skipped at a bind can never read as a predecessor.
- **The build, 2026-10-19 to 2026-10-20 (coordinator rulings under the operator's directive).**
  - **5h-1 (run 626), fix round 1, from review 644.**
    - F1: a held mark naming an unlisted segment of another writer stays for the check, and comes off at once in a
      forked directory. Writers are ranged over the listed names plus the names the store's marks hold. This rides
      D-5726.
    - The worker's probe M then showed that the layout must hold across a replay's steps: a take-off can remove the
      last mark that witnesses a fork. That became D-5727, ruled after three Opus lenses with Sonnet refuters:
      - one meta key per replay, tagged with the recover row's version;
      - measured at the first export chunk, from the listing and the marks;
      - widened by each later step's listing, and never narrowed;
      - the widest layout taken when the key is missing or stale past that point;
      - deleted when the recovery completes.
    - The residuals after it are three: the successor premise (widened by F2), a segment moved into the export
      directory part-way through a replay, and one the worker traces and states.
  - **W2-4 (run 637).**
    - The wave-done at `619f1aa6b` was re-measured and accepted. Review 657 found 4 important findings and 12 minor.
    - Fix round 1 is ruled: no live child is left spending unseen; one driver per `--out`; the budget is stated as a
      soft stop; type-safe reads and writes under `--out`; the sha on stderr.
    - The decisions document is amended in place: W2-D25, W2-D52, W2-D55, W2-D57, W2-D59, section 5 act 7, and
      section 7.
    - Numbers for the fix round: D-5815, which was unused, and a block of eight issued at the ruling. Each is defined
      in W2-4's plan by the commit that first cites it. They were not named here before that commit landed, so this
      file never names a number above the plans' high-water mark; the ones the plan defines are named at W2-4's
      landing (below).
  - **W2-3 (run 636)** takes W2-4's F4: part 1 requires `box_init` to be non-null.
  - **W2-3 (run 636)**, review 664: 4 important findings and 9 minor. Fix round 1 is ruled after two Opus checkers read
    the draft.
    - The gate's clusters are taken in key order, so its result no longer depends on input order.
    - The hand-check share stays a signed default, read exactly; its other three members and Q18's procedure are fixed.
    - The labeller's command arm refuses a further command-shaped piece, and a `./` path form is admitted.
    - The validator binds step 0a, the census and the assignment to part 1's nodes and account.
    - The decisions document is amended in place: W2-D18, W2-D25, W2-D63, W2-D71, W2-D79, W2-D81, section 4, section 7,
      and W2-5a's entry.
  - **5h-2's brief** carries the fix of the stale "six PRs" comment in `server/test/lifecycle.test.ts`, which W2-4 left
    as it was, because 5h-2 edits that file. The brief now says seven, the count of `HISTORY_ROWS_BY_PR`'s keys on
    `main`, because #826 merged first and split the W2 key.
  - **5h-1 (run 626, PR #737), fix rounds 2 and 3.**
    - Review 675 read fix round 1: 4 important findings and 7 minor. Fix round 2 is ruled by the coordinator, under the
      operator's directive of 2026-10-19, after three Opus checkers read the draft. The replay's layout is measured at the phase advance into the export phase, not at a chunk, and
      history-off is re-checked just before that advance. A put-back under a name the check recorded damaged keeps
      another whole copy outside the export directory. The forked-directory remedy is retired: no measurement tells an
      operator whether the current store holds a forked directory's old writers' rows whole, so no readable segment of
      the store is moved out.
    - Review 689 read fix round 2: 8 minor findings, 7 refuted, none a loss path. Fix round 3 is ruled on it. Its F8, the coordinator's
      ruling under the same directive: a full run red only on an advisory macOS leg is accepted as green for a wave-done, because macOS is advisory by
      standing ruling.
  - **5h-1 landed:** #737 merged on 2026-10-20 at 12:58Z as `3af16cf97`, at `adcea723e`. Its fix rounds were ruled by
    the coordinator under the operator's directive of 2026-10-19. Before the merge, the coordinator ran deviation-refs,
    docs-policy and citations on the would-be merge tree (main had moved by docs only), and all were green.
    - Review 700 (at `adcea723e`), a narrow re-review of fix round 3, confirmed 2 minor text findings and refuted 5. F4's
      new pin (unlistable at the advance) is green at the tip, and under the swallow mutant it reds only on its cursor
      and key assertions. Every named suite, the PR run and the full run were green, macOS included.
    - The coordinator's rulings on review 700:
      - F1 is fixed in the PR body only: mutants 2 and 10's red lists gain the new case, as review 700 measured.
      - F2 is the coordinator's, amended by this ledger's PR in the 5h-1 plan: the Pinned list's opener names its two
        exceptions (the first call of the off race and of unlistable at the advance), and the describe's 28 cases
        read as measured whole.
    - Departures D-5639, D-5640, D-5641, D-5725, D-5726 and D-5727, each defined in the 5h-1 plan. The rest of run
      626's block is unused.
  - **W2-3 (run 636), fix round 2, from review 680:** 2 minor findings, 10 refuted. The rulings, after two Opus
    checkers read the draft:
    - The validator refuses every q18_settings value on which `q18Power` throws or never returns, whatever the
      families: W2-D25's "a q18_settings value that Q18's procedure cannot honour".
    - The power list holds every level part 2's figures read, and `lookback_days` is at least 1.
    - Part 2's registry drops and quiz families bind to part 1's nodes, a drop's reason is one of W2-D20's set, and a
      family both dropped and assigned is refused.
    - The labeller's command rule also refuses `or` in any case or bracket, a flag after any Unicode dash, and a
      spaced slash; `LABELLER.boundaries` becomes `'v2'`. D-5789 states each clause's cost.
    - The plan's entries leave W2-D25, section 4's rows and section 7's labeller costs and residuals for the
      coordinator to amend in the decisions document.
  - **W2-3 landed:** #856 merged on 2026-10-20 at 08:27Z as `36d0a92c1`. Every ruling in its two fix rounds was the
    coordinator's, or the worker's and confirmed by the coordinator, under the operator's directive of 2026-10-19.
    - Review 686 (at `99325dc26`), a narrow re-review of fix round 2, confirmed no finding and refuted 11.
    - It judged the worker's five rulings in that round, and the coordinator confirmed each: power levels 0.5 and 0.8
      frozen as `Q18_FIGURE_POWER`, so they are no longer defaults the operator can drop (which narrows section 4's
      q18_settings row); a family both dropped and assigned refused at `assignment[j]`, keyed by store, id and
      generation; an NFD letter beside `or` as a stated cost; the grid check's reason text in place of "does not
      divide 1 - x"; and four line citations turned into symbol citations.
    - Departures D-5786, D-5787, D-5788, D-5789, D-5790 and D-5791, each defined in the W2-3 plan. The rest of run
      636's block is unused.
  - **W2-4 (run 637), fix rounds 2 and 3.**
    - Review 681 read fix round 1: 5 important findings and 6 minor, and no sequence that loses a charge. Fix round 2
      is ruled on it by the coordinator, under the operator's directive of 2026-10-19.
    - Mail 7140, the coordinator's ruling under the same directive: creating `--out` refuses `out-refused create-failed <code>`, and writing
      its marker refuses `out-refused marker-unwritable <code>`. It overturns the coordinator's own qualifier on the
      worker's fix-round-1 ruling, which let a failed creation of `--out` exit 1.
    - Review 696 read fix round 2: 5 findings, 3 refuted, and the worker's four rulings in that round confirmed. Fix
      round 3 is ruled on it:
      - a hand-set file-size limit is the seam that pins the write arms of the ledger and of the lock, and a FIFO
        with a reader pins the ledger's regular-file check;
      - the window from a lane's yield to its spawn is stated as up to c children, each stopped and charged;
      - an escapee's stream (a setsid grandchild, or a group member with no pipe to the driver) is stated truly: a
        resume runs the job again beside it;
      - a marker that cannot be written is a stated cost, and its refusal says to remove `--out` before a re-run.
    - The decisions document was amended in place by #964, before #826 merged: W2-D53, W2-D55, W2-D59, W2-D80 and
      section 7.
    - Neither round takes a new number.
  - **W2-4 landed:** #826 merged on 2026-10-20 at 13:28Z as `780c8126c`, at `8660b6cf9`. Its fix rounds were ruled by
    the coordinator under the operator's directive of 2026-10-19. Before the merge, the coordinator ran deviation-refs,
    docs-policy, citations, ci-pipeline, node-floor and lifecycle on the would-be merge tree, and all were green.
    - Review 701 (at `8660b6cf9`), a narrow re-review of fix round 3, confirmed 1 minor finding and refuted 6.
      Mutants M-A, M-B, M-C and M-D reproduced, and every named suite and CI were green.
      - F1, an extra comment rewrite at `measureClaudeVersion`: accepted by the coordinator as within F2's "drop the
        claim". The new text is true: that function has one spawn after its yield and no sibling lanes.
      - The worker's three rulings in fix round 3, confirmed by the coordinator: the qualifier on "the leader is dead
        when charged", the refill folded into the last commit, and a control per EFBIG pin.
    - Departures D-5801, D-5802, D-5803, D-5804, D-5805, D-5806, D-5807, D-5808, D-5809, D-5810, D-5811, D-5812,
      D-5813, D-5814, D-5815, D-5983, D-5984, D-5985 and D-5986, each defined in the W2-4 plan. The rest of run 637's
      numbers are unused.
  - **5h-2 (run 702) dispatched** on 2026-10-20, after #826 merged, on base #826's merge `780c8126c`. Its brief is
    below ("Next-wave brief"). It carries the "six PRs" fix (above), and holds 20 numbers issued at run-open.
  - **W2-4 follow-up (run 713, PR #1032).** `history-replay.test.ts` was red on macOS: the child's environment
    carried an extra Darwin key, and that red blocked a stable promotion. A test-only Darwin helper fixed it. The
    driver did not change, and Linux carries its pins and mutants. Review 717 found one minor point, in the PR body
    only, which the coordinator corrected. #1032 merged on 2026-10-20 as `47f95987c`, after a full run with every
    macOS leg green. Departure D-6122 is defined in the W2-4 plan.
  - **5h-2 (run 702, PR #1010), 2026-10-20 to 10-21.** Five fix rounds, each read by a review run with a held-out
    panel. From review 725 on, each panel had a leak lens under a neutral-marker discipline: marker values only,
    secret NAMEs read from `lib.mjs` at runtime, and counts and offsets reported, never a text. That discipline let
    the lens run; review 721's leak lens had been stopped by a content filter, and was counted unverified, not as an
    approval. Every ruling below is the coordinator's, made in the operator's place under the directive of
    2026-10-19.
    - **Review 711** (the wave): 6 findings. F1 (important, inherited from rev 3.6): the display doors read the
      widened rules after the cut, so a value whose NAME sits just before the window prints its tail at any distance.
      Ruled: fix it in code. R11 is amended so the widened rules read the margin-widened base. That fix is D-6071.
    - **Review 721** (fix round 1): 9 findings. It confirmed the worker's substitution: within R11 as amended, the
      widened reading of the margin-widened base, with every shown token span that no longer prints taken as a mark,
      instead of the literal cut, which it measured as worse. Ruled: measure every value against the pre-round
      composition, and make the door subtractive over it if any value printed.
    - **Review 725** (fix round 2): its F1, several words in escaped quotes, each recurring in the window, printed
      where the pre-round composition masked them. A ruling panel of four Opus lenses found a cheap exact fix:
      reorder the composition to the widened reading of the masked widened reading, plus a per-token edge guard that
      fails closed. That reorder was ruled, then a third membership (keep a token of the widened reading only if
      the shown text holds it too). Bar (c), "0 values the previous tip masked print now", was first restated for
      the first reading's token-level same-characters residual.
    - **Review 744** (fix round 3): its F2, the window door's dropped second reading, mattered where the cut splits
      a mark, and was ruled closed in code: the window reads the tokens of the pre-round output it already holds.
      Its F1 was accepted as bar (c)'s class (ii): a value in JSON-escaped double quotes whose NAME an earlier unit's
      open or odd double quote swallows. Every reading prints that value whole, the base door's and rev 3.6's
      included. That was the second restatement of bar (c). An amendment closed item 11 (a dotted key-shaped token
      at the snippet's edges) as measured: what printed is the base rules' own word-boundary miss (below).
    - **Review 749** (fix round 4): leak lens verified; bars (a), (b) and (d) at 0 over about 780,000 value-level
      calls; every bar (c) value class (ii); the licence exact. Four text findings were fixed by fix round 5, text
      only.
    - **Review 753** (fix round 5): the code unchanged by three methods, and both doors' outputs byte-identical
      over about 1.09M calls. Two wording points in D-6071's Measured bullet were accepted as they stand (below).
    - Departures: D-5745, D-5746, D-5747 and D-5748, the plan's own, and D-6068, D-6069, D-6070 and D-6071 from run
      702's block, each defined in the 5h-2 plan. The rest of run 702's block is unused.
  - **5h-2 landed:** #1010 merged on 2026-10-21 at 15:39Z as `02d75ae5f`, at `90bfaadf9`. Its PR body lists the
    rulings on reviews 721, 725, 744, 749 and 753, each the coordinator's.
  - **Errata accepted at 5h-2's landing** (review 753), in D-6071's Measured bullet in the 5h-2 plan:
    - the sentence on review 749 is labelled as its leak lens, but its licence figure (0 mismatches over 315,445
      calls) is from review 749's correctness lens, and its cost figure (0.97 to 1.08 times) from the reviewer's own
      bench;
    - "the tokens of `mid` are the tokens of `pre`" reads "are among": for an inexact window `pre` also holds the
      note's tokens. The wording was the coordinator's.
  - **W2-1's plan (2026-10-21).** Six Opus drafters wrote one task each against `main` at `02d75ae5f`, and an
    Opus writer wrote the header. An Opus integrator assembled it and applied the coordinator's rulings. Four Opus
    lenses (decisions conformance, code reality, test discipline and safety, cross-task consistency) reviewed it,
    each finding went to a Sonnet refuter, and an Opus pass folded in what was confirmed. The coordinator's rulings
    R1 to R6, made in the operator's place under the directive, are in the plan's Decisions table. Three departures
    were found while planning: D-6238 (the body-pick helper answers five state words, adding `undecodable`), D-6239
    (recall-off's pass touches no store) and D-6240 (seen_ms survives a restore or an adopt). Each is defined in the
    W2-1 plan, beside D-5763 and D-5764, the decisions document's W2-1 departures.
  - **W2-1 (run 755, PR #1105), 2026-10-21 to 10-22.** Six task commits, two fix rounds inside Task 3, and two fixes
    from the worker's own whole-branch review. Every ruling below is the coordinator's, made in the operator's place
    under the directive of 2026-10-19.
    - **D-6241** (`history-recall-off-stale-temp-kinds`), from run 755's block, was asked during the build and
      ratified: the stale `~tmp.*` loop unlinks only regular files and links; other kinds stay, and `--clear-all` names
      them under `skipped`. It is defined in the W2-1 plan. The rest of run 755's block is unused.
    - **Review 761** (the wave): 6 minor findings, none a behaviour defect. Three guards had no red: the absent arm's
      null `prev_seen_ms`, the presence step's two clocks, and the CLI's recall-off-only gate on the stated rc-1 words.
      Three were record errors: a sentence saying every registry read follows a link (only the sweep's does; the CLI
      and the hook refuse one), the PR body's commit count and spec-commit sentence, and guards the worker had accepted
      as unpinned that the PR body did not name. Ruled fix round 1: pin the three, pin the recall-off pass's directory
      fsyncs through the existing seam where it reaches, name every other unpinned guard in the PR body, and correct
      the record.
    - **Review 763** (fix round 1): every pin reds its guard for the guard's own reason, and the residual account is
      true and complete. One PR-body sentence, the coordinator's own wording, said every plan mutant reproduced where
      review 761 had sampled Tasks 1 and 2; the coordinator corrected it in the body.
    - The full run at the wave's tip was red only on two macOS legs, in files outside the PR
      (`session-hook-approval-wait`, `ccd-leaf-checkouts-pins`); the macOS legs are advisory.
  - **W2-1 landed:** #1105 merged on 2026-10-22 at 02:23Z through the merge queue as `cd622b2f6`, at `69105d4f9`. Its
    PR body lists R1 to R6 and the review rulings. Before queueing it, the coordinator ran citations, docs-parity,
    deviation-refs and docs-policy on its merge with `main`, which had moved README.
  - **Path-identity W3 (2026-10-22).** #1099 moved `session-hook.test.ts`'s `'ccd/ccd'` citation count from 147 to 151
    on `main`, which stopped W3 at its annex check. This programme owns that file's pins. The coordinator agreed that
    W3 takes `main`'s values as re-measured on its merged tree, never set by hand, and runs `session-hook.test.ts` and
    the citations test in full before its push; any other value stops it again.
  - **W2-2a's plan (2026-10-22).** Six Opus drafters wrote one task each against `main` at `cd622b2f6`, an Opus writer
    the header, and an Opus integrator assembled it with the coordinator's rulings R1 to R7. Five Opus lenses
    (conformance, code reality, leaks through every door, test discipline, cross-task consistency) reviewed it, each
    with a Sonnet refuter, and an Opus pass folded in what was confirmed. The leak lens found two more doors, ruled
    closed as R8 (tree's family headings, and describe's refs mined from hidden rows), and a convergence pass with two
    more lenses re-checked the folded plan.
    - The rulings fix the cut's names (`asOfCut`, `asOfEntrySql` and `asOfBinds` in lib, `asOfCutOf` in recall.mjs)
      and which task owns each door. W2-2a applies a cut only when one is set; W2-2b's seam sets it in production.
    - The plan defines D-5765 and D-5766, the decisions document's W2-2a departures. Two damaged-store cases fail
      closed with no number of their own: W2-D35 and W2-D39 are amended in place (a node with no leaf under it is
      hidden under any cut, and a boundary that no copy holds answers `asof-invalid`).
  - **W2-5a's plan (2026-10-22).** Eight Opus drafters, an Opus header writer and an Opus integrator, with the
    coordinator's rulings R1 to R9, then the same five lenses, refuters and fold, and R10 and R11 on what the review
    raised, re-checked by a convergence pass with three more lenses.
    - The plan defines D-5780, the decisions document's, and four departures found while planning, each issued for
      it: D-6277 (every whole line naming a transcript path is removed from the summary, wider than the spec's one
      pointer line), D-6278 and D-6279 (two readings that only grow Baseline B, so admission rejects more facts, never
      fewer) and D-6280 (`open --finalize` takes the spend budget from the operator until W2-5b derives it).
    - Section 5's act 9 is amended in place: one pilot node, and `pilot-source` runs once there. So is W2-D71 (R10):
      the quiz draws from every family with an admitted boundary, never only the census's active list, ordered across
      nodes by a per-family seeded key.
  - **W2-2a (run 764, PR #1126), 2026-10-22.** Dispatched on base `4f9d7ac4d` (#1118, which carried its plan). Every
    ruling below is the coordinator's, made in the operator's place under the directive of 2026-10-19.
    - **Ruling 7894, on the worker's question 7893.** The worker's own whole-branch review found two doors that
      W2-D35, as written, leaves open:
      - L2: a visible leaf other than N printed its summary row's text when the cut hides that row (its boundary
        visible, its summary row stamped after T_N, with no stamp, or outside N's holding copy);
      - L3 (a damaged store only): a visible parent over a leafless condensed child printed the child's rolled-up
        gist, topics and refs.
      Both were ruled fail closed, one number each from run 764's block, defined in the W2-2a plan: D-6282, a leaf with
      a summary pick is visible only if that row is too; D-6283, a node is hidden when any condensed node at or below
      it has no leaf below it. The ruling also accepted the worker's in-hand items, D-6281 among them (the store half
      keys N's transcript on the boundaries row's transcript, as derivation does), and BM25 ordering under
      `--sort relevance` or `hybrid` as a named PR residual (recency, the default, and `--regex` are unaffected).
      D-6283 flipped Task 3's ASOF=8 expectation for the parent, inside the PR.
    - **Wave-done (7932):** PR #1126 at `9fe784454`, 8 commits, 10 files (the File Structure plus the plan), using
      D-6281, D-6282 and D-6283. Re-measured: head equals tip, 25 checks success and 5 skipped, 0 threads, a clean
      merge-tree probe, and private-name scans at 0 (fixture paths only). Seven of the eight commits edit the plan, for
      measured predictions as the brief ordered, against the plan header's "only Task 6". Advanced to awaiting-review;
      review run 778 dispatched.
    - **Review 778** (at `9fe784454`): three Opus lenses, three Sonnet refuters per finding; 8 confirmed (1 important,
      7 minor) and 1 refuted, and every suite reproduced the worker's counts.
      - F1 (important): nothing pinned the order of the store half's copy rows (an `ORDER BY m.line DESC` mutant stayed
        green over the whole history-recall file). For a boundary N with no stamp, or anchored on itself, a wrong order
        fails open.
      - F2: D-6282's arm judges a leaf by the pick it re-computes at read time, so it failed open when that pick is NULL
        for a leaf that derivation summarised (a holding copy retired for a live one without the summary row).
      - F3: the store half's holds test was unpinned (fail closed). F4: `VERB_TABLES` lacked `boundaries` for grep,
        expand and tree. F5 and F6: the PR body's Task 4 mutant figure, and the plan-edit departure it did not name.
        F7: D-6282's pin covered only a summary row inside N's holding copy.
      - The ring question: the R8 ref-survival decider in recall.mjs is a fair follow-up, not a blocker, on the
        condition that it lands in lib before a second consumer exists (W2-5b's card parent).
    - **Ruling 7966, fix round 1:** fix all. F2 is closed fail closed with one number. Its blob half (a pick naming
      another blob) was adopted only if two facts measured true: derivation stores the picked entry's `blob_id`, and
      nothing moves either value afterwards; otherwise the NULL half alone, with the rest named as a fail-open residual.
      The refuted record nit was folded in: Task 6 Step 2 checks every number the plan defines.
    - **Fix round 1 (7993):** one commit, `d119d6e90`. F1: cut-A8 and cut-A9. F2: D-6284, both halves, on the two facts
      measured true. F3: cut-A10. F4: `boundaries` in `VERB_TABLES`. F5 and F6: the body. F7: the outside-copy case.
      The body's read-time-pick residual was dropped as closed. Re-measured clean; advanced to awaiting-review, and the
      scoped re-review run 791 dispatched.
    - **Review 791** (at `d119d6e90`): 6 minor confirmed, 1 refuted. Every pin reds its own case, and no consistent
      leaf is hidden over 1,200 seeded and transcript-shaped stores. The findings:
      - F-A: the seeded case's D-6284 blob assertion cannot red alone;
      - F-B: D-6284's over-hide is permanent, and holds under any cut;
      - F-C: the plan's D-6284 entry says the gist comes from the stored blob, where the gist doors print `nodes.gist`;
      - F-D: Task 6 Step 2's "defined in N plan(s)" loop checks two numbers, not six;
      - F-E: the PR body's title count (81, measured 88);
      - F-F: no census pins `VERB_TABLES`.
    - **The coordinator's ruling on review 791: merge without another round.** The coordinator patched #1126's body:
      the title count (88); D-6284's over-hide as its price (permanent until the holding copy again carries the stored
      blob, under any cut; a lossless rotation onto a prefix copy measured 26 of 2,512 leaves hidden under an
      all-visible cut); the reparse-then-revert residual (F-C's narrow fail-open shape); and "Notes for review: reviews
      778 and 791". F-C and F-D are corrected in place in the W2-2a plan by this file's PR; F-A and F-F are under
      "Later".
  - **W2-2a landed:** #1126 entered the merge queue at 15:27Z at `d119d6e90` and merged on 2026-10-22 at 15:55Z as
    `ecbab815e`. Run 764 is closed. The numbers it defines, each in the W2-2a plan: D-5765, D-5766, D-6281, D-6282,
    D-6283 and D-6284. The rest of run 764's block is unused.
  - **W2-D35 amended in place** in the decisions document, by this file's PR, as ruling 7894 said it would be. Under a
    cut, a leaf other than N is also hidden when its summary row is hidden, or when its stored summary blob is no longer
    what the read-time pick names (D-6282, D-6284); and a node is hidden when any condensed node at or below it has no
    leaf below it (D-6283). Each fails closed.
  - **W2-5a (run 765, PR #1134), 2026-10-22.** Every ruling below is the coordinator's, made in the operator's
    place under the directive of 2026-10-19.
    - **Ruling 7904, on the worker's question 7903.** R10's sentence ("a refusal that needs no store and no spawn
      answers before `--out` exists") also covers four refusals that the plan's Task 7 answered only inside
      `openWriter`, after `prepareOut`: account-refused, roster-invalid, a limits row at the threshold at open, and
      wrapper-unmeasured. Ruled: pilot-source and quiz-source pre-check each before `prepareOut`, through the same
      functions. `openWriter` keeps its calls as the authority, so a state that changes in between still refuses at
      open, leaving an empty `--out`, which the entry names. Each refusal gets a case, a CONTROL and a mutant that
      asserts the directory. One number from run 765's block.
    - **Ruling 7942, on the worker's whole-branch review (7930).** Six items, one number each from run 765's block,
      and the rest with none:
      - A: a key after a JSON `\n` reached the writer's stdin and `--out`. A `tool_use` input is redacted as values,
        through lib's `redactFinalJson`, before it is serialised, and no site in the PR redacts text already serialised
        as JSON.
      - B: a leaf-span fact is placed by its raw spelling, else its JSON-escaped one, else dropped under a counted
        word. A data case reached after `--out` or after spend never exits INTERNAL.
      - C: legacy families (generation `''`) are excluded in both modes, fidelity included, and counted, so the 60/12
        floor is honest.
      - D: preflight splits into its no-spawn half, which the pre-check calls, and the version comparison. Open's
        words and their order are unchanged, and there is no stand-in version.
      - E: W2-D63's 40-character SHA sampling is built in W2-5a. Shorter SHA facts are dropped under a counted word,
        pinned at 40 with a CONTROL at 7.
      - F: the pilot seed is pinned in `--out`: read back when present, drawn only when absent.
      - G and the rest, with no numbers: the depth CONTROL and its throw side, the writes-nothing pins, the empty-value
        refusals, sourcing in store order, the family-order-key parity pin, the plan-text sync and a stale comment.
    - **Wave-done (8020):** PR #1134 at `1f3677cf1`, 30 commits, 3 files. Its suite line read red, shallow: the shared
      after-all fixture cleanup overran its hook timeout under load, fixed in `dcc6cbe67`. It uses the departures
      W2-5a's PR defines, each defined once. The worker applied A's number to two more sites: the excerpt pair line's
      tool name, which a scoped re-review found, and `renderKeptMember`'s role tag. Its PR body names its precedence
      changes and its carried items. Re-measured clean; one external app's check, not a required one, reads
      action_required. Advanced to awaiting-review. Review run 795's dispatch was refused at the concurrency cap (14 of
      14), and it was dispatched once a slot freed.
    - **Review 795** (at `1f3677cf1`): three Opus lenses, three Sonnet refuters per finding, 33 agents with none lost;
      5 confirmed (1 important, 4 minor) and 5 refuted, and every suite and 13 mutants reproduced.
    - **Ruling 8124, fix round 1:**
      - F1 (important): a signed record's out-of-range values (`pilot_budget`, `limits.threshold_pct`,
        `limits.max_age_ms`, `quiz.target` and the quiz caps) got past `--out` and then exited INTERNAL. They are
        refused as an invalid record before `--out`, under the departure for 7942's B (a data case reached after
        `--out` never exits INTERNAL).
      - F2: the pilot-seed resume pin must red on the respawn, not only on the seed file being absent.
      - F3 and F5: plan text (the pre-check's two order changes, and the counts and words not yet synced).
      - F4: both extension sites stay under A's number, as W2-D54 conformance on the writer-stdin path. The record's
        attribution is corrected: "no text reaches a spawn stdin or a file under `--out` unredacted" is the brief's
        must-hold (a), not A's text.
      - R-3, refuted by the majority but raised as critical: lib's layer-1 redaction leaves a recorded-only pair value
        glued to a preceding alphanumeric (a literal backslash-n included) once its secret file is no longer loaded.
        It is lib-side, so it is accepted as a named residual in the PR body and carried to a lib redaction follow-up.
    - **Fix round 1 (8137):** three commits, tip `ac30619a3`. F1: `refuseOutOfRangeValues`, the first call in
      `refuseWriterAdmission`, refuses the seven fields `record-invalid` before `prepareOut` in both subcommands and
      writes nothing; one case per field through `open --draft --overrides`, each with a CONTROL at the boundary, plus an
      all-fields case and a unit case; D-6309's entry names the fields. One word changed: a threshold of 0 or below now
      answers `record-invalid`, not `limits-threshold`. F2: the fake writer's items depend on the seed, so a fresh seed
      reds on a third spawn. F3 to F5 and the record nit: plan text and the PR body. No new number. history-replay 773
      of 773; re-measured clean; advanced to awaiting-review, and the scoped re-review run 811 dispatched.
    - **Review 811** (at `ac30619a3`): three Opus lenses, three Sonnet refuters per finding, 33 agents with none lost;
      10 panel findings confirmed and merged into 7, all minor, none breaking a must-hold; 12 mutants and a control
      measured, and the suites green at the tip (history-replay 773).
      - F1: FW-H1's sentence and the wave-done overstated what dropping the range check reds: 8 of the 9 D-6309
        cases, four on the `--out` directory, one on `batchGate`'s `TypeError` after `--out`, three on the word.
      - F2: the threshold row (0 before 101) and the `max_age_ms` row can red only on the word, never on the `--out`
        hazard.
      - F3: D-6309's entry recorded one word change of four: the `max_age_ms` word, the fresh-row condition and the
        precedence ahead of admission went unrecorded, and no case pins that precedence.
      - F4: `settings_mode`, outside the seven fields, still throws after `--out` for a hand-assembled record that
        validates; the driver's own builder cannot produce one.
      - F5: the unit case's title claims "writes nothing" with no write assertion. F6: Review Focus 4 gave D-6311's
        mutants to D-6309. F7: the header's Task 1, 2, 4 and 6 bullets left out their fix-round numbers.
    - **The coordinator's ruling on review 811: merge without another round.** The coordinator patched #1134's body:
      H1's real reach, D-6309's other word changes, the carries and the notes for review. F1, F3, F6 and F7 are
      corrected in place in the W2-5a plan by this file's PR; F2, F3's precedence pin, F4 and F5 are W2-5b2's
      ("Carried constraints").
  - **W2-5a landed:** #1134 entered the merge queue at `ac30619a3` and merged on 2026-10-22 at 17:54Z as `c34f82830`
    (run 765; the worker's whole-branch review, reviews 795 and 811; one fix round). Run 765 is closed. The numbers it
    defines, each in the W2-5a plan: D-5780, D-6277, D-6278, D-6279, D-6280, D-6301, D-6302, D-6303, D-6304, D-6305,
    D-6306, D-6307, D-6308, D-6309, D-6310, D-6311, D-6312 and D-6313. The rest of run 765's block is unused.
  - **W2-2b's plan (2026-10-22).** Six Opus drafters wrote one task each against W2-2a's head `d119d6e90`, before it
    merged, and an Opus integrator assembled it with the coordinator's rulings R1 to R12. Five Opus lenses
    (conformance, code reality, seam safety, test discipline, cross-task consistency) reviewed it, each finding with a
    Sonnet refuter: 26 confirmed and folded, 0 refuted. A convergence pass of two Opus lenses (executability, and a
    re-check of the seam), with refuters, confirmed 5 more, all folded. Every count and red in the plan is a prediction
    nobody has run.
    - The plan defines D-5767, D-5768 and D-5769, the decisions document's W2-2b departures: the env path takes its
      family and generation from `CCRC_RECALL_ASOF` (D-5767), the marker's grammar (D-5768), and the two new refusal
      words `headless-malformed` and `headless-arm-unknown` (D-5769).
    - The rulings, each the coordinator's, made in the operator's place under the directive of 2026-10-19:
      - R1: the marker is read on one code line, only on the headless path, and folded once by `headlessMarkerOf`;
        `decideHeadless` is pure, calls W2-2a's `recallSeamEngaged` and `decideSeamInPane`, and answers in W2-D46
        step 1's order.
      - R2: `parseHeadlessList` takes text; a U+FFFD, an over-cap text, an empty line before the store line, an id
        spelled `store` and whitespace at either end of a line are each malformed (D-5768).
      - R3: `decideAsOfFamily` is strict (a transcript confirmed by more than one family refuses `asof-invalid`), the
        store line is checked before any ASOF row is read, and the anchor rule lives in lib (D-5767).
      - R4: Task 3 owns the env branch and sets `seen.id`, `seen.gen` and `seen.arm` at step 4's admission; Task 4 owns
        `recallLine`, the drain skip and their pins.
      - R5: step 4's own refusals write no counter line: they did not admit.
      - R5a, amending R5 after the plan review's CONF-1: R5's `asof-invalid` is step 4's family refusal; D-5765's store
        half runs at step 7 with the cut, after admission, and is counted.
      - R6: the spool's `arm` is not narrowed to `RECALL_ARMS`.
      - R7: W2-D41's env-only cross-project guard applies to every scope verdict that used a registry project, the
        default family scope included.
      - R8: Task 3 edits W2-2a's history-cli case in place (seam set, no pane: `no-identity` becomes
        `headless-unarmed`), the PR's one in-place test edit.
      - R9: the plan merges to `main` before dispatch, carrying D-5767, D-5768 and D-5769.
      - R10: `deploy/history-gate.mjs`' `ASSIGNMENT_ARMS` is a second spelling of the arm words; W2-2b's PR body names
        it as a residual, and W2-5b adds the parity pin ("Carried constraints").
      - R11: README's seam paragraph goes inside "Session history: lossless recall", after the box-verbs and
        operator-verbs paragraph.
      - R12: the history-switches row names root and tier exactly as W2-D49 does, with no "(removed at W2 close)".
  - **W2-2b (run 809, PR #1154), 2026-10-22, so far.** Every ruling below is the coordinator's, made in the operator's
    place under the directive of 2026-10-19.
    - Dispatched once #1146, which carried its plan, merged as `30ba2d662` and the disk cleared `ccd`'s workspace floor.
      Two claim holders' consents went to its worker with the brief: one on `single-definition.test.ts`, and one on
      README, scoped, with conditions.
    - **Ruling 8216 (A), on the worker's question 8215.** The worker's own whole-branch review (four Opus lenses; nothing
      critical or important) confirmed one gap: on the env path, `--workspace`'s anchor (`cwd_real ?? cwd`) was trimmed
      by `decideScope`'s workspace arm, so a cwd with whitespace at either end read a sibling directory's family or
      answered `not-indexed`. Ruled: fixed in the PR, the env source untrimmed and the tmux trim kept, with an in-place
      edit of `decideScope` licensed. It is a departure W2-2b's PR defines, and a scoped re-review read the fix clean.
    - README's consented paragraph grew to 29 lines with Task 5's fix round (a departure W2-2b's PR defines). Its claim
      holder confirmed the 29 lines (8246) and re-declared its claim under a new number (8256); the worker was told both
      (8249, 8259).
    - **Wave-done (8268):** PR #1154 at `b25a12846`, 9 commits, 12 files (the File Structure plus the plan). The suite
      line reads red, from history-export's free-space case on a full temp volume, red at the merge-base too. The last
      commit fixes a test fixture CodeQL flagged, with nothing dismissed. Re-measured clean; advanced to
      awaiting-review, and review run 829 dispatched.
  - **W2-5b split in two (2026-10-22).** An Opus scoping pass against `c34f82830` (W2-5b's 18 ships, 24 carries and the
    spec errata it owns; about 9,000 to 10,500 added lines) recommended two serial PRs. Every ruling below is the
    coordinator's, made in the operator's place under the directive of 2026-10-19, and each plan names them so the
    operator can change them.
    - **S1, two serial PRs on the deploy lane.** W2-5b1, "the arms and the judge", ships `marker`, `verify --section
      pilot|quiz`, `arms` and `judge`, in the driver and its test file only, with no README and no spec. W2-5b2, "the
      pilot and the verdict", ships `step0b`, `fidelity`, `pilot-result`, `open --amend`, `handcheck` and `report`,
      edits `open --finalize`, and carries README's driver paragraph and the spec errata. Both wait for W2-2b (W2-D2);
      W2-5b2 dispatches after W2-5b1 merges, its plan drafted while W2-5b1 builds. The decisions document's W2-5b entry
      is divided between them, not changed.
    - **S2, the carries outside W2-5b's files.** R8's ref-survival decider is moot for W2-5b: the card's parent is W2-D35's
      node rule, already lib's, so it stays under "Later". The arm-word parity is a set-equality pin in the test file,
      with the gate's order unchanged and no import added. Report words are driver-local. The driver-side range check
      (D-6309's rule) extends to `spend_budget` and every part-2 field a W2-5b consumer reads, before `--out`; the
      validator change stays later. The read instant is each gathered measure-history file's mtime, labelled as a proxy,
      plus the report's own instant. lib's R-3 is a named residual: the judge's stdin and the sheet carry redacted replies.
    - **Q1 to Q31, the scoping questions**, grouped:
      - Surface and place: Q1 separate subcommands sharing one `--out`, each spending and resuming on its own; Q2 arms
        and judge per node in that node's `--out`, the sheet and the report on the reporting node over the gathered
        files, each with its sha; Q25 a fresh `--out` for the post-part-1 pilot and one per node for the window, refusing
        an `--out` that holds `pilot-source.json`.
      - Batches and runs: Q3 both arms of a question side by side at concurrency 2, 5 questions per 10-job batch in
        frozen qid order, the preflight before each; Q4 run names per attempt, a driver timeout `infra-failed`, one
        re-run, then run-failed; Q14 a per-batch manifest with the measured version and the run names; Q24 `not-run`
        stays emergent, and `DRIVER_REASONS`' stop/refusal partition is pinned, each word classified once; Q30 the batch
        summary prints the stop word and the not-run count, with no automatic retry; Q31 every `error` field a run
        prints is recorded, and `authentication_failed` stays unmeasured, a named residual.
      - Spend: Q5 a per-node share, ceil(spend_budget × node questions / all questions), printed and enforced by that
        node's ledger; Q6 the judge runs in the usage pilot, the extrapolation is ceil(1.25 × n_questions × the pilot's
        spend per question, arms and judge), recorded with its inputs, and `--spend-budget` stays the operator's echo,
        refused on a mismatch; Q7 a charge is the larger of the result usage and the assistant-message sum, subagents
        included, both recorded.
      - The pilot: Q8 fidelity spawns in box mode, with no marker; Q9 `fidelity` takes `--pilot` and its sha and checks
        them against part 1; Q10 a failed pilot fails closed, and a control exit 8 that is not `is_error` makes uptake
        `unmeasured`, never a failure; Q11 step 0b asks the first usage question in qid order with a nonexistent synthetic
        transcript path, and a subagent's tool list is inferred from `parent_tool_use_id`; Q12 a mid-window re-pilot is
        step 0b on a listed quiz family plus fidelity, its sha the amendment's `repilot_sha256`; Q26 a skill missing under
        `--restricted` is recorded and halts, for a re-run with `--settings-mode fallback`; Q27 `open --finalize` refuses a
        failed pilot unless `--accept-failed-pilot` is given, printed and recorded as the operator's act.
      - Records: Q13 the detail schemas of `open --amend`'s three kinds; Q23 the pilot subcommands take no
        `--allow-code-change`, and arms, judge and report accept it after window start only, stamping every output and
        the verdict.
      - The as-of pieces: Q16 D-6284's over-hide is measured per node, read-only, in `verify --section quiz`; Q20 display
        prefixes over the family's whole node-id set, and the card line, one blank line, then the payload; Q21 the
        re-check is the one `screenRedaction`, any answerable source, and the frozen source entry visible under the cut;
        Q22 the two parity pins against lib's cut.
      - The verdict: Q15 `unrealised` comes from the per-node `verify --section ab` outputs, sha-checked; Q17 the read
        instant as S2 says; Q18 positional judge ids from the `'judge-order'` shuffle, the id map in its own file; Q19 the
        label file's grammar, a missing judge-failed label leaving the verdict `incomplete` and a missing sampled label
        refusing; Q28 the report's vocabularies as S2 says.
      - Q29: W2-6 may run beside W2-5b2 under W2-D3 if its plan shows the two line-disjoint; the coordinator rules on that
        plan before dispatching them together.
  - **W2-5b1's plan (2026-10-22).** Six Opus drafters wrote one task each against `main` at `c34f82830`, before W2-2b
    merged, and the coordinator ruled their open questions as R1 to R26. An Opus integrator assembled it. Five Opus
    lenses (conformance, code reality, the must-holds, test discipline, cross-task consistency) reviewed it, each finding
    with a Sonnet refuter: 27 confirmed and folded, 1 refuted. The coordinator ruled R27 to R32 on what the review raised,
    and a convergence pass of two Opus lenses (executability, and a re-check of the must-holds), with refuters, confirmed
    4 more, all folded, and refuted 1. Every count, red and fixture assumption in the plan is a prediction nobody has run.
    - The rulings, each the coordinator's, made in the operator's place under the directive of 2026-10-19:
      - Names and layout: R8 every consumer takes the owning task's names; R9 tests may nest in W2-5a Task 7's describe,
        each titled "W2-5b1 Task <N>:"; R22 Task 6's census reads those titles; R24 Q16 lives in Task 3's verify and Q25 in
        Task 4's arms; R26 Task 4 factors `refuseSpawnAdmission` and `preflightSpawn` out of W2-5a's writer code, W2-5a's
        behaviour and pins unchanged.
      - Refusals: R2 family-unlisted, family-recall-off and quiz-unanswerable are refusals, not stops; R11 a store with no
        family of the section refuses `input-invalid`, `formatHeadlessList`'s throws refuse `record-invalid`, and no new
        `DRIVER_REASONS` word unless a task's Interfaces names one; R12 a pilot family sits on a node the record names;
        R13 `verify` takes no `--allow-code-change`; R20 the judge refuses `input-invalid` until every (qid, arm) of the
        node's section is answered or run-failed; R30 the range refusals for a version move have one spelling.
      - The batch: R4 the record's `limits.batch_max` and `concurrency` are honoured within the driver's bounds; R28
        `batch_max`'s floor is 2, so a batch holds both arms; R6 the re-mine reads every rostered config dir; R7 no
        family-moved check in clause (a); R14 re-runs are per arm; R15 the summary after `interrupted` is printed, not
        written; R17 the spend-share line goes to stderr and the summary.
      - Payloads and the judge: R5 the card line is not redacted, being lib's grammar over two node ids and a constant;
        R16 the answer record keeps the raw reply under the 0700 `--out`, redacted at each spawn and at the sheet, a
        named residual; R18 the judge-order map covers every frozen pair, so ids are global; R19 a failed judge run folds
        into malformed: one retry, then judge-failed.
      - Over-hide: R10 a whole-store count with its binds stated and the hidden leaf ids capped; R29 the cap is 1,000,
        and the total is always given.
      - Tests and the record: R21 the arms-then-judge walk is Task 6's; R23 each owning task adds its own W2-D24 re-check
        cases; R25 plan-text commits carry build-time numbers and corrected predictions; R27 narrows R23, licensing three
        in-place edits of W2-5a cases, each named in its commit and the PR body; R31 red-first cases, CONTROLs and mutants
        for `readArmAnswers`' refusals and the pilot-only settings-mode check; R32 the fixtures' assumptions are
        predictions the worker measures, fixing the fixture, never the guard.
      - R1 step 0b's main-thread count is W2-5b2's, and R3 is the four departures below.
    - The plan defines four departures, issued for it while planning:
      - D-6467 (Task 1): every spawn's charge, in every mode, is the larger of the result usage and the assistant-message
        sum, subagents included, charged unconditionally. It departs from decisions section 7's C6, which measures in the
        pilot first and charges only if the spend is missing. W2-4's pinned probe spend moves from 15 to 60.
      - D-6468 (Task 2): W2-D78(iii)(a) runs as the one `screenRedaction` over a re-mined candidate, where W2-D78 reads
        F_raw alone; a question also refuses on F, a repo root or its leaf, and a source pruned or tombstoned after the
        freeze refuses at (a).
      - D-6469 (Task 4): a fourth clause beyond W2-D78(iii)'s three: a question whose arm-time payload no longer
        reconstructs refuses `quiz-unanswerable` before any spawn of the batch, and is never dropped.
      - D-6470 (Task 5): the judge's `answer_field` is capped at the reply's 16 KiB, beyond W2-D79's letter, which caps
        the reply only, so the judge's stdin is bounded.
    - Run 828 is open for W2-5b1 (wave 12), with the 20 numbers issued for it at run-open. It dispatches after W2-2b
      merges, on the merge of this file's PR or later.
- **Later (coordinator), from the build:**
  - The check after a bind runs two DISTINCT scans, over `blobs.exported_seg` and `entries.exported_seg`, on every
    check step. `exported_seg` sits after `z` and has no index, so a check spanning N steps likely reads the blob table
    N times. It is a cost, not a loss, and it runs only after a bind or a vanished segment. Measure it on a large store;
    an index or a per-check snapshot is the remedy. 5h-1's replay already pays its own scans once per replay
    (D-5727).
  - The sweep's per-pass cost under load. On 2026-10-19, two passes on a fleet node hit the unit's 10-minute start
    timeout while the box was starved of CPU. Each pass used about 3.75 CPU-minutes back to back, most likely the FTS
    catch-up that the stopped backfill left (`fts-pending`). Read-only status at the time: health ok, lag 341 s,
    export nothing due. Re-measure once the backfill question is answered.
  - A measured fork-provenance signal, so that a remedy for a forked export directory can return. 5h-1's fix round 2
    retired that remedy (review 675 F4), because nothing measured tells an operator whether the store holds a forked
    directory's old writers' rows whole.
  - **The display doors and the widened rules, from 5h-2's reviews.** These wait for the first wave after 5h-2
    that may change a base reading or the widened rules (D-5745's). None is a regression against rev 3.6: rev 3.6
    prints each of them too.
    - N1: rev 3.6's word rule for an inexact window is ASCII-only (review 721).
    - A position-aware first reading would close bar (c)'s class (i), the first reading's token-level
      same-characters residual. The fallback is to intersect with the previous order's output, at about 2.5 to 4
      times the cost (review 725, the coordinator's ruling).
    - The rules: a double-quoted value that takes its closing quote from a later pair's escaped quote swallows that
      pair's NAME. Both rule sets miss it, and it is bar (c)'s class (ii) (review 744).
    - The rules: a multi-word value in escaped quotes takes no quoted arm. Rev 3.6 prints it whole, and the widened
      rules mask only its first word. At the snippet door, that first word prints wherever the value as a whole is
      masked: 8 word exceptions in review 749.
    - The base shape layer's word boundary: a dotted key-shaped token right after a word character is not matched,
      by rev 3.6 or by the widened rules. None of the 1,700 hits measured in fix round 4 had a JSON escape before it,
      so it is not common in stored transcripts.
    - D-5746's owed-hit count rises with the composition (informational, review 721).
  - **stripTs reads `/` after `)` as division** (`server/test/growthCheck.ts`), so a regex literal right after an
    `if (…)` that holds `//` would be stripped as a comment. Review 753 found it, as a general limitation that did
    not apply to its round. It matters to anyone who relies on stripTs to show that code is unchanged.
  - **From W2-1's plan (rulings R1 and R3):** W2-5a rewords `deploy/history-replay.mjs`'s header sentence "never
    loads node:sqlite in any form" once the driver imports W2-1's exports. The next fleet PR that holds
    `ccd/session-hook.sh` corrects its comment that the CLI reads 4,096 bytes of `recall-off/<id>`: since W2-D29 it
    reads up to `CONTROL_FILE_MAX`, and the hook still fails closed. W2-5a took the first of these (#1134).
  - **From W2-1's reviews and PR body:**
    - `history-holds` and `history-export` hold cases that read the box's real free space, so on a box below the
      store's free-space floor three of them fail, at the base as well. Hermetic fixtures would stop a full box from
      reading as a red suite.
    - The recall-off pass's `fsyncSync` of its temp file has no red: the existing seam records directory descriptors
      only. An `fsyncSync` spy inside `history-op.test.ts` would pin it (review 763).
    - `recallOffKind` is a second lstat-kind predicate beside `card.mjs`'s private one; a PR that holds `card.mjs` or
      `store.mjs` merges them.
    - A full-size planted `recall-off/` costs up to about 256 MiB of reads and hashing per tick, outside the run
      budget, and the `change:` and `gap:` rows are never pruned.
    - An adopt carries the old box's `seen_ms`, so a clock that ran ahead there narrows the next interval; an adopt
      mid-window is outside the W2 procedure.
    - `deploy/history-gate.mjs`'s `assembleReports` doc does not mention `recall_off`.
  - **From W2-2a's reviews (778 and 791) and its PR body:**
    - Pin "D-6284 hides no consistent leaf": run `asOfHiddenNodesSql` over the seeded stores under an all-visible cut
      and assert that no leaf is hidden that the base shows (review 791 F-A; the seeded case's blob assertion cannot red
      alone). Review 791 measured it by script, at 0.
    - A census of the tables each verb's statements name against its `VERB_TABLES` row, so that dropping `boundaries`
      or `memberships` reds (review 791 F-F).
    - For D-6284's over-hide: re-point `summary_blob_id` when a copy rotates to a row of equal content, so a leaf that
      a lossless rotation hid comes back.
    - derive.mjs's `refreshLeaf` (reparse) re-derives gist and topics from the read-time pick while keeping
      `summary_blob_id`. It is pre-existing; D-6284 fails closed there, and the reparse-then-revert shape is #1126's
      named residual.
    - A lib `summaryMetaOf` that derive adopts, since `asOfCut`'s meta mapping duplicates derive's.
    - `producerOfLeaf`'s per-witness prepare under a cut: splice the cut into the witness statement.
    - `cutHidesASource` checking refs before it walks the lineage.
    - `scanRegexJob` refusing a malformed cut.
  - **From W2-5a's reviews 795 and 811, and W2-5b's split:**
    - Tighten W2-3's gate validator to range-check the record fields review 795 F1 names, and `spend_budget` and
      `settings_mode` with them. Until then the driver refuses them before `--out`: D-6309's rule, extended by W2-5b1 (S2)
      and, for `settings_mode`, by W2-5b2 ("Carried constraints").
    - lib's `redactField` and its glued-prefix limit for a recorded-only pair value (R-3), named as a residual in W2-5a's
      PR body and in W2-5b's.
    - A read-instant field in measure-history's families output (S2); W2-5b2's report records a labelled mtime proxy
      until then.
    - R8's ref-survival decider moves from recall.mjs into lib before a consumer that needs R8's ref rule. W2-5b's card
      does not: its parent is W2-D35's node rule (S2).
- **Later, for the operator.**
  - A way to forget a mislearned secret pair. None exists: pairs are permanent by design (D-4587). My
    recommendation is to keep it that way.
  - Feeding retired box-token digests into redaction. It matters only for a store bound after a value retired;
    measured on 2026-10-10, the live store already redacts the retired values.
  - `--regex` reach without a literal (spec §8.4, rev 3.6).
  - **Asked 2026-10-18:** is the coordinator's scope reading of the 2026-10-18 ruling (above) what was meant?
  - **Asked 2026-10-18:** a restore whose backup holds a tombstone keeps that text body-less even when ingest revived
    it after the backup and a later segment carries it. Should replay keep such bytes out, as now (counted by
    `export_blob_tombstone_kept`), or take them?
  - **At W2 open (decisions §4 and §5):** the operator signs the open record's part 1 and part 2, kept off the
    repo. Part 1 carries defaults the W2 decisions document sets, each changeable then: the quiz sources SHA, path,
    command and error facts but not decisions (D-5775); a 7-character prefix of a longer SHA scores correct
    (D-5777); residual answers are labelled uncertain (D-5778); the question writer sees a bounded excerpt (D-5779);
    `ROW_CAP` 400; the limits threshold; and the maintenance and build freezes on the named nodes.
  - **Asked 2026-10-19:** W2 (wave 6) waits on the backfill. The operator stopped it on 2026-10-18, with the
    transcripts imported and the sidecars only in part. May the coordinator re-run it to finish the sidecars, with the
    sweep timer paused around it as before?

## Carried constraints

- **Order.** Part A merged first (#300), then B1 (#315), then B2 (#404), then B3 (#425), then B4 (#623), then 5h-1
  (#737), then 5h-2 (#1010), then W2-1 (#1105), which builds on them and on W2-3 (#856) and W2-4 (#826). W2-2a (fleet
  lane) and W2-5a (deploy lane) built on W2-1 alongside each other, on disjoint files, and both merged (#1126, #1134).
  W2-2b (fleet lane, #1154), built on W2-2a, is in review. W2-5b1 (deploy lane) dispatches after W2-2b merges (W2-D2),
  on the merge of the docs PR that carries its plan; W2-5b2 after W2-5b1 merges; W2-6 after W2-5b1, and beside W2-5b2
  only on a plan that shows the two line-disjoint (Q29).
- **Peers.** The worker reads `GET /api/claims?project=ccrc-pwa` before each first edit of an existing file. Wave 5h's
  hot files are `ccd/history/*.mjs`, `ccd/history/recall.mjs` and the history tests; whichever PR lands second merges
  main and keeps both sides. Path-identity W3 (its plan, #1055) has this programme's acknowledgement for four
  line-neutral in-place hunks in `ccd/ccd` and one in `ccd/ccrc`; it never edits `session-hook.test.ts`, and it mails
  this programme's coordinator before taking its census fallback (its step 4g), which was not agreed in advance. After
  #1099 it takes `main`'s re-measured citation counts on its merged tree (2026-10-22, above).
- **In W2-5b1's plan** (the earlier W2-5b carries it takes):
  - both parity pins against lib's cut (W2-5a's R8; Q22): the same-millisecond predicate against `asOfCut`, and the
    driver's kept(N) members against `asOfCut(N).keptUuids`;
  - the card parent through lib's widened node rule, W2-D35 as amended (D-6282, D-6283 and D-6284), never a second copy
    (ruling 7894);
  - the arm words' parity as a set-equality pin between the gate's `ASSIGNMENT_ARMS` and lib's `RECALL_ARMS`, beside the
    driver's arm-word scan (W2-2b's R10; S2);
  - D-6284's over-hide measured per node, read-only, in `verify --section quiz` (Q16, R10, R29); W2-5b2's report gathers
    the counts;
  - the driver-side range check extended to `spend_budget` and the part-2 fields its consumers read (S2).
  - not taken: R8's ref-survival decider, moot for W2-5b (S2), stays under "Later".
- **For W2-5b2's plan:**
  - from W2-5a: README's driver paragraph names the driver's `--no-warnings` shebang; the pilot-result file's shape,
    which W2-5a reads, is W2-5b2's producer contract; `open --finalize` derives the spend budget and refuses a mismatch
    (D-6280), and refuses a failed pilot without `--accept-failed-pilot` (Q27);
  - from W2-5a's review 811: `settings_mode` refused before `--out` (F4), unless the gate validator follow-up takes it
    first; the threshold row asks 101 before 0, and the `max_age_ms` row uses a limits row stamped near now, so each
    per-field row reds on the `--out` hazard rather than on the word (F2); the unit case's "writes nothing" title gets a
    write assertion or loses the clause (F5); a pin for the range check's precedence ahead of admission, such as a
    range-bad record on a home with a refused account (F3);
  - from W2-2b: an env call on a legacy family writes no `gen` on its counter line, so the drain files the row under the
    registry's current generation; live counters exclude arm rows;
  - W2-D56's both-arms re-run: after a version re-pilot, both arms of every question with one arm done re-run on the new
    version, found through W2-5b1's per-batch manifests (Q14). Until then, `arms` after a version move completes the
    missing arm only (W2-5b1's PR residual);
  - the spec errata W2-5b owns (E2, E7, E8, E9, E10, E11 and E19 to E24), each citing its number;
  - W2-6 may run beside W2-5b2 on a line-disjoint plan the coordinator rules on first (Q29).
- **Operator acts, still owed, in this order on each session-hosting node:**
  1. If the node keeps its store on a volume, link `~/.ccrc/history/db` onto it (spec §9.3: a 0700 root and target).
  2. **Done on both nodes (measured 2026-10-15).** Once the node runs B2 (v0.0.195 or later), run `ccrc history
     doctor --migrate` from a terminal outside any session. B2's schema v2 is heavy, so a store over about 1.5 GB waits at `snapshot-needs-op`: capture pauses,
     doctor FAILs `history: migration-needs-op` (and `lag-high` after 30 min), and an update that ends there exits 3.
     The fleet box's store measured 1.54 GB on 2026-10-14. B2's PR body, "After deploy", has the measured detail.
  3. **Partly done:** the backfill B1 left. `ccrc history import --apply` ran on the fleet box from 2026-10-18
     08:17Z and was stopped at 11:31Z by the operator's choice, with the transcripts imported and the sidecars only in
     part. A re-run finishes the sidecars. Pause the sweep timer around it, because back-to-back passes take the lock.
  4. **B4's rollout** (#623's body, "After merge"). Before an adopt or a restore whose export directory does not come
     with it, check for room first (step 9). On an adopt, compare every carried segment's size with its source before
     the first tick (step 8).
  A rollback to B1 after the migrate reads the store as `schema-newer` and captures nothing until the node is
  updated forward again; B1 has no restore verb.
- **Operator acts Part A names:** a read-only `node --version` on every node before Part A merges; optionally making
  `node floor (22.16.0)` a required check.
- **Disk-hygiene W2 is not on `main`.** Its pins O30/O31 join whichever of B1 and disk-hygiene W2 lands second
  (plan Task 34 holds the code). The disk spec (`2026-10-03-fleet-disk-hygiene-design.md`) is still on the
  coordinator's branch, awaiting the operator's review; it is not part of this programme.
- **The volume.** `~/.cc-tmp` leaks ccrc test fixtures (2,327 dirs older than 60 min on 2026-10-06); every wave's
  suites add to it until disk-hygiene wave 1 lands. Workers clean up the fixtures their own runs create. On
  2026-10-21 the volume that holds the worktrees fell below `ccd`'s 10G floor for new workspaces, and a review's
  dispatch was refused until space was freed. A dispatch refused by that floor spawns nothing; dispatch it again
  unchanged once there is room.
- **Merge conflicts to expect** (spec §10.6): disk-hygiene W2 and GPT-lane Part 3a/3b edit `ccd/ccrc-doctor-checks`;
  landing-order and continuity edit `ccd/session-hook.sh`. A worker re-anchors by content on its own base.

## Next-wave brief

One wave dispatches next: W2-5b1 (run 828, deploy lane), after W2-2b (run 809, PR #1154) merges, on the merge of the
docs PR that carries its plan, or later (route: opus, ultracode, subagent sonnet, workflow on, compact 40). W2-2b is in
review (run 829). The briefs of W2-2b (run 809), W2-2a (run 764), W2-5a (run 765), W2-1 (run 755), 5h-2 (run 702),
W2-3 (run 636), W2-4 (run 637) and 5h-1 (run 626) are in this file's history. Each text is the brief as mailed, except
that its block's numbers are described here, not listed, its base is named by the docs PR's merge rather than a SHA,
and the coordinator is named by reference to this file's header. The mailed briefs add what the claims read at dispatch.

```text
Run 828 - programme ccrc-history, wave W2-5b1 (wave 12, deploy lane): the arms and the judge. Coordinator: the one this ledger's header names.

Ledger: docs/superpowers/programs/ccrc-history.md (on main). Read its W2 rows, W2-5b's split and "Carried constraints".
Plan: docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md (about 8,200 lines). Read its header first, through "The PR". Then do Tasks 1-6 in order, one commit per task, as its PR section says.
Authority: the plan's Decisions table (the coordinator's S, Q and R rulings and the four numbers it defines), then docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md, then the spec (rev 3.6 as amended; W2-5b1 never edits it), then the W2-5a and W2-2b plans as merged, then the merged code.

Execution skill: superpowers:subagent-driven-development.
Commit on this workspace's own branch. Do not create or switch to a separate feature branch.

What the wave ships: one PR, the plan's Goal. Files: deploy/history-replay.mjs and server/test/history-replay.test.ts, and the plan itself for build-time numbers or corrected predictions (R25). The PR creates no file. Never README.md or the spec (W2-5b2's), never ccd/**, shared/**, deploy/history-gate.mjs, deploy/measure-history.py, .github/** or the ledger. The in-place edits of earlier cases are only those R27 licenses. If a task seems to need another file or another in-place edit, stop and mail me.

What must hold (the plan's Global Constraints and Review Focus name each one's pins):
- No arm spawn before W2-D78's checks and the gate pass (D-6468, D-6469, W2-D56, the per-node share), each refusal with the stub log absent.
- RP1-arm's exact env, with real arm values.
- The control payload is byte-identical to W2-5a's. The treatment payload is the card line, a blank line, then the control payload.
- The card never names a parent hidden under asOfCut(N).
- No arm word is spelled in the driver.
- The judge sees no arm token and never judges a correct answer.
- Every --record consumer re-checks gate_code first.
- No INTERNAL exit after --out.
- O13 holds.
Each has a pin with a CONTROL. A gap you find: stop and mail me.

Rulings: the plan's Decisions table, as written. S1, S2, Q1 to Q31 and R1 to R32 were taken by me in the operator's place under the directive of 2026-10-19, and the PR body names each so the operator can change them. Never change one yourself.

Base: main at the merge of the docs PR that carries this plan, after W2-2b's merge, or later. Anchors were measured at c34f82830, before W2-2b. Task 1 Step 0 stops if W2-2b's lib names are missing. Re-anchor every Modify by content; line numbers are hints; the plan text is never ground truth.

Measuring: run each step and record what it prints. Every red and count in the plan, and every fixture assumption (R32), is an unrun prediction: measure each, and correct a differing prediction in the task's own commit, recording measured over predicted. A red at a CONTROL is the fixture's to fix, never the guard's to weaken. Every mutant must red when its guard is removed; if one cannot, report it. A mutant applied in place is restored byte for byte (cmp) before the next. Every -t filter is a regex: keep each regex-safe and selecting at least one test. Key-shaped fixtures are assembled at runtime; non-ASCII fixtures with String.fromCharCode. Scratch goes under .superpowers/sdd/history-w2-5b1/, never git stash.

Public repo: no private name in any file, commit message, PR title or body, and no host, account, session id, IP address or absolute home path anywhere (fixture paths in the /home/u style). Before each push, run `grep -c -i -w -F -f <(cut -f2 "$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names" | grep -v '^#')` over your added lines, your commit messages and the PR body. It must print 0. On a non-zero count, get line numbers only (grep -n ... | cut -d: -f1), judge each hit by its line, and never print a matched token.

Peers: read GET /api/claims?project=ccrc-pwa before your first edit to any existing file. Any path another run holds: do not edit it; mail me the path, the lines and why. Whichever PR lands second absorbs main only on a measured conflict, by git merge, never a rebase, and keeps both sides.

Live safety (on top of your skill and CLAUDE.md):
- Never run claude, ccd, ccrc, the history shim, sweep.mjs, cli.mjs, deploy/history-replay.mjs, deploy/history-gate.mjs, deploy/measure-history.py or any ccrc history verb against the live $HOME or a live store. Never read ~/.ccrc, ~/.cc-sessions, ~/.cc-limits or any account home. Never write a headless-on marker or a recall-off file anywhere but a fixture HOME.
- Every driver run in a test uses a fixture HOME, stub claude and ccrc binaries and a poisoned gh, as W2-4's and W2-5a's tests do. Nothing spawns a real model or spends on an account.
- Never enable a timer, or run ccrc update, rollback, deploy or rollout.
- A test that names a live pid uses process.pid or pid 1. Never kill processes by pattern. Kill only PIDs or process groups you started.
- The volume is short of space: keep scratch small; remove the fixtures your runs create.

Suites: from inside server/, ./node_modules/.bin/vitest run test/<file>.test.ts, in the foreground, with a Bash timeout of at least 600000, one suite per tool call, never a loop. Re-run the CLAUDE.md load flakes in isolation before calling a red real. Task 6 names the whole-PR checks: run all of them.

Departures:
- The plan defines four numbers, D-6467, D-6468, D-6469 and D-6470, in its Deviations found, on main: cite them; never redefine them.
- For a departure you find while executing, take the next unused number from this run's block: the 20 numbers issued for run 828, listed one by one in the brief as mailed.
- Define it in the plan's "## Deviations found" in the same commit that first cites it, in the plan's em-dash form.
- Never call the allocator, and never write a range, in any file or commit message. Run deviation-refs after `git fetch origin main` before each push. Name every number you used in your wave-done.

Not yours: merging, rollout, the window and every operator act, W2-5b2, W2-6, every other ccrc-history PR, and the ledger.

Before wave-done:
- Run a whole-branch review of your own: four Opus · high lenses (correctness, the must-holds adversarially, decisions and plan conformance, does-it-reproduce) with refuters, pointed at the plan's Review Focus. Fix what it confirms.
- Read the PR's review threads (gh api graphql, reviewThreads). A CodeQL thread left open blocks the merge even while its check reads green. Fix its cause in code; never resolve a thread or dismiss an alert yourself.
Open the PR against main, ready for review (not a draft), titled "ccrc history wave W2-5b1: the arms and the judge", with the body Task 6 gives.
Wave-done when the PR is open, its checks are green, no review thread is open, and your branch tip is the PR head. Your fingerprint is the workspace branch tip.

Routing (clause 13; routing-matrix row "bulk work larger than one context", as waves 2 to 11):
- main loop: Opus, ultracode, orchestrating;
- implementer subagents: Sonnet at effort high (never below); per-task reviewer: Opus at effort high; scouts: Haiku; workflows on, compact threshold 40.
- Name the model and effort explicitly on every Agent and agent() call.
- Every subagent and workflow prompt opens with: "You are a subagent of the run 828 worker, not the worker. Do not invoke ccrc-worker. Never run ccrc-api, mail or claims. Return your report."
- If moved to a GPT lane, mail me at once. Commit after each task; the branch is the resume point.

Questions go through your skill's AskUserQuestion rule. New build questions I rule on under the directive of 2026-10-19; acts outside the build go to the operator.
```
