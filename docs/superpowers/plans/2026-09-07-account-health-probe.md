# Account health probe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the fleet a way to learn that an account's credential has died — from outside that
account, which by definition has nothing running to prove it — and let placement rank that account
last without ever making it ineligible.

**Architecture:** A sibling executable beside `ccd` (`ccd-account-health`) on a systemd `--user`
timer asks the Anthropic usage endpoint one question per eligible account and writes a durable
marker, `$REG/<account>-authdead`, in the tree's one fault format (`"<epoch> <reason>"`). Four
consumers read it: `_swap_target` ranks the account last, `_ws_least_loaded` drops it from scoring
(never from its `first` fallback), a successful spawn clears it, and the server carries it to the
PWA as a positive flag beside `disabled`, which the accounts screen renders through the
`data-disabled` affordance that already exists.

**Tech Stack:** bash (ccd, the probe, the doctor check, the installers), TypeScript + vitest
(server, PWA), systemd `--user` units.

**Spec:** `docs/superpowers/specs/2026-09-07-account-health-and-provenance-design.md` §A

---

## Global Constraints

- Node floor `>=22.13.0`, identical across all three engines. Never lower engines to make a test green.
- Run suites in the FOREGROUND from inside the package, timeout ≥600000ms:
  `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. **Never bare `npx vitest`.**
- **In tests, use FIXTURE HOMEs only.** `HOME` is the single isolation boundary the whole ccd suite
  relies on. `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`) is the harness; never run `ccd`
  against the live `$HOME`.
- Wire discipline: **additive only, absence-permits.** `authDead` is a new optional-in-practice field.
  Do NOT bump `FLEET_PROTO`. Every reader tests `=== true`, never truthiness, so an older server that
  omits it reads as "not auth-dead" — the permissive direction, exactly as `RosterWire.hidden` and
  `RosterWire.pool` already do (`shared/api.ts:2700-2735`).
- Mutation-table discipline: every guard ships WITH a test measured RED when the guard is deleted.
  Measure it; do not assert it in a comment.
- **This plan is AGENT-FIRST.** It touches `ccd/`, so it ships to the fleet host before the server:
  `bash deploy/deploy.sh agent <host>` first, `bash deploy/deploy.sh` second. Every ccd change is a
  no-op on live sessions until the `KillMode=process`-gated supervisor sweep restarts them; do not
  hand-`install_atomic` any of it without that sweep.
- No account name appears in any shipped source file. Eligibility is roster-derived
  (`telemetry === 'anthropic'`), never a list.
- **Known load flakes** to re-run IN ISOLATION before calling a real break: `ccd-ws-gc`, `pr-sweep`,
  `session-hook`, `typecheck-tests`, `ccd-session-state`. CI on the quiet box is the arbiter.

---

## Background the implementer needs

### 1. What is broken, in one sentence

An account whose credential dies keeps an executable wrapper and an enabled lane, so `_account_ok`
(`ccd/ccd:1238`) still says yes:

```bash
_account_ok() { [[ -x "$WRAPPER_DIR/$1" ]] && _lane_enabled "$1"; }
```

Both conjuncts are **operator intent** — a binary the operator installed, a marker the operator
touched. Neither can be wrong. Nothing on the box measures whether the credential still
authenticates, so nothing can say so.

### 2. The classifier is FOUR outcomes, and the fourth exists because of a measured trap

| Observation | Verdict | Action |
|---|---|---|
| `401 authentication_error` | dead | write the marker |
| `403` whose body names `oauth_scope_insufficient` | live | clear the marker |
| `429`, any other status, network error, timeout | **unmeasured** | write nothing, **clear nothing** |
| token file missing or empty | **refuse** | write nothing, report |

The spec's evidence rows E1–E4 are the whole find: the endpoint authenticates *before* it checks
scope, so a setup token gets **403 `oauth_scope_insufficient`** (E1) and an invalid or malformed
bearer gets **401** (E2, E3) — a working liveness oracle from an endpoint that cannot return usage.
**E4 is the trap: an EMPTY bearer answers 429**, not an auth error. A classifier reading "not 403" as
dead would condemn every account the moment a secrets file went missing. That is why "token file
missing or empty" is its own row and refuses before any request is made.

Unmeasured never writes the marker and — equally important — **never clears one**. A standing marker
survives a probe that could not measure.

### 3. Eligibility is roster-derived, but the token path is a CONVENTION, and that is a seam

`shared/roster.ts:65-68` permits `secretsFile` only on `kind: 'generated'`:

```ts
export type ExecSpec =
  | { kind: 'upstream' }
  | { kind: 'generated'; secretsFile?: string }
  | { kind: 'external' };
```

The mandatory upstream account is `kind: 'upstream'`, so **the roster structurally cannot declare
where its credential lives** — yet its wrapper sources one all the same
(`shared/wrapper.mjs:141-148` builds that line at `:141-143` and concatenates it into the emitted
wrapper at `:144-148`: `[ -r "$HOME/<secretsFile>" ] && . "$HOME/<secretsFile>"`, only for generated
accounts). A roster-driven probe would therefore cover the generated accounts and
**silently skip the primary one**: precisely the class of defect this work exists to remove.

Resolution, from the spec: derive by convention — `.cc-secrets/<id>-oauth.env` for every
`telemetry: 'anthropic'` account — **plus a doctor check that reds when an expected file is absent.**
Absence must be loud. The probe refuses that account rather than skipping it.

`telemetry` is declared per account (`shared/roster.ts:88`, `'anthropic' | 'none'`) and is **not** in
the generated bash roster: `_ws_least_loaded`'s own comment (`ccd/ccd:3805-3810`) records that
`~/.ccrc/accounts.sh` "carries ids, home-ability and the upstream id, and no telemetry field at all
(`shared/generate.mjs`)". So the probe reads `~/.ccrc/accounts.json` directly.

### 4. The consumers RANK-LAST and SKIP. The signal must NOT enter `_account_ok`.

`_account_ok` has five call sites. The dangerous one is inside `_swap_target`'s must-leave loop
(`ccd/ccd:11854`):

```bash
  for cand in $(_pool_for "$id"); do
    [[ "$cand" == "$cur" ]] && continue
    _account_ok "$cand" || continue          # ccd/ccd:11854 — an UNCONDITIONAL skip
    _avail "$cand" || continue
```

That loop is the **rescue lane**. `_auto_swap_check` (`ccd/ccd:11895`) reaches it by classifying the
pane with `_pane_hard_blocked` (`ccd/ccd:11886`) — whose pattern list already includes
`Please run /login` and `Invalid API key`, i.e. lost auth — and passing the verdict in as `force`, so
that a session on a dead credential skips `_swap_target`'s two "stay" shortcuts and lands here.

If a health signal joined `_account_ok`, an over-eager verdict would `continue` past every candidate,
`best` would stay empty, `_swap_target` would print nothing (`ccd/ccd:11883`, `[[ -n "$best" ]] && echo
"$best"` — the function's last statement, so an empty `best` also makes it EXIT 1), and
`_auto_swap_check` would `return 0` at its `[[ -n "$target" ... ]] || return 0` line —
**a session with a lost-auth screen up, left wedged on the dead account, with no `swap.log` line, no
`swapblocked` stamp and no notification.** The failure is silent in every channel the tree has.
Separately, `cmd_ws_add` dies with no fallback when every home-able account fails, and its refusal
message re-derives the conjuncts by hand (`ccd/ccd:4020-4030`), so a third conjunct yields a refusal
that names nothing.

`server/src/limits.ts:169-176` already names this exact loop as *"the exact self-reinforcing hole
`disabled` exists to close"*, with a shipped two-part answer: carry the barred fact as a **positive
flag**, and make unknown **rank last**. This plan spends R2's permission on rank-last and skip, never
on eligibility.

### 5. `_ws_least_loaded` is now POOL-FILTERED, and its `first` fallback must stay reachable

The loop, verbatim (`ccd/ccd:3862-3874`):

```bash
  local pps; pps=$(_project_pool_state "${1-}")
  local best="" bs=1000 first="" w sc
  for w in "${CCRC_HOME_ABLE[@]}"; do
    _account_ok "$w" || continue
    # AFTER `_account_ok`, BEFORE `first`: the fallback below must land on the
    # first IN-POOL account, never on a cheaper-looking lane in another pool.
    _pool_ok "$w" "$pps" || continue
    [[ -z "$first" ]] && first="$w"
    sc=$(_limit_score "$w"); [[ -z "$sc" ]] && continue
    (( sc < bs )) && { bs=$sc; best="$w"; }
  done
  [[ -z "$best" ]] && best="$first"
  echo "$best"
```

Merged wave 2a added `_pool_ok` (`ccd/ccd:1340`) and its `untagged` state. The function's own header
(`ccd/ccd:3827-3833`) states the rule the whole family follows:

> PREFER MEASURED ACCOUNTS; IF NONE IS MEASURED, FALL BACK TO THE FIRST HOME-ABLE ACCOUNT IN ROSTER
> ORDER. Skipping here and ranking-last in `_swap_target` are the two affordable spellings of the same
> preference — this function can skip because it HAS that fallback.

So "skip" here means **skip the SCORING**, not skip the candidate. A health skip placed before
`[[ -z "$first" ]] && first="$w"` would empty the fallback on a fleet where every in-pool lane is
condemned; `_ws_least_loaded` would echo `""`, and `cmd_ws_add` dies. The insertion point is therefore
**AFTER `first`, BEFORE the score** — the mirror image of the comment already sitting two lines above
it.

### 6. The marker's namespace is dotless on purpose

`$REG/<account>-authdead` carries no dot. Every registry glob in the tree is suffix-shaped — three
sites run the same one-dot rule:

| site | function |
|---|---|
| `ccd/ccd:1656` | `_reg_purge` — `rm -f` every `$REG/<id>.<field>` |
| `ccd/ccd:3757` | `_ws_slug_free` — is this slug reusable? |
| `ccd/ccd:3768` | `_ws_slug_residue` — which fields does it still hold? |

each spelled `[[ "$suffix" == *.* ]] && continue`. All three glob `"$REG/$id".*`, which requires a
literal dot after the id, so a dotless `claude-authdead` is invisible to every one of them — even
when a session id collides with it exactly. (The spec says "two sites"; **three** is what is on
disk — see the Deviations section.)

The dotless namespace is shared with the fleet-wide switches `ccd/ccd:773-776` names
(`<w>-disabled`, `coordinator-paused`, `mail-disabled`) plus `AUTOCOMPACT_DISABLE_FILE`
(`ccd/ccd:820`), which are indistinguishable in shape from per-account markers and are disambiguated
only by `inRoster` on the server side (`server/src/limits.ts:183`). `-authdead` must therefore never
read as a fleet-wide noun; it does not.

**Not `-disabled`:** that name is operator-owned, has no writer in the tree, and reusing it would
collapse two conditions — the "no overloaded null at a seam" rule at the seam that decides placement.

### 7. `disabled` is the exact precedent to extend, end to end

Trace it once; this plan adds one field beside it at every hop.

| hop | file:line | what happens |
|---|---|---|
| read | `server/src/limits.ts:117-121` | one `readdir` of `cfg.registryDir`; `disabledLanes` = names ending `-disabled`, suffix stripped |
| shape | `server/src/limits.ts:14-18` | `AccountLimits.disabled: boolean`, documented as "A FLAG rather than omitting the account" |
| score | `server/src/limits.ts:97-98` | `projectHome`: `live = roster.homeAble.filter((a) => limits[a.id]?.disabled !== true)` |
| surface | `server/src/limits.ts:177-186` | a markered lane with no telemetry file still gets a row, gated by `inRoster` so `autocompact-disabled` never becomes a phantom account |
| wire | `shared/api.ts:2662` | `AccountUsage.disabled: boolean` |
| route | `server/src/server.ts:1169` | copied field-by-field into the response |
| render | `pwa/src/screens/AccountsScreen.tsx:194` | `const disabled = a?.disabled === true;` |
| render | `pwa/src/screens/AccountsScreen.tsx:208` | `data-disabled={disabled ? 'true' : 'false'}` on `.accounts-row` |
| render | `pwa/src/screens/AccountsScreen.tsx:219` | `<span className="accounts-disabled-note">disabled on the fleet host</span>` |
| style | `pwa/src/fleet/fleet.css:1742` | `.accounts-row[data-disabled='true'] .acct-fill { background: var(--edge-subtle); }` |

**Extend that affordance; do not invent a second vocabulary.** No new CSS rule, no new data
attribute, no second note class.

### 8. `projectHome` mirrors `_ws_least_loaded` and the mirror is TESTED

`server/test/projected-home.test.ts` runs both languages over one seeded HOME
(`server/test/fixtures/leastLoaded.ts`) and demands they agree on the wrapper AND the score. So the TS
change must mirror §5 exactly: drop an auth-dead account from **scoring**, keep it in the fallback
base, because bash's `first` is assigned before the skip.

`projectHome` today (`server/src/limits.ts:96-108`):

```ts
  const live = roster.homeAble.filter((a) => limits[a.id]?.disabled !== true);
  if (live.length === 0) return null;
  const scorable = live.filter((a) => a.telemetry !== 'none');
  const scored = scorable
    .map((a) => ({ wrapper: a.id, score: measured(limits[a.id]) }))
    .filter((s): s is { wrapper: string; score: number } => s.score !== null);
  if (scored.length === 0) return { wrapper: (scorable[0] ?? live[0]!).id, score: 0 };
  return scored.reduce((best, cand) => (cand.score < best.score ? cand : best));
