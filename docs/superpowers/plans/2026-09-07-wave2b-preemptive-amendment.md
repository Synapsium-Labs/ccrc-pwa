# Wave 2b amendment — the pre-emptive swap lane, its three guards and the convergence budget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wake the four dead swap constants by giving `_auto_swap_check`'s existing must-leave path an
earlier trigger, and pay for that trigger with three guards — freshness-and-headroom, a long quiet
wait, and a fleet-wide one-per-interval budget — while the rescue lane keeps every one of its
exemptions.

**Architecture:** This is **not a new lane**. Today's stay-shortcut is `_avail "$home"` (score under
`SWAP_CEILING`, 98); the pre-empt arms `force` earlier so `_swap_target`'s two "stay" branches are
skipped exactly as a hard block skips them, and `_swap_target`'s stdout contract, its `force`
semantics and the rescue arm are all byte-identical. One new helper (`_preempt_budget_take`) holds
a `flock`-serialised fleet-wide marker in the `swapblocked` shape; five insertions into
`_auto_swap_check` arm the force, price it and spend the budget.

**Tech Stack:** bash 5.2 (`set -uo pipefail`, no `-e`), `flock` (util-linux), vitest +
`makeCcdHarness` fixture HOMEs.

**Spec:** `docs/superpowers/specs/2026-09-07-account-health-and-provenance-design.md` §D

**Base:** `main` @ `58ef97b6` (account-pools waves 1 and 2a merged; 2b is a merged plan, unopened).
This file is an **AMENDMENT to `docs/superpowers/plans/2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md`**,
per spec R4 and §10 item 5. It adds seven tasks to that wave; it rewrites none of its eight and duplicates
none of them. Every task below names the wave-2b task it inserts after and the wave-2b line range it
is sequenced against.

---

## Global Constraints

- **Fixture HOMEs only.** Every ccd test goes through `makeCcdHarness(prefix)`
  (`server/test/ccdWsHelpers.ts`); `HOME` is ccd's single isolation boundary. Never run a `ccd` verb
  against the live `$HOME`; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or a
  `claude-session@*` unit.
- **No account name, pool name, label, host or IP in any shipped source file or test.** Account ids
  are `DEFAULT_TEST_ROSTER`'s (`server/test/helpers.ts:60-99`): `claude`, `claude-a`, `claude-b`,
  `gpt`, `claude-d`. Project fixture name is `demo`. `single-definition.test.ts` and
  `topology-clean.test.ts` scan the whole tree, docs included.
- **Node floor `>=22.13.0`, identical across all three engines.** Never lower engines to make a test
  green.
- **Run suites in the FOREGROUND with a timeout of at least 600000 ms**, from inside the package:
  `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. **Never bare `npx vitest`** — it
  resolves a global copy with no jsdom and falsely reports "no tests".
- **Wire discipline: additive only.** `FLEET_PROTO` stays 1. This amendment adds **no wire field at
  all** — the fleet-wide budget marker is dotless and per-fleet, and nothing under `server/`,
  `shared/` or `pwa/` reads it.
- **Mutation-table discipline:** every guard ships WITH a test that goes RED when the guard is
  deleted or mutated. Each task's `**Mutation table:**` block names the exact mutation and the
  expected red, measured before and after. A comment is a request; a red suite is a mechanism.
- **AGENT-FIRST for `ccd/`:** every change here is under `ccd/`, so `bash deploy/deploy.sh agent`
  (fleet host) precedes `bash deploy/deploy.sh` (server). Coordinates come from `~/.ccrc/deploy.env`;
  no host argument is needed on this fleet. The deploy is the operator's or the coordinator's act on
  merge, never this plan's implementer's — Task 7 states the order and runs none of it.
- **`EXEC_COMMANDS = ['tmux','ccd']` stays closed; no `gh` grant is added.** This amendment adds no
  whitelist entry at all, and no new ccd verb: everything rides the already-granted supervise tick.
- **No overloaded null at a seam.** `_swap_target`'s stdout overload is resolved at the caller and is
  deliberately **not** widened here (wave 2b's D-1673 argues that seam); the headroom test re-reads
  `_limit_score` rather than asking `_swap_target` to publish a second value.
- **Deviation numbers come only from the ledger allocator.** This plan's numbers are written
  `D-TBD-<slug>` and must be MINTED AND DEFINED IN THE SAME ACT before merge. See
  `## Deviations found`.

---

## Background the implementer needs

### 1. The four constants are dead, and that is measured

```bash
cd "$(git rev-parse --show-toplevel)" \
  && for c in SWAP_THRESHOLD SWAP_HEADROOM SWAP_FRESH SWAP_QUIET; do \
       printf '%s: ' "$c"; grep -c "$c" ccd/ccd; done
```

Answers `1` for each, and each of those single lines is the constant's own assignment
(`ccd/ccd:826`, `:827`, `:830`, `:831`):

```bash
SWAP_THRESHOLD=90               # own 5h % that arms a pre-emptive swap
SWAP_HEADROOM=30                # target must be at least this many points lower
SWAP_COOLDOWN=900               # min seconds between swaps of one session
SWAPBLOCK_COOLDOWN=1800         # min seconds before auto-swap retries a session whose last swap REFUSED
SWAP_FRESH=1800                 # telemetry younger than this qualifies for pre-emptive swaps
SWAP_QUIET=600                  # preempt only sessions quiet this long (any surface); rescue ignores
SWAP_CEILING=98                 # own 5h/7d % at/above which every turn is paid overage: cut the
                                # quiet wait short so we swap at the NEXT turn boundary, not 10min later
SWAP_CEIL_QUIET=30              # seconds of idle required before a non-blocked relocation (return-home / ceiling)
```

**Zero readers each.** Four comments describing behaviour the file does not have — and
`SWAP_CEILING`'s own comment at `:832-833` names a "10min" wait to cut short that nothing waits.
Wiring the four makes all five sentences literally true.

### 2. `SWAP_FRESH` would be the only non-zero `maxage` in the tree

`_limit_field` (`ccd/ccd:11728-11759`) takes a third parameter that has existed with no user:

```bash
_limit_field() {   # wrapper five|seven [maxage-secs] -> that limit %, or "" if unknown/stale
  local f="$LIMITS_DIR/$1.json" field="$2" maxage="${3:-0}" val ts now reset
  ...
  if [[ "$maxage" -gt 0 && ( -z "$ts" || $((now - ts)) -gt "$maxage" ) ]]; then return 0; fi
```

Every call site in the tree, measured with `grep -n '_limit_field \|_limit_five ' ccd/`:

| site | argument |
|---|---|
| `ccd/ccd:1268` | `_limit_field gpt five` / `_limit_field gpt seven` — no third arg, defaults to `0` |
| `ccd/ccd:11760` | `_limit_five() { _limit_field "$1" five "${2:-0}"; }` — the shim, and it has **no callers of its own** |
| `ccd/ccd:11767` | `_limit_field "$1" five 0` and `_limit_field "$1" seven 0` — both explicit `0` |

So `maxage > 0` is a branch nothing takes. Task 3 gives it its first and only user.

### 3. The quiet gate needs no new machinery

`_auto_swap_check` (`ccd/ccd:11895-11983`) already does every part of the quiet test except making
the threshold a variable:

| line | what it already does |
|---|---|
| `:11968` | `echo "$pane" \| grep -q "esc to interrupt" && return 0` — refuses mid-turn |
| `:11969` | `echo "$pane" \| grep -q "❯" \|\| return 0` — refuses off-prompt |
| `:11971-11974` | reads `sessions/<pane_pid>.json` and requires `[[ "$st" == "idle" ]]` |
| `:11977` | reads `statusUpdatedAt` (ms, ticks on every busy↔idle transition from ANY surface) |
| `:11978` | `[[ -n "$sua" && $(( now * 1000 - sua )) -ge $(( SWAP_CEIL_QUIET * 1000 )) ]] \|\| return 0` |

`SWAP_QUIET` just makes `quiet_req` a variable again, exactly as the removed code had it.

### 4. The removed logic, recovered

