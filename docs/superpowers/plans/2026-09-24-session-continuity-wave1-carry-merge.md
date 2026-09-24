# Session continuity, wave 1 — the carry merges instead of skipping (AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a return visit carry a session's work. When `cmd_swap` carries a session's sidecar directory (`<root>/projects/<pdir>/<uuid>/`: subagent transcripts, workflow journals, tool results) onto an account where that directory already exists, `_swap_carry_sidecars` today logs `(kept)` and skips the whole tree — 774 of 1,310 carries in the baseline window, and every one of the 8 "journal … is not on disk" resume refusals came after only `(kept)` carries. After this wave the existing-destination branch walks the source file by file and decides on content and size by the spec's table, logs `sidecar <uuid> -> <dst> (merged +N ~R !D)`, deletes nothing, and repairs a destination an earlier failure left partial — bounded by a box-wide non-blocking slot that falls back to `(kept: busy)`, and by a byte budget spent as a PRIORITY FILL: the records a resume needs first, then the journals, then the rest, each placed whole until the next would overrun the budget, the rest deferred to the next visit and logged `(merged +N ~R !D, deferred K)` — so a backlog bigger than one budget drains over repeat visits instead of stranding the pair (`(kept: budget)` only when the first action alone is over it). Nothing waits. The first carry to an account keeps today's path byte for byte. Plus the programme's instrument, `deploy/measure-continuity.py`, with the two stage-1 rows of spec §9 — the carry row reported over every carry AND over the carries whose pair was not stranded before this wave's deploy (§9's own wording).

