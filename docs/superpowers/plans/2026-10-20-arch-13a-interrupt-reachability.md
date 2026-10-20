# Can the envelope sheet's Deny meet a background-only refusal? (#555, ARCH-13a step 1) — Implementation Plan

**Issue:** #555, "[ARCH-13a] EnvelopeSheet reads InterruptRefusal like SessionScreen (reachability test first)". The consolidation wave design places ARCH-13a in K5 (W3), first ticket.

**Status:** step 1 of 2. This PR adds a server reachability test and nothing else. It touches `server/test/interrupt-route.test.ts` and adds this plan. No product code changes. Step 2 (the sheet) is described under "What step 2 needs" and is not started.

## The question

`EnvelopeSheet` turns every 409 from `/interrupt` into one toast: "the session may be idle or the request already resolved". `SessionScreen` reads a `background-only` refusal (`backgroundOnlyRefusal`) and names the background work. The issue asks whether the server ever answers the sheet with `background-only`. If it never does, the vague copy is correct and the ticket closes.

## What the code says

- The sheet calls `/interrupt` from one place, Deny. Deny renders only on an approval envelope. A question envelope (live or review) has no Deny, so it never reaches the route from this sheet.
- The session stream ships an envelope exactly when the hookstate's `ask` is non-null (`sessionws.ts`, `checkHookAsk`).
- The hook writes an ask only with `waiting`, and every main `working` or `done` write clears it. Carried writes keep the file's own ask, and a non-waiting file's ask is already null (`ccd/session-hook.sh`, "Transitions to working/done clear the ask"). The hook suites pin this, for example `session-hook-subagent-ask.test.ts` ("ends the wait and clears the ask") and `session-hook-agent-events.test.ts` (a Stop's `done` with `ask: null`).
- `waiting` sets the row's `dialogPending` (`fleet.ts`), and `interruptVerdict` answers a turn for any `dialogPending` row. Escape is pressed.
- The route reads no envelope. Its verdict comes only from the live word and the row.

## The answer (D-6116)

While the server ships an envelope, Deny is never refused `background-only`. The route presses Escape over delegated work and over a background shell, for approval and question envelopes alike.

The refusal can still reach the sheet through a race. The approval is answered somewhere else (the terminal, another client). The main turn stops over delegated work, or the main loop goes idle over a background shell. The operator presses Deny before the stream's `ask_cleared` closes the sheet. That Deny gets `409 background-only`, and today the sheet calls it "may be idle or the request already resolved". The second half of that copy is true, but the sheet throws away the count and kinds the server sent. So the case is **reachable, narrowly**, and step 2 is worth doing.

## Tests

`server/test/interrupt-route.test.ts`, describe "POST /api/sessions/:id/interrupt under an envelope (D-6116)". The `box` harness gains an optional `ask` on the hookstate fixture. It also returns `envelope`, the ask that `readHookState` gives for the fixture. That is the same read the stream makes, so each case shows both what the sheet would display and what the route answers.

1. An approval envelope (`waiting`, `PermissionRequest`) over delegated work, live `busy` and live `shell`: the envelope ships, Deny gets 200, and Escape is pressed.
2. A question envelope with only a background shell running (`PermissionRequest` and `PreToolUse` arms): the envelope ships, the route answers a turn, and Escape is pressed. This is the issue's candidate, and it is not reachable.
3. The approval resolved elsewhere, then a main Stop over two delegated workflow tasks: no envelope ships. A stale Deny gets `409 background-only` with count 2 and kinds `workflow`, no key is pressed, and the feed records `source=deny outcome=background-only`.
4. The same, with the main loop idle over a background shell: `409 background-only` with no count.
5. A hand-made `done` from a Stop that kept its ask (the hook never writes this): the envelope ships and the route still answers `background-only`. This pins that reachability depends on the hook's clear, not on the verdict.

Red first: this slice is a characterization test of shipped behaviour, so it is green on `origin/main` by design. Its red is the mutation table. M2 below survives every test that existed before and is killed only by tests 1 and 2.

## Mutation table

Measured on a `git archive` copy of `origin/main` with the new test file overlaid. Every mutant is killed.

| Mutant | Killed by |
|---|---|
| M1: `interruptVerdict` ignores `dialogPending` | tests 1, 2 (and two D-5236 pane-menu tests) |
| M2: `fleet.ts` drops the hook's `waiting` from `dialogPending` | tests 1, 2 only |
| M3: the `shell` arm answers a turn | test 4 (and the D-5236 shell test) |
| M4: the Stop arm never answers background-only | tests 3, 5 (and three D-5236/D-5237 tests) |
| M5: `hookstate.ts` refuses an approval envelope | tests 1, 5 |
| M6: a pending wait is refused as background-only | tests 1, 2 (and three D-5236 tests) |
| M7: the harness drops the fixture's ask | tests 1, 2, 5 |

## What step 2 needs

- `EnvelopeSheet`'s Deny reads `backgroundOnlyRefusal(err.body)` on a 409 and shows the background-work wording. Every other 409 keeps today's copy.
- The wording must have one owner. `SessionScreen` writes it inline today. Step 2 moves it into one helper that both screens call, so that it is not written twice. That edit touches `SessionScreen.tsx`, which the skins chains hold, so step 2 waits for them. `shared/api.ts` is held by #1008 now. The helper belongs in the PWA, not in `shared/`.
- A render test: a 409 `background-only` reply to Deny produces the background-work wording, with and without a count.
- Renders at 360, 390, 1280 and 1920 widths, in both skins and both themes.
- The issue closes after step 2 lands. Step 1 meets the first acceptance criterion only.

## Deviations and decisions

Issued 2026-10-20 to this slice. D-6116 is defined here, once.

- **D-6116** — `envelope-deny-background-only-reachable`: while the stream ships an envelope, `/interrupt` answers a turn (the hook's `waiting` is `dialogPending`), so Deny presses Escape. `background-only` reaches the sheet only from a stale Deny after the approval resolved elsewhere. The route reads no envelope. Pinned by tests 1 to 5 above.

Issued and unused: none
