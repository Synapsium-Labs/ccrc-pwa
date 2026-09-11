# A session parked by a usage limit says so, and is released when the window turns — design

> **Provenance.** Written 2026-08-28 against `05be5a6`. The measurements in §1
> were taken on a live box while the session writing this document was itself
> parked by the weekly limit it describes: fourteen subagents died mid-flight at
> 16:31, and the work resumed at 18:50. Every number below is measured unless it
> is labelled a hypothesis.
>
> The shape was chosen against four independent alternatives and then attacked:
> twenty-nine concrete failure sequences were written against the field, and the
> ones that survived scrutiny are why §4 releases by claiming a slot rather than
> by letting a gate lapse, why a park never clears on the absence of a banner,
> why the release instant is the account's rather than the banner's, why
> admission defers instead of refusing, and why §5's bounds read a durable stamp
> and a monotonic clock. Each of those corrected an earlier draft of this
> document that was wrong.

**Goal:** the fleet stops losing work to a limit it can see coming back. A
session whose turn was refused for a usage limit is *nameable* as such, work
owed to it is *withheld rather than consumed*, and it is *released* when its
account's window turns — across every account and both windows.

**Non-goal:** reviving anything. Nothing here starts, restarts, swaps or
resupervises a session. §7 states the line and defends it against the standing
ruling that forbids unattended repair.

---

## 1. What is actually wrong

### 1.1 The fleet has no word for "parked on a limit"

`sessionBucket` (`shared/api.ts:986`) is the single authority for what a session
is doing, and its `BucketInput` is
`Pick<FleetSession,'status'|'statusUpdatedAt'|'dialogPending'|'hookState'|'archivedAt'|'pr'>`
— `limits` is not among its inputs and the ladder's fallthrough is
`{ bucket: 'idle' }`. A repo-wide grep for `limit reached|Too Many Requests|out
of (usage|credits)|API Error: 429|spend limit` across `server/src`, `pwa/src`,
`shared` and `agent/src` returns exactly one hit, and it is a doc comment.

So a session refused for a usage limit is, on every surface, byte-identical to a
session that finished its work cleanly. The console goes further than silence: it
fires a **"✓ Finished — back to idle"** push (`watch.ts:787`) at a session whose turn was killed
by a limit. It does not merely fail to report the fault; it reports success.

That is the overloaded seam this repo's own architecture doc forbids — two
conditions a caller handles differently collapsed to one value. Everything below
follows from it.

### 1.2 Detection is broken, and the suite is green — as this repo predicted

`_pane_hard_blocked` (`ccd/ccd:11194-11201`) is the fleet's only limit detector.
Measured against real banner text:

| banner | matches? |
|---|---|
| `You've hit your weekly limit · resets Sep 1 at 2pm (Europe/Warsaw)` | **no** |
| `You've hit your 5-hour limit · resets 3pm` | **no** |
| `Claude usage limit reached. Your limit will reset at 3pm` | yes |
| `API Error: 429 Too Many Requests` | yes |

The first line is verbatim from this repo's own tooling session on 2026-08-28.
The alternation offers `limit reached`, `reached your .*limit` and
`hit your .*spend`; the current wording is `hit your <window> limit`, which no
alternative covers. `server/test/ccd-login-screen.test.ts:74-79` is green because
it fixtures the *old* wording.

**This was predicted, in writing, seven days earlier.**
`2026-08-21-account-provisioning-design.md:120-122`, item 20:

> Detection is tmux pane-text scraping for literal vendor banners, pinned in
> tests against *fixture* strings rather than the real binary's output. A Claude
> Code release that rewords its auth banner silently deletes the entire
> detection lane and **no test goes red**.

It was written about the auth banner. It came true for the limit banner. Any fix
that ships another fixture table and stops there has repaired the instance and
left the mechanism — §3.1 is about the mechanism.

### 1.3 The rescue is silent exactly where it fails

`_auto_swap_check` → `_swap_target` (`ccd:11136`) returns a destination or
returns nothing. When it returns nothing, `_auto_swap_check` returns having
written **nothing at all**: no `lastswap`, no `swapblocked`, no `$REG/swap.log`
line, no notify. Both exits are a bare `return 0` and both sit above every writer
in the function. The tick then repeats every five seconds, forever. The only
trace anywhere is the banner in the session's own pane — read through
`tail -8`, which §1.2 has just shown may not match it.

### 1.4 Mail is consumed rather than deferred, and the sender is never told

A limit-parked pane is `idle` and quiet, so every conjunct of `sweepMail`'s idle
gate passes. The nudge is typed, Claude refuses, the row is marked `delivered`.
Then it replays: `MAIL_REPLAY_MS` (600 s) × `MAIL_REPLAY_MAX_ATTEMPTS` (20) =
**3 h 20 m**, after which the delivery parks `rejected('undeliverable')` — and
that park is **silent to the sender** (`tellSender` is called on send-failure
paths only, not on the replay-ceiling park).

A 5-hour window outlives that budget. A 7-day window outlives it by days. So a
worker parked by the very limit this design is about loses its brief while
parked, the coordinator is never told, and nothing re-delivers when the window
reopens. `2026-08-21-account-provisioning-design.md:133-137` already recorded
this mechanism for the auth case: "a wave brief delivered to a dead-token worker
is consumed by the durable store, acked by nobody, and the coordinator
re-measures `stale-tip` forever."

