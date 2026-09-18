# Account-pool membership, wave 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag an account into a pool from the PWA, with coord.db as the only writer, a flat-file journal under it, and a leased projection the fleet pulls — so a control-plane outage fails SHUT into tagged projects and never silently unconstrains them.

**Architecture:** `pool_edges` + `pool_epoch` in `~/.ccrc/coord.db` are authoritative, with `~/.ccrc/pool-edges.log` as the D8 flat-file ground truth (append inside the tx, before the commit; recovery takes MAX). `ccd pool-sync` pulls a document to `$REG/pool-epoch.json` — a **leased projection**, never a source — and `ccd` decides placement from that one local file, never the network. The server writes the origin and forecasts from coord.db directly. The roster's `pool` key is RETAINED as the lowest-precedence declared default, and the wire says per entry which carrier decided.

**Tech Stack:** bash 5 (`ccd/ccd`), TypeScript ESM across four packages (`shared/` L0, `server/`, `agent/`, `pwa/`), `node:sqlite` `DatabaseSync` (synchronous, never wrapped async), fastify, React + vitest/jsdom, systemd --user.

**Spec:** `docs/superpowers/specs/2026-09-18-account-pool-membership-design.md` (committed `7ce70c3b`). Read it before Task 1; the plan argues from it and every conflict resolves toward the spec EXCEPT where "Corrections to the spec" below records a measurement that falsifies it.

---

## Global Constraints

- **AGENT-FIRST.** Tasks 1–3 touch `ccd/`; they ship to the fleet host BEFORE the server lane. `bash deploy/deploy.sh agent <host>` precedes `bash deploy/deploy.sh`. The server reads what the fleet writes, and the agent caches `ccd caps` at boot.
- **Every edit to `ccd/ccd` MUST be followed by a re-stamp**, in the same commit. The file carries a self-hash tamper marker at `ccd/ccd:2` (`# ccrc:generated 1 sha256=…`), pinned by `server/test/ownership.test.ts:120-192`. A stale marker makes a freshly deployed ccd report `ccrc-edited` on every box forever. Command, verbatim from `ownership.test.ts:132-135`:
  ```
  node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
    const { markGenerated } = await import('./shared/mark.mjs'); \
    writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
  ```
- **FIXTURE HOMEs only** — never run `ccd` against the live `$HOME`. Harness `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts:281`); `sh(snippet)` sources ccd under a temp HOME.
- **NEVER** run `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore` against the live host. **Never** touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly.
- **Suites run from inside the package, in the FOREGROUND, timeout ≥600000ms:** `cd server && ./node_modules/.bin/vitest run test/<file>`. NEVER bare `npx vitest`.
- **`EXEC_COMMANDS` stays `['tmux','ccd']`** and `EXEC_WHITELIST`'s key set stays exactly `['ccd','tmux']`. No `ccrc` grant. The agent write allowlist stays `.cc-clips` only.
- **`CoordStore` stays synchronous.** No async wrapper, no repository interface over it.
- **`FLEET_PROTO` is NOT bumped** (=1). Every field added here is additive and absence-permitting, with a single reader per field.
- **The pool verdict stays three-valued** (`serve`/`mismatch`/`undecidable`). No overloaded null at a seam: `stale` and `unreadable` are two words with two remedies and must never fold.
- **No account name, host, IP, tailnet or DuckDNS name in any tracked file.** Fixtures are `pool-a`/`pool-b`. Real pool names are operator DATA that nothing scans for.
- **Deviation numbers are ISSUED, never chosen.** See "Deviations found" at the foot of this plan — do NOT pre-allocate.
- **Never invent a `D-TBD-` into a tracked file.** If the allocator is unreachable, report rather than guess.

---

## Corrections to the spec, measured 2026-09-18

The spec was written from citations; these eight were re-measured against the tree at `7ce70c3b` and found wrong. **Where this section and the spec disagree, this section is the truth** — each is a measurement, not a preference. Every one of them is a departure to record in the deviation block at the end.

1. **`mv -fT` would ship broken code on macOS.** Spec §5.4 says the projection is written "through `mktemp` + `mv -fT`". Measured: `mv -fT` is GNU-only and `ccd` has a shim for exactly this — `_plat_mv_notdir` (`ccd/ccd:152-160`), which branches on `$CCD_OS`. The real idiom, from `cmd_project_pool` (`ccd/ccd:8527-8555`), is a hand-built dot-leading tmp `"$POOLS_DIR/.$project.$BASHPID.tmp"` + `_plat_mv_notdir` — **not `mktemp`**. Use the measured idiom.
2. **No systemd timer dispatches a `ccd` verb today.** All five timer jobs (`ccd-cap-scopes`, `ccd-usage-sweep`, `ccd-account-health`, `ccd-telemetry-keepalive`, `ccd-graph-sweep`) are standalone executables. `ccd-pool-sync.service` calling `ccd pool-sync` is the FIRST of its kind. **The ruling this forces is R1 below, not a verb** — a deeper measurement (`ccd/ccd` makes zero network calls, by doctrine) settles it the other way. Read R1 before acting on this line.
3. ~~**`poolRule()` has NO production call site.**~~ **RETRACTED 2026-09-18, during Task 5 — this was false.** There are **five** production callers and all five predate this wave: `server/src/poolrule.ts:49,50,63,76` and `pwa/src/lib/pools.ts:39`, every one present at this plan's own base `3119b295`. I wrote the original claim from a scout's negative report and did not re-measure it — an empty grep proves what you searched, not what is absent. What is TRUE: `server/src/poolrule.ts` is the server's adapter over the L0 rule and `refusePool` reaches the rule through it, so Task 7 extends THAT adapter rather than calling `poolRule` directly from `server.ts`. Re-signaturing `poolRule` therefore breaks five call sites, and the task that does it must carry them (Ruling T5-R1: `declaredAccountPool()` adapts a roster name to the wire, behaviour unchanged).
4. **`poolRule`'s permissive fold is DOCUMENTED and must be preserved, not reversed.** `poolrule.ts:57-65` argues that `accountPool: null` deliberately means both "untagged" AND "an account this side cannot see", because the PWA's roster can lag the fleet's. The new `stale`/`unreadable` states must be added ALONGSIDE that fold, not on top of it: an account missing from the roster stays permissive; a projection that could not be read is undecidable. Collapsing them re-creates the fail-open this design exists to prevent.
5. **Homes are wrong in four citations.** `generateAccountsSh` and the `_ccrc_pool` emission are in `shared/generate.mjs:213,278-291,323-326` — not `roster.ts`. `RosterWire` is `shared/api.ts:3416` — not `roster.ts`. `tx()` is a free function at `server/src/coord/db.ts:245` — not a `CoordStore` method. `readRosterFp` is `agent/src/server.ts:557-562` — not `:512`.
6. **The `ready` handshake is a different wire.** `AgentReady`/`rosterFp` live in `shared/agent-protocol.ts:63` (agent↔server), NOT in `shared/api.ts` (PWA↔server, the one `FLEET_PROTO` governs). Spec §10 lumps them; `observedEpoch` belongs on the agent protocol and is NOT covered by `FLEET_PROTO`.
7. **`accountPool()` has 8 call sites, not 9**, and only ONE lib file calls it: `NewSessionSheet.tsx:186,281`; `SessionLine.tsx:378`; `SwapSheet.tsx:541,632`; `pools.ts:64,102,125`.
8. **Deviations are allocated retrospectively, not at plan time.** Spec §9 says "the implementation plan allocates its block … at plan time". Measured: the two most recent shipped plans both allocate *after* the whole-slice review ("Issued by the allocator on <date> … and defined in the same act"), which is what CLAUDE.md's "allocate and DEFINE IN THE SAME ACT" actually requires — you cannot define a departure you have not yet found. **This plan does not pre-allocate.**

Two further facts that are not spec errors but change the work:

- **`pool_epoch` should use the existing single-row idiom**, `id INTEGER PRIMARY KEY CHECK (id = 1)` with a seeding `INSERT`, copied from `coordinator_state` (`server/src/coord/schema.ts:196-203`). The spec's bare two-column table has no way to refuse a second row.
- **Migration slot 13 has a named contender.** PR #40 (`ws/automation-runner-with-scheduling-and`, last updated 2026-09-11) adds one migration currently spelled slot 11 — already taken on main — so it must move up when rebased. `schema.ts:918-922` records the last branch that lost this race. **Re-measure the slot against `origin/main` immediately before merge** (Task 9 Step 1).

---

## File Structure

**Fleet (`ccd/`) — ships first**
- `ccd/ccd` — MODIFY, and **only these three things** (rulings R1/R2 removed the verb, the dispatch arm and the grant): `_acct_pool_state` beside `_acct_pool` (`:2061`), `_pool_ok`'s account arm (`:2111`), and one `account-pools` CAPABILITY token in the caps heredoc (`:7583-7618`). Re-stamped in every commit that touches it.
- `ccd/ccd-pool-sync` — CREATE. The curl-using sibling; `ccd/ccd` never makes the call itself.
- `deploy/systemd/ccd-pool-sync.{service,timer}` — CREATE. Copies of the cap-scopes pair.
- `deploy/deploy.sh` — MODIFY. Unit install + enable, agent lane.
- `ccd/ccrc` — MODIFY. `_inst_units`/`_inst_enable`, the second install path.
- `ccd/ccrc-doctor-checks` — MODIFY. The `known` unit array.

**Shared (L0)**
- `shared/poolrule.ts` — MODIFY. `AccountPoolWire`, `poolRule` re-signature, the account arm.
- `shared/api.ts` — MODIFY. `accountPools` on the pools frame; the epoch wire shape.
- `shared/agent-protocol.ts` — MODIFY. `observedEpoch?` on `AgentReady`.

**Server**
- `server/src/coord/schema.ts` — MODIFY. Migration slot 13.
- `server/src/coord/pooledgelog.ts` — CREATE. `PoolEdgeLog`, modelled line-for-line on `ledgerlog.ts`.
- `server/src/coord/store.ts` — MODIFY. `setAccountPools`, `readPoolEdges`, `poolEpoch`.
- `server/src/server.ts` — MODIFY. The two routes; the account arm of `refusePool`.
- `server/src/ccdargv.ts` — **UNCHANGED.** No `poolSync` builder: ruling R2 drops the nudge.
- `agent/src/whitelist.ts` — **UNCHANGED.** No new grant, no `REQUIRED_VERB_FLAG` entry. `agent/test/whitelist.test.ts` gains one read-only pin on the projection path (Task 4 Step 4b).

**PWA**
- `pwa/src/lib/accounts.ts` — MODIFY. `accountPool` gains precedence + origin; stays the single reader.
- `pwa/src/fleet/AccountPoolSheet.tsx` — CREATE. The editor, with free text (unlike `PoolSheet`).
- `pwa/src/screens/AccountsScreen.tsx` — MODIFY. The chip in `.accounts-row-head` (`:230`).
- `pwa/src/screens/FleetScreen.tsx`, `pwa/src/fleet/fleet.css` — MODIFY. `epoch N / observed M`.
- `pwa/src/lib/api.ts` — MODIFY. `setAccountPools`.

**Docs**
- `CLAUDE.md` — MODIFY. The freshness dependency, named rather than discovered (spec §8).
- The spec itself — MODIFY. Fold the eight corrections back in (Task 9).

---

## Four rulings the spec did not anticipate

These came out of measurement after the spec was approved. Each resolves a gap **in the direction of the spec's own stated invariants**, and each is a departure to record.

**R1 — `ccd-pool-sync` is a SIBLING EXECUTABLE, not a `ccd` verb.** This reverses correction #2 above, which I got wrong before measuring. `ccd/ccd` makes **zero** outbound network calls, and `ccd/ccd-account-health:5-9` states the doctrine explicitly: *"WHY THIS IS A SIBLING EXECUTABLE AND NOT CODE INSIDE `ccd`. `ccd/ccd` makes ZERO outbound network calls — measured, one `curl` in 13k+ lines and it is inside a comment. An HTTP client there would be a new dependency class for every session-supervising path on the box."* Spec §5.7 already requires `ccd` to "never the network at placement time"; the sync was never `ccd`'s job. `ccd-pool-sync` joins `ccd-account-health` and `ccd-telemetry-keepalive` as a curl-using sibling with its own failure contract.

