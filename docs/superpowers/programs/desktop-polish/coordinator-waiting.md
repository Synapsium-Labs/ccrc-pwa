# Wave 173: a coordinator waiting on its workers (desktop polish run 3611)

The task note for wave 173, written by its worker for the coordinator to fold into the ledger. The operator's goal of
2026-11-24: "done" is misleading for a coordinator whose children are still working; keep "done" for when the coordinator
and its workers are all doing nothing. Each claim says whether it was **measured** (read on the tree or by a test this
wave ran) or **inferred**.

## 1. The rule

`waitingOnWorkers` in `pwa/src/fleet/sessionFacts.ts` (L1, pure), beside the other list policy:

- the session's role is coordinator (`coordinatorRole`, the one reader of the role);
- its own bucket is `done` or `idle` (idle on purpose: done decays to idle after thirty minutes);
- it is not asleep;
- at least one of its worker rows is busy (`workerBusy`): a spawn still coming up, or a session whose row word
  (`rowStateWord`) is `working`.

Then it reads `waiting on workers` (`WAITING_ON_WORKERS`). Every other row reads as before. The caller passes the bucket it
paints, so the row and the header apply the rule to the same state.

The worker rows are `workersOf` in `pwa/src/fleet/fleetTree.ts`: the bracket's own edges (`nestFleet`'s rules 1 and 5),
read over the whole fleet and its open runs. Each open run the session claims whose bound worker (`workerOf`) the fleet
carries counts once per worker. Each dispatch in flight whose session the fleet does not carry yet counts as a spawn.
`workersBusyOf` answers the one boolean both surfaces read. It answers `false` at once for a row that is not a coordinator.

**Why fleet-wide and not the card's nested rows:** the session header has no card. Reading the fleet is the only way the
header and the row can decide from one input. A worker that renders on another card still keeps its coordinator waiting.

**Item 6:** a worker blocked on the operator's question has the row word `waiting`, which is not busy, so it does not
change the coordinator's word. A worker whose question the coordinator holds is filed `working` by the server, so it
counts as busy. Measured: the table case `a coordinator done whose workers are all asking the operator reads done`.

