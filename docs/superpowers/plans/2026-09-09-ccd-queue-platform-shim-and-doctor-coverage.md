# ccd queue — the darwin move shim, and doctor's unit coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close three `ccd` defects reported from outside this program by `claude-OpenClawHetzner`, each
small, each currently INERT, and each silent the moment it stops being inert: `_plat_mv_notdir`'s Darwin
arm returns success while its own postcondition is false, and `ccrc-doctor-checks` never asks about a
timer that is about to start shipping.

**Architecture:** Two independent changes, both under `ccd/`, plus two vitest suites under `server/test/`.
Part A touches the PLATFORM BLOCK, which is byte-identical in `ccd/ccd` and `ccd/ccrc` and pinned equal
by `macos-platform.test.ts` — **both files must change together or that pin reds.** Part B touches
`ccd/ccrc-doctor-checks` only. No server, agent, shared or PWA source is touched.
**Every change is under `ccd/`, so this is AGENT-FIRST at deploy time** — the fleet host ships before
the server. The deploy is run by the operator or the coordinator, never by this plan's implementer.

**Tech Stack:** bash 5.2 (`set -uo pipefail`, no `-e`), vitest, fixture HOMEs only.

**Base:** cut from `origin/main` AFTER PR #69 merges. Neither part touches any file #69 touches
(`_plat_mv_notdir` is in the platform block, which #69 leaves alone; `ccrc-doctor-checks` is untouched by
#69), so the parts are independent of that merge — but the branch should still start from the merged tip
so the suites run against one tree.

---

## Part A — `_plat_mv_notdir`'s Darwin arm

- [ ] **A1.** Add a case to a suite that RUNS ON LINUX proving the defect, RED first. Drive the Darwin arm
      by setting `CCD_OS=darwin` after sourcing the platform block; do NOT add it to
      `macos-platform.test.ts`'s `describe.skipIf(!IS_DARWIN)` block, which never executes here (D-2188).
      The case: `dest` a symlink to a directory, `src` a regular file → the function must answer 0 only
      if `src` is now AT `dest`.
- [ ] **A2.** Fix the arm: when `"$2"` is a symlink to a directory, `rm -f -- "$2"` before the `mv -f`.
      Keep the change to that one shape — every other shape already behaves (D-2187).
- [ ] **A3.** Mirror the identical bytes into `ccd/ccrc`'s copy of the platform block and confirm
      `macos-platform.test.ts`'s byte-identity assertion still passes.
- [ ] **A4.** Correct the atomicity paragraph's destination claim (D-2189). Do not widen it into a new
      assurance — state what is true and name the call sites.
- [ ] **A5.** Mutation table: delete the `rm -f` line, measure A1 RED, restore, measure green.

## Part B — `_check_services`' unit coverage

- [ ] **B1.** Add `ccrc-models.timer` to `known` in `ccd/ccrc-doctor-checks` (D-2190).
- [ ] **B2.** Add the fixture case FIRST and measure it RED without B1 — the addition alone is a measured
      no-op against the current suite (D-2191), so shipping it without a case ships a request, not a
      mechanism. Follow the fixture pattern already in `ccrc-doctor.test.ts` for a unit-file-present box.
- [ ] **B3.** Give the timer its own `case` arm sentence rather than letting it fall to `*)`. Use the
      reporting session's wording, attributed: a dead timer means every lane's catalogue goes stale and
      nothing says so.
- [ ] **B4.** Correct the `*)` arm's comment, which says "the day a fifth unit joins it" while five are
      already listed (D-2192).
- [ ] **B5.** Record, in the file, that this check has TWO coverage designs and which one each unit uses
      (D-2193). Do not implement the census route here — it belongs with the catalogue's own contract,
      which this repo does not own.
- [ ] **B6.** Mutation table: remove `ccrc-models.timer` from `known`, measure B2 RED, restore.

## Part C — the catalogue freshness check (contract supplied by the reporting session)

`known` (Part B) answers "is the timer running". It cannot see a timer that fires and produces nothing,
which for a catalogue is the failure that bites. The reporting session owns the catalogue's semantics
and supplied the contract, measured on `origin/main` at `ee1d6228`; it is recorded here so the check is
built against a stated contract rather than an inference.

- [ ] **C1.** Add a `models` freshness check as its OWN function, not a stub. The reporting session's
      Plan 2 adds a separate per-lane `models` arm (orphan registry, settings-block drift, LiteLLM
      `.prev` mismatch); keeping them separate means the two PRs never touch the same lines.
- [ ] **C2.** Loop population: every `~/.ccrc/models/<id>.classes.json` whose `<id>` is a roster row.
      Only lanes WITH a registry are ever probed (`ccrc models refresh --all` filters on `hasRegistry`;
      anthropic lanes have none by design). A registry with no `<id>.json` is "never probed" — WARN with
      the remedy `ccrc models refresh <id>`, NOT a freshness failure. An ORPHAN registry (id in no roster
      row) is Plan 2's item; skip it here.
- [ ] **C3.** The predicate, verbatim from the contract:

          fresh := stale == false AND (now - fetchedAt) <= 3*3600

      `fetchedAt` is UNIX SECONDS (the probe writes `int(time.time())`) — compare with `date +%s`, never
      with the millisecond stamps the server side uses elsewhere. Three periods, because the timer is
      `OnUnitActiveSec=60min` with `TimeoutStartSec=300`: one missed hourly run must never warn.
- [ ] **C4.** Two sentences, one WARN each, `stale` picking which — and WARN not FAIL in both arms,
      because the lane keeps serving from its registry:
      - `stale:false` and `fetchedAt` older than 3 h → nobody rewrote the file; the timer is not reaching
        this lane. Remedy: `systemctl --user status ccrc-models.timer`, then `ccrc models refresh <id>`.
        **This is the silent case Part B's `known` line cannot see.**
      - `stale:true` → the timer runs and the provider did not answer. Quote `lastError` and the age of
        `fetchedAt`. Warn regardless of age: the env block has already lost its window key.
- [ ] **C5.** PASS text names the lanes and ages ("models: 1 lane, gpt catalogue 41 min old"), in the
      same shape as the services PASS — so a box that answers PASS cannot be one whose loop ran over
      nothing. The POPULATION is what that PASS is really asserting.
- [ ] **C6.** Mutation table: stop the clock (age the fixture past 3 h with `stale:false`) and measure
      C4's first arm RED; set `stale:true` on a fresh catalogue and measure the second arm RED.

---

## Deviations found

### D-2187 — `_plat_mv_notdir`'s Darwin arm answers 0 with its own postcondition false
The contract is `# <src> <dest> -> 0 iff <src> is now at <dest>`. Measured on GNU coreutils 9.4,
`mv -f -- src dest` with `dest` a **symlink to a directory** returns 0 with `dest` still the symlink and
`src` moved INSIDE the linked directory. Measured across all five destination shapes, it is exactly one
shape wide: symlink-to-file, dangling symlink and plain file all replace correctly, and a plain directory
is caught by the guard's `return 1`. The `! -L` in that guard is what admits the failing shape, and the
function's own header calls that order "the whole correctness of the Darwin arm" while enumerating only
two outcomes for it — replace, or wrongly refuse — where the code performs a third.
**The fix removes a bet rather than placing one:** the arm is correct today only if BSD `mv` does not
follow a symlink to a directory, which nobody has measured. After `rm -f` the destination does not exist
and no `mv` can move into it, so "unverified on Darwin" is the argument FOR the fix, not a reason to wait
for a mac. Reported by `claude-OpenClawHetzner`; confirmed and narrowed here.

### D-2188 — the case that would have caught it has never run
`macos-platform.test.ts`'s Darwin block is `describe.skipIf(!IS_DARWIN)`. Measured on the fleet box:
**38 passed, 10 skipped**, and the `_plat_mv_notdir` case is one of the ten. Adding a symlink case there
would add a comment, not a mechanism. Both arms are pure bash and CAN be pinned in a suite that runs on
linux by driving `CCD_OS=darwin` after sourcing the platform block, which is what A1 does.

### D-2189 — the atomicity paragraph's destination claim is false at four of five call sites
It reads *"every destination is `$REG/<id>.<field>`, and this function is its only writer — so the race is
unreachable here rather than tolerated."* Measured against `origin/main`, four of five destinations are
outside `$REG`: `$plist`, `$_LC_DIR/errors`, `$_sl_file`, and `$POOLS_DIR/$project` — **which
account-pools wave 2a added.** The conclusion survives (nothing in the tree creates a *directory* at any
of those paths, so the race stays unreachable); the argument that proves it does not. This is the
misattribution class, and this instance is ours: a wave added a call site and left the quantifier
standing.

### D-2190 — `_check_services` never asks about `ccrc-models.timer`
`known` is a hardcoded five-unit list, and `installed` is built only from it, so a unit outside it never
enters the loop and the `*)` arm can never fire for it. The PASS line promises *"a box that answers 'PASS
services' cannot be a box where the check quietly measured one unit"* — true as written, and scoped to
`known`, which is exactly the gap. Once the reporting session's installer ships the timer, a stopped or
failed models timer reads as PASS and every lane's catalogue goes stale with no signal.

### D-2191 — the one-line fix is a measured no-op, so it would ship unpinned
Membership in `installed` is gated on the unit FILE existing, so naming a not-yet-installed unit is
inert. Measured on a scratch worktree of main: **350 passed | 3 skipped, before and after** adding
`ccrc-models.timer` to `known`. Two consequences. First, the fix needs **no ordering gate** behind the
installer PR and should land BEFORE it, because the failure it closes is silent from the moment the
timer exists — a check for a thing should exist before the thing does. Second, and the reason B2 comes
before B1: the same measurement says the line alone changes nothing any suite can see, so it is a
request until a fixture installs a unit file and asserts doctor names it.

### D-2192 — the `*)` arm's comment counts wrong about its own list
It reads *"the day a fifth unit joins it"*; `known` already holds five, so the next is the sixth. The
same class as D-2190 in miniature — a count in a comment that went stale when the thing it counts grew.

### D-2193 — the file runs TWO coverage designs and neither was extended to the new unit
Measuring every unit `ccrc` installs against every unit doctor asks about finds two more outside `known`,
both outside it DELIBERATELY: `ccd-graph-sweep.timer` is covered by the graph-sweep census check, which
measures the census file's FRESHNESS through `_plat_mtime`; `ccrc-ddns.timer` is covered by the `name`
check, which measures the actual DNS record rather than the timer that maintains it. So the real shape of
D-2190 is not "the list went stale" but "a unit landed and neither design was extended to it".
A `known` entry cannot see a timer that fires and produces nothing, which for a catalogue is the failure
that bites — so `known` is the floor here, not the ceiling. The census route is the stronger mechanism
and belongs with whoever owns the catalogue's freshness contract, which is not this repo. Recorded rather
than built.

### D-2224 — the catalogue's staleness is a FLAG nobody ages
`parseCatalogue` reads `json.stale === true` and nothing else; no reader derives staleness from
`fetchedAt`. The probe is the only writer of `stale`, and `_mark_stale` rewrites an existing catalogue
with `stale:true` + `lastError` while KEEPING `models` and `fetchedAt` — deliberately, so a reader knows
how old the data is. **So the one failure the flag cannot express is the one that matters: a timer that
stops firing leaves `stale:false` beside an ever-older `fetchedAt`, and every reader goes on calling the
catalogue current.** Two consequences on the lane, both degradation rather than outage: the materialiser
omits `CLAUDE_CODE_MAX_CONTEXT_TOKENS` while a catalogue is stale, and `deriveModels` suspends the
`retired` derivation ("absence from a catalogue nobody could refresh is not evidence"). Routing never
reads the catalogue, so the lane keeps serving.

The two timestamps mean different things and the check must not conflate them: the FILE's mtime is "the
timer's last run reached this lane" (a FAILED run rewrites the file too); `fetchedAt` is "the last time
the provider actually answered". A freshness check that read mtime would call a lane fresh for as long
as the timer keeps failing at it.

Contract supplied by `claude-OpenClawHetzner`, who owns the probe; measured by them on `origin/main`
`ee1d6228`. Not a defect they introduced — the flag was always probe-written — and not one this repo
can close from the `known` list alone, which is why Part C exists as its own arm rather than a widening
of Part B.
