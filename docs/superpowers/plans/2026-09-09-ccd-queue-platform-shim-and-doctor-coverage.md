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
**TWELVE TRACKED FILES OUTSIDE `ccd/` ARE EDITED on this branch, not two** (measured at the FINAL tree
with `git diff --name-only origin/main HEAD | grep -v '^ccd/'` — a two-dot diff is exact here, and only
here, because the merge made `origin/main` an ancestor of `HEAD`, checked with `git merge-base
--is-ancestor` rather than assumed): `CLAUDE.md`; `README.md`; this plan itself
(`docs/superpowers/plans/2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md`);
`docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`;
`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`; and seven `server/test/`
suites — `ccd-bounded-reads.test.ts`, `ccd-crosspool.test.ts`, `ccd-reg-set-atomic.test.ts`,
`ccrc-doctor.test.ts`, `macos-platform.test.ts`, `session-hook.test.ts`, `single-definition.test.ts`.
**THIS NUMBER WAS ELEVEN FOR MOST OF THIS ROUND, AND THE REASON IS WORTH KEEPING.** Measured mid-round,
`README.md` was byte-identical to `origin/main` and so was genuinely NOT in the diff — the merge had
resolved its one conflicting line to main's side, deliberately, pending re-derivation. The mid-round
measurement recorded that absence and guessed at a cause ("predates the merge base, or was reconciled
away"); the real cause was this round's own merge resolution, three commits earlier. The anchor was
then re-located BY CONTENT on the final tree, `README.md` re-entered the diff, and eleven became
twelve. A cardinal measured before the last commit that can change it is not a measurement, it is a
forecast — which is D-2990's whole subject, reproduced inside the round that states it.
(1) `README.md` — one line-anchor repair, AUTHORISED by the
coordinator during this wave ("README's `ccd/ccd:16330-16332`, repaired rather than bumped"); it cites
`  elif (( genrc == 1 )); then`, and the repair was re-measured at the shipping tree because an
earlier commit moved the referent after the first measurement. (2) `CLAUDE.md` — the `ccd-bounded-reads`
D4 flake note, corrected from the family default to the bound this wave actually shipped. That edit was
UNILATERAL AND UNDECLARED when it was made; the coordinator has since ruled ACCEPT-AND-DECLARE, and was
explicit that they would have said yes if asked and that **the defect was the silence, not the edit**.
It is kept because the content is measured accurate and `CLAUDE.md` is loaded by every session and
subagent on this fleet, so leaving it stale ships a known-false claim into the most-read file in the
repository.
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

**B6 mutation table (F5, review run 69 — this table existed only in a commit message; `.superpowers/`
is gitignored, so the plan is the durable home, exactly as Part A's own paragraph argues).
RE-MEASURED at this tree rather than transcribed from that message.** Mutant: delete
`ccrc-models.timer` from the `known` array in `ccd/ccrc-doctor-checks` (restored from a copy kept
outside the repo, never `git checkout --`; byte-identity confirmed after restore). Suite:
`vitest run test/ccrc-doctor.test.ts -t 'services knows about the models catalogue timer'`.

| case | mutated | restored |
|---|---|---|
| `names it in the PASS line when it is installed and running` | **RED** — `expected 'PASS services: ccrc.service is active…' to contain 'ccrc-models.timer is active'` | GREEN |
| `warns — with its OWN consequence — when the models timer is installed and stopped` | **RED** | GREEN |
| `a box without the unit is never asked about it — no count moves` | GREEN | GREEN |

`Tests 2 failed | 1 passed | 418 skipped (421)` mutated; `3 passed | 418 skipped` restored. The third
case stays green BY DESIGN and is not a hole: it asserts that an ABSENT unit moves no count, which does
not depend on the unit's membership in `known` — it is the negative control for the other two, not a
pin of the addition.

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

**FIVE DEGENERATE-ENVIRONMENT ARMS OF `_check_models` HAVE NO TEST TEXT — disclosed, not expanded
(F16, review run 69; the coordinator ruled DISCLOSE ONLY).** Each is a distinct operator-facing verdict
with no case, measured by census: each arm's own sentence returns ZERO hits in `ccrc-doctor.test.ts`.
They are the roster-unreadable SKIP, the node-missing FAIL, the roster-unparseable SKIP, the
no-declared-id SKIP, and the WARN for a box whose `date` cannot answer `+%s`. All five are
degenerate-ENVIRONMENT arms — they fire only when something the check depends on is itself broken —
which is why they are recorded here rather than covered: writing five fixtures for them is a scope
widening this wave declined, and a reader is owed the list either way. Nothing about them is
conditional on this round's work; they were absent when C6 was first ticked and they are absent now.

**C6 mutation table — ONE ROW PER BEHAVIOUR CHANGE (F3 + F5, review run 69, enforcing the coordinator's
binding ruling that Part C must not close without one).** The two C4 arms above were measured when C6 was
ticked, but only in a comment pointing at a gitignored artifact; and THREE further behaviour changes
shipped with no row at all, two of which the reviewer measured GREEN under mutation — i.e. unpinned, in
code this wave wrote. All rows below are measured at THIS tree against
`vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: models'` (baseline **24 passed | 397 skipped**),
each mutant restored from a copy kept outside the repo and byte-compared after restore.

| # | mutant | result | verdict |
|---|---|---|---|
| C-M1 | revert the `0x1F` field delimiter to a TAB in **BOTH** halves (`local -r US=$'\x1f'` and the node twin `const US`) | **2 RED** — `an OK row with an ABSENT fetchedAt keeps its columns` and `a FLOAT fetchedAt is refused` | **PINNED** this round |
| C-M2 | drop `Number.isInteger` from the `fetchedAt` screen | 24 passed — **GREEN** | **EQUIVALENT**, with a control — see below |
| C-M2c | *control for C-M2*: drop the BASH re-validation `[[ "$fa" =~ ^-?[0-9]+$ ]]` instead | **1 RED** — `R1-5: a non-integer fetchedAt … never a bash arithmetic crash` | the bash regex is the gate that decides |
| C-M3 | drop the `lastError` sanitiser `.replace(/[\t\n\x1f]/g, " ")` | **1 RED** — `a provider-controlled lastError … cannot invent a lane` | **PINNED** this round |
| C-M4 | remove F2's catalogue type test entirely (the pre-fix bare `readFileSync`) | **3 RED** — two of them as bounded HANGS (`runDoctorBounded did not return within 10000ms`), one as the wrong verdict for a dangling link | **PINNED** this round |
| C-M5 | remove R1's `[ -z "$out" ]` rung | **1 RED** — `the catalogue reader exiting ZERO with no rows is not a PASS either` | **PINNED** this round |

**C-M2 is an EQUIVALENT mutant, not an unpinned one, and C-M2c is why.** `Number.isInteger` can only
reject a NON-INTEGRAL float; every such value crosses the process boundary as a string the bash side
then refuses on its own (`String(1789000000.5)` is `"1789000000.5"`, which that regex rejects;
`1700000000` — an ordinary `fetchedAt` UNIX-seconds value — IS an integer to `Number.isInteger` and
passes both: `String(1700000000)` is `"1700000000"`, which the regex accepts. `1e21` does NOT
illustrate this — `Number.isInteger(1e21)` is `true` but `String(1e21)` is `"1e+21"`, which the same
regex REJECTS, so `1e21` is not a value that "passes both"; the conclusion below still holds, since no
real `fetchedAt` is ever near that magnitude, but that value was the wrong illustration for it). The
node check is belt to the bash braces — which
is exactly what its own shipped comment claims — so removing it changes no reachable verdict. The
control proves the claim rather than asserting it: mutating the mechanism that DOES decide reds a case
immediately. **This is the honest form of a green mutation row:** the row is not evidence of coverage
on its own, and it is not left ambiguous either.

**C6's OWN named deliverable, on its own line (F12's remedy for this identical shape, applied here
too).** C6 is recorded `[x]` above and commit `d59f93d7`'s message lists F5 among the findings it closed
("B6's and C6's tables transcribed into the plan and re-measured rather than copied") — that claim
overclaims: **C6 is HALF closed.** C6's own named deliverable is a mutation-table row per C4 arm ("C6.
Mutation table: stop the clock ... and measure C4's first arm RED; set `stale:true` on a fresh catalogue
and measure the second arm RED"), and neither arm has one. The five-row table above pins the `0x1F`
delimiter, `Number.isInteger`, the `lastError` sanitiser, F2's catalogue type test and R1's rung — none
of those five mutants IS a break of C4's own WARN logic. What DOES exist, measured by grep: ordinary
(non-mutation) behaviour tests for both arms, `server/test/ccrc-doctor.test.ts:6810`
(`WARNS — the silent-timer arm — when stale:false but fetchedAt is older than 3 hours`, its body
commented `// C4's first arm`) and `:6837` (`WARNS — the stale-provider arm — regardless of age, quoting
lastError and the age`, commented `// C4's second arm`). Both assert the current CORRECT behaviour; NEITHER
is paired with a restored mutant proving it catches a regression, so C4's two arms remain exactly where
they were when C6 was first ticked: argued, not mutation-pinned. Landed: the five OTHER C6 rows, newly
row'd this round. Not landed: a mutation row for either of C6's own two named arms — still only the
gitignored-artifact comment this same section already disclosed above.

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
      **NAME COLLISION, resolved (F15, review run 69).** "D5" named two different sites: THIS task
      (`_transcript_stalled_pair`) and, until this round, the shipped suite's own
      `describe('D5 — cmd_project_pool's registry-row existence glob …')`, which is D-2925's site and
      not this one. So `vitest … -t D5` selected the project-pool block, and a reader who trusted this
      task's number would watch the wrong guard go green while believing the transcript pins had been
      measured this wave. The suite's block is renamed to `D-2925 — …`, the D7 table's command below is
      updated with it, and this task's own measurement lives in D-2381.
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
      **TWO MORE LIVE INSTANCES, MEASURED AND DISCLOSED HERE (F8, review run 69) — no new deviation
      number, because D-71 already covers the class and the coordinator refused a second number for it
      once this run.** Both are the wave's own class, in files this wave touched, and until now they were
      named only in a source comment: `ccd/ccrc` sources the account roster with NO `-f`/`-r` rung at all
      at `_inst_dirs` (`:10314`) and `_inst_graph_always_on_off` (`:10646`), while `ccd/ccrc`'s six other
      roster readers do guard it; and `ccd/ccrc-doctor-checks` guards it with `-r` ONLY at THREE sites, not
      two (re-measured — neither of the originally-named two is where this said it was): `:3047` is inside
      `_check_pools`, `:3376` is inside `_check_graphify`, and a third site the enumeration omitted,
      `:4364` (`if [ ! -r "$sh" ]; then`), is inside `_check_routing`, which THIS WAVE edited — the only
      one of the three actually there. `-r` alone admits a FIFO, so
      each hangs on one independently (measured, rc 124). Not fixed here: `ccd/ccrc`'s copy of the
      platform block is byte-pinned to `ccd/ccd`'s, and these sites sit outside D1-D5's enumerated scope,
      so repairing them is a scope widening this wave declined rather than an omission it overlooked.

**What Part D must NOT do:** widen into the SECOND class the sweep turned up — functions whose measured
arms all guard but whose final fallback returns an unmeasured value at the same exit status. That class
has ~18 candidates in this file and **most of them are deliberate and argued** (`_home_for` is D-1986,
and `_home_measured` is already its measured sibling; `_transcript_path`'s rung 4 is specified verbatim
by `2026-08-12-swap-transcript-defect-family-design.md` §2.5). Each needs adjudicating against its own
governing document before it can be called a defect. Booked as a QUESTION in D-2376, not as work.

---

## The citation census this wave broke — disclosed here because nothing else in the repo does

**Ruled by the coordinator, before merge (F6, review run 69).** `server/test/session-hook.test.ts`
carries a census — added by PR #134, D-2849 — that checks every line citation in the compaction-card
documents against the file each one names. **FIVE of its assertions are RED at this branch's tip, not
three** (re-measured at this tree, `HEAD` `33bd6024`: `cd server && ./node_modules/.bin/vitest run
test/session-hook.test.ts` reports `Tests  5 failed | 328 passed (333)`; the five are `THE TWO CORPUS
FACTS the docstring above states, asserted rather than asserted-about`, `THE CITATION DEBT this task
creates is measured, per cited file (Task 11 owns closing it)`, `README HAS ITS OWN CENSUS ENTRY, and it
is EMPTY — every operator anchor resolves (wb2 B-I2)`, `` THE **Files:** LISTS ARE LOCATION INDEXES — the
exact stale set, exemption-free (D-2849) `` and `` THE `|`-ROW PASS: the exact set a joined row still
fails on (round 14, B-M2) ``). This is a reader-of-`main`-after-merge count, at the tip this branch
carries now; it is **100% this wave's own doing**: review run 69 measured it one file at a time, AT THE
TIP REVIEW RUN 69 SAW (an earlier commit than this one — not re-measured by this batch, and not
necessarily still three now that two further assertions have gone red since), and found all three GREEN
at the base `dfa167d7`, RED at that tip, and GREEN again once this branch's `ccd/` scripts,
`README.md` and `CLAUDE.md` are reverted. This is not rot the branch inherited. It is debt the branch
created, in documents the branch does not own — the citing documents are a spec and a plan belonging to
another programme, and every anchor in them shifted because this wave inserted lines into `ccd/ccd`.

**Why it is disclosed HERE.** This plan is the only tracked document this wave owns. The programme
ledger that carries the sizing lives on `ws/amber-summit`, which no PR carries, and the wave-done mail
is not in the repository at all. Without this section a reader of `main` after the merge meets three red
assertions and finds nothing in the tree explaining where they came from.

**The decision, and it is not "absorb".** The three options were prove, repair, or absorb. The
coordinator ruled REPAIR, over every failure instance whose old anchor's bytes are byte-equal to exactly
one block in the file at the tip — the referent provably moved, to one known place, against a FIXED base
that is a direct ancestor and with both citing documents byte-identical between base and tip. Finding
that block is a lookup here, not a judgement. A minority of instances match more than one block
byte-identically; no candidate is offered for those and they are named with their match counts instead.
A further minority will have their anchor repaired and still fail, because their QUOTATION was already
wrong before this wave touched anything — those get the anchor and no prose change, which is the same
line the citing programme's own Task 11 drew.

**Method, and the rule that governs it.** The repair lands as ONE commit, the LAST on this branch,
re-measured against that exact tree — *a citation repair is only valid against the tree it will ship
in*. That rule was learned here the expensive way: this wave's authorised `README.md` repair was
measured at one line, a later commit moved the referent, and the originally-chosen line now holds a
comment. The census's own expected numbers, its `total`, and the comment naming this branch as the cause
land in that same commit.

**This section deliberately carries no cardinal.** Every count involved — the census's per-file
expectations, the number of failure instances, the split between repaired, still-red and unprovable — is
derived from a tree that this fix round is still changing, and a number written here now would be false
by the time it merged. They are written once, in the last commit, measured against the tree they
describe. Where this wave's own measurement and review run 69's disagree on such a count, the
disagreement is reported rather than resolved by picking one.

---

## Deviations found

### D-2989 — a type test on a `$REG` path followed by a read of that path

**THE CLASS IS THE PAIRING, AND THE FIRST NAMING WAS WRONG.** This entry originally named the class by
the FIELD-PATH GRAMMAR, `$REG/<id>.<field>`. That grammar **excludes `$REG/<wrapper>-authdead` by
construction** while the defect there is identical, and it excludes the pools registry, `.reaped/`,
`.lifecycle/`, `usage/` and every glob-expanded row as well. A class named by a spelling cannot contain
a defect that wears a different spelling. The class is:

> a TYPE TEST on **any** path under `$REG`, followed by a **READ of that same path**.

Both halves are required. A type test with no following read fabricates nothing. A read with no type
test is a different defect — that is why `ccd/session-hook.sh`'s bare `cwd=$(cat "$REG/$id.workdir")`
is NOT in this class, and folding it in would make the class unbounded again, which is the naming
error repeating itself in the other direction.

**WHY THE PAIRING IS THE DEFECT:** bash `-f`/`-e`/`-r`/`-s`/`-d`, python `os.path.isfile`/`isdir`/
`exists` and node `existsSync`/`statSync` **all follow symlinks**. A link planted at the tested `$REG`
path passes the test, and the following read returns another file's bytes at rc 0 — indistinguishable
from a real read. The fix is a test that does NOT follow: bash `! -L`, python
`stat.S_ISREG(os.lstat(p).st_mode)`, node `lstatSync`.

**THE INSTRUMENT, so the next reader re-measures rather than inherits a number.** Per file, find that
file's own spelling of the registry root (`REG=`, `_SVC_REG=`, `reg=`, `$HOME/.cc-sessions`,
`registryDir`), then pair type tests against reads of the same path.

