# D-8126 wave A4, the console's calls made for you: notes for the ledger

What wave A4 of `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md` (Tasks A4-1 to A4-5) found while
building, for the coordinator to fold into the programme ledger. Each departure is named by a plain-words slug; no number is
taken here.

## Where it came from

The wave was built once before, on the unmerged autonomy stack (six commits, from "the words for calls made for you" to "a
refused or failed Seen frees the button"). That draft was read commit by commit and re-grounded on main, whose A3 (#2606) is
the wave's base. Main's A3 wire was compared with the draft's before anything was built on it: `CallView`,
`CallRecordAnswer`, `WaitingView.calls` and `callsCleared`, `RunRecordAnswer.calls` and the digest's `call` row kind are
identical, so the console reads the wire the draft read. The stack's last commit (migration slots and pins for the whole
branch) has no console hunk, so nothing of it is taken. No server file changes: the doors are A3's.

## Ported as the draft wrote it

- `callWords.ts` (A4-1): the reader `callsOf`, the heading, the line, the two action words and the refusal table.
- `OverturnSheet.tsx` (A4-3): the confirm sheet, with the draft's later placeholder wording and the control census entry
  for its note box.
- The digest's call line (A4-4): the wire guard keeps `rowKind: 'call'`, the line names the call, the option chosen and the
  reason, draws no child, and corrects through `rowKind: 'call'`.
- `runCallLine` and `RUN_CALLS_WORDS` in `runDetailWords.ts`, and `RunCalls.tsx` (A4-4).
- `calls-made.browser.test.ts` (A4-5), re-grounded on main's markup (below).
- `api.markCallSeen` (one line in the growth-checked `pwa/src/lib/api.ts`).

## Rebuilt, and why

- **`a4-cleared-calls-join-the-sorted-trail`**: main's Recently cleared trail moved on after the draft (D-8194: sorted
  newest first, the newest five shown, Show all grouping it by programme; answer marks B added asks to it). The draft drew
  cleared calls as extra rows appended after the items. Here a cleared call is a third kind of trail entry, `call`, in the
  one owner `clearedTrail` (`ledgerWords.ts`), so it sorts, folds and groups with the rest. At the same instant the order is
  item, ask, call (`CLEARED_KIND_RANK`), which also fixes a tie rule that was not symmetric once a third kind existed.
- **`a4-cleared-call-time`**: the wire carries no "cleared at" for a call. `callClearedOn` reads it as the operator's own
  act, the earlier of `seenAt` and `overturnedAt`. A call that aged out of the group carries neither, and reads at when it
  was made, so it sorts last. The seven-day ageing rule is the server's (`CALL_SEEN_WINDOW_MS`, `callClearedAt`); it is not
  copied to the console. The server already windows `callsCleared`, so the trail keeps every call it is sent and windows
  only items and asks, as before. If a later wave wants aged calls placed exactly, the server can send a `clearedAt` field
  (additive) and this reader takes it.
- **`a4-calls-apart-among-the-groups`**: the draft drew a programme that has calls but no rows as a section after the whole
  list, outside the rail-and-groups grid. Here it is drawn inside `.wl-groups`, after the groups that have rows, so at
  laptop and wide widths it sits in the list's column, not under the rail. With no rows at all ("Nothing needs you."), it
  is drawn under that line. It still never counts toward the rail, the summary or the empty line.
- **`a4-call-acts-only-when-current`**: main added the device's saved copy of the list (console speed C4) after the draft,
  and every act on a saved copy is off. Seen and Overturn… follow `rowActs.enabled`, so a saved copy draws the calls with
  neither. The list beside an open item draws no calls, as in the draft.
- **`a4-seen-fix-folded-in`**: the draft's last commit (a refused or failed Seen frees its button and says why) is built
  into Task A4-2 directly rather than as a later fix. The refusal is said in words from `callRefusalText`, which gained
  `unknown-call` (both the Seen door and the correction answer it).
- **`a4-run-calls-own-hook-class`**: the draft's `<details className="rd-calls rd-group">` shared `rd-group` with
  `@ccrc/ui`'s `Section` on the run page, which `hook-class-collision.test.ts` refuses. It wears `rd-calls` alone and keeps
  the group spacing through that class. It is drawn right after the trail, where the draft put it among the sheets.
- **`a4-overturn-css-dropped-hunk`**: the draft's Overturn commit also removed `color: var(--ink-primary)` from
  `.wl-bounce`, which has nothing to do with calls. It is not ported.

## Measured

- Every new guard was mutated in place and restored from a saved copy by sha: 25 mutants over the screen, the trail, the
  words, the sheet, the digest, the run page, the route and the api, all killed. One (`Math.min` to `Math.max` in
  `callClearedOn`) survived the first fixture and was killed after the fixture gained a Seen and an Overturn that straddle
  an item.
- The browser test was measured red by two CSS mutations (a call line and a run call that do not wrap) and is green at 390,
  1280 and 1920 in both skins: the Waiting group, a call line and the Overturn sheet, the run page's Calls and the digest's
  call line.
- The whole pwa suite does not fit the fleet test slice's 6G cap on this box (OOM at two workers). The tests vitest relates
  to the changed sources (570 files) ran instead; the two reds were the hook class above, fixed, and the worker-build test,
  an OOM kill in the slice, green alone.