`git show 0bfd0c26 -- ccd/ccd` (Tue Jul 7 2026, *"feat(ccd): home-account affinity + spend-cap
awareness for auto-swap"*). Its own body states the removal reason and the consequence:

> Replaces the preempt/headroom swap policy (which herded all sessions onto one
> account, blew its 5h, and jumped en masse) with per-session HOME affinity
> …
> Old SWAP_THRESHOLD/HEADROOM/FRESH/QUIET now unused.

The pre-image (`git show 0bfd0c26^:ccd/ccd`, `_auto_swap_check` at its `:109-168`) carried:

```bash
  for cand in $pool; do
    [[ "$cand" == "$wrapper" ]] && continue
    [[ -x "$WRAPPER_DIR/$cand" ]] || continue
    five=$(_limit_score "$cand"); : "${five:=0}"      # never-seen target ≈ assume free
    [[ "$five" -lt "$best_five" ]] && { best="$cand"; best_five="$five"; }
  done
  ...
  # Own pressure = max(fresh 5h, day-fresh 7d): weekly exhaustion evacuates too.
  local own_five own_seven
  own_five=$(_limit_field "$wrapper" five "$SWAP_FRESH")
  own_seven=$(_limit_field "$wrapper" seven 86400)
  own=""; for v in $own_five $own_seven; do [[ -z "$own" || "$v" -gt "$own" ]] && own="$v"; done
  [[ -n "$own" ]] || return 0
  [[ "$own" -ge "$SWAP_THRESHOLD" ]] || return 0
  [[ $((own - best_five)) -ge "$SWAP_HEADROOM" ]] || return 0
  ...
  local quiet_req="$SWAP_QUIET" reason="auto-preempt"
  [[ "$own" -ge "$SWAP_CEILING" ]] && { quiet_req="$SWAP_CEIL_QUIET"; reason="auto-ceiling"; }
  sua=$(grep -oE '"statusUpdatedAt":[0-9]+' "$sf" 2>/dev/null | head -1 | cut -d: -f2)
  [[ -n "$sua" && $(( now * 1000 - sua )) -ge $(( quiet_req * 1000 )) ]] || return 0
```

Two things about that block are **not** restored, deliberately, and each is a deviation below:

- The `: "${five:=0}"` magnet — "never-seen target ≈ assume free" — is the exact defect the shipped
  tree already fixed twice (`_swap_target`'s `: "${sc:=100}"` at `ccd/ccd:11880` with its
  seventeen-line argument; `_ws_least_loaded`'s skip at `ccd/ccd:3870`). Nothing here reintroduces
  it.
- `own_seven=$(_limit_field "$wrapper" seven 86400)` — a **second** non-zero `maxage`. Restoring it
  would falsify §2 above and `SWAP_THRESHOLD`'s own "own 5h %" comment.
  (**D-TBD-preempt-weekly-arm-dropped**.)

### 5. What killed it, and why `SWAP_JITTER` does not cover it

`cmd_supervise` is **one process per session**, and that is a property of the unit file, not an
assumption: `ccd/claude-session@.service:23` is `ExecStart=%h/.local/bin/ccd supervise %i` — a
systemd **template**, instantiated as `claude-session@<id>.service`. Each instance runs
`ccd/ccd:13207`'s `local beat=0 unknown_run=0 tick=5` loop and calls `_auto_swap_check "$id"` at
`ccd/ccd:13215`. The file's own comment at `ccd/ccd:13224` sizes the herd: *"17 supervisors hammering
a wedged server every 5s is a thundering herd against a component already unwell."*

Twenty such processes read the same `~/.cc-limits` and each takes the argmin
(`_swap_target`'s `sc=$(_limit_score "$cand"); [[ "$sc" -lt "$best_score" ]]`, `ccd/ccd:11880-11881`).
**They converge because they agree, not because of a loop.** `SWAP_JITTER` (`ccd/ccd:835`,
consumed at `ccd/ccd:11684`) staggers *when* a dispatched swap runs and never *which account it
picks*: its own comment says it fixed the 2026-08-13 **resource** herd (simultaneous restarts → 19
concurrent scans → a 9.7 h stall). The 2026-07-07 failure was a **placement** herd. Two different
herds; only one was fixed.

### 6. The marker shape to copy

`_swap_refuse` writes the tree's one durable-fault marker (`ccd/ccd:13598-13599`):

```bash
  local id="$1" cur="$2" target="$3" reason="$4" restart="${5:-0}"
  _reg_set "$id" swapblocked "$(date +%s) $reason"
```

and `_auto_swap_check` reads it back with a **read-side cooldown whose digit validation is first
inside the same `[[ ]]`** (`ccd/ccd:11903-11910`):

```bash
  # ... The epoch is VALIDATED as digits rather
  # than trusted: ccd runs under `set -u`, where `$(( now - garbage ))` on a hand-edited
  # or half-written field emits an unbound-variable line on every single tick.
  blocked=$(_reg_get "$id" swapblocked); bts="${blocked%% *}"
  [[ "$bts" =~ ^[0-9]+$ && $((now - bts)) -lt "$SWAPBLOCK_COOLDOWN" ]] && return 0
```

Nothing collects `swapblocked`; a spent one simply ages out of that comparison. The budget marker
copies all of it.

### 7. The flock idiom to copy

`_lc_rotate` (`ccd/ccd:2176-2220`, `:2296-2300`) is the tree's one **die-free, refusal-free** lock,
and its comments state both halves of the contract:

```bash
  # DIE-FREE AND REFUSAL-FREE, unlike every other flock site in this file
  # (all of which `die` when `flock` is unavailable or contested). ...
  # `.rotate.lock` is NEVER unlinked — unlinking a lock file while another
  # process holds it is exactly how two processes come to hold "the lock" on
  # two different inodes.
  ...
  { exec {lfd}>>"$lock"; } 2>/dev/null || return 0
  flock -n "$lfd" 2>/dev/null || { exec {lfd}>&-; return 0; }
  ...
  # A CONTRACT, NOT HYGIENE: flock treats two open()s of one path in one
  # process as two strangers, and ccd is SOURCED, so a descriptor left open
  # here refuses the NEXT rotation in the same shell.
  exec {lfd}>&-
```

`flock` is not a new dependency: `ccd/ccrc-doctor-checks:484-485` already requires it by name, and
`ccd/ccrc:3792-3793` refuses to run without it.

`_lc_rotate` also demonstrates the thing this plan most needs — **the question is re-asked under the
lock** (`ccd/ccd:2222-2236`: *"the question under the lock is 'has someone ELSE already rotated'"*,
after measuring that two concurrent processes minted two generations from one event in 8 of 10 runs).

### 8. Wave 2b's line anchors are pre-2a snapshots — re-derive, do not trust

Wave 2b's plan was written against `origin/main` `2b15144e`; waves 1 and 2a have merged since
(`07ce360e`, `58ef97b6`), moving `ccd/ccd` by roughly +686 lines in this region. Its anchors and the
anchors this amendment uses:

| region | wave 2b says | `58ef97b6` says |
|---|---|---|
| `_swap_target` locals → candidate loop | `:11155-11169` | `:11841-11855` |
| `_swap_target` closing `}` | — | `:11884` |
| `_pane_hard_blocked` | — | `:11886-11893` |
| `_auto_swap_check` body opens | `:11213-11214` | `:11899-11900` |
| `_pane_hard_blocked` call → `|| return 0` | `:11241-11243` | `:11927-11929` |
| the affinity arm's log verb | `:11294` | `:11980` |
| `_swap_refuse` closing `}` / `cmd_swap` | `:12962` / `:12964` | `:13648` / `:13650` |
| `_reg_purge` dot-free inventory | `:1315-1320` | `:1573-1585` |

**Line anchors are snapshots. Where an anchor and the shipped source disagree, the source wins.**

### 9. §B is a hard prerequisite, not a preference

Spec §D.4: *"W6 must not ship before §B."* The target-side reason is measurable today. A rolled-over
window is rewritten to a confident `0` in both languages —

```bash
  reset=$(_limit_json_num "$f" "${field}ResetAt")
  if [[ -n "$val" && -n "$reset" && "$now" -ge "$reset" ]]; then
    printf '0'; return 0
  fi
```

(`ccd/ccd:11746-11749`; the TS mirror is `server/src/limits.ts:142-145`, whose own
`fiveRolledOver`/`sevenRolledOver` flags *name* the distinction and then overwrite the value anyway).
`_limit_score` then returns `max(0,0) = 0`, and `_swap_target`'s strict `<` (`ccd/ccd:11881`) makes
that `0` beat every honest account on the fleet. Nothing runs on a dead account, so nothing ever
reports a real number, so it stays `0` for ever.

Today that magnet only aims **rescues**. With §D it would aim a **voluntary** swap at a dead account,
on a fleet-wide schedule. Task 1 is the gate that refuses to let this plan start until §B has landed.

---

## File Structure

| File | Responsibility |
|---|---|
| `ccd/ccd` (modify) | `SWAP_PREEMPT_BUDGET` constant; `_preempt_budget_take`; five insertions into `_auto_swap_check` (arm, force, price, quiet variable, budget spend) |
| `server/test/ccd-preempt.test.ts` (create) | The whole pre-empt lane: the §B gate, the budget helper, the arming, the three guards, and the rescue exemption |
| `server/test/ccd-arith-containment.test.ts` (modify) | One payload case and three `SITES` rows for the three new arithmetic operands |

**Why a new test file rather than extending wave 2b's `ccd-auto-swap-pool.test.ts`:** that file's
docstring states its subject as *"the pool half of the 5-second auto-swap tick"*, and its whole
fixture vocabulary is pool tags. A pre-empt has nothing to do with pools — it fires on an untagged
project exactly as it fires on a tagged one — and putting it there would make that file's title a
lie. The two files share only `makeCcdHarness` and the roster fixture.

**Checked before writing:** `single-definition.test.ts` scans for named vocabularies (`UNCHECKED_PR`,
the reason vocabulary, auth verdicts, the ccd script path, `KeyedQueue`, `sessionLabel`, Build 7
nouns, `ReadFailure`, the roster). `SWAP_PREEMPT_BUDGET`, `preempt-budget` and
`_preempt_budget_take` are none of them, and each is defined in exactly one place. This test file
does **not** spell the ccd script path — it imports `CCD` from `ccdWsHelpers.ts`, which is the one
scan that would otherwise apply.

---

### Task 1: the §B prerequisite gate, and the suite's header

**Inserts:** **BEFORE wave 2b Task 1.** It touches no `ccd/ccd` byte, so it is sequenced against
nothing in wave 2b; it is placed first because it is a go/no-go and every later task is wasted work
if it reds.

**Files:**
- Create: `server/test/ccd-preempt.test.ts`

**Interfaces:**
- Consumes: `makeCcdHarness(prefix)` and `CCD` from `server/test/ccdWsHelpers.js`; `_limit_field
  <wrapper> five|seven [maxage]` from `ccd/ccd:11728` (stdout: the percentage, or `""` for
  unknown/stale; always rc 0).
- Produces: `server/test/ccd-preempt.test.ts` with its header, its `h` harness, and the standing
  assertion that §B has landed. Tasks 2–6 append to this file.

**Mutation table:** this task's guard IS the mutation — it is red on `main` today and green only
after §B lands. Reverting §B's `_limit_field` change reds it again, which is the point: the pre-empt
lane may not exist on a tree where a rolled-over account is the most attractive destination on the
fleet.

- [ ] **Step 1: Write the gate**

Create `server/test/ccd-preempt.test.ts`:

```ts
// The PRE-EMPTIVE swap lane (spec §D) — the earlier trigger, its three guards,
// and the rescue lane's exemption from every one of them.
//
// NOT A NEW LANE. `_auto_swap_check`'s must-leave path is unchanged; what
// changes is when `force` is armed. Today's stay-shortcut is `_avail "$home"`
// — score under SWAP_CEILING (98) — and this arms `force` at SWAP_THRESHOLD
// (90) instead, on FRESH telemetry only. `_swap_target`'s stdout contract, its
// `force` semantics, its candidate loop and the rescue arm are all untouched.
//
// THE CONVERGENCE GUARD IS THE POINT OF THIS FILE. The policy this restores
// was removed on 2026-07-07 (0bfd0c26) because it "herded all sessions onto one
// account, blew its 5h, and jumped en masse". `SWAP_JITTER` does not fix that:
// `claude-session@.service` is a systemd TEMPLATE, so `cmd_supervise` is one
// process per session (~20 live, 17 measured starting in the same second), each
// reading the same ~/.cc-limits and each taking the argmin. They converge
// because they AGREE. Jitter staggers when a dispatched swap runs, never which
// account it picks.
//
// `_swap_target`, `_avail`, `_limit_field`, `_limit_score` and
// `_pane_hard_blocked` are all left REAL here — the decision under test is a
// function of telemetry and of the pane classifier, and a stub for any of them
// would test the fixture rather than the lane. Only `tmux`, `_dispatch_swap`
// and `flock`'s absence are ever simulated — the third exactly once, in
// "refuses, rather than dying, when `flock` is not on PATH", by shadowing the
// `command` builtin with a function.
//
// FIXTURE HOME ONLY (`makeCcdHarness`) — HOME is ccd's single isolation
// boundary and nothing here may reach the live registry, tmux, or systemd.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-preempt-'); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const PANE_PID = '4242';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const logLines = (verb: string): string[] =>
  swapLog().split('\n').filter((l) => l.includes(` ${verb} `));

/** The fleet-wide budget marker. DOTLESS and per-fleet, so `h.reg()` — which
 *  spells `<id>.<field>` — cannot reach it and this reads the path directly. */
const budget = (): string | null => {
  const p = reg('preempt-budget');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
};

const now = (): number => Math.floor(Date.now() / 1000);

/** `~/.cc-limits/<w>.json` in statusline-command.sh's own compact shape, with
 *  `ts` under the caller's control so SWAP_FRESH can be exercised. */
const writeLimits = (w: string, five: number, seven: number, ageS = 0): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: now() - ageS }));
};

describe('§D may not be built on a tree without §B (spec §D.4)', () => {
  it('a rolled-over window reads UNKNOWN, not a confident 0', () => {
    // THE TARGET-SIDE HAZARD, and it is the reason this gate is Task 1. Under
    // `_limit_field`'s pre-§B `printf '0'` branch a rolled-over account scores
    // max(0,0) = 0, and `_swap_target`'s strict `<` makes that beat every
    // honest account on the fleet. Nothing runs there, so nothing ever reports,
    // so it stays 0 for ever. Today that magnet only aims RESCUES. With the
    // pre-empt lane it would aim a VOLUNTARY swap at a dead account, on a
    // fleet-wide schedule.
    const t = now();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-b.json'),
      JSON.stringify({ five: 40, seven: 40, ts: t - 60, fiveResetAt: t - 10, sevenResetAt: t - 10 }));
    expect(
      h.sh('_limit_field claude-b five 0'),
      '§B (the provenance fix) has NOT landed on this branch. Stop: do not implement §D on top of '
      + 'it. A rolled-over target reads a confident 0, wins the argmin outright, and the pre-empt '
      + 'would aim a voluntary swap at a dead account.',
    ).toBe('');
  });
});
```

- [ ] **Step 2: Run it and read the answer**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts
```

Two outcomes, and they are a fork in the plan:

- **FAIL with `expected '0' to be ''`** — §B has not landed. **STOP.** Do not proceed to Task 2. §B
  is `docs/superpowers/specs/2026-09-07-account-health-and-provenance-design.md` §5, a separate,
  earlier PR. Report the block and wait.
- **PASS (1 test)** — §B is in. Continue.

- [ ] **Step 3: Commit**

```bash
git add server/test/ccd-preempt.test.ts
git commit -m "test(ccd): the pre-empt lane refuses to exist on a tree where a rolled-over account is the magnet (D-TBD-preempt-b-gate)"
```

---

### Task 2: the fleet-wide budget — `SWAP_PREEMPT_BUDGET` and `_preempt_budget_take`

**Inserts:** **AFTER wave 2b Task 4.** Its `ccd/ccd` insertion sits between `_pane_hard_blocked`'s
closing `}` (`:11893`) and `_auto_swap_check`'s header (`:11895`) — a region **no wave-2b task
touches at all** (2b Task 2 edits `:11841-11855`; 2b Tasks 3 and 4 edit inside `_auto_swap_check`
from `:11899` down). Placed after 2b Task 4 rather than earlier only so that
`_auto_swap_check`'s pool block is already in its final shape when Task 3 edits inside it.

**Files:**
- Modify: `ccd/ccd:826-835` — one constant, added to the account-swap tuning block.
- Modify: `ccd/ccd:11893-11895` — one function, inserted between `_pane_hard_blocked`'s closing `}`
  and `_auto_swap_check`.
- Test: `server/test/ccd-preempt.test.ts` (Modify)

**Interfaces:**
- Consumes: `REG` (`ccd/ccd:765`); `_reg_purge <id>` (`ccd/ccd:1552`); `flock(1)`;
  `_lc_rotate`'s die-free lock idiom (`ccd/ccd:2219-2220`, `:2299`).
- Produces:
  - `SWAP_PREEMPT_BUDGET=900` — min seconds between PRE-EMPTIVE swaps across the whole fleet.
  - `_preempt_budget_take <id>` → **rc 0 iff THIS process won the fleet's one pre-empt slot in this
    interval**, in which case `$REG/preempt-budget` now holds `"<epoch> <id>"`. rc 1 otherwise, and
    on rc 1 nothing on disk changed. Never dies, never writes to stdout or stderr.

**Spec:** §D.3 (the convergence guard).

**Mutation table:**
- Delete the `flock -n "$lfd" …` line (i.e. make the compare-and-stamp unserialised) → **red**: "two
  callers racing the same open budget both take it" fails with `expected [ 'took', 'took' ] to
  contain 'declined'`.
- Delete `"$ts" =~ ^[0-9]+$ && ` from the cooldown guard → **red** on both the payload case in
  `ccd-arith-containment.test.ts` (Task 6) and, here, "a torn stamp is not evaluated" fails with
  `expected true to be false`.
- Change `-lt` to `-gt` in the cooldown guard → **red**: "a second caller inside the interval
  declines" fails with `expected 'took' to be 'declined'`.
- Delete `exec {lfd}>&-` from the success path → **red**: "a second call in the same shell still
  works" fails, because flock treats two `open()`s of one path in one process as two strangers and
  the leaked descriptor refuses the next take.
- Add `rm -f -- "$lock"` anywhere → **red**: "the lock file is never unlinked" fails with
  `expected false to be true`.
- Delete `command -v flock >/dev/null 2>&1 || return 1` → **red**: "refuses, rather than dying, when
  `flock` is not on PATH" fails with `expected 'took' to be 'declined'`. The stubbed `command`
  function shadows only the builtin; the real `flock` binary is still on PATH and still succeeds, so
  without the probe the take goes through and stamps the marker.

`LEDGER: the spec asks for a read-side cooldown in the swapblocked shape, and a bare read-side compare cannot deliver "at most one pre-emptive swap per interval across the fleet" — ~20 independent supervisors read the same open budget in the same second and all pass; the compare is therefore re-asked INSIDE a `flock -n`, the same shape _lc_rotate measured into existence at ccd:2222-2236 (D-TBD-preempt-convergence-budget).`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-preempt.test.ts`:

```ts
describe('_preempt_budget_take — the fleet-wide convergence guard (§D.3)', () => {
  const take = (id = ID): string =>
    h.sh(`_preempt_budget_take ${id} && echo took || echo declined`);

  it('the first caller wins, and stamps the swapblocked shape', () => {
    expect(take()).toBe('took');
    expect(budget()).toMatch(new RegExp(`^\\d{10} ${ID}$`));
  });

  it('a second caller inside the interval declines, and the stamp does not move', () => {
    expect(take()).toBe('took');
    const first = budget();
    expect(take('claude-other')).toBe('declined');
    expect(budget(), 'a decline writes nothing at all').toBe(first);
  });

  it('a caller past the interval wins again, and the stamp advances', () => {
    // SWAP_PREEMPT_BUDGET is 900 s; back-date the stamp past it. The marker is
    // DOTLESS and fleet-wide, so it is written by hand here rather than by
    // `_reg_set`, which always spells `<id>.<field>`.
    fs.writeFileSync(reg('preempt-budget'), `${now() - 901} claude-earlier`);
    expect(take()).toBe('took');
    expect(budget()).toMatch(new RegExp(`^\\d{10} ${ID}$`));
  });

  it('two callers racing the same open budget do not both take it', () => {
    // The whole guard, measured. Two real processes, launched together, both
    // seeing an ABSENT marker. Without the lock both read "open" and both
    // stamp — which is the 2026-07-07 herd with an extra file in it.
    const out = h.sh(
      '{ _preempt_budget_take a && echo took || echo declined; } &'
      + ' { _preempt_budget_take b && echo took || echo declined; } &'
      + ' wait');
    const answers = out.split('\n').map((l) => l.trim()).filter(Boolean).sort();
    expect(answers, 'exactly one winner per interval, decided by flock and not by the tick')
      .toEqual(['declined', 'took']);
  });

  it('a torn stamp is not evaluated, and opens the budget exactly once', () => {
    // FAIL-OPEN ON A TORN FIELD, matching `_auto_swap_check`'s own swapblocked
    // gate (ccd:11909-11910) rather than inventing a second convention: the
    // digit guard fails, the comparison falls through, the take succeeds, and
    // the marker is immediately overwritten with a valid stamp. Self-healing,
    // and stated rather than hidden (D-TBD-preempt-torn-budget-opens).
    // THE PAYLOAD MUST CONTAIN NO LITERAL SPACE, and this is measured, not
    // assumed. `ts="${raw%% *}"` truncates at the FIRST space, so the familiar
    // `REG[$(touch "$HOME/…")]` spelling arrives at the arithmetic as the
    // fragment `REG[$(touch` — which bash refuses outright ("bad array
    // subscript (error token is \"REG[$(touch\")") without running anything,
    // even with the digit guard deleted. That is a test that passes under its
    // own mutation and proves nothing. `${IFS}` carries the word break
    // instead: measured on bash 5.2.21, the space-free form FIRES with the
    // guard removed and does not fire with it restored.
    fs.writeFileSync(reg('preempt-budget'),
      'REG[$(touch${IFS}"$HOME/PWNED-budget")] torn');
    expect(take()).toBe('took');
    expect(fs.existsSync(path.join(h.home, 'PWNED-budget')),
      'the payload reached the arithmetic').toBe(false);
    expect(budget(), 'and the torn field is gone').toMatch(new RegExp(`^\\d{10} ${ID}$`));
    expect(take()).toBe('declined');
  });

  it('the marker is DOTLESS and outlives the session that spent it', () => {
    // `_reg_purge` matches the SUFFIX shape `<id>.<field>` — exactly one dot
    // after the id (ccd:1567-1571). A dotless name can never be eaten by a
    // session purge, which is right: the budget belongs to the FLEET.
    h.sh(`_reg_set ${ID} uuid 11111111-1111-4111-8111-111111111111`);
    expect(take()).toBe('took');
    h.sh(`_reg_purge ${ID}`);
    expect(h.reg(ID, 'uuid'), 'the purge really ran').toBeNull();
    expect(budget(), 'the fleet budget is not a session field').not.toBeNull();
  });

  it('never unlinks its lock file, and a second call in the same shell still works', () => {
    // TWO CONTRACTS IN ONE CASE, both `_lc_rotate`'s (ccd:2179-2181, :2296-2299).
    // Unlinking a lock another process holds is how two processes come to hold
    // "the lock" on two different inodes; and a descriptor left open refuses
    // the NEXT take in the same sourced shell.
    const out = h.sh(
      '_preempt_budget_take a >/dev/null 2>&1;'
      + ' rm -f "$HOME/.cc-sessions/preempt-budget";'
      + ' _preempt_budget_take b && echo second-took || echo second-declined');
    expect(out).toBe('second-took');
    expect(fs.existsSync(reg('.preempt-budget.lock'))).toBe(true);
  });

  it('refuses, rather than dying, when `flock` is not on PATH', () => {
    // THE ONE THING THIS FILE SIMULATES BESIDES tmux AND _dispatch_swap, and
    // it is the plan's own risk 3 turned into a mechanism. `command` is a
    // REGULAR builtin, so a shell function of that name shadows it and
    // `command -v flock` answers 1; the real `flock` binary is untouched,
    // which is what makes DELETING the probe observable — without it the take
    // reaches a `flock` that works and succeeds.
    //
    // Refusal is the SAFE direction: a pre-empt is an optimisation, not a
    // rescue, so a box without `flock` simply never pre-empts and the rescue
    // arm — which never calls this — is unaffected. No doctor check is added:
    // `ccd/ccrc-doctor-checks:484-485` already requires the binary by name and
    // `ccd/ccrc:3792-3793` refuses to run without it.
    expect(h.sh('command() { return 1; };'
      + ` _preempt_budget_take ${ID} && echo took || echo declined`)).toBe('declined');
    expect(budget(), 'and it stamps nothing on the way out').toBeNull();
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts
```

Expected: the §B gate passes; **seven of the eight new cases fail.** `_preempt_budget_take` does not
exist, so `bash` writes `_preempt_budget_take: command not found` to stderr and exits 127 — which the
`|| echo declined` in `take()` swallows, so the failures read as assertions, not as thrown errors:

- `expected 'declined' to be 'took'` — **cases 1, 2, 3, 5 and 6**. Each of the five OPENS on a
  `take()` and dies there; none of them reaches the assertion that follows it, so no other text
  appears for them.
- `expected [ 'declined', 'declined' ] to deep equal [ 'declined', 'took' ]` — case 4.
- `expected 'second-declined' to be 'second-took'` — case 7.

The eighth, "refuses, rather than dying, when `flock` is not on PATH", **passes before the change**:
a command-not-found is also a refusal, and nothing is stamped either way. It is vacuous now and a
regression guard after Step 4, and Step 6's fourth mutation is what proves it.

**Record the actual output** — this is the measured red half of the mutation table.

- [ ] **Step 3: Add the constant**

In `ccd/ccd`, immediately after `SWAP_CEIL_QUIET=30 …` (currently `:834`) and before
`SWAP_JITTER=120 …` (currently `:835`):

```bash
SWAP_PREEMPT_BUDGET=900         # min seconds between PRE-EMPTIVE swaps across the WHOLE FLEET.
                                # Not a per-session gate — SWAP_COOLDOWN above is that. This is the
                                # convergence guard for the policy 0bfd0c26 removed on 2026-07-07,
                                # which "herded all sessions onto one account, blew its 5h, and
                                # jumped en masse": ~20 supervisors read one ~/.cc-limits and take
                                # one argmin, so they agree on one destination without any loop
                                # between them, and SWAP_JITTER staggers only WHEN a dispatched swap
                                # runs. One mover per interval provably cannot herd: the next
                                # session re-reads telemetry that now includes the first one.
                                # 900 s equals SWAP_COOLDOWN deliberately — the fleet-wide floor is
                                # never tighter than a single session's own — and comfortably
                                # exceeds the jitter window (<=120 s) plus the 1-113 s measured from
                                # a landing to its first telemetry report.
                                # A BARE LITERAL, not `${SWAP_PREEMPT_BUDGET:-900}`, for the reason
                                # ccd-arith-containment.test.ts:104-111 pins about SWAP_JITTER: an
                                # env-reachable operand is an env-reachable arithmetic context, and
                                # CCD_DISK_FLOOR_GB (ccd:3877-3880) is the one override ccd honours.
```

- [ ] **Step 4: Write `_preempt_budget_take`**

In `ccd/ccd`, immediately after `_pane_hard_blocked`'s closing `}` (currently `:11893`) and before
`_auto_swap_check() {` (currently `:11895`), insert:

```bash
_preempt_budget_take() {   # id -> rc 0 iff THIS process won the fleet's one pre-empt slot
  # THE COMPARISON IS NOT THE DECISION, and that gap is the whole convergence
  # guard. `cmd_supervise` is ONE PROCESS PER SESSION and that is a property of
  # the unit file, not an assumption: `ccd/claude-session@.service` is a systemd
  # TEMPLATE (`ExecStart=%h/.local/bin/ccd supervise %i`), instantiated as
  # `claude-session@<id>.service`. Each instance runs the 5-second tick loop
  # (ccd:13207) and calls `_auto_swap_check` from it (ccd:13215); ~20 are live
  # and 17 were measured starting in the same second (ccd:13224). Each reads the
  # same ~/.cc-limits and each takes the argmin (ccd:11880-11881), so they agree
  # on ONE destination with no loop between them.
  #
  # That is the 2026-07-07 herd — 0bfd0c26 removed the pre-empt policy because
  # it "herded all sessions onto one account, blew its 5h, and jumped en masse"
  # — and SWAP_JITTER does not touch it. Jitter staggers WHEN a dispatched swap
  # runs and never WHICH account it picks; it fixed the 2026-08-13 RESOURCE
  # herd, not this PLACEMENT one. Twenty processes would therefore all pass a
  # bare read-side compare in the same second, which is the same herd with an
  # extra file in it.
  #
  # SO THE COMPARE IS RE-ASKED UNDER THE LOCK. This is `_lc_rotate`'s shape
  # (ccd:2219-2220, :2222-2236, :2296-2299), including the sentence it measured
  # into existence: "the question under the lock is has someone ELSE already
  # acted". Its other two contracts are copied verbatim — the lock file is NEVER
  # unlinked, because unlinking one while another process holds it is how two
  # processes come to hold "the lock" on two different inodes; and the
  # descriptor is CLOSED on every exit, because flock treats two open()s of one
  # path in one process as two strangers and ccd is SOURCED.
  #
  # DIE-FREE AND REFUSAL-FREE, and refusal is the SAFE direction. A pre-emptive
  # swap is an optimisation, not a rescue: declining one costs time and nothing
  # else. No flock on PATH, an unopenable lock, a contested lock, an unwritable
  # registry — every one of them answers "not now". THE RESCUE ARM NEVER CALLS
  # THIS (see _auto_swap_check): hard-blocked stays immediate, unbounded, no
  # quiet wait, no headroom test, no budget.
  local id="$1" now raw ts lock lfd
  now=$(date +%s)
  command -v flock >/dev/null 2>&1 || return 1
  lock="$REG/.preempt-budget.lock"
  # The COMPOUND, not the bare `exec`, carries the redirect: bash installs a
  # command's redirections in order, so a trailing 2>/dev/null on the bare form
  # is not yet active when the failing open is reported (ccd:2190-2218).
  { exec {lfd}>>"$lock"; } 2>/dev/null || return 1
  flock -n "$lfd" 2>/dev/null || { exec {lfd}>&-; return 1; }
  # `swapblocked`'s shape verbatim (_swap_refuse, ccd:13599): "<epoch> <reason>",
  # and the reason here is the session that spent the slot. THE DIGIT
  # VALIDATION IS FIRST inside the same `[[ ]]`, so `&&` short-circuits before
  # the arithmetic ever sees a torn or hand-edited field (D-299's class, and the
  # same shape as _auto_swap_check's own swapblocked gate at ccd:11910). NOTHING
  # COLLECTS this marker: a spent budget simply ages out of the comparison.
  # A TORN field FAILS OPEN — the guard is false, the compare falls through, one
  # pre-empt goes through and the write below replaces the torn value with a
  # valid stamp. Same direction the swapblocked gate takes, and self-healing.
  raw=$(cat "$REG/preempt-budget" 2>/dev/null); ts="${raw%% *}"
  [[ "$ts" =~ ^[0-9]+$ && $((now - ts)) -lt "$SWAP_PREEMPT_BUDGET" ]] \
    && { exec {lfd}>&-; return 1; }
  # DOTLESS, and deliberately not written through `_reg_set` — that function
  # spells `$REG/<id>.<field>`, and a single dot is exactly what `_reg_purge`
  # eats with a session row (ccd:1567-1571). The budget belongs to the FLEET and
  # must outlive every session that spends it, so it joins the dotless
  # fleet-wide family beside `coordinator-paused` and `autocompact-disabled`.
  # It is NOT a `-disabled` suffix, so `readLimits`'s lane harvest
  # (server/src/limits.ts:118-121, :181-187) cannot mistake it for an account.
  #
  # FAIL CLOSED ON AN UNWRITABLE REGISTRY. A budget that cannot be stamped is a
  # budget that cannot be spent; failing open would silently retire the guard
  # the moment ~/.cc-sessions went read-only.
  { printf '%s %s' "$now" "$id" > "$REG/preempt-budget"; } 2>/dev/null \
    || { exec {lfd}>&-; return 1; }
  exec {lfd}>&-
  return 0
}
```

- [ ] **Step 5: Run the suite to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 6: Measure the mutations**

Four, one at a time, restoring between each:

1. Delete the `flock -n "$lfd" 2>/dev/null || { exec {lfd}>&-; return 1; }` line, re-run, and confirm
   "two callers racing the same open budget do not both take it" goes red with
   `expected [ 'took', 'took' ] to deep equal [ 'declined', 'took' ]`. Restore.
2. Delete `"$ts" =~ ^[0-9]+$ && ` from the cooldown guard, re-run, and confirm "a torn stamp is not
   evaluated" goes red with `expected true to be false` — the `${IFS}` payload runs. Restore.
3. Change `-lt` to `-gt` in the cooldown guard, re-run, and confirm "a second caller inside the
   interval declines" goes red with `expected 'took' to be 'declined'`. Restore.
4. Delete `command -v flock >/dev/null 2>&1 || return 1`, re-run, and confirm "refuses, rather than
   dying, when `flock` is not on PATH" goes red with `expected 'took' to be 'declined'`. Restore.

Record before/after in the commit message.

If mutation 1 is GREEN with the lock deleted, the two background jobs are not actually racing on this
box. **Do not accept the green**: widen the race by wrapping each call in a short spin
(`for ((i=0;i<50;i++)); do _preempt_budget_take …; done`) and re-measure. A guard whose mutation
cannot be shown is not yet a mechanism.

If mutation 2 is GREEN, the payload did not reach the arithmetic and the case is vacuous. The cause
is almost always a literal SPACE in the planted value: `ts="${raw%% *}"` truncates at the first one,
and the fragment `REG[$(touch` is a bad array subscript bash refuses without running anything. Keep
the `${IFS}` spelling.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-preempt.test.ts
git commit -m "feat(ccd): a fleet-wide pre-empt budget, decided by flock and not by the tick (D-TBD-preempt-convergence-budget)

~20 supervisors are ~20 processes reading one ~/.cc-limits and taking one
argmin, so a bare read-side compare is passed by all of them in the same
second. The compare is re-asked under the lock.

Mutations measured, each restored: deleting the flock line reds 1; deleting
the =~ ^[0-9]+ guard reds 1 (the \${IFS} payload runs); -lt -> -gt reds 1;
deleting the command -v flock probe reds 1."
```

---

### Task 3: the arming — `SWAP_FRESH`, `SWAP_THRESHOLD`, and the force

**Inserts:** **AFTER Task 2.** It edits two lines that wave 2b Task 3 Step 3 writes, so it **must be
sequenced after wave 2b Task 3** — and after wave 2b Task 4 Step 3, which replaces the
`_crosspool_valid` line inside wave 2b Task 3's own block. Concretely: wave 2b Task 3 Step 3
replaces `ccd:11241-11243` (today `:11927-11929`) with a block whose first three lines are

```bash
  _pane_hard_blocked "$pane" && hard_blocked=1
  # A HEALTHY PANE IS NOT STRANDED. …
  [[ -n "$hard_blocked" ]] || _strand_clear "$id"
  target=$(_swap_target "$id" "$wrapper" "$home" "$hard_blocked")
```

This task inserts **between** the `_strand_clear` line and the `target=` line, and changes
`"$hard_blocked"` to `"$force_arg"` in the `target=` line. Nothing else in that block moves.

**Files:**
- Modify: `ccd/ccd` — inside `_auto_swap_check`, in the block wave 2b Task 3 Step 3 produces.
- Test: `server/test/ccd-preempt.test.ts` (Modify)

**Interfaces:**
- Consumes: `_limit_field <wrapper> five|seven [maxage]` (`ccd/ccd:11728`; `""` when unknown or older
  than `maxage`); `SWAP_FRESH=1800` and `SWAP_THRESHOLD=90` (`ccd/ccd:830`, `:826`);
  `_swap_target <id> <cur> <home> [force]` (`ccd/ccd:11828`, stdout = destination or nothing, and
  `force` — any non-empty value — skips ONLY the two "stay" shortcuts);
  `_pane_hard_blocked <pane>` (`ccd/ccd:11886`); wave 2b Task 3's `_strand_mark`/`_strand_clear`
  call sites, unchanged.
- Produces: three new locals inside `_auto_swap_check` — `own` (digits, or `""`), `preempt`
  (`1` or `""`), `force_arg` (`"$hard_blocked"`, or the literal `preempt`) — and one changed
  argument on the `_swap_target` call. No signature changes anywhere.

**Spec:** §D.1 (it is not a new lane), §D.4 (the source-side staleness hazard).

**Mutation table:**
- Delete `"$SWAP_FRESH"` (i.e. call `_limit_field "$wrapper" five 0`) → **red**: "does NOT arm on
  telemetry older than SWAP_FRESH" fails with
  `expected 'dispatch claude-demo -> claude-a' to not contain 'dispatch'`.
- Change `-ge "$SWAP_THRESHOLD"` to `-gt` → **red**: "arms exactly AT SWAP_THRESHOLD" fails with
  `expected '' to contain 'dispatch claude-demo -> claude-a'`.
- Pass `"$hard_blocked"` to `_swap_target` again instead of `"$force_arg"` → **red**: "moves a home
  the ceiling path would have kept" fails with `expected '' to contain 'dispatch'`.
- The `[[ -z "$hard_blocked" ]]` wrapper around the arming is **structural only — no test in this
  plan can see it, and no row here claims one can.** Deleting it changes `force_arg` from `1` to
  `preempt` on a hard-blocked session, and `_swap_target` documents `force` as "any non-empty value"
  (`ccd/ccd:11829`, and both readers test only `[[ -z "$force" ]]` — `:11843` and `:11849`), so the
  rescue arm fires
  exactly as before and still logs `auto-rescue`. "a hard block passes `hard_blocked`, never
  `preempt`" stays GREEN under that mutation. The wrapper is defence in depth — it keeps a hard block
  from paying for a telemetry read it will never use, and keeps `$preempt` empty so Task 4's price
  block can never be entered from the rescue lane. Task 5's mutation table names the STRUCTURAL
  mutation that is observable (moving the rescue branch itself); this one is not.
- Delete `"$own" =~ ^[0-9]+$ && ` from the arming guard → **red** on the structural row
  `_auto_swap_check (preempt arming)` in `ccd-arith-containment.test.ts` (Task 6).

`LEDGER: _limit_field's `maxage` parameter (ccd:11729, ccd:11734) has shipped with no user since it was written — all four call sites pass 0 or default to it (ccd:1268, ccd:11760, ccd:11767 x2) — so the stale-HIGH hazard it exists to close has been open the whole time; this is its first and only non-zero caller (D-TBD-preempt-maxage-first-user).`

`LEDGER: the removed policy took own pressure as max(fresh 5h, day-fresh 7d) via a SECOND non-zero maxage (`_limit_field "$wrapper" seven 86400`); only the 5h arm is restored, so `SWAP_THRESHOLD`'s own "own 5h %" comment is literally true and §D.1's "only non-zero maxage in the tree" claim survives — the weekly axis stays covered above SWAP_CEILING by `_limit_score`/`_avail` and is uncovered in the 90-97 band (D-TBD-preempt-weekly-arm-dropped).`

- [ ] **Step 1: Write the failing tests**

First append the tick fixtures to `server/test/ccd-preempt.test.ts`, after the `writeLimits` helper:

```ts
/** A live-looking session on `claude`, written with `_reg_set` — the same
 *  writer ccd uses. `lastswap`/`swapblocked` are deliberately absent so both
 *  cooldown gates are open, and NO `.home` file is written, so `_home_for`
 *  falls back to the id prefix (`claude`) exactly as a pre-2026-07-28 row does. */
const seed = (): void => {
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  h.sh(`_reg_set ${ID} uuid 11111111-1111-4111-8111-111111111111
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir "$HOME/projects/demo"
    _reg_set ${ID} wrapper claude
    _reg_set ${ID} started 1`);
};

/** A pane at a clean prompt with a pane pid, and a dispatch that logs instead
 *  of running systemd-run. `_swap_target`, `_avail` and `_pane_hard_blocked`
 *  stay REAL — the decision under test is a function of telemetry. */
const QUIET = `
  tmux() { case "\${1:-}" in
             capture-pane) printf '%s\\n' "❯ " ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** A real limit banner, matched by the REAL `_pane_hard_blocked` — the
 *  classifier IS the discriminator between the rescue lane and this one. */
const BLOCKED = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** The status file the affinity arm's idle gate reads, under the CURRENT
 *  account's config dir — `sf="$(_cfg_dir "$wrapper")/sessions/$spid.json"`
 *  (ccd:11972), and `_cfg_dir` is generated from `configDirSuffix`, so
 *  `claude` -> `$HOME/.claude` and `claude-a` -> `$HOME/.claude-a`. THE `cfg`
 *  PARAMETER IS LOAD-BEARING: a case that re-seeds `wrapper` to another
 *  account must write its status file under THAT account's dir, or `st` is
 *  empty and the tick returns at the idle gate before any dispatch. (Wave 2b's
 *  own copy of this helper carries the parameter for the same reason.)
 *  `quietS` is how long the session has been idle: 0 means "touched this
 *  instant". */
const idleStatus = (quietS = 100000, cfg = '.claude'): void => {
  const dir = path.join(h.home, cfg, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PANE_PID}.json`),
    JSON.stringify({ status: 'idle', statusUpdatedAt: (now() - quietS) * 1000 }));
};

const tick = (stubs: string, n = 1): string =>
  h.sh(`${stubs} for ((i=0;i<${n};i++)); do _auto_swap_check ${ID}; done`);
```

Then append the cases:

```ts
describe('the pre-empt arms on FRESH telemetry at SWAP_THRESHOLD (§D.1)', () => {
  it('moves a home the ceiling path would have KEPT — the earlier trigger, and nothing else', () => {
    // 95 is under SWAP_CEILING (98), so `_avail "$home"` succeeds and today's
    // stay-shortcut answers "" — the session sits there until 98. Armed, the
    // SAME must-leave path runs and picks the argmin over the home-able set.
    seed(); idleStatus();
    writeLimits('claude', 95, 95);
    writeLimits('claude-a', 10, 10);
    writeLimits('claude-b', 20, 20);
    writeLimits('claude-d', 30, 30);
    tick(QUIET);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
  });

  it('arms exactly AT SWAP_THRESHOLD (90), and not one point below', () => {
    seed(); idleStatus();
    writeLimits('claude-a', 10, 10); writeLimits('claude-b', 10, 10); writeLimits('claude-d', 10, 10);
    writeLimits('claude', 89, 89);
    tick(QUIET);
    expect(h.calls().join('\n'), '89 is not >= 90').not.toContain('dispatch');
    writeLimits('claude', 90, 90);
    tick(QUIET);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
  });

  it('does NOT arm on telemetry older than SWAP_FRESH — the stale-HIGH hazard', () => {
    // A 95% reading measured an hour ago would otherwise trigger a move that is
    // no longer justified. SWAP_FRESH (1800 s) is what closes it, and this is
    // the first non-zero `maxage` in the tree. A stale LOW reading needs no
    // guard: it fails `-ge 90` and declines to pre-empt on its own.
    seed(); idleStatus();
    writeLimits('claude-a', 10, 10); writeLimits('claude-b', 10, 10); writeLimits('claude-d', 10, 10);
    writeLimits('claude', 95, 95, 3600);
    tick(QUIET);
    expect(h.calls().join('\n')).not.toContain('dispatch');
  });

  it('…and arms on the SAME reading once it is inside the window', () => {
    // The positive control for the case above: without it, a green negative
    // proves only that the fixture never dispatches.
    seed(); idleStatus();
    writeLimits('claude-a', 10, 10); writeLimits('claude-b', 10, 10); writeLimits('claude-d', 10, 10);
    writeLimits('claude', 95, 95, 1700);
    tick(QUIET);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
  });

  it('a HARD BLOCK passes `hard_blocked`, never `preempt` — the lanes never mix', () => {
    // The rescue arm must not run under a force value the price block would
    // recognise. Measured through the arm's own log verb, which is the only
    // observable difference at this point in the plan.
    seed();
    writeLimits('claude', 95, 95);
    writeLimits('claude-a', 10, 10);
    tick(BLOCKED);
    expect(swapLog()).toContain(`auto-rescue ${ID}: claude (blocked) -> claude-a`);
    expect(swapLog(), 'a rescue is never a pre-empt').not.toContain('auto-preempt');
  });

  it('a pre-empt with nowhere to go strands NOTHING', () => {
    // Wave 2b's strand branch fires on `-z "$target" && -n "$hard_blocked"`.
    // A pre-empt is not a hard block, so an armed session with every candidate
    // at the ceiling simply stays put — silently, and correctly: "I would have
    // liked to move" is not a fault worth a marker and a banner.
    seed(); idleStatus();
    writeLimits('claude', 95, 95);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    tick(QUIET, 10);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(fs.existsSync(reg(`${ID}.stranded`))).toBe(false);
    expect(swapLog()).toBe('');
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts
```

Expected: FAIL — **three of the six** new cases fail: "moves a home the ceiling path would have
KEPT", "arms exactly AT SWAP_THRESHOLD" (its second half) and "…and arms on the SAME reading once it
is inside the window". All three fail with the same text, `expected '' to contain 'dispatch
claude-demo -> claude-a'`, because before the arming exists `_avail "$home"` succeeds at 95 and
`_swap_target`'s stay shortcut answers "".

The other three pass **before** the change and become regression guards after it: "does NOT arm on
telemetry older than SWAP_FRESH" and "a pre-empt with nowhere to go strands NOTHING" pass vacuously
(nothing dispatches at all yet), and "a HARD BLOCK passes `hard_blocked`, never `preempt`" passes for
a real reason — the rescue arm already behaves exactly as it must — and is kept as the standing proof
the lanes stay separate. The 9 tests from Tasks 1-2 stay green.

- [ ] **Step 3: Write the arming**

In `ccd/ccd`, inside `_auto_swap_check`, insert **between** wave 2b Task 3 Step 3's
`[[ -n "$hard_blocked" ]] || _strand_clear "$id"` line and its `target=$(_swap_target …)` line:

```bash
  # ── PRE-EMPT ARMING (§D.1) ───────────────────────────────────────────────
  # THIS IS NOT A NEW LANE. Today's stay-shortcut is `_avail "$home"` — score
  # under SWAP_CEILING (98) — and everything below is the SAME must-leave path
  # with an earlier trigger. `force` skips the two "stay" branches exactly as a
  # hard block skips them (see `_swap_target`'s own header), and the
  # home-recovered MOVE stays reachable under force, so a session whose home
  # came back still goes home rather than falling through to the loop.
  #
  # ARMED HERE, after the cooldown gates and the pane read, so a session inside
  # SWAP_COOLDOWN or SWAPBLOCK_COOLDOWN never pays for the extra telemetry read.
  #
  # `$SWAP_FRESH` IS THE POINT OF THE THIRD ARGUMENT. `_limit_field`'s `maxage`
  # parameter (ccd:11729, ccd:11734) has shipped with NO user: every call site
  # passes 0 or defaults to it (ccd:1268, ccd:11760, ccd:11767 twice). This is
  # the only non-zero one in the tree, and it closes the stale-HIGH hazard — a
  # 95% reading measured days ago would otherwise trigger a move no longer
  # justified. A stale LOW reading needs no guard: it fails `-ge
  # SWAP_THRESHOLD` and declines to pre-empt on its own.
  #
  # THE 5h ARM ONLY. The removed policy also took `_limit_field "$wrapper" seven
  # 86400` and used max(5h, 7d); that is deliberately not restored, so
  # SWAP_THRESHOLD's own "own 5h %" comment is literally true and this stays the
  # tree's single non-zero `maxage`. The weekly axis is still covered ABOVE the
  # ceiling — `_avail` scores max(5h, 7d) through `_limit_score` — and is
  # uncovered in the 90-97 band, which is a stated cost, not an oversight.
  #
  # A HARD BLOCK OUTRANKS IT, unconditionally: `hard_blocked` is passed through
  # untouched and the rescue arm below never sees `preempt`.
  local own="" preempt="" force_arg="$hard_blocked"
  if [[ -z "$hard_blocked" ]]; then
    own=$(_limit_field "$wrapper" five "$SWAP_FRESH")
    # Digits BEFORE the arithmetic, always (D-299's class). `_limit_json_num`
    # already emits digits-or-empty by construction (ccd:11699) — the same
    # single-sanitiser shape `_pane_ctx_pct` has — so this guard is what turns
    # that into a STATED dependency instead of an assumed one, and what keeps
    # `-ge` (itself an arithmetic context) from ever seeing a torn field.
    [[ "$own" =~ ^[0-9]+$ && "$own" -ge "$SWAP_THRESHOLD" ]] \
      && { preempt=1; force_arg=preempt; }
  fi
```

- [ ] **Step 4: Pass the armed force**

In the same block, change wave 2b Task 3 Step 3's line

```bash
  target=$(_swap_target "$id" "$wrapper" "$home" "$hard_blocked")
```

to

```bash
  target=$(_swap_target "$id" "$wrapper" "$home" "$force_arg")
```

`_swap_target`'s signature, its stdout contract and its own internal `force=pool` rule (wave 2b
Task 2) are all untouched: `force` is documented as "any non-empty value", and `preempt` is one.

- [ ] **Step 5: Run the suite to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts
```

Expected: PASS — 15 tests.

- [ ] **Step 6: Prove the untouched arms are untouched**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-hold.test.ts test/ccd-login-screen.test.ts test/ccd-account-ok.test.ts test/ccd-swap-refuse.test.ts test/ccd-auto-swap-pool.test.ts
```

Expected: PASS, with **no edits needed**. This was checked when the plan was written rather than
left for the implementer to discover:

- `ccd-auto-swap-hold.test.ts` writes **no** `~/.cc-limits` file at all, so `_limit_field` answers
  `""`, the arming guard's digit test fails, `force_arg` stays `""`, and its stubbed
  `_swap_target`/`_avail` decide exactly as before.
- `ccd-login-screen.test.ts:283-284` writes `claude` at 99/99 — armed at first glance, but that case
  is hard-blocked, so `force_arg` is `hard_blocked` and nothing changes. Its `:291-295` healthy case
  writes no telemetry, so nothing arms.
- `ccd-account-ok.test.ts` calls `_swap_target` and `_ws_least_loaded` DIRECTLY; this task changes
  neither function.
- `ccd-swap-refuse.test.ts` writes **no** `~/.cc-limits` file at all (measured: `grep -n 'cc-limits'
  server/test/ccd-swap-refuse.test.ts` is empty), so `_limit_field` answers `""` for every account,
  the arming's digit test fails and `force_arg` stays `"$hard_blocked"`.

If any of them reds, something changed since the plan was written — stop and re-derive rather than
editing the assertion.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-preempt.test.ts
git commit -m "feat(ccd): the must-leave path gets an earlier trigger, on fresh telemetry only (D-TBD-preempt-maxage-first-user, D-TBD-preempt-weekly-arm-dropped)

SWAP_THRESHOLD and SWAP_FRESH have readers for the first time since 0bfd0c26.
_limit_field's maxage parameter gets its first non-zero caller in the tree.

Mutation measured: dropping SWAP_FRESH reds 1 assertion; -ge -> -gt reds 1."
```

---

### Task 4: the price — `SWAP_HEADROOM`, `SWAP_QUIET`, the verb, and the budget spend

**Inserts:** **AFTER Task 3.** Two of its three edits land in `ccd/ccd:11965-11979`, a range **no
wave-2b task touches** (2b Task 3's three edit sites are `:11213-11214`, `:11241-11243` and `:11294`
in its own numbering — today `:11899-11900`, `:11927-11929` and `:11980`). The third edit is a pure
assignment to wave 2b's `aff_verb`, so it **must be sequenced after wave 2b Task 3**, which both
declares that local and replaces the literal `auto-home` at `:11294` (today `:11980`) with
`$aff_verb`. Without wave 2b Task 3 the variable does not exist and `set -u` kills the tick.

**Files:**
- Modify: `ccd/ccd:11974-11979` — the price block, the quiet-gate variable, and the budget spend.
- Test: `server/test/ccd-preempt.test.ts` (Modify)

**Interfaces:**
- Consumes: `own` / `preempt` / `force_arg` (Task 3); `_preempt_budget_take <id>` → rc 0 iff this
  process won the slot (Task 2); `_limit_score <wrapper>` → `max(5h%, 7d%)` on stdout, `""` when
  wholly unknown (`ccd/ccd:11762`); `_avail <wrapper>` → rc 0 iff score under `SWAP_CEILING`, and rc
  0 for unknown (`ccd/ccd:11785`); `SWAP_HEADROOM=30`, `SWAP_QUIET=600`, `SWAP_CEIL_QUIET=30`
  (`ccd/ccd:827`, `:831`, `:834`); wave 2b Task 3's `aff_verb` local (default `auto-home`, set to
  `auto-pool` when the current account fails the pool rule) and its `$aff_verb` log line.
- Produces: `quiet_req` (a local, `$SWAP_CEIL_QUIET` or `$SWAP_QUIET`); `aff_verb` gains the third
  value `auto-preempt`; the `swap.log` verb `auto-preempt`; `$REG/preempt-budget` written on
  dispatch only.

**Spec:** §D.1 (the three guards), §D.3 (the budget, and the rescue exemption).

**Mutation table:**
- Delete the headroom line → **red**: "HEADROOM: declines when the target is only 25 points cheaper"
  fails with `expected 'dispatch claude-demo -> claude-a' to not contain 'dispatch'`.
- Change `-ge "$SWAP_HEADROOM"` to `-gt 0` → **red**: same case, same text.
- Delete `quiet_req="$SWAP_QUIET"` (leaving the ceiling's 30 s) → **red**: "QUIET: declines at 300 s
  of quiet" fails with `expected 'dispatch claude-demo -> claude-a' to not contain 'dispatch'`.
- Delete `"$target" != "$home"` from the price block's condition → **red**: "a RETURN-HOME is never
  charged the pre-empt's price" fails with `expected '' to contain 'dispatch claude-demo -> claude'`
  — the headroom test then judges a move it was never meant to judge (95 - 80 = 15, under 30) and
  refuses it.
- Delete `"$aff_verb" == auto-home` from the price block's condition → **no measurable red**, and the
  plan says so rather than claiming one. Wave 2b's retag cases write telemetry for the DESTINATION
  only (`writeLimits('claude-b', 10, 10)`, no `claude.json`), so `_limit_field "$wrapper" five
  "$SWAP_FRESH"` answers `""`, the arming's digit test fails and `$preempt` is empty — the price
  block's first clause excludes them whatever `aff_verb` says. Independently, wave 2b re-seeds
  `.home` to `claude-b` and `_swap_target` then returns `claude-b`, so `"$target" != "$home"` is
  false as well. The clause is kept as a stated PRECEDENCE rule — a pool force outranks a pressure
  force — and its cost of being wrong is a verb, not a move.
- Move `_preempt_budget_take` above the quiet gate → **red**: "BUDGET: spent only by a swap that
  DISPATCHES" fails on its second assertion with `expected '<epoch> claude-demo' to be null`.
- Delete the `[[ "$aff_verb" == auto-preempt ]]` guard on the spend (i.e. charge every affinity move)
  → **red** in two cases, and they red differently. "QUIET: the SAME 300 s fixture at the CEILING
  moves, with the verb `auto-home`" fails with `expected '<epoch> claude-demo' to match
  /^\d{10} claude-earlier$/` — its budget is OPEN, so the unguarded take succeeds and restamps a slot
  a ceiling move must not spend. "a RETURN-HOME is never charged the pre-empt's price" fails EARLIER
  and for a compound reason, `expected '' to contain 'dispatch claude-demo -> claude'`: its budget is
  CLOSED, so the unguarded take declines and the return-home never happens at all.

`LEDGER: arming `force` before `_swap_target` also skips the `cur != home` stay shortcut, so an armed session whose home has recovered produces a return-home MOVE that would have happened anyway; the price block must exclude `target == home` explicitly or a return-home starts waiting SWAP_QUIET (600 s) instead of SWAP_CEIL_QUIET (30 s) and can be refused by a headroom test that was never meant to judge it (D-TBD-preempt-return-home-not-charged).`

`LEDGER: `_swap_target` does not publish its winner's score and is deliberately not widened to (its stdout seam is already overloaded — wave 2b's D-1673 argues exactly that), so the headroom test re-reads `_limit_score "$target"`; a target chosen at score S can be re-read at S' if telemetry moved between the two reads, and the headroom test then judges the newer number, which is the more honest of the two (D-TBD-swap-target-score-reread).`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-preempt.test.ts`:

```ts
describe('the pre-empt pays for itself (§D.1, §D.3)', () => {
  const openBudget = (): void => {
    fs.writeFileSync(reg('preempt-budget'), `${now() - 901} claude-earlier`);
  };
  const closeBudget = (): void => {
    fs.writeFileSync(reg('preempt-budget'), `${now()} claude-earlier`);
  };

  it('HEADROOM: moves when the target is 35 points cheaper', () => {
    seed(); idleStatus(); openBudget();
    writeLimits('claude', 95, 95);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 60, 60);
    tick(QUIET);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
  });

  it('HEADROOM: declines when the target is only 25 points cheaper, and stamps nothing', () => {
    // A restart and a transcript copy bought for 25 points is churn: telemetry
    // drift erases the gain before the session has finished resuming.
    seed(); idleStatus(); openBudget();
    // Captured BEFORE the tick. Re-reading the file inside the assertion would
    // compare `budget()` with its own definition — `X === X`, green whatever
    // the tick did to it.
    const before = budget();
    writeLimits('claude', 95, 95);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 70, 70);
    tick(QUIET, 5);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(ID, 'lastswap'), 'a refused pre-empt is not a swap').toBeNull();
    expect(budget(), 'and it does not spend the fleet slot either').toBe(before);
  });

  it('QUIET: declines at 300 s of quiet, where the ceiling path would have moved', () => {
    seed(); idleStatus(300); openBudget();
    writeLimits('claude', 95, 95);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 10, 10);
    tick(QUIET);
    expect(h.calls().join('\n'), 'SWAP_QUIET is 600 s, not SWAP_CEIL_QUIET`s 30').not.toContain('dispatch');
  });

  it('QUIET: the SAME 300 s fixture at the CEILING moves, with the verb `auto-home`', () => {
    // THE PAIRED CONTROL, and it is what proves `quiet_req` is a variable
    // rather than a renamed constant. At 99 the current lane fails `_avail`, so
    // this is the ordinary ceiling relocation and it keeps its 30 s wait.
    seed(); idleStatus(300); openBudget();
    writeLimits('claude', 99, 99);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 10, 10);
    tick(QUIET);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
    expect(swapLog()).toContain(`auto-home ${ID}: claude -> claude-a [home=claude]`);
    expect(budget(), 'a ceiling move is not a pre-empt and spends no slot')
      .toMatch(/^\d{10} claude-earlier$/);
  });

  it('QUIET: moves at 700 s, and the log verb says which lane decided', () => {
    seed(); idleStatus(700); openBudget();
    writeLimits('claude', 95, 95);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 10, 10);
    tick(QUIET);
    expect(swapLog()).toContain(`auto-preempt ${ID}: claude -> claude-a [home=claude]`);
    expect(swapLog(), 'the ceiling did not cause this move').not.toContain('auto-home');
    expect(logLines('auto-preempt'), 'one tick, one lane, one line').toHaveLength(1);
  });

  it('BUDGET: a closed budget declines, and stamps no lastswap', () => {
    seed(); idleStatus(); closeBudget();
    const before = budget();
    writeLimits('claude', 95, 95);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 10, 10);
    tick(QUIET, 5);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(ID, 'lastswap'), 'so the first tick past the interval moves at once').toBeNull();
    expect(budget()).toBe(before);
  });

  it('BUDGET: an expired budget lets it through, and the stamp advances to this session', () => {
    seed(); idleStatus(); openBudget();
    writeLimits('claude', 95, 95);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 10, 10);
    tick(QUIET);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
    expect(budget()).toMatch(new RegExp(`^\\d{10} ${ID}$`));
  });

  it('BUDGET: spent only by a swap that DISPATCHES — the quiet gate comes first', () => {
    // Taken any earlier, a session that then failed the 600 s quiet wait would
    // burn the fleet's one slot and move nothing.
    seed(); idleStatus(300);
    writeLimits('claude', 95, 95);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 10, 10);
    tick(QUIET, 5);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(budget(), 'the slot was never taken').toBeNull();
  });

  it('a RETURN-HOME is never charged the pre-empt`s price', () => {
    // Arming `force` also skips the `cur != home` stay shortcut, so an armed
    // session whose home recovered produces a move that was going to happen
    // anyway. Charging it 600 s of quiet, a headroom test and a fleet slot
    // would be a REGRESSION, not a guard.
    // The status file goes under `.claude-a`, not `.claude`: this case moves
    // `wrapper` to `claude-a`, and the idle gate reads `_cfg_dir "$wrapper"`.
    seed(); idleStatus(300, '.claude-a'); closeBudget();
    h.sh(`_reg_set ${ID} wrapper claude-a; _reg_set ${ID} home claude`);
    writeLimits('claude-a', 95, 95);   // cur: armed, and under the ceiling
    writeLimits('claude', 80, 80);     // home: recovered, and only 15 points cheaper
    tick(QUIET);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude`);
    expect(swapLog()).toContain(`auto-home ${ID}: claude-a -> claude [home=claude]`);
    expect(budget(), 'a return-home does not spend the budget').toMatch(/^\d{10} claude-earlier$/);
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts
```

Expected: FAIL — six of the nine new cases fail:

- `expected 'dispatch claude-demo -> claude-a' to not contain 'dispatch'` — four cases: the headroom
  negative, the quiet negative, the budget negative, and budget-spent-only-on-dispatch. Before this
  task nothing prices the move, so every one of them dispatches.
- `expected '…auto-home claude-demo: claude -> claude-a…' to contain 'auto-preempt claude-demo:
  claude -> claude-a [home=claude]'` — "QUIET: moves at 700 s". The move already happens; only the
  verb is wrong, because wave 2b's `aff_verb` still reads `auto-home`.
- `expected '<epoch> claude-earlier' to match /^\d{10} claude-demo$/` — "BUDGET: an expired budget
  lets it through". Note the received value is the marker `openBudget()` wrote, **not** `null`:
  nothing has taken the slot, so the stamp is still the fixture's.

The three that pass before the change — "HEADROOM: moves when the target is 35 points cheaper",
"QUIET: the SAME 300 s fixture at the CEILING moves" and "a RETURN-HOME is never charged the
pre-empt's price" — pass vacuously and are regression guards afterwards. The 15 tests from Tasks 1-3
stay green.

- [ ] **Step 3: Write the price block**

In `ccd/ccd`, inside `_auto_swap_check`, insert immediately after the idle gate (currently
`:11974`, `[[ "$st" == "idle" ]] || return 0`) and **before** the "Quiet gate (short)" comment
(currently `:11975`):

```bash
  # ── THE PRE-EMPT'S OWN PRICE (§D.1, §D.3) ────────────────────────────────
  # `quiet_req` is what makes SWAP_QUIET a variable again. Its default is the
  # ceiling path's own 30 s, so every relocation that is not a pre-empt is
  # byte-identical to today.
  local quiet_req="$SWAP_CEIL_QUIET" tsc
  # FOUR CONDITIONS, AND EVERY ONE OF THEM ASKS THE SAME QUESTION: does this
  # move exist ONLY because of the pre-empt force?
  #   - `$preempt`: the force was armed at all. Empty on every hard block, so
  #     the RESCUE ARM — which returned above, before the hold rung and before
  #     the turn-boundary gates — never reaches this block by any route.
  #   - `$aff_verb` is still `auto-home`: wave 2b's POOL force OUTRANKS this
  #     one. A retagged session must leave regardless of its own pressure, and
  #     charging a retag a quiet wait, a headroom test and a fleet-wide budget
  #     would let this guard defer a relocation the operator asked for.
  #   - `$target != $home`: this is not the return-home affinity move, which
  #     fires under force or without it.
  #   - `_avail "$wrapper"`: the current lane is still under the ceiling, so
  #     today's stay-shortcut would have answered "stay". Once it is at the
  #     ceiling the ordinary path owns the move and must keep its 30 s wait.
  # Dropping either of the last two turns a guard into a REGRESSION.
  if [[ -n "$preempt" && "$aff_verb" == auto-home && "$target" != "$home" ]] && _avail "$wrapper"; then
    aff_verb=auto-preempt
    # HEADROOM. `$own` is digits by the arming guard above, which is the only
    # writer of `$preempt`. `$tsc` is re-read here rather than published by
    # `_swap_target`: that function's stdout seam is already overloaded and is
    # deliberately not widened (wave 2b's D-1673), so the score comes from the
    # one function that owns it. A target whose score moved between the two
    # reads is judged on the NEWER number, which is the more honest of the two.
    tsc=$(_limit_score "$target")
    [[ "$tsc" =~ ^[0-9]+$ && $((own - tsc)) -ge "$SWAP_HEADROOM" ]] || return 0
    # THE LONG QUIET WAIT. 600 s, not the ceiling path's 30: at the ceiling
    # every turn is paid overage, so waiting costs money and the right answer is
    # the next turn boundary. At 90% nothing is being paid yet, so the right
    # answer is to leave a session alone until it has genuinely been put down.
    # This is the sentence SWAP_CEILING's own comment (ccd:832-833) has been
    # promising — "cut the quiet wait short … not 10min later" — with nothing
    # to cut short since 2026-07-07.
    quiet_req="$SWAP_QUIET"
  fi
```

- [ ] **Step 4: Make the quiet gate read the variable**

In `ccd/ccd`, replace the quiet-gate line (currently `:11978`):

```bash
  [[ -n "$sua" && $(( now * 1000 - sua )) -ge $(( SWAP_CEIL_QUIET * 1000 )) ]] || return 0
```

with:

```bash
  [[ -n "$sua" && $(( now * 1000 - sua )) -ge $(( quiet_req * 1000 )) ]] || return 0
```

`quiet_req` holds one of two bare literals assigned in this file's own source
(`SWAP_CEIL_QUIET`, `SWAP_QUIET`), so no operand here becomes env- or registry-reachable and this
line needs no new digit guard. `sua` is digits-or-empty by construction (`grep -oE
'"statusUpdatedAt":[0-9]+' | cut -d: -f2`), unchanged.

- [ ] **Step 5: Spend the budget, last**

In `ccd/ccd`, insert immediately after the quiet-gate line and **before**
`_reg_set "$id" lastswap "$now"` (currently `:11979`):

```bash
  # ── THE FLEET-WIDE PRE-EMPT BUDGET (§D.3) ────────────────────────────────
  # TAKEN LAST, and the placement is the whole reason it works as a budget.
  # Every cheaper refusal has already happened — the hold rung, mid-turn,
  # off-prompt, not-idle, the 600 s quiet wait, the headroom test — so the slot
  # is spent only by a swap that is otherwise dispatching on THIS tick. Taken
  # any earlier, a session that then failed the quiet gate would burn the
  # fleet's one slot and move nothing.
  #
  # NO `lastswap` IS STAMPED ON A REFUSAL, deliberately: the budget is a
  # fleet-wide rate limit, not a per-session refusal, so the first tick past the
  # interval should move at once rather than wait out SWAP_COOLDOWN as well.
  # The cost is that an armed, quiet, in-headroom session re-asks every 5 s
  # while the budget is closed — one `flock` and one `cat`, and only for the
  # small set that has passed every gate above.
  #
  # AND THE RESCUE ARM NEVER GETS HERE. It returned at the `hard_blocked`
  # branch, above the hold rung and above every turn-boundary gate: no quiet
  # wait, no headroom test, no budget. That exemption is the difference between
  # a tuning policy and a wedged session, and `ccd-preempt.test.ts` pins it in
  # three directions.
  [[ "$aff_verb" == auto-preempt ]] && { _preempt_budget_take "$id" || return 0; }
```

- [ ] **Step 6: Run the suite to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts
```

Expected: PASS — 24 tests.

- [ ] **Step 7: Prove wave 2b's own tick suite is untouched**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts test/ccd-auto-swap-hold.test.ts test/ccd-crosspool.test.ts
```

Expected: PASS — 30, 5 and 24 tests respectively, all unedited. `ccd-auto-swap-pool.test.ts`'s retag
cases are excluded from the price block **three times over**, and it is worth knowing which exclusion
actually does the work:

1. They write telemetry for the DESTINATION only — `writeLimits('claude-b', 10, 10)` and no
   `claude.json` — so `_limit_field "$wrapper" five "$SWAP_FRESH"` answers `""`, the arming's digit
   test fails, and `$preempt` is empty. **This is the one that fires**, and it fires before any of
   the others is consulted.
2. Wave 2b re-seeds `.home` to `claude-b` in the same tick, and `_swap_target` then returns
   `claude-b`, so `"$target" != "$home"` is false too.
3. Wave 2b sets `aff_verb=auto-pool`, so the second clause is false as well.

Because (1) and (2) hold on their own, this suite **cannot** show the loss of clause (3): deleting
`"$aff_verb" == auto-home` leaves every case here green. Do not treat these 30 tests as the mechanism
for that clause — Task 4's mutation table says plainly that it has none. If one of them reds, a
clause that DOES have a mechanism was dropped; re-derive from the mutation table and fix the ccd
code, never this file.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-preempt.test.ts
git commit -m "feat(ccd): the pre-empt pays a headroom test, a 10-minute quiet wait and one fleet slot (D-TBD-preempt-return-home-not-charged, D-TBD-swap-target-score-reread)

SWAP_HEADROOM and SWAP_QUIET have readers for the first time since 0bfd0c26,
and SWAP_CEILING's comment about a 10-minute wait to cut short is true again.

Mutation measured: deleting the headroom line reds 1; leaving quiet_req at
SWAP_CEIL_QUIET reds 1; moving the budget above the quiet gate reds 1."
```

---

### Task 5: the rescue lane is exempt from every new guard, pinned hardest

**Inserts:** **AFTER Task 4.** It changes no `ccd/ccd` byte — it is the standing proof that Tasks 3
and 4 left the rescue arm alone. It is sequenced against **wave 2b Task 3 Step 3**, whose strand
branch sits between the `_swap_target` call and the rescue arm, and against **wave 2b Task 5**, whose
"the deploy window" case drives the same arm through a stubbed `_swap_target`.

**Files:**
- Modify: `server/test/ccd-preempt.test.ts`

**Interfaces:**
- Consumes: everything Tasks 2-4 produced; `_pane_hard_blocked` (`ccd/ccd:11886-11893`, REAL); the
  rescue arm at `ccd/ccd:11940-11949`, unmodified by this plan.
- Produces: nothing new. This task is a mechanism for a claim the other tasks make.

**Spec:** §D.3 (*"The rescue lane is exempt from every new guard — hard-blocked stays immediate,
unbounded, no quiet wait, no headroom test, no budget. This exemption is the thing to pin
hardest."*), §11 (the risk it bounds).

**Mutation table:** this task has no code of its own, so its mutations are made in Tasks 3-4's code
and must red HERE. **The exemption is STRUCTURAL, and so are its mutations.** The rescue arm's
`return 0` (`ccd/ccd:11940-11949`) sits above every line Tasks 3 and 4 add, so deleting any ONE of
those guards in place changes nothing a hard-blocked session ever executes — all four cases stay
green. What discriminates is moving a guard ACROSS that return, and each mutation below names the
extra clause that has to come off with it, because each new guard is independently false for a hard
block and a mutation that leaves one standing is a green that proves nothing:

- **Hoist the budget spend above the rescue arm, unguarded.** Put `_preempt_budget_take "$id" ||
  return 0` immediately after `_avail "$target" || return 0` and delete the original line below →
  **red**: all four cases fail with `expected '' to contain 'dispatch claude-demo -> claude-a'`, the
  budget being closed in all four. Hoisting it WITH its `[[ "$aff_verb" == auto-preempt ]]` guard
  stays GREEN: `aff_verb` is only ever set to `auto-preempt` inside the price block, which is still
  below. That is the second, independent reason a rescue never pays — and the reason the guard has
  to come off for this mutation to show anything.
- **Hoist the whole price block above the rescue arm, with `-n "$preempt" &&` and `&& _avail
  "$wrapper"` dropped** → **red**: all four fail with the same text, because the headroom test then
  runs on a hard block — the arming is skipped for one, so `own` is `""`, `$((own - tsc))` is
  negative, and `-ge "$SWAP_HEADROOM"` returns 0 above the rescue. Hoisting the block UNCHANGED stays
  GREEN twice over: `$preempt` is empty on every hard block, and `_avail "$wrapper"` fails at 99.
- **Move the rescue branch itself below the budget-spend line** (the whole `if [[ -n "$hard_blocked"
  ]]; then … return 0; fi`) → **red**: all four fail with the same text. Read this red correctly: the
  first gate to catch them is not a new one at all — the BLOCKED fixture's pane is a 429 banner with
  no `❯`, so the tick returns at the off-prompt gate (`ccd/ccd:11969`). That is precisely why the
  rescue arm must sit above the turn-boundary gates, and this mutation is the only one that measures
  it.
- **NOT a mutation this task can show:** deleting `[[ -z "$hard_blocked" ]]` from Task 3's arming.
  It only changes `force_arg` from `1` to `preempt`, and `_swap_target` reads `force` as "any
  non-empty value" (`ccd/ccd:11829`, `:11843`, `:11849`), so the rescue arm fires and logs
  `auto-rescue` exactly as before and every case here stays green. Task 3's mutation table says the
  same thing; neither table claims a red for it.

- [ ] **Step 1: Write the tests**

Append to `server/test/ccd-preempt.test.ts`:

```ts
describe('THE RESCUE LANE IS EXEMPT FROM EVERY NEW GUARD (§D.3)', () => {
  // This is the difference between a tuning policy and a wedged session, and
  // it is pinned harder than anything else in this file. A hard-blocked session
  // has a limit/spend banner up or has lost auth: it is stuck NOW, and every
  // guard the pre-empt lane pays is a reason to leave it stuck.
  //
  // Structurally the exemption is two facts, and each case below fails if
  // either moves: the arming is inside `[[ -z "$hard_blocked" ]]`, and the
  // rescue arm returns ABOVE the hold rung, the turn-boundary gates, the price
  // block and the budget spend.
  const closeBudget = (): void => {
    fs.writeFileSync(reg('preempt-budget'), `${now()} claude-earlier`);
  };

  it('dispatches with the fleet budget CLOSED', () => {
    seed(); closeBudget();
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 50, 50);
    tick(BLOCKED);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
    expect(swapLog()).toContain(`auto-rescue ${ID}: claude (blocked) -> claude-a`);
  });

  it('dispatches with NO headroom at all — 4 points, where a pre-empt needs 30', () => {
    seed(); closeBudget();
    writeLimits('claude', 99, 99);
    for (const w of ['claude-a', 'claude-b', 'claude-d']) writeLimits(w, 95, 95);
    tick(BLOCKED);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
  });

  it('dispatches with ZERO quiet — the session was touched this instant', () => {
    // And with no `❯` on the pane and no `idle` status either: the rescue arm
    // returns before all three gates. The BLOCKED fixture's pane is a 429
    // banner, not a prompt.
    seed(); closeBudget(); idleStatus(0);
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 50, 50);
    tick(BLOCKED);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
  });

  it('does NOT spend the fleet budget — a rescue is not an optimisation', () => {
    seed(); closeBudget();
    const before = budget();
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 50, 50);
    tick(BLOCKED);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
    expect(budget(), 'the next pre-empt still has its slot').toBe(before);
    expect(swapLog(), 'and it is logged as a rescue, not a pre-empt').not.toContain('auto-preempt');
  });
});
```

- [ ] **Step 2: Run it and verify it passes IMMEDIATELY**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts
```