**THE CORPUS IS THE REPO, NOT `ccd/`** — corrected in round 5, after the `ccd/`-only form reported a
clean sweep while `server/src/limits.ts` carried the class. Widen the first line to every tracked
shipped file naming the registry root and keep the rest:

    git -C <repo> ls-files ccd/ server/src agent/src shared deploy pwa/src | while read -r f; do
      /bin/grep -nE '\[\[? *-[efrsdx] |os\.path\.(isfile|isdir|exists)|existsSync|statSync|readdir\(' "$f"
    done
    # then, per hit, read forward for a read of the SAME path (cat, $(<p), read <p, jq/grep/awk p,
    # source p, python open(p), node readFileSync, io.readFile) with no -L / lstat / S_ISREG between.

`readdir(` is in the pattern for round 5's reason: in TypeScript the type test is often a FILENAME —
a listing filtered by suffix, then each survivor read. That is the shape `limits.ts` had and
`registry.ts` still has, and a pattern of `-e`-style tests alone cannot see either. The rule is the
same in both languages: something decided this path was the right KIND of thing, and something else
then read it, and a symlink satisfies the first while changing the answer to the second.

Run 42 ran it as a 7-agent census — four independent lenses (bash `-f`/`-e`; bash `-r`/`-s`/`-d`/glob;
python + node; indirect/multi-level) then three adversarial verifiers (both-halves-present;
would-a-symlink-actually-change-the-answer; reachability-and-blast-radius), each defaulting to
NOT-IN-CLASS when uncertain. A site below is listed only where a MAJORITY of verifiers held it in class
and no verifier found it already guarded.

