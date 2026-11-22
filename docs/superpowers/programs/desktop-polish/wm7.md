# Task WM7: the task note (desktop polish run 2970, D-8845)

The note for the programme work map's Task WM7, written by its worker for the coordinator to fold into the ledger. Each claim says whether it was
**measured** (read on the tree, in a browser or in a test run by this task) or **inferred**. WM7 closes the findings the reviews of WM1 to WM4
left as safe to carry. The reports are the coordinator's, outside the tree (reviews 2740, 2815, 2873 and 2956); a finding is cited by its number.

## 1. What each finding came to

| Review / finding | Disposition | Where | Basis |
|---|---|---|---|
| WM4 (2956) F1: the work read's shape check covers every field the card reads | Fixed: `end`, `beforePlan` and `runs` are each null or an object, `runs.items` a list; the comment says only that | `pwa/src/ledgers/workRead.ts`; `programme-screen.test.tsx` | Measured: the case and four mutants (§3) |
| WM4 F2: a title's room in a one-column window of about 690 to 719px | Fixed: the three-column step moved from 40rem to 43rem | `pwa/src/ledgers/ledgers.css`; `work-card.test.tsx`; the real-Chrome file | Measured in Chrome: 267, 277, 292px at windows 690, 700, 715 before, 297px at 360; at or above 297 at 690, 700, 715, 719, 725, 731 and 740 after |
| WM4 F3: wm4.md's claim about 1920 | Corrected: no desktop width draws the one-row layout | `wm4.md` §6 and §11; the browser file's header | Measured by review 2956's lens 3; the corrected sentence is checked against this task's own 1920 runs (two columns) |
| WM4 F4: the sample data, the pictures | Fixed: t-5 carries Epic B; a data-consistency case; nine pictures re-taken and viewed; WM3's four copies re-copied (byte-identical to WM4's) | the browser file; `docs/design/…/wm4`, `wm3` | Measured: `sha256sum` of each pair; the pictures viewed |
| WM4 F5: the facts back in the third track | Fixed: a regex in the 43rem block, and a real-Chrome check of where the facts stand | `work-card.test.tsx`; the browser file | Measured: the survivor (deleted `grid-column: auto`) is red in both |
| WM4 M1 to M5 | Corrected in `wm4.md` | `wm4.md` | Read against the tree; M2 and M5's counts are the reviewer's measurements, not re-run (inferred) |
| WM4 M6 | Done in passing: the 800 sample asserts it reaches the step | the browser file | Measured: it passes at 800 (a 758px card) |
| WM4 M7 to M9 | Left (M7, M8 are strength and duplication notes with no ruling; M9 waits for its ruling) | none | None needed |
| WM3 (2873) F15: a server word the card does not know | Fixed: every lookup of a server word falls back to the word itself, through one helper | `workMapWords.ts`; `work-card.test.tsx` | Measured: four cases, a mutant per lookup |
| WM2 (2815) F1: a checkpoint's answered item | Fixed (a case) | `plan-routes.test.ts` | Measured: the mutant of `openIds.has` |
| WM2 F2: a foreign-programme or review evidence run | Fixed (two cases) | `plan-routes.test.ts` | Measured: the combined mutant (the foreign case is killed by the program half and the review case by the kind half; each half alone was not run: inferred) |
| WM2 F3: `doneAt` and a phase's finish | Fixed (a case) | `plan-routes.test.ts` | Measured |
| WM2 F4: a carry on a folded auto ticket's key | Fixed (a decider case) | `workMapCases.ts` | Measured |
| WM2 F5: the last failed run with a second open ticket | Fixed (the case extended) | `workMapCases.ts` | Measured |
| WM2 M2: the landing line's project | Fixed (a two-project case) | `plan-routes.test.ts` | Measured |
| WM2 M3: `programmeWorkRuns` against `ticketOfRun` | A reason, and a parity case; `store.ts` is not edited | `wm2.md` §2.2; `plan-routes.test.ts` | Measured: the mutant (the join on the wrong column) |
| WM2 M4: the two run-unreadable arms | Fixed: a `ccrc-server:` warning on each, by a co-edit of two lines | `planRoutes.ts`; `plan-routes.test.ts` | Measured: two cases red-first on the old source, green after, red under a mutant each |
| WM2 M5: malformed evidence | Fixed (a case) | `plan-routes.test.ts` | Measured |
| WM2 M6: a run id that differs from the holder key | Fixed (a decider case) | `workMapCases.ts` | Measured |
| WM2 M7: the `runVerdicts` wiring | Fixed: a case that builds the real server | `server/test/plan-work-wiring.test.ts` | Measured: red when the line in `server.ts` is deleted |
| WM2 M8, F6 | Records | `wm2.md` §2.1, §8.1, §8.7, §8.8 | Read against the tree; F6's run is §4 |
| WM2 M1, M9 to M11 | Left (M1 needs a ruling; the others are notes) | none | None needed |
| WM1 (2740) F1: the `{ runId }` arm's landing lines | Fixed (a two-project route case) | `plan-ticket-done.test.ts` | Measured: a hand mutant (there is no floor mutant on `planRunFacts.ts`) |
| WM1 F2: the `{ pr }` holder over several ties | Fixed (a verdict case), and recorded as unreachable through the route | `planTicketDoneCases.ts`; `wm1.md` §7 | Measured: the mutant `slice(-1)`. Unreachable by reading: `UNIQUE (project, pr)` in `landing_entries`, the re-pin in `landingEntry.ts`, and one project's line read for a `{ pr }` (inferred from reading, not run) |
| WM1 F3: a record | Recorded in `wm1.md` §7 and the plan section | `wm1.md` | Measured by reading and by grep |
| WM1 F4 | Left: the review's own direction says "later" | none | A decision in delivery that fails closed; no ruling is needed |
| WM1 F5, F7, F9 to F12 | Records | `wm1.md` §2, §3, §5, §7 | Read against the tree |
| WM1 F6 | WM5's | none | None needed |
| A finding already closed at main | None found | none | Both subagents looked: each gap was open (each mutant survived before the new case) |

