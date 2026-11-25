# Quiet routes: four more console routes write the operator mark

Overlord W1, wave 228 (run 3757), by the coordinator's ruling in call 1099, from review 3736's findings F1 and F2 on renewal
readings E (#3350). No D-number is minted for this run; the departures below are by slug, for the coordinator to fold into the
ledger. Measured on `main` at `2f140376dd`.

## What was built

A soft renewal break stays shut for 20 minutes after the operator's last input at a session, read from the operator mark. Its
one writer on the console side is `promptHandoffs.ts#markOperatorPrompt`. E made the drawer's input and the submit route call it,
beside the prompt route. Four more routes carry the operator's input into a pane and wrote no mark. Each now calls that same
writer, with the submit route's keying (`operatorMark.ts#markProgrammesOf`, through the writer) and clock
(`deps.time.clock.wall()`), and only after its act went through:

| Route | When it marks | When it does not |
|---|---|---|
| `POST /api/questions/:id/answer`, the operator's arm for a session's question (`server/src/coord/routes.ts`) | the core answered 200: an ask, a dialog row, a multi-select set or a free-text row whose keys landed | any refusal (400, 404, 409, `not-configured`); the approval arm (`approval-<n>`), which presses nothing, returns before the call |
| `POST /api/sessions/:id/dialog/tab` (`server/src/server.ts`) | the pane moved (`res.ok`) | a refused move |
| `POST /api/sessions/:id/interrupt` | Escape was sent (`res.ok`) | `not-busy`, `background-only`, `not-alive`: no key was pressed |
| `POST /api/sessions/:id/route` | ccd applied the pick (its run answered ok) | 400, 404, 501, a refused `compact`, and a ccd failure (502) |

The writer already logs and never throws, so a failed write neither fails nor delays the operator's act. No route, status word or
frame changed shape: the picker's answers are still `runCcdOr502`'s.

The drawer's mark throttle (review 3736 F2): it admitted on "now minus the last admitted time is at least two seconds" with the
wall clock, so after the clock stepped back it admitted nothing until the wall passed the old time. A reading earlier than the
last admitted time now admits too.

Product lines: `server.ts` +7 −2 (four hunks, each on its route's own lines; applied as a packet the holder of the file's other
claim consented to), `coord/routes.ts` +5 −1 (one import; the answer kept in a const, a comment, the call), `interruptlog.ts` +5 −3.

## The callers census

Every caller of the four routes in the tree, measured by searching every path spelling outside the test trees and docs:

| Route | Callers | The operator's? |
|---|---|---|
| question door, operator arm | the console's client (`pwa/src/lib/api.ts`, through `answerLifecycle.ts#questionAnswerRequest`); the push service worker's notification action (`pwa/public/push-sw.js#askRequestOf`), which answers when the operator taps an option on a push | yes: both run on the operator's device, at a tap |
| dialog tab move | the console's client (`api.ts`, from `answerLifecycle.ts`'s tab command: the sheet's arrow keys and tab strip) | yes |
| interrupt | the console's client (`api.ts#interrupt`, from the session screen's interrupt and `answerLifecycle.ts`'s Escape for a dialog's Deny); `server/test-e2e/session.e2e.test.ts` | yes; the e2e file is a test |
| model and effort picker | the console's client (`api.ts#route`, from the session screen's pickers and the browser sheet) | yes |

No `ccrc-api` verb names any of them (its closed table has no such row), no `ccd` script or deploy script calls them, the agent
does not, and no server code calls its own routes (no `app.inject` outside a comment). The claimant's ruling and hand-over of the
question family are other routes (`/rule`, `/release`), box-token gated, and stay unmarked. So no path that is not the operator's
console reaches these four, and nothing here was stopped for a ruling. As for E's paths: with sign-in off, the four are open, so a
mark means "a console client used this route"; that errs toward keeping the break shut.

## Departures, by slug

