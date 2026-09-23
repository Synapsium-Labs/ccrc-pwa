# Session continuity, wave 1 — the carry merges instead of skipping (AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a return visit carry a session's work. When `cmd_swap` carries a session's sidecar directory (`<root>/projects/<pdir>/<uuid>/`: subagent transcripts, workflow journals, tool results) onto an account where that directory already exists, `_swap_carry_sidecars` today logs `(kept)` and skips the whole tree — 774 of 1,310 carries in the baseline window, and every one of the 8 "journal … is not on disk" resume refusals came after only `(kept)` carries. After this wave the existing-destination branch walks the source file by file and decides on content and size by the spec's table, logs `sidecar <uuid> -> <dst> (merged +N ~R !D)`, deletes nothing, and repairs a destination an earlier failure left partial — bounded by a box-wide non-blocking slot and a byte budget that fall back to `(kept: busy)` / `(kept: budget)` without waiting. The first carry to an account keeps today's path byte for byte. Plus the programme's instrument, `deploy/measure-continuity.py`, with the two stage-1 rows of spec §9.

**Architecture:** Four pieces, each with tests that red when it is deleted or mutated, and all of it in one place in `ccd/ccd`, directly above `_swap_beat() {`, below every line-anchored citation into the file. (1) `_swap_carry_merge_walk src dst budget` — ONE embedded python3 program (fd-3 heredoc, `_pr_py`'s idiom): a dry pass over `lstat` alone that charges the byte budget BEFORE anything moves (all or nothing, rc 3 over budget), then the table: absent → hardlink else copy (`+N`); same inode, or equal size and equal nanosecond mtime, or equal bytes → nothing; `*.jsonl` whose destination is a strict prefix → replace by temp-and-rename (`~R`); a longer destination the source prefixes → keep; neither a prefix of the other → keep and count (`!D`, printed with the longer copy's path); a rewritten record (`workflows/<runId>.json`, `agent-*.meta.json`, `workflows/scripts/*`) whose source is newer → replace (`~R`); any other file whose bytes differ → keep and count (`!D`). (2) `_carry_slot_take` — `$REG/.carry.lock`, `flock -n`, never unlinked, three answers (taken / contended / no mechanism). (3) `_swap_carry_sidecars`'s existing-destination branch — takes the slot once, at the first existing destination, calls the walk, logs one verdict per sidecar: `(merged +N ~R !D)`, `(kept: busy)`, `(kept: budget)` or `(kept: error)`, plus one `diverged <kept> longer <longer>` row per `!D`, and releases the slot on its one way out. (4) `deploy/measure-continuity.py` — read-only, run by hand on the fleet box: the carry counter over `swap.log` by mode and reason, and the resume-refusal count over the transcripts, deduplicated by tool-use id.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `set -uo pipefail`, no `-e`), python 3.12 (the embedded walk; the instrument; three read-only measurement tools run from the scratchpad, never committed), TypeScript + vitest 4.1 (tests), util-linux `flock`.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md` — §5.1 (stage 1: the table, "Bounded", the tests), §1.2 mechanism 1, §3 C8 (the reversal this wave mints), §8 "Mass rescue I/O", §9 stage 1's row and its instrument clause, §11 item 1 (no backfill). Programme ledger: `docs/superpowers/programs/session-continuity.md` (wave 1).

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST.** The only shipped code is `ccd/ccd` (fleet box) and a read-only `deploy/` script nothing runs automatically. `ccrc rollout`'s DEFAULT order (fleet box first) is the order; this wave NEVER uses `--server-first`. Nothing in `server/src`, `agent/src`, `shared/` or `pwa/` changes, and no wire field, capability token or argv flag is added — `FLEET_PROTO` is untouched.
- **The first carry to an account is today's path, unchanged** (spec §5.1): `cp -al`, then the clear-then-copy `cp -a` fallback, logged `(link)` / `(copy)`, taking no slot. Only a destination that already exists reaches the merge. Task 2's "a first carry takes no slot" pins it.
- **Nothing is deleted.** The walk only creates files, creates directories and renames a temp file over a destination name. A destination-only file survives; the source is never written. Task 2's "deletes nothing" pins it, and its mutation row 6 (today's clear-then-copy applied to an existing destination) reds it.
- **Never wait.** The unit is already stopped when the carry runs, so a contended slot and an overrun budget both fall back to `(kept: …)` at once (spec §5.1 "Bounded", §8).
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly — this wave's measurements READ `swap.log`, the account roots' `projects/` trees and the system manager's mount units with `stat`, `cat`, `find`, `findmnt` and `systemctl show`/`list-units`, and write nothing anywhere outside the scratchpad. NEVER print secret file CONTENTS.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`), whose `h.sh` spawns bash through `ghContainedEnv(home, …, { systemd: true, tmux: true })`. The new `ccd-swap-carry-merge.test.ts` spawns bash ONLY through `h.sh`, so `ccd-workspaces.test.ts`'s scan ("routes EVERY bash call site in every ccd test file through ALL THREE poisons") stays green; `measure-continuity.test.ts` spawns `python3` directly with `--home` pointed at the fixture HOME, and never reads the live one.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000ms, one at a time.** The fleet box is memory-bound (a pane scope throttles at 8G and dies at 12G with its session): never two suites at once from one pane, never a backgrounded suite. The whole server suite runs as sequential shards (Task 4).
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`.
- **Rings / no overloaded null at a seam:** `_carry_slot_take` answers three codes because its caller logs three different things (taken / `kept: busy` / `kept: error`); the walk answers rc 0 / rc 3 / anything else because budget and failure are different verdicts. `(kept: error)` is its own word, never folded into `busy`: "another carry holds the slot" and "this box cannot merge" have different remedies.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated, measured before/after. Every mutation row in this plan was run on a prototype of exactly these edits at `905360dc`, one row at a time, the file restored from a SAVED COPY after each (never `git checkout --`), and its red is quoted.
- **`ccd/ccd` is a provenance-STAMPED file** (line 2 is `# ccrc:generated 1 sha256=…`). **Every task that edits `ccd/ccd` re-stamps before running any suite**, or `server/test/ownership.test.ts` reds:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **The citation tax (S6-R11) is owed by every CITED file this wave touches — and this wave's placement makes it zero, measured.** `server/test/session-hook.test.ts` audits every `file:line` citation in the two frozen corpus documents and in `README.md`. Measured at `905360dc` (`grep -oE '(ccd/ccd)?:[0-9]+'` over the two corpus documents — the file prefix OPTIONAL, because the corpus names a file once and continues with bare `` `:N` `` anchors — and `grep -oE 'ccd/ccd:[0-9]+(-[0-9]+)?' README.md`): the corpus's highest `ccd/ccd` anchor is `:19131`, README's two are `:21202` (`cmd_ensure`'s mint) and `:19989-19991` (the `genrc == 1` arm). Every line this wave adds or removes sits at or below `_swap_carry_sidecars() {` (`:21615` at `905360dc`), below all three, so no anchor moves. Task 2 still runs the re-pointer and the re-measurer (below) and expects them to report NO movement — the measurement, not this paragraph, is the authority. The other files this wave touches (`server/test/ccd-swap.test.ts`, two new tests, one new script) are cited by neither corpus document nor README.
- **The `_reg_get` census:** this wave adds NO `_reg_get` call (the slot is a lock file, not a registry field), so `ccd-reg-get-census.test.ts`'s sentence does not move; Task 2 runs that test to prove it.
- **Locate code by CONTENT.** Line numbers are "at `905360dc`" and are hints, never addresses. Four session-continuity waves and the landing-order programme are live against `ccd/ccd`; each lands on current `main` by a clean merge, re-stamps, and re-measures the citation corpus and the `_reg_get` census on the merged tree before its final gate (programme ledger).
- **Every forecast number is "at `905360dc`"** (= `origin/main` `a3a93b41` plus the two approved specs and the programme ledgers). Where `origin/main` has moved since, a different line number or test total with every case PASSING is not a red — the instrument's output is the authority and the difference goes in the commit message. Stop only on a FAILING case or a moved census you cannot explain.
- **Shell state does not survive between Bash calls.** Every code block that names `$SCRATCH` sets it itself; `SCRATCH=<…>` lines mean "paste your own session's scratchpad, as an ABSOLUTE path". Never run half a block, and never rely on a variable an earlier block set — an empty `$SCRATCH` points every path at `/`.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`). One commit per task that changes files (Tasks 2 and 3).
- **Commit trailers:** end every commit message with the attribution line your own session is given. The heredocs below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs, account names or user home paths** anywhere in a committed file (`topology-clean.test.ts`). The fixtures use `.claude` and `.claude-d`, the harness's own roster; measurement output that names a real account root stays in the scratchpad and the wave-done mail.
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.

---

## Review Focus

Five inputs or failure modes the spec implies and names no test for; each is given a test in the task that owns it.

1. **A destination `<uuid>` that is a symlink (or not a directory).** A walk that followed it would write the session's files somewhere outside the account root. Owned by Task 2: "a destination that is a symlink is not walked into: (kept: error)" (mutation row 12).
2. **A temp file a killed walk left behind** (`.ccd-carry-*`, on either side). Carried, it would land as a bogus file; counted, it would inflate `+N`; tripped on, it would fail the next walk. Owned by Task 2: "never carries, counts or trips on a temp a killed walk left" (row 16).
3. **The slot outliving the carry.** An fd left open would be inherited by the restarted unit's `systemctl start` chain and make every later carry `(kept: busy)` for as long as that process lives. Owned by Task 2: "releases the slot on the way out, and never unlinks the lock file" (row 10).
4. **A replace that writes THROUGH a destination inode another name shares** (a hardlinked first carry, or any second name). It would rewrite the other name too. Owned by Task 2: "extends a journal … by temp-and-rename", with a sibling hardlink that must keep the old bytes (row 5).
5. **ccd and the instrument disagreeing on the log line.** §9's stage-1 metric is read off `swap.log` by `measure-continuity.py`; a format drift would report zero merges while the carry works. Owned by Task 3: "counts what the real carry writes", which runs the real `_swap_carry_sidecars` and then the instrument over the same fixture HOME (row 19).

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `ccd/ccd` | Modify — the whole `_swap_carry_sidecars` function (header to closing `}`, directly above `_swap_beat() {`, ≈21615–21706 at `905360dc`) is replaced by one block: the section header, `CARRY_MERGE_BUDGET`, `_carry_slot_take`, `_swap_carry_merge_walk`, and the rewritten `_swap_carry_sidecars` (Task 2) | The merge, its slot and its budget; the first carry unchanged |
| `server/test/ccd-swap-carry-merge.test.ts` | Create (Task 2) | Every rule of the table, the bounds, the fallbacks, the first carry unchanged |
| `server/test/ccd-swap.test.ts` | Modify — the `(kept)` case becomes the merged case; one comment corrected (Task 2) | The real `cmd_swap` reaches the merge |
| `deploy/measure-continuity.py` | Create (Task 3) | The programme's read-only instrument: wave 1's carry and resume rows |
| `server/test/measure-continuity.test.ts` | Create (Task 3) | The instrument reads what ccd writes; windows; resume dedupe |

**Not modified, deliberately:** `README.md` (its two `ccd/ccd` anchors sit above the edit, and it describes no sidecar rule), `server/test/session-hook.test.ts` (the census does not move), `CLAUDE.md`, `server/test/ccd-swap-carry.test.ts` (the transcript carry is untouched), everything under `server/src`, `agent/`, `shared/`, `pwa/`. `ccd-account-ok.test.ts` and `ccd-swap-pin.test.ts` stub `_swap_carry_sidecars() { :; }` by name — the name is kept, so they are untouched and stay green (measured).

---

## Pre-flight findings (measured while planning; not deviations)

Each was measured on the fleet box or on a prototype of this plan's exact edits at `905360dc`. They are the reasons the tasks look the way they do.

1. **The write model, measured (the spec's prerequisite).** Two instruments, both read-only. (a) A live sample of this planning session's own running workflow: one `agent-*.jsonl` stat'd three times over 30 minutes kept ONE inode while it grew 641,806 → 976,799 → 1,516,725 bytes; the run's `journal.jsonl` kept its inode (it had not been appended to yet — no agent had finished). (b) `write-model.py` (Task 1) over every workflow run that FINISHED on the account root it sits on, last 3 days: 128 runs; `journal.jsonl` appended in place 128 of 128 (born at launch, last written at completion, ≥ 3 lines); `agent-*.jsonl` appended in place 4,447; copied with a preserved mtime (a carry, or Claude Code's own relocation of a resumed run) 158; born at their last write 10 — 2 one-second agents of 11 rows, and 8 files born at 21:04–21:06 on 2026-09-22 whose rows end before 21:01, i.e. copies made by the account-root migration that evening (below), which did not preserve mtime. `workflows/<runId>.json` is written whole at the run's end: born within 2 s of its last write in 128 of 128. `agent-*.meta.json` was born and last written in the same instant in both runs sampled by hand (six files). **Verdict: the logs are appended in place, the records are written whole; the spec's table stands as written.** The table decides on CONTENT (prefix, bytes, mtime), so even a replace-by-rename writer would not change a verdict — what the write model does change is the old header's claim that sidecars are "write-once artifacts", which Task 2 corrects.
2. **The `(copy)` fallbacks on a one-device box, explained.** Every account root is its own bind mount of the one data volume (`findmnt`: 20 roots, one source device), and `link(2)` across two mount points answers `EXDEV` even inside one filesystem — measured with a scratch file hardlinked across two mounts of the same volume: `ln: failed to create hard link … Invalid cross-device link`, and `cp -al` left an empty skeleton, exactly the shape the carry's fallback clears. Joined against each root's mount activation time (`linkmode.py`, Task 1): every dated `(copy)` involved a root that was already a mount (262 of 262), and every dated `(link)` ran while both roots were still plain directories (163 of 163); 202 lines name a root with no mount unit today and get no verdict. The roots were moved onto bind mounts one at a time, from 2026-08-21 to 2026-09-22; since the box's mount table last changed (2026-09-22 21:52) every carry is `(copy)` — 17 of 17 at planning. Consequence for the design: on this fleet every `+N` is a copy, never a link, and every carried file is an independent inode — so a return visit cannot find "equal by identity", and the budget is what bounds it.
3. **Park-and-wake R4's box-wide release lock has NOT shipped:** `grep -c 'release.lock' ccd/ccd` → `0` at `905360dc`. Per spec §5.1 the carry takes a slot of its own, `$REG/.carry.lock`.
4. **Every path that carries goes through ONE call.** `_swap_carry_sidecars` has exactly one caller, `cmd_swap` (`grep -n '_swap_carry_sidecars "' ccd/ccd` → one hit, ≈22790), and rescue, auto-home (both via `_dispatch_swap`), manual/PWA swaps and `swap-self` all run `cmd_swap`. A supervisor revival never changes account and never carries. So a slot taken inside the function covers every path the spec names.
5. **The sidecar census, and the budget.** Over every sidecar on the box: 1,095 directories; bytes p50 20 MB, p90 222 MB, p99 1.29 GB, max 2.18 GB; files p50 71, p90 727, p99 3,497, max 6,142 (hence one python process, not a fork per file). Over the 673 real return-visit pairs on the box (the same `<pdir>/<uuid>` under two roots), the walk's byte cost: with the size+mtime quick check p50 5.6 MiB, p90 208 MiB, p99 1,091 MiB — equal to the bytes that are actually new at every percentile; comparing bytes alone, p50 80 MiB, p90 764 MiB, p99 1,561 MiB. At `CARRY_MERGE_BUDGET` = 512 MiB, 43 of the 673 pairs would fall back to `(kept: budget)` with the quick check and 87 without. The pairs are today's stranded backlog (C9: not backfilled), which the first merge of each session carries once; after that a return visit costs what was written since the last one. The dry pass over this planning session's own stranded sidecar (a copy on another root) took 0.13 s and priced the merge at 88.6 MB.
6. **The citation census does not move** (Global Constraints). `repoint-readme.py` printed `ccd/ccd:21202` and `ccd/ccd:19989-19991` and left README byte-identical; `cite-remeasure.py … HEAD` printed `stated == base == tree` on all four lines — `147 / 195 / 53 / 35` — with EMPTY `ENTERED`/`LEFT` everywhere.
7. **The existing `(kept)` pin reverses.** `ccd-swap.test.ts` "leaves an existing destination sidecar alone — a tree is not replaced in one step" reds on the prototype: `expected '… carry b7001948-22…' to contain '(kept)'`, the log now reading `(merged +0 ~0 !1)` (its differing tool result is kept and counted). Task 2 rewrites that case in the same commit; it is the pin C8 reverses.
8. **The instrument reproduces the spec's baseline exactly, read-only, on the fleet box.** `measure-continuity.py --only carry --since 2026-09-08 --until '2026-09-23 08:50'` → 1,310 carries, `kept` 774, `copy` 389, `link` 147; `--only resume --since 2026-09-08 --until '2026-09-23 18:26'` → 72 resume calls: ok 55, journal-missing 8, script-path 5, other-error 4 (spec §1.2: 72; 8; 5; "ok with 0 swaps 36; ok with ≥1 swap 19"; 3 still running + 1 parse error). The resume row reads only the LARGEST transcript copy of each session uuid (44.6 GB of names in the window collapse to 6.4 GB) and skips a file with no `resumeFromRunId` in C (`mmap.find`); 58 s. A first cut that read every copy line by line was killed at 15 minutes.

---

## Planning decisions the spec did not make

Each is built as written below; each is named in `spec_gaps` for the coordinator, and none is a deviation from a spec rule unless the coordinator rules it one.

- **The quick check.** Spec §5.1's second row reads "equal size and equal bytes → nothing". This plan decides "equal" in three ways, in order: the same inode (equal by identity — identity decides only EQUAL, never DIFFERENT, so the spec's "never on inode identity" holds for every other verdict); equal size AND equal nanosecond mtime (rsync's default quick check — every carry on this fleet is a `cp -a` or python `copy2`, both of which preserve `mtime_ns`); otherwise a byte compare. Measured cost (finding 5): it takes the p90 return visit from 764 MiB to 208 MiB. Named cost: two different files of identical size AND identical nanosecond mtime read as equal. Pinned so it cannot widen: "decides equality on size AND mtime, never on size alone" (mutation row 1).
- **A third fallback word, `(kept: error)`.** The spec names `busy` and `budget`. A walk that cannot run at all — no `flock`, the lock file unopenable, no `python3`, a destination that is not a real directory, or the walker failing — is neither, and folding it into either would give the operator the wrong remedy. The instrument counts it separately and reports `kept_other_than_busy_budget` (legacy `kept` + `error`) against §9's target.
- **The budget is charged by a dry pass, all or nothing.** "The walk exceeds its byte budget" could mean a walk that stops half way. This plan prices the whole walk from `lstat` first (the bytes it would read to compare plus the bytes it would copy) and falls back BEFORE the first byte moves, so `(kept: budget)` means exactly today's `(kept)`: the destination as it was.
- **Files the table does not classify.** A file outside the three named classes whose bytes differ (a tool result is written once) is kept and counted `!D`; a destination entry of another type where the source has a regular file is kept and counted `!D`; a non-regular source entry (a symlink, a fifo) is never followed and never copied. The spec's "named in the manifest with the longer copy's path" has no manifest until stage 3 (wave 6), so this wave writes one `sidecar <uuid> diverged <kept path> longer <longer path>` row to `swap.log` per `!D` — the input wave 6's manifest will read.
- **`CARRY_MERGE_BUDGET` = 512 MiB,** per sidecar directory, from finding 5; a knob beside the function, not in the tuning block near the top of the file (that would move every citation anchor below it).

---

## The citation tax, mechanised (S6-R11)

`server/test/session-hook.test.ts` audits every `file:line` citation in two FROZEN corpus documents (`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`, `docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`) and in `README.md`. Any line inserted into `ccd/ccd` moves every anchor below it. The standing rule S6-R11: **README is REPAIRED, by content, never counted; everything else is RE-MEASURED from the instrument, with the composition stated; no rule is widened and no D-number is spent.** This wave's edit sits below every anchor, so the forecast is NO movement — but the forecast is checked by the instruments, not assumed.

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
- Modify: `ccd/ccd` — replace `_swap_carry_sidecars` whole (from `_swap_carry_sidecars() {` to its closing `}` directly above `_swap_beat() {`) with the block in Step 3
- Modify: `server/test/ccd-swap.test.ts` — two edits (Step 4)
- Test: `server/test/ccd-swap-carry-merge.test.ts` (new)

**Interfaces:**
- Consumes: `_sidecar_matches "$srccfg" "$uuid"` (unchanged), `$REG`, `cmd_swap`'s one call `_swap_carry_sidecars "$srccfg" "$dstcfg" "$uuid"` (unchanged; the function still always answers rc 0).
- Produces:
  - `CARRY_MERGE_BUDGET=536870912` — bytes one sidecar's merge walk may read + copy.
  - `_carry_slot_take` → rc 0 with the CALLER's `local CARRY_SLOT_FD` set | rc 1 contended | rc 2 no mechanism. The lock file is `$REG/.carry.lock`, never unlinked. Stage 3's manifest scan (wave 6) "takes the same slot" (spec §5.3) — it calls this function, it does not re-spell the path.
  - `_swap_carry_merge_walk <src> <dst> <budget>` → stdout `diverged <kept> longer <longer>` rows then `merged <N> <R> <D>`, rc 0 | `budget <cost>`, rc 3, nothing touched | anything else: failed.
  - `swap.log` lines: `<date> sidecar <uuid> -> <dst> (merged +N ~R !D)`, `(kept: busy)`, `(kept: budget)`, `(kept: error)`; and `<date> sidecar <uuid> diverged <kept path> longer <longer path>`. Task 3's instrument and wave 6's manifest read them. The first-carry lines `(link)` / `(copy)` are unchanged; bare `(kept)` is never written again.

- [ ] **Step 0: Confirm the base, and that the surface is green before any edit**

```bash
git log -1 --format='%h %s'
git merge-base --is-ancestor 905360dc HEAD && echo "base carries 905360dc"
git fetch origin main && git merge --no-edit origin/main && git log -1 --format='%h'
cd server && ./node_modules/.bin/vitest run test/ccd-swap.test.ts test/ccd-swap-carry.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: `base carries 905360dc`; the merge either `Already up to date.` or clean (a conflict in `ccd/ccd` or `README.md`: stop and report, do not resolve it by hand in this task); `35 passed` for the two swap suites; `7 passed | 326 skipped` for the citation cases. A red here is the base's, not this wave's.

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
 * byte budget. Every rule of the spec's table has a case here that reds when
 * the rule is removed; the first carry's own path is pinned unchanged.
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
/** The one `sidecar <uuid> -> <dst> (…)` verdict for our destination. */
const verdict = (): string => {
  const rows = swapLog().split('\n').filter((l) => l.includes(` sidecar ${UUID} -> ${DST()} (`));
  expect(rows, swapLog()).toHaveLength(1);
  return rows[0]!.replace(/^.* \(/, '(');
};

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

describe('bounded: the slot and the budget fall back to (kept), never wait', () => {
  it('a busy slot falls back to (kept: busy) and touches nothing', () => {
    put(SRC('tool-results/new.txt'), 'NEW\n');
    fs.mkdirSync(DST(), { recursive: true });
    const out = carry(HOLD_SLOT);
    expect(out).not.toContain('HOLD-FAILED');
    expect(verdict()).toBe('(kept: busy)');
    expect(fs.existsSync(DST('tool-results/new.txt'))).toBe(false);
  });

  it('the budget falls back to (kept: budget) before a byte moves', () => {
    put(SRC('tool-results/big.txt'), 'x'.repeat(100));
    put(SRC('tool-results/small.txt'), 'y');
    fs.mkdirSync(DST(), { recursive: true });
    carry('CARRY_MERGE_BUDGET=50;');
    expect(verdict()).toBe('(kept: budget)');
    expect(fs.readdirSync(DST()), 'all or nothing: the file that fit was not placed either').toEqual([]);
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry-merge.test.ts`

Expected: FAIL — `Tests 15 failed | 3 passed (18)` (measured at `905360dc`). The three that pass are the controls, true of today's ccd and required to stay true: "deletes nothing …", "a first carry takes no slot …" and "releases the slot on the way out …". The fifteen fail on today's `(kept)` verdict (`expected '(kept)' to be '(merged +1 ~0 !0)'`, `expected '(kept)' to be '(kept: busy)'` and their kin) or on files that were never carried (`ENOENT: no such file or directory, open '…/subagents/workflows/wf_1/journal.jsonl'`). On a box without `/dev/shm` on a separate filesystem (macOS) the copy-fallback case is skipped, not failed.

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
# BOUNDED, BECAUSE THE WALK READS WHERE `(kept)` READ NOTHING. Two bounds, both
# of which fall back to exactly today's `(kept)` rather than wait — the unit is
# already stopped, so a carry that queued would be a session held down:
#   - a BOX-WIDE NON-BLOCKING SLOT, `$REG/.carry.lock`, taken inside the carry
#     itself, so every path that carries is covered — the tick's rescue and
#     auto-home, a manual or PWA swap, `swap-self` — not only `_dispatch_swap`'s
#     (the box-wide lock park-and-wake R4 designed for `_dispatch_swap` had not
#     shipped when this was written, measured, so this slot is the carry's
#     own). A supervisor revival carries nothing (it never changes account),
#     so it never reaches here. Contended: `(kept: busy)`.
#   - a BYTE BUDGET, CARRY_MERGE_BUDGET, charged by a dry pass over `lstat`
#     alone BEFORE the first byte moves: every byte the walk would read to
#     compare, plus every byte it would copy. Over budget: `(kept: budget)`, and
#     the destination is exactly as it was — all or nothing, never half a walk
#     billed to a budget it overran.
# A walk that could not run at all — no `flock`, no python3, a destination that
# is not a real directory, the walker's own failure — is `(kept: error)`, with
# the cause on stderr: a third word, because "someone else is carrying" and
# "this box cannot carry" want different remedies (never one overloaded word).
#
# The slot is NEVER unlinked (`.rotate.lock`'s rule: unlinking a held lock file
# is how two processes come to hold "the lock" on two inodes), and it is held
# only for the existing-destination branch — a FIRST carry to an account is
# today's `cp -al`/`cp -a` path, unchanged, and takes no slot.
CARRY_MERGE_BUDGET=536870912    # bytes one sidecar's merge walk may read + copy (512 MiB) before `(kept: budget)`

_carry_slot_take() {   # -> 0 and the CALLER's local CARRY_SLOT_FD set | 1 contended | 2 no mechanism (flock or the lock file)
  command -v flock >/dev/null 2>&1 || return 2
  local fd
  { exec {fd}>>"$REG/.carry.lock"; } 2>/dev/null || return 2
  flock -n "$fd" 2>/dev/null || { exec {fd}>&-; return 1; }
  CARRY_SLOT_FD=$fd
}

_swap_carry_merge_walk() {   # src dst budget -> stdout rows; rc 0 merged | 3 over budget (nothing touched) | other: failed
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
  # stage 3's manifest to name; the summary row is `merged <N> <R> <D>`.
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

plan, cost = [], 0
for rel in files(src):
    s = os.lstat(os.path.join(src, rel))
    if dst_blocked(rel):
        plan.append(('diverged', rel, None)); continue
    try:
        d = os.lstat(os.path.join(dst, rel))
    except FileNotFoundError:
        plan.append(('absent', rel, None)); cost += s.st_size; continue
    if not stat.S_ISREG(d.st_mode):
        plan.append(('diverged', rel, None)); continue
    if (d.st_dev, d.st_ino) == (s.st_dev, s.st_ino):
        continue
    if d.st_size == s.st_size:
        if d.st_mtime_ns == s.st_mtime_ns:
            continue
        plan.append(('same-size', rel, (s, d))); cost += 2 * s.st_size; continue
    if is_log(rel):
        cost += 2 * min(s.st_size, d.st_size) + (s.st_size if d.st_size < s.st_size else 0)
        plan.append(('log', rel, (s, d))); continue
    if is_record(rel):
        if s.st_mtime_ns > d.st_mtime_ns:
            cost += s.st_size
            plan.append(('replace', rel, None))
        continue
    plan.append(('diverged', rel, (s, d)))

if cost > budget:
    print(f'budget {cost}')
    sys.exit(3)

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
diverged = []
for kind, rel, st in plan:
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
        s, d = st
        if prefix_equal(sp, dp, s.st_size):
            continue
        if is_record(rel) and s.st_mtime_ns > d.st_mtime_ns:
            replace(rel); replaced += 1
        elif is_record(rel):
            continue
        else:
            diverged.append((dp, sp))
    elif kind == 'log':
        s, d = st
        if d.st_size < s.st_size:
            if prefix_equal(sp, dp, d.st_size):
                replace(rel); replaced += 1
            else:
                diverged.append((dp, sp))
        elif not prefix_equal(sp, dp, s.st_size):
            diverged.append((dp, dp))
    else:
        if st is None:
            diverged.append((dp, sp))
        else:
            s, d = st
            diverged.append((dp, sp if s.st_size > d.st_size else dp))

for kept, longer in diverged:
    print(f'diverged {kept} longer {longer}')
print(f'merged {added} {replaced} {len(diverged)}')
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
  # CARRY_MERGE_BUDGET, logging `(merged +N ~R !D)` or `(kept: busy|budget|error)`.
  # A destination a failed first carry left partial is repaired by the same
  # walk — it simply finds the missing files absent — so `(kept)` is no longer
  # permanent.
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
  local slot="" slot_rc=0 wout wrc line n r dv CARRY_SLOT_FD=""
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
        echo "ccd: sidecar at $dst not merged — the walk would exceed CARRY_MERGE_BUDGET (${rows[0]#budget } bytes); left alone" >&2
        echo "$(date '+%F %T') sidecar $uuid -> $dst (kept: budget)" >> "$REG/swap.log"
        continue
      fi
      line="${rows[${#rows[@]}-1]}"
      if (( wrc != 0 )) || [[ ! "$line" =~ ^merged\ ([0-9]+)\ ([0-9]+)\ ([0-9]+)$ ]]; then
        echo "ccd: warn: the merge walk into $dst failed (rc $wrc); every file it placed is whole, the rest stays on the source" >&2
        echo "$(date '+%F %T') sidecar $uuid -> $dst (kept: error)" >> "$REG/swap.log"
        continue
      fi
      n="${BASH_REMATCH[1]}"; r="${BASH_REMATCH[2]}"; dv="${BASH_REMATCH[3]}"
      for line in "${rows[@]}"; do
        [[ "$line" == diverged\ * ]] || continue
        echo "$(date '+%F %T') sidecar $uuid diverged ${line#diverged }" >> "$REG/swap.log"
      done
      echo "$(date '+%F %T') sidecar $uuid -> $dst (merged +$n ~$r !$dv)" >> "$REG/swap.log"
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

Expected: `replaced ccd/ccd:21615-21706 with 366 lines` and `syntax-ok`.

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

Expected (measured on the prototype): `331	57	ccd/ccd` and `13	8	server/test/ccd-swap.test.ts`; the re-pointer prints `cmd_ensure mint   -> ccd/ccd:21202` and `genrc == 1 arm    -> ccd/ccd:19989-19991`, then `readme-unchanged`; the re-measurer prints `stated 147  base 147  tree 147`, `stated 195  base 195  tree 195`, `other byFile keys moved: none`, and `stated 53  base 53  tree 53` / `stated 35  base 35  tree 35` with EMPTY `ENTERED`/`LEFT` everywhere; `corpus-frozen`. **Nothing in `session-hook.test.ts` or `README.md` changes in this task.** Any movement means code landed above `:21202` — find out why before going on.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry-merge.test.ts test/ccd-swap.test.ts \
  test/ccd-swap-carry.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts \
  test/ccd-swap-pin.test.ts test/ccd-account-ok.test.ts
./node_modules/.bin/vitest run test/macos-platform.test.ts test/platform-hazards.test.ts \
  test/single-definition.test.ts test/topology-clean.test.ts
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'ALL THREE poisons'
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: all PASS — `ccd-swap-carry-merge` 18/18 (the copy-fallback case RUNS on the fleet box, where `/dev/shm` is a tmpfs and the fixture HOME is not); the four scans `276 passed | 14 skipped`; the containment scan `1 passed`; the citation cases `7 passed | 326 skipped`. (`ownership` proves the re-stamp landed; `ccd-reg-get-census` proves no `_reg_get` was added; `ccd-swap-pin` and `ccd-account-ok` stub the function by its unchanged name.)

- [ ] **Step 7: Mutation check, then commit**

Seventeen rows, each applied to the working file after saving a copy of it (`cp ccd/ccd "$SCRATCH/ccd.saved"`), run, then restored from that saved copy (`cp "$SCRATCH/ccd.saved" ccd/ccd`, never `git checkout --`) and re-stamped before the next. Every red below was measured on the prototype at `905360dc`, running `cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry-merge.test.ts` (row 17 runs `test/ccd-swap.test.ts`):

| # | Exact edit in `ccd/ccd` (in `_swap_carry_merge_walk`'s python unless named) | Expected red |
|---|---|---|
| 1 | the quick check widened to size alone: `        if d.st_mtime_ns == s.st_mtime_ns:` → `        if True:` | "decides equality on size AND mtime, never on size alone …" only (1 failed) — `expected '(merged +0 ~0 !0)' to be '(merged +0 ~0 !1)'` |
| 2 | the extend rule without its prefix check: `            if prefix_equal(sp, dp, d.st_size):` → `            if True:` | "keeps a DIVERGED journal …" only — `expected 'A\nB\nC\n' to be 'A\nX\n'` |
| 3 | a longer destination never counted: `        elif not prefix_equal(sp, dp, s.st_size):` → `        elif False:` | "keeps a DIVERGED journal …" only — `expected '(merged +0 ~0 !1)' to be '(merged +0 ~0 !2)'` |
| 4 | a record replaced whatever its age: in the dry pass, `        if s.st_mtime_ns > d.st_mtime_ns:` (the `cost += s.st_size` arm) → `        if True:` | "replaces a rewritten record when the source is newer …" only — `an OLDER source record replaced a newer destination: expected '{"v":1}' to be '{"v":22}'` |
| 5 | replace writes THROUGH the inode: in `replace()`, the two lines `shutil.copy2(os.path.join(src, rel), tmp)` / `os.replace(tmp, target)` → `shutil.copyfile(os.path.join(src, rel), target)` | "extends a journal … by temp-and-rename" only — `the replace wrote through the destination inode: expected 'A\nB\nC\n' to be 'A\n'` |
| 6 | today's clear-then-copy applied to an EXISTING destination (bash branch): `wout=$(_swap_carry_merge_walk "$src" "$dst" "$CARRY_MERGE_BUDGET"); wrc=$?` → `rm -rf "$dst"; cp -a "$src" "$dst"; wout="merged 0 0 0"; wrc=0` | 13 failed, among them "deletes nothing …" — `ENOENT: no such file or directory, open '…/tool-results/only-here.txt'` |
| 7 | a directory copy onto an existing destination (the nesting shape): the same line → `cp -a "$src" "$dst"; wout="merged 0 0 0"; wrc=0` | 11 failed, among them "never nests the tree inside an existing destination" — `a <uuid>/<uuid> nest: expected true to be false` |
| 8 | no budget: `if cost > budget:` → `if False:` | "the budget falls back to (kept: budget) before a byte moves" only — `expected '(merged +2 ~0 !0)' to be '(kept: budget)'` |
| 9 | the slot ignores contention (`_carry_slot_take`): `  flock -n "$fd" 2>/dev/null \|\| { exec {fd}>&-; return 1; }` → `  : \|\| { exec {fd}>&-; return 1; }` | "a busy slot falls back to (kept: busy) …" only — `expected '(merged +1 ~0 !0)' to be '(kept: busy)'` |
| 10 | the slot is never released: delete the line `  if [[ -n "$CARRY_SLOT_FD" ]]; then { exec {CARRY_SLOT_FD}>&-; } 2>/dev/null; fi` | "releases the slot on the way out …" only — `expected 'SLOT-HELD' to contain 'SLOT-FREE'` |
| 11 | the FIRST carry takes the slot too: directly under `    dst="$dstcfg/projects/$pdir/$uuid"`, add `    if [[ -z "$slot" ]]; then _carry_slot_take; slot_rc=$?; slot=taken; fi` and `    if (( slot_rc == 1 )); then echo "$(date '+%F %T') sidecar $uuid -> $dst (kept: busy)" >> "$REG/swap.log"; continue; fi` | "a first carry takes no slot …" only — `expected '(kept: busy)' to match /^\((link\|copy)\)$/` |
| 12 | a symlinked destination walked into: `[[ -L "$dst" \|\| ! -d "$dst" ]]` → `[[ ! -d "$dst" ]]` | "a destination that is a symlink is not walked into …" only — `expected '(merged +1 ~0 !0)' to be '(kept: error)'` |
| 13 | no copy fallback when linking fails: in the `absent` arm, `        except OSError:` → `        except KeyError:` | "copies an absent file when linking fails (EXDEV) …" only — `ENOENT: no such file or directory, open '…/tool-results/r.txt'` (the walk died on EXDEV: `(kept: error)`) |
| 14 | the log format drifts: `(merged +$n ~$r !$dv)` → `(merged $n/$r/$dv)` | 10 failed — `expected '(merged 2/0/0)' to be '(merged +2 ~0 !0)'` (Task 3's parity case reds on the same edit, row 19) |
| 15 | a differing unclassified file swallowed: the `same-size` arm's last branch `            diverged.append((dp, sp))` (under `elif is_record(rel): continue` / `else:`) → `            continue` | "decides equality on size AND mtime …" only — `expected '(merged +0 ~0 !0)' to be '(merged +0 ~0 !1)'` |
| 16 | a killed walk's temp carried: in `files()`, delete `            if f.startswith(TMP):` and its `                continue` | "never carries, counts or trips on a temp a killed walk left …" only — `expected true to be false` |
| 17 | the whole merge removed (today's ccd, `git show 905360dc:ccd/ccd`) — command `./node_modules/.bin/vitest run test/ccd-swap.test.ts` | "merges into an existing destination sidecar …" only — `expected '… carry b7001948-22…' to contain '(merged +0 ~0 !1)'`; and `ccd-swap-carry-merge` reds 15 of 18 (Step 2) |

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
has not shipped) and CARRY_MERGE_BUDGET (512 MiB), priced by a dry lstat pass
before a byte moves; contended -> (kept: busy), over budget -> (kept: budget),
cannot run -> (kept: error). The first carry to an account is unchanged.

ccd-swap.test.ts's (kept) case is the pin C8 reverses: rewritten to the
merged verdict in this commit. S6-R11: every edit sits below the lowest
line-anchored citation into ccd/ccd; the census did not move
(147 / 195 / 53 / 35, base and tree) and README is unchanged.
MSG
)"
```

---

### Task 3: `deploy/measure-continuity.py` — the carry counter and the resume refusals

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Create: `deploy/measure-continuity.py`
- Test: `server/test/measure-continuity.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's `swap.log` lines (`(merged +N ~R !D)`, `(kept: busy|budget|error)`, `diverged … longer …`), the legacy `(kept)` / `(link)` / `(copy)` lines, and Claude Code's session transcripts (`<root>/projects/<pdir>/<uuid>.jsonl`): a `Workflow` `tool_use` carrying `resumeFromRunId`, and its `tool_result`.
- Produces: `python3 deploy/measure-continuity.py [--home DIR] [--since T] [--until T] [--only carry|resume] [--all-copies] [--json]`, read-only; `SECTIONS = {'carry': …, 'resume': …}`, the registry every later wave appends its §9 rows to (programme ledger, carried constraint 2). JSON keys: `carry.{carries, by_mode{link, copy, merged, kept, kept: busy, kept: budget, kept: error, other}, kept_total, kept_share, kept_other_than_busy_budget, merged_added, merged_replaced, merged_diverged, diverged_rows}`, `resume.{resume_calls, by_outcome{ok, journal-missing, script-path, other-error, no-result}}`.

- [ ] **Step 1: Write the failing test** — create `server/test/measure-continuity.test.ts`:

```ts
/**
 * `deploy/measure-continuity.py` — the session-continuity programme's
 * read-only instrument (spec §9), wave 1's two rows: the carry counter over
 * `swap.log` and the journal-missing resume refusals in the transcripts.
 *
 * The carry row is pinned against what ccd ACTUALLY writes: the first case
 * runs the real `_swap_carry_sidecars` in a fixture HOME (`makeCcdHarness`)
 * and then the instrument over that same HOME, so a change to either side of
 * the `(merged +N ~R !D)` line format reds here rather than in a report a
 * week after rollout. Fixture HOMEs only: `--home` points the instrument at
 * one; nothing here reads the live `$HOME`.
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

const measure = (...args: string[]): Record<string, any> =>
  JSON.parse(execFileSync('python3', [TOOL, '--home', h.home, '--json', ...args], { encoding: 'utf8' }));

const put = (cfg: string, rel: string, body: string, mtime = T0): string => {
  const p = path.join(h.home, cfg, 'projects', PDIR, UUID, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, mtime, mtime);
  return p;
};

describe('the carry row', () => {
  it('counts what the real carry writes: a merge with its +N ~R !D, a diverged row, and a (kept: busy)', () => {
    put('.claude', 'subagents/agent-a1.jsonl', 'A\nB\n', T0 + 60);
    put('.claude-d', 'subagents/agent-a1.jsonl', 'A\nX\nY\n');
    put('.claude', 'tool-results/new.txt', 'NEW\n');
    const CARRY = `_swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>/dev/null`;
    h.sh(CARRY);
    h.sh(`exec 7>>"$REG/.carry.lock"; flock -n 7; ${CARRY}`);
    const c = measure('--only', 'carry').carry;
    expect(c.carries).toBe(2);
    expect(c.by_mode.merged).toBe(1);
    expect(c.by_mode['kept: busy']).toBe(1);
    expect([c.merged_added, c.merged_replaced, c.merged_diverged]).toEqual([1, 0, 1]);
    expect(c.diverged_rows).toBe(1);
    expect(c.kept_other_than_busy_budget).toBe(0);
  });

  it('keeps the legacy `(kept)` apart from the three new reasons, and honours the window', () => {
    // Rows in the exact shapes ccd has written: the pre-merge rule's bare
    // `(kept)`, a first carry's `(link)`/`(copy)`, and the merge's fallbacks.
    const log = [
      `2026-09-10 10:00:00 sidecar ${UUID} -> /d/1 (kept)`,
      `2026-09-10 10:00:01 sidecar ${UUID} -> /d/2 (copy)`,
      `2026-09-24 10:00:00 sidecar ${UUID} -> /d/3 (kept: budget)`,
      `2026-09-24 10:00:01 sidecar ${UUID} -> /d/4 (kept: error)`,
      `2026-09-24 10:00:02 sidecar ${UUID} -> /d/5 (link)`,
      `2026-09-24 10:00:03 swap demo-x: a -> b (uuid ${UUID})`,
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), log);
    const all = measure('--only', 'carry').carry;
    expect(all.carries).toBe(5);
    expect(all.by_mode.kept).toBe(1);
    expect(all.kept_total).toBe(3);
    expect(all.kept_other_than_busy_budget, 'legacy kept + error, never budget').toBe(2);
    const late = measure('--only', 'carry', '--since', '2026-09-24').carry;
    expect(late.carries).toBe(3);
    expect(late.by_mode.kept).toBe(0);
    const early = measure('--only', 'carry', '--until', '2026-09-24').carry;
    expect(early.carries).toBe(2);
  });
});

describe('the resume row', () => {
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
      const r = measure('--only', 'resume', ...flags).resume;
      expect(r.resume_calls, flags.join(' ') || 'largest copy').toBe(2);
      expect(r.by_outcome).toEqual({ ok: 1, 'journal-missing': 1, 'script-path': 0, 'other-error': 0, 'no-result': 0 });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/measure-continuity.test.ts`

Expected: FAIL — `3 failed (3)`, each on `python3: can't open file '…/deploy/measure-continuity.py': [Errno 2] No such file or directory`.

- [ ] **Step 3: Write the instrument** — create `deploy/measure-continuity.py`:

```python
#!/usr/bin/env python3
"""measure-continuity.py — the session-continuity programme's instrument (spec §9).

READ-ONLY. Run by hand on the fleet box, as the fleet user:

    python3 deploy/measure-continuity.py [--since YYYY-MM-DD[THH:MM]] [--until …] [--json]

It opens files for reading and nothing else: `$HOME/.cc-sessions/swap.log` and
the Claude Code transcripts under `$HOME/.claude*/projects/`. It never writes,
never runs `ccd`, never touches tmux or a unit. `--home DIR` points it at another
tree (the test suite's fixture HOMEs). `--since` is inclusive, `--until`
exclusive; both compare as UTC wall-clock text, which is what swap.log and the
transcripts both write.

The programme grows this file one stage at a time: each wave adds the §9 rows it
owns, in the same PR as the mechanism they measure, as one more section function
registered in SECTIONS. Wave 1 (stage 1) owns two rows:

  carry    every `sidecar <uuid> -> <dst> (<mode>)` line in swap.log, by mode —
           link, copy, merged, and `kept` by reason: `kept` alone is the
           pre-merge rule (an existing destination, skipped), `kept: busy`,
           `kept: budget` and `kept: error` are the merge's three fallbacks —
           plus the merged walks' summed +N ~R !D and the `diverged` rows.
           §9's target: `kept` only as busy/budget, under 2% of carries.
  resume   every Workflow tool call carrying `resumeFromRunId`, deduplicated by
           tool-use id across the account-root copies a swapping session
           accumulates, classified by its tool result: ok, journal-missing
           ("… is not on disk …"), script-path ("scriptPath must be a script
           path"), other-error, or no-result. §9's target: journal-missing 0.
"""
import argparse, glob, json, mmap, os, re, sys

CARRY = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) sidecar (\S+) -> (.+) \(([^()]*)\)$')
DIVERGED = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) sidecar (\S+) diverged (.+) longer (.+)$')
MERGED = re.compile(r'^merged \+(\d+) ~(\d+) !(\d+)$')
KEPT_REASONS = ('busy', 'budget', 'error')


def in_window(ts, since, until):
    """ts: 'YYYY-MM-DD HH:MM:SS' (swap.log) or ISO 'YYYY-MM-DDTHH:MM:SS…' (transcripts)."""
    t = ts[:19].replace('T', ' ')
    return (since is None or t >= since) and (until is None or t < until)


def carry_section(home, since, until, all_copies=False):
    path = os.path.join(home, '.cc-sessions', 'swap.log')
    modes = {'link': 0, 'copy': 0, 'merged': 0, 'kept': 0,
             'kept: busy': 0, 'kept: budget': 0, 'kept: error': 0, 'other': 0}
    added = replaced = diverged = diverged_rows = 0
    try:
        f = open(path, encoding='utf8', errors='replace')
    except FileNotFoundError:
        return {'swap_log': 'absent'}
    with f:
        for line in f:
            line = line.rstrip('\n')
            m = DIVERGED.match(line)
            if m:
                if in_window(m.group(1), since, until):
                    diverged_rows += 1
                continue
            m = CARRY.match(line)
            if not m or not in_window(m.group(1), since, until):
                continue
            mode = m.group(4)
            mm = MERGED.match(mode)
            if mm:
                modes['merged'] += 1
                added += int(mm.group(1)); replaced += int(mm.group(2)); diverged += int(mm.group(3))
            elif mode in modes:
                modes[mode] += 1
            else:
                modes['other'] += 1
    total = sum(modes.values())
    kept_all = modes['kept'] + sum(modes['kept: ' + r] for r in KEPT_REASONS)
    return {
        'carries': total,
        'by_mode': modes,
        'kept_total': kept_all,
        'kept_share': round(kept_all / total, 4) if total else None,
        'kept_other_than_busy_budget': modes['kept'] + modes['kept: error'],
        'merged_added': added, 'merged_replaced': replaced, 'merged_diverged': diverged,
        'diverged_rows': diverged_rows,
    }


def transcripts(home, since, all_copies):
    """Main-session transcripts, `<root>/projects/<pdir>/<uuid>.jsonl` — the
    Workflow tool is the session's, not its workflow agents'. A swapping session
    leaves one copy per account root it visited (and one name per mirrored
    project dir), each a PREFIX of the copy it moved on with, so by default only
    the LARGEST copy of each uuid is read: measured on the fleet box at
    planning, 44.6 GB of names in the window collapse to 6.4 GB. A copy that
    diverged would hide a call only it holds; `--all-copies` reads every one."""
    cutoff = None
    if since:
        import calendar, time
        cutoff = calendar.timegm(time.strptime(since[:10], '%Y-%m-%d'))
    best = {}
    for root in sorted(glob.glob(os.path.join(home, '.claude*'))):
        for path in glob.glob(os.path.join(root, 'projects', '*', '*.jsonl')):
            try:
                st = os.stat(path)
            except OSError:
                continue
            if cutoff is not None and st.st_mtime < cutoff:
                continue
            key = path if all_copies else os.path.basename(path)
            if key not in best or st.st_size > best[key][1]:
                best[key] = (path, st.st_size)
    return sorted(p for p, _ in best.values())


def classify(text):
    if 'is not on disk' in text:
        return 'journal-missing'
    if 'scriptPath must be a script path' in text:
        return 'script-path'
    return 'other-error'


def resume_section(home, since, until, all_copies=False):
    calls = {}      # tool_use id -> timestamp
    results = {}    # tool_use id -> class
    for path in transcripts(home, since, all_copies):
        try:
            with open(path, 'rb') as fb:
                with mmap.mmap(fb.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                    if mm.find(b'resumeFromRunId') < 0:
                        continue      # the common case, decided in C without a line loop
            f = open(path, encoding='utf8', errors='replace')
        except (OSError, ValueError):
            continue
        pending = set()
        with f:
            for line in f:
                hit_use = 'resumeFromRunId' in line
                hit_res = pending and '"tool_result"' in line and any(i in line for i in pending)
                if not (hit_use or hit_res):
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                content = (row.get('message') or {}).get('content')
                if not isinstance(content, list):
                    continue
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    if b.get('type') == 'tool_use' and b.get('name') == 'Workflow' \
                            and isinstance(b.get('input'), dict) and b['input'].get('resumeFromRunId'):
                        calls.setdefault(b.get('id'), row.get('timestamp') or '')
                        pending.add(b.get('id'))
                    elif b.get('type') == 'tool_result' and b.get('tool_use_id') in pending:
                        c = b.get('content')
                        text = c if isinstance(c, str) else json.dumps(c)
                        err = str(b.get('is_error')).lower() == 'true'
                        results[b['tool_use_id']] = classify(text) if err else 'ok'
    out = {'ok': 0, 'journal-missing': 0, 'script-path': 0, 'other-error': 0, 'no-result': 0}
    n = 0
    for i, ts in calls.items():
        if not in_window(ts, since, until):
            continue
        n += 1
        out[results.get(i, 'no-result')] += 1
    return {'resume_calls': n, 'by_outcome': out}


SECTIONS = {
    'carry': carry_section,
    'resume': resume_section,
}


def main(argv):
    ap = argparse.ArgumentParser(description='session-continuity instrument (read-only)')
    ap.add_argument('--home', default=os.path.expanduser('~'))
    ap.add_argument('--since'); ap.add_argument('--until')
    ap.add_argument('--only', choices=sorted(SECTIONS), action='append')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--all-copies', action='store_true', help='resume: read every transcript copy, not the largest per uuid')
    a = ap.parse_args(argv)
    norm = lambda v: v.replace('T', ' ') if v else None
    since, until = norm(a.since), norm(a.until)
    report = {k: fn(a.home, since, until, a.all_copies) for k, fn in SECTIONS.items() if not a.only or k in a.only}
    if a.json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    print(f'window: {since or "-"} .. {until or "-"}')
    for k, v in report.items():
        print(f'[{k}]')
        for kk, vv in v.items():
            print(f'  {kk}: {json.dumps(vv, sort_keys=True) if isinstance(vv, dict) else vv}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/measure-continuity.test.ts test/ccd-swap-carry-merge.test.ts test/topology-clean.test.ts
```

Expected: PASS — `measure-continuity` 3/3.

- [ ] **Step 5: Reproduce the spec's stage-1 baseline, read-only, on the fleet box**

```bash
python3 deploy/measure-continuity.py --only carry --since 2026-09-08 --until '2026-09-23 08:50'
python3 deploy/measure-continuity.py --only resume --since 2026-09-08 --until '2026-09-23 18:26'
```

Expected (measured at planning, 58 s for the second): `carries: 1310` with `"kept": 774`, `"copy": 389`, `"link": 147`; `resume_calls: 72` with `"ok": 55, "journal-missing": 8, "script-path": 5, "other-error": 4, "no-result": 0` — spec §1.2's 774 of 1,310, 8 of 72 and 5 of 72. A later run of the same windows can only ADD rows if a transcript copy grew; a smaller number is a finding. This is the baseline §9 compares the rollout against (Task 4, Step 7).

- [ ] **Step 6: Mutation check, then commit**

Each row edits `deploy/measure-continuity.py` (row 19: `ccd/ccd`, re-stamped after restore), restored from a saved copy; command `cd server && ./node_modules/.bin/vitest run test/measure-continuity.test.ts`; every red measured on the prototype:

| # | Exact edit | Expected red |
|---|---|---|
| 18 | the refusal text unrecognised: delete `    if 'is not on disk' in text:` and its `        return 'journal-missing'` | "counts resume refusals by tool-use id …" only — `expected { 'journal-missing': +0, …(4) } to deeply equal { ok: 1, 'journal-missing': 1, …(3) }` |
| 19 | ccd's log format drifts (`ccd/ccd`): `(merged +$n ~$r !$dv)` → `(merged $n/$r/$dv)` | "counts what the real carry writes …" only — `expected +0 to be 1` (the merge fell into `other`) |
| 20 | no dedupe across copies: `calls.setdefault(b.get('id'), row.get('timestamp') or '')` → `calls[f"{path}:{b.get('id')}"] = row.get('timestamp') or ''` | "counts resume refusals by tool-use id …" only — `expected { 'journal-missing': +0, …(4) } to deeply equal { ok: 1, 'journal-missing': 1, …(3) }` |
| 21 | no window: `    return (since is None or t >= since) and (until is None or t < until)` → `    return True` | "keeps the legacy `(kept)` apart … and honours the window" only — `expected 5 to be 3` |
| 22 | the legacy rule folded out of the target: `'kept_other_than_busy_budget': modes['kept'] + modes['kept: error'],` → `'kept_other_than_busy_budget': modes['kept: error'],` | the same case — `legacy kept + error, never budget: expected 1 to be 2` |

```bash
git add deploy/measure-continuity.py server/test/measure-continuity.test.ts
git commit -m "$(cat <<'MSG'
feat(deploy): measure-continuity.py — the session-continuity instrument, stage 1's rows

Read-only, run by hand on the fleet box (spec §9). Two sections, the
registry later waves append to:

- carry: every sidecar line in swap.log by mode — link, copy, merged, the
  pre-merge (kept), and the merge's three fallbacks (kept: busy|budget|error)
  — with the merged walks' summed +N ~R !D and the diverged rows. §9's target
  is kept only as busy/budget, under 2% of carries.
- resume: every Workflow resumeFromRunId call, deduplicated by tool-use id,
  classified by its result (ok, journal-missing, script-path, other-error,
  no-result). §9's target is journal-missing 0.

Reproduces the spec's baseline on the fleet box: 1,310 carries, 774 kept
(2026-09-08 .. 09-23 08:50); 72 resume calls, 8 journal-missing, 5
script-path (.. 18:26). The resume row reads the largest transcript copy
per session (44.6 GB of names -> 6.4 GB) with an mmap prefilter: 58 s.
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
- Produces: the wave-1 PR on this workspace's own branch, and a wave-done report. Wave 6 (stage 3) consumes `_carry_slot_take` (its manifest scan takes the same slot) and the `diverged … longer …` rows; every later wave appends a section to `measure-continuity.py`'s `SECTIONS`. None of it does anything until `ccd` is on the fleet box.

- [ ] **Step 1: Run all three package suites, in the foreground, one at a time**

The server suite does not fit one 600 s call on the loaded fleet box, so it runs as twelve SEQUENTIAL shards (each its own foreground call, timeout 600000 ms) whose union is every file exactly once — never in parallel, which reds the timing tests and risks the pane's memory cap:

```bash
cd server && npm ci
./node_modules/.bin/vitest run --shard=1/12     # … then 2/12, 3/12, … 12/12, one call each
cd ../agent && npm ci && npm run test
cd ../pwa   && npm ci && npm run test
```

Expected: PASS everywhere. `agent` and `pwa` are untouched by this wave and must be green unchanged. Report the twelve shard summaries and their sum. If ANY shard is killed by the 600 s ceiling, do not background it and do not trust its tail — re-run the WHOLE suite as `--shard=k/24`, k = 1…24. Re-run any known load flake IN ISOLATION before calling it a break.

- [ ] **Step 2: Cross-tree deviation check, and the corpus premise**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts
cd .. && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected: PASS, and `corpus-frozen`. If `origin/main` moved `ccd/ccd` or `README.md` since Task 2 (another session-continuity wave, or the landing-order programme), merge it, re-stamp, re-run Task 2 Step 5's tax steps against the merge's first parent, and re-run `ccd-reg-get-census` — an assertion over the merge is only true on the merged tree. The programme ledger's rule: waves 1–4 land one at a time, each by a clean merge onto current `main`.

- [ ] **Step 3: The wave's own surface in one run**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry-merge.test.ts test/measure-continuity.test.ts \
  test/ccd-swap.test.ts test/ccd-swap-carry.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts \
  test/ccd-swap-pin.test.ts test/ccd-account-ok.test.ts
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
2. **Bounded.** A box-wide non-blocking slot (`$REG/.carry.lock`, inside the carry, so every swap path is covered) and a 512 MiB byte budget priced by a dry pass before anything moves; they fall back to `(kept: busy)` / `(kept: budget)` and never wait. A walk that cannot run is `(kept: error)`.
3. **`deploy/measure-continuity.py`** — the programme's read-only instrument, stage 1's rows: the carry counter over `swap.log` and the journal-missing resume refusals. It reproduces the spec's baseline exactly on the fleet box.

Measured first (spec prerequisite): Claude Code appends `journal.jsonl` and `agent-*.jsonl` in place and writes `workflows/<runId>.json` whole at the run's end; the `(copy)` fallbacks are link(2) answering EXDEV across the account roots' separate bind mounts of one volume. Planning decisions the spec left open (the size+mtime quick check, the `error` fallback word, the all-or-nothing budget) are listed in the plan.

Citation corpus (S6-R11): every edit sits below the lowest line-anchored citation into `ccd/ccd`; the census did not move and README is unchanged.

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
python3 deploy/measure-continuity.py --since '<rollout time, UTC, YYYY-MM-DD HH:MM>'
```

Report `carry.kept_share`, `carry.kept_other_than_busy_budget` and `resume.by_outcome` to the coordinator for the programme ledger. §9's stage-1 targets: `kept` only as `busy`/`budget`, under 2% of carries (`kept_other_than_busy_budget` 0 and `kept_share` < 0.02); journal-missing refusals 0. A bare `(kept)` after the rollout means an old ccd ran a carry — check the fleet box's `ccd` before anything else. Rolling back, if ever needed: `ccrc update --to <the previous tag> --downgrade` on the fleet box; a merged destination stays merged, which the old ccd reads as `(kept)`.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator at each wave's run-open, and every entry in this plan draws from it; **a worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail — what departed, where, and why — and the coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file (`dtbd.test.ts` reds the concrete form).

Two deliberate absences: no block is written as a range, and no headroom accounting lives in this plan.

The pre-flight findings and the planning decisions above are not deviations: they were measured or decided before this plan existed and shaped it. They are recorded there, with their tools, so a reviewer comparing the diff against the spec can see why each departure from the obvious shape was taken.

- **D-3496** — spec §3 C8, REVERSING the sidecar carry's rule "an existing destination sidecar is LEFT ALONE rather than merged" (the old `_swap_carry_sidecars` header, and the `ccd-swap.test.ts` case "leaves an existing destination sidecar alone — a tree is not replaced in one step", which pinned it with `(kept)`). From this wave, an existing destination is merged file by file by spec §5.1's table — absent → link else copy (`+N`); equal → nothing; a journal the destination holds a strict prefix of, or a rewritten record whose source is newer → replaced by temp-and-rename (`~R`); a longer destination the source prefixes → kept; anything diverged → kept and counted (`!D`) — under a box-wide non-blocking slot (`$REG/.carry.lock`) and `CARRY_MERGE_BUDGET`, falling back to `(kept: busy)`, `(kept: budget)` or `(kept: error)`; nothing is deleted, and the first carry keeps its `cp -al` / clear-then-copy path. What survives of the old rule: a tree is still never replaced in one step, and `cp` is never run onto an existing destination (the anti-nesting guard). Measured reversal: the old pin reds against the new ccd (`expected '… carry b7001948-22…' to contain '(kept)'`) and its rewrite reds against the old (`… to contain '(merged +0 ~0 !1)'`).

---

## Review lenses

Three lenses, all `opus` — a five-file diff (two shipped files, `ccd/ccd` and `deploy/measure-continuity.py`; three test files), sized per the fleet policy at the low end of its 3–5 band because two of the five are tests each lens reads against its own concern (one `sonnet` refute pass per finding). Lens 1 runs at `xhigh`: this wave deletes nothing, but it REPLACES files inside live account roots on every return-visit swap, which is the one irreversible act in it.

1. **The merge's semantics and its safety (opus, xhigh).** Nothing is deleted on any path, including a walk killed half way (every placement is a link or a temp renamed into place; a stale `.ccd-carry-*` is skipped on both sides); a replace never writes through a destination inode; the extend rule fires only on a STRICT prefix, a longer destination is never shortened, and a record is replaced only when the source is strictly newer; the quick check is size AND `mtime_ns`, never size alone, and identity decides only "equal"; a symlinked or non-directory destination is never walked into; the dry pass prices every byte the walk will read or copy, and rc 3 leaves the destination byte-identical; the slot is taken only for an existing destination, is non-blocking, is released on the one way out, and its lock file is never unlinked; the first carry is byte-for-byte today's path; `(kept: error)` is never folded into `busy`; the function still answers rc 0 always, so `cmd_swap`'s restart is unaffected.
2. **Guard fidelity and the citation tax (opus, high).** Every mutation row really mutates the guard it names and reds for the stated reason, not an adjacent one; the new `ccd-*` test spawns bash only through `h.sh`, so the containment scan holds; the edit sits wholly below `:21202`, `repoint-readme.py` left README unchanged and `cite-remeasure.py` reported no movement on THIS tree, re-run after any merge of `origin/main`; `ccd/ccd` was re-stamped after its last edit; no `_reg_get` was added; the `ccd-swap.test.ts` rewrite is the reversal C8 names and nothing wider.
3. **The measurement (opus, high).** Task 1's verdict came from the tools on the day, not from this plan's numbers, and its stop rule was applied; `measure-continuity.py` opens nothing for writing and runs no subprocess; its carry row reads exactly the lines ccd writes (pinned by the real-carry parity case) and keeps the legacy `(kept)` apart from the three new reasons; its resume row deduplicates by tool-use id and its largest-copy shortcut is stated with its named cost (`--all-copies`); it reproduces spec §1.2's 774 / 1,310 and 8 / 72; `SECTIONS` is a registry a later wave can append to without touching wave 1's rows.