```

`live` and `scorable[0] ?? live[0]` are the fallback base and must NOT learn about `authDead`.

### 9. The unit pair's template, and the five coordinated deploy edits

`deploy/systemd/ccd-graph-sweep.service` and `.timer` are the model — `Type=oneshot`, `ExecStart` at
`%h/.local/bin/<name>`, a `TimeoutStartSec` budget with its argument in a comment, and a timer with
`OnBootSec` / `OnUnitActiveSec` / `AccuracySec` and `WantedBy=timers.target`.

`agent/test/deploy-verify.test.ts` text-scans `deploy/deploy.sh` and reds if any of five edits is
missing or mis-ordered:

| # | edit | deploy.sh anchor | scanned at |
|---|---|---|---|
| 1 | `install_atomic` of the executable | `:640` (the graph-sweep line) | `deploy-verify.test.ts:592-593` |
| 2 | `cp` of the unit pair inside `AGENT_BUILD_CMD` | `:679` | `:547-560` |
| 3 | `systemctl --user enable --now <timer>` inside `AGENT_CMD`, **after** `daemon-reload` | `:763` | `:568-577` |
| 4 | `ccd/ccrc`'s `_inst_units` / `_inst_enable` for the `ccrc install` path | `ccd/ccrc:4842`, `:4909` | `server/test/ccrc-install.test.ts` |
| 5 | `_uninst_units` for removal | `ccd/ccrc:6191` | `server/test/ccrc-uninstall.test.ts` |

The build/restart split is structural, not textual: `AGENT_BUILD_CMD`'s ssh must exit 0 (`set -euo
pipefail`) before `AGENT_CMD`'s ssh runs, so "unit files land before `daemon-reload`" is guaranteed by
ordering the two ssh calls, and `deploy-verify.test.ts:562-563` asserts `daemon-reload` never appears
in the build half.

**Role and platform gating, mirrored from graph-sweep exactly:**

- `_inst_bins` (`ccd/ccrc:4442-4470`) places the executable inside its `[ "$CCD_OS" != darwin ]`
  block — a binary whose only runner is a systemd timer must not sit on PATH where launchd will never
  fire it.
- `_inst_units` (`ccd/ccrc:4840-4845`) places the unit pair inside its `if [ "$INST_ROLE" != server ]`
  block — a server box holds no wrapper HOMEs and no `~/.cc-secrets`, so it has nothing to probe.
- `_inst_enable` (`ccd/ccrc:4905-4910`) enables the timer behind the same role gate, and **degrades
  rather than dies** (the `_inst_linger` idiom): a health probe is a reading, not the guardrail
  `ccd-cap-scopes.timer` is.

### 10. Secrets discipline, and where the ccrc-ddns pattern stops applying

`deploy/systemd/ccrc-ddns.service` is the tree's one credentialed unit. Its rule: the 0644 unit file
carries no secret; systemd expands `${CCRC_DDNS_TOKEN}` at run time from the 0600
`EnvironmentFile=%h/.ccrc/exposure.env`.

That mechanism handles **one** credential. This probe needs **N** — one per eligible account, each in
its own file — so systemd cannot expand them and the unit must carry no `EnvironmentFile` at all. The
half of the pattern that binds here, and is what this plan enforces:

- the 0644 unit names no credential and no path into `~/.cc-secrets`;
- each token is read at run time from its own file, inside a **subshell** so no export survives into
  the probe's own environment (and therefore into `curl`'s `/proc/<pid>/environ`);
- the token is handed to `curl` on **stdin** via `curl -K -`, never in argv, so it is never in the
  process table;
- the token is never echoed, never logged, and the response body is classified and discarded.

### 11. `macos-platform.test.ts` will adopt the new file the moment it exists

`server/test/macos-platform.test.ts:175-180` derives its corpus from **every shebang'd file in
`ccd/`** — this was made a derivation precisely so "the next file added to `ccd/` is a decision
someone records here rather than a gap nobody sees". The GNU-only table
(`macos-platform.test.ts:108-127`) refuses: a bare `timeout`, a template-less `mktemp`, `stat -c/-f`,
`du -s[cb]`, `sha256sum`, `date +%s%3N`, `date -d`, `cp --remove-destination`, `mv -T`, `uuidgen`.

The probe in this plan uses none of them (`date +%s` is not in the table; the deadline is
`curl --max-time`, not `timeout`), so it joins the owned corpus rather than the `unowned` escape
hatch. Keep it that way.

---

## File Structure

| File | Responsibility |
|---|---|
| `ccd/ccd` (modify) | `_authdead` reader; the dotless-marker inventory; `_swap_target` rank-last; `_ws_least_loaded` skip-scoring; the clear on a successful spawn |
| `ccd/ccd-account-health` (create) | The probe: eligibility, token read, the four-outcome classifier, marker write/clear |
| `deploy/systemd/ccd-account-health.service` (create) | `Type=oneshot` unit; carries no credential |
| `deploy/systemd/ccd-account-health.timer` (create) | 15-minute cadence, `OnBootSec=7min` |
| `deploy/deploy.sh` (modify) | `install_atomic` the probe; `cp` the units in `AGENT_BUILD_CMD`; enable the timer in `AGENT_CMD` |
| `ccd/ccrc` (modify) | `_inst_bins`, `_inst_units`, `_inst_enable`, `_uninst_units`, `_uninst_tree_bins` |
| `deploy/gen-wrappers.mjs` (modify) | `TOOLCHAIN_EXECUTABLES` gains the probe's name so the orphan scan does not report it |
| `ccd/ccrc-doctor-checks` (modify) | `credentials` check + its table entry (an expected token file that is absent is LOUD); `_check_services`' `known` list gains the new timer, with a per-timer consequence sentence |
| `server/src/limits.ts` (modify) | `AccountLimits.authDead`; read it in `readLimits`; drop it from `projectHome`'s scoring only |
| `shared/api.ts` (modify) | `AccountUsage.authDead` — additive, absence-permits |
| `server/src/server.ts` (modify) | Copy `authDead` into the `GET /api/accounts` row |
| `pwa/src/screens/AccountsScreen.tsx` (modify) | Extend `data-disabled` + the note to cover an auth-dead lane |
| `server/test/ccd-authdead.test.ts` (create) | The reader, the purge-survival guard, and both placement consumers |
| `server/test/account-health.test.ts` (create) | The probe: the four-outcome table, eligibility, the id-grammar parity pin, the secrets pins |
| `server/test/fixtures/leastLoaded.ts` (modify) | An `authDead` field on the shared parity fixture, plus one case |
| `server/test/projected-home.test.ts` (modify) | Seed the marker for both languages; own the all-condemned case, which the parity runner cannot express |
| `server/test/limits.test.ts` (modify) | `authDead` on the `readLimits` shape assertions |
| `server/test/accounts-route.test.ts` (modify) | `authDead` on the route rows |
| `server/test/ccrc-doctor.test.ts` (modify) | `healthy()` gains a `telemetry` roster field and a token file; the `credentials` cases; the account-health-timer `services` cases |
| `server/test/ccrc-install.test.ts` (modify) | The tree file list, `UNIT_FILES`, the enable argv lists, the `.local/bin` census, the role-server exclusions |
| `server/test/ccrc-uninstall.test.ts` (modify) | `plantInstalledBox` bins/units, the disable calls, the removal set |
| `server/test/gen-wrappers.test.ts` (modify) | The toolchain-name lists |
| `agent/test/deploy-verify.test.ts` (modify) | The five deploy edits |
| `server/test/single-definition.test.ts` (modify) | Pin the two holders of the `.cc-secrets/<id>-oauth.env` convention |
| `pwa/test/accounts-screen.test.tsx` (modify) | The `acct()` default and the auth-dead render cases |

---

### Task 1: `_authdead` — the reader, and the namespace that cannot be swept

**Files:**
- Modify: `ccd/ccd` (the constants block at `:773-777`; a new function beside `_lane_enabled` at `:1047`)
- Create: `server/test/ccd-authdead.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is the first.
- Produces: `_authdead <wrapper>` — exit 0 iff `$REG/<wrapper>-authdead` exists AND its first
  whitespace-delimited field is all digits; exit 1 otherwise. No output on any path. Tasks 2, 3 and
  the probe all call it or write the file it reads.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-authdead.test.ts`:

```typescript
// `$REG/<account>-authdead` is the account-health probe's durable verdict, in the
// tree's one fault format — `"<epoch> <reason>"`, the shape `swapblocked` already
// uses (ccd/ccd:13599). This file pins the READER and the NAMESPACE; the two
// placement consumers are pinned in the describes Task 2 adds below.
//
// THE DIGITS GATE IS NOT COSMETIC. ccd runs under `set -u`, and every reader of a
// stamped marker in this file validates the epoch as digits BEFORE any arithmetic
// touches it (`_auto_swap_check`'s `bts`, ccd/ccd:11909) — a hand-edited or
// half-written field otherwise emits an unbound-variable line on every supervise
// tick. `_authdead` is a predicate rather than an arithmetic reader, so the gate
// buys something else here: it is what makes a TRUNCATED marker read as "no
// verdict" instead of as a verdict nobody wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string, env: NodeJS.ProcessEnv = {}): string => h.sh(s, env);
const ok = (snippet: string): boolean => sh(`${snippet} && echo yes || echo no`) === 'yes';
const marker = (w: string): string => path.join(home, '.cc-sessions', `${w}-authdead`);
const mark = (w: string, body: string): void => fs.writeFileSync(marker(w), body);

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-authdead-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_authdead', () => {
  it('is false when no marker exists', () => {
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is true for the shipped format, "<epoch> <reason>"', () => {
    mark('claude', '1757203200 auth-401');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('is true for a bare epoch with no reason — the reason is a note, the stamp is the fact', () => {
    mark('claude', '1757203200');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('is FALSE for an empty file — a marker nobody finished writing is not a verdict', () => {
    mark('claude', '');
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is FALSE when the first field is not digits', () => {
    mark('claude', 'yesterday auth-401');
    expect(ok('_authdead claude')).toBe(false);
  });

  it('answers per account, never fleet-wide', () => {
    mark('claude-a', '1757203200 auth-401');
    expect(ok('_authdead claude-a')).toBe(true);
    expect(ok('_authdead claude')).toBe(false);
    expect(ok('_authdead claude-b')).toBe(false);
  });

  it('prints nothing on either path — it is a predicate, not a reader', () => {
    mark('claude', '1757203200 auth-401');
    expect(sh('_authdead claude; _authdead claude-b; echo END')).toBe('END');
  });
});

describe('the marker is DOTLESS, so no registry glob can eat it', () => {
  // Every registry glob in ccd is suffix-shaped and runs the same one-dot rule
  // (`[[ "$suffix" == *.* ]] && continue`) at THREE sites: `_reg_purge`
  // (ccd/ccd:1656), `_ws_slug_free` (:3757) and `_ws_slug_residue` (:3768). All
  // three glob `"$REG/$id".*`, which requires a literal dot AFTER the id — so a
  // dotless `<account>-authdead` is invisible to them even when a session id
  // collides with it byte for byte. Asserted rather than assumed, because the
  // collision is what a per-account marker in the session namespace risks and it
  // is exactly the class `_reg_purge`'s own header records as measured.
  it('survives _reg_purge of a session whose id IS the marker name', () => {
    const reg = path.join(home, '.cc-sessions');
    mark('claude-authdead', '1757203200 auth-401');
    fs.writeFileSync(path.join(reg, 'claude-authdead.uuid'), 'u\n');
    fs.writeFileSync(path.join(reg, 'claude-authdead.wrapper'), 'claude\n');
    sh('_reg_purge claude-authdead');
    expect(fs.existsSync(path.join(reg, 'claude-authdead.uuid')), 'the session row survived').toBe(false);
    expect(fs.existsSync(marker('claude-authdead')), 'the marker was swept').toBe(true);
  });

  it('does not make a colliding slug read as occupied', () => {
    // The other direction of the same rule: `_ws_slug_free` must not see the
    // dotless marker either, or the marker would wedge a slug forever.
    mark('demo-quiet', '1757203200 auth-401');
    expect(ok('_ws_slug_free demo quiet')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-authdead.test.ts
```

Expected: **THREE** cases fail — "is true for the shipped format", "is true for a bare epoch with no
reason" and "answers per account, never fleet-wide" — each with `expected false to be true`.

That is the whole red half, and the six greens are not an accident to be surprised by later. `h.sh`
runs `bash -c 'source ccd; _authdead claude && echo yes || echo no'`; with `_authdead` undefined bash
prints `_authdead: command not found` on **stderr** (which `sh` discards) and takes the `|| echo no`
arm, so an undefined function is INDISTINGUISHABLE from a correct negative answer. The three negative
cases ("is false when no marker exists", "is FALSE for an empty file", "is FALSE when the first field
is not digits") therefore pass already. "Prints nothing on either path" passes too: the snippet ends
in `echo END`, so stdout is `END` and the exit status is `echo`'s 0. The two dotless cases pass
because the property they measure is structural.

**That six-of-nine green baseline is exactly why Step 6's mutation, and not this step, is what proves
the digits gate.** Record the actual output.

- [ ] **Step 3: Add the reader**

In `ccd/ccd`, immediately after `_lane_enabled` (`:1047`) and before the line that follows it:

```bash
# The account-health probe's durable verdict, in the same `"<epoch> <reason>"`
# format `swapblocked` uses. WRITTEN BY `ccd-account-health` (a sibling
# executable, never this file — ccd makes no outbound network call, and adding
# one would be a new dependency class); CLEARED by that probe on a 403, by a
# successful spawn (`_spawn_settle`), and by an operator `rm`.
#
# DOTLESS AND PER-ACCOUNT, which is what keeps it out of every registry glob:
# `_reg_purge`, `_ws_slug_free` and `_ws_slug_residue` all glob `"$REG/$id".*`
# and skip any suffix containing a dot, so `$REG/claude-authdead` is invisible
# to all three even when a session id spells it exactly.
#
# NOT `-disabled`. That name is OPERATOR intent, has no writer in this tree, and
# both its conjuncts in `_account_ok` are things a human did. This one is a
# MEASUREMENT, which can be wrong — so it never joins `_account_ok`, and its two
# consumers rank-last (`_swap_target`) and skip-scoring (`_ws_least_loaded`)
# instead. A rescue must always have a destination.
#
# THE DIGITS GATE, exactly as `_auto_swap_check` validates `swapblocked`'s epoch
# (ccd:11909): the field is bytes off disk. Here it also decides the answer — an
# empty or half-written marker is NOT a verdict, and reading one as "dead" would
# let a truncated write bar an account nothing ever measured.
_authdead() {   # wrapper -> success iff a well-formed auth-dead marker stands for it
  local t; t=$(cat "$REG/$1-authdead" 2>/dev/null); t="${t%% *}"
  [[ "$t" =~ ^[0-9]+$ ]]
}
```

- [ ] **Step 4: Join the dotless inventory**

In `ccd/ccd`, in the `POOLS_DIR` header block, change the three lines at `:774-776` from:

```bash
# project (spec §4, approach B). Outside every git tree and every session cwd,
# beside the switches an operator already hand-touches (`<w>-disabled`,
# `coordinator-paused`, `mail-disabled`) — `ls ~/.cc-sessions/pools/` shows
```

to:

```bash
# project (spec §4, approach B). Outside every git tree and every session cwd,
# beside the switches an operator already hand-touches (`<w>-disabled`,
# `coordinator-paused`, `mail-disabled`) and the one marker a MACHINE writes
# there (`<account>-authdead`, see `_authdead`) — `ls ~/.cc-sessions/pools/` shows
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-authdead.test.ts
```

Expected: 9 passed.

- [ ] **Step 6: Measure the mutation**

Change the digits gate to a bare presence test — replace the body of `_authdead` with
`[[ -e "$REG/$1-authdead" ]]` — re-run, and confirm the two negative cases ("empty file", "first
field is not digits") go RED with `expected true to be false`. Restore the real body. Record
before/after in the commit message.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-authdead.test.ts
git commit -m "feat(ccd): _authdead reads the probe's marker, and the dotless namespace keeps it (D-TBD-authdead-purge-sites)

The marker is \$REG/<account>-authdead, \"<epoch> <reason>\" — swapblocked's shape.
Dotless, so the one-dot suffix rule at all THREE registry-glob sites (_reg_purge,
_ws_slug_free, _ws_slug_residue — the spec said two) cannot sweep it, measured
against a session id that spells the marker exactly.

Mutation measured: replacing the digits gate with a bare -e reds 2 assertions."
```

---

### Task 2: The two placement consumers — rank last, and skip the scoring only

**Files:**
- Modify: `ccd/ccd` (`_ws_least_loaded`'s loop at `:3862-3874`; `_swap_target`'s candidate loop at
  `:11852-11884`)
- Modify: `server/test/ccd-authdead.test.ts` (append two describes)

**Interfaces:**
- Consumes: `_authdead <wrapper>` from Task 1 — exit 0 iff a well-formed marker stands.
- Produces: no new function and no signature change. `_ws_least_loaded [project]` still echoes one
  wrapper or `""`; `_swap_target <id> <cur> <home> [force]` still echoes one wrapper or nothing.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-authdead.test.ts`:

```typescript
const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));

describe('_ws_least_loaded drops an auth-dead lane from SCORING, never from the fallback', () => {
  it('does not place a new workspace on the cheapest lane when that lane is auth-dead', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);        // cheapest, but dead
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    mark('claude-a', '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude-b');
  });

  it('STILL ANSWERS when every home-able lane is auth-dead — the `first` fallback is reachable', () => {
    // THE CASE THE SKIP IS PLACED FOR. A health skip written ABOVE
    // `[[ -z "$first" ]] && first="$w"` empties the fallback here, this
    // function echoes "", and `cmd_ws_add` dies with no destination on a fleet
    // whose accounts are all merely UNVERIFIED. Eligibility must survive; only
    // preference changes.
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) mark(w, '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude');   // roster declaration order
  });

  it('an auth-dead lane can still BE the fallback when it is the first placeable one', () => {
    // No telemetry anywhere: nothing is scorable at all, so both the skip and
    // the score branch are moot and `first` decides. That `first` is allowed to
    // be a condemned lane is the whole content of the previous case, stated
    // where it is visible without four markers.
    mark('claude', '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude');
  });
});

describe('_swap_target ranks an auth-dead lane LAST, and never makes it ineligible', () => {
  const seedSession = (id: string, wrapper: string): void => {
    const reg = path.join(home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, `${id}.uuid`), 'u\n');
    fs.writeFileSync(path.join(reg, `${id}.wrapper`), `${wrapper}\n`);
    fs.writeFileSync(path.join(reg, `${id}.home`), `${wrapper}\n`);
  };

  it('prefers a measured healthy lane over a cheaper auth-dead one', () => {
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned, must leave
    writeLimits('claude-a', 5, 5);        // cheapest, but dead
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    mark('claude-a', '1757203200 auth-401');
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-b');
  });

  it('STILL RESCUES onto an auth-dead lane when it is the only destination left', () => {
    // The rescue lane's rule, and the thing to pin hardest: an over-eager
    // verdict must cost PREFERENCE, never a destination. A `continue` here
    // leaves `best` empty, `_swap_target` prints nothing, `_auto_swap_check`
    // returns silently, and a session with a lost-auth screen up stays wedged
    // with no swap.log line and no notification.
    //
    // `|| true` IS LOAD-BEARING, and it is here so this case can FAIL rather
    // than ERROR. `_swap_target`'s last statement is `[[ -n "$best" ]] && echo
    // "$best"` (ccd/ccd:11883), so an empty `best` makes the function — and the
    // `bash -c` around it — exit 1, and `makeCcdHarness`'s `sh` is
    // `execFileSync`, which THROWS on a non-zero exit. Without the `|| true`
    // the Step 6 mutation that turns the guard into a `continue` would blow up
    // inside the harness instead of reporting `expected '' to be 'claude-d'`,
    // and an unmeasurable mutation is the one thing this table may not have.
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned
    writeLimits('claude-a', 99, 99);      // over the ceiling — _avail rejects
    writeLimits('claude-b', 99, 99);      // over the ceiling — _avail rejects
    writeLimits('claude-d', 5, 5);        // the only available lane, and dead
    mark('claude-d', '1757203200 auth-401');
    expect(sh('_swap_target claude-demo claude claude || true')).toBe('claude-d');
  });

  it('an auth-dead lane ties with an unmeasured one and loses the tie to roster order', () => {
    // Both land at 100 — the block unmeasured already occupies — and the strict
    // `<` takes the first in pool order. Pinned so a later edit that gave
    // auth-dead its own worse-than-unmeasured rank has to say so out loud.
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned
    writeLimits('claude-a', 5, 5);        // dead -> 100
    mark('claude-a', '1757203200 auth-401');
    // claude-b and claude-d have no telemetry file at all -> unmeasured -> 100
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-a');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-authdead.test.ts
```

Expected red, and it matters WHICH cases:

- `_ws_least_loaded` "does not place … when that lane is auth-dead" —
  `expected 'claude-a' to be 'claude-b'`.
- `_swap_target` "prefers a measured healthy lane …" — `expected 'claude-a' to be 'claude-b'`.
- `_swap_target` "ties with an unmeasured one …" — passes already (`claude-a` at score 5 wins for the
  wrong reason). That is fine: it is a pin, not a change, and it goes on passing after Step 3 for the
  right reason.
- The two "still answers" / "still rescues" cases pass already. They exist to go RED at Step 5 if the
  guard is written in the wrong place, which is the only way to fail this task badly.

**Record the actual output.**

- [ ] **Step 3: Skip the SCORING in `_ws_least_loaded`**

In `ccd/ccd`, inside the loop at `:3865-3872`, insert between `[[ -z "$first" ]] && first="$w"` and
the `sc=` line:

```bash
    [[ -z "$first" ]] && first="$w"
    # AFTER `first`, BEFORE the score — the mirror of the `_pool_ok` note above,
    # and the placement is the whole guard. An auth-dead lane must not be
    # PREFERRED (it is a measurement that a credential no longer authenticates),
    # but it must stay reachable as the fallback: a skip written one line higher
    # empties `first` on a fleet where every in-pool lane is condemned, this
    # function answers "", and `cmd_ws_add` dies with no destination — for a
    # reason no operator asked for. Same asymmetry, same reason, as the
    # unmeasured skip below it: this function can skip a SCORE because it has a
    # fallback; it can never skip a CANDIDATE.
    _authdead "$w" && continue
    sc=$(_limit_score "$w"); [[ -z "$sc" ]] && continue
```

- [ ] **Step 4: Rank last in `_swap_target`**

In `ccd/ccd`, in the candidate loop, replace the single line at `:11880`:

```bash
    sc=$(_limit_score "$cand"); : "${sc:=100}"
```

with:

```bash
    sc=$(_limit_score "$cand"); : "${sc:=100}"
    # THE HEALTH SIGNAL JOINS THE UNMEASURED BLOCK, and joins it here rather
    # than at the `_account_ok` line above, which is an unconditional
    # `continue`. This loop is the ESCAPE ROUTE: a hard-blocked session that
    # finds no candidate is left wedged on the dead account with no swap.log
    # line, no swapblocked stamp and no notification — silent in every channel
    # this tree has. `_account_ok`'s two conjuncts are operator INTENT and
    # cannot be wrong; an auth probe is a MEASUREMENT and can be, so it may cost
    # preference and must never cost eligibility.
    #
    # 100 is the same exact number, for the same exact reason, as the `:=100`
    # above: `_avail` has already rejected every candidate at or over
    # SWAP_CEILING (98), so any measured candidate reaching this line is at most
    # 97 and outranks a condemned one — while 100 is far below `best_score`'s
    # 999 sentinel, so a condemned candidate is still picked the moment it is
    # the only one left.
    _authdead "$cand" && sc=100
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-authdead.test.ts
```

Expected: 15 passed.

- [ ] **Step 6: Measure both mutations, separately**

1. Delete `_authdead "$w" && continue` from `_ws_least_loaded`, re-run: the "does not place a new
   workspace on the cheapest lane" case goes RED with `expected 'claude-a' to be 'claude-b'`. Restore.
2. **MOVE** it one line UP, above `[[ -z "$first" ]] && first="$w"`, re-run: the "STILL ANSWERS when
   every home-able lane is auth-dead" case goes RED with `expected '' to be 'claude'`. Restore. This
   is the mutation that matters — it proves the guard's POSITION is load-bearing, not just its
   presence.
3. Delete `_authdead "$cand" && sc=100` from `_swap_target`, re-run: "prefers a measured healthy lane"
   goes RED with `expected 'claude-a' to be 'claude-b'`. Restore.
4. Change it to `_authdead "$cand" && continue`, re-run: "STILL RESCUES onto an auth-dead lane" goes
   RED with `expected '' to be 'claude-d'`. Restore. This is the one that needs the case's `|| true`:
   with the mutation in place `_swap_target` finds no candidate, returns 1, and without the `|| true`
   `execFileSync` would THROW instead of asserting.

Record all four in the commit message.

- [ ] **Step 7: Run the neighbouring placement suites**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-account-ok.test.ts test/ccd-workspaces.test.ts
```

Expected: both pass unchanged, with **no edits needed** — neither seeds an `-authdead` marker, and
`_authdead` on a fixture home with no marker is false, so both loops behave exactly as before. This
was checked when the plan was written: `ccd-account-ok.test.ts` pins `_account_ok`, `_ws_least_loaded`
and `_swap_target` over `<w>-disabled` markers and telemetry only. If either reds, stop and re-derive
rather than editing an assertion.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-authdead.test.ts
git commit -m "feat(ccd): auth-dead ranks last and drops out of scoring, never out of eligibility (D-TBD-authdead-least-loaded-first)

_swap_target forces the candidate to 100 — the block unmeasured already occupies —
rather than skipping it: that loop is the rescue lane, and a rescue with no
destination leaves a lost-auth session wedged with no swap.log line and no
notification. _ws_least_loaded skips the SCORE, placed AFTER \`first\` so the
fallback stays reachable when every in-pool lane is condemned.

Mutations measured, four: deleting either guard reds 1 each; MOVING the
least-loaded guard above \`first\` reds the all-condemned case; turning the
swap-target guard into a \`continue\` reds the only-destination-left case."
```

---

### Task 3: A successful spawn clears the marker

**Files:**
- Modify: `ccd/ccd` (`_spawn_settle`'s `prompt_rc` case at `:12531-12534`)
- Modify: `server/test/ccd-authdead.test.ts` (append one describe)

**Interfaces:**
- Consumes: nothing new. `_spawn_settle` already has `$wrapper` in scope (`ccd/ccd:12505`).
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-authdead.test.ts`:

```typescript
describe('a successful spawn is evidence, and clears the marker', () => {
  // §A.6's second owner. The probe (owner one) clears on a 403 within its
  // 15-minute cadence; this narrows the stale window to zero for the case where
  // an operator has just fixed the credential and started a session on it.
  //
  // rc 0 ONLY, and that is the whole discipline. `cmd_start` clears
  // `swapblocked` on the ATTEMPT (ccd:12908) because a swap refusal is a stale
  // banner an operator supersedes by acting. An auth-dead marker is a
  // MEASUREMENT: clearing it on an attempt would erase a true fault with no
  // evidence. rc 2 is "waiting for login" and rc 5 is "hard-blocked at startup
  // (limit/spend banner, or lost auth)" — both are the OPPOSITE of evidence.
  // `|| true` IS LOAD-BEARING. `_spawn_settle` ends in `return "$prompt_rc"`
  // (ccd/ccd:12561), so the rc 2 and rc 5 cases make the `bash -c` exit 2 and 5
  // — and `makeCcdHarness`'s `sh` is `execFileSync`, which THROWS on any
  // non-zero exit (ccd runs `set -uo pipefail`, no `-e`, so nothing else
  // rescues it). Swallowing the code here is what makes those two cases assert
  // rather than error, which is the only way Step 5's second mutation can be
  // measured at all.
  const settle = (id: string, rc: number): string =>
    sh(`_accept_first_run_prompts() { return ${rc}; }; _tmux() { echo t; };`
      + ` _inject_spawn_effort() { :; }; _lc_done() { :; }; _spawn_settle ${id} "" || true`);

  const seedOn = (id: string, wrapper: string): void => {
    const reg = path.join(home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, `${id}.uuid`), 'u\n');
    fs.writeFileSync(path.join(reg, `${id}.wrapper`), `${wrapper}\n`);
  };

  it('clears the marker for the account the session actually spawned on', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('leaves every OTHER account\'s marker standing', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    mark('claude-b', '1757203200 auth-401');
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-b'))).toBe(true);
  });

  it('does NOT clear on rc 2 — "waiting for login" is the opposite of evidence', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    settle('claude-demo', 2);
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
  });

  it('does NOT clear on rc 5 — hard-blocked at startup, which includes lost auth', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    settle('claude-demo', 5);
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-authdead.test.ts
```

Expected: the first case fails with `expected true to be false` (nothing clears the marker yet). The
second, third and fourth pass already — as ORDINARY assertions, not as errors, because `settle`
swallows `_spawn_settle`'s return code; they are the pins that go RED if Step 3 is written too
broadly. **Record the actual output.**

- [ ] **Step 3: Clear on rc 0**

In `ccd/ccd`, in `_spawn_settle`'s case at `:12531-12534`, change:

```bash
  case "$prompt_rc" in
    # A revival supersedes an earlier deliberate stop (§4.1). `rm -f` on an absent file is a no-op,
    # so this is correct whether or not the .stopped stamp itself has landed yet.
    0) rm -f "$REG/$id.stopped" ;;
```

to:

```bash
  case "$prompt_rc" in
    # A revival supersedes an earlier deliberate stop (§4.1). `rm -f` on an absent file is a no-op,
    # so this is correct whether or not the .stopped stamp itself has landed yet.
    #
    # AND THE AUTH-DEAD MARKER FOR THIS ACCOUNT, on rc 0 and only rc 0. A TUI
    # that came up on `$wrapper` is proof that account's credential
    # authenticates — the second of the three owners §A.6 gives that marker,
    # beside the probe's own 403 and an operator `rm`. Deliberately NOT the
    # `cmd_start` shape one screen down, which clears `swapblocked` on the
    # ATTEMPT: a refused swap is a stale banner a human act supersedes, while
    # this is a MEASUREMENT and erasing one without evidence is a guess. rc 2
    # ("waiting for login") and rc 5 ("hard-blocked at startup … or lost auth")
    # are the opposite of evidence and are pinned to keep the marker.
    0) rm -f "$REG/$id.stopped" "$REG/$wrapper-authdead" ;;
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-authdead.test.ts
```

Expected: 19 passed.

- [ ] **Step 5: Measure the mutation**

1. Remove `"$REG/$wrapper-authdead"` from the rc 0 arm, re-run: the first case reds with
   `expected true to be false`. Restore.
2. Move the same `rm -f "$REG/$wrapper-authdead"` above the `case` (so it runs on every rc), re-run:
   the rc 2 and rc 5 cases red with `expected false to be true` — ordinary assertion failures, which
   is what `settle`'s `|| true` buys. Restore. Record both.

- [ ] **Step 6: Run the spawn suites**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-session-state.test.ts test/lifecycle.test.ts
```

Expected: both pass. `ccd-session-state` is a **known load flake** — if it reds on
`expected ['mid-carry:orphan'] to include 'mid-carry:restarting'`, re-run it alone before treating it
as a real break.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-authdead.test.ts
git commit -m "feat(ccd): a TUI that came up is evidence — _spawn_settle clears that account's authdead marker

rc 0 and only rc 0. Unlike cmd_start's swapblocked clear, which fires on the
ATTEMPT because a refused swap is a stale banner a human act supersedes, this is
a measurement: erasing it without evidence is a guess. rc 2 (waiting for login)
and rc 5 (hard-blocked, incl. lost auth) are pinned to KEEP the marker.

Mutations measured: dropping the path reds 1; hoisting the rm above the case
reds 2."
```

---

### Task 4: The probe — `ccd/ccd-account-health`

**Files:**
- Create: `ccd/ccd-account-health`
- Create: `server/test/account-health.test.ts`

**Interfaces:**
- Consumes: `$REG/<account>-authdead` as written by nothing yet — this task is its only writer.
  The reader is Task 1's `_authdead`, and this file must produce exactly what that reader accepts:
  `"<epoch> auth-401"`, epoch seconds, one space.
- Produces: an executable taking no arguments. Exit 0 on any pass that ran; exit 1 only when the pass
  could not start (no `jq`, no `curl`, no readable roster). Env knobs, all overridable:
  `CCRC_HEALTH_URL`, `CCRC_HEALTH_TIMEOUT`. Nothing else reads its stdout.

- [ ] **Step 1: Write the failing test**

Create `server/test/account-health.test.ts`:

```typescript
// The credential-liveness probe. Four outcomes and NOT three — the fourth,
// "token file missing or empty", exists because of a measured trap: an EMPTY
// bearer makes the usage endpoint answer 429, not an auth error (spec E4). A
// classifier reading "not 403" as dead would condemn every account on the fleet
// the moment a secrets file went missing.
//
// The endpoint is never reached here. `curl` is resolved off PATH, and the
// harness plants a fake one in `<home>/.local/bin` — the head of the contained
// PATH — that answers a chosen status and body and records its argv and stdin.
// That recording is what lets this file assert the SECRETS contract as well as
// the classifier: the token must never appear in argv.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

// Linux-only by product shape, exactly as `graph-sweep.test.ts` carves itself
// out: the probe's only runner is a systemd timer, `_inst_bins` does not place
// it on a Darwin box, and flock(1) is not BSD userland.
beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

const PROBE = path.resolve(__dirname, '../../ccd/ccd-account-health');
const SHAPE = path.resolve(__dirname, '../../ccd/ccrc-wrapper-shape');
let home: string;
const j = (...p: string[]) => path.join(home, ...p);

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
  ],
};

/** A `curl` that answers one status and body for every call, appends its argv to
 *  `$HOME/curl-argv` and its stdin to `$HOME/curl-stdin`, and honours the probe's
 *  `-w` contract by printing the body then a newline then the status. */
function plantCurl(status: string, body = '', exitCode = 0): void {
  const bin = j('.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/curl-argv"
cat >> "$HOME/curl-stdin"
[ "${exitCode}" -ne 0 ] && exit ${exitCode}
printf '%s\\n%s' ${JSON.stringify(body)} ${JSON.stringify(status)}
exit 0
`, { mode: 0o755 });
}

/** Per-account status/body, keyed off the URL query the probe is NOT allowed to
 *  vary — so instead the fake reads `$HOME/next-<n>` in call order. */
function plantCurlSequence(rows: Array<{ status: string; body?: string; exit?: number }>): void {
  const bin = j('.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  rows.forEach((r, i) => {
    fs.writeFileSync(j(`resp-${i}`), `${r.exit ?? 0}\n${r.status}\n${r.body ?? ''}`);
  });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/curl-argv"
cat >> "$HOME/curl-stdin"
n=$(wc -l < "$HOME/curl-argv"); n=$((n - 1))
f="$HOME/resp-$n"
[ -f "$f" ] || { printf '\\n000'; exit 7; }
{ IFS= read -r rc; IFS= read -r st; body=$(cat); } < "$f"
[ "$rc" -ne 0 ] && exit "$rc"
printf '%s\\n%s' "$body" "$st"
exit 0
`, { mode: 0o755 });
}

const token = (id: string, value = 'sk-ant-oat01-FIXTURE'): void => {
  fs.mkdirSync(j('.cc-secrets'), { recursive: true });
  fs.writeFileSync(j('.cc-secrets', `${id}-oauth.env`),
    `export CLAUDE_CODE_OAUTH_TOKEN=${value}\n`, { mode: 0o600 });
};

const marker = (id: string): string => j('.cc-sessions', `${id}-authdead`);
const markerBody = (id: string): string => fs.readFileSync(marker(id), 'utf8');

function run(env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [PROBE], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home,
           PATH: `${j('.local', 'bin')}:${process.env['PATH'] ?? ''}`,
           CCRC_HEALTH_URL: 'https://fixture.invalid/api/oauth/usage', ...env },
  });
}