**FIXED THIS WAVE — SIX bodies.** The `each with its own mutation row` this heading used to claim was
not true of THIS document: the table has no mutation column, and D-2989(a)'s mutation table below
covers `_reg_get`, `_reg_read` and `get()` only. The `_authdead` rows' mutants live in commit
`a4fe09bb`'s message and the `limits.ts` rows' in its own commit's; the heading now says where, rather
than asserting a coverage this file does not carry.

| body | before | after | mutation table |
|---|---|---|---|
| `ccd/ccd` `_reg_get` | `[[ -f ]]` | `&& ! -L` -> rc 1, its existing not-a-field arm | D-2989(a), below |
| `ccd/ccd` `_reg_read` | `[[ -f ]]` | `[[ -L ]] && return 2` before the open | D-2989(a), below |
| `ccd/ccd` `_pr_py`'s `get()` | `os.path.isfile` | `lexists ∧ ¬S_ISREG(lstat)` | D-2989(a), below |
| `ccd/ccd` `_authdead` | `[[ -f "$f" ]]` | `[[ -f "$f" && ! -L "$f" ]]` | commit `a4fe09bb` |
| `ccd/ccd-telemetry-keepalive` `_authdead` | `[ -f "$f" ]` | a separate `[ -L "$f" ] && return 1` rung | commit `a4fe09bb` |
| `server/src/limits.ts` `readLimits` | `io.readFile` alone (follows) | `io.lstatMeasured` first; only a proven `regular` may condemn | round 5's commit, per rung |

THE SIXTH BODY WAS FOUND BY REVIEW 78 AND FIXED RATHER THAN DEFERRED, on the coordinator's own
criterion for deferring the declared remainder: those are pre-existing on `main`, this one THIS BRANCH
CREATED. Before this wave all three bodies of the `_authdead` contract followed the link and were
consistently wrong; closing the two bash ones alone made the server condemn accounts the fleet's own
gate calls healthy — the widening `limits.ts`'s own docstring forbids, reached from the other side. A
class closed in one body of a three-body contract is closed nowhere.

**A PENDING DEPARTURE, NAMED IN PROSE BECAUSE IT CANNOT BE NUMBERED HERE.** The sixth body needed a
question no port on this fleet could ask — the server reads the registry over the agent WS in the
live configuration — so `FleetIO` gained `lstatMeasured` and the agent protocol gained an `lstat`
op. **Adding an op to the wire is a MECHANISM, not another instance of D-2989's class, so it wants a
number of its own.** This wave's block (D-2989..D-2992) is spent and defined; the standing instruction
for this run is never to call the allocator mid-wave; and a concrete `D-TBD-<slug>` reds
`server/test/dtbd.test.ts` by design. It is therefore reported in the wave-done mail for the
coordinator to mint against this project, and named here so a later reader finds it before the number
exists. Additive on the wire, `FLEET_PROTO` untouched; an agent too old for the op refuses the request
and the server reads UNMEASURED, never a kind.

ROWS 4 AND 5 ARE ONE CONTRACT IN TWO BASH BODIES, and row 6 is its third. `ccd/ccd`'s header claimed
the keepalive sibling "already opens with `[ -f "$f" ] || return 1`" and that this copy "was the one
left behind" — measured, the sibling carried the SAME following test and the SAME defect, so `-f` was
never what was missing. A fix banner describing what it MEANT rather than what it did.

**DECLARED, NOT FIXED — the measured remainder, with what each one reaches.** This is a declaration
because the round that found it was bounded to `_authdead` plus a re-census; it is not a claim that
these are harmless. Four of them are destructive and one writes into a model's context.

**RE-EMITTED AS A LIST IN ROUND 5, AND THE FORMAT IS THE POINT.** This was a three-column table and
every one of its nineteen rows was cut mid-token before its closing `|` — so the blast-radius column,
which is this declaration's ENTIRE deliverable for sites it is not fixing, was missing in every case
(three rows lost a citation to the cut). A list has no width to exceed. Every entry below was
re-derived on the shipping tree rather than un-truncated from memory: the tail of each cut sentence is
gone, and completing it by inference is exactly what this wave keeps punishing. **Line numbers are the
shipping tree's**, and each ccd/ccd site was re-checked by content after this round's `_authdead`
header correction moved every line past `:1528` by 26.

*Destructive or context-reaching entries are marked. Votes are the original census's.*

