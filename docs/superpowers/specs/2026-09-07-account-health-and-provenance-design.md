# Account health, telemetry provenance, and the pre-emptive swap lane — Design

**Status:** design complete, awaiting operator review. No implementation until approved.
**Base:** `main` @ `58ef97b6` (account-pools waves 1 and 2a merged; 2b/3/4/5 are merged plans, unopened).
**Line anchors are snapshots.** Where an anchor and the shipped source disagree, the source wins.

---

## 1. The defect

An account whose credential dies keeps an executable wrapper and an enabled lane, so `_account_ok`
(`ccd/ccd:1238`) still says yes. Its last telemetry sample stays on disk. Its `fiveResetAt` passes
within five hours and its `sevenResetAt` within a week — and `_limit_field` (`ccd/ccd:11728`) then
rewrites both halves to a hard `0`:

```bash
reset=$(_limit_json_num "$f" "${field}ResetAt")
if [[ -n "$val" && -n "$reset" && "$now" -ge "$reset" ]]; then
  printf '0'; return 0
fi
```

`_limit_score` returns `max(0,0) = 0`. `_ws_least_loaded` (`ccd/ccd:3788`) keeps the lowest score with
a strict `<`, so a `0` beats every honest account on the fleet. Nothing runs on the dead account, so
nothing ever reports a real number, so it stays `0` forever. **The deadest lane becomes the most
attractive destination, and stays that way.**

The server mirrors the same arithmetic (`server/src/limits.ts:142-145`) and additionally *names* the
distinction — `fiveRolledOver` / `sevenRolledOver`, docstring: *"the 0 above is inferred from the reset
timestamp rather than observed. Distinct from a measured 0"* — then overwrites `five`/`seven` to `0`
anyway, before `projectHome` (`:96`) ever sees the row. `measured()` (`:40`) names only `five` and
`seven`.

**So the ranking does not ignore the rollover event. It ignores the PROVENANCE of the zero.** An
inferred zero and a measured zero are the same number to the placement rule. This is the tree's own
"no overloaded null at a seam" rule violated at the seam that decides placement: *rested* and *dead*
render identically.

### What is NOT the defect

An earlier reading of this held that unmeasured accounts win placement. They do not, and the code is
careful about it. `_ws_least_loaded` skips unmeasured; `_swap_target` ranks it last via
`: "${sc:=100}"`; `_avail` (`ccd/ccd:11785`) keeps it eligible so a rescue always has a destination.
The rule those three sites state and enforce:

> unmeasured never OUTRANKS measured, and never becomes INELIGIBLE.

That rule is correct and this design does not touch it. The defect is that an inferred zero is not
currently *treated* as unmeasured — it is treated as the best measurement on the fleet.

---

## 2. Evidence base

Everything below was measured on the fleet host, not inferred. Each row is reproducible.

| # | Measurement | Result |
|---|---|---|
| E1 | `GET /api/oauth/usage` with a live account's `CLAUDE_CODE_OAUTH_TOKEN` | **403** `oauth_scope_insufficient` — authenticates, then refuses: setup tokens lack `user:profile` |
| E2 | Same endpoint, well-formed but invalid `sk-ant-oat…` | **401** `authentication_error` ("OAuth access token is invalid.") |
| E3 | Same endpoint, malformed bearer | **401** `authentication_error` ("Invalid bearer token") |
| E4 | Same endpoint, **empty** bearer | **429** `rate_limit_error` — *not* an auth answer |
| E5 | Real statusline payload, all four Anthropic accounts | `rate_limits` carries **only** `five_hour` and `seven_day`; no per-model, no `model_scoped`, no `extra_usage` |
| E6 | Statusline render at session start, before any API call | `rate_limits: null` — limits are **not** served from cache |
| E7 | Statusline render after one trivial turn | populated with fresh values + `resets_at`; `~/.cc-limits/<id>.json` refreshed |
| E8 | Credential storage | all four Anthropic accounts authenticate via `CLAUDE_CODE_OAUTH_TOKEN` from `~/.cc-secrets/<id>-oauth.env`; `.credentials.json`'s `claudeAiOauth` block is empty everywhere |
| E9 | Outbound network in `ccd/ccd` | **zero** — one `curl` in 13k+ lines, inside a comment |
| E10 | The four swap constants on `main` | `SWAP_THRESHOLD`, `SWAP_HEADROOM`, `SWAP_FRESH`, `SWAP_QUIET` — one occurrence each (own assignment), **zero readers** |
| E11 | Reset simultaneity | `claude` and `claude-corp` share a `fiveResetAt`; `claude2` and `claude-dev0` are staggered |
| E12 | Bash mutation of the rollover branch | exactly **2** assertions red (+1 with the age branch); TS side **5** |

