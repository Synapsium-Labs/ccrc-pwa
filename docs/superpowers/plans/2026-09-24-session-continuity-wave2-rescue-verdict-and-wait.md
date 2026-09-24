# Session continuity, wave 2 — the rescue verdict and the rescue wait (AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop rescuing sessions on a limit banner they carried in from their previous account, and stop swapping a session that Claude Code is about to continue by itself. `cmd_swap` stamps `$REG/<id>.landed` when it lands a session on a new account; every positive of `_session_hard_blocked` is dated against it by the transcript's newest rate-limit row, and a row older than the landing is not a block (rule 1, C12). The dated row's `resetsAt`/`rateLimitType` are kept, and a `five_hour` block on an Anthropic lane whose reset is within `RESCUE_WAIT_BOUND` (600 s, C13) — with Claude Code's auto-continue armed on the pane, and a dated row written BEFORE that reset — waits instead of swapping, ending at the reset or `RESCUE_WAIT_GRACE` (120 s) after it (rule 2, C6). A wait ends IN PLACE, held on that reset and never swapped away from it, only while the pane's auto-continue is ARMED, because only Claude Code re-sends the turn there; a STALLED session whose wait crosses its own reset is rescued as today, by a swap whose spawn re-drives the turn. Today's `stranded` path becomes the no-room wait with the same reset ending. A rescue skips the accounts the session just left blocked, prefers a target no rescue landed on in the last ten minutes (never at the price of a class degrade), and a fourth rescue within the hour on an Anthropic lane chain-waits up to 30 minutes first (rule 3). Every wait is recorded once on entry and once on exit in `$REG/<id>.rescuewait` and `swap.log`, and `deploy/measure-continuity.py --stage 4` reads the §9 stage-4 rows back.