- **`question-door-marks-on-the-cores-200`**: the route marks when the operator's core answers 200, the status every answer form
  sends only after its keys landed (`questions.ts`'s `answer` and `answerAsk`). An ask answered while the store refused its record
  (`pressPlain`) still pressed the digit, so it marks too.
- **`picker-marks-when-the-reply-is-not-sent`**: the picker returns `runCcdOr502`, which sends the reply itself on a ccd failure
  (its 502, through `ccd502`) and returns `{ ok: true }` on success. The route keeps that one call and marks when the reply has
  not been sent (`reply.sent`), then returns the call's answer, so the bodies are what they were. Two versions were not kept: one
  that ran ccd inline, a new `runCcd(` site that the consolidation census (`consolidation-census.test.ts`, the not-ran arm, D-6840)
  refuses without a table row; and one that compared the answer with the reply object, which is not the object the failure
  returns, so it marked a failed pick (the refused-pick case went red) and the type check refused the comparison.
- **`picker-marks-a-pick-for-the-next-spawn`**: a `browser` pick is applied at the session's next spawn, never typed live. The ruling
  says "when the pick was applied"; ccd accepting it is the operator acting at the session, so it marks like any pick.
- **`mark-throttle-admits-an-earlier-reading`**: the drawer's mark throttle and the drawer's interrupt record share one class,
  `interruptlog.ts#DrawerInterruptThrottle`. The rule is an option of that class, `earlierAdmits`, which only the mark's instance
  sets, so the interrupt record keeps the plain rule (the brief: change the drawer's mark throttle only). A second class for one
  comparison would be a parallel mechanism beside its owner. After an admitted earlier reading the window runs from that reading.
  The never-deleted entries are unchanged.
- **`marks-on-every-question-form`**: the brief names the free-text row first; the cases cover all four forms (an ask, a row, a
  multi-select set, a free-text row), since the call is one line at the route and each form reaches it.

## Cases

In `server/test/continuity-operator-mark-paths.test.ts`, beside E's and in their style. The rig gained options (scripted pane
screens, a busy or idle live status file, ccd failing, the measured ccd verbs, a waiting ask), each defaulting to E's behaviour.

- For each of the seven route forms (the question door's four, the tab move, the interrupt, the picker): a pass that writes the
  mark for the designated session (`@overlord`, at the wall time) and for a coordinator (its programme), and the same act refused,
  writing none (the session both coordinates and is designated there, so any keying would show a mark).
- Through the real pass, for each of the seven: a coordinator the operator acted on waits `no-break`, and the Overlord, no reader
  running, waits `unmeasured` with its quiet measured 0, as E's are.
- The throttle: two drawer frames 1999 ms apart write one mark; a frame at 2000 ms writes the second. After the wall steps back
  60 s, the next frame marks at once. The rule itself, for both instances: inside the window refused, at it admitted, an equal
  reading refused, an earlier reading admitted by the mark's throttle only.

Red first: with `routes.ts` and `interruptlog.ts` changed and `server.ts` not yet, 13 of 50 failed: every server.ts route's mark
and real-pass case, and the clock-step drawer case; the rest stood green. With the change: 50 of 50.

## Mutation table

Every mutant was killed: 16 of 16, each against the 50 cases of the mark-paths file.

| # | Mutation | Red cases | Killed by |
|---|---|---|---|
| Q1 | the question door's call removed | 16 | every question-door pass and real-pass case, all four forms |
| Q2 | the question door marks a refused answer too | 4 | each form's refused case |
| Q3 | the question door marks before the answer | 4 | each form's refused case |
| T1 | the dialog tab move's call removed | 4 | its two pass cases and its two real-pass cases |
| T2 | the dialog tab move marks a refused move too | 1 | its refused case |
| I1 | the interrupt's call removed | 4 | its two pass cases and its two real-pass cases |
| I2 | the interrupt marks when it answered not-busy | 1 | its refused case |
| P1 | the picker's call removed | 4 | its two pass cases and its two real-pass cases |
| P2 | the picker marks whatever ccd answered | 1 | its refused case (ccd failing, 502) |
| P3 | the picker marks before ccd runs | 1 | its refused case |
| D1 | the drawer's mark throttle always admits (review 3736's M5) | 1 | two frames inside the window write one mark |
| D2 | the drawer's throttle built without `earlierAdmits` | 1 | after the wall steps back, the next frame marks |
| D3 | the earlier-reading rule removed | 2 | the clock-step case and the rule case |
| D4 | the rule at `<=` (an equal reading admits) | 1 | the rule case |
| D5 | the rule for every throttle (the interrupt record too) | 1 | the rule case |
| D6 | the window rule removed | 2 | the window case and the rule case |

Q1 to I2 ran against the picker's first form, P1 to D6 against its final one; the picker's hunk is the only difference, and none of
Q1 to I2 touches it.

The mark paths have no mutant set with a floor (`mutation-floors.json` names none of these functions), so these were run by hand
in a scratch copy of the tree, each restored after its run, against the mark-paths file.

## Known limits

- A mark means a console client used the route. With sign-in off any client can, as with E's paths; that keeps the break shut,
  the safe direction.
- The question door marks after the core's answer, so a pass that runs during the press's own wait reads no mark yet; the host's
  fresh roll refuses an open dialog at the act, as it does for E's submit route.
- The never-deleted throttle entries (review 3736 F2 (b)) are left as they are, by the brief.
- Other paths review 3736 did not examine (the attach upload, the kickoff route) were not examined here either.