**E1–E4 together are the load-bearing find.** The endpoint authenticates *before* it checks scope, so
it is a working liveness oracle even though it cannot return usage: **401 = dead, 403-scope = live.**
E4 is the trap — a missing or empty secrets file answers 429, so a classifier reading "not 403" as
dead would condemn every account the moment a file went missing.

**E5 + E1** close per-model (Fable) limits on both routes ccrc can reach. See §9.

---

## 3. Rulings taken

| # | Ruling | By |
|---|---|---|
| R1 | Ship shape **C**: fix the provenance defect first; layer the health signal as a *reading*, not a gate | operator |
| R2 | A health signal **may** gate placement eligibility in principle | operator |
| R3 | Implement the pre-emptive lane the dead constants describe; do **not** delete them | operator |
| R4 | Fold the pre-emptive lane into account-pools **wave 2b** | operator |
| R5 | Build the keepalive (W1) | operator |
| R6 | The health signal **ranks last / skips**; it does **not** enter `_account_ok` | design, accepted |
| R7 | Overturn `rolled-over-window`, a shipped test asserting the defect is correct | design, accepted |
| R8 | The swap-verb timeout ships as its own PR, first, uncoupled | design, accepted |

R6 narrows R2 deliberately. R2 remains the permission that makes the probe legitimate at all; §A.4
gives the argument for not spending it on `_account_ok`.

---

## 4. §A — The health probe

### A.1 Eligibility

Roster-derived: `telemetry === 'anthropic'`. That is the four Anthropic accounts, and it correctly
excludes `gpt`, which is `kind: 'external'`, `homeAble: false`, points at its own
`ANTHROPIC_BASE_URL`, and has no Anthropic windows to report. **No account list appears in any
shipped source file.**

### A.2 Token source, and a seam

`shared/roster.ts` permits `secretsFile` only on `kind: 'generated'`:

```ts
| { kind: 'generated'; secretsFile?: string }
```

The mandatory `upstream` account is `kind: 'upstream'`, so **the roster structurally cannot declare
where its credential lives** — yet its wrapper sources `~/.cc-secrets/<id>-oauth.env` all the same. A
roster-driven probe would therefore cover the generated accounts and *silently skip the primary one*:
precisely the class of defect this design exists to remove.

**Resolution:** derive by convention, `.cc-secrets/<id>-oauth.env`, for every `telemetry: 'anthropic'`
account — which holds for all four files on disk (E8) — **plus a doctor check that reds when an
expected file is absent.** Absence must be loud. The probe refuses rather than skipping.

Extending the roster schema to permit `secretsFile` on `upstream` is the alternative. It is cleaner in
principle and touches `parseRoster`, its validation table, and wave-3 surfaces. Recorded, not chosen.

### A.3 The classifier — four outcomes

| Observation | Verdict | Action |
|---|---|---|
| `401 authentication_error` | dead | write the marker |
| `403 oauth_scope_insufficient` | live | clear the marker |
| `429`, other status, network error, timeout | **unmeasured** | write nothing, **clear nothing** |
| token file missing or empty | **refuse** | write nothing, report |

Unmeasured never writes the marker and — equally important — never clears one. A standing marker
survives a probe that could not measure. This is the tree's "unmeasurable is a fourth outcome,
reported and never guessed" doctrine applied at a new seam.

### A.4 Consumers — rank-last and skip, never ineligible

`_account_ok` has five call sites. The dangerous one is inside `_swap_target`'s must-leave loop:

```bash
_account_ok "$cand" || continue
```

An unconditional skip. If a health signal wrongly condemns every candidate, `best` stays empty,
`_swap_target` prints nothing, `_auto_swap_check` returns silently — **a session with a lost-auth
screen up is left wedged on the dead account, with no swap.log line and no notification.** Separately,
`cmd_ws_add` **dies with no fallback** when every home-able account fails, and its refusal message
re-derives the conjuncts by hand, so a third one yields a refusal that names nothing.

