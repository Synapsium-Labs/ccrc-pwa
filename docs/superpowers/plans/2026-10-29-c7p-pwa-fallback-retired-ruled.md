# W7 C7p: the PWA's skew fallback to the old answer doors goes with them

- **D-7540 (2026-10-30)** — W7 C7p: the PWA's skew fallback to the old operator answer doors is retired with the doors (slug `c7p-pwa-fallback-retired`), and `lib/serverCaps.ts` goes with it

**D-7540.** The plan (`2026-10-27-consolidation-w7-pwa.md`, Task C7p, `D-7194`) names only the server side in its Files list: the operator answer aliases in `server/src/server.ts` and their route census rows. Its Step 3 exit says "the PWA bundle has no reference to a removed path". On `main`, W7 C7g (#1912, D-7485) kept the PWA on the old doors as the skew fallback for a server whose `GET /health` lacks `questions-v1`:

- `pwa/src/session/answerLifecycle.ts#LEGACY_ANSWER_DOORS`, read by `questionAnswerRequest` and by `ASK_REQUEST`'s `pathPrefix`/`pathSuffix`;
- `pwa/public/push-sw.js`'s generated region, which rendered `'/api/sessions/' + id + '/ask'` and a `questionsDoor()` reader of `GET /health`;
- `pwa/src/lib/serverCaps.ts`, the one cap reader, read by `lib/api.ts#answerQuestion` (through `questionsDoor`) and by `DialogSheet` on mount and on each return to view.

The exit cannot hold while these stand, so C7p retires them in its own behaviour commit, before the server aliases go, and in its own PR (below). That departs from the plan's Files list, hence this number.

1. **One door.** Every operator answer (an option row, the own words, a multiSelect set, the notification's ask) goes to `POST /api/questions/session-<id>/answer` with the family's body, whatever `/health` says. `questionAnswerRequest(id, body)` and `answerRequest(c)` lose their `questions` argument; `ASK_REQUEST` loses `pathPrefix` and `pathSuffix`; `LEGACY_ANSWER_DOORS` is deleted.
2. **No cap read.** `lib/serverCaps.ts` has no reader once the fallback goes, so Step 0 decides it goes: the module, `api.questionsDoor`, `DialogSheet`'s mount and return-to-view reads, push-sw's rendered `questionsDoor()` and the test corpus `pwa/test/healthCorpus.ts`. A tap is no longer preceded by any `GET /health` read in the sheets or the notification. The server keeps advertising `questions-v1` (`shared/api.ts#SERVER_CAPS`); nothing in the PWA reads it now.
3. **The generated region** of `push-sw.js` is re-rendered from its sources (`answerLifecycle.ts#ASK_REQUEST`, `refusalWords.ts`) and stays byte-equal to them through `push-sw.test.ts`.
4. **Unchanged:** `/api/sessions/:id/dialog/tab` and Deny's literal Escape stay session doors; the in-flight guard (D-5089, D-5090, D-5091); a notification answers only its own `ask:<key>:<index>`; what every screen shows against a server with `questions-v1`.

**The skew cost.** A new PWA against a server without `questions-v1` (a server older than W3 Q3f, #1745, or one rolled back below it) can no longer answer a question: each answer gets that server's 404. C7g's PWA has been the only PWA for nine releases (`v0.0.834` to `v0.0.842`), and the PWA ships inside the server's release, so a server below Q3f serves its own older PWA. An old PWA against a new server is the server half of C7p (the aliases), recorded in its PR.

**Two PRs, the PWA half first.** C7p lands as two PRs. The first, this one, is the PWA half: the behaviour commit above, and the census row and ratchet that hold the PWA bundle at 0 references to the four old doors (`census-w7/pwa.ts#retiredAnswerPathRefs`, `rings/pwa-one-owner.test.ts`). The second is the server half: the four aliases, one per commit, with their inventory rows under the W3 plan's exception 3. It lands after this one, so no server retires a door while a merged PWA still names it. The halves cannot share one diff. The server half edits `server/src/coord/questions.ts`, a file W3 owns, and the W3 path guard (`consolidation-path-guard.test.ts`, slug `question-census`) reds any diff that touches a W3-owned file beside a `pwa/` path. The guard has no exception, and none is added.

The W7 plan is not edited, because merged plans are append-only. This file is the record, and C7p's PWA-half PR defines the number.
