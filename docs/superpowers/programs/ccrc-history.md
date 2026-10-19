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
are written as their PRs become dispatchable.
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
| 5h-1 | B4's export hardening ("Owed from B4", items 1–8): the check after a bind in bounded, resumable batches, with doctor's rule for a check that cannot finish; a carried segment that counts only when whole and this store's; a vanished segment that re-arms the check; replay that marks by the last carrier; `expand`'s variants and `ENTRY_UPSERT`'s tie; the history-off advice for a carry; B4's errata | fleet | — | run 626, dispatched once this ledger merges (brief below) |
| 5h-2 | B2's owed items 1–5 ("Owed from B2") and B3's errata ("Owed from B3"): the named value class widened (the `Bearer` and box-token header classes stay as they are), with stored text re-cleaned as a sweep phase; the relay's look-behind window; the op marker's identity; `lag-high`'s remedy; the errata. B2's item 6 stays later | fleet | — | its plan is in adversarial review (the relay's key fix), its PR to follow; dispatched after 5h-1 lands: the re-clean shares the run budget with 5h-1's bounded check, and both edit `lib.mjs`'s `deriveHealth` and `HEALTH_REMEDIES` |
| 6 | W2: the replay eval and its gate (ruled Q7, Q14), in eight PRs on two lanes (rows below); the W2 decisions document is the authority | fleet + deploy | — | the build runs now; the window waits on the operator's acts (decisions §5) |
| W2-1 | the recall-off verb and its generation checks, the per-tick presence record, the exports the deploy lane reads | fleet | — | after 5h-2 (the fleet lane runs one PR at a time) |
| W2-2a | the as-of cut | fleet | — | after W2-1 |
| W2-2b | the headless seam | fleet | — | after W2-2a |
| W2-3 | `deploy/history-gate.mjs`, pure: windows, bootstrap, assignment, the gate, the quiz's labeller and admission, the open-record validator; `measure-history.py`'s raw rows and census | deploy | — | run 636, dispatched once this ledger merges |
| W2-4 | `deploy/history-replay.mjs`, the driver core: the spawn contract, account admission, `--out`, limits and budget, preflights, step 0a and the probe | deploy | — | run 637, dispatched once this ledger merges |
| W2-5a | reconstruction, admission, the quiz builder and the open-record subcommands | deploy | — | after W2-1 and W2-4 |
| W2-5b | the arms, the judge, the hand-check, uptake, the marker and the report | deploy | — | after W2-2b, W2-3 and W2-5a; merges before open-record part 1 |
| W2-6 | the report-only counters | deploy | — | after W2-5b |
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
    D-5633, D-5634, D-5635, D-5636, D-5637 and D-5638. Run 626 (wave 5h-1) holds 23 numbers for what it finds while
    executing: that block's unused 5639, 5640 and 5641, and 20 issued at run-open, listed one by one in its brief.
  - The W2 decisions document's 19 departures were issued on 2026-10-19 in one block: D-5763, D-5764, D-5765,
    D-5766, D-5767, D-5768, D-5769, D-5770, D-5771, D-5772, D-5773, D-5774, D-5775, D-5776, D-5777, D-5778, D-5779,
    D-5780 and D-5781. Each is defined once, in the plan of the first W2 PR that ships it (the document's section 6
    names which); the W2-3 plan defines eleven of them. Runs 636 (W2-3) and 637 (W2-4) each hold 15 numbers for what
    they find while executing, issued at run-open and listed one by one in their briefs.
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

- **Order.** Part A merged first (#300), then B1 (#315), then B2 (#404), then B3 (#425), then B4 (#623). Wave 5h-1
  builds on all of them, and wave 5h-2 on 5h-1.
- **Peers.** The worker reads `GET /api/claims?project=ccrc-pwa` before each first edit of an existing file. Wave 5h's
  hot files are `ccd/history/*.mjs`, `ccd/history/recall.mjs` and the history tests; whichever PR lands second merges
  main and keeps both sides.
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
  suites add to it until disk-hygiene wave 1 lands. Workers clean up the fixtures their own runs create.
- **Merge conflicts to expect** (spec §10.6): disk-hygiene W2 and GPT-lane Part 3a/3b edit `ccd/ccrc-doctor-checks`;
  landing-order and continuity edit `ccd/session-hook.sh`. A worker re-anchors by content on its own base.

## Next-wave brief

Two deploy-lane waves dispatch once this ledger's docs PR merges, beside wave 5h-1 (run 626, working; its brief is in
this file's history): W2-3 is run 636 and W2-4 is run 637 (route for both: opus, ultracode, subagent sonnet, workflow
on, compact 40). Their files are disjoint from each other and from 5h-1's. Wave 5h-2's brief is written here once its
plan merges.

```text
Run 636 - programme ccrc-history, wave W2-3: the gate module and the census. Coordinator: ccrc-pwa-quiet-ridge.

Ledger: docs/superpowers/programs/ccrc-history.md (on main).
Authority: docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md (the W2 decisions document). Read its sections 1, 2 (your PR's entry) and 4, and every decision your plan's Decisions table lists.
Plan: docs/superpowers/plans/2026-10-19-ccrc-history-w2-3-gate-module.md. Read its header first, through "Not in this plan". Then do Tasks 1-9 in order.
Spec: docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md (rev 3.6), §10.2 (the replay eval and the gate).

Execution skill: superpowers:subagent-driven-development.
Commit on this workspace's own branch. Do not create or switch to a separate feature branch.

What the wave ships: one PR, the plan's Goal. deploy/history-gate.mjs (pure: the window builder, the bootstrap, the assignment, the gate, the quiz's labeller and admission, the open-record validator) and measure-history.py's raw-row and census output. Exactly three files: create deploy/history-gate.mjs; modify deploy/measure-history.py and server/test/measure-history.test.ts. Never ccd/**, shared/**, the spec, README.md, CLAUDE.md, .github/** or deploy/history-replay.mjs. If a task seems to need another file, stop and mail me.

Rulings: the decisions document and the plan's Decisions table, as written. The open-record defaults in them are confirmed by the operator at W2 open, never by you.

Base: main at the commit that merges this ledger, or later. The plan was written on main 7d01973a2. Re-anchor every Modify by its content; line numbers are hints. Schema v2, no migration.

Measuring: run each step and record what it prints; "predicted" reds and counts were written before the code. A red at a CONTROL is the fixture's to fix, never the guard's to weaken. Every mutant must red when its guard is removed; if one cannot, report it. Every -t filter is a regex: keep each regex-safe and selecting at least one test. Key-shaped fixtures are assembled at runtime.

Public repo: no private name in any file, commit message, PR title or body, and no real family id, account, node or seed anywhere (synthetic stand-ins only). Before each push, run `grep -c -i -w -F -f <(cut -f2 "$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names" | grep -v '^#')` over your added lines, your commit messages and the PR body. It must print 0. On a non-zero count, get line numbers only (grep -n ... | cut -d: -f1), judge each hit by its line, and never print a matched token.

Peers: read GET /api/claims?project=ccrc-pwa before your first edit to any existing file. Your file list is disjoint from every other running ccrc-history worker's (5h-1 in the fleet lane, and W2-4 beside you). Any path another run holds: do not edit it; mail me the path, the lines and why. Whichever PR lands second merges main (never a rebase) and keeps both sides.

Live safety (on top of your skill and CLAUDE.md):
- Never run claude, ccd, the history shim, sweep.mjs, cli.mjs, measure-history.py against a real store, any ccrc history verb or any --op against the live $HOME. Never read ~/.ccrc, ~/.cc-sessions, ~/.cc-limits or any account home.
- Never create or touch ~/.ccrc/history. Never enable a timer. Never run ccrc update, deploy or rollout.
- Fixture HOMEs only. Remove every fixture directory and Python bytecode file your runs create.
- Never kill processes by pattern (pkill -f, killall). Kill only PIDs or process groups you started.

Suites: from inside server/, ./node_modules/.bin/vitest run test/<file>.test.ts, in the foreground, with a Bash timeout of at least 600000. Re-run the CLAUDE.md load flakes in isolation before calling a red real. The plan's last task names the whole-PR checks: run all of them.

Departures:
- The plan's own numbers are in its Deviations found: cite them; never redefine them.
- For a departure you find while executing, take the next unused number from this run's block: 5786, 5787, 5788, 5789, 5790, 5791, 5792, 5793, 5794, 5795, 5796, 5797, 5798, 5799, 5800.
- Define it in the plan's "## Deviations found" in the same commit that first cites it, in the plan's em-dash form.
- Never call the allocator, and never write a range, in any file or commit message. Run deviation-refs after `git fetch origin main` before each push. Name every number you used in your wave-done.

Not yours: merging, every rollout, every operator act the W2 decisions document's section 5 lists, and every other W2 PR.

Before wave-done:
- Run a whole-branch review of your own: three Opus · high lenses (correctness, spec and decisions-document conformance, does-it-reproduce) with refuters. Fix what it confirms.
- Read the PR's review threads (gh api graphql, reviewThreads). A CodeQL thread left open blocks the merge even while its check reads green. Fix its cause in code (spawn with argv arrays, never a shell; no env value in a command string); never resolve a thread or dismiss an alert yourself.
Open the PR against main, ready for review (not a draft), titled "ccrc history W2-3: the gate module and the census", with the body the plan's last task gives.
Wave-done when the PR is open, its checks are green (build-pwa, test (agent), test (pwa), test (server), node floor, typecheck), no review thread is open, and your branch tip is the PR head. Your fingerprint is the workspace branch tip.

Routing (clause 13; routing-matrix row "bulk work larger than one context", as waves 2 to 6):
- main loop: Opus, ultracode, orchestrating;
- implementer subagents: Sonnet at effort high (never below); per-task reviewer: Opus at effort high; scouts: Haiku; workflows on, compact threshold 40.
- Name the model and effort explicitly on every Agent and agent() call.
- Every subagent and workflow prompt opens with: "You are a subagent of the run 636 worker, not the worker. Do not invoke ccrc-worker. Never run ccrc-api, mail or claims. Return your report."
- If your session is moved to a GPT lane, mail me at once.
- Commit after each task. If the session dies, the branch is the resume point.

Questions go through the AskUserQuestion rule in your skill. I answer what the spec, the decisions document, the plan and the ledger already decide. A new build question I rule on under the operator's directive of 2026-10-19 and record in the ledger. Acts outside the build go to the operator.
```

```text
Run 637 - programme ccrc-history, wave W2-4: the replay driver core. Coordinator: ccrc-pwa-quiet-ridge.

Ledger: docs/superpowers/programs/ccrc-history.md (on main).
Authority: docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md (the W2 decisions document). Read its sections 1, 2 (your PR's entry), 4 and 5, and every decision your plan's Decisions table lists.
Plan: docs/superpowers/plans/2026-10-19-ccrc-history-w2-4-driver-core.md. Read its header first, through "Not in this plan". Then do Tasks 1-9 in order.
Spec: docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md (rev 3.6), §10.2 (the driver's spawn contract, the account allow-list, RP1 to RP4 and RP9).

Execution skill: superpowers:subagent-driven-development.
Commit on this workspace's own branch. Do not create or switch to a separate feature branch.

What the wave ships: one PR, the plan's Goal. deploy/history-replay.mjs: argument parsing and the --out rule, the TMUX_PANE refusal, account admission from the roster, the spawn contract (env -i allow-list, explicit PATH, empty 0700 cwd, flags, tools, the three allowed spellings), the writer and judge spawn modes, redaction of spawned text, the limits stop and spend budget, the version/tree/wrapper preflights, step 0a and the probe. Files: create deploy/history-replay.mjs and server/test/history-replay.test.ts; modify .github/workflows/ci.yml (one line in the node-floor heredoc), shared/lifecycle.ts (the history-replay-out row) and server/test/lifecycle.test.ts (the W2 key split). Never ccd/**, the spec, README.md, CLAUDE.md, deploy/history-gate.mjs or deploy/measure-history.py. Every test runs a STUB claude on a fixture HOME: never spawn a real claude, never read a real roster, wrapper, secrets file or limits row. If a task seems to need another file, stop and mail me.

Rulings: the decisions document and the plan's Decisions table, as written. Because the PR edits .github/, its CI runs the full server suite.

Base: main at the commit that merges this ledger, or later. The plan was written on main 7d01973a2. Re-anchor every Modify by its content; line numbers are hints. If 5h-2 has been dispatched and holds shared/lifecycle.ts or server/test/lifecycle.test.ts when you reach them, edit only your rows (history-replay-out, the W2 key split, HISTORY_LANDED) beside its claim: it edits only the history-store-id row and its pin. Whichever PR lands second merges main.

Measuring: run each step and record what it prints; "predicted" reds and counts were written before the code. A red at a CONTROL is the fixture's to fix, never the guard's to weaken. Every mutant must red when its guard is removed; if one cannot, report it. Every -t filter is a regex: keep each regex-safe and selecting at least one test. Key-shaped fixtures are assembled at runtime.

Public repo: no private name in any file, commit message, PR title or body, and no real family id, account, node or seed anywhere (synthetic stand-ins only). Before each push, run `grep -c -i -w -F -f <(cut -f2 "$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names" | grep -v '^#')` over your added lines, your commit messages and the PR body. It must print 0. On a non-zero count, get line numbers only (grep -n ... | cut -d: -f1), judge each hit by its line, and never print a matched token.

Peers: read GET /api/claims?project=ccrc-pwa before your first edit to any existing file. Your file list is disjoint from every other running ccrc-history worker's (5h-1 in the fleet lane, and W2-3 beside you). Any path another run holds: do not edit it; mail me the path, the lines and why. Whichever PR lands second merges main (never a rebase) and keeps both sides.

Live safety (on top of your skill and CLAUDE.md):
- Never run claude, ccd, the history shim, sweep.mjs, cli.mjs, measure-history.py against a real store, any ccrc history verb or any --op against the live $HOME. Never read ~/.ccrc, ~/.cc-sessions, ~/.cc-limits or any account home.
- Never create or touch ~/.ccrc/history. Never enable a timer. Never run ccrc update, deploy or rollout.
- Fixture HOMEs only. Remove every fixture directory and Python bytecode file your runs create.
- Never kill processes by pattern (pkill -f, killall). Kill only PIDs or process groups you started.

Suites: from inside server/, ./node_modules/.bin/vitest run test/<file>.test.ts, in the foreground, with a Bash timeout of at least 600000. Re-run the CLAUDE.md load flakes in isolation before calling a red real. The plan's last task names the whole-PR checks: run all of them.

Departures:
- The plan's own numbers are in its Deviations found: cite them; never redefine them.
- For a departure you find while executing, take the next unused number from this run's block: 5801, 5802, 5803, 5804, 5805, 5806, 5807, 5808, 5809, 5810, 5811, 5812, 5813, 5814, 5815.
- Define it in the plan's "## Deviations found" in the same commit that first cites it, in the plan's em-dash form.
- Never call the allocator, and never write a range, in any file or commit message. Run deviation-refs after `git fetch origin main` before each push. Name every number you used in your wave-done.

Not yours: merging, every rollout, every operator act the W2 decisions document's section 5 lists, and every other W2 PR.

Before wave-done:
- Run a whole-branch review of your own: three Opus · high lenses (correctness, spec and decisions-document conformance, does-it-reproduce) with refuters. Fix what it confirms.
- Read the PR's review threads (gh api graphql, reviewThreads). A CodeQL thread left open blocks the merge even while its check reads green. Fix its cause in code (spawn with argv arrays, never a shell; no env value in a command string); never resolve a thread or dismiss an alert yourself.
Open the PR against main, ready for review (not a draft), titled "ccrc history W2-4: the replay driver core", with the body the plan's last task gives.
Wave-done when the PR is open, its checks are green (build-pwa, test (agent), test (pwa), test (server), node floor, typecheck), no review thread is open, and your branch tip is the PR head. Your fingerprint is the workspace branch tip.

Routing (clause 13; routing-matrix row "bulk work larger than one context", as waves 2 to 6):
- main loop: Opus, ultracode, orchestrating;
- implementer subagents: Sonnet at effort high (never below); per-task reviewer: Opus at effort high; scouts: Haiku; workflows on, compact threshold 40.
- Name the model and effort explicitly on every Agent and agent() call.
- Every subagent and workflow prompt opens with: "You are a subagent of the run 637 worker, not the worker. Do not invoke ccrc-worker. Never run ccrc-api, mail or claims. Return your report."
- If your session is moved to a GPT lane, mail me at once.
- Commit after each task. If the session dies, the branch is the resume point.

Questions go through the AskUserQuestion rule in your skill. I answer what the spec, the decisions document, the plan and the ledger already decide. A new build question I rule on under the operator's directive of 2026-10-19 and record in the ledger. Acts outside the build go to the operator.
```
