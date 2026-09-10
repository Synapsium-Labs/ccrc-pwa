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
`ccd/ccrc-doctor-checks` only. **Part D touches `ccd/ccd` only, at twelve guard sites, one line each.**
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

- [ ] **D1. `source "$CCRC_ACCOUNTS_SH"` (ccd:1090) — the module top level (D-2377).** Guards are `-e`
      (1081) and `-r` (1083); both are true for a FIFO and for a character device, and `source` opens by
      name. **This runs in every `ccd` process on the box** — each `ccd supervise` unit at startup and at
      every restart, every `ccd` the agent shells out under the exec whitelist (so every PWA tap), every
      terminal invocation. Add `-f` to the existing ladder as its own arm with its own `die` sentence, so
      the operator is told the roster is not a regular file rather than told nothing for ever. The
      existing comment reasons carefully about a DANGLING symlink and never reaches this shape.
- [ ] **D2. The hold family — five sites, one shape (D-2378).** `cmd_ws_rm` (4975), `cmd_ws_rename`
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
- [ ] **D3. `_ws_status` (ccd:3112) — one unguarded reader of four (D-2379).** The census of
      `<cfg>/sessions/<pid>.json` readers is four: `_sync_uuid` (12216, `-f`), `_auto_swap_check` (13410,
      `-f`, added by #69 round 3), `_auto_compact_check` (13590, a three-rung ladder that also names
      WHICH shape it refused) — and `_ws_status`, which has **no type test at all** before
      `grep -oE … "$sf"`. Its callers are `cmd_ws_archive` (`st=$(_ws_status "$id") || die
      "status-unknown"`), `_ws_reap_eval` and `cmd_ws_reap` — destructive-verb gates. This is the
      instance our own round left behind when it fixed its sibling, and it is the reason this part exists
      as a class sweep rather than a one-line fix.
- [ ] **D4. `_pr_py`'s two Python opens (ccd:3773 get(), ccd:3936 lock) (D-2380).** Same class, other
      language, and the language makes it worse: `except FileNotFoundError` (3773) and `except OSError`
      (3938) are **dead code for this input**, because `open()` itself blocks and the except never runs.
      3936 opens `'a'`, which blocks until a READER appears. Reached from `cmd_pr_state`'s per-id loop,
      so one poisoned registry field hangs the whole PR-state sweep. Guard with `os.path.isfile` (or
      `stat.S_ISREG`) before each open, and say so where the comment block at 3888-3907 enumerates this
      open's outcomes — it reasons about every branch where `open` RETURNS and none where it does not.
- [ ] **D5. `_transcript_stalled_pair` (ccd:14316) — D-2347, the one that started this.** One line:
      `[[ -r "$f" ]]` becomes `[[ -f "$f" && -r "$f" ]]`. **Measured end to end on a clean worktree cut
      from `origin/main` at `24f32a18`** — mutation table in D-2381 below.
- [ ] **D6. The red-first cases, before any of D1–D5.** Follow `ccd-project-pool.test.ts`: a bounded
      helper plus FIFO, symlink-to-FIFO, symlink-to-`/dev/zero` and directory cases per site, each
      double-bounded (helper bound AND a vitest per-test timeout). **A red that hangs is not a red** — it
      is a CI timeout, and on a load-sensitive suite it burns the whole run. Measure every case RED
      first; a case that is green before the fix is pinning nothing.
- [ ] **D7. Mutation table.** Per site: revert the guard, measure that site's case RED, restore, measure
      green. Twelve rows. Do not batch — a single table entry covering "the class" cannot tell which of
      twelve guards is unpinned.
- [ ] **D8. The remaining sites, DISCLOSED not silently dropped.** The sweep also named
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

### D-2376 — D-2347 is one of twelve, and the sweep that found them also found a class that must not be swept
Looking for D-2347's siblings with two independent censuses (a `-r` census and a "read by name" census,
each run under `/bin/grep -F` because `/usr/bin/grep` here is ugrep) returned **twelve open sites** of
the read-by-name-after-a-permissive-guard class in `ccd/ccd`, listed in Part D. The method validated
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

### D-2377 — the account roster is sourced by name after `-e` and `-r`, on the module top level
`ccd/ccd:1081-1090`. `[[ -e ]]` then `[[ -r ]]` then `source "$CCRC_ACCOUNTS_SH"`. Neither test is false
for a FIFO or for a character device, and `source` opens by name: `open(2)` blocks for ever on a FIFO
with no writer. This is not inside a verb — it runs when the file is sourced, so **every `ccd` process on
the box** reaches it: ~20 `ccd supervise` units at startup and at every systemd restart, every `ccd` the
agent shells out under the exec whitelist (hence every PWA tap), every terminal invocation. The two
`die` sentences immediately above it are the proof that this ladder's author intended to refuse rather
than hang; the ladder is simply missing the arm for a file that is present, readable, and not a file.

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

### D-2379 — `_ws_status` is the one unguarded reader of four, and it gates the destructive verbs
The census of `<cfg>/sessions/<pid>.json` readers in `ccd/ccd` is four. Three carry a type test:
`_sync_uuid` (12216, `-f`), `_auto_swap_check` (13410, `-f` — added by **#69 review round 3**),
`_auto_compact_check` (13590, a three-rung ladder that also reports WHICH shape it refused).
`_ws_status` (3112) has **none**: `sf="$cfg/sessions/$pid.json"` then `grep -oE … "$sf"`, opened by name.
Its callers are `cmd_ws_archive` (`|| die "status-unknown"`), `_ws_reap_eval` and `cmd_ws_reap`. Our own
round hardened its sibling on the same path family and left this one; that is the instance-not-the-claim
failure inside the fix for the same class.

### D-2380 — the same class in Python, where the `except` clause is dead
`_pr_py`'s `state` mode opens two paths by name with no type test: `get()` at 3773
(`open(os.path.join(reg, id_ + '.' + field))`, called three times per session) and the lock at 3936
(`open(..., 'a')`, which blocks until a READER appears). **`except FileNotFoundError` (3773) and
`except OSError` (3938) cannot fire for this input** — `open()` itself blocks, so the handler is never
reached. Reached from `cmd_pr_state`'s per-id loop, so one poisoned `$REG/<id>.<field>` hangs the whole
sweep rather than one row. The 20-line comment at 3888-3907 enumerates this open's outcomes for an
existing lock file, a first-ever lock file and an unwritable `$REG` — every branch where `open` RETURNS,
and none where it does not.

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
