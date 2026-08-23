# Build 3 — the riders: accounts screen, placement honesty, smart branch naming, dormant protocol handshake

**Status:** design, 2026-08-07. Build 3 of the Orca-imports program
(`docs/superpowers/research/2026-08-05-orca-analysis.md`, Tier 1 items 6/8/9 +
UX §5), executed under the operator's standing completion mandate. Scoped from
five read-only scout reports against `7f2c250`; every anchor below was
re-derived this week — do not trust `ccd:NNN` references inside older specs or
comments, the file has grown ~5× past them.

**Shape:** two PRs, sequential. **PR G** — accounts screen + placement honesty
+ protocol handshake (riders A, B, E). **PR H** — smart branch naming (rider
D; executes the already-approved 2026-08-03 spec with the delta appendix
below). Both ship ccd changes → **agent-first rollout**, per standing
discipline. One rider is **descoped with cause** (§ Descoped).

---

## Rider A — the accounts screen

### What exists (do not rebuild)

`GET /api/accounts` (`server/src/server.ts:207-226`) already serves the full
`AccountUsage[]` — `five/seven/ts/fiveResetAt/sevenResetAt/fiveRolledOver/
sevenRolledOver/disabled` — plus `projected` (`projectHome`). The PWA already
renders a compact strip (`pwa/src/fleet/AccountsStrip.tsx`), mounted once,
media-query-switched between the desktop top bar and the mobile fleet list.
The reset/measured-zero/unknown three-way — `reset` vs `0%` vs `—` — is settled and
test-pinned (`pwa/test/accounts-strip.test.tsx`). The screen is an
**expansion of this pipeline**, not new plumbing. No new server route, no
protocol change, no whitelist change: reads only.

### The screen

`/accounts`, a fourth branch of the existing route ternary:

- `pwa/src/lib/router.ts` untouched; `pwa/src/app.tsx:34-36` gains
  `const accounts = /^\/accounts\/?$/.test(path)`, **included in the
  `data-view` OR** (the `pwa/test/app.test.tsx:41-43` warning is real: without
  it, a phone hides the very screen just navigated to), and a fourth arm in
  the `shell-detail` chain.
- Follows `SessionScreen`'s anatomy — **a header with a back control** — not
  `ArchiveScreen`'s (which has neither; recorded gap, not a precedent).
- **Nav affordance:** the `AccountsStrip` itself becomes tappable
  (`role="link"`, `aria-label` naming the destination), navigating to
  `/accounts`. Both mounts, one behavior. Tap-target test applies.

Per account, one card/row, reusing the existing vocabulary
(`pwa/src/lib/accounts.ts` labels/colors, `LimitBar` bands, `formatReset`
countdowns):

1. Both windows as bars with `%`/`reset`/`—` and `↻` countdowns — the strip's
   exact three-way, never collapsed.
2. **Freshness, rendered honestly.** `AccountUsage.ts` is already on the wire
   and nothing displays it. The screen shows "last reported *age*" per
   account. Telemetry is a byproduct of a session rendering its statusline —
   an idle account simply stops reporting — so the screen must read as "last
   known", never as live. No refresh button: there is nothing to refresh; a
   sample only exists when a session runs.
3. **Disabled lanes are shown as switched off, not hidden.** The strip hides
   them (`AccountsStrip.tsx:55-59`) — right for a compact always-on bar,
   wrong for a screen whose job is "show me my accounts". A lane with
   `~/.cc-sessions/<w>-disabled` renders greyed with "disabled on the fleet
   host". (The strip's filter stays as is.)
4. **Sessions on this account**, from the already-connected fleet WS store —
   count + names of live sessions whose `wrapper` matches, each navigating to
   `/s/<id>`. Zero new data: the store is app-wide.
5. The projection line: which account the next workspace lands on
   (`projected`), phrased as ccd's rule ("next workspace lands here —
   least-loaded"), including after Rider B makes it `null`-able (§B).

Data: one more 20s poller of `/api/accounts`, mounted with the screen — the
duplication is deliberate and defended in `useProjectedHome.ts:9-12`;
consolidating the four pollers into a store is recorded as a non-goal, not
smuggled in.

### One boundary fix

`AccountsStrip.tsx:14-19` bands `crit` at `>= 75`; `LimitBar.tsx:11-15` and
`DIRECTION.md:213,266` say `> 75`. At exactly 75 the same account renders two
colors. The strip is the deviation: **change `>= 75` to `> 75`**, adjust the
pinning test. One writer per derived fact — the new screen uses `limitBand`
from `LimitBar.tsx`, not a third copy.

### Non-goals (A)