`_account_ok` is safe today because both its conjuncts are **operator intent** — a marker the operator
touched, a binary the operator installed. Neither can be wrong. **A probe is a measurement that can be
wrong.** And `server/src/limits.ts` already names this exact loop as *"the exact self-reinforcing hole
`disabled` exists to close"*, with a shipped two-part answer: carry the barred fact as a **positive
flag**, and make unknown **rank last**.

So:

- `_swap_target` ranks an auth-dead account **last**, joining the block unmeasured already uses. A
  rescue always has a destination.
- `_ws_least_loaded` **skips** it — it has a fallback, so skipping costs nothing. Same asymmetry the
  tree already justifies for unmeasured. **Note this loop is now pool-filtered** (merged wave 2a added
  `_pool_ok` / `untagged`): a health skip composes with that filter, and the `first` fallback must
  remain reachable when every pool member is condemned, or placement answers `""` and `ws-add` dies.
- `_strand_why` (new in wave 2b) gains a **fifth token** so a strand can name auth-death as its cause.
  Its four-token vocabulary is pinned by exact-string assertions; without this the strand names no
  cause.
- The server carries a positive flag beside `disabled`; the PWA **extends the existing
  `data-disabled` attribute/note pair** rather than inventing a second vocabulary.

### A.5 The marker

`$REG/<account>-authdead`, content `"<epoch> <reason>"` — the tree's one durable-fault format, copied
from `swapblocked`. Dotless per-account namespace, so `_reg_purge`'s one-dot suffix rule
(`[[ "$suffix" == *.* ]] && continue`, at **two** sites) cannot eat it with a session row; it must join
that inventory (wave 2b rewrites it). **Not `-disabled`:** that name is operator-owned with no writer
in the tree, and reusing it would collapse two conditions.

Note the namespace is shared with fleet-wide dotless switches (`coordinator-paused`, `mail-disabled`,
`autocompact-disabled`), which are indistinguishable in shape from per-account markers and are
disambiguated only by `inRoster`. `-authdead` must therefore never be a word that reads as a
fleet-wide noun.

### A.6 Clearing rule — three owners, no timer-only clear

1. **The probe itself**, on a 403. This is the natural owner and it is the whole reason the probe earns
   its place: *it is external to the account's own activity*, so it can prove recovery on an account
   that by definition has nothing running.
2. **Any successful session start** on that account, mirroring `swapblocked`'s `cmd_start` clear.
3. **Operator `rm`.**

The "a barred account has nothing running to prove its own recovery" problem dissolves because of (1).

### A.7 Cadence and placement

A `Type=oneshot` systemd `--user` timer, modelled on the pair under `deploy/systemd/`
(`ccd-graph-sweep.service` / `.timer`) — flock pass lock, pause file, env-overridable knobs,
HOME-derived roots, its own doctor check (doctor's generic `services` check asks about a hardcoded
three-name list a new timer would not be in). Shipping it is five coordinated edits — `install_atomic`
of the executable, the unit pair inside `AGENT_BUILD_CMD`, `systemctl --user enable --now` inside
`AGENT_CMD` after `daemon-reload`, `_inst_units`/`_inst_enable` in `ccd/ccrc` for the `ccrc install`
path, and `_uninst_units` for removal — and `agent/test/deploy-verify.test.ts` text-scans `deploy.sh`
and reds if any edit is missing or mis-ordered.

**Never on the supervise tick.** The tick is 5s with one supervisor process per session and ~20 live;
a probe there is ~20 same-second bursts — the herd shape `SWAP_JITTER` exists to prevent.

At 15 minutes: 4 requests/hour/account, against a measured ~28–30/hour/identity budget. Each account
is its own identity, so the margin is ~7×.

**Placement:** a sibling executable beside `ccd`, not code inside it. An HTTP client *inside* `ccd/ccd`
would be a new dependency class (E9); beside it is not — the repo already ships four curl-using
scripts, each with an argued failure contract.

**Secrets:** the `ccrc-ddns` pattern exactly — curl in `ExecStart`, credentials expanded by systemd
from the 0600 `EnvironmentFile`, so the 0644 unit never carries them. The token is never echoed, never
in argv, never in a log line. The response body is classified and discarded.

---

## 5. §B — The provenance fix

Both languages, **one commit** — `projected-home.test.ts` runs bash and TS over one seeded HOME, so a
one-sided change reds on parity alone.