**R2 — THE NUDGE IS DROPPED.** Spec §5.5's `deps.runCcd(CCD_ARGV.poolSync())` existed only to reach a `ccd` verb, and R1 removes the verb. The spec already disowns it — *"The nudge is explicitly an optimisation … deleting the nudge on EKS changes latency and nothing else"* (§5.5), and *"Convergence is owned by the pull"*. Dropping it now rather than at the EKS migration means:
- **`EXEC_WHITELIST` does not change at all.** No new grant, no `REQUIRED_VERB_FLAG` sixth entry, no `CCD_ARGV.poolSync`, no `ccd caps` line, no dispatch arm, no `whitelist-subset.test.ts` churn. The exec surface stays closed more firmly than the spec claimed.
- **`ccd/ccd`'s only change is two pure local readers** (Tasks 1–2). No re-stamp risk beyond those.
- **The cost is latency, bounded by `OnUnitActiveSec=60s`.** The PWA's own reply is immediate and exact (the server forecasts from coord.db directly, spec §5.7); only the fleet's *enforcement* lags ≤60s, and the `epoch N / observed M` indicator of §5.9 exists precisely to show that lag. The UI never lies; it just shows a number catching up.
This is the single largest reduction available to the wave's 4/10 cost score, and it costs one minute of convergence on a billing grouping.

**R3 — the projection is LINE-ORIENTED TEXT at `$REG/pool-epoch`, not JSON.** `ccd` has no JSON parser: it reads JSON with `grep -oE` (`_limit_json_num`, `ccd/ccd:14883`) and encodes with `python3` (`:3527`, `:3685`). Parsing a nested `accounts{}` object that way is fragile, and `_pool_ok` is called once **per candidate account** in a loop whose existing comment (`ccd/ccd:2108-2110`) optimises for exactly this — *"a loop over five candidates costs one `cat`, not five."* A dotless line-oriented file (the `pools/<project>` precedent) is read once into an associative array with `while read`, needs no `source` and no `eval` (so it is not a code-execution surface the way a generated `.sh` would be), needs no python3, and is trivially parsed by the agent for `observedEpoch`. Format, exactly:
```
epoch 43
issued 1758000000
lease 1758000900
acct <account-id> <pool-name>
acct <account-id> <pool-name>
```
`acct` lines may be zero — **an `epoch` line with no `acct` lines means "synced, nothing tagged"; NO FILE means "never synced" and reads `unreadable`.** That distinction is the whole fail-shut (spec §5.4) and must never fold.

**R4 — `pool_epoch` takes the single-row idiom.** `id INTEGER PRIMARY KEY CHECK (id = 1)` plus a seeding `INSERT`, copied from `coordinator_state` (`server/src/coord/schema.ts:196-203`). The spec's bare table cannot refuse a second row.

---

### Task 1: `_acct_pool_state` — the account side's five-word reader

**Files:**
- Modify: `ccd/ccd` (insert after `_acct_pool`, `ccd/ccd:2061`)
- Test: `server/test/ccd-acct-pool-state.test.ts` (create)

**Interfaces:**
- Consumes: `$REG` (`ccd/ccd:980`), `_pool_name_valid` (`ccd/ccd:1588`), `POOL_NAME_RE` (`ccd/ccd:1011`).
- Produces: `_acct_pool_state <account-id>` → echoes exactly one of `named <n>` | `untagged` | `unreadable` | `malformed` | `stale`, **always rc 0**. Also `_acct_pool_load` (memoiser) and the globals `_APS_LOADED`, `_APS_EPOCH`, `_APS_STATE`, `_APS_POOL` (associative array). Task 2 consumes the word.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-acct-pool-state.test.ts`, modelled on `server/test/ccd-project-pool.test.ts:1-88`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness } from './ccdWsHelpers.js';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

const h = makeCcdHarness('acct-pool-state');
beforeEach(() => h.reset?.());
afterEach(() => h.cleanup());

/** Plant the projection with the given body; returns its path. */
function plant(body: string): string {
  const reg = path.join(h.home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const f = path.join(reg, 'pool-epoch');
  writeFileSync(f, body, 'utf8');
  return f;
}
const state = (id: string): string => h.sh(`_acct_pool_state ${id}`);

describe('_acct_pool_state', () => {
  it('answers `unreadable` when the file does not exist — absence is NOT untagged', () => {
    expect(state('acct-a')).toBe('unreadable');
  });

  it('answers `untagged` for a synced document that tags nobody', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\n');
    expect(state('acct-a')).toBe('untagged');
  });

  it('answers `named <n>` for a tagged account', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('named pool-a');
  });

  it('answers `untagged` for an account the document does not name', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-b')).toBe('untagged');
  });

  it('answers `stale` past the lease — and `stale` is NOT `unreadable`', () => {
    plant('epoch 43\nissued 1000\nlease 1001\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('stale');
  });

  it('answers `malformed` for a pool name off the grammar', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a Pool_A\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `malformed` when the document carries no epoch line', () => {
    plant('acct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `unreadable` when the file exists but cannot be read', () => {
    const f = plant('epoch 43\nissued 1000\nlease 9999999999\n');
    chmodSync(f, 0o000);
    expect(state('acct-a')).toBe('unreadable');
  });

  it('answers `unreadable` when $REG itself is unsearchable', () => {
    const reg = path.join(h.home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    chmodSync(reg, 0o000);
    try { expect(state('acct-a')).toBe('unreadable'); }
    finally { chmodSync(reg, 0o700); }
  });

  it('reads the file ONCE across repeated calls (the loop-cost rule)', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    const out = h.sh(
      '_acct_pool_state acct-a >/dev/null; ' +
      '_acct_pool_state acct-b >/dev/null; ' +
      'echo "$_APS_LOADED"');
    expect(out).toBe('1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-acct-pool-state.test.ts`
Expected: every case FAILS — `_acct_pool_state: command not found` (bash prints nothing to stdout, so each `expect` sees `''`).

- [ ] **Step 3: Implement `_acct_pool_load` and `_acct_pool_state`**

Insert into `ccd/ccd` immediately after `_acct_pool` (`ccd/ccd:2061`), before the `THE RULE` comment block:

```bash
# THE ACCOUNT SIDE'S STATE, and the reason it is not `_acct_pool`'s shape.
#
# `_acct_pool` answers a NAME or empty, and empty means untagged — which was
# honest while the only carrier was the roster, a file that is either present
# or the box has no accounts at all. The projection is different: it can be
# ABSENT (this node has never synced), STALE (the control plane has been
# unreachable longer than the lease) or MALFORMED, and all three mean NOBODY
# DECIDES. Folding any of them into "untagged" would silently lift every
# account constraint on the box, which is the fail-OPEN direction and the one
# outcome the whole design exists to prevent (spec §5.4).
#
# FIVE WORDS, NOT FOUR. `stale` does not fold into `unreadable`: both mean
# nobody decides, but one's remedy is file permissions and the other's is the
# control-plane link, and the die message a human reads has to say which.
# An adapter may not narrow a distinction it received.
#
# READ ONCE, ANSWERED MANY TIMES. `_pool_ok` runs per CANDIDATE account, so a
# per-call read would turn one placement into N reads of the same file — the
# cost `_pool_ok`'s own comment already refuses for the project side. The
# memoisation is a load flag plus one associative array, both process-local.
_APS_LOADED=0
_APS_STATE=''
_APS_EPOCH=''
declare -A _APS_POOL=()
_acct_pool_load() {   # -> sets _APS_STATE to '' (usable) or a verdict word
  [[ "$_APS_LOADED" == 1 ]] && return 0
  _APS_LOADED=1
  # The same LOCALE shadow `_project_pool_state` argues for (D-2520): the
  # grammar, the trailing strip and `_pool_name_valid` are ASCII rules about a
  # file whose only legal content is ASCII, and without this they follow
  # whatever locale the caller ran under.
  local LC_ALL=C
  local f="$REG/pool-epoch" line k v p now lease=''
  # ABSENCE PROVEN AT EVERY LEVEL IT IS CLAIMED, exactly as
  # `_project_pool_state` does it one directory down.
  [[ -d "$REG" && -x "$REG" ]] || { _APS_STATE=unreadable; return 0; }
  [[ -e "$f" || -L "$f" ]]     || { _APS_STATE=unreadable; return 0; }
  [[ -f "$f" && -r "$f" ]]     || { _APS_STATE=unreadable; return 0; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    k=${line%% *}; v=${line#* }
    case "$k" in
      epoch)  _APS_EPOCH=$v ;;
      # `issued` is CARRIED BUT NOT READ here: the lease is what this reader
      # decides on, and issuedAt is for the operator and the PWA's lag chip.
      # It still needs an arm — without one it falls to `*)` and every real
      # document reads `malformed`, because R3's format always emits it.
      issued) ;;
      lease)  lease=$v ;;
      acct)   p=${v#* }; v=${v%% *}
              # A name off the grammar poisons the WHOLE document: a reader
              # that skipped the bad row would serve the rest under a tag it
              # could not validate.
              _pool_name_valid "$p" || { _APS_STATE=malformed; return 0; }
              _APS_POOL["$v"]=$p ;;
      '')     ;;
      *)      _APS_STATE=malformed; return 0 ;;
    esac
  done < "$f" 2>/dev/null || { _APS_STATE=unreadable; return 0; }
  # No epoch line is not an empty document — it is a document this reader does
  # not recognise, and recognising it partially is how a stale format gets
  # served as fact.
  [[ "$_APS_EPOCH" =~ ^[0-9]+$ ]] || { _APS_STATE=malformed; return 0; }
  [[ "$lease" =~ ^[0-9]+$ ]]      || { _APS_STATE=malformed; return 0; }
  now=$(date +%s)
  (( now > lease )) && { _APS_STATE=stale; return 0; }
  return 0
}
_acct_pool_state() {   # account-id -> "named <n>" | untagged | unreadable | malformed | stale ; always rc 0
  _acct_pool_load
  [[ -n "$_APS_STATE" ]] && { echo "$_APS_STATE"; return 0; }
  local p="${_APS_POOL[${1-}]-}"
  # An account the document does not name is UNTAGGED, not unknown: the
  # document is complete by construction (the control plane always emits every
  # edge it holds), so silence about an account is a positive statement that
  # it carries no pool. This is the one fold that is honest here.
  [[ -z "$p" ]] && { echo untagged; return 0; }
  echo "named $p"
}
```

- [ ] **Step 4: Re-stamp `ccd/ccd`**

Run from the repo root:
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

- [ ] **Step 5: Run the tests to verify they pass, plus the adjacent suites**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-acct-pool-state.test.ts test/ownership.test.ts test/ccd-project-pool.test.ts test/macos-platform.test.ts`
Expected: PASS. `ownership.test.ts` proves the re-stamp took; `macos-platform.test.ts` proves no GNU-only idiom crept in.

- [ ] **Step 6: Mutation check — measured, not asserted**

For each, make the edit, run the suite, record RED, then restore with `cp` from a pre-edit copy and `cmp` to prove restoration (never `git checkout --`):

| Mutation | Must go RED in |
|---|---|
| `_APS_STATE=unreadable` → `_APS_STATE=untagged` on the absent-file arm | `answers 'unreadable' when the file does not exist` |
| delete the `(( now > lease ))` arm | `answers 'stale' past the lease` |
| `stale` → `unreadable` in that arm | `answers 'stale' past the lease` |
| delete the `_pool_name_valid` guard | `answers 'malformed' for a pool name off the grammar` |
| `[[ "$_APS_LOADED" == 1 ]] && return 0` → `:` | `reads the file ONCE` |

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-acct-pool-state.test.ts
git commit -m "feat(ccd): _acct_pool_state — five words for the account side, absence is not untagged"
```

