# Session continuity, wave 2 — the rescue waits near a reset, spreads and chain-waits (AGENT-FIRST) Implementation Plan

> **Status: RE-PLANNED 2026-09-30 on `main` `c88625aa` — ready for dispatch.** It replaces, in full, the plan held
> on 2026-09-28 at this path.
>
> 1. **Rule 1 shipped.** Stage 4 rule 1 (C12, "a carried-in banner is not a block") merged as D-3526 (#207,
>    `1c5f7d90`) on D-3522's carrier — the pane's own process start (`_pane_born`), joined by a swap after the row
>    (`$REG/<id>.lastswap`) — rather than on the `$REG/<id>.landed` stamp the held plan's Tasks 1–2 built; a landing
>    whose Claude Code never came up (`$REG/<id>.spawn` rc 4) is still moved, on purpose. The held Tasks 1–2
>    (`.landed`, the `newest` reader mode, `_tscan_measure`, `_limit_dated_verdict`) are superseded and are not
>    rebuilt; D-3497 stays rule 1's number, defined below and restated as shipped by D-3526.
> 2. **Task mapping.** The held plan's Tasks 3, 4, 5 and 6 are this plan's Tasks **1, 2, 3 and 4**: rule 2 (the
>    near-reset wait, the no-room wait, `.rescuewait`); rule 3 (spread, no bounce, the chain wait, and the
>    `auto-rescue` line's dated tokens); the stage-4 instrument and README; whole-branch verification, the PR and
>    the AGENT-FIRST deploy. Every code block was re-derived against D-3526's shipped reader and every count
>    re-measured.
> 3. **What carries forward from the shelved 2026-09-28 draft's safety review** (its findings S1–S3, each now a
>    rule of this plan with named cases and mutation rows — Review Focus 11–13):
>    - **S1 — an unanswered `_pane_born` never takes a positive away and never opens a wait**, and no near,
>      no-room or chain wait opens on lost auth by either surface: the pane's auth text, or a 401 newer than the
>      rate-limit row, whoever wrote it (on Claude Code 2.1.280 only the transcript shows a 401). A wait of any
>      kind opens only on a positive whose dated row is a rate-limit row carrying a kept reset and its window.
>    - **S2 — a rate-limit row written at or after its own `resetsAt` keeps that reset nowhere**: not in the
>      verdict (`HARD_BLOCK_RESET`), not in `.rescuewait`, not in the `auto-rescue` line's `reset=` — so rule 3's
>      skip list and §11 item 6's count never read a reset that did not turn the account; and a no-room wait
>      whose reset such a row, written after it, proves stale ends `stale`, which the count leaves out.
>    - **S3 — a STALLED no-room wait is rescued the moment a target has room**, inside the `RESCUE_WAIT_GRACE`
>      after its reset too, as today's strand is.
> 4. **Prototype-first.** Every code block below was applied to a `git archive` of `c88625aa` task by task, and
>    each task's tests were measured red on the previous stage and green on its own; the blocks marked
>    `<!-- replay: … -->` are the prototype's bytes (a replay of this document onto a fresh archive, `diff -r`
>    against the prototype, prints nothing). Every mutation row was measured on that prototype.
> 5. **The spec is amended in the same docs change** (`docs/superpowers/specs/2026-09-23-session-continuity-design.md`
>    rev 6): §5.4 rule 1 as shipped, rules 2–3 and the tests list as re-planned here, §7's `ccd/ccd` and
>    `server/test` rows, §8's carried-in bullets and its near-reset-wait bullet, and §9's carried-in target.
> 6. **A three-lens review round (2026-09-30) is applied**, re-measured on a prototype rebuilt from this document
>    (Review Focus 19–22, and the rows each names): "armed" is Claude Code's own footer, outside the prompt box
>    (`_rescue_armed`), never a draft or prose saying the words; only a wait open before its reset's grace ran out
>    ends `turned` and holds, and no chain wait opens on a five-hour reset whose grace has passed; spread never
>    turns a rescue with a target into an undecidable one and never passes over the session's recovered home; an
>    open chain wait holds only on the account it was taken on; `RESCUE_WAIT_BOUND=0` is documented as turning off
>    the NEAR wait. Task 4's merge is one gated block that also resolves wave 1's instrument, and its deploy is
>    measured, never run by hand (operator ruling 2026-09-30).
> 7. **A verification round (2026-09-30) is applied**, re-measured the same way: the in-place hold after a reset
>    turned is BOUNDED at `RESCUE_CHAIN_WAIT` past that reset, where it had no end of its own (the planner's default,
>    which the operator may reverse — Open question 4; Review Focus 23, row 1.57), so `RESCUE_CHAIN_WAIT` is now
>    defined in Task 1; row 1.48's red is restated as measured; Review Focus 8 names the just-left-only pass's own
>    rc 5, and Review lens 3 the two-lock row 1.9.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop swapping a session that Claude Code is about to continue by itself, stop herding rescues onto one
target, and record every wait. The rescue verdict already dates a rate-limit row against the pane's own process
(D-3526); this wave keeps that row's `resetsAt`, `rateLimitType` and own epoch — from the same cached read the
verdict came from, and only from a row this pane's process wrote. A `five_hour` block on an Anthropic lane whose
kept reset is within `RESCUE_WAIT_BOUND` (600 s, C13), with Claude Code's auto-continue armed on the pane (its own
footer, outside the prompt box), waits
instead of swapping, ending at the reset or `RESCUE_WAIT_GRACE` (120 s) after it (rule 2, C6): in place only while
the pane is armed and only for a wait that saw its reset — held there at most `RESCUE_CHAIN_WAIT` (30 minutes) past
the reset — otherwise in a swap. Today's `stranded` path becomes the
no-room wait with the same reset ending, and a stalled one swaps the moment a target has room. A rescue skips the
accounts the session just left blocked, prefers a target no rescue landed on in the last ten minutes (never at the
price of a class degrade or an undecidable tick, and never over its own recovered home), and a fourth rescue
within the hour on an Anthropic lane chain-waits up to 30 minutes first (rule 3). Every wait is
recorded once on entry and once on exit in `$REG/<id>.rescuewait` and `swap.log`, and
`deploy/measure-continuity.py --stage 4` reads the §9 stage-4 rows back, §11 item 6's count among them.

**Architecture:** One new section of `ccd/ccd`, `# ── THE RESCUE POLICY`, directly above `_strand_clear() {` —
below the frozen citation corpus and below README's two `ccd/ccd` anchors — holds every new function and constant.
Everything above README's anchors is reached through LINE-NEUTRAL edits (one line becomes one line), so the citation
census and both anchors stay put (measured: `147 / 195 / 58 / 38`, `ccd/ccd:21564` and `:20279-20281`, base = tree).
Five mechanisms: (1) **the dated row** — `_transcript_limit_banner`'s new `dated` mode is `stuck` mode plus the
rate-limit row's own epoch; D-3526's `_limit_read` reads it instead and caches the row beside its answer in
`$REG/<id>.tdate` (a new shape; the old one is re-read, never parsed), and `_hard_block_date` turns an rc-0 answer
into `HARD_BLOCK_RESET`/`TYPE`/`ROW`, which `_session_hard_blocked` clears on every call; (2) **`_rescue_policy`**,
one call on `_auto_swap_check`'s verdict line, below both cooldown gates, answering PROCEED or HOLD — the near wait,
the reset endings and, in Task 2, the chain wait; (3) **`.rescuewait`**, opened by `_rescuewait_open` (the one gate
every wait passes: a dated row carrying a kept reset and its window) and closed by `_rescuewait_close`, from the
strand site, the rescue arm and `cmd_swap`'s landing; (4) **`_rescue_target`**, which wraps `_swap_target` for a
rescue only and passes it a `SWAP_TARGET_SKIP` list the candidate walk and the home-return branch honour (spread
never names the session's home), reading the swap log (`_rescue_history`) only when there is somewhere to go; (5) **the instrument's stage-4 block**, inside the
programme's one-shape `deploy/measure-continuity.py`.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `set -uo pipefail`, no `-e`), python 3 (the transcript reader and
`_rescue_history` run inline under `python3 -c '…'` inside a SINGLE-quoted bash string — no `'` may appear in them),
TypeScript + vitest 4.1 (tests), python 3 (`deploy/measure-continuity.py`, read-only). Measured on bash 5.2.21 and
Python 3.12.3.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md` (rev 6, amended with this plan) — §5.4
rules 2–3 and their tests list (NOT the refusal of non-rescue swaps, `--cut-delegated` or its 409: wave 7); §5.4
rule 1 as shipped by D-3526 (`docs/superpowers/plans/2026-09-28-carried-in-banner-is-not-a-block.md`); §3 C6 (slug
`rescue-waits-near-reset`, D-3498), C12 (D-3497), C13 (the 600 s bound); §8 (the near-reset wait, stalled-session and
chain-wait bullets); §9's stage-4 rows except "non-rescue swaps that cut delegated work"; §11 item 3 and item 6
(ruled 2026-09-24 "leave it and count it"; the decision returns to the operator with that count — Linear CCR-20).
Programme ledger: `docs/superpowers/programs/session-continuity.md` (wave 2).

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST, `ccd` only.** Nothing here touches `server/src`, `agent/src`, `shared/`
  or the PWA. It reaches both boxes through ccrc's own update mechanism — nobody runs `ccrc rollout` or `ccrc update`
  by hand (operator ruling 2026-09-30); the server arm is inert, so the order the boxes move in changes nothing, and
  AGENT-FIRST is met once the fleet box runs the tag. Task 4 Step 6 measures it, read-only.
- **Waves 1–4 each edit `ccd/ccd` and land one at a time** (programme ledger): this wave lands on current `main` by a
  `git merge` whose only resolved conflicts are `ccd/ccd`'s line-2 provenance stamp, the `_reg_get` census's comment
  lines and — when wave 1 landed first — `deploy/measure-continuity.py`'s add/add conflict (main's file plus this
  wave's stage-4 block, the one-shape rule). Task 4 Step 1 resolves exactly those, by script, in ONE gated block
  that commits nothing and aborts the merge on anything else; it re-stamps, and the citation corpus and the
  `_reg_get` census are re-measured ON THE MERGED TREE before the final gate, which runs on the merged tree.
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`,
  `ws-archive`/`ws-restore`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service`
  directly. The only live reads this wave makes are Task 3's read-only instrument run over `~/.cc-sessions/swap.log`
  and Task 4's post-deploy checks, all `ls`/`grep`/`python3` that open nothing for writing. NEVER print secret file
  CONTENTS.
- **This wave changes what every rescue and strand decision does after the verdict.** It never changes the verdict
  itself: `_session_hard_blocked` answers exactly as D-3526 left it (its globals gain three values; its return codes
  do not move). Every wait is bounded — `RESCUE_WAIT_BOUND + RESCUE_WAIT_GRACE` for the near wait,
  `RESCUE_CHAIN_WAIT` for the chain wait, and `RESCUE_CHAIN_WAIT` past the reset for the hold after a reset turned,
  which holds only a pane whose auto-continue is ARMED on a wait that was open before its reset's grace ran out (the
  planner's default bound, Open question 4) — except the one the spec makes unbounded on purpose, the no-room wait
  (today's `stranded`, which a target with room ends at once); each is named in Review lens 1 (`xhigh`). Every
  condition this wave cannot
  measure — the pane's birth, the row's timestamp, its reset, the swap log — is today's behaviour: no wait.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)`
  (`server/test/ccdWsHelpers.ts`); its `sh()` routes every bash spawn through `ghContainedEnv(home, env, { systemd:
  true, tmux: true })`, which `ccd-workspaces.test.ts`'s scan ("routes EVERY bash call site in every ccd test file
  through ALL THREE poisons") requires of every `ccd-*.test.ts` file. `measure-continuity-stage4.test.ts` spawns
  `python3`, never bash, outside `h.sh`.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000ms, ONE vitest process at a time.** The fleet box is memory-bound
  (programme ledger); the server suite runs as twelve sequential shards in Task 4, never two at once.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`,
  `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`. A `ccd-account-ok` or other `cmd_ws_add` case red on
  free disk is ws-add's floor: `export CCD_DISK_FLOOR_GB=1` and re-run.
- **Rings / no overloaded null.** `_limit_read`'s rc-0 answer carries `-` for a field the row lacks, never an empty
  field a tab split would collapse; `_rescuewait_open` answers recorded (0), could not record (1) and nothing dated
  to wait on (2); `_rescue_history` answers measured (rc 0, possibly an empty history) or unmeasurable (rc 2) — an
  absent swap log, and a tail with no rescue in it, are MEASURED empty histories; an unreadable one is not.
- **Wire discipline.** No frame changes, `FLEET_PROTO` untouched. The `auto-rescue` swap.log line gains APPENDED
  tokens (` reset=`, ` type=`, ` row=`) only when the verdict kept them, so every line shape the fleet's log already
  carries is unchanged when nothing was dated; no server code parses `swap.log` (measured at `c88625aa`:
  `grep -rn 'auto-rescue' server/src agent/src shared` → no hits).
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated,
  measured before/after. Every row in this plan was measured on the full prototype (Tasks 1–3 applied to a
  `git archive` of `c88625aa`), each mutation applied to a saved copy of the file and restored from that copy
  (`cmp`-checked) — never `git checkout -- <path>`, which restores to HEAD. Where a row's red names a case a LATER
  task adds, the red at the task's own commit is the subset that exists by then; re-measure at your commit and
  quote what you get.
- **`ccd/ccd` is a provenance-STAMPED file** (line 2 is `# ccrc:generated 1 sha256=…`). **Every task that edits
  `ccd/ccd` re-stamps before running any suite**, or `server/test/ownership.test.ts` reds:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **The citation tax (S6-R11) is owed by every CITED file.** Measured at `c88625aa` (`grep -oE '(ccd/ccd)?:[0-9]+'`
  over the two corpus documents and `README.md`, the file prefix OPTIONAL): the corpus cites `ccd/ccd` up to
  `:19131`; README carries exactly two `ccd/ccd` anchors, `:21564` (`cmd_ensure`'s `_reg_generation_init "$id"`) and
  `:20279-20281` (`genrc == 1`). **Every edit this wave makes above `:21564` is LINE-NEUTRAL** — the `_reg_get` census
  (2 lines), `_reg_purge`'s inventory (3), `_swap_target` (2), `_session_hard_blocked` (2), `_auto_swap_check` (4) and
  `_transcript_limit_banner` (3; it sits between README's two anchors, so a single added line there would move
  `:21564`). Everything else — `_limit_dated`, `_limit_read`, the new section, `cmd_swap`'s landing — sits below
  `:21564`. Measured on every stage of the prototype: `147 / 195 / 58 / 38` stated = base = tree, composition empty,
  README's anchors unmoved. `README.md` is edited in Task 3 (prose only, no `file:line` token), and
  `session-hook.test.ts` is not edited.
- **The `_reg_get` census.** Task 1 adds three `_reg_get` calls on three lines (`_rescuewait_open`,
  `_rescuewait_close`, `_rescue_policy` — one `rescuewait` read each); Tasks 2–3 add none. The pair is whatever the
  base states plus three: `$SCRATCH/reg-get-census.py` (Task 1 Step 6) derives it from the base's own sentence,
  checks it against the header's two commands, rewrites the two LAST MOVE lines two for two, and refuses on any
  difference. At `c88625aa` the base states 176/147, so Task 1 writes 179/150.
- **Locate code by CONTENT.** Line numbers are "at `c88625aa`" and are hints, never addresses. Waves 1, 3 and 4 of this
  programme, the landing-order programme and child-reclamation's later waves edit the same file.
- **Shell state does not survive between Bash calls.** Every block that names `$SCRATCH` sets it itself
  (`SCRATCH=<your scratchpad, absolute>`). Never run half a block; an empty `$SCRATCH` points every path at `/`.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch. One commit per task.
- **Commit trailers:** end every commit message with the attribution line your own session is given. The heredocs
  below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs or account names** anywhere in a committed file
  (`topology-clean.test.ts`). Fixture account ids are the test roster's (`claude`, `claude-a`, `claude-b`, `claude-d`,
  `gpt`).
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section. D-3497 (`carried-in-banner-is-not-a-block`)
  and D-3498 (`rescue-waits-near-reset`) were issued at plan time and stay defined there; D-3522 and D-3526 are
  defined on `main` and are cited. A departure found while executing is named by a slug; the coordinator mints its
  number.

---

## Review Focus

Inputs and failure modes the spec implies, each a named case in its owning task and red when its guard is removed
(the mutation tables are the measurement). Items 1–10 are the held plan's, re-pointed to this plan's tasks and rows;
11–13 are the shelved draft's safety review (S1–S3), carried forward; 14–18 were found by this re-plan; 19–22 by its
review round of 2026-09-30 (and items 3, 8, 10 and 12 were widened by it); 23 by the verification round after it,
which also widened item 8 and restated items 19 and 20.

1. **A stale reset from the previous tick.** `cmd_supervise` runs every tick in ONE long-lived shell, so a verdict
   global a call did not set is a previous tick's, and a stale `HARD_BLOCK_RESET` would park a session on a reset
   that came and went. → Task 1, "the globals are cleared on every call — one supervise shell runs every tick"
   (row 1.11).
2. **Two accounts sharing a reset epoch.** Five-hour resets land on shared boundaries; a `turned` record written on
   one account must not hold the session after it moved to another. → Task 1, "a turned record on ANOTHER account
   does not hold this one" (row 1.22).
3. **`RESCUE_WAIT_BOUND=0` inside the grace window.** The near wait's window runs from `R − BOUND` to `R + GRACE`;
   with the bound at 0 the grace half would still wait unless the switch is explicit. → Task 1, "RESCUE_WAIT_BOUND=0
   turns the wait off INSIDE the grace too" (row 1.16); its control is "armed, a reset that passed inside the grace
   with no record: the near wait opens" (row 1.43). The knob turns off the NEAR wait only: a chain or no-room wait
   already open still ends in place at its reset under (a), as rule 2 says (Open question 3).
4. **The no-room wait flapping back into a chain wait.** After a chain wait expires with no room, the session's hour
   still holds three rescues; a chain check that ran over an open no-room wait would re-open a chain wait each tick.
   → Task 2, "a chain wait at its bound with no target that has room becomes the no-room wait", ticked twice (row 2.6).
5. **The home-return branch bypassing "do not bounce".** `_swap_target`'s forced path returns HOME before its
   candidate walk whenever home's telemetry looks fine — and telemetry lags a limit (§1.2: at least 123 targets
   blocked before the source's reset). → Task 2, "the home-return branch honours the skip too" (row 2.2).
6. **A STALLED session whose wait crosses its own reset.** Nothing re-sends a stalled turn in place (the redrive
   fallback types only on the unsubmitted resume pair; `_auto_stale_check` presses Enter only on an armed
   continuation's stale-phase sentence), so a wait that ended `turned` and held would idle it on its reset account
   even with room elsewhere. → Task 1, "a STALLED no-room wait across its own reset is rescued once a target has room,
   not held" and "a STALLED session whose closed turned record names this reset is rescued"; Task 2, "a STALLED chain
   wait whose account reset ends turned and the tick rescues, with no second chain wait" (rows 1.30, 1.31, 2.8).
7. **A chain wait on a lane that is not Anthropic's.** A Codex-lane hold returns before the rescue arm writes the
   lane's only "pool is full" signal (`$LIMITS_DIR/<wrapper>.json`), so other sessions keep landing on the exhausted
   lane. → Task 2, "a Codex-lane session on its fourth rescue in the hour is rescued at once, and its exclusion is
   written" (row 2.9).
8. **Spread bought with a class degrade, or with an undecidable tick.** `_swap_target` answers rc 6 (a name one
   rung DOWN) when the only same-class target with room is the one spread skipped — or rc 5 when the skip removed
   every measured candidate and left only a lane whose class window nobody measured, which would mark a rescue that
   HAS a target undecidable (`.tickstuck`, a loud strand) until the other rescue ages out of the spread window. The
   unskipped probe already answered rc 2–4 (asked before the walk), so the spread pass takes only an rc-0 name and
   every other answer falls through to the just-left-only pass. The just-left-only pass's own answer goes back as it
   came, rc 5 included: when the only measured lane with room is the account the session just left blocked and
   another lane's class window is unmeasured, the tick is undecidable (`.tickstuck`, the class-window strand, no
   no-room record) where `main` bounces — honest, because that lane may take it and do-not-bounce refuses the
   other. → Task 2, "spread never buys a class degrade…"
   (row 2.11), "spread never turns a rescue undecidable…" and its end-to-end twin (row 2.22).
9. **A NON-rescue path reached by rule 3.** The affinity path's choice is not this spec's. → Task 2, "a NON-rescue
   tick is `_swap_target` byte for byte" (row 2.18).
10. **A merge that always conflicts.** Every `ccd/ccd` edit changes line 2's provenance stamp; another wave that
    moved the `_reg_get` census conflicts on its comment lines too; and wave 1, if it lands while this wave runs,
    created `deploy/measure-continuity.py` too (add/add). → Task 4 Step 1 resolves exactly those three, by script,
    in one gated block that commits nothing and aborts the merge on anything else — a failed fetch included
    (measured on seven scenarios, Pre-flight finding 12).
11. **S1 — an unanswered `_pane_born`, and lost auth by either surface.** The shelved draft dated a positive by the
    newest rate-limit row through a second `_pane_born` read; when tmux answered nothing it ignored a 401 this
    process wrote, and ruled a dead credential carried-in or waited on it. Here the waits read only what D-3526's
    reader answered rc 0 on, and that reader answers the NEWEST REAL row: a 401 newer than the rate-limit row is
    either the answer (this process wrote it: every field `-`) or ends the row's run (rc 1) — measured for
    `[rate-limit row, a turn, a 401]` and `[rate-limit row, a 401]` with `since` empty, torn, before and after the 401.
    `_hard_block_date` refuses an unplaced process as its own lock. An auth-failure pane is never read at all
    (`_pane_carried_in`). → Task 1, "_hard_block_date keeps nothing for an unplaced process, a 401 or another answer…"
    (row 1.8), "an unplaced process takes no wait…", "lost auth takes no wait: a 401 this process wrote after a
    near-reset rate-limit row…", "lost auth takes no wait: [rate-limit row, a turn, a 401]…" (three writers), "an
    auth-failure pane is never dated…" (row 1.13, the gate every wait passes); `ccd-limit-banner`'s "[banner, turn,
    401]" and "[banner, 401]", which pin the reader's side; Task 2, "an auth-failure pane is never chain-waited", "a
    401 only the transcript shows is never chain-waited either", "a 401 arriving during an open chain wait is rescued
    at once" (row 2.10).
12. **S2 — a rate-limit row written at or after its own `resetsAt`.** Real on this fleet (a read-only 14-day survey
    found `five_hour` and `seven_day` rows whose `resetsAt` was 10 hours to 8.5 days before their own timestamp). The
    row proves the account did not turn; the shelved draft kept its reset out of the wait's gate only, so the
    no-room record carried it (§11 item 6's count read a 2-second-old wait as 36,859 s past its reset) and the
    rescue line's `reset=` lifted rule 3's skip (a bounce straight back). `_hard_block_date` keeps no such reset at
    all. The same input can arrive AFTER a no-room wait opened on a legitimate reset: the armed retry at that reset
    meets a 429 carrying the same `resetsAt`, and its row proves the reset did not turn the account, so the wait
    ends `stale` (the strand stands, as today) and §11 item 6 leaves it out. → Task 1, "a row written AFTER its own
    resetsAt opens no wait of any kind…", "armed, a row newer than its reset: no near wait", "a rate-limit row
    written after the reset with the SAME resetsAt ends the wait in a swap", "a no-room wait whose reset a newer row
    proves did not turn the account ends `stale`…" (row 1.56); Task 2, "a row written days after its own reset logs
    no reset=, and the next rescue does not bounce back"; Task 3, "…one whose row was written after its own reset
    adds nothing" and "…ends `stale`, and is not counted past its reset" (rows 1.10, 1.56, 3.20).
13. **S3 — a STALLED no-room wait inside the grace after its reset.** The shelved draft held every open no-room wait
    from `R` to `R + GRACE` whatever the pane showed; today's strand swaps the moment a target has room, and resets
    share boundaries, so that window is where room most often appears. → Task 1, "a STALLED no-room wait inside its
    reset grace swaps the moment a target has room", with "control: an ARMED no-room wait inside its reset grace is
    held" (row 1.32).
14. **The transcript rung's 30 s `tscan` cache skips the read.** A dated row taken only from the read would vanish on
    the cached tick and let a chain wait fall through to a swap. `_hard_block_dated` re-asks `_limit_read`, which
    answers from `.tdate` for the same process and file. → Task 1, "the transcript rung dates its positive on the tick
    its tscan cache answers, too"; Task 2, "the chain wait holds on the transcript rung's cached tick too" (row 1.12).
15. **`.tdate`'s new shape, both directions.** A record in D-3526's shape is re-read, never parsed; a torn one is
    untrusted; each of the three fields keeps its place even when the row lacks one. → Task 1's `ccd-limit-banner`
    cases "a record in the shape before this wave is re-read…", "a torn record for this key…", "each field is its
    own…" (rows 1.4, 1.5, 1.6, 1.6b). The other direction — an older `ccd` after a rollback — was measured on
    `c88625aa`'s own `_limit_read`: it re-reads every new-shape record (Pre-flight finding 8).
16. **D-3526's never-came-up landing.** It is rescued on a carried-in row D-3526 keeps a block; that row is rc 3,
    dates nothing, and with no live TUI no auto-continue is armed. → Task 1, "a landing that never came up is moved
    as today and takes no wait, even beside an armed footer (D-3526)", with its carried-in control; Task 2, "a rescue
    of a landing that never came up names its carried row= and no reset= or type=" (rows 1.13, 2.14).
17. **A strand's per-tick cost.** A stranded session is asked every 5 s for hours; rule 3 reads the swap log's tail
    (about 40 ms of python per read, measured) only when there is somewhere to go or a chain wait could open. →
    Task 2, "nowhere to go is `_swap_target` byte for byte, and reads no swap log" (row 2.12).
18. **A wait left open across a move.** A manual swap, or a wait found on another account, must not leave a record a
    later wait inherits. → Task 1, "an open wait taken on another account ends as a swap…" and "cmd_swap's landing
    closes it `swap`" (rows 1.27, 1.29), with "a REFUSED swap leaves it open" as the control.
19. **A false "armed" parks a STALLED session.** `_pane_auto_continue_armed` greps the whole capture for
    "continuing automatically|continuing shortly" — right for the sites that TYPE, where a false "armed" only
    declines a keystroke, and wrong here, where it holds a session nothing will re-send: a human's draft saying
    "continuing shortly" would start a near wait and, after the reset, end it `turned` and hold it there up to
    `RESCUE_CHAIN_WAIT` past the reset; an
    assistant line saying the words above a STALLED banner would do the same. `_rescue_armed` reads the footer as the
    two pane rungs read their banners: outside the prompt box (`_pane_outside_box`) and on a `·`-separated line. →
    Task 1, "a human draft that says "continuing shortly" is not an armed auto-continue…", "…nor does that draft hold
    a STALLED no-room wait inside its reset grace…", "…nor does a draft that quotes the footer itself…", "…nor is
    the assistant's own last line…", with two controls (the footer below the box, and 2.1.280's `⚠` footer) (rows
    1.17, 1.32, 1.52, 1.53, 1.54). The capture in `ccd-rescue-policy.test.ts` is real multi-line text for this.
20. **A wait first taken after its reset's grace.** A no-room wait opened on the first strand tick of an ARMED pane
    whose row predates a reset 10 minutes gone never saw the account turn; an armed footer past its reset's grace,
    with the 429 still the newest row, says Claude Code is NOT continuing. Ending it `turned` would hold the session
    until `RESCUE_CHAIN_WAIT` past the reset (Review Focus 23 bounds that hold; the case sits inside the bound, so
    the bound does not hide it), and a chain wait opened on that reset would hold it for a tick. → Task 1, "a wait
    first taken long after its reset never ends `turned`…" (row 1.55), with "control: a no-room wait open since before
    its reset still ends `turned`…"; Task 2, "no chain wait opens on a five-hour reset whose grace has passed…" (row
    2.8, which also carries Review Focus 6's "no second chain wait").
21. **Spread passing over a recovered home.** Every recent rescue TARGET joins the skip list the home-return branch
    honours, so a session whose home recovered would go to a third account and come home at its next idle tick —
    two moves, two carries, for nothing against the herd. Spread never names HOME; do-not-bounce still skips a home
    the session just left blocked (Review Focus 5). → Task 2, "spread never passes over HOME…" (row 2.23).
22. **An open chain wait on another account.** Every other reader of `.rescuewait` checks the record's account; a
    chain record left on a previous account (both closes failed their `_reg_set`) would hold the session on its new
    one for the rest of the 30 minutes. → Task 2, "an open chain wait taken on ANOTHER account does not hold this
    one" (rows 2.5, 2.24).