**Architecture:** Four pieces, each with tests that red when it is deleted or mutated, and all of it in one place in `ccd/ccd`, directly above `_swap_beat() {`, below every line-anchored citation into the file. (1) `_swap_carry_merge_walk src dst budget` — ONE embedded python3 program (fd-3 heredoc, `_pr_py`'s idiom): a dry pass over `lstat` alone that prices every action BEFORE anything moves; a PRIORITY FILL that orders the actions by resume value — the rewritten records (`workflows/<runId>.json`, `workflows/scripts/*`, `agent-*.meta.json`), then every `journal.jsonl`, then `agent-*.jsonl` and every other `*.jsonl`, then everything else, newest source mtime first within each — and places them whole, in that order, until the next would overrun the budget, deferring that one and every one after it (counted `K`, never started; rc 3 only when the FIRST action is priced over the budget on its own); then, for each placed action, the table: absent → hardlink else copy (`+N`); same inode, or equal size and equal nanosecond mtime, or equal bytes → nothing; `*.jsonl` whose destination is a strict prefix → replace by temp-and-rename (`~R`); a longer destination the source prefixes → keep; neither a prefix of the other → keep and count (`!D`, printed with the longer copy's path); a rewritten record (`workflows/<runId>.json`, `agent-*.meta.json`, `workflows/scripts/*`) whose source is newer → replace (`~R`); any other file whose bytes differ → keep and count (`!D`). (2) `_carry_slot_take` — `$REG/.carry.lock`, `flock -n`, never unlinked, three answers (taken / contended — `flock`'s own conflict code 1 and nothing else / no mechanism — no `flock`, an unopenable lock file, or any other `flock` failure); the lock file is a twelfth dot-prefixed `$REG` artifact, so `_ws_project_valid`'s R-3 boundary paragraph names it (a line-neutral rewording, far above every citation anchor). (3) `_swap_carry_sidecars`'s existing-destination branch — takes the slot once, at the first existing destination, calls the walk, logs one verdict per sidecar: `(merged +N ~R !D)`, `(merged +N ~R !D, deferred K)` when K actions did not fit, `(kept: busy)`, `(kept: budget)` or `(kept: error)`, plus one `diverged <kept> longer <longer>` row per `!D`, and releases the slot on its one way out. (4) `deploy/measure-continuity.py` — read-only, run by hand on the fleet box, built to the programme's one cross-wave shape (`STAGES = {N: stageN}`, `stageN(ctx)`; wave 1 owns `1: stage1`, wave 2 owns `4: stage4`, whichever lands first creates the file): the carry counter over `swap.log` by mode and reason, with the budget's deferred counts (merges cut short, actions deferred) — over every carry and, with `--deployed`, without the pairs stranded before the deploy — and the resume-refusal count over the transcripts, deduplicated by tool-use id.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `set -uo pipefail`, no `-e`), python 3.12 (the embedded walk; the instrument; three read-only measurement tools run from the scratchpad, never committed), TypeScript + vitest 4.1 (tests), util-linux `flock`.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md` — §5.1 (stage 1: the table, "Bounded" — its priority-fill budget, amended at the source on 2026-09-24 — and the tests), §1.2 mechanism 1, §3 C8 (the reversal this wave mints), §8 "Mass rescue I/O", §9 stage 1's row and its instrument clause, §11 item 1 (no backfill). Programme ledger: `docs/superpowers/programs/session-continuity.md` (wave 1).

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST.** The only shipped code is `ccd/ccd` (fleet box) and a read-only `deploy/` script nothing runs automatically. `ccrc rollout`'s DEFAULT order (fleet box first) is the order; this wave NEVER uses `--server-first`. Nothing in `server/src`, `agent/src`, `shared/` or `pwa/` changes, and no wire field, capability token or argv flag is added — `FLEET_PROTO` is untouched.
- **The first carry to an account is today's path, unchanged** (spec §5.1): `cp -al`, then the clear-then-copy `cp -a` fallback, logged `(link)` / `(copy)`, taking no slot. Only a destination that already exists reaches the merge. Task 2's "a first carry takes no slot" pins it.
- **Nothing is deleted, and nothing is half-placed.** The walk only creates files, creates directories and renames a temp file over a destination name. A destination-only file survives; the source is never written. An action the budget defers is never started — no file, no directory, no temp. Task 2's "deletes nothing" and "deletes nothing under a budget, and a deferred action leaves no partial file" pin it; mutation row 6 (today's clear-then-copy applied to an existing destination) reds both, and row 33 (the budget checked after a placement instead of before) reds the second.
- **Never wait.** The unit is already stopped when the carry runs, so a contended slot falls back to `(kept: busy)` at once (spec §5.1 "Bounded", §8), and the budget never holds the carry either: what does not fit this visit is deferred to the next, not queued.
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly — this wave's measurements READ `swap.log`, the account roots' `projects/` trees and the system manager's mount units with `stat`, `cat`, `find`, `findmnt` and `systemctl show`/`list-units`, and write nothing anywhere outside the scratchpad. NEVER print secret file CONTENTS.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`), whose `h.sh` spawns bash through `ghContainedEnv(home, …, { systemd: true, tmux: true })`. The new `ccd-swap-carry-merge.test.ts` spawns bash ONLY through `h.sh`, so `ccd-workspaces.test.ts`'s scan ("routes EVERY bash call site in every ccd test file through ALL THREE poisons") stays green; `measure-continuity.test.ts` spawns `python3` directly with `--home` pointed at the fixture HOME, and never reads the live one.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000ms, one at a time.** The fleet box is memory-bound (a pane scope throttles at 8G and dies at 12G with its session): never two suites at once from one pane, never a backgrounded suite. The whole server suite runs as sequential shards (Task 4).
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`.
- **Rings / no overloaded null at a seam:** `_carry_slot_take` answers three codes because its caller logs three different things (taken / `kept: busy` / `kept: error`) — and only `flock`'s conflict exit (1) is "contended": util-linux `flock` exits a sysexits code (65 `EX_DATAERR` for EBADF, 71 `EX_OSERR` for ENOLCK/ENOMEM) when it cannot lock at all, and folding that into 1 would give the operator the "someone else is carrying" remedy for a "this box cannot lock" fault; the walk answers rc 0 (merged, `K` actions perhaps deferred) / rc 3 (the first action alone over budget, nothing touched) / anything else because a partial merge, an unmergeable budget and a failure are three different verdicts — and a deferral is carried as its own number `K`, never folded into `!D` or into `(kept: budget)`. `(kept: error)` is its own word, never folded into `busy`: "another carry holds the slot" and "this box cannot merge" have different remedies.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated, measured before/after. Every mutation row in this plan was run on a prototype of exactly these edits, one row at a time, the file restored from a SAVED COPY after each (never `git checkout --`), and its red is quoted. The prototype for this revision (the priority-fill budget) stood on `469ce7b6`, whose code is byte-identical to `905360dc` (`git diff --stat 905360dc 469ce7b6` names only the four plans, the programme ledger and the two specs), so every "at `905360dc`" forecast holds for it; every row in Tasks 2 and 3 was re-run on it, one at a time, `--maxWorkers=1`.
- **`ccd/ccd` is a provenance-STAMPED file** (line 2 is `# ccrc:generated 1 sha256=…`). **Every task that edits `ccd/ccd` re-stamps before running any suite**, or `server/test/ownership.test.ts` reds:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **The citation tax (S6-R11) is owed by every CITED file this wave touches — and this wave's placement makes it zero, measured.** `server/test/session-hook.test.ts` audits every `file:line` citation in the two frozen corpus documents and in `README.md`. Measured at `905360dc` (`grep -oE '(ccd/ccd)?:[0-9]+'` over the two corpus documents — the file prefix OPTIONAL, because the corpus names a file once and continues with bare `` `:N` `` anchors — and `grep -oE 'ccd/ccd:[0-9]+(-[0-9]+)?' README.md`): the corpus's highest `ccd/ccd` anchor is `:19131`, README's two are `:21202` (`cmd_ensure`'s mint) and `:19989-19991` (the `genrc == 1` arm). Every line this wave ADDS or REMOVES sits at or below `_swap_carry_sidecars() {` (`:21615` at `905360dc`), below all three, so no anchor moves. The one edit ABOVE the anchors is the line-neutral rewording of `_ws_project_valid`'s R-3 boundary paragraph (≈6116–6123, Task 2 Step 3b): three lines each replaced by one line, `wc -l` asserted unchanged, and no corpus or README anchor points into 6090–6143 (measured: no `:60xx`/`:61xx` anchor in either corpus document or README). Task 2 still runs the re-pointer and the re-measurer (below) and expects them to report NO movement — the measurement, not this paragraph, is the authority. The other files this wave touches (`server/test/ccd-swap.test.ts`, two new tests, one new script) are cited by neither corpus document nor README.
- **The `_reg_get` census:** this wave adds NO `_reg_get` call (the slot is a lock file, not a registry field), so `ccd-reg-get-census.test.ts`'s sentence does not move; Task 2 runs that test to prove it.
- **The dot-prefixed registry census DOES move:** `ccd-account-auth.test.ts`'s "the dot-prefixed registry inventory is a census, not a memory" derives every `$REG/.<name>` literal the shipped bash writes (its regex `\$(?:REG|_SVC_REG)\/\.([a-z][a-z0-9-]*)` reads `$REG/.carry.lock` as `.carry`) and requires `_ws_project_valid`'s R-3 boundary paragraph to name each one and to carry the derived cardinal. The carry slot makes TWELVE. Task 2 Step 3b rewords that paragraph line-neutrally; without it the census reds `$REG/.carry is written by ccd's own bash and the R-3 boundary paragraph does not name it` (measured, mutation row 26).
- **Locate code by CONTENT.** Line numbers are "at `905360dc`" and are hints, never addresses. Four session-continuity waves and the landing-order programme are live against `ccd/ccd`; each lands on current `main` by a clean merge, re-stamps, and re-measures the citation corpus, the `_reg_get` census and the dot-prefixed `$REG` census on the merged tree before its final gate (programme ledger).
- **Every forecast number is "at `905360dc`"** (= `origin/main` `a3a93b41` plus the two approved specs and the programme ledgers). Where `origin/main` has moved since, a different line number or test total with every case PASSING is not a red — the instrument's output is the authority and the difference goes in the commit message. Stop only on a FAILING case or a moved census you cannot explain. Every file this plan edits is byte-identical at `08701c22` (the branch with main `b501698a` merged). Of the files it measures, only three moved: `README.md` (#176, #178 — prose only; its two `ccd/ccd` anchors, `:21202` and `:19989-19991`, are unchanged), `session-hook.test.ts` (#178 — comment lines only; `147`/`195` and the citation cases' `7 passed | 326 skipped` unchanged) and `single-definition.test.ts` (#176). So these forecasts were re-confirmed there, and the one number that moved is Task 2 Step 6's four-scan total (`single-definition` +54 from #176), stated at `08701c22`. `905360dc` leaves main's history when the docs PR squash-merges, so read it as a label, not a revision to check out.
- **Shell state does not survive between Bash calls.** Every code block that names `$SCRATCH` sets it itself; `SCRATCH=<…>` lines mean "paste your own session's scratchpad, as an ABSOLUTE path". Never run half a block, and never rely on a variable an earlier block set — an empty `$SCRATCH` points every path at `/`.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`). One commit per task that changes files (Tasks 2 and 3).
- **Commit trailers:** end every commit message with the attribution line your own session is given. The heredocs below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs, account names or user home paths** anywhere in a committed file (`topology-clean.test.ts`). The fixtures use `.claude` and `.claude-d`, the harness's own roster; measurement output that names a real account root stays in the scratchpad and the wave-done mail.
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.

---

## Review Focus

Six inputs or failure modes the spec implies and names no test for; each is given a test in the task that owns it.

1. **A destination `<uuid>` that is a symlink (or not a directory).** A walk that followed it would write the session's files somewhere outside the account root. Owned by Task 2: "a destination that is a symlink is not walked into: (kept: error)" (mutation row 12).
2. **A temp file a killed walk left behind** (`.ccd-carry-*`, on either side). Carried, it would land as a bogus file; counted, it would inflate `+N`; tripped on, it would fail the next walk. Owned by Task 2: "never carries, counts or trips on a temp a killed walk left" (row 16).
3. **The slot outliving the carry.** An fd left open would be inherited by the restarted unit's `systemctl start` chain and make every later carry `(kept: busy)` for as long as that process lives. Owned by Task 2: "releases the slot on the way out, and never unlinks the lock file" (row 10).
4. **A replace that writes THROUGH a destination inode another name shares** (a hardlinked first carry, or any second name). It would rewrite the other name too. Owned by Task 2: "extends a journal … by temp-and-rename", with a sibling hardlink that must keep the old bytes (row 5).
5. **ccd and the instrument disagreeing on the log line.** §9's stage-1 metric is read off `swap.log` by `measure-continuity.py`; a format drift would report zero merges while the carry works. Owned by Task 3: "counts what the real carry writes", which runs the real `_swap_carry_sidecars` — once under a budget that defers, so ccd's own `, deferred K` suffix is read too — and then the instrument over the same fixture HOME (rows 19, 40).
6. **A backlog bigger than one budget.** An all-or-nothing budget moves nothing on such a walk, so the next visit prices the same backlog plus the new bytes and the pair stays stranded for good — the measured defect this revision fixes; a fill that stopped part way through a file would leave a partial one; a fill that skipped past an action that did not fit, or that ordered by recency alone, would spend the budget on tool results while a journal waited. Owned by Task 2's five fill cases: a budget smaller than the walk places the records and journals and defers the tool results; the resume order, pinned position by position; an action over budget on its own is `(kept: budget)` and the fill never skips past it; a second visit places what the first deferred; nothing is deleted and a deferred action leaves no partial file (rows 8, 31–39).

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `ccd/ccd` | Modify — the whole `_swap_carry_sidecars` function (header to closing `}`, directly above `_swap_beat() {`, ≈21615–21706 at `905360dc`) is replaced by one block: the section header, `CARRY_MERGE_BUDGET`, `_carry_slot_take`, `_swap_carry_merge_walk`, and the rewritten `_swap_carry_sidecars`; and three comment lines of `_ws_project_valid`'s R-3 boundary paragraph (≈6116–6123) are reworded one line for one line to name the carry slot (Task 2) | The merge, its slot and its budget (a priority fill); the first carry unchanged; the dot-prefixed `$REG` census kept true |
| `server/test/ccd-swap-carry-merge.test.ts` | Create (Task 2) | Every rule of the table, the bounds, the fill's order, deferral and convergence, the fallbacks, the first carry unchanged |
| `server/test/ccd-swap.test.ts` | Modify — the `(kept)` case becomes the merged case; one comment corrected (Task 2) | The real `cmd_swap` reaches the merge |
| `deploy/measure-continuity.py` | Create — or, if wave 2 merged first, extend with the stage-1 block only (Task 3) | The programme's read-only instrument: stage 1's carry and resume sections |
| `server/test/measure-continuity.test.ts` | Create (Task 3) | The instrument reads what ccd writes, the deferred suffix included; windows; the stranded-pair split; the deferred counts; resume dedupe |

**Not modified, deliberately:** `README.md` (its two `ccd/ccd` anchors sit above every line this wave adds, the R-3 rewording is line-neutral, and README describes no sidecar rule), `server/test/ccd-account-auth.test.ts` (its census is derived; the paragraph moves to meet it, not the test), `server/test/session-hook.test.ts` (the census does not move), `CLAUDE.md`, `server/test/ccd-swap-carry.test.ts` (the transcript carry is untouched), everything under `server/src`, `agent/`, `shared/`, `pwa/`. `ccd-account-ok.test.ts` and `ccd-swap-pin.test.ts` stub `_swap_carry_sidecars() { :; }` by name — the name is kept, so they are untouched and stay green (measured).

---

## Pre-flight findings (measured while planning; not deviations)

Each was measured on the fleet box or on a prototype of this plan's exact edits at `905360dc`. They are the reasons the tasks look the way they do.

1. **The write model, measured (the spec's prerequisite).** Two instruments, both read-only. (a) A live sample of this planning session's own running workflow: one `agent-*.jsonl` stat'd three times over 30 minutes kept ONE inode while it grew 641,806 → 976,799 → 1,516,725 bytes; the run's `journal.jsonl` kept its inode (it had not been appended to yet — no agent had finished). (b) `write-model.py` (Task 1) over every workflow run that FINISHED on the account root it sits on, last 3 days: 128 runs; `journal.jsonl` appended in place 128 of 128 (born at launch, last written at completion, ≥ 3 lines); `agent-*.jsonl` appended in place 4,447; copied with a preserved mtime (a carry, or Claude Code's own relocation of a resumed run) 158; born at their last write 10 — 2 one-second agents of 11 rows, and 8 files born at 21:04–21:06 on 2026-09-22 whose rows end before 21:01, i.e. copies made by the account-root migration that evening (below), which did not preserve mtime. `workflows/<runId>.json` is written whole at the run's end: born within 2 s of its last write in 128 of 128. `agent-*.meta.json` was born and last written in the same instant in both runs sampled by hand (six files). **Verdict: the logs are appended in place, the records are written whole; the spec's table stands as written.** The table decides on CONTENT (prefix, bytes, mtime), so even a replace-by-rename writer would not change a verdict — what the write model does change is the old header's claim that sidecars are "write-once artifacts", which Task 2 corrects.
2. **The `(copy)` fallbacks on a one-device box, explained.** Every account root is its own bind mount of the one data volume (`findmnt`: 20 roots, one source device), and `link(2)` across two mount points answers `EXDEV` even inside one filesystem — measured with a scratch file hardlinked across two mounts of the same volume: `ln: failed to create hard link … Invalid cross-device link`, and `cp -al` left an empty skeleton, exactly the shape the carry's fallback clears. Joined against each root's mount activation time (`linkmode.py`, Task 1): every dated `(copy)` involved a root that was already a mount (262 of 262), and every dated `(link)` ran while both roots were still plain directories (163 of 163); 202 lines name a root with no mount unit today and get no verdict. The roots were moved onto bind mounts one at a time, from 2026-08-21 to 2026-09-22; since the box's mount table last changed (2026-09-22 21:52) every carry is `(copy)` — 17 of 17 at planning. Consequence for the design: on this fleet every `+N` is a copy, never a link, and every carried file is an independent inode — so a return visit cannot find "equal by identity", and the budget is what bounds it.
3. **Park-and-wake R4's box-wide release lock has NOT shipped:** `grep -c 'release.lock' ccd/ccd` → `0` at `905360dc`. Per spec §5.1 the carry takes a slot of its own, `$REG/.carry.lock`.
4. **Every path that carries goes through ONE call.** `_swap_carry_sidecars` has exactly one caller, `cmd_swap` (`grep -n '_swap_carry_sidecars "' ccd/ccd` → one hit, ≈22790), and rescue, auto-home (both via `_dispatch_swap`), manual/PWA swaps and `swap-self` all run `cmd_swap`. A supervisor revival never changes account and never carries. So a slot taken inside the function covers every path the spec names.
5. **The sidecar census, and the budget.** Over every sidecar on the box: 1,095 directories; bytes p50 20 MB, p90 222 MB, p99 1.29 GB, max 2.18 GB; files p50 71, p90 727, p99 3,497, max 6,142 (hence one python process, not a fork per file). Over the 673 real return-visit pairs on the box (the same `<pdir>/<uuid>` under two roots), the walk's byte cost: with the size+mtime quick check p50 5.6 MiB, p90 208 MiB (214 MiB re-measured 2026-09-24), p99 1,091 MiB — equal to the bytes that are actually new at every percentile; comparing bytes alone, p50 80 MiB, p90 764 MiB, p99 1,561 MiB. At `CARRY_MERGE_BUDGET` = 512 MiB the whole walk of 43 of the 673 pairs is priced over the budget with the quick check, and of 87 without (re-measured 2026-09-24: 43 and 87 again). The pairs are today's stranded backlog (C9: not backfilled). **Under the all-or-nothing budget this plan first carried, each of those 43 pairs fell back to `(kept: budget)` on EVERY return visit** — nothing moved on an over-budget walk, so the next dry pass priced the same backlog plus whatever was new, and the session's new journals stayed stranded on that pair for good. That is the defect this revision fixes with the priority fill (Planning decisions). **The fill, measured** (2026-09-24, `fill-census.py`, read-only, scratchpad: it `lstat`s the `~/.claude*/projects/*/<uuid>/` trees and nothing else, runs the walk's own dry pass, prices and resume order on every pair — src the root holding the newest file, dst each other root — and fills at 512 MiB): of the 673 pairs, **630 place everything on the first visit, 43 defer some actions, 0 are `(kept: budget)`** — no single action on the box is priced over the budget on its own (the largest is 64 MiB, an absent file). A deferring first visit leaves p50 535 actions / 289 MiB behind, at most 1,966 actions / 938 MiB. Simulating repeat visits with NO new bytes (a placement leaves the destination equal and drops out; a compare that can place nothing — 37 same-size compares and 81 longer-destination logs on the whole box — is priced again every visit), **all 43 converge: 27 in 2 visits, 16 in 3.** None stalls behind compares that place nothing, and none is headed by an action over budget. Two assumptions, because the census reads no byte: a shorter destination log IS a prefix of its source (the logs are appended in place, finding 1), and a same-size newer record differs from its destination. §9 therefore reports the stage-1 row both over every carry and without the pairs stranded before the deploy (`--deployed`, Task 3), and the budget's cut beside it: `deferred_carries` (merges logged `, deferred K`) and `deferred_actions` (the summed `K`), with `kept: budget` its own count. The dry pass over this planning session's own stranded sidecar (a copy on another root) took 0.13 s and priced the merge at 88.6 MB.
6. **The citation census does not move** (Global Constraints). `repoint-readme.py` printed `ccd/ccd:21202` and `ccd/ccd:19989-19991` and left README byte-identical; `cite-remeasure.py … HEAD` printed `stated == base == tree` on all four lines — `147 / 195 / 53 / 35` — with EMPTY `ENTERED`/`LEFT` everywhere.
7. **The existing `(kept)` pin reverses.** `ccd-swap.test.ts` "leaves an existing destination sidecar alone — a tree is not replaced in one step" reds on the prototype: `expected '… carry b7001948-22…' to contain '(kept)'`, the log now reading `(merged +0 ~0 !1)` (its differing tool result is kept and counted). Task 2 rewrites that case in the same commit; it is the pin C8 reverses.
8. **The instrument reproduces the spec's baseline exactly, read-only, on the fleet box** (re-measured 2026-09-23 with this revision's `STAGES` instrument; the box's zone is UTC, so its local-time window reading equals the UTC text one the first cut used). `measure-continuity.py --stage 1 --since 2026-09-08 --until '2026-09-23 08:50'` → `carry`: 1,310 carries, `kept` 774, `copy` 389, `link` 147; `--stage 1 --since 2026-09-08 --until '2026-09-23 18:26'` → `resume`: 72 resume calls: ok 55, journal-missing 8, script-path 5, other-error 4 (spec §1.2: 72; 8; 5; "ok with 0 swaps 36; ok with ≥1 swap 19"; 3 still running + 1 parse error). Each run reads both sections, 57 s. The resume row reads only the LARGEST transcript copy of each session uuid (44.6 GB of names in the window collapse to 6.4 GB) and skips a file with no `resumeFromRunId` in C (`mmap.find`). A first cut that read every copy line by line was killed at 15 minutes.
9. **The stranded split can map every wrapper on the box from the log alone.** The instrument learns each wrapper's account root from `swap.log` itself (a carry's `sidecar … -> <root>/projects/…` lines precede its `swap <id>: <from> -> <to> (uuid …)` line). Over the live log: 17 distinct wrappers on 3,462 swap-line sides, 17 mapped, none to two roots, 0 sides on an unmapped wrapper — and 3 of the 17 roots are NOT named `.<wrapper>`, so the log-learned map is the right one and a name convention would have been wrong (`mapprobe.py`, read-only, scratchpad). Run with `--deployed` at the end of the baseline window, every baseline carry reads as stranded (`excluding_stranded.carries` 0), as it must.

---

## Planning decisions the spec did not make

Each is built as written below; each is named in `spec_gaps` for the coordinator, and none is a deviation from a spec rule unless the coordinator rules it one — except the priority-fill budget, which departs from spec §5.1's written "all or nothing" by orchestrator decision and says so in its own entry.

- **The quick check.** Spec §5.1's second row reads "equal size and equal bytes → nothing". This plan decides "equal" in three ways, in order: the same inode (equal by identity — identity decides only EQUAL, never DIFFERENT, so the spec's "never on inode identity" holds for every other verdict); equal size AND equal nanosecond mtime (rsync's default quick check — every carry on this fleet is a `cp -a` or python `copy2`, both of which preserve `mtime_ns`); otherwise a byte compare. Measured cost (finding 5): it takes the p90 return visit from 764 MiB to 208 MiB. Named cost: two different files of identical size AND identical nanosecond mtime read as equal. Pinned so it cannot widen: "decides equality on size AND mtime, never on size alone" (mutation row 1).
- **A third fallback word, `(kept: error)`.** The spec names `busy` and `budget`. A walk that cannot run at all — no `flock`, the lock file unopenable, a `flock` that fails for any reason but a conflict, no `python3`, a destination that is not a real directory, or the walker failing — is neither, and folding it into either would give the operator the wrong remedy. The instrument counts it separately and reports `kept_other_than_busy_budget` (legacy `kept` + `error`) against §9's target.
- **The budget is a PRIORITY FILL, not all or nothing — decided at plan review by the orchestrator (2026-09-24), and amended into spec §5.1 and §9 at the source in the same commit as this plan.** The spec's first text charged the whole walk and fell back to `(kept: budget)` when it was over, "all or nothing", and §9's note counted 43 pairs that "fall back to `(kept: budget)`". Measured (finding 5), that strands each such pair on every return visit for good, which defeats the wave's purpose. So the dry pass still prices every action from `lstat` before anything moves (the bytes it would read to compare plus the bytes it would copy), and then orders the actions by resume value and places them in that order until the next one would exceed the budget: (1) the rewritten records a resume needs — `workflows/<runId>.json`, `workflows/scripts/*`, `agent-*.meta.json`; (2) the append-only logs — every `journal.jsonl` first, then `agent-*.jsonl` and every other `*.jsonl`; (3) everything else (tool results and the rest); newest source mtime first within each. Each placed action is exactly the table's action (a link, or a temp renamed into place; nothing deleted). The action that would overrun the budget and every one after it are DEFERRED: counted, never started, never half-done. The verdict is `(merged +N ~R !D)` when everything fit and `(merged +N ~R !D, deferred K)` when K did not; `(kept: busy)` and `(kept: error)` are unchanged, and `(kept: budget)` is logged only when not even the first action fits — it is priced over the budget on its own — and then the destination is exactly as it was. Because every visit places the most valuable bytes first and the next visit finds them equal (a link is the same inode, a copy keeps size and `mtime_ns`), the backlog shrinks by what was placed and repeat visits converge — measured: all 43 of the box's over-budget pairs in 2 or 3 visits with no new bytes. The fill STOPS at the first action that does not fit; it never skips past it to a smaller one, so a lower-value action never goes ahead of a higher-value one. Two named costs, both measured at zero on the box today (finding 5): an action priced over the budget on its own heads its queue and holds everything behind it (the largest action on the box is 64 MiB, an eighth of the budget); and a compare that can place nothing (a same-size file that is not a newer record, a log whose destination is longer) is priced again on every visit, so enough of them ahead of a placement could hold it back. `deferred_carries` / `deferred_actions` (Task 3) make either visible if it ever appears. The spec's §5.1 "Bounded" paragraph, its test list and §9's stranded-backlog note now describe the fill (amended at the source; re-read 2026-09-24 at `08701c22`: `grep -n 'falls back before any byte moves' docs/superpowers/specs/2026-09-23-session-continuity-design.md` → no hit, and §5.1 reads "`(merged +N ~R !D, deferred K)`"), and the departure carries no number (see `## Deviations found`).
- **Files the table does not classify.** A file outside the three named classes whose bytes differ (a tool result is written once) is kept and counted `!D`; a destination entry of another type where the source has a regular file is kept and counted `!D`; a non-regular source entry (a symlink, a fifo) is never followed and never copied. The spec's "named in the manifest with the longer copy's path" has no manifest until stage 3 (wave 6), so this wave writes one `sidecar <uuid> diverged <kept path> longer <longer path>` row to `swap.log` per `!D` — the input wave 6's manifest will read.
- **`CARRY_MERGE_BUDGET` = 512 MiB,** per sidecar directory per visit, from finding 5: at 512 MiB 630 of the box's 673 return-visit pairs place everything on the first visit and the other 43 drain in 2 or 3; a knob beside the function, not in the tuning block near the top of the file (that would move every citation anchor below it). The dry pass prices a same-size record replace as its compare (both sides) PLUS the copy the replace then makes, so a visit can never run over the budget it was priced under.
- **"Stranded before the deploy" (§9's split), made measurable from `swap.log` alone.** A carry's pair is `(session uuid, destination account root)`. It is stranded when that root held the session before `--deployed`: a sidecar line dated before it names the root, or a `swap` line dated before it names that root's wrapper as either side — the `from` side is what catches the root a session was BORN on, which no sidecar line ever names and which is where auto-home returns a session. The instrument reports the carry section over every carry and again as `excluding_stranded`, each with the budget's `deferred_carries` and `deferred_actions` beside `kept: budget`. Named cost: a wrapper that never received a sidecar carry has no learned root, so a born-there pair on it reads as not stranded — measured at 0 unmapped wrappers on the box today (finding 9).
- **The instrument's shape is the programme's cross-wave contract,** not this wave's choice: `STAGES = {N: stageN}`, `stageN(ctx)` returning named sections, `ctx` a dict of `home`, `swap_log`, `since`, `until`, `deployed` (epochs) and `all_copies`; CLI `--stage N` (repeatable), `--home`, `--swap-log`, `--since`, `--until`, `--deployed`, `--all-copies`, `--json`. Whichever of waves 1 and 2 lands first creates the file; the other adds only its own `# ── stage N` block, its `STAGES` entry and any missing flag (Task 3 Step 3).

---

## The citation tax, mechanised (S6-R11)

`server/test/session-hook.test.ts` audits every `file:line` citation in two FROZEN corpus documents (`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`, `docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`) and in `README.md`. Any line inserted into `ccd/ccd` moves every anchor below it. The standing rule S6-R11: **README is REPAIRED, by content, never counted; everything else is RE-MEASURED from the instrument, with the composition stated; no rule is widened and no D-number is spent.** Every line this wave adds or removes sits below every anchor (its one edit above them, Task 2 Step 3b, is line-neutral), so the forecast is NO movement — but the forecast is checked by the instruments, not assumed.

Two tools do the mechanical half, verbatim from the child-reclamation wave-1 plan. Write both into your scratchpad once (they are measurement instruments — never committed). `$SCRATCH` below is your session's scratchpad directory, as an ABSOLUTE path: write the two files to that absolute path, and open every shell block that runs them with `SCRATCH=<that path>`.

- [ ] **Write the README re-pointer** to `$SCRATCH/repoint-readme.py`:

```python
#!/usr/bin/env python3
"""Re-point README.md's two `ccd/ccd:` anchors BY THE BYTES THEIR SENTENCES QUOTE.

README carries exactly two anchors into ccd/ccd, and each sentence names what it
points at: `cmd_ensure`'s `_reg_generation_init "$id"`, and the contended arm
`genrc == 1` (cited as the three lines around its `elif`, the convention every
earlier re-anchor of it used). Both are located in the working ccd/ccd by that
content — never by adding a shift to a number — and a README that carries any
OTHER ccd/ccd anchor is refused, so a third one can never be skipped silently.
Run from the repo root after every ccd/ccd edit, before re-measuring the census.
"""
import re
ccd = open('ccd/ccd', encoding='utf8').read().split('\n')
readme = open('README.md', encoding='utf8').read()
anchors = re.findall(r'ccd/ccd:\d+(?:-\d+)?', readme)
assert len(anchors) == 2, f'README carries {len(anchors)} ccd/ccd anchors, not the two this tool knows: {anchors}'
start = [i for i, l in enumerate(ccd) if l.startswith('cmd_ensure() {')]
assert len(start) == 1, 'cmd_ensure() is not defined exactly once'
nxt = next(i for i in range(start[0] + 1, len(ccd)) if re.match(r'^[A-Za-z_][A-Za-z0-9_]*\(\) \{', ccd[i]))
E = [i + 1 for i in range(start[0], nxt) if '_reg_generation_init "$id"' in ccd[i] and not ccd[i].lstrip().startswith('#')]
assert len(E) == 1, f'cmd_ensure calls _reg_generation_init "$id" {len(E)} times'
L = [i + 1 for i, l in enumerate(ccd) if l.strip() == 'elif (( genrc == 1 )); then']
assert len(L) == 1, 'the genrc == 1 arm is not unique'
e, l = E[0], L[0]
new, n1 = re.subn(r'(`_reg_generation_init "\$id"`, `ccd/ccd:)(\d+)(`)', lambda m: f'{m.group(1)}{e}{m.group(3)}', readme)
new, n2 = re.subn(r'(the contended arm \(`ccd/ccd:)(\d+-\d+)(`, `genrc == 1`\))', lambda m: f'{m.group(1)}{l - 1}-{l + 1}{m.group(3)}', new)
assert n1 == 1 and n2 == 1, 'a README anchor sentence changed shape; re-point it by hand'
print(f'cmd_ensure mint   -> ccd/ccd:{e}      ({ccd[e - 1].strip()})')
print(f'genrc == 1 arm    -> ccd/ccd:{l - 1}-{l + 1}  (elif at {l})')
open('README.md', 'w', encoding='utf8').write(new)
```

- [ ] **Write the census re-measurer** to `$SCRATCH/cite-remeasure.py`:

```python
#!/usr/bin/env python3
"""Re-measure session-hook.test.ts's citation census FROM THE INSTRUMENT (S6-R11).

Run from the repo root AFTER ccd/ccd is re-stamped and README.md is re-pointed.
It runs ONLY the citation cases twice — once with ccd/ccd and README.md as they
stand at <base-ref>, once as they stand in the working tree — each time with
four dump probes inserted above the assertions they feed, and restores every
file it touched byte-for-byte (asserted). It prints what the test STATES, what
the instrument MEASURES, and the COMPOSITION (which references entered and
which left, base -> tree), which is what the S6-R11 comment must state.
With --write it rewrites exactly four literals in the test — `'ccd/ccd': N` in
the byFile map, `.toBe(N)` on `total`, and the two ref arrays of the `|`-row
case — in the instrument's own order. It never edits a comment.
usage: python3 cite-remeasure.py <scratch-dir> <base-ref> [--write]
"""
import collections, json, os, re, shutil, subprocess, sys
scratch, base = sys.argv[1], sys.argv[2]; write = '--write' in sys.argv
T = 'server/test/session-hook.test.ts'
out = os.path.join(scratch, 'cite'); os.makedirs(out, exist_ok=True)
src = open(T, encoding='utf8').read()
SITE_EXPR = ("      `${f.doc}:${f.line} ${refKey(f)}`;",
             "    const seen = new Set([...audit(realCorpus()).failures, ...filesAudit(realCorpus()).failures].map(site));")
for expr in SITE_EXPR:
    assert src.count(expr) == 1, f'the site-level expression changed in the test; update this probe: {expr}'
ROW_ANCHOR = "    expect(r.failures.map(refKey), 'a `|` row stopped naming what the ROW quotes — re-measure')"
BYFILE_ANCHOR = "    expect(byFile, 'the citation debt moved"

def probed(dump):
    """The test with the probes in. The site-level list is computed ABOVE the
    row array's expect, because that expect reds first and would stop the `it`
    before the site-level one ran; the two expression lines are asserted above
    to be the test's own, so this copy cannot drift from what it copies."""
    t = src
    for a in (ROW_ANCHOR, BYFILE_ANCHOR):
        assert t.count(a) == 1, f'probe anchor not unique: {a[:50]}'
    t = t.replace(BYFILE_ANCHOR,
        f"    fs.writeFileSync({json.dumps(dump + '/byfile.json')}, JSON.stringify({{ byFile, "
        "sites: r.failures.map((f) => `${f.doc}:${f.line} ${refKey(f)}`) }));\n" + BYFILE_ANCHOR)
    t = t.replace(ROW_ANCHOR,
        f"    fs.writeFileSync({json.dumps(dump + '/rows.json')}, JSON.stringify(r.failures.map(refKey)));\n"
        "    { const site = (f: { doc: string; line: number; file: string; from: number; to: number }): string =>\n"
        f"{SITE_EXPR[0]}\n{SITE_EXPR[1]}\n"
        f"    fs.writeFileSync({json.dumps(dump + '/sites.json')}, "
        "JSON.stringify(r.failures.map(site).filter((k) => seen.has(k)))); }\n" + ROW_ANCHOR)
    return t

def measure(label):
    dump = os.path.join(out, label); os.makedirs(dump, exist_ok=True)
    for f in ('byfile.json', 'rows.json', 'sites.json'):
        if os.path.exists(os.path.join(dump, f)): os.remove(os.path.join(dump, f))
    open(T, 'w', encoding='utf8').write(probed(dump))
    try:
        subprocess.run(['./node_modules/.bin/vitest', 'run', 'test/session-hook.test.ts', '-t',
                        'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND'],
                       cwd='server', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=580)
    finally:
        open(T, 'w', encoding='utf8').write(src)
    b = json.load(open(os.path.join(dump, 'byfile.json')))
    return (b['byFile'], b['sites'], json.load(open(os.path.join(dump, 'rows.json'))),
            json.load(open(os.path.join(dump, 'sites.json'))))

saved = {p: open(p, encoding='utf8').read() for p in ('ccd/ccd', 'README.md')}
try:
    for p in saved:
        open(p, 'w', encoding='utf8').write(
            subprocess.run(['git', 'show', f'{base}:{p}'], capture_output=True, text=True, check=True).stdout)
    B = measure('base')
finally:
    for p, body in saved.items(): open(p, 'w', encoding='utf8').write(body)
for p, body in saved.items():
    assert open(p, encoding='utf8').read() == body, f'{p} was not restored byte-for-byte'
N = measure('tree')
assert open(T, encoding='utf8').read() == src, 'the test file was not restored byte-for-byte'

ENTRY = re.compile(r"^        '[^']*',$")
def array_block(text, head):
    """[start, end) of the CONTIGUOUS run of `        '<ref>',` lines in this
    expect's array. Comments above the first entry lie outside it and are never
    touched; a non-entry line INSIDE the run is refused."""
    i = text.index(head); j = text.index('.toEqual([', i); k = text.index('\n      ]);', j)
    lines = text[j:k].split('\n')
    idx = [n for n, l in enumerate(lines) if ENTRY.match(l)]
    assert idx and idx == list(range(idx[0], idx[-1] + 1)), f'the array under {head[:40]} is not one contiguous run; edit by hand'
    s = j + sum(len(l) + 1 for l in lines[:idx[0]])
    return s, s + sum(len(l) + 1 for l in lines[idx[0]:idx[-1] + 1]) - 1
def stated(head):
    s, e = array_block(src, head)
    return re.findall(r"^\s+'([^']*)',$", src[s:e], re.M)
def moved(a, b):
    ca, cb = collections.Counter(a), collections.Counter(b)
    return sorted((cb - ca).elements()), sorted((ca - cb).elements())

ROW_HEAD = "expect(r.failures.map(refKey), 'a `|` row stopped naming"
SITE_HEAD = "expect(r.failures.map(site).filter((k) => seen.has(k)),"
by, total = N[0], sum(N[0].values())
stated_cc = re.search(r"^      'ccd/ccd': (\d+),$", src, re.M).group(1)
stated_total = re.search(r"this is it'\)\.toBe\((\d+)\);", src).group(1)
print(f"byFile['ccd/ccd']  stated {stated_cc}  base {B[0].get('ccd/ccd')}  tree {by.get('ccd/ccd')}")
print(f"total              stated {stated_total}  base {sum(B[0].values())}  tree {total}")
print(f"other byFile keys moved: {sorted(k for k in set(B[0]) | set(by) if k != 'ccd/ccd' and B[0].get(k) != by.get(k)) or 'none'}")
e, l = moved(B[1], N[1]); print(f"byFile composition  ENTERED {e}\n                    LEFT    {l}")
for name, head, bv, nv in (('row array', ROW_HEAD, B[2], N[2]), ('site array', SITE_HEAD, B[3], N[3])):
    e, l = moved(bv, nv)
    print(f"{name}: stated {len(stated(head))}  base {len(bv)}  tree {len(nv)}\n    ENTERED {e}\n    LEFT    {l}")
if write:
    t = src
    t = re.sub(r"^(      'ccd/ccd': )\d+,$", lambda m: f"{m.group(1)}{by['ccd/ccd']},", t, count=1, flags=re.M)
    t = re.sub(r"(this is it'\)\.toBe\()\d+(\);)", lambda m: f"{m.group(1)}{total}{m.group(2)}", t, count=1)
    for head, got in ((ROW_HEAD, N[2]), (SITE_HEAD, N[3])):
        s, e2 = array_block(t, head)
        t = t[:s] + '\n'.join(f"        '{v}'," for v in got) + t[e2:]
    open(T, 'w', encoding='utf8').write(t)
    print('rewrote the four literals from the instrument; now write the S6-R11 composition comment by hand')
```

**The procedure, for the task that edits `ccd/ccd`** (Task 2 restates it as numbered steps):

1. Re-stamp `ccd/ccd`.
2. `SCRATCH=<abs path>; python3 "$SCRATCH/repoint-readme.py"` — README first.
3. `SCRATCH=<abs path>; python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD` — read-only. **If any `base` value differs from its `stated` value, the tree was red before your edit: stop and report it; it is not this task's to fix.** Then compare the `tree` values and the composition with the forecast (no movement).
4. Only if something moved: re-run with `--write`, then write the S6-R11 composition comment, then run the citation cases green — and report it, because this plan forecast no movement.
5. **Both corpus documents must be byte-identical to `origin/main`:**

       git fetch origin main && git diff --quiet origin/main -- \
         docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
         docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen

   Expected: `corpus-frozen`.

---

### Task 1: Re-measure the write model and the `(copy)` explanation — the spec's prerequisite, with a stop rule

**Model routing:** `sonnet`, effort `medium`. Three read-only scripts and a verdict. **No code, no commit, no fleet mutation.**

**Files:** none in the repo. Evidence lands in `$SCRATCH/write-model/` and in the wave-done mail.

**Interfaces:**
- Consumes: the fleet box's account roots (`$HOME/.claude*/projects/`), `$HOME/.cc-sessions/swap.log`, and the system manager's mount units — all READ ONLY.
- Produces: the write-model verdict Task 2's rules depend on (spec §5.1: "if the measurement says otherwise, the rules change before the code"), and the `(copy)` explanation, both for the wave-done mail and the programme ledger.

Planning measured both (Pre-flight findings 1–2). This task re-measures them on the day the code is written, because the write model belongs to another program (Claude Code), which the fleet upgrades on its own schedule.

- [ ] **Step 1: Write the write-model probe** to `$SCRATCH/write-model/write-model.py`:

```python
#!/usr/bin/env python3
"""The stage-1 write-model probe (session continuity spec §5.1, prerequisite). READ-ONLY.

It runs `stat` and opens files for reading; it writes nothing, anywhere.

For every workflow run under every account root whose `workflows/<runId>.json`
was modified in the last --days days AND finished on the root it is found on
(that record born within 2 s of its own last write: a CARRIED copy is born at
the carry, long after the mtime `cp -a` preserved), it classifies the run's
files by birth time (statx %W) against modify time:

  journal.jsonl  born well before its last write, >= 3 lines  -> append-in-place
  agent-*.jsonl  born well before its last write               -> append-in-place
                 mtime OLDER than birth                         -> copied (mtime preserved)
                 born within 2 s of its last write, <= 6 lines  -> one burst
                 born within 2 s of its last write, >  6 lines  -> inspect
  <runId>.json   born within 2 s of its last write              -> written-at-end

A file replaced by temp-and-rename is born at its last write. That — for a
journal, or for an agent transcript too long to be one burst — is the verdict
that would change stage 1's rules. usage: write-model.py [--days N] [--show]
"""
import collections, glob, os, subprocess, sys, time

days = int(sys.argv[sys.argv.index('--days') + 1]) if '--days' in sys.argv else 3
cut = time.time() - days * 86400
home = os.path.expanduser('~')


def stat_bm(paths):
    """{path: (birth, mtime)} from one stat(1) call; birth 0 = the filesystem cannot say."""
    out = subprocess.run(['stat', '-c', '%W %Y %n', '--', *paths], capture_output=True, text=True).stdout
    r = {}
    for line in out.splitlines():
        w, y, n = line.split(' ', 2)
        r[n] = (int(w), int(y))
    return r


def lines(p):
    with open(p, 'rb') as f:
        return sum(1 for _ in f)


v = collections.Counter()
suspects = []
for rec in glob.glob(os.path.join(home, '.claude*', 'projects', '*', '*', 'workflows', 'wf_*.json')):
    if os.stat(rec).st_mtime < cut:
        continue
    side = os.path.dirname(os.path.dirname(rec))
    jdir = os.path.join(side, 'subagents', 'workflows', os.path.basename(rec)[:-5])
    journal = os.path.join(jdir, 'journal.jsonl')
    agents = glob.glob(os.path.join(jdir, 'agent-*.jsonl'))
    st = stat_bm([rec] + ([journal] if os.path.exists(journal) else []) + agents)
    b, m = st[rec]
    if b == 0:
        v['record: birth unknown on this filesystem (no verdict)'] += 1
        continue
    if abs(m - b) > 2:
        continue          # carried here, or rewritten: not a run that finished on this root
    v['record: written-at-end'] += 1
    if journal in st:
        jb, jm = st[journal]
        ok = jm - jb > 2 and lines(journal) >= 3
        v['journal: append-in-place' if ok else 'journal: born at its last write (STOP)'] += 1
        if not ok:
            suspects.append(journal)
    for a in agents:
        ab, am = st[a]
        if am - ab > 2:
            v['agent: append-in-place'] += 1
        elif ab - am > 2:
            v['agent: copied (mtime preserved, older than birth)'] += 1
        elif lines(a) <= 6:
            v['agent: one burst (<= 6 lines)'] += 1
        else:
            v['agent: born at its last write, > 6 lines (inspect)'] += 1
            suspects.append(a)
print(f'finished-here runs judged, last {days} days: {v["record: written-at-end"]}')
for k, n in sorted(v.items()):
    print(f'  {k}: {n}')
if '--show' in sys.argv:
    for p in suspects[:20]:
        print('  inspect:', p)
```

- [ ] **Step 2: Run it over finished runs, and inspect anything born at its last write**

```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] || { echo "STOP: SCRATCH is not an absolute directory"; exit 1; }
python3 "$SCRATCH/write-model/write-model.py" --days 3 --show | tee "$SCRATCH/write-model/verdict.txt"
```

Expected (planning, 2026-09-23): `finished-here runs judged, last 3 days: 128`, `journal: append-in-place: 128`, `agent: append-in-place: 4447`, `agent: copied (mtime preserved, older than birth): 158`, `agent: born at its last write, > 6 lines (inspect): 10`, `record: written-at-end: 128`, and NO `journal: born at its last write (STOP)` line. Your counts will differ; the SHAPE is what is checked. For every `inspect:` path, print its first and last row times beside its birth:

```bash
SCRATCH=<your scratchpad, absolute>
grep '^  inspect: ' "$SCRATCH/write-model/verdict.txt" | sed 's/^  inspect: //' | while IFS= read -r f; do
  python3 - "$f" <<'PY'
