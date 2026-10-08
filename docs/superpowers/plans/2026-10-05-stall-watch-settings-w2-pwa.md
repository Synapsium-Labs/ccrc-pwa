# Stall watch settings wave 2: the Settings section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute,
> `superpowers:subagent-driven-development` with `superpowers:test-driven-development` for every test step. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Programme:** `stall-watch-settings`, **wave 2 of 2** (ledger `docs/superpowers/programs/stall-watch-settings.md`).
Deploy class: **server** (the server serves the PWA). No fleet-box deploy is needed (spec §18). One PR from a fresh child
workspace, opened only after W1 has merged.

**Goal:** Ship spec §13 and §18 W2. Settings gets a third section, **Stall watch**. It reads `GET /api/coord/stall-watch`
through its own 60 s poll and shows:
- the effective level, what it does, and where it comes from, with every held, hazard, files-exceed, stored-choice and
  fallback line the wire calls for;
- the Next step and its gate;
- the quiet time and its range;
- the four 48 h notice counts, with the run-less footnote.

The section writes a level, Follow or a quiet time through `POST /api/coord/stall-watch`. The server decides whether
the write needs a confirm: a 409 `confirm-required` opens a `QuickConfirm` sheet built from the server's measured
effect, and Set re-sends the same body with the server's key. The checked radio and the selected quiet time always come
from the server's answer, never from the tap. In the same wave:
- `QuickConfirm` accepts several consequence lines.
- The Notifications row is renamed "Push notifications for this browser".
- README's Settings paragraph names the third section.

**Architecture:** PWA only, plus one server-side prose pin.
- `pwa/src/lib/api.ts` gains two client methods, `stallWatch` and `setStallWatch`. The write uses `postJsonOr`, so an
  unreadable 2xx is `'unreadable'`, never "nothing happened". A non-2xx still rejects with `ApiError`.
- `pwa/src/fleet/useStallWatchView.ts` is new. It holds the hook, modelled on `useUpdatesView`: `issued` lives in a
  `useRef` shared by `load` and `settle`, there is no `refresh()`, and `pollMs <= 0` is the injected mode for tests. It
  also holds the two wire guards (`asStallWatchView`, `asStallConfirm`), each the single reader of its field (§14 item
  10), and the pure `stallWriteRefusal`, which sorts a rejection into a confirm to show or a refusal whose detail is
  never empty.
- `pwa/src/screens/StallWatchSection.tsx` is new. It holds the section and its exported pure helpers (`fillStallText`,
  `quietText`, `quietChoices`, `stallNowLines`, `stallNextLines`, `stallCountLine`, `stallConfirmTitle`,
  `stallConfirmLines`). Every word it shows is an L0 `STALL_*` constant from W1. It spells no level id and keeps no
  ladder.
- `SettingsScreen.tsx` renders `<StallWatchSection/>` after `<NotificationsSection/>`. Its header and "ONE poll"
  comments now name three sections and two reads.
- `QuickConfirm`'s `consequence` widens to `string | string[]`. Every existing caller is unchanged.
- Tasks 1 to 4 do not touch `shared/`, `server/src`, `agent/` or `ccd/`. W1's L0 block is complete, and they add no
  string to it. Their one server-side file is a new test, `server/test/stall-settings-readme.test.ts`, which ties
  README's new sentence to the L0 labels and the L1 bounds. Fix round 1 adds one key to W1's block
  (`unanswered-write-has-its-own-l0-line`, below). The review's item 5 edits are the coordinator's scope (ledger R20,
  R21): comments in `server/src/watch.ts`, the header of `shared/api.ts`'s stall-watch block, and tests in
  `server/test/coord-db.test.ts` and `server/test/stall-sweep.test.ts`.

**Tech Stack:** React and TypeScript in the PWA (Vite build, `tsc --noEmit && vite build`). Tests run on vitest with
jsdom and Testing Library (`pwa/test/`), and the README pin on vitest in `server/test/`. Node `>=22.13.0`. Mutation
instruments live outside the tree and are never committed.

**Spec:** `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md` rev 3.2, at `51aa5f0d8`: **APPROVED by the
operator 2026-10-05 17:46 UTC ("Spec is good"; the §19 defaults stand as written).** This wave implements:
- §13 (the PWA section);
- §16's `older-server-404-reads-not-configured` and `notifications-label-says-push`, and the sheet half of
  `confirm-on-stage-diff`;
- §17's P1–P12 rows, plus M6 and M24 as the section renders them;
- §18's W2 list.

**Measured at `origin/main` `77f8d63a5`** (2026-10-05). Every line number below is a HINT at that commit. Find every
edit by content: each task quotes the text it replaces, and each quoted text occurs exactly once in its file
(measured).

The prototype of every task was built and measured on branch `proto/sws-w2`:
- **Base.** It sits on W1 Task 1's prototype commit `2fb0123f7` (L0 wire types and texts, and the L1 core). W1's later
  prototype commits (`bb5bee7b4` to `ad2155ff4`, and its fix-round commits `d513b887f` and `a5fa943c6`) change no file
  under `shared/` or `pwa/`: `git diff --stat 2fb0123f7 a5fa943c6 -- shared/ pwa/` is empty, so the L0 this wave
  builds on is all of W1's. Its stall export count is 36 at `2fb0123f7`, `ad2155ff4`, `d513b887f` and `a5fa943c6`.
- **Commits.** `ac0388f60` (Task 1), `56a615f51` (Task 2), `fc33c1563` (Task 3), `ff342df12` (Task 4), then the
  review's fix round: `9fe8fd3a7` (Task 1), `4937088a1` (Task 3), `825fd1965` (Task 4), `619424bf7` (Task 3, one
  test comment reworded), then the final fix round: `80fb75b35` (Task 3, the repeat-line catch-all and its
  expectations removed, D-4037) and `e13dc1a6a` (Task 4, README's confirm clause drops "or below the built-in",
  D-4037). The red and green counts and the mutation tables below are MEASURED on the fix rounds' commits
  (`825fd1965` for the suites; at the tip `e13dc1a6a`, Task 3's and Task 4's whole tables, `settings-screen`
  `183 passed (183)`, the whole PWA suite, the build and every README suite of Task 4 Step 7, re-measured), not
  derived, unless a line says "derived". Each task's code is byte-identical to the prototype's file at the tip
  `e13dc1a6a` (checked by script).
- **Diff against `2fb0123f7`:**

  | File | Added/removed |
  |---|---|
  | `README.md` | 17/1 |
  | `pwa/src/components/QuickConfirm.tsx` | 12/2 |
  | `pwa/src/fleet/useStallWatchView.ts` | 259/0 |
  | `pwa/src/lib/api.ts` | 16/1 |
  | `pwa/src/screens/SettingsScreen.tsx` | 13/7 |
  | `pwa/src/screens/StallWatchSection.tsx` | 399/0 |
  | `pwa/test/primitives.test.tsx` | 20/0 |
  | `pwa/test/settings-screen.test.tsx` | 688/1 |
  | `pwa/test/use-stall-watch-view.test.tsx` | 502/0 |
  | `server/test/stall-settings-readme.test.ts` | 81/0 |