23. **The hold after a reset turned, with no end of its own.** A wait open before its reset's grace ran out, ended
    `turned` on an ARMED pane, held the session on that reset for as long as the footer stayed and the 429 stayed
    the newest row: measured on the review round's prototype, a near wait opened at R−300 and ticked at R+3000,
    armed, with a target that has room, was held on every tick, where `main` dispatches. Item 20's argument does not
    depend on when the wait opened — an armed footer that far past its reset says Claude Code is not continuing — so
    (a)'s past-grace hold, and with it the hold of a `turned` record and of an ARMED no-room wait past its grace,
    lasts only while `now < R + RESCUE_CHAIN_WAIT` (spec §5.4's 30 minutes, the longest the rescue holds a session on
    its account; the planner's default, Open question 4). After that the tick is today's — a swap to a target with
    room, or the strand — and no second wait holds in place on that reset. The no-room wait itself stays unbounded,
    as the spec says. → Task 1, "the hold after a reset turned ends RESCUE_CHAIN_WAIT past it…" (row 1.57; row 1.31
    reds it too), with "control: a STALLED pane past the grace is rescued as before…" (row 1.31).

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `ccd/ccd` | Modify — a new section `# ── THE RESCUE POLICY` directly above `_strand_clear() {` (Tasks 1–2); `_transcript_limit_banner`'s `dated` mode, three lines in place (Task 1); D-3526's `_limit_read` (the `dated` read and `.tdate`'s new shape) and `_limit_dated` (one line) (Task 1); line-neutral edits in `_session_hard_blocked` (Task 1), `_auto_swap_check` (Tasks 1–2), `_swap_target` (Task 2), `_reg_purge`'s inventory and `_reg_get`'s census (Task 1); one line in `cmd_swap`'s landing (Task 1) | The dated row, the waits, the spread |
| `README.md` | Modify (Task 3) — one amended sentence, one new subsection | The canonical description of the new behaviour |
| `server/test/ccd-rescue-policy.test.ts` | Create (Task 1), extend (Task 2) | The dated row and rules 2–3, each guard red when removed |
| `server/test/ccd-limit-banner.test.ts` | Modify (Task 1) — one `.tdate` expectation in D-3526's describe takes the new shape; one describe appended | The `dated` read, and the row `.tdate` caches |
| `deploy/measure-continuity.py` | Create, or extend if wave 1 merged first (Task 3) | §9's stage-4 rows, read-only, in the programme's one shape |
| `server/test/measure-continuity-stage4.test.ts` | Create (Task 3) | Each row counts what it says; each regex is bound to the real ccd line |
| `docs/superpowers/specs/2026-09-23-session-continuity-design.md` | Amended with this plan (rev 6), not by a task | §5.4 rule 1 as shipped; rules 2–3 as re-planned |

**Not modified, deliberately:** `server/src/**`, `agent/src/**`, `shared/**`, `pwa/**` (no wire, no reader — §9's
instrument reads the log); `ccd/ccrc-doctor-checks` (Pre-flight finding 10); `server/test/session-hook.test.ts` (the
census does not move); `_session_hard_blocked`'s verdict and return codes; the `tscan` cache and its shape; the swap
refusal path and every destructive verb.

---

## Pre-flight findings (measured while re-planning; not deviations)

Measured 2026-09-30 on a prototype of this plan's exact edits over `git archive c88625aa`, built task by task
(each task's tests red on the previous stage, green on its own), and on read-only reads of the fleet box's swap log.

1. **What D-3526's reader gives the waits, and what it does not.** `_transcript_limit_banner`'s `stuck` mode prints
   `"<resetsAt>\t<rateLimitType>"` on a rate-limit rc 0, and that exact output is pinned by D-3526's "control: a fresh
   banner after the carried one is this process's own block (rc 0)" — so a third field cannot be added to `stuck`
   mode. `_limit_read` caches only the rc and an rc-3 epoch; the transcript rung's 30 s `tscan` cache
   (`"<epoch> <0|1>"`, pinned by D-2444's and D-3526's cases) skips the read entirely; the pane rungs date through
   `_pane_carried_in`, which never reads an auth-failure pane. Hence Task 1's three pieces: a `dated` mode (`stuck`
   plus the row's epoch), `.tdate` carrying the row beside its answer, and `_hard_block_dated` for the cached tick.
   rc 3 (older than this process) is never a dated row, even where D-3526 keeps it a block.
2. **What the reader answers under a newer 401** (the safety review's S1 probe, re-run on the shipped reader, both
   modes, pinned in Task 1): for `[rate-limit row, a turn, a 401]` and `[rate-limit row, a 401]`, `since` empty or
   `soon` → rc 1; `since` before the 401 → rc 0 with the 401's `"\t\tauthentication_failed"`; `since` after it → rc 1.
   The reader answers the NEWEST REAL row, so a newer 401 either is the answer or ends the rate-limit row's run — the
   row under it is never dated, whoever wrote the 401 and whether or not tmux could place the pane.
3. **The reader sits between README's two anchors** (`ccd/ccd:20279-20281` above it, `:21564` below), so its edit is
   three lines in place (the one-line doc, the mode test, the final print); a single added line would move `:21564`.
4. **The redrive fallback is not called at a reset.** The held plan called `_redrive_after_spawn` when a wait ended
   `turned`. Measured: it types `RESUME_PROMPT` only while the transcript's newest real turn is the unsubmitted resume
   pair — which a session waiting on a banner never is — and it can hold the calling tick in a `sleep 1` loop for up
   to `REDRIVE_WAIT_S` (20 s). Every path that reaches `turned` in place has an ARMED pane, whose continuation Claude
   Code re-sends itself. So nothing in this wave types; `turned` closes the record and clears the strand.
5. **`ccd-swap-pin.test.ts` pins the `auto-rescue` line INLINE in `_auto_swap_check`, above the pin check.** The line
   stays inline and gains `$(_rescue_line_extra)` and a `; _rescuewait_close "$id" swap` tail — one line for one line.
6. **The python inside `_transcript_limit_banner` and `_rescue_history` is a single-quoted bash string.** No `'`
   appears in either; the reader's placeholder is `chr(45)`.
7. **The `_reg_purge` inventory window.** `ccd-auto-swap-pool.test.ts` reads 2400 characters from "The dot-free
   claim…" and needs `` `strandnotify` `` inside it. At `c88625aa` it ends at 2342; with `rescuewait` in the count
   sentence and the list, 2386 (measured) — 14 characters of headroom left for the next wave.
8. **`.tdate`'s new shape is rollback-safe** (measured on `c88625aa`'s own `_limit_read`): an older `ccd` handed a
   record in this wave's shape reads its fields from the sixth on as the path, which is not the file, and re-reads —
   once, answering rc 0 over a real block and rc 3 over a carried row, never trusting it.
9. **`swap.log` size, rule 3's read bound, and its cost.** Read-only at 2026-09-30: 2,813,530 bytes, 24,837 lines
   since 2026-07-03; per hour (continuation lines counted with their hour) max 39,949 bytes, p99 19,889, median
   2,088 — `RESCUE_LOG_TAIL_BYTES=1048576` covers more than 26 of the busiest hours, and a short read can only
   undercount, which is today's behaviour. One `_rescue_history` pass over a 1 MiB tail costs about 37 ms with its
   `grep -F` pre-filter (44 ms without; python's own start is 20 ms), so it runs only when a decision needs it: the
   chain check of a dated block with no wait open, and the target choice of a rescue with somewhere to go — not on
   the ticks a strand waits through (Review Focus 17).
10. **Doctor does not read `.rescuewait` in this wave.** §5.4's tests list says the record is read "by doctor, whose
    reader ships with stage 6's first part"; the record's grammar is fixed here (`state= kind= since= reset=
    wrapper=`, plus `until= end=`) so that reader needs no ccd change.
11. **The instrument's baseline on the live log** (read-only, the fleet box, TZ=UTC): `--since 2026-09-08 --until
    2026-09-24` → 248 rescues, 4 sessions with 4 or more inside an hour, max 4 (the held plan's baseline,
    reproduced); through 2026-09-30, 273, 4, 4; since 2026-09-24, 25 rescues and none with 4 in an hour. Every other
    stage-4 row reads 0 or `{}`: no line carries this wave's words, and no `carried-in` line was in the log on
    2026-09-30.
12. **The merge recipe, measured** — Task 4 Step 1's gated block run whole, verbatim but for its `SCRATCH` line, on
    scratch repositories (base `c88625aa`; branch = this prototype; main = `c88625aa` plus another wave's edit; `origin`
    a real remote, so the fetch runs): it COMMITS on (1) an edit far from this wave's lines — `resolved 1 hunk(s)`;
    (2) a wave that also moved the `_reg_get` census (two reads on one line, its own LAST MOVE) — `resolved 2
    hunk(s)`, `census 178/148 -> 181/151`; (3) wave 1 itself (its `ccd/ccd` splice and its instrument) — the add/add
    instrument conflict resolved to main's file plus the stage-4 block, 476 lines, byte-identical to the one-shape
    rule's order; (4) wave 1 with a census move — both; every one with `bash -n` clean, no marker, the stated census
    equal to the measured one, and `ccd-reg-get-census` 3/3, `ownership` 14/14, `measure-continuity-stage4` 9/9 and
    `ccd-rescue-policy` 94/94 on the merged tree of (4). It STOPS with nothing committed, no merge in progress and a
    clean tree on (5) another wave's edit beside `_auto_swap_check`'s verdict line, (6) a census LAST MOVE that wraps
    to three lines, (7) wave 1 plus that adjacent edit, and on a failed fetch. With `merge.conflictStyle` set to
    `diff3` or `zdiff3` in the repository's config, (4) merges to the same tree (the block pins the two-sided shape).
    Task 1 Step 0's stamp-only block commits (1), STOPs on (2), and STOPs on a failed fetch.
13. **`deploy/measure-continuity.py` is not on `main`** (wave 1 creates it). This wave's file is wave 1's shell byte
    for byte — its header, `TS`, `epoch`, `read_lines`, `when`, `main` — around this wave's stage-4 block, so either
    landing order leaves the same file: measured, wave 1 first then this wave's rule == this wave first then wave 1's
    rule (476 lines), and `measure-continuity-stage4` passes 9/9 against the combined file.
14. **Red-first, measured per task** (the task's tests on the previous stage): Task 1 `48 failed | 148 passed (196)`
    (`ccd-rescue-policy` 36 of 60, `ccd-limit-banner` 12 of 136 — its eleven new cases and the one `.tdate`
    expectation that takes the new shape); Task 2 `15 failed | 79 passed (94)`; Task 3 `8 failed | 1 passed (9)`.
    Green on each task's own stage: 196/196, 94/94, 9/9.
15. **The measuring trees are `git archive` copies, with no `.git`**, so `dtbd`, `deviation-refs` and
    `topology-clean` red there on `git` itself, identically on the unedited base; `typecheck-tests` needs
    `pwa/node_modules`, which the copies lack — `server/test` was type-checked directly with server's own `tsc -p
    test/tsconfig.tests.json`: no error under `server/test` (the `agent/src` `ws` errors are the same on the base).
    Task 4's full sharded gate on the real workspace is where these run.

---

## The citation tax, mechanised (S6-R11)

`server/test/session-hook.test.ts` audits every `file:line` citation in two FROZEN corpus documents
(`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`,
`docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`) and in `README.md`. The standing rule S6-R11:
**README is REPAIRED, by content, never counted; everything else is RE-MEASURED from the instrument, with the
composition stated; no rule is widened and no D-number is spent.** This wave's forecast is that nothing moves; the
tools below are how that is proved rather than asserted.

The two tools are the exemplar's, VERBATIM — `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md`,
"The citation tax, mechanised": `repoint-readme.py` (re-points README's two `ccd/ccd` anchors by the bytes their
sentences quote) and `cite-remeasure.py` (runs the citation cases at `<base-ref>` and on the tree, prints
stated/base/tree and the composition, and with `--write` rewrites exactly four literals). They are measurement
instruments, never committed. Extract them by CONTENT — never by typed line numbers — into your scratchpad
(`$SCRATCH`, an ABSOLUTE path):

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

Expected: `repoint-readme.py 30 lines` and `cite-remeasure.py 113 lines` (measured at `c88625aa`). The re-pointer
asserts README carries exactly its two known anchors and refuses any third; the re-measurer asserts it restored every
file it touched byte-for-byte.

**The procedure, per `ccd/ccd`-editing task** (Tasks 1 and 2 restate it as numbered steps):

1. Re-stamp `ccd/ccd`.
2. `SCRATCH=<abs path>; python3 "$SCRATCH/repoint-readme.py"` — README first.
3. `SCRATCH=<abs path>; python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD` — read-only. **If any `base` value
   differs from its `stated` value, the tree was red before your edit: stop and report it.** Then compare `tree`
   with the forecast.
4. Only if something moved: re-run with `--write`, write the S6-R11 composition comment, run the citation cases
   green. (Forecast for every task in this wave: nothing moves.)
5. **Both corpus documents byte-identical to `origin/main`:**

       git fetch origin main && git diff --quiet origin/main -- \
         docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
         docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen

   Expected: `corpus-frozen`.

Measured at `c88625aa` on the unedited base: both tools extract at 30 and 113 lines; the re-pointer prints
`cmd_ensure mint -> ccd/ccd:21564` and `genrc == 1 arm -> ccd/ccd:20279-20281` and leaves README unchanged; the
re-measurer prints `byFile['ccd/ccd'] stated 147 base 147 tree 147`, `total 195/195/195`, row array `58/58/58`, site
array `38/38/38`, every `ENTERED`/`LEFT` empty; the citation cases run `7 passed | 328 skipped (335)`. **The same,
exactly, on the prototype after each of Tasks 1, 2 and 3.**

---

### Task 1: The dated row, the near-reset wait, and the no-room wait (rule 2)

**Model routing:** `opus`, effort `high` — it decides when a blocked session is held, which is this wave's safety
surface.

**Files:**
- Modify: `ccd/ccd` — `_transcript_limit_banner`'s `dated` mode (three lines in place, ≈20569); D-3526's `_limit_read`
  (≈22273) and one line of `_limit_dated` (≈22260); the new section `# ── THE RESCUE POLICY` directly above
  `_strand_clear() {` (≈22360); two line-neutral edits in `_session_hard_blocked` (≈16783, ≈16824), three in
  `_auto_swap_check` (≈17410, ≈17546, ≈17603); one line in `cmd_swap`'s landing (≈23374); `_reg_purge`'s inventory
  (≈3704-3713) and `_reg_get`'s census (≈2952-2956) in place
- Test: `server/test/ccd-rescue-policy.test.ts` (new), `server/test/ccd-limit-banner.test.ts`

**Interfaces:**
- Consumes: D-3526's `_limit_dated` / `_limit_read` / `_pane_carried_in` (the verdict, unchanged in what it answers);
  `_pane_auto_continue_armed` and `_pane_outside_box`; `_is_anthropic_backend`; `_strand_mark`/`_strand_clear`.
- Produces: `_transcript_limit_banner <path> dated <since>` — `stuck` mode's answers, plus `"\t<rowEpoch|->"` after a
  rate-limit rc 0's two fields (`-` when the row's timestamp cannot be placed, which includes no `since`).
  `_limit_read <id> <path> <born>` → rc 0 now prints `"<row>\t<reset>\t<type>"` (`-` for a field the row lacks; a
  401's rc 0 prints `-` in all three); `.tdate` = `"<born> <mtime> <size> <rc> <row|-> <reset|-> <type|-> <path>"`
  (rc 3: `<row> - -`; rc 1: `- - -`). `_hard_block_date <rc> <born> <answer>` sets `HARD_BLOCK_ROW`/`TYPE`/`RESET` from an
  rc-0 answer — never for an unplaced process, a 401, or a reset the row was written at or after;
  `_hard_block_dated <id>` does the same for the transcript rung on a tick its `tscan` cache answered. Every call of
  `_session_hard_blocked` clears the three. `$REG/<id>.rescuewait`, ONE line: `state=open kind=<near|chain|noroom>
  since=<epoch> reset=<epoch|-> wrapper=<w>`, and on exit `state=closed … until=<epoch> end=<clear|turned|stale|swap|near|chain|noroom>`;
  `reset` is the kept five-hour reset or `-`. `swap.log`: `rescuewait <id>: kind=<k> on <w> reset=<r>` once on entry,
  `rescuewait-end <id>: kind=<k> on <w> reset=<r> after <n>s end=<word>` once on exit. `_rescuewait_open <id> <wrapper>
  <kind>` → 0 recorded (or this wait already open) | 1 could not record | 2 nothing dated to wait on.
  `_rescue_armed <pane>` → 0 iff Claude Code's own auto-continue footer is armed: `_pane_auto_continue_armed`'s
  phrases outside the prompt box, on a `·`-separated line. `_rescue_policy <id> <wrapper> <pane> <hard_blocked>` →
  rc 0 PROCEED as today | rc 1 HOLD this tick; an open no-room wait whose reset a newer dated row (written at or
  after it, its own reset kept nowhere) proves stale is closed `end=stale` on the way.

- [ ] **Step 0: Merge current `main` and prove the citation cases green before any edit**

THE MERGE BLOCK — used here and again in Task 4 Step 1. Every edit to `ccd/ccd` rewrites line 2
(`# ccrc:generated 1 sha256=…`), so once another wave's `ccd/ccd` edit has landed on `main` a merge ALWAYS conflicts on
that line, even when no other line does. The block resolves exactly that hunk — deleting it and re-stamping writes
the merged body's own sha, which is what `shared/mark.mjs`'s `markGenerated` produces from any body — and stops on
anything else. `-c merge.conflictStyle=merge` pins the two-sided marker shape the line checks read (Pre-flight finding
12 measured it):

```bash
if ! git fetch origin main; then
  echo 'STOP: the fetch failed — nothing merged; report it'
elif ! git -c merge.conflictStyle=merge merge --no-edit origin/main; then
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

Expected: the merge succeeds (`Already up to date.` if `main` has not moved past `c88625aa`; `merged: the stamp hunk
resolved by re-stamping` if another wave's `ccd/ccd` edit landed) and `7 passed | 328 skipped (335)`. On `STOP` (a
failed fetch merges nothing; any other conflict aborts the merge), stop and report. If `main` moved, every line number and census figure below is a hint and the instruments are the
authority.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-rescue-policy.test.ts`:

<!-- replay: create server/test/ccd-rescue-policy.test.ts -->
```ts
// The rescue policy (session-continuity spec §5.4, rules 2–3; wave 2, D-3498).
//
// Rule 1 — a carried-in banner is not a block — shipped as D-3526 and is pinned
// in `ccd-limit-banner.test.ts`. What this file pins sits between that verdict
// and the rescue arm's `_dispatch_swap`, and each case is red when its guard is
// removed (the plan's mutation tables are the measurement):
//   - THE DATED ROW: the verdict keeps a rate-limit row's `resetsAt`, window and
//     epoch only from an rc-0 read of this process's transcript — never on lost
//     auth, an unplaced process, a carried-in row, or a reset the row was
//     written after;
//   - RULE 2: a `five_hour` block whose reset is inside RESCUE_WAIT_BOUND, with
//     Claude Code's auto-continue armed — its own footer, never a draft or a
//     line of prose saying the words — WAITS instead of swapping, recorded once
//     on entry and once on exit in `$REG/<id>.rescuewait`, and ends at the reset
//     or RESCUE_WAIT_GRACE after it; today's strand is the no-room wait.
// Every fixture sits past SWAP_COOLDOWN (no `lastswap`, no `swapblocked`), and
// the pane's process was born a day before every row unless a case says not.
//
// FIXTURE HOME ONLY (`makeCcdHarness`): tmux, `_dispatch_swap` and — where a
// case is about the verdict rather than the choice — `_swap_target` are shell
// functions that LOG.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

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

/** The row Claude Code appends on a 429 (the `ccd-limit-banner.test.ts` shape),
 *  with the three fields the waits read: its own timestamp, `resetsAt` and
 *  `rateLimitType`. */
const limitRow = (at: number, reset: number | null, type: string | null): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `b${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 9:10pm (UTC)" }] },
  isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  ...(reset === null && type === null ? {} : { quotaLimits: { status: 'rejected', ...(reset === null ? {} : { resetsAt: reset }), ...(type === null ? {} : { rateLimitType: type }) } }),
});
/** Claude Code 2.1.280's own 401 row, field for field as `ccd-limit-banner.test.ts` has it. */
const authRow = (at: number): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `e${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'Invalid API key · Fix external API key' }] },
  isApiErrorMessage: true, error: 'authentication_failed', apiErrorStatus: 401,
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
 *  AUTH is lost auth, which `_pane_hard_blocked` also matches. The capture is
 *  REAL multi-line text (`tick` writes it to a file tmux's stub cats), so a case
 *  can draw 2.1.280's layout: banners above the prompt box, the auto-continue
 *  footer below it, a draft inside it. */
const ARMED = 'Usage limit reached · continuing automatically at 9:10pm · esc to cancel\n❯ ';
const STALLED = "You've hit your session limit · resets 9:10pm (UTC)\n❯ ";
const PROMPT = '? for shortcuts\n❯ ';
const AUTH = 'Invalid API key · Please run /login\n❯ ';
const BORDER = '────────────────────────────';
/** A STALLED banner above the box, with a human's draft in it that says the words. */
const DRAFT_SAYS_IT = `${STALLED.split('\n')[0]}\n${BORDER}\n❯ ok, continuing shortly\n${BORDER}\n  ? for shortcuts`;

/** tmux answers ONE pane for every capture — `pane`, written to `$HOME/pane.txt`
 *  line for line — and, while `TMUX_CREATED` is set, the pane's
 *  `session_created`; `_pane_box_draft` finds no draft; the dispatch and every
 *  keystroke LOG. `target` stubs `_swap_target` (null = leave it real). */
const STUBS = (pane: string, target: string | null = 'claude-a'): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
    capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo 4242 ;;
    display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  _pane_box_draft() { printf ''; };
  ${target === null ? '' : `_swap_target() { [[ -n ${JSON.stringify(target)} ]] && echo ${JSON.stringify(target)}; return 0; };`}
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
};
/** This pane's process was born a day ago — before every row a case writes. */
const BORN = (): Record<string, string> => ({ TMUX_CREATED: String(now() - 86400) });
const tick = (pane: string, target: string | null = 'claude-a', env: Record<string, string> = BORN()): void => {
  h.sh(`${STUBS(pane, target)} _auto_swap_check ${ID}`, env);
};
/** One verdict, and the three globals the waits read, printed as `reset|type|row`. */
const dated = (pane: string, env: Record<string, string> = BORN()): string =>
  h.sh(`${STUBS(pane)} _session_hard_blocked ${ID} ${JSON.stringify(pane)}; echo "$?|$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROW"`, env);
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const keystrokes = (): string[] => h.calls().filter((l) => l.startsWith('tmux send-keys'));
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const logLines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const field = (rec: string | null, key: string): string | undefined =>
  rec === null ? undefined : new RegExp(`(?:^| )${key}=(\\S*)`).exec(rec)?.[1];
const openWait = (kind: string, since: number, reset: number | string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${ID} rescuewait "state=open kind=${kind} since=${since} reset=${reset} wrapper=${wrapper}"`);
};

// ── THE DATED ROW ─────────────────────────────────────────────────────────────

describe('the dated row the waits read (session-continuity §5.4 rule 2)', () => {
  it('a rate-limit row this process wrote is dated on the pane rung: its reset, its window, its own epoch', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    expect(dated(ARMED)).toBe(`0|${t + 300}|five_hour|${t - 5}`);
  });

  it('the transcript rung dates its positive on the tick its tscan cache answers, too', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    expect(dated(PROMPT)).toBe(`0|${t + 300}|five_hour|${t - 5}`);
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 1$/);
    expect(dated(PROMPT), 'the cached tick lost the row').toBe(`0|${t + 300}|five_hour|${t - 5}`);
  });

  it('the globals are cleared on every call — one supervise shell runs every tick', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    const out = h.sh(`${STUBS(ARMED)} _session_hard_blocked ${ID} ${JSON.stringify(ARMED)}; a="$HARD_BLOCK_RESET";
      _session_hard_blocked ${ID} ${JSON.stringify(AUTH)}; echo "$a|$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROW"`, BORN());
    expect(out).toBe(`${t + 300}|||`);
  });

  it('_hard_block_date keeps nothing for an unplaced process, a 401 or another answer, and no reset a row was written at or after', () => {
    const ask = (rc: string, born: string, row: string): string =>
      h.sh(`_hard_block_date ${rc} ${JSON.stringify(born)} $'${row}'; echo "$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROW"`);
    expect(ask('0', '5', '100\\t200\\tfive_hour')).toBe('200|five_hour|100');
    expect(ask('0', '', '100\\t200\\tfive_hour'), 'tmux could not say when the pane was born').toBe('||');
    expect(ask('0', 'soon', '100\\t200\\tfive_hour')).toBe('||');
    expect(ask('0', '5', '-\\t-\\t-'), "a 401's answer").toBe('||');
    expect(ask('1', '5', '100\\t200\\tfive_hour'), 'rc 1 is no block row').toBe('||');
    expect(ask('2', '5', '100\\t200\\tfive_hour'), 'rc 2 is unread').toBe('||');
    expect(ask('0', '5', '300\\t200\\tfive_hour'), 'written after its own reset').toBe('|five_hour|300');
    expect(ask('0', '5', '200\\t200\\tfive_hour'), 'written in its own reset second').toBe('|five_hour|200');
    expect(ask('0', '5', '100\\t-\\t-'), 'a row with no quotaLimits keeps no window').toBe('||100');
    const marker = path.join(h.home, 'evaluated');
    expect(ask('0', '5', `100\\tREG[$(touch ${marker})]\\tfive_hour`)).toBe('|five_hour|100');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('an unplaced process takes no wait: tmux cannot say when the pane was born, and a near reset on an armed pane dispatches as today', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED, 'claude-a', {});
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });

  it('lost auth takes no wait: a 401 this process wrote after a near-reset rate-limit row dispatches, armed or not', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 100, t + 300, 'five_hour'), authRow(t - 5)]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dated(ARMED)).toBe('0|||');
  });

  // [rate-limit row, a turn, a 401]: whoever wrote the 401, it is the newer row,
  // so the reader never answers the rate-limit row under it (measured in
  // `ccd-limit-banner.test.ts`: no born or a torn one, rc 1; born before the
  // 401, the 401; born after it, rc 1).
  it.each([
    ['this process wrote the 401', (t: number) => ({ TMUX_CREATED: String(t - 86400) })],
    ['an earlier process wrote it, and a swap carried it here', (t: number) => ({ TMUX_CREATED: String(t - 900) })],
    ['tmux cannot place the pane', (_t: number) => ({})],
  ])('lost auth takes no wait: [rate-limit row, a turn, a 401] under an armed near-reset footer strands with no record, then dispatches — %s', (_what, env) => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour'), turn(t - 2900), authRow(t - 2800)]);
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}`);
    tick(ARMED, '', env(t));
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    expect(logLines('carried-in')).toEqual([]);
    tick(ARMED, 'claude-a', env(t));
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('an auth-failure pane is never dated, even beside an armed footer over a near-reset row: it dispatches, and strands with no record', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    const pane = `Invalid API key · Please run /login\n${ARMED}`;
    expect(dated(pane)).toBe('0|||');
    tick(pane, '');
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    tick(pane);
    expect(dispatches()).toHaveLength(1);
  });

  // D-3526's ruling: a landing whose Claude Code never came up is still moved.
  // Its row is carried in (rc 3), so it dates nothing — and with no live TUI
  // there is no armed auto-continue either; the footer below is forced.
  it('a landing that never came up is moved as today and takes no wait, even beside an armed footer (D-3526)', () => {
    seed(); const t = now(); const born = t - 990;
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour')]);
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 4"`);
    expect(dated(ARMED, { TMUX_CREATED: String(born) }), 'a carried-in row keeps no reset and no window').toMatch(/^0\|\|\|/);
    tick(ARMED, '', { TMUX_CREATED: String(born) });
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    tick(ARMED, 'claude-a', { TMUX_CREATED: String(born) });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('control: the same carried row on a process that came up is carried in — no rescue, no wait', () => {
    seed(); const t = now(); const born = t - 990;
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour')]);
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 0"`);
    tick(ARMED, 'claude-a', { TMUX_CREATED: String(born) });
    expect(dispatches()).toEqual([]);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(logLines('carried-in')).toHaveLength(1);
  });
});

// ── RULE 2 — wait near the account's own five-hour reset ─────────────────────