It has already cost a live session. **F8, 2026-08-12:** a dispatch spawned a
fresh worker onto a rate-limited account; the unrecognised limit screen made the
spawn poll past the agent's 90 s budget, and the kill orphaned a fully-registered
session.

### 1.5 Measured on a live box, 2026-08-28 18:55 CEST

Four accounts (one upstream, `homeAble:false`; three generated), all declared
`telemetry:'anthropic'`. Eleven sessions.

| account | 5 h | 7 d | 5 h resets | 7 d resets | `_avail`? |
|---|---|---|---|---|---|
| A | 0 (rolled) | **100** | past | +17 h | **no** |
| B | 86 | **101** | +1 h 34 m | **+91 h** | **no** |
| C | 26 | 24 | +4 h 54 m | +128 h | yes |
| D (upstream) | *no telemetry file at all* | | | | yes — unknown is available |

Six facts this settles:

1. **`sevenResetAt` is the authority, and it is populated at exhaustion.** Both
   over-limit accounts carry a reset epoch. B's decodes to `2026-09-01 14:00`;
   the banner said "resets Sep 1 at 2pm (Europe/Warsaw)". Telemetry and banner
   are the same fact. The one input a reset-scheduled release needs is present
   exactly when it is needed — this was the top open question in the survey, and
   the age-inference fallback is a genuine fallback rather than the normal path.
2. **A percentage may exceed 100** (B's 7 d is 101). Any `<= 100` assumption is
   already wrong on this box.
3. **Capacity returns in steps** — three different instants, per account, per
   window. "Manage all limits" is a *calendar*, not a deadline.
4. **The pool is three accounts and two are pinned.** `_default_pool` is the
   home-able set plus a session's own non-home-able home; nine of eleven sessions
   draw from exactly {A, B, C}. **This box is one account away from the silent
   state of §1.3** — if C pins, `_swap_target` returns empty for nine sessions
   and nothing is written, ever.
5. **The herd is nine.** When A's 7-day window turns, all nine become eligible in
   the same second. The 2026-08-13 incident was six.
6. **An account that is supposed to report may report nothing.** D carries two
   live sessions and has no `~/.cc-limits` row at all, while `_avail` reads its
   silence as free. The telemetry write depends on a `statusLine` key the
   installer seeds set-if-absent only.

**Three sessions were stranded on an exhausted account for 2 h 20 m.** For each:
`status: idle`, `statusUpdatedAt` hours old, no `.hold`, no `.swapblocked`,
cooldowns long expired, supervisor alive in `ps`, no `.substrate` marker, and a
valid destination available. One had `home = C` (at 26 %) and `wrapper = B` —
`_swap_target`'s "home recovered: go back" branch — and had not gone back. Every
gate on that path is satisfied except the two pane greps.

**Two of eleven live sessions have no supervisor at all** and therefore no
auto-swap (`ccd:1544`). A ccd-side detector structurally cannot see them.

### 1.6 Idle sessions accumulate on dead accounts

Affinity relocation is gated on a clean turn boundary, an affirmative `idle`, and
30 s of quiet. A session with no work in flight never presents an interesting
boundary and never moves, so exhausted accounts silently accumulate idle
sessions and the failure surfaces at the worst moment: the *first turn that
arrives* is the one that dies. That is F8's shape exactly.

---

## 2. What the tree already decided, and why none of it is re-argued here

| # | Ruling | Where | Consequence for this design |
|---|---|---|---|
| R1 | No reconciler daemon, no timer unit, no scheduled repair of fleet rows; reviving a row is a human act | `2026-08-12-swap-transcript…:892-900`, `README:1729-1734` | §7 |
| R2 | Ship the measurement, let it be trusted, automate later | `2026-07-28-workspace-lifecycle:251-253`, `2026-07-29-pr-lifecycle:523` | the wave order in §8 |
| R3 | One server timer; new periodic work rides `FleetWatcher`'s 2 s tick | claim lease precedent | §3.4 |
| R4 | A fleet-wide rollover dispatches every affected action in the same second — 6 restarts once cost 9.7 h | `ccd:812-822` | §5 |
| R5 | `_pane_hard_blocked` must return **which** class it matched | `2026-08-21-account-provisioning…§7.3` | §3.2 |
| R6 | Reset countdowns are coarse human figures, not scheduling input | `_fmt_eta`, `ccd:11019` | schedule off raw epochs |
| R7 | A swap costs the pane, a transcript carry and a summary compaction — and never re-sends the interrupted turn | `ccd`, measured | §4 |
| R8 | Stop depending on the TUI's copy where a machine-readable signal exists | `…§7.4` | §3.1 |
| R9 | `tail -8` vs whole-pane is a **deliberate trade** — widening re-opens a restored-scrollback false positive | `…:127`, item 21 | §3.2 |

R9 deserves emphasis because it inverts the obvious fix: ccd's narrow window is
not an oversight to be widened. The server's window is already whole-pane, so it
inherits the false-positive risk R9 names, and §3.2 pays for it with
corroboration rather than with a wider grep.

---

## 3. The fix

### 3.1 Telemetry is primary; the banner is corroboration

R8 is the load-bearing rule and §1.2 is its proof. A design whose detection rests
on vendor copy will break again the next time the copy changes, and its tests
will stay green while it does.

For usage limits — unlike auth — a machine-readable signal already exists and is
better than any probe: `~/.cc-limits/<account>.json` carries the API's own
`used_percentage` and `resets_at`, `readLimits` already re-derives rollover from
it on every 2 s tick, and §1.5 fact 1 proves the reset epoch is present at
exhaustion. So:

- **Telemetry decides *whether* an account can take a turn and *when* it can
  again.** This is arithmetic over numbers the API wrote, not text.
- **The banner decides only what telemetry cannot see**: an account with no
  telemetry row at all (D, above — two live sessions), an external backend's
  429, a monthly spend cap, and auth loss. It never overrides telemetry about a
  window.
- **The two lanes are kept honest by a divergence alarm, not by a fixture.** A
  fixture cannot contain a string nobody has written yet. What *can* be
  mechanised is the disagreement: if telemetry says accounts are pinned and
  sessions are sitting idle on them while the banner lane has matched nothing
  for longer than a threshold, the console says so. That is a detector for the
  detector, and it is the only construct here that would have caught §1.2
  without a human noticing.
- **And an unrecognised block has somewhere to land.** `unknown-block` (§3.2)
  catches a pane that is clearly refusing without matching any known class, so
  the next rewording degrades to a visible, non-schedulable park rather than to
  silence. Fixture, alarm and landing zone are three different mechanisms for
  the same hazard, and only the fixture is the one that already failed.

**Ready-marker precedence is not optional here.** ccd's rescue matcher has none —
a session merely *displaying* limit text matches it — and the population most
likely to display limit text is the one working on this feature: a worker that
runs `grep 'Invalid API key' ccd/ccd`, or opens the banner fixture corpus, puts
the whole vocabulary in its own pane. The spawn-time detector already orders its
checks so a healthy pane wins (`ccd:11481`); the park classifier must do the same.
A pane showing a live prompt or the shortcuts footer is **at a prompt**, and a
pane at a prompt is not blocked, whatever text is scrolled above it.

Two-source corroboration carries the rest of the weight: a `limit-5h`/`limit-7d`
park additionally requires telemetry to agree that the account is at the ceiling,
which no amount of text on screen can fake.

### 3.2 The vocabulary of a park

R5 requires the classifier to say *which*. A park reason is a union in `shared/`
with a total `Record` map and a derived runtime list (the house rule for a new
vocabulary), and each member carries its own resume semantics:

| reason | releasable? | resume instant | operator's next action |
|---|---|---|---|
| `limit-5h` | yes | `fiveResetAt`, measured | wait out the window |
| `limit-7d` | yes | `sevenResetAt`, measured | wait out the window |
| `backend-429` | yes | `ts + 18000`, **inferred** — ccd's exclusion carries no reset | wait, or move the lane |
| `spend-cap` | no | unknown — nothing in the tree knows a billing boundary | raise the cap |
| `auth-lost` | **never** | — | re-authenticate |
| `lane-disabled` | **never, by construction** | — | remove `$REG/<w>-disabled` |
| `pane-absent` | **never, by construction** | — | the session is not running |
| `self-waiting` | **no — do nothing** | the CLI owns its own timer | nothing |
| `unknown-block` | no | — | look at the pane |

Auth loss and a seven-day limit must not share a value: waiting fixes one and
never fixes the other. That single sentence is the whole reason the union exists,
and it is R5's own justification. Four members earn their place for reasons worth
stating:

- **`lane-disabled`** is the operator's own kill-switch (`$REG/<wrapper>-disabled`,
  no writer in the tree, touch/rm by hand). Naming it as a reason the automation
  *can never release* is how the design recognises a deliberate human act instead
  of fighting it — the cleanest concession available to R1.