beforeEach(() => {
  home = mkTmp('ccrc-account-health-');
  fs.mkdirSync(j('.cc-sessions'), { recursive: true });
  fs.mkdirSync(j('.ccrc'), { recursive: true });
  fs.writeFileSync(j('.ccrc', 'accounts.json'), JSON.stringify(ROSTER, null, 2));
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('the four-outcome classifier', () => {
  it('401 is DEAD: writes "<epoch> auth-401"', () => {
    token('claude'); token('claude-a');
    plantCurl('401', '{"type":"error","error":{"type":"authentication_error"}}');
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
    expect(markerBody('claude')).toMatch(/^\d+ auth-401$/);
  });

  it('403 naming oauth_scope_insufficient is LIVE: clears a standing marker', () => {
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    plantCurl('403', '{"type":"error","error":{"type":"oauth_scope_insufficient"}}');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(false);
  });

  it('429 is UNMEASURED: writes nothing', () => {
    token('claude'); token('claude-a');
    plantCurl('429', '{"type":"error","error":{"type":"rate_limit_error"}}');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(false);
  });

  it('429 is UNMEASURED: CLEARS NOTHING EITHER — a standing marker survives', () => {
    // The half that is easy to get wrong and expensive to get wrong: a probe
    // that cleared on every non-401 would erase a true verdict every time the
    // fleet was merely busy.
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    plantCurl('429');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
    expect(markerBody('claude')).toBe('1757203200 auth-401');
  });

  it('a network failure is UNMEASURED in both directions', () => {
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    plantCurl('000', '', 7);
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
  });

  it('a 403 that does NOT name oauth_scope_insufficient is UNMEASURED, not live', () => {
    // A 403 is proof of authentication only when it is the scope refusal E1
    // measured. Any other 403 is an observation this probe does not understand,
    // and an unrecognised observation may not clear a standing verdict.
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    plantCurl('403', '{"type":"error","error":{"type":"permission_error"}}');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
  });

  it('a missing token file REFUSES: no request, no marker, and it says so', () => {
    token('claude-a');
    plantCurl('401', '{"type":"error","error":{"type":"authentication_error"}}');
    const r = run();
    expect(r.status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(false);
    expect(r.stderr).toMatch(/claude: refused — no readable token/);
    // exactly ONE request went out: claude-a's. The refusal is BEFORE the wire.
    expect(fs.readFileSync(j('curl-argv'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('an EMPTY token file REFUSES — this is E4, the reason the fourth row exists', () => {
    token('claude', '');
    token('claude-a');
    plantCurl('429', '{"type":"error","error":{"type":"rate_limit_error"}}');
    const r = run();
    expect(fs.existsSync(marker('claude'))).toBe(false);
    expect(r.stderr).toMatch(/claude: refused — no readable token/);
    expect(fs.readFileSync(j('curl-argv'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('classifies each account independently', () => {
    token('claude'); token('claude-a');
    plantCurlSequence([
      { status: '401', body: '{"error":{"type":"authentication_error"}}' },
      { status: '403', body: '{"error":{"type":"oauth_scope_insufficient"}}' },
    ]);
    fs.writeFileSync(marker('claude-a'), '1757203200 auth-401');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });
});

describe('eligibility is roster-derived', () => {
  it('probes only telemetry:anthropic accounts — gpt is never asked', () => {
    token('claude'); token('claude-a'); token('gpt');
    plantCurl('403', '{"error":{"type":"oauth_scope_insufficient"}}');
    run();
    expect(fs.readFileSync(j('curl-argv'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('names no account: swapping the roster swaps the subject', () => {
    fs.writeFileSync(j('.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [
      { id: 'other-one', label: 'x', configDirSuffix: '.x', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    ] }));
    token('other-one');
    plantCurl('401', '{"error":{"type":"authentication_error"}}');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('other-one'))).toBe(true);
  });

  it('refuses the whole pass when the roster cannot be read', () => {
    fs.rmSync(j('.ccrc', 'accounts.json'));
    plantCurl('403');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no roster at \$HOME\/\.ccrc\/accounts\.json/);
  });

  it('refuses an id that is not a legal account id rather than naming a file after it', () => {
    fs.writeFileSync(j('.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [
      { id: '../escape', telemetry: 'anthropic' },
    ] }));
    plantCurl('401');
    const r = run();
    expect(r.stderr).toMatch(/not a legal account id/);
    expect(fs.readdirSync(j('.cc-sessions'))).toEqual([]);
  });
});

describe('the secrets contract', () => {
  it('the token never reaches argv', () => {
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a', 'sk-ant-oat01-SENTINEL');
    plantCurl('403', '{"error":{"type":"oauth_scope_insufficient"}}');
    run();
    expect(fs.readFileSync(j('curl-argv'), 'utf8')).not.toContain('SENTINEL');
  });

  it('the token DOES reach curl, on stdin — otherwise the pass measures nothing', () => {
    // The other half. Without it the assertion above is satisfied by a probe
    // that forgot to authenticate at all.
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a');
    plantCurl('403', '{"error":{"type":"oauth_scope_insufficient"}}');
    run();
    expect(fs.readFileSync(j('curl-stdin'), 'utf8')).toContain('SENTINEL');
  });

  it('the token never reaches stdout or stderr', () => {
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a', 'sk-ant-oat01-SENTINEL');
    plantCurl('401', '{"error":{"type":"authentication_error"}}');
    const r = run();
    expect(r.stdout).not.toContain('SENTINEL');
    expect(r.stderr).not.toContain('SENTINEL');
  });

  it('the token never reaches the marker', () => {
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a');
    plantCurl('401', '{"error":{"type":"authentication_error"}}');
    run();
    expect(markerBody('claude')).not.toContain('SENTINEL');
  });
});

describe('pass discipline', () => {
  it('a pause file stops the pass before any request', () => {
    token('claude'); token('claude-a');
    plantCurl('401');
    fs.writeFileSync(j('.ccrc', 'account-health-paused'), '');
    expect(run().status).toBe(0);
    expect(fs.existsSync(j('curl-argv'))).toBe(false);
  });

  it('writes a marker atomically — never a partial file another reader can see', () => {
    // `_authdead`'s digits gate already refuses a half-written marker, so this
    // asserts the writer's half of that pair: the file arrives by rename, so
    // the only two states a reader can observe are absent and complete.
    token('claude'); token('claude-a');
    plantCurl('401', '{"error":{"type":"authentication_error"}}');
    run();
    expect(fs.readdirSync(j('.cc-sessions')).filter((n) => n.includes('.tmp'))).toEqual([]);
    expect(markerBody('claude')).toMatch(/^\d+ auth-401$/);
  });
});

describe('the account-id grammar is not a third independent copy', () => {
  // `shared/roster.ts`'s ID_RE is module-private and `ccd/ccrc-wrapper-shape`'s
  // WRAPPER_ID_RE is the bash spelling of it. This probe needs a third, because
  // it is installed alone into $HOME/.local/bin with no library beside it to
  // source (the same reason `session-hook.sh` carries its own epoch copy). The
  // tree's answer to a value two files cannot share is to MEASURE the agreement
  // — `pool-name-parity.test.ts`'s shape — rather than to trust a comment.
  const literal = (file: string, name: string): string => {
    const m = new RegExp(`^${name}='([^']+)'$`, 'm').exec(fs.readFileSync(file, 'utf8'));
    expect(m, `${file} declares no bare ${name}= literal — this pin went blind`).not.toBeNull();
    return m![1]!;
  };

  it('the probe spells the same account-id grammar as ccrc-wrapper-shape', () => {
    expect(literal(PROBE, 'AH_ID_RE')).toBe(literal(SHAPE, 'WRAPPER_ID_RE'));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/account-health.test.ts
```

Expected: every case fails. `spawnSync('bash', [PROBE])` on a path that does not exist gives
`r.status === 127` and a `bash: …/ccd/ccd-account-health: No such file or directory` on stderr, so the
status assertions read `expected 127 to be 0` and the `existsSync` assertions read `expected false to
be true`. **Record the actual output.**

- [ ] **Step 3: Write the probe**

Create `ccd/ccd-account-health` (mode 755):

```bash
#!/usr/bin/env bash
# ccd-account-health — is each Anthropic account's credential still alive?
#
# WHY THIS IS A SIBLING EXECUTABLE AND NOT CODE INSIDE `ccd`. `ccd/ccd` makes
# ZERO outbound network calls — measured, one `curl` in 13k+ lines and it is
# inside a comment. An HTTP client there would be a new dependency class for
# every session-supervising path on the box. Beside it is not: this repo already
# ships several curl-using scripts, each with its own argued failure contract.
#
# THE ORACLE, and why an endpoint that cannot answer is still useful. The usage
# endpoint AUTHENTICATES BEFORE it checks scope, so a setup token — which is what
# every account on this fleet uses — gets 403 `oauth_scope_insufficient` while an
# invalid or malformed bearer gets 401. That pair is the whole measurement:
# 401 = dead, 403-scope = live. THE TRAP: an EMPTY bearer answers 429, not an
# auth error, so "not 403" can never mean dead — which is why a missing or empty
# token file REFUSES here, before anything goes on the wire.
#
# FOUR OUTCOMES:
#   401 ...................................... dead      -> write the marker
#   403 naming oauth_scope_insufficient ...... live      -> clear the marker
#   429 / any other status / network / timeout unmeasured -> write NOTHING,
#                                                            CLEAR NOTHING
#   token file missing or empty ............... refuse    -> report, no request
#
# The third row's second half is the one to protect: a standing verdict survives
# a pass that could not measure. A probe that cleared on every non-401 would
# erase a true fault every time the fleet was merely busy.
#
# SECRETS. There is no `EnvironmentFile=` on this unit and there cannot be:
# `ccrc-ddns.service` expands ONE credential from ONE 0600 file, and this reads N
# — one per account. The half of that pattern that binds is enforced here
# instead: the 0644 unit names no credential and no path into ~/.cc-secrets; each
# token is sourced in a SUBSHELL so no export survives into this process (and so
# never into curl's environ); it reaches curl on STDIN via `-K -`, never in argv,
# so it is never in the process table; and it is never echoed, never logged, and
# the body is classified and discarded.
#
# HOME-derived roots with no override, exactly as ccd and ccd-graph-sweep derive
# theirs: HOME is the harness's single isolation boundary. Every other knob IS
# env-overridable, for the harness (the CCRC_DOCTOR_GH_TIMEOUT precedent).
#
# PORTABILITY: no bare `timeout` (the deadline is curl's own `--max-time`), no
# template-less `mktemp`, no `stat -c`, no `date +%s%3N`. `macos-platform.test.ts`
# derives its corpus from every shebang'd file in ccd/, so this file is scanned
# from the moment it exists and is meant to stay in the OWNED half of that list.
set -uo pipefail

REG="$HOME/.cc-sessions"
SECRETS_DIR="$HOME/.cc-secrets"
ROSTER="$HOME/.ccrc/accounts.json"
PAUSE="$HOME/.ccrc/account-health-paused"
LOCK="$HOME/.ccrc/account-health.lock"
: "${CCRC_HEALTH_URL:=https://api.anthropic.com/api/oauth/usage}"
: "${CCRC_HEALTH_TIMEOUT:=20}"
# The account-id grammar. A THIRD spelling of `shared/roster.ts`'s ID_RE, after
# `ccd/ccrc-wrapper-shape`'s WRAPPER_ID_RE — unavoidable, because this file is
# installed ALONE into $HOME/.local/bin with no library beside it to source, the
# same situation `session-hook.sh` is in. It is MEASURED rather than trusted:
# `account-health.test.ts` extracts this literal and WRAPPER_ID_RE's and holds
# them equal. It is load-bearing twice — an id becomes a FILENAME under $REG and
# under ~/.cc-secrets, and it is printed at an operator on a terminal that acts
# on control bytes.
AH_ID_RE='^[a-z][a-z0-9-]{0,31}$'

_ah_say() { printf 'account-health: %s\n' "$1" >&2; }

# THE CONVENTION, SPELLED ONCE IN THIS FILE. The roster structurally cannot
# declare where an `upstream` account's credential lives — `exec.secretsFile` is
# permitted only on `kind: 'generated'` (shared/roster.ts) — so a roster-driven
# path would cover the generated accounts and SILENTLY SKIP the primary one. The
# convention covers all of them; `ccrc doctor`'s `credentials` check is what
# makes an absent file loud rather than invisible.
_ah_token_file() { printf '%s/%s-oauth.env' "$SECRETS_DIR" "$1"; }

# The token, read in a SUBSHELL (command substitution) so the file's own
# `export` dies with it and this process never carries the value in its
# environment. Empty output means "no usable token" for BOTH an unreadable file
# and a file that sets nothing — one answer, because the probe does the same
# thing about each and the caller has already told absence from presence.
_ah_token() {   # <token-file> -> the bearer, or nothing
  ( set +u
    # shellcheck source=/dev/null
    . "$1" >/dev/null 2>&1 || exit 0
    printf '%s' "${CLAUDE_CODE_OAUTH_TOKEN:-}" )
}

# The marker, by rename. `_authdead`'s digits gate already refuses a half-written
# stamp; this is the writer's half of that pair, so the only two states any
# reader can observe are absent and complete. The template carries XXXXXX (BSD
# mktemp ignores a template-less call's TMPDIR) and the temp lands in $REG, so
# the rename never crosses a filesystem. `.tmp.` in the name is DOTTED on
# purpose: a crashed pass leaves something the registry's own one-dot rule will
# not confuse with a field, and the next pass's `rm -f` sweeps it.
_ah_mark() {   # <id> <reason>
  local tmp
  tmp="$(mktemp "$REG/$1-authdead.tmp.XXXXXX")" || { _ah_say "$1: cannot stage a marker"; return 1; }
  printf '%s %s' "$(date +%s)" "$2" > "$tmp" \
    && mv -f "$tmp" "$REG/$1-authdead" \
    || { rm -f "$tmp"; _ah_say "$1: cannot write the marker"; return 1; }
}

_ah_clear() { rm -f "$REG/$1-authdead"; }

# ── the pass ──────────────────────────────────────────────────────────────
exec 9>"$LOCK"
# A held lock means the previous pass is still running. A probe is a reading, so
# a skipped pass costs nothing but 15 minutes — the sweep's `pass-locked` shape.
flock -n 9 || exit 0
[ -e "$PAUSE" ] && exit 0
rm -f -- "$REG"/*-authdead.tmp.* 2>/dev/null

command -v curl >/dev/null 2>&1 \
  || { _ah_say "curl is not on PATH — nothing was measured"; exit 1; }
command -v jq >/dev/null 2>&1 \
  || { _ah_say "jq is not on PATH — nothing was measured"; exit 1; }
[ -r "$ROSTER" ] \
  || { _ah_say 'no roster at $HOME/.ccrc/accounts.json — nothing says which accounts exist'; exit 1; }

IDS="$(jq -r '.accounts[]? | select(.telemetry == "anthropic") | .id // empty' "$ROSTER" 2>/dev/null)" \
  || { _ah_say 'the roster at $HOME/.ccrc/accounts.json does not parse — nothing was measured'; exit 1; }

for id in $IDS; do
  if [[ ! "$id" =~ $AH_ID_RE ]]; then
    # Refused BY NAME rather than looked for on disk: an id outside the grammar
    # could name a file this probe has no business writing.
    _ah_say "an account id in the roster is not a legal account id ($AH_ID_RE) — skipped"
    continue
  fi
  f="$(_ah_token_file "$id")"
  tok=""
  # `-s` IS A SHORT-CIRCUIT, NOT A GUARD, and saying so is the honest version:
  # `_ah_token` already prints nothing for a file it cannot source, so deleting
  # this test changes no observable behaviour — it only skips a subshell. The
  # refusal below is what actually decides, which is why the mutation table
  # bites THAT and not this line.
  [ -s "$f" ] && tok="$(_ah_token "$f")"
  if [ -z "$tok" ]; then
    # THE FOURTH OUTCOME. Not a verdict about the account — a verdict about this
    # box's own configuration, and the reason `ccrc doctor` carries a
    # `credentials` check: absence must be loud, never a silent skip.
    _ah_say "$id: refused — no readable token at \$HOME/.cc-secrets/$id-oauth.env"
    continue
  fi
  # Body and status in ONE capture, so there is no response file on disk at all.
  # `-K -` reads the Authorization header from stdin: never argv, never environ.
  out="$(printf 'header = "Authorization: Bearer %s"\n' "$tok" \
    | curl -sS -K - -o - -w '\n%{http_code}' --max-time "$CCRC_HEALTH_TIMEOUT" \
      "$CCRC_HEALTH_URL" 2>/dev/null)"; rc=$?
  tok=""
  status="${out##*$'\n'}"
  body="${out%$'\n'*}"
  if [ "$rc" -ne 0 ]; then
    _ah_say "$id: unmeasured — curl exited $rc"
  elif [ "$status" = 401 ]; then
    _ah_mark "$id" auth-401 && _ah_say "$id: dead (401)"
  elif [ "$status" = 403 ] && [[ "$body" == *oauth_scope_insufficient* ]]; then
    _ah_clear "$id"; _ah_say "$id: live (403 scope)"
  else
    # 429 is the loud member of this class and the reason the class exists, but
    # every unrecognised answer belongs here — including a 403 that is NOT the
    # scope refusal, which is proof of nothing. Write nothing; CLEAR NOTHING.
    _ah_say "$id: unmeasured — HTTP $status"
  fi
done
exit 0
```

- [ ] **Step 4: Make it executable and run the test**

```bash
cd "$(git rev-parse --show-toplevel)" && chmod 755 ccd/ccd-account-health
cd server && ./node_modules/.bin/vitest run test/account-health.test.ts
```

Expected: 20 passed (9 classifier + 4 eligibility + 4 secrets + 2 pass-discipline + 1 id-grammar).

- [ ] **Step 5: Measure the mutations**

1. Change the unmeasured `else` arm to `else _ah_clear "$id"`, re-run: **two** cases go RED with
   `expected false to be true` — "429 is UNMEASURED: CLEARS NOTHING EITHER" and "a 403 that does NOT
   name oauth_scope_insufficient is UNMEASURED, not live". Restore. Two cases DELIBERATELY stay
   green and it is worth knowing why before you go hunting: "429 is UNMEASURED: writes nothing" has
   no standing marker to clear, and the network case is a **separate branch** (`if [ "$rc" -ne 0 ]`)
   the `else` mutation never reaches.
2. That network branch is therefore its own measurement: change `_ah_say "$id: unmeasured — curl
   exited $rc"` to `_ah_clear "$id"; _ah_say "$id: unmeasured — curl exited $rc"`, re-run: "a network
   failure is UNMEASURED in both directions" goes RED with `expected false to be true`. Restore.
3. Delete the whole `if [ -z "$tok" ]; then … continue; fi` block, re-run: **both** refusal cases go
   RED. "A missing token file REFUSES" reds first on the marker — an empty bearer answered 401 and
   the probe condemned an account on nothing (`expected true to be false`); "an EMPTY token file
   REFUSES" reds on the message (`expected '' to match /claude: refused — no readable token/`), the
   E4 shape, where 429 leaves no marker but the refusal never happened either. Restore. **Note what
   this replaces:** deleting `[ -s "$f" ] &&` alone measures nothing — for a missing file `_ah_token`
   fails to source and prints nothing, and the fixture's "empty" token file is
   `export CLAUDE_CODE_OAUTH_TOKEN=\n`, which is non-empty on disk so `-s` is true anyway. The
   refusal is the guard; the `-s` is a short-circuit, and the probe's comment now says so.
4. Move the token onto the command line — replace the `printf … | curl -sS -K -` pipeline with
   `curl -sS -H "Authorization: Bearer $tok" …` — re-run: "the token never reaches argv" goes RED
   with `expected '… SENTINEL …' not to contain 'SENTINEL'`. Restore.

Record all four.

- [ ] **Step 6: Confirm the file joined the portability corpus cleanly**

```bash
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts
```

Expected: pass, with `ccd-account-health` now appearing as one of the DERIVED corpus entries and
**no** entry added to `unowned`. `macos-platform.test.ts:175-180` builds that corpus from every
shebang'd file in `ccd/`, so this suite adopts the new file automatically; if it reds naming a
GNU-only spelling, fix the probe rather than adding it to `unowned` — every construct it uses was
chosen off that table (`macos-platform.test.ts:108-127`).

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd-account-health server/test/account-health.test.ts
git commit -m "feat(ccd): a credential-liveness probe with four outcomes, beside ccd and not inside it (D-TBD-authhealth-403-body, D-TBD-authhealth-id-re, D-TBD-authhealth-ddns-pattern)

401 = dead, 403-scope = live, everything else = unmeasured (write nothing, CLEAR
nothing), and a missing or empty token file REFUSES before the wire — spec E4
measured an empty bearer answering 429, so \"not 403\" can never mean dead.

The token reaches curl on stdin via -K -, sourced in a subshell: never argv,
never this process's environ, never a log line. A 403 that does not name
oauth_scope_insufficient is unmeasured, not live.

Mutations measured, four: clearing on the unmeasured else-arm reds 2; clearing on
the separate network branch reds 1; deleting the refusal block reds both refusal
cases; moving the bearer into argv reds 1."
```

---

### Task 5: The unit pair, and the three deploy.sh edits

**Files:**
- Create: `deploy/systemd/ccd-account-health.service`
- Create: `deploy/systemd/ccd-account-health.timer`
- Modify: `deploy/deploy.sh` (`:640` area, `:679`, `:763`)
- Modify: `agent/test/deploy-verify.test.ts`

**Interfaces:**
- Consumes: `ccd/ccd-account-health` from Task 4, installed at `~/.local/bin/ccd-account-health`.
- Produces: `ccd-account-health.timer` enabled on the fleet host after `daemon-reload`.

- [ ] **Step 1: Write the failing test**

In `agent/test/deploy-verify.test.ts`, make four edits.

(a) In the `install_atomic` ordered list at `:505-510`, after the `ccd/ccd` row:

```typescript
      'install_atomic ccd/ccd .local/bin/ccd',
      'install_atomic deploy/notify.sh .cc-sessions/notify.sh',
```

leave that list alone, and instead extend the deploy-dir file list at `:527-531`:

```typescript
      'systemd/ccd-cap-scopes.service',
      'systemd/ccd-cap-scopes.timer',
      'systemd/ccd-graph-sweep.service',
      'systemd/ccd-graph-sweep.timer',
      // The account-health probe's pair (spec 2026-09-07 §A.7), mirroring the
      // sweep's exactly: a `Type=oneshot` unit and a 15-minute timer.
      'systemd/ccd-account-health.service',
      'systemd/ccd-account-health.timer',
```

(b) Beside the two `existsSync` script checks at `:535-538`:

```typescript
    expect(existsSync(path.join(deployDir, '..', 'ccd', 'ccd-account-health')),
      'the account-health probe is not in the repo').toBe(true);
```

(c) In the `AGENT_BUILD_CMD` needle list at `:555-557`:

```typescript
      'cp ~/ccrc/deploy/systemd/ccd-account-health.service ~/ccrc/deploy/systemd/ccd-account-health.timer ~/.config/systemd/user/',
```

(d) After the graph-sweep enable check at `:574-577`:

```typescript
    // A third timer, needing the same daemon-reload to have already picked up
    // the unit AGENT_BUILD_CMD installed.
    const healthTimerAt = restartLinks.findIndex((l) => l.includes('enable --now ccd-account-health.timer'));
    expect(healthTimerAt, 'the account-health timer is never enabled').toBeGreaterThan(reloadAt);
```

(e) Beside the two `toContain` install lines at `:592-593`:

```typescript
    expect(deploySh).toContain('install_atomic ccd/ccd-account-health .local/bin/ccd-account-health 755');
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```

Expected: **ONE** red test, not five. All five edits land inside the single
`it('the agent deploy installs every systemd artifact the fleet host actually runs', …)`
(`agent/test/deploy-verify.test.ts:516-596`), so vitest reports one failing test and stops at its
first failing assertion — the `existsSync` loop at `:533`:

```
systemd/ccd-account-health.service is not in the repo: expected false to be true
```

The other four assertions are **unreached** until that one is green, so walk them one at a time:
re-run after each part of Step 3 and Step 4 and read the next message the same `it` produces —
`AGENT_BUILD_CMD does not install: cp ~/ccrc/deploy/systemd/ccd-account-health.service …`, then
`the account-health timer is never enabled: expected -1 to be greater than <reloadAt>`, then
`expected '…' to contain 'install_atomic ccd/ccd-account-health .local/bin/ccd-account-health 755'`.

Edit (b) — the `ccd/ccd-account-health` repo-existence check — **passes from the start**, because
Task 4 already created that file. It is a pin against a later task deleting the probe, not a red half
of this task's table. **Record the actual output.**

- [ ] **Step 3: Write the unit pair**

Create `deploy/systemd/ccd-account-health.service`:

```ini
[Unit]
Description=Probe each Anthropic account's credential for liveness (spec 2026-09-07 §A)
[Service]
Type=oneshot
# NO EnvironmentFile=, deliberately, and this is where the ccrc-ddns pattern
# stops applying: that unit expands ONE credential from ONE 0600 file, and this
# probe reads N — one ~/.cc-secrets/<id>-oauth.env per account. The half that
# still binds is what the executable enforces instead: this 0644 file names no
# credential and no path into ~/.cc-secrets, and the token never reaches argv,
# this unit's environment, or any log line.
ExecStart=%h/.local/bin/ccd-account-health
# One curl per eligible account at --max-time 20, plus a lock probe; a pass past
# this is wedged, not slow.
TimeoutStartSec=300
```

Create `deploy/systemd/ccd-account-health.timer`:

```ini
[Unit]
Description=Probe account credential liveness every 15 minutes
# No Unit= line: systemd's default — the same-named .service — is the single
# source of that pairing, exactly as ccrc-ddns.timer records.
[Timer]
# 7min rather than the sweep's 5: two oneshots that both fire at boot and both
# want the network are a herd of two, and this one has nothing urgent to say in
# the first minutes of an uptime.
OnBootSec=7min
OnUnitActiveSec=15min
AccuracySec=1min
[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Make the three deploy.sh edits**

(a) In `deploy/deploy.sh`, after the `install_atomic ccd/ccd-graph-sweep …` line at `:640`:

```bash
  # The account-health probe (spec 2026-09-07 §A). Ships beside the sweep and on
  # the same terms — a sibling executable, so `ccd` itself stays network-free.
  install_atomic ccd/ccd-account-health .local/bin/ccd-account-health 755
```

(b) In `AGENT_BUILD_CMD` at `:679`, append one `cp` to the chain (the last line loses its closing
quote, which moves to the new last line):

```bash
    && cp ~/ccrc/deploy/systemd/ccd-graph-sweep.service ~/ccrc/deploy/systemd/ccd-graph-sweep.timer ~/.config/systemd/user/ \
    && cp ~/ccrc/deploy/systemd/ccd-account-health.service ~/ccrc/deploy/systemd/ccd-account-health.timer ~/.config/systemd/user/'
```

(c) In `AGENT_CMD` at `:763`, after the graph-sweep enable:

```bash
    && systemctl --user enable --now ccd-graph-sweep.timer \
    && systemctl --user enable --now ccd-account-health.timer \
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```

Expected: the whole file passes.

- [ ] **Step 6: Measure the mutation**

Move the `enable --now ccd-account-health.timer` line from `AGENT_CMD` into `AGENT_BUILD_CMD`, re-run:
the ordering case reds with `the account-health timer is never enabled: expected -1 to be greater
than …` **and** `deploy-verify.test.ts:562`'s "daemon-reload must not run in the build half" stays
green, which is the point — the ordering guarantee is structural (two ssh calls, `set -euo pipefail`),
not textual. Restore, then delete the `install_atomic` line and confirm the `toContain` case reds.
Record both.

- [ ] **Step 7: Commit**

```bash
git add deploy/systemd/ccd-account-health.service deploy/systemd/ccd-account-health.timer \
        deploy/deploy.sh agent/test/deploy-verify.test.ts
git commit -m "feat(deploy): ship the account-health probe and its 15-minute timer to the fleet host

Three coordinated edits deploy-verify text-scans: install_atomic of the
executable, the unit pair inside AGENT_BUILD_CMD, and the enable inside
AGENT_CMD after daemon-reload. The unit carries no EnvironmentFile — N
per-account secrets is where the ccrc-ddns pattern stops.

Mutations measured: moving the enable into the build half reds the ordering
case; dropping the install_atomic reds the toContain case."
```

---

### Task 6: `ccrc install` and `ccrc uninstall`

**Files:**
- Modify: `ccd/ccrc` (`_inst_bins` `:4448-4458`, `_inst_units` `:4840-4845`, `_inst_enable`
  `:4905-4910` — its enable only, NOT its transcript line at `:4945`, `_uninst_units` `:6191`,
  `_uninst_tree_bins` `:6412-6425`)
- Modify: `deploy/gen-wrappers.mjs` (`:160`)
- Modify: `server/test/ccrc-install.test.ts`, `server/test/ccrc-uninstall.test.ts`,
  `server/test/gen-wrappers.test.ts`

**Interfaces:**
- Consumes: `ccd/ccd-account-health` and the unit pair from Tasks 4 and 5.
- Produces: on a non-Darwin box `~/.local/bin/ccd-account-health`; on a non-server role the unit pair
  in `$HOME/.config/systemd/user` and an enabled `ccd-account-health.timer`; and both removed by
  `ccrc uninstall`.

- [ ] **Step 1: Write the failing test**

Five edits, each mirroring the graph-sweep row beside it.

(a) `server/test/ccrc-install.test.ts`, the tree file list at `:147`:

```typescript
  'ccd/ccd-graph-sweep',
  // The account-health probe (spec 2026-09-07 §A): `_inst_bins` ships it beside
  // the sweep, on the same gate — not Darwin, every role.
  'ccd/ccd-account-health',
```

(b) `server/test/ccrc-install.test.ts`, `UNIT_FILES` at `:2292-2293`:

```typescript
  ['ccd-graph-sweep.service', 'deploy/systemd/ccd-graph-sweep.service'],
  ['ccd-graph-sweep.timer', 'deploy/systemd/ccd-graph-sweep.timer'],
  // ROLE-GATED on the sweep's exact terms: a server box holds no wrapper HOMEs
  // and no ~/.cc-secrets, so it has no credential to probe.
  ['ccd-account-health.service', 'deploy/systemd/ccd-account-health.service'],
  ['ccd-account-health.timer', 'deploy/systemd/ccd-account-health.timer'],
```

(c) `server/test/ccrc-install.test.ts`, the two enable-argv lists at `:2417` and `:3523`, one line
after `'--user enable --now ccd-graph-sweep.timer',` in each:

```typescript
      '--user enable --now ccd-account-health.timer',
```

(d) `server/test/ccrc-install.test.ts`, the `.local/bin` census at `:2830`:

```typescript
      .toEqual(process.platform === 'darwin'
        ? ['ccd', 'ccrc', 'graphify']
        : ['ccd', 'ccd-account-health', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccrc', 'graphify']);
```

and the role-server exclusion at `:3541-3546`:

```typescript
    for (const [dest] of UNIT_FILES) {
      if (dest.startsWith('ccd-graph-sweep.') || dest.startsWith('ccd-account-health.')) continue;
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-account-health.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-account-health.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-graph-sweep');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-account-health');
```

(e) `server/test/ccrc-uninstall.test.ts`: in `plantInstalledBox`, beside the graph-sweep binary at
`:122` and inside the unit list at `:147`:

```typescript
  writeFileSync(join(bin, 'ccd-account-health'), '#!/bin/sh\n# account health\n', { mode: 0o755 });
```

```typescript
    'ccd-graph-sweep.service', 'ccd-graph-sweep.timer',
    'ccd-account-health.service', 'ccd-account-health.timer']) {
```

then the same two unit names in the list at `:318`, one more assertion beside `:328`:

```typescript
    expect(calls).toContain('--user disable --now ccd-account-health.timer');
```

and the removal set at `:477`:

```typescript
    for (const b of ['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-account-health', 'graphify']) {
```

(f) `server/test/gen-wrappers.test.ts`, both name lists at `:280` and `:286`:

```typescript
    for (const name of ['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-account-health']) {
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts test/ccrc-uninstall.test.ts test/gen-wrappers.test.ts
```

Expected reds, by file: `ccrc-install` fails the tree-file case (`ccd/ccd-account-health` is in the
fixture list but `_inst_tree` copies it and nothing installs it — the unit-file case reads
`expected false to be true, ccd-account-health.service`), both enable-argv equality cases (`expected
[ … ] to deep equal [ … ]` with the health enable missing), and the `.local/bin` census. `gen-wrappers`
fails with the toolchain name reported as an orphan wrapper. `ccrc-uninstall` fails on
`ccd-account-health survived: expected true to be false` and on the missing disable call.
**Record the actual output.**

- [ ] **Step 3: `_inst_bins`**

In `ccd/ccrc`, inside `_inst_bins`' `if [ "$CCD_OS" != darwin ]` block, after the
`_inst_atomic "$tree/ccd/ccd-graph-sweep" …` line:

```bash
    # The account-health probe, on the sweep's exact terms: every ROLE, but not
    # Darwin — its only runner is a systemd timer, and a binary whose runner
    # never fires would be the same no-op cap-scopes' own comment warns about.
    # `deploy/gen-wrappers.mjs`'s `TOOLCHAIN_EXECUTABLES` knows the name, or the
    # orphan scan in `_inst_wrappers` (every role) would report it.
    _inst_atomic "$tree/ccd/ccd-account-health" "$bin/ccd-account-health" 755
```

and update the two transcript lines at the end of the function:

```bash
  if [ "$CCD_OS" = darwin ]; then
    echo "install: bins: ccd and the ccrc launcher in \$HOME/.local/bin (no ccd-cap-scopes — it caps cgroup scopes, and macOS has none; no ccd-graph-sweep and no ccd-account-health — their timers are systemd-only)"
  else
    echo "install: bins: ccd, ccd-cap-scopes, ccd-graph-sweep, ccd-account-health and the ccrc launcher in \$HOME/.local/bin"
  fi
```

- [ ] **Step 4: `_inst_units` and `_inst_enable`**

In `_inst_units`, inside the existing `if [ "$INST_ROLE" != server ]; then` block, after the two
graph-sweep lines:

```bash
    # The account-health probe's pair, role-gated for its own reason rather than
    # by imitation: a server box holds no wrapper HOMEs and no ~/.cc-secrets, so
    # there is no credential on it to measure.
    _inst_atomic "$tree/deploy/systemd/ccd-account-health.service" "$dir/ccd-account-health.service" 644
    _inst_atomic "$tree/deploy/systemd/ccd-account-health.timer" "$dir/ccd-account-health.timer" 644
```

In `_inst_enable`, after the graph-sweep enable line:

```bash
  # Same gate, same DEGRADE-rather-than-die idiom as the sweep above it: a
  # health probe is a reading, not the guardrail `ccd-cap-scopes.timer` is, so a
  # systemd that will not take this one timer must not turn an otherwise
  # converged install into a failed one.
  [ "$INST_ROLE" = server ] || systemctl --user enable --now ccd-account-health.timer \
    || echo "install: account-health: could not enable ccd-account-health.timer — run: systemctl --user enable --now ccd-account-health.timer" >&2
```

**Do NOT touch that function's closing transcript line** (`ccd/ccrc:4945`), and the reason is two
separate measurements, both of which point the same way.

First, it is pinned VERBATIM in two places, neither of which this plan otherwise edits:
`server/test/ccrc-install.test.ts:2490` (an anchored regex over the server transcript) and `:3462`
(a `toContain` over the fleet-box one). Rewriting the line reds both, and Step 6 below says this
task ends green.

Second — and this is why the answer is "leave it" rather than "edit the line and the two pins" — the
line already omits `ccd-graph-sweep.timer`, which `_inst_enable` also enables three lines above
(`ccd/ccrc:4909`). That is not an oversight to copy or to fix here: the sentence names the enables
that are entitled to **die** (`$main` and `ccd-cap-scopes.timer`, both under `_ccrc_die`), and the
two that **degrade** — the sweep's and this one's — are deliberately not promised by it. Adding
`ccd-account-health.timer` while leaving `ccd-graph-sweep.timer` out would make the transcript more
misleading, not less; adding both would rewrite a sentence about a feature this plan does not own.
The degrading enable announces itself on `stderr` when it fails, which is the channel that matters.

- [ ] **Step 5: `_uninst_units`, `_uninst_tree_bins`, `TOOLCHAIN_EXECUTABLES`**

In `_uninst_units`, extend the disable loop's list and the `rm -f` list:

```bash
    for u in "${BOX_UNIT_NAMES[@]}" ccd-cap-scopes.timer ccd-cap-scopes.service \
      ccd-graph-sweep.timer ccd-graph-sweep.service \
      ccd-account-health.timer ccd-account-health.service; do
```

```bash
  rm -f -- "$dir/${BOX_UNIT_NAMES[0]}" "$dir/${BOX_UNIT_NAMES[1]}" \
    "$dir/claude-session@.service" "$dir/ccd-cap-scopes.service" "$dir/ccd-cap-scopes.timer" \
    "$dir/ccd-graph-sweep.service" "$dir/ccd-graph-sweep.timer" \
    "$dir/ccd-account-health.service" "$dir/ccd-account-health.timer" \
    || _ccrc_die "removing the unit files under $dir failed"
```

In `_uninst_tree_bins`, extend the `rm -f` and its transcript line:

```bash
  # `ccd-account-health` is the FIFTH ccrc-OWNED executable, and the rule the
  # four above it follow binds here identically: an uninstall that removed its
  # units and left the binary orphans it on PATH for ever. (`graphify`, below,
  # keeps its own rule and its own paragraph — it is the SIXTH entry in this
  # census and the only one that is not ccrc's own binary.)
  rm -f -- "$HOME/.local/bin/ccd" "$HOME/.local/bin/ccrc" "$HOME/.local/bin/ccd-cap-scopes" \
    "$HOME/.local/bin/ccd-graph-sweep" "$HOME/.local/bin/ccd-account-health" \
    || _ccrc_die "removing the executables from \$HOME/.local/bin failed"
  echo "uninstall: tree: ~/ccrc removed; ccd, ccd-cap-scopes, ccd-graph-sweep, ccd-account-health and the ccrc launcher removed from \$HOME/.local/bin"
```

and, so the file's own numbering stays coherent, change the graphify paragraph's header immediately
below it (`ccd/ccrc:6425`) from `# ── the FIFTH entry, and the only one that is not ccrc's own
binary ──────` to:

```bash
  # ── the SIXTH entry, and the only one that is not ccrc's own binary ──────
```

Both are comments and neither is pinned by any suite (measured: the only occurrence of
`FIFTH entry` in the tree is that one line) — but leaving two "fifth"s in one census is exactly the
drift this file's own headers are written to prevent.

In `deploy/gen-wrappers.mjs:160`:

```javascript
const TOOLCHAIN_EXECUTABLES = new Set(['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-account-health']);
```

- [ ] **Step 6: Run the tests and verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts test/ccrc-uninstall.test.ts test/gen-wrappers.test.ts test/single-definition.test.ts test/macos-platform.test.ts
```

Expected: all five pass. If `ccrc-install.test.ts` reds on a list this plan did not name — the
`.local/bin` listings at `:1877` and `:3256` are the two most likely — extend that list the same way,
and record it as a Deviation rather than silently widening an assertion.

- [ ] **Step 7: Measure the mutation**

Delete the `_inst_atomic "$tree/ccd/ccd-account-health" …` line, re-run `ccrc-install.test.ts`:
the `.local/bin` census reds with `expected [ 'ccd', 'ccd-cap-scopes', … ] to deep equal
[ 'ccd', 'ccd-account-health', … ]`. Restore. Then delete the `_uninst_tree_bins` path and re-run
`ccrc-uninstall.test.ts`: `ccd-account-health survived: expected true to be false`. Restore. Record both.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccrc deploy/gen-wrappers.mjs server/test/ccrc-install.test.ts \
        server/test/ccrc-uninstall.test.ts server/test/gen-wrappers.test.ts
git commit -m "feat(ccrc): install and uninstall the account-health probe and its timer

Gated exactly as the graph-sweep pair is: the binary skips Darwin (its only
runner is a systemd timer), the units and the enable skip --role server (no
wrapper HOMEs, no ~/.cc-secrets, nothing to probe), and the enable DEGRADES
rather than dies — a reading is not the guardrail cap-scopes is.

Mutations measured: dropping the install reds the .local/bin census; dropping the
removal reds the uninstall's orphan case."
```

---

### Task 7: `ccrc doctor` — an absent token file is LOUD, and the new timer is a unit doctor asks about

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (the `CCRC_DOCTOR_CHECKS` table at `:166-195`; a new
  `_check_credentials` beside `_check_wrappers`; `_check_services`' `known` array at `:808` and its
  `*.timer` warn arm)
- Modify: `server/test/ccrc-doctor.test.ts` (`RosterEntry` `:260`, `UPSTREAM` `:268`, `healthy()`
  `:918-922`, plus two new describes)
- Modify: `server/test/single-definition.test.ts`

**Interfaces:**
- Consumes: the convention `.cc-secrets/<id>-oauth.env` and the eligibility rule
  `telemetry === 'anthropic'` — the same two facts `ccd/ccd-account-health` uses, in the second of the
  only two files allowed to spell them. Also the unit name `ccd-account-health.timer` from Tasks 5
  and 6, which is what makes it a unit this box is configured to run.
- Produces: a `credentials` verdict line. PASS when every eligible account has a non-empty token file;
  FAIL naming each that does not; SKIP when there is no readable roster or no eligible account. And a
  `services` check whose `known` array carries the new timer, so a stopped probe timer is a WARN with
  its own consequence sentence rather than a unit nothing on the box asks about.

**Why the `services` half is in this task and not deferred.** §A.7 asks for the timer's own doctor
coverage in one parenthesis: *"its own doctor check (doctor's generic `services` check asks about a
hardcoded three-name list a new timer would not be in)"*. Measured on `main` @ `58ef97b6`:
`ccd/ccrc-doctor-checks:808` is `local -a known=(ccrc.service ccrc-agent.service ccd-cap-scopes.timer)`
— exactly that hardcoded three-name list. `credentials` discharges §A.2 (the token convention), not
this. The two halves ship together because they touch the same two files.

- [ ] **Step 1: Write the failing test**

(a) In `server/test/ccrc-doctor.test.ts`, widen the fixture roster type and the upstream entry:

```typescript
interface RosterEntry {
  id: string;
  configDirSuffix?: string;
  exec: { kind: 'upstream' | 'generated' | 'external'; secretsFile?: string };
  /** Task: `credentials` reads it, and `healthy()`'s contract is that every
   *  check PASSES — so the fixture's one account has to be an account the check
   *  has something to measure about. `_check_wrappers`' own TSV reader ignores
   *  the field, so no existing case moves. */
  telemetry?: 'anthropic' | 'none';
}
```

```typescript
const UPSTREAM: RosterEntry = { id: 'claude', configDirSuffix: '.claude',
  exec: { kind: 'upstream' }, telemetry: 'anthropic' };
```

(b) In `healthy()`, immediately after `writeRoster(home, [UPSTREAM]);` at `:922`:

```typescript
  // …and its credential is where the convention says it is. A healthy box is one
  // where every check PASSES, and `credentials` measures exactly this: the
  // roster declares one telemetry:'anthropic' account, so there is one file it
  // must have. Contents are never read by the check (or by this fixture) —
  // existence and non-emptiness are the whole question.
  mkdirSync(join(home, '.cc-secrets'), { recursive: true });
  writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'),
    'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-real-token\n', { mode: 0o600 });
```

(c) Add a describe beside the `wrappers` block:

```typescript
describe('ccrc doctor: credentials', () => {
  it('passes on a healthy box and names what it measured', () => {
    const home = healthy('ccrc-doctor-cred-ok-');
    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 1 account/m);
  });

  it('goes red — LOUDLY — when an expected token file is absent', () => {
    // THE WHOLE REASON THIS CHECK EXISTS. The roster structurally cannot declare
    // where an `upstream` account's credential lives, so the probe derives the
    // path by convention. A convention with no measurement is a silent skip
    // waiting to happen: the probe would refuse that account for ever and the
    // only place saying so would be a journal nobody reads.
    const home = healthy('ccrc-doctor-cred-missing-');
    rmSync(join(home, '.cc-secrets', 'claude-oauth.env'));
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL credentials: claude/m);
    expect(r.stdout).toMatch(/\.cc-secrets\/claude-oauth\.env/);
  });

  it('goes red on an EMPTY token file — E4: an empty bearer answers 429, not an auth error', () => {
    const home = healthy('ccrc-doctor-cred-empty-');
    writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'), '');
    expect(runDoctor(home).stdout).toMatch(/^FAIL credentials: claude/m);
  });

  it('never prints a byte of the file', () => {
    const home = healthy('ccrc-doctor-cred-quiet-');
    writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'),
      'export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-SENTINEL\n');
    const r = runDoctor(home);
    expect(r.stdout).not.toContain('SENTINEL');
    expect(r.stderr).not.toContain('SENTINEL');
  });

  it('ignores a telemetry:none account — it has no Anthropic credential to have', () => {
    const home = healthy('ccrc-doctor-cred-none-');
    writeRoster(home, [UPSTREAM,
      { id: 'other-lane', exec: { kind: 'external' }, telemetry: 'none' }]);
    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 1 account/m);
  });

  it('SKIPs rather than PASSing when there is no roster — `wrappers` owns that fact', () => {
    // Two checks measuring one thing is how they come to disagree, and a doctor
    // that reports agreement it measured nothing is the worst failure this verb
    // has. No remedy under a skip, by this file's own contract.
    const home = healthy('ccrc-doctor-cred-noroster-');
    rmSync(join(home, '.ccrc', 'accounts.json'));
    expect(runDoctor(home).stdout).toMatch(/^SKIP credentials: /m);
  });
});
```

(d) In `server/test/single-definition.test.ts`, append a describe beside the exposure/Caddyfile
blocks:

```typescript
// — the account-health probe's token convention —
describe('one .cc-secrets/<id>-oauth.env convention, in exactly two bash files', () => {
  // `shared/roster.ts` permits `exec.secretsFile` only on `kind: 'generated'`,
  // so the mandatory upstream account cannot declare where its credential
  // lives — and a roster-driven probe would silently skip the primary account.
  // The convention closes that, and the two files that spell it CANNOT share a
  // constant: `ccd-account-health` is installed alone into $HOME/.local/bin
  // with no library beside it, and `ccrc-doctor-checks` is loaded by `ccrc`
  // through ${BASH_SOURCE[0]} on a box that may not have the probe at all.
  // So the agreement is MEASURED, the way `.ccrc/remote-control`'s four
  // spellings are: an exact holder list, and a value comparison.
  const NEEDLE = '-oauth.env';

  it('is spelled by exactly those two files, each named here BY NAME', () => {
    expect(holdersOf(NEEDLE)).toEqual([
      'ccd/ccd-account-health',   // _ah_token_file — the probe's own reader
      'ccd/ccrc-doctor-checks',   // _check_credentials — the operator-facing re-measurement
    ]);
  });

  it('and both build the same path from an id', () => {
    // NARROWED TO THE CONSTRUCTING LINE, deliberately. `codeLines` drops only
    // lines whose trimmed start is `#`, and each file names the file TWICE in
    // shell — once building the path and once in an operator-facing message
    // that quotes it back (`_ah_say`'s refusal; `bad+=(…)`'s FAIL detail). A
    // bare `.includes(NEEDLE)` therefore counts 2 on each side and this pin
    // would be red on arrival for a reason that is not a defect. The message
    // copies are a feature — an operator is told the exact path — so the
    // filter names the construction instead of forbidding the mention.
    const probe = codeLines(path.join(ccrcRoot, 'ccd', 'ccd-account-health'))
      .filter((l) => l.includes(NEEDLE) && l.includes('printf'));
    const doctor = codeLines(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'))
      .filter((l) => l.includes(NEEDLE) && l.includes('[ -s '));
    expect(probe.length, `the probe builds it on ${probe.length} lines`).toBe(1);
    expect(doctor.length, `the doctor builds it on ${doctor.length} lines`).toBe(1);
    // A REAL comparison, not a tautology. Each line is reduced to the path it
    // BUILDS, with the two files' different spellings of "the secrets dir" and
    // "the account id" normalised away — the probe's `printf '%s/%s-oauth.env'
    // "$SECRETS_DIR" "$1"` and the doctor's `[ -s "$HOME/.cc-secrets/$id-oauth.env" ]`
    // both reduce to the SAME literal. A `shape` that returned a constant for
    // anything matching the filter (the first draft of this pin did) could
    // never fail, which is the failure mode this whole file exists to catch.
    const shape = (l: string): string => {
      const m = /['"]([^'"]*-oauth\.env)['"]/.exec(l);
      expect(m, `no quoted -oauth.env path on: ${l.trim()}`).not.toBeNull();
      return m![1]!.replace('%s/%s', '<dir>/<id>').replace('$HOME/.cc-secrets/$id', '<dir>/<id>');
    };
    expect(shape(probe[0]!), 'the probe builds a path the doctor does not').toBe('<dir>/<id>-oauth.env');
    expect(shape(doctor[0]!), 'the doctor builds a path the probe does not').toBe('<dir>/<id>-oauth.env');
  });
});
```

(e) In `server/test/ccrc-doctor.test.ts`, add a second describe beside the `services` block:

```typescript
describe('ccrc doctor: services knows about the account-health timer', () => {
  itLinux('warns — with its OWN consequence — when the probe timer is installed and stopped', () => {
    // §A.7's parenthesis, measured: `known` (ccd/ccrc-doctor-checks:808) is a
    // hardcoded three-name list, and a timer outside it is a unit this box runs
    // and doctor never asks about. WARN is the right class for the same reason
    // cap-scopes' is — a stopped probe is degradation, not a box that is down —
    // but the SENTENCE cannot be shared: cap-scopes' says "panes spawned while
    // it is stopped run without their memory cap", which is false here and
    // would send an operator to the wrong place with the right remedy.
    const home = healthy('ccrc-doctor-services-health-timer-');
    writeUnitFile(home, 'ccd-account-health.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-account-health.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-account-health.timer is installed but inactive');
    expect(lines[i]).toContain('no account\'s credential is being probed');
    expect(lines[i]).not.toContain('memory cap');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-account-health\.timer$/);
    // A stopped reading is not a failed box: WARN, and rc stays 0.
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('names it in the PASS line when it is installed and running', () => {
    // "The PASS names every unit it asked about" is `_check_services`' own
    // stated contract; a timer added to `known` and then never mentioned would
    // satisfy the warn case above while measuring nothing on a healthy box.
    const home = healthy('ccrc-doctor-services-health-timer-ok-');
    writeUnitFile(home, 'ccd-account-health.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-account-health.timer'), 'active\n');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).toContain('ccd-account-health.timer is active');
  });

  it('a box without the unit is never asked about it — no count moves', () => {
    // `_check_services` asks only about units whose FILE is in the unit dir, so
    // a fourth name in `known` costs nothing on a fixture that never plants it.
    // That is the whole reason `HEALTHY_SKIPS` and the counting pins that read
    // it (`:1280`, `:1789`, `:1894`, `:3128`, `:4501`, `:5177`, `:5178`) stay
    // exactly where they are.
    const home = healthy('ccrc-doctor-services-health-timer-absent-');
    const line = lineFor(runDoctor(home).stdout, 'services') ?? '';
    expect(line).toMatch(/^PASS services: /);
    expect(line).not.toContain('ccd-account-health');
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts test/single-definition.test.ts
```

Expected, and the exact left-hand sides matter here because one of them is NOT what it looks like:

- `ccrc-doctor.test.ts` fails the six new `credentials` cases —
  `expected '…' to match /^PASS credentials: …/` and its siblings, with the whole doctor output in
  the message and no `credentials` line anywhere in it.
- `ccrc-doctor.test.ts` fails the two `itLinux` account-health-timer cases: the warn case reds at
  `expected -1 to be greater than -1` (there is no `WARN services:` line at all, because the unit is
  installed and `known` does not carry its name), and the PASS-line case reds with
  `expected 'PASS services: ccrc.service is active, ccd-cap-scopes.timer is active' to contain
  'ccd-account-health.timer is active'`. The third case ("a box without the unit") **passes from the
  start** — it pins that the name costs nothing when the file is absent.
- `ccrc-doctor.test.ts` does NOT yet fail `'every name in the table has a _check_<name> function, and
  vice versa'`: that bijection is green right now because neither half of `credentials` exists. It is
  Step 7's mutation that drives it in both directions.
- `single-definition.test.ts` fails the holder list with
  `expected [ 'ccd/ccd-account-health' ] to deep equal [ 'ccd/ccd-account-health',
  'ccd/ccrc-doctor-checks' ]` — **not** `expected []`: Task 4 already made the probe a holder, and no
  other bash file under `ccd/` or `deploy/` spells `-oauth.env` on a non-comment line (measured: the
  one pre-existing hit, `ccd/ccrc-doctor-checks:2003`, is a comment, which `codeLines` drops).

**Record the actual output.**

- [ ] **Step 3: Add the table entry**

In `ccd/ccrc-doctor-checks`, in `CCRC_DOCTOR_CHECKS`, between `wrappers` and `pools`:

```bash
  wrappers
  credentials
  pools
```

- [ ] **Step 4: Write the check**

In `ccd/ccrc-doctor-checks`, immediately after `_check_wrappers`' closing brace:

```bash
# ── credentials: does every account this box will PROBE have a token file? ──
# `ccd-account-health` derives each token's path by CONVENTION —
# `$HOME/.cc-secrets/<id>-oauth.env` for every `telemetry: "anthropic"` account
# — because `shared/roster.ts` permits `exec.secretsFile` only on
# `kind: "generated"`, so the mandatory upstream account structurally cannot
# declare where its credential lives. A roster-driven probe would have covered
# the generated accounts and SILENTLY SKIPPED the primary one: precisely the
# class of defect the health work exists to remove.
#
# A convention with no measurement is that silent skip waiting to happen. The
# probe REFUSES an account whose token file is absent or empty — the fourth
# outcome, and the correct one — but a refusal that only reaches a journal is
# indistinguishable from a fleet where nothing went wrong. THIS is where absence
# becomes loud.
#
# READ BY NODE, NOT JQ, for `_check_wrappers`' stated reason: this check must not
# fail for a reason that belongs to another one, and a box with no jq already
# gets exactly one FAIL, from the jq check.
#
# NOT ONE BYTE OF ANY FILE IS READ. `[ -s ]` answers existence and non-emptiness
# together, which is the whole question — and this file's standing rule (see
# `_check_config`) is that a credential is reported as SET or NOT SET and never
# quoted at a terminal an operator pastes into a ticket.
#
# SKIP, NOT PASS, ON AN ABSENT OR UNREADABLE ROSTER: `_check_wrappers` above
# already owns "this box has no roster", and two checks measuring one thing is
# how they come to disagree. Skip on ZERO eligible accounts too — a scan over an
# empty list passes everything, and a doctor reporting agreement nobody measured
# is the worst failure this verb has.
_check_credentials() {
  local roster="$HOME/.ccrc/accounts.json"
  if [ ! -f "$roster" ] || [ ! -r "$roster" ]; then
    _dr_skip credentials "no readable account roster at \$HOME/.ccrc/accounts.json — the 'wrappers' check above owns that"
    return 3
  fi
  if ! command -v node >/dev/null 2>&1; then
    _dr_fail credentials "node is not on PATH, so \$HOME/.ccrc/accounts.json cannot be read" \
      "install Node first — see the 'node' check above"
    return 1
  fi
  local ids rc
  ids="$(CCRC_DOCTOR_ROSTER="$roster" node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(process.env.CCRC_DOCTOR_ROSTER, "utf8")); }
    catch (e) { process.exit(3); }
    if (!j || typeof j !== "object" || !Array.isArray(j.accounts)) process.exit(4);
    // Only ids that match the shared grammar reach stdout: an id outside it can
    // name no file, and it must never be printed at a terminal that acts on
    // control bytes (see `_check_wrappers`, which escapes for the same reason).
    const ok = /^[a-z][a-z0-9-]{0,31}$/;
    process.stdout.write(j.accounts
      .filter((a) => a && typeof a === "object" && a.telemetry === "anthropic" && ok.test(a.id))
      .map((a) => a.id).join("\n"));
  ' 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    _dr_skip credentials "\$HOME/.ccrc/accounts.json could not be read as a roster — the 'wrappers' check above owns that"
    return 3
  fi
  if [ -z "$ids" ]; then
    _dr_skip credentials "no account on this box declares telemetry \"anthropic\", so there is no Anthropic credential to look for"
    return 3
  fi
  local id n=0 miss=0
  local -a bad=()
  for id in $ids; do
    n=$((n + 1))
    # THE CONVENTION, SPELLED ONCE IN THIS FILE — the second and last holder;
    # `single-definition.test.ts` pins the pair and compares their shape.
    [ -s "$HOME/.cc-secrets/$id-oauth.env" ] && continue
    miss=$((miss + 1))
    bad+=("$id has no readable token at \$HOME/.cc-secrets/$id-oauth.env")
  done
  if [ "$miss" -gt 0 ]; then
    _dr_fail credentials "$(_dr_join "${bad[@]}")" \
      "the account-health probe refuses an account with no token, so its liveness is never measured — put the account's CLAUDE_CODE_OAUTH_TOKEN in that file (0600), or set telemetry to \"none\" for an account this box does not authenticate to Anthropic"
    return 1
  fi
  _dr_pass credentials "$n account(s) declaring telemetry \"anthropic\", each with a token file under \$HOME/.cc-secrets"
}
```

- [ ] **Step 5: Put the new timer in the list `services` asks about**

In `ccd/ccrc-doctor-checks`, in `_check_services`, extend the `known` array (`:808`) and give the
`*.timer` arm a per-timer consequence sentence. First, the array:

```bash
  local -a known=(ccrc.service ccrc-agent.service ccd-cap-scopes.timer ccd-account-health.timer)
```

Second, hoist `why` into the function's existing declaration line so the loop does not re-`local` it:

```bash
  local dir="$CCRC_UNIT_DIR" u st why rc=0
```

Third, replace the `*.timer)` arm of the verdict `case`:

```bash
      *.timer)
        # ONE CLASS, TWO CONSEQUENCES. Both timers DEGRADE rather than down the
        # box, so both warn — but the sentence an operator reads has to name
        # what THIS one stopping costs, or they get the right remedy attached to
        # somebody else's reason. `_dr_warn`'s detail is the only place that
        # fact exists, so it is a case rather than one shared string.
        #
        # The `*` arm is not decoration: `known` above is the list this file
        # maintains, and the day a fifth unit joins it, a timer with no sentence
        # of its own says something true and vague rather than something
        # confidently wrong about memory caps.
        case "$u" in
          ccd-cap-scopes.timer) why="panes spawned while it is stopped run without their memory cap" ;;
          ccd-account-health.timer) why="no account's credential is being probed, so a lane whose sign-in has died goes on looking healthy to placement" ;;
          *) why="the job it fires is not running" ;;
        esac
        # Unreachable on macOS today (`_inst_units` installs neither timer's
        # plist there) — routed through the hint anyway, so the day that
        # changes the remedy is already right.
        _dr_warn services "$u is installed but ${st:-not active} — $why" \
          "$(_dr_enable_now_hint "$u")"
        [ "$rc" -eq 1 ] || rc=2 ;;
```

Nothing else in `_check_services` moves. The two pre-existing cap-scopes cases
(`ccrc-doctor.test.ts:1754` and `:1769`) keep their exact strings — `ccd-cap-scopes.timer is
installed but inactive` and the `enable --now ccd-cap-scopes.timer` remedy — because the cap-scopes
arm keeps its own sentence verbatim.

- [ ] **Step 6: Run the tests and verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts test/single-definition.test.ts
```

Expected: both files pass. In particular `HEALTHY_SKIPS` is **unchanged** — the new check PASSes on
`healthy()` because Step 1(b) planted the token file, so the three `(N skipped)` summary pins
(`:1280`, `:1789`, `:1894`, `:4501`), both `expect(skipped).toBe(HEALTHY_SKIPS)` assertions
(`:3128`, `:5178`) and `expect(verdicts).toBe(total - HEALTHY_SKIPS)` (`:5177`) all still hold. Every
one of those reads its total from `tableNames().length` or a `\d+`, so the extra check costs nothing.
The `services` half moves no count either, for a different reason: `_check_services` only asks about
units whose FILE is present, and no fixture except the two new `itLinux` cases plants
`ccd-account-health.timer`.

- [ ] **Step 7: Measure the mutations**

1. Change `[ -s "$HOME/.cc-secrets/$id-oauth.env" ]` to `[ -e … ]`, re-run: the empty-file case reds
   with `expected '…' to match /^FAIL credentials: claude/`. Restore.
2. Change the zero-eligible arm from `_dr_skip` to `_dr_pass`, re-run: the `telemetry:none` case still
   passes (it has one eligible account), but **delete the table entry** instead and re-run — the
   bijection test reds with `ORPHAN _check_credentials`, and deleting the FUNCTION instead reds it
   with `MISSING _check_credentials`. Record both directions; that bijection is what makes a
   half-shipped check impossible.
3. Remove `ccd-account-health.timer` from `_check_services`' `known` array, re-run: BOTH `itLinux`
   timer cases red — the warn case with `expected -1 to be greater than -1`, the PASS-line case with
   `expected 'PASS services: …' to contain 'ccd-account-health.timer is active'`. Restore.
4. Point the new `*.timer` case arm at cap-scopes' sentence for both timers (delete the
   `ccd-account-health.timer)` line so it falls through to `*)`), re-run: the warn case reds on
   `expected '…the job it fires is not running' to contain 'no account\'s credential is being
   probed'`. Restore. That is the mutation that proves the per-timer sentence, rather than merely
   the name, is the guard.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts server/test/single-definition.test.ts
git commit -m "feat(doctor): an absent account token file is LOUD, and services asks about the probe's timer (D-TBD-authtoken-doctor-fixture, D-TBD-services-timer-consequence)

The probe derives each token's path by convention because the roster cannot
declare an upstream account's secretsFile — and a convention with no measurement
is a silent skip waiting to happen. FAIL names each account and its expected
path; not one byte of any file is read. SKIP, never PASS, when there is no
roster or no telemetry:anthropic account: 'wrappers' owns the first and a
verdict nobody measured is the worst failure this verb has.

healthy() gained a telemetry field and a token file rather than the check being
weakened — a SKIP there would have moved HEALTHY_SKIPS and seven count pins.

And services' hardcoded three-name list gains the timer (spec A.7's own
parenthesis), with a per-timer consequence sentence: both timers degrade rather
than down the box, so both WARN, but cap-scopes' 'without their memory cap' is
false about a probe and would attach the right remedy to the wrong reason.

Mutations measured, four: -e for -s reds the empty-file case; removing either
half of the table/function pair reds the bijection in its own direction;
dropping the timer from `known` reds both timer cases; collapsing the two
consequence sentences into one reds the warn case."
```

---

### Task 8: The server carries `authDead` beside `disabled`

**Files:**
- Modify: `server/src/limits.ts` (`AccountLimits` `:6-19`, `projectHome` `:96-108`, `readLimits`
  `:110-188`)
- Modify: `shared/api.ts` (`AccountUsage` `:2653-2663`)
- Modify: `server/src/server.ts` (`:1165-1171`)
- Modify: `server/test/fixtures/leastLoaded.ts`, `server/test/projected-home.test.ts`,
  `server/test/limits.test.ts`, `server/test/accounts-route.test.ts`

**Interfaces:**
- Consumes: `$REG/<account>-authdead` as written by `ccd/ccd-account-health` (Task 4) and read by
  `_authdead` (Task 1). The server reads the registry directory it already reads for `-disabled`.
- Produces:
  - `AccountLimits.authDead: boolean` (`server/src/limits.ts`)
  - `AccountUsage.authDead: boolean` (`shared/api.ts`) — required on the interface, absence-permitting
    at every reader
  - `projectHome(roster, limits)` — unchanged signature; an auth-dead account is dropped from
    **scoring** and kept in the fallback base.

- [ ] **Step 1: Write the failing test**

(a) `server/test/fixtures/leastLoaded.ts` — a field beside `disabled`, and ONE case (see the note
below the block for why the second one is not here):

```typescript
  disabled?: string[];
  /** Wrappers carrying a `<w>-authdead` marker — the account-health probe's
   *  verdict, in the same registry directory as `-disabled` and read on the same
   *  `readdir`. It ranks an account out of SCORING on both sides, and out of
   *  neither side's fallback: ccd assigns `first` BEFORE its skip, so the TS
   *  must drop the account from `scored` and leave `live`/`scorable[0]` alone.
   *  Omitted/empty means nothing is condemned. */
  authDead?: string[];
```

and, appended to the returned array:

```typescript
    {
      name: 'authdead-loses-scoring',
      files: { claude: fresh(80, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(40, 20), 'claude-d': fresh(85, 45) },
      authDead: ['claude-a'],
      expect: { wrapper: 'claude-b', score: 40 },
      why: 'the cheapest lane is condemned, so the cheapest lane nobody condemned wins — '
        + 'a health verdict costs preference, never eligibility',
    },
```

**Only ONE case joins the shared fixture, and the all-condemned case deliberately does not.** The
parity runner makes THREE assertions per case (`projected-home.test.ts:101-106`): `toEqual(c.expect)`
on the whole `ProjectedHome`, `_ws_least_loaded === c.expect.wrapper`, and
`shellScore(c.expect.wrapper) === c.expect.score`. On an all-condemned fleet `projectHome` empties
`scored` and takes the `scored.length === 0` fallback, which returns **score 0** — while
`_limit_score claude` still reads the **80** that is on disk. No value of `expect.score` satisfies
assertions 1 and 3 at once, so that case is pinned in Step 1(b)'s own test instead, asserting each
side in its own idiom the way the runner's `expect === null` branch already does. The score
divergence is real and is recorded as `D-TBD-authdead-allcondemned-score`.

(b) `server/test/projected-home.test.ts` — a seeder beside `seedDisabled`, and its call:

```typescript
/** `<w>-authdead` in `.cc-sessions` — the account-health probe's marker, in the
 *  same directory `<w>-disabled` lives in, so both implementations read it off
 *  the one `readdir`/glob they already do. */
const seedAuthDead = (wrappers: string[]): void => {
  const dir = path.join(home, '.cc-sessions');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('-authdead')) fs.rmSync(path.join(dir, name));
  }
  for (const w of wrappers) {
    fs.writeFileSync(path.join(dir, `${w}-authdead`), '1757203200 auth-401');
  }
};
```

```typescript
      seed(c.files);
      seedDisabled(c.disabled ?? []);
      seedAuthDead(c.authDead ?? []);
```

and extend the synthetic `L` helper at `:134-136`:

```typescript
  const L = (five: number | null, seven: number | null): AccountLimits =>
    ({ five, seven, ts: 1, fiveResetAt: null, sevenResetAt: null,
       fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false });
```

and append the all-condemned case as a describe of its own, after `projectHome edge cases`:

```typescript
// PINNED HERE AND NOT IN `leastLoaded.ts`, and the reason is the parity
// runner's THIRD assertion rather than a preference. That runner demands
// `shellScore(c.expect.wrapper) === c.expect.score`, and this is the one shape
// where the two languages agree on the ACCOUNT and cannot agree on the NUMBER:
// `projectHome` drops every condemned lane from `scored`, empties it, and takes
// the pre-existing `scored.length === 0` fallback — which reports score 0 —
// while `_limit_score claude` still reads the 80 that is really on disk.
//
// The ACCOUNT is what this case is about, and both sides answer `claude`. The
// score divergence is recorded as a deviation rather than smuggled through a
// fixture field that would let any FUTURE case disagree quietly — which is the
// one thing a parity harness may not allow.
describe('every home-able lane condemned — both sides still place', () => {
  it('falls back to the first home-able account in roster declaration order', async () => {
    const n = now();
    const fresh = (five: number, seven: number): string => JSON.stringify(
      { five, seven, ts: n - 60, fiveResetAt: n + 9000, sevenResetAt: n + 400000 });
    seed({ claude: fresh(80, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(40, 20), 'claude-d': fresh(85, 45) });
    seedDisabled([]);
    seedAuthDead(['claude', 'claude-a', 'claude-b', 'claude-d']);
    const cfg = loadConfig({ CCRC_HOME: home });
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg));
    // NOT null, and not the cheapest lane: ccd assigns `first` BEFORE its own
    // skip, so a fleet whose every lane is merely UNVERIFIED still places work.
    expect(projected?.wrapper, 'the server refuses to place on an all-condemned fleet').toBe('claude');
    expect(sh('_ws_least_loaded'), 'ccd disagrees').toBe('claude');
  });
});
```

(c) `server/test/limits.test.ts` — add `authDead: false` to the two `toEqual` shapes at `:24` and
`:28` and to the disabled-lane shape at `:113`, then append:

```typescript
  it('surfaces an auth-dead lane the same way a disabled one is surfaced', () => {
    // A lane can be condemned before it has ever written telemetry, and a lane
    // absent from `out` is indistinguishable from one nobody measured — which
    // scores as the emptiest account on the fleet. Same hole, same closure.
    const home = mkTmp('ccrc-limits-authdead-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'claude-a-authdead'), '1757203200 auth-401');
    const cfg = loadConfig({ CCRC_HOME: home });
    return readLimits(localIO, cfg).then((l) => {
      expect(l['claude-a']).toMatchObject({ authDead: true, disabled: false, five: null });
    });
  });

  it('never fabricates a row for an -authdead marker that names no account', () => {
    // `inRoster`'s job, and the reason the `-disabled` loop already has it: the
    // registry holds dotless fleet-wide switches too, and a marker for an
    // account the roster does not have must not become a phantom row on
    // GET /api/accounts.
    const home = mkTmp('ccrc-limits-authdead-phantom-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'not-an-account-authdead'), '1757203200 auth-401');
    const cfg = loadConfig({ CCRC_HOME: home });
    return readLimits(localIO, cfg).then((l) => {
      expect(Object.keys(l)).not.toContain('not-an-account');
    });
  });
```

(Use whatever `mkTmp`/`seedRoster`/`loadConfig` import and `async`/`await` idiom the surrounding cases
in that file already use; the assertions above are the content.)

(d) `server/test/accounts-route.test.ts` — add `authDead: false` to the row shapes at `:88` and `:93`,
then append:

```typescript
  it('carries authDead onto the wire', () => {
    // `AccountUsage` is restated by hand in three places, and this is the field
    // that would go missing in the third: the route builds its rows field by
    // field, so nothing but a test notices a dropped copy.
    // (Seed `<w>-authdead` in the fixture registry exactly as the disabled
    // cases above seed `<w>-disabled`, then:)
    expect(byWrapper['claude'].authDead).toBe(true);
    expect(byWrapper['claude-a'].authDead).toBe(false);
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/limits.test.ts test/accounts-route.test.ts test/projected-home.test.ts
```

Expected — and **vitest does not typecheck**, which is the thing to know before you go looking for a
compiler error that will not come. This repo runs vitest through esbuild with no `typecheck` block in
`server/vitest.config.ts`; typechecking lives in a SEPARATE suite, `server/test/typecheck-tests.test.ts`,
which spawns `tsc` and which Step 6 runs. So:

- `limits.test.ts:24` / `:28` / `:111-114` red as ordinary `toEqual` mismatches —
  `expected { five: 42, …, disabled: false } to deep equal { five: 42, …, disabled: false, authDead: false }`
  — because the value has no such key and `false` is not `undefined`.
- `accounts-route.test.ts:85-89` / `:90-94` red the same way, plus the new "carries authDead onto the
  wire" case with `expected undefined to be true`.
- `projected-home.test.ts` reds twice, both on the TS side only — bash already learned this in Task 2:
  `authdead-loses-scoring: expected { wrapper: 'claude-a', score: 5 } to deep equal { wrapper:
  'claude-b', score: 40 }`, and the all-condemned describe with `the server refuses to place on an
  all-condemned fleet: expected 'claude-a' to be 'claude'`. Each `it` stops at its first failing
  assertion, so the `ccd disagrees` half of each is never reached and would pass if it were.

The compiler's half of this lands separately, at Step 6, when `typecheck-tests.test.ts` runs — that
is where `AccountUsage`'s REQUIRED field does the work `RosterWire.hidden`'s docstring asks of it.
**Record the actual output.**

- [ ] **Step 3: The shape and the read**

In `server/src/limits.ts`, in `AccountLimits` after `disabled`:

```ts
  /** The account-health probe's durable verdict
   *  (`~/.cc-sessions/<wrapper>-authdead`, `"<epoch> <reason>"`) is standing:
   *  something measured this credential and it did not authenticate. A POSITIVE
   *  FLAG for `disabled`'s exact reason — "no telemetry" and "measured dead" are
   *  different facts, and collapsing them loses the one a person acts on.
   *
   *  NOT the same fact as `disabled` and never folded into it: that marker is
   *  operator INTENT, which cannot be wrong; this is a MEASUREMENT, which can
   *  be. That difference is why `projectHome` spends it on SCORING only, and why
   *  ccd's `_account_ok` never sees it at all. */
  authDead: boolean;
```

In `readLimits`, beside the `disabledLanes` derivation at `:117-121`:

```ts
  const disabledLanes = new Set(
    regNames.filter((n) => n.endsWith('-disabled')).map((n) => n.slice(0, -'-disabled'.length)),
  );
  // The same `readdir`, a second suffix. Both markers are dotless per-account
  // files in one directory, so this costs nothing beyond a second pass over a
  // list already in memory.
  const authDeadLanes = new Set(
    regNames.filter((n) => n.endsWith('-authdead')).map((n) => n.slice(0, -'-authdead'.length)),
  );
```

Then add `authDead: authDeadLanes.has(wrapper)` to all three `AccountLimits` literals in that function
(the success path at `:155-156`, the catch at `:158-160`, and the marker-only surfacing loop at
`:183-186`), and widen the surfacing loop so an auth-dead lane with no telemetry file gets a row too:

```ts
  // …the same for a lane the PROBE condemned before anything ran on it. Absent
  // is indistinguishable from unknown, which scores as the emptiest account on
  // the fleet — the exact self-reinforcing hole `disabled` exists to close, and
  // an auth-dead lane falls into it identically. `inRoster` is doing the same
  // job for both: the registry also holds dotless markers that name no account.
  for (const wrapper of new Set([...disabledLanes, ...authDeadLanes])) {
    if (wrapper in out) continue;
    if (!inRoster(cfg.roster, wrapper)) continue;
    out[wrapper] = { five: null, seven: null, ts: null, fiveResetAt: null,
                     sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
                     disabled: disabledLanes.has(wrapper), authDead: authDeadLanes.has(wrapper) };
  }
```

- [ ] **Step 4: Scoring only, in `projectHome`**

In `server/src/limits.ts`, change the body of `projectHome` at `:97-102`:

```ts
  const live = roster.homeAble.filter((a) => limits[a.id]?.disabled !== true);
  if (live.length === 0) return null;
  const scorable = live.filter((a) => a.telemetry !== 'none');
  // AN AUTH-DEAD ACCOUNT LEAVES THE SCORED SET AND NOTHING ELSE, and the
  // asymmetry is a mirror, not a preference. `_ws_least_loaded` assigns its
  // `first` fallback BEFORE its own `_authdead … && continue`, so a fleet whose
  // every home-able lane is condemned still places work on the first one in
  // roster order. Filtering `live` or `scorable` here instead would make this
  // side answer a different account — or `null` — and `projected-home.test.ts`
  // drives both languages over one seeded HOME precisely to catch that.
  const scored = scorable
    .filter((a) => limits[a.id]?.authDead !== true)
    .map((a) => ({ wrapper: a.id, score: measured(limits[a.id]) }))
    .filter((s): s is { wrapper: string; score: number } => s.score !== null);
```

and extend the function's docstring where it lists the two exclusions — `server/src/limits.ts:65-70`,
"Two accounts are excluded from scoring for two different reasons…" — adding a third bullet
immediately after the `disabled` one at `:69-70` (**not** the `_avail`/`SWAP_CEILING` paragraph at
`:80-84`, which is about something else):

```
 *   - `authDead` — the health probe measured this credential dead, so its
 *     telemetry describes a lane nothing can run on. It leaves SCORING only;
 *     unlike the two above it, it does not leave `live`, because ccd's own
 *     fallback does not exclude it either.
```

and change that paragraph's opening words at `:65` from `Two accounts are excluded from scoring` to
`Three accounts are excluded from scoring` — a count written in prose beside the list it counts is a
fact the list can falsify, and this plan is the edit that would falsify it.

- [ ] **Step 5: The wire and the route**

In `shared/api.ts`, in `AccountUsage` after `disabled`:

```ts
  /** The fleet host's account-health probe measured this account's credential
   *  and it did not authenticate (`~/.cc-sessions/<wrapper>-authdead`).
   *
   *  ADDITIVE, and `FLEET_PROTO` is deliberately not bumped for it, on
   *  `RosterWire.hidden`'s exact terms. A reader must test `=== true` and never
   *  truthiness: a server built before this field omits it, and ABSENCE MEANS
   *  "not condemned", so an older payload keeps rendering every account exactly
   *  as it did. REQUIRED on this interface all the same, for `hidden`'s reason:
   *  the route builds its rows field by field and the compiler is the only
   *  thing that can catch a rebuild dropping one. */
  authDead: boolean;
```

In `server/src/server.ts`, in the `GET /api/accounts` row builder at `:1169`:

```ts
        fiveRolledOver: l.fiveRolledOver, sevenRolledOver: l.sevenRolledOver,
        disabled: l.disabled, authDead: l.authDead,
```

- [ ] **Step 6: Run the tests and verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/limits.test.ts test/accounts-route.test.ts test/projected-home.test.ts test/typecheck-tests.test.ts
```

Expected: all four pass. `typecheck-tests` is a **known load flake** — re-run it alone before treating
a red as real.

- [ ] **Step 7: Measure the mutations**

1. Delete `.filter((a) => limits[a.id]?.authDead !== true)` from `projectHome`, re-run
   `projected-home.test.ts`: `authdead-loses-scoring` reds on the TS half
   (`expected { wrapper: 'claude-a', score: 5 } to deep equal { wrapper: 'claude-b', score: 40 }`)
   while its bash half stays green — the parity harness naming which side drifted. Restore.
2. **MOVE** the same filter up onto `live` (`roster.homeAble.filter((a) => limits[a.id]?.disabled !==
   true && limits[a.id]?.authDead !== true)`), re-run: the all-condemned describe reds with
   `the server refuses to place on an all-condemned fleet: expected undefined to be 'claude'` —
   `live` empties, `projectHome` returns `null`, and `projected?.wrapper` is `undefined` — while bash
   still answers `claude`. Restore. This is the mutation that proves the *position* is the guard,
   exactly as Task 2's is.
3. Delete `authDead: l.authDead` from the route, re-run `accounts-route.test.ts`: the wire case reds
   with `expected undefined to be true`. Restore.

Record all three.

- [ ] **Step 8: Commit**

```bash
git add server/src/limits.ts shared/api.ts server/src/server.ts \
        server/test/fixtures/leastLoaded.ts server/test/projected-home.test.ts \
        server/test/limits.test.ts server/test/accounts-route.test.ts
git commit -m "feat(server): carry authDead beside disabled, and spend it on scoring only (D-TBD-authdead-projecthome-fallback)

readLimits reads <w>-authdead off the registry readdir it already does, and
surfaces a condemned lane that has never written telemetry for disabled's exact
reason: absent is indistinguishable from unknown, which scores as the emptiest
account on the fleet.

projectHome drops it from `scored` and NOT from `live`/`scorable[0]`, because
ccd assigns its `first` fallback before its own skip. Additive on the wire;
FLEET_PROTO unchanged; every reader tests === true.

Mutations measured: deleting the filter reds the TS half of the parity fixture;
MOVING it onto `live` reds the all-condemned case; dropping the route field reds
the wire case."
```

---

### Task 9: The PWA extends the `data-disabled` affordance

**Files:**
- Modify: `pwa/src/screens/AccountsScreen.tsx` (`:194`, `:208-219`)
- Modify: `pwa/test/accounts-screen.test.tsx` (the `acct()` helper at `:25`, plus new cases)

**Interfaces:**
- Consumes: `AccountUsage.authDead` from Task 8, absence-permitting (`a?.authDead === true`).
- Produces: no new CSS class, no new data attribute, no new component.
  `.accounts-row[data-disabled='true']` already carries the greyed fill
  (`pwa/src/fleet/fleet.css:1742`) and `.accounts-disabled-note` already carries the note's type
  (`pwa/src/fleet/fleet.css:1732`).

- [ ] **Step 1: Write the failing test**

In `pwa/test/accounts-screen.test.tsx`, extend the fixture helper at `:25`:

```tsx
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
```

and append a describe:

```tsx
describe('an auth-dead lane', () => {
  it('renders switched off through the SAME data-disabled attribute, not a second one', async () => {
    // The affordance is EXTENDED, deliberately: `.accounts-row[data-disabled]`
    // already carries the greyed fill (fleet.css) and `.accounts-disabled-note`
    // already carries the note's type. A second attribute would mean a second
    // CSS rule, a second selector in every test, and two vocabularies for one
    // idea — "this lane cannot take work".
    stubAccounts([acct({ wrapper: 'claude', authDead: true })]);
    render(<AccountsScreen />);
    const row = (await screen.findByText('team·max')).closest('[data-disabled]') as HTMLElement;
    expect(row).toHaveAttribute('data-disabled', 'true');
  });

  it('says WHY it is off, and says something different from the operator switch', async () => {
    stubAccounts([acct({ wrapper: 'claude', authDead: true })]);
    render(<AccountsScreen />);
    expect(await screen.findByText(/sign-in expired/)).toBeInTheDocument();
    expect(screen.queryByText('disabled on the fleet host')).toBeNull();
  });

  it('names BOTH when both are true — an operator switch does not hide a measurement', async () => {
    stubAccounts([acct({ wrapper: 'claude', disabled: true, authDead: true })]);
    render(<AccountsScreen />);
    expect(await screen.findByText(/disabled on the fleet host; sign-in expired/)).toBeInTheDocument();
  });

  it('an older server that omits the field renders the lane as normal', async () => {
    // Absence-permits, at the one reader. The offline snapshot and every stale
    // build depend on this: `=== true`, never truthiness.
    stubAccounts([{ ...acct({ wrapper: 'claude' }), authDead: undefined } as unknown as AccountUsage]);
    render(<AccountsScreen />);
    const row = (await screen.findByText('team·max')).closest('[data-disabled]') as HTMLElement;
    expect(row).toHaveAttribute('data-disabled', 'false');
  });
});
```

Every case is `async`, and every one is the two literal lines `stubAccounts([...]);` then
`render(<AccountsScreen />);` — that is the file's own idiom, verbatim from the disabled-lane cases at
`pwa/test/accounts-screen.test.tsx:136-147` and `:157-167`. There is no `renderWith` helper in this
tree (`pwa/test/dialog-sheet.test.tsx`'s `renderWithDialog` is a different file's, for a different
component), and a bare `() => {}` containing `await` is a parse error that stops the whole file
loading. Both mistakes are cheap to make and expensive to debug, which is why they are spelled out
here rather than left to "use the surrounding idiom". Every assertion keys on `[data-disabled]` and
`.accounts-disabled-note`'s text — never on a new selector.

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd pwa && ./node_modules/.bin/vitest run test/accounts-screen.test.tsx
```

Expected: the first three cases fail — the first with
`expected element to have attribute data-disabled="true", received "false"`, the second and third with
`Unable to find an element with the text: /sign-in expired/`. The fourth passes already, which is what
absence-permits means. **Record the actual output.**

- [ ] **Step 3: Extend the read and the render**

In `pwa/src/screens/AccountsScreen.tsx`, replace `:194`:

```tsx
          const disabled = a?.disabled === true;
```

with:

```tsx
          // TWO facts, ONE affordance. `disabled` is the operator's kill-switch
          // (`~/.cc-sessions/<w>-disabled`, touched by hand); `authDead` is the
          // health probe's measurement (`<w>-authdead`). They are never folded
          // into one boolean upstream — the server keeps them apart for exactly
          // the reason the note below says both when both are true — but on this
          // screen they answer the same question, "can this lane take work?", so
          // they render through the attribute and the note that already exist
          // rather than a second vocabulary beside them.
          //
          // `=== true` on both, never truthiness: a server built before
          // `authDead` omits it, and absence must read as "not condemned".
          const disabled = a?.disabled === true;
          const authDead = a?.authDead === true;
          const off = disabled || authDead;
          // Both, when both — an operator switch does not hide a measurement,
          // and a measurement does not explain away a switch. The two are
          // cleared by different acts.
          const offNote = disabled && authDead
            ? 'disabled on the fleet host; sign-in expired'
            : disabled
              ? 'disabled on the fleet host'
              : 'sign-in expired on the fleet host';
```

Then at `:208`, `:212` and `:219`, swap the three reads of `disabled` for `off` and the note's literal
for `offNote`:

```tsx
            <section key={wrapper} className="accounts-row" data-disabled={off ? 'true' : 'false'}>
              <div className="accounts-row-head">
                <span
                  className="account-gauge-label"
                  style={{ color: off ? 'var(--ink-tertiary)' : `var(${accountColorVar(roster, wrapper)})` }}
                >
                  {accountLabel(roster, wrapper)}
                </span>
                {/* Disabled lanes are shown switched off, never hidden — the
                    strip's compact filter (AccountsStrip.tsx) is right for an
                    always-on bar, wrong here. A lane whose credential the probe
                    measured dead is shown for a sharper version of the same
                    reason: it is the one lane an operator has to go and fix. */}
                {off && <span className="accounts-disabled-note">{offNote}</span>}
              </div>
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd pwa && ./node_modules/.bin/vitest run test/accounts-screen.test.tsx
```

Expected: the whole file passes.

- [ ] **Step 5: Measure the mutation**

1. Change `const off = disabled || authDead;` to `const off = disabled;`, re-run: the first three cases
   red. Restore.
2. Change `a?.authDead === true` to `!!a?.authDead`, re-run: the fourth case **still passes**
   (`undefined` is falsy either way) — so instead change it to `a?.authDead !== false`, re-run: the
   fourth case reds with `expected element to have attribute data-disabled="false", received "true"`.
   Restore. Record both; the second is what pins absence-permits rather than merely asserting it.

- [ ] **Step 6: Run the neighbouring PWA suites**

```bash
cd pwa && ./node_modules/.bin/vitest run test/accounts-strip.test.tsx test/fleet-screen.test.tsx test/lifecycle-ui.test.tsx
```

Expected: all three pass. Their `AccountUsage` fixtures at `accounts-strip.test.tsx:19`,
`fleet-screen.test.tsx:236` and `:947`, and `lifecycle-ui.test.tsx:96` will need `authDead: false` for
the compiler, and nothing else moves.

**`AccountsStrip.tsx` is deliberately NOT changed**, and the reason is worth recording rather than
discovering: its filter (`pwa/src/fleet/AccountsStrip.tsx:103`) HIDES a `disabled` lane, because a
lane an operator switched off is not news on an always-on bar. Hiding an auth-dead lane would hide the
one lane somebody has to go and fix. The strip's own placeholder logic (`:124`) is likewise untouched.
If the strip should learn about this later, that is a separate decision with its own argument.

- [ ] **Step 7: Commit**

```bash
git add pwa/src/screens/AccountsScreen.tsx pwa/test/accounts-screen.test.tsx \
        pwa/test/accounts-strip.test.tsx pwa/test/fleet-screen.test.tsx pwa/test/lifecycle-ui.test.tsx
git commit -m "feat(pwa): an auth-dead lane renders through the data-disabled affordance that already exists

No new CSS rule, no second data attribute, no second note class: the row already
greys on [data-disabled='true'] and the note already has its type. The two facts
stay apart in the copy — 'disabled on the fleet host; sign-in expired' when both
— because an operator switch and a measurement are cleared by different acts.

AccountsStrip is deliberately unchanged: it HIDES a disabled lane, and hiding an
auth-dead one would hide the lane somebody has to go and fix.

Mutations measured: dropping authDead from the disjunction reds 3; loosening the
=== true to !== false reds the absence-permits case."
```

---

## Deviations found

- **D-TBD-authdead-purge-sites** — the spec says the one-dot suffix rule (`[[ "$suffix" == *.* ]] &&
  continue`) lives at **two** sites. Measured on `main` @ `58ef97b6`: **three** — `ccd/ccd:1656`
  (`_reg_purge`), `:3757` (`_ws_slug_free`), `:3768` (`_ws_slug_residue`). All three glob
  `"$REG/$id".*`, so the dotless marker is safe from all three, and Task 1 measures the property
  against a session id that spells the marker exactly rather than restating the count.

- **D-TBD-authdead-least-loaded-first** — the spec asks `_ws_least_loaded` to SKIP an auth-dead lane
  while also requiring the `first` fallback to stay reachable "when every pool member is condemned".
  Those two are only compatible at one insertion point: **after** `[[ -z "$first" ]] && first="$w"`
  and **before** the score. Written one line higher, `_ws_least_loaded` answers `""` on an
  all-condemned fleet and `cmd_ws_add` dies. Task 2 fixes the placement and measures it by MOVING the
  guard, not by deleting it.

- **D-TBD-authdead-projecthome-fallback** — the same defect in the other language, and it would not
  have been caught by porting the bash line naively: `projectHome`'s fallback base is
  `scorable[0] ?? live[0]`, so filtering `authDead` out of `live` or `scorable` makes the server
  answer a different account — or `null` — than ccd does on the identical HOME. Task 8 filters
  `scored` alone and measures the divergence with the shared parity fixture.

- **D-TBD-authdead-allcondemned-score** — the all-condemned case cannot live in the shared parity
  fixture, and the reason is a real divergence rather than a harness detail. `projected-home.test.ts`
  asserts three things per fixture case (`:101-106`): the whole `ProjectedHome` by `toEqual`, the
  bash wrapper, and `shellScore(expect.wrapper) === expect.score`. With every home-able lane
  condemned, `projectHome` empties `scored` and falls to `scored.length === 0`'s
  `{ wrapper: (scorable[0] ?? live[0]!).id, score: 0 }` — a score of **0** for an account
  `_limit_score` still measures at **80**, because that fallback was written for "nothing is
  measured" and this is "everything is measured and condemned". Both languages agree on the ACCOUNT,
  which is what §A.4 asks for, so Task 8 pins the case in `projected-home.test.ts`'s own idiom and
  leaves the fallback's score alone: changing it is a scoring decision §A does not make, and the
  honest projection for an all-condemned fleet is a question for whoever needs the number. Recorded
  so the next reader knows the 0 is deliberate rather than unnoticed.

- **D-TBD-services-timer-consequence** — §A.7 asks for the timer's own doctor coverage because
  "doctor's generic `services` check asks about a hardcoded three-name list a new timer would not be
  in". Measured: `ccd/ccrc-doctor-checks:808`, `local -a known=(ccrc.service ccrc-agent.service
  ccd-cap-scopes.timer)`. Adding the name is not enough, and that is the deviation: the `*.timer`
  verdict arm carries ONE hardcoded consequence sentence — "panes spawned while it is stopped run
  without their memory cap" — which is false about a health probe and would hand an operator the
  right remedy attached to somebody else's reason. Task 7 makes the sentence a per-timer `case` with
  a truthful `*` default, and measures it by collapsing the two back into one.
  (`ccd-graph-sweep.timer` remains outside `known` — untouched here, since nothing in this plan
  measured what its own consequence sentence should say.)

- **D-TBD-authhealth-ddns-pattern** — §A.7 says to follow "the `ccrc-ddns` pattern exactly": curl in
  `ExecStart`, credentials expanded by systemd from the 0600 `EnvironmentFile`. That is impossible
  here and the impossibility is structural, not incidental: `ccrc-ddns` expands ONE credential from
  ONE file, and this probe reads N — one `~/.cc-secrets/<id>-oauth.env` per account. The half that
  binds is enforced instead (0644 unit carries and names no credential; each token read at run time in
  a subshell; handed to curl on stdin via `-K -`, never argv, never this process's environ, never a
  log line), and Task 5's unit file states the boundary in place.

- **D-TBD-authhealth-403-body** — the spec's classifier row is `403 oauth_scope_insufficient`. The
  probe implements exactly that: a 403 whose body does NOT name that error type is **unmeasured**, not
  live. Recorded because it makes "live" strictly narrower than a bare status check would, and because
  it is the branch that stops an unrecognised 403 from clearing a true verdict.

- **D-TBD-authhealth-id-re** — the account-id grammar (`^[a-z][a-z0-9-]{0,31}$`) gains a THIRD
  spelling: `shared/roster.ts`'s module-private `ID_RE`, `ccd/ccrc-wrapper-shape`'s `WRAPPER_ID_RE`,
  and now the probe's `AH_ID_RE`. Unavoidable — the probe is installed alone into `$HOME/.local/bin`
  with no library beside it to source, the situation `session-hook.sh` is already in — so the
  agreement is MEASURED rather than commented, in `pool-name-parity.test.ts`'s shape: Task 4 extracts
  both literals and holds them equal.

- **D-TBD-authtoken-doctor-fixture** — `ccrc-doctor.test.ts`'s `healthy()` writes a roster that
  declares no `telemetry` at all (`writeRoster`, `:276-281`), so a `credentials` check reading it
  would find zero eligible accounts and SKIP — moving `HEALTHY_SKIPS` from 0 to 1 on Linux and, by that
  file's OWN recorded measurement of the identical shape (`ccrc-doctor.test.ts:1018-1026`: deleting
  one `linkReal(home, 'realpath')` line turned a healthy run into `7 failed | 307 passed`, and every
  one of the seven was a skip/verdict COUNT, not a failing verdict), reddening seven counting
  assertions across that file. Task 7 extends the fixture (a `telemetry` field on `UPSTREAM`, a token file in `healthy()`)
  rather than weakening the check, which is that fixture's stated contract: "a healthy box is one
  where every check PASSES".

- **D-TBD-authhealth-macos-corpus** — `server/test/macos-platform.test.ts:175-180` derives its
  portability corpus from **every shebang'd file in `ccd/`**, so `ccd/ccd-account-health` joins it the
  moment it exists. Recorded because the last file to arrive there (`ccd-graph-sweep`) needed an
  `unowned` escape-hatch entry; this one is written against that table
  (`macos-platform.test.ts:108-127`) — `curl --max-time` instead of `timeout`, `mktemp` with an
  `XXXXXX` template, `date +%s` — so it stays in the owned half, and Task 4 Step 6 measures that.

- **D-TBD-authhealth-endpoint-origin** — the endpoint PATH (`/api/oauth/usage`) is the spec's, from
  its own measurements E1–E4 on the fleet host. The **origin** appears nowhere in this tree: measured
  with a full-repo grep at plan time, the only hits for `api.anthropic.com`, `oauth/usage` or
  `ANTHROPIC_BASE_URL` are in the two design documents. The probe therefore carries
  `https://api.anthropic.com/api/oauth/usage` as an **env-overridable default**
  (`CCRC_HEALTH_URL`), and the implementer must confirm that origin against the spec author's own E1
  run **before the first fleet deploy** — a wrong origin makes every account read "unmeasured" for
  ever, which is silent by construction.

**The ledger allocator was unreachable when this plan was written** — `POST /api/ledger/deviations`
lives on the server box and this session ran with no route to its loopback port. Per the convention,
every number above is written `D-TBD-<slug>` and must be **MINTED AND DEFINED IN THE SAME ACT** before
merge. Do not look a number up; `GET /api/ledger`'s `floor` is what the next POST would mint, not a
number you may take. In particular, do not take any number the account-pools programme's six wave
plans — merged to `main` in `ece7597a` (#56), so they are in your checkout — already define — that block was allocated and DEFINED before this plan
existed, and `deviation-refs.test.ts` (`cd server && ./node_modules/.bin/vitest run
test/deviation-refs.test.ts`, after `git fetch origin main`) is what measures the collision from this
branch rather than remembering it.

---

## Self-review

**Spec coverage.** §A has six numbered sub-sections and every one lands:

| spec | where |
|---|---|
| A.1 eligibility, roster-derived, no account list in shipped source | Task 4 — `jq … select(.telemetry == "anthropic")`, plus the "names no account" case that swaps the roster and swaps the subject |
| A.2 token by convention + a doctor check that makes absence loud | Task 4 (`_ah_token_file`) and Task 7 (`_check_credentials`), pinned as exactly two holders in `single-definition.test.ts` |
| A.3 the four-outcome classifier | Task 4, one case per row plus the two "clears nothing" cases the third row turns on |
| A.4 rank-last and skip, never ineligible | Tasks 2 and 8 — bash and TS, each measured by MOVING the guard as well as deleting it |
| A.5 the marker, dotless, `"<epoch> <reason>"`, not `-disabled` | Tasks 1 and 4 |
| A.6 three clearing owners, no timer-only clear | probe-on-403 (Task 4), successful spawn (Task 3), operator `rm` (nothing to build). No timer clears anything anywhere. |
| A.7 cadence, placement, units, the five deploy edits, secrets | Tasks 5 and 6 |
| A.7's own doctor check for the TIMER — the "hardcoded three-name list" parenthesis | Task 7, Step 5: `_check_services`' `known` gains `ccd-account-health.timer`, with a per-timer consequence sentence (D-TBD-services-timer-consequence) |
| A.4's server/PWA clause | Tasks 8 and 9 |

**Deliberately out of scope, with the spec's own words.** `_strand_why`'s fifth token is **not** in
this plan: §10.3 places it "inside wave 2b", and the function does not exist on `main` (measured: zero
occurrences of `_strand_why` in `ccd/ccd`). A task here would have to invent the function it extends.
§B (the provenance fix), §C (the keepalive), §D (the pre-emptive lane) and §E (the swap timeout, its
own already-approved plan) are likewise untouched.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N", no reference to a
function no task defines. `_authdead` is defined in Task 1 and consumed in Tasks 2 and 3;
`_ah_token_file`, `_ah_token`, `_ah_mark`, `_ah_clear`, `_ah_say` are all defined in the same file in
Task 4; `_check_credentials` is defined in Task 7 and its table entry lands in the same task;
`seedAuthDead` is defined in Task 8 beside the `seedDisabled` it copies. The only `TBD`s present are
the deliberate `D-TBD-<slug>` tokens the convention prescribes for an unreachable allocator. TWO test
edits say "use the surrounding file's own idiom" for an `mkTmp`/`seedRoster`/`await` spelling rather
than inventing another one (Task 8's `limits.test.ts` and `accounts-route.test.ts` additions) — the
assertions themselves are literal in every case. Task 9's cases are now spelled out in full
(`stubAccounts(...)` then `render(<AccountsScreen />)`, every `it` `async`), because "the
surrounding idiom" there was the difference between a working file and a parse error.

**Type consistency.** `AccountLimits.authDead` and `AccountUsage.authDead` are both `boolean` and both
REQUIRED on their interfaces, on `RosterWire.hidden`'s stated terms; every READER applies `=== true`
(`limits[a.id]?.authDead !== true` in `projectHome`, `a?.authDead === true` in `AccountsScreen`), so an
older payload that omits the field reads as "not condemned". `projectHome`'s signature is unchanged.
`LeastLoadedCase.authDead` is `string[] | undefined`, matching `disabled` beside it, and both seeders
default with `?? []`. `_authdead` and `_ah_*` take positional arguments only and return exit codes
only, so no bash caller reads stdout from them.

**Wire discipline.** One additive field, no `FLEET_PROTO` bump, absence-permits at the single reader
per side. `reviveFleetSession` is not involved — `AccountUsage` is not persisted through it.

**Risks handed to the implementer, all five named where they bite:**

1. **The endpoint origin is unmeasured in this tree** (D-TBD-authhealth-endpoint-origin). A wrong
   origin fails SILENTLY — every account reads "unmeasured", nothing is written, nothing is cleared,
   and the only trace is a journal line. Confirm it against the spec's E1 before the first fleet
   deploy, and confirm the first live pass writes or clears something rather than logging N
   unmeasureds.
2. **`ccrc-install.test.ts` may hold a list this plan did not find.** The five it does name are the
   ones a grep for `ccd-graph-sweep` surfaced; `:1877` and `:3256` are `.local/bin` listings that
   looked derived rather than enumerated when the plan was written but were not read line by line.
   Extend the list the failure names — never relax the assertion — and record it as a Deviation.
3. **`_check_credentials`'s effect on other `ccrc-doctor.test.ts` fixtures.** Every case that starts
   from `healthy()` inherits the planted token file, and `writeRoster` prepends `UPSTREAM` to any list
   that names no upstream account — so the eligible set is `{claude}` for nearly every case, and its
   file is there. Cases built on `writeRawRoster` (malformed rosters) reach the SKIP arm. `broken()`
   has no roster and reaches the SKIP arm too, which is safe: that fixture's only assertions are "every
   FAIL has a remedy" (`:5100-5105`) and "every line matches `PASS|WARN|FAIL|SKIP <name>: <detail>`",
   both of which a SKIP satisfies, and it carries no exact count pin.
   **The specific trigger to watch for is a case that supplies its OWN `kind: 'upstream'` entry**, so
   `writeRoster`'s prepend at `:277` does not fire and `UPSTREAM`'s new `telemetry: 'anthropic'` never
   reaches the file — the eligible set is then empty and `credentials` lands on the zero-eligible
   **SKIP** arm, moving that run's skip count. There is one such case on `main`
   (`ccrc-doctor.test.ts:2872`, `writeRoster(home, [{ id: 'up', exec: { kind: 'upstream' } }])`), and
   it asserts only `not.toMatch(/FAIL wrappers/)` and `code === 0`, both of which a SKIP satisfies —
   but `HEALTHY_SKIPS` is 0 on Linux (`:1085`) and is read by pins at `:1280`, `:1789`, `:1894`,
   `:3128`, `:4501`, `:5177` and `:5178`, so a NEW case of that shape would move one of them. Run the
   whole file, not the new describes.
4. **AGENT-FIRST is not optional here.** Tasks 1–7 all ship to the fleet host; Tasks 8–9 ship to the
   server. Deploy in that order, and remember that ~20 supervisors keep executing the pre-deploy inode
   until the `KillMode=process`-gated sweep restarts them — the bash half of this work is a no-op on
   live sessions until it runs. Do not hand-`install_atomic` anything to get around that.
5. **Task 2's `_swap_target` edit sits in bytes another merged plan replaces wholesale.** The spec
   says so itself (§10.5): *"2b Task 2 replaces `_swap_target`'s candidate loop wholesale and Task 3
   inserts into `_auto_swap_check` at three points. Both edits land in the same bytes."* Task 2 here
   inserts `_authdead "$cand" && sc=100` immediately after `ccd/ccd:11880`, inside that same loop, and
   account-pools wave 2b is a plan **merged to `main`** (`ece7597a`, #56) and **not yet opened** — so
   it is already in your checkout, and folding into it is an edit to a merged plan, not a rebase. **Whichever lands second
   must RE-APPLY the other's guard rather than merging it away** — a rewritten loop that silently
   drops the `_authdead` line takes the whole health signal out of the rescue lane with no test
   naming it. The line and its two mutations (delete → "prefers a measured healthy lane" reds;
   `continue` → "STILL RESCUES" reds) must both survive the replacement, and `ccd-authdead.test.ts`
   is the thing that says whether they did. Run it after any 2b rebase, not just after this plan.
