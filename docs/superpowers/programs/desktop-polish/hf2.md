# Task HF2: the session panel's carried findings (D-8877)

Task note for the desktop-polish programme (plan `docs/superpowers/plans/2026-10-22-desktop-polish.md`, section HF2, which
defines D-8877 and names each departure by slug). The findings come from review 3123 (H3, #3153), review 2995 (C51) and review
2988 (H4), with the coordinator's two rulings on review 3123 (recorded call 98). Each claim is labelled **measured** (a command
or a real Chrome showed it) or **inferred** (reasoned, not shown).

## 1. Red first

A test commit (`test(pwa): red first …`) comes before the code. Each case was run against the code of `origin/main` (the test
commit's tree, whose sources are `main`'s) through `ccrc test`, one file per process (**measured**, load 10 to 13):

| Finding | Case | At `main` |
|---|---|---|
| 3123 F1 | `session-panel-sheds` HF2-1, HF2-2; `delegation-words` VIS-W1's pin of the table's words | green: the list's owner is new test code; the defect is the old list's, shown by the mutant `census-table-word-and-row` (§4), which the old census let live (review 3123, measured there) and the new one kills |
| 3123 F2 | `header-details-facts` HF2-4 | green: a guard (the code is right since H3), red under `meta-subagents-back` |
| 2995 F3 | `header-details-facts` HF2-5 | **red**: `headerMetaCells is not a function` |
| 3123 F3 | `session-panel-words`: the path on a line of its own below the desk, the row's full width, after the short words, broken after a `/` where it can | **red** at 360 and 390 in both skins (`path 0: on a line of its own`) |
| 3123 F4 | a `helpers-section` case (every `·` of line 2 after a no-break space) and the rails' "no separator starts a line" | **red** at `main`; dropped with the record fix (§3), not kept |
| 3123 F5, F7 | `session-panel-words`: the composer and its key hints inside the pane and the window | **red** in 14 of 20 views (every phone view, Instrument at 1280, 1600 and 1920) before the strips' change; added beside the code commit, run first against the code without that rule |
| 3123 F6 | `session-panel-words`: the two chips side by side | **red** at Instrument 1280, both themes |
| 3123 F10, F11 | `helpers-report-store` E and F | green: guards, red under `ask-forgotten-only-on-drop` and `reset-every-backlog` |
| 3123 F12 | `card-header-facts` HF2-H3; `session-panel-sheds` HF2-3 | green: guards, red under `meta-draws-helper-count` and `presence-capped-at-one` |
| 3123 F13 | `helpers-rail`: the 1600 rail with a state group wider than its line | green for the no-break half (the group took two lines and no word split); its "no separator starts a line" half was red and is dropped (§3) |
| 2995 F1 | `goals-door-height`: Instrument below 900, in equals out | green: a guard, red under `goals-key-16px-taller`, which the old bound let live (§4) |
| 2988 F6 | `archive-unowned`: the focus when the rows leave, in real Chrome | green: the code was right (jsdom asserted it); now held in real Chrome |
| 2988 F7 | `fleet-screen-frame` (new) | red under `selects-the-frame`, which is `main`'s selector (§4) |
| 2988 F8 | `archive-unowned`: the both-state foot row breaks between its halves | **red** at every width in both skins (`Archived on disk · 2 · 1.6 GB · Work no` / `session owns · 4`) |

## 2. What was built (measured by reading the diff, and by the cases above)

- **One list of the meta row's cells** (2995 F3): `headerMetaCells` (L1) names the cells in `SessionMeta`'s order;
  `SessionMeta`'s header mode draws exactly them and `headerMetaHasCells` asks it. HF2-5 renders every cell alone, every pair and
  all at once, and requires the drawn cells to be the list, in order.
- **The census's one owner** (3123 F1): `pwa/test/panelCensus.ts` writes §4.4's five words as literals and adds
  `LIVENESS_QUALIFIER`'s words and sentences; the jsdom census, the two real-Chrome censuses and `delegation-words` read it.
- **A worktree's path** (3123 F3): one inline box per piece (`pathBreaks` in `lib/format.ts`, cut after each `/`), so it breaks after a slash and
  inside a piece only when the piece is wider than the line; below 900 px it takes the row's full width after the short words.
  A first build drew a `<wbr>` after each slash instead: Chrome still broke at a hyphen inside the last piece
  (`…/agent-a1b2c3d4e5f6-a-` / `very-long-worktree-name`, **measured**), because a hyphen is a break the greedy line takes first.
- **The chips** (3123 F6): one box.
- **The strips give way** (3123 F5, F7): `.chat-strips` may shrink and scrolls when it must; the Helpers strip in it shrinks to
  no less than its head.