---

### Task 2: `_pool_ok` gains the account arm

**Files:**
- Modify: `ccd/ccd:2111-2118` (`_pool_ok`)
- Modify: `server/test/fixtures/poolRule.ts` (the shared case table)
- Test: `server/test/ccd-pool-ok.test.ts` (existing — drives bash from the same fixture)

**Interfaces:**
- Consumes: `_acct_pool_state` (Task 1).
- Produces: `_pool_ok <account-id> <project-pool-state>` → rc 0 serve | 1 mismatch | 2 undecidable. **Signature is unchanged**; only the account-side read inside it changes.

- [ ] **Step 1: Add the account-state rows to the shared fixture**

`server/test/fixtures/poolRule.ts` — extend `PoolRuleCase` with an optional account state and append rows. The interface (`:119-128`) gains one field; existing rows are untouched because it is optional:

```ts
export interface PoolRuleCase {
  name: string;
  /** `null` = an untagged account, or one this side cannot see — see
   *  `poolRule`'s docstring for why those two are deliberately one value. */
  accountPool: string | null;
  /** The account side's MEASURED state, when it is not simply a name. Absent
   *  means `accountPool` carries the whole answer, which is every row written
   *  before the projection existed. `unreadable`/`stale`/`malformed` are the
   *  three that must reach `undecidable` and must never fold into untagged. */
  accountState?: 'unreadable' | 'stale' | 'malformed';
  project: ProjectPoolWire;
  expect: 'serve' | 'mismatch' | 'undecidable';
  why: string;
}
```

Append these rows to `POOL_RULE_CASES`:

```ts
  {
    name: 'acct-unreadable-project-tagged', accountPool: null, accountState: 'unreadable',
    project: { state: 'tagged', name: 'pool-a' }, expect: 'undecidable',
    why: 'a node that has never synced must refuse into a tagged project, never serve — the cold-pod fail-shut and the EKS default path',
  },
  {
    name: 'acct-stale-project-tagged', accountPool: null, accountState: 'stale',
    project: { state: 'tagged', name: 'pool-a' }, expect: 'undecidable',
    why: 'past the lease nobody decides; a stale node must not serve a constraint it can no longer read',
  },
  {
    name: 'acct-malformed-project-tagged', accountPool: null, accountState: 'malformed',
    project: { state: 'tagged', name: 'pool-a' }, expect: 'undecidable',
    why: 'a document off the grammar is not an empty one',
  },
  {
    name: 'acct-unreadable-project-untagged', accountPool: null, accountState: 'unreadable',
    project: { state: 'untagged' }, expect: 'serve',
    why: 'THE SHORT-CIRCUIT: an untagged project is unconstrained, so a control-plane outage must not stop placement into it — this row is what bounds the blast radius to the constrained set',
  },
  {
    name: 'acct-stale-project-untagged', accountPool: null, accountState: 'stale',
    project: { state: 'untagged' }, expect: 'serve',
    why: 'the same short-circuit for the stale arm — ordering, not a special case',
  },
  {
    name: 'acct-unreadable-project-unreadable', accountPool: null, accountState: 'unreadable',
    project: { state: 'unreadable' }, expect: 'undecidable',
    why: 'both sides unreadable is still one verdict, and it is not a mismatch',
  },
```

- [ ] **Step 2: Teach the bash driver the account state, and run it RED**

`server/test/ccd-pool-ok.test.ts` stubs `_ccrc_pool` per row (`:35-39`). It must now stub `_acct_pool_state` instead, driven by `accountState ?? (accountPool === null ? 'untagged' : \`named ${accountPool}\`)`:

```ts
const acctWord = (c: PoolRuleCase): string =>
  c.accountState ?? (c.accountPool === null ? 'untagged' : `named ${c.accountPool}`);
const stub = (c: PoolRuleCase): string =>
  `_acct_pool_state() { echo '${acctWord(c)}'; }; `;
```

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pool-ok.test.ts`
Expected: the six new rows FAIL — `_pool_ok` still calls `_acct_pool` and reads every new state as an untagged (empty) account, so all six return rc 0 where three expect rc 2.

- [ ] **Step 3: Implement the account arm**

Replace `_pool_ok`'s body (`ccd/ccd:2111-2118`) — note the project arms are UNCHANGED and stay FIRST:

```bash
_pool_ok() {   # account-id pool-state -> 0 serve | 1 mismatch | 2 undecidable
  local ap pp
  # THE PROJECT SIDE DECIDES FIRST, and the order is the whole blast-radius
  # argument (spec §5.8). An untagged project is unconstrained, so it must
  # serve WITHOUT consulting the account side at all — otherwise a control
  # plane that has been down longer than the lease would stop placement into
  # every project on the box, instead of only the ones somebody deliberately
  # tagged. Moving this below the account read is the difference between an
  # outage nobody notices and a fleet-wide stop.
  case "$2" in
    untagged)  return 0 ;;
    "named "*) pp=${2#named } ;;
    *)         return 2 ;;                     # unreadable | malformed: nobody decides
  esac
  ap=$(_acct_pool_state "$1")
  case "$ap" in
    untagged)  return 0 ;;
    "named "*) ap=${ap#named } ;;
    *)         return 2 ;;                     # unreadable | stale | malformed: nobody decides
  esac
  [[ "$ap" == "$pp" ]]
}
```

- [ ] **Step 3b: Declare the capability — a TOKEN, not a verb**

Spec §5.9 sources `PoolsEnforcement.accountPools` from "the verb's presence in `ccd caps`", but ruling **R2** removed the verb. `ccd caps` already carries a second class for exactly this: `stop-surface` is *"a CAPABILITY token, not a dispatchable verb"* (`ccd/ccd:7620-7626`), riding the same channel because the agent's caps reader and the server's `verbSupported` do a plain membership check with no assumption that every member is dispatchable.

Add `account-pools` to the `ccd caps` heredoc (`ccd/ccd:7583-7618`) — this is what tells a server whether the fleet's `ccd` honours account pools at all, and it is the honest signal now that there is no verb to detect:

```bash
account-pools
```

`KNOWN_CAPABILITY_TOKENS` in `server/test/ccd-archive.test.ts` is **hand-maintained** and is pinned by `server/test/ccd-account-auth.test.ts:993`, which regex-extracts it. Add the ninth token there in the same commit or that pin reds.

- [ ] **Step 4: Re-stamp `ccd/ccd`** (same command as Task 1 Step 4).

- [ ] **Step 5: Run green, plus every suite that reads `_pool_ok` or the fixture**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pool-ok.test.ts test/pool-rule-core.test.ts test/ccd-crosspool.test.ts test/pool-tag-parity.test.ts test/pools-prose.test.ts test/ownership.test.ts test/ccd-archive.test.ts test/ccd-account-auth.test.ts test/caps-token-shape.test.ts`
Expected: PASS. `pool-rule-core.test.ts` will only pass after Task 5 re-signatures `poolRule`; if it reds here on the new rows, **that is expected and Task 5 closes it** — record it in the ledger rather than weakening the fixture.

- [ ] **Step 6: Audit all 12 call sites**

`ccd/ccd:2073`'s own comment says 18 grep lines, 12 real call sites. Verify each still passes an ACCOUNT ID as `$1` (they passed a wrapper before, and wrapper == account id on this fleet — confirm, do not assume):
```bash
grep -n '_pool_ok ' ccd/ccd
```
Expected: 6010, 6310, 15407, 15455, 15543, 16073, 16096, 16669, 19275, 20281, 20976, 21267. Read each and confirm `$1` is an account id. **If any passes something else, STOP and report** — the signature's meaning changed under it.

- [ ] **Step 7: Mutation check**

| Mutation | Must go RED in |
|---|---|
| move the `ap=$(_acct_pool_state "$1")` read ABOVE the project `case` | `acct-unreadable-project-untagged` (the short-circuit row) |
| account `*)` arm `return 2` → `return 0` | the three `project-tagged` undecidable rows |
| account `*)` arm `return 2` → `return 1` | the same three (undecidable must outrank mismatch) |

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/fixtures/poolRule.ts server/test/ccd-pool-ok.test.ts
git commit -m "feat(ccd): _pool_ok reads the account STATE — undecidable outranks mismatch, project-untagged still short-circuits"
```

---

### Task 3: `ccd-pool-sync` — the sibling that pulls

**Files:**
- Create: `ccd/ccd-pool-sync`
- Test: `server/test/ccd-pool-sync.test.ts` (create)

**Interfaces:**
- Consumes: `GET /api/pools/epoch` (Task 7 — write this script against the contract; it ships first and reads `unreadable` until the server answers, which is the whole point of AGENT-FIRST), `~/.ccrc/agent.env`'s `CCRC_SERVER_URL`, `~/.cc-secrets/ccrc-mail.token`.
- Produces: `$REG/pool-epoch` in R3's format. Exit 0 on a successful write, non-zero otherwise. **Writes NOTHING on any unmeasured outcome** — an old document that is still within its lease is better than no document, and a torn one is worse than both.

- [ ] **Step 1: Write the failing tests**

`server/test/ccd-pool-sync.test.ts` — drive the script with a stub `curl` on PATH (the `ghPoison()` containment idiom, `ccdWsHelpers.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness } from './ccdWsHelpers.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const h = makeCcdHarness('pool-sync');
afterEach(() => h.cleanup());

/** Plant a fake curl that answers `body` with `status`, and record its argv. */
function stubCurl(body: string, status = '200'): string {
  const bin = path.join(h.home, 'bin');
  mkdirSync(bin, { recursive: true });
  const p = path.join(bin, 'curl');
  writeFileSync(p, `#!/usr/bin/env bash\ncat > "$HOME/curl.stdin"\nprintf '%s\\n%s' '${body}' '${status}'\n`, 'utf8');
  chmodSync(p, 0o755);
  return bin;
}
function seedConfig(): void {
  mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(h.home, '.ccrc', 'agent.env'), 'CCRC_SERVER_URL=https://example.invalid\n', 'utf8');
  mkdirSync(path.join(h.home, '.cc-secrets'), { recursive: true });
  writeFileSync(path.join(h.home, '.cc-secrets', 'ccrc-mail.token'), 'tok-abc\n', 'utf8');
  mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
}
const run = (bin: string): { rc: number; out: string } => {
  try {
    const out = execFileSync('bash', [path.resolve('../ccd/ccd-pool-sync')], {
      encoding: 'utf8', env: { ...process.env, HOME: h.home, PATH: `${bin}:${process.env.PATH}` },
    });
    return { rc: 0, out };
  } catch (e: any) { return { rc: e.status ?? -1, out: String(e.stdout ?? '') }; }
};
const doc = (): string => readFileSync(path.join(h.home, '.cc-sessions', 'pool-epoch'), 'utf8');