Poller consolidation; pushing accounts onto `/ws/fleet`; a `swap.log`
"recent moves" feed (new read path, no consumer yet); any write control
(disable-lane toggle, reset-credits) — a write drags a ccd verb + caps line +
`CCD_ARGV` + whitelist prefix + `verbSupported` gate with it, and no write is
needed to make the screen useful.

---

## Rider B — placement honesty (the `_avail` hardening, corrected by evidence)

### The measured problem

The live bug report ("claude2 logged out") is stale — the operator fixed it
2026-08-05 via a setup-token wrapper (`~/.local/bin/claude2` sources
`~/.cc-secrets/claude2-oauth.env`); claude2 is currently the busiest account.
**The structural holes are real regardless of which account they bite next:**

1. `_ws_least_loaded` (`ccd/ccd:982-990`) — ws-add's placement rule — has
   **no availability gate of any kind**: no `_avail`, no
   `[[ -x $WRAPPER_DIR/$w ]]`, no disabled check. `_swap_target` has all
   three concerns covered except disabled.
2. The staleness-zeroing in `_limit_field` (`ccd/ccd:6344-6348`) makes a
   broken account's score **decay toward 0** — the account that cannot run
   sessions becomes the most attractive target, and the `+` button advertises
   it as "100% free". Self-reinforcing.
3. `<wrapper>-disabled` is a **UI-only kill-switch**: `server/src/limits.ts`
   parses it for every lane; ccd honors it for exactly one (`gpt`, via
   `_gpt_enabled` at `ccd/ccd:53`). `touch ~/.cc-sessions/claude2-disabled`
   hides the account from every picker and changes nothing about where ccd
   puts sessions.
4. A session spawned onto a broken account has **no failure path**:
   `_accept_first_run_prompts` (`ccd/ccd:6492-6536`) spins its full ~15-min
   window and returns 0 with no diagnostic, then `_inject_spawn_effort`
   (`ccd/ccd:6570-6584`) types `/effort ultracode` + Enter **into the login
   screen** — an unreviewed keystroke into an auth flow. The PWA shows the
   session as `idle`, or as a question that cannot be answered.

### What ships

**There is no login detection.** The scout's §2 is conclusive: no passive
filesystem signal distinguishes logged-in from logged-out on this box
(claude2's env-token path makes `.credentials.json` mtime actively
misleading; `remote-settings.json` size is folklore). A probe-based check
(spawn `<wrapper> -p ping` and classify) is rejected: it spends tokens, races
real logins, and adds a health-prober to a system whose telemetry is
deliberately passive. What ships instead is the **declared** form plus
honest failure paths:

1. **Generalize the kill-switch.** `_lane_enabled <w>` = no
   `$REG/<w>-disabled` file; `_account_ok <w>` = `[[ -x $WRAPPER_DIR/$w ]] &&
   _lane_enabled <w>`. `_gpt_enabled` becomes `_account_ok gpt` (same file
   path, same semantics, one definition). This makes the file the server
   already parses and the pickers already honor **true in ccd**.
2. **Gate placement.** `_ws_least_loaded` skips accounts failing
   `_account_ok`. `_swap_target`: the candidate loop gains `_lane_enabled`
   (it has `-x` already), and the "home recovered: go back" branch gains
   `_account_ok` (never rotate back onto a disabled home). The "stay put"
   branches are **unchanged** — disabled excludes a lane as a *destination*;
   it never evacuates a session already there. Manual paths (`cmd_start`,
   `cmd_swap`, `cmd_prefer`) are **unchanged**: a named wrapper is an
   operator override by construction (`ccd/ccd:6650-6651` already says so).
3. **All-excluded refuses before anything exists.** The account pick hoists
   from `ccd/ccd:1070` into ws-add's preflight (beside the disk floor at
   `:1018-1022` — `_ws_least_loaded` is pure reads, safe early). If every
   wrapper fails `_account_ok`, `die` naming each wrapper and why
   (`disabled` / `missing`), before the worktree/branch/registry exist —
   "a refusal here must leave the box exactly as it found it." Pressure
   alone still never refuses (the `all-pinned` fixture's rule stands: the
   headroom display is the warning).
