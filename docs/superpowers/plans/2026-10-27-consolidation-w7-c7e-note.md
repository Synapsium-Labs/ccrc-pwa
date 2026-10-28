# W7 C7e note: the departures the answer reducer took (2026-10-28)

Task C7e of `2026-10-27-consolidation-w7-pwa.md` (D-7183). Each departure below is named by its slug, in this note, in
the commit that took it and in the PR body. The coordinator gets numbers for them from the allocator; this note
allocates none.

## slug step7-held

OA-C17 is not recorded as ruled on `main`, and the coordinator had not confirmed it when this task finished. So Step 7
is held: `push-sw.js` keeps its hand-written request and its `REFUSAL` table, `refusalWords.ts` gains no
`NOTIFICATION_REFUSAL_TEXT`, `pwa/test/answerRegion.ts` is not created and `push-sw.test.ts` gains no rows. What Step 7
needs is already in place: `answerLifecycle.ts#ASK_REQUEST` and `#askCommandOf` are the declared `ask` shape and parser,
and `answer-lifecycle.test.ts` holds `answerRequest`'s `ask` arm equal to `push-sw.js`'s `fetch` today (method, path,
header and body bytes for `ask:k1:2` on `session-a`; nothing sent for `ask:k1:x` or with no session). Step 0's ring
check passed with a scratch `pwa/test/answerRegion.ts` in place (`mjs-node.test.ts` 6/6, `pwa-rings.test.ts` 7/7).
`answerPaths()` stays at 2 (the reducer and `push-sw.js`'s one handler), unratcheted; Step 8's `answerPaths()` 3 -> 1
ratchet lands with Step 7. `refusal-tables.w7.test.ts` pins the two in-app tables now, and gains the notification's
when that table moves.

## slug lifecycle-render-lane

The plan folds the sheet's eight lifecycle `useState` calls and its sync ref into the reducer's state. The reducer's
state is held in one instance per sheet (`createAnswerLifecycle`), updated synchronously at dispatch, so the send
guard reads the current state in the same tick, which is what the ref was for. Two facts about how React sees it:

- The state reaches React through a `useReducer` mirror fed from the dispatch itself, not `useSyncExternalStore`. An
  external-store update renders in its own synchronous lane; the sheet's `setState` calls rendered in the lane of the
  event or settle that made them, batched with whatever else changed then. `ask-inline.test.tsx`'s R106 A1 row ("a
  raise rendered in one batch with a Deny's completion unlocks nothing") depends on that batching, and is red under
  `useSyncExternalStore`.
- Review A1's raise rule reads whether the last committed render showed a send in flight (`lockedShown`, a ref written
  in the layout effect beside `eligibleNow`). The removed ref carried that fact as a side effect of following
  `locked` one commit late. It is a view fact (what the operator was looking at when the raise was made), not the send
  guard, and the same A1 row is red without it.

## slug dismiss-guard-current-state

`close` used to refuse when the last render's `locked` was set; the reducer refuses a `dismiss` when its current state
is busy. The two differ only inside one tick: a close handled in the same tick as a send's start is now refused too,
and one handled in the same tick as a send's settle, before the render, is now allowed. No row shows a difference.
The terminal hand-off (`leave`), which hid even while a send was in flight, keeps doing so as its own event.

## slug answer-paths-reducer-kind

Once the sheets write through the injected seam (`performAnswer(command, answers)`), `answerPaths()` as C7a wrote it
(`api.answer*` calls only) would see no writer and go blind to a sheet that writes on its own again. The query now
counts a call of any receiver's `answer*` member, or an `interrupt(…, 'deny')`, as a `writer`, and the same calls inside
`session/answerLifecycle.ts` as the one `reducer` site. Its FIXTURE row gains a seam write (counted), a non-deny
interrupt and `applyAnswered` (not counted), and the lifecycle file (kind `reducer`). On the base it still counts 3.

## slug answer-seam-delegates

The re-point gives each test a fresh seam (`pwa/test/answerSeam.ts`) whose writers delegate to `lib/api.ts`'s `api`
until a test gives them a value, and each `vi.spyOn(api, <writer>)` becomes `answers.<writer>.mockReset()` (a fresh
spy also started from the real writer, and `dialog-sheet.test.tsx`'s echo-failed row re-spies inside a loop). Tests
that render the whole `SessionScreen` keep their `api` spies: this task does not edit `SessionScreen.tsx` (the shared
file queue has C7c, C7k and C7m ahead of it, and #1749 holds it), so the screen mounts the sheet with its default
seam, `api`. Those are 40 spies in `ask-inline.test.tsx` and 21 in `ask-structured.test.tsx`.
