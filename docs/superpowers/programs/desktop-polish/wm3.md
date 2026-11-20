# Task WM3: the task note (desktop polish run 2859, D-8806)

The note for the programme work map's Task WM3, written by its worker for the coordinator to fold into the ledger. Each
claim says whether it was **measured** (read on the tree, in a browser or in a test run by this task) or **inferred**.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| `WorkCard({ work, readAt, runHref, itemHref, epicHref? })`: the headline and bar, the epic strip (a tap filters, a second clears), the source line, the phases in order (a finished one folded to its line), each ticket's status word, epic tag and facts, "Not in a phase", the folded Done when line, the initiatives. One piece of local state (the epic filter), no store, no route, no last view | `pwa/src/ledgers/WorkCard.tsx` (L4, C5) | Measured: `work-card.test.tsx` |
| The words: `statusWord` (keyed by `WORK_STATUSES`), `headline`, `outstandingLine`, `sourceLine`, `phaseLine`, `foldLabel`, `epicChip`, `carriedWords`, `wholeEpicLine`, `doneWhenLine`, `initiativeNote`, and the notes of each plan state | `pwa/src/ledgers/workMapWords.ts` (L1, pure) | Measured: the same suite; the `rings`, `ownership`, `growth-check` and `growth-caps` suites pass with both files (§5). Its imports, read by hand: shared types, `@ccrc/ui`'s `elapsedWords`, `lib/format` |
| The styles at both layout rows of the plan's table, tokens only | `pwa/src/ledgers/ledgers.css`, the `.wk-` block | Measured: `contrast.test.ts` and the census suites pass with it (§5) |
| The suite | `pwa/test/work-card.test.tsx` (42 cases at the first push, 60 after fix round 1) | Measured |

Nothing mounts the card: WM4 puts it on the programme page. The card imports no stylesheet, as `GoalsPanel` does not;
`ProgrammeScreen` already imports `ledgers.css` (measured: its line 57).

## 2. Departures, named by slug (the plan's D-8806 entry carries the same list)

Each is **measured** unless it says inferred: read on the tree at the tip.

- `shipped-wire-wins`: WM2's shipped types differ from the plan's words in five places and the card reads the shipped ones.
  `WorkItemView.title` is `string | null`, so a no-plan run row with no title reads "Wave N" (its run number when it has no
  wave). `lastMoveAt` is optional: a number draws "moved 3m ago", while null and absent draw nothing (the card cannot tell a
  quiet run from an unread one by wording, and the server already kept them apart). `runs.waves` is nullable and the card
  does not read it. A checkpoint's `kind` and `state` are typed (`CheckpointKind`), and the card words `kind` from a table keyed
  by the type. `unreadable` is the typed `WorkUnreadable`. Measured: `shared/plan.ts`.
- `unreadable-words-its-own`: the plan gives no words for the two failures; the card writes "the runs could not be read" and
  "a read failed" after "The work could not be read: " (`UNREADABLE_WHY`). A case pins both.