4. **Mirror the gate server-side.** `projectHome` (`server/src/limits.ts:51-57`)
   filters `disabled` lanes; all lanes excluded → returns `null`.
   `ProjectedHome | null` on the wire; the `+` label falls back to naming the
   refusal ("all accounts disabled") instead of inventing a target. Honest
   delta, documented in the mirror's comment: the server cannot see `-x`
   (no filesystem authority over `~/.local/bin`), so the projection may name
   a wrapper whose binary is missing — ccd's refusal is the authority.
   **Parity via the existing shared-fixture harness**
   (`server/test/fixtures/leastLoaded.ts`, executed against both bash and
   TS): new cases `disabled-lane-skipped` and `all-disabled`.

   **Corrected 2026-08-07, after the build.** "all accounts disabled" is
   itself a HOME_ABLE-only claim wearing an unqualified word: `projectHome`
   never consults `gpt` (deliberately — it is opt-in-only, never a landing
   spot ccd chooses on its own), and the accounts screen this same label
   sits on renders `gpt` as an account row in the identical list. A reader
   looking at both at once sees the label say "all" while a row two inches
   below it is neither disabled nor consulted for the claim. Shipped copy
   instead names the three HOME_ABLE lanes individually by their human
   labels (`homeAbleLabelList`, `pwa/src/lib/accounts.ts`) — the same
   discipline ccd's own placement refusal already uses (`ccd/ccd`'s
   `die "no account available for placement — claude:disabled
   claude2:disabled claude-corp:disabled …"`, never "all accounts"). Found
   by the whole-branch review's cross-file read (the projection line and the
   row list are two renderings of one `/api/accounts` response, computed
   from different subsets of it); recorded rather than quietly edited — a
   spec that prescribes copy overstating what the server knows is the same
   class of defect as a comment that asserts more than its code proves,
   the same convention Build 2's I2 correction used
   (`docs/superpowers/specs/2026-08-06-attention-ux-design.md`).
5. **The spawn path stops typing into auth screens.**
   `_accept_first_run_prompts` gains a login-screen branch (patterns:
   `Select login method`, `Invalid API key`, `Please run /login`) that
   returns a distinct non-zero code; `_spawn` then **skips
   `_inject_spawn_effort`** and warns:
   `warn: <id> is waiting for login on <wrapper> — attach and run /login`.
   No auto-swap from this branch: a fresh spawn's login screen may be an
   operator mid-login; keystrokes and evacuation are both wrong there.
6. **Mid-session auth failure joins the rescue lane.** `_auto_swap_check`'s
   hard-blocked grep (`ccd/ccd:6427` region) gains the unambiguous
   auth-failure strings only (`Invalid API key`, `Please run /login`) — a
   session that *was* working and lost auth evacuates exactly like a 429.
   `Select login method` deliberately stays out of the rescue grep (that
   screen appears during intentional logins).

### Non-goals (B)

Login probing; evacuating sessions on lane-disable; a ccd verb for
disable/enable (the marker file stays the interface — `touch`/`rm` by the
operator; a PWA write control would drag the full four-table verb chain and
is deferred until asked for); surfacing "logged out" as a detected state
(nothing can detect it — the screen shows *disabled* and *stale telemetry*,
which are the two honest facts available).

---

## Rider D — smart branch naming (PR H): execute the approved spec, with deltas

The 2026-08-03 spec
(`docs/superpowers/specs/2026-08-03-ccrc-smart-branch-naming-design.md`,
approved, decisions D1–D10) **is** the naming deliverable, and it fully
subsumes Orca's rejection ladder: `sessionLabel`'s chain
(`name ?? branch ?? workspace ?? id`) is already the rank order
manual > semantic > born-slug > id, and the noise-rejection rung already
ships (`fleet.ts:128` drops `nameSource === 'derived'`). On this fleet the
"live title" rung is empty by construction (`set-titles-string '#S'` — pure
identity). What is missing is the **semantic rung's writer**: the branch
rename from the `ai-title` Claude Code already wrote — verified live in every
sampled transcript and currently thrown away.

The spec's decisions stand unchanged. Its **plan is unexecutable as
written** — it targets the pre-extraction `infra/ccrc/` layout — so PR H gets
a fresh plan implementing the same design against today's tree, carrying
these deltas (all verified by scout):