**Architecture:** One new section of `ccd/ccd`, `# ── THE RESCUE POLICY`, inserted directly above `_strand_clear() {` — below the frozen citation corpus AND below README's two `ccd/ccd` anchors — holding every new function and constant. Everything above the corpus is reached through LINE-NEUTRAL edits of existing lines (one line becomes one line), so the citation census does not move (measured: `147 / 195 / 53 / 35`, base = tree). Six mechanisms: (1) `_transcript_limit_banner <path> newest`, the DATING read — the same window and the same row predicate (one copy of the detector literal), answering the newest rate-limit row with its own timestamp; (2) `_tscan_measure`, so the transcript arm's cache records `2` for a transcript nobody could read; (3) `_limit_dated_verdict`, the last word of every positive rung, which can only take a positive away and only on proof; (4) `_swap_landed`, called by `cmd_swap` alone; (5) `_rescue_policy`, one call on `_auto_swap_check`'s verdict line, below both cooldown gates, answering PROCEED or HOLD; (6) `_rescue_target`, which wraps `_swap_target` for a rescue only and passes it a `SWAP_TARGET_SKIP` list the candidate walk and the home-return branch honour.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `set -uo pipefail`, no `-e`), python 3 (the transcript reader and `_rescue_history` run inline under `python3 -c '…'` inside a SINGLE-quoted bash string — no `'` may appear in them), TypeScript + vitest 4.1 (tests), python 3 (`deploy/measure-continuity.py`, read-only).

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md` — §5.4 rules 1–3 and their tests list (NOT the refusal of non-rescue swaps, `--cut-delegated` or its 409: that is wave 7); §1.2 (the rescue-timing table and mechanism 6); §3 C6 (slug `rescue-waits-near-reset`), C12 (slug `carried-in-banner-is-not-a-block`), C13 (the 600 s bound); §8 (the carried-in, real-block-reads-as-carried-in, near-reset wait and chain wait bullets); §9's stage-4 rows except "non-rescue swaps that cut delegated work"; §11 item 3. Programme ledger: `docs/superpowers/programs/session-continuity.md` (wave 2). Evidence for the defect, cited and not re-derived: the planning session's `rescues.json` (field `banner_predates_landing`) — 32 of 248 rescues `true`, 25 of them `via=transcript` and 7 `via=pane(silent)`.

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST, `ccd` only.** Nothing here touches `server/src`, `agent/src`, `shared/` or the PWA. `ccd/` reaches the fleet box through `ccrc rollout` in its DEFAULT order (fleet box first) — never `--server-first`. Task 6 restates it.
- **Waves 1–4 each edit `ccd/ccd` and land one at a time** (programme ledger): this wave lands on current `main` by a `git merge` whose only permitted conflict is `ccd/ccd`'s line-2 provenance stamp (every edit to the file changes it, so once another wave has landed it ALWAYS conflicts; the merge block in Task 1 Step 0 and Task 6 Step 1 resolves that one hunk by re-stamping and stops on any other), re-stamps, and re-measures the citation corpus and the `_reg_get` census ON THE MERGED TREE before its final gate, which runs on the merged tree (Task 6, Steps 1–2).
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly. The only live reads this wave makes are Task 5's read-only instrument run over `~/.cc-sessions/swap.log` and Task 6's post-deploy checks, all `cat`/`ls`/`python3` that open nothing for writing. NEVER print secret file CONTENTS.
- **This wave changes a verdict every rescue and strand decision runs on.** Every edit that can take a positive AWAY from `_session_hard_blocked` does so only on PROOF (a dated row strictly older than `.landed`); every condition it cannot measure keeps today's verdict. Every wait is bounded (`RESCUE_WAIT_BOUND + RESCUE_WAIT_GRACE` for the near wait, `RESCUE_CHAIN_WAIT` for the chain wait) except the two the spec makes unbounded on purpose — the no-room wait (today's `stranded`) and the hold after a reset turned, which holds only a pane whose auto-continue is ARMED — and each of those is named in Review lens 1 (`xhigh`).
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`); its `sh()` routes every bash spawn through `ghContainedEnv(home, env, { systemd: true, tmux: true })`, which `ccd-workspaces.test.ts`'s scan ("routes EVERY bash call site in every ccd test file through ALL THREE poisons") requires of every `ccd-*.test.ts` file. `measure-continuity-stage4.test.ts` spawns `python3`, never bash, outside `h.sh`.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000ms, ONE at a time.** The fleet box is memory-bound (programme ledger); the server suite runs as twelve sequential shards in Task 6, never two at once.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`. Measured at planning: `typecheck-tests`' case "PWA_TSC really is pwa's own installed compiler" reds in a worktree whose `pwa/node_modules` is a SYMLINK into another checkout — an environment artifact, green on a real `npm ci`.
- **Rings / no overloaded null.** `_transcript_limit_banner newest` answers three codes; `_tscan_measure` three answers (`1`/`0`/`2`, unread never folded into `0`); `_rescue_history` answers measured (rc 0, possibly an empty history) or unmeasurable (rc 2) — an absent swap log is a MEASURED empty history, an unreadable one is not.
- **Wire discipline.** No frame changes, `FLEET_PROTO` untouched. The `auto-rescue` swap.log line gains APPENDED tokens (` reset=`, ` type=`, ` row=`) only when a row was dated, so every line shape the fleet's log already carries is unchanged when nothing was dated; no server code parses `swap.log` (measured: `grep -rn 'auto-rescue' server/src agent/src shared deploy` → no hits at `905360dc`).
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated, measured before/after. Every row in this plan was measured on a prototype of exactly these edits at `905360dc` (all of Tasks 1–5 applied) — and every row the review revision added or changed was re-measured on a prototype of the REVISED edits at `af64d9d2`, whose `ccd/ccd` and test files are byte-identical to `905360dc`'s (that range touches only plan and spec documents) — each mutation applied to a saved copy of the prototype file and restored from that copy — never `git checkout -- <path>`, which restores to HEAD. Where a row's red names a case that a LATER task adds, the red at the task's own commit is the subset in the describe blocks that exist by then; re-measure at your commit and quote what you get.
- **`ccd/ccd` is a provenance-STAMPED file** (line 2 is `# ccrc:generated 1 sha256=…`). **Every task that edits `ccd/ccd` re-stamps before running any suite**, or `server/test/ownership.test.ts` reds:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **The citation tax (S6-R11) is owed by every CITED file.** Measured for this wave's files at planning (`grep -oE '(ccd/ccd)?:[0-9]+'` over the two corpus documents and `README.md`, the file prefix OPTIONAL): the corpus cites `ccd/ccd` up to `:19131`; README carries exactly two `ccd/ccd` anchors, `:21202` (`cmd_ensure`'s `_reg_generation_init "$id"`) and `:19989-19991` (`genrc == 1`). **Every edit this wave makes above `:19131` is LINE-NEUTRAL** (`_session_hard_blocked`, `_pane_limit_banner`'s D-3100 sentence, `_auto_swap_check`, `_swap_target`, `_reg_purge`'s inventory, `_reg_get`'s census) — measured: the census does not move. The one edit between `:19131` and `:21202` — Task 1's `newest` mode in `_transcript_limit_banner` (≈20279, +16 lines) — moves README's `cmd_ensure` anchor (`21202 → 21218` measured), which the re-pointer repairs by content. Everything else sits below `:21218`. `README.md` is edited in Task 5 (prose only, no `file:line` token), and `session-hook.test.ts` is not edited.
- **The `_reg_get` census.** Every task that adds `_reg_get` calls re-measures `ccd-reg-get-census.test.ts`'s sentence in THAT task with the header's two commands, rewrites it in place with no new cardinal within 25 of the census, and names the mover. At `905360dc` it reads 156/132; Task 2 adds three (159/135), Task 3 four (163/139), Tasks 1 and 4 none.
- **Locate code by CONTENT.** Line numbers are "at `905360dc`" and are hints, never addresses. Waves 1, 3 and 4 of this programme and the landing-order programme edit the same file.
- **Shell state does not survive between Bash calls.** Every block that names `$SCRATCH` sets it itself (`SCRATCH=<your scratchpad, absolute>`). Never run half a block; an empty `$SCRATCH` points every path at `/`.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch. One commit per task.
- **Commit trailers:** end every commit message with the attribution line your own session is given. The heredocs below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs or account names** anywhere in a committed file (`topology-clean.test.ts`). Fixture account ids are the test roster's (`claude`, `claude-a`, `claude-b`, `claude-d`, `gpt`).
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section. The two amendments this wave implements were issued their numbers at plan time — D-3497 (`carried-in-banner-is-not-a-block`) and D-3498 (`rescue-waits-near-reset`) — and are defined under Deviations found; code comments cite those numbers.

---

## Review Focus

Five inputs or failure modes the spec implies and no task in its first draft tested. Each is now a named case in its owning task, red when its guard is removed (measured):

1. **A stale reset from the previous tick.** `cmd_supervise` runs every tick in ONE long-lived shell, so a verdict global a tick did not set is the last tick's; a stale `HARD_BLOCK_RESET` would park a session on a reset that came and went. → Task 2, "the verdict's globals are cleared on every call" (mutation row 2.8).
2. **Two accounts sharing a reset epoch.** Five-hour resets land on shared boundaries; a `turned` record written on one account must not hold the session after it moved to another. → Task 3, "a turned record on ANOTHER account does not hold this one" (row 3.9).
3. **`RESCUE_WAIT_BOUND=0` inside the grace window.** The wait window runs from `R − BOUND` to `R + GRACE`; with the bound at 0 the grace half would still wait unless the switch is explicit. → Task 3, "RESCUE_WAIT_BOUND=0 turns the wait off INSIDE the grace too" (row 3.3).
4. **The no-room wait flapping back into a chain wait.** After a chain wait expires with no room, the session's hour still holds three rescues; each tick would re-open a chain wait over the no-room one. → Task 4, "a chain wait at its bound with no target that has room becomes the no-room wait" ticks twice (row 4.6).
5. **The home-return branch bypassing "do not bounce".** `_swap_target`'s forced path returns HOME before its candidate walk whenever home's telemetry looks fine — and telemetry lags a limit (§1.2: at least 123 targets blocked before the source's reset). → Task 4, "the home-return branch honours the skip too" (row 4.2).

Five more, found by the plan's adversarial review (each measured on a prototype of the first draft, then fixed and pinned):

6. **A STALLED session whose wait crosses its own reset.** The first draft ended every no-room and chain wait `turned` at `R + RESCUE_WAIT_GRACE` and held on that reset for good. Nothing re-sends a stalled turn in place (`_redrive_after_spawn` types only on the unsubmitted resume pair; `_auto_stale_check` presses Enter only on an armed continuation's stale-phase sentence), so the session idled on its reset account forever, even with room elsewhere — where today's code rescues it as soon as another target has room. → Task 3, "a STALLED no-room wait across its own reset is rescued once a target has room, not held" and "a STALLED session whose closed turned record names this reset is rescued"; Task 4, "a STALLED chain wait whose account reset ends turned and the tick rescues, with no second chain wait" (rows 3.16, 4.9).
7. **A rate-limit row written AFTER its own `resetsAt`.** Real on this fleet (a read-only 14-day survey found 6 `five_hour` and 4 `seven_day` rows whose `resetsAt` was 10 hours to 8.5 days before their own timestamp). The row proves the account did not turn, yet a wait keyed on its stale reset would end `turned` and hold. → Task 3, "a row written AFTER its own resetsAt never parks…", "armed, a row newer than its reset: no near wait", and "a rate-limit row written after the reset with the SAME resetsAt ends the wait in a swap" (row 3.17).
8. **A chain wait on a lane that is not Anthropic's, or on lost auth.** A Codex-lane hold returns before the rescue arm writes the lane's only "pool is full" signal (`$LIMITS_DIR/<wrapper>.json`), so other sessions keep landing on the exhausted lane; an auth-failure pane has no reset to wait for. → Task 4, "a Codex-lane session on its fourth rescue in the hour is rescued at once, and its exclusion is written" and "an auth-failure pane is never chain-waited" (rows 4.10, 4.11).
9. **Spread bought with a class degrade.** `_swap_target` answers rc 6 (a name one rung DOWN) when the only same-class target with room is the one spread skipped; the first draft took that answer. → Task 4, "spread never buys a class degrade…" (row 4.12).
10. **A merge that always conflicts.** Every `ccd/ccd` edit changes line 2's provenance stamp, so the first draft's "stop on any `ccd/ccd` conflict" stopped every time another wave had landed. → Task 1 Step 0 and Task 6 Step 1 resolve exactly that one hunk by re-stamping.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `ccd/ccd` | Modify — a new section `# ── THE RESCUE POLICY` directly above `_strand_clear() {` (Tasks 1–4); `_transcript_limit_banner`'s `newest` mode (Task 1); line-neutral edits in `_session_hard_blocked` (Tasks 1–2), `_pane_limit_banner`'s header (Task 2), `_auto_swap_check` (Tasks 3–4), `_swap_target` (Task 4), `_reg_purge`'s inventory (Tasks 2–3), `_reg_get`'s census (Tasks 2–3); one line in `cmd_swap` (Task 2) | The verdict, the waits, the spread |
| `README.md` | Modify — the re-pointer (Task 1); one amended sentence, one word, one new subsection (Task 5) | Operator anchors, and the canonical description of the new behaviour |
| `server/test/ccd-limit-banner.test.ts` | Modify (Task 1) — a `newest`-mode describe; the cache describe's stub ignores the dating read; its two unread cases now expect `2` | The dating read, and the cache's three answers |
| `server/test/ccd-rescue-policy.test.ts` | Create (Task 2), extend (Tasks 3, 4) | Rules 1–3, each guard red when removed |
| `deploy/measure-continuity.py` | Create or extend (Task 5) | §9's stage-4 rows, read-only |
| `server/test/measure-continuity-stage4.test.ts` | Create (Task 5) | Each row counts what it says; each regex is bound to the real ccd line |

**Not modified, deliberately:** `server/src/**`, `agent/src/**`, `shared/**`, `pwa/**` (no wire, no reader — §9's instrument reads the log); `ccd/ccrc-doctor-checks` (see Pre-flight finding 9); `server/test/session-hook.test.ts` (the census does not move); the swap refusal path and every destructive verb.

---

## Pre-flight findings (measured while planning; not deviations)

Measured on a prototype of this plan's exact edits in an isolated worktree at `905360dc` (`origin/main` `a3a93b41` plus the two approved specs and the programme ledgers).

1. **The spec's "existing redrive fallback runs in place" types nothing for a waiting session.** `_redrive_after_spawn` types `RESUME_PROMPT` only while `_transcript_stalled_pair` says the transcript's newest real turn is the unsubmitted resume pair (`Continue from where you left off.` + synthetic `No response requested.`). A session waiting on a limit banner has the banner (or a later turn) newest, so the fallback stands down on its first check, silently (`fromswap 0`). Measured: Task 3's "GRACE after the reset with no newer row" case records zero `tmux send-keys`. Called anyway — through its own gate, unchanged — because §6 forbids any keystroke outside that fallback's conditions.
2. **Hence the near wait requires an ARMED auto-continue.** A STALLED session (auto-resume off, re-arm cap hit, a human's Esc) has nothing that re-sends its turn at the reset and, by finding 1, nothing ccd may type; a wait would park it idle on an account that has reset. Mechanism 5 names the cost D-2236 pays as "the wait for one whose reset is minutes away" — the session Claude Code continues itself — and rule 2 says the wait "leaves Claude Code's armed auto-continue alone". So `_rescue_policy` enters a near wait only when `_pane_auto_continue_armed` holds on the tick's pane; a stalled session is rescued as today. Armed panes are current on this fleet: `swap.log` carries `compact-skip … auto-continue` lines every day 2026-09-09..09-23 (3 on 09-23). **The same reasoning governs how a wait ENDS at its reset** (the review's resolution of the spec gap the orchestrator left open): at `R + RESCUE_WAIT_GRACE` a wait ends in place and holds on that reset only while the pane is ARMED. A STALLED pane is rescued as today — a near or chain wait ends `turned` and the tick proceeds to a swap to a target with room (skipping the just-left accounts), and a no-room wait stays open and ends in a swap the moment a target gains room, which is today's strand. Today (measured on unmodified `ccd/ccd`) a stalled session on a reset account idles only until ANOTHER target has room: the forced `_swap_target` never offers the current account (its walk skips `cur`, its home-stay branch needs `-z "$force"`), and `cmd_swap` refuses target == cur. That swap's `--resume` spawn is the only re-send path that types nothing but the existing constant (`CLAUDE_CODE_RESUME_INTERRUPTED_TURN`, else `RESUME_PROMPT` through `_redrive_after_spawn`'s own gate). `RESUME_PROMPT` cannot be typed in place: it tells the model ccd restarted the session and its background work "is gone", which would be false. Recorded in `D-3498`'s definition; the residual — a stalled session whose own account is the only one with room — was the plan's open question 1, RULED 2026-09-24 (spec §11 item 6): leave it as today and count it, through Task 5's four `noroom_…` rows.
3. **`ccd-swap-pin.test.ts` pins the `auto-rescue` line INLINE in `_auto_swap_check`, above the pin check.** A first draft that moved the line into a helper redded "the pin check sits ABOVE the hold and BELOW the rescue dispatch" (`the rescue log line moved or was renamed: expected -1 to be greater than 0`). The line stays inline and gains `$(_rescue_line_extra)` and a `; _rescuewait_close "$id" swap` tail — one line for one line.
4. **The python inside `_transcript_limit_banner` is a single-quoted bash string.** A first draft printed `'-'` inside it, which closed the quote: 15 `ccd-limit-banner` cases redded with `expected { rc: '1', out: '' }`. The placeholder is `chr(45)`, and `_rescue_history`'s python avoids `'` and backslash-in-f-string (3.12-only) forms.
5. **The dating read shares `_transcript_limit_banner`, so the cache describe's stub counted it.** Three D-2444 cases redded on read counts (`expected [ 'transcript-read', …(2) ] to have a length of 1 but got 3`). The stub now answers `newest` separately (rc 1, "no rate-limit row", which keeps every verdict) — the cache is still measured on the banner read it caches; the dating read is uncached by design. Two further cases asserted the old fold (`caches an unreadable transcript as a negative verdict`, `expected '… 2' to match /^\d+ 0$/`) and are rewritten to the spec's `2`.
6. **The `_reg_purge` inventory window.** `ccd-auto-swap-pool.test.ts` reads 2400 characters from "The dot-free claim…" and needs `` `strandnotify` `` inside it. At `905360dc` it starts at 2274; with this wave's three names and the count sentence in place, 2345 (measured) — 41 characters of headroom left for the next wave.
7. **`swap.log` size, for rule 3's read bound.** Read-only `stat`/`wc` at planning: 2,229,986 bytes, 19,554 lines since 2026-07-03; busiest hour 233,896 bytes, p99 hour 20,263, median 1,122. `RESCUE_LOG_TAIL_BYTES=1048576` covers more than four of the busiest hours; a short read can only undercount history, which is today's behaviour.
8. **The instrument's baseline on the live log** (read-only, `--since 2026-09-08 --until 2026-09-24`): 248 rescues; 4 sessions with 4 or more auto-rescues inside an hour; max 4. Every other stage-4 row reads 0 because no line carries this wave's words yet.
9. **Doctor does not read `.rescuewait` in this wave.** §5.4's tests list says the record "is read by ccd's own entry/exit dedupe and by doctor"; §7's surfaces table gives doctor stage-6 work only, and this wave's brief does not scope a doctor check. The record's grammar is fixed here (`state= kind= since= reset= wrapper=`, plus `until= end=`) so a doctor reader can be added without touching ccd; it is reported as a spec gap, not built.
10. **Red-first, measured.** With Tasks 1–5's tests in place (as revised after review) and `ccd/ccd` at `af64d9d2` (byte-identical to `905360dc`'s), `ccd-rescue-policy` + `measure-continuity-stage4` run `36 failed | 25 passed (61)` (35 of 60 before the stage-4 file's sixth case, added 2026-09-24 with §11 item 6's count; that file alone measured `5 failed | 1 passed (6)` with no instrument present): every rule's guard red, every regression control green on today's code and still green after — no `.landed`, equal seconds, unreadable transcript, no rate-limit row, auth (rule 1), refused swap, purge, `seven_day`, bound 0 (both), outside the bound, stalled, non-Anthropic, no reset, a turned record on another account, a STALLED session with a turned record on this reset, a row written after its own reset (both), least-used control, a passed logged reset, spread-as-preference, unreadable log, the Codex-lane fourth rescue, the auth pane with three rescues, and the landing-line source pin. On the full revised prototype: `ccd-rescue-policy` 55/55, `measure-continuity-stage4` 6/6 (the sixth case and the four `noroom_…` rows measured 2026-09-24 against the first-draft prototype's `ccd/ccd`, whose `RESCUE_WAIT_GRACE=120` line and wait lines this plan keeps), `ccd-limit-banner` 60/60, `ownership` 14/14, `ccd-reg-get-census` 3/3.

---

## The citation tax, mechanised (S6-R11)

`server/test/session-hook.test.ts` audits every `file:line` citation in two FROZEN corpus documents (`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`, `docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`) and in `README.md`. The standing rule S6-R11: **README is REPAIRED, by content, never counted; everything else is RE-MEASURED from the instrument, with the composition stated; no rule is widened and no D-number is spent.** This wave's forecast is that nothing but README's `cmd_ensure` anchor moves; the tools below are how that is proved rather than asserted.

The two tools are the exemplar's, VERBATIM — `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md`, "The citation tax, mechanised": `repoint-readme.py` (re-points README's two `ccd/ccd` anchors by the bytes their sentences quote) and `cite-remeasure.py` (runs the citation cases at `<base-ref>` and on the tree, prints stated/base/tree and the composition, and with `--write` rewrites exactly four literals). They are measurement instruments, never committed. Extract them by CONTENT — never by typed line numbers — into your scratchpad (`$SCRATCH`, an ABSOLUTE path):

- [ ] **Extract both tools from the exemplar**

Write this extractor to `$SCRATCH/extract-tools.py`:

```python
import re, sys
text = open(sys.argv[1], encoding='utf8').read()
blocks = re.findall(r"```python\n(#!/usr/bin/env python3\n.*?)```", text, re.S)
want = {'repoint-readme.py': '"""Re-point README.md', 'cite-remeasure.py': '"""Re-measure session-hook.test.ts'}
for name, head in want.items():
    hits = [b for b in blocks if b.split('\n')[1].startswith(head)]
    assert len(hits) == 1, (name, len(hits))
    open(f'{sys.argv[2]}/{name}', 'w', encoding='utf8').write(hits[0])
    print(name, len(hits[0].splitlines()), 'lines')
```

then run it from the repo root:

```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] || echo "STOP: SCRATCH is not an absolute directory"
python3 "$SCRATCH/extract-tools.py" docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md "$SCRATCH"
```

Expected: `repoint-readme.py 30 lines` and `cite-remeasure.py 113 lines` (measured at planning; the two extracted files were byte-identical to the copies this plan's forecasts were measured with). The re-pointer asserts README carries exactly its two known anchors and refuses any third; the re-measurer asserts it restored every file it touched byte-for-byte.

**The procedure, per `ccd/ccd`-editing task** (each task restates it as numbered steps):

1. Re-stamp `ccd/ccd`.
2. `SCRATCH=<abs path>; python3 "$SCRATCH/repoint-readme.py"` — README first.
3. `SCRATCH=<abs path>; python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD` — read-only. **If any `base` value differs from its `stated` value, the tree was red before your edit: stop and report it.** Then compare `tree` with the task's forecast.
4. Only if something moved: re-run with `--write`, write the S6-R11 composition comment, run the citation cases green. (Forecast for every task in this wave: nothing moves.)
5. **Both corpus documents byte-identical to `origin/main`:**

       git fetch origin main && git diff --quiet origin/main -- \
         docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
         docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen

   Expected: `corpus-frozen`.

Measured at planning on the full prototype: `byFile['ccd/ccd'] stated 147 base 147 tree 147`, `total 195/195/195`, row array `53/53/53`, site array `35/35/35`, every `ENTERED`/`LEFT` empty; the re-pointer printed `cmd_ensure mint -> ccd/ccd:21218` and `genrc == 1 arm -> ccd/ccd:19989-19991`.

---

### Task 1: The dating read, and a cache that keeps "unread" distinct

**Model routing:** `sonnet`, effort `high` — the transcript reader is shared by the rescue arm and the strand verdict.

**Files:**
- Modify: `ccd/ccd` — `_transcript_limit_banner` gains a `newest` mode (≈20279); the new section header, its constants and globals, and `_tscan_measure`, inserted directly above `_strand_clear() {` (≈21841); two line-neutral edits in `_session_hard_blocked` (≈16612)
- Modify: `README.md` (by the re-pointer)
- Test: `server/test/ccd-limit-banner.test.ts`

**Interfaces:**
- Consumes: `_transcript_limit_banner`'s default mode, unchanged (its callers: `_tscan_measure`, and D-2363's tests).
- Produces: `_transcript_limit_banner <path> newest` → rc 0 + `"<rowEpoch>\t<resetsAt>\t<rateLimitType>"` of the NEWEST rate-limit row in the `REDRIVE_TAIL_LINES` window, whatever followed it, `-` for any field the row lacks | rc 1 no rate-limit row in the window | rc 2 unreadable. `_tscan_measure <id>` → stdout `1` (banner newest) | `0` (read, no banner newest) | `2` (not read: no transcript path, or `_transcript_limit_banner` rc 2), always rc 0. `$REG/<id>.tscan` = `"<epoch> <0|1|2>"`, read back when `^[012]$`. The section constants `RESCUE_WAIT_BOUND`, `RESCUE_WAIT_GRACE`, `RESCUE_CHAIN_COUNT`, `RESCUE_CHAIN_WINDOW`, `RESCUE_CHAIN_WAIT`, `RESCUE_SPREAD_WINDOW`, `RESCUE_LOG_TAIL_BYTES`, `PANE_AUTH_RE`, and the globals `HARD_BLOCK_RESET`, `HARD_BLOCK_TYPE`, `HARD_BLOCK_ROWTS`, `HARD_BLOCK_WHY`, `RESCUE_COUNT`, `RESCUE_SKIP_LEFT`, `RESCUE_SKIP_RECENT`, declared at top level so a stub of `_session_hard_blocked` in any other test file leaves them set under `set -u`.

- [ ] **Step 0: Merge current `main` and prove the citation cases green before any edit**

THE MERGE BLOCK — used here and again in Task 6 Step 1. Every edit to `ccd/ccd` rewrites line 2 (`# ccrc:generated 1 sha256=…`), so once another wave's `ccd/ccd` edit has landed on `main` a merge ALWAYS conflicts on that line, even when no other line does (measured: `git merge-file` of a re-stamped prototype against a base plus one unrelated re-stamped line change answers rc 1 with its only hunk at lines 2–6). The block resolves exactly that hunk — deleting it and re-stamping writes the merged body's own sha, which is what `shared/mark.mjs`'s `markGenerated` produces from any body — and stops on anything else. Measured at `af64d9d2` on this plan's full prototype against a base plus one re-stamped unrelated line: the predicate below matched, the resolution left `bash -n` clean, and the merged body differed from the prototype's by exactly the other side's one line. `-c merge.conflictStyle=merge` pins the two-sided marker shape the line checks read (a `diff3` style would add a third section):

```bash
git fetch origin main || echo 'STOP: the fetch failed — report it'
if ! git -c merge.conflictStyle=merge merge --no-edit origin/main; then
  if [ "$(git diff --name-only --diff-filter=U)" = ccd/ccd ] && [ "$(grep -c '^<<<<<<< ' ccd/ccd)" = 1 ] \
     && sed -n 2p ccd/ccd | grep -q '^<<<<<<< ' && sed -n 4p ccd/ccd | grep -q '^=======$' \
     && sed -n 6p ccd/ccd | grep -q '^>>>>>>> ' \
     && sed -n 3p ccd/ccd | grep -q '^# ccrc:generated 1 sha256=' && sed -n 5p ccd/ccd | grep -q '^# ccrc:generated 1 sha256='; then
    sed -i '2,6d' ccd/ccd   # the ONE conflict is the provenance stamp; the re-stamp below writes the merged body's own
    node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
      const { markGenerated } = await import('./shared/mark.mjs'); \
      writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
    git add ccd/ccd && git commit --no-edit && echo 'merged: the stamp hunk resolved by re-stamping'
  else
    echo 'STOP: a conflict other than the ccd/ccd stamp line — report it'; git merge --abort
  fi
fi
git log -1 --format='%h %s'
```

Then prove the citation cases green before any edit:

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: the merge succeeds (`Already up to date.` if `main` has not moved past this plan's base; `merged: the stamp hunk resolved by re-stamping` if another wave's `ccd/ccd` edit landed) and `7 passed | 326 skipped`. On `STOP`, stop and report. If `main` moved (another wave of this programme landed), every line number and census figure below is a hint and the instruments are the authority.

- [ ] **Step 1: Write the failing tests**

In `server/test/ccd-limit-banner.test.ts`, insert this describe directly above `describe('_transcript_stalled_pair pairs -f with -r (D-2370, closing D-2347)', () => {`:

```ts
// ── `newest` mode: the dating read (session-continuity §5.4 rule 1) ──────────
// The same window and the same row predicate as the banner read — one copy of
// the detector literal — answering the NEWEST rate-limit row whatever followed
// it, with that row's own timestamp, because a pane positive is dated by it.
describe('_transcript_limit_banner newest (the dating read)', () => {
  const newest = (p: string): { rc: string; out: string } => {
    const raw = h.sh(`out=$(_transcript_limit_banner ${JSON.stringify(p)} newest); rc=$?; printf '%s|%s|' "$rc" "$out"`);
    const i = raw.indexOf('|');
    return { rc: raw.slice(0, i), out: raw.slice(i + 1, -1) };
  };
  it('prints "<rowEpoch>\\t<resetsAt>\\t<rateLimitType>" of the banner row', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(newest(p)).toEqual({ rc: '0', out: `${Date.parse('2026-09-10T10:12:21Z') / 1000}\t1789430400\tseven_day` });
  });
  it('a real turn AFTER the banner does not hide it — the default mode answers rc 1 there, this one does not', () => {
    seed(); const p = writeTranscript([L.banner(), L.assistant()]);
    expect(detect(p).rc).toBe('1');
    expect(newest(p).rc).toBe('0');
  });
  it('the NEWER of two rate-limit rows wins', () => {
    seed(); const p = writeTranscript([L.banner(), L.assistant(), L.banner({ timestamp: '2026-09-10T11:00:00.000Z', quotaLimits: { resetsAt: 1789999999, rateLimitType: 'five_hour' } })]);
    expect(newest(p).out).toBe(`${Date.parse('2026-09-10T11:00:00Z') / 1000}\t1789999999\tfive_hour`);
  });
  it('a field the row lacks prints `-`, never an empty field a tab-split would collapse', () => {
    seed(); const p = writeTranscript([L.banner({ timestamp: 'not-a-time', quotaLimits: undefined })]);
    expect(newest(p)).toEqual({ rc: '0', out: '-\t-\t-' });
  });
  it('no rate-limit row in the window: rc 1; no transcript: rc 2', () => {
    seed(); const p = writeTranscript([L.human(), L.assistant()]);
    expect(newest(p).rc).toBe('1');
    expect(newest(path.join(h.home, 'nope.jsonl')).rc).toBe('2');
  });
  it('the detector literal is still spelled ONCE in ccd/ccd — the dating read shares it', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src.split('row.get("error") == "rate_limit"').length - 1).toBe(1);
  });
});
```

In the same file's `describe('the transcript verdict is cached per session (D-2444)', …)`, replace the stub line

```ts
    _transcript_limit_banner() { echo transcript-read >> "$HOME/ccd-calls"; return ${verdict}; };
```

with

```ts
    _transcript_limit_banner() { [[ "\${2:-}" == newest ]] && { echo dating-read >> "$HOME/ccd-calls"; return 1; }; echo transcript-read >> "$HOME/ccd-calls"; return ${verdict}; };
```

and replace the contiguous span from the line `  it('caches an absent transcript as a negative verdict', () => {` through the second case's `    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 0$/);` — the WHOLE first case, the blank line after it, and the first four lines of `'caches an unreadable transcript as a negative verdict'`, eleven lines in all — with:

```ts
  // UNREADABLE IS NOT "NO ROW" (session-continuity §5.4 rule 1). Both answer
  // "not blocked" — today's behaviour — but the cache records 2, never 0, so a
  // transcript nobody could read is never remembered as one read and found clean.
  it('caches an absent transcript as UNREAD (2), distinct from a read with no banner (0)', () => {
    seed();
    expect(verdict(stub(0, false))).toBe('rc=1');
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 2$/);
    expect(reads()).toEqual([]);
  });

  it('caches an unreadable transcript as UNREAD (2), and honours it like a negative', () => {
    seed();
    expect(verdict(stub(2))).toBe('rc=1');
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 2$/);
```

(the second case's remaining three lines — `expect(reads()).toHaveLength(1);`, `expect(verdict(stub(0))).toBe('rc=1');`, `expect(reads()).toHaveLength(1);` — stay as they are).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-limit-banner.test.ts`

Expected: FAIL — four `newest` cases red (`newest` is ignored today, so the default mode answers: no epoch, and rc 1 behind a later turn) and the two rewritten cache cases red on `/^\d+ 2$/`. Two pass today and must stay green: "no rate-limit row in the window: rc 1; no transcript: rc 2" (the codes the default mode already gives) and the literal-count case ("spelled ONCE").

- [ ] **Step 3: Add the `newest` mode to `_transcript_limit_banner`**

Locate `grep -n '^_transcript_limit_banner() {' ccd/ccd` (≈20279). Make exactly these edits inside that function, each located by content:

(a) the header line becomes

```bash
_transcript_limit_banner() {   # transcript-path [newest] -> 0 the newest real row is a rate-limit banner (prints "<resetsAt>\t<rateLimitType>") | 1 not | 2 unreadable (D-2362, D-2456); `newest`: 0 + "<rowEpoch>\t<resetsAt>\t<rateLimitType>" of the NEWEST rate-limit row in the window, `-` for a field it lacks | 1 none
```

(b) directly above `  local f="$1" rows rc` insert

```bash
  # `newest` MODE (continuity §5.4 rule 1) is the DATING read: the same window
  # and the same row predicate — ONE copy of the detector literal — but it
  # answers the newest rate-limit row whatever came after it, with that row's
  # own timestamp, because a pane positive is dated by it and a later turn does
  # not make an earlier banner newer. The default mode is byte-for-byte unchanged.
```

(c) `import json, sys` → `import calendar, json, sys, time`; `found = None` (the first one, above the loop) → `found = newest = None`; inside the rate-limit branch `        found = row` → `        found = newest = row`;

(d) directly above `if found is None:` insert

```python
if sys.argv[1:] == ["newest"]:
    found = newest
```

(e) directly above the final `print(f"{reset}\t{kind if isinstance(kind, str) else chr(0)}".rstrip(chr(0)))` insert

```python
if sys.argv[1:] == ["newest"]:
    stamp = found.get("timestamp")
    try:
        epoch = str(calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))) if isinstance(stamp, str) else "-"
    except ValueError:
        epoch = "-"
    kind = kind if isinstance(kind, str) and kind else "-"
    print(f"{epoch}\t{reset or chr(45)}\t{kind}")
    raise SystemExit(0)
```

(f) the closing `' 2>/dev/null` of the `python3 -c` becomes `' "${2:-banner}" 2>/dev/null`.

No `'` may appear in anything added inside the python (Pre-flight finding 4). `-` rather than an empty field because the caller splits on a tab, which `read` treats as IFS whitespace and collapses.

- [ ] **Step 4: Insert the section header, its constants, and `_tscan_measure`**

Locate `grep -n '^_strand_clear() {' ccd/ccd` (≈21857 after Step 3). Insert this block immediately above that line (it ends with one blank line):

```bash
# ── THE RESCUE POLICY (session-continuity spec §5.4, rules 1–3) ─────────────
# Three rules sit between `_session_hard_blocked`'s verdict and the rescue
# arm's `_dispatch_swap`, and every one of them lives here, below the frozen
# citation corpus, reached from one-line call sites above it:
#   1. A CARRIED-IN BANNER IS NOT A BLOCK (C12). A resumed session re-renders
#      its conversation, the previous account's limit banner included, and
#      until it turns that banner is also the transcript's newest real row.
#      `cmd_swap` stamps `$REG/<id>.landed` ("<epoch> <wrapper>") after the
#      carry and before the unit starts, so every carried row is older than it
#      and every row the new process writes is not. A rate-limit row older than
#      the landing is not evidence of a block — on either arm: a PANE positive
#      is dated by the transcript's newest rate-limit row. Measured before this
#      existed: 32 of 248 rescues (2026-09-08..09-23) fired on a banner the
#      session carried in, 25 by the transcript arm and 7 by the pane.
#   2. WAIT NEAR THE CURRENT ACCOUNT'S OWN FIVE-HOUR RESET (C6, C13). The
#      rescue keeps `resetsAt`/`rateLimitType` from the dated row and, for a
#      `five_hour` block on an Anthropic backend whose reset is inside
#      `RESCUE_WAIT_BOUND`, leaves Claude Code's ARMED auto-continue alone.
#   3. SPREAD, DO NOT BOUNCE, AND CHAIN-WAIT a fourth rescue inside the hour.
# The waits are recorded in `$REG/<id>.rescuewait` and in swap.log — never
# under the word `hold`, which is the workspace-reap hold (`$REG/<id>.hold`).
#
# `~/.cc-limits` IS NOT A FALLBACK for the reset: it cannot say which window
# blocked, and a wait taken on the wrong window is a session parked for days.
# No dated row carrying both values means today's behaviour — swap.
RESCUE_WAIT_BOUND=600           # C13 — seconds before a five-hour reset inside which the rescue waits for Claude Code's own auto-continue; 0 turns the wait off
RESCUE_WAIT_GRACE=120           # seconds after that reset a wait holds for the continuation before it ends. ITS OWN CONSTANT, not STALE_PRESS_COOLDOWN, which paces keystrokes, not waits
RESCUE_CHAIN_COUNT=3            # rescues of ONE session inside RESCUE_CHAIN_WINDOW after which the next one chain-waits first
RESCUE_CHAIN_WINDOW=3600        # the window those rescues are counted in; also how long an account the session left blocked is skipped, unless its logged reset passes first
RESCUE_CHAIN_WAIT=1800          # the chain wait's own bound (spec §5.4 rule 3's 30 minutes, a knob)
RESCUE_SPREAD_WINDOW=600        # a target that received ANY session's rescue this recently is taken only when no other placeable target exists (§1.2: 136 of 244 rescues landed on a target another session had landed on within 10 min)
RESCUE_LOG_TAIL_BYTES=1048576   # swap.log bytes rule 3 reads. Measured 2026-09-23: the log's busiest hour wrote 233,896 bytes, p99 20,263; a short read undercounts, which is today's behaviour
PANE_AUTH_RE='Invalid API key|Please run /login'   # the auth-failure alternatives `_pane_hard_blocked` also matches — an auth failure keeps today's path and never reads a reset
HARD_BLOCK_RESET="" HARD_BLOCK_TYPE="" HARD_BLOCK_ROWTS="" HARD_BLOCK_WHY=""
RESCUE_COUNT=0 RESCUE_SKIP_LEFT="" RESCUE_SKIP_RECENT=""

_tscan_measure() {   # id -> the transcript arm's cacheable answer on stdout: 1 banner newest | 0 read, no banner newest | 2 NOT READ
  # THREE ANSWERS, because the spec keeps unreadable distinct from "no row"
  # (§5.4 rule 1): a transcript this box cannot name or read measured nothing,
  # and caching it as 0 said it had been read and found clean. The arm itself
  # still answers "not blocked" on 2 — today's behaviour — but the cache no
  # longer lies about why.
  local f rc
  f=$(_transcript_path "$1") || { echo 2; return 0; }
  _transcript_limit_banner "$f" >/dev/null; rc=$?
  case "$rc" in 0) echo 1 ;; 1) echo 0 ;; *) echo 2 ;; esac
}

```

- [ ] **Step 5: Two line-neutral edits in `_session_hard_blocked`**

The cache regex — replace `"$scan_verdict" =~ ^[01]$ \` with `"$scan_verdict" =~ ^[012]$ \` (one hit). Then replace these three lines

```bash
    if f=$(_transcript_path "$id") && _transcript_limit_banner "$f" >/dev/null; then
      verdict=1
    fi
```

with these three:

```bash
    verdict=$(_tscan_measure "$id")   # 1 banner newest | 0 read, none | 2 NOT READ — kept
    # distinct from 0 in the cache (continuity §5.4 rule 1); the arm answers "not
    # blocked" on both, and `_limit_dated_verdict` dates every positive below.
```

(`_limit_dated_verdict` arrives in Task 2; the comment names it now so the edit is not rewritten there. `[[ "$verdict" -eq 1 ]] || return 1` below it is unchanged and answers "not blocked" on `2`.)

- [ ] **Step 6: Re-stamp, then pay the corpus tax (S6-R11)**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
```

Expected: `syntax-ok`; the re-pointer prints `cmd_ensure mint -> ccd/ccd:<n>` (21218 at `905360dc`, moved by Step 3's 16 lines) and `genrc == 1 arm -> ccd/ccd:19989-19991` (unmoved); the re-measurer prints `stated == base == tree` on all four lines (`147 / 195 / 53 / 35`) and EMPTY `ENTERED`/`LEFT`. Then the corpus-frozen check (procedure step 5).

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-limit-banner.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: PASS (`ccd-limit-banner` 60/60 measured on the prototype); citation cases `7 passed | 326 skipped`. The census does not move in this task (`_tscan_measure` makes no `_reg_get` call).

- [ ] **Step 8: Mutation check, then commit**

Each row applied to a saved copy of this task's `ccd/ccd`, run, and restored from that copy. Measured on the prototype:

| # | Exact edit in `ccd/ccd` | Command | Expected red (measured) |
|---|---|---|---|
| 1.1 | delete the two lines `if sys.argv[1:] == ["newest"]:` / `    found = newest` | `./node_modules/.bin/vitest run test/ccd-limit-banner.test.ts` | "a real turn AFTER the banner does not hide it…" only — `expected '1' to be '0'` (1 failed, 59 passed) |
| 1.2 | `print(f"{epoch}\t{reset or chr(45)}\t{kind}")` → `print(f"{epoch}\t{reset}\t{kind}")` | same | "a field the row lacks prints `-`…" only — `expected { rc: '0', out: '-\t\t-' } to deeply equal { rc: '0', out: '-\t-\t-' }` |
| 1.3 | a second copy of the literal: split `        found = newest = row` so `newest` is assigned by its own `if row.get("error") == "rate_limit":` test | same | "the detector literal is still spelled ONCE…" only — `expected 2 to be 1` |
| 1.4 | in `_tscan_measure`, `{ echo 2; return 0; }` → `{ echo 0; return 0; }` | same | "caches an absent transcript as UNREAD (2)…" only — `expected '<epoch> 0' to match /^\d+ 2$/` |
| 1.5 | in `_tscan_measure`, `case "$rc" in 0) echo 1 ;; 1) echo 0 ;; *) echo 2 ;; esac` → `case "$rc" in 0) echo 1 ;; *) echo 0 ;; esac` | same | "caches an unreadable transcript as UNREAD (2)…" only — `expected '<epoch> 0' to match /^\d+ 2$/` |

```bash
git add ccd/ccd README.md server/test/ccd-limit-banner.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the dating read, and a transcript cache that keeps "unread" distinct

_transcript_limit_banner gains a `newest` mode: the same window and the same
row predicate (one copy of the detector literal, pinned), answering the NEWEST
rate-limit row whatever followed it, with its own timestamp, `-` for a field it
lacks. The default mode is byte-for-byte unchanged. The transcript arm's cache
now records 2 for a transcript nobody could read or name, never folded into 0
(session-continuity spec §5.4 rule 1); the arm still answers "not blocked" on
both. The cache describe's stub answers the (uncached) dating read separately.

Adds the RESCUE POLICY section header, its constants and globals, directly
above _strand_clear — below every frozen anchor. S6-R11: _session_hard_blocked's
two edits are line-neutral; the census did not move (147/195/53/35, base and
tree). README's cmd_ensure anchor re-pointed by content (moved by the reader's
16 lines).
MSG
)"
```

---

### Task 2: Rule 1 — `.landed`, and a carried-in banner is not a block

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `ccd/ccd` — `_hard_block_clear` and `_pane_auth_failed` inserted directly above `_tscan_measure() {`; `_limit_dated_verdict` and `_carried_in_note` directly below `_tscan_measure`'s closing brace; `_swap_landed` directly above `_strand_clear() {`; line-neutral edits in `_session_hard_blocked` (four lines), `_pane_limit_banner`'s header (three lines), `_reg_purge`'s inventory, `_reg_get`'s census; one new line in `cmd_swap`
- Modify: `README.md` (by the re-pointer; forecast: nothing moves)
- Test: `server/test/ccd-rescue-policy.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `_transcript_limit_banner <path> newest` and `_tscan_measure`.
- Produces: `$REG/<id>.landed` = `"<epoch> <wrapper>"`, written ONLY by `_swap_landed`, called ONLY by `cmd_swap`, after the carry and the wrapper flip and before the unit starts; absent = never swapped since this shipped. `_limit_dated_verdict <id> <pane>` → rc 0 still a block (`HARD_BLOCK_RESET`, `HARD_BLOCK_TYPE`, `HARD_BLOCK_ROWTS` set from the dated row when it postdates the landing, or when there is no landing) | rc 1 a carried-in banner (`HARD_BLOCK_WHY=carried-in`, `HARD_BLOCK_VIA` cleared). `$REG/<id>.carriednote` = the landing epoch last noted; `swap.log` gains `carried-in <id>: via=<pane|banner|transcript> rate-limit row at <ts> predates the landing at <landed> — not a block [wrapper=<w>]` once per landing. `_session_hard_blocked`'s callers see one verdict, dated, on both call sites (`_auto_swap_check`, `_tick_strand_undecidable`).

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-rescue-policy.test.ts`:

```ts
// The rescue policy (session-continuity spec §5.4, rules 1–3; wave 2).
//
// Three rules now stand between `_session_hard_blocked`'s verdict and the
// rescue arm's `_dispatch_swap`, and each case below is red when its guard is
// removed (the plan's mutation tables are the measurement):
//   1. a rate-limit row older than `$REG/<id>.landed` is not a block, on the
//      transcript arm AND on a pane positive the transcript dates;
//   2. a `five_hour` block whose reset is inside RESCUE_WAIT_BOUND, with Claude
//      Code's auto-continue armed, WAITS instead of swapping — recorded once on
//      entry and once on exit in `$REG/<id>.rescuewait` — and ends at the reset,
//      or RESCUE_WAIT_GRACE after it: in a swap only if a newer rate-limit row
//      exists, otherwise in place, never away from an account that just reset;
//   3. a rescue skips the account the session just left blocked, prefers a
//      target no rescue landed on in the last RESCUE_SPREAD_WINDOW, and a
//      fourth rescue inside the hour chain-waits first.
// Every fixture sits past SWAP_COOLDOWN (no `lastswap`, no `swapblocked`).
//
// FIXTURE HOME ONLY (`makeCcdHarness`): tmux, `_dispatch_swap` and — where a
// case is about the verdict rather than the choice — `_swap_target` are shell
// functions that LOG. `_avail` and `_swap_target` stay REAL in the rule-3 cases,
// steered through `~/.cc-limits`, because the skip list lives inside them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-rescue-policy-'); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const now = (): number => Math.floor(Date.now() / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();

const seed = (wrapper = 'claude'): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} home claude
        _reg_set ${ID} project demo
        _reg_set ${ID} workdir "$HOME/projects/demo"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
};
const land = (epoch: number, wrapper = 'claude'): void => { h.sh(`_reg_set ${ID} landed "${epoch} ${wrapper}"`); };

/** The row Claude Code appends on a 429 (the `ccd-limit-banner.test.ts` shape),
 *  with the three fields rule 1 and rule 2 read: its own timestamp, `resetsAt`
 *  and `rateLimitType`. */
const limitRow = (at: number, reset: number | null, type: string | null): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `b${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 9:10pm (UTC)" }] },
  isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  ...(reset === null && type === null ? {} : { quotaLimits: { status: 'rejected', ...(reset === null ? {} : { resetsAt: reset }), ...(type === null ? {} : { rateLimitType: type }) } }),
});
const turn = (at: number, text = 'Working on it.'): string => JSON.stringify({
  type: 'assistant', uuid: `a${at}`, timestamp: iso(at),
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text }] },
});
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};

/** Pane texts. ARMED is Claude Code's own auto-continue banner, matched by the
 *  REAL `_pane_hard_blocked` ("limit reached") and `_pane_auto_continue_armed`;
 *  STALLED is this year's banner with no continuation beside it (D-3100's rung);
 *  AUTH is lost auth, which `_pane_hard_blocked` also matches. */
const ARMED = 'Usage limit reached · continuing automatically at 9:10pm · esc to cancel\n❯ ';
const STALLED = "You've hit your session limit · resets 9:10pm (UTC)\n❯ ";
const PROMPT = '? for shortcuts\n❯ ';
const AUTH = 'Invalid API key · Please run /login\n❯ ';

/** tmux answers ONE pane for every capture; a draft never exists; the dispatch
 *  and every keystroke LOG. `target` stubs `_swap_target` (null = leave it real). */
const STUBS = (pane: string, target: string | null = 'claude-a'): string => `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
    capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; list-panes) echo 4242 ;; esac; return 0; };
  _pane_box_draft() { printf ''; };
  ${target === null ? '' : `_swap_target() { [[ -n ${JSON.stringify(target)} ]] && echo ${JSON.stringify(target)}; return 0; };`}
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
const tick = (pane: string, target: string | null = 'claude-a', env: Record<string, string> = {}): void => {
  h.sh(`${STUBS(pane, target)} _auto_swap_check ${ID}`, env);
};
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const keystrokes = (): string[] => h.calls().filter((l) => l.startsWith('tmux send-keys'));
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const logLines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const field = (rec: string | null, key: string): string | undefined =>
  rec === null ? undefined : new RegExp(`(?:^| )${key}=(\\S*)`).exec(rec)?.[1];
/** A swap.log line at `ago` seconds in the past, in the log's own LOCAL-time format. */
const pastLog = (ago: number, rest: string): void => {
  h.sh(`printf '%(%F %T)T %s\\n' "$(( $(date +%s) - ${ago} ))" ${JSON.stringify(rest)} >> "$REG/swap.log"`);
};

// ── RULE 1 — a carried-in banner is not a block ──────────────────────────────

describe('rule 1: a rate-limit row older than the landing is not a block (C12)', () => {
  it('a transcript banner row older than .landed produces no rescue, and says so once', () => {
    seed(); const t = now();
    writeTranscript([turn(t - 4000), limitRow(t - 3000, t + 9000, 'five_hour')]);
    land(t - 60);
    tick(PROMPT); tick(PROMPT);
    expect(dispatches()).toEqual([]);
    expect(logLines('carried-in'), swapLog()).toHaveLength(1);
    expect(logLines('carried-in')[0]).toContain('via=transcript');
    expect(h.reg(ID, 'carriednote')).toBe(String(t - 60));
  });

  it('a PANE positive whose newest rate-limit row predates .landed produces no rescue', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 3000, t + 9000, 'five_hour'), turn(t - 30)]);
    land(t - 60);
    tick(STALLED);
    expect(dispatches()).toEqual([]);
    expect(logLines('carried-in')[0]).toContain('via=banner');
  });

  it('control: no .landed with the same old row rescues — absent means never swapped, every row is current', () => {
    seed(); const t = now();
    writeTranscript([turn(t - 4000), limitRow(t - 3000, t + 9000, 'five_hour')]);
    tick(PROMPT);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('a row written in the landing\'s own second is the new process\'s: a block', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 60, t + 9000, 'five_hour')]);
    land(t - 60);
    tick(PROMPT);
    expect(dispatches()).toHaveLength(1);
  });

  it('an unreadable transcript under a pane positive rescues — nothing could date it', () => {
    seed(); const t = now();
    const p = writeTranscript([limitRow(t - 3000, t + 9000, 'five_hour')]);
    fs.rmSync(p); fs.mkdirSync(p);                      // a directory at the path: rc 2
    land(t - 60);
    tick(STALLED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a pane positive with NO rate-limit row in the window keeps the pane\'s verdict', () => {
    seed(); const t = now();
    writeTranscript([turn(t - 30)]);
    land(t - 60);
    tick(STALLED);
    expect(dispatches()).toHaveLength(1);
  });

  it('an auth-failure pane with an old rate-limit row carrying a NEAR reset dispatches — auth keeps today\'s path', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour')]);
    land(t - 60);
    tick(AUTH);
    expect(dispatches()).toHaveLength(1);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });

  it('PANE_AUTH_RE agrees with `_pane_hard_blocked`: every auth alternative it names, the pane arm also matches', () => {
    const alts = h.sh('printf "%s" "$PANE_AUTH_RE"').split('|');
    expect(alts.length).toBeGreaterThan(1);
    for (const a of alts) expect(h.sh(`_pane_hard_blocked ${JSON.stringify(a)}; echo "rc=$?"`), a).toBe('rc=0');
    expect(h.sh(`_pane_auth_failed ${JSON.stringify('API Error: 429 Too Many Requests')}; echo "rc=$?"`)).toBe('rc=1');
  });

  it('the dating read is UNCACHED: a real block that reaches the transcript on the next tick rescues on that tick', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 3000, t + 9000, 'five_hour')]);
    land(t - 60);
    tick(STALLED);
    expect(dispatches()).toEqual([]);
    writeTranscript([limitRow(t - 3000, t + 9000, 'five_hour'), turn(t - 20), limitRow(t - 5, t + 9000, 'five_hour')]);
    tick(STALLED);
    expect(dispatches()).toHaveLength(1);
  });

  it('the verdict\'s globals are cleared on every call — one supervise shell runs every tick', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    const out = h.sh(`${STUBS(ARMED)} _session_hard_blocked ${ID} ${JSON.stringify(ARMED)}; a="$HARD_BLOCK_RESET";
      _session_hard_blocked ${ID} ${JSON.stringify(AUTH)}; echo "$a|$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROWTS"`);
    expect(out).toBe(`${t + 300}|||`);
  });

  it('the strand half reads the same dated verdict — a carried-in banner does not strand', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 3000, t + 9000, 'five_hour')]);
    land(t - 60);
    h.sh(`${STUBS(PROMPT)} _tick_strand_undecidable ${ID} wrapper claude`);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(false);
  });
});


describe('.landed is stamped by the swap that lands the session, and by nothing else', () => {
  const SWAP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; '
    + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; sleep() { :; };';
  const seedSwap = (): string => {
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${ID} uuid ${UUID}; _reg_set ${ID} wrapper claude; _reg_set ${ID} project demo; _reg_set ${ID} workdir ${wd}`);
    return fs.realpathSync(wd).replace(/[/._]/g, '-');
  };

  it('a completed swap writes "<epoch> <target>" after the carry', () => {
    const mdir = seedSwap();
    const dir = path.join(h.home, '.claude', 'projects', mdir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), 'HISTORY\n');
    const before = now();
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    const [epoch, wrapper] = (h.reg(ID, 'landed') ?? '').split(' ');
    expect(wrapper).toBe('claude-d');
    expect(Number(epoch)).toBeGreaterThanOrEqual(before);
  });

  it('a REFUSED swap writes no .landed — unlike lastswap, which is stamped at dispatch', () => {
    seedSwap();
    h.sh(`${SWAP} cmd_swap ${ID} claude-d >/dev/null 2>&1 || true`, { TMUX: '' });
    expect(h.reg(ID, 'landed')).toBeNull();
  });

  it('one writer: `_swap_landed` is the only site that writes the field, and cmd_swap its only caller', () => {
    const src = fs.readFileSync(CCD, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
    expect(src.filter((l) => /_reg_set "\$[a-z0-9]+" landed /.test(l))).toHaveLength(1);
    const callers = h.sh(`while read -r f; do [[ "$f" == _swap_landed ]] && continue;
      type "$f" 2>/dev/null | grep -q '_swap_landed "' && echo "$f"; done < <(declare -F | sed 's/^declare -f //'); :`);
    expect(callers.split('\n').filter(Boolean)).toEqual(['cmd_swap']);
  });

  it('.landed, .rescuewait and .carriednote purge with the row', () => {
    seed();
    h.sh(`_reg_set ${ID} landed "1 claude"; _reg_set ${ID} rescuewait "state=open kind=near since=1 reset=2 wrapper=claude"; _reg_set ${ID} carriednote 1`);
    h.sh(`_reg_purge ${ID}`);
    for (const f of ['landed', 'rescuewait', 'carriednote']) expect(h.reg(ID, f), f).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts`

Expected: FAIL. Red at Task 1's tip: the two carried-in cases, "PANE_AUTH_RE agrees…" (`_pane_auth_failed: command not found`, rc 127), "the verdict's globals are cleared…" (declared by Task 1, never set: `'|||'`), "the dating read is UNCACHED…", "the strand half reads the same dated verdict…", "a completed swap writes…", "one writer…". Green today and staying green (regression controls): no `.landed` rescues, equal seconds is a block, unreadable transcript rescues, no rate-limit row rescues, the auth case, the refused swap, the purge.

- [ ] **Step 3: Insert the verdict helpers**

Directly above `_tscan_measure() {` insert:

```bash
_hard_block_clear() {   # the verdict's five globals, cleared at the top of every `_session_hard_blocked`
  # A LONG-LIVED PROCESS: `cmd_supervise` runs every tick in one shell, so a
  # value this tick did not set is last tick's, and a stale `resetsAt` would
  # park a session on a reset that already came and went.
  HARD_BLOCK_VIA=""; HARD_BLOCK_RESET=""; HARD_BLOCK_TYPE=""; HARD_BLOCK_ROWTS=""; HARD_BLOCK_WHY=""
}

_pane_auth_failed() {   # pane text -> success iff the pane shows lost auth rather than a limit
  grep -qiE "$PANE_AUTH_RE" <<<"$1"
}

```

Directly below `_tscan_measure`'s closing `}` and its blank line insert:

```bash
_limit_dated_verdict() {   # id pane-text -> 0 STILL A BLOCK (HARD_BLOCK_RESET/TYPE/ROWTS carry the dated row) | 1 A CARRIED-IN BANNER, not a block
  # Called on EVERY positive of `_session_hard_blocked` — pane, banner and
  # transcript rungs alike — as that rung's last word. It can only take a
  # positive AWAY, and only on proof: the transcript's newest rate-limit row
  # is strictly older than `.landed`. Every condition it cannot measure keeps
  # the positive, which is today's behaviour:
  #   - an auth failure on the pane (`PANE_AUTH_RE`): today's path, no reset;
  #   - no transcript, or one it cannot read (`newest` mode's rc 2): the pane's
  #     verdict stands, and nothing waits on a reset nobody read;
  #   - no rate-limit row in the window at all (rc 1): the pane's verdict
  #     stands — the row may simply not have landed yet;
  #   - no `.landed` (never swapped since this shipped), or an unparseable
  #     landing or row timestamp: every row is current.
  # THE DATING READ IS UNCACHED. The transcript arm's 30-second cache answers
  # "is a banner the newest row", which the landing does not change; this read
  # answers "WHEN was the newest rate-limit row written", and a tick that
  # suppresses a pane positive must ask again on the next tick, because a real
  # block on the target can show on the pane before its row reaches the
  # transcript (§8, the lag D-2443 stands down for).
  # EQUAL SECONDS ARE A BLOCK. `.landed` is stamped before the unit starts, so
  # a row the new process writes in the landing's own second is its own; only a
  # row strictly older than the landing was carried in.
  local id="$1" pane="$2" f row rc ts reset kind landed
  _pane_auth_failed "$pane" && return 0
  f=$(_transcript_path "$id") || return 0
  row=$(_transcript_limit_banner "$f" newest); rc=$?
  (( rc == 0 )) || return 0
  IFS=$'\t' read -r ts reset kind <<<"$row"
  [[ "$ts" =~ ^[0-9]+$ ]] || ts=""
  [[ "$reset" =~ ^[0-9]+$ ]] || reset=""
  [[ "$kind" =~ ^[a-z_]+$ ]] || kind=""
  landed=$(_reg_get "$id" landed); landed="${landed%% *}"
  if [[ "$landed" =~ ^[0-9]+$ ]]; then
    if [[ -n "$ts" ]] && (( ts < landed )); then
      HARD_BLOCK_WHY=carried-in
      _carried_in_note "$id" "$landed" "$ts"
      HARD_BLOCK_VIA=""
      return 1
    fi
    # A landing exists and the row cannot be dated: the block stands, but a
    # reset this function could not prove postdates the landing is not kept.
    [[ -n "$ts" ]] || return 0
  fi
  HARD_BLOCK_RESET="$reset"; HARD_BLOCK_TYPE="$kind"; HARD_BLOCK_ROWTS="$ts"
  return 0
}

_carried_in_note() {   # id landed row-epoch — say ONCE PER LANDING that a positive was dated carried-in
  # swap.log is read by a human and by §9's instrument, which counts these
  # lines against the `auto-rescue` that follows within five minutes (a real
  # block rule 1 suppressed while the transcript lagged the pane). One line per
  # landing, keyed on the landing it was measured against, so the steady state
  # of a session idling on its carried banner writes nothing.
  local id="$1" landed="$2" ts="$3"
  [[ "$(_reg_get "$id" carriednote)" == "$landed" ]] && return 0
  _reg_set "$id" carriednote "$landed" || return 0
  echo "$(date '+%F %T') carried-in $id: via=${HARD_BLOCK_VIA:-unknown} rate-limit row at $ts predates the landing at $landed — not a block [wrapper=$(_reg_get "$id" wrapper)]" >> "$REG/swap.log"
}

```

Directly above `_strand_clear() {` insert (Task 3 adds a second line to its body):

```bash
_swap_landed() {   # id target — stamp `.landed` ("<epoch> <wrapper>"), the moment the session lands on a new account
  # WHY NOT `lastswap`: it is stamped at DISPATCH, up to SWAP_JITTER before the
  # swap runs, and DELETED on a refused swap. This is written by `cmd_swap`
  # alone, after the carry and the wrapper flip and before the unit starts: the
  # old process was stopped before the carry, so every row it wrote is older;
  # the new process has not started, so every row it writes is not.
  # A write that fails leaves the PREVIOUS landing, which only ever dates fewer
  # rows as carried-in — the safe direction — and says so.
  _reg_set "$1" landed "$(date +%s) $2" \
    || echo "ccd: warn: could not stamp $REG/$1.landed — a banner carried in from the previous account will read as a block" >&2
}

```

- [ ] **Step 4: Wire the verdict — four line-neutral edits in `_session_hard_blocked`**

| Replace (one hit each) | With |
|---|---|
| `  HARD_BLOCK_VIA=""` (the line directly above `  # DEFENCE IN DEPTH, AND IT DECIDES NOTHING TODAY`) | `  _hard_block_clear` |
| `  _pane_hard_blocked "$pane" && { HARD_BLOCK_VIA=pane; return 0; }` | `  _pane_hard_blocked "$pane" && { HARD_BLOCK_VIA=pane; _limit_dated_verdict "$id" "$pane"; return; }` |
| `  _pane_limit_banner "$pane" && { HARD_BLOCK_VIA=banner; return 0; }` | `  _pane_limit_banner "$pane" && { HARD_BLOCK_VIA=banner; _limit_dated_verdict "$id" "$pane"; return; }` |
| the function's last two lines, `  HARD_BLOCK_VIA=transcript` / `  return 0` (directly above its closing `}`) | `  HARD_BLOCK_VIA=transcript` / `  _limit_dated_verdict "$id" ""` |

`_redrive_after_spawn`'s own `_pane_hard_blocked "$pane" && { echo … redrive-skip …` line is a different line and is not touched.

- [ ] **Step 5: Amend D-3100's sentence in place (three lines for three)**

In `_pane_limit_banner`'s header, replace

```bash
  # `_session_hard_blocked` — whose two callers are the rescue arm and the strand
  # half, and the rescue arm sits below `SWAP_COOLDOWN`, which a landing has just
  # stamped, so a re-render cannot reach a relocation through it.
```

with

```bash
  # `_session_hard_blocked` — whose two callers are the rescue arm and the strand
  # half. `SWAP_COOLDOWN` did NOT keep a re-render from a relocation: it expires,
  # so `.landed` now dates every positive (C12, D-3497).
```

The D-3100 argument is history and stays; this is the amendment C12 makes to it, recorded where the argument is.

- [ ] **Step 6: Stamp the landing in `cmd_swap`**

In `cmd_swap`, directly below the two lines `  _reg_set "$id" wrapper "$target"` / `  _reg_set "$id" lastswap "$(date +%s)"` (≈22836, below every anchor) insert:

```bash
  _swap_landed "$id" "$target"   # continuity §5.4 rule 1: the carried rows are all older than this
```

- [ ] **Step 7: The inventory and the census, in place**

`_reg_purge`'s inventory (above the corpus — three lines for three, and the window of Pre-flight finding 6):

| Replace | With |
|---|---|
| `` floors): 38; CCR-15's `child` made 39 — by addition, NOT a fresh census of `` | `` floors): 38; CCR-15's `child` 39; continuity's `landed` and `carriednote` 41 — by addition, NOT a fresh census of `` |
| `` # The 39: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`, `` | `` # The 41: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`, `carriednote`, `` |
| `` `hookstate`, `lastcompact`, `lastswap`, `` | `` `hookstate`, `landed`, `lastcompact`, `lastswap`, `` |

`_reg_get`'s census: measure first, with the header's own commands:

```bash
grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l    # expect 159
grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'             # expect 135
```

Then replace these five lines (`grep -n 'this file makes 156' ccd/ccd`, ≈2888)

```bash
# and the reason is a count rather than a preference: this file makes 156
# invocations across 132 non-comment lines.
#
# THE LAST MOVE WAS `_child_tmpdir`'s `.child` read (CCR-15), the +1; before it
# `_spawn_start`'s archive check (CCR-10), two archive-field reads, the +2.
```

with these five (the numbers the two commands printed, if your base already moved them):

```bash
# and the reason is a count rather than a preference: this file makes 159
# invocations across 135 non-comment lines.
#
# THE LAST MOVE WAS the rescue verdict's three reads (continuity wave 2), the +3;
# before it CCR-15's `.child` read, the +1, and CCR-10's two archive reads, the +2.
```

FIVE lines for five, keeping the whole history chain: the sentence below them (`# BEFORE THAT IT WAS ROUTING SLICE 4's…`) continues it, so dropping the CCR-10 step would misstate authoritative history, and a sixth line would move every line below `:2893`, the frozen corpus's anchors among them, breaking the line-neutral rule this wave's citation forecast rests on.

- [ ] **Step 8: Re-stamp, then pay the corpus tax**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
```

Expected: README's two anchors unchanged from Task 1 (every insertion is below `:21218` or line-neutral); the re-measurer prints `147 / 195 / 53 / 35` on stated, base and tree, composition empty. Corpus-frozen check.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/ccd-limit-banner.test.ts \
  test/ownership.test.ts test/ccd-reg-get-census.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-swap-pin.test.ts
./node_modules/.bin/vitest run test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-crosspool.test.ts
```

Expected: PASS. (`ccd-auto-swap-pool` holds the inventory window; `ccd-swap`/`ccd-swap-refuse` run the real `cmd_swap` with its new line; `ccd-crosspool` is the largest rescue-arm suite.)

- [ ] **Step 10: Mutation check, then commit**

| # | Exact edit in `ccd/ccd` | Command | Expected red (measured on the full prototype, 55 cases; at this task's own commit, the subset in the describes that exist by then) |
|---|---|---|---|
| 2.1 | `    if [[ -n "$ts" ]] && (( ts < landed )); then` → `(( ts < 0 ))` | `./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts` | 4 failed: the two carried-in cases, "the dating read is UNCACHED…" — `expected [ 'dispatch claude-demo -> claude-a' ] to deeply equal []` — and "the strand half reads the same dated verdict…" — `expected true to be false` |
| 2.2 | the banner rung back to `{ HARD_BLOCK_VIA=banner; return 0; }` | same | 4 failed: "a PANE positive whose newest rate-limit row predates .landed…", "the dating read is UNCACHED…", and, once Tasks 3–4 land, "an open near wait holds through the reset and its grace…" and "a STALLED chain wait whose account reset ends turned…" (an undated banner keeps no reset) — `expected [ 'dispatch claude-demo -> claude-a' ] to deeply equal []` |
| 2.3 | the transcript rung's last line back to `  return 0` | same | 3 failed: "a transcript banner row older than .landed…", "the strand half…" (plus Task 3's dated-tokens case, `expected '… auto-rescue claud…' to match /via=transcript reset=…/`) |
| 2.4 | delete `  _pane_auth_failed "$pane" && return 0` in `_limit_dated_verdict` | same | 2 failed: "an auth-failure pane with an old rate-limit row carrying a NEAR reset dispatches…" — `expected [] to have a length of 1 but got +0` — and "the verdict's globals are cleared…" (the AUTH call now dates the row) |
| 2.5 | cache the dating read: `  row=$(_transcript_limit_banner "$f" newest); rc=$?` → `  row=$(_reg_get "$id" datecache) && rc=0 \|\| { row=$(_transcript_limit_banner "$f" newest); rc=$?; _reg_set "$id" datecache "$row"; }` | same | "the dating read is UNCACHED…" only — `expected [] to have a length of 1 but got +0` |
| 2.6 | in `cmd_swap`, `  _swap_landed "$id" "$target"   #…` → `  : _swap_landed_not "$id" "$target"   #…` | same | "a completed swap writes…" (`expected undefined to be 'claude-d'`) and "one writer…" (`expected [] to deeply equal [ 'cmd_swap' ]`) |
| 2.7 | a second writer: `    _reg_set "$id" lastswap "$now"` (the RESCUE arm's, directly above `` # `via=` NAMES ``) → `    _reg_set "$id" lastswap "$now"; _reg_set "$id" landed "$now $target"` | same | "one writer…" only — `expected [ …(2) ] to have a length of 1 but got 2` |
| 2.8 | `  _hard_block_clear` → `  HARD_BLOCK_VIA=""` | same | "the verdict's globals are cleared on every call…" only — `expected '<R>\|<R>\|five_hour\|…' to be '<R>\|\|\|'` |
| 2.9 | delete `  [[ "$(_reg_get "$id" carriednote)" == "$landed" ]] && return 0` | same | "a transcript banner row older than .landed produces no rescue, and says so once" only — two `carried-in` lines |
| 2.10 | `PANE_AUTH_RE='Invalid API key\|Please run /login'` → `…\|OAuth token expired'` | same | "PANE_AUTH_RE agrees with `_pane_hard_blocked`…" only — `OAuth token expired: expected 'rc=1' to be 'rc=0'` |

```bash
git add ccd/ccd README.md server/test/ccd-rescue-policy.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): a carried-in banner is not a block (continuity rule 1)

cmd_swap stamps $REG/<id>.landed ("<epoch> <wrapper>") after the carry and
before the unit starts, through _swap_landed, its only writer. Every positive
of _session_hard_blocked — pane, banner and transcript rungs — ends in
_limit_dated_verdict, which dates it by the transcript's newest rate-limit row
(Task 1's uncached `newest` read) and takes it away ONLY when that row is
strictly older than the landing; no landing, no row, an unreadable transcript
or an auth-failure pane keeps today's verdict. The dated row's reset and type
are kept for rule 2. Said once per landing as `carried-in` in swap.log.
Measured before: 32 of 248 rescues fired on a banner the session carried in.
Amends D-3100's cooldown argument in place (C12,
D-3497).

_reg_get census 156/132 -> 159/135; _reg_purge's inventory names landed and
carriednote (41). S6-R11: every edit above the corpus is line-neutral; the
census did not move.
MSG
)"
```

---

### Task 3: Rule 2 — the near-reset wait, the no-room wait, and `.rescuewait`

**Model routing:** `opus`, effort `high` — the hold decisions are the safety surface of this wave.

**Files:**
- Modify: `ccd/ccd` — `_rw_field`, `_rescuewait_open`, `_rescuewait_close`, `_rescuewait_turned` inserted directly below `_carried_in_note`'s closing brace; `_rescue_policy` (rule-2 form) and `_rescue_line_extra` directly above `_swap_landed() {`; one line added to `_swap_landed`; three line-neutral edits in `_auto_swap_check`; `_reg_purge`'s inventory and `_reg_get`'s census in place
- Test: `server/test/ccd-rescue-policy.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2's `HARD_BLOCK_RESET`/`HARD_BLOCK_TYPE`/`HARD_BLOCK_ROWTS`/`HARD_BLOCK_WHY`; `_pane_auto_continue_armed`; `_is_anthropic_backend`; `_strand_mark`/`_strand_clear`; `_redrive_after_spawn` (unchanged, called through its own gate).
- Produces: `$REG/<id>.rescuewait`, ONE line: `state=open kind=<near|chain|noroom> since=<epoch> reset=<epoch|-> wrapper=<w>`, and on exit `state=closed … until=<epoch> end=<clear|carried-in|turned|swap|near|chain|noroom>`; `reset` is the verdict's own five-hour reset or `-`. `swap.log`: `rescuewait <id>: kind=<k> on <w> reset=<r>` once on entry, `rescuewait-end <id>: kind=<k> on <w> reset=<r> after <n>s end=<word>` once on exit. `_rescue_policy <id> <wrapper> <pane> <hard_blocked>` → rc 0 PROCEED as today | rc 1 HOLD this tick. The `auto-rescue` line appends ` reset=<epoch>`, ` type=<word>`, ` row=<epoch>` when known.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-rescue-policy.test.ts`:

```ts

// ── RULE 2 — wait near the account's own five-hour reset ─────────────────────

describe('rule 2: the near-reset wait (C6, C13)', () => {
  it('the auto-rescue line carries the dated row: reset=, type= and row=', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 10, t + 9000, 'five_hour')]);
    tick(PROMPT);
    expect(logLines('auto-rescue')[0]).toMatch(new RegExp(`via=transcript reset=${t + 9000} type=five_hour row=${t - 10}$`));
  });

  it('a five_hour row whose reset is 300 s out, auto-continue armed: no dispatch, one entry line, and the record', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED); tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(logLines('rescuewait'), swapLog()).toHaveLength(1);
    const rec = h.reg(ID, 'rescuewait');
    expect(field(rec, 'state')).toBe('open');
    expect(field(rec, 'kind')).toBe('near');
    expect(field(rec, 'reset')).toBe(String(t + 300));
    expect(keystrokes(), 'a wait types nothing').toEqual([]);
    expect(swapLog()).not.toMatch(/\bhold\b/);
  });

  it('a seven_day row 300 s out dispatches — only the five-hour window is waited on', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'seven_day')]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('RESCUE_WAIT_BOUND=0 turns the wait off: it dispatches', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_BOUND=0; _auto_swap_check ${ID}`);
    expect(dispatches()).toHaveLength(1);
  });

  it('RESCUE_WAIT_BOUND=0 turns the wait off INSIDE the grace too: a reset that just passed dispatches', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 500, t - 30, 'five_hour')]);
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_BOUND=0; _auto_swap_check ${ID}`);
    expect(dispatches()).toHaveLength(1);
  });

  it('the grace is its OWN constant: RESCUE_WAIT_GRACE moves the end, STALE_PRESS_COOLDOWN does not', () => {
    seed(); const t = now(); const R = t - 60;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    const open = `_reg_set ${ID} rescuewait "state=open kind=near since=${t - 500} reset=${R} wrapper=claude"`;
    h.sh(`${open}; ${STUBS(ARMED)} STALE_PRESS_COOLDOWN=30; _auto_swap_check ${ID}`);
    expect(field(h.reg(ID, 'rescuewait'), 'state'), 'STALE_PRESS_COOLDOWN ended the wait').toBe('open');
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_GRACE=30; _auto_swap_check ${ID}`);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    expect(dispatches()).toEqual([]);
  });

  it('a reset outside the bound dispatches at once', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 900, 'five_hour')]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a STALLED session (no armed auto-continue) is rescued as today, reset or no reset', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(STALLED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a non-Anthropic lane never waits on a reset', () => {
    seed('gpt'); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a row carrying no reset swaps as today — ~/.cc-limits is not a fallback', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, null, 'five_hour')]);
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude.json'),
      JSON.stringify({ five: 100, seven: 10, ts: t, fiveResetAt: t + 300, sevenResetAt: t + 400000 }));
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('an open near wait holds through the reset and its grace, even once the pane stops saying armed', () => {
    seed(); const t = now(); const R = t - 60;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=near since=${t - 500} reset=${R} wrapper=claude"`);
    tick(STALLED);
    expect(dispatches()).toEqual([]);
  });

  it('the verdict clearing at the reset (Claude Code continued) ends the wait, once, as `clear`', () => {
    seed(); const t = now(); const R = t - 10;
    writeTranscript([limitRow(t - 500, R, 'five_hour'), turn(t - 2)]);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=near since=${t - 500} reset=${R} wrapper=claude"`);
    tick(PROMPT); tick(PROMPT);
    expect(dispatches()).toEqual([]);
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('clear');
  });

  it('GRACE after the reset with no newer row: the redrive fallback runs in place, nothing dispatches, ever, on this reset', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 800, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=near since=${t - 800} reset=${R} wrapper=claude"`);
    tick(ARMED); tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(keystrokes(), 'the fallback types only on the unsubmitted resume pair').toEqual([]);
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  it('GRACE after the reset WITH a rate-limit row newer than the reset: a dispatch follows', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 800, R, 'five_hour'), turn(t - 150), limitRow(t - 100, t + 17000, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=near since=${t - 800} reset=${R} wrapper=claude"`);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('a turned record on ANOTHER account does not hold this one — two accounts can share a reset epoch', () => {
    seed(); const t = now(); const R = t - 200;
    // The row PREDATES its reset, so the only thing between this tick and a
    // hold is the record's wrapper (a row written after R waits on nothing).
    writeTranscript([limitRow(t - 300, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=closed kind=near since=1 reset=${R} wrapper=claude-b until=2 end=turned"`);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a STALLED session whose closed turned record names this reset is rescued', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=closed kind=near since=1 reset=${R} wrapper=claude until=2 end=turned"`);
    tick(STALLED);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('control: an ARMED session whose closed turned record names this reset is held', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=closed kind=near since=1 reset=${R} wrapper=claude until=2 end=turned"`);
    tick(ARMED);
    expect(dispatches()).toEqual([]);
  });

  // A ROW WRITTEN AT OR AFTER ITS OWN resetsAt is a NEW block, whatever reset it
  // carries (§5.4 rule 2: a row newer than the reset ends in a swap). Such rows
  // are real: a 14-day survey of this fleet's transcripts found 6 `five_hour`
  // rows whose resetsAt was 10 hours to 8.5 days before their own timestamp.
  it('a row written AFTER its own resetsAt never parks: stranded, then rescued when room appears', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t - 36857, 'five_hour')]);
    tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('armed, a row newer than its reset: no near wait', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t - 60, 'five_hour')]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a rate-limit row written after the reset with the SAME resetsAt ends the wait in a swap', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 800, R, 'five_hour'), turn(t - 150), limitRow(t - 50, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=near since=${t - 800} reset=${R} wrapper=claude"`);
    tick(ARMED); tick(ARMED); tick(STALLED);
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('no target with room: no dispatch, a stranded record, and the no-room wait — recorded once', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    tick(STALLED, ''); tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('noroom');
    expect(logLines('rescuewait')).toHaveLength(1);
    tick(STALLED, 'claude-a');
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('an ARMED no-room wait that crosses its own reset ends in place, never in a swap, even once a target has room', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=noroom since=${t - 5000} reset=${R} wrapper=claude"`);
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(false);
  });

  // A STALLED pane has nothing that re-sends its turn in place, and ccd may type
  // nothing there — so across its own reset it is rescued exactly as today's
  // strand is: it waits while no target has room, and swaps the moment one does.
  it('a STALLED no-room wait across its own reset is rescued once a target has room, not held', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=noroom since=${t - 5000} reset=${R} wrapper=claude"`);
    tick(STALLED, ''); tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state'), 'the no-room wait ended at a reset nothing re-sent').toBe('open');
    expect(logLines('rescuewait'), 'a no-room wait re-opened per tick').toHaveLength(0);
    tick(STALLED, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(keystrokes(), 'nothing typed in place').toEqual([]);
  });

  it('the word is never `hold`: the record is `.rescuewait`, and no `.hold` is written', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED);
    expect(fs.existsSync(regFile(`${ID}.hold`))).toBe(false);
    expect(fs.existsSync(regFile(`${ID}.rescuewait`))).toBe(true);
  });
});

