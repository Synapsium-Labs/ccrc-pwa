# W7 C7g: the PWA onto Q3f's operator door as merged, three departures, ruled

- **D-7485 (2026-10-29)** — W7 C7g: the PWA answers through Q3f's operator door as merged. No operator release door exists, so none is added. `/dialog/tab` and Deny stay session doors. The notification reads `questions-v1` through a region rendered from `lib/serverCaps.ts`

**D-7485.** The plan (`2026-10-27-consolidation-w7-pwa.md`, Task C7g, `D-7185`) was written before W3 Q3f merged. Step 0 read Q3f as merged (#1745) and found three places where the plan's reading differs from `main`. The record is `2026-10-29-consolidation-w7-c7g-note.md`. None of the three changes what the operator sees:

1. **No `releaseQuestion`.** The family's `/release` (and `/rule`) is the claimant's door: box token, attribution, the stored parent. The operator has only `POST /api/questions/session-<id>/answer`, and the PWA releases no question today. So `lib/api.ts` gains `answerQuestion(id, body)` only (slug `c7g-no-operator-release-door`).
2. **`/dialog/tab` and Deny stay.** Q3f keeps `/api/sessions/:id/dialog/tab` a session door, and Deny is the literal Escape (`api.interrupt(id, 'deny')`). The writers C7g deletes are the four the family replaces: `answerDialog`, `answerDialogText`, `answerDialogMulti` and `answerAsk` (slug `c7g-tab-and-deny-stay-session-doors`).
3. **The notification's cap read is rendered.** `lib/serverCaps.ts` is the one cap reader C7g adds, and it reads only `questions-v1` from `GET /health`'s `caps`. `push-sw.js` cannot import it, so its generated region gains a reader rendered from `serverCaps.ts#SERVER_CAPS_READ`, held equal to `advertisesQuestions` over one corpus (slug `c7g-notification-cap-read-rendered`). The region is still OA-C17 (a)'s (D-7265), rendered from `answerLifecycle.ts` and `refusalWords.ts`, and now also from `serverCaps.ts`.

The W7 plan is not edited, because merged plans are append-only. This file is the record, and C7g's PR defines the number.