| # | Delta | Consequence for the plan |
|---|---|---|
| 1 | Repo layout: `infra/ccrc/*` and `infra/<server-host>-portability/ccd` → `server/*`, `ccd/ccd` | wholesale re-path; every spec line anchor re-derived (ccd anchors drift ~170 lines, server anchors listed in the scout report) |
| 2 | `KeyedQueue` is still local to `buildServer` (`server/src/server.ts:312`); watcher built first (`index.ts:61,63`) | the hoist the spec requires is still to do; the queue join count is now **seven** call sites, not six (four in `inject/send.ts`, two in `server.ts`, plus the rename) |
| 3 | Flag-parsing idiom for the reshaped `ws-rename`: copy `cmd_ws_hold` (`ccd/ccd:1461-1490`), the newest and cleanest | replaces the spec's older references |
| 4 | Newest whitelist/argv entries are `ws-hold`/`ws-release` — the table shapes to extend are theirs | `EXEC_WHITELIST.ccd` + `REQUIRED_VERB_FLAG` + `CCD_ARGV` + `CCD_VERB_TIMEOUT_MS` |
| 5 | `ws-rename` is already advertised by `ccd caps` (`ccd/ccd:1454`) while being **positional** — `verbSupported` answers true for the OLD shape | the spec's probe-before-claim rule (`spec:326-339`) is not sufficient across this upgrade: an old ccd passes the verb gate and then dies on flags. Acceptable: the refusal surfaces as a 1-attempt failure per pair (retry guard absorbs it), and rollout is agent-first anyway. State it, don't engineer around it. |
| 6 | `sessionLabel` is duplicated (`SessionActionsSheet.tsx:203` inline) | fold into the PR: the sheet imports `sessionLabel`; one definition again |
| 7 | prhistory/holds (Build 2.5) landed since | no interaction: `has-upstream` refuses renames after push, and prhistory records at PR-number replacement — a rename precedes any PR. Assert this in a test, don't assume it. |
| 8 | The transcript-side stat gate now has a sibling precedent (`claimAskRead`, `sessionws.ts:178-187`) | copy its shape exactly |

Scope guard: the spec's own out-of-scope list stands (no naming at creation
from the PWA, no manual rename control, no model calls). The
first-prompt-capture idea (hookstate carries no title; `UserPromptSubmit`
has the prompt in hand) is **recorded as Build-4-adjacent future work**, not
smuggled into PR H.

---

## Rider E — the dormant PWA↔server protocol handshake

### The honest shape of the problem

Nothing in the system knows a version (`server/package.json` has no version
key; no git sha ships — `.git` is never rsynced; the PWA's only identity is
its asset hash). The one real skew window is a **stale client**: the SW is
`autoUpdate` with a 15-minute check (`pwa/src/main.tsx:28-40`), so an open
tab can hold pre-deploy JS against a post-deploy server. Server-old skew is
a rollback-only case. And one protocol layer down, `AgentReady.v: 1` is
written and never read — a half-built precedent this design must either wire
or decline explicitly.

### What ships (deliberately inert)

1. **Constants, once, in `shared/`** — beside
   `PRESENCE_REFRESH_MS`/`PRESENCE_TTL_MS`, the established one-definition
   slot:
   ```ts
   /** Wire protocol generation of the PWA↔server pair. Bump on a breaking
    *  wire change. FLEET_PROTO_MIN is the kill-switch: raise it above an
    *  old build's FLEET_PROTO to block that client. Dormant until then —
    *  both stay 1 and the invariant MIN <= PROTO is test-pinned. */
   export const FLEET_PROTO = 1;
   export const FLEET_PROTO_MIN = 1;
   ```