Expected: PASS — 28 tests, with **no ccd change**. That is the correct outcome here and it is not a
vacuous test: Tasks 3 and 4 were written so these four cases were already true, and this step is
where that claim stops being a claim.

If any of the four is RED, **stop**: Task 3 or Task 4 leaked a guard into the rescue arm. The fix is
in that task's code, never in this file.

- [ ] **Step 3: Measure the mutations, all three**

Each of the three mutations in the table above, one at a time, restoring between each. Every one of
them is STRUCTURAL — a guard moved across the rescue arm's `return 0`, never a guard deleted in place
— because a guard deleted in place is on a line a hard-blocked session never reaches.

1. Replace the budget-spend line `[[ "$aff_verb" == auto-preempt ]] && { _preempt_budget_take "$id"
   || return 0; }` with a bare `_preempt_budget_take "$id" || return 0` placed immediately after
   `_avail "$target" || return 0`, i.e. ABOVE the `if [[ -n "$hard_blocked" ]]` branch. Re-run —
   expect **all four** cases red with `expected '' to contain 'dispatch claude-demo -> claude-a'`.
   Restore. (Hoisting it and KEEPING the `aff_verb` guard is green; if you see green, check you
   dropped the guard.)
2. Move the whole price block (Task 4 Step 3) above the `if [[ -n "$hard_blocked" ]]` branch AND drop
   both `-n "$preempt" && ` and ` && _avail "$wrapper"` from its condition. Re-run — expect **all
   four** cases red with the same text, the headroom test refusing on `own=""`. Restore.