describe('ccd-pool-sync', () => {
  beforeEach(seedConfig);

  it('writes the projection from a 200', () => {
    const bin = stubCurl('{"epoch":43,"issuedAt":1000,"leaseUntil":1900,"accounts":{"acct-a":{"pools":["pool-a"]}}}');
    expect(run(bin).rc).toBe(0);
    expect(doc()).toBe('epoch 43\nissued 1000\nlease 1900\nacct acct-a pool-a\n');
  });

  it('writes an epoch line and NO acct lines when nothing is tagged — synced-but-empty is not absence', () => {
    const bin = stubCurl('{"epoch":7,"issuedAt":1000,"leaseUntil":1900,"accounts":{}}');
    expect(run(bin).rc).toBe(0);
    expect(doc()).toBe('epoch 7\nissued 1000\nlease 1900\n');
  });

  it('sends the token on STDIN, never in argv', () => {
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":2,"accounts":{}}');
    run(bin);
    expect(readFileSync(path.join(h.home, 'curl.stdin'), 'utf8')).toContain('tok-abc');
  });

  it('writes NOTHING on a non-200 — a stale document beats no document', () => {
    const bin = stubCurl('nope', '503');
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, '.cc-sessions', 'pool-epoch'))).toBe(false);
  });

  it('leaves an EXISTING document untouched on a non-200', () => {
    writeFileSync(path.join(h.home, '.cc-sessions', 'pool-epoch'), 'epoch 1\nissued 1\nlease 2\n', 'utf8');
    const bin = stubCurl('nope', '500');
    run(bin);
    expect(doc()).toBe('epoch 1\nissued 1\nlease 2\n');
  });

  it('refuses when no server URL is configured', () => {
    writeFileSync(path.join(h.home, '.ccrc', 'agent.env'), '\n', 'utf8');
    const bin = stubCurl('{}');
    expect(run(bin).rc).not.toBe(0);
  });

  it('leaves no tmp behind on the success path', () => {
    const bin = stubCurl('{"epoch":1,"issuedAt":1,"leaseUntil":2,"accounts":{}}');
    run(bin);
    const reg = path.join(h.home, '.cc-sessions');
    const strays = execFileSync('bash', ['-c', `ls -a ${reg} | grep -c 'pool-epoch\\.' || true`], { encoding: 'utf8' }).trim();
    expect(strays).toBe('0');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pool-sync.test.ts`
Expected: FAIL — the script does not exist (`bash: .../ccd-pool-sync: No such file`).

- [ ] **Step 3: Write `ccd/ccd-pool-sync`**

```bash
#!/usr/bin/env bash
set +x   # FIRST LINE OF CODE, and it is a SECRETS control — the box token below.
# ccd-pool-sync — pull account-pool membership from the control plane.
#
# WHY THIS IS A SIBLING EXECUTABLE AND NOT A `ccd` VERB. `ccd/ccd` makes ZERO
# outbound network calls, and `ccd-account-health` states the doctrine: an HTTP
# client inside `ccd` would be a new dependency class for every
# session-supervising path on the box. The design's own rule agrees — `ccd`
# reads one LOCAL file at placement time and never the network (spec §5.7).
# So the sync lives here and `ccd` only ever reads what this leaves behind.
#
# THE PROJECTION IS A CACHE WITH A GENERATION, NEVER A SOURCE. coord.db on the
# server box is authoritative; this file is what a node believes right now.
#
# ABSENCE AND EMPTINESS ARE DIFFERENT ANSWERS, and keeping them apart is the
# whole fail-shut. A document with an `epoch` line and no `acct` lines means
# SYNCED, NOTHING TAGGED. No document at all means NEVER SYNCED, which
# `_acct_pool_state` reads as `unreadable` -> undecidable -> refuse into a
# tagged project. That is the cold-node case and the EKS default path.
#
# WRITE NOTHING UNLESS THE WHOLE ANSWER ARRIVED. A stale document inside its
# lease is better than no document; a half-written one is worse than both. So
# every failure arm exits WITHOUT touching the file, and the write itself is
# tmp-then-rename through the platform shim.
#
# PORTABILITY: no bare `timeout` (curl's own `--max-time` is the deadline), no
# `mv -fT` (GNU-only — `_plat_mv_notdir`'s job, inlined here since this script
# does not source ccd), no `stat -c`. `macos-platform.test.ts` is the gate.
set -uo pipefail

REG="$HOME/.cc-sessions"
AGENT_ENV="$HOME/.ccrc/agent.env"
TOKEN_FILE="$HOME/.cc-secrets/ccrc-mail.token"
TIMEOUT="${CCRC_POOL_SYNC_TIMEOUT:-20}"
say() { printf 'ccd-pool-sync: %s\n' "$1" >&2; }

command -v curl >/dev/null 2>&1 || { say "curl is not on PATH — nothing was synced"; exit 1; }
command -v python3 >/dev/null 2>&1 || { say "python3 is not on PATH — nothing was synced"; exit 1; }

# GREP, never source: agent.env is 0600 and carries this box's agent bearer.
[[ -r "$AGENT_ENV" ]] || { say "cannot read $AGENT_ENV"; exit 1; }
url=$(grep -E '^[[:space:]]*CCRC_SERVER_URL=' "$AGENT_ENV" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')
[[ -n "$url" ]] || { say "CCRC_SERVER_URL is not set in $AGENT_ENV"; exit 1; }
[[ -r "$TOKEN_FILE" ]] || { say "no readable box token at \$HOME/.cc-secrets/ccrc-mail.token"; exit 1; }
# The value line, never the `#` comment preamble the file wraps it in.
tok=$(grep -vE '^[[:space:]]*(#|$)' "$TOKEN_FILE" | head -n1 | tr -d '[:space:]')
[[ -n "$tok" ]] || { say "the box token file has no value line"; exit 1; }

# Body and status in ONE capture, so there is no response file on disk.
# `-K -` reads the header from stdin: never argv, never environ.
out="$(printf 'header = "x-ccrc-mail-token: %s"\n' "$tok" \
  | curl -sS -K - -o - -w '\n%{http_code}' \
    --max-time "$TIMEOUT" "$url/api/pools/epoch" 2>/dev/null)"; rc=$?
tok=""
if [ "$rc" -ne 0 ]; then say "unmeasured — curl exited $rc"; exit 1; fi
status="${out##*$'\n'}"
body="${out%$'\n'*}"
[ "$status" = 200 ] || { say "unmeasured — HTTP $status"; exit 1; }

# THE RENDER IS PYTHON'S, THE VALIDATION IS TOO. A shell-side JSON read here
# would be the `grep -oE` idiom applied to a nested object, which is what this
# format exists to spare `ccd` from. Anything off-shape exits non-zero and
# WRITES NOTHING, so a control plane answering rubbish cannot unconstrain a box.
rendered=$(printf '%s' "$body" | LC_ALL=C.UTF-8 python3 -c '
import json, re, sys
NAME = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
try:
    d = json.load(sys.stdin)
    e, i, l = int(d["epoch"]), int(d["issuedAt"]), int(d["leaseUntil"])
    accts = d["accounts"]
    if not isinstance(accts, dict): raise ValueError("accounts")
    lines = ["epoch %d" % e, "issued %d" % i, "lease %d" % l]
    for k in sorted(accts):
        if not NAME.match(k) and not re.match(r"^[A-Za-z0-9._-]{1,64}$", k):
            raise ValueError("account id %r" % k)
        for p in accts[k].get("pools", []):
            if not NAME.match(p): raise ValueError("pool %r" % p)
            lines.append("acct %s %s" % (k, p))
    sys.stdout.write("\n".join(lines) + "\n")
except Exception as ex:
    sys.stderr.write(str(ex)); sys.exit(1)
') || { say "unmeasured — the control plane answered a document this reader does not recognise"; exit 1; }

mkdir -p -- "$REG" || { say "could not create $REG"; exit 1; }
# `_reg_set`'s atomicity, verbatim: tmp then rename. A SIGKILL between the two
# leaks one dot-leading tmp, the same disclosed price, and every reader skips
# dot-leading entries. `2>/dev/null` BEFORE `>` so the OPEN's own failure is
# caught too, not just printf's runtime write errors.
tmp="$REG/.pool-epoch.$$.tmp"
printf '%s' "$rendered" 2>/dev/null > "$tmp" \
  || { rm -f -- "$tmp"; say "could not stage the projection — it is UNCHANGED"; exit 1; }
if [ "$(uname -s)" = Darwin ]; then
  if [ ! -L "$REG/pool-epoch" ] && [ -d "$REG/pool-epoch" ]; then
    rm -f -- "$tmp"; say "a directory sits at $REG/pool-epoch"; exit 1
  fi
  mv -f -- "$tmp" "$REG/pool-epoch" || { rm -f -- "$tmp"; say "could not install the projection"; exit 1; }
else
  mv -fT -- "$tmp" "$REG/pool-epoch" || { rm -f -- "$tmp"; say "could not install the projection"; exit 1; }
fi
exit 0
```

Make it executable: `chmod +x ccd/ccd-pool-sync`

- [ ] **Step 4: Run green, plus the portability gate**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pool-sync.test.ts test/macos-platform.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

| Mutation | Must go RED in |
|---|---|
| `[ "$status" = 200 ] \|\| { … exit 1; }` → `:` | `writes NOTHING on a non-200` |
| write `$body` straight to the file, skipping python | `writes the projection from a 200` |
| drop the `NAME.match(p)` check | add a row with pool `Bad_Name`; must exit non-zero |
| `-K -` → `-H "x-ccrc-mail-token: $tok"` | `sends the token on STDIN, never in argv` |

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd-pool-sync server/test/ccd-pool-sync.test.ts
git commit -m "feat(ccd): ccd-pool-sync pulls the leased projection — writes nothing unless the whole answer arrived"
```

---

### Task 4: the timer, its three install paths, and the doctor

**Files:**
- Create: `deploy/systemd/ccd-pool-sync.service`, `deploy/systemd/ccd-pool-sync.timer`
- Modify: `deploy/deploy.sh` (`AGENT_BUILD_CMD` ~`:780-801`, `AGENT_CMD` ~`:897-906`)
- Modify: `ccd/ccrc` (`_inst_units` `:10086-10134`, `_inst_enable` `:10168+`)
- Modify: `ccd/ccrc-doctor-checks` (`known` array `:834`, the WARN `why` case `:893-901`)
- Test: `agent/test/deploy-verify.test.ts`, `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Consumes: `ccd/ccd-pool-sync` (Task 3), installed to `%h/.local/bin/ccd-pool-sync`.
- Produces: `ccd-pool-sync.timer` active on the fleet box.

- [ ] **Step 1: Write the unit files**

`deploy/systemd/ccd-pool-sync.timer` — cadence copied **verbatim** from `deploy/systemd/ccd-cap-scopes.timer`, so the fleet gains no new cadence to reason about:
```ini
[Unit]
Description=Periodically pull account-pool membership from the control plane
[Timer]
OnBootSec=45s
OnUnitActiveSec=60s
AccuracySec=10s
[Install]
WantedBy=timers.target
```

`deploy/systemd/ccd-pool-sync.service`:
```ini
[Unit]
Description=Pull the account-pool projection (leased cache; absence means never-synced)
[Service]
Type=oneshot
ExecStart=%h/.local/bin/ccd-pool-sync
```

- [ ] **Step 2: Write the failing deploy-verify assertions**

`agent/test/deploy-verify.test.ts:529-676` regex-parses `deploy.sh`'s own source. Add `ccd-pool-sync` to the needle set it pins (both the `_unit_atomic` install lines and the enable ordering), mirroring the existing `ccd-cap-scopes` entries exactly.

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`
Expected: FAIL — `deploy.sh` carries no `ccd-pool-sync` needle yet.

- [ ] **Step 3: Wire all three install paths**

1. `deploy/deploy.sh` `AGENT_BUILD_CMD`: add `ccd-pool-sync` to the executables installed via `install_atomic`, and both unit files via `_unit_atomic`, beside the `ccd-cap-scopes` lines.
2. `deploy/deploy.sh` `AGENT_CMD`: add `systemctl --user enable --now ccd-pool-sync.timer` in the same position relative to `daemon-reload` as the existing timers.
3. `ccd/ccrc`'s `_inst_units()` and `_inst_enable()`: the same two additions. **This path is easy to miss** — `ccrc install` is the local/dev installer and duplicates deploy.sh's list.

- [ ] **Step 4: Decide the doctor's coverage EXPLICITLY**

`ccd/ccrc-doctor-checks:834`'s `known` array does not cover every timer: `ccd-graph-sweep` and `ccrc-ddns` are deliberately excluded (an effect-based design covers them) and `ccd-usage-sweep` is covered by neither — a disclosed gap. **A new timer gets a choice, not a default.** Ruling: `ccd-pool-sync` goes in `known`, because its failure mode is silent (a node stops refreshing and only starts refusing once the lease expires, minutes later, with no error anywhere). Add the unit to `known` and add its case arm to the per-timer WARN `why` at `:893-901` — whose own comment already anticipates "a seventh unit".

- [ ] **Step 4b: Pin that the agent still cannot write the projection**

Spec §9 requires this. The general rule is ALREADY pinned — `agent/test/whitelist.test.ts:68` ("restricts writes to `.cc-clips` only") asserts `.cc-sessions` is unwritable — so what is missing is only the specific path, which is worth its own case because a reader of this feature will look for it by name. `checkPath` is `async` and takes THREE arguments (`agent/src/whitelist.ts:64`): `checkPath(targetPath, cfg, mode): Promise<string | null>`, non-null = allowed. Add beside the existing cases, copying their `seed()` / `cfg` idiom verbatim:

```ts
it('the pool projection is READ-ONLY to the agent — a write frame cannot forge membership', async () => {
  seed();
  const cfg = { home, projectsRoot };
  const proj = path.join(home, '.cc-sessions', 'pool-epoch');
  // Readable so the SERVER can measure what the fleet actually holds ($REG is
  // the only fleet-box location it can read back, design §3.1) ...
  expect(await checkPath(proj, cfg, 'read')).not.toBeNull();
  // ... and unwritable, because a projection the wire could write would let a
  // compromised channel forge membership instead of merely observing it.
  expect(await checkPath(proj, cfg, 'write')).toBeNull();
});
```

Mutation: widen the write allowlist to include `.cc-sessions` → this case AND `whitelist.test.ts:68` must both go RED. (A mutation that reds only the pre-existing case would mean the new one is decorative.)

- [ ] **Step 5: Run green**

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts` then `cd ../server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts test/macos-platform.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation check**

| Mutation | Must go RED in |
|---|---|
| delete the `ccd-pool-sync.timer` enable line from `deploy.sh` | `deploy-verify.test.ts` |
| remove `ccd-pool-sync` from the doctor's `known` array | `ccrc-doctor.test.ts` |

- [ ] **Step 7: Commit, then DEPLOY THE AGENT LANE FIRST**

```bash
git add deploy/systemd/ccd-pool-sync.service deploy/systemd/ccd-pool-sync.timer \
        deploy/deploy.sh ccd/ccrc ccd/ccrc-doctor-checks agent/test/deploy-verify.test.ts
git commit -m "feat(deploy): ccd-pool-sync's timer, its three install paths and the doctor's seventh unit"
```

**This is the AGENT-FIRST gate.** After Tasks 1–4 merge, `bash deploy/deploy.sh agent <host>` runs BEFORE the server lane. Every account then reads `unreadable` → undecidable → refusals only into tagged projects, of which there are **zero** on this fleet (spec §3.8). Verify on the box: `systemctl --user list-timers | grep pool-sync` and `ls -l ~/.cc-sessions/pool-epoch` (expected: absent, because the server does not answer yet — that is the correct intermediate state).

---

### Task 5: shared L0 — `AccountPoolWire`, `poolRule`'s account arm, `observedEpoch`

**Files:**
- Modify: `shared/poolrule.ts` (`PoolVerdict` `:48-51`, `poolRule` `:66-79`)
- Modify: `shared/api.ts` (`PoolsEnforcement` `:1965`, the pools frame `:1983`)
- Modify: `shared/agent-protocol.ts` (`AgentReady` `:63`)
- Test: `server/test/pool-rule-core.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PoolOrigin = 'central' | 'declared';
  export type AccountPoolWire =
    | { state: 'tagged'; pools: readonly string[]; origin: PoolOrigin }
    | { state: 'untagged'; origin: PoolOrigin }
    | { state: 'malformed' }
    | { state: 'unreadable' }
    | { state: 'stale' };
  export function poolRule(account: AccountPoolWire, projectPool: ProjectPoolWire): PoolVerdict;
  ```
  Task 7 (server forecast) and Task 9 (PWA) both consume `poolRule`; Task 8 consumes `observedEpoch`.

- [ ] **Step 1: Write the failing tests**

`server/test/pool-rule-core.test.ts` already walks `POOL_RULE_CASES`. Adapt its driver to build an `AccountPoolWire` from each row and add three assertions that no fixture row can express:

```ts
const wireFor = (c: PoolRuleCase): AccountPoolWire =>
  c.accountState === undefined
    ? (c.accountPool === null
        ? { state: 'untagged', origin: 'central' }
        : { state: 'tagged', pools: [c.accountPool], origin: 'central' })
    : { state: c.accountState } as AccountPoolWire;

it('an account the roster does not carry stays PERMISSIVE, not undecidable', () => {
  // poolrule.ts:57-65 argues this fold deliberately: the PWA's roster can lag
  // the fleet's, and hiding a live non-roster account is worse than offering
  // it and letting ccd refuse. `unreadable` must NOT swallow this case.
  expect(poolRule({ state: 'untagged', origin: 'central' }, { state: 'tagged', name: 'pool-a' }))
    .toEqual({ ok: true, why: 'untagged-account' });
});

it('stale and unreadable are two words, not one', () => {
  const a = poolRule({ state: 'stale' }, { state: 'tagged', name: 'pool-a' });
  const b = poolRule({ state: 'unreadable' }, { state: 'tagged', name: 'pool-a' });
  expect(a).toEqual({ ok: false, reason: 'pool-undecidable', state: 'stale' });
  expect(b).toEqual({ ok: false, reason: 'pool-undecidable', state: 'unreadable' });
  expect(a).not.toEqual(b);
});

it('multi-pool membership is set membership, so the wire needs no change later', () => {
  expect(poolRule({ state: 'tagged', pools: ['pool-a', 'pool-b'], origin: 'central' },
                  { state: 'tagged', name: 'pool-b' })).toEqual({ ok: true, why: 'same-pool' });
});
```

Run: `cd server && ./node_modules/.bin/vitest run test/pool-rule-core.test.ts`
Expected: FAIL to COMPILE — `poolRule` takes `string | null`, and `PoolVerdict`'s `state` union has no `'stale'`.

- [ ] **Step 2: Implement**

`shared/poolrule.ts` — widen the undecidable state, keep the documented fold, and keep the project side FIRST:

```ts
export type PoolVerdict =
  | { ok: true; why: 'untagged-project' | 'untagged-account' | 'same-pool' }
  | { ok: false; reason: 'pool-mismatch'; accountPool: string; projectPool: string }
  | { ok: false; reason: 'pool-undecidable';
      state: 'unreadable' | 'malformed' | 'unrecognised' | 'stale' };

/**
 * The rule, once — now with an account side that has STATES, not just a name.
 *
 * WHAT DID NOT CHANGE, and must not: the project side decides first. An
 * untagged project is unconstrained and serves WITHOUT the account side being
 * consulted, so a control plane that has been down longer than the lease stops
 * placement only into projects somebody deliberately tagged. Reordering these
 * two blocks turns a quiet outage into a fleet-wide stop (spec §5.8).
 *
 * WHAT DID CHANGE: `unreadable` / `stale` / `malformed` on the ACCOUNT side are
 * now reachable, and each is undecidable. Previously the account side could
 * only be a name or `null`, and `null` meant BOTH "untagged" and "this side
 * cannot see it" — a fold that was honest when the only carrier was the roster.
 *
 * THE FOLD IS KEPT, DELIBERATELY. `{ state: 'untagged' }` still covers an
 * account this side cannot see, and that stays the PERMISSIVE direction for the
 * reason the old docstring gave: `ccd`'s `_is_valid_wrapper` is the authority on
 * which wrappers exist, the server's roster copy can lag the fleet's, and a
 * display that HID a live non-roster account would be worse than one that
 * offers it and lets `ccd` refuse. What is new is that a projection which could
 * not be READ is a different condition with a different answer. Collapsing
 * those two would re-create the fail-open this design exists to prevent.
 */
export function poolRule(account: AccountPoolWire, projectPool: ProjectPoolWire): PoolVerdict {
  if (projectPool.state === 'unreadable' || projectPool.state === 'malformed') {
    return { ok: false, reason: 'pool-undecidable', state: projectPool.state };
  }
  if (projectPool.state === 'untagged') return { ok: true, why: 'untagged-project' };
  if (projectPool.state === 'tagged') {
    if (account.state === 'unreadable' || account.state === 'malformed' || account.state === 'stale') {
      return { ok: false, reason: 'pool-undecidable', state: account.state };
    }
    if (account.state === 'untagged') return { ok: true, why: 'untagged-account' };
    // Set membership, not equality — `pools` is length 0 or 1 today and the
    // multi-pool wave drops an index without touching this line or the wire.
    if (account.pools.includes(projectPool.name)) return { ok: true, why: 'same-pool' };
    return {
      ok: false, reason: 'pool-mismatch',
      accountPool: account.pools[0] ?? '', projectPool: projectPool.name,
    };
  }
  const unhandled: never = projectPool;
  void unhandled;
  return { ok: false, reason: 'pool-undecidable', state: 'unrecognised' };
}
```

`shared/api.ts` — `accountPools` on the pools frame, absence-permitting:
```ts
/** Whether the fleet's `ccd` honours ACCOUNT pools — the same three-state
 *  version-skew channel as `enforcement`, sourced from `_acct_pool_state`'s
 *  presence in `ccd caps`. ABSENT on an older server, which reads `unknown`. */
accountPools?: PoolsEnforcement;
```

`shared/agent-protocol.ts` — `observedEpoch` on `AgentReady` (`:63`), beside `rosterFp`:
```ts
/** The epoch of the pool projection this node has actually got, or `null` when
 *  it has none. ABSENT from an older agent, which is NOT the same as `null`:
 *  absent means "this build cannot tell you", null means "I have never synced".
 *  The reader keeps them apart (`observedEpoch === undefined` -> unknown). */
observedEpoch?: number | null;
```

- [ ] **Step 3: Run green, plus every L0 pin**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-rule-core.test.ts test/ccd-pool-ok.test.ts test/providers.test.ts test/peers-claims-l0.test.ts test/single-definition.test.ts`
Expected: PASS. `pool-rule-core.test.ts:137-185` pins that `poolrule.ts` imports nothing but types — **do not add a runtime import**. If `shared/poolrule.ts` gains a new import line, that exact-array pin must be updated deliberately, not silently.

- [ ] **Step 4: Mutation check**

| Mutation | Must go RED in |
|---|---|
| move the account block ABOVE the `projectPool.state === 'untagged'` return | `acct-unreadable-project-untagged` |
| `state: account.state` → `state: 'unreadable'` for the stale arm | `stale and unreadable are two words` |
| `account.pools.includes(...)` → `account.pools[0] === ...` | `multi-pool membership is set membership` |
| drop `'stale'` from the `PoolVerdict` union | compile error (that IS the guard) |

- [ ] **Step 5: Commit**

```bash
git add shared/poolrule.ts shared/api.ts shared/agent-protocol.ts server/test/pool-rule-core.test.ts
git commit -m "feat(shared): the account side gains states — stale never folds into unreadable, the roster fold is kept"
```

---

### Task 6: the store — migration 13, `PoolEdgeLog`, the three CoordStore methods

**Files:**
- Modify: `server/src/coord/schema.ts` (append to `MIGRATIONS`, `:63-927`)
- Create: `server/src/coord/pooledgelog.ts`
- Modify: `server/src/coord/store.ts`
- Test: `server/test/pool-edges-store.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export class PoolEdgeLog {
    constructor(readonly logPath: string);
    append(entries: readonly PoolEdgeLogEntry[]): void;
    maxEpoch(): number | null;
  }
  export function defaultPoolEdgeLogPath(home?: string): string;   // ~/.ccrc/pool-edges.log
  // on CoordStore:
  setAccountPools(input: { accountId: string; pools: readonly string[]; addedBy: string; now?: number },
                  log: PoolEdgeLog): { ok: true; epoch: number };
  accountPoolEdges(): Map<string, string[]>;
  poolEpoch(): { epoch: number; issuedAt: number; digest: string };
  ```

- [ ] **Step 1: Write the failing tests**

`server/test/pool-edges-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { PoolEdgeLog } from '../src/coord/pooledgelog.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fresh = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'pool-edges-'));
  return { store: new CoordStore(openCoordDb(path.join(d, 'coord.db'))),
           log: new PoolEdgeLog(path.join(d, 'pool-edges.log')), dir: d };
};

describe('pool_edges', () => {
  it('writes one row per edge and bumps the epoch', () => {
    const { store, log } = fresh();
    const r = store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1000 }, log);
    expect(r.epoch).toBe(1);
    expect(store.accountPoolEdges().get('acct-a')).toEqual(['pool-a']);
  });

  it('APPENDS THE JOURNAL BEFORE THE COMMIT — the file leads the db', () => {
    const { store, log, dir } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1000 }, log);
    const lines = readFileSync(path.join(dir, 'pool-edges.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ epoch: 1, accountId: 'acct-a', pools: ['pool-a'] });
  });

  it('recovery takes MAX(journal, db) so an epoch is SKIPPED, never reissued', () => {
    const { store, log, dir } = fresh();
    // Simulate a crash between append and commit: the journal is ahead.
    writeFileSync(path.join(dir, 'pool-edges.log'),
      JSON.stringify({ epoch: 9, accountId: 'x', pools: [], addedBy: 'op', at: 1 }) + '\n', 'utf8');
    const r = store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1000 }, log);
    expect(r.epoch).toBe(10);          // 9 skipped, never handed out twice
  });

  it('one pool per account today — a second write REPLACES, it does not accumulate', () => {
    const { store, log } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1 }, log);
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-b'], addedBy: 'op', now: 2 }, log);
    expect(store.accountPoolEdges().get('acct-a')).toEqual(['pool-b']);
  });

  it('an empty pool list clears the account', () => {
    const { store, log } = fresh();
    store.setAccountPools({ accountId: 'acct-a', pools: ['pool-a'], addedBy: 'op', now: 1 }, log);
    store.setAccountPools({ accountId: 'acct-a', pools: [], addedBy: 'op', now: 2 }, log);
    expect(store.accountPoolEdges().has('acct-a')).toBe(false);
  });

  it('an UNREADABLE journal throws rather than reissuing', () => {
    const { store, log, dir } = fresh();
    writeFileSync(path.join(dir, 'pool-edges.log'), 'x', 'utf8');
    require('node:fs').chmodSync(path.join(dir, 'pool-edges.log'), 0o000);
    expect(() => store.setAccountPools({ accountId: 'a', pools: [], addedBy: 'op' }, log)).toThrow();
  });

  it('pool_epoch refuses a second row', () => {
    const { store } = fresh();
    expect(() => (store as any).db.exec('INSERT INTO pool_epoch (id, epoch, issuedAt, digest) VALUES (2, 1, 1, "x")'))
      .toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-edges-store.test.ts`
Expected: FAIL — `Cannot find module '../src/coord/pooledgelog.js'`.

- [ ] **Step 3: Append migration 13**

At the end of `MIGRATIONS` in `server/src/coord/schema.ts`, before the closing `];`:

```ts
  // ── 13: user_version 12 -> 13 ───────────────────────────────────────────
  // Account-pool membership: the authoritative store (design 2026-09-18 §5.2).
  //
  // ROW PER EDGE, not a column on an account (operator ruling 2). `subjectKind`
  // exists from day one though wave 1 writes only 'account' rows: the project
  // half may migrate in later, and the org edition's `user -> pinned account` is
  // a DIFFERENT EDGE, not a wider column. Wave 1's "one pool per account" is a
  // PARTIAL UNIQUE INDEX, so relaxing it to multi-pool later drops an index and
  // rewrites no rows and changes no wire shape — where widening a column would
  // change the rule in three languages at once.
  //
  // `addedBy` is NULLABLE and null is a real answer: a row written by a path
  // that had no session identity. It is attribution, never authentication.
  //
  // `pool_epoch` takes the single-row idiom from `coordinator_state` above
  // (`id INTEGER PRIMARY KEY CHECK (id = 1)`) and is SEEDED here, so every
  // reader after this migration finds a row and none has to handle its absence.
  // Epoch 0 means "nothing has ever been tagged", which is a measurement.
  //
  // MIGRATIONS[0..11] are frozen: `db.ts:182` iterates from the live
  // `user_version`, so an edit to an applied entry never runs.
  //
  // THIS ENTRY IS SLOT 13 AS WRITTEN. PR #40 (automation-runner) carries a
  // migration spelled slot 11 — already taken on main — so it must move up when
  // rebased and may take 13 first. Migration 12's own comment records the last
  // branch that lost this race. RE-MEASURE against origin/main before merge.
  `
  CREATE TABLE pool_edges (
    id          INTEGER PRIMARY KEY,
    subjectKind TEXT    NOT NULL,
    subjectId   TEXT    NOT NULL,
    pool        TEXT    NOT NULL,
    addedAt     INTEGER NOT NULL,
    addedBy     TEXT
  );
  CREATE UNIQUE INDEX pool_edges_one_per_account
    ON pool_edges(subjectId) WHERE subjectKind = 'account';

  CREATE TABLE pool_epoch (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    epoch    INTEGER NOT NULL,
    issuedAt INTEGER NOT NULL,
    digest   TEXT    NOT NULL
  );
  INSERT INTO pool_epoch (id, epoch, issuedAt, digest) VALUES (1, 0, 0, '');
  `,
```

- [ ] **Step 4: Write `server/src/coord/pooledgelog.ts`**

Modelled line-for-line on `ledgerlog.ts` — same doctrine, same salvage stance:

```ts
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The flat-file ground truth under `pool_edges` (D8, the `ledger_alloc` shape):
 * every epoch is appended HERE first and committed to coord.db second, and
 * recovery takes MAX(file, db) — so an epoch is SKIPPED, NEVER REISSUED.
 *
 * WHY THIS FILE EXISTS AT ALL, in one sentence: a lost coord.db that could not
 * reconstruct would answer "untagged" for every account, and untagged is
 * unconstrained — the fail-OPEN direction, and the one outcome the whole design
 * exists to prevent. Gaps cost nothing; a reissued epoch would let a node accept
 * an older document as newer.
 *
 * `~/.ccrc/pool-edges.log` on the SERVER box — beside `coord.db`, same stance as
 * `defaultLedgerLogPath`: local-box housekeeping, never proxied through FleetIO.
 * NDJSON, one line per EPOCH. Synchronous on purpose: `setAccountPools` calls
 * this INSIDE a `tx()`, and `DatabaseSync`'s no-async invariant is the whole
 * correctness argument.
 */
export function defaultPoolEdgeLogPath(home: string = homedir()): string {
  return path.join(home, '.ccrc', 'pool-edges.log');
}

export interface PoolEdgeLogEntry {
  epoch: number; accountId: string; pools: readonly string[]; addedBy: string | null; at: number;
}

export class PoolEdgeLog {
  constructor(readonly logPath: string) {}

  append(entries: readonly PoolEdgeLogEntry[]): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    const lines = entries.map((e) => JSON.stringify({
      epoch: e.epoch, accountId: e.accountId, pools: e.pools, addedBy: e.addedBy, at: e.at,
    }) + '\n').join('');
    appendFileSync(this.logPath, lines, 'utf8');
  }

  /**
   * The file's half of MAX(file, db). A missing file is `null`; an UNREADABLE
   * file THROWS — reading it as empty is exactly the reissue this file exists to
   * prevent, so the write must fail loudly instead.
   *
   * THE SALVAGE ARM: a torn final append still counts when an `"epoch":<digits>`
   * can be read out of the fragment. Over-counting is the safe direction.
   */
  maxEpoch(): number | null {
    let text: string;
    try {
      text = readFileSync(this.logPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    let max: number | null = null;
    for (const line of text.split('\n')) {
      if (line === '') continue;
      const m = /"epoch":(\d+)/.exec(line);
      if (m === null) continue;
      const n = Number(m[1]);
      if (max === null || n > max) max = n;
    }
    return max;
  }
}
```

- [ ] **Step 5: Add the three CoordStore methods**

In `server/src/coord/store.ts`, in a new `// ── pool edges ──` section, copying `allocateDeviations`'s sequence (`store.ts:4719-4740`) exactly — journal first, DB second, both inside one `tx()`:

```ts
  setAccountPools(input: {
    accountId: string; pools: readonly string[]; addedBy: string | null; now?: number;
  }, log: PoolEdgeLog): { ok: true; epoch: number } {
    const now = input.now ?? Date.now();
    return tx(this.db, () => {
      const dbMax = (this.db.prepare('SELECT epoch AS e FROM pool_epoch WHERE id = 1')
        .get() as { e: number }).e;
      const fileMax = log.maxEpoch();
      // MAX(file, db) — the file's half is what makes recovery skip rather
      // than reissue, exactly as `allocateDeviations` does it.
      const epoch = (fileMax === null ? dbMax : Math.max(dbMax, fileMax)) + 1;
      log.append([{ epoch, accountId: input.accountId, pools: input.pools,
                    addedBy: input.addedBy, at: now }]);
      this.db.prepare("DELETE FROM pool_edges WHERE subjectKind = 'account' AND subjectId = ?")
        .run(input.accountId);
      for (const p of input.pools) {
        this.db.prepare(
          'INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) ' +
          "VALUES ('account', ?, ?, ?, ?)",
        ).run(input.accountId, p, now, input.addedBy);
      }
      const digest = this.poolEdgeDigest();
      this.db.prepare('UPDATE pool_epoch SET epoch = ?, issuedAt = ?, digest = ? WHERE id = 1')
        .run(epoch, now, digest);
      return { ok: true as const, epoch };
    });
  }

  accountPoolEdges(): Map<string, string[]> {
    const rows = this.db.prepare(
      "SELECT subjectId, pool FROM pool_edges WHERE subjectKind = 'account' ORDER BY subjectId, pool",
    ).all() as { subjectId: string; pool: string }[];
    const out = new Map<string, string[]>();
    for (const r of rows) {
      const cur = out.get(r.subjectId);
      if (cur === undefined) out.set(r.subjectId, [r.pool]); else cur.push(r.pool);
    }
    return out;
  }

  poolEpoch(): { epoch: number; issuedAt: number; digest: string } {
    return this.db.prepare('SELECT epoch, issuedAt, digest FROM pool_epoch WHERE id = 1')
      .get() as { epoch: number; issuedAt: number; digest: string };
  }

  /** `bodyDigest` comes from `shared/mark.mjs` — `server.ts:30` imports it as
   *  `'../../shared/mark.mjs'`; from `server/src/coord/` the path is
   *  `'../../../shared/mark.mjs'`. Add that import at the top of `store.ts`.
   *
   *  A stable fingerprint of the whole edge set, so a node can tell "same
   *  epoch, same content" from "same epoch, different content" after a
   *  restore. Sorted by construction above. */
  private poolEdgeDigest(): string {
    const rows = this.db.prepare(
      "SELECT subjectId, pool FROM pool_edges WHERE subjectKind = 'account' ORDER BY subjectId, pool",
    ).all() as { subjectId: string; pool: string }[];
    return bodyDigest(rows.map((r) => `${r.subjectId} ${r.pool}`).join('\n'));
  }
```

- [ ] **Step 6: Run green**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-edges-store.test.ts test/coord-schema.test.ts test/single-definition.test.ts`
Expected: PASS.

- [ ] **Step 7: Mutation check**

| Mutation | Must go RED in |
|---|---|
| move `log.append(...)` AFTER the `INSERT` loop | `APPENDS THE JOURNAL BEFORE THE COMMIT` |
| `Math.max(dbMax, fileMax)` → `dbMax` | `recovery takes MAX(journal, db)` |
| drop `CHECK (id = 1)` from `pool_epoch` | `pool_epoch refuses a second row` |
| `return null` instead of `throw` on a non-ENOENT read error | `an UNREADABLE journal throws` |

- [ ] **Step 8: Commit**

```bash
git add server/src/coord/schema.ts server/src/coord/pooledgelog.ts server/src/coord/store.ts \
        server/test/pool-edges-store.test.ts
git commit -m "feat(coord): pool_edges + pool_epoch, journal-first — an epoch is skipped, never reissued"
```

---

### Task 7: the two routes, and the account arm of the server's forecast

**Files:**
- Modify: `server/src/server.ts` (beside the project-pool route, `:2302-2357`; `refusePool` `:2058-2075`)
- Modify: `server/src/index.ts` (construct the `PoolEdgeLog`, beside `:66`)
- Test: `server/test/pool-accounts-route.test.ts` (create), `server/test/box-token-census.test.ts`

**Interfaces:**
- Consumes: `CoordStore.setAccountPools`/`accountPoolEdges`/`poolEpoch` (Task 6), `poolRule` (Task 5), `POOL_NAME_RE` (`shared/roster.ts:358`).
- Produces: `POST /api/pools/accounts/:id` `{ pools: string[] }` → `{ ok, epoch, warning? }`; `GET /api/pools/epoch` → the document `ccd-pool-sync` renders.

- [ ] **Step 1: Write the failing tests**

`server/test/pool-accounts-route.test.ts`:

```ts
it('tags an account and answers the MEASURED epoch, not the request', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/pools/accounts/acct-a',
    payload: { pools: ['pool-a'] } });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({ ok: true, epoch: 1 });
  // MEASURED: the reply's epoch is re-read from the store, not echoed.
  expect(deps.coord!.poolEpoch().epoch).toBe(1);
});