- **`pane-absent`** is the same idea for a stopped session: no pane, no release,
  by construction rather than by a guard. Together these two are §7's structural
  half.
- **`self-waiting`** is Claude Code's own scheduled resume (§4). It is measured
  to work, and the design's only correct response is to leave it alone. The
  failure is asymmetric in the dangerous direction — mis-reading a real park as
  self-resuming lets a session sleep forever — so this class requires positive
  evidence, never an absence.
- **`unknown-block`** is the landing zone for the *next* rewording. A hard block
  the classifier cannot attribute gets its own non-schedulable value rather than
  collapsing into `limit-5h`. §1.2 proves the classifier will one day fail to
  recognise something; this is where that failure lands loudly instead of
  quietly, and it is the member that makes the divergence alarm (§3.1) actionable.

**The resume instant is itself a union, not a nullable number.** `resumeAt:
number | null` would launder three different facts into one absence, which is the
defect this design exists to remove. So:

```
Resume =
  | { kind: 'at';      atMs: number; confidence: 'measured' | 'inferred' }
  | { kind: 'never' }
  | { kind: 'unknown'; because: 'no-telemetry' | 'no-reset-field' | 'unreadable' }
```

`confidence` keeps a real `resetAt` apart from a `ts + window` inference;
`because` keeps an account that will never report apart from one that has not yet
and from one the link could not read.

Three data hazards the union must not launder, all measured:

- `five === 0 && fiveRolledOver === false` is ambiguous across **three** cases —
  a measured zero, an aged-out zero, and an invented zero (the statusline writes
  `"${seven_int:-0}"`, so it can never emit `null`). Only `fiveRolledOver ===
  true` carries a real reset instant, and it can never fire for a file with no
  `resetAt`. A release must key on the flag, never on the zero.
