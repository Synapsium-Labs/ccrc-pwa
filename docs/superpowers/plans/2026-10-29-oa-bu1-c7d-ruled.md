# OA-BU1 and the W7 C7d fixture re-point, ruled

- **D-7460 (2026-10-29)** — operator act OA-BU1 ruled option (b): the model-class registry's `baseUrl` decides through `BASE_URL_OK` and stores the gate's normalised URL.
- **D-7461 (2026-10-29)** — W7 C7d's unlisted fixture re-point, a coordinator ruling: fixtures that build sessions with no run binding are given the binding the current server sends, as a named exception with a mapping table, plus one explicit old-server skew row.

**D-7460.** On 2026-10-29 the operator ruled OA-BU1 (base-url plan, `docs/superpowers/plans/2026-10-29-consolidation-ts-mjs-kernel-base-url.md`, §Operator acts) **option (b)**. The plan recommended (a). The plan is not edited, because merged plans are append-only, so this file is the record, and BU3 cites it.

What (b) means:
- `shared/models.mjs#parseRegistry` asks `BASE_URL_OK` and refuses the six rows the one gate refuses (user name or password, query, fragment), each with a sentence naming the reason.
- It stores the gate's normalised `url`, as `roster.ts` does. This fixes the stored-with-spaces row and rewrites 5 of the 9 accepted values (a trailing `/` on a bare host, a lower-cased scheme and host).
- Every pin that reads one of those values back is re-pointed in BU3, in its own red-first behaviour commit.
- Inline gates go from 1 to 0, and loopback sets from 2 to 1.

BU3 ships on the server lane and the agent lane. Its PR body names the rows whose stored value changes, and says that a registry file holding one of the six refused forms stops parsing until the value is fixed.

**D-7461.** W7 C7d (the PWA reads the run binding from the wire; plan `docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md`) stopped at Step 0. Moving every consumer onto the wire binding turns 14 unlisted pwa test files red (61 tests), plus `pwa/browser/programme-box.browser.test.ts`. Their fixtures build sessions with no `run`/`openRun` key, which is the shape an older server sends.

The coordinator rules this a named exception to "an unlisted pin that goes red stops the task":
- C7d re-points those fixtures to carry the binding the current server sends, in ONE commit before the behaviour commit.
- Its PR body carries a mapping table showing every changed row keeps its meaning (the same nesting, rollups, programme boxes, orphan markers, run-board doors, header line and abandon sheet as before).
- One new explicit row pins the old-server shape: no binding, so an open run finds no worker, per the plan's skew rule.
- No assertion is dropped or loosened.