it('refuses a pool name off the grammar with 400 bad-pool-name', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/pools/accounts/acct-a',
    payload: { pools: ['Pool_A'] } });
  expect(r.statusCode).toBe(400);
  expect(r.json()).toMatchObject({ error: 'bad-pool-name' });
});

it('WARNS, never refuses, for an id no rostered account carries', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/pools/accounts/not-a-real-account',
    payload: { pools: ['pool-a'] } });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({ ok: true, warning: 'unknown-account' });
});

it('carries NO box token — it is fleet control, like the project-pool route', async () => {
  const src = readFileSync('src/server.ts', 'utf8');
  const route = src.slice(src.indexOf("app.post('/api/pools/accounts/:id'"));
  expect(route.slice(0, 1200)).not.toMatch(/requireMailToken|checkMailToken/);
});

it('GET /api/pools/epoch renders what ccd-pool-sync parses', async () => {
  await app.inject({ method: 'POST', url: '/api/pools/accounts/acct-a', payload: { pools: ['pool-a'] } });
  const r = await app.inject({ method: 'GET', url: '/api/pools/epoch',
    headers: { 'x-ccrc-mail-token': TOKEN } });
  expect(r.json()).toMatchObject({
    epoch: 1, accounts: { 'acct-a': { pools: ['pool-a'] } },
  });
  expect(typeof r.json().leaseUntil).toBe('number');
});

