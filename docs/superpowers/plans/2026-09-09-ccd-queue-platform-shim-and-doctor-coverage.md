# ccd queue — the darwin move shim, and doctor's unit coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close three `ccd` defects reported from outside this program by `claude-OpenClawHetzner`, each
small, each currently INERT, and each silent the moment it stops being inert: `_plat_mv_notdir`'s Darwin
arm returns success while its own postcondition is false, and `ccrc-doctor-checks` never asks about a
timer that is about to start shipping. **Part D was added 2026-09-10** and is a different kind of item:
D-2347, inherited from #73, plus the eleven other open instances of its class that looking for it found
(D-2376). Same deploy lane, same INERT-until-it-is-not character.

**Architecture:** Three independent changes, all under `ccd/`, plus vitest suites under `server/test/`.
Part A touches the PLATFORM BLOCK, which is byte-identical in `ccd/ccd` and `ccd/ccrc` and pinned equal
by `macos-platform.test.ts` — **both files must change together or that pin reds.** Part B touches
`ccd/ccrc-doctor-checks` only. **Part D touches `ccd/ccd` only.** Its site count is DERIVED at execution time, not quoted here: D1-D5 name ten mandatory sites and D8 names four further groups, two of them conditional and one dead on a Linux fleet, so no reading of the list below yields the twelve this sentence used to assert (D-2475). Re-measure the class before fixing it, and navigate by SYMBOL — every line anchor in Part D predates #69/#78/#79 and has drifted.
No server, agent, shared or PWA source is touched.
**`test-macos` IS NOT A REQUIRED CHECK** (measured 2026-09-10: the four required contexts are
`test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`, and `.github/workflows/ci.yml:129` says
`test-macos` "is additive and non-required — a red here blocks nothing"). Part A's guard therefore has
to red under `test (server)`; `macos-platform.test.ts` rides that lane but compares BYTES, not Darwin
behaviour, so A1's `CCD_OS=darwin` case is the only mechanism Part A gets.
**Every change is under `ccd/`, so this is AGENT-FIRST at deploy time** — the fleet host ships before
the server. The deploy is run by the operator or the coordinator, never by this plan's implementer.

**Tech Stack:** bash 5.2 (`set -uo pipefail`, no `-e`), vitest, fixture HOMEs only.