```

And in the `.landed` describe's first case — retitle it `'a completed swap writes "<epoch> <target>" after the carry, and ends an open wait as a swap'` — directly after `    fs.writeFileSync(path.join(dir, \`${UUID}.jsonl\`), 'HISTORY\n');`, add

```ts
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=noroom since=1 reset=- wrapper=claude"`);
```

and as the case's last line

```ts
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts`

Expected (measured at Task 2's tip with this file): FAIL, `14 failed | 25 passed (39)` — every rule-2 case that expects a hold, a record, a `rescuewait` line or an `end=` word (300 s out armed, the grace constant, the open near wait, clear at the reset, GRACE with and without a newer row, the ARMED turned-record control, the SAME-resetsAt row, no target with room, the ARMED and the STALLED no-room crossings, never `hold`), the dated-tokens case, and the `.landed` case's new `end` assertion. The regression controls pass today and must stay green: `seven_day` dispatches, bound 0 before and inside the grace, outside the bound, STALLED, non-Anthropic, no reset, a turned record on another account, a STALLED session with a turned record on this reset, a row written after its own reset (both cases).

- [ ] **Step 3: Insert the wait record and its three verbs**

Directly below `_carried_in_note`'s closing `}` and its blank line insert:

```bash
_rw_field() {   # record key -> that key's value from a `.rescuewait` line ("" when absent)
  [[ " $1 " =~ \ $2=([^ ]*)\  ]] && printf '%s' "${BASH_REMATCH[1]}"
  return 0
}