it('the epoch document is ALWAYS emitted, even with nothing tagged — empty is not absent', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/pools/epoch',
    headers: { 'x-ccrc-mail-token': TOKEN } });
  expect(r.statusCode).toBe(200);
  expect(r.json().accounts).toEqual({});
});
```

Run: `cd server && ./node_modules/.bin/vitest run test/pool-accounts-route.test.ts`
Expected: FAIL — 404 on both routes.

- [ ] **Step 2: Implement the routes**

In `server/src/server.ts`, directly after the project-pool route (`:2357`):

```ts
  /**
   * An account's pool membership (account pools, design 2026-09-18 §5.5).
   * `{ pools: [] }` clears.
   *
   * THE STANCE IS THE PROJECT-POOL ROUTE'S, copied deliberately: NOT in
   * `auth/gate.ts`'s EXEMPT table — session-gated when armed, open dark. NO BOX
   * TOKEN: this is fleet control, not a coordination write.
   *
   * THE 200 IS MEASURED, NOT ECHOED — and here the measurement is cheap and
   * exact, because the authority is this box's own coord.db, not a file on the
   * fleet. The epoch returned is re-read from `pool_epoch` after the write.
   *
   * `:id` GOES THROUGH UNVALIDATED as an ACCOUNT id, exactly as `:project` does
   * next door: the roster is the authority on which accounts exist, nothing here
   * joins the id into a path, and an id no account carries is a WARNING and not
   * a refusal — this box's `accounts.json` is one of two hand-owned copies and
   * can lag the fleet's, so "no such account here" may be about to become false.
   *
   * NO NUDGE. Convergence is owned by `ccd-pool-sync.timer`'s pull (ruling R2);
   * the fleet honours this within `OnUnitActiveSec=60s`, and the PWA shows
   * `epoch N / observed M` so the lag is visible rather than mysterious.
   */
  app.post('/api/pools/accounts/:id', async (req, reply) => {
    // `notConfigured` is a LOCAL const inside `coord/routes.ts:448`, not an
    // export — these routes live in `server.ts`, so the 501 is spelled here.
    if (!deps.coord || !deps.poolEdgeLog) {
      return reply.code(501).send({ ok: false, error: 'not-configured' });
    }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { pools?: unknown };
    if (!Array.isArray(body.pools) || body.pools.some((p) => typeof p !== 'string')) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const pools = body.pools as string[];
    // POOL_NAME_RE imported from shared/roster.ts, never re-spelled here.
    if (pools.some((p) => !POOL_NAME_RE.test(p))) {
      return reply.code(400).send({ ok: false, error: 'bad-pool-name' });
    }
    // Wave 1 is one pool per account (a PARTIAL UNIQUE INDEX, not a column).
    if (pools.length > 1) {
      return reply.code(400).send({ ok: false, error: 'one-pool-per-account' });
    }
    const written = deps.coord.setAccountPools(
      // `addedBy` is NULL on this path and that is a real answer, not a gap:
      // there is no session-id accessor on an armed request here, and identity
      // on this fleet is ATTRIBUTION, never authentication. A later wave that
      // wants a name must add a reader, not guess one.
      { accountId: id, pools, addedBy: null }, deps.poolEdgeLog);
    const measured = deps.coord.poolEpoch();
    const warn = !deps.cfg.roster.some((a) => a.id === id);
    return {
      ok: true, epoch: measured.epoch,
      ...(written.epoch !== measured.epoch ? { raced: true as const } : {}),
      ...(warn ? { warning: 'unknown-account' as const } : {}),
    };
  });

  /**
   * The projection `ccd-pool-sync` pulls. DUAL-CREDENTIAL, the `GET /api/feed`
   * shape: a session for the PWA, the box token for the fleet's sync script.
   *
   * ALWAYS EMITTED, even when nothing is tagged. `accounts: {}` means SYNCED,
   * NOTHING TAGGED; no document at all means NEVER SYNCED, which the node reads
   * as `unreadable` and refuses into a tagged project. Folding those two would
   * silently lift every constraint on a cold node — the EKS default path.
   */
  app.get('/api/pools/epoch', async (req, reply) => {
    if (!deps.coord) return reply.code(501).send({ ok: false, error: 'not-configured' });
    // The `GET /api/feed` guard, copied shape-for-shape (coord/routes.ts:2533-2551):
    // session FIRST, box token as the fallback, 401 only when both fail.
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return reply.code(401).send({ ok: false, error: 'unauthenticated', verdict: session.verdict });
        }
      }
    }
    const { epoch, issuedAt } = deps.coord.poolEpoch();
    const edges = deps.coord.accountPoolEdges();
    const accounts: Record<string, { pools: string[] }> = {};
    for (const [acct, pools] of edges) accounts[acct] = { pools };
    return { epoch, issuedAt, leaseUntil: Date.now() + POOL_LEASE_MS, accounts };
  });