- **`ccd/ccd:1761`** (4/5) — `_project_pool_state` (`:1679`). **WRONG-POOL PLACEMENT — the worst
  non-destructive consequence in this census.** CLAUDE.md: this is ccd's ONLY reader of the project
  pool tag, and it answers one of four words that every placement, tick and manual verb keys on. A
  symlink at `$REG/pools/<project>` resolving to any readable ≤64-byte file matching the pool grammar
  makes it answer `named <that>`, placing work on a pool nobody tagged.
- **`ccd/ccd:6872`** (3/3) — `cmd_ws_rm`'s held-refusal. **PERSISTED** (corrected this round): the
  fabricated bytes go into `_lc_refuse destroy "$id" held "held: $_hold_reason — release first: …"`
  (`:6877`), which emits through `_lc_emit` — the journal — and then dies. The HELD verdict itself is
  the separate `-e` gate above and is not forgeable; the reason TEXT is.
- **`ccd/ccd:7333`** (3/3) — `cmd_ws_rename`'s held-refusal. **COSMETIC.** Already decided by the `-e`
  gate above it; the value lands only in the wire JSON at `:7338`
  (`printf '{"refused":"held","detail":%s,"paths":[]}\n'`), which nothing persists.
- **`ccd/ccd:8038`** (3/3) — `cmd_ws_release`'s measured hold. **PERSISTED, AND IT OUTLIVES ITS
  SUBJECT** — the highest-ranked of the three persisted hold rungs, because it records a hold being
  REMOVED and the `rm -f -- "$REG/$id.hold"` two lines later destroys the only other copy. The value
  goes into `_lc_done release "$id" "" meas.held "$_hold_reason"` (`:8043`).
- **`ccd/ccd:8360`** (2/2) — `_reg_project_glob_has` (`:8357`). **SMALLEST OF THE REAL ONES.** Single
  caller, `:8497`, inside `cmd_project_pool`'s `--pool` arm, as the second disjunct of a
  project-exists check. A symlink to any file containing the project name as a whole line makes an
  unknown project look known, so a tag is accepted for a project that is not there.
- **`ccd/ccd:12558`** (4/5) — `_ws_tombstone_reclip` (`:12507`). **READ *AND* WRITE THROUGH THE LINK —
  the only candidate in this census that CLOBBERS a foreign file rather than merely misreading one.**
  `[[ -s "$f" ]]` follows, the python that rewrites the tombstone opens the same path, and the write
  lands on the link's TARGET. Single caller, `:13392`, on `cmd_ws_reap`'s path. **DESTRUCTIVE.**
- **`ccd/ccd:12608`** (4/5) — `_ws_tomb_str` (`:12571`). **A DESTRUCTIVE ARM, AND THE
  SELF-CONSISTENCY IS WHAT MAKES IT BITE — the widest radius in this census.** On `cmd_ws_reap`'s
  RESUME path, `:12886` takes `tombtip=$(_ws_tomb_str "$REG/.reaped/$id.json" tip)`, and a tip read
  from a substituted tombstone is then what the resume acts on, including `update-ref -d`.
  **DESTRUCTIVE.**
- **`ccd/ccd:12659`** (4/5) — `_ws_tomb_children` (`:12618`). **THE CONSENTED-CHILD SET ON A REAP
  RESUME.** Callers `:13063` (`rcconsented=$(_ws_tomb_children "$REG/.reaped/$id.json")`) and `:13416`
  (`childlines=$(_ws_tomb_children "$tomb")`). A substituted child list is a substituted answer to
  "which children did the operator consent to destroy". **DESTRUCTIVE.**
- **`ccd/ccd:12729`** (3/3) — `cmd_ws_reap`'s held-refusal. **COSMETIC**, same shape as `:7333`: the
  refusal is already decided by the `-e` gate above, and the fabricated bytes reach only the wire JSON
  at `:12734`.
- **`ccd/ccd:14973`** (3/3) — `_share_pct` (`:14967`). **FABRICATED PLACEMENT HEADROOM FOR THE FABLE
  CLASS.** Single caller `:15003` (`fig=$(_share_pct "$w"); rc=$?`) inside `_serviceable`. A symlink
  to any JSON carrying a fresh-looking timestamp and a low share makes an account look serviceable for
  Fable work when its real share says otherwise.
- **`ccd/ccd:21392`** (3/3) — `cmd_ws_forget`'s held-refusal. **PERSISTED** (corrected this round):
  `_lc_refuse forget "$id" held …` at `:21397` reaches the journal through `_lc_emit`, exactly as
  `:6872` does.
- **`ccd/ccd-graph-sweep:88`** (3/3) — `_gs_session_on`. **GRAPH FRESHNESS ONLY** — nothing
  destructive, nothing the PWA renders. Called at `:201` on a `.claude/worktrees` candidate.
- **`ccd/ccd-graph-sweep:297`** (3/3) — `_gs_busy`, gating `_gs_row "$tree" "$BUSY_OUTCOME"` at
  `:1069` — the sweep's decision not to touch a tree. A symlink to any fresh JSON carrying a live
  marker makes the sweep skip a tree that is idle, or work one that is not.
- **`ccd/ccd-telemetry-keepalive:521`** (3/3) — `_ka_session_on`. **AN ACCOUNT'S KEEPALIVE TURN.**
  Caller `:680` (`sess_why="$(_ka_session_on "$acct")"; sess_rc=$?`). The function's own header at
  `:510-519` argues the gate this bypasses.
- **`ccd/ccd-usage-sweep.py:272`** (2/3) — **THE TOOL'S ONLY DESTRUCTIVE PATH, BY ITS OWN DOCSTRING**
  (`:238-243`: an id whose `ts` is absent, unreadable or malformed must not be reaped). The type test
  is `os.path.isfile`, which follows; the fix shape is `os.path.lexists` ∧ `stat.S_ISREG(os.lstat(...))`.
  **DESTRUCTIVE**, and the file is not in this branch's diff at all — the follow-up wave's FIRST item.
- **`ccd/ccrc-api:275`** (3/3) — **MUTED, AND THE REASON IS WORTH STATING.** `DERIVED_ID` comes from
  the tmux pane (`:271-274`), not from the file, so `who` at `:404` is unaffected; only a path that
  does not decide identity reads through the link.
- **`ccd/ccrc-doctor-checks:3063`** (3/3) — **ADVISORY DIAGNOSTIC ONLY.** `reg_rows` is consumed at
  `:3167` (`if [ ! -d "$proot/$n" ] && ! _pool_has_line "$n" "$reg_rows"; then`), which prints a
  staleness warning and changes nothing.
- **`ccd/ccrc-doctor-checks:3145`** (3/3) — doctor's per-tag pools verdict
  (`p_malformed`/`p_unread`/the reported tag). A symlink at `$REG/pools/<project>` resolving to any
  ≤64-byte file matching the grammar makes doctor report a tag nobody set. Advisory, but it is the
  surface an operator uses to decide whether the pool state is sane.
- **`ccd/session-hook.sh:456`** (3/3) — `_ct_read`. **BYTES INTO A PEER SESSION'S MODEL CONTEXT — the
  widest non-destructive radius here.** Callers `:480` (`_ct_read "$REG/$id.project"`) and `:531`/`:547`.

**WIDENED IN ROUND 5 — the instrument's corpus was `git ls-files ccd/`, which could not contain this
class BY CONSTRUCTION.** The class says "a type test on ANY path under `$REG`", and `$REG` is read
from four packages. That bounding error is the THIRD of this shape in one wave — after a field-path
grammar that could not contain `_authdead`, and an `ln -s` scan that could not see `symlinkSync` — so
it is named as the pattern it is: *an instrument whose corpus is narrower than the class it is named
for reports a clean sweep of the part it can see.*