2. **A `hello` first frame on `/ws/fleet`.** Sent synchronously at the top of
   the handler (`server/src/server.ts:228`) — the existing first frame is an
   awaited `assembleFleet`, so `hello` precedes it without reordering risk:
   `{ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO_MIN }`. Every
   already-deployed PWA drops unknown fleet frames silently
   (`fleet.ts:126`) — the safe direction. Client→server carries nothing:
   the server never blocks a client (it 4xx/ignores frames it can't parse);
   only the client self-blocks, because only the client can self-update.
3. **The verbSupported rule, restated for this pair: absence permits.** A
   connection with no `hello` (older server) never blocks. Blocking requires
   positive evidence: `hello.min > FLEET_PROTO` (the client's own constant).
4. **The block screen.** State `blocked: boolean` in the fleet store, set on
   each `hello` (and **cleared** by a compatible one — a reconnect to a
   fixed server must unblock; the one-way-latch trap in
   `session.ts:385-396`'s territory is the thing to avoid). Renders in
   `app.tsx` **above `.app-shell`** (banners live inside panes; this must
   cover both), copy: *"This app build is too old for the fleet server.
   Updating…"*. On becoming blocked it **acts**: triggers the SW update
   check (`main.tsx` already holds the registration; expose a
   `requestUpdate()` from a small module) — `autoUpdate` then skip-waits and
   reloads. A manual "Reload" button backs the automatic path.
5. **Promote the fleet message union to `shared/api.ts`.** It currently
   exists as literals in `server.ts` and a private type in `fleet.ts:46-50` —
   the exact two-copies failure `fleetstate.ts:8-15` documents. `FleetMsg`
   (now `fleet | notice | hello`) moves to shared; both sides import it.
6. **Reducer hardening on the session stream.** `applySessionMsg`
   (`session.ts:116-167`) has no `default`; an old PWA receiving a future
   frame type returns `undefined` into the store. Add a default returning
   state unchanged. (The handshake exists to manage skew; the reducer's skew
   behavior is part of the same story.)
7. **`AgentReady.v` stays reserved — declined, with the reason written
   down** at its declaration: the server↔agent pair already negotiates by
   *capability* (`ccdVerbs` + `verbSupported`), which is finer-grained than
   a generation number; `v` remains the escape hatch for a future breaking
   frame-shape change and gets a consumer only then.

### Non-goals (E)

Build/sha stamping (`deploy.sh` could, nothing needs it yet); a version
header on REST (`push.ts` has three client bypasses and the WS hello covers
the live pair); a server-side `onRequest` hook (would be the first
request-lifecycle hook in the codebase — not for a dormant feature);
blocking on the session socket (fleet-level block covers the app).

---

## Descoped: env seeding at ws-add — recorded, with cause

The rider ("`.worktreeinclude` + hardening checklist", orca Tier 1 #8 +
the 2026-08-04 worktree-ownership future-work bullet) is **not built**, on
three findings:

1. **Measured need ≈ zero.** Fleet-wide, exactly one project has untracked
   `.env` files (`rp-llm` — which has no workspaces); every other
   secret-shaped root file is a tracked template that already arrives with
   the worktree. No live worktree is missing an env file it needs.
2. **The existing mechanism has zero adoption.** `.ccrc/workspace.sh`
   (`ccd/ccd:1077-1086`) ships, is tested, and is used by 0 of 23 projects.
   A second opt-in dotfile does not fix an adoption problem the first one
   revealed — and the 2026-07-28 workspaces spec **deliberately rejected**
   `.worktreeinclude` in favor of that one hook ("one hook, no config
   schema"). Reversing a recorded decision needs a user, not a checklist.
3. **The reap-side half is a consent-model hazard.** "Unchanged seeded
   secrets don't trip `sensitive-ignored`" means a hash exemption inside the
   14-input consent fingerprint — a file deleted without the human seeing it
   named, against a sentence that currently promises "there is no override"
   (`server/src/wsaudit.ts:37`). That trade is a design in its own right,
   not a rider.

**Trigger to revisit:** the first real ask — a colleague project whose
workspaces need untracked local files — at which point Orca's hardening
checklist (literal paths only, size caps, `..`/`.git` segments rejected —
note `ccd/ccd:5516-5522` is the in-house precedent — copy budget) is the
spec to write against, and the seeding step slots between `info/exclude` and
the `.ccrc/workspace.sh` hook with `seeded ok|partial|failed` polarity per
`ccd/ccd:1077-1078`.

---

## Testing & rollout

- **ccd (Rider B):** harness tests beside siblings (`makeCcdHarness`) —
  `_account_ok` truth table; `_ws_least_loaded` skips disabled/missing and
  the all-excluded ws-add refusal creates nothing (copy the
  disk-floor-refusal shape at `ccd-workspaces.test.ts:374-388`);
  `_swap_target` never returns a disabled home; login-screen branch returns
  its code and `_spawn` skips the effort injection (pattern-fixture pane
  text); rescue grep matches `Invalid API key` and not
  `Select login method`. New `leastLoaded.ts` fixture cases run against
  **both** implementations.
- **Server:** `projectHome` disabled-filter + null; `/api/accounts` shape
  unchanged (additive only); hello-is-first-frame ordering; constants
  invariant `FLEET_PROTO_MIN <= FLEET_PROTO`.
- **PWA:** `/accounts` route wiring incl. `data-view` (extend
  `app.test.tsx`); screen renders all lanes incl. disabled, freshness line,
  three-way `%`/`reset`/`—` preserved; strip tap navigates; band boundary
  test moves to `> 75`; blocked set/cleared/absent-permits; block screen
  covers the shell and triggers update; reducer default. Standing gates
  (tap targets, contrast, fleet-css) apply to the new screen.
- **Rollout, per PR: agent first** (ccd ships in both), then server+PWA.
  Live proof for PR G: disabled-marker round-trip on a spare lane —
  `touch`/`rm` by hand, watch the projection and screen react; **no
  destructive verbs, no touching live sessions**. PR H's live proof per the
  naming spec (one real workspace renames after its first ai-title;
  `has-upstream` refusal observed on a pushed one).

## Non-goals (build-wide)

Everything in the per-rider lists, plus: no SQLite (Build 7), no transcript
conversation surface (Build 4), no login detection anywhere, no new
notification kinds.