3. Move the whole `if [[ -n "$hard_blocked" ]]; then … return 0; fi` branch down to sit below the
   budget-spend line. Re-run — expect **all four** cases red with the same text, caught first by the
   off-prompt gate at `ccd/ccd:11969`. Restore.

Record all three before/after pairs in the commit message. This is the measured mutation table for
the exemption the spec calls "the thing to pin hardest". If any mutation comes back GREEN, do not
accept it: re-read the block you moved and confirm the extra clause named in the table came off with
it. A guard whose mutation cannot be shown is not yet a mechanism.

- [ ] **Step 4: Commit**

```bash
git add server/test/ccd-preempt.test.ts
git commit -m "test(ccd): the rescue lane is exempt from the budget, the headroom test and the quiet wait

Three STRUCTURAL mutations measured, each restored: hoisting the budget spend
above the rescue arm (unguarded) reds 4; hoisting the price block above it
(without -n \$preempt and _avail \$wrapper) reds 4; moving the rescue branch
below the budget spend reds 4. Deleting a guard in place reds nothing here, by
construction: the rescue arm returns above every line this wave adds."
```

---

### Task 6: the arithmetic-containment rows, and the four constants pinned as live

**Inserts:** **AFTER Task 5.** Its `ccd-arith-containment.test.ts` edit must follow **wave 2b Task 1
Step 5**, which adds one payload case and one `SITES` row (`_strand_mark (strandnotify floor)`) to
the same two places in the same file. Apply wave 2b's first; this task appends after it.