- `readLimits` fails **open**: an unlistable `~/.cc-limits` is byte-identical to
  a fresh box, and it inherits `FleetIO.readFile`'s known collapse (D-114). "The
  account has headroom" must therefore be a positive reading, never an absence —
  so the park lane consumes limits through an L2 port declared by *this*
  consumer, returning `MeasuredRead`, and a link outage lands in
  `Resume.because: 'unreadable'` instead of masquerading as "never measured".
- **`GET /api/accounts` has no row for an account that has never reported**, and
  that is exactly the account the design most needs to name: on this box, D
  carries two live sessions and no telemetry file. The response already ships
  `roster` separately for precisely this reason (`server.ts:1175-1179`), so the
  calendar **unions roster with accounts** and a never-reporting account appears
  as a row that says so. `RosterWire` deliberately withholds `telemetry`
  ("stays server-side"); the distinction the client needs is a *derived* fact,
  so it ships as `Resume.because: 'no-telemetry'` on the row rather than by
  widening what the roster publishes.
- The join is on `$REG/<id>.wrapper` — the account the session is *running* on —
  never on `home` and never on the id prefix. `_home_for` falls back to the id
  prefix and then to `CCRC_UPSTREAM`, so `home` can name an account the session
  is not on, and a swap changes `wrapper` underneath any cached decision.

**Epoch discipline.** Everything in `~/.cc-limits` and the registry is epoch
**seconds**; every coord column and watcher clock is **milliseconds**. This is a
1000× defect that every existing test would stay green through, so the conversion
happens at exactly one seam and a test names it.

### 3.3 A park is an axis, not a state

`FleetSession` gains one nullable field, riding beside `lifecycle`,
`swapBlocked`, `substrate`, `held` and `spawnState` — never a new member of
`SessionStatus` or `SessionBucket`. `swapBlocked` is the shipped template for a
durable, PWA-rendered, mid-run fault marker, and `…§7.3` already specified this
exact shape for the auth half.

Additive, absence-permits, no `FLEET_PROTO` bump, one reader, and added to
`reviveFleetSession`'s returned literal so that forgetting a path is a compile
error rather than a silent `null`.

The park is **re-measured, never stored as truth**. It is recomputed from
(telemetry, pane, wrapper) on the tick that reads all three anyway; `coord.db`
holds only the release bookkeeping and the audit trail, which is what "coord.db
is a server-side re-measurement" already means. A lost `coord.db` costs the
spacing state, not the parks.

### 3.4 Where each responsibility lives, and what was rejected

**DETECT — the server, riding the capture it already takes.** `detectDialogs`
(`watch.ts:2860`) calls `Tmux.capture(id)` for every registered session every
2 s, and `Tmux.capture` is `capture-pane -t <t> -p` (`exec.ts:130`) — the *whole*
pane, no `tail`. It already parses a statusline off the same bytes; its own
comment is "no extra tmux call." A classifier rides it for zero additional tmux
calls, sees a window ccd cannot, and covers the two unsupervised sessions ccd
structurally cannot reach (§1.5).

*Rejected:* ccd's `_pane_hard_blocked` as the source of truth — `tail -8`
(R9 forbids simply widening it), one boolean for two conditions, measured not to
match today's wording, and blind to unsupervised panes. It **stays and is fixed
anyway** (§8, wave 1, AGENT-FIRST) because it drives the swap rescue, which this
design does not take over.
*Rejected:* a new watcher lane that captures panes itself — a second capture of
every pane, against R3.
*Rejected:* an agent-side detector — the agent has no timer at all.

**RECORD — the server, in `coord.db`.** The agent's path whitelist permits writes
under `.cc-clips/` only, so the server cannot write a registry marker directly.
It *could* reach one through `ccd ws-hold --session <id> --reason <text>`, which
is whitelisted and writes arbitrary declared text — and it must not: there is
exactly one `.hold` slot and the program claim owns it, and `_auto_swap_check`'s
affinity arm *defers on a hold*, so recording a park as a hold would suppress the
very rescue that might clear it.

**DECIDE — L1, pure.** `selectReleases(parks, limits, roster, inflight, now)` →
an ordered release plan, with an injected clock. Most watcher lanes read
`Date.now()` directly and are tested with a faked global; this one takes the
clock as a parameter, which is the `verifyDone` shape the architecture doc names
as its model.

**ACT — the existing mail lane.** §4.

**SURFACE — the accounts screen and the session row.** The reset epochs and
rollover flags exist today only on `GET /api/accounts` and are rendered by a
deliberately coarse formatter (R6). The calendar — "N of M accounts; next
capacity at T" — is derived from data already on the wire.

---

## 4. What "wake" is

**Wake is not a new act. It is a gate that stops holding.**

The measurement that settles this (§1, provenance): unattended, a limit-refused
session does **not** self-heal — it returns to its prompt and sits. Engaged
through `/rate-limit-options`, Claude Code schedules its own resume and continues
the interrupted turn. Nobody types that into twenty unattended panes, so a
keystroke is mandatory somewhere. `ccd ensure` cannot supply it: it short-circuits
on a live pane, so it is a no-op on exactly this population.

So the release rides the one lane that already types into idle sessions on a
schedule, with proofs:

1. **During a park, `sweepMail` defers instead of consuming.** One conjunct is
   added to the existing gate stack: if the recipient is parked in a class that
   cannot take a turn, `store.backOff(id, 'recipient parked: <class> until <t>',
   releaseAt, /* countsAsAttempt */ false)`. That is the shipped `unmeasurable`
   precedent — the one gate that already refuses without accruing toward a park.
   `dueDeliveries` gates both arms on `nextAttemptAt <= now`, so one conjunct
   defers a never-delivered brief *and* suspends the replay clock of a delivered
   one. §1.4's 3 h 20 m burn stops being possible.
2. **The release is an ACT, and it claims a slot.** The obvious design — let
   `nextAttemptAt` pass and let the row become due — is wrong, and it is wrong in
   the way that matters most: a park that is merely *derived* has nowhere to hang
   a valve. When the window turns, the join simply stops yielding a park for
   every session on that account **in the same evaluation**, and there is no
   moment at which anything can be throttled. Nine sessions become due together
   and the only thing between them and the box is the mail lane's own politeness.

   So releasing is a positive step with its own gate: a candidate whose park has
   cleared must **claim a release slot** (§5) before its row is made due. Deriving
   the *park* is right; deriving the *release* is not.

   Once the slot is granted, nothing new happens: the sweep re-selects, the six
   existing gates run, and the same ~40-byte reference nudge is typed through the
   same `sendPrompt`. Nothing is re-composed; no new prompt text is invented; the
   envelope was stored at queue time precisely so a replay is verbatim.

3. **A park is never cleared by the absence of a banner.** Over a 91-hour park
   the pane will redraw, the banner will scroll away, and `Tmux.capture` will
   return `null` for a lost round trip or a torn-down pane — and it collapses
   every failure to that one `null`. Reading "no banner" as "released" turns
   every one of those into a spurious release. A park clears on **positive
   evidence only**: the account's own reset instant has passed, or the session
   has demonstrably taken a turn. This is the same absent-vs-unreadable rule the
   tree already applies to reads, applied to an observation.

4. **The release instant belongs to the ACCOUNT, not to the banner.** A session
   that hits the 5-hour wall first shows "5-hour limit · resets 3pm" while its
   7-day window is also over the ceiling; releasing at 3pm releases into a still
   blocked account. Pressure is `max(five, seven)` everywhere else in the tree
   and it is `max(five, seven)` here: the resume instant is the later of the
   blocking windows' resets, computed from telemetry. The banner's own wall-clock
   text is never parsed as an instant at all — "resets 3pm" resolved against
   today can land 65 minutes in the past — which is R6 restated as a hard rule.

**"Do not wake work that is already finished" is *mostly* answered by
construction — and the remainder needs a guard.** If nothing is owed, there is no
row and nothing is typed. But an obligation can outlive the work: a worker that
fetched its brief, did the whole wave and committed on its workspace branch, and
was then killed by the limit *before* it could ack, leaves a `delivered`,
un-acked row over work that is finished. Re-offering it re-briefs a committed
wave.

So before re-offering a delivery older than a threshold, the lane re-measures the
**done-fingerprint** the coordinator already uses — `handoffCommit === branchTip`,
read fresh from git ref files plus `.prhistory`, never from a claim body — and
closes the obligation as work-finished instead of replaying it. The machinery
exists; this is a second caller for it.

**Honest scope cut.** A session killed mid-turn on an *operator's own* prompt has
no durable obligation, so it gets a visible park, a countdown and a one-tap
resend — not an automatic one. That is the ruling's own fallback (§7) and it
covers exactly the three sessions measured stranded in §1.5, none of which had
anything owed.

**What the wake must not promise.** Even Claude Code's own resume does not
restore work in flight: this session's fourteen subagents were gone, and the
workflow had to be re-run by hand. "Released" means the session can act again, not
that its work continued.

**The refusal vocabulary must be handled in full.** `SendResult`'s failure arm
has six members, and the two most likely against a redrawing banner pane —
`verify-failed` and `draft-clear-failed` — are the two the existing callers name
least. `enter-ignored` returns `submittable: true`, a distinct "typed but not
submitted" state. A release that hits any of them backs off; it never retries
blind.

**Releasing asserts one thing only: the window we were waiting for has ended.**
It never asserts that the account has room. That framing is what keeps the cost
of being wrong bounded and knowable — a mistaken release costs exactly one
refused turn, and it re-parks immediately with fresh evidence and a fresh reset
instant. The design does not need to be right about capacity; it needs to be
right about *time*, which §1.5 fact 1 shows it can be.

**No deferral stands longer than `PARK_DEFER_MAX_MS` (1 h) without
re-confirmation.** A seven-day park is therefore 168 re-measurements, each one a
pane capture the watcher takes anyway, rather than a single week-long promise
made on evidence that has since gone stale. This is the property that bounds
what a wrong classification can cost while nobody is looking, and it is cheap
because the evidence is already being collected.

**The sender is told, once, at the deferral edge.** §1.4's silence is the defect;
a per-sweep report would be its own flood. So `tellSender` fires on the
*transition* into deferral, carrying the class and the release instant in the
reason's own words, and again if the class changes.

