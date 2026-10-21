# Coordinator-first approvals, round 2 (design)

**Status:** rev 0 (2026-10-21). Written after a read-only investigation (three inventories, a synthesis and an adversarial verification) and the operator's ruling of the same day on three questions (§6, the decision log). It defines no D-numbers; the plan (`docs/superpowers/plans/2026-10-21-coordinator-first-approvals-round2.md`) defines D-6203 to D-6207.

**The report (operator, 2026-10-21, verbatim),** with a screenshot of a child's "CLAUDE IS ASKING · Bash" sheet:

> "sub-workspaces still ask me for this"

**The operator's ruling (2026-10-21, verbatim),** three answers, quoted with their questions in §6.1:

> "Children use newest verified build (Recommended)"
>
> "Also allow scripts in-worktree"
>
> "Accept a superset chain (Recommended)"

- **Citations** are to `origin/main` `26d57645b` (#1078, the account deny guard, accounts plan Task A9, D-6202, merged 2026-10-21). They name a function, constant, route or file; this document cites no line numbers. The investigation read `c53bebc6b`; every symbol below was re-measured on `26d57645b`.
- **Measurements** come from the investigation's live reads of the server box and the fleet box (read-only: `coord.db` opened read-only, registry and transcript reads, no write on either box) and its verification. **[M]** marks a measured figure, **[I]** an inferred one, **[open]** a fact not yet measured. Sessions, runs, projects, accounts and hosts are never named: "a dispatched child", "its coordinator", "the fleet box", "the server box".

**Date:** 2026-10-21 · **Branch:** `docs/approvals-round2` (cut from `origin/main` `26d57645b`) · **Issues and PRs:** #646 (the approvals lane and its verified-version list), #576 (the children's deny file, D-5299), #878 (the deny file's last rewrite, D-5696), #1078 (A9, D-6202), #960 (open: the fleet banner stack)

**Related:**
- `2026-10-17-coordinator-first-routing-design.md` (§6: approvals; §6.5 the classifier; §6.6 the children's deny; §6.9 the per-version criteria) and its plan `2026-10-17-coordinator-first-routing.md` (Tasks 12 to 17; D-5297 to D-5299, D-5360, D-5361, D-5439 to D-5445, D-5481, D-5489 to D-5493; Task 13's macOS and Linux rig records).
- `2026-10-18-claude-binary-lifecycle-design.md` (§2.2 today's out-of-repo launcher and prune; §7.1 the roll's spawn carrier, `.rolling` and `.claude-build`; §8.3 the adopted launcher; §8.5 the adopted prune). None of its W2 to W5 fleet changes is on `main` [M].
- `2026-10-18-accounts-connect-design.md` §3.1 and its plan's Task A9 (D-6202): the account deny file on every session, merged.
- `2026-10-19-ccrc-consolidation-wave-design.md`: K5 (one OperatorQuestion module; the signed approval path stays its own), K7 (the redactor is a security boundary), K12 (switches; markers readable with the server down). §4 maps this design onto it.
- `2026-10-21-auto-swap-reliability-design.md`: the shape this document follows, and the ccd PRs this plan shares `ccd/ccd` with (#1077 open).

## In short

- **Coordinator-first routing has never handled one permission prompt.** The server's `approvals` table has 0 rows, ever, since the lane shipped (#646, 2026-10-18) [M]. Every child prompt has gone straight to the operator, silently.
- **Five causes (§2):**
  1. **Version drift.** `POST /api/approvals` refuses `version-unverified` unless the child's live Claude Code build is in `APPROVAL_HOOK_VERSIONS` (2.1.296, .300, .301, .302). The out-of-repo launcher runs the newest installed build; 2.1.303 landed on the fleet box before the signing key existed, and 2.1.306 is newest now. All 12 deny-engaged live children run 2.1.304 or 2.1.306 [M].
  2. **Every refusal is silent.** Only `digest-mismatch` is journaled (D-5490); the hook's `_hook_approval_wait` returns without a word on every other outcome; no doctor check or banner watches drift [M].
  3. **A deny-file rewrite un-engages live children.** `denyEngaged` compares a child's `.deny-settings` with the managed file's **current** digest. 1 live child is a stale-digest case; 6 more were spawned before the feature and have no record at all [M].
  4. **Even routed, almost nothing is allowable.** `approvalClass` answers `ordinary` only for in-root `rm`/`mkdir`/`touch` cleanups; any `cd`, read, `git` or interpreter is `escalate`, which a coordinator may only deny or hand over. The reported command escalates on its leading `cd` alone [M].
  5. **A transport finding.** `ccrc-api` gives up after 30 s (`curl -m 30`), while the server's delegation pass blocks about 31 s roughly once a minute; a timed-out request leaves no trace on either box [M].
- **The design (§3), one ruling each:** D-6204 journals every refusal and raises a doctor line and a banner (first, so the rest is observable); D-6203 spawns each child on the newest installed **verified** build, never blocking a spawn; D-6205 accepts any earlier deny-file digest in a recorded superset chain; D-6206 adds a coordinator-allowable `worktree` class (in-worktree `cd`, reads, git reads and scripts whose body passes the forbidden-verb scan), armed by the operator; D-6207 measures the client timeout against the server stall and fixes or records it.
- **What stays:** the approval window (60 s main thread, 180 s subagent, no late answers, D-5441); the signing path; the `forbidden` class; the children's static PreToolUse deny, which gains a script-body read so the new allowance does not route around it.
- **Waves (§5):** W1 = D-6204, D-6203, D-6205, one PR each. W2 = D-6206, D-6207.

## 1. The problem in numbers

### 1.1 What the operator sees

The screenshot's prompt came from a background subagent of a dispatched child running Claude Code 2.1.304 [M]. Its Bash call was pushed to the operator 32 s after it started, stayed open about 12 minutes (718 s), and ended with the operator's Allow. The child's coordinator was alive and busy and was never mailed. No `approvals` row exists for it [M].

| What | Measured | Source |
|---|---|---|
| `approvals` rows, ever (lane live since 2026-10-18) | **0** | server `coord.db`, read-only |
| `APPROVAL_HOOK_VERSIONS` and `APPROVAL_CWD_TRUSTED` | 2.1.296, .300, .301, .302; unchanged since #646 | `shared/api.ts` on `main` and the deployed build |
| Builds installed on the fleet box | .302 (10-16), .303 (10-18, late), .304 (10-19), .305 (10-20), .306 (10-21); no `.pinned` | `~/.local/share/claude/versions/` mtimes |
| Signing key created | 10-19, after .303 landed | server `~/.ccrc` |
| Live dispatched children | 19 | fleet registry, live state |
| … deny-engaged (`.deny-settings` equal to the managed digest, `.childshell` `/bin/bash`) | 12, all on unlisted builds (2.1.304 ×2, 2.1.306 ×10) | registry, live state |
| … not engaged | 7: 6 spawned 10-14 to 10-17, before the feature, with no `.deny-settings` and no `.childshell`; 1 spawned 10-19 with the pre-#878 digest | registry, verification |
| … of the 7, on listed builds | 5 (2.1.296 ×1, 2.1.302 ×4) | live state |
| **Children that could be routed today** | **0** | the two gates' empty intersection |
| Permission-shaped pushes to the operator, about 19 h of the feed ring | 18: 7 from dispatched children (0 routed), 11 from coordinators or manual sessions (the operator's by ruling) | `feed_events`; **not re-verifiable**: the ring has since rolled |
| Asks lane (AskUserQuestion), 3 days, for contrast | 17 child asks: 9 answered by the coordinator, 0 by the operator, 4 declined, 2 released, 2 stale; coordinator latency 28 to 303 s | `asks` table |
| Refusals journaled | none: no `approval-refusals.log` exists; only `digest-mismatch` would write one | server `~/.ccrc` |
| Server delegation passes blocking over 30 s | 370 of 1,257 in 24 h; typical block 31 to 32 s, max 61.6 s | server journal |
| `ccrc-api`'s client timeout | 30 s (`curl -m 30` in `ccd/ccrc-api`) | `main` |
| A background subagent's prompt on Linux 2.1.304, unanswered | about 12 min with no auto-deny | the screenshot's transcript (supports D-5440, D-5443) |

**Not yet measured** [open], each the first step of the task that needs it:
- Which of Claude Code's bypass-immune safety checks raised the screenshot's prompt. Same-subagent calls with heredocs, `sed -i`, `cd` compounds and a `nohup ./file &` launcher did not prompt; the one call that did held `(nohup bash -c "…$S…" &)`, a `bash -c` string built from variables [I]. The pane text was not captured.
- Whether 2.1.303 to 2.1.306 meet spec §6.9's restated criteria: Task 13's Linux rig per build (§3.1, OA-A2).
- How often a request times out at the client: D-6204's hook journal makes it countable (§3.5).
- Per-day prompt counts by child over more than one feed ring: D-6204's journals make them durable.

### 1.2 What the numbers say

- **The lane was dead on arrival, and nothing said so.** 2.1.303 was installed before the signing key existed, and the launcher runs the newest installed build, so every child spawned after the lane went live ran a build the gate refuses. The refusal mints no row, writes no line and raises no alarm.
- **Two gates, an empty intersection.** The children on listed builds are exactly the ones spawned before the deny record existed. Fixing the version list alone routes 12 children; fixing it without a respawn routes none of the other 7.
- **Routing alone would not quiet the operator.** With the gates fixed, the screenshot's command still escalates (its `cd`, its read, its interpreter), so it reaches the operator 60 or 180 s later instead of at once, unless the coordinator denies it. Ruling 2 is the operator's answer to that.
- **The asks lane works.** Coordinators answer children's questions within minutes; the approval lane can do the same once it engages.

## 2. The causes, as a causal chain

A child's permission prompt reaches its coordinator only through this path, every step on `main`:

1. Claude Code raises a PermissionRequest; the child's hook (`ccd/session-hook.sh`, its `PermissionRequest)` arm) writes the ask envelope and runs `_hook_approval_wait`.
2. `_hook_approval_wait` checks its local preconditions and calls `ccrc-api approvals request`.
3. The server's `POST /api/approvals` runs its ladder and mints a held row, mails the coordinator (`queueSystemMail`, `renderApprovalBrief`) and answers `201 {id, waitS}`.
4. The watcher's `tryHoldApproval` holds the operator's push while a held main-thread row is inside its window; `fleetWithCoordinator` shows "with coordinator".
5. The coordinator rules through `POST /api/approvals/:id/rule` (allow only for `ordinary`), or hands over through `…/release`. The hook polls `approvals ruling`, verifies the Ed25519 ruling with `approval-verify.mjs`, and prints the decision.

Any failure before step 3's mint leaves the prompt with the operator at once.

### 2.1 Cause 1: the version gate refuses every engaged child

- **Where:** `POST /api/approvals` in `server/src/coord/routes.ts`. After the box token, the body shape, `approvalsKilled`, attribution, `rulingsAllowedHere`, the signer and the registry's `ChildMark` (`not-a-child`) and `denyEngaged` (`deny-not-engaged`), it calls `liveVersionOf(rec)` (the pane pid's live state file under the child's config dir, `readLiveStateMeasured`) and refuses `version-unverified` when the answer is `null` or not in `APPROVAL_HOOK_VERSIONS`. The refusal is before `insertApproval`.
- **The list:** `APPROVAL_HOOK_VERSIONS` and `APPROVAL_CWD_TRUSTED` (`shared/api.ts`) are 2.1.296, .300, .301, .302, from Task 13's Linux re-check record; 2.1.299 is out (D-5481). Spec §6.9's stop rule admits a build only on a recorded rig capture; a "verified or newer" gate is wrong because lifecycle behaviour differs per build (D-5439's record).
- **The wrapper:** no `ccd` code chooses a child's build. `_spawn_start`'s spawn line execs `$WRAPPER_DIR/<wrapper>`, which reaches the out-of-repo launcher at `~/.local/bin/claude`; it picks, first match wins: `CCRC_CLAUDE_VERSION`; `versions/.pinned`; the lane's own recorded `version_to`; the highest installed build (lifecycle spec §2.2). `ccd` renders no `CCRC_CLAUDE_VERSION` (the lifecycle W2 spawn carrier, `.rolling`/`.claude-build`, is not on `main`) and no `.pinned` exists, so a child runs whatever the lane last recorded or the newest build.
- **The prune:** the out-of-repo `claude-prune-versions` timer keeps the newest 3 builds by modification time, any build a lane record names, the pin, and any build a live process executes (lifecycle spec §2.2). A verified build that no process runs is deleted once three newer builds arrive. Today 2.1.302 survives only because four pre-feature children run it.
- **Remote mode reads the real version:** in remote fleet mode `deps.io` and `deps.tmux` go to the fleet agent, so `liveVersionOf` read `2.1.304` for the screenshot's child, not `null` (verification). Widening the list would take effect.

### 2.2 Cause 2: every refusal is silent

- **Server:** `refuseRoute` writes nowhere. `journalDigestMismatch` appends `<epoch ms> digest-mismatch <session id>` to `APPROVAL_REFUSALS_LOG` (`~/.ccrc/approval-refusals.log`, D-5490) for that one word; doctor's `_check_approval-digest-mismatch` counts it. Every other ladder word, and every rule-route refusal (`guard-escalate`, `hook-gone`, …, D-5492), is unrecorded.
- **Hook:** `_hook_approval_wait` returns 0, printing nothing, on each precondition (no `.child`; `approvals-disabled`; `.deny-settings` unreadable or not the managed digest; no `node`, verifier or pinned key; no executable `ccrc-api`; no `.uuid`; a `forbidden` match by `APPROVAL_FORBIDDEN_JQ` in `class` mode; no canonical form), on `_apr_call`'s rc 1 (no answer: a transport failure or a timeout), and on any status but 201. None of these writes a line.
- **Doctor and the PWA:** no check compares live children's builds with the verified list, and the fleet frame carries no routing state. The coordinator-first spec §6.9 says an unverified build sends the prompt to the operator and "No fleet-side marker is needed"; no drift alarm was ever planned.

### 2.3 Cause 3: a deny-file rewrite un-engages live children

- **Where:** `denyEngaged` (in the `POST /api/approvals` closure) requires `rec.denySettings.kind === 'digest'`, a `.childshell` pinned to `APPROVAL_CHILD_SHELL` (`/bin/bash`), and a sha256 equal to the managed `child-deny.settings.json` read off the fleet box **now**. The hook makes the same equality check locally (`_apr_sha256` against `$REG/child-deny.settings.json`) and returns silently when it fails.
- **The writers:** `ccd/install-session-hooks.sh` rewrites the managed file whenever its bytes differ from `CHILD_DENY_RULES`' rendering (byte-level converge). `_child_spawn_compose` (`ccd/ccd`) records the file's digest as `$REG/<id>.deny-settings` at each spawn and resume.
- **The rewrites so far:** #576 wrote the first file (the eight SAFETY `ccd` verbs, `ccrc update`, `ccrc rollback`); #878 (D-5696) added `roll`, `claude` and Claude Code's `install`/`update`, a strict superset. #1078 (A9, D-6202) did **not** touch it: the account rules live in a second file, `account-deny.settings.json`, merged into every row's one `--settings` by `_account_spawn_compose`, and "a child's `.deny-settings` stays the CHILD file's digest" [M].
- **Live victims:** 1 child spawned before #878 carries the older digest. The other 6 un-engaged children have no `.deny-settings` and no `.childshell` at all; no chain can engage them, and each needs one respawn (verification).
- **Why a superset is safe to accept:** the child keeps the inline `--settings` it was spawned with, and the PreToolUse static deny (`APPROVAL_FORBIDDEN_JQ` in `deny` mode, updated live by every hook install) refuses every SAFETY verb, the approval surface and, since A9, the account verbs, whatever the child's file held. Invariant 10 rests on that deny, not on the file. Engaging routing for an older child lets a coordinator allow no more than the classifier admits.

### 2.4 Cause 4: almost nothing is allowable

- **Where:** `approvalClass` (`server/src/coord/approvalguard.ts`) answers one of `APPROVAL_CLASS_MAP`'s three classes. `ordinary` is the strict grammar of D-5360 as narrowed in rounds 5 to 8: `rm`/`mkdir`/`touch` with targets strictly inside the child's roots (never `.git`, never an agent or hook file, no `..`), user-variable assignments from a literal or `mktemp`, `true`/`:`, and `/dev/null` redirects. `simpleCommand` escalates every other command name, `cd`/`pushd`/`popd` included (round 8), every read and every `git`. The lexer escalates heredocs, pipelines, subshells, background jobs and expansions.
- **Enforced in three places:** the rule route refuses an allow unless `row.class === 'ordinary'` and the in-memory re-run (`approvalInputs`) is `ordinary` too (`guard-escalate`; a restarted server has no input, D-5491); `approval-verify.mjs` returns an allow only for a ruling whose `class` is `ordinary`; `renderApprovalBrief` offers the allow command only for `ordinary`.
- **The reported command:** `cd <worktree> && S=<scratch path> && git diff --quiet <file> && python3 - <<'EOF' … EOF`, then `sed -i … $S/…; (nohup bash -c "for m in …; do $S/…; done > $S/… 2>&1" &)`. It escalates on the `cd`; the read, the heredoc and the `bash -c` string each escalate too.
- **The static deny's blind spot:** the PreToolUse deny reads the command text twice (as written and normalised) and inside `bash -c` strings, but "a verb run from a script file, stdin or another interpreter is past any lexical match, an accepted limit" (the hook's own header). A heredoc's body is in the command text and is read; a script file's body is not.

### 2.5 Cause 5: the client gives up before the server answers

- **Where:** `ccrc-api` runs `curl -m 30`. `POST /api/approvals` makes several fleet-agent round trips (the registry listing for `approvalsKilled`, `readRegistry`, the managed deny file, `panePid`, the live state, `heldFor`'s reads). The server box's journal shows delegation passes blocking 31 to 32 s about once a minute (370 of 1,257 passes over 30 s in 24 h; max 61.6 s) [M].
- **Effect:** a request caught behind a stall ends at the hook as `_apr_call` rc 1 and `return 0`: no row, no line, the prompt goes to the operator. The 32 s between the screenshot's Bash call and its push fits either this or watcher latency [I]; nothing recorded it.
- **Interplay with the window:** D-5441's 60 s main-thread window starts at mint (`notifyAt = now + approvalWindowMs(agentId)`), while Claude Code's unattended countdown (about 120 s, Task 13's Linux record) starts when the hook starts. A slow request therefore eats the operator's remainder, not the coordinator's window.

### 2.6 How they combine

```
child prompt ─▶ _hook_approval_wait
                 ├─ precondition fails (cause 3: stale or missing deny record) ── silent (cause 2) ──┐
                 ├─ ccrc-api times out (cause 5) ──────────────────────────────── silent (cause 2) ──┤
                 └─ POST /api/approvals
                      ├─ deny-not-engaged (cause 3) ───────────────────────────── silent (cause 2) ──┤
                      ├─ version-unverified (cause 1: launcher runs newest; nothing pins children) ─┤
                      └─ minted, held ─▶ coordinator mailed                                          │
                           └─ class escalate (cause 4) ─▶ deny, or hand over, or lapse ──────────────┤
                                                                                                     ▼
                                                     the operator: "CLAUDE IS ASKING" (at once, or 60/180 s later)
```

The common defect: **the lane fails closed, which is right, and fails silently, which is not.** Every gate sends the prompt to the operator, the safe direction; but no gate says so, so a lane that never engaged looked like a lane that worked.

## 3. Design

Each rule below changes one decision at the place §2 names. Binding throughout: account switching and the auto-swap are never blocked (accounts plan Q8, as amended 2026-10-19); no herd restarts (a respawn is an operator act under the ccrc SAFETY rules); coordinator-first routing; server-signed rulings; default-escalate for anything the guard cannot vouch for.

**What no rule here changes:** the approval window (`approvalWindowMs`: `APPROVAL_COUNTDOWN_WINDOW_MS` 60 s for the main thread, `ASK_GRACE_MS` 180 s for a subagent; a ruling at or after `notifyAt` is `hook-gone`; D-5441); the signing key, the ruling's signature and the nonce (`approvalsign.ts`); `heldFor`'s claimant rule; the `forbidden` class and `FORBIDDEN_PATTERNS`; the `ordinary` grammar (D-5360); the redactor (`redactCommand`); the kill switches (`approvals-disabled` on either box, `approvals-single-box`); coordinators' builds and settings; the asks lane.

### 3.1 D-6203: children spawn on the newest installed verified build

**The rule.** `_spawn_start`, for a row with `.child` only, renders `CCRC_CLAUDE_VERSION=<v>` into the `exec env` part of the spawn line, where `<v>` is the highest installed build that is on the verified list. Every other row's spawn line is byte-identical.

- **The verified list, readable with the server down.** `ccd` carries a bash array `APPROVAL_VERIFIED_BUILDS`, the bash twin of `APPROVAL_HOOK_VERSIONS`, held equal by iteration in a test (the repo's idiom for `CHILD_DENY_RULES` and `ACCOUNT_DENY_RULES`, which are bash twins installed with `ccd`). It ships in the same release as the server's list, so the two move together, and `ccd` reads it with no server, no network and no file. A generated file was weighed and not taken: it would add an install step and a second place to drift, for no reader that `ccd` itself does not already serve.
- **The pick** (`_child_build_pick_to`, one definition): among `APPROVAL_VERIFIED_BUILDS`, the highest by version order whose `~/.local/share/claude/versions/<v>` is non-empty and executable (`-s && -x`, the lifecycle spec's T3/T4 filter), not listed in `~/.ccrc/claude-halted` when that file exists, and, once `~/.ccrc/claude-smoked` exists (the lifecycle W3 adoption), listed in it, because the adopted launcher exits 127 on an explicit request it cannot meet (lifecycle §8.3, rung 1).
- **Precedence**, when the lifecycle W2 carrier lands: `.rolling` (an operator's roll in flight), then `.claude-build`, then this pick. A roll is the operator's act; if it takes a child to an unverified build, routing goes off for that child, and D-6204 says so.
- **No verified build installed:** the spawn passes no `CCRC_CLAUDE_VERSION` (today's launcher choice), writes one fleet-journal line (`child-build <id> newest none-verified`, §3.2), and routing is off for that child until a later spawn. **A spawn is never blocked or delayed**: no pick failure, no journal failure and no missing directory returns early from `_spawn_start`.
- **The record:** each child spawn writes `$REG/<id>.childbuild` = `<v> verified` or `- none-verified`, so doctor and the server can tell a pick from a drift without reading the pane.
- **The race with the prune:** a build deleted between the pick and the exec makes the launcher fail; the unit's `Restart=always` respawns through `_spawn_start`, which picks again (the next verified build, or none). It never loops on a missing build.
- **The prune keeps it.** Today's prune is out of the repo, so it is kept in two ways: (a) `ccd` writes the current pick to `$REG/.approvals/child-build-keep` (one line, rewritten when the pick changes), and the operator adds that file to the out-of-repo prune's keep list once (OA-A4, the `ACCT_OPERATOR_STEP_2` idiom); (b) the lifecycle W3 adopted prune's keep list gains "the build named in `child-build-keep`", entered in that plan by its coordinator before CB3's prune task is dispatched. Until (a) is done, a live child running the build keeps it (the running-process rule), and a prune that removes it anyway costs routing for the next child spawn, journaled, never a blocked spawn.
- **Coordinators untouched:** a row without `.child` keeps today's launcher choice and auto-update.
- **Live children route once respawned:** a child's next spawn (a swap's restart, a crash restart, a resume) takes the pick. The 12 engaged children on 2.1.304/.306 route at their next spawn; nothing restarts them for this.
- **New children start on 2.1.302** until a newer build is verified: OA-A2 runs Task 13's Linux rig on 2.1.303 and later, and a list PR extends `APPROVAL_HOOK_VERSIONS`, `APPROVAL_CWD_TRUSTED` (only where L6 passes) and the bash twin together, with the committed captures (§6.9's stop rule unchanged).
- **Off marker:** `$REG/child-build-verified-off` restores today's spawn line for children (no `CCRC_CLAUDE_VERSION`), read by `ccd` at each spawn.

### 3.2 D-6204: every refusal journaled; a doctor line and a banner

**The rule.** Every refusal and every silent return on the approval path writes one line, on the box where it happens; doctor reads both journals; the fleet frame carries a routing summary that the PWA shows as a banner.

- **Server journal:** `APPROVAL_REFUSALS_LOG` (D-5490's file) becomes the journal of every refusal of `POST /api/approvals` and of the rule and release routes. One helper, `journalApprovalRefusal(reason, sessionId, now, words)`, replaces `journalDigestMismatch`. Line: `<epoch ms> <reason> <session id|-> [version=<v>] [release=<releaseReason>] [ms=<handler ms>]`. `reason` is an `APPROVAL_REFUSALS` word, `approval-released` with its `release=` word, or one of the ladder's other refusals (`unauthorized`, `bad-request`, `internal`, `run-unreadable`). The first two words keep D-5490's shape, so `_check_approval-digest-mismatch` parses it unchanged. No command text, path or reason text is ever written. An append that fails warns, never refuses (D-5490). At `APPROVAL_REFUSALS_LOG_MAX_BYTES` (1 MiB) the file is renamed to `.1` (one generation).
- **Fleet journal:** `$REG/.approvals/routing.log`, a dot-directory the registry scanners skip (the plan's Step 0 confirms). Writers: the hook and `ccd`'s child spawn. Line: `<epoch ms> <id> <main|agent> <outcome> [k=v…]`, appended with one `printf` under `PIPE_BUF`. Outcomes, for `.child` rows only (a top-level session's prompt is the operator's by ruling and writes nothing): `skip:<precondition>` (`disabled`, `deny-unreadable`, `deny-not-engaged`, `no-node`, `no-verifier`, `no-api`, `no-uuid`, `forbidden`, `canon`); `transport rc=<n> ms=<n>`; `refused code=<n> error=<word> ms=<n>`; `minted id=<n> waitS=<n> ms=<n>`; `end id=<n> <allow|deny|stopped:<state>|window|pane|verify-failed>`; and `ccd`'s `child-build <v|-> <verified|none-verified|marker-off>`. Same rotation and size rule as the server's.
- **The doctor line,** `approval-routing`, one check with a half per role:
  - **fleet role:** for each live `.child` row, its routing state from the registry and the managed files: engaged or not (D-6205's rule), its build (`.childbuild`, else the live state) verified or not. PASS: "every live child routes its permission prompts to its coordinator (N children)". WARN: "permission routing off for N of M children: Claude Code 2.1.306 is not verified (10), 2.1.304 (2); spawned before the deny file (6)", with fixes "verify the build on the Task 13 rig, then extend APPROVAL_HOOK_VERSIONS (an operator act)" and "respawn the child at an idle boundary (an operator act under the ccrc SAFETY rules)". It also reports the last 24 h of `routing.log` by outcome, and WARNs on any `transport`.
  - **server role:** the last 24 h of `approval-refusals.log` by reason; WARN on any `version-unverified`, `deny-not-engaged` or `internal`.
- **The banner:** the server computes `approvalRouting` in `assembleFleet` by one pure function, `approvalRoutingSummary`, from what it already reads per row (the `ChildMark`, `denySettings`, `childShell`, `.childbuild`, the live version, the kill switches): `{state: 'on' | 'off' | 'unmeasured', children, off, reasons: [{word, count, detail}]}`. It is an additive, optional field on the fleet frame; an older PWA ignores it. The PWA shows, when `off > 0`: **"permission routing off for N children: <reason>"**, the largest reason first and "+k more" after it; the words are `Claude Code <v> is not verified`, `spawned before the deny file`, `routing switched off` (a kill switch), `no verified build installed`. A tap opens the doctor's fix lines. One line that wraps at phone width, the same at laptop and wide widths; it sits in the banner stack #960 introduces when that has merged, otherwise beside `ChildReclaimBanner`. `state: 'unmeasured'` (a registry or live-state read failed) renders nothing, never "on".
- **No push.** The banner and the doctor are the alarm; a push per refused prompt would double every prompt the operator already gets.
- **No marker:** D-6204 changes no decision; switching it off would only hide lines.

### 3.3 D-6205: the deny-file superset chain

**The rule.** A child's `.deny-settings` digest engages when it equals the managed file's current digest, **or** when it names an earlier deny file, recorded in a chain, whose `permissions.deny` rules are all present in the current file's.

- **Where it lives:** `$REG/.approvals/child-deny.chain`, beside the managed file on the fleet box: JSON lines, `{"v":1,"bytes":"<the earlier file's exact bytes>","supersededAt":<epoch>}`, at most `CHILD_DENY_CHAIN_MAX` (16) entries and 64 KiB; the digest is not stored, it is recomputed from `bytes`, so an entry cannot claim a digest its bytes do not have.
- **Who writes it:** `ccd/install-session-hooks.sh` only, the managed file's one writer, in the same converge step. Before it replaces an existing regular file whose bytes differ, it parses both `permissions.deny` arrays; when every old rule string is in the new array, it appends the old file's bytes (dropping the oldest entry past the cap); when the new file is **narrower**, it empties the chain and warns, because a narrowing must not keep old children engaged. An unparseable old file adds nothing.
- **What the server accepts:** `denyEngaged` keeps the shell-pin check, then accepts the child's digest `D` when `D` is the current file's sha256, or when some chain entry's bytes hash to `D`, parse as a deny file, and every one of their deny rules is in the **current** file's array. Superset is transitive, so checking each entry against the current file directly is the chain check, and the server trusts neither the writer's order nor its superset test. The chain is read with the managed file through `deps.io.readFileMeasured`; a chain that is over the cap, unreadable or malformed accepts nothing beyond the current digest.
- **The hook's twin:** `_hook_approval_wait`'s local check accepts the same set through a jq program, `CHILD_DENY_CHAIN_JQ`, beside `_apr_sha256` for each entry's bytes; one corpus holds it equal to the TypeScript `denyChainEngages`.
- **The static deny stays the backstop:** any rule a later file adds must also land in the hook's static deny (`APPROVAL_FORBIDDEN_JQ`, `deny` mode) in the same PR, so a child engaged through the chain is refused the new verb live, whatever its spawn-time file held (verification's correction; A9 did exactly this).
- **A9's rewrite joins the chain trivially:** measured on `main`, #1078 did not rewrite `child-deny.settings.json`; it added `account-deny.settings.json`, and a child's `.deny-settings` stays the child file's digest. So A9 needs no chain entry. The first entry is written at the next rewrite of the child file.
- **The one older generation, seeded:** the installer seeds the chain once with the pre-#878 file (the ten rules `CHILD_DENY_RULES` held before D-5696, rendered by the same pipeline, byte for byte), only when the current file is a superset of it. Whether its digest equals the one stale child's `.deny-settings` is an operator reading on the box (OA-A3): equal, that child engages at once; not equal, it needs one respawn like the other six.
- **The 6 pre-feature children** have no record to chain; each needs one respawn (OA-A3), one at a time at an idle boundary.
- **Off marker:** `$REG/child-deny-chain-off` restores "current digest only" on both sides (the server reads the registry listing, as `approvalsKilled` does; the hook tests the file).

### 3.4 D-6206: the in-worktree allow class

**The rule.** `approvalClass` gains a fourth class, `worktree`: "every statement stays inside the child's own worktree: a `cd`, a read, a git read, or a script whose file or heredoc is inside it and whose body passed the scan; a coordinator may allow it once". `ordinary` is unchanged; a request is `ordinary` when it already was, `worktree` when it is not but every statement matches this section's grammar, and `escalate` otherwise. This widens D-5360's grammar by the operator's choice (ruling 2), and only for the worktree root: the tmp leaf and the scratch leaf stay `ordinary`'s.

**The grammar** (an allowlist; a construct not named here escalates):
- **Statements** join with `&&`, `;`, newlines and `||` as today. A pipeline is allowed only between read commands (below), and a read with no file operand only as a pipeline's later element (D-5360 round 4's stdin rule).
- **Directory change:** `cd <dir>` or `pushd <dir>`, one operand, a literal (absolute, `./…` or `../…`) or a resolved `"$NAME"`, whose lexical resolution is **at or inside** the worktree root; followed only across `&&` (a failed `cd` ends the chain). `popd`, `cd -`, `cd` with no operand and `CDPATH`-relative names escalate. The walk tracks the working directory from the request's trusted `cwd` (`APPROVAL_CWD_TRUSTED`), as Task 12 first did; a relative `cd` with no trusted `cwd` escalates. **A request that holds both a directory change and an `rm` escalates** (round 8's finding: `cd -L` can fall back to a physical chdir after an `rm` removed the in-root symlink it went through).
- **Read commands,** each with an explicit option list, every path operand resolving strictly inside the worktree, never under a `.git` component, never matching the credential list (D-5361): `cat`, `head` (`-n`, `-c`), `tail` (`-n`, `-c`), `wc` (`-l`, `-c`, `-w`), `ls` (`-l`, `-a`, `-1`, `-R`, `-h`), `stat`, `du` (`-s`, `-h`), `find` (names only: `-name`, `-path`, `-type`, `-maxdepth`, `-newer` with an in-worktree operand; never `-exec`, `-ok*`, `-delete`, `-fls`, `-fprint*`), `grep` (non-recursive: no `-r`, `-R`, `--recursive` or a cluster holding them; `-n`, `-i`, `-l`, `-c`, `-E`, `-F`, `-v`, `-e`), `diff` (two in-worktree files, no `-r`), `sort`, `uniq`, `cut`, `tr`, `basename`, `dirname`, `echo` and `printf` (no `-v`, no redirect but those below), `pwd`, `test`/`[` on in-worktree operands, `sleep` (the sum across the request at most 600 s, D-5360 round 4). Recursive greps and `rg` escalate: they print a nested `.env` the credential list cannot see.
- **Git reads:** `git`, with only `-C <dir at or inside the worktree>` and `--no-pager` before the subcommand, and the subcommand one of `diff`, `show`, `log`, `rev-parse`, `ls-files`, `ls-tree`, `merge-base`, `rev-list`, `blame`, `describe`, `branch --show-current`, `branch --list`. `diff`, `show` and a `log` that prints a patch need `--no-ext-diff --no-textconv` (D-5360 round 4: config-driven helpers). Whether `--quiet`/`--exit-code` forms run a configured external diff or textconv driver is measured on the rig in the task's Step 0; only if they do not are those forms admitted without the two flags. `git status`, `-c`, `--git-dir`, `--work-tree`, `--exec-path`, `--output`, every write subcommand and every other subcommand escalate.
- **Writes inside the worktree:** `ordinary`'s statements, plus redirects `>`, `>>` and `2>` whose target resolves strictly inside the worktree (never `.git`, never an agent or hook file, `AGENT_FILE_PARTS`), on any statement of this grammar.
- **Interpreters:** `python3` or `python` (options only `-u`, `-B`, `-I`, `-E`), `node` (no option), `bash` or `sh` (no option), followed by either (a) one script file operand that resolves strictly inside the worktree, is not under `.git` and is not an agent or hook file, then literal arguments (any argument holding `/` or starting with `.` must resolve inside the worktree), or (b) `-` or no operand with a **quoted-delimiter** heredoc (`<<'TAG'` or `<<"TAG"`) as that statement's stdin. An unquoted heredoc (its body expands in the shell), `-c`/`-e` strings, `nohup`, `&`, `timeout`, a subshell around the interpreter and a pipeline into it escalate.
- **The script body,** for a heredoc taken from the command text, for a file read as below, is classified by `scriptBodyClass(lang, body, ctx)` and the statement is `worktree` only when the body passes:
  - always: at most `APPROVAL_INPUT_MAX_BYTES`; ASCII only; no `FORBIDDEN_PATTERNS` match (a match makes the whole request `forbidden`); no credential-list match; no path literal outside the worktree (an absolute path not strictly inside it, `~`, `$HOME`, a `..` component, `/proc`, `/sys`, `/dev` but `/dev/null`).
  - `sh` bodies (bash or sh): the body itself must classify `ordinary` or `worktree` with **no interpreter statement** (depth one), so a shell script is held to this grammar line by line.
  - `python` bodies escalate on any process or dynamic-code primitive (`subprocess`, `os.system`, `os.popen`, `os.exec`, `os.spawn`, `pty`, `eval`, `exec`, `compile`, `__import__`, `importlib`, `ctypes`, `pickle`/`marshal` loads), any delete or move (`os.remove`, `os.unlink`, `os.rmdir`, `shutil.rmtree`, `shutil.move`, `.unlink(`, `.rmdir(`), any network module (`socket`, `urllib`, `http.client`, `requests`, `ftplib`, `smtplib`), and any environment read (`os.environ`, `getenv`).
  - `node` bodies escalate on `child_process`, `eval`, `Function(`, `vm`, `worker_threads`, a dynamic `import(`, `process.env`, `net`, `http`, `https`, `fetch(`, and the `fs` deletes (`rm`, `rmSync`, `unlink`, `unlinkSync`, `rmdir`, `rmdirSync`).
  - This scan is a lexical denylist over a general-purpose language. It is an accident guard with the same standing as the static deny, not a sandbox; the coordinator still reads the body before allowing (below). Recorded in §7.
- **A script file's body is read on the fleet box, by the server, at mint:** through the fleet agent's measured read (`deps.io.readFileMeasured`), which must report a regular file that is not a symlink, under the cap; otherwise the statement escalates. The server signs the ruling over the request digest **and** each file's `{path, sha256}`; `approval-verify.mjs` re-reads each listed file (`lstat` regular, not a symlink) and refuses the allow on any mismatch, so a body changed after the coordinator read it reaches the operator instead. The window between the hook's print and Claude Code's run remains, an accepted limit (§7).
- **What stays `forbidden` or `escalate`:** writes outside the worktree; `rm`, `mv`, `cp`, `chmod`, `ln`, `truncate`, `sed -i`, `dd` beyond `ordinary`'s cleanup shape; every `git` write; `gh`, package managers, network commands; the SAFETY `ccd` verbs and `ccrc update`/`rollback` (forbidden); the account verbs (forbidden, D-6202); the approval surface (forbidden); credential paths (a mention escalates, printing one is forbidden); `env`, `printenv`, `set`, `export`, `declare`; every non-Bash tool (`nonBashClass` unchanged).
- **Allowed where:** the rule route accepts an allow when the stored class and the re-run are both in `{ordinary, worktree}`, and, for `worktree`, the arming marker is present (below); `approval-verify.mjs` accepts an allow for `ordinary`, and for `worktree` only while the fleet arming marker is present and every listed file's hash matches.
- **How the coordinator is told:** `renderApprovalBrief` shows the class with `APPROVAL_CLASS_MAP`'s new sentence, offers the allow command for `worktree` as for `ordinary`, and shows each script body inside `untrustedBlock` (redacted, capped) under the command. The coordinator skill's clause 11 becomes: allow once only when the class is `ordinary` or `worktree` and the command (and any script body shown) is plainly part of the child's task; deny with a reason the child will read when a different shape would do (for example "rewrite it without `bash -c`; run the script file directly"), which keeps the prompt off the operator; hand it over when it needs the operator. The skill's CONTRACT literals in `coordinator-skill.test.ts` change with it.
- **Keeping the static deny meaningful:** the children's PreToolUse deny arm gains a script-body read. When a `.child` Bash command runs `bash|sh|python3|python|node <file>` (a lexical match on the command text), and the file is a regular file, not a symlink, under the cap, the hook runs `APPROVAL_FORBIDDEN_JQ` in `deny` mode over the body and denies on a match, with the same reason words. This covers the bypass-mode case, where no prompt ever reaches the classifier, so routing a script through a file no longer hides a SAFETY verb, an account verb or the approval surface from the deny. Its own off marker, `$REG/child-script-scan-off`, exists only to undo a false deny; it never widens anything.
- **Armed, not on by default:** `worktree` allows engage only while the operator's marker `$REG/approvals-worktree-armed` stands (OA-A5). Before that, the server classifies the request as `escalate` and appends `shadow-worktree <session id>` to the server journal, so the operator can count what the class would have admitted before arming it.

### 3.5 D-6207: the client timeout against the server stall

**The rule.** Measure first, then fix or record.
- **Measure:** D-6204's fleet journal gives every request's round trip (`minted … ms=`, `refused … ms=`) and every `transport` failure; the server journal's `ms=` gives the handler's own time. 48 hours after D-6204 deploys, the operator act OA-A6 reads them with the server's `delegation pass slow` lines.
- **Fix, if any `transport` line or any round trip over 20 s is measured:**
  1. **The main-thread budget counts from the hook's start.** For `agent_id` `""`, the hook stops waiting at `min(waitS, APPROVAL_COUNTDOWN_WINDOW_MS − elapsed since the hook started)`, so a slow request shortens the coordinator's window, never the operator's remainder before Claude Code's countdown.
  2. **A subagent request may wait longer for the server.** `ccrc-api` gains a bounded `--max-time <s>` row in its closed grammar (at most 60), and the hook passes 60 for a subagent request (no countdown, D-5440) and keeps 30 for the main thread.
  3. **The stall itself** (a delegation pass blocking the server for about 31 s) is out of this programme: a GitHub issue with the measured lines, for the server's owner.
- **Record, if nothing is measured in 7 days:** D-6207 is the record and no code changes.
- **Off marker,** for a fix: `$REG/approval-timeouts-legacy` restores the 30 s client timeout and the mint-based stop.

### 3.6 Rejected

- **A "verified or newer" gate.** Lifecycle behaviour differs per build (D-5439's record); a build joins only on a rig capture.
- **A fleet-wide `.pinned` to 2.1.302.** It rolls coordinators and every lane back four builds, and re-engages none of the pre-feature children (verification).
- **Allow rules in settings.** Children already run with `--dangerously-skip-permissions`; what still prompts is Claude Code's bypass-immune safety checks, which allow rules do not cover (coordinator-first spec §2.2).
- **A brief rule telling children to write scripts to files,** as proposed by the synthesis. It moves commands out of the static deny's sight (verification). D-6206's script-body read in the PreToolUse deny is the safe form of the same idea, and the coordinator's deny reason carries the rewrite advice when a rewrite helps.
- **Late answers for approvals.** The window stays as built (D-5441); the ruling of 2026-10-21 restated it.
- **A push per refused prompt** (§3.2).

## 4. Fit with the consolidation spec and the lanes

| This design | Owner (consolidation spec) | Reuses | New |
|---|---|---|---|
| D-6203 child build pick | ccd's spawn (`_spawn_start`), which stays bash; the lifecycle spec's spawn carrier (§7.1) when it lands | `APPROVAL_HOOK_VERSIONS` as a bash twin; the lifecycle spec's T3/T4 filter, `claude-halted`, `claude-smoked` | one pick helper, `.childbuild`, `child-build-keep`, one marker |
| D-6204 journals, doctor, banner | Attention (K5's OperatorQuestion stores the question; the journals are facts beside it); K6's read model for the banner | D-5490's journal and its doctor reader; `assembleFleet`'s per-row reads | one journal helper per box, one doctor check, one fleet field, one banner |
| D-6205 chain | the children's deny (coordinator-first §6.6), written by the installer | `denyEngaged`, `_child_spawn_compose`'s record, `SETTINGS_UNION_JQ` untouched | the chain file, `denyChainEngages` and its jq twin, one marker |
| D-6206 `worktree` class | K7: the classifier and redactor are a security boundary, band 3, pinned; K5 keeps the signed ruling its own path | `approvalClass`'s lexer and roots, `FORBIDDEN_PATTERNS`, `AGENT_FILE_PARTS`, the credential list, `untrustedBlock` | one class, the body scan, the signed file hashes, the PreToolUse body read, two markers |
| D-6207 timeouts | the hook's wait (coordinator-first §6.3) | `approvalWindowMs`, `ccrc-api`'s closed grammar | at most one grammar row and one hook bound, one marker |
| Markers | K12 (box markers, "readable with the server down") | the `approvals-disabled` idiom (the server reads the registry listing; the hook and `ccd` test the file) | five names |

- **K5 (OperatorQuestion):** when the question module lands, `POST /api/approvals` becomes `questions.raise({kind:'approval'})`; D-6204's journal helper moves with the route, and D-6205's `denyEngaged` and D-6206's classifier are its gates, unchanged.
- **K7 (redaction):** D-6206 adds no redaction rule; script bodies go through `redactCommand` before any row, mail or brief holds them.
- **Lanes:** D-6203 is ccd (`ccd/ccd`, `ccd/ccrc-doctor-checks`). D-6204 is the server (`routes.ts`, `fleet.ts`, `shared/api.ts`), the hook (`ccd/session-hook.sh`), doctor and the PWA. D-6205 is the installer, the server and the hook. D-6206 is the server (`approvalguard.ts`, `routes.ts`, `approvalbrief.ts`), the hook and verifier (`ccd/session-hook.sh`, `ccd/approval-verify.mjs`) and the coordinator skill. D-6207 is the hook and `ccd/ccrc-api`. Every release deploys the agent lane first. No `FLEET_PROTO` bump: every wire change is an additive optional field; the request's file hashes ride the signed ruling, which a fleet half deployed first already understands.

## 5. Waves

Every PR lands its characterization pins of today's behaviour first, keeps the behaviour change in its own commit, carries its marker where it changes a decision, and rolls back by revert.

### 5.1 W1: see it, then route it (three PRs)

1. **D-6204, the journals and the alarm.** No decision changes. First, so every later change is observable and the operator sees the lane's state today.
2. **D-6203, children on the newest verified build.** The cause of every refusal measured. Live children route at their next spawn.
3. **D-6205, the superset chain.** Before the next rewrite of the child deny file; A9 has landed without one (§3.3). It may land beside D-6203 (file-disjoint but for doctor's reasons, which D-6204 owns).

Then, outside the D-numbers: the **list PR** that adds each build OA-A2 verified to `APPROVAL_HOOK_VERSIONS`, `APPROVAL_CWD_TRUSTED` and the bash twin, with its committed captures.

### 5.2 W2: widen what a coordinator may say yes to, and settle the timeout

4. **D-6206, the `worktree` class.** After W1, so its allows are counted from day one and only engaged children reach it. Shipped unarmed; the operator arms it (OA-A5) after reading the shadow counts.
5. **D-6207, the timeout.** After D-6204 has run 48 hours (OA-A6).

### 5.3 After W2: the operator's next questions (not ruled here)

- Whether a second interpreter family (for example `perl`) joins the class, from the shadow counts.
- Whether the brief's deny-with-rewrite advice should become a standard reason the coordinator can send in one command.
- The server stall (§3.5, item 3), on its own issue.

### 5.4 Sequencing at a glance

```
D-6204 ─▶ D-6203 ─▶ (OA-A2 rig) ─▶ list PR
   │         
   ├────▶ D-6205 (before the next child-deny rewrite; beside D-6203)
   │
   ├────▶ D-6206 (after W1; unarmed) ─▶ OA-A5 arms it
   └────▶ (48 h) OA-A6 ─▶ D-6207
OA-A1 baseline before D-6204; OA-A3 respawns after D-6203 and D-6205 deploy; OA-A4 any time after D-6203
```

## 6. Operator decisions

Three questions were put on 2026-10-21; the operator answered each. The options are kept as asked where they were recorded, so the trade-off each answer accepted stays on the record.

**Q1. Version gate: how should sub-workspaces stay on a Claude Code version the approval routing has verified?** *Decided: children use the newest verified build.*
- **Taken (Recommended):** ccd spawns sub-workspaces on the highest installed verified build (the prune keeps it); coordinators keep auto-updating; an alarm, a doctor line and a journal whenever routing refuses; new children start on 2.1.302 until a newer build is verified; live children route once respawned. Trade-off: children lag Claude Code fixes until the rig verifies a build.
- Not taken: a fleet-wide pin; widening the list by hand on every release with no coupling; a "verified or newer" gate.

**Q2. "Who may say yes? Today a coordinator can only ALLOW rm/mkdir/touch inside the child's worktree…"** *Decided: also allow scripts in-worktree.*
- **Taken:** coordinators may also allow `cd`, reads and git read verbs strictly inside the child's own worktree, plus running an interpreter or script whose file or heredoc stays inside the worktree. Still escalated: writes outside the worktree, destructive verbs, `ws-*` verbs, account CLIs, the approval surface, credentials. This deliberately widens D-5360's strict grammar by the operator's choice. Trade-off: a coordinator can now allow code it reads but cannot run; the body scan and the static deny are accident guards, not a sandbox.
- Not taken (the investigation's recommendation): keep `escalate` strict and reduce escalations at the source.

**Q3. "When the child deny file changes (A9 is about to add the account-CLI deny rules)…"** *Decided: accept a superset chain.*
- **Taken (Recommended):** the server accepts any earlier deny-file digest in a recorded chain where each newer file is a superset of the older rules; the hook's static deny stays the backstop; it lands before A9 rewrites the file (if A9 lands first, the plan says how its rewrite joins the chain); the 6 pre-feature children still need one respawn (an operator act).
- Not taken: respawn every live child on every rewrite.

**Kept as built (restated with the ruling):** the approval window, 60 s on the main thread and 180 s for a subagent, with no late answers (D-5441).

### 6.1 Decision log

**2026-10-21, the operator's ruling.** The answers, verbatim:

> Q1 — "Children use newest verified build (Recommended)"
>
> Q2 — "Also allow scripts in-worktree"
>
> Q3 — "Accept a superset chain (Recommended)"

| Decision | Status | Option chosen | What it binds |
|---|---|---|---|
| Q1 | decided 2026-10-21 | children spawn on the highest installed verified build; prune keeps it; coordinators untouched; alarm, doctor line and journal on every refusal | W1: D-6204, D-6203; the list PR after OA-A2 |
| Q2 | decided 2026-10-21 | a coordinator-allowable in-worktree class: `cd`, reads, git reads, scripts whose file or heredoc is inside the worktree | W2: D-6206 |
| Q3 | decided 2026-10-21 | a recorded superset chain of earlier deny-file digests; the static deny as backstop | W1: D-6205 |
| The window | kept 2026-10-21 | 60 s main thread, 180 s subagent, no late answers (D-5441) | nothing to build |
| The timeout finding | measured 2026-10-21 | measure, then fix or record | W2: D-6207 |

**Readings this design records** (each is the plan's to apply, and the operator's to overturn):
- Q1's "newest verified build" is the highest build on the verified list that is **installed, executable, not halted and (after the lifecycle W3 adoption) smoked** (§3.1); a list entry with no build on disk is skipped.
- Q1's "the prune keeps it" is met by a keep file `ccd` writes and an operator act on today's out-of-repo prune, then by the lifecycle W3 prune's keep list (§3.1); until both stand, the running-process rule keeps a build a live child runs.
- Q1's "never block a spawn" (the dispatch text) is absolute: a pick failure spawns on today's launcher choice, journaled, with routing off for that child (§3.1).
- Q2's "strictly inside the child's own worktree" excludes the tmp and scratch leaves for the new class, which keep only `ordinary`'s cleanup writes (§3.4).
- Q2's "interpreter/script" covers `python3`/`python`, `node`, `bash` and `sh`; other interpreters escalate until a later ruling (§5.3).
- Q2's "file or heredoc stays inside the worktree" is read as: the file path resolves inside the worktree **and** its body names no path outside it; a heredoc body likewise (§3.4).
- Q2's widening ships **unarmed** and is armed by the operator after a shadow count (§3.4, OA-A5): the ruling chose the class; arming chooses the day.
- Q2's "destructive verbs" inside a script body are the deletes, moves, process spawns and dynamic code listed in §3.4; inside the command they are everything outside the grammar.
- Q3's "lands before A9 rewrites the file": A9 (#1078) landed first and did not rewrite the child file, so it joins with no entry; the chain is seeded with the pre-#878 generation, and the first written entry comes at the next rewrite (§3.3).
- Q3's "each newer file is a superset" is checked by the reader against the current file directly, which is equivalent for a transitive relation and trusts no writer (§3.3).
- D-5298's sentence "A late ruling wins until the operator acts" is superseded for approvals by D-5441, which the 2026-10-21 restatement confirms; questions keep late-answer-wins (D-5289).

## 7. Risks and rollback

| Risk | Guard | Rollback without a deploy | Rollback |
|---|---|---|---|
| D-6204 floods a journal | one line per refusal or hook outcome, `.child` rows only; 1 MiB then one rotated generation | — | revert D-6204 |
| A journal leaks a command or a secret | journals hold words, ids, codes and timings only; never command text, paths or reasons | — | revert D-6204 |
| The banner says "on" when it cannot know | `state: 'unmeasured'` renders nothing | — | revert D-6204 |
| D-6203 blocks or delays a child spawn | every pick failure falls through to today's launcher choice; no early return in `_spawn_start`; a deleted build restarts into a fresh pick | `child-build-verified-off` | revert D-6203 |
| D-6203 pins a child to a build the adopted launcher refuses (exit 127) | the pick filters on `claude-smoked` and `claude-halted` once they exist | `child-build-verified-off` | revert D-6203 |
| D-6203 changes a coordinator's build | the rendering is gated on `.child`; a characterization pin over a top-level row's spawn line | `child-build-verified-off` | revert D-6203 |
| Children lag Claude Code fixes | the list PR after each rig run; the banner names the unverified build | `child-build-verified-off` | — |
| D-6205 engages a child whose deny file was narrower | the reader checks every chain entry against the current file; a narrowing empties the chain | `child-deny-chain-off` | revert D-6205 |
| D-6205 engages a child spawned before a new verb was denied | every new verb lands in the static deny in the same PR (global constraint); the classifier forbids it whatever the file | `child-deny-chain-off` | revert D-6205 |
| D-6206 lets a child write outside its worktree | every write target and redirect resolved strictly inside the worktree; a body path literal outside it escalates; directory change plus `rm` escalates | remove `approvals-worktree-armed` | revert D-6206 |
| D-6206 lets a forbidden verb through a script body | `FORBIDDEN_PATTERNS` over every body (forbidden, never held); the PreToolUse body read in `deny` mode; process spawns and dynamic code escalate | remove `approvals-worktree-armed` | revert D-6206 |
| D-6206 lets a child read a credential | the credential list on every operand and body; recursive greps escalate; `.git` escalates; `env`/`printenv` escalate | remove `approvals-worktree-armed` | revert D-6206 |
| A script body changes after the coordinator read it | the ruling signs each file's sha256; the verifier re-hashes before printing; the window between print and run is an accepted limit | remove `approvals-worktree-armed` | revert D-6206 |
| A symlink inside the worktree points outside it | lexical resolution is the guard's limit (coordinator-first §6.1); script files must be regular and not symlinks; the credential list still matches names | remove `approvals-worktree-armed` | — |
| The body scan misses a construct (it is a denylist over a full language) | an accident guard by the operator's choice (Q2); the coordinator reads the body; the static deny still refuses the SAFETY and account verbs lexically | remove `approvals-worktree-armed` | revert D-6206 |
| The PreToolUse body read denies a legitimate script | it denies only on the forbidden set, which a child may never run anyway | `child-script-scan-off` | revert that commit |
| D-6207 shortens a coordinator's window | only by the request's own latency, on the main thread, so the operator keeps D-5441's remainder | `approval-timeouts-legacy` | revert D-6207 |
| Any change blocks a switch, a swap or a spawn | none adds a refusal to `_spawn_start`, `cmd_swap` or the swap routes; characterization pins on each | the markers | revert |

**Markers.** Each is an empty file in the registry directory: `child-build-verified-off` (D-6203), `child-deny-chain-off` (D-6205), `approvals-worktree-armed` and `child-script-scan-off` (D-6206), `approval-timeouts-legacy` (D-6207, if it builds). `ccd` and the hook test the file; the server reads the registry listing, as it reads `approvals-disabled`, so every one works with the server down. Writing or removing one is an operator act on the box; the ccrc SAFETY rules forbid it to sessions. With no marker, the ruled behaviour is on, except `approvals-worktree-armed`, which arms D-6206.

**Bound rulings, kept:** account switching and the auto-swap are never blocked; no herd restarts (every respawn is an operator act, one at a time); coordinator-first routing; server-signed rulings; default-escalate; the approval window (D-5441); children only (top-level sessions keep today's settings and prompts).

## 8. Measures of success

Measured on the boxes before W1 (OA-A1) and after each deploy, from the two journals, the `approvals` table, `feed_events` and the registry:

| Measure | Baseline (2026-10-21) | Target after W1 | Target after W2 |
|---|---|---|---|
| Approval rows minted a day | 0 (ever) | > 0 on any day a routable child prompts | same |
| Live children routable / total | 0 / 19 | every child spawned after D-6203 on a verified build; the 7 un-engaged after OA-A3 | same |
| Permission prompts reaching the operator from children, a day | about 7 in about 19 h, all never routed [not re-verifiable] | only `escalate` rows denied-not, handed over or lapsed, plus `forbidden` | fewer than after W1, by the `worktree` allows |
| Coordinator allows / denies / hand-overs a day (rows) | 0 / 0 / 0 | counted | counted, `worktree` allows separately |
| Refusals by reason a day (server journal) | unmeasured (no journal) | `version-unverified` 0 for children spawned after D-6203 on a verified build | same |
| Hook outcomes by kind a day (fleet journal) | unmeasured | counted; `skip:deny-not-engaged` 0 after OA-A3 | `transport` 0, or fixed by D-6207 |
| `shadow-worktree` lines a day (unarmed D-6206) | — | — | counted before OA-A5 |
| Request round trip p50 / max (fleet journal `ms=`) | unmeasured | counted | max under the client timeout |

## Review log

**rev 0 (2026-10-21).** Written from the three inventories, the synthesis and the adversarial verification, after the operator's ruling; every symbol re-measured on `26d57645b` (A9, #1078, merged that morning; it did not touch the child deny file). Not yet reviewed.