**Files:**
- Modify: `server/test/ccd-arith-containment.test.ts` — one payload case in the first `describe`, and
  three rows in the `SITES` table (`:120-126` on `main`, one row longer after wave 2b Task 1 Step 5).
- Modify: `server/test/ccd-preempt.test.ts` — the constants-are-live pin.

**Interfaces:**
- Consumes: `CCD` and `makeCcdHarness` from `server/test/ccdWsHelpers.js`; `_preempt_budget_take`
  (Task 2); the arming and headroom guards (Tasks 3-4).
- Produces: nothing runtime. Two mechanisms: the payload/structural pair for three new arithmetic
  operands, and the pin that says the four constants have readers.

**Spec:** §D.5 (the constants' comments become true), and the tree's D-299 arithmetic-containment
doctrine.

**Mutation table:**
- Remove `"$ts" =~ ^[0-9]+$ && ` from `_preempt_budget_take` → **red** on both the new payload case
  (`expected true to be false`) and the structural row naming
  `_preempt_budget_take (budget floor)`.
- Remove `"$own" =~ ^[0-9]+$ && ` from the arming → **red** on the structural row
  `_auto_swap_check (preempt arming)`.
- Remove `"$tsc" =~ ^[0-9]+$ && ` from the headroom test → **red** on the structural row
  `_auto_swap_check (preempt headroom)`.
- Delete any one of the four constants' readers → **red**: "the four pre-empt constants have readers
  again" fails naming that constant.

- [ ] **Step 1: Write the failing payload case and the three structural rows**

In `server/test/ccd-arith-containment.test.ts`, inside the first `describe`, after wave 2b's
`_strand_mark` case and before the `ccd assigns SWAP_JITTER unconditionally` case, add:

```ts
  it('_preempt_budget_take does not evaluate a payload planted in the fleet budget', () => {
    const h = makeCcdHarness('arith-preempt');
    // The budget marker is DOTLESS and fleet-wide, so it is planted by hand
    // rather than through `_reg_set`. A torn or hand-edited field is the threat
    // model, exactly as `lastswap` is — and here it is additionally the one
    // registry file the whole fleet shares.
    //
    // NO LITERAL SPACE IN THE PAYLOAD (measured, bash 5.2.21). `${raw%% *}`
    // truncates at the first one, so `REG[$(touch "$HOME/…")]` reaches the
    // arithmetic as `REG[$(touch` and bash refuses it as a bad array subscript
    // without running the substitution — green with the guard deleted, i.e. a
    // vacuous case. `${IFS}` supplies the word break with no space in it.
    h.sh('printf %s \'REG[$(touch${IFS}"$HOME/PWNED-preempt")] torn\''
      + ' > "$HOME/.cc-sessions/preempt-budget";'
      + ' _preempt_budget_take myid >/dev/null 2>&1 || :');
    expect(existsSync(path.join(h.home, 'PWNED-preempt'))).toBe(false);
    h.cleanup();
  });
```

and in the `SITES` table add three rows, after wave 2b's `_strand_mark (strandnotify floor)` row:

```ts
    { fn: '_auto_swap_check (preempt arming)',   anchors: ['-ge "$SWAP_THRESHOLD"'],                arith: '-ge' },
    { fn: '_auto_swap_check (preempt headroom)', anchors: ['$((own - tsc))', 'SWAP_HEADROOM'],      arith: '$((' },
    { fn: '_preempt_budget_take (budget floor)', anchors: ['$((now - ts))', 'SWAP_PREEMPT_BUDGET'], arith: '$((' },
```

Each row's anchored line begins with `[[` after `.trim()` — the filter that builds `codeLines`
(`:127-129`) keeps only such lines, which is why the budget floor is written as
`[[ … ]] \` + `&& { exec {lfd}>&-; return 1; }` and not as an `if [[ … ]]; then`.

- [ ] **Step 2: Write the constants-are-live pin**

Append to `server/test/ccd-preempt.test.ts`:

```ts
describe('the four constants are live again (§D.5)', () => {
  it('each has a reader, so its comment at the account-swap tuning block is true', () => {
    // Measured on `main` @ 58ef97b6 before this plan: `grep -c <name> ccd/ccd`
    // answered 1 for each of the four, and that one line was the constant's own
    // assignment. Four comments describing behaviour the file did not have.
    //
    // Readers are matched as `"$NAME"` — the spelling ccd uses at every one of
    // its guard sites — so the assignment lines (`NAME=90`) and any prose
    // mentioning the name in a comment cannot satisfy this.
    const lines = readFileSync(CCD, 'utf8').split('\n').map((l) => l.trim());
    for (const c of ['SWAP_THRESHOLD', 'SWAP_HEADROOM', 'SWAP_FRESH', 'SWAP_QUIET']) {
      const readers = lines.filter((l) => !l.startsWith('#') && l.includes(`"$${c}"`));
      expect(readers.length,
        `${c} has no reader: its comment in the account-swap tuning block describes behaviour `
        + 'this file does not have, which is the state 0bfd0c26 left it in on 2026-07-07')
        .toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run both suites**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-arith-containment.test.ts test/ccd-preempt.test.ts
```

Expected: PASS — 19 in `ccd-arith-containment.test.ts` (13 on `main`, +2 from wave 2b Task 1 Step 5,
+4 here) and 29 in `ccd-preempt.test.ts`.

If a structural row fails with `expected exactly one guarded line for …` to have length 1, the anchor
matched zero lines (the guard was written differently) or two (an anchor is not unique). Fix the
ANCHOR to name the shipped line, never relax the assertion.

- [ ] **Step 4: Measure the mutations**

One at a time, restoring between each:

1. Remove `"$ts" =~ ^[0-9]+$ && ` from `_preempt_budget_take`. Re-run — expect the payload case red
   (`expected true to be false`) and the `_preempt_budget_take (budget floor)` row red. Restore.
2. Remove `"$own" =~ ^[0-9]+$ && ` from the arming. Re-run — expect the
   `_auto_swap_check (preempt arming)` row red with "no `=~ ^[0-9]` guard on the line". Restore.
3. Remove `"$tsc" =~ ^[0-9]+$ && ` from the headroom test. Re-run — expect the
   `_auto_swap_check (preempt headroom)` row red. Restore.
4. Delete `"$SWAP_HEADROOM"` from the headroom line. Re-run — expect "each has a reader" red naming
   `SWAP_HEADROOM`. Restore.

- [ ] **Step 5: Commit**

```bash
git add server/test/ccd-arith-containment.test.ts server/test/ccd-preempt.test.ts
git commit -m "test(ccd): three new arithmetic operands guarded, and the four swap constants pinned as live

Mutation measured: dropping any one of the three =~ ^[0-9]+ guards reds its own
structural row (and the budget one reds its payload case too); deleting any of
the four constants' readers reds the liveness pin."
```

---

### Task 7: whole-branch gate, and the agent-first deploy order

**Inserts:** **AFTER wave 2b Task 8, replacing nothing in it.** Wave 2b Task 8 is the wave's own
whole-branch gate; this task extends its Step 6 isolation list and re-states the deploy order with
the one fact this amendment adds. Run wave 2b Task 8 first, then this.

**Files:**
- Modify: none. This task runs suites and states the order in which the finished branch reaches the
  fleet.

**Interfaces:**
- Consumes: everything wave 2b Tasks 1-8 and this amendment's Tasks 1-6 produced.
- Produces: a measured green branch, and the deploy order the operator or the coordinator follows.

**Mutation table:** none of its own. This is where every earlier task's red-before/green-after is
re-measured against the whole tree rather than one file.

- [ ] **Step 1: Re-run the §B gate, alone, before anything else**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts -t 'a rolled-over window reads UNKNOWN'
```

Expected: PASS. If it reds now and passed at Task 1, §B was reverted or a rebase dropped it — and the
whole of this amendment is unsafe on that tree. Stop and report.

- [ ] **Step 2: Run the full server suite in the foreground**

```bash
cd server && npm run test
```

Expected: PASS. Timeout at least 600000 ms; do not background it — backgrounding hides a hang and
these suites are load-sensitive.

Known load flakes, to be re-run **in isolation** before calling any of them a real break:
`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. A flake that passes
in isolation is a flake; CI on the quiet box is the arbiter.

- [ ] **Step 3: Run the agent and pwa suites**

```bash
cd agent && npm run test
```
```bash
cd pwa && npm run test
```

Expected: PASS in both. Neither package is touched by this amendment; they are run so the branch is
green as a whole rather than green in one package.

- [ ] **Step 4: Type-check**

```bash
cd server && npm run build
```

Expected: exit 0, no `tsc` diagnostics. (`server/test/typecheck-tests.test.ts`, inside `npm run test`
above, is what type-checks the new test file.)

- [ ] **Step 5: Check the deviation numbers against `origin/main` without merging**

```bash
git fetch origin main
```
```bash
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts
```

Expected: `deviation-refs` PASS. **`dtbd` will FAIL for as long as this plan file carries
`D-TBD-<slug>` entries** — `dtbd.test.ts` git-greps every TRACKED file, and this file becomes tracked
the moment it is `git add`ed. That is the mechanism working, not a break: allocate the block via
`POST /api/ledger/deviations`, define every number in `## Deviations found` in the same act, replace
every `D-TBD-<slug>` in this file (eight distinct slugs) and in the four commit messages that carry
one as a trailer (Tasks 1, 2, 3 and 4), and re-run until green.
Do not merge on a red `dtbd`.

- [ ] **Step 6: Run the two tree-wide scans** (`dtbd` is Step 5's)

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts
```

Expected: PASS. `single-definition` reds on a second copy of a single-sourced value;
`topology-clean` reds on a real operator account, pool, host or IP anywhere in the tree, this plan
included.

- [ ] **Step 7: Re-run every suite that shares `_auto_swap_check`, in isolation**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-preempt.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-auto-swap-hold.test.ts test/ccd-crosspool.test.ts test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-account-ok.test.ts test/ccd-limits.test.ts test/ccd-login-screen.test.ts test/ccd-start-id.test.ts test/ccd-arith-containment.test.ts test/ccd-session-state.test.ts test/ccd-substrate.test.ts test/ccd-supervised-start.test.ts
```

Expected: PASS. This is wave 2b Task 8 Step 6's list plus `ccd-preempt.test.ts`,
`ccd-limits.test.ts`, `ccd-login-screen.test.ts` and the three suites whose fixtures NAME
`_auto_swap_check` only to **stub it out** — `ccd-session-state.test.ts:280` and
`ccd-substrate.test.ts:105` both plant `_auto_swap_check() { :; };`, and
`ccd-supervised-start.test.ts:4` names it in a header comment saying the supervise loop is *not*
run (all three found with `grep -rln '_auto_swap_check' server/test/`). None of them reaches the
function; they are here to prove the stub still shadows a changed one, not to exercise it. Running
them together and alone is what separates a real break from the load flakes in Step 2.
`ccd-session-state` is itself a known flake; re-run it alone before calling it a break.

- [ ] **Step 8: State the deploy order — AGENT-FIRST (do NOT run it here)**

This amendment changes `ccd/` only, so it is **agent-first**: the fleet host takes the new `ccd`
before the server takes anything. The deploy is the operator's or the coordinator's act on merge,
never this plan's implementer's — no command below is run from this branch.

```bash
bash deploy/deploy.sh agent    # the fleet host: rsync -> ship ccd + notify.sh (backed up)
                               # + session-hook.sh -> host npm ci + build -> restart the unit
bash deploy/deploy.sh          # the server box: build the PWA here (freshness-gated) -> rsync
                               # -> box npm ci + build -> restart the unit -> health check
```

Coordinates come from `~/.ccrc/deploy.env` (`CCRC_BOX`, `CCRC_SSH_KEY`, `CCRC_SSH_PORT`,
`CCRC_AGENT_BOX`) — machine-local, outside every checkout. **No host argument is needed on this
fleet**; the agent lane takes its box from `CCRC_AGENT_BOX` and **never** falls back to `$CCRC_BOX`,
which on a two-box fleet is the *server* box. `deploy.sh` has no default target and refuses with
exit 2 rather than guessing.

Three things about this amendment in particular:

1. **The deploy window is quieter here than in wave 2b, and for a stated reason.** Between
   `install_atomic` and the `try-restart claude-session@*` sweep (behind its mandatory
   `KillMode=process` preflight), each running supervisor's `_auto_swap_check` is the **old** inode.
   An old supervisor never arms `preempt` and never calls `_preempt_budget_take`, so it simply keeps
   today's behaviour — no wrong-pool dispatch, no in-unit refusal, nothing to make audible. The
   pre-empt lane is a **no-op on every live session until the sweep runs**. Do not hand-`install_atomic`
   this build without it.
2. **Nothing changes until an account crosses 90% on fresh telemetry.** With every account under
   `SWAP_THRESHOLD`, the arming guard fails, `force_arg` stays `"$hard_blocked"`, and every insertion
   in this amendment is inert. There is no flag to set and no file to create; the rollout is the
   fleet's own load.
3. **The kill-switch is the constant.** Setting `SWAP_THRESHOLD` above 100 in the shipped file
   disarms the lane completely at the next deploy + sweep, without touching any other line. That is
   the honest answer to "how do I turn this off in a hurry"; there is no env override, deliberately
   (`CCD_DISK_FLOOR_GB`, `ccd/ccd:3877-3880`, is the one override ccd honours).

- [ ] **Step 9: Commit nothing**

This task adds no file. If Steps 1-7 required a fix, that fix belongs to the task that introduced it
— amend there, re-run this task from Step 1.

---

## Deviations found

**The ledger allocator was unreachable when this plan was written.** `POST /api/ledger/deviations`
lives on the server box and this session ran without a route to it, so every number below is written
`D-TBD-<slug>` per the convention and **must be MINTED AND DEFINED IN THE SAME ACT before merge**
(`GET /api/ledger`'s `floor` is what the next POST would mint, not a number anyone may take). Do not
look a number up; do not invent one; and **do not reuse a number from the account-pools block
`D-1663`–`D-1688`**, every one of which is already defined in one of that program's six wave plans.
`server/test/dtbd.test.ts` reds the moment this file is tracked and stays red until the placeholders
are replaced — that is the mechanism, not a break (Task 7 Step 5).

- **D-TBD-preempt-b-gate** (Task 1) — §D's target side depends on §B, and nothing in the tree said
  so. `_limit_field`'s `resetAt` branch (`ccd/ccd:11746-11749`) rewrites a rolled-over window to a
  confident `0`; `_limit_score` returns `max(0,0)`; `_swap_target`'s strict `<` (`ccd/ccd:11881`)
  then makes a dead account beat every honest one, permanently, because nothing runs there to report
  a real number. Today that magnet aims only rescues. The pre-empt lane would aim a VOLUNTARY swap
  at it, on a fleet-wide schedule. Fixed by making the dependency a standing red assertion rather
  than a sentence in a plan.
- **D-TBD-preempt-convergence-budget** (Task 2) — the spec asks for the budget as "a registry marker
  with a read-side cooldown", and a bare read-side compare cannot deliver "at most one pre-emptive
  swap per interval across the fleet": `claude-session@.service` is a systemd template, so ~20
  independent supervisors on a 5-second tick read the same open budget in the same second and all
  pass. The compare is therefore re-asked INSIDE a `flock -n`, the shape `_lc_rotate` measured into
  existence (`ccd/ccd:2222-2236`: two concurrent processes minted two generations from one event in
  8 of 10 runs).
- **D-TBD-preempt-torn-budget-opens** (Task 2) — a torn or hand-edited `preempt-budget` marker fails
  the digit guard, so the comparison falls through and the budget opens for exactly one swap, which
  then overwrites it with a valid stamp. Fail-OPEN, matching `_auto_swap_check`'s own `swapblocked`
  gate (`ccd/ccd:11909-11910`) rather than inventing a second convention on the same shape —
  self-healing, and stated here rather than discovered later.
- **D-TBD-preempt-maxage-first-user** (Task 3) — `_limit_field`'s `maxage` parameter
  (`ccd/ccd:11729`, `:11734`) has shipped with no user: `ccd/ccd:1268` omits it, `ccd/ccd:11760`'s
  shim defaults it to `0` and has no callers of its own, and `ccd/ccd:11767` passes an explicit `0`
  twice. The stale-HIGH hazard it exists to close has therefore been open the whole time. This is
  its first and only non-zero caller.
- **D-TBD-preempt-weekly-arm-dropped** (Task 3) — the removed policy took own pressure as
  `max(fresh 5h, day-fresh 7d)` through a SECOND non-zero `maxage`
  (`own_seven=$(_limit_field "$wrapper" seven 86400)`, `0bfd0c26^:ccd/ccd:137`). Only the 5h arm is
  restored, so `SWAP_THRESHOLD`'s own "own 5h %" comment is literally true and §D.1's "only non-zero
  `maxage` in the tree" claim survives. The cost, stated: the weekly axis stays covered ABOVE
  `SWAP_CEILING` by `_limit_score`/`_avail` and is uncovered in the 90-97 band.
- **D-TBD-preempt-return-home-not-charged** (Task 4) — arming `force` before `_swap_target` also
  skips the `cur != home` stay shortcut (`ccd/ccd:11849`), so an armed session whose home has
  recovered produces a return-home MOVE that would have happened anyway. Without an explicit
  `"$target" != "$home"` in the price block, that move would start waiting `SWAP_QUIET` (600 s)
  instead of `SWAP_CEIL_QUIET` (30 s) and could be refused by a headroom test that was never meant to
  judge it — a regression dressed as a guard.
- **D-TBD-swap-target-score-reread** (Task 4) — `_swap_target` does not publish its winner's score
  and is deliberately not widened to (its stdout already folds "stay, fine" into "must leave,
  nowhere", which wave 2b's D-1673 argues), so the headroom test re-reads `_limit_score "$target"`.
  A target chosen at score S is judged at S' if telemetry moved between the two reads. Accepted: S'
  is the newer measurement, and judging a move on the newer number is the more honest of the two.
- **D-TBD-fleet-polish-swap-threshold-prose** (Task 6) —
  `docs/superpowers/specs/2026-07-29-ccrc-fleet-polish-design.md:72-74` asserts that
  "`_auto_swap_check` moves `wrapper` off `home` when that account's 5h score crosses
  `SWAP_THRESHOLD`". That has been false since `0bfd0c26` (2026-07-07), which left the constant with
  zero readers. This plan makes the sentence true again rather than correcting the prose, and the
  liveness pin is what stops it becoming false a second time silently.

---

## Self-review

**Spec coverage.** §D has five subsections and every one is implemented or explicitly declined:

| spec | where |
|---|---|
| §D.1 — not a new lane; the earlier trigger; `SWAP_FRESH` as the tree's only non-zero `maxage`; `SWAP_QUIET` makes `quiet_req` a variable | Tasks 3 and 4; the "only non-zero `maxage`" claim is verified in *Background* §2 with all four call sites listed |
| §D.2 — why `SWAP_JITTER` does not cover it | Task 2's constant comment and helper comment, citing `ccd/claude-session@.service:23`, `ccd/ccd:13207`, `:13215`, `:13224` and `:11684` |
| §D.3 — the fleet-wide budget; the rescue exemption; per-target inbound claims NOT chosen | Tasks 2, 4 and 5; inbound claims are not implemented and are not mentioned as a future task, matching the spec's "recorded as the escalation" |
| §D.4 — §B is a prerequisite | Task 1, as a hard gate with a STOP instruction, plus Task 7 Step 1's re-measurement |
| §D.5 — wiring makes the comments true | Task 6's liveness pin |

**One spec claim I could not verify, stated as unmeasured rather than repeated.** §D.5 says wiring
the constants retires "wave 5's prose item". `grep -rn 'SWAP_THRESHOLD\|SWAP_HEADROOM\|SWAP_FRESH\|SWAP_QUIET' docs/superpowers/`
finds **no** occurrence in `2026-09-05-account-pools-wave5-docs.md` or in the account-pools design
spec — its nine tasks are README, `config.ts`, `ccd`'s `CCRC_MEASURED` comment, `deploy.sh` and
`CLAUDE.md`. The only stale prose I could measure is
`docs/superpowers/specs/2026-07-29-ccrc-fleet-polish-design.md:72-74`, recorded as
**D-TBD-fleet-polish-swap-threshold-prose**. If a wave-5 item does exist under different wording,
this plan does not retire it and does not claim to.

**Placeholder scan.** No `TBD` outside the deliberate `D-TBD-<slug>` the convention prescribes for an
unreachable allocator; no "add error handling"; no "similar to Task N" — the arming, the price block,
the budget helper and every test case carry their literal content, including the two fixtures
(`QUIET`, `BLOCKED`) that resemble wave 2b's and are written out in full rather than referenced.
No step names a function no task defines.

**Type and name consistency.** The bash names this plan introduces are `SWAP_PREEMPT_BUDGET`,
`_preempt_budget_take`, `$REG/preempt-budget`, `$REG/.preempt-budget.lock`, and the four
`_auto_swap_check` locals `own`, `preempt`, `force_arg`, `quiet_req` (plus `tsc` inside the price
block). Every one is defined in exactly one task and used under exactly that spelling everywhere
else. `aff_verb` is wave 2b's, consumed and assigned but never redeclared. The TS helpers
(`budget`, `now`, `writeLimits`, `seed`, `idleStatus`, `tick`, `logLines`, `openBudget`,
`closeBudget`) are each defined once, in the task that first uses them, with **one deliberate
exception**: `closeBudget` is declared twice — in Task 4's `describe` and again in Task 5's, in its
own scope — so that each of the two file sections reads standalone. `writeLimits`'s third parameter
(`ageS`) and `idleStatus`'s second (`cfg`) both exist from their first definition precisely so no
later task has to redefine either: `ageS` is what Task 3's freshness cases need, and `cfg` is what
Task 4's return-home case needs, since that case re-seeds `wrapper` to `claude-a` and the idle gate
reads `_cfg_dir "$wrapper"`. `_swap_target`'s signature,
`_limit_field`'s signature and `_auto_swap_check`'s signature and rc are all unchanged.

**Five risks handed to the implementer, none of them hidden:**

1. **Wave 2b's line anchors are stale by roughly +686 lines** (its base predates waves 1 and 2a).
   *Background* §8 tabulates both, but re-derive from the shipped source before every edit. Where an
   anchor and the source disagree, the source wins.
2. **Task 2 Step 6's race mutation may not reproduce on a fast, idle box.** Two background jobs can
   serialise by luck. The step says explicitly not to accept a green mutation and gives the widening
   (a 50-iteration spin). A guard whose mutation cannot be shown is not yet a mechanism.
3. **`_preempt_budget_take` depends on `flock(1)` and refuses without it.** That is not a new
   dependency — `ccd/ccrc-doctor-checks:484-485` requires it by name and `ccd/ccrc:3792-3793` refuses
   to run without it — but it does mean the pre-empt lane silently never fires on a box with no
   `flock`. Refusal is the safe direction (a pre-empt is an optimisation), and no doctor check is
   added for it because the existing one already covers the binary. The behaviour is a mechanism
   rather than a claim: Task 2's eighth case shadows the `command` builtin so `command -v flock`
   answers 1, and Task 2 Step 6's fourth mutation deletes the probe and measures the red.
4. **The four cases in Task 5 pass with no code change.** That is intended and stated, but it makes
   them the easiest four tests in this plan to write wrong and never notice. Step 3's three mutations
   are what prove them; do not skip that step because Step 2 was green.
5. **`dtbd.test.ts` reds as soon as this file is `git add`ed** and stays red until the **eight**
   D-TBD slugs are replaced with minted, defined numbers — in this file AND in the commit-message
   trailers of Tasks 1, 2, 3 and 4 (Tasks 5, 6 and 7 carry no trailer). Allocate a block of eight in
   one `POST /api/ledger/deviations`, and plan that call before the first commit, not after the last.
