# The ccgpt shim waits out a refused gateway connection — Implementation Plan

> Executed 2026-10-13, on the operator's approval of a bounded retry. This file records what the one task did, and it is the home of the deviation number the fix needed.

**Goal:** a release that restarts a Codex lane's LiteLLM gateway no longer ends sessions' turns. While the gateway is down and refusing connections, the shim holds each request and sends it again once the gateway listens, for as long as the client is still connected.

**Architecture:** one change on the request path of the shim (`ccd/ccgpt-proxy.py`). A refused connect is retried every half second, while its client is still connected, until a bound runs out. Every other upstream failure keeps today's immediate 502.

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` §22.4.

## Evidence (measured 2026-10-13, before any change)

- A release rebuilt one lane's runtime and restarted its LiteLLM gateway. The gateway took about 46 s to stop and listen again.
- In that window the shim met a refused TCP connection to its upstream and answered each request at once with `502 {"error":"ccgpt-proxy: upstream unreachable: <urlopen error [Errno 111] Connection refused>"}`.
- Claude Code ended the turn on it: 9 requests failed, 4 of them ending a session's turn.
- Every future release that moves the runtime's probe or patch (D-4859) restarts both lanes' gateways again, so this recurs.
- On this Python (3.12), `urllib.request.urlopen` against a closed local port raises `URLError(ConnectionRefusedError(111, 'Connection refused'))`: a `URLError` whose `.reason` is a `ConnectionRefusedError`. A second `urlopen` of the same `Request` object raises the same, so the request can be sent again as it is.

## Task: the shim waits out a refused connection (D-4933)

Files: `ccd/ccgpt-proxy.py`, `server/test/ccgpt-proxy.test.ts`, `README.md`, and the spec's §22.4.

- **What is retried.** Only a refused connect: a `URLError` whose `.reason` is a `ConnectionRefusedError`, or a bare `ConnectionRefusedError` (`_is_refused`). A refused connect proves no byte of the request reached upstream, so a request that reached upstream is never sent again. On it, `_urlopen_through_refusal` sleeps 0.5 s and sends the same request again: the same `Request` object, so the same method, path, forwarded headers and body bytes.
- **Only while the client is still connected.** After each sleep, before the re-send, `_urlopen_through_refusal` calls `Handler._client_gone`, which peeks one byte of the client's socket with `MSG_PEEK | MSG_DONTWAIT`: `b''` means the client closed; `BlockingIOError` means it is still there and silent; bytes mean it is still there; any other `OSError` counts as gone. Once the client has gone it raises `_ClientGone`, carrying the last refusal, which `_relay` catches alone: nothing is sent upstream, and the same immediate 502 a refused connection got before D-4933 (`upstream unreachable: <the last error>`) is written. The write is guarded against `OSError` (`BrokenPipeError` and `ConnectionResetError` among it), so a client that has gone never prints a traceback. A peek cannot tell a client that closed both directions from one that only half-closed (sent its request, shut its writing side, and still reads), so the 502 is written for both: the half-closed one reads it, and the one that has gone discards it. So a request is never sent for a client that has gone. A client that gave up, and perhaps asked again, would otherwise have its old request reach a gateway that has come back. One client cannot be seen to leave: a client with a further request already queued behind this one (HTTP pipelining), because the peek then returns that request's bytes, not the client's close. Its old request is then still sent when the gateway returns. The shim's one real client does not pipeline.
- **The bound.** 60 s by default, measured from the first refusal on the monotonic clock, since the outage measured ~46 s and Claude Code's own request timeout is far longer. The last sleep is clipped to the time left, so the final try lands on the bound itself. Then `_UpstreamRefused` is raised and `_relay` answers the same 502 refusal as before, saying `upstream unreachable: connection refused for 60s: <the last error>`.
- **The variable.** The optional `CCGPT_UPSTREAM_WAIT_S` overrides the bound: a whole number of seconds from 0 to 600, where 0 means no retry and today's exact message. `_optional_wait_s` reads it once at start-up. An invalid value refuses to start, in `_required_port`'s style: `ccgpt-proxy: refusing to start — CCGPT_UPSTREAM_WAIT_S is not a whole number of seconds from 0 to 600: '<raw>'`. Any string of ASCII digits is read, leading zeros included (`0600` is 600), and its length is checked after the zeros are stripped and before `int()` is called, so `int()`'s own leniency decides nothing and a 5000-digit string never reaches it. The empty string and every non-ASCII digit are refused. Absent, the default applies. Production units do not set it.
- **What is not retried.** A reset, a timeout, a connection accepted and then closed (`RemoteDisconnected`), any other `URLError` or `OSError`: each may have come after upstream saw the request. Each stays an immediate 502. The `HTTPError` arm, which relays a non-2xx status, is unchanged.
- **Docstrings.** The module docstring says the shim reads three required variables and one optional one, and `_required_env`'s no longer says the shim reads three. `_refuse`'s docstring names a refused connection as the exception to its "the request body WAS offered upstream" exception, straight after that sentence. The `_REFUSED_RETRY_S` comment says what a try costs: about 100 µs of CPU, roughly 12 ms per request per minute of waiting.
- **The tests.** A new describe, "ccgpt-proxy: a refused upstream connection is waited out, for a bounded time (D-4933)". `startPair` takes an optional fourth argument, `{ listenUpstream: false, upstreamPort }`: the first leaves the upstream port with nothing listening and returns `listenUpstream()` to start it; the second replaces the fixed upstream port for that one case. Each refused-connection case picks its own port (bound at 0, read, closed), so the fixed port is never left unbound for one of them. A `timedPost` helper caps each request by an abort, so a mutation that makes the shim wait too long reds on the status, never on vitest's own 20 s timeout. Cases:
  1. A listener starts 1.5 s after the request, with `CCGPT_UPSTREAM_WAIT_S=10`: 200, the body relayed, and the upstream's one matching request is a `POST` to `/v1/models` with `application/json` and the body `{}`.
  2. The production default: the variable absent, a listener starting 1.5 s after the request: 200 and one matching request. Every other case sets the variable, so only this one goes red when the default is 0 or an absent variable reads as 0.
  3. Nothing ever listens, `CCGPT_UPSTREAM_WAIT_S=2`: a 502 in the JSON shape, an error matching `upstream unreachable` and `connection refused for 2s`, after at least 2 s and under 8 s (the request capped at 10 s).
  4. `CCGPT_UPSTREAM_WAIT_S=0`, nothing listens: a 502 in under 1.5 s, with exactly today's message, `ccgpt-proxy: upstream unreachable: <urlopen error [Errno 111] Connection refused>` (61 on macOS).
  5. The client has gone: nothing listens and the bound is 10 s; a raw client sends the POST and closes its socket at about 1 s; the listener starts at about 2.5 s. 1.5 s later upstream has seen 0 requests, the shim still answers `/ccgpt/lane`, and its stderr holds no traceback (the 502 is written into a closed socket, and the guard on that write is what keeps the traceback out).
  6. The client half-closed: nothing listens and the bound is 10 s; a raw client sends the POST, shuts its writing side (`SHUT_WR`) and keeps reading. It receives a 502 with today's message, `upstream unreachable: <urlopen error [Errno 111] Connection refused>`; the listener starts at about 2 s, and 1.5 s later upstream has seen 0 requests and stderr holds no traceback.
  7. The existing vanish case under the default bound: a 502 in under 1.5 s, upstream reached exactly once.
  8. `abc`, `-1`, `601`, `٣` (an Arabic-indic digit) and a string of 5000 digits each refuse to start with the named message, and `600` and `0600` start.
- **Red first.** Round 1: against the unchanged shim, 5 of the 8 new cases failed: case 1 (`expected 502 to be 200`), case 3 (the message had no wait in it) and the three invalid values (`expected 'still-serving' to be 'exited'`). Fix round 1: against the round-1 shim, case 5 failed (`expected [ { method: 'POST', …(3) } ] to have a length of +0 but got 1`) and `0600` failed (`refusing to start … '0600'`). The default, `٣` and the 5000-digit cases passed there, being pins, and each has its own mutation below. Fix round 2: against the round-1 shim, case 6 failed (`expected '' to match /^HTTP\/1\.[01] 502 /`: the client that half-closed was closed on without an answer).
- **Mutations, measured.** Each was applied alone, its named case run, and the file restored and checked with `git diff --quiet -- ccd/ccgpt-proxy.py`.

| Mutation | Red case | Red line |
|---|---|---|
| M1: the retry removed (`if True: raise`) | case 1 | `expected 502 to be 200` |
| M2: the retry widened to every `URLError` and `OSError` | case 7 | `expected null to be 502`: the shim was still waiting at the 10 s cap |
| M3: the variable ignored, always 60 | cases 3 and 4 | `expected null to be 502` for each, at the 10 s cap |
| M4: the start-up validation dropped (`return int(raw)`) | case 8, all five values | `abc` and the 5000 digits: a `ValueError` traceback where the named message was expected; `-1`, `601` and `٣`: `expected 'still-serving' to be 'exited'` |
| M5: the ceiling off by one (`<` for `<=`) | both `600` and `0600` starts | `ccgpt-proxy exited before answering its own /ccgpt/lane … refusing to start … '600'` |
| M6: the liveness check removed | cases 5 and 6 | case 5: `expected [ { method: 'POST', …(3) } ] to have a length of +0 but got 1`; case 6, re-measured in fix round 2: the shim keeps waiting instead of answering, so `expected '' to match /^HTTP\/1\.[01] 502 /` |
| M7: the default 0 | case 2 | `expected 502 to be 200` |
| M8: an absent variable read as 0 | case 2 | `expected 502 to be 200` |
| M9: `isascii()` dropped | `٣` | `expected 'still-serving' to be 'exited'` |
| M10: `int()` called before the length check | the 5000 digits | `ValueError: Exceeds the limit (4300 digits) for integer string conversion` in stderr |
| M11: the zeros not stripped before the length check | `0600` start | `refusing to start … '0600'` |
| M12: `_relay` not catching `_ClientGone` | case 5 | `expected '…' not to match /Traceback/` |
| M13: the generic 502's message changed | case 4 | `expected 'ccgpt-proxy: upstream unreachable: re…' to be 'ccgpt-proxy: upstream unreachable: <u…'` |
| M14: a silent client counted as gone (`BlockingIOError` returns True) | case 1 | `expected null to be 200` |
| M15: the re-send changes the content-type | case 1 | `expected { method: 'POST', …(3) } to deeply equal { method: 'POST', …(3) }` |
| M16: the 502 for a client that has closed removed (`_relay`'s `_ClientGone` arm only closes) | case 6 | `expected '' to match /^HTTP\/1\.[01] 502 /` |
| M17: the guard on that 502's write removed (`OSError` no longer caught) | case 5, red in 5 of 5 runs | `expected '…' not to match /Traceback/`, with `BrokenPipeError: [Errno 32] Broken pipe` in the shim's stderr |

## Verification

Every run was in the foreground, against fixture HOMEs only, on a loaded box (load average about 40), with `--maxWorkers=2`.

| Suite | Result |
|---|---|
| `ccgpt-proxy.test.ts` | 106 passed (92 before this plan, 14 new) |
| `dtbd.test.ts`, `typecheck-tests.test.ts` | 1 and 12 passed |
| `single-definition.test.ts` | 537 passed |
| `deviation-refs.test.ts`, against the local `origin/main` ref (no fetch in fix round 2) | 31 passed (D-4933 defined once, here) |

## Deviations found

D-4933 was issued by the allocator on 2026-10-13 and is defined once, here.

- **D-4933** — `shim-waits-out-refused-upstream`: the shim no longer answers a refused upstream connection with an immediate 502. It sends the same request again every half second until a bound runs out, measured from the first refusal, 60 s by default and set by the optional `CCGPT_UPSTREAM_WAIT_S` (0 to 600, 0 for none), and only then answers the same 502, saying the connection was refused for the whole wait. Only a refused connect is retried, and only while its client is still connected: it proves nothing reached upstream, so a request that reached upstream is never sent again, and a request is never sent for a client that has gone. A reset, a timeout, a connection accepted and then closed, and every other error stay an immediate 502. A client that closed while the shim waited gets the same 502 and nothing is sent upstream for it; a client with a further request already queued behind this one (HTTP pipelining) cannot be seen to leave, so its old request is still sent when the gateway returns, and the shim's one real client does not pipeline. A gateway restart takes about 46 s, and while the shim answered it at once, Claude Code ended a session's turn 4 times on it. Spec §22.4.
