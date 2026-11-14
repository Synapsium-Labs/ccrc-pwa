# Overlord W1 face, lane B: departures from the plan

Lane B (Tasks 5 to 11) of [`w1-face.md`](../w1-face.md), built in one pull request. The plan's own "Deviations found" list
stands as written. This note records what the build found or decided that the plan did not say, for the programme to fold
into its ledger. Each entry is a plain slug. None carries a number: the programme mints them.

## The mood (Task 5)

- **offline-open-link-row, a test row** — the Offline rule stays the plan's: `conn !== 'open' && linkLost`, or `agentDown`.
  The store never holds an open link with `linkLost` set, but the decider is pure, so a row pins that an open link with a
  stale `linkLost` is not Offline. That row is what fails when the `conn` clause is dropped. The rule is not reduced to
  `linkLost` alone.
- **mood-fallback-names-its-cause, review carry R3-2 (review 1898)** — when no rule matches, `moodOf` answers `MOOD_FALLBACK` with a
  cause that names the readers it has not heard yet ("not heard yet: the runs, the accounts"). The cause is never empty.
  `fallbackCause` is exported and has one test case per unheard reader. The accounts are named only while the read has not
  landed (`calm-moods-gate-on-the-accounts-read`); lanes not served to this reader are never named as unheard.
- **worker-quiet-at-shared, one reader** — the Confused window's edge needs the instant a run's worker turns quiet.
  `pwa/src/fleet/runWords.ts#workerQuietAt` answers that instant. `workerSeenNote` now reads its `quiet` through it,
  unchanged, and the decider's `next` uses it too, so neither re-derives quiet from `workerLastSeen`.
- **measured-order-pinned, a guard** — `MEASURED` is exported, and a test pins its order to `MOOD_RULES`' ranks 1 to 12.
  Swapping two rows in either place goes red.
- **lane-word-from-wire, method** — Dizzy reads a lane's `rate-limited` word from `LaneWire.state.word`. The server has
  already run `stateWordFor` into the wire, and the face does not hold the usage figures `stateWordFor` needs.
- **angry-live-means-not-dead-archived-cleanup, reading** — "any live session" is a session whose bucket is not `dead`,
  `archived` or `cleanup`. The set is typed against `SessionBucket`.
- **calm-moods-gate-on-the-accounts-read, review fix F2** — the plan's "null before the first accounts read" made Happy and
  Sleeping wait on `lanes !== null`, but `GET /api/accounts` sends no `lanes` to an unarmed box or a signed-out reader, so a
  calm fleet there was Neutral forever with a false "not heard" cause. `MoodFacts.lanes` is now `LanesRead`, one field of
  three values (`unread`, `not-served`, `served`), built by `lanesRead(accountsHeard, lanes)`; a flag beside a nullable
  `lanes` would let "heard, with lanes" be written as "not heard". The store gains `accountsHeard`, written only by
  `landAccounts` once an answer carrying a roster lands. Only `unread` holds the calm moods back; `not-served` only switches
  Dizzy's lane arm off.
- **a-death-dates-from-last-end, review fix F3** — the plan dated a death from `bucketSince`, which is null on every dead
  row the server files (`statusUpdatedAt` is set only in the live-pane arm), so the arm never fired. A death is now a `dead`
  row, neither hibernated nor stopped, with a `recentLastEnd` (the registry's record of the process end, written by the
  supervisor's `gone` exit) of a death cause (`oom`, `tmux-server`, `exited`, `unknown`; a swap or a limit restart is not
  one, typed per cause so a new `RestartCause` must be placed). Fixtures are built from `sessionBucket`'s own output. A
  stale `lastEnd` on a row that later died unrecorded would date its death early; that only shortens the cry.
- **heard-is-one-fleet-hook, review fix F10** — `useHeard` moved from `ledgers/WaitingRoutes.tsx` to `fleet/useHeard.ts`.
  The Waiting routes, the programme's Goals page and `useMood` all read it, and a test scans `face/` and `ledgers/` for a
  second reader of the frame-seen flags.
- **offline-names-the-link-that-is-down, review nit N2** — Offline has two causes: the console's own link to the server
  (`MOOD_RULES.offline`) and the server's link to the fleet's agent (`OFFLINE_AGENT_CAUSE`). `moodOf` picks by the arm that
  matched, the console's winning when both do.