describe('rule 2: the near-reset wait (C6, C13)', () => {
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
    expect(field(rec, 'wrapper')).toBe('claude');
    expect(keystrokes(), 'a wait types nothing').toEqual([]);
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
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_BOUND=0; _auto_swap_check ${ID}`, BORN());
    expect(dispatches()).toHaveLength(1);
  });

  it('RESCUE_WAIT_BOUND=0 turns the wait off INSIDE the grace too: a reset that just passed dispatches', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 500, t - 30, 'five_hour')]);
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_BOUND=0; _auto_swap_check ${ID}`, BORN());
    expect(dispatches()).toHaveLength(1);
  });

  it('the grace is its OWN constant: RESCUE_WAIT_GRACE moves the end, STALE_PRESS_COOLDOWN does not', () => {
    seed(); const t = now(); const R = t - 60;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('near', t - 500, R);
    h.sh(`${STUBS(ARMED)} STALE_PRESS_COOLDOWN=30; _auto_swap_check ${ID}`, BORN());
    expect(field(h.reg(ID, 'rescuewait'), 'state'), 'STALE_PRESS_COOLDOWN ended the wait').toBe('open');
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_GRACE=30; _auto_swap_check ${ID}`, BORN());
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
    openWait('near', t - 500, R);
    tick(STALLED);
    expect(dispatches()).toEqual([]);
  });

  it('the verdict clearing at the reset (Claude Code continued) ends the wait, once, as `clear`', () => {
    seed(); const t = now(); const R = t - 10;
    writeTranscript([limitRow(t - 500, R, 'five_hour'), turn(t - 2)]);
    openWait('near', t - 500, R);
    tick(PROMPT); tick(PROMPT);
    expect(dispatches()).toEqual([]);
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('clear');
  });

  it('GRACE after the reset with no newer row, armed: the wait ends in place and nothing dispatches on this reset, inside RESCUE_CHAIN_WAIT', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 800, R, 'five_hour')]);
    openWait('near', t - 800, R);
    tick(ARMED); tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(keystrokes(), 'nothing is typed in place').toEqual([]);
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  it('GRACE after the reset WITH a rate-limit row newer than the reset: a dispatch follows', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 800, R, 'five_hour'), turn(t - 150), limitRow(t - 100, t + 17000, 'five_hour')]);
    openWait('near', t - 800, R);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('a turned record on ANOTHER account does not hold this one — two accounts can share a reset epoch', () => {
    seed(); const t = now(); const R = t - 200;
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

  // A ROW WRITTEN AT OR AFTER ITS OWN resetsAt keeps no reset (§5.4 rule 2: "no
  // wait of any kind keys on" it). Such rows are real: a 14-day survey of this
  // fleet's transcripts found `five_hour` rows whose resetsAt was 10 hours to
  // 8.5 days before their own timestamp.
  it('a row written AFTER its own resetsAt opens no wait of any kind: stranded with no record, then rescued when room appears', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t - 36857, 'five_hour')]);
    tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    expect(h.reg(ID, 'rescuewait'), 'a no-room wait keyed on a reset that never turned the account').toBeNull();
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
    openWait('near', t - 800, R);
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
    expect(field(h.reg(ID, 'rescuewait'), 'reset')).toBe(String(t + 9000));
    expect(logLines('rescuewait')).toHaveLength(1);
    tick(STALLED, 'claude-a');
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('an open wait taken on another account ends as a swap, and the wait on this account opens beside it', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    openWait('noroom', t - 900, t + 9000, 'claude-b');
    tick(STALLED, '');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(logLines('rescuewait-end')[0]).toMatch(/kind=noroom on claude-b .* end=swap$/);
    expect(field(h.reg(ID, 'rescuewait'), 'wrapper')).toBe('claude');
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });

  it('an ARMED no-room wait that crosses its own reset ends in place, never in a swap, even once a target has room', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    openWait('noroom', t - 5000, R);
    fs.writeFileSync(regFile(`${ID}.stranded`), '1');
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    expect(fs.existsSync(regFile(`${ID}.stranded`)), 'held on its own reset is not stranded').toBe(false);
  });

  // A STALLED pane has nothing that re-sends its turn in place, and ccd types
  // nothing there — so across its own reset it is rescued exactly as today's
  // strand is: it waits while no target has room, and swaps the moment one does.
  it('a STALLED no-room wait across its own reset is rescued once a target has room, not held', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    openWait('noroom', t - 5000, R);
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

  // …and the same inside the grace after its reset: today's strand swaps the
  // moment a target has room, and five-hour resets fall on shared boundaries,
  // so another account gaining room in exactly that window is the usual case.
  it('a STALLED no-room wait inside its reset grace swaps the moment a target has room', () => {
    seed(); const t = now(); const R = t - 30;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('noroom', t - 500, R);
    tick(STALLED, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('control: an ARMED no-room wait inside its reset grace is held', () => {
    seed(); const t = now(); const R = t - 30;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('noroom', t - 500, R);
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
    expect(field(h.reg(ID, 'rescuewait'), 'kind'), 'the no-room wait was replaced, not held').toBe('noroom');
    expect(logLines('rescuewait-end')).toEqual([]);
  });

  it('armed, a reset that passed inside the grace with no record: the near wait opens (the control for RESCUE_WAIT_BOUND=0)', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 500, t - 30, 'five_hour')]);
    tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('near');
  });

  it('an open near wait holds from entry, before its reset, even once the pane stops saying armed', () => {
    seed(); const t = now(); const R = t + 200;
    writeTranscript([limitRow(t - 100, R, 'five_hour')]);
    openWait('near', t - 100, R);
    tick(STALLED);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });

  it('a wait of the same kind on the same account but another reset is a new wait: the old one ends, the new one opens', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    openWait('noroom', t - 900, t + 5000);
    tick(STALLED, '');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'reset')).toBe(String(t + 9000));
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });

  it('a seven_day block with no target that has room records the no-room wait with reset=- (only a five-hour reset is recorded)', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 90000, 'seven_day')]);
    tick(STALLED, '');
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('noroom');
    expect(field(h.reg(ID, 'rescuewait'), 'reset')).toBe('-');
  });

  it('a closed record on this reset that did not end turned holds nothing: an armed pane past the grace is rescued as today', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=closed kind=near since=1 reset=${R} wrapper=claude until=2 end=clear"`);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a held tick is a decision: it clears a standing tickstuck stamp', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    fs.writeFileSync(regFile(`${ID}.tickstuck`), 'project');
    tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.tickstuck`))).toBe(false);
  });

  // ARMED IS CLAUDE CODE'S OWN FOOTER. A false "armed" here parks a STALLED
  // session — nothing re-sends its turn — so the words alone are not enough:
  // not in a human's draft inside the prompt box, and not in prose without the
  // footer's `·` separator (the two pane rungs read their banners the same way).
  it('a human draft that says "continuing shortly" is not an armed auto-continue: a STALLED banner near its reset dispatches', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(DRAFT_SAYS_IT);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });

  it('…nor does that draft hold a STALLED no-room wait inside its reset grace once a target has room (S3)', () => {
    seed(); const t = now(); const R = t - 30;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('noroom', t - 500, R);
    tick(DRAFT_SAYS_IT, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('…nor does a draft that quotes the footer itself, separator and all', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(`${STALLED.split('\n')[0]}\n${BORDER}\n❯ it said "Usage limit reached · continuing automatically at 9:10pm"\n${BORDER}\n  ? for shortcuts`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('…nor is the assistant\'s own last line saying "Continuing shortly" above a STALLED banner', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(`⏺ Tests pass. Continuing shortly with Task 3.\n  ⎿  ${STALLED.split('\n')[0]}\n${BORDER}\n❯ \n${BORDER}\n  ? for shortcuts`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('control: Claude Code\'s own footer, rendered BELOW the box, still waits', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(`${STALLED.split('\n')[0]}\n${BORDER}\n❯ \n${BORDER}\n  Usage limit reached · continuing automatically at 9:10pm · esc to cancel`);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('near');
  });

  it('control: the 2.1.280 armed footer under the box\'s bottom border still waits', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(`✻ Churned for 0s · done 4:01 PM\n${BORDER}\n❯ \n${BORDER}\n  ⚠ Usage limit reached · continuing automatically at 5:49pm · esc to cancel`);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('near');
  });

  // A WAIT FIRST TAKEN AFTER ITS RESET'S GRACE never saw the account turn: an
  // armed footer 10 minutes past its reset, with the 429 still the newest row,
  // says Claude Code is NOT continuing — so it is not ended `turned` and held
  // (inside RESCUE_CHAIN_WAIT, where the bound below would not end the hold).
  it('a wait first taken long after its reset never ends `turned`: an ARMED pane 10 min past its reset is rescued once a target has room', () => {
    seed(); const t = now(); const R = t - 600;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    tick(ARMED, ''); tick(ARMED, '');
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('control: a no-room wait open since before its reset still ends `turned` on an ARMED pane and holds', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    openWait('noroom', t - 5000, R);
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  // THE HOLD AFTER A RESET TURNED IS BOUNDED, at RESCUE_CHAIN_WAIT past that
  // reset (the planner's default; Open question 4): an ARMED footer that far
  // past its reset, with the 429 still the newest row, says Claude Code is not
  // continuing, and `main` rescues that input at once. `date +%s` is stubbed to
  // move the clock, so the shipped constants are the ones read.
  const clock = (epoch: number): string => `date() { [[ "$1" == +%s ]] && echo ${epoch} || command date "$@"; };`;
  it('the hold after a reset turned ends RESCUE_CHAIN_WAIT past it: held at R+GRACE+60 and at R+RESCUE_CHAIN_WAIT-60, rescued at R+RESCUE_CHAIN_WAIT+60', () => {
    seed(); const t = now();
    const [GRACE, CHAIN] = h.sh('echo "$RESCUE_WAIT_GRACE $RESCUE_CHAIN_WAIT"').split(' ').map(Number);
    const R = t - GRACE - 60;
    writeTranscript([limitRow(R - 800, R, 'five_hour')]);
    openWait('near', R - 300, R);
    h.sh(`${STUBS(ARMED)} ${clock(R + GRACE + 60)} _auto_swap_check ${ID}`, BORN());
    expect(dispatches(), 'R+GRACE+60').toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('closed');
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    h.sh(`${STUBS(ARMED)} ${clock(R + CHAIN - 60)} _auto_swap_check ${ID}`, BORN());
    expect(dispatches(), 'R+RESCUE_CHAIN_WAIT-60').toEqual([]);
    h.sh(`${STUBS(ARMED)} ${clock(R + CHAIN + 60)} _auto_swap_check ${ID}`, BORN());
    expect(dispatches(), 'R+RESCUE_CHAIN_WAIT+60').toEqual([`dispatch ${ID} -> claude-a`]);
    const rec = h.reg(ID, 'rescuewait');
    expect(field(rec, 'state'), 'the rescue arm writes nothing over a closed record').toBe('closed');
    expect(field(rec, 'kind')).toBe('near');
    expect(field(rec, 'end')).toBe('turned');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(logLines('rescuewait'), 'no second wait on this reset').toEqual([]);
    expect(keystrokes(), 'nothing typed in place').toEqual([]);
  });

  it('control: a STALLED pane past the grace is rescued as before — the bound changes nothing for it', () => {
    seed(); const t = now(); const R = t - 180;
    writeTranscript([limitRow(R - 800, R, 'five_hour')]);
    openWait('near', R - 300, R);
    tick(STALLED);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  // S2 AT THE RESET: the armed retry met a 429 carrying the SAME stale
  // resetsAt, so the newest row was written after the reset the no-room wait
  // keyed on — proof that reset did not turn the account. The wait ends
  // `stale` (the strand stands, as today), so §11 item 6 never counts it.
  it('a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and the strand stands', () => {
    seed(); const t = now(); const R = t - 300;
    writeTranscript([limitRow(t - 2000, R, 'five_hour'), turn(R + 1), limitRow(R + 2, R, 'five_hour')]);
    openWait('noroom', t - 2000, R);
    tick(ARMED, ''); tick(ARMED, '');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('stale');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
  });

  it('control: with no retry row after the reset, that no-room wait ends `turned` on an ARMED pane', () => {
    seed(); const t = now(); const R = t - 300;
    writeTranscript([limitRow(t - 2000, R, 'five_hour')]);
    openWait('noroom', t - 2000, R);
    tick(ARMED, '');
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  it('the word is never `hold`: the record is `.rescuewait`, no `.hold` is written, and swap.log never says it', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED);
    expect(fs.existsSync(regFile(`${ID}.hold`))).toBe(false);
    expect(fs.existsSync(regFile(`${ID}.rescuewait`))).toBe(true);
    expect(swapLog()).not.toMatch(/\bhold\b/);
  });

  it('a torn record is never evaluated (D-299), and closes with its own fields', () => {
    seed();
    const marker = path.join(h.home, 'evaluated');
    h.sh(`_reg_set ${ID} rescuewait 'state=open kind=near since=REG[$(touch ${marker})] reset=REG[$(touch ${marker})] wrapper=claude'`);
    h.sh(`_rescuewait_close ${ID} clear`);
    expect(fs.existsSync(marker)).toBe(false);
    expect(field(h.reg(ID, 'rescuewait'), 'since')).toBe('0');
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('clear');
  });

  it('.rescuewait purges with the row', () => {
    seed();
    openWait('near', 1, 2);
    h.sh(`_reg_purge ${ID}`);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });
});

describe('a completed swap ends an open wait as a swap, whoever asked for it', () => {
  const SWAP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; '
    + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; sleep() { :; };';
  const seedSwap = (): void => {
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${ID} uuid ${UUID}; _reg_set ${ID} wrapper claude; _reg_set ${ID} project demo; _reg_set ${ID} workdir ${wd}`);
    openWait('noroom', 1, '-');
  };

  it('cmd_swap\'s landing closes it `swap`', () => {
    seedSwap();
    const mdir = fs.realpathSync(path.join(h.home, 'projects', 'demo')).replace(/[/._]/g, '-');
    const dir = path.join(h.home, '.claude', 'projects', mdir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), 'HISTORY\n');
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('a REFUSED swap leaves it open: nothing moved', () => {
    seedSwap();
    h.sh(`${SWAP} cmd_swap ${ID} claude-d >/dev/null 2>&1 || true`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });
});
```

In `server/test/ccd-limit-banner.test.ts`, D-3526's describe pins `.tdate`'s shape in "a pane positive reads the
transcript once per process and file"; replace that one expectation (the only line that spells the record out):

<!-- replay: replace server/test/ccd-limit-banner.test.ts -->
```ts
    expect(h.reg(ID, 'tdate')).toBe(`${BORN} ${Math.floor(fs.statSync(p).mtimeMs / 1000)} ${fs.statSync(p).size} 3 ${BANNER_AT} ${p}`);
```

with

```ts
    expect(h.reg(ID, 'tdate')).toBe(`${BORN} ${Math.floor(fs.statSync(p).mtimeMs / 1000)} ${fs.statSync(p).size} 3 ${BANNER_AT} - - ${p}`);
```

and append this describe at the end of the file:

<!-- replay: append server/test/ccd-limit-banner.test.ts -->
```ts

