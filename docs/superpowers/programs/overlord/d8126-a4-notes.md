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
branch) has no console hunk, so nothing of it is taken. The doors are A3's; the one server change is fix round 1's additive
`clearedAt` (below).

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
- **`a4-cleared-call-time`** (superseded in fix round 1 by the coordinator's ruling on review 2792 F3): the waiting view's
  `callsCleared` rows now carry an optional `clearedAt`, read by `callClearedAt`, its one owner (`clearedCallViewOf` in
  `coordCalls.ts`). The console sorts, windows, dates and words a cleared call by it. From an older server that omits it,
  the console falls back to its first reading: the earlier of `seenAt` and `overturnedAt`, or when it was made for a call
  that aged out. The seven-day ageing rule stays the server's alone. The co-edits of `shared/api.ts`, `coordCalls.ts` and
  `ledgersRoutes.ts` were agreed with each file's holder.
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
- **`a4-call-acts-held-by-the-screen`** (fix round 1, review 2792 F1 and F2): the draft kept the Overturn sheet, Seen's
  in-flight state and a Seen refusal inside `CallsGroup`, which two different parents draw (`ListGroup` and `CallsApart`).
  A frame that moved a programme across "has rows", or took the open call away, lost the sheet and its typed note. The state
  now lives in `useCallActs`, on `WaitingScreen`, which draws the sheet in every branch, before any early return; the sheet
  holds its own call.
- **`a4-trail-windows-calls`** (fix round 1, F4): `clearedTrail` windows cleared calls by the same 48 hours as items and
  asks, so a stale frame or the device's saved copy agrees with the server.
- **`a4-one-owner-of-call-refusals`** (fix round 1, F5): the digest's correction of a call line reads `callRefusalText`, so
  the sheet and the digest say the same words, and `unknown-call` is a sentence in both. A case reads the correction door's
  `DigestCorrectResult` and reds on a call code with no sentence. That case lives in the server tree
  (`server/test/digest-call-refusals.test.ts`, reading both files as text): first written in the pwa test, it read
  `server/src`, which `ci-reach-census` refuses because a server-only change skips the pwa tests (red on the PR's fast run,
  server shard 3). The pwa test keeps the three rendered sentences. Measured: dropping `unknown-call` from the table and
  adding a code to the door's union each red it.
- **`a4-call-deciders-in-l1`** (fix round 1, F7): `callsApartOf` and `clearedCallsOf` (`callWords.ts`) decide what the screen
  decided inline; `openCallsOf` replaces `callsOf`, whose cleared half nothing read.
- **`a4-cleared-call-says-how`** (fix round 1, F8): a cleared call row says seen, overturned or aged out and when
  (`callClearedHow`), and an overturned one wears no tick. The sheet keys its options by place and text.
- **`a4-min-width-equivalent`** (fix round 1, F6): the browser test now carries an unbroken token in a call's question,
  reason and option. Dropping `overflow-wrap: anywhere` from `.wl-call-line`, `.wl-overturn-q`, `.wl-overturn-option` or
  `.rd-call` reds it. Dropping `min-width: 0` from `.wl-call-line` or `.rd-call` stays green, an equivalent mutant:
  `overflow-wrap: anywhere` already brings the element's min-content width down to a character, so the flex or grid item's
  automatic minimum is no wider. The declaration is kept as a second guard.
- **`a4-overturn-css-dropped-hunk`**: the draft's Overturn commit also removed `color: var(--ink-primary)` from
  `.wl-bounce`, which has nothing to do with calls. It is not ported.

## Measured

Fix round 1: 17 pwa mutants over the screen's call acts, the trail's window and clear time, the deciders, the cleared row's
words, the digest's refusal owner and the option keys, all killed; three server mutants (`clearedCallViewOf` dropping the
field, the route serving the plain view, an open row carrying `clearedAt`), all killed.

Round 0:

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