- **TS.** `measured()` consults the rollover flags and returns `null` for an inferred zero. Cheapest
  correct site: the flags already exist and already ship, so the wire and both UIs are untouched.
- **bash.** `_limit_field`'s `resetAt` branch returns `""` (unknown) instead of `printf '0'`.
  `_limit_score` then returns `""` when both halves are unknown; `_ws_least_loaded` skips;
  `_swap_target` ranks last via the existing `: "${sc:=100}"`.
- **`_avail` is deliberately unchanged.** Unknown stays *available*, so a hard-blocked session always
  has a destination. A rolled-over account is available today (scores 0) and available after (unknown)
  — same answer, honest reason.
- **A third defect fixed on the way.** The age-fallback path (`server/src/limits.ts:151-152`) produces
  an inferred zero with `rolledOver` left **false**, pinned by fixture — so both UIs render it as a
  measured "0%", the exact collapse `AccountsScreen.tsx` says it never makes. The flag becomes honest.

### B.1 Mutation table (measured, E12)

Bash, `resetAt` branch:
1. `server/test/ccd-limits.test.ts` — "agrees with readLimits on every shared fixture"; four fixture
   rows move.
2. `server/test/projected-home.test.ts` — the bash half of `rolled-over-window`.

Adding the age-fallback branch reds one more row and changes no placement.

TS: `limits.test.ts` ×2, `accounts-route.test.ts` ×2, `projected-home.test.ts` ×1.

`server/test/fixtures/leastLoaded.ts`'s `rolled-over-window` is **rewritten, not deleted** (R7). It
currently asserts a rolled-over account wins placement at score 0 against accounts at 10, 20 and 40;
it becomes the assertion that it no longer does.

### B.2 The honest cost

A genuinely rested, healthy account also becomes unmeasured until something reports on it. Two accounts
share a 5h reset (E11), so at that instant both go unmeasured and `_ws_least_loaded` falls back to the
first home-able account in roster order — every `ws-add` in that window lands on one account. For
active accounts the window is seconds (measured 1–113s to first report). **For an idle account it is
indefinite.** That is the argument for §C.

---

## 6. §C — The keepalive

§B makes the system honest about not knowing. **Only a keepalive makes it know.** They are two halves
of one fix: without §C, §B degrades placement to roster order every time a window rolls over.

Measured (E6, E7): a session that makes **no** API call renders `rate_limits: null` and the statusline
writer correctly skips; a session that makes **one** call refreshes the account's telemetry with real
values and a real `resets_at`. So the coverage gap is closable **entirely on the official channel** —
no credentials, no undocumented endpoint, no scope requirement.

**Design constraints:**

- One minimal turn per eligible account per interval, on the cheapest model and an empty context. The
  measured $0.19 of the probe turn is an upper bound distorted by Opus-5-at-xhigh with full project
  context; a purpose-built keepalive is a small fraction.
- It **consumes the resource it measures.** That is inherent and must be stated in the doc, sized, and
  made env-overridable so the interval can be widened.
- It must **skip an account that already reported recently** — a keepalive is for the idle case only,
  and active accounts report within seconds. Freshness threshold reuses the existing window constants.
- It must never run against an account carrying the `-authdead` marker: spending a turn to confirm a
  known-dead credential is waste, and §A already covers liveness.
- E6 removes the hazard that worried this design: a render can never stamp *stale* percentages with a
  fresh `ts`, because a pre-call render carries `null` and is skipped.

---

## 7. §D — The pre-emptive lane

### D.1 It is not a new lane

Today's stay-shortcut is `_avail "$home"` — score `< SWAP_CEILING (98)`. The pre-emptive policy is the
**same must-leave path with an earlier trigger and three extra guards**. Framed that way it is a small
diff inside an existing branch rather than a resurrected parallel lane.

The removed logic, recovered from `0bfd0c26` (2026-07-07):

```bash
own_five=$(_limit_field "$wrapper" five "$SWAP_FRESH")        # fresh telemetry only
[[ "$own" -ge "$SWAP_THRESHOLD" ]] || return 0                # own >= 90%
[[ $((own - best_five)) -ge "$SWAP_HEADROOM" ]] || return 0   # target >= 30 points lower
[[ quiet for $SWAP_QUIET ]] || return 0                       # 600s, vs 30s at the ceiling
```