## 2. Departures, named by slug (the plan's D-8845 entry carries the same list)

- `three-column-step-43rem`: the three-column row starts at 43rem, not 40rem (review 2956 F2). D-8823's entry in the plan still says 40rem; this entry
  supersedes it. The spec rules only that the table switches on the card's own width, not the figure, so no ruling was needed.
- `m3-reason-and-parity-case`: M3 gets a recorded reason (`wm2.md` §2.2) and a parity case, with no comment in `store.ts`, which another wave's claim holds.
  The reason is honest about its size: one statement per programme instead of N one-row reads, not a TOCTOU or another process.
- `f7-recorded-not-edited`: the auth-gate tally comment is left as it is and said so in `wm1.md` §7, the alternative the finding's direction offers; its
  file is another wave's.
- `wm1-f4-left`: left, as the finding's own direction says "later".
- `wiring-pin-through-the-real-server`: M7 is pinned by a case that builds the real server with a real watcher (`plan-work-wiring.test.ts`), not a
  source-text scan of `server.ts`.
- `shape-fixtures-widened`: the pure cases' `shape` fixture in `programme-screen.test.tsx` gained `end`, `beforePlan` and `runs` (null), since the
  stricter shape check refuses a view without them.
- `fallback-is-the-word`: the fallback for a word the card does not know is the word itself, for a status, a carried row's status now, a checkpoint kind
  and an unreadable word; the card does not hide or generalise it.

## 3. Mutants

Each was applied alone to a file saved first in the session's scratch directory, the named run made, and the file restored with `cp` from the saved copy
and compared with `cmp` (never `git checkout`). Measured. Loads are the one-minute figure at the start of the run.

### 3.1 pwa