import json, os, subprocess, sys
f = sys.argv[1]
ts = []
for l in open(f, 'rb'):
    try:
        t = json.loads(l).get('timestamp')
    except ValueError:
        continue
    if t:
        ts.append(t)
birth = subprocess.run(['stat', '-c', '%W', '--', f], capture_output=True, text=True).stdout.strip()
print(f'rows {len(ts)} first {ts[0] if ts else "-"} last {ts[-1] if ts else "-"} born {birth} ({os.path.basename(f)})')
PY
done
```

Read each line: a file BORN AFTER its last row's time is a copy made later (a migration, a relocation) — not evidence about the writer; a file whose rows span under ~2 s is one burst. **STOP rule:** if the probe prints any `journal: born at its last write (STOP)` row, or an inspected `agent-*.jsonl` was born at (within 2 s of) its FIRST row and last written at its last row while its rows span minutes — i.e. rewritten by rename during the run — then Claude Code has changed its write model. Do not start Task 2: report the verdict and the paths to the coordinator, because the header text Task 2 writes ("appended in place") and the prefix-extend rule's premise must be re-read first. Otherwise the verdict is `append-in-place logs, whole-written records` and Task 2 proceeds as planned.

- [ ] **Step 3: A live sample, if a run is live**

```bash
f=$(find "$HOME"/.claude*/projects/*/*/subagents/workflows -name 'agent-*.jsonl' -mmin -5 2>/dev/null | head -1)
if [ -z "$f" ]; then echo "no live workflow agent in the last 5 minutes — Step 2 stands alone"; else
  echo "before: $(stat -c '%i %s' -- "$f")"; fi
```

If one printed, spend at least two minutes on other work (writing Task 2's test file is a good use of them) and then stat the same file again with `stat -c '%i %s' -- <that path>`. Expected: the SAME inode and a LARGER size — planning measured 641,806 → 976,799 → 1,516,725 bytes on one inode. A different inode is the STOP above. (The path names an account root: it goes in the mail, never in a commit.)

- [ ] **Step 4: Re-measure the `(copy)` explanation.** Write `$SCRATCH/write-model/linkmode.py`:

```python
#!/usr/bin/env python3
"""Why a first sidecar carry logs (link) or (copy): each account root's bind-mount date. READ-ONLY.

Reads `systemctl list-units --type=mount` / `systemctl show` (the SYSTEM manager's
mount units — read, never changed) and `$HOME/.cc-sessions/swap.log`. For every
`sidecar … (link|copy)` line it finds the `swap <id>: <from> -> <to>` line that
follows it for the same uuid, maps each wrapper to its root `$HOME/.<wrapper>`,
and asks whether either root was already its own mount at that moment.
link(2) across two mount points answers EXDEV even on one filesystem, so the
prediction is: (link) only when neither root was a mount yet; (copy) otherwise.
"""
import collections, os, re, subprocess
home = os.path.expanduser('~')
units = subprocess.run(['systemctl', 'list-units', '--type=mount', '--all', '--plain', '--no-legend'],
                       capture_output=True, text=True).stdout.split('\n')
mounted_at = {}
for line in units:
    u = line.split(' ')[0]
    if '.claude' not in u:
        continue
    out = subprocess.run(['systemctl', 'show', u, '-p', 'Where', '-p', 'ActiveEnterTimestamp'],
                         capture_output=True, text=True).stdout
    d = dict(l.split('=', 1) for l in out.strip().split('\n') if '=' in l)
    m = re.match(r'\w+ (\S+ \S+) UTC', d.get('ActiveEnterTimestamp', ''))
    if m and os.path.dirname(d.get('Where', '')) == home:
        mounted_at[os.path.basename(d['Where'])] = m.group(1)
swap_re = re.compile(r'^(\S+ \S+) swap \S+: (\S+) -> (\S+) \(uuid (\S+)\)')
side_re = re.compile(r'^(\S+ \S+) sidecar (\S+) -> (\S+) \((link|copy)\)$')
res, pend = collections.Counter(), []
with open(os.path.join(home, '.cc-sessions', 'swap.log'), encoding='utf8', errors='replace') as f:
    for line in f:
        line = line.rstrip('\n')
        m = side_re.match(line)
        if m:
            pend.append(m.groups()); continue
        m = swap_re.match(line)
        if not m:
            continue
        _, src, dst, uuid = m.groups()
        for (t, u, _, mode) in pend:
            if u != uuid:
                continue
            sm, dm = mounted_at.get('.' + src), mounted_at.get('.' + dst)
            if sm is None or dm is None:
                res[(mode, 'a root with no mount unit today (no verdict)')] += 1
            elif t >= sm or t >= dm:
                res[(mode, 'a mount involved')] += 1
            else:
                res[(mode, 'both roots plain directories')] += 1
        pend = []
print(f'account roots that are their own mount today: {len(mounted_at)}')
for (mode, why), n in sorted(res.items()):
    print(f'  ({mode}) {why}: {n}')