- **Since then.** `origin/main` has moved to `d12b5aba0` (#282, #283), which touched README.md, CLAUDE.md and docs only,
  and no `pwa/` file. README's Settings paragraph moves from ≈939 to ≈946, and the line Task 4 edits from ≈953 to
  ≈960. CLAUDE.md :10's size claim now reads `~5700`.
- **Merge probes.** `git merge-tree --write-tree` of `proto/sws-w2` at its tip `e13dc1a6a` exits 0 against `d12b5aba0`,
  and exits 0 against the whole W1 prototype at its tip `a5fa943c6` (as `825fd1965` did against `d513b887f`).

## Preconditions (check before the baseline; stop and report if one fails)

1. **The spec and this plan are on `origin/main`.**
   - `git show origin/main:docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md | grep -c 'APPROVED by the
     operator 2026-10-05 17:46 UTC'` prints `1`.
   - `git ls-tree origin/main` on this plan's own path prints one line. This plan alone defines D-4035 and D-4036 and, since fix rounds 1 and 2,
     the numbers for `malformed-optional-block-is-dropped` and `unanswered-write-has-its-own-l0-line`; the tasks write them, with D-4033 and D-4034, into tracked comments.
2. **W1 has merged on `main`.** Each of these prints the number shown:
   - `git show origin/main:server/src/coord/stallsettings.ts | grep -c '^export function stallWriteEffect'` → `1`;
   - `git show origin/main:server/src/coord/routes.ts | grep -cE "app\.(get|post)\('/api/coord/stall-watch'"` → `2`;
   - `git show origin/main:shared/api.ts | grep -cE '^export interface (StallWatchView|StallConfirmRequired) '` → `2`;
   - `git show origin/main:shared/api.ts | grep -cE '^export (const STALL_|type Stall|interface Stall|function
     (is|as)Stall)'` → `36` (measured at all four W1 prototype commits named above);
   - `git show origin/main:server/src/coord/stallsettings.ts | grep -cE '^export const STALL_(QUIET_(MIN|MAX|STEP)_MS|NOTICE_WINDOW_MS) '`
     → `4` (Task 4's pin imports these four L1 bounds; measured at the W1 prototype tip `a5fa943c6`);
   - `git show origin/main:server/src/coord/stall.ts | grep -c '^export const STALL_QUIET_MS '` → `1` (Task 4's pin
     imports the built-in quiet time).

   If the L0 count differs, a W1 fix round reshaped L0. Before the baseline, check that every name Task 1 and Task 3
   import is still exported, and name each difference in the wave-done mail. If either L1 count differs, a W1 fix round
   renamed a bound: Task 4's pin would then red on an import, not on the five measured messages. A missing name, in L0
   or L1, is a stop.
3. **The migration slot.** This wave takes no migration slot and never edits `server/src/coord/schema.ts`. W1's slot
   must already be on `main`: `git show origin/main:server/src/coord/schema.ts | grep -c 'CREATE TABLE stall_settings'`
   prints `1`. The slot was `MIGRATIONS[16]` (user_version 16 → 17) at the prototype. W1 measured it and may have moved
   it up, and nothing in this wave spells the number. Re-check at wave-done: `git diff --name-only origin/main...HEAD
   -- server/src/coord/schema.ts` prints nothing.
4. **The claims (worker clause 11).** Before the first edit, `POST /api/claims` every path in "File Structure",
   all-or-nothing. A 409 names the holder: mail them through the response's `mailHint`, and do not edit that path. The
   likeliest contenders:
   - an update-management wave on `SettingsScreen.tsx` or `settings-screen.test.tsx`, whose Updates section shares the
     file;
   - a README refresh holding the Settings paragraph.
5. **Branch.** This workspace's branch starts from current `origin/main` (a fresh child does). Absorb `main` later only
   on worker clause 16's measured triggers, with `git merge`, never a rebase. Then take the baseline.

## Baseline (the step before Task 1)

Each line below is its own Bash call, in the foreground, with a timeout of at least 600000 ms: one test file per
command, never a loop over several (Global Constraints, "How to run tests").

```bash
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/settings-screen.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/primitives.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/api.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/caps-control.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/app.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/tsc --noEmit -p . && echo tsc-clean
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-settings.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/pools-prose.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)" && wc -l < README.md && sed -n 10p CLAUDE.md | grep -oE '~[0-9]+ lines'
```

Expected at the prototype base:

| Check | Expected |
|---|---|
| `settings-screen` | `Tests 132 passed (132)` |
| `primitives` | `Tests 21 passed (21)` |
| `api` | `Tests 102 passed (102)` |
| `use-updates-view` | `Tests 30 passed (30)` |
| `caps-control` | `Tests 16 passed (16)` |
| `app` | `Tests 17 passed (17)` |
| `fleet-screen` | `Tests 98 passed (98)` |
| PWA `tsc` | clean |
| `single-definition` | `Tests 274 passed (274)` |
| `pools-prose` | `Tests 27 passed (27)` |
| README citation instrument | `Tests 7 passed \| 328 skipped (335)` |

- **`stall-settings`.** Its count is `main`'s after W1, and W1's later tasks raise it: 62 at W1 Task 1's prototype
  (`2fb0123f7`), and `114 passed (114)` at the W1 prototype's tip `a5fa943c6` (measured). A W1 fix round
  that lands after that tip moves it again. Record what `main` gives; every later step that names this suite expects
  that recorded figure, never 62.
- **README size.** README has 5729 lines at `d12b5aba0`, plus W1's net +14 (the W1 prototype measured 28/14), so expect
  about 5743 against a claim of `~5700`. Task 4 adds 16 lines. `pools-prose` allows a gap of at most 100 (its row is
  `toBeLessThanOrEqual(100)`; the prototype measured a gap of exactly 100 green), so the headroom before Task 4 must be
  at least 16. If it is less, Task 4's own remedy applies: re-measure CLAUDE.md :10 to the nearest hundred, and add
  CLAUDE.md to that commit and to the claims.
- **The whole PWA suite.** Run it once as well (`./node_modules/.bin/vitest run`, foreground, its own command).
  Expected: 105 files and 3237 tests. That figure is derived from the measured 106 files and 3320 tests after Task 4,
  less this wave's 83 rows (31 in Task 1, 1 in Task 2, 51 in Task 3). Under load, reds in `contrast`, `swap-sheet`,
  `session-pickers` or `fleet-screen` are timeouts: re-run each alone with `--testTimeout=240000` before calling it a
  break.

Record every line in the wave-done mail. If another PR has landed rows in any of these suites since, the totals are
`main`'s, and every total below rises by the same amount.

## Global Constraints

- **No device distinction** (§2, §4, §13 "Same everywhere"). The section has no viewport, pointer or user-agent branch.
  No string in the section, its controls or the L0 `STALL_*` texts names a device. The renamed Notifications label says
  "Push".
- **The PWA holds no ladder and decides no confirm** (§13, D-4033). A write goes out with only the field moved and no
  `confirm`. A 409 `confirm-required` that passes `asStallConfirm` opens the sheet from the server's `effect`. Set
  re-sends the same body with `confirm: effectKey`. Cancel sends nothing. The section never previews a choice.
- **The server's answer is what is shown, never the tap; never optimistic** (§13, P2). A 2xx view is installed with
  `settle(view)`. An unreadable 2xx gives `toast(UNCONFIRMED_TEXT)`, then `reload()`. A write whose answer
  never arrived (a network failure after the POST may have left) gives `toast(STALL_CONFIRM_TEXT.unanswered)` (fix
  round 1, F1), then `reload()`: it may have landed, so it never says "Nothing was changed" (§15's "A write's reply
  cannot be read" row). Any other refusal gives `STALL_CONFIRM_TEXT.refused` with its
  detail (the server's `detail`, else the 500 body's `message`, else the error's own text), then `reload()`. The
  controls are locked while a write is in flight or its sheet is open.
- **Not-configured wins over a landed view** (§13, D-4035). Only 501 `not-configured` and 404 `not-found` map to
  `not-configured`, and both status and code must match. The section's whole body is then `STALL_NOT_AVAILABLE_TEXT`:
  no Now block, no control, no checked radio.
- **The section polls** (§4): every `STALL_WATCH_POLL_MS = 60_000`, and again when the page becomes visible. There is
  no WebSocket frame, and `CoordStatus` and `FLEET_PROTO` are unchanged.
- **One reader per field** (§14 item 10): `asStallWatchView` reads the view and `asStallConfirm` reads the 409 body. A
  malformed answer is a failed read, never a level.
- **Single definition** (§14 item 12, P9). Every section string is an L0 `STALL_*` constant, filled by `fillStallText`.
  The section spells no level id, copies no stall constant's value and keeps no short form of a level label. Tasks 1
  to 4 add no L0 string; fix round 1 adds one key (`unanswered-write-has-its-own-l0-line`, below). The review's item 5
  comment and test edits in `server/src/watch.ts`, `shared/api.ts`'s block header, `server/test/coord-db.test.ts` and
  `server/test/stall-sweep.test.ts` are the coordinator's scope (ledger R20, R21).
- **`QuickConfirm` keeps every existing caller unchanged** (§13). A string renders one `<p className="qc-consequence">`
  as before. A list renders one per line, with the same class.
- **CSS:** only existing classes in `fleet.css` (§13). No new CSS.
- **No marker name in any new file** (§14 item 1). `single-definition.test.ts` walks `pwa/src` and must stay green
  without being edited.
- **Out of the wave's lanes:** `shared/`, `server/src`, `agent/`, `ccd/`, `deploy/` and `server/src/coord/schema.ts`
  (§18: W2 is the PWA section; W1's L0 and routes are complete).
- **README is in the citation corpus.** Its edit adds 16 lines after ≈953. The citation instrument must read
  `7 passed | 328 skipped (335)` before and after, and `pools-prose` (the size claim within 100 lines) must stay green.
- **Mutation-table discipline.** Every new guard ships with a mutation measured red when the guard is deleted or
  changed (§17; doctrine: "a comment is a request; a red suite is a mechanism"). The tasks' tables were measured on the
  prototype. Re-measure them on the real branch and paste the runner's output into the wave-done mail. A row whose red
  differs from the table, in its `failed` count or in the names of the failing rows, is a finding.
- **How to run tests.**
  - Each suite runs from inside its package (`pwa/` or `server/`), in the FOREGROUND, with a timeout of at least
    600000 ms, one file per command: `./node_modules/.bin/vitest run test/<file>`.
  - Never bare `npx vitest`: it finds no jsdom and falsely reports "no tests".
  - A red in a known load flake is re-run alone before it is called a break. The server's are `session-hook` and
    `typecheck-tests`. On the PWA side under load, the prototype measured `contrast`, `swap-sheet`, `session-pickers`
    and `fleet-screen`.
- **Deviation numbers.**
  - This plan defines exactly five: D-4035, D-4036, the one for `malformed-optional-block-is-dropped` (fix round 1), the
    one for `unanswered-write-has-its-own-l0-line` (fix round 1's F1, numbered by fix round 2) and the one for
    `pinned-built-in-value-is-its-own-option` (fix round 2's pinned option, numbered by fix round 3).
  - It cites D-4033, D-4034, D-4037 and D-4038, which the W1 plan defines.
  - The coordinator holds this programme's reserve numbers. A departure found during this wave goes into the
    wave-done mail by slug, and the coordinator assigns its number then.
  - Never write any other number, never a range and never a placeholder (`dtbd.test.ts` reds one). Name any further
    departure by slug in the wave-done mail.
- **Commit on this workspace's own branch (`ws/<slug>`)**, never a separate feature branch.
- **Public repo:** no account label, host name, live session id, real pool name or docserver URL in code, tests,
  commits or this plan's edits.

## Review Focus

1. **A rollback to a server without the route.**
   - **Risk.** An open tab gets 404 `not-found`. If the section kept rendering its landed view, the operator would see
     an old choice ("Off, Chosen here", radio checked) that no longer applies, while the shadow backlog goes out
     (§15's rollback row).
   - **Task 1.** The hook keeps the last view beside the failure. Pinned by "P7: reads only 501 not-configured and 404
     not-found as not-configured; every other pairing is failed" (mutations P7a, P7b and P7c) and by "keeps the last
     good view across a failed, a malformed and a not-configured poll…".
   - **Task 3.** The section must check `failure` first. Pinned by "P1b: a 404 not-found after a landed view replaces
     the whole body — no Now block, no radio checked" (X2, which renders the view first), and by "P1b: a 501
     not-configured first read is the not-available text, not the unread line" (X47, which lets the not-available
     body render only over a landed view). X2 cannot red the 501 row: on a first read there is no view to render
     first.
2. **A poll racing a write.**
   - **Risk.** A poll issued before a write and landing after it must not overwrite the write's reply. A rejected stale
     poll must not raise a failure.
   - **Task 1.** Pinned by the two "P4: settle…" rows and "keeps the newest issued poll authoritative…" (mutations P4,
     G1 and G2), and by "a poll issued AFTER settle lands normally". Read `settle`'s generation bump against `load`'s
     newest-issued check in both arms.
3. **The confirm flow is the server's** (D-4033).
   - **Task 1.** A 409 is a confirm only when the status and the whole body match (G12 to G14).
   - **Task 3.** Pinned by these rows: "P3: a 409 opens the sheet from its effect; Cancel sends nothing more…" (X4),
     "P3: Set re-POSTs the same body with confirm equal to effectKey…" (X5), "P3: a write answered 2xx at once…" (X6),
     and "P3c: a key the server no longer matches opens a fresh sheet…" (X7).
   - **The lock.** The controls are disabled while a write is in flight or its sheet is open, and `choose` sends nothing
     while they are: "P3: the controls are locked while a write is in flight…" (X44 drops `busy` from the lock, X45
     drops the `choose` guard), with the sheet half in the 409 row.
   - **For the reviewer.** Read the section for any branch that decides a confirm or previews a choice. X6 reds 12
     rows when the section decides one.
4. **The sheet says what the write does.** The operator decides from these lines. A wrong line arms a stage on false
   premises.
   - **Task 3.** `stallConfirmLines` is pinned by "the order: does, turn-ons, stops, the held line, what falls due, the
     quiet lines, the files-exceed line", by the P3b row (Off over a busy file: "Busy delivery turns back on…", X8), and
     by the P3d rows: mail-off variants X10, X11, X13, X56 and X58; the quiet line by what runs after X12; the dialog
     line X14; the held line X15 to X17; and quietRepeat X18. A quiet-time raise adds no line of its own: W1 asks no
     confirm for one (`quiet-raise-asks-nothing` (D-4037)).
   - **Task 2.** `QuickConfirm` renders them one paragraph each: "renders one consequence paragraph per line of a list,
     and one for a string" (P8a to P8c).
5. **Only the server's answer is drawn, and a malformed one draws nothing.**
   - **Task 3, refusals.** A refused write leaves the stored radio checked: "P2: a refused write toasts the server's
     detail, re-reads, and leaves the stored radio checked" (X3, X41). A cancelled or refused quiet write leaves the
     select on the stored value (X46). A 500 toasts the cause the server put in its `message` (X59). An unreadable 2xx
     installs nothing and re-reads (X40, X42), and so does a write whose answer never arrived, which says the change
     could not be confirmed, never "Nothing was changed" (X48, X60).
   - **Task 3, stored and unmeasured states.** An absent or unreadable stored level checks no radio, and the quiet
     select shows no value the server did not answer (X38). An unmeasured registry reads "Unknown", never Off (M6: X32
     and X33).
   - **Task 1, the guards.**
     - `asStallWatchView` refuses a malformed fallback (G4) and drops malformed counts with one warn (G9).
     - A quiet range is readable only with `stepMs > 0` and at most 1000 steps (G10, G11). Without that bound,
       `quietChoices` would iterate a hostile range forever.
     - `stallWriteRefusal` never yields an empty detail (G15, and "falls back to the error's own text…"), takes the 500
       body's `message` (G17), and reads a rejection that is not an `ApiError` as unconfirmed (G18).
     - Every flag of the 409 effect, the key's type, the chosen row's `updatedAt` and `stored`, the counts' `since`
       and `windowMs`, and the visible-only re-poll each have a row (G19 to G33).

## File Structure

| File | Change | Task |
|---|---|---|
| `pwa/src/lib/api.ts` | `stallWatch` and `setStallWatch` on `createApi`'s object (16/1) | 1 |
| `pwa/src/fleet/useStallWatchView.ts` | **new** (259 lines): `STALL_WATCH_POLL_MS`, `StallWatchFailure`, `StallWatchPoll`, `asStallWatchView`, `asStallConfirm`, `StallWriteRefusal`, `stallWriteRefusal`, `useStallWatchView` | 1 |
| `pwa/test/use-stall-watch-view.test.tsx` | **new** (502 lines, 31 rows), beside `use-updates-view.test.tsx` | 1 |
| `pwa/src/components/QuickConfirm.tsx` | `consequence: string \| string[]`, one `<p className="qc-consequence">` per line (12/2); `onConfirm(); onClose();` moves to ≈44–45 | 2 |
| `pwa/test/primitives.test.tsx` | one row in the `QuickConfirm` describe, before `// — Toast —` (≈302) (20/0) | 2 |
| `pwa/src/screens/StallWatchSection.tsx` | **new** (399 lines): the section and its pure helpers | 3 |
| `pwa/src/screens/SettingsScreen.tsx` | header comment (≈1–7, "Two sections and no more"); the Notifications row label (≈650) and its comment; `<StallWatchSection />` after `<NotificationsSection/>`; the "ONE poll" comment (≈677) (13/7) | 3 |
| `pwa/test/settings-screen.test.tsx` | the label pin (≈1771) moved; the new import (≈33); three describes, 51 rows (26 helpers, 22 section, 3 scans) (688/1) | 3 |
| `README.md` | the Settings paragraph gains "Settings has a third section, **Stall watch** …" (one line becomes seventeen; ≈953 at `77f8d63a5`, ≈960 at `d12b5aba0`) | 4 |
| `server/test/stall-settings-readme.test.ts` | **new** (81 lines, 5 rows): the sentence pinned to L0 and L1, the route, one lead sentence after Notifications, no device word (the PWA's own device-word list) | 4 |
| `pwa/src/screens/settingsText.ts` | **new** (fix round 1, F4): `UNCONFIRMED_TEXT` and its docstring, imports nothing; `SettingsScreen.tsx` re-exports it and `StallWatchSection.tsx` imports it, so the two screens no longer import each other | fix round 1 |
| `shared/api.ts` | one key, `STALL_CONFIRM_TEXT.unanswered`, inside W1's stall-watch block (`unanswered-write-has-its-own-l0-line`), and, in fix round 2, the two-line D-4043 comment above that key (no string changed); the review's item 5 edit to the block's header comment is the coordinator's (ledger R20, R21) | fix round 1 |
| `server/test/coord-db.test.ts` | the stall_settings slot found by its DDL, not hard-coded (fix round 1, Q), and, in fix round 2, the needle stops at the name: `/CREATE TABLE stall_settings(?![A-Za-z0-9_])/` (R27 item 4), so a later `stall_settings_new` table is not counted; the review's item 5 edit is the coordinator's (ledger R20, R21) | fix round 1 |
| `server/test/stall-sweep.test.ts` | the review's item 5 test edit, the coordinator's scope (ledger R20, R21) | coordinator |
| `server/src/watch.ts` | the review's item 5 comment lines only (no behaviour), the coordinator's scope (ledger R20, R21) | coordinator |

**Deliberately unchanged** (measured):
- **`shared/api.ts`, by Tasks 1 to 4.** W1's L0 holds every string the section shows. Fix round 1 adds one key,
  `STALL_CONFIRM_TEXT.unanswered` (`unanswered-write-has-its-own-l0-line`, below); the review's item 5 edit to the
  block's header comment is the coordinator's scope (ledger R20, R21).
- **`server/src/**`, `agent/`, `ccd/` and `server/src/coord/schema.ts`, by Tasks 1 to 4.** Item 5's comment-only edits
  in `server/src/watch.ts` are the coordinator's scope (ledger R20, R21). `schema.ts` is untouched over the whole wave.
- **`server/test/stall-settings.test.ts` and `single-definition.test.ts`.** W1's `stall-settings.test.ts` tail still
  moves under W1's own tasks, so Task 4's README pin lives in its own file.
- **`fleet.css`.** No new class.
- **`pwa/src/fleet/AbandonSheet.tsx` :8 and `pwa/src/fleet/SwapSheet.tsx` :459.** Each cites `QuickConfirm.tsx:33-34`,
  already one line off at `77f8d63a5`. They stay as history, and no test pins them.
- **README ≈951 (≈958 at `d12b5aba0`), "the phone-push bell for this browser".** Spec §13 measured that README does
  not spell the renamed label, and §18 gives W2's README edit as the third-section sentence only. It was put to the
  operator under "Open questions for the operator" below. **Settled by the operator's 2026-10-05 directive** (no
  device distinction): README already reads "the push bell for this browser" (`a5771e471`), and
  `stall-settings-readme.test.ts`'s device row pins it. The paragraph is kept here as the history of why it was asked.
- **README ≈3751, the strict runbook's "`rm` it to go back".** That residue is W1's (§20, coordinator lens).

---

## Tasks

### Task 1: The PWA API client and the useStallWatchView hook

**Model routing:** `sonnet`, effort `high`: two client methods, one hook in `useUpdatesView`'s shape, three pure readers,
their tests and a mutation table.

**Files:**
- Modify: `pwa/src/lib/api.ts`: the `shared/api` type import (≈5) gains `StallWatchRequest` and `StallWatchView`;
  `createApi`'s returned object gains `stallWatch` and `setStallWatch`, inserted after `setCoordCaps` (≈1045–1046).
- Create: `pwa/src/fleet/useStallWatchView.ts` (259 lines): `STALL_WATCH_POLL_MS`, `StallWatchFailure`,
  `StallWatchPoll`, `asStallWatchView`, `asStallConfirm`, `StallWriteRefusal`, `stallWriteRefusal`,
  `useStallWatchView`, and the module-private `nonBlank`, `NOT_CONFIGURED_ANSWERS` and `failureOf`.
- Test: `pwa/test/use-stall-watch-view.test.tsx` (new, 502 lines, 31 rows), beside `use-updates-view.test.tsx`.

**Interfaces:**
- Consumes, from `shared/api.ts` (W1 Task 1's L0, appended after `MAIL_REPLAY_MS`): `STALL_HELD_TEXT`, `STALL_LEVELS`,
  `STALL_NOTICE_TEXT`, `STALL_STAGES`, `STALL_STORED_STATES`, `isStallLevelChoice(v: unknown): v is StallLevelChoice`,
  and the types `StallConfirmRequired`, `StallLevel`, `StallNextStep`, `StallNoticeCount`, `StallWatchEffective`,
  `StallWatchStages`, `StallWatchView`, `StallWatchRequest`, `StallWriteEffect`.
- Consumes, from `pwa/src/lib/api.ts`: `ApiError` (≈9), `apiErrorText(err: unknown): string` (≈259), `api`, and
  `createApi`'s private `getJson` and `postJsonOr` (≈491, ≈554).
- Consumes, from the server (W1, spec §10): `GET`/`POST /api/coord/stall-watch`, answering 200
  `{ ok: true, ...StallWatchView }`, 501 `{ ok: false, error: 'not-configured' }`, 409 `StallConfirmRequired`, 400
  `{ ok: false, error: 'bad-request', detail }`, and Fastify's own 500 `{ statusCode, error, message }` when the route
  throws (W1 keeps it on purpose, and its `message` names the cause: a stored row that cannot be read, or a second
  conflict); and an older server's `/api/*` not-found answer, 404
  `{ ok: false, error: 'not-found' }` (`server.ts` ≈3472). The tests mock all of it.
- Produces (Tasks 2 onward read these):

```ts
// pwa/src/lib/api.ts, on the object createApi returns
stallWatch: () => Promise<StallWatchView>;
setStallWatch: (body: StallWatchRequest) => Promise<StallWatchView | 'unreadable'>;

// pwa/src/fleet/useStallWatchView.ts
export const STALL_WATCH_POLL_MS = 60_000;
export type StallWatchFailure = 'not-configured' | 'failed';
export interface StallWatchPoll {
  view: StallWatchView | null; failure: StallWatchFailure | null;
  reload: () => void; settle: (view: StallWatchView) => void;
}
export function asStallWatchView(raw: unknown): StallWatchView | null;
export function asStallConfirm(raw: unknown): StallConfirmRequired | null;
export type StallWriteRefusal =
  | { kind: 'confirm'; confirm: StallConfirmRequired }
  | { kind: 'refused'; detail: string }
  | { kind: 'unconfirmed' };
export function stallWriteRefusal(err: unknown): StallWriteRefusal;
export function useStallWatchView(pollMs?: number): StallWatchPoll;
```

**What this task settles (spec §13, §16, §20):**
- **The method names are §13's**, `stallWatch` and `setStallWatch`, which §13's test hooks spy on. A non-2xx still
  rejects with `ApiError`, as every method in the file does. The typed reading of a write's rejection is
  `stallWriteRefusal`, a pure reader beside the two guards, so the client keeps one contract for every route.
- **Not-configured is two (status, code) pairs, never a status alone:** 501 `not-configured` and 404 `not-found`
  (departure `older-server-404-reads-not-configured` (D-4035)). A 404 carrying Fastify's own body, a 501 carrying another
  word, and a 500 carrying `not-configured` all read `failed` (P7).
- **`settle` bumps the shared `issued` ref** and sets `failure` to `null`, so a poll issued before the write, resolving
  or rejecting after it, is dropped (P4). A poll issued after `settle` lands as usual. `settle` installs in the injected
  mode too; `reload` there is a no-op, as in `useUpdatesView`.
- **No `refresh()`** (§13): the returned object has exactly `view`, `failure`, `reload` and `settle`, and a row pins it.
- **Residue (§20), the `refused` toast's empty slot,** for both cases §20 names (a 409 whose body fails
  `asStallConfirm`, and Fastify's 500), and W1's hand-off on the same slot ("when the body has none or Fastify's 500
  puts the cause in `message`"): an `ApiError`'s `detail` is the first non-blank string of the server's own `detail`,
  the body's `message` (Fastify's 500 carries the cause the route threw: "stall settings unreadable, nothing written:
  …" or "… changed outside the server twice during one write; nothing written"), and `apiErrorText(err)`, the app's
  existing floor: the error code (`confirm-required`, `bad-request`), Fastify's `Internal Server Error` when its
  `message` is blank, or `request failed (<status>)` for a non-JSON body. When all of those are blank, the detail is
  `HTTP ${status}` (fix round 1, F9). That string fills the server-answer detail slot, as `apiErrorText`'s
  `request failed (<status>)` floor does, and is not section copy; it is not an L0 string.
- **A rejection that is not an `ApiError`** (a network failure, after which the POST may have landed) is
  `{ kind: 'unconfirmed' }`, never a refusal: "Nothing was changed" would be a claim nobody measured. The section
  answers it with a toast and a re-read (Task 3). W1's L0 had no text of its own for this case, and the PWA's one
  existing text for an answer that could not be read, `UNCONFIRMED_TEXT` (spec §13 step 3, §15's "A write's reply
  cannot be read" row), leads with "Saved", which overstates a request that never left. Fix round 1 (F1) therefore
  gave the network arm its own L0 line, `STALL_CONFIRM_TEXT.unanswered` ("Not confirmed — the server did not answer;
  the screen will re-check."), numbered as `unanswered-write-has-its-own-l0-line`. The 2xx-unreadable arm keeps
  `UNCONFIRMED_TEXT`, and the re-read shows what was stored either way. The wording is listed for the operator under
  "Open questions for the operator".
- **The wire guard's two choices §12 leaves open.** A present but malformed `next` or `filesExceed` is dropped and read
  as not stated, like a missing one, with the one `console.warn` that also counts dropped `counts` elements. A present
  but malformed `fallback` refuses the whole answer, because reading it as `null` would claim the choice applies when
  the server said it does not. A missing `fallback` reads as `null` with no warning.
- **A quiet range is readable only when it can be listed:** `stepMs > 0`, `minMs <= maxMs`, and at most
  `QUIET_STEPS_MAX` (1 000) steps, since the section's select iterates it (23 steps at the shipped values).
- **`asStallConfirm` drops nothing:** an effect with an unknown stage, a missing flag or a missing quiet time refuses
  the body, because a sheet built from part of an effect would understate what the write does.

- [ ] **Step 1: Re-anchor**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -c 'StagedClip, UpdateChannel' pwa/src/lib/api.ts
grep -c "      postJsonOr<CoordCapsView | 'unreadable'>('/api/coord/caps', 'unreadable', next)," pwa/src/lib/api.ts
grep -n '^export const STALL_STAGES\|^export const STALL_STORED_STATES\|^export function isStallLevelChoice' shared/api.ts
grep -n "return reply.code(404).send({ ok: false, error: 'not-found' });" server/src/server.ts
ls pwa/src/fleet/useStallWatchView.ts pwa/test/use-stall-watch-view.test.tsx 2>&1 | grep -c 'No such file'
```

Expected: `1`, `1`; three lines in `shared/api.ts` (W1's block, after `MAIL_REPLAY_MS`); two lines in `server.ts`, one
of them the not-found handler (≈3472); `2` (neither new file exists yet). If W1's L0 is missing, W1 has not merged:
stop and report.

- [ ] **Step 2: Write the failing test**

Create `pwa/test/use-stall-watch-view.test.tsx`:

```tsx
// useStallWatchView — the Stall watch section's own read of GET /api/coord/stall-watch (design 2026-10-05 §13),
// modelled on useUpdatesView, and the three pure readers the section shares with it:
//
//  • asStallWatchView: a malformed answer is a FAILURE, never a level. Missing `next`, `filesExceed` or `fallback` read
//    as "not stated" (§12's absence-permits); a malformed `fallback` refuses the answer, because reading it as `null`
//    would claim the choice applies when the server said it does not.
//  • asStallConfirm: the 409 `confirm-required` body, accepted only whole — a sheet built from part of an effect
//    would understate what the write does.
//  • stallWriteRefusal: a write's rejection read as a confirm to show, a refusal with a detail that is never empty, or
//    (a network failure, which may have landed) an unconfirmed write.
//
// The hook adds `settle(view)` to useUpdatesView's shape: a write's reply wins over any poll issued before it (P4).
// Only 501 `not-configured` and 404 `not-found` read as not-configured, each status with its own code (P7).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { StallConfirmRequired, StallWatchEffective, StallWatchView, StallWriteEffect } from '../../shared/api';
import { ApiError, api, createApi } from '../src/lib/api';
import {
  STALL_WATCH_POLL_MS, asStallConfirm, asStallWatchView, stallWriteRefusal, useStallWatchView,
} from '../src/fleet/useStallWatchView';

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const effective = (over: Record<string, unknown> = {}): StallWatchEffective => ({
  measured: true, level: 'check', files: 'check', source: 'files',
  stages: { runs: true, checks: true, alerts: false, busyDelivery: false, busyGate: true, wave2: false },
  held: { watchOff: false, mailOff: false, gateStrict: false, wave2HeldByStrict: false },
  next: { kind: 'step', level: 'alert', waitsOn: ['alerts'] },
  filesExceed: false,
  ...over,
} as StallWatchEffective);

const view = (over: Partial<StallWatchView> = {}): StallWatchView => ({
  chosen: { level: 'follow', quietMs: 'default', updatedAt: 1_000, stored: 'row' },
  effective: effective(),
  quiet: {
    effectiveMs: 7_200_000, builtInMs: 7_200_000, minMs: 1_800_000, maxMs: 43_200_000, stepMs: 1_800_000,
    source: 'default',
  },
  notices: {
    ok: true, since: 0, windowMs: 172_800_000,
    counts: [
      { row: 'checks', sent: 1, shadow: 2 }, { row: 'wakes', sent: 0, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 3 }, { row: 'pushes', sent: 4, shadow: 0 },
    ],
  },
  fallback: null,
  ...over,
});

const stagesOff = { runs: true, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false };
const effect = (over: Record<string, unknown> = {}): StallWriteEffect => ({
  measured: true, turnsOn: ['checks'], turnsOff: [], leavesWave2: false, heldByBox: false,
  quietLowered: false, filesExceed: false,
  before: stagesOff, after: { ...stagesOff, checks: true },
  quietMs: { before: 7_200_000, after: 7_200_000 }, mailOff: false,
  ...over,
} as StallWriteEffect);

const confirmBody = (over: Record<string, unknown> = {}): StallConfirmRequired => ({
  ok: false, error: 'confirm-required', effect: effect(), effectKey: '0a1b2c3d', ...over,
} as StallConfirmRequired);

/** One poll interval, flushed. */
const tick = async (): Promise<void> => {
  await act(async () => { await vi.advanceTimersByTimeAsync(STALL_WATCH_POLL_MS); });
};

describe('api.stallWatch and api.setStallWatch — the two client methods (§13)', () => {
  it('GETs /api/coord/stall-watch and returns the parsed answer', async () => {
    const answer = { ok: true, ...view() };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, answer));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    expect(await client.stallWatch()).toEqual(answer);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('/api/coord/stall-watch');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('POSTs only the given fields as JSON, with no box token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, ...view() }));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    await client.setStallWatch({ level: 'check' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coord/stall-watch');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ level: 'check' });
    expect(new Headers(init.headers).get('x-ccrc-mail-token')).toBeNull();
  });

  it('answers `unreadable` when a 2xx write comes back unparseable — the write may have landed (D-1150)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.reject(new Error('truncated')), text: () => Promise.resolve(''),
    });
    const client = createApi(fetchImpl as unknown as typeof fetch);
    await expect(client.setStallWatch({ quietMs: 'default' })).resolves.toBe('unreadable');
  });

  it('rejects a 409 with an ApiError carrying the confirm body, which stallWriteRefusal reads', async () => {
    const body = confirmBody();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, body));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    const err = await client.setStallWatch({ level: 'alert' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual(body);
    expect(stallWriteRefusal(err)).toEqual({ kind: 'confirm', confirm: body });
  });
});

describe('asStallWatchView — a malformed answer is a failure, never a level', () => {
  it('passes a well-formed answer through as the same object: measured, unmeasured, counts failed, a fallback stated', () => {
    for (const v of [
      view(),
      { ok: true, ...view() },
      view({ effective: { measured: false } }),
      view({ notices: { ok: false } }),
      view({ fallback: { at: 5, reason: 'resolver threw' } }),
      view({ chosen: { level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'absent' } }),
      view({ chosen: { level: 'all', quietMs: 3_600_000, updatedAt: 9, stored: 'row' } }),
      view({ effective: effective({ level: 'custom', next: { kind: 'none' } }) }),
      view({ effective: effective({ level: 'all', next: { kind: 'top' } }) }),
    ]) {
      expect(asStallWatchView(v), JSON.stringify(v)).toBe(v);
    }
  });

  it('refuses a non-object, and every missing or malformed required part', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}]) {
      expect(asStallWatchView(raw), JSON.stringify(raw)).toBeNull();
    }
    const v = view();
    const cases: Array<[string, unknown]> = [
      ['chosen absent', { ...v, chosen: undefined }],
      ['chosen.level not a choice', { ...v, chosen: { ...v.chosen, level: 'loud' } }],
      ['chosen.level inherited name', { ...v, chosen: { ...v.chosen, level: 'toString' } }],
      ['chosen.quietMs a string', { ...v, chosen: { ...v.chosen, quietMs: '3600000' } }],
      ['chosen.quietMs NaN', { ...v, chosen: { ...v.chosen, quietMs: Number.NaN } }],
      ['chosen.updatedAt absent', { ...v, chosen: { ...v.chosen, updatedAt: undefined } }],
      ['chosen.stored unknown', { ...v, chosen: { ...v.chosen, stored: 'gone' } }],
      ['effective absent', { ...v, effective: undefined }],
      ['effective.measured absent', { ...v, effective: { ...effective(), measured: undefined } }],
      ['effective.level unknown', { ...v, effective: effective({ level: 'loud' }) }],
      ['effective.files unknown', { ...v, effective: effective({ files: 7 }) }],
      ['effective.source unknown', { ...v, effective: effective({ source: 'box' }) }],
      ['effective.stages missing a stage', { ...v, effective: effective({ stages: { runs: true, checks: true } }) }],
      ['effective.stages a non-boolean', { ...v, effective: effective({ stages: { ...stagesOff, wave2: 'no' } }) }],
      ['effective.held missing a flag', { ...v, effective: effective({ held: { watchOff: false } }) }],
      ['quiet absent', { ...v, quiet: undefined }],
      ['quiet.builtInMs absent', { ...v, quiet: { ...v.quiet, builtInMs: undefined } }],
      ['quiet.stepMs zero', { ...v, quiet: { ...v.quiet, stepMs: 0 } }],
      ['quiet.stepMs negative', { ...v, quiet: { ...v.quiet, stepMs: -1_800_000 } }],
      ['quiet.minMs above maxMs', { ...v, quiet: { ...v.quiet, minMs: 50_000_000 } }],
      ['quiet steps past any list', { ...v, quiet: { ...v.quiet, stepMs: 1 } }],
      ['quiet.source unknown', { ...v, quiet: { ...v.quiet, source: 'files' } }],
      ['notices absent', { ...v, notices: undefined }],
      ['notices.ok absent', { ...v, notices: { since: 0, windowMs: 1, counts: [] } }],
      ['notices.counts not an array', { ...v, notices: { ok: true, since: 0, windowMs: 1, counts: {} } }],
      ['notices.windowMs absent', { ...v, notices: { ok: true, since: 0, counts: [] } }],
      ['notices.since absent', { ...v, notices: { ok: true, windowMs: 1, counts: [] } }],
    ];
    for (const [name, raw] of cases) expect(asStallWatchView(raw), name).toBeNull();
  });

  it('reads a MISSING fallback as none stated, with no warning; refuses a MALFORMED one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fallback: _f, ...noFallback } = view();
    void _f;
    expect(asStallWatchView(noFallback)).toEqual({ ...noFallback, fallback: null });
    expect(warn).not.toHaveBeenCalled();
    for (const bad of [{}, { at: 5 }, { reason: 'x' }, { at: '5', reason: 'x' }, 'resolver threw', 0]) {
      expect(asStallWatchView({ ...view(), fallback: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it('reads a missing next or filesExceed as not stated, passing the answer through unchanged', () => {
    const { next: _n, filesExceed: _x, ...bare } = effective() as Extract<StallWatchEffective, { measured: true }>;
    void _n; void _x;
    const v = view({ effective: bare });
    expect(asStallWatchView(v)).toBe(v);
  });

  it('drops a malformed next or filesExceed as not stated, keeps the rest, and warns exactly once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const next of [{ kind: 'jump' }, { kind: 'step', level: 'loud', waitsOn: [] },
      { kind: 'step', level: 'alert', waitsOn: ['alerts', 'runs'] }, { kind: 'step', level: 'alert' }, null]) {
      warn.mockClear();
      const got = asStallWatchView(view({ effective: effective({ next, filesExceed: 'yes' }) }));
      expect(got, JSON.stringify(next)).not.toBeNull();
      expect(got!.effective).not.toHaveProperty('next');
      expect(got!.effective).not.toHaveProperty('filesExceed');
      expect(got!.effective).toMatchObject({ measured: true, level: 'check', source: 'files' });
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it('drops a malformed counts element, keeps the others, and warns exactly once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = view();
    const counts = (good.notices as Extract<StallWatchView['notices'], { ok: true }>).counts;
    const got = asStallWatchView({
      ...good,
      notices: {
        ok: true, since: 0, windowMs: 172_800_000,
        counts: [null, { row: 'toString', sent: 1, shadow: 1 }, { row: 'checks', sent: -1, shadow: 0 },
          { row: 'wakes', sent: 1.5, shadow: 0 }, { row: 'reports', sent: 0 }, ...counts],
      },
    });
    expect(got).not.toBeNull();
    expect(got!.notices).toEqual({ ok: true, since: 0, windowMs: 172_800_000, counts });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('asStallConfirm — the 409 body, accepted only whole', () => {
  it('accepts a confirm-required body with a readable effect, measured or not', () => {
    const a = confirmBody();
    expect(asStallConfirm(a)).toBe(a);
    const b = confirmBody({ effect: { measured: false } });
    expect(asStallConfirm(b)).toBe(b);
    const c = confirmBody({ effect: effect({ turnsOn: [], turnsOff: ['busyDelivery', 'wave2'], leavesWave2: true }) });
    expect(asStallConfirm(c)).toBe(c);
  });

  it('refuses another code, a missing or non-string key, and any effect it cannot read whole', () => {
    const cases: Array<[string, unknown]> = [
      ['not an object', 'confirm-required'],
      ['another code', confirmBody({ error: 'bad-request' })],
      ['no key', confirmBody({ effectKey: undefined })],
      ['a numeric key', confirmBody({ effectKey: 12 })],
      ['no effect', confirmBody({ effect: undefined })],
      ['effect.measured absent', confirmBody({ effect: { ...effect(), measured: undefined } })],
      ['an unknown stage turning on', confirmBody({ effect: effect({ turnsOn: ['checks', 'runs'] }) })],
      ['turnsOff not an array', confirmBody({ effect: effect({ turnsOff: 'wave2' }) })],
      ['leavesWave2 absent', confirmBody({ effect: effect({ leavesWave2: undefined }) })],
      ['heldByBox absent', confirmBody({ effect: effect({ heldByBox: undefined }) })],
      ['quietLowered absent', confirmBody({ effect: effect({ quietLowered: undefined }) })],
      ['filesExceed absent', confirmBody({ effect: effect({ filesExceed: undefined }) })],
      ['before missing a stage', confirmBody({ effect: effect({ before: { runs: true } }) })],
      ['after missing a stage', confirmBody({ effect: effect({ after: { runs: true } }) })],
      ['quietMs.before absent', confirmBody({ effect: effect({ quietMs: { after: 1 } }) })],
      ['quietMs.after absent', confirmBody({ effect: effect({ quietMs: { before: 1 } }) })],
      ['mailOff absent', confirmBody({ effect: effect({ mailOff: undefined }) })],
    ];
    for (const [name, raw] of cases) expect(asStallConfirm(raw), name).toBeNull();
  });
});

describe('stallWriteRefusal — a confirm to show, a refusal whose detail is never empty, or an unconfirmed write', () => {
  it('reads a 409 with a readable confirm body as a confirm', () => {
    const body = confirmBody();
    expect(stallWriteRefusal(new ApiError(409, body))).toEqual({ kind: 'confirm', confirm: body });
  });

  it('reads a confirm body on any other status as a refusal: the status and the code must both match', () => {
    expect(stallWriteRefusal(new ApiError(400, confirmBody()))).toEqual({ kind: 'refused', detail: 'confirm-required' });
  });

  it('reads a 409 whose body is not a readable confirm as a refusal that still names something', () => {
    expect(stallWriteRefusal(new ApiError(409, confirmBody({ effectKey: undefined }))))
      .toEqual({ kind: 'refused', detail: 'confirm-required' });
  });

  it("takes the server's detail when it sends one", () => {
    const err = new ApiError(400, { ok: false, error: 'bad-request', detail: 'unknown key: loudness' });
    expect(stallWriteRefusal(err)).toEqual({ kind: 'refused', detail: 'unknown key: loudness' });
  });

  it("takes Fastify's message when the body has no detail: a 500 names the cause the route threw", () => {
    const cause = 'stall settings unreadable, nothing written: disk gone';
    const fastify500 = new ApiError(500, { statusCode: 500, error: 'Internal Server Error', message: cause });
    expect(stallWriteRefusal(fastify500)).toEqual({ kind: 'refused', detail: cause });
    const both = new ApiError(400, { ok: false, error: 'bad-request', detail: 'unknown key: loudness', message: 'other' });
    expect(stallWriteRefusal(both)).toEqual({ kind: 'refused', detail: 'unknown key: loudness' });
  });

  it("falls back to the error's own text when the body has neither: a blank detail or message, raw text", () => {
    const bare500 = new ApiError(500, { statusCode: 500, error: 'Internal Server Error', message: '  ' });
    expect(stallWriteRefusal(bare500)).toEqual({ kind: 'refused', detail: 'Internal Server Error' });
    const blank = new ApiError(400, { ok: false, error: 'bad-request', detail: '   ' });
    expect(stallWriteRefusal(blank)).toEqual({ kind: 'refused', detail: 'bad-request' });
    expect(stallWriteRefusal(new ApiError(502, 'Bad Gateway'))).toEqual({ kind: 'refused', detail: 'request failed (502)' });
  });

  it('reads a rejection that is not an ApiError as unconfirmed, never a refusal: the POST may have landed', () => {
    expect(stallWriteRefusal(new TypeError('Failed to fetch'))).toEqual({ kind: 'unconfirmed' });
    expect(stallWriteRefusal(new Error('aborted'))).toEqual({ kind: 'unconfirmed' });
  });
});

describe('useStallWatchView — the section\'s own read of /api/coord/stall-watch', () => {
  it('polls at mount and then every STALL_WATCH_POLL_MS (60 s, the stall sweep\'s cadence)', async () => {
    expect(STALL_WATCH_POLL_MS).toBe(60_000);
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValue(view());
    renderHook(() => useStallWatchView());
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(STALL_WATCH_POLL_MS - 1); });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('starts with nothing, then carries the first good answer; it has no refresh()', async () => {
    const good = view();
    vi.spyOn(api, 'stallWatch').mockResolvedValue(good);
    const { result } = renderHook(() => useStallWatchView());
    expect(result.current.view).toBeNull();
    expect(result.current.failure).toBeNull();
    expect(Object.keys(result.current).sort()).toEqual(['failure', 'reload', 'settle', 'view']);
    await act(async () => {});
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBeNull();
  });

  it('keeps the newest issued poll authoritative when an older request resolves or rejects last', async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<StallWatchView>();
    const second = Promise.withResolvers<StallWatchView>();
    const newer = view({ chosen: { level: 'log', quietMs: 'default', updatedAt: 2_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch')
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce(newer);

    const { result } = renderHook(() => useStallWatchView());
    await tick();
    await tick();
    expect(result.current.view).toBe(newer);

    await act(async () => { first.resolve(view()); await first.promise; });
    expect(result.current.view).toBe(newer);
    await act(async () => { second.reject(new TypeError('Failed to fetch')); await second.promise.catch(() => {}); });
    expect(result.current.view).toBe(newer);
    expect(result.current.failure).toBeNull();
  });

  it('P7: reads only 501 not-configured and 404 not-found as not-configured; every other pairing is failed', async () => {
    const cases: Array<[ApiError | TypeError, 'not-configured' | 'failed']> = [
      [new ApiError(501, { ok: false, error: 'not-configured' }), 'not-configured'],
      [new ApiError(404, { ok: false, error: 'not-found' }), 'not-configured'],
      [new ApiError(501, { ok: false, error: 'unsupported' }), 'failed'],
      [new ApiError(501, { ok: false, error: 'not-found' }), 'failed'],
      [new ApiError(404, { ok: false, error: 'not-configured' }), 'failed'],
      [new ApiError(404, 'Not Found'), 'failed'],
      [new ApiError(404, { message: 'Route GET:/api/coord/stall-watch not found', error: 'Not Found', statusCode: 404 }), 'failed'],
      [new ApiError(500, { ok: false, error: 'not-configured' }), 'failed'],
      [new TypeError('Failed to fetch'), 'failed'],
    ];
    for (const [err, want] of cases) {
      vi.spyOn(api, 'stallWatch').mockRejectedValue(err);
      const { result, unmount } = renderHook(() => useStallWatchView());
      await act(async () => {});
      expect(result.current, `${err instanceof ApiError ? err.status : 'network'} ${JSON.stringify((err as ApiError).body)}`)
        .toMatchObject({ view: null, failure: want });
      unmount();
      vi.restoreAllMocks();
    }
  });

  it('keeps the last good view across a failed, a malformed and a not-configured poll, and clears the failure on the next good one', async () => {
    vi.useFakeTimers();
    const good = view();
    const fresh = view({ chosen: { level: 'check', quietMs: 'default', updatedAt: 9_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch')
      .mockResolvedValueOnce(good)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ...good, quiet: {} } as unknown as StallWatchView)
      .mockRejectedValueOnce(new ApiError(404, { ok: false, error: 'not-found' }))
      .mockResolvedValueOnce(fresh);

    const { result } = renderHook(() => useStallWatchView());
    await act(async () => {});
    expect(result.current).toMatchObject({ view: good, failure: null });
    await tick();
    expect(result.current).toMatchObject({ view: good, failure: 'failed' });
    await tick();
    expect(result.current.view, 'a malformed answer is a failure, not a level').toBe(good);
    expect(result.current.failure).toBe('failed');
    await tick();
    expect(result.current.view, 'the hook keeps it; the section decides not-configured wins (P1b)').toBe(good);
    expect(result.current.failure).toBe('not-configured');
    await tick();
    expect(result.current).toMatchObject({ view: fresh, failure: null });
  });

  it('P4: settle installs a write\'s reply, and a poll issued before it that lands after it never overwrites it', async () => {
    const stale = Promise.withResolvers<StallWatchView>();
    const before = view();
    const written = view({ chosen: { level: 'alert', quietMs: 'default', updatedAt: 5_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch').mockResolvedValueOnce(before).mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useStallWatchView());
    await act(async () => {});
    expect(result.current.view).toBe(before);

    act(() => { result.current.reload(); });          // a poll in flight when the write's reply arrives
    act(() => { result.current.settle(written); });
    expect(result.current).toMatchObject({ view: written, failure: null });

    await act(async () => { stale.resolve(before); await stale.promise; });
    expect(result.current.view, 'the stale poll lands after the write and is dropped').toBe(written);
  });

  it('P4: a poll issued before settle that REJECTS after it reports no failure, and settle clears an earlier one', async () => {
    vi.useFakeTimers();
    const stale = Promise.withResolvers<StallWatchView>();
    const written = view({ chosen: { level: 'off', quietMs: 'default', updatedAt: 6_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useStallWatchView());
    await act(async () => {});
    expect(result.current).toMatchObject({ view: null, failure: 'failed' });

    await tick();                                       // the second poll is now in flight
    act(() => { result.current.settle(written); });
    expect(result.current).toMatchObject({ view: written, failure: null });

    await act(async () => { stale.reject(new ApiError(404, { ok: false, error: 'not-found' })); await stale.promise.catch(() => {}); });
    expect(result.current).toMatchObject({ view: written, failure: null });
  });

  it('a poll issued AFTER settle lands normally — settle moves the generation on, it does not stop it', async () => {
    vi.useFakeTimers();
    const written = view({ chosen: { level: 'alert', quietMs: 'default', updatedAt: 5_000, stored: 'row' } });
    const later = view({ chosen: { level: 'alert', quietMs: 3_600_000, updatedAt: 7_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch').mockResolvedValueOnce(view()).mockResolvedValueOnce(later);
    const { result } = renderHook(() => useStallWatchView());
    await act(async () => {});
    act(() => { result.current.settle(written); });
    await tick();
    expect(result.current).toMatchObject({ view: later, failure: null });
  });

  it('pollMs <= 0 is the injected mode — no request, no interval, no listener, reload does nothing, settle still installs', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValue(view());
    for (const pollMs of [0, -1]) {
      const { result, unmount } = renderHook(() => useStallWatchView(pollMs));
      setVisibility('visible');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(STALL_WATCH_POLL_MS * 3); });
      act(() => { result.current.reload(); });
      expect(spy, `pollMs ${pollMs}`).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({ view: null, failure: null });
      const written = view();
      act(() => { result.current.settle(written); });
      expect(result.current.view).toBe(written);
      unmount();
    }
  });

  it('re-polls once when the page becomes visible, and not when it is hidden', async () => {
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValue(view());
    renderHook(() => useStallWatchView());
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reload polls once now and lands its answer; reload and settle keep one identity across renders', async () => {
    const fresh = view({ chosen: { level: 'log', quietMs: 'default', updatedAt: 3_000, stored: 'row' } });
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValueOnce(view()).mockResolvedValueOnce(fresh);
    const { result, rerender } = renderHook(() => useStallWatchView());
    await act(async () => {});
    const { reload, settle } = result.current;
    await act(async () => { result.current.reload(); });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.view).toBe(fresh);
    rerender();
    expect(result.current.reload).toBe(reload);
    expect(result.current.settle).toBe(settle);
  });

  it('stops the interval and the visibility listener on unmount', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValue(view());
    const { unmount } = renderHook(() => useStallWatchView());
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(STALL_WATCH_POLL_MS * 2); });
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/use-stall-watch-view.test.tsx`

Expected (measured on the prototype): `Test Files  1 failed (1)`, `Tests  no tests`, with
`Error: Failed to resolve import "../src/fleet/useStallWatchView" from "test/use-stall-watch-view.test.tsx". Does the
file exist?`

- [ ] **Step 4: Add the two client methods to `pwa/src/lib/api.ts`**

(a) ≈5, in the `import type { … } from '../../../shared/api';` line (`grep -c` measured `1` in Step 1):

`StagedClip, UpdateChannel` → `StagedClip, StallWatchRequest, StallWatchView, UpdateChannel`

(b) ≈1046, after `setCoordCaps`' last line (`grep -c` measured `1` in Step 1). Before:

```ts
      postJsonOr<CoordCapsView | 'unreadable'>('/api/coord/caps', 'unreadable', next),
```

After:

```ts
      postJsonOr<CoordCapsView | 'unreadable'>('/api/coord/caps', 'unreadable', next),
    /** `GET /api/coord/stall-watch` (stall watch settings, design 2026-10-05 §10, §13): the Settings page's Stall
     *  watch section reads it through `useStallWatchView`, whose `asStallWatchView` is the wire guard, so the type here
     *  is what the server promises, not what arrived. 501 `not-configured` on a box with no coordination database, and
     *  404 `not-found` from an older server that lacks the route; the hook reads both as not available on this server
     *  (departure `older-server-404-reads-not-configured` (D-4035)). */
    stallWatch: () => getJson<StallWatchView>('/api/coord/stall-watch'),
    /** `POST /api/coord/stall-watch`: a PARTIAL, carrying only the field the operator moved, and `confirm` only when
     *  it sends back the key a 409 `confirm-required` answered with. The server decides whether a write needs a
     *  confirm (departure `server-decides-the-confirm` (D-4033)), so a 409 rejects with `ApiError` like every non-2xx,
     *  and the section reads its body through `stallWriteRefusal`. Session-gated when armed, open dark; no box token.
     *
     *  `postJsonOr`, not `postJson`, for `setCoordCaps`' reason (D-1150): after a write, "the answer could not be
     *  read" may well have stored the value, and is not "the request never happened". */
    setStallWatch: (body: StallWatchRequest) =>
      postJsonOr<StallWatchView | 'unreadable'>('/api/coord/stall-watch', 'unreadable', body),
```

- [ ] **Step 5: Create `pwa/src/fleet/useStallWatchView.ts`**

```ts
// The Stall watch section's own read of `GET /api/coord/stall-watch` (stall watch settings, design 2026-10-05 §13), and
// the three pure readers its writes need: the wire guard for the answer, the guard for a 409 `confirm-required` body,
// and the reading of a write's rejection.
//
// The hook is `useUpdatesView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD
// view and reports the failure beside it, the page becoming visible re-polls, and `pollMs <= 0` is the injected mode.
// It adds `settle(view)`, which installs a write's reply and moves the request generation on, so a poll issued before
// the write that lands after it cannot put the old choice back. That is why `issued` lives in a ref shared by `load`
// and `settle` rather than in the effect, as `useUpdatesView`'s does. It has no `refresh()`: the server decides the
// confirm at the write (departure `server-decides-the-confirm` (D-4033)), so nothing here needs a fresh read to decide on.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STALL_HELD_TEXT, STALL_LEVELS, STALL_NOTICE_TEXT, STALL_STAGES, STALL_STORED_STATES, isStallLevelChoice,
  type StallConfirmRequired, type StallLevel, type StallNextStep, type StallNoticeCount, type StallWatchEffective,
  type StallWatchStages, type StallWatchView, type StallWriteEffect,
} from '../../../shared/api';
import { ApiError, api, apiErrorText } from '../lib/api';

/** The read's cadence: the stall sweep's own (60 s), so a faster read would fetch the same answer again. */
export const STALL_WATCH_POLL_MS = 60_000;

/** Why the latest poll produced no view. `not-configured` is a server with no stall-watch settings to offer (a box with
 *  no coordination database, or an older build without the route), which the section renders INSTEAD of any view that
 *  landed; `failed` is a read that did not land, rendered beside the last good view. */
export type StallWatchFailure = 'not-configured' | 'failed';

export interface StallWatchPoll {
  /** The LAST GOOD answer: a later failure never clears it. */
  view: StallWatchView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: StallWatchFailure | null;
  /** One poll now, fire-and-forget, under the same newest-issued guard. A no-op in the injected mode. */
  reload: () => void;
  /** Install a write's reply (already through `asStallWatchView`) and drop every poll issued before it. */
  settle: (view: StallWatchView) => void;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
/** Membership by `includes`, never `in` or a map lookup: `'toString' in` any object literal is true. */
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/** Every key of `StallWatchStages`, spelled as a Record so a stage added to the type and not here is a compile error. */
const STAGE_FLAGS = Object.keys({
  runs: true, checks: true, alerts: true, busyDelivery: true, busyGate: true, wave2: true,
} satisfies Record<keyof StallWatchStages, true>);
/** Every key of `StallHeld`, derived from L0's held lines, which are typed `Record<keyof StallHeld, string>`. */
const HELD_FLAGS = Object.keys(STALL_HELD_TEXT);
const NOTICE_ROWS = Object.keys(STALL_NOTICE_TEXT) as Array<StallNoticeCount['row']>;
const LEVEL_READINGS: ReadonlyArray<StallLevel | 'custom'> = [...STALL_LEVELS, 'custom'];
const SOURCES = ['chosen', 'files', 'held'] as const;
/** Far past the shipped list (23 steps) and far short of a list the select could not render. A quiet range that would
 *  list more is not a readable answer: the section's select iterates it. */
const QUIET_STEPS_MAX = 1_000;

const isFlags = (v: unknown, keys: readonly string[]): boolean =>
  isObject(v) && keys.every((k) => typeof v[k] === 'boolean');

const isChosen = (v: unknown): v is StallWatchView['chosen'] =>
  isObject(v)
  && (v.level === 'unreadable' || isStallLevelChoice(v.level))
  && (v.quietMs === 'default' || v.quietMs === 'unreadable' || isNum(v.quietMs))
  && (v.updatedAt === null || isNum(v.updatedAt))
  && isOneOf(STALL_STORED_STATES, v.stored);

const isQuiet = (v: unknown): v is StallWatchView['quiet'] => {
  if (!isObject(v)) return false;
  const { effectiveMs, builtInMs, minMs, maxMs, stepMs, source } = v;
  return isNum(effectiveMs) && isNum(builtInMs) && isNum(minMs) && isNum(maxMs) && isNum(stepMs)
    && stepMs > 0 && minMs <= maxMs && (maxMs - minMs) / stepMs <= QUIET_STEPS_MAX
    && (source === 'chosen' || source === 'default');
};

const isFallback = (v: unknown): v is NonNullable<StallWatchView['fallback']> =>
  isObject(v) && isNum(v.at) && typeof v.reason === 'string';

const isNextStep = (v: unknown): v is StallNextStep =>
  isObject(v) && (v.kind === 'none' || v.kind === 'top'
    || (v.kind === 'step' && isOneOf(STALL_LEVELS, v.level)
      && Array.isArray(v.waitsOn) && v.waitsOn.every((s) => isOneOf(STALL_STAGES, s))));

const isNoticeCount = (v: unknown): v is StallNoticeCount =>
  isObject(v) && isOneOf(NOTICE_ROWS, v.row) && isCount(v.sent) && isCount(v.shadow);

/** `effective`, or null when it cannot be read. A malformed `next` or `filesExceed` is DROPPED, read as not stated
 *  exactly as a missing one is (§12), and counted for the one warning; everything else must be whole. */
function readEffective(v: unknown): { value: StallWatchEffective; dropped: number } | null {
  if (!isObject(v)) return null;
  if (v.measured === false) return { value: v as unknown as StallWatchEffective, dropped: 0 };
  if (v.measured !== true) return null;
  if (!isOneOf(LEVEL_READINGS, v.level) || !isOneOf(LEVEL_READINGS, v.files) || !isOneOf(SOURCES, v.source)) return null;
  if (!isFlags(v.stages, STAGE_FLAGS) || !isFlags(v.held, HELD_FLAGS)) return null;
  const badNext = v.next !== undefined && !isNextStep(v.next);
  const badExceed = v.filesExceed !== undefined && typeof v.filesExceed !== 'boolean';
  if (!badNext && !badExceed) return { value: v as unknown as StallWatchEffective, dropped: 0 };
  const kept: Record<string, unknown> = { ...v };
  if (badNext) delete kept.next;
  if (badExceed) delete kept.filesExceed;
  return { value: kept as unknown as StallWatchEffective, dropped: Number(badNext) + Number(badExceed) };
}

/** `notices`, or null when it cannot be read. A malformed `counts` element is dropped and counted. */
function readNotices(v: unknown): { value: StallWatchView['notices']; dropped: number } | null {
  if (!isObject(v)) return null;
  if (v.ok === false) return { value: { ok: false }, dropped: 0 };
  if (v.ok !== true || !isNum(v.since) || !isNum(v.windowMs) || !Array.isArray(v.counts)) return null;
  const counts = v.counts.filter(isNoticeCount);
  const dropped = v.counts.length - counts.length;
  return dropped === 0
    ? { value: v as unknown as StallWatchView['notices'], dropped }
    : { value: { ok: true, since: v.since, windowMs: v.windowMs, counts }, dropped };
}

/**
 * The wire guard: null unless the answer is a `StallWatchView` the section can render without throwing. A malformed
 * answer (a proxy's HTML, a stub `{}`, a level this build does not know) is a FAILURE the hook reports, never a level
 * it renders: an unknown level read as "Off" is the misreading §12's "unknown is never off" exists to refuse.
 *
 * Absence permits (§12): a missing `next` or `filesExceed` is not stated, and a missing `fallback` reads as none
 * stated. A present but malformed `next`, `filesExceed` or `counts` element is dropped, with exactly ONE
 * `console.warn` for the answer, as `asUpdatesView` does. A present but malformed `fallback` refuses the answer
 * instead: reading it as `null` would claim the choice applies when the server said it does not.
 *
 * A well-formed answer comes back as the same object; only a dropped part or a missing `fallback` rebuilds it.
 */
export function asStallWatchView(raw: unknown): StallWatchView | null {
  if (!isObject(raw)) return null;
  const { chosen, quiet, fallback } = raw;
  if (!isChosen(chosen) || !isQuiet(quiet)) return null;
  if (fallback !== undefined && fallback !== null && !isFallback(fallback)) return null;
  const effective = readEffective(raw.effective);
  const notices = readNotices(raw.notices);
  if (effective === null || notices === null) return null;
  const dropped = effective.dropped + notices.dropped;
  if (dropped === 0 && fallback !== undefined) return raw as unknown as StallWatchView;
  if (dropped > 0) {
    console.warn(`ccrc: /api/coord/stall-watch dropped ${dropped} malformed part(s) it could not read — the rest still rendered.`);
  }
  return { chosen, effective: effective.value, quiet, notices: notices.value, fallback: fallback ?? null };
}

const isStageList = (v: unknown): boolean => Array.isArray(v) && v.every((s) => isOneOf(STALL_STAGES, s));

const isWriteEffect = (v: unknown): v is StallWriteEffect => {
  if (!isObject(v)) return false;
  if (v.measured === false) return true;
  const { quietMs } = v;
  return v.measured === true && isStageList(v.turnsOn) && isStageList(v.turnsOff)
    && typeof v.leavesWave2 === 'boolean' && typeof v.heldByBox === 'boolean'
    && typeof v.quietLowered === 'boolean' && typeof v.filesExceed === 'boolean'
    && isFlags(v.before, STAGE_FLAGS) && isFlags(v.after, STAGE_FLAGS)
    && isObject(quietMs) && isNum(quietMs.before) && isNum(quietMs.after)
    && typeof v.mailOff === 'boolean';
};

/** The 409 body's guard: `error: 'confirm-required'`, a string `effectKey`, and an effect readable WHOLE. Nothing is
 *  dropped here: a sheet built from part of an effect would understate what the write does. Anything else is an
 *  ordinary refusal (`stallWriteRefusal`). */
export function asStallConfirm(raw: unknown): StallConfirmRequired | null {
  if (!isObject(raw) || raw.error !== 'confirm-required' || typeof raw.effectKey !== 'string') return null;
  return isWriteEffect(raw.effect) ? (raw as unknown as StallConfirmRequired) : null;
}

/** A write's rejection, read: the confirm the sheet shows, a refusal whose `detail` fills `STALL_CONFIRM_TEXT.refused`,
 *  or an answer that never arrived, which may have stored the write and so is never called a refusal. */
export type StallWriteRefusal =
  | { kind: 'confirm'; confirm: StallConfirmRequired }
  | { kind: 'refused'; detail: string }
  | { kind: 'unconfirmed' };

/** A string with something in it, trimmed; anything else is null. */
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/**
 * A confirm needs BOTH the 409 status and a body `asStallConfirm` reads, as not-configured needs both its status and
 * its code. Every other `ApiError` is a refusal: the server answered, so nothing was written. Its detail is the first
 * non-blank of the server's own `detail` (a 400 naming an unknown key), the body's `message` (Fastify's 500 carries the
 * cause the route threw there, such as a stored row that cannot be read), and the error's own text through
 * `apiErrorText` (a `confirm-required` body that does not read, a non-JSON body), so the refusal line never renders
 * with an empty slot.
 *
 * A rejection that is not an `ApiError` is a network failure, and the POST may have left before it: the write may
 * have landed. It is `unconfirmed`, never a refusal, so the section never says "Nothing was changed" about it.
 */
export function stallWriteRefusal(err: unknown): StallWriteRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed' };
  const confirm = err.status === 409 ? asStallConfirm(err.body) : null;
  if (confirm !== null) return { kind: 'confirm', confirm };
  const body = isObject(err.body) ? err.body : {};
  return { kind: 'refused', detail: nonBlank(body.detail) ?? nonBlank(body.message) ?? apiErrorText(err) };
}

/** The two answers that mean "not available on this server", each status with its own code: 501 `not-configured` (no
 *  coordination database) and 404 `not-found` (the server's `/api/*` not-found answer, an older build that lacks the
 *  route; departure `older-server-404-reads-not-configured` (D-4035)). A 404 or 501 carrying any other body is a read
 *  that failed: folding it in would overload one value with two conditions the section renders differently. */
const NOT_CONFIGURED_ANSWERS: ReadonlyArray<readonly [number, string]> = [[501, 'not-configured'], [404, 'not-found']];

const failureOf = (err: unknown): StallWatchFailure =>
  err instanceof ApiError && isObject(err.body)
    && NOT_CONFIGURED_ANSWERS.some(([status, code]) => err.status === status && (err.body as { error?: unknown }).error === code)
    ? 'not-configured'
    : 'failed';

/**
 * `GET /api/coord/stall-watch` every `pollMs` and whenever the page becomes visible. The newest ISSUED request is
 * authoritative: an older in-flight answer, good or bad, never overwrites a newer request's, nor a settled write's.
 * State is set functionally, so a failure keeps whatever view the previous commit held. `pollMs <= 0` is the injected
 * mode: no request, no interval, no listener; `settle` still installs.
 */
export function useStallWatchView(pollMs: number = STALL_WATCH_POLL_MS): StallWatchPoll {
  const [state, setState] = useState<{ view: StallWatchView | null; failure: StallWatchFailure | null }>(
    { view: null, failure: null });
  const issued = useRef(0);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (pollMs <= 0) return undefined;   // an injected consumer never polls
    let live = true;
    const load = (): void => {
      const mine = ++issued.current;
      void api.stallWatch().then(
        (raw) => {
          if (!live || mine !== issued.current) return;
          const view = asStallWatchView(raw);
          setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
        },
        (err: unknown) => {
          if (!live || mine !== issued.current) return;
          const failure = failureOf(err);
          setState((prev) => ({ view: prev.view, failure }));
        },
      );
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') load();
    };
    loadRef.current = load;
    load();
    const t = setInterval(load, pollMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      loadRef.current = () => {};
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs]);

  const reload = useCallback(() => { loadRef.current(); }, []);
  const settle = useCallback((view: StallWatchView) => {
    issued.current += 1;   // every poll issued before this write now lands stale
    setState({ view, failure: null });
  }, []);
  return { view: state.view, failure: state.failure, reload, settle };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/use-stall-watch-view.test.tsx`

Expected (measured): `Test Files  1 passed (1)`, `Tests  31 passed (31)`.

- [ ] **Step 7: Typecheck**

Run: `cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/tsc --noEmit -p .`

Expected (measured): no output, exit 0. The PWA's `tsconfig.json` includes `src`, `test` and `../shared`, so this covers
the new test file too. No server file changes, so the server's two typechecks are not affected.

- [ ] **Step 8: Stage, then the mutation table**

Stage first, so each mutation is restored from the index:

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/lib/api.ts pwa/src/fleet/useStallWatchView.ts pwa/test/use-stall-watch-view.test.tsx
```

For each row, replace the quoted text with the mutation, run
`cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/use-stall-watch-view.test.tsx`,
record the red, then restore with `git checkout -- <file>`. The control is Step 6's `31 passed`. `H` is
`pwa/src/fleet/useStallWatchView.ts`; `A` is `pwa/src/lib/api.ts`. Each quoted text occurs exactly once in its file,
except G1's and G2's, which occur twice (measured `2`): find each by the arm its row names, `(raw) => {` or
`(err: unknown) => {`, each of which occurs once. A row whose mutation text needs no whole line quotes the fragment it
replaces.

| # | Guard | File: mutation | Red (measured), failing rows |
|---|---|---|---|
| P4 | settle wins over a stale poll | H: delete the line `    issued.current += 1;   // every poll issued before this write now lands stale` | `2 failed`: "P4: a poll issued before settle that REJECTS after it reports no failure, and settle clears an earlier one"; "P4: settle installs a write's reply, and a poll issued before it that lands after it never overwrites it" |
| P7a | only 404 `not-found` reads not-configured | H: `    && NOT_CONFIGURED_ANSWERS.some(([status, code]) => err.status === status && (err.body as { error?: unknown }).error === code)` → `    && (err.status === 404 \|\| NOT_CONFIGURED_ANSWERS.some(([status, code]) => err.status === status && (err.body as { error?: unknown }).error === code))` | `1 failed`: "P7: reads only 501 not-configured and 404 not-found as not-configured; every other pairing is failed" |
| P7b | only 501 `not-configured` reads not-configured | H: `    && NOT_CONFIGURED_ANSWERS.some(([status, code]) => err.status === status && (err.body as { error?: unknown }).error === code)` → `    && (err.status === 501 \|\| NOT_CONFIGURED_ANSWERS.some(([status, code]) => err.status === status && (err.body as { error?: unknown }).error === code))` | `1 failed`: "P7: reads only 501 not-configured and 404 not-found as not-configured; every other pairing is failed" |
| P7c | 501 `not-configured` reads not-configured | H: `[[501, 'not-configured'], [404, 'not-found']]` → `[[404, 'not-found']]` | `1 failed`: "P7: reads only 501 not-configured and 404 not-found as not-configured; every other pairing is failed" |
| G1 | newest issued wins, answer arm | H: in the `(raw) => {` arm, `          if (!live \|\| mine !== issued.current) return;` → `          if (!live) return;` | `2 failed`: "P4: settle installs a write's reply, and a poll issued before it that lands after it never overwrites it"; "keeps the newest issued poll authoritative when an older request resolves or rejects last" |
| G2 | newest issued wins, failure arm | H: in the `(err: unknown) => {` arm, `          if (!live \|\| mine !== issued.current) return;` → `          if (!live) return;` | `2 failed`: "P4: a poll issued before settle that REJECTS after it reports no failure, and settle clears an earlier one"; "keeps the newest issued poll authoritative when an older request resolves or rejects last" |
| G3 | a missing `fallback` permits | H: `if (fallback !== undefined && fallback !== null && !isFallback(fallback)) return null;` → `if (fallback !== null && !isFallback(fallback)) return null;` | `1 failed`: "reads a MISSING fallback as none stated, with no warning; refuses a MALFORMED one" |
| G4 | a malformed `fallback` refuses | H: delete the line `  if (fallback !== undefined && fallback !== null && !isFallback(fallback)) return null;` | `1 failed`: "reads a MISSING fallback as none stated, with no warning; refuses a MALFORMED one" |
| G5 | an unknown effective level is a failure, never a level | H: `if (!isOneOf(LEVEL_READINGS, v.level) \|\|` → `if (typeof v.level !== 'string' \|\|` | `1 failed`: "refuses a non-object, and every missing or malformed required part" |
| G6 | `chosen.level` is a choice | H: `(v.level === 'unreadable' \|\| isStallLevelChoice(v.level))` → `(typeof v.level === 'string')` | `1 failed`: "refuses a non-object, and every missing or malformed required part" |
| G7 | a missing `next` permits | H: `const badNext = v.next !== undefined && !isNextStep(v.next);` → `const badNext = !isNextStep(v.next);` | `1 failed`: "reads a missing next or filesExceed as not stated, passing the answer through unchanged" |
| G8 | a malformed `next` is dropped | H: `const badNext = v.next !== undefined && !isNextStep(v.next);` → `const badNext = false;` | `1 failed`: "drops a malformed next or filesExceed as not stated, keeps the rest, and warns exactly once" |
| G9 | malformed counts are dropped | H: `v.counts.filter(isNoticeCount)` → `v.counts.filter(() => true)` | `1 failed`: "drops a malformed counts element, keeps the others, and warns exactly once" |
| G10 | a quiet step is positive | H: `    && stepMs > 0 && minMs` → `    && minMs` | `1 failed`: "refuses a non-object, and every missing or malformed required part" |
| G11 | a quiet range can be listed | H: delete ` && (maxMs - minMs) / stepMs <= QUIET_STEPS_MAX` | `1 failed`: "refuses a non-object, and every missing or malformed required part" |
| G12 | a confirm is `confirm-required` | H: delete `raw.error !== 'confirm-required' \|\| ` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G13 | a confirm's stages are known | H: `const isStageList = (v: unknown): boolean => Array.isArray(v) && v.every((s) => isOneOf(STALL_STAGES, s));` → `const isStageList = (v: unknown): boolean => Array.isArray(v);` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G14 | a confirm needs the 409 | H: `const confirm = err.status === 409 ? asStallConfirm(err.body) : null;` → `const confirm = asStallConfirm(err.body);` | `1 failed`: "reads a confirm body on any other status as a refusal: the status and the code must both match" |
| G15 | the refusal detail is never blank | H: `const nonBlank = (v: unknown): string \| null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);` → `const nonBlank = (v: unknown): string \| null => (typeof v === 'string' ? v : null);` | `1 failed`: "falls back to the error's own text when the body has neither: a blank detail or message, raw text" |
| G16 | a write's unreadable 2xx degrades | A: `      postJsonOr<StallWatchView \| 'unreadable'>('/api/coord/stall-watch', 'unreadable', body),` → `      postJson<StallWatchView \| 'unreadable'>('/api/coord/stall-watch', body),` | `1 failed`: "answers `unreadable` when a 2xx write comes back unparseable — the write may have landed (D-1150)" |
| G17 | a 500's `message` names the cause | H: `nonBlank(body.detail) ?? nonBlank(body.message) ?? apiErrorText(err)` → `nonBlank(body.detail) ?? apiErrorText(err)` | `1 failed`: "takes Fastify's message when the body has no detail: a 500 names the cause the route threw" |
| G18 | a network failure is unconfirmed, never refused | H: `  if (!(err instanceof ApiError)) return { kind: 'unconfirmed' };` → `  if (!(err instanceof ApiError)) return { kind: 'refused', detail: apiErrorText(err) };` | `1 failed`: "reads a rejection that is not an ApiError as unconfirmed, never a refusal: the POST may have landed" |
| G19 | the confirm's key is a string | H: `raw.error !== 'confirm-required' \|\| typeof raw.effectKey !== 'string'` → `raw.error !== 'confirm-required'` | `2 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole"; "reads a 409 whose body is not a readable confirm as a refusal that still names something" |
| G20 | the effect's `leavesWave2` | H: `    && typeof v.leavesWave2 === 'boolean' && typeof v.heldByBox === 'boolean'` → `    && typeof v.heldByBox === 'boolean'` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G21 | the effect's `heldByBox` | H: `    && typeof v.leavesWave2 === 'boolean' && typeof v.heldByBox === 'boolean'` → `    && typeof v.leavesWave2 === 'boolean'` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G22 | the effect's `quietLowered` | H: `    && typeof v.quietLowered === 'boolean' && typeof v.filesExceed === 'boolean'` → `    && typeof v.filesExceed === 'boolean'` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G23 | the effect's `filesExceed` | H: `    && typeof v.quietLowered === 'boolean' && typeof v.filesExceed === 'boolean'` → `    && typeof v.quietLowered === 'boolean'` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G24 | the effect's `before` stages | H: `    && isFlags(v.before, STAGE_FLAGS) && isFlags(v.after, STAGE_FLAGS)` → `    && isFlags(v.after, STAGE_FLAGS)` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G25 | the effect's `after` stages | H: `    && isFlags(v.before, STAGE_FLAGS) && isFlags(v.after, STAGE_FLAGS)` → `    && isFlags(v.before, STAGE_FLAGS)` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G26 | the effect's `quietMs.before` | H: `    && isObject(quietMs) && isNum(quietMs.before) && isNum(quietMs.after)` → `    && isObject(quietMs) && isNum(quietMs.after)` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G27 | the effect's `quietMs.after` | H: `    && isObject(quietMs) && isNum(quietMs.before) && isNum(quietMs.after)` → `    && isObject(quietMs) && isNum(quietMs.before)` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G28 | the effect's `mailOff` | H: `    && typeof v.mailOff === 'boolean';` → `    && true;` | `1 failed`: "refuses another code, a missing or non-string key, and any effect it cannot read whole" |
| G29 | `chosen.updatedAt` | H: delete the line `  && (v.updatedAt === null \|\| isNum(v.updatedAt))` | `1 failed`: "refuses a non-object, and every missing or malformed required part" |
| G30 | `chosen.stored` | H: `  && isOneOf(STALL_STORED_STATES, v.stored);` → `  && true;` | `1 failed`: "refuses a non-object, and every missing or malformed required part" |
| G31 | the counts' `since` | H: `if (v.ok !== true \|\| !isNum(v.since) \|\| !isNum(v.windowMs)` → `if (v.ok !== true \|\| !isNum(v.windowMs)` | `1 failed`: "refuses a non-object, and every missing or malformed required part" |
| G32 | the counts' `windowMs` | H: `if (v.ok !== true \|\| !isNum(v.since) \|\| !isNum(v.windowMs)` → `if (v.ok !== true \|\| !isNum(v.since)` | `1 failed`: "refuses a non-object, and every missing or malformed required part" |
| G33 | only a visible page re-polls | H: `      if (document.visibilityState === 'visible') load();` → `      load();` | `1 failed`: "re-polls once when the page becomes visible, and not when it is hidden" |

Every row measured `30 passed (31)` beside its one failure, or `29 passed (31)` beside its two. Then:

```bash
cd "$(git rev-parse --show-toplevel)" && git status --short
```

Expected: exactly `M  pwa/src/lib/api.ts`, `A  pwa/src/fleet/useStallWatchView.ts`, `A  pwa/test/use-stall-watch-view.test.tsx`,
all staged, nothing unstaged.

- [ ] **Step 9: The regression suites**

Each line is its own foreground Bash call (timeout at least 600000 ms):

```bash
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/api.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/settings-screen.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/caps-control.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run | grep -E '^ +(Test Files|Tests) '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts | grep -E '^ +Tests '
```

Expected: `102 passed (102)`, `30 passed (30)`, `132 passed (132)`, `16 passed (16)` (measured at the first
prototype; Task 1's fix round touches none of these files); the whole PWA suite `106` files and `3268` tests (derived:
the measured 3320 after Task 4, less Task 2's 1 row and Task 3's 51); `single-definition` `274 passed (274)` (it walks
`pwa/src`, so it sees the new file; measured at `825fd1965`). On the first prototype the whole-suite run under load
showed `10 failed | 3256 passed (3266)`, all of them 5-second test timeouts in `contrast.test.ts` (9) and
`swap-sheet.test.tsx` (1), neither of which this task touches; alone, with `--testTimeout=240000`, they measured
`256 passed (256)` and `44 passed (44)`. Re-run any such red alone that way before calling it real.

- [ ] **Step 10: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/lib/api.ts pwa/src/fleet/useStallWatchView.ts pwa/test/use-stall-watch-view.test.tsx
git commit -m "$(cat <<'MSG'
feat(pwa): the stall-watch API client and the useStallWatchView hook

api.stallWatch and api.setStallWatch, the latter through postJsonOr for
setCoordCaps' reason (D-1150): an unreadable 2xx may have stored the
value. A 409 rejects with ApiError like every non-2xx; the server
decides the confirm (server-decides-the-confirm (D-4033)), and
stallWriteRefusal reads the rejection as a confirm to show, a refusal
whose detail is never blank (the server's detail, else the 500 body's
message, else the error's own text), or, for a network failure that may
have landed, an unconfirmed write that is never called a refusal.

useStallWatchView is useUpdatesView's shape plus settle, with no
refresh: settle installs a write's reply and bumps the shared request
generation, so a poll issued before the write cannot put the old choice
back. Only 501 not-configured and 404 not-found read not-configured,
each status with its own code (older-server-404-reads-not-configured
(D-4035)). asStallWatchView refuses a malformed answer, reads a missing
next, filesExceed or fallback as not stated, drops a malformed next,
filesExceed or counts element with one warning, and refuses a malformed
fallback; asStallConfirm accepts a 409 body only whole.
MSG
)"
```

---

### Task 2: QuickConfirm takes several consequence lines

**Model routing:** `sonnet`, effort `medium`: a two-file transcription, one new row and a mutation table.

**Files:**
- Modify: `pwa/src/components/QuickConfirm.tsx`: the header comment (≈1–4), `QuickConfirmProps.consequence` (≈11), and
  `QuickConfirm`'s body (≈25–28: the `return (` and the one `<p className="qc-consequence">`).
- Modify: `pwa/test/primitives.test.tsx`: the `QuickConfirm` describe (≈267–300), one new row (P8) at its foot.
- Test: `pwa/test/primitives.test.tsx`.

**Interfaces:**
- Consumes: nothing new. `Sheet` (`pwa/src/components/Sheet.tsx`) and `primitives.css`'s `.qc-consequence` (≈283)
  and `.qc-actions`, unchanged.
- Produces:

```ts
export interface QuickConfirmProps {
  title: string;
  consequence: string | string[];
  confirmLabel: string;
  onConfirm: () => void;
  open: boolean;
  onClose: () => void;
}
export function QuickConfirm(props: QuickConfirmProps): ReactNode;
```

  A string renders one `<p className="qc-consequence">`, as before. A `string[]` renders one
  `<p className="qc-consequence">` per element, in order; `[]` renders none and leaves the title and both buttons.
  The stall watch section's sheet (a later task) passes `stallConfirmLines(effect, request, builtInMs)` here. Every
  existing caller (`FleetScreen.tsx` ≈1011, `SessionActionsSheet.tsx` ≈552 and ≈566, `SwapSheet.tsx` ≈640,
  `FleetHostBanner.tsx` ≈142, `PrSheet.tsx` ≈369) passes a string and is unchanged.

- [ ] **Step 1: Re-anchor**

```bash
cd "$(git rev-parse --show-toplevel)/pwa"
grep -c '^// toast). Cancel and scrim both just close.$' src/components/QuickConfirm.tsx
grep -c '^  consequence: string;$' src/components/QuickConfirm.tsx
grep -c '^}: QuickConfirmProps): ReactNode {$' src/components/QuickConfirm.tsx
grep -c '^  return ($' src/components/QuickConfirm.tsx
grep -c '^      <p className="qc-consequence">{consequence}</p>$' src/components/QuickConfirm.tsx
grep -n '^// — Toast —$' test/primitives.test.tsx
```

Expected (measured at 77f8d63a5, and unchanged by W2 Task 1): `1` for each of the five `grep -c`; one line for the
`grep -n`, ≈302. The two lines above it are blank and `});` (≈300, the `QuickConfirm` describe's close); the line
above that is `  });` (≈299, the close of `shows title, consequence sentence, and closes after confirming`). If any
differs, `main` moved: find the text by content and say so.

- [ ] **Step 2: Write the failing test**

In `pwa/test/primitives.test.tsx`, between the `  });` at ≈299 and the `});` at ≈300 (the describe's last row's close
and the describe's own close, just above `// — Toast —`), insert this block. It begins with one blank line:

```tsx

  // Stall watch settings W2 (spec 2026-10-05 §13, P8; `confirm-on-stage-diff`
  // (D-4034)): the sheet built from the server's write effect says one thing
  // per line, so `consequence` takes a list and renders a paragraph per line,
  // in order. A string is still one paragraph; an empty list renders none and
  // leaves the actions.
  it('renders one consequence paragraph per line of a list, and one for a string', () => {
    const lines = () => [...document.querySelectorAll('p.qc-consequence')].map((p) => p.textContent);
    const { rerender } = render(
      <QuickConfirm {...props} consequence={['Checks turn on.', 'Busy delivery stops.']} open onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(lines()).toEqual(['Checks turn on.', 'Busy delivery stops.']);

    rerender(<QuickConfirm {...props} open onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(lines()).toEqual([props.consequence]);

    rerender(<QuickConfirm {...props} consequence={[]} open onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(lines()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Stop session' })).toBeInTheDocument();
  });
```

No import changes: `render`, `screen`, `vi` and `QuickConfirm` are already imported (≈1–9), and `props` is the
describe's own fixture (≈268).

- [ ] **Step 3: Run it to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/primitives.test.tsx`

Expected (measured on the prototype): `Tests  1 failed | 21 passed (22)`. The one:
`QuickConfirm > renders one consequence paragraph per line of a list, and one for a string`, with

```
- Expected
+ Received

  [
-   "Checks turn on.",
-   "Busy delivery stops.",
+   "Checks turn on.Busy delivery stops.",
  ]
```

React renders the array as children of the one `<p>`, so vitest goes red at runtime. `tsc` would refuse the array
too, but vitest does not typecheck, so the runtime red is the one this step measures.

- [ ] **Step 4: Widen `consequence`**

Three edits in `pwa/src/components/QuickConfirm.tsx`. Each quoted "before" line occurs exactly once in the file
(Step 1's `grep -c`).

(a) ≈4, the header comment's last line:
`// toast). Cancel and scrim both just close.` → these six lines (that line kept, then five new):

```tsx
// toast). Cancel and scrim both just close.
//
// `consequence` is one line or several: a list renders one paragraph per line,
// in order, so the stall watch's sheet, built from the server's write effect,
// says each thing the write turns on or off on its own line (spec 2026-10-05
// §13, `confirm-on-stage-diff` (D-4034)). Every string caller is unchanged.
```

(b) ≈11:
`  consequence: string;` → `  consequence: string | string[];`

(c) ≈25–28, the body's head. Before (each line once in the file):

```tsx
}: QuickConfirmProps): ReactNode {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="qc-consequence">{consequence}</p>
```

After:

```tsx
}: QuickConfirmProps): ReactNode {
  const lines = typeof consequence === 'string' ? [consequence] : consequence;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {lines.map((line, i) => (
        <p key={i} className="qc-consequence">
          {line}
        </p>
      ))}
```

The `qc-actions` block below is untouched. The whole file after the edit reads:

```tsx
// QuickConfirm — the confirm-with-consequence-sentence sheet used by the
// release, forget and move-account flows. The consequence line does the explaining in plain
// language; confirming closes the sheet (callers surface progress/failure via
// toast). Cancel and scrim both just close.
//
// `consequence` is one line or several: a list renders one paragraph per line,
// in order, so the stall watch's sheet, built from the server's write effect,
// says each thing the write turns on or off on its own line (spec 2026-10-05
// §13, `confirm-on-stage-diff` (D-4034)). Every string caller is unchanged.
import type { ReactNode } from 'react';
import { Sheet } from './Sheet';
import './primitives.css';

export interface QuickConfirmProps {
  title: string;
  consequence: string | string[];
  confirmLabel: string;
  onConfirm: () => void;
  open: boolean;
  onClose: () => void;
}

export function QuickConfirm({
  title,
  consequence,
  confirmLabel,
  onConfirm,
  open,
  onClose,
}: QuickConfirmProps): ReactNode {
  const lines = typeof consequence === 'string' ? [consequence] : consequence;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {lines.map((line, i) => (
        <p key={i} className="qc-consequence">
          {line}
        </p>
      ))}
      <div className="qc-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
```

The index key is safe here: the list is replaced whole on every render and never reordered, and two equal lines must
both render. No CSS changes: each line keeps `.qc-consequence`'s own `margin-bottom` (spec §13: "with the same
class").

- [ ] **Step 5: Run it to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/primitives.test.tsx`

Expected (measured): `Tests  22 passed (22)`.

- [ ] **Step 6: Typecheck**

Run: `cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/tsc --noEmit -p .`

Expected (measured): no output, rc 0. `pwa/tsconfig.json`'s `include` is `["src", "test", "vite.config.ts",
"../shared"]`, so this one run checks the new row's array literal and every string caller.

- [ ] **Step 7: The regression suites**

Every test file that imports `QuickConfirm` or a component that renders one (`FleetScreen`, `SessionActionsSheet`,
`SwapSheet`, `FleetHostBanner`, `PrSheet`), measured by
`grep -lE "from '\.\./src/(screens/FleetScreen|fleet/SessionActionsSheet|fleet/SwapSheet|fleet/FleetHostBanner|session/PrSheet|components/QuickConfirm)'" test/*.tsx test/*.ts`:

Each line is its own foreground Bash call (timeout at least 600000 ms), one file per command:

```bash
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/account-pool-chip.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/archive-all-guard.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/auth-door.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/coord-banner.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/fleet-class-chooser.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/fleet-host-banner.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/lifecycle-ui.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/offline.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/primitives.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/pr-sheet.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/session-actions-sheet.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/substrate-banner.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/swap-sheet.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/tap-targets.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run | grep -E '^ +(Test Files|Tests) '
```

Expected: the seventeen files' `Tests` lines sum to `549 passed` (measured at the first prototype as one 17-file
batch, `Test Files  17 passed (17)`, `Tests  549 passed (549)`; no file there changes in W2's fix round); and the
whole PWA suite `Test Files  106 passed (106)`, `Tests  3269 passed (3269)` on a quiet box (derived: the measured
3320 after Task 4, less Task 3's 51 rows). Measured on the prototype at load average
≈42, two whole-suite runs went `4 failed | 3263 passed` and `2 failed | 3265 passed`, each a different set among
`contrast.test.ts` (two `the gate fails a mutated tree` rows), `fleet-screen.test.tsx` (`opens the roster-derived
pool picker from a project card`) and `session-pickers.test.tsx` (two rows); each file, re-run alone with
`--testTimeout=240000`, was green (`256 passed (256)`, `98 passed (98)`, `30 passed (30)`), and `fleet-screen` was
green in the 17-file batch. A red there that does not clear alone is real: stop and report it.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/components/QuickConfirm.tsx pwa/test/primitives.test.tsx
git commit -m "$(cat <<'MSG'
feat(pwa): QuickConfirm takes several consequence lines

`consequence` widens to `string | string[]`: a list renders one
`<p className="qc-consequence">` per line, in order; a string is one
paragraph, as before, and an empty list renders none and leaves the
actions. The stall watch's sheet, built from the server's write effect,
says each thing a write turns on or off on its own line (spec 2026-10-05
§13, `confirm-on-stage-diff` (D-4034)). Every existing caller passes a
string and is unchanged.

P8 in primitives.test.tsx pins it: joining the lines into one string,
passing the array through one paragraph, or spreading a string as a list
each red it.
MSG
)"
```

Expected: `git diff --numstat HEAD~1` reads `12	2	pwa/src/components/QuickConfirm.tsx` and
`20	0	pwa/test/primitives.test.tsx`.

- [ ] **Step 9: The mutation table, on the committed tree**

Apply each mutation to `pwa/src/components/QuickConfirm.tsx` alone, run
`./node_modules/.bin/vitest run test/primitives.test.tsx` from `pwa/`, record the summary, and restore the file with
`git checkout -- pwa/src/components/QuickConfirm.tsx`. `git status --short` must be empty after the last restore.
"P8 row" is `QuickConfirm > renders one consequence paragraph per line of a list, and one for a string`.

| # | Guard | Mutation | Red in | Expected (measured) |
|---|---|---|---|---|
| P8a | a list renders a paragraph per line | replace the `lines.map(…)` block with `      <p className="qc-consequence">{lines.join(' ')}</p>` | primitives | `1 failed \| 21 passed (22)`: P8 row |
| P8b | the same, against the 77f8d63a5 render | replace the `lines.map(…)` block with `      <p className="qc-consequence">{consequence}</p>` | primitives | `1 failed \| 21 passed (22)`: P8 row |
| P8c | a string stays one paragraph | replace the `const lines = …` line with `  const lines = [...consequence];` | primitives | `2 failed \| 20 passed (22)`: P8 row, and `QuickConfirm > fires onConfirm only via its confirm button` |

The control is Step 5's green, `22 passed (22)`, on the unmutated commit.

---

### Task 3: The Stall watch section on the Settings page

**Model routing:** `sonnet`, effort `high`: a new component transcribed from this section, its rows, and a mutation
table.

**Files:**
- Create: `pwa/src/screens/StallWatchSection.tsx` (399 lines): `fillStallText`, `quietText`, `StallQuietChoice`,
  `quietChoices`, `StallNowTone`, `StallNowLine`, `stallNowLines`, `stallNextLines`, `stallCountLine`,
  `stallConfirmTitle`, `stallConfirmLines`, `StallWatchSection`, and the private `StallWatchBody`. It sits beside
  `SettingsScreen.tsx` in `pwa/src/screens/`, where the screen's sections live: measured at 77f8d63a5,
  `NotificationsSection` (≈:615) and `UpdatesSection` (≈:699) are both in `SettingsScreen.tsx`, and no section has a
  file of its own yet.
- Modify: `pwa/src/screens/SettingsScreen.tsx`: the header comment (≈:1–7, "Two sections and no more"); one import
  after `NotificationBell`'s (≈:21); the Notifications block comment (≈:554, "The PHONE-PUSH toggle"); the row label
  (≈:650); the ONE-poll comment in `SettingsScreen` (≈:677–678); the render (≈:691, after `<NotificationsSection …/>`).
- Modify: `pwa/test/settings-screen.test.tsx`: the import block (after ≈:33, `import { declValue, ruleIn } from
  './cssRule';`); the label pin (≈:1771); three new `describe`s at the end of the file (after ≈:1896).
- Test: `pwa/test/settings-screen.test.tsx`.

**Interfaces:**
- Consumes, from L0 `shared/api.ts` (W1 Task 1, appended after `MAIL_REPLAY_MS`): `STALL_LEVEL_TEXT`, `StallLevel`,
  `STALL_LEVELS`, `StallLevelChoice`, `STALL_STAGE_TEXT`, `StallStage`, `STALL_STAGES`, `StallWatchStages`,
  `StallHeld`, `StallWatchEffective`, `StallWriteEffect`, `StallConfirmRequired`, `STALL_NOTICE_TEXT`,
  `StallNoticeCount`, `StallWatchView`, `StallWatchRequest`, and the section texts `STALL_FOLLOW_LABEL`,
  `STALL_SOURCE_TEXT`, `STALL_HELD_REASON`, `STALL_HELD_TEXT`, `STALL_BUSY_GATE_TEXT`, `STALL_BUSY_GATE_OFF_TEXT`,
  `STALL_HAZARD_TEXT`, `STALL_FILES_EXCEED_TEXT`, `STALL_STORED_TEXT`, `STALL_FALLBACK_TEXT`,
  `STALL_NOT_AVAILABLE_TEXT`, `STALL_NEXT_TEXT`, `STALL_QUIET_NOTE`, `STALL_CONFIRM_TEXT`, `STALL_RUNLESS_FOOTNOTE`,
  `STALL_SECTION_TEXT` (with `builtInOption` and `theySayUnknown`).
- Consumes, from Task 1 (`pwa/src/fleet/useStallWatchView.ts`, `pwa/src/lib/api.ts`):
  `useStallWatchView(pollMs?: number): StallWatchPoll` with `StallWatchPoll { view: StallWatchView | null; failure:
  StallWatchFailure | null; reload: () => void; settle: (view: StallWatchView) => void }`;
  `asStallWatchView(raw: unknown): StallWatchView | null`; `stallWriteRefusal(err: unknown): StallWriteRefusal`, where
  `StallWriteRefusal = { kind: 'confirm'; confirm: StallConfirmRequired } | { kind: 'refused'; detail: string } |
  { kind: 'unconfirmed' }`, `detail` is never blank, and `unconfirmed` is a rejection that is not an `ApiError`; `api.stallWatch: () => Promise<StallWatchView>`; `api.setStallWatch: (body:
  StallWatchRequest) => Promise<StallWatchView | 'unreadable'>`.
- Consumes, from Task 2 (`pwa/src/components/QuickConfirm.tsx`): `QuickConfirm(props: QuickConfirmProps)` with
  `consequence: string | string[]`; Confirm runs `onConfirm(); onClose();` in that order.
- Consumes `UNCONFIRMED_TEXT`. Since fix round 1 (R24 F4) the text lives in `pwa/src/screens/settingsText.ts`;
  `SettingsScreen.tsx` re-exports it and `StallWatchSection.tsx` imports it from `settingsText.ts`, so the two screens
  do not import each other and there is no import cycle. (The first cut imported it from `SettingsScreen.tsx`, a cycle
  that was safe only because the constant is read inside a write's handler, never while either module evaluates.)
- Produces (`pwa/src/screens/StallWatchSection.tsx`):

```ts
export function fillStallText(text: string, slots: Readonly<Record<string, string>>): string;
export function quietText(ms: number): string;
export interface StallQuietChoice { value: number | 'default'; label: string }
export function quietChoices(view: StallWatchView): StallQuietChoice[];
export type StallNowTone = 'head' | 'note' | 'warn';
export interface StallNowLine { text: string; tone: StallNowTone }
export function stallNowLines(view: StallWatchView): StallNowLine[];
export function stallNextLines(effective: StallWatchEffective): { lead: string; waitsOn: string[] } | null;
export function stallCountLine(count: StallNoticeCount): string;
export function stallConfirmTitle(request: StallWatchRequest, builtInMs: number): string;
export function stallConfirmLines(effect: StallWriteEffect, request: StallWatchRequest, builtInMs: number): string[];
export function StallWatchSection(): ReactNode;
```

**Choices this task makes (spec §13, §20):**
- **The sheet's order** is §13's, not §15's "Busy delivery armed by file" row (§20's first residue item): the
  target's `does` first, then one line per `turnsOn` stage, then the `stops` lines in §5.1 order, then the held line,
  what falls due, the quiet lines and the files-exceed line. §15's "listed Busy delivery stops first" is read as
  "listed it", not as an order.
- **A quiet-time raise opens no sheet** (§20's second item: a quiet time raised but still below the built-in, at Log,
  or at Everything with alerts off, would open a sheet with a title and no body lines). W1 settles it in L1,
  `quiet-raise-asks-nothing` (D-4037): `quietLowered` is true only when the effective quiet time after the write is
  strictly lower than the one before, so a raise alone needs no confirm and the section opens no sheet for it.
  `stallConfirmLines` adds no line for a raise, and no L0 text is added. The row "P3d: a quiet time raised but still
  below the built-in repeats the check note, with no due line" stays from this task's first cut: it pins the lines'
  own guard over such an effect (no due line, the Check repeat line), which W1 no longer sends.
- **A refusal with no `detail`** (§20's third item, and Fastify's 500): settled by Task 1's `stallWriteRefusal`,
  whose `detail` falls back to the 500 body's `message` and then to `apiErrorText`, so the toast's slot is never
  empty and a 500 names its cause. The section calls it and adds nothing. Pinned by "P2: a 500 toasts the cause the
  server named in its message…" (X59).
- **A write whose answer never arrived** (a network failure): Task 1 reads it as `unconfirmed`, and the section
  toasts `STALL_CONFIRM_TEXT.unanswered` (fix round 1, F1; an unreadable 2xx keeps `UNCONFIRMED_TEXT`) and re-reads,
  never "Nothing was changed". Pinned by "a write whose answer never arrived…" (X48, X60).
- **The lock** (§13 item 3): `busy || pending !== null` disables both fieldsets, and `choose` refuses to write while
  locked, because a dispatched event can still reach a disabled control's handler (measured: with the guard deleted,
  that row's change on the disabled select and click on a disabled radio each send a write, 3 calls where 1 is
  expected). Pinned by "P3: the controls are locked while a write is in flight…" (X44, X45).
- **The `dueFromOff` line keeps §13's wording**, "Off recorded nothing. …", with no `{label}` slot: W1 decided it in
  its L0 (Off's full label, not a short form, which §12's slot rule is about), and the section renders the key as
  given. Pinned by "P3d: checks from a running watch are due; from Off, dueFromOff".
- **An absent row checks no radio** (§20's seventh item): `chosen.level` is `'unreadable'` for an absent row, and the
  section checks a radio only when `chosen.level` equals its value. A row pins it with `stored: 'absent'`.
- **The quiet select for a value the list does not hold** (an unreadable `quietMs`, or a stored value equal to the
  built-in, which the list omits): React would otherwise select the first enabled option, "Built-in", and show a
  value the server did not answer. The select then carries one empty, disabled, hidden option and is set to it.
- **Durations** are written by one function, `quietText`, as "30 min", "2 h", "1 h 30 min", the shape §13 shows
  ("30 min to 12 h", "Last 48 h"). Every input comes off the wire.
- **A held source over a choice that is not a level** is not a reply the server builds; `stallNowLines` draws no
  source line for it rather than a guess.
- **Tones.** The level is drawn as `settings-catalogue`; does, busy gate and source as `settings-note`; held,
  hazard, files-exceed, stored and fallback lines amber (`settings-catalogue settings-catalogue--amber`); the stale
  line `settings-note settings-catalogue--amber`. The select reuses `route-select`. No CSS is added.

- [ ] **Step 1: Re-anchor**

The copies go to a fresh `mktemp` directory inside the workspace's git-ignored scratch (`.superpowers/` is in
`.gitignore`), never to a fixed name in a shared `/tmp`, so two workers on one box cannot read each other's copy.
Run the block as one Bash call (`$T` lives only in that shell):

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p .superpowers/sdd/stall-watch-settings-w2
T="$(mktemp -d .superpowers/sdd/stall-watch-settings-w2/reanchor.XXXXXX)"
git show HEAD:pwa/src/screens/SettingsScreen.tsx > "$T/ss.tsx"; git show HEAD:pwa/test/settings-screen.test.tsx > "$T/sst.tsx"
grep -c -F 'design 2026-09-20 §13). Two sections and no more — Updates (the channel,' "$T/ss.tsx"
grep -c -F "import { NotificationBell } from '../fleet/NotificationBell';" "$T/ss.tsx"
grep -c -F '//   * The PHONE-PUSH toggle is the literal <NotificationBell/> — the same' "$T/ss.tsx"
grep -c -F '          <span>Phone notifications for this browser</span>' "$T/ss.tsx"
grep -c -F '  // ONE poll and ONE clock for the whole screen: every section reads the same' "$T/ss.tsx"
grep -c -F '      <NotificationsSection view={poll.view} reload={poll.reload} />' "$T/ss.tsx"
grep -c -F "    expect(within(section).getByText('Phone notifications for this browser')).toBeInTheDocument();" "$T/sst.tsx"
grep -c -F "import { declValue, ruleIn } from './cssRule';" "$T/sst.tsx"
wc -l < "$T/sst.tsx"
ls pwa/src/screens/StallWatchSection.tsx 2>&1 | tail -1
rm -r "$T"
```

Expected (measured at the prototype's base): `1` for each of the eight `grep -c` (lines ≈2, ≈21, ≈554, ≈650, ≈677,
≈691 and ≈1771, ≈33); `1896`; `ls: cannot access …: No such file or directory`. Each "before" text quoted in Steps
2 and 4 is one of these eight, so each occurs exactly once in its file.

- [ ] **Step 2: Write the failing tests**

All edits are in `pwa/test/settings-screen.test.tsx`.

(a) After the line `import { declValue, ruleIn } from './cssRule';` (≈:33), insert:

```ts
import type {
  StallHeld, StallWatchEffective, StallWatchStages, StallWatchView, StallWriteEffect,
} from '../../shared/api';
import * as L0 from '../../shared/api';
import {
  STALL_BUSY_GATE_OFF_TEXT, STALL_BUSY_GATE_TEXT, STALL_CONFIRM_TEXT, STALL_FALLBACK_TEXT, STALL_FILES_EXCEED_TEXT,
  STALL_FOLLOW_LABEL, STALL_HAZARD_TEXT, STALL_HELD_REASON, STALL_HELD_TEXT, STALL_LEVELS, STALL_LEVEL_TEXT,
  STALL_NEXT_TEXT, STALL_NOT_AVAILABLE_TEXT, STALL_NOTICE_TEXT, STALL_QUIET_NOTE, STALL_RUNLESS_FOOTNOTE,
  STALL_SECTION_TEXT, STALL_SOURCE_TEXT, STALL_STAGE_TEXT, STALL_STORED_TEXT,
} from '../../shared/api';
import {
  fillStallText, quietChoices, quietText, stallConfirmLines, stallConfirmTitle, stallCountLine, stallNextLines,
  stallNowLines,
} from '../src/screens/StallWatchSection';
```

(b) ≈:1771, in `reuses the literal NotificationBell where the browser can do Web Push`, replace

```ts
    expect(within(section).getByText('Phone notifications for this browser')).toBeInTheDocument();
```

with

```ts
    expect(within(section).getByText('Push notifications for this browser')).toBeInTheDocument();
```

(c) At the end of the file (after the last line, `});`, ≈:1896), append this block. It begins with one blank line.

````ts

// ── The Stall watch section (stall watch settings, design 2026-10-05 §13; programme stall-watch-settings W2
// Task 3). The section reads its own endpoint through its own hook (`useStallWatchView`), so every case here spies
// `api.stallWatch` and `api.setStallWatch` and leaves `/api/updates` pending. The pure helpers are unit-tested first
// (P3b, P3d, P9–P12, M6, M24); the rendered section after (P1, P1b, P2, P3, P3c, P5); the source scans last (P6, P9).

const SW_H = 3_600_000;
const swStages = (over: Partial<StallWatchStages> = {}): StallWatchStages => ({
  runs: true, checks: true, alerts: false, busyDelivery: false, busyGate: true, wave2: false, ...over,
});
const swHeld = (over: Partial<StallHeld> = {}): StallHeld => ({
  watchOff: false, mailOff: false, gateStrict: false, wave2HeldByStrict: false, ...over,
});
type SwMeasured = Extract<StallWatchEffective, { measured: true }>;
const swEffective = (over: Partial<SwMeasured> = {}): SwMeasured => ({
  measured: true, level: 'check', files: 'check', source: 'files', stages: swStages(), held: swHeld(),
  next: { kind: 'step', level: 'alert', waitsOn: ['alerts'] }, filesExceed: false, ...over,
});
const swView = (over: Partial<StallWatchView> = {}): StallWatchView => ({
  chosen: { level: 'follow', quietMs: 'default', updatedAt: 1_000, stored: 'row' },
  effective: swEffective(),
  quiet: {
    effectiveMs: 2 * SW_H, builtInMs: 2 * SW_H, minMs: SW_H / 2, maxMs: 12 * SW_H, stepMs: SW_H / 2,
    source: 'default',
  },
  notices: {
    ok: true, since: 0, windowMs: 48 * SW_H,
    counts: [
      { row: 'checks', sent: 1, shadow: 2 }, { row: 'wakes', sent: 0, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 3 }, { row: 'pushes', sent: 4, shadow: 0 },
    ],
  },
  fallback: null,
  ...over,
});
const swChosen = (over: Partial<StallWatchView['chosen']>): StallWatchView['chosen'] =>
  ({ ...swView().chosen, ...over });
/** A running watch with every confirm stage off: Log only, the busy gate off. */
const SW_LOG = swStages({ checks: false, busyGate: false });
type SwEffect = Extract<StallWriteEffect, { measured: true }>;
const swEffect = (over: Partial<SwEffect> = {}): SwEffect => ({
  measured: true, turnsOn: [], turnsOff: [], leavesWave2: false, heldByBox: false, quietLowered: false,
  filesExceed: false, before: SW_LOG, after: SW_LOG, quietMs: { before: 2 * SW_H, after: 2 * SW_H }, mailOff: false,
  ...over,
});
const swConfirm = (effect: StallWriteEffect, effectKey: string): ApiError =>
  new ApiError(409, { ok: false, error: 'confirm-required', effect, effectKey });
const swTexts = (v: StallWatchView): string[] => stallNowLines(v).map((l) => l.text);
const swTurnsOn = (stage: keyof typeof STALL_STAGE_TEXT): string => {
  const { name, gate } = STALL_STAGE_TEXT[stage];
  return gate === null
    ? fillStallText(STALL_CONFIRM_TEXT.turnsOnFree, { name })
    : fillStallText(STALL_CONFIRM_TEXT.turnsOn, { name, gate });
};
const swValue = (ms: number): { value: string } => ({ value: quietText(ms) });

describe('SettingsScreen — stall watch: helpers (stall-watch-settings W2 Task 3)', () => {
  it('fillStallText fills each named slot, leaves a slot it was not given, and reads a $ in a value literally', () => {
    expect(fillStallText('{a} and {b}', { a: 'x', b: 'y' })).toBe('x and y');
    expect(fillStallText('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(fillStallText(STALL_CONFIRM_TEXT.refused, { detail: 'costs $& and $1' }))
      .toBe('Nothing was changed: costs $& and $1');
  });

  it('quietText writes a span in hours and minutes, the shape the spec shows ("30 min to 12 h", "Last 48 h")', () => {
    expect(quietText(SW_H / 2)).toBe('30 min');
    expect(quietText(2 * SW_H)).toBe('2 h');
    expect(quietText(1.5 * SW_H)).toBe('1 h 30 min');
    expect(quietText(48 * SW_H)).toBe('48 h');
  });

  it('quietChoices: the built-in first, then every step from min to max except the built-in, which appears once', () => {
    const choices = quietChoices(swView());
    expect(choices[0]).toEqual({ value: 'default', label: 'Built-in (2 h)' });
    const steps = choices.slice(1).map((c) => c.value);
    expect(steps).toHaveLength(23);
    expect(steps[0]).toBe(SW_H / 2);
    expect(steps[steps.length - 1]).toBe(12 * SW_H);
    expect(steps).not.toContain(2 * SW_H);
    expect(choices.filter((c) => c.label === '2 h' || c.label.includes('(2 h)'))).toHaveLength(1);
    expect(choices.find((c) => c.value === 1.5 * SW_H)?.label).toBe('1 h 30 min');
  });

  it('the Now block: the effective level, its does text, and the busy gate in its two parts (busy-shadow)', () => {
    const v = swView();
    expect(stallNowLines(v)[0]).toEqual({ text: STALL_LEVEL_TEXT.check.label, tone: 'head' });
    expect(swTexts(v)).toContain(STALL_LEVEL_TEXT.check.does);
    expect(swTexts(v)).toContain(`${STALL_BUSY_GATE_TEXT.holds} ${STALL_BUSY_GATE_TEXT.logs}`);
    expect(swTexts(v)).toContain(STALL_SOURCE_TEXT.files);
    const deliver = swView({ effective: swEffective({ level: 'deliver', files: 'deliver',
      stages: swStages({ alerts: true, busyDelivery: true }) }) });
    expect(swTexts(deliver)).toContain(STALL_BUSY_GATE_TEXT.holds);
    expect(swTexts(deliver).some((t) => t.includes(STALL_BUSY_GATE_TEXT.logs))).toBe(false);
  });

  it('custom reads "Custom", then the names of the stages that are on', () => {
    const v = swView({ effective: swEffective({ level: 'custom', files: 'custom',
      stages: swStages({ runs: false, checks: false, busyGate: true, busyDelivery: true }), next: { kind: 'none' } }) });
    expect(stallNowLines(v)[0]).toEqual({ text: STALL_SECTION_TEXT.custom, tone: 'head' });
    expect(swTexts(v)).toContain(`${STALL_STAGE_TEXT.busyDelivery.name}, ${STALL_STAGE_TEXT.busyGate.name}`);
  });

  it('P9: the busy-gate-off note shows for a files-read level without the gate, and only for that cause', () => {
    // A fresh install: the files read Log only, with the busy gate off.
    const fresh = swView({ effective: swEffective({ level: 'log', files: 'log', stages: SW_LOG }) });
    expect(swTexts(fresh)).toContain(STALL_BUSY_GATE_OFF_TEXT);
    // A chosen level under strict: the ladder sets the gate, and the strict held line says why it is off.
    const strict = swView({
      chosen: swChosen({ level: 'check' }),
      effective: swEffective({ source: 'chosen', stages: swStages({ busyGate: false }), held: swHeld({ gateStrict: true }) }),
    });
    expect(swTexts(strict)).not.toContain(STALL_BUSY_GATE_OFF_TEXT);
    // Files read Check over the busy-shadow file with mail switched off: the gate reads off because mail is off.
    const mailOff = swView({ effective: swEffective({ stages: swStages({ busyGate: false }), held: swHeld({ mailOff: true }) }) });
    expect(swTexts(mailOff)).not.toContain(STALL_BUSY_GATE_OFF_TEXT);
    expect(swTexts(mailOff)).toContain(STALL_HELD_TEXT.mailOff);
    // Custom and a stopped watch name no busy-gate cause either.
    const custom = swView({ effective: swEffective({ level: 'custom', stages: swStages({ busyGate: false, alerts: true }) }) });
    expect(swTexts(custom)).not.toContain(STALL_BUSY_GATE_OFF_TEXT);
    const stopped = swView({ effective: swEffective({ level: 'off', files: 'off', stages: swStages({ runs: false, checks: false, busyGate: false }) }) });
    expect(swTexts(stopped)).not.toContain(STALL_BUSY_GATE_OFF_TEXT);
  });

  it('P10: a held source names the chosen level and the reason, never "Chosen here"', () => {
    const strict = swView({
      chosen: swChosen({ level: 'deliver' }),
      effective: swEffective({ level: 'alert', source: 'held', stages: swStages({ alerts: true, busyGate: false }),
        held: swHeld({ gateStrict: true }), next: { kind: 'none' } }),
    });
    expect(swTexts(strict)).toContain(
      `Chosen: ${STALL_LEVEL_TEXT.deliver.label}, held back by the fleet box (${STALL_HELD_REASON.gateStrict})`);
    expect(swTexts(strict)).not.toContain(STALL_SOURCE_TEXT.chosen);
    const kill = swView({
      chosen: swChosen({ level: 'all' }),
      effective: swEffective({ level: 'off', source: 'held', stages: swStages({ runs: false, checks: false, busyGate: false }),
        held: swHeld({ watchOff: true }), next: { kind: 'none' } }),
    });
    expect(swTexts(kill)).toContain(
      fillStallText(STALL_SOURCE_TEXT.held, { label: STALL_LEVEL_TEXT.all.label, reason: STALL_HELD_REASON.watchOff }));
    const chosen = swView({ chosen: swChosen({ level: 'check' }), effective: swEffective({ source: 'chosen' }) });
    expect(swTexts(chosen)).toContain(STALL_SOURCE_TEXT.chosen);
  });

  it('one line per held flag, in StallHeld order', () => {
    const v = swView({ effective: swEffective({ source: 'held', held: swHeld({ watchOff: true, mailOff: true, gateStrict: true, wave2HeldByStrict: true }) }),
      chosen: swChosen({ level: 'all' }) });
    const held = swTexts(v).filter((t) => (Object.values(STALL_HELD_TEXT) as string[]).includes(t));
    expect(held).toEqual([STALL_HELD_TEXT.watchOff, STALL_HELD_TEXT.mailOff, STALL_HELD_TEXT.gateStrict,
      STALL_HELD_TEXT.wave2HeldByStrict]);
  });

  it('M24: the hazard line shows for alerts and the further checks without busy delivery, and not under mail off', () => {
    const hazard = swEffective({ level: 'custom', stages: swStages({ alerts: true, wave2: true, busyDelivery: false }) });
    expect(swTexts(swView({ effective: hazard }))).toContain(STALL_HAZARD_TEXT);
    expect(stallNowLines(swView({ effective: hazard })).find((l) => l.text === STALL_HAZARD_TEXT)?.tone).toBe('warn');
    const delivered = swEffective({ level: 'all', stages: swStages({ alerts: true, wave2: true, busyDelivery: true }) });
    expect(swTexts(swView({ effective: delivered }))).not.toContain(STALL_HAZARD_TEXT);
    const mailOff = { ...hazard, held: swHeld({ mailOff: true }) };
    expect(swTexts(swView({ effective: mailOff }))).not.toContain(STALL_HAZARD_TEXT);
  });

  it('P11: the files-exceed line follows effective.filesExceed, and nothing else', () => {
    const chosen = swChosen({ level: 'log' });
    expect(swTexts(swView({ chosen, effective: swEffective({ source: 'chosen', filesExceed: true }) })))
      .toContain(STALL_FILES_EXCEED_TEXT);
    expect(swTexts(swView({ chosen, effective: swEffective({ source: 'chosen', filesExceed: false }) })))
      .not.toContain(STALL_FILES_EXCEED_TEXT);
    const unstated = swEffective({ source: 'chosen' });
    delete unstated.filesExceed;
    expect(swTexts(swView({ chosen, effective: unstated }))).not.toContain(STALL_FILES_EXCEED_TEXT);
  });

  it('P12: exactly one stored line whenever the stored row does not apply whole, and the fallback line', () => {
    const stored = (chosen: StallWatchView['chosen']): string[] =>
      swTexts(swView({ chosen })).filter((t) => (Object.values(STALL_STORED_TEXT) as string[]).includes(t));
    const none = { level: 'unreadable', quietMs: 'unreadable', updatedAt: null } as const;
    expect(stored(swChosen({ ...none, stored: 'absent' }))).toEqual([STALL_STORED_TEXT.absent]);
    expect(stored(swChosen({ ...none, stored: 'unreadable' }))).toEqual([STALL_STORED_TEXT.unreadable]);
    expect(stored(swChosen({ level: 'unreadable', quietMs: 'unreadable' }))).toEqual([STALL_STORED_TEXT.both]);
    expect(stored(swChosen({ level: 'unreadable', quietMs: SW_H }))).toEqual([STALL_STORED_TEXT.level]);
    expect(stored(swChosen({ level: 'check', quietMs: 'unreadable' }))).toEqual([STALL_STORED_TEXT.quiet]);
    expect(stored(swChosen({ level: 'check', quietMs: SW_H }))).toEqual([]);
    const fallback = swView({ fallback: { at: 5, reason: 'the resolver threw' } });
    expect(swTexts(fallback)).toContain(fillStallText(STALL_FALLBACK_TEXT, { reason: 'the resolver threw' }));
    expect(swTexts(swView()).some((t) => t.startsWith('Your choice is not being applied'))).toBe(false);
  });

  it('M6: an unmeasured reading is "Unknown", never Off — and the chosen values still show', () => {
    const v = swView({ effective: { measured: false }, chosen: swChosen({ stored: 'unreadable', level: 'unreadable',
      quietMs: 'unreadable', updatedAt: null }) });
    expect(stallNowLines(v)[0]).toEqual({ text: STALL_SECTION_TEXT.unknown, tone: 'head' });
    expect(swTexts(v)).not.toContain(STALL_LEVEL_TEXT.off.label);
    expect(swTexts(v)).toContain(STALL_STORED_TEXT.unreadable);
    expect(stallNextLines(v.effective)).toBeNull();
  });

  it('P10: the Next step renders from the wire — none and a missing next show nothing, an empty waitsOn no gates', () => {
    expect(stallNextLines(swEffective({ next: { kind: 'none' } }))).toBeNull();
    const unstated = swEffective();
    delete unstated.next;
    expect(stallNextLines(unstated)).toBeNull();
    expect(stallNextLines(swEffective({ next: { kind: 'top' } }))).toEqual({ lead: STALL_NEXT_TEXT.top, waitsOn: [] });
    expect(stallNextLines(swEffective({ next: { kind: 'step', level: 'alert', waitsOn: [] } })))
      .toEqual({ lead: `${STALL_NEXT_TEXT.lead} ${STALL_LEVEL_TEXT.alert.label}.`, waitsOn: [] });
    expect(stallNextLines(swEffective({ next: { kind: 'step', level: 'all', waitsOn: ['busyDelivery', 'wave2'] } })))
      .toEqual({ lead: `${STALL_NEXT_TEXT.lead} ${STALL_LEVEL_TEXT.all.label}.`,
        waitsOn: [STALL_STAGE_TEXT.busyDelivery.gate, STALL_STAGE_TEXT.wave2.gate] });
  });

  it('stallCountLine: "<label> — <sent> sent · <shadow> shadow"', () => {
    expect(stallCountLine({ row: 'reports', sent: 0, shadow: 3 }))
      .toBe(`${STALL_NOTICE_TEXT.reports} — 0 sent · 3 shadow`);
  });

  it('stallConfirmTitle: a level, Follow, a quiet time, and the built-in', () => {
    expect(stallConfirmTitle({ level: 'alert' }, 2 * SW_H)).toBe(`Set the stall watch to ${STALL_LEVEL_TEXT.alert.label}?`);
    expect(stallConfirmTitle({ level: 'follow' }, 2 * SW_H)).toBe(`${STALL_FOLLOW_LABEL}?`);
    expect(stallConfirmTitle({ quietMs: SW_H / 2 }, 2 * SW_H)).toBe('Set the quiet time to 30 min?');
    expect(stallConfirmTitle({ quietMs: 'default' }, 2 * SW_H)).toBe('Set the quiet time to 2 h (built-in)?');
  });

  it('M6: the unmeasured effect gives the one unknown line', () => {
    expect(stallConfirmLines({ measured: false }, { level: 'all' }, 2 * SW_H)).toEqual([STALL_CONFIRM_TEXT.unknown]);
  });

  it('P3b: Off over a busy file says busy delivery comes back, never the generic turn-on line', () => {
    const off = swStages({ runs: false, checks: false, busyGate: false });
    const lines = stallConfirmLines(swEffect({
      turnsOn: ['busyDelivery'], turnsOff: ['checks'],
      before: swStages({ busyDelivery: false, busyGate: true }), after: { ...off, busyDelivery: true, busyGate: true },
    }), { level: 'off' }, 2 * SW_H);
    expect(lines).toContain("Busy delivery turns back on: the fleet box's files arm it.");
    expect(lines).not.toContain(swTurnsOn('busyDelivery'));
    expect(lines).toEqual([
      STALL_LEVEL_TEXT.off.does,
      "Busy delivery turns back on: the fleet box's files arm it.",
      STALL_STAGE_TEXT.checks.stops,
      STALL_CONFIRM_TEXT.dueMail,
    ]);
  });

  it('the order: does, turn-ons, stops, the held line, what falls due, the quiet lines, the files-exceed line', () => {
    const lines = stallConfirmLines(swEffect({
      turnsOn: ['checks', 'alerts'], turnsOff: ['busyGate'], leavesWave2: false, filesExceed: true,
      before: swStages({ checks: true, alerts: false }), after: swStages({ checks: true, alerts: true, busyGate: false }),
      heldByBox: false, quietLowered: true, quietMs: { before: 2 * SW_H, after: SW_H },
    }), { level: 'alert' }, 2 * SW_H);
    expect(lines).toEqual([
      STALL_LEVEL_TEXT.alert.does,
      swTurnsOn('checks'),
      swTurnsOn('alerts'),
      STALL_STAGE_TEXT.busyGate.stops,
      STALL_CONFIRM_TEXT.due,
      fillStallText(STALL_CONFIRM_TEXT.quietDue, swValue(SW_H)),
      fillStallText(STALL_CONFIRM_TEXT.quietRepeat, swValue(SW_H)),
      fillStallText(STALL_CONFIRM_TEXT.quietDialogs, swValue(SW_H)),
      STALL_FILES_EXCEED_TEXT,
    ]);
  });

  it('the busy gate turning on takes the free line; Follow shows no does text', () => {
    const lines = stallConfirmLines(swEffect({ turnsOn: ['busyGate'], after: swStages({ checks: false, busyGate: true }) }),
      { level: 'follow' }, 2 * SW_H);
    expect(lines).toEqual([fillStallText(STALL_CONFIRM_TEXT.turnsOnFree, { name: STALL_STAGE_TEXT.busyGate.name })]);
  });

  it('leaving the further checks shows the wave2 stops line once, from either reading', () => {
    const fromUnheld = stallConfirmLines(swEffect({ leavesWave2: true }), { level: 'check' }, 2 * SW_H);
    expect(fromUnheld.filter((l) => l === STALL_STAGE_TEXT.wave2.stops)).toHaveLength(1);
    const resolved = stallConfirmLines(swEffect({ turnsOff: ['wave2'], leavesWave2: true }), { level: 'check' }, 2 * SW_H);
    expect(resolved.filter((l) => l === STALL_STAGE_TEXT.wave2.stops)).toHaveLength(1);
  });

  it('P3d: busy delivery alone makes mail due, never a recorded notice', () => {
    const lines = stallConfirmLines(swEffect({ turnsOn: ['busyDelivery'],
      before: swStages(), after: swStages({ busyDelivery: true }) }), { level: 'deliver' }, 2 * SW_H);
    expect(lines).toContain(STALL_CONFIRM_TEXT.dueMail);
    expect(lines).not.toContain(STALL_CONFIRM_TEXT.due);
  });

  it('P3d: checks from a running watch are due; from Off, dueFromOff', () => {
    const running = stallConfirmLines(swEffect({ turnsOn: ['checks'], after: swStages({ busyGate: false }) }),
      { level: 'check' }, 2 * SW_H);
    expect(running).toContain(STALL_CONFIRM_TEXT.due);
    expect(running).not.toContain(STALL_CONFIRM_TEXT.dueFromOff);
    const fromOff = stallConfirmLines(swEffect({ turnsOn: ['checks'],
      before: swStages({ runs: false, checks: false, busyGate: false }), after: swStages({ busyGate: false }) }),
    { level: 'check' }, 2 * SW_H);
    expect(fromOff).toContain(STALL_CONFIRM_TEXT.dueFromOff);
    expect(fromOff).not.toContain(STALL_CONFIRM_TEXT.due);
  });

  it('P3d: a lowered quiet time is worded by what runs after the write: off, Log, Check, Everything; dialogs with alerts', () => {
    const lower = (after: StallWatchStages): string[] => stallConfirmLines(swEffect({
      before: after, after, quietLowered: true, quietMs: { before: 2 * SW_H, after: SW_H },
    }), { quietMs: SW_H }, 2 * SW_H);
    const v = swValue(SW_H);
    expect(lower(swStages({ runs: false, checks: false, busyGate: false })))
      .toEqual([STALL_CONFIRM_TEXT.quietOff]);
    expect(lower(SW_LOG)).toEqual([fillStallText(STALL_CONFIRM_TEXT.quietRecorded, v)]);
    expect(lower(swStages())).toEqual([fillStallText(STALL_CONFIRM_TEXT.quietDue, v),
      fillStallText(STALL_CONFIRM_TEXT.quietRepeat, v)]);
    expect(lower(swStages({ alerts: true, busyDelivery: true, wave2: true }))).toEqual([
      fillStallText(STALL_CONFIRM_TEXT.quietDueAll, v), fillStallText(STALL_CONFIRM_TEXT.quietDialogs, v)]);
    expect(lower(swStages({ alerts: true }))).toEqual([fillStallText(STALL_CONFIRM_TEXT.quietDue, v),
      fillStallText(STALL_CONFIRM_TEXT.quietRepeat, v), fillStallText(STALL_CONFIRM_TEXT.quietDialogs, v)]);
  });

  it('P3d: a quiet time raised but still below the built-in repeats the check note, with no due line', () => {
    const lines = stallConfirmLines(swEffect({ before: swStages(), after: swStages(), quietLowered: true,
      quietMs: { before: SW_H / 2, after: SW_H } }), { quietMs: SW_H }, 2 * SW_H);
    expect(lines).toEqual([fillStallText(STALL_CONFIRM_TEXT.quietRepeat, swValue(SW_H))]);
  });

  it('P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not', () => {
    const v = swValue(SW_H);
    const checkToAlert = stallConfirmLines(swEffect({ mailOff: true, turnsOn: ['alerts'],
      before: swStages(), after: swStages({ alerts: true }) }), { level: 'alert' }, 2 * SW_H);
    expect(checkToAlert).toContain(STALL_CONFIRM_TEXT.dueMailOff);
    expect(checkToAlert).not.toContain(STALL_CONFIRM_TEXT.due);
    const logToCheck = stallConfirmLines(swEffect({ mailOff: true, turnsOn: ['checks'],
      after: swStages({ busyGate: false }) }), { level: 'check' }, 2 * SW_H);
    expect(logToCheck).toContain(STALL_CONFIRM_TEXT.dueMailOffHeld);
    expect(logToCheck).not.toContain(STALL_CONFIRM_TEXT.due);
    const busy = stallConfirmLines(swEffect({ mailOff: true, turnsOn: ['busyDelivery'],
      before: swStages(), after: swStages({ busyDelivery: true }) }), { level: 'deliver' }, 2 * SW_H);
    expect(busy).toContain(STALL_CONFIRM_TEXT.dueMailBack);
    expect(busy).not.toContain(STALL_CONFIRM_TEXT.dueMail);
    const lower = (after: StallWatchStages): string[] => stallConfirmLines(swEffect({ mailOff: true,
      before: after, after, quietLowered: true, quietMs: { before: 2 * SW_H, after: SW_H } }), { quietMs: SW_H }, 2 * SW_H);
    expect(lower(swStages())).toEqual([fillStallText(STALL_CONFIRM_TEXT.quietDueMailOff, v),
      fillStallText(STALL_CONFIRM_TEXT.quietRepeatMailOff, v)]);
    expect(lower(swStages({ alerts: true, busyDelivery: true, wave2: true }))).toEqual([
      fillStallText(STALL_CONFIRM_TEXT.quietDueAllMailOff, v), fillStallText(STALL_CONFIRM_TEXT.quietDialogs, v)]);
    expect(lower(SW_LOG)).toEqual([fillStallText(STALL_CONFIRM_TEXT.quietRecorded, v)]);
  });

  it('P3d: stages held by the kill switch take their turn-on lines and the held line — no backOn, nothing due', () => {
    const off = swStages({ runs: false, checks: false, busyGate: false });
    const lines = stallConfirmLines(swEffect({ turnsOn: ['alerts', 'busyDelivery', 'wave2'], heldByBox: true,
      before: off, after: off }), { level: 'all' }, 2 * SW_H);
    expect(lines).toEqual([
      STALL_LEVEL_TEXT.all.does,
      swTurnsOn('alerts'),
      swTurnsOn('busyDelivery'),
      swTurnsOn('wave2'),
      STALL_CONFIRM_TEXT.heldByBox,
    ]);
  });
});

describe('SettingsScreen — stall watch: the section (design 2026-10-05 §13)', () => {
  afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); });

  // `hidden: true`: an open sheet marks the page behind it aria-hidden, and these cases read the radios under it.
  const section = (): HTMLElement =>
    screen.getByRole('heading', { name: STALL_SECTION_TEXT.title, hidden: true }).closest('section')!;
  const levelGroup = (): Promise<HTMLElement> => within(section()).findByRole('group', { name: STALL_SECTION_TEXT.level });
  const mount = async (first: StallWatchView): Promise<{ read: ReturnType<typeof vi.spyOn> }> => {
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    const read = vi.spyOn(api, 'stallWatch').mockResolvedValue(first);
    render(<><ToastHost /><SettingsScreen /></>);
    await levelGroup();
    return { read };
  };
  const repoll = async (): Promise<void> => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  };
  const radio = (name: string): HTMLElement => within(section()).getByRole('radio', { name, hidden: true });

  it('is the third section, after Notifications, titled Stall watch', async () => {
    await mount(swView());
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Updates', 'Notifications', STALL_SECTION_TEXT.title]);
  });

  it('P1: pending is a skeleton, a failed first read says so, and a view renders — three states, never folded', async () => {
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'stallWatch').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    expect(within(section()).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(within(section()).queryByText(STALL_SECTION_TEXT.unread)).toBeNull();
    cleanup();
    vi.spyOn(api, 'stallWatch').mockRejectedValue(new ApiError(500, { error: 'Internal Server Error' }));
    render(<SettingsScreen />);
    expect(await within(section()).findByText(STALL_SECTION_TEXT.unread)).toBeInTheDocument();
    expect(within(section()).queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(within(section()).queryByRole('radio')).toBeNull();
  });

  it('P1: a later failed read keeps the landed view and adds the stale line', async () => {
    const { read } = await mount(swView());
    read.mockRejectedValue(new ApiError(500, { error: 'Internal Server Error' }));
    await repoll();
    expect(await within(section()).findByText(STALL_SECTION_TEXT.stale)).toBeInTheDocument();
    expect(radio(`${STALL_FOLLOW_LABEL} (they say: ${STALL_LEVEL_TEXT.check.label})`)).toBeChecked();
  });

  it('P1b: a 404 not-found after a landed view replaces the whole body — no Now block, no radio checked', async () => {
    const { read } = await mount(swView({ chosen: swChosen({ level: 'off' }), effective: swEffective({
      level: 'off', source: 'chosen', stages: swStages({ runs: false, checks: false, busyGate: false }) }) }));
    expect(radio(STALL_LEVEL_TEXT.off.label)).toBeChecked();
    read.mockRejectedValue(new ApiError(404, { error: 'not-found' }));
    await repoll();
    expect(await within(section()).findByText(STALL_NOT_AVAILABLE_TEXT)).toBeInTheDocument();
    expect(within(section()).queryByRole('radio')).toBeNull();
    expect(within(section()).queryByText(STALL_SOURCE_TEXT.chosen)).toBeNull();
    expect(within(section()).queryByText(STALL_LEVEL_TEXT.off.does)).toBeNull();
  });

  it('P1b: a 501 not-configured first read is the not-available text, not the unread line', async () => {
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'stallWatch').mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }));
    render(<SettingsScreen />);
    expect(await within(section()).findByText(STALL_NOT_AVAILABLE_TEXT)).toBeInTheDocument();
    expect(within(section()).queryByText(STALL_SECTION_TEXT.unread)).toBeNull();
  });

  it('renders the Now block, the Next step, the quiet time and the counts from the view', async () => {
    await mount(swView());
    const s = section();
    expect(within(s).getByText(STALL_LEVEL_TEXT.check.label, { selector: 'p' })).toBeInTheDocument();
    expect(within(s).getByText(STALL_SOURCE_TEXT.files)).toBeInTheDocument();
    expect(within(s).getByText(`${STALL_NEXT_TEXT.lead} ${STALL_LEVEL_TEXT.alert.label}.`)).toBeInTheDocument();
    expect(within(s).getByText(STALL_NEXT_TEXT.waitsOn)).toBeInTheDocument();
    expect(within(s).getByText(STALL_STAGE_TEXT.alerts.gate)).toBeInTheDocument();
    expect(within(s).getByText('2 h (built-in)')).toBeInTheDocument();
    expect(within(s).getByText('30 min to 12 h')).toBeInTheDocument();
    expect(within(s).getByText(STALL_QUIET_NOTE)).toBeInTheDocument();
    expect(within(s).getByText('Last 48 h')).toBeInTheDocument();
    expect(within(s).getByText(`${STALL_NOTICE_TEXT.checks} — 1 sent · 2 shadow`)).toBeInTheDocument();
    expect(within(s).getByText(`${STALL_NOTICE_TEXT.pushes} — 4 sent · 0 shadow`)).toBeInTheDocument();
    const select = within(s).getByRole('combobox', { name: STALL_SECTION_TEXT.quiet });
    expect((select as HTMLSelectElement).value).toBe('default');
    expect(within(select).getAllByRole('option')).toHaveLength(24);
  });

  it('P10: next.kind none shows no Next step, and a step with an empty waitsOn shows no "Waits on:"', async () => {
    const { read } = await mount(swView({ effective: swEffective({ next: { kind: 'none' } }) }));
    expect(within(section()).queryByText(/^Next step:/)).toBeNull();
    expect(within(section()).queryByText(STALL_NEXT_TEXT.top)).toBeNull();
    read.mockResolvedValue(swView({ effective: swEffective({ next: { kind: 'step', level: 'alert', waitsOn: [] } }) }));
    await repoll();
    await within(section()).findByText(`${STALL_NEXT_TEXT.lead} ${STALL_LEVEL_TEXT.alert.label}.`);
    expect(within(section()).queryByText(STALL_NEXT_TEXT.waitsOn)).toBeNull();
  });

  it('M6: an unmeasured reading renders "Unknown" and "they say: unknown", and no level is read as Off', async () => {
    await mount(swView({ effective: { measured: false }, chosen: swChosen({ level: 'alert' }) }));
    expect(within(section()).getByText(STALL_SECTION_TEXT.unknown)).toBeInTheDocument();
    expect(radio(`${STALL_FOLLOW_LABEL} (${STALL_SECTION_TEXT.theySayUnknown})`)).not.toBeChecked();
    expect(radio(STALL_LEVEL_TEXT.alert.label)).toBeChecked();
    expect(within(section()).queryByText(STALL_LEVEL_TEXT.off.does)).toBeNull();
  });

  it('an absent or unreadable stored level checks no radio, and the quiet select shows no built-in it does not hold', async () => {
    await mount(swView({ chosen: swChosen({ level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'absent' }) }));
    for (const r of within(section()).getAllByRole('radio')) expect(r).not.toBeChecked();
    expect(within(section()).getByText(STALL_STORED_TEXT.absent)).toBeInTheDocument();
    const select = within(section()).getByRole('combobox', { name: STALL_SECTION_TEXT.quiet }) as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('P5: the run-less footnote is always shown — zero counts, and counts that could not be read', async () => {
    const zero = swView({ notices: { ok: true, since: 0, windowMs: 48 * SW_H, counts: (['checks', 'wakes', 'reports', 'pushes'] as const)
      .map((row) => ({ row, sent: 0, shadow: 0 })) } });
    const { read } = await mount(zero);
    expect(within(section()).getByText(STALL_RUNLESS_FOOTNOTE)).toBeInTheDocument();
    read.mockResolvedValue(swView({ notices: { ok: false } }));
    await repoll();
    expect(await within(section()).findByText(STALL_SECTION_TEXT.countsFailed)).toBeInTheDocument();
    expect(within(section()).getByText(STALL_RUNLESS_FOOTNOTE)).toBeInTheDocument();
    expect(within(section()).queryByText('Last 48 h')).toBeNull();
  });

  it('P3: a write answered 2xx at once sends only the field moved, opens no sheet, and settles the reply', async () => {
    const { read } = await mount(swView());
    const write = vi.spyOn(api, 'setStallWatch').mockResolvedValue(
      swView({ chosen: swChosen({ level: 'log' }), effective: swEffective({ source: 'chosen', level: 'log', stages: SW_LOG }) }));
    fireEvent.click(radio(STALL_LEVEL_TEXT.log.label));
    await waitFor(() => expect(radio(STALL_LEVEL_TEXT.log.label)).toBeChecked());
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ level: 'log' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('P3: the quiet select writes { quietMs } alone, and "Built-in" writes default', async () => {
    await mount(swView({ chosen: swChosen({ quietMs: SW_H }), quiet: { ...swView().quiet, effectiveMs: SW_H, source: 'chosen' } }));
    expect(within(section()).getByText('1 h (chosen here)')).toBeInTheDocument();
    const write = vi.spyOn(api, 'setStallWatch').mockResolvedValue(swView());
    const select = within(section()).getByRole('combobox', { name: STALL_SECTION_TEXT.quiet });
    expect((select as HTMLSelectElement).value).toBe(String(SW_H));
    fireEvent.change(select, { target: { value: 'default' } });
    await waitFor(() => expect(write).toHaveBeenCalledWith({ quietMs: 'default' }));
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('default'));
  });

  it('P3: a 409 opens the sheet from its effect; Cancel sends nothing more and leaves the stored choice checked', async () => {
    await mount(swView());
    const write = vi.spyOn(api, 'setStallWatch').mockRejectedValue(swConfirm(swEffect({ turnsOn: ['alerts'],
      before: swStages(), after: swStages({ alerts: true }) }), 'key-1'));
    fireEvent.click(radio(STALL_LEVEL_TEXT.alert.label));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(`Set the stall watch to ${STALL_LEVEL_TEXT.alert.label}?`)).toBeInTheDocument();
    expect(within(sheet).getByText(swTurnsOn('alerts'))).toBeInTheDocument();
    expect(within(sheet).getByText(STALL_CONFIRM_TEXT.due)).toBeInTheDocument();
    expect(radio(STALL_LEVEL_TEXT.alert.label)).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(write).toHaveBeenCalledTimes(1);
    expect(radio(`${STALL_FOLLOW_LABEL} (they say: ${STALL_LEVEL_TEXT.check.label})`)).toBeChecked();
    expect(radio(STALL_LEVEL_TEXT.alert.label)).not.toBeChecked();
    expect(radio(STALL_LEVEL_TEXT.alert.label)).toBeEnabled();
  });

  it('P3: Set re-POSTs the same body with confirm equal to effectKey, and the 2xx settles', async () => {
    await mount(swView());
    const write = vi.spyOn(api, 'setStallWatch')
      .mockRejectedValueOnce(swConfirm(swEffect({ turnsOn: ['alerts'], before: swStages(), after: swStages({ alerts: true }) }), 'key-1'))
      .mockResolvedValueOnce(swView({ chosen: swChosen({ level: 'alert' }),
        effective: swEffective({ level: 'alert', source: 'chosen', stages: swStages({ alerts: true }) }) }));
    fireEvent.click(radio(STALL_LEVEL_TEXT.alert.label));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: STALL_CONFIRM_TEXT.confirm }));
    await waitFor(() => expect(radio(STALL_LEVEL_TEXT.alert.label)).toBeChecked());
    expect(write).toHaveBeenNthCalledWith(1, { level: 'alert' });
    expect(write).toHaveBeenNthCalledWith(2, { level: 'alert', confirm: 'key-1' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('P3c: a key the server no longer matches opens a fresh sheet from the fresh effect, and the next Set carries the new key', async () => {
    await mount(swView());
    const write = vi.spyOn(api, 'setStallWatch')
      .mockRejectedValueOnce(swConfirm(swEffect({ turnsOn: ['alerts'], before: swStages(), after: swStages({ alerts: true }) }), 'key-1'))
      .mockRejectedValueOnce(swConfirm(swEffect({ turnsOn: ['alerts'], before: swStages(), after: swStages({ alerts: true }),
        filesExceed: true }), 'key-2'))
      .mockResolvedValueOnce(swView({ chosen: swChosen({ level: 'alert' }),
        effective: swEffective({ level: 'alert', source: 'chosen', stages: swStages({ alerts: true }) }) }));
    fireEvent.click(radio(STALL_LEVEL_TEXT.alert.label));
    const first = await screen.findByRole('dialog');
    expect(within(first).queryByText(STALL_FILES_EXCEED_TEXT)).toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: STALL_CONFIRM_TEXT.confirm }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    const fresh = await screen.findByRole('dialog');
    expect(await within(fresh).findByText(STALL_FILES_EXCEED_TEXT)).toBeInTheDocument();
    fireEvent.click(within(fresh).getByRole('button', { name: STALL_CONFIRM_TEXT.confirm }));
    await waitFor(() => expect(radio(STALL_LEVEL_TEXT.alert.label)).toBeChecked());
    expect(write).toHaveBeenNthCalledWith(2, { level: 'alert', confirm: 'key-1' });
    expect(write).toHaveBeenNthCalledWith(3, { level: 'alert', confirm: 'key-2' });
  });

  it('P2: a refused write toasts the server\'s detail, re-reads, and leaves the stored radio checked', async () => {
    const { read } = await mount(swView());
    vi.spyOn(api, 'setStallWatch').mockRejectedValue(
      new ApiError(400, { ok: false, error: 'bad-request', detail: 'quietMs must be a 30-minute step' }));
    fireEvent.click(radio(STALL_LEVEL_TEXT.all.label));
    expect(await screen.findByText('Nothing was changed: quietMs must be a 30-minute step')).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio(STALL_LEVEL_TEXT.all.label)).not.toBeChecked();
    expect(radio(`${STALL_FOLLOW_LABEL} (they say: ${STALL_LEVEL_TEXT.check.label})`)).toBeChecked();
  });

  it('an unreadable 2xx says the write may have landed and re-reads; it installs nothing', async () => {
    const { read } = await mount(swView());
    vi.spyOn(api, 'setStallWatch').mockResolvedValue('unreadable');
    fireEvent.click(radio(STALL_LEVEL_TEXT.log.label));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio(STALL_LEVEL_TEXT.log.label)).not.toBeChecked();
  });

  it('a 2xx body that fails the wire guard is the same unconfirmed outcome', async () => {
    const { read } = await mount(swView());
    vi.spyOn(api, 'setStallWatch').mockResolvedValue({ chosen: 'nope' } as unknown as StallWatchView);
    fireEvent.click(radio(STALL_LEVEL_TEXT.log.label));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('a write whose answer never arrived says it could not be confirmed, never "Nothing was changed", and re-reads', async () => {
    const { read } = await mount(swView());
    vi.spyOn(api, 'setStallWatch').mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.click(radio(STALL_LEVEL_TEXT.log.label));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/^Nothing was changed/)).toBeNull();
    expect(radio(STALL_LEVEL_TEXT.log.label)).not.toBeChecked();
  });

  it('P2: a 500 toasts the cause the server named in its message, and re-reads', async () => {
    const { read } = await mount(swView());
    const cause = 'stall settings unreadable, nothing written: disk gone';
    vi.spyOn(api, 'setStallWatch').mockRejectedValue(
      new ApiError(500, { statusCode: 500, error: 'Internal Server Error', message: cause }));
    fireEvent.click(radio(STALL_LEVEL_TEXT.log.label));
    expect(await screen.findByText(`Nothing was changed: ${cause}`)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap', async () => {
    const { read } = await mount(swView({ chosen: swChosen({ quietMs: SW_H }),
      quiet: { ...swView().quiet, effectiveMs: SW_H, source: 'chosen' } }));
    const write = vi.spyOn(api, 'setStallWatch')
      .mockRejectedValueOnce(swConfirm(swEffect({ quietLowered: true, quietMs: { before: SW_H, after: SW_H / 2 } }), 'key-q'))
      .mockRejectedValueOnce(new ApiError(400, { ok: false, error: 'bad-request', detail: 'quietMs must be a 30-minute step' }));
    const select = within(section()).getByRole('combobox', { name: STALL_SECTION_TEXT.quiet }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: String(SW_H / 2) } });
    const sheet = await screen.findByRole('dialog');
    expect(select.value).toBe(String(SW_H));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(select.value).toBe(String(SW_H));
    fireEvent.change(select, { target: { value: String(3 * SW_H) } });
    expect(await screen.findByText('Nothing was changed: quietMs must be a 30-minute step')).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(select.value).toBe(String(SW_H));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('P3: the controls are locked while a write is in flight: a second choice sends nothing, and the answer unlocks them', async () => {
    await mount(swView());
    const flight = Promise.withResolvers<StallWatchView>();
    const write = vi.spyOn(api, 'setStallWatch').mockReturnValue(flight.promise);
    const select = within(section()).getByRole('combobox', { name: STALL_SECTION_TEXT.quiet });
    fireEvent.click(radio(STALL_LEVEL_TEXT.log.label));
    for (const r of within(section()).getAllByRole('radio')) expect(r).toBeDisabled();
    expect(select).toBeDisabled();
    fireEvent.change(select, { target: { value: String(SW_H) } });
    fireEvent.click(radio(STALL_LEVEL_TEXT.all.label));
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => {
      flight.resolve(swView({ chosen: swChosen({ level: 'log' }),
        effective: swEffective({ source: 'chosen', level: 'log', stages: SW_LOG }) }));
      await flight.promise;
    });
    await waitFor(() => expect(radio(STALL_LEVEL_TEXT.log.label)).toBeChecked());
    expect(radio(STALL_LEVEL_TEXT.all.label)).toBeEnabled();
    expect(select).toBeEnabled();
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsScreen — stall watch: source scans (P6, P9)', () => {
  const sectionSrc = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'StallWatchSection.tsx'), 'utf8');
  const hookSrc = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'useStallWatchView.ts'), 'utf8');
  const DEVICE_WORD = /\b(phones?|mobiles?|desktops?|tablets?|laptops?|iphones?|ipads?|android|touchscreens?|handsets?)\b/i;
  const DEVICE_BRANCH = /matchMedia|useMediaQuery|userAgent|maxTouchPoints|ontouchstart|pointer:\s*coarse|innerWidth/;
  const l0Strings = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : typeof v === 'object' && v !== null ? Object.values(v).flatMap(l0Strings) : [];

  it('P6: the section and its hook have no device branch and no device word', () => {
    for (const [name, src] of [['StallWatchSection.tsx', sectionSrc], ['useStallWatchView.ts', hookSrc]]) {
      expect(src, name).not.toMatch(DEVICE_BRANCH);
      expect(src, name).not.toMatch(DEVICE_WORD);
    }
  });

  it('P6: no L0 STALL_* string names a device, and the Notifications row says push', () => {
    const strings = Object.entries(L0).filter(([k]) => k.startsWith('STALL_')).flatMap(([, v]) => l0Strings(v));
    expect(strings.length).toBeGreaterThan(80);
    for (const s of strings) expect(s).not.toMatch(DEVICE_WORD);
    const screenSrc = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
    expect(screenSrc).toContain('<span>Push notifications for this browser</span>');
    expect(screenSrc).not.toMatch(/Phone notifications/);
  });

  it('P9: the section spells no level id — every level reaches it from L0', () => {
    for (const level of STALL_LEVELS) expect(sectionSrc).not.toMatch(new RegExp(`['"\`]${level}['"\`]`));
    expect(sectionSrc).toMatch(/STALL_LEVELS\.map/);
  });
});
````

- [ ] **Step 3: Run the suite to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/settings-screen.test.tsx`

Expected (measured on the prototype): the file fails to load,
`Error: Failed to resolve import "../src/screens/StallWatchSection" from "test/settings-screen.test.tsx". Does the file exist?`,
with `Test Files  1 failed (1)` and `Tests  no tests`. The baseline before Step 2 was `Tests  132 passed (132)`.

- [ ] **Step 4: Implement**

(a) Create `pwa/src/screens/StallWatchSection.tsx`, in full. The listing is the first cut: fix rounds 1 and 2 changed the network arm, the quiet select and the imports, and the shipped file governs.

````tsx
// The Settings screen's third section, Stall watch (stall watch settings, design 2026-10-05 §13; programme
// stall-watch-settings W2 Task 3). What the watch does now, the next step up its ladder, the level and quiet-time
// controls, and the notice counts, over the section's OWN read of GET /api/coord/stall-watch (`useStallWatchView`,
// beside the screen's one /api/updates poll that the other two sections share).
//
// Four rules this file keeps, each pinned in settings-screen.test.tsx:
//   * NOT AVAILABLE WINS. A 501 not-configured, or the 404 not-found an older server answers, replaces the whole
//     body, even over a view that landed before (older-server-404-reads-not-configured (D-4035)): after a rollback
//     to a build without the route, an old choice with its radio checked must not stay on screen.
//   * THE SERVER'S ANSWER IS WHAT IS SHOWN. The checked radio and the selected quiet time come from the reply,
//     never from the tap. A write settles its reply; a refused or unreadable write re-reads.
//   * THE SERVER DECIDES THE CONFIRM (server-decides-the-confirm (D-4033)). A write goes out with only the field
//     moved and no key. A 409 confirm-required opens the sheet from the effect the server measured, and Set sends
//     the same body again with the server's key, so a key the server no longer matches opens a fresh sheet. The
//     sheet says, stage by stage, what the write turns on and what stops (confirm-on-stage-diff (D-4034)).
//   * NO LADDER HERE. The section spells no level id and keeps no ladder column: the Now and Next blocks, the files'
//     reading and every write's effect come from the wire, and every word is an L0 STALL_* constant, filled by
//     `fillStallText`. There is no viewport, pointer or user-agent branch.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  STALL_BUSY_GATE_OFF_TEXT, STALL_BUSY_GATE_TEXT, STALL_CONFIRM_TEXT, STALL_FALLBACK_TEXT, STALL_FILES_EXCEED_TEXT,
  STALL_FOLLOW_LABEL, STALL_HAZARD_TEXT, STALL_HELD_REASON, STALL_HELD_TEXT, STALL_LEVELS, STALL_LEVEL_TEXT,
  STALL_NEXT_TEXT, STALL_NOTICE_TEXT, STALL_NOT_AVAILABLE_TEXT, STALL_QUIET_NOTE, STALL_RUNLESS_FOOTNOTE,
  STALL_SECTION_TEXT, STALL_SOURCE_TEXT, STALL_STAGES, STALL_STAGE_TEXT, STALL_STORED_TEXT,
  type StallConfirmRequired, type StallHeld, type StallLevel, type StallLevelChoice, type StallNoticeCount,
  type StallStage, type StallWatchEffective, type StallWatchRequest, type StallWatchView, type StallWriteEffect,
} from '../../../shared/api';
import { QuickConfirm } from '../components/QuickConfirm';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import {
  asStallWatchView, stallWriteRefusal, useStallWatchView, type StallWatchPoll,
} from '../fleet/useStallWatchView';
import { api } from '../lib/api';
import { UNCONFIRMED_TEXT } from './SettingsScreen';

/** Fill each `{name}` slot of an L0 text from `slots`. A slot it was not given stays as written; a value is
 *  inserted literally (a replacer function, so a `$` in a server's detail is never a replacement pattern). */
export function fillStallText(text: string, slots: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(slots, key) ? (slots[key] ?? whole) : whole));
}

/** A span in hours and minutes, "30 min", "2 h", "1 h 30 min": every duration the section shows comes off the
 *  wire (the quiet bounds, step and built-in, the counts window) and is written by this one function. */
export function quietText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** One option of the quiet-time select: `default` (the built-in) or a value in milliseconds. */
export interface StallQuietChoice { value: number | 'default'; label: string }

/** "Built-in (<builtInMs>)", then every `stepMs` step from `minMs` to `maxMs` except the one equal to `builtInMs`,
 *  so the built-in value appears once. Every number is the reply's own (`useStallWatchView`'s guard bounds the
 *  list's length). */
export function quietChoices(view: StallWatchView): StallQuietChoice[] {
  const { builtInMs, minMs, maxMs, stepMs } = view.quiet;
  const choices: StallQuietChoice[] = [
    { value: 'default', label: fillStallText(STALL_SECTION_TEXT.builtInOption, { value: quietText(builtInMs) }) },
  ];
  for (let ms = minMs; ms <= maxMs; ms += stepMs) {
    if (ms !== builtInMs) choices.push({ value: ms, label: quietText(ms) });
  }
  return choices;
}

/** How a Now line is drawn: the level heading, an ordinary note, or an amber one (a hold, a hazard, a stored or
 *  applied choice that is not what it seems). */
export type StallNowTone = 'head' | 'note' | 'warn';
export interface StallNowLine { text: string; tone: StallNowTone }

const HELD_FLAGS = Object.keys(STALL_HELD_TEXT) as Array<keyof StallHeld>;

const levelLabel = (level: StallLevel | 'custom'): string =>
  level === 'custom' ? STALL_SECTION_TEXT.custom : STALL_LEVEL_TEXT[level].label;

/** The source line. A held source names the CHOSEN level and why the fleet box holds it; a held reading over a
 *  choice that is not a level is not a reply the server builds, and draws no source line rather than a guess. */
function sourceLine(effective: Extract<StallWatchEffective, { measured: true }>,
  chosen: StallWatchView['chosen']['level']): string | null {
  if (effective.source !== 'held') return STALL_SOURCE_TEXT[effective.source];
  if (chosen === 'follow' || chosen === 'unreadable') return null;
  const reason = effective.held.watchOff ? STALL_HELD_REASON.watchOff : STALL_HELD_REASON.gateStrict;
  return fillStallText(STALL_SOURCE_TEXT.held, { label: STALL_LEVEL_TEXT[chosen].label, reason });
}

/** Exactly one line whenever the stored row does not apply whole, and none when it does. */
function storedLine(chosen: StallWatchView['chosen']): string | null {
  if (chosen.stored === 'absent') return STALL_STORED_TEXT.absent;
  if (chosen.stored === 'unreadable') return STALL_STORED_TEXT.unreadable;
  const level = chosen.level === 'unreadable';
  const quiet = chosen.quietMs === 'unreadable';
  if (level && quiet) return STALL_STORED_TEXT.both;
  if (level) return STALL_STORED_TEXT.level;
  return quiet ? STALL_STORED_TEXT.quiet : null;
}

/**
 * The Now block, top to bottom (§13): the effective level and its `does` text (or Custom and the stages that are
 * on, or Unknown, never Off); the busy gate; the source; one line per held flag; the hazard line; the files-exceed
 * line; the stored-choice line; the fallback line. Every condition reads a wire fact, so no level id is spelled.
 *
 * The busy-gate-off note names one cause only: a level read from the fleet box's files that runs without the gate.
 * Under a chosen level the ladder sets the gate, and while mail is off the gate reads off for that reason, which the
 * mail-off held line gives instead.
 */
export function stallNowLines(view: StallWatchView): StallNowLine[] {
  const { effective, chosen } = view;
  const lines: StallNowLine[] = [];
  const push = (text: string, tone: StallNowTone): void => { lines.push({ text, tone }); };
  if (!effective.measured) {
    push(STALL_SECTION_TEXT.unknown, 'head');
  } else {
    const { stages, held, level } = effective;
    push(levelLabel(level), 'head');
    if (level === 'custom') {
      const on = STALL_STAGES.filter((s) => stages[s]).map((s) => STALL_STAGE_TEXT[s].name);
      if (on.length > 0) push(on.join(', '), 'note');
    } else {
      push(STALL_LEVEL_TEXT[level].does, 'note');
    }
    if (stages.busyGate) {
      push(stages.busyDelivery ? STALL_BUSY_GATE_TEXT.holds : `${STALL_BUSY_GATE_TEXT.holds} ${STALL_BUSY_GATE_TEXT.logs}`, 'note');
    } else if (effective.source === 'files' && stages.runs && level !== 'custom' && !held.mailOff) {
      push(STALL_BUSY_GATE_OFF_TEXT, 'note');
    }
    const source = sourceLine(effective, chosen.level);
    if (source !== null) push(source, 'note');
    for (const flag of HELD_FLAGS) if (held[flag]) push(STALL_HELD_TEXT[flag], 'warn');
    if (stages.alerts && stages.wave2 && !stages.busyDelivery && !held.mailOff) push(STALL_HAZARD_TEXT, 'warn');
    if (effective.filesExceed === true) push(STALL_FILES_EXCEED_TEXT, 'warn');
  }
  const stored = storedLine(chosen);
  if (stored !== null) push(stored, 'warn');
  if (view.fallback !== null) push(fillStallText(STALL_FALLBACK_TEXT, { reason: view.fallback.reason }), 'warn');
  return lines;
}

/** The Next step block, or null when there is none to show: an unmeasured reading, a `next` not stated, and
 *  `none` all draw nothing. `waitsOn` is the gate of each listed stage; the busy gate has none, and the server
 *  never lists it. */
export function stallNextLines(effective: StallWatchEffective): { lead: string; waitsOn: string[] } | null {
  if (!effective.measured || effective.next === undefined || effective.next.kind === 'none') return null;
  if (effective.next.kind === 'top') return { lead: STALL_NEXT_TEXT.top, waitsOn: [] };
  const waitsOn = effective.next.waitsOn
    .map((s) => STALL_STAGE_TEXT[s].gate)
    .filter((gate): gate is NonNullable<typeof gate> => gate !== null);
  return { lead: `${STALL_NEXT_TEXT.lead} ${STALL_LEVEL_TEXT[effective.next.level].label}.`, waitsOn };
}

/** One counts row: "<label> — <sent> sent · <shadow> shadow". */
export function stallCountLine(count: StallNoticeCount): string {
  const sent = fillStallText(STALL_SECTION_TEXT.sent, { count: String(count.sent) });
  const shadow = fillStallText(STALL_SECTION_TEXT.shadow, { count: String(count.shadow) });
  return `${STALL_NOTICE_TEXT[count.row]} — ${sent} · ${shadow}`;
}

/** The sheet's title, from the request the section sent: a level, Follow, or a quiet time (the built-in by its
 *  value and the word built-in). */
export function stallConfirmTitle(request: StallWatchRequest, builtInMs: number): string {
  const { level, quietMs } = request;
  if (level === 'follow') return fillStallText(STALL_CONFIRM_TEXT.followTitle, { label: STALL_FOLLOW_LABEL });
  if (level !== undefined) return fillStallText(STALL_CONFIRM_TEXT.title, { label: STALL_LEVEL_TEXT[level].label });
  const value = typeof quietMs === 'number'
    ? quietText(quietMs)
    : fillStallText(STALL_SECTION_TEXT.builtIn, { value: quietText(builtInMs) });
  return fillStallText(STALL_CONFIRM_TEXT.quietTitle, { value });
}

/** The stages that make a recorded notice due when they turn on: checks, reports and pushes, the further checks.
 *  Busy delivery makes only held mail due, and the busy gate nothing. */
const NOTICE_STAGES: readonly StallStage[] = ['checks', 'alerts', 'wave2'];

/**
 * The sheet's lines, from the effect the server measured at the write (§13), in this order: the target level's
 * `does` (none for Follow); a line per stage turning on; a `stops` line per stage turning off, and the further
 * checks' when the write leaves them from either reading; the held line; what falls due; the quiet-time lines; the
 * files-exceed line. No rank is involved: every choice reads a stage's own before and after.
 *
 * A stage turning on only in the unheld reading (held by the kill switch or the strict gate) takes its turn-on
 * line, never `backOn`, and makes nothing due until the hold lifts; the held line covers it. Under `mailOff` every
 * due and quiet line takes its mail-off variant, except `quietRecorded`, `quietOff` and the dialog line, which say
 * the same either way.
 */
export function stallConfirmLines(effect: StallWriteEffect, request: StallWatchRequest, builtInMs: number): string[] {
  if (!effect.measured) return [STALL_CONFIRM_TEXT.unknown];
  const { before, after, mailOff } = effect;
  const lines: string[] = [];
  if (request.level !== undefined && request.level !== 'follow') lines.push(STALL_LEVEL_TEXT[request.level].does);
  const turnsOnNow = (s: StallStage): boolean => !before[s] && after[s];
  for (const s of effect.turnsOn) {
    const { name, gate } = STALL_STAGE_TEXT[s];
    if (turnsOnNow(s) && !after.runs) lines.push(fillStallText(STALL_CONFIRM_TEXT.backOn, { name }));
    else if (gate === null) lines.push(fillStallText(STALL_CONFIRM_TEXT.turnsOnFree, { name }));
    else lines.push(fillStallText(STALL_CONFIRM_TEXT.turnsOn, { name, gate }));
  }
  for (const s of effect.turnsOff) lines.push(STALL_STAGE_TEXT[s].stops);
  if (effect.leavesWave2 && !effect.turnsOff.includes('wave2')) lines.push(STALL_STAGE_TEXT.wave2.stops);
  if (effect.heldByBox) lines.push(STALL_CONFIRM_TEXT.heldByBox);

  const on = effect.turnsOn.filter(turnsOnNow);
  const noticeDue = (before.runs && on.some((s) => NOTICE_STAGES.includes(s)))
    || (!before.runs && on.includes('checks'));
  if (noticeDue) {
    if (!mailOff) lines.push(before.runs ? STALL_CONFIRM_TEXT.due : STALL_CONFIRM_TEXT.dueFromOff);
    else lines.push(after.alerts ? STALL_CONFIRM_TEXT.dueMailOff : STALL_CONFIRM_TEXT.dueMailOffHeld);
  }
  if (on.includes('busyDelivery')) lines.push(mailOff ? STALL_CONFIRM_TEXT.dueMailBack : STALL_CONFIRM_TEXT.dueMail);

  if (effect.quietLowered) {
    const slots = { value: quietText(effect.quietMs.after) };
    const repeat = fillStallText(mailOff ? STALL_CONFIRM_TEXT.quietRepeatMailOff : STALL_CONFIRM_TEXT.quietRepeat, slots);
    if (effect.quietMs.after < effect.quietMs.before) {
      if (!after.runs) lines.push(STALL_CONFIRM_TEXT.quietOff);
      else if (!after.checks) lines.push(fillStallText(STALL_CONFIRM_TEXT.quietRecorded, slots));
      else if (after.wave2) {
        lines.push(fillStallText(mailOff ? STALL_CONFIRM_TEXT.quietDueAllMailOff : STALL_CONFIRM_TEXT.quietDueAll, slots));
      } else {
        lines.push(fillStallText(mailOff ? STALL_CONFIRM_TEXT.quietDueMailOff : STALL_CONFIRM_TEXT.quietDue, slots));
      }
    }
    if (after.checks && !after.wave2 && effect.quietMs.after < builtInMs) lines.push(repeat);
    if (after.alerts) lines.push(fillStallText(STALL_CONFIRM_TEXT.quietDialogs, slots));
  }
  if (effect.filesExceed) lines.push(STALL_FILES_EXCEED_TEXT);
  return lines;
}

/** The section: its heading, then one of four bodies. Not-configured comes FIRST, before any landed view (§13's one
 *  deliberate difference from the Updates section); "don't know yet" never borrows "nothing there". */
export function StallWatchSection(): ReactNode {
  const titleId = useId();
  const poll = useStallWatchView();
  const { view, failure } = poll;
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">{STALL_SECTION_TEXT.title}</h2>
      {failure === 'not-configured' ? (
        <p className="settings-note">{STALL_NOT_AVAILABLE_TEXT}</p>
      ) : view !== null ? (
        <StallWatchBody view={view} stale={failure === 'failed'} poll={poll} />
      ) : failure === 'failed' ? (
        <p className="settings-note">{STALL_SECTION_TEXT.unread}</p>
      ) : (
        <Skeleton lines={3} />
      )}
    </section>
  );
}

/** A write the server answered with 409 confirm-required: the request as the section sent it (no key), and the
 *  server's effect and key. */
interface PendingConfirm { request: StallWatchRequest; confirm: StallConfirmRequired }

const NOW_CLASS: Record<StallNowTone, string> = {
  head: 'settings-catalogue',
  note: 'settings-note',
  warn: 'settings-catalogue settings-catalogue--amber',
};
/** The select's value for the built-in, and for a stored value the list does not hold (an unreadable one): an
 *  empty option, drawn blank, so the select never shows a value the server did not answer. */
const QUIET_BUILT_IN = 'default';
const QUIET_NONE = '';

const levelOptions = (view: StallWatchView): Array<{ value: StallLevelChoice; label: string }> => {
  const { effective } = view;
  const theySay = effective.measured
    ? fillStallText(STALL_SECTION_TEXT.theySay, { level: levelLabel(effective.files) })
    : STALL_SECTION_TEXT.theySayUnknown;
  return [
    { value: 'follow', label: `${STALL_FOLLOW_LABEL} (${theySay})` },
    ...STALL_LEVELS.map((level) => ({ value: level, label: STALL_LEVEL_TEXT[level].label })),
  ];
};

function StallWatchBody({ view, stale, poll }: { view: StallWatchView; stale: boolean; poll: StallWatchPoll }): ReactNode {
  const { reload, settle } = poll;
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const locked = busy || pending !== null;

  // Only the field moved, and `confirm` only as the key the server sent. Every answer is the server's: a reply
  // that reads is settled, one that does not may have landed (UNCONFIRMED_TEXT, then a re-read), a 409 the guard
  // reads opens the sheet, and any other refusal is toasted with the server's detail before a re-read. A rejection
  // that never reached an answer (a network failure) may have landed too, so it says so, never "Nothing was changed".
  const write = (request: StallWatchRequest, confirm?: string): void => {
    setBusy(true);
    void api.setStallWatch(confirm === undefined ? request : { ...request, confirm })
      .then(
        (answer) => {
          const reply = answer === 'unreadable' ? null : asStallWatchView(answer);
          if (reply !== null) {
            settle(reply);
            return;
          }
          toast(UNCONFIRMED_TEXT);
          reload();
        },
        (err: unknown) => {
          const refusal = stallWriteRefusal(err);
          if (refusal.kind === 'confirm') {
            setPending({ request, confirm: refusal.confirm });
            return;
          }
          if (refusal.kind === 'unconfirmed') toast(UNCONFIRMED_TEXT);
          else toast(fillStallText(STALL_CONFIRM_TEXT.refused, { detail: refusal.detail }), 'error');
          reload();
        },
      )
      .finally(() => { setBusy(false); });
  };
  const choose = (request: StallWatchRequest): void => {
    if (!locked) write(request);   // the disabled fieldset stops a finger; this stops a second call
  };

  const now = stallNowLines(view);
  const next = stallNextLines(view.effective);
  const choices = quietChoices(view);
  const stored = view.chosen.quietMs;
  const quietValue = stored === 'default'
    ? QUIET_BUILT_IN
    : choices.some((c) => c.value === stored) ? String(stored) : QUIET_NONE;
  const quietLine = fillStallText(
    view.quiet.source === 'chosen' ? STALL_SECTION_TEXT.chosenHere : STALL_SECTION_TEXT.builtIn,
    { value: quietText(view.quiet.effectiveMs) });
  const range = fillStallText(STALL_SECTION_TEXT.range,
    { min: quietText(view.quiet.minMs), max: quietText(view.quiet.maxMs) });

  return (
    <>
      {stale && <p className="settings-note settings-catalogue--amber">{STALL_SECTION_TEXT.stale}</p>}
      {now.map((line, i) => <p key={i} className={NOW_CLASS[line.tone]}>{line.text}</p>)}
      {next !== null && <p className="settings-catalogue">{next.lead}</p>}
      {next !== null && next.waitsOn.length > 0 && (
        <>
          <p className="settings-note">{STALL_NEXT_TEXT.waitsOn}</p>
          <ul className="settings-note">{next.waitsOn.map((gate) => <li key={gate}>{gate}</li>)}</ul>
        </>
      )}
      <fieldset className="settings-fieldset" disabled={locked}>
        <legend className="settings-legend">{STALL_SECTION_TEXT.level}</legend>
        {levelOptions(view).map(({ value, label }) => (
          <label key={value} className="settings-option">
            <input
              type="radio"
              name="settings-stall-level"
              value={value}
              checked={view.chosen.level === value}
              onChange={() => choose({ level: value })}
            />
            <span className="settings-option-sentence">{label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="settings-fieldset" disabled={locked}>
        <legend className="settings-legend">{STALL_SECTION_TEXT.quiet}</legend>
        <p className="settings-catalogue">{quietLine}</p>
        <p className="settings-note">{range}</p>
        <select
          className="route-select"
          aria-label={STALL_SECTION_TEXT.quiet}
          value={quietValue}
          onChange={(e) => choose({ quietMs: e.target.value === QUIET_BUILT_IN ? 'default' : Number(e.target.value) })}
        >
          {quietValue === QUIET_NONE && <option value={QUIET_NONE} disabled hidden />}
          {choices.map((c) => (
            <option key={String(c.value)} value={String(c.value)}>{c.label}</option>
          ))}
        </select>
        <p className="settings-note">{STALL_QUIET_NOTE}</p>
      </fieldset>
      {view.notices.ok ? (
        <>
          <h3 className="settings-legend">
            {fillStallText(STALL_SECTION_TEXT.counts, { window: quietText(view.notices.windowMs) })}
          </h3>
          <ul className="settings-note">
            {view.notices.counts.map((c) => <li key={c.row}>{stallCountLine(c)}</li>)}
          </ul>
        </>
      ) : (
        <p className="settings-note">{STALL_SECTION_TEXT.countsFailed}</p>
      )}
      <p className="settings-note">{STALL_RUNLESS_FOOTNOTE}</p>
      <QuickConfirm
        open={pending !== null}
        title={pending === null ? '' : stallConfirmTitle(pending.request, view.quiet.builtInMs)}
        consequence={pending === null ? [] : stallConfirmLines(pending.confirm.effect, pending.request, view.quiet.builtInMs)}
        confirmLabel={STALL_CONFIRM_TEXT.confirm}
        onConfirm={() => { if (pending !== null) write(pending.request, pending.confirm.effectKey); }}
        onClose={() => setPending(null)}
      />
    </>
  );
}
````

(b) `pwa/src/screens/SettingsScreen.tsx`, six edits, each "before" measured once in Step 1.

The header comment (≈:1–7). Replace

```ts
// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Two sections and no more — Updates (the channel,
// auto-install, *Check now*, the catalogue line, the release list, the node
// inventory) and Notifications (the bell, release notifications, the
// unarmed-exposure banner) — both shipped in this file, below the header
// (Tasks 7–10 of the W3 plan; fix rounds 1–2 widened several of their
// guards in place — see the plan's `## Deviations found`, D-3315/D-3316).
```

with

```ts
// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Three sections and no more — Updates (the channel,
// auto-install, *Check now*, the catalogue line, the release list, the node
// inventory) and Notifications (the bell, release notifications, the
// unarmed-exposure banner), both shipped in this file, below the header
// (Tasks 7–10 of the W3 plan; fix rounds 1–2 widened several of their
// guards in place — see the plan's `## Deviations found`, D-3315/D-3316);
// and Stall watch (stall watch settings, design 2026-10-05 §13), which lives
// in its own file, `StallWatchSection.tsx`, with its own read.
```

The import (≈:21). Replace

```ts
import { NotificationBell } from '../fleet/NotificationBell';
```

with

```ts
import { NotificationBell } from '../fleet/NotificationBell';
import { StallWatchSection } from './StallWatchSection';
```

The Notifications block comment (≈:554). Replace

```ts
//   * The PHONE-PUSH toggle is the literal <NotificationBell/> — the same
```

with

```ts
//   * The PUSH toggle is the literal <NotificationBell/> — the same
```

The row label (≈:650; `notifications-label-says-push` (D-4036)). Replace

```tsx
          <span>Phone notifications for this browser</span>
```

with

```tsx
          <span>Push notifications for this browser</span>
```

The ONE-poll comment (≈:677–678). Replace

```ts
  // ONE poll and ONE clock for the whole screen: every section reads the same
  // answer (Tasks 7–10), so two sections can never disagree about the fleet.
```

with

```ts
  // ONE /api/updates poll and ONE clock for the Updates and Notifications
  // sections: both read the same answer (Tasks 7–10), so they can never
  // disagree about the fleet. The Stall watch section reads its own endpoint
  // through its own hook (useStallWatchView, design 2026-10-05 §13).
```

The render (≈:691). Replace

```tsx
      <NotificationsSection view={poll.view} reload={poll.reload} />
```

with

```tsx
      <NotificationsSection view={poll.view} reload={poll.reload} />
      <StallWatchSection />
```

- [ ] **Step 5: Run the suite to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/settings-screen.test.tsx | grep -E '^ +Tests '`

Expected (measured): `Tests  183 passed (183)`: the 132 already there, and 51 new (26 helpers, 22 section, 3 scans).

- [ ] **Step 6: The regression suites, the typecheck and the build**

Each line is its own foreground Bash call (timeout at least 600000 ms): one test file per command, the build alone and
the whole PWA suite alone, so no single call can run past the tool's 600 s limit under load and lose its output.

```bash
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/settings-screen.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/use-stall-watch-view.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/primitives.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/app.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/tsc --noEmit -p . && echo tsc-clean
cd "$(git rev-parse --show-toplevel)/pwa" && npm run build 2>&1 | grep -E 'built in|error'
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run 2>&1 | grep -E '^ +(Test Files|Tests) '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-settings.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/child-reclaim-generation.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/no-routing-keystroke-from-server.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/resume-reclaim-l0.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/pane-history-route.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/run-routes.test.ts | grep -E '^ +Tests '
```

Expected, in order (measured at `825fd1965` unless named): `Tests  183 passed (183)`, `Tests  31 passed (31)`,
`Tests  22 passed (22)`, `Tests  17 passed (17)`, `Tests  98 passed (98)` (the last three measured at the first
prototype; the fix round changes none of their files, and the whole-suite run below passed them); `tsc-clean`; `✓ built in …` and no error (measured `✓ built in 2.32s`); the whole PWA suite
`Test Files  106 passed (106)`, `Tests  3320 passed (3320)`, measured green in one run at load average ≈25. The first
prototype's whole-suite runs under heavier load measured one `session-pickers.test.tsx` row (`a tap on High calls
api.route once, never api.prompt, and renders queued`) over its 5000 ms timeout (5645 ms); alone it is
`Tests 30 passed (30)`. It touches no Settings code; a red there is re-run alone before it is called real. The
server scans that walk `pwa/src` stay green and unedited: `single-definition 274`, `child-reclaim-generation 23`,
`no-routing-keystroke-from-server 3`, `resume-reclaim-l0 18`, `pane-history-route 23`, `run-routes 230`, each
`passed` (measured at `825fd1965`). `stall-settings` reads the count the Baseline recorded from `main` after W1, not
the prototype's: it measured 62 at W1 Task 1 and `114 passed (114)` at the W1 prototype's tip `a5fa943c6`,
and W1's later tasks and fix rounds raise it.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/screens/StallWatchSection.tsx pwa/src/screens/SettingsScreen.tsx pwa/test/settings-screen.test.tsx
git commit -m "$(cat <<'MSG'
feat(pwa): the Stall watch section on the Settings page

A third Settings section, Stall watch, in its own file
(pwa/src/screens/StallWatchSection.tsx) over its own read
(useStallWatchView): the Now block (level, busy gate, source, held,
hazard, files-exceed, stored and fallback lines), the Next step, the
level radios with Follow first, the quiet-time select with the built-in
once, the counts with the window from the wire, and the run-less
footnote. A 501 not-configured or a 404 not-found replaces the whole
body even over a landed view, older-server-404-reads-not-configured
(D-4035). A write sends only the field moved; a 409 confirm-required
opens a QuickConfirm sheet built from the server's effect and Set
re-POSTs with its key, server-decides-the-confirm (D-4033), the lines
per stage, confirm-on-stage-diff (D-4034). The Notifications row now
reads "Push notifications for this browser",
notifications-label-says-push (D-4036), its pin moved with it.
SettingsScreen's header names three sections and its ONE-poll comment
names the section's own hook.

The controls are locked while a write is in flight or its sheet is
open. A 500 toasts the cause the server named; a write whose answer
never arrived toasts the unconfirmed line and re-reads, never "Nothing
was changed".

settings-screen.test.tsx: 51 rows (P1, P1b, P2, P3, P3b, P3c, P3d, P5,
P6, P9-P12, M6, M24), each guard measured red under its mutation.
MSG
)"
```

- [ ] **Step 8: The mutation table, on the committed tree**

Apply each mutation alone to the committed tree, run
`cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/settings-screen.test.tsx`, record
the failing count and names, restore with
`git checkout -- pwa/src/screens/StallWatchSection.tsx pwa/src/screens/SettingsScreen.tsx pwa/src/fleet/useStallWatchView.ts`,
and end with `git status --short` empty. The
control is Step 5's green, `183 passed (183)`. Every row was measured on the prototype at `4937088a1` (the same files
as `825fd1965`), and the whole table again at the tip `e13dc1a6a`, after the final fix round removed the repeat-line
catch-all (D-4037): X14 and X18 moved, X57 went with the catch-all, X58 now guards the repeat line's mail-off
variant at Check, and every other row is unchanged. `SWS` is
`pwa/src/screens/StallWatchSection.tsx` and `H` is `pwa/src/fleet/useStallWatchView.ts`; X51, X59 and X60 mutate `H`
and are run against this file, so the section's rows that depend on Task 1 are measured here too. Each quoted text
occurs exactly once in its file, except the `          reload();` that X40 and X41 quote, which occurs twice in
`SWS`: each of those two rows names its arm (the line after the fulfilled arm's `toast(UNCONFIRMED_TEXT);`, or after
the rejection arm's `'error');`).

| # | Guard | Mutation | Red (measured failing count out of 183, test names) |
|---|---|---|---|
| X1 | P1 three-state render | SWS: `) : failure === 'failed' ? (` → `) : false ? (` | `1 failed`: "P1: pending is a skeleton, a failed first read says so, and a view renders — three states, never folded" |
| X2 | P1b not-configured wins over a landed view | SWS: render `view !== null` before `failure === 'not-configured'`, as the Updates section does (swap the first two arms of `StallWatchSection`'s conditional) | `1 failed`: "P1b: a 404 not-found after a landed view replaces the whole body — no Now block, no radio checked" |
| X3 | P2 checked from the server | SWS: add `const [tapped, setTapped] = useState<StallLevelChoice \| null>(null);` after `const locked = …`; `checked={(tapped ?? view.chosen.level) === value}`; `onChange={() => { setTapped(value); choose({ level: value }); }}` | `5 failed`: "P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked"; "P3: a 409 opens the sheet from its effect; Cancel sends nothing more and leaves the stored choice checked"; "P3: the controls are locked while a write is in flight: a second choice sends nothing, and the answer unlocks them"; "a write whose answer never arrived says it could not be confirmed, never "Nothing was changed", and re-reads"; "an unreadable 2xx says the write may have landed and re-reads; it installs nothing" |
| X4 | P3 Cancel sends nothing | SWS: `onClose={() => setPending(null)}` → `onClose={() => { if (pending !== null) write(pending.request); setPending(null); }}` | `4 failed`: "P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap"; "P3: Set re-POSTs the same body with confirm equal to effectKey, and the 2xx settles"; "P3: a 409 opens the sheet from its effect; Cancel sends nothing more and leaves the stored choice checked"; "P3c: a key the server no longer matches opens a fresh sheet from the fresh effect, and the next Set carries the new key" |
| X5 | P3 re-POST carries the key | SWS: `write(pending.request, pending.confirm.effectKey)` → `write(pending.request)` | `2 failed`: "P3: Set re-POSTs the same body with confirm equal to effectKey, and the 2xx settles"; "P3c: a key the server no longer matches opens a fresh sheet from the fresh effect, and the next Set carries the new key" |
| X6 | P3 the server decides the confirm | SWS: `if (!locked) write(request);` → `if (!locked) setPending({ request, confirm: { ok: false, error: 'confirm-required', effect: { measured: false }, effectKey: '' } });` | `12 failed`: "P2: a 500 toasts the cause the server named in its message, and re-reads"; "P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap"; "P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked"; "P3: Set re-POSTs the same body with confirm equal to effectKey, and the 2xx settles"; "P3: a 409 opens the sheet from its effect; Cancel sends nothing more and leaves the stored choice checked"; "P3: a write answered 2xx at once sends only the field moved, opens no sheet, and settles the reply"; "P3: the controls are locked while a write is in flight: a second choice sends nothing, and the answer unlocks them"; "P3: the quiet select writes { quietMs } alone, and "Built-in" writes default"; "P3c: a key the server no longer matches opens a fresh sheet from the fresh effect, and the next Set carries the new key"; "a 2xx body that fails the wire guard is the same unconfirmed outcome"; "a write whose answer never arrived says it could not be confirmed, never "Nothing was changed", and re-reads"; "an unreadable 2xx says the write may have landed and re-reads; it installs nothing" |
| X7 | P3c a stale key opens a fresh sheet | SWS: `if (refusal.kind === 'confirm') {` → `if (refusal.kind === 'confirm' && confirm === undefined) {` | `1 failed`: "P3c: a key the server no longer matches opens a fresh sheet from the fresh effect, and the next Set carries the new key" |
| X8 | P3b Off over a busy file says back on | SWS: `if (turnsOnNow(s) && !after.runs) lines.push` → `if (false) lines.push` | `1 failed`: "P3b: Off over a busy file says busy delivery comes back, never the generic turn-on line" |
| X9 | P3d busy delivery alone is not `due` | SWS: `['checks', 'alerts', 'wave2']` → `['checks', 'alerts', 'wave2', 'busyDelivery']` | `2 failed`: "P3b: Off over a busy file says busy delivery comes back, never the generic turn-on line"; "P3d: busy delivery alone makes mail due, never a recorded notice" |
| X10 | P3d due lines under mail off | SWS: `if (!mailOff) lines.push(before.runs` → `if (true) lines.push(before.runs` | `1 failed`: "P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not" |
| X11 | P3d `dueMailBack` under mail off | SWS: `mailOff ? STALL_CONFIRM_TEXT.dueMailBack : STALL_CONFIRM_TEXT.dueMail` → `STALL_CONFIRM_TEXT.dueMail` | `1 failed`: "P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not" |
| X12 | P3d the quiet line by what runs after | SWS: `if (!after.runs) lines.push(STALL_CONFIRM_TEXT.quietOff)`, `else if (!after.checks) lines.push(fillStallText(STALL_CONFIRM_TEXT.quietRecorded` and `      else if (after.wave2) {`: each condition → `false` | `2 failed`: "P3d: a lowered quiet time is worded by what runs after the write: off, Log, Check, Everything; dialogs with alerts"; "P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not" |
| X13 | P3d `quietDueMailOff` | SWS: `mailOff ? STALL_CONFIRM_TEXT.quietDueMailOff : STALL_CONFIRM_TEXT.quietDue` → `STALL_CONFIRM_TEXT.quietDue` | `1 failed`: "P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not" |
| X14 | P3d the dialog line | SWS: delete the line `    if (after.alerts) lines.push(fillStallText(STALL_CONFIRM_TEXT.quietDialogs, slots));` | `3 failed`: "P3d: a lowered quiet time is worded by what runs after the write: off, Log, Check, Everything; dialogs with alerts"; "P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not"; "the order: does, turn-ons, stops, the held line, what falls due, the quiet lines, the files-exceed line" |
| X15 | P3d the held line | SWS: delete the line `  if (effect.heldByBox) lines.push(STALL_CONFIRM_TEXT.heldByBox);` | `1 failed`: "P3d: stages held by the kill switch take their turn-on lines and the held line — no backOn, nothing due" |
| X16 | P3d a held stage never takes `backOn` | SWS: `if (turnsOnNow(s) && !after.runs)` → `if (!after.runs)` | `1 failed`: "P3d: stages held by the kill switch take their turn-on lines and the held line — no backOn, nothing due" |
| X17 | P3d a held stage makes nothing due | SWS: `const on = effect.turnsOn.filter(turnsOnNow);` → `const on = effect.turnsOn;` | `1 failed`: "P3d: stages held by the kill switch take their turn-on lines and the held line — no backOn, nothing due" |
| X18 | P3d `quietRepeat` below the built-in | SWS: `    if (after.checks && !after.wave2 && effect.quietMs.after < builtInMs) lines.push(repeat);` → `    if (false) lines.push(repeat);` | `4 failed`: "P3d: a lowered quiet time is worded by what runs after the write: off, Log, Check, Everything; dialogs with alerts"; "P3d: a quiet time raised but still below the built-in repeats the check note, with no due line"; "P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not"; "the order: does, turn-ons, stops, the held line, what falls due, the quiet lines, the files-exceed line" |
| X19 | `leavesWave2` shows the further checks' stops | SWS: delete the line `  if (effect.leavesWave2 && !effect.turnsOff.includes('wave2')) lines.push(STALL_STAGE_TEXT.wave2.stops);` | `1 failed`: "leaving the further checks shows the wave2 stops line once, from either reading" |
| X20 | P5 the footnote always shows | SWS: `      <p className="settings-note">{STALL_RUNLESS_FOOTNOTE}</p>` → `      {view.notices.ok && view.notices.counts.some((c) => c.sent + c.shadow > 0) && <p className="settings-note">{STALL_RUNLESS_FOOTNOTE}</p>}` | `1 failed`: "P5: the run-less footnote is always shown — zero counts, and counts that could not be read" |
| X21 | P6 no device branch (section) | SWS: `const locked = busy \|\| pending !== null;` → `const locked = busy \|\| pending !== null \|\| window.matchMedia('(max-width: 600px)').matches;` | `1 failed`: "P6: the section and its hook have no device branch and no device word" |
| X22 | P6 the renamed label (D-4036) | `SettingsScreen.tsx`: `<span>Push notifications for this browser</span>` → `<span>Phone notifications for this browser</span>` | `2 failed`: "reuses the literal NotificationBell where the browser can do Web Push"; "P6: no L0 STALL_* string names a device, and the Notifications row says push" |
| X23 | P9 no level id in the section | SWS: `} else if (effective.source === 'files' && stages.runs && level !== 'custom' && !held.mailOff) {` → `} else if (effective.source === 'files' && ['log', 'check', 'alert'].includes(level) && !held.mailOff) {` | `1 failed`: "P9: the section spells no level id — every level reaches it from L0" |
| X24 | P9 busy-gate-off names one cause | SWS: `level !== 'custom' && !held.mailOff) {` → `level !== 'custom') {` | `1 failed`: "P9: the busy-gate-off note shows for a files-read level without the gate, and only for that cause" |
| X25 | P10 the held source | SWS: insert `  if (effective.source === 'held') return STALL_SOURCE_TEXT.chosen;` as `sourceLine`'s first line | `1 failed`: "P10: a held source names the chosen level and the reason, never "Chosen here"" |
| X26 | P10 `none` draws no Next step | SWS: `effective.next.kind === 'none') return null;` → `effective.next.kind === 'none') return { lead: STALL_NEXT_TEXT.top, waitsOn: [] };` | `3 failed`: "M6: an unmeasured reading is "Unknown", never Off — and the chosen values still show"; "P10: the Next step renders from the wire — none and a missing next show nothing, an empty waitsOn no gates"; "P10: next.kind none shows no Next step, and a step with an empty waitsOn shows no "Waits on:"" |
| X27 | P10 no "Waits on:" for an empty list | SWS: `next.waitsOn.length > 0` → `next.lead !== STALL_NEXT_TEXT.top` | `1 failed`: "P10: next.kind none shows no Next step, and a step with an empty waitsOn shows no "Waits on:"" |
| X28 | P11 the files-exceed line | SWS: delete the line `    if (effective.filesExceed === true) push(STALL_FILES_EXCEED_TEXT, 'warn');` | `1 failed`: "P11: the files-exceed line follows effective.filesExceed, and nothing else" |
| X29 | P11 only on `filesExceed` | SWS: `effective.filesExceed === true` → `effective.source !== 'files'` | `1 failed`: "P11: the files-exceed line follows effective.filesExceed, and nothing else" |
| X30 | P12 the `both` line | SWS: delete the line `  if (level && quiet) return STALL_STORED_TEXT.both;` | `1 failed`: "P12: exactly one stored line whenever the stored row does not apply whole, and the fallback line" |
| X31 | P12 the fallback line | SWS: delete the line `  if (view.fallback !== null) push(fillStallText(STALL_FALLBACK_TEXT, { reason: view.fallback.reason }), 'warn');` | `1 failed`: "P12: exactly one stored line whenever the stored row does not apply whole, and the fallback line" |
| X32 | M6 Unknown is never Off (Now) | SWS: `push(STALL_SECTION_TEXT.unknown, 'head')` → `push(STALL_LEVEL_TEXT.off.label, 'head')` | `2 failed`: "M6: an unmeasured reading is "Unknown", never Off — and the chosen values still show"; "M6: an unmeasured reading renders "Unknown" and "they say: unknown", and no level is read as Off" |
| X33 | M6 "they say: unknown" | SWS: `: STALL_SECTION_TEXT.theySayUnknown;` → `: fillStallText(STALL_SECTION_TEXT.theySay, { level: STALL_LEVEL_TEXT.off.label });` | `1 failed`: "M6: an unmeasured reading renders "Unknown" and "they say: unknown", and no level is read as Off" |
| X34 | M6 the sheet's `unknown` line | SWS: `return [STALL_CONFIRM_TEXT.unknown];` → `return [];` | `1 failed`: "M6: the unmeasured effect gives the one unknown line" |
| X35 | M24 the hazard condition | SWS: `stages.alerts && stages.wave2 && !stages.busyDelivery && !held.mailOff` → `stages.alerts && !held.mailOff` | `1 failed`: "M24: the hazard line shows for alerts and the further checks without busy delivery, and not under mail off" |
| X36 | M24 its mail-off exception | SWS: `stages.alerts && stages.wave2 && !stages.busyDelivery && !held.mailOff` → `stages.alerts && stages.wave2 && !stages.busyDelivery` | `1 failed`: "M24: the hazard line shows for alerts and the further checks without busy delivery, and not under mail off" |
| X37 | the built-in appears once | SWS: `if (ms !== builtInMs) choices.push` → `if (true) choices.push` | `2 failed`: "quietChoices: the built-in first, then every step from min to max except the built-in, which appears once"; "renders the Now block, the Next step, the quiet time and the counts from the view" |
| X38 | the select shows no value it does not hold | SWS: delete the line `          {quietValue === QUIET_NONE && <option value={QUIET_NONE} disabled hidden />}` | `1 failed`: "an absent or unreadable stored level checks no radio, and the quiet select shows no built-in it does not hold" |
| X39 | `fillStallText` reads `$` literally | SWS: `return text.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(slots, key) ? (slots[key] ?? whole) : whole));` → `return Object.entries(slots).reduce((t, [k, v]) => t.replace(`{${k}}`, v), text);` | `1 failed`: "fillStallText fills each named slot, leaves a slot it was not given, and reads a $ in a value literally" |
| X40 | an unconfirmed write re-reads | SWS: delete the `          reload();` after the fulfilled arm's `          toast(UNCONFIRMED_TEXT);` | `2 failed`: "a 2xx body that fails the wire guard is the same unconfirmed outcome"; "an unreadable 2xx says the write may have landed and re-reads; it installs nothing" |
| X41 | a refused or unconfirmed rejection re-reads | SWS: delete the `          reload();` after the rejection arm's `else toast(…, 'error');` line | `4 failed`: "P2: a 500 toasts the cause the server named in its message, and re-reads"; "P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap"; "P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked"; "a write whose answer never arrived says it could not be confirmed, never "Nothing was changed", and re-reads" |
| X42 | a 2xx goes through the wire guard | SWS: `asStallWatchView(answer)` → `(answer as StallWatchView)` | `1 failed`: "a 2xx body that fails the wire guard is the same unconfirmed outcome" |
| X43 | the section is mounted | `SettingsScreen.tsx`: delete the line `      <StallWatchSection />` | `22 failed`: "M6: an unmeasured reading renders "Unknown" and "they say: unknown", and no level is read as Off"; "P10: next.kind none shows no Next step, and a step with an empty waitsOn shows no "Waits on:""; "P1: a later failed read keeps the landed view and adds the stale line"; "P1: pending is a skeleton, a failed first read says so, and a view renders — three states, never folded"; "P1b: a 404 not-found after a landed view replaces the whole body — no Now block, no radio checked"; "P1b: a 501 not-configured first read is the not-available text, not the unread line"; "P2: a 500 toasts the cause the server named in its message, and re-reads"; "P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap"; "P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked"; "P3: Set re-POSTs the same body with confirm equal to effectKey, and the 2xx settles"; "P3: a 409 opens the sheet from its effect; Cancel sends nothing more and leaves the stored choice checked"; "P3: a write answered 2xx at once sends only the field moved, opens no sheet, and settles the reply"; "P3: the controls are locked while a write is in flight: a second choice sends nothing, and the answer unlocks them"; "P3: the quiet select writes { quietMs } alone, and "Built-in" writes default"; "P3c: a key the server no longer matches opens a fresh sheet from the fresh effect, and the next Set carries the new key"; "P5: the run-less footnote is always shown — zero counts, and counts that could not be read"; "a 2xx body that fails the wire guard is the same unconfirmed outcome"; "a write whose answer never arrived says it could not be confirmed, never "Nothing was changed", and re-reads"; "an absent or unreadable stored level checks no radio, and the quiet select shows no built-in it does not hold"; "an unreadable 2xx says the write may have landed and re-reads; it installs nothing"; "is the third section, after Notifications, titled Stall watch"; "renders the Now block, the Next step, the quiet time and the counts from the view" |
| X44 | P3 the lock covers a write in flight (§13 item 3) | SWS: `const locked = busy \|\| pending !== null;` → `const locked = pending !== null;` | `1 failed`: "P3: the controls are locked while a write is in flight: a second choice sends nothing, and the answer unlocks them" |
| X45 | P3 `choose` sends nothing while locked | SWS: `if (!locked) write(request);` → `write(request);` | `1 failed`: "P3: the controls are locked while a write is in flight: a second choice sends nothing, and the answer unlocks them" |
| X46 | P2 the quiet select from the server, never the tap | SWS: add `const [tappedQuiet, setTappedQuiet] = useState<string \| null>(null);` after `const locked = …`; `value={quietValue}` → `value={tappedQuiet ?? quietValue}`; the select's `onChange` also runs `setTappedQuiet(e.target.value)` before `choose(…)` | `1 failed`: "P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap" |
| X47 | P1b a 501 first read is not available | SWS: `{failure === 'not-configured' ? (` → `{failure === 'not-configured' && view !== null ? (` | `1 failed`: "P1b: a 501 not-configured first read is the not-available text, not the unread line" |
| X48 | a network failure is never "Nothing was changed" | SWS: `          if (refusal.kind === 'unconfirmed') toast(STALL_CONFIRM_TEXT.unanswered);` and the `else ` before the next `toast(` deleted, so every non-confirm rejection takes the `refused` toast | `1 failed` of 187 (re-measured at fix round 3 against the shipped line): "a write whose answer never arrived says it was not confirmed, never "Saved" or "Nothing was changed", and re-reads" |
| X49 | P3c the fresh sheet shows the fresh effect, never the first | SWS: `setPending({ request, confirm: refusal.confirm });` → `setPending({ request, confirm: confirm === undefined \|\| pending === null ? refusal.confirm : { ...refusal.confirm, effect: pending.confirm.effect } });` | `1 failed`: "P3c: a key the server no longer matches opens a fresh sheet from the fresh effect, and the next Set carries the new key" |
| X50 | P6 no device word (section) | SWS: append the line `// the same on a phone` to the file | `1 failed`: "P6: the section and its hook have no device branch and no device word" |
| X51 | P6 no device branch (hook) | H: `export const STALL_WATCH_POLL_MS = 60_000;` → `export const STALL_WATCH_POLL_MS = window.innerWidth < 600 ? 120_000 : 60_000;` | `1 failed`: "P6: the section and its hook have no device branch and no device word" |
| X52 | P12 the `absent` line | SWS: delete the line `  if (chosen.stored === 'absent') return STALL_STORED_TEXT.absent;` | `2 failed`: "P12: exactly one stored line whenever the stored row does not apply whole, and the fallback line"; "an absent or unreadable stored level checks no radio, and the quiet select shows no built-in it does not hold" |
| X53 | P12 the `unreadable` line | SWS: delete the line `  if (chosen.stored === 'unreadable') return STALL_STORED_TEXT.unreadable;` | `2 failed`: "M6: an unmeasured reading is "Unknown", never Off — and the chosen values still show"; "P12: exactly one stored line whenever the stored row does not apply whole, and the fallback line" |
| X54 | P12 the `level` line | SWS: delete the line `  if (level) return STALL_STORED_TEXT.level;` | `1 failed`: "P12: exactly one stored line whenever the stored row does not apply whole, and the fallback line" |
| X55 | P12 the `quiet` line | SWS: `return quiet ? STALL_STORED_TEXT.quiet : null;` → `return null;` | `1 failed`: "P12: exactly one stored line whenever the stored row does not apply whole, and the fallback line" |
| X56 | P3d the due group under mail off | SWS: delete the line `    else lines.push(after.alerts ? STALL_CONFIRM_TEXT.dueMailOff : STALL_CONFIRM_TEXT.dueMailOffHeld);` | `1 failed`: "P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not" |
| X58 | P3d the repeat line at Check takes `quietRepeatMailOff` under mail off | SWS: `mailOff ? STALL_CONFIRM_TEXT.quietRepeatMailOff : STALL_CONFIRM_TEXT.quietRepeat` → `STALL_CONFIRM_TEXT.quietRepeat` (in `const repeat = …`) | `1 failed`: "P3d: under mail off, each due and quiet line takes its mail-off variant; the dialog line does not" |
| X59 | Task 1's 500 `message` arm, seen in the section | H: `nonBlank(body.detail) ?? nonBlank(body.message) ?? apiErrorText(err)` → `nonBlank(body.detail) ?? apiErrorText(err)` | `1 failed`: "P2: a 500 toasts the cause the server named in its message, and re-reads" |
| X60 | Task 1's unconfirmed arm, seen in the section | H: `  if (!(err instanceof ApiError)) return { kind: 'unconfirmed' };` → `  if (!(err instanceof ApiError)) return { kind: 'refused', detail: apiErrorText(err) };` | `1 failed` of 187 (re-measured at fix round 3): "a write whose answer never arrived says it was not confirmed, never "Saved" or "Nothing was changed", and re-reads" |
| X61 | the pinned option: a number off the list selects none (fix round 1, re-measured at fix round 3) | SWS: in `quietValue`, `choices.some((c) => c.value === stored)` → `typeof stored === 'number'` | `1 failed` of 187: "a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled plain like every step; one off the list … selects none" |
| X62 | the pinned option is not the built-in (M1a, fix round 2, re-measured) | SWS: `  const quietValue = stored === 'default'` → `  const quietValue = stored === 'default' \|\| stored === view.quiet.builtInMs`, so a pinned built-in number selects Built-in | `3 failed` of 187: "a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled plain like every step; one off the list … selects none"; "a pinned built-in number reads plain "2 h" in the select whatever the quiet line says: under a fallback (source default) …"; "from a pinned built-in number, picking Built-in is one change that writes default exactly once" |
| X63 | the pinned option is rendered (M1b, fix round 2, re-measured) | SWS: in `shown`, `if (pinnedBuiltIn === null) return choices;` → `if (pinnedBuiltIn === null \|\| pinnedBuiltIn !== null) return choices;`, so the extra option is never added | `4 failed` of 187: "a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled plain like every step; one off the list … selects none"; "a pinned built-in number reads plain "2 h" in the select whatever the quiet line says: under a fallback (source default) …"; "a pinned built-in number sits at its step's numeric place among the steps, between the step below and the step above"; "from a pinned built-in number, picking Built-in is one change that writes default exactly once" |
| X64 | the pinned option reads as a step, not as Built-in (M1c, fix round 2, re-measured) | SWS: the extra option's `label: quietText(pinnedBuiltIn)` → `label: fillStallText(STALL_SECTION_TEXT.builtIn, { value: quietText(pinnedBuiltIn) })` | `2 failed` of 187: "a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled plain like every step; one off the list … selects none"; "a pinned built-in number reads plain "2 h" in the select whatever the quiet line says: under a fallback (source default) …" |
| X65 | the pinned option's label claims no source (fix round 3) | SWS: the extra option's `label: quietText(pinnedBuiltIn)` → `label: fillStallText(STALL_SECTION_TEXT.chosenHere, { value: quietText(pinnedBuiltIn) })` | `2 failed` of 187: "a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled plain like every step; one off the list … selects none"; "a pinned built-in number reads plain "2 h" in the select whatever the quiet line says: under a fallback (source default) …" |
| X66 | the pinned option sits at its step's numeric place (fix round 3) | SWS: in `shown`, `const at = above === -1 ? choices.length : above;` → `const at = 1;`, so it sits right after Built-in | `1 failed` of 187: "a pinned built-in number sits at its step's numeric place among the steps, between the step below and the step above" |

Every row reds, so no guard here is unpinned. Rows X44 to X60 were added by the plan review's fix round, and X61 to X66 by fix rounds 2 and 3 (the pinned option, D-4044; counted out of 187). X57, added
with them for the repeat line on a raise, was removed with that line by the final fix round (D-4037), so the table has
no X57. X58 stays, re-described as the guard of the repeat line's mail-off variant at Check and re-measured at the tip
`e13dc1a6a`. X14 and X18 are back at their first counts, 3 and 4.

---

### Task 4: README's Settings paragraph names the Stall watch section, and the whole-wave checks

**Model routing:** `sonnet`, effort `medium`: prose in place, one pin file, then the wave's gates.

**Files:**
- Modify: `README.md` (≈953 at `77f8d63a5`, ≈960 at `origin/main` `d12b5aba0`): the Settings paragraph (it opens
  `**Settings, the update banner and release pushes (update-management W3).**`, ≈939) gains its third section after the
  Notifications sentence and before "In remote mode". One line becomes seventeen: `git diff --numstat` reads `17	1`.
- Create: `server/test/stall-settings-readme.test.ts` (81 lines): the README pin, five rows.
- Test: `server/test/stall-settings-readme.test.ts`.
- Run unedited: the whole PWA suite, the PWA build, `server/test/typecheck-tests.test.ts`,
  `single-definition.test.ts`, `topology-clean.test.ts`, the README citation instrument in `session-hook.test.ts`, and
  every server suite that reads `README.md` as prose (Step 7).

**Interfaces:**
- Consumes, from `shared/api.ts` (W1, appended after `MAIL_REPLAY_MS`):
  - `export const STALL_LEVEL_TEXT: { readonly off: { label: 'Off'; does: string }; readonly log: { label: 'Log only'; … }; … }` (≈9109);
  - `export const STALL_LEVELS = Object.keys(STALL_LEVEL_TEXT) as StallLevel[];` (≈9137);
  - `export const STALL_FOLLOW_LABEL = "Follow the fleet box's files";` (≈9236);
  - `export const STALL_SECTION_TEXT: { readonly title: 'Stall watch'; … }` (≈9310).
- Consumes, from `server/src/coord/stallsettings.ts` (W1): `export const STALL_QUIET_MIN_MS = 30 * 60_000;`,
  `export const STALL_QUIET_MAX_MS = 12 * 3_600_000;`, `export const STALL_QUIET_STEP_MS = 30 * 60_000;`,
  `export const STALL_NOTICE_WINDOW_MS = 48 * 3_600_000;` (≈67–71 at the W1 prototype's `ad2155ff4`, `d513b887f`
  and tip `a5fa943c6`; ≈60–64 at W1 Task 1's `2fb0123f7`; find them by content).
- Consumes, from `server/src/coord/stall.ts`: `export const STALL_QUIET_MS = 2 * 3_600_000;` (≈302), the built-in quiet
  time the view reports as `quiet.builtInMs`.
- Consumes, from W2 Tasks 1–3: the section as shipped (`StallWatchSection.tsx`, `useStallWatchView`'s
  `STALL_WATCH_POLL_MS = 60_000` and its visibility re-poll, the 409 sheet), which the README sentence describes.
- Produces: no code interface. The README's third-section sentence, and five pin rows tying it to L0 and L1.

**What the sentence says, and why each fact is pinned.** The sentence is prose about the section W2 Tasks 1–3 ship, so
it describes, and never restates, the ladder: the six labels are spelled once in L0 and the pin reads them from there.
A renamed level (row 3), a moved bound or window (row 4), a dropped route (row 2), a second copy of the lead sentence or
the section placed before Notifications (row 1), or a device word (row 5, the operator's 2026-10-05 "no device
distinction", §2) each reds one row. Row 5 uses the PWA's own device-word list, the plural-aware `DEVICE_WORD` of
`pwa/test/settings-screen.test.tsx`'s P6 scan, spelled again in the pin because a server test cannot import a PWA test
file. The sentence also says exactly when a write asks for confirmation, as spec §10's `stallNeedsConfirm` decides it
with W1's `quiet-raise-asks-nothing` (D-4037): a stage turning on, leaving the further checks, a quiet time moved below
the one before (never a raise), and every write while the registry cannot be listed. The paragraph's existing "the
phone-push bell" (≈951) is left as it is: §13 measured that nothing in README spells the Notifications row's label, so
`notifications-label-says-push` (D-4036) reaches no README line, and row 5 scans the third section's sentences only.
That phrase was put to the operator under "Open questions for the operator"; it is settled there (README now reads
"push bell"). **Superseded in place (shipped):** the phone-push phrase was not left as it was. README :967 reads
"push bell" (`a5771e471`, the operator's 2026-10-05 directive), and row 5 scans the whole Settings paragraph, not
only the new section's sentences (`505ffbff4`).

**README is in the citation corpus.** The edit adds 16 lines inside one paragraph. The citation instrument stays
`7 passed | 328 skipped (335)`, measured before and after:
`./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`.

**README's size claim.** `pools-prose.test.ts` holds `CLAUDE.md`'s `README.md` (~N lines) within 100 lines of the file.
Measured on the prototype (claim `~5600`): README 5684 → 5700, a gap of exactly 100, green (the row is
`toBeLessThanOrEqual(100)`). At `origin/main` `d12b5aba0` the claim reads `~5700` and README 5729; this task adds 16,
so with W1's README lines the gap stays within 100 unless W1 added more than 55 (the W1 prototype adds 14). Step 7 runs `pools-prose`; if its size row reds, set the figure in `CLAUDE.md`'s line 10
(`**`README.md` (~5700 lines)`) to the measured `wc -l < README.md` rounded to the nearest hundred, and add
`CLAUDE.md` to Step 8's `git add`.

- [ ] **Step 1: Re-anchor, and measure the instrument before**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -c "as the fleet intent's \`notify\` through \`POST /api/updates/intent\`. In remote mode the foot of the fleet screen always" README.md
grep -c 'Settings has a third section' README.md
wc -l < README.md
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
```

Expected: `1` (the anchor line, ≈953 at `77f8d63a5`, ≈960 at `d12b5aba0`); `0`; the README's line count (5684 at
`77f8d63a5`, 5729 at `d12b5aba0`, more after W1's README edits; record it); `Tests  7 passed | 328 skipped (335)`.

- [ ] **Step 2: Write the failing test**

Create `server/test/stall-settings-readme.test.ts`:

```ts
/**
 * STALL WATCH SETTINGS, the README's Settings paragraph (design 2026-10-05, §18 W2). The paragraph that tours
 * `/settings` gains its third section, and these rows pin what that sentence states to the values the build ships:
 * the section's title, its route, the Follow choice and the six level labels in the ladder's order, the quiet time's
 * built-in value, bounds and step, and the counts' window. A renamed level, a moved bound or a new window reds here
 * instead of leaving the README telling an old story. The labels come from L0 and the numbers from L1, so this file
 * copies no text but its anchor words.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STALL_FOLLOW_LABEL, STALL_LEVELS, STALL_LEVEL_TEXT, STALL_SECTION_TEXT } from '../../shared/api.js';
import { STALL_NOTICE_WINDOW_MS, STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS, STALL_QUIET_STEP_MS } from '../src/coord/stallsettings.js';
import { STALL_QUIET_MS } from '../src/coord/stall.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const README = readFileSync(path.resolve(here, '..', '..', 'README.md'), 'utf8');

/** The Settings paragraph, its wrapped lines joined with single spaces, from its bold lead to the blank line. */
function settingsParagraph(): string {
  const start = README.indexOf('**Settings, the update banner and release pushes');
  expect(start, 'the README has no Settings paragraph').toBeGreaterThan(-1);
  const end = README.indexOf('\n\n', start);
  return README.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
}

const SECOND = 'Settings has a second section, **Notifications**';
const THIRD = `Settings has a third section, **${STALL_SECTION_TEXT.title}**`;

/** The third section's sentences: from its lead to the paragraph's next topic, the fleet screen's `BuildLine`. */
function stallSentences(): string {
  const p = settingsParagraph();
  const start = p.indexOf(THIRD);
  expect(start, 'the Settings paragraph names no third section').toBeGreaterThan(-1);
  const end = p.indexOf('In remote mode', start);
  expect(end, 'the third section runs to the end of the paragraph').toBeGreaterThan(start);
  return p.slice(start, end);
}

/** The device words the PWA's own P6 scan refuses (`pwa/test/settings-screen.test.tsx`, its `DEVICE_WORD`), the same
 *  list spelled again here: a server test cannot import a PWA test file. */
const DEVICE_WORD = /\b(phones?|mobiles?|desktops?|tablets?|laptops?|iphones?|ipads?|android|touchscreens?|handsets?)\b/i;

/** A duration the way the section writes one: "30 min", "2 h", "1 h 30 min". */
function duration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return [h > 0 ? `${h} h` : '', m > 0 ? `${m} min` : ''].filter((s) => s !== '').join(' ');
}

describe("README's Settings paragraph names the Stall watch section (design 2026-10-05, §18 W2)", () => {
  it('names a third section, once, after the Notifications section', () => {
    const p = settingsParagraph();
    expect(p.indexOf(SECOND)).toBeGreaterThan(-1);
    expect(p.indexOf(THIRD)).toBeGreaterThan(p.indexOf(SECOND));
    expect(README.replace(/\s+/g, ' ').split(THIRD).length - 1).toBe(1);
  });

  it('names the route the section reads and writes', () => {
    expect(stallSentences()).toContain('`/api/coord/stall-watch`');
  });

  it("names the Follow choice and the six levels by their shipped labels, in the ladder's order", () => {
    const s = stallSentences();
    expect(s).toContain(`\`${STALL_FOLLOW_LABEL}\``);
    expect(STALL_LEVELS).toHaveLength(6);
    expect(s).toContain(STALL_LEVELS.map((l) => `\`${STALL_LEVEL_TEXT[l].label}\``).join(', '));
  });

  it("states the quiet time's built-in value, bounds and step, and the counts' window, as the build ships them", () => {
    const s = stallSentences();
    expect(s).toContain(`built-in ${duration(STALL_QUIET_MS)}`);
    expect(s).toContain(`${duration(STALL_QUIET_MIN_MS)} to ${duration(STALL_QUIET_MAX_MS)} in ${duration(STALL_QUIET_STEP_MS)} steps`);
    expect(s).toContain(`last ${duration(STALL_NOTICE_WINDOW_MS)}`);
  });

  it('names no device, as the section itself names none (§2, 2026-10-05)', () => {
    expect(stallSentences()).not.toMatch(DEVICE_WORD);
  });
});
```

- [ ] **Step 3: Run it red**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/stall-settings-readme.test.ts
```

Expected (measured on the prototype): `Tests  5 failed (5)`. Row 1 fails `expected -1 to be greater than 1257` (the
offset of the Notifications sentence in the joined paragraph; the number moves if the paragraph's earlier text moves);
rows 2–5 fail `the Settings paragraph names no third section: expected -1 to be greater than -1`.

- [ ] **Step 4: Edit the README in place**

In `README.md`, replace this ONE line (`grep -c` reads `1`, Step 1):

```
as the fleet intent's `notify` through `POST /api/updates/intent`. In remote mode the foot of the fleet screen always
```

with these seventeen lines (the next line, beginning `carries \`BuildLine\``, is unchanged):

```
as the fleet intent's `notify` through `POST /api/updates/intent`. Settings has a third section, **Stall watch**
(stall-watch-settings W2), read and written through `/api/coord/stall-watch` by a poll of its own, once a minute and
whenever the page is shown again. It shows the watch's level now, what it does and where it comes from (following
the fleet box's files, chosen here, or chosen but held back by the fleet box's kill switch or strict mail gate), the
next step and what it waits on, and the notice counts for the last 48 h, sent and shadow, on runs only. Its two
controls are the **Level** — `Follow the fleet box's files` (the default, today's behaviour) or one of six levels,
each including the ones below it: `Off`, `Log only`, `Check silent workers`, `Alert coordinator and you`,
`Deliver mail to busy sessions`, `Everything` — and the **Quiet time before a worker check** (built-in 2 h; 30 min
to 12 h in 30 min steps), which also times the pushes about a dialog left open. The checked option is the stored
answer, never the tap. The server answers 409, with what the write would do, to any write that would turn something
on, leave the further checks, or move the quiet time below what it was, and to every write
while the fleet box's files cannot be read; the section opens one confirm sheet from that answer, and **Set**
re-sends the write with the server's key, so nothing is written until the operator has confirmed what the server
will do. The choice is one row in `coord.db` and applies to the whole fleet. It never overrides
`stall-watch-disabled`, `mail-disabled` or `mail-gate-strict`; a lost row, or a field of it that cannot be read,
means the files and the built-in quiet time.
A server without the route shows the section as not available. In remote mode the foot of the fleet screen always
```

Every line is at most 116 characters (the longest, 116). The marker names are spelled as the README already spells them; README is not
under `single-definition.test.ts`'s `ROOTS` (`shared`, `server/src`, `pwa/src`, `agent/src`), and Step 7 re-runs that
suite and `topology-clean` all the same.

- [ ] **Step 5: Run it green, and the instrument after**

```bash
cd "$(git rev-parse --show-toplevel)"
git diff --numstat -- README.md
wc -l < README.md
cd server && ./node_modules/.bin/vitest run test/stall-settings-readme.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
```

Expected (measured): `17	1	README.md`; Step 1's count plus 16 (5700 on the prototype); `Tests  5 passed (5)`;
`Tests  7 passed | 328 skipped (335)`, unchanged.

- [ ] **Step 6: The mutation table**

Write the runner once, outside the tree (`INSTR` is the worker's scratchpad or the gitignored
`.superpowers/sdd/<plan>/`), and run it from the repo root on the uncommitted tree of Steps 2–4. Each row edits one
file, runs the pin, and restores that file's bytes; the last line must print the two intended changes only.

`$INSTR/readme-mutate.py`:

```python
#!/usr/bin/env python3
"""W2 Task 4's mutation rows. Run from the repo root before the commit: each row edits one file, runs the README
pin, restores the file's bytes, and the last line prints `git status --short`, which must list only this task's two
changes. Row A reads README at `README_BASE` (default `HEAD`, the commit before this task's README edit)."""
import os, re, subprocess

def third_before_second(s):
    """Move the third section's sentences, whole, to just before the Notifications sentence."""
    start = s.index('Settings has a third section, **Stall watch**')
    end = s.index('In remote mode', start)
    block = s[start:end]
    s = s[:start] + s[end:]
    at = s.index('Settings has a second section, **Notifications**')
    return s[:at] + block + s[at:]

ROWS = {
  'A README as at HEAD': ('README.md', None, None),
  'B rename the log label': ('shared/api.ts', "    label: 'Log only',", "    label: 'Log',"),
  'C quiet maximum 11 h': ('server/src/coord/stallsettings.ts', 'export const STALL_QUIET_MAX_MS = 12 * 3_600_000;', 'export const STALL_QUIET_MAX_MS = 11 * 3_600_000;'),
  'D counts window 24 h': ('server/src/coord/stallsettings.ts', 'export const STALL_NOTICE_WINDOW_MS = 48 * 3_600_000;', 'export const STALL_NOTICE_WINDOW_MS = 24 * 3_600_000;'),
  'E swap two levels in README': ('README.md', '`Off`, `Log only`, `Check', '`Log only`, `Off`, `Check'),
  'F a device word in README': ('README.md', 'whenever the page is shown again. It shows', 'whenever the page is shown again on a phone. It shows'),
  'G a second lead sentence': ('README.md', 'APPEND', '\nSettings has a third section, **Stall watch**, again.\n'),
  'H drop the route from README': ('README.md', 'read and written through `/api/coord/stall-watch` by a poll', 'read and written by a poll'),
  'I built-in quiet time 3 h': ('server/src/coord/stall.ts', 'export const STALL_QUIET_MS = 2 * 3_600_000;', 'export const STALL_QUIET_MS = 3 * 3_600_000;'),
  'J quiet minimum 1 h': ('server/src/coord/stallsettings.ts', 'export const STALL_QUIET_MIN_MS = 30 * 60_000;', 'export const STALL_QUIET_MIN_MS = 60 * 60_000;'),
  'K quiet step 1 h': ('server/src/coord/stallsettings.ts', 'export const STALL_QUIET_STEP_MS = 30 * 60_000;', 'export const STALL_QUIET_STEP_MS = 60 * 60_000;'),
  'L third section before Notifications': ('README.md', third_before_second, None),
  'M a plural or brand device word in README': ('README.md', 'whenever the page is shown again. It shows', 'whenever the page is shown again, on Android too. It shows'),
}
for name, (f, old, new) in ROWS.items():
    bak = open(f).read()
    if old is None:
        base = os.environ.get('README_BASE', 'HEAD')
        s = subprocess.run(['git', 'show', f'{base}:{f}'], capture_output=True, text=True, check=True).stdout
    elif callable(old):
        s = old(bak)
    elif old == 'APPEND':
        s = bak + new
    else:
        assert bak.count(old) == 1, (name, bak.count(old))
        s = bak.replace(old, new)
    assert s != bak, name
    open(f, 'w').write(s)
    try:
        r = subprocess.run(['./node_modules/.bin/vitest', 'run', 'test/stall-settings-readme.test.ts'],
                           cwd='server', capture_output=True, text=True, timeout=600)
        out = r.stdout + r.stderr
        tests = [l.strip() for l in out.splitlines() if re.match(r'^\s+Tests ', l)]
        fails = [l.strip()[2:].rsplit(' ', 1)[0] for l in out.splitlines() if l.strip().startswith('×')]
        print(f'{name}: {tests} {fails}')
    finally:
        open(f, 'w').write(bak)
print(repr(subprocess.run(['git', 'status', '--short'], capture_output=True, text=True).stdout))
```

```bash
cd "$(git rev-parse --show-toplevel)" && python3 "$INSTR/readme-mutate.py"
```

On the real branch leave `README_BASE` unset: `HEAD` is Task 3's commit, which has no third section. The prototype
had Task 4 committed already, so it was measured with `README_BASE=fc33c1563` (its Task 3 commit), in one foreground
call under the 600 s limit (13 rows).

| Row | Guard | Mutation | Red in | Measured |
|---|---|---|---|---|
| A | The third section is stated | README as at `README_BASE` (the sentence absent) | stall-settings-readme | 5 failed (5): all five rows |
| B | The levels are named by their shipped labels | `STALL_LEVEL_TEXT.log.label` `'Log only'` → `'Log'` | stall-settings-readme | 1 failed: "names the Follow choice and the six levels by their shipped labels, in the ladder's order" |
| C | The bounds are the shipped bounds | `STALL_QUIET_MAX_MS` 12 h → 11 h | stall-settings-readme | 1 failed: "states the quiet time's built-in value, bounds and step, and the counts' window, as the build ships them" |
| D | The window is the shipped window | `STALL_NOTICE_WINDOW_MS` 48 h → 24 h | stall-settings-readme | 1 failed: the same row as C |
| E | The levels are in the ladder's order | swap `` `Off` `` and `` `Log only` `` in README | stall-settings-readme | 1 failed: the same row as B |
| F | No device word | "shown again" → "shown again on a phone" | stall-settings-readme | 1 failed: "names no device, as the section itself names none (§2, 2026-10-05)" |
| G | One lead sentence | append a second "Settings has a third section, **Stall watch**" | stall-settings-readme | 1 failed: "names a third section, once, after the Notifications section" |
| H | The route is named | drop "through `` `/api/coord/stall-watch` ``" | stall-settings-readme | 1 failed: "names the route the section reads and writes" |
| I | The built-in is the shipped built-in | `STALL_QUIET_MS` 2 h → 3 h (`stall.ts`) | stall-settings-readme | 1 failed: the same row as C |
| J | The minimum is the shipped minimum | `STALL_QUIET_MIN_MS` 30 min → 60 min | stall-settings-readme | 1 failed: the same row as C |
| K | The step is the shipped step | `STALL_QUIET_STEP_MS` 30 min → 60 min | stall-settings-readme | 1 failed: the same row as C |
| L | The section comes after Notifications | move the third section's sentences, whole, to just before "Settings has a second section, **Notifications**" | stall-settings-readme | 2 failed: "names a third section, once, after the Notifications section"; "names no device, as the section itself names none (§2, 2026-10-05)" (the moved block's sentences now run to "In remote mode" across the Notifications sentence, whose "phone-push bell" the device row finds) |
| M | No device word, plural or brand | "shown again" → "shown again, on Android too" | stall-settings-readme | 1 failed: "names no device, as the section itself names none (§2, 2026-10-05)" (the earlier six-word pattern passed this row) |

The last line prints `' M README.md\n?? server/test/stall-settings-readme.test.ts\n'`. Rows B, C and D also red W1's
`stall-settings.test.ts` and the PWA suites that read those constants; the runner runs the pin alone, by design.

- [ ] **Step 7: The whole-wave checks**

Every line below is its own foreground Bash call with a timeout of at least 600000 ms: one test file per command, the
whole PWA suite alone and the build alone, so no call can pass the tool's 600 s limit under load and lose its output.

PWA, the whole suite and the build (the build's script is `tsc --noEmit && vite build`, so it is the PWA typecheck too):

```bash
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run | grep -E '^ +(Test Files|Tests) '
cd "$(git rev-parse --show-toplevel)/pwa" && npm run build 2>&1 | grep -E 'built in|error|files generated'
```

Expected: `Test Files  106 passed (106)`, `Tests  3320 passed (3320)` on the prototype at `825fd1965`, measured green
at load average ≈25 (the counts include W2 Tasks 1–3's 83 rows; on the real branch they are `main`'s plus those). The
first prototype, under load average 46, measured `Tests  4 failed | 3310 passed (3314)`, all four in
`test/contrast.test.ts`'s "the gate fails a mutated tree" describe, each over the 5000 ms default timeout (5087 ms,
7986 ms); re-run alone, `./node_modules/.bin/vitest run test/contrast.test.ts --testTimeout=240000` gave
`Tests  256 passed (256)`. A red there is load until it reds alone. The build: `✓ built in 2.32s` and
`files generated` (`sw.js`); the >500 kB chunk warning is `main`'s, not this wave's. `server/dist-pwa/` is gitignored,
so `git status` does not move.

Server: the typecheck, the typecheck suite (its PWA row needs `pwa/node_modules`, installed by `npm ci` in `pwa/`),
the single-definition and topology scans, and every suite that reads README as prose:

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/tsc --noEmit -p . && echo src-ok
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo tests-ok
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/topology-clean.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/pools-prose.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/oss-metadata.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/readme-holds.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/readme-roster-mirror.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/box-token-census.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/license.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/worker-skill.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/reviewer-skill.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-settings.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-vocabulary.test.ts | grep -E '^ +Tests '
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts -t README | grep -E '^ +Tests '
```

Expected (each measured at `825fd1965`; a suite W1 extended reads `main`'s count plus W1's rows): `src-ok`,
`tests-ok`; typecheck-tests 12 passed (12); single-definition 274 passed (274); topology-clean 55 passed (55);
pools-prose 27 passed (27); oss-metadata 22 passed (22); readme-holds 17 passed (17); readme-roster-mirror 5 passed
(5); box-token-census 23 passed (23); child-reclaim-prose 4 passed (4); crossrepo-prose 17 passed (17); license 15
passed (15); coordinator-skill 160 passed (160); worker-skill 51 passed (51); reviewer-skill 14 passed (14);
stall-settings: the count the Baseline recorded from `main` (114 passed (114) at the W1 prototype's tip
`a5fa943c6`, 62 at W1 Task 1); stall-vocabulary 179 passed (179); ccrc-install-graphify's README rows 9 passed | 49
skipped (58). `typecheck-tests` and `session-hook` are known load flakes: re-run a red one alone with
`--testTimeout=240000` before calling it a break.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add README.md server/test/stall-settings-readme.test.ts
git commit -m "$(cat <<'MSG'
docs(readme): the Settings paragraph names the Stall watch section, pinned to the shipped labels and bounds

The paragraph that tours /settings gains its third section (design 2026-10-05, §18 W2): the route, what the Now block
shows, the Level choices by their L0 labels, the quiet time's built-in value, bounds and step, the 409 confirm the
server decides (D-4033 server-decides-the-confirm) and the not-available reading of a server without the route
(D-4035 older-server-404-reads-not-configured). It says exactly when a write asks for confirmation: a stage turning
on, leaving the further checks, a quiet time below the one before (never a raise, D-4037 quiet-raise-asks-nothing),
and every write while the fleet box's files cannot be read. server/test/stall-settings-readme.test.ts pins those
facts to L0 and L1: a renamed level, a moved bound, step, built-in or window, a dropped route, a second lead sentence,
the section placed before Notifications, or a device word (the PWA's own list) each reds a row. The README citation
instrument stays at 7 passed | 328 skipped.
MSG
)"
```

## Deviations found

This plan defines five numbers that W2 alone owns. D-4035 and D-4036 were issued by the allocator at plan time
(`POST /api/ledger/deviations`, 2026-10-05 17:47). D-4042 (`malformed-optional-block-is-dropped`) was issued by the
coordinator in ruling R24, fix round 1, D-4043 (`unanswered-write-has-its-own-l0-line`) by the coordinator in
ruling R27, fix round 2, and D-4044 (`pinned-built-in-value-is-its-own-option`) in ruling R29, fix round 3;
none of those three came from that 17:47 call. A departure found during execution is named by slug in the wave-done mail,
and the coordinator assigns its number.

- **D-4035** — `older-server-404-reads-not-configured` (Tasks 1 and 3)
  - **Departs from:** the approved shape follows the Updates section's discipline. Spec §2 item 7 says "W2 is the PWA
    section", and §13 says "these follow the Updates section's discipline". That discipline does two things:
    - it maps only 501 `not-configured` to not-configured (`useUpdatesView`'s `failureOf`, ≈:217–222);
    - it renders a landed view before it looks at the failure kind (`SettingsScreen.tsx` ≈:705).
  - **What W2 does:**
    - `useStallWatchView` also maps 404 `not-found` to `not-configured`, with status and code both matching. That 404
      is the server's own `/api/*` answer for a missing route (`server.ts` ≈:3468–3473).
    - The section renders `STALL_NOT_AVAILABLE_TEXT` in place of its whole body whenever `failure ===
      'not-configured'`, even over a view that has landed.
  - **Why:** after a rollback to a build without the route, whether by hand or by the unattended `ccrc rollback --from
    watchdog`, a copy of the Updates discipline would keep showing the old choice with its radio checked. That choice
    no longer applies, and every notice it recorded in shadow is going out (§15's rollback row).
  - **Pinned by:**
    - Task 1's P7 row (mutations P7a, every 404; P7b, every 501; P7c, the 501 pair dropped);
    - Task 3's P1b 404 row (X2, the view rendered first) and its P1b 501 first-read row (X47, the not-available body
      only over a landed view). X2 alone cannot red the 501 row: on a first read no view has landed.
  - **Cost if wrong:**
    - A 404 `not-found` that is not a rollback blanks the section to "not available" until the next good poll clears
      the failure. A proxy misroute under a TLS-terminating front is one such case. During that window the stored
      choice still applies while the text says it no longer does.
    - The opposite error is worse. A rolled-back server that the section shows as still applying a choice misleads
      the operator about which notices are about to go out.
- **D-4036** — `notifications-label-says-push` (Task 3)
  - **Departs from:** rev 2's scope, which left the existing Notifications section untouched. The spec now takes Q10's
    default (§4, §13, §19 item 10).
  - **What W2 does:** it renames the row "Phone notifications for this browser" (`SettingsScreen.tsx` ≈:650) to "Push
    notifications for this browser". Its one pin (`pwa/test/settings-screen.test.tsx` ≈:1771) moves with it, and so
    does the block's comment ("The PHONE-PUSH toggle" becomes "The PUSH toggle").
  - **Why:** the operator's 2026-10-05 directive: "same functionality identical across anywhere the PWA is installed".
    Alert's `does` text points at this row, so the row must not name a device either.
  - **Pinned by:**
    - the Notifications LABEL: "P6: no L0 STALL_* string names a device, and the Notifications row says push" and the
      moved label pin in "reuses the literal NotificationBell where the browser can do Web Push", both red under X22
      (the label put back to Phone). The README never spells the label, so `stall-settings-readme.test.ts` stays green
      if the label reverts;
    - README's own "push bell" wording: `stall-settings-readme.test.ts`'s device row, "the Settings paragraph names no
      device", which scans the whole Settings paragraph (not the third section's sentences alone), so the paragraph
      saying "phone" again reds it.
  - **Cost if wrong:**
    - One label, and one moved test line.
    - README ≈951 said "the phone-push bell for this browser" when this number was written. The final-fix round
      rewrote it to "push bell" and pinned the whole paragraph (above), so no line of README's Settings paragraph names a
      device now.
- **D-4042** — `malformed-optional-block-is-dropped` (Task 1)
  - **Departs from:** spec §13's wire guard (≈:1211–1213), which drops only malformed `counts` elements and reads a
    MISSING `next`, `filesExceed` or `fallback` as not stated. Anything else is a failed read.
  - **What W2 does:** `asStallWatchView` also drops a PRESENT but malformed `next` or `filesExceed`, with the same one
    `console.warn` per answer, and renders the rest. A malformed `fallback` still fails the whole answer.
  - **Why:** a skewed or buggy server's malformed optional block costs only that block, as a malformed `counts`
    element already does. Reading the whole answer as failed would hide a good level and choice behind a Next-step or
    files-exceed line that the screen can do without.
  - **Pinned by:** the guard's own rows in `pwa/test/use-stall-watch-view.test.tsx`:
    - G8, "drops a malformed next or filesExceed as not stated, keeps the rest, and warns exactly once";
    - G7, "reads a missing next or filesExceed as not stated, passing the answer through unchanged";
    - G4, "reads a MISSING fallback as none stated, with no warning; refuses a MALFORMED one", for the half that does
      not change: the fallback still refuses.
  - **Cost if wrong:** if the operator wants a malformed `next` or `filesExceed` to fail the read, the section shows
    "could not be read" (or the last good view, stale) instead of a reading missing one block. That is a two-line change
    in `readEffective` and the inversion of G8's expectation.
- **D-4043** — `unanswered-write-has-its-own-l0-line` (Task 3; added by fix round 1, F1, and numbered by fix round 2)
  - **Departs from:** spec §12's enumeration of `STALL_CONFIRM_TEXT`'s keys (≈:1147), which ends "and the refusal toast
    `refused`" and has no key for a write that got no answer.
  - **What W2 does:** `STALL_CONFIRM_TEXT` gains one key, `unanswered` ("Not confirmed — the server did not answer; the
    screen will re-check."), in W1's stall-watch block of `shared/api.ts`. The section toasts it for a rejection that
    is not an `ApiError` (a network failure), then re-reads. The 2xx-unreadable arm keeps `UNCONFIRMED_TEXT`.
  - **Why:** fix round 1's F1. A write whose answer never arrived may still have landed, so "Nothing was changed" is
    false for it, and `UNCONFIRMED_TEXT` ("Saved — the server's answer could not be read") is false the other way: the
    server did not answer at all. Neither existing line is true of it, and the section's strings are all L0 constants.
  - **Pinned by:** `pwa/test/settings-screen.test.tsx`'s "a write whose answer never arrived says it was not
    confirmed, never "Saved" or "Nothing was changed", and re-reads" (mutations X48 and X60, each `1 failed` of 187 on
    exactly that title, re-measured against the shipped `toast(STALL_CONFIRM_TEXT.unanswered)`), and the 2xx row "an
    unreadable 2xx says the write may have landed and re-reads; it installs nothing", which asserts the new line is
    absent. The sibling "a 2xx body that fails the wire guard is the same unconfirmed outcome" keeps the 2xx-unreadable
    arm on `UNCONFIRMED_TEXT`.
  - **Cost if wrong:** if the operator wants the network arm to read `UNCONFIRMED_TEXT` after all, it is the key's
    removal and one line in `StallWatchSection`'s `write`, with the same rows retargeted. If the key is wanted but the
    wording is not, it is one L0 string.
- **D-4044** — `pinned-built-in-value-is-its-own-option` (Task 3; added by fix round 2, numbered by fix round 3)
  - **Departs from:** spec §13 item 4 (≈:1301–1302), which says the select offers "Built-in (<builtInMs>)" and every
    step except the one equal to `builtInMs`, "so the built-in value appears once".
  - **What W2 does:** when the stored quiet time is a NUMBER equal to the view's `builtInMs`, the select carries that
    step as its own option, value the stored number, label plain `quietText(stored)` exactly as `quietChoices`
    labels every step ("2 h", never "2 h (chosen here)"), at that step's numeric place between the step below and
    the step above, and selects it. "Built-in (2 h)" stays in the list, unselected. A step label never claims a
    source: the quiet line above alone says where the effective value comes from. `quietChoices` itself is
    unchanged and still omits the built-in step; the section shows the pinned step back.
  - **Why:** a pinned 7 200 000 is the server's `chosen` value (`quietSource: 'chosen'`; a `default` write over it is a
    real change; only NULL follows the built-in). Selecting nothing would hide a value the server did answer, and
    selecting Built-in would show a value the server did not answer. The value then appears twice in the select,
    once as Built-in and once as itself, and that is the departure.
  - **Pinned by:** `pwa/test/settings-screen.test.tsx`:
    - "a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled
      plain like every step; one off the list … selects none" (source `chosen`; selected option reads plain "2 h");
    - "a pinned built-in number reads plain "2 h" in the select whatever the quiet line says: under a fallback (source
      default) …" (the quiet line reads "2 h (built-in)", the selected option still reads plain "2 h");
    - "a pinned built-in number sits at its step's numeric place among the steps, between the step below and the step
      above";
    - "from a pinned built-in number, picking Built-in is one change that writes default exactly once".
    - The pinned-option mutation rows of Task 3's table.
  - **Cost if wrong:** if the operator wants the built-in value to appear once after all, the extra option goes and
    a pinned built-in number selects Built-in, which shows a value the server did not answer. That is the section's `shown` list and `quietValue`, and the
    inversion of the four rows above.

**Numbers this wave cites but does not define.** The W1 plan defines all four. Defining any of them here too would red
`deviation-refs`' two-plans row.
- D-4033 is `server-decides-the-confirm`. W2 is its client half: Task 1's `asStallConfirm` and `stallWriteRefusal`,
  and Task 3's sheet, which re-sends `effectKey`.
- D-4034 is `confirm-on-stage-diff`. W1 computes the effect, and W2 renders the sheet: Task 3's `stallConfirmLines`,
  and Task 2's list form of `QuickConfirm`.
- D-4037 is `quiet-raise-asks-nothing`. W1's `quietLowered` is true only for a quiet time brought strictly lower, so a
  raise alone asks for no confirm and opens no sheet. W2 adds no line for a raise and no L0 text (Task 3's choices;
  Task 4's README clause).
- D-4038 is `view-reads-stages-with-the-resolution`. W1's view reads the resolved stages with the resolution, so a
  reader fault over a listed registry never answers `{ measured: false }`. W2 renders what arrives (Residue, below).

**Departures found during this wave's execution** are numbered by the coordinator at wave-done, from the programme's
reserve. None beyond the three fix-round entries above is defined here, and none is written as a number in code or commits before then: a departure goes into
the wave-done mail by slug only.

**Candidates the coordinator may number at wave-done.** The tasks made each of these choices where the spec was silent.
Each is pinned, and the plan takes no number for any of them:
- `quiet-range-bounds-the-select` (Task 1). A quiet range is readable only with `stepMs > 0`, `minMs <= maxMs` and at
  most 1000 steps (G10, G11).
- `malformed-fallback-refuses-the-answer` (Task 1). A malformed `fallback` refuses the whole answer (G4). The
  neighbouring drop of a malformed `next` or `filesExceed` is a numbered departure of its own
  (`malformed-optional-block-is-dropped`, above).
- `unanswered-write-reads-unconfirmed` (Tasks 1 and 3). A rejection that is not an `ApiError` (a network failure,
  after which the POST may have landed) reads as `unconfirmed`, never as a refusal: the section re-reads and never says
  "Nothing was changed" (G18; X48 and X60, re-measured against the shipped line). The line it toasts is a numbered departure of its own
  (`unanswered-write-has-its-own-l0-line`, above). The 2xx-unreadable arm, which §15's "A write's reply cannot be
  read" row words, keeps `UNCONFIRMED_TEXT` and re-reads too.
- `quiet-select-shows-no-unanswered-value` (Task 3). A stored quiet time the list does not hold selects one empty,
  hidden, disabled option (X38). A stored number off the list that is not the built-in still selects the blank
  option. The one stored value that is not "unanswered", a number equal to the built-in, is a numbered departure of
  its own (`pinned-built-in-value-is-its-own-option` (D-4044), above).
- `readme-section-sentence-pinned-to-l0` (Task 4). A new server test file the spec does not name.

## Residue settled by this plan

From spec §20, each settled where the task names it:
- **"Busy delivery armed by file … the confirm listed 'Busy delivery stops.' first" against §13's order** (Task 3).
  - §13 is followed: the target's `does`, then the `turnsOn` lines, then the `stops` lines in §5.1's order, then the
    held line, the due lines, the quiet lines and the files-exceed line.
  - §15's wording is read as "listed it", not as an order.
  - Pinned by "the order: does, turn-ons, stops, the held line, what falls due, the quiet lines, the files-exceed line".
- **"A quiet-time raise that stays below the built-in … opens a sheet with a title and no body lines"** (Task 3).
  Settled in W1 by `quiet-raise-asks-nothing` (D-4037), which W1's plan defines:
  - `quietLowered` is true only when the effective quiet time after the write is strictly lower than the one before,
    so a raise alone needs no confirm, and the section opens no sheet for it;
  - `stallConfirmLines` adds no line for a raise, every case §13 already words is unchanged, no L0 text is added,
    and W2 touches no `shared/`;
  - Task 4's README clause says a quiet time moved below the one before, never a raise.

  W1 pins the rule (its Task 2 quiet row and the `D-4037: a raise never asks` mutation row). `QuickConfirm` still
  renders a bare title for `consequence: []` (Task 2's P8 row), but no stall watch sheet passes one: every confirm
  has a stage line, a stops line, a quiet line for a lowering, or the unknown line.
- **What `effective` carries after a view-reader fault** (W1's hand-off; `view-reads-stages-with-the-resolution`
  (D-4038)). W1 reads the resolved stages with the resolution, so a reader fault over a listed registry never
  answers `{ measured: false }`:
  - a throw in `stallNextStep` or `stallFilesExceed` sends `effective` with `measured: true` and `next` and
    `filesExceed` left out. W2 reads both as not stated: no Next step block and no files-exceed line, and the reading
    itself is still drawn. Pinned by G7, the P10 row "the Next step renders from the wire — none and a missing next
    show nothing, an empty waitsOn no gates", and P11 (X28, X29);
  - a `stallStages` throw claims W1's fallback, so the section shows the files-only reading and the fallback line
    (X31) naming the fault;
  - accepted by D-4038 as bug-path residue, with no new wire word: a files-only reader throwing under a fallback
    answers `{ measured: false }`, which the section shows as Unknown (M6) beside that fallback line.
- **`dueFromOff` and a `{label}` slot** (W1's hand-off list). Settled: the line keeps §13's approved wording, "Off
  recorded nothing. …", with no `{label}` slot. W1 decided it in its L0 ("Off" is the level's full label, and §12's
  slot rule is about short forms), and W2 renders `STALL_CONFIRM_TEXT.dueFromOff` as given. Pinned by "P3d: checks
  from a running watch are due; from Off, dueFromOff".
- **"A 409 whose body fails `asStallConfirm` becomes the `refused` toast, but a `confirm-required` body carries no
  `detail`"** (Task 1). `stallWriteRefusal` falls back to `apiErrorText(err)`, which gives the error code
  (`confirm-required`), so the slot is never empty. Pinned by "reads a 409 whose body is not a readable confirm as a
  refusal that still names something".
- **"Fastify's 500 body has no `detail`, so the `refused` toast's slot renders empty"** (Task 1), and W1's hand-off
  on the same slot ("when the body has none or Fastify's 500 puts the cause in `message`").
  - A 500 toasts the cause the route threw, from the body's `message` ("Nothing was changed: stall settings
    unreadable, nothing written: …"). Pinned by "takes Fastify's message when the body has no detail…" (G17) and the
    section's "P2: a 500 toasts the cause the server named in its message…" (X59).
  - A blank `message` falls back to "Internal Server Error", `ApiError`'s message from the body's `error` field; a
    non-JSON body gives "request failed (<status>)"; a blank server `detail` is ignored. Pinned by "falls back to the
    error's own text when the body has neither…" (G15).
  - A network failure is not a refusal at all: it reads `unconfirmed` (below).
  - No new L0 string.
- **A write whose answer never arrived** (the plan review; §15's "A write's reply cannot be read" row). A rejection
  that is not an `ApiError` may have stored the write, so it gives a toast and a re-read, never "Nothing was changed".
  Fix round 1 (F1) gave the network arm its own L0 line, `STALL_CONFIRM_TEXT.unanswered` ("Not confirmed — the server
  did not answer; the screen will re-check."), so the line shown here is no longer `UNCONFIRMED_TEXT`. That text stays
  the 2xx-unreadable arm's, the text §13 step 3 and §15 prescribe for an answer that could not be read. Pinned by G18,
  X48 and X60.
- **"An absent row sends `chosen.level` `'unreadable'`, so no radio is checked"** (Task 3). The section checks a radio
  only on `chosen.level === value`. Pinned by the `stored: 'absent'` render row ("an absent or unreadable stored level
  checks no radio…"), which also shows the absent stored line.

**Not settled here.** These are W1's, or the operator's:
- the view builder's behaviour when `stallLevelOf` or `stallStages` throws (W1's D-4038; its hand-off is above), and
  whether its catch warns;
- `stallNextStep`'s row-to-arming conversion;
- the `held` object and the `source` of the fallback reading;
- `stallEffectKey` over a `null` `updatedAt`;
- the busy-shadow window before the first busy mail sweep;
- `busySince` and `lastFallback` flapping;
- `stallNextStep` offering a step the box holds. W2 renders whatever `next` says.
- the strict runbook's "`rm` it to go back" (README ≈3751).

Two of the remaining items reach this wave's screen unchanged, and the section does not hide them:
- **A row with both fields unreadable takes two writes to repair.** §13 step 1 sends only the field that moved.
- **A remote `readdir` that alternates between `null` and a listing opens a fresh sheet on every Set.** The section
  follows §13 step 4 and adds no bound.

## Open questions for the operator

Neither blocks the wave; each is the operator's to rule on, and the wave-done mail repeats them.
- **README ≈951 (≈958 at `d12b5aba0`), "the phone-push bell for this browser".** **Settled by the operator's
  2026-10-05 directive** (no device distinction): README already reads "the push bell for this browser" (`a5771e471`),
  and `stall-settings-readme.test.ts`'s device row pins it. Nothing is left to rule; the question stays below as
  history. It is in the Settings paragraph W2 edits, but outside D-4036 (which renames the Notifications row's label, a string README never spells) and outside
  §18's README edit list (the third-section sentence only). Rewording it to "the push bell for this browser" would
  carry the 2026-10-05 "no device distinction" directive into README.
- **`UNCONFIRMED_TEXT` for a write whose answer never arrived.** Its lead word, "Saved —", overstates a request that
  may never have left; the re-read that follows shows what was stored within one answer. (Settled for the network arm
  by fix round 1, F1: it now toasts `STALL_CONFIRM_TEXT.unanswered`, which says only "Not confirmed". The question
  stands for the 2xx-unreadable arm, which keeps `UNCONFIRMED_TEXT`.) A text that says only "could not be confirmed"
  would need an L0 or PWA string that neither wave adds today.

## If this PR is overtaken before it merges

**Absorb only on worker clause 16's measured triggers**, each read after one `git fetch origin`:
- your own `git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD` exits 1 with a tree id;
- a required check is red while `main` passes it;
- the coordinator names a landed change this wave must take.

Then run `git merge origin/main` into this branch. Never rebase, never force-push. Keep both sides of every conflict,
and name each conflicted file in the wave-done mail.

**The migration slot.** This wave takes none and must not take one. If another branch took W1's slot first, W1 moved
up, and nothing here spells the number. If a fix round here seems to need storage, that is a departure for the
coordinator by slug, never a slot taken in this wave.

**Likely overtakers, by file:**
- **W1 fix rounds or a follow-up that reshapes L0 or L1.** If a `STALL_*` text, a wire type or one of Task 4's L1
  bounds changes on `main`:
  - re-run all of Precondition 2's export checks, the L0 count and both L1 counts;
  - re-run `use-stall-watch-view`, `settings-screen` and `stall-settings-readme`.

  Most rows fill from L0 and move with it. A row that reds on a changed text is a finding. Fix the row to read L0;
  never copy the new text into it.
- **`SettingsScreen.tsx` and `settings-screen.test.tsx`** (an update-management wave's Updates or Notifications
  section). This wave's edits there are found by content: the header comment, the label, the render site and the
  "ONE poll" comment. Re-measure each before-text with `grep -c` (each must print `1`).
- **`QuickConfirm.tsx`.** A new caller passing a string is unaffected. A co-edit of its props is a conflict: stop and
  name it by slug (for example `quickconfirm-co-edit`), quoting both texts, and the coordinator rules.
- **README's Settings paragraph or its size.** README refreshes (#283 was one) move the paragraph and CLAUDE.md :10's
  claim. After the merge:
  - re-run `stall-settings-readme` and `pools-prose`;
  - re-run the README citation instrument, which must read `main`'s count, measured on `main` before the merge
    (`7 passed | 328 skipped (335)` today).

  If `pools-prose` reds on the size claim, re-measure CLAUDE.md :10 to the nearest hundred and commit it with the merge
  (Task 4's remedy).

**After any absorb, re-run each alone, in the foreground:**
- PWA: `use-stall-watch-view`, `primitives`, `settings-screen`, `api`, `use-updates-view`, `caps-control`, `app` and
  `fleet-screen`;
- PWA `tsc --noEmit -p .` and `npm run build`;
- server: `stall-settings-readme`, `single-definition`, `pools-prose`, `readme-holds` and `typecheck-tests`;
- the README citation instrument;
- every task's mutation table, judged by each row's `failed` count and the names of the failing rows. The `passed (N)`
  totals shift with landed rows, and that shift is not a finding.

Then run the whole PWA suite once more. Re-run any load-flake timeout alone with `--testTimeout=240000`.

## After the merge (orchestrator, read-only)

The release lane carries this wave, and nothing rolls a box by hand from here.
1. The merge becomes a GitHub prerelease within about a minute (`release-main.yml`). Note its tag from `gh release
   list`.
2. The server box takes it when the operator moves it, through the PWA's Updates section or `ccrc rollout --to <tag>`.
   Read `/health`'s `version`, or the PWA's `BuildLine`, until it names that tag. This wave needs no fleet-box move.
3. Open the PWA's Settings (an open tab picks up the new bundle within `UPDATE_CHECK_MS`, 15 min, or on return to the
   foreground). Check that:
   - the third section, **Stall watch**, sits after Notifications;
   - the Notifications row reads "Push notifications for this browser".

   Under W1's seed the section should read "Following the fleet box's files" with the level those files arm,
   "Follow the fleet box's files (they say: <label>)" checked, the quiet time "2 h (built-in)", and four count rows
   with the run-less footnote. If the registry cannot be read, it reads "Unknown", never Off.
4. Write nothing from here. Choosing a level or a quiet time is the operator's act, and so is any arming step the
   ledger's gates wait on.
5. The coordinator records the merge and the release in the ledger, closes W2's run, and closes the programme.