```

Add beside the other server constants:
```ts
/** How long a node may keep deciding from a projection it can no longer
 *  refresh. THE WHOLE DIAL between "an outage stops tagged placement" and "a
 *  stale node enforces yesterday's membership", and no value is right for both
 *  (design §5.8, left open). 15 minutes is fifteen missed pulls at
 *  `OnUnitActiveSec=60s`. Configurable because the right answer is a property
 *  of a fleet, not of this file. */
export const POOL_LEASE_MS = Number(process.env.CCRC_POOL_LEASE_MS ?? 15 * 60 * 1000);
```

- [ ] **Step 3: Wire the account arm into the live refusal path**

`refusePool` (`server/src/server.ts:2058-2075`) is the server's real forecast and today has no account side (correction #3 — `poolRule` has no production caller at all). Give it one, reading from coord.db directly (never the projection, so every 409/503 the server issues is immediate and exact — spec §5.7):

```ts
const acctWire: AccountPoolWire = (() => {
  const pools = deps.coord?.accountPoolEdges().get(wrapper);
  if (pools !== undefined && pools.length > 0) return { state: 'tagged', pools, origin: 'central' };
  // PRECEDENCE: projected beats declared beats untagged (design §5.6). The
  // roster field is RETAINED as the declared default — an old `ccd` against a
  // new server must keep enforcing SOMETHING, or deploy skew is fail-OPEN.
  const declared = deps.cfg.roster.find((a) => a.id === wrapper)?.pool ?? null;
  return declared === null
    ? { state: 'untagged', origin: 'central' }
    : { state: 'tagged', pools: [declared], origin: 'declared' };
})();
const verdict = poolRule(acctWire, projectWire);
```
Map the verdict: `pool-mismatch` → **409** with the crossing offer; `pool-undecidable` → **503** (never a 409 — a crossing offered over a constraint nobody read is worse).

- [ ] **Step 4: Run green, plus the guard censuses**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-accounts-route.test.ts test/coord-pause-route.test.ts test/box-token-census.test.ts test/single-definition.test.ts`
Expected: PASS. **Note:** `box-token-census.test.ts:102-127` regex-HARVESTS `UNGATED`/`SESSION_ONLY` from `coord-pause-route.test.ts`'s source — they cannot drift. The existing four pool routes in `server.ts` are session-only doors that are in NEITHER set, so the new routes follow that same precedent and need no entry. If the census reds, read its message before adding one.

- [ ] **Step 5: Mutation check**

| Mutation | Must go RED in |
|---|---|
| return `epoch: written.epoch` instead of re-reading | `answers the MEASURED epoch, not the request` |
| `warning` → `reply.code(404)` for an unknown account | `WARNS, never refuses` |
| omit `accounts: {}` when empty (return `{}` instead) | `ALWAYS emitted, even with nothing tagged` |
| `pool-undecidable` → 409 in `refusePool` | a new `refusePool` case asserting 503 |
| drop the `declared` fallback | a new case: roster `pool` still enforced with no edges |

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts server/src/index.ts server/test/pool-accounts-route.test.ts
git commit -m "feat(server): POST /api/pools/accounts/:id and the epoch document — measured, dual-credential, no nudge"
```

---

### Task 8: the agent reports `observedEpoch`

**Files:**
- Modify: `agent/src/server.ts` (beside `readRosterFp`, `:557-562`)
- Modify: `server/src/remote/client.ts` (`onReady`, `:313-345`)
- Test: `agent/test/observed-epoch.test.ts` (create)

**Interfaces:**
- Consumes: `$REG/pool-epoch` (Task 3), `AgentReady.observedEpoch` (Task 5).
- Produces: `deps.fleetState.observedEpoch: number | null | undefined` for Task 9.

- [ ] **Step 1: Write the failing test**

```ts
it('reports the epoch it has actually got', () => {
  writeFileSync(path.join(reg, 'pool-epoch'), 'epoch 43\nissued 1\nlease 2\n', 'utf8');
  expect(readObservedEpoch(home)).toBe(43);
});
it('reports null — never undefined — when it has never synced', () => {
  expect(readObservedEpoch(home)).toBe(null);
});
it('reports null for a document with no epoch line', () => {
  writeFileSync(path.join(reg, 'pool-epoch'), 'acct a pool-a\n', 'utf8');
  expect(readObservedEpoch(home)).toBe(null);
});
```

Run: `cd agent && ./node_modules/.bin/vitest run test/observed-epoch.test.ts` → FAIL (no such export).

- [ ] **Step 2: Implement**

```ts
/** The epoch of the pool projection THIS node has. `null` means it has never
 *  synced — which is not the same as epoch 0 (the control plane has issued
 *  nothing) and not the same as the field being ABSENT on the wire (an older
 *  agent that cannot tell you). Three conditions, three values, no fold. */