// ── The `dated` read, and the row `_limit_read` caches (session-continuity §5.4
// rule 2, D-3498). `dated` mode is `stuck` mode plus the rate-limit row's own
// epoch as a third field, so the rescue waits read `resetsAt`, the window and the
// row's epoch from the answer the verdict itself came from — cached in
// `$REG/<id>.tdate` on the process and the file, never a second read on the
// 5 s tick. Every other answer — rc 1, 2, 3, and a 401's rc 0 — is stuck mode's.
describe('_transcript_limit_banner dated mode, and the row _limit_read caches (session-continuity §5.4 rule 2)', () => {
  const read = (p: string, since: string | number, mode = 'dated'): { rc: string; out: string } => {
    const raw = h.sh(`out=$(_transcript_limit_banner ${JSON.stringify(p)} ${mode} ${JSON.stringify(String(since))}); rc=$?; printf '%s|%s|' "$rc" "$out"`);
    const i = raw.indexOf('|');
    return { rc: raw.slice(0, i), out: raw.slice(i + 1, -1) };
  };
  const at = (row: string, epoch: number): string => JSON.stringify({ ...JSON.parse(row), timestamp: iso(epoch) });
  /** `_limit_read`, with every transcript read it makes counted. */
  const COUNTED = `eval "$(declare -f _transcript_limit_banner | sed '1s/^_transcript_limit_banner/_tlb_real/')";
    _transcript_limit_banner() { echo transcript-read >> "$HOME/ccd-calls"; _tlb_real "$@"; };`;
  const reads = (): number => h.calls().filter((l) => l === 'transcript-read').length;
  const limitRead = (p: string, born: number): string =>
    h.sh(`${COUNTED} out=$(_limit_read ${ID} ${JSON.stringify(p)} ${born}); echo "$?|$out|"`);
  const key = (p: string, born: number): string =>
    `${born} ${Math.floor(fs.statSync(p).mtimeMs / 1000)} ${fs.statSync(p).size}`;

  it('a rate-limit row this process wrote: rc 0, stuck mode\'s two fields, then the row\'s own epoch', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, BANNER_AT)).toEqual({ rc: '0', out: `1789430400\tseven_day\t${BANNER_AT}` });
    expect(read(p, BANNER_AT, 'stuck')).toEqual({ rc: '0', out: '1789430400\tseven_day' });
  });
  it('no since, or one that is not digits: still rc 0 — never taken away — but the row cannot be placed: `-`', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, '')).toEqual({ rc: '0', out: '1789430400\tseven_day\t-' });
    expect(read(p, 'soon')).toEqual({ rc: '0', out: '1789430400\tseven_day\t-' });
  });
  it('a row without quotaLimits keeps both empty fields, so the epoch is always the third', () => {
    seed(); const p = writeTranscript([L.banner({ quotaLimits: undefined })]);
    expect(read(p, BANNER_AT)).toEqual({ rc: '0', out: `\t\t${BANNER_AT}` });
  });
  it('rc 1, rc 3 and a 401 are stuck mode\'s answers, byte for byte', () => {
    seed();
    const p = writeTranscript([L.human(), L.banner()]);
    expect(read(p, BANNER_AT + 60)).toEqual({ rc: '3', out: String(BANNER_AT) });
    expect(read(writeTranscript([L.banner(), L.metaPrompt()]), BANNER_AT)).toEqual({ rc: '1', out: '' });
    expect(read(writeTranscript([AUTH()]), ROW_AT)).toEqual({ rc: '0', out: '\t\tauthentication_failed' });
  });
  // THE MEASUREMENT BEHIND "LOST AUTH DATES NOTHING". Whoever wrote the 401, it
  // is newer than the rate-limit row, so that row is never the answer: with no
  // `since` (or a torn one) the 401 is not counted and still ends the banner's
  // run (rc 1); a 401 this process wrote is the answer, with no epoch or reset;
  // a 401 an earlier process wrote ends the run as well (rc 1).
  it.each([
    ['[banner, turn, 401]', () => [L.banner(), at(L.assistant(), BANNER_AT + 60), at(AUTH(), BANNER_AT + 120)]],
    ['[banner, 401]', () => [L.banner(), at(AUTH(), BANNER_AT + 120)]],
  ])('%s: no since or a torn one, rc 1; born before the 401, the 401; born after it, rc 1 — in both modes', (_what, rows) => {
    seed(); const p = writeTranscript(rows());
    for (const mode of ['dated', 'stuck']) {
      expect(read(p, '', mode).rc, mode).toBe('1');
      expect(read(p, 'soon', mode).rc, mode).toBe('1');
      expect(read(p, BANNER_AT + 90, mode), mode).toEqual({ rc: '0', out: '\t\tauthentication_failed' });
      expect(read(p, BANNER_AT + 180, mode).rc, mode).toBe('1');
    }
  });

  it('_limit_read caches the rc-0 row beside the answer, and prints it from the cache without a read', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t1789430400\tseven_day|`);
    expect(h.reg(ID, 'tdate')).toBe(`${key(p, BANNER_AT)} 0 ${BANNER_AT} 1789430400 seven_day ${p}`);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t1789430400\tseven_day|`);
    expect(reads()).toBe(1);
  });
  it('each field is its own: a row with no quotaLimits caches `- -` after its epoch, never its epoch as a reset', () => {
    seed(); const p = writeTranscript([L.banner({ quotaLimits: undefined })]);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t-\t-|`);
    expect(h.reg(ID, 'tdate')).toBe(`${key(p, BANNER_AT)} 0 ${BANNER_AT} - - ${p}`);
  });
  it('a 401 caches rc 0 with nothing dated; rc 1 caches `- - -`; rc 3 its row and `- -`', () => {
    seed();
    const q = writeTranscript([AUTH()]);
    expect(limitRead(q, ROW_AT)).toBe('0|-\t-\t-|');
    expect(h.reg(ID, 'tdate')).toBe(`${key(q, ROW_AT)} 0 - - - ${q}`);
    const r = writeTranscript([L.banner(), L.metaPrompt()]);
    expect(limitRead(r, BANNER_AT)).toBe('1||');
    expect(h.reg(ID, 'tdate')).toBe(`${key(r, BANNER_AT)} 1 - - - ${r}`);
    const s = writeTranscript([L.human(), L.banner()]);
    expect(limitRead(s, BANNER_AT + 60)).toBe(`3|${BANNER_AT}|`);
    expect(h.reg(ID, 'tdate')).toBe(`${key(s, BANNER_AT + 60)} 3 ${BANNER_AT} - - ${s}`);
  });
  it('a record in the shape before this wave is re-read, never trusted, and rewritten', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    // The old shape "<key> <rc> <row|-> <path>" for THIS key: had it been parsed
    // it would have answered rc 0 with no row — no wait, for as long as the file
    // stood still.
    h.sh(`_reg_set ${ID} tdate "${key(p, BANNER_AT)} 0 - ${p}"`);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t1789430400\tseven_day|`);
    expect(reads()).toBe(1);
    expect(h.reg(ID, 'tdate')).toBe(`${key(p, BANNER_AT)} 0 ${BANNER_AT} 1789430400 seven_day ${p}`);
  });
  it('a torn record for this key — an rc 1 with a row, an rc 3 with a reset — is never trusted', () => {
    seed(); const p = writeTranscript([L.human(), L.banner()]);
    h.sh(`_reg_set ${ID} tdate "${key(p, BANNER_AT)} 1 ${BANNER_AT} - - ${p}"`);
    expect(limitRead(p, BANNER_AT)).toBe(`0|${BANNER_AT}\t1789430400\tseven_day|`);
    expect(reads()).toBe(1);
    h.sh(`_reg_set ${ID} tdate "${key(p, BANNER_AT + 60)} 3 ${BANNER_AT} 1789430400 - ${p}"`);
    expect(limitRead(p, BANNER_AT + 60)).toBe(`3|${BANNER_AT}|`);
    expect(reads()).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/ccd-limit-banner.test.ts`

Expected (measured on `c88625aa` with these two files): FAIL, `48 failed | 148 passed (196)` —
`ccd-rescue-policy` 36 of 60 (every case that needs the dated row, a hold, a record, a `rescuewait` line or an `end=`
word; `_hard_block_date` does not exist yet, and the bounded-hold case reds on its two constants, which do not exist
yet either) and `ccd-limit-banner` 12 of 136 (the eleven new `dated` cases, and the
one `.tdate` expectation that now spells the new shape). The regression controls pass today and must stay green —
24 in `ccd-rescue-policy`: an unplaced process dispatches; the three `[rate-limit row, a turn, a 401]` writers; the
carried-in control; `seven_day`; bound 0, before and inside the grace; outside the bound; stalled; non-Anthropic; no
reset (and `~/.cc-limits` not a fallback); a turned record on another account; a stalled session with a turned
record on this reset; a row written after its own reset (both cases); a closed record on this reset that did not end
turned; the four "not armed" cases (a draft saying the words, that draft inside a no-room wait's grace, a draft
quoting the footer, an assistant line); a STALLED pane past its reset's grace (the bounded hold's control) — today
every one of them is rescued, which is what they pin; the purge; a refused swap.

- [ ] **Step 3: The `dated` mode — three lines of `_transcript_limit_banner`, in place**

Locate `grep -n '^_transcript_limit_banner() {' ccd/ccd` (≈20569). It sits between README's two anchors, so each
edit is one line for one line (Pre-flight finding 3). The one-line doc:

<!-- replay: replace ccd/ccd -->
```bash
_transcript_limit_banner() {   # transcript-path [stuck since-epoch] -> 0 the newest real row is a rate-limit banner (prints "<resetsAt>\t<rateLimitType>"; stuck mode's 401 prints "\t\tauthentication_failed") | 1 not | 2 unreadable | 3 stuck mode: that banner provably predates since-epoch (prints its epoch; D-3526) (D-2362, D-2456)
```

with

```bash
_transcript_limit_banner() {   # transcript-path [stuck|dated since-epoch] -> 0 the newest real row is a rate-limit banner (prints "<resetsAt>\t<rateLimitType>"; stuck mode's 401 prints "\t\tauthentication_failed"; dated mode is stuck mode plus "\t<rowEpoch|->" after a rate-limit row's two fields) | 1 not | 2 unreadable | 3 stuck or dated mode: that banner provably predates since-epoch (prints its epoch; D-3526) (D-2362, D-2456)
```

The mode test, inside the python (`dated` gets every `stuck` gate — the 401 read, the rc-3 proof):

<!-- replay: replace ccd/ccd -->
```python
stuck = sys.argv[1:2] == ["stuck"]
```

with

```python
stuck = sys.argv[1:2] in (["stuck"], ["dated"])
```

The final print — `dated` appends the row's own epoch as a third field, `-` when it cannot be placed (`stamp()` needs
`since`); the 401 line above it and rc 3 are `stuck`'s, byte for byte:

<!-- replay: replace ccd/ccd -->
```python
print(f"{reset}\t{kind if isinstance(kind, str) else chr(0)}".rstrip(chr(0)))
```

with

```python
print(f"{reset}\t{kind if isinstance(kind, str) else chr(0)}".rstrip(chr(0)) + (f"\t{int(stamp(found)) if stamp(found) is not None else chr(45)}" if sys.argv[1:2] == ["dated"] else ""))
```

No `'` may appear in anything inside the python (Pre-flight finding 6); `chr(45)` is `-`.

- [ ] **Step 4: `_limit_read` reads `dated` and caches the row; `_limit_dated` hands it on**

Replace D-3526's `_limit_read` whole (≈22273; its header, the new shape's regex and consistency rule, the
literal-tab split, the three record forms):

<!-- replay: replace ccd/ccd -->
```bash
_limit_read() {   # id transcript-path born -> the stuck-mode read's rc (0|1|2|3; on 3 prints the row's epoch), cached in `$REG/<id>.tdate` on the process and the file (D-3526)
  # THE PANE RUNGS ASK THIS ON EVERY TICK OF A POSITIVE, for as long as a real
  # block sits stranded (the round-1 review read 24 strands in swap.log since
  # 2026-09-11: a median of 75 to 160 minutes, the longest 1852) and as long as a
  # suppressed carried-in banner stays on screen, so an uncached read put
  # D-2444's python pass back on the 5 s tick. The answer is a pure function
  # of the file and of `since`, so it is cached on exactly those:
  # "<born> <mtime> <size> <rc> <row-epoch|-> <path>", and read again the moment
  # any of them changes. Every row Claude Code appends grows the file, so a fresh
  # block is never hidden by the cache — the rule the pane rungs keep, that an
  # old answer must not overrule what is on screen now. `lastswap` and `.spawn`
  # are NOT cached: they are single registry reads applied after this on every
  # call, so a refusal's deletion or a settle counts at once. rc 2 (unreadable)
  # is never cached: it can be transient, and a stuck session's file does not
  # change to clear it. Born unknown, or a file stat cannot measure, reads
  # uncached — today's answer. A record for any other key, or a torn one, is
  # read past, never trusted: the regex admits digits and the path only.
  local id="$1" f="$2" born="$3" m s key="" rec out rc cached_key cached_rc cached_row cached_path
  local re='^([0-9]+ [0-9]+ [0-9]+) ([013]) ([0-9]+|-) (.+)$'
  m=$(_plat_mtime "$f" 2>/dev/null); s=$(_plat_size "$f" 2>/dev/null)
  [[ "$born" =~ ^[0-9]+$ && "$m" =~ ^[0-9]+$ && "$s" =~ ^[0-9]+$ ]] && key="$born $m $s"
  if [[ -n "$key" ]]; then
    rec=$(_reg_get "$id" tdate)
    if [[ "$rec" =~ $re ]]; then
      cached_key="${BASH_REMATCH[1]}"; cached_rc="${BASH_REMATCH[2]}"
      cached_row="${BASH_REMATCH[3]}"; cached_path="${BASH_REMATCH[4]}"
      # An rc 3 has a dated row; rc 0/1 has no row. A record that mixes the
      # two is torn, not a safe cached verdict.
      if [[ "$cached_key" == "$key" && "$cached_path" == "$f" ]] \
        && { [[ "$cached_rc" == 3 && "$cached_row" =~ ^[0-9]+$ ]] \
          || [[ "$cached_rc" =~ ^[01]$ && "$cached_row" == - ]]; }; then
        [[ "$cached_rc" == 3 ]] && printf '%s\n' "$cached_row"
        return "$cached_rc"
      fi
    fi
  fi
  out=$(_transcript_limit_banner "$f" stuck "$born"); rc=$?
  if [[ -n "$key" ]]; then
    if (( rc == 0 || rc == 1 )); then
      _reg_set "$id" tdate "$key $rc - $f" 2>/dev/null || true
    elif (( rc == 3 )) && [[ "$out" =~ ^[0-9]+$ ]]; then
      _reg_set "$id" tdate "$key 3 $out $f" 2>/dev/null || true
    fi
  fi
  (( rc == 3 )) && printf '%s\n' "$out"
  return "$rc"
}
```

with

```bash
_limit_read() {   # id transcript-path born -> the dated read's rc (0|1|2|3; on 0 prints "<row>\t<reset>\t<type>", `-` for a field it lacks; on 3 prints the row's epoch), cached in `$REG/<id>.tdate` on the process and the file (D-3526)
  # THE PANE RUNGS ASK THIS ON EVERY TICK OF A POSITIVE, for as long as a real
  # block sits stranded (the round-1 review read 24 strands in swap.log since
  # 2026-09-11: a median of 75 to 160 minutes, the longest 1852) and as long as a
  # suppressed carried-in banner stays on screen, so an uncached read put
  # D-2444's python pass back on the 5 s tick. The answer is a pure function
  # of the file and of `since`, so it is cached on exactly those:
  # "<born> <mtime> <size> <rc> <row|-> <reset|-> <type|-> <path>", and read again the moment
  # any of them changes. Every row Claude Code appends grows the file, so a fresh
  # block is never hidden by the cache — the rule the pane rungs keep, that an
  # old answer must not overrule what is on screen now. `lastswap` and `.spawn`
  # are NOT cached: they are single registry reads applied after this on every
  # call, so a refusal's deletion or a settle counts at once. rc 2 (unreadable)
  # is never cached: it can be transient, and a stuck session's file does not
  # change to clear it. Born unknown, or a file stat cannot measure, reads
  # uncached — today's answer. A record for any other key, or a torn one, is
  # read past, never trusted: the regex admits digits, `-`, a window's word and the path only.
  # THE rc-0 ANSWER CARRIES ITS ROW (session-continuity §5.4 rule 2, D-3498):
  # the `dated` read is `stuck` plus the rate-limit row's own epoch, so the
  # rescue waits read the row's `resetsAt`, window and epoch from the same
  # cached answer the verdict came from — no second read on the 5 s tick. A 401
  # answers rc 0 with `-` in all three: lost auth has no reset. A record in the
  # shape before this one ("<key> <rc> <row|-> <path>") is re-read, never
  # parsed: its sixth field is an absolute path, where this shape types the
  # reset, so the regex cannot match it.
  local id="$1" f="$2" born="$3" m s key="" rec out rc cached_key cached_rc cached_row cached_reset cached_type cached_path
  local row reset kind rest
  local re='^([0-9]+ [0-9]+ [0-9]+) ([013]) ([0-9]+|-) ([0-9]+|-) ([a-z_]+|-) (/.+)$'
  m=$(_plat_mtime "$f" 2>/dev/null); s=$(_plat_size "$f" 2>/dev/null)
  [[ "$born" =~ ^[0-9]+$ && "$m" =~ ^[0-9]+$ && "$s" =~ ^[0-9]+$ ]] && key="$born $m $s"
  if [[ -n "$key" ]]; then
    rec=$(_reg_get "$id" tdate)
    if [[ "$rec" =~ $re ]]; then
      cached_key="${BASH_REMATCH[1]}"; cached_rc="${BASH_REMATCH[2]}"
      cached_row="${BASH_REMATCH[3]}"; cached_reset="${BASH_REMATCH[4]}"
      cached_type="${BASH_REMATCH[5]}"; cached_path="${BASH_REMATCH[6]}"
      # An rc 3 has a dated row and nothing else; an rc 1 has none; an rc 0
      # has whatever its row carried. A record that mixes them is torn, not
      # a safe cached verdict.
      if [[ "$cached_key" == "$key" && "$cached_path" == "$f" ]] \
        && { [[ "$cached_rc" == 3 && "$cached_row" =~ ^[0-9]+$ && "$cached_reset$cached_type" == -- ]] \
          || [[ "$cached_rc" == 1 && "$cached_row$cached_reset$cached_type" == --- ]] \
          || [[ "$cached_rc" == 0 ]]; }; then
        [[ "$cached_rc" == 3 ]] && printf '%s\n' "$cached_row"
        [[ "$cached_rc" == 0 ]] && printf '%s\t%s\t%s\n' "$cached_row" "$cached_reset" "$cached_type"
        return "$cached_rc"
      fi
    fi
  fi
  out=$(_transcript_limit_banner "$f" dated "$born"); rc=$?
  if (( rc == 0 )); then
    # "<resetsAt>\t<rateLimitType>\t<rowEpoch|->", or a 401's "\t\tauthentication_failed":
    # split on the literal tab, never `read` (IFS whitespace collapses an empty field),
    # and each field typed, so a 401 dates nothing.
    reset="${out%%$'\t'*}"; rest="${out#*$'\t'}"; kind="${rest%%$'\t'*}"; row="${rest#*$'\t'}"
    [[ "$row" =~ ^[0-9]+$ ]] || row=-
    [[ "$reset" =~ ^[0-9]+$ ]] || reset=-
    [[ "$kind" =~ ^[a-z_]+$ ]] || kind=-
  fi
  if [[ -n "$key" ]]; then
    if (( rc == 0 )); then
      _reg_set "$id" tdate "$key 0 $row $reset $kind $f" 2>/dev/null || true
    elif (( rc == 1 )); then
      _reg_set "$id" tdate "$key 1 - - - $f" 2>/dev/null || true
    elif (( rc == 3 )) && [[ "$out" =~ ^[0-9]+$ ]]; then
      _reg_set "$id" tdate "$key 3 $out - - $f" 2>/dev/null || true
    fi
  fi
  (( rc == 3 )) && printf '%s\n' "$out"
  (( rc == 0 )) && printf '%s\t%s\t%s\n' "$row" "$reset" "$kind"
  return "$rc"
}
```

In `_limit_dated`, the rc-0 answer goes to `_hard_block_date` (which ignores every other rc in this task):

<!-- replay: replace ccd/ccd -->
```bash
  out=$(_limit_read "$id" "$f" "$born"); rc=$?
  (( rc == 0 )) && return 0
```

with

```bash
  out=$(_limit_read "$id" "$f" "$born"); rc=$?
  _hard_block_date "$rc" "$born" "$out"   # the dated row the rescue waits read (session-continuity §5.4 rule 2)
  (( rc == 0 )) && return 0
```

- [ ] **Step 5: The section, and five one-line wires**

Directly above `_strand_clear() {` (≈22360) insert the section — its header, the three constants (`RESCUE_CHAIN_WAIT`,
spec §5.4's 30 minutes, lives here because it bounds (a)'s hold after a reset turned; Task 2's chain wait reads the
same knob), the three globals,
`_hard_block_date`, `_hard_block_dated`, `_rw_field`, `_rescuewait_open`, `_rescuewait_close`, `_rescue_armed` and
`_rescue_policy`. `_rescue_armed` is the ONLY "armed" this section reads: `_pane_auto_continue_armed` alone matches a
human's draft or a line of prose, which for the sites that type only declines a keystroke but here would park a
STALLED session (Review Focus 19):

<!-- replay: insert-above ccd/ccd -->
```bash
_strand_clear() {   # id — the strand is over; say so exactly once per strand.
```

insert, directly above that line,

```bash
# ── THE RESCUE POLICY (session-continuity spec §5.4, rule 2; D-3498) ──────
# Rule 1 of that section — a carried-in banner is not a block — shipped as
# D-3526, above (`_limit_dated`, on the pane's own process start). What sits
# between that verdict and the rescue arm's `_dispatch_swap` lives here,
# below the frozen citation corpus, reached from one-line call sites above it:
#   2. WAIT NEAR THE CURRENT ACCOUNT'S OWN FIVE-HOUR RESET (C6, C13), and
#      record today's `stranded` path as the no-room wait.
# Every wait is recorded once on entry and once on exit, in
# `$REG/<id>.rescuewait` and in swap.log — never under the word `hold`, which
# is the workspace-reap hold (`$REG/<id>.hold`).
#
# THE DATED ROW. `_session_hard_blocked` clears HARD_BLOCK_RESET/TYPE/ROW on
# every call — `cmd_supervise` runs every tick in one long-lived shell, and a
# value this call did not set is a previous tick's — and `_hard_block_date`
# sets them only from a rate-limit row the dated read (`_limit_read`, cached
# on this process and file) answered rc 0 on: a pane rung through D-3526's own
# read, the transcript rung through `_hard_block_dated`, because its 30 s
# `tscan` cache skips the read. Four inputs date nothing, each measured:
#   - LOST AUTH. An auth-failure pane is never read (`_pane_carried_in`), and a
#     401 newer than the rate-limit row is the newest real row whoever wrote
#     it: the reader answers this process's 401 (`-` in every field) or, for an
#     earlier process's, no block row at all — never the rate-limit row under it;
#   - AN UNPLACED PROCESS. `_pane_born` unanswered: nothing is dated, so no wait
#     — and D-3526 already keeps the positive;
#   - A CARRIED-IN ROW. rc 3 is never a dated row, even where D-3526 keeps it a
#     block (no swap after it, or a process that never came up — which has no
#     live TUI, so no armed auto-continue either);
#   - A ROW WRITTEN AT OR AFTER ITS OWN `resetsAt` keeps no reset: that reset did
#     not turn the account, so it reaches no wait, no `.rescuewait` and no
#     `reset=` token — the reset is kept only where it could have turned it.
# A WAIT OF ANY KIND opens only on a dated rate-limit row carrying a kept reset
# and its window (`_rescuewait_open`'s gate). No such row is today's behaviour:
# swap, or strand. `~/.cc-limits` IS NOT A FALLBACK for the reset: it cannot say
# which window blocked, and a wait taken on the wrong window is a session
# parked for days.
RESCUE_WAIT_BOUND=600           # C13 — seconds before a five-hour reset inside which the rescue waits for Claude Code's armed auto-continue; 0 turns the NEAR wait off (a wait of another kind still ends in place at its reset, rule 2)
RESCUE_WAIT_GRACE=120           # seconds after that reset a wait holds for the continuation before it ends. ITS OWN CONSTANT, not STALE_PRESS_COOLDOWN, which paces keystrokes, not waits
RESCUE_CHAIN_WAIT=1800          # spec §5.4's 30 minutes (a knob), the longest the rescue holds a session on its account: in place after a reset turned (rule 2, until this long past that reset) and in a chain wait (rule 3, this long from its start)
HARD_BLOCK_RESET="" HARD_BLOCK_TYPE="" HARD_BLOCK_ROW=""   # the verdict's dated row (above); declared here so a stub of `_session_hard_blocked` leaves them set under `set -u`

_hard_block_date() {   # rc born answer — what `_limit_read`'s answer tells HARD_BLOCK_ROW/TYPE/RESET; always rc 0
  local row reset kind
  # AN UNPLACED PROCESS DATES NOTHING. The reader cannot place a row without
  # `since` either (it prints `-`), so this is the second of two locks, and
  # the one the policy owns.
  [[ "$2" =~ ^[0-9]+$ ]] || return 0
  [[ "$1" == 0 ]] || return 0               # only a block row this process wrote: rc 1, 2 and 3 date nothing
  IFS=$'\t' read -r row reset kind <<<"$3"  # `_limit_read` writes `-` for a missing field, so none is empty
  [[ "$row" =~ ^[0-9]+$ ]] || return 0      # a 401, or a row whose timestamp would not parse
  HARD_BLOCK_ROW="$row"
  [[ "$kind" =~ ^[a-z_]+$ ]] && HARD_BLOCK_TYPE="$kind"
  # A ROW WRITTEN AT OR AFTER ITS OWN RESET KEEPS NONE: that reset did not turn
  # the account. Real on this fleet — a 14-day survey found `five_hour` and
  # `seven_day` rows whose `resetsAt` was hours to days before their own
  # timestamp. The regex goes first (D-299); `10#` keeps a leading zero base ten.
  [[ "$reset" =~ ^[0-9]+$ ]] && (( 10#$row < 10#$reset )) && HARD_BLOCK_RESET="$reset"
  return 0
}

_hard_block_dated() {   # id — date the transcript rung's positive: `_limit_read`'s answer for this process and file, read even when the `tscan` cache skipped it
  local born f out
  born=$(_pane_born "$1"); [[ "$born" =~ ^[0-9]+$ ]] || return 0
  f=$(_transcript_path "$1") || return 0
  out=$(_limit_read "$1" "$f" "$born"); _hard_block_date "$?" "$born" "$out"
}

_rw_field() {   # record key -> that key's value from a `.rescuewait` line ("" when absent)
  [[ " $1 " =~ \ $2=([^ ]*)\  ]] && printf '%s' "${BASH_REMATCH[1]}"
  return 0
}

_rescuewait_open() {   # id wrapper kind(near|chain|noroom) -> 0 recorded, or this wait already open | 1 could not record | 2 nothing dated to wait on
  local id="$1" w="$2" kind="$3" reset="-" rec now
  # THE GATE FOR EVERY WAIT (section header): a dated rate-limit row carrying a
  # kept reset and its window. Lost auth, an unplaced process, a carried-in row
  # and a row written after its own reset all fail it, and the tick does what
  # it does today.
  [[ "${HARD_BLOCK_RESET:-}" =~ ^[0-9]+$ && "${HARD_BLOCK_TYPE:-}" =~ ^[a-z_]+$ ]] || return 2
  # THE RESET IT RECORDS is the five-hour reset, or `-`: `_rescue_policy` ends
  # a wait at the reset it was taken on and at no other, and only on the
  # account it was taken on, because two accounts can share a reset epoch.
  [[ "$HARD_BLOCK_TYPE" == five_hour ]] && reset="$HARD_BLOCK_RESET"
  rec=$(_reg_get "$id" rescuewait)
  if [[ "$(_rw_field "$rec" state)" == open ]]; then
    # THIS WAIT, CONTINUING — the same kind, account and reset — says nothing.
    # Any other open wait ends here: in the kind that replaces it (a chain wait
    # with no room left becomes the no-room wait), or `swap` when the session is
    # on another account now. So the record never holds two waits, and swap.log
    # never shows an entry without its exit.
    [[ "$(_rw_field "$rec" kind)" == "$kind" && "$(_rw_field "$rec" wrapper)" == "$w" \
       && "$(_rw_field "$rec" reset)" == "$reset" ]] && return 0
    if [[ "$(_rw_field "$rec" wrapper)" == "$w" ]]; then _rescuewait_close "$id" "$kind"; else _rescuewait_close "$id" swap; fi
  fi
  now=$(date +%s)
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
  [[ "$since" =~ ^[0-9]+$ ]] || since=0   # a torn record is never evaluated (D-299)
  now=$(date +%s)
  _reg_set "$id" rescuewait "state=closed kind=$kind since=$since reset=$reset wrapper=$w until=$now end=$end" || return 0
  echo "$(date '+%F %T') rescuewait-end $id: kind=$kind on $w reset=$reset after $((now - 10#$since))s end=$end" >> "$REG/swap.log"
}

_rescue_armed() {   # pane text -> Claude Code's own auto-continue FOOTER: `_pane_auto_continue_armed`'s phrases, outside the prompt box and on a `·`-separated line
  # A FALSE "ARMED" HERE PARKS A STALLED SESSION, where the typing sites that share the
  # detector only decline to type. So the footer's shape, as the two pane rungs read theirs:
  # a human's draft is not it (the footer renders BELOW the box, which `_pane_outside_box`
  # keeps), and nor is an assistant line that says the words without the separator.
  _pane_auto_continue_armed "$(_pane_outside_box "$1" | grep -F '·')"
}

_rescue_policy() {   # id wrapper pane hard-blocked -> 0 PROCEED as today | 1 HOLD this tick
  # THE ONE CALL SITE is `_auto_swap_check`'s verdict line, below both
  # cooldown gates — so every wait sits INSIDE `SWAP_COOLDOWN` and
  # `SWAPBLOCK_COOLDOWN`, never instead of them — and above target choice.
  # `_tick_strand_undecidable` deliberately does not call it: a tick that
  # cannot decide has no rescue to hold.
  #
  # IN ORDER:
  #   (0) not blocked: any open wait ends `clear` — which is how Claude Code's
  #       own timer, or the stale-phase Enter (D-2360), ends a wait at the reset;
  #   (a) a wait recorded against THIS dated five-hour reset on THIS account:
  #       hold through the reset and its grace — a near wait from entry, any
  #       other from the reset itself, except a STALLED no-room wait, which a
  #       target with room ends at once, as today's strand does. Past the grace
  #       an ARMED pane ends it `turned` and is held on this reset until
  #       RESCUE_CHAIN_WAIT past it, then the tick is today's — and only a wait
  #       that was open before that grace ran out, because one first taken
  #       after it never saw the account turn: Claude Code re-sends the turn
  #       itself, and ccd never swaps away from an account that has
  #       just reset. A STALLED pane is rescued as today: a
  #       near wait ends `turned` and the tick proceeds; a no-room wait stays
  #       open and ends in a swap the moment a target has room;
  #   (b) a near reset and an ARMED auto-continue: the near wait;
  #   otherwise proceed.
  # WHY (b) — AND AN END IN PLACE — NEED AN ARMED AUTO-CONTINUE: mechanism 5
  # names the cost of D-2236 as "the wait for one whose reset is minutes away"
  # — the session Claude Code will continue by itself. A STALLED session
  # (auto-resume off, its re-arm cap hit, a human's Esc) has nothing that
  # re-sends its turn at the reset, and nothing here types — the redrive
  # fallback types only on an unsubmitted resume pair, which a session waiting
  # on a banner is not — so a wait would park it; it is rescued as today, by a
  # swap whose `--resume` spawn re-drives the turn. ARMED is Claude Code's own
  # footer (`_rescue_armed`), never a draft or a line of prose saying the words.
  local id="$1" wrapper="$2" pane="$3" hb="$4" now rec state kind since rreset rend R
  if [[ -z "$hb" ]]; then
    _rescuewait_close "$id" clear
    return 0
  fi
  now=$(date +%s); R="${HARD_BLOCK_RESET:-}"
  rec=$(_reg_get "$id" rescuewait)
  state=$(_rw_field "$rec" state); kind=$(_rw_field "$rec" kind); since=$(_rw_field "$rec" since)
  rreset=$(_rw_field "$rec" reset); rend=$(_rw_field "$rec" end)
  # A NO-ROOM WAIT WHOSE RESET A NEWER ROW PROVES DID NOT TURN THE ACCOUNT — a
  # rate-limit row written at or after that reset whose own reset is kept
  # nowhere (S2: the retry at the reset met a stale `resetsAt`) — ends `stale`,
  # so §11 item 6 never counts it as a session idling past a reset.
  if [[ "$state" == open && "$kind" == noroom && "$rreset" =~ ^[0-9]+$ && "${HARD_BLOCK_ROW:-}" =~ ^[0-9]+$ \
        && -z "${HARD_BLOCK_RESET:-}" && -n "${HARD_BLOCK_TYPE:-}" && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \
     && (( 10#$HARD_BLOCK_ROW >= 10#$rreset )); then
    _rescuewait_close "$id" stale; state=closed; rend=stale
  fi
  if [[ "$R" =~ ^[0-9]+$ && "${HARD_BLOCK_TYPE:-}" == five_hour ]] && _is_anthropic_backend "$wrapper"; then
    if [[ "$rreset" == "$R" && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \
       && { [[ "$state" == open ]] || [[ "$state" == closed && "$rend" == turned ]]; }; then
      if (( now >= 10#$R + RESCUE_WAIT_GRACE )); then
        # …a wait that was open before its reset's grace ran out: one first taken
        # after it never saw the account turn, so it is not ended `turned` here.
        # AND ONLY UNTIL RESCUE_CHAIN_WAIT PAST THE RESET: an ARMED footer that far
        # past its reset, with the 429 still the newest row, says Claude Code is
        # not continuing, and `main` rescues that input at once. From then the
        # tick is today's — a swap to a target with room, or the strand — and no
        # second wait holds in place on this reset: one taken now is first taken
        # past its grace.
        if [[ "$since" =~ ^[0-9]+$ ]] && (( 10#$since < 10#$R + RESCUE_WAIT_GRACE )) \
           && (( now < 10#$R + RESCUE_CHAIN_WAIT )) && _rescue_armed "$pane"; then
          [[ "$state" == open ]] && { _rescuewait_close "$id" turned; _strand_clear "$id"; }
          return 1
        fi
        [[ "$state" == open && "$kind" != noroom ]] && _rescuewait_close "$id" turned
      elif [[ "$state" == open ]] && { [[ "$kind" == near ]] || (( now >= 10#$R )); } \
           && { [[ "$kind" != noroom ]] || _rescue_armed "$pane"; }; then
        return 1
      fi
    fi
    if (( RESCUE_WAIT_BOUND > 0 && now >= 10#$R - RESCUE_WAIT_BOUND && now < 10#$R + RESCUE_WAIT_GRACE )) \
       && _rescue_armed "$pane"; then
      _rescuewait_open "$id" "$wrapper" near && return 1
    fi
  fi
  return 0
}

```

In `_session_hard_blocked`, the verdict clears the three globals on every call (the line directly above
`# DEFENCE IN DEPTH, AND IT DECIDES NOTHING TODAY`):

<!-- replay: replace ccd/ccd -->
```bash
  HARD_BLOCK_VIA=""
```

with

```bash
  HARD_BLOCK_VIA=""; HARD_BLOCK_RESET=""; HARD_BLOCK_TYPE=""; HARD_BLOCK_ROW=""
```

and the transcript rung dates its positive on every tick, the cached one included (directly above the function's
closing `return 0`):

<!-- replay: replace ccd/ccd -->
```bash
  HARD_BLOCK_VIA=transcript
```

with

```bash
  HARD_BLOCK_VIA=transcript; _hard_block_dated "$id"
```

In `_auto_swap_check`, the policy sits on the verdict line — below both cooldown gates, above target choice; a hold
decided, so it clears `.tickstuck` exactly as the cooldown gates do (`ccd-limit-banner`'s source pin
`_session_hard_blocked "$id" "$pane" && hard_blocked=1` survives as a substring):

<!-- replay: replace ccd/ccd -->
```bash
  _session_hard_blocked "$id" "$pane" && hard_blocked=1
```

with

```bash
  _session_hard_blocked "$id" "$pane" && hard_blocked=1; _rescue_policy "$id" "$wrapper" "$pane" "$hard_blocked" || { [[ -z "$stuck" ]] && _tick_decided "$id"; return 0; }
```

the no-target strand also records the no-room wait (every line it logs today is unchanged; the undecidable strand
above it and `_tick_strand_undecidable` open nothing — a tick that cannot decide has no rescue to hold):

<!-- replay: replace ccd/ccd -->
```bash
    [[ -z "$target" && -n "$hard_blocked" ]] && _strand_mark "$id" "$wrapper" "$project"
```

with

```bash
    [[ -z "$target" && -n "$hard_blocked" ]] && { _strand_mark "$id" "$wrapper" "$project"; _rescuewait_open "$id" "$wrapper" noroom; }
```

and the rescue arm's line, still inline above the pin check (Pre-flight finding 5), ends any open wait as a swap:

<!-- replay: replace ccd/ccd -->
```bash
    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$([[ "${HARD_BLOCK_VIA:-}" == pane ]] || printf ' via=%s' "${HARD_BLOCK_VIA:-unknown}")" >> "$REG/swap.log"
```

with

```bash
    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$([[ "${HARD_BLOCK_VIA:-}" == pane ]] || printf ' via=%s' "${HARD_BLOCK_VIA:-unknown}")" >> "$REG/swap.log"; _rescuewait_close "$id" swap
```

In `cmd_swap`'s landing (≈23373), where the strand it supersedes is cleared:

<!-- replay: replace ccd/ccd -->
```bash
  # is falsified by the session having just moved.
  _strand_clear "$id"
```

with

```bash
  # is falsified by the session having just moved.
  _strand_clear "$id"
  _rescuewait_close "$id" swap   # and so is a rescue wait, whoever asked for the move (session-continuity §5.4)
```

- [ ] **Step 6: The inventory and the census, in place**

`_reg_purge`'s inventory (above the corpus — three lines for three; the window of Pre-flight finding 7):

<!-- replay: replace ccd/ccd -->
```bash
  # floors): 38; CCR-15's `child` made 39, D-3526's `carriednote` and `tdate` 41 — by addition, NOT a fresh census of
```

with

```bash
  # floors): 38; CCR-15's `child` made 39, D-3526's `carriednote` and `tdate` 41, continuity's `rescuewait` 42 — by addition, NOT a fresh census of
```

<!-- replay: replace ccd/ccd -->
```bash
  # The 41: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
```

with

```bash
  # The 42: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
```

<!-- replay: replace ccd/ccd -->
```bash
  # `reaping`, `setup`, `spawn`, `stalenarrownote`, `started`, `stopped`, `stranded`,
```

with

```bash
  # `reaping`, `rescuewait`, `setup`, `spawn`, `stalenarrownote`, `started`, `stopped`, `stranded`,
```

`_reg_get`'s census: this task adds three calls on three lines. Write this to `$SCRATCH/reg-get-census.py` — it
locates the block by CONTENT (the ONE line saying `invocations across`), derives the new pair from the pair the base
STATES plus three, refuses unless the header's two commands measure exactly that, and rewrites the two LAST MOVE
lines two for two (this wave's move first, the base's named after it with its count, the base's own chain kept) —
line-neutral, and with no 2–4 digit cardinal within 25 of the census (the census test's second case):

<!-- replay: save reg-get-census.py -->
```python
import re, subprocess, sys
# `_reg_get`'s census, re-measured IN PLACE and located by CONTENT — the one line that says
# `invocations across` — so it applies whatever pair and LAST MOVE the base states: Task 1 on this
# wave's base, and Task 4 after a merge took MAIN's census lines. Either way the tree must measure
# exactly the stated pair + 3 (this wave's three reads), and the two LAST MOVE lines are rewritten
# two for two: this wave's move first, the base's named after it with its own parenthetical, the
# base's own chain kept.
# Writes nothing on STOP.
DELTA = 3
OURS = "the rescue wait's reads (session-continuity wave 2), the +3"
def sh(cmd): return int(subprocess.run(['bash', '-c', cmd], capture_output=True, text=True, check=True).stdout)
n = sh("""grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l""")
m = sh("""grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'""")
src = open('ccd/ccd', encoding='utf8').read().split('\n')
hits = [i for i, l in enumerate(src) if 'invocations across' in l]
if len(hits) != 1: sys.exit(f'STOP: {len(hits)} lines say "invocations across", want 1')
i = hits[0]
a = re.fullmatch(r'(# .*this file makes )(\d+)', src[i - 1])
b = re.fullmatch(r'(# invocations across )(\d+)( non-comment lines\.)', src[i])
if not (a and b and src[i + 1] == '#' and src[i + 2].startswith('# THE LAST MOVE WAS ')
        and src[i + 3].startswith('# ') and src[i + 4].startswith("# BEFORE THAT IT WAS ROUTING SLICE 4's")):
    sys.exit(f'STOP: the census block at ccd/ccd:{i + 1} is not in the shape this step edits')
n0, m0 = int(a.group(2)), int(b.group(2))
if (n, m) != (n0 + DELTA, m0 + DELTA):
    sys.exit(f'STOP: stated {n0}/{m0} + {DELTA} is not the measured {n}/{m}')
move = re.fullmatch(r"THE LAST MOVE WAS (.+?), the \+(\d+)( \(.*?\))?; before it (.+)",
                    src[i + 2][2:] + ' ' + src[i + 3][2:])
if not move or OURS in src[i + 2]:
    sys.exit(f'STOP: the LAST MOVE lines are not "<move>, the +N [(...)]; before it <chain>": {src[i + 2]!r}')
new = [f'# THE LAST MOVE WAS {OURS}; before it {move.group(1)}, the +{move.group(2)}{move.group(3) or ""};',
       f'# then {move.group(4)}']
# The census test refuses any 2-4 digit cardinal within 25 of either count outside the census itself.
near = [t for t in re.findall(r'(?:D-|#|ccd:)?\d{2,4}(?:st|nd|rd|th)?\b', ' '.join(new))
        if not re.match(r'(?:D-|#|ccd:)', t) and min(abs(int(re.sub(r'\D', '', t)) - x) for x in (n, m)) <= 25]
if near: sys.exit(f'STOP: the new LAST MOVE lines carry a cardinal near the census: {near}')
src[i - 1] = a.group(1) + str(n)
src[i] = b.group(1) + str(m) + b.group(3)
src[i + 2], src[i + 3] = new
open('ccd/ccd', 'w', encoding='utf8').write('\n'.join(src))
print(f'census {n0}/{m0} -> {n}/{m} at ccd/ccd:{i}-{i + 1}; LAST MOVE at ccd/ccd:{i + 3}-{i + 4}, before it {move.group(1)}')
```

then run it from the repo root:

<!-- replay: bash -->
```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] || echo "STOP: SCRATCH is not an absolute directory"
grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l    # the base's stated calls + 3
grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'             # the base's stated lines + 3
python3 "$SCRATCH/reg-get-census.py"
```

Expected at `c88625aa`: `179`, `150`, then `census 176/147 -> 179/150 at ccd/ccd:2952-2953; LAST MOVE at
ccd/ccd:2955-2956, before it D-3526's carried-in verdict` (measured). The lines it writes:

```text
# THE LAST MOVE WAS the rescue wait's reads (session-continuity wave 2), the +3; before it D-3526's carried-in verdict, the +6 (`_limit_dated`, `_limit_read`, `_never_came_up`, three in `_carried_in_note`);
# then the RECLAIM region's reads (CCR-15 wave 3, Task 5), `_child_tmpdir`'s and CCR-10's.
```

Any `STOP` means nothing was written: a count other than `+3` means a read other than this task's three moved it
(find it before continuing); a LAST MOVE line not shaped `<move>, the +N [(…)]; before it <chain>` means a third
editor reached the block first (report it — never guess its chain). The base's parenthetical — the functions its
move named — is kept, after its count. Run once: a second run STOPs on its own `+3`
check and on its own move.

- [ ] **Step 7: Re-stamp, then pay the corpus tax**

<!-- replay: bash -->
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
```

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
```

Expected: `syntax-ok`; README's anchors unchanged (`ccd/ccd:21564`, `ccd/ccd:20279-20281`); `147 / 195 / 58 / 38` on
stated, base and tree, composition empty. Then the corpus-frozen check.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/ccd-limit-banner.test.ts \
  test/ownership.test.ts test/ccd-reg-get-census.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-swap-pin.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
./node_modules/.bin/vitest run test/ccd-crosspool.test.ts test/ccd-project-pool.test.ts test/ccd-swap-refuse.test.ts \
  test/ccd-swap.test.ts test/ccd-swap-carry.test.ts
./node_modules/.bin/vitest run test/ccd-authdead.test.ts test/ccd-hard-blocked-narrow.test.ts test/ccd-limit-stale.test.ts \
  test/ccd-auto-swap-hold.test.ts test/ccd-arith-containment.test.ts test/ccd-redrive.test.ts
```

Expected (measured on the prototype at this task): `ccd-rescue-policy` 60/60, `ccd-limit-banner` 136/136,
`ownership` 14/14, `ccd-reg-get-census` 3/3, `ccd-auto-swap-pool` 43/43, `ccd-swap-pin` 13/13; the citation cases
`7 passed | 328 skipped (335)`; the rest green (on the full prototype: 125, 65, 18 + 1 skipped, 16, 19; 56, 11, 19,
5, 29, 31).

- [ ] **Step 9: Mutation check, then commit**

Each row applied to a saved copy of the file, run, and restored from that copy (`cmp`). Measured on the full
prototype (Tasks 1–3), so a row may also red a case Task 2 or 3 adds; at this task's commit quote what you get.
Multi-line edits show their lines joined by ` / `.

| # | File | Exact edit (old → new) | Suites | Measured red on the full prototype |
|---|---|---|---|---|
| 1.1 | `ccd/ccd` | `stuck = sys.argv[1:2] in (["stuck"], ["dated"])` → `stuck = sys.argv[1:2] == ["stuck"]` | ccd-rescue-policy, ccd-limit-banner | 39 failed of 230: ccd-limit-banner: “auth loss newest in the transcript rescues a prompt pane, via=transcript (D-3522)”; ccd-limit-banner: “a rescue off a 401 marks the account auth-dead, so nothing sends a session back to it (D-3522)”; ccd-limit-banner: “the rescue never writes over a standing marker (D-3522)”; … and 36 more |
| 1.2 | `ccd/ccd` | `+ (f"\t{int(stamp(found)) if stamp(found) is not None else chr(45)}" if sys.argv[1:2] == ["dated"] else ""))` → `)` | ccd-rescue-policy, ccd-limit-banner | 39 failed of 230: ccd-limit-banner: “a rate-limit row this process wrote: rc 0, stuck mode's two fields, then the row's own epoch”; ccd-limit-banner: “no since, or one that is not digits: still rc 0 — never taken away — but the row cannot be placed: `-`”; ccd-limit-banner: “a row without quotaLimits keeps both empty fields, so the epoch is always the third”; … and 36 more |
| 1.3 | `ccd/ccd` | `out=$(_transcript_limit_banner "$f" dated "$born"); rc=$?` → `out=$(_transcript_limit_banner "$f" stuck "$born"); rc=$?` | ccd-rescue-policy, ccd-limit-banner | 36 failed of 230: ccd-limit-banner: “_limit_read caches the rc-0 row beside the answer, and prints it from the cache without a read”; ccd-limit-banner: “each field is its own: a row with no quotaLimits caches `- -` after its epoch, never its epoch as a reset”; ccd-limit-banner: “a record in the shape before this wave is re-read, never trusted, and rewritten”; … and 33 more |
| 1.4 | `ccd/ccd` | `reset="${out%%$'\t'*}"; rest="${out#*$'\t'}"; kind="${rest%%$'\t'*}"; row="${rest#*$'\t'}"` → `IFS=$'\t' read -r reset kind row <<<"$out"` | ccd-rescue-policy, ccd-limit-banner | 1 failed of 230: ccd-limit-banner: “each field is its own: a row with no quotaLimits caches `- -` after its epoch, never its epoch as a reset” |
| 1.5 | `ccd/ccd` | `&& "$cached_reset$cached_type" == -- ]]` → `]]` | ccd-rescue-policy, ccd-limit-banner | 1 failed of 230: ccd-limit-banner: “a torn record for this key — an rc 1 with a row, an rc 3 with a reset — is never trusted” |
| 1.6 | `ccd/ccd` | `local re='^([0-9]+ [0-9]+ [0-9]+) ([013]) ([0-9]+\|-) ([0-9]+\|-) ([a-z_]+\|-) (/.+)$'` → `local re='^([0-9]+ [0-9]+ [0-9]+) ([013]) ([0-9]+\|-) ()()(.+)$'` | ccd-rescue-policy, ccd-limit-banner | 4 failed of 230: ccd-limit-banner: “a pane positive reads the transcript once per process and file: the second tick does not read it again”; ccd-limit-banner: “a new process is read again: born is a key — a 401 is dated by it”; ccd-limit-banner: “_limit_read caches the rc-0 row beside the answer, and prints it from the cache without a read”; … and 1 more |
| 1.6b | `ccd/ccd` | `\|\| [[ "$cached_rc" == 1 && "$cached_row$cached_reset$cached_type" == --- ]] \` → `\|\| [[ "$cached_rc" == 1 ]] \` | ccd-rescue-policy, ccd-limit-banner | 1 failed of 230: ccd-limit-banner: “a torn record for this key — an rc 1 with a row, an rc 3 with a reset — is never trusted” |
| 1.7 | `ccd/ccd` | `_hard_block_date "$rc" "$born" "$out"   # the dated row the rescue waits read (session-continuity §5.4 rule 2)` → `(nothing)` | ccd-rescue-policy, ccd-limit-banner | 30 failed of 230: ccd-rescue-policy: “a rate-limit row this process wrote is dated on the pane rung: its reset, its window, its own epoch”; ccd-rescue-policy: “the globals are cleared on every call — one supervise shell runs every tick”; ccd-rescue-policy: “a five_hour row whose reset is 300 s out, auto-continue armed: no dispatch, one entry line, and the record”; … and 27 more |
| 1.8 | `ccd/ccd` | `# the one the policy owns.` / `[[ "$2" =~ ^[0-9]+$ ]] \|\| return 0` → `# the one the policy owns.` | ccd-rescue-policy, ccd-limit-banner | 1 failed of 230: ccd-rescue-policy: “_hard_block_date keeps nothing for an unplaced process, a 401 or another answer, and no reset a row was written at or after” |
| 1.9 | `ccd/ccd` | `[[ "$1" == 0 ]] \|\| return 0               # only a block row` → `: \|\| return 0               # only a block row` | ccd-rescue-policy, ccd-limit-banner | 1 failed of 230: ccd-rescue-policy: “_hard_block_date keeps nothing for an unplaced process, a 401 or another answer, and no reset a row was written at or after” |
| 1.10 | `ccd/ccd` | `[[ "$reset" =~ ^[0-9]+$ ]] && (( 10#$row < 10#$reset )) && HARD_BLOCK_RESET="$reset"` → `[[ "$reset" =~ ^[0-9]+$ ]] && HARD_BLOCK_RESET="$reset"` | ccd-rescue-policy, ccd-limit-banner, measure-continuity-stage4 | 8 failed of 239: ccd-rescue-policy: “_hard_block_date keeps nothing for an unplaced process, a 401 or another answer, and no reset a row was written at or after”; ccd-rescue-policy: “a row written AFTER its own resetsAt opens no wait of any kind: stranded with no record, then rescued when room appears”; ccd-rescue-policy: “armed, a row newer than its reset: no near wait”; … and 5 more |
| 1.11 | `ccd/ccd` | `HARD_BLOCK_VIA=""; HARD_BLOCK_RESET=""; HARD_BLOCK_TYPE=""; HARD_BLOCK_ROW=""` → `HARD_BLOCK_VIA=""` | ccd-rescue-policy, ccd-limit-banner | 1 failed of 230: ccd-rescue-policy: “the globals are cleared on every call — one supervise shell runs every tick” |
| 1.12 | `ccd/ccd` | `HARD_BLOCK_VIA=transcript; _hard_block_dated "$id"` → `HARD_BLOCK_VIA=transcript` | ccd-rescue-policy, ccd-limit-banner | 2 failed of 230: ccd-rescue-policy: “the transcript rung dates its positive on the tick its tscan cache answers, too”; ccd-rescue-policy: “the chain wait holds on the transcript rung's cached tick too — the dated row is read there” |
| 1.13 | `ccd/ccd` | `[[ "${HARD_BLOCK_RESET:-}" =~ ^[0-9]+$ && "${HARD_BLOCK_TYPE:-}" =~ ^[a-z_]+$ ]] \|\| return 2` → `(nothing)` | ccd-rescue-policy, ccd-limit-banner, measure-continuity-stage4 | 7 failed of 239: ccd-rescue-policy: “lost auth takes no wait: [rate-limit row, a turn, a 401] under an armed near-reset footer strands with no record, then dispatches — this process wrote the 401”; ccd-rescue-policy: “lost auth takes no wait: [rate-limit row, a turn, a 401] under an armed near-reset footer strands with no record, then dispatches — an earlier process wrote it, and a swap carried it here”; ccd-rescue-policy: “lost auth takes no wait: [rate-limit row, a turn, a 401] under an armed near-reset footer strands with no record, then dispatches — tmux cannot place the pane”; … and 4 more |
| 1.14 | `ccd/ccd` | `if (( RESCUE_WAIT_BOUND > 0 && now >= 10#$R - RESCUE_WAIT_BOUND && now < 10#$R + RESCUE_WAIT_GRACE )) \` → `if false \` | ccd-rescue-policy | 6 failed of 94: ccd-rescue-policy: “a five_hour row whose reset is 300 s out, auto-continue armed: no dispatch, one entry line, and the record”; ccd-rescue-policy: “armed, a reset that passed inside the grace with no record: the near wait opens (the control for RESCUE_WAIT_BOUND=0)”; ccd-rescue-policy: “a held tick is a decision: it clears a standing tickstuck stamp”; … and 3 more |
| 1.15 | `ccd/ccd` | `now >= 10#$R - RESCUE_WAIT_BOUND && now < 10#$R + RESCUE_WAIT_GRACE` → `now < 10#$R + RESCUE_WAIT_GRACE` | ccd-rescue-policy | 2 failed of 94: ccd-rescue-policy: “a reset outside the bound dispatches at once”; ccd-rescue-policy: “GRACE after the reset WITH a rate-limit row newer than the reset: a dispatch follows” |
| 1.16 | `ccd/ccd` | `(( RESCUE_WAIT_BOUND > 0 && now >= 10#$R` → `(( now >= 10#$R` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “RESCUE_WAIT_BOUND=0 turns the wait off INSIDE the grace too: a reset that just passed dispatches” |
| 1.17 | `ccd/ccd` | `&& _rescue_armed "$pane"; then` / `_rescuewait_open "$id" "$wrapper" near` → `; then` / `_rescuewait_open "$id" "$wrapper" near` | ccd-rescue-policy | 6 failed of 94: ccd-rescue-policy: “a STALLED session (no armed auto-continue) is rescued as today, reset or no reset”; ccd-rescue-policy: “a STALLED no-room wait inside its reset grace swaps the moment a target has room”; ccd-rescue-policy: “a human draft that says "continuing shortly" is not an armed auto-continue: a STALLED banner near its reset dispatches”; … and 3 more |
| 1.18 | `ccd/ccd` | `if [[ "$R" =~ ^[0-9]+$ && "${HARD_BLOCK_TYPE:-}" == five_hour ]] && _is_anthropic_backend "$wrapper"; then` → `if [[ "$R" =~ ^[0-9]+$ && "${HARD_BLOCK_TYPE:-}" == five_hour ]]; then` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a non-Anthropic lane never waits on a reset” |
| 1.19 | `ccd/ccd` | `if [[ "$R" =~ ^[0-9]+$ && "${HARD_BLOCK_TYPE:-}" == five_hour ]]` → `if [[ "$R" =~ ^[0-9]+$ && -n "${HARD_BLOCK_TYPE:-}" ]]` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a seven_day row 300 s out dispatches — only the five-hour window is waited on” |
| 1.20 | `ccd/ccd` | `[[ "$state" == open ]] && { _rescuewait_close "$id" turned; _strand_clear "$id"; }` / `return 1` → `[[ "$state" == open ]] && { _rescuewait_close "$id" turned; _strand_clear "$id"; }` / `return 0` | ccd-rescue-policy | 8 failed of 94: ccd-rescue-policy: “the grace is its OWN constant: RESCUE_WAIT_GRACE moves the end, STALE_PRESS_COOLDOWN does not”; ccd-rescue-policy: “GRACE after the reset with no newer row, armed: the wait ends in place and nothing dispatches on this reset, inside RESCUE_CHAIN_WAIT”; ccd-rescue-policy: “control: an ARMED session whose closed turned record names this reset is held”; … and 5 more |
| 1.21 | `ccd/ccd` | `&& { [[ "$kind" != noroom ]] \|\| _rescue_armed "$pane"; }; then` / `return 1` → `&& { [[ "$kind" != noroom ]] \|\| _rescue_armed "$pane"; }; then` / `:` | ccd-rescue-policy | 3 failed of 94: ccd-rescue-policy: “an open near wait holds through the reset and its grace, even once the pane stops saying armed”; ccd-rescue-policy: “control: an ARMED no-room wait inside its reset grace is held”; ccd-rescue-policy: “an open near wait holds from entry, before its reset, even once the pane stops saying armed” |
| 1.22 | `ccd/ccd` | `if [[ "$rreset" == "$R" && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \` → `if [[ "$rreset" == "$R" ]] \` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a turned record on ANOTHER account does not hold this one — two accounts can share a reset epoch” |
| 1.23 | `ccd/ccd` | `if (( now >= 10#$R + RESCUE_WAIT_GRACE )); then` → `if (( now >= 10#$R + STALE_PRESS_COOLDOWN )); then` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “the grace is its OWN constant: RESCUE_WAIT_GRACE moves the end, STALE_PRESS_COOLDOWN does not” |
| 1.24 | `ccd/ccd` | `{ _strand_mark "$id" "$wrapper" "$project"; _rescuewait_open "$id" "$wrapper" noroom; }` → `_strand_mark "$id" "$wrapper" "$project"` | ccd-rescue-policy, measure-continuity-stage4 | 8 failed of 103: ccd-rescue-policy: “no target with room: no dispatch, a stranded record, and the no-room wait — recorded once”; ccd-rescue-policy: “an open wait taken on another account ends as a swap, and the wait on this account opens beside it”; ccd-rescue-policy: “a wait of the same kind on the same account but another reset is a new wait: the old one ends, the new one opens”; … and 5 more |
| 1.25 | `ccd/ccd` | `rec=$(_reg_get "$id" rescuewait)` / `[[ "$(_rw_field "$rec" state)" == open ]] \|\| return 0` → `rec=$(_reg_get "$id" rescuewait)` | ccd-rescue-policy | 14 failed of 94: ccd-rescue-policy: “an unplaced process takes no wait: tmux cannot say when the pane was born, and a near reset on an armed pane dispatches as today”; ccd-rescue-policy: “lost auth takes no wait: a 401 this process wrote after a near-reset rate-limit row dispatches, armed or not”; ccd-rescue-policy: “control: the same carried row on a process that came up is carried in — no rescue, no wait”; … and 11 more |
| 1.26 | `ccd/ccd` | `&& "$(_rw_field "$rec" reset)" == "$reset" ]] && return 0` → `&& "$(_rw_field "$rec" reset)" == "$reset" ]] && :` | ccd-rescue-policy | 3 failed of 94: ccd-rescue-policy: “no target with room: no dispatch, a stranded record, and the no-room wait — recorded once”; ccd-rescue-policy: “a STALLED no-room wait across its own reset is rescued once a target has room, not held”; ccd-rescue-policy: “a chain wait at its bound with no target that has room becomes the no-room wait” |
| 1.27 | `ccd/ccd` | `then _rescuewait_close "$id" "$kind"; else _rescuewait_close "$id" swap; fi` → `then _rescuewait_close "$id" "$kind"; else _rescuewait_close "$id" "$kind"; fi` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “an open wait taken on another account ends as a swap, and the wait on this account opens beside it” |
| 1.28 | `ccd/ccd` | `>> "$REG/swap.log"; _rescuewait_close "$id" swap` → `>> "$REG/swap.log"` | ccd-rescue-policy, measure-continuity-stage4 | 10 failed of 103: ccd-rescue-policy: “GRACE after the reset WITH a rate-limit row newer than the reset: a dispatch follows”; ccd-rescue-policy: “a rate-limit row written after the reset with the SAME resetsAt ends the wait in a swap”; ccd-rescue-policy: “no target with room: no dispatch, a stranded record, and the no-room wait — recorded once”; … and 7 more |
| 1.29 | `ccd/ccd` | `_rescuewait_close "$id" swap   # and so is a rescue wait` → `: _rescuewait_close "$id" swap   # and so is a rescue wait` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “cmd_swap's landing closes it `swap`” |
| 1.30 | `ccd/ccd` | `[[ "$state" == open && "$kind" != noroom ]] &&` → `[[ "$state" == open ]] &&` | ccd-rescue-policy | 2 failed of 94: ccd-rescue-policy: “a STALLED no-room wait across its own reset is rescued once a target has room, not held”; ccd-rescue-policy: “a wait first taken long after its reset never ends `turned`: an ARMED pane 10 min past its reset is rescued once a target has room” |
| 1.31 | `ccd/ccd` | `if [[ "$since" =~ ^[0-9]+$ ]] && (( 10#$since < 10#$R + RESCUE_WAIT_GRACE )) \` / `&& (( now < 10#$R + RESCUE_CHAIN_WAIT )) && _rescue_armed "$pane"; then` → `if true; then` | ccd-rescue-policy | 6 failed of 94: ccd-rescue-policy: “a STALLED session whose closed turned record names this reset is rescued”; ccd-rescue-policy: “a STALLED no-room wait across its own reset is rescued once a target has room, not held”; ccd-rescue-policy: “a wait first taken long after its reset never ends `turned`: an ARMED pane 10 min past its reset is rescued once a target has room”; … and 3 more |
| 1.32 | `ccd/ccd` | `\` / `&& { [[ "$kind" != noroom ]] \|\| _rescue_armed "$pane"; }; then` → `; then` | ccd-rescue-policy | 2 failed of 94: ccd-rescue-policy: “a STALLED no-room wait inside its reset grace swaps the moment a target has room”; ccd-rescue-policy: “…nor does that draft hold a STALLED no-room wait inside its reset grace once a target has room (S3)” |
| 1.33 | `ccd/ccd` | `{ _rescuewait_close "$id" turned; _strand_clear "$id"; }` → `{ _rescuewait_close "$id" turned; }` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “an ARMED no-room wait that crosses its own reset ends in place, never in a swap, even once a target has room” |
| 1.34 | `ccd/ccd` | `[[ "$since" =~ ^[0-9]+$ ]] \|\| since=0   # a torn record is never evaluated (D-299)` → `(nothing)` | ccd-rescue-policy | 2 failed of 94: ccd-rescue-policy: “a torn record is never evaluated (D-299), and closes with its own fields”; ccd-rescue-policy: “a torn chain record is never evaluated, and does not hold (D-299)” |
| 1.35 | `ccd/ccd` | `_rescue_policy "$id" "$wrapper" "$pane" "$hard_blocked" \|\| { [[ -z "$stuck" ]] && _tick_decided "$id"; return 0; }` → `: _rescue_policy` | ccd-rescue-policy | 22 failed of 94: ccd-rescue-policy: “a five_hour row whose reset is 300 s out, auto-continue armed: no dispatch, one entry line, and the record”; ccd-rescue-policy: “the grace is its OWN constant: RESCUE_WAIT_GRACE moves the end, STALE_PRESS_COOLDOWN does not”; ccd-rescue-policy: “an open near wait holds through the reset and its grace, even once the pane stops saying armed”; … and 19 more |
| 1.36 | `ccd/ccd` | `_rescuewait_close "$id" clear` / `return 0` → `return 0` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “the verdict clearing at the reset (Claude Code continued) ends the wait, once, as `clear`” |
| 1.37 | `ccd/ccd` | `if [[ "$rreset" == "$R" && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \` → `if [[ "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “GRACE after the reset WITH a rate-limit row newer than the reset: a dispatch follows” |
| 1.38 | `ccd/ccd` | `[[ "$row" =~ ^[0-9]+$ ]] \|\| return 0      # a 401` → `: \|\| return 0      # a 401` | ccd-rescue-policy, ccd-limit-banner | 2 failed of 230: ccd-rescue-policy: “_hard_block_date keeps nothing for an unplaced process, a 401 or another answer, and no reset a row was written at or after”; ccd-rescue-policy: “lost auth takes no wait: a 401 this process wrote after a near-reset rate-limit row dispatches, armed or not” |
| 1.39 | `ccd/ccd` | `[[ "$reset" =~ ^[0-9]+$ ]] \|\| reset=-` → `(nothing)` | ccd-rescue-policy, ccd-limit-banner | 3 failed of 230: ccd-limit-banner: “a new process is read again: born is a key — a 401 is dated by it”; ccd-limit-banner: “each field is its own: a row with no quotaLimits caches `- -` after its epoch, never its epoch as a reset”; ccd-limit-banner: “a 401 caches rc 0 with nothing dated; rc 1 caches `- - -`; rc 3 its row and `- -`” |
| 1.40 | `ccd/ccd` | `[[ "$kind" =~ ^[a-z_]+$ ]] \|\| kind=-` → `(nothing)` | ccd-rescue-policy, ccd-limit-banner | 3 failed of 230: ccd-limit-banner: “a new process is read again: born is a key — a 401 is dated by it”; ccd-limit-banner: “each field is its own: a row with no quotaLimits caches `- -` after its epoch, never its epoch as a reset”; ccd-limit-banner: “a 401 caches rc 0 with nothing dated; rc 1 caches `- - -`; rc 3 its row and `- -`” |
| 1.41 | `ccd/ccd` | `[[ "$row" =~ ^[0-9]+$ ]] \|\| row=-` → `(nothing)` | ccd-rescue-policy, ccd-limit-banner | 2 failed of 230: ccd-limit-banner: “a new process is read again: born is a key — a 401 is dated by it”; ccd-limit-banner: “a 401 caches rc 0 with nothing dated; rc 1 caches `- - -`; rc 3 its row and `- -`” |
| 1.42 | `ccd/ccd` | `\|\| [[ "$cached_rc" == 0 ]]; }; then` → `; }; then` | ccd-rescue-policy, ccd-limit-banner | 2 failed of 230: ccd-limit-banner: “a new process is read again: born is a key — a 401 is dated by it”; ccd-limit-banner: “_limit_read caches the rc-0 row beside the answer, and prints it from the cache without a read” |
| 1.43 | `ccd/ccd` | `now >= 10#$R - RESCUE_WAIT_BOUND && now < 10#$R + RESCUE_WAIT_GRACE )) \` → `now >= 10#$R - RESCUE_WAIT_BOUND && now < 10#$R )) \` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “armed, a reset that passed inside the grace with no record: the near wait opens (the control for RESCUE_WAIT_BOUND=0)” |
| 1.44 | `ccd/ccd` | `{ [[ "$kind" == near ]] \|\| (( now >= 10#$R )); }` → `(( now >= 10#$R ))` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “an open near wait holds from entry, before its reset, even once the pane stops saying armed” |
| 1.45 | `ccd/ccd` | `{ [[ "$kind" == near ]] \|\| (( now >= 10#$R )); }` → `[[ "$kind" == near ]]` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “control: an ARMED no-room wait inside its reset grace is held” |
| 1.46 | `ccd/ccd` | `[[ "$HARD_BLOCK_TYPE" == five_hour ]] && reset="$HARD_BLOCK_RESET"` → `reset="$HARD_BLOCK_RESET"` | ccd-rescue-policy, measure-continuity-stage4 | 1 failed of 103: ccd-rescue-policy: “a seven_day block with no target that has room records the no-room wait with reset=- (only a five-hour reset is recorded)” |
| 1.47 | `ccd/ccd` | `&& "$(_rw_field "$rec" reset)" == "$reset" ]] && return 0` → `]] && return 0` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a wait of the same kind on the same account but another reset is a new wait: the old one ends, the new one opens” |
| 1.48 | `ccd/ccd` | `[[ "$(_rw_field "$rec" kind)" == "$kind" && "$(_rw_field "$rec" wrapper)" == "$w" \` → `[[ "$(_rw_field "$rec" kind)" == "$kind" \` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “an open wait taken on another account ends as a swap, and the wait on this account opens beside it” |
| 1.49 | `ccd/ccd` | `[[ "$state" == closed && "$rend" == turned ]]` → `[[ "$state" == closed ]]` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a closed record on this reset that did not end turned holds nothing: an armed pane past the grace is rescued as today” |
| 1.50 | `ccd/ccd` | `\|\| { [[ -z "$stuck" ]] && _tick_decided "$id"; return 0; }` → `\|\| { return 0; }` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a held tick is a decision: it clears a standing tickstuck stamp” |
| 1.51 | `ccd/ccd` | `[[ "$kind" =~ ^[a-z_]+$ ]] && HARD_BLOCK_TYPE="$kind"` → `HARD_BLOCK_TYPE="$kind"` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “_hard_block_date keeps nothing for an unplaced process, a 401 or another answer, and no reset a row was written at or after” |
| 1.52 | `ccd/ccd` | `_pane_auto_continue_armed "$(_pane_outside_box "$1" \| grep -F '·')"` → `_pane_auto_continue_armed "$1"` | ccd-rescue-policy | 4 failed of 94: ccd-rescue-policy: “a human draft that says "continuing shortly" is not an armed auto-continue: a STALLED banner near its reset dispatches”; ccd-rescue-policy: “…nor does that draft hold a STALLED no-room wait inside its reset grace once a target has room (S3)”; ccd-rescue-policy: “…nor does a draft that quotes the footer itself, separator and all”; … and 1 more |
| 1.53 | `ccd/ccd` | `_pane_auto_continue_armed "$(_pane_outside_box "$1" \| grep -F '·')"` → `_pane_auto_continue_armed "$(_pane_outside_box "$1")"` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “…nor is the assistant's own last line saying "Continuing shortly" above a STALLED banner” |
| 1.54 | `ccd/ccd` | `_pane_auto_continue_armed "$(_pane_outside_box "$1" \| grep -F '·')"` → `_pane_auto_continue_armed "$(grep -F '·' <<<"$1")"` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “…nor does a draft that quotes the footer itself, separator and all” |
| 1.55 | `ccd/ccd` | `if [[ "$since" =~ ^[0-9]+$ ]] && (( 10#$since < 10#$R + RESCUE_WAIT_GRACE )) \` / `&& (( now < 10#$R + RESCUE_CHAIN_WAIT )) && _rescue_armed "$pane"; then` → `if (( now < 10#$R + RESCUE_CHAIN_WAIT )) && _rescue_armed "$pane"; then` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a wait first taken long after its reset never ends `turned`: an ARMED pane 10 min past its reset is rescued once a target has room” |
| 1.56 | `ccd/ccd` | `if [[ "$state" == open && "$kind" == noroom && "$rreset" =~ ^[0-9]+$ && "${HARD_BLOCK_ROW:-}" =~ ^[0-9]+$ \` / `&& -z "${HARD_BLOCK_RESET:-}" && -n "${HARD_BLOCK_TYPE:-}" && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \` / `&& (( 10#$HARD_BLOCK_ROW >= 10#$rreset )); then` / `_rescuewait_close "$id" stale; state=closed; rend=stale` / `fi` → `(nothing)` | ccd-rescue-policy, measure-continuity-stage4 | 2 failed of 103: ccd-rescue-policy: “a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and the strand stands”; measure-continuity-stage4: “a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and is not counted past its reset” |
| 1.57 | `ccd/ccd` | `&& (( now < 10#$R + RESCUE_CHAIN_WAIT )) && _rescue_armed "$pane"; then` → `&& _rescue_armed "$pane"; then` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “the hold after a reset turned ends RESCUE_CHAIN_WAIT past it: held at R+GRACE+60 and at R+RESCUE_CHAIN_WAIT-60, rescued at R+RESCUE_CHAIN_WAIT+60” |

Rows 1.8, 1.9 and 1.13 are each one of two locks, and are measured as such: with 1.8 applied the integration case
"an unplaced process takes no wait…" stays green, because `dated` mode cannot place a row without `since` (pinned by
`ccd-limit-banner`'s "no since, or one that is not digits…"); with 1.9 applied, rc 1 and 2 still date nothing,
because their answer is empty and fails the row check; only the helper's own case reds. Rows 1.52–1.54 take
`_rescue_armed` apart: back to the bare detector (every "not armed" case reds), without the `·` line filter (the
assistant's prose reds), and without `_pane_outside_box` (the draft that quotes the footer, separator and all,
reds). Row 1.57 takes away the bound on (a)'s hold after a reset turned (Review Focus 23): only the bounded-hold case
reds, at `R+RESCUE_CHAIN_WAIT+60`; row 1.55, which takes away the since clause instead, reds only the case for a wait
first taken ten minutes after its reset — inside the bound, so the bound does not hide it. Regression controls no
row reds, by design (green before, green after): bound 0 before the reset (the lower
bound alone keeps it off), a row with no reset (no fallback code exists), the purge (suffix-shaped), a refused swap
(the landing's close sits after the refusal points), and the two armed-footer controls (the footer below the box,
and 2.1.280's `⚠` footer), which every "armed" read passes.

```bash
git add ccd/ccd server/test/ccd-rescue-policy.test.ts server/test/ccd-limit-banner.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the rescue waits near a five-hour reset, on the row D-3526 dated (continuity rule 2)

The verdict now keeps the rate-limit row's resetsAt, window and own epoch —
only from the row D-3526's reader answered rc 0 on, i.e. a row this pane's
process wrote. _transcript_limit_banner gains a `dated` mode (stuck plus the
row's epoch, three lines in place); _limit_read reads it and caches the row
beside its answer in .tdate (a new shape; the old one is re-read, never
parsed); _hard_block_date sets HARD_BLOCK_RESET/TYPE/ROW, which
_session_hard_blocked clears on every call. An unplaced process, lost auth
on either surface, a carried-in row and a reset the row was written at or
after date nothing, and no wait of any kind opens without a dated row.

A five_hour block on an Anthropic lane whose kept reset is within
RESCUE_WAIT_BOUND=600 s, with Claude Code's auto-continue ARMED — its own
footer, outside the prompt box and on its `·` line (_rescue_armed), never a
draft or prose saying the words — waits: nothing typed, recorded once on
entry and once on exit in $REG/<id>.rescuewait and swap.log (never the word
"hold"). It ends at the reset, or RESCUE_WAIT_GRACE=120 s after it: in a swap
if a newer rate-limit row exists; otherwise, while still armed and only for a
wait open before that grace ran out, in place, never in a swap away from that
reset, and only until RESCUE_CHAIN_WAIT=1800 s past it (then the tick is
today's). A STALLED pane is rescued as today. Today's stranded path is the
no-room wait with the same reset ending; a stalled one swaps the moment a
target has room, inside the grace too; one whose reset a newer row proves
stale ends `stale`. cmd_swap's landing ends any open wait as a swap.
RESCUE_WAIT_BOUND=0 turns the near wait off. Amends D-2236 /
post-swap-redrive R1 (C6, C13, D-3498).

_reg_get census +3 calls on 3 lines (reg-get-census.py over the base's
stated pair); inventory 42 with rescuewait. S6-R11: line-neutral above
README's anchors; the census did not move.
MSG
)"
```

---

### Task 2: Rule 3 — spread, do not bounce, the chain wait, and the dated tokens

**Model routing:** `opus`, effort `high` — it edits `_swap_target`, the one function every placement decision runs
through.

**Files:**
- Modify: `ccd/ccd` — the section's title and rule list, four constants and three globals, `_hard_block_date`'s rc-3
  line, three fragments of `_rescue_policy`, and three new functions (`_rescue_history`, `_rescue_target`,
  `_rescue_line_extra`) directly above `_strand_clear() {`; two line-neutral edits in `_swap_target` (≈16347,
  ≈16412), two in `_auto_swap_check` (≈17429, ≈17603)
- Test: `server/test/ccd-rescue-policy.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `HARD_BLOCK_RESET`/`TYPE`/`ROW`, `.rescuewait` and its verbs; `swap.log`'s `auto-rescue` lines;
  `_swap_target`'s rc contract (0 a name or stay, 1 must leave and nothing can take it, 2–5 undecidable, 6 a name
  one rung down).
- Produces: `_rescue_history <id>` → rc 0 with `RESCUE_COUNT` (this session's rescues in `RESCUE_CHAIN_WINDOW`),
  `RESCUE_SKIP_LEFT` (their sources, except one whose logged `reset=` passed), `RESCUE_SKIP_RECENT` (every rescue
  target in `RESCUE_SPREAD_WINDOW`) | rc 2 unmeasurable, all empty. `SWAP_TARGET_SKIP` — a space-separated account
  list `_swap_target` passes over in its candidate walk and its home-return branch; empty or unset changes nothing.
  `_rescue_target <id> <cur> <home> <hard_blocked> <hrc>` → `_swap_target`'s stdout and rc; byte for byte
  `_swap_target` off the rescue path, with nowhere to go, on the unskipped probe's undecidable answer, or with no
  history; the spread pass's answer is taken only at rc 0 — every other answer, its rc 5 included, falls through to
  the just-left-only pass — and the spread list never names the session's home. `kind=chain` in `.rescuewait` — an
  Anthropic lane, a dated block, no wait open, and never on a five-hour reset whose grace has passed; an open chain
  wait holds only on the account it was taken on. The `auto-rescue` line appends ` reset=<epoch>`, ` type=<word>`,
  ` row=<epoch>` when the verdict kept them — ` row=` alone for a row older than this process that D-3526 kept a block.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-rescue-policy.test.ts`:

<!-- replay: append server/test/ccd-rescue-policy.test.ts -->
```ts

// ── RULE 3 — spread, do not bounce, chain-wait ────────────────────────────────

/** A swap.log line at `ago` seconds in the past, in the log's own LOCAL-time format. */
const pastLog = (ago: number, rest: string): void => {
  h.sh(`printf '%(%F %T)T %s\\n' "$(( $(date +%s) - ${ago} ))" ${JSON.stringify(rest)} >> "$REG/swap.log"`);
};

describe('rule 3: spread, no bounce, and the chain wait', () => {
  /** Real `_swap_target`: every home-able lane under the ceiling but `claude`,
   *  claude-a the least used, so an unskipped rescue from `claude` takes claude-a. */
  const lanes = (): void => {
    const t = now();
    for (const [w, five] of [['claude', 100], ['claude-a', 10], ['claude-b', 20], ['claude-d', 30]] as const) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
        JSON.stringify({ five, seven: 5, ts: t, fiveResetAt: t + 10000, sevenResetAt: t + 400000 }));
    }
  };
  const blockNow = (): void => { const t = now(); writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]); };
  const threeFrom = (from: string): void => {
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: ${from} (blocked) -> claude [home=claude]`);
  };

  it('the auto-rescue line carries the dated row: reset=, type= and row=', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 10, t + 9000, 'five_hour')]);
    tick(PROMPT);
    expect(logLines('auto-rescue')[0]).toMatch(new RegExp(`via=transcript reset=${t + 9000} type=five_hour row=${t - 10}$`));
  });

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

  // A reset the row was written after is never logged, so it lifts no skip: the
  // account the row proved still blocked is not taken back inside the hour.
  it('a row written days after its own reset logs no reset=, and the next rescue does not bounce back to that account', () => {
    seed('claude-a'); lanes(); const t = now();
    writeTranscript([limitRow(t - 5, t - 8 * 86400, 'seven_day')]);
    tick(STALLED, null);
    expect(logLines('auto-rescue')[0]).toMatch(new RegExp(`claude-a \\(blocked\\) -> claude-b \\[home=claude\\] via=banner type=seven_day row=${t - 5}$`));
    h.sh(`_reg_set ${ID} wrapper claude-b; _reg_set ${ID} lastswap ${t - 1000}`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`, `dispatch ${ID} -> claude-d`]);
  });

  it('spread: a target another session was rescued onto minutes ago is passed over while another has room', () => {
    seed(); lanes(); blockNow();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`]);
  });

  it('control: a target rescued onto longer ago than RESCUE_SPREAD_WINDOW is not passed over', () => {
    seed(); lanes(); blockNow();
    pastLog(900, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it("control: other sessions' rescues neither count toward this session's chain wait nor mark an account it left", () => {
    seed(); lanes(); blockNow();
    for (const ago of [3000, 2500, 2000]) pastLog(ago, 'auto-rescue other-sess: claude-a (blocked) -> claude-d [home=claude]');
    tick(STALLED, null);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('control: rescues older than RESCUE_CHAIN_WINDOW neither count toward the chain wait nor skip the account left', () => {
    seed(); lanes(); blockNow();
    for (const ago of [5000, 4500, 4000]) pastLog(ago, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`);
    tick(STALLED, null);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
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

  it('the chain wait holds on the transcript rung\'s cached tick too — the dated row is read there', () => {
    seed(); lanes(); blockNow();
    threeFrom('claude-d');
    tick(PROMPT, null); tick(PROMPT, null);
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 1$/);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });

  it('after RESCUE_CHAIN_WAIT the chain wait swaps — to a target that is not the account it just left blocked', () => {
    seed(); lanes(); blockNow();
    threeFrom('claude-a');
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=chain since=$(( $(date +%s) - 1801 )) reset=- wrapper=claude"`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('an ARMED chain wait whose account resets inside it ends in place and does not swap', () => {
    seed(); lanes(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 1000, R, 'five_hour')]);
    threeFrom('claude-d');
    openWait('chain', t - 1000, R);
    tick(ARMED, null);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  it('a STALLED chain wait whose account reset ends turned and the tick rescues, with no second chain wait', () => {
    seed(); lanes(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 1000, R, 'five_hour')]);
    threeFrom('claude-a');
    openWait('chain', t - 1000, R);
    tick(STALLED, null);
    expect(dispatches(), 'claude-a is the account it just left blocked').toEqual([`dispatch ${ID} -> claude-b`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    expect(logLines('rescuewait'), 'a second chain wait opened on the reset that just turned').toHaveLength(0);
  });

  it('a chain wait at its bound with no target that has room becomes the no-room wait', () => {
    seed(); blockNow();
    threeFrom('claude-d');
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

  it('spread never passes over HOME: a recovered home another session was rescued onto minutes ago is still where the rescue goes', () => {
    seed('claude-b'); lanes(); const t = now();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude.json'), JSON.stringify({ five: 10, seven: 5, ts: t }));
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-b.json'), JSON.stringify({ five: 100, seven: 5, ts: t }));
    blockNow();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude [home=claude]');
    tick(STALLED, null);
    expect(dispatches(), 'a third account first, then the affinity path home: two moves for one').toEqual([`dispatch ${ID} -> claude`]);
  });

  it('an unreadable swap log is today\'s behaviour: no chain wait, no skip', () => {
    seed(); lanes(); blockNow();
    fs.mkdirSync(regFile('swap.log'));
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('a tail with no rescue in it is a MEASURED empty history (rc 0); a log nobody can read is not (rc 2)', () => {
    seed();
    pastLog(60, 'swap other-sess: claude -> claude-a (uuid u1)');
    expect(h.sh(`_rescue_history ${ID}; echo "rc=$? $RESCUE_COUNT|$RESCUE_SKIP_LEFT|$RESCUE_SKIP_RECENT"`)).toBe('rc=0 0||');
    fs.rmSync(regFile('swap.log')); fs.mkdirSync(regFile('swap.log'));
    expect(h.sh(`_rescue_history ${ID}; echo "rc=$?"`)).toBe('rc=2');
  });

  it('a NON-rescue tick is `_swap_target` byte for byte: no skip list reaches the affinity path', () => {
    seed();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    const out = h.sh(`_swap_target() { echo "skip=[\${SWAP_TARGET_SKIP:-}]"; }; _rescue_target ${ID} claude claude '' 0`);
    expect(out).toBe('skip=[]');
  });

  it('nowhere to go is `_swap_target` byte for byte, and reads no swap log — a strand is asked every tick', () => {
    seed();
    const out = h.sh(`_swap_target() { return 1; }; _rescue_history() { echo history-read >> "$HOME/ccd-calls"; return 0; };
      out=$(_rescue_target ${ID} claude claude 1 0); echo "[$out] rc=$?"`);
    expect(out).toBe('[] rc=1');
    expect(h.calls()).not.toContain('history-read');
  });

  it('spread never buys a class degrade: a first-pass rc 6 falls through to the just-left-only pass', () => {
    seed();
    // claude-a is the only same-class target with room, and a rescue landed on
    // it minutes ago; with it skipped, `_swap_target` degrades onto claude-d.
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    const out = h.sh(`_swap_target() { if [[ " \${SWAP_TARGET_SKIP:-} " == *" claude-a "* ]]; then echo claude-d; return 6; fi; echo claude-a; return 0; };
      out=$(_rescue_target ${ID} claude claude 1 0); echo "$out rc=$?"`);
    expect(out).toBe('claude-a rc=0');
  });

  it('spread never turns a rescue undecidable: a spread-pass rc 5 falls through to the just-left-only pass', () => {
    seed();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    const out = h.sh(`_swap_target() { if [[ " \${SWAP_TARGET_SKIP:-} " == *" claude-a "* ]]; then return 5; fi; echo claude-a; return 0; };
      out=$(_rescue_target ${ID} claude claude 1 0); echo "$out rc=$?"`);
    expect(out).toBe('claude-a rc=0');
  });

  it('…end to end: the recent target is the only measured lane with room and another lane is unmeasured — rescued, not marked undecidable', () => {
    seed(); lanes(); const t = now();
    blockNow();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-b.json'), JSON.stringify({ five: 100, seven: 5, ts: t }));
    pastLog(120, 'auto-rescue other-sess: claude-b (blocked) -> claude-a [home=claude-b]');
    // The class window is unmeasured on claude-d alone (`_class_gate` rc 2).
    h.sh(`${STUBS(STALLED, null)} _route_peek() { [[ "$2" == class ]] && echo opus; return 0; };
      _class_gate() { [[ -z "\${2:-}" ]] && return 0; [[ "$1" == claude-d ]] && return 2; return 0; };
      _auto_swap_check ${ID}`, BORN());
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'tickstuck')).toBeNull();
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(false);
  });

  it('a Codex-lane session on its fourth rescue in the hour is rescued at once, and its exclusion is written', () => {
    seed('gpt'); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    for (const ago of [3000, 2000, 1000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> gpt [home=claude]`);
    tick(PROMPT, 'claude-a');
    expect(dispatches()).toHaveLength(1);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-limits', 'gpt.json')), 'the lane\'s "pool is full" signal').toBe(true);
  });

  it('an auth-failure pane is never chain-waited — lost auth has no reset to wait for', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    threeFrom('claude-d');
    tick(AUTH);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toHaveLength(1);
  });

  it('a 401 only the transcript shows is never chain-waited either (D-3522)', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 100, t + 9000, 'five_hour'), authRow(t - 5)]);
    threeFrom('claude-d');
    tick(PROMPT);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toHaveLength(1);
  });

  it('a pane positive the transcript cannot date is never chain-waited — no dated row, no wait of any kind', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 300, t + 9000, 'five_hour'), turn(t - 30)]);
    threeFrom('claude-d');
    tick(STALLED);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toHaveLength(1);
  });

  it('a 401 arriving during an open chain wait is rescued at once', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 100, t + 9000, 'five_hour'), authRow(t - 5)]);
    threeFrom('claude-d');
    openWait('chain', t - 60, t + 9000);
    tick(PROMPT);
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('a torn chain record is never evaluated, and does not hold (D-299)', () => {
    seed(); blockNow();
    threeFrom('claude-d');
    const marker = path.join(h.home, 'evaluated');
    h.sh(`_reg_set ${ID} rescuewait 'state=open kind=chain since=REG[$(touch ${marker})] reset=- wrapper=claude'`);
    tick(STALLED);
    expect(fs.existsSync(marker)).toBe(false);
    expect(dispatches()).toHaveLength(1);
  });

  it('no chain wait opens on a five-hour reset whose grace has passed: the fourth rescue in the hour goes at once', () => {
    seed(); lanes(); const t = now(); const R = t - 3000;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> claude [home=claude]`);
    tick(ARMED, null); tick(ARMED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });

  it('an open chain wait taken on ANOTHER account does not hold this one', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300000, 'seven_day')]);
    openWait('chain', t - 60, '-', 'claude-b');
    tick(STALLED);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  // D-3526's never-came-up landing: its row is carried in (rc 3), kept a block,
  // and dates nothing — but the rescue line still names the row, so §9's
  // "rescues on a carried-in banner" stays countable.
  it('a rescue of a landing that never came up names its carried row= and no reset= or type=', () => {
    seed(); const t = now(); const born = t - 990;
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour')]);
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 4"`);
    tick(ARMED, 'claude-a', { TMUX_CREATED: String(born) });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(logLines('auto-rescue')[0]).toMatch(new RegExp(`\\[home=claude\\] row=${t - 3000}$`));
    expect(h.sh(`_hard_block_date 3 5 100; echo "$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROW"`)).toBe('||100');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts`

Expected (measured at Task 1's tip with this file): FAIL, `15 failed | 79 passed (94)` — the dated tokens; skip;
the no-bounce after a stale reset; spread; the fourth-rescue chain wait and its cached-tick twin; chain expiry; the
STALLED chain-reset case; home-return; the measured-empty history; the non-rescue and nowhere-to-go byte-for-byte
cases, the class degrade and the spread-pass rc 5 (on `_rescue_target`/`_rescue_history: command not found`); and
the never-came-up `row=`. Every Task 1 case stays green, and so do nineteen of this task's: the least-used control,
"…unless its logged five-hour reset has already passed", the three window controls (spread window, other sessions,
chain window), "spread is a preference…", the ARMED chain-reset case (Task 1's arm already ends it), the chain→no-room
case (red only through row 2.6, Review Focus 4), "spread never passes over HOME" and the end-to-end rc-5 case (no
spread exists before this task), an unreadable log, and the Codex-lane, auth-pane, transcript-401,
undated-positive, 401-mid-chain, torn-chain, passed-grace and other-account chain cases (no chain wait exists before
this task; they red through rows 2.9 (Codex), 1.25 (auth pane, transcript 401, undated positive), 2.10 (401
mid-chain), 1.34 and 2.5 (torn chain), 2.8 (passed grace), 2.5 and 2.24 (other account)).

- [ ] **Step 3: The section's rule 3 — title, rule line, constants and globals**

`RESCUE_CHAIN_WAIT` is not among them: Task 1 defined it, because it also bounds (a)'s hold after a reset turned.

<!-- replay: replace ccd/ccd -->
```bash
# ── THE RESCUE POLICY (session-continuity spec §5.4, rule 2; D-3498) ──────
```

with

```bash
# ── THE RESCUE POLICY (session-continuity spec §5.4, rules 2–3; D-3498) ─────
```

<!-- replay: insert-below ccd/ccd -->
```bash
#      record today's `stranded` path as the no-room wait.
```

insert, directly below that line,

```bash
#   3. SPREAD, DO NOT BOUNCE, AND CHAIN-WAIT a fourth rescue inside the hour.
```

<!-- replay: insert-below ccd/ccd -->
```bash
HARD_BLOCK_RESET="" HARD_BLOCK_TYPE="" HARD_BLOCK_ROW=""   # the verdict's dated row (above); declared here so a stub of `_session_hard_blocked` leaves them set under `set -u`
```

insert, directly below that line,

```bash
RESCUE_CHAIN_COUNT=3            # rescues of ONE session inside RESCUE_CHAIN_WINDOW after which the next one chain-waits first
RESCUE_CHAIN_WINDOW=3600        # the window those rescues are counted in; also how long an account the session left blocked is skipped, unless its logged reset passes first
RESCUE_SPREAD_WINDOW=600        # a target that received ANY session's rescue this recently is taken only when no other placeable target exists
RESCUE_LOG_TAIL_BYTES=1048576   # swap.log bytes rule 3 reads (1 MiB, spec §5.4 rule 3); a short read undercounts, which is today's behaviour
RESCUE_COUNT=0 RESCUE_SKIP_LEFT="" RESCUE_SKIP_RECENT=""   # `_rescue_history`'s answers
```

- [ ] **Step 4: `_hard_block_date` tells the rescue line a carried row's epoch**

rc 3 — a row older than this process that D-3526 keeps a block (no swap after it, or a process that never came up)
— gives the `row=` token and nothing more, so §9's "rescues on a carried-in banner" stays countable while no wait
keys on it:

<!-- replay: replace ccd/ccd -->
```bash
  [[ "$1" == 0 ]] || return 0               # only a block row this process wrote: rc 1, 2 and 3 date nothing
```

with

```bash
  # rc 3 — a row older than this process that D-3526 keeps a block (no swap
  # after it, or a process that never came up) — tells the rescue line its
  # `row=` and nothing more: it keeps no reset and no window, so no wait keys on it.
  [[ "$1" == 3 && "$3" =~ ^[0-9]+$ ]] && { HARD_BLOCK_ROW="$3"; return 0; }
  [[ "$1" == 0 ]] || return 0               # only a block row this process wrote: rc 1 and 2 date nothing
```

- [ ] **Step 5: Rule 3 in `_rescue_policy`**

Three fragments, each located by content inside the function Task 1 wrote (Task 1 already reads the record's
`since`). Its "IN ORDER" comment:

<!-- replay: replace ccd/ccd -->
```bash
  #       just reset. A STALLED pane is rescued as today: a
  #       near wait ends `turned` and the tick proceeds; a no-room wait stays
  #       open and ends in a swap the moment a target has room;
  #   (b) a near reset and an ARMED auto-continue: the near wait;
  #   otherwise proceed.
```

with

```bash
  #       just reset. A STALLED pane is rescued as today: a
  #       near or chain wait ends `turned` and the tick proceeds, with no chain
  #       wait on this reset; a no-room wait stays open and ends in a swap the
  #       moment a target has room;
  #   (b) a near reset and an ARMED auto-continue: the near wait;
  #   (c) a fourth rescue inside RESCUE_CHAIN_WINDOW, on an Anthropic lane: the
  #       chain wait, up to RESCUE_CHAIN_WAIT;
  #   otherwise proceed — and `_rescue_target` applies rule 3's skip lists.
```

a STALLED near or chain wait that crossed its reset ends `turned`, and the record reads closed for the chain check
below:

<!-- replay: replace ccd/ccd -->
```bash
        [[ "$state" == open && "$kind" != noroom ]] && _rescuewait_close "$id" turned
```

with

```bash
        [[ "$state" == open && "$kind" != noroom ]] && { _rescuewait_close "$id" turned; state=closed; }
```

and the chain wait, after rule 2 (the function's last lines) — never on a five-hour reset whose grace has run out,
which is also what keeps a second chain wait off the reset a STALLED wait just ended `turned` on (Review Focus 6,
20), and only on the account an open one was taken on (Review Focus 22):

<!-- replay: replace ccd/ccd -->
```bash
      _rescuewait_open "$id" "$wrapper" near && return 1
    fi
  fi
  return 0
}
```

with

```bash
      _rescuewait_open "$id" "$wrapper" near && return 1
    fi
  fi
  # (c) THE CHAIN WAIT (rule 3) — for a dated rate-limit block on an Anthropic
  # lane, and never on a five-hour reset whose grace has already run out: (a)
  # rules on that reset for a wait that saw it (a STALLED near or chain wait
  # ends `turned` there and is rescued, with no second chain wait), and a reset
  # no wait saw turn is not one to wait on either. A Codex-lane hold would
  # return before the rescue arm writes that lane's only "pool is full" signal
  # (`$LIMITS_DIR/<wrapper>.json`), so other sessions would keep landing on the
  # exhausted lane — the herd this rule exists to stop. Lost auth dates nothing
  # (section header), so it never chain-waits, and an open chain wait ends on
  # the tick its verdict stops being a dated rate-limit block: a 401 arriving
  # mid-wait is rescued at once. The swap log is read here only with no wait
  # open, so an open no-room wait never turns back into a chain wait, and an
  # open chain wait runs to its own bound whatever the hour's count does — on the
  # account it was taken on only.
  if [[ "$R" =~ ^[0-9]+$ && "${HARD_BLOCK_TYPE:-}" =~ ^[a-z_]+$ ]] && _is_anthropic_backend "$wrapper"; then
    if [[ "$state" == open ]]; then
      [[ "$kind" == chain && "$since" =~ ^[0-9]+$ && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \
        && (( now - 10#$since < RESCUE_CHAIN_WAIT )) && return 1
    elif ! { [[ "${HARD_BLOCK_TYPE:-}" == five_hour ]] && (( now >= 10#$R + RESCUE_WAIT_GRACE )); } \
         && _rescue_history "$id" && (( RESCUE_COUNT >= RESCUE_CHAIN_COUNT )); then
      _rescuewait_open "$id" "$wrapper" chain && return 1
    fi
  fi
  return 0
}
```

- [ ] **Step 6: `_rescue_history`, `_rescue_target` and `_rescue_line_extra`**

Directly above `_strand_clear() {` (so below `_rescue_policy`) insert:

<!-- replay: insert-above ccd/ccd -->
```bash
_strand_clear() {   # id — the strand is over; say so exactly once per strand.
```

insert, directly above that line,

```bash
_rescue_history() {   # id -> 0 measured (RESCUE_COUNT, RESCUE_SKIP_LEFT, RESCUE_SKIP_RECENT set) | 2 unmeasurable (all empty)
  # RULE 3 READS THE SWAP LOG, which already carries every rescue with its
  # time, source and target — the same file §9's instrument reads, so the
  # policy and its measurement cannot disagree about what happened. Only its
  # tail (`RESCUE_LOG_TAIL_BYTES`), and only when a decision needs it: the chain
  # check of a blocked tick with no wait open, and the target choice of a
  # rescue that has somewhere to go — not the ticks a strand waits through,
  # which need neither.
  # Its times are `date '+%F %T'`, LOCAL time, so python converts with `mktime`.
  #   RESCUE_COUNT       this session's `auto-rescue` lines in RESCUE_CHAIN_WINDOW;
  #   RESCUE_SKIP_LEFT   their SOURCE accounts ("an account the session just
  #                      left blocked"), except one whose logged `reset=` passed;
  #   RESCUE_SKIP_RECENT every session's rescue TARGET in RESCUE_SPREAD_WINDOW.
  # UNMEASURABLE IS TODAY'S BEHAVIOUR: no chain wait, no skip. A log that does
  # not exist yet is a MEASURED empty history (rc 0), not an unreadable one, and
  # so is a tail with no rescue in it (`grep` rc 1).
  local id="$1" out
  RESCUE_COUNT=0; RESCUE_SKIP_LEFT=""; RESCUE_SKIP_RECENT=""
  [[ -e "$REG/swap.log" ]] || return 0
  [[ -f "$REG/swap.log" && -r "$REG/swap.log" ]] || return 2
  command -v python3 >/dev/null 2>&1 || return 2
  out=$(tail -c "$RESCUE_LOG_TAIL_BYTES" "$REG/swap.log" 2>/dev/null | { grep -F ' auto-rescue ' || (( $? == 1 )); } | python3 -c '
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

_rescue_target() {   # id cur home hard-blocked hrc -> `_swap_target`'s stdout and rc, rule 3's skip lists applied to a RESCUE
  # NOT A RESCUE, NOWHERE TO GO, OR NOBODY CAN SAY IS `_swap_target` BYTE FOR
  # BYTE: the affinity path's choice is not this spec's; skipping can only
  # remove a candidate, so a strand — asked every 5 s for hours — never pays
  # the swap-log read; and the unskipped probe's undecidable answer (rc 2-5)
  # goes back as it came — the spread pass's never does.
  # For a rescue with somewhere to go, SWAP_TARGET_SKIP names what the
  # candidate walk and the home-return branch pass over: first the accounts
  # this session just left blocked AND every target a rescue landed on inside
  # RESCUE_SPREAD_WINDOW; if that leaves nothing, the just-left accounts alone
  # ("prefers a target that has not received a rescue ... when another
  # placeable target exists"). A just-left account is never taken back while
  # it is skipped — that is "do not bounce" — so a rescue whose only room is
  # the account it just left strands, and waits there.
  # SPREAD IS A PREFERENCE, NEVER BOUGHT WITH A CLASS DEGRADE: the first pass's
  # name is taken only at rc 0. Its rc 6 ("a name, chosen one rung DOWN") can
  # mean the only same-class target with room is one the spread skipped — the
  # walk passes a skipped candidate before `_class_gate` counts it — and the
  # just-left-only pass below then decides, as it does for everything else.
  # SPREAD NEVER PASSES OVER HOME: a recovered home another session was just
  # rescued onto would only be returned to by the affinity path at the next
  # idle tick — two moves where one does (do-not-bounce still skips a home the
  # session just left blocked).
  local out rc recent
  out=$(_swap_target "$@"); rc=$?
  if [[ -z "$4" || -z "$out" ]] || (( rc >= 2 && rc <= 5 )) || ! _rescue_history "$1" \
     || [[ -z "$RESCUE_SKIP_LEFT$RESCUE_SKIP_RECENT" ]]; then
    [[ -n "$out" ]] && printf '%s\n' "$out"
    return "$rc"
  fi
  recent=" $RESCUE_SKIP_RECENT "; [[ -n "$3" ]] && recent="${recent// "$3" / }"   # spread never passes over HOME: the affinity path would only move it back
  if [[ -n "${recent// /}" ]]; then
    out=$(SWAP_TARGET_SKIP="$RESCUE_SKIP_LEFT $recent" _swap_target "$@"); rc=$?
    [[ -n "$out" && "$rc" -eq 0 ]] && { printf '%s\n' "$out"; return 0; }
    # …and ITS undecidable answer is never returned: the unskipped probe above
    # already answered every question the skip cannot change (rc 2-4 are asked
    # before the walk), so an rc 5 here means the skip removed every measured
    # candidate and left only an unmeasured lane — the just-left-only pass decides.
  fi
  SWAP_TARGET_SKIP="$RESCUE_SKIP_LEFT" _swap_target "$@"
}

_rescue_line_extra() {   # -> the dated row's tokens for the `auto-rescue` line: ` reset=<epoch>`, ` type=<word>`, ` row=<epoch>`, each only when the verdict kept it
  # APPENDED, so every line this fleet's log already carries keeps its exact
  # shape when nothing was dated. `_rescue_history` reads `reset=` back (an
  # account whose logged reset passed is not "just left blocked" any more), and
  # §9's instrument compares `row=` with the landing the log itself records.
  # `reset=` is only ever a reset the row predates (see `_hard_block_date`), so
  # a row written after its own reset lifts no skip; `row=` is also told for a
  # row older than this process that D-3526 kept a block, so a rescue on a
  # carried-in banner stays countable.
  [[ -n "${HARD_BLOCK_RESET:-}" ]] && printf ' reset=%s' "$HARD_BLOCK_RESET"
  [[ -n "${HARD_BLOCK_TYPE:-}" ]] && printf ' type=%s' "$HARD_BLOCK_TYPE"
  [[ -n "${HARD_BLOCK_ROW:-}" ]] && printf ' row=%s' "$HARD_BLOCK_ROW"
  return 0
}

```

- [ ] **Step 7: The skip list, line-neutral, in `_swap_target` and at the two call-site lines**

Inside `_swap_target` only — its candidate walk (`for cand in $(_pool_for "$id")`), and the FIRST line of its
home-return branch (#195 added `&& ! _authdead "$home"` to that branch's third line, which is not touched).
`${SWAP_TARGET_SKIP:-}`, never `$SWAP_TARGET_SKIP`: every other caller never sets it, and a test extracts
`_swap_target` under `set -u`.

<!-- replay: replace ccd/ccd within _swap_target -->
```bash
      [[ "$cand" == "$cur" ]] && continue
```

with

```bash
      [[ "$cand" == "$cur" || " ${SWAP_TARGET_SKIP:-} " == *" $cand "* ]] && continue
```

<!-- replay: replace ccd/ccd within _swap_target -->
```bash
    if [[ "$hrc" -eq 0 ]] \
```

with

```bash
    if [[ "$hrc" -eq 0 && " ${SWAP_TARGET_SKIP:-} " != *" $home "* ]] \
```

In `_auto_swap_check`, the target choice goes through `_rescue_target`:

<!-- replay: replace ccd/ccd -->
```bash
  target=$(_swap_target "$id" "$wrapper" "$home" "$hard_blocked" "$hrc"); strc=$?
```

with

```bash
  target=$(_rescue_target "$id" "$wrapper" "$home" "$hard_blocked" "$hrc"); strc=$?
```

and the rescue arm's line appends the dated tokens (still inline, still above the pin check):

<!-- replay: replace ccd/ccd -->
```bash
    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$([[ "${HARD_BLOCK_VIA:-}" == pane ]] || printf ' via=%s' "${HARD_BLOCK_VIA:-unknown}")" >> "$REG/swap.log"; _rescuewait_close "$id" swap
```

with

```bash
    echo "$(date '+%F %T') auto-rescue $id: $wrapper (blocked) -> $target [home=$home]$([[ "${HARD_BLOCK_VIA:-}" == pane ]] || printf ' via=%s' "${HARD_BLOCK_VIA:-unknown}")$(_rescue_line_extra)" >> "$REG/swap.log"; _rescuewait_close "$id" swap
```

- [ ] **Step 8: Re-stamp, the corpus tax, and the tests**

<!-- replay: bash -->
```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
```

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l    # the calls Task 1's sentence states — this task adds none
grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'             # the lines it states
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/ccd-reg-get-census.test.ts \
  test/ownership.test.ts test/ccd-swap-target-class.test.ts test/ccd-swap-pin.test.ts test/ccd-auto-swap-pool.test.ts
./node_modules/.bin/vitest run test/ccd-crosspool.test.ts test/ccd-project-pool.test.ts test/ccd-default-pool.test.ts \
  test/ccd-login-screen.test.ts test/ccd-authdead.test.ts test/ccd-auto-swap-hold.test.ts test/ccd-limits.test.ts \
  test/ccd-account-ok.test.ts
```

Expected: `syntax-ok`; README's anchors and `147 / 195 / 58 / 38` unmoved; the census the pair Task 1 wrote (179/150
at `c88625aa`), its test green; all PASS — measured on the prototype: `ccd-rescue-policy` 94/94, `ccd-reg-get-census`
3/3, `ownership` 14/14, `ccd-swap-target-class` 23/23, `ccd-swap-pin` 13/13, `ccd-auto-swap-pool` 43/43; then
`ccd-crosspool` 125, `ccd-project-pool` 65, `ccd-default-pool` 14, `ccd-login-screen` 40, `ccd-authdead` 56,
`ccd-auto-swap-hold` 5, `ccd-limits` 28, `ccd-account-ok` 25 (its `cmd_ws_add` cases need ws-add's free-disk floor:
`export CCD_DISK_FLOOR_GB=1` on a full disk).

- [ ] **Step 9: Mutation check, then commit**

Measured on the full prototype; each row applies at this task's commit too.

| # | File | Exact edit (old → new) | Suites | Measured red on the full prototype |
|---|---|---|---|---|
| 2.1 | `ccd/ccd` | `[[ "$cand" == "$cur" \|\| " ${SWAP_TARGET_SKIP:-} " == *" $cand "* ]] && continue` → `[[ "$cand" == "$cur" ]] && continue` | ccd-rescue-policy | 6 failed of 94: ccd-rescue-policy: “a target the session just left blocked is skipped”; ccd-rescue-policy: “a row written days after its own reset logs no reset=, and the next rescue does not bounce back to that account”; ccd-rescue-policy: “spread: a target another session was rescued onto minutes ago is passed over while another has room”; … and 3 more |
| 2.2 | `ccd/ccd` | `if [[ "$hrc" -eq 0 && " ${SWAP_TARGET_SKIP:-} " != *" $home "* ]] \` → `if [[ "$hrc" -eq 0 ]] \` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “the home-return branch honours the skip too: a session rescued off its home is not sent straight back” |
| 2.3 | `ccd/ccd` | `SWAP_TARGET_SKIP="$RESCUE_SKIP_LEFT" _swap_target "$@"` / `}` → `return 1` / `}` | ccd-rescue-policy | 16 failed of 94: ccd-rescue-policy: “a target the session just left blocked is skipped”; ccd-rescue-policy: “spread is a preference: when the recent target is the only one with room, it is taken”; ccd-rescue-policy: “after RESCUE_CHAIN_WAIT the chain wait swaps — to a target that is not the account it just left blocked”; … and 13 more |
| 2.4 | `ccd/ccd` | `(( RESCUE_COUNT >= RESCUE_CHAIN_COUNT ))` → `(( RESCUE_COUNT > RESCUE_CHAIN_COUNT ))` | ccd-rescue-policy | 2 failed of 94: ccd-rescue-policy: “a fourth rescue within the hour takes the chain wait — recorded with kind=chain, nothing dispatched”; ccd-rescue-policy: “the chain wait holds on the transcript rung's cached tick too — the dated row is read there” |
| 2.5 | `ccd/ccd` | `[[ "$kind" == chain && "$since" =~ ^[0-9]+$ && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \` / `&& (( now - 10#$since < RESCUE_CHAIN_WAIT )) && return 1` → `[[ "$kind" == chain ]] && return 1` | ccd-rescue-policy | 4 failed of 94: ccd-rescue-policy: “after RESCUE_CHAIN_WAIT the chain wait swaps — to a target that is not the account it just left blocked”; ccd-rescue-policy: “a chain wait at its bound with no target that has room becomes the no-room wait”; ccd-rescue-policy: “a torn chain record is never evaluated, and does not hold (D-299)”; … and 1 more |
| 2.6 | `ccd/ccd` | `if [[ "$state" == open ]]; then` / `[[ "$kind" == chain` → `if [[ "$state" == open && "$kind" == chain ]]; then` / `[[ "$kind" == chain` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a chain wait at its bound with no target that has room becomes the no-room wait” |
| 2.7 | `ccd/ccd` | `if not (r and int(r.group(1)) <= now) and m.group(3) not in left:` → `if m.group(3) not in left:` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “…unless its logged five-hour reset has already passed” |
| 2.8 | `ccd/ccd` | `elif ! { [[ "${HARD_BLOCK_TYPE:-}" == five_hour ]] && (( now >= 10#$R + RESCUE_WAIT_GRACE )); } \` / `&& _rescue_history` → `elif _rescue_history` | ccd-rescue-policy | 2 failed of 94: ccd-rescue-policy: “a STALLED chain wait whose account reset ends turned and the tick rescues, with no second chain wait”; ccd-rescue-policy: “no chain wait opens on a five-hour reset whose grace has passed: the fourth rescue in the hour goes at once” |
| 2.9 | `ccd/ccd` | `=~ ^[a-z_]+$ ]] && _is_anthropic_backend "$wrapper"; then` / `if [[ "$state" == open ]]` → `=~ ^[a-z_]+$ ]]; then` / `if [[ "$state" == open ]]` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a Codex-lane session on its fourth rescue in the hour is rescued at once, and its exclusion is written” |
| 2.10 | `ccd/ccd` | `if [[ "$R" =~ ^[0-9]+$ && "${HARD_BLOCK_TYPE:-}" =~ ^[a-z_]+$ ]] && _is_anthropic_backend` → `if _is_anthropic_backend` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a 401 arriving during an open chain wait is rescued at once” |
| 2.11 | `ccd/ccd` | `[[ -n "$out" && "$rc" -eq 0 ]] && { printf` → `[[ -n "$out" ]] && { printf` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “spread never buys a class degrade: a first-pass rc 6 falls through to the just-left-only pass” |
| 2.12 | `ccd/ccd` | `if [[ -z "$4" \|\| -z "$out" ]] \|\|` → `if [[ -z "$4" ]] \|\|` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “nowhere to go is `_swap_target` byte for byte, and reads no swap log — a strand is asked every tick” |
| 2.13 | `ccd/ccd` | `[[ -n "${HARD_BLOCK_ROW:-}" ]] && printf ' row=%s' "$HARD_BLOCK_ROW"` → `(nothing)` | ccd-rescue-policy, measure-continuity-stage4 | 5 failed of 103: ccd-rescue-policy: “the auto-rescue line carries the dated row: reset=, type= and row=”; ccd-rescue-policy: “a row written days after its own reset logs no reset=, and the next rescue does not bounce back to that account”; ccd-rescue-policy: “a rescue of a landing that never came up names its carried row= and no reset= or type=”; … and 2 more |
| 2.14 | `ccd/ccd` | `[[ "$1" == 3 && "$3" =~ ^[0-9]+$ ]] && { HARD_BLOCK_ROW="$3"; return 0; }` → `(nothing)` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a rescue of a landing that never came up names its carried row= and no reset= or type=” |
| 2.15 | `ccd/ccd` | `")$(_rescue_line_extra)" >> "$REG/swap.log"` → `")" >> "$REG/swap.log"` | ccd-rescue-policy, measure-continuity-stage4 | 5 failed of 103: ccd-rescue-policy: “the auto-rescue line carries the dated row: reset=, type= and row=”; ccd-rescue-policy: “a row written days after its own reset logs no reset=, and the next rescue does not bounce back to that account”; ccd-rescue-policy: “a rescue of a landing that never came up names its carried row= and no reset= or type=”; … and 2 more |
| 2.16 | `ccd/ccd` | `{ grep -F ' auto-rescue ' \|\| (( $? == 1 )); }` → `grep -F ' auto-rescue '` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a tail with no rescue in it is a MEASURED empty history (rc 0); a log nobody can read is not (rc 2)” |
| 2.17 | `ccd/ccd` | `target=$(_rescue_target "$id" "$wrapper" "$home" "$hard_blocked" "$hrc"); strc=$?` → `target=$(_swap_target "$id" "$wrapper" "$home" "$hard_blocked" "$hrc"); strc=$?` | ccd-rescue-policy | 6 failed of 94: ccd-rescue-policy: “a target the session just left blocked is skipped”; ccd-rescue-policy: “a row written days after its own reset logs no reset=, and the next rescue does not bounce back to that account”; ccd-rescue-policy: “spread: a target another session was rescued onto minutes ago is passed over while another has room”; … and 3 more |
| 2.18 | `ccd/ccd` | `if [[ -z "$4" \|\| -z "$out" ]] \|\|` → `if [[ -z "$out" ]] \|\|` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “a NON-rescue tick is `_swap_target` byte for byte: no skip list reaches the affinity path” |
| 2.19 | `ccd/ccd` | `if age < spread and m.group(4) not in recent:` → `if m.group(4) not in recent:` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “control: a target rescued onto longer ago than RESCUE_SPREAD_WINDOW is not passed over” |
| 2.20 | `ccd/ccd` | `if m.group(2) == sid and age < chain:` → `if age < chain:` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “control: other sessions' rescues neither count toward this session's chain wait nor mark an account it left” |
| 2.21 | `ccd/ccd` | `if m.group(2) == sid and age < chain:` → `if m.group(2) == sid:` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “control: rescues older than RESCUE_CHAIN_WINDOW neither count toward the chain wait nor skip the account left” |
| 2.22 | `ccd/ccd` | `# …and ITS undecidable answer is never returned: the unskipped probe above` / `# already answered every question the skip cannot change (rc 2-4 are asked` / `# before the walk), so an rc 5 here means the skip removed every measured` / `# candidate and left only an unmeasured lane — the just-left-only pass decides.` → `(( rc >= 2 && rc <= 5 )) && return "$rc"` | ccd-rescue-policy | 2 failed of 94: ccd-rescue-policy: “spread never turns a rescue undecidable: a spread-pass rc 5 falls through to the just-left-only pass”; ccd-rescue-policy: “…end to end: the recent target is the only measured lane with room and another lane is unmeasured — rescued, not marked undecidable” |
| 2.23 | `ccd/ccd` | `; [[ -n "$3" ]] && recent="${recent// "$3" / }"` → `(nothing)` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “spread never passes over HOME: a recovered home another session was rescued onto minutes ago is still where the rescue goes” |
| 2.24 | `ccd/ccd` | `[[ "$kind" == chain && "$since" =~ ^[0-9]+$ && "$(_rw_field "$rec" wrapper)" == "$wrapper" ]] \` → `[[ "$kind" == chain && "$since" =~ ^[0-9]+$ ]] \` | ccd-rescue-policy | 1 failed of 94: ccd-rescue-policy: “an open chain wait taken on ANOTHER account does not hold this one” |

Regression controls no row reds, by design: "control: with no history the least-used lane takes the rescue", and
"an unreadable swap log is today's behaviour" — an unreadable log makes `_rescue_history` answer 2, and every caller
then does exactly what it does today. The three window controls are what rows 2.19–2.21 red: each is green until
its window (the spread window, this session only, the chain window) is widened. Row 2.22 restores the line an
earlier draft of this plan carried — the spread pass handing back its own rc 2–5 — and reds both rc-5 cases: the
prototype measured that line turning a rescue with a target into a loud undecidable strand (Review Focus 8).

```bash
git add ccd/ccd server/test/ccd-rescue-policy.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): spread rescues, do not bounce, chain-wait the fourth (continuity rule 3)

_rescue_history reads the tail of swap.log (RESCUE_LOG_TAIL_BYTES) for this
session's rescues in the last hour and every rescue target in the last ten
minutes — only when a decision needs it: the chain check of a dated block
with no wait open, and the target choice of a rescue with somewhere to go,
never the ticks a strand waits through. A rescue then skips every account the
session left blocked in that hour (until the logged reset passes), prefers a
target no rescue landed on in RESCUE_SPREAD_WINDOW when another has room
(never at the price of a class degrade or an undecidable tick: the spread
pass's name is taken only at rc 0, and every other answer falls through; and
never over the session's recovered home), and a fourth rescue within the hour,
on an Anthropic lane and a dated block not past its five-hour reset's grace,
chain-waits up to RESCUE_CHAIN_WAIT=1800 s (kind=chain, held only on the
account it was taken on), then swaps; with no room it becomes the no-room
wait, which a still-full hour does not turn back into a chain wait; a 401
arriving mid-wait is rescued at once. _swap_target
honours SWAP_TARGET_SKIP in its candidate walk AND its home-return branch;
_rescue_target applies it to rescues only. The auto-rescue line appends
reset= (only a reset the row predates), type= and row= (row= alone for a
carried row D-3526 kept a block).

S6-R11: line-neutral above README's anchors; no _reg_get call added.
MSG
)"
```

---

### Task 3: The stage-4 instrument, and README

**Model routing:** `sonnet`, effort `medium`.

**Files:**
- Create or extend: `deploy/measure-continuity.py`
- Create: `server/test/measure-continuity-stage4.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `swap.log` lines of Tasks 1–2 (`rescuewait`, `rescuewait-end`, the `auto-rescue` tokens), D-3526's
  `carried-in <id>: via=<v> …` line, and `cmd_swap`'s `swap <id>: <from> -> <to> (uuid …)` landing line.
- Produces: `python3 deploy/measure-continuity.py [--stage N]… [--home DIR] [--swap-log PATH] [--since T] [--until T]
  [--deployed T] [--all-copies] [--json]` — the programme's ONE CLI and ONE registry (`STAGES = {N: stageN}`,
  `stageN(ctx)` returning named sections, the report `{"stage<N>": {<section>: {…}}}`, `ctx` the dict of `home`,
  `swap_log`, `since`/`until`/`deployed` as epochs, `all_copies`). This wave owns stage 4, section `rescue`:
  `{rescues, sessions_with_4plus_rescues_in_an_hour, max_rescues_in_an_hour,
  chain_waits_ending_in_neither_swap_nor_reset, rescues_on_a_carried_in_banner, rescues_with_a_dated_row,
  near_reset_waits_ending_in_a_swap, rule1_suppressions_by_via, rule1_pane_suppressions_rescued_within_5min,
  waits_opened_by_kind, waits_ended_by_kind_and_end, noroom_waits_past_their_reset,
  noroom_waits_past_their_reset_by_end, noroom_seconds_past_their_reset_total,
  noroom_seconds_past_their_reset_max}`, or `{swap_log: "absent"}` — spec §9's stage-4 rows except "non-rescue swaps
  that cut delegated work" (wave 7's). The four `noroom_…` rows are §11 item 6's count (ruled 2026-09-24, "leave it
  and count it"; the question returns to the operator with it — CCR-20); a wait ended `turned` or `stale` is never
  in it.

**Whichever continuity wave lands first writes the file — and the file is the same either way** (the programme
ledger's one-shape rule, measured: Pre-flight finding 13). This wave's file is wave 1's own shell, byte for byte —
the docstring, the imports, `TS`, `epoch`, `read_lines`, `when`, `main` — around this wave's `# ── stage 4 (wave 2)`
block, with `STAGES = {4: stage4}`. So:
- **If `deploy/measure-continuity.py` does NOT exist** when this task starts, create it exactly as Step 3 gives it.
- **If it DOES exist because wave 1 merged first**, keep every byte of it and add only this plan's block — from the
  line `# ── stage 4 (wave 2): the rescue policy …` through the end of `def stage4` — directly above
  `STAGES = {1: stage1}`, with two blank lines on each side as the file's other blocks have, and rewrite that line to
  `STAGES = {1: stage1, 4: stage4}`. Wave 1's plan, in the other order, inserts its stage-1 block above this one and
  writes the same `STAGES` line; either order leaves one file (476 lines at planning). Then run wave 1's
  `test/measure-continuity.test.ts` as well as this task's: both must pass unchanged. Should that file's CLI or `ctx`
  depart from the contract above, stop and report rather than adapt either side.

The stage-4 block is self-contained: it reads `ctx` as the contract's dict and uses no helper outside itself, so it
drops in unchanged whichever wave wrote the rest.

- [ ] **Step 1: Write the failing test**

Create `server/test/measure-continuity-stage4.test.ts`:

<!-- replay: create server/test/measure-continuity-stage4.test.ts -->
```ts
// `deploy/measure-continuity.py`'s stage-4 rows (session-continuity spec §9;
// wave 2). The instrument is READ-ONLY and stage 4 reads swap.log (and, for a
// no-room wait still open now, that session's `.rescuewait` record), so two
// things are pinned: each row counts what its name says on a hand-built log
// whose answer is known, and each regex it parses is bound to a line the REAL
// ccd function wrote — a reworded ccd line reds here, not silently on the
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
const carriedIn = (at: string, sid: string, via: string): string =>
  `2026-09-20 ${at} carried-in ${sid}: via=${via} rate-limit row at 1 predates this pane's process (born 2) — not a block [wrapper=claude] [spawn=0]`;

describe('stage 4 rows count what their names say (TZ=UTC, hand-built log)', () => {
  const lines = [
    // s1 landed at 10:00; its 10:30 rescue fired on a row from 09:50 (carried in), its 10:40 one on a row from 10:35.
    '2026-09-20 09:00:00 swap s1: claude-d -> claude (uuid u0)',   // an EARLIER landing: the rule compares with the newest
    '2026-09-20 10:00:00 swap s1: claude -> claude-a (uuid u1)',
    `2026-09-20 10:30:00 auto-rescue s1: claude-a (blocked) -> claude-b [home=claude] via=transcript reset=${utc('2026-09-20 12:00:00')} type=five_hour row=${utc('2026-09-20 09:50:00')}`,
    `2026-09-20 10:40:00 auto-rescue s1: claude-b (blocked) -> claude-d [home=claude] via=banner row=${utc('2026-09-20 10:35:00')}`,
    // s2: four rescues inside one hour, no dated row.
    ...['10:00', '10:15', '10:30', '10:59'].map((m) => `2026-09-20 ${m}:00 auto-rescue s2: claude (blocked) -> claude-a [home=claude]`),
    // rule 1 (D-3526): pane suppressions that became a rescue within 5 minutes — s3 (pane, 3 min) and
    // s17 (banner, 4 min) — one that took 8 (s19, pane), and transcript ones, which §9's row does not
    // name: s4 (10 min) and s16 (2 min).
    carriedIn('11:00:00', 's3', 'pane'),
    '2026-09-20 11:03:00 auto-rescue s3: claude (blocked) -> claude-a [home=claude]',
    carriedIn('11:00:00', 's4', 'transcript'),
    '2026-09-20 11:10:00 auto-rescue s4: claude (blocked) -> claude-a [home=claude]',
    carriedIn('11:20:00', 's16', 'transcript'),
    '2026-09-20 11:22:00 auto-rescue s16: claude (blocked) -> claude-a [home=claude] via=transcript',
    carriedIn('11:30:00', 's17', 'banner'),
    '2026-09-20 11:34:00 auto-rescue s17: claude (blocked) -> claude-a [home=claude] via=banner',
    carriedIn('11:40:00', 's19', 'pane'),
    '2026-09-20 11:48:00 auto-rescue s19: claude (blocked) -> claude-a [home=claude]',
    // waits: a near wait ending in a swap; four chain waits, ending clear BEFORE its reset (neither),
    // turned (a reset), noroom (neither), and near (handed to rule 2's wait on its own reset).
    '2026-09-20 12:00:00 rescuewait s5: kind=near on claude reset=1',
    '2026-09-20 12:05:00 rescuewait-end s5: kind=near on claude reset=1 after 300s end=swap',
    `2026-09-20 12:10:00 rescuewait-end s6: kind=chain on claude reset=${utc('2026-09-20 13:00:00')} after 60s end=clear`,
    '2026-09-20 12:10:00 rescuewait-end s7: kind=chain on claude reset=1 after 60s end=turned',
    '2026-09-20 12:10:00 rescuewait-end s8: kind=chain on claude reset=- after 1800s end=noroom',
    `2026-09-20 12:10:00 rescuewait-end s18: kind=chain on claude reset=${utc('2026-09-20 12:15:00')} after 60s end=near`,
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
      'state=closed kind=near since=1 reset=- wrapper=claude until=2 end=swap\n');
    const r = run(h.home, ['--swap-log', handLog()], { TZ: 'UTC' });
    expect(r.rescues).toBe(11);
    expect(r.sessions_with_4plus_rescues_in_an_hour).toBe(1);
    expect(r.max_rescues_in_an_hour).toBe(4);
    expect(r.rescues_with_a_dated_row).toBe(2);
    expect(r.rescues_on_a_carried_in_banner).toBe(1);
    expect(r.rule1_suppressions_by_via).toEqual({ banner: 1, pane: 2, transcript: 2 });
    expect(r.rule1_pane_suppressions_rescued_within_5min, 's3 and s17; not s19 (8 min), and never s16, a transcript suppression').toBe(2);
    expect(r.near_reset_waits_ending_in_a_swap).toBe(1);
    expect(r.chain_waits_ending_in_neither_swap_nor_reset, 's6 (clear before its reset) and s8 (no room)').toBe(2);
    expect(r.waits_opened_by_kind).toEqual({ near: 1, noroom: 5 });
    expect(r.waits_ended_by_kind_and_end).toEqual({
      'chain:clear': 1, 'chain:near': 1, 'chain:noroom': 1, 'chain:turned': 1, 'near:swap': 1, 'noroom:swap': 3, 'noroom:turned': 1,
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
    expect(r.rule1_suppressions_by_via).toEqual({ pane: 1, transcript: 1 });
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
  const seedSession = (at: number, row: Record<string, unknown>): void => {
    h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} home claude; _reg_set ${ID} project demo
          _reg_set ${ID} workdir "$HOME/projects/demo"; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`);
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const p = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      type: 'assistant', uuid: 'b', timestamp: new Date(at * 1000).toISOString(),
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'limit' }] },
      isApiErrorMessage: true, error: 'rate_limit', ...row,
    }) + '\n');
  };
  /** The pane's process was born a day ago; `target` is what `_swap_target` answers. */
  const stubs = (pane: string, target: string): string => `tmux() { ${WIDE_PANE} case "\${1:-}" in
      capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; display-message) echo "\${TMUX_CREATED}" ;; esac; return 0; };
    _pane_box_draft() { printf ''; }; _swap_target() { [[ -n "${target}" ]] && echo "${target}"; return 0; }; _dispatch_swap() { :; };`;
  const env = (t: number): Record<string, string> => ({ TMUX_CREATED: String(t - 86400) });

  it('auto-rescue (with its dated tokens), rescuewait, rescuewait-end and carried-in all parse', () => {
    const t = Math.floor(Date.now() / 1000);
    seedSession(t - 5, { quotaLimits: { status: 'rejected', resetsAt: t + 9000, rateLimitType: 'five_hour' } });
    h.sh(`${stubs('❯ ', 'claude-a')} HARD_BLOCK_TYPE=five_hour; HARD_BLOCK_RESET=${t + 300}; _rescuewait_open ${ID} claude near`, env(t));
    h.sh(`${stubs('❯ ', 'claude-a')} _auto_swap_check ${ID}`, env(t));   // closes the near wait as a swap, and logs the rescue
    h.sh(`_carried_in_note ${ID} pane ${t - 100} ${t}`);
    const r = run(h.home);                                                // the DEFAULT log: <home>/.cc-sessions/swap.log
    expect(r.rescues).toBe(1);
    expect(r.rescues_with_a_dated_row).toBe(1);
    expect(r.waits_opened_by_kind).toEqual({ near: 1 });
    expect(r.waits_ended_by_kind_and_end).toEqual({ 'near:swap': 1 });
    expect(r.near_reset_waits_ending_in_a_swap).toBe(1);
    expect(r.rule1_suppressions_by_via).toEqual({ pane: 1 });
  });

  it('a stranded session\'s no-room wait is counted past its reset; one whose row was written after its own reset adds nothing', () => {
    const t = Math.floor(Date.now() / 1000);
    // The row predates a reset 200 s ago: the no-room wait the strand opens is keyed on it.
    seedSession(t - 5000, { quotaLimits: { status: 'rejected', resetsAt: t - 200, rateLimitType: 'five_hour' } });
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, env(t));
    expect(run(h.home).noroom_waits_past_their_reset).toBe(1);
    // A row written hours after its own reset: that reset never turned the account, so it keys nothing.
    fs.rmSync(path.join(h.home, '.cc-sessions', 'swap.log'));
    h.sh(`_reg_purge ${ID}`);
    seedSession(t - 5, { quotaLimits: { status: 'rejected', resetsAt: t - 36857, rateLimitType: 'five_hour' } });
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, env(t));
    const r = run(h.home);
    expect(r.waits_opened_by_kind).toEqual({});
    expect(r.noroom_waits_past_their_reset).toBe(0);
  });

  // S2 at the reset: the armed retry met a 429 with the SAME stale resetsAt, so
  // the newest row postdates the reset the no-room wait keyed on. ccd ends the
  // wait `stale`, and §11 item 6's count leaves it out.
  it('a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and is not counted past its reset', () => {
    const t = Math.floor(Date.now() / 1000); const R = t - 300;
    seedSession(t - 2000, { quotaLimits: { status: 'rejected', resetsAt: R, rateLimitType: 'five_hour' } });
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, env(t));
    expect(run(h.home).waits_opened_by_kind).toEqual({ noroom: 1 });
    fs.appendFileSync(h.sh(`_transcript_path ${ID}`), JSON.stringify({
      type: 'assistant', uuid: 'c', timestamp: new Date((R + 2) * 1000).toISOString(),
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'limit' }] },
      isApiErrorMessage: true, error: 'rate_limit', quotaLimits: { status: 'rejected', resetsAt: R, rateLimitType: 'five_hour' },
    }) + '\n');
    h.sh(`${stubs("You've hit your session limit · resets 9:10pm (UTC)\n❯ ", '')} _auto_swap_check ${ID}`, env(t));
    const r = run(h.home);
    expect(r.waits_ended_by_kind_and_end).toEqual({ 'noroom:stale': 1 });
    expect(r.noroom_waits_past_their_reset).toBe(0);
  });

  it('a rescue on a carried-in banner is counted against the landing line the real cmd_swap wrote', () => {
    const t = Math.floor(Date.now() / 1000); const born = t - 990;
    seedSession(t - 3000, { quotaLimits: { status: 'rejected', resetsAt: t + 300, rateLimitType: 'five_hour' } });
    const SWAP = 'systemctl() { :; }; launchctl() { :; }; tmux() { :; }; sleep() { :; };';
    h.sh(`${SWAP} cmd_swap ${ID} claude-a`, { TMUX: '' });                  // the real landing line
    expect(h.reg(ID, 'wrapper')).toBe('claude-a');
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 4"`);   // a landing that never came up (D-3526)
    h.sh(`${stubs('Usage limit reached · continuing automatically at 9:10pm · esc to cancel\n❯ ', 'claude-b')} _auto_swap_check ${ID}`,
      { TMUX_CREATED: String(born) });
    const r = run(h.home);
    expect(r.rescues).toBe(1);
    expect(r.rescues_on_a_carried_in_banner).toBe(1);
  });

  it('the landing line the carried-in row compares against is cmd_swap\'s own', () => {
    expect(fs.readFileSync(CCD, 'utf8')).toContain(`echo "$(date '+%F %T') swap $id: $cur -> $target (uuid $uuid)" >> "$REG/swap.log"`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `(cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage4.test.ts)`

Expected: FAIL. If the file does not exist yet: every case but the landing-line source pin red on
`python3: can't open file …/deploy/measure-continuity.py` (`8 failed | 1 passed (9)`, measured); the pin passes
because that line predates this wave. If wave 1 created the file first, the same eight red instead on its argparse
refusing `--stage 4` (`argument --stage: invalid choice: 4`, exit 2) — not ENOENT.

- [ ] **Step 3: Write the instrument**

Create `deploy/measure-continuity.py` (mode 0755) — or, if it exists, add to it as the paragraph above Step 1 says:

<!-- replay: create deploy/measure-continuity.py -->
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


# ── stage 4 (wave 2): the rescue policy ─────────────────────────────────────
# §9's stage-4 rows but "non-rescue swaps that cut delegated work" (wave 7's),
# read off swap.log; the no-room rows also read a session's `.rescuewait`
# record, read-only, to tell a wait open NOW from one a purge cut short. The
# line shapes are ccd's own, and `server/test/measure-continuity-stage4.test.ts`
# binds each regex below to a line the real ccd function wrote. Self-contained:
# it reads `ctx` as the contract's dict and uses no helper outside this block,
# so it drops in unchanged whichever wave wrote the rest of the file.
S4_TS = r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)"
S4_RESCUE = re.compile(S4_TS + r" auto-rescue (\S+): (\S+) \(blocked\) -> (\S+) \[home=[^\]]*\](.*)$")
S4_LANDING = re.compile(S4_TS + r" swap (\S+): (\S+) -> (\S+) \(uuid ")
S4_CARRIED = re.compile(S4_TS + r" carried-in (\S+): via=(\S+) ")
S4_WAIT_OPEN = re.compile(S4_TS + r" rescuewait (\S+): kind=(\S+) on (\S+) reset=(\S+)$")
S4_WAIT_END = re.compile(S4_TS + r" rescuewait-end (\S+): kind=(\S+) on (\S+) reset=(\S+) after (\d+)s end=(\S+)$")
S4_TOKEN = re.compile(r" (reset|type|row)=(\d+|[a-z_]+)")
# ccd's RESCUE_WAIT_GRACE; the stage-4 test binds the two numbers together.
S4_GRACE = 120


def s4_epoch(stamp):
    """swap.log's LOCAL-time stamp -> epoch seconds (time.mktime), or None."""
    try:
        return int(time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))
    except (ValueError, OverflowError):
        return None


def stage4(ctx):
    since, until = ctx["since"], ctx["until"]
    path = ctx["swap_log"] or os.path.join(ctx["home"], ".cc-sessions", "swap.log")
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
    # there (`turned`). Counted: a no-room wait with a numeric reset — ccd records
    # one only for a five-hour row written before it, and ends it `stale` when a
    # newer row proves that reset did not turn the account — not ended `turned`
    # or `stale`, whose end (its end line in the window) or, still open, the
    # window's end (`--until`, else now) is more than S4_GRACE past its reset;
    # seconds run from the reset. `pending` pairs
    # each session's entry line with its exit line — the record holds one wait at
    # a time, so they alternate. A purge removes the record and writes no exit
    # line, so a wait measured NOW is open only while
    # `<home>/.cc-sessions/<id>.rescuewait` still says `state=open` (a later
    # session of the same id may have re-used a closed one); a past window
    # (`--until`) has only the log, and a session purged mid-wait there counts to
    # the window's end. Named cost: a no-room wait whose block turned into lost
    # auth mid-strand still counts past its reset — the log does not say the
    # verdict changed while the strand stood.
    now = int(time.time())
    ref = until if until is not None else now
    upto = lambda t: t is not None and (t < until if until is not None else t <= now)   # the window's end, or now
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
            if upto(t):
                pending[m.group(2)] = (m.group(3), m.group(5))
            continue
        m = S4_WAIT_END.match(line)
        if m:
            t = s4_epoch(m.group(1))
            if upto(t):
                pending.pop(m.group(2), None)
            if not inwin(t):
                continue
            kind, reset, end = m.group(3), m.group(5), m.group(7)
            ended[f"{kind}:{end}"] += 1
            if kind == "noroom" and end not in ("turned", "stale") and reset.isdigit() and t > int(reset) + S4_GRACE:
                past.append((end, t - int(reset)))
            # A chain wait reaches its reset when it ends there (`turned`), when
            # Claude Code continued at or after it (`clear`), or when it became the
            # near wait on that same reset (`near`, ended by rule 2 at the reset).
            at_reset = end in ("turned", "near") or (end == "clear" and reset.isdigit() and t >= int(reset))
            if kind == "chain" and end != "swap" and not at_reset:
                chain_neither += 1
            if kind == "near" and end == "swap":
                near_swap += 1

    for sid, (kind, reset) in pending.items():
        if kind != "noroom" or not reset.isdigit() or ref <= int(reset) + S4_GRACE:
            continue
        if until is None:
            try:
                with open(os.path.join(ctx["home"], ".cc-sessions", sid + ".rescuewait")) as fh:
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
    # A rescue on a carried-in banner: its `row=` is older than the landing the
    # LOG records for that session (the newest `swap <id>:` line before the
    # rescue) — measured from the log, not from the clock that decided. Since
    # D-3526 the one sanctioned case is a landing whose Claude Code never came up.
    dated, on_carried = 0, 0
    for t, sid, tok in rescues:
        if "row" not in tok:
            continue
        dated += 1
        before = [u for u in landings.get(sid, []) if u <= t]
        if before and int(tok["row"]) < max(before) - 1:
            on_carried += 1
    # §9: pane positives D-3526 suppressed that became a rescue of the same
    # session within 5 minutes (a real block read as carried in while the
    # transcript lagged the pane). The transcript rung's suppressions are
    # counted by `via` beside it.
    pane_became = sum(1 for t, sid, via in carried if via in ("pane", "banner")
                      and any(r[1] == sid and 0 <= r[0] - t <= 300 for r in rescues))

    return {"rescue": {
        "rescues": len(rescues),
        "sessions_with_4plus_rescues_in_an_hour": four_plus,
        "max_rescues_in_an_hour": worst,
        "chain_waits_ending_in_neither_swap_nor_reset": chain_neither,
        "rescues_on_a_carried_in_banner": on_carried,
        "rescues_with_a_dated_row": dated,
        "near_reset_waits_ending_in_a_swap": near_swap,
        "rule1_suppressions_by_via": dict(sorted(collections.Counter(v for _, _, v in carried).items())),
        "rule1_pane_suppressions_rescued_within_5min": pane_became,
        "waits_opened_by_kind": dict(sorted(opened.items())),
        "waits_ended_by_kind_and_end": dict(sorted(ended.items())),
        "noroom_waits_past_their_reset": len(past),
        "noroom_waits_past_their_reset_by_end": dict(sorted(past_by_end.items())),
        "noroom_seconds_past_their_reset_total": sum(s for _, s in past),
        "noroom_seconds_past_their_reset_max": max((s for _, s in past), default=0),
    }}


STAGES = {4: stage4}


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

<!-- replay: bash -->
```bash
chmod 0755 deploy/measure-continuity.py
```

- [ ] **Step 4: Run the test and the live baseline (read-only)**

```bash
(cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage4.test.ts)
python3 deploy/measure-continuity.py --stage 4 --since 2026-09-08 --until 2026-09-24
```

The test runs in a subshell, so the baseline command runs from the repo root whether the test passed or not.
Expected: `9 passed`. On the fleet box the baseline prints (measured 2026-09-30, Pre-flight finding 11)
`rescues: 248`, `sessions_with_4plus_rescues_in_an_hour: 4`, `max_rescues_in_an_hour: 4`, and 0 (or `{}`) for every
row this wave's words feed, the four `noroom_…` rows included. The tool opens `swap.log` read-only and writes
nothing; if you are not on the fleet box, skip the second command and say so in the wave-done.

- [ ] **Step 5: README**

(a) In "A restart re-drives the turn it interrupted", the rescue arm is no longer ungated near a reset:

<!-- replay: replace README.md -->
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

(b) Directly above the heading `` ### One memory store per project: `ccrc memory` ``, the new subsection (it follows
D-3526's bullet, which already describes rule 1):

<!-- replay: insert-above README.md -->
```markdown
### One memory store per project: `ccrc memory`
```

insert, directly above that line,

```markdown
### The rescue waits near a reset, and spreads (session-continuity stage 4)

Rules 2–3 of `docs/superpowers/specs/2026-09-23-session-continuity-design.md` §5.4; rule 1 is the carried-in
banner above (D-3526). Before them no rescue read the reset its transcript row already carried, and four sessions
were rescued four times inside an hour (2026-09-08..09-23).

- **The dated row.** The verdict keeps a rate-limit row's `resetsAt`, `rateLimitType` and own epoch only when the
  dated read — `_transcript_limit_banner`'s `dated` mode, `stuck` mode plus the row's epoch — answered rc 0 on a
  row this pane's process wrote. `$REG/<id>.tdate` caches that row beside the answer, so the pane rungs, and the
  transcript rung on a tick its `tscan` cache answers, read it with no second pass. Four inputs date nothing and
  so take no wait of any kind: lost auth (an auth-failure pane, or a 401 newer than the rate-limit row, whoever
  wrote it); a pane whose process tmux cannot place; a carried-in row, even one D-3526 keeps a block; and — for
  its reset — a row written at or after its own `resetsAt`, which proves that reset did not turn the account.
- **Near a five-hour reset the rescue waits.** A `five_hour` block on an Anthropic lane whose kept reset is within
  `RESCUE_WAIT_BOUND=600` seconds, with Claude Code's auto-continue armed on the pane, leaves that auto-continue
  alone and types nothing. Armed means Claude Code's own footer — below the prompt box, on its `·`-separated
  line — never a draft in the box or a line of prose that says the words, because a false "armed" parks a stalled
  session. The wait ends at the reset (Claude Code's own timer, or the stale-phase Enter), or
  `RESCUE_WAIT_GRACE=120` seconds after it: in a swap if a newer rate-limit row exists; otherwise, while the pane
  is still armed, in place, and never in a swap away from an account that has just reset — for a wait that was
  open before that grace ran out; one first taken after it never saw the account turn and is rescued as today.
  That hold in place lasts until `RESCUE_CHAIN_WAIT=1800` seconds past the reset: an armed footer that far past
  it, with the 429 still the newest row, says Claude Code is not continuing, and the session is rescued as today.
  `0` turns the near wait off; a wait of another kind still ends in place at its reset. A stalled session
  (nothing armed), a `seven_day` or Codex-lane block, or a row with no kept reset swaps as before; `~/.cc-limits`
  is not a fallback, because it cannot say which window blocked.
- **No room is a wait too.** Today's `stranded` path also records `kind=noroom` when its block is dated; every
  line it logged before is unchanged. It ends in a swap the moment a target gains room — for a stalled pane
  inside the grace after its reset too. At its reset an armed session ends it in place, held there up to that
  same bound; a stalled one stays in it and swaps once a target has room, whose `--resume` spawn re-drives the
  turn. When its own account is the only one with room it idles there as before; `--stage 4` counts those waits
  and the seconds each spent past its reset (spec §11 item 6). A rate-limit row written at or after that reset
  proves it did not turn the account: the wait ends `stale` (the strand stands, as before), and the count leaves
  it out.
- **Spread, do not bounce, chain-wait.** A rescue skips every account this session left blocked in the last hour
  (until that rescue's logged `reset=` passes), and prefers a target no rescue landed on in the last
  `RESCUE_SPREAD_WINDOW=600` seconds when another has room — never at the price of a class degrade, never by
  turning a rescue with a target into an undecidable one, and never by passing over the session's own recovered
  home (the affinity path would only move it back). A fourth rescue within the hour on an Anthropic lane, on a
  dated block not already past its five-hour reset's grace, first waits up to `RESCUE_CHAIN_WAIT=1800`
  seconds (`kind=chain`), then swaps; with no room it becomes the no-room wait; at its account's reset it ends in
  place if armed and is rescued if stalled. A Codex-lane session is never chain-waited, so the lane's "pool is
  full" signal is written at once. Rule 3 reads the tail of `swap.log` (`RESCUE_LOG_TAIL_BYTES`) only when a
  decision needs it — not on the ticks a strand waits through.
- **Where to look.** `$REG/<id>.rescuewait` holds the one current or last wait (`state= kind= since= reset=
  wrapper=`, plus `until= end=` once it ends) and purges with the row. `swap.log` says `rescuewait <id>: …` once
  on entry and `rescuewait-end <id>: … end=<word>` once on exit — never the word `hold`, which is the
  workspace-reap hold. The `auto-rescue` line appends ` reset= type= row=` when the verdict kept them (`row=`
  alone for a carried row D-3526 kept a block). `python3 deploy/measure-continuity.py --stage 4` reads it all
  back, read-only.

```

No `file:line` token appears in the new text (session-hook's README audit reads every one); the corpus census stays
`147 / 195 / 58 / 38` (measured).

- [ ] **Step 6: Mutation check, then commit**

Measured on the full prototype (row 3.7 edits `ccd/ccd`; restore it from its saved copy, no re-stamp needed for the
row).

| # | File | Exact edit (old → new) | Suites | Measured red on the full prototype |
|---|---|---|---|---|
| 3.1 | `deploy/measure-continuity.py` | `if before and int(tok["row"]) < max(before) - 1:` → `if before:` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.2 | `deploy/measure-continuity.py` | `r[1] == sid and 0 <= r[0] - t <= 300` → `r[1] == sid and 0 <= r[0] - t <= 900` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.3 | `deploy/measure-continuity.py` | `via in ("pane", "banner")` → `via in ("pane", "banner", "transcript")` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.4 | `deploy/measure-continuity.py` | `at_reset = end in ("turned", "near") or` → `at_reset = end == "turned" or` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.5 | `deploy/measure-continuity.py` | `if kind == "chain" and end != "swap" and not at_reset:` → `if kind == "chain" and end != "swap":` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.6 | `deploy/measure-continuity.py` | `four_plus += best >= 4` → `four_plus += best >= 5` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.7 | `ccd/ccd` | `after $((now - 10#$since))s end=$end"` → `ending=$end"` | measure-continuity-stage4 | 2 failed of 9: measure-continuity-stage4: “auto-rescue (with its dated tokens), rescuewait, rescuewait-end and carried-in all parse”; measure-continuity-stage4: “a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and is not counted past its reset” |
| 3.8 | `deploy/measure-continuity.py` | `(until is None or t < until)` → `(until is None or t <= until)` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “--since is inclusive and --until exclusive, as local-time epochs, in either spelling” |
| 3.9 | `deploy/measure-continuity.py` | `"swap_log": a.swap_log or os.path.join(a.home, ".cc-sessions", "swap.log"),` → `"swap_log": os.path.join(a.home, ".cc-sessions", "swap.log"),` | measure-continuity-stage4 | 4 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known”; measure-continuity-stage4: “no-room waits past their reset: counted to their end or the window's, from the reset, beyond the grace”; measure-continuity-stage4: “--since is inclusive and --until exclusive, as local-time epochs, in either spelling”; … and 1 more |
| 3.10 | `deploy/measure-continuity.py` | `if kind == "noroom" and end not in ("turned", "stale") and reset.isdigit() and t > int(reset) + S4_GRACE:` → `if kind == "noroom" and reset.isdigit() and t > int(reset) + S4_GRACE:` | measure-continuity-stage4 | 2 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known”; measure-continuity-stage4: “a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and is not counted past its reset” |
| 3.11 | `deploy/measure-continuity.py` | `S4_GRACE = 120` → `S4_GRACE = 0` | measure-continuity-stage4 | 2 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known”; measure-continuity-stage4: “no-room waits past their reset: counted to their end or the window's, from the reset, beyond the grace” |
| 3.12 | `deploy/measure-continuity.py` | `ref = until if until is not None else now` → `ref = now` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “no-room waits past their reset: counted to their end or the window's, from the reset, beyond the grace” |
| 3.13 | `deploy/measure-continuity.py` | `past.append(("open", ref - int(reset)))` → `pass` | measure-continuity-stage4 | 3 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known”; measure-continuity-stage4: “no-room waits past their reset: counted to their end or the window's, from the reset, beyond the grace”; measure-continuity-stage4: “a stranded session's no-room wait is counted past its reset; one whose row was written after its own reset adds nothing” |
| 3.14 | `deploy/measure-continuity.py` | `pending.pop(m.group(2), None)` → `pass` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “no-room waits past their reset: counted to their end or the window's, from the reset, beyond the grace” |
| 3.15 | `deploy/measure-continuity.py` | `if until is None:` / `try:` → `if False:` / `try:` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.16 | `deploy/measure-continuity.py` | `if "state=open" not in rec:` / `continue` → `pass` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.17 | `deploy/measure-continuity.py` | `(t < until if until is not None else t <= now)` → `(t < until if until is not None else t < now)` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “a stranded session's no-room wait is counted past its reset; one whose row was written after its own reset adds nothing” |
| 3.18 | `deploy/measure-continuity.py` | `if before and int(tok["row"]) < max(before) - 1:` → `if before and int(tok["row"]) < min(before) - 1:` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known” |
| 3.19 | `deploy/measure-continuity.py` | `S4_LANDING = re.compile(S4_TS + r" swap (\S+): (\S+) -> (\S+) \(uuid ")` → `S4_LANDING = re.compile(S4_TS + r" swap (\S+): (\S+) -> (\S+) \(uuid \S+\) ")` | measure-continuity-stage4 | 2 failed of 9: measure-continuity-stage4: “every row on a log whose answer is known”; measure-continuity-stage4: “a rescue on a carried-in banner is counted against the landing line the real cmd_swap wrote” |
| 3.20 | `deploy/measure-continuity.py` | `end not in ("turned", "stale") and` → `end != "turned" and` | measure-continuity-stage4 | 1 failed of 9: measure-continuity-stage4: “a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and is not counted past its reset” |

"The landing line the carried-in row compares against is cmd_swap's own" is a source pin with no row of its own: it
reds the moment `cmd_swap`'s landing line is reworded. "A rescue on a carried-in banner is counted against the
landing line the real cmd_swap wrote" binds `S4_LANDING` to that line as written (row 3.19), and the hand-built log's
EARLIER landing for s1 is what row 3.18 (the newest landing, not the oldest) needs. Row 3.20 is §11 item 6's `stale`
exclusion: the no-room wait ccd ends `stale` (row 1.56) would otherwise be counted past a reset that never turned.

```bash
git add deploy/measure-continuity.py server/test/measure-continuity-stage4.test.ts README.md
git commit -m "$(cat <<'MSG'
feat(deploy): measure-continuity's stage-4 rows; README describes rules 2-3

deploy/measure-continuity.py --stage 4 reads swap.log read-only: sessions with
4+ rescues in an hour, rescues on a carried-in banner (row= against the
landing the log itself records), pane positives D-3526 suppressed that became
a rescue within 5 minutes, chain waits ending in neither a swap nor a reset,
near waits ending in a swap, every wait by kind and end, and (spec §11 item 6)
the no-room waits a stalled session outlived its own reset in, with the
seconds past it. Each regex is bound to the line the real ccd writes, and the
grace to ccd's constant. The file is wave 1's shell byte for byte around the
stage-4 block, so either landing order leaves the same file. Baseline on the
live log 2026-09-08..09-23: 248 rescues, 4 sessions with 4 in an hour.
README: the rescue arm's new exception, and a section for rules 2-3.
MSG
)"
```

---

### Task 4: Whole-branch verification, the PR — and the AGENT-FIRST deploy

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, unless `main` moved — then only the merge's own resolution (the stamp, the census, and
wave 1's instrument with this wave's stage-4 block) and any re-measured literal the S6-R11 procedure writes.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: the wave-2 PR on this workspace's own branch and a wave-done report. Wave 7 consumes `_rescue_policy`'s
  place in `_auto_swap_check` (its refusal sits on the non-rescue path below it); §9's stage-4 rows are read by
  `measure-continuity.py --stage 4` from the first deploy on.

- [ ] **Step 1: Merge current `main`, and re-measure on the merged tree**

The merge comes FIRST so the final gate (Step 2) runs on the tree that ships. It is ONE gated block — never Task 1
Step 0's, never a flat run of commands — that resolves, by script, exactly the three conflicts another wave can leave
and nothing else: the line-2 provenance stamp; the `_reg_get` census's comment lines, when a wave that re-measured
the census (this programme's wave 3 or 4, a child-reclamation or landing-order wave) landed after Task 1 committed —
MAIN's side, which `reg-get-census.py` then re-derives as main's stated pair + 3; and
`deploy/measure-continuity.py`'s add/add conflict, when wave 1 landed while this wave ran — MAIN's file byte for byte
plus this wave's stage-4 block above `STAGES = {1: stage1}` (Task 3's "if it exists" rule, the one-shape rule). It
commits only when every script succeeded, `bash -n` passed and no conflict marker is left in either file; on anything
else it commits nothing and aborts the merge. Write the two resolvers into your scratchpad first — the census script
is Task 1 Step 6's `$SCRATCH/reg-get-census.py` (save it again from there if this session's scratchpad lacks it).
`$SCRATCH/resolve-census-merge.py`:

```python
import sys
# After `git merge origin/main` stopped with ccd/ccd as its ONLY conflicted file: resolve the line-2 stamp
# hunk (either side — the re-stamp rewrites it) and the `_reg_get` census hunks — comment lines only, within
# eight lines of an `invocations across` line — (MAIN's side, which `reg-get-census.py` then re-derives:
# main's stated pair + this wave's three reads), and STOP, writing nothing, on any other hunk.
# Reads git's default, zdiff3 and diff3 conflict styles alike.
L = open('ccd/ccd', encoding='utf8').read().split('\n')
census = [k for k, l in enumerate(L) if 'invocations across' in l]   # the block's anchor, in either side
out, i, n = [], 0, 0
while i < len(L):
    if not L[i].startswith('<<<<<<< '):
        out.append(L[i]); i += 1; continue
    j, ours, theirs = i + 1, [], []
    cur = ours
    while not L[j].startswith('>>>>>>> '):
        if L[j].startswith('||||||| '): cur = []          # diff3's base section: dropped
        elif L[j] == '=======': cur = theirs
        else: cur.append(L[j])
        j += 1
    if i == 1 and len(ours) == len(theirs) == 1 and all(s.startswith('# ccrc:generated ') for s in ours + theirs):
        out += ours
    elif all(s.startswith('#') for s in ours + theirs) and any(abs(i - z) <= 8 for z in census):
        out += theirs
    else:
        sys.exit(f'STOP: a conflict at ccd/ccd:{i + 1} that is neither the stamp nor the census block')
    n += 1; i = j + 1
open('ccd/ccd', 'w', encoding='utf8').write('\n'.join(out))
print(f'resolved {n} hunk(s): the stamp and the census block, main\'s side')
```

`$SCRATCH/resolve-instrument-merge.py`:

```python
import subprocess, sys
# deploy/measure-continuity.py after `git merge origin/main` stopped on an add/add conflict because wave 1 created
# the file on main too: take MAIN's file byte for byte and add only this wave's stage-4 block above
# `STAGES = {1: stage1}` (Task 3's "if it exists" rule). Writes nothing on STOP.
P = 'deploy/measure-continuity.py'
def show(ref): return subprocess.run(['git', 'show', f'{ref}:{P}'], capture_output=True, text=True, check=True).stdout
theirs, ours = show('MERGE_HEAD'), show('HEAD')
if ours.count('\n\n\nSTAGES = {4: stage4}\n') != 1 or theirs.count('\nSTAGES = {1: stage1}\n') != 1 or 'stage4' in theirs:
    sys.exit('STOP: the two files are not wave 1\'s {1: stage1} and this wave\'s {4: stage4}')
s4 = ours[ours.index('# ── stage 4 (wave 2)'):ours.index('\n\n\nSTAGES = {4: stage4}') + 1]
out = theirs.replace('\nSTAGES = {1: stage1}\n', '\n' + s4 + '\n\nSTAGES = {1: stage1, 4: stage4}\n')
open(P, 'w', encoding='utf8').write(out)
print(f'{P}: main\'s file + the stage-4 block, {len(out.splitlines())} lines')
```

Then, from the repo root, run the block whole:

```bash
SCRATCH=<your scratchpad, absolute>
if ! git fetch origin main; then
  echo 'STOP: the fetch failed — nothing merged; report it'
elif ! git -c merge.conflictStyle=merge merge --no-edit origin/main; then
  U=$(git diff --name-only --diff-filter=U | tr '\n' ' '); H=$(grep -c '^<<<<<<< ' ccd/ccd)
  if [[ "$SCRATCH" == /* && -d "$SCRATCH" ]] \
     && { [ "$U" = 'ccd/ccd ' ] || [ "$U" = 'ccd/ccd deploy/measure-continuity.py ' ]; } \
     && { [ "$U" = 'ccd/ccd ' ] || { python3 "$SCRATCH/resolve-instrument-merge.py" && chmod 0755 deploy/measure-continuity.py; }; } \
     && python3 "$SCRATCH/resolve-census-merge.py" \
     && { [ "$H" = 1 ] || python3 "$SCRATCH/reg-get-census.py"; } \
     && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
          const { markGenerated } = await import('./shared/mark.mjs'); \
          writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))" \
     && bash -n ccd/ccd && ! grep -qE '^(<<<<<<< |>>>>>>> |=======$|\|\|\|\|\|\|\| )' ccd/ccd deploy/measure-continuity.py; then
    git add ccd/ccd deploy/measure-continuity.py && git commit -q --no-edit && echo "merged: resolved [$U] by script"
  else
    echo "STOP: [$U] is not a merge this block resolves — nothing committed; report it"; git merge --abort
  fi
fi
git log -1 --format='%h %s'
```

Expected — measured on scratch repositories (Pre-flight finding 12; `origin` a real remote): the last line is this
branch's tip and nothing else prints when `main` has not moved; `resolved 1 hunk(s): the stamp and the census block,
main's side` then `merged: resolved [ccd/ccd ] by script` when another wave's `ccd/ccd` edit landed away from this
wave's lines; `resolved 2 hunk(s)…`, `census 178/148 -> 181/151 …, before it the fake wave's reads` and the same
`merged:` line when that wave also moved the census (main's wave there: two reads on one line and its own LAST MOVE),
the chain then reading

```text
# THE LAST MOVE WAS the rescue wait's reads (session-continuity wave 2), the +3; before it the fake wave's reads, the +2 (`_fake_wave`);
# then D-3526's carried-in verdict, the +6, then the RECLAIM region's reads (CCR-15 wave 3, Task 5), `_child_tmpdir`'s and CCR-10's.
```

and, when wave 1 landed, `deploy/measure-continuity.py: main's file + the stage-4 block, 476 lines` before
`merged: resolved [ccd/ccd deploy/measure-continuity.py ] by script`. Any `STOP:` — the fetch failed; another wave
edited a line beside one of this wave's (`a conflict at ccd/ccd:<n> that is neither the stamp nor the census
block`); a census block in another shape (`…not in the shape this step edits`); `_reg_purge`'s inventory (a wave
that also added a registry field conflicts on the count sentence — the coordinator rules those three lines); any
other file — leaves this branch's tip, no merge in progress and a clean tree: report it and stop. Never resolve by
hand; never `git checkout --theirs` on a file. Then re-measure on the merged tree:

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok && git diff --quiet -- ccd/ccd && echo stamp-unchanged
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l
grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'
git fetch origin main && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected: `syntax-ok`, `stamp-unchanged` (the block already re-stamped the merged body), the census the pair the
block wrote, `corpus-frozen`. If the merge moved a README anchor or the citation census, re-run the S6-R11 procedure
and commit the re-measured literals with the composition stated ("an assertion over the merge is only true on the
merged tree").

- [ ] **Step 2: The server suite in twelve sequential shards on the merged tip, then agent and pwa**

```bash
git log -1 --format='%h merged tip under test'
cd server && npm ci
./node_modules/.bin/vitest run --shard=1/12     # … then 2/12, 3/12, … 12/12, one call each, foreground
cd ../agent && npm ci && npm run test
cd ../pwa   && npm ci && npm run test
```

Expected: PASS everywhere; `agent` and `pwa` untouched. The twelve shards cover the pins the merged tree carries —
`deviation-refs`, `dtbd`, `topology-clean`, `single-definition`, `ccd-harness-containment`, `ownership`,
`ccd-reg-get-census`, `typecheck-tests`, `ccd-workspaces`' "EVERY bash call site" and `session-hook`'s citation cases
among them. Report the twelve shard summaries, their sum, and the merged sha they ran on. If a shard is killed by the
600 s ceiling, re-run the whole suite as `--shard=k/24`. Re-run any known load flake IN ISOLATION before calling it a
break. **If `main` moves again before the PR merges, repeat Step 1 and re-run all twelve shards; report the shard
sums at the new merged sha.** If Step 1 merged wave 1's instrument, the shards include wave 1's own
`test/measure-continuity.test.ts`; name it in the report, since both waves' cases must pass unchanged against the one
merged file. Before the PR, also compare this branch's deviation entries against `origin/main`'s without merging
(`git fetch origin main` then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`).

- [ ] **Step 3: The wave's own surface in one run**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts test/ccd-limit-banner.test.ts \
  test/measure-continuity-stage4.test.ts test/ccd-swap-pin.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-swap.test.ts
```

Expected: PASS (measured on the prototype: 94 + 136 + 9 + 13 + 43 + 16).

- [ ] **Step 4: Confirm the author, push, open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Session continuity wave 2: the rescue waits near a reset, spreads and chain-waits (AGENT-FIRST)" --body-file - <<'EOF'
Wave 2 of the session-continuity programme (spec `docs/superpowers/specs/2026-09-23-session-continuity-design.md` §5.4 rules 2–3; rule 1 shipped as D-3526, #207). **AGENT-FIRST, ccd only.** No wire change.

1. **The dated row.** The verdict keeps a rate-limit row's `resetsAt`, window and own epoch only from the row D-3526's reader answered rc 0 on — a row this pane's process wrote — through a new `dated` reader mode cached with its answer in `$REG/<id>.tdate`. An unplaced process, lost auth on either surface, a carried-in row and a reset the row was written at or after date nothing; no wait of any kind opens without a dated row.
2. **Rule 2 — the near-reset wait** (C6, C13). A `five_hour` block on an Anthropic lane within 600 s of its kept reset, with Claude Code's auto-continue armed (its own footer, outside the prompt box — never a draft or prose saying the words), waits; it ends at the reset or 120 s after it — in a swap if a newer rate-limit row exists; otherwise, while still armed and only for a wait open before that grace ran out, in place, never away from an account that has just reset — and only until 30 minutes past that reset (`RESCUE_CHAIN_WAIT`; the planner's default bound, which the operator may rule away), after which the tick is rescued as today. Today's stranded path is the no-room wait; a stalled one swaps the moment a target has room, inside the grace too, and one whose reset a newer row proves stale ends `stale`. The residual — a stalled session whose own account is the only one with room idles until another target gains room, exactly as today — was ruled 2026-09-24 (spec §11 item 6): left as today and counted by `--stage 4`'s four `noroom_…` rows (CCR-20).
3. **Rule 3 — spread, no bounce, chain wait.** From the swap log's tail, read only when a decision needs it: skip the accounts just left blocked, prefer a target no rescue landed on in 10 minutes (never at the price of a class degrade or an undecidable tick, and never over the session's recovered home), and chain-wait a fourth rescue within the hour up to 30 minutes — on an Anthropic lane and a dated block not past its five-hour reset's grace, held only on the account it was taken on.
4. `$REG/<id>.rescuewait` records each wait once on entry and once on exit; `deploy/measure-continuity.py --stage 4` reads §9's stage-4 rows back, read-only.

Citation corpus (S6-R11): every edit above README's anchors is line-neutral; the census did not move. `_reg_get` census +3 calls on 3 lines over the base's stated pair (176/147 -> 179/150 on this plan's base).

**Deploy: by ccrc's own update mechanism (no hand rollout, operator ruling 2026-09-30); AGENT-FIRST — ccd only, the server arm is inert.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report (the wave-done mail)**

Report to the coordinator, per the worker skill: the branch tip sha; the merge block's outcome; the twelve shard
summaries and their sum at that merged sha, agent and pwa; each task's citation-tax output (re-pointer lines and
`cite-remeasure.py`'s four lines); the census before/after; every mutation row's measured red at its own commit;
Task 3's live baseline (or that it was skipped); every departure from this plan, named by a slug (the coordinator
assigns numbers). Then stop.

- [ ] **Step 6: Deploy — measured, never moved by hand (post-merge, by whoever merges)**

Do NOT run `ccrc rollout` or `ccrc update` by hand (operator ruling 2026-09-30): ccrc's own update mechanism moves
both boxes to the new prerelease. This step measures that it did, read-only:

```bash
PR=<this wave's PR number>
git fetch origin main --tags
M=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
TAG=$(git tag --points-at "$M" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "merge: $M  tag: ${TAG:-<none yet>}"
ccrc rollout --check   # read-only: which build each box runs
```

Expected: once `release-main.yml` has tagged the merge, both boxes report that tag (also readable at
`GET /api/updates`, or `ccrc version` on each box). A box that does not converge is REPORTED, never moved. This wave
changes only `ccd/`, `deploy/` and README, so the order the boxes move in changes no behaviour; AGENT-FIRST is met
once the fleet box runs the tag.

Then, on the fleet box, read-only, once a session has been blocked past the deploy:

```bash
ls "$HOME"/.cc-sessions/*.rescuewait 2>/dev/null | head -3
grep -E ' (rescuewait|rescuewait-end) ' "$HOME/.cc-sessions/swap.log" | tail -5
grep -E ' auto-rescue .* (reset|type|row)=' "$HOME/.cc-sessions/swap.log" | tail -3
python3 "$HOME/<the deployed tree>/deploy/measure-continuity.py" --stage 4 --since "$(date +%F)"
```

Expected: `.rescuewait` records appear as sessions wait; the instrument's rows begin to move. A rollback is the
operator's call through the same update mechanism, never a hand `ccrc update` from this step; it is safe on the
data: `.rescuewait` is inert to an older ccd (`_reg_purge` removes it with a row by suffix), and an older
`_limit_read` re-reads every `.tdate` record this wave wrote (Pre-flight finding 8).

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated per wave, by the coordinator, at this
wave's run-open; **a worker never calls the allocator** (worker clause 11). A departure from this plan found while
executing it is named in the wave-done mail by a slug — what departed, where, and why — and the coordinator assigns
its number and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in
its report and nowhere in a committed file (`dtbd.test.ts` reds the concrete form).

No block is written as a range, and no headroom accounting lives in this plan. The pre-flight findings above are not
deviations: they were measured before this plan existed and shaped it. The re-plan of 2026-09-30 and its review and
verification rounds spend no number: the two below were issued at plan time and are restated for what shipped and
what this plan builds.

- **D-3497** — Amends D-3100's argument that a re-rendered banner "cannot reach a relocation" because the rescue arm
  sits below `SWAP_COOLDOWN` (spec C12): the cooldown expires, and 32 of 248 rescues (2026-09-08..09-23) fired on a
  banner the session carried in. **Shipped by D-3526 (#207, `1c5f7d90`)**, on D-3522's carrier rather than the
  `$REG/<id>.landed` stamp this plan's held Tasks 1–2 would have built: a rate-limit row the reader proves older than
  the pane's own process (`_pane_born`), with `$REG/<id>.lastswap` strictly later than the row, is not a block, on the
  transcript and pane rungs alike; a landing whose Claude Code never came up (`$REG/<id>.spawn` rc 4 at or after its
  birth) is still moved, on purpose; the dated read is cached in `$REG/<id>.tdate` on the process and the file.
  D-3526 defines that implementation and each of its departures from the spec's `.landed`; this entry keeps rule
  1's number, and this plan builds nothing for rule 1 beyond the dated row the waits read (Task 1).
- **D-3498** — Amends post-swap-redrive R1 / D-2236 ("the rescue ignores Claude Code's armed auto-continue", spec C6,
  bound C13): on a `five_hour` rate-limit row on an Anthropic lane whose kept reset is within `RESCUE_WAIT_BOUND`
  (600 s; 0 turns this near wait off), and ONLY while Claude Code's auto-continue is armed on the pane — its own
  footer, outside the prompt box and on its `·` line, never a draft or prose saying the words — the rescue waits
  instead of swapping. The reset, window and row epoch come only from the row D-3526's reader answered rc 0 on — a row this
  pane's process wrote — through a `dated` read cached with its answer in `.tdate`; an unanswered `_pane_born`, lost
  auth on either surface (the pane's auth text, or a 401 newer than the rate-limit row, whoever wrote it), a
  carried-in row and a reset the row was written at or after date nothing, and no wait of any kind opens without a
  dated row carrying a kept reset and its window. The wait ends at the reset, or `RESCUE_WAIT_GRACE` (120 s, its own
  constant) after it: in a swap if a rate-limit row newer than the reset exists; otherwise, and ONLY while the pane
  is still armed and for a wait that was open before that grace ran out, in place — never in a swap away from that
  reset while that hold lasts, and it lasts until `RESCUE_CHAIN_WAIT` (30 minutes, the spec's knob for how long a
  session is held on its account) past the reset, after which the tick is today's: a swap to a target with room, or
  the strand. Nothing types: the redrive fallback is not called
  at a reset (it types only on an unsubmitted resume pair and can hold a tick up to 20 s). Today's `stranded` path is
  also a wait (`kind=noroom`, recorded when its block is dated; every line it logs is unchanged) with the same reset
  ending, and a stalled one swaps the moment a target has room, inside the grace after its reset too; one whose
  reset a newer row proves stale ends `stale` and is not counted past it. Rule 3's chain wait (`kind=chain`, 30
  minutes; an Anthropic lane, a dated block, no wait open, never on a five-hour reset whose grace has passed, held
  only on the account it was taken on) ends early at its account's reset the same way, and a 401 arriving mid-wait
  ends it. A stalled session whose near, chain or no-room wait crosses its
  own reset is rescued as today once a target has room; only an armed pane is held on a reset that turned, and for
  at most `RESCUE_CHAIN_WAIT` past it. Every
  wait is recorded once on entry and once on exit in `$REG/<id>.rescuewait` and `swap.log`, never under the word
  `hold`. A stalled session, a `seven_day` or non-Anthropic block, or a row without a kept reset swaps as today;
  `~/.cc-limits` is not a fallback. Implemented by this plan's Tasks 1–2.
- **D-3846** — Wave 1's text residue from review 233 (`d1ca968e`), accepted by the coordinator at #230's merge and
  carried here as this wave's first commit; no behaviour moves. F1: `server/test/ccd-swap-carry-merge.test.ts`'s comment
  on the real here-string case sized each diverged path at "~100 bytes"; a path is the fixture HOME plus a 133-byte
  suffix, about 165 bytes or more, so the comment now says "~165 bytes or more" (its conclusion, "well over 64 KiB",
  stands). F2: wave 1's plan, entry 3774, listed rows 1, 6, 7, 15 and 17 as the ones the two real-cause cases moved,
  leaving out rows 50, 58 and 63, which the same entry records moving; the sentence now scopes its list to rows 1-45
  and names 50, 58 and 63 for rows 46-65.
- **D-3847** — Task 1 Step 6's `_reg_purge` inventory, measured on `main` `a934a59b` (the coordinator replayed the
  plan's 30 anchors there; these two were the only misses) and again after `10f32755`: the stall watch's `turn` field
  took 42 after this plan was measured, so the count sentence reads "…`tdate` 41, the stall watch's `turn` 42,
  continuity's `rescuewait` 43 — by addition…" and the list's head "The 43:", where the plan wrote 42 for both; the
  third inventory edit (`rescuewait` in the `reaping, …` line) applied as written. The same `turn` addition spent the
  14 characters of headroom Pre-flight finding 7 counted in `ccd-auto-swap-pool.test.ts`'s fixed 2400-character
  window, so with `rescuewait` added `` `strandnotify` `` began at character 2401 and "names the three per-id fields
  this build adds" went red. The window now ends at the inventory list's own last field (`` `wrapper`. Note that
  `pool` here ``), asserted found after the claim, so no byte count can be outgrown again; measured red when
  `` `strandnotify` `` is deleted from the list (`1 failed | 42 passed (43)`). The `_reg_get` census needed no
  adaptation: `reg-get-census.py` measured `176/147 -> 179/150`, the plan's pair.
- **D-3848** — Task 3's Opus review found stage 4's local-time conversion unpinned: every hand-built case runs
  `TZ=UTC` and the real-ccd cases inherit the box's zone (UTC here), so `s4_epoch` with `calendar.timegm` for
  `time.mktime` left all nine cases green, while the two rows that compare a true epoch (`row=`, `reset=`) with
  swap.log's local stamp would miscount by the zone offset on a non-UTC box — the class wave 1's stage 1 closed under
  `TZ=PST8`. `measure-continuity-stage4.test.ts` gains one case, "under TZ=PST8 a stranded wait past its reset and a
  carried-in rescue still count": ccd writes and the instrument reads both rows in `PST8`. Its mutation row, 3.21:
  `return int(time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))` inside `s4_epoch` →
  `return int(calendar.timegm(time.strptime(stamp, "%Y-%m-%d %H:%M:%S")))` reds `1 failed | 9 passed (10)`, the new
  case only. No instrument line changed.
- **D-3849** — The coordinator's ruling (B) on Task 2's review finding: a rescue whose only account with room is one
  this session just left blocked strands (do not bounce, as planned), but `_strand_mark` was called with no cause, so
  `_strand_why` — which knows no skip list — wrote "no account in pool … can take it" to the marker, swap.log and the
  banner. That and "no account has room" ask the operator for opposite acts (leave it alone, versus wait or add
  capacity), and the false sentence invites the hand bounce rule 3 exists to stop: an overloaded null at a seam. A new
  `_rescue_strand_cause id cur home hard-blocked hrc` in the RESCUE POLICY section asks `_swap_target` UNSKIPPED and,
  only when that names an account in `RESCUE_SKIP_LEFT` (and not the one the session sits on), prints "its only
  account with room, <acct>, is one it left blocked inside RESCUE_CHAIN_WINDOW, and a rescue does not take it back
  (do not bounce)"; the no-target strand line in `_auto_swap_check` passes it as `_strand_mark`'s existing fourth
  argument, one line for one line (the citation census unmoved). An empty probe (genuine no room) returns before the
  swap log is read, so a strand's later ticks still pay no `_rescue_history` pass (Review Focus 17), pinned by the
  control. Its cost, measured on a fixture under load 13: the extra probe adds about 111 ms to a genuine no-room
  strand tick (`_swap_target` alone 96 ms) and about 178 ms to a do-not-bounce strand tick, which also reads the
  swap log; it runs only on a stranded session's tick. Three cases in `ccd-rescue-policy.test.ts` ("the do-not-bounce
  strand names the account it will not take back"). Mutation rows, each measured on its own commit: dropping the
  cause at the call site reds `1 failed | 96 passed (97)` (the strand case); deleting the `RESCUE_SKIP_LEFT`
  membership check reds 1 (the unit case, "room the skip did not remove"); dropping `"$out" != "$2"` reds 1 (the
  unit case, "the account it sits on").

---

## Review lenses

Four lenses, all `opus` — a diff of one shipped script (`ccd/ccd`: 372 lines added, 33 changed in place), one
read-only instrument (267 lines, most of it wave 1's shell), README (+52 lines, one changed), two new test files
and one extended (1057 and 227 lines new, 107 added to `ccd-limit-banner`), sized to the fleet policy's 3–5
reviewers; one `sonnet` refute pass per finding.

1. **Safety of the waits (opus, xhigh).** This wave decides what every blocked tick does after the verdict. Confirm
   the verdict itself is untouched (`_session_hard_blocked`'s return codes, D-3526's carried-in rule, the `tscan`
   shape). Read `_hard_block_date`, `_limit_read` and `_hard_block_dated` for any path that yields a reset without an
   rc-0 rate-limit row this process wrote — an unplaced process, a 401 newer than the row (whoever wrote it), an
   auth-failure pane, rc 3 (carried-in, never-came-up), a row at or after its own reset, a torn or old-shape `.tdate`
   (Review Focus 11, 12, 15, 16). Read `_rescue_policy` for every `return 1` (HOLD) and prove each is bounded or
   spec-sanctioned: the near wait (`BOUND + GRACE`), the chain wait (`RESCUE_CHAIN_WAIT`, and it ends when the
   verdict stops being dated), the no-room wait (unbounded by spec — today's `stranded`; it holds only from its reset on, and a stalled one
   never),
   and the post-turned hold on one reset on one account, which must hold ONLY a pane whose auto-continue is armed
   (`_rescue_armed`: the footer outside the prompt box, on its `·` line) on a wait open before that reset's grace
   ran out, and only until `RESCUE_CHAIN_WAIT` past that reset (Review Focus 19, 20, 23).
   Confirm, with evidence, what a STALLED session in a near, no-room or chain wait does at and inside the grace after
   its reset (Review Focus 6, 13). Confirm the globals cannot leak across ticks, the policy sits below both cooldown
   gates, and nothing types. Read `_rescue_history`'s python for any input from `swap.log` (a file sessions' own tools
   can append to) that could crash the tick, stall it, or widen a skip list into "no target" (a skip list can only
   ever fall back to the just-left accounts, never to empty-by-spread, and never to undecidable-by-spread: the
   spread pass's rc 5 falls through, Review Focus 8).
2. **ccd mechanics and the line-neutral discipline (opus, high).** Every edit above `ccd/ccd:21564` is one line for
   one line, and the three in `_transcript_limit_banner` leave the default and `stuck` modes byte-for-byte unchanged
   (D-3526's reader cases green); the python contains no `'`; `.tdate`'s new shape keeps the key, the path check and a
   consistency rule per rc, and an old record can neither match it nor be matched by the old regex (Pre-flight 8);
   `_limit_read`'s split survives an empty field; `SWAP_TARGET_SKIP` is read with `:-` everywhere and changes nothing
   when empty; `_rescue_target` is `_swap_target` byte for byte off the rescue path and on a strand; the three source
   pins (`_session_hard_blocked "$id" "$pane" && hard_blocked=1`, `auto-rescue $id: $wrapper (blocked)` above the pin
   check, the detector literal once) hold; every arithmetic operand passes `=~ ^[0-9]+$` first and carries `10#`.
3. **Guard fidelity and the citation tax (opus, high).** Every mutation row mutates the guard it names and reds for
   the stated reason, not an adjacent one; the two-lock rows (1.8, 1.9, 1.13) and the regression controls are what this
   plan says they are; the census literals came from the instrument, README's anchors point at the bytes their
   sentences quote, `_reg_get`'s sentence was re-measured in Task 1 with no new cardinal within 25; the inventory
   window keeps `` `strandnotify` `` inside 2400 characters; the merge block resolves only the stamp, the census and
   wave 1's instrument, and on anything else commits nothing and aborts the merge.
4. **The instrument and the spec's §9 (opus, high).** `measure-continuity.py` is read-only (opens nothing for
   writing, runs no subprocess), converts `swap.log`'s LOCAL times with the reader's zone, and each row counts what
   §9's row names — including where it cannot (a rescue with no `row=` is undated, not "not carried-in"; a chain wait
   handed to the near wait on its own reset counts as reaching the reset; a no-room wait whose block turned into lost
   auth mid-strand still counts, a named cost); the binding test really runs the ccd functions that write each line;
   the file is wave 1's shell byte for byte around the stage-4 block and either landing order leaves one file.

---

## Open questions for the operator

1. **§11 item 6 comes back with its count.** Ruled 2026-09-24: a stalled session whose own account is the only one
   with room idles as today, no in-place restart, and stage 4's instrument counts it — `noroom_waits_past_their_reset`,
   by end, with the seconds past the reset. The operator rules again once the first deploy's data is in (Linear
   CCR-20); nothing in this plan depends on that ruling.
2. **A no-room wait whose block turns into lost auth mid-strand keeps its record open.** The strand stands (as
   today) and the session moves when a target has room, but the record — and so §11 item 6's count — still names the
   rate-limit reset it opened on. Closing it on the first undated strand tick would make the count exact at the price
   of close/reopen churn whenever tmux fails to answer for one tick. This plan keeps the record and names the cost in
   the instrument; the operator may rule the other way.
3. **`RESCUE_WAIT_BOUND=0` turns off the NEAR wait, not every in-place hold.** Rule 2's ends at a reset still hold
   an open chain wait from its reset through the grace, and an ARMED no-room wait there and — past the grace — until
   `RESCUE_CHAIN_WAIT` past the reset (Open question 4). The review of 2026-09-30 measured it (a chain wait inside
   its grace, and a no-room wait open since before its reset, both held under a bound of 0) and this plan documents
   the knob as the near wait's switch (spec rule 2, the constant's own comment, README). If the operator wants a
   switch that turns every in-place hold off — for an incident where holding misbehaves — it is
   `(( RESCUE_WAIT_BOUND > 0 ))` on (a)'s two holds and one case pinning the no-room one; the operator rules.
4. **The hold after a reset turned is bounded at `RESCUE_CHAIN_WAIT` past the reset** (planner's default,
   2026-09-30): measured, `main` rescues that input at once; the spec's unbounded hold would park a session whose
   Claude Code stopped continuing. The operator may rule it unbounded (drop one clause, one case, one row) or pick
   another bound.
