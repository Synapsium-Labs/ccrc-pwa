# Child reclamation wave 3 — `ws-reclaim`, its token, and close's fourth act (AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "the coordinator has finished with this child" end in the child being gone: `ccd ws-reclaim` pins everything recoverable in a CHILD workspace (a WIP commit that never stages a secret-shaped file, attic pins of every commit, stash and in-progress operation head, a tombstone) and then removes its pane, unit, nested same-repository checkouts, worktree, branch, clips, per-session temp root and registry row — and the server composes that verb, and only for a child, right after a run's close has committed. A child whose worktree directory has VANISHED is reclaimed from what is left (its branch tip, its stashes, git's recorded HEAD; the tombstone says `worktree: absent`), never retried for ever; a directory git does not record as the project's worktree refuses `no-worktree-record`, terminally (spec §5.5).

**Architecture:** Two halves that ship in one PR and deploy AGENT-FIRST. **The box** (`ccd/ccd`) gains one self-contained region, bracketed `RECLAIM-BEGIN`/`RECLAIM-END` and placed just above the dispatcher, holding: the reclaim ladder (`_ws_reclaim_eval`, ten rungs in spec §5.5's order plus its identity refusal `no-worktree-record`, fourteen tokens and no others, and a vanished-worktree arm, `_ws_reclaim_eval_absent`, that answers over what is left rather than retrying); the pin phase (`_ws_reclaim_pin` over the new `_ws_wip_commit` — the only `git commit` in ccd — and the existing `_ws_attic_pin`); its own tail arm (`_ws_reclaim_tail`: unsupervise and an ANCHORED pane kill first on the fresh AND every resumed arm, a settle re-pin once the pane is dead, then nested checkouts → worktree → branch CAS → clips → temp root → residue probe → registry purge last); and the verb (`cmd_ws_reclaim` → `_ws_reclaim_locked`, which takes `ws-reap`'s own lock, forks on a `reclaim:`-flavoured breadcrumb, recomputes the token inside the lock and refuses `state-changed` on any drift). `ws-audit --reclaim` mints that token; `ws-reap` gains exactly one mirror refusal. The agent grants `['ws-reclaim','--expect']`, enrolled so the bare verb is a TS2322. **The server** gains `server/src/coord/childReclaim.ts` — the fourteen-token vocabulary and its kind map, the pure close decision `childReclaimDecision`, and the ONE executor `reclaimChild` (re-reads the marker against the run id, the sibling list, presence and the `reclaim-v1` capability; audit → token → verb; cancels the child's outstanding deliveries on success; one feed row per outcome) — and `closeRun`/`closeReviewRun` decide eligibility inside the coordination mutex, RELEASE rather than hold a child they finished with, and hand the act to the per-session queue without awaiting it.

**Tech Stack:** bash 5 (`ccd/ccd`, `set -uo pipefail`, no `-e`), git 2.43 (`--pathspec-from-file`, `update-ref -d` CAS, `worktree remove --force`), tmux 3.4 (`=`-anchored targets), TypeScript (server, agent, pwa, L0 `shared/`), vitest 4, `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` (§5.5, §5.6, §5.7 in full; §4 for naming; §6 and Appendix A for every site this wave moves; §8's row for wave 3; §9 for the load-bearing pins). **Programme ledger:** `docs/superpowers/programs/child-reclamation.md` (its **Carried constraints** section is part of this plan's requirements).

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md` (cross-wave names and types; §7–§8 rulings; §9 R24–R31) — and **the Pre-dispatch amendments at the end of this file bind every task and win over any task text they contradict**

---

## Global Constraints

Copied verbatim from `CLAUDE.md`, the spec and the programme ledger where the value matters. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST, and it is not a slogan.** `ccd/ccd`, `agent/src/whitelist.ts` and the three skills must be on the fleet box before a server that composes `ws-reclaim` runs. The server gates every reclaim on `capSupported(state, 'reclaim-v1')` — null or absent REFUSES — so a server that lands first simply defers every child as `unsupported`; nothing is destroyed early and nothing is lost. The deploy order is Task 11's final steps.
- **Waves 1 and 2 are prerequisites and are MERGED before this wave starts.** This plan consumes, by these exact names: `ccd ws-add --child <runId>` and the `$REG/<id>.child` marker (wave 1); `CHILD_ARGV_CAP`/`child-argv-v1` and `_child_runid_valid` (wave 1); `ChildMark` in `shared/api.ts`, `SessionRecord.child: ChildMark` in `server/src/registry.ts`, and `childSpent(deps, rec): Promise<ChildSpentVerdict>` in `server/src/coord/childSpent.ts` (wave 2). Task 1 Step 0 measures all of them before any edit; if any is absent, STOP and report — there is no fallback in this wave for a missing marker.
- **The contract's rulings of 2026-09-23 (contract §7) are SETTLED here, and this plan builds their ruled form — nothing in it waits on a coordinator ruling.** R1 (the tail unlinks a non-directory temp-root leaf; Task 4), R2 (every run-id parse is wave 1's `_child_runid_valid`; Tasks 2 and 4), R4 (`ChildReclaimRequest.deferredSinceMs`; the feed row states the wait; Tasks 8 and 9), R5 (the audit journals its terminal refusals; Task 5), R8 (wave 4 adds the server-side pause read inside the executor; Task 8), R9 (every CITED file pays S6-R11, and prose above the frozen corpus's highest `ccd/ccd` anchor is length-neutral; below), R10 (the `_reg_get` census tax; below), R11 (the `failed` documents, and `tree-unreadable` means ONLY unreadable after the permission pass; Tasks 2, 4 and 5), R12 (`absent` is re-listed once; Task 8), R13 (this wave's store tests live in `child-reclaim-mail-store.test.ts`; Task 7), R14 (the kebab guard is `isChildReclaimKebab`; Task 8), R16 (a review child lives until the run it reviewed is terminal — `review-report-live`; Tasks 8–10) and R17 (an eligible child's archive request is overruled; Task 9). Each is named where it lands.
- **The second set of rulings (contract §8, 2026-09-23) is SETTLED here too, and amends §7 where they overlap.** R5′ (the audit journals TERMINAL refusals only, and its case list EQUALS `CHILD_RECLAIM_TOKEN_KIND`'s terminal arm — a test derives the arm from the map and holds ccd's list equal to it; Tasks 5 and 8), R9′ (the frozen boundary is `ccd/ccd:19131`, bare `:<n>` anchors included; below), R11′ (the audit's unmeasured answer is a reclaim document with `"verdict":"unmeasured"` at exit 1, and the executor maps ANY audit exit 1 to the `failed` outcome; Tasks 5 and 8), R16′ (an unreadable reviewed-run row defers `marker-unreadable`; a reviewed run ABSENT from the database keeps the child, `review-report-live`; Tasks 8 and 9), R19 (a child whose workdir does not exist, with no breadcrumb, is reclaimed WITHOUT a worktree — its branch tip, the stashes attributed to the branch and git's recorded HEAD pinned, the tombstone saying `worktree: absent`, the tail run from the branch CAS on — clips, temp root, registry purge — with the tail's unsupervise, anchored pane kill and unit re-measure still FIRST, as spec §5.6 requires on every arm, where R19's parenthetical lists them after the temp root (Task 4 says why); a directory that exists but that git does not record answers `no-worktree-record`, TERMINAL — the vocabulary is FOURTEEN tokens; Tasks 2–5 and 8) and R23 (the **Contract:** line above; every "contract §N" in this plan means that file, and every CODE comment this plan prescribes — ccd, TypeScript, tests — cites the SPEC, never the contract). R2 stands as ruled: wave 2 bounds the server's reading of a run id at ten ASCII digits through `CHILD_RUN_ID` (`shared/api.ts`), and this wave's one server-side run-id read — the audit's `childOf` (Task 8) — uses that same `CHILD_RUN_ID`; nothing is owed to the coordinator about it.
- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE engines — never lower them to make it green.**
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in: `server/` `agent/` `pwa/` `shared/`.

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Every fenced command block in this plan starts from the repository root and runs as written in ONE shell.** A package command is a subshell, `(cd server && …)`, so the next line still starts at the root: a bare `cd server && …` followed by another `cd server && …` (or by `cd agent`, or by a root-relative path such as `ccd/ccd`) fails its `cd` from inside `server/`, and `&&` then skips the command silently. A single command in a mutation-table cell is run on its own from the root.
- **Run suites in the FOREGROUND, timeout ≥600000ms.** Backgrounding hides a hang; the suites are load-sensitive. The whole server suite no longer fits one 600 s foreground run on the fleet box: run it as `--shard=k/6` for k = 1…6, sequentially, ONE denominator for the whole set (vitest 4 gives the remainder files to the low shards, so mixing denominators — `1/3` beside `3/6…6/6` — leaves a file in no shard whenever the file count mod 6 is 2 or 3). The six `Test Files` counts must sum to `find test -name '*.test.ts' | wc -l`. A shard that overruns re-runs the whole set as `k/12`, never one shard split alone and never backgrounded.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`. CI on the quiet box is the arbiter.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** This wave adds a destructive verb, which makes the rule absolute rather than standard: every test that reaches `cmd_ws_reclaim`, `_ws_reclaim_tail` or `_ws_reclaim_pin` runs inside `makePrHarness(...)`'s HOME, through `h.sh`/`h.run` (which carry `ghContainedEnv(..., { systemd: true, tmux: true })`), with the `CHILD_STUBS` recorders for `_ws_unsupervise` and `tmux` and its `inactive` answer for `_svc_is_active` (Task 2's fixture), and with `CCD_RECLAIM_RESIDUE_ROOT` pointed inside that HOME so the residue probe never reads the real `/tmp/claude-<uid>`.
- **NEVER run destructive `ccd` verbs against the live host:** `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore` — **and, from this wave, `ws-reclaim`.** Nothing in this plan runs any of them outside a fixture HOME. `ccd caps` on the fleet box (Task 11) is read-only. **Never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly**, and never print secret file CONTENTS.
- **Two authorities, always** (ledger, carried constraint 1). Child-ness is the box's `.child` marker AND the server's `--child-of`, EQUAL. No task may infer child-ness from anything else — not `--no-rc`, not a dec reason string, not a run row alone. On the box the verb refuses `not-a-child` unless both agree, on the fresh AND the resumed arm, with no flag, breadcrumb or environment variable that skips the rung.
- **No boolean at the child seam** (carried constraint 2). The registry's reading is three-way (`none` / `child` / `unreadable`); an unreadable marker DEFERS a reclaim and never authorises one. The close decision's `why` and the executor's defer reasons keep every condition a caller handles differently in its own word.
- **Every new surface is capability-gated and read with `capSupported`**, never `verbSupported`, which permits when the box's verb list is absent (carried constraint 3). This wave's token is `reclaim-v1`.
- **The pause file is read inside `ws-reclaim`**, on the fresh path and on resume (carried constraint 4). `$REG/reclaim-paused` has no writer until wave 4; its rung ships here. The SERVER-side read of the same file (`paused-at-server`, via `RECLAIM_PAUSE_MARKER`) is wave 4's, added inside `reclaimChild` at the place Task 8 marks (contract §7 R8) — an early skip; ccd's rung is the read that matters.
- **`ws-reclaim` never resumes `ws-reap`'s work and vice versa** (carried constraint 5). The breadcrumb value is `reclaim:<phase>`; a mismatched flavour refuses (`reap-in-progress` from reclaim, `reclaim-in-progress` from reap).
- **Rings / bounded contexts:** ring membership is a property of a file's IMPORTS, not its path. L0 `shared/*.ts` imports NOTHING (not even `node:*`). **An adapter may not narrow a distinction it received.** `server/src/coord/childReclaim.ts` is `close.ts`'s kind of file — an L1 decision reached through declared ports — and its pure `childReclaimDecision` imports no I/O.
- **Single-source-of-truth values are enumerated once and derived.** `server/test/single-definition.test.ts` text-scans `shared`, `server/src`, `pwa/src`, `agent/src`. `reclaim-v1` is spelled once in `server/src` (`RECLAIM_CAP`); ccd's `echo reclaim-v1` and `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` are the other two spellings and a `toContain` holds them equal.
- **Wire discipline — additive-only, absence-permits:** `CloseOutcome`'s ok arm and the close response gain `childReclaim` and an optional `childReclaimWhy`; nothing is removed or renamed; `FLEET_PROTO` stays 1.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted or mutated — measured before and after, not a comment. Every task below ends with its mutation table; each row names the exact edit, the command, and the red it must produce, and every edit is RESTORED (and ccd re-stamped) before the commit.
- **Naming (spec §4, contract §0).** ccd surfaces keep the spec's names (`ws-reclaim`, `reclaim-pause`, the journal act `reclaim`, `reclaim-v1`, `$REG/reclaim-paused`, the `reclaim:` breadcrumb, `$HOME/.cc-tmp/<id>`). Every TypeScript identifier, file and test file this wave adds says `childReclaim` / `ChildReclaim` / `child-reclaim` — never a bare `Reclaim*`/`reclaim*`, because `server/src/coord/reclaim.ts`, `ReclaimRefuseCode`, `RECLAIM_COPY` and `POST /api/runs/:id/reclaim` already mean reassigning a dead coordinator's claim. The contracted exceptions are `RECLAIM_CAP`, `CCD_ARGV.wsReclaimAudit`, `CCD_ARGV.wsReclaim`, and the bypass fixture `g13-ws-reclaim-without-expect.ts`.
- **`ccd/ccd` is a provenance-STAMPED file.** Line 1 is the shebang, line 2 is `# ccrc:generated 1 sha256=…`. **Every task that edits `ccd/ccd` re-stamps before committing**, or `server/test/ownership.test.ts` goes red. From the repository root:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **Every edit to a CITED file pays the citation-corpus tax — procedure S6-R11 (contract §7 R9).** A cited file is one the README or the frozen compaction-card corpus cites by line — `ccd/ccd` and `shared/api.ts` today; the census names the set. `server/test/session-hook.test.ts` audits every `file:line` citation in two frozen corpus documents and in `README.md`, and an insertion into a cited file shifts every anchor below it. So every task that inserts into `ccd/ccd` OR `shared/api.ts` (Tasks 1–5) pays it in that same task. **Edit length above the frozen corpus's highest `ccd/ccd` anchor is a decision** (R9, wave 1's rule): that anchor is `ccd/ccd:19131` (contract §8 R9′, measured at `507aefe9`; both corpus documents are frozen, so the figure holds at this plan's base), found from the repository root by

      grep -ohE '(ccd/ccd:|[`( ,]:)[0-9]+' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
        docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md | grep -oE '[0-9]+$' | sort -n | tail -1   # 19131

  — the BARE `:<n>` anchors counted with the `ccd/ccd:<n>` ones (the corpus cites `cmd_forget`'s `_fg_prc` only as a bare `` `:19131` ``; a grep for `ccd/ccd:[0-9]+` alone stops at `:19109`, 22 lines short of the boundary). `cmd_caps`, `cmd_ws_audit` and `_ws_reap_locked` all sit above it — so every insertion this wave makes there carries CODE and at most a one-line pointer comment, and its explanation lives BELOW the anchor, in the `RECLAIM-BEGIN`…`RECLAIM-END` region (Tasks 4 and 5 say where). The procedure, applied by each such task in its own step (for `shared/api.ts`, read "the edited file" for `ccd/ccd` below):
  1. Run the five audit cases:

         cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND'

     Green: nothing to do. Red: continue.
  2. **README is REPAIRED, never counted.** For every README anchor the `README HAS ITS OWN CENSUS ENTRY` case names, open `README.md`, find the bytes the sentence quotes in the edited `ccd/ccd` (`grep -n` on the quoted text), and re-point that citation's line number to them. Repair README FIRST, then measure — a census taken before the repair describes a tree about to change.
  3. **Everything else is RE-MEASURED, with its composition stated.** Copy the edited `ccd/ccd` to the scratchpad; `git show HEAD:ccd/ccd > ccd/ccd` (the task's base); insert `fs.writeFileSync(path.join(process.env.S6_DUMP!, '<case>.json'), JSON.stringify(<the asserted expression>, null, 1));` immediately above each red assertion; run the step-1 command with `S6_DUMP=<scratchpad>/base`; restore the edited `ccd/ccd` from the scratchpad copy; run again with `S6_DUMP=<scratchpad>/task`; `diff` the two dumps. Paste the TASK values into the assertions in the instrument's own order (`toEqual` on an array is order-sensitive — never retype an anchor, copy it from the dump), and append one paragraph to that assertion's comment naming which references entered, which left, and the one cause ("<this task>'s insertion into `ccd/ccd` at `<function>`; no corpus document edited, no rule changed — S6-R11, no D-number"). Remove every probe line; `git diff server/test/session-hook.test.ts` must show only the census values and that paragraph.
  4. Re-run step 1: green. **Never adjust a number to make a test green without the dump, and never widen a rule.**
- **Every task that adds a `_reg_get "` call to `ccd/ccd` re-measures `_reg_get`'s census sentence IN PLACE, in that task — the `_reg_get` census tax (contract §7 R10).** `server/test/ccd-reg-get-census.test.ts` reads the header sentence "this file makes N invocations across M non-comment lines" (`grep -n 'invocations across' ccd/ccd`) and compares both numbers with the live count; its second case refuses any OTHER cardinal within 25 of them in that block. Wave 1 moved it once already (`_child_tmpdir`'s `.child` read). This wave adds reads in Task 2 (rungs 1–2, the identity reads, the resume eval's marker read), Task 4 (the tail's and `_ws_reclaim_locked`'s project/workdir reads, the breadcrumb read) and Task 5 (the audit's breadcrumb read) — each of those tasks pays the tax in its own re-stamp step, after its ccd edit and before its test run:
  1. Measure with the header's OWN two commands, from the root, and never type the numbers from this plan:

         grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l    # N — occurrences
         grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'             # M — lines

  2. Write N and M over the sentence's two numbers (it wraps across two comment lines; change the digits only), and rewrite the block's two `THE LAST MOVE WAS …` lines — as wave 1 left them — IN PLACE, two lines for two lines, as:

         # THE LAST MOVE WAS the RECLAIM region's reads (CCR-15 wave 3, Task <k>);
         # before it `_child_tmpdir`'s `.child` read and CCR-10's archive check.

     with no count in them (the second case reads every cardinal in the block). The rewrite keeps the block's line count, because the header sits above the frozen citation corpus's `ccd/ccd` anchors and one added line is citation debt. The dated history list ("It has moved six times…") is NOT extended — the test locates it by that literal, wave 1's own reading.
  3. `(cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts)` — green. A red naming a count means step 1 was typed, not run.
- **Three ccd text bans this wave must not trip**, each pinned by a test that already exists: (a) the substring `branch -D` may appear on exactly ONE line of `ccd/ccd` (`cmd_ws_rm`'s echo) — `server/test/ccd-ws-reap.test.ts` — so no comment in this wave ever spells it; this plan writes "a forced branch delete" instead; (b) `--force` may not appear in `_ws_reap_eval`, `cmd_ws_reap`, `_ws_reap_tail`, `cmd_ws_audit` or `_ws_reap_locked` (same file) — every `--force` this wave adds lives in `_ws_reclaim_tail`; (c) the heading `STATUS 1 FOLDS SEVERAL CONDITIONS` appears exactly four times (`server/test/ccd-lifecycle-purge.test.ts`) — `_ws_reclaim_tail`'s purge arms do not repeat it.
- **Zero new ccd verbs for coordination mutation** is not engaged: `ws-reclaim` is fleet control over a workspace, not the coord surface. **`gh` has NO exec-whitelist entry, deliberately. Never add one.** `EXEC_COMMANDS` stays exactly `['tmux','ccd']`; `UNGRANTABLE_VERBS` stays `['ws-rm','ws-gc']` — `ws-reclaim` has a lawful grantable form.
- **Not changed, deliberately (spec §6):** `ws-reap`, `ws-rm`, `ws-gc`, `ws-archive`, `ws-restore`, their grants, their refusals, the audit-token ceremony and every PWA surface that drives them — with exactly ONE addition, `ws-reap`'s mirror refusal `reclaim-in-progress` (carried constraint 5). `ws-audit --session <id>` with no flag is byte-identical. `_ws_tombstone` called with two arguments writes byte-identical output. The merged sweep still only announces.
- **A REVIEW child lives until the run it reviewed is terminal (contract §7 R16, ruled).** Reviewer clause 7 puts the report under `$HOME/.cc-clips/<reviewer id>/`, and the coordinator cites it BY PATH in every send-back `fix-round` mail, so a review child is not finished when its own review run closes. `childReclaimDecision` answers `{ reclaim: false, why: 'review-report-live' }` for a child whose MINTING run is a review run while the run it reviews (`runs.reviews`) is not terminal — a store read of that run's state, taken in the same mutex section as the sibling read (Tasks 8–9). Once the reviewed run is terminal the review child is reclaimed like any other (by wave 4's sweep, whose eligibility gains the same condition). Its two edges are RULED (contract §8 R16′), and this plan builds both: a reviewed-run row that cannot be READ defers — `marker-unreadable`, never an authorisation — and a reviewed run ABSENT from the database is not proven terminal, so it keeps the child — `review-report-live` (wave 4 logs that case like `minting-run-absent`). The coordinator's step 6 is NOT changed: its shipped text and its pins stand exactly as they are.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`). One commit per task. Before every push, check the author (`git log --format='%an <%ae>' origin/main..HEAD | sort -u`) is the operator's configured identity and not a placeholder.
- **No hostnames, IPs, tailnet names or docserver URLs** anywhere in this wave's diff (`server/test/topology-clean.test.ts` scans every blob the range introduces).
- **Locate code by CONTENT.** Line numbers below are "as of `f5dc495b`, before waves 1 and 2" hints, never addresses; waves 1 and 2 and two live programmes move them.
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `shared/api.ts` | Modify (`LifecycleAct` union + `LIFECYCLE_ACT_MAP`; `LcRefusalToken` union + `LC_REFUSAL_WORD`; `LifecycleMeas` + `LIFECYCLE_MEAS_KEY_MAP`) | L0 home of the journal act `reclaim`, the journal-only failure tokens `pin-failed` and `unit-still-active`, and the three `meas.` keys the verb journals (`childOf`, `wip`, `residueBytes`) |
| `server/src/coord/journalparse.ts` | Modify (`reviveMeas`) | Carries the three new `meas.` keys into the lifecycle mirror instead of dropping them at ingest |
| `ccd/ccd` | Modify (`_LC_ACTS`; `_ws_tombstone`'s third printf; `_ws_reap_locked`'s resume fork; `cmd_ws_audit`'s parse, eval call and verdict line; `cmd_caps`; the dispatcher `case` and its usage line; `_reg_get`'s census sentence and its `THE LAST MOVE WAS` lines, rewritten in place by Tasks 2, 4 and 5) and extend (the new `RECLAIM-BEGIN`…`RECLAIM-END` region, directly above `# Guard so the script can be \`source\`d by tests without running a command.`) | The box's whole half: ladder, pin phase, tail arm, verb, audit mode, capability token |
| `pwa/src/session/journalWords.ts` | Modify (`ACT_WORD`) | The operator's word for the new act — the record is total over the union |
| `agent/src/whitelist.ts` | Modify (`REQUIRED_VERB_FLAG`; `EXEC_WHITELIST.ccd` after the `ws-reap` grant) | The grant — two tokens wide, enrolled so it cannot narrow |
| `agent/test/types/bypasses/g13-ws-reclaim-without-expect.ts` | Create | Negative type fixture: the bare `['ws-reclaim']` MUST NOT COMPILE |
| `agent/test/types/ok/legit-whitelist.ts` | Modify | Positive control gains `ReclaimNeedsExpect` |
| `agent/test/whitelist-structural.test.ts` | Modify (`EXPECTED`) | g13's expected TS code |
| `agent/CLAUDE.md` | Modify (the "Gated verbs" bullet) | Names the new gated verb where the rules are read |
| `server/src/ccdargv.ts` | Modify (`deferFlags` beside `decFlags`; `CCD_ARGV.wsReclaimAudit`, `CCD_ARGV.wsReclaim`; `RECLAIM_CAP` directly after the LAST `export const …_CAP = …;` in the file) | The only place these argvs become `CcdArgv`, and the capability token |
| `server/src/remote/runner.ts` | Modify (`CCD_VERB_TIMEOUT_MS`) | `ws-reclaim`'s 240 s remote budget, `ws-reap`'s own |
| `server/src/wsaudit.ts` | Modify (`SENTENCES`) | A sentence for each of the seven new tokens (`not-a-child`, `paused`, `attached`, `tree-busy`, `containment-unproven`, `reap-in-progress`, `reclaim-in-progress`) |
| `server/src/coord/store.ts` | Modify (`MAIL_CHILD_RECLAIMED_ERROR`, `DELIBERATE_CANCEL_ERRORS_SQL`, new `cancelDeliveriesTo`, `programOpenRunCount`'s optional exclusion, `requeueAbandonedMail`'s reader walk) | The delivery cancellation keyed on the recipient, and D-51's predicate with one run set aside |
| `server/src/coord/childReclaim.ts` | Create | Tokens, kinds, parsers, the pure close decision, the ONE executor, the feed row |
| `server/src/coord/close.ts` | Modify | Decide at close (the reviewed run's state read beside the siblings, R16), release rather than hold a child it finished with, hand the act to the port after the commit |
| `server/src/coord/routes.ts` | Modify (`sendCloseOutcome`; the close and abandon routes' `CloseRunDeps`) | Wire the port to the per-session queue, never awaited |
| `ccd/coordinator-skill/SKILL.md` | Modify (clause 3; step 7 — step 6 is NOT touched, R16) | The rewritten clause and the final-merge sentence |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | Modify (§6) | What `childReclaim` means, and what is and is not reclaimed — a review child kept while the run it reviewed is open included |
| `ccd/worker-skill/SKILL.md`, `ccd/reviewer-skill/SKILL.md` | Modify (their reporting sections) | The non-clause sentence: this workspace ends when its run closes |
| `CLAUDE.md` | Modify (SAFETY bullet) | `ws-reclaim` forbidden to every session; server-composed on children only |
| `README.md` | Modify (the "`ws-reap` stays human-only" paragraph; by-content re-points of its `shared/api.ts` anchors in Tasks 1 and 4, and of any `ccd/ccd` anchor S6-R11 names) | The same narrowing, operator-facing |
| `server/test/childReclaimFixture.ts` | Create | The CHILD fixture every ccd child-reclaim suite builds on |
| `server/test/ccd-child-reclaim-ladder.test.ts` | Create | The ladder, rung by rung, and its token |
| `server/test/ccd-child-reclaim-pin.test.ts` | Create | The pin phase and the tombstone, read back from git and from the file |
| `server/test/ccd-child-reclaim-verb.test.ts` | Create | The verb: fresh, resumed, refused, failed, settled |
| `server/test/ccd-child-reclaim-audit.test.ts` | Create | `ws-audit --reclaim`, the caps token, the dispatcher arm |
| `server/test/child-reclaim.test.ts` | Create | The executor, its parsers, its token map against ccd, the pure decision |
| `server/test/child-reclaim-mail-store.test.ts` | Create | `cancelDeliveriesTo` and the program predicate — its own file, because wave 2 already CREATED `server/test/child-reclaim-store.test.ts` for `clearSession` and this wave never overwrites it |
| `server/test/child-reclaim-close.test.ts` | Create | Close decides, releases, and hands off — after the commit, never awaited |
| `server/test/child-reclaim-prose.test.ts` | Create | The CLAUDE.md and README narrowing, pinned |
| `server/test/lifecycle-acts.test.ts`, `single-definition.test.ts`, `lifecycle-vocabulary.test.ts`, `ccd-lifecycle-emit.test.ts` | Modify | The four act cardinals (25→26 twice, 24→25 twice) and `ALL_ACTS`; `single-definition`'s deliberate-cancel pin learns its fourth member (Task 7), in place — that file is cited by the frozen citation corpus, so no task adds a line to it |
| `server/test/lifecycle-refusal-word.test.ts` | Modify | `ALL_TOKENS` gains `pin-failed` and `unit-still-active` (12→14) |
| `server/test/ccd-lifecycle-contain.test.ts`, `lifecycle-wire.test.ts` | Modify | The `meas.` key census moves 29→32 (`childOf`, `wip`, `residueBytes`) with its cause named; the wire's key list and its two `LifecycleMeas` literals learn the three keys |
| `server/test/ccd-reg-get-census.test.ts` | Unchanged — run by Tasks 2, 4, 5 and 11 | The `_reg_get` census sentence this wave's new reads move, re-measured in place (the census tax, Global Constraints) |
| `server/test/ccd-refusal-scan.test.ts` | Modify | `ws-reclaim` joins `VERBS`; seven sanctioned dies (6→13); two new pins |
| `server/test/wsaudit.test.ts` | Modify (the verdict harvest) | `reclaimable` is a success word, like `reapable` |
| `server/test/ccd-archive.test.ts`, `capsupported.test.ts` | Modify | The token's three spellings held equal; its read polarity |
| `server/test/whitelist-subset.test.ts`, `ccdargv-dec-parity.test.ts`, `remote-runner.test.ts`, `verb-gate.test.ts` | Modify | Cross-package grant proof; the real binary parses the dec; the budget; the cap gate (`CAP_GATED_VERBS` and `NEW_GENERATION` gain `ws-reclaim`) |
| `server/test/mail-routes.test.ts` | Modify (the kebab-token scanner) | A TENTH union, `isChildReclaimKebab`, admits this wave's words in `server/src/coord` |
| `server/test/unattended-actor.test.ts` | Modify (`FILES`, `BUILDERS`, `SITES`, the exact count 13→14 — wave 2 already moved it 11→13) | The server's one unattended destructive argv names its actor |
| `server/test/coordinator-skill.test.ts`, `worker-skill.test.ts`, `reviewer-skill.test.ts` | Modify | The clause-3 pin moves; the new sentences are pinned |
| `server/test/run-routes.test.ts`, `coord-abandon.test.ts` | Modify | Three whole-shape `toEqual`s learn the additive fields; the route-level close cases; the abandon arm's "no I/O at all" pin narrows to "no I/O outside the registry" |

---

### Task 1: The `reclaim` journal act, in all seven sites

**Model routing:** `sonnet`, effort `medium` — a vocabulary widening with its four cardinals; the compiler and two set-equality tests do the checking.

**Files:**
- Modify: `shared/api.ts` — the `LifecycleAct` union (the `| 'reap'          // ws-reap` member) and `LIFECYCLE_ACT_MAP`
- Modify: `ccd/ccd` — `_LC_ACTS` (the three-line array under `# THE CLOSED VOCABULARY`, `ccd/ccd:4119-4121` at `f5dc495b`)
- Modify: `pwa/src/session/journalWords.ts` — `ACT_WORD`
- Modify: `README.md` — only the four `shared/api.ts` anchors Step 5 re-points by content
- Modify: `server/test/lifecycle-acts.test.ts` (`ALL_ACTS` and `expect(ACTS.length).toBe(25)`), `server/test/single-definition.test.ts` (`expect(LIFECYCLE_ACTS.length).toBe(25)`), `server/test/lifecycle-vocabulary.test.ts` (the `.toBe(24)` inside `_LC_ACTS is exactly LIFECYCLE_ACTS minus the reader's degrade`), `server/test/ccd-lifecycle-emit.test.ts` (the `.toBe(24)` inside `is set-equal to LIFECYCLE_ACTS minus the degrade name`, plus one new case)

**Interfaces:**
- Consumes: nothing from this wave.
- Produces: `'reclaim'` as a member of `LifecycleAct` and of ccd's `_LC_ACTS`. Tasks 4 and 5 emit `_lc_intent|_lc_done|_lc_fail|_lc_emit reclaim …`; without this task every one of those rows would degrade to `act: 'unknown'` with `badact: 'reclaim'`.

- [ ] **Step 0: Measure the prerequisites (waves 1 and 2) — before any edit**

```bash
grep -n "export const CHILD_ARGV_CAP = 'child-argv-v1'" server/src/ccdargv.ts
grep -n 'echo child-argv-v1' ccd/ccd
grep -n '_reg_set "$id" child' ccd/ccd
grep -n 'export type ChildMark' shared/api.ts
grep -n 'child: ChildMark' server/src/registry.ts
grep -n 'export async function childSpent' server/src/coord/childSpent.ts
grep -n '^_child_runid_valid() { local LC_ALL=C;' ccd/ccd
grep -n "names.includes(\`\${sessionId}.child\`)" server/src/coord/childBind.ts
grep -n 'export const CHILD_RUN_ID = ' shared/api.ts
```

Expected: each command prints at least one line. (The last three are the run-id grammar Task 2 and Task 4 call instead of re-spelling it; wave 2's second listing of an `absent` row, which Task 8's `childReclaimRowListing` mirrors for the executor; and wave 2's server spelling of the same grammar, ten ASCII digits, which Task 8's audit parser reads the audit's `childOf` through — contract §7 R2.) If any prints nothing, STOP: this wave's ladder reads the marker wave 1 writes and its close decision reads wave 2's three-way `ChildMark` and spent verdict. Report which is missing in a structured ask; do not stub it.

Then measure the four cardinals, so the edits below start from the tree and not from this plan:

```bash
grep -n 'ACTS.length).toBe\|LIFECYCLE_ACTS.length).toBe' server/test/lifecycle-acts.test.ts server/test/single-definition.test.ts
grep -n "want.length, 'guards the guard" server/test/lifecycle-vocabulary.test.ts server/test/ccd-lifecycle-emit.test.ts
```

Expected (at `f5dc495b`; waves 1 and 2 add no act): `.toBe(25)` twice and `.toBe(24)` twice. If a later programme moved them, every number below moves by the same amount — the rule is "+1 on each", never the literal.

- [ ] **Step 1: Write the failing tests**

(a) `server/test/lifecycle-acts.test.ts` — add `reclaim: true,` to `ALL_ACTS` directly after `reap: true,`, so the object reads:

```ts
const ALL_ACTS: Record<LifecycleAct, true> = {
  create: true, claim: true, purge: true, supervise: true, unsupervise: true,
  destroy: true, rename: true, hold: true, release: true, archive: true, restore: true,
  'attic-drop': true, reap: true, reclaim: true, rehome: true, gc: true, spawn: true, route: true, start: true, ensure: true,
  swap: true, enable: true, stop: true, forget: true, unarchive: true,
  unknown: true,
};
```

and change `expect(ACTS.length).toBe(25);` to `expect(ACTS.length).toBe(26);`.

(b) `server/test/single-definition.test.ts` — in `it('and the act scan is looking at something — guards the guard'`, change `expect(LIFECYCLE_ACTS.length).toBe(25);` to `expect(LIFECYCLE_ACTS.length).toBe(26);`.

(c) `server/test/lifecycle-vocabulary.test.ts` — the soft length guard becomes:

```ts
    expect.soft(want.length, 'guards the guard: an empty want passes everything (25 = 23 + unarchive, the archive stamp a spawn clears, + reclaim, a child’s pin-then-teardown)').toBe(25);
```

(d) `server/test/ccd-lifecycle-emit.test.ts` — `expect(want.length, 'guards the guard: an empty want passes everything').toBe(24);` becomes `.toBe(25);`, and add this case at the end of `describe('_LC_ACTS / _LC_OUTCOMES — the closed vocabularies, bound to L0'`:

```ts
  it('journals `reclaim` as ITSELF — never the unknown degrade with a badact (child reclamation, wave 3)', () => {
    // The act `ws-reclaim` writes (spec 2026-09-22 §5.9). An act missing from
    // `_LC_ACTS` does not fail: `_lc_emit` maps it to `unknown` and keeps the raw
    // word in `badact`, so every reclaim row would read as "an unmodelled act"
    // while the set-equality case above stayed green on a wrong L0 too.
    h.sh(`${NO_TMUX} _lc_emit reclaim done demo-quiet-basin "" verb ws-reclaim`);
    const ev = readJournal(h.home).filter((e) => e['id'] === 'demo-quiet-basin');
    expect(ev.map((e) => e['act'])).toEqual(['reclaim']);
    expect(ev[0]!['badact']).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts test/single-definition.test.ts test/lifecycle-vocabulary.test.ts test/ccd-lifecycle-emit.test.ts)
```

Expected: FAIL. `lifecycle-acts`: `isLifecycleAct(reclaim)` → `expected false to be true`, and `expected 25 to be 26`. `single-definition`: `expected 25 to be 26`. `lifecycle-vocabulary`: `expected 24 to be 25`. `ccd-lifecycle-emit`: `expected 24 to be 25`, and the new case `expected [ 'unknown' ] to deeply equal [ 'reclaim' ]`.

- [ ] **Step 3: Add the act to its three declaration sites**

`shared/api.ts` — directly after the `| 'reap'          // ws-reap` member of `LifecycleAct`:

```ts
  | 'reclaim'       // ws-reclaim (spec 2026-09-22 §5.9): a CHILD's pin-then-teardown,
                    // server-composed. DISTINCT FROM `reap`: a reap is a human's
                    // confirmed removal of an archived workspace; a reclaim is the
                    // automated end of a workspace dispatch minted for one run. One
                    // act per verb, so the journal never has to be read with a verb
                    // filter to tell the two apart.
```

and in `LIFECYCLE_ACT_MAP`, `'attic-drop': true, reap: true, rehome: true,` becomes `'attic-drop': true, reap: true, reclaim: true, rehome: true,`.

`ccd/ccd` — `_LC_ACTS` stays alphabetical (`reap` < `reclaim` < `rehome`); only its second line changes, so the array keeps its three lines:

```bash
_LC_ACTS=(archive attic-drop claim create destroy enable ensure forget gc
          hold purge reap reclaim rehome release rename restore route spawn start stop
          supervise swap unarchive unsupervise)
```

`pwa/src/session/journalWords.ts` — in `ACT_WORD`, `reap: 'reaped', rehome: 'home account moved',` becomes `reap: 'reaped', reclaim: 'reclaimed', rehome: 'home account moved',`.

- [ ] **Step 4: Re-stamp ccd and run the tests to verify they pass**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
(cd server && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts test/single-definition.test.ts \
  test/lifecycle-vocabulary.test.ts test/ccd-lifecycle-emit.test.ts test/ownership.test.ts test/lifecycle-wire.test.ts)
(cd pwa && ./node_modules/.bin/vitest run test/journal-words.test.ts)
```

Expected: PASS everywhere. `journal-words` iterates `LIFECYCLE_ACTS`, so it now checks `reclaim`'s word too.

- [ ] **Step 5: Pay the citation-corpus tax (S6-R11)**

This task edits one existing line of `ccd/ccd` and adds none — but it INSERTS six lines into `shared/api.ts`, above the purge-token block README cites (`shared/api.ts:7465-7467` for the three `LcRefusalToken` members and `:7505`, `:7513`, `:7526` for their `LC_REFUSAL_WORD` sentences, at `f5dc495b`; wave 2 moves them again). Measured while this plan was written, against `f5dc495b` with only this task's `shared/api.ts` edit applied:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND')
```

Expected: FAIL — `README HAS ITS OWN CENSUS ENTRY` with `a README anchor stopped naming what its own sentence quotes: expected [ 'shared/api.ts:7465-7467', …(3) ] to deeply equal []`. Apply procedure step 2 (README is REPAIRED, never counted): read the new lines off the tree and re-point README's four anchors to them —

```bash
grep -n "^  | 'purge-refused'\|^  | 'purge-mechanism-absent'" shared/api.ts
grep -n "^  'purge-refused':\|^  'purge-incomplete':\|^  'purge-mechanism-absent':" shared/api.ts
grep -n 'shared/api.ts:[0-9]' README.md
```

— the first two lines of output are the new `shared/api.ts:<a>-<b>` range, the next three the new `:<n>` anchors, and the last command finds the one README sentence that holds all four (`purge-mechanism-absent` (`shared/api.ts:…`), each with an operator sentence of its own at `:…`, `:…` and `:…`). Edit only those four numbers. Re-run the command: PASS, all five — measured: the census (`CITATION DEBT`) does not move, because no frozen corpus document cites `shared/api.ts` below its line 5644. If `CITATION DEBT` is red anyway, a `ccd/ccd` byte moved that this task did not mean to move; find it before continuing.

- [ ] **Step 6: Mutation check, then commit**

| # | Edit (restore after) | Command | Expected red |
|---|---|---|---|
| 1 | `ccd/ccd`: delete `reclaim ` from `_LC_ACTS` (re-stamp) | `cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts test/lifecycle-vocabulary.test.ts` | the new case: `expected [ 'unknown' ] to deeply equal [ 'reclaim' ]`; both set-equality cases: `reclaim` missing from ccd's side |
| 2 | `pwa/src/session/journalWords.ts`: delete `reclaim: 'reclaimed', ` | `cd pwa && ./node_modules/.bin/tsc --noEmit` | `TS2741: Property 'reclaim' is missing in type` — the record is total, so a forgotten word does not reach runtime |

Restore both, re-stamp, re-run Step 4's commands (green), then:

```bash
git add shared/api.ts ccd/ccd pwa/src/session/journalWords.ts server/test/lifecycle-acts.test.ts \
  server/test/single-definition.test.ts server/test/lifecycle-vocabulary.test.ts server/test/ccd-lifecycle-emit.test.ts \
  README.md
git commit -m "$(cat <<'MSG'
feat(lifecycle): the reclaim act, in all seven vocabulary sites

A child workspace's pin-then-teardown gets its own journal act rather than
reusing reap's (spec 2026-09-22 §5.9): the union and its total map in
shared/api.ts, ccd's _LC_ACTS, the PWA's ACT_WORD, and the four cardinals
(25 -> 26 twice, 24 -> 25 twice). Without it every ws-reclaim row would
degrade to act:unknown with badact:reclaim. README's four shared/api.ts
anchors re-pointed by content (S6-R11); the census does not move.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The reclaim ladder — `_ws_reclaim_eval`, rung by rung

**Model routing:** **`opus`, effort `high`** — the contract's own row: the ccd ladder is security-sensitive and gates a destructive verb. Every rung decides what the automated path is allowed to delete.

**Files:**
- Create: `server/test/childReclaimFixture.ts` — the CHILD fixture, shared by Tasks 2–5
- Modify: `ccd/ccd` — insert the new `RECLAIM-BEGIN`…`RECLAIM-END` region directly ABOVE the line `# Guard so the script can be \`source\`d by tests without running a command.` (after `cmd_clip`'s closing brace; `ccd/ccd:23092` at `f5dc495b`). Placing the region at the end of the function definitions, not beside `ws-reap`, is deliberate: every line inserted above an anchor is citation debt (S6-R11), and near the end nothing but the dispatcher moves
- Modify: `server/src/wsaudit.ts` — five `SENTENCES` entries, directly above the map's closing `};`
- Test: `server/test/ccd-child-reclaim-ladder.test.ts` (new)

**Interfaces:**
- Consumes: `_ws_reap_reset`, `_reap_refuse`, `_reg_get`, `_tmux`, `_ws_child_op`, `_ws_common_dir`, `_ws_realpath` (the path resolution `_ws_wt_branch` matches a record with — `_ws_reclaim_record` below reads git's record itself, because `_ws_wt_branch`'s exit 1 folds "no record" and "the list failed", and a TERMINAL token may not be answered on the second), `_ws_branch_elsewhere`, `_ws_nested_checkouts` (with `_WS_NESTED_WHY`), `_ws_collect_ignored` (with `REAP_IGNORED`, `REAP_SENSITIVE`, `REAP_IGNDIGEST`, `REAP_IGNREASON`), `_ws_sensitive_match`, `_ws_sensitive_noise`, `_ws_sensitive_vendored`, `_ws_clip_manifest`, `_ws_tomb_str`, `_plat_mktemp`, `_plat_sha256`, `_plat_timeout`, `REAP_SCAN_SECONDS` — all existing, all unchanged. The `.child` marker and `_child_runid_valid` (wave 1 — the run-id grammar under `LC_ALL=C`, used at rung 2 on both arms and, in Task 4, by the `--child-of` parse).
- Produces (bash, inside the region):
  - `_ws_reclaim_reset` — resets every `REAP_*` global plus `RECLAIM_CHILDOF`, `RECLAIM_DEFER`, `RECLAIM_WORKTREE`, `RECLAIM_HEAD`, `RECLAIM_REC_BRANCH`, `RECLAIM_REC_HEAD`, `RECLAIM_STATUSDIGEST`, `RECLAIM_SECRETS[]`, `RECLAIM_STAGE[]`, `RECLAIM_NESTED`, `RECLAIM_FOREIGN`, `RECLAIM_STASHES`, `RECLAIM_OPHEADS`, `RECLAIM_WIP`, `RECLAIM_WIP_SHA`, `RECLAIM_WIP_WHY`, `RECLAIM_PIN_WHY`, `_WS_RECLAIM_CLASSIFY_WHY`.
  - `_ws_reclaim_eval <id> <defer 0|1> <childof|''>` → rc 0 with `REAP_VERDICT=reclaimable`, `REAP_TOKEN` (64 hex) and `RECLAIM_WORKTREE` (`present`, or `absent` for a vanished worktree — below); rc 1 with `REAP_VERDICT` ∈ {`no-such-session`, `not-a-workspace`, `not-a-child`, `paused`, `held`, `attached`, `tree-busy`, `branch-elsewhere`, `tree-unreadable`, `containment-unproven`, `no-worktree-record`} and `REAP_DETAIL`; or rc 1 with `REAP_VERDICT=unmeasured` — NOT a token, never a refusal — when a probe could not RUN (the permission pass's timeout or failure to start, rung 6's operation probe, a repository that could not be resolved, a worktree list that could not be READ, the nested-checkout scan, a scratch file, the stash list, the clips listing) or the registry row does not say what the child is (a row missing `project`/`workdir`/`branch`; on resume, an unreadable tombstone), set by `_ws_reclaim_unmeasured` — contract §7 R11. **A `workdir` that is GONE is none of these** (contract §8 R19): with no breadcrumb, `_ws_reclaim_eval_absent` answers `reclaimable` over what is left and sets `RECLAIM_WORKTREE=absent`. **A `workdir` that EXISTS but that git does not record as `$main`'s worktree is `no-worktree-record`, TERMINAL** (R19; the token is reused from `ws-reap`, and its sentence is already true of a child). Also sets `REAP_BRANCH`, `REAP_REGBRANCH`, `REAP_WTHEAD`, `REAP_DRIFT`, `REAP_TIP`, `REAP_STASHES`, `REAP_SENSITIVE` (every secret-shaped path) — the globals `cmd_ws_audit` prints — `RECLAIM_HEAD` (the tree's HEAD, or, on the vanished arm, the HEAD git's record still names), and `RECLAIM_NESTED`/`RECLAIM_FOREIGN`, which Task 3's tombstone reads.
  - `_ws_reclaim_eval_absent <id> <workdir> <main> <regbranch>` → the vanished-worktree arm, called ONLY from `_ws_reclaim_eval` after rungs 1–5: rung 7 and rung 8's pass over the clips directory are asked; rung 6, rung 8's pass over the tree and rung 9 have no tree to ask about. Its token is a fingerprint whose inputs include `worktree=absent`, so a token minted over the tree can never be spent on its absence, or the other way round.
  - `_ws_reclaim_record <main> <path>` → git's worktree record for `path`, read from `$main` ONCE: rc 0 with `RECLAIM_REC_BRANCH` (`''` = detached) and `RECLAIM_REC_HEAD`; rc 1 = `$main` records no worktree there; rc 2 = the list could not be read — never folded into rc 1.
  - `_ws_reclaim_resume_eval <id> <defer> <childof|''> <phase>` → the RESUME token over `mode=reclaim-resume` (Task 4's resumed arm, Task 5's audit).
  - `_ws_reclaim_unmeasured <detail>` (the not-a-refusal answer above); `_ws_reclaim_normalise <dir>` (with `_WS_NORMALISE_WHY`; rc 1 = still unreadable after the pass, rc 2 = the pass could not run), `_ws_reclaim_secret_path <relpath>`, `_ws_reclaim_classify <dir> <prefix>`, `_ws_reclaim_stash_shas <main> <branch>`, `_ws_reclaim_fingerprint <key=value>...`.
- Produces (TS): `server/test/childReclaimFixture.ts` exports `CHILD_ID = 'demo-quiet-basin'`, `CHILD_RUN = 7`, `CHILD_BRANCH = 'ws/quiet-basin'`, `CHILD_STUBS`, `CHILD_ENV`, `makeChild(h)`, `evalOf(h, opts)`.

**Rung 2 reads, rung 2 never infers.** The only source of child-ness on the box is `_reg_get "$id" child`, judged by wave 1's `_child_runid_valid` — the SAME function wave 1's `--child` parse uses when it writes the marker, so the grammar (`^[1-9][0-9]{0,9}$` under a shadowed `LC_ALL=C`) has one definition. Never re-spell the bare `=~`: wave 1 measured it accepting `²`, `1²`, `٣`, `½`, `१` under `LC_ALL=en_US.UTF-8`. All three wave-3 sites use it — rung 2 on the fresh arm, rung 2 on the resume arm, and `cmd_ws_reclaim`'s `--child-of` parse. An absent, unreadable, malformed or unequal marker is `not-a-child`, terminal, and nothing below the rung is ever reached. The audit calls the ladder with `childof ''` because the audit is not told the run; the verb (Task 4) calls it with `--child-of`, which is what makes rung 2 the two-authority check.

**Identity failures are NOT `tree-unreadable` (contract §7 R11, ruled: `tree-unreadable` means ONLY "unreadable after the permission pass"), and the two that describe the TREE have their own answers (contract §8 R19, ruled).** Four identity facts can fail, and each answers in its own word:

- **A registry row missing `project`/`workdir`/`branch`**, and — on the resumed arm — **a tombstone whose branch cannot be read**: no rung proved anything, so each answers `_ws_reclaim_unmeasured` with a detail naming the fact — R11's `failed` document (`probe-unmeasured`, exit 1): nothing is destroyed, the executor reads `failed`, and wave 4's sweep retries it.
- **A `workdir` that is GONE, with no breadcrumb** (the fresh arm — the resume arm has its own ladder and never asks): NOT a refusal and NOT unmeasured. Nothing on disk could hold unseen work any more, and retrying could never succeed (it would write a feed row every time it failed), so `_ws_reclaim_eval_absent` answers `reclaimable` over what IS left: the branch tip, the stashes attributed to the branch, git's record of the worktree if it still holds one (`prunable`), and the clips. The verb pins those, writes a tombstone saying `worktree: absent`, and runs its tail from the branch CAS on (Task 4). "Gone" means NOTHING stands at the path (`! -e` and `! -L`); something there that is not a directory is unmeasured, never read as absence.
- **A `workdir` that EXISTS but that git does not record as `$main`'s worktree**: `no-worktree-record`, TERMINAL. ccd cannot tell what it would be deleting there, so it deletes nothing and the refusal is reported. The token is reused from `ws-reap`, whose `SENTENCES` entry — "git has no record of this directory as a worktree of this project, so nothing here is ccrc's to remove." — is already true of a child and asks nothing of anyone. It is asked BEFORE rung 6, because rung 6's probe reads git inside the directory and fails on exactly this shape (an admin directory removed by hand leaves every read of the tree failing `not a git repository`), which would fold the terminal fact into a retried one. And it is decided on git's record read with its own three answers (`_ws_reclaim_record`): a worktree list that could not be READ is unmeasured, never "no record".

A workdir that belongs to ANOTHER repository stays `containment-unproven` (rung 9's question, asked of the child itself — a PROVEN fact, not a missing one), and is asked before the record, so that shape keeps its own word. A detached HEAD is not a refusal: the WIP commit lands on HEAD, the pin phase pins it by sha, and the branch removed is the one the registry names.

**A probe that could not RUN folds into NO token.** Contract §3 classes `tree-unreadable` as terminal for a tree that cannot be read *after* the permission-normalisation pass — not for a probe that never ran. A terminal refusal is never retried (wave 4's sweep skips a child already on the attention list; the close trigger fires once), so folding a transient condition into it would strand a child on one box hiccup, with only a human able to clear it (rules 1 and 4). So the permission pass running out of time or unable to start (`_ws_reclaim_normalise` rc 2), rung 6's operation probe failing, an unreadable stash list and an unlistable clips manifest answer `_ws_reclaim_unmeasured` — `REAP_VERDICT=unmeasured`, not one of the fourteen tokens and never a refusal: `ws-audit --reclaim` prints its reclaim document with `"verdict":"unmeasured"` and exits 1 on it (Task 5; contract §8 R11′) and `ws-reclaim` prints `{"failed":"probe-unmeasured",…}` at exit 1 (Task 4), both of which the executor reads as `{ kind: 'failed' }` — it maps ANY audit exit 1 to `failed` (Task 8) — and the sweep retries. The same arm answers a repository that could not be resolved, a worktree list that could not be read (git's record of the child's own workdir, `_ws_reclaim_record` rc 2, and rung 7's enumeration), a failed nested-checkout scan and a scratch file that could not be made (`_ws_reclaim_classify` now answers rc 2 for that, and rung 8 reads rc 2 as unmeasured). `tree-unreadable` keeps ONLY what really is unreadable after the pass (R11): an entry still unreadable after it, and a `git status` or ignored-set read that errs on the normalised tree.

- [ ] **Step 1: Write the fixture**

Create `server/test/childReclaimFixture.ts`:

```ts
// The CHILD every ccd child-reclaim suite builds on (spec 2026-09-22 §4): a
// real repository with a GitHub-shaped origin (`makeGhRepo`), a workspace
// minted through the REAL `cmd_ws_add --child 7` — wave 1's flag, so the
// `.child` marker is written by the code that ships, never planted — and two
// commits on its branch. Never archived: a child never is, which is the whole
// reason `ccd-ws-reap.test.ts`'s `ready()` cannot be reused here.
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the single isolation boundary,
// and the verb this programme adds is destructive, so the rule is absolute:
// `CHILD_STUBS` records the unit and pane calls instead of making them, and
// `CHILD_ENV` points the residue probe at a directory inside that HOME.
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import type { PrHarness } from './ccdPrHelpers.js';

export const CHILD_ID = 'demo-quiet-basin';
export const CHILD_RUN = 7;
export const CHILD_BRANCH = 'ws/quiet-basin';

/** `_ws_unsupervise` and `tmux` RECORD to `$HOME/ccd-calls` and act on
 *  nothing. `tmux` answers 1 to every verb, `has-session` included, so rung 5
 *  sees no session and therefore no attached client; a case that needs a live
 *  session redefines `tmux` AFTER this string. `_svc_is_active` answers
 *  `inactive` — what systemd prints once the unit is disabled and stopped —
 *  because the harness's `systemctl` poison prints NOTHING, and Task 4's tail
 *  reads an empty answer as "unmeasured", which fails shut; a case that needs
 *  a unit that stayed up redefines it AFTER this string. */
export const CHILD_STUBS =
  '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; };'
  + ' tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };'
  + ' _svc_is_active() { printf inactive; };';

/** The residue probe's root, INSIDE the fixture HOME — never the real
 *  `/tmp/claude-<uid>`. Prefixed onto every call that can reach the probe. */
export const CHILD_ENV = 'CCD_RECLAIM_RESIDUE_ROOT="$HOME/residue"';

export interface Child { main: string; wt: string; tip: string }

export function makeChild(h: PrHarness): Child {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add --child ${CHILD_RUN} demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`);
    h.git(wt, 'commit', '-m', `work ${n}`);
  }
  return { main, wt, tip: h.git(wt, 'rev-parse', 'HEAD') };
}

/** A UTF-8 locale on this box in which bash's `[1-9]` range admits `²` — found
 *  by MEASURING that property through the harness's own contained shell (wave
 *  1's rule: never by name; `C.utf8` collates by codepoint and could not show
 *  the defect), or '' when the box has none. Assigning `LC_ALL` in bash takes
 *  effect at once, so the subshell measures exactly what a `pre` of
 *  `LC_ALL=<loc>;` will do to the sourced ladder. */
export function wideDigitLocale(h: PrHarness): string {
  return h.sh(`for l in $(locale -a 2>/dev/null | grep -iE 'utf-?8$'); do`
    + ` ( LC_ALL=$l; [[ "²" =~ ^[1-9]$ ]] ) 2>/dev/null && { printf '%s' "$l"; break; }; done; true`);
}

export interface LadderAnswer { verdict: string; token: string; detail: string }

/** `_ws_reclaim_eval`'s own answer, read off the globals it sets. `childOf` ''
 *  is the audit's call (the marker checked, not compared); a run id is the
 *  verb's. `pre` runs after the stubs, so a case can redefine `tmux`. */
export function evalOf(
  h: PrHarness, opts: { defer?: 0 | 1; childOf?: string; pre?: string } = {},
): LadderAnswer {
  const out = h.sh(`${CHILD_STUBS} ${opts.pre ?? ''} _ws_reclaim_eval ${CHILD_ID} ${opts.defer ?? 0}`
    + ` '${opts.childOf ?? ''}' >/dev/null; printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
}
```

- [ ] **Step 2: Write the failing test**

Create `server/test/ccd-child-reclaim-ladder.test.ts`:

```ts
// `_ws_reclaim_eval` — the reclaim ladder, rung by rung (spec 2026-09-22 §5.5).
// Called directly: the verb that consumes it lands in Task 4 and the audit that
// prints it in Task 5, and neither can be more right than this function is.
//
// The ORDER is part of the spec (§5.5's table): rung 2 (`not-a-child`)
// outranks every retryable rung, so a workspace nobody marked never reads as
// "try again".
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { itLinux } from './platformFixtures.js';
import { CCD } from './ccdWsHelpers.js';
import { CHILD_BRANCH, CHILD_ID, CHILD_STUBS, evalOf, makeChild, wideDigitLocale } from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-ladder-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.${field}`);
const calls = (): string[] => h.calls();
const resetCalls = (): void => { fs.rmSync(path.join(h.home, 'ccd-calls'), { force: true }); };
/** A live session with one attached client. */
const ATTACHED = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; list-clients) echo /dev/pts/3 ;; *) return 1 ;; esac; };';
/** A live session that will not list its clients. */
const UNLISTABLE = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; *) return 1 ;; esac; };';

describe('a finished child passes, and its token is a fingerprint', () => {
  it('answers reclaimable with a 64-hex token, stable across two reads of an unchanged child', () => {
    makeChild(h);
    const a = evalOf(h);
    const b = evalOf(h);
    expect(a.verdict, a.detail).toBe('reclaimable');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.token).toBe(a.token);
  }, 60_000);

  it('moves the token when a fingerprinted fact moves — defer, a file, a stash, a clip, the marker', () => {
    const { wt } = makeChild(h);
    const base = evalOf(h).token;
    expect(evalOf(h, { defer: 1 }).token, '--defer-expired is an INPUT, so a token minted without it cannot be spent with it')
      .not.toBe(base);
    fs.appendFileSync(path.join(wt, 'f1.txt'), 'stashed\n');
    h.git(wt, 'stash', 'push', '-m', 'kept');
    const withStash = evalOf(h).token;
    expect(withStash, 'the stash list is an input (the tree is clean again)').not.toBe(base);
    fs.writeFileSync(path.join(wt, 'late.txt'), 'late\n');
    const withFile = evalOf(h).token;
    expect(withFile, 'the status digest is an input').not.toBe(withStash);
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    const withClip = evalOf(h).token;
    expect(withClip, 'the clips manifest is an input').not.toBe(withFile);
    fs.writeFileSync(reg('child'), '8');
    expect(evalOf(h).token, 'the marker itself is an input').not.toBe(withClip);
  }, 90_000);
});

describe('rungs 1 and 2 — identity, and the two authorities', () => {
  it('refuses no-such-session when there is no registry row', () => {
    expect(evalOf(h).verdict).toBe('no-such-session');
  });

  it('refuses not-a-workspace for a main checkout', () => {
    h.sh(`_reg_set ${CHILD_ID} uuid u-1; _reg_set ${CHILD_ID} child 7`);
    expect(evalOf(h).verdict).toBe('not-a-workspace');
  });

  it('refuses not-a-child with no marker, an unreadable one, a malformed one, and one naming another run', () => {
    makeChild(h);
    expect(h.reg(CHILD_ID, 'child'), 'wave 1 wrote the marker through the real ws-add').toBe('7');
    expect(evalOf(h, { childOf: '8' }).verdict, 'the two authorities disagree').toBe('not-a-child');
    expect(evalOf(h, { childOf: '7' }).verdict, 'the two authorities agree').toBe('reclaimable');
    for (const bad of ['seven', '0', '07', '7 ', '12345678901', '']) {
      fs.writeFileSync(reg('child'), bad);
      expect(evalOf(h).verdict, `marker ${JSON.stringify(bad)}`).toBe('not-a-child');
    }
    fs.rmSync(reg('child'));
    expect(evalOf(h).verdict, 'no marker').toBe('not-a-child');
  }, 60_000);

  itLinux('refuses not-a-child when the marker is present but unreadable', () => {
    makeChild(h);
    fs.chmodSync(reg('child'), 0o000);
    try { expect(evalOf(h).verdict).toBe('not-a-child'); } finally { fs.chmodSync(reg('child'), 0o644); }
  }, 60_000);

  it('ranks not-a-child ABOVE every retryable rung — paused, held and attached do not make it "try again"', () => {
    makeChild(h);
    fs.rmSync(reg('child'));
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    fs.writeFileSync(reg('hold'), 'program:x wave:2/3');
    expect(evalOf(h, { pre: ATTACHED }).verdict).toBe('not-a-child');
  }, 60_000);

  it('refuses not-a-child for a marker only a locale-widened range admits — rung 2 is wave 1’s `_child_runid_valid`, on BOTH arms', (ctx) => {
    // Wave 1 measured the bare `=~ ^[1-9][0-9]{0,9}$` ACCEPTING `1²` under
    // `en_US.UTF-8`; `_child_runid_valid` shadows `LC_ALL=C`. A rung that
    // re-spelled the bare pattern would pass this marker — and with the verb's
    // `--child-of '1²'`, the "two authorities" would agree on a non-id.
    makeChild(h);
    const loc = wideDigitLocale(h);
    if (loc === '') { ctx.skip(); return; }
    fs.writeFileSync(reg('child'), '1²');
    const pre = `LC_ALL=${loc};`;
    expect(evalOf(h, { pre }).verdict, 'fresh arm, the audit form').toBe('not-a-child');
    expect(evalOf(h, { pre, childOf: '1²' }).verdict, 'fresh arm, both sides spelling the same non-id').toBe('not-a-child');
    expect(h.sh(`${CHILD_STUBS} ${pre} _ws_reclaim_resume_eval ${CHILD_ID} 0 '' children >/dev/null;`
      + ` printf '%s' "$REAP_VERDICT"`), 'the resume arm').toBe('not-a-child');
  }, 60_000);
});

describe('rungs 3 to 6 — the retryable ones', () => {
  it('refuses paused while the kill-switch exists — a file, or even a directory', () => {
    makeChild(h);
    const pause = path.join(h.home, '.cc-sessions', 'reclaim-paused');
    fs.writeFileSync(pause, '');
    expect(evalOf(h).verdict).toBe('paused');
    fs.rmSync(pause);
    fs.mkdirSync(pause);
    expect(evalOf(h).verdict, '-e, not -f').toBe('paused');
  }, 60_000);

  it('refuses held on a hold, and on an unreadable hold', () => {
    makeChild(h);
    fs.writeFileSync(reg('hold'), 'program:x wave:2/3');
    const held = evalOf(h);
    expect(held.verdict).toBe('held');
    expect(held.detail).toContain('program:x wave:2/3');
  }, 60_000);

  itLinux('treats an unreadable hold as held', () => {
    makeChild(h);
    fs.writeFileSync(reg('hold'), 'x');
    fs.chmodSync(reg('hold'), 0o000);
    try {
      const held = evalOf(h);
      expect(held.verdict).toBe('held');
      expect(held.detail).toContain('<unreadable — treat as held>');
    } finally { fs.chmodSync(reg('hold'), 0o644); }
  }, 60_000);

  it('refuses attached on a client, on an unlistable session, and asks through an ANCHORED target', () => {
    makeChild(h);
    resetCalls();
    expect(evalOf(h, { pre: ATTACHED }).verdict).toBe('attached');
    // `=` anchors the target: a bare `cc-<id>` is an fnmatch pattern that
    // resolves a prefix to a DIFFERENT session (D-2780).
    expect(calls()).toContain(`tmux has-session -t =cc-${CHILD_ID}`);
    expect(calls()).toContain(`tmux list-clients -t =cc-${CHILD_ID} -F #{client_tty}`);
    expect(calls().some((c) => / -t cc-/.test(c)), 'no unanchored target').toBe(false);
    expect(evalOf(h, { pre: UNLISTABLE }).verdict, 'presence unmeasured is not absence').toBe('attached');
  }, 60_000);

  it('refuses tree-busy while an operation is in progress in the child’s own tree', () => {
    const { wt, main } = makeChild(h);
    const mergeHead = h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD');
    fs.writeFileSync(mergeHead, `${h.git(main, 'rev-parse', 'HEAD')}\n`);
    const busy = evalOf(h);
    expect(busy.verdict).toBe('tree-busy');
    expect(busy.detail).toContain('merge in progress');
  }, 60_000);

  it('--defer-expired skips rungs 5 and 6 and NOTHING else', () => {
    const { wt, main } = makeChild(h);
    const mergeHead = h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD');
    fs.writeFileSync(mergeHead, `${h.git(main, 'rev-parse', 'HEAD')}\n`);
    resetCalls();
    expect(evalOf(h, { defer: 1, pre: ATTACHED }).verdict).toBe('reclaimable');
    expect(calls().filter((c) => c.includes('list-clients')), 'rung 5 was not even asked').toEqual([]);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(evalOf(h, { defer: 1 }).verdict, 'the pause is NOT a presence rung').toBe('paused');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'));
    fs.writeFileSync(reg('hold'), 'x');
    expect(evalOf(h, { defer: 1 }).verdict, 'nor is the hold').toBe('held');
  }, 90_000);
});

describe('rung 7 — branch-elsewhere', () => {
  it('refuses when another worktree stands on the branch the tail would delete', () => {
    const { wt, main } = makeChild(h);
    h.git(wt, 'checkout', '--detach');
    h.git(main, 'worktree', 'add', path.join(h.home, 'elsewhere'), CHILD_BRANCH);
    const r = evalOf(h);
    expect(r.verdict).toBe('branch-elsewhere');
    expect(r.detail).toContain(path.join(h.home, 'elsewhere'));
  }, 60_000);
});

describe('rung 8 — the tree reads, after the permission pass', () => {
  itLinux('normalises a mode-000 directory it owns, then reads it — the owner bits and nothing else', () => {
    const { wt } = makeChild(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(path.join(a, 'b'), { recursive: true });
    fs.writeFileSync(path.join(a, 'b', 'hidden.txt'), 'work nobody could see');
    fs.chmodSync(path.join(a, 'b'), 0o000);
    fs.chmodSync(a, 0o000);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('reclaimable');
      expect(fs.statSync(a).mode & 0o700).toBe(0o700);
      expect(fs.statSync(a).mode & 0o077, 'group and other bits untouched').toBe(0);
    } finally {
      fs.chmodSync(a, 0o755); fs.chmodSync(path.join(a, 'b'), 0o755);
    }
  }, 60_000);

  itLinux('refuses tree-unreadable when the pass cannot fix the tree', () => {
    const { wt } = makeChild(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, 'hidden.txt'), 'x');
    fs.chmodSync(a, 0o000);
    // A chmod that exits 0 and changes nothing — the shape of an entry another
    // uid owns, which this uid cannot fix. `find -exec` resolves chmod on PATH.
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'chmod'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    try {
      const r = evalOf(h, { pre: `PATH="${shim}:$PATH";` });
      expect(r.verdict).toBe('tree-unreadable');
      expect(r.detail).toContain(wt);
    } finally { fs.chmodSync(a, 0o755); }
  }, 60_000);

  it('answers unmeasured — NEVER tree-unreadable — for a row that does not say where the tree is', () => {
    // Spec §5.5, rung 8: `tree-unreadable` is a tree still unreadable after
    // the permission pass. A row with no workdir never reached the pass.
    makeChild(h);
    fs.rmSync(reg('workdir'));
    const noRow = evalOf(h);
    expect(noRow.verdict, noRow.detail).toBe('unmeasured');
    expect(noRow.token).toBe('');
  }, 60_000);
});

describe('a vanished worktree is reclaimed; a directory git does not record is refused (spec §5.5)', () => {
  it('a child whose worktree directory is GONE is reclaimable over what is left — never unmeasured, and its own token', () => {
    // "A vanished worktree is not a refusal": nothing on disk can hold unseen
    // work any more, and a retry could never succeed.
    const { wt } = makeChild(h);
    const present = evalOf(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const gone = evalOf(h);
    expect(gone.verdict, gone.detail).toBe('reclaimable');
    expect(gone.token).toMatch(/^[0-9a-f]{64}$/);
    expect(gone.token, 'a token minted over the tree can never be spent on its absence').not.toBe(present.token);
    expect(h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s' "$RECLAIM_WORKTREE"`))
      .toBe('absent');
  }, 60_000);

  it('the vanished arm still asks rungs 2, 4, 5 and 7 — nothing that guards the branch is skipped', () => {
    const { wt, main } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    expect(evalOf(h, { childOf: '8' }).verdict, 'rung 2').toBe('not-a-child');
    expect(evalOf(h, { pre: ATTACHED }).verdict, 'rung 5').toBe('attached');
    fs.writeFileSync(reg('hold'), 'x');
    expect(evalOf(h).verdict, 'rung 4').toBe('held');
    fs.rmSync(reg('hold'));
    // Rung 7: git's own stale record of the vanished tree is pruned (fixture
    // repository only) so ANOTHER worktree can take the branch the tail would
    // delete — the shape the CAS alone would not notice.
    h.git(main, 'worktree', 'prune');
    h.git(main, 'worktree', 'add', path.join(h.home, 'elsewhere'), CHILD_BRANCH);
    const r = evalOf(h);
    expect(r.verdict, 'rung 7').toBe('branch-elsewhere');
    expect(r.detail).toContain(path.join(h.home, 'elsewhere'));
  }, 90_000);

  it('refuses no-worktree-record — TERMINAL — for a directory that EXISTS but git does not record, before any probe reads it', () => {
    const { wt, main } = makeChild(h);
    // `ccd-ws-audit.test.ts`'s own no-record shape: removing `$main/.git/
    // worktrees/<slug>` leaves the directory and the branch intact while every
    // read of the directory fails `not a git repository` — which is also why
    // the record is asked before rung 6, whose probe reads git in the tree.
    const admin = path.join(main, '.git', 'worktrees', 'quiet-basin');
    expect(fs.existsSync(admin), 'the CONTROL: git names the admin directory after the worktree basename').toBe(true);
    fs.rmSync(admin, { recursive: true, force: true });
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    expect(r.token).toBe('');
    // …and a plain directory standing where the worktree was: the same answer.
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    expect(evalOf(h).verdict).toBe('no-worktree-record');
  }, 60_000);
});

describe('a probe that could not RUN is `unmeasured` — never a token, never terminal', () => {
  // Spec §5.5, rung 8: `tree-unreadable` is terminal for a tree unreadable
  // AFTER the permission pass. A probe that never ran measured nothing; a
  // terminal word for it would never be retried (wave 4's sweep skips the
  // attention list).
  it.each([
    ['rung 6: the operation probe failed', '_ws_child_op() { return 1; };'],
    ['rung 8: the permission pass ran out of time', '_plat_timeout() { return 124; };'],
    ['the stash list could not be read', '_ws_reclaim_stash_shas() { return 1; };'],
    ['the clips manifest could not be listed', '_ws_clip_manifest() { return 1; };'],
    // The identity probes too — each was a `tree-unreadable` fold once.
    ['the repository could not be resolved', '_ws_common_dir() { return 1; };'],
    ['the worktree list could not be enumerated', '_ws_branch_elsewhere() { return 1; };'],
    // git's record of the child's OWN workdir, when the list itself fails:
    // unmeasured, never the terminal `no-worktree-record` (a list that could
    // not be read is not "no record").
    ['git’s worktree list could not be read — never "no record"',
      'git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };'],
    // …and a directory git DOES record that resolves to no repository (its
    // `.git` gone): the record says it is ours, the tree cannot say so.
    ['a recorded worktree whose directory resolves to no repository',
      '_ws_common_dir() { case "$1" in */worktrees/demo/quiet-basin) return 1 ;; esac; git -C "$1" rev-parse --path-format=absolute --git-common-dir; };'],
    ['the nested-checkout scan could not run', '_ws_nested_checkouts() { return 1; };'],
  ])('%s → unmeasured, no token', (_what, pre) => {
    makeChild(h);
    const r = evalOf(h, { pre });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);

  itLinux('a tree STILL unreadable after the pass keeps the terminal word — the pass RAN', () => {
    // The `refuses tree-unreadable when the pass cannot fix the tree` case
    // above, restated as the control for this describe: rc 1 is not rc 2.
    const { wt } = makeChild(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(a);
    fs.chmodSync(a, 0o000);
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'chmod'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    try { expect(evalOf(h, { pre: `PATH="${shim}:$PATH";` }).verdict).toBe('tree-unreadable'); }
    finally { fs.chmodSync(a, 0o755); }
  }, 60_000);
});

describe('rung 9 — containment', () => {
  it('refuses a nested checkout of ANOTHER repository that holds a commit on none of its remotes', () => {
    const { wt } = makeChild(h);
    const nested = path.join(wt, 'vendor', 'lib');
    fs.mkdirSync(nested, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', nested]);
    fs.writeFileSync(path.join(nested, 'x'), 'x');
    h.git(nested, 'add', 'x');
    h.git(nested, 'commit', '-m', 'local only');
    const r = evalOf(h);
    expect(r.verdict).toBe('containment-unproven');
    expect(r.detail).toContain('on none of its remotes');
  }, 60_000);

  it('refuses a DIRTY nested checkout of another repository, and passes a clean, pushed one', () => {
    const { wt } = makeChild(h);
    const origin = path.join(h.home, 'origins', 'other.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    const seedRepo = path.join(h.home, 'seed-other');
    execFileSync('git', ['init', '-q', '-b', 'main', seedRepo]);
    fs.writeFileSync(path.join(seedRepo, 'r'), 'r');
    h.git(seedRepo, 'add', 'r'); h.git(seedRepo, 'commit', '-m', 'r');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    execFileSync('git', ['clone', '-q', origin, clone]);
    expect(evalOf(h).verdict, 'clean and pushed: nothing of it is lost').toBe('reclaimable');
    fs.writeFileSync(path.join(clone, 'dirty'), 'd');
    expect(evalOf(h).verdict).toBe('containment-unproven');
  }, 60_000);

  it('NEVER refuses a nested checkout of the child’s OWN repository, dirty or not — it is pinned', () => {
    const { wt, main } = makeChild(h);
    h.git(main, 'worktree', 'add', '-b', 'ws/nested', path.join(wt, 'inner'));
    fs.writeFileSync(path.join(wt, 'inner', 'dirty.txt'), 'dirty');
    expect(evalOf(h).verdict).toBe('reclaimable');
    expect(h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s' "$RECLAIM_NESTED"`))
      .toContain(path.join(wt, 'inner'));
  }, 60_000);

  it('refuses containment-unproven when the child’s own workdir is a worktree of ANOTHER repository', () => {
    makeChild(h);
    const other = h.makeRepo('other');
    const alien = path.join(h.home, 'alien');
    h.git(other, 'worktree', 'add', '-b', 'ws/alien', alien);
    fs.writeFileSync(reg('workdir'), alien);
    expect(evalOf(h).verdict).toBe('containment-unproven');
  }, 60_000);
});

describe('the classifier the pin phase stages through', () => {
  it('drops every secret-shaped path, untracked or ignored — by ANY path component, not the basename alone', () => {
    const { wt } = makeChild(h);
    fs.writeFileSync(path.join(wt, '.gitignore'), '.env.local\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore');
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET=1');
    fs.mkdirSync(path.join(wt, 'secrets'));
    fs.writeFileSync(path.join(wt, 'secrets', 'token.txt'), 't');
    fs.writeFileSync(path.join(wt, '.env.local'), 'SECRET=2');
    fs.writeFileSync(path.join(wt, '.env.example'), 'SECRET=');
    fs.writeFileSync(path.join(wt, 'notes.txt'), 'n');
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null;`
      + ` printf 'S:%s\\n' "\${RECLAIM_SECRETS[@]}"; printf 'T:%s\\n' "\${RECLAIM_STAGE[@]}"`);
    const secrets = out.split('\n').filter((l) => l.startsWith('S:')).map((l) => l.slice(2)).sort();
    const stage = out.split('\n').filter((l) => l.startsWith('T:')).map((l) => l.slice(2)).sort();
    expect(secrets).toEqual(['.env', '.env.local', 'secrets/token.txt']);
    expect(stage).toEqual(['.env.example', 'notes.txt']);
  }, 60_000);
});

describe('stash attribution — one rule in two copies, held equal', () => {
  it('_ws_reclaim_stash_shas lists exactly as many stashes as _ws_stash_count counts, named and anonymous', () => {
    const { wt, main } = makeChild(h);
    fs.appendFileSync(path.join(wt, 'f1.txt'), 'named\n');
    h.git(wt, 'stash', 'push', '-m', 'named');
    h.git(wt, 'checkout', '--detach');
    fs.appendFileSync(path.join(wt, 'f2.txt'), 'anon\n');
    h.git(wt, 'stash', 'push', '-m', 'anon');
    h.git(wt, 'checkout', CHILD_BRANCH);
    const [shas, count] = h.sh(`printf '%s|%s' "$(_ws_reclaim_stash_shas "${main}" ${CHILD_BRANCH} | grep -c .)"`
      + ` "$(_ws_stash_count "${main}" ${CHILD_BRANCH})"`).split('|');
    expect(count).toBe('2');
    expect(shas).toBe(count);
  }, 60_000);
});

describe('the region', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  it('is bracketed by its two markers, once each, and its CODE never calls reap’s ladder or tail', () => {
    expect(src.split('RECLAIM-BEGIN').length - 1).toBe(1);
    expect(src.split('RECLAIM-END').length - 1).toBe(1);
    const region = src.slice(src.indexOf('RECLAIM-BEGIN'), src.indexOf('RECLAIM-END'));
    // Comment lines are dropped first: the region's comments NAME reap's
    // functions to say why they are not used, and that is not a call.
    const code = region.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code.length, 'the region has code in it').toBeGreaterThan(5000);
    // They accept OPPOSITE evidence (spec §5.5): a reclaim that consulted
    // `_ws_reap_eval` would refuse every dirty child the ruling says to pin.
    expect(code).not.toMatch(/_ws_reap_eval\b/);
    expect(code).not.toMatch(/_ws_reap_tail\b/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts)
```

Expected: FAIL. Every `evalOf` case reads an empty verdict (`bash: _ws_reclaim_eval: command not found`, and the trailing `printf` of empty globals), so each `toBe('…')` fails with `expected '' to be '…'`; the stash case fails its first `grep -c` on `_ws_reclaim_stash_shas: command not found`; `the region` fails with `expected 0 to be 1`.

- [ ] **Step 4: Write the ladder**

Insert the following directly ABOVE `# Guard so the script can be \`source\`d by tests without running a command.` in `ccd/ccd`, leaving one blank line before it:

```bash
# ── child reclamation: ws-reclaim (spec 2026-09-22 §5.5-§5.6) ──────────── RECLAIM-BEGIN ──
# A CHILD is a workspace dispatch minted for a run and marked `$REG/<id>.child`
# at creation (`ws-add --child <runId>`). It is reclaimed — pinned, then torn
# down — by `ws-reclaim`, and by nothing else. This region is that verb's whole
# machinery, and it is deliberately NOT `ws-reap` with a flag: the two accept
# OPPOSITE evidence (reap refuses dirty-tree and sensitive-ignored; reclaim
# pins through both), and a ladder that asks "which caller am I serving" at
# every rung is how a refusal becomes an override (spec §5.5).
#
# THE VOCABULARY IS CLOSED AT FOURTEEN TOKENS, and every one of them is written
# in a shape `server/test/wsaudit.test.ts` harvests — `_reap_refuse <token>` or
# a literal `"refused":"<token>"` — so SENTENCES stays set-equal to what ccd can
# say. `server/test/child-reclaim.test.ts` holds the same fourteen equal to
# `CHILD_RECLAIM_TOKEN_KIND` by slicing THIS region, between its two markers.
# A failure AFTER the act started is not a refusal: it prints `"failed"`, never
# `"refused"`, and is journaled by `_lc_fail`.

_ws_reclaim_reset() {   # every REAP_* global `_ws_reap_reset` owns, plus the reclaim ladder's own
  _ws_reap_reset
  RECLAIM_CHILDOF=""        # the marker's run id, as READ — never inferred from anything else
  RECLAIM_DEFER=0           # 1 = --defer-expired: rungs 5 and 6 skipped, and a fingerprint input
  RECLAIM_WORKTREE=""       # `present`, or `absent` for a vanished worktree (`_ws_reclaim_eval_absent`)
  RECLAIM_HEAD=""           # the child's HEAD commit (differs from REAP_TIP on a detached HEAD); on the
  #                           vanished arm, the HEAD git's record still names ('' when it holds none)
  RECLAIM_REC_BRANCH=""; RECLAIM_REC_HEAD=""   # `_ws_reclaim_record`'s answer for the last path asked
  RECLAIM_STATUSDIGEST=""   # sha256 of the child's `status --porcelain=v1 -z --untracked-files=all`
  RECLAIM_SECRETS=()        # secret-shaped untracked AND ignored paths — never staged, recorded by path
  RECLAIM_STAGE=()          # the one tree last classified: its non-secret untracked paths
  RECLAIM_NESTED=""         # same-repository nested checkouts: one resolved path per line
  RECLAIM_FOREIGN=""        # different-repository nested checkouts PROVEN clean and pushed
  RECLAIM_STASHES=""        # stash commits attributed to the branch, one sha per line
  RECLAIM_OPHEADS=""        # `<NAME>=<sha>` per in-progress operation head present
  RECLAIM_WIP=""            # the child's own WIP commit, or '' when there was nothing to commit
  RECLAIM_WIP_SHA=""        # `_ws_wip_commit`'s answer for the tree it was just handed
  RECLAIM_WIP_WHY=""; RECLAIM_PIN_WHY=""; _WS_RECLAIM_CLASSIFY_WHY=""
}

_ws_reclaim_fingerprint() {   # key=value... -> the reclaim token. Every input is NAMED, so a
  # reclaim token can never equal a reap token or a resume token over the same
  # facts: the first input is always `mode=…`.
  printf '%s\n' "$@" | _plat_sha256 | cut -d' ' -f1
}

_ws_reclaim_unmeasured() {   # detail -> rc 1 with REAP_VERDICT=unmeasured and REAP_DETAIL set
  # A PROBE THAT COULD NOT RUN MEASURED NOTHING. The permission pass running
  # out of time (or unable to start), the operation probe failing, the stash
  # list or the clips listing unreadable: none of these says the TREE cannot be
  # read, so none may answer a TERMINAL token — a terminal refusal is never
  # retried, and a momentary box hiccup would strand a child for good. So this
  # is NOT one of the fourteen tokens and NOT a refusal: it is deliberately set
  # here, never through the refusal helper, so the harvest in
  # `server/test/wsaudit.test.ts` never counts it. `ws-audit --reclaim` prints
  # its document with `"verdict":"unmeasured"` and exits 1 on it, and
  # `ws-reclaim` prints a `"failed"` document (`probe-unmeasured`) at exit 1 —
  # both of which the server reads as `failed`, which the sweep retries.
  # `tree-unreadable` stays reserved for a tree that still cannot be read AFTER
  # the permission pass (spec §5.5, rung 8) — so a registry row that does not
  # say where its tree is, and an unreadable tombstone on resume, answer HERE
  # too, never through that word. A tree that is GONE and a directory git does
  # not record are NOT unmeasured: the first is reclaimed from what is left
  # (`_ws_reclaim_eval_absent`), the second refuses `no-worktree-record`,
  # terminally (spec §5.5, "A vanished worktree is not a refusal").
  REAP_VERDICT=unmeasured; REAP_DETAIL="$1"; return 1
}

_WS_NORMALISE_WHY=''
_ws_reclaim_normalise() {   # dir -> 0 when every directory under it is u+rwx and every file u+r afterwards;
  #                              1 when an entry is STILL unreadable after the pass (rung 8 refuses);
  #                              2 when the pass could not RUN at all — no uid, no scratch file, or
  #                              `_plat_timeout`'s 124 (rung 8 answers `_ws_reclaim_unmeasured`)
  # RUNG 8's "permission normalisation pass" (spec §5.5). ccd has measured a
  # mode-000 directory answering `git status` with rc 0, EMPTY stdout and a
  # warning on stderr — clean-looking and not clean (`_ws_reap_eval`'s Phase B
  # comment) — so before a reclaim reads a tree it adds the OWNER bits it needs
  # and nothing else: `u+rwx` on a directory, `u+r` on a file, only where this
  # uid owns the entry. Group and other bits are never touched.
  #
  # PRE-ORDER, ONE `-exec` PER ENTRY (`\;`, never `+`). find evaluates a
  # directory BEFORE it opens it, so a mode-000 directory is fixed and then
  # entered; `+` batches the chmods until after the walk, by which time find has
  # already failed to read the directory. Measured on GNU find 4.9 with
  # `a/` 000 holding `b/c/` 000 holding a 000 file: one pass, rc 0, empty
  # stderr, `git status` then lists the file.
  #
  # -P never follows a symlink; -xdev never leaves the tree's filesystem. What
  # is still unreadable afterwards — an entry another uid owns, a chmod that did
  # not take — is named, and rung 8 refuses on it.
  #
  # `-user` GOVERNS BOTH ARMS, so the disjunction is parenthesised as a whole:
  # find's `-o` binds looser than the implicit `-a`, and an unwrapped
  # `-user me \( dir-arm \) -o \( file-arm \)` parses as
  # `(-user me AND dir-arm) OR file-arm` — the file arm would chmod files of
  # ANY owner.
  local d="$1" me errf left rc
  _WS_NORMALISE_WHY=''
  [[ -d "$d" ]] || return 0
  me=$(id -u) || { _WS_NORMALISE_WHY='could not read this uid'; return 2; }
  errf=$(_plat_mktemp) || { _WS_NORMALISE_WHY='could not make a scratch file'; return 2; }
  _plat_timeout "$REAP_SCAN_SECONDS" find -P "$d" -xdev -user "$me" \
    \( \( -type d ! -perm -u=rwx -exec chmod u+rwx {} \; \) \
    -o \( -type f ! -perm -u=r -exec chmod u+r {} \; \) \) 2>"$errf"; rc=$?
  if (( rc == 124 )); then
    rm -f "$errf"; _WS_NORMALISE_WHY="the permission pass over $d did not finish within ${REAP_SCAN_SECONDS}s"; return 2
  fi
  left=$(find -P "$d" -xdev \( -type d ! -perm -u=rwx -o -type f ! -perm -u=r \) -print -quit 2>>"$errf")
  if [[ -n "$left" || -s "$errf" ]]; then
    _WS_NORMALISE_WHY="${left:+$left is still unreadable after the permission pass}${left:+ }$(head -1 "$errf" 2>/dev/null)"
    rm -f "$errf"; return 1
  fi
  rm -f "$errf"
  return 0
}

_ws_reclaim_secret_path() {   # relpath -> 0 when ANY component is secret-shaped (and not noise), 1 otherwise
  # The existing classifier (`_ws_sensitive_match`) judges a BASENAME, which is
  # right for `_ws_collect_ignored` — it walks INTO an ignored directory with
  # `_ws_sensitive_inside` — and wrong for an untracked file listed with
  # `--untracked-files=all`: `secrets/token.txt` has a harmless basename, and
  # the WIP commit would stage it and the attic would pin it PERMANENTLY in a
  # public repository. So every path component is asked, and a vendored path
  # (`node_modules/…`) is exempt exactly as `_ws_sensitive_vendored` exempts it.
  local p="${1%/}" rest seg
  _ws_sensitive_vendored "$p" && return 1
  rest="$p"
  while [[ -n "$rest" ]]; do
    seg="${rest%%/*}"
    if _ws_sensitive_match "$seg" && ! _ws_sensitive_noise "$seg"; then return 0; fi
    [[ "$rest" == */* ]] || break
    rest="${rest#*/}"
  done
  return 1
}

_ws_reclaim_classify() {   # dir prefix -> 0 with RECLAIM_STAGE (this dir's non-secret untracked paths)
  #                             set and "$prefix<path>" appended to RECLAIM_SECRETS; 1 when the tree
  #                             could not be read (_WS_RECLAIM_CLASSIFY_WHY names why); 2 when the read
  #                             could not RUN — no scratch file (never `tree-unreadable`: spec §5.5, rung 8)
  # THE PIN PHASE'S STEP 1 (spec §5.5): untracked AND ignored files through the
  # secret-shape classifier. A secret-shaped file is never staged — ignored or
  # merely untracked — so an accident of `.gitignore` never decides whether a
  # credential is committed. Nested checkout roots (`?? dir/` with a `.git`
  # inside) are skipped: each is pinned as its own tree, or proven clean and
  # pushed, never staged as a gitlink here.
  local dir="$1" prefix="$2" outf errf err rc entry skip p
  RECLAIM_STAGE=(); _WS_RECLAIM_CLASSIFY_WHY=""
  outf=$(_plat_mktemp) || { _WS_RECLAIM_CLASSIFY_WHY='could not make a scratch file'; return 2; }
  errf=$(_plat_mktemp) || { rm -f "$outf"; _WS_RECLAIM_CLASSIFY_WHY='could not make a scratch file'; return 2; }
  git -C "$dir" -c core.quotePath=false status --porcelain=v1 -z --untracked-files=all >"$outf" 2>"$errf"; rc=$?
  err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
  if (( rc != 0 )) || [[ -n "$err" ]]; then
    rm -f "$outf"; _WS_RECLAIM_CLASSIFY_WHY="git status at $dir answered rc $rc${err:+: ${err%%$'\n'*}}"; return 1
  fi
  [[ -n "$prefix" ]] || RECLAIM_STATUSDIGEST=$(_plat_sha256 <"$outf" | cut -d' ' -f1)
  while IFS= read -r -d '' entry; do
    case "$entry" in
      '?? '*) p="${entry#?? }" ;;
      [RC]*)  IFS= read -r -d '' skip || :; continue ;;   # a rename's second field is its source path
      *)      continue ;;
    esac
    [[ -n "$p" ]] || continue
    if [[ "$p" == */ && -e "$dir/${p%/}/.git" ]]; then continue; fi
    if _ws_reclaim_secret_path "$p"; then RECLAIM_SECRETS+=("$prefix$p"); else RECLAIM_STAGE+=("$p"); fi
  done <"$outf"
  rm -f "$outf"
  _ws_collect_ignored "$dir" \
    || { _WS_RECLAIM_CLASSIFY_WHY="could not read the ignored set at $dir${REAP_IGNREASON:+ — $REAP_IGNREASON}"; return 1; }
  local s
  for s in ${REAP_SENSITIVE[@]+"${REAP_SENSITIVE[@]}"}; do
    [[ -n "$s" ]] && RECLAIM_SECRETS+=("$prefix$s")
  done
  return 0
}

_ws_reclaim_stash_shas() {   # main branch -> the stash commits attributed to branch, one sha per line;
  #                             rc 1 when the stash list could not be read
  # THE SAME ATTRIBUTION `_ws_stash_count` COUNTS, answering shas instead of a
  # number: a subject naming the branch, or a `(no branch)` entry whose first
  # parent is an ancestor of the branch — and an unresolvable base counts,
  # fail-closed, exactly as it does there. Two copies of one rule, so
  # `server/test/ccd-child-reclaim-ladder.test.ts` holds this line count equal
  # to `_ws_stash_count` over a fixture carrying both shapes.
  local main="$1" branch="$2" list sha gs base
  list=$(git -C "$main" stash list --format='%H%x09%gs' 2>/dev/null) || return 1
  while IFS=$'\t' read -r sha gs; do
    [[ -n "$sha" ]] || continue
    case "$gs" in
      "On $branch:"*|"WIP on $branch:"*) printf '%s\n' "$sha" ;;
      'On (no branch):'*|'WIP on (no branch):'*)
        base=$(git -C "$main" rev-parse --verify --quiet "$sha^1" 2>/dev/null) || { printf '%s\n' "$sha"; continue; }
        git -C "$main" merge-base --is-ancestor "$base" "refs/heads/$branch" 2>/dev/null && printf '%s\n' "$sha" ;;
    esac
  done <<< "$list"
  return 0
}

_ws_reclaim_record() {   # main path -> git's worktree record for path, read from $main ONCE: rc 0 with
  #                           RECLAIM_REC_BRANCH ('' = detached) and RECLAIM_REC_HEAD set; rc 1 when $main
  #                           records no worktree at path; rc 2 when the list could not be READ
  # `_ws_wt_branch`'s matching (the path as given, or resolved through
  # `_ws_realpath`, so a symlinked ancestor cannot hide a record), with the one
  # distinction it folds: its exit 1 is both "no record" and "the list failed",
  # which is right for ws-reap's refusal and wrong here, where "no record" is
  # the TERMINAL `no-worktree-record` and a terminal refusal is never retried.
  # A list that could not be read measured nothing (spec §5.5, rung 8's rule).
  # It also answers the HEAD the record names — a VANISHED worktree's record
  # (`prunable`) is the one place a detached child's last commit is reachable
  # from, and the tail clears that record.
  local main="$1" path="$2" real line listing m=0 hit=0
  RECLAIM_REC_BRANCH=""; RECLAIM_REC_HEAD=""
  listing=$(git -C "$main" worktree list --porcelain 2>/dev/null) || return 2
  real=$(_ws_realpath "$path")
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) m=0
                    [[ "${line#worktree }" == "$real" || "${line#worktree }" == "$path" ]] && { m=1; hit=1; } ;;
      "HEAD "*)     (( m )) && RECLAIM_REC_HEAD="${line#HEAD }" ;;
      "branch "*)   (( m )) && RECLAIM_REC_BRANCH="${line#branch refs/heads/}" ;;
    esac
  done <<< "$listing"
  (( hit )) || return 1
  return 0
}

_ws_reclaim_eval() {   # id defer(0|1) childof('' = do not compare) -> 0 when the reclaim ladder
  #                       passes (REAP_TOKEN set, REAP_VERDICT=reclaimable), else REAP_VERDICT names it
  # THE LADDER, in spec §5.5's order. A refusal writes NOTHING — with one named
  # exception, rung 8's permission pass, which adds owner bits and destroys
  # nothing. `ws-audit --reclaim` runs this with childof '' (the audit is not
  # told the run); `ws-reclaim` runs it with its `--child-of`, so rung 2 is the
  # two-authority check there and a marker check here. It runs only where no
  # breadcrumb exists — a resumed reclaim is `_ws_reclaim_resume_eval`'s.
  _ws_reclaim_reset
  local id="$1" defer="$2" childof="$3"
  local ws mark project workdir regbranch branch wthead main mainreal common
  local op clients elsewhere elsrc nested p pcommon ptop errf err rc pdirt pahead h hs clipsjson
  RECLAIM_DEFER="$defer"
  # 1 — registry identity
  [[ -f "$REG/$id.uuid" ]] || { _reap_refuse no-such-session "no registry entry for $id"; return 1; }
  ws=$(_reg_get "$id" workspace)
  [[ -n "$ws" ]] || { _reap_refuse not-a-workspace "$id is a main checkout"; return 1; }
  # 2 — the marker, and (from the verb) its equality with --child-of. NO
  # OVERRIDE ANYWHERE: no flag, no breadcrumb, no resume skips this rung.
  # The grammar is wave 1's `_child_runid_valid` (its `LC_ALL=C` shadow: the
  # bare `=~` range admits `1²` under a UTF-8 locale) — one definition, never
  # re-spelled here.
  mark=$(_reg_get "$id" child) || mark=""
  _child_runid_valid "$mark" \
    || { _reap_refuse not-a-child "$id carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed"; return 1; }
  [[ -z "$childof" || "$mark" == "$childof" ]] \
    || { _reap_refuse not-a-child "$id was minted for run $mark, not run $childof — the two authorities disagree"; return 1; }
  RECLAIM_CHILDOF="$mark"
  # 3 — the kill-switch, read HERE, at the instant of deletion (spec §5.8). -e,
  # not -f: a pause file that is a directory, or unreadable, still pauses.
  [[ ! -e "$REG/reclaim-paused" ]] \
    || { _reap_refuse paused "reclamation is paused fleet-wide ($REG/reclaim-paused)"; return 1; }
  # 4 — held. -e for the same reason: an unreadable hold is still a hold.
  if [[ -e "$REG/$id.hold" ]]; then
    _reap_refuse held "$(cat "$REG/$id.hold" 2>/dev/null || echo '<unreadable — treat as held>')"; return 1
  fi
  project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir); regbranch=$(_reg_get "$id" branch)
  # A ROW THAT DOES NOT SAY WHAT THE CHILD IS IS UNMEASURED, NOT UNREADABLE:
  # `tree-unreadable` means ONLY a tree still unreadable after rung 8's
  # permission pass (spec §5.5). A row with no project, workdir or branch
  # proved nothing — a `failed` document, retried.
  [[ -n "$project" && -n "$workdir" && -n "$regbranch" ]] \
    || { _ws_reclaim_unmeasured "the registry does not say what $id is: project='$project' workdir='$workdir' branch='$regbranch'"; return 1; }
  main="$PROJECTS_ROOT/$project"
  # 5 — presence ON THE BOX: a tmux client attached to THIS session. ANCHORED
  # (`=`): a bare `-t cc-<id>` is an fnmatch pattern and resolves a prefix to a
  # DIFFERENT session (D-2780). A session that does not exist has no client; a
  # session that exists and will not list its clients is presence UNMEASURED,
  # which is not absence.
  if (( ! defer )); then
    if tmux has-session -t "=$(_tmux "$id")" 2>/dev/null; then
      clients=$(tmux list-clients -t "=$(_tmux "$id")" -F '#{client_tty}' 2>/dev/null) \
        || { _reap_refuse attached "$(_tmux "$id") exists and would not list its clients — presence unmeasured is not absence"; return 1; }
      [[ -z "$clients" ]] \
        || { _reap_refuse attached "a terminal is attached to $(_tmux "$id"): ${clients//$'\n'/, }"; return 1; }
    fi
  fi
  # A VANISHED WORKTREE IS NOT A REFUSAL (spec §5.5). NOTHING stands at the
  # workdir — `! -e` and `! -L`, so a dangling link is never read as absence —
  # and no breadcrumb exists (this function only runs where there is none), so
  # no reclaim took it: there is no tree left that could hold unseen work, and
  # a retry could never succeed. The ladder answers over what IS left, and the
  # verb reclaims the child from its branch on.
  if [[ ! -e "$workdir" && ! -L "$workdir" ]]; then
    _ws_reclaim_eval_absent "$id" "$workdir" "$main" "$regbranch"
    return $?
  fi
  [[ -d "$workdir" ]] \
    || { _ws_reclaim_unmeasured "something that is not a directory stands at $workdir — neither a tree to pin nor a worktree that is gone"; return 1; }
  # THE TREE MUST BE ONE OF $main's WORKTREES — settled BEFORE any probe reads
  # git inside it (rung 6 does, and fails on exactly the no-record shape: an
  # admin directory removed by hand leaves every read of the tree failing
  # `not a git repository`). Asked in this order, each answer its own word:
  # $main's repository (unresolvable: unmeasured); git's record of the workdir,
  # read from $main (a list that could not be READ: unmeasured, never "no
  # record"); the repository the directory resolves to — ANOTHER repository's
  # is rung 9's question asked of the child itself, `containment-unproven`; and
  # only then the record: a directory $main does not record is
  # `no-worktree-record`, TERMINAL (spec §5.5) — ccd cannot tell what it would
  # be deleting there.
  mainreal=$(_ws_common_dir "$main") \
    || { _ws_reclaim_unmeasured "could not resolve the repository of $main"; return 1; }
  _ws_reclaim_record "$main" "$workdir"; rc=$?
  (( rc == 2 )) \
    && { _ws_reclaim_unmeasured "could not read $main's worktree list, so whether git records $workdir was never asked"; return 1; }
  if common=$(_ws_common_dir "$workdir"); then
    [[ "$common" == "$mainreal" ]] \
      || { _reap_refuse containment-unproven "$workdir belongs to $common, not $mainreal — another repository's work cannot be pinned into this one"; return 1; }
  elif (( rc == 0 )); then
    _ws_reclaim_unmeasured "$main records a worktree at $workdir, but git cannot resolve the directory's repository"; return 1
  fi
  (( rc == 0 )) \
    || { _reap_refuse no-worktree-record "$main has no worktree record for $workdir"; return 1; }
  wthead="$RECLAIM_REC_BRANCH"
  # 6 — no in-progress git operation in the child's OWN tree.
  if (( ! defer )); then
    op=$(_ws_child_op "$workdir") \
      || { _ws_reclaim_unmeasured "could not probe $workdir for an in-progress git operation"; return 1; }
    [[ -z "$op" ]] || { _reap_refuse tree-busy "$op in progress at $workdir"; return 1; }
  fi
  # git's record names the branch removed; a DETACHED child removes the one the
  # registry names — its HEAD commit is pinned on its own (the pin phase).
  branch="${wthead:-$regbranch}"
  REAP_REGBRANCH="$regbranch"; REAP_BRANCH="$branch"; REAP_WTHEAD="$wthead"
  [[ -z "$wthead" || "$wthead" == "$regbranch" ]] \
    || REAP_DRIFT="the registry recorded $regbranch; git's worktree record for $workdir says $wthead — $wthead is the branch reclaimed, and $regbranch is left alone"
  # 7 — the branch is checked out in no other worktree: the tail deletes it
  # with `update-ref -d`, which does NOT make the check `git branch -d` makes.
  elsewhere=$(_ws_branch_elsewhere "$main" "$branch" "$workdir"); elsrc=$?
  (( elsrc == 0 )) \
    || { _ws_reclaim_unmeasured "could not enumerate $main's worktrees, so whether another checkout holds $branch was never asked"; return 1; }
  [[ -z "$elsewhere" ]] \
    || { _reap_refuse branch-elsewhere "$branch is also checked out at $elsewhere"; return 1; }
  # 8 — the tree reads, after the permission pass. Its clips directory is
  # normalised too: the tail deletes it, and its manifest is a fingerprint input.
  # NO FOLD: a pass that could not RUN (`_ws_reclaim_normalise` rc 2 — it ran
  # out of time, or could not start) is `_ws_reclaim_unmeasured`, retried as a
  # failure; only rc 1, an entry STILL unreadable after the pass, is the
  # terminal `tree-unreadable`. Rung 6's probe, the stash list and the clips
  # listing below take the same unmeasured arm.
  _ws_reclaim_normalise "$workdir"; rc=$?
  (( rc == 2 )) && { _ws_reclaim_unmeasured "the permission pass over $workdir could not run: $_WS_NORMALISE_WHY"; return 1; }
  (( rc == 0 )) || { _reap_refuse tree-unreadable "$workdir cannot be read: $_WS_NORMALISE_WHY"; return 1; }
  _ws_reclaim_normalise "$HOME/.cc-clips/$id"; rc=$?
  (( rc == 2 )) && { _ws_reclaim_unmeasured "the permission pass over $HOME/.cc-clips/$id could not run: $_WS_NORMALISE_WHY"; return 1; }
  (( rc == 0 )) || { _reap_refuse tree-unreadable "$HOME/.cc-clips/$id cannot be read: $_WS_NORMALISE_WHY"; return 1; }
  _ws_reclaim_classify "$workdir" ""; rc=$?
  (( rc == 2 )) && { _ws_reclaim_unmeasured "$_WS_RECLAIM_CLASSIFY_WHY"; return 1; }
  (( rc == 0 )) || { _reap_refuse tree-unreadable "$_WS_RECLAIM_CLASSIFY_WHY"; return 1; }
  # The audit's `sensitive` field lists what the pin phase will DROP: every
  # secret-shaped path, untracked or ignored.
  REAP_SENSITIVE=(${RECLAIM_SECRETS[@]+"${RECLAIM_SECRETS[@]}"})
  # 9 — containment. A nested checkout of THIS repository (a registered child
  # worktree or a stray) is pinned and removed, never refused. A checkout of a
  # DIFFERENT repository cannot be pinned into this attic at all, so it must
  # prove it holds nothing that exists nowhere else: clean, and every commit on
  # one of its own remotes.
  nested=$(_ws_nested_checkouts "$workdir") \
    || { _ws_reclaim_unmeasured "could not scan for nested checkouts${_WS_NESTED_WHY:+ — $_WS_NESTED_WHY}"; return 1; }
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    pcommon=$(_ws_common_dir "$p") \
      || { _reap_refuse containment-unproven "could not resolve the repository of the checkout at $p"; return 1; }
    if [[ "$pcommon" == "$mainreal" ]]; then
      ptop=$(git -C "$p" rev-parse --path-format=absolute --show-toplevel 2>/dev/null) || ptop=""
      [[ "$ptop" == "$p" ]] \
        || { _reap_refuse containment-unproven "the checkout at $p names $mainreal but is not a worktree root"; return 1; }
      RECLAIM_NESTED+="$p"$'\n'
      continue
    fi
    errf=$(_plat_mktemp) || { _ws_reclaim_unmeasured "could not make a scratch file to read the checkout at $p"; return 1; }
    pdirt=$(git -C "$p" status --porcelain 2>"$errf"); rc=$?
    err=$(cat "$errf" 2>/dev/null); rm -f "$errf"
    { (( rc == 0 )) && [[ -z "$err" ]]; } \
      || { _reap_refuse containment-unproven "could not read the checkout of another repository at $p"; return 1; }
    [[ -z "$pdirt" ]] \
      || { _reap_refuse containment-unproven "the checkout of another repository at $p has $(printf '%s\n' "$pdirt" | grep -c .) uncommitted file(s)"; return 1; }
    pahead=$(git -C "$p" rev-list --count --all --not --remotes 2>/dev/null) \
      || { _reap_refuse containment-unproven "could not prove every commit in $p is on one of its own remotes"; return 1; }
    (( pahead == 0 )) \
      || { _reap_refuse containment-unproven "$pahead commit(s) in the checkout of another repository at $p are on none of its remotes"; return 1; }
    RECLAIM_FOREIGN+="$p"$'\n'
  done <<< "$nested"$'\n'
  # The facts the pin phase will act on, each a fingerprint input.
  REAP_TIP=$(git -C "$main" rev-parse --verify --quiet "refs/heads/$branch^{commit}" 2>/dev/null) || REAP_TIP=""
  RECLAIM_HEAD=$(git -C "$workdir" rev-parse --verify --quiet "HEAD^{commit}" 2>/dev/null) || RECLAIM_HEAD=""
  RECLAIM_STASHES=$(_ws_reclaim_stash_shas "$main" "$branch") \
    || { _ws_reclaim_unmeasured "could not read the stash list of $main"; return 1; }
  REAP_STASHES=$(printf '%s' "$RECLAIM_STASHES" | grep -c . || true)
  for h in REBASE_HEAD MERGE_HEAD CHERRY_PICK_HEAD ORIG_HEAD; do
    hs=$(git -C "$workdir" rev-parse --verify --quiet "$h^{commit}" 2>/dev/null) || continue
    RECLAIM_OPHEADS+="$h=$hs"$'\n'
  done
  clipsjson=$(_ws_clip_manifest "$id") \
    || { _ws_reclaim_unmeasured "could not list $HOME/.cc-clips/$id"; return 1; }
  REAP_CLIPDIGEST=$(printf '%s\n' "$clipsjson" | _plat_sha256 | cut -d' ' -f1)
  REAP_SENSDIGEST=$(printf '%s\n' ${RECLAIM_SECRETS[@]+"${RECLAIM_SECRETS[@]}"} | LC_ALL=C sort | _plat_sha256 | cut -d' ' -f1)
  REAP_CHILDDIGEST=$(printf '%s%s' "$RECLAIM_NESTED" "$RECLAIM_FOREIGN" | _plat_sha256 | cut -d' ' -f1)
  # 10 is the VERB's: it recomputes this inside the reap lock and compares.
  RECLAIM_WORKTREE=present
  REAP_TOKEN=$(_ws_reclaim_fingerprint "mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" \
    "deferExpired=$RECLAIM_DEFER" "worktree=present" "branch=$branch" "registryBranch=$regbranch" \
    "worktreeHead=$wthead" "tip=$REAP_TIP" "head=$RECLAIM_HEAD" "statusDigest=$RECLAIM_STATUSDIGEST" \
    "ignoredDigest=$REAP_IGNDIGEST" "secretsDigest=$REAP_SENSDIGEST" \
    "stashes=${RECLAIM_STASHES//$'\n'/,}" "opHeads=${RECLAIM_OPHEADS//$'\n'/,}" \
    "nestedDigest=$REAP_CHILDDIGEST" "clipsDigest=$REAP_CLIPDIGEST")
  REAP_VERDICT=reclaimable
  return 0
}

_ws_reclaim_eval_absent() {   # id workdir main regbranch -> the ladder's answer for a child whose worktree
  #                               directory is GONE and no breadcrumb says a reclaim took it; called ONLY
  #                               from `_ws_reclaim_eval`, after rungs 1-5. rc 0 with REAP_VERDICT=reclaimable,
  #                               REAP_TOKEN and RECLAIM_WORKTREE=absent; else REAP_VERDICT names it
  # A VANISHED WORKTREE IS NOT A REFUSAL (spec §5.5): there is nothing left on
  # disk that could be lost, so the reclaim pins what IS left and runs its tail
  # from the branch on. WHAT IS ASKED, AND WHAT IS NOT. Rungs 1-5 were asked by
  # the caller, the pause and the hold among them. Rung 6 (an operation in the
  # child's OWN tree), rung 8's pass over the tree and rung 9 (nested
  # checkouts) have no tree to ask about. Rung 7 IS asked — the tail deletes
  # the branch by CAS, which does not check other worktrees — excluding the
  # child's own path, whose record git may still hold (`prunable`) and the tail
  # clears first. Rung 8's pass still runs over the CLIPS directory: the tail
  # deletes it, and its manifest is a fingerprint input. The facts pinned are
  # the branch tip, the stashes attributed to the branch, and the HEAD git's
  # record still names — a detached child's last commit is reachable from that
  # record alone, and the tail clears it.
  local id="$1" workdir="$2" main="$3" regbranch="$4" mainreal rec branch wthead elsewhere elsrc rc clipsjson
  mainreal=$(_ws_common_dir "$main") \
    || { _ws_reclaim_unmeasured "could not resolve the repository of $main"; return 1; }
  _ws_reclaim_record "$main" "$workdir"; rec=$?
  (( rec == 2 )) \
    && { _ws_reclaim_unmeasured "could not read $main's worktree list, so whether git still records $workdir was never asked"; return 1; }
  # git's record, when it still holds one, names the branch removed (a DETACHED
  # record removes the registry's); with no record left, the registry's name.
  wthead="$RECLAIM_REC_BRANCH"; RECLAIM_HEAD="$RECLAIM_REC_HEAD"
  branch="${wthead:-$regbranch}"
  REAP_REGBRANCH="$regbranch"; REAP_BRANCH="$branch"; REAP_WTHEAD="$wthead"
  [[ -z "$wthead" || "$wthead" == "$regbranch" ]] \
    || REAP_DRIFT="the registry recorded $regbranch; git's worktree record for $workdir says $wthead — $wthead is the branch reclaimed, and $regbranch is left alone"
  # 7 — no OTHER worktree holds the branch.
  elsewhere=$(_ws_branch_elsewhere "$main" "$branch" "$workdir"); elsrc=$?
  (( elsrc == 0 )) \
    || { _ws_reclaim_unmeasured "could not enumerate $main's worktrees, so whether another checkout holds $branch was never asked"; return 1; }
  [[ -z "$elsewhere" ]] \
    || { _reap_refuse branch-elsewhere "$branch is also checked out at $elsewhere"; return 1; }
  # 8 — the clips directory only: there is no tree.
  _ws_reclaim_normalise "$HOME/.cc-clips/$id"; rc=$?
  (( rc == 2 )) && { _ws_reclaim_unmeasured "the permission pass over $HOME/.cc-clips/$id could not run: $_WS_NORMALISE_WHY"; return 1; }
  (( rc == 0 )) || { _reap_refuse tree-unreadable "$HOME/.cc-clips/$id cannot be read: $_WS_NORMALISE_WHY"; return 1; }
  REAP_TIP=$(git -C "$main" rev-parse --verify --quiet "refs/heads/$branch^{commit}" 2>/dev/null) || REAP_TIP=""
  RECLAIM_STASHES=$(_ws_reclaim_stash_shas "$main" "$branch") \
    || { _ws_reclaim_unmeasured "could not read the stash list of $main"; return 1; }
  REAP_STASHES=$(printf '%s' "$RECLAIM_STASHES" | grep -c . || true)
  clipsjson=$(_ws_clip_manifest "$id") \
    || { _ws_reclaim_unmeasured "could not list $HOME/.cc-clips/$id"; return 1; }
  REAP_CLIPDIGEST=$(printf '%s\n' "$clipsjson" | _plat_sha256 | cut -d' ' -f1)
  # `worktree=absent` and `record` are INPUTS: a token minted over the tree can
  # never be spent on its absence, nor one minted before git's record went
  # after it, or the other way round.
  RECLAIM_WORKTREE=absent
  REAP_TOKEN=$(_ws_reclaim_fingerprint "mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" \
    "deferExpired=$RECLAIM_DEFER" "worktree=absent" "record=$rec" "branch=$branch" \
    "registryBranch=$regbranch" "worktreeHead=$wthead" "tip=$REAP_TIP" "head=$RECLAIM_HEAD" \
    "stashes=${RECLAIM_STASHES//$'\n'/,}" "clipsDigest=$REAP_CLIPDIGEST")
  REAP_VERDICT=reclaimable
  return 0
}

_ws_reclaim_resume_eval() {   # id defer childof phase -> 0 with REAP_TOKEN = the RESUME token, else REAP_VERDICT
  # A crash may not launder a refusal (spec §5.6): the resume re-asserts what
  # authorised the act — the marker and its --child-of, the pause, the hold —
  # BEFORE anything else runs, and its token binds the phase and the recorded
  # tip, so a stale resume token refuses `state-changed` like any other.
  _ws_reclaim_reset
  local id="$1" defer="$2" childof="$3" phase="$4" mark tomb tombtip tombbranch
  RECLAIM_DEFER="$defer"
  [[ -f "$REG/$id.uuid" ]] || { _reap_refuse no-such-session "no registry entry for $id"; return 1; }
  mark=$(_reg_get "$id" child) || mark=""
  _child_runid_valid "$mark" \
    || { _reap_refuse not-a-child "$id carries no readable child marker — an interrupted reclaim does not finish without one"; return 1; }
  [[ -z "$childof" || "$mark" == "$childof" ]] \
    || { _reap_refuse not-a-child "$id was minted for run $mark, not run $childof — the two authorities disagree"; return 1; }
  RECLAIM_CHILDOF="$mark"
  [[ ! -e "$REG/reclaim-paused" ]] \
    || { _reap_refuse paused "reclamation is paused fleet-wide ($REG/reclaim-paused)"; return 1; }
  if [[ -e "$REG/$id.hold" ]]; then
    _reap_refuse held "$(cat "$REG/$id.hold" 2>/dev/null || echo '<unreadable — treat as held>')"; return 1
  fi
  tomb="$REG/.reaped/$id.json"
  tombbranch=$(_ws_tomb_str "$tomb" branch) || tombbranch=""
  tombtip=$(_ws_tomb_str "$tomb" tip) || tombtip=""
  # Unmeasured, not `tree-unreadable` (spec §5.5, rung 8: that word is a tree
  # unreadable after the permission pass): the tree was never asked; the
  # record of which steps ran was. A `failed` document, retried.
  [[ -n "$tombbranch" ]] \
    || { _ws_reclaim_unmeasured "the tombstone at $tomb cannot be read, so which steps of the interrupted reclaim already ran is unknown"; return 1; }
  REAP_BRANCH="$tombbranch"; REAP_TIP="$tombtip"
  REAP_TOKEN=$(_ws_reclaim_fingerprint "mode=reclaim-resume" "id=$id" "childOf=$mark" \
    "deferExpired=$defer" "phase=$phase" "branch=$tombbranch" "tip=$tombtip")
  REAP_VERDICT=reclaimable
  return 0
}
# ── end child reclamation ─────────────────────────────────────────────── RECLAIM-END ──
```

- [ ] **Step 5: Give the five new ladder tokens their sentences**

`server/test/wsaudit.test.ts` now harvests `not-a-child`, `paused`, `attached`, `tree-busy` and `containment-unproven` from the new `_reap_refuse` calls, and holds `SENTENCES` set-equal to the harvest. Each sentence is written for a CHILD — no human remedy, because nothing waits for a human (rule 4). Directly above the closing `};` of `SENTENCES` in `server/src/wsaudit.ts`:

```ts
  // ── ws-reclaim (child-workspace reclamation, spec 2026-09-22 §5.5). The
  // ladder's new words. A CHILD has no human to act on a sentence (rule 4), so
  // none of these tells anyone to do anything: the retryable ones say the lane
  // tries again, the terminal ones say what was not proven. The reused tokens
  // (`no-such-session`, `not-a-workspace`, `held`, `branch-elsewhere`,
  // `tree-unreadable`, `no-worktree-record`, `state-changed`, `in-progress`)
  // keep their sentences: the server only ever shows a TERMINAL token's
  // sentence for a child — `no-worktree-record`'s ("nothing here is ccrc's to
  // remove") is true of one and asks nothing of anyone — and
  // `held`/`state-changed`/`in-progress` — the three whose copy names a human
  // remedy — are retryable, carried as a deferral's `detail`, never rendered.
  'not-a-child': 'ccrc did not create this workspace for a run, or its record of which run did is missing or disagrees — so it is never reclaimed automatically. Nothing was removed.',
  'paused': 'Reclamation is paused fleet-wide. Nothing was removed; it resumes when the pause is lifted.',
  'attached': 'A terminal is attached to this session, so nothing was removed. Reclamation tries again later.',
  'tree-busy': 'A git operation — a rebase, merge, cherry-pick or revert — is in progress in this worktree, so nothing was removed. Reclamation tries again later.',
  'containment-unproven': 'A checkout of another repository inside this workspace holds changes or commits that exist nowhere else, and they cannot be kept in this project. Nothing was removed.',
```

- [ ] **Step 6: Pay the `_reg_get` census tax, re-stamp ccd, run the tests to verify they pass**

The ladder adds `_reg_get "` reads — rung 1's `workspace`, rung 2's `child`, the three identity reads on one line, and the resume eval's `child` (six occurrences on four lines, as this plan is written; MEASURE, never type). Apply the census tax (Global Constraints) with `Task 2` in the `THE LAST MOVE WAS` line, then:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts test/wsaudit.test.ts \
  test/lifecycle-refusal-word.test.ts test/ccd-refusal-scan.test.ts test/ownership.test.ts test/ccd-ws-reap.test.ts \
  test/ccd-reg-get-census.test.ts)
```

Expected: PASS. `ccd-child-reclaim-ladder` all cases (the `itLinux` ones skip on macOS); `wsaudit` equality holds with the five new keys; `lifecycle-refusal-word` still finds SENTENCES and LC_REFUSAL_WORD disjoint; `ccd-refusal-scan` is unchanged (the region holds no `die`, and no `_lc_*` refusal literal yet); `ccd-ws-reap` still passes its `branch -D` line ban and its `--force` bans (nothing here is in the five reap functions).

- [ ] **Step 7: Pay the citation-corpus tax (S6-R11)**

Run procedure S6-R11 (Global Constraints). This task inserts the region above the dispatcher, so the only anchors that can move are citations of dispatcher lines; if step 1 is red, apply steps 2–4 exactly and name this task's insertion as the cause.

- [ ] **Step 8: Mutation check, then commit**

Each row is applied alone, re-stamped, run, then restored and re-stamped.

| # | Edit | Command | Expected red |
|---|---|---|---|
| 1 | Delete rung 2's equality line — the `[[ -z "$childof" \|\| "$mark" == "$childof" ]] \|\|` statement and its `_reap_refuse not-a-child … disagree` continuation | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t 'not-a-child with no marker'` | `the two authorities disagree: expected 'reclaimable' to be 'not-a-child'` |
| 2 | Delete rung 3 (the `reclaim-paused` test and its refusal) | same file, `-t 'refuses paused'` | `expected 'reclaimable' to be 'paused'` |
| 3 | In rung 5, change `list-clients -t "=$(_tmux "$id")"` to `list-clients -t "$(_tmux "$id")"` | same file, `-t 'ANCHORED target'` | `expected [ … ] to include 'tmux list-clients -t =cc-demo-quiet-basin -F #{client_tty}'` |
| 4 | Replace the workdir's three lines — `_ws_reclaim_normalise "$workdir"; rc=$?` and its two `(( rc == … ))` arms — with `rc=0` | same file, `-t 'normalises a mode-000'` (Linux) | `expected 'tree-unreadable' to be 'reclaimable'` — git's `could not open directory` warning is refused by the classifier's stderr check, which is exactly the mode-000 shape the pass exists for |
| 5 | Replace `_ws_reclaim_secret_path`'s body with `_ws_sensitive_match "$1" && ! _ws_sensitive_noise "$1" && ! _ws_sensitive_vendored "$1"` (basename only) | same file, `-t 'drops every secret-shaped path'` | `expected [ '.env', '.env.local' ] to deeply equal [ '.env', '.env.local', 'secrets/token.txt' ]` — `secrets/token.txt` would be STAGED |
| 6 | In rung 9, change `if [[ "$pcommon" == "$mainreal" ]]; then` to `if true; then` | same file, `-t 'on none of its remotes'` | `expected 'reclaimable' to be 'containment-unproven'` |
| 7 | Drop `"deferExpired=$RECLAIM_DEFER"` from the `_ws_reclaim_fingerprint` call | same file, `-t 'moves the token'` | `--defer-expired is an INPUT…: expected '<hex>' not to be '<hex>'` |
| 8a | In `_ws_reclaim_eval`'s rung 2, `_child_runid_valid "$mark" \` → `[[ "$mark" =~ ^[1-9][0-9]{0,9}$ ]] \` (the bare pattern re-spelled) | same file, `-t 'locale-widened range'` | `fresh arm, the audit form: expected 'reclaimable' to be 'not-a-child'` — RUN, not skipped, on a box listing a UTF-8 locale (the fleet box lists `en_US.utf8`, wave 1 measured); PREDICTED at planning — measure it. The same edit in `_ws_reclaim_resume_eval` alone reds `the resume arm` only |
| 8b | In rung 6, `_ws_reclaim_unmeasured "could not probe $workdir …"` → `_reap_refuse tree-unreadable "could not probe $workdir …"` (the old fold) | same file, `-t 'could not RUN'` | `rung 6: the operation probe failed → unmeasured: expected 'tree-unreadable' to be 'unmeasured'`; the same revert at the stash, clips or normalise-rc-2 site reds its own row — PREDICTED at planning; measure it |
| 8c | In `_ws_reclaim_normalise`, the timeout arm's `return 2` → `return 1` | same file, `-t 'ran out of time'` | `expected 'tree-unreadable' to be 'unmeasured'` — a slow box read as a terminal refusal; PREDICTED at planning |
| 8d | Delete the vanished-worktree fork — the `if [[ ! -e "$workdir" && ! -L "$workdir" ]]; then _ws_reclaim_eval_absent …; return $?; fi` block — so a gone tree falls to the `[[ -d "$workdir" ]]` arm (the unmeasured answer R19 retired) | same file, `-t 'worktree directory is GONE'` | `expected 'unmeasured' to be 'reclaimable'` — a child that could never be reclaimed, retried and feed-rowed for ever — PREDICTED at planning; measure it. The same revert at the `_ws_common_dir` or `_ws_branch_elsewhere` site reds its own `could not RUN` row |
| 8e | `\|\| { _reap_refuse no-worktree-record "$main has no worktree record for $workdir"; return 1; }` → `\|\| { _ws_reclaim_unmeasured "$main has no worktree record for $workdir"; return 1; }` (the old fold) | same file, `-t 'no-worktree-record'` | `expected 'unmeasured' to be 'no-worktree-record'` — a terminal fact retried for ever — PREDICTED at planning |
| 8f | In `_ws_reclaim_record`, `listing=$(git -C "$main" worktree list --porcelain 2>/dev/null) \|\| return 2` → `… \|\| return 1` (a list that failed read as "no record") | same file, `-t 'could not be read'` | `git’s worktree list could not be read — never "no record" → unmeasured, no token: expected 'no-worktree-record' to be 'unmeasured'` — a box hiccup answered with a TERMINAL word — PREDICTED at planning |
| 8g | Move the identity block (from `mainreal=$(_ws_common_dir "$main")` through `wthead="$RECLAIM_REC_BRANCH"`) back BELOW rung 6, the order this plan first drafted | same file, `-t 'no-worktree-record'` | `expected 'unmeasured' to be 'no-worktree-record'` — rung 6's `_ws_child_op` fails `not a git repository` on the admin-less directory first — PREDICTED at planning |
| 8h | In `_ws_reclaim_eval_absent`, delete rung 7 (the `elsewhere=$(_ws_branch_elsewhere …)` line and its two arms) | same file, `-t 'vanished arm still asks'` | `rung 7: expected 'reclaimable' to be 'branch-elsewhere'` — the CAS would delete a branch another worktree stands on — PREDICTED at planning |
| 8i | Delete the `elif (( rc == 0 )); then _ws_reclaim_unmeasured "$main records a worktree at $workdir, but git cannot resolve …"; return 1` arm | same file, `-t 'resolves to no repository'` | `expected 'reclaimable' to be 'unmeasured'` — a recorded worktree whose repository could not be resolved walked on to a token — PREDICTED at planning |
| 8 | Replace rung 5's two-line statement — the `clients=$(tmux list-clients … 2>/dev/null) \` line AND its `\|\| { _reap_refuse attached "… would not list its clients …"; return 1; }` continuation — with the ONE line `clients=$(tmux list-clients -t "=$(_tmux "$id")" -F '#{client_tty}' 2>/dev/null) \|\| clients=""` (the failure swallowed, NO trailing backslash left behind: deleting the continuation alone leaves `clients=$(…) \` to join the next line as `clients=$(…) [[ -z "$clients" ]] \|\| …`, where `[[` after an assignment prefix is `command not found` — rc 127 — and the second arm refuses `attached` anyway, green) | same file, `-t 'ANCHORED target'` | `presence unmeasured is not absence: expected 'reclaimable' to be 'attached'` |

Restore everything, re-stamp, re-run Step 6 (green), then:

```bash
git add ccd/ccd server/src/wsaudit.ts server/test/childReclaimFixture.ts server/test/ccd-child-reclaim-ladder.test.ts \
  $(git diff --name-only -- server/test/session-hook.test.ts README.md)   # S6-R11's edits, when there were any
git commit -m "$(cat <<'MSG'
feat(ccd): the reclaim ladder — ten rungs, fourteen words, one token

_ws_reclaim_eval in its own RECLAIM region (spec 2026-09-22 §5.5): identity;
the .child marker, equal to --child-of when the verb asks, with no override
anywhere; the pause file, read on the box; the hold; an ANCHORED tmux client
probe; an in-progress operation in the child's own tree (both skipped under
--defer-expired and nothing else); branch-elsewhere; a permission pass that
adds owner bits before the tree is read; containment that pins a nested
checkout of this repository and refuses one of another repository holding
work that exists nowhere else. A directory git does not record as this
project's worktree refuses no-worktree-record, terminally; a child whose
worktree has vanished answers over what is left (its branch, its stashes,
git's record) instead of being retried for ever. The token is a named-input
fingerprint whose first input is mode=reclaim. Five new SENTENCES, each true
of a child.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The pin phase — the WIP commit, the extended attic pins, the extended tombstone

**Model routing:** **`opus`, effort `high`** — the contract's own row: the pin phase is what makes "pin everything, then reap" true, and it introduces the only `git commit` ccd has ever made.

**Files:**
- Modify: `ccd/ccd` — append the pin-phase functions inside the region, directly ABOVE `# ── end child reclamation`; change ONE line of `_ws_tombstone` (its third `printf`, `ccd/ccd:13309-13311` at `f5dc495b`)
- Test: `server/test/ccd-child-reclaim-pin.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's `_ws_reclaim_eval` (for `REAP_BRANCH`, `RECLAIM_NESTED`, `RECLAIM_FOREIGN`), `_ws_reclaim_classify`, `_ws_reclaim_stash_shas`; the existing `_ws_attic_pin`, `_ws_tombstone`, `_ws_common_dir`, `_ws_nested_checkouts`, `_json_str`.
- Produces (bash):
  - `_ws_wip_commit <dir> <id> <childof>` → rc 0 with `RECLAIM_WIP_SHA` (40 hex, or `''` when nothing was uncommitted); rc 1 with `RECLAIM_WIP_WHY`. **The only `git commit` in ccd, with exactly one calling function (`_ws_reclaim_pin`).** Identity `ccrc reclaim <ccrc-reclaim@invalid>` for author AND committer; message `ccrc: WIP pinned at reclaim of <id> (run <childof>)`; `--no-verify` plus `core.hooksPath=/dev/null`, so no hook of the repository runs.
  - `_ws_reclaim_attic_extra <main> <id> <sha>...` → rc 0 once every sha is `refs/ccrc/attic/<id>/<sha>`; rc 1 on the first that cannot be.
  - `_ws_reclaim_pin <id> <workdir> <main> <branch> <childof>` → rc 0 with `RECLAIM_WIP`, `REAP_TIP` (the branch tip AFTER the WIP commit), `RECLAIM_SECRETS`, `REAP_IGNORED` (the child's own) and `REAP_CHILDLINES` (`path\tbranch\thead` per same-repository nested checkout); rc 1 with `RECLAIM_PIN_WHY`. Idempotent: Task 4's tail runs it again as the settle.
  - `_ws_reclaim_secrets_json`, `_ws_reclaim_tomb_fields <childof> [<worktree: present|absent>]` (a JSON fragment ending in a comma; the second argument defaults to `present`, and Task 4's vanished-worktree arm passes `absent`), `_ws_tombstone_patch <id> <json-object>` (keys replaced, `secretsDropped` unioned; rc 1 when there is no tombstone).
  - `_ws_tombstone <id> <clipsjson> [<fragment>]` — the third argument is spliced in before `"reapedAt"`; ABSENT, the output is byte-identical to today's, which is the only way `ws-reap` calls it.
- The tombstone of a reclaim therefore carries every reap key plus `mode:"reclaim"`, `childOf`, `worktree` (`"present"`, or `"absent"` for a child whose worktree had vanished — spec §5.5, contract §8 R19), `wip`, `secretsDropped`, `containment:{sameRepository,foreignProven}`, `residueBytes` (null until Task 4's tail measures it).

**What is committed, and what never is** (spec §5.5 steps 1–2): tracked modifications and deletions (`git add --update`), and the non-secret untracked paths the classifier put in `RECLAIM_STAGE` — handed to git NUL-separated with `GIT_LITERAL_PATHSPECS=1`, so no filename is ever read as a glob. Never: a secret-shaped path, untracked or ignored (its path goes to the tombstone, its bytes die with the tree); an ignored file; a nested checkout's root (pinned on its own, or proven clean and pushed by rung 9). Measured on git 2.43 while this plan was written: the pathspec file stages `notes with space.txt` and a file under a formerly mode-000 directory, and `.env` and `secrets/token.txt` stay untracked.

**Why the operation heads are pinned FIRST:** a commit concludes a merge or a cherry-pick and deletes `MERGE_HEAD`/`CHERRY_PICK_HEAD` — measured on git 2.43 with a hand-written `MERGE_HEAD`: after the commit the file is gone. Read after the commit, those heads would be unpinnable.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-child-reclaim-pin.test.ts`:

```ts
// The pin phase (spec 2026-09-22 §5.5): the WIP commit, the attic pins, the
// tombstone — asserted by READING GIT AND THE FILE afterwards, never by
// trusting what the phase says it did (spec §9: "the secret-shape classifier
// runs over the WIP commit's candidates, asserted by reading the resulting
// tree rather than the tombstone; the WIP commit and the attic pins are
// asserted by reading git refs").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_RUN, CHILD_STUBS, makeChild, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-pin-'); });
afterEach(() => { h.cleanup(); });

interface Pinned { rc: string; wip: string; tip: string; why: string; secrets: string[]; childlines: string }

/** The ladder (for REAP_BRANCH and the nested/foreign lists), then the pin, in
 *  one shell — exactly the order `_ws_reclaim_locked` runs them. `defer` is
 *  the ladder's own flag: a case with an operation in progress needs it to get
 *  past rung 6, which is precisely the case the pin phase's heads exist for. */
function pinOf(c: Child, opts: { pre?: string; env?: NodeJS.ProcessEnv; defer?: 0 | 1 } = {}): Pinned {
  const out = h.sh(`${CHILD_STUBS} ${opts.pre ?? ''} _ws_reclaim_eval ${CHILD_ID} ${opts.defer ?? 0} ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s' "$rc" "$RECLAIM_WIP" "$REAP_TIP" "$RECLAIM_PIN_WHY"`
    + ` "$(printf '%s\\n' "\${RECLAIM_SECRETS[@]}")" "$REAP_CHILDLINES"`, opts.env ?? {});
  const [rc = '', wip = '', tip = '', why = '', secrets = '', childlines = ''] = out.split('\x1f');
  return { rc, wip, tip, why, secrets: secrets.split('\n').filter(Boolean), childlines };
}
const atticShas = (c: Child): string[] =>
  h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`)
    .split('\n').filter(Boolean).map((r) => r.split('/').pop()!);

describe('the WIP commit', () => {
  it('commits the tracked edit and the non-secret untracked files, and NEVER a secret — read from the tree', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '.gitignore'), '.env.local\nbuild/\n');
    h.git(c.wt, 'add', '.gitignore'); h.git(c.wt, 'commit', '-m', 'ignore');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    fs.writeFileSync(path.join(c.wt, 'notes with space.txt'), 'n');
    fs.writeFileSync(path.join(c.wt, '.env.example'), 'KEY=');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    fs.mkdirSync(path.join(c.wt, 'secrets')); fs.writeFileSync(path.join(c.wt, 'secrets', 'token.txt'), 't');
    fs.writeFileSync(path.join(c.wt, '.env.local'), 'KEY=local');
    fs.mkdirSync(path.join(c.wt, 'build')); fs.writeFileSync(path.join(c.wt, 'build', 'out.o'), 'o');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toMatch(/^[0-9a-f]{40}$/);
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', p.wip).split('\n');
    expect(tree).toEqual(expect.arrayContaining(['f1.txt', 'notes with space.txt', '.env.example', '.gitignore']));
    for (const never of ['.env', 'secrets/token.txt', '.env.local', 'build/out.o']) {
      expect(tree, `${never} was committed — and would be pinned permanently in a public repository`).not.toContain(never);
    }
    expect(h.git(c.main, 'show', `${p.wip}:f1.txt`)).toContain('edited');
    expect([...p.secrets].sort()).toEqual(['.env', '.env.local', 'secrets/token.txt']);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the WIP commit is ON the branch').toBe(p.wip);
    expect(p.tip).toBe(p.wip);
  }, 60_000);

  it('is written as ccrc, author AND committer, even when the environment says otherwise', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const p = pinOf(c, { env: { GIT_AUTHOR_NAME: 'intruder', GIT_AUTHOR_EMAIL: 'intruder@x',
      GIT_COMMITTER_NAME: 'intruder', GIT_COMMITTER_EMAIL: 'intruder@x' } });
    expect(h.git(c.main, 'log', '-1', '--format=%an <%ae>|%cn <%ce>|%s', p.wip)).toBe(
      'ccrc reclaim <ccrc-reclaim@invalid>|ccrc reclaim <ccrc-reclaim@invalid>'
      + `|ccrc: WIP pinned at reclaim of ${CHILD_ID} (run ${CHILD_RUN})`);
  }, 60_000);

  it('runs NO hook of the repository — not even the two --no-verify leaves running', () => {
    const c = makeChild(h);
    const hooks = path.join(c.main, '.git', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']) {
      fs.writeFileSync(path.join(hooks, hook), `#!/bin/sh\ntouch "$HOME/hook-${hook}"\n`, { mode: 0o755 });
    }
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    expect(pinOf(c).rc).toBe('0');
    for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']) {
      expect(fs.existsSync(path.join(h.home, `hook-${hook}`)), `${hook} ran`).toBe(false);
    }
  }, 60_000);

  it('makes no commit when there is nothing uncommitted — the ordinary finished child', () => {
    const c = makeChild(h);
    const p = pinOf(c);
    expect(p.rc).toBe('0');
    expect(p.wip).toBe('');
    expect(p.tip).toBe(c.tip);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`)).toBe(c.tip);
  }, 60_000);

  it('commits onto a DETACHED HEAD without moving the branch, and pins that commit by sha', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '--detach');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'detached work\n');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    expect(p.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch did not move').toBe(c.tip);
    expect(p.tip).toBe(c.tip);
    expect(atticShas(c)).toContain(p.wip);
  }, 60_000);
});

describe('the attic pins', () => {
  it('pins the WIP commit, the tip, every stash of the branch, and the operation heads — the heads taken BEFORE the commit', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f2.txt'), 'stashed\n');
    h.git(c.wt, 'stash', 'push', '-m', 'kept');
    const stash = h.git(c.main, 'rev-parse', 'refs/stash');
    // The two heads are commits NO reflog names. `_ws_reclaim_pin` also runs
    // the existing `_ws_attic_pin`, which pins every sha in
    // `git -C <workdir> reflog show --all` — and in a linked worktree that
    // includes main's branch reflog, `refs/stash` and the child's own branch
    // reflog (measured, git 2.43). A head that is in any of those is pinned
    // whatever step (0) does, and "before the commit" would be untested. A
    // `commit-tree` object referenced by nothing is pinned ONLY by step (0).
    const tree = h.git(c.wt, 'rev-parse', 'HEAD^{tree}');
    const mergeSide = h.git(c.wt, 'commit-tree', tree, '-p', 'HEAD', '-m', 'merge side, in no reflog');
    const orig = h.git(c.wt, 'commit-tree', tree, '-p', 'HEAD', '-m', 'orig head, in no reflog');
    const reflogs = h.git(c.wt, 'reflog', 'show', '--all', '--format=%H');
    expect(reflogs, 'the CONTROL: the merge head is in no reflog').not.toContain(mergeSide);
    expect(reflogs, 'the CONTROL: the orig head is in no reflog').not.toContain(orig);
    fs.writeFileSync(h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD'), `${mergeSide}\n`);
    fs.writeFileSync(h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'ORIG_HEAD'), `${orig}\n`);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'mid-merge\n');
    // Rung 6 refuses `tree-busy` on a merge in progress; the defer ceiling is
    // what gets past it, and the pin phase must STILL take the heads.
    const p = pinOf(c, { defer: 1 });
    expect(p.rc, p.why).toBe('0');
    const attic = atticShas(c);
    // MERGE_HEAD is the one the ORDER decides: the WIP commit concludes the
    // merge and deletes the file, so read after it, it is gone. ORIG_HEAD and
    // the stash survive a commit — theirs is a pinned-at-all check.
    for (const [what, sha] of [['WIP', p.wip], ['stash', stash], ['MERGE_HEAD', mergeSide], ['ORIG_HEAD', orig], ['tip', p.tip]] as const) {
      expect(attic, `${what} ${sha} is not pinned`).toContain(sha);
    }
  }, 60_000);

  it('pins and commits a nested checkout of the SAME repository, and never stages it as a gitlink', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'dirty.txt'), 'dirty');
    const p = pinOf(c);
    expect(p.rc, p.why).toBe('0');
    const nestedTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/nested');
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', nestedTip).split('\n')).toContain('dirty.txt');
    expect(atticShas(c)).toContain(nestedTip);
    expect(p.childlines).toContain(`${inner}\tws/nested\t${nestedTip}`);
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', `refs/heads/${CHILD_BRANCH}`).split('\n')
      .filter((f) => f.startsWith('inner')), 'the parent staged the nested checkout').toEqual([]);
  }, 60_000);

  it('FAILS — never skips — when a commit it must keep cannot be pinned', () => {
    const c = makeChild(h);
    const p = pinOf(c, { pre: `_ws_reclaim_stash_shas() { echo ${'d'.repeat(40)}; };` });
    expect(p.rc).toBe('1');
    expect(p.why).toContain(`could not be pinned under refs/ccrc/attic/${CHILD_ID}/`);
  }, 60_000);

  it('FAILS on a sha that is not a COMMIT — the `^{commit}` peel is the only guard that sees it', () => {
    // `update-ref` refuses a NONEXISTENT object on its own (so the case above
    // cannot tell the two guards apart), but it happily writes a ref at a TREE.
    // Only `cat-file -e "${sha}^{commit}"` refuses this one.
    const c = makeChild(h);
    const tree = h.git(c.wt, 'rev-parse', 'HEAD^{tree}');
    const p = pinOf(c, { pre: `_ws_reclaim_stash_shas() { echo ${tree}; };` });
    expect(p.rc).toBe('1');
    expect(atticShas(c), 'a tree was written into the attic').not.toContain(tree);
  }, 60_000);

  it('FAILS when the attic ref itself cannot be written — the update-ref guard', () => {
    // A ref AT `refs/ccrc/attic/<id>` makes every `refs/ccrc/attic/<id>/<sha>`
    // unwritable (a directory/file conflict), while every sha stays a real
    // commit — so `cat-file` passes and only `update-ref`'s own status fails.
    const c = makeChild(h);
    h.git(c.main, 'update-ref', `refs/ccrc/attic/${CHILD_ID}`, c.tip);
    const p = pinOf(c);
    expect(p.rc).toBe('1');
    expect(p.why).toContain(`could not be pinned under refs/ccrc/attic/${CHILD_ID}/`);
  }, 60_000);
});

describe('the only git commit in ccd', () => {
  it('is one line, inside _ws_wip_commit, and _ws_wip_commit is called only from _ws_reclaim_pin', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /\bcommit --no-verify\b/.test(l))).toHaveLength(1);
    const wipBody = src.slice(src.indexOf('_ws_wip_commit() {'), src.indexOf('_ws_reclaim_attic_extra() {'));
    expect(wipBody).toMatch(/\bcommit --no-verify\b/);
    const pinBody = src.slice(src.indexOf('_ws_reclaim_pin() {'), src.indexOf('_ws_reclaim_secrets_json() {'));
    const calls = (s: string): number => [...s.matchAll(/^[^#\n]*_ws_wip_commit "/gm)].length;
    expect(calls(src)).toBe(2);
    expect(calls(pinBody), 'a second caller of the commit helper').toBe(calls(src));
  });
});

describe('the tombstone', () => {
  it('carries the reclaim record beside every reap key, and ws-reap’s two-argument call is unchanged', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'edited\n');
    const REAP_KEYS = ['id', 'project', 'workdir', 'branch', 'registryBranch', 'base', 'tip', 'uuid', 'wrapper',
      'mergeCommit', 'proof', 'pr', 'prUrl', 'ignored', 'clips', 'transcript', 'attic', 'reflog', 'children', 'reapedAt'];
    const tombFile = path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`);
    h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null && _ws_tombstone ${CHILD_ID} '[]' >/dev/null`);
    expect(Object.keys(JSON.parse(fs.readFileSync(tombFile, 'utf8'))), 'two arguments: byte-for-byte the reap tombstone')
      .toEqual(REAP_KEYS);
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
      + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
      + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null && printf '%s' "$RECLAIM_WIP"`);
    const tomb = JSON.parse(fs.readFileSync(tombFile, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(tomb)).toEqual([...REAP_KEYS.slice(0, -1),
      'mode', 'childOf', 'worktree', 'wip', 'secretsDropped', 'containment', 'residueBytes', 'reapedAt']);
    expect(tomb['mode']).toBe('reclaim');
    expect(tomb['childOf']).toBe(CHILD_RUN);
    expect(tomb['worktree'], 'the default: a tree was there to pin').toBe('present');
    expect(tomb['wip']).toBe(out);
    expect(tomb['tip'], 'the tip AFTER the WIP commit — what the tail deletes by CAS').toBe(out);
    expect(tomb['secretsDropped']).toEqual(['.env']);
    expect(tomb['containment']).toEqual({ sameRepository: [], foreignProven: [] });
    expect(tomb['residueBytes']).toBeNull();
  }, 60_000);

  it('patches keys in place, unions secretsDropped, and refuses when there is no tombstone', () => {
    const tombDir = path.join(h.home, '.cc-sessions', '.reaped');
    fs.mkdirSync(tombDir, { recursive: true });
    fs.writeFileSync(path.join(tombDir, `${CHILD_ID}.json`), JSON.stringify({ tip: 'a', secretsDropped: ['a', 'c'], keep: 1 }));
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '{"tip":"b","secretsDropped":["b","a"],"residueBytes":12}'`);
    expect(JSON.parse(fs.readFileSync(path.join(tombDir, `${CHILD_ID}.json`), 'utf8')))
      .toEqual({ tip: 'b', secretsDropped: ['a', 'b', 'c'], keep: 1, residueBytes: 12 });
    expect(h.sh('_ws_tombstone_patch nobody \'{"tip":"x"}\'; echo "rc=$?"')).toBe('rc=1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts)
```

Expected: FAIL. Every `pinOf` case reads `rc` = `127` (`_ws_reclaim_pin: command not found`); `the only git commit in ccd` fails `expected [] to have a length of 1`; the tombstone case fails its second `toEqual` (no `mode` key — `_ws_tombstone` ignores a third argument) after `_ws_reclaim_tomb_fields: command not found`; the patch case fails on `_ws_tombstone_patch: command not found`.

- [ ] **Step 3: Write the pin phase**

Insert directly ABOVE `# ── end child reclamation` in `ccd/ccd`, with one blank line on each side:

```bash
_ws_wip_commit() {   # dir id childof -> 0 with RECLAIM_WIP_SHA = the new commit ('' when nothing was
  #                     uncommitted); 1 with RECLAIM_WIP_WHY. THE ONLY `git commit` IN ccd, and its
  #                     one call site is `_ws_reclaim_pin` — which is reason enough for it to be one
  #                     function (spec §5.5, pin phase step 2).
  # What it commits: tracked modifications and deletions (`add --update`) and
  # the non-secret untracked paths `_ws_reclaim_classify` just put in
  # RECLAIM_STAGE, handed over NUL-separated with literal pathspecs so no path
  # is ever read as a glob. What it never commits: a secret-shaped path
  # (RECLAIM_SECRETS), an ignored file, a nested checkout.
  #
  # THE IDENTITY IS FIXED, in both channels. `-c user.*` names it to git's
  # config; the GIT_* environment is what outranks config, so a caller
  # that happened to export GIT_AUTHOR_NAME cannot put its own name on a commit
  # it did not write. `core.hooksPath=/dev/null` with `--no-verify`: `--no-verify`
  # alone still runs prepare-commit-msg and post-commit — a repository's own
  # hooks must not run inside the fleet's destructive verb (measured, git 2.43:
  # with all three hooks installed, none ran).
  #
  # On a DETACHED HEAD (a rebase stopped, or a checkout of a sha) the commit
  # lands on HEAD and not on the branch; the caller pins it by sha.
  local dir="$1" id="$2" childof="$3" errf listf
  RECLAIM_WIP_SHA=""; RECLAIM_WIP_WHY=""
  errf=$(_plat_mktemp) || { RECLAIM_WIP_WHY='could not make a scratch file'; return 1; }
  git -C "$dir" add --update -- . 2>"$errf" \
    || { RECLAIM_WIP_WHY="git add --update at $dir failed: $(head -1 "$errf" 2>/dev/null)"; rm -f "$errf"; return 1; }
  if (( ${#RECLAIM_STAGE[@]} )); then
    listf=$(_plat_mktemp) || { rm -f "$errf"; RECLAIM_WIP_WHY='could not make a scratch file'; return 1; }
    printf '%s\0' "${RECLAIM_STAGE[@]}" >"$listf"
    GIT_LITERAL_PATHSPECS=1 git -C "$dir" add --pathspec-from-file="$listf" --pathspec-file-nul 2>"$errf" \
      || { RECLAIM_WIP_WHY="git add of the untracked files at $dir failed: $(head -1 "$errf" 2>/dev/null)"; rm -f "$errf" "$listf"; return 1; }
    rm -f "$listf"
  fi
  # Nothing staged is the ordinary case for a finished child: no commit.
  if git -C "$dir" diff --cached --quiet 2>/dev/null; then rm -f "$errf"; return 0; fi
  GIT_AUTHOR_NAME='ccrc reclaim' GIT_AUTHOR_EMAIL='ccrc-reclaim@invalid' \
  GIT_COMMITTER_NAME='ccrc reclaim' GIT_COMMITTER_EMAIL='ccrc-reclaim@invalid' \
    git -C "$dir" -c user.name='ccrc reclaim' -c user.email='ccrc-reclaim@invalid' \
      -c commit.gpgsign=false -c core.hooksPath=/dev/null \
      commit --no-verify --quiet -m "ccrc: WIP pinned at reclaim of $id (run $childof)" 2>"$errf" \
    || { RECLAIM_WIP_WHY="git commit at $dir failed: $(head -1 "$errf" 2>/dev/null)"; rm -f "$errf"; return 1; }
  rm -f "$errf"
  RECLAIM_WIP_SHA=$(git -C "$dir" rev-parse --verify HEAD 2>/dev/null) \
    || { RECLAIM_WIP_WHY="the WIP commit at $dir landed but HEAD does not resolve"; return 1; }
  return 0
}

_ws_reclaim_attic_extra() {   # main id sha... -> 0 once every sha is pinned under refs/ccrc/attic/<id>/<sha>;
  #                               1 on the first one that cannot be — a pin that cannot be taken
  #                               is a FAILURE here, never a skip (`_ws_attic_pin` may skip a pruned
  #                               reflog entry; nothing handed to THIS function is optional)
  local main="$1" id="$2" sha; shift 2
  for sha in "$@"; do
    [[ -n "$sha" ]] || continue
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || return 1
    git -C "$main" cat-file -e "${sha}^{commit}" 2>/dev/null || return 1
    git -C "$main" update-ref "refs/ccrc/attic/$id/$sha" "$sha" 2>/dev/null || return 1
  done
  return 0
}

_ws_reclaim_pin() {   # id workdir main branch childof -> 0 once everything recoverable is pinned;
  #                        1 with RECLAIM_PIN_WHY. Sets RECLAIM_WIP, REAP_TIP (the branch tip AFTER
  #                        the WIP commit), RECLAIM_SECRETS, REAP_IGNORED (the child's own) and
  #                        REAP_CHILDLINES (path\tbranch\thead per same-repository nested checkout).
  # THE PIN PHASE (spec §5.5), runnable more than once: the fresh arm runs it
  # before anything is destroyed, and the tail runs it again as the SETTLE, once
  # the pane is dead, to catch anything the session wrote between the two. Every
  # pin is idempotent (`update-ref` of a ref to the sha it already names).
  local id="$1" workdir="$2" main="$3" branch="$4" childof="$5"
  local h hs nested cpath cbr chead mainreal wdreal extras=() sha stashes
  RECLAIM_PIN_WHY=""; RECLAIM_WIP=""; RECLAIM_SECRETS=(); REAP_CHILDLINES=""
  [[ -d "$workdir" ]] || { RECLAIM_PIN_WHY="$workdir is gone — there is nothing to pin"; return 1; }
  # (0) The in-progress operation heads, FIRST: a commit concludes a merge or a
  # cherry-pick and deletes MERGE_HEAD / CHERRY_PICK_HEAD (measured, git 2.43).
  for h in REBASE_HEAD MERGE_HEAD CHERRY_PICK_HEAD ORIG_HEAD; do
    hs=$(git -C "$workdir" rev-parse --verify --quiet "$h^{commit}" 2>/dev/null) && extras+=("$hs")
  done
  mainreal=$(_ws_common_dir "$main") || { RECLAIM_PIN_WHY="could not resolve the repository of $main"; return 1; }
  # (1) Same-repository nested checkouts, innermost first: classify, commit,
  # remember the head. A different repository's checkout was proven clean and
  # pushed by rung 9 and goes with the tree; nothing of it can be pinned here.
  wdreal=$(cd -- "$workdir" >/dev/null 2>&1 && pwd -P) || { RECLAIM_PIN_WHY="could not resolve $workdir"; return 1; }
  nested=$(_ws_nested_checkouts "$workdir") \
    || { RECLAIM_PIN_WHY="could not scan for nested checkouts${_WS_NESTED_WHY:+ — $_WS_NESTED_WHY}"; return 1; }
  # fd 9, not stdin: nothing git runs inside this loop may read the list.
  while IFS= read -r -u 9 cpath; do
    [[ -n "$cpath" ]] || continue
    [[ "$(_ws_common_dir "$cpath" 2>/dev/null)" == "$mainreal" ]] || continue
    _ws_reclaim_classify "$cpath" "${cpath#"$wdreal"/}/" \
      || { RECLAIM_PIN_WHY="$_WS_RECLAIM_CLASSIFY_WHY"; return 1; }
    _ws_wip_commit "$cpath" "$id" "$childof" || { RECLAIM_PIN_WHY="$RECLAIM_WIP_WHY"; return 1; }
    [[ -n "$RECLAIM_WIP_SHA" ]] && extras+=("$RECLAIM_WIP_SHA")
    chead=$(git -C "$cpath" rev-parse --verify --quiet "HEAD^{commit}" 2>/dev/null) || chead=""
    [[ -n "$chead" ]] && extras+=("$chead")
    cbr=$(git -C "$cpath" symbolic-ref --quiet --short HEAD 2>/dev/null) || cbr=""
    REAP_CHILDLINES+="$cpath"$'\t'"$cbr"$'\t'"$chead"$'\n'
  done 9< <(printf '%s\n' "$nested" | awk '{ print length($0) "\t" $0 }' | LC_ALL=C sort -rn | cut -f2-)
  # (2) The child's own tree, LAST, so REAP_IGNORED describes it for the tombstone.
  _ws_reclaim_classify "$workdir" "" || { RECLAIM_PIN_WHY="$_WS_RECLAIM_CLASSIFY_WHY"; return 1; }
  _ws_wip_commit "$workdir" "$id" "$childof" || { RECLAIM_PIN_WHY="$RECLAIM_WIP_WHY"; return 1; }
  RECLAIM_WIP="$RECLAIM_WIP_SHA"
  [[ -n "$RECLAIM_WIP" ]] && extras+=("$RECLAIM_WIP")
  hs=$(git -C "$workdir" rev-parse --verify --quiet "HEAD^{commit}" 2>/dev/null) && extras+=("$hs")
  REAP_TIP=$(git -C "$main" rev-parse --verify --quiet "refs/heads/$branch^{commit}" 2>/dev/null) || REAP_TIP=""
  # (3) Every stash attributed to the branch.
  stashes=$(_ws_reclaim_stash_shas "$main" "$branch") \
    || { RECLAIM_PIN_WHY="could not read the stash list of $main"; return 1; }
  while IFS= read -r sha; do [[ -n "$sha" ]] && extras+=("$sha"); done <<< "$stashes"
  # (4) The pins: the reflog and the tip through the EXISTING pin (its 200 + tip
  # cap, unchanged), then everything above, which is never optional.
  _ws_attic_pin "$main" "$id" "$workdir" "${REAP_TIP:-$hs}" >/dev/null
  _ws_reclaim_attic_extra "$main" "$id" ${extras[@]+"${extras[@]}"} \
    || { RECLAIM_PIN_WHY="a commit this reclaim must keep could not be pinned under refs/ccrc/attic/$id/"; return 1; }
  return 0
}

_ws_reclaim_secrets_json() {   # -> RECLAIM_SECRETS as a JSON array of strings, on stdout
  local out="[" first=1 s
  for s in ${RECLAIM_SECRETS[@]+"${RECLAIM_SECRETS[@]}"}; do
    [[ -n "$s" ]] || continue
    (( first )) || out+=","; first=0; out+="$(_json_str "$s")"
  done
  printf '%s]' "$out"
}

_ws_reclaim_tomb_fields() {   # childof [worktree: present|absent] -> the reclaim-only tombstone keys as a
  #                                JSON fragment ENDING IN A COMMA — `_ws_tombstone`'s optional third
  #                                argument. Reads the eval's RECLAIM_NESTED/RECLAIM_FOREIGN and the pin's
  #                                RECLAIM_WIP and RECLAIM_SECRETS, so it runs after both, in the same shell.
  # `worktree` says whether there was a tree to pin at all: `absent` is a child
  # whose worktree had VANISHED (spec §5.5) — the record then holds its branch
  # tip and stashes and nothing of a tree, and says so rather than implying one.
  local childof="$1" worktree="${2:-present}" p first same="[" foreign="["
  first=1
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    (( first )) || same+=","; first=0; same+="$(_json_str "$p")"
  done <<< "$RECLAIM_NESTED"
  same+="]"; first=1
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    (( first )) || foreign+=","; first=0; foreign+="$(_json_str "$p")"
  done <<< "$RECLAIM_FOREIGN"
  foreign+="]"
  printf '"mode":"reclaim","childOf":%s,"worktree":%s,"wip":%s,"secretsDropped":%s,"containment":{"sameRepository":%s,"foreignProven":%s},"residueBytes":null,' \
    "$childof" "$(_json_str "$worktree")" "$( [[ -n "$RECLAIM_WIP" ]] && _json_str "$RECLAIM_WIP" || echo null)" \
    "$(_ws_reclaim_secrets_json)" "$same" "$foreign"
}

_ws_tombstone_patch() {   # id json-object -> merges its keys into the EXISTING tombstone and rewrites it
  #                          atomically; `secretsDropped` is UNIONED, every other key replaced. rc 1 when
  #                          the tombstone is missing or could not be rewritten.
  # `_ws_tombstone_reclip`'s shape, widened: the settle re-pin moves `tip` and
  # `wip`, and the residue probe fills `residueBytes`, both after the tombstone
  # was first written. A key this function never received is never touched.
  local id="$1" patch="$2" f="$REG/.reaped/$1.json"
  [[ -s "$f" ]] || return 1
  printf '%s' "$patch" | LC_ALL=C.UTF-8 python3 -c '
import json, os, sys
path = sys.argv[1]
patch = json.loads(sys.stdin.read())
with open(path, "r", encoding="utf-8") as fh:
    doc = json.load(fh)
for k, v in patch.items():
    if k == "secretsDropped" and isinstance(doc.get(k), list) and isinstance(v, list):
        doc[k] = sorted(set(doc[k]) | set(v))
    else:
        doc[k] = v
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, separators=(",", ":"))
os.replace(tmp, path)
' "$f" 2>/dev/null
}
```

- [ ] **Step 4: Give `_ws_tombstone` its optional third argument**

In `_ws_tombstone`, the third `printf` of the `{ … } > "$f"` block changes from

```bash
    printf '"ignored":%s,"clips":%s,"transcript":%s,"attic":%s,"reflog":%s,"children":%s,"reapedAt":%s}\n' \
      "$ign_json" "$clips" "$(_json_str "$transcript")" "$attic_json" "$(_json_str "$reflog")" \
      "$children_json" "$(date +%s)"
```

to

```bash
    printf '"ignored":%s,"clips":%s,"transcript":%s,"attic":%s,"reflog":%s,"children":%s,%s"reapedAt":%s}\n' \
      "$ign_json" "$clips" "$(_json_str "$transcript")" "$attic_json" "$(_json_str "$reflog")" \
      "$children_json" "${3-}" "$(date +%s)"
```

and its signature line — the SAME line, so no anchor below it moves — becomes `_ws_tombstone() {   # id clipsjson [reclaim-fragment: ws-reclaim's keys, ending in a comma; ws-reap never passes it] -> writes .reaped/<id>.json, echoes its path`. The edit changes three existing lines and adds none: nothing below `_ws_tombstone` shifts.

- [ ] **Step 5: Re-stamp ccd, run the tests to verify they pass**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts test/ccd-child-reclaim-ladder.test.ts \
  test/ccd-ws-reap.test.ts test/ownership.test.ts test/wsaudit.test.ts)
```

Expected: PASS. `ccd-ws-reap` is the proof the two-argument tombstone did not move: its tombstone-reading cases are unchanged.

- [ ] **Step 6: Pay the citation-corpus tax (S6-R11)**

Run procedure S6-R11. Step 4 adds no line, so the only insertion is the pin functions near the end of the file; apply steps 2–4 if step 1 is red, naming that insertion as the cause.

- [ ] **Step 7: Mutation check, then commit**

| # | Edit (one at a time; re-stamp; restore; re-stamp) | Command | Expected red |
|---|---|---|---|
| 1 | In `_ws_wip_commit`, replace the whole `if (( ${#RECLAIM_STAGE[@]} )); then … fi` block with `git -C "$dir" add -A 2>"$errf" \|\| { RECLAIM_WIP_WHY=x; rm -f "$errf"; return 1; }` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts -t 'NEVER a secret'` | `.env was committed — and would be pinned permanently in a public repository` |
| 2 | Drop `-c core.hooksPath=/dev/null` from the `git commit` | same file, `-t 'runs NO hook'` | `prepare-commit-msg ran: expected true to be false` |
| 3 | Drop the four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` assignments in front of the `git commit` | same file, `-t 'written as ccrc'` | `expected 'intruder <intruder@x>|intruder <intruder@x>|…' to be 'ccrc reclaim <ccrc-reclaim@invalid>|…'` |
| 4 | In `_ws_reclaim_pin`, move step (0)'s `for h in REBASE_HEAD …; done` loop to just after `RECLAIM_WIP="$RECLAIM_WIP_SHA"` | same file, `-t 'operation heads'` | `MERGE_HEAD <sha> is not pinned` — the heads are `commit-tree` objects in no reflog, so `_ws_attic_pin` cannot pin them behind step (0)'s back (the two CONTROL assertions prove it before the pin runs) |
| 5 | In `_ws_reclaim_attic_extra`, change `git -C "$main" cat-file -e "${sha}^{commit}" 2>/dev/null \|\| return 1` to `… \|\| continue` | same file, `-t 'not a COMMIT'` | `expected '0' to be '1'` — a tree sha sails past, and `update-ref` writes it (it refuses only a NONEXISTENT object, which is why this row does not run against `'FAILS — never skips'`: there `update-ref` would still return 1 and the row would be green, the survivor `_ws_attic_pin`'s own header already records) |
| 6 | In `_ws_reclaim_classify`, delete `if [[ "$p" == */ && -e "$dir/${p%/}/.git" ]]; then continue; fi` | same file, `-t 'never stages it as a gitlink'` | `the parent staged the nested checkout: expected [ 'inner' ] to deeply equal []` |
| 7 | In `_ws_tombstone`, restore the original third `printf` (no `%s`, no `"${3-}"`) | same file, `-t 'carries the reclaim record'` | the key list lacks `mode … residueBytes` |
| 8 | In `_ws_reclaim_attic_extra`, change `git -C "$main" update-ref "refs/ccrc/attic/$id/$sha" "$sha" 2>/dev/null \|\| return 1` to `… \|\| continue` | same file, `-t 'attic ref itself cannot be written'` | `expected '0' to be '1'` — a pin that was never written reported as kept |

Restore everything, re-stamp, re-run Step 5 (green), then:

```bash
git add ccd/ccd server/test/ccd-child-reclaim-pin.test.ts \
  $(git diff --name-only -- server/test/session-hook.test.ts README.md)   # S6-R11's edits, when there were any
git commit -m "$(cat <<'MSG'
feat(ccd): the reclaim pin phase — one WIP commit, every pin, the record

_ws_wip_commit is the only git commit in ccd (spec 2026-09-22 §5.5): tracked
edits and the classifier's non-secret untracked paths, NUL-separated literal
pathspecs, a fixed ccrc identity in both config and environment, no hook of
the repository run. A secret-shaped path is never staged, and the tests read
the resulting TREE to prove it. _ws_reclaim_pin pins the operation heads
before the commit can conclude them, then the WIP commit, HEAD, every stash
of the branch and every same-repository nested checkout; a pin it cannot
take is a failure, never a skip. The tombstone gains mode, childOf,
worktree, wip, secretsDropped, containment and residueBytes through an
optional third argument that leaves ws-reap's tombstone byte-identical.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The verb — `cmd_ws_reclaim`, its own tail arm, the resume, and `ws-reap`'s mirror

**Model routing:** **`opus`, effort `high`** — the contract's own row: the tail arm is the destructive half of the only destructive wave. This task's diff is the heart of the mandatory safety lens.

**Files:**
- Modify: `ccd/ccd` — append the verb's functions inside the region, directly ABOVE `# ── end child reclamation`; ONE block at the top of `_ws_reap_locked`'s resume fork (the `if [[ -n "$resumed" ]]; then` directly under `local resumed; resumed=$(_reg_get "$id" reaping)`, `ccd/ccd:13653-13654` at `f5dc495b`)
- Modify: `shared/api.ts` — `LcRefusalToken` gains `'pin-failed'` and `'unit-still-active'`, `LC_REFUSAL_WORD` their words; `LifecycleMeas` and `LIFECYCLE_MEAS_KEY_MAP` gain `childOf`, `wip` and `residueBytes` — the three `meas.` keys this verb journals that no L0 declaration has today
- Modify: `server/src/coord/journalparse.ts` — `reviveMeas` carries the three keys (it returns a literal, so a new `LifecycleMeas` member is a compile error until it does)
- Modify: `server/test/ccd-lifecycle-contain.test.ts` — the `meas.` census cardinal 29→32, its cause named; `server/test/lifecycle-wire.test.ts` — the sorted key list and its two `LifecycleMeas` literals
- Modify: `server/src/wsaudit.ts` — `SENTENCES` gains `reap-in-progress` and `reclaim-in-progress`
- Modify: `server/test/childReclaimFixture.ts` — append `childReclaimVerb`
- Modify: `server/test/ccd-refusal-scan.test.ts` — `VERBS`, `SANCTIONED` (6→13), two new pins
- Modify: `server/test/lifecycle-refusal-word.test.ts` — `ALL_TOKENS` gains `pin-failed` and `unit-still-active` (12→14)
- Test: `server/test/ccd-child-reclaim-verb.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 2 and 3 (`_ws_reclaim_eval` with its `RECLAIM_WORKTREE` and `RECLAIM_HEAD`, `_ws_reclaim_resume_eval`, `_ws_reclaim_record`, `_ws_reclaim_stash_shas`, `_ws_reclaim_attic_extra`, `_ws_reclaim_pin`, `_ws_reclaim_tomb_fields`, `_ws_reclaim_secrets_json`, `_ws_tombstone_patch`, `_ws_reclaim_normalise`, `_ws_reclaim_reset`); the existing `_ws_unsupervise`, `_svc_is_active`, `_tmux`, `_ws_tomb_str`, `_ws_tomb_children`, `_ws_branch_holders`, `_ws_clip_manifest`, `_ws_tombstone`, `_ws_gc_bytes`, `_reg_purge` (and `REG_PURGE_UNREMOVED`), `_compact_lock_why_remedy`, `_lc_tx`, `_lc_intent`, `_lc_done`, `_lc_fail`, `_lc_emit`, `_lc_refuse`, `_lc_surface_norm`, `_lc_dec_ok`, `_LC_DEC_MAX`, `_json_str`.
- Produces:
  - `ccd ws-reclaim --expect <64 hex> --child-of <runId> --session <id> [--defer-expired] [--surface <w>] [--actor <t>] [--reason <t>]` as the function `cmd_ws_reclaim` (the dispatcher arm lands in Task 5). stdout is ONE JSON line: `{"reclaimed":"<id>","childOf":<n>,"wip":"<40 hex>"|null,"attic":<n>,"residueBytes":<n>|null}` at exit 0; `{"refused":"<token>","detail":"…","paths":[]}` at exit 0 for the fourteen tokens; `{"failed":"<token>","detail":"…"}` at exit 1 once the act has started — or, as `probe-unmeasured`, when a ladder probe could not RUN inside the lock (Task 2's `_ws_reclaim_unmeasured`; nothing started, nothing journaled) — (`probe-unmeasured`, `pin-failed`, `unit-still-active`, `tombstone-unwritable`, `worktree-remove-failed`, `branch-moved`, `branch-elsewhere`, `reaping-phase-unknown`, `purge-refused`, `purge-incomplete`, `purge-mechanism-absent`); a usage error `die`s (exit 1, stderr, nothing opened). **These `failed` documents are RULED (contract §7 R11), not a question:** besides a refusal, `ws-reclaim` and `ws-audit --reclaim` may answer a `failed` document at exit 1 — `probe-unmeasured` for a probe that could not run (journaled nowhere: nothing started), and the post-start failures `pin-failed` and `unit-still-active`, journaled as `LcRefusalToken`s whose words live in `LC_REFUSAL_WORD`. The fourteen refusal tokens stay closed, and the executor maps EVERY `failed` document to the `failed` outcome (Task 8), which the sweep retries and the chip shows as deferred.
  - `_ws_reclaim_locked`, `_ws_reclaim_tail`, `_ws_reclaim_residue`, `_ws_reclaim_failed_json`, and `_ws_reclaim_pin_absent <id> <main> <branch> <recordhead>` — the pin phase of a child whose worktree has VANISHED (contract §8 R19): rc 0 once the branch tip, the stashes attributed to the branch and the HEAD git's record still names (`''` when there is no record) are pinned; rc 1 with `RECLAIM_PIN_WHY`; sets `REAP_TIP` and empties `RECLAIM_WIP`, `RECLAIM_SECRETS` and `REAP_CHILDLINES`.
  - The breadcrumb `$REG/<id>.reaping` = `reclaim:children` → `reclaim:worktree` → `reclaim:branch` → `reclaim:artifacts` (a child whose worktree had vanished starts at `reclaim:branch`: there is no tree for the first two steps); the shared lock `$REG/.reap-<id>.lock`.
  - Journal rows under act `reclaim`: one `refused` emit for every ladder refusal (`refusal` = the token), one for lock contention, and an `intent` … `done`/`failed` pair sharing one `tx` for every act that starts. The pair's `meas.` keys are ALL declared in `LifecycleMeas` (three of them — `childOf`, `wip`, `residueBytes` — by this task), so `reviveMeas` carries them into the mirror waves 4 and 5 read instead of dropping them at ingest. `meas.resumed` keeps the ONE meaning L0 already gives it — the PHASE a resumed act was interrupted at — on both rows of the pair, and is omitted on a fresh act (the encoder drops an empty value).
  - `ws-reap`'s resume fork refuses `reclaim-in-progress` on a `reclaim:` breadcrumb.
  - `server/test/childReclaimFixture.ts` gains `childReclaimVerb(h, token, opts)`.

**The order, and the reason for each piece of it** (spec §5.6):
1. The flavour fork runs BEFORE any eval: a non-`reclaim:` breadcrumb is `ws-reap`'s interrupted work and refuses `reap-in-progress`; a `reclaim:` breadcrumb runs `_ws_reclaim_resume_eval`, which re-asserts the marker against `--child-of`, the pause and the hold before anything else — a crash may not launder a refusal.
2. The token is recomputed inside the lock and compared; any drift is `state-changed`.
3. Fresh arm only: the pin phase, then the tombstone, then the breadcrumb `reclaim:children`. A failure here is `pin-failed`/`tombstone-unwritable` with NOTHING destroyed and no breadcrumb written.

   **Fresh arm, worktree VANISHED (spec §5.5; contract §8 R19).** When the eval answered over a gone workdir (`RECLAIM_WORKTREE=absent`), the pin phase is `_ws_reclaim_pin_absent`: the branch tip, the stashes attributed to the branch, and the HEAD git's record still names (a detached child's last commit is reachable from that record alone, and the tail clears the record) — nothing to commit, classify or descend. The tombstone is written with `worktree: absent`, and the breadcrumb starts at `reclaim:branch`, so the tail runs from the branch CAS on: branch → clips → temp root → residue → registry purge. Its step (1) — unsupervise, the anchored kill, the unit re-measured stopped — still runs FIRST on this arm, exactly as on every other: it is phase-independent (spec §5.6, "Unsupervise and pane-kill run first, unconditionally, on both the fresh and the resumed arm"; contract §3). R19's parenthetical lists unit/pane between the temp root and the purge; the spec, which outranks the contract, puts it first, and a unit still up must stop the tail before the branch goes (a case below pins exactly that). And git may still RECORD the vanished worktree (`prunable`), which names the branch — so the branch step first clears exactly that record (`git worktree remove` on a missing directory clears it with no force flag, measured on git 2.43; never `git worktree prune`, which is repository-wide), or its own holder check would read the child as another checkout and `branch-elsewhere` it for ever.
4. The tail, on the fresh arm AND every resumed one: unsupervise and the `=`-anchored pane kill FIRST, unconditionally — idempotent, and skipping them once leaves `claude-session@<id>.service` (Restart=always) respawning against a workspace with no row. `_ws_unsupervise` answers 0 whatever systemd did (a failed `_svc_disable_now` is a stderr warning only), so the tail RE-MEASURES the unit with `_svc_is_active` and fails `unit-still-active` — breadcrumb kept, nothing deleted — unless the manager answers `inactive` or `failed`; an empty answer is the manager not answering, which is unmeasured, never absent. Then the SETTLE — `_ws_reclaim_pin` again, now that the writer is dead, patching `tip`/`wip`/`secretsDropped` in the tombstone if it committed anything — then nested same-repository worktrees (innermost first, each re-proven to lie inside the child's own tree, removed and their branches CAS-deleted when no other worktree holds them), the worktree (`git worktree remove --force`: the secret-shaped files the pin phase refused to stage are still in it and die with it), the branch (git's own record of the workdir cleared first when the directory is gone and the record stands, then re-checked for another holder, then `update-ref -d` on the tombstone's tip), the clips and the temp root (each under the id re-check and the `pwd -P` direct-child equality, each normalised first so a mode-000 directory cannot survive the `rm -rf`), the residue probe (measured into the tombstone, never deleted), and `_reg_purge` LAST with `_ws_reap_tail`'s own three failure arms.

**The settle is this plan's reading of an ordering the spec leaves open**, and it is stated so a reviewer can check it rather than find it: spec §5.6 puts the pin phase before the pane kill (the tombstone must exist before the first destructive act), which leaves a window in which a still-running session can write after its WIP commit. Re-pinning once the pane is dead closes that window without moving the kill ahead of the tombstone. The WIP helper keeps one calling function; it is simply called twice by it.

- [ ] **Step 1: Write the failing test**

Append to `server/test/childReclaimFixture.ts`:

```ts

/** `ws-reclaim` through the sourced function, answering instead of throwing
 *  (a refusal exits 0, a failure 1, a usage error 1 with nothing on stdout).
 *  `CHILD_ENV` rides every call, so the residue probe never leaves the HOME. */
export function childReclaimVerb(
  h: PrHarness, token: string, opts: { childOf?: number; extra?: string; pre?: string } = {},
): { code: number; stdout: string; stderr: string } {
  return h.run(`${CHILD_STUBS} ${opts.pre ?? ''} ${CHILD_ENV} cmd_ws_reclaim --expect ${token}`
    + ` --child-of ${opts.childOf ?? CHILD_RUN} --session ${CHILD_ID} ${opts.extra ?? ''}`);
}
```

Create `server/test/ccd-child-reclaim-verb.test.ts`:

```ts
// `ws-reclaim` — the destructive verb for a CHILD (spec 2026-09-22 §5.5-§5.6).
// Every case builds a real child in a fixture HOME and runs the sourced
// function with the unit and pane calls RECORDED, never made. What is asserted
// is what is left on disk and in git afterwards — never what the verb says.
//
// The load-bearing pins (spec §9): `not-a-child` has no override on the fresh
// OR the resumed arm; the pause file is honoured INSIDE the verb; the WIP
// commit and the attic pins are read back from git refs; unsupervise runs on
// the resumed arm.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf, measOf, refusalsOf } from './lifecycleHelpers.js';
import { itLinux } from './platformFixtures.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, wideDigitLocale, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-verb-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.${field}`);
const tombOf = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`), 'utf8')) as Record<string, unknown>;
const atticShas = (c: Child): string[] =>
  h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`)
    .split('\n').filter(Boolean).map((r) => r.split('/').pop()!);
const KILL = `tmux kill-session -t =cc-${CHILD_ID}`;
const unsupervised = (): string[] => h.calls().filter((l) => l.startsWith('unsupervise'));

/** Everything a refusal must leave standing. */
const intact = (c: Child): void => {
  expect(fs.existsSync(c.wt), 'the worktree survives').toBe(true);
  expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
  expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
  expect(unsupervised(), 'the unit was not touched').toEqual([]);
  expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
};
const refusedWith = (r: { code: number; stdout: string; stderr: string }): string => {
  expect(r.code, `a refusal is an ANSWER — exit 0. stderr: ${r.stderr}`).toBe(0);
  const o = JSON.parse(r.stdout) as Record<string, unknown>;
  expect(o['reclaimed'], 'a refusal never also reports a reclaim').toBeUndefined();
  return String(o['refused']);
};
/** A previous reclaim that died right after its pin phase wrote the tombstone
 *  and the breadcrumb — and before its tail unsupervised or killed anything. */
const interrupted = (c: Child, phase: string): void => {
  h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null`
    + ` && _reg_set ${CHILD_ID} reaping reclaim:${phase}`);
  expect(h.reg(CHILD_ID, 'reaping')).toBe(`reclaim:${phase}`);
};
const resumeToken = (phase: string): string =>
  h.sh(`_ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} ${phase} >/dev/null; printf '%s' "$REAP_TOKEN"`);

describe('a fresh reclaim', () => {
  it('pins, then removes pane, unit, worktree, branch, clips, temp root and registry row — and keeps the record', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, 'notes.txt'), 'uncommitted work');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    fs.mkdirSync(path.join(h.home, '.cc-tmp', CHILD_ID, 'cdk.out'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-tmp', CHILD_ID, 'cdk.out', 'manifest.json'), '{}');
    const residue = path.join(h.home, 'residue', c.wt.replaceAll('/', '-'));
    fs.mkdirSync(residue, { recursive: true });
    fs.writeFileSync(path.join(residue, 'scratch.txt'), 'scratch the harness kept outside TMPDIR');
    const residueBytes = Number(h.sh(`_plat_bytes "${residue}"`));

    const r = childReclaimVerb(h, evalOf(h).token, { extra: "--surface agent --actor 'run:7 reclaim close'" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { reclaimed: string; childOf: number; wip: string; attic: number; residueBytes: number };
    expect(out.reclaimed).toBe(CHILD_ID);
    expect(out.childOf).toBe(CHILD_RUN);
    expect(out.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(out.residueBytes, 'measured').toBe(residueBytes);

    expect(fs.existsSync(c.wt), 'worktree').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    for (const field of ['uuid', 'child', 'reaping', 'workdir']) expect(h.reg(CHILD_ID, field), field).toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID)), 'clips').toBe(false);
    expect(fs.existsSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'temp root').toBe(false);
    expect(fs.existsSync(path.join(residue, 'scratch.txt')), 'the residue is MEASURED, never deleted').toBe(true);

    // The work is in the attic, read back from git — not from the verb's word.
    expect(atticShas(c)).toContain(out.wip);
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', out.wip).split('\n');
    expect(tree).toContain('notes.txt');
    expect(tree).not.toContain('.env');
    expect(out.attic).toBe(atticShas(c).length);

    // Unsupervise, then the ANCHORED kill — both, in that order.
    expect(unsupervised()).toEqual([`unsupervise ${CHILD_ID} agent agent`]);
    expect(h.calls()).toContain(KILL);
    expect(h.calls().indexOf(unsupervised()[0]!)).toBeLessThan(h.calls().indexOf(KILL));

    const tomb = tombOf();
    expect(tomb['mode']).toBe('reclaim');
    expect(tomb['wip']).toBe(out.wip);
    expect(tomb['secretsDropped']).toEqual(['.env']);
    expect(tomb['residueBytes']).toBe(residueBytes);

    const events = eventsOf(h.home, 'reclaim');
    const intent = events.find((e) => e['outcome'] === 'intent')!;
    const done = events.find((e) => e['outcome'] === 'done')!;
    expect(intent['tx'], 'one intent/done pair').toBe(done['tx']);
    expect(measOf(done)['childOf']).toBe(String(CHILD_RUN));
    expect(measOf(done)['wip']).toBe(out.wip);
    expect(measOf(done)['residueBytes']).toBe(String(residueBytes));
    // `resumed` is the PHASE a resumed act started at (L0's one meaning for it);
    // a fresh act resumed nothing, and the encoder omits an empty value.
    expect(measOf(intent)['resumed'], 'a fresh reclaim resumed nothing').toBeUndefined();
    expect(measOf(done)['resumed'], 'a fresh reclaim resumed nothing').toBeUndefined();
    expect(decOf(intent)['actor']).toBe('run:7 reclaim close');
  }, 90_000);

  it('reclaims a clean child with no WIP commit, deleting the branch at the tip it had', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token);
    const out = JSON.parse(r.stdout) as { wip: string | null };
    expect(out.wip).toBeNull();
    expect(atticShas(c)).toContain(c.tip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
  }, 90_000);
});

describe('a refusal destroys nothing, and every one is journaled', () => {
  it('refuses not-a-child when --child-of names another run — whatever else the argv carries', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    const r = childReclaimVerb(h, tok, { childOf: 8,
      extra: "--defer-expired --surface agent --actor 'run:8 reclaim sweep' --reason override" });
    expect(refusedWith(r)).toBe('not-a-child');
    intact(c);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'not-a-child' });
  }, 60_000);

  it('refuses paused when the kill-switch lands AFTER the token was minted — the verb reads it itself', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('paused');
    intact(c);
  }, 60_000);

  it('refuses held, and state-changed on a wrong token or on a tree that moved after the audit', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    expect(refusedWith(childReclaimVerb(h, 'f'.repeat(64)))).toBe('state-changed');
    fs.writeFileSync(path.join(c.wt, 'late.txt'), 'typed after the audit');
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('state-changed');
    fs.writeFileSync(reg('hold'), 'program:x wave:2/3');
    // The ladder refuses `held` before it ever compares a token.
    expect(refusedWith(childReclaimVerb(h, 'f'.repeat(64)))).toBe('held');
    intact(c);
  }, 90_000);

  it('--defer-expired is a fingerprint input: a token minted without it cannot be spent with it', () => {
    const c = makeChild(h);
    expect(refusedWith(childReclaimVerb(h, evalOf(h).token, { extra: '--defer-expired' }))).toBe('state-changed');
    intact(c);
    expect(JSON.parse(childReclaimVerb(h, evalOf(h, { defer: 1 }).token, { extra: '--defer-expired' }).stdout).reclaimed)
      .toBe(CHILD_ID);
  }, 90_000);

  it('refuses in-progress while another process holds the shared reap lock', () => {
    const c = makeChild(h);
    const lock = path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `exec 9>>"${lock}"; flock -n 9;` });
    expect(refusedWith(r)).toBe('in-progress');
    intact(c);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'in-progress' });
  }, 60_000);

  it('refuses reap-in-progress on a ws-reap breadcrumb — a reclaim never finishes another verb’s work', () => {
    const c = makeChild(h);
    h.sh(`_reg_set ${CHILD_ID} reaping worktree`);
    expect(refusedWith(childReclaimVerb(h, evalOf(h).token))).toBe('reap-in-progress');
    intact(c);
  }, 60_000);

  it('dies on a malformed argv BEFORE the lock, touching nothing', () => {
    const c = makeChild(h);
    const tok = 'a'.repeat(64);
    for (const [argv, said] of [
      [`--expect x --child-of 7 --session ${CHILD_ID}`, 'bad token'],
      [`--expect ${tok} --child-of 0 --session ${CHILD_ID}`, 'bad run id'],
      [`--expect ${tok} --child-of 07 --session ${CHILD_ID}`, 'bad run id'],
      [`--expect ${tok} --child-of 7 --session ../x`, 'bad session id'],
      [`--expect ${tok} --session ${CHILD_ID}`, 'usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id>'],
      [`--expect ${tok} --child-of 7 --session ${CHILD_ID} extra`, 'usage: ccd ws-reclaim'],
      [`--actor`, 'usage: ccd ws-reclaim'],
      [`--expect ${tok} --child-of 7 --session ${CHILD_ID} --actor ' '`, '--actor must be non-blank'],
    ] as const) {
      const r = h.run(`${CHILD_STUBS} cmd_ws_reclaim ${argv}`);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toContain(said);
    }
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`)), 'the lock was never opened').toBe(false);
    intact(c);
  }, 60_000);

  it('dies "bad run id" on a --child-of only a locale-widened range admits — the parse is `_child_runid_valid`', (ctx) => {
    const c = makeChild(h);
    const loc = wideDigitLocale(h);
    if (loc === '') { ctx.skip(); return; }
    const r = h.run(`${CHILD_STUBS} LC_ALL=${loc}; cmd_ws_reclaim --expect ${'a'.repeat(64)} --child-of '1²' --session ${CHILD_ID}`);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stderr).toContain('bad run id');
    intact(c);
  }, 60_000);

  it('a probe that could not RUN inside the lock is a FAILURE, never a refusal — exit 1, `probe-unmeasured`, nothing touched', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    const r = childReclaimVerb(h, tok, { pre: '_ws_reclaim_stash_shas() { return 1; };' });
    expect(r.code, r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(o['failed']).toBe('probe-unmeasured');
    expect(o['refused'], 'not one of the fourteen tokens, and no refusal').toBeUndefined();
    expect(h.reg(CHILD_ID, 'reaping'), 'nothing started: no breadcrumb').toBeNull();
    intact(c);
  }, 60_000);
});

describe('the resumed arm', () => {
  it('finishes an interrupted reclaim, and runs unsupervise and the anchored kill FIRST even though the dead run never did', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    expect(unsupervised(), 'the interrupted run died before its tail').toEqual([]);
    const r = childReclaimVerb(h, resumeToken('worktree'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(unsupervised(), 'a resumed reclaim that skipped this would leave a Restart=always unit with no row').toHaveLength(1);
    expect(h.calls()).toContain(KILL);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    const pair = eventsOf(h.home, 'reclaim');
    expect(measOf(pair.find((e) => e['outcome'] === 'intent')!)['resumed'], 'ONE meaning on both rows').toBe('worktree');
    expect(measOf(pair.find((e) => e['outcome'] === 'done')!)['resumed']).toBe('worktree');
  }, 90_000);

  it('does not let a crash launder a refusal — marker gone, marker unequal, or paused, the resume refuses', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('paused');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'));
    expect(refusedWith(childReclaimVerb(h, tok, { childOf: 8 }))).toBe('not-a-child');
    fs.rmSync(reg('child'));
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('not-a-child');
    expect(fs.existsSync(c.wt), 'nothing further was destroyed').toBe(true);
    expect(unsupervised()).toEqual([]);
  }, 90_000);

  it('fails reaping-phase-unknown on a reclaim breadcrumb it never writes, and deletes nothing', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    h.sh(`_reg_set ${CHILD_ID} reaping reclaim:bogus`);
    const r = childReclaimVerb(h, resumeToken('bogus'));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('reaping-phase-unknown');
    expect(fs.existsSync(c.wt)).toBe(true);
  }, 60_000);

  it('makes ws-reap refuse reclaim-in-progress on a reclaim breadcrumb — the mirror', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const r = h.run(`${CHILD_STUBS} cmd_ws_reap --expect ${'a'.repeat(64)} --session ${CHILD_ID}`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).refused).toBe('reclaim-in-progress');
    expect(fs.existsSync(c.wt)).toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
  }, 60_000);
});

describe('failures after the act started', () => {
  it('pin-failed destroys nothing, writes no breadcrumb, and stops before the unit is touched', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: '_ws_wip_commit() { RECLAIM_WIP_WHY="the disk is full"; return 1; };' });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ failed: 'pin-failed', detail: 'the disk is full' });
    expect(h.reg(CHILD_ID, 'reaping')).toBeNull();
    intact(c);
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'failed']);
  }, 60_000);

  it('a unit that is STILL UP after unsupervise stops the tail before its first deletion (unit-still-active)', () => {
    // `_ws_unsupervise` answers 0 whatever systemd did, so the tail re-measures.
    // `active` is a Restart=always unit that would respawn against a purged
    // row; an EMPTY answer is a manager that did not answer — unmeasured, and
    // refused the same way.
    for (const answer of ['active', '']) {
      const c = makeChild(h);
      const r = childReclaimVerb(h, evalOf(h).token, { pre: `_svc_is_active() { printf '${answer}'; };` });
      expect(r.code, answer).toBe(1);
      expect(JSON.parse(r.stdout).failed, answer).toBe('unit-still-active');
      expect(fs.existsSync(c.wt), 'nothing was deleted').toBe(true);
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays, for the retry').toBe('reclaim:children');
      expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'failed']);
      h.cleanup(); h = makePrHarness('ccrc-child-reclaim-verb-');
    }
  }, 120_000);

  it('a purge that cannot run leaves the breadcrumb at the artifacts step, for the resume', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: '_reg_purge() { return 2; };' });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('purge-mechanism-absent');
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:artifacts');
  }, 90_000);

  it('refuses to delete a branch that moved after it was pinned (branch-moved), or that another worktree now holds (branch-elsewhere)', () => {
    const c = makeChild(h);
    interrupted(c, 'branch');
    let r = childReclaimVerb(h, resumeToken('branch'));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed, 'the worktree still stands on it').toBe('branch-elsewhere');
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    h.git(c.main, 'branch', '-f', CHILD_BRANCH, 'main');
    r = childReclaimVerb(h, resumeToken('branch'));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('branch-moved');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
  }, 90_000);
});

describe('the settle', () => {
  it('pins what the session wrote between the pin phase and the kill, before any tree is touched', () => {
    const c = makeChild(h);
    const late = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; echo last-words > "${c.wt}/late.txt"; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre: late });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { wip: string };
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', out.wip).split('\n')).toContain('late.txt');
    expect(atticShas(c)).toContain(out.wip);
    expect(tombOf()['wip']).toBe(out.wip);
    expect(tombOf()['tip'], 'the tombstone names the tip the branch was deleted at').toBe(out.wip);
  }, 90_000);
});

describe('nested checkouts and artifacts', () => {
  it('pins and removes a nested worktree of this repository, and removes a proven-clean one of another', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'dirty.txt'), 'dirty');
    const origin = path.join(h.home, 'origins', 'other.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    const seedRepo = path.join(h.home, 'seed-other');
    execFileSync('git', ['init', '-q', '-b', 'main', seedRepo]);
    fs.writeFileSync(path.join(seedRepo, 'r'), 'r');
    h.git(seedRepo, 'add', 'r'); h.git(seedRepo, 'commit', '-m', 'r');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    execFileSync('git', ['clone', '-q', origin, path.join(c.wt, 'vendor', 'other')]);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went too').toBe('');
    const nestedWip = atticShas(c).find((sha) => {
      try { return h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('dirty.txt'); } catch { return false; }
    });
    expect(nestedWip, 'the nested checkout’s uncommitted work is in the attic').toBeDefined();
    const tomb = tombOf() as { containment: { sameRepository: string[]; foreignProven: string[] } };
    expect(tomb.containment.sameRepository.some((p) => p.endsWith('/inner'))).toBe(true);
    expect(tomb.containment.foreignProven.some((p) => p.endsWith('/vendor/other'))).toBe(true);
  }, 90_000);

  it('never follows a temp root that is a symlink out of ~/.cc-tmp', () => {
    makeChild(h);
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'not the child’s');
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.symlinkSync(outside, path.join(h.home, '.cc-tmp', CHILD_ID));
    expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(path.join(outside, 'keep')), 'the target is never followed').toBe(true);
    // …and the LINK itself is collected: wave 1's `_child_tmpdir` rc 2 leaves
    // this leaf in place, and a recycled slug would meet it on every spawn.
    expect(() => fs.lstatSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'the leaf symlink is unlinked').toThrow();
  }, 90_000);

  it('unlinks a temp-root leaf that is a regular FILE — the other shape wave 1 leaves behind', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-tmp', CHILD_ID), 'a file where the root should be');
    expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
    expect(() => fs.lstatSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'the leaf file is unlinked').toThrow();
    expect(fs.existsSync(path.join(h.home, '.cc-tmp')), 'the root itself stays').toBe(true);
  }, 90_000);

  itLinux('removes a clips directory holding a mode-000 subdirectory — normalised, then removed', () => {
    makeChild(h);
    const locked = path.join(h.home, '.cc-clips', CHILD_ID, 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'x'), 'x');
    fs.chmodSync(locked, 0o000);
    try {
      expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
      expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID))).toBe(false);
    } finally { if (fs.existsSync(locked)) fs.chmodSync(locked, 0o755); }
  }, 90_000);
});

describe('a vanished worktree is reclaimed from what is left; a directory git does not record is refused (spec §5.5)', () => {
  it('pins the branch tip and its stashes, then removes branch, clips, temp root and row — the tombstone saying absent', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'stashed\n');
    h.git(c.wt, 'stash', 'push', '-m', 'kept');
    const stash = h.git(c.main, 'rev-parse', 'refs/stash');
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    fs.mkdirSync(path.join(h.home, '.cc-tmp', CHILD_ID, 'cdk.out'), { recursive: true });
    fs.rmSync(c.wt, { recursive: true, force: true });
    // The CONTROL: git still RECORDS the vanished worktree (`prunable`), and
    // that record names the branch — the tail must clear it before its CAS.
    expect(h.git(c.main, 'worktree', 'list', '--porcelain')).toMatch(/^prunable /m);

    const r = childReclaimVerb(h, evalOf(h).token, { extra: "--surface agent --actor 'run:7 reclaim sweep'" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { reclaimed: string; wip: string | null; attic: number };
    expect(out.reclaimed).toBe(CHILD_ID);
    expect(out.wip, 'no tree, so no WIP commit').toBeNull();

    const attic = atticShas(c);
    expect(attic, 'the branch tip is pinned').toContain(c.tip);
    expect(attic, 'the stash attributed to the branch is pinned').toContain(stash);
    expect(out.attic).toBe(attic.length);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s stale record was cleared').not.toMatch(/^prunable /m);
    expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID)), 'clips').toBe(false);
    expect(fs.existsSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'temp root').toBe(false);
    for (const field of ['uuid', 'child', 'reaping', 'workdir']) expect(h.reg(CHILD_ID, field), field).toBeNull();
    // Unsupervise and the ANCHORED kill run FIRST on this arm too (spec §5.6).
    expect(unsupervised()).toEqual([`unsupervise ${CHILD_ID} agent agent`]);
    expect(h.calls()).toContain(KILL);

    const tomb = tombOf();
    expect(tomb['worktree']).toBe('absent');
    expect(tomb['tip'], 'the tip the branch was deleted at').toBe(c.tip);
    expect(tomb['wip']).toBeNull();
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  }, 90_000);

  it('with git’s record already gone too, the registry’s branch is reclaimed and its tip is what is pinned', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    h.git(c.main, 'worktree', 'prune');                     // the fixture repository only
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the branch tip is pinned — no record is left to name it').toContain(c.tip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    expect(tombOf()['worktree']).toBe('absent');
  }, 90_000);

  it('pins a DETACHED child’s last commit — reachable from git’s record alone — before the record is cleared', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '--detach');
    fs.writeFileSync(path.join(c.wt, 'detached.txt'), 'on no branch');
    h.git(c.wt, 'add', 'detached.txt');
    h.git(c.wt, 'commit', '-m', 'detached work');
    const detached = h.git(c.wt, 'rev-parse', 'HEAD');
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the detached commit is in the attic').toContain(detached);
    expect(h.git(c.main, 'cat-file', '-t', detached)).toBe('commit');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the registry’s branch went, at the tip it had').toBe('');
    expect(tombOf()['worktree']).toBe('absent');
  }, 90_000);

  it('a pin it cannot take stops the vanished arm before anything is touched — pin-failed, no breadcrumb', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const pre = `_ws_reclaim_stash_shas() { echo ${'d'.repeat(40)}; };`;
    const r = childReclaimVerb(h, evalOf(h, { pre }).token, { pre });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('pin-failed');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 60_000);

  it('a unit STILL UP stops the vanished arm before the branch goes — the tail starts at the branch, unit first', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `_svc_is_active() { printf active; };` });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('unit-still-active');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'nothing was deleted').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'reaping'), 'the vanished arm resumes from the branch').toBe('reclaim:branch');
    expect(tombOf()['worktree']).toBe('absent');
  }, 60_000);

  it('refuses no-worktree-record — TERMINAL, journaled — for a directory git does not record, and deletes nothing', () => {
    const c = makeChild(h);
    const admin = path.join(c.main, '.git', 'worktrees', 'quiet-basin');
    expect(fs.existsSync(admin), 'the CONTROL: git names the admin directory after the worktree basename').toBe(true);
    fs.rmSync(admin, { recursive: true, force: true });
    expect(refusedWith(childReclaimVerb(h, 'f'.repeat(64)))).toBe('no-worktree-record');
    intact(c);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'no-worktree-record' });
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`)), 'no tombstone').toBe(false);
  }, 60_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts)
```

Expected: FAIL. Every case that calls `childReclaimVerb` gets `code 127` or an unparseable stdout (`cmd_ws_reclaim: command not found`); `refusedWith` fails on `expected 127 to be 0` or on `JSON.parse`; the mirror case fails with `expected 'status-unknown' to be 'reclaim-in-progress'` (measured against a prototype) — today's `ws-reap` resume path re-proves a reclaim's breadcrumb as if it were its own and stops only at its liveness rung; the `dies on a malformed argv` case fails its first row on `expected 127 to be 1`.

- [ ] **Step 3: Write the verb and its tail**

Insert directly ABOVE `# ── end child reclamation` in `ccd/ccd`, one blank line on each side (`_ws_reclaim_pin_absent` is the vanished-worktree pin — contract §8 R19; its call and the tail's record-clear are in `_ws_reclaim_locked` and step (5) below):

```bash
_ws_reclaim_pin_absent() {   # id main branch recordhead -> 0 once the branch tip, the stashes attributed to
  #                               the branch and git's recorded HEAD ('' = no record) are pinned; 1 with
  #                               RECLAIM_PIN_WHY. Sets REAP_TIP; empties RECLAIM_WIP, RECLAIM_SECRETS and
  #                               REAP_CHILDLINES — there is no tree to commit, classify or descend.
  # THE PIN PHASE OF A CHILD WHOSE WORKTREE HAS VANISHED (spec §5.5, "A
  # vanished worktree is not a refusal"). What is left is kept: the branch tip,
  # every stash attributed to the branch (`_ws_reclaim_stash_shas` reads them
  # from $main, where they live), and the HEAD git's record of the vanished
  # worktree still names — `_ws_reclaim_eval_absent` read it inside the lock,
  # and it is the one place a DETACHED child's last commit is reachable from,
  # which the tail's branch step is about to clear. Every pin is a failure,
  # never a skip (`_ws_reclaim_attic_extra`), exactly as on the fresh arm.
  local id="$1" main="$2" branch="$3" rhead="$4" stashes sha extras=()
  RECLAIM_PIN_WHY=""; RECLAIM_WIP=""; RECLAIM_SECRETS=(); REAP_CHILDLINES=""
  REAP_TIP=$(git -C "$main" rev-parse --verify --quiet "refs/heads/$branch^{commit}" 2>/dev/null) || REAP_TIP=""
  stashes=$(_ws_reclaim_stash_shas "$main" "$branch") \
    || { RECLAIM_PIN_WHY="could not read the stash list of $main"; return 1; }
  extras=("$REAP_TIP" "$rhead")
  while IFS= read -r sha; do [[ -n "$sha" ]] && extras+=("$sha"); done <<< "$stashes"
  _ws_reclaim_attic_extra "$main" "$id" "${extras[@]}" \
    || { RECLAIM_PIN_WHY="a commit this reclaim must keep could not be pinned under refs/ccrc/attic/$id/"; return 1; }
  return 0
}

_ws_reclaim_residue() {   # workdir -> bytes under the harness's path-keyed temp dir for it, 0 when
  #                            there is none, `null` when it could not be FULLY measured
  # THE RESIDUE PROBE (spec §5.2), and it MEASURES, it never deletes. Claude
  # Code keys its per-uid temp dir on the session's cwd with `/` turned into `-`
  # (`ccd/ccd-tmp-sweep`'s own header states the layout), so this is the one
  # place a child's scratch is KNOWN to land outside its worktree and its temp
  # root when the harness does not follow TMPDIR. Deleting it is forbidden: a
  # directory keyed on a workspace PATH can be shared by two live sessions, and
  # `ccd-tmp-sweep` already collects it by session id. The number turns rule 2's
  # bounded claim into a measurement. `CCD_RECLAIM_RESIDUE_ROOT` overrides the
  # root for the test harness only.
  local root="${CCD_RECLAIM_RESIDUE_ROOT:-/tmp/claude-$(id -u)}" d b
  d="$root/${1//\//-}"
  [[ -e "$d" ]] || { echo 0; return 0; }
  b=$(_ws_gc_bytes "$d")
  if [[ "$b" =~ ^[0-9]+$ ]]; then echo "$b"; else echo null; fi
}

_ws_reclaim_failed_json() {   # token detail -> the post-start failure document on stdout.
  # `"failed"`, NEVER `"refused"`: a failure after the act started is not a
  # ladder answer, and `server/test/wsaudit.test.ts` harvests every literal
  # `"refused":"…"` as one. The server reads this as `failed` and retries.
  printf '{"failed":%s,"detail":%s}\n' "$(_json_str "$1")" "$(_json_str "$2")"
}

_ws_reclaim_tail() {   # id phase lctx childof surface declared resumed(phase|'') — the journalled
  #                        destructive sequence for a CHILD. Its OWN arm (spec §5.6), never
  #                        `_ws_reap_tail`: that tail refuses `not-archived` (a child never is) and
  #                        skips unsupervise and the pane kill on resume (safe there only because
  #                        `ws-archive` did both first — nothing did for a child).
  local id="$1" phase="$2" lctx="$3" childof="$4" surface="$5" declared="$6" resumed="$7"
  local project workdir main tomb branch tip wip attic residue wtout stamp unitstate rec
  local childlines cline cpath crest cbr chead holders wdreal tdir troot cdir croot
  project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir)
  main="$PROJECTS_ROOT/$project"
  tomb="$REG/.reaped/$id.json"
  case "$phase" in
    children|worktree|branch|artifacts) : ;;
    *)
      _lc_fail reclaim "$id" "$lctx" reaping-phase-unknown \
        "breadcrumb phase 'reclaim:$phase' for $id is not one ccd ever writes — refusing to guess which steps already ran" verb ws-reclaim
      _ws_reclaim_failed_json reaping-phase-unknown "breadcrumb phase 'reclaim:$phase' for $id is not one ccd ever writes — refusing to guess which steps already ran"
      return 1 ;;
  esac
  # THE TOMBSTONE IS THE ONE SOURCE for what this tail deletes, fresh and
  # resumed alike: the fresh arm wrote it a moment ago, the resumed arm finds it.
  branch=$(_ws_tomb_str "$tomb" branch) || branch=""
  tip=$(_ws_tomb_str "$tomb" tip) || tip=""
  wip=$(_ws_tomb_str "$tomb" wip) || wip=""
  if [[ -z "$branch" ]]; then
    _lc_fail reclaim "$id" "$lctx" tombstone-unwritable "could not read the tombstone at $tomb — refusing to delete anything it does not describe" verb ws-reclaim
    _ws_reclaim_failed_json tombstone-unwritable "could not read the tombstone at $tomb — refusing to delete anything it does not describe"
    return 1
  fi
  # (1) UNSUPERVISE AND KILL THE PANE — FIRST, UNCONDITIONALLY, on the fresh arm
  # AND on every resumed one (spec §5.6), whatever phase the tail enters at —
  # the vanished-worktree arm, entering at the branch, included: a session whose
  # tree is gone can still be up. Both are idempotent: running them twice
  # costs nothing, and skipping them once leaves `claude-session@<id>.service`
  # (Restart=always) respawning forever against a workspace with no row. The
  # target is ANCHORED (`=`) — a bare `cc-<id>` is an fnmatch pattern (D-2780).
  stamp=ccd
  case "$surface" in cli|pwa|agent) stamp="$surface" ;; esac
  _ws_unsupervise "$id" "$stamp" "$declared"
  tmux kill-session -t "=$(_tmux "$id")" 2>/dev/null || true
  # RE-MEASURED, because `_ws_unsupervise` answers 0 whatever systemd did: a
  # failed `_svc_disable_now` is a stderr warning and nothing more. A unit that
  # is still up is exactly the Restart=always hazard this arm exists for (spec
  # §5.6), so nothing is deleted past it: the breadcrumb stays at its phase and
  # the next attempt re-runs this step first. Only a POSITIVE stopped answer
  # passes — `inactive`, or `failed` (a failed unit is not restarted). An EMPTY
  # answer is the manager not answering (`_svc_is_active`'s own three-way
  # contract), which is unmeasured, and unmeasured is not absence.
  unitstate=$(_svc_is_active "claude-session@$id")
  case "$unitstate" in
    inactive|failed) : ;;
    *)
      _lc_fail reclaim "$id" "$lctx" unit-still-active \
        "claude-session@$id answered '${unitstate:-no answer}' after it was disabled — nothing was deleted, and the next attempt disables it again" verb ws-reclaim
      _ws_reclaim_failed_json unit-still-active "claude-session@$id answered '${unitstate:-no answer}' after it was disabled — nothing was deleted"
      return 1 ;;
  esac
  # (2) THE SETTLE: the session is dead now, so anything it wrote between the
  # pin phase and the kill is pinned before any tree is touched.
  if [[ ( "$phase" == children || "$phase" == worktree ) && -d "$workdir" ]]; then
    if ! _ws_reclaim_pin "$id" "$workdir" "$main" "$branch" "$childof"; then
      _lc_fail reclaim "$id" "$lctx" pin-failed "$RECLAIM_PIN_WHY" verb ws-reclaim
      _ws_reclaim_failed_json pin-failed "$RECLAIM_PIN_WHY"
      return 1
    fi
    if [[ -n "$RECLAIM_WIP" || "$REAP_TIP" != "$tip" ]]; then
      [[ -n "$RECLAIM_WIP" ]] && wip="$RECLAIM_WIP"
      tip="$REAP_TIP"
      if ! _ws_tombstone_patch "$id" "$(printf '{"tip":%s,"wip":%s,"secretsDropped":%s}' \
             "$(_json_str "$tip")" "$( [[ -n "$wip" ]] && _json_str "$wip" || echo null)" \
             "$(_ws_reclaim_secrets_json)")"; then
        _lc_fail reclaim "$id" "$lctx" tombstone-unwritable "could not record the settle's WIP commit in $tomb — refusing to delete what the record does not name" verb ws-reclaim
        _ws_reclaim_failed_json tombstone-unwritable "could not record the settle's WIP commit in $tomb — refusing to delete what the record does not name"
        return 1
      fi
    fi
  fi
  # (3) Registered nested children of THIS repository, innermost first — each
  # re-proven inside the child's own tree, never trusted off the record alone.
  if [[ "$phase" == children ]]; then
    childlines=$(_ws_tomb_children "$tomb") || {
      _lc_fail reclaim "$id" "$lctx" tombstone-unwritable "could not read the nested checkouts from $tomb" verb ws-reclaim
      _ws_reclaim_failed_json tombstone-unwritable "could not read the nested checkouts from $tomb"
      return 1
    }
    wdreal=$(cd -- "$workdir" >/dev/null 2>&1 && pwd -P) || wdreal=""
    while IFS= read -r -u 9 cline; do
      [[ -n "$cline" ]] || continue
      cpath="${cline%%$'\t'*}"; crest="${cline#*$'\t'}"
      cbr="${crest%%$'\t'*}"; chead="${crest#*$'\t'}"
      [[ -n "$wdreal" && "$cpath" == "$wdreal"/* ]] || continue
      if [[ -d "$cpath" ]] && git -C "$main" worktree list --porcelain 2>/dev/null | grep -qxF "worktree $cpath"; then
        wtout=$(git -C "$main" worktree remove --force "$cpath" 2>&1) || {
          _lc_fail reclaim "$id" "$lctx" worktree-remove-failed "$(printf '%s' "$wtout" | head -3)" verb ws-reclaim
          _ws_reclaim_failed_json worktree-remove-failed "$(printf '%s' "$wtout" | head -3)"
          return 1
        }
      fi
      if [[ -n "$cbr" && -n "$chead" ]] && git -C "$main" show-ref --verify --quiet "refs/heads/$cbr"; then
        holders=$(_ws_branch_holders "$main" "$cbr") || holders="?"
        if [[ -z "$holders" ]]; then
          git -C "$main" update-ref -d "refs/heads/$cbr" "$chead" 2>/dev/null || {
            _lc_fail reclaim "$id" "$lctx" branch-moved "$cbr moved after it was pinned at $chead — nothing further was deleted" verb ws-reclaim
            _ws_reclaim_failed_json branch-moved "$cbr moved after it was pinned at $chead — nothing further was deleted"
            return 1
          }
        fi
      fi
    done 9< <(printf '%s\n' "$childlines" | awk -F'\t' '{ print length($1) "\t" $0 }' | LC_ALL=C sort -rn | cut -f2-)
    _reg_set "$id" reaping reclaim:worktree
    phase=worktree
  fi
  # (4) The worktree. `--force` because the secret-shaped files the pin phase
  # refused to stage are still in it, untracked, and die with the tree.
  if [[ "$phase" == worktree ]]; then
    if [[ -d "$workdir" ]]; then
      wtout=$(git -C "$main" worktree remove --force "$workdir" 2>&1) || {
        _lc_fail reclaim "$id" "$lctx" worktree-remove-failed "$(printf '%s' "$wtout" | head -3)" verb ws-reclaim
        _ws_reclaim_failed_json worktree-remove-failed "$(printf '%s' "$wtout" | head -3)"
        return 1
      }
    fi
    _reg_set "$id" reaping reclaim:branch
    phase=branch
  fi
  # (5) The branch, by CAS on the tip the tombstone recorded — never
  # `git branch` with a force flag. Re-checked for another holder first:
  # `update-ref -d` does not make the check `git branch -d` would.
  if [[ "$phase" == branch ]]; then
    # A VANISHED WORKTREE'S RECORD, cleared FIRST (spec §5.5). With the child's
    # directory gone, git may still RECORD it (`prunable`), and that record
    # names this branch: the holder check below would read the child itself as
    # another checkout — `branch-elsewhere`, for ever — and `git branch -d`
    # refuses "used by worktree" for the same reason. So exactly that record is
    # removed: `git worktree remove` on a missing directory clears its record
    # with no force flag (measured, git 2.43: rc 0, the admin directory gone),
    # and NEVER `git worktree prune`, which is repository-wide. Nothing stands
    # behind it; the HEAD it named was pinned before the breadcrumb was written.
    # A present tree's own record went with step (4), so this is a no-op there.
    if [[ ! -e "$workdir" && ! -L "$workdir" ]]; then
      _ws_reclaim_record "$main" "$workdir"; rec=$?
      if (( rec == 0 )); then
        wtout=$(git -C "$main" worktree remove "$workdir" 2>&1) || {
          _lc_fail reclaim "$id" "$lctx" worktree-remove-failed "$(printf '%s' "$wtout" | head -3)" verb ws-reclaim
          _ws_reclaim_failed_json worktree-remove-failed "$(printf '%s' "$wtout" | head -3)"
          return 1
        }
      fi
    fi
    if [[ -n "$tip" ]] && git -C "$main" show-ref --verify --quiet "refs/heads/$branch"; then
      holders=$(_ws_branch_holders "$main" "$branch") || {
        _lc_fail reclaim "$id" "$lctx" branch-elsewhere "could not enumerate $main's worktrees, so whether another checkout holds $branch was never asked — the branch was kept" verb ws-reclaim
        _ws_reclaim_failed_json branch-elsewhere "could not enumerate $main's worktrees, so whether another checkout holds $branch was never asked — the branch was kept"
        return 1
      }
      if [[ -n "$holders" ]]; then
        _lc_fail reclaim "$id" "$lctx" branch-elsewhere "$branch is now checked out at ${holders//$'\n'/, } — the branch was kept" verb ws-reclaim
        _ws_reclaim_failed_json branch-elsewhere "$branch is now checked out at ${holders//$'\n'/, } — the branch was kept"
        return 1
      fi
      git -C "$main" update-ref -d "refs/heads/$branch" "$tip" 2>/dev/null || {
        _lc_fail reclaim "$id" "$lctx" branch-moved "$branch moved after it was pinned at $tip — nothing further was deleted" verb ws-reclaim
        _ws_reclaim_failed_json branch-moved "$branch moved after it was pinned at $tip — nothing further was deleted"
        return 1
      }
    fi
    _reg_set "$id" reaping reclaim:artifacts
    phase=artifacts
  fi
  # (6) The artifacts (rule 2): the clips directory under its two existing
  # containment re-checks, then the per-session temp root under the SAME two —
  # the id's shape re-validated before any `rm -rf`, and the resolved path
  # (`pwd -P`, so a symlink cannot pass) a DIRECT child of its root. Each is
  # normalised first, so a mode-000 directory inside cannot survive the rm.
  if [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]]; then
    cdir=$(cd -- "$HOME/.cc-clips" >/dev/null 2>&1 && cd -- "./$id" >/dev/null 2>&1 && pwd -P) || cdir=""
    croot=$(cd -- "$HOME/.cc-clips" >/dev/null 2>&1 && pwd -P) || croot=""
    if [[ -n "$cdir" && -n "$croot" && "$cdir" == "$croot/$id" ]]; then
      _ws_reclaim_normalise "$cdir" || :
      rm -rf "$cdir"
    fi
    tdir=$(cd -- "$HOME/.cc-tmp" >/dev/null 2>&1 && cd -- "./$id" >/dev/null 2>&1 && pwd -P) || tdir=""
    troot=$(cd -- "$HOME/.cc-tmp" >/dev/null 2>&1 && pwd -P) || troot=""
    if [[ -n "$tdir" && -n "$troot" && "$tdir" == "$troot/$id" ]]; then
      _ws_reclaim_normalise "$tdir" || :
      rm -rf "$tdir"
    elif [[ -n "$troot" ]] && [[ -L "$troot/$id" || ( -e "$troot/$id" && ! -d "$troot/$id" ) ]]; then
      # A LEAF THAT IS NOT A DIRECTORY (spec §5.2, "A temp root that cannot be
      # made private is not used"). Wave 1's
      # `_child_tmpdir` (its rc 2) composes TMPDIR only for a leaf that is, or
      # was just made, a real directory owned by this uid with mode 0700; any
      # other leaf — a symlink, a regular file — is left exactly where it was
      # found at `$HOME/.cc-tmp/<id>`, and that child spawns without TMPDIR. Left here,
      # it outlives the reclaim, and the next child minted under this recycled
      # slug meets the same leaf and spawns uncontained on every spawn. So it is
      # UNLINKED, never followed: `-L` is asked first, the path is the literal
      # leaf under the resolved root (the id re-validated above), and `rm -f --`
      # never recurses — a symlink's target, wherever it points, is untouched.
      rm -f -- "$troot/$id" 2>/dev/null || :
    fi
  fi
  # (7) The residue probe — measured, never deleted — recorded before the row goes.
  residue=$(_ws_reclaim_residue "$workdir")
  _ws_tombstone_patch "$id" "{\"residueBytes\":$residue}" || :   # a failed patch leaves null: unmeasured, never 0
  attic=$(git -C "$main" for-each-ref --format='%(refname)' "refs/ccrc/attic/$id/" 2>/dev/null | grep -c . || true)
  # (8) The registry row LAST — the same three failure arms `_ws_reap_tail` (i)
  # carries, because they are `_reg_purge`'s answers, not reap's.
  local _rcl_prc=0
  _reg_purge "$id" || _rcl_prc=$?
  if (( _rcl_prc == 3 )); then
    _lc_fail reclaim "$id" "$lctx" purge-incomplete \
      "the reclaim completed — worktree, branch, clips and temp root are gone — and the registry row WAS purged, but $REG_PURGE_UNREMOVED could not be removed and still stands" \
      verb ws-reclaim meas.branch "$branch" meas.unremoved "$REG_PURGE_UNREMOVED"
    _ws_reclaim_failed_json purge-incomplete "the registry row was purged, but $REG_PURGE_UNREMOVED could not be removed"
    return 1
  elif (( _rcl_prc == 2 )); then
    _lc_fail reclaim "$id" "$lctx" purge-mechanism-absent \
      "the reclaim completed — worktree, branch, clips and temp root are gone — but the registry row could not be purged: the compaction lock's mechanism is absent on this box while $REG/$id.generation is present" \
      verb ws-reclaim meas.branch "$branch"
    _ws_reclaim_failed_json purge-mechanism-absent "the registry row could not be purged: the compaction lock's mechanism is absent on this box"
    return 1
  elif (( _rcl_prc != 0 )); then
    local _rcl_why; _rcl_why=$(_compact_lock_why_remedy "$id" ws-reclaim)
    _lc_fail reclaim "$id" "$lctx" purge-refused \
      "the reclaim completed — worktree, branch, clips and temp root are gone — but the registry row could not be purged: $_rcl_why" \
      verb ws-reclaim meas.branch "$branch"
    _ws_reclaim_failed_json purge-refused "the registry row could not be purged: $_rcl_why"
    return 1
  fi
  _lc_done reclaim "$id" "$lctx" verb ws-reclaim meas.childOf "$childof" meas.branch "$branch" \
    meas.tip "$tip" meas.wip "$wip" meas.tombstone "$tomb" meas.attic "${attic:-0}" \
    meas.residueBytes "$residue" meas.resumed "$resumed"
  printf '{"reclaimed":%s,"childOf":%s,"wip":%s,"attic":%s,"residueBytes":%s}\n' \
    "$(_json_str "$id")" "$childof" "$( [[ -n "$wip" ]] && _json_str "$wip" || echo null)" \
    "${attic:-0}" "$residue"
}

cmd_ws_reclaim() {   # ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]
  # THE DESTRUCTIVE VERB FOR A CHILD, composed by the server and by nothing else
  # (CLAUDE.md SAFETY: forbidden to every session). Two authorities must agree —
  # the box's `.child` marker and this `--child-of` — AND the token `ws-audit
  # --reclaim` minted must equal the one recomputed here, inside the reap lock,
  # at the instant of deletion (spec §5.1, §5.5). stdout is ONE JSON line:
  # `{"reclaimed":…}`, `{"refused":…}` at exit 0 (an answer, not an error), or
  # `{"failed":…}` at exit 1 (the act started and broke; the breadcrumb resumes it).
  local lc_surface=none lc_actor='' lc_reason='' lc_gs=0 lc_ga=0 lc_gr=0 defer=0 args=()
  while (( $# )); do
    case "$1" in
      --defer-expired) defer=1; shift ;;
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] || die "usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
      --reason)    [[ $# -ge 2 ]] || die "usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_gr=1; lc_reason="$2"; shift 2 ;;
      --reason=*)  lc_gr=1; lc_reason="${1#--reason=}"; shift ;;
      *)           args+=("$1"); shift ;;
    esac
  done
  if (( lc_gs )); then local lc_w; lc_w=$(_lc_surface_norm "$lc_surface"); lc_surface=${lc_w:-unknown}; fi
  if (( lc_ga )); then
    [[ -n "${lc_actor//[[:space:]]/}" ]] || die "--actor must be non-blank"
    _lc_dec_ok "$lc_actor" || die "--actor is longer than $_LC_DEC_MAX bytes"
  fi
  if (( lc_gr )); then
    [[ -n "${lc_reason//[[:space:]]/}" ]] || die "--reason must be non-blank"
    _lc_dec_ok "$lc_reason" || die "--reason is longer than $_LC_DEC_MAX bytes"
  fi
  set -- ${args[@]+"${args[@]}"}
  [[ $# -eq 6 && $1 == --expect && $3 == --child-of && $5 == --session ]] \
    || die "usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]"
  local token=$2 childof=$4 id=$6
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || die "bad token"
  _child_runid_valid "$childof"          || die "bad run id"   # wave 1's grammar, ASCII under LC_ALL=C
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]]         || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the reclaim record safely"
  # THE SHARED LOCK (spec §5.6): `$REG/.reap-<id>.lock`, the SAME file ws-reap
  # takes, so reap and reclaim never run on one workspace at once. flock, never
  # mkdir+trap — `cmd_ws_reap`'s own comment argues why at length.
  local lock="$REG/.reap-$id.lock" lfd rc=0
  command -v flock >/dev/null 2>&1 \
    || _lc_refuse reclaim "$id" flock-unavailable \
         "flock (util-linux) is unavailable — refusing to run the destructive verb unserialised"
  exec {lfd}>>"$lock" \
    || _lc_refuse reclaim "$id" lock-unopenable "cannot open the reap lock at $lock"
  flock -n "$lfd" || {
    _lc_emit reclaim refused "$id" "" verb ws-reclaim refusal in-progress \
      detail "another ccd process is already reaping or reclaiming $id and still holds the lock"
    exec {lfd}>&-
    printf '{"refused":"in-progress","detail":%s,"paths":[]}\n' \
      "$(_json_str "another ccd process is already reaping or reclaiming $id and still holds the lock")"
    return 0
  }
  _ws_reclaim_locked "$token" "$childof" "$id" "$defer" "$lc_surface" "$lc_actor" "$lc_reason"; rc=$?
  exec {lfd}>&-
  return "$rc"
}

_ws_reclaim_locked() {   # token childof id defer surface actor reason — everything the shared lock serialises
  local token="$1" childof="$2" id="$3" defer="$4" surface="$5" actor="$6" reason="$7"
  local rbc phase="" resumed="" lctx project workdir main clips pinned=0 start=children
  rbc=$(_reg_get "$id" reaping) || rbc=""
  # THE FLAVOUR FORK, before any eval (spec §5.6): a `reclaim:` breadcrumb
  # resumes THIS verb's ladder; any other breadcrumb is ws-reap's interrupted
  # work, which a reclaim never finishes — and `ws-reap` refuses the mirror.
  if [[ -n "$rbc" && "$rbc" != reclaim:* ]]; then
    _ws_reclaim_reset
    _reap_refuse reap-in-progress "an interrupted ws-reap of $id stopped at its '$rbc' step — a reclaim never finishes another verb's work" || :
  elif [[ -n "$rbc" ]]; then
    # `resumed` carries the PHASE, as `LifecycleMeas.resumed` and ws-reap's own
    # `meas.resumed` do — never a 0/1 beside it — and is empty on a fresh act.
    phase="${rbc#reclaim:}"; resumed="$phase"
    _ws_reclaim_resume_eval "$id" "$defer" "$childof" "$phase" || :
  else
    _ws_reclaim_eval "$id" "$defer" "$childof" || :
  fi
  # 10 — the consent IS the fingerprint, recomputed HERE, inside the lock. A
  # server-side check fails open into deletion; this one cannot.
  if [[ "$REAP_VERDICT" == reclaimable && "$token" != "$REAP_TOKEN" ]]; then
    _reap_refuse state-changed "expected $REAP_TOKEN, was given $token — $id changed since the audit that minted the token" || :
  fi
  # A PROBE THAT COULD NOT RUN IS NOT A REFUSAL (`_ws_reclaim_unmeasured`).
  # Nothing was measured and nothing has started, so there is no refusal token
  # to journal and no intent to fail: a `"failed"` document at exit 1, which
  # the server reads as `failed` and retries, and which re-measures next time.
  if [[ "$REAP_VERDICT" == unmeasured ]]; then
    _ws_reclaim_failed_json probe-unmeasured "$REAP_DETAIL"
    return 1
  fi
  # ONE EMIT FOR EVERY REFUSAL — this verdict point — plus the flock decline in
  # `cmd_ws_reclaim`: exactly two refusal emits in this region, a count
  # `ccd-refusal-scan.test.ts` pins.
  if [[ "$REAP_VERDICT" != reclaimable ]]; then
    _lc_emit reclaim refused "$id" "" verb ws-reclaim refusal "$REAP_VERDICT" detail "$REAP_DETAIL" \
      dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
    printf '{"refused":%s,"detail":%s,"paths":[]}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_DETAIL")"
    return 0
  fi
  project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir); main="$PROJECTS_ROOT/$project"
  lctx=$(_lc_tx)
  _lc_intent reclaim "$id" "$lctx" verb ws-reclaim meas.childOf "$RECLAIM_CHILDOF" meas.project "$project" \
    meas.workdir "$workdir" meas.branch "$REAP_BRANCH" meas.resumed "$resumed" \
    dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
  if [[ -z "$phase" ]]; then
    # THE PIN PHASE, before anything is destroyed (spec §5.5), then the
    # tombstone, then the breadcrumb — so every later step is resumable and
    # every one of them is described by a record that outlives the row.
    # A VANISHED WORKTREE (spec §5.5; the eval answered over what is left):
    # its own pin — the tip, the branch's stashes, git's recorded HEAD — a
    # tombstone saying `worktree: absent`, and a tail that starts at the
    # branch, because there is no tree for the children and worktree steps.
    if [[ "$RECLAIM_WORKTREE" == absent ]]; then
      _ws_reclaim_pin_absent "$id" "$main" "$REAP_BRANCH" "$RECLAIM_HEAD" && pinned=1
      start=branch
    else
      _ws_reclaim_pin "$id" "$workdir" "$main" "$REAP_BRANCH" "$RECLAIM_CHILDOF" && pinned=1
    fi
    if (( ! pinned )); then
      _lc_fail reclaim "$id" "$lctx" pin-failed "$RECLAIM_PIN_WHY" verb ws-reclaim
      _ws_reclaim_failed_json pin-failed "$RECLAIM_PIN_WHY"
      return 1
    fi
    clips=$(_ws_clip_manifest "$id") || clips=null
    _ws_tombstone "$id" "$clips" "$(_ws_reclaim_tomb_fields "$RECLAIM_CHILDOF" "$RECLAIM_WORKTREE")" >/dev/null
    if [[ ! -s "$REG/.reaped/$id.json" ]] || ! _reg_set "$id" reaping "reclaim:$start"; then
      _lc_fail reclaim "$id" "$lctx" tombstone-unwritable "could not write the tombstone or the breadcrumb for $id — nothing was destroyed" verb ws-reclaim
      _ws_reclaim_failed_json tombstone-unwritable "could not write the tombstone or the breadcrumb for $id — nothing was destroyed"
      return 1
    fi
    phase="$start"
  fi
  _ws_reclaim_tail "$id" "$phase" "$lctx" "$RECLAIM_CHILDOF" "$surface" "$surface" "$resumed"
}
```

- [ ] **Step 4: Give `ws-reap` the mirror refusal**

In `_ws_reap_locked`, directly under `if [[ -n "$resumed" ]]; then` (the first line of the resume fork, above its long comment), insert FIVE lines — code and a one-line pointer, nothing more. `_ws_reap_locked` sits ABOVE the frozen corpus's highest `ccd/ccd` anchor, so every line here is citation debt, and its explanation is prose that belongs BELOW that anchor (contract §7 R9):

```bash
    if [[ "$resumed" == reclaim:* ]]; then   # ws-reclaim's breadcrumb: see "WS-REAP'S MIRROR" in the RECLAIM region
      printf '{"refused":"reclaim-in-progress","detail":%s,"paths":[]}\n' \
        "$(_json_str "an interrupted reclamation of $id stopped at its '${resumed#reclaim:}' step — ws-reap never finishes another verb's work")"
      return 0
    fi
```

and its explanation inside the RECLAIM region, directly ABOVE `# ── end child reclamation` (after the verb's functions this task appends):

```bash
# WS-REAP'S MIRROR (spec 2026-09-22 §5.6; carried constraint 5). The five
# lines at the top of `_ws_reap_locked`'s resume fork: a `reclaim:<phase>`
# breadcrumb is ws-reclaim's interrupted work — it never passed `archived`,
# and resuming it as a reap would finish a teardown whose ladder asked a
# different question. So ws-reap refuses `reclaim-in-progress` before it
# reads anything, and ws-reclaim refuses the mirror (`reap-in-progress`). No
# journal emit there: the reap refusal emits are pinned at exactly two. The
# block is five lines with a one-line pointer because it sits above the frozen
# citation corpus's anchors (`server/test/session-hook.test.ts`), where every
# added line moves a citation; this is where its prose lives.
```

This is the ONE change this programme makes to `ws-reap` (spec §6, "Not changed, deliberately", with carried constraint 5 as its exception).

- [ ] **Step 5: The two new refusal words, the two journal-only failure words, and the three `meas.` keys**

`server/src/wsaudit.ts` — directly after the five ladder entries Task 2 added:

```ts
  // The flavour pair (spec §5.6): neither verb finishes the other's interrupted
  // work. `reap-in-progress` is ws-reclaim's refusal of a ws-reap breadcrumb;
  // `reclaim-in-progress` is ws-reap's refusal of a `reclaim:` one.
  'reap-in-progress': 'An interrupted clean-up of this workspace belongs to ws-reap, and reclamation never finishes another verb’s work. Nothing was removed.',
  'reclaim-in-progress': 'An interrupted reclamation of this workspace is waiting to finish, and ws-reap never finishes another verb’s work. Nothing was removed.',
```

`shared/api.ts` — the `LcRefusalToken` union's last member becomes two (the `;` moves):

```ts
  | 'purge-mechanism-absent'  // D-2605 r3: the box cannot take the lock AT ALL (flock/mktemp/link off PATH) while a generation is live
  | 'pin-failed'              // ws-reclaim (spec 2026-09-22 §5.5): the pin phase could not keep the child's work, so the verb stopped before its first deletion
  | 'unit-still-active';      // ws-reclaim (spec 2026-09-22 §5.6): the child's unit did not answer "stopped" after unsupervise, so the tail stopped before its first deletion
```

and `LC_REFUSAL_WORD` gains, after `'purge-mechanism-absent'`'s entry:

```ts
  // Child reclamation, wave 3. ws-reclaim's pin phase — the WIP commit and the
  // attic pins — failed, so the verb stopped BEFORE its first deletion. Only
  // ever rides `_lc_fail`: the act started (a WIP commit may already exist,
  // which destroys nothing), and a retry pins again.
  'pin-failed':
    'ccrc could not keep this workspace’s uncommitted work or its commits, so it stopped before deleting any of it. The worktree and the branch are intact, and reclamation tries again.',
  // Child reclamation, wave 3. The tail disabled the child's unit, then asked
  // the service manager, and it did not answer "stopped" — a Restart=always
  // unit left up would respawn against a workspace with no row. Only ever
  // rides `_lc_fail`; the breadcrumb stays and a retry disables it again.
  'unit-still-active':
    'ccrc could not confirm this session’s service had stopped, so it stopped before deleting anything. The worktree and the branch are intact, and reclamation tries again.',
```

`server/test/lifecycle-refusal-word.test.ts` — `ALL_TOKENS` gains `'pin-failed': true,` and `'unit-still-active': true,` after `'purge-mechanism-absent': true,`, and `expect(TOKENS.length).toBe(12);` becomes `.toBe(14);`.

**The three `meas.` keys.** `_lc_intent`/`_lc_done reclaim` journal `meas.childOf`, `meas.wip` and `meas.residueBytes`, which no L0 declaration names today (`grep -oE 'meas\.[a-zA-Z]+' ccd/ccd | sort -u` finds none of the three). Undeclared, they red `ccd-lifecycle-contain.test.ts`'s *every meas.<key> ccd writes is on the list* (`an unlisted meas key`), and `reviveMeas` drops them at ingest — so the run id a `reclaim` row names would never reach the mirror waves 4 and 5 derive from. `shared/api.ts`, `LifecycleMeas` — directly after `unremoved`'s member, before the closing `}`:

```ts
  /** The run a `reclaim` act's CHILD was minted for — `ws-reclaim --child-of`,
   *  equal to the box's `.child` marker or the act never started (child
   *  reclamation, spec 2026-09-22 §5.5). The decimal string ccd wrote: every
   *  `meas.` value crosses the encoder as a string, so a reader parses it
   *  rather than trusting a `number` this seam never carried. */
  readonly childOf: string | null;
  /** The WIP commit a `reclaim` made of the child's uncommitted work, or null
   *  when the tree was clean and no commit was made (ccd passes an empty value,
   *  which the encoder omits). */
  readonly wip: string | null;
  /** The bytes `ws-reclaim`'s residue probe measured OUTSIDE the child's temp
   *  root and left in place — the decimal string ccd wrote, or the literal
   *  string `null` when the probe could not measure it (`ws-reap`'s
   *  `meas.bytes` precedent) — never a fabricated 0. A `null` VALUE here means
   *  the key was absent: an act that is not a reclaim. */
  readonly residueBytes: string | null;
```

`LIFECYCLE_MEAS_KEY_MAP` — its last line `  unremoved: true,` becomes `  unremoved: true, childOf: true, wip: true, residueBytes: true,`.

`server/src/coord/journalparse.ts`, `reviveMeas` — directly after `unremoved: s(o, 'unremoved'),`:

```ts
    // Child reclamation, wave 3 — `ws-reclaim`'s run, WIP commit and residue;
    // see `LifecycleMeas.childOf`/`.wip`/`.residueBytes`'s own docstrings.
    childOf: s(o, 'childOf'), wip: s(o, 'wip'), residueBytes: s(o, 'residueBytes'),
```

`server/test/ccd-lifecycle-contain.test.ts` — the case title `'every meas.<key> ccd writes is on the list, and the list is exactly 29'` becomes `'… exactly 32'`; `expect.soft(all.size, 'LIFECYCLE_MEAS_KEYS drifted from the measured 29').toBe(29);` becomes `…'drifted from the measured 32').toBe(32);`; and one paragraph is appended to the comment directly above that line:

```ts
    // 29 -> 32 (child reclamation, wave 3): `meas.childOf`, `meas.wip` and
    // `meas.residueBytes`, carried by `ws-reclaim`'s intent/done pair. Declared
    // in the SAME commit that first emits them, so this scan never saw them
    // unlisted — the `unremoved` failure mode above, closed in advance.
```

`server/test/lifecycle-wire.test.ts` — the sorted key list gains `'childOf'`, `'residueBytes'` and `'wip'` (it is `.sort()`ed on both sides, so their place in the literal does not matter), and both `LifecycleMeas` literals — `MEAS` at the top and `nothing` in *every field is nullable* — gain `childOf: null, wip: null, residueBytes: null,` after `unremoved: null,` (without them the test tree fails `tsc`: `typecheck-tests` is the red).

- [ ] **Step 6: Enrol the verb in the refusal scanner**

`server/test/ccd-refusal-scan.test.ts`:

(a) `VERBS` — its comment becomes `/** D4's four destructive verbs, and ws-reclaim (child reclamation, wave 3) as the fifth. Floors are measured minima, not guesses. */` and it gains, as its last entry:

```ts
  // Measured 4045 characters for cmd_ws_reclaim's pre-lock parse and lock when
  // this entry was written; the floor sits under it with room for an edit.
  ['cmd_ws_reclaim', '_ws_reclaim_locked', 3500],
```

and `it('found all four bodies, and each is substantial — the coverage floor'` is renamed `it('found every body, and each is substantial — the coverage floor'`.

(b) `SANCTIONED` — its docstring's first line becomes `THE THIRTEEN DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.`, a paragraph is added to it — `Seven are cmd_ws_reclaim's (child reclamation, wave 3), for reap's own reasons: its usage line and run-id shape check run before $id is bound, its four --actor/--reason checks are the loop arms that run before any id is bound, and its _json_str probe is the emitter being missing. Its "bad token" and "bad session id" are the SAME literals as reap's and need no second entry.` — and the array gains:

```ts
  'die "usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]"',
  'die "bad run id"',
  'die "python3 unavailable — cannot quote the reclaim record safely"',
  'die "--actor must be non-blank"',
  'die "--actor is longer than $_LC_DEC_MAX bytes"',
  'die "--reason must be non-blank"',
  'die "--reason is longer than $_LC_DEC_MAX bytes"',
```

and `expect(SANCTIONED.length, 'the sanctioned set changed size').toBe(6);` becomes `.toBe(13);`.

(c) Two new cases at the end of `describe('every die in a destructive verb is reached through _lc_refuse or _lc_fail'`:

```ts
  it('holds the reclaim emits at exactly two — one verdict point, one flock decline (child reclamation, wave 3)', () => {
    // `_ws_reclaim_locked` routes EVERY ladder refusal, the token mismatch and
    // the flavour refusal through one `_lc_emit`; the lock decline in
    // `cmd_ws_reclaim` is the second. A third is a refusal path that bypasses
    // the verdict point, which is where the journal's completeness is decided.
    const region = src.slice(src.indexOf('RECLAIM-BEGIN'), src.indexOf('RECLAIM-END'));
    expect(region.length, 'the reclaim region could not be sliced').toBeGreaterThan(20000);
    expect([...region.matchAll(/_lc_emit reclaim refused/g)]).toHaveLength(2);
  });

  it('the reclaim lock\'s two inner functions contain NO die — past the lock, a failure is _lc_fail and JSON', () => {
    for (const [name, until, floor] of [
      ['_ws_reclaim_locked', '# ── end child reclamation', 2500],
      ['_ws_reclaim_tail', 'cmd_ws_reclaim() {', 9000],
    ] as const) {
      const from = src.indexOf(`${name}() {`);
      const body = from > -1 ? src.slice(from, src.indexOf(until, from)) : '';
      expect(body.length, `${name} could not be sliced`).toBeGreaterThan(floor);
      expect([...body.matchAll(/(^|\s|\|\|\s*|;\s*)die "/g)].map((m) => lineAt(body, m.index!)),
        `${name} grew a die — past the lock, route it through _lc_fail and the "failed" document`).toEqual([]);
    }
  });
```

- [ ] **Step 7: Pay the `_reg_get` census tax, re-stamp ccd, run the tests to verify they pass**

The verb adds `_reg_get "` reads — the tail's `project`/`workdir` line, `_ws_reclaim_locked`'s breadcrumb read and its `project`/`workdir` line (five occurrences on three lines, as this plan is written; MEASURE, never type). Apply the census tax (Global Constraints) with `Task 4` in the `THE LAST MOVE WAS` line, then:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts test/ccd-child-reclaim-pin.test.ts \
  test/ccd-child-reclaim-ladder.test.ts test/ccd-refusal-scan.test.ts test/wsaudit.test.ts \
  test/lifecycle-refusal-word.test.ts test/ccd-ws-reap.test.ts test/ccd-lifecycle-purge.test.ts test/ownership.test.ts \
  test/ccd-lifecycle-contain.test.ts test/lifecycle-wire.test.ts test/journalparse.test.ts test/typecheck-tests.test.ts \
  test/ccd-reg-get-census.test.ts)
```

Expected: PASS. `ccd-lifecycle-contain` finds 32 declared keys and no `meas.` key ccd writes outside them; `lifecycle-wire` and `typecheck-tests` hold the two `LifecycleMeas` literals total over the widened interface. `ccd-ws-reap` (2860 lines of reap behaviour) must be green UNCHANGED — the mirror is the only reap edit; `ccd-lifecycle-purge` must still count its heading four times and find its four durable callers; `ccd-refusal-scan`'s literal-token census now sees `pin-failed` and `unit-still-active`, each produced by an `_lc_fail reclaim …` and owned by L0.

- [ ] **Step 8: Pay the citation-corpus tax (S6-R11)**

Run procedure S6-R11. Three insertions this time: the mirror block in `_ws_reap_locked` (every `ccd/ccd` anchor below it shifts by FIVE lines — README's two `ccd/ccd` anchors among them; its prose went below the anchors, R9), the verb functions near the end, and the `shared/api.ts` insertions — the two `LcRefusalToken` lines (`| 'pin-failed'`, `| 'unit-still-active'`), which move the three `LC_REFUSAL_WORD` anchors README names beside the purge tokens by two, and the three `LifecycleMeas` members above them, which move every `shared/api.ts` anchor below `LifecycleMeas` (re-point README's by content; the dump names the rest). Expect step 1 to be red and apply steps 2–4, naming all three insertions; README's anchors are repaired by content (the same three `grep -n` lines Task 1 Step 5 uses for `shared/api.ts`, and `grep -n` on the quoted bytes for `ccd/ccd`), never counted.

- [ ] **Step 9: Mutation check, then commit**

| # | Edit (one at a time; re-stamp; restore; re-stamp) | Command | Expected red |
|---|---|---|---|
| 1 | In `_ws_reclaim_tail`, wrap the `_ws_unsupervise …` and `tmux kill-session …` lines in `if [[ -z "$resumed" ]]; then … fi` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t 'runs unsupervise and the anchored kill FIRST'` | `a resumed reclaim that skipped this would leave a Restart=always unit with no row: expected [] to have a length of 1` |
| 2 | In `_ws_reclaim_tail`, drop the `=` from `kill-session -t "=$(_tmux "$id")"` | same file, `-t 'pins, then removes'` | `expected [ … ] to include 'tmux kill-session -t =cc-demo-quiet-basin'` |
| 3 | In `_ws_reclaim_locked`, delete the `if [[ "$REAP_VERDICT" == reclaimable && "$token" != "$REAP_TOKEN" ]]; then … fi` block | same file, `-t 'state-changed on a wrong token'` | `a refusal never also reports a reclaim: expected 'demo-quiet-basin' to be undefined` — the verb RECLAIMED on a token it was never shown |
| 4 | In `_ws_reclaim_locked`, delete the first `if [[ -n "$rbc" && "$rbc" != reclaim:* ]]; then …` arm (make the fork `if [[ "$rbc" == reclaim:* ]]; then …; else …`) | same file, `-t 'reap-in-progress on a ws-reap breadcrumb'` | `a refusal never also reports a reclaim: expected 'demo-quiet-basin' to be undefined` — reclaim finished ws-reap's interrupted work |
| 5 | In `_ws_reclaim_resume_eval`, delete the `reclaim-paused` rung | same file, `-t 'does not let a crash launder a refusal'` | `a refusal never also reports a reclaim: expected 'demo-quiet-basin' to be undefined` — a resume sailed past the kill-switch |
| 6 | In the tail's temp-root block, change `"$tdir" == "$troot/$id"` to `-n "$tdir"` | same file, `-t 'never follows a temp root'` | `expected false to be true` — the symlink target OUTSIDE `~/.cc-tmp` was deleted (fixture HOME only) |
| 7 | In `_ws_reap_locked`, delete the mirror block of Step 4 | same file, `-t 'the mirror'` | `expected 'status-unknown' to be 'reclaim-in-progress'` — ws-reap walked a reclaim's breadcrumb as its own |
| 8 | In `_ws_reclaim_tail`, delete the whole `# (2) THE SETTLE` block | same file, `-t 'the settle'` | `expected [ … ] to include 'late.txt'` — the session's last write died with the tree |
| 9 | In `_ws_reclaim_tail`, delete the `holders=$(_ws_branch_holders "$main" "$branch")` re-check and its two failure arms | same file, `-t 'branch-moved'` | `expected 0 to be 1` — the CAS deleted a branch a worktree still stands on, and the reclaim reported success |
| 10 | Add `die "x"` as the first line of `_ws_reclaim_tail`'s body | `cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts` | `_ws_reclaim_tail grew a die` |
| 11 | Duplicate the `_lc_emit reclaim refused … refusal in-progress` line in `cmd_ws_reclaim` | same | `expected [ …3 items… ] to have a length of 2` |
| 12a | In the tail's temp-root block, delete the `elif [[ -n "$troot" ]] && [[ -L "$troot/$id" \|\| … ]]; then` arm (its comment and its `rm -f --` line) | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t 'temp.root'` | `the leaf symlink is unlinked: expected [Function] to throw an error` and `the leaf file is unlinked: …` — the leaf outlives the reclaim and a recycled slug meets it; the `target is never followed` assertion stays green (the control) — PREDICTED at planning; measure it |
| 12b | In `cmd_ws_reclaim`, `_child_runid_valid "$childof"          \|\| die "bad run id"` → `[[ $childof =~ ^[1-9][0-9]{0,9}$ ]] \|\| die "bad run id"` | same file, `-t 'locale-widened range'` | `expected 0 to be 1` (or a `refused` document at exit 0) — the parse accepted `1²`; RUN, not skipped, on the fleet box — PREDICTED at planning |
| 12c | In `_ws_reclaim_locked`, delete the `if [[ "$REAP_VERDICT" == unmeasured ]]; then … fi` block | same file, `-t 'could not RUN inside the lock'` | `expected 0 to be 1` — an unmeasured probe went out as `{"refused":"unmeasured"}`, a word no server reads — PREDICTED at planning |
| 12 | In `_ws_reclaim_tail`, delete the `unitstate=$(_svc_is_active …)` line and its `case … esac` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t 'STILL UP'` | `active: expected 0 to be 1` — the tail deleted the worktree with the unit still up |
| 13 | In the same `case`, change `inactive\|failed) : ;;` to `inactive\|failed\|'') : ;;` (an unanswered manager read as stopped) | same file, `-t 'STILL UP'` | `: expected 0 to be 1` — the empty-answer iteration reclaimed on an unmeasured unit |
| 14 | `shared/api.ts`: delete `childOf: true,` from `LIFECYCLE_MEAS_KEY_MAP` (and the `childOf` member, so it compiles) | `cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-contain.test.ts -t 'every meas'` | `an unlisted meas key: expected [ 'childOf' ] to deeply equal []` — and `LIFECYCLE_MEAS_KEYS drifted from the measured 32` |
| 15 | In `_ws_reclaim_locked`, change the intent's `meas.resumed "$resumed"` back to `meas.resumed "${phase:-}"` and set `resumed=1` on the resume arm | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t 'finishes an interrupted reclaim'` | `expected '1' to be 'worktree'` — one key, two meanings on one pair |
| 16 | In `_ws_reclaim_tail`'s step (5), delete the vanished-worktree record-clear (the `if [[ ! -e "$workdir" && ! -L "$workdir" ]]; then _ws_reclaim_record …; fi` block) | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts -t 'pins the branch tip and its stashes'` | `expected 1 to be 0` — the child's own stale `prunable` record read as another holder: `failed: branch-elsewhere`, a child that could never be reclaimed — PREDICTED at planning; measure it |
| 17 | In `_ws_reclaim_pin_absent`, `extras=("$REAP_TIP" "$rhead")` → `extras=("$rhead")` | same file, `-t 'record already gone too'` | `the branch tip is pinned — no record is left to name it: expected [] to include '<tip>'` — green in the first vanished case, where git's recorded HEAD IS the tip (the control); red where no record is left to name it — PREDICTED at planning |
| 18 | In `_ws_reclaim_pin_absent`, `extras=("$REAP_TIP" "$rhead")` → `extras=("$REAP_TIP")` | same file, `-t 'DETACHED'` | `the detached commit is in the attic: expected [ '<tip>' ] to include '<detached>'` — the commit reachable from git's record alone, lost when the record was cleared — PREDICTED at planning |
| 19 | In `_ws_reclaim_pin_absent`, `\|\| { RECLAIM_PIN_WHY="a commit this reclaim must keep could not be pinned …"; return 1; }` → `\|\| :` | same file, `-t 'a pin it cannot take'` | `expected 0 to be 1` — the branch was deleted with a stash the attic never took — PREDICTED at planning |
| 20 | In `_ws_reclaim_locked`, `start=branch` → delete the line (the vanished arm starts at `reclaim:children`) | same file, `-t 'STILL UP stops the vanished arm'` | `the vanished arm resumes from the branch: expected 'reclaim:children' to be 'reclaim:branch'` — PREDICTED at planning |
| 21 | In `_ws_reclaim_tomb_fields`, `"$(_json_str "$worktree")"` → `'"present"'` | same file, `-t 'pins the branch tip and its stashes'` | `expected 'present' to be 'absent'` — the record claims a tree it never had — PREDICTED at planning |
| 22 | In `_ws_reclaim_tail`, move step (1) — the `_ws_unsupervise …`/`tmux kill-session …` lines and the `unitstate` re-measure with its `case` — to just before step (8)'s `_reg_purge` (R19's parenthetical order read literally) | same file, `-t 'STILL UP stops the vanished arm'` | `nothing was deleted: expected '' to contain 'ws/quiet-basin'` — the branch went while the unit was still up; the fresh-arm `STILL UP` case reds too (the worktree went) — PREDICTED at planning |

Restore everything, re-stamp, re-run Step 7 (green), then:

```bash
git add ccd/ccd shared/api.ts server/src/wsaudit.ts server/src/coord/journalparse.ts server/test/childReclaimFixture.ts \
  server/test/ccd-child-reclaim-verb.test.ts server/test/ccd-refusal-scan.test.ts \
  server/test/lifecycle-refusal-word.test.ts server/test/ccd-lifecycle-contain.test.ts server/test/lifecycle-wire.test.ts \
  $(git diff --name-only -- server/test/session-hook.test.ts README.md)   # S6-R11's edits, when there were any
git commit -m "$(cat <<'MSG'
feat(ccd): ws-reclaim — its own tail arm, its own breadcrumb, and the resume

cmd_ws_reclaim takes ws-reap's lock, forks on a reclaim:-flavoured breadcrumb
before any eval, re-proves the token inside the lock, and on the fresh arm
pins, writes the tombstone, then the breadcrumb. Its tail — never reap's —
unsupervises and kills the ANCHORED pane first on the fresh and every resumed
arm, re-pins once the writer is dead, then removes nested same-repository
worktrees, the worktree, the branch (by CAS, after re-checking no other
worktree holds it), the clips and the temp root (each under the id re-check
and a pwd -P direct-child equality), measures the residue without touching
it, and purges the registry row last — and stops, deleting nothing, when the
unit does not answer "stopped" after unsupervise (unit-still-active). A child
whose worktree has vanished is reclaimed from what is left: its branch tip,
its stashes and git's recorded HEAD pinned, a tombstone saying worktree
absent, and the tail run from the branch on — unit and pane still first, and
git's stale record of the missing directory cleared before the CAS. The
resume re-asserts the marker, the pause and the hold before anything else.
ws-reap gains its one mirror refusal. The pair's three new meas keys
(childOf, wip, residueBytes) are declared in LifecycleMeas and revived, so
they reach the mirror. Spec 2026-09-22 §5.5-§5.6.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `ws-audit --reclaim`, the `reclaim-v1` token, and the dispatcher arm

**Model routing:** `sonnet`, effort `high` — the audit mode reuses the ladder Task 2 wrote and prints through the document `cmd_ws_audit` already assembles; the risk is the byte-identity of the plain audit, and the test pins that.

**Files:**
- Modify: `ccd/ccd` — `cmd_ws_audit` (a one-line pointer in its header comment, its argv parse, its one `_ws_reap_eval` call, the head of its final verdict `if` — code only, R9); `cmd_caps` (the verb heredoc, and a token echo after the LAST `echo <token>`); the dispatcher `case` (after `ws-reap)`) and its `*)` usage line; and ONE comment block inside the RECLAIM region (directly above `# ── end child reclamation`) that carries those edits' prose below the frozen corpus's anchors
- Modify: `server/src/ccdargv.ts` — `export const RECLAIM_CAP = 'reclaim-v1';` directly after the LAST `export const …_CAP = …;` in the file, found with `grep -nE "^export const [A-Z_]+_CAP = " server/src/ccdargv.ts | tail -1` (at planning that is `WIN_SIZE_CAP`, `ccdargv.ts:667`; where wave 1 put `CHILD_ARGV_CAP` — the contract says beside `ROUTE_ARGV_CAP`, wave 1's plan says directly after `WIN_SIZE_CAP` — the grep answers, never this sentence)
- Modify: `server/test/ccd-archive.test.ts` — `KNOWN_CAPABILITY_TOKENS` gains `'reclaim-v1'`, a `toContain(RECLAIM_CAP)`, and the import
- Modify: `server/test/capsupported.test.ts` — one case, beside `spells the win-size token exactly once in server/src`
- Modify: `server/test/wsaudit.test.ts` — the verdict harvest excludes `reclaimable`
- Test: `server/test/ccd-child-reclaim-audit.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's `_ws_reclaim_eval`, `_ws_reclaim_resume_eval`, `_ws_reclaim_reset`, `RECLAIM_CHILDOF`; Task 4's `cmd_ws_reclaim` (the dispatcher arm routes to it).
- Produces:
  - `ccd ws-audit --session <id> --reclaim [--defer-expired]` — the plain document plus `"mode":"reclaim"`, `"childOf":<n>|null`, `"resume":"<phase>"` (only on a `reclaim:` breadcrumb), and `"verdict":"reclaimable","detail":"","token":"<64 hex>"` ONLY when the ladder (or the resume re-assertion) passes — a child whose worktree has vanished included (R19: its document says `"exists":false` and its token is the vanished arm's); any other verdict is one of the fourteen tokens and carries no token. The EXISTING grant `['ws-audit','--session']` covers it — no new audit grant.
  - **The unmeasured answer — contract §8 R11′, ruled.** When the ladder answers `_ws_reclaim_unmeasured` (a probe that could not RUN, or a registry row that does not say what the child is), `ws-audit --reclaim` prints its reclaim document — `"mode":"reclaim"`, `"childOf"`, and `"verdict":"unmeasured","detail":"<why>"`, with NO token — says why on stderr, and EXITS 1. Nothing is journaled. The executor maps ANY audit exit 1 to the `failed` outcome, whatever the document says (Task 8's `childReclaimAudit` reads `res.ok` before it parses a byte), and the sweep retries it; `unmeasured` is never a refusal word, so a parser that did read it would answer `unreadable`, which is `failed` too.
  - **Audit-time refusals are journaled — TERMINAL ONLY, contract §8 R5′ (amending §7 R5), ruled.** In reclaim mode ONLY, a TERMINAL verdict (`not-a-workspace`, `not-a-child`, `branch-elsewhere`, `tree-unreadable`, `containment-unproven`, `no-worktree-record`) writes ONE journal line (act `reclaim`, outcome `refused`, the token as reason), `_lc_emit reclaim refused <id> "" verb ws-audit refusal <token> detail …`. That case list EQUALS `CHILD_RECLAIM_TOKEN_KIND`'s `terminal` arm — Task 8's `child-reclaim.test.ts` derives the arm FROM THE MAP (never a second literal) and holds ccd's list equal to it, with a mutation row on each side. The executor always audits before it acts, and a ladder refusal found by the audit never reaches `ws-reclaim` — without this line such a refusal reaches the feed and never the lifecycle mirror, which spec §5.9 derives the attention item from "so a restart does not lose it" and which wave 4's attention list reads ONLY (no in-memory memo — wave 4's pre-flight expects exactly this shape) and wave 5's chip reads. A retryable verdict writes nothing (the sweep audits every pass; a `held` line a minute would bury the journal, and the attention list needs terminal rows only — a retryable refusal reaches the chip through the sweep's own defer state), and the plain audit writes nothing, byte-identical as before.
  - `ccd ws-audit --session <id>` — byte-identical output.
  - `cmd_caps` prints `ws-reclaim` (a verb) and `reclaim-v1` (the capability token); the dispatcher routes `ws-reclaim`.
  - `server/src/ccdargv.ts`: `export const RECLAIM_CAP = 'reclaim-v1';` — Task 8 reads it with `capSupported`, never `verbSupported`.

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/ccd-child-reclaim-audit.test.ts`:

```ts
// `ws-audit --reclaim` (spec 2026-09-22 §5.5): the token's source for the
// reclaim ladder — the SAME document the plain audit prints, its verdict taken
// from `_ws_reclaim_eval`, plus `mode` and `childOf` — and the two pieces that
// make the verb reachable at all: `cmd_caps`' `reclaim-v1` and the dispatcher
// arm. The plain `ws-audit --session <id>` is pinned unchanged here too: the
// PWA's reap sheet reads it, and this wave does not touch that ceremony.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';
import { eventsOf, refusalsOf } from './lifecycleHelpers.js';
import {
  CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-audit-'); });
afterEach(() => { h.cleanup(); });

const AUDIT_STUBS = `${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB}`;
const audit = (flags = ''): Record<string, unknown> =>
  JSON.parse(h.sh(`${AUDIT_STUBS} cmd_ws_audit --session ${CHILD_ID} ${flags}`)) as Record<string, unknown>;
/** The dispatcher, not the function: the agent invokes `ccd <verb> …`. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  try {
    return { code: 0, stderr: '', stdout: execFileSync('bash', [CCD, ...args], { encoding: 'utf8', cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) }).trim() };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};
const PLAIN_KEYS = ['id', 'branch', 'registryBranch', 'drift', 'base', 'workdir', 'project', 'repo', 'exists',
  'headMatchesRegistry', 'reaping', 'alive', 'started', 'unit', 'dirty', 'ignored', 'ignoredCount', 'ignoredBytes',
  'sensitive', 'sensitiveFiltered', 'clips', 'stashes', 'worktreeBytes', 'commitsAheadOfBase', 'pr', 'merge',
  'transcript', 'children', 'verdict', 'detail'];
const interrupted = (c: Child, phase: string): void => {
  h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null`
    + ` && _reg_set ${CHILD_ID} reaping reclaim:${phase}`);
};

describe('the plain audit is untouched', () => {
  it('prints exactly the keys it always printed — no mode, no childOf — and reap’s verdict', () => {
    makeChild(h);
    const a = audit();
    expect(Object.keys(a)).toEqual(PLAIN_KEYS);
    expect(a['verdict'], 'a child is never archived, so reap refuses it — and says why').toBe('not-archived');
  }, 60_000);
});

describe('ws-audit --reclaim', () => {
  it('prints mode, childOf and the SAME token the ladder mints', () => {
    makeChild(h);
    const a = audit('--reclaim');
    expect(Object.keys(a)).toEqual([...PLAIN_KEYS.slice(0, -2), 'mode', 'childOf', 'verdict', 'detail', 'token']);
    expect(a['mode']).toBe('reclaim');
    expect(a['childOf']).toBe(CHILD_RUN);
    expect(a['verdict']).toBe('reclaimable');
    expect(a['token']).toBe(evalOf(h).token);
  }, 60_000);

  it('a probe that could not RUN EXITS 1 — a reclaim document saying unmeasured, no token, no terminal word, nothing journaled', () => {
    // `_ws_reclaim_unmeasured` (Task 2): the server reads ANY audit exit 1 as
    // `failed` and retries; a terminal word here would never be retried.
    makeChild(h);
    const r = h.run(`${AUDIT_STUBS} _ws_reclaim_stash_shas() { return 1; }; cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stderr).toContain('ws-audit --reclaim measured nothing');
    const a = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(a['mode'], 'still the RECLAIM document').toBe('reclaim');
    expect(a['token'], 'no token for a ladder that did not finish').toBeUndefined();
    expect(a['verdict']).toBe('unmeasured');
    expect(eventsOf(h.home, 'reclaim'), 'an unmeasured answer is journaled nowhere').toEqual([]);
  }, 60_000);

  it('a child whose worktree has VANISHED is reclaimable — exists:false, and the token the verb spends (spec §5.5)', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const a = audit('--reclaim');
    expect(a['verdict'], String(a['detail'])).toBe('reclaimable');
    expect(a['exists']).toBe(false);
    expect(a['token']).toBe(evalOf(h).token);
    expect(JSON.parse(childReclaimVerb(h, String(a['token'])).stdout).reclaimed).toBe(CHILD_ID);
  }, 90_000);

  it('journals no-worktree-record — the terminal answer for a directory git does not record', () => {
    const c = makeChild(h);
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    expect(audit('--reclaim')['verdict']).toBe('no-worktree-record');
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'no-worktree-record' });
    expect(fs.existsSync(c.wt), 'the audit deleted nothing').toBe(true);
  }, 60_000);

  it('--defer-expired mints the deferred token, and only the deferred verb accepts it', () => {
    const c = makeChild(h);
    const d = audit('--reclaim --defer-expired');
    expect(d['token']).toBe(evalOf(h, { defer: 1 }).token);
    expect(d['token']).not.toBe(audit('--reclaim')['token']);
    expect(JSON.parse(childReclaimVerb(h, String(d['token'])).stdout).refused).toBe('state-changed');
    expect(JSON.parse(childReclaimVerb(h, String(d['token']), { extra: '--defer-expired' }).stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
  }, 90_000);

  it('carries NO token on a refusal, and childOf is null when there is no marker to read', () => {
    makeChild(h);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.hold`), 'program:x wave:2/3');
    const held = audit('--reclaim');
    expect(held['verdict']).toBe('held');
    expect(held['token']).toBeUndefined();
    expect(held['childOf']).toBe(CHILD_RUN);
    fs.rmSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.hold`));
    fs.rmSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.child`));
    const orphan = audit('--reclaim');
    expect(orphan['verdict']).toBe('not-a-child');
    expect(orphan['childOf']).toBeNull();
    expect(orphan['token']).toBeUndefined();
  }, 60_000);

  it('answers the RESUME token on a reclaim breadcrumb, and names the phase — the verb accepts it', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const a = audit('--reclaim');
    expect(a['resume']).toBe('worktree');
    expect(a['verdict']).toBe('reclaimable');
    expect(a['token']).toBe(h.sh(`_ws_reclaim_resume_eval ${CHILD_ID} 0 '' worktree >/dev/null; printf '%s' "$REAP_TOKEN"`));
    expect(JSON.parse(childReclaimVerb(h, String(a['token'])).stdout).reclaimed).toBe(CHILD_ID);
  }, 90_000);

  it('journals a TERMINAL audit refusal — the mirror sees it — and a retryable one or the plain audit not at all', () => {
    makeChild(h);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.hold`), 'program:x wave:2/3');
    expect(audit('--reclaim')['verdict']).toBe('held');
    expect(audit()['verdict'], 'the plain audit').toBeTypeOf('string');
    expect(eventsOf(h.home, 'reclaim'), 'a retryable verdict and the plain audit write NOTHING').toEqual([]);
    fs.rmSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.hold`));
    // The child's own workdir is a worktree of ANOTHER repository: rung 9's
    // question asked of the child itself — terminal, and found at audit time.
    const other = h.makeRepo('other');
    const alien = path.join(h.home, 'alien');
    h.git(other, 'worktree', 'add', '-b', 'ws/alien', alien);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.workdir`), alien);
    expect(audit('--reclaim')['verdict']).toBe('containment-unproven');
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'containment-unproven' });
    const line = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'refused')!;
    expect(line['verb'], 'the audit, not the verb, found it').toBe('ws-audit');
    expect(line['id']).toBe(CHILD_ID);
  }, 60_000);

  it('answers reap-in-progress, and no token, on a ws-reap breadcrumb', () => {
    makeChild(h);
    h.sh(`_reg_set ${CHILD_ID} reaping branch`);
    const a = audit('--reclaim');
    expect(a['verdict']).toBe('reap-in-progress');
    expect(a['token']).toBeUndefined();
  }, 60_000);

  it('the audit’s token IS the verb’s consent — end to end', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, String(audit('--reclaim')['token']));
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
  }, 90_000);

  it('asserts its argv: --reclaim only third, --defer-expired only after it', () => {
    for (const argv of [['--defer-expired'], ['--reclaim', 'extra'], ['--reclaim', '--defer-expired', 'extra'],
      ['--defer-expired', '--reclaim']]) {
      const r = runCcd('ws-audit', '--session', CHILD_ID, ...argv);
      expect(r.code, argv.join(' ')).toBe(1);
      expect(r.stderr, argv.join(' ')).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired]]');
    }
  });
});

describe('reachable: the capability token and the dispatcher arm', () => {
  it('ccd caps advertises the verb AND its capability token', () => {
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('ws-reclaim');
    expect(advertised).toContain('reclaim-v1');
  });

  it('the dispatcher routes ws-reclaim (its own usage, not the unknown-verb line) and the usage line names it', () => {
    const r = runCcd('ws-reclaim');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-reclaim');
    expect(r.stderr).not.toContain('usage: ccd {start|');
    expect(runCcd('no-such-verb').stderr).toContain('|ws-reclaim|');
  });
});
```

(b) `server/test/wsaudit.test.ts` — the verdict harvest's success-word exclusion becomes:

```ts
for (const m of ccdSrc.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)) {
  // `reapable` and `reclaimable` are the two SUCCESS verdicts — each means "a
  // token follows" — not refusals, so neither has (or may have) a sentence.
  if (m[1] !== 'reapable' && m[1] !== 'reclaimable') tokens.add(m[1]!);
}
```

(c) `server/test/ccd-archive.test.ts` — `KNOWN_CAPABILITY_TOKENS` gains `'reclaim-v1'` (keep every token already there, wave 1's `child-argv-v1` included; the array is in alphabetical order, so it sits between `'pools-v1'` and `'route-apply-v1'`), the import from `../src/ccdargv.js` gains `RECLAIM_CAP`, and directly after `expect(KNOWN_CAPABILITY_TOKENS).toContain(WIN_SIZE_CAP);`:

```ts
    // Child reclamation wave 3's token: the third spelling of `reclaim-v1`,
    // held equal to the constant the executor gates on (`capSupported`) and to
    // ccd's own `echo reclaim-v1`.
    expect(KNOWN_CAPABILITY_TOKENS).toContain(RECLAIM_CAP);
```

(d) `server/test/capsupported.test.ts` — add `RECLAIM_CAP` to its `../src/ccdargv.js` import and, after `it('spells the win-size token exactly once in server/src'`:

```ts
  it('spells the reclaim token exactly once in server/src, and it REFUSES on no evidence', () => {
    // Child reclamation, wave 3. The verb this token gates DESTROYS a workspace:
    // `verbSupported` permits on an absent verb list, which is right for verbs
    // that have always existed and exactly wrong here (spec 2026-09-22 §6).
    expect(RECLAIM_CAP).toBe('reclaim-v1');
    expect(literalSpellings(RECLAIM_CAP)).toBe(1);
    expect(capSupported(state(null), RECLAIM_CAP)).toBe(false);
    expect(capSupported(undefined, RECLAIM_CAP)).toBe(false);
    expect(capSupported(state(['ws-reclaim']), RECLAIM_CAP), 'the verb is not the token').toBe(false);
    expect(capSupported(state([RECLAIM_CAP]), RECLAIM_CAP)).toBe(true);
    expect(verbSupported(state(null), ['ws-reclaim'])).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts test/wsaudit.test.ts \
  test/ccd-archive.test.ts test/capsupported.test.ts)
```

Expected: FAIL. The audit file: every `--reclaim` case dies on `usage: ccd ws-audit --session <id>` (today's `$# -eq 2` parse), `h.sh` throws; the caps case `expected [ … ] to include 'ws-reclaim'`; the dispatcher case `expected '…usage: ccd {start|…' not to contain 'usage: ccd {start|'`. `wsaudit` still passes (nothing prints `reclaimable` yet — the edit is for Step 3). `ccd-archive` and `capsupported` fail at their ASSERTIONS, not at collection: vitest reads a named import as a property of the transformed module, so the missing `RECLAIM_CAP` is `undefined`, never a `SyntaxError` (measured, vitest 4.1) — `capsupported`: `expected undefined to be 'reclaim-v1'`; `ccd-archive`: `expected [ … ] to include undefined`.

- [ ] **Step 3: Teach `cmd_ws_audit` the reclaim mode**

**Code above the anchor, prose below it (contract §7 R9).** `cmd_ws_audit` sits ABOVE the frozen citation corpus's highest `ccd/ccd` anchor, so every line inserted into it is citation debt: the edits (0)–(c) carry CODE and one-line pointer comments only, and the explanation they used to carry is ONE comment block inside the RECLAIM region, (d) below.

(0) Its header — the claim "read-only about the WORKSPACE" stays true of the plain form and is no longer true of `--reclaim`. Directly after the header's last paragraph (the one ending `against a default the remote had deleted (measured, git 2.43).`), insert ONE line:

```bash
  # `--reclaim` is the one exception to that: see "WS-AUDIT --RECLAIM" in the RECLAIM region.
```

(a) Its argv parse — replace

```bash
  [[ $# -eq 2 && $1 == --session ]] || die "usage: ccd ws-audit --session <id>"
  local id=$2
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
```

with

```bash
  local mode=reap defer=0
  [[ ( $# -eq 2 || $# -eq 3 || $# -eq 4 ) && $1 == --session ]] \
    || die "usage: ccd ws-audit --session <id> [--reclaim [--defer-expired]]"
  if (( $# >= 3 )); then
    [[ $3 == --reclaim && ( $# -eq 3 || $4 == --defer-expired ) ]] \
      || die "usage: ccd ws-audit --session <id> [--reclaim [--defer-expired]]"
    mode=reclaim
    (( $# == 4 )) && defer=1
  fi
  local id=$2
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
```

(The usage string still contains `usage: ccd ws-audit --session <id>`, which `ccd-ws-audit.test.ts`'s fixed-arity case asserts.)

(b) Its one eval call — replace

```bash
  _ws_reap_eval "$id" || true      # a refusal is an ANSWER, not an error
```

with

```bash
  local rbc=""
  if [[ $mode == reclaim ]]; then
    rbc=$(_reg_get "$id" reaping) || rbc=""
    if [[ -n "$rbc" && "$rbc" != reclaim:* ]]; then
      _ws_reclaim_reset
      _reap_refuse reap-in-progress "an interrupted ws-reap of $id stopped at its '$rbc' step — a reclaim never finishes another verb's work" || true
    elif [[ -n "$rbc" ]]; then
      _ws_reclaim_resume_eval "$id" "$defer" "" "${rbc#reclaim:}" || true
    else
      _ws_reclaim_eval "$id" "$defer" "" || true
    fi
  else
    _ws_reap_eval "$id" || true      # a refusal is an ANSWER, not an error
  fi
```

(c) Its final verdict line — the chain that begins `if [[ "$REAP_VERDICT" == reapable && "$clips_json" == null ]]; then` becomes an `elif` under a new first arm:

```bash
  if [[ $mode == reclaim ]]; then
    printf '"mode":"reclaim","childOf":%s,' \
      "$( _child_runid_valid "$RECLAIM_CHILDOF" && echo "$RECLAIM_CHILDOF" || echo null)"
    [[ "$rbc" == reclaim:* ]] && printf '"resume":%s,' "$(_json_str "${rbc#reclaim:}")"
    if [[ "$REAP_VERDICT" == reclaimable ]]; then
      printf '"verdict":"reclaimable","detail":"","token":%s}\n' "$(_json_str "$REAP_TOKEN")"
    elif [[ "$REAP_VERDICT" == unmeasured ]]; then
      printf '"verdict":%s,"detail":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_DETAIL")"
      echo "ccd: ws-audit --reclaim measured nothing: $REAP_DETAIL — retry" >&2
      return 1
    else
      printf '"verdict":%s,"detail":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_DETAIL")"
      case "$REAP_VERDICT" in
        not-a-workspace|not-a-child|branch-elsewhere|tree-unreadable|containment-unproven|no-worktree-record)
          _lc_emit reclaim refused "$id" "" verb ws-audit refusal "$REAP_VERDICT" detail "$REAP_DETAIL" ;;
      esac
    fi
  elif [[ "$REAP_VERDICT" == reapable && "$clips_json" == null ]]; then
```

— only that one line (`if` → `elif`) of the existing chain changes; its three arms below are untouched. No `--force` appears anywhere in `cmd_ws_audit` (`ccd-ws-reap.test.ts` bans it there). `childOf` is printed through wave 1's `_child_runid_valid` too (contract §7 R2: ccd checks the run-id grammar ONLY through that helper, never a re-spelled `=~`): a value rung 2 accepted prints as a number, and the empty `RECLAIM_CHILDOF` of a ladder that stopped before rung 2 prints `null`.

(d) The prose (0)–(c) do not carry, inside the RECLAIM region directly ABOVE `# ── end child reclamation` (below Task 4's "WS-REAP'S MIRROR" block):

```bash
# WS-AUDIT --RECLAIM (child reclamation, spec 2026-09-22 §5.5). The reclaim
# mode `cmd_ws_audit` gained in wave 3 — its code sits above the frozen
# citation corpus's anchors (`server/test/session-hook.test.ts`), where every
# added line moves a citation, so its explanation lives here.
#
# THE ONE EXCEPTION TO "READ-ONLY", AND IT IS NARROW. The ladder's rung 8 runs
# `_ws_reclaim_normalise`, which adds OWNER bits — `u+rwx` on a directory,
# `u+r` on a file, only where this uid owns the entry, never a group or other
# bit — to the child's tree and its clips directory before reading them,
# because a mode-000 directory answers `git status` clean. Nothing is
# destroyed or created; a mode changes. The plain form does neither, byte for
# byte: `mode` is read at exactly two places, the eval call and the verdict
# line, and both keep their old text on `reap`.
#
# THE FLAVOUR FORK, made here too, so the token printed is one `ws-reclaim`
# can accept: a `reclaim:` breadcrumb answers the RESUME token, any other
# breadcrumb is ws-reap's and answers `reap-in-progress`, no token.
#
# THE VERDICT LINE. `reclaimable` MEANS a token, exactly as `reapable` does —
# a child whose worktree has vanished included (spec §5.5): its document says
# `"exists":false`, and its token is the vanished arm's. Every other verdict
# is one of the fourteen tokens `ws-reclaim` itself can answer, and carries
# none. `unmeasured` (`_ws_reclaim_unmeasured`: a probe that could not RUN, or
# a registry row that does not say what the child is — spec §5.5, rung 8's
# rule) is not a verdict: the RECLAIM document is still printed, closed with
# `"verdict":"unmeasured"` spelled through `_json_str` — never as a literal
# the refusal harvest would count — the reason goes to stderr, and the audit
# EXITS 1. The server maps ANY audit exit 1 to `failed` and retries. It is
# journaled nowhere: no refusal, no token.
#
# A TERMINAL REFUSAL FOUND BY THE AUDIT IS JOURNALED, AND ONLY A TERMINAL ONE
# (spec §5.9). The server audits first and stops on a refusal, so a terminal
# word found here never reaches `ws-reclaim` — and this is the only place it
# can reach the lifecycle mirror, which wave 4's attention list reads ONLY and
# wave 5's chip reads (spec §5.9: "so a restart does not lose it"). Terminal
# only: the sweep audits every pass, and a retryable `held` or `attached` line
# a minute would bury the journal; the attention list wants terminal rows, and
# a retryable refusal reaches the chip through the sweep's own defer state.
# The case list EQUALS `CHILD_RECLAIM_TOKEN_KIND`'s `terminal` arm —
# `child-reclaim.test.ts` derives the arm from that map and holds this list
# equal to it. `_lc_emit` is always 0 and writes to the journal, never to
# stdout.
```

- [ ] **Step 4: Advertise the verb and its token; route it**

`cmd_caps`' verb heredoc — `ws-reclaim` on its own line directly after `ws-reap`:

```
ws-reap
ws-reclaim
ws-release
```

At the tail of `cmd_caps`, directly after the LAST `echo <token>` line (wave 1's `echo child-argv-v1`) and before the closing `}`:

```bash
  # child reclamation (wave 3): see "RECLAIM-V1" in the RECLAIM region
  echo reclaim-v1
```

(The pointer is its own line, never a trailing comment: `caps-token-shape.test.ts` reads each token line as `/^\s*echo\s+([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/`, and a trailing `# …` would hide the token from it.)

`cmd_caps` also sits above the frozen corpus's anchors (R9), so the token's explanation goes in the RECLAIM region too — append to Step 3 (d)'s block, after its last line:

```bash
#
# RECLAIM-V1. `cmd_caps` echoes it: this box has `ws-audit --reclaim`,
# `ws-reclaim` and its own tail arm, the `reclaim` journal act, and ws-reap's
# mirror refusal — one ccd inode, one token. The server composes the
# destructive verb ONLY behind `capSupported(state, 'reclaim-v1')`, which
# REFUSES on no evidence; `verbSupported` would permit a verb this box never
# had, and this is the verb that deletes a workspace.
```

The dispatcher — directly after `  ws-reap)   shift; cmd_ws_reap "$@" ;;`, with exactly two leading spaces (the parity scan in `ccd-archive.test.ts` matches `/^ {2}([a-z][a-z|-]*)\)/gm`):

```bash
  ws-reclaim) shift; cmd_ws_reclaim "$@" ;;
```

and in the `*)` arm's usage string `|ws-reap|ws-hold|` becomes `|ws-reap|ws-reclaim|ws-hold|`.

`server/src/ccdargv.ts` — directly after the LAST `export const …_CAP = …;` line, as **Files** locates it (`grep -nE "^export const [A-Z_]+_CAP = " server/src/ccdargv.ts | tail -1`):

```ts
/** The `ccd caps` token that says this box has child-workspace reclamation
 *  (spec 2026-09-22 §5.5, wave 3): `ws-audit --reclaim`, `ws-reclaim` with its
 *  own ladder, pin phase and tail arm, and ws-reap's mirror refusal — one ccd
 *  inode. Spelled ONCE in `server/src`; ccd's `echo reclaim-v1` and
 *  `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` are the other two
 *  spellings, held equal by that test's `toContain`.
 *
 *  READ IT WITH `capSupported`, NEVER `verbSupported`. `verbSupported` PERMITS
 *  on an absent verb list; the verb this token gates deletes a workspace, and a
 *  destructive verb dispatched to a box with no evidence it exists is the
 *  failure the capability reader was built to prevent. A box without the token
 *  simply defers every child as `unsupported` — nothing is lost, nothing early. */
export const RECLAIM_CAP = 'reclaim-v1';
```

- [ ] **Step 5: Pay the `_reg_get` census tax, re-stamp ccd, run the tests to verify they pass**

`cmd_ws_audit`'s reclaim branch adds one `_reg_get "` read (the breadcrumb, `rbc=$(_reg_get "$id" reaping)`; MEASURE, never type). Apply the census tax (Global Constraints) with `Task 5` in the `THE LAST MOVE WAS` line, then:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts test/wsaudit.test.ts \
  test/ccd-archive.test.ts test/capsupported.test.ts test/caps-token-shape.test.ts test/ccd-ws-audit.test.ts \
  test/ccd-ws-reap.test.ts test/ownership.test.ts test/single-definition.test.ts test/ccd-reg-get-census.test.ts)
```

Expected: PASS. `ccd-ws-audit` (the plain audit's own 2300-line suite) green UNCHANGED is the byte-identity proof; `ccd-archive` sees `ws-reclaim` on both sides of its caps↔dispatcher parity and `reclaim-v1` among the known tokens; `caps-token-shape` picks `echo reclaim-v1` up through `parseCcdCaps`; `wsaudit` still holds SENTENCES equal to the harvest with `reclaimable` excluded.

- [ ] **Step 6: Pay the citation-corpus tax (S6-R11)**

Run procedure S6-R11. This task inserts CODE lines (and one pointer line) inside `cmd_ws_audit` (every anchor below it shifts), one line in `cmd_caps`' heredoc, one echo at its tail, one dispatcher arm, and the prose block in the RECLAIM region (below every anchor, R9); step 1 will be red — apply steps 2–4, naming the insertions.

- [ ] **Step 7: Mutation check, then commit**

| # | Edit (one at a time; re-stamp; restore; re-stamp) | Command | Expected red |
|---|---|---|---|
| 1 | In the reclaim branch of (b), replace `_ws_reclaim_eval "$id" "$defer" "" \|\| true` with `_ws_reap_eval "$id" \|\| true` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts -t 'SAME token'` | `expected 'not-archived' to be 'reclaimable'` |
| 2 | In the verdict arm, change `…"detail":"","token":%s}\n' "$(_json_str "$REAP_TOKEN")"` to `…"detail":""}\n'` | same file, `-t 'SAME token'` | `expected undefined to be '<64 hex>'` — a `reclaimable` verdict with no token is consent nobody can give |
| 3 | Delete the `elif [[ -n "$rbc" ]]; then _ws_reclaim_resume_eval …` arm (a reclaim breadcrumb then takes the fresh ladder) | same file, `-t 'RESUME token'` | `expected '<fresh token>' to be '<resume token>'` |
| 4 | Delete `echo reclaim-v1` | same file, `-t 'advertises the verb AND its capability token'` | `expected [ … ] to include 'reclaim-v1'` |
| 5 | Delete the `ws-reclaim)` dispatcher arm | same file, `-t 'routes ws-reclaim'` | `expected '…' not to contain 'usage: ccd {start|'` |
| 6 | `server/src/ccdargv.ts`: `RECLAIM_CAP = 'reclaim-v2'` | `cd server && ./node_modules/.bin/vitest run test/capsupported.test.ts test/ccd-archive.test.ts` | `expected 'reclaim-v2' to be 'reclaim-v1'`; `expected [ … ] to include 'reclaim-v2'` |
| 7 | Delete the `case "$REAP_VERDICT" in … esac` that journals a terminal audit refusal | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts -t 'journals a TERMINAL audit refusal'` | `expected [] to deep equally contain { act: 'reclaim', token: 'containment-unproven' }` — a refusal the mirror never saw |
| 7a | Delete the `elif [[ "$REAP_VERDICT" == unmeasured ]]; then … return 1` arm of the reclaim verdict line | same file, `-t 'could not RUN EXITS 1'` | `expected 0 to be 1` — the audit answered an unmeasured ladder at exit 0 as if it were a verdict — PREDICTED at planning; measure it |
| 7b | Delete `\|no-worktree-record` from that `case`'s pattern | same file, `-t 'journals no-worktree-record'` | `expected [] to deep equally contain { act: 'reclaim', token: 'no-worktree-record' }` — a terminal refusal the attention list would never see; Task 8's equality case reds on the same edit (its mutation table) — PREDICTED at planning |
| 7c | In the reclaim verdict line's `unmeasured` arm, delete its `printf '"verdict":%s,"detail":%s}\n' …` line (stderr and `return 1` kept) | same file, `-t 'could not RUN EXITS 1'` | `SyntaxError: … JSON` at `JSON.parse(r.stdout)` — the reclaim document left unclosed, not the `"verdict":"unmeasured"` answer contract §8 R11′ rules — PREDICTED at planning |
| 8 | Add `held\|` to the front of that `case`'s pattern | same file, `-t 'journals a TERMINAL audit refusal'` (row 7's) | `a retryable verdict and the plain audit write NOTHING: expected [ { … } ] to deeply equal []` |

Restore everything, re-stamp, re-run Step 5 (green), then:

```bash
git add ccd/ccd server/src/ccdargv.ts server/test/ccd-child-reclaim-audit.test.ts server/test/wsaudit.test.ts \
  server/test/ccd-archive.test.ts server/test/capsupported.test.ts \
  $(git diff --name-only -- server/test/session-hook.test.ts README.md)   # S6-R11's edits, when there were any
git commit -m "$(cat <<'MSG'
feat(ccd): ws-audit --reclaim mints the token; reclaim-v1 advertises the verb

ws-audit --session <id> --reclaim [--defer-expired] prints the audit's own
document with its verdict from the reclaim ladder, plus mode and childOf, and
a token only when the ladder passes; on a reclaim: breadcrumb it answers the
resume token the verb accepts, on a ws-reap breadcrumb reap-in-progress. The
plain audit is byte-identical; a terminal reclaim verdict found by the audit
is journaled as a reclaim refusal, so the mirror sees it, and a retryable one
is not; an unmeasured ladder answers its document with verdict unmeasured and
exits 1. cmd_caps advertises ws-reclaim and the
reclaim-v1 capability token; the dispatcher routes the verb. RECLAIM_CAP is
the server's one spelling, read with capSupported (spec 2026-09-22 §5.5, §6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The grant, the two argv builders, and the remote budget

**Model routing:** `sonnet`, effort `high` — the contract's routing (§6): implementation is `sonnet`, and `opus` is reserved for this wave's ccd ladder, pin phase and tail arm (Tasks 2–4). The grant's judgment lives where the contract puts it — review lens 2 reads it at `opus` — and the proof here is mechanical: typecheck against an adversarial type, as `REQUIRED_VERB_FLAG`'s other enrolments were. `agent/CLAUDE.md`'s point stands: the whitelist is the sole control between the PWA and the fleet's shell, and this is the first grant for a verb the server sends with no human in the path.

**Files:**
- Modify: `agent/src/whitelist.ts` — `REQUIRED_VERB_FLAG` (APPEND one entry; never rewrite the object) and `EXEC_WHITELIST.ccd` (directly after `['ws-reap',  '--expect'],`)
- Create: `agent/test/types/bypasses/g13-ws-reclaim-without-expect.ts`
- Modify: `agent/test/types/ok/legit-whitelist.ts` (after `WinSizeNeedsSession`), `agent/test/whitelist-structural.test.ts` (`EXPECTED`, after the `g12` entry), `agent/CLAUDE.md` (the "Gated verbs" bullet)
- Modify: `server/src/ccdargv.ts` — `deferFlags` beside `decFlags`; `CCD_ARGV.wsReclaimAudit` and `CCD_ARGV.wsReclaim` directly after `wsReap`
- Modify: `server/src/remote/runner.ts` — `CCD_VERB_TIMEOUT_MS`
- Modify: `server/test/whitelist-subset.test.ts` (`SAMPLES`, the token-for-token `EXPECTED`, and a layer-3 case after `ws-reap is grantable ONLY with its confirmation token…`), `server/test/ccdargv-dec-parity.test.ts` (the derived list and `PROBES`), `server/test/remote-runner.test.ts` (one row)

**Interfaces:**
- Consumes: Task 5's advertised verb (`agent/test/whitelist-noghosts.test.ts` refuses a grant for a verb ccd does not advertise — which is why this task comes after Task 5).
- Produces:
  - `EXEC_WHITELIST.ccd` gains `['ws-reclaim', '--expect']`; `REQUIRED_VERB_FLAG` gains `'ws-reclaim': '--expect'`. `UNGRANTABLE_VERBS` is untouched.
  - `CCD_ARGV.wsReclaimAudit(id: string, deferExpired: boolean): CcdArgv` → `['ws-audit','--session',id,'--reclaim',…(deferExpired ? ['--defer-expired'] : [])]` — rides the existing `['ws-audit','--session']` grant.
  - `CCD_ARGV.wsReclaim(token: string, childOf: number, id: string, deferExpired: boolean, dec: ActorFlags | null): CcdArgv` → `['ws-reclaim','--expect',token,'--child-of',String(childOf),'--session',id,…deferFlags,…decFlags(dec)]`.
  - `CCD_VERB_TIMEOUT_MS['ws-reclaim'] = 240_000` — `ws-reap`'s own budget.

**Why `deferFlags` is a named helper and not an inline ternary:** `ccdargv-dec-parity.test.ts` finds the dec-appending verbs by matching every `argv([…])` literal in `CCD_ARGV` LAZILY to its first `])`. An inline `… : [])` inside `wsReclaim`'s literal would end that match before `decFlags(` and hide `ws-reclaim` from the only test that runs the real binary on its dec — measured while this plan was written. The helper sits above `CCD_ARGV`, outside the scanned table.

- [ ] **Step 1: Write the failing tests**

(a) Create `agent/test/types/bypasses/g13-ws-reclaim-without-expect.ts` (first confirm the number is free: `ls agent/test/types/bypasses/ | sed -n 's/^g\([0-9]*\)-.*/\1/p' | sort -n | tail -1` must print `12`; if a later programme took `g13`, use the next free number and name the substitution in the wave-done mail):

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// CHILD RECLAMATION, wave 3: `['ws-reclaim', '--expect']` -> `['ws-reclaim']`,
// i.e. a grant that keeps the destructive verb and drops its confirmation
// token — g5's shape for the one other verb that deletes a workspace.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-reclaim']` admits the argv
// `CCD_ARGV.wsReclaim` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `ws-reclaim` is not a narrower grant: it permits an
// UNCONFIRMED reclaim of any id the server was talked into composing, with no
// fingerprint re-proved against the box at the instant of deletion.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-reclaim']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

(b) `agent/test/whitelist-structural.test.ts` — in `EXPECTED`, after the `'g12-win-size-without-session.ts'` entry:

```ts
  // CHILD RECLAMATION wave 3, g5's shape for the second destructive verb with a
  // confirmation token: the enrolment, not the grant, is what refuses it.
  'g13-ws-reclaim-without-expect.ts': {
    what: 'the child-reclaim verb granted without its confirmation token',
    codes: ['TS2322'],
  },
```

(c) `agent/test/types/ok/legit-whitelist.ts` — after the `WinSizeNeedsSession` line:

```ts
/** Child reclamation (wave 3). The destructive verb the server composes with no
 *  human in the path is enrolled on its confirmation token; losing the
 *  enrolment stops this project compiling. `g13-ws-reclaim-without-expect.ts`
 *  is the same mechanism from the other side. */
export type ReclaimNeedsExpect = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-reclaim'], '--expect'>>;
```

(d) `server/test/whitelist-subset.test.ts` — `SAMPLES`, after `wsReap`:

```ts
  // CHILD RECLAMATION wave 3. The audit half rides wsAudit's grant; the verb
  // carries a dec, so layer 2 proves the FLAGGED shape crosses the new grant.
  wsReclaimAudit: ['demo-quiet-basin', true],
  wsReclaim: ['a'.repeat(64), 7, 'demo-quiet-basin', false,
              { surface: 'agent', actor: 'run:7 reclaim close', reason: null }],
```

the token-for-token `EXPECTED` table, after its `wsReap` row:

```ts
    wsReclaimAudit: ['ws-audit', '--session', 'demo-quiet-basin', '--reclaim', '--defer-expired'],
    wsReclaim: ['ws-reclaim', '--expect', 'a'.repeat(64), '--child-of', '7', '--session', 'demo-quiet-basin',
                '--surface', 'agent', '--actor', 'run:7 reclaim close'],
```

and a layer-3 case directly after `it('ws-reap is grantable ONLY with its confirmation token, and no reap is grantable without one'`:

```ts
  // CHILD RECLAMATION wave 3 — the second destructive verb, and the first the
  // SERVER sends with no human in the path. Same mechanism, same reasons, read
  // from the object across the package boundary.
  it('ws-reclaim is grantable ONLY with its confirmation token, and its audit needs no grant of its own', () => {
    const rc = EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-reclaim');
    expect(rc.length, 'exactly one ws-reclaim grant').toBe(1);
    expect(rc[0]).toEqual(['ws-reclaim', '--expect']);
    const tok = 'a'.repeat(64);
    expect(isExecAllowed('ccd', ['ws-reclaim', '--child-of', '7', '--session', 'demo-quiet-basin'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reclaim'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-reclaim', tok, '--child-of', '7', '--session', 'demo-quiet-basin'])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsReclaim(tok, 7, 'demo-quiet-basin', false, null)])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsReclaim(tok, 7, 'demo-quiet-basin', true,
      { surface: 'agent', actor: 'run:7 reclaim sweep', reason: null })])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsReclaimAudit('demo-quiet-basin', true)])).toBe(true);
    expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-audit'), 'no second audit grant').toEqual([['ws-audit', '--session']]);
    expect(UNGRANTABLE_VERBS, 'ws-reclaim has a lawful grantable form; it is not ungrantable').not.toContain('ws-reclaim');
  });
```

(e) `server/test/ccdargv-dec-parity.test.ts` — the derived list becomes seven:

```ts
    expect(decAppendingVerbs())
      .toEqual(['ws-add', 'ws-archive', 'ws-hold', 'ws-reclaim', 'ws-release', 'ws-rename', 'ws-restore']);
```

(its `it` title `…and finds six — the five workspace verbs and ws-add` becomes `…and finds seven — the five workspace verbs, ws-add and ws-reclaim`), and `PROBES` gains, after `'ws-rename'`:

```ts
  // Child reclamation, wave 3. The real verb takes the reap lock and answers
  // `no-such-session` as JSON for the absent id — the five session verbs'
  // witness, and proof the dec was stripped before `--session` bound.
  'ws-reclaim': { argv: (d) => CCD_ARGV.wsReclaim('a'.repeat(64), 7, ABSENT, false, d), reached: refusedForTheAbsentSession },
```

(f) `server/test/remote-runner.test.ts` — in `describe('per-verb timeouts'`'s table, after the `ws-reap` row:

```ts
    // Child reclamation: ws-reap's destruction plus a pin phase and a settle.
    [['ws-reclaim', '--expect', 'a'.repeat(64), '--child-of', '7', '--session', 'x'], 240_000],
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
(cd agent  && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts)
(cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/ccdargv-dec-parity.test.ts test/remote-runner.test.ts)
```

Expected: FAIL. agent `whitelist-structural`: `g13-ws-reclaim-without-expect.ts` → `expected [] to equal ['TS2322']` (the fixture compiles: nothing enrols the verb) and `the positive control compiles clean` fails (`Property 'ws-reclaim' does not exist`). server `whitelist-subset`: `has a sample for every CCD_ARGV entry` fails (`wsReclaimAudit`, `wsReclaim` in `SAMPLES`, absent from `CCD_ARGV`), the new case `expected 0 to be 1`. `ccdargv-dec-parity`: `expected [ …six… ] to deeply equal [ …seven… ]`. `remote-runner`: `expected 90000 to be 240000`.

- [ ] **Step 3: The grant and its enrolment**

`agent/src/whitelist.ts` — `REQUIRED_VERB_FLAG` gains ONE entry, every existing one kept (the object is appended to, never rewritten — rewriting it from an older copy silently drops a live enrolment):

```ts
export const REQUIRED_VERB_FLAG = {
  'ws-reap': '--expect', 'ws-rename': '--session', 'coord-pause': '--state',
  'project-pool': '--project', 'route': '--session',
  'win-size': '--session', 'ws-reclaim': '--expect',
} as const;
```

(if a later programme added entries, keep them and add `'ws-reclaim': '--expect'` as the last), and in `EXEC_WHITELIST.ccd`, directly after `['ws-reap',  '--expect'],   // load-bearing: no reap without a confirmation token`:

```ts
    // CHILD-WORKSPACE RECLAMATION (spec 2026-09-22 §5.5): the one destructive
    // verb the SERVER sends with no human in the path. Granted on its
    // confirmation token for ws-reap's own reason — a bare `['ws-reclaim']` is
    // not a narrower grant, it permits an UNCONFIRMED reclaim of any id — and
    // ENROLLED in `REQUIRED_VERB_FLAG` above, so that narrowing is a TS2322
    // and a boot refusal (g13). ccd re-proves the token inside the reap lock,
    // and refuses `not-a-child` unless the box's `.child` marker equals the
    // `--child-of` the server composed. `ws-audit --reclaim` needs NO grant of
    // its own: it rides `['ws-audit','--session']`, and it destroys nothing.
    ['ws-reclaim', '--expect'],
```

`agent/CLAUDE.md` — the "Gated verbs" bullet's first sentence becomes: `` **Gated verbs:** `ws-reap` requires `--expect` (confirmation token), `ws-rename` requires `--session` (its argv is built from model output with no human in the path), `ws-reclaim` requires `--expect` (the child-reclaim token; the server composes it for a child with no human in the path). `` — the rest of the bullet unchanged.

- [ ] **Step 4: The builders, and the budget**

`server/src/ccdargv.ts` — directly after `decFlags`:

```ts
/**
 * `--defer-expired`, or nothing (child reclamation, spec 2026-09-22 §5.7: the
 * presence defer's ceiling, spent on the audit and the verb alike). A named
 * helper and not an inline ternary ON PURPOSE: `ccdargv-dec-parity.test.ts`
 * derives the dec-appending verbs from every `argv([…])` literal in the table
 * below with a LAZY match to the first `])`, and an inline `: []` inside
 * `wsReclaim`'s literal would end that match before `decFlags(` — hiding
 * `ws-reclaim` from the one test that runs the real binary on its dec.
 */
const deferFlags = (deferExpired: boolean): readonly string[] => (deferExpired ? ['--defer-expired'] : []);
```

and inside `CCD_ARGV`, directly after `wsReap`:

```ts
  /** `ws-audit --reclaim` (child reclamation, spec 2026-09-22 §5.5): the SAME
   *  verb and the SAME granted prefix as `wsAudit` — `['ws-audit','--session']`
   *  — with the mode flag AFTER the id, the order `cmd_ws_audit`'s fixed-arity
   *  parse reads. No grant of its own: the audit destroys nothing. */
  wsReclaimAudit: (id: string, deferExpired: boolean) =>
    argv(['ws-audit', '--session', id, '--reclaim', ...deferFlags(deferExpired)]),
  /** `ws-reclaim` — the ONE destructive argv this server composes with no human
   *  in the path (spec §5.5). `childOf` is the run the SERVER holds as having
   *  minted the workspace — the second authority, which ccd compares to the
   *  box's `.child` marker, refusing `not-a-child` on any disagreement.
   *  `token` is `ws-audit --reclaim`'s, re-proven by ccd inside the reap lock.
   *  The confirmation token LEADS (`['ws-reclaim','--expect']` is the grant);
   *  `--defer-expired` and the dec trail, and ccd strips both before it binds a
   *  positional. */
  wsReclaim: (token: string, childOf: number, id: string, deferExpired: boolean, dec: ActorFlags | null) =>
    argv(['ws-reclaim', '--expect', token, '--child-of', String(childOf), '--session', id,
          ...deferFlags(deferExpired), ...decFlags(dec)]),
```

`server/src/remote/runner.ts` — in `CCD_VERB_TIMEOUT_MS`, directly after `'ws-reap': 240_000,`:

```ts
  // Child reclamation (spec 2026-09-22 §5.6): ws-reap's destruction — a
  // worktree that can hold gigabytes of node_modules, a branch, the clips, a
  // temp root — plus a pin phase and a settle. It earns ws-reap's budget, not
  // the flat 90 s it would silently inherit without this row.
  'ws-reclaim': 240_000,
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
(cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts \
  test/whitelist-noghosts.test.ts test/whitelist-prototype.test.ts test/exec.test.ts)
(cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/ccdargv-dec-parity.test.ts \
  test/remote-runner.test.ts test/ccdargv-brand.test.ts test/verb-gate.test.ts test/unattended-actor.test.ts \
  test/single-definition.test.ts test/typecheck-tests.test.ts)
```

Expected: PASS. `verb-gate` still passes: no `server/src` call site of either builder exists yet (Task 8 adds them, with their gates). `typecheck-tests` is a known load flake — re-run it alone before calling it a break.

- [ ] **Step 6: Mutation check, then commit**

| # | Edit (one at a time, restore after) | Command | Expected red |
|---|---|---|---|
| 1 | Delete `'ws-reclaim': '--expect'` from `REQUIRED_VERB_FLAG` (keep the grant) | `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts` | `g13-ws-reclaim-without-expect.ts`: `expected [] to equal ['TS2322']`; `the positive control compiles clean` fails — the ENROLMENT, not the grant, is what refuses the bare shape |
| 2 | Narrow the grant to `['ws-reclaim']` | `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts`; `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts` | agent: the module-load audit refuses to boot; server: `expected [ 'ws-reclaim' ] to deeply equal [ 'ws-reclaim', '--expect' ]` |
| 3 | In `wsReclaim`, replace `...deferFlags(deferExpired)` with `...(deferExpired ? ['--defer-expired'] : [])` | `cd server && ./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts` | `finds seven`: `ws-reclaim` missing from the derived list — the reason `deferFlags` exists |
| 4 | In `wsReclaim`, drop `...decFlags(dec)` | `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/ccdargv-dec-parity.test.ts` | `wsReclaim builds the exact argv`: missing `--surface agent --actor …`; the derived list loses `ws-reclaim` |
| 5 | Delete `'ws-reclaim': 240_000` | `cd server && ./node_modules/.bin/vitest run test/remote-runner.test.ts` | `expected 90000 to be 240000` |

Restore everything, re-run Step 5 (green), then:

```bash
git add agent/src/whitelist.ts agent/test/types/bypasses/g13-ws-reclaim-without-expect.ts \
  agent/test/types/ok/legit-whitelist.ts agent/test/whitelist-structural.test.ts agent/CLAUDE.md \
  server/src/ccdargv.ts server/src/remote/runner.ts server/test/whitelist-subset.test.ts \
  server/test/ccdargv-dec-parity.test.ts server/test/remote-runner.test.ts
git commit -m "$(cat <<'MSG'
feat(agent): grant ws-reclaim on its confirmation token, enrolled so it cannot narrow

['ws-reclaim','--expect'] in EXEC_WHITELIST.ccd, enrolled in
REQUIRED_VERB_FLAG so a bare ['ws-reclaim'] is a TS2322 on the LawfulGrants
proof line and a boot refusal (fixture g13), and pinned cross-package by
whitelist-subset. ws-audit --reclaim rides the existing ws-audit grant. The
server gains CCD_ARGV.wsReclaimAudit and CCD_ARGV.wsReclaim, the real binary
proves it parses the dec, and ws-reclaim gets ws-reap's 240 s remote budget
(spec 2026-09-22 §5.5, §6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The store — `cancelDeliveriesTo`, its park, and D-51's predicate with one run set aside

**Model routing:** `sonnet`, effort `high` — two store surfaces with a writer census, a single-definition pin and a derived reader walk already watching them; the tests below say what each must do.

**Files:**
- Modify: `server/src/coord/store.ts` — `MAIL_CHILD_RECLAIMED_ERROR` directly after `MAIL_REBIND_SUPERSEDED_ERROR`; `DELIBERATE_CANCEL_ERRORS_SQL` and its docstring; the new `cancelDeliveriesTo` directly after `cancelOutstandingDeliveries`; `programOpenRunCount`'s optional exclusion; `requeueAbandonedMail`'s reader walk (its holder count, and one bullet)
- Modify: `server/test/single-definition.test.ts` — the deliberate-cancel pin learns its fourth member, **four lines changed IN PLACE, none added** (the frozen citation corpus cites this file at `:32-37`, `:1274` and `:1303`; measured while this plan was written, the same edit written with four extra lines moved `CITATION DEBT`'s `server/test/single-definition.test.ts` entry from 8 to 10)
- Create: `server/test/child-reclaim-mail-store.test.ts` (contract §7 R13: NOT wave 2's `server/test/child-reclaim-store.test.ts`, which already exists with `clearSession`'s four cases and is left untouched — confirm with `test -f server/test/child-reclaim-store.test.ts && ! test -e server/test/child-reclaim-mail-store.test.ts` before the create)

**Interfaces:**
- Consumes: `OUTSTANDING_STATES_SQL`, `TERMINAL_RUN_STATES_SQL`, `DELIBERATE_CANCEL_ERRORS_SQL`'s existing readers (`ABANDONED_PARK_SQL` → `outstandingMailFor`, `requeueAbandonedMail`).
- Produces:
  - `export const MAIL_CHILD_RECLAIMED_ERROR = 'child workspace reclaimed';` — a DELIBERATE park, the fourth member of `DELIBERATE_CANCEL_ERRORS_SQL`.
  - `CoordStore.cancelDeliveriesTo(toId: string): number` — the contract's writer: keyed on the recipient, guarded by `OUTSTANDING_STATES_SQL`, RETURNING its change count (never `void`, so CLAUDE.md's void-writer sentence does not move). Task 8's executor calls it on `reclaimed`, and on a registry row it has itself MEASURED absent — `readSessionRecord`'s `absent` CONFIRMED by a second listing that names neither `<id>.uuid` nor `<id>.child` (a box half that finished without its cancel); a row the reader merely dropped is not absent — never on a refusal, a failure or an unreadable registry.
  - `CoordStore.programOpenRunCount(program: string, excludeRunId?: number): number` — D-51's predicate, ONE query; Task 9's `retiresProgram` passes the closing run's id, D-51's own call passes none.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-mail-store.test.ts`:

```ts
// Child reclamation, wave 3 — the two store surfaces the executor and the
// close decision lean on (spec 2026-09-22 §5.6, §5.7):
//
//   - `cancelDeliveriesTo(toId)`: every OUTSTANDING delivery addressed to a
//     reclaimed child, parked on purpose — keyed on the RECIPIENT, so it
//     reaches what `cancelOutstandingDeliveries(runId)` cannot (an earlier
//     wave's unacked mail, peer mail with no run), and returning its count.
//   - `programOpenRunCount(program, excludeRunId?)`: D-51's retirement
//     predicate, asked with the closing run set aside — "would this close
//     retire the program?" — by the ONE query, not a second spelling.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_CHILD_RECLAIMED_ERROR } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const CHILD = 'demo-quiet-basin';
const OTHER = 'demo-other-mesa';
const NOW = 1_000_000_000_000;

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-child-reclaim-mail-store-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, wave: number): number => {
  const r = s.openRun({ program, title: 't', project: 'demo', wave, waveOf: 3, claimedBy: 'demo-coordinator' });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};
const deliver = (s: CoordStore, to: string, runId: number | null): number => {
  const m = s.insertMail({ fromId: 'demo-coordinator', fromUuid: 'u', toId: to, runId,
    kind: 'status', subject: 's', body: 'b', artifacts: [] });
  return s.queueDelivery(m.id, to, '<mail/>').id;
};
const row = (s: CoordStore, id: number) => s.db.prepare(
  'SELECT state, rejectCode, lastError FROM mail_deliveries WHERE id = ?',
).get(id) as { state: string; rejectCode: string | null; lastError: string | null };

describe('cancelDeliveriesTo — the reclaimed child’s outstanding mail, parked on purpose', () => {
  it('parks every outstanding delivery TO the child, across runs and peers, and counts them', () => {
    const s = store();
    const w1 = open(s, 'p', 1);
    const w2 = open(s, 'p', 2);
    const fromWave1 = deliver(s, CHILD, w1);                 // queued, an earlier wave's
    const fromWave2 = deliver(s, CHILD, w2);
    s.markDelivered(fromWave2, NOW);                          // delivered, never acked
    const peer = deliver(s, CHILD, null);                     // no run at all
    const elsewhere = deliver(s, OTHER, w2);                  // someone else's
    const acked = deliver(s, CHILD, w2);
    s.markDelivered(acked, NOW); expect(s.markAcked(acked, NOW).ok).toBe(true);
    const parked = deliver(s, CHILD, w2);
    s.rejectDelivery(parked, 'undeliverable', 'recipient not in registry');

    expect(s.cancelDeliveriesTo(CHILD), 'the count is the three outstanding rows, nothing else').toBe(3);
    for (const id of [fromWave1, fromWave2, peer]) {
      expect(row(s, id)).toEqual({ state: 'rejected', rejectCode: 'undeliverable', lastError: MAIL_CHILD_RECLAIMED_ERROR });
    }
    expect(row(s, elsewhere).state, 'another recipient is untouched').toBe('queued');
    expect(row(s, acked).state, 'an acked row is not outstanding').toBe('acked');
    expect(row(s, parked).lastError, 'an earlier park keeps its own reason').toBe('recipient not in registry');
    expect(s.cancelDeliveriesTo(CHILD), 'a second call finds nothing outstanding').toBe(0);
    expect(s.dueDeliveries(NOW + 10_000_000, 1).map((d) => d.id)).not.toEqual(
      expect.arrayContaining([fromWave1, fromWave2, peer]));
  });

  it('is a DELIBERATE park — the mailbox does not list it as abandoned, while a real abandonment stays listed', () => {
    const s = store();
    const w = open(s, 'p', 1);                                // OPEN: the run-terminal exclusion cannot be what hides it
    const peer = deliver(s, CHILD, null);
    const ofRun = deliver(s, CHILD, w);
    const abandoned = deliver(s, CHILD, w);
    s.rejectDelivery(abandoned, 'undeliverable', 'recipient not in registry');   // the CONTROL
    expect(s.cancelDeliveriesTo(CHILD)).toBe(2);
    const listed = s.outstandingMailFor(CHILD).map((m) => m.deliveryId);
    expect(listed, 'the control: an abandoned park is still a human’s to see').toContain(abandoned);
    expect(listed, 'the reclaim park is not').not.toContain(peer);
    expect(listed).not.toContain(ofRun);
  });

  it('spells its sentence once, and holds no apostrophe — it is interpolated into SQL', () => {
    expect(MAIL_CHILD_RECLAIMED_ERROR).toBe('child workspace reclaimed');
    expect(MAIL_CHILD_RECLAIMED_ERROR.includes("'")).toBe(false);
  });
});

describe('programOpenRunCount(program, excludeRunId) — D-51’s predicate, one run set aside', () => {
  it('answers "would closing THIS run retire the program" before the close, and D-51 still retires after it', () => {
    const s = store();
    const a = open(s, 'p', 1);
    const b = open(s, 'p', 2);
    const c = open(s, 'q', 1);
    expect(s.programOpenRunCount('p')).toBe(2);
    expect(s.programOpenRunCount('p', a)).toBe(1);
    expect(s.programOpenRunCount('p', c), 'another program’s run excludes nothing here').toBe(2);
    expect(s.programOpenRunCount('q', c)).toBe(0);
    expect(s.closeRun({ runId: b, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
      viaClosing: false }).ok).toBe(true);
    expect(s.programOpenRunCount('p', a), 'with b terminal, closing a retires p').toBe(0);
    expect(s.programOpenRunCount('p')).toBe(1);
    expect(s.closeRun({ runId: a, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
      viaClosing: false }).ok).toBe(true);
    const state = (slug: string) => (s.db.prepare('SELECT state FROM programs WHERE slug = ?').get(slug) as { state: string }).state;
    expect(state('p'), 'D-51 retired it from inside the close transaction, unexcluded').toBe('abandoned');
    expect(state('q')).toBe('active');
  });

  it('is ONE query in the store — the exclusion rides the same statement, never a second spelling', () => {
    const store = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'store.ts'), 'utf8');
    expect(store.match(/SELECT count\(\*\) AS c FROM runs WHERE program = \?/g) ?? []).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim-mail-store.test.ts)
```

Expected: FAIL at the ASSERTIONS, not at collection. Vitest reads a named import as a property of the transformed module, so the missing `MAIL_CHILD_RECLAIMED_ERROR` is `undefined` rather than a `SyntaxError` (measured, vitest 4.1). The two `cancelDeliveriesTo` cases fail with `TypeError: s.cancelDeliveriesTo is not a function`; the sentence case with `expected undefined to be 'child workspace reclaimed'`; the predicate case with `expected 2 to be 1` at `programOpenRunCount('p', a)` (today's one-parameter method ignores the exclusion); the one-query case passes — the statement already exists exactly once.

- [ ] **Step 3: The park and its place in the deliberate set**

`server/src/coord/store.ts` — directly after `export const MAIL_REBIND_SUPERSEDED_ERROR = 'recipient rebound';`:

```ts

/**
 * The child-reclaim park (child-reclamation spec 2026-09-22 §5.6): every
 * outstanding delivery ADDRESSED TO a child workspace the server has just
 * reclaimed, parked by `cancelDeliveriesTo`. Its OWN sentence, for
 * `MAIL_REBIND_SUPERSEDED_ERROR`'s reason: `'run closed'` is false of a
 * delivery from an earlier wave's run or from a peer (no run at all), and
 * `lastError` reaches an operator's eye through `MailSummary.lastError`.
 *
 * A DELIBERATE cancel, so it joins `DELIBERATE_CANCEL_ERRORS_SQL` below — and
 * it is not "a purged recipient", the abandonment park that set must never
 * hold. That park (`watch.ts`'s `sweepMail`) is the lane DISCOVERING a
 * recipient gone from under it, ~26 minutes after the fact, which is worth a
 * human's look. This one is the server's own act, taken the instant the
 * reclaim it caused succeeded: the recipient was removed ON PURPOSE because
 * its run had closed, and a row that stayed visible as "this still needs a
 * human" would ask a human to act on mail to a workspace that, by rule 4, no
 * human was ever meant to open. It is also what ends the recycled-slug hazard
 * `sweepMail`'s own comment names: `_ws_slug_new` re-mints a purged id, and a
 * delivery left outstanding would be typed into the stranger that inherits
 * it. No apostrophe: it is interpolated into the SQL fragment below.
 */
export const MAIL_CHILD_RECLAIMED_ERROR = 'child workspace reclaimed';
```

In the docstring directly above `DELIBERATE_CANCEL_ERRORS_SQL`, replace its first three lines:

```ts
/** The three parks that are DECISIONS rather than abandonment — a run closing
 *  (`closeRun`), a chair changing hands (`reclaimProgram`) and an occupant
 *  changing (`bindSession`) — as one SQL list,
```

with:

```ts
/** The four parks that are DECISIONS rather than abandonment — a run closing
 *  (`closeRun`), a chair changing hands (`reclaimProgram`), an occupant
 *  changing (`bindSession`) and a child workspace reclaimed
 *  (`cancelDeliveriesTo`, child-reclamation wave 3) — as one SQL list,
```

and the constant itself:

```ts
const DELIBERATE_CANCEL_ERRORS_SQL =
  `('${MAIL_RUN_CLOSED_ERROR}','${MAIL_RECLAIM_CANCELLED_ERROR}','${MAIL_REBIND_SUPERSEDED_ERROR}','${MAIL_CHILD_RECLAIMED_ERROR}')`;
```

- [ ] **Step 4: The writer, and the predicate with one run set aside**

Directly after `cancelOutstandingDeliveries`'s closing brace. ONE statement in ONE method with a SINGLE-LINE signature — `mail-hardening.test.ts`'s writer scan walks back from the `UPDATE` to the nearest single-line signature, requires a distinct method per statement, and requires `OUTSTANDING_STATES_SQL` or `TERMINAL_DELIVERY_SQL` in the SQL itself:

```ts

  /** Child reclamation (spec 2026-09-22 §5.6): every outstanding delivery
   *  ADDRESSED TO `toId`, parked `rejected('undeliverable')` with
   *  `MAIL_CHILD_RECLAIMED_ERROR` — called by `reclaimChild` ONLY once the
   *  child is gone: after `ws-reclaim` answered `reclaimed`, or when its own
   *  registry read MEASURED the row absent — confirmed by a second listing
   *  naming no `.uuid`/`.child` for the id (an earlier attempt's box half
   *  finished without reaching this call). Never before, and never on a
   *  refusal or a failure — those leave a live recipient that may still read
   *  its mail.
   *
   *  KEYED ON THE RECIPIENT, and that is why it is its own writer rather than
   *  `cancelOutstandingDeliveries` above: that one is keyed on `mail.runId`, so
   *  it cannot reach a delivery from an EARLIER wave's run that the child never
   *  acked, nor peer mail with no run at all. `mail_deliveries.toId` is the
   *  RESOLVED session, never the `'coordinator'`/`'worker'` role `mail.toId`
   *  may carry, so this parks exactly what was sent to the child.
   *
   *  RETURNS the number of rows it parked, never `void` — so it is not one of
   *  the writers CLAUDE.md lists as returning `void`, and a caller can tell a
   *  park from a no-op. An already-`acked` or already-parked row is left
   *  alone: `OUTSTANDING_STATES_SQL` is the whole guard. Plain enough (no
   *  nested `tx()`) to call standalone, like its sibling. */
  cancelDeliveriesTo(toId: string): number {
    const res = this.db.prepare(
      "UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable', " +
      `lastError = '${MAIL_CHILD_RECLAIMED_ERROR}' WHERE state IN ${OUTSTANDING_STATES_SQL} AND toId = ?`,
    ).run(toId);
    return Number(res.changes);
  }
```

`programOpenRunCount` — replace its last docstring line and body:

```ts
   *  parked at `awaiting-review` is still open, and must stay so. */
  programOpenRunCount(program: string): number {
    return (this.db.prepare(
      `SELECT count(*) AS c FROM runs WHERE program = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL}`,
    ).get(program) as { c: number }).c;
  }
```

with:

```ts
   *  parked at `awaiting-review` is still open, and must stay so.
   *
   *  `excludeRunId` (child reclamation, wave 3) asks the SAME question with one
   *  run set aside: "would closing THIS run retire the program?", which
   *  `closeRun` in `coord/close.ts` must answer BEFORE its fleet act, while the
   *  closing run is still non-terminal. One predicate, two askers — the
   *  retirement check above passes no exclusion, because by then the closing
   *  run already reads terminal inside its own transaction. `-1` when absent,
   *  an id AUTOINCREMENT never mints, so both are ONE query —
   *  `openRunsForSession`'s own idiom. */
  programOpenRunCount(program: string, excludeRunId?: number): number {
    return (this.db.prepare(
      `SELECT count(*) AS c FROM runs WHERE program = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} AND id != ?`,
    ).get(program, excludeRunId ?? -1) as { c: number }).c;
  }
```

- [ ] **Step 5: The reader walk admits its new holder**

`single-definition.test.ts`'s *the re-queue's reader walk names every holder the file actually has* DERIVES every declaration interpolating `${OUTSTANDING_STATES_SQL}` and requires `requeueAbandonedMail`'s docstring to name each one — so the new writer reds it until the walk says what it does to a re-queued row (measured: `the reader walk does not name cancelDeliveriesTo`). In that docstring, replace:

```ts
   * On the narrower `OUTSTANDING_STATES_SQL` — ten holders, in file order:
```

with:

```ts
   * On the narrower `OUTSTANDING_STATES_SQL` — eleven holders, in file order:
```

replace:

```ts
   *     rows the predecessor loses. This whole bullet, and the "ten holders"
   *     count above, is itself a consequence of D-2338 — the brief's own
```

with:

```ts
   *     rows the predecessor loses. This whole bullet, and the tenth holder
   *     counted above, is itself a consequence of D-2338 — the brief's own
```

and directly after the `cancelOutstandingDeliveries` bullet (the one ending `round through this arm on a later reclaim.`), insert:

```ts
   *   `cancelDeliveriesTo` (child reclamation, wave 3) — reached only if an
   *     operator named a CHILD workspace as the heir chair, and correct then
   *     too: it runs after that child has been reclaimed, so the re-queued row
   *     is parked like every other delivery to it, with
   *     `MAIL_CHILD_RECLAIMED_ERROR` — a DELIBERATE cancel, which
   *     `ABANDONED_PARK_SQL` excludes, so it cannot come back round through
   *     this arm either.
```

- [ ] **Step 6: The single-definition pin learns its fourth member — in place**

`server/test/single-definition.test.ts`, *spells the deliberate-cancel SET once*. Four lines change and NONE is added (the file is corpus-cited; see **Files**). Replace:

```ts
    const MEMBERS = '(run closed|coordinator reclaimed|recipient rebound)';
    const LIST = new RegExp(`\\(\\s*'${MEMBERS}'\\s*(?:,\\s*'${MEMBERS}'\\s*){1,2}\\)`);
```

with:

```ts
    const MEMBERS = '(run closed|coordinator reclaimed|recipient rebound|child workspace reclaimed)';
    const LIST = new RegExp(`\\(\\s*'${MEMBERS}'\\s*(?:,\\s*'${MEMBERS}'\\s*){1,3}\\)`);
```

replace:

```ts
    expect(LIST.test("NOT IN ('run closed','coordinator reclaimed','recipient rebound')")).toBe(true);
```

with:

```ts
    expect(LIST.test("NOT IN ('run closed','coordinator reclaimed','recipient rebound','child workspace reclaimed')")).toBe(true);
```

replace:

```ts
      /const DELIBERATE_CANCEL_ERRORS_SQL =\s*\n?\s*`\('\$\{MAIL_RUN_CLOSED_ERROR\}','\$\{MAIL_RECLAIM_CANCELLED_ERROR\}','\$\{MAIL_REBIND_SUPERSEDED_ERROR\}'\)`/);
```

with:

```ts
      /const DELIBERATE_CANCEL_ERRORS_SQL =\s*\n?\s*`\('\$\{MAIL_RUN_CLOSED_ERROR\}','\$\{MAIL_RECLAIM_CANCELLED_ERROR\}','\$\{MAIL_REBIND_SUPERSEDED_ERROR\}','\$\{MAIL_CHILD_RECLAIMED_ERROR\}'\)`/);
```

and replace:

```ts
                        'MAIL_REBIND_SUPERSEDED_ERROR']) {
```

with:

```ts
                        'MAIL_REBIND_SUPERSEDED_ERROR', 'MAIL_CHILD_RECLAIMED_ERROR']) {
```

Confirm no line was added: `git diff --stat server/test/single-definition.test.ts` must print `4 insertions(+), 4 deletions(-)`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim-mail-store.test.ts test/single-definition.test.ts \
  test/mail-hardening.test.ts test/coord-store.test.ts test/mail-sweep.test.ts test/mail-routes.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND')
```

Expected: PASS everywhere — `child-reclaim-mail-store` 5/5; `mail-hardening`'s writer scan finds the new method, its guard, and (it returns `number`) no change to CLAUDE.md's void list; the five citation cases stay green because `single-definition.test.ts` gained no line.

- [ ] **Step 8: Mutation check, then commit**

| # | Edit (one at a time, restore after) | Command | Expected red (measured) |
|---|---|---|---|
| 1 | In `cancelDeliveriesTo`, `WHERE state IN ${OUTSTANDING_STATES_SQL} AND toId = ?` → `WHERE toId = ?` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mail-store.test.ts test/mail-hardening.test.ts` | `the count is the three outstanding rows, nothing else: expected 5 to be 3`; `store.ts:<n> (cancelDeliveriesTo) writes a delivery row with no shared terminality guard` |
| 2 | Drop `,'${MAIL_CHILD_RECLAIMED_ERROR}'` from `DELIBERATE_CANCEL_ERRORS_SQL` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mail-store.test.ts test/single-definition.test.ts` | `the reclaim park is not: expected [ 3, 2, 1 ] to not include 1` — an outstanding-looking park a human would be asked to act on; and the pin's `toMatch` on the four-member constant |
| 3 | `return Number(res.changes);` → `return 0;` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mail-store.test.ts` | `expected +0 to be 3` |
| 4 | In `programOpenRunCount`, drop ` AND id != ?` and pass `.get(program)` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mail-store.test.ts` | `expected 2 to be 1` — the exclusion is gone and every close would count itself |
| 5 | Delete the `cancelDeliveriesTo` bullet from `requeueAbandonedMail`'s reader walk | `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts` | `the reader walk does not name cancelDeliveriesTo` |

Restore everything, re-run Step 7 (green), then:

```bash
git add server/src/coord/store.ts server/test/single-definition.test.ts server/test/child-reclaim-mail-store.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): cancelDeliveriesTo, and D-51's predicate with one run set aside

A reclaimed child's outstanding deliveries are parked on purpose, keyed on
the RECIPIENT — reaching an earlier wave's unacked mail and peer mail that
cancelOutstandingDeliveries(runId) cannot — with their own sentence,
MAIL_CHILD_RECLAIMED_ERROR, the fourth member of the deliberate-cancel set.
The writer returns its count, not void. programOpenRunCount gains an
optional exclusion so close can ask "would closing THIS run retire the
program?" through D-51's one query (spec 2026-09-22 §5.6, §5.7).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: `childReclaim.ts` — the fourteen words, the close decision, and the ONE executor

**Model routing:** `sonnet`, effort `high` — the contract's routing (§6): `opus` is reserved for the ccd ladder, pin phase and tail arm (Tasks 2–4). This is the one server path that composes a destructive verb with no human in it, so its judgment is carried by the tests below (every fail direction pinned with a mutation row) and by review lenses 1 and 3 at `opus`, not by the implementer's model.

**Files:**
- Create: `server/src/coord/childReclaim.ts`
- Create: `server/test/child-reclaim.test.ts`
- Modify: `server/test/verb-gate.test.ts` — `CAP_GATED_VERBS` and `NEW_GENERATION` gain `ws-reclaim`
- Modify: `server/test/unattended-actor.test.ts` — `FILES`, `BUILDERS`, the exact count (thirteen → fourteen as wave 2 leaves it, in the `it` title, its comment and the `SITES` docstring's "Thirteen sites — five distinct labels, plus two …"), one `SITES` entry
- Modify: `server/test/mail-routes.test.ts` — the kebab-token scanner's TENTH union, `isChildReclaimKebab`

**Interfaces:**
- Consumes: `RECLAIM_CAP`, `CCD_ARGV.wsReclaimAudit`, `CCD_ARGV.wsReclaim` (Tasks 5–6); `CoordStore.cancelDeliveriesTo`, `CoordStore.openRunsForSession`, `CoordStore.recordFeedEvent` (Task 7 and existing); `readSessionRecord` and `SessionRecord.child: ChildMark`, `ChildSpentVerdict`, `CHILD_RUN_ID` (wave 2 — the server's one spelling of the run-id grammar, ten ASCII digits, contract §7 R2); `refusalSentence`/`SENTENCES` (Tasks 2 and 4); `capSupported`, `verbSupported`, `sweepDec`; `NotifyLog`; `Presence`.
- Produces (every contract name exactly as the contract spells it, plus the parsers and guards this file needs):
  - `ChildReclaimToken`, `CHILD_RECLAIM_TOKEN_KIND: Readonly<Record<ChildReclaimToken, 'gone' | 'terminal' | 'retry'>>`, `isChildReclaimToken(v: unknown): v is ChildReclaimToken` — FOURTEEN words: the contract's thirteen plus `no-worktree-record`, `terminal` (contract §8 R19). The map's `terminal` arm is also the case list `ws-audit --reclaim` journals (R5′), held equal by a test that derives the arm from this map.
  - `ChildReclaimDeferWhy` (the contract's union), `isChildReclaimDeferWhy(v: unknown): v is ChildReclaimDeferWhy`.
  - `ChildReclaimOutcome` (contract shape); `ChildReclaimRequest` — the contract shape plus **`readonly deferredSinceMs: number | null`** (contract §7 R4: epoch ms of the first deferral the sweep saw for this child; `null` from close); `ChildReclaimDeps { coord; io; cfg; runCcd; fleetState?; presence?: Pick<Presence,'isVisible'>; notifyLog?; now?: () => number }` — the member list wave 4's sweep composes from `this.deps` (its Task 1 Step 3 fact 2 reads it). `now` defaults to `Date.now`; it is read only to render the wait in the feed row.
  - `reclaimChild(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimOutcome>` — THE ONE EXECUTOR. Its feed row is written at ONE exit (`reclaimChild` itself, around `childReclaimOutcome`), and for a `deferred` outcome and for a ceiling-expired reclaim (`req.deferExpired`) that row states how long the child waited and why (R4; spec §5.7, §5.9). **Wave 4 adds the server-side pause read inside this executor (contract §7 R8):** the `paused-at-server` producer, reading `RECLAIM_PAUSE_MARKER`, at the marked place in `childReclaimOutcome` (after the sibling read, before presence and the capability), returning its deferral through that function's own `deferred(...)` helper and so the same one exit — never inside the `reclaimChild` wrapper (contract §8 R8′). `paused-at-server` is declared here and produced nowhere in this wave; ccd's own on-box rung 3 (Task 2) is the read that matters and does not change.
  - `ChildReclaimNotWhy = 'not-a-child' | 'marker-unreadable' | 'siblings-open' | 'siblings-unreadable' | 'review-report-live' | 'not-finished'` (contract §7 R16 adds `review-report-live`), `ChildReclaimDecision`, `ChildReclaimMinting` (its `row` arm carries the minting run's `reviews`), `ChildReclaimReviewed` (the run a review run reviews: `none` / `row` carrying its `RunState` / `absent` / `unreadable` — the state itself, never a pre-folded boolean; its two edges RULED, contract §8 R16′: `unreadable` defers `marker-unreadable`, and `absent` keeps the child, `review-report-live`), `ChildReclaimDecisionInput`, `childReclaimDecision(input): ChildReclaimDecision` — pure; Task 9 is its caller. `isChildReclaimTerminalState(state: RunState): boolean` — `TERMINAL_RUN_STATES` asked, the one reading of "terminal" the decision's review condition uses (exported for wave 4's sweep, which repeats that condition).
  - `parseChildReclaimAudit(stdout): ChildReclaimAuditRead` (its `childOf` judged by `CHILD_RUN_ID`, never a wider numeric parse — R2), `parseChildReclaimResult(sessionId, stdout, stderr): ChildReclaimVerbRead`, `isChildReclaimKebab(v: unknown): boolean`.
  - **An audit that EXITS 1 is `failed`, whatever it printed (contract §8 R11′).** `childReclaimAudit` reads `res.ok` BEFORE it parses a byte, so the audit's unmeasured answer — a reclaim document with `"verdict":"unmeasured"` at exit 1 (Task 5) — and any other exit-1 document, a token-bearing one included, maps to the `failed` outcome, which the sweep retries; the verb is never called on it.

**Why the capability is asked twice.** Step 4 of the executor asks `capSupported(RECLAIM_CAP)` before the audit (the contract's order: nothing is sent to a box that has not proven the verb exists), and `childReclaimAct` asks it AGAIN around the one `CCD_ARGV.wsReclaim` call: `verb-gate.test.ts` reads a call site's enclosing FUNCTION for its gate, and this is the line that must never run without it. Mutation rows 1 and 2 below show each one reds something the other does not.

**Why the audit is its own function with `verbSupported`.** `ws-audit` is an old verb; its call site answers the old skew question. `verb-gate`'s scanner counts ANY `verbSupported(` in an enclosing function as a gate for every call in it — so the audit and the act live in separate functions, and `ws-reclaim`'s scope holds `capSupported` alone.

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/child-reclaim.test.ts`:

```ts
// Child reclamation, wave 3 — the server's half (spec 2026-09-22 §5.5–§5.7,
// §5.9): the fourteen box words and what each means, the two ccd documents
// read, the pure close decision, and THE ONE EXECUTOR `reclaimChild`, driven
// end to end against a fixture registry, a real CoordStore and a scripted ccd.
//
// The runner is `testDeps`', so every argv the executor composes crosses the
// agent's REAL exec whitelist first (`guardRunner`) — a `ws-reclaim` without
// its `--expect` grant would throw here, not merely on the fleet.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_CHILD_RECLAIMED_ERROR, type OpenSiblingsResult } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_TOKEN_KIND, childReclaimDecision, isChildReclaimDeferWhy, parseChildReclaimAudit,
  parseChildReclaimResult, reclaimChild, type ChildReclaimDecisionInput, type ChildReclaimDeps,
  type ChildReclaimToken,
} from '../src/coord/childReclaim.js';
import { NotifyLog } from '../src/notifylog.js';
import { readSessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { SENTENCES } from '../src/wsaudit.js';
import { testDeps } from './helpers.js';
import { CCD } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-basin';
const TOK = 'a'.repeat(64);
const WIP = 'b'.repeat(40);
/** A box that advertises the verb, its capability and the dec flags. */
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };

const auditDoc = (childOf: number, verdict: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: ID, mode: 'reclaim', childOf, verdict, detail: '', ...extra });
const reclaimedDoc = (childOf: number, wip: string | null = null): string =>
  JSON.stringify({ reclaimed: ID, childOf, wip, attic: 2, residueBytes: null });

interface Script { audit?: { code: number; stdout: string; stderr?: string }; verb?: { code: number; stdout: string; stderr?: string } }

/** A child workspace on disk (registry fields + `.child`), its minting run
 *  CLOSED in a real CoordStore, one outstanding delivery addressed to it, and
 *  a scripted ccd. `mark` overrides the marker's bytes; `null` writes none. */
const rig = async (over: { mark?: string | null; script?: (runId: number) => Script; fleetState?: FleetState; visible?: boolean;
                           row?: boolean; now?: number } = {}) => {
  const home = mkTmp('ccrc-child-reclaim-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  if (over.row !== false) {
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
      started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const mark = over.mark === undefined ? String(runId) : over.mark;
    if (mark !== null) writeFileSync(path.join(reg, `${ID}.child`), mark);
  }
  const m = coord.insertMail({ fromId: 'demo-coordinator', fromUuid: 'u', toId: ID, runId: null,
    kind: 'status', subject: 's', body: 'b', artifacts: [] });
  const delivery = coord.queueDelivery(m.id, ID, '<mail/>').id;
  const script = over.script?.(runId) ?? { audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
                                          verb: { code: 0, stdout: reclaimedDoc(runId) } };
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const r = args[0] === 'ws-audit' ? script.audit : args[0] === 'ws-reclaim' ? script.verb : undefined;
    return r === undefined ? { code: 1, stdout: '', stderr: `unscripted ${args[0]}` }
      : { code: r.code, stdout: r.stdout, stderr: r.stderr ?? '' };
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: over.fleetState ?? CAPS,
    presence: { isVisible: (id: string) => over.visible === true && id === ID },
    notifyLog,
    ...(over.now === undefined ? {} : { now: () => over.now! }),
  };
  const feed = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.title);
  const bodies = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.body);
  const deliveryState = () => (coord.db.prepare('SELECT state, lastError FROM mail_deliveries WHERE id = ?')
    .get(delivery) as { state: string; lastError: string | null });
  return { home, reg, coord, runId, deps, calls, feed, bodies, deliveryState,
           // `deferredSinceMs` (spec §5.7, §5.9: the feed row says how long
           // it waited): `null` is close's value; a number is the sweep's
           // first deferral of this child.
           req: (deferExpired = false, deferredSinceMs: number | null = null) =>
             ({ sessionId: ID, runId, trigger: deferredSinceMs === null ? 'close' as const : 'sweep' as const,
                deferExpired, deferredSinceMs }) };
};

describe('the fourteen words', () => {
  it('are exactly the words ccd’s RECLAIM region refuses with — harvested, both directions', () => {
    const ccd = readFileSync(CCD, 'utf8');
    const begin = ccd.indexOf('RECLAIM-BEGIN');
    const end = ccd.indexOf('RECLAIM-END');
    expect(begin, 'the RECLAIM region is missing its BEGIN marker').toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const region = ccd.slice(begin, end).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const harvested = new Set([
      ...[...region.matchAll(/_reap_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!),
      ...[...region.matchAll(/"refused":"([a-z][a-z-]*)"/g)].map((m) => m[1]!),
    ]);
    expect([...harvested].sort()).toEqual(Object.keys(CHILD_RECLAIM_TOKEN_KIND).sort());
  });

  it('the audit journals exactly the TERMINAL words — ccd’s case list equals the kind map’s terminal arm', () => {
    // `cmd_ws_audit --reclaim` writes a lifecycle line for a terminal verdict
    // ONLY (Task 5; spec §5.9 — the attention list reads terminal rows, and a
    // retryable line a pass would bury the journal); its pattern is a second
    // spelling of this map's terminal arm, in another language, so it is held
    // equal here rather than trusted. The right-hand side is DERIVED from the
    // map, never a second literal: a word the map moves between kinds moves
    // the expectation with it.
    const ccd = readFileSync(CCD, 'utf8');
    const m = /case "\$REAP_VERDICT" in\n\s+([a-z|-]+)\)\n\s+_lc_emit reclaim refused "\$id" "" verb ws-audit/.exec(ccd);
    expect(m, 'cmd_ws_audit no longer journals a terminal reclaim refusal').not.toBeNull();
    const terminal = Object.entries(CHILD_RECLAIM_TOKEN_KIND)
      .filter(([, kind]) => kind === 'terminal').map(([token]) => token).sort();
    expect(terminal.length, 'guards the guard: an empty arm would equal an empty list').toBeGreaterThan(0);
    expect(m![1]!.split('|').sort()).toEqual(terminal);
  });

  it('every RETRY word is a defer reason, and no other word is', () => {
    for (const [token, kind] of Object.entries(CHILD_RECLAIM_TOKEN_KIND)) {
      expect(isChildReclaimDeferWhy(token), token).toBe(kind === 'retry');
    }
  });

  it('every TERMINAL word has a server sentence — the only ones a person is ever shown', () => {
    for (const [token, kind] of Object.entries(CHILD_RECLAIM_TOKEN_KIND)) {
      if (kind === 'terminal') expect(SENTENCES[token], token).toBeTypeOf('string');
    }
  });
});

describe('parseChildReclaimAudit', () => {
  it('reads a token and the run the marker names', () => {
    expect(parseChildReclaimAudit(auditDoc(7, 'reclaimable', { token: TOK })))
      .toEqual({ kind: 'token', token: TOK, childOf: 7 });
  });
  it('reads a refusal by its word', () => {
    expect(parseChildReclaimAudit(auditDoc(7, 'attached', { detail: 'a client' })))
      .toEqual({ kind: 'refused', token: 'attached', detail: 'a client' });
  });
  it.each([
    ['no JSON at all', 'ccd: usage: ccd ws-audit --session <id>'],
    // `no-such-session` is a word BOTH ladders print: without the mode check
    // a plain audit's answer would read as a reclaim refusal.
    ['the PLAIN audit (no mode)', JSON.stringify({ id: ID, verdict: 'no-such-session', detail: '' })],
    ['reclaimable with no token', auditDoc(7, 'reclaimable')],
    ['reclaimable with a short token', auditDoc(7, 'reclaimable', { token: 'abc' })],
    ['reclaimable with no childOf', JSON.stringify({ mode: 'reclaim', childOf: null, verdict: 'reclaimable', token: TOK })],
    // One run-id grammar (wave 2's `CHILD_RUN_ID`, ten ASCII digits): a
    // `childOf` no marker could carry is not a run id, however numeric.
    ['reclaimable with an eleven-digit childOf', JSON.stringify({ mode: 'reclaim', childOf: 12345678901, verdict: 'reclaimable', token: TOK })],
    ['a verdict this build does not know', auditDoc(7, 'sensitive-ignored')],
    // The audit's unmeasured answer is a DOCUMENT, not a word the ladder
    // refuses with: read at all, it is unreadable — `failed`, like its exit 1.
    ['the unmeasured answer', auditDoc(7, 'unmeasured', { detail: 'could not read the stash list' })],
  ])('%s is unreadable — never a token, never a refusal', (_what, stdout) => {
    expect(parseChildReclaimAudit(stdout).kind).toBe('unreadable');
  });
});

describe('parseChildReclaimResult', () => {
  it('reads reclaimed, with and without a WIP commit', () => {
    expect(parseChildReclaimResult(ID, reclaimedDoc(7, WIP), '')).toEqual({ kind: 'reclaimed', wip: WIP });
    expect(parseChildReclaimResult(ID, reclaimedDoc(7), '')).toEqual({ kind: 'reclaimed', wip: null });
  });
  it('a reclaim of ANOTHER id is a failure, not a success', () => {
    expect(parseChildReclaimResult('demo-other', reclaimedDoc(7), '').kind).toBe('failed');
  });
  it('reads a known refusal, and fails an unknown one', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ refused: 'state-changed', detail: 'd', paths: [] }), ''))
      .toEqual({ kind: 'refused', token: 'state-changed', detail: 'd' });
    expect(parseChildReclaimResult(ID, JSON.stringify({ refused: 'not-archived', detail: '', paths: [] }), '').kind)
      .toBe('failed');
  });
  it('reads a post-start failure, and a call cut short with nothing printed', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: 'worktree-remove-failed', detail: 'busy' }), ''))
      .toEqual({ kind: 'failed', detail: 'worktree-remove-failed: busy' });
    expect(parseChildReclaimResult(ID, '', '').kind).toBe('failed');
  });
});

describe('childReclaimDecision — has the coordinator finished with this child?', () => {
  const OPEN_NONE: OpenSiblingsResult = { ok: true, siblings: [] };
  const base: ChildReclaimDecisionInput = {
    mark: { kind: 'child', runId: 7 }, minting: { kind: 'row', sessionId: ID, reviews: null }, sessionId: ID,
    siblings: OPEN_NONE, reviewed: { kind: 'none' }, final: false, state: 'done', spent: { kind: 'unasked' },
    retiresProgram: false,
  };
  /** A REVIEW child (spec §5.7, "A review child is finished later than its own run"): minted by review run 7, which reviews work run 5. */
  const REVIEW_MINTED = { kind: 'row', sessionId: ID, reviews: 5 } as const;
  it.each<[string, Partial<ChildReclaimDecisionInput>, ReturnType<typeof childReclaimDecision>]>([
    ['a final close', { final: true }, { reclaim: true }],
    ['an abandon', { state: 'failed' }, { reclaim: true }],
    ['a close that retires the program', { retiresProgram: true }, { reclaim: true }],
    ['a spent child', { spent: { kind: 'spent', pr: 3, source: 'registry' } }, { reclaim: true }],
    ['the ordinary non-final close', {}, { reclaim: false, why: 'not-finished' }],
    ['an unspent child', { spent: { kind: 'unspent' } }, { reclaim: false, why: 'not-finished' }],
    ['an UNMEASURED spent verdict — never read as spent', { spent: { kind: 'unmeasured', detail: 'x' } },
      { reclaim: false, why: 'not-finished' }],
    ['no marker', { mark: { kind: 'none' }, final: true }, { reclaim: false, why: 'not-a-child' }],
    ['an unreadable marker', { mark: { kind: 'unreadable' }, final: true }, { reclaim: false, why: 'marker-unreadable' }],
    ['an unreadable minting row', { minting: { kind: 'unreadable' }, final: true }, { reclaim: false, why: 'marker-unreadable' }],
    ['a minting run the database does not have', { minting: { kind: 'absent' }, final: true },
      { reclaim: false, why: 'not-a-child' }],
    ['a minting run bound to ANOTHER session', { minting: { kind: 'row', sessionId: 'demo-other', reviews: null }, final: true },
      { reclaim: false, why: 'not-a-child' }],
    ['a minting run bound to NO session', { minting: { kind: 'row', sessionId: null, reviews: null }, final: true },
      { reclaim: false, why: 'not-a-child' }],
    // Spec §5.7 — a review child is kept while the run it reviewed is open:
    // the coordinator cites the report in its clips BY PATH in fix-round mail.
    // Its two edges: a reviewed row that cannot be READ defers
    // (`marker-unreadable`), and one the database does not have is not proven
    // terminal, so it keeps the child (`review-report-live`).
    ['a REVIEW child while the run it reviewed is still open — even on a final close',
      { minting: REVIEW_MINTED, reviewed: { kind: 'row', state: 'awaiting-review' }, final: true },
      { reclaim: false, why: 'review-report-live' }],
    ['a REVIEW child once the run it reviewed is terminal — reclaimed like any other',
      { minting: REVIEW_MINTED, reviewed: { kind: 'row', state: 'done' }, final: true }, { reclaim: true }],
    ['a REVIEW child whose reviewed run the database does not have — not proven terminal, kept',
      { minting: REVIEW_MINTED, reviewed: { kind: 'absent' }, final: true }, { reclaim: false, why: 'review-report-live' }],
    ['a REVIEW child whose reviewed run cannot be read — never authorised',
      { minting: REVIEW_MINTED, reviewed: { kind: 'unreadable' }, final: true }, { reclaim: false, why: 'marker-unreadable' }],
    ['an open sibling', { siblings: { ok: true, siblings: [{ id: 9, program: 'p', wave: 2, waveOf: 3 }] }, final: true },
      { reclaim: false, why: 'siblings-open' }],
    ['an unreadable sibling list', { siblings: { ok: false, kind: 'run-unreadable', detail: 'x' }, final: true },
      { reclaim: false, why: 'siblings-unreadable' }],
  ])('%s', (_what, patch, expected) => {
    expect(childReclaimDecision({ ...base, ...patch })).toEqual(expected);
  });
});

describe('reclaimChild — the one executor', () => {
  it('audit → token → verb, then cancels the child’s mail and writes ONE feed row', async () => {
    const s = await rig();
    const out = await reclaimChild(s.deps, s.req());
    expect(out).toEqual({ kind: 'reclaimed', sessionId: ID, runId: s.runId, wip: null });
    expect(s.calls).toEqual([
      ['ws-audit', '--session', ID, '--reclaim'],
      ['ws-reclaim', '--expect', TOK, '--child-of', String(s.runId), '--session', ID,
       '--surface', 'agent', '--actor', `run:${s.runId} reclaim close`],
    ]);
    expect(s.deliveryState()).toEqual({ state: 'rejected', lastError: MAIL_CHILD_RECLAIMED_ERROR });
    expect(s.feed()).toEqual(['child reclaimed']);
  });

  it('refuses on NO evidence of the capability — the verb alone is not the token', async () => {
    for (const ccdVerbs of [null, ['ws-audit', 'ws-reclaim']]) {
      const s = await rig({ fleetState: { ...CAPS, ccdVerbs } });
      const out = await reclaimChild(s.deps, s.req());
      expect(out).toMatchObject({ kind: 'deferred', why: 'unsupported' });
      expect(s.calls, 'nothing is sent to a box that did not prove it has the verb').toEqual([]);
      expect(s.deliveryState().state).toBe('queued');
      expect(s.feed()).toEqual(['child reclaim deferred']);
    }
  });

  it.each<[string, { mark?: string | null; row?: boolean }, string]>([
    ['a marker naming ANOTHER run', { mark: '999' }, 'marker-mismatch'],
    ['no marker at all', { mark: null }, 'marker-mismatch'],
    ['an unreadable marker', { mark: 'seven' }, 'marker-unreadable'],
  ])('%s defers before any ccd call', async (_what, over, why) => {
    const s = await rig(over);
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why });
    expect(s.calls).toEqual([]);
  });

  it('a registry row that is gone is `gone` — no call, no feed row, and its mail is cancelled', async () => {
    // The box half of an earlier attempt finished (the row is purged) but the
    // server never reached its cancel — a restart between, or `purge-incomplete`
    // read as `failed`. This attempt is the last one that will ever see this
    // child, so the cancel rides it.
    const s = await rig({ row: false });
    expect(await reclaimChild(s.deps, s.req())).toEqual({ kind: 'gone', sessionId: ID });
    expect(s.calls).toEqual([]);
    expect(s.feed()).toEqual([]);
    expect(s.deliveryState()).toEqual({ state: 'rejected', lastError: MAIL_CHILD_RECLAIMED_ERROR });
  });

  it('a row `readSessionRecord` DROPS is not `gone` — the second listing still names it, and its mail stays', async () => {
    // `absent` is two populations (wave 2's `childBindGate` reads it the same
    // way): no row, AND a row `buildRecord` dropped because an identity field
    // read back empty. The second is a child that may be alive.
    const s = await rig();
    writeFileSync(path.join(s.reg, `${ID}.workdir`), '');
    const probe = await readSessionRecord(s.deps.io, s.deps.cfg, ID);
    expect(probe, 'the fixture really is the DROPPED population').toEqual({ found: false, reason: 'absent' });
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(s.calls).toEqual([]);
    expect(s.deliveryState().state).toBe('queued');
    // …and with NO marker listed: a dropped row whose `.uuid` is still there
    // is a session that holds this id, child or not — its mail stays too.
    const n = await rig({ mark: null });
    writeFileSync(path.join(n.reg, `${ID}.workdir`), '');
    expect(await reclaimChild(n.deps, n.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(n.deliveryState().state).toBe('queued');
  });

  it('a SECOND listing that fails is no proof of absence — its mail stays', async () => {
    // Count the listings `readSessionRecord` itself takes on a row-less
    // registry (measured, never typed), then fail the one after them.
    const m = await rig({ row: false });
    let taken = 0;
    await readSessionRecord({ ...m.deps.io, readdir: async (d: string) => { taken += 1; return m.deps.io.readdir(d); } },
      m.deps.cfg, ID);
    const u = await rig({ row: false });
    let lists = 0;
    const deps: ChildReclaimDeps = { ...u.deps, io: { ...u.deps.io,
      readdir: async (d: string) => { lists += 1; return lists <= taken ? u.deps.io.readdir(d) : null; } } };
    expect(await reclaimChild(deps, u.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(u.deliveryState().state).toBe('queued');
  });

  it('an UNLISTABLE registry is not `gone` — its mail stays', async () => {
    // Step 1's absent arm is a MEASURED absence; a listing that failed is
    // `marker-unreadable`, and a child that may still be there keeps its mail.
    const s = await rig();
    const deps: ChildReclaimDeps = { ...s.deps, io: { ...s.deps.io, readdir: async () => null } };
    expect(await reclaimChild(deps, s.req())).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(s.deliveryState().state).toBe('queued');
  });

  it('an open sibling defers, and an UNREADABLE sibling list defers — never read as "none"', async () => {
    const s = await rig();
    const next = s.coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 2, waveOf: 2, claimedBy: 'demo-coordinator' });
    if (!('id' in next)) throw new Error('openRun refused');
    s.coord.setSession(next.id, ID);
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'siblings-open' });
    const u = await rig();
    u.coord.openRunsForSession = () => ({ ok: false, kind: 'run-unreadable', detail: 'runs.id unrepresentable' });
    expect(await reclaimChild(u.deps, u.req())).toMatchObject({ kind: 'deferred', why: 'siblings-unreadable' });
    expect([...s.calls, ...u.calls]).toEqual([]);
  });

  it('defers while someone is looking — and the expired defer proceeds, flag on both argvs', async () => {
    const s = await rig({ visible: true });
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(s.calls).toEqual([]);
    const out = await reclaimChild(s.deps, s.req(true));
    expect(out.kind).toBe('reclaimed');
    expect(s.calls.map((c) => c.includes('--defer-expired'))).toEqual([true, true]);
  });

  // Spec §5.7 ("the feed row says how long it waited and why") and §5.9
  // ("deferred with its elapsed time"): the wait rides the REQUEST, and
  // the executor renders it. Both directions pinned — a sweep deferral states
  // its wait, close's `null` states none, and the ceiling states the wait it
  // ended and why the reclaim went ahead anyway.
  const T0 = 1_800_000_000_000;
  it('a SWEEP deferral states how long the child has waited, and why; close’s null states no wait', async () => {
    const s = await rig({ visible: true, now: T0 + 7 * 60_000 + 59_000 });
    expect(await reclaimChild(s.deps, s.req(false, T0))).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(s.bodies()).toHaveLength(1);
    expect(s.bodies()[0]).toContain('reclaim deferred (presence) — someone is viewing this session.');
    expect(s.bodies()[0]).toContain('Deferred for 7 minutes so far.');
    const c = await rig({ visible: true, now: T0 });
    expect(await reclaimChild(c.deps, c.req())).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(c.bodies()[0]).not.toContain('Deferred for');
  });

  it('a CEILING-EXPIRED reclaim states the wait it ended and why it went ahead', async () => {
    const s = await rig({ visible: true, now: T0 + 16 * 60_000 });
    expect((await reclaimChild(s.deps, s.req(true, T0))).kind).toBe('reclaimed');
    expect(s.feed()).toEqual(['child reclaimed']);
    expect(s.bodies()[0]).toContain('The defer ceiling was reached after 16 minutes of deferral');
    expect(s.bodies()[0]).toContain('no longer held it back');
    // A reclaim that was never deferred says nothing about a wait.
    const plain = await rig({ now: T0 });
    await reclaimChild(plain.deps, plain.req());
    expect(plain.bodies()[0]).not.toContain('defer');
  });

  it.each<[ChildReclaimToken, string]>([
    ['containment-unproven', 'refused'], ['not-a-child', 'refused'], ['no-worktree-record', 'refused'],
    ['attached', 'deferred'], ['reap-in-progress', 'deferred'], ['no-such-session', 'gone'],
  ])('an AUDIT refusal %s is %s, and the verb is never called', async (token, kind) => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, token, { detail: 'd' }) } }) });
    const out = await reclaimChild(s.deps, s.req());
    expect(out.kind).toBe(kind);
    if (out.kind === 'refused') expect(out.sentence).toBe(SENTENCES[token]);
    expect(s.calls.map((c) => c[0])).toEqual(['ws-audit']);
    expect(s.deliveryState().state).toBe('queued');
  });

  it('a token minted for ANOTHER run is not spent', async () => {
    const s = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId + 1, 'reclaimable', { token: TOK }) } }) });
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'deferred', why: 'marker-mismatch' });
    expect(s.calls.map((c) => c[0])).toEqual(['ws-audit']);
  });

  it('a VERB refusal or failure leaves the mail alone — the child is still there', async () => {
    const refused = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 0, stdout: JSON.stringify({ refused: 'state-changed', detail: 'the tree moved', paths: [] }) } }) });
    expect(await reclaimChild(refused.deps, refused.req())).toMatchObject({ kind: 'deferred', why: 'state-changed' });
    expect(refused.deliveryState().state).toBe('queued');
    const failed = await rig({ script: (runId) => ({ audit: { code: 0, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) },
      verb: { code: 1, stdout: JSON.stringify({ failed: 'worktree-remove-failed', detail: 'busy' }) } }) });
    expect(await reclaimChild(failed.deps, failed.req()))
      .toMatchObject({ kind: 'failed', detail: 'worktree-remove-failed: busy' });
    expect(failed.deliveryState().state).toBe('queued');
    expect(failed.feed()).toEqual(['child reclaim failed']);
  });

  it('an audit the box could not answer is a failure', async () => {
    const s = await rig({ script: () => ({ audit: { code: 1, stdout: '', stderr: 'ccd: python3 unavailable' } }) });
    expect(await reclaimChild(s.deps, s.req())).toMatchObject({ kind: 'failed' });
  });

  it('an audit that EXITS 1 is failed whatever it printed — its unmeasured document, and even a token', async () => {
    // The audit's unmeasured answer is a reclaim document with
    // `"verdict":"unmeasured"` at exit 1 (Task 5). The exit status is read
    // BEFORE a byte is parsed, so no exit-1 document — a token-bearing one
    // included — is ever spent.
    const u = await rig({ script: (runId) => ({ audit: { code: 1,
      stdout: auditDoc(runId, 'unmeasured', { detail: 'could not read the stash list' }),
      stderr: 'ccd: ws-audit --reclaim measured nothing: could not read the stash list — retry' } }) });
    const out = await reclaimChild(u.deps, u.req());
    expect(out).toMatchObject({ kind: 'failed' });
    expect(out.kind === 'failed' ? out.detail : '').toContain('measured nothing');
    expect(u.feed()).toEqual(['child reclaim failed']);
    const t = await rig({ script: (runId) => ({ audit: { code: 1, stdout: auditDoc(runId, 'reclaimable', { token: TOK }) } }) });
    expect(await reclaimChild(t.deps, t.req())).toMatchObject({ kind: 'failed' });
    expect(t.calls.map((c) => c[0]), 'the verb was never called on an exit-1 token').toEqual(['ws-audit']);
    expect(t.deliveryState().state).toBe('queued');
  });

  it('with no feed log the reclaim still happens', async () => {
    const s = await rig();
    const { notifyLog: _dropped, ...noLog } = s.deps;
    expect((await reclaimChild(noLog, s.req())).kind).toBe('reclaimed');
    expect(s.feed()).toEqual([]);
  });
});
```

(b) `server/test/verb-gate.test.ts` — `const CAP_GATED_VERBS: ReadonlySet<string> = new Set(['route']);` becomes:

```ts
const CAP_GATED_VERBS: ReadonlySet<string> = new Set(['route', 'ws-reclaim']);
```

and, in *gates every verb this branch added, at every one of its call sites*, the `NEW_GENERATION` line becomes:

```ts
    // `ws-reclaim` (child reclamation, wave 3) joins too: its one call site
    // (`coord/childReclaim.ts`'s `childReclaimAct`) is gated by
    // `capSupported(RECLAIM_CAP)` — CAP_GATED_VERBS above — because a verb
    // that never existed must REFUSE on no evidence, and `verbSupported`
    // permits on none. Named here so the site cannot vanish or lose its gate.
const NEW_GENERATION = ['pr-state', 'pr-open', 'ws-archive', 'ws-restore', 'ws-audit', 'ws-reap', 'project-pool',
  'ws-reclaim'];
```

(c) `server/test/unattended-actor.test.ts` — `FILES` and `BUILDERS` become:

```ts
const FILES = ['watch.ts', 'coord/close.ts', 'coord/dispatch.ts', 'coord/routes.ts', 'coord/childReclaim.ts'];
```

```ts
const BUILDERS = /CCD_ARGV\.(wsArchive|wsRestore|wsHold|wsRelease|wsRename|wsReclaim)\(/;
```

**Against the tree wave 2 leaves, never the one at planning.** Wave 2 (a prerequisite, merged before this wave starts) already rewrites all three of the count's spellings and adds two `SITES` entries for `refuseSpentChild` in `coord/dispatch.ts` (its plan's Task 6 Step 6(a)), so the eleven-site text this file carries at `f5dc495b` is gone. First MEASURE the count the file's own scan finds on this wave's base — never type it:

```bash
(cd server && ./node_modules/.bin/vitest run test/unattended-actor.test.ts)   # green on the base: the count is SITES.length
grep -nE "found EXACTLY the [a-z]+ pinned call sites|^ \* [A-Z][a-z]+ sites" server/test/unattended-actor.test.ts
```

Expected: green, and the two lines read `found EXACTLY the thirteen pinned call sites` and ` * Thirteen sites — five distinct labels, plus two that spend \`dispatchRun\`'s hoisted \`dispatchDec\` — each identified by the code AROUND`. If the base says anything but thirteen, a later merge moved it: take THAT number as N, write N+1 below, and name the difference in the wave-done mail. Then, located by that content:

- the case title `'found EXACTLY the thirteen pinned call sites — not a floor, an exact count (fix round 2, F5b)'` becomes `'found EXACTLY the fourteen pinned call sites — not a floor, an exact count (fix round 2, F5b)'`;
- in the same case's comment, directly after wave 2's paragraph (the one that ends `` `dispatchDec`. `` after "Eleven became thirteen with child-reclamation wave 2's `refuseSpentChild`"), append:

```ts
    // Thirteen became fourteen with child reclamation (wave 3):
    // `CCD_ARGV.wsReclaim(…)` in `coord/childReclaim.ts`, the one destructive
    // argv the server composes with no human in the path, which is exactly the
    // act that must say whose it was.
```

- the `SITES` docstring's first line ` * Thirteen sites — five distinct labels, plus two that spend \`dispatchRun\`'s hoisted \`dispatchDec\` — each identified by the code AROUND` becomes ` * Fourteen sites — six distinct labels, plus two that spend \`dispatchRun\`'s hoisted \`dispatchDec\` — each identified by the code AROUND` (this wave's label, `` `run:${req.runId} reclaim ${req.trigger}` ``, is the sixth);

and directly above the `coord/routes.ts` `'open-then-hold, sessionId reclaim'` entry of `SITES`:

```ts
  // Child reclamation, wave 3: the ONE executor's act, shared by the close
  // trigger and the sweep — so the label carries the trigger, and the minting
  // run the `--child-of` names.
  { file: 'coord/childReclaim.ts', what: 'the child-reclaim act (one executor, both triggers)',
    find: /CCD_ARGV\.wsReclaim\(token, req\.runId, req\.sessionId, req\.deferExpired,\n\s+sweepDec\(deps\.fleetState, (`[^`]*`)\)\)/,
    label: '`run:${req.runId} reclaim ${req.trigger}`' },
```

(d) `server/test/mail-routes.test.ts` — after `import { okRun } from './coordReadHelpers.js';`:

```ts
import { isChildReclaimKebab } from '../src/coord/childReclaim.js';
```

and in *every quoted kebab token in server/src/coord that looks like a code is declared*, replace the last disjunct and the message:

```ts
        || isSetAccountPoolsRefuseCode(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode or SetAccountPoolsRefuseCode`).toBe(true);
```

with:

```ts
        || isSetAccountPoolsRefuseCode(tok)
        // CHILD RECLAMATION, WAVE 3 — the TENTH union, checked together and
        // never merged, on the standing rule `enter-ignored` above states.
        // `coord/childReclaim.ts` spells ccd's fourteen `ws-reclaim` words, the
        // executor's defer reasons and the close decision's reasons as
        // literals, and `coord/close.ts` spells `not-queued`. None is a mail
        // rejection or a run refusal: the box's words are ccd's own
        // vocabulary, and the reasons ride `CloseOutcome` and the feed, never
        // a `refused`/`reject.code`. Admitted through the exported guard,
        // never NOT_CODES, for the reason every union above gives.
        || isChildReclaimKebab(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode or child-reclaim word`).toBe(true);
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/mail-routes.test.ts test/verb-gate.test.ts test/unattended-actor.test.ts)
```

Expected: FAIL. `child-reclaim` and `mail-routes` at collection (`../src/coord/childReclaim.js` does not exist); `verb-gate`: `ws-reclaim has no call site at all: expected 0 to be greater than 0`; `unattended-actor`: `ENOENT` reading `coord/childReclaim.ts`.

- [ ] **Step 3: Create `server/src/coord/childReclaim.ts`**

```ts
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { Presence } from '../presence.js';
import type { NotifyLog } from '../notifylog.js';
import { CCD_ARGV, RECLAIM_CAP, capSupported, sweepDec, verbSupported } from '../ccdargv.js';
import { readSessionRecord } from '../registry.js';
import { refusalSentence } from '../wsaudit.js';
import type { ChildSpentVerdict } from './childSpent.js';
import type { CoordStore, OpenSiblingsResult } from './store.js';
import { CHILD_RUN_ID, TERMINAL_RUN_STATES, type ChildMark, type RunState } from '../../../shared/api.js';

/**
 * CHILD-WORKSPACE RECLAMATION, the server half (spec 2026-09-22 §5.5–§5.7).
 *
 * `close.ts`'s kind of file: an L1 decision reached through declared ports.
 * Three things live here and nowhere else —
 *   - the fourteen words `ccd ws-reclaim` and `ccd ws-audit --reclaim` answer
 *     with, and what each one MEANS to the server (gone / terminal / retry);
 *   - `childReclaimDecision`, the pure "has the coordinator finished with this
 *     child" predicate `closeRun` asks inside the coordination mutex;
 *   - `reclaimChild`, THE ONE EXECUTOR. The close path hands it a request on
 *     the session's own queue; wave 4's sweep hands it the same request. So
 *     presence, the capability gate and the feed row behave identically
 *     however a reclaim was started.
 *
 * NAMING: every identifier here says `childReclaim`, never a bare `reclaim` —
 * `coord/reclaim.ts` already means handing a dead coordinator's claim to an
 * heir, and the two must never be confused in a grep.
 */

/** Every word `cmd_ws_reclaim`/`_ws_reclaim_eval` (and so `ws-audit
 *  --reclaim`) can refuse with — and NO other. `child-reclaim.test.ts` holds
 *  this set equal to what ccd's RECLAIM region actually emits, in both
 *  directions. `no-worktree-record` is `ws-reap`'s word, reused: a directory
 *  that exists but that git does not record as the project's worktree (spec
 *  §5.5) — ccd cannot tell what it would be deleting there. */
export type ChildReclaimToken =
  | 'no-such-session' | 'not-a-workspace' | 'not-a-child' | 'paused' | 'held' | 'attached' | 'tree-busy'
  | 'branch-elsewhere' | 'tree-unreadable' | 'containment-unproven' | 'no-worktree-record' | 'state-changed'
  | 'in-progress' | 'reap-in-progress';

/** What each word means to the server, spelled ONCE:
 *   - `gone`: the child is already not there. Never a feed row, never an
 *     attention item — there is nothing left to report about.
 *   - `terminal`: the box proved something that will not change by waiting
 *     (not a child, not provably contained, not a worktree git records). A
 *     refusal with its sentence — and exactly the words `ws-audit --reclaim`
 *     journals when it finds them (spec §5.9), which `child-reclaim.test.ts`
 *     holds equal to this arm.
 *   - `retry`: the box found a condition that passes (a hold, a pause, a
 *     human at the pane, a git operation, a lock, a token that went stale).
 *     A deferral; wave 4's sweep tries again. */
export const CHILD_RECLAIM_TOKEN_KIND: Readonly<Record<ChildReclaimToken, 'gone' | 'terminal' | 'retry'>> = {
  'no-such-session': 'gone',
  'not-a-workspace': 'terminal',
  'not-a-child': 'terminal',
  'branch-elsewhere': 'terminal',
  'tree-unreadable': 'terminal',
  'containment-unproven': 'terminal',
  'no-worktree-record': 'terminal',
  paused: 'retry',
  held: 'retry',
  attached: 'retry',
  'tree-busy': 'retry',
  'state-changed': 'retry',
  'in-progress': 'retry',
  'reap-in-progress': 'retry',
};

export function isChildReclaimToken(v: unknown): v is ChildReclaimToken {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_TOKEN_KIND, v);
}

/** Why a reclaim did not happen YET. The server's own reasons first, then the
 *  seven retryable box words — exactly the `retry` rows above, so a deferral
 *  always says which condition it is waiting on. */
export type ChildReclaimDeferWhy =
  | 'presence' | 'siblings-open' | 'siblings-unreadable' | 'marker-unreadable' | 'marker-mismatch'
  | 'unsupported' | 'paused-at-server'
  | Extract<ChildReclaimToken, 'paused' | 'held' | 'attached' | 'tree-busy' | 'state-changed' | 'in-progress' | 'reap-in-progress'>;

const CHILD_RECLAIM_DEFER_WHY: Readonly<Record<ChildReclaimDeferWhy, true>> = {
  presence: true, 'siblings-open': true, 'siblings-unreadable': true, 'marker-unreadable': true,
  'marker-mismatch': true, unsupported: true, 'paused-at-server': true,
  paused: true, held: true, attached: true, 'tree-busy': true, 'state-changed': true, 'in-progress': true,
  'reap-in-progress': true,
};

export function isChildReclaimDeferWhy(v: unknown): v is ChildReclaimDeferWhy {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_DEFER_WHY, v);
}

export type ChildReclaimOutcome =
  | { readonly kind: 'reclaimed'; readonly sessionId: string; readonly runId: number; readonly wip: string | null }
  | { readonly kind: 'deferred'; readonly sessionId: string; readonly runId: number; readonly why: ChildReclaimDeferWhy; readonly detail: string }
  | { readonly kind: 'refused'; readonly sessionId: string; readonly runId: number; readonly token: ChildReclaimToken; readonly sentence: string; readonly detail: string }
  | { readonly kind: 'gone'; readonly sessionId: string }
  | { readonly kind: 'failed'; readonly sessionId: string; readonly runId: number; readonly detail: string };

/** `runId` is the MINTING run — the one the child's `.child` marker names and
 *  the value composed as `--child-of`. On the close path it is read off the
 *  marker, never assumed to be the run being closed: a child that handed over
 *  across waves was minted by wave 1 and is closed by wave N.
 *
 *  `deferredSinceMs`: epoch ms of the FIRST deferral the sweep
 *  saw for this child, or `null` — close's value, always a first attempt. It
 *  exists so the feed row can say how long the child waited and why (spec
 *  §5.7, §5.9); the executor decides nothing on it. `deferExpired` is the
 *  sweep's own verdict on the same clock, carried separately because it is a
 *  fingerprint input on the box and this is not. */
export interface ChildReclaimRequest {
  readonly sessionId: string; readonly runId: number;
  readonly trigger: 'close' | 'sweep'; readonly deferExpired: boolean;
  readonly deferredSinceMs: number | null;
}

/** The executor's ports (L2, declared by this consumer). `presence` is
 *  narrowed to the one question asked of it; `notifyLog` is optional exactly
 *  as it is on `Deps` — a box with no feed log still reclaims, and says so
 *  nowhere, which is the existing degrade for every other feed writer. */
export interface ChildReclaimDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
  presence?: Pick<Presence, 'isVisible'>;
  notifyLog?: NotifyLog;
  /** The clock the feed row's wait is rendered against (spec §5.7). Absent: `Date.now`. */
  now?: () => number;
}

// ── the close decision (pure) ────────────────────────────────────────────────

/** Why a close did NOT queue a reclaim. Each word is a condition a reader acts
 *  on differently, so none folds into another (carried constraint 2):
 *  `not-a-child` is ordinary; `marker-unreadable` is a box that could not be
 *  read (the sweep retries); `siblings-*` mean another run still has — or may
 *  have — this workspace; `review-report-live` is a REVIEW child kept while the
 *  run it reviewed is not terminal, because the coordinator cites the report
 *  in its clips by path (spec §5.7); `not-finished` is the ordinary
 *  non-final close. */
export type ChildReclaimNotWhy =
  | 'not-a-child' | 'marker-unreadable' | 'siblings-open' | 'siblings-unreadable' | 'review-report-live'
  | 'not-finished';

const CHILD_RECLAIM_NOT_WHY: Readonly<Record<ChildReclaimNotWhy, true>> = {
  'not-a-child': true, 'marker-unreadable': true, 'siblings-open': true, 'siblings-unreadable': true,
  'review-report-live': true, 'not-finished': true,
};

export type ChildReclaimDecision =
  | { readonly reclaim: true }
  | { readonly reclaim: false; readonly why: ChildReclaimNotWhy };

/** The minting run's row, read by the id the marker names — the SERVER's half
 *  of spec §5.1's two authorities. Three answers, never two. `reviews` is the
 *  row's own column: the work run a REVIEW run reads, `null` on a work run. */
export type ChildReclaimMinting =
  | { readonly kind: 'row'; readonly sessionId: string | null; readonly reviews: number | null }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

/** The run a REVIEW child's minting run reviews (spec §5.7, "A review child
 *  is finished later than its own run"), read in the same mutex section as
 *  the sibling list. `none`: the minting run is a work run and reviews
 *  nothing. Four answers, never folded: `absent` (a reviewed run the database
 *  does not have) is NOT proven terminal and keeps the child
 *  (`review-report-live`); `unreadable` never authorises one — it defers
 *  (`marker-unreadable`). */
export type ChildReclaimReviewed =
  | { readonly kind: 'none' }
  | { readonly kind: 'row'; readonly state: RunState }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

/** `TERMINAL_RUN_STATES` (L0), asked — the one reading of "terminal" both of
 *  this file's callers use, never a second spelling of the list. */
export function isChildReclaimTerminalState(state: RunState): boolean {
  return (TERMINAL_RUN_STATES as readonly RunState[]).includes(state);
}

export interface ChildReclaimDecisionInput {
  /** The registry's reading of `$REG/<id>.child`. */
  readonly mark: ChildMark;
  /** Meaningful only when `mark` is `child`: the row of `mark.runId`. */
  readonly minting: ChildReclaimMinting;
  readonly sessionId: string;
  /** The OTHER open runs on this workspace, read inside the mutex. */
  readonly siblings: OpenSiblingsResult;
  /** Meaningful only when `minting` is a review run's row: the state of the
   *  run it reviews, read with the siblings (spec §5.7). */
  readonly reviewed: ChildReclaimReviewed;
  readonly final: boolean;
  readonly state: 'done' | 'failed';
  /** `unasked` until every other conjunct has been decided — the live half of
   *  the spent verdict is a gh round trip, asked only when it can matter. */
  readonly spent: ChildSpentVerdict | { readonly kind: 'unasked' };
  /** No OTHER open run of this run's program: `CoordStore.programOpenRunCount`
   *  with this run excluded — D-51's predicate, not a second spelling. */
  readonly retiresProgram: boolean;
}

/**
 * Has the coordinator FINISHED with this child? (spec §5.7). Eligible iff
 * child ∧ no open sibling ∧ (final ∨ spent ∨ an abandon ∨ this close retires
 * the program). "No open sibling" ALONE is also true on the ordinary non-final
 * close, which is claiming the child for wave N+1 — reclaiming on it would be
 * the 2026-09-10 harm through a new door.
 *
 * Two authorities, EQUAL (spec §5.1): the box's marker names a run, and that
 * run's row names THIS session. A marker naming a run whose row is absent, or
 * names another session, is not a child here — never a guess in either
 * direction. An unreadable marker or an unreadable minting row is
 * `marker-unreadable`: DEFER, never authorise, never call it "not a child".
 *
 * A REVIEW child is not finished while the run it reviewed is open (spec
 * §5.7): reviewer clause 7 keeps the report in the reviewer's clips, and the
 * coordinator cites it BY PATH in every send-back `fix-round` mail — so even a
 * final close of the review run answers `review-report-live` until the
 * reviewed run is terminal, and the sweep reclaims the child after that. A
 * reviewed row that cannot be read is `marker-unreadable` (the server's half of
 * the child's identity could not be read — the minting row's own fold); one
 * the database does not have is not PROVEN terminal, and keeps the child.
 */
export function childReclaimDecision(input: ChildReclaimDecisionInput): ChildReclaimDecision {
  const no = (why: ChildReclaimNotWhy): ChildReclaimDecision => ({ reclaim: false, why });
  if (input.mark.kind === 'none') return no('not-a-child');
  if (input.mark.kind === 'unreadable') return no('marker-unreadable');
  if (input.minting.kind === 'unreadable') return no('marker-unreadable');
  if (input.minting.kind === 'absent' || input.minting.sessionId !== input.sessionId) return no('not-a-child');
  if (!input.siblings.ok) return no('siblings-unreadable');
  if (input.siblings.siblings.length > 0) return no('siblings-open');
  if (input.minting.reviews !== null) {
    if (input.reviewed.kind === 'unreadable') return no('marker-unreadable');
    if (input.reviewed.kind !== 'row' || !isChildReclaimTerminalState(input.reviewed.state)) return no('review-report-live');
  }
  const finished = input.final || input.state === 'failed' || input.retiresProgram || input.spent.kind === 'spent';
  return finished ? { reclaim: true } : no('not-finished');
}

/** `mail-routes.test.ts`'s kebab scanner reads every quoted hyphenated literal
 *  in `server/src/coord` and admits it through an exported guard per
 *  vocabulary. This file's three vocabularies — the box's tokens, the defer
 *  reasons and the close decision's reasons — plus close's `not-queued`, are
 *  one family, admitted here, so a word added to any of the three types is
 *  accepted and a typo is not. Deliberately NOT named `isChildReclaimWord`:
 *  wave 5 owns that name, in `shared/api.ts`, as the type guard of the run
 *  chip's `ChildReclaimWord` vocabulary (spec §5.9) — a different set with a
 *  different meaning. */
export function isChildReclaimKebab(v: unknown): boolean {
  return isChildReclaimToken(v) || isChildReclaimDeferWhy(v)
    || (typeof v === 'string' && (Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_NOT_WHY, v) || v === 'not-queued'));
}

// ── the two ccd documents ────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
const SHA_SHAPE = /^[0-9a-f]{40}$/;

/** `ccd ws-audit --session <id> --reclaim [--defer-expired]`'s answer, read
 *  for exactly what the executor needs. `unreadable` is its own arm: a
 *  document this build cannot read is not a refusal and never a token. */
export type ChildReclaimAuditRead =
  | { readonly kind: 'token'; readonly token: string; readonly childOf: number }
  | { readonly kind: 'refused'; readonly token: ChildReclaimToken; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string };

export function parseChildReclaimAudit(stdout: string): ChildReclaimAuditRead {
  let v: unknown;
  try { v = JSON.parse(stdout.trim()); } catch { return { kind: 'unreadable', detail: 'ws-audit --reclaim printed no JSON document' }; }
  if (!isRecord(v)) return { kind: 'unreadable', detail: 'ws-audit --reclaim printed no JSON object' };
  // An older ccd prints the PLAIN audit for an argv it does not parse only if
  // something upstream skipped the capability gate; either way, a document
  // without `mode: reclaim` was not minted by the reclaim ladder.
  if (v.mode !== 'reclaim') return { kind: 'unreadable', detail: 'ws-audit answered without "mode":"reclaim"' };
  if (v.verdict === 'reclaimable') {
    if (typeof v.token !== 'string' || !TOKEN_SHAPE.test(v.token)) {
      return { kind: 'unreadable', detail: 'ws-audit --reclaim said reclaimable with no 64-hex token' };
    }
    // ONE run-id grammar: `CHILD_RUN_ID` (wave 2, `shared/api.ts`) — ten ASCII
    // digits, no leading zero, exactly what ccd's `_child_runid_valid` lets a
    // marker hold. A wider numeric parse would admit sixteen digits no child
    // could ever be minted for.
    if (typeof v.childOf !== 'number' || !CHILD_RUN_ID.test(String(v.childOf))) {
      return { kind: 'unreadable', detail: 'ws-audit --reclaim said reclaimable with no childOf run id' };
    }
    return { kind: 'token', token: v.token, childOf: v.childOf };
  }
  if (isChildReclaimToken(v.verdict)) {
    return { kind: 'refused', token: v.verdict, detail: typeof v.detail === 'string' ? v.detail : '' };
  }
  return { kind: 'unreadable', detail: `ws-audit --reclaim answered a verdict this build does not know: ${String(v.verdict)}` };
}

/** `ccd ws-reclaim …`'s answer. Three documents (spec §5.6): `reclaimed` and
 *  `refused` at exit 0, `failed` at exit 1 — and a fourth condition that is
 *  not a document at all, a call cut short with nothing printed, which is
 *  `failed` too: the breadcrumb on the box resumes it on the next attempt. */
export type ChildReclaimVerbRead =
  | { readonly kind: 'reclaimed'; readonly wip: string | null }
  | { readonly kind: 'refused'; readonly token: ChildReclaimToken; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string };

export function parseChildReclaimResult(sessionId: string, stdout: string, stderr: string): ChildReclaimVerbRead {
  let v: unknown = null;
  try { v = JSON.parse(stdout.trim()); } catch { v = null; }
  if (isRecord(v)) {
    if (typeof v.reclaimed === 'string') {
      if (v.reclaimed !== sessionId) return { kind: 'failed', detail: `ws-reclaim reported reclaiming ${v.reclaimed}, not ${sessionId}` };
      const wip = typeof v.wip === 'string' && SHA_SHAPE.test(v.wip) ? v.wip : null;
      return { kind: 'reclaimed', wip };
    }
    if (typeof v.refused === 'string') {
      const detail = typeof v.detail === 'string' ? v.detail : '';
      return isChildReclaimToken(v.refused)
        ? { kind: 'refused', token: v.refused, detail }
        : { kind: 'failed', detail: `ws-reclaim refused with a word this build does not know: ${v.refused}` };
    }
    if (typeof v.failed === 'string') {
      return { kind: 'failed', detail: `${v.failed}: ${typeof v.detail === 'string' ? v.detail : ''}` };
    }
  }
  const err = stderr.trim();
  return { kind: 'failed', detail: err === '' ? 'ws-reclaim answered nothing — it may have been cut short; the next attempt resumes it' : err };
}

// ── the ONE executor ─────────────────────────────────────────────────────────

/**
 * Reclaim ONE child, from either trigger (spec §5.7). Re-reads everything it
 * decides on — the marker against `req.runId`, the open siblings, presence,
 * the capability — then `ws-audit --reclaim` → token → `ws-reclaim`. On
 * `reclaimed` — and on a row step 1 measures ABSENT, whose earlier attempt's
 * box half finished without its cancel — it cancels every outstanding
 * delivery addressed to the child.
 * Every outcome but `gone` writes exactly ONE feed row, HERE — this function
 * is the single exit every outcome takes, so a new condition added to
 * `childReclaimOutcome` inherits its row rather than having to remember one.
 *
 * NEVER THROWS for a condition it can name: a failed read is a deferral or a
 * failure with a detail. What it cannot name (a bug) rejects, and the close
 * route's port logs it; the sweep reaches the child either way.
 */
export async function reclaimChild(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimOutcome> {
  const outcome = await childReclaimOutcome(deps, req);
  if (outcome.kind !== 'gone') recordChildReclaimFeed(deps, outcome, req);
  return outcome;
}

async function childReclaimOutcome(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimOutcome> {
  const { sessionId, runId } = req;
  const deferred = (why: ChildReclaimDeferWhy, detail: string): ChildReclaimOutcome =>
    ({ kind: 'deferred', sessionId, runId, why, detail });

  // 1 — the box's authority, re-read: the marker must name THIS request's run.
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  if (!read.found && read.reason === 'absent') {
    // `absent` is read the way wave 2's `childBindGate` reads it: re-listed ONCE.
    // Absent twice is `gone`; a second listing that still names this id's
    // `.child` (or `.uuid`) — a row that exists and could not be built — is
    // `marker-unreadable`, and so is a second listing that fails. See
    // `childReclaimRowListing`.
    const again = await childReclaimRowListing(deps, sessionId);
    if (again === 'unlistable') return deferred('marker-unreadable', 'the registry could not be listed');
    if (again === 'listed') {
      return deferred('marker-unreadable', 'the registry lists this workspace but its row could not be built');
    }
    // GONE, AND THE MAIL GOES WITH IT. The box half of a reclaim can finish
    // without step 7 ever running: the server restarted between `ws-reclaim`
    // and the cancel, or the verb answered `purge-incomplete` (the row WAS
    // purged, and it reads as `failed`). The next attempt lands HERE, and
    // without this its outstanding mail would wait for `sweepMail`'s
    // abandonment park — listed as a human's to act on — through exactly the
    // slug-recycling window spec §5.6 moved the cancel into this wave to close.
    // Safe: a listing that names neither `<id>.uuid` nor `<id>.child` means no
    // session holds this id now.
    childReclaimCancelMail(deps, sessionId, 'gone');
    return { kind: 'gone', sessionId };
  }
  if (!read.found) return deferred('marker-unreadable', 'the registry could not be listed');
  const mark = read.record.child;
  if (mark.kind === 'unreadable') return deferred('marker-unreadable', 'the child marker could not be read');
  if (mark.kind === 'none') return deferred('marker-mismatch', 'the workspace carries no child marker');
  if (mark.runId !== runId) {
    return deferred('marker-mismatch', `the child marker names run ${mark.runId}, not run ${runId}`);
  }
  // 2 — no open run names it. Unreadable is INELIGIBLE, never "none".
  const sib = deps.coord.openRunsForSession(sessionId);
  if (!sib.ok) return deferred('siblings-unreadable', sib.detail);
  if (sib.siblings.length > 0) {
    return deferred('siblings-open', `open run(s) ${sib.siblings.map((s) => `#${s.id}`).join(', ')} still name this workspace`);
  }
  // WAVE 4 ADDS THE SERVER-SIDE PAUSE READ HERE (spec §5.8: the close path
  // and the sweep skip): a `paused-at-server` deferral through `deferred(…)`
  // above when the registry carries `RECLAIM_PAUSE_MARKER`, before presence,
  // the capability or any argv — an early skip that returns through this
  // function's one exit like every other outcome, never inside the
  // `reclaimChild` wrapper. ccd's own rung 3, read on the box at the instant
  // of deletion (Task 2), is the read that matters, and it does not change.
  // 3 — a human looking at it, unless the defer's ceiling was reached.
  if (!req.deferExpired && deps.presence?.isVisible(sessionId) === true) {
    return deferred('presence', 'someone is viewing this session');
  }
  // 4 — the box must PROVE it has the verb: `capSupported` refuses on no
  // evidence, which is the only safe default for a verb that never existed.
  if (!capSupported(deps.fleetState, RECLAIM_CAP)) {
    return deferred('unsupported', `the fleet host does not advertise ${RECLAIM_CAP}`);
  }
  // 5 — the token, minted by the ladder on the box.
  const audit = await childReclaimAudit(deps, req);
  if (audit.kind === 'unreadable') return { kind: 'failed', sessionId, runId, detail: audit.detail };
  if (audit.kind === 'refused') return childReclaimRefusal(req, audit.token, audit.detail);
  if (audit.childOf !== runId) {
    return deferred('marker-mismatch', `ws-audit read the child marker as run ${audit.childOf}, not run ${runId}`);
  }
  // 6 — the act. ccd re-proves the token inside the reap lock.
  const act = await childReclaimAct(deps, req, audit.token);
  if (act === 'unsupported') return deferred('unsupported', `the fleet host does not advertise ${RECLAIM_CAP}`);
  if (act.kind === 'failed') return { kind: 'failed', sessionId, runId, detail: act.detail };
  if (act.kind === 'refused') return childReclaimRefusal(req, act.token, act.detail);
  // 7 — the child is gone: nothing may still be waiting to be typed into it,
  // or into a stranger that inherits its recycled slug.
  childReclaimCancelMail(deps, sessionId, 'reclaimed');
  return { kind: 'reclaimed', sessionId, runId, wip: act.wip };
}

/** `readSessionRecord`'s `{ found: false, reason: 'absent' }` is TWO
 *  populations (its own docstring; wave 2's `childBindGate` reads it the same
 *  way): no `.uuid` in a listing that succeeded, AND a row `buildRecord`
 *  DROPPED — an identity field (`uuid`, `wrapper`, `workdir`) read back empty
 *  or listed-then-gone, or one the reconfirm listing lost. The second can be a
 *  LIVE, MARKED child, and calling it gone would cancel its outstanding mail
 *  with no feed row. So the executor lists the registry ONCE MORE, paid only
 *  on a miss: `gone` iff the listing names neither `<id>.uuid` nor
 *  `<id>.child`; `listed` when it names either (a row that exists and could
 *  not be built); `unlistable` when the listing fails (it proves nothing).
 *  Wave 2's gate asks for `.child` alone, because a bind's question is "is
 *  this a marked child"; this one asks for `.uuid` too, because cancelling
 *  mail needs proof that NO session holds the id, not merely that no marker
 *  does. Both callers of that second listing are named here so a third reader
 *  of `absent` finds them. */
async function childReclaimRowListing(
  deps: ChildReclaimDeps, sessionId: string,
): Promise<'gone' | 'listed' | 'unlistable'> {
  const names = await deps.io.readdir(deps.cfg.registryDir);
  if (names === null) return 'unlistable';
  return names.includes(`${sessionId}.uuid`) || names.includes(`${sessionId}.child`) ? 'listed' : 'gone';
}

/** The ONE place the executor cancels a child's mail — on `reclaimed`, and on
 *  a row step 1 itself measured ABSENT (a box half that finished without its
 *  cancel). Never on a refusal or a failure: the child is still there and may
 *  still read its mail. A throw here is logged, never allowed to turn a
 *  finished reclaim into a rejection. */
function childReclaimCancelMail(deps: ChildReclaimDeps, sessionId: string, why: 'reclaimed' | 'gone'): void {
  try {
    deps.coord.cancelDeliveriesTo(sessionId);
  } catch (err) {
    console.warn(`ccrc-server: cancelDeliveriesTo(${sessionId}) failed `
      + `(${err instanceof Error ? err.message : String(err)}) — ${why}; its outstanding mail stays queued`);
  }
}

/** A box word, turned into an outcome by the ONE kind map. */
function childReclaimRefusal(req: ChildReclaimRequest, token: ChildReclaimToken, detail: string): ChildReclaimOutcome {
  const { sessionId, runId } = req;
  switch (CHILD_RECLAIM_TOKEN_KIND[token]) {
    case 'gone': return { kind: 'gone', sessionId };
    // The kind map and the defer vocabulary are held equal by
    // `child-reclaim.test.ts`; a token marked `retry` that is no defer word is
    // answered as a failure, never cast into a reason it is not.
    case 'retry': return isChildReclaimDeferWhy(token)
      ? { kind: 'deferred', sessionId, runId, why: token, detail }
      : { kind: 'failed', sessionId, runId, detail: `${token} is marked retry but is no defer reason` };
    case 'terminal': return { kind: 'refused', sessionId, runId, token, sentence: refusalSentence(token), detail };
  }
}

/** The audit — its own function so the verb-gate scanner reads its own gate:
 *  `ws-audit` is an old verb, asked the old question. The FLAG's question
 *  (`reclaim-v1`) was already answered in step 4. The EXIT STATUS is read
 *  before a byte of stdout: ANY exit 1 — the audit's own unmeasured answer, a
 *  reclaim document saying `"verdict":"unmeasured"`, included — is
 *  `unreadable` here and `failed` to the executor, whatever the document says,
 *  so no exit-1 document (a token-bearing one included) is ever spent. */
async function childReclaimAudit(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimAuditRead> {
  const argv = CCD_ARGV.wsReclaimAudit(req.sessionId, req.deferExpired);
  if (!verbSupported(deps.fleetState, argv)) return { kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' };
  const res = await deps.runCcd(argv);
  if (!res.ok) return { kind: 'unreadable', detail: `ws-audit --reclaim failed: ${res.stderr.trim()}` };
  return parseChildReclaimAudit(res.stdout);
}

/** The act — its own function, and the capability asked AGAIN inside it, not
 *  merely in step 4: this is the scope `verb-gate.test.ts` reads for
 *  `ws-reclaim`'s gate, and the one line that must never run without it. */
async function childReclaimAct(
  deps: ChildReclaimDeps, req: ChildReclaimRequest, token: string,
): Promise<ChildReclaimVerbRead | 'unsupported'> {
  if (!capSupported(deps.fleetState, RECLAIM_CAP)) return 'unsupported';
  const argv = CCD_ARGV.wsReclaim(token, req.runId, req.sessionId, req.deferExpired,
    sweepDec(deps.fleetState, `run:${req.runId} reclaim ${req.trigger}`));
  const res = await deps.runCcd(argv);
  return parseChildReclaimResult(req.sessionId, res.stdout, res.stderr);
}

// ── the feed row ─────────────────────────────────────────────────────────────

const CHILD_RECLAIM_FEED_TITLE: Readonly<Record<Exclude<ChildReclaimOutcome['kind'], 'gone'>, string>> = {
  reclaimed: 'child reclaimed',
  deferred: 'child reclaim deferred',
  refused: 'child reclaim refused',
  failed: 'child reclaim failed',
};

const childReclaimMinutes = (n: number): string => (n === 1 ? '1 minute' : `${n} minutes`);

/** HOW LONG IT WAITED, AND WHY — the sentence spec §5.7 and §5.9 ask of the
 *  feed row, rendered from the request. Whole minutes,
 *  floored; a clock that reads earlier than the first deferral answers 0,
 *  never a negative wait.
 *   - A ceiling-expired attempt (`deferExpired`), WHATEVER its outcome, says
 *     the wait it ended and why it went ahead past presence.
 *   - A `deferred` outcome from the sweep says how long so far — its `why` and
 *     `detail` already say why.
 *   - Anything else, and everything from close (`deferredSinceMs: null`, a
 *     first attempt), says nothing about a wait: there was none. */
function childReclaimWaitText(o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest,
  nowMs: number): string {
  const waited = req.deferredSinceMs === null ? null
    : childReclaimMinutes(Math.max(0, Math.floor((nowMs - req.deferredSinceMs) / 60_000)));
  if (req.deferExpired) {
    return ` The defer ceiling was reached after ${waited ?? 'an unrecorded time'} of deferral, so presence, `
      + 'an attached terminal and a git operation in progress no longer held it back.';
  }
  return o.kind === 'deferred' && waited !== null ? ` Deferred for ${waited} so far.` : '';
}

const childReclaimSentence = (t: string): string => (/[.!?]$/.test(t) ? t : `${t}.`);

function childReclaimFeedBody(o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest,
  nowMs: number): string {
  const who = `${o.sessionId}, child of run #${o.runId}`;
  const wait = childReclaimWaitText(o, req, nowMs);
  switch (o.kind) {
    case 'reclaimed':
      return `${who}, was reclaimed (${req.trigger}). `
        + (o.wip === null ? 'Nothing uncommitted was left.' : `Uncommitted work was pinned as ${o.wip}.`) + wait;
    case 'deferred': return `${who}: reclaim deferred (${o.why}) — ${childReclaimSentence(o.detail)}${wait}`;
    case 'refused': return `${who}: ${o.sentence}${o.detail === '' ? '' : ` (${o.detail})`}${wait}`;
    case 'failed': return `${who}: reclaim failed — ${o.detail}. It is retried; the box resumes where it stopped.${wait}`;
  }
}

/**
 * ONE explicit feed row per outcome (spec §5.9). Explicit because it does not
 * come for free: a reclaim on an already-closed run is an observation, not a
 * transition, and the run-event lane skips observations — a design that
 * assumed a row would have delivered none. `kind: 'run'`, recorded and NEVER
 * pushed (the operator's ruling: every reclaim lands in the feed; no push per
 * reap). The `POST /api/coord/caps` pattern exactly: a missing log degrades
 * the record and never the act, `recordFeedEvent` throws synchronously and is
 * caught, and the flush is in a `finally` (D-1213's reason).
 */
function recordChildReclaimFeed(
  deps: ChildReclaimDeps, o: Exclude<ChildReclaimOutcome, { kind: 'gone' }>, req: ChildReclaimRequest,
): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({ kind: 'run', sessionId: o.sessionId, runId: o.runId,
      title: CHILD_RECLAIM_FEED_TITLE[o.kind], body: childReclaimFeedBody(o, req, (deps.now ?? Date.now)()) });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed '
      + `(${err instanceof Error ? err.message : String(err)}) — child reclaim ${o.kind}, feed archive degraded`);
  } finally {
    void log.flush();
  }
}
```

A note on every single-quoted hyphenated literal in this file: `mail-routes.test.ts`'s scanner reads them all, comments included, and `isChildReclaimKebab` admits exactly the three vocabularies above plus `not-queued`. A comment in this file (or in `close.ts`) that quotes some OTHER kebab word in single quotes reds that scan — use backticks in prose.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/mail-routes.test.ts test/verb-gate.test.ts \
  test/unattended-actor.test.ts test/ccdargv-brand.test.ts test/whitelist-subset.test.ts test/single-definition.test.ts \
  test/typecheck-tests.test.ts)
```

Expected: PASS. `child-reclaim` 59/59 (47, the two `absent`-is-two-populations cases, the four R16 review-child rows of the decision table, the two R4 feed-row cases, and — from the contract's §8 rulings — the `no-worktree-record` audit-refusal row (R19), the eleven-digit `childOf` and `unmeasured` parser rows (R2, R11′) and the exit-1 case (R11′)) — its first case harvests the fourteen words from ccd's `RECLAIM-BEGIN`…`RECLAIM-END` region (comment lines stripped) and holds them equal to `CHILD_RECLAIM_TOKEN_KIND`'s keys, so a word ccd starts emitting without a server meaning is a red here, not an `unreadable` audit on the fleet. Every argv the executor composes crosses the agent's real whitelist first (`testDeps`' `guardRunner`). `typecheck-tests` is a known load flake — re-run it alone before calling it a break.

- [ ] **Step 5: Mutation check, then commit**

Command for rows 1–17 and 19–30: `cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts` plus the file named in the row (rows 24 and 25 edit `ccd/ccd`: re-stamp after the edit and after the restore). Every expected red in rows 1–16 and 18 was measured while this plan was written; row 17's received counts moved with the fourteenth word and are re-predicted; rows 19–23 (the R16 and R4 guards, added when the contract's §7 rulings landed) and rows 24–30 (the §8 rulings' guards — R5′, R19, R11′, R2, R16′) are PREDICTED at planning — measure each and record the received red.

| # | Edit (one at a time, restore after) | Extra file | Expected red |
|---|---|---|---|
| 1 | In `childReclaimAct`, delete `if (!capSupported(deps.fleetState, RECLAIM_CAP)) return 'unsupported';` | `test/verb-gate.test.ts` | *has no ungated call site outside UNGATED_BY_DECISION* and *gates every verb this branch added*: `ws-reclaim: expected [ Array(1) ] to deeply equal []` — green in `child-reclaim` (step 4 still refuses), which is why both gates exist |
| 2 | Delete step 4's `if (!capSupported(deps.fleetState, RECLAIM_CAP)) { return deferred('unsupported', …); }` | — | *refuses on NO evidence*: `nothing is sent to a box that did not prove it has the verb: expected [ [ 'ws-audit', '--session', …(2) ] ] to deeply equal []` |
| 3 | Delete the `if (mark.runId !== runId) { … }` block | — | *a marker naming ANOTHER run*: `expected { kind: 'reclaimed', …(3) } to match object { kind: 'deferred', …(1) }` — the two authorities stopped being compared |
| 4 | `deferred('siblings-unreadable', sib.detail)` → `deferred('siblings-open', sib.detail)` | — | *an open sibling defers, and an UNREADABLE sibling list defers*: the `why` no longer says which |
| 5 | `if (!req.deferExpired && deps.presence?.isVisible(sessionId) === true) {` → `if (false) {` | — | *defers while someone is looking*: `expected { kind: 'reclaimed', …(3) } to match object { kind: 'deferred', why: 'presence' }` |
| 6 | `if (audit.childOf !== runId) {` → `if (false) {` | — | *a token minted for ANOTHER run is not spent*: `expected { kind: 'failed', …(3) } to match object { kind: 'deferred', …(1) }` — the verb was called with it |
| 7 | Delete step 7's `childReclaimCancelMail(deps, sessionId, 'reclaimed');` | — | *audit → token → verb*: `expected { state: 'queued', lastError: null } to deeply equal { state: 'rejected', …(1) }` |
| 7a | Delete step 1's `childReclaimCancelMail(deps, sessionId, 'gone');` | — | *a registry row that is gone*: `expected { state: 'queued', lastError: null } to deeply equal { state: 'rejected', …(1) }` — the mail of a child whose box half finished without its cancel waits for a human |
| 7b | Move step 1's `childReclaimCancelMail(deps, sessionId, 'gone');` above `if (!read.found && read.reason === 'absent') {` (cancel on EVERY read) | — | *an UNLISTABLE registry is not `gone`*: `expected 'rejected' to be 'queued'` — a child that may still exist lost its mail |
| 7c | In `childReclaimRowListing`, `return names.includes(…) \|\| names.includes(…) ? 'listed' : 'gone';` → `return 'gone';` (and delete the `const names`/`null` lines) | — | *a row `readSessionRecord` DROPS is not `gone`*: `expected { kind: 'gone', … } to match object { kind: 'deferred', why: 'marker-unreadable' }`, and *a SECOND listing that fails*: the same — PREDICTED at planning (this row post-dates the measured set); measure it and record the received red |
| 7d | In `childReclaimRowListing`, drop `names.includes(\`${sessionId}.uuid\`) \|\| ` | — | *a row `readSessionRecord` DROPS*, its no-marker half only: `expected { kind: 'gone', … } to match object { kind: 'deferred', why: 'marker-unreadable' }` — a live session's mail cancelled because it carried no marker; the marked half stays green, which is the control — PREDICTED at planning; measure it |
| 8 | `'containment-unproven': 'terminal',` → `'retry',` | — | *every RETRY word is a defer reason*: `containment-unproven: expected false to be true`; the audit-refusal case: `expected 'failed' to be 'refused'` |
| 9 | `'no-such-session': 'gone',` → `'terminal',` | — | the audit-refusal case: `expected 'refused' to be 'gone'` — an already-gone child would reach the attention list |
| 10 | Delete `if (outcome.kind !== 'gone') recordChildReclaimFeed(deps, outcome, req);` | — | three cases: `expected [] to deeply equal [ 'child reclaimed' ]`, `[ 'child reclaim deferred' ]`, `[ 'child reclaim failed' ]` |
| 11 | In `childReclaimDecision`, drop `input.retiresProgram \|\| ` | — | *a close that retires the program*: `expected { reclaim: false, why: 'not-finished' } to deeply equal { reclaim: true }` |
| 12 | `if (input.minting.kind === 'absent' \|\| input.minting.sessionId !== input.sessionId)` → `if (input.minting.kind === 'absent')` | — | *a minting run bound to ANOTHER session* and *…to NO session*: `expected { reclaim: true } to deeply equal { reclaim: false, why: 'not-a-child' }` |
| 13 | `input.spent.kind === 'spent';` → `input.spent.kind !== 'unspent' && input.spent.kind !== 'unasked';` | — | *an UNMEASURED spent verdict — never read as spent*: `expected { reclaim: true } to deeply equal { reclaim: false, why: 'not-finished' }` |
| 14 | In `parseChildReclaimAudit`, `if (v.mode !== 'reclaim') return` → `if (false) return` | — | *the PLAIN audit (no mode) is unreadable*: `expected 'refused' to be 'unreadable'` |
| 15 | In `parseChildReclaimResult`, `if (v.reclaimed !== sessionId) return` → `if (false) return` | — | *a reclaim of ANOTHER id is a failure*: `expected 'reclaimed' to be 'failed'` |
| 16 | The dec label `` `run:${req.runId} reclaim ${req.trigger}` `` → `` `run:${req.runId} reclaim` `` | `test/unattended-actor.test.ts` | the argv case (`--actor` differs) and the `SITES` capture: `captured the wrong text` |
| 17 | Delete the `'reap-in-progress': 'retry',` row of `CHILD_RECLAIM_TOKEN_KIND` | — | the harvest: `expected [ 'attached', …(13) ] to deeply equal [ 'attached', …(12) ]`; the audit-refusal case: `expected 'failed' to be 'deferred'` |
| 18 | In `mail-routes.test.ts`, `\|\| isChildReclaimKebab(tok),` → `\|\| false,` | (command: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts -t kebab`) | `no-such-session is not a declared MailRejectCode, …` — the scanner is live over this file |
| 19 | In `childReclaimDecision`, delete the whole `if (input.minting.reviews !== null) { … }` block | — | *a REVIEW child while the run it reviewed is still open*: `expected { reclaim: true } to deeply equal { reclaim: false, why: 'review-report-live' }`; the `absent` and `unreadable` review rows red the same way — a report the coordinator still cites is deleted |
| 20 | In that block, `if (input.reviewed.kind !== 'row' \|\| !isChildReclaimTerminalState(input.reviewed.state))` → `if (input.reviewed.kind !== 'row')` | — | *a REVIEW child while the run it reviewed is still open* only (the `absent` row stays green — the control): `expected { reclaim: true } to deeply equal { reclaim: false, why: 'review-report-live' }` |
| 21 | In `childReclaimFeedBody`'s `deferred` arm, drop `${wait}` | — | *a SWEEP deferral states how long*: `expected '…reclaim deferred (presence) — someone is viewing this session.' to contain 'Deferred for 7 minutes so far.'` |
| 22 | In `childReclaimWaitText`, `if (req.deferExpired) {` → `if (false) {` | — | *a CEILING-EXPIRED reclaim states the wait it ended*: `expected '…' to contain 'The defer ceiling was reached after 16 minutes of deferral'` |
| 23 | In `childReclaimWaitText`, `(nowMs - req.deferredSinceMs)` → `(nowMs - nowMs)` | — | both R4 cases: `to contain 'Deferred for 7 minutes so far.'` / `'…after 16 minutes of deferral'` — received `0 minutes`; the elapsed time is measured, not merely printed |
| 24 | `ccd/ccd`: in `cmd_ws_audit`'s reclaim verdict `case`, delete `\|no-worktree-record` (re-stamp) | — | *the audit journals exactly the TERMINAL words*: `expected [ 'branch-elsewhere', …(4) ] to deeply equal [ 'branch-elsewhere', …(5) ]` — ccd's list fell short of the map's terminal arm (R5′) |
| 25 | `ccd/ccd`: add `held\|` to the front of that `case`'s pattern (re-stamp) | — | the same case: `expected [ 'branch-elsewhere', …(6) ] to deeply equal [ 'branch-elsewhere', …(5) ]` — a retryable word journaled every pass (R5′: terminal ONLY) |
| 26 | `'no-worktree-record': 'terminal',` → `'no-worktree-record': 'retry',` (ccd untouched) | — | *the audit journals exactly the TERMINAL words*: `expected [ 'branch-elsewhere', …(5) ] to deeply equal [ 'branch-elsewhere', …(4) ]` — the expectation MOVED with the map, which is the proof it is derived from it and not a second literal; also *every RETRY word is a defer reason* (`no-worktree-record: expected false to be true`) and the audit-refusal row (`expected 'failed' to be 'refused'`) |
| 27 | Delete `\| 'no-worktree-record'` from `ChildReclaimToken` and its `CHILD_RECLAIM_TOKEN_KIND` row | — | *are exactly the words ccd’s RECLAIM region refuses with*: `expected [ 'attached', …(13) ] to deeply equal [ 'attached', …(12) ]`; the audit-refusal row: `expected 'failed' to be 'refused'` — a terminal box word read as unreadable, retried for ever (R19) |
| 28 | In `childReclaimAudit`, delete `if (!res.ok) return { kind: 'unreadable', … };` | — | *an audit that EXITS 1 is failed whatever it printed*: `expected '…answered a verdict this build does not know: unmeasured' to contain 'measured nothing'`, and `the verb was never called on an exit-1 token: expected [ 'ws-audit', 'ws-reclaim' ] to deeply equal [ 'ws-audit' ]` (R11′) |
| 29 | In `parseChildReclaimAudit`, `!CHILD_RUN_ID.test(String(v.childOf))` → `!Number.isSafeInteger(v.childOf) \|\| v.childOf < 1` | — | *reclaimable with an eleven-digit childOf is unreadable*: `expected 'token' to be 'unreadable'` — a sixteen-digit reader where the grammar is ten (R2) |
| 30a | In `childReclaimDecision`, delete `if (input.reviewed.kind === 'unreadable') return no('marker-unreadable');` | — | *a REVIEW child whose reviewed run cannot be read*: `expected { reclaim: false, why: 'review-report-live' } to deeply equal { reclaim: false, why: 'marker-unreadable' }` — an unreadable row folded into a word with another remedy (R16′) |
| 30b | In `childReclaimDecision`, `if (input.reviewed.kind !== 'row' \|\| !isChildReclaimTerminalState(input.reviewed.state)) return no('review-report-live');` → `if (input.reviewed.kind === 'row' && !isChildReclaimTerminalState(input.reviewed.state)) return no('review-report-live');` | — | *a REVIEW child whose reviewed run the database does not have*: `expected { reclaim: true } to deeply equal { reclaim: false, why: 'review-report-live' }` — an absent reviewed run read as terminal, the report deleted (R16′) |

Restore everything, re-run Step 4 (green), then:

```bash
git add server/src/coord/childReclaim.ts server/test/child-reclaim.test.ts server/test/verb-gate.test.ts \
  server/test/unattended-actor.test.ts server/test/mail-routes.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): reclaimChild — the one executor, its fourteen words, and the close decision

childReclaim.ts holds the words ws-reclaim answers with and what each means
(gone / terminal / retry), held equal to ccd's RECLAIM region by harvest —
no-worktree-record among them, terminal — and its terminal arm held equal to
the list ws-audit --reclaim journals; an audit that exits 1 is failed
whatever it printed, and the audit's childOf is read through CHILD_RUN_ID;
the pure childReclaimDecision (child AND no open sibling AND final, spent,
abandoned or retiring the program; two authorities, equal; a review child
kept as review-report-live while the run it reviewed is open, contract §7
R16); and reclaimChild, which re-reads the marker against the run id
(absent re-listed once, R12), the siblings, presence and reclaim-v1
(capSupported — refuse on no evidence), then ws-audit --reclaim -> token ->
ws-reclaim, cancels the child's mail on success (and on a row it measures
gone, so a restart between the box half and the cancel cannot strand it),
and writes exactly one feed row per outcome except gone — stating the wait
and why for a deferral and for a ceiling-expired attempt, from the request's
new deferredSinceMs (R4).
verb-gate, unattended-actor and the kebab scanner learn the new surface
(spec 2026-09-22 §5.5, §5.7, §5.9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Close decides, releases, and hands off — after the commit, never awaited

**Model routing:** `sonnet`, effort `high` — the contract's routing (§6): `opus` is reserved for Tasks 2–4. `closeRun` is the one place the coordination mutex is held while a fleet act is chosen, and this task changes which act for a class of workspace and adds a hand-off that must never outrun the commit — so the decision table is a pure function with a case per row, the ordering is pinned by the tests below, and review lenses 1 and 3 re-derive both at `opus`.

**Files:**
- Modify: `server/src/coord/close.ts` — imports; `CloseRunDeps.childReclaim?`; `CloseOutcome`'s ok arm (`childReclaim`, `childReclaimWhy?`); the abandon arm; the ordinary close's `needsHold`, archive arm and release arm; `closeReviewRun`; three new module functions at the end of the file (`childGateAtClose`, `mintingRowOf`, `handOffChildReclaim`) and the `ChildGate` type
- Modify: `server/src/coord/routes.ts` — import; `sendCloseOutcome`'s ok branch; a new `childReclaimPort` directly after `sendCloseOutcome` (above `settleItems`' docstring); the close and abandon routes' `CloseRunDeps`
- Modify: `server/test/run-routes.test.ts` — two imports; the two whole-shape `toEqual`s (at `f5dc495b`, `:3930` and `:4018`); six route-level cases after *updates the hold reason to the next wave otherwise*; one review case before *the UNGATED abandon valve reaches a working review run*
- Modify: `server/test/coord-abandon.test.ts` — *never calls verifyDone*'s "no I/O at all" pin narrows to "no I/O outside the registry"; the whole-shape `toEqual` at `:505`
- Create: `server/test/child-reclaim-close.test.ts`

**Interfaces:**
- Consumes: `childReclaimDecision`, `ChildReclaimRequest`, `ChildReclaimMinting`, `ChildReclaimReviewed`, `ChildReclaimNotWhy`, `reclaimChild` (Task 8); `CoordStore.programOpenRunCount(program, excludeRunId)` (Task 7); `CoordStore.run(id)` (existing — the minting row and, for a review child, the row it reviews); `readSessionRecord`, `childSpent` (wave 2).
- Produces:
  - `CloseRunDeps.childReclaim?: (req: ChildReclaimRequest) => void` — the contract's optional port. Every request close hands it carries `deferredSinceMs: null` (contract §7 R4: a close is always a first attempt).
  - `CloseOutcome`'s ok arm gains `childReclaim: 'queued' | 'not-queued'` and `childReclaimWhy?: ChildReclaimNotWhy` (six words, `review-report-live` among them — R16); `POST /api/runs/:id/close` and `POST /api/runs/:id/abandon` carry both (additive; `childReclaimWhy` omitted when absent). ABSENT `childReclaimWhy` on `not-queued` has ONE meaning: the child was eligible and nothing took the hand-off — no port, or wiring it threw — and ONE remedy, the sweep.
  - The fleet act for a child the coordinator has FINISHED with is `ws-release`: never `ws-hold` (the retirement fix — a hold claims the child for a wave that can never open, and a hold defers reclaim for ever), and never `ws-archive` (a child is never archived; spec §5.9 — see **Why an archive request is overruled** below).

**Where the decision is taken, and why there.** `childGateAtClose` runs INSIDE the mutex (the whole `closeRun` does), on the sibling list just read, BEFORE any close-path write — the same place the hold verdict is decided, for that block's own reason: it changes which fleet act runs. It reads the box's authority (the registry's `ChildMark`, re-read now), the server's (the MINTING run's row, by the id the marker names — not the closing run, whenever the child handed over across waves), and — when that minting row is a REVIEW run's — the row of the run it reviews (`runs.reviews`), a second `coord.run` read taken in the same mutex section as the sibling read, so `review-report-live` is decided on the same instant as `siblings-open` (contract §7 R16), and whose two edges are RULED (contract §8 R16′): a reviewed row `coord.run` cannot READ is `unreadable` and defers `marker-unreadable`, and a reviewed run ABSENT from the database is not proven terminal and keeps the child, `review-report-live` — `reviewedRowOf` hands the decision all four answers, never a folded boolean, and Task 8's decision table pins both edges; then `retiresProgram` (`programOpenRunCount(run.program, run.id) === 0` — D-51's one query with this run set aside), and the spent verdict LAST and only when it is the one conjunct left (its live half is a gh round trip). The hand-off happens after `coord.closeRun` commits, and only if it committed.

**Why the abandon arm now reads the registry.** An abandon counts as finished (spec §5.7), so a child it releases is reclaimed — which needs the marker. `coord-abandon.test.ts`'s *never calls verifyDone* pinned "no I/O at all" as the way to catch a `verifyDone` folded into the arm; it narrows to "no I/O outside the registry", which still catches it (`verifyDone` reads git's ref files under the projects root before it can answer — measured by the mutation row below), and a registry read cannot disable the valve D-275 protects: an unlistable registry answers `marker-unreadable`, and the abandon proceeds (a case below).

**Why an archive request is overruled — ruled (contract §7 R17, `child-archive-overruled`).** `state:'failed'` with `archive:true` is the one explicit `wsArchive` in the lane. For an ELIGIBLE child it takes the release arm instead and the child is reclaimed: the contract fixes an eligible child's fleet act as `ws-release`, and rule 4 says a human never has to touch a child — an archived child would wait on a human's `ws-reap`. The reclaim pins everything the archive would have kept (a WIP commit, attic pins, a tombstone). A non-child's archive is unchanged, and a case pins both halves. This is the contract's ruled behaviour, not a departure: it is not named in the wave-done mail and gets no number.

**Why a review close usually queues NOTHING (contract §7 R16).** A review run's reviewer is a child minted by that review run, and reviewer clause 7 keeps the report in the reviewer's clips, which the coordinator cites by path in every send-back `fix-round` mail. So `closeReviewRun` still RELEASES the reviewer (its shipped act, unchanged), but the decision answers `review-report-live` while the work run it reviewed is not terminal — which, at a review close, it almost never is (the coordinator rules on the report next). The reviewer is reclaimed once the reviewed run is terminal, by wave 4's sweep, whose eligibility gains the same condition.

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/child-reclaim-close.test.ts`:

```ts
// Child reclamation, wave 3 — close DECIDES, it does not wait (spec
// 2026-09-22 §5.7). `closeRun` called directly, with a RECORDING port in place
// of the route's queue, so each case can say exactly when the hand-off
// happened relative to the commit, with what request, and what the close
// answered — none of which a route-level test can isolate.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import type { ChildReclaimRequest } from '../src/coord/childReclaim.js';
import type { Runner } from '../src/exec.js';
import type { FleetIO } from '../src/io.js';
import type { RunState } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const ID = 'demo-quiet-basin';
const CLAIMED_BY = 'demo-coordinator';
/** An abandon-shaped ordinary close (`state:'failed'` skips `verifyDone`, D-49)
 *  — the one ordinary-path body a fixture with no git repo can drive. */
const FAILED_CLOSE = { fingerprint: { branchTip: 'x', prNumber: null, prPhase: 'open', handoffCommit: 'x' },
  final: false, state: 'failed' };

interface Handed { req: ChildReclaimRequest; stateAtCall: RunState | undefined }

const build = (over: { io?: FleetIO; port?: 'record' | 'throw' | 'none' } = {}) => {
  const home = mkTmp('ccrc-child-reclaim-close-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
  const base = testDeps(home, run);
  const handed: Handed[] = [];
  const port = over.port ?? 'record';
  const deps: CloseRunDeps = {
    coord, io: over.io ?? base.io, cfg: base.cfg, runCcd: base.runCcd,
    ...(port === 'none' ? {} : {
      childReclaim: (req: ChildReclaimRequest) => {
        if (port === 'throw') throw new Error('the queue is on fire');
        handed.push({ req, stateAtCall: okRun(coord.run(req.runId))?.state });
      },
    }),
  };
  /** A run of `program`, dispatched into `session`. */
  const dispatched = (session: string, wave = 1, program = 'p'): number => {
    const r = coord.openRun({ program, title: 't', project: 'demo', wave, waveOf: 3, claimedBy: CLAIMED_BY });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, session, session, `ws/${session}`, false);
    expect(coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    return r.id;
  };
  /** The registry row `ws-add` writes, and — unless `mark` is null — the
   *  `.child` marker `ws-add --child` writes beside it. */
  const seed = (session: string, mark: string | null): void => {
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${session}`,
      uuid: `u-${session}`, started: '1', workspace: session, branch: `ws/${session}`, base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${session}.${k}`), v);
    if (mark !== null) writeFileSync(path.join(reg, `${session}.child`), mark);
  };
  /** A REVIEW run of `reviews`, dispatched into `session` (spec §5.7):
   *  the reviewer child is minted by THIS run, and the run it reads is
   *  `reviews`. `REVIEW_RUN_TRANSITIONS` has no planned->working edge, so the
   *  `dispatched` hop is the store's own machine. */
  const reviewDispatched = (session: string, reviews: number): number => {
    const r = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 3, claimedBy: CLAIMED_BY,
      kind: 'review', reviews });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, session, session, `ws/${session}`, false);
    expect(coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    return r.id;
  };
  const acts = () => calls.map((c) => c[0]);
  return { coord, deps, handed, dispatched, reviewDispatched, seed, acts };
};

describe('the hand-off happens AFTER the commit, and only after it', () => {
  it('an abandoned child is handed off once, with the MINTING run, after its run went terminal', async () => {
    const b = build();
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    const out = await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
    expect(out).toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'queued' });
    // `deferredSinceMs: null` — close is always a first attempt: it has no wait to report (spec §5.7).
    expect(b.handed).toEqual([{ req: { sessionId: ID, runId: id, trigger: 'close', deferExpired: false,
                                       deferredSinceMs: null },
                                stateAtCall: 'failed' }]);
    expect(b.acts()).toEqual(['ws-release']);
  });

  it('a child that handed over across waves is reclaimed under the run that MINTED it', async () => {
    const b = build();
    const minted = b.dispatched(ID, 1);
    b.seed(ID, String(minted));
    expect(b.deps.coord.closeRun({ runId: minted, finalState: 'done', causedBy: 'test', handoffCommit: null,
      program: 'p', viaClosing: true }).ok).toBe(true);
    const wave2 = b.dispatched(ID, 2);
    const out = await closeRun(b.deps, wave2, { intent: 'abandon' }, 'operator');
    expect(out).toMatchObject({ ok: true, childReclaim: 'queued' });
    expect(b.handed.map((h) => h.req.runId)).toEqual([minted]);
  });

  it('a commit that fails hands nothing off — a reclaim can never outrun an un-closed run', async () => {
    const b = build();
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    b.deps.coord.closeRun = () => ({ ok: false, error: 'unknown-run' });
    const out = await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
    expect(out).toMatchObject({ ok: false, kind: 'advanceFailed' });
    expect(b.handed).toEqual([]);
  });

  it('a port that throws leaves the close committed, answered not-queued with no reason', async () => {
    const b = build({ port: 'throw' });
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    const out = await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
    expect(out).toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'not-queued' });
    expect(okRun(b.deps.coord.run(id))!.state).toBe('failed');
  });

  it('no port wired: an eligible child is not-queued with no reason — the sweep’s to reach', async () => {
    const b = build({ port: 'none' });
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'not-queued' });
  });
});

describe('two authorities, equal — anything else is not a child here', () => {
  it.each<[string, (id: number) => string | null, string]>([
    ['no marker', () => null, 'not-a-child'],
    ['a marker naming a run the database does not have', () => '999', 'not-a-child'],
    ['a marker that is not a run id', () => 'seven', 'marker-unreadable'],
  ])('%s', async (_what, mark, why) => {
    const b = build();
    const id = b.dispatched(ID);
    b.seed(ID, mark(id));
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ ok: true, released: true, childReclaim: 'not-queued', childReclaimWhy: why });
    expect(b.handed).toEqual([]);
  });

  it('a marker naming a run bound to ANOTHER session', async () => {
    const b = build();
    const other = b.dispatched('demo-other-mesa');
    const id = b.dispatched(ID);
    b.seed(ID, String(other));
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
  });

  it('an UNLISTABLE registry defers — and the abandon valve still closes the run (D-275)', async () => {
    const b0 = build();
    const b = build({ io: { ...b0.deps.io, readdir: async () => null } });
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ ok: true, state: 'failed', released: true, childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' });
  });

  it('an open sibling keeps the workspace claimed and queues nothing', async () => {
    const b = build();
    const id = b.dispatched(ID, 1);
    b.seed(ID, String(id));
    const next = b.deps.coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 2, waveOf: 3, claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error('openRun refused');
    b.deps.coord.setSession(next.id, ID);
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ ok: true, released: false, childReclaim: 'not-queued', childReclaimWhy: 'siblings-open' });
    expect(b.acts()).toEqual(['ws-hold']);
  });
});

describe('the fleet act for a finished child is a RELEASE — never a hold, never an archive', () => {
  it('an ordinary non-final failed close of a child releases it; of a non-child, it re-holds as ever', async () => {
    const child = build();
    const c = child.dispatched(ID);
    child.seed(ID, String(c));
    child.dispatched('demo-next-wave', 2);                  // keeps program p open — the failed close decides
    expect(await closeRun(child.deps, c, FAILED_CLOSE, 'coordinator'))
      .toMatchObject({ ok: true, released: true, childReclaim: 'queued' });
    expect(child.acts()).toEqual(['ws-release']);

    const plain = build();
    const p = plain.dispatched(ID);
    plain.seed(ID, null);
    plain.dispatched('demo-next-wave', 2);
    expect(await closeRun(plain.deps, p, FAILED_CLOSE, 'coordinator'))
      .toMatchObject({ ok: true, released: false, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
    expect(plain.acts()).toEqual(['ws-hold']);
  });

  it('archive:true on a child releases it instead — a child is never archived; a non-child still is', async () => {
    const child = build();
    const c = child.dispatched(ID);
    child.seed(ID, String(c));
    expect(await closeRun(child.deps, c, { ...FAILED_CLOSE, archive: true }, 'coordinator'))
      .toMatchObject({ ok: true, released: true, childReclaim: 'queued' });
    expect(child.acts()).toEqual(['ws-release']);

    const plain = build();
    const p = plain.dispatched(ID);
    plain.seed(ID, null);
    expect(await closeRun(plain.deps, p, { ...FAILED_CLOSE, archive: true }, 'coordinator'))
      .toMatchObject({ ok: true, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
    expect(plain.acts()).toEqual(['ws-archive']);
  });
});

describe('a REVIEW child lives until the run it reviewed is terminal (spec §5.7)', () => {
  it('the review run’s abandon releases the reviewer but keeps it while the reviewed run is open', async () => {
    const b = build();
    const work = b.dispatched('demo-worker-mesa');
    expect(b.deps.coord.advance(work, 'working', 'test').ok).toBe(true);
    expect(b.deps.coord.advance(work, 'awaiting-review', 'test').ok).toBe(true);
    const review = b.reviewDispatched(ID, work);
    b.seed(ID, String(review));
    expect(await closeRun(b.deps, review, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id: review, state: 'failed', released: true,
                 childReclaim: 'not-queued', childReclaimWhy: 'review-report-live' });
    expect(b.handed, 'the report the coordinator cites by path is not deleted').toEqual([]);
    expect(b.acts()).toEqual(['ws-release']);
  });

  it('once the reviewed run is terminal, the review child is reclaimed like any other', async () => {
    const b = build();
    const work = b.dispatched('demo-worker-mesa');
    const review = b.reviewDispatched(ID, work);
    b.seed(ID, String(review));
    expect(b.deps.coord.advance(work, 'failed', 'test').ok).toBe(true);
    expect(await closeRun(b.deps, review, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id: review, state: 'failed', released: true, childReclaim: 'queued' });
    expect(b.handed.map((h) => h.req.runId)).toEqual([review]);
  });
});

const coordSrc = (f: string): string =>
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', f), 'utf8');

describe('the two seams a runtime case cannot see', () => {
  it('retiresProgram is D-51’s predicate — the store’s one query, this run set aside, no SQL in close.ts', () => {
    const src = coordSrc('close.ts');
    expect(src).toContain('deps.coord.programOpenRunCount(run.program, run.id) === 0');
    expect(src).not.toMatch(/FROM runs/);
  });

  it('the route’s port runs the executor on the SESSION’S OWN queue — the one ws-reap and the naming sweep join', () => {
    // A reclaim started beside the queue instead of on it would race a
    // `POST /workspace/reap` of the same workspace; the timing a runtime case
    // would need to show that is not deterministic, so the seam is pinned by
    // its text: the executor is reached through `deps.queue.run(sessionId, …)`
    // and nowhere else in the file.
    const src = coordSrc('routes.ts');
    expect(src).toContain('void deps.queue.run(req.sessionId, () => reclaimChild({');
    expect(src.match(/reclaimChild\(/g) ?? []).toHaveLength(1);
  });
});
```

(b) `server/test/run-routes.test.ts` — after `import { okRun, okRuns } from './coordReadHelpers.js';`:

```ts
import { KeyedQueue } from '../src/inject/queue.js';
import { NotifyLog } from '../src/notifylog.js';
```

the two whole-shape pins become (the first in *closes a review run done when the reviewed tip is unchanged*, the second in *the UNGATED abandon valve reaches a working review run*):

```ts
    expect(res.json()).toEqual({ ok: true, id: reviewId, state: 'done', released: true,
      childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
```

```ts
    expect(res.json()).toEqual({ ok: true, id: reviewId, state: 'failed', released: true,
      childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
```

directly after the closing `});` of *updates the hold reason to the next wave otherwise* (inside `describe('POST /api/runs/:id/close'`):

```ts
  // ---- child reclamation, wave 3 (spec 2026-09-22 §5.7): close decides, it does not wait ----

  /** A dispatched run whose workspace is a CHILD of it — the `.child` marker
   *  planted exactly as `ws-add --child <runId>` writes it (wave 1) — with the
   *  process's one queue and a feed log wired into the app, so a case can wait
   *  for the queued reclaim and read its one feed row back. `testDeps`' box
   *  advertises no capability, so the executor always ends at `unsupported`:
   *  that row is the proof the hand-off reached it, on this session's queue. */
  const dispatchedChild = async (sessionId: string, prState: { code: number; stdout: string; stderr: string }) => {
    const home = mkTmp('ccrc-runs-');
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { run, calls } = makeRunner(home, { wsAddCreates: [sessionId], prState });
    const queue = new KeyedQueue();
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const w = await openApp(home, run, { cfg: { projectsRoot: root }, queue, notifyLog });
    app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    writeFileSync(path.join(home, '.cc-sessions', `${sessionId}.child`), String(opened.id));
    return {
      id: opened.id, coord: w.coord, calls, home,
      settled: () => queue.run(sessionId, async () => undefined),
      feed: () => w.coord.feedEvents(50).filter((e) => e.sessionId === sessionId).map((e) => e.title),
    };
  };
  const PR_OPEN = (s: string) =>
    ({ code: 0, stdout: `${ccdLine(s, `ws/${s}`, [prRow(`ws/${s}`, 'OPEN')])}\n`, stderr: '' });
  const PR_NONE = (s: string) => ({ code: 0, stdout: `${ccdLine(s, `ws/${s}`, [])}\n`, stderr: '' });
  const NONE_CLAIM = { branchTip: TIP, prNumber: null, prPhase: 'none', handoffCommit: TIP };
  const fleetActs = (calls: string[][]) => calls.map((c) => c[0]).filter((v) => v === 'ws-hold' || v === 'ws-release'
    || v === 'ws-archive' || v === 'ws-audit' || v === 'ws-reclaim');

  it('a FINAL close of a child releases it and queues its reclaim — the answer does not wait on the act', async () => {
    const sessionId = `${PROJECT}-child1`;
    const c = await dispatchedChild(sessionId, PR_OPEN(sessionId));
    c.calls.length = 0;
    const res = await postClose(app!, c.id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.json()).toEqual({ ok: true, id: c.id, state: 'done', released: true, childReclaim: 'queued' });
    await c.settled();
    expect(fleetActs(c.calls), 'released, and nothing sent to a box with no reclaim-v1').toEqual(['ws-release']);
    expect(c.feed()).toEqual(['child reclaim deferred']);
  });

  it('a NON-final close of a SPENT child releases it too — one PR per child (rule 3)', async () => {
    const sessionId = `${PROJECT}-child2`;
    const c = await dispatchedChild(sessionId, PR_OPEN(sessionId));
    await postOpen(app!, { ...OPEN_BODY, wave: 2 });            // the program stays open: wave 2 gets a FRESH child
    c.calls.length = 0;
    const res = await postClose(app!, c.id, { fingerprint: GOOD_CLAIM, final: false });
    expect(res.json()).toMatchObject({ ok: true, released: true, childReclaim: 'queued' });
    expect(fleetActs(c.calls)).toEqual(['ws-release']);
  });

  it('a non-final close of an UNSPENT child with its program still open holds it for wave N+1, as ever', async () => {
    const sessionId = `${PROJECT}-child3`;
    const c = await dispatchedChild(sessionId, PR_NONE(sessionId));
    await postOpen(app!, { ...OPEN_BODY, wave: 2 });
    c.calls.length = 0;
    const res = await postClose(app!, c.id, { fingerprint: NONE_CLAIM, final: false });
    expect(res.json()).toMatchObject({ ok: true, released: false, childReclaim: 'not-queued', childReclaimWhy: 'not-finished' });
    expect(c.calls).toContainEqual(['ws-hold', '--session', sessionId, '--reason', 'program:build4 wave:2/3']);
    expect(fleetActs(c.calls)).toEqual(['ws-hold']);
  });

  it('a non-final close that RETIRES its program releases the child — never a hold for a wave that cannot open', async () => {
    const sessionId = `${PROJECT}-child4`;
    const c = await dispatchedChild(sessionId, PR_NONE(sessionId));
    c.calls.length = 0;
    const res = await postClose(app!, c.id, { fingerprint: NONE_CLAIM, final: false });
    expect(res.json()).toMatchObject({ ok: true, released: true, childReclaim: 'queued' });
    expect(fleetActs(c.calls)).toEqual(['ws-release']);
    const program = c.coord.db.prepare("SELECT state FROM programs WHERE slug = 'build4'").get() as { state: string };
    expect(program.state, 'D-51 retired it in the same close').toBe('done');
  });

  it('an unreadable marker never authorises a reclaim — the close still does exactly what it did before', async () => {
    const sessionId = `${PROJECT}-child5`;
    const c = await dispatchedChild(sessionId, PR_OPEN(sessionId));
    writeFileSync(path.join(c.home, '.cc-sessions', `${sessionId}.child`), 'seven');
    c.calls.length = 0;
    const res = await postClose(app!, c.id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.json()).toMatchObject({ ok: true, released: true, childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' });
    await c.settled();
    expect(c.feed()).toEqual([]);
  });

  it('the operator abandon of a child queues its reclaim — an abandon is finished', async () => {
    const sessionId = `${PROJECT}-child6`;
    const c = await dispatchedChild(sessionId, PR_OPEN(sessionId));
    c.calls.length = 0;
    const res = await app!.inject({ method: 'POST', url: `/api/runs/${c.id}/abandon` });
    expect(res.json()).toEqual({ ok: true, id: c.id, state: 'failed', released: true, childReclaim: 'queued' });
    await c.settled();
    expect(c.feed()).toEqual(['child reclaim deferred']);
  });
```

and directly before *the UNGATED abandon valve reaches a working review run: failed directly, no closing hop (D-2807)*:

```ts
  it('a review close of a reviewer CHILD releases it and KEEPS it — the report is live while the reviewed run is open (child reclamation, wave 3; spec §5.7)', async () => {
    // The coordinator rules on the report NEXT, citing it by path in any
    // send-back `fix-round` mail; the work run is `awaiting-review` here, so
    // the reviewer's clips — the report's directory — must outlive this close.
    const home = mkTmp('ccrc-runs-');
    const { w, workId, reviewId, report, calls } = await reviewInFlight(home);
    writeFileSync(path.join(home, '.cc-sessions', 'demo-r1.child'), String(reviewId));
    const res = await postClose(app, reviewId, { fingerprint: { reviewedTip: TIPW, report } });
    expect(res.json()).toEqual({ ok: true, id: reviewId, state: 'done', released: true,
      childReclaim: 'not-queued', childReclaimWhy: 'review-report-live' });
    expect(okRun(w.coord.run(workId))!.state).toBe('awaiting-review');
    expectReleasedReviewerOnly(calls);
  });

```

(c) `server/test/coord-abandon.test.ts` — in *never calls verifyDone — the five done-authority codes are unreachable here*, replace `    expect(reads).toEqual([]);` with:

```ts
    // CHILD RECLAMATION (wave 3) NARROWS THIS PIN BY ONE DIRECTORY and keeps
    // its power. An abandon counts as FINISHED (spec 2026-09-22 §5.7), so the
    // arm now reads THIS session's registry row for its `.child` marker — the
    // box's half of the two authorities — and "no I/O at all" became "no I/O
    // outside the registry". `verifyDone` still cannot pass: before it can
    // answer anything but the claim-shape refusal it reads git's own ref files
    // under the projects root (`gitref.ts`), which is what this now watches —
    // measured by folding `verifyDone` back into the arm (the plan's mutation
    // row). And a registry read cannot disable the valve D-275 protects: an
    // unlistable or unreadable registry answers `marker-unreadable`, and the
    // abandon proceeds exactly as before.
    const registry = path.join(home, '.cc-sessions');
    expect(reads.filter((p) => p !== registry && !p.startsWith(`${registry}/`))).toEqual([]);
```

and in *accepts the bare {intent:"abandon"} body and answers ok*:

```ts
    expect(await closeRun(deps, id, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id, state: 'failed', released: true,
                 childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim-close.test.ts test/run-routes.test.ts test/coord-abandon.test.ts)
```

Expected: FAIL. `child-reclaim-close`: every case that expects `childReclaim` (`expected { ok: true, id: 1, …(2) } to deeply equal { ok: true, id: 1, …(3) }`), the release-not-hold and release-not-archive cases (`expected [ 'ws-hold' ] to deeply equal [ 'ws-release' ]`, `[ 'ws-archive' ]`), and the two source pins (`programOpenRunCount(run.program, run.id)` and `reclaimChild(` not found). `run-routes`: the three whole-shape pins and the seven new cases. `coord-abandon`: the whole-shape pin only — the narrowed read pin is green on today's arm, which reads nothing at all.

- [ ] **Step 3: `close.ts` — the port, the answer, the decision**

Imports — after `import { readPrHistory } from './prhistory.js';`:

```ts
import { readSessionRecord } from '../registry.js';
import { childSpent } from './childSpent.js';
import {
  childReclaimDecision, type ChildReclaimDecision, type ChildReclaimMinting, type ChildReclaimNotWhy,
  type ChildReclaimRequest, type ChildReclaimReviewed,
} from './childReclaim.js';
```

and the shared import becomes:

```ts
import {
  transitionsFor, type ChildMark, type DoneRejectCode, type RunRefuseCode, type RunState,
} from '../../../shared/api.js';
```

`CloseRunDeps`:

```ts
export interface CloseRunDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
  /** Child reclamation (spec 2026-09-22 §5.7): hand a reclaim to THE ONE
   *  executor. Called only AFTER the close's transaction has committed — a
   *  reclaim that fails can never un-close a run — and NEVER awaited: the
   *  coordinator's API client gives up after a flat 30 s, `ws-reclaim`'s remote
   *  budget is 240 s, and a close the caller saw time out but the server
   *  committed is worse than one that answered `queued`. OPTIONAL: absent, an
   *  eligible child is answered `not-queued` with no reason, and wave 4's sweep
   *  reaches it. `coord/routes.ts` wires it to the session's own queue. */
  childReclaim?: (req: ChildReclaimRequest) => void;
}
```

`CloseOutcome`'s ok arm — its last line `      released: boolean }` becomes:

```ts
      released: boolean;
      /** Child reclamation (spec 2026-09-22 §5.7), ADDITIVE. `queued`: the
       *  workspace is a child this close found FINISHED — released, never
       *  re-held — and its reclaim was handed to the executor, which runs
       *  AFTER this answer; its outcome is a feed row, never this response.
       *  `not-queued` otherwise. */
      childReclaim: 'queued' | 'not-queued';
      /** Why not, whenever the answer was a DECISION (`childReclaimDecision`).
       *  ABSENT on `not-queued` means the child WAS eligible and nothing took
       *  the hand-off — no executor wired, or wiring it threw. Both have one
       *  remedy, the sweep, so they are one shape; neither is ever spelled as
       *  a reason the decision did not give. */
      childReclaimWhy?: ChildReclaimNotWhy }
```

**The abandon arm.** Replace:

```ts
    let released = false;
    if (run.sessionId !== null) {
      const sibRead = siblingsOf(run.sessionId);
      // Fail-shut ahead of the fleet act, for the reason `siblingsOf` states.
      if (!sibRead.ok) return { ok: false, kind: 'hold-invalid', detail: sibRead.detail };
      const siblings = sibRead.siblings;
```

with:

```ts
    let released = false;
    // A run with no session names no workspace, so it names no child.
    let childGate: ChildGate = NO_CHILD_GATE;
    if (run.sessionId !== null) {
      const sibRead = siblingsOf(run.sessionId);
      // Fail-shut ahead of the fleet act, for the reason `siblingsOf` states.
      if (!sibRead.ok) return { ok: false, kind: 'hold-invalid', detail: sibRead.detail };
      const siblings = sibRead.siblings;
      // An abandon is FINISHED (spec §5.7), so an eligible child is exactly
      // the no-survivor case below — it is already released, never re-held.
      childGate = await childGateAtClose(deps, run, run.sessionId, sibRead, false, 'failed');
```

and its return `    return { ok: true, id, state: 'failed', released };` becomes:

```ts
    return { ok: true, id, state: 'failed', released, ...handOffChildReclaim(deps, childGate) };
```

**The ordinary close.** Replace:

```ts
  const safe = releaseIsSafe(siblings);
  const needsHold = !((state === 'failed' && archive && safe) || (final && safe));
```

with:

```ts
  const safe = releaseIsSafe(siblings);
  // Child reclamation (spec 2026-09-22 §5.7), decided HERE — inside the
  // coordination mutex, on the sibling list just read, before any close-path
  // write — because it changes the fleet act below: a child the coordinator
  // has FINISHED with is RELEASED, never re-held. That includes a non-final
  // close that retires its program, whose hold would claim the child for a
  // wave that can never be opened, and a hold defers reclaim for ever.
  const childGate = await childGateAtClose(deps, run, run.sessionId, sibRead, final, state);
  const needsHold = !((state === 'failed' && archive && safe) || (final && safe) || childGate.decision.reclaim);
```

replace:

```ts
  let released = false;
  if (state === 'failed' && archive && safe) {
```

with:

```ts
  let released = false;
  // A child is never archived (spec §5.9): the reclaim pins everything the
  // archive would have kept, and an archived child would wait on a human's
  // reap — rule 4 inverted. So an eligible child takes the release arm even
  // when the close asked for an archive.
  if (state === 'failed' && archive && safe && !childGate.decision.reclaim) {
```

replace `  } else if (final && safe) {` with:

```ts
  } else if ((final && safe) || childGate.decision.reclaim) {
```

(the `CCD_ARGV.wsRelease(run.sessionId, sweepDec(deps.fleetState, \`run:${id} close\`))` line under it is untouched — `unattended-actor.test.ts`'s `SITES` anchors on it byte for byte), and the final return `  return { ok: true, id, state, released };` becomes:

```ts
  return { ok: true, id, state, released, ...handOffChildReclaim(deps, childGate) };
```

**`closeReviewRun`.** Replace:

```ts
  const sibRead = siblingsOf(sessionId);
  if (!sibRead.ok) return { ok: false, kind: 'hold-invalid', detail: sibRead.detail };
  const survivor = survivorOf(sibRead.siblings);
```

with:

```ts
  const sibRead = siblingsOf(sessionId);
  if (!sibRead.ok) return { ok: false, kind: 'hold-invalid', detail: sibRead.detail };
  // A review run is always final (§5.3) and the release below is already the
  // act — but its reviewer child is NOT finished while the run it reviewed is
  // open (spec §5.7): the decision answers `review-report-live`, and
  // the sweep reclaims the reviewer once the reviewed run is terminal.
  const childGate = await childGateAtClose(deps, run, sessionId, sibRead, true, state);
  const survivor = survivorOf(sibRead.siblings);
```

and its return `  return { ok: true, id: run.id, state, released: release };` becomes:

```ts
  return { ok: true, id: run.id, state, released: release, ...handOffChildReclaim(deps, childGate) };
```

**The three functions**, appended after `closeReviewRun`'s closing brace:

```ts

// ── child reclamation: close decides, it does not wait (spec 2026-09-22 §5.7) ──

/** What a close decided about the child, and the request it would hand off. */
interface ChildGate { readonly decision: ChildReclaimDecision; readonly request: ChildReclaimRequest | null }

const NO_CHILD_GATE: ChildGate = { decision: { reclaim: false, why: 'not-a-child' }, request: null };

/**
 * Read both authorities and ask `childReclaimDecision`, inside the mutex and
 * before the fleet act. The box's: the registry's `ChildMark`, re-read now
 * (`readSessionRecord`; an unlistable registry is `unreadable`, never `none`).
 * The server's: the MINTING run's row, by the id the marker names — which is
 * not this run whenever the child handed over across waves — and, when that
 * row is a review run's, the row of the run it reviews (spec §5.7),
 * read here beside the caller's sibling read, in the same mutex section. The
 * spent verdict is asked LAST and only when it is the one conjunct left: its
 * live half is a gh round trip, and every other answer is already final
 * without it.
 */
async function childGateAtClose(
  deps: CloseRunDeps, run: RunRow, sessionId: string, siblings: OpenSiblingsResult,
  final: boolean, state: 'done' | 'failed',
): Promise<ChildGate> {
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  const mark: ChildMark = read.found ? read.record.child
    : read.reason === 'absent' ? { kind: 'none' } : { kind: 'unreadable' };
  const minting: ChildReclaimMinting = mark.kind === 'child' ? mintingRowOf(deps.coord, mark.runId) : { kind: 'absent' };
  const reviewed = reviewedRowOf(deps.coord, minting);
  const input = {
    mark, minting, sessionId, siblings, reviewed, final, state, spent: { kind: 'unasked' } as const,
    // D-51's predicate with THIS run set aside — the retirement check
    // `CoordStore.closeRun` runs after the commit, asked before it.
    retiresProgram: deps.coord.programOpenRunCount(run.program, run.id) === 0,
  };
  let decision = childReclaimDecision(input);
  if (!decision.reclaim && decision.why === 'not-finished' && read.found) {
    decision = childReclaimDecision({ ...input, spent: await childSpent(deps, read.record) });
  }
  return {
    decision,
    // `deferredSinceMs: null`: close is always a first attempt (spec §5.7).
    request: decision.reclaim && mark.kind === 'child'
      ? { sessionId, runId: mark.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null } : null,
  };
}

function mintingRowOf(coord: CoordStore, runId: number): ChildReclaimMinting {
  const r = coord.run(runId);
  if (!r.ok) return { kind: 'unreadable' };
  return r.run === null ? { kind: 'absent' } : { kind: 'row', sessionId: r.run.sessionId, reviews: r.run.reviews };
}

/** The run a REVIEW child's minting run reviews (spec §5.7) — `none` when the
 *  minting row is a work run's (or is no row at all: the decision has already
 *  answered on the minting read). Four answers, never folded; the row carries
 *  its STATE, and the pure decision alone asks whether it is terminal. */
function reviewedRowOf(coord: CoordStore, minting: ChildReclaimMinting): ChildReclaimReviewed {
  if (minting.kind !== 'row' || minting.reviews === null) return { kind: 'none' };
  const r = coord.run(minting.reviews);
  if (!r.ok) return { kind: 'unreadable' };
  return r.run === null ? { kind: 'absent' } : { kind: 'row', state: r.run.state };
}

/** AFTER the commit, and never awaited. A port that throws is logged and
 *  answered `not-queued` with no reason — the close has committed, and a
 *  throw out of here would reach `CoordMutex.run`'s `finally` as a bare 500
 *  about a close that happened. */
function handOffChildReclaim(
  deps: CloseRunDeps, gate: ChildGate,
): { childReclaim: 'queued' | 'not-queued'; childReclaimWhy?: ChildReclaimNotWhy } {
  if (!gate.decision.reclaim) return { childReclaim: 'not-queued', childReclaimWhy: gate.decision.why };
  if (deps.childReclaim === undefined || gate.request === null) return { childReclaim: 'not-queued' };
  try {
    deps.childReclaim(gate.request);
  } catch (err) {
    console.warn(`ccrc-server: handing the reclaim of ${gate.request.sessionId} off threw `
      + `(${err instanceof Error ? err.message : String(err)}) — the close committed; the sweep reaches it`);
    return { childReclaim: 'not-queued' };
  }
  return { childReclaim: 'queued' };
}
```

- [ ] **Step 4: `routes.ts` — the port on the session's own queue, and the wire**

Import, after `import { closeRun, type CloseOutcome, type CloseRunDeps } from './close.js';`:

```ts
import { reclaimChild, type ChildReclaimRequest } from './childReclaim.js';
```

`sendCloseOutcome`'s first line, `  if (r.ok) return reply.code(200).send({ ok: true, id: r.id, state: r.state, released: r.released });`, becomes (the totality switch below it is untouched — the ok arm gained fields, not a member):

```ts
  if (r.ok) {
    return reply.code(200).send({ ok: true, id: r.id, state: r.state, released: r.released,
      childReclaim: r.childReclaim, ...(r.childReclaimWhy === undefined ? {} : { childReclaimWhy: r.childReclaimWhy }) });
  }
```

directly after `sendCloseOutcome`'s closing brace (above the `` /** `settleItems`' typed result union -> HTTP status + body `` docstring):

```ts
/**
 * The close path's hand-off to THE ONE child-reclaim executor (spec 2026-09-22
 * §5.7): on the session's OWN queue — the same `KeyedQueue` `POST
 * /workspace/reap` and the naming sweep join, so a reclaim never races either
 * on one workspace — and NEVER awaited, so the close answers before the act
 * runs. Its `ChildReclaimDeps` are read from `deps` WHEN THE JOB RUNS, not
 * when it was queued, so `fleetState` is the box's current answer. A
 * rejection is a bug, logged; the sweep reaches the child either way.
 */
function childReclaimPort(deps: Deps, coord: CoordStore): (req: ChildReclaimRequest) => void {
  return (req) => {
    void deps.queue.run(req.sessionId, () => reclaimChild({
      coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd,
      fleetState: deps.fleetState, presence: deps.presence, notifyLog: deps.notifyLog,
    }, req)).catch((err: unknown) => {
      console.warn(`ccrc-server: the reclaim of ${req.sessionId} threw `
        + `(${err instanceof Error ? err.message : String(err)}) — left to the sweep`);
    });
  };
}

```

and in BOTH `POST /api/runs/:id/close` and `POST /api/runs/:id/abandon`, the `CloseRunDeps` literal's second line `      fleetState: deps.fleetState };` becomes:

```ts
      fleetState: deps.fleetState, childReclaim: childReclaimPort(deps, coord) };
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim-close.test.ts test/run-routes.test.ts test/coord-abandon.test.ts \
  test/coord-decide.test.ts test/unattended-actor.test.ts test/verb-gate.test.ts test/mail-routes.test.ts \
  test/coordinator-skill.test.ts test/coord-routes-single-file.test.ts test/auth-gate.test.ts test/typecheck-tests.test.ts)
```

Expected: PASS. `child-reclaim-close` 17/17 (fifteen, plus the two R16 review-child cases). `unattended-actor` still finds its fourteen sites (wave 2's thirteen, plus Task 8's one) — every `close.ts` anchor is byte-identical; `auth-gate`'s route counts do not move (no route was added); `coordinator-skill`'s route census does not move either.

- [ ] **Step 6: Mutation check, then commit**

Command for every row: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-close.test.ts test/run-routes.test.ts test/coord-abandon.test.ts`. Every expected red below was measured while this plan was written.

| # | Edit (one at a time, restore after) | Expected red |
|---|---|---|
| 1 | Drop `\|\| childGate.decision.reclaim` from BOTH `needsHold` and the release arm's condition | *an ordinary non-final failed close of a child releases it*, *archive:true on a child releases it instead*, *a NON-final close of a SPENT child releases it too*, *a non-final close that RETIRES its program*: each `released: false` / a `ws-hold` where a `ws-release` is required |
| 2 | Drop `&& !childGate.decision.reclaim` from the archive arm | *archive:true on a child*: `expected { ok: true, id: 1, …(3) } to match object { ok: true, released: true, …(1) }` — the child was archived |
| 3 | In the abandon arm, add `handOffChildReclaim(deps, childGate);` on the line after `childGate = await childGateAtClose(…)` | *handed off once … after its run went terminal* (two hand-offs, the first at `dispatched`), *…under the run that MINTED it* (`[ 1, 1 ]`), *a commit that fails hands nothing off* (`expected [ { req: … } ] to deeply equal []`) |
| 4 | In `handOffChildReclaim`, replace the `try { … } catch …` with a bare `deps.childReclaim(gate.request);` | *a port that throws*: `Error: the queue is on fire` — a committed close answered 500 |
| 5 | `programOpenRunCount(run.program, run.id)` → `programOpenRunCount(run.program)` | *a non-final close that RETIRES its program*: held, not released; the source pin reds too |
| 6 | `mark.kind === 'child' ? mintingRowOf(deps.coord, mark.runId) : …` → `mark.kind === 'child' ? { kind: 'row', sessionId } : …` | *a marker naming a run the database does not have* and *…bound to ANOTHER session*: queued — one authority stood in for two |
| 7 | `: read.reason === 'absent' ? { kind: 'none' } : { kind: 'unreadable' };` → `: { kind: 'none' };` | *an UNLISTABLE registry defers*: `not-a-child` where `marker-unreadable` is required — a read failure collapsed into "not a child" |
| 8 | `if (!decision.reclaim && decision.why === 'not-finished' && read.found) {` → `if (false && read.found) {` | *a NON-final close of a SPENT child releases it too*: held — rule 3 unenforced at close |
| 9 | In `sendCloseOutcome`, drop the `childReclaim: …, ...(…)` fields | every route-level child case and the three whole-shape pins |
| 10 | In the abandon route, drop `, childReclaim: childReclaimPort(deps, coord)` | *the operator abandon of a child queues its reclaim*: `not-queued` — the operator's valve never reached the executor |
| 11 | In `childReclaimPort`, `void deps.queue.run(req.sessionId, () => reclaimChild({` → `void (async () => reclaimChild({` | *the route's port runs the executor on the SESSION'S OWN queue*: the source pin — beside the queue, a reclaim races `POST /workspace/reap` |
| 12 | In the abandon arm, add `await verifyDone({ io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState }, { sessionId: run.sessionId, project: run.project, branch: run.branch ?? '' }, { branchTip: 'a'.repeat(40), prNumber: null, prPhase: 'none', handoffCommit: 'a'.repeat(40) });` after the `childGate = …` line | `coord-abandon`'s *never calls verifyDone*: `expected [ …(2) ] to deeply equal []` — the narrowed pin still sees the git reads |
| 13 | In `childGateAtClose`'s request, `deferredSinceMs: null` → `deferredSinceMs: Date.now()` | *an abandoned child is handed off once*: `expected [ { req: { …, deferredSinceMs: <n> } … } ] to deeply equal [ { req: { …, deferredSinceMs: null } … } ]` — close would claim a wait it never had (R4); PREDICTED at planning, measure it |
| 14 | In `reviewedRowOf`, `{ kind: 'row', state: r.run.state }` → `{ kind: 'row', state: 'done' }` | *the review run's abandon … keeps it while the reviewed run is open*: `expected { …, childReclaim: 'queued' } to deeply equal { …, childReclaimWhy: 'review-report-live' }`, and `run-routes`' *a review close of a reviewer CHILD … KEEPS it* the same — the report the coordinator cites is deleted; PREDICTED at planning, measure it |

Restore everything, re-run Step 5 (green), then:

```bash
git add server/src/coord/close.ts server/src/coord/routes.ts server/test/child-reclaim-close.test.ts \
  server/test/run-routes.test.ts server/test/coord-abandon.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): close decides a child's reclaim, releases it, and hands it off

closeRun and closeReviewRun read both authorities inside the mutex — the
registry's marker and the minting run's row, and for a review child the row
it reviews — and ask childReclaimDecision: child, no open sibling, not a
review child whose reviewed run is open (review-report-live, contract §7
R16), and final, spent, abandoned or retiring the program (D-51's one query
with this run set aside). An eligible child is RELEASED, never re-held and
never archived (R17), and after the transaction commits its request —
deferredSinceMs null (R4) — goes to the executor on the session's own queue,
never awaited.
The close response gains childReclaim and childReclaimWhy (additive).
The abandon arm's no-I/O pin narrows to no-I/O-outside-the-registry and
still catches a folded verifyDone (spec 2026-09-22 §5.7).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: The prose contracts that change — coordinator clause 3, step 7, wave-lifecycle §6, the worker and reviewer sentence, CLAUDE.md, README

**Model routing:** `sonnet`, effort `high` — the contract's routing (§6): `opus` is reserved for Tasks 2–4. Contract prose is pinned verbatim and read by models that act on it, so every sentence below is given in full and pinned, and review lens 4 reads it at `opus`.

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` — clause 3; step 7. **Step 6 is NOT modified** (contract §7 R16): its shipped text and the pins `coordinator-skill.test.ts` already holds on it stand exactly as they are
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §6 rewritten: its two "nothing archives it / nothing else does either" statements are LIMITED to workspaces that are not children, and one paragraph is added
- Modify: `ccd/worker-skill/SKILL.md` — "Reporting a wave-done" gains the non-clause sentence (clause 8 unchanged, count stays fifteen)
- Modify: `ccd/reviewer-skill/SKILL.md` — "Reporting review-done" gains it too (clause 8 unchanged, count stays ten)
- Modify: `CLAUDE.md` — the SAFETY bullet
- Modify: `README.md` — the "`ws-reap` stays human-only" paragraph
- Modify: `server/test/coordinator-skill.test.ts` (`CONTRACT[2]`, three new cases), `server/test/worker-skill.test.ts` (one case), `server/test/reviewer-skill.test.ts` (one case)
- Create: `server/test/child-reclaim-prose.test.ts`

**Interfaces:**
- Consumes: Task 9's wire (`childReclaim`, `childReclaimWhy` and its six words, `review-report-live` among them) — §6 names them as the close answers them.
- Produces: the contract text a coordinator, a worker and a reviewer read from this wave on. Nothing in the three skill corpora names `ws-reclaim` — the verb is the server's, and a skill that names a verb gives a model a reason to reach for it (the existing `names the three/five destructive verbs ONLY inside the clause that forbids them` cases, extended to the new verb as a flat ban).

**The review report is kept by the server, not copied by the coordinator (contract §7 R16, ruled).** Reviewer clause 7 writes the report under `$HOME/.cc-clips/<reviewer id>/`; coordinator step 6 reads it "once the close answers ok" and names it in a send-back `fix-round` mail's `artifacts`; mail artifacts are paths, never bytes (`server/src/coord/schema.ts`, the `artifacts` column). R16 settles it structurally: a review child is not finished while the run it reviewed is open, so the review close answers `"childReclaim":"not-queued"` with `review-report-live` (Task 9) and the reviewer's clips — the report with them — outlive every fix round; the sweep reclaims the reviewer once the reviewed run is terminal. So this task makes NO change to step 6: its shipped text, its existing pins, and the reviewer's own path in every mail stand. What changes is what §6 and the reviewer's sentence SAY about it.

- [ ] **Step 1: Write the failing tests**

(a) `server/test/coordinator-skill.test.ts` — `CONTRACT[2]` (the third entry) becomes:

```ts
  'This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server when that child’s run closes; this session’s own workspace is cleaned up by a human, never by a sweep.',
```

(the three verb names still appear exactly once each, inside it — *names the three destructive verbs ONLY inside the clause that forbids them* is unchanged and still green), and directly above that case:

```ts
  // Child reclamation, wave 3. Clause 3 gained the fact that a child is the
  // SERVER's to reclaim — and the verb that does it is never named to this
  // session anywhere in its corpus, for the reason the case below gives about
  // `ws-reap`: a skill that names a verb has given a model a reason to reach
  // for it, and this one is composed by the server alone.
  it('never names the child-reclaim verb, anywhere in the corpus', () => {
    expect(allSkillText).not.toContain('ws-reclaim');
  });

  it('wave-lifecycle §6 says what a child is, when it is reclaimed, and what is not', () => {
    const lifecycle = refs('wave-lifecycle.md');
    const s6 = flat(lifecycle.slice(lifecycle.indexOf('## 6 — Final merge'),
      lifecycle.indexOf('## What happened to a workspace that is gone')));
    expect(s6).toContain('**A child is reclaimed; your own workspace is not.**');
    expect(s6).toContain('`"childReclaim":"queued"`');
    for (const why of ['not-a-child', 'marker-unreadable', 'siblings-open', 'siblings-unreadable', 'review-report-live',
                       'not-finished']) {
      expect(s6, `§6 never names childReclaimWhy ${why}`).toContain(`\`${why}\``);
    }
    // Spec §5.7: the report outlives the review close; the coordinator
    // cites the reviewer's own path, and step 6 is not changed to say otherwise.
    expect(s6).toContain('kept while the run it reviewed is open');
    expect(s6, 'a copy-before-close instruction is back').not.toContain('copy its report');
    expect(s6).toContain('it stays until a human cleans it up');
    // The two OLD statements are true only of a workspace that is not a child.
    // Appending the paragraph above without limiting them would leave the
    // coordinator reading two contradictory accounts of one final-merge close.
    expect(s6, 'the unlimited "stays until a human archives it" is back')
      .not.toContain('nothing archives it: it stays live and supervised until a human archives it');
    expect(s6, 'the unlimited "nothing else does either" is back').not.toContain('and nothing else does either');
    expect(s6).toContain('A workspace that is not a child — your own, or any workspace dispatch did not mint — is an ordinary unheld, unclaimed row again');
    expect(s6).toContain('Neither notice archives anything, and nothing else touches a workspace that is not a child.');
  });

```

(b) `server/test/worker-skill.test.ts` — directly above *carries no references of its own — the census corpus is the whole skill (D-103)*:

```ts
  // Child reclamation, wave 3 (spec 2026-09-22 §6): NOT a clause — clause 8 is
  // unchanged and the count stays fifteen — but a sentence in the reporting
  // section, because it is the fact a worker needs at the moment it reports.
  it('says, in its reporting section, that this workspace ends when its run closes', () => {
    const at = skill.indexOf('**This workspace ends when its run closes.**');
    expect(at, 'the sentence is gone').toBeGreaterThanOrEqual(0);
    expect(at, 'it moved out of the reporting section').toBeGreaterThan(skill.indexOf('## Reporting a wave-done'));
    expect(at).toBeLessThan(skill.indexOf('## When something is wrong'));
    expect(skill.slice(at).replace(/\s+/g, ' ')).toContain('committed for you as a WIP commit and attic-pinned');
    expect(skill).not.toContain('ws-reclaim');
  });

```

(c) `server/test/reviewer-skill.test.ts` — directly above *names the five destructive verbs ONLY inside the clause that forbids them*:

```ts
  // Child reclamation, wave 3 (spec 2026-09-22 §6): not a clause — the count
  // stays ten — but the reporting section's own fact: this workspace, and the
  // report directory in it, end when the run closes.
  it('says, in its reporting section, that this workspace ends when its run closes', () => {
    const at = skill.indexOf('**This workspace ends when its run closes.**');
    expect(at, 'the sentence is gone').toBeGreaterThanOrEqual(0);
    expect(at, 'it moved out of the reporting section').toBeGreaterThan(skill.indexOf('## Reporting review-done'));
    expect(at).toBeLessThan(skill.indexOf('## When something is wrong'));
    expect(skill.slice(at).replace(/\s+/g, ' ')).toContain('committed for you as a WIP commit and attic-pinned');
    expect(skill).not.toContain('ws-reclaim');
  });

```

(d) Create `server/test/child-reclaim-prose.test.ts`:

```ts
// Child reclamation, wave 3 — the two operator-facing documents that state
// who may remove a workspace (spec 2026-09-22 §6). Both are narrowed, never
// widened: every destructive verb stays forbidden to every session, `ws-reap`
// stays human-only, and the ONE new remover is the server, on a child only.
// The skills' own sentences are pinned in their own census files
// (`coordinator-skill`, `worker-skill`, `reviewer-skill`); these two files
// have no census of their own for this, so they get one here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flat = (f: string): string => readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');

describe('CLAUDE.md’s SAFETY bullet', () => {
  const md = flat('CLAUDE.md');
  it('still forbids all five destructive verbs, and keeps ws-reap human-only', () => {
    expect(md).toContain('All five forbidden; `ws-reap` is **human-only by contract**.');
  });
  it('forbids ws-reclaim to every session, and says whose act it is and on what', () => {
    expect(md).toContain('**`ws-reclaim` is forbidden to every session too**');
    expect(md).toContain('it is the SERVER\'s act on a CHILD workspace only');
    expect(md).toContain('never a session\'s verb, and never run against the live host from a shell or a test');
  });
});

describe('README’s “ws-reap stays human-only” paragraph', () => {
  const readme = flat('README.md');
  it('keeps the human-only rule and narrows it by exactly the server’s child reclaim', () => {
    const at = readme.indexOf('that **`ws-reap` stays human-only, by convention plus a speed bump');
    expect(at, 'the human-only paragraph is gone').toBeGreaterThanOrEqual(0);
    const child = readme.indexOf('**A child is not a reap.**');
    expect(child, 'the narrowing is gone, or it moved away from the rule it narrows').toBeGreaterThan(at);
    const para = readme.slice(child, child + 900);
    expect(para).toContain('`ccd ws-reclaim`');
    expect(para).toContain('the server composes it and no session runs it');
    expect(para).toContain('a coordinator\'s own workspace is still cleaned up by a human');
  });
  it('limits "holds every workspace it owns" to the workspaces that are not children', () => {
    // A close releases every finished child and the server reclaims it with
    // no deliberate release, so the unlimited clause would contradict the
    // narrowing two sentences later.
    expect(readme).toContain('the coordinator holds every non-child workspace it owns so a reap needs a deliberate release first');
    expect(readme).not.toContain('the coordinator holds every workspace it owns');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts \
  test/reviewer-skill.test.ts test/child-reclaim-prose.test.ts)
```

Expected: FAIL. `coordinator-skill`: *carries all fourteen clauses verbatim* (`missing contract clause: This session never reaps. …`) and the §6 case — every EXISTING step-6 pin stays green, because step 6 is not touched (R16); `worker-skill` and `reviewer-skill`: `the sentence is gone`; `child-reclaim-prose`: the two ws-reclaim cases. *never names the child-reclaim verb* is green before and after — it is a ban, and its mutation row proves it live.

- [ ] **Step 3: Coordinator `SKILL.md`**

Leave the paragraph after the contract, "**Reading ccd is fine.**", exactly as it is: it lists `ccd ws-audit --session <id>` as read-only, which stays true — this wave's `--reclaim` form is the server's, and the corpus never names it.

Clause 3 — replace:

```markdown
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason.
```

with:

```markdown
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server when that child’s run closes; this session’s own workspace is cleaned up by a human, never by a sweep.
```

**Step 6 is left exactly as it ships** (contract §7 R16): the reviewer's report is not deleted by the review close — the decision answers `review-report-live` while the reviewed run is open — so step 6's opening, its parenthetical ("its workspace is released by this close" stays true: it IS released), its read and its send-back mail citing `<report path>` are all still correct, and every pin `coordinator-skill.test.ts` holds on them stays green unchanged.

Step 7 — replace:

```markdown
7. **Final merge:** `POST /api/runs/:id/close` with `final:true` closes the run
   and, *if no other open run names this workspace*, releases the hold. Nothing
   archives the workspace on its own after that: the merged sweep only pushes
   a notification, so the workspace stays live and supervised until a human
   archives it. Read `released` in the response: `false`
   means the run closed but the workspace is **still claimed** — another open
   run owns it, which is exactly the state step 6's open-before-close creates.
   The program is not done; close the other run. Do not archive the workspace
   yourself unless the operator asks.
```

with:

```markdown
7. **Final merge:** `POST /api/runs/:id/close` with `final:true` closes the run
   and, *if no other open run names this workspace*, releases the hold. What
   happens to the workspace next depends on whose it is. A **child** — one
   dispatch minted for one of your runs — is reclaimed by the server right
   after the close: the response says `"childReclaim":"queued"`, the act runs
   after the answer, and its outcome is a row in the feed, never a reply to
   you (`references/wave-lifecycle.md` §6). **Your own workspace**, and any
   workspace dispatch did not mint, is not a child: nothing archives it, the
   merged sweep only pushes a notification, and it stays live and supervised
   until a human cleans it up. Read `released` in the response: `false`
   means the run closed but the workspace is **still claimed** — another open
   run owns it, which is exactly the state step 6's open-before-close creates,
   and nothing is reclaimed while it is.
   The program is not done; close the other run. Do not archive the workspace
   yourself unless the operator asks.
```

- [ ] **Step 4: `references/wave-lifecycle.md` §6 — rewritten, not appended to**

Two of §6's sentences become false for every child from this wave on, so they are LIMITED to workspaces that are not children before the new paragraph is added; an appended paragraph alone would leave the coordinator reading two contradictory accounts of one close. First — replace:

```markdown
carries `released`. `released: true` means the claim is gone — this workspace is
an ordinary unheld, unclaimed row again, and nothing archives it: it stays live
and supervised until a human archives it. `released: false` means the
```

with:

```markdown
carries `released`. `released: true` means the claim is gone. A workspace that
is not a child — your own, or any workspace dispatch did not mint — is an
ordinary unheld, unclaimed row again; nothing archives it, and it stays live
and supervised until a human cleans it up. A child is reclaimed instead (below).
`released: false` means the
```

Second — replace:

```markdown
Neither notice archives anything, and nothing else does either. A merged
workspace stays where it is — live, supervised, its PR merged — until a human
archives it, and when a human does, its manifest carries the whole PR lineage.
```

with:

```markdown
Neither notice archives anything, and nothing else touches a workspace that is
not a child. Such a merged workspace stays where it is — live, supervised, its
PR merged — until a human archives it, and when a human does, its manifest
carries the whole PR lineage. A child the close has finished with is the one
exception, and the server's, not yours (below).
```

Then, directly after these two lines:

```markdown
You do not reap, ever (clause 3); cleanup is the operator's ceremony
in the PWA.
```

insert (a blank line first):

```markdown
**A child is reclaimed; your own workspace is not.** A CHILD is a workspace
dispatch minted for one of your runs — the box marks it with the run that
minted it, and the server holds the same run as having minted it; both must
agree, or it is not a child. When a close FINISHES with a child — a `final`
close, an abandon (`state:'failed'`), a close of a child whose branch has had
a PR, or a close that leaves your program with no open run — the server
RELEASES it rather than holding it for a next wave, and the close response
carries `"childReclaim":"queued"`. The reclaim itself runs after the answer,
on the child's own queue: it commits anything left uncommitted on the child's
branch as a WIP commit, pins every commit and stash in the attic, writes a
tombstone, and then removes the pane, the worktree, the branch, the clips
directory and the child's temp directory. Its outcome lands in the feed —
reclaimed, deferred with its reason, refused with its sentence — and never in
a reply to you. A child that another open run still names, or that the
operator is looking at, is deferred and picked up later; nothing you do
speeds it or stops it. Otherwise the response carries
`"childReclaim":"not-queued"` and `childReclaimWhy` says why: `not-a-child`,
`marker-unreadable`, `siblings-open`, `siblings-unreadable`,
`review-report-live` or `not-finished` — the last is the ordinary non-final
close holding a child for wave N+1. **A review run's reviewer is a child
too, but it is kept while the run it reviewed is open**: its clips directory
holds the report you cite by path in every `fix-round` mail, so closing the
review run releases the reviewer and answers `review-report-live`, and the
reviewer is reclaimed only after the run it reviewed has closed. Nothing
changes in how you read or cite the report (SKILL.md step 6). Your own
workspace, and any workspace dispatch did not mint, is never reclaimed — it
stays until a human cleans it up.
```

(`childReclaimWhy`'s six words are this wave's wire, spelled as the server spells them; they are markdown here, so `mail-routes.test.ts`'s kebab scanner — which reads `server/src/coord` only — does not see them.)

- [ ] **Step 5: The worker and the reviewer — a sentence, not a clause**

`ccd/worker-skill/SKILL.md`, "Reporting a wave-done" — directly after these two lines:

```markdown
back, fix the cause, make new commits, and measure again from scratch — never
re-send the old numbers.
```

insert (a blank line first):

```markdown
**This workspace ends when its run closes.** A workspace dispatch minted for a
run is a child, and once the coordinator has finished with it — the last wave,
a wave that opened a PR, an abandon — the server reclaims it: anything not
committed on this branch by then is committed for you as a WIP commit and
attic-pinned, and then the worktree, the branch, the clips directory and this
session's temp directory are removed. Commit what matters on this branch; a
secret-shaped file that lives only in this checkout is never committed and
goes with the tree.
```

`ccd/reviewer-skill/SKILL.md`, "Reporting review-done" — directly after these two lines:

```markdown
Then end your turn. The coordinator closes your run; your workspace is
released with it.
```

insert (a blank line first):

```markdown
**This workspace ends when its run closes.** You are a child the server
minted for this review, so once the coordinator closes your run AND the run
you reviewed has closed, the server reclaims it: anything not committed on
this branch by then is committed for you as a WIP commit and attic-pinned,
and then the worktree, the branch, the clips directory — your report's
directory — and this session's temp directory are removed. Your report stays
where you wrote it for as long as the run you reviewed is open, because the
coordinator cites it by path; you do nothing different.
```

Neither sentence names a `ws-*` verb or a run route (`/close`, `/advance`, `/dispatch`): each skill's *names … ONLY inside the clause that forbids them* cases count every mention in the whole file.

- [ ] **Step 6: `CLAUDE.md` and `README.md`**

`CLAUDE.md`, the SAFETY bullet — directly after these two lines:

```markdown
  (`cmd_ws_archive`'s header in `ccd/ccd`). All five forbidden; `ws-reap` is **human-only by contract**.
```

insert (a blank line first):

```markdown
  **`ws-reclaim` is forbidden to every session too**: it is the SERVER's act on a CHILD workspace only
  (one dispatch minted for a run, marked `$REG/<id>.child` and held by the server as that run's), composed
  after that run closes, with a token re-proved on the box — never a session's verb, and never run against
  the live host from a shell or a test.
```

`README.md`, the "Fleet coordination" paragraph that ends the coordinator's clause discussion. First LIMIT the clause that stops being true of a child — from this wave, a close releases every finished child and the server reclaims it with no deliberate release — replace:

```markdown
coordinator holds every workspace it owns so a reap needs a deliberate
release first, and reap consent stays the PWA's own ceremony either way.
```

with:

```markdown
coordinator holds every non-child workspace it owns so a reap needs a
deliberate release first, and reap consent stays the PWA's own ceremony
either way.
```

Then replace:

```markdown
Nothing server-side makes reap mechanically impossible for a process with a
shell — see "The honest boundary" below for what a contract does and does not
buy.
```

with:

```markdown
Nothing server-side makes reap mechanically impossible for a process with a
shell — see "The honest boundary" below for what a contract does and does not
buy. **A child is not a reap.** Since child reclamation (spec
`docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`) the
server itself removes one kind of workspace: a CHILD — one dispatch minted for
a run, marked `$REG/<id>.child` — once the coordinator has finished with it,
through `ccd ws-reclaim`. That is not `ws-reap` delegated. It is a separate
verb that refuses anything but a child whose marker names the run the server
holds as having minted it, pins every uncommitted change, commit and stash
before it deletes anything, and re-proves its token on the box inside the reap
lock; the server composes it and no session runs it. The coordinator's clause
3 still excludes every reap, and a coordinator's own workspace is still
cleaned up by a human.
```

(README's line numbers do not matter to the citation audit — README's anchors are checked by content wherever they sit, measured while this plan was written by inserting a line at this paragraph: all five S6 cases stayed green.)

- [ ] **Step 7: Run the tests to verify they pass**

```bash
(cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts \
  test/reviewer-skill.test.ts test/child-reclaim-prose.test.ts test/box-token-census.test.ts \
  test/readme-holds.test.ts test/crossrepo-prose.test.ts test/pools-prose.test.ts test/mail-hardening.test.ts \
  test/readme-roster-mirror.test.ts test/topology-clean.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND')
```

Expected: PASS. `box-token-census` and `mail-hardening` read CLAUDE.md and are untouched by this bullet; `topology-clean` scans every blob this range introduces for hostnames and tailnet names, and this prose carries none.

- [ ] **Step 8: Mutation check, then commit**

| # | Edit (one at a time, restore after) | Command | Expected red (measured) |
|---|---|---|---|
| 1 | Revert clause 3 in `SKILL.md` to its old text (leave `CONTRACT[2]` new) | `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t verbatim` | `missing contract clause: This session never reaps. …` |
| 2 | In `wave-lifecycle.md` §6's new paragraph, add the sentence `` `ccd ws-reclaim` reclaims it. `` after the bold lead | `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t 'child-reclaim verb'` | `expected '---\nname: ccrc-coordinator…' not to contain 'ws-reclaim'` |
| 3 | In §6's new paragraph, delete `` `review-report-live`, `` from the `childReclaimWhy` list | `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t 'wave-lifecycle §6'` | `§6 never names childReclaimWhy review-report-live: expected '…' to contain '\`review-report-live\`'` — PREDICTED at planning (the R16 rewrite post-dates the measured set); measure it |
| 3c | In §6's new paragraph, add the sentence `Then copy its report into your own clips directory first.` after `the reviewer is reclaimed only after the run it reviewed has closed.` | same, `-t 'wave-lifecycle §6'` | `a copy-before-close instruction is back: expected '…' not to contain 'copy its report'` — the dropped step-6 change cannot creep back through §6; PREDICTED at planning, measure it |
| 3a | In §6, restore the old sentence `and nothing archives it: it stays live and supervised until a human archives it.` in place of its limited form | `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t 'wave-lifecycle §6'` | `the unlimited "stays until a human archives it" is back: expected '…' not to contain 'nothing archives it: it stays live and supervised until a human archives it'` |
| 3b | In §6, restore `Neither notice archives anything, and nothing else does either.` | same, `-t 'wave-lifecycle §6'` | `the unlimited "nothing else does either" is back: expected '…' not to contain 'and nothing else does either'` |
| 4 | Delete `**This workspace ends when its run closes.** ` from the worker skill | `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts -t 'ends when its run closes'` | `the sentence is gone: expected -1 to be greater than or equal to 0` |
| 5 | In CLAUDE.md's SAFETY bullet, delete the bold lead of the four lines Step 6 added (keep the rest of the sentence, capitalised) | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts` | *forbids ws-reclaim to every session*: `expected '# ccrc The operating console for SDD …' to contain …` |
| 6 | In README, delete `**A child is not a reap.** ` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts` | `the narrowing is gone, or it moved away from the rule it narrows: expected -1 to be greater than …` |
| 7 | In README, delete `non-child ` from `holds every non-child workspace it owns` | same | *limits "holds every workspace it owns"*: `expected '…' to contain 'the coordinator holds every non-child workspace it owns …'` |

Restore everything, re-run Step 7 (green), then:

```bash
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md \
  ccd/worker-skill/SKILL.md ccd/reviewer-skill/SKILL.md CLAUDE.md README.md \
  server/test/coordinator-skill.test.ts server/test/worker-skill.test.ts server/test/reviewer-skill.test.ts \
  server/test/child-reclaim-prose.test.ts
git commit -m "$(cat <<'MSG'
docs(skills): a child is the server's to reclaim; your own workspace is a human's

Coordinator clause 3 keeps its three verbs and gains the fact that a child
it dispatched is reclaimed by the server when that child's run closes, while
its own workspace is cleaned up by a human (the verbatim pin moves with it).
Step 6 is unchanged: a review child is kept while the run it reviewed is
open (review-report-live, contract §7 R16), so the report path it cites
stays valid. Step 7 and wave-lifecycle §6 say what childReclaim and its six
childReclaimWhy words mean.
The worker and reviewer skills gain one non-clause sentence: this workspace
ends when its run closes. CLAUDE.md and README narrow the human-only rule by
exactly the server's child reclaim; no skill names the verb (spec
2026-09-22 §6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: Whole-branch verification, the AGENT-FIRST deploy order, and the PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, unless Step 3's re-measurement moves the citation census (then `server/test/session-hook.test.ts` / `README.md`, committed as their own `docs(census)` commit on this branch).

**Interfaces:**
- Consumes: everything Tasks 1–10 produced.
- Produces: the wave-3 PR and — after it merges — a fleet box advertising `ws-reclaim` and `reclaim-v1` BEFORE any server that composes the verb. Wave 4 consumes `reclaimChild`, `ChildReclaimDeps` (with its optional `now`), `ChildReclaimRequest` (with `deferredSinceMs`, which the sweep passes — R4 — in place of its dropped `child-reclaim-defer-expired` run-event stand-in), `ChildReclaimOutcome`, `ChildReclaimToken`, `CHILD_RECLAIM_TOKEN_KIND`, `RECLAIM_CAP`, the marked place in `childReclaimOutcome` where it adds the `paused-at-server` read (R8), the `review-report-live` condition its sweep eligibility repeats (R16, with R16′'s two edges: an unreadable reviewed row defers `marker-unreadable`, an absent one keeps the child; `ChildReclaimReviewed` and `isChildReclaimTerminalState` are exported for it), the audit's terminal-ONLY refusal journal line whose case list equals `CHILD_RECLAIM_TOKEN_KIND`'s terminal arm (R5′ — wave 4's pre-flight expects exactly that shape, `no-worktree-record` among the six), the fourteenth token `no-worktree-record` and the vanished-worktree reclaim (R19: such a child is reclaimed, never retried, and never an attention item for its absence), the `$REG/reclaim-paused` rung and the `g13` fixture number from this wave; wave 5 consumes the `reclaim` journal act and the feed rows' titles.

- [ ] **Step 1: All three package suites, in the foreground**

```bash
(cd server && npm ci && find test -name '*.test.ts' | wc -l)
(cd server && ./node_modules/.bin/vitest run --shard=1/6)
(cd server && ./node_modules/.bin/vitest run --shard=2/6)
(cd server && ./node_modules/.bin/vitest run --shard=3/6)
(cd server && ./node_modules/.bin/vitest run --shard=4/6)
(cd server && ./node_modules/.bin/vitest run --shard=5/6)
(cd server && ./node_modules/.bin/vitest run --shard=6/6)
(cd agent  && npm ci && npm run test)
(cd pwa    && npm ci && ./node_modules/.bin/tsc --noEmit && npm run test)
(cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
(cd agent  && ./node_modules/.bin/tsc --noEmit -p .)
```

Each command in the FOREGROUND with a timeout of 600000 ms, one after another — never as parallel calls. ONE shard denominator (Global Constraints): the six `Test Files` counts must sum to the `find … | wc -l` printed first; a shortfall is a file no shard ran — find it (`./node_modules/.bin/vitest list --filesOnly --shard=k/6` per shard, diffed against the `find`) and run it by name. Expected: PASS everywhere. `pwa` changed only `journalWords.ts` (Task 1) and must be green. Re-run `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` and `ccd-bounded-reads` IN ISOLATION before calling any of them a real break. The wave-done mail's `suite:` line is `green` only if this FIRST full run was green (worker clause 15).

- [ ] **Step 2: Cross-tree deviation check**

```bash
git fetch origin main && (cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: PASS. It compares this branch's `D-N` definitions against `origin/main`'s without merging, and reds on any allocator-era number defined in two plans.

- [ ] **Step 3: The citation corpus, re-measured on the tree that will merge**

```bash
git merge-base --is-ancestor origin/main HEAD && echo "base is current" || echo "origin/main moved"
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND')
```

If `origin/main` moved and touched `ccd/ccd`, `ccd/ccrc` or `shared/api.ts`, merge it into this branch first (`git merge origin/main`, resolving `ccd/ccd`'s line 2 by RE-STAMPING — never by taking a side), then run the filter. Expected: PASS. If red, apply procedure S6-R11 (README first, by content; then dump and re-measure with the composition named) and commit it as `docs(census): re-measure the citation corpus on the merged tree (S6-R11)`.

- [ ] **Step 4: The wave's own surface, in one run — and the destructive verb, proven against fixture HOMEs only**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts test/ccd-child-reclaim-pin.test.ts \
  test/ccd-child-reclaim-verb.test.ts test/ccd-child-reclaim-audit.test.ts test/child-reclaim.test.ts \
  test/child-reclaim-mail-store.test.ts test/child-reclaim-close.test.ts test/child-reclaim-prose.test.ts \
  test/ccd-ws-reap.test.ts test/ccd-ws-audit.test.ts test/ccd-lifecycle-purge.test.ts test/ccd-refusal-scan.test.ts \
  test/lifecycle-refusal-word.test.ts test/lifecycle-acts.test.ts test/lifecycle-vocabulary.test.ts \
  test/ccd-lifecycle-emit.test.ts test/wsaudit.test.ts test/ccd-archive.test.ts test/capsupported.test.ts \
  test/whitelist-subset.test.ts test/ccdargv-dec-parity.test.ts test/remote-runner.test.ts test/verb-gate.test.ts \
  test/unattended-actor.test.ts test/mail-routes.test.ts test/mail-hardening.test.ts test/single-definition.test.ts \
  test/run-routes.test.ts test/coord-abandon.test.ts test/coordinator-skill.test.ts test/worker-skill.test.ts \
  test/reviewer-skill.test.ts test/ownership.test.ts test/ccd-lifecycle-contain.test.ts test/lifecycle-wire.test.ts \
  test/journalparse.test.ts test/ccd-reg-get-census.test.ts)
(cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist-noghosts.test.ts)
grep -c 'branch -D' ccd/ccd
git diff origin/main -- ccd/ccd | grep '^+' | grep -c -- '--force'
```

Expected: PASS; `grep -c 'branch -D'` prints `1` (`cmd_ws_rm`'s echo, the only line `ccd-ws-reap.test.ts` admits); the `--force` count prints `3` — the two `git … worktree remove --force` calls in `_ws_reclaim_tail` (nested checkouts, then the worktree) and the comment above the second that says why. The vanished-worktree record-clear in step (5) is a `git worktree remove` WITHOUT the flag (a missing directory's record needs none), and its comment never spells it — a fourth hit is a defect. Every one lives in `_ws_reclaim_tail`: `ccd-ws-reap.test.ts` bans the flag from the five reap functions and `cmd_ws_audit`. If `ownership` reds, `ccd/ccd` was edited after its last re-stamp.

Then check, by inspection rather than by trust, that nothing in this branch runs the destructive half against a real `$HOME`:

```bash
grep -L 'makePrHarness' server/test/ccd-child-reclaim-*.test.ts
grep -lE "childReclaimVerb\(|h\.(sh|run)\(.*(cmd_ws_reclaim|_ws_reclaim_tail|_ws_reclaim_pin)" server/test/*.ts
```

Expected: the first prints NOTHING — all four ccd suites build their HOME with `makePrHarness` in `beforeEach`; the second lists only `ccd-child-reclaim-*.test.ts` files and `childReclaimFixture.ts` (whose helpers take that harness as their first argument). The server-side suites (`child-reclaim*.test.ts`, `run-routes`, `coord-abandon`) never reach ccd: their runner is a scripted function behind `testDeps`' whitelist guard.

- [ ] **Step 5: Push and open the PR — this workspace's own branch**

```bash
git log --format='%an <%ae>' origin/main..HEAD | sort -u     # the operator's configured identity, never a placeholder
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Child reclamation wave 3: ws-reclaim, its token, and close's fourth act" --body-file - <<'EOF'
Wave 3 of the child-reclamation programme (spec §5.5–§5.7, §5.9), **AGENT-FIRST** — the programme's only destructive wave. Rule 1, on the close path: when the coordinator has finished with a child, the child is gone, and nothing that was on it is lost.

1. **`ccd ws-reclaim --expect <token> --child-of <run> --session <id>`** — its own verb, its own ladder (ten rungs plus the `no-worktree-record` identity refusal, fourteen tokens and no others), its own tail. Two authorities, equal: the box's `.child` marker and the server's `--child-of`, compared on the fresh AND the resumed arm, with no override anywhere. The pin phase runs before anything is destroyed: a WIP commit that never stages a secret-shaped path (`_ws_wip_commit`, the only `git commit` in ccd, hooks off, `--no-verify`), attic pins of every commit, stash and in-progress operation head, a tombstone. The tail unsupervises and kills the ANCHORED pane first on every arm, re-pins once the writer is dead, then removes same-repository nested checkouts, the worktree, the branch (CAS), the clips and `~/.cc-tmp/<id>` (id re-check + `pwd -P` direct-child equality), measures the residue, and purges the registry row last. A nested checkout of ANOTHER repository that is dirty or unpushed refuses `containment-unproven`; a directory git does not record as the project's worktree refuses `no-worktree-record`, terminally; a child whose worktree has VANISHED is reclaimed from what is left (its branch tip, its stashes and git's recorded HEAD pinned, `worktree: absent` in the tombstone, the tail from the branch on — unit and pane still first), never retried for ever. `reclaim:` breadcrumbs resume only as reclaims; `ws-reap` gains exactly one mirror refusal.
2. **`ws-audit --reclaim [--defer-expired]`** mints the token (the plain audit is byte-identical), journals a TERMINAL refusal it finds (its list equal to the server's terminal arm, by test) and answers an unmeasured ladder with `"verdict":"unmeasured"` at exit 1; `reclaim-v1` advertises the pair.
3. **The grant** — `['ws-reclaim','--expect']`, enrolled in `REQUIRED_VERB_FLAG` (negative fixture `g13`); `ws-reclaim` gets `ws-reap`'s 240 s remote budget.
4. **`reclaimChild`** — THE ONE EXECUTOR both triggers use: re-reads the marker against the run (an `absent` row re-listed once before it is called gone), the open siblings, presence and `reclaim-v1` (`capSupported`: refuse on no evidence), then audit → token → verb; cancels the child's outstanding deliveries on success, and on a row it measures gone (`cancelDeliveriesTo`, a deliberate park); exactly one feed row per outcome except `gone`, which for a deferral and for a ceiling-expired attempt states how long the child waited and why (`ChildReclaimRequest.deferredSinceMs`, `null` from close).
5. **Close decides, it does not wait** — inside the mutex it reads both authorities and asks `childReclaimDecision` (child ∧ no open sibling ∧ not a review child whose reviewed run is open ∧ (final ∨ spent ∨ abandon ∨ retiring the program — D-51's one query with this run set aside)); an eligible child is RELEASED, never held and never archived (an archive request on it is overruled), and its reclaim is handed to the session's own queue after the commit. A review close releases the reviewer and keeps it (`review-report-live`) while the run it reviewed is open, so the report the coordinator cites by path survives every fix round. `childReclaim` / `childReclaimWhy` are additive on the close response.
6. **Prose** — coordinator clause 3 (the verbatim pin moves), step 7, wave-lifecycle §6 (step 6 is unchanged), the worker and reviewer non-clause sentence, CLAUDE.md SAFETY and README.

Built to the programme contract's rulings of 2026-09-23 (§7: R1, R2, R4, R5, R8–R14, R16, R17; §8: R5′, R8′, R9′, R11′, R16′, R19, R23) — `docs/superpowers/programs/child-reclamation-contract.md`.

**Deploy order is not optional.** After merge, the release lane cuts a prerelease; move the fleet with `ccrc rollout --to <that tag>` WITHOUT `--server-first` — its default moves the fleet box first. A server that lands first defers every child as `unsupported` and destroys nothing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 6: Deploy — after merge, fleet box FIRST (run by the session the coordinator names)**

A merge to `main` becomes a GitHub PRERELEASE within about a minute (`release-main.yml`); a bare `ccrc rollout` pins the newest STABLE, so a dev build is `rollout --to`. From a machine with ssh to both boxes, with `~/.ccrc/deploy.env` supplying `CCRC_BOX`, `CCRC_AGENT_BOX`, `CCRC_SSH_KEY` and `CCRC_SSH_PORT`:

```bash
MERGED=$(gh pr view --json mergeCommit --jq .mergeCommit.oid)
git fetch origin --tags
TAG=$(git tag --points-at "$MERGED" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
test -n "$TAG" || { echo "no release tag on $MERGED yet — wait for release-main.yml, then re-run"; exit 1; }
ccrc rollout --to "$TAG" --check      # preflight: each box's CCRC_ROLE, the pinned version, what would move
ccrc rollout --to "$TAG"              # DEFAULT ORDER: fleet box, then server box — never --server-first here
set -a; . ~/.ccrc/deploy.env; set +a
ssh -i "$CCRC_SSH_KEY" -p "$CCRC_SSH_PORT" "$CCRC_AGENT_BOX" '~/.local/bin/ccd caps' | grep -x -e ws-reclaim -e reclaim-v1
```

Expected: `--check` names both boxes and `$TAG`; the rollout moves the fleet box, then the server box, and exits 0 (exit 3 means a box is ON the new build with FAIL doctor lines — report them, do not re-run); the `grep` prints `ws-reclaim` and `reclaim-v1`. If either is missing, the fleet half did not land: **stop, report, and move nothing further.** `ccd caps` is read-only; NOTHING in this step runs `ws-audit --reclaim` or `ws-reclaim` against the live host — the first live reclaim is the server's, on the next close of a finished child.

- [ ] **Step 6b: Measure what spec §8 says wave 3 is measured by — read-only, at the first live reclaim**

Spec §8's row for this wave: *a child is gone after its final close, its temp root with it, its work in the attic*. No test in this plan runs close → executor → real `ccd` end to end (the route tests stop at `unsupported`; the ccd suites call the verb directly), so the measurement is taken on the fleet, once, at the first close that answers `"childReclaim":"queued"` after Step 6's rollout. Nothing here writes, deletes or runs a verb: existence checks with `ls` and `test`, refs with `git for-each-ref`, and two named keys of the tombstone — never a secret file's contents.

First read the feed row for the child in the PWA's feed: the executor writes exactly one per outcome, and the success title is `child reclaimed`. Then, from a machine with ssh to the fleet box:

```bash
ID=<the child's session id, from the close response's run row>
PROJECT=<its project>
set -a; . ~/.ccrc/deploy.env; set +a
ssh -i "$CCRC_SSH_KEY" -p "$CCRC_SSH_PORT" "$CCRC_AGENT_BOX" bash -s -- "$ID" "$PROJECT" <<'REMOTE'
id="$1"; project="$2"
ls -d "$HOME/.cc-sessions/.reaped/$id.json" && echo "tombstone: present"
test -e "$HOME/.cc-tmp/$id" && echo "temp root: STILL THERE" || echo "temp root: gone"
test -e "$HOME/.cc-sessions/$id.uuid" && echo "registry row: STILL THERE" || echo "registry row: gone"
wt=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("workdir") or "")' "$HOME/.cc-sessions/.reaped/$id.json")
test -n "$wt" && { test -e "$wt" && echo "worktree: STILL THERE" || echo "worktree: gone"; }
for k in wip tip; do
  sha=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2]) or "")' "$HOME/.cc-sessions/.reaped/$id.json" "$k")
  if [ -z "$sha" ]; then echo "$k: none recorded"
  else git -C "$HOME/projects/$project" for-each-ref --format='%(refname)' "refs/ccrc/attic/$id/$sha" | grep -q . \
         && echo "$k $sha: in the attic" || echo "$k $sha: NOT IN THE ATTIC"; fi
done
REMOTE
```

(`$HOME/projects` is `ccd`'s own `PROJECTS_ROOT` default.) Expected: one `child reclaimed` feed row for `$ID`; `tombstone: present`; the temp root, the registry row and the worktree `gone`; `wip` either `none recorded` (a clean child) or `in the attic`, and `tip … in the attic`. Any `STILL THERE` or `NOT IN THE ATTIC` is a wave-3 defect: **report it and stop — do not clean anything up by hand.** If no close has queued a reclaim by the time the report is due, say so in the report; the measurement is then owed, not skipped.

- [ ] **Step 7: Report**

The wave-done mail to the coordinator, opening with the two signal lines (worker clause 15), then: the branch tip sha; each suite's result, the shard set and the file-count sum against the `find` total; `ccd caps`' two lines from the fleet box (when Step 6 ran); the deploy order actually executed; Step 6b's measurement (each line it printed, or "owed — no close has queued a reclaim yet"); every S6-R11 composition paragraph this wave wrote (Tasks 1–5, and Step 3 if it moved); the bypass fixture number used (`g13` unless a later programme took it); and **every departure from this plan**, each named by slug for the coordinator to number (never a number the worker chose — a session that cannot reach the coordinator writes `D-TBD-<slug>` and says so).

**No question is left for the coordinator to rule on.** Every one the drafting rounds raised is SETTLED by the contract's §7 and §8 rulings of 2026-09-23 and BUILT above, so none is re-asked in the mail and none is numbered as a departure:

- the review report and the reviewer's clips — R16: a review child is kept (`review-report-live`) while the run it reviewed is open; coordinator step 6 is unchanged (Tasks 8–10); and R16′'s two edges — an unreadable reviewed-run row defers `marker-unreadable`, a reviewed run absent from the database keeps the child, `review-report-live` (Tasks 8, 9);
- an archive request on an eligible child — R17: overruled, released and reclaimed (Task 9, `child-archive-overruled` is the contract's name for the ruled behaviour, not a departure);
- the answers outside the fourteen tokens — R11: the `failed` documents `probe-unmeasured`, `pin-failed` and `unit-still-active`, and `tree-unreadable` meaning ONLY unreadable after the permission pass, so a registry row that does not say what the child is, and an unreadable tombstone on resume, answer `probe-unmeasured` (Tasks 2, 4, 5); and R11′: the audit's own unmeasured answer is its reclaim document with `"verdict":"unmeasured"` at exit 1, which the executor — reading ANY audit exit 1 as `failed` — maps to the `failed` outcome (Tasks 5, 8);
- a child whose worktree has vanished, and a directory git does not record — R19: the first is reclaimed without a worktree (branch tip, stashes and git's recorded HEAD pinned; tombstone `worktree: absent`; the tail from the branch CAS on, with unit and pane still first — spec §5.6), the second answers `no-worktree-record`, TERMINAL, the fourteenth token (Tasks 2–5, 8);
- the audit's refusal journal line — R5′ (amending R5): TERMINAL refusals only, its case list EQUAL to `CHILD_RECLAIM_TOKEN_KIND`'s terminal arm, pinned by a test that derives the arm from the map (Tasks 5, 8);
- the run-id grammar — R2: one grammar, checked in ccd only through `_child_runid_valid` (Tasks 2, 4); on the server wave 2 bounds it at ten ASCII digits through `CHILD_RUN_ID`, and this wave's one server-side run-id read, the audit's `childOf`, uses that same constant (Task 8) — nothing about the bound is owed to the coordinator;
- the frozen citation boundary — R9′: `ccd/ccd:19131`, bare `:<n>` anchors included, by the grep in Global Constraints;
- the temp-root leaf — R1: unlinked with `rm -f --`, never followed, never `-rf` (Task 4);
- the elapsed defer time — R4: `ChildReclaimRequest.deferredSinceMs`, rendered by the executor's feed row (Tasks 8, 9).

What the mail DOES carry beyond the fingerprint is measurement: the received red of every mutation row this plan marks PREDICTED (Task 2 rows 8a–8i, Task 4 rows 12a–12c and 16–22, Task 5 rows 7a–7c, Task 8 rows 7c, 7d, 17 and 19–30b, Task 9 rows 13 and 14, Task 10 rows 3 and 3c, and the rest so marked), each beside its row number.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's coordinator allocated ONE block at run-open, and every wave draws from it; a worker never calls the allocator (worker clause 11). A departure from this plan found while executing it is named by a short slug in the wave-done mail, and the coordinator assigns it a number from the block and defines it here — number and definition in one act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and says why. No block is written as a range, and no headroom count lives in this file.

- **D-3352** (Task 1: `fifth-cardinal-toHaveLength-24`) — Task 1 and spec §6 name four act-count cardinals, seven edits and 24→25 twice. The tree held a fifth: `server/test/lifecycle-acts.test.ts`'s reader-side-degrade case, `expect(LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN)).toHaveLength(24)`, a shape neither of Step 0's two greps can match. It went red on its own once Step 4's declarations landed (`expected … to have a length of 24 but got 25`), and moved 24→25 in the same file and commit (3d827368): five cardinals, eight edits, 24→25 three times. Nothing downstream relies on the count of four. Numbered by the coordinator (mail 2421).
- **D-3353** (Task 2: `a10-before-the-vanished-fork`, `a10-helper-returns-globals`, `unmeasured-comment-tripped-harvest`, `rung2-marker-read-drops-rc-branch`, `nonpoison-pin-is-corpus-quoted`, `no-d-number-in-new-text`, `p2-details-per-cause`, and two fix-round refusals) — shipped at 3b924a14, with fix rounds 63a821a8 and a51be4f6. (1) A10's shared-workdir check sits directly BEFORE the vanished-worktree fork, not after it beside A3, so it guards the absent arm too: that arm's tail still clears git's record at the path, and the record may be the other row's. A case pins it. (2) A helper the task did not list, `_ws_reclaim_workdir_shared`, answers through `_WS_SHARED_ROWS` and `_WS_SHARED_WHY`, so a listing that failed keeps its reason, which stdout through a subshell would lose. (3) The prescribed `_ws_reclaim_unmeasured` comment quoted the verdict object literally; `wsaudit.test.ts`'s harvest reads comments too and counted a fifteenth token, so the comment says "the verdict `unmeasured`". (4) Rung 2's marker read drops the prescribed `|| mark=""` on both arms: `ccd-crosspool.test.ts` enumerates every `_reg_get` rc reader, and the fallback added no distinction, since a failed read prints nothing and `_child_runid_valid` refuses the empty string. (5) `ccd-wsaudit-nonpoison.test.ts`, which the task did not name, went 55→60 on the five new words. Its `:78` is quoted byte for byte by the frozen compaction-card corpus, so the case now reads the file with the RECLAIM region cut out, through a hoisted `withoutReclaim` below `:78`, which keeps `:78` byte-identical at 55. Below it, the case pins the whole file at 60 and the set difference at exactly those five words. (6) Two prescribed comments that cited a deviation number point at the measured case instead (`cmd_win_size` in ccd, `ccd-win-size.test.ts` in the test). (7) `containment-unproven`'s sentence names every cause (a foreign nested checkout, a workdir of another repository, a symlinked workdir, a shared workdir), and each ccd detail names only the cause that fired. The fix rounds added two refusals the plan does not prescribe. A workdir the registry spells as anything but one plain absolute path (a trailing `/`, a `.` or `..` component, a `//`, or a relative path) answers the terminal `containment-unproven`, decided where the row is read, before rung 5. It refuses rather than normalises, because Task 4 re-reads `.workdir`. A workdir equal to the main checkout, literally or once resolved, answers `not-a-workspace`. Numbered by the coordinator (mail 2421).
- **D-3354** (Task 3: eighteen slugs) — shipped at 1b14b223, with fix rounds d8443195, cf85d2e7 and 9ea07a35. `plain-path-helper-shared-with-pin`: the ladder's plain-path predicate is the helper `_ws_reclaim_plain_path`, called by the ladder and by the pin, because the settle re-pin also runs on the resumed arm, which has no ladder. `pin-nested-common-dir-fails-shut`: a nested checkout whose repository cannot be resolved fails the pin. The prescribed `|| continue` read that failure as "another repository", which would have left the checkout out of the pin and out of the tail's list, for the forced tree removal to delete. `pin-guard-order-and-messages`: the pin's one `-d` guard is plain path, then `! -L`, then `-d`, each with its own reason, so a link never reads as gone. `patch-reads-stdin-as-bytes`: `_ws_tombstone_patch` decodes its stdin bytes as UTF-8 instead of relying on a `C.UTF-8` locale, which not every macOS runner has. `literal-pathspec-case-added`: a fifth case, with its mutation row, because without `GIT_LITERAL_PATHSPECS=1` a file named `[.]env` stages `.env`. `a3-link-case-swaps-after-the-ladder`: the A3 case runs the ladder over the real tree, swaps the directory for a link, then pins, because the ladder already refuses the link. `wip-excludes-staged-and-tracked-secrets`: the WIP's candidates are every path that differs from HEAD, each passed through the secret classifier; `_ws_wip_commit` takes a `prefix` argument and no longer reads `RECLAIM_STAGE`. `pin-phase-contained`: a new `_ws_reclaim_contained`, with `_ws_reclaim_pin` a wrapper around `_ws_reclaim_pin_contained`. `foreign-predicate-one-helper`: rung 9's clean-and-pushed predicate is `_ws_reclaim_foreign_clean`, shared by the ladder and the pin. `head-check-against-handed-branch`: the pin's HEAD check compares against the ladder's `REAP_BRANCH` (git's record, under drift), not the registry's field, which would fail every drifted child and name a branch whose tip was not pinned — superseded by D-3367: the final fix round deletes the REGISTRY's branch and keeps a drifted one instead (`branch="$regbranch"` on the fresh arm, `_ws_reclaim_eval`, c5962a94:ccd/ccd:24107, and on the vanished arm, `_ws_reclaim_eval_absent`, c5962a94:ccd/ccd:24224), where the old behaviour deleted the DRIFTED branch and failed `pin-failed` only if HEAD moved after the ladder. `nested-reflog-pin-redundant`: a nested HEAD-reflog walk was added, measured redundant and removed; on git 2.43, `reflog show --all` from any worktree lists every worktree's HEAD reflog. `pin-prepass`: nested checkouts are proven in a pre-pass and committed in a second pass, so a failing pin commits nothing. `wip-index-is-a-copy`: the scratch index is a copy of the user's, with its staged secret-shaped entries reset to HEAD in the copy, superseding round 1's `read-tree HEAD` seed. `unmerged-paths-take-the-worktree-version`: an unmerged path enters the WIP as its working-tree version, because a copied index carries unmerged stages that would fail the pin for ever on a child in mid-conflict. `pin-reads-take-no-optional-locks`: `GIT_OPTIONAL_LOCKS=0` under `_ws_reclaim_contained`, so `status` never rewrites the user's index. `index-check-in-wip-commit`: the locked-or-missing-index check runs per tree in `_ws_wip_commit`. A nested WIP made before the child's own index is found locked is a complete commit of that tree, and the pin is idempotent on retry — superseded by D-3367: the lock check moved to rung 6, which asks only the CHILD's own index (`tree-busy`, deferrable via `--defer-expired`); `_ws_reclaim_index_src` no longer checks a lock at all, for the child's tree or any nested checkout, so a nested checkout's held `index.lock` is now checked nowhere. `status-no-renames`: the copy's `status` runs with `--no-renames`, and the `R?|C?` arm is gone, because an intent-to-add file matching a deleted one read as a rename no arm handled. `unknown-status-code-fails`: a status code outside the enumerated list fails the pin instead of being skipped. Numbered by the coordinator (mail 2421).
- **D-3355** (Task 4: the MIRROR block, `gone-line-without-record-keeps-branch`, `main-line-kept-on-every-arm`, `absent-covers-residue`, and five tail departures from its fix rounds) — shipped at 74b6880e, with fix rounds 33794c06, ce802920, af4fce0d and 890d99d1. (1) Ws-reap's `reclaim-in-progress` refusal literal and its prose live in `_ws_reclaim_mirror`, in their own `MIRROR-BEGIN`…`MIRROR-END` block directly below `RECLAIM-END`; `_ws_reap_locked` carries one line, the call and a pointer, where the plan put a five-line block. Outside both blocks the literal would move `ccd-wsaudit-nonpoison.test.ts:78`, which the frozen corpus quotes, and inside the region it would give Task 8's harvest a fifteenth word, since `reclaim-in-progress` is ws-reap's answer and not ws-reclaim's. `withoutReclaim` now cuts both blocks. (2) On a nested line whose tree is gone and where git records no checkout at its path, nothing proves the branch is that line's, so the branch is KEPT, recorded in `keptBranches`, and the act continues; a record there on a different branch fails `worktree-remove-failed`. The cost: a crash between a nested record's clear and its branch CAS leaves that branch kept on resume, which is a recorded leak and never a loss. (3) The main-line rung applies to every nested line, not only to gone ones. `$main`'s HEAD branch or `origin/HEAD`'s is kept, and either one unreadable keeps it too. (4) `_ws_reclaim_residue` reads absence through `_ws_reclaim_absent` (gone only on ENOENT under a searchable parent, standing, or unmeasured), and an unmeasured answer gives `null`, where a bare `-e` had reported a measured `0` on EACCES. (5) The tail reads workdir, project and branch from the TOMBSTONE, not the registry, and re-proves ownership on every arm, so a `.workdir` repointed before a resume cannot remove a sibling worktree. (6) A nested checkout's containment is proven component by component, not by string prefix and a leaf-only link test, which had let a swapped ancestor directory remove another worktree with `--force` on the fresh arm. (7) A resume at `children` whose tree is gone continues like the vanished arm, for lines proven inside it only; before this it could never finish. (8) A gone line's head is pinned under `refs/ccrc/attic/<id>/` by the pin phase's own helper before its CAS, and a pin that cannot be taken fails `pin-failed` and deletes nothing further. (9) Accepted, not fixed: a swap made inside the `git worktree remove --force` call itself, a TOCTOU residue under the fleet's single-user trust. Numbered by the coordinator (mail 2421).
- **D-3356** (Task 5: `audit-breadcrumb-unreadable-rung`, `mirror-order-note`, `prose-literal-verdict-unmeasured-avoided`, the `_json_str` verdict spelling, and the shared fork helper) — shipped at 791d2256, with fix rounds 35d6d510, c132626c and d08e2323. (1) `ws-audit --reclaim` answers `probe-unmeasured` for a breadcrumb that stands but reads empty (a directory, a link, a file this uid cannot read), first in its chain as in `_ws_reclaim_locked`. The prescribed three-case dispatch would have read it as no breadcrumb and handed a fresh token for a child another act was already tearing down. (2) The audit's prose sits last inside the RECLAIM region, directly above its end marker. "Below Task 4's mirror block" no longer holds, because that block moved below the region (D-3355). This is comment placement only. (3) The prescribed prose quoted the verdict object literally, which `wsaudit.test.ts`'s whole-file harvest counts, so the sentence names the shape with an ellipsis. (4) The verdict literals are spelled through `_json_str`, which keeps `ccd-wsaudit-nonpoison.test.ts`'s corpus-quoted pin at 55; the literal spelling had moved it (fixed at d08e2323). (5) One flavour-fork helper, `_ws_reclaim_fork`, is shared by the verb and the audit, where the plan prescribed a copy in the audit. Numbered by the coordinator (mail 2421).
- **D-3357** (Task 6: `ws-reclaim-needs-expect-renamed`) — the type fixture Step 1(c) prescribed as `ReclaimNeedsExpect` is `WsReclaimNeedsExpect` (`agent/test/types/ok/legit-whitelist.ts`, 615e0255). A bare `Reclaim*` identifier falls outside the wave's four naming exceptions (`RECLAIM_CAP`, `CCD_ARGV.wsReclaimAudit`, `CCD_ARGV.wsReclaim`, `g13-ws-reclaim-without-expect.ts`). Numbered by the coordinator (mail 2421).
- **D-3358** (Task 7: `single-definition-diffstat`) — Step 6 says four lines change and none is added (`4 insertions(+), 4 deletions(-)`). Widening `MEMBERS` to four members forces `LIST`'s quantifier from `{1,2}` to `{1,3}`, so `server/test/single-definition.test.ts`'s diff is 5/5 (967b8fa7). No line is added, so the file's line numbers and its citations hold. Numbered by the coordinator (mail 2421).
- **D-3359** (Task 7b: `wide-window-pin-extended`, `bind-port-positional`, `birth-helper-in-childSpent`, `strict-createdAt-shape`, `moved-history-refs`) — shipped at f71a93d0. (1) `ccd-pr-state.test.ts`'s "does not put the rollup in the wide window" `toContain`, which A1 says stays unchanged, is extended to `…isDraft,createdAt`, so its "in order and entire" comment stays true; A1's "drop createdAt" mutation row therefore reds three pins, not two. (2) The consumer-declared port is a required positional parameter, `childBindGate(deps, runs, sessionId)`, not a `ChildSpentDeps` field: both doors already hold `coord`, and a required parameter cannot be forgotten. (3) `childBirthOf` and `ChildBirthRunRead` live in `childSpent.ts`, so the bind and Task 9's close share one derivation of the birth; the port interface stays in `childBind.ts`. (4) A `createdAt` places a row only as gh's ISO-8601 instant with its zone (`GH_INSTANT`), and anything else is `unplaced`: `Date.parse` reads a bare date as UTC midnight and a zone-less time as server-local, hours past the ±120 s skew. (5) The live rung's code and paragraph moved from `childSpent` into `childSpentLive` with their existing history references; the diff's `-` and `+` sets of those tokens are equal, and no new number was written. Numbered by the coordinator (mail 2421).
- **D-3360** (Task 8: `r5-list-outside-region`, the `childReclaimRowListing` shape, the `wip` shape, the audit parser's id check, `resumable`) — shipped at 4dd66dcb, with fix rounds 5a7c51f9 and 549545c7. (1) `cmd_ws_audit`'s terminal-refusal case list lies above `RECLAIM-BEGIN`, outside the region the notes said to read it from, so R5′'s pin runs its anchored regex over the whole file and asserts exactly one match (`matchAll` with `toHaveLength(1)`). (2) `childReclaimRowListing` returns `{kind:'listed', uuid, child} | {kind:'unlistable'}` instead of one word that folded `.uuid` and `.child` together, with five unit rows (unlistable, neither, `.uuid` only, `.child` only, both). (3) A `wip` reads only as 40 or 64 lowercase hex (`WIP_SHAPE`), and any other shape is `unreadable`, with its own feed sentence. (4) `parseChildReclaimAudit` takes the session id and answers `unreadable` on a document naming another id, as `parseChildReclaimResult` does. (5) A `failed` outcome carries `resumable: boolean` in place of `stage: 'audit'|'verb'`: an audit failure is never resumable, a `failed` document or a cut-short verb call is, and a verb answer naming another session or an unrecognised refusal word is not. Numbered by the coordinator (mail 2421).
- **D-3361** (Task 9: `a6-second-not-third-caller`, `pr-open-fixture-real-clock`, code before tests) — shipped at 0ce3dc27, with fix round a0c943c6. (1) `childReclaimRowListing`'s docstring names close as its SECOND caller, not A6's "third": the tree has two production callers, the executor's gone-check and close, and wave 2's `childBindGate` is a parallel reader, as Task 8 shipped and its reviewer accepted. (2) `run-routes.test.ts`'s `PR_OPEN` fixture uses the real clock (`Date.now()` plus a 1 h margin), not P8's fixed clock, because its birth is stamped by a genuine dispatch through the real route; the departure is declared in place in that fixture's docstring. (3) The close code was written before its tests. This is disclosed in the report, and the task's mutation table stands in for red-first. Numbered by the coordinator (mail 2421).
- **D-3362** (Task 10: `row-3-predicted-red-not-reproduced`) — mutation row 3, predicted at planning, deletes `review-report-live` from §6's `childReclaimWhy` list and stays green, because the shipped §6 paragraph names that word again in the review-child sentence R16 requires, and the case asserted presence in §6's flattened text. Resolved in the fix round (07e8d552): §6's list is pinned by set equality against `ChildReclaimNotWhy`. Numbered by the coordinator (mail 2421).
- **D-3363** (Task 10b: `mirror-row-six-lines`, `doctor-test-comment-accuracy`) — shipped at 75fec111. (1) `single-definition.test.ts`'s scratch-slug mirror row grows by a net 6 lines (9 insertions, 3 deletions) rather than 0. The infix cannot share the four prefixes' strip-trailing-`*` transform, so it has its own declared-list extraction, mirroring the first. No citation moved; the highest cited anchor in that file is `:1303`. (2) `server/test/ccrc-doctor.test.ts`'s guard header now says four prefixes plus one infix, a net +1 comment line in a file with no line-count claim on it. Numbered by the coordinator (mail 2421).
- **D-3364** (merge 8837a200: `force-grep-four-not-three`, `stamp-placeholder-duplicate`) — (1) Task 11 Step 4's `git diff origin/main -- ccd/ccd | grep '^+' | grep -c -- '--force'` prints 4, not the plan's 3. The fourth hit is a reviewed prose sentence in `_ws_reclaim_nested_proven`, added by Task 4's first fix round as the remedy for its C1 (D-3355). (2) The merge's first re-stamp of `ccd/ccd` left a placeholder `markGenerated` did not recognise and inserted a second marker line. `ownership.test.ts` caught it, and it was fixed by deleting both stamp lines and re-stamping once, amending the merge before it was reported or pushed; no pushed commit carries it. Numbered by the coordinator (mail 2421).
- **D-3365** (final fix: `wip-moves-no-ref`) — spec §5.5 step 2 says "one WIP commit on the child's own branch". The WIP is built with `git commit-tree`, pinned by sha under `refs/ccrc/attic/<id>/`, and moves no branch and no HEAD; the tombstone's `tip` is the branch's own tip, not the WIP (`_ws_wip_commit` and `_ws_reclaim_pin_contained`, cd546eeb). This closes the final review's C2 and M10, and a kept branch never receives a WIP commit. Ruled ACCEPTED: the WIP is pinned, so "pin everything" holds, and moving no ref is strictly safer. The spec text follows later. Numbered by the coordinator (mail 2421).
- **D-3366** (final fix: `child-gitdir-proof-before-rung-6`) — the proof that the child's own git dir is its record is asked in `_ws_reclaim_eval` directly after the not-the-main-checkout check, before rung 6, rather than in rung 9, where the nested checkouts' proof stays (cd546eeb). The child's proof guards everything after it, and rung 6's own probes read that tree's git dir. Effect: a child with a foreign git dir AND an operation in progress answers the terminal `containment-unproven`, not `tree-busy`. Numbered by the coordinator (mail 2421).
- **D-3367** (final fix `cd546eeb`: three unledgered departures, bundled — review 170 F8) — the final fix round's commit `cd546eeb` made three departures no number covered, each ruled sound. (1) **Branch under drift.** The plan's `branch="${wthead:-$regbranch}"` ("$wthead is the branch reclaimed", plan:1209-1212, :1323-1326) became `branch="$regbranch"` on the fresh arm (`_ws_reclaim_eval`, c5962a94:ccd/ccd:24107) and on the vanished-worktree arm (`_ws_reclaim_eval_absent`, c5962a94:ccd/ccd:24224) — NOT `_ws_reclaim_resume_eval`, which never calls the main-line predicate and sets `REAP_BRANCH` from the tombstone instead. Before this, drift was never a pin failure: the plan deleted the DRIFTED branch (git's record, `$wthead`) and left the registry's `$regbranch` alone; `pin-failed` fired only when HEAD had moved off `REAP_BRANCH` by pin time (`cd546eeb^`'s `[[ "$headref" == "refs/heads/$branch" ]] || { RECLAIM_PIN_WHY=…; return 1; }`). Now the REGISTRY's branch is the one deleted and the drifted one is kept: on the fresh arm the pin re-reads HEAD and records the kept branch in `RECLAIM_KEPT`; on the vanished arm the ladder itself records it (c5962a94:ccd/ccd:24228), because that arm's pin reads no HEAD. `_ws_tombstone`'s comment (c5962a94:ccd/ccd:13333-13339) is now INVERTED in the drift case, not true of it: the comment still calls `branch`/`REAP_BRANCH` git's own worktree record (as opposed to the registry's), and warns that recording the registry's name there would name a branch not deleted; after `cd546eeb`, `REAP_BRANCH` IS the registry's field, and the registry's branch is the one deleted, while git's record (`$wthead`) is the one kept — every clause of the comment's reasoning is backwards for the drift case. The comment is left unedited because the F8 ruling is no code change; the controller reports the stale comment to the coordinator. (2) **Index lock moved, and narrowed to the child's own tree.** Rung 6 (`_ws_reclaim_eval`, c5962a94:ccd/ccd:24092-24100) now refuses `tree-busy` on the CHILD'S OWN held `index.lock`, inside `if (( ! defer )); then`, so `--defer-expired` passes it; `_ws_reclaim_index_src` (c5962a94:ccd/ccd:24338-24352) — called by `_ws_wip_commit` for the child's own tree AND for every nested checkout — no longer checks a lock at all (it did, per tree, nested checkouts included, at `cd546eeb^`). So a NESTED checkout's held `index.lock` is now checked NOWHERE; only the child's own is asked, at rung 6. (3) **Main-line refusal on the child's own branch.** `_ws_reclaim_main_line_refuse` (c5962a94:ccd/ccd:23880-23887) is called on the ladder's fresh arm (`_ws_reclaim_eval`, :24119) and on the vanished-worktree arm (`_ws_reclaim_eval_absent`, :24236). A RESUMED reclaim's main-line check is the TAIL's step (5) alone: it asks the same predicate inline through `_ws_reclaim_main_branch` (c5962a94:ccd/ccd:25240-25244) before its CAS; `_ws_reclaim_resume_eval` calls neither helper. D-3355(3) covers only a NESTED line's main-line rung; this is the child's OWN branch. All three are the safer direction — nothing is deleted that is not first proven the child's own, and a branch or index that cannot be proven safe to touch is kept or deferred rather than destroyed or wedged. Numbered by the coordinator (review 170 rulings).
- **D-3513** (review 170 F1: `session-probe-anchor-two-lines`, `tail-pane-remeasure`, `unit-still-active-names-the-pane`, `child-stubs-tmux-model`) — the plan prescribed rung 5 as a bare `if tmux has-session -t "=$(_tmux "$id")" 2>/dev/null; then …; fi` with no else arm (plan:1157), and the tail's pane kill as `tmux kill-session … 2>/dev/null || true` (plan:2692), after which the tail re-measured the unit alone. Both read "tmux could not be asked" as "no session". MEASURED red first on this branch, before the fix: with the test's tmux answering `error connecting to … (Permission denied)` at exit 1, `ws-audit --reclaim` minted a token and `cmd_ws_reclaim` removed the worktree; with the same fault arising between the ladder and the tail, the tail removed it too. What ships: (1) `_session_probe` takes an optional second argument that anchors its target, `-t "${2:+=}$(_tmux "$1")"`, edited in place on BOTH of its target lines (the function-stub branch and the `_plat_timeout` branch) — two lines, not the ruling's one, because the target is spelt twice; line-neutral, no line or comment added above the frozen boundary, and every existing caller passes one argument and is unchanged. The frozen corpus quotes neither line; the five S6-R11 cases are green at the base and at the tree. (2) Rung 5 in `_ws_reclaim_eval` asks `_session_probe "$id" anchored`: `gone` (`can't find session`) passes, `live` runs the existing attached-client check, and `unknown` answers `_ws_reclaim_unmeasured` with tmux's own words — `probe-unmeasured` at exit 1 from the verb, the verdict `unmeasured` at exit 1 from the audit, which the server already reads as `failed`, `resumable:false` (no server change). (3) `_ws_reclaim_tail` keeps its anchored kill's own exit status and, after the unit's re-measure and before the first deletion, re-measures the pane through the same anchored probe: `gone` passes, and `live` or `unknown` fails `unit-still-active` with the breadcrumb kept. The one exception is tmux's exit-empty: an `unknown` whose detail says `no server running`, after THIS attempt's kill exited 0, passes. A resumed attempt with no rc-0 kill of its own still stops on it, the rulings' accepted residual. Neither site reads PROBE_SUBSTRATE, so `no server running` and a missing socket stay unknown. (4) No fifteenth token: `unit-still-active` is reused, and its sentence — in `shared/api.ts`'s `LC_REFUSAL_WORD`, since that word has no `SENTENCES` entry (the two maps are disjoint) — now says the service and its terminal pane could not be proven stopped, edited in place and line-neutral. (5) `CHILD_STUBS`' `tmux` (`server/test/childReclaimFixture.ts`) answered exit 1 with no message to every call, which the probe reads as unknown; it is now a model that answers in tmux's words, resolves a `=` target exactly and a bare one by prefix (so an unanchored `cc-<id>` finds a sibling `cc-<id>x`), and exits empty when its last session is killed. Thirteen mutation rows, each red on a named case. Numbered by the coordinator (review 170 rulings).

---

## Review lenses

Four lenses for this wave, all `opus`. The first is MANDATORY at effort **`xhigh`** — this is the programme's only destructive wave; the others `high`. Each reviewer reads in its OWN worktree, at one measured tip.

1. **SAFETY — the destructive verb and its one server caller (opus, xhigh, MANDATORY).** Prove that nothing is deleted that was not first kept, and nothing is kept-then-deleted that is not a child. Read `_ws_reclaim_eval`, `_ws_reclaim_resume_eval`, `_ws_reclaim_locked`, `_ws_reclaim_pin` and `_ws_reclaim_tail` together, as one path, on the fresh AND the resumed arm: the two authorities (marker = `--child-of`) are compared on both arms with no flag, breadcrumb or environment variable that skips the rung; the pause file and the hold are re-read on resume; `--defer-expired` skips rungs 5 and 6 and NOTHING else and is a fingerprint input; the token is recomputed INSIDE the reap lock and any drift refuses `state-changed`; the pin phase completes (WIP commit, attic pins of every commit, stash and operation head, tombstone) before the breadcrumb is written, and a pin failure destroys nothing; the pane kill is `=`-anchored and happens before any deletion on every arm, and the unit is RE-MEASURED stopped (`unit-still-active` on anything else, an unanswered manager included) before the first deletion, and the settle re-pin catches a write that landed between pin and kill; `_ws_wip_commit` never stages a secret-shaped path (any component, untracked or ignored), never runs a hook, and commits only on the child's own branch or detached HEAD; nested checkouts of THIS repository are pinned then removed innermost-first, and a nested checkout of ANOTHER repository that is dirty or holds a commit on none of its remotes refuses before anything is touched; the branch delete is an `update-ref -d` CAS after a re-check that no other worktree holds it; the clips and `~/.cc-tmp/<id>` removals re-validate the id and prove `pwd -P` direct-child equality after normalising permissions; the registry purge is last, and every post-start failure leaves a `reclaim:<phase>` breadcrumb that resumes as a reclaim and never as a reap (and `ws-reap` refuses it). Then the server: `reclaimChild` sends nothing to a box without `reclaim-v1` (`capSupported`, refuse on no evidence), re-reads the marker against the MINTING run, refuses to spend a token minted for another run, and cancels deliveries only on `reclaimed` or on a row its own read MEASURED absent — never on a refusal, a failure or an unlistable registry; close hands off only after its commit, never awaits, and releases (never holds, never archives) exactly the children the decision table calls finished. Re-derive the "finished" table against spec §5.7 and the ordinary non-final close (which must still HOLD an unspent child whose program has another open run), and against contract §7 R16: a REVIEW child is never reclaimed while the run it reviewed is not terminal — even on the review run's own final close — and an unreadable reviewed row never authorises one. Confirm no test runs any of this against a real `$HOME` (Task 11 Step 4's two `grep`s). Also: rung 2 on both arms and the `--child-of` parse call wave 1's `_child_runid_valid` (never a re-spelled bare `=~`, which admits `1²` under a UTF-8 locale); a probe that could not RUN — or a registry row that does not say what the child is, or an unreadable tombstone on resume (R11: `tree-unreadable` means ONLY unreadable after the permission pass) — answers `unmeasured` → `failed`, never a terminal token that would strand a child, while a workdir that is GONE and a directory git does not record are no longer folded there (R19, below); and the temp-root arm (R1) UNLINKS a non-directory leaf at exactly `$HOME/.cc-tmp/<id>` with `rm -f --`, never following it and never recursing. And the vanished-worktree arm (contract §8 R19; spec §5.5): it fires ONLY when nothing stands at the workdir (`! -e` and `! -L`) and no breadcrumb exists; it pins the branch tip, every stash attributed to the branch and the HEAD git's record still names (a detached child's last commit) BEFORE the breadcrumb, a pin it cannot take destroying nothing; its tombstone says `worktree: absent`; its tail enters at the branch and still unsupervises, kills the anchored pane and re-measures the unit FIRST (spec §5.6 over R19's parenthetical order — a unit still up stops it before the branch goes); it clears exactly the child's own stale `prunable` record with `git worktree remove` on that one path (no force flag, never `worktree prune`) before the CAS; and rung 7 still guards the branch. A directory that EXISTS but that git does not record answers `no-worktree-record`, TERMINAL, deletes nothing, and is decided BEFORE rung 6 on git's record read with three answers (a list that could not be read is unmeasured, never "no record").
2. **The ccd call shape and the vocabularies (opus, high).** `cmd_ws_reclaim`'s argv parse (the dec stripped before any positional binds; the confirmation token leading; `die` on every malformed shape); `ws-audit`'s plain form byte-identical (its 2300-line suite green unchanged); the fourteen tokens and only those (`no-worktree-record` the reused fourteenth, terminal, its existing sentence true of a child), harvested by `child-reclaim.test.ts` and by `wsaudit.test.ts`'s sentence census, each new sentence true of a CHILD and asking nothing of a human; the `"failed"` document never spelled `"refused"`; the journal act `reclaim` in all seven sites, `pin-failed` and `unit-still-active` in `LcRefusalToken`, every `meas.` key the verb journals declared in `LifecycleMeas` and revived (`ccd-lifecycle-contain` at 32), `meas.resumed` one meaning on both rows, and the audit's refusal journal line in reclaim mode only, TERMINAL refusals only, its case list EQUAL to `CHILD_RECLAIM_TOKEN_KIND`'s terminal arm by a test that derives the arm from the map (R5′), and its unmeasured answer a reclaim document with `"verdict":"unmeasured"` at exit 1 (R11′); the refusal scanner's `VERBS` and sanctioned set; the three text bans (`branch -D` on one line, `--force` only in `_ws_reclaim_tail`, the purge heading four times); every ccd task's re-stamp and S6-R11 composition paragraph stated rather than inferred (for `shared/api.ts` as well as `ccd/ccd`, R9), and every insertion above the frozen corpus's highest `ccd/ccd` anchor — `:19131`, bare `:<n>` anchors included (R9′) — (`cmd_caps`, `cmd_ws_audit`, `_ws_reap_locked`) carrying code and one-line pointers only, its prose in the RECLAIM region (R9); README's anchors repaired by content, never counted; and no CODE comment the wave adds — ccd, TypeScript or test — cites the contract rather than the spec (R23).
3. **The server seams (opus, high).** `childReclaim.ts` is L1 reached through declared ports and `childReclaimDecision` is pure; no adapter narrows a distinction it received (an unlistable registry is `marker-unreadable`, never `none`; an unreadable sibling list is ineligible, never empty; an unmeasured spent verdict is never spent); the `CloseOutcome` fields are additive, `FLEET_PROTO` untouched, and absent `childReclaimWhy` has one meaning; `cancelDeliveriesTo` is a single-line-signature writer guarded by `OUTSTANDING_STATES_SQL` that returns its count, and its park is DELIBERATE (the `requeueAbandonedMail` walk admits it); `programOpenRunCount`'s exclusion is D-51's one query; the port runs on `deps.queue` keyed by session id and reads its deps when the job runs; `verb-gate`, `unattended-actor` and the kebab scanner were widened by exactly this wave's surface; `CCD_ARGV.wsReclaim` crosses the agent's real whitelist in every test that composes it. Also: `ChildReclaimRequest.deferredSinceMs` is `null` on every close request and decides nothing in the executor — it only renders the wait in the feed row, for a deferral and for a ceiling-expired attempt (R4); `review-report-live` is decided on the reviewed run's row read in the same mutex section as the siblings (R16), and the pure decision's `isChildReclaimTerminalState` (over `TERMINAL_RUN_STATES`) is the only reading of "terminal" it uses — the reviewed row carries its `RunState`, never a pre-folded boolean. `readSessionRecord`'s `absent` is read TWICE (R12) before the executor calls a child `gone` and cancels its mail (`childReclaimRowListing`: a second listing that still names `<id>.uuid` or `<id>.child` defers `marker-unreadable`; a failed second listing defers too) — a row the reader merely dropped is never treated as gone. ANY `ws-audit --reclaim` exit 1 — its `"verdict":"unmeasured"` document, or even a token-bearing one — is the `failed` outcome, and the verb is never called on it (R11′); the audit's `childOf` is read through wave 2's `CHILD_RUN_ID`, never a wider numeric parse (R2); and the review decision's two edges hold (R16′): an unreadable reviewed-run row defers `marker-unreadable`, an absent one keeps the child, `review-report-live`.
4. **Prose contracts (opus, high).** Coordinator clause 3 keeps its three verbs exactly once and its verbatim pin moved in the same commit; no skill corpus names `ws-reclaim`; step 6 is byte-identical to its shipped text and every existing pin on it is green unchanged (R16 — no copy-before-close instruction anywhere in the corpus); step 7 and wave-lifecycle §6 describe `childReclaim`/`childReclaimWhy` — all six words, `review-report-live` among them — exactly as `sendCloseOutcome` sends them, and the reviewer's sentence says its report stays while the run it reviewed is open; the worker and reviewer sentences sit outside the contract and name no `ws-*` verb or run route; CLAUDE.md still forbids all five verbs and keeps `ws-reap` human-only, and it and README narrow that rule by exactly the server's child reclaim.

---

## Pre-dispatch amendments (coordinator, 2026-09-23) — binding

Wave 3's plan was written before contract §9 (R24–R31) existed and before three ccd items were carried into this wave. A
pre-flight on 2026-09-23 read the plan against those rulings, against wave 2's shipped shapes (`76594fec`, PR #178) and
against `origin/main` (`a3a93b41`). It ran four Opus lenses and an Opus·xhigh synthesizer that re-checked every claim and
refuted eight. It found three blocking defects. The rulings below settle every question it raised. The amendments that
follow are part of the plan: where one contradicts a task's text, the amendment wins. Plan line citations inside this
section (`plan:NNNN`) refer to this file as it stood at `9f5e146f^`, the commit before this section was appended; the
lines above it have since changed (the Deviations list grew), so resolve a citation with `git show
9f5e146f^:<this file>`, never against this file's current line numbers. The pre-flight's full record is the
coordinator's scratch `wave3-preflight.json`, summarised here.

### Rulings (the coordinator's, 2026-09-23; contract §9 R24 as re-worded, R30, R31)

- **R-1 — a child's birth** is its MINTING run's `dispatchStartedAt`: the server's own clock, stamped immediately before
  the `ws-add` that minted the session, and never cleared. Birth is UNPLACEABLE when:
  - the minting run's row is absent or unreadable;
  - its `dispatchStartedAt` is null;
  - its `sessionId` is not this session (a retry orphan).

  Clock skew allowance: ±120 s (named once, as a constant).
- **R-2 — three-way placement, split by consumer.** Every same-repository PR row whose head is the child's branch is
  placed as one of:
  - `this`: its `createdAt` parses and is at or after birth + skew;
  - `inherited`: its `createdAt` parses and is before birth − skew;
  - `unplaced`: anything else — no or unparseable `createdAt`, an unplaceable birth, or within ±skew.

  Only `inherited` rows are dropped. How each consumer reads the placement:
  - **The BIND** (`childBindGate`) refuses on `this` OR `unplaced`. That is R28 unchanged for binds, and binds do not
    date the fast-path numbers.
  - **The CLOSE** reclaims on `spent` ONLY when a dated live row proves `this`. `unplaced` and `inherited` HOLD, and
    the child is still reclaimed at a final close or when the programme retires.
  - The close never reclaims on `.prnumber`/`.prhistory` alone: a fast-path spent is re-dated through the live rung
    before the close decides.
- **R-3 — claims.** Proceed on paths runs 128 and 129 hold (`shared/api.ts`, `server/src/coord/store.ts`, `README.md`,
  `server/test/session-hook.test.ts`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`), as wave 2 did. Edits stay narrow and
  additive. Whichever PR merges second merges main (never rebases), resolves, and re-runs S6-R11. The coordinator
  tells run 128's and 129's coordinator.
- **R-4 — the scratch-slug guards stay in this wave** (A4).
- **R-5 — `is_ours` three-valued moves to wave 4.** Since R28, `childSpent` never reads `ours`, so its reason in
  this wave is gone.
- **R-6 — R24's deferral is the SERVER's.** ccd's rung 2 stays a terminal `not-a-child` on both arms. A malformed
  marker is `unreadable` to wave 2's `childMarkOf`, and the executor defers `marker-unreadable` before any ccd call.
- **R-7 — a symlinked workdir refuses `containment-unproven`** (terminal). Its sentence says ccd cannot prove the tree
  at that path is the child's own.
- **R-8 — one more guard, from the pre-flight's completeness critic.** The ladder refuses `containment-unproven` when
  ANY other registry row names the same workdir, compared literally and by resolved path (A10).

### A1 — NEW Task 7b: incarnation placement (after Task 7, before Task 8) — BLOCKING

Add a task that does all of the following.

(1) ccd/ccd: change `PR_JSON_FIELDS=…,title,isDraft` to `…,title,isDraft,createdAt` IN PLACE (a3a93b41:ccd/ccd:5141). The line sits above the 19131 boundary, the line count does not change, and no S6-R11 move follows. Re-stamp. In the same commit, move the two exact-string pins, server/test/ccd-pr-state.test.ts:95-96 and server/test/ccd-pr-open.test.ts:352-354, to `…isDraft,createdAt,statusCheckRollup`. The toContain at ccd-pr-state.test.ts:279-280 stays green. `_pr_py` emits rows whole (`'rows': rows`, :5970), so it needs no edit.

(2) server/src/prstate.ts: `CcdPrRow` gains `createdAt?: string` (76594fec:server/src/prstate.ts:7-12).

(3) childSpent: takes the birth ruled in R-1 as a REQUIRED input. Suggested shape: `{kind:'at', ms} | {kind:'unplaceable', detail}`. Never make it optional, because every caller that omitted it would silently change meaning. Place every same-repo, same-branch live row:
- `this`: createdAt parses and is at or after birth + skew;
- `inherited`: createdAt parses and is before birth − skew;
- `unplaceable`: createdAt is absent or unparseable, the birth is unplaceable, or createdAt falls within ±skew.

Only `inherited` rows are dropped. The spent arm states which kind of evidence spoke, for example `spent{pr, source, incarnation:'this'|'unplaced'}`. Rungs 1–2 (`rec.prNumber`, `.prhistory`) answer `incarnation:'unplaced'`: they cannot be dated, and rung 1 is where the merge-commit bind lands. When every same-branch row is `inherited`, fall through to `phaseFor` and answer unspent.

(4) childBind (the bind consumer): refuses on spent of either incarnation, which keeps R28's fail-shut behaviour. It reads the birth through a consumer-declared port over `CoordStore.run(mark.runId)`, so store.ts, which run 128 claims, is untouched.

(5) Tests in child-reclaim-spent.test.ts:
- a pre-birth row alone gives unspent;
- a row after birth + skew gives spent/this;
- a missing or unparseable createdAt gives spent/unplaced;
- an unplaceable birth gives spent/unplaced;
- old and new rows together give spent/this, naming the highest `this` row;
- a row inside ±skew gives unplaced;
- a bind of an inherited-only child passes, and a bind of an unplaced child refuses.

Mutation rows:
- delete the placement filter: the pre-birth case goes red;
- read an unparseable createdAt as inherited: the unplaced case goes red;
- flip the skew sign: the boundary case goes red;
- drop createdAt from PR_JSON_FIELDS: the two exact pins go red.

Deploy is tolerant: a server that meets an older ccd sees no createdAt, the rows read as unplaced, the bind refuses as it does today, and the close holds (A2).

*Why:* The ledger assigns this to wave 3. Wave 3 is where `spent` starts to authorise destruction.

*Evidence (pre-flight):* ledger docs/superpowers/programs/child-reclamation.md:266-273; contract child-reclamation-contract.md:475-483 (R28); plan grep createdAt/PR_JSON_FIELDS/incarnation = 0; plan:5285; 76594fec:server/src/coord/childSpent.ts:94-95, :102-148; 76594fec:server/src/coord/childBind.ts:62; callers 76594fec:dispatch.ts:729, routes.ts:1356; a3a93b41:ccd/ccd:5141, :5212-5214; a3a93b41:server/test/ccd-pr-state.test.ts:95-96, :279-280; a3a93b41:server/test/ccd-pr-open.test.ts:352-354

### A2 — Task 8 (`childReclaimDecision`) and Task 9 (`childGateAtClose`) — BLOCKING

Task 8:
- `ChildReclaimMinting`'s row arm (plan:5206-5209) gains `dispatchStartedAt: number | null`, so the close can pass the birth.
- The finished conjunct (plan:5285) accepts ONLY `input.spent.kind==='spent' && input.spent.incarnation==='this'`. An `unplaced` spent answers not-finished (HOLD).
- Add a decision case 'spent by an unplaced or inherited row HOLDS on a non-final close', plus a mutation row: deleting `&& …incarnation==='this'` must turn that case red.

Task 9:
- `mintingRowOf` carries `r.run.dispatchStartedAt`, and `childGateAtClose` (plan:6384-6397) passes the birth to `childSpent`.
- When the fast path answers spent/unplaced, the close asks the LIVE rung to date that number before it decides. The close never reclaims on `.prnumber` or `.prhistory` alone.
- The docstring states that this gh round trip runs inside the coordination mutex, bounded by pr-state's 20 s budget.

New cases in child-reclaim-close.test.ts. For each of these, a non-final close with the programme still open must HOLD (`childReclaimWhy:'not-finished'`, `ws-hold` only):
- (i) the child's only same-branch row predates the minting run's dispatchStartedAt;
- (ii) that row has no createdAt;
- (iii) the registry `.prnumber` names an old merged PR whose live row predates birth, which is the merge-commit path.

The PR_OPEN fixture (plan:6064) carries a createdAt after the minting run's dispatchStartedAt, under a fixed clock, so 'a NON-final close of a SPENT child releases it too' (plan:6082-6090) still releases.

*Why:* Without this, the bind fix in A1 leaves the destructive consumer reading R28's fail-shut direction as permission to reclaim, and leaves the rung-1 merge-commit path open.

*Evidence (pre-flight):* plan:5206-5209, :5285, :5666 (mutation row 13 guards only unmeasured), :6384-6397, :6064-6066, :6082-6100; 76594fec:server/src/coord/childSpent.ts:103, :109; a3a93b41:ccd/ccd:5423-5429, :5956-5957; 76594fec:server/src/coord/store.ts:356, :2033-2055 (dispatchStartedAt: stamped before ws-add, never cleared)

### A3 — Tasks 2, 3, 4 and review lens 1: never follow a symlinked workdir — BLOCKING (R-7)

Task 2: directly after the vanished-worktree fork (plan:1170-1173) and before `[[ -d "$workdir" ]]` (plan:1174), add `[[ ! -L "$workdir" ]] || { _reap_refuse <R-7 token> "$workdir is a symbolic link — ccd never follows a link to a tree it would pin or delete"; return 1; }`. Test only the leaf, with no trailing slash, so a symlinked ANCESTOR (projects on a mounted volume) stays legal.

Task 3: `_ws_reclaim_pin`'s guard (plan:1841) also requires `! -L`. A link there fails with pin-failed and destroys nothing. This also covers the settle re-pin.

Task 4: tail step (4) (plan:2768) fails with `worktree-remove-failed` and deletes nothing further when `-L "$workdir"` holds at removal time. This covers the fresh arm and every resumed arm, because `_ws_reclaim_resume_eval` never reads the tree.

Tests in ccd-child-reclaim-ladder and verb, in a fixture HOME. Build a sibling worktree `other` of the same repo, dirty, and replace the child dir with a link to it:
- (a) with the child's record present, and (b) with `.git/worktrees/<child>` removed. Both must refuse at the ladder. `other`'s tree, record, branch tip and status must be byte-unchanged, and there must be no 'ccrc: WIP pinned' commit on its branch.
- (c) a resume at phase `worktree` with the link planted fails and removes nothing.

Mutation rows: deleting each `-L` test must turn its case red. Row (b) must show `other` deleted, reproducing the measurement.

Review lens 1 (plan:7179) names the workdir leaf beside the temp-root leaf.

*Why:* Measured: this deletes another worktree, or commits into one. The fix is three one-line guards.

*Evidence (pre-flight):* plan:1097-1098, :1170-1174, :1212, :1806, :1841, :1869, :2768-2769; a3a93b41:ccd/ccd:7381-7390; my scratch measurement on git 2.43.0: (a) rc 128 'validation failed … does not point back'; (b) rc 0, ../other and its record removed, ws/other left; contract:466-469 (R26)

### A4 — NEW Task 10b: the scratch-slug guards learn a child's temp root (R-4), before Task 11

Add the infix alternative `*--cc-tmp-*` to the `case` at all three sites. Each edit must be length-neutral on the same line, with the neighbouring comment rewritten in place, because session-hook.sh and ccd/ccrc are cited files. The sites are:
- a3a93b41:ccd/session-hook.sh:712
- ccd/ccrc:3486 (`_mem_is_scratch`)
- ccd/ccrc-doctor-checks:4670

In the same commit, move these pins:
- single-definition.test.ts:3114 `PRED` and its arm-equality row;
- the mirror row at :3184-3195, which strips a trailing `*` and asserts `toHaveLength(4)`, so the infix needs its own list;
- scratchSlugs.ts:19-30 (`isScratchSlug`, the fixture slugs).

Put fixtures under /var/tmp (for example `/var/tmp/<x>/.cc-tmp/7/proj` → `-var-tmp-…--cc-tmp-7-proj`). Under /tmp the existing `-tmp*` arm already matches, and the mutation would stay green.

Tests:
- the hook skips such a root;
- the census omits the slug;
- the doctor omits the slug.

Controls:
- `PERSISTENT_SLUGS` stays unskipped;
- a `.cc-tmpx` root is not skipped.

Mutation: deleting the alternative at each site must turn that site's own case red, and turn the single-definition equality row red.

*Why:* The ledger assigns this item to wave 3 (ledger:254-260), and the plan has no step for it. Every marked child's full suite goes red on 'skips a scratch slug' until it lands.

*Evidence (pre-flight):* ledger child-reclamation.md:255-260; a3a93b41:ccd/session-hook.sh:688-712 (pwd -P slug; the case); a3a93b41:ccd/ccrc:3486-3489; a3a93b41:ccd/ccrc-doctor-checks:4670; a3a93b41:server/test/single-definition.test.ts:3114, :3184-3213; a3a93b41:server/test/scratchSlugs.ts:19-37; plan grep session-hook.sh/private-tmp = 0

### A5 — Task 11 Step 1 and the brief: what "PASS everywhere" means inside a marked child

Replace 'Expected: PASS everywhere' with an expectation that fits a worker running inside a marked child:
- `session-hook.test.ts` 'skips a scratch slug' goes red under a child's TMPDIR unless A4 landed. Run that suite with `TMPDIR=/tmp` and name the case (ledger:258-260).
- `tmp-sweep.test.ts` 'FAILS CLOSED' goes red on the fleet box on an untouched main (ledger:281-282). Measure it against the base before calling it this wave's.

State how either case appears on the wave-done `suite:` line under worker clause 15.

*Why:* The wave 3 worker is a marked child, because wave 1 is deployed. As written, the step's expectation is unreachable, and clause 15 forbids `suite: green`.

*Evidence (pre-flight):* plan:7031; ledger child-reclamation.md:258-260, :281-282; a3a93b41:ccd/ccd:19593-19602 (_child_tmpdir sets TMPDIR to $HOME/.cc-tmp/<id>)

### A6 — Tasks 8 and 9: the close re-lists a marker that reads absent

Replace `read.reason === 'absent' ? { kind: 'none' } : …` (plan:6385-6386) with the executor's own second listing:
- export `childReclaimRowListing` (plan:5476-5496);
- on `absent`, answer `unreadable` when `.child` is listed or the listing fails, and `none` only when `.child` is not listed;
- name close as the third caller in that function's docstring.

Add a close case: a dropped row (`.workdir` emptied) with `.child` still listed answers `childReclaimWhy:'marker-unreadable'`. Add a mutation row: restoring the fold turns that case red.

*Why:* `absent` covers two populations. At close, a live marked child whose row could not be built reads `not-a-child`, a remedy-bearing word it is not entitled to. This is a fold across the no-boolean seam (safe direction: nothing is reclaimed).

*Evidence (pre-flight):* plan:6384-6386, :5404-5415, :5476-5496, :6515 (mutation row 7 pins only unlistable); 76594fec:server/src/coord/childBind.ts:45-55; 76594fec:server/src/registry.ts:1223-1239

### A7 — Task 8 Step 1(d): the kebab-union ordinal, measured

Locate the kebab-union disjunct by content and write the ordinal as measured.

If PR #176 (run 128) merges first, the replace-from text is gone. That PR rewrites these exact lines to add `isUpdateStoreRefuseCode` as 'the TENTH union', so in that case:
- append `|| isChildReclaimKebab(tok)` after it;
- call it the ELEVENTH union;
- the failure message lists `UpdateStoreRefuseCode or child-reclaim word`.

*Why:* This is a textual collision with an open PR that holds claims on neighbouring files.

*Evidence (pre-flight):* 76594fec:server/test/mail-routes.test.ts:775-776; git diff a3a93b41 origin/ws/warm-river -- server/test/mail-routes.test.ts (@@ -775,2 +789,10: 'the TENTH union … isUpdateStoreRefuseCode'); plan:5008-5030

### A8 — Task 8 tests: R29 pinned at this wave's consumer

Add a case that pins R29 at wave 3's consumer: a `.child` that is a DANGLING symlink, with `.uuid` present, defers `marker-unreadable` with no ccd call and the child's delivery still `queued`.

Optionally add a second case: a LIVE symlink to a file holding the run id reads as `child` on the server, and the audit then answers `not-a-child`, which is terminal and safe.

*Why:* The executor's marker cases cover none, 'seven' and another run's id (plan:4770-4777), but no symlink.

*Evidence (pre-flight):* plan:4770-4777; 76594fec:server/src/registry.ts:567-583 (childMarkOf, listed→unreadable); contract:484-488 (R29); a3a93b41:ccd/ccd:2884 (_reg_get refuses -L)

### A9 — the plan header, rung-2 prose and review lens 1: §9 by reference; the fourth run-id site

Header: add a §9 line that settles R24–R29 by reference.
- R24: the deferral is the server's, per R-6.
- R25: orphaned temp roots are wave 4's.
- R26: the tail's removal-time check is THE defence, with no second `-L` in wave-1 code.
- R27: four sites.
- R28: Task 7b plus A2.
- R29: the registry reader plus A6/A8.

Plan:335 and lens 1 say 'all three wave-3 sites'. Name the FOURTH run-id site, the audit's `childOf` print (plan:3615). Lens 1 names R26 as the reason the temp-root block matters, on the fresh, resumed and vanished arms, and adds the workdir leaf (A3).

*Why:* The plan predates §9 (0 hits for R24–R29). Under R27, a reviewer's reading is the only check on the run-id sites, and the lens as written lists three of the four.

*Evidence (pre-flight):* plan:23-24, :335, :1130, :1366, :2928, :3615, :7179; contract:447-488

### A10 — Task 2: no second registry row may name this workdir — BLOCKING (R-8)

In `_ws_reclaim_eval`, beside A3's `-L` rung and before any pin, refuse `containment-unproven` when another registry
row's `.workdir` names the child's workdir, compared both as the literal path and as its resolved (`pwd -P`) path.
An UNLISTABLE registry refuses too, as `registry-unlistable` or the plan's existing unmeasurable token; it never
proceeds.

The reason: registry corruption or an old slug collision can make a child's row name another live session's
worktree with no symlink involved, and nothing in the ladder checks that today.

Tests, in a fixture HOME:
- two rows naming one workdir: refuse, and nothing is pinned or deleted;
- a control of one row: proceeds.

Mutation row: deleting the check turns the two-row case red, with the other session's tree deleted.

### Brief notes the coordinator settled (binding on the worker and the reviewers)

- R26: the tail's `pwd -P` equality, then `rm -rf` on the resolved path, with a literal-leaf `rm -f --` for a link or
  file, is THE defence R26 names. Wave-1 code gets no second `-L`. Accepted residue: a `chmod` on an entry `find`
  selected follows a link swapped in during the walk. It can change only permission bits and deletes nothing.
- R27: the reviewers confirm by reading that all four ccd run-id sites call `_child_runid_valid`
  (plan:1130, :1366, :2928, :3615) and that no other new ccd code parses a run id. Waves 4 and 5 parse the mirror's
  `meas.childOf` through `CHILD_RUN_ID`.
- R29 and a LIVE symlinked `.child`: the server reads `child` and ccd reads empty. The close queues, the audit answers
  `not-a-child` (terminal), and the child reaches the attention list. That is the safe direction, not a defect.
- A spent child that wave 2's `refuseSpentChild` released and unbound from a planned run is never reached by the close
  trigger; its minting run's close already answered `siblings-open`. Wave 4's sweep owns it, so it is not a defect here.
- The close's live gh round trip (A2) runs inside the coordination mutex, bounded by pr-state's 20 s budget. State it
  in the docstring.
- Anchors are snapshots. The frozen boundary still answers `ccd/ccd:19131`. Since 507aefe9, `ccd/ccd` has grown +8
  lines above it (wave 1), so hints written against f5dc495b are off by that much. Locate by content.
- If PR #176 (run 128) merges first, A7's replace-from text is gone, and A7 says what to do instead.

### Carried out of this wave (recorded in the programme ledger)

- `is_ours` three-valued goes to wave 4 (R-5).
- A human-gated `ws-reap` follows a symlinked workdir the same way (B2): wave 4 mirrors A3's guard there.
- The PWA's abandon confirmation should say that a child's workspace will be reclaimed: wave 5. The ungated abandon
  door (D-282) reaching a destructive act through `state:'failed'` is inside the single-user trust model, and it is
  recorded, not changed.
- A server restart between a close committing and its queued executor running loses the one close trigger. The child
  stays released but unreclaimed until wave 4's sweep, which is the safe direction.

### Task order with the amendments

1. Task 1: journal act.
2. Task 2: ladder, plus A3's `-L` rung and A10.
3. Task 3: pin, plus A3.
4. Task 4: verb and tail, plus A3's removal-time re-test.
5. Task 5: audit, caps and dispatcher.
6. Task 6: grant, argv and budget.
7. Task 7: store.
8. NEW Task 7b (A1).
9. Task 8, plus A2, A6, A7 and A8.
10. Task 9, plus A2 and A6.
11. Task 10: prose.
12. NEW Task 10b (A4).
13. Task 11, with A5.

The destructive tasks (2–5) never read a spent verdict. The incarnation rule gates Tasks 8 and 9: the close's decision
to reclaim.