```

```bash
SCRATCH=<your scratchpad, absolute>
findmnt -rn -o TARGET,SOURCE | awk -v h="$HOME" 'index($1, h"/.claude")==1' | awk '{print $2}' | sed 's/\[.*//' | sort | uniq -c
python3 "$SCRATCH/write-model/linkmode.py"
```

Expected: one source device for every account root (planning: `20 /dev/…`), and from `linkmode.py` `(copy) a mount involved` and `(link) both roots plain directories` holding every DATED line — planning measured 262 and 163, with none crossing over. A `(link)` under `a mount involved` would mean link(2) crossed a mount, which contradicts the EXDEV finding: report it, it does not block Task 2 (the merge falls back to a copy either way).

- [ ] **Step 5: Keep the evidence.** Copy `verdict.txt`, the inspect lines, the live sample and both Step-4 outputs into your wave-done notes. Nothing to clean: every file this task made is in `$SCRATCH/write-model/`.

---

### Task 2: The carry merges — the walk, the slot, the budget

**Model routing:** `sonnet`, effort `high` — `ccd`'s swap path, and a python program embedded in bash.

**Files:**
- Modify: `ccd/ccd` — replace `_swap_carry_sidecars` whole (from `_swap_carry_sidecars() {` to its closing `}` directly above `_swap_beat() {`) with the block in Step 3; reword three lines of `_ws_project_valid`'s R-3 boundary paragraph, line for line (Step 3b)
- Modify: `server/test/ccd-swap.test.ts` — two edits (Step 4)
- Test: `server/test/ccd-swap-carry-merge.test.ts` (new)

**Interfaces:**
- Consumes: `_sidecar_matches "$srccfg" "$uuid"` (unchanged), `$REG`, `cmd_swap`'s one call `_swap_carry_sidecars "$srccfg" "$dstcfg" "$uuid"` (unchanged; the function still always answers rc 0).
- Produces:
  - `CARRY_MERGE_BUDGET=536870912` — bytes one sidecar's merge walk may read + copy per visit; what does not fit is deferred to the next visit.
  - `_carry_slot_take` → rc 0 with the CALLER's `local CARRY_SLOT_FD` set | rc 1 contended (`flock -n`'s conflict exit, 1, and only that) | rc 2 no mechanism (no `flock`, the lock file unopenable, or `flock` exiting anything else — 65 on EBADF, 71 on ENOLCK/ENOMEM). The lock file is `$REG/.carry.lock`, never unlinked. Stage 3's manifest scan (wave 6) "takes the same slot" (spec §5.3) — it calls this function, it does not re-spell the path.
  - `_swap_carry_merge_walk <src> <dst> <budget>` → stdout `diverged <kept> longer <longer>` rows then `merged <N> <R> <D> <K>` (K = actions deferred to the next visit, 0 when everything fit), rc 0 | `budget <the first action's cost>`, rc 3, nothing touched (the first action in resume order is priced over the budget on its own) | anything else: failed.
  - `swap.log` lines: `<date> sidecar <uuid> -> <dst> (merged +N ~R !D)`, `(merged +N ~R !D, deferred K)` (K > 0 only), `(kept: busy)`, `(kept: budget)`, `(kept: error)`; and `<date> sidecar <uuid> diverged <kept path> longer <longer path>`. Task 3's instrument and wave 6's manifest read them. The first-carry lines `(link)` / `(copy)` are unchanged; bare `(kept)` is never written again.

- [ ] **Step 0: Confirm the base, and that the surface is green before any edit**

```bash
git log -1 --format='%h %s'
git cat-file -e HEAD:docs/superpowers/plans/2026-09-24-session-continuity-wave1-carry-merge.md && echo "base carries this plan"
git fetch origin main && git merge --no-edit origin/main && git log -1 --format='%h'
cd server && ./node_modules/.bin/vitest run test/ccd-swap.test.ts test/ccd-swap-carry.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
./node_modules/.bin/vitest run test/ccd-account-auth.test.ts -t 'census, not a memory'
```

Expected: `base carries this plan` (checked by content, not by ancestry: `main` lands PRs as squash commits — its first-parent history is one `(#N)` commit per PR, measured 2026-09-24 with `git log --oneline --first-parent -8 origin/main` — so once the docs PR carrying this plan merges, `905360dc` is not an ancestor of a workspace cut from `main`); the merge either `Already up to date.` or clean (a conflict in `ccd/ccd` or `README.md`: stop and report, do not resolve it by hand in this task); `35 passed` for the two swap suites; `7 passed | 326 skipped` for the citation cases; `1 passed | 56 skipped` for the dot-prefixed census. A red here is the base's, not this wave's.

- [ ] **Step 1: Write the failing test** — create `server/test/ccd-swap-carry-merge.test.ts`:

```ts
/**
 * The sidecar carry MERGES on a return visit (session continuity, spec §5.1).
 *
 * `_swap_carry_sidecars` used to log `(kept)` and skip the whole tree whenever
 * the destination `<uuid>/` directory existed, so everything a session wrote
 * since it last left an account — subagent transcripts, workflow journals —
 * stayed on the source (774 of 1,310 carries). The existing-destination branch
 * now walks the source file by file under a box-wide non-blocking slot and a
 * byte budget spent as a priority fill (records, then journals, then the rest;
 * what does not fit is deferred to the next visit, never half-placed). Every
 * rule of the spec's table has a case here that reds when the rule is
 * removed; the first carry's own path is pinned unchanged.
 *
 * The REAL function runs against a fixture HOME (`makeCcdHarness`): two config
 * dirs, `.claude` (source) and `.claude-d` (destination), planted by hand.
 * ccd runs under `set -uo pipefail` with no `-e`, so nothing here throws on a
 * fallback — the swap.log line is the verdict every case reads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-carry-merge-'); });
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-3333-4bcc-b60b-0cfc0dc3d199';
const PDIR = '-w-quiet-mesa';
const T0 = 1_780_000_000;   // a fixed mtime, whole seconds

const side = (cfg: string, rel = ''): string => path.join(h.home, cfg, 'projects', PDIR, UUID, rel);
const SRC = (rel = ''): string => side('.claude', rel);
const DST = (rel = ''): string => side('.claude-d', rel);

/** A file under a sidecar, with a fixed mtime so the quick check is decided by the test. */
const put = (p: string, body: string, mtime = T0): string => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, mtime, mtime);
  return p;
};
const read = (p: string): string => fs.readFileSync(p, 'utf8');
const ino = (p: string): number => fs.statSync(p).ino;

const swapLog = (): string => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? read(p) : '';
};
/** Every `sidecar <uuid> -> <dst> (…)` verdict for our destination, oldest first. */
const verdicts = (): string[] =>
  swapLog().split('\n').filter((l) => l.includes(` sidecar ${UUID} -> ${DST()} (`)).map((l) => l.replace(/^.* \(/, '('));
/** The one verdict for our destination. */
const verdict = (): string => {
  const rows = verdicts();
  expect(rows, swapLog()).toHaveLength(1);
  return rows[0]!;
};
/** Every regular file under a directory, relative, sorted. */
const tree = (dir: string): string[] =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();

/** The real function, with an optional prefix (a held slot, a budget). */
const carry = (prefix = ''): string =>
  h.sh(`${prefix} _swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>&1; echo "[rc=$?]"`);

/** Hold the carry slot from the SAME snippet on a second open file
 *  description — flock(2) treats two open()s of one path as two holders, so
 *  the carry's own `flock -n` finds it contended. */
const HOLD_SLOT = 'exec 7>>"$REG/.carry.lock"; flock -n 7 || echo HOLD-FAILED;';

describe('a return visit merges instead of skipping', () => {
  it('carries the journals written since the session last left (+N)', () => {
    put(SRC('tool-results/old.txt'), 'OLD\n');
    put(DST('tool-results/old.txt'), 'OLD\n');
    put(SRC('subagents/workflows/wf_1/journal.jsonl'), '{"type":"launched"}\n');
    put(SRC('subagents/workflows/wf_1/agent-a1.jsonl'), '{"t":1}\n');
    expect(carry()).toContain('[rc=0]');
    expect(read(DST('subagents/workflows/wf_1/journal.jsonl'))).toBe('{"type":"launched"}\n');
    expect(read(DST('subagents/workflows/wf_1/agent-a1.jsonl'))).toBe('{"t":1}\n');
    expect(verdict()).toBe('(merged +2 ~0 !0)');
    expect(swapLog()).not.toContain('(kept');
  });

  it('an equal file is untouched and uncounted — even when its mtime differs and the bytes must be read', () => {
    put(SRC('tool-results/r.txt'), 'SAME\n', T0 + 50);
    const d = put(DST('tool-results/r.txt'), 'SAME\n', T0);
    const before = { ino: ino(d), mtime: fs.statSync(d).mtimeMs };
    carry();
    expect(ino(d)).toBe(before.ino);
    expect(fs.statSync(d).mtimeMs).toBe(before.mtime);
    expect(verdict()).toBe('(merged +0 ~0 !0)');
  });

  it('extends a journal the destination holds a strict prefix of (~R), by temp-and-rename', () => {
    put(SRC('subagents/workflows/wf_1/journal.jsonl'), 'A\nB\nC\n', T0 + 60);
    const d = put(DST('subagents/workflows/wf_1/journal.jsonl'), 'A\n');
    // A second NAME for the destination's inode: a write THROUGH the inode
    // would rewrite it too; temp-and-rename leaves it holding the old bytes.
    const sibling = path.join(h.home, 'sibling.jsonl');
    fs.linkSync(d, sibling);
    carry();
    expect(read(d)).toBe('A\nB\nC\n');
    expect(read(sibling), 'the replace wrote through the destination inode').toBe('A\n');
    expect(verdict()).toBe('(merged +0 ~1 !0)');
  });

  it('keeps a destination journal that is further along (source a prefix of it), uncounted', () => {
    put(SRC('subagents/agent-a1.jsonl'), 'A\n', T0 + 60);
    const d = put(DST('subagents/agent-a1.jsonl'), 'A\nB\nC\n');
    carry();
    expect(read(d)).toBe('A\nB\nC\n');
    expect(verdict()).toBe('(merged +0 ~0 !0)');
  });

  it('keeps a DIVERGED journal and counts it (!D), naming the longer copy — whichever side is longer', () => {
    // a1: the destination is SHORTER but not a prefix — the extend rule must
    // not fire. a2: the destination is LONGER but the source is not its prefix
    // — the "further along" rule must not swallow it uncounted.
    const s1 = put(SRC('subagents/agent-a1.jsonl'), 'A\nB\nC\n', T0 + 60);
    const d1 = put(DST('subagents/agent-a1.jsonl'), 'A\nX\n');
    put(SRC('subagents/agent-a2.jsonl'), 'A\nB\n', T0 + 60);
    const d2 = put(DST('subagents/agent-a2.jsonl'), 'A\nX\nY\nZ\n');
    carry();
    expect(read(d1)).toBe('A\nX\n');
    expect(read(d2)).toBe('A\nX\nY\nZ\n');
    expect(verdict()).toBe('(merged +0 ~0 !2)');
    expect(swapLog()).toContain(`sidecar ${UUID} diverged ${d1} longer ${s1}`);
    expect(swapLog()).toContain(`sidecar ${UUID} diverged ${d2} longer ${d2}`);
  });

  it('replaces a rewritten record when the source is newer (~R), and not when it is older', () => {
    put(SRC('workflows/wf_1.json'), '{"state":"completed","n":2}', T0 + 60);
    const d = put(DST('workflows/wf_1.json'), '{"state":"running"}');
    put(SRC('subagents/agent-a1.meta.json'), '{"v":1}', T0 - 60);
    const m = put(DST('subagents/agent-a1.meta.json'), '{"v":22}');
    carry();
    expect(read(d)).toBe('{"state":"completed","n":2}');
    expect(read(m), 'an OLDER source record replaced a newer destination').toBe('{"v":22}');
    expect(verdict()).toBe('(merged +0 ~1 !0)');
  });

  it('decides equality on size AND mtime, never on size alone — an equal-size file with other bytes is read and counted', () => {
    // The quick check (equal size and equal mtime_ns -> equal) is the ONLY
    // shortcut. Widened to size alone, this diverged tool result would pass
    // as equal and go uncounted.
    put(SRC('tool-results/r.txt'), 'AAAA\n', T0 + 60);
    const d = put(DST('tool-results/r.txt'), 'BBBB\n');
    carry();
    expect(read(d)).toBe('BBBB\n');
    expect(verdict()).toBe('(merged +0 ~0 !1)');
  });

  it('deletes nothing — a destination-only file survives, and the source is byte-for-byte untouched', () => {
    put(DST('tool-results/only-here.txt'), 'MINE\n');
    const s1 = put(SRC('subagents/agent-a1.jsonl'), 'A\nB\n', T0 + 60);
    put(DST('subagents/agent-a1.jsonl'), 'A\n');
    const s2 = put(SRC('tool-results/new.txt'), 'NEW\n');
    const before = [s1, s2].map((p) => [read(p), fs.statSync(p).mtimeMs, ino(p)]);
    carry();
    expect(read(DST('tool-results/only-here.txt'))).toBe('MINE\n');
    expect([s1, s2].map((p) => [read(p), fs.statSync(p).mtimeMs, ino(p)])).toEqual(before);
  });

  it('never nests the tree inside an existing destination', () => {
    put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST(), { recursive: true });
    carry();
    expect(fs.existsSync(DST(UUID)), 'a <uuid>/<uuid> nest').toBe(false);
    expect(read(DST('tool-results/r.txt'))).toBe('R\n');
  });

  it('repairs a destination a failed first carry left partial — the skeleton `cp -al` leaves', () => {
    put(SRC('subagents/agent-a1.jsonl'), 'A\n');
    put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST('subagents'), { recursive: true });
    fs.mkdirSync(DST('tool-results'), { recursive: true });
    carry();
    expect(read(DST('subagents/agent-a1.jsonl'))).toBe('A\n');
    expect(read(DST('tool-results/r.txt'))).toBe('R\n');
    expect(verdict()).toBe('(merged +2 ~0 !0)');
  });

  it('never carries, counts or trips on a temp a killed walk left (`.ccd-carry-*`), on either side', () => {
    put(SRC('tool-results/.ccd-carry-abc123'), 'HALF A COPY');
    put(DST('tool-results/.ccd-carry-def456'), 'HALF A COPY');
    put(SRC('tool-results/new.txt'), 'NEW\n');
    carry();
    expect(fs.existsSync(DST('tool-results/.ccd-carry-abc123'))).toBe(false);
    expect(verdict()).toBe('(merged +1 ~0 !0)');
  });

  it('links an absent file when it can (same filesystem)', () => {
    const s = put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST(), { recursive: true });
    carry();
    expect(ino(DST('tool-results/r.txt'))).toBe(ino(s));
  });
});

// The copy fallback needs a destination on ANOTHER filesystem, which the fleet
// box has on every carry (each account root is its own bind mount, so link(2)
// answers EXDEV) and a fixture can only get from a tmpfs. Measured, not named.
const SHM = '/dev/shm';
const crossDevice = ((): boolean => {
  try { return fs.statSync(SHM).isDirectory() && fs.statSync(SHM).dev !== fs.statSync(os.tmpdir()).dev; }
  catch { return false; }
})();

describe('the copy fallback', () => {
  it.skipIf(!crossDevice)('copies an absent file when linking fails (EXDEV), and still lands it whole', () => {
    const vol = fs.mkdtempSync(path.join(SHM, 'ccrc-carry-merge-'));
    try {
      fs.mkdirSync(path.join(h.home, '.claude-d'), { recursive: true });
      fs.mkdirSync(path.join(vol, 'projects', PDIR, UUID), { recursive: true });
      fs.symlinkSync(path.join(vol, 'projects'), path.join(h.home, '.claude-d', 'projects'));
      const s = put(SRC('tool-results/r.txt'), 'R\n');
      carry();
      expect(read(DST('tool-results/r.txt'))).toBe('R\n');
      expect(ino(DST('tool-results/r.txt'))).not.toBe(ino(s));
      expect(fs.statSync(DST('tool-results/r.txt')).mtimeMs, 'copy2 keeps the mtime the quick check reads')
        .toBe(fs.statSync(s).mtimeMs);
      expect(verdict()).toBe('(merged +1 ~0 !0)');
    } finally {
      fs.rmSync(vol, { recursive: true, force: true });
    }
  });
});

describe('the budget is a priority fill: the most valuable actions first, the rest deferred to the next visit', () => {
  it('a budget smaller than the whole walk places the records and journals and defers the tool results (deferred K)', () => {
    // Priced by the dry pass: the record replace 21, the journal extend
    // 2·2 + 6 = 10, the absent agent log 8 — 39 of a 50-byte budget — and
    // then a 100-byte tool result that would overrun it. The tool results are
    // the NEWEST files here: newest-first alone would have placed them first.
    const rec = put(SRC('workflows/wf_1.json'), '{"state":"completed"}', T0 + 60);
    put(DST('workflows/wf_1.json'), '{"state":"running"}');
    put(SRC('subagents/workflows/wf_1/journal.jsonl'), 'A\nB\nC\n', T0 + 60);
    put(DST('subagents/workflows/wf_1/journal.jsonl'), 'A\n');
    put(SRC('subagents/workflows/wf_1/agent-a1.jsonl'), '{"t":1}\n', T0 + 60);
    put(SRC('tool-results/big-1.txt'), 'x'.repeat(100), T0 + 100);
    put(SRC('tool-results/big-2.txt'), 'y'.repeat(100), T0 + 90);
    carry('CARRY_MERGE_BUDGET=50;');
    expect(verdict()).toBe('(merged +1 ~2 !0, deferred 2)');
    expect(read(DST('workflows/wf_1.json'))).toBe(read(rec));
    expect(read(DST('subagents/workflows/wf_1/journal.jsonl'))).toBe('A\nB\nC\n');
    expect(read(DST('subagents/workflows/wf_1/agent-a1.jsonl'))).toBe('{"t":1}\n');
    expect(fs.existsSync(DST('tool-results')), 'a deferred action creates nothing, not even its directory').toBe(false);
  });

  it('places in resume order: records, then journal.jsonl newest first, then the other logs newest first, then the rest newest first', () => {
    // Every action costs the same 10 bytes (all absent), so a budget of 10·k
    // places exactly the first k: the order is read off which files landed.
    // The mtimes run AGAINST the tiers — the records are the oldest files, a
    // tool result the newest — so newest-first across tiers reds here.
    const ORDER: Array<[string, number]> = [
      ['subagents/agent-a1.meta.json', T0 - 400],
      ['workflows/scripts/s.js', T0 - 450],
      ['workflows/wf_1.json', T0 - 500],
      ['subagents/workflows/wf_2/journal.jsonl', T0 - 100],
      ['subagents/workflows/wf_1/journal.jsonl', T0 - 200],
      ['subagents/agent-a2.jsonl', T0 - 10],
      ['subagents/agent-a1.jsonl', T0 - 50],
      ['tool-results/new.txt', T0 + 100],
      ['tool-results/old.txt', T0 - 300],
    ];
    for (const [rel, t] of ORDER) put(SRC(rel), '0123456789', t);
    for (let k = 1; k <= ORDER.length; k++) {
      fs.rmSync(DST(), { recursive: true, force: true });
      fs.mkdirSync(DST(), { recursive: true });
      fs.rmSync(path.join(h.home, '.cc-sessions', 'swap.log'), { force: true });
      carry(`CARRY_MERGE_BUDGET=${10 * k};`);
      const missing = ORDER.slice(0, k).map(([rel]) => rel).filter((rel) => !fs.existsSync(DST(rel)));
      expect(missing.join(' '), `budget ${10 * k}: not placed`).toBe('');
      expect(tree(DST()), `budget ${10 * k}: placed beyond the first ${k}`).toHaveLength(k);
      const left = ORDER.length - k;
      expect(verdict(), `budget ${10 * k}`).toBe(left ? `(merged +${k} ~0 !0, deferred ${left})` : `(merged +${k} ~0 !0)`);
    }
  });

  it('an action priced over the budget on its own gives (kept: budget) and touches nothing — the fill never skips past it', () => {
    put(SRC('workflows/wf_1.json'), 'x'.repeat(100));   // first in resume order, 100 bytes
    put(SRC('tool-results/small.txt'), 'y');             // would fit on its own
    fs.mkdirSync(DST(), { recursive: true });
    carry('CARRY_MERGE_BUDGET=50;');
    expect(verdict()).toBe('(kept: budget)');
    expect(fs.readdirSync(DST())).toEqual([]);
  });

  it('a second visit with the same budget places what the first deferred — repeat visits converge', () => {
    // Five absent files of 10 bytes, a 20-byte budget: 2, then 2, then 1 —
    // each visit finds the ones already placed equal and prices only the rest.
    const rels = ['tool-results/r1.txt', 'tool-results/r2.txt', 'tool-results/r3.txt', 'tool-results/r4.txt', 'tool-results/r5.txt'];
    rels.forEach((rel, i) => put(SRC(rel), '0123456789', T0 + i));
    fs.mkdirSync(DST(), { recursive: true });
    const VISITS = ['(merged +2 ~0 !0, deferred 3)', '(merged +2 ~0 !0, deferred 1)', '(merged +1 ~0 !0)', '(merged +0 ~0 !0)'];
    VISITS.forEach((want, v) => {
      carry('CARRY_MERGE_BUDGET=20;');
      expect(verdicts()[v], `visit ${v + 1}`).toBe(want);
    });
    expect(tree(DST())).toEqual(rels);
  });

  it('deletes nothing under a budget, and a deferred action leaves no partial file', () => {
    // The record (12) fits a 12-byte budget; the journal extend (2·2 + 6 = 10)
    // and the new tool result (4) are deferred. The deferred journal keeps its
    // old bytes and inode, the deferred file is absent, no temp is left.
    put(SRC('workflows/wf_1.json'), '{"s":"done"}', T0 + 60);
    const sj = put(SRC('subagents/workflows/wf_1/journal.jsonl'), 'A\nB\nC\n', T0 + 60);
    const dj = put(DST('subagents/workflows/wf_1/journal.jsonl'), 'A\n');
    const st = put(SRC('tool-results/new.txt'), 'NEW\n');
    put(DST('tool-results/only-here.txt'), 'MINE\n');
    const snap = (p: string): unknown[] => [read(p), fs.statSync(p).mtimeMs, ino(p)];
    const before = { src: [sj, st].map(snap), dj: snap(dj) };
    carry('CARRY_MERGE_BUDGET=12;');
    expect(snap(dj), 'the deferred journal was touched').toEqual(before.dj);
    expect(fs.existsSync(DST('tool-results/new.txt')), 'the deferred file was placed').toBe(false);
    expect(read(DST('tool-results/only-here.txt'))).toBe('MINE\n');
    expect([sj, st].map(snap)).toEqual(before.src);
    expect(tree(DST()).filter((f) => f.split('/').pop()!.startsWith('.ccd-carry-')), 'a temp left behind').toEqual([]);
    expect(fs.existsSync(DST('workflows/wf_1.json')), 'the record that fit was not placed').toBe(true);
    expect(tree(DST())).toEqual(['subagents/workflows/wf_1/journal.jsonl', 'tool-results/only-here.txt', 'workflows/wf_1.json']);
    expect(verdict()).toBe('(merged +1 ~0 !0, deferred 2)');
  });

  it('prices the copy a same-size record replace makes, not only its compare', () => {
    // 12 bytes each side: the compare reads 24, the newer record is then
    // copied — 12 more. Priced at 36 on its own, it cannot fit a budget of 24.
    put(SRC('workflows/wf_1.json'), '{"s":"done"}', T0 + 60);
    const d = put(DST('workflows/wf_1.json'), '{"s":"runn"}');
    carry('CARRY_MERGE_BUDGET=24;');
    expect(verdict()).toBe('(kept: budget)');
    expect(read(d)).toBe('{"s":"runn"}');
  });
});

describe('bounded: a busy slot falls back to (kept), and nothing waits', () => {
  it('a busy slot falls back to (kept: busy) and touches nothing', () => {
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    const out = carry(HOLD_SLOT);
    expect(out).not.toContain('HOLD-FAILED');
    expect(verdict()).toBe('(kept: busy)');
    expect(fs.existsSync(DST('tool-results/new.txt'))).toBe(false);
  });

  it('a first carry takes no slot — today\'s path, unchanged, even while the slot is held', () => {
    put(SRC('tool-results/r.txt'), 'R\n');
    carry(HOLD_SLOT);
    expect(verdict()).toMatch(/^\((link|copy)\)$/);
    expect(read(DST('tool-results/r.txt'))).toBe('R\n');
  });

  it('releases the slot on the way out, and never unlinks the lock file', () => {
    put(SRC('tool-results/r.txt'), 'R\n');
    fs.mkdirSync(DST(), { recursive: true });
    const out = h.sh(`_swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>/dev/null
      exec 7>>"$REG/.carry.lock"; flock -n 7 && echo SLOT-FREE || echo SLOT-HELD`);
    expect(out).toContain('SLOT-FREE');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.carry.lock'))).toBe(true);
  });

  it('a destination that is a symlink is not walked into: (kept: error)', () => {
    put(SRC('tool-results/r.txt'), 'R\n');
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.dirname(DST()), { recursive: true });
    fs.symlinkSync(elsewhere, DST());
    carry();
    expect(verdict()).toBe('(kept: error)');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('a slot whose lock file cannot be opened is (kept: error), never (kept: busy)', () => {
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.carry.lock'), { recursive: true });
    carry();
    expect(verdict()).toBe('(kept: error)');
    expect(fs.existsSync(DST('tool-results/new.txt'))).toBe(false);
  });

  it('a lock flock refuses for any reason but contention is (kept: error), never (kept: busy)', () => {
    // util-linux flock exits 1 only on a conflict; ENOLCK, EBADF and their
    // kin exit a sysexits code (71, 65). Shadowed by a function in the
    // snippet's own shell, so no binary on the box is touched.
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    carry('flock() { echo "flock: No locks available" >&2; return 71; };');
    expect(verdict()).toBe('(kept: error)');
    expect(fs.existsSync(DST('tool-results/new.txt'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry-merge.test.ts`

Expected: FAIL — `Tests 22 failed | 3 passed (25)` (measured on today's ccd, byte-identical to `905360dc`). The three that pass are the controls, true of today's ccd and required to stay true: "deletes nothing — a destination-only file survives …", "a first carry takes no slot …" and "releases the slot on the way out …". The twenty-two fail on today's `(kept)` verdict (`expected '(kept)' to be '(merged +1 ~0 !0)'`, `expected '(kept)' to be '(kept: busy)'`, `expected '(kept)' to be '(kept: error)'` for the symlinked destination and the two unlockable-slot cases, `expected '(kept)' to be '(kept: budget)'` for the over-budget action and the priced record copy, `expected '(kept)' to be '(merged +1 ~2 !0, deferred 2)'` for the partial fill, `budget 10: not placed: expected 'subagents/agent-a1.meta.json' to be ''` for the resume order, `visit 1: expected '(kept)' to be '(merged +2 ~0 !0, deferred 3)'` for convergence, `the record that fit was not placed: expected false to be true` for "deletes nothing under a budget …", and their kin) or on files that were never carried (`ENOENT: no such file or directory, open '…/subagents/workflows/wf_1/journal.jsonl'`). On a box without `/dev/shm` on a separate filesystem (macOS) the copy-fallback case is skipped, not failed.

- [ ] **Step 3: Replace `_swap_carry_sidecars` with the carry-merge block**

Write the block below to `$SCRATCH/carry-merge-block.sh`, exactly — it starts at the section header and ends at the new function's closing `}`:

```bash
# ── THE CARRY MERGES (session continuity, spec §5.1) ─────────────────────────
# A return visit — a session carried back onto an account it once left — finds
# its sidecar directory already at the destination. Until this build that was
# `(kept)`: the whole tree skipped, so every subagent transcript, workflow
# journal and tool result written since the session last left stayed behind on
# the source (774 of 1,310 carries, spec §1.2; and eight "journal not on disk"
# resume refusals, every one after only `(kept)` carries). The existing-
# destination branch now WALKS the source tree file by file and decides on
# content and size — `_swap_carry_merge_walk`, below — and nothing is deleted.
#
# BOUNDED, BECAUSE THE WALK READS WHERE `(kept)` READ NOTHING. Two bounds,
# neither of which waits — the unit is already stopped, so a carry that queued
# would be a session held down:
#   - a BOX-WIDE NON-BLOCKING SLOT, `$REG/.carry.lock`, taken inside the carry
#     itself, so every path that carries is covered — the tick's rescue and
#     auto-home, a manual or PWA swap, `swap-self` — not only `_dispatch_swap`'s
#     (the box-wide lock park-and-wake R4 designed for `_dispatch_swap` had not
#     shipped when this was written, measured, so this slot is the carry's
#     own). A supervisor revival carries nothing (it never changes account),
#     so it never reaches here. Contended: `(kept: busy)`.
#   - a BYTE BUDGET, CARRY_MERGE_BUDGET, spent as a PRIORITY FILL. A dry pass
#     over `lstat` alone prices every action BEFORE the first byte moves (the
#     bytes it would read to compare, plus the bytes it would copy), orders
#     them by what a resume needs — the rewritten records, then the runs'
#     journals, then every other log, then the rest, newest first within each
#     — and places them whole, in that order, until the next one would overrun
#     the budget. That one and every one after it is DEFERRED: counted, never
#     started, priced again on the next visit, which finds the placed ones
#     equal — so a backlog bigger than one budget drains over repeat visits.
#     (An all-or-nothing budget moved nothing on an over-budget walk, so the
#     next visit priced the same backlog plus the new bytes and the pair
#     stayed stranded for good.) `(merged +N ~R !D, deferred K)`; and
#     `(kept: budget)` only when the FIRST action is priced over the budget on
#     its own — nothing touched, the destination exactly as it was.
# A walk that could not run at all — no `flock`, no python3, a destination that
# is not a real directory, the walker's own failure — is `(kept: error)`, with
# the cause on stderr: a third word, because "someone else is carrying" and
# "this box cannot carry" want different remedies (never one overloaded word).
#
# The slot is NEVER unlinked (`.rotate.lock`'s rule: unlinking a held lock file
# is how two processes come to hold "the lock" on two inodes), and it is held
# only for the existing-destination branch — a FIRST carry to an account is
# today's `cp -al`/`cp -a` path, unchanged, and takes no slot.
CARRY_MERGE_BUDGET=536870912    # bytes one sidecar's merge walk may read + copy per visit (512 MiB); what does not fit is deferred

_carry_slot_take() {   # -> 0 and the CALLER's local CARRY_SLOT_FD set | 1 contended | 2 no mechanism (no flock, the lock file, any other flock failure)
  command -v flock >/dev/null 2>&1 || return 2
  local fd frc=0
  { exec {fd}>>"$REG/.carry.lock"; } 2>/dev/null || return 2
  # `flock -n` exits 1 ONLY on a conflict; a lock it cannot take at all (EBADF, ENOLCK) exits a sysexits code.
  flock -n "$fd" 2>/dev/null || frc=$?
  if (( frc != 0 )); then { exec {fd}>&-; } 2>/dev/null; (( frc == 1 )) && return 1; return 2; fi
  CARRY_SLOT_FD=$fd
}

_swap_carry_merge_walk() {   # src dst budget -> stdout rows; rc 0 merged (K deferred) | 3 the first action alone over budget (nothing touched) | other: failed
  # THE WALK, one python3 process rather than a fork per file: the measured
  # sidecar census at planning ran to 6,142 files in one directory (p99 3,497),
  # and a `stat`+`cmp` pair per file would hold the unit down for that long.
  # The program arrives on fd 3 (`_pr_py`'s idiom), so stdin stays free.
  #
  # THE TABLE (spec §5.1), per REGULAR file of the source; directories are
  # created as needed, and anything else in the source (a symlink, a fifo) is
  # never followed and never copied:
  #   absent at destination             -> hardlink, else copy       +N
  #   the same inode (a linked carry)   -> nothing: equal by identity
  #   equal size and equal mtime_ns     -> nothing (the quick check below)
  #   equal size, bytes compared equal  -> nothing
  #   *.jsonl, destination a strict prefix of a longer source -> replace  ~R
  #   *.jsonl, source a prefix of a longer destination -> keep (it is further along)
  #   *.jsonl, neither a prefix of the other -> keep destination         !D
  #   a rewritten record — workflows/<runId>.json, any agent-*.meta.json,
  #     workflows/scripts/* — source newer (mtime_ns)   -> replace         ~R
  #   the same record, source not newer                 -> keep
  #   any other file whose bytes differ (a tool result is written once)  !D
  #   a destination entry of another type where the source has a file    !D
  # Every !D prints `diverged <kept path> longer <longer copy's path>` for
  # stage 3's manifest to name; the summary row is `merged <N> <R> <D> <K>`.
  #
  # THE FILL. Every row above that costs bytes (an absent file, a compare, a
  # replace) is an ACTION, priced by the dry pass from `lstat` alone; a verdict
  # `lstat` decides by itself (equal, or another type in the way) costs nothing
  # and is taken on every visit. The actions are placed in RESUME ORDER —
  #   1. the rewritten records a resume reads: workflows/<runId>.json,
  #      workflows/scripts/*, agent-*.meta.json;
  #   2. the append-only logs: every journal.jsonl, then agent-*.jsonl and
  #      every other *.jsonl;
  #   3. everything else (tool results and the rest);
  # newest source mtime first within each — each one WHOLE, until the next
  # would overrun the budget. That one and every one after it is deferred:
  # counted (K), never started, so no deferred action leaves a partial file.
  # The next visit finds every placed file equal (a link is the same inode; a
  # copy keeps size and mtime_ns) and prices only what is left plus what is
  # new, so a backlog drains, most valuable bytes first. Measured on the box's
  # 673 real return-visit pairs at 512 MiB: 630 place everything at once, 43
  # defer some, and with no new bytes those 43 drain in 2 visits (27) or 3
  # (16); the largest single action priced 64 MiB. Not even the first action
  # fits (it is priced over the budget on its own): `budget <its cost>`, rc 3.
  #
  # IDENTITY DECIDES ONLY "EQUAL", NEVER "DIFFERENT": a same-inode pair is the
  # same bytes by definition, and every other pair is decided on size and
  # content. THE QUICK CHECK (equal size AND equal nanosecond mtime -> equal,
  # no bytes read) is rsync's default and this plan's measured choice: every
  # carry since the bind-mount move is a `cp -a`, which preserves mtime_ns, so
  # a file untouched since its last carry passes it; measured on the box's 673
  # real return-visit pairs, it cuts the walk's p90 cost from 764 MiB to 208 MiB
  # — about the bytes that are actually new. Its named cost: two different
  # files of identical size AND identical nanosecond mtime read as equal.
  #
  # REPLACE IS TEMP-AND-RENAME in the destination's own directory, never a
  # write through the destination's inode: a destination name may share its
  # inode with another name (a linked carry), which a write-through would
  # rewrite too. A temp left by a killed walk is named `.ccd-carry-*` and
  # skipped on every later walk, as source and as destination.
  python3 /dev/fd/3 "$@" 3<<'PY'
import os, stat, sys, shutil, tempfile

src, dst, budget = sys.argv[1], sys.argv[2], int(sys.argv[3])
sys.stdout.reconfigure(errors='backslashreplace')   # a non-UTF-8 file name must not fail the report after the merge ran
TMP = '.ccd-carry-'
CHUNK = 1 << 20

def is_log(rel):
    return rel.endswith('.jsonl')

def is_record(rel):
    parts = rel.split('/')
    if parts[0] == 'workflows' and len(parts) == 2 and parts[1].endswith('.json'):
        return True
    if len(parts) >= 3 and parts[0] == 'workflows' and parts[1] == 'scripts':
        return True
    return parts[-1].startswith('agent-') and parts[-1].endswith('.meta.json')

def tier(rel):
    """Resume value, highest first: 0 a rewritten record, 1 a run's journal, 2 any other log, 3 the rest."""
    if is_record(rel):
        return 0
    if rel.split('/')[-1] == 'journal.jsonl':
        return 1
    if is_log(rel):
        return 2
    return 3

def prefix_equal(a, b, n):
    """True iff the first n bytes of a and b are identical."""
    with open(a, 'rb') as fa, open(b, 'rb') as fb:
        left = n
        while left > 0:
            k = min(CHUNK, left)
            x, y = fa.read(k), fb.read(k)
            if x != y or len(x) < k:
                return False
            left -= k
    return True

def files(root):
    out = []
    for dp, dns, fns in os.walk(root, followlinks=False):
        dns[:] = sorted(d for d in dns if not d.startswith(TMP))
        for f in sorted(fns):
            if f.startswith(TMP):
                continue
            full = os.path.join(dp, f)
            if stat.S_ISREG(os.lstat(full).st_mode):
                out.append(os.path.relpath(full, root))
    return out

def dst_blocked(rel):
    """An ancestor of dst/rel that exists and is not a real directory."""
    parts = rel.split('/')[:-1]
    cur = dst
    for p in parts:
        cur = os.path.join(cur, p)
        try:
            st = os.lstat(cur)
        except FileNotFoundError:
            return False
        if not stat.S_ISDIR(st.st_mode):
            return True
    return False

# THE DRY PASS: lstat alone, nothing read, nothing moved. `todo` holds every
# action that costs bytes, priced; `diverged` every !D lstat decides alone.
todo, diverged = [], []

def queue(cost, kind, rel, s, d):
    todo.append(((tier(rel), -s.st_mtime_ns, rel), cost, kind, rel, s, d))

for rel in files(src):
    sp, dp = os.path.join(src, rel), os.path.join(dst, rel)
    s = os.lstat(sp)
    if dst_blocked(rel):
        diverged.append((dp, sp)); continue
    try:
        d = os.lstat(dp)
    except FileNotFoundError:
        queue(s.st_size, 'absent', rel, s, None); continue
    if not stat.S_ISREG(d.st_mode):
        diverged.append((dp, sp)); continue
    if (d.st_dev, d.st_ino) == (s.st_dev, s.st_ino):
        continue
    if d.st_size == s.st_size:
        if d.st_mtime_ns == s.st_mtime_ns:
            continue
        # both read to compare; a newer record is then copied as well, and priced here
        cost = 2 * s.st_size + (s.st_size if is_record(rel) and s.st_mtime_ns > d.st_mtime_ns else 0)
        queue(cost, 'same-size', rel, s, d); continue
    if is_log(rel):
        cost = 2 * min(s.st_size, d.st_size) + (s.st_size if d.st_size < s.st_size else 0)
        queue(cost, 'log', rel, s, d); continue
    if is_record(rel):
        if s.st_mtime_ns > d.st_mtime_ns:
            queue(s.st_size, 'replace', rel, s, d)
        continue
    diverged.append((dp, sp if s.st_size > d.st_size else dp))

# THE FILL: resume order (tier, then the newest source first), each action
# placed WHOLE until the next would overrun the budget; it and every one after
# it are deferred, never started. Not even the first fits: nothing is touched.
todo.sort(key=lambda a: a[0])
spent, go = 0, []
for a in todo:
    if spent + a[1] > budget:
        break
    spent += a[1]
    go.append(a)
if todo and not go:
    print(f'budget {todo[0][1]}')
    sys.exit(3)
deferred = len(todo) - len(go)

def mkparents(rel):
    parts = rel.split('/')[:-1]
    cur_s, cur_d = src, dst
    for p in parts:
        cur_s, cur_d = os.path.join(cur_s, p), os.path.join(cur_d, p)
        if not os.path.isdir(cur_d):
            os.mkdir(cur_d)
            shutil.copystat(cur_s, cur_d)

def replace(rel):
    target = os.path.join(dst, rel)
    fd, tmp = tempfile.mkstemp(prefix=TMP, dir=os.path.dirname(target))
    os.close(fd)
    try:
        shutil.copy2(os.path.join(src, rel), tmp)
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

added = replaced = 0
for key, cost, kind, rel, s, d in go:
    sp, dp = os.path.join(src, rel), os.path.join(dst, rel)
    if kind == 'absent':
        mkparents(rel)
        try:
            os.link(sp, dp)
        except OSError:
            fd, tmp = tempfile.mkstemp(prefix=TMP, dir=os.path.dirname(dp))
            os.close(fd)
            try:
                shutil.copy2(sp, tmp)
                os.replace(tmp, dp)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        added += 1
    elif kind == 'replace':
        replace(rel); replaced += 1
    elif kind == 'same-size':
        if prefix_equal(sp, dp, s.st_size):
            continue
        if is_record(rel) and s.st_mtime_ns > d.st_mtime_ns:
            replace(rel); replaced += 1
        elif is_record(rel):
            continue
        else:
            diverged.append((dp, sp))
    elif kind == 'log':
        if d.st_size < s.st_size:
            if prefix_equal(sp, dp, d.st_size):
                replace(rel); replaced += 1
            else:
                diverged.append((dp, sp))
        elif not prefix_equal(sp, dp, s.st_size):
            diverged.append((dp, dp))

for kept, longer in diverged:
    print(f'diverged {kept} longer {longer}')
print(f'merged {added} {replaced} {len(diverged)} {deferred}')
PY
}

_swap_carry_sidecars() {   # srccfg dstcfg uuid — carry every sidecar: a first carry as a hardlink tree, a return visit as a merge. Always rc 0.
  # <projects dir>/<uuid>/ holds subagents, tool-results and workflows, and was
  # copied by NOTHING before this build: 188MB of the incident session's state,
  # left behind on the account it was swapped off. Globbed in its own right
  # because sidecars exist in project dirs with no .jsonl for the same uuid, and
  # each lands at the mirror of its OWN source dir.
  #
  # A FIRST CARRY (no destination yet) is `cp -al` — a hardlink tree — with
  # `cp -a` as the fallback the moment linking fails. NOT WRITE-ONCE, measured
  # (session continuity, Task 1): an `agent-*.jsonl` and a run's `journal.jsonl`
  # are APPENDED IN PLACE (same inode, growing; `workflows/<runId>.json` is
  # written whole at the run's end), so a linked tree would share those appends
  # between the two accounts. That is harmless — both names are this session's own
  # record, and a later merge reads a shared inode as equal — and on this fleet
  # it no longer happens at all: every account root is its own bind mount, and
  # link(2) across two mounts answers EXDEV even on one filesystem (measured),
  # so every carry since the move logs `(copy)`. The mode is logged so the
  # evidence exists if a future defect implicates a shared file.
  #
  # AN EXISTING DESTINATION IS MERGED, NOT LEFT ALONE (C8, reversing this
  # branch's old rule): `_swap_carry_merge_walk` above, under the carry slot and
  # CARRY_MERGE_BUDGET, logging `(merged +N ~R !D)`, `(merged +N ~R !D,
  # deferred K)` when K actions did not fit this visit's budget, or
  # `(kept: busy|budget|error)`. A destination a failed first carry left
  # partial is repaired by the same walk — it simply finds the missing files
  # absent — so `(kept)` is no longer permanent.
  #
  # THE FIRST-CARRY PATH IS UNCHANGED, and so is its anti-nesting guard:
  # `_sidecar_matches` strips the source's trailing slash, and `$dst` (the
  # `<uuid>` directory itself) must not exist before `cp -al` runs — measured:
  # `cp -al src/<uuid> dst/<uuid>` (and `cp -a`) onto an ALREADY-EXISTING
  # destination nests the tree inside itself. `mkdir -p` below only creates the
  # PARENT, never `$dst`. The merge never runs `cp` on a directory at all.
  #
  # The fallback does not start clean on its own: `cp -al` builds the
  # destination skeleton before it fails on the first unlinkable file (measured:
  # a cross-device `$dst` gets every subdirectory and no file), and `cp -a` onto
  # that survivor would nest. So the fallback clears any partial `$dst` first.
  # Success is read from `cp`'s own exit status, not `[[ -d "$dst" ]]`, so the
  # logged mode never overstates what is shared: `(link)` only when the whole
  # tree is hardlinks, `(copy)` whenever any part needed a real copy.
  #
  # C-collated sort: no destination is ever contested, so ordering changes only
  # the order of the swap.log lines a human reads, which is kept reproducible.
  local srccfg="$1" dstcfg="$2" uuid="$3" src pdir dst mode rc
  local slot="" slot_rc=0 wout wrc line n r dv k dfr CARRY_SLOT_FD=""
  local -a sidecars=() rows=()
  mapfile -t sidecars < <(_sidecar_matches "$srccfg" "$uuid" | LC_ALL=C sort)
  (( ${#sidecars[@]} )) || return 0
  for src in "${sidecars[@]}"; do
    # Parameter expansion, not `basename "$(dirname …)"`: every munged project
    # dir starts with `-`, and GNU basename would read it as options.
    pdir="${src%/*}"; pdir="${pdir##*/}"
    dst="$dstcfg/projects/$pdir/$uuid"
    if [[ -e "$dst" || -L "$dst" ]]; then
      # The slot is taken once, at the first existing destination, and held
      # for the rest of this carry; its answer is remembered, so a busy slot
      # is not retried per sidecar.
      if [[ -z "$slot" ]]; then
        _carry_slot_take; slot_rc=$?; slot=taken
      fi
      if (( slot_rc == 1 )); then
        echo "ccd: sidecar present at $dst — another carry holds the merge slot; left alone" >&2
        echo "$(date '+%F %T') sidecar $uuid -> $dst (kept: busy)" >> "$REG/swap.log"
        continue
      fi
      if (( slot_rc != 0 )) || [[ -L "$dst" || ! -d "$dst" ]] || ! command -v python3 >/dev/null 2>&1; then
        echo "ccd: warn: sidecar present at $dst but it cannot be merged (flock, the lock file, python3, or a destination that is not a real directory) — left alone" >&2
        echo "$(date '+%F %T') sidecar $uuid -> $dst (kept: error)" >> "$REG/swap.log"
        continue
      fi
      wout=$(_swap_carry_merge_walk "$src" "$dst" "$CARRY_MERGE_BUDGET"); wrc=$?
      mapfile -t rows <<< "$wout"
      if (( wrc == 3 )); then
        echo "ccd: sidecar at $dst not merged — its first action alone would exceed CARRY_MERGE_BUDGET (${rows[0]#budget } bytes); left alone" >&2
        echo "$(date '+%F %T') sidecar $uuid -> $dst (kept: budget)" >> "$REG/swap.log"
        continue
      fi
      line="${rows[${#rows[@]}-1]}"
      if (( wrc != 0 )) || [[ ! "$line" =~ ^merged\ ([0-9]+)\ ([0-9]+)\ ([0-9]+)\ ([0-9]+)$ ]]; then
        echo "ccd: warn: the merge walk into $dst failed (rc $wrc); every file it placed is whole, the rest stays on the source" >&2
        echo "$(date '+%F %T') sidecar $uuid -> $dst (kept: error)" >> "$REG/swap.log"
        continue
      fi
      n="${BASH_REMATCH[1]}"; r="${BASH_REMATCH[2]}"; dv="${BASH_REMATCH[3]}"; k="${BASH_REMATCH[4]}"
      for line in "${rows[@]}"; do
        [[ "$line" == diverged\ * ]] || continue
        echo "$(date '+%F %T') sidecar $uuid diverged ${line#diverged }" >> "$REG/swap.log"
      done
      # K > 0: the budget ran out part way. What was placed is whole; the K
      # actions left wait on the source for the next visit, which prices them first.
      if (( k > 0 )); then dfr=", deferred $k"; else dfr=""; fi
      echo "$(date '+%F %T') sidecar $uuid -> $dst (merged +$n ~$r !$dv$dfr)" >> "$REG/swap.log"
      continue
    fi
    mkdir -p "$dstcfg/projects/$pdir"
    mode=link
    cp -al "$src" "$dst" 2>/dev/null; rc=$?
    if (( rc != 0 )); then
      mode=copy
      # $dst may already exist here — a partial skeleton the failed `cp -al`
      # left behind — and `cp -a` onto an existing $dst nests instead of
      # landing at the real path. Clear it first every time, unconditionally.
      [[ -e "$dst" ]] && rm -rf "$dst"
      cp -a "$src" "$dst" 2>/dev/null; rc=$?
    fi
    if (( rc == 0 )); then
      echo "$(date '+%F %T') sidecar $uuid -> $dst ($mode)" >> "$REG/swap.log"
    else
      echo "ccd: warn: could not carry sidecar $src -> $dst" >&2
      # Do not leave a half-built $dst behind on total failure either: a later
      # swap would find it and merge into a tree this carry abandoned — which
      # the merge now repairs, but a clean absence re-runs the fast path.
      [[ -e "$dst" ]] && rm -rf "$dst" 2>/dev/null
    fi
  done
  # The slot is released here, on the loop's one way out, so the restart that
  # follows the carry never inherits it.
  if [[ -n "$CARRY_SLOT_FD" ]]; then { exec {CARRY_SLOT_FD}>&-; } 2>/dev/null; fi
  return 0
}
```

Then splice it in BY CONTENT — the old function is located by its header line and its closing brace, and the splice refuses unless the brace sits directly above `_swap_beat() {` as it does at `905360dc`:

```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -f "$SCRATCH/carry-merge-block.sh" ]] || { echo "STOP: no block at \$SCRATCH/carry-merge-block.sh"; exit 1; }
python3 - "$SCRATCH/carry-merge-block.sh" <<'PY'
import sys
block = open(sys.argv[1], encoding='utf8').read().rstrip('\n').split('\n')
lines = open('ccd/ccd', encoding='utf8').read().split('\n')
i = [k for k, l in enumerate(lines) if l.startswith('_swap_carry_sidecars() {')]
assert len(i) == 1, f'_swap_carry_sidecars() is defined {len(i)} times'
i = i[0]
end = next(j for j in range(i + 1, len(lines)) if lines[j] == '}')
assert lines[end + 1] == '' and lines[end + 2].startswith('_swap_beat() {'), 'the function no longer ends directly above _swap_beat'
lines[i:end + 1] = block
open('ccd/ccd', 'w', encoding='utf8').write('\n'.join(lines))
print(f'replaced ccd/ccd:{i + 1}-{end + 1} with {len(block)} lines')
PY
bash -n ccd/ccd && echo syntax-ok
```

Expected: `replaced ccd/ccd:21615-21706 with 421 lines` and `syntax-ok`.

- [ ] **Step 3b: Name the carry slot in the R-3 boundary paragraph — line-neutral**

The carry slot is a TWELFTH dot-prefixed `$REG` artifact, and `ccd-account-auth.test.ts`'s census ("the dot-prefixed registry inventory is a census, not a memory") derives the list from the shipped bash and requires `_ws_project_valid`'s R-3 paragraph to name every member and carry the derived cardinal. `.carry.lock` belongs with the NOT-reachable set: ids are `<project>-<slug>` and always carry a dash, so no id is the dash-free `.carry` and no purge glob `"$REG/$id".*` can match it. The paragraph sits at ≈6116–6123 — ABOVE every citation anchor — so each replacement is one line for one line, and the script refuses unless `wc -l` is unchanged. Write it to `$SCRATCH/r3.py` and run it from the repo root:

```python
"""Line-neutral rewording of _ws_project_valid's R-3 boundary paragraph: the carry slot is a
twelfth dot-prefixed $REG artifact. Each replacement is one line for one line, located by content."""
p = 'ccd/ccd'
t = open(p, encoding='utf8').read()
n0 = t.count('\n')
R = [
    ('# NOT reachable this way, and this set IS the boundary — ELEVEN dot-prefixed\n',
     '# NOT reachable this way, and this set IS the boundary — TWELVE dot-prefixed\n'),
    ('# artifacts live under `$REG`; the five above are reachable, these six are\n',
     '# artifacts live under `$REG`; the five above are reachable, these seven are\n'),
    ('# a paragraph that disagrees with it. The six:\n',
     '# a paragraph that disagrees with it. The seven: `$REG/.carry.lock` (no id is the dash-free `.carry`);\n'),
]
for old, new in R:
    assert t.count(old) == 1, f'not exactly once: {old!r}'
    t = t.replace(old, new)
assert t.count('\n') == n0, 'the R-3 edit changed the line count'
open(p, 'w', encoding='utf8').write(t)
print(f'R-3 reworded, line count unchanged at {n0}')
```

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/r3.py"
```

Expected: `R-3 reworded, line count unchanged at 23690` (the count after Step 3's splice; a moved `main` gives another number — what is checked is that the script's own assertion held). If an `old` line is not found exactly once, another branch already reworded the paragraph: re-derive the cardinal from `ccd-account-auth`'s red message and reword by hand, still line for line.

- [ ] **Step 4: Reverse the `(kept)` pin in `server/test/ccd-swap.test.ts`, and correct one comment**

In the case `'carries the sidecar as a hardlink tree, and says so'`, replace these five comment lines:

```ts
    // 188MB per sidecar: the difference between a swap that takes a moment and
    // one that takes minutes and fills the disk. The contents are write-once
    // artifacts, so sharing inodes between the two accounts is safe — and the
    // log line is the evidence, if a future defect ever implicates a shared
    // checkpoint.
```

with:

```ts
    // 188MB per sidecar: the difference between a swap that takes a moment and
    // one that takes minutes and fills the disk. Not write-once (measured: the
    // journals are appended in place), but every name is this one session's
    // own record, so a shared inode is harmless — and the log line is the
    // evidence, if a future defect ever implicates a shared file.
```

Then replace the whole case `'leaves an existing destination sidecar alone — a tree is not replaced in one step'`:

```ts
  it('leaves an existing destination sidecar alone — a tree is not replaced in one step', () => {
    // Deliberately the OPPOSITE of §2.2's unlink-first rule for the
    // transcript, which is one file replaceable in one step.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', mdir, 'tool-results/r.json', 'SOURCE\n');
    sidecar('.claude-d', mdir, 'tool-results/r.json', 'ALREADY THERE\n');
    runSwap();
    expect(fs.readFileSync(dstAt(mdir, path.join(UUID, 'tool-results/r.json')), 'utf8'))
      .toBe('ALREADY THERE\n');
    expect(swapLog()).toContain('(kept)');
  });
```

with:

```ts
  it('merges into an existing destination sidecar — never replaced in one step, a differing file kept and counted', () => {
    // Still the OPPOSITE of §2.2's unlink-first rule for the transcript: a
    // tree is never replaced in one step. What changed (session continuity
    // §5.1, C8) is that it is no longer SKIPPED: the swap walks it file by
    // file, and a written-once tool result whose bytes differ is kept and
    // counted diverged. The rule table lives in `ccd-swap-carry-merge.test.ts`;
    // this case pins that the real verb reaches the merge.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', mdir, 'tool-results/r.json', 'SOURCE\n');
    sidecar('.claude-d', mdir, 'tool-results/r.json', 'ALREADY THERE\n');
    runSwap();
    expect(fs.readFileSync(dstAt(mdir, path.join(UUID, 'tool-results/r.json')), 'utf8'))
      .toBe('ALREADY THERE\n');
    expect(swapLog()).toContain('(merged +0 ~0 !1)');
    expect(swapLog()).not.toContain('(kept');
  });
```

Measured against today's ccd, the new case reds: `expected '… carry b7001948-22…' to contain '(merged +0 ~0 !1)'`; against the new ccd the old case reds: `expected '… carry b7001948-22…' to contain '(kept)'`. That pair is the reversal C8 names, pinned in both directions.

- [ ] **Step 5: Re-stamp, then pay the corpus tax (S6-R11) — forecast: nothing moves**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git diff --numstat -- ccd/ccd server/test/ccd-swap.test.ts
python3 "$SCRATCH/repoint-readme.py" && git diff --quiet -- README.md && echo readme-unchanged
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
git fetch origin main && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected (measured on the prototype): `389	60	ccd/ccd` (the splice, the stamp line, and the three R-3 lines, each counted once as removed and once as added) and `13	8	server/test/ccd-swap.test.ts`; the re-pointer prints `cmd_ensure mint   -> ccd/ccd:21202` and `genrc == 1 arm    -> ccd/ccd:19989-19991`, then `readme-unchanged`; the re-measurer prints `stated 147  base 147  tree 147`, `stated 195  base 195  tree 195`, `other byFile keys moved: none`, and `stated 53  base 53  tree 53` / `stated 35  base 35  tree 35` with EMPTY `ENTERED`/`LEFT` everywhere; `corpus-frozen`. **Nothing in `session-hook.test.ts` or `README.md` changes in this task.** Any movement means a line was added or removed above `:21202` (the R-3 rewording of Step 3b is line-neutral by its own assertion) — find out why before going on.

- [ ] **Step 6: Run the tests to verify they pass**

`topology-clean.test.ts` reads its corpus from `git ls-files` (`topology-clean.test.ts:76`), so an untracked file is not scanned and its green would be vacuous — mark the new test intent-to-add first:

```bash
git add -N server/test/ccd-swap-carry-merge.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry-merge.test.ts test/ccd-swap.test.ts \
  test/ccd-swap-carry.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts \
  test/ccd-swap-pin.test.ts test/ccd-account-ok.test.ts
./node_modules/.bin/vitest run test/macos-platform.test.ts test/platform-hazards.test.ts \
  test/single-definition.test.ts test/topology-clean.test.ts
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'ALL THREE poisons'
./node_modules/.bin/vitest run test/ccd-account-auth.test.ts -t 'census, not a memory'
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: all PASS — `ccd-swap-carry-merge` 25/25 (the copy-fallback case RUNS on the fleet box, where `/dev/shm` is a tmpfs and the fixture HOME is not); `ccd-swap` 16, `ccd-swap-carry` 19, `ownership` 14, `ccd-reg-get-census` 3, `ccd-swap-pin` 13, `ccd-account-ok` 25; the four scans `330 passed | 14 skipped` (`topology-clean` 55, now scanning the new test; re-measured 2026-09-24 at `08701c22`, each file alone with `--maxWorkers=1`: `single-definition` 214, `macos-platform` 58 + 10 skipped, `platform-hazards` 3 + 4 skipped, `topology-clean` 55 — the 276 first measured at `905360dc` counted `single-definition` at 160, which main's update-management W2, #176, raised to 214); the containment scan `1 passed | 78 skipped`; the dot-prefixed census `1 passed | 56 skipped`; the citation cases `7 passed | 326 skipped`. (`ownership` proves the re-stamp landed; `ccd-reg-get-census` proves no `_reg_get` was added; `ccd-account-auth`'s census proves the R-3 paragraph names the slot; `ccd-swap-pin` and `ccd-account-ok` stub the function by its unchanged name.)

- [ ] **Step 7: Mutation check, then commit**

Thirty rows — 1–17, 23–26 and 31–39; 18–22, 27–29 and 40–42 are Task 3's (its row 30 is retired), numbered when first planned and kept stable — each applied to the working file after saving a copy of it (`cp ccd/ccd "$SCRATCH/ccd.saved"`), run, then restored from that saved copy (`cp "$SCRATCH/ccd.saved" ccd/ccd`, never `git checkout --`) and re-stamped before the next. Every red below was measured on the prototype (code byte-identical to `905360dc`), one row at a time, running `cd server && ./node_modules/.bin/vitest run --maxWorkers=1 test/ccd-swap-carry-merge.test.ts` unless the row names another command. `        except OSError:` occurs five times in `ccd/ccd`: locate row 13's by its `absent`-arm context (the line directly under `            os.link(sp, dp)`), never by the bare text. The five fill cases are named by letter: (a) "a budget smaller than the whole walk places the records and journals …", (b) "places in resume order …", (c) "an action priced over the budget on its own gives (kept: budget) …", (d) "a second visit with the same budget places what the first deferred …", (e) "deletes nothing under a budget, and a deferred action leaves no partial file". Row 8 was re-cut for the fill (it was "`if cost > budget:` → `if False:`"); the all-or-nothing case it used to red is gone, and row 31 now pins the opposite.

| # | Exact edit in `ccd/ccd` (in `_swap_carry_merge_walk`'s python unless named) | Expected red |
|---|---|---|
| 1 | the quick check widened to size alone: `        if d.st_mtime_ns == s.st_mtime_ns:` → `        if True:` | 2 failed: "decides equality on size AND mtime, never on size alone …" — `expected '(merged +0 ~0 !0)' to be '(merged +0 ~0 !1)'`; and "prices the copy a same-size record replace makes …" — `expected '(merged +0 ~0 !0)' to be '(kept: budget)'` (the widened check reads the differing record as equal, so it is neither priced nor replaced) |
| 2 | the extend rule without its prefix check: `            if prefix_equal(sp, dp, d.st_size):` → `            if True:` | "keeps a DIVERGED journal …" only — `expected 'A\nB\nC\n' to be 'A\nX\n'` |
| 3 | a longer destination never counted: `        elif not prefix_equal(sp, dp, s.st_size):` → `        elif False:` | "keeps a DIVERGED journal …" only — `expected '(merged +0 ~0 !1)' to be '(merged +0 ~0 !2)'` |
| 4 | a record replaced whatever its age: in the dry pass, `        if s.st_mtime_ns > d.st_mtime_ns:` (the `queue(s.st_size, 'replace', rel, s, d)` arm) → `        if True:` | "replaces a rewritten record when the source is newer …" only — `an OLDER source record replaced a newer destination: expected '{"v":1}' to be '{"v":22}'` |
| 5 | replace writes THROUGH the inode: in `replace()`, the two lines `shutil.copy2(os.path.join(src, rel), tmp)` / `os.replace(tmp, target)` → `shutil.copyfile(os.path.join(src, rel), target)` | "extends a journal … by temp-and-rename" only — `the replace wrote through the destination inode: expected 'A\nB\nC\n' to be 'A\n'` |
| 6 | today's clear-then-copy applied to an EXISTING destination (bash branch): `wout=$(_swap_carry_merge_walk "$src" "$dst" "$CARRY_MERGE_BUDGET"); wrc=$?` → `rm -rf "$dst"; cp -a "$src" "$dst"; wout="merged 0 0 0 0"; wrc=0` | 18 failed, among them "deletes nothing — a destination-only file survives …" — `ENOENT: no such file or directory, open '…/tool-results/only-here.txt'`; and (e) — `the deferred journal was touched: expected [ 'A\nB\nC\n', 1780000060000, … ] to deeply equal [ 'A\n', 1780000000000, … ]` |
| 7 | a directory copy onto an existing destination (the nesting shape): the same line → `cp -a "$src" "$dst"; wout="merged 0 0 0 0"; wrc=0` | 16 failed, among them "never nests the tree inside an existing destination" — `a <uuid>/<uuid> nest: expected true to be false` |
| 8 | no budget: in the fill, `    if spent + a[1] > budget:` → `    if False:` | 6 failed, every budget case: (a) `expected '(merged +3 ~2 !0)' to be '(merged +1 ~2 !0, deferred 2)'`; (b) `budget 10: placed beyond the first 1: expected [ 'subagents/agent-a1.jsonl', …(8) ] to have a length of 1 but got 9`; (c) `expected '(merged +2 ~0 !0)' to be '(kept: budget)'`; (d) `visit 1: expected '(merged +5 ~0 !0)' to be '(merged +2 ~0 !0, deferred 3)'`; (e) `the deferred journal was touched: …`; "prices the copy …" `expected '(merged +0 ~1 !0)' to be '(kept: budget)'` |
| 9 | the slot ignores contention (`_carry_slot_take`): `  flock -n "$fd" 2>/dev/null \|\| frc=$?` → `  : \|\| frc=$?` | 2 failed: "a busy slot falls back to (kept: busy) …" — `expected '(merged +1 ~0 !0)' to be '(kept: busy)'`; and "a lock flock refuses for any reason but contention …" — `expected '(merged +1 ~0 !0)' to be '(kept: error)'` (its shadowed `flock` is never called) |
| 10 | the slot is never released: delete the line `  if [[ -n "$CARRY_SLOT_FD" ]]; then { exec {CARRY_SLOT_FD}>&-; } 2>/dev/null; fi` | "releases the slot on the way out …" only — `expected 'SLOT-HELD' to contain 'SLOT-FREE'` |
| 11 | the FIRST carry takes the slot too: directly under `    dst="$dstcfg/projects/$pdir/$uuid"`, add `    if [[ -z "$slot" ]]; then _carry_slot_take; slot_rc=$?; slot=taken; fi` and `    if (( slot_rc == 1 )); then echo "$(date '+%F %T') sidecar $uuid -> $dst (kept: busy)" >> "$REG/swap.log"; continue; fi` | "a first carry takes no slot …" only — `expected '(kept: busy)' to match /^\((link\|copy)\)$/` |
| 12 | a symlinked destination walked into: `[[ -L "$dst" \|\| ! -d "$dst" ]]` → `[[ ! -d "$dst" ]]` | "a destination that is a symlink is not walked into …" only — `expected '(merged +1 ~0 !0)' to be '(kept: error)'` |
| 13 | no copy fallback when linking fails: in the `absent` arm, `        except OSError:` (directly under `            os.link(sp, dp)`) → `        except KeyError:` | "copies an absent file when linking fails (EXDEV) …" only — `ENOENT: no such file or directory, open '…/tool-results/r.txt'` (the walk died on EXDEV: `(kept: error)`) |
| 14 | the log format drifts (bash): `(merged +$n ~$r !$dv$dfr)` → `(merged $n/$r/$dv$dfr)` | 14 failed — `expected '(merged 2/0/0)' to be '(merged +2 ~0 !0)'`, and on a cut-short merge `expected '(merged 1/2/0, deferred 2)' to be '(merged +1 ~2 !0, deferred 2)'` (Task 3's parity case reds on the same edit, row 19) |
| 15 | a differing unclassified file swallowed: the `same-size` arm's last branch `            diverged.append((dp, sp))` (under `elif is_record(rel): continue` / `else:`) → `            continue` | "decides equality on size AND mtime …" only — `expected '(merged +0 ~0 !0)' to be '(merged +0 ~0 !1)'` |
| 16 | a killed walk's temp carried: in `files()`, delete `            if f.startswith(TMP):` and its `                continue` | "never carries, counts or trips on a temp a killed walk left …" only — `expected true to be false` |
| 17 | the whole merge removed (today's ccd, `git show "$(git merge-base origin/main HEAD)":ccd/ccd` — the base Step 0 merged in; `905360dc` is off `main`'s history once the docs PR squash-merges) — command `./node_modules/.bin/vitest run --maxWorkers=1 test/ccd-swap.test.ts` | "merges into an existing destination sidecar …" only (`1 failed \| 15 passed (16)`) — `expected '… carry b7001948-22…' to contain '(merged +0 ~0 !1)'`; and `ccd-swap-carry-merge` reds 22 of 25 (Step 2) |
| 23 | an unopenable lock file read as contention (`_carry_slot_take`): `  { exec {fd}>>"$REG/.carry.lock"; } 2>/dev/null \|\| return 2` → `… \|\| return 1` | "a slot whose lock file cannot be opened is (kept: error), never (kept: busy)" only — `expected '(kept: busy)' to be '(kept: error)'` |
| 24 | every `flock` failure read as contention (`_carry_slot_take`): `(( frc == 1 )) && return 1; return 2; fi` → `return 1; fi` | "a lock flock refuses for any reason but contention is (kept: error) …" only — `expected '(kept: busy)' to be '(kept: error)'` |
| 25 | the replace's copy left unpriced (dry pass): `        cost = 2 * s.st_size + (s.st_size if is_record(rel) and s.st_mtime_ns > d.st_mtime_ns else 0)` → `        cost = 2 * s.st_size` | "prices the copy a same-size record replace makes, not only its compare" only — `expected '(merged +0 ~1 !0)' to be '(kept: budget)'` |
| 26 | the R-3 paragraph left as it was (Step 3b reverted: the three lines back to `ELEVEN dot-prefixed`, `these six are`, `The six:`) — command `./node_modules/.bin/vitest run --maxWorkers=1 test/ccd-account-auth.test.ts -t 'census, not a memory'` | "names every dot-prefixed artifact the shipped bash actually writes" (`1 failed \| 56 skipped`) — `AssertionError: $REG/.carry is written by ccd's own bash and the R-3 boundary paragraph does not name it` (… `to contain '.carry'`) |
| 31 | ALL OR NOTHING restored — the defect this revision fixes: `if todo and not go:` → `if len(go) < len(todo):` | 4 failed: (a) `expected '(kept: budget)' to be '(merged +1 ~2 !0, deferred 2)'`; (b) `budget 10: not placed: expected 'subagents/agent-a1.meta.json' to be ''`; (d) `visit 1: expected '(kept: budget)' to be '(merged +2 ~0 !0, deferred 3)'`; (e) `the record that fit was not placed: expected false to be true` |
| 32 | the fill skips past an action that does not fit: in the fill, the `        break` under `    if spent + a[1] > budget:` → `        continue` | (c) only — `expected '(merged +1 ~0 !0, deferred 1)' to be '(kept: budget)'` (the small tool result went ahead of the record) |
| 33 | the budget checked after a placement, not before: the four lines `    if spent + a[1] > budget:` / `        break` / `    spent += a[1]` / `    go.append(a)` → `    spent += a[1]` / `    go.append(a)` / `    if spent > budget:` / `        break` | 6 failed, among them (e) — `the deferred journal was touched: expected [ 'A\nB\nC\n', 1780000060000, … ] to deeply equal [ 'A\n', 1780000000000, … ]`; and (a) — `expected '(merged +2 ~2 !0, deferred 1)' to be '(merged +1 ~2 !0, deferred 2)'` (one action placed past the budget) |
| 34 | newest first across the tiers: `todo.sort(key=lambda a: a[0])` → `todo.sort(key=lambda a: a[0][1:])` | 4 failed: (b) `budget 10: not placed: expected 'subagents/agent-a1.meta.json' to be ''`; (a) `expected '(kept: budget)' to be '(merged +1 ~2 !0, deferred 2)'` (the newest file, a 100-byte tool result, now heads the queue); (c) `expected '(merged +1 ~0 !0, deferred 1)' to be '(kept: budget)'`; (e) `the deferred journal was touched: …` |
| 35 | no order at all (the walk's own path order): delete the line `todo.sort(key=lambda a: a[0])` | 4 failed: (b) `budget 10: not placed: expected 'subagents/agent-a1.meta.json' to be ''`; (a) `expected '(merged +1 ~1 !0, deferred 3)' to be '(merged +1 ~2 !0, deferred 2)'`; (c) `expected '(merged +1 ~0 !0, deferred 1)' to be '(kept: budget)'`; (e) `the deferred journal was touched: …` |
| 36 | oldest first within a tier: in `queue()`, `(tier(rel), -s.st_mtime_ns, rel)` → `(tier(rel), s.st_mtime_ns, rel)` | (b) only — `budget 10: not placed: expected 'subagents/agent-a1.meta.json' to be ''` |
| 37 | a run's journal no longer ahead of the other logs: in `tier()`, the `        return 1` under `    if rel.split('/')[-1] == 'journal.jsonl':` → `        return 2` | (b) only — `budget 40: not placed: expected 'subagents/workflows/wf_2/journal.jsonl' to be ''` |
| 38 | the deferral not logged (bash): `      if (( k > 0 )); then dfr=", deferred $k"; else dfr=""; fi` → `      dfr=""` | 4 failed: (a) `expected '(merged +1 ~2 !0)' to be '(merged +1 ~2 !0, deferred 2)'`; (b) `budget 10: expected '(merged +1 ~0 !0)' to be '(merged +1 ~0 !0, deferred 8)'`; (d) `visit 1: expected '(merged +2 ~0 !0)' to be '(merged +2 ~0 !0, deferred 3)'`; (e) `expected '(merged +1 ~0 !0)' to be '(merged +1 ~0 !0, deferred 2)'` |
| 39 | the budget exclusive at its edge: `    if spent + a[1] > budget:` → `    if spent + a[1] >= budget:` | 3 failed: (b) `budget 10: not placed: expected 'subagents/agent-a1.meta.json' to be ''`; (d) `visit 1: expected '(merged +1 ~0 !0, deferred 4)' to be '(merged +2 ~0 !0, deferred 3)'`; (e) `the record that fit was not placed: expected false to be true` |

A green row is a finding: report it, never delete it.

```bash
git add ccd/ccd server/test/ccd-swap-carry-merge.test.ts server/test/ccd-swap.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the sidecar carry merges on a return visit instead of skipping it

A swap back onto an account the session once left found its sidecar
directory already there and logged (kept): every subagent transcript,
workflow journal and tool result written since stayed on the source
(774 of 1,310 carries in the baseline window; all 8 journal-missing resume
refusals followed only (kept) carries). The existing-destination branch now
walks the source file by file (spec §5.1's table, C8): absent -> link else
copy (+N); equal by inode, by size and mtime_ns, or by bytes -> nothing; a
journal the destination holds a strict prefix of -> replaced by temp and
rename (~R); a longer destination the source prefixes -> kept; neither a
prefix of the other -> kept and counted (!D, with a `diverged … longer …`
row); a rewritten record whose source is newer -> replaced (~R); any other
differing file -> kept and counted. Nothing is deleted; a partial
destination is repaired by the same walk.

Bounded: a box-wide non-blocking slot ($REG/.carry.lock, never unlinked,
taken inside the carry so every path is covered — park-and-wake R4's lock
has not shipped) and CARRY_MERGE_BUDGET (512 MiB per visit), spent as a
priority fill: a dry lstat pass prices every action before a byte moves,
then places them whole in resume order — the rewritten records, then the
runs' journals, then every other log, then the rest, newest first within
each — until the next would overrun the budget; that one and the rest are
deferred, never started, and logged (merged +N ~R !D, deferred K). The next
visit finds the placed files equal and prices only what is left, so a
backlog drains instead of stranding the pair for good, as an all-or-nothing
budget did: on the box's 673 return-visit pairs, 630 fit at once and the
other 43 drain in 2 or 3 visits. Contended (flock's conflict exit, 1) ->
(kept: busy); the first action alone over budget -> (kept: budget); cannot
run (no flock, an unopenable lock file, any other flock failure, no
python3, a destination that is not a real directory, the walker failing)
-> (kept: error). The first carry to an account is unchanged. The fill is
spec §5.1's budget as amended at the source on 2026-09-24.

ccd-swap.test.ts's (kept) case is the pin C8 reverses: rewritten to the
merged verdict in this commit. The carry slot is a twelfth dot-prefixed
$REG artifact: _ws_project_valid's R-3 boundary paragraph now names it,
reworded line for line (ccd-account-auth's census derives the list).
S6-R11: every added or removed line sits below the lowest line-anchored
citation into ccd/ccd and the R-3 rewording is line-neutral; the census did
not move (147 / 195 / 53 / 35, base and tree) and README is unchanged.
MSG
)"
```

---

### Task 3: `deploy/measure-continuity.py` — the carry counter and the resume refusals

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Create: `deploy/measure-continuity.py` — or, if session-continuity wave 2 merged first and the file exists, extend it with this wave's stage-1 block only (Step 3)
- Test: `server/test/measure-continuity.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's `swap.log` lines (`(merged +N ~R !D)`, `(merged +N ~R !D, deferred K)`, `(kept: busy|budget|error)`, `diverged … longer …`), the legacy `(kept)` / `(link)` / `(copy)` lines, `cmd_swap`'s `swap <id>: <from> -> <to> (uuid <uuid>)` line (unchanged; it follows the carry's sidecar lines, which is how the instrument learns each wrapper's root), and Claude Code's session transcripts (`<root>/projects/<pdir>/<uuid>.jsonl`): a `Workflow` `tool_use` carrying `resumeFromRunId`, and its `tool_result`.
- Produces — the programme's CROSS-WAVE CONTRACT for this file, which both continuity waves write exactly, whichever lands first:
  - One registry `STAGES = {N: stageN}`; `stageN(ctx)` returns a dict of named sections. Wave 1 owns `1: stage1` (sections `carry`, `resume`); wave 2 owns `4: stage4`.
  - `ctx` is a dict: `home`, `swap_log` (default `<home>/.cc-sessions/swap.log`), `since`, `until` and `deployed` as EPOCH seconds (swap.log stamps are LOCAL time, converted with `time.mktime`; transcript ISO `Z` stamps with `calendar.timegm`), and `all_copies`.
  - CLI: `python3 deploy/measure-continuity.py [--stage N]… [--home DIR] [--swap-log PATH] [--since T] [--until T] [--deployed T] [--all-copies] [--json]`, `T` = `YYYY-MM-DD[ HH:MM[:SS]]` local; default every registered stage; read-only; exit 0 on success. `--json` prints `{"stage<N>": {<section>: {…}}}`.
  - Stage 1's JSON keys: `stage1.carry.{carries, by_mode{link, copy, merged, kept, kept: busy, kept: budget, kept: error, other}, kept_total, kept_share, kept_other_than_busy_budget, merged_added, merged_replaced, merged_diverged, deferred_carries, deferred_actions, diverged_rows, excluding_stranded{the same keys but diverged_rows} | null}` (`excluding_stranded` is `null` without `--deployed`; `deferred_carries` counts the merges logged `, deferred K`, `deferred_actions` sums their K, and `by_mode["kept: budget"]` stays its own count), `stage1.resume.{resume_calls, by_outcome{ok, journal-missing, script-path, other-error, no-result}}`.

- [ ] **Step 1: Write the failing test** — create `server/test/measure-continuity.test.ts`:

```ts
/**
 * `deploy/measure-continuity.py` — the session-continuity programme's
 * read-only instrument (spec §9), stage 1's two sections: the carry counter
 * over `swap.log` and the journal-missing resume refusals in the transcripts.
 *
 * The carry section is pinned against what ccd ACTUALLY writes: the first case
 * runs the real `_swap_carry_sidecars` in a fixture HOME (`makeCcdHarness`)
 * and then the instrument over that same HOME, so a change to either side of
 * the `(merged +N ~R !D)` line format reds here rather than in a report a
 * week after rollout. Fixture HOMEs only: `--home` points the instrument at
 * one; nothing here reads the live `$HOME`. Every window in this file is
 * written in the same zone the instrument reads it in (local), so the cases
 * hold under any TZ.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-'); });
afterEach(() => { h.cleanup(); });

const REPO = path.resolve(import.meta.dirname, '..', '..');
const TOOL = path.join(REPO, 'deploy', 'measure-continuity.py');
const UUID = 'b7001948-4444-4bcc-b60b-0cfc0dc3d199';
const PDIR = '-w-quiet-mesa';
const T0 = 1_780_000_000;

/** Stage 1's sections, from the instrument pointed at the fixture HOME. */
const measure = (...args: string[]): Record<string, any> =>
  JSON.parse(execFileSync('python3', [TOOL, '--stage', '1', '--home', h.home, '--json', ...args],
    { encoding: 'utf8' })).stage1;

const put = (cfg: string, rel: string, body: string, mtime = T0): string => {
  const p = path.join(h.home, cfg, 'projects', PDIR, UUID, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, mtime, mtime);
  return p;
};
const writeLog = (rows: string[]): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), rows.join('\n') + '\n');
};

describe('the carry section', () => {
  it('counts what the real carry writes: a merge the budget cut short, a whole merge, their diverged rows, and a (kept: busy)', () => {
    // The diverged log is compared first (8 bytes) and fits a 10-byte budget;
    // the new tool result (4 more) does not: `(merged +0 ~0 !1, deferred 1)`.
    // The next carry, at the default budget, places it: `(merged +1 ~0 !1)`.
    put('.claude', 'subagents/agent-a1.jsonl', 'A\nB\n', T0 + 60);
    put('.claude-d', 'subagents/agent-a1.jsonl', 'A\nX\nY\n');
    put('.claude', 'tool-results/new.txt', 'NEW\n');
    const CARRY = `_swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>/dev/null`;
    h.sh(`CARRY_MERGE_BUDGET=10; ${CARRY}`);
    h.sh(CARRY);
    h.sh(`exec 7>>"$REG/.carry.lock"; flock -n 7; ${CARRY}`);
    const c = measure().carry;
    expect(c.carries).toBe(3);
    expect(c.by_mode.merged).toBe(2);
    expect(c.by_mode['kept: busy']).toBe(1);
    expect([c.merged_added, c.merged_replaced, c.merged_diverged]).toEqual([1, 0, 2]);
    expect(c.diverged_rows).toBe(2);
    expect([c.deferred_carries, c.deferred_actions]).toEqual([1, 1]);
    expect(c.kept_other_than_busy_budget).toBe(0);
  });

  it('keeps the legacy `(kept)` apart from the three new reasons, and honours the window', () => {
    // Rows in the exact shapes ccd has written: the pre-merge rule's bare
    // `(kept)`, a first carry's `(link)`/`(copy)`, and the merge's fallbacks.
    writeLog([
      `2026-09-10 10:00:00 sidecar ${UUID} -> /d/1 (kept)`,
      `2026-09-10 10:00:01 sidecar ${UUID} -> /d/2 (copy)`,
      `2026-09-24 10:00:00 sidecar ${UUID} -> /d/3 (kept: budget)`,
      `2026-09-24 10:00:01 sidecar ${UUID} -> /d/4 (kept: error)`,
      `2026-09-24 10:00:02 sidecar ${UUID} -> /d/5 (link)`,
      `2026-09-24 10:00:03 swap demo-x: a -> b (uuid ${UUID})`,
    ]);
    const all = measure().carry;
    expect(all.carries).toBe(5);
    expect(all.by_mode.kept).toBe(1);
    expect(all.kept_total).toBe(3);
    expect(all.kept_other_than_busy_budget, 'legacy kept + error, never budget').toBe(2);
    const late = measure('--since', '2026-09-24').carry;
    expect(late.carries).toBe(3);
    expect(late.by_mode.kept).toBe(0);
    const early = measure('--until', '2026-09-24 10:00:01').carry;
    expect(early.carries, '--until is exclusive, to the second').toBe(3);
  });

  it('reports every carry and, with --deployed, the carries whose pair was not stranded before the deploy', () => {
    const A = '/h/.claude', D = '/h/.claude-d', E = '/h/.claude-e';
    const U = UUID, W = 'c0ffee00-5555-4bcc-b60b-0cfc0dc3d199';
    const sc = (ts: string, u: string, root: string, mode: string): string =>
      `${ts} sidecar ${u} -> ${root}/projects/${PDIR}/${u} (${mode})`;
    const sw = (ts: string, u: string, from: string, to: string): string =>
      `${ts} swap demo-${u.slice(0, 4)}: ${from} -> ${to} (uuid ${u})`;
    writeLog([
      // Before the deploy: U, BORN on claude, is carried to claude-d.
      sc('2026-09-10 10:00:00', U, D, 'copy'), sw('2026-09-10 10:00:01', U, 'claude', 'claude-d'),
      // After: U goes home to the root it was born on — stranded, though no
      // sidecar line before the deploy names it (only the swap's `from` does) —
      // and its backlog drains in part: 40 actions deferred to the next visit.
      sc('2026-09-24 10:00:00', U, A, 'merged +3 ~1 !0, deferred 40'), sw('2026-09-24 10:00:01', U, 'claude-d', 'claude'),
      // And back to claude-d, which a sidecar line before the deploy names;
      // its first action alone is over budget.
      sc('2026-09-24 11:00:00', U, D, 'kept: budget'), sw('2026-09-24 11:00:01', U, 'claude', 'claude-d'),
      // W starts after the deploy: out to claude-e and home again — nothing stranded.
      sc('2026-09-24 12:00:00', W, E, 'copy'), sw('2026-09-24 12:00:01', W, 'claude', 'claude-e'),
      sc('2026-09-24 13:00:00', W, A, 'merged +2 ~0 !0, deferred 5'), sw('2026-09-24 13:00:01', W, 'claude-e', 'claude'),
    ]);
    const c = measure('--since', '2026-09-20', '--deployed', '2026-09-20').carry;
    expect(c.carries).toBe(4);
    expect(c.kept_share).toBe(0.25);
    expect(c.by_mode['kept: budget'], 'kept: budget is its own count').toBe(1);
    expect([c.deferred_carries, c.deferred_actions]).toEqual([2, 45]);
    expect(c.excluding_stranded.carries, 'U\'s two return visits are the stranded backlog').toBe(2);
    expect(c.excluding_stranded.kept_share).toBe(0);
    expect(c.excluding_stranded.by_mode['kept: budget']).toBe(0);
    expect([c.excluding_stranded.deferred_carries, c.excluding_stranded.deferred_actions]).toEqual([1, 5]);
    const plain = measure('--since', '2026-09-20').carry;
    expect(plain.excluding_stranded, 'no --deployed, no split').toBeNull();
    expect(plain.carries).toBe(4);
  });
});

describe('the resume section', () => {
  it('counts resume refusals by tool-use id, once across the account-root copies a swap leaves', () => {
    // Claude Code's own refusal text, as a session transcript records it: a
    // Workflow tool_use carrying resumeFromRunId, then its tool_result.
    const use = (id: string, run: string): string => JSON.stringify({ type: 'assistant', timestamp: '2026-09-20T10:00:00.000Z',
      message: { content: [{ type: 'tool_use', id, name: 'Workflow', input: { scriptPath: '/x/s.js', resumeFromRunId: run } }] } });
    const res = (id: string, text: string, isError: boolean): string => JSON.stringify({ type: 'user', timestamp: '2026-09-20T10:00:01.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
    const body = [
      use('toolu_A', 'wf_aaaaaaaa-111'),
      res('toolu_A', '<tool_use_error>The journal for workflow run wf_aaaaaaaa-111 is not on disk, and this session cannot fetch a remote copy, so there is nothing to resume.</tool_use_error>', true),
      use('toolu_B', 'wf_bbbbbbbb-222'),
      res('toolu_B', 'Workflow resumed', false),
    ].join('\n') + '\n';
    // The same session on two roots: the one it left holds a PREFIX copy.
    const t1 = path.join(h.home, '.claude', 'projects', PDIR, `${UUID}.jsonl`);
    const t2 = path.join(h.home, '.claude-d', 'projects', PDIR, `${UUID}.jsonl`);
    fs.mkdirSync(path.dirname(t1), { recursive: true });
    fs.mkdirSync(path.dirname(t2), { recursive: true });
    fs.writeFileSync(t1, body.split('\n').slice(0, 2).join('\n') + '\n');
    fs.writeFileSync(t2, body);
    for (const flags of [[], ['--all-copies']]) {
      const r = measure(...flags).resume;
      expect(r.resume_calls, flags.join(' ') || 'largest copy').toBe(2);
      expect(r.by_outcome).toEqual({ ok: 1, 'journal-missing': 1, 'script-path': 0, 'other-error': 0, 'no-result': 0 });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/measure-continuity.test.ts`

Expected, when the file does not exist yet: FAIL — `4 failed (4)`, each on `python3: can't open file '…/deploy/measure-continuity.py': [Errno 2] No such file or directory` (measured). **If wave 2 merged first** and the file exists with stage 4 only, the same four cases fail instead on the parser: `measure-continuity.py: error: argument --stage: invalid choice: 1 (choose from 4)`, exit 2 (measured against wave 2's plan's file as written at `af64d9d2`; a revised wave 2 may answer with a `KeyError` on `1` instead — either is this step's red, `ENOENT` is not).

- [ ] **Step 3: Write the instrument** — create `deploy/measure-continuity.py` (mode 0755) as below.

**If `deploy/measure-continuity.py` already exists because wave 2 merged first:** keep its header, its helpers (`TS`, `epoch`, `read_lines`) and its argparse/`main`; add ONLY this wave's `# ── stage 1 (wave 1)` block — everything from that comment down to `def stage1` and its body, inclusive, i.e. up to but not including `STAGES = …` — above its `# ── stage 4` block, add `1: stage1` to its `STAGES` (keeping `4: stage4`), and add any missing import (`calendar`, `glob`, `mmap`) and any missing flag among `--home`, `--swap-log`, `--since`, `--until`, `--deployed`, `--all-copies`, `--json`, `--stage` exactly as this file spells them. Two things this wave may need beyond that, each only if absent: (a) `ctx` built as the contract's dict (`home`, `swap_log` defaulting to `<home>/.cc-sessions/swap.log`, `since`/`until`/`deployed` epochs, `all_copies`) — if the existing `main` builds it as an attribute object instead, read it that way inside the stage-1 block rather than changing `main`; (b) a time parse that accepts `YYYY-MM-DD HH:MM` — if the existing `main` parses `--since`/`--until` as whole days only, replace that parse with this file's `when` (Step 5's baseline windows end mid-day and `--deployed` is a rollout minute; stage 4's rows read epochs either way). Then run wave 2's own `test/measure-continuity-stage4.test.ts` as well as this task's test: both must pass unchanged — one file, one `STAGES`, one time model.

```python
#!/usr/bin/env python3
"""The session-continuity programme's instrument (spec 2026-09-23 §9). READ-ONLY.

Run by hand on the fleet box, as the fleet user; it opens every file it reads
read-only, writes nothing anywhere, never runs `ccd`, never touches tmux or a
unit. It grows with the programme: each wave adds the §9 rows it owns as one
function registered in STAGES (`N: stageN`), in the same PR as the mechanism
those rows measure. `stageN(ctx)` returns a dict of named sections.

    python3 deploy/measure-continuity.py                          # every stage, table
    python3 deploy/measure-continuity.py --stage 1 --json         # one stage, JSON
    python3 deploy/measure-continuity.py --since 2026-09-24 --deployed '2026-09-24 10:00'

ctx carries `home` (`--home`, default `$HOME`; the test suite's fixture HOMEs),
`swap_log` (`--swap-log`, default `<home>/.cc-sessions/swap.log`), `since` and
`until` (`--since` inclusive, `--until` exclusive), `deployed` (`--deployed`)
and `all_copies` (`--all-copies`). The three times are EPOCH seconds. On the
command line they are `YYYY-MM-DD[ HH:MM[:SS]]` in LOCAL time, because
swap.log's stamps are `date '+%F %T'`, local time on the box that wrote them,
and are converted with `time.mktime`; run it on the fleet box (or with TZ set
to that box's zone). Transcript stamps are ISO UTC (`…Z`), converted with
`calendar.timegm`.
"""
import argparse
import calendar
import collections
import glob
import json
import mmap
import os
import re
import sys
import time

TS = r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)"


def epoch(stamp):
    """swap.log's local-time stamp -> epoch seconds, or None."""
    try:
        return int(time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        return None


def read_lines(path):
    with open(path, "rb") as fh:
        return [raw.decode("utf-8", "replace").rstrip("\n") for raw in fh]


# ── stage 1 (wave 1): the carry, and the journal-missing resume refusals ─────
# carry   every `sidecar <uuid> -> <dst> (<mode>)` line in swap.log, by mode —
#         link, copy, merged, and `kept` by reason: `kept` alone is the
#         pre-merge rule (an existing destination, skipped); `kept: busy`,
#         `kept: budget` and `kept: error` are the merge's three fallbacks —
#         plus the merged walks' summed +N ~R !D, the `diverged` rows, and
#         the budget's cut: `deferred_carries` counts the merges that ended
#         `, deferred K` (the budget ran out part way; what was placed is
#         whole) and `deferred_actions` sums their K — the backlog the next
#         visit prices first. `kept: budget` stays its own count: a walk
#         whose FIRST action alone was over budget and placed nothing.
#         §9's target: `kept` only as busy/budget, under 2% of carries,
#         reported over every carry AND (`--deployed`) over the carries whose
#         pair — the session's uuid and the destination's account root — was
#         NOT stranded before the deploy: a pair is stranded when that root
#         held the session before `--deployed`, i.e. a sidecar line before it
#         names that root, or a `swap` line before it names that root's
#         wrapper as either side (the root the session was BORN on is named by
#         no sidecar line, only as a swap's `from`). A wrapper's root is
#         learned from the log itself — a carry's sidecar lines precede its
#         `swap <id>: <from> -> <to> (uuid <uuid>)` line — so a wrapper that
#         never received a sidecar carry cannot be mapped, and a born-there
#         pair on it reads as not stranded: the named cost of reading swap.log
#         alone. The deferred counts are split the same way, so the stranded
#         backlog draining (deferred on a stranded pair) is told apart from a
#         steady state that still overruns the budget.
# resume  every Workflow tool call carrying `resumeFromRunId`, deduplicated by
#         tool-use id across the account-root copies a swapping session
#         accumulates, classified by its tool result: ok, journal-missing
#         ("… is not on disk …"), script-path ("scriptPath must be a script
#         path"), other-error, or no-result. §9's target: journal-missing 0.
def iso_epoch(stamp):
    """A transcript's ISO UTC stamp ('YYYY-MM-DDTHH:MM:SS…Z') -> epoch seconds, or None."""
    try:
        return calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError, OverflowError):
        return None


def in_window(t, ctx):
    """t: epoch seconds, or None (an unparseable stamp is never in a window)."""
    return t is not None and (ctx["since"] is None or t >= ctx["since"]) \
        and (ctx["until"] is None or t < ctx["until"])


CARRY = re.compile(TS + r" sidecar (\S+) -> (.+) \(([^()]*)\)$")
DIVERGED = re.compile(TS + r" sidecar (\S+) diverged (.+) longer (.+)$")
SWAP = re.compile(TS + r" swap \S+: (\S+) -> (\S+) \(uuid (\S+)\)$")
MERGED = re.compile(r"^merged \+(\d+) ~(\d+) !(\d+)(?:, deferred (\d+))?$")
KEPT_REASONS = ("busy", "budget", "error")


def carry_counts(modes_seen):
    modes = {"link": 0, "copy": 0, "merged": 0, "kept": 0,
             "kept: busy": 0, "kept: budget": 0, "kept: error": 0, "other": 0}
    added = replaced = diverged = deferred_carries = deferred_actions = 0
    for mode in modes_seen:
        mm = MERGED.match(mode)
        if mm:
            modes["merged"] += 1
            added += int(mm.group(1)); replaced += int(mm.group(2)); diverged += int(mm.group(3))
            k = int(mm.group(4) or 0)
            deferred_carries += 1 if k else 0
            deferred_actions += k
        elif mode in modes:
            modes[mode] += 1
        else:
            modes["other"] += 1
    total = sum(modes.values())
    kept_all = modes["kept"] + sum(modes["kept: " + r] for r in KEPT_REASONS)
    return {
        "carries": total,
        "by_mode": modes,
        "kept_total": kept_all,
        "kept_share": round(kept_all / total, 4) if total else None,
        "kept_other_than_busy_budget": modes["kept"] + modes["kept: error"],
        "merged_added": added, "merged_replaced": replaced, "merged_diverged": diverged,
        "deferred_carries": deferred_carries, "deferred_actions": deferred_actions,
    }


def carry_section(ctx):
    try:
        lines = read_lines(ctx["swap_log"])
    except FileNotFoundError:
        return {"swap_log": "absent"}
    deployed = ctx["deployed"]
    early = lambda t: deployed is not None and t is not None and t < deployed
    carries, diverged_rows = [], 0          # carries: (t, uuid, root, mode) inside the window
    pending = collections.defaultdict(list)  # uuid -> roots its sidecar lines named, awaiting its swap line
    root_of = {}                             # wrapper -> account root, learned from the log
    stranded, visits = set(), []             # (uuid, root) pairs; (uuid, from, to) swap lines before --deployed
    for line in lines:
        m = DIVERGED.match(line)
        if m:
            if in_window(epoch(m.group(1)), ctx):
                diverged_rows += 1
            continue
        m = CARRY.match(line)
        if m:
            t, uuid, mode = epoch(m.group(1)), m.group(2), m.group(4)
            root = m.group(3).rsplit("/projects/", 1)[0]
            pending[uuid].append(root)
            if early(t):
                stranded.add((uuid, root))
            if in_window(t, ctx):
                carries.append((t, uuid, root, mode))
            continue
        m = SWAP.match(line)
        if m:
            t, frm, to, uuid = epoch(m.group(1)), m.group(2), m.group(3), m.group(4)
            if pending.get(uuid):
                root_of[to] = pending.pop(uuid)[-1]
            if early(t):
                visits.append((uuid, frm, to))
    for uuid, frm, to in visits:
        for w in (frm, to):
            if w in root_of:
                stranded.add((uuid, root_of[w]))
    out = carry_counts(mode for _, _, _, mode in carries)
    out["diverged_rows"] = diverged_rows
    out["excluding_stranded"] = None if deployed is None else \
        carry_counts(mode for _, u, r, mode in carries if (u, r) not in stranded)
    return out


def transcripts(ctx):
    """Main-session transcripts, `<root>/projects/<pdir>/<uuid>.jsonl` — the
    Workflow tool is the session's, not its workflow agents'. A swapping session
    leaves one copy per account root it visited (and one name per mirrored
    project dir), each a PREFIX of the copy it moved on with, so by default only
    the LARGEST copy of each uuid is read: measured on the fleet box at
    planning, 44.6 GB of names in the window collapse to 6.4 GB. A copy that
    diverged would hide a call only it holds; `--all-copies` reads every one."""
    best = {}
    for root in sorted(glob.glob(os.path.join(ctx["home"], ".claude*"))):
        for path in glob.glob(os.path.join(root, "projects", "*", "*.jsonl")):
            try:
                st = os.stat(path)
            except OSError:
                continue
            if ctx["since"] is not None and st.st_mtime < ctx["since"]:
                continue      # last written before the window opened: no call in it
            key = path if ctx["all_copies"] else os.path.basename(path)
            if key not in best or st.st_size > best[key][1]:
                best[key] = (path, st.st_size)
    return sorted(p for p, _ in best.values())


def classify(text):
    if "is not on disk" in text:
        return "journal-missing"
    if "scriptPath must be a script path" in text:
        return "script-path"
    return "other-error"


def resume_section(ctx):
    calls = {}      # tool_use id -> timestamp
    results = {}    # tool_use id -> class
    for path in transcripts(ctx):
        try:
            with open(path, "rb") as fb:
                with mmap.mmap(fb.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                    if mm.find(b"resumeFromRunId") < 0:
                        continue      # the common case, decided in C without a line loop
            f = open(path, encoding="utf8", errors="replace")
        except (OSError, ValueError):
            continue
        pending = set()
        with f:
            for line in f:
                hit_use = "resumeFromRunId" in line
                hit_res = pending and '"tool_result"' in line and any(i in line for i in pending)
                if not (hit_use or hit_res):
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                content = (row.get("message") or {}).get("content")
                if not isinstance(content, list):
                    continue
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "tool_use" and b.get("name") == "Workflow" \
                            and isinstance(b.get("input"), dict) and b["input"].get("resumeFromRunId"):
                        calls.setdefault(b.get("id"), row.get("timestamp") or "")
                        pending.add(b.get("id"))
                    elif b.get("type") == "tool_result" and b.get("tool_use_id") in pending:
                        c = b.get("content")
                        text = c if isinstance(c, str) else json.dumps(c)
                        err = str(b.get("is_error")).lower() == "true"
                        results[b["tool_use_id"]] = classify(text) if err else "ok"
    out = {"ok": 0, "journal-missing": 0, "script-path": 0, "other-error": 0, "no-result": 0}
    n = 0
    for i, ts in calls.items():
        if not in_window(iso_epoch(ts), ctx):
            continue
        n += 1
        out[results.get(i, "no-result")] += 1
    return {"resume_calls": n, "by_outcome": out}


def stage1(ctx):
    return {"carry": carry_section(ctx), "resume": resume_section(ctx)}


STAGES = {1: stage1}


def when(s):
    """--since/--until/--deployed: 'YYYY-MM-DD[ HH:MM[:SS]]' (a `T` for the space
    is accepted), LOCAL time as swap.log writes it -> epoch seconds."""
    v = s.replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return int(time.mktime(time.strptime(v, fmt)))
        except ValueError:
            pass
    raise argparse.ArgumentTypeError(f"not YYYY-MM-DD[ HH:MM[:SS]]: {s!r}")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stage", type=int, choices=sorted(STAGES), action="append")
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--swap-log", help="default: <home>/.cc-sessions/swap.log")
    ap.add_argument("--since", type=when, help="YYYY-MM-DD[ HH:MM[:SS]] (local), inclusive")
    ap.add_argument("--until", type=when, help="YYYY-MM-DD[ HH:MM[:SS]] (local), exclusive")
    ap.add_argument("--deployed", type=when, help="the stage's rollout time (local): splits out pairs stranded before it")
    ap.add_argument("--all-copies", action="store_true", help="read every transcript copy, not the largest per uuid")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    ctx = {
        "home": a.home,
        "swap_log": a.swap_log or os.path.join(a.home, ".cc-sessions", "swap.log"),
        "since": a.since, "until": a.until, "deployed": a.deployed,
        "all_copies": a.all_copies,
    }
    out = {f"stage{n}": STAGES[n](ctx) for n in (a.stage or sorted(STAGES))}
    if a.json:
        print(json.dumps(out, indent=1, sort_keys=True))
        return 0
    for stage, sections in out.items():
        print(stage)
        for name, rows in sections.items():
            print(f"  [{name}]")
            for k, v in (rows.items() if isinstance(rows, dict) else [("", rows)]):
                print(f"    {k:40} {json.dumps(v, sort_keys=True) if isinstance(v, dict) else v}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the tests to verify they pass**

`topology-clean.test.ts` reads its corpus from `git ls-files`, so the two new files are marked intent-to-add first — an untracked file is not scanned, and its green would be vacuous:

```bash
chmod 0755 deploy/measure-continuity.py
git add -N deploy/measure-continuity.py server/test/measure-continuity.test.ts
cd server && ./node_modules/.bin/vitest run test/measure-continuity.test.ts test/ccd-swap-carry-merge.test.ts test/topology-clean.test.ts
```

Expected: PASS — `measure-continuity` 4/4, `ccd-swap-carry-merge` 25/25, `topology-clean` 55/55 (measured; the fixture's `/h/.claude*` roots and `demo-*` ids are placeholders, not a user home path). The cases hold under any `TZ` — measured again with `TZ=America/Los_Angeles`: 4/4 — because every window the tests write is read in the same local zone.

- [ ] **Step 5: Reproduce the spec's stage-1 baseline, read-only, on the fleet box**

```bash
python3 deploy/measure-continuity.py --stage 1 --since 2026-09-08 --until '2026-09-23 08:50'
python3 deploy/measure-continuity.py --stage 1 --since 2026-09-08 --until '2026-09-23 18:26'
```

Read `[carry]` from the first and `[resume]` from the second. Expected (re-measured 2026-09-23 with this file, 57 s each — each run reads both sections): `carries 1310` with `"kept": 774`, `"copy": 389`, `"link": 147`; `resume_calls 72` with `"ok": 55, "journal-missing": 8, "script-path": 5, "other-error": 4, "no-result": 0` — spec §1.2's 774 of 1,310, 8 of 72 and 5 of 72. (Re-measured 2026-09-24 with this revision's carry section alone, which reads only `swap.log`: `carries 1310`, `"kept": 774`, `"copy": 389`, `"link": 147`, `deferred_carries 0`, `deferred_actions 0` — no merge ran in the baseline window.) The fleet box's zone is UTC, which makes these local-time windows the same instants the spec's UTC baseline used; on a box in another zone, set `TZ` to the fleet box's. A later run of the same windows can only ADD rows if a transcript copy grew; a smaller number is a finding. This is the baseline §9 compares the rollout against (Task 4, Step 7).

- [ ] **Step 6: Mutation check, then commit**

Each row edits `deploy/measure-continuity.py` (row 19: `ccd/ccd`, re-stamped after restore), restored from a saved copy (never `git checkout --`); command `cd server && ./node_modules/.bin/vitest run --maxWorkers=1 test/measure-continuity.test.ts`; every red measured on the prototype, one row at a time. Row 30 (it mutated `stranded_pairs_budget_every_visit`) is RETIRED with that key: the key counted the pairs an all-or-nothing budget stranded on every visit, which the priority fill no longer does, and the deferred counts (rows 40, 41 and 42) replace it.

| # | Exact edit | Expected red |
|---|---|---|
| 18 | the refusal text unrecognised: delete `    if "is not on disk" in text:` and its `        return "journal-missing"` | "counts resume refusals by tool-use id …" only — `expected { 'journal-missing': +0, …(4) } to deeply equal { ok: 1, 'journal-missing': 1, …(3) }` |
| 19 | ccd's log format drifts (`ccd/ccd`): `(merged +$n ~$r !$dv$dfr)` → `(merged $n/$r/$dv$dfr)` | "counts what the real carry writes …" only — `expected +0 to be 2` (both merges fell into `other`) |
| 20 | no dedupe across copies — the calls keyed by (copy, id), the lookup still by id: `calls.setdefault(b.get("id"), row.get("timestamp") or "")` → `calls[(path, b.get("id"))] = row.get("timestamp") or ""` AND `    for i, ts in calls.items():` → `    for (_p, i), ts in calls.items():` | "counts resume refusals by tool-use id …" only — `--all-copies: expected 3 to be 2` (the default largest-copy pass reads one file and stays green; the red is in the `--all-copies` pass, which is the one dedupe governs) |
| 21 | no window: `in_window`'s two-line `return t is not None and (ctx["since"] … < ctx["until"])` → `    return True` | 2 failed: "keeps the legacy `(kept)` apart … and honours the window" — `expected 5 to be 3`; "reports every carry and, with --deployed, …" — `expected 5 to be 4` (the pre-deploy `(copy)` enters its window) |
| 22 | the legacy rule folded out of the target: `"kept_other_than_busy_budget": modes["kept"] + modes["kept: error"],` → `"kept_other_than_busy_budget": modes["kept: error"],` | "keeps the legacy `(kept)` apart …" only — `legacy kept + error, never budget: expected 1 to be 2` |
| 27 | the born-on root not stranded (only a swap's `to` side counted): `        for w in (frm, to):` → `        for w in (to,):` | "reports every carry and, with --deployed, …" only — `U's two return visits are the stranded backlog: expected 3 to be 2` |
| 28 | the deploy time ignored for swap lines: `            if early(t):` / `                visits.append((uuid, frm, to))` → `            if True:` / `                visits.append((uuid, frm, to))` | the same case only — `U's two return visits are the stranded backlog: expected +0 to be 2` (every pair reads as stranded) |
| 29 | no split at all: `carry_counts(mode for _, u, r, mode in carries if (u, r) not in stranded)` → `carry_counts(mode for _, u, r, mode in carries)` | the same case only — `U's two return visits are the stranded backlog: expected 4 to be 2` |
| 40 | the instrument and ccd disagree on the deferred suffix: in `MERGED`, `(?:, deferred (\d+))?$")` → `(?:; deferred (\d+))?$")` | 2 failed: "counts what the real carry writes …" — `expected 1 to be 2` (the cut-short merge fell into `other`); "reports every carry and, with --deployed, …" — `expected [ +0, +0 ] to deeply equal [ 2, 45 ]` |
| 41 | every merge counted as cut short: `            deferred_carries += 1 if k else 0` → `            deferred_carries += 1` | "counts what the real carry writes …" only — `expected [ 2, 1 ] to deeply equal [ 1, 1 ]` |
| 42 | the deferred carries counted instead of their actions: `            deferred_actions += k` → `            deferred_actions += 1 if k else 0` | "reports every carry and, with --deployed, …" only — `expected [ 2, 2 ] to deeply equal [ 2, 45 ]` |

The row this table carried before revision — `calls[f"{path}:{b.get('id')}"] = …` alone — was re-run and reds for the wrong reason: the bare-id lookup `results.get(i)` never matches a `path:id` key, so every call becomes `no-result` in the DEFAULT pass (`expected { 'journal-missing': +0, …(4) } to deeply equal …`, received `"no-result": 2`), where only one copy is read and dedupe is never exercised. Row 20 above keeps the lookup working and removes only the dedupe.

```bash
git add deploy/measure-continuity.py server/test/measure-continuity.test.ts
git commit -m "$(cat <<'MSG'
feat(deploy): measure-continuity.py — the session-continuity instrument, stage 1's rows

Read-only, run by hand on the fleet box (spec §9). The programme's one
registry, STAGES = {N: stageN}, stageN(ctx) returning named sections; this
wave registers 1: stage1 (wave 2 registers 4: stage4 in the same file).
ctx carries home, swap_log, since/until/deployed as epochs (swap.log stamps
are local time, converted with mktime; transcript stamps UTC, timegm) and
all_copies.

- carry: every sidecar line in swap.log by mode — link, copy, merged, the
  pre-merge (kept), and the merge's three fallbacks (kept: busy|budget|error)
  — with the merged walks' summed +N ~R !D, the diverged rows, and the
  budget's cut: deferred_carries (merges logged ", deferred K") and
  deferred_actions (their summed K), kept: budget its own count. With
  --deployed, the same counts again without the pairs stranded before the
  deploy (the destination root held the session then: a sidecar line names
  it, or a swap line names its wrapper, from or to — each wrapper's root is
  learned from the log). §9's target is kept only as busy/budget, under 2%
  of carries, reported both ways.
- resume: every Workflow resumeFromRunId call, deduplicated by tool-use id,
  classified by its result (ok, journal-missing, script-path, other-error,
  no-result). §9's target is journal-missing 0.

Reproduces the spec's baseline on the fleet box: 1,310 carries, 774 kept
(2026-09-08 .. 09-23 08:50); 72 resume calls, 8 journal-missing, 5
script-path (.. 18:26). The resume row reads the largest transcript copy
per session (44.6 GB of names -> 6.4 GB) with an mmap prefilter: 57 s.
The carry row is pinned against the REAL carry's output in a fixture HOME.
MSG
)"
```

---

### Task 4: Whole-branch verification, the PR — and the AGENT-FIRST deploy

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified — this task runs, measures, opens the PR and hands over the deploy.

**Interfaces:**
- Consumes: everything Tasks 1–3 produced, and Task 1's verdict.
- Produces: the wave-1 PR on this workspace's own branch, and a wave-done report. Wave 6 (stage 3) consumes `_carry_slot_take` (its manifest scan takes the same slot) and the `diverged … longer …` rows; every later wave registers its own `N: stageN` in `measure-continuity.py`'s `STAGES` (wave 2's `4: stage4` may already be there). None of it does anything until `ccd` is on the fleet box.

- [ ] **Step 1: Run all three package suites, in the foreground, one at a time**

The server suite does not fit one 600 s call on the loaded fleet box, so it runs as twelve SEQUENTIAL shards (each its own foreground call, timeout 600000 ms) whose union is every file exactly once — never in parallel, which reds the timing tests and risks the pane's memory cap. Shell state, cwd included, does not survive between calls, so EVERY call below starts from the repo root and carries its own `cd`:

```bash
cd server && npm ci
```

```bash
cd server && ./node_modules/.bin/vitest run --shard=1/12
```

— then the same line with `--shard=2/12`, `3/12`, … `12/12`, each as its own foreground call from the repo root. Then:

```bash
cd agent && npm ci && npm run test
```

```bash
cd pwa && npm ci && npm run test
```

Expected: PASS everywhere. `agent` and `pwa` are untouched by this wave and must be green unchanged. Report the twelve shard summaries and their sum. If ANY shard is killed by the 600 s ceiling, do not background it and do not trust its tail — re-run the WHOLE suite as `--shard=k/24`, k = 1…24. Re-run any known load flake IN ISOLATION before calling it a break.

- [ ] **Step 2: Cross-tree deviation check, and the corpus premise**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts
cd .. && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected: PASS, and `corpus-frozen`. If `origin/main` moved `ccd/ccd` or `README.md` since Task 2 (another session-continuity wave, or the landing-order programme), merge it, re-stamp, re-run Task 2 Step 5's tax steps against the merge's first parent, and re-run `ccd-reg-get-census` and `ccd-account-auth -t 'census, not a memory'` (a wave that adds its own dot-prefixed `$REG` artifact moves the R-3 cardinal again; re-word line for line, from the red's own derived number) — an assertion over the merge is only true on the merged tree. If `deploy/measure-continuity.py` came in from wave 2 by the merge, resolve it by Task 3 Step 3's existing-file rule and run both instrument tests. The programme ledger's rule: waves 1–4 land one at a time, each by a clean merge onto current `main`.

- [ ] **Step 3: The wave's own surface in one run**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry-merge.test.ts test/measure-continuity.test.ts \
  test/ccd-swap.test.ts test/ccd-swap-carry.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts \
  test/ccd-swap-pin.test.ts test/ccd-account-ok.test.ts
./node_modules/.bin/vitest run test/ccd-account-auth.test.ts -t 'census, not a memory'
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: PASS. If `ownership` reds, `ccd/ccd` was edited after the last re-stamp.

- [ ] **Step 4: Confirm the author, push, and open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
```

Expected: exactly one line, the identity this workspace is configured to commit as — not a placeholder. The pre-push hook refuses identity residue; if it does, fix the author, do not bypass the hook.

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Session continuity wave 1: the sidecar carry merges instead of skipping (AGENT-FIRST)" --body-file - <<'EOF'
Wave 1 of the session-continuity programme (spec `docs/superpowers/specs/2026-09-23-session-continuity-design.md` §5.1, C8; ledger `docs/superpowers/programs/session-continuity.md`). **AGENT-FIRST, ccd only.** Nothing is deleted.

What it does:

1. **A return visit merges.** When a swap carries a session's sidecar directory onto an account where it already exists, `_swap_carry_sidecars` no longer logs `(kept)` and skips it (774 of 1,310 baseline carries; every "journal … is not on disk" resume refusal followed only `(kept)` carries). It walks the source file by file, by spec §5.1's table, and logs `sidecar <uuid> -> <dst> (merged +N ~R !D)`; a divergence is kept, counted and named in a `diverged … longer …` row. The first carry to an account is unchanged.
2. **Bounded, and a big backlog still drains.** A box-wide non-blocking slot (`$REG/.carry.lock`, inside the carry, so every swap path is covered) falls back to `(kept: busy)`. A 512 MiB byte budget per visit is spent as a priority fill: a dry pass prices every action before anything moves, then the actions are placed whole in resume order — the rewritten records, then the runs' journals, then every other log, then the rest, newest first within each — until the next would overrun the budget; the rest are deferred to the next visit, never started, and the verdict reads `(merged +N ~R !D, deferred K)`. `(kept: budget)` only when the first action alone is over budget. Measured on the box's 673 return-visit pairs: 630 fit at once, the other 43 drain in 2 or 3 visits — where an all-or-nothing budget would have stranded all 43 for good. Nothing waits. A walk that cannot run — including a `flock` that fails other than by conflict — is `(kept: error)`. The slot is the twelfth dot-prefixed `$REG` artifact, so `_ws_project_valid`'s R-3 boundary paragraph now names it (reworded line for line).
3. **`deploy/measure-continuity.py`** — the programme's read-only instrument (`STAGES = {1: stage1}`, the cross-wave shape wave 2's `4: stage4` shares), stage 1's rows: the carry counter over `swap.log`, with the budget's deferred counts — over every carry and, with `--deployed`, without the pairs stranded before the deploy — and the journal-missing resume refusals. It reproduces the spec's baseline exactly on the fleet box.

Measured first (spec prerequisite): Claude Code appends `journal.jsonl` and `agent-*.jsonl` in place and writes `workflows/<runId>.json` whole at the run's end; the `(copy)` fallbacks are link(2) answering EXDEV across the account roots' separate bind mounts of one volume. Planning decisions the spec left open (the size+mtime quick check, the `error` fallback word) are listed in the plan, beside the one departure from the spec's text: its "all or nothing" budget became the priority fill by orchestrator decision, and the spec was amended at the source before any code.

Citation corpus (S6-R11): every added or removed line sits below the lowest line-anchored citation into `ccd/ccd`, and the R-3 rewording above them is line-neutral; the census did not move and README is unchanged.

**Deploy: `ccrc rollout --to <this merge's tag>` in its default order — fleet box first. Never `--server-first`.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report (the wave-done mail)**

Report to the coordinator, per the worker skill: the branch tip sha; the three suites' results (the twelve server shard summaries and their sum); Task 1's verdict with `verdict.txt`, the inspect lines, the live sample and both Step-4 outputs; Task 3 Step 5's two baseline outputs; Task 2 Step 5's tax outputs; every mutation row's measured red; and every departure from this plan, named by what it is (the coordinator assigns numbers — see `## Deviations found`). Then stop: the deploy below runs after the merge, by whoever merges.

- [ ] **Step 6: Deploy — FLEET BOX FIRST (post-merge, from a machine holding `~/.ccrc/deploy.env`)**

The server does not change in this wave, so the order is simply `ccrc rollout`'s default. ONE block, because the tag must be computed in the same shell that uses it, from the PR's own merge commit — never from wherever `origin/main` stands, since other programmes merge against the same files:

```bash
PR=<this wave's PR number>
git fetch origin main --tags
M=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
TAG=$(git tag --points-at "$M" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "merge: $M  tag: ${TAG:-<none yet>}"
if [ -n "$M" ] && [ -n "$TAG" ]; then
  ccrc rollout --to "$TAG"
  echo "rollout rc=$?"
  ccrc rollout --check
else
  echo "STOP: no release tag on this PR's merge commit yet — wait for release-main.yml and re-run this block"
fi
```

Expected: `merge: <sha>  tag: vX.Y.Z`, then both boxes report that tag, converged. A rollout exits 3 when a box moved but its doctor has FAIL lines — the box IS on the new build; read the FAIL lines before anything else. Never roll a working tree with `deploy.sh` for this wave.

Prove the fleet box runs the merge (a shell on the fleet box, read-only):

```bash
grep -c '^_swap_carry_merge_walk() {' "$HOME/.local/bin/ccd"
```

Expected: `1`.

- [ ] **Step 7: The §9 measurement, one week after the rollout (read-only, on the fleet box, from a checkout at the merge commit)**

```bash
R='<rollout time in the fleet box local zone (UTC there), YYYY-MM-DD HH:MM>'
python3 deploy/measure-continuity.py --stage 1 --since "$R" --deployed "$R" --json
```

Report to the coordinator for the programme ledger, from `stage1`: `carry.kept_share` and `carry.kept_other_than_busy_budget` (every carry); `carry.excluding_stranded.kept_share` and `carry.excluding_stranded.kept_other_than_busy_budget` (the carries whose pair was not stranded before the deploy); `carry.by_mode["kept: budget"]`, `carry.deferred_carries` and `carry.deferred_actions` in BOTH views; and `resume.by_outcome`. §9's stage-1 targets, read against BOTH carry views: `kept` only as `busy`/`budget`, under 2% of carries (`kept_other_than_busy_budget` 0 and `kept_share` < 0.02); journal-missing refusals 0. The `excluding_stranded` view is the mechanism's steady state; a failing every-carry view beside a passing `excluding_stranded` view is the C9 backlog, not the merge. The deferred counts say how that backlog is draining: deferred merges on stranded pairs are the backlog being placed a budget at a time, most valuable bytes first, and should thin out visit by visit (planning measured every over-budget pair on the box draining within 3 visits, Pre-flight finding 5); deferred merges in the `excluding_stranded` view mean the steady state itself overruns 512 MiB a visit, and any `kept: budget` means an action priced over the budget on its own is holding its whole queue — each is a finding to report with the pairs it names, not a pass. A bare `(kept)` after the rollout means an old ccd ran a carry — check the fleet box's `ccd` before anything else. Rolling back, if ever needed: `ccrc update --to <the previous tag> --downgrade` on the fleet box; a merged destination stays merged, which the old ccd reads as `(kept)`.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator at each wave's run-open, and every entry in this plan draws from it; **a worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail — what departed, where, and why — and the coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file (`dtbd.test.ts` reds the concrete form).

Two deliberate absences: no block is written as a range, and no headroom accounting lives in this plan.

The pre-flight findings and the planning decisions above are not deviations: they were measured or decided before this plan existed and shaped it. They are recorded there, with their tools, so a reviewer comparing the diff against the spec can see why each departure from the obvious shape was taken.

One of them changed the spec's TEXT rather than filling a gap, and is named here so it cannot pass as a planner's choice: the byte budget is a PRIORITY FILL (Planning decisions), where spec §5.1 "Bounded", its test list and §9's stranded-backlog note first said "all or nothing". The orchestrator decided it on 2026-09-24, after this plan measured that an all-or-nothing budget strands every over-budget pair on every return visit (Pre-flight finding 5), and amended the spec at the source in the same commit as this plan, before any code: it is not a deviation and carries no number.

D-3496 was ISSUED at plan time — the allocator's block for this programme's amendment slugs, beside wave 2's D-3497 and D-3498 — for the slug `sidecar-carry-merges`, and is defined here in that same act (the spec's C8 row names it: "Slug `sidecar-carry-merges`, D-3496"). It is not a planner's guess and not a number a worker may reuse. Departures found while executing this plan draw from the block the coordinator mints at this wave's run-open, as the paragraph above says.

- **D-3496** — spec §3 C8, REVERSING the sidecar carry's rule "an existing destination sidecar is LEFT ALONE rather than merged" (the old `_swap_carry_sidecars` header, and the `ccd-swap.test.ts` case "leaves an existing destination sidecar alone — a tree is not replaced in one step", which pinned it with `(kept)`). From this wave, an existing destination is merged file by file by spec §5.1's table — absent → link else copy (`+N`); equal → nothing; a journal the destination holds a strict prefix of, or a rewritten record whose source is newer → replaced by temp-and-rename (`~R`); a longer destination the source prefixes → kept; anything diverged → kept and counted (`!D`) — under a box-wide non-blocking slot (`$REG/.carry.lock`, contended → `(kept: busy)`) and `CARRY_MERGE_BUDGET` spent as a priority fill (records, then journals, then the rest, each placed whole; what does not fit is deferred to the next visit and logged `(merged +N ~R !D, deferred K)`; `(kept: budget)` only when the first action alone is over budget), and `(kept: error)` when the walk cannot run; nothing is deleted, and the first carry keeps its `cp -al` / clear-then-copy path. What survives of the old rule: a tree is still never replaced in one step, and `cp` is never run onto an existing destination (the anti-nesting guard). Measured reversal: the old pin reds against the new ccd (`expected '… carry b7001948-22…' to contain '(kept)'`) and its rewrite reds against the old (`… to contain '(merged +0 ~0 !1)'`).

---

## Review lenses

Three lenses, all `opus` — a five-file diff (two shipped files, `ccd/ccd` and `deploy/measure-continuity.py`; three test files), sized per the fleet policy at the low end of its 3–5 band because two of the five are tests each lens reads against its own concern (one `sonnet` refute pass per finding). Lens 1 runs at `xhigh`: this wave deletes nothing, but it REPLACES files inside live account roots on every return-visit swap, which is the one irreversible act in it.

1. **The merge's semantics and its safety (opus, xhigh).** Nothing is deleted on any path, including a walk killed half way (every placement is a link or a temp renamed into place; a stale `.ccd-carry-*` is skipped on both sides); a replace never writes through a destination inode; the extend rule fires only on a STRICT prefix, a longer destination is never shortened, and a record is replaced only when the source is strictly newer; the quick check is size AND `mtime_ns`, never size alone, and identity decides only "equal"; a symlinked or non-directory destination is never walked into; the dry pass prices every action's bytes read or copied (including the copy a same-size record replace makes after its compare) before anything moves; the fill places whole actions in resume order (records, then every `journal.jsonl`, then the other logs, then the rest, newest source first within each), stops at the FIRST action that would overrun the budget and never skips past it, and a deferred action is never started — no file, directory or temp — so a deferred journal keeps its old bytes and inode; the verdict carries `K` as its own number, and rc 3 (`(kept: budget)`) happens only when the first action alone is over budget and leaves the destination byte-identical; repeat visits converge, because each finds the placed files equal and prices only what is left (and the plan's census measured it: 43 over-budget pairs, 2–3 visits); the two named costs of the fill (an action over budget on its own holds its queue; a compare that places nothing is priced every visit) are stated and measured; the slot is taken only for an existing destination, is non-blocking, is released on the one way out, and its lock file is never unlinked; the first carry is byte-for-byte today's path; `(kept: error)` is never folded into `busy` — neither an unopenable lock file nor a `flock` exit other than 1 reads as contention; the function still answers rc 0 always, so `cmd_swap`'s restart is unaffected.
2. **Guard fidelity and the citation tax (opus, high).** Every mutation row really mutates the guard it names and reds for the stated reason, not an adjacent one — row 31 in particular restores the all-or-nothing budget this revision replaced and must red the fill cases on their deferral, not on a crash; the new `ccd-*` test spawns bash only through `h.sh`, so the containment scan holds; every added or removed line sits below `:21202` and the R-3 rewording above it is line-neutral (and names the slot with the cardinal `ccd-account-auth`'s census derives), `repoint-readme.py` left README unchanged and `cite-remeasure.py` reported no movement on THIS tree, re-run after any merge of `origin/main`; `ccd/ccd` was re-stamped after its last edit; no `_reg_get` was added; the `ccd-swap.test.ts` rewrite is the reversal C8 names and nothing wider.
3. **The measurement (opus, high).** Task 1's verdict came from the tools on the day, not from this plan's numbers, and its stop rule was applied; `measure-continuity.py` opens nothing for writing and runs no subprocess; its carry row reads exactly the lines ccd writes, the `, deferred K` suffix included (pinned by the real-carry parity case, which runs one carry under a budget that defers), keeps the legacy `(kept)` apart from the three new reasons, and reports `deferred_carries` / `deferred_actions` beside `kept: budget` without folding either into the other; its carry row is reported both over every carry and without the pairs stranded before `--deployed`, the stranded rule catches a born-on root (a swap's `from`) and its named cost (an unmapped wrapper) is stated; swap.log stamps are read as local time and transcript stamps as UTC; its resume row deduplicates by tool-use id and its largest-copy shortcut is stated with its named cost (`--all-copies`); it reproduces spec §1.2's 774 / 1,310 and 8 / 72; the file follows the cross-wave contract exactly (`STAGES = {1: stage1}`, `stage1(ctx)`, the contract's flags), so wave 2's `4: stage4` lands beside it without touching stage 1's block, and vice versa.