| Case (the brief's table) | Word | Basis |
|---|---|---|
| coordinator done, one working worker | waiting on workers | Measured |
| coordinator done, one spawning worker | waiting on workers | Measured |
| coordinator done, workers all done, idle, merged, asleep, exited, archived or asking | done | Measured |
| coordinator idle, one working worker | waiting on workers | Measured |
| coordinator working, asking, exited or archived, one working worker | its own word | Measured |
| coordinator asleep, one working worker | hibernated · … | Measured |
| a head that is not a coordinator, with a working child | done | Measured |
| a coordinator with no workers | done | Measured |
| a coordinator whose only run is closed, its session still working | done | Measured |

The edges `workersOf` shares with the bracket are pinned too: a run the coordinator claims for itself names no worker, a
worker two open runs bind (its open run and its newest) is one row, a session whose binding names another claimant's run
is no worker (`workerOf`, #746), and a dispatch whose session row already exists is that session, never a spawn as well.
Each guard was deleted in turn and the suite went red (§8).

## 2. The words

`WAITING_ON_WORKERS` and `WAITING_ON_WORKERS_TITLE` are defined once, in `sessionFacts.ts`. The bare `waiting` is
`STATE_WORD.attention`, a session blocked on the operator, so it is not reused. A scan in
`pwa/test/coordinator-waiting.test.tsx` reds if the literal is written in any other source file under `pwa/src`, `ui/src`
or `shared`, or twice in that one. The literal census's 25-character floor does not reach an 18-character phrase, so
this scan is its own guard.

## 3. Every reader of the row's word

| Reader | What changed | Basis |
|---|---|---|
| The fleet row, `SessionLine.tsx`: its word (`SessionMeta`'s card cell reads `cardFacts`) and its lamp | Converted. The row reads `workersBusyOf` from the fleet store as a boolean selector, so a frame that changes no answer re-renders no row. Both skins draw this component: Refined through `ProjectCard`, Instrument through `FleetTable` | Measured: rendered under each skin, the word, its title and the lamp's label read, the word outside the name's button. The desk and phone forms differ only in CSS, which jsdom does not lay out (§7) |
| The session header's status chip, `sessionHeaderView.ts` and `SessionHeader.tsx` | Converted. The rule runs over the bucket the strip paints, with the workers the facts carry. The chip gains `waiting`, its lamp takes the words and its title is the words' title | Measured on the view. Live only once the screen passes the workers in (§6) |
| `headerFacts`' status fact and `headerStatusWord` | Converted. The header says the card's word verbatim, with no age added. `cardWithinHeader` holds | Measured |
| A worker header's word for its coordinator, `coordinationOf`'s `coordinatorState` (`SessionDetails`) | Converted: `coordinationOf` takes `parentWorkersBusy` | Measured on the function. The screen's wiring is §6 |
| The lamp, `StatusDot` (`ui/src/primitives/status-dot.tsx`) | A `waitingLabel` prop. Only a done or idle dot reads it | Measured |
| The worker summary line, `rollup.ts`'s `summaryParts` | Unchanged, rightly: it counts workers, not the coordinator | Measured (`2 workers · 1 working · 1 idle`) |
| The command palette, `command/sessionEntries.ts` | Unchanged, rightly: its entry words the role and project, never the state | Measured by reading it |
| `data-state` on the row, `stateTone` (the word's ink class) | Unchanged: both stay the bucket's word. No stylesheet rule reads `data-state` on `.sess-line`, and `sess-state--done` and `--idle` have no rule, so the word draws in the default ink as done did | Measured by grep of `pwa/src/**/*.css` |
| The Instrument status groups (`statusGroups.ts`) | Unchanged: the group is the bucket (§5) | Measured by reading it |

## 4. The lamp's look (item 4)

The lamp uses idle's matte tone (`dot--idle`, `--status-idle`). It has no glow and no pulse, it is not amber, and it adds
no colour and no contrast pair. Its glyph is U+25D4 `◔`, a circle with one quadrant filled, from the same Geometric
Shapes block as `◐`, `○` and `◌`. It is neither done's `✓` nor idle's empty ring. Its spoken label is the app's words,
passed as a prop, so the design system decides the look and never the words. This keeps `ui/src/index.ts` untouched,
because `StatusDotProps` is already exported. The header strip keeps the `idle` tint done already had. The `◔` glyph's
coverage in the mono font stack on every platform is **not measured**. `◐` from the same block already draws there, so
coverage is inferred.

## 5. The measurement left alone (item 5)

The bucket, its timestamp, the unseen-finished badge, the sort, the status groups and the rollup are decided as before.
One place could contradict the word:

- **The card rollup.** A card is active when a live member is `working` or a spawn is pending, so a coordinator whose
  busy worker renders on its own card already sits on an active, open card. Only a busy worker drawn on **another** card
  can leave a coordinator's card rolled up as inactive while that coordinator reads `waiting on workers`. When a card is
  rolled up, its header stands for the card and the coordinator's row is not drawn, so the word does not show beside an
  inactive label. The smallest consistent choice is to leave the rollup alone, so nothing changed there.
- **A worker that coordinates workers of its own.** `nestFleet`'s rule 4 draws such a session at the top level, not under
  its coordinator, while `workersOf` still counts it as a worker. So a coordinator can read `waiting on workers` with no
  worker row bracketed under it, the same shape as the cross-card worker above. The run is real work for the coordinator
  in both cases, so the word stays, and nothing else changed.
- **The Instrument status groups.** A coordinator with open runs is drawn in its programme box (the Programmes group),
  not under Done. A coordinator outside a box would sit under Done and read `waiting on workers`. The group is the
  server's bucket by design (`statusGroups.ts`'s header), so it stays as it is.

## 6. The session screen: held

`pwa/src/screens/SessionScreen.tsx` was held by claim 6821 when this wave began. On the coordinator's ruling, a diff
packet went to its holder, and the file stays untouched until the holder answers. Without that edit, the screen passes
no `workersBusy` into the session facts and no `parentWorkersBusy` into `coordinationOf`. The header would then read the
bucket's word, as before. The PR states whether the edit landed.

## 7. Unmeasured

- Pixel widths. jsdom has no layout. The budget test asserts that the drawn word is no longer than the phone's name budget
  (`NAME_BUDGET`, 28 characters, measured at 360 px for the same column) and that the word sits on the meta line, outside
  the name's button. The real render at 360 px and at the desk widths was not checked in a browser, in either skin.
- The cost of the row's selector on a large fleet. It is one pass over the runs for each coordinator row per store
  update, inferred small at about 20 sessions.

## 8. Tests and guards

`pwa/test/coordinator-waiting.test.tsx`, red first: the suite failed to load (`workersBusyOf is not a function`) before the
build. Each guard was then deleted or bent in place, the file run and the source restored from git. Every one of the 20
mutants went red: the idle bucket, the role, asleep, a spawn as busy, the row word, the header word, a spawn as a worker,
closed runs, the worker header's word, the row's store read, the row's lamp, the glyph, the lamp's buckets, its tone, the
view's rule, the view's title, the self-claim, the dedupe, the spawn yielding to its session, and the binding.

The whole pwa suite ran once after the build: 24 files failed to load and no test failed. Two causes, both of the
environment: the test slice's memory cap killed workers (5 OOM kills), and some censuses import a scan helper from the
server package, whose dependencies were not installed in this workspace. After installing them, the 24 files re-ran
green (829 tests).

