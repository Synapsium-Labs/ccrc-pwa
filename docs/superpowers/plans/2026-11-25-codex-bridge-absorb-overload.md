# The Codex bridge absorbs a short provider failure

**Date:** 2026-11-25
**Spec:** `docs/superpowers/specs/2026-10-15-codex-bridge-design.md` §2.4 (the error table, "Upstream unavailable").
**Plans it follows:** `2026-10-22-codex-bridge-stage-2-bridge.md` (the error table, the commit point, the request
sequence), `2026-11-13-codex-bridge-gpt-lane-parity.md` (the parity section, the request record, the 400 fallback),
`2026-09-08-gpt-lane-compaction-wedge.md` (why the launcher sets two retries and 870 s).

## The problem, measured

The launcher `ccd/ccrc-codex` exports `API_TIMEOUT_MS=870000` and `CLAUDE_CODE_MAX_RETRIES=2`. Both are deliberate: 870 s
times the stock 10 retries held one session for over two hours on a compaction that could not finish. They stay.

The retry count also governs failures that come back at once. The backend answered `server_is_overloaded`; the bridge
answered 529 immediately; Claude Code sent three requests at 0, 1.9 and 3.5 s and ended the turn, and the worker did not
recover. A lane with the stock 10 retries rides the same error out: attempts were measured at 0, 0.5, 1.7, 4.1, 8.9, 17.8,
34.8 and 68.4 s of about 3 minutes. A 503 `upstream unavailable` ends the turn the same way.

## The change

Before the commit point only, the bridge tries a short, transient upstream failure again itself, with bounded backoff,
and answers exactly the error it answers today once the bounds are spent.

- **Who decides.** `ccd/codexbridge/absorb.py` (pure: `word`, `delay` and the constants). `server.py#_Request._absorb`
  measures, waits, counts and acts. `server.py#_Request._one_response` is the one place a failed attempt is either tried
  again or recorded and answered: `_post` and `_reduce` now hand their failure back unrecorded.
- **Which.** The error table's `overloaded` row (529) and `unavailable` row (503), as an HTTP answer, as a
  `response.failed` or an `error` event, or as a stream that ended with no terminal; and a POST with no answer, which is
  the same `unavailable` row with no upstream status (code `transport`). Nothing else: not `rate`, `billing`, `policy`,
  `overflow`, `ineligible`, `refused`, `auth` or `capability`, and not the credential library's own transient 503, which
  never reaches the decision. A response that reached its terminal (an `incomplete` with an unknown reason) is never sent
  again.
- **Bounds**, module constants read when used: `BUDGET_S` 120 from the message's first POST to the start of the last
  retry, `FIRST_S` 1 doubling to `CAP_S` 20, `JITTER` 0.25, `FAST_S` 30. A `retry-after` (delta-seconds, the error table's
  own reader, `errors.py#retry_after_of`) replaces a shorter wait, and one that does not fit is answered at once.
- **Fast only.** An attempt that took `FAST_S` or longer is answered. So one request costs at most 120 s more than before
  plus one attempt, and the wedge (4 x 870 s) cannot come back. The connect bound (30 s) and the idle bound (300 s) are both
  past it.
- **It stops** when the stream is closed (the drain's cut) or the client's socket has closed, asked every `WAIT_TICK_S`
  by `server.py#client_closed`, a one-byte peek under the shim's rule (D-4933).
- **Counted once.** `stats.request`, the outcomes and the status file see only the failure that is answered. Each absorbed
  one is counted in the parity row's `absorbed` (by `overloaded`, `unavailable`, `transport`), beside `fallbacks`, and is a
  request-record row with the outcome `absorbed`. `parity_effort` and `markers` count each body sent, as they do for the
  fallback's retry; a parity response is counted once, because an attempt whose terminal arrived is not tried again.

## Tests

`server/test/codex-bridge-absorb.test.ts` (the decision), the last `describe` of `server/test/codex-bridge-server.test.ts`
(a real bridge against a local fake upstream), and two cases in `server/test/codex-bridge-count-stats.test.ts` (the
counter). Each guard was removed in turn and its case measured red; the pull request lists them.

## What this does not claim

- It does not change what Claude Code does with a 529 or a 503 once it is answered: it still has its two retries, so a
  provider that stays down for long still ends the turn, after about six minutes instead of a few seconds.
- It does not retry after the commit point. A failure in a continued message, or more than 15 s after a 2xx head, is
  answered as before.
- It was not run against the live backend.

## Deviations found

- **D-TBD-bridge-absorb** — the brief this plan was written from says which failures are retried and how; four points were decided
  while building:
  1. Only a request carrying Claude Code's beta (`inbound.py#from_claude_code`) is absorbed. The models canary posts to the
     same route with its own 90 s deadline and reads a 529 or a 503 as a refusal; holding its request for 120 s would have
     turned every such answer into "not ready". Its requests carry no beta.
  2. A connect that timed out is a connection that failed before any response, but it takes 30 s, so the fast rule answers
     it at once. A refused, reset or dropped connection is absorbed.
  3. A client that leaves during the wait, and a drain that cuts it, leave the failure recorded in the status file: it was
     not overcome. It is counted `client-gone` or `drain-cut`, never `5xx`.
  4. `client_closed` is a second copy of the shim's peek (`Handler._client_gone`), legitimately different because the two
     files are placed apart: the installer places the shim and the package is read from the tree, so a hook passed between
     them would be missing whenever they are one release apart, and the retries silently off. The shim's copy serves its
     `litellm` mode only.
