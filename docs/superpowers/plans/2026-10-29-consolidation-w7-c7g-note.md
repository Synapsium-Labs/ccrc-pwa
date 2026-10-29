# W7 C7g: Step 0 read of Q3f as merged, and where it departs from the plan's reading

Task C7g of `2026-10-27-consolidation-w7-pwa.md` (`D-7185`; ARCH-57 #792, PWA half). Step 0 read W3 Q3f as merged (#1745): `server/src/coord/routes.ts`'s `/api/questions/:id/*` family, `server/src/coord/questions.ts`, `shared/api.ts`'s `QuestionAnswerBody`, `readDialogAnswer`, `QUESTION_DOOR_REFUSALS` and the `questions-v1` cap, and `server/test/question-doors.test.ts`. The plan is not edited, because merged plans are append-only. This note records what Step 0 found, and `2026-10-29-w7-c7g-questions-doors-ruled.md` defines the number (D-7485).

## What Q3f merged, as C7g reads it

| Fact | On `main` |
|---|---|
| The operator's door | `POST /api/questions/session-<id>/answer`, session-gated and origin-checked, the id read by `shared/api.ts#parseQuestionId` |
| Its bodies | `{kind:'ask', askKey, optionIndexes}` (replaces `/api/sessions/:id/ask`); `{kind:'dialog', dialogId, optionIndex}` (`/dialog`); the same with `text` (`/dialog/text`); `{kind:'dialog', multi:true, dialogId, optionIndexes}` (`/dialog/multi`) |
| Its answers | the old door's, byte for byte: the same core (`questions.answer`) and the same `sendAnswer` |
| Its own refusal word | `kind-mismatch` (400), `shared/api.ts#QUESTION_DOOR_REFUSALS`; the rest of its ladder is `bad-request` and `unknown-session`, which the old doors also return |
| `/release` and `/rule` | the CLAIMANT's doors: box token, attribution, the stored parent. They are not the operator's |
| `/api/sessions/:id/dialog/tab` | not in the family: "answers nothing and stays a session door" (the family's header comment in `routes.ts`) |
| The cap | `questions-v1` in `GET /health`'s `caps` (`/health` is ungated: `auth/gate.ts`) |
| The aliases | the four old operator doors stay, into the same core, until C7p |

## The departures (each named `slug`, all one number)

- **slug `c7g-no-operator-release-door`.** The plan's Files list gives `lib/api.ts` "one `answerQuestion(id, body)` and one `releaseQuestion(id)`". On `main` the family's `/release` is the claimant's hand-over (box token, `fromId`/`fromUuid`, attribution against the registry), and the PWA has no question release today (`api.release` is the session hold's `/api/sessions/:id/release`, a different fact). No operator door exists to map `releaseQuestion` onto, so C7g adds none. Nothing changes: the PWA releases no question before or after.
- **slug `c7g-tab-and-deny-stay-session-doors`.** The brief lists `dialog/tab` among the old writers to delete. Q3f keeps `/dialog/tab` a session door (it answers nothing), so `api.answerDialogTab` keeps its one caller, `answerLifecycle.ts#performAnswer`'s `tab` arm, and Deny keeps its literal Escape (`api.interrupt(id, 'deny')`). The deleted writers are the four the family replaces: `answerDialog`, `answerDialogText`, `answerDialogMulti` and `answerAsk`. Nothing changes.
- **slug `c7g-notification-cap-read-rendered`.** The plan names `lib/serverCaps.ts` as the one cap reader W7 adds. `push-sw.js` is a classic script the service worker `importScripts`, so it cannot import it. The notification's read of `questions-v1` is therefore rendered into its generated region from `serverCaps.ts`'s declared shape (`SERVER_CAPS_READ`: the path, the fetch option, the word), as C7e renders its request from `ASK_REQUEST` (OA-C17 (a)). A row evaluates the rendered reader and `serverCaps.ts#advertisesQuestions` over one corpus of `/health` answers and holds them equal. What the operator sees does not change: the worker asks `GET /health` before it answers. A server that advertises the word gets the family's door; any other answer, an unreadable one or a failed request gets the old door, which every server before C7p still answers.

## The skew rows (spec §5.1 rule 1c)

- **A new PWA against a server without `questions-v1`** (an older server, or a rollback): `lib/serverCaps.ts` reads `GET /health`. If the word is absent, the body cannot be read, or the request fails, both the sheets (`api.answerQuestion`) and the notification answer through the old door, with today's bytes. The cost on the sheets: one `GET /health` when `DialogSheet` mounts. Any answer the server gives is held for 60 s, and only a failed request is read again on the next answer, so a tap's request goes out at once. The cost on the notification: one `GET /health` per tap, before its POST.
- **An old PWA against a new server**: Q3f's aliases answer it, unchanged (`question-doors.test.ts`'s pairs hold the new path equal to the old door).
