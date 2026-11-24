# Wave 173: a coordinator waiting on its workers (desktop polish run 3611)

The task note for wave 173, written by its worker for the coordinator to fold into the ledger. The operator's goal of
2026-11-24: "done" is misleading for a coordinator whose children are still working; keep "done" for when the coordinator
and its workers are all doing nothing. This note describes the branch after fix round 2 (review 3651). Each claim says
whether it was **measured** (read on the tree or by a test this wave ran) or **inferred**.

## 1. The rule

`waitingOnWorkers` in `pwa/src/fleet/sessionFacts.ts` (L1, pure), beside the other list policy. A session reads
`waiting on workers` (`WAITING_ON_WORKERS`) when all four hold:

- its role is coordinator (`coordinatorRole`, the one reader of the role);
- its own bucket is `done` or `idle` (idle on purpose: done decays to idle after thirty minutes);
- it is not asleep;
- at least one of its worker rows is busy, which means one of:
  - a worker session whose row word (`rowStateWord`) is `working` and whose row does not read `with coordinator`
    (`sessionWorkerBusy`, over `rowWithCoordinator`, the same fact the worker's own row words take);
  - a spawn the board itself calls in flight (`workersWaitAt`, which asks `dispatchWindow`'s `in-flight` phase, with the
    board's own threshold). This is the one spelling of "is this spawn in flight" in the rule: fix round 2 removed
    `workerBusy`, a second spelling on a row that no production code called (review 3651 F4).

Every other row reads as before. The caller passes the bucket it paints, so the row and the header apply the rule to the
same state.

**A worker whose question its coordinator holds (review 3632 F2, the brief's item 6).** The server files such a worker
`working`, and its row reads `with coordinator · <coordinator>`. It is waiting on its coordinator, so it does not keep the
coordinator waiting, and the pair never read as waiting on each other. A worker asking the operator has the row word
`waiting`, which is not busy either. Measured: a done coordinator and an idle one holding a worker's question read done and
idle; beside a second worker that really is working, both read `waiting on workers`.

**A sleeping worker.** Its row word is `asleep`, not `working`, so it is never busy, and `rowWithCoordinator` answers no
held question for a gone pane, so its row never reads `with coordinator` either. Measured: a coordinator whose only worker
sleeps reads done, with or without that worker's question held by it. The hibernation census
(`server/test/hibernate-census.test.ts`) counts `rowWithCoordinator`'s gone-pane guard as a second presence reader in
`sessionFacts.ts`. Its row there now pins 2 hits, with the stances `consults` and `true-of-pane`, argued in the row
(coordinator's ruling: keep the guard, write the row).

**A stalled dispatch (review 3632 F1).** A dispatch past `SPAWN_STALL_MS` is the board's "dispatch never completed": it
needs a person, so it does not keep the coordinator waiting. Measured: the same dispatch one second inside the threshold
reads waiting, at the threshold and an hour later reads done, and a stalled dispatch beside a working worker still reads
waiting because of the worker.

**Which rows are its workers.** `workersOf` in `pwa/src/fleet/fleetTree.ts` reads the bracket's own edges over the whole
fleet and its open runs. It is handed what `nestFleet` is handed, `latestPerSession` (the bracket's input filter and the
one reader of "is this run's session on the list" outside `nestFleet`), and then applies the bracket's rules 1 and 5.
`latestPerSession` drops closed runs first (review 3651 F3): the list is handed the active runs and `workersOf` every
run, so without that a newer closed run naming the same unlisted session would hide an older spawn in flight that the card
still draws. Measured: run 100 planned a minute ago and run 101 closed, both naming an unlisted session; `workersOf`
returns the spawn of run 100, the coordinator reads `waiting on workers`, and the card draws run 100 as its pending row.

- an open run it claims whose bound worker (`workerOf`) the fleet carries is that worker, counted once;
- a run whose session is listed but bound to another run was dropped by the filter, so it is no worker and no spawn;
- a run in a dispatch window whose session is not listed is a spawn.

It reads a run's ids only through named readers (`latestPerSession`, `claimedRunsOf`, `workerOf`), never by an inline
match, as the PWA ring census and the W7 census require.

**A listed session bound to another run (review 3632 F3).** Read in `nestFleet` with the filter in front of it: the run
naming that session never reaches the bracket, so no pending row is drawn for it, and the session is drawn where its own
binding puts it (under the claimant of the run it is bound to). That reading is right: the session exists and is someone
else's worker, and a spawn row for it would be a phantom. Measured: `workersOf` returns no row, the coordinator reads done,
and the tree's card draws no pending row and draws that session at depth 1. The first fix commit (6e41898311) had made
such a run a spawn; this round restores the bracket's rule.

**Why fleet-wide and not the card's nested rows.** The session header has no card. Reading the fleet is the only way the
header and the row can decide from one input. A worker that renders on another card still keeps its coordinator waiting.

**The clock.** Only the in-flight versus stalled split needs a clock, so the store selectors stay clock-free and return one
primitive (`WorkerWait`, from `workersBusyOf`):

- `true`: a worker session is busy, which no clock changes;
- a number: the newest dispatch in a window began at that instant;
- `false`: neither.

The facts read it at their own `now` (`workersWaitAt`, which asks `dispatchWindow`). The row ticks every 30 s while it
holds a number, as it does while busy: with no new event, that tick is the only thing that turns the word back when a
spawn crosses the stall threshold, and a fake-timer case pins it (review 3651 F2). The session screen's facts and its
coordination line (`coordinationOf`, a worker's word for its coordinator) both read the screen's own clock (review 3651
F1). If the newest dispatch is stalled, every older one is too.

| Case | Word | Basis |
|---|---|---|
| coordinator done, one working worker | waiting on workers | Measured |
| coordinator done, one dispatch in flight | waiting on workers | Measured |
| coordinator done, one dispatch stalled | done | Measured |
| coordinator done, workers all done, idle, merged, asleep, exited, archived or asking | done | Measured |
| coordinator done or idle, holding a worker's question | done or idle | Measured |
| coordinator done or idle, holding a worker's question, a second worker working | waiting on workers | Measured |
| coordinator idle, one working worker | waiting on workers | Measured |
| coordinator working, asking, exited or archived, one working worker | its own word | Measured |
| coordinator asleep, one working worker | hibernated · … | Measured |
| a head that is not a coordinator, with a working child | done | Measured |
| a coordinator with no workers | done | Measured |
| a coordinator whose only run is closed, its session still working | done | Measured |
| a run the coordinator claims for itself | no worker | Measured |
| one worker bound by two of its open runs | one row | Measured |
| a session the run names, bound to another claimant's run | no worker, no spawn | Measured |
| a stamped dispatch whose session row exists | that session, never also a spawn | Measured |
| an unlisted session, an older dispatch in flight and a newer closed run naming it | waiting on workers, as the card draws the spawn | Measured |
| a worker's header, its coordinator's only wait a spawn in flight (the worker done, holding a held question, or asleep) | waiting on workers; the same spawn stalled reads done | Measured on the open screen |
| a worker's header, the worker holding a held question or asleep, nothing else running | done | Measured on the open screen |

## 2. The words

`WAITING_ON_WORKERS` and `WAITING_ON_WORKERS_TITLE` are defined once, in `sessionFacts.ts`. The bare `waiting` is
`STATE_WORD.attention`, a session blocked on the operator, so it is not reused. A scan in
`pwa/test/coordinator-waiting.test.tsx` reds if the literal is written in any other source file under `pwa/src`, `ui/src`
or `shared`, or twice in that one. The literal census's 25-character floor does not reach an 18-character phrase, so
this scan is its own guard. The lamp's story uses a stand-in label, so the words stay spelt once.

## 3. Every reader of the row's word

| Reader | What changed | Basis |
|---|---|---|
| The fleet row, `SessionLine.tsx`: its word (`SessionMeta`'s card cell reads `cardFacts`) and its lamp | Converted. The row reads `workersBusyOf` from the fleet store as one primitive, so a frame that changes no answer re-renders no row | Measured on the rendered row |
| The session header's status chip, `sessionHeaderView.ts` and `SessionHeader.tsx` | Converted. The rule runs over the bucket the strip paints (`headerBucket`: the fleet row's bucket whenever the row exists), with the workers the facts carry. The chip gains `waiting`, its lamp takes the words and its title is the words' title | Measured on the view and on the open screen (`coordinator-waiting-screen.test.tsx`) |
| `headerFacts`' status fact and `headerStatusWord` | Converted. The header says the card's word verbatim, with no age added. `cardWithinHeader` holds | Measured |
| A worker header's word for its coordinator, `coordinationOf`'s `coordinatorState` (`SessionDetails`) | Converted: `coordinationOf` takes the coordinator's `WorkerWait` and the screen's clock (optional for other callers; without it a spawn alone reads the bucket's word) | Measured on the function and on the open worker's screen |
| The lamp, `StatusDot` (`ui/src/primitives/status-dot.tsx`) | A `waitingLabel` prop. Only a done or idle dot reads it | Measured for both buckets |
| The worker summary line, `rollup.ts`'s `summaryParts` | Unchanged, rightly: it counts workers, not the coordinator | Measured (`2 workers · 1 working · 1 idle`) |
| The command palette, `command/sessionEntries.ts` | Unchanged, rightly: its entry words the role and project, never the state | Measured by reading it |
| `data-state` on the row, `stateTone` (the word's ink class) | Unchanged: both stay the bucket's word. No stylesheet rule reads `data-state` on `.sess-line`, and `sess-state--done` and `--idle` have no rule, so the word draws in the default ink as done did | Measured by grep of the stylesheets under `pwa/src` |
| The Instrument status groups (`statusGroups.ts`) | Unchanged: the group is the bucket (§5) | Measured by reading it |

**Both skins (review 3632 A9).** Refined places `SessionLine` through `ProjectCard` and Instrument through `FleetTable`.
`SessionLine` and `SessionMeta` read no skin, so the test's two skin iterations render `SessionLine` directly and run the
same code. Neither `ProjectCard` nor `FleetTable` is rendered by this wave's tests.

**The header's one divergence from the row (review 3632 A2).** The header paints the row's bucket except when a live stream
says dead: then it paints `dead`, so the header reads exited while the row may read `waiting on workers`. This is the
done-versus-exited shape that predates the wave. Before the fleet list loads, the header has no facts and the rule is off
there.

## 4. The lamp's look (item 4)

The lamp uses idle's matte tone (`dot--idle`, `--status-idle`). It has no glow and no pulse, it is not amber, and it adds
no colour and no contrast pair. Its glyph is U+25D4 `◔`, a circle with one quadrant filled, from the same Geometric Shapes
block as `◐`, `○` and `◌`. The tests rule out done's `✓`, idle's `○`, the asking lamp's `●` and the working lamp's `◐`.
Its spoken label is the app's words, passed as a prop, so the design system decides the look and never the words, and
`ui/src/index.ts` is untouched. The header strip keeps the `idle` tint done already had. The design catalogue has a
`WaitingOnWorkers` story beside `AllBuckets` (`status-dot.stories.tsx`), drawing a done and an idle dot with a label.

## 5. The measurement left alone (item 5)

The bucket, its timestamp, the unseen-finished badge, the sort, the status groups and the rollup are decided as before.
These places can sit beside the word without agreeing with it:

- **The card rollup.** A card is active when a live member is `working` or a spawn is pending, so a coordinator whose
  busy worker renders on its own card already sits on an active, open card. Only a busy worker drawn on **another** card
  can leave a coordinator's card rolled up as inactive while that coordinator reads `waiting on workers`. When a card is
  rolled up, its header stands for the card and the coordinator's row is not drawn, so the word does not show beside an
  inactive label. The smallest consistent choice is to leave the rollup alone, so nothing changed there.
- **A worker that coordinates workers of its own.** `nestFleet`'s rule 4 draws such a session at the top level, not under
  its coordinator, while `workersOf` still counts it as a worker. So a coordinator can read `waiting on workers` with no
  worker row bracketed under it, the same shape as the cross-card worker above. The run is real work for the coordinator
  in both cases, so the word stays.
- **The Instrument status groups.** A coordinator with open runs is drawn in its programme box (the Programmes group),
  not under Done. A coordinator outside a box would sit under Done and read `waiting on workers`. The group is the
  server's bucket by design (`statusGroups.ts`'s header), so it stays as it is.

## 6. The session screen

`pwa/src/screens/SessionScreen.tsx` was held by claim 6821 (desktop polish wave 168) when this wave began. On the
coordinator's ruling, its holder was sent a unified diff against main `01dce5c853` before the file was touched, and
answered yes: the four hunks apply to its branch at an offset of 5 lines and touch none of its three changes there. The
screen reads two clock-free answers from the fleet store with `workersBusyOf`, one for the open session and one for its
coordinator. It passes the first into the session facts, which read it at the screen's own clock, and the second into
`coordinationOf`. Fix round 1 changed the type those answers carry and not one line of the screen. Fix round 2 (review
3651 F1) moved the screen's clock (`factsNow`) above the `coordinationOf` call and passed it, under this wave's own claim
on the file, taken after its former holder's pull request merged. `coordinator-waiting-screen.test.tsx` opens a
coordinator and a worker on the real screen, with the worker done, holding a held question or asleep, beside a spawn in
flight, stalled or absent.

## 7. Known limits and what is unmeasured

- **A1 (review 3632), a nested coordinator.** A coordinator whose only busy worker is itself a coordinator with busy
  workers, and is done or idle itself, still reads done: `sessionWorkerBusy` reads the worker's own row word, not the rule.
- **A1 (review 3651), an older server.** A server that sends no run binding gives `workerOf` nothing, so the bracket drops
  every run of a listed session: a coordinator whose listed workers are really working reads done there. The tree brackets
  nothing either, so the surfaces agree with each other and not with the truth. It needs a version-skew window.
- **A2 (review 3651), the word's lag.** The row and the header tick every 30 s and the card's spawn row every second, so the
  word can turn back up to 30 s after the card shows the spawn stalled.
- **A4 (review 3651), a long stall's tick.** A stalled spawn keeps the row on its 30 s tick for as long as the run reads
  "dispatch never completed", possibly hours, because `workersBusyOf` returns the newest stamp whatever its age. The words
  stay right; the cost is the tick.
- **A4 (review 3632).** A screen reader hears `waiting on workers` twice on a row and in the header (the lamp's label and the word beside
  it), the same pattern as every other state, now a three-word phrase.
- **A5 (review 3632).** The words' explanation is a `title` on a span that takes no focus, so it does not show on touch or to a keyboard.
  That is the pattern of every state word.
- **A8 (review 3632).** The done-or-idle condition is written in `waitingOnWorkers` and again in `headerStatusWord`, a re-check of the same
  rule inside L1. The `StatusDot` copy is the design system's own, since `ui/` cannot import the app's policy.
- **The glyph.** U+25D4's coverage in the mono font stack on real devices is not measured. `◔` already ships in
  `accountWords.ts` and `◐` in the working lamp. On a device whose fallback fonts lack it, the lamp would draw a
  missing-glyph box, with the spoken label still right.
- **Pixel widths.** jsdom has no layout. The budget test asserts that the drawn word is no longer than the phone's name
  budget (`NAME_BUDGET`, 28 characters, measured at 360 px for the same column) and that the word sits on the meta line,
  outside the name's button. The real render at 360 px and at the desk widths was not checked in a browser, in either skin.
- **The selector's cost.** It is one pass over the runs for each coordinator row per store update, inferred small at about
  20 sessions.

## 8. Tests and guards

Red first. Before the build, the suite failed to load (`workersBusyOf is not a function`). Before fix round 1, the four
round cases went red on 6e41898311: the dispatch in flight then stalled, the done and the idle coordinator holding a
worker's question, and the listed session bound to another run. The lamp's idle case and the extra glyphs are guards, and
their mutants (M29 to M31 below) go red when cut. Before fix round 2, four of the round's cases went red on db70a2d0eb:
the closed-run case (F3) and the three worker-header cases with a spawn in flight (F1). The fake-timer tick (F2) and the
held-question and asleep worker-header cases with nothing else running are guards of behaviour that was already right:
the tick case goes red when its gate is cut (M26), and the other two pin the answer F1's fix must not change.

**Mutants, on the code as it stands at fix round 2's tip.** Each was bent in place by a script, the two test files run
through the supported runner, and the source restored from git. The table is renumbered from fix round 1's: its M7 guarded
`workerBusy`, which is gone. 39 mutants: 38 went red and one is equivalent.

- **The rule:** M1 idle dropped, M2 role ignored, M3 asleep ignored, M4 workers ignored.
- **The worker's busy state:**
  - sessions: M5 a held question counted, M6 any row word counted;
  - spawns: M7 a stalled spawn counted in `workersWaitAt`, M8 a spawn never counted there, M9 the facts ignoring the clock.
- **The words:** M10 the row word dropped, M11 the row title dropped, M12 the header word's idle arm dropped, M13 the header
  facts not passed the wait.
- **`workersOf` and its input:**
  - M14 the bracket filter dropped, M15 the spawn dropped, M16 the self-claim kept, M17 no dedupe, M18 closed runs kept in
    the bracket's input (F3);
  - M19, the binding ignored inside the loop, is **equivalent**: after `latestPerSession`, every listed run has already
    passed `workerOf`, and the filter drops closed runs, so the call in the loop and a plain lookup agree on every run that
    reaches it.
- **`workersBusyOf`:** M20 the role check dropped, M21 a busy session ignored, M22 the oldest spawn read instead of the
  newest.
- **`coordinationOf`:** M23 the clock ignored, M24 the word dropped.
- **The row:** M25 the store read dropped, M26 its tick's gate cut back to busy alone (F2), M27 the lamp label dropped.
- **The lamp:** M28 the glyph made the check, M29 the working half, M30 the asking dot, M31 the idle arm cut, M32 any bucket
  read, M33 the attention tone.
- **The header:** M34 the view's rule off, M35 the view's title dropped, M36 the header part's lamp label dropped.
- **The screen:** M37 the facts not given the workers, M38 the coordination not given the coordinator's workers, M39 the
  coordination not given the clock (F1).

**Fix round 1 took two pushes.** The first, at 52c30f2989, reddened one server census, the hibernation census. I had run
the rings, W7, single-definition, anchors and citations censuses before it, not every server test that reads `pwa/src`.
The second push carries the census row and the asleep-worker cases. Before it, every server test file that names a pwa
path (156 files, found by grep) ran through the supported runner.

**Fix round 2 is one push**, with code, tests and this note together. Before it, the server census family that reads pwa
files, the hibernation census included, and the markup and colour censuses ran through the supported runner.

**The whole pwa suite** ran once after the build: 24 files failed to load and no test failed. Two causes, both of the
environment: the test slice's memory cap killed workers (5 OOM kills), and some censuses import a scan helper from the
server package, whose dependencies were not installed in this workspace. After installing them, the 24 files re-ran
green (829 tests).