**A `never`-releasable park does not defer forever.** After
`PARK_ESCALATE_MS` an obligation held by `auth-lost`, `spend-cap`,
`lane-disabled` or `unknown-block` is parked as
`rejected('parked:<reason>')` with `tellSender` firing — deliberately a distinct
terminal code, never folded into `undeliverable`, because "nobody could take
this" and "this recipient does not exist" are different facts and §1.4 is what
happens when they are not.

**And a deferred brief must not hold a wave's concurrency slot.** Dispatch caps
are concurrency-based and a run's slot is held from `markDispatched`; a brief
deferred for four days holds that slot for four days, so a programme with three
workers on an exhausted account cannot dispatch anything at all until a human
intervenes. A deferral must either release the slot or be visible as the reason
the cap is full — silently consuming it is how a limit on one account becomes a
stalled programme on every account.

**The sender is told once per *park*, not once per re-confirmation.** The
suppression key is the park identity — session, class, and the window it names —
held in a column of its own. It must not be the rendered `lastError` string:
`PARK_DEFER_MAX_MS` re-confirmation rewrites that string with a recomputed
instant every hour, so a key that reads it fires 168 notices over a seven-day
park instead of one. Deferral is also evaluated before the sweep's
one-per-session guard, so four workers with six rows between them would otherwise
raise six notices in a single sweep.

---

## 5. The release policy is the whole risk

R4 is binding. On 2026-08-13 a fleet-wide rollover dispatched every affected swap
in the same second; six restarts at 21:00:0x each triggered a ~2 GB scan, 19
concurrent reached 17.4 GB, and the box stalled for 9.7 hours at load 179.
`SWAP_JITTER=120` exists solely to spread that.

Two arguments are in tension and both are right:

- A release here is a **keystroke into a live pane** — no unit restart, no pane
  teardown, no transcript carry, no `SessionEnd`/`SessionStart` pair, no scan.
  The specific mechanism that produced the incident is absent, not mitigated.
- But what the keystroke *starts* is a real turn, and nine sessions resuming real
  turns at once is precisely what re-exhausts the account and loads the box.

So the bound is on **resumed work**, not on keystrokes, and it comes in three
layers, ordered by how much each actually buys:

1. **Probe-first, and it is the primary spreader.** At a reset boundary the new
   window is *unmeasured* — telemetry only exists once a session renders a
   statusline. So the honest answer for every session on that account is
   `unknown`, and `unknown` admits exactly **one**: a probe, chosen
   deterministically (lowest session id, so a restart picks the same one and two
   ticks cannot disagree). The rest stay parked until the probe's own statusline
   re-measures the account. This is not a tuning constant — it falls out of the
   epistemics, and it self-tunes: if the probe finds the account still pinned,
   nobody else is released.
2. **A global in-flight bound.** `KeyedQueue` serialises per *session*; there is
   no fleet-wide injection throttle, and `sweepMail` stamps `lastMailSweep`
   *before* its awaits, so slow sweeps overlap. One release in flight box-wide,
   spaced, evaluated in L1.
3. **The existing lane's own throughput gates**, inherited free: one message per
   session per sweep, a 10 s cadence, a 120 s per-session cooldown, 60 s of
   measured quiet.

**The herd is not only ours.** At the same reset instant, ccd fires its own
swaps — sessions evacuated off the recovering account all want to come home, and
*those are restarts*, the exact 2026-08-13 shape. A bound that covers only our
releases leaves the heavier half unbounded. So the chokepoint is shared: one
non-blocking `flock -n` slot on a single `$REG/.release.lock`, held by the
release path and — in a later wave — by `_dispatch_swap`, which is already the
one place every swap passes through. Non-blocking is mandatory: a supervisor must
skip its tick rather than queue behind the lock. This replaces
`SWAP_JITTER`'s random draw, which can and does collide, with a bound the kernel
resolves.

**The feedback observable is the wait, and it is written down.** `release.log`
records every grant with the time it *waited* for the slot. If the median wait
approaches the window length, the spacing is too slow and the log says so before
an operator has to infer it — the answer to the cautionary tale of a gate that
ran green while enforcing nothing.

**Polarity is fail-off.** An unlistable registry, an unreadable park store or a
missing switch file reads as *feature disabled*, and the fleet behaves exactly as
it does today. The asymmetry is specific rather than a reflex: a spurious park
withholds real work, and withholding is the harmful direction here, while a
missed park costs only what already happens now.

**A safety bound may not live in process memory.** The mail lane's own
cooldowns are in-memory by design, and that is correct for *politeness* — a
restart forgets an in-flight send along with the process making it. A bound whose
job is to prevent a 9.7-hour box stall is a different kind of thing: a server
that boots, serves 20 s and dies (`Restart=always`, an ordinary bad-deploy
morning) would release one session per boot with no memory of the last, which is
no bound at all. So every release evaluation reads the last grant from a
**durable stamp**, never from a process-lifetime field. That is the whole reason
this design keeps any `coord.db` state at all.

**Throttles read a monotonic clock; facts read the wall clock.** An NTP step
backwards — a fresh boot, a VM restored from a snapshot — makes every
`now - lastSweep < INTERVAL` guard true for the length of the step, silently
freezing the lane. Elapsed time comes from `process.hrtime`; `resetAt`,
`nextAttemptAt` and `ts` stay wall-clock because they are instants being
compared, not durations being measured. A negative elapsed means **due now**,
never "not yet".

