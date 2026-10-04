# Landing order, wave 3 — the deny's Task 7 preconditions and wave 2's residue (AGENT-FIRST) Implementation Plan

> **Status: planned 2026-10-04 on `main` `c9ada654` (#239), revised the same day and re-checked on `22f7931a` (#242), prototype-first — ready for dispatch as run 250.**
>
> 1. **What this wave is.** The ledger's wave-3 row puts wave 2's residue and Task 7's preconditions FIRST, before
>    stage 3's `ccd-land-probe`, and allows the preconditions to be "a small wave of their own" so the operator can run
>    Task 7 sooner. This plan is that small wave. Stage 3 (the conflict radar) gets its own plan after this merges.
> 2. **The stopping line (ruled 2026-10-03, review 247) binds it.** The deny is contract-grade: this wave closes no new
>    bypass. It bounds what the deny reads (the payload cap), pins the cost it can still pay (the quote-dense timing
>    pin), makes a silent fail-open visible (doctor's `jq_regex`), and pays review 249's four findings and two of review
>    241's carries.
> 3. **Prototype-first.** Every block below marked `<!-- replay: … -->` is the prototype's bytes. The plan was replayed
>    task by task onto a fresh branch from `main` (`replay.py`, below), and every count, red and timing in it was
>    measured on that replay: one test file per vitest process, `--maxWorkers=1` or `2`, in the foreground, every
>    hand-run timing under `( ulimit -v 4000000; timeout 600 … )` and at most 100 KB (vitest itself cannot start under
>    that `ulimit`: its WebAssembly runs out of memory, so suites run under `timeout` alone). The fleet box's load ran
>    12 to 130 while planning; CPU time is quoted beside wall time wherever load could move the answer.
> 4. **`main` moved twice while planning.** #239 (`c9ada654`, the GPT lane's Plan 3a) landed and rewrote
>    `ccd/ccrc-doctor-checks` and `server/test/ccrc-doctor.test.ts`, and added the `BASE_LIVE_SHAPE` golden to
>    `server/test/ccrc-install.test.ts`, which a new doctor check moves (Task 3 Step 7). The prototype was rebased onto
>    it and re-measured. #242 (`22f7931a`) then changed `README.md` and `CLAUDE.md` only; every anchor below matches
>    exactly once on `22f7931a`, and the citation census is unmoved against it.
> 5. **Revised after three plan-review lenses (2026-10-04).** The revision added the golden step, the five-slice
>    doctor run at `--maxWorkers=2`, the guard loop in every task, a 36 KB quote-dense pin on the landing advisory
>    (rows Q2, Q3), rows P10 and J8, the retirement text for wave 2's H20, H21 and H39, and the branch-tip counts, all
>    measured on a fresh replay.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two CODE preconditions the merged wave-2 plan's Task 7 Step 1 names, so the operator can arm the
merge queue, and pay wave 2's residue. (1) THE PAYLOAD CAP: the merge deny parses no command longer than
`MERGE_PARSE_CAP` = 2048 bytes. Over the cap it asks the raw command two fixed-string questions (does it hold `gh`, does
it hold `merge`) and, in a held or child session, refuses a command holding both, naming the length and the cap; every
other over-cap command passes unparsed. No input can make the strip time the hook out any more, and a timeout was the
way the deny failed open. (2) THE QUOTE-DENSE TIMING PIN: `session-hook-sync-advisory.test.ts` times five quote-dense
shapes at exactly the cap against its 1500 ms whole-hook bound, and `session-hook-merge-deny.test.ts` gets review 249
F1's terminated heredoc and a live row H40; the same five shapes at 36 KB time the landing advisory's own regex on quote
runs. (3) Wave 2's residue: review 249 F2 (every operator that ends the merge
word), F3 (the "four answers" count), F4 (the wave-2 plan's stale counts); review 241's carries: doctor's `jq_regex`
check, which FAILs on a box whose jq cannot match a lookbehind, and a CLOSED-unmerged PR reading `none`, not
`unmeasured`, in `ccd pr-state --project`'s queue word. (4) The wave-2 plan's Task 7 Step 1 names (1) and (2) as landed.

**Architecture:** Everything is fleet-box code: `ccd/session-hook.sh`, `ccd/ccd` and `ccd/ccrc-doctor-checks`, with
their tests. No server source, no PWA, no wire field. The cap sits INSIDE the deny's one jq program, so it costs no
fork: a new `capped(f)` wraps the program's last line, measures `utf8bytelength` before the strip runs, and answers
with a one-character tag the bash arm reads (`=` and the stripped command; `!` and the byte count; nothing). jq
evaluates `f` only on the under-cap branch, so over the cap the strip never runs. The arm adds one branch (an over-cap
answer is a merge it could not read) and one reason, and keeps every other line, so all 61 rows of wave 2's deny table
still find their text. The doctor check is one table entry and one function beside `_check_jq`, in the table's own
contract (`_dr_pass`/`_dr_fail`/`_dr_skip`); it adds one class to every doctor map, so Plan 3a's `BASE_LIVE_SHAPE`
golden in `ccrc-install.test.ts` gains one `"jq_regex": "PASS"` line per map, re-measured by the golden's own
procedure. The queue word changes one python branch in `_pr_queue_py`. Every added
line in `session-hook.sh` and `ccd/ccd` sits below every frozen citation anchor: the census is measured unmoved,
`147 / 197 / 52 / 35`.

**Tech Stack:** bash 5.2.21, jq 1.7 (Oniguruma), python 3.12 (embedded in `ccd/ccd`), TypeScript + vitest 4.1.10.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §4 ("a contract, not an access
boundary": the hook is the fleet's contract, identity is attribution) and §5.2 (stage 2's repository code and its
rollout order: the deny, then the operator's ruleset and proof run). The merged wave-2 plan
`docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`, Task 7 Step 1's "Two CODE preconditions"
paragraph, is what this wave satisfies. Programme ledger: `docs/superpowers/programs/landing-order.md` (Carried
constraints: "The deny's stopping line"; the review-241 carries; the Next-wave brief). Review reports: review 249 at
`7e3b30bc` (F1–F4) and review 241 at `a89d3dc7` (the doctor carry, F10(b)).

**Prerequisite:** wave 2 is merged (#234, `0087a045`). This wave's workspace is a fresh child from current `main`.

---

## Global Constraints

Copied from `CLAUDE.md`, the spec, the ledger and the brief. Every task's requirements implicitly include this section.

- **Deploy class: AGENT-FIRST, through ccrc's own updater.** Every file this wave ships is fleet-box code: the hook
  (installed into each box's `~/.cc-sessions/session-hook.sh` by the install spine), `ccd/ccd`, and
  `ccd/ccrc-doctor-checks` (doctor runs on both nodes; on a `server`-role box the new check SKIPs). The updater moves
  the fleet node first, which is this wave's order. **Nobody moves boxes by hand** (operator ruling 2026-09-30): the
  wave stops at the PR, the coordinator merges, the operator applies the release from the console.
- **The stopping line (ruled 2026-10-03).** The deny is contract-grade. This wave adds NO new bypass closure: no class
  of `GH_MERGE_RE` and no existing definition in `MERGE_STRIP_JQ` changes; the program only gains the `capped`
  wrapper around its last line (Task 1). A bypass met on the way is classified in the wave-done report, never fixed
  here.
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`,
  `ws-archive`/`ws-restore`, `ws-reclaim`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits` or
  `claude-session@*.service` directly; the post-deploy reads in the Deploy note are `grep -c` and `ccrc doctor`,
  nothing more, and no task of this wave runs them. NEVER print secret file contents. `gh` stays off the exec
  whitelist.
- **Fixture HOMEs only.** The hook suites run `ccd/session-hook.sh` under an `mkTmp` HOME with a stub `tmux`; the ccd
  suites go through `makePrHarness`; the doctor suites through `healthy()`/`runDoctor()`, whose PATH holds nothing but
  fixture directories. The timing tool below builds its own throwaway HOME and removes it.
- **No root runner.** `cd server && npm ci`; `cd agent && npm ci` and `cd pwa && npm ci` before `typecheck-tests`.
  Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. **NEVER bare `npx vitest`.**
- **Memory is short on the fleet box.** Suites run in the FOREGROUND, timeout ≥ 600000 ms, one vitest process at a time,
  **one test file per process for the hook and ccd suites**, `--maxWorkers=2` at most (`--maxWorkers=1` for the two
  hook timing files), and that bound holds for the agent and PWA suites too (`npm run test -- --maxWorkers=2`). Any
  hand timing run goes under `( ulimit -v 4000000; timeout 600 … )` and never above a 100 KB payload. A run killed for
  memory is reported by mail, never left waiting at the pane.
- **Known load flakes** (re-run IN ISOLATION before calling a break): `ccd-ws-gc`, `pr-sweep`, `session-hook`,
  `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`; and, measured while planning, (a)
  `session-hook-merge-deny`'s bounded-time cases at `--maxWorkers=2` under load ~85 (one red on `main` itself, green at
  `--maxWorkers=1`), and Task 1's own "answers an over-cap quote-dense command in bounded time" at load ~130 (1895 ms and
  6263 ms under rows H56 and H61, which touch only the strip this path never runs; the same hooks take ~110 ms alone);
  (b) `ccrc-doctor`'s "gh goes red when it is removed from the fixture PATH" (44 s and red once at `--maxWorkers=3` under
  load, green alone in 9 s), (c) `session-hook-sync-advisory`'s 36 KB adversarial cases at load ~60 ("open brace x
  arguments", 1881 ms once, green on the re-run), (d) `ccrc-update`'s "a VERSIONED box whose staged npm ci fails
  replaced nothing" (red once in a whole-file run at load ~20, green alone). A mutation row that reds ONE timing case
  more than its table says is load, not a second guard: re-run that row alone before reporting it.
- **Three server files do not fit one 600 s call, so they run as `-t` slices** whose union is every case this
  platform runs (each union checked with `vitest list --json=<file>` and a partition script: no case uncovered, none in
  two). Measured on the replay at `--maxWorkers=2`, load 12–21: `ccrc-doctor.test.ts` (634 of 638 run here) in FIVE
  slices, 79 / 155 / 141 / 105 / 154 cases, 75 / 148 / 111 / 90 / 116 s; `ccrc-install.test.ts` (283 of 303) in FOUR,
  56 / 68 / 58 / 101 cases, 143 / 185 / 153 / 184 s (the whole file overran 600 s); `ccrc-update.test.ts` (471 of 482)
  in TWO, 288 / 183 cases, 273 / 171 s (the whole file took 482 s, too close to the ceiling under load). Task 3 Step 9
  and Task 5 Step 1 spell the patterns. Never pass `--json` without `=`: `vitest list --json <path>` writes its JSON
  INTO the next positional argument, which is how a test file was overwritten while planning.
- **`ccd/ccd` is provenance-STAMPED.** After any edit: `~/.local/bin/ccrc restamp ccd/ccd` before running any suite, or
  `ownership.test.ts` reds.
- **The citation tax.** `session-hook.test.ts` audits every `file:line` in two FROZEN corpus documents and `README.md`.
  This wave edits two cited files, `ccd/session-hook.sh` and `ccd/ccd`, and adds every line below every anchor; Task 1
  and Task 3 re-measure the census with `cite-remeasure.py` and expect it UNMOVED (`147 / 197 / 52 / 35`).
- **The repo-wide guards run in every task's suite list** (ledger, from wave 1's routing ruling): `single-definition`,
  `modelenv-single-writer`, `box-token-census`, `routing-references`, plus `ownership`, `typecheck-tests` and
  `ccd-workspaces`, and `deviation-refs` after `git fetch origin main`. Each of Tasks 1–4 ends its run step with THE
  GUARD LOOP below; measured after every task on the replay, it read the same each time: `272`, `7`, `23`, `11`, `12`,
  `79`, `14`, `31` (~170 s, load ~15).

  ```bash
  git fetch origin main && cd server
  for f in single-definition modelenv-single-writer box-token-census routing-references typecheck-tests \
           ccd-workspaces ownership deviation-refs; do
    ./node_modules/.bin/vitest run --maxWorkers=2 "test/$f.test.ts" | grep -E '^ +Tests '
  done
  cd ..
  ```
- **Locate code by CONTENT.** Line hints are `c9ada654`'s and are hints, never addresses. A different line number or
  total with every case PASSING is not a red — the difference goes in the commit message.
- **Shell state does not survive between Bash calls.** Every block that names `$SCRATCH` sets it itself. Use a
  subdirectory of your scratchpad that nothing else writes (`$SCRATCH/lo-w3`): while planning, a sibling agent
  overwrote a shared `mutate.py` in the session scratchpad, and its copy `chdir`s into ANOTHER worktree.
- **Branch discipline:** commit on this workspace's own branch only, one commit per task; never a separate feature
  branch (a feature branch wedges every close with `stale-tip`). **Commit trailers:** end every message with the
  attribution line your session is given; the heredocs below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs, account names or the GitHub owner's name** in a committed file
  (`topology-clean.test.ts`).
- **Deviation numbers are ISSUED, never chosen.** The worker's block for run 250 is 3906 through 3915, written bare; a
  departure is defined with one of those numbers, in this plan's `## Deviations found`, in the same act. This plan
  lists its own departures by slug only.

---

## Review Focus

Eleven inputs or failure modes this wave's design implies and nothing on `main` tests. Each has a test in its owning
task, and each test has a mutation row that reds it.

1. **The cap must never let a held session's long merge through.** Over the cap the strip never runs, so a command
   holding both `gh` and `merge` is refused UNREAD in a held or child session; the arm treats the over-cap answer as a
   match before it reads the hold. → Task 1, "parses a command of exactly the cap, and refuses one byte more unread";
   rows P1, P4.
2. **The boundary is exact, in bytes.** Exactly `CAP` bytes is parsed (a quoted mention passes, a real merge is refused
   for what it is); `CAP + 1` is not. A multi-byte command is measured in bytes. → the boundary and the bytes cases;
   rows P3, P5.
3. **Both words, each one.** An over-cap command missing either word passes unparsed. → "lets an over-cap command
   through unparsed when it lacks either word"; rows P2, P7, P8.
4. **Only where the deny applies.** No hold and no marker: never refused, over the cap or under it; a marked child is
   refused over the cap too, with the child's reason. → "refuses only where the deny applies"; rows P6 (the child's
   half) and P10 (the unheld half: a refusal with no hold, through the case's own `toBeNull`). P9 reds the same case
   only through a `set -u` crash on the unset reason, so P10 is the row that pins the unheld half.
5. **Over the cap the parse never runs.** 36 KB of the costliest shape answers inside the bound, held and refused, or
   unheld and passed. → "answers an over-cap quote-dense command in bounded time"; row P1 (5.6 s), and in the
   advisory's file row Q3.
6. **What the strip can still cost is pinned at the cap.** Five quote-dense shapes at exactly `CAP` bytes, through the
   whole hook, under the 1500 ms bound. A cap raised past what the strip can afford reds. → Task 2's `QUOTE_DENSE`;
   row Q1.
7. **H40's guard is live again (review 249 F1).** A `$(` that never closes in an unquoted heredoc body is kept raw,
   never stripped again. → Task 2's fail-closed case; row H40.
8. **Every member of the merge word's end class is pinned (review 249 F2), and the "four answers" count is pinned
   (F3).** → Task 3; rows R1, R2.
9. **A closed PR's queue word is `none` only when the queue call answered.** A failed call still says `unmeasured` on
   every line; the landing lane reads `none` and `unmeasured` alike (silence), so no notice changes. → Task 3's closed
   case; row R3.
10. **Doctor's `jq_regex` FAILs exactly when the deny would fail open for want of a regex engine,** with a remedy, and
    never answers for a box it did not measure: a server-role box and a box with no jq SKIP; its PASS names the jq it
    measured. → Task 3's five cases and the re-measured golden; rows J1–J8 and J4r.
11. **The landing advisory's own regex stays linear on quote runs.** Pre-flight 2 measured it; the 36 KB quote-dense
    cases pin it, because over the cap and with no `gh` the deny passes them after one fixed-string scan and the clock
    times the advisory alone. → Task 2's 36 KB `QUOTE_DENSE` cases; row Q2.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `ccd/session-hook.sh` | the cap's header paragraph and `MERGE_PARSE_CAP=2048` above `GH_MERGE_RE`; `capped(f)` wraps the deny program's last line; the arm reads the tag, adds the over-cap branch and its reason (+44 / −4) | 1 |
| `server/test/session-hook-merge-deny.test.ts` | `CAP` (read from the hook) and `sized`; the 100 KB adversarial case runs at the cap, renamed for what it can still catch; the cap's five cases (Task 1). The heredoc timing case runs at the cap with a terminated payload, and the fail-closed H40 case (Task 2). Three operator-terminator rows (Task 3). 71 → 76 → 77 → 80 | 1, 2, 3 |
| `server/test/session-hook-sync-advisory.test.ts` | five quote-dense shapes at the cap, and the same five at 36 KB (68 → 78) | 2 |
| `ccd/ccd` | `_pr_queue_py`'s `word()`: a closed PR outside both windows reads `none`; the header's word table says so; re-stamped | 3 |
| `server/test/ccd-pr-queue.test.ts` | the closed case (13 → 14) | 3 |
| `ccd/ccrc-doctor-checks` | `jq_regex` in the table after `jq`; `_check_jq_regex` after `_check_jq` | 3 |
| `server/test/ccrc-doctor.test.ts` | the `jq_regex` describe, five cases (633 → 638) | 3 |
| `server/test/ccrc-install.test.ts` | `BASE_LIVE_SHAPE`: one `"jq_regex": "PASS"` line in each of its three doctor maps, re-measured by Plan 3a Task 10 Step 3's procedure (303, unchanged) | 3 |
| `server/test/coordinator-skill.test.ts` | one assertion on "gives one of four answers." (156, unchanged) | 3 |
| `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md` | the H20, H21, H39 and H40 rows (Task 2), the review-lens size line (Task 3), Task 7 Step 1's preconditions paragraph (Task 4) — text only | 2, 3, 4 |

Nothing under `server/src`, `shared/`, `pwa/`, `agent/` or `.github/` changes, so the PR's CI runs its selected server
tests plus the full agent and PWA legs.

---

## Pre-flight findings (measured while planning; not deviations)

1. **The cap's value, measured.** CPU time of the WHOLE hook (fixture HOME, `nohold`, tail `\n# merge origin main`, so
   the deny's strip runs and nothing is denied), on `main` without a cap, load ~18, two runs each:

   | Shape (repeated) | 2048 B | 4096 B | 8192 B | 16384 B |
   |---|---|---|---|---|
   | bare `"` | 117–132 ms | 191–193 ms | 372–413 ms | 706–729 ms |
   | `'` runs | 116–118 ms | — | 391–402 ms (load ~100) | 626–695 ms (load ~100) |
   | top-level `$(` runs | 56–63 ms | — | 75–80 ms | — |
   | `"$('')"` (a quoted substitution holding a quote) | 317–337 ms | 592–644 ms (load ~100) | 1175–1210 ms (load ~100) | — |
   | `"$(<)"` | 317–380 ms | 640–660 ms | 1198–1254 ms | 2339–2392 ms |

   The hook's own floor is ~60–75 ms. The costliest shape is a run of short quoted substitutions that are not
   "plain" (a quote, `<`, `\`…), because each one is a nested strip that compiles the whole `DEFS` regex again: about
   0.17 ms of CPU per byte, against bare `"`'s 0.045. 25 % of the 1500 ms bound is 375 ms, so the largest round size
   is **2048** (`"$(<)"` 317–380 ms); 4096 is ~44 %. Of the three shapes the brief names, bare `"` is the worst and
   would allow 8192 (372–413 ms) — see Open question 1. Other shapes tried at 8192 and cheaper than bare `"`: `$'`,
   ` #\n`, `<<a\na\n`, `$$`, `${x}`, `\a`, `"$(a)"`, `$((1))`, `"${x}"`, `` `a` ``, `"$("` (nested and unclosed),
   `"'$(` mixed.
2. **The landing advisory is linear on the same shapes**, so it gets no cap (the brief's condition). With a tail that
   reaches the advisory but not the deny (`\n# git pull origin main`, no `merge`): every shape above at 100 KB costs
   115–134 ms of CPU, against 115 ms for prose. Task 2 pins it: the five shapes at 36 KB with a `merge` tail and no
   `gh` (the deny passes them after one scan) took 91–134 ms wall through the whole hook at load ~13, and a regex that
   walks from every quote (row Q2) takes 8.7–24 s there.
3. **What the cap costs, counted.** A read-only census of the last two days of Bash tool calls in this box's agent
   transcripts (45,507 commands, all sessions, held or not; lengths and substrings only, no content printed):

   | Longer than | commands | holding `gh` and `merge` | of those `gh pr create/edit/comment` | of those mail (`ccrc-api`/`mail`) | literal `gh pr merge` |
   |---|---|---|---|---|---|
   | 2048 B | 3460 | 938 | 217 | 459 | 132 |
   | 4096 B | 1166 | 415 | 89 | 202 | 42 |
   | 8192 B | 222 | 114 | 7 | 63 | 10 |

   `gh` is a substring of "github", "though", "high", so the second column is wide. Only a held or child session is
   refused, and the census cannot tell which sessions were held: it is an upper bound. At 2048 up to ~470 commands a
   day across the fleet would be refused with "split it"; at 8192, ~57.
4. **The cap retires three of wave 2's timing rows.** Re-run after Task 1 (76 cases), wave 2's deny JSON (61 rows)
   reds 58 times; **H20, H21 and H39 measure GREEN**: each is a superlinear walk that wave 2 pinned by timing a 36 or
   100 KB command, and no command that long is parsed any more. Every other row reds through a case, not a clock. They
   stay green on the branch tip (80 cases) and at a cap of 8192 too (measured), so no cap the operator might choose in
   Open question 1 revives them. Task 2 Step 3 marks the three rows retired in the merged wave-2 plan, as it does H40's,
   and Task 1 renames the merge-deny case that once caught them for what it still checks.
5. **H40 at the cap.** The review's mutation (`elif $open then .` → `elif $open then "$(" + (.[2:] | qs(true))`) costs
   302 ms of CPU against 83 on a 2039-byte terminated payload (1575 against ~80 at 8189 bytes, 4763 at 15999): under
   any bound a loaded box can hold, at the cap. Its red is therefore a rule, not a clock: re-stripping drops a '…'
   span, and the merge line inside it, that the raw text keeps.
6. **A closed PR, measured safe.** `queueFor` (`server/src/prstate.ts`) is the only reader of the word, and its only
   consumer is the landing lane, whose `landingVerdict` (`server/src/coord/landing.ts`) fires on `dequeued` or
   `phase === 'merged'` alone: `none` and `unmeasured` are both silence. `pr-queue-lane` (18) and `landing-verdict`
   (28) stay green, and no server file changes. **But `PR_QUEUE_MAP`'s gloss now says less than ccd does:**
   `server/src/prstate.ts` reads `unmeasured: 'the queue read did not answer, or the bound PR is outside its windows'`,
   with no "not closed" qualifier, so after Task 3 a closed PR outside its windows is `none` in ccd's word table and
   still matches the server's `unmeasured` gloss. No behaviour reads the gloss (it is documentation enumerated once), so
   this wave leaves it, rather than become a server deploy, and lists it under `closed-reads-none-only-when-answered`: the next
   wave that touches server code qualifies it.
7. **The doctor check against the fixtures.** Every doctor fixture links the REAL jq (`healthy()`, and
   `ccrc-doctor-graphify`'s) or has none (`broken()`), so `jq_regex` PASSes or SKIPs; this box's jq 1.7 answers `true`.
   No doctor EXIT code moves, but one golden does: Plan 3a's `BASE_LIVE_SHAPE` in `ccrc-install.test.ts` lists every
   doctor class but `codex` on the fleet box's live shape, so a new check reds its three rehearsal cases (`3 failed |
   3 passed` under `-t 'cutover rehearsal'`) until Task 3 Step 7 re-measures it. Re-measured on a disposable copy of
   the tree by the golden's own procedure, the answer minus `codex` (Plan 3a's own check, which the cases add apart)
   equals the golden plus one `"jq_regex": "PASS"` after `"jq": "PASS"` in each of its three maps, key order included;
   the refreshes are unchanged. With that edit, every case of `ccrc-install` (283 here) and `ccrc-update` (471) is
   green on the tip, in the slices the Global Constraints spell; `ccrc-doctor-graphify` stays 30/30.
8. **The citation census is unmoved.** `cite-remeasure.py` with base `origin/main` and `--files
   ccd/ccd,README.md,ccd/session-hook.sh` on the whole prototype: every `byFile` key stated = base = tree
   (`ccd/ccd` 147, `ccd/session-hook.sh` 21, …), total 197, row array 52, site array 35, every ENTERED/LEFT list empty.
   The citation cases read `7 passed | 328 skipped (335)`.
9. **The over-cap path is cheap.** Held, tail `\ngh pr merge 42`, refused: 64 ms of CPU at 2049 B, 84 ms at 36 KB,
   126 ms at 100 KB for `"$(<)"` (129 ms for bare `"`). Unheld it passes in the same time: no session pays the strip on
   a long command any more, held or not.

---

## The tools

Write them into `$SCRATCH/lo-w3` once; they are measurement instruments, never committed. `mutate.py` and
`cite-remeasure.py` are the merged wave-2 plan's, byte for byte; extract them rather than retyping:

```bash
SCRATCH=<your scratchpad, absolute>; mkdir -p "$SCRATCH/lo-w3"
python3 - "$SCRATCH/lo-w3" <<'PY'
import re, sys
t = open('docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md').read()
for b in re.findall(r"```python\n(.*?)```", t, re.S):
    if b.startswith('#!/usr/bin/env python3\n"""Mutation runner'):
        open(sys.argv[1] + '/mutate.py', 'w').write(b)
    if b.startswith('#!/usr/bin/env python3\n"""Re-measure session-hook.test.ts'):
        open(sys.argv[1] + '/cite-remeasure.py', 'w').write(b)
PY
ls "$SCRATCH/lo-w3"
```

Expected: `cite-remeasure.py  mutate.py`. Use: write a task's rows (the JSON blocks below) to
`$SCRATCH/lo-w3/mut-<task>.json`, then from the worktree root `python3 "$SCRATCH/lo-w3/mutate.py"
"$SCRATCH/lo-w3/mut-<task>.json"` (optionally followed by row ids; at most ~12 rows per 600 s call). It copies each
file aside, applies one row, runs each named file in its own vitest process with `--maxWorkers=1`, restores the copy
and asserts byte equality. After the run, `git status --short` lists exactly the files the task changed.

`replay.py` is the planning instrument, kept here for the reviewer: it applies this document's `<!-- replay: OP FILE
-->` blocks for a range of tasks to the working tree, refusing any anchor that does not occur exactly once both in the
tree and on `origin/main`. Replaying Tasks 1–4 at once onto `main` gives a tree identical to the task-by-task
replay this plan was measured on.

```python
#!/usr/bin/env python3
"""Replay a plan's `<!-- replay: OP FILE -->` blocks onto the working tree, in document order.
usage: replay.py <plan.md> <task-from> <task-to>   (applies the blocks under `### Task N` for N in [from, to])
OP: replace (old block, then new) | insert-above / insert-below (anchor block, then new) | append | create.
Every old/anchor block must occur EXACTLY ONCE in the file as it stands, and — when the file exists on
origin/main — exactly once there too. Re-stamps ccd/ccd after any edit to it (`ccrc restamp`)."""
import os, re, subprocess, sys
plan, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
lines = open(plan, encoding='utf8').read().split('\n')
FENCE = '`' * 3
MARK = re.compile(r'^<!-- replay: (replace|insert-above|insert-below|append|create) (\S+) -->$')
task, i, ops = 0, 0, []
def block(k):
    while not lines[k].startswith(FENCE):
        k += 1
    s = k + 1
    e = s
    while lines[e] != FENCE:
        e += 1
    return '\n'.join(lines[s:e]), e + 1
while i < len(lines):
    m = re.match(r'^### Task (\d+):', lines[i])
    if m:
        task = int(m.group(1))
    mm = MARK.match(lines[i])
    if mm:
        op, f = mm.groups()
        a, j = block(i + 1)
        b = None
        if op in ('replace', 'insert-above', 'insert-below'):
            b, j = block(j)
        ops.append((task, op, f, a, b, i + 1))
        i = j
        continue
    i += 1
def on_main(f):
    r = subprocess.run(['git', 'show', f'origin/main:{f}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None
n = 0
for task, op, f, a, b, ln in ops:
    if not (lo <= task <= hi):
        continue
    n += 1
    if op == 'create':
        open(f, 'w', encoding='utf8').write(a + '\n'); continue
    s = open(f, encoding='utf8').read()
    if op == 'append':
        open(f, 'w', encoding='utf8').write(s + a + '\n'); continue
    assert s.count(a) == 1, f'plan line {ln}: {op} {f}: anchor occurs {s.count(a)} times in the tree'
    m = on_main(f)
    assert m is None or m.count(a) == 1, f'plan line {ln}: {op} {f}: anchor occurs {m.count(a)} times on origin/main'
    if op == 'replace':
        s = s.replace(a, b, 1)
    elif op == 'insert-above':
        s = s.replace(a, b + '\n' + a, 1)
    else:
        s = s.replace(a, a + '\n' + b, 1)
    open(f, 'w', encoding='utf8').write(s)
    if f == 'ccd/ccd':
        subprocess.run([os.path.expanduser('~/.local/bin/ccrc'), 'restamp', 'ccd/ccd'], check=True)
print(f'applied {n} blocks for Tasks {lo}-{hi}')
```

---

### Task 1: The payload cap — the deny parses no command longer than 2048 bytes

**Model routing:** `opus`, effort `high` (security-sensitive: it decides what the deny never reads).

**Files:**
- Modify: `server/test/session-hook-merge-deny.test.ts`
- Modify: `ccd/session-hook.sh` (below `GH_MERGE_RE`'s header, ≈3505–3570)

**Interfaces:**
- Consumes: the deny arm as wave 2 shipped it (`MERGE_STRIP_JQ`, `GH_MERGE_RE`, the hold/marker reads).
- Produces: `MERGE_PARSE_CAP=2048`, a bare integer assignment at column 0 that the tests READ; the jq program's tagged
  answer (`=` + stripped command | `!` + byte count | empty); the over-cap reason. Task 2's pin reads the constant.

- [ ] **Step 1: Write the failing tests**

In `server/test/session-hook-merge-deny.test.ts`, find:

<!-- replay: insert-below server/test/session-hook-merge-deny.test.ts -->
```ts
const marker = (): void => { fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.child`), '17'); };
```

and insert, directly below it, the cap read from the hook and the payload builder:

```ts

/** The payload cap, READ from the hook (never re-typed here): a command longer
 *  than this many bytes is never parsed (landing-order wave 3). */
const CAP = ((): number => {
  const m = /^MERGE_PARSE_CAP=(\d+)$/m.exec(fs.readFileSync(HOOK, 'utf8'));
  if (m === null) throw new Error('the hook no longer defines MERGE_PARSE_CAP as a bare integer');
  return Number(m[1]);
})();
/** `unit` repeated, then `tail`, cut to exactly `bytes` bytes (ASCII units). */
const sized = (unit: string, tail: string, bytes: number): string =>
  unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes - tail.length) + tail;
```

In the same file, find the 100 KB adversarial case (≈184–203):

<!-- replay: replace server/test/session-hook-merge-deny.test.ts -->
```ts
  it('answers a 100 KB adversarial command in bounded time — the head match restarts at every separator', () => {
    // A token class that can cross a separator, or a blank class that includes
    // the newline, makes every `;a=` / `\na=` / `;gh -R ` start walk to the end
    // of the payload: 5 to 9 s at 36 KB, and 1.6 s at 36 KB for the gh-flag
    // classes alone (so 100 KB, where a walk costs ~12 s and the fix ~0.2 s). An
    // unterminated `<<a` is the strip's own walk: a heredoc that had to find its
    // terminator would scan to the end once per `<<`. The tail carries `merge`
    // outside any quote or comment, so the prefilter lets the match run and a
    // regex that matched any `merge` would deny; none is a merge. The hold makes
    // a wrong match a deny this case can see (review 241 F6).
    hold(WAVE_HOLD);
    const units = [';', '\n'].flatMap((sep) => ['a=', 'gh ', 'gh -R ', 'timeout 1 '].map((unit) => `${sep}${unit}`));
    for (const u of [...units, '<<a\n']) {
      const t0 = Date.now();
      const r = bash(u.repeat(Math.ceil(100000 / u.length)) + '\necho merge origin');
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(u)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on ${JSON.stringify(u)}`).toBeLessThan(3000);
    }
  }, 60000);
```

and replace it with the same units at exactly the cap. Over the cap a unit holding `gh` (`;gh `, `\ngh -R `) would now
be refused unread, so this case keeps the regex and the strip honest at the largest size they still read; Task 1's own
cases keep everything longer out. At the cap the separator walks cost too little for its clock to catch (wave 2's H20,
H21 and H39 measure green here, Pre-flight 4), so the case is renamed for what it still checks, no false deny at the
boundary; its red is row P3:

```ts
  it('denies none of a cap-sized adversarial command, in bounded time — the separator walks the cap now bounds', () => {
    // A token class that can cross a separator, or a blank class that includes
    // the newline, makes every `;a=` / `\na=` / `;gh -R ` start walk to the end
    // of the payload: 5 to 9 s at 36 KB, and 1.6 s at 36 KB for the gh-flag
    // classes alone, before the payload cap. Since the cap nothing longer than
    // MERGE_PARSE_CAP bytes is parsed, so these run at exactly the cap, the
    // largest command the strip and the head match still read; the cap's own
    // cases below keep everything longer out. At this size those walks cost too
    // little for the clock to catch (wave 2's rows H20, H21 and H39 measure
    // green here, at 2048 and at 8192): the cap, not this clock, is their guard
    // now, and this case is the boundary and no-false-deny check it reads as.
    // An unterminated `<<a` is the strip's own walk. The tail carries `merge`
    // outside any quote or comment, so the prefilter lets the match run and a
    // regex that matched any `merge` would deny; none is a merge. The hold
    // makes a wrong match a deny this case can see (review 241 F6).
    hold(WAVE_HOLD);
    const units = [';', '\n'].flatMap((sep) => ['a=', 'gh ', 'gh -R ', 'timeout 1 '].map((unit) => `${sep}${unit}`));
    for (const u of [...units, '<<a\n']) {
      const c = sized(u, '\necho merge origin', CAP);
      expect(Buffer.byteLength(c)).toBe(CAP);
      const t0 = Date.now();
      const r = bash(c);
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(u)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on ${JSON.stringify(u)}`).toBeLessThan(1500);
    }
  }, 60000);
```

In the same file, find (≈223):

<!-- replay: insert-above server/test/session-hook-merge-deny.test.ts -->
```ts
  // Review 241 F1: the strip once kept a "…" span that held a `$(` whole, so
```

and insert, directly above it, the cap's own describe:

```ts
  // THE PAYLOAD CAP (landing-order wave 3). Over MERGE_PARSE_CAP bytes nothing
  // is parsed: the raw command is asked only whether it holds both `gh` and
  // `merge`, and a held or child session's command that does is refused unread.
  describe('the payload cap', () => {
    const MENTION = 'echo "gh pr merge" ';
    it('parses a command of exactly the cap, and refuses one byte more unread — naming both numbers', () => {
      hold(WAVE_HOLD);
      expect(bash(sized(MENTION, 'x', CAP)).deny, 'at the cap the strip reads the quoted mention as text').toBeNull();
      const over = bash(sized(MENTION, 'x', CAP + 1)).deny;
      expect(over, 'one byte over the cap, a command holding both words was let through').not.toBeNull();
      expect(over).toContain(`this command is ${CAP + 1} bytes`);
      expect(over).toContain(`${CAP}-byte parse cap`);
      expect(over).toContain(WAVE_HOLD);
      expect(over).toContain('the coordinator merges, workers never do');
      // A real merge at the cap is read, and refused for what it is.
      const real = bash(sized('gh pr merge 42 ', ' ', CAP)).deny;
      expect(real).not.toBeNull();
      expect(real, 'a merge at the cap was refused unread: the parse did not run').not.toContain('parse cap');
    });

    it('counts bytes, not characters', () => {
      hold(WAVE_HOLD);
      // Each `é` is two bytes: fewer characters than the cap, more bytes.
      const c = 'echo gh merge ' + 'é'.repeat(Math.ceil(CAP / 2));
      expect(c.length).toBeLessThan(CAP);
      expect(Buffer.byteLength(c)).toBeGreaterThan(CAP);
      const d = bash(c).deny;
      expect(d, 'a command over the cap in BYTES was parsed as if it were under it').not.toBeNull();
      expect(d).toContain(`this command is ${Buffer.byteLength(c)} bytes`);
    });

    it('lets an over-cap command through unparsed when it lacks either word', () => {
      hold(WAVE_HOLD);
      // The fixture's cwd carries `merge`, so the arm's substring prefilter
      // passes whatever the command says, and the jq program is reached.
      expect(home).toContain('merge');
      expect(bash(sized('echo merge ', ' ', CAP + 1)).deny, 'no `gh` in it').toBeNull();
      expect(bash(sized('gh pr view 42 ', ' ', CAP + 1)).deny, 'no `merge` in it').toBeNull();
    });

    it('refuses only where the deny applies: a session with no wave hold and no marker is never asked', () => {
      expect(bash(sized('gh pr merge 42 ', ' ', CAP + 1)).deny).toBeNull();
      marker();
      const r = bash(sized('gh pr merge 42 ', ' ', CAP + 1)).deny;
      expect(r, 'a marked child\'s over-cap merge went through').not.toBeNull();
      expect(r).toContain('child marker');
      expect(r).toContain('parse cap');
    });

    it('answers an over-cap quote-dense command in bounded time — the strip never reads it', () => {
      // `"$(<)"` repeated is the costliest shape measured per byte (one nested
      // strip per span): ~350 ms of CPU at 2048 bytes, so 36 KB parsed would
      // take seconds. Over the cap it costs one fixed-string scan.
      hold(WAVE_HOLD);
      for (const [unit, tail, denied] of [['"$(<)"', '\ngh pr merge 42', true], ['"', '\necho merge origin', false]] as const) {
        const c = sized(unit, tail, 36000);
        const t0 = Date.now();
        const r = bash(c);
        const ms = Date.now() - t0;
        expect(r.deny !== null, `${JSON.stringify(unit)}: denied ${r.deny !== null}`).toBe(denied);
        expect(ms, `the hook took ${ms} ms on 36 KB of ${JSON.stringify(unit)}`).toBeLessThan(1500);
      }
    }, 60000);
  });

```

The heredoc timing case (≈205) is left as it is in this task: its 16 KB payloads hold `merge` but no `gh`, so over the
cap they now pass unparsed and fast, and it stays green. Task 2 moves it to the cap with review 249's terminator.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run --maxWorkers=1 test/session-hook-merge-deny.test.ts
```

Expected: FAIL at collection — `Error: the hook no longer defines MERGE_PARSE_CAP as a bare integer`, `Tests  no
tests`. (Measured beyond that: with the constant line alone added to the hook, `4 failed | 72 passed (76)`: the
boundary case "one byte over the cap, a command holding both words was let through", the bytes case, the child case,
and "the hook took 7334 ms on 36 KB of "$(<)"".)

- [ ] **Step 3: The cap, its header, and the constant**

In `ccd/session-hook.sh`, find the last line of the deny header's COMPLEXITY paragraph (≈3505):

<!-- replay: insert-below ccd/session-hook.sh -->
```bash
# line once recursed once per `<<`: 15 s and 2.9 GB at 36 KB, measured).
```

and insert, directly below it (above `GH_MERGE_RE=`):

```bash
# THE PAYLOAD CAP (landing-order wave 3): a command longer than
# MERGE_PARSE_CAP bytes (UTF-8, as jq's `utf8bytelength` counts them) is never
# parsed: neither the strip nor GH_MERGE_RE reads it. The strip's cost grows
# with the quoted spans and substitutions it reads, and a hook that times out
# or a jq killed for memory fails this deny OPEN (above), so an unbounded
# command was a way past it. Over the cap the program asks the RAW command two
# fixed-string questions, each one scan with no regex: does it contain `gh`,
# and does it contain `merge`? Both: the arm reads it as a merge it could not
# parse, and a held or child session is DENIED with a reason that names the
# length and the cap and tells it to split the command (a long PR body or mail
# goes in a file the Write tool writes, passed by path); a landing is the
# operator's, from their own shell. Either one missing: it passes unparsed.
# Only where the deny already applies: a session with no wave hold and no
# child marker is never refused, under the cap or over it. THE VALUE IS
# MEASURED: the largest round size at which the worst quote-dense shape
# measured costs about a quarter of `session-hook-sync-advisory.test.ts`'s
# 1500 ms whole-hook bound. That shape is a run of quoted substitutions that
# each hold a quote or a `<` (`"$(<)"` repeated), one nested strip per span:
# ~350 ms of CPU at 2048 bytes and ~650 ms at 4096 (bare `"`: ~125 and
# ~190 ms), measured on the fleet box at load ~18.
# THE COST, said: a held session's long command that merely holds both words
# (a PR body, a mail, a heredoc that says "github" and "merge") is refused
# until it is split. The cap also BOUNDS every superlinear walk above: the
# strip and GH_MERGE_RE never read more than MERGE_PARSE_CAP bytes, so the
# 36-200 KB timings above are what the cap prevents, not what a command costs.
MERGE_PARSE_CAP=2048
```

- [ ] **Step 4: The jq program measures before it strips**

In `ccd/session-hook.sh`, find the deny program's last line (≈3551; it stays, verbatim, as `capped`'s argument, so
wave 2's row H11 still finds it):

<!-- replay: replace ccd/session-hook.sh -->
```bash
if .tool_name == "Bash" then ((.tool_input.command // "") | qs(true)) else "" end'
```

with

```bash
def capped(f): (.tool_input.command // "") as $c
  | if ($c | type) == "string" and ($c | utf8bytelength) > $cap
    then (if ($c | contains("gh")) and ($c | contains("merge")) then "!\($c | utf8bytelength)" else "" end)
    else "=" + f end;
capped(if .tool_name == "Bash" then ((.tool_input.command // "") | qs(true)) else "" end)'
```

jq binds a function's filter argument as a closure, so `f` (the strip) runs only on the `else` branch. `contains` on
strings is a substring scan, no regex. A command that is not a string keeps the old behaviour: `utf8bytelength` is
never asked, `f` errors as `qs` did, the hook reads nothing and passes.

- [ ] **Step 5: The arm reads the tag**

In `ccd/session-hook.sh`, find (≈3554–3555):

<!-- replay: replace ccd/session-hook.sh -->
```bash
  mcmd=$(jq -r --arg q "'" "$MERGE_STRIP_JQ" <<<"$payload" 2>/dev/null) || mcmd=""
  if [[ -n "$mcmd" && "$mcmd" =~ $GH_MERGE_RE ]]; then
```

with

```bash
  mout=$(jq -r --arg q "'" --argjson cap "$MERGE_PARSE_CAP" "$MERGE_STRIP_JQ" <<<"$payload" 2>/dev/null) || mout=""
  mcmd="" mover=""
  case "$mout" in
    '='*) mcmd=${mout#=} ;;
    '!'*) mover=${mout#!} ;;
  esac
  if [[ -n "$mover" ]] || [[ -n "$mcmd" && "$mcmd" =~ $GH_MERGE_RE ]]; then
```

Then find the reason block (≈3562–3564):

<!-- replay: replace ccd/session-hook.sh -->
```bash
    if [[ -n "$mwhy" ]]; then
      mreason="ccrc: $mwhy, and a wave's session never merges (landing-order R5: the coordinator merges, workers never do)."
      mreason+=" Report wave-done to your coordinator; it lands the PR."
```

with — the over-cap reason names the length, the cap, both words and the way out; the original reason is kept for a
parsed merge, and the existing `pre_json=…` line now follows a guard of its own:

```bash
    if [[ -n "$mwhy" && -n "$mover" ]]; then
      mreason="ccrc: this command is $mover bytes, over the merge deny's $MERGE_PARSE_CAP-byte parse cap, and it holds the strings \`gh\` and \`merge\`, so the deny cannot read it for a \`gh pr merge\`; $mwhy, and a wave's session never merges (landing-order R5: the coordinator merges, workers never do)."
      mreason+=" Split it into commands of at most $MERGE_PARSE_CAP bytes: write a long PR body or mail to a file with the Write tool and pass the path (\`gh pr create --body-file <file>\`, \`ccrc-api ... --json <file>\`). A landing is the operator's, from their own shell."
    elif [[ -n "$mwhy" ]]; then
      mreason="ccrc: $mwhy, and a wave's session never merges (landing-order R5: the coordinator merges, workers never do)."
      mreason+=" Report wave-done to your coordinator; it lands the PR."
    fi
    if [[ -n "$mwhy" ]]; then
```

- [ ] **Step 6: Run the tests to verify they pass — one file per process**

```bash
cd server
./node_modules/.bin/vitest run --maxWorkers=1 test/session-hook-merge-deny.test.ts
./node_modules/.bin/vitest run --maxWorkers=1 test/session-hook-sync-advisory.test.ts
for f in hookstate install-session-hooks ask-instance-guard update-branch-absent session-hook-turnmark; do
  ./node_modules/.bin/vitest run --maxWorkers=2 "test/$f.test.ts" | grep -E '^ +Tests '
done
./node_modules/.bin/vitest run test/run-routes.test.ts -t 'binds the shared cap'
cd ..
```

Then THE GUARD LOOP (Global Constraints).

Expected: `76 passed (76)`; `68 passed (68)`; `54`, `13`, `3`, `2`, `54`; `1 passed | 229 skipped (230)`; the guard loop
`272`, `7`, `23`, `11`, `12`, `79`, `14`, `31`.

- [ ] **Step 7: The citation tax (expected: nothing moves)**

```bash
SCRATCH=<abs>; python3 "$SCRATCH/lo-w3/cite-remeasure.py" "$SCRATCH/lo-w3" origin/main --files ccd/session-hook.sh
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: every `byFile` key `stated N base N tree N` with no `<-- MOVED` (`ccd/session-hook.sh` 21), `total stated
197 base 197 tree 197`, row array 52/52/52, site array 35/35/35, every ENTERED/LEFT empty; then `7 passed | 328
skipped (335)`.

- [ ] **Step 8: Mutation check — this task's rows, then wave 2's table under the cap**

| # | Exact edit in `ccd/session-hook.sh` | Test file | Expected red (measured at this task's tree, 76 cases; the branch-tip counts are in Task 5 Step 3) |
|---|---|---|---|
| P1 | the cap removed: `($c \| utf8bytelength) > $cap` → `false` | `session-hook-merge-deny` | `4 failed \| 72 passed` — "one byte over the cap, a command holding both words was let through", the bytes case, the child case ("…to contain 'parse cap'"), "the hook took 5264 ms on 36 KB of "$(<)"" |
| P2 | the both-words condition dropped: `if ($c \| contains("gh")) and ($c \| contains("merge")) then` → `if true then` | same | `3 failed` — "a non-merge was denied: "<<a ": expected 'ccrc: this command is 16018 bytes…'" (the heredoc case, still 16 KB until Task 2), "no `gh` in it: expected 'ccrc: this command is 2049 bytes…' to be null", `"\"": denied true` |
| P3 | the boundary off by one: `> $cap` → `>= $cap` | same | `2 failed` — "a non-merge was denied: ";gh "", "at the cap the strip reads the quoted mention as text" |
| P4 | the arm ignores the over-cap answer: `if [[ -n "$mover" ]] \|\| [[ -n "$mcmd" …` → `if [[ -n "$mcmd" …` | same | `4 failed` — the boundary, bytes and child cases, and `"\"$(<)\"": denied false` |
| P5 | characters, not bytes: `utf8bytelength` → `length` in the cap test | same | `1 failed` — "a command over the cap in BYTES was parsed as if it were under it" |
| P6 | the over-cap reason lost: `    if [[ -n "$mwhy" && -n "$mover" ]]; then` → `    if false; then` | same | `3 failed` — "…to contain 'this command is 2049 bytes'", "…'this command is 2062 bytes'", "…to contain 'parse cap'" |
| P7 | only `gh` asked: ` and ($c \| contains("merge")) then` → ` then` | same | `1 failed` — "no `merge` in it" |
| P8 | only `merge` asked: drop `($c \| contains("gh")) and ` | same | `3 failed` — the same three as P2 |
| P9 | refused without a hold: `    if [[ -n "$mwhy" ]]; then` (before `pre_json=`) → `    if [[ -n "$mwhy" \|\| -n "$mover" ]]; then` | same | `1 failed` — "the hook contract: silent on stderr" (an unheld over-cap command reaches `_hook_deny_json` with `mreason` unset under `set -u`: the hook CRASHES, and the case's own `toBeNull` would pass; P10 is the non-crashing form) |
| P10 | a refusal with no hold, no crash: `    mwhy=""` → `    mwhy=""; [[ -n "$mover" ]] && mwhy="over"` | same | `1 failed` — "refuses only where the deny applies…": `expected 'ccrc: this command is 2049 bytes, ove…' to be null` |

Rows (`$SCRATCH/lo-w3/mut-task1.json`):

```json
[
 {"id": "P1", "file": "ccd/session-hook.sh", "old": "($c | utf8bytelength) > $cap", "new": "false", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P2", "file": "ccd/session-hook.sh", "old": "if ($c | contains(\"gh\")) and ($c | contains(\"merge\")) then", "new": "if true then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P3", "file": "ccd/session-hook.sh", "old": "($c | utf8bytelength) > $cap", "new": "($c | utf8bytelength) >= $cap", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P4", "file": "ccd/session-hook.sh", "old": "  if [[ -n \"$mover\" ]] || [[ -n \"$mcmd\" && \"$mcmd\" =~ $GH_MERGE_RE ]]; then", "new": "  if [[ -n \"$mcmd\" && \"$mcmd\" =~ $GH_MERGE_RE ]]; then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P5", "file": "ccd/session-hook.sh", "old": "($c | utf8bytelength) > $cap", "new": "($c | length) > $cap", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P6", "file": "ccd/session-hook.sh", "old": "    if [[ -n \"$mwhy\" && -n \"$mover\" ]]; then", "new": "    if false; then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P7", "file": "ccd/session-hook.sh", "old": " and ($c | contains(\"merge\")) then", "new": " then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P8", "file": "ccd/session-hook.sh", "old": "if ($c | contains(\"gh\")) and ($c | contains(\"merge\")) then", "new": "if ($c | contains(\"merge\")) then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P9", "file": "ccd/session-hook.sh", "old": "    if [[ -n \"$mwhy\" ]]; then\n      pre_json=$(_hook_deny_json", "new": "    if [[ -n \"$mwhy\" || -n \"$mover\" ]]; then\n      pre_json=$(_hook_deny_json", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "P10", "file": "ccd/session-hook.sh", "old": "    mwhy=\"\"\n", "new": "    mwhy=\"\"; [[ -n \"$mover\" ]] && mwhy=\"over\"\n", "tests": ["test/session-hook-merge-deny.test.ts"]}
]
```

Then wave 2's deny table, unchanged, against this task's tree — it measures what the cap did to the guards wave 2
pinned by a clock. Extract it from the merged plan and run it in ~12-row batches (each batch one 600 s call):

```bash
SCRATCH=<abs>; python3 - "$SCRATCH/lo-w3" <<'PY'
import json, re, sys
t = open('docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md').read()
rows = next(json.loads(b) for b in re.findall(r"```json\n(.*?)```", t, re.S) if b.lstrip().startswith('[\n {"id": "H1"'))
json.dump(rows, open(sys.argv[1] + '/w2-task4.json', 'w'), indent=1); print(len(rows))
PY
python3 "$SCRATCH/lo-w3/mutate.py" "$SCRATCH/lo-w3/w2-task4.json" H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 H12
# … then H13–H24, H25–H37 (H32 is not in the JSON), H38–H52, H53–H63, C1 C2
```

Expected (measured; `N` = failed of 76): H1 69, H2 4, H3 1, H4 1, H5 1, H6 2, H7 1, H8 1, H9 1, H10 1, H11 1, H12 2,
H13 1, H14 2, H15 3, H16 1, H17 1, H18 1, H19 3, **H20 0, H21 0**, H22 1, H23 1, H24 1, H25 1, H26 12, H27 10, H28 2,
H29 1, H30 1, H31 1, H33 1, H34 1, H35 1, H36 1, H37 1, H38 3, **H39 0**, H42 1, H43 1, H44 2, H46 1, H47 1, H48 2,
H49 1, H50 9, H51 2, H52 1, H53 2, H54 1, H55 1, H56 1, H57 1, H58 1,
H59 11, H60 2, H61 3, H62 4, H63 3; C1 and C2 `1 failed` each in `run-routes -t 'binds the shared cap'` (untouched
text). The three greens are this wave's `timing-cases-run-at-the-cap`; name them in the commit message. Any OTHER
row green is a stop.

- [ ] **Step 9: Commit**

```bash
git add ccd/session-hook.sh server/test/session-hook-merge-deny.test.ts
git commit -m "$(cat <<'MSG'
feat(hook): the merge deny parses no command longer than 2048 bytes

Landing-order wave 3, Task 7's first precondition. A hook that times out or a
jq killed for memory fails the deny OPEN, and quote-dense input could do
either. Over MERGE_PARSE_CAP bytes the deny's jq program never runs the
strip: it asks the raw command whether it holds `gh` and `merge` (fixed
strings), and a held or child session's command holding both is refused
unread, the reason naming the length and the cap. Every other over-cap
command passes unparsed. The cap is the largest round size at which the
costliest shape measured ("$(<)" repeated) costs about a quarter of the
1500 ms whole-hook bound.

merge-deny 71 -> 76; P1-P10 red; wave 2's H20, H21 and H39 measure green
under the cap (their walks can no longer meet a command that long); census
147/197/52/35 unmoved.
MSG
)"
```

---

### Task 2: The quote-dense timing pin, review 249 F1, and a live H40

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/test/session-hook-sync-advisory.test.ts`
- Modify: `server/test/session-hook-merge-deny.test.ts`
- Modify: `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md` (the H20, H21, H39 and H40 rows, text only)

**Interfaces:**
- Consumes: Task 1's `MERGE_PARSE_CAP` (read from the hook, never re-typed).
- Produces: nothing new in shipped code. Both test additions PIN existing behaviour, so they are green on arrival;
  their reds are the rows below. Before Task 1 the pin fails at collection (no `MERGE_PARSE_CAP` to read).

- [ ] **Step 1: The quote-dense pin**

In `server/test/session-hook-sync-advisory.test.ts`, find the 36 KB adversarial case (≈188–195):

<!-- replay: replace server/test/session-hook-sync-advisory.test.ts -->
```ts
  it.each(ADVERSARIAL)('answers a 36 KB adversarial command (%s) inside a generous bound', (_name, command) => {
    expect(command.length).toBeGreaterThan(36000);
    const t0 = Date.now();
    const r = hook(bash(command));
    const ms = Date.now() - t0;
    expect(r.stdout, 'no line of it merges main').toBe('');
    expect(ms, `the whole hook took ${ms} ms`).toBeLessThan(1500);
  });
```

with the same case, followed by the five quote-dense shapes at exactly the cap, and the same five at 36 KB. The 36 KB
cases carry `merge` but no `gh`, so over the cap the deny answers after one fixed-string scan and the clock times the
landing advisory's own regex (Pre-flight 2; review lens 3 asked for this pin, since nothing else times that regex on
quote runs):

```ts
  it.each(ADVERSARIAL)('answers a 36 KB adversarial command (%s) inside a generous bound', (_name, command) => {
    expect(command.length).toBeGreaterThan(36000);
    const t0 = Date.now();
    const r = hook(bash(command));
    const ms = Date.now() - t0;
    expect(r.stdout, 'no line of it merges main').toBe('');
    expect(ms, `the whole hook took ${ms} ms`).toBeLessThan(1500);
  });

  // QUOTE-DENSE, AT THE MERGE DENY'S PAYLOAD CAP (landing-order wave 3). The
  // deny's quote strip runs on every Bash call that carries `merge`, held or
  // not, and pays per quoted span and per quoted substitution: bare `"` took
  // 1584 ms at 36 KB, over this bound. The deny parses nothing longer than
  // MERGE_PARSE_CAP bytes, so these are the costliest commands it still reads:
  // each shape at exactly the cap, the cap READ from the hook. Raising the cap
  // past what the strip can afford reds here. The landing advisory's own regex
  // is linear on these shapes (100 KB of each, ~130 ms, measured), so it has
  // no cap. The tail carries `merge` so the strip runs; no hold, so no deny.
  const CAP = ((): number => {
    const m = /^MERGE_PARSE_CAP=(\d+)$/m.exec(fs.readFileSync(HOOK, 'utf8'));
    if (m === null) throw new Error('the hook no longer defines MERGE_PARSE_CAP as a bare integer');
    return Number(m[1]);
  })();
  const QUOTE_DENSE: Array<[string, string]> = [
    ['bare double quotes', '"'], ["bare single quotes", "'"], ['$( runs', '$('],
    ['quoted substitutions holding a quote', '"$(\'\')"'], ['quoted substitutions holding a <', '"$(<)"'],
  ];
  it.each(QUOTE_DENSE)('answers a quote-dense command at the merge deny\'s cap (%s) inside the bound', (_name, unit) => {
    const tail = '\n# merge origin';
    const command = unit.repeat(Math.ceil(CAP / unit.length)).slice(0, CAP - tail.length) + tail;
    expect(Buffer.byteLength(command)).toBe(CAP);
    const t0 = Date.now();
    const r = hook(bash(command));
    const ms = Date.now() - t0;
    expect(r.stdout).toBe('');
    expect(ms, `the whole hook took ${ms} ms`).toBeLessThan(1500);
  });
  // The same shapes at 36 KB, far over the cap and holding no `gh`: the deny
  // passes them unparsed after one fixed-string scan, so what this clock times
  // is the landing advisory's own regex on quote runs. It is linear there
  // (measured above); a regex that walked from every quote would not be.
  it.each(QUOTE_DENSE)('answers a 36 KB quote-dense command (%s): the deny passes it unparsed, the advisory reads it inside the bound', (_name, unit) => {
    const command = unit.repeat(Math.ceil(36000 / unit.length)) + '\n# merge origin';
    expect(command.length).toBeGreaterThan(36000);
    expect(command, 'a `gh` would make the deny refuse it unread in a held session; this case times the advisory').not.toContain('gh');
    const t0 = Date.now();
    const r = hook(bash(command));
    const ms = Date.now() - t0;
    expect(r.stdout, 'no line of it merges main').toBe('');
    expect(ms, `the whole hook took ${ms} ms`).toBeLessThan(1500);
  });
```

- [ ] **Step 2: Review 249 F1 — the heredoc case at the cap, WITH a terminator, and H40 as a rule**

In `server/test/session-hook-merge-deny.test.ts`, find the heredoc timing case (≈205–221):

<!-- replay: replace server/test/session-hook-merge-deny.test.ts -->
```ts
  it('strips a heredoc line of many `<<` and a body of unclosed `$(` in bounded time — no recursion per `<<`', () => {
    // A heredoc's rest-of-line is stripped WITHOUT a second heredoc, and a `$(`
    // that never closes is kept raw, not stripped again: either one recursing
    // walks the rest of the payload once per `<<` (2.4 to 3.8 s and 0.4 to
    // 0.6 GB at 16 KB, measured on the strip alone; 15 s and 2.9 GB at 36 KB).
    hold(WAVE_HOLD);
    // The second payload's heredoc never terminates, so the strip keeps the
    // whole text raw from its `<<` without reading the `$(`s (the top level
    // has no `$(` arm of its own); the substitution reader never runs here.
    for (const [pre, u] of [['', '<<a '], ['cat <<a\n', '$(cat <<a\n']]) {
      const t0 = Date.now();
      const r = bash(pre + u.repeat(Math.ceil(16000 / u.length)) + '\necho merge origin');
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(u)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on ${JSON.stringify(u)}`).toBeLessThan(1500);
    }
  }, 60000);
```

with — whole units up to the cap, and a third payload whose heredoc completes, so its unquoted body reaches the
substitution reader:

```ts
  it('strips a heredoc line of many `<<` and a body of unclosed `$(` in bounded time — no recursion per `<<`', () => {
    // A heredoc's rest-of-line is stripped WITHOUT a second heredoc, and a `$(`
    // that never closes is kept raw, not stripped again: either one recursing
    // walks the rest of the payload once per `<<` (2.4 to 3.8 s and 0.4 to
    // 0.6 GB at 16 KB, measured on the strip alone; 15 s and 2.9 GB at 36 KB).
    // Each payload is whole units up to the cap, the largest command parsed.
    hold(WAVE_HOLD);
    // The second payload's heredoc never terminates, so the strip keeps the
    // whole text raw from its `<<` without reading the `$(`s (the top level
    // has no `$(` arm of its own). The third has its `a` terminator line
    // (review 249 F1): the heredoc completes, its unquoted body goes to the
    // substitution reader, and the first `$(` there never closes, so it is
    // kept raw once. Re-stripping it would cost ~300 ms here against ~80
    // (measured at the cap), inside any bound a loaded box can hold, so the
    // next case pins the rule itself.
    for (const [pre, u, end] of [['', '<<a ', '\n'], ['cat <<a\n', '$(cat <<a\n', ''], ['cat <<a\n', '$(cat <<a\n', 'a\n']]) {
      const tail = `${end}echo merge origin`;
      const c = pre + u.repeat(Math.floor((CAP - pre.length - tail.length) / u.length)) + tail;
      expect(Buffer.byteLength(c)).toBeLessThanOrEqual(CAP);
      const t0 = Date.now();
      const r = bash(c);
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(u + end)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on ${JSON.stringify(u + end)}`).toBeLessThan(1500);
    }
  }, 60000);
```

In the same file, find the anchor Task 1 inserted its describe above (the new case lands between that describe and the
anchor):

<!-- replay: insert-above server/test/session-hook-merge-deny.test.ts -->
```ts
  // Review 241 F1: the strip once kept a "…" span that held a `$(` whole, so
```

and insert, directly above it:

```ts
  // Review 249 F1, pinned as a rule rather than a clock: a `$(` that never
  // closes inside an UNQUOTED heredoc body (which the substitution reader
  // reads) keeps its RAW text, and is never stripped again. Re-stripping it
  // would drop the '…' span below and the merge line inside it. Bash runs
  // neither (it stops at the unclosed `$(`), so this deny is the fail-closed
  // rule's named cost; what the case proves is that the raw text is kept.
  it('keeps an unclosed `$(` in an unquoted heredoc body raw, never stripped again (review 249 F1)', () => {
    hold(WAVE_HOLD);
    for (const c of ["cat <<a\n$(echo 'x\ngh pr merge 42\n'\na", 'cat <<a\n$(echo "x\ngh pr merge 42\n"\na']) {
      expect(bash(c).deny, `the unclosed $( was stripped again: ${c}`).not.toBeNull();
    }
  });

```

`bash` itself, given the first payload with a harmless line after the terminator, prints `command substitution: line
5: unexpected EOF while looking for matching ')'`, runs nothing inside, and then runs the line after the heredoc
(measured): the deny refuses a command bash would not run, which is the fail-closed rule's cost the header already
names.

- [ ] **Step 3: Correct H40's retirement, and retire H20, H21 and H39, in the merged wave-2 plan**

In `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`, find (≈3360):

<!-- replay: replace docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md -->
```markdown
| H40 | retired in fix round 2: an unclosed `$(` in a heredoc body is now cut by the raw-to-end choke point before it can recurse; its guard stays as defence in depth, and no single-row mutation reds | same | — (not in the JSON) |
```

with

```markdown
| H40 | retired in fix round 2 on a reason that was FALSE (review 249 F1): the bounded-time payload had no terminator line, so the substitution reader never ran; with an `a` terminator line the row's mutation (`elif $open then .` → `elif $open then "$(" + (.[2:] \| qs(true))`) took the hook from 69 ms to 3896 ms at 16 KB. Live again in landing-order wave 3 (`docs/superpowers/plans/2026-10-04-landing-order-wave3-task7-preconditions.md`, Task 2), where the payload cap bounds every parse at 2048 bytes and the row reds a fail-closed case instead of a clock | same | — (not in this JSON; wave 3's) |
```

Then wave 2's three rows the cap retired (Pre-flight 4): they are still in that plan's JSON, and a later replay of its table would read them as live guards. Each keeps its mutation and its original measurement; only the expected-red cell says what is true since the cap. In the same file, find (≈3340):

<!-- replay: replace docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md -->
```markdown
| H20 | assignment values may cross a separator again: `[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&\|()]\|…)*` → `…=[^[:space:]]*` | `session-hook-merge-deny` | `1 failed` — `the hook took 28027 ms on ";a=": expected 28027 to be less than 3000` |
| H21 | the assignment's blank is `[[:space:]]+` again | same | `1 failed` — `the hook took 70113 ms on "\na=": expected 70113 to be less than 3000` |
```

with

```markdown
| H20 | assignment values may cross a separator again: `[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&\|()]\|…)*` → `…=[^[:space:]]*` | `session-hook-merge-deny` | RETIRED by landing-order wave 3's payload cap: `0 failed` there, at a cap of 2048 and of 8192, because no command long enough to show this walk is parsed any more; the cap's own rows (P1, P3) carry the class. Measured here before the cap: `1 failed` — `the hook took 28027 ms on ";a=": expected 28027 to be less than 3000` |
| H21 | the assignment's blank is `[[:space:]]+` again | same | RETIRED by landing-order wave 3's payload cap, as H20. Measured here before the cap: `1 failed` — `the hook took 70113 ms on "\na=": expected 70113 to be less than 3000` |
```

and find (≈3359):

<!-- replay: replace docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md -->
```markdown
| H39 | a heredoc must find its terminator: `[^\\n]++)?)(?:" + T($n; $tabs; $end) + ")?";` → `…+ ")";` | same | `1 failed` — `the hook took 24232 ms on "<<a\n": expected 24232 to be less than 3000` |
```

with

```markdown
| H39 | a heredoc must find its terminator: `[^\\n]++)?)(?:" + T($n; $tabs; $end) + ")?";` → `…+ ")";` | same | RETIRED by landing-order wave 3's payload cap, as H20. Measured here before the cap: `1 failed` — `the hook took 24232 ms on "<<a\n": expected 24232 to be less than 3000` |
```

- [ ] **Step 4: Run the tests — one file per process**

```bash
cd server
./node_modules/.bin/vitest run --maxWorkers=1 test/session-hook-sync-advisory.test.ts
./node_modules/.bin/vitest run --maxWorkers=1 test/session-hook-merge-deny.test.ts
cd ..
```

Then THE GUARD LOOP (Global Constraints).

Expected: `78 passed (78)` (each quote-dense shape at the cap 0.07–0.9 s wall at load 13–100, each at 36 KB 0.09–0.14 s
at load ~13); `77 passed (77)`; the guard loop `272`, `7`, `23`, `11`, `12`, `79`, `14`, `31`.

- [ ] **Step 5: Mutation check**

| # | Exact edit in `ccd/session-hook.sh` | Test file | Expected red (measured) |
|---|---|---|---|
| H40 | review 249's: `elif $open then . elif startswith("$((")` → `elif $open then "$(" + (.[2:] \| qs(true)) elif startswith("$((")` | `session-hook-merge-deny` | `1 failed \| 76 passed (77)` — "the unclosed $( was stripped again: cat <<a…" |
| Q1 | the cap raised past what the strip can afford: `MERGE_PARSE_CAP=2048` → `MERGE_PARSE_CAP=16384` | `session-hook-sync-advisory` | `2 failed \| 76 passed (78)` — "the whole hook took 2474 ms" (`"$('')"`), "…2400 ms" (`"$(<)"`); the 36 KB cases stay green (36 KB is over 16384 too) |
| Q2 | the advisory's regex walks from every quote: in `LANDING_SYNC_RE`, `(^\|[;&\|({'$'\n''])[[:blank:]]*(` → `(^\|[;&\|({"'$'\n''])[^g]*(` | `session-hook-sync-advisory -t '36 KB quote-dense'` | `4 failed \| 1 passed \| 73 skipped (78)` — the 36 KB `"`, `$(`, `"$('')"` and `"$(<)"` cases, 8.7–23.9 s (bare `'` is not in the widened start class). The whole file reds 13: the mutation also advises on three quoted mentions and slows six 36 KB adversarial cases |
| Q3 | the cap removed, seen from the advisory's file: `($c \| utf8bytelength) > $cap` → `false` | `session-hook-sync-advisory -t '36 KB quote-dense'` | at least `2 failed` — the two quoted-substitution shapes, 5.1–7.4 s, always; the bare `"` and `'` shapes take 1.7–2.2 s, so they red only where load pushes them past 1500 ms (`4 failed` at load ~13) |

Measured and NOT a row: `MERGE_PARSE_CAP=8192` leaves the pin green at load ~25 (`78 passed`; at load ~74 the `"$(<)"` shape crossed 1500 ms once, `1 failed`): at 8192 the costliest shape takes
~1.2 s of CPU, inside the bound. The pin holds the cap under the BOUND; the quarter-of-the-bound rule that chose 2048
is held by this plan's measurement and the header's paragraph (`cap-from-the-worst-measured-shape`).

Rows (`$SCRATCH/lo-w3/mut-task2.json`):

```json
[
 {"id": "H40", "file": "ccd/session-hook.sh", "old": "elif $open then . elif startswith(\"$((\")", "new": "elif $open then \"$(\" + (.[2:] | qs(true)) elif startswith(\"$((\")", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "Q1", "file": "ccd/session-hook.sh", "old": "MERGE_PARSE_CAP=2048\n", "new": "MERGE_PARSE_CAP=16384\n", "tests": ["test/session-hook-sync-advisory.test.ts"]},
 {"id": "Q2", "file": "ccd/session-hook.sh", "old": "LANDING_SYNC_RE='(^|[;&|({'$'\\n''])[[:blank:]]*(", "new": "LANDING_SYNC_RE='(^|[;&|({\"'$'\\n''])[^g]*(", "tests": ["test/session-hook-sync-advisory.test.ts"], "t": "36 KB quote-dense"},
 {"id": "Q3", "file": "ccd/session-hook.sh", "old": "($c | utf8bytelength) > $cap", "new": "false", "tests": ["test/session-hook-sync-advisory.test.ts"], "t": "36 KB quote-dense"}
]
```

- [ ] **Step 6: Commit**

```bash
git add server/test/session-hook-sync-advisory.test.ts server/test/session-hook-merge-deny.test.ts \
  docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md
git commit -m "$(cat <<'MSG'
test(hook): pin the quote-dense cost at the merge deny's cap; H40 is live again

Landing-order wave 3, Task 7's second precondition. sync-advisory's whole-hook
timing set gains five quote-dense shapes at exactly MERGE_PARSE_CAP bytes,
each inside the 1500 ms bound, and the same five at 36 KB, where the deny
passes them unparsed and the clock times the landing advisory's own regex
(68 -> 78); raising the cap to 16384 reds two, a regex walking from every
quote reds four.
Review 249 F1: the heredoc timing case runs at the cap with a terminated
heredoc, and the fail-closed rule H40 guards is pinned as a case (71 cases ->
77 with Task 1); H40's red is that case, not a clock, because at the cap a
re-strip costs ~300 ms. The merged wave-2 plan's H40 row loses its false
retirement reason, and its H20, H21 and H39 rows say the cap retired them.
MSG
)"
```

---

### Task 3: Wave 2's residue — review 249 F2–F4, doctor's `jq_regex`, and a closed PR reads `none`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/test/session-hook-merge-deny.test.ts`, `server/test/coordinator-skill.test.ts`
- Modify: `ccd/ccd` (`_pr_queue_py`, ≈28177 and ≈28289; re-stamped), `server/test/ccd-pr-queue.test.ts`
- Modify: `ccd/ccrc-doctor-checks` (the table ≈172, `_check_jq` ≈486), `server/test/ccrc-doctor.test.ts` (≈1606)
- Modify: `server/test/ccrc-install.test.ts` (`BASE_LIVE_SHAPE`, ≈7964–8170: three lines, by re-measurement)
- Modify: `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md` (the review-lens size line)

**Interfaces:**
- Consumes: wave 2's operator-terminator `it.each`, the four-answers pin, `_pr_queue_py`, doctor's table contract.
- Produces: doctor verdict lines `PASS|FAIL|SKIP jq_regex: …` (FAIL with a `remedy:` line); a closed PR's line now
  carries `"queue":"none"` where it carried `"unmeasured"`, only when the queue call answered.

- [ ] **Step 1: F2 — every operator that ends the merge word**

In `server/test/session-hook-merge-deny.test.ts`, find (≈319–325):

<!-- replay: replace server/test/session-hook-merge-deny.test.ts -->
```ts
  // The merge word may be followed by an operator with no blank between: `;`
  // `&` `|` `(` `)` `<` `>` end it as a blank does (review 247 F3; bare `gh pr
  // merge` merges the current branch's PR, a worker's own wave PR).
  it.each([
    ['gh pr merge;echo ok'], ['gh pr merge&&echo ok'], ['x=$(gh pr merge)'], ['(gh pr merge)'],
  ])
```

with

```ts
  // The merge word may be followed by an operator with no blank between: `;`
  // `&` `|` `(` `)` `<` `>` end it as a blank does (review 247 F3; bare `gh pr
  // merge` merges the current branch's PR, a worker's own wave PR). Every
  // member of the end class has its own case (review 249 F2).
  it.each([
    ['gh pr merge;echo ok'], ['gh pr merge&&echo ok'], ['x=$(gh pr merge)'], ['(gh pr merge)'],
    ['gh pr merge|cat'], ['gh pr merge>/tmp/o'], ['gh pr merge</dev/null'],
  ])
```

- [ ] **Step 2: F3 — pin the count**

In `server/test/coordinator-skill.test.ts`, find (≈382–383):

<!-- replay: replace server/test/coordinator-skill.test.ts -->
```ts
    // The four answers (queued, merged, armed, neither), each with its own act.
    expect(para, 'the queued answer (a non-null entry) is gone').toContain('answers a non-null `mergeQueueEntry`');
```

with

```ts
    // The four answers (queued, merged, armed, neither), each with its own act,
    // and the count that introduces them (review 249 F3).
    expect(para, 'the read-back no longer says how many answers it gives').toContain('gives one of four answers.');
    expect(para, 'the queued answer (a non-null entry) is gone').toContain('answers a non-null `mergeQueueEntry`');
```

- [ ] **Step 3: Review 241's carry — a closed PR reads `none`. The failing test first**

In `server/test/ccd-pr-queue.test.ts`, find (≈165):

<!-- replay: insert-above server/test/ccd-pr-queue.test.ts -->
```ts
  it('unmeasured — the bound PR is outside both windows', () => {
```

and insert, directly above it:

```ts
  it('none — a CLOSED PR that never merged: in neither window, but its line already says closed (review 241 F10(b))', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ state: 'CLOSED', headRefOid: tip })]);
    setQueue(answer([node(7, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    const o = sweep();
    expect(o.phase).toBe('closed');
    expect(o.queue).toBe('none');
    expect('queueAt' in o).toBe(false);
    // …and a call that did not answer is still unmeasured, closed or not.
    expect(sweep('return 1').queue).toBe('unmeasured');
  });

```

```bash
cd server && ./node_modules/.bin/vitest run --maxWorkers=1 test/ccd-pr-queue.test.ts
```

Expected: `1 failed | 13 passed (14)` — `expected 'unmeasured' to be 'none'`.

- [ ] **Step 4: The word**

In `ccd/ccd`, find (≈28288–28291):

<!-- replay: replace ccd/ccd -->
```python
    f = FACTS.get(num)
    if f is None:
        return 'unmeasured', None
```

with

```python
    f = FACTS.get(num)
    if f is None:
        if line.get('phase') == 'closed':
            return 'none', None
        return 'unmeasured', None
```

and the header's word table (≈28177–28180):

<!-- replay: replace ccd/ccd -->
```bash
#   none        measured, and none of the above — including "this workspace has
#               no bound PR", and a PR that never met the queue
#   unmeasured  the call did not answer, or the bound PR is outside both windows
```

with

```bash
#   none        measured, and none of the above — including "this workspace has
#               no bound PR", a PR that never met the queue, and a CLOSED PR
#               that never merged: it is in neither window, but its own line
#               already says `phase: closed`, and a closed PR is in no queue
#   unmeasured  the call did not answer, or the bound PR is outside both windows
#               and is not closed
```

Then `~/.local/bin/ccrc restamp ccd/ccd`. The new `return 'none', None` keeps `ccd-pr-queue-words`' extractor reading
the same five words (it collects every `return '<word>'` literal in `word()`).

- [ ] **Step 5: Review 241's carry — doctor's `jq_regex`. The failing tests first**

In `server/test/ccrc-doctor.test.ts`, find the end of the binaries describe (≈1606–1610):

<!-- replay: insert-below server/test/ccrc-doctor.test.ts -->
```ts
  it('names the binary it found when it is there', () => {
    const home = healthy('ccrc-doctor-bin-ok-');
    expect(lineFor(runDoctor(home).stdout, 'tmux')).toContain(join(home, 'stub-bin', 'tmux'));
  });
});
```

and insert, directly below it:

```ts

// ── jq_regex: the regex engine the session hook's merge deny runs on ──────

describe('ccrc doctor: jq_regex — a jq without lookaround fails the merge deny open, and says so', () => {
  /** A jq that answers the lookbehind probe as `answer` says and runs the real
   *  jq for everything else, so every other check that reads JSON is
   *  untouched. `rmSync` first: `healthy()` links the REAL jq here, and a write
   *  through that symlink would land on the box's own binary. */
  const lookbehindJq = (home: string, answer: string): void => {
    unstub(home, 'jq');
    stub(home, 'jq', `case "$*" in *'(?<!b)a'*) ${answer} ;; esac\nexec ${shq(realPath('jq'))} "$@"`);
  };

  it('passes on a jq that matches a lookbehind, naming the binary', () => {
    const home = healthy('ccrc-doctor-jqre-ok-');
    const line = lineFor(runDoctor(home).stdout, 'jq_regex');
    expect(line).toMatch(/^PASS jq_regex: /);
    expect(line, 'the PASS line does not name the jq it measured').toContain(`${join(home, 'stub-bin', 'jq')} matches a lookbehind`);
  });

  it('FAILs, with a remedy, on a jq built without Oniguruma — the deny would read no command', () => {
    const home = healthy('ccrc-doctor-jqre-noonig-');
    // jq 1.7 built without Oniguruma answers every regex builtin with this
    // error and exit 5 (its src/builtin.c, the `#else` arm of f_match).
    lookbehindJq(home, "echo 'jq: error (at <unknown>): jq was compiled without ONIGURUMA regex library. match/test/sub and related functions are not available.' >&2; exit 5");
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL jq_regex: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('FAILS OPEN');
    expect(lines[i]).toContain('rc 5');
    expect(lines[i]).toContain('compiled without ONIGURUMA');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: install a jq built with Oniguruma/);
    expect(r.code).toBe(1);
    // The presence check still passes: jq is there, its regex is not.
    expect(lineFor(r.stdout, 'jq')).toMatch(/^PASS jq: /);
  });

  it('FAILs when the probe answers anything but true — a lookbehind that does not match', () => {
    const home = healthy('ccrc-doctor-jqre-false-');
    lookbehindJq(home, 'echo false; exit 0');
    expect(lineFor(runDoctor(home).stdout, 'jq_regex')).toMatch(/^FAIL jq_regex: .*answered 'false', rc 0/);
  });

  it('skips on a server-role box — no session hook runs there', () => {
    const home = healthy('ccrc-doctor-jqre-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    lookbehindJq(home, 'exit 5');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP jq_regex: this box records CCRC_ROLE=server/m);
    expect(lineFor(r.stdout, 'jq_regex')).toBeUndefined();
  });

  it('skips with no jq on PATH — presence is the jq check\'s FAIL, not this one\'s', () => {
    const home = healthy('ccrc-doctor-jqre-nojq-');
    unstub(home, 'jq');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP jq_regex: jq is not on PATH/m);
    expect(r.stdout).toMatch(/^FAIL jq: not on PATH/m);
  });
});
```

```bash
cd server && ./node_modules/.bin/vitest run --maxWorkers=1 test/ccrc-doctor.test.ts -t 'jq_regex|the check list is data'
```

Expected: `5 failed | 2 passed | 631 skipped (638)` — every `jq_regex` case (no such line, no such SKIP); the table
census stays green.

- [ ] **Step 6: The check**

In `ccd/ccrc-doctor-checks`, find in the table (≈171–173):

<!-- replay: replace ccd/ccrc-doctor-checks -->
```bash
  gh
  jq
  python3
```

with

```bash
  gh
  jq
  jq_regex
  python3
```

Then find `_check_jq` (≈486–489):

<!-- replay: insert-below ccd/ccrc-doctor-checks -->
```bash
_check_jq() {
  _dr_need_bin jq "ccrc and ccrc-adopt read this box's small JSON files with it (ccrc version, accounts.json)" \
    "install it: sudo apt install jq"
}
```

and insert, directly below it:

```bash

# ── jq_regex: the regex engine the session hook's merge deny runs on ──────
# The worker merge deny in `session-hook.sh` (landing-order wave 2) strips
# quoted text in ONE jq program written in Oniguruma regex, lookbehind among
# it. A jq built without Oniguruma errors there, the hook is left with no
# command to match, and the deny FAILS OPEN with nothing on any screen (the
# hook's own header: "a jq built without Oniguruma ... the deny FAILS OPEN").
# This check is how that becomes a FAIL line: it asks jq the one question the
# strip depends on, whether a lookbehind matches, and nothing else. PRESENCE is
# the `jq` check's: with no jq on PATH this one has nothing to measure. A
# server-role box hosts no sessions, so no session hook runs there.
_check_jq_regex() {
  local _srv_role="" out rc
  # `${BOX_ENV_FILE:-}` and `-f` before `-r`: `_check_memory`'s reasons.
  [ -f "${BOX_ENV_FILE:-}" ] && [ -r "${BOX_ENV_FILE:-}" ] && _srv_role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
  if [ "$_srv_role" = server ]; then
    _dr_skip jq_regex "this box records CCRC_ROLE=server, so it hosts no sessions and runs no session hook"
    return 3
  fi
  if ! command -v jq >/dev/null 2>&1; then
    _dr_skip jq_regex "jq is not on PATH, so there is no regex engine to measure — the 'jq' check above owns that"
    return 3
  fi
  out="$(jq -n '"a" | test("(?<!b)a")' 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ] && [ "$out" = true ]; then
    _dr_pass jq_regex "$(command -v jq) matches a lookbehind, (?<!b)a: the session hook's merge deny can read a command"
    return 0
  fi
  _dr_fail jq_regex "jq cannot run the session hook's regex (a lookbehind answered '$(_dr_first_line "$out")', rc $rc), so its worker merge deny reads no command and FAILS OPEN" \
    "install a jq built with Oniguruma (Debian/Ubuntu: sudo apt install jq; macOS: brew install jq), then re-run ccrc doctor"
  return 1
}
```

The probe is the one construct the strip depends on that a regex library may lack (lookbehind); jq 1.7 without
Oniguruma fails every regex builtin with a runtime error, exit 5 (read from jq 1.7's source, not measured: this
box's jq has Oniguruma; the test's stub prints that error). A FAIL here makes `ccrc update` on that box end "completed under a
failing doctor" (exit 3, the box IS on the new build), which is the point: the fail-open becomes a line an operator
reads.

- [ ] **Step 7: The golden moves — re-measure `BASE_LIVE_SHAPE` by its own procedure**

`server/test/ccrc-install.test.ts` carries Plan 3a's `BASE_LIVE_SHAPE` (#239): every doctor class but `codex` on the
fleet box's live shape, measured, pasted, and compared with the tip by the three cutover-rehearsal cases. Its docstring
is the rule: a change that moves a doctor class "reds the live-shape case until Step 3 is re-run on a disposable copy
of the new base, never hand-edited". `jq_regex` adds a class, so the cases red now:

```bash
cd server && ./node_modules/.bin/vitest run --maxWorkers=1 test/ccrc-install.test.ts -t 'cutover rehearsal'
```

Expected: `3 failed | 3 passed | 297 skipped (303)` — "the base tree: BASE_LIVE_SHAPE is its measured answer…"
(`- "jq_regex"` in the diff), "live shape: two installs…" (`a check's class moved from the base's (ruling Z7)`), and
"the flip, in Plan 3b's order…" (`a check other than codex moved at the flip`).

Re-measure on a disposable copy of THIS tree (Plan 3a Task 10 Step 3's MEASURE case, verbatim; its fixture block and
`TREE_FILES` lines are already on `main`, so nothing else is copied in), then compare the answer with the golden:

```bash
SCRATCH=<abs>; B="$SCRATCH/lo-w3/t10-tree"; rm -rf -- "$B"; mkdir -p -- "$B"
git archive HEAD | tar -x -C "$B"
git diff --name-only HEAD | while read -r f; do cp -- "$f" "$B/$f"; done   # Task 3's uncommitted edits
ln -s "$PWD/server/node_modules" "$B/server/node_modules"
cat >> "$B/server/test/ccrc-install.test.ts" <<'EOF'

// MEASURE ONLY — Plan 3a Task 10 Step 3; appended to a disposable copy of the BASE and never committed.
import {
  plantLiveShape as measureLiveShape, doctorClasses as measureClasses, liveShapeRefreshes as measureRefreshes,
} from './codexLaneFixture.js';
describe('MEASURE the live shape on this tree', () => {
  it('writes it to REHEARSAL_OUT', async () => {
    const env: NodeJS.ProcessEnv = { ...READY, CCGPT_CONFIG: undefined };
    const home = freshBox('ccrc-rehearsal-measure-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    measureLiveShape(home, (argv) => runInstall(home, argv, env, { from: REPO_CCRC }));
    plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' });
    const install = [1, 2].map(() => {
      const r = runInstall(home, ['install', '--role', 'fleet'], env);
      return { code: r.code, classes: measureClasses(r.stdout) };
    });
    const refresh = await measureRefreshes(home, { ...ccrcEnv(home), ...env }, realPy());
    const d = runInstall(home, ['doctor'], env);
    writeFileSync(process.env['REHEARSAL_OUT']!,
      `${JSON.stringify({ install, refresh, doctor: { code: d.code, classes: measureClasses(d.stdout) } })}\n`);
    await killLaneProcesses(home);
  }, 240_000);
});
EOF
( cd "$B/server" && REHEARSAL_OUT="$SCRATCH/lo-w3/t10-live-shape.json" \
    ./node_modules/.bin/vitest run --maxWorkers=1 test/ccrc-install.test.ts -t 'MEASURE the live shape' )
grep -cE '"/(tmp|home|mnt|Users|var)/' "$SCRATCH/lo-w3/t10-live-shape.json"   # expected: 0
node --input-type=module - "$SCRATCH/lo-w3/t10-live-shape.json" server/test/ccrc-install.test.ts <<'EOF'
import { readFileSync } from 'node:fs';
const [, , out, test] = process.argv;
const m = JSON.parse(readFileSync(out, 'utf8'));
const src = readFileSync(test, 'utf8'), head = 'const BASE_LIVE_SHAPE: LiveShapeMeasure = ';
const a = src.indexOf(head) + head.length, g = JSON.parse(src.slice(a, src.indexOf('\n};\n', a) + 2));
const noCodex = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'codex'));
const withJqRe = (c) => Object.fromEntries(Object.entries(c).flatMap(([k, v]) => k === 'jq' ? [[k, v], ['jq_regex', 'PASS']] : [[k, v]]));
const shape = (x, f) => JSON.stringify({ install: x.install.map((p) => ({ code: p.code, classes: f(p.classes) })), refresh: x.refresh,
  doctor: { code: x.doctor.code, classes: f(x.doctor.classes) } });
console.log('measured minus codex == golden plus jq_regex:', shape(m, noCodex) === shape(g, withJqRe));
EOF
rm -rf -- "$B"
```

Expected: `1 passed | 303 skipped (304)`; `0`; `measured minus codex == golden plus jq_regex: true` (key order
included; `codex` is Plan 3a's own check, which the rehearsal cases add apart as `SKIP`, so the golden never carries
it). Anything else is a STOP: a class other than `jq_regex` moved, and that is a defect in this wave, never an
expectation to paste. Paste the measured answer as the three lines it adds, one per doctor map. In
`server/test/ccrc-install.test.ts`, find the first install pass's map down to its `jq` line:

<!-- replay: insert-below server/test/ccrc-install.test.ts -->
```ts
const BASE_LIVE_SHAPE: LiveShapeMeasure = {
  "install": [
    {
      "code": 0,
      "classes": {
        "accounts": "PASS",
        "auth": "SKIP",
        "build": "PASS",
        "caddy": "SKIP",
        "caddyfile": "SKIP",
        "cert": "SKIP",
        "config": "PASS",
        "credentials": "SKIP",
        "disk": "PASS",
        "exposure": "SKIP",
        "fleet": "SKIP",
        "flock": "PASS",
        "gh": "PASS",
        "gh_auth": "PASS",
        "git": "PASS",
        "git_email": "PASS",
        "graphify": "PASS",
        "graphify-path": "PASS",
        "jq": "PASS",
```

and insert, directly below it:

```ts
        "jq_regex": "PASS",
```

Then find the second install pass's map, from the end of the first, down to its `jq` line:

<!-- replay: insert-below server/test/ccrc-install.test.ts -->
```ts
        "wrappers": "PASS"
      }
    },
    {
      "code": 0,
      "classes": {
        "accounts": "PASS",
        "auth": "SKIP",
        "build": "PASS",
        "caddy": "SKIP",
        "caddyfile": "SKIP",
        "cert": "SKIP",
        "config": "PASS",
        "credentials": "SKIP",
        "disk": "PASS",
        "exposure": "SKIP",
        "fleet": "SKIP",
        "flock": "PASS",
        "gh": "PASS",
        "gh_auth": "PASS",
        "git": "PASS",
        "git_email": "PASS",
        "graphify": "PASS",
        "graphify-path": "PASS",
        "jq": "PASS",
```

and insert, directly below it:

```ts
        "jq_regex": "PASS",
```

Then find the doctor map's `jq` line (six-space indent, unique):

<!-- replay: insert-below server/test/ccrc-install.test.ts -->
```ts
      "graphify-path": "PASS",
      "jq": "PASS",
```

and insert, directly below it:

```ts
      "jq_regex": "PASS",
```

```bash
cd server && ./node_modules/.bin/vitest run --maxWorkers=1 test/ccrc-install.test.ts -t 'cutover rehearsal'
./node_modules/.bin/vitest run --maxWorkers=1 test/ccrc-update.test.ts -t 'Plan 3a Task 10'
```

Expected: `6 passed | 297 skipped (303)`; `1 passed | 481 skipped (482)`.

- [ ] **Step 8: F4 — the merged wave-2 plan's stale counts**

In `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`, find (in the Review lenses paragraph,
≈4266):

<!-- replay: replace docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md -->
```markdown
+2678 / −124 against `origin/main`, measured 2026-10-03 at fix round 2's tip with `git diff --stat origin/main...HEAD`, this plan left out; 134 mutation rows
```

with

```markdown
+2686 / −124 against `origin/main`, measured on the squash merge with `git diff --shortstat 0087a045~1 0087a045`, this plan left out (review 249 F4; +2678 was fix round 2's first two commits); 135 mutation rows, 15 + 11 + 28 + 61 + 20 in the five JSON blocks
```

Measured: `git diff --shortstat 0087a045~1 0087a045 -- . ':(exclude)docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md'`
→ `35 files changed, 2686 insertions(+), 124 deletions(-)`; the five JSON blocks hold 15, 11, 28, 61 and 20 rows.

- [ ] **Step 9: Run the tests — one file per process; the doctor file in its five slices**

```bash
cd server
for f in session-hook-merge-deny coordinator-skill ccd-pr-queue ccd-pr-queue-words pr-queue-lane landing-verdict \
         ccd-pr-state ownership ccd-reg-get-census ccrc-doctor-graphify; do
  ./node_modules/.bin/vitest run --maxWorkers=2 "test/$f.test.ts" | grep -E '^ +Tests '
done
./node_modules/.bin/vitest run --maxWorkers=1 test/ccrc-install.test.ts -t 'cutover rehearsal' | grep -E '^ +Tests '
# ccrc-doctor.test.ts in its FIVE slices (Global Constraints), one 600 s call each
DA='the check list|node|the binaries|jq_regex|tmux_skew|gh_auth|git_email|path|services'
DB='pool-sync|update-sync|config|auth|rc |disk|skills|wrappers'
DC='credentials|pools|fleet|build|ccrc-wrapper-shape|the output contract|exposure|caddy|cert|name'
DD='provenance|update-exposure|routing|models|accounts|memory'
for T in "^ccrc doctor: ($DA)" "^ccrc doctor: ($DB)" "^ccrc doctor: ($DC)" "^ccrc doctor: ($DD)" \
         "^(?!ccrc doctor: ($DA|$DB|$DC|$DD))"; do
  ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-doctor.test.ts -t "$T" | grep -E '^ +(Tests|Duration) '
done
cd ..
```

Then THE GUARD LOOP (Global Constraints).

Expected: `80`, `156`, `14`, `3`, `18`, `28`, `99`, `14`, `3`, `30`; `6 passed | 297 skipped (303)`; then the five
slices `79`, `155`, `141`, `105`, `154` passed of 638 (75, 148, 111, 90 and 116 s at load 12–15; their union is the 634
cases this platform runs, 4 are platform-skipped, and no case is in two); the guard loop `272`, `7`, `23`, `11`, `12`,
`79`, `14`, `31`. Re-run "gh goes red when it is removed from the fixture PATH" alone if it times out (a known flake,
above).

- [ ] **Step 10: The citation tax (expected: nothing moves)**

```bash
SCRATCH=<abs>; python3 "$SCRATCH/lo-w3/cite-remeasure.py" "$SCRATCH/lo-w3" origin/main --files ccd/ccd,README.md,ccd/session-hook.sh
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: `ccd/ccd` 147/147/147, `ccd/session-hook.sh` 21/21/21, total 197, arrays 52 and 35, nothing ENTERED or LEFT;
`7 passed | 328 skipped (335)`.

- [ ] **Step 11: Mutation check**

| # | Exact edit | Test file | Expected red (measured) |
|---|---|---|---|
| R1 | review 249's Q-ops, `\|<>` dropped: `merge([[:space:];&\|()<>]\|$)'` → `merge([[:space:];&()]\|$)'` (`ccd/session-hook.sh`) | `session-hook-merge-deny` | `3 failed \| 77 passed (80)` — `"gh pr merge\|cat"`, `"gh pr merge>/tmp/o"`, `"gh pr merge</dev/null"` |
| R2 | review 249's Q-four: `gives one of four answers.` → `gives one of three answers.` (`wave-lifecycle.md`) | `coordinator-skill` | `1 failed \| 155 passed (156)` — the FOUR-answers case |
| R3 | the closed branch removed from `word()` (`ccd/ccd`, re-stamped) | `ccd-pr-queue`; `ccd-pr-queue-words` | `1 failed \| 13 passed (14)` — the closed case; words `3 passed` (the five words are still emitted) |
| J1 | the verdict ignored: `  if [ "$rc" -eq 0 ] && [ "$out" = true ]; then` → `  if true; then` | `ccrc-doctor -t 'jq_regex\|the check list is data'` | `2 failed \| 5 passed \| 631 skipped` — the two FAIL cases |
| J2 | the answer ignored: `… && [ "$out" = true ]` dropped | same | `1 failed` — "FAILs when the probe answers anything but true" |
| J3 | the server-role SKIP removed | same | `1 failed` — the server-role case (it measured and printed `FAIL jq_regex: … answered '', rc 5`) |
| J4 | the table entry removed: `  jq\n  jq_regex\n` → `  jq\n` | same | `6 failed \| 1 passed` — "every name in the table has a _check_<name> function, and vice versa" (an ORPHAN) and all five `jq_regex` cases |
| J5 | the no-jq SKIP removed | same | `1 failed` — the no-jq case (`FAIL jq_regex: … jq: command not found', rc 127`) |
| J6 | the probe's TEXT pinned: `test("(?<!b)a")` → `test("a")` | same | `2 failed` — the two FAIL cases. A text pin, not a behaviour pin: both stubs answer only an argument holding the literal `(?<!b)a`, so ANY change to the probe's text, right or wrong, falls through to the real jq and reds the same two cases. What it guarantees is that the probe still asks the lookbehind the stubs (and the strip) depend on |
| J8 | the PASS line no longer names the binary: `_dr_pass jq_regex "$(command -v jq) matches a lookbehind` → `_dr_pass jq_regex "jq matches a lookbehind` | same | `1 failed \| 6 passed` — "passes on a jq that matches a lookbehind, naming the binary": `the PASS line does not name the jq it measured` |
| J4r | J4's edit, read by the re-measured golden | `ccrc-install -t 'cutover rehearsal'` | `3 failed \| 3 passed \| 297 skipped (303)` — the three rehearsal cases: the golden now carries `jq_regex`, and a tree without it moves a class |

Rows (`$SCRATCH/lo-w3/mut-task3.json`):

```json
[
 {"id": "R1", "file": "ccd/session-hook.sh", "old": "merge([[:space:];&|()<>]|$)'", "new": "merge([[:space:];&()]|$)'", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "R2", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "gives one of four answers.", "new": "gives one of three answers.", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "R3", "file": "ccd/ccd", "old": "        if line.get('phase') == 'closed':\n            return 'none', None\n", "new": "", "tests": ["test/ccd-pr-queue.test.ts", "test/ccd-pr-queue-words.test.ts"], "restamp": true},
 {"id": "J1", "file": "ccd/ccrc-doctor-checks", "old": "  if [ \"$rc\" -eq 0 ] && [ \"$out\" = true ]; then", "new": "  if true; then", "tests": ["test/ccrc-doctor.test.ts"], "t": "jq_regex|the check list is data"},
 {"id": "J2", "file": "ccd/ccrc-doctor-checks", "old": "  if [ \"$rc\" -eq 0 ] && [ \"$out\" = true ]; then", "new": "  if [ \"$rc\" -eq 0 ]; then", "tests": ["test/ccrc-doctor.test.ts"], "t": "jq_regex|the check list is data"},
 {"id": "J3", "file": "ccd/ccrc-doctor-checks", "old": "    _dr_skip jq_regex \"this box records CCRC_ROLE=server, so it hosts no sessions and runs no session hook\"\n    return 3\n", "new": "    :\n", "tests": ["test/ccrc-doctor.test.ts"], "t": "jq_regex|the check list is data"},
 {"id": "J4", "file": "ccd/ccrc-doctor-checks", "old": "  jq\n  jq_regex\n", "new": "  jq\n", "tests": ["test/ccrc-doctor.test.ts"], "t": "jq_regex|the check list is data"},
 {"id": "J5", "file": "ccd/ccrc-doctor-checks", "old": "    _dr_skip jq_regex \"jq is not on PATH, so there is no regex engine to measure — the 'jq' check above owns that\"\n    return 3\n", "new": "    :\n", "tests": ["test/ccrc-doctor.test.ts"], "t": "jq_regex|the check list is data"},
 {"id": "J6", "file": "ccd/ccrc-doctor-checks", "old": "out=\"$(jq -n '\"a\" | test(\"(?<!b)a\")' 2>&1)\"; rc=$?", "new": "out=\"$(jq -n '\"a\" | test(\"a\")' 2>&1)\"; rc=$?", "tests": ["test/ccrc-doctor.test.ts"], "t": "jq_regex|the check list is data"},
 {"id": "J8", "file": "ccd/ccrc-doctor-checks", "old": "_dr_pass jq_regex \"$(command -v jq) matches a lookbehind", "new": "_dr_pass jq_regex \"jq matches a lookbehind", "tests": ["test/ccrc-doctor.test.ts"], "t": "jq_regex|the check list is data"},
 {"id": "J4r", "file": "ccd/ccrc-doctor-checks", "old": "  jq\n  jq_regex\n", "new": "  jq\n", "tests": ["test/ccrc-install.test.ts"], "t": "cutover rehearsal"}
]
```

- [ ] **Step 12: Commit**

```bash
git add ccd/ccd ccd/ccrc-doctor-checks server/test/ccd-pr-queue.test.ts server/test/ccrc-doctor.test.ts \
  server/test/ccrc-install.test.ts server/test/coordinator-skill.test.ts server/test/session-hook-merge-deny.test.ts \
  docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md
git commit -m "$(cat <<'MSG'
fix: wave 2's residue — every merge-word terminator, the four answers, jq_regex, a closed PR reads none

Landing-order wave 3, Task 3. Review 249 F2: `|`, `>` and `<` after the merge
word each get a case (merge-deny 77 -> 80). F3: coordinator-skill pins "gives
one of four answers." F4: the wave-2 plan's size line reads +2686 / -124 and
135 rows. Review 241's carries: doctor's jq_regex FAILs, with a remedy, on a
box whose jq cannot match a lookbehind, so the deny's fail-open for want of
Oniguruma is a line an operator reads (SKIP on a server-role box and with no
jq); and a CLOSED-unmerged PR outside both queue windows reads `none` when the
queue call answered (the landing lane reads none and unmeasured alike).
Plan 3a's BASE_LIVE_SHAPE golden gains one "jq_regex": "PASS" per doctor
map, re-measured by its own procedure (measured minus codex equals the old
golden plus jq_regex).

R1-R3, J1-J6, J8 and J4r red; census 147/197/52/35 unmoved.
MSG
)"
```

---

### Task 4: Task 7's runbook names the landed preconditions (text only)

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Modify: `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md` (Task 7 Step 1, ≈4011)

- [ ] **Step 1: Rewrite the "Two CODE preconditions" paragraph**

In `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`, find the paragraph (one line, ≈4011):

<!-- replay: replace docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md -->
```markdown
**Two CODE preconditions, carried here from the deny's review (review 247 F6) and built in a wave of their own, not this one. Both must have LANDED, in a build both boxes run, before the operator arms the queue ruleset or sets approvals to 0 — and this step stops until they have:** (a) a payload cap on the deny's jq input: quote-dense input exhausts the hook's time or memory (bare `"` takes 1584 ms at 36 KB and 6885 ms, 0.56 GB, at 100 KB through the hook), and a hook timeout or a killed jq fails the deny OPEN; (b) a quote-dense timing pin: bare `"` at 36 KB, ~1584 ms, is above `session-hook-sync-advisory`'s 1500 ms whole-hook bound, and neither that file nor `session-hook-merge-deny`'s timing cases pins that shape. Until then the deny is a contract the fleet honours, not what stands between a worker and a merge. It also still passes every class the header above `GH_MERGE_RE` in `ccd/session-hook.sh` lists under WHAT PASSES UNPARSED (quoting inside the `pr` or `merge` word, a leading redirection, a `case` arm or function body, a variable command word or argument, a gh alias, a named wrapper spelled with a path, a ` #` or `(#` inside an unquoted `${…}`, a form feed before `#`, and the strip's own mis-reads): read that list before arming, and close what the operator will not accept first.
```

with

```markdown
**Two CODE preconditions, carried here from the deny's review (review 247 F6) and LANDED by landing-order wave 3 (`docs/superpowers/plans/2026-10-04-landing-order-wave3-task7-preconditions.md`). Both must be in a build both boxes run before the operator arms the queue ruleset or sets approvals to 0, and this step stops until they are:** (a) THE PAYLOAD CAP, `MERGE_PARSE_CAP` (2048 bytes) in `ccd/session-hook.sh`: a command longer than the cap is never parsed, and one that holds both `gh` and `merge` is refused unread in a held or child session, so quote-dense input can no longer exhaust the hook's time or memory and fail the deny open (bare `"` once took 1584 ms at 36 KB and 6885 ms, 0.56 GB, at 100 KB); the cost is that such a session's long command that merely holds both words is refused until it is split; (b) THE QUOTE-DENSE TIMING PIN, `session-hook-sync-advisory.test.ts`'s five quote-dense shapes at exactly the cap, each inside its 1500 ms whole-hook bound (a cap raised to 16384 reds two of them), with `session-hook-merge-deny.test.ts`'s bounded-time case carrying a terminated heredoc and the fail-closed case that keeps row H40 live (review 249 F1). Read both on the fleet box, read-only: `grep -c '^MERGE_PARSE_CAP=' "$HOME/.cc-sessions/session-hook.sh"` answers `1`, and `ccrc doctor 2>&1 | grep '^PASS jq_regex:'` prints one line (wave 3's check: the deny's regex engine is there, so the deny is not failing open for want of it). Even with both landed the deny is a contract the fleet honours, not what stands between a worker and a merge. It also still passes every class the header above `GH_MERGE_RE` in `ccd/session-hook.sh` lists under WHAT PASSES UNPARSED (quoting inside the `pr` or `merge` word, a leading redirection, a `case` arm or function body, a variable command word or argument, a gh alias, a named wrapper spelled with a path, a ` #` or `(#` inside an unquoted `${…}`, a form feed or vertical tab before `#`, a top-level "…" span holding `$${`, and the strip's own mis-reads): read that list before arming, and close what the operator will not accept first.
```

- [ ] **Step 2: Check and commit**

```bash
grep -c 'MERGE_PARSE_CAP' docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/topology-clean.test.ts
cd ..
```

Then THE GUARD LOOP (Global Constraints), then:

```bash
git add docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md
git commit -m "docs(plan): Task 7 Step 1 names the payload cap and the quote-dense pin as landed (landing-order wave 3)"
```

Expected: `1` (the paragraph is one line; it names the constant for the cap and for the read-only check); `31 passed`
and `55 passed`; the guard loop `272`, `7`, `23`, `11`, `12`, `79`, `14`, `31`.

The paragraph does three things beyond naming the cap and the pin, each a departure from the brief's "name them as
landed" and listed for the coordinator to rule on: it adds two read-only reads to the arming gate
(the `jq_regex` read makes the doctor check a de facto third precondition), it brings the
WHAT PASSES UNPARSED parenthetical level with the hook header's list (vertical tab, `$${`), which review 249 called "a
small omission, not a finding", and it says what the cap costs; all three are `runbook-says-more-than-landed`. Cutting the
paragraph back to the naming alone is a text edit, and changes no count above.

---

### Task 5: The whole branch, and the PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified — this task measures, opens the PR and reports.

- [ ] **Step 1: The three package suites, in the foreground, one process at a time**

```bash
cd agent  && npm ci && npm run test -- --maxWorkers=2
cd ../pwa && npm ci && npm run test -- --maxWorkers=2
cd ../server && npm ci
X='--exclude test/ccrc-doctor.test.ts --exclude test/ccrc-install.test.ts --exclude test/ccrc-update.test.ts'
./node_modules/.bin/vitest run --maxWorkers=2 --shard=1/24 $X   # … 2/24 … 24/24, one call each
# the three files that do not fit one call, in their slices (Global Constraints)
IA="the shipped tree|the fixture tree|a fresh box|the files the operator|a roster|a box with no node|re-running|the env file|the executables|the order"
IB="the versioned tree|the one-time migration|workspace build-artifact|the build stamp|the unit directory|linger"
IC="all three skills|the landing block|running the WHOLE|the node's three|install-step|the harness"
for T in "^ccrc install: ($IA)" "^ccrc install: ($IB)" "^(ccrc install: ($IC)|ccrc install --role|install\\.sh)" \
         "^(?!ccrc install: ($IA|$IB|$IC)|ccrc install --role|install\\.sh)"; do
  ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-install.test.ts -t "$T" | grep -E '^ +(Tests|Duration) '
done
for T in '^ccrc update' '^(?!ccrc update)'; do
  ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-update.test.ts -t "$T" | grep -E '^ +(Tests|Duration) '
done
```

then `ccrc-doctor.test.ts` as Task 3 Step 9's five slices. Expected: PASS everywhere. Measured on the replay: agent
`422 passed (422)` in 22 s, PWA `3206 passed (3206)` in 211 s; `ccrc-install` `56`, `68`, `58`, `101` passed of 303
(283 run here); `ccrc-update` `288` and `183` passed of 482 (471 run here); the doctor slices as Task 3 Step 9 says.
Report the 24 shard summaries, every slice, and their sum. A shard killed by the 600 s ceiling is re-run one file per
process; a single file that still overruns is sliced by its top-level `describe` names, its union checked with
`vitest list --json=<file>` (never `--json <file>`), and reported. `tmp-sweep`'s FAILS CLOSED case is red on `main`
itself on the fleet box — report it, do not chase it.

- [ ] **Step 2: The repo-wide guards and the cross-tree checks**

```bash
git fetch origin main && cd server
for f in single-definition modelenv-single-writer box-token-census routing-references typecheck-tests \
         ccd-workspaces ownership deviation-refs dtbd topology-clean; do
  ./node_modules/.bin/vitest run --maxWorkers=2 "test/$f.test.ts" | grep -E '^ +Tests '
done
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
cd .. && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected (measured on the replay): `272`, `7`, `23`, `11`, `12`, `79`, `14`, `31`, `1`, `55`; `7 passed | 328 skipped
(335)`; `corpus-frozen`. If `origin/main` has moved `ccd/session-hook.sh`, `ccd/ccd`,
`ccd/ccrc-doctor-checks` or their tests since Task 1, merge it (`git merge` only), re-stamp `ccd/ccd` if its stamp
conflicts, and re-run Tasks 1–3's suites, the citation step and every row.

- [ ] **Step 3: The wave's own surface — one file per process**

```bash
cd server
for f in session-hook-merge-deny session-hook-sync-advisory coordinator-skill ccd-pr-queue ccd-pr-queue-words \
         pr-queue-lane landing-verdict ccd-pr-state hookstate install-session-hooks ask-instance-guard \
         update-branch-absent session-hook-turnmark ccrc-doctor-graphify; do
  ./node_modules/.bin/vitest run --maxWorkers=1 "test/$f.test.ts" | grep -E '^ +Tests '
done
./node_modules/.bin/vitest run test/run-routes.test.ts -t 'binds the shared cap'
./node_modules/.bin/vitest run --maxWorkers=1 test/ccrc-install.test.ts -t 'cutover rehearsal'
./node_modules/.bin/vitest run --maxWorkers=2 test/session-hook.test.ts
```

Expected: `80`, `78`, `156`, `14`, `3`, `18`, `28`, `99`, `54`, `13`, `3`, `2`, `54`, `30`; `1 passed | 229 skipped
(230)`; `6 passed | 297 skipped (303)`; `335 passed (335)` (~135 s).

Then every row of Tasks 1–3, re-run on the branch tip, is red. The per-task tables were measured at each task's own
tree; on the tip (merge-deny 80 cases, sync-advisory 78) the counts are, measured: P1 `4 failed`, **P2 `2 failed`**
(the heredoc case is at the cap since Task 2, so its 16 KB red is gone; "no `gh` in it" and `"\"": denied true`
remain), P3 `2`, P4 `4`, P5 `1`, P6 `3`, P7 `1`, **P8 `2 failed`** (as P2), P9 `1`, P10 `1`, H40 `1 failed | 79 passed
(80)`, Q1 `2 failed | 76 passed (78)`, Q2 `4 failed` under its `-t`, Q3 `4 failed` under its `-t` at load ~13 (at
least 2 on any box), R1 `3 failed | 77 passed (80)`, R2 `1`, R3 `1` (words `3 passed`), J1 `2`, J2 `1`, J3 `1`, J4 `6`,
J5 `1`, J6 `2`, J8 `1`, J4r `3`. Wave 2's H20, H21 and H39 stay `80 passed (80)` (retired, Task 2 Step 3). A row that
reds one timing case MORE than this is load (Global Constraints): re-run it alone.

- [ ] **Step 4: Confirm the author, push, open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Landing order wave 3: the merge deny's payload cap and quote-dense pin (Task 7's preconditions), and wave 2's residue" --body-file - <<'EOF'
Wave 3 of the landing-order programme: the two CODE preconditions the wave-2 plan's Task 7 Step 1 names, and wave 2's residue. Plan: `docs/superpowers/plans/2026-10-04-landing-order-wave3-task7-preconditions.md`. Changes NO repository setting; nothing here changes how a PR lands.

1. **The payload cap** (`ccd/session-hook.sh`) — the merge deny parses no command longer than `MERGE_PARSE_CAP` = 2048 bytes. Over the cap its jq program asks the raw command two fixed-string questions; a held or child session's command holding both `gh` and `merge` is refused unread, naming the length and the cap. No input can time the hook out into a fail-open any more. Cost: such a session's long command that merely holds both words must be split (a long body goes in a file).
2. **The quote-dense timing pin** — `session-hook-sync-advisory` times five quote-dense shapes at exactly the cap against its 1500 ms bound, and the same five at 36 KB, where the clock times the landing advisory's own regex; `session-hook-merge-deny`'s heredoc case carries review 249 F1's terminator, and H40 is a live row again.
3. **Residue** — review 249 F2 (every merge-word terminator), F3 (the four-answers count), F4 (the wave-2 plan's counts); review 241's doctor `jq_regex` check (FAIL on a jq without lookaround; Plan 3a's `BASE_LIVE_SHAPE` golden re-measured for it) and a closed-unmerged PR reading `none`.
4. **Task 7's runbook** names (1) and (2) as landed.

Deploy: AGENT-FIRST through ccrc's updater — the fleet node first, from the console; nobody moves boxes by hand. Read after: `grep -c '^MERGE_PARSE_CAP=2048$' ~/.cc-sessions/session-hook.sh` → 1 and `ccrc doctor | grep '^PASS jq_regex:'` on the fleet box.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Expected: one author line, the workspace's own identity (the pre-push hook refuses residue; fix the author, never
bypass it). The PR body's last line is your session's own attribution line, as the commit trailers are. The wave
STOPS at the PR: report wave-done to the coordinator with the measured fingerprint; the coordinator merges.

---

## Deploy note

- **Class:** hook + ccd + ccrc doctor, all fleet-box code. **AGENT-FIRST, through ccrc's updater** — the console's
  apply, fleet node first (its natural order), then the server node, which carries the same tree but runs no session
  hook and SKIPs `jq_regex`. No server source changes, so no server behaviour moves. **Nobody moves boxes by hand**
  (ruling 2026-09-30); `ccrc rollout` is the path only when the console is down, and `ccrc rollback` is the typed way
  back.
- **Live at once on the fleet box:** the cap applies at the next PreToolUse after the hook is installed; it only ever
  refuses in a held or child session, and it only ever skips the strip elsewhere.
- **Read-only proofs on the fleet box, after its update:** `grep -c '^MERGE_PARSE_CAP=2048$'
  "$HOME/.cc-sessions/session-hook.sh"` → `1`; `ccrc doctor 2>&1 | grep -E '^(PASS|FAIL|SKIP) jq_regex:'` → one
  `PASS` line; `grep -c "if line.get('phase') == 'closed':" "$HOME/.local/bin/ccd"` → `1`.
- **Then Task 7** (the operator's): its Step 1 now reads the two preconditions as landed and adds the two reads above.

---

## Open questions for the operator

1. **The cap's value: 2048 or 8192.** The brief's rule (the largest round size at which the worst quote-dense shape
   costs about 25 % of the 1500 ms bound) gives **2048** on the costliest shape measured (`"$(<)"` runs, 317–380 ms of
   CPU) and **8192** on the three shapes the brief names (bare `"`, 372–413 ms). The census (Pre-flight 3) says what
   that buys: up to ~470 long commands a day across the fleet that hold both words, against ~57, would be refused in a
   held session until split — about half of them mail. This plan ships 2048, which is a DEPARTURE: the rule as
   written, applied to the shapes the brief names, gives 8192, and 2048 comes from a shape it does not name
   (`cap-from-the-worst-measured-shape`). Changing it is the constant and nothing else (every test reads it; at 8192
   merge-deny stays 80/80 and sync-advisory 78/78 at load ~25, though at load ~74 the `"$(<)"` shape at 8192 crossed the 1500 ms bound once — 8192 leaves the pin a thin margin), and Q1 still reds at 16384.
2. **Workers' long mails.** At 2048 a worker's wave-done mail written as a Bash heredoc that mentions "github" and
   "merge" is refused until the body is written with the Write tool and sent with `ccrc-api … --json <file>`. The
   refusal says so; the worker skill does not. Should a later wave add that sentence to the skill (a pinned clause)?
3. **Review 241's `--squash`-span carry** (the coordinator-skill assertion that matches #178's span by exact text) is
   not in this wave's task list; it stays carried, brittle but not blind.
4. **The issued block is nearly spent by the plan itself.** The plan lists nine departures and run 250's block holds
   ten numbers (3906–3915), so one is left for a departure the worker meets while executing. A second one needs a new
   block, or the worker writes `D-TBD-<slug>` and reports it (worker clause 11).

---

## Deviations found

Departures from the spec, the brief or the merged wave-2 plan. Numbered from run 250's issued block: 3906 to 3914 are this plan's nine, in plan order; 3915 is the coordinator's amendment to Task 1; 3916 to 3920 are spares for what the wave finds. Each is defined here in the commit that makes its change.

- **D-3906 — `cap-from-the-worst-measured-shape`.** `MERGE_PARSE_CAP` is 2048, chosen on `"$(<)"` runs, a shape the brief's list (bare `"`, `'` runs, `$(` runs) does not name and that costs ~4x bare `"` per byte; on the named shapes alone the rule gives 8192 (Open question 1). The quote-dense pin holds the cap under the 1500 ms BOUND (it reds 16384, not 8192), not under the quarter of it that chose 2048; that quarter is held by this plan's measurement and the hook header's paragraph.
- **D-3907 — `cap-refuses-unread`.** the spec's deny refuses a parsed `gh pr merge`; over the cap a held or child session's command is refused because its RAW text spells a word-bounded `gh pr merge` (D-3915), unparsed. A new false-deny class — a body that quotes the words — named in the hook's header and the reason.
- **D-3908 — `timing-cases-run-at-the-cap`.** merge-deny's 100 KB adversarial case and its 16 KB heredoc case now run at the cap, the largest command still parsed; over-cap length is the cap describe's case. At that size wave 2's H20, H21 and H39 measure green (at 2048 and at 8192): no command long enough to show their walks is parsed, and the cap's own rows (P1, P3) carry the class. So the adversarial case is renamed for what it still checks (no false deny at the cap, in bounded time; under the word rule of D-3915, P3 reds the cap's boundary case, not this one), and the three rows are marked retired in the wave-2 plan's table (Task 2 Step 3).
- **D-3909 — `h40-reds-through-a-fail-closed-case`.** review 249 asked for H40 live through the bounded-time case with a terminator; at the cap that payload's re-strip costs ~300 ms, so H40 reds a functional fail-closed case instead, and the terminated payload is in the timing case as asked.
5. `closed-reads-none-only-when-answered` — a closed PR outside both windows reads `none` only when the queue call answered; a failed call still says `unmeasured` on every line, closed or not. The server's single-definition gloss (`PR_QUEUE_MAP.unmeasured` in `server/src/prstate.ts`, "or the bound PR is outside its windows") is left without a "not closed" qualifier: no behaviour reads it, and editing it would make this a server deploy, so it is carried to the next wave that touches server code (Pre-flight 6).
6. `jq-regex-skips-and-moves-the-golden` — doctor's check SKIPs (never PASSes) on a server-role box and with no jq on PATH, presence staying the `jq` check's FAIL; and, since a new doctor class moves Plan 3a's `BASE_LIVE_SHAPE` in `ccrc-install.test.ts`, a file the brief did not name, Task 3 Step 7 re-measures that golden by its own procedure and pastes three lines.
- **D-3912 — `preconditions-wave-before-land-probe`.** the ledger's wave-3 row carries stage 3's `ccd-land-probe`; this wave is the small preconditions-and-residue wave the Next-wave brief allows, and stage 3 is planned after it. The Next-wave brief also listed review 241's `--squash`-span carry in wave 3's first commit; the coordinator's task list for this plan does not, so it stays carried (Open question 3).
- **D-3913 — `advisory-quote-runs-pinned-at-36kb`.** the brief made an advisory CAP conditional on a superlinear parse; the advisory measured linear and gets no cap, but this wave adds a 36 KB quote-dense pin (row Q2) so that measurement is a mechanism, not a comment.
9. `runbook-says-more-than-landed` — Task 4's paragraph does more than name the cap and the pin as landed: it adds two read-only reads to the arming gate (the hook's constant, and `PASS jq_regex` from doctor, which makes doctor's check a de facto third precondition), says what the cap costs, and brings its WHAT PASSES UNPARSED list level with the hook header's (a vertical tab before `#`, a top-level "…" span holding `$${`: an omission review 249 ruled "not a finding"). Cutting it back to the naming alone is a text edit.
- **D-3915 — `overcap-word-bounded-match`.** The coordinator's amendment to Task 1, which wins over this plan's text: over the cap the deny does NOT ask the two fixed substrings `gh` and `merge`; it matches a word-bounded `gh pr merge` against the RAW command, with one linear regex and no nested quantifier, `MERGE_OVERCAP_RE='(^|[^A-Za-z0-9_])gh\s+pr\s+merge($|[[:space:];&|()<>])'`, passed to the jq program with `--arg`. Why: of 4,478 fleet Bash commands longer than 2 KB over two days, the two substrings matched 1,340, mostly prose ("through", "high", "merged"), so a worker's long wave-done mail would be refused; the word rule matched 131. Three choices inside it: the START is any ASCII non-word character (a literal word boundary), wider than the amendment's example `(^|[;&|(\s])`, so a markdown-quoted mention, a path-spelled `gh` and a backtick substitution are refused too; the END is `GH_MERGE_RE`'s end class with its alternation reordered, the same set, so row R1's anchor on `GH_MERGE_RE`'s tail stays unique; and gh's own flags between the words (`gh -R o/r pr merge`) pass over the cap where `main`'s full parse refuses them, because catching them needs the nested quantifier the amendment excludes — classified in the hook's header, not closed (the stopping line). Tests: an over-cap `gh pr merge 42` is denied; over-cap prose holding "though … merged … high" passes; an over-cap body QUOTING `gh pr merge` is denied (the accepted cost) and the refusal says to split or rephrase. Rows: P2 (the over-cap match removed) and P7 (the two-substring rule restored: the prose case reds) replace the plan's P2/P7/P8, with P8 and P11 for the start and end boundary. The cap value, 2048, and the 25 % timing argument stand. Where this plan's Goal, Architecture, Review Focus 3, Pre-flight 3, Task 4's paragraph and Task 5's PR body say "two fixed-string questions" or "holds both `gh` and `merge`", this entry supersedes them; Task 4's paragraph and the PR body are written to it.

---

## Review lenses

Three lenses, all `opus`, effort `high` — a ten-file diff beside this plan (three shipped files: the hook, `ccd/ccd`,
the doctor table; the merged wave-2 plan's text; six test files), +333 / −27 on the replay, sized per the fleet policy,
one `sonnet` refute pass per finding. Lens 1 is security-sensitive.

1. **The cap and the deny (security-sensitive).** Over the cap the strip NEVER runs (jq's closure semantics), the
   over-cap answer reaches the arm as a match, and a held or child session is refused; under the cap nothing changed
   (all of wave 2's rows but the three timing ones still red). The tag cannot be forged by a command's own text: a
   parsed command always carries the `=` prefix, an over-cap one `!` and digits. Bytes, not characters. No new bypass
   closed, none opened; a bypass met is classified, not hunted (the stopping line).
2. **Tests, timing and mutation fidelity.** Every row mutates the guard it names and reds for the stated reason; the
   timing cases at the cap are inside their bounds with margin on a loaded box; the quote-dense pin reads the cap from
   the hook, and its 36 KB cases time the advisory alone; H40's case pins what bash does (it runs nothing inside the
   unclosed `$(`); the census is unmoved; the golden's three lines are the re-measured answer, not a hand edit.
3. **The residue and the text.** `jq_regex` keeps the doctor table's contract (one verdict line, a remedy under FAIL,
   SKIP never a pass) and FAILs exactly where the deny fails open for want of a regex engine; the closed-PR word is
   safe against the landing lane, and the server gloss it leaves unqualified is named; the wave-2 plan's text edits
   (the H20, H21, H39 and H40 rows, the size line, Task 7 Step 1) are true at `0087a045` and since the cap; Task 7's
   paragraph names what landed and keeps the listed classes.