_rescuewait_open() {   # id kind(near|chain|noroom) -> 0 recorded (or already open as this kind) | 1 could not record
  # RECORDED ONCE ON ENTRY. An open wait of the SAME kind is this wait,
  # continuing, and says nothing; an open wait of ANOTHER kind ends here, in
  # the kind that replaces it (a chain wait with no room left becomes the
  # no-room wait), so the record never holds two waits and swap.log never
  # shows an entry without its exit. THE RESET IT RECORDS is the verdict's own
  # five-hour reset, or `-`: `_rescue_policy` matches the dated row against it,
  # so a wait ends at the reset it was taken on and at no other — and only on
  # the account it was taken on, because two accounts can share a reset epoch.
  local id="$1" kind="$2" reset="-" rec w now
  [[ "${HARD_BLOCK_TYPE:-}" == five_hour && "${HARD_BLOCK_RESET:-}" =~ ^[0-9]+$ ]] && reset="$HARD_BLOCK_RESET"
  rec=$(_reg_get "$id" rescuewait)
  if [[ "$(_rw_field "$rec" state)" == open ]]; then
    [[ "$(_rw_field "$rec" kind)" == "$kind" ]] && return 0
    _rescuewait_close "$id" "$kind"
  fi
  now=$(date +%s); w=$(_reg_get "$id" wrapper)
  _reg_set "$id" rescuewait "state=open kind=$kind since=$now reset=$reset wrapper=$w" || return 1
  echo "$(date '+%F %T') rescuewait $id: kind=$kind on $w reset=$reset" >> "$REG/swap.log"
  return 0
}

_rescuewait_close() {   # id end-word — RECORDED ONCE ON EXIT; a no-op unless a wait is open
  local id="$1" end="$2" rec kind since reset w now
  rec=$(_reg_get "$id" rescuewait)
  [[ "$(_rw_field "$rec" state)" == open ]] || return 0
  kind=$(_rw_field "$rec" kind); since=$(_rw_field "$rec" since)
  reset=$(_rw_field "$rec" reset); w=$(_rw_field "$rec" wrapper)
  [[ "$since" =~ ^[0-9]+$ ]] || since=0
  now=$(date +%s)
  _reg_set "$id" rescuewait "state=closed kind=$kind since=$since reset=$reset wrapper=$w until=$now end=$end" || return 0
  echo "$(date '+%F %T') rescuewait-end $id: kind=$kind on $w reset=$reset after $((now - since))s end=$end" >> "$REG/swap.log"
}

_rescuewait_turned() {   # id — RESCUE_WAIT_GRACE after the reset, the dated row still the one waited on, and the pane ARMED
  # THE WINDOW TURNED WITH NOTHING RE-SENT. Spec §5.4 rule 2's second end
  # condition: no rate-limit row newer than the reset exists (the caller
  # proved the dated row predates the recorded reset), so the account has
  # reset and the session is not blocked by anything this box can see.
  # REACHED ONLY WHILE CLAUDE CODE'S AUTO-CONTINUE IS ARMED ON THE PANE: that
  # continuation re-sends the turn itself, so the session is never swapped away
  # from this reset. A STALLED pane never comes here — nothing would re-send
  # its turn, and ccd may type nothing in place — so `_rescue_policy` rescues
  # it as today, by a swap whose spawn re-drives the turn.
  # The existing redrive fallback runs IN PLACE, through its own gate and
  # unchanged: `_redrive_after_spawn` types
  # `RESUME_PROMPT` only when the transcript's newest real turn is the
  # unsubmitted resume pair — a precondition a session waiting on a banner
  # does not meet, so on the fleet as measured it stands down (fromswap 0, so
  # silently); it is called rather than re-implemented because §6 forbids any
  # keystroke outside that fallback's own conditions.
  local id="$1"
  _rescuewait_close "$id" turned
  _strand_clear "$id"
  _redrive_after_spawn "$id" "$(_tmux "$id")" 0
  return 0
}