export function readObservedEpoch(home: string): number | null {
  try {
    const text = readFileSync(path.join(home, '.cc-sessions', 'pool-epoch'), 'utf8');
    const m = /^epoch (\d+)$/m.exec(text);
    return m === null ? null : Number(m[1]);
  } catch { return null; }
}
```
Spread it onto the `ready` frame beside `rosterFp`, and read it in `remote/client.ts`'s `onReady` (`:326-327`) onto `fleetState`.

- [ ] **Step 3: Run green**

Run: `cd agent && ./node_modules/.bin/vitest run test/observed-epoch.test.ts` then `cd ../server && ./node_modules/.bin/vitest run test/remote-client.test.ts`

- [ ] **Step 4: Commit**

```bash
git add agent/src/server.ts server/src/remote/client.ts agent/test/observed-epoch.test.ts
git commit -m "feat(agent): observedEpoch on the ready handshake — absent, null and 0 stay three answers"
```

---

### Task 9: the PWA — the chip, its editor, and the lag indicator

**Files:**
- Modify: `pwa/src/lib/accounts.ts` (`accountPool` `:70-73`)
- Create: `pwa/src/fleet/AccountPoolSheet.tsx`
- Modify: `pwa/src/screens/AccountsScreen.tsx` (`.accounts-row-head` `:230`)
- Modify: `pwa/src/screens/FleetScreen.tsx` (header `:441-473`), `pwa/src/fleet/fleet.css`
- Modify: `pwa/src/lib/api.ts` (beside `setProjectPool` `:530`)
- Test: `pwa/test/account-pool-chip.test.tsx`, `pwa/test/account-pool-sheet.test.tsx` (create)

**Interfaces:**
- Consumes: `POST /api/pools/accounts/:id` (Task 7), `AccountPoolWire` (Task 5).
- Produces: `accountPoolState(roster, edges, wrapper): AccountPoolWire` — **the single reader**, replacing `accountPool`'s 8 call sites.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the CENTRAL tag when both carriers disagree', () => {
  const w = accountPoolState(rosterWith('acct-a', 'pool-roster'), new Map([['acct-a', ['pool-central']]]), 'acct-a');
  expect(w).toEqual({ state: 'tagged', pools: ['pool-central'], origin: 'central' });
});

it('falls back to the DECLARED tag and says so — the roster field is retained', () => {
  const w = accountPoolState(rosterWith('acct-a', 'pool-roster'), new Map(), 'acct-a');
  expect(w).toEqual({ state: 'tagged', pools: ['pool-roster'], origin: 'declared' });
});

it('renders the origin, so clearing a central tag does not look like a no-op', () => {
  render(<AccountsScreen {...props} />);
  expect(screen.getByTestId('acct-pool-chip-acct-a')).toHaveTextContent('pool-roster');
  expect(screen.getByTestId('acct-pool-chip-acct-a')).toHaveAttribute('data-origin', 'declared');
});

it('the account sheet ACCEPTS A NAME NO ACCOUNT CARRIES — unlike PoolSheet', async () => {
  render(<AccountPoolSheet {...props} />);
  await userEvent.type(screen.getByLabelText('New pool name'), 'pool-new');
  await userEvent.click(screen.getByRole('button', { name: /create/i }));
  expect(onSet).toHaveBeenCalledWith('acct-a', ['pool-new']);
});

it('refuses a name off POOL_NAME_RE before it reaches the wire', async () => {
  render(<AccountPoolSheet {...props} />);
  await userEvent.type(screen.getByLabelText('New pool name'), 'Pool_A');
  expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
});

it('the fleet head shows epoch/observed ONLY when they differ', () => {
  const { rerender } = render(<FleetScreen {...propsWith({ epoch: 3, observedEpoch: 3 })} />);
  expect(screen.queryByTestId('pool-epoch-lag')).toBeNull();
  rerender(<FleetScreen {...propsWith({ epoch: 4, observedEpoch: 3 })} />);
  expect(screen.getByTestId('pool-epoch-lag')).toHaveTextContent('epoch 4 / observed 3');
});

it('says nothing at all when the agent cannot tell us (absent, not null)', () => {
  render(<FleetScreen {...propsWith({ epoch: 4, observedEpoch: undefined })} />);
  expect(screen.queryByTestId('pool-epoch-lag')).toBeNull();
});
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/account-pool-chip.test.tsx test/account-pool-sheet.test.tsx` → FAIL.

- [ ] **Step 2: Implement `accountPoolState` as the single reader**

Replace `accountPool` in `pwa/src/lib/accounts.ts`, folding the precedence in exactly once so no surface can render a value the API would refuse. **Migrate all 8 call sites** — `NewSessionSheet.tsx:186,281`, `SessionLine.tsx:378`, `SwapSheet.tsx:541,632`, `pools.ts:64,102,125`. Keep a one-line `accountPool()` deriving from it for the callers that only want a name, so there is still ONE reader of the precedence.

- [ ] **Step 3: Build `AccountPoolSheet`**

Copy `pwa/src/fleet/PoolSheet.tsx`'s structure, **plus a free-text field** — and say why in the file header:
```tsx
/** Unlike `PoolSheet` (the PROJECT side), this sheet accepts a pool name no
 *  account yet carries. That asymmetry is principled, not accidental: a pool
 *  exists iff some account is in it, so THE ACCOUNT SIDE IS WHERE A POOL IS
 *  CREATED. A free-text name on the project side would strand the project
 *  against a pool with no members; here it is the only way to make one. */
```
Validate against `POOL_NAME_RE` client-side (the server still refuses — this is courtesy, not the gate).

- [ ] **Step 4: The chip and the lag indicator**

Chip into `.accounts-row-head` (`AccountsScreen.tsx:230`), styled on `.proj-card-pool` (`fleet.css:1714-1743`), carrying `data-origin`. The lag indicator goes in `.fleet-head-right`, rendered **only** when `observedEpoch !== undefined && observedEpoch !== epoch`.

- [ ] **Step 5: Run green, plus the layout gates**

Run: `cd pwa && ./node_modules/.bin/vitest run` (the whole package — it is fast, and `fleet-css.test.ts` guards the header layout the chip lands next to).
Expected: PASS. Re-run `contrast.test.ts` in isolation if it reds — it is a known load flake.

- [ ] **Step 6: Mutation check**

| Mutation | Must go RED in |
|---|---|
| return the declared tag when a central edge exists | `shows the CENTRAL tag when both carriers disagree` |
| drop `data-origin` | `renders the origin` |
| render the lag when `observedEpoch === undefined` | `says nothing at all when the agent cannot tell us` |
| allow a second reader of the precedence | `single-definition`-style pin in `accounts-pool.test.ts` |

- [ ] **Step 7: Commit**

```bash
git add pwa/src
git commit -m "feat(pwa): the account pool chip, its creating editor, and the epoch/observed lag"
```

---

### Task 10: docs, and the merge gate

**Files:**
- Modify: `CLAUDE.md` (the account-pools bullet)
- Modify: `docs/superpowers/specs/2026-09-18-account-pool-membership-design.md`
- Test: `server/test/box-token-census.test.ts` (the CLAUDE.md-pins-code mechanism, `passage()` `:239-246`)

- [ ] **Step 1: Name the freshness dependency in `CLAUDE.md`**

Spec §8 requires this be *named, not discovered*. Extend the existing **Account pools** bullet:

> **The account side is CENTRAL and LEASED.** An account's pool lives in `pool_edges` in `~/.ccrc/coord.db` (authoritative, journalled to `~/.ccrc/pool-edges.log`), reaches the fleet as `$REG/pool-epoch` pulled by `ccd-pool-sync.timer`, and `accounts.json`'s `pool` is retained as the LOWEST-precedence declared default — retiring it would make an old `ccd` read every account untagged, which is fail-OPEN. **`ccd`'s placement now has a freshness dependency it has never had:** `_project_pool_state`'s absent file honestly means "nobody tagged anything", but `_acct_pool_state`'s absent file means "I have not synced" and reads `unreadable` → undecidable → refuse into a tagged project. `stale` and `unreadable` are two words with two remedies and never fold. The server never nudges; convergence is the timer's pull, bounded by `OnUnitActiveSec=60s`.

- [ ] **Step 2: Pin the sentence against the code**

Copy `box-token-census.test.ts`'s `passage()` mechanism (`:239-246`): slice the bullet by anchor string, flatten whitespace, and assert **both directions** — that every state word the bullet names is in `_acct_pool_state`'s real output set, and that every word that reader can emit is named in the bullet. A prose pin that only checks presence agrees with itself while both lie.

- [ ] **Step 3: Fold the corrections back into the spec**

Apply the eight corrections and four rulings from this plan's own sections to the spec, so the spec stops being a trap for the next reader. **Keep the edits short**: the spec is cited by this plan by line number, and lines added above an anchor move every anchor below it.

- [ ] **Step 4: RE-MEASURE THE MIGRATION SLOT — this is the merge gate**

```bash
git fetch origin main
git show origin/main:server/src/coord/schema.ts | grep -cE '^  // ── [0-9]+: user_version'
```
If the count is **12**, slot 13 is still free and the branch merges as written. If it is **13 or more**, another branch landed first (PR #40 is the named contender): renumber this migration to the next free slot, update its banner comment and its "THIS ENTRY IS SLOT 13 AS WRITTEN" note, and re-run `test/coord-schema.test.ts`. **Two entries at one `user_version` is a migration that never runs.**

- [ ] **Step 5: Run the cross-branch deviation guard**

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```
This compares this branch's D-entries against `origin/main`'s **without merging** and reds on any allocator-era number defined in two plans.

- [ ] **Step 6: Full suites, all three packages, FOREGROUND**

```bash
cd server && npm run test    # then agent, then pwa
```
Re-run any of the known load flakes IN ISOLATION before calling a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`, `contrast`.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-18-account-pool-membership-design.md server/test/box-token-census.test.ts
git commit -m "docs: the account-pool freshness dependency, named rather than discovered"
```

---

## Deploy order — not optional

1. **Tasks 1–4 merge, then `bash deploy/deploy.sh agent <host>`.** The fleet gains `_acct_pool_state`, `_pool_ok`'s arm and the timer while the control plane still 404s `/api/pools/epoch`. Every account reads `unreadable` → undecidable → refusals **only into tagged projects, of which this fleet has zero** (spec §3.8). That window is the whole ordering argument and it exists only now.
2. **Tasks 5–10 merge, then `bash deploy/deploy.sh`.** The server begins answering; within 60s every node holds a document.
3. **Verify on the box, not by inference:** `ls -l ~/.cc-sessions/pool-epoch` (now present), `systemctl --user list-timers | grep pool-sync`, and one `ccd`-side read that the projection parses.

Rollback is `DELETE FROM pool_edges` and letting the lease expire; nothing moves, and untagged is unconstrained.

## Deviations found

**Do NOT pre-allocate.** Numbers are ISSUED by `POST /api/ledger/deviations` and **defined in the same act** — you cannot define a departure you have not yet found. Mint one block after the whole-wave review, per the convention the two most recent shipped plans follow, and record each departure as `- **D-N** (slug) — what departed and why`. Never spell the block's unspent tail; never write a bare `D-TBD-` into a tracked file (report instead).

Known departures to record at the mint, at minimum: the eight spec corrections and the four rulings R1–R4 in this plan's own sections above.

## Carried, not owned by this wave

- Multi-pool accounts (drop the partial unique index; the wire already carries `pools: string[]`).
- `principal_grants` and the org edition (spec §6) — out of scope by operator ruling 3.
- Retiring the roster `pool` field — a later wave with its own skew analysis.
- The server box's `accounts.json` still needs the 5+2 `provider` lines the fleet box got on 2026-09-17; the projection is byte-identical so there is no divergence, but the remote server still emits the boot warning.