**Base:** cut from `origin/main` AFTER PR #69 merges. Neither part touches any file #69 touches
(`_plat_mv_notdir` is in the platform block, which #69 leaves alone; `ccrc-doctor-checks` is untouched by
#69), so the parts are independent of that merge — but the branch should still start from the merged tip
so the suites run against one tree.

---

## Part A — `_plat_mv_notdir`'s Darwin arm

- [x] **A1.** Add a case to a suite that RUNS ON LINUX proving the defect, RED first. Drive the Darwin arm
      by setting `CCD_OS=darwin` after sourcing the platform block; do NOT add it to
      `macos-platform.test.ts`'s `describe.skipIf(!IS_DARWIN)` block, which never executes here (D-2188).
      The case: `dest` a symlink to a directory, `src` a regular file → the function must answer 0 only
      if `src` is now AT `dest`.
- [x] **A2.** Fix the arm: when `"$2"` is a symlink to a directory, `rm -f -- "$2"` before the `mv -f`.
      Keep the change to that one shape — every other shape already behaves (D-2187).
- [x] **A3.** Mirror the identical bytes into `ccd/ccrc`'s copy of the platform block and confirm
      `macos-platform.test.ts`'s byte-identity assertion still passes.
- [x] **A4.** Correct the atomicity paragraph's destination claim (D-2189). Do not widen it into a new
      assurance — state what is true and name the call sites.
- [x] **A5.** Mutation table: delete the `rm -f` line, measure A1 RED, restore, measure green.

## Part B — `_check_services`' unit coverage

- [x] **B1.** Add `ccrc-models.timer` to `known` in `ccd/ccrc-doctor-checks` (D-2190).
- [x] **B2.** Add the fixture case FIRST and measure it RED without B1 — the addition alone is a measured
      no-op against the current suite (D-2191), so shipping it without a case ships a request, not a
      mechanism. Follow the fixture pattern already in `ccrc-doctor.test.ts` for a unit-file-present box.
- [x] **B3.** Give the timer its own `case` arm sentence rather than letting it fall to `*)`. Use the
      reporting session's wording, attributed: a dead timer means every lane's catalogue goes stale and
      nothing says so.
- [x] **B4.** Correct the `*)` arm's comment, which says "the day a fifth unit joins it" while five are
      already listed (D-2192).
- [x] **B5.** Record, in the file, that this check has TWO coverage designs and which one each unit uses
      (D-2193). Do not implement the census route here — it belongs with the catalogue's own contract,
      which this repo does not own.
- [x] **B6.** Mutation table: remove `ccrc-models.timer` from `known`, measure B2 RED, restore.

## Part C — the catalogue freshness check (contract supplied by the reporting session)

`known` (Part B) answers "is the timer running". It cannot see a timer that fires and produces nothing,
which for a catalogue is the failure that bites. The reporting session owns the catalogue's semantics
and supplied the contract, measured on `origin/main` at `ee1d6228`; it is recorded here so the check is
built against a stated contract rather than an inference.

- [x] **C1.** Add a `models` freshness check as its OWN function, not a stub. The reporting session's
      Plan 2 adds a separate per-lane `models` arm (orphan registry, settings-block drift, LiteLLM
      `.prev` mismatch); keeping them separate means the two PRs never touch the same lines.
- [x] **C2.** Loop population: every `~/.ccrc/models/<id>.classes.json` whose `<id>` is a roster row.
      Only lanes WITH a registry are ever probed (`ccrc models refresh --all` filters on `hasRegistry`;
      anthropic lanes have none by design). A registry with no `<id>.json` is "never probed" — WARN with
      the remedy `ccrc models refresh <id>`, NOT a freshness failure. An ORPHAN registry (id in no roster
      row) is Plan 2's item; skip it here.
- [x] **C3.** The predicate, verbatim from the contract:

          fresh := stale == false AND (now - fetchedAt) <= 3*3600

      `fetchedAt` is UNIX SECONDS (the probe writes `int(time.time())`) — compare with `date +%s`, never
      with the millisecond stamps the server side uses elsewhere. Three periods, because the timer is
      `OnUnitActiveSec=60min` with `TimeoutStartSec=300`: one missed hourly run must never warn.
- [x] **C4.** Two sentences, one WARN each, `stale` picking which — and WARN not FAIL in both arms,
      because the lane keeps serving from its registry:
      - `stale:false` and `fetchedAt` older than 3 h → nobody rewrote the file; the timer is not reaching
        this lane. Remedy: `systemctl --user status ccrc-models.timer`, then `ccrc models refresh <id>`.
        **This is the silent case Part B's `known` line cannot see.**
      - `stale:true` → the timer runs and the provider did not answer. Quote `lastError` and the age of
        `fetchedAt`. Warn regardless of age: the env block has already lost its window key.
- [x] **C5.** PASS text names the lanes and ages ("models: 1 lane, gpt catalogue 41 min old"), in the
      same shape as the services PASS — so a box that answers PASS cannot be one whose loop ran over
      nothing. The POPULATION is what that PASS is really asserting.
- [x] **C6.** Mutation table: stop the clock (age the fixture past 3 h with `stale:false`) and measure
      C4's first arm RED; set `stale:true` on a fresh catalogue and measure the second arm RED.

---

## Part D — the guard that admits a FIFO, then a read by name (D-2347 + D-2376)

**This part is a transcription, not a design.** The correct pattern already exists in this file with its
argument written out: `_project_pool_state` (`ccd/ccd:1331`, account-pools wave 2a — ours) guards
`[[ -f "$f" && -r "$f" ]]` and says why — *"a character device gets the one answer that is safe for all
of them… `-r "$f"` is checked in the SAME breath."* The test vocabulary exists too:
`ccd-project-pool.test.ts`'s `boundedState` helper, whose docstring records the non-obvious half —
**vitest's own per-test timeout cannot save you**, because `h.sh`'s `execFileSync` is SYNCHRONOUS and
blocks the very event loop the timeout timer must fire on, so the bound has to live on the child
process — with cases for FIFO, symlink-to-FIFO, symlink-to-`/dev/zero`, directory, mode-000 and broken
symlink. `ccd-crosspool.test.ts` carries six more FIFO cases. Every site below is a site that was
written outside that pattern.

**Order is by blast radius, and D1 is not optional.** A hang here is not a wrong answer that a later
read corrects — it is a process that never returns, holding whatever it holds.

- [x] **D1. `source "$CCRC_ACCOUNTS_SH"` (ccd:1090) — the module top level (D-2377).** Guards are `-e`
      (1081) and `-r` (1083); both are true for a FIFO and for a character device, and `source` opens by
      name. **This runs in every `ccd` process on the box** — each `ccd supervise` unit at startup and at
      every restart, every `ccd` the agent shells out under the exec whitelist (so every PWA tap), every
      terminal invocation. Add `-f` to the existing ladder as its own arm with its own `die` sentence, so
      the operator is told the roster is not a regular file rather than told nothing for ever. The
      existing comment reasons carefully about a DANGLING symlink and never reaches this shape.
- [x] **D2. The hold family — five sites, one shape (D-2378).** `cmd_ws_rm` (4975), `cmd_ws_rename`
      (5360), `cmd_ws_release` (6000), `cmd_ws_reap` (10403), `cmd_forget` (16697). Each tests
      `[[ -e "$REG/$id.hold" ]]` — **deliberately `-e`, and the polarity is right**: ccd:10400 says
      *"`-e` not `-f`: an unreadable-but-present hold still refuses — the fail-shut polarity is that
      doubt reads as HELD."* Keep that. The defect is the NEXT line: each then reads the hold by name
      with `cat` to build its refusal string, and `cat` blocks. **`cmd_ws_release` is the trap**: its
      `rm -f -- "$REG/$id.hold"` sits on the line AFTER its `cat`, so the one verb whose purpose is to
      clear a hold is blocked by the hold it would clear, and no ccd verb can then remove that row.
      Fix at the READ, not the gate: the `-e` arm stays, and the `cat` becomes a bounded read that
      answers the existing `<unreadable — treat as held>` fallback for a non-regular file. The `|| echo`
      fallbacks already written at four of the five sites are DEAD today for this input — `cat` never
      returns to fail — and become live with the fix.
- [x] **D3. `_ws_status` (ccd:3112) — one unguarded reader of four (D-2379).** The census of
      `<cfg>/sessions/<pid>.json` readers is four: `_sync_uuid` (12216, `-f`), `_auto_swap_check` (13410,
      `-f`, added by #69 round 3), `_auto_compact_check` (13590, a three-rung ladder that also names
      WHICH shape it refused) — and `_ws_status`, which has **no type test at all** before
      `grep -oE … "$sf"`. Its callers are `cmd_ws_archive` (`st=$(_ws_status "$id") || die
      "status-unknown"`), `_ws_reap_eval` and `cmd_ws_reap` — destructive-verb gates. This is the
      instance our own round left behind when it fixed its sibling, and it is the reason this part exists
      as a class sweep rather than a one-line fix.
- [x] **D4. `_pr_py`'s two Python opens (ccd:3773 get(), ccd:3936 lock) (D-2380).** Same class, other
      language, and the language makes it worse: `except FileNotFoundError` (3773) and `except OSError`
      (3938) are **dead code for this input**, because `open()` itself blocks and the except never runs.
      3936 opens `'a'`, which blocks until a READER appears. Reached from `cmd_pr_state`'s per-id loop,
      so one poisoned registry field hangs the whole PR-state sweep. Guard with `os.path.isfile` (or
      `stat.S_ISREG`) before each open, and say so where the comment block at 3888-3907 enumerates this
      open's outcomes — it reasons about every branch where `open` RETURNS and none where it does not.
      **Landed as FOUR opens, not two — D-2380 corrected in place below**: `get()` and the lock are
      the two named here; the prhistory append and `put()`'s own tmp-file open are the same class,
      undercounted by the same D-2475 staleness, extended in place with no new number (worker clause 6).
- [x] **D5. `_transcript_stalled_pair` (ccd:14316) — D-2347, the one that started this.** One line:
      `[[ -r "$f" ]]` becomes `[[ -f "$f" && -r "$f" ]]`. **Measured end to end on a clean worktree cut
      from `origin/main` at `24f32a18`** — mutation table in D-2381 below.
      **VERIFIED this wave, not implemented this wave** — this fix already landed in PR #78, before
      this wave started; this wave re-measured it (and its byte-identical twin `_transcript_limit_banner`)
      by mutation and confirmed both pins are still live (see D-2381).
- [x] **D6. The red-first cases, before any of D1–D5.** Follow `ccd-project-pool.test.ts`: a bounded
      helper plus FIFO, symlink-to-FIFO, symlink-to-`/dev/zero` and directory cases per site, each
      double-bounded (helper bound AND a vitest per-test timeout). **A red that hangs is not a red** — it
      is a CI timeout, and on a load-sensitive suite it burns the whole run. Measure every case RED
      first; a case that is green before the fix is pinning nothing.
- [x] **D7. Mutation table.** Per site: revert the guard, measure that site's case RED, restore, measure
      green. **One row per site you actually fixed** — the count is whatever your own census returned, not a
      number carried from this document (D-2475). Do not batch — a single table entry covering "the class"
      cannot tell which guard is unpinned.
- [x] **D8. The remaining sites, DISCLOSED not silently dropped.** The sweep also named
      `_ws_archive_manifest`'s `prhistory` open (6779), `_attic_project`'s `sed` (7120), `cmd_ws_add`'s
      three `grep`s of `info/exclude` (4654) and `cmd_supervise`'s darwin start-limit arm (14970, dead on
      a Linux fleet). Fix them here if D1–D5 land cheaply; if not, they stay named in D-2376 with a
      reason, never dropped.