- **One count, one reset, one answer** (3123 F14): `presenceUnmeasured`; `resetsHelpers`; `drawnNow`.
- **The fleet screen** (2988 F7, F8): the unowned count selected as a number; the foot row's halves as boxes.
- **Comments** (3123 F8, F14): the `WorkWords` doc, `WorkLine`'s header, `SessionLine`'s two-line block, `fleet.css`'s
  two-line block and `.sess-meta` clip, and the strip's no-break separator (now saying what it does not do, §3).

## 3. Review 3123 F4: the record fix, and why (measured)

The brief let me pick "the smaller true fix". The code fix was tried first, measured in a real Chrome over the production build
in the 1600 px rail with `helpers-rail`'s wide fixture:

- a no-break space before every `·` of line 2, between its facts too: the rail still drew `subagent · general-purpose · Sonnet`
  / `· high ·` / `running · …` (**measured**);
- a word joiner (U+2060) before that no-break space: the same lines (**measured**).

Each fact and each word of a state group is an inline block, and Chrome breaks after any inline block whatever character
follows it (**inferred** from the two runs: both characters forbid a break before them in Unicode's line-breaking rules). The
code fix would move every separator into the box before it, and hide each separator that leads a part the width hides (the
tokens on a narrow section, the phone's elapsed): a restructuring of H2's line 2 and its pins, wider than this task. So the
slug says what holds (`separator-may-start-a-line`, amending D-8875's `narrow-section-two-lines-everywhere`), the strip's
comment says the no-break space does not stop it, and the two "no separator starts a line" checks this task added are dropped.
What still holds, and is measured in the rail now (F13): a state group wider than its line takes two lines and breaks only
between its words, never inside one.

## 4. Mutation run

`ccd/coordinator-skill/references/mutation-run.py`, through an adapter like H2's and H3's: each TypeScript or CSS file held as
a Python module's text (`SRC = r'''…'''`); each mutant written into a fresh scratch copy of `pwa`, `ui` and `shared` under
this session's temp root (outside the work tree, its `node_modules` linked to the work tree's), its kill files run there
through `ccrc test`, one process per file, `--maxWorkers=2`; `--no-coverage` (the runner's trace sees the adapter, not the
TypeScript); a run the slice's memory cap killed is run again, never counted (none was). The scratch trees are left to the
temp root's reaper. **Measured**, at load 9 to 15.

**Pass 1** (34 mutants on the code commit): 28 killed, 6 survived. `meta-hold-ignores-programme` was a missing case (HF2-6
added); `meta-draws-helper-count` lived because HF2-H3's session drew no details row at all, so its comparison never saw the
meta row (the case now gives the session a task tally and asks that the meta row is drawn); `meta-child-ignores-held-run` was
equivalent (a child-marker context is only ever a child with no held run, `contextFact`), so the clause was removed from the
code rather than kept unpinned; `presence-counts-unmeasured-word` and `path-wrap-break-word` are equivalent (below). The Goals
mutant was first written on the wrong element (`.chat-coord-goals`, which Instrument's Back-row key is not) and changed
nothing (the sixth survivor); it is written on the key (`.keycap--goals`) below.

**At the tip: 33 mutants, 31 killed, 2 equivalent** (pass 1's 34, less the removed clause's).

| Module | Mutant | What it does | Killed by |
|---|---|---|---|
| `sessionFacts.ts` | `meta-hold-ignores-programme` | a hold cell for a hold its run explains | HF2-6 |
| | `meta-no-spawn` | drops the spawn cell | "the last spawn" cell case, HF2-5 |
| | `meta-keeps-restart` | lists the restart marker | "a restart alone is no cell", HF2-5 |
| | `meta-subagents-back` | a session's subagents make a cell again (review 3123 F2's mutant) | HF2-4, both skins |
| | `meta-no-graph` | drops the graph cell | the graph cell case, HF2-5 |
| | `has-cells-always` | `headerMetaHasCells` always yes | the empty-header cases (11) |
| `SessionMeta.tsx` | `meta-draws-no-graph` | the row draws no graph cell though listed | HF2-5 |
| | `meta-draws-helper-count` | the header draws "2 helpers" from `session.subagents` (review 3123 F12's mutant) | HF2-H3 (pass 2) |
| `delegationWords.ts` | `census-table-word-and-row` | the table's `live` word changed **and** a row says "not confirmed" (review 3123 F1's mutant) | `session-worktrees` W5-U10; alone, `session-panel-sheds` (the census); `main`'s census file lets it live (measured) |
| | `table-live-word-changed` | the table's word alone | `delegation-words` VIS-W1 (the table's words are §4.4's) |
| | `presence-counts-unmeasured-word` | counts `=== 'unmeasured'` | **equivalent**: every caller passes leases through `readDelegation`, which files any word but `present` as `unmeasured` |
| | `presence-capped-at-one` | the count capped at 1 (review 3123 F12's mutant) | HF2-3 |
| | `door-halves-swapped` | the foot row's halves swapped | `fleet-screen` "both" |
| | `archive-presence-unowned-only` | the Archive counts unowned trees only | `archive-unowned-work`'s head count |
| `lib/format.ts` | `path-unbroken` | the path as one piece | W5-U10 (jsdom); `session-panel-words` breaks (real Chrome, through `seg-not-a-box`). Run first in `delegationWords.ts`, and again by hand after the move in fix round 1: W5-U10 red (measured) |
| `WorkLine.tsx` | `seg-not-a-box` | the pieces lose their class | W5-U10 |
| `chat.css` | `path-own-line-dropped` | no own line below the desk | `session-panel-words` (own line, full width) |
| | `path-not-last` | own line, but where the DOM puts it | `session-panel-words` (after the short words) |
| | `chips-not-one-box` | the chip box is `display: contents` | `session-panel-words` (Instrument 1280) |
| | `seg-inline` | the pieces are inline | `session-panel-words` (a break at a hyphen inside a piece) |
| | `path-wrap-break-word` | `overflow-wrap: break-word` for `anywhere` | **equivalent** in every measured view: the section's `min-width: 0` and the pieces' `max-width: 100%` leave no box sized by the path's min-content (the difference between the two values); the same mutant survived H3's real Chrome (review 3123 F13) |
| | `strips-no-shrink` | the strips keep `flex: none` | `session-panel-words` (composer inside the pane, 14 views) |
| | `helpers-no-floor` | the Helpers strip may shrink past its head | `session-panel-words` (a short phone keeps the head) |
| | `strips-no-scroll` | the strips' container does not scroll | `session-panel-words` (a short phone: the strip lies over the composer) |
| | `goals-key-16px-taller` | Instrument's Back-row Goals key 60 px tall (review 2995 F1's mutant) | `goals-door-height` at 360 and 390: 12 wrong entries a view; `main`'s file flags 8, missing the 4 its frozen-door bound let through (measured) |
| `stores/session.ts` | `reset-every-backlog` | any backlog resets the helpers | the reducer's same-transcript case, F |
| | `asks-kept-on-reset` | a reset keeps the asks | D, F |
| | `ask-forgotten-only-on-drop` | an answer forgets its ask only when dropped on arrival (review 3123 F10's mutant) | E |
| | `asks-reset-every-backlog` | any backlog forgets the asks (review 3123 F11's mutant) | F |
| `SessionDetails.tsx` | `drawn-shown-only` | the drawn answer ignores the door and the width | H3-5 |
| `FleetScreen.tsx` | `selects-the-frame` | `main`'s selector: the whole frame, the count computed in render | `fleet-screen-frame` |
| | `halves-not-boxes` | the halves as plain spans | `archive-unowned` (the foot row breaks inside a half) |
| | `halves-plain-separator` | a plain space before the halves' `·` | `fleet-screen` "both" |

## 5. Runs

One test file per process through `ccrc test`, `--maxWorkers=2`, the load recorded beside each (**measured**). The fleet test
slice's memory cap (6 GB, shared with other sessions) killed a worker now and then; such a file was run again alone and is
named below, and no other file needed a second run.

| Run | Files | Result | Load |
|---|---|---|---|
| PWA jsdom, every test that imports or reads a changed module or stylesheet (`delegationWords`, `WorkLine`, `SessionWorktrees`, `SessionDetails`, `sessionFacts`, `SessionMeta`, `SessionLine`, the session store, `FleetScreen`, `SessionScreen`, the header, the inspector, `@ccrc/ui`, `chat.css`, `fleet.css`), every words scan, `markup-census`, the design-system and ui-package boundary files, the theme and contrast gates | 287 | **287 green**, 8,404 cases; `fleet-screen` and `w7-presence-table` re-run alone after the memory cap killed their workers (121 and 60 green) | 8.7 to 15.1 |
| PWA jsdom again, after the last edits to `chat.css`, `sessionFacts.ts` and the tests: every file that reads `chat.css` or the strip, and the five changed case files | 48 | **48 green**, 2,336 cases | 10.2 to 14.2 |
| Real Chrome, every file that measures the session panel, its header or the Archive: `archive-unowned` (60), `helpers-rail` (4), `delegation-rows` (72), `session-panel-words` (22), `role-fact` (66), `session-header` (76), `lanes-row` (89), `chat-width` (46), `inspector-hide` (8), `session-timers` (17), `goals-door-height` (30), `build-behind` (12), `instrument-desk` (33), `row-fit` (133), `archive-claims-sheet` (32) | 15 | **15 green**, 700 cases. `delegation-rows` was red first in 10 cases, both from this change, fixed in its test (the commit `test(pwa): delegation-rows reads a path …`): a positive control that a path on its own line left with nothing to count, and Refined's phone rail, left scrolled sideways by the tap on the door when a chip is wider than it, on `main` too (the picture of `main` shows its controls cut at the left), so the paths are read at the rail's start. `build-behind`, `instrument-desk` and `row-fit` were killed by the memory cap with no verdict and run again alone; `helpers-rail`'s first 1600 case and one `archive-unowned` focus view each timed out at 20 s once beside the mutation run and were green alone | 8.9 to 13.7 |
| Compile and build | `pwa`'s production build (its own `tsc --noEmit` over the app and its tests, then `vite build`); `ui`'s `tsc --noEmit` | both exit 0; a standalone `pwa` `tsc` was killed by the memory cap, so the build's is the check | 11.0 |
| Server guards | the 43 `single-definition` files, `growth-caps`, `growth-check` (`GROWTH_CHECK=1`), `topology-clean`, `deviation-refs` (after `git fetch origin main`), `dtbd`, `ci-ledger-guard` | **49 green**, 1,812 cases (`growth-check` measured its rows, 97; `deviation-refs` 34 after the fetch); and the ledger guard as CI runs it, against `origin/main`: passed by the head commit's `Ledger-Edit` trailer, layout ok | 9.3 to 14.8 |

### Fix round 1: CI's fast run at the first tip

The pull request's fast run at the first tip was red in one server test (**measured**): `delegation-wave3.integration`'s closed
scope census, which allows the words module's name only in a listed set of PWA files, found `WorkLine.tsx` importing
`pathBreaks` from `./delegationWords`. The server guards run above did not include that file, so the suite line of the
wave-done says red. `pathBreaks` moved to `pwa/src/lib/format.ts`, the pure formatters' leaf, which imports nothing; the
census's list is unchanged. Re-run through `ccrc test`, one file per process (**measured**):

| Run | Result | Load |
|---|---|---|
| `delegation-wave3.integration` (the census alone, then the whole file), `fleet-health`, `growth-caps`, `growth-check` (`GROWTH_CHECK=1`), `rings/pwa-rings`, `rings/totality` | all green: 36, 57, 12, 97, 10 and 11 cases | 9.5 to 16.9 |
| PWA jsdom, every file that imports the words module, `WorkLine` or `lib/format`: `session-worktrees`, `session-details-worktrees`, `delegation-words`, `screens-back-edges`, `archive-unowned-work`, `transcript-work-card`, `session-panel-sheds`, `fleetTree`, `settings-screen` | 9 green, 397 cases | 10.5 to 10.6 |
| Real Chrome `session-panel-words` | 22 green | 11.3 |
| `pwa`'s production build | exit 0 on the second run; the first was killed by the slice's memory cap | 10.6 |
| The mutant `path-unbroken`, at `lib/format.ts` | killed by W5-U10 | 10.6 |

## 6. The matrix

### The session panel (`session-panel-words`, every door open)

| Skin, theme | 360 | 390 | 1280 | 1600 | 1920 |
|---|---|---|---|---|---|
| Refined, dark | [F3, F5 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-phosphor-360.png) | [F3, F5 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-phosphor-390.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-phosphor-1280.png) | [F4 / F4 (recorded)](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-phosphor-1600.png) | [F4 / F4 (recorded)](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-phosphor-1920.png) |
| Refined, light | [F3, F5 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-light-360.png) | [F3, F5 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-light-390.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-light-1280.png) | [F4 / F4 (recorded)](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-light-1600.png) | [F4 / F4 (recorded)](../../../design/2026-11-19-session-helpers-design/hf2/panel-refined-light-1920.png) |
| Instrument, dark | [F3, F5 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-phosphor-360.png) | [F3, F5 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-phosphor-390.png) | [F6, F7 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-phosphor-1280.png) | [F7 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-phosphor-1600.png) | [F7 (1 px) / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-phosphor-1920.png) |
| Instrument, light | [F3, F5 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-light-360.png) | [F3, F5 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-light-390.png) | [F6, F7 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-light-1280.png) | [F7 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-light-1600.png) | [F7 (1 px) / ✓](../../../design/2026-11-19-session-helpers-design/hf2/panel-instrument-light-1920.png) |

### The Archive section (`archive-unowned`)

| Skin, theme | 360 | 390 | 1280 | 1600 | 1920 |
|---|---|---|---|---|---|
| Refined, dark | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-phosphor-360.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-phosphor-390.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-phosphor-1280.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-phosphor-1600.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-phosphor-1920.png) |
| Refined, light | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-light-360.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-light-390.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-light-1280.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-light-1600.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-refined-light-1920.png) |
| Instrument, dark | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-phosphor-360.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-phosphor-390.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-phosphor-1280.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-phosphor-1600.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-phosphor-1920.png) |
| Instrument, light | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-light-360.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-light-390.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-light-1280.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-light-1600.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/archive-instrument-light-1920.png) |

### The fleet foot's both-state row (`archive-unowned`, dark)

| Skin | 360 | 390 | 1280 | 1600 | 1920 |
|---|---|---|---|---|---|
| Refined | [F8 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-refined-360.png) | [F8 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-refined-390.png) | [F8 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-refined-1280.png) | [F8 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-refined-1600.png) | [F8 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-refined-1920.png) |
| Instrument | [F8 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-instrument-360.png) | [F8 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-instrument-390.png) | [F8 / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-instrument-1280.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-instrument-1600.png) | [✓ / ✓](../../../design/2026-11-19-session-helpers-design/hf2/foot-instrument-1920.png) |

Each cell links one picture, `origin/main` on the left and this branch on the right, taken by the file named with `CCRC_SHOTS`
set, over the same fixture, before its assertions; the 1280, 1600 and 1920 pairs are halved in size. A cell reads "before /
after": ✓, or the finding the side shows (review 3123's F3 to F7, review 2988's F8).

What each ✓ stands for, and how it was taken:

- **No horizontal page scroll, no page error, each moved readout once, 44 px targets under coarse emulation (the details door,
  the Helpers head), the path drawn whole and starting on the screen**: the files' own assertions, green on this branch in all
  20 panel views and all 20 Archive views (**measured**); `origin/main` passes the same checks except the ones this task added.
- **This task's claims**: below 900 px each path on a line of its own, the row's full width, after the short words; every path
  broken only after a `/` where it can; the two chips side by side; the composer and its key hints inside the pane and the
  window; the foot row broken between its halves (**measured**, the assertions of §1, green on this branch, red at `main` as
  the before side of each cell names).
- **The identity core present, no clipped or overlapping text, nothing moved that the task did not intend**: every pair was
  looked at, by a fresh Opus subagent against a per-cell list (all 50, after side ok, none worse than before) and by me for
  the panel at Refined 360 and Instrument 1280 (**measured** by looking; the wide pairs are halved, so their smallest words
  are read by position rather than letter by letter).

Seen in the pictures and left as they are (**measured** by looking): at 390 px the after pictures show the Helpers list
scrolled to its end, its first row's title under the head (the case opens the finished fold, at the list's foot, and the strip
is shorter now that the strips give way; **inferred** as the click's scroll, not a default state); the Archive's own paths
break at hyphens at 360 and 390, before and after (its rows are H4's, not the session panel's worktree rows F3 named); in
Refined at 1600 and 1920 the rail's lower sections run off its foot and scroll, before and after; the Refined 1280 rail's
"Runs · –" wraps beside the picker, before and after.

## 7. Records corrected

- `h3.md` §6: each bullet labelled (3123 F9); §5's matrix: the cells the review found a defect in name it (F3 to F7), with a
  dated paragraph under the table (**record**).
- `c51.md`: the F9 row and the heights heading say which fixture each screenshot shows (2995 F5); the "Open for the operator"
  figure is scoped to a main-checkout coordinator, with a workspace coordinator's 21.5 px beside it (2995 F4), both measured by
  review 2995 (**record**).
- The broker spec's H3 amendment says the liveness words are drawn nowhere in the PWA, and that they are still read (3123 F9)
  (**record**).
- The plan's Task C51 section keeps its figures and its picture sentence; the HF2 section says they are corrected in c51.md,
  because the plan file is HF1's claim and this task's consent covers its own section only (**record**: HF1's yes, 2026-11-21).

## 8. Left as it is

- 3123's ruling (2): the session screen's routing toast says "the pane has not confirmed it yet" about the operator's own act;
  outside §4.4 (call 98), so the census does not read toasts (**record**).
- `readDelegation`'s tidying and `LIVENESS_QUALIFIER` stay (call 98) (**record**).