Three of four guards are the dead constants doing their jobs (E10). The quiet gate needs **no new
machinery**: `_auto_swap_check` already reads `statusUpdatedAt`, already requires `status: idle`,
already refuses mid-turn on `esc to interrupt` and off-prompt on `❯`. `SWAP_QUIET` makes `quiet_req` a
variable again.

`SWAP_FRESH` restores something notable: it would be **the only call in the tree that passes
`_limit_field`'s `maxage` parameter** as anything but `0`. That parameter exists today with no user.

### D.2 What killed it, and why `SWAP_JITTER` does not cover it

The removal commit is explicit: the old policy *"herded all sessions onto one account, blew its 5h,
and jumped en masse."* No incident document records it — but **the mechanism is visible in the code.**
`cmd_supervise` is one process per session (~20 live, 17 measured starting in the same second). Each
ticks independently, each reads the same `~/.cc-limits`, each takes the argmin. Twenty processes, one
dataset, one answer. They converge because they agree, not because of a loop.

**`SWAP_JITTER` does not fix this.** Jitter staggers *when* a dispatched swap runs; every session still
computes the *same destination*. Jitter fixed the **resource** herd of 2026-08-13 (simultaneous
restarts → 19 concurrent scans → 9.7h stall). The 2026-07-07 failure was a **placement** herd. Two
different herds; only one was fixed. Reviving the lane without a convergence guard reintroduces the
original defect.

### D.3 The convergence guard

**A fleet-wide pre-empt budget:** at most one pre-emptive swap per interval across the fleet, as a
registry marker with a read-side cooldown — the `swapblocked` shape (`"<epoch> <reason>"`, digits
validated before arithmetic, compared at the reader, nothing collects it). A pre-emptive swap is an
optimization, not a rescue, so rate-limiting it costs only time. With four accounts and a 30-point
headroom requirement, one-at-a-time provably cannot herd: after the first mover lands, the next session
re-reads telemetry that now includes it.

**The rescue lane is exempt from every new guard** — hard-blocked stays immediate, unbounded, no quiet
wait, no headroom test, no budget. This exemption is the thing to pin hardest.

**Considered and not chosen:** per-target inbound claims that debit an account another session is
already moving toward. More complete, unnecessary at this fleet size, and it would add a marker family
with its own staleness question. Recorded as the escalation if the budget proves too coarse.

### D.4 §B is a prerequisite

- **Source side.** The hazard is not a stale *low* reading (it fails `own >= 90` and declines to
  pre-empt) but a stale *high* one — 95% measured days ago, triggering a move no longer justified.
  `SWAP_FRESH` closes it.
- **Target side.** A rolled-over target reads a confident `0` today and wins `best_five` outright — the
  magnet, now aiming a *voluntary* swap at a dead account. Under §B it returns unknown, ranks last, and
  is never chosen.

**W6 must not ship before §B.**

### D.5 Free consequence

Wiring the constants makes their comments true again, retiring wave 5's prose item. The alternative was
deleting them plus a two-sided pin so the names could not return carrying dead meaning.

---

## 8. §E — The swap verb timeout

One row in `CCD_VERB_TIMEOUT_MS` (`server/src/remote/runner.ts`): `swap: 300_000`, the same argument the
existing 300s rows carry. The agent SIGTERMs at 90s while `cmd_swap` has already stopped the unit and
killed the tmux session and has **not yet flipped `wrapper`** — a dead session on the old account, no
`swapblocked`, no `lastswap`. Server-only, no ccd diff, no agent deploy, collides with nothing.

**Ships first, as its own PR** (R8). The retry-loop rationale once attached to this item is refuted:
nothing in the PWA, server or agent client retries.

---

## 9. Refused, with reasons

| Refused | Because |
|---|---|
| **Per-model (Fable) limits** | Closed on both reachable routes: absent from the statusline payload (E5) and behind `user:profile` on the usage endpoint (E1). The data exists — `limits[].weekly_scoped`, `scope.model.display_name` — so this is *blocked by our auth model*, not impossible. Reopening means converting the fleet from setup tokens to interactive OAuth with refresh rotation for five accounts. Out of scope; recorded so the reason survives. |
| **A claude-swap-style usage poller** | Same scope wall. Agent-side is additionally impossible (`curl`/`wget`/`node` are in `FORBIDDEN_COMMANDS`, enforced by a type-level disjointness proof and a boot refusal), and a server-side poller cannot write `~/.cc-limits`. Only a fleet-box job could influence placement, and it would still 403. |
| **Health in `_account_ok`** | §A.4. Would strand a lost-auth session with no destination and no notification. |
| **Spend axis** | `spend_limit` is emitted only under gateway provider mode, which no lane of this fleet runs. |
| **Per-target inbound claims** | §D.3 — unnecessary at this fleet size; recorded as the escalation. |
| **A timer-only clear for `-authdead`** | A fault that clears itself on a clock, with no re-measurement, is a guess. §A.6 gives three owners, each of which is evidence. |

