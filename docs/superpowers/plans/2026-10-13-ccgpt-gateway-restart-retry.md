# The ccgpt shim waits out a refused gateway connection — Implementation Plan

> Executed 2026-10-13, on the operator's approval of a bounded retry. This file records what the one task did, and it is the home of the deviation number the fix needed.

**Goal:** a release that restarts a Codex lane's LiteLLM gateway no longer ends sessions' turns. While the gateway is down and refusing connections, the shim holds each request and sends it again once the gateway listens.

**Architecture:** one change on the request path of the shim (`ccd/ccgpt-proxy.py`). A refused connect is retried every half second until a bound runs out. Every other upstream failure keeps today's immediate 502.

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` §22.4.

## Evidence (measured 2026-10-13, before any change)

- A release rebuilt one lane's runtime and restarted its LiteLLM gateway. The gateway took about 46 s to stop and listen again.
- In that window the shim met a refused TCP connection to its upstream and answered each request at once with `502 {"error":"ccgpt-proxy: upstream unreachable: <urlopen error [Errno 111] Connection refused>"}`.
- Claude Code ended the turn on it: 9 requests failed, 4 of them ending a session's turn.
- Every future release that moves the runtime's probe or patch (D-4859) restarts both lanes' gateways again, so this recurs.
- On this Python (3.12), `urllib.request.urlopen` against a closed local port raises `URLError(ConnectionRefusedError(111, 'Connection refused'))`: a `URLError` whose `.reason` is a `ConnectionRefusedError`. A second `urlopen` of the same `Request` object raises the same, so the request can be sent again as it is.

## Task: the shim waits out a refused connection (D-4933)

Files: `ccd/ccgpt-proxy.py`, `server/test/ccgpt-proxy.test.ts`, `README.md`, and the spec's §22.4.

- **What is retried.** Only a refused connect: a `URLError` whose `.reason` is a `ConnectionRefusedError`, or a bare `ConnectionRefusedError` (`_is_refused`). A refused connect proves no byte of the request reached upstream, so sending it again cannot send it twice. On it, `_urlopen_through_refusal` sleeps 0.5 s and sends the same request again: the same `Request` object, so the same method, path, forwarded headers and body bytes.
- **The bound.** 60 s by default, measured from the first refusal on the monotonic clock, since the outage measured ~46 s and Claude Code's own request timeout is far longer. The last sleep is clipped to the time left, so the final try lands on the bound itself. Then `_UpstreamRefused` is raised and `_relay` answers the same 502 refusal as before, saying `upstream unreachable: connection refused for 60s: <the last error>`.
- **The variable.** The optional `CCGPT_UPSTREAM_WAIT_S` overrides the bound: a whole number of seconds from 0 to 600, where 0 means no retry and today's exact message. `_optional_wait_s` reads it once at start-up. An invalid value refuses to start, in `_required_port`'s style: `ccgpt-proxy: refusing to start — CCGPT_UPSTREAM_WAIT_S is not a whole number of seconds from 0 to 600: '<raw>'`. Only one to three ASCII digits are read, so `int()`'s own leniency decides nothing. Absent, the default applies. Production units do not set it.
- **What is not retried.** A reset, a timeout, a connection accepted and then closed (`RemoteDisconnected`), any other `URLError` or `OSError`: each may have come after upstream saw the request. Each stays an immediate 502. The `HTTPError` arm, which relays a non-2xx status, is unchanged.
- **Docstrings.** The module docstring says the shim reads three required variables and one optional one, and `_required_env`'s no longer says the shim reads three. `_refuse`'s docstring names a refused connection as the exception to its "the request body WAS offered upstream" exception.
- **The tests.** A new describe, "ccgpt-proxy: a refused upstream connection is waited out, for a bounded time (D-4933)". `startPair` takes an optional fourth argument, `{ listenUpstream: false }`, which leaves the upstream port with nothing listening, and returns `listenUpstream()` to start it. A `timedPost` helper caps each request by an abort, so a mutation that makes the shim wait too long reds on the status, never on vitest's own 20 s timeout. Cases:
  1. A listener starts 1.5 s after the request, with `CCGPT_UPSTREAM_WAIT_S=10`: 200, the body relayed, upstream saw ONE request.
  2. Nothing ever listens, `CCGPT_UPSTREAM_WAIT_S=2`: a 502 in the JSON shape, an error matching `upstream unreachable` and `connection refused for 2s`, after at least 2 s and under 8 s.
  3. `CCGPT_UPSTREAM_WAIT_S=0`, nothing listens: a 502 in under 1.5 s.
  4. The existing vanish case under the default bound: a 502 in under 1.5 s, upstream reached exactly once.
  5. `abc`, `-1` and `601` each refuse to start with the named message, and `600` starts.
- **Red first.** Against the unchanged shim, 5 of the 8 new cases failed: case 1 (`expected 502 to be 200`), case 2 (the message had no wait in it) and the three invalid values (`expected 'still-serving' to be 'exited'`). Cases 3, 4 and the `600` start passed, being pins on behaviour that did not change.
- **Mutations, measured.** Each was applied alone, its named case run, and the file restored and checked with `git diff --quiet -- ccd/ccgpt-proxy.py`.

| Mutation | Red case | Red line |
|---|---|---|
| M1: the retry removed (`if True: raise`) | case 1 | `expected 502 to be 200` |
| M2: the retry widened to every `URLError` and `OSError` | case 4 | `expected null to be 502`: the shim was still waiting at the 10 s cap |
| M3: the variable ignored, always 60 | cases 2 and 3 | `expected null to be 502` for each, at the 15 s and 10 s caps |
| M4: the start-up validation dropped (`return int(raw)`) | case 5, all three values | `abc`: a `ValueError` traceback where the named message was expected; `-1` and `601`: `expected 'still-serving' to be 'exited'` |
| M5: the ceiling off by one (`<` for `<=`) | the `600` start | `ccgpt-proxy exited before answering its own /ccgpt/lane … refusing to start … '600'` |

## Verification

Every run was in the foreground, against fixture HOMEs only, on a loaded box (load average about 40), with `--maxWorkers=2`.

| Suite | Result |
|---|---|
| `ccgpt-proxy.test.ts` | 100 passed (92 before, 8 new) |
| `dtbd.test.ts`, `typecheck-tests.test.ts` | 1 and 12 passed |
| `single-definition.test.ts` | 537 passed |
| `deviation-refs.test.ts`, after `git fetch origin main` and `git add` of this plan | 31 passed (D-4933 defined once, here) |

## Deviations found

- **D-4933** — `shim-waits-out-refused-upstream`: the shim no longer answers a refused upstream connection with an immediate 502. It sends the same request again every half second until a bound runs out, measured from the first refusal, 60 s by default and set by the optional `CCGPT_UPSTREAM_WAIT_S` (0 to 600, 0 for none), and only then answers the same 502, saying the connection was refused for the whole wait. Only a refused connect is retried: it proves nothing reached upstream, so the request cannot be sent twice. A reset, a timeout, a connection accepted and then closed, and every other error stay an immediate 502. A gateway restart takes about 46 s, and while the shim answered it at once, Claude Code ended 4 sessions' turns on it. Spec §22.4.
