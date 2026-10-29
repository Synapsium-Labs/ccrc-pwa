# W7 C7e note: the departures the answer reducer took (2026-10-28)

Task C7e of `2026-10-27-consolidation-w7-pwa.md` (D-7183). Each departure below is named by its slug, in this note, in
the commit that took it and in the PR body. The coordinator gets numbers for them from the allocator; this note
allocates none.

## slug step7-held

When the build first finished, OA-C17 was not recorded as ruled, so Step 7 was held. The operator has since ruled it
(a), recorded in `docs/superpowers/plans/2026-10-28-w7-operator-acts-ruled.md` (D-7265), and Step 7 is built as the
plan and that ruling say, red first: `refusalWords.ts#NOTIFICATION_REFUSAL_TEXT` holds `push-sw.js`'s `REFUSAL` table
byte for byte and `refusal-tables.w7.test.ts` pins it; `pwa/test/answerRegion.ts` renders the region between
`// ccrc:generated answer-lifecycle BEGIN` and `END` (`askRequestOf` from `answerLifecycle.ts#ASK_REQUEST`, `REFUSAL`
from the table); `push-sw.test.ts` holds the region equal to a fresh render (`CCRC_WRITE_ANSWER_REGION=1` writes it,
refused under `CI`), pins today's request bytes for `ask:k1:2` on `session-a`, keeps a malformed action opening the app
and sending nothing, and evaluates the rendered `askRequestOf` against `answerRequest(askCommandOf(…))` over an action
corpus. The handler's control flow stays hand-written. Step 8's `answerPaths()` 3 -> 1 ratchet lands with it.

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
