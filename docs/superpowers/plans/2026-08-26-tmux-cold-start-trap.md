# The tmux cold-start trap — incident record

**Not a plan.** The fix shipped as one commit against a fault found in production;
this file is its ledger and its narrative, kept because the loop it closes took the
fleet down for 4.5 hours without alerting, and because it falsifies an assumption
written into `ccd/ccd` that a reader would otherwise still trust.

**Fault:** 2026-08-26, fleet host. **Fix:** `fix/tmux-cold-start-probe`.

## What happened

An OOM killed the tmux server. Every `_session_probe` then read
`no server running on /tmp/tmux-1000/default`, which classifies `unknown` —
correctly. But `cmd_supervise`'s pre-flight skips `cmd_ensure` on `unknown`, and the
watch loop's `unknown` arm has **no exit**: it marks the substrate, stamps the
heartbeat and backs off, forever. All 18 units reported `active` for 4.5 hours while
nothing ran, which is why nothing alerted.

Recovery required a human running a bare `tmux new-session`. That bypasses
`_tmux_new_session`, so the server was born in the caller's cgroup rather than
`ccrc-tmux-server.scope`, and every pane inherited an uncapped location. Measured that
morning: `app-claude\x2dsession.slice` held `MemoryCurrent=78MB` against `Max=24G`
while all 18 pane scopes sat directly under `user@1000.service` — the aggregate ceiling
covering nothing, for the fourth time (after the 2026-08-10 hardcoded-path miss and the
2026-08-19 D-307 app.slice move).

At 04:35 two session processes reached 9.2G and 7.3G — inside their per-scope 12G caps,
which worked — and their sum plus the other sixteen panes hit the 26G `user@1000` cap
with no intermediate ceiling to absorb it. Panes carry `oom_score_adj=-900`, so the
kernel could not touch the offenders and killed the supervision layer instead, in
ascending protection order: `ccrc-agent` (200), `claude-docserver` (200), then systemd
PID 1179, the user manager itself (100). That killed the tmux server, and the trap
closed:

    trap -> manual bootstrap -> uncapped panes -> OOM -> kills infra -> tmux dies -> trap

## Why the obvious one-line fix is wrong

Mapping `no server running` to `gone` in `_session_probe`'s verdict case would let
`cmd_supervise` reach `cmd_ensure`, and it would also re-open a destructive path closed
on 2026-08-19. `sessionVerdictFixture.ts` pins that message as `unknown` deliberately,
and says so: *"Adding a row with `expected: 'gone'` for any message other than tmux's
own `can't find session` is the mistake this table exists to make loud."*

The teeth are real. `_ws_status` turns `gone` into `idle`; `ws-archive` and `ws-reap`
gate on `idle`; `cmd_forget` proves deadness with `! _alive || die`. During a cold start
that presents **every live session as reapable** and lets `forget` purge the registry
rows of sessions that are merely unreachable (D-308/D-309).

## The shape that fixes it

`_session_probe` publishes a **second, independent fact** beside the verdict:

    PROBE_SUBSTRATE=present|absent|unmeasured

It answers *"is there a tmux server at all"*, not *"is this session alive"*, and exactly
one caller reads it — `cmd_supervise`'s pre-flight. Every other caller (`_alive`,
`_ws_status`, `cmd_forget`, `ws-archive`, `ws-reap`, and the TS twin
`classifyHasSession`) still sees `unknown`, and still refuses.

Absence is safe to ensure into because there is no socket for `_tmux_new_session`'s
deadline-less `new-session` to block on — it creates one, in the capped scope. The wedge
(rc 124, tmux printed nothing) stays `unmeasured` and stays excluded, so the hang the
pre-flight was originally written for is still refused.

The errno is part of the absent pattern and is not optional:
`error connecting to … (No such file or directory)` is absence (no socket — the
cold-boot shape), while `(Permission denied)` and `(Connection refused)` are not — a
server may well be there — so they fall through to `unmeasured`.

## Deviations found

- **D-514** — the cold-start trap, and the assumption it falsifies. `_tmux_new_session`'s
  own comment says "NO NEW UNIT FILE: … it self-heals whenever the server is next
  created". That holds only while **ccd** is the creator. The trap is precisely what made
  a human the creator, so the self-heal never ran and the placement was silently lost on
  every pane. The comment was not wrong when written; it was conditional, and the
  condition was never stated. It now is, at both sites.
- **D-515** — the first cut of the fix referenced `$PROBE_SUBSTRATE` bare in
  `cmd_supervise`. `ccd` runs `set -uo pipefail`, and several suites stub
  `_session_probe` wholesale (`ccd-substrate.test.ts`'s `seq` double drives the watch
  loop through a scripted verdict sequence, setting `PROBE_VERDICT`/`PROBE_DETAIL` only).
  A bare reference therefore aborts the supervisor outright — a worse failure than the
  trap being fixed. Caught by that suite going red **unedited**; now `${PROBE_SUBSTRATE:-}`,
  where unset means "no claim about the substrate" and falls back to the prior behaviour.
- **D-516** — the regression test could not measure its own guard. `PROBE_SUBSTRATE` is a
  global that outlives the call, so the classification must be gated on the VERDICT, never
  on "only if unset" — otherwise a previous probe's answer carries forward. The test
  written for that used the wedge as its second probe, which returns early from the
  rc-124 branch and never reaches the guarded case, so it passed with the stale-global bug
  deliberately re-introduced (measured: 20/20 green). Its second probe is now protocol
  skew, which reaches the case; the same mutation now reds.

## Verification

Mutations measured, not asserted:

| mutation | tests red |
|---|---|
| revert the pre-flight escape | 2 |
| broaden the absent match to the bare `error connecting to` prefix | 1 |
| restore the stale-global guard | 1 |

`ccd-session-verdict.test.ts`, `exec.test.ts` and `ccd-substrate.test.ts` all green
**without being edited** — the regression gate for the verdict polarity.

## Deliberately not touched — two capacity/priority calls for the operator

1. **Per-scope 12G x 18 sessions cannot be bounded by a 24G slice ceiling.** A per-scope
   cap above the slice ceiling cannot protect anything, because the slice binds first;
   two heavy sessions alone reproduce this incident's arithmetic. Sizing per-scope so
   that two or three concurrent heavies fit under the slice would make it real, or the
   slice needs to grow.
2. **The `oom_score_adj` ordering is inverted.** At `-900`, panes are the most protected
   thing in the slice while being the thing consuming the memory, so an OOM inside the
   slice kills supervise shells (200) before the panes causing it. Moderating the panes
   is the direction that makes the offender die first.