- **future-stamps-count-as-now-within-a-minute, review nit N3** — a stamp up to `FUTURE_SKEW_MS` (a minute, as
  `recentLastEnd` allows) ahead of the clock counts as now, and its window and edge run from now. A stamp further ahead is
  not trusted and opens no window. A plain "counts as now" would hold Happy for the stamp's lead plus the window, since each
  render clamps afresh; the cut-off is what bounds it.
- **crying-window-strict, value** — every window is `now - at < window`, so the edge instant itself is outside it.

## The character choice (Tasks 6 and 7)

- **face-migration-67, slot** — the coordinator reserved migration 66 for the start report (#2740), so the face's table
  is migration 67 (`user_version 66 -> 67`), taken once #2740 is on this branch. The schema version's pins move with it.
- **coord-db-version-pins-edited, the schema version's pins** — `coord-db.test.ts` hard-codes the schema version, and
  those pins moved from 66 to 67 with the migration.
- **character-choice-request-order, ordering** — the device copy numbers every request it sends: the boot read and each
  write. An answer updates the value the server last confirmed only when it is newer than the answer that last set it, and
  the display follows the newest write still pending. So a late boot read cannot overwrite a newer choice, and a refused
  write puts back what the server last confirmed, not something older.
- **radio-arrows-shared, consolidation** — `ThemeGrid`'s arrow-key handling moved to `radioArrows`
  (`pwa/src/screens/AppearanceRow.tsx`). The theme grid and the character choice both use it, and the theme grid behaves
  as before.
- **character-cards-own-classes, markup** — the two character cards use `settings-character*` classes. They share the
  palette cards' rules by an added selector, so the theme grid's card count is unchanged.
- **command-registry-rank-table-filters-new-id, test** — `switch-character` is filtered out of the command registry's
  ordering table, as the other commands added later are, and its own rank row is pinned.

## The face in the bar (Task 8)

- **instrument-face-after-the-doors-nav, placement (accepted by the coordinator)** — in Instrument the face comes after the doors nav, not inside the
  home door with the wordmark. A button's children are presentational, so inside the door the face's name (the mood and
  its cause) never reached assistive tech, and a tap on the face went home. The nav holds doors only
  (`instrument-shell.test.tsx`). In Refined's two bars the face sits straight after the wordmark, as planned. Moving it
  against the wordmark in Instrument would mean taking the wordmark out of the home door, or relaxing the nav's
  doors-only guard. **For the coordinator.**
- **fleet-head-wears-the-face, placement** — Instrument has no phone head of its own (its skin set's `Head` is null), so
  on a phone it shows the shared `pwa/src/fleet/FleetHead.tsx`, which writes its own wordmark. That is a fourth top bar the
  plan did not list. The face sits straight after that wordmark too, so every top bar wears it.
- **face-mark-class-and-css, layout** — a `face-mark` class with layout-only rules (`flex: none`, margins) keeps the face
  in place in each bar: Instrument's top bar, Refined's two bars and the shared phone head (`.fleet-head`, which Instrument's
  phone mounts; first missed, found in review 1992 F1). In that head the wordmark keeps one line (`flex: none`, no wrap) and
  the face is a centred 32 px cell beside it; at 390 the row has about 12 px to spare, so the right group wraps to a second
  row, as it does at 360. A browser row in `refined-phone.browser.test.ts` measures the head at 390 and 360 in both palettes.
  There is no animation, filter or shadow, and the still frame is lane A's `.chr[data-still]` rules.
- **every-change-plays, accessibility** — each change of mood plays for 5 s, including a return to a mood that had
  settled. The first mood plays on mount.
- **browser-test-svg-child, a test** — `update-indicator.browser.test.ts` read `className.split` on every child of the
  Refined bar. The face is an SVG, so the test now reads the `class` attribute. Its assertions on the HTML children are
  unchanged.
- **bar-one-line-check-reads-centres, a test** — `instrument-bar.browser.test.ts`'s one-line check compared the tops of
  the bar's children. The 32 px face is centred in the 44 px line, so its top sits lower. The check still compares the tops
  of every child but the face, and compares every child's centre, face included; the face's height is bounded by the line.
  A wrapped bar still fails it by a whole row, and a door that grows taller around the same centre fails the tops.
- **face-play-rate-later, a follow-up** — each change of mood plays 5 s, as the plan says. A fleet whose mood flips every
  few seconds would therefore move almost all the time. The coordinator kept the plan as written: a cap on how often the
  face plays (for example, one play a minute) is a possible follow-up for the operator, not built here.

## The splash (Task 9)

- **ui-exports-reduced-motion-hook, export** — `@ccrc/ui` now exports `usePrefersReducedMotion`, which the splash reads.
- **splash-css-registered-in-contrast-sheets, gate** — `contrast.test.ts`'s closed `APP_SHEETS` list gains
  `src/face/splash.css`.
- **splash-words-grounded-on-page, gate** — the splash's two lines each carry `background: var(--bg-page)`, as the other
  listed sheets ground their ink, so the contrast gate measures them on the page.
- **splash-on-toast-layer, layering** — the splash sits at `var(--z-toast)`: above the shell, the sheets and the drawer,
  and below the block screen. It takes no pointer events.
- **splash-latch-is-state, method** — once the splash has gone it stays gone. The latch is React state, closed by an
  effect, and no render reads the clock. A test fails when the latch is removed.

## The badge (Task 10)

- **same-count-leaves-wording, review carry N1 (review 1898)** — the row is named for what it pins: a count equal to the last one
  written leaves the badge as it is, for 0 and for 3. A separate row pins that the first 0 heard clears the badge, so
  "not heard yet" (null) and "nothing waits" (0) stay two different answers.
- **last-set-to-zero-on-clear, value** — a clear records 0 as the last count written, so a following 0 leaves the badge.
- **badge-feature-detect-pinned, a guard** — rows with no badge API, and with only one of its two functions, are pinned.
  Deleting the feature detect fails three of them. A synchronous throw counts as a refusal: one warning, then the hook
  stops trying.

## File names

- **files-named-apart-by-more-than-case, a rule the suite found** — `pwa/test/drawer-keybar.test.tsx` refuses two files
  whose paths differ only by case, since they collide on a case-insensitive disk. The plan's `face/appBadge.ts` (L1)
  beside `face/AppBadge.tsx` (L4) is therefore `face/badgeAct.ts`, named for its one function. The plan's
  `face/splash.ts` (L1) beside `face/Splash.tsx` (L4) is therefore `face/SplashScreen.tsx`, whose component is still
  `Splash`. The mutation floors' key follows the decider's file: `pwa/src/face/badgeAct.ts#badgeAct`.

## The gates (Tasks 5, 9, 10 and 11)

- **face-deciders-join-the-floors, rule** — the three pure deciders (`moodOf`, `splashShows`, `badgeAct`) join the
  server's mutation floors (`server/test/sim/faceSets.ts`), each at floor 1, with every mutant killed. The sets name no
  pwa file at the type level, so the server's test typecheck does not resolve pwa sources.
- **character-classname-scan, review carry R2-12 (review 1918)** — a scan of every `<Character` in `pwa/src` and `ui/src` refuses
  glow and loop utilities in its `className` (`drop-shadow-*`, including the arbitrary form, `animate-*`, `shadow-*`,
  `blur-*`, `filter`). It also refuses a non-literal `className` or a spread of props, which it cannot read. No caller
  passes one today. Review 1992 (F7) fixed the braced-literal path: a self-closing ` /` is trimmed before the brace strip, so a
  braced banned utility is refused by its own message, and a control row pins that `className={'face-mark'}` passes.
- **animation-tokens-closed, review carries R3-1, R3-2 and R3-5 (review 1924)** — every token of an `animation` entry in `checkSheet`
  must be a number, a time, a known keyword, a `steps(…)` timing token (matched as a whole token, in any case) or a
  keyframe the sheet defines. Keyframe stops may be written `.5%`. No eased keyword (`linear`, `ease`, `ease-*`) is a known
  keyword (review 1992, N1), so `steps(1) ease-in` is refused; rows pin the `$` anchor and the closed jump list too.
- **var-refusal-rides-the-token-rule, review carry R3-2 (review 1924)** — `var(` is not a legal token, so the closed token rule refuses
  it, and a refusal row pins that. No separate `var(` check was added, because one could never fail on its own.
- **argv-guarded, review carry R3-3 (review 1924)** — both generators (`make-characters.mjs` and `icon-gen.mjs`) check that
  `process.argv[1]` exists before resolving its real path.
- **keyframe-set-built-once, review carry R3-4 (review 1924)** — `checkSheet` builds its set of keyframe names once. Its refusal
  of a keyframes outside the allow-list is now pinned (review 1992, F6) in `characters-art.test.ts` and `wordmark.test.tsx`, with
  the reduced-motion `animation:none` refusal beside it.