- `unreadable-carries-the-last-view`: the plan says the page passes "the last `WorkMapView` it drew together with the
  failure's word". The shipped `WorkAnswer` is `WorkMapView | { unreadable: WorkUnreadable }` and has no `last`. The card's one
  `work` prop is its own wider `WorkCardAnswer` (`WorkCard.tsx`), whose `unreadable` arm may also carry `last`; the note draws
  over `last`, and with no `last` it draws alone. The card keeps no last view. WM4 builds the answer it passes. (Review 2873 F6
  corrected an earlier wording that put `last` on the server's type.)
- `phase-line-takes-targets`: `WorkPhaseView.carried` is a count, so "1 carried to phase 3" needs the target.
  `phaseLine(phase, carriedTo)` takes the target numbers and `carriedTargetsOf(phase, items)` reads them off the view's items
  for the tickets the phase serves as carried out.
- `phase-serves-carried-out` (review 2873 F2): the card had read "carried" off any recorded carry, which drew a closed ticket
  as carried where WM2 and Table 6a read it closed. `WorkPhaseView` gains one additive field, `carriedOut`, the keys the
  phase carried out, decided in `workMapOf` where `carried` is counted; the card reads it. No `FLEET_PROTO` bump. Pinned by
  work-map cases and the mutants T6a-3c and T6a-3d, and by card cases.
- `counted-groups-spelt-once` (F3): `WORK_COUNTED_GROUPS` in `shared/plan.ts`, derived from `WORK_GROUPS`, is read by
  `workMapOf` and by the card's headline, outstanding line (keyed by the counted groups less `done`) and bar.
- `phase-line-writes-apart-counts` (F1): a phase's line writes "· 1 closed" and "· 2 left open" beside "N of M done", as
  the headline does (spec §3.1, §5.1), and says "no work of its own yet" only for a phase holding no ticket in any group.
- `carried-row-keeps-its-status` (F11): a carried-out row reads "carried" in the status column and, among its facts, "carried
  to phase N" and "now <status>" (spec Table 6a); the plan asks only for "carried". Three or more targets read "2, 3 and 4".
- `status-word-leads-the-sentence`: `done-unverified` is worded "marked done, but" in the status cell and its reason ("no
  evidence stored") is the row's first fact, ahead of "from phase N" (F7; pinned by a case); on a carried-out row it follows
  the carry and its status now.
- `fold-label-takes-a-group`: `foldLabel(n, group = 'done')` draws "N failed" in the no-plan fallback; the plan has
  `foldLabel(n)`.
- `finished-phase-keeps-its-heading` (F13): a finished phase's `<details>` holds its `h3` inside the summary.
- `clock-is-not-state`: the card calls `useNow(30_000)`, the design system's shared clock, beside its one piece of local state
  (the epic filter), and keeps no other state. Inferred: the plan's "one piece of local state" means state of the card, and a
  shared clock tick is not that.
- `source-line-names-no-programme`: "From the plan · 3 phases · 3 epics · read 1m ago" and "From the work runs so far", not
  "From the programme's plan", under the operator's tidying notes of 2026-11-19. The card writes no "coordinator" word and
  draws no spot for the badge C50 adds, so there is no TODO to leave. Measured: a case reads the drawn text for both words.
- `layout-by-the-cards-width`: the plan's two layout rows switch at a container query on the card's own width (34rem), not
  at a viewport width, so WM4 may seat the card in either column. Measured in a browser (§6): one column at a 344 px card,
  three columns at a 684 px card.
- `bar-shows-left-open`: an ended plan's bar also draws its left-open work, so a closed plan with two left-open tickets is
  not a full "done" bar (seen in the first browser pass, then fixed; pinned by a case in fix round 1).
- `fold-chevron-drawn`: a `<summary>` drawn as a flex row loses the browser's marker, so the stylesheet draws the chevron;
  without it nothing said a folded phase, the done line or Done when could open (seen in the first browser pass).
- `tests-beside-the-code`: Step 2 is unticked. The cases and the card were written in one sitting; the red was taken after the
  fact with the two modules moved aside (the file cannot load). Each case's red is its mutant (§4).
- The card relies on `elapsedWords` from `@ccrc/ui` (one spelling of an elapsed time, the design system's own), so a read is
  "1m ago" and "moments ago", not "1 min ago" as the spec's example spells it. Inferred: the example is a sample, and a
  second spelling would be a parallel mechanism.

## 3. Cases, and what reds each

All 60 cases (42 at the first push, 18 added in fix round 1) are in `pwa/test/work-card.test.tsx`. The plan's Step 1 names 22
cases; all 22 are there, 21 under their exact name and one renamed (`initiatives off draws its note` is `initiatives off draws
its note, one per workspace`); the rest pin what the build added. Measured: each row's "Reds when" below was read off the
mutant runs of §4 where a mutant is named, and is **inferred** from the case's assertions where none is.

| Plan's case | Reds when |
|---|---|
| `the headline reads N of M done` | the "of M" leaves `held` out, or the counted groups change (mutant M3) |
| `the outstanding line names waiting on you and held apart` | a group is dropped from the line or reordered (M4) |
| `the no-plan card has no M and says what remains is not known` | the fallback prints "N of M", or loses its note |
| `a declared empty plan says so and draws no runs` | the empty state draws the runs list or the no-plan note |
| `an ended plan says how it ended and shows no outstanding work` | the ended headline (the whole text, "· 1 done · 2 left open", is pinned since fix round 1) changes, or an outstanding line is drawn for these counts. The outstanding guard itself is exercised by `an ended plan draws no outstanding line even when the view still counts outstanding work` (mutant W10); the first push's note claimed the plan-named case reds it, and it did not (review 2873 F5) |
| `an ended plan words the left-open status WM2 sends for a ticket marked done whose evidence does not verify, and draws no outstanding line` | the card words that status as "marked done, but", or draws the line (mutant M2 reds it too) |
| `an unreadable answer says so` | the alert is missing |
| `verdicts not read are named on the source line` | the source line loses "stuck and blocked not read yet" |
| `a plan with no phases says it is grouped by epic` | the note or the epic grouping goes |
| `a finished phase is one line with its date` and `a finish with no date says date unknown` | the date or "date unknown" wording changes (M6) |
| `done tickets fold into one counted line` | the fold is open, or counts another number |
| `each ticket shows its epic` | the tag is not drawn |
| `a chip filters to its epic, shows its checkpoints, and a second tap clears it` | the filter, the checkpoint row, its facts or the clear goes |
| `a carried ticket reads carried to its later phase and from its earlier one` and its dropped-source case | "carried", "carried to phase 3", "from phase 2" or "from phase <key>, dropped" changes (M5) |
| `Done when counts the proved entries` | the count or a row's proved word changes |
| `no url draws no Open in Linear` | a link is drawn with no url |
| `initiatives off draws its note, one per workspace` (the plan's name has no ", one per workspace") | the note or its once-per-workspace count goes |
| `every status has a word` | a status has no word, an empty word or a word shared with another (M1, M2) |
| `a run link opens the run`, `an item link opens the item` | the link or its href changes |
| `a long title wraps inside the card` | a rule of the wrapping chain loses `overflow-wrap: anywhere` |

Fix round 1 (review 2873) added 18 cases, each red under the mutant named in §4: the phase line writes closed and left-open
tickets (F1), a closed ticket with a recorded carry is never drawn carried and a phase names only the targets it carried out
(F2), the headline counts exactly `WORK_COUNTED_GROUPS` (F3), the `lastMoveAt` guard with the field absent, null and a number
(F4), the ended-plan outstanding guard, "Done when" proved and not proved apart, a declared-empty plan holding runs, both
unreadable reasons, the ended and left-open headline words, the singular source line, the "Run #N" fallback, the dropped epic
chip, an unbound initiative, a filter hiding an empty phase, the bar's left-open segment, the done date (F5), the reason
before the carried-from fact (F7), a carried-out row's status now, three targets joined "2, 3 and 4" (F11), no no-phases note
over dropped tickets (F12), and a heading inside a finished phase's summary (F13).

Also pinned: the two layout rows of the plan's table (a one-column row, a container-query one-row layout, a wrapping strip),
tokens-only colour, no drawn "Programme" or "coordinator", no inline colour, and the exact text of every word function.

## 4. Mutants

Three word functions were required; six were run. Each was applied to a saved copy's text, the suite run through the test
slice, and the file restored from the saved copy (verified byte-identical with `cmp` after the loop). Measured, all six red:

| # | Mutant | Cases that went red |
|---|---|---|
| M1 | the `in-review` status word emptied | `every status has a word`, `every status word is drawn for a row of that status`, `the exact words` |
| M2 | `left-open` worded "closed" (two statuses share a word) | `every status has a word`, two ended-plan cases, and one more |
| M3 | the headline's M leaves `held` out | `the headline reads N of M done` |
| M4 | the outstanding line loses "waiting on you" | `the outstanding line names waiting on you and held apart` |
| M5 | a carry from a dropped phase worded as a number | `a carry from a phase dropped since reads from phase <key>, dropped`, `the exact words` |
| M6 | a finish with no date reads as a date | `a finish with no date says date unknown`, `the exact words` |

The first M3 run was green: the headline case had no `held` tickets, so the mutant survived. The case now carries two held
tickets ("11 of 23 done"), and M3 then went red. Measured. (M3 and M4 were written against the card's own hand-kept group
lists, which fix round 1 replaced by `WORK_COUNTED_GROUPS`; W6 and W7 below are their successors.)

Fix round 1 ran 28 more, each on a saved copy of the file in a scratch copy of the tree (so the claimed `shared/plan.ts` was
untouched while its holder had not answered), each file restored from the saved copy and verified byte-identical with `cmp`
after the loop. **Measured: all 28 red.** W1 the phase line drops "closed"; W2 drops "left open"; W3 the no-work line is
chosen as before the fix; W4 targets joined with "and" only; W5 targets ignore `carriedOut`; W6 the headline's M leaves
`held` out; W7 the outstanding line drops `held`; W8 an unreadable word changed; W9 the status-now word emptied; W10 the ended
outstanding guard removed; W11 the ended headline drops "N done"; W12 the headline drops "left open"; W13 the run fallback
loses its number; W14 the chip loses "dropped"; W15 a note drawn for an unbound initiative; W16 "phases" always plural; C1
the card re-derives carried from the phases' recorded carries (the F2 shape); C2 the carried-from fact before the reason; C3
the `lastMoveAt` guard removed; C4 the no-phases note chosen on all items; C5 a finished phase's heading not a heading; C6
runs drawn for a declared-empty plan; C8 the bar drops left-open; C9 every Done when entry "proved"; C10 the status-now fact
removed; C11 a filter keeps an empty phase; C12 the done date removed. On the server, T6a-3c (`carriedOut` not pushed) and
T6a-3d (a closed ticket with a recorded carry pushed) are in `server/test/sim/workMapSets.ts`; T6a-3d alone reddens the two
closed-then-carried work-map cases (measured by hand against the scratch copy), and the floor test passes with both.

## 5. Test runs

Each through `ccrc test`, one at a time, cd'd into the package, with `--maxWorkers=2`. The box was loaded throughout (load
average 8 to 22 at the starts, recorded per row), and the slice's memory cap killed processes in several runs, because the
slice is shared with other sessions' runs. Where a run was killed or timed out, the file was re-run alone, once.

| Run | Load | Result |
|---|---|---|
| `work-card.test.tsx`, the modules moved aside (red first) | 14.1 | red: the file cannot load, "no tests" (measured) |
| `work-card.test.tsx` | 13.9 | two fixture slips in the test (a fixture string holding the struck-out word, a proved assertion reading the span), fixed in the test; then 42 of 42 |
| pwa `tsc --noEmit` | 13.3 | two type errors in the test's call of `doneWhenLine` (the word's parameter type was too narrow); fixed; clean |
| 24 pwa files: `contrast`, the census suites, `tap-targets`, `focus-ring`, `programme-screen`, `waiting-screen`, `goals-panel` and the rest of the css and words scanners | 10.8 | 891 cases passed; 4 files could not load (`typescript-api` is in `server/node_modules`, not yet installed here) |
| the same four files after `npm ci` in `server/` | 10.8 | `markup-census` red: the folded done rows were drawn by two components. Extracted one `Fold`; green |
| `work-card`, `contrast`, `markup-census`, `shape-census`, `hook-class-collision`, `tap-targets`, `control-census`, after the last styling changes | 7.8 | 545 cases passed in 7 files |
| pwa `tsc --noEmit` | 10.6 | killed by the memory cap (exit 137, 2 kills); re-run alone: clean (rc 0) |
| pwa `npm run build` | 22.5 | killed by the memory cap (exit 137); re-run alone at load 20: rc 0 |
| server: `single-definition` (the directory), `topology-clean`, `deviation-refs`, `dtbd`, `ci-ledger-guard` | 7.8 | 45 of 47 files passed; `deviation-refs`' "two real trees" case timed out at its 20 s (6 kills in the slice) |
| `deviation-refs` alone | 20.8 | killed mid-run by the memory cap (4 kills) |
| `deviation-refs` alone, again | 17.1 | 33 of 34; the same case timed out at 29.9 s |
| `deviation-refs` alone, `--testTimeout=180000` | 14.6 | 34 of 34 (rc 0) |
| server: `rings` (the directory), `ownership`, `growth-check`, `growth-caps` | 10.3 | 15 files passed, 221 cases (3 skipped by their own markers) |

### Fix round 1 (review 2873), measured 2026-11-20

Each through `ccrc test`, one file per process, cd'd into the package, `--maxWorkers=2`, load recorded at each start (5 to 29).

| Run | Result |
|---|---|
| pwa: `work-card` (load 5.3) | 60 of 60 |
| pwa: `contrast` 367, `theme-catalogue` 20, `theme-bridge` 14, `skin-catalogue` 17, `skin-identity` 74, `skin-boundary` 47, `skin-axis-census` 3, `css-vars` 3, `ink-tiers` 9, `focus-ring` 11, `hover-states` 42, `motion-reduced` 6, `button-line-height` 4, `tap-targets` 96, `hook-class-collision` 10, `layer-order` 3, `fleet-css` 102, `shell-css` 11, `literal-census` 5, `markup-census` 11, `role-census` 10, `control-census` 12, `shape-census` 7, `model-name-census` 3, `fixture-census` 3, `refusal-literal-ratchet` 2, `utility-pairs` 26, `design-system-boundary` 15, `ui-package-boundary` 24, `shadcn-alias` 3, `plain-words` 65, `mockup-census` 54, `mockup-css` 46, `ledger-words` 86, `programme-screen` 64, `waiting-screen` 95, `transcript-work-card` 5, `base-defaults` 7, `secret-input` 3, `audit-refusals` 34 | every case passed |
| pwa `tsc --noEmit` (load 9.2) | clean (rc 0) |
| server: `work-map` (94), `single-definition/plan` (5), the whole `single-definition` directory (43 files, 1549), `rings` (12 files, 133), `mutation-floors` filtered to the work-map keys with `-t workMap` (3 passed, 264 skipped by the filter: the whole file was not run; the filter was chosen up front, not after a kill), `dtbd` 1, `topology-clean` 61, `ci-ledger-guard` 32, `deviation-refs` 34 (load 24.7) | all passed |
| server `tsc --noEmit` | clean (rc 0) |
| server `plan-routes` | killed by the slice's memory cap at load 26.8 (exit 137); re-run alone once at load 15.4: 45 of 45 |
| server `typecheck-tests` | **red here, environmental, not run green**: 7 and then 2 failures, the first after 10 memory-cap kills (its programs came back empty), the second from `ws` and its types missing, because `agent/node_modules` is not installed in this workspace (the errors are all in `agent/src`). Measured by hand: `tsc --noEmit -p test/tsconfig.tests.json` reports 8 errors, every one under `../agent/`, none in a file this change touches. CI's `typecheck (server)` on a full install is the arbiter |

So `deviation-refs` has **no green at its own timeout from this task**: the case that timed out scans two whole trees, and
it passed at a longer timeout on the same tree. Inferred: it is load, not this branch (the case reads two ledgers, and the
branch's only change to them is one bullet and five ticks). CI's quiet box is the arbiter; the PR's `select tests` summary
should list the file. Not run: the browser leg (the plan gives WM4 the browser file), the macOS legs, and the whole server
suite beyond the files above.

The ledger guard's script (`.github/ci/ledger-guard.mjs`) and the private-names scan read commits and the PR body, so they were run after the last commit; their results are in the PR body and the wave-done mail, not in this note.

## 6. What was seen in a real browser

Measured with a throw-away harness outside the repository (a Vite server over the real `WorkCard`, `ledgers.css` and the
design system's tokens, one fixture answer per state, a headless Chrome at 360 and 1280 px). The harness is not in the
tree. At 1280 the card sits in a 684 px column, as the programme page's left column will seat it; I did not draw it at the
full 1280 px, and the page's own layout is WM4's.

States drawn: a phased plan (a finished phase, an open one with a carried ticket, a phase that takes a whole epic, a stuck
row, a marked-done-but row, a waiting row with an item link, a failed-run link, the initiatives and Done when), the no-plan
fallback, a declared empty plan, an ended plan, a plan with no phases, an unreadable answer over the last view, and an
unreadable first read.

- At 360 px (a 344 px card): one column, a row stacks status, title with its tag, then facts; the strip wraps; a 120-character
  unbroken title wraps inside the card. Page `scrollWidth` equals `clientWidth` in all fourteen light cases and both dark
  ones: **no sideways scroll** (measured by script).
- At 1280 px (a 684 px card): a row is three columns (120 px, 303 px, 224 px, measured), the tag wraps under the title before
  the facts wrap.
- Dark: the phased plan at 1280 was viewed. At 360 px the dark phased plan was drawn and its scroll measured, but I did not
  look at that image.
- **Unviewed after the last styling change:** the declared-empty, unreadable-first-read and ended-1280 images. They were
  drawn, and measured for sideways scroll, but I did not look at them. The ones below were viewed after it.
- What the first pass found, and was fixed before the images below: a blank band under a folded phase (a `<details>` laid out
  as a grid), no chevron on any folded line, and an ended plan's bar drawn all done.
- Not done: a real programme's data, a touch device, a screen reader, and the two skins other than the default.

Screenshots (all viewed after the last styling change, except where §6 says otherwise):

| Image | What |
|---|---|
| ![Phased plan, 1280 px, light](../../../design/2026-11-16-programme-work-map-design/wm3/phased-1280-light.png) | phased, 684 px card, the first epic open |
| ![Phased plan, 360 px, light](../../../design/2026-11-16-programme-work-map-design/wm3/phased-360-light.png) | phased, 344 px card, the first epic open |
| ![Phased plan, 1280 px, dark](../../../design/2026-11-16-programme-work-map-design/wm3/phased-1280-dark.png) | phased, dark |
| ![No plan, 360 px](../../../design/2026-11-16-programme-work-map-design/wm3/noplan-360-light.png) | the no-plan fallback |
| ![Ended plan, 360 px](../../../design/2026-11-16-programme-work-map-design/wm3/ended-360-light.png) | an ended plan |
| ![Plan with no phases, 1280 px](../../../design/2026-11-16-programme-work-map-design/wm3/nophases-1280-light.png) | grouped by epic, with a closed ticket |
| ![Unreadable over the last view, 1280 px](../../../design/2026-11-16-programme-work-map-design/wm3/unreadable-1280-light.png) | an `unreadable` answer over the last view |

## 7. Records and claims

- Claim 5762 (this task's new files and `ledgers.css`, the note). The plan, `docs/superpowers/plans/2026-11-16-programme-work-map.md`,
  was held by WM6's worker (claim 5756); I asked for a co-edit of exactly two places and they consented by mail on
  2026-11-20: WM3's step ticks, and one bullet at the end of Deviations found. Their PR had landed on `main` by then, so the
  branch conflicted in that one section (`git merge-tree` exited 1, clause 16's first trigger); I absorbed `origin/main`
  with one `git merge` (the base was `origin/main` at `208afddcab48303bc699c812c79cd3d1666732bc`, merge commit `b3989d5468`), kept both bullets (D-8780 then D-8806) and changed no line of theirs.
- The plan's Step 2 is unticked since fix round 1 (review 2873 F9), as WM2 left its own: the red was measured after the code
  was written, with the two modules moved aside (the file cannot load), which is a weaker red than a case-by-case one; the
  case-by-case red is the mutants (§4). The departure is `tests-beside-the-code` (§2).
- Fix round 1 claims (measured from the claim list on 2026-11-20): claim 5806 (the decider, its cases and mutants, and the plan).
  `shared/plan.ts` is held by the linear hierarchy's wave 7 worker (claim 5778); I asked for a co-edit of exactly two additive
  hunks by mail (the counted-groups list beside `WORK_GROUPS`, and `carriedOut` in `WorkPhaseView`), and they consented by mail
  on 2026-11-20: their own hunks are `MAP_CLASSES` in `isPlanKebab`'s set and types appended at the end of the file, none
  near mine, and whoever lands second merges `main` and keeps both. The same worker had asked on 2026-11-20 to edit two lines of
  `ledgers.css` (the sticky-foot rule, lines 487 and 488 at the first push); I consented, and I changed no line of that rule.
  Until the reply came, the work was proved in a scratch copy of the tree carrying the two hunks, and the same files were
  then compared with `cmp` against the real tree (identical).
- Every commit that changes the plan, and the head, carries `Ledger-Edit: D-8806` in its last paragraph, with the
  `Co-Authored-By` trailer.
- A process kill by command-line pattern was run once, in error, while stopping the harness server (`pkill -f`). It ended
  that shell, and the harness was down afterwards (measured: nothing on its port). The server was restarted, and stopped by
  its PID. I cannot tell whether a pattern match also reached another session's process with the same command line.
  Reported to the coordinator, who ruled: stop a process only by the PID I started or by my own process group. The exact
  command was `pkill -f "vite --config vite.config.mts"`, run at about 01:10Z on 2026-11-20 (the next command after it
  reads 01:11:11 on the box clock). Anyone missing a dev server started with that config file name around then may match it.

## 8. Carries

- WM4 builds the `unreadable` answer with `last` (departure `unreadable-carries-the-last-view`) and gives `runHref`,
  `itemHref` and `epicHref`, the last as `epicPath(slug, key)`. The card draws "Open the epic" only when `epicHref` answers
  a path for that epic.
- **Known, carried (review 2873 F15):** `STATUS_WORD`, `CHECKPOINT_KIND_WORD` and `UNREADABLE_WHY` are looked up with no
  fallback, so a status, kind or failure word from a newer server that this build does not know would draw "undefined".
  Inferred low risk: one build serves both sides. Not fixed here.
- **Ruled no change (F14):** a done-unverified reason is server text, and it can say "run N is not a work run of this
  programme"; the operator's tidying note covers the card's own labels beside the icon, not a sentence the server writes
  about a run. F16 (the screenshots are linked from this note and not from the spec) is left as it is.
- `Open in Linear` appears only where a `url` is present, as the plan says; today's plans bind none (inferred from
  the plan's relation section: the sync is the hierarchy's wave 3).