| Id | File | Mutant | Red cases |
|---|---|---|---|
| W-1 | `workMapWords.ts` | `wordIn` is a plain `table[word]` | the four F15 cases |
| W-2 | `workMapWords.ts` | the status lookup back to `STATUS_WORD[status]` | the status case and the carried-row case |
| W-3 | `workMapWords.ts` | the unreadable lookup back to `UNREADABLE_WHY[why]` | the unreadable case |
| W-4 | `workMapWords.ts` | the checkpoint lookup back to `CHECKPOINT_KIND_WORD[cp.kind]` | the checkpoint case |
| R-1 | `workRead.ts` | `isNullOrRecord(v.end)` read as `true` | the F1 case |
| R-2 | `workRead.ts` | `isNullOrRecord(v.beforePlan)` read as `true` | the F1 case |
| R-3 | `workRead.ts` | the `runs` clause read as `true` | the F1 case |
| R-4 | `workRead.ts` | `runs` an object with no check of `items` | the F1 case |
| C-1 | `ledgers.css` | the facts' `grid-column: auto` removed | the layout regex in `work-card`; in Chrome the 800, 731 and 740 cases ("the facts are not right of the title": 161 against 537, 468 and 477) |
| C-2 | `ledgers.css` | the step at 42rem | the layout regex |
| C-3 | `ledgers.css` | the step at 40rem | the layout regex; in Chrome the 690, 700, 715, 719 and 725 cases (title 267 against 297 at 690, 277 at 700) |
| B-1 | the browser file | t-5 without its Epic B tag | `the sample data is consistent` ("expected t-1, t-2, t-5 to equal t-1, t-2") |

### 3.2 server

| Id | File | Mutant | Red case |
|---|---|---|---|
| S-1 | `planRoutes.ts` | the `openIds.has(c.itemId)` filter removed | WM2 F1 (waiting-on-you with a stale item) |
| S-2 | `planRoutes.ts` | the evidence verdict gets `slug` and `'work'` instead of the run's program and kind | WM2 F2, both cases |
| S-3 | `planRoutes.ts` | the done map's time handed as `null` | WM2 F3 (`doneAt` null, finish unknown) |
| S-4 | `planRoutes.ts` | `'project-a'` in place of `d.project` in the `evidenceLinksOf` call | WM2 M2 (a third item, the epic total 3) |
| S-5 | `planRoutes.ts` | malformed evidence skipped before the verdict | WM2 M5 (the reason reads "the evidence was not read") |
| S-6 | `planRoutes.ts` | the runs-read warning removed | WM2 M4, the work-runs case (`expected 0 to be 1`) |
| S-7 | `planRoutes.ts` | the evidence-run warning removed | WM2 M4, the evidence-run case |
| S-8 | `server.ts` | `runVerdicts: watcher?.runVerdicts` deleted | `plan-work-wiring` (`not-read` for `read`) |
| S-9 | `store.ts` | `programmeWorkRuns` joins `plan_tickets` on `r.id` | the parity case (`t2` for `run-2`) |
| S-10 | `workMap.ts` | `carryOut` compares `x.key`, not `canonical(x.key)` | WM2 F4 (carried 0, finish 500) |
| S-11 | `workMap.ts` | the `r.ticketKey === t.key` match dropped from the last-failed lookup | WM2 F5 (`lastFailedRunId` 6) |
| S-12 | `workMap.ts` | the fold names `autoTicketKey(p.runId)`, not `p.holder.key` | WM2 M6 |
| S-13 | `planRunFacts.ts` | a `{ runId }` reads only the ticket's own project's line | WM1 F1 (200 for 409) |
| S-14 | `planPolicy.ts` | `ties.find(` read as `ties.slice(-1).find(` | WM1 F2 (`ok` for `evidence-unverified`) |

The two subagents' mutants (S-1 to S-5, S-8, S-10 to S-14) were run by them and their red messages read here; S-6, S-7 and S-9 and every pwa
mutant were run by this worker. Reds measured: yes for all; each subagent's report named the failure text above.

## 4. Runs