The widened corpus is every tracked SHIPPED file naming the registry root by any spelling (`REG=`,
`_SVC_REG=`, `reg=`, `$HOME/.cc-sessions`, `registryDir`), across `server/src`, `agent/src`, `shared`,
`deploy` and `pwa/src`, with the same pairing rule and the same default of NOT-IN-CLASS. Test files
are excluded and that is an exclusion, not an oversight: a fixture plants its own registry, so a
symlink there is the test's own act and reaches nothing.

What the widened pass found:

- **`server/src/limits.ts`'s `readLimits` — FIXED THIS ROUND**, not declared. The third body of the
  `_authdead` contract; see the round-5 ruling and the commit that closes it.
- **`server/src/registry.ts:1010` and `:1119`** — NEW, DECLARED. The candidate list is a FILENAME
  test — `names.filter(n => n.endsWith('.uuid'))`, and an `includes` of the same `<id>.uuid` name —
  and every field
  then reads through `io.readFile`, which follows. A symlink at `$REG/<id>.uuid` is listed, passes,
  and fabricates a whole session ROW on the wire. Same shape as the `limits.ts` site — `limits.ts`'s
  own docstring is the one that names it ("Trusting the FILENAME alone here would make the server MORE
  CREDULOUS than bash") — and it is now the only unfixed instance of it on the server.
- **`deploy/deploy.sh:568-570`** — NEW, DECLARED, LOWEST. `[ ! -f ~/.cc-sessions/<f> ] || cp -a …`
  pairs a following `-f` with an operation on the same path. `cp -a` does NOT follow, so the effect is
  a backup that contains a link instead of the bytes it was meant to preserve — a fidelity defect on
  the deploy path, not a fabricated value.
- **`server/src/pools.ts` — ALREADY DECLARED, not new.** Its symlink residual is disclosed as D-2516
  in the file's own type docstring, and `server/test/pools-existence-pairing.test.ts` (D-1848) already
  pins the class for pools paths across three bodies. Recorded here so the follow-up does not re-find
  it and count it twice.
- **NOT IN CLASS, each for a stated reason, not by omission:** `server/src/hookstate.ts`,
  `shares.ts` and `usage.ts` read `$REG` paths through `readFileMeasured` with NO type test paired —
  the same bare-read shape as `ccd/session-hook.sh:198`, ruled out of this class in round 4 and ruled
  out again here. `dispatch.ts:347`, `watch.ts:2553` and `watch.ts:3885` test a marker's PRESENCE in a
  listing and never read it, so there is no pairing and a symlink's target is never consulted.
  `coord/prhistory.ts:98` uses the listing only to tell absence from unreadability and re-reads the
  SAME path either way. `agent/src` runs every file op on `checkPath`'s canonical result, so links are
  resolved before any read — which is also exactly why the new `lstat` op had to step outside that,
  and why its first implementation shipped inert. `shared/` imports nothing and `pwa/src` is a browser
  bundle with no filesystem at all.

**RULED EXPLICITLY, because the round asked for these two by name:**
- **The five hold rungs are in the class and are NOT fixed here.** In all five the HELD/not-held
  decision is the separate `-e` gate above them — "doubt reads as HELD", fail-shut and deliberate — so
  a symlink cannot unwedge a refusal. What it fabricates is the reason TEXT.
  **THE SPLIT IS 2 COSMETIC, 3 PERSISTED** (corrected in round 5; this entry said four and one, and
  the discriminator it used for the one was shared by two of the four it called cosmetic). Each rung is an
  `[[ -f && -r ]]` test over `$REG/$id.hold` with the `cat` on the next line; what separates them is
  the CONSUMER, named
  by function rather than by line because a line here has already rotted once:

  | rung (the `[[ -f && -r ]]` test) | consumer | reaches |
  |---|---|---|
  | `ccd/ccd:6872` | `_lc_refuse destroy` | the lifecycle journal — **PERSISTED** |
  | `ccd/ccd:7333` | `printf '{"refused":"held",…}'` | stdout — cosmetic |
  | `ccd/ccd:8038` | `_lc_done release … meas.held` | the lifecycle journal — **PERSISTED** |
  | `ccd/ccd:12729` | `printf '{"refused":"held",…}'` | stdout — cosmetic |
  | `ccd/ccd:21392` | `_lc_refuse forget` | the lifecycle journal — **PERSISTED** |

  Measured, not inherited, and stated no wider than it was measured: **`_lc_emit` is the only writer of
  RECORDS**, one `printf … >> "$live"` at `ccd/ccd:4232`, and `_lc_refuse` and `_lc_done` both reach the
  journal only through it — `_lc_refuse` emits then dies, `_lc_done` delegates in one line. The
  function's own header says "NOTHING BUT THIS FUNCTION WRITES INTO `.lifecycle/`" and then qualifies
  itself, correctly: `_lc_err` bumps `$_LC_DIR/errors` and the rotation arm mints and moves generation
  files. Those write into the DIRECTORY and neither appends a record, so the claim that matters here
  survives the qualification — but "nothing else writes there" would have been false, and an
  unqualified grep would have said so. Containment is pinned by
  `server/test/ccd-lifecycle-contain.test.ts`. So the property the entry used to single `:8012` out for — "persists into the
  lifecycle journal, where it outlives its subject and reaches the wire" — is true of three rungs, not
  one. **`:8038` keeps its RANKING and loses its count**: alone among the three it records a hold being
  REMOVED, so its record survives the thing it describes. The other two refuse and die, leaving the
  hold in place for anyone to read directly.
- **`ccd/session-hook.sh:198` is NOT in the class**, and that is a measurement, not an exemption: it is
  `cwd=$(cat "$REG/$id.workdir" 2>/dev/null)` with **no type test at all**. An unguarded read is a
  different shape. The hook's real in-class site is `_ct_read` (`:456`), which the census found
  independently and which carries the widest non-destructive radius in this table.

**WHOSE ERROR THE NAMING WAS.** The coordinator asked for the class by shape, accepted a grammar that
could not contain it, and then recorded "D-2989 is CLOSED" on a verification of the FIX rather than of
the CLASS — and said so unprompted when the re-census surfaced `_authdead`. It is recorded here because
the headline is what a later reader carries, and that one claimed more than had been measured.

### D-2989(a) — the original field-path census, kept because its mutation rows still hold
**Review 71 CRITICAL 1, and the class is three READ-SIDE sites named by SHAPE, not by a count anyone was
given.** Every one of them type-tested a `$REG/<id>.<field>` path with a test that FOLLOWS a symlink —
bash `-f` in two, `os.path.isfile` in one — so a link resolving to any readable regular file anywhere
returned THAT FILE'S bytes at rc 0, indistinguishable from a real field read, and `cmd_pr_state`
persisted the value into `.prhistory`:

| site | shape | before | after |
|---|---|---|---|
| `ccd/ccd` `_reg_get` | bash `[[ -f ]]` | rc 0, target's bytes | `&& ! -L` -> rc 1, its existing not-a-field arm |
| `ccd/ccd` `_reg_read` | bash `[[ -f ]]` | rc 0, target's bytes | `[[ -L ]] && return 2` before the open |
| `ccd/ccd` `_pr_py`'s `get()` | py `os.path.isfile` | the target's bytes | `lexists ∧ ¬S_ISREG(lstat)` -> `None` |

`_reg_read` answers **2 and not 1** because something IS there and it is not absent — the verdict the
DANGLING case already got. That the dangling case was already green is precisely why this survived two
rounds: **a broken link is refused by `-f` for free, so a dangling-symlink case pins none of this.** The
shape that was missing everywhere, and is now added per site, is a **symlink to an EXISTING REGULAR
FILE**, each with a control proving the guard refuses a TYPE rather than the field.

**Mutation table (measured per site, not as a class — `ccd-crosspool.test.ts`, `ccd-bounded-reads.test.ts`):**

| mutant | suite | result |
|---|---|---|
| all three guards reverted | both | 3 failed / 164 passed — exactly the three new cases, both controls green |
| `_reg_get` guard only | crosspool | 1 failed / 120 passed — the `_reg_get` case alone |
| `_reg_read` guard only | crosspool | 1 failed / 120 passed — the `_reg_read` case alone |
| `get()` guard only | bounded-reads | 1 failed / 45 passed — the `get()` case alone |

**Why converting the two bash twins breaks no shipped caller, measured:** no shipped file creates a
symlink at a registry field path — `git grep -nE "ln -s(fn)? .*(REG|cc-sessions)" -- ccd/` returns three
hits and all three are comments; the only live `ln -sfn` calls (`ccd/ccrc`, the memory store's directory
link) target a DIRECTORY, not a field. **That scan does NOT bound the population and must never be
quoted as containment.** It answers "does converting break a shipped caller" (no). It cannot answer "can
a link appear there": the registry is a flat directory under one UNIX user and anything with a shell can
write it. Treating the scan as containment is the exact vacuity this wave exists to close.

**Three shipped sentences were false and are corrected in the same commit as the guard** — a comment is
a request, and all three were read as arguments during earlier audits of this very code:
- `get()`'s *"never a fabricated value"*. It is the sentence that defeated two audits of the function it
  describes. Replaced with what the guard now actually guarantees: any bytes returned came from a
  regular file AT THIS PATH, never through a link to one elsewhere — and explicitly NOT that the field
  is present, since absent and non-regular still share one `None`.
- the `put`/`clear` containment paragraph (plan, and `ccd/ccd`'s own copy) concluding *"the collapse is
  invisible AND harmless"*. It reasoned about the WRITE and concluded about the READ. Invisible, yes;
  harmless, no.
- `_reg_read`'s header, which stated that `-f` resolves a symlink CHAIN and then argued the test only
  about MODE, as though the chain were incidental. Mode decides READ vs UNREADABLE; type decides whether
  the path is a field at all.

**Reported, NOT fixed (out of this wave's scope, carried with its instrument):** `ccd/ccd-usage-sweep.py`
gates an `os.walk` + `os.remove` **delete** on `os.path.isdir`, which follows a symlink. Pre-existing,
not in this wave's diff, and a delete-side instance of this same class — the next wave inherits it here
rather than rediscovering it.

### D-2990(a) — "line-count neutral" is pinned by NOTHING, and this wave leaned on it
**The honest epitaph for the repair method, and the one declaration this round owes beyond its fixes.**
Twice in this wave a later commit was written to be LINE-COUNT NEUTRAL so that an already-landed anchor
repair would stay valid — the F14 fixture condition was rewritten to exactly six lines for precisely
that reason. **Measured: no suite pins any line count or byte size of `ccd/ccd`, `ccd/ccrc` or
`ccd/session-hook.sh`.**

    git grep -nE '19691|11974|53707' -- server/test/     ->  EMPTY

What `macos-platform.test.ts` actually pins is the two homes' **byte-IDENTITY** — it slices both files
between `# ── THE PLATFORM LAYER` and `# ── END PLATFORM LAYER` and compares. That pin stays GREEN when
both files grow **identically**, which is exactly the case that shifts every anchor below the block. It
is a real mechanism for a different property.

**So the property this wave relied on to keep `61e0d45b` valid is a PROMISE, not a mechanism** — a
convention held by authors remembering it, with nothing that reds when they forget. Two separate
things follow, and both are already visible in this round: a line-count-neutral edit does not protect
anchors ABOVE it in another file (this round's `ccd/ccrc` growth moved anchors that a neutral `ccd/ccd`
edit could never have touched), and **line-count neutrality is not anchor safety at all** — F16 measured
`ccd/session-hook.sh:1118-1120` and `:1123` REWRITTEN IN PLACE by #135, cited bytes changed under a
citation while the file's length never moved.

It is stated here rather than mechanised because the mechanism that would help is not a size pin — it
is the census itself, and D-2992 records exactly the residue the census cannot see.

### F15 — a commit message asserts a measurement it did not make, and cannot be amended
`0011a2ec`'s message claims a measurement about `ccd/ccd:16610-16612`; at that commit's own tree those
lines are a comment about minting. **The SHIPPED ANCHOR is correct** — the defect is the message's
claim ABOUT the measurement, not the anchor it produced. `main` is protected and the commit is merged,
so the message cannot be amended: **this paragraph is the durable correction**, in the same role the
hand-written squash body played for F9. Recorded rather than quietly dropped because a commit message
is the first thing the next reader trusts and the last thing anyone re-measures.

### D-2990 — the citation repair's deliverable is a DERIVATION, not a number
**Review 71 CRITICAL 2.** `main` moved TWICE inside a single review (`2f9deae2` -> `d02c2549` ->
`ecbb8b22`), and each move falsified the census this branch had just re-measured. Three repairs on this
wave have now expired that way. The reviewer offered two options — re-point once more, or take the
repair out of the wave — and **neither was available**: reverting does not restore correctness, it
restores a DIFFERENT wrongness, because the reverted anchors point at pre-#135 lines that are also
wrong on the merged tree. There is no clean removal.

**So the deliverable changed shape.** The census map, its total, the README anchor and the
`# ccrc:generated` stamp are no longer numbers this plan asserts; they are **whatever the instrument
prints on the tree that ships**, produced in the LAST commit of the round and named with the command
that produced them. Neither 66 (this branch's) nor 162 (main's) may be typed. If the instrument prints
200, 200 ships.

**This is the only shape that converges,** and the reason is worth keeping: the old deliverable was a
number true of a tree that stops existing the moment `main` moves. Making it a derivation makes
re-running it cheap, and the race is won by SHORTENING THE WINDOW, not by measuring more carefully.

**WHY IT HAD TO BECOME A DERIVATION, AND IT IS NOT THE REASON ANYONE ASSUMED: THE REPAIR'S BASE WAS
NEVER ONE TREE.** The classifier compares an anchor's block AT A BASE against the tip, and this corpus
carries THREE populations with three different bases — anchors the first repair (`61e0d45b`) re-pointed,
anchors that arrived with a merge of `origin/main`, and anchors nobody has ever touched (`dfa167d7`).
Measured at the merged tree:

| classified against | provable repairs |
|---|---|
| `dfa167d7` alone | **1** |
| `61e0d45b` alone | 34 |
| both, taking any unique byte-identical hit | 138 — **of which 103 CONFLICT** |

A conflict is two bases each yielding a DIFFERENT unique hit for the same anchor. Byte-equality cannot
break that tie, and taking either side is a guess of exactly the kind this wave exists to refuse.

**The rule that removes the conflicts rather than guessing them is DERIVABLE: an anchor's base is the
tree whose copy of THAT SAME DOCUMENT contains that exact citation spelling.** Under it the 176 failing
anchors resolve into 117 repairable, 16 non-unique, 15 referent-gone and 28 already correct, with no
conflicts left to adjudicate. A second membership pass caught 13 more. Census 176 -> 113 -> 109.

**What is REFUSED rather than guessed, and stays refused:** the 16 non-unique, the 15 whose referent is
gone, and 5 whose spelling the applier could not locate in its own paragraph. A repair method that
cannot say WHICH TREE an anchor was last measured against cannot prove anything about it, and an
unprovable anchor declared is worth more than a plausible one written.

**And the applier's own hazard, designed out:** edits are grouped BY PARAGRAPH SEGMENT with the ranges
asserted disjoint. The previous instrument applied one edit per repaired LINE, so two repairs inside one
paragraph were two writes over the identical byte range — last write wins, both counted in the tally. It
never fired on this corpus (measured: 59 repaired lines across 59 distinct segments, zero collisions)
but it would have reported repairs the file never received.

**THE ORDER IS PART OF THE RULING.** Three items each change `ccd/ccd`'s line count and two are derived
from it: merge first, then the guard class, then every tree-derived cardinal last. Done in any other
order each invalidates the last. And "earlier" includes earlier IN THE SAME ROUND — two anchors
corrected mid-round (`_inst_dirs`, `_inst_graph_always_on_off`) were stale by the +15 lines this round's
own `ccd/ccrc` commit added, and had to be re-measured at the line-final tree.

### D-2991 — a verified wave-done FREEZES the tip, and the constraint binds the coordinator
`37a175eb` landed after its own verified wave-done, and that push discarded review run 70 entire — 26
findings, a full panel, six sharded suites, closed `stale-review`.

**The worker did the obedient thing.** A ruling arrived while the branch sat in `awaiting-review` with a
review in flight, and a requirement delivered then has nowhere to land except a push. **The rule is
therefore on the issuing side:** a requirement that arrives after a verified wave-done is the NEXT
round's, always. A coordinator does not issue requirements against a branch whose fingerprint is under
review; it holds them for the brief that review will trigger. Recorded as a deviation rather than as a
note because it is a protocol defect with a named cost — one full review run — and the next programme
inherits the rule, not the anecdote.

### D-2992 — the census cannot find its own residue, so the residue is DECLARED with its instrument
**Twelve distinct anchors are COINCIDENCE-GREEN:** unchanged spelling since `dfa167d7`, scored GREEN by
the census at the branch tip, and citing DIFFERENT BYTES between the two trees. All twelve are into
`ccd/ccd`, measured at `37a175eb`: `:3050-3070`, `:3060`, `:3091`, `:4006-4035`, `:6465`, `:6478`,
`:6547`, `:13020`, `:13561`, `:13567`, `:13602`, `:13618`.

**This is the indictment of the repair method, and it is why the scope CONTRACTS rather than expands.**
The repair takes its work list from the census's FAILING set. These twelve are green. **The method can
never reach them** — not through more care, and not through another round.

**THE TWO/TEN SPLIT THIS ENTRY USED TO ASSERT IS WITHDRAWN, AND IT WAS WRONG IN BOTH DIRECTIONS.** It
said two of the twelve were repaired and ten declared. In fact the repair moved far more than two of
them, and then the whole re-point LEFT THIS WAVE (the ruling on review 76). **The number that ships is
ZERO**, and it needs no counting to verify: both corpus documents are byte-identical to `origin/main`,
so no re-point of this branch's survives in any of the twelve, or anywhere else. That is the one form
of this claim that cannot go stale — it is a property of the shipping tree, checkable with `diff`.

**THE INSTRUMENT WAS BROKEN FOR EVERY RANGE ANCHOR, measured.** The comparison below used
`sed -n "${a}p"`, and for a range `a` such as `3050-3070` that is not a sed address — it is
`unknown command: '-'`, exit 1, **empty output on both sides**. `diff` of two empty results succeeds,
so every range anchor in this list was silently scored UNMOVED. Four of the twelve are ranges. **A diff
of two FAILED commands reports "equal"** — the comparator answered confidently about the unmeasured,
which is the same shape as every other defect this wave has been about. Corrected:

    for a in <anchor…>; do                      # a is "N" or "N-M"
      diff <(git show <base>:ccd/ccd | sed -n "${a//-/,}p") \
           <(git show <tip>:ccd/ccd  | sed -n "${a//-/,}p") >/dev/null || echo "MOVED: $a"
    done

Verify the fix before trusting it: `sed -n '3050-3070p'` exits 1 with no output, `sed -n '3050,3070p'`
returns 21 lines. **And guard the comparator itself** — a comparison whose inputs may fail must check
that both sides were produced, or it reports agreement between two absences.

**The two instruments that DO work, and are what the next wave should inherit:** `main`'s own
anchored-by-shortness assertion in `session-hook.test.ts`, which names a specific anchor and reds when
one rots (it is what found `ccd/ccd:2964`), and the range-corrected byte comparison above. Both are
re-runnable at any future tip. Neither is a number.

**Run 70's framing of its own four does not hold** — it said they "left the failing set"; all four were
already green at `d59f93d7`. The substance was right and the arithmetic around it was not. Recorded
here because a correction to a finding this wave ACCEPTED is this wave's to carry.

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

**F14 (review run 69) — the header's fixture claim, narrowed and then WITHDRAWN rather than restated.**
The shipped paragraph closed with *"no symlink-to-DIRECTORY exists at any of the eight anywhere in the
tree"*, while its own `ln -s` census is scoped to the shipped files and excludes test fixtures BY
CONSTRUCTION — fixtures build links with `symlinkSync`, which no `ln -s` scan can see. The sentence is
now scoped to what the census measures. **The fixture claim is not restated in a narrower form either,
and the reason is not cost:** run 69 DID measure those fixtures — `POOLS()/demo` targets a FIFO,
`/dev/zero`, `/dev/null` and a regular file, none of them a directory — so the wide claim was TRUE at
`76897187`. But its warrant would rest on a census NOTHING IN THIS TREE MAINTAINS, so it goes silently
false the first time anyone adds a directory fixture: an absence asserted with no writer that keeps it
true. That measurement therefore lives HERE, dated and attributed to the tree it was taken at — which is
what a review finding is — rather than in a shipped comment as a standing property.

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
| M1 | delete the `rm -f -- "$2"` line entirely | GREEN | GREEN | GREEN | GREEN — **UNPINNED** by these four; caught by **FOUR** cases (was three until F10 added the fourth this round, re-measured): A1's case 1 (`answers 0 only if src is now AT a dest that was a symlink to a directory`), the rm-fails price (`when the guarded rm FAILS…`), the SAME price pinned at every uid (`when the guarded rm fails for a reason chmod cannot cause…`) and the destination-gone price (`when src is absent, a symlink-to-directory dest is left GONE…`) |
| M2 | guard the `rm` by `-L "$2"` only (drop `-d`) | GREEN | **RED** | GREEN | GREEN |
| M2b | guard the `rm` by `-d "$2"` only (drop `-L`) | GREEN | GREEN | GREEN | GREEN — **UNPINNED** by these four, but **PROVABLY EQUIVALENT** (below), not an uncaught defect |
| M3 | make the `rm` unconditional (drop its own `-L`/`-d`, keep `\|\| return 1`) | **RED** | **RED** | GREEN | GREEN |
| M4 | M3 plus delete the pre-existing refusal guard (`if [ ! -L "$2" ] && [ -d "$2" ]; then return 1; fi`) too | **RED** | **RED** | **RED** | GREEN |
| 6 | delete ONLY the refusal guard — the `rm` line left EXACTLY as HEAD has it | GREEN | GREEN | GREEN | **RED** |

**THE WAVE'S UNPINNED COUNT, CORRECTED — and it is a taxonomy, not a number (F4, review run 69).**
This wave disclosed "two UNPINNED mutants", meaning M1 and M2b in the table above. That was wrong on
both sides of the word. Review run 69 measured FOUR further behaviour changes with no pin at all — three
in Part C (the `0x1F` delimiter, `Number.isInteger`, the `lastError` sanitiser) and one in Part D
(`cmd_ws_release`'s `-r` conjunct, which the reviewer measured by dropping it and finding the entire
`ccd-bounded-reads` suite still GREEN at 40 passed). A single integer cannot carry that, because the
four resolve **two** different ways, not three (re-counted: of the four, three — the `0x1F` delimiter,
the `lastError` sanitiser and `cmd_ws_release`'s `-r` conjunct — land PINNED below, and the fourth,
`Number.isInteger`, lands EQUIVALENT; none of the four is the row in the third class, which is
`M1`, a pre-existing item from the ORIGINAL "two UNPINNED mutants" this paragraph opens by correcting,
not one of the four review run 69 added). Measured at this tree, the wave's mutants — the four just
named, plus M1 and M2b from before them, plus two more (F2's catalogue type test and R1's empty-output
rung) that arrived separately via C6's own table — fall into exactly three classes:

- **PINNED this round (5):** the `0x1F` delimiter, the `lastError` sanitiser, F2's catalogue type test
  and R1's empty-output rung — each with its own case and its own RED above (C6's table); plus
  `cmd_ws_release`'s `-r` conjunct, pinned by a mode-000 hold case that reds when the conjunct is
  dropped at that one site. (Five items enumerated here, not four — recounted.)
- **EQUIVALENT, with a control (2):** M2b in the table above (measured across all six destination
  shapes; the one shape where the two spellings differ is unreachable, refused by the guard above it)
  and C-M2 (`Number.isInteger`, whose control C-M2c reds immediately). An equivalent mutant is not an
  unpinned one, and this plan says which of the two each row is rather than leaving a green cell to be
  read either way.
- **UNPINNED BY ITS OWN GROUP, CAUGHT ELSEWHERE (1):** M1, whose four catching cases are enumerated in
  the row itself and re-measured below.

`cmd_ws_release`'s `-r` carries one further honest qualification, stated where the case lives: its pin
is `skipIf(uid === 0)`, and under root the mutant is **provably equivalent** rather than merely
unobserved, because root can read a mode-000 file, so `[[ -f && -r ]]` and `[[ -f ]]` agree at every
shape there. That is a different thing from the skip F10 replaced, where a real behavioural difference
survived under root with nothing holding it.

**A5's OWN named deliverable, on its own line (F12, review run 69).** A5 is *"delete the `rm -f` line,
measure A1 RED"* — that is M1 against **A1 case 1**, which sits OUTSIDE the four-column group above by
design, so M1's result for it survived only as prose inside the one cell the table scores GREEN. Stated
on its own and **re-measured at this tree**, `vitest run test/macos-platform.test.ts` with the whole
`rm -f -- "$2" || return 1` line deleted:

| M1 — delete the guarded `rm` line entirely | result |
|---|---|
| A1 case 1 — `answers 0 only if src is now AT a dest that was a symlink to a directory` | **RED** |
| the rm-fails price — `when the guarded rm FAILS, the function does not answer 0` | **RED** |
| the rm-fails price at every uid — the F10 case added this round | **RED** |
| the destination-gone price — `when src is absent, a symlink-to-directory dest is left GONE` | **RED** |
| the four columns of the table above | all GREEN — which is what "UNPINNED **by these four**" means, and no more |

`Tests 5 failed | 49 passed | 10 skipped (64)`; the fifth failure is `is byte-identical in ccd and ccrc`,
an artefact of mutating `ccd/ccd` alone and not a behavioural case. **So A5's measurement is RED at FOUR
independent cases, not three** — the count the earlier rounds recorded, before F10 added a pin that holds
regardless of uid.

**ROW 6 IS RED ON `A1 case 2`, AND `79aa38b4`'s COMMIT MESSAGE SAYS OTHERWISE (F9, review run 69).**
That message claims row 6 was *"measured GREEN on all four"* and uses that to settle deleting the
narrowed scan. The table above, that commit's own diff, and every tree since record row 6 as **RED on
the `A1 case 2` column** and GREEN on the other three. The CONCLUSION is unaffected and stands — the
scan was vacuous for a different, separately measured reason (row 6's own ground, below) — but the
stated ground was wrong. Recorded HERE because `main` is protected, so no amend reaches that message,
and because a SQUASH merge drops it entirely: the squash body is then the only surviving message, and a
reader looking for a mutation result reads this table, not `git log`.

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

**THE OVERLOADED NULL AT `get()`'s SEAM, named here and not only in the source (R2, review run 69).**
`get()` answers the identical `None` for "absent" and for "present but not a regular file" — two
conditions a caller handles differently, collapsed to one value. `CLAUDE.md` bans that shape outright
("No overloaded null at a seam … that's a defect, not style"), and the shipped comment already calls it
by name. It gets NO deviation number of its own: the review panel refuted that 2/3 and the coordinator
agreed, because this entry is already the subject's home. It is written here because the deviations
section is where the next reader looks, and a ban this repo states in its own conventions file should not
be discoverable only by opening the function. **What contains it, measured — and the half this sentence used to
get wrong (D-2989, review 71 CRITICAL 1):** for a FIFO, socket, device or symlink at `dst` the next
`put`/`clear` silently replaces or unlinks it, exactly as though the field had never existed; a DIRECTORY
at `dst` is the one shape that still faults, at `os.replace`/`os.remove`, not at this read. That is true
of the WRITE and it was the whole argument, from which this sentence concluded the collapse was
"invisible AND harmless". **It was not.** For a symlink at `dst` that RESOLVES to a readable regular
file, the read returned that file's bytes at rc 0 — fabricated, from outside `$REG`, and persisted by
`cmd_pr_state` into `.prhistory`. Invisible, yes; harmless, no. Reasoning about the write and concluding
about the read is the defect, not the verdict it reached. `get()` now refuses every non-regular shape on
an `lstat` before the open, so what remains is the absent/non-regular overload alone. Note the file's own asymmetry, deliberately
unreconciled: `_check_models` in `ccd/ccrc-doctor-checks` takes the OPPOSITE position on the same class,
giving a read it cannot trust its own distinct verdict.

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
`_reg_project_glob_has`), and `_project_pool_state`. **WITHDRAWN (F7, review run 71) — its subject no longer
exists.** This note used to carry a second half about the shipped header above `_plat_mv_notdir`
naming "one plants a symlink AT that exact path, `ccd-crosspool.test.ts`'s `devzero-symlink` case",
and asked for it to read "at least one, e.g.". That sentence is GONE from both shipped files —
`git grep -F 'devzero-symlink' -- ccd/` and `git grep -F 'plants a symlink' -- ccd/` are both EMPTY —
because F14 narrowed that paragraph and F3 then deleted its false warrant outright. `d59f93d7`'s
message already claimed this note was withdrawn and it was not; this is the withdrawal, and the third
commit message claiming it is gone would have been the defect, not the fix. The case itself still
exists in `server/test/ccd-crosspool.test.ts` (`:793`, `:814`, `:1676`) — it is the shipped SENTENCE
about it that no longer does.]

**D7 mutation table (one site, landed this wave as `_reg_project_glob_has`):**

| site | command | before (guard reverted / pre-fix) | after restore (guard present / post-fix) |
|---|---|---|---|
| `cmd_project_pool`'s `--pool` arm, via `_reg_project_glob_has` | `vitest run test/ccd-bounded-reads.test.ts -t D-2925` (was `-t D5`, which collided with this plan's own task D5 — F15) | **RED** — measured independently in this session: reverted the guard to the original unguarded `grep -qxF -- "$project" "$REG"/*.project 2>/dev/null` (backup kept outside the repo, never `git checkout --`); `Tests 3 failed \| 1 passed \| 33 skipped (37)`, all three hang shapes (FIFO / symlink-to-FIFO / symlink-to-`/dev/zero`, sorted BEFORE the real row) timing out — `Error: runBounded("cmd_project_pool --project quiet-basin --pool pool-a") did not return within 5000ms — this is a hang regressing, not a flake` | **GREEN** — restored from the pre-mutation copy (md5 verified identical, `git diff --stat -- ccd/ccd` empty), re-ran: `Tests 4 passed \| 33 skipped (37)` |