**The in-flight token must expire.** A token cleared only when a released session
is "observed working" is never returned if the session never works — a
`draft-present` wedge, a pane that died — and one such session stops the drain
forever. It is a lease, with a timeout, not a flag.

**The probe must be one that can actually probe.** Lowest-session-id is
deterministic but says nothing about deliverability: the chosen session may have
a stranded draft, no outstanding mail, or no live pane, and every other session on
the account then waits on it indefinitely. The probe is chosen deterministically
**among deliverable candidates**, and its slot expires so the next candidate can
take it.

**A swap can start after the release has been decided.** Its first act is to tear
the pane down; a send typed into that window fails, and those failures spend the
budget that terminally parks the brief. So `sweepMail` gains a `lastswap`
freshness conjunct — refuse to type into a session whose registry `lastswap` is
within `SWAP_JITTER` plus a carry margin — and a park is invalidated by an
**identity change** (`lastswap` or `.uuid` moving), not merely re-evaluated. A
resume instant is never stored apart from the account it was computed for: after
a swap the session is on a different account and the old instant is about
somebody else's window.

**Skew is measured, not inferred from sample age.** `ts` in `~/.cc-limits` is an
event-driven write stamp, not a heartbeat — on a quiet fleet it is legitimately
hours old, and the three stranded sessions of §1.5 are exactly that shape.
Reading its age as clock skew would wedge the drain on precisely the fleet that
needs it. Skew, if it is guarded at all, comes from a paired sample at the agent
handshake. Note there are three clocks in play: the API's `resets_at`, the fleet
box's `date +%s` in `ts`, and the server's own.

**A restart is a release event.** `mailCooldown`, `mailInFlight` and
`lastMailSweep` are in-memory and cleared by a restart, so a server restart at a
reset boundary drops the spacing. The priming tick's "no storm on boot" discipline
must extend to this lane.

**And so is fixing the detector — the deploy itself is the clock edge.** If
§1.2's fix makes ccd's rescue reachable for sessions where it has been
structurally dead, they do not become eligible at the next *reset*; they become
eligible within one 5-second supervise tick of the **deploy landing**. Every
supervisor on every pinned account classifies the banner in the same tick and
dispatches together — the 2026-08-13 shape, reproduced by a bug fix, at a moment
nobody is thinking about windows. The detector fix must not ship ahead of the
slot. This is the ordering constraint that most wants to be got wrong, and it is
why the plan says land them together or land the slot first.

---

## 6. What must not change

- No new ccd verb, no new `EXEC_COMMANDS` entry, no whitelist widening.
  `capture-pane` and `send-keys` are already granted, in both `local` and
  `remote` mode, and `--force` remains unbuildable from the server because no
  `CCD_ARGV` mint site produces it.
- `FLEET_PROTO` stays 1. Every wire addition is absent-permitting.
- The swap rescue keeps its policy. It may still treat every hard block
  identically; only the log line and the durable marker must not (R5's own
  wording).
- `_avail`'s permissiveness stays. Unknown is eligible and ranks last; that
  asymmetry is load-bearing for the rescue and is not this design's to touch.
- No second copy of `SWAP_CEILING`. The park predicate derives its ceiling from
  the existing constant, or `single-definition.test.ts` fails the build — and B's
  measured 101 proves an independently-chosen number would already be wrong.

---

## 7. The line against R1, stated plainly

The ruling forbids a reconciler that could fight a deliberate human stop. This
design cannot fight one, and the reasons are structural rather than promised:

- It changes no lifecycle state, runs no `ccd` verb, and touches no unit.
- It acts only where the *system's own durable records* say something is owed. A
  session a human stopped has no pane to type into and no outstanding delivery,
  so the lane never selects it — and that is not a promise but a member of the
  vocabulary: `pane-absent` is unreleasable by construction (§3.2).
- It recognises the operator's own kill-switch as a first-class reason it may
  never release (`lane-disabled`), so the one act the ruling was written to
  protect is the one act the design is structurally unable to override.
- Its whole novel behaviour during a park is to *withhold* — strictly less action
  than today, not more.

Where it is honest to concede: releasing a live-but-stalled session is a
**keystroke**, and no existing verb supplies one, so this is a new capability and
not an extension of an old one. That is precisely why it is gated behind an
explicit switch, defaults off, and ships last (§8).

If the operator refuses the automatic half, waves 1 and 2 stand on their own and
the ruling's own remedy applies: the console can finally produce the list, and
the release becomes one tap.

---

## 8. Wave order, and what forces it

R2 is the procedural ruling: publish the measurement, let it be trusted,
automate afterwards. It also happens to be the safe order for R4.

**Wave 1 — make it visible. No behaviour change.** The classifier un-collapse
(R5) and the wording fix, AGENT-FIRST; the server-side detector on the existing
capture; the park axis on the wire; the calendar; the divergence alarm (§3.1);
and stop the "✓ Finished" push lying about a refused turn. Ends with the console
able to say: *these sessions are parked, for this reason, until this instant.*

**Wave 2 — stop making it worse, and give the operator the manual twin.** The
`sweepMail` park conjunct (§4), which is a *reduction* in action; admission
control at dispatch so F8 cannot recur — which **defers, and never refuses**,
because a refusal leaves no delivery row and therefore leaves the release path
nothing to act on, converting a five-hour wait into a permanently undispatched
wave; the coordinator/worker skills learning the word; and — landing before any
automatic drain exists — the human equivalent
of every automatic act, on the screen wave 1 built: **Wake now** (the same
release path, skipping the queue spacing but *not* the idle, draft or
still-pinned gates), **Don't wake** (a per-session opt-out) and **Move to another
account**. This is R2 made concrete: the operator performs the release by hand
often enough to judge whether the automation should perform it at all.