---

## 10. Sequencing and collisions

1. **§E** — own PR, server-only, first. Uncoupled from everything.
2. **§B** — the provenance fix. Both languages in one commit. `_limit_field`/`_limit_score` have **zero
   mentions in all four unopened pools plans**: a clean lane.
3. **§A** — the probe. New sibling executable + timer + doctor check. `_account_ok` and `_lane_enabled`
   are consumed-only and modified by nothing; the doctor check table is a free lane. AGENT-FIRST.
   Its `_strand_why` fifth token lands **inside wave 2b**.
4. **§C** — the keepalive. Depends on §B for its justification, not its mechanism; can follow.
5. **§D** — folds into **wave 2b** as extra tasks, sequenced *within* the wave, never as a parallel PR:
   2b Task 2 replaces `_swap_target`'s candidate loop wholesale and Task 3 inserts into
   `_auto_swap_check` at three points. Both edits land in the same bytes.

**Deploy window.** Every ccd change ships a fresh executable to a host whose ~20 supervisors keep
executing the pre-deploy inode until the `KillMode=process`-gated sweep restarts them (the pools spec
measured 15 of 18 on a days-old inode). §A, §B's bash half and §D are all no-ops on live sessions until
the sweep runs. Do not hand-`install_atomic` any of them without it.

**Adjacent line, noted:** wave 5 Task 6 plants a test forbidding the placement loop from reading
`CCRC_MEASURED` — a deliberate, bidirectional block on making placement telemetry-aware. Nothing here
crosses it, but it was drawn on purpose.

---

## 11. Risks

- **A false "dead" verdict.** Bounded by R6: rank-last and skip, never ineligible. Worst case is
  reduced preference for a healthy account, self-correcting on the next 403.
- **A false "live" verdict.** The probe cannot distinguish a credential that authenticates but cannot
  infer. Out of scope by construction — §A measures *authentication*, not capability.
- **§B degrading placement to roster order** at a shared reset boundary (E11, §B.2). §C is the mitigation.
- **§D reintroducing the 2026-07-07 herd** if the convergence guard is wrong. Every guard ships with a
  test that reds when the guard is deleted, including the rescue-still-immediate case.
- **New network dependency class** on the fleet box. Contained to a sibling executable with an argued
  failure contract; `ccd/ccd` itself stays network-free.
- **Known load flakes** to re-run in isolation on any of this: `ccd-session-state` (its flaky window is
  the mid-carry path), `pr-sweep`, `session-hook`, `ccd-ws-gc`, `typecheck-tests`. CI on the quiet box
  is the arbiter.

---

## 12. Unmeasured

Stated as unknown, not quietly dropped.

- Whether a purpose-built keepalive turn (cheapest model, empty context) actually costs a small
  fraction of the measured $0.19. Sized at plan time.
- Whether the 401/403 split holds for a credential that is *revoked* rather than *invalid*. E2/E3 used
  synthetic tokens; no revoked real token was available to test.
- Whether the usage endpoint's status-code semantics are stable. They are undocumented.
- Whether any live roster aliases two config dirs — measured **no** on this box, so the collision risk
  behind A.2's convention is latent, not live.
- The interaction between `-authdead` and a programme mid-wave: whether a dispatch refuses when its
  target lane is condemned was reasoned, not observed.

---

## 13. Deviation numbers

None minted. This is a design document; the implementation plans mint their own block via
`POST /api/ledger/deviations` and define every number in the same act. Several genuine defects were
found while writing this and are recorded above without numbers — the roster's inability to declare an
upstream `secretsFile` (§A.2), the age-fallback path's dishonest `rolledOver` flag (§B), and
`cmd_ws_add`'s hand-rederived refusal reason (§A.4) — so the plan that fixes each can mint and define
in one act.