**What Part D must NOT do:** widen into the SECOND class the sweep turned up — functions whose measured
arms all guard but whose final fallback returns an unmeasured value at the same exit status. That class
has ~18 candidates in this file and **most of them are deliberate and argued** (`_home_for` is D-1986,
and `_home_measured` is already its measured sibling; `_transcript_path`'s rung 4 is specified verbatim
by `2026-08-12-swap-transcript-defect-family-design.md` §2.5). Each needs adjudicating against its own
governing document before it can be called a defect. Booked as a QUESTION in D-2376, not as work.

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
follow a symlink to a directory, which nobody has measured. **Conditional on the unlink succeeding** —
after a SUCCESSFUL `rm -f`, the destination does not exist and no `mv` can move into it; a FAILING `rm`
is a precondition nothing enforced until the final round, closed there by `rm -f -- "$2" || return 1`
(the fall-through this defect's own recurrence rode in on) — so "unverified on Darwin" is the argument
FOR the fix, not a reason to wait for a mac. Reported by `claude-OpenClawHetzner`; confirmed and narrowed
here.

**Part A mutation table (D-2187) — SIX mutants of the fix's new guard, four columns per row (final-round
item 6; supersedes the five-row/"caught by" form below it once carried).** All six applied to `ccd/ccd`'s
`_plat_mv_notdir` only, each restored from a copy kept outside the repo (never `git checkout --`); full
transcripts in `.superpowers/sdd/2026-09-09-ccd-queue-platform-shim-and-doctor-coverage/partA-report.md`
and `finish-report.md`, which `.gitignore` excludes — recorded here so the measurement survives the
worktree. The four columns are the ones relevant to whether the `rm` is CONTAINED in its guard — not
every mechanism that exists: **case (a)** = "refuses when src is missing and leaves a plain-file dest
untouched" (`macos-platform.test.ts`), **case (b)** = "...leaves a symlink-to-file dest resolvable", **the
narrowed scan** = `ccd-reg-set-atomic.test.ts`'s since-DELETED "WEAKEST HONEST FORM" check (see below),
**A1 case 2** = "refuses a real directory destination and leaves it untouched". A1's case 1
(symlink-to-directory dest, src present — the fix's own defining case) sits outside this four-column
group by design; a row can be green across all four and still be caught elsewhere.

| # | mutant | case (a) | case (b) | narrowed scan | A1 case 2 |
|---|---|---|---|---|---|
| M1 | delete the `rm -f -- "$2"` line entirely | GREEN | GREEN | GREEN | GREEN — **UNPINNED** by these four; caught only by A1's case 1 |
| M2 | guard the `rm` by `-L "$2"` only (drop `-d`) | GREEN | **RED** | GREEN | GREEN |
| M2b | guard the `rm` by `-d "$2"` only (drop `-L`) | GREEN | GREEN | GREEN | GREEN — **UNPINNED** by these four, but **PROVABLY EQUIVALENT** (below), not an uncaught defect |
| M3 | make the `rm` unconditional (drop its own `-L`/`-d`, keep `\|\| return 1`) | **RED** | **RED** | GREEN | GREEN |
| M4 | M3 plus delete the pre-existing refusal guard (`if [ ! -L "$2" ] && [ -d "$2" ]; then return 1; fi`) too | **RED** | **RED** | **RED** | GREEN |
| 6 | delete ONLY the refusal guard — the `rm` line left EXACTLY as HEAD has it | GREEN | GREEN | GREEN | **RED** |

**The narrowed scan's column is historical for M1–M4/M2b and MEASURED for row 6** (the rest were not
re-run against it, since it no longer exists — deleting it is what row 6 decided; see below). **M4's `A1
case 2` column is a NEW result, not the historical one**: before this final round added
`rm -f -- "$2" || return 1`, an unconditional `rm` on a real (non-symlink) directory failed but fell
through to a `mv` that then succeeded by moving `src` INSIDE it — the shape M4 exists to catch. With
`|| return 1` now in place, `rm -f` (no `-r`) on a real directory still fails, but the function now
returns 1 immediately on that failure regardless of whether the refusal guard exists — so this fix
*coincidentally* closes M4's real-directory column on its own, for this one shape. M4's case (a)/(b)
columns are unaffected and still catch it.

**Row 6 decides the narrowed scan's fate, per the coordinator's ruling, and it is GREEN**: deleting only
the refusal guard, with the `rm`'s own `-L`/`-d` guard left untouched, still leaves both an `-L "$2"` and
a `-d "$2"` token in the body (supplied by the `rm` guard line itself) — so the scan, which only checks
token PRESENCE anywhere in the body, never fires. A pin whose name promises containment while its body
cannot fail is worse than none: the next reader sees a named assertion and stops looking. **The scan is
DELETED** (`ccd-reg-set-atomic.test.ts`, in the same test as before — the rest of that test, which pins
`_reg_set`'s own body, is untouched) and the sentences claiming it — in that file's comments and in this
paragraph's prior wording — are removed with it. `_plat_mv_notdir`'s Darwin arm is pinned entirely by
`macos-platform.test.ts`'s "`_plat_mv_notdir`'s Darwin arm, forced from Linux (D-2187)" describe now:
A1's two cases, the two R1 behavioural cases, and the two prices this final round added (the rm-fails
case and the destination-gone case, both below).

**M2b's equivalence, stated rather than assumed:** the untouched refusal guard returns before the `rm`
line for every non-symlink directory, so by the time `[ -d "$2" ]` is evaluated on the `rm`'s own guard,
`-d "$2"` being true there already implies `-L "$2"` is true too — `-d`-alone and `-L`-and-`-d` cannot
differ on any input that reaches that line. No behavioural case can distinguish them, and inventing one
would pin nothing while looking as if it did.

**Before the fix round that added the two R1 behavioural cases, M2 and M3 were both green on every
mechanism** — those two cases are what turned them red; that asymmetry is the whole reason this table
exists.

**Two more prices, pinned this final round (item 4):** the **rm-fails price** — dest a symlink-to-directory
inside a parent with no write permission, so `rm -f -- "$2"` itself fails — must not answer 0 (this is
what makes the `|| return 1` fix in item 1 a mechanism rather than a comment); and the
**destination-gone price** — dest a symlink-to-directory, `src` ABSENT — leaves the destination GONE
where the pre-fix code left the symlink intact, disclosed in `_plat_mv_notdir`'s own header and now
pinned so it cannot silently change in either direction. Both live in the same describe as A1's cases;
the first is `it.skipIf(process.getuid?.() === 0)` because root defeats `chmod`.

### D-2188 — the case that would have caught it has never run
`macos-platform.test.ts`'s Darwin block is `describe.skipIf(!IS_DARWIN)`. Measured on the fleet box:
**38 passed, 10 skipped**, and the `_plat_mv_notdir` case is one of the ten. Adding a symlink case there
would add a comment, not a mechanism. Both arms are pure bash and CAN be pinned in a suite that runs on
linux by driving `CCD_OS=darwin` after sourcing the platform block, which is what A1 does.

### D-2189 — the atomicity paragraph's destination claim is false at six of eight call sites
**Cardinal corrected in place (the D-2475 shape) — the conclusion survives, only the count was wrong.**
It reads *"every destination is `$REG/<id>.<field>`, and this function is its only writer — so the race is
unreachable here rather than tolerated."* The original count ("four of five") was `ccd/ccd` alone and
missed three call sites in `ccd/ccrc`. Re-derived repo-wide by symbol (`/bin/grep -rn -F
'_plat_mv_notdir' ccd/ccd ccd/ccrc`, then read each hit's enclosing function to exclude the definition
and comment lines): **eight executable call sites**, five in `ccd/ccd` (`_svc_write_session_plist`,
`_reg_set`, `_lc_err`, `cmd_project_pool`, `cmd_supervise`) and three in `ccd/ccrc`
(`_svc_write_session_plist`, `_acct_mark_off`, `_acct_rehome`). **Six of the eight** write outside the
canonical `$REG/<id>.<field>` shape; only `_reg_set` and `_acct_rehome` write it. The conclusion survives
unchanged, but not for the reason first written here: every directory that sits at one of the eight
destinations exists BEFORE `_plat_mv_notdir` is ever called — `ccd-project-pool.test.ts` mkdirSyncs
`POOLS()/demo` and `ccd-hold.test.ts` mkdirSyncs `$REG/<id>.hold` before either test drives the call, two
of the eight — so the refusal guard's `[ -d ]` arm sees the directory and returns 1; the race this
paragraph is about is a directory appearing INSIDE the window between the test and the rename, which is
not what any of the eight call sites, or these two fixtures, does. A measured fact about today's call
sites, not a guarantee about future ones — the argument that proves the conclusion does not survive
unchanged, which is the misattribution class this entry is itself an instance of — a wave
(`account-pools` wave 2a, which added `cmd_project_pool`) added a call site and left the quantifier
standing, and this plan then quoted only half the file split.

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

### Part C's row protocol — a D-71 RECURRENCE, no new number
`_check_models`' batched `node -e` reader emitted its five-column row (`id`, status, `fetchedAt`,
`stale`, `lastError`) tab-delimited, and the bash side read it with `IFS=$'\t' read -r`. **This is D-71's
class, cited here and not minted again**: D-71's general form (defined 2026-08-15, restated twice
since) is *"any tab-delimited record with possibly-empty fields must not use `read` with `IFS` alone"* —
bash treats a tab as IFS *whitespace* regardless of what `IFS` is set to, so a run of empty fields
collapses and every later column shifts left. Measured directly, exactly as the finding reproduced it —
given here as a here-string, not a pipeline, because the last stage of a pipeline runs in a subshell, so
`read`'s assignments there never reach the parent's `echo`. Both lines below were run verbatim and
reproduce exactly as printed:

    IFS=$'\t'   read -r a b c d e <<< "$(printf 'id\tOK\t\t0\t')"        -> c=[0] d=[]  e=[]

Fixed by moving the whole row protocol, on **both** the node emitter and the bash reader, from `\t` to
`\x1f` (ASCII unit separator) — not classified as IFS whitespace, so a run of empty fields survives
intact:

    IFS=$'\x1f' read -r a b c d e <<< "$(printf 'id\x1fOK\x1f\x1f0\x1f')" -> c=[]  d=[0] e=[]

**One improvement claimed explicitly, against D-71 itself:** D-71's own stated remedy was *"split the
fields by hand"* — parse the joined string in code rather than trust `read`. Moving the protocol to a
non-whitespace delimiter is better than that remedy: it preserves empty fields **natively**, at the
wire, so nothing downstream has to remember to re-split by hand at every call site that reads this shape
in the future. That is a new remedy recorded against D-71, not a new deviation.

**Disclosed in the same paragraph, per the coordinator's own audit: D-71's rule is stated six times in
this repo's prose and violated thirteen times in code — 13 sites total, NINE safe, FOUR reachable call
sites across THREE findings (the two `ccd/ccd` sites below are one finding, not two — 9 + 4 = 13).**
Their anchors
are not ours: they measured the population at `origin/main 03ecda65`, and this branch is behind that ref
and has added lines of its own, so every site below was **re-measured in this tree by symbol**, not
transcribed:
- `_check_accounts` in `ccd/ccrc-doctor-checks` — **reachable**. Its producer is
  `deploy/account-op.mjs`'s `opDoctor`, whose own docstring says in capitals that it does **not**
  validate the roster; an id-less account therefore emits a row with an empty middle field, and the
  collapse above is live for it. The comment claiming every field this reader gets is "non-empty by
  construction (a code, an id, a sentence, or a number)" is false for exactly that reason — corrected as
  its own clause, not this code, alongside this wave's source-side changes.
- `_check_routing` in `ccd/ccrc-doctor-checks` — **reachable**. An empty `CCRC_ANTHROPIC_BACKEND`
  element shifts the row so the `[ -n "$a" ] || continue` guard can never fire for the case it exists to
  catch — D-71's **original signature**, *"the no-id guard was dead code that could never fire"*, showing
  up a second time in the same file.
- Two sites in `ccd/ccd` — **reachable, not fixed, not this wave's.**
**The coordinator's own conclusion, recorded rather than re-argued:** a rule stated six times in prose
and violated thirteen times in code is a **missing mechanism**, not a knowledge-transfer failure — D-71
has never had a red suite of its own. Two cousins outside the idiom, named so they are not lost: one
site splits on a SPACE over `tmux list-panes` output where a session name may itself contain one; one
uses awk's default field separator over a TAB record, so `length($1)` measures only to the first space —
and that length is a load-bearing sort key.

### D-2376 — D-2347 is one of twelve, and the sweep that found them also found a class that must not be swept
Looking for D-2347's siblings with two independent censuses (a `-r` census and a "read by name" census,
each run under `/bin/grep -F` because `/usr/bin/grep` here is ugrep) returned **twelve open sites** of
the read-by-name-after-a-permissive-guard class in `ccd/ccd`, listed in Part D. **That total does not survive re-counting the list it points at — see D-2475**, which measured the class by symbol on `origin/main` and corrected the headline and the mutation table; the per-group findings below stand, it is only the sum that was wrong. The method validated
itself: it independently re-found all three sites the #69 round-3 fix closed (`_reg_get`,
`_auto_swap_check`'s `$sf`, `_auto_compact_check`'s `$sf`) and classified them correctly as fixed, and
re-found `_transcript_stalled_pair` as open.
**Two of the twelve are worse than the one that was reported.** `source "$CCRC_ACCOUNTS_SH"` (D-2377) is
on the module top level, and the hold family (D-2378) contains a state no ccd verb can leave.
**The finding behind the finding:** D-2347 was filed as one function's missing `-f`. It is the visible
instance of a class this repo has already closed three times, each time at the site that was reported.
`correcting-the-instance-is-not-correcting-the-claim`, at file scale.
A SECOND class surfaced and is deliberately NOT booked as work: ~18 functions whose guarded arms end in
an unmeasured fallback at the same exit status. **Most are deliberate** — `_home_for` is D-1986 with
`_home_measured` as its measured sibling, `_transcript_path`'s rung 4 is specified verbatim by
`docs/superpowers/specs/2026-08-12-swap-transcript-defect-family-design.md` §2.5. It is recorded as a
QUESTION: each candidate needs adjudicating against its governing document before anyone calls it a
defect. **The coordinator got this wrong first** — see D-2381.

**D8 — the four remaining sites this wave disclosed rather than fixed.** Navigate by symbol; every line
anchor this plan carried for them has drifted. Two corrections to this entry's own framing, measured by
the census that finished this wave: **the plan calls all four "the same class (a path opened BY NAME
after a permissive guard)" — that is wrong.** Three of the four have **no guard on the path at all**
(`cmd_ws_add`'s `mkdir -p` guards the *directory*, not the file it later reads); the fourth's only guard
is `[ "$CCD_OS" = darwin ]`, a platform predicate, not a filesystem test. What the four actually share is
the weaker and more alarming property of an **unguarded** open-by-name, not a permissive one.
1. `_ws_archive_manifest`'s `prhistory` open — unguarded; not fixed this wave.
2. `_attic_project`'s `sed` — unguarded; not fixed this wave.
3. `cmd_ws_add`'s three `grep`s of `info/exclude` — the `mkdir -p` guards the directory only, never the
   file itself; not fixed this wave.
4. `cmd_supervise`'s darwin start-limit arm — guarded only by `[ "$CCD_OS" = darwin ]`, dead on this
   Linux fleet; not fixed this wave.
For `_ws_archive_manifest` specifically, the plan's own framing is also wrong the other way: its
DIRECTORY arm is already correct and argued in the source (`IsADirectoryError` ⊂ `OSError` →
`SystemExit(3)` → refusal), so that shape is not a gap. The live hazard at all three unguarded sites
(1–3) is FIFO / character-device only, and it is a **HANG with no exit code** — which is exactly why the
`2>/dev/null` and `|| fallback` arms already sitting near each of them give no protection whatsoever;
those arms only ever run once the process returns, and a hang never returns. Reason all four stay open:
D1–D5 were ordered by blast radius and D-2925 was the one new site the sweep also found; these four were
not cheap to fold in alongside them and remain named here rather than dropped.

### D-2377 — the account roster is sourced by name after `-e` and `-r`, on the module top level
`ccd/ccd:1081-1090`. `[[ -e ]]` then `[[ -r ]]` then `source "$CCRC_ACCOUNTS_SH"`. Neither test is false
for a FIFO or for a character device, and `source` opens by name: `open(2)` blocks for ever on a FIFO
with no writer. This is not inside a verb — it runs when the file is sourced, so **every `ccd` process on
the box** reaches it: ~20 `ccd supervise` units at startup and at every systemd restart, every `ccd` the
agent shells out under the exec whitelist (hence every PWA tap), every terminal invocation. The two
`die` sentences immediately above it are the proof that this ladder's author intended to refuse rather
than hang; the ladder is simply missing the arm for a file that is present, readable, and not a file.

**D7 mutation table (one site):**

| site | command | before (guard reverted / pre-fix) | after restore (guard present / post-fix) |
|---|---|---|---|
| `source "$CCRC_ACCOUNTS_SH"`, module top level | `vitest run test/ccd-bounded-reads.test.ts -t D1` | **RED** — FIFO / symlink-to-FIFO / symlink-to-`/dev/zero` each `Error: runBounded("true") did not return within 5000ms — this is a hang regressing, not a flake`; the directory shape answered promptly but with the wrong diagnosis (`AssertionError: expected '… is a directory' to contain 'not a regular file'`) | **GREEN** — `Tests 6 passed \| 25 skipped (31)`, all three hang shapes now refuse promptly with the new arm's `die` sentence and the directory shape now names the right cause |

Restored from a copy kept outside the repo (never `git checkout --`), per the finish brief.

### D-2378 — the hold family: five `-e` gates whose refusal STRING is read by name, and one of them is a trap
`cmd_ws_rm` (4975), `cmd_ws_rename` (5360), `cmd_ws_release` (6000), `cmd_ws_reap` (10403), `cmd_forget`
(16697). The `-e` is correct and deliberate (ccd:10400: *"`-e` not `-f`: an unreadable-but-present hold
still refuses — the fail-shut polarity is that doubt reads as HELD"*) — the defect is the `cat` that
builds the refusal text on the next line. **`cmd_ws_release` turns it into a state with no exit:** its
`rm -f -- "$REG/$id.hold"` is one line BELOW its `cat`, so the verb that exists to clear a hold is
blocked by the hold, and `ws-rm`, `ws-reap`, `ws-rename` and `forget` are all blocked by the same file.
The comment above `cmd_ws_release`'s arm measured `chmod 500 "$REG"` and `mkdir "$REG/$id.hold"` — it
reasoned about EACCES and EISDIR explicitly — and never reached the shape where `cat` does not return.
The `|| echo '<unreadable — treat as held>'` fallbacks at four of the five sites are DEAD for this input
and become live with the fix.

**D7 mutation table (five sites, all `-t D2`, each FIFO / symlink-to-FIFO / symlink-to-`/dev/zero`):**

| site | before (guard reverted / pre-fix) | after restore (guard present / post-fix) |
|---|---|---|
| `cmd_ws_rm` | **RED** — 3/3 shapes: `Error: runBounded("cmd_ws_rm demo-quiet-basin") did not return within 5000ms — this is a hang regressing, not a flake` | **GREEN** — answers `held: <unreadable — treat as held>` promptly |
| `cmd_ws_rename` | **RED** — 3/3 shapes, same hang shape | **GREEN** — answers `{"refused":"held",…}` with the marker, promptly |
| `cmd_ws_reap` | **RED** — 3/3 shapes, same hang shape | **GREEN** — same marker, promptly |
| `cmd_forget` | **RED** — 3/3 shapes, same hang shape | **GREEN** — same marker, promptly |
| `cmd_ws_release` (reversed polarity — deletes the hold, so a distinct marker, no `|| echo`) | **RED** — 3/3 shapes, same hang shape | **GREEN** — new marker `<unreadable — hold present but could not be read at release>`. **Mutation-proven positive, not just green-by-default**: the fix round 1 re-run of `_hold_reason=''` against the fixed test now REDS on all 3 shapes (`AssertionError: expected undefined to be '<unreadable — hold present but could not be read at release>'`) — the pin the controller's ruling actually decided is now refused, closing the class-defining green-mutation finding of this wave (Ruling 15) |

15/15 hang failures measured before the fixes (5 sites × 3 shapes); **31/31 green** in the combined
D1–D4 run once all four D7-owning sites were fixed together (`Tests 31 passed (31)`, 7.15s), later
re-confirmed at **33/33** once D-2380's fourth opener (below) was also added.
`cmd_ws_release`'s directory shape is deliberately NOT one of these cases — it surfaced a real,
pre-existing, out-of-scope defect (`rm -f` has no `-r`, so a directory there fails `Is a directory` and
the verb dies "STILL held" regardless of this fix) that is not the bounded-read defect D2 owns; disclosed
in `partD-report.md`, not fixed here.

### D-2379 — `_ws_status` is the one unguarded reader of four, and it gates the destructive verbs
The census of `<cfg>/sessions/<pid>.json` readers in `ccd/ccd` is four. Three carry a type test:
`_sync_uuid` (12216, `-f`), `_auto_swap_check` (13410, `-f` — added by **#69 review round 3**),
`_auto_compact_check` (13590, a three-rung ladder that also reports WHICH shape it refused).
`_ws_status` (3112) has **none**: `sf="$cfg/sessions/$pid.json"` then `grep -oE … "$sf"`, opened by name.
Its callers are `cmd_ws_archive` (`|| die "status-unknown"`), `_ws_reap_eval` and `cmd_ws_reap`. Our own
round hardened its sibling on the same path family and left this one; that is the instance-not-the-claim
failure inside the fix for the same class.

**D7 mutation table (one site):**

| site | command | before (guard reverted / pre-fix) | after restore (guard present / post-fix) |
|---|---|---|---|
| `_ws_status` | `vitest run test/ccd-bounded-reads.test.ts -t D3` | **RED** — 3/3 shapes (FIFO / symlink-to-FIFO / symlink-to-`/dev/zero`): `FAIL … answers non-zero ("cannot be read"), PROMPTLY — never hangs, for a FIFO sessions JSON`, then `Error: runBounded("… _ws_status demo") did not return within 5000ms — this is a hang regressing, not a flake` | **GREEN** — D3 block 5/5 green (3 fixed shapes plus the idle/busy regression pins), no hangs |

### D-2380 — the same class in Python, where the `except` clause is dead
**Cardinal corrected in place (the D-2475 shape) — the conclusion survives, only the count was wrong.**
`_pr_py`'s `state` mode opens **FOUR** paths by name with no type test, not two: `get()`
(`open(os.path.join(reg, id_ + '.' + field))`, called three times per session), the compare-and-set lock
(`open(..., 'a')`, which blocks until a READER appears), the prhistory append (`open(hist_p, 'a')`, the
third opener — undercounted by the same staleness, worker clause 6), and `put()`'s own tmp-file open
(`open(tmp, 'w')`, the fourth, found during the fix round that followed — extending this same subject a
second time, per the coordinator's ruling that a stale cardinal under an already-issued number is that
number going stale). **`except FileNotFoundError` and `except OSError` cannot fire for this input** —
`open()` itself blocks, so the handler is never reached, for all four. Reached from `cmd_pr_state`'s
per-id loop, so one poisoned `$REG/<id>.<field>` hangs the whole sweep rather than one row. The comment
block enumerating this open's outcomes for an existing lock file, a first-ever lock file and an unwritable
`$REG` reasons about every branch where `open` RETURNS, and none where it does not.

**D7 mutation table (four sites, `-t D4`):**

| site | before (guard reverted / pre-fix) | after restore (guard present / post-fix) |
|---|---|---|
| `get()` (backs `prcheckedat`/`prnumber`/`prphase`) | **RED** — `FAIL … a FIFO at $REG/<id>.prcheckedat is treated as absent, PROMPTLY — never hangs the sweep`, then `Error: runBounded("…cmd_pr_state --session demo-quiet-basin") did not return within 5000ms — this is a hang regressing, not a flake` | **GREEN** — passes; the FIFO is provably gone afterward, replaced by `put`'s atomic tmp+`os.replace` |
| the compare-and-set lock | **RED** — same hang shape | **GREEN** — passes; `$REG/<id>.prnumber` is written (`591`), proving the write went through unlocked |
| the prhistory append | **RED** — same hang shape | **GREEN**, but as a **FAULT not a silent pass**: `Traceback … OSError: refusing to append to a non-regular-file prhistory: …` — non-zero exit, deliberate, because this open sits inside the outer `try` whose only handler is the `finally` that releases the lock |
| `put()`'s own tmp-file open (the fourth, added when fix round 1 found it) | **RED** — `Error: runBounded(...) did not return within 5000ms — this is a hang regressing, not a flake`, reproduced with a `python3` shim that preserves the real interpreter's pid (`exec`, never forks) so the FIFO could be planted at the exact tmp path ahead of time | **GREEN** — `OSError: refusing to write a non-regular-file pr-state tmp: .../.demo-quiet-basin.prcheckedat.<realpid>.tmp`, the real pid proving the shim lined up with the guard |

Full D4 run (first three sites): `Tests 4 passed | 27 skipped (31)` (three fixes plus one regression
pin). Re-confirmed **33/33** once the fourth opener's guard and case were added (fix round 2).

### D-2381 — the spec calls three consumers durable; one of them is not
**WITHDRAWN, the half this entry opened with.** It booked D-2347's false *"behaviour-identical for every
input that answers today"* clause as a finding of mine. **The worker found the identical row
independently and corrected D-2347 in place, in PR #78** — by the same method, extracting the function
and driving it under `timeout 5` — and D-2347 is their number to correct. Two independent measurements
produced the same table, which is why it is recorded here as CORROBORATION and not as a second finding:
this program's own precedent is D-1742, *a finding closed twice on measurements nobody took is still ONE
finding*. Their entry also declines to cite this plan's number, correctly: a `D-` ref in tracked prose
seeds this project's ledger floor whether or not the number was issued to that plan, and
`deviation-refs.test.ts` refuses it. The measurement, kept because Part D's D5 is written against it:

| input | before | after `[[ -f "$f" && -r "$f" ]]` |
|---|---|---|
| a real stall (positive path) | 0 | 0 |
| regular file, not a stall | 1 | 1 |
| absent | 2 | 2 |
| FIFO | **HANG** (rc 124) | 2 |
| character device (`/dev/zero`) | **HANG** | 2 |
| **directory** | **1** | **2** |

**Wave verification, not a wave fix — D5's class has two byte-identical twins, both re-mutated this
wave.** D5 itself (`_transcript_stalled_pair`) was already landed by PR #78 before this wave started, so
the table above is history, kept because D5 is written against it. What this wave DID measure is whether
the twin function carries the identical guard and whether either has drifted unpinned since:
restoring each to `[[ -r "$f" ]]` alone (dropping `-f`) —
- `_transcript_stalled_pair` (def, guarded call site) — **RED**, 2 cases via `ccd-limit-banner.test.ts`:
  the directory case (`expected 'rc=1' to be 'rc=2'`) and the FIFO case (`expected 'rc=142' to be
  'rc=2'`, the inner `alarm 5` firing).
- `_transcript_limit_banner` (the twin) — **RED**, 1 case: the FIFO case only (`rc=142` again) — a
  directory there is refused by `tail`'s own return code, not by this type test, which is a pre-existing
  citation defect in the test's own title, not a gap in the guard.
Neither twin came back green under mutation — both pins are live. Restored, `git status` clean,
confirmed against the pre-mutation baseline (`ccd-limit-banner.test.ts` full run green, 69/69). **Both
rows are VERIFICATIONS of an already-landed fix and do not count toward D7's per-site total** — if either
had come back green, that would have been a live finding of exactly the class this Part exists to close;
neither did.

A directory ANSWERS today, and it answers 1 — "measured, and not a stall" — because `tail` on a directory
writes to stderr and emits nothing, so the loop reads zero lines and the function reports a status quo it
never observed. The change is correcting, but it IS a change. `ccd-redrive.test.ts` 30/30 after the fix;
`ccd-resume-flag` + `transcript-ladder` + `ccd-project-pool` 106/106.

**THE FINDING THIS ENTRY NOW CARRIES: `2026-08-12-swap-transcript-defect-family-design.md` §2.5 calls
three consumers durable; one is not.** It reads *"Its three consumers are `_ws_archive_manifest`, `cmd_ws_audit` and `_ws_tombstone`: the
durable records written when a workspace is archived, audited and reaped."* `_ws_archive_manifest` is
durable (persisted by `_reg_set "$id" archivemanifest`) and `_ws_tombstone` is durable
(`$REG/.reaped/<id>.json`), but `cmd_ws_audit` emits to **stdout only** and its own header says it
*"destroys nothing and creates nothing that outlives it — no worktree, no branch, no registry field, no
tombstone."* Two durable consumers, one ephemeral, one opener.
**The coordinator repeated this error from the spec into mail 427 and into the program ledger**, and
separately ruled that D-2347's fix "belongs upstream at `_transcript_path`'s unmeasured fallback" — which
§2.5 specifies verbatim, including the contract *"print one path, return non-zero only when the registry
cannot answer."* Three independent refuters killed that reading 3/3. Recorded here because the ruling was
mailed to the worker as a direction, and a direction withdrawn only in conversation is still standing in
the plan a worker reads.
### D-2475 — the twelve-site cardinal is unreachable from the sites this part enumerates
**A cardinal in a plan headline is a claim about a list, and it goes stale the moment the list is edited.**
Part D's opening sentence and D7's mutation table both asserted **twelve** guard sites. Counting what the
part actually enumerates: D1 is one site, D2 five, D3 one, D4 two and D5 one — **ten mandatory** — and D8
then names four further groups (`_ws_archive_manifest`'s `prhistory` open, `_attic_project`'s `sed`,
`cmd_ws_add`'s three `grep`s of `info/exclude`, and `cmd_supervise`'s darwin start-limit arm), of which D8
itself makes the first two conditional on D1-D5 landing cheaply and the last is dead on a Linux fleet.
Ten plus four is fourteen; ten plus the two conditional ones is twelve only if a reader silently picks
which two, and the document never says. **Measured on `origin/main` 2026-09-10**, by symbol rather than by
this part's drifted line numbers: `[[ -e "$REG/$id.hold" ]]` returns **six** gates, of which exactly
**five** are followed by a `cat` of that path — the sixth (`_auto_swap_check`) reads nothing after its gate
and is correctly out of class, so D2's five is right and it is the total that is wrong. Every line anchor
in Part D has also drifted: `ccd:1090` still lands on `source "$CCRC_ACCOUNTS_SH"`, but `3112`, `3773`,
`3936`, `4975`, `5360`, `6000`, `6779`, `7120`, `10403`, `14316`, `14970` and `16697` now land on comment
text or unrelated code. The fix is the rule this repo already minted for census claims (D-2459): **a
derived guard must discover its population.** The headline no longer quotes a number and D7 now takes one
row per site the worker's own census returns. **A plan may name the sites it found; the moment it also
totals them, it has planted a fact that the next edit falsifies silently.**

- **D-2925** (found during execution; named by no entry in this plan) — **`cmd_project_pool`
  (`ccd/ccd:6775`) proves a project exists through an UNGUARDED glob.** `ccd/ccd:6906` is
  `grep -qxF -- "$project" "$REG"/*.project 2>/dev/null`, and `grep` opens every matched path BY
  NAME: one FIFO or symlink-to-`/dev/zero` among the registry's `.project` rows blocks
  `ccd project-pool --pool` for ever. This is D-2376's FIRST class (read-by-name), not the second
  class Part D must not widen into. The comment above it (`6903-6904`) guards the glob against
  leaving its own literal text on an EMPTY registry — a diagnostic, not a type — so the shape was
  never reached. `/bin/grep -n '\*\.project'` returns this line and no other, and the same file has
  measured FIFOs at `.project` three times in other readers (`13934`, `17529`, `17822`), all of which
  go through `_reg_read` or `_project_pool_state`. **Fix:** the shape Part D transcribes
  (`_project_pool_state`, `ccd/ccd:1470`) — loop the glob and skip any entry failing
  `[[ -f "$f" && -r "$f" ]]`. Behaviour-identical for every input that answers today, because an
  unreadable row already contributes nothing through `2>/dev/null`. **Costs if wrong:** one helper and
  one call site, both reverted by deleting the commit.

[**Anchors note (added post-commit, definition above left byte-for-byte):** every line anchor in the
D-2925 paragraph above was measured before this wave's own later commits moved them; navigate by
symbol instead — `cmd_project_pool`, the guard's new home (the fix extracted it into its own helper,
`_reg_project_glob_has`), and `_project_pool_state`. Separately, noted here rather than fixed (this
commit's scope is this plan file only, not `ccd/ccd`/`ccd/ccrc`): the shipped header comment
immediately above `_plat_mv_notdir` in both files says the `ln -s` census found "one plants a symlink
AT that exact path, `ccd-crosspool.test.ts`'s `devzero-symlink` case" — measured, that file plants a
symlink at a `$REG/<id>.<field>`-shaped path in more than one place, so the comment should read "at
least one, e.g." rather than naming a single instance.]

**D7 mutation table (one site, landed this wave as `_reg_project_glob_has`):**

| site | command | before (guard reverted / pre-fix) | after restore (guard present / post-fix) |
|---|---|---|---|
| `cmd_project_pool`'s `--pool` arm, via `_reg_project_glob_has` | `vitest run test/ccd-bounded-reads.test.ts -t D5` | **RED** — measured independently in this session: reverted the guard to the original unguarded `grep -qxF -- "$project" "$REG"/*.project 2>/dev/null` (backup kept outside the repo, never `git checkout --`); `Tests 3 failed \| 1 passed \| 33 skipped (37)`, all three hang shapes (FIFO / symlink-to-FIFO / symlink-to-`/dev/zero`, sorted BEFORE the real row) timing out — `Error: runBounded("cmd_project_pool --project quiet-basin --pool pool-a") did not return within 5000ms — this is a hang regressing, not a flake` | **GREEN** — restored from the pre-mutation copy (md5 verified identical, `git diff --stat -- ccd/ccd` empty), re-ran: `Tests 4 passed \| 33 skipped (37)` |