For a session with nothing owed, "Wake now" needs a payload, and there is a
product-authored one to copy rather than invent — Claude Code's own resume text,
measured in §1's provenance: *"Your claude.ai usage limit has reset. Continue the
task you were working on when the limit was reached; do not repeat work that is
already complete."* Note what it does not do: it does not restate the task, it
relies on the session's own context, and it explicitly guards against redoing
finished work.

**Wave 3 — the release, earned.** `selectReleases` in L1, the three-layer bound
(§5), the shared slot, the switch.

**The switch is a mode, not a phase.** Disarmed, detection, classification,
deferral and every surface keep running and the release does not — and the
operator can return to that mode at any time without losing the measurement. It
is reachable from the phone (`POST /api/wake/pause`, ungated by the box token for
D-282's own reason: the actor holding the token is the one that may be wedged, so
gating its release valve behind that key leaves the wedge no door), and it
defaults disarmed.

**Wave order is forced by §5's last paragraph**, not merely preferred: wave 1
widens a trusted actor's reach, so the spacing work cannot trail it by a release
boundary.

---

## 9. The mutation table

Each guard ships with a test measured RED before the guard exists:

- delete any member of the park-reason map → red (total-record scan, the
  `LIFECYCLE_RUNG` precedent).
- collapse `auth-lost` and `limit-7d` to one value anywhere → red.
- remove an alternative from the banner alternation → red, in **both**
  languages, from one shared fixture module parameterised by `now`
  (`server/test/fixtures/rollover.ts` is the precedent that already holds ccd
  and `readLimits` together across the language boundary).
- let the release path key on `five === 0` instead of `fiveRolledOver === true`
  → red.
- read a `~/.cc-limits` epoch as milliseconds anywhere → red.
- join a park to an account via `home` or an id prefix instead of `wrapper` →
  red.
- make the mail park conjunct accrue toward `MAIL_MAX_ATTEMPTS` → red.
- suspend only the pre-delivery selection and not the post-delivery replay
  clock, or vice versa → red (§1.4 needs both arms; `dueDeliveries` gates both
  on `nextAttemptAt`).
- release more than one session per account while that account is unmeasured →
  red.
- release a `never` reason (`auth-lost`, `lane-disabled`, `pane-absent`,
  `spend-cap`, `unknown-block`) under any condition → red, one case per member,
  driven from the same total map.
- let a deferral stand past `PARK_DEFER_MAX_MS` without re-confirmation → red.
- fold a `parked:<reason>` rejection into `undeliverable` → red.
- flip the failure polarity — make an unreadable store read as *armed* rather
  than disabled → red.
- clear a park on the ABSENCE of a banner, or on a `null` capture → red.
- release on the window the banner named rather than on `max(five, seven)` → red.
- parse a wall-clock time out of banner text as a scheduling instant → red.
- classify a pane that is at a live prompt as parked → red, driven by a fixture
  whose pane contains the whole banner corpus *above* a healthy prompt (the
  session reading this design's own test file).
- read a safety bound from a process-lifetime field rather than a durable stamp
  → red, driven by a restart between two releases.
- measure an interval with `Date.now()` in a throttle → red, driven by a
  backwards clock step.
- infer clock skew from the age of a `~/.cc-limits` `ts` → red.
- hold an in-flight release token with no expiry → red.
- choose a probe without checking deliverability → red.
- re-offer a delivery whose done-fingerprint says the work landed → red.
- let admission REFUSE a dispatch rather than defer it → red.
- key the sender notice on the rendered `lastError` → red, driven by two
  re-confirmations of the same park.
- ship wave 1's detector fix without the spacing bound → red (source scan; this
  is the guard that protects §5's ordering constraint).

## 10. Open, for the operator

- **The spend cap has no reset anywhere in the tree.** Park it indefinitely and
  surface it, or let the operator declare a billing day? *Recommendation: park
  and surface* — a declared billing day is a second source of truth to keep
  right, and this design already has one too many.
- **Three shipped sentences become false** for the rate-limit half the day this
  ships: `ccd:11855` ("waiting will not fix it"),
  `SessionActionsSheet.tsx:331` ("Restart session will hit it again") and
  `:482` ("this session will move to another account", now a competing promise).
  They are still correct for `auth-lost`. They must be re-worded per reason.
- **Release spacing.** Probe-first bounds the common case; the global in-flight
  bound needs a number. *Recommendation: one in flight, and raise it only after a
  rollover has been watched* — the cost of being wrong is measured at 9.7 hours.
- **Four measurements are still owed**, each one command on a genuinely
  limit-blocked pane, and each one is cheap: what `status` the live file reports
  at the banner; whether a limit-killed turn fires the `Stop` hook (if not,
  hookstate freezes at `working` and dispatch refuses `worker-busy` for 30
  minutes); how many lines the banner occupies and whether `❯` survives inside
  `tail -8`; and how often Claude Code invokes the statusline command, which
  bounds how stale a captured `resetAt` can be.