Every run through `ccrc test`, cd'd into the package, one file per process, `--maxWorkers=2`, in the foreground; the load is the one-minute figure at the
start (the box ran at 9 to 28 throughout, and the slice's 6 GB memory cap killed processes in most runs: its message is quoted where a run's own result
was touched). Measured.

**pwa** (loads 18.8 to 20.9 for the card and word suites): `programme-screen` 99 of 99 (98 plus the F1 case); `work-card` 76 of 76 (72 plus four F15 cases);
`ledger-words` 86; `plain-words` 65; `contrast` 367; `fleet-css` 102; `literal-census` 5; `tap-targets` 96. The compile check, `tsc --noEmit` in `pwa/`: the
first run was killed by the slice's memory cap (exit 137, load 14.3); the rerun alone, queued 1308 s, exited 0. Real Chrome
(`programme-work-page.browser.test.ts`, with `CCRC_CHROME` set to the Chromium that is cached on this box, since `/usr/bin/google-chrome` is absent here):
the first run after the edit failed at startup in a memory-cap kill, the rerun alone passed 23 of 23 (load 28.6), and with the data-consistency case 24 of 24
(twice, the second with `CCRC_SHOTS` set for the pictures). No pwa test other than `programme-screen` and `work-card` imports `workRead`, `workMapWords` or `WorkCard` (grep).

**server**: `plan-routes` 54 of 54 in one whole-file run (load 9.75, verbose); four other whole-file runs (the subagent's and this worker's, loads 9 to 21)
each had exactly one `Hook timed out in 20000ms` in a different early case (`ticket-move moves an open ticket …`, `a put after close …`, `text that leaves
for Linear …`), every run with 1 to 19 slice OOM kills. Inferred: it is load, since every case opens a fresh `coord.db` and the verbose run shows each
case spending 5 to 9 s, so one stall past the hook's 20 s fails whichever case it lands on; the old file at main (45 cases) passed once at load 14.5, which
is one run. CI's `test (server)` is the arbiter. `plan-work-wiring` 1 of 1; `work-map` 96 of 96; `plan-ticket-done` 66 of 66 (the subagent's first run,
at load 28, had five timeouts in older cases; its rerun alone passed); `plan-policy` 62; `refusal-status` 28 (the WM2 F6 row, `wm2.md` §8.8);
`ci-ledger-guard` 32; `dtbd` 1; `topology-clean` 61; all 42 `single-definition/` files green. `deviation-refs` (after `git fetch origin main`, main at
`f95ac048a4`): 33 of 34 in the run and in the rerun alone, the one red the known two-real-trees case timing out at 20 s (load 13.8 and 16.9), as in reviews
2740, 2815 and 2873; every other case passed. Compile: `tsc --noEmit -p tsconfig.json` exit 0; the test project
(`-p test/tsconfig.tests.json`) was killed by the memory cap twice (exit 137, loads 10.5 and 10.8), so it is **not measured here**; a narrow compile of the
six changed test files (a config kept in the scratch directory, extending `tsconfig.json`) exits 0, clean. The merge of the tip with `origin/main`
(`git merge-tree`) exits 0. The ledger guard script is not run by hand here: its own test (32 of 32) passes, and CI's run on the PR is the arbiter.


## 5. Claims and consents

- Claimed (measured: the claim API): 6022 (server tests, the work map, `planRunFacts.ts`, `planPolicy.ts`, `wm1.md`, `wm2.md`, this note), then, as the ended
  WM4 session's claims lapsed, the card, its tests, its stylesheet and `wm4.md` and the pictures, `workRead.ts`, the browser file and `wm3`'s pictures.
- Co-edits (recorded from the mails that granted them; the tree cannot show a consent): `planRoutes.ts` (two warning lines), the holder's consent
  2026-11-20; the plan (one new section), the holder's consent 2026-11-20.
- Avoided: `store.ts` and `auth-gate.test.ts`, held by other waves (M3 and F7 took the record alternatives).
- Inferred, not measured: that the WM4 session's claims lapsed because it had ended (they were refused with "not in registry" and no way to mail).