```

- [ ] **Step 4: Insert `_rescue_policy` (rule-2 form) and `_rescue_line_extra`**

Directly above `_swap_landed() {` insert:

```bash
_rescue_policy() {   # id wrapper pane hard-blocked -> 0 PROCEED as today (rule 3's skip lists set) | 1 HOLD this tick
  # THE ONE CALL SITE is `_auto_swap_check`'s verdict line, below both
  # cooldown gates — so every wait sits INSIDE `SWAP_COOLDOWN` and
  # `SWAPBLOCK_COOLDOWN`, never instead of them — and above target choice.
  # `_tick_strand_undecidable` deliberately does not call it: a tick that
  # cannot decide has no rescue to hold.
  #
  # IN ORDER:
  #   (0) not blocked: any open wait ends, in the word the verdict gave
  #       (`carried-in`) or `clear` — which is how Claude Code's own timer, or
  #       the stale-phase Enter (D-2360), ends a wait at the reset;
  #   (a) a wait recorded against THIS dated reset: hold through the reset and
  #       its grace (a near wait from entry, a chain or no-room wait from the
  #       reset itself). Past the grace, an ARMED pane ends it `turned` and is
  #       held for good on this reset — Claude Code re-sends the turn itself. A
  #       STALLED pane is rescued as today: a near or chain wait ends `turned`
  #       and the tick proceeds (and takes no chain wait on this reset); a
  #       no-room wait stays open and ends in a swap once a target has room;
  #   (b) a near reset and an ARMED auto-continue: the near wait;
  #   (c) three rescues inside the hour: the chain wait, up to RESCUE_CHAIN_WAIT;
  #   otherwise proceed, with the accounts just left blocked and the targets
  #   just rescued onto set for `_rescue_target`.
  # (a) AND (b) NEED A ROW WRITTEN BEFORE ITS OWN RESET. A rate-limit row
  # written at or after its `resetsAt` says the account did NOT turn — §5.4
  # rule 2 ends a wait "in a swap if a rate-limit row newer than the reset
  # exists" — whatever reset it carries, and a row nobody could date waits on
  # nothing either. Such rows are real (a 14-day survey found `five_hour` rows
  # whose `resetsAt` was 10 hours to 8.5 days before their own timestamp).
  # WHY (b) — AND AN END IN PLACE — NEED AN ARMED AUTO-CONTINUE: mechanism 5
  # names the cost of D-2236 as "the wait for one whose reset is minutes away"
  # — the session Claude Code will continue by itself. A STALLED session
  # (auto-resume off, its re-arm cap hit, a human's Esc) has nothing that
  # re-sends its turn at the reset, and the redrive fallback cannot type for
  # it (see `_rescuewait_turned`), so a wait would park it; it is rescued as
  # today, by a swap whose `--resume` spawn re-drives the turn.
  local id="$1" wrapper="$2" pane="$3" hb="$4" now rec state kind since rreset rend R past=""
  if [[ -z "$hb" ]]; then
    _rescuewait_close "$id" "${HARD_BLOCK_WHY:-clear}"
    return 0
  fi
  now=$(date +%s); R="${HARD_BLOCK_RESET:-}"
  rec=$(_reg_get "$id" rescuewait)
  state=$(_rw_field "$rec" state); kind=$(_rw_field "$rec" kind); since=$(_rw_field "$rec" since)
  rreset=$(_rw_field "$rec" reset); rend=$(_rw_field "$rec" end)
  if [[ "${HARD_BLOCK_TYPE:-}" == five_hour && "$R" =~ ^[0-9]+$ && "${HARD_BLOCK_ROWTS:-}" =~ ^[0-9]+$ ]] \
     && (( HARD_BLOCK_ROWTS < R )) && _is_anthropic_backend "$wrapper"; then
    if [[ "$rreset" == "$R" && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \
       && { [[ "$state" == open ]] || [[ "$state" == closed && "$rend" == turned ]]; }; then
      if (( now >= R + RESCUE_WAIT_GRACE )); then
        # THE WINDOW TURNED. Only an ARMED auto-continue re-sends the turn in
        # place, so only then does the wait end in place and hold on this reset.
        # A STALLED pane has nothing that re-sends it, and ccd types nothing here
        # (`_rescuewait_turned`), so it is rescued as today: a no-room wait stays
        # open and ends in a swap when a target gains room; any other wait ends
        # `turned` and does not reopen as a chain wait on this reset (`past`).
        if _pane_auto_continue_armed "$pane"; then
          [[ "$state" == open ]] && _rescuewait_turned "$id"
          return 1
        fi
        [[ "$state" == open && "$kind" != noroom ]] && { _rescuewait_close "$id" turned; state=closed; }
        past=1
      else
        [[ "$state" == open && ( "$kind" == near || "$now" -ge "$R" ) ]] && return 1
      fi
    fi
    if (( RESCUE_WAIT_BOUND > 0 && now >= R - RESCUE_WAIT_BOUND && now < R + RESCUE_WAIT_GRACE )) \
       && _pane_auto_continue_armed "$pane"; then
      _rescuewait_open "$id" near
      return 1
    fi
  fi
  return 0
}

_rescue_line_extra() {   # -> the dated row's tokens for the `auto-rescue` line: ` reset=<epoch>`, ` type=<word>`, ` row=<epoch>`, each only when known
  # APPENDED, so every line this fleet's log already carries keeps its exact
  # shape when nothing was dated. `_rescue_history` reads `reset=` back (an
  # account whose logged reset passed is not "just left blocked" any more), and
  # §9's instrument compares `row=` with the landing the log itself records, so
  # the carried-in count is measured from the log rather than from the stamp
  # that decided it.
  [[ -n "${HARD_BLOCK_RESET:-}" ]] && printf ' reset=%s' "$HARD_BLOCK_RESET"
  [[ -n "${HARD_BLOCK_TYPE:-}" ]] && printf ' type=%s' "$HARD_BLOCK_TYPE"
  [[ -n "${HARD_BLOCK_ROWTS:-}" ]] && printf ' row=%s' "$HARD_BLOCK_ROWTS"
  return 0
}

```

Then in `_swap_landed`, directly after its `_reg_set … || echo …` statement (the two lines ending `>&2`), add the line

```bash
  _rescuewait_close "$1" swap
```

- [ ] **Step 5: Three line-neutral edits in `_auto_swap_check`**

| Replace (one hit each) | With |
|---|---|
| `  _session_hard_blocked "$id" "$pane" && hard_blocked=1` | `  _session_hard_blocked "$id" "$pane" && hard_blocked=1; _rescue_policy "$id" "$wrapper" "$pane" "$hard_blocked" \|\| { [[ -z "$stuck" ]] && _tick_decided "$id"; return 0; }` |
| `    [[ -z "$target" && -n "$hard_blocked" ]] && _strand_mark "$id" "$wrapper" "$project"` | `    [[ -z "$target" && -n "$hard_blocked" ]] && { _strand_mark "$id" "$wrapper" "$project"; _rescuewait_open "$id" noroom; }` |
| the rescue arm's `    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$([[ "${HARD_BLOCK_VIA:-}" == pane ]] \|\| printf ' via=%s' "${HARD_BLOCK_VIA:-unknown}")" >> "$REG/swap.log"` | `    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$([[ "${HARD_BLOCK_VIA:-}" == pane ]] \|\| printf ' via=%s' "${HARD_BLOCK_VIA:-unknown}")$(_rescue_line_extra)" >> "$REG/swap.log"; _rescuewait_close "$id" swap` |

The first keeps `ccd-limit-banner`'s source pin (`_session_hard_blocked "$id" "$pane" && hard_blocked=1`) as a substring; the third keeps `ccd-swap-pin`'s (`auto-rescue $id: $wrapper (blocked)`, above the pin check — Pre-flight finding 3). A hold decided, so it clears `.tickstuck` exactly as the cooldown gates do.

- [ ] **Step 6: The inventory and the census, in place**

| Replace | With |
|---|---|
| `` CCR-15's `child` 39; continuity's `landed` and `carriednote` 41 — by addition `` | `` CCR-15's `child` 39; continuity's three rescue fields 42 — by addition `` |
| `` # The 41: `` | `` # The 42: `` |
| `` # `reaping`, `setup`, `spawn`, `stalenarrownote`, `` | `` # `reaping`, `rescuewait`, `setup`, `spawn`, `stalenarrownote`, `` |

Census — measure with the header's two commands (`expect 163` occurrences, `expect 139` lines), then replace the five lines Task 2 wrote with these five:

```bash
# and the reason is a count rather than a preference: this file makes 163
# invocations across 139 non-comment lines.
#
# THE LAST MOVE WAS the rescue policy's seven reads (continuity wave 2), the +7;
# before it CCR-15's `.child` read, the +1, and CCR-10's two archive reads, the +2.
```

- [ ] **Step 7: Re-stamp, the corpus tax, and the tests**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/ccd-limit-banner.test.ts \
  test/ownership.test.ts test/ccd-reg-get-census.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-swap-pin.test.ts
./node_modules/.bin/vitest run test/ccd-crosspool.test.ts test/ccd-project-pool.test.ts test/ccd-swap-refuse.test.ts
./node_modules/.bin/vitest run test/ccd-route-tick.test.ts test/pools-existence-pairing.test.ts test/ccd-reader-standdown.test.ts \
  test/ccd-redrive.test.ts test/ccd-pane-narrow-note.test.ts test/ccd-arith-containment.test.ts
```

Expected: census unmoved (`147 / 195 / 53 / 35`); all PASS (measured on the prototype: 208 + 1 skipped for the second run, 135 for the third).

- [ ] **Step 8: Mutation check, then commit**

| # | Exact edit in `ccd/ccd` | Command | Expected red (measured on the full prototype, 55 cases) |
|---|---|---|---|
| 3.1 | the near-wait `if` line `    if (( RESCUE_WAIT_BOUND > 0 && now >= R - RESCUE_WAIT_BOUND && now < R + RESCUE_WAIT_GRACE )) \` → `    if false \` | `./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts` | "a five_hour row whose reset is 300 s out…" (`expected [ 'dispatch claude-demo -> claude-a' ] to deeply equal []`) and "the word is never `hold`…" (`expected false to be true`) |
| 3.2 | the lower bound deleted: `now >= R - RESCUE_WAIT_BOUND && now < R + RESCUE_WAIT_GRACE` → `now < R + RESCUE_WAIT_GRACE` | same | "a reset outside the bound dispatches at once" and "GRACE after the reset WITH a rate-limit row newer…" — `expected [] to have a length of 1 but got +0` |
| 3.3 | `(( RESCUE_WAIT_BOUND > 0 && now >= R` → `(( now >= R` | same | "RESCUE_WAIT_BOUND=0 turns the wait off INSIDE the grace too…" only |
| 3.4 | `       && _pane_auto_continue_armed "$pane"; then` → `       ; then` | same | "a STALLED session (no armed auto-continue) is rescued as today…" only |
| 3.5 | `     && (( HARD_BLOCK_ROWTS < R )) && _is_anthropic_backend "$wrapper"; then` → `     && (( HARD_BLOCK_ROWTS < R )); then` | same | "a non-Anthropic lane never waits on a reset" only |
| 3.6 | `  if [[ "${HARD_BLOCK_TYPE:-}" == five_hour && "$R"` → `  if [[ -n "${HARD_BLOCK_TYPE:-}" && "$R"` | same | "a seven_day row 300 s out dispatches…" only |
| 3.7 | the ARMED arm's `          return 1` (below `          [[ "$state" == open ]] && _rescuewait_turned "$id"`) → `          return 0` | same | 5 failed: "the grace is its OWN constant…", "GRACE after the reset with no newer row…", "control: an ARMED session whose closed turned record names this reset is held", "an ARMED no-room wait that crosses its own reset…" (plus Task 4's ARMED chain-reset case) — `expected [ 'dispatch claude-demo -> claude-a' ] to deeply equal []` |
| 3.8 | `        [[ "$state" == open && ( "$kind" == near \|\| "$now" -ge "$R" ) ]] && return 1` (the `else` arm) → `        :` (deleting it would leave an empty `else`, a syntax error) | same | "an open near wait holds through the reset and its grace…" only |
| 3.9 | ` && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \` → ` ]] \` | same | "a turned record on ANOTHER account does not hold this one…" only — `expected [] to have a length of 1 but got +0` |
| 3.10 | `      if (( now >= R + RESCUE_WAIT_GRACE )); then` → `      if (( now >= R + STALE_PRESS_COOLDOWN )); then` | same | "the grace is its OWN constant…" only — `STALE_PRESS_COOLDOWN ended the wait: expected 'closed' to be 'open'` |
| 3.11 | the strand site back to `… && _strand_mark "$id" "$wrapper" "$project"` | same | "no target with room: … the no-room wait — recorded once" (`expected undefined to be 'noroom'`) (plus Task 4's chain→no-room case) |
| 3.12 | in `_rescuewait_close`, delete `  [[ "$(_rw_field "$rec" state)" == open ]] \|\| return 0` | same | 5 failed: the auth case, "the verdict clearing at the reset … ends the wait, once…" (`expected [ …(2) ] to have a length of 1 but got 2`) (plus Task 4's STALLED chain-reset, Codex-lane and auth-chain cases) — `expected 'state=closed kind= since=0 reset= wra…' to be null` |
| 3.13 | in `_rescuewait_open`, delete `    [[ "$(_rw_field "$rec" kind)" == "$kind" ]] && return 0` | same | 3 failed: "no target with room…", "a STALLED no-room wait across its own reset…" (`a no-room wait re-opened per tick`) (plus Task 4's chain→no-room case) — `expected [ …(2) ] to have a length of 1 but got 2` |
| 3.14 | in `_rescue_line_extra`, delete the ` row=` line | same | "the auto-rescue line carries the dated row…" only |
| 3.15 | the rescue arm's echo loses its tail `; _rescuewait_close "$id" swap` | same | 5 failed: "GRACE after the reset WITH a rate-limit row newer…", "a rate-limit row written after the reset with the SAME resetsAt…", "no target with room…", "a STALLED no-room wait across its own reset…" (plus Task 4's chain-expiry case) — `expected undefined to be 'swap'` |
| 3.16 | `        if _pane_auto_continue_armed "$pane"; then` (the turned block's, eight spaces) → `        if true; then` | same | 3 failed: "a STALLED session whose closed turned record names this reset is rescued" (`expected [] to deeply equal [ 'dispatch claude-demo -> claude-a' ]`), "a STALLED no-room wait across its own reset…" (`the no-room wait ended at a reset nothing re-sent: expected 'closed' to be 'open'`) (plus Task 4's STALLED chain-reset case, `expected [] to deeply equal [ 'dispatch claude-demo -> claude-b' ]`) |
| 3.17 | `     && (( HARD_BLOCK_ROWTS < R )) && _is_anthropic_backend "$wrapper"; then` → `     && _is_anthropic_backend "$wrapper"; then` | same | 3 failed: "a row written AFTER its own resetsAt never parks…" (`expected [] to deeply equal [ 'dispatch claude-demo -> claude-a' ]`), "armed, a row newer than its reset: no near wait" (`expected [] to have a length of 1 but got +0`), "a rate-limit row written after the reset with the SAME resetsAt…" (`expected 'turned' to be 'swap'`) |
| 3.18 | `[[ "$state" == open && "$kind" != noroom ]] && {` → `[[ "$state" == open ]] && {` | same | "a STALLED no-room wait across its own reset…" only — `a no-room wait re-opened per tick: expected [ …(2) ] to have a length of +0 but got 2` |
| 3.19 | `{ _rescuewait_close "$id" turned; state=closed; }` → `{ state=closed; }` | same | Task 4's "a STALLED chain wait whose account reset ends turned…" only (at this task's own commit: none — the case arrives in Task 4) — `expected 'swap' to be 'turned'` |

```bash
git add ccd/ccd server/test/ccd-rescue-policy.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the rescue waits near a five-hour reset (continuity rule 2)

A five_hour block on an Anthropic lane whose reset is within
RESCUE_WAIT_BOUND=600 s, with Claude Code's auto-continue ARMED on the pane,
waits instead of swapping: nothing typed, recorded once on entry and once on
exit in $REG/<id>.rescuewait and swap.log (never the word "hold"). It ends at
the reset, or RESCUE_WAIT_GRACE=120 s after it (its own constant): in a swap
if a newer rate-limit row exists; otherwise, while the pane is still ARMED, in
place — the redrive fallback runs through its own gate, which types only on
the unsubmitted resume pair — and never in a swap away from that reset. A
STALLED pane is rescued as today at its reset: nothing re-sends its turn in
place. No wait keys on a row written at or after its own resetsAt. Today's
stranded path is the no-room wait with the same reset ending. A stalled
session, a seven_day or non-Anthropic block, or a row with no reset swaps as
today; ~/.cc-limits is not consulted. Amends D-2236 / post-swap-redrive R1 (C6, C13,
D-3498). The auto-rescue line appends reset=/type=/
row= when a row was dated.

_reg_get census 159/135 -> 163/139; inventory 42 with rescuewait. S6-R11:
line-neutral above the corpus; the census did not move.
MSG
)"
```

---

### Task 4: Rule 3 — spread, do not bounce, and the chain wait

**Model routing:** `opus`, effort `high` — it edits `_swap_target`, the one function every placement decision runs through.

**Files:**
- Modify: `ccd/ccd` — `_rescue_history` directly above `_rescue_policy() {`; `_rescue_target` directly below `_rescue_policy`'s closing brace; two insertions in `_rescue_policy`; two line-neutral edits in `_swap_target`; one in `_auto_swap_check`
- Test: `server/test/ccd-rescue-policy.test.ts` (extend)

**Interfaces:**
- Consumes: `swap.log`'s `auto-rescue` lines, including Task 3's ` reset=` token; `_swap_target`'s rc contract (0 a name or stay, 1 must leave and nothing can take it, 2–5 undecidable, 6 a name one rung down).
- Produces: `_rescue_history <id>` → rc 0 with `RESCUE_COUNT` (this session's rescues in `RESCUE_CHAIN_WINDOW`), `RESCUE_SKIP_LEFT` (their sources, except one whose logged reset passed), `RESCUE_SKIP_RECENT` (every rescue target in `RESCUE_SPREAD_WINDOW`) | rc 2 unmeasurable, all empty. `SWAP_TARGET_SKIP` — a space-separated account list `_swap_target` passes over in its candidate walk and its home-return branch; empty or unset changes nothing. `_rescue_target <id> <cur> <home> <hard_blocked> <hrc>` → `_swap_target`'s stdout and rc; byte-for-byte `_swap_target` when not a rescue or with no history; the spread pass's answer is taken only at rc 0 (its rc 6, a class degrade, falls through to the just-left-only pass). `kind=chain` in `.rescuewait` — Anthropic lanes only, never on an auth-failure pane, and never re-opened on a reset rule 2 has already ruled turned.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-rescue-policy.test.ts`:

```ts
// ── RULE 3 — spread, do not bounce, chain-wait ────────────────────────────────

describe('rule 3: spread, no bounce, and the chain wait', () => {
  /** Real `_swap_target`: every home-able lane under the ceiling, claude-a the
   *  least used, so an unskipped rescue from `claude` takes claude-a. */
  const lanes = (): void => {
    const t = now();
    for (const [w, five] of [['claude', 100], ['claude-a', 10], ['claude-b', 20], ['claude-d', 30]] as const) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
        JSON.stringify({ five, seven: 5, ts: t, fiveResetAt: t + 10000, sevenResetAt: t + 400000 }));
    }
  };
  const blockNow = (): void => { const t = now(); writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]); };

  it('control: with no history the least-used lane takes the rescue', () => {
    seed(); lanes(); blockNow();
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('a target the session just left blocked is skipped', () => {
    seed(); lanes(); blockNow();
    pastLog(900, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`]);
  });

  it('…unless its logged five-hour reset has already passed', () => {
    seed(); lanes(); blockNow();
    pastLog(900, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude] via=transcript reset=${now() - 60} type=five_hour row=1`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('spread: a target another session was rescued onto minutes ago is passed over while another has room', () => {
    seed(); lanes(); blockNow();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`]);
  });

  it('spread is a preference: when the recent target is the only one with room, it is taken', () => {
    seed(); lanes(); blockNow();
    for (const w of ['claude-b', 'claude-d']) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five: 100, seven: 5, ts: now() }));
    }
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('a fourth rescue within the hour takes the chain wait — recorded with kind=chain, nothing dispatched', () => {
    seed(); lanes(); blockNow();
    for (const ago of [3000, 2000, 1000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> claude [home=claude]`);
    tick(STALLED, null); tick(STALLED, null);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('chain');
    expect(logLines('rescuewait')).toHaveLength(1);
  });

  it('after RESCUE_CHAIN_WAIT the chain wait swaps — to a target that is not the account it just left blocked', () => {
    seed(); lanes(); blockNow();
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=chain since=$(( $(date +%s) - 1801 )) reset=- wrapper=claude"`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('an ARMED chain wait whose account resets inside it ends in place and does not swap', () => {
    seed(); lanes(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 1000, R, 'five_hour')]);
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> claude [home=claude]`);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=chain since=${t - 1000} reset=${R} wrapper=claude"`);
    tick(ARMED, null);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  it('a STALLED chain wait whose account reset ends turned and the tick rescues, with no second chain wait', () => {
    seed(); lanes(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 1000, R, 'five_hour')]);
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=chain since=${t - 1000} reset=${R} wrapper=claude"`);
    tick(STALLED, null);
    expect(dispatches(), 'claude-a is the account it just left blocked').toEqual([`dispatch ${ID} -> claude-b`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    expect(logLines('rescuewait'), 'a second chain wait opened on the reset that just turned').toHaveLength(0);
  });

  it('a chain wait at its bound with no target that has room becomes the no-room wait', () => {
    seed(); blockNow();
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> claude [home=claude]`);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=chain since=$(( $(date +%s) - 1801 )) reset=- wrapper=claude"`);
    tick(STALLED, ''); tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    expect(logLines('rescuewait-end'), 'the no-room wait flapped back into a chain wait').toHaveLength(1);
    expect(logLines('rescuewait-end')[0]).toContain('kind=chain');
    expect(logLines('rescuewait-end')[0]).toContain('end=noroom');
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('noroom');
  });

  it('the home-return branch honours the skip too: a session rescued off its home is not sent straight back', () => {
    seed('claude-b'); lanes(); blockNow();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude.json'),
      JSON.stringify({ five: 10, seven: 5, ts: now() }));            // telemetry lags: home "looks" fine
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-b.json'),
      JSON.stringify({ five: 100, seven: 5, ts: now() }));
    pastLog(900, `auto-rescue ${ID}: claude (blocked) -> claude-b [home=claude]`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('an unreadable swap log is today\'s behaviour: no chain wait, no skip', () => {
    seed(); lanes(); blockNow();
    fs.mkdirSync(regFile('swap.log'));
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('a NON-rescue tick is `_swap_target` byte for byte: no skip list reaches the affinity path', () => {
    seed();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    const out = h.sh(`_swap_target() { echo "skip=[\${SWAP_TARGET_SKIP:-}]"; }; RESCUE_SKIP_RECENT=claude-a; _rescue_target ${ID} claude claude '' 0`);
    expect(out).toBe('skip=[]');
  });

  it('spread never buys a class degrade: a first-pass rc 6 falls through to the just-left-only pass', () => {
    seed();
    // claude-a is the only same-class target with room, and a rescue landed on
    // it minutes ago; with it skipped, `_swap_target` degrades onto claude-d.
    const out = h.sh(`_swap_target() { if [[ " \${SWAP_TARGET_SKIP:-} " == *" claude-a "* ]]; then echo claude-d; return 6; fi; echo claude-a; return 0; };
      RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=claude-a; out=$(_rescue_target ${ID} claude claude 1 0); echo "$out rc=$?"`);
    expect(out).toBe('claude-a rc=0');
  });

  it('a Codex-lane session on its fourth rescue in the hour is rescued at once, and its exclusion is written', () => {
    seed('gpt'); const t = now();
    writeTranscript([limitRow(t - 5, null, null)]);
    for (const ago of [3000, 2000, 1000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> gpt [home=claude]`);
    tick(PROMPT, 'claude-a');
    expect(dispatches()).toHaveLength(1);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-limits', 'gpt.json')), 'the lane\'s "pool is full" signal').toBe(true);
  });

  it('an auth-failure pane is never chain-waited — lost auth has no reset to wait for', () => {
    seed(); const t = now();
    writeTranscript([turn(t - 30)]);
    for (const ago of [3000, 2000, 1000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> claude [home=claude]`);
    tick(AUTH);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts`

Expected (measured at Task 3's tip with this file): FAIL, `8 failed | 47 passed (55)` — skip, spread, the fourth-rescue chain wait, chain expiry, the STALLED chain-reset case, home-return, the non-rescue byte-for-byte case and the class-degrade case (the last two on `_rescue_target: command not found`). Green before this task's guards and staying green: the least-used control, "…unless its logged five-hour reset has already passed", "spread is a preference…", "an unreadable swap log…", the ARMED chain-reset case (Task 3's arm already ends it), the chain→no-room case (red only through mutation 4.6, Review Focus item 4), and the Codex-lane and auth cases (no chain wait exists before this task; red only through mutations 4.10 and 4.11).

- [ ] **Step 3: Insert `_rescue_history` and `_rescue_target`**

Directly above `_rescue_policy() {` insert:

```bash
_rescue_history() {   # id -> 0 measured (RESCUE_COUNT, RESCUE_SKIP_LEFT, RESCUE_SKIP_RECENT set) | 2 unmeasurable (all empty)
  # RULE 3 READS THE SWAP LOG, which already carries every rescue with its
  # time, source and target — the same file §9's instrument reads, so the
  # policy and its measurement cannot disagree about what happened. Only the
  # tail (`RESCUE_LOG_TAIL_BYTES`) and only on a rescue decision. Its times are
  # `date '+%F %T'`, LOCAL time, so python converts with `mktime`.
  #   RESCUE_COUNT       this session's `auto-rescue` lines in RESCUE_CHAIN_WINDOW;
  #   RESCUE_SKIP_LEFT   their SOURCE accounts ("an account the session just
  #                      left blocked"), except one whose logged `reset=` passed;
  #   RESCUE_SKIP_RECENT every session's rescue TARGET in RESCUE_SPREAD_WINDOW.
  # UNMEASURABLE IS TODAY'S BEHAVIOUR: no chain wait, no skip. A log that does
  # not exist yet is a MEASURED empty history (rc 0), not an unreadable one.
  local id="$1" out
  RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""
  [[ -e "$REG/swap.log" ]] || return 0
  [[ -f "$REG/swap.log" && -r "$REG/swap.log" ]] || return 2
  command -v python3 >/dev/null 2>&1 || return 2
  out=$(tail -c "$RESCUE_LOG_TAIL_BYTES" "$REG/swap.log" 2>/dev/null | python3 -c '
import re, sys, time
sid, now, chain, spread = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
pat = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) auto-rescue (\S+): (\S+) \(blocked\) -> (\S+)(.*)$")
count, left, recent = 0, [], []
for raw in sys.stdin.buffer:
    m = pat.match(raw.decode("utf-8", "replace").rstrip("\n"))
    if not m:
        continue
    try:
        at = int(time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        continue
    age = now - at
    if age < 0:
        continue
    if m.group(2) == sid and age < chain:
        count += 1
        r = re.search(r" reset=(\d+)", m.group(5))
        if not (r and int(r.group(1)) <= now) and m.group(3) not in left:
            left.append(m.group(3))
    if age < spread and m.group(4) not in recent:
        recent.append(m.group(4))
print(str(count) + "|" + " ".join(left) + "|" + " ".join(recent))
' "$id" "$(date +%s)" "$RESCUE_CHAIN_WINDOW" "$RESCUE_SPREAD_WINDOW" 2>/dev/null) || return 2
  IFS='|' read -r RESCUE_COUNT RESCUE_SKIP_LEFT RESCUE_SKIP_RECENT <<<"$out"
  [[ "$RESCUE_COUNT" =~ ^[0-9]+$ ]] || { RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""; return 2; }
  return 0
}

```

Directly below `_rescue_policy`'s closing `}` and its blank line insert:

```bash
_rescue_target() {   # id cur home hard-blocked hrc -> `_swap_target`'s stdout and rc, rule 3's skip lists applied to a RESCUE
  # A NON-RESCUE CALL IS `_swap_target` BYTE FOR BYTE: the affinity path's
  # choice is not this spec's. For a rescue, SWAP_TARGET_SKIP names what the
  # candidate walk and the home-return branch pass over: first the accounts
  # this session just left blocked AND every target a rescue landed on inside
  # RESCUE_SPREAD_WINDOW; if that leaves nothing, the just-left accounts alone
  # ("prefers a target that has not received a rescue ... when another
  # placeable target exists"). A just-left account is never taken back while
  # it is skipped — that is "do not bounce". An undecidable answer (rc 2-5) is
  # returned as it came.
  # SPREAD IS A PREFERENCE, NEVER BOUGHT WITH A CLASS DEGRADE: the first pass's
  # name is taken only at rc 0. Its rc 6 ("a name, chosen one rung DOWN") can
  # mean the only same-class target with room is one the spread skipped — the
  # walk passes a skipped candidate before `_class_gate` counts it — and the
  # just-left-only pass below then decides, as it does for everything else.
  local out rc
  [[ -n "$4" && -n "$RESCUE_SKIP_LEFT$RESCUE_SKIP_RECENT" ]] || { _swap_target "$@"; return; }
  if [[ -n "$RESCUE_SKIP_RECENT" ]]; then
    out=$(SWAP_TARGET_SKIP="$RESCUE_SKIP_LEFT $RESCUE_SKIP_RECENT" _swap_target "$@"); rc=$?
    [[ -n "$out" && "$rc" -eq 0 ]] && { printf '%s\n' "$out"; return 0; }
    (( rc >= 2 && rc <= 5 )) && return "$rc"
  fi
  SWAP_TARGET_SKIP="$RESCUE_SKIP_LEFT" _swap_target "$@"
}

```

- [ ] **Step 4: Rule 3 in `_rescue_policy`**

Directly below the line `  local id="$1" wrapper="$2" pane="$3" hb="$4" now rec state kind since rreset rend R past=""` insert

```bash
  RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""
```

and replace the function's last two lines, `  return 0` / `}`, with:

```bash
  _rescue_history "$id" || return 0
  # THE CHAIN WAIT (rule 3) is for an ANTHROPIC lane on a rate-limit block,
  # and not past a reset that (a) already ruled on. A Codex-lane hold would
  # return before the rescue arm writes that lane's only "pool is full" signal
  # (`$LIMITS_DIR/<wrapper>.json`), so other sessions would keep landing on
  # the exhausted lane — the herd this rule exists to stop; lost auth has no
  # reset to wait for; and a STALLED session whose wait crossed its own reset
  # is rescued now, not parked again on the same reset.
  if [[ -z "$past" ]] && (( RESCUE_COUNT >= RESCUE_CHAIN_COUNT )) && _is_anthropic_backend "$wrapper" && ! _pane_auth_failed "$pane"; then
    [[ "$state" == open && "$kind" == noroom ]] && return 0
    if [[ "$state" == open && "$kind" == chain ]]; then
      [[ "$since" =~ ^[0-9]+$ ]] && (( now - since < RESCUE_CHAIN_WAIT )) && return 1
      return 0
    fi
    _rescuewait_open "$id" chain && return 1
  fi
  return 0
}
```

The finished function reads:

```bash
_rescue_policy() {   # id wrapper pane hard-blocked -> 0 PROCEED as today (rule 3's skip lists set) | 1 HOLD this tick
  # THE ONE CALL SITE is `_auto_swap_check`'s verdict line, below both
  # cooldown gates — so every wait sits INSIDE `SWAP_COOLDOWN` and
  # `SWAPBLOCK_COOLDOWN`, never instead of them — and above target choice.
  # `_tick_strand_undecidable` deliberately does not call it: a tick that
  # cannot decide has no rescue to hold.
  #
  # IN ORDER:
  #   (0) not blocked: any open wait ends, in the word the verdict gave
  #       (`carried-in`) or `clear` — which is how Claude Code's own timer, or
  #       the stale-phase Enter (D-2360), ends a wait at the reset;
  #   (a) a wait recorded against THIS dated reset: hold through the reset and
  #       its grace (a near wait from entry, a chain or no-room wait from the
  #       reset itself). Past the grace, an ARMED pane ends it `turned` and is
  #       held for good on this reset — Claude Code re-sends the turn itself. A
  #       STALLED pane is rescued as today: a near or chain wait ends `turned`
  #       and the tick proceeds (and takes no chain wait on this reset); a
  #       no-room wait stays open and ends in a swap once a target has room;
  #   (b) a near reset and an ARMED auto-continue: the near wait;
  #   (c) three rescues inside the hour: the chain wait, up to RESCUE_CHAIN_WAIT;
  #   otherwise proceed, with the accounts just left blocked and the targets
  #   just rescued onto set for `_rescue_target`.
  # (a) AND (b) NEED A ROW WRITTEN BEFORE ITS OWN RESET. A rate-limit row
  # written at or after its `resetsAt` says the account did NOT turn — §5.4
  # rule 2 ends a wait "in a swap if a rate-limit row newer than the reset
  # exists" — whatever reset it carries, and a row nobody could date waits on
  # nothing either. Such rows are real (a 14-day survey found `five_hour` rows
  # whose `resetsAt` was 10 hours to 8.5 days before their own timestamp).
  # WHY (b) — AND AN END IN PLACE — NEED AN ARMED AUTO-CONTINUE: mechanism 5
  # names the cost of D-2236 as "the wait for one whose reset is minutes away"
  # — the session Claude Code will continue by itself. A STALLED session
  # (auto-resume off, its re-arm cap hit, a human's Esc) has nothing that
  # re-sends its turn at the reset, and the redrive fallback cannot type for
  # it (see `_rescuewait_turned`), so a wait would park it; it is rescued as
  # today, by a swap whose `--resume` spawn re-drives the turn.
  local id="$1" wrapper="$2" pane="$3" hb="$4" now rec state kind since rreset rend R past=""
  RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""
  if [[ -z "$hb" ]]; then
    _rescuewait_close "$id" "${HARD_BLOCK_WHY:-clear}"
    return 0
  fi
  now=$(date +%s); R="${HARD_BLOCK_RESET:-}"
  rec=$(_reg_get "$id" rescuewait)
  state=$(_rw_field "$rec" state); kind=$(_rw_field "$rec" kind); since=$(_rw_field "$rec" since)
  rreset=$(_rw_field "$rec" reset); rend=$(_rw_field "$rec" end)
  if [[ "${HARD_BLOCK_TYPE:-}" == five_hour && "$R" =~ ^[0-9]+$ && "${HARD_BLOCK_ROWTS:-}" =~ ^[0-9]+$ ]] \
     && (( HARD_BLOCK_ROWTS < R )) && _is_anthropic_backend "$wrapper"; then
    if [[ "$rreset" == "$R" && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \
       && { [[ "$state" == open ]] || [[ "$state" == closed && "$rend" == turned ]]; }; then
      if (( now >= R + RESCUE_WAIT_GRACE )); then
        # THE WINDOW TURNED. Only an ARMED auto-continue re-sends the turn in
        # place, so only then does the wait end in place and hold on this reset.
        # A STALLED pane has nothing that re-sends it, and ccd types nothing here
        # (`_rescuewait_turned`), so it is rescued as today: a no-room wait stays
        # open and ends in a swap when a target gains room; any other wait ends
        # `turned` and does not reopen as a chain wait on this reset (`past`).
        if _pane_auto_continue_armed "$pane"; then
          [[ "$state" == open ]] && _rescuewait_turned "$id"
          return 1
        fi
        [[ "$state" == open && "$kind" != noroom ]] && { _rescuewait_close "$id" turned; state=closed; }
        past=1
      else
        [[ "$state" == open && ( "$kind" == near || "$now" -ge "$R" ) ]] && return 1
      fi
    fi
    if (( RESCUE_WAIT_BOUND > 0 && now >= R - RESCUE_WAIT_BOUND && now < R + RESCUE_WAIT_GRACE )) \
       && _pane_auto_continue_armed "$pane"; then
      _rescuewait_open "$id" near
      return 1
    fi
  fi
  _rescue_history "$id" || return 0
  # THE CHAIN WAIT (rule 3) is for an ANTHROPIC lane on a rate-limit block,
  # and not past a reset that (a) already ruled on. A Codex-lane hold would
  # return before the rescue arm writes that lane's only "pool is full" signal
  # (`$LIMITS_DIR/<wrapper>.json`), so other sessions would keep landing on
  # the exhausted lane — the herd this rule exists to stop; lost auth has no
  # reset to wait for; and a STALLED session whose wait crossed its own reset
  # is rescued now, not parked again on the same reset.
  if [[ -z "$past" ]] && (( RESCUE_COUNT >= RESCUE_CHAIN_COUNT )) && _is_anthropic_backend "$wrapper" && ! _pane_auth_failed "$pane"; then
    [[ "$state" == open && "$kind" == noroom ]] && return 0
    if [[ "$state" == open && "$kind" == chain ]]; then
      [[ "$since" =~ ^[0-9]+$ ]] && (( now - since < RESCUE_CHAIN_WAIT )) && return 1
      return 0
    fi
    _rescuewait_open "$id" chain && return 1
  fi
  return 0
}

```

- [ ] **Step 5: The skip list, line-neutral, in `_swap_target` and at the call site**

| Replace (one hit each; the first INSIDE `_swap_target` only — `_strand_why` carries the same text and is not touched) | With |
|---|---|
| `      [[ "$cand" == "$cur" ]] && continue` (in `_swap_target`'s `for cand in $(_pool_for "$id")` walk) | `      [[ "$cand" == "$cur" \|\| " ${SWAP_TARGET_SKIP:-} " == *" $cand "* ]] && continue` |
| `    if [[ "$hrc" -eq 0 ]] \` (the home-return branch) | `    if [[ "$hrc" -eq 0 && " ${SWAP_TARGET_SKIP:-} " != *" $home "* ]] \` |
| `  target=$(_swap_target "$id" "$wrapper" "$home" "$hard_blocked" "$hrc"); strc=$?` (in `_auto_swap_check`) | `  target=$(_rescue_target "$id" "$wrapper" "$home" "$hard_blocked" "$hrc"); strc=$?` |

`${SWAP_TARGET_SKIP:-}`, not `$SWAP_TARGET_SKIP`: a test extracts `_swap_target` with `declare -f` and runs it under `set -u`, and every other caller never sets it.

- [ ] **Step 6: Re-stamp, the corpus tax, and the tests**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l    # expect 163 — this task adds none
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/ccd-swap-target-class.test.ts \
  test/ccd-swap-pin.test.ts test/ccd-login-screen.test.ts test/ccd-authdead.test.ts test/ccd-auto-swap-hold.test.ts \
  test/ccd-limit-stale.test.ts test/ccd-pane-box-draft.test.ts
./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts test/ccd-crosspool.test.ts test/ccd-project-pool.test.ts
./node_modules/.bin/vitest run test/ccd-swap-carry.test.ts test/ccd-swap.test.ts test/ccd-default-pool.test.ts \
  test/ccd-account-ok.test.ts test/ccd-limits.test.ts test/ccd-die-containment.test.ts test/ccd-lifecycle-contain.test.ts
```

Expected: census unmoved; all PASS (`ccd-rescue-policy` 55/55 measured on the revised prototype; the neighbouring runs 142 and 126 cases on the first draft's prototype — re-measured on the revised one: `ccd-swap-target-class` 23/23, `ccd-swap-pin` 13/13, `ccd-auto-swap-pool` 43/43, `ccd-crosspool` 125/125).

- [ ] **Step 7: Mutation check, then commit**

| # | Exact edit in `ccd/ccd` | Command | Expected red (measured on the full prototype, 55 cases) |
|---|---|---|---|
| 4.1 | the walk's skip back to `      [[ "$cand" == "$cur" ]] && continue` | `./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts` | 5 failed: "a target the session just left blocked is skipped", "spread: …passed over…", "after RESCUE_CHAIN_WAIT the chain wait swaps…", "a STALLED chain wait whose account reset ends turned…" — `expected [ 'dispatch claude-demo -> claude-a' ] to deeply equal [ 'dispatch claude-demo -> claude-b' ]` — and "the home-return branch honours the skip too…" |
| 4.2 | the home-return branch back to `    if [[ "$hrc" -eq 0 ]] \` | same | "the home-return branch honours the skip too…" only — `expected [ 'dispatch claude-demo -> claude' ] to deeply equal [ 'dispatch claude-demo -> claude-a' ]` |
| 4.3 | `_rescue_target`'s last line `  SWAP_TARGET_SKIP="$RESCUE_SKIP_LEFT" _swap_target "$@"` → `  return 1` | same | 8 failed: "a target the session just left blocked is skipped", "spread is a preference…", "after RESCUE_CHAIN_WAIT…", "a STALLED chain wait…", "the home-return branch…" — `expected [] to deeply equal [ 'dispatch claude-demo -> claude-b' ]` — "spread never buys a class degrade…" (`expected 'rc=1' to be 'claude-a rc=0'`), and the Codex-lane and auth-chain cases (no target: strand) |
| 4.4 | `(( RESCUE_COUNT >= RESCUE_CHAIN_COUNT ))` → `>` | same | "a fourth rescue within the hour takes the chain wait…" only |
| 4.5 | the chain arm `      [[ "$since" =~ ^[0-9]+$ ]] && (( now - since < RESCUE_CHAIN_WAIT )) && return 1` / `      return 0` → `      return 1` | same | "after RESCUE_CHAIN_WAIT the chain wait swaps…" and "a chain wait at its bound with no target that has room…" — `expected [] to deeply equal [ 'dispatch claude-demo -> claude-b' ]` |
| 4.6 | delete `    [[ "$state" == open && "$kind" == noroom ]] && return 0` | same | "a chain wait at its bound with no target that has room becomes the no-room wait" only — `the no-room wait flapped back into a chain wait: expected [ …(2) ] to have a length of 1 but got 2` |
| 4.7 | in `_rescue_history`'s python, `        if not (r and int(r.group(1)) <= now) and m.group(3) not in left:` → `        if m.group(3) not in left:` | same | "…unless its logged five-hour reset has already passed" only — `expected [ 'dispatch claude-demo -> claude-b' ] to deeply equal [ 'dispatch claude-demo -> claude-a' ]` |
| 4.8 | `  _rescue_history "$id" \|\| return 0` → `\|\| return 1` | same | "an unreadable swap log is today's behaviour: no chain wait, no skip" only — `expected [] to deeply equal [ 'dispatch claude-demo -> claude-a' ]` |
| 4.9 | `  if [[ -z "$past" ]] && (( RESCUE_COUNT` → `  if (( RESCUE_COUNT` | same | "a STALLED chain wait whose account reset ends turned and the tick rescues, with no second chain wait" only — `claude-a is the account it just left blocked: expected [] to deeply equal [ 'dispatch claude-demo -> claude-b' ]` |
| 4.10 | the chain line's ` && _is_anthropic_backend "$wrapper" && ! _pane_auth_failed "$pane"; then` → ` && ! _pane_auth_failed "$pane"; then` | same | "a Codex-lane session on its fourth rescue in the hour is rescued at once…" only — `expected [] to have a length of 1 but got +0` |
| 4.11 | the chain line's `_is_anthropic_backend "$wrapper" && ! _pane_auth_failed "$pane"; then` → `_is_anthropic_backend "$wrapper"; then` | same | "an auth-failure pane is never chain-waited…" only — `expected 'state=open kind=chain since=…' to be null` |
| 4.12 | in `_rescue_target`, `    [[ -n "$out" && "$rc" -eq 0 ]] && { printf '%s\n' "$out"; return 0; }` → `    [[ -n "$out" ]] && { printf '%s\n' "$out"; return "$rc"; }` | same | "spread never buys a class degrade…" only — `expected 'claude-d rc=6' to be 'claude-a rc=0'` |

```bash
git add ccd/ccd server/test/ccd-rescue-policy.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): spread rescues, do not bounce, chain-wait the fourth (continuity rule 3)

_rescue_history reads the tail of swap.log (RESCUE_LOG_TAIL_BYTES — the
busiest measured hour wrote 233,896 bytes) for this session's rescues in the
last hour and every rescue target in the last ten minutes. A rescue then skips
every account the session left blocked in that hour (until the logged reset
passes), prefers a target no rescue landed on in RESCUE_SPREAD_WINDOW when
another has room (never at the price of a class degrade: a first-pass rc 6
falls through), and a fourth rescue within the hour on an Anthropic lane, not
on lost auth, chain-waits up to RESCUE_CHAIN_WAIT=1800 s (kind=chain), then
swaps; with no room it becomes the no-room wait, which a still-full hour does
not turn back into a chain wait. A stalled chain wait whose reset turned is
rescued at once, with no second chain wait on that reset.
_swap_target honours SWAP_TARGET_SKIP in its candidate walk AND its
home-return branch; _rescue_target applies it to rescues only, so the affinity
path is byte-for-byte unchanged. An unreadable log is today's behaviour.

S6-R11: line-neutral above the corpus; no _reg_get call added.
MSG
)"
```

---

### Task 5: The stage-4 instrument, and README

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Create or modify: `deploy/measure-continuity.py`
- Create: `server/test/measure-continuity-stage4.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `swap.log` lines of Tasks 2–4 and `cmd_swap`'s existing `swap <id>: <from> -> <to> (uuid …)` line.
- Produces: `python3 deploy/measure-continuity.py [--stage N]… [--home DIR] [--swap-log PATH] [--since T] [--until T] [--deployed T] [--all-copies] [--json]` — the programme's ONE CLI and ONE registry, the cross-wave contract both continuity waves write: `STAGES = {N: stageN}`, `stageN(ctx)` returning a dict of NAMED SECTIONS, the report `{"stage<N>": {<section>: {…}}}`. `ctx` carries `home`, `swap_log` (default `<home>/.cc-sessions/swap.log`), `since` and `until` as EPOCHS (swap.log's LOCAL-time stamps convert with `time.mktime`, a transcript's ISO `Z` stamps with `calendar.timegm`), `all_copies`, `deployed`. `--stage` is repeatable, default every registered stage; read-only; exit 0 on success. Wave 1 owns stage 1 (sections `carry`, `resume`); this wave owns stage 4, section `rescue`: `{rescues, sessions_with_4plus_rescues_in_an_hour, max_rescues_in_an_hour, chain_waits_ending_in_neither_swap_nor_reset, rescues_on_a_carried_in_banner, rescues_with_a_dated_row, near_reset_waits_ending_in_a_swap, rule1_suppressions, rule1_suppressions_rescued_within_5min, waits_opened_by_kind, waits_ended_by_kind_and_end, noroom_waits_past_their_reset, noroom_waits_past_their_reset_by_end, noroom_seconds_past_their_reset_total, noroom_seconds_past_their_reset_max}`, or `{swap_log: "absent"}` — spec §9's stage-4 rows except "non-rescue swaps that cut delegated work" (wave 7's). The four `noroom_…` rows are §11 item 6's count (ruled 2026-09-24, "leave it and count it"): a stalled session whose own account is the only one with room, left idle in the no-room wait after that account resets.

**Whichever continuity wave lands first writes the file.** If `deploy/measure-continuity.py` does NOT exist when this task starts, create it exactly as Step 3 gives it — its header, helpers and argparse are the contract's, and wave 1, landing later, adds only its own `# ── stage 1` block and its `STAGES` entry. If it DOES exist because wave 1 merged first, keep its header, helpers and argparse; add only this plan's `# ── stage 4 (wave 2)` block (from that comment down to, not including, `STAGES = {`), the entry `4: stage4,` in its `STAGES`, and any contract flag its argparse still lacks. The stage-4 block is self-contained — it reads `ctx` through its own `s4_ctx` (dict or attribute namespace alike) and uses no helper outside the block — so it drops in unchanged either way, and this task's test must pass unchanged. Should that file's CLI or `ctx` depart from the contract above, stop and report rather than adapt either side.

- [ ] **Step 1: Write the failing test**

Create `server/test/measure-continuity-stage4.test.ts`:

```ts
// `deploy/measure-continuity.py`'s stage-4 rows (session-continuity spec §9;
// wave 2). The instrument is READ-ONLY and stage 4 reads swap.log (and, for a
// no-room wait still open now, that session's `.rescuewait` record), so
// two things are pinned: each row counts what its name says on a hand-built
// log whose answer is known, and each regex it parses is bound to a line the
// REAL ccd function wrote — a reworded ccd line reds here, not silently on the
// fleet. The CLI is the programme's shared one (`--stage N`, `--home`,
// `--swap-log`, `--since`, `--until`, `--json`), whichever wave wrote it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-'); });
afterEach(() => { h.cleanup(); });

type Rescue = Record<string, number | string | Record<string, number>>;
/** `--home <home> --stage 4 [extra] --json`, answering stage 4's `rescue` section. */
const run = (home: string, extra: string[] = [], env: Record<string, string> = {}): Rescue => {
  const out = execFileSync('python3', [TOOL, '--home', home, '--stage', '4', ...extra, '--json'],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  return (JSON.parse(out) as { stage4: { rescue: Rescue } }).stage4.rescue;
};
const utc = (s: string): number => Math.floor(Date.parse(`${s.replace(' ', 'T')}Z`) / 1000);

describe('stage 4 rows count what their names say (TZ=UTC, hand-built log)', () => {
  const lines = [
    // s1 landed at 10:00; its 10:30 rescue fired on a row from 09:50 (carried in), its 10:40 one on a row from 10:35.
    '2026-09-20 10:00:00 swap s1: claude -> claude-a (uuid u1)',
    `2026-09-20 10:30:00 auto-rescue s1: claude-a (blocked) -> claude-b [home=claude] via=transcript reset=${utc('2026-09-20 12:00:00')} type=five_hour row=${utc('2026-09-20 09:50:00')}`,
    `2026-09-20 10:40:00 auto-rescue s1: claude-b (blocked) -> claude-d [home=claude] via=banner row=${utc('2026-09-20 10:35:00')}`,
    // s2: four rescues inside one hour, no dated row.
    ...['10:00', '10:15', '10:30', '10:59'].map((m) => `2026-09-20 ${m}:00 auto-rescue s2: claude (blocked) -> claude-a [home=claude]`),
    // rule 1: s3's suppression became a rescue 3 minutes later; s4's did not within 5.
    '2026-09-20 11:00:00 carried-in s3: via=pane rate-limit row at 1 predates the landing at 2 — not a block [wrapper=claude]',
    '2026-09-20 11:03:00 auto-rescue s3: claude (blocked) -> claude-a [home=claude]',
    '2026-09-20 11:00:00 carried-in s4: via=transcript rate-limit row at 1 predates the landing at 2 — not a block [wrapper=claude]',
    '2026-09-20 11:10:00 auto-rescue s4: claude (blocked) -> claude-a [home=claude]',
    // waits: a near wait ending in a swap; three chain waits, ending clear BEFORE its reset (neither),
    // turned (a reset), and noroom (neither).
    '2026-09-20 12:00:00 rescuewait s5: kind=near on claude reset=1',
    '2026-09-20 12:05:00 rescuewait-end s5: kind=near on claude reset=1 after 300s end=swap',
    `2026-09-20 12:10:00 rescuewait-end s6: kind=chain on claude reset=${utc('2026-09-20 13:00:00')} after 60s end=clear`,
    '2026-09-20 12:10:00 rescuewait-end s7: kind=chain on claude reset=1 after 60s end=turned',
    '2026-09-20 12:10:00 rescuewait-end s8: kind=chain on claude reset=- after 1800s end=noroom',
    // §11 item 6 (stalled, own account the only one with room): no-room waits against a 13:30 reset.
    // s9 idled 30 minutes past it and then swapped (counted); s10's armed pane ended it in place
    // (`turned`, not counted); s11 swapped inside the grace (not counted); s12 had no reset (not
    // counted); s13 is still open, against a 13:10 reset (counted, measured to the window's end);
    // s14's session was purged mid-wait, so no end line exists and the registry holds no record
    // (not counted when measuring now — the registry, not the log, says a wait is open now); s15's
    // record was re-used by a later session of the same id and is closed (not counted either).
    `2026-09-20 13:00:00 rescuewait s9: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')}`,
    `2026-09-20 13:00:00 rescuewait s10: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')}`,
    `2026-09-20 13:00:00 rescuewait s13: kind=noroom on claude-b reset=${utc('2026-09-20 13:10:00')}`,
    `2026-09-20 13:31:00 rescuewait-end s11: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')} after 600s end=swap`,
    `2026-09-20 13:32:05 rescuewait-end s10: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')} after 1925s end=turned`,
    `2026-09-20 14:00:00 rescuewait-end s9: kind=noroom on claude reset=${utc('2026-09-20 13:30:00')} after 3600s end=swap`,
    '2026-09-20 15:00:00 rescuewait-end s12: kind=noroom on claude reset=- after 9000s end=swap',
    `2026-09-20 15:10:00 rescuewait s14: kind=noroom on claude reset=${utc('2026-09-20 15:05:00')}`,
    `2026-09-20 15:10:00 rescuewait s15: kind=noroom on claude reset=${utc('2026-09-20 15:05:00')}`,
  ];
  const handLog = (): string => {
    const log = path.join(h.home, 'hand-built-swap.log');
    fs.writeFileSync(log, lines.join('\n') + '\n');
    return log;
  };

  it('every row on a log whose answer is known', () => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 's13.rescuewait'),
      `state=open kind=noroom since=${utc('2026-09-20 13:00:00')} reset=${utc('2026-09-20 13:10:00')} wrapper=claude-b\n`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 's15.rescuewait'),
      `state=closed kind=near since=1 reset=- wrapper=claude until=2 end=swap\n`);
    const r = run(h.home, ['--swap-log', handLog()], { TZ: 'UTC' });
    expect(r.rescues).toBe(8);
    expect(r.sessions_with_4plus_rescues_in_an_hour).toBe(1);
    expect(r.max_rescues_in_an_hour).toBe(4);
    expect(r.rescues_with_a_dated_row).toBe(2);
    expect(r.rescues_on_a_carried_in_banner).toBe(1);
    expect(r.rule1_suppressions).toBe(2);
    expect(r.rule1_suppressions_rescued_within_5min).toBe(1);
    expect(r.near_reset_waits_ending_in_a_swap).toBe(1);
    expect(r.chain_waits_ending_in_neither_swap_nor_reset).toBe(2);
    expect(r.waits_opened_by_kind).toEqual({ near: 1, noroom: 5 });
    expect(r.waits_ended_by_kind_and_end).toEqual({
      'chain:clear': 1, 'chain:noroom': 1, 'chain:turned': 1, 'near:swap': 1, 'noroom:swap': 3, 'noroom:turned': 1,
    });
    expect(r.noroom_waits_past_their_reset, 's9 swapped late; s13 open in the registry; not s14 (purged) or s15 (closed)').toBe(2);
    expect(r.noroom_waits_past_their_reset_by_end).toEqual({ open: 1, swap: 1 });
  });

  // §11 item 6, ruled 2026-09-24: a stalled session whose own account is the only
  // one with room idles as today, and the instrument counts it. A still-open wait
  // is measured to the window's end, so this case pins the seconds with `--until`.
  it('no-room waits past their reset: counted to their end or the window\'s, from the reset, beyond the grace', () => {
    const r = run(h.home, ['--swap-log', handLog(), '--since', '2026-09-20 13:45', '--until', '2026-09-20 15:00'], { TZ: 'UTC' });
    expect(r.noroom_waits_past_their_reset, 's9 ended in the window; s13 opened before it and is open at its end').toBe(2);
    expect(r.noroom_waits_past_their_reset_by_end).toEqual({ open: 1, swap: 1 });
    expect(r.noroom_seconds_past_their_reset_max, 's13: 15:00 - 13:10').toBe(6600);
    expect(r.noroom_seconds_past_their_reset_total, 's9: 14:00 - 13:30, plus s13').toBe(1800 + 6600);
    const grace = (src: string, re: RegExp): string => (re.exec(src) ?? ['', 'absent'])[1];
    expect(grace(fs.readFileSync(TOOL, 'utf8'), /^S4_GRACE = (\d+)/m), 'the instrument\'s grace is ccd\'s')
      .toBe(grace(fs.readFileSync(CCD, 'utf8'), /^RESCUE_WAIT_GRACE=(\d+)/m));
  });

  it('--since is inclusive and --until exclusive, as local-time epochs, in either spelling', () => {
    const r = run(h.home, ['--swap-log', handLog(), '--since', '2026-09-20 11:00', '--until', '2026-09-20T11:10'], { TZ: 'UTC' });
    expect(r.rescues, 's3 at 11:03 is in; s4 at 11:10 is at the exclusive bound').toBe(1);
    expect(r.rule1_suppressions).toBe(2);
  });

  it('opens the default log read-only and writes nothing; an absent log says so', () => {
    const log = path.join(h.home, '.cc-sessions', 'swap.log');
    fs.writeFileSync(log, '2026-09-20 10:00:00 swap s1: claude -> claude-a (uuid u1)\n');
    fs.chmodSync(log, 0o444);
    const before = fs.readdirSync(h.home).sort();
    expect(run(h.home).rescues).toBe(0);
    expect(fs.readdirSync(h.home).sort()).toEqual(before);
    expect(run(h.home, ['--swap-log', path.join(h.home, 'nope.log')])).toEqual({ swap_log: 'absent' });
  });
});

describe('each regex is bound to the line the real ccd writes', () => {
  const ID = 'claude-demo';
  it('auto-rescue (with its dated tokens), rescuewait, rescuewait-end and carried-in all parse', () => {
    const t = Math.floor(Date.now() / 1000);
    h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} home claude; _reg_set ${ID} project demo
          _reg_set ${ID} workdir "$HOME/projects/demo"; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`);
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const p = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant', uuid: 'b', timestamp: new Date((t - 5) * 1000).toISOString(),
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'limit' }] },
      isApiErrorMessage: true, error: 'rate_limit', quotaLimits: { status: 'rejected', resetsAt: t + 9000, rateLimitType: 'five_hour' },
    }) + '\n');
    const stubs = `tmux() { ${WIDE_PANE} case "\${1:-}" in capture-pane) printf '%s\\n' '❯ ' ;; esac; return 0; };
      _pane_box_draft() { printf ''; }; _swap_target() { echo claude-a; }; _dispatch_swap() { :; };`;
    h.sh(`${stubs} HARD_BLOCK_TYPE=five_hour HARD_BLOCK_RESET=${t + 300}; _rescuewait_open ${ID} near`);
    h.sh(`${stubs} _auto_swap_check ${ID}`);                 // closes the near wait as a swap, and logs the rescue
    h.sh(`HARD_BLOCK_VIA=pane; _carried_in_note ${ID} ${t} ${t - 100}`);
    const r = run(h.home);                                   // the DEFAULT log: <home>/.cc-sessions/swap.log
    expect(r.rescues).toBe(1);
    expect(r.rescues_with_a_dated_row).toBe(1);
    expect(r.waits_opened_by_kind).toEqual({ near: 1 });
    expect(r.waits_ended_by_kind_and_end).toEqual({ 'near:swap': 1 });
    expect(r.near_reset_waits_ending_in_a_swap).toBe(1);
    expect(r.rule1_suppressions).toBe(1);
  });

  it('the landing line the carried-in row compares against is cmd_swap\'s own', () => {
    expect(fs.readFileSync(CCD, 'utf8')).toContain(`echo "$(date '+%F %T') swap $id: $cur -> $target (uuid $uuid)" >> "$REG/swap.log"`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `(cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage4.test.ts)`

Expected: FAIL. If the file does not exist yet: every case but the landing-line source pin red on `python3: can't open file …/deploy/measure-continuity.py` (`5 failed | 1 passed (6)`, measured); the pin passes because that line predates this wave. If wave 1 created the file first, the same five red instead on its argparse refusing `--stage 4` (`argument --stage: invalid choice: 4`, exit 2) or on a missing `stage4` key — not ENOENT.

- [ ] **Step 3: Write the instrument**

Create `deploy/measure-continuity.py` (mode 0755) — or, if it exists, add to it as the paragraph above Step 1 says:

```python
#!/usr/bin/env python3
"""measure-continuity.py — the session-continuity programme's instrument (spec §9). READ-ONLY.

Run by hand on the fleet box, as the fleet user; it opens every file it reads
read-only, writes nothing anywhere, and never runs `ccd`, tmux or a unit.

    python3 deploy/measure-continuity.py                          # every stage, table
    python3 deploy/measure-continuity.py --stage 4 --json         # one stage, JSON
    python3 deploy/measure-continuity.py --since 2026-09-24 --until '2026-09-25 06:00'

THE REGISTRY. `STAGES = {N: stageN}`: each wave adds the §9 rows it owns as
one `stageN(ctx)` function, in the same PR as the mechanism those rows
measure, and registers it here. A stage returns a dict of NAMED SECTIONS; the
report is `{"stage<N>": {<section>: {<row>: value}}}`. Whichever wave lands
first writes this header, these helpers and the argparse; a later wave adds
only its own `# ── stage N` block, its `STAGES` entry and any flag still
missing. Every stage block is self-contained — it uses no helper outside it —
so it drops into the file unchanged whichever wave wrote the rest.

`ctx` is a dict: `home`; `swap_log` (default `<home>/.cc-sessions/swap.log`);
`since` and `until` as EPOCH seconds (`since` inclusive, `until` exclusive,
either None); `all_copies`; `deployed` (an epoch or None). The CLI's time
arguments take `YYYY-MM-DD`, `YYYY-MM-DD HH:MM[:SS]` or the same with `T`,
read as LOCAL time on the box running this. swap.log's stamps are
`date '+%F %T'`, LOCAL time too, so they convert with `time.mktime`; a
transcript's ISO `…Z` stamps are UTC and convert with `calendar.timegm`. Run
it on the fleet box (or with TZ set to that box's zone).
"""
import argparse
import calendar
import collections
import json
import os
import re
import sys
import time


def cli_epoch(value):
    """A --since/--until/--deployed argument -> epoch seconds (LOCAL time), or None."""
    if value is None:
        return None
    v = value.replace('T', ' ')
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
        try:
            return int(time.mktime(time.strptime(v, fmt)))
        except ValueError:
            continue
    raise SystemExit(f'measure-continuity: not a time: {value!r} (YYYY-MM-DD[ HH:MM[:SS]])')


def iso_epoch(stamp):
    """A transcript's ISO 'YYYY-MM-DDTHH:MM:SS…Z' stamp -> epoch seconds (UTC), or None."""
    try:
        return calendar.timegm(time.strptime(stamp[:19], '%Y-%m-%dT%H:%M:%S'))
    except (TypeError, ValueError, OverflowError):
        return None


# ── stage 4 (wave 2): the rescue policy ─────────────────────────────────────
# Every row reads swap.log; the no-room rows also read a session's
# `.rescuewait` record, read-only, to tell a wait open NOW from one a purge
# cut short. The line shapes are ccd's own, and
# `server/test/measure-continuity-stage4.test.ts` binds each regex below to a
# line the real ccd function wrote. Self-contained: nothing outside this block.
S4_TS = r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)"
S4_RESCUE = re.compile(S4_TS + r" auto-rescue (\S+): (\S+) \(blocked\) -> (\S+) \[home=[^\]]*\](.*)$")
S4_LANDING = re.compile(S4_TS + r" swap (\S+): (\S+) -> (\S+) \(uuid ")
S4_CARRIED = re.compile(S4_TS + r" carried-in (\S+): via=(\S+) ")
S4_WAIT_OPEN = re.compile(S4_TS + r" rescuewait (\S+): kind=(\S+) on (\S+) reset=(\S+)$")
S4_WAIT_END = re.compile(S4_TS + r" rescuewait-end (\S+): kind=(\S+) on (\S+) reset=(\S+) after (\d+)s end=(\S+)$")
S4_TOKEN = re.compile(r" (reset|type|row)=(\d+|[a-z_]+)")
# ccd's RESCUE_WAIT_GRACE; the stage-4 test binds the two numbers together.
S4_GRACE = 120


def s4_ctx(ctx, key):
    """The registry's context: a dict here, read through this so the block also
    runs under a file whose first wave built an attribute namespace."""
    return ctx[key] if isinstance(ctx, dict) else getattr(ctx, key)


def s4_epoch(stamp):
    """swap.log's LOCAL-time stamp -> epoch seconds (time.mktime), or None."""
    try:
        return int(time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        return None


def stage4(ctx):
    since, until = s4_ctx(ctx, "since"), s4_ctx(ctx, "until")
    path = s4_ctx(ctx, "swap_log") or os.path.join(s4_ctx(ctx, "home"), ".cc-sessions", "swap.log")
    try:
        with open(path, "rb") as fh:
            lines = [raw.decode("utf-8", "replace").rstrip("\n") for raw in fh]
    except FileNotFoundError:
        return {"rescue": {"swap_log": "absent"}}
    rescues, landings, carried = [], collections.defaultdict(list), []
    opened, ended = collections.Counter(), collections.Counter()
    chain_neither, near_swap = 0, 0
    # §11 item 6, ruled 2026-09-24 "leave it and count it": a STALLED session
    # whose own account is the only one with room idles in the no-room wait
    # after that account resets, because only an ARMED pane ends a wait in place
    # there (`turned`). Counted: a no-room wait with a numeric reset, not ended
    # `turned`, whose end (its end line in the window) or, still open, the
    # window's end (`--until`, else now) is more than S4_GRACE past its reset;
    # seconds run from the reset. `pending` pairs each session's entry line with
    # its exit line — the record holds one wait at a time, so they alternate.
    # A purge removes the record and writes no exit line, so a wait measured
    # NOW is open only while `<home>/.cc-sessions/<id>.rescuewait` still says
    # `state=open` (a later session of the same id may have re-used a closed
    # one); a past window (`--until`) has only the log, and a session purged
    # mid-wait there counts to the window's end.
    ref = until if until is not None else int(time.time())
    pending, past = {}, []
    inwin = lambda t: t is not None and (since is None or t >= since) and (until is None or t < until)
    for line in lines:
        m = S4_LANDING.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if t is not None:
                landings[m.group(2)].append(t)
            continue
        m = S4_RESCUE.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if inwin(t):
                rescues.append((t, m.group(2), dict(S4_TOKEN.findall(m.group(5)))))
            continue
        m = S4_CARRIED.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if inwin(t):
                carried.append((t, m.group(2), m.group(3)))
            continue
        m = S4_WAIT_OPEN.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if inwin(t):
                opened[m.group(3)] += 1
            if t is not None and t < ref:
                pending[m.group(2)] = (m.group(3), m.group(5))
            continue
        m = S4_WAIT_END.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if t is not None and t < ref:
                pending.pop(m.group(2), None)
            if not inwin(t):
                continue
            kind, reset, end = m.group(3), m.group(5), m.group(7)
            ended[f"{kind}:{end}"] += 1
            if kind == "noroom" and end != "turned" and reset.isdigit() and t > int(reset) + S4_GRACE:
                past.append((end, t - int(reset)))
            at_reset = end == "turned" or (end == "clear" and reset.isdigit() and t >= int(reset))
            if kind == "chain" and end != "swap" and not at_reset:
                chain_neither += 1
            if kind == "near" and end == "swap":
                near_swap += 1

    for sid, (kind, reset) in pending.items():
        if kind != "noroom" or not reset.isdigit() or ref <= int(reset) + S4_GRACE:
            continue
        if until is None:
            try:
                with open(os.path.join(s4_ctx(ctx, "home"), ".cc-sessions", sid + ".rescuewait")) as fh:
                    rec = fh.read().split()
            except OSError:
                continue
            if "state=open" not in rec:
                continue
        past.append(("open", ref - int(reset)))
    past_by_end = collections.Counter(end for end, _ in past)

    # Sessions with RESCUE_CHAIN_COUNT + 1 (= 4) or more auto-rescues inside any 60 minutes.
    by_sess = collections.defaultdict(list)
    for t, sid, _ in rescues:
        by_sess[sid].append(t)
    worst, four_plus = 0, 0
    for ts in by_sess.values():
        ts.sort()
        best = max((sum(1 for u in ts if t <= u < t + 3600) for t in ts), default=0)
        worst = max(worst, best)
        four_plus += best >= 4

    # A rescue on a carried-in banner: its dated row is older than the landing
    # the LOG records for that session (the newest `swap <id>:` line before the
    # rescue) — measured from the log, not from the `.landed` stamp that decided.
    dated, on_carried = 0, 0
    for t, sid, tok in rescues:
        if "row" not in tok:
            continue
        dated += 1
        before = [u for u in landings.get(sid, []) if u <= t]
        if before and int(tok["row"]) < max(before) - 1:
            on_carried += 1

    # A rule-1 suppression that became a rescue of the same session within 5 minutes.
    became = sum(1 for t, sid, _ in carried if any(r[1] == sid and 0 <= r[0] - t <= 300 for r in rescues))

    return {"rescue": {
        "rescues": len(rescues),
        "sessions_with_4plus_rescues_in_an_hour": four_plus,
        "max_rescues_in_an_hour": worst,
        "chain_waits_ending_in_neither_swap_nor_reset": chain_neither,
        "rescues_on_a_carried_in_banner": on_carried,
        "rescues_with_a_dated_row": dated,
        "near_reset_waits_ending_in_a_swap": near_swap,
        "rule1_suppressions": len(carried),
        "rule1_suppressions_rescued_within_5min": became,
        "waits_opened_by_kind": dict(sorted(opened.items())),
        "waits_ended_by_kind_and_end": dict(sorted(ended.items())),
        "noroom_waits_past_their_reset": len(past),
        "noroom_waits_past_their_reset_by_end": dict(sorted(past_by_end.items())),
        "noroom_seconds_past_their_reset_total": sum(s for _, s in past),
        "noroom_seconds_past_their_reset_max": max((s for _, s in past), default=0),
    }}


STAGES = {
    4: stage4,
}


def main(argv):
    ap = argparse.ArgumentParser(description='session-continuity instrument (read-only)')
    ap.add_argument('--stage', type=int, choices=sorted(STAGES), action='append',
                    help='a stage to report (repeatable; default every registered stage)')
    ap.add_argument('--home', default=os.path.expanduser('~'))
    ap.add_argument('--swap-log', help='default <home>/.cc-sessions/swap.log')
    ap.add_argument('--since', help='inclusive, local time: YYYY-MM-DD[ HH:MM[:SS]]')
    ap.add_argument('--until', help='exclusive, same form')
    ap.add_argument('--deployed', help='a stage\'s deploy time, same form (stages that report around it)')
    ap.add_argument('--all-copies', action='store_true', help='read every transcript copy, not the largest per uuid')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args(argv)
    ctx = {
        'home': a.home,
        'swap_log': a.swap_log or os.path.join(a.home, '.cc-sessions', 'swap.log'),
        'since': cli_epoch(a.since),
        'until': cli_epoch(a.until),
        'all_copies': a.all_copies,
        'deployed': cli_epoch(a.deployed),
    }
    report = {f'stage{n}': STAGES[n](ctx) for n in (a.stage or sorted(STAGES))}
    if a.json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    print(f'window: {a.since or "-"} .. {a.until or "-"}')
    for stage, sections in report.items():
        for name, rows in sections.items():
            print(f'[{stage}.{name}]')
            for k, v in rows.items():
                print(f'  {k}: {json.dumps(v, sort_keys=True) if isinstance(v, dict) else v}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the test and the live baseline (read-only)**

```bash
chmod 0755 deploy/measure-continuity.py
(cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage4.test.ts)
python3 deploy/measure-continuity.py --stage 4 --since 2026-09-08 --until 2026-09-24
```

The test runs in a subshell, so the baseline command runs from the repo root whether the test passed or not. Expected: `6 passed`. On the fleet box the baseline prints (measured at planning, and again with the `noroom_…` rows on 2026-09-24) `rescues: 248`, `sessions_with_4plus_rescues_in_an_hour: 4`, `max_rescues_in_an_hour: 4`, and 0 (or `{}`) for every row this wave's words feed, the four `noroom_…` rows included — no wait is recorded before this wave deploys. The tool opens `swap.log` read-only and writes nothing; if you are not on the fleet box, skip the second command and say so in the wave-done.

- [ ] **Step 5: README**

(a) In "A restart re-drives the turn it interrupted", replace

```text
(`compact-skip <id>: auto-continue`), the `/effort` injection, and the fallback re-drive. The rescue
arm is deliberately **not** gated: a swap that re-drives beats waiting out the window. On the PWA the
```

with

```text
(`compact-skip <id>: auto-continue`), the `/effort` injection, and the fallback re-drive. The rescue
arm is not gated on it either — a swap that re-drives beats waiting out the window — except within
ten minutes of the account's own five-hour reset, where it now waits (next section but one). On the PWA the
```

(b) In the next section, `Its positive or negative transcript verdict is cached in` → `Its positive, negative or unread transcript verdict is cached in`.

(c) Directly above `### One memory store per project: \`ccrc memory\`` insert:

```markdown
### A carried-in banner is not a block, and the rescue waits near a reset (session-continuity stage 4)

Rules 1–3 of `docs/superpowers/specs/2026-09-23-session-continuity-design.md` §5.4. Before them, 32 of
248 auto-rescues (2026-09-08..09-23) fired on a limit banner the session had carried in from its
previous account, and no rescue decision read the reset the transcript already carried.

- **A carried-in banner is not a block.** `cmd_swap` stamps `$REG/<id>.landed` (`<epoch> <wrapper>`)
  after the carry and before the unit starts. Every positive of `_session_hard_blocked` — pane,
  banner or transcript rung — is then dated by the transcript's newest rate-limit row
  (`_transcript_limit_banner <path> newest`, never cached); a row strictly older than the landing is
  not a block, said once per landing as `carried-in <id>: …` in `swap.log`. No `.landed`, no
  rate-limit row in the window, a transcript it cannot read, or an auth-failure pane keeps the
  verdict exactly as before. `.tscan` now caches `2` for a transcript nobody could read, distinct
  from `0`, a transcript read with no banner.
- **Near a five-hour reset the rescue waits.** A `five_hour` row on an Anthropic lane, written
  before its own `resetsAt`, whose reset is within `RESCUE_WAIT_BOUND=600` seconds, with Claude
  Code's auto-continue armed on the pane, leaves that auto-continue alone and types nothing. The wait
  ends at the reset (Claude Code's own timer, or the stale-phase Enter), or `RESCUE_WAIT_GRACE=120`
  seconds after it: in a swap if a newer rate-limit row exists; otherwise, while the pane is still
  armed, in place — the redrive fallback runs through its own gate — and never in a swap away from an
  account that has just reset. `0` turns the wait off. A stalled session (nothing armed), a
  `seven_day` or Codex-lane block, a row with no reset, or a row written at or after its own reset
  swaps as before; `~/.cc-limits` is not a fallback, because it cannot say which window blocked.
- **No room is a wait too.** Today's `stranded` path also records `kind=noroom`; it ends in a swap
  when a target gains room. At its reset an armed session ends it in place, under the same two
  conditions; a stalled one is rescued as before — nothing re-sends its turn in place, so it stays in
  the no-room wait and swaps the moment a target has room, whose `--resume` spawn re-drives the turn.
  When its own account is the only one with room it idles there as before; `--stage 4` counts
  those waits and the seconds each spent past its reset (spec §11 item 6).
- **Spread, do not bounce, chain-wait.** A rescue skips every account this session left blocked in
  the last hour (until that rescue's logged reset passes), and prefers a target no rescue landed on in
  the last `RESCUE_SPREAD_WINDOW=600` seconds when another has room — never at the price of a class
  degrade. A fourth rescue within the hour on an Anthropic lane (not on lost auth) first waits up to
  `RESCUE_CHAIN_WAIT=1800` seconds (`kind=chain`), then swaps; with no room it becomes the no-room
  wait; at its account's reset it ends in place if armed and is rescued if stalled. A Codex-lane
  session is never chain-waited, so the lane's "pool is full" signal is written at once. Rule 3 reads
  the tail of `swap.log` (`RESCUE_LOG_TAIL_BYTES`), so the policy and its measurement read the same
  record.
- **Where to look.** `$REG/<id>.rescuewait` holds the one current or last wait
  (`state= kind= since= reset= wrapper=`, plus `until= end=` once it ends). `swap.log` says
  `rescuewait <id>: …` once on entry and `rescuewait-end <id>: … end=<word>` once on exit — never the
  word `hold`, which is the workspace-reap hold. The `auto-rescue` line appends ` reset= type= row=`
  when the verdict dated a row. `python3 deploy/measure-continuity.py --stage 4` reads it all back,
  read-only.
```

No `file:line` token appears in the new text (session-hook's README audit reads every one).

- [ ] **Step 6: Mutation check, then commit**

| # | Exact edit | Command | Expected red (measured on the full prototype) |
|---|---|---|---|
| 5.1 | `deploy/measure-continuity.py`: `        if before and int(tok["row"]) < max(before) - 1:` → `        if before:` | `./node_modules/.bin/vitest run test/measure-continuity-stage4.test.ts` | "every row on a log whose answer is known" only — `expected 2 to be 1` |
| 5.2 | `r[1] == sid and 0 <= r[0] - t <= 300` → `<= 900` | same | same case only — `expected 2 to be 1` |
| 5.3 | `            if kind == "chain" and end != "swap" and not at_reset:` → `            if kind == "chain" and end != "swap":` | same | same case only — `expected 3 to be 2` |
| 5.4 | `        four_plus += best >= 4` → `>= 5` | same | same case only — `expected +0 to be 1` |
| 5.5 | `ccd/ccd`: `rescuewait-end`'s `after $((now - since))s end=$end"` → `ending=$end"` (re-stamp not needed for this row) | same | "auto-rescue (with its dated tokens), rescuewait, rescuewait-end and carried-in all parse" only — `expected {} to deeply equal { 'near:swap': 1 }` |
| 5.6 | `(until is None or t < until)` → `(until is None or t <= until)` | same | "--since is inclusive and --until exclusive…" only — `s3 at 11:03 is in; s4 at 11:10 is at the exclusive bound: expected 2 to be 1` |
| 5.7 | `        'swap_log': a.swap_log or os.path.join(a.home, '.cc-sessions', 'swap.log'),` → `        'swap_log': os.path.join(a.home, '.cc-sessions', 'swap.log'),` | same | 4 failed: the three hand-built-log cases (`expected undefined to be 8`, `… to be 2`, `… to be 1`) and "opens the default log read-only…; an absent log says so" (`expected { …(15) } to deeply equal { swap_log: 'absent' }`) — re-measured 2026-09-24 with the sixth case; 5.1–5.6 re-measured then too, unchanged |
| 5.8 | `            if kind == "noroom" and end != "turned" and reset.isdigit() and t > int(reset) + S4_GRACE:` → `            if kind == "noroom" and reset.isdigit() and t > int(reset) + S4_GRACE:` | same | "every row on a log whose answer is known" only — `s9 swapped late; s13 open in the registry; not s14 (purged) or s15 (closed): expected 3 to be 2` (s10's armed, in-place end counted) |
| 5.9 | `S4_GRACE = 120` → `S4_GRACE = 0` | same | 2 failed: "every row…" (`expected 3 to be 2`, s11's swap inside the grace counted) and "no-room waits past their reset…" (`the instrument's grace is ccd's: expected '0' to be '120'`) |
| 5.10 | `    ref = until if until is not None else int(time.time())` → `    ref = int(time.time())` | same | "no-room waits past their reset…" only — `s9 ended in the window; s13 opened before it and is open at its end: expected 4 to be 2` (s14 and s15, opened after the window, counted) |
| 5.11 | `        past.append(("open", ref - int(reset)))` → `        pass` | same | 2 failed: both `noroom` cases — `expected 1 to be 2` (the still-open s13 uncounted) |
| 5.12 | `                pending.pop(m.group(2), None)` → `                pass` | same | "no-room waits past their reset…" only — `expected 4 to be 2` (s9 and s11, already ended, counted again as open in a past window, where only the log speaks; measuring now, the registry gate hides the same fault) |
| 5.13 | `        if until is None:` (the registry gate) → `        if False:` | same | "every row…" only — `expected 4 to be 2` (s14, purged mid-wait, and s15, whose record is closed, counted as open now) |
| 5.14 | `            if "state=open" not in rec:` + `                continue` → `            pass` | same | "every row…" only — `expected 3 to be 2` (s15's closed record read as open) |

```bash
git add deploy/measure-continuity.py server/test/measure-continuity-stage4.test.ts README.md
git commit -m "$(cat <<'MSG'
feat(deploy): measure-continuity's stage-4 rows; README describes rules 1-3

deploy/measure-continuity.py --stage 4 reads swap.log read-only: sessions with
4+ rescues in an hour, rescues on a carried-in banner (row= against the landing
the log itself records), rule-1 suppressions rescued within 5 minutes, chain
waits ending in neither a swap nor a reset, near waits ending in a swap, and
every wait by kind and end, and (spec §11 item 6) the no-room waits a stalled
session outlived its own reset in, with the seconds idled past it. Each regex
is bound to the line the real ccd writes, and the grace to ccd's constant.
Baseline on the live log 2026-09-08..09-23: 248 rescues, 4 sessions with 4 in
an hour. README: the rescue arm's new exception, and a section for rules 1-3.
MSG
)"
```

---

### Task 6: Whole-branch verification, the PR — and the AGENT-FIRST deploy

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified — this task runs, measures, opens the PR and hands over the deploy.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: the wave-2 PR on this workspace's own branch and a wave-done report. Wave 7 consumes `_rescue_policy`'s place in `_auto_swap_check` (its refusal sits on the non-rescue path below it); §9's stage-4 rows are read by `measure-continuity.py --stage 4` from the first deploy on.

- [ ] **Step 1: Merge current `main`, and re-measure on the merged tree**

The merge comes FIRST so the final gate (Step 2) runs on the tree that ships: when another wave has landed a `ccd/ccd` edit, the pre-merge tip is a tree nobody will run. Run Task 1 Step 0's merge block verbatim (it resolves only the line-2 stamp hunk, by re-stamping, and stops on any other conflict), then:

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l
grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'
git fetch origin main && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected: the merge block prints nothing past `git log` (already up to date, or a clean merge) or `merged: the stamp hunk resolved by re-stamping` — never `STOP` (on `STOP`, report and stop: a conflict in any other line of `ccd/ccd`, or in any other file, is never resolved in this task). If the merge brought another wave's `ccd/ccd` edits, the re-stamp is required; if it moved the census, `_reg_get`'s sentence or a README anchor, re-run the S6-R11 procedure and commit the re-measured literals with the composition stated ("an assertion over the merge is only true on the merged tree"). `corpus-frozen`.

- [ ] **Step 2: The server suite in twelve sequential shards on the merged tip, then agent and pwa**

```bash
git log -1 --format='%h merged tip under test'
cd server && npm ci
./node_modules/.bin/vitest run --shard=1/12     # … then 2/12, 3/12, … 12/12, one call each, foreground
cd ../agent && npm ci && npm run test
cd ../pwa   && npm ci && npm run test
```

Expected: PASS everywhere; `agent` and `pwa` untouched. The twelve shards cover the pins the merged tree carries — `deviation-refs`, `dtbd`, `topology-clean`, `single-definition`, `ccd-harness-containment`, `ownership`, `ccd-reg-get-census`, `ccd-workspaces`' "EVERY bash call site" and `session-hook`'s citation cases among them. Report the twelve shard summaries, their sum, and the merged sha they ran on. If a shard is killed by the 600 s ceiling, re-run the whole suite as `--shard=k/24`. Re-run any known load flake IN ISOLATION before calling it a break. **If `main` moves again before the PR merges, repeat Step 1 and re-run all twelve shards; report the shard sums at the new merged sha.**

- [ ] **Step 3: The wave's own surface in one run**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/ccd-limit-banner.test.ts \
  test/measure-continuity-stage4.test.ts test/ccd-swap-pin.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-swap.test.ts
```

Expected: PASS.

- [ ] **Step 4: Confirm the author, push, open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Session continuity wave 2: a carried-in banner is not a block; the rescue waits near a reset (AGENT-FIRST)" --body-file - <<'EOF'
Wave 2 of the session-continuity programme (spec `docs/superpowers/specs/2026-09-23-session-continuity-design.md` §5.4 rules 1–3). **AGENT-FIRST, ccd only.** No wire change.

1. **Rule 1 — a carried-in banner is not a block** (C12). `cmd_swap` stamps `$REG/<id>.landed`; every positive of `_session_hard_blocked` is dated by the transcript's newest rate-limit row (an uncached `newest` read sharing the detector's one literal) and a row older than the landing is not a block. Measured before: 32 of 248 rescues fired on a carried-in banner.
2. **Rule 2 — the near-reset wait** (C6, C13). A `five_hour` block on an Anthropic lane within 600 s of its reset, dated by a row written before that reset, with Claude Code's auto-continue armed, waits; it ends at the reset or 120 s after it — in a swap if a newer rate-limit row exists; otherwise, while still armed, in place, never away from an account that has just reset. Today's stranded path is the no-room wait. A stalled session is rescued as today, including when its no-room or chain wait crosses its own reset (nothing re-sends its turn in place, and the redrive fallback cannot type for it); the residual — a stalled session whose own account is the only one with room still idles until another target gains room, exactly as today — is an open operator question.
3. **Rule 3 — spread, no bounce, chain wait.** From the swap log's tail: skip the accounts just left blocked, prefer a target no rescue landed on in 10 minutes (never at the price of a class degrade), and chain-wait a fourth rescue within the hour up to 30 minutes — on an Anthropic lane, never on lost auth.
4. `$REG/<id>.rescuewait` records each wait once on entry and once on exit; `deploy/measure-continuity.py --stage 4` reads §9's stage-4 rows back, read-only.

Citation corpus (S6-R11): every edit above the frozen anchors is line-neutral; the census did not move. `_reg_get` census 156/132 -> 163/139.

**Deploy: `ccrc rollout --to <this merge's tag>` in its default order — fleet box first. Never `--server-first`.** Sessions swapped before the deploy carry no `.landed` and keep today's verdict until their next landing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report (the wave-done mail)**

Report to the coordinator, per the worker skill: the branch tip sha; the merge block's outcome; the twelve shard summaries and their sum at that merged sha, agent and pwa; each task's citation-tax output (re-pointer lines and `cite-remeasure.py`'s four lines); the census before/after; every mutation row's measured red at its own commit; Task 5's live baseline (or that it was skipped); every departure from this plan, named by what it is (the coordinator assigns numbers). Then stop.

- [ ] **Step 6: Deploy — AGENT LANE FIRST (post-merge, by whoever merges)**

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

Expected: both boxes on the tag. Exit 3 means a box moved with doctor FAIL lines: read them first.

Then, on the fleet box, read-only, after the first swap past the deploy:

```bash
ls "$HOME"/.cc-sessions/*.landed 2>/dev/null | head -3
grep -E ' (carried-in|rescuewait|rescuewait-end) ' "$HOME/.cc-sessions/swap.log" | tail -5
python3 "$HOME/<the deployed tree>/deploy/measure-continuity.py" --stage 4 --since "$(date +%F)"
```

Expected: `.landed` files appear as sessions land; the instrument's rows begin to move. Rolling back: `ccrc update --to <the previous tag> --downgrade` on the fleet box; the three new registry fields are inert to an older ccd (`_reg_purge` removes them with a row by suffix).

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated per wave, by the coordinator, at this wave's run-open; **a worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail — what departed, where, and why — and the coordinator assigns its number and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file (`dtbd.test.ts` reds the concrete form).

No block is written as a range, and no headroom accounting lives in this plan.

The pre-flight findings above are not deviations: they were measured before this plan existed and shaped it.

- **D-3497** — Amends D-3100's argument that a re-rendered banner "cannot reach a relocation" because the rescue arm sits below `SWAP_COOLDOWN` (spec C12): the cooldown expires, and 32 of 248 rescues (2026-09-08..09-23) fired on a banner the session carried in. `cmd_swap` stamps `$REG/<id>.landed` (`"<epoch> <wrapper>"`, after the carry and the wrapper flip, before the unit starts; its only writer is `_swap_landed`), and every positive of `_session_hard_blocked` — pane, banner and transcript rungs — is dated by the transcript's newest rate-limit row through an uncached read; a row strictly older than the landing is not a block. It gives up the pane rung's immediacy for a pane positive the transcript dates as carried in (§8). No landing, no rate-limit row, an unreadable transcript, or an auth-failure pane keeps the verdict. The transcript arm's cache keeps unreadable (`2`) distinct from no banner (`0`). Implemented by this plan's Tasks 1–2.
- **D-3498** — Amends post-swap-redrive R1 / D-2236 ("the rescue ignores Claude Code's armed auto-continue", spec C6, bound C13): on a `five_hour` rate-limit row on an Anthropic lane whose reset is within `RESCUE_WAIT_BOUND` (600 s; 0 turns it off), and ONLY while Claude Code's auto-continue is armed on the pane — the plan's reading of "leaves Claude Code's armed auto-continue alone", because the redrive fallback that §5.4 names for the turned window types only on the unsubmitted resume pair and so cannot re-drive a stalled session — the rescue waits instead of swapping. No wait of any kind keys on a row written at or after its own `resetsAt`: such a row says the account did not turn. The wait ends at the reset, or `RESCUE_WAIT_GRACE` (120 s, its own constant) after it: in a swap if a rate-limit row newer than the reset exists; otherwise, and ONLY while the pane's auto-continue is still armed, in place — the redrive fallback running through its own gate — never in a swap away from that reset. Today's `stranded` path is also a wait (`kind=noroom`) with the same reset ending, and rule 3's chain wait (`kind=chain`, 30 minutes; Anthropic lanes only, never on an auth-failure pane) ends early at its account's reset the same way. A stalled session whose near, chain or no-room wait crosses its own reset is rescued as today once a target has room — the swap's `--resume` spawn re-drives the turn, the one re-send path that types nothing but the existing constant; a near or chain wait ends `turned` and opens no second chain wait on that reset, and a no-room wait stays open until a target gains room. Only an armed pane is held on a reset that turned. Every wait is recorded once on entry and once on exit in `$REG/<id>.rescuewait` and `swap.log`, never under the word `hold`. A stalled session, a `seven_day` or non-Anthropic block, or a row without both values swaps as today; `~/.cc-limits` is not a fallback. Implemented by this plan's Tasks 3–4.

---

## Review lenses

Four lenses, all `opus` — a diff of one shipped script (`ccd/ccd`, ≈380 lines added, 30 changed), one read-only instrument, README, and three test files, sized to the fleet policy's 3–5 reviewers; one `sonnet` refute pass per finding.

1. **Safety of the verdict and the holds (opus, xhigh).** This wave changes the verdict every rescue AND every strand decision runs on. Read `_limit_dated_verdict` for any path that takes a positive away WITHOUT proof (an unparseable timestamp, an absent `.landed`, `newest` rc 1 or 2, an auth pane — each must keep the positive); confirm the equal-second rule and that `.landed` is written after the carry and before `_svc_start`, and nowhere else (`_swap_landed`'s one caller). Read `_rescue_policy` for every `return 1` (HOLD) and prove each is bounded or spec-sanctioned: the near wait (`BOUND + GRACE`), the chain wait (`RESCUE_CHAIN_WAIT`), the no-room wait (unbounded by spec — today's `stranded`), and the post-turned hold on one reset on one account (unbounded by spec: "never a swap away from an account that has just reset"), which must hold ONLY a pane whose auto-continue is armed — and confirm, with evidence, what a STALLED session in a near, no-room or chain wait does when its reset turns (this plan: it is rescued as today once a target has room — Review Focus item 6; with no room it stays in ONE no-room wait, never re-opened per tick). Confirm no wait keys on a row written at or after its own reset (Review Focus item 7), and a hold can never follow a verdict that was not a rate-limit block (auth, carried-in) — the chain wait included (item 8), that `_tick_strand_undecidable` reads the same dated verdict, that the globals cannot leak across ticks, that the wait sits below both cooldown gates, and that nothing here types: `_redrive_after_spawn` is the only keystroke path reached, through its own gate. Read `_rescue_history`'s python for any input from `swap.log` (a file sessions' own tools can append to) that could crash the tick, stall it, or widen a skip list into "no target" (a skip list can only ever fall back to the just-left accounts, never to empty-by-spread).
2. **ccd mechanics and the line-neutral discipline (opus, high).** Every edit above `:19131` is one line for one line; `_transcript_limit_banner`'s default mode is byte-for-byte unchanged (the existing 54 cases green); the `newest` python contains no `'` and no 3.12-only syntax; `SWAP_TARGET_SKIP` is read with `:-` everywhere and changes nothing when empty; the second `[[ "$cand" == "$cur" ]] && continue` (in `_strand_why`) is untouched; `_rescue_target` is `_swap_target` byte for byte off the rescue path; the three source pins (`_session_hard_blocked "$id" "$pane" && hard_blocked=1`, `auto-rescue $id: $wrapper (blocked)` above the pin check, the detector literal once) hold.
3. **Guard fidelity and the citation tax (opus, high).** Every mutation row mutates the guard it names and reds for the stated reason, not an adjacent one; the regression controls are green on `905360dc` AND on the tip (Pre-flight finding 10); the census literals were taken from the instrument, and the README anchors point at the bytes their sentences quote; `_reg_get`'s sentence was re-measured in the task that moved it, with no new cardinal within 25; the inventory window keeps `` `strandnotify` `` inside 2400 characters.
4. **The instrument and the spec's §9 (opus, high).** `measure-continuity.py` is read-only (opens nothing for writing), converts `swap.log`'s LOCAL times with the reader's zone, and each row counts what §9's row names — including where it cannot (a rescue with no `row=` is reported as undated, not as "not carried-in"); the binding test really runs the ccd functions that write each line; the file follows the programme's cross-wave contract exactly (`STAGES = {N: stageN}`, `stageN(ctx)` returning named sections, `ctx` with `since`/`until` as epochs, the shared CLI with `--stage N` repeatable), the stage-4 block is self-contained, and either landing order leaves one file with one `STAGES` registry.

---

## Open questions for the operator

1. **A stalled session whose own account is the only one with room — RULED 2026-09-24 (spec §11 item 6): leave it as today and count it.** This plan rescues a STALLED session whose wait crosses its own reset exactly as today, by a swap once some OTHER target has room, so one whose own, just-reset account is the only one with room still idles until another target gains room. No in-place restart is sanctioned. Task 5's `noroom_waits_past_their_reset` rows count every no-room wait that outlives its own reset by more than `RESCUE_WAIT_GRACE` without ending `turned`, and the seconds it idled past that reset; the operator rules again with that count in hand.
2. **The near wait requires an ARMED auto-continue** (Pre-flight finding 2, D-3498): a stalled session near its reset is rescued as today. Recorded as the plan's reading of "leaves Claude Code's armed auto-continue alone"; the operator may rule otherwise.
3. **Doctor's reader of `.rescuewait`** ships with wave 4 (Pre-flight finding 9); the record's grammar is fixed here so that reader needs no ccd change.
