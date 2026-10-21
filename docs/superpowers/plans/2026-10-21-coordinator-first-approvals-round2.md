# Coordinator-first approvals, round 2: every refusal journaled, children on a verified build, the deny chain, the in-worktree allow class, and the timeout finding — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator enters it from this plan's issued block (§Deviations), never the worker. Workers never touch the fleet box or the server box: every box reading, every respawn and every marker in this plan is an operator act (§Operator acts).

**Spec:** `docs/superpowers/specs/2026-10-21-coordinator-first-approvals-round2-design.md` (rev 0). §2 (the causal chain), §3 (the rules), §4, §5, §6.1 (the ruling and the readings it records) and §7 bind every task. Read them before Step 0.

**Status:** rev 0 (2026-10-21), not yet reviewed. Written after the operator ruled three questions on 2026-10-21, in their words: "Children use newest verified build (Recommended)", "Also allow scripts in-worktree", "Accept a superset chain (Recommended)" (spec §6.1). The approval window stays as built (D-5441).

**Inputs.** D-5297 (the hook's request, wait and verify), D-5298 (the server's rows, signing and routes), D-5299 (the classifier, default escalate; the children's deny file), D-5360 (the strict grammar, rounds 1 to 9), D-5361 (the credential paths), D-5391 (one `--settings`), D-5439, D-5440, D-5441 (the restated criteria and the windows), D-5443 (fleet children's subagents are background ones), D-5481 (2.1.299 not captured), D-5489 (the rule commands in the JSON body), D-5490 (the digest-mismatch journal), D-5491 (the server half as built), D-5492 (guard refusals are not journaled), D-5696 (the deny file's `roll`, `claude` and build rules, #878), D-6202 (A9's account deny, #1078). Task 13's macOS and Linux rig records in `2026-10-17-coordinator-first-routing.md`. The lifecycle spec's §2.2, §7.1, §8.3 and §8.5. The consolidation spec's K5, K7 and K12.

**Base:** `origin/main` `26d57645b` (#1078 merged 2026-10-21). Code is cited by file and by function, constant, route or `describe` title, never by line number. Step 0 of each task re-grounds every citation by content on the tree it starts from.

**Symbols measured at the base.** **Server** (`server/src/coord/routes.ts`): `POST /api/approvals` and its ladder (`requireMailToken`, the body check, `approvalsKilled`, `requireAttribution`, `rulingsAllowedHere`, `signerFor`, `readRegistry` and the `ChildMark` check, `denyEngaged`, `liveVersionOf`, the digest and `approvalDigestBytes`, `heldFor`, `approvalClass`, `insertApproval`, `queueSystemMail`, `renderApprovalBrief`), `journalDigestMismatch`, `approvalInputs`, the rule route's `hook-gone` and `guard-escalate` arms, `refuseRoute` (`server/src/refuse.ts`). **Classifier** (`server/src/coord/approvalguard.ts`): `APPROVAL_CLASS_MAP` (three classes), `approvalClass`, `nonBashClass`, `FORBIDDEN_PATTERNS` (with A9's `ACCOUNT_DENY_SUBS` rows), `FORBIDDEN_CCD_VERBS`, `CREDENTIAL`, `AGENT_FILE_PARTS`, `lex`, `parse`, `collectVars`, `simpleCommand` (`cd`/`pushd`/`popd` escalate), `walk`, `rootsForChild`, `admissibleRoot`. **Brief:** `renderApprovalBrief` (`approvalbrief.ts`; the allow command only for `ordinary`). **Shared** (`shared/api.ts`): `APPROVAL_HOOK_VERSIONS` and `APPROVAL_CWD_TRUSTED` (2.1.296, .300, .301, .302), `APPROVAL_HOOK_WAIT_S` 540, `APPROVAL_REFUSALS`, `CHILD_DENY_RULES`, `childDenyRules`, `CHILD_DENY_PATH_QUALIFIED`, `CHILD_DENY_SETTINGS_FILE`, `APPROVAL_CHILD_SHELL`, `APPROVAL_REFUSALS_LOG`, `DenySettingsMark`, `ChildShellMark`, `ACCOUNT_DENY_SUBS`, `ACCOUNT_DENY_RULES`. `server/src/askwindow.ts`: `approvalWindowMs`, `APPROVAL_COUNTDOWN_WINDOW_MS`, `ASK_GRACE_MS`. `server/src/watch.ts`: `tryHoldApproval`, `sweepApprovals`, `releaseHeldApproval`. `server/src/fleet.ts`: `assembleFleet`, `fleetWithCoordinator`. **Hook** (`ccd/session-hook.sh`): the `PermissionRequest)` arm, `_hook_approval_wait` (its silent `return 0`s), `_apr_call`, `_apr_scan`, `_apr_sha256`, `APPROVAL_FORBIDDEN_JQ` (modes `class` and `deny`), `APPROVAL_DIGEST_JQ`, the children's approval-surface and forbidden-verb deny arm and its "accepted limit" header. **Verifier:** `ccd/approval-verify.mjs` (an allow only for class `ordinary`). **ccd** (`ccd/ccd`): `_spawn_start` (its two `exec env` spawn lines, `genenv`), `_child_spawn_compose`, `CHILD_DENY_SETTINGS`, `CHILD_SHELL_PIN`, `SETTINGS_UNION_JQ`, `_account_spawn_compose`, `ACCOUNT_DENY_SETTINGS`, `_reg_set`, `_plat_sha256`. **Installer:** `ccd/install-session-hooks.sh` (`CHILD_DENY_FILE`, `CHILD_DENY_PATH_QUALIFIED=0`, the byte-level converge, `ACCOUNT_DENY_FILE`). **Client:** `ccd/ccrc-api` (`curl -sS -K - -m 30`). **Doctor:** `ccd/ccrc-doctor-checks` (`_check_approval-digest-mismatch`, `_check_approval-key-colocated`, `_dr_approval_role`). **Skill:** `ccd/coordinator-skill/SKILL.md` clause 11. **Absent at the base:** a refusal journal for any word but `digest-mismatch`; a fleet routing journal; an `approval-routing` doctor check; a routing field on the fleet frame; any `CCRC_CLAUDE_VERSION` rendering in `ccd`; `.childbuild`; a chain file; a fourth class; any of this plan's five markers. **Not on `main`:** the lifecycle spec's spawn carrier (`.rolling`, `.claude-build`), adopted launcher and adopted prune (W2, W3); the banner stack (#960, open).

**Also measured at the base, because the tasks depend on them.** `liveVersionOf` reads the child's live state through the fleet agent in remote mode, so it reads a real version, not `null`. `journalDigestMismatch`'s line is `<epoch ms> digest-mismatch <session id>`, and `_check_approval-digest-mismatch` reads it with `read -r at word rest`. `denyEngaged` reads the managed file through `deps.io.readFileMeasured`. `_child_spawn_compose` records the child file's digest even when it merges a route's inline settings; `_account_spawn_compose` merges `account-deny.settings.json` into every row's one `--settings`, and a child's `.deny-settings` stays the child file's digest (its header says so). `install-session-hooks.sh`'s last change to the child file was #878 (D-5696); #1078 added only the account file. The rule route refuses an allow unless the stored class and an in-memory re-run are both `ordinary`. The approval test suites: `approvalguard.test.ts` (with `fixtures/approvals/guard-corpus.json`), `approvals-routes.test.ts`, `approvals-sweep.test.ts`, `approvals-brief.test.ts`, `approvals-doctor.test.ts`, `approvals-store.test.ts`, `approval-verify.test.ts`, `approvalsign.test.ts`, `session-hook-approval-wait.test.ts`, `session-hook-approval-deny.test.ts`, `ccd-spawn-child-settings.test.ts`, `ccd-spawn-account-settings.test.ts`, `install-session-hooks.test.ts`, `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`, `coordinator-skill.test.ts`, `single-definition.test.ts`, `account-deny.test.ts`.

**Deploy class.** D-6204 is server, hook, doctor and PWA. D-6203 is ccd and doctor. D-6205 is installer, server and hook. D-6206 is server, hook, verifier and skill. D-6207 is hook and `ccrc-api`. Each rides an ordinary release, **agent lane first**, verified from the deploy log; no task adds a restart, a roll, a respawn or a `FLEET_PROTO` bump. A hook or installer change reaches the fleet box through the release's hook install; Step 0 of D-6204 records how (so the operator acts know when a change is live).

**Names.** Tasks are named by their D-numbers: **D-6204** (the journals and the alarm), **D-6203** (children on a verified build), **D-6205** (the chain), **D-6206** (the `worktree` class), **D-6207** (the timeout). **Task L** is the list PR (no D-number: it applies spec §6.9's stop rule). Operator acts are **OA-A1** to **OA-A6**.

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | every child prompt at once, and nothing says routing is off | spec §2's five causes |
| D-6204 | a banner "permission routing off for N children: Claude Code 2.1.306 is not verified"; a doctor WARN with fixes; journals that count | one journal helper per box; `approvalRoutingSummary`; one doctor check |
| D-6203 | new and respawned children run 2.1.302; the banner's count falls as children respawn | `_child_build_pick_to`; `CCRC_CLAUDE_VERSION` for `.child` rows; `.childbuild`; the keep file |
| D-6205 | the stale-digest child engages (if OA-A3's reading matches); later rewrites un-engage nobody | the chain file; `denyChainEngages` and its jq twin |
| Task L | children move to the newest build the rig verified | the list and its twin, with captures |
| D-6206 | (after OA-A5) coordinators allow in-worktree reads, git reads and scripts; the brief shows script bodies | the `worktree` class, the body scan, signed file hashes, the PreToolUse body read |
| D-6207 | no prompt lost to a client timeout | measured; at most a main-thread budget and a subagent timeout |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-21 at `26d57645b` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (23 open PRs) and `gh pr view <n>` for each PR that holds a file this plan edits.

**A9 has merged** (#1078, `26d57645b`, 2026-10-21, D-6202). It is the base. It did not rewrite `child-deny.settings.json` (spec §3.3), so D-6205 has no A9 entry to write and nothing here waits for A9.

**The auto-swap programme** (`2026-10-21-auto-swap-reliability-w1-w2.md`). **#1077** (D-6180, `feat(ccd): every silent swap stand-down logged …`) is open and holds `ccd/ccd` (in `_auto_swap_check` and its helpers) and `ccd/contexts.tsv`. **#1050** merged 2026-10-21 09:55Z. D-6181 to D-6185 have no PR yet; each will hold `ccd/ccd` in the swap region. D-6203 edits `_spawn_start` and adds a helper beside `_child_spawn_compose`, line-disjoint from the swap region today; every `ccd/ccd` PR touches the generated-stamp header (`ccrc restamp`), and whichever lands second rebases and restamps (a header conflict only, never a reason to merge two PRs as one).

**Open PRs that hold a file this plan edits.**
- **#1077** (`ccd/ccd`): D-6203. The overlap check at Step 0; hunks line-disjoint.
- **#960** (skins W2 S2c: `pwa/src/fleet/BannerStack.tsx`, `fleetSummary.ts`, the banner predicates, `pwa/test/fleet-pieces.test.tsx`, `fleet-screen.test.tsx`): D-6204's banner. If #960 has merged at D-6204's Step 0, the banner registers in its stack and predicates; if not, it renders beside `ChildReclaimBanner` and the stack's PR picks it up (named in both PR bodies).
- **No open PR** holds `server/src/coord/routes.ts`, `approvalguard.ts`, `approvalbrief.ts`, `shared/api.ts`'s approval block, `server/src/fleet.ts`, `ccd/session-hook.sh`, `ccd/approval-verify.mjs`, `ccd/install-session-hooks.sh`, `ccd/ccrc-api`, `ccd/ccrc-doctor-checks` or `ccd/coordinator-skill/SKILL.md`.

**Planned work with no PR yet that may hold the same region** (each task's Step 0 re-runs `gh pr list` and keeps its hunks line-disjoint, or waits):
- **The lifecycle W2** (`2026-10-19-claude-binary-lifecycle-w2-roll.md`): its spawn carrier renders `CCRC_CLAUDE_VERSION` from `.rolling`/`.claude-build` in `_spawn_start`. Whichever of it and D-6203 lands second adopts the other's rendering into one precedence (`.rolling`, `.claude-build`, the child pick; spec §3.1).
- **The lifecycle W3**: its adopted prune's keep list gains `$REG/.approvals/child-build-keep` (spec §3.1); this plan's coordinator enters that line in the W3 plan before its prune task is dispatched.
- **Consolidation K5** (OperatorQuestion) moves `POST /api/approvals` into a module; no PR yet. If one is open at a task's Step 0 in `routes.ts`'s approvals block, that task waits.

| Task | Rulings | Operator acts | Open PRs, overlap check at Step 0 | Other |
|---|---|---|---|---|
| D-6204 journals + alarm | Q1 **ruled** | OA-A1 before merge | #960 (banner) | — |
| D-6203 verified build | Q1 **ruled** | OA-A4 after deploy | #1077 and any auto-swap PR on `ccd/ccd` | D-6204 merged (its fleet journal and doctor check) |
| D-6205 chain | Q3 **ruled** | OA-A3's digest reading after deploy | none today | D-6204 merged; before any PR that changes `CHILD_DENY_RULES` |
| Task L list | spec §6.9 stop rule | **OA-A2** (the rig) before the PR | none today | D-6203 merged |
| D-6206 `worktree` class | Q2 **ruled** | OA-A5 (arming) after deploy and a shadow week | none today | D-6204 and D-6205 merged (they edit `_hook_approval_wait` and `routes.ts` first) |
| D-6207 timeout | the finding | **OA-A6** (48 h of journal) before Step 1 | none today | D-6204 deployed 48 h |

## Landing order

```
spec §6 ruled (Q1..Q3)
   │
   ▼
D-6204 (journals + alarm) ─▶ D-6203 (verified build) ─▶ OA-A2 rig ─▶ Task L (list)        [W1]
   │                     └──▶ D-6205 (chain; beside D-6203)
   │                                     │
   │                                     ▼
   ├──────────────────────────────▶ D-6206 (worktree class, unarmed) ─▶ OA-A5 arms        [W2]
   └── 48 h ─▶ OA-A6 ─▶ D-6207 (timeout: fix or record)
```

D-6204 lands first and deploys before any other task is dispatched: every later change is read through its journals. D-6203 and D-6205 are file-disjoint (ccd versus installer, routes and hook) and may land in either order after it; doctor's reason words for both are D-6204's. D-6206 waits for both W1 server and hook changes (`_hook_approval_wait` and `routes.ts` are line-adjacent). D-6207 waits for a measurement, not a merge.

## Global constraints

- **Public repository.** Every word in code, tests, commits and PR bodies is publishable: no host, address, account or lane name, project name, home path, email, private tracker id or session slug from either box. Fixtures are neutral (`project-a`, `s-aaaa`, `child-a`, `<rig>`, `/wt/project-a-child-a`). Never a private tracker id: cite D-numbers, ARCH-NN and GitHub `#n`.
- **Account switching and the auto-swap are never blocked (Q8).** No task adds a refusal, a wait or a server dependency to `_spawn_start`, `_account_spawn_compose`, `cmd_swap`, `swap-self` or the swap routes. A child's spawn after a swap takes D-6203's pick and never waits on it.
- **No spawn is ever blocked or delayed by this plan.** D-6203's pick, journal line and record are best effort; any failure spawns exactly as today. A characterization pin per task proves it.
- **No herd restarts.** No task restarts, respawns, wakes or rolls a session. Respawns are OA-A3, one at a time, at an idle boundary, by the operator.
- **Coordinator-first, server-signed, default-escalate.** Only the server signs a ruling; the hook prints only a verified ruling; every doubt (an unread version, an unreadable file, a body over the cap, an unknown construct) escalates or leaves the prompt with the operator. No task weakens `forbidden`, the signature, the nonce, the digest or the window.
- **Children only.** No task changes a top-level row's spawn line, settings, hook outcomes or prompts.
- **The static deny moves with the deny file.** Any PR that adds a rule to `CHILD_DENY_RULES` or `ACCOUNT_DENY_RULES` adds the same refusal to the hook's static deny (`APPROVAL_FORBIDDEN_JQ`, `deny` mode) and the classifier's `FORBIDDEN_PATTERNS` in the same PR (spec §3.3).
- **Journals hold no command text.** Words, ids, codes, versions and timings only; never a command, a path inside a command, a reason or a body.
- **Markers.** `$REG/child-build-verified-off` (D-6203), `$REG/child-deny-chain-off` (D-6205), `$REG/approvals-worktree-armed` and `$REG/child-script-scan-off` (D-6206), `$REG/approval-timeouts-legacy` (D-6207, if it builds). `ccd` and the hook test the file each time; the server reads the registry listing, as `approvalsKilled` reads `approvals-disabled`. Absent means the ruled behaviour, except `approvals-worktree-armed`, whose absence leaves D-6206 unarmed. Each has a "marker present (or absent, for the arm) → today's answer" pin.
- **Characterization first.** Every behaviour change is preceded, in the same PR, by a characterization commit that pins today's behaviour over the rows the task touches, green on the base, named "today:" (rows the behaviour commit flips) and "kept:" (rows it must not). The behaviour commit is its own commit and flips exactly the named "today:" rows; the PR body lists every before/after row and cites the ruling (spec §6.1).
- **Red first, then a mutation table, RUN.** Every new test is shown red on the characterization commit before the code that greens it. Each mutation table is run on a `git archive` copy of the PR's tip under the scratch directory, never in the worktree, and each row's red test name is printed in the PR body.
- **One definition.** A rule two places need (the pick, the chain check, the class, the body scan, the routing summary) has one TypeScript home and, where bash needs it, one twin held equal by a corpus test; registered in `single-definition.test.ts` where the repo pins its siblings.
- **Test discipline.** vitest always `--maxWorkers=2`, one suite at a time; never the full server suite locally.
- **Counts measured, not assumed.** Every figure in a PR body is measured by an operator act or a suite, never typed from this plan or the spec.
- **Deviation ledger.** This plan defines D-6203 to D-6207, one per task, and never allocates. 6208, 6209 and 6210 are issued and unused, held for departures and entered by the coordinator only.

## Review focus (the failure modes most likely to bite)

1. **The `worktree` class lets a child write outside its worktree.** Every write target (`ordinary`'s statements, every `>`/`>>`/`2>` redirect) and every interpreter file and in-body path literal resolves strictly inside the worktree root, never under `.git`, never an agent or hook file; a directory change in the same request as an `rm` escalates; a body naming `~`, `$HOME`, `..`, `/proc`, `/sys` or an absolute path outside the worktree escalates. A diff that resolves against the tmp or scratch root for the new class, or follows a `cd` across `;`, `||` or a newline, is refused.
2. **The `worktree` class runs a destructive, `ws-*` or account verb.** `FORBIDDEN_PATTERNS` (SAFETY `ccd` verbs, `ccrc update`/`rollback`, the account rows, the approval surface, tmux, units, settings and hook edits) runs over the command and every body first and makes the request `forbidden`; git writes, `rm`/`mv`/`cp`/`chmod`/`sed -i` beyond `ordinary`, package managers, `gh` and network commands are not in the grammar; process spawns and dynamic code in a body escalate.
3. **The `worktree` class reads a credential.** The credential list on every operand and every body; recursive greps and `rg` escalate; `.git` escalates; `env`, `printenv`, `set`, `export`, `declare` and environment reads in bodies escalate.
4. **A forbidden verb sneaks through a script body.** The server scans the body it read itself (never the child's description of it); the ruling signs each file's sha256 and the verifier re-hashes before printing; an unquoted heredoc, a symlinked or non-regular file, an unreadable file or a body over the cap escalates; the PreToolUse deny reads interpreter files' bodies in `deny` mode. A diff that trusts a hook-supplied body, or skips the verifier's re-hash, is refused.
5. **The allow path widens beyond the arm.** The rule route and the verifier each refuse a `worktree` allow while `approvals-worktree-armed` is absent; the brief offers no allow command then; an older verifier (deployed first) still accepts only `ordinary`.
6. **A spawn blocked, delayed or changed for a coordinator.** D-6203 renders only for `.child` rows, never returns early, and leaves a top-level row's spawn line byte-identical.
7. **The chain engages a narrower deny file.** The reader recomputes each entry's digest from its bytes and checks every entry's rules against the **current** file; a narrowing empties the chain; over-cap or malformed chains accept only the current digest.
8. **A journal that floods, lies or leaks.** One line per refusal or hook outcome, `.child` rows only, rotated at the cap; no command text; the digest-mismatch reader still parses the server journal.
9. **A marker that does not switch it off.** Each marker's pin; read each time, never cached across requests or spawns.

## Tasks

### Task D-6204: every refusal journaled, a doctor line and a banner (spec §3.2; Q1's alarm) — GATED: OA-A1 before merge

**Routing:** **band 3, native** (the approval route and the hook; untrusted child input passes by). Two reviewers: one reads only Review focus 8 (and that no decision changed); one checks every ladder word, every hook return and the doctor and banner words against spec §2.2 and §3.2. **Lanes:** server, hook, doctor, PWA. **Needs:** nothing merged; OA-A1's baseline in the PR body.

**Files:**
- Modify `shared/api.ts`: `APPROVAL_REFUSALS_LOG_MAX_BYTES` (1 MiB, with its reason); `APPROVAL_ROUTING_LOG` (`.approvals/routing.log`, relative to the registry); the fleet frame's optional `approvalRouting` type (`{state: 'on' | 'off' | 'unmeasured', children: number, off: number, reasons: readonly {word: ApprovalRoutingWord, count: number, detail: string | null}[]}`) and `APPROVAL_ROUTING_WORDS` (`version-unverified`, `deny-not-engaged`, `no-shell-pin`, `routing-disabled`, `none-verified`), each mapped once to the banner's words.
- Modify `server/src/coord/routes.ts`: `journalApprovalRefusal(reason, sessionId, now, words)` replaces `journalDigestMismatch` (same file, mode 0600, rotation at the cap, warn-never-refuse); called at every refusal of `POST /api/approvals` (each ladder word, `approval-released` with `release=`, `version=` on `version-unverified`, `ms=` on every line) and of the rule and release routes (`guard-escalate`, `guard-forbidden`, `hook-gone`, `declined`, `already-ruled`, `parent-changed`, `unknown-approval`).
- Create `server/src/coord/approvalrouting.ts`: `approvalRoutingSummary(rows, ctx)`, pure, one definition; reads each `.child` row's `ChildMark`, `denySettings`, `childShell`, `.childbuild` (D-6203 fills it; absent reads the live version), the managed digest (and, after D-6205, the chain), the kill switches; answers `unmeasured` on any failed read.
- Modify `server/src/fleet.ts`: `assembleFleet` adds `approvalRouting` from the reads it already makes (no new fleet-agent round trip per row; Step 0 counts them).
- Modify `ccd/session-hook.sh`: `_apr_journal <outcome> [k=v…]`, one `printf` append to `$REG/.approvals/routing.log` (mkdir once, rotation at the cap), called at every `return` of `_hook_approval_wait` after the `.child` test (the `skip:<precondition>` words of spec §3.2), at `_apr_call` rc 1 (`transport rc= ms=`), at a non-201 (`refused code= error= ms=`), at the 201 (`minted id= waitS= ms=`) and at the wait's end (`end id= <allow|deny|stopped:<state>|window|pane|verify-failed>`). No line for a row without `.child`.
- Modify `ccd/ccrc-doctor-checks`: `_check_approval-routing` (fleet half and server half, spec §3.2's words and fixes), registered in the check list beside `approval-digest-mismatch`; `_check_approval-digest-mismatch` unchanged (its reader still matches).
- Create `pwa/src/fleet/ApprovalRoutingBanner.tsx` (or its stack predicate, if #960 has merged): one line, "permission routing off for N children: <reason>", "+k more", a tap to the fix lines; nothing for `unmeasured` or `on`. Per-width table in the PR body (phone, laptop, wide).
- Tests: `server/test/approvals-routes.test.ts` (a journal row per refusal word), `server/test/approvals-journal.test.ts` (new: format, rotation, warn-never-refuse, no command text), `server/test/approvalrouting.test.ts` (new), `server/test/session-hook-approval-wait.test.ts` (a line per return), `server/test/approvals-doctor.test.ts` (the new check, and the digest reader over the new format), `pwa/test/approval-routing-banner.test.tsx` (new).

- [ ] **Step 0: Re-ground** every symbol; the overlap check against #960; confirm the registry scanners (`readRegistry`, `ccd`'s listings, the reap and reclaim walkers, `_ws_*` census) skip a dot-directory in `$REG`, or name the one that does not and add `.approvals` to its skip list in this PR; record how a hook change reaches the fleet box in a release; count `assembleFleet`'s fleet-agent reads per child row before and after (the field must add none per row).
- [ ] **Step 1: Characterization commit** (green on the base): "today:" a `version-unverified` refusal writes no line; a `deny-not-engaged` refusal writes no line; an `approval-released` mint writes no line; a `guard-escalate` refusal writes no line; the hook's `skip:deny-not-engaged`, transport failure and non-201 write nothing; the fleet frame has no `approvalRouting`. "kept:" `digest-mismatch` writes `<epoch> digest-mismatch <id>` and `_check_approval-digest-mismatch` counts it; every refusal's status and body are unchanged; a top-level session's PermissionRequest runs no approval code.
- [ ] **Step 2: Red.** "every POST /api/approvals refusal word writes one journal line"; "version-unverified carries version="; "approval-released carries release="; "the rule route's guard and window refusals are journaled"; "no journal line holds command text, a path or a reason" (a corpus of hostile commands, grep the file); "an unwritable journal warns and the refusal is unchanged"; "the journal rotates at APPROVAL_REFUSALS_LOG_MAX_BYTES, one generation"; "the digest-mismatch doctor check still counts its lines among the new words"; "each _hook_approval_wait return after the .child test writes one routing.log line with its word"; "a top-level row writes no routing.log line"; "a transport failure writes transport rc= ms="; "approvalRoutingSummary: 12 engaged on unlisted builds and 7 unengaged → off 19 of 19, reasons ordered by count"; "a failed live-state read → unmeasured"; "the banner renders nothing for unmeasured and on"; "the banner's words come from APPROVAL_ROUTING_WORDS"; "the doctor's fleet half WARNs with both fixes; the server half WARNs on version-unverified".
- [ ] **Step 3: Green, in commits.** (1) the shared constants and types; (2) the server journal; (3) the hook journal; (4) the summary and the fleet field; (5) the doctor check; (6) the banner. D-6204 changes no decision, so it has no behaviour commit; the PR body still lists before/after lines and cites Q1's alarm.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | one ladder word not journaled | approvals-routes | "every POST /api/approvals refusal word writes one journal line" |
  | the command text appended to the line | approvals-journal | "no journal line holds command text …" |
  | the journal failure refuses the request | approvals-journal | "an unwritable journal warns …" |
  | the second word renamed | approvals-doctor | "the digest-mismatch doctor check still counts …" |
  | a hook return left silent | session-hook-approval-wait | "each _hook_approval_wait return … writes one line" |
  | the hook journals top-level rows | session-hook-approval-wait | "a top-level row writes no routing.log line" |
  | `unmeasured` read as `on` | approvalrouting | "a failed live-state read → unmeasured" |
  | the banner shows for `unmeasured` | approval-routing-banner | "the banner renders nothing for unmeasured and on" |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/approvals-routes.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvals-journal.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvalrouting.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/session-hook-approval-wait.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvals-doctor.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/approval-routing-banner.test.tsx --maxWorkers=2

**Operator acts:** OA-A1 before merge; after deploy, the first reading of both journals and the banner (OA-A1's queries again). **Acceptance:** every refusal and hook outcome of spec §3.2 writes one line; the banner and doctor say "off" with today's reasons; no decision changed. **Rollback:** `git revert` (lines, a field and a banner only). **Deviations and decisions:** none expected; a departure is named by slug in the report.

### Task D-6203: children spawn on the newest installed verified build (spec §3.1; Q1) — GATED: after D-6204

**Routing:** **band 3, native** (every child's spawn line). Two reviewers: one reads only Review focus 6 (no spawn blocked, delayed or changed for a coordinator; the swap's restart untouched); one checks the pick against spec §3.1 and the lifecycle spec's §8.3 and §8.5. **Lane:** ccd. **Needs:** D-6204 merged (its fleet journal and doctor reasons).

**Files:**
- Modify `ccd/ccd`:
  - `APPROVAL_VERIFIED_BUILDS=(…)`, the bash twin of `APPROVAL_HOOK_VERSIONS`, beside `CHILD_SHELL_PIN`, with its reason.
  - `_child_build_pick_to <var>`: spec §3.1's pick (the highest listed build that is installed, `-s && -x`, not in `~/.ccrc/claude-halted`, and in `~/.ccrc/claude-smoked` once that file exists); answers empty on any doubt; reads no network and no server.
  - `_spawn_start`: for a row with `.child`, unless `$REG/child-build-verified-off` stands, adds `CCRC_CLAUDE_VERSION=<pick>` to `genenv` on both spawn lines (new and resume); writes `$REG/<id>.childbuild` (`<v> verified` or `- none-verified`) and `$REG/.approvals/child-build-keep` (when the pick changes); appends D-6204's `child-build` line. Every write is best effort; no early return.
  - The lifecycle W2 precedence, if its carrier has landed at Step 0 (`.rolling`, `.claude-build`, then the pick), else a comment naming it for that PR.
- Modify `ccd/ccrc-doctor-checks`: `_check_approval-routing`'s fleet half reads `.childbuild`, and WARNs "no verified build installed" when the pick is empty for any live child.
- Tests: `server/test/ccd-child-build-pick.test.ts` (new), `server/test/ccd-spawn-child-settings.test.ts` (the spawn line rows), `server/test/ccd-spawn-account-settings.test.ts` (kept rows: the account merge unchanged), `server/test/approvals-verified-twin.test.ts` (new: the bash array equals `APPROVAL_HOOK_VERSIONS` by iteration), `server/test/approvals-doctor.test.ts`.

- [ ] **Step 0: Re-ground**; the overlap check against #1077 and any open auto-swap or lifecycle PR on `ccd/ccd`; name how `_spawn_start` reaches a child's resume spawn after `cmd_swap` (so the swap's restart takes the pick); record the out-of-repo launcher's rung order as OA-A1 read it (spec §2.1) and whether it treats a `CCRC_CLAUDE_VERSION` naming an absent build as fatal.
- [ ] **Step 1: Characterization commit** (green on D-6204's tip): "today:" a `.child` row's spawn line has no `CCRC_CLAUDE_VERSION`; no `.childbuild` is written. "kept:" a top-level row's spawn line, byte for byte (new and resume); the account deny merge (`_account_spawn_compose`) and the child deny merge (`_child_spawn_compose`), byte for byte; a swap's restart of a top-level row; `.deny-settings` and `.childshell` written as today.
- [ ] **Step 2: Red.** "a child spawn renders the highest installed verified build"; "an installed but unlisted newer build is not picked"; "a listed build that is absent, empty or not executable is skipped"; "a halted build is skipped"; "once claude-smoked exists, an unsmoked build is skipped"; "no verified build installed: no CCRC_CLAUDE_VERSION, .childbuild reads none-verified, one child-build line, and the spawn proceeds"; "an unwritable registry: the spawn proceeds with the pick"; "the resume spawn line carries the same pick"; "a child's spawn after cmd_swap takes the pick"; "the off marker restores today's line"; "child-build-keep names the pick and changes only when it does"; "the bash array equals APPROVAL_HOOK_VERSIONS"; "the doctor WARNs no verified build installed".
- [ ] **Step 3: Green, in commits.** (1) the array, the pick helper and its twin test, unused; (2) **the behaviour commit**: the rendering, the record, the keep file, the journal line and the marker; (3) the doctor words. The PR body lists the before/after rows and cites Q1 (spec §6.1).
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the pick ignores the list (newest installed) | ccd-child-build-pick | "an installed but unlisted newer build is not picked" |
  | lexical sort instead of version order | ccd-child-build-pick | "a child spawn renders the highest installed verified build" (a .10 fixture) |
  | the `-x` test dropped | ccd-child-build-pick | "a listed build that is … not executable is skipped" |
  | `claude-smoked` ignored | ccd-child-build-pick | "once claude-smoked exists, an unsmoked build is skipped" |
  | an empty pick returns from `_spawn_start` | ccd-child-build-pick | "no verified build installed: … the spawn proceeds" |
  | rendered for every row | ccd-spawn-child-settings | "kept: a top-level row's spawn line, byte for byte" |
  | only the new-session line rendered | ccd-child-build-pick | "the resume spawn line carries the same pick" |
  | the marker read once and cached | ccd-child-build-pick | "the off marker restores today's line" |
  | a twin entry dropped | approvals-verified-twin | "the bash array equals APPROVAL_HOOK_VERSIONS" |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccd-child-build-pick.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-spawn-child-settings.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-spawn-account-settings.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvals-verified-twin.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvals-doctor.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/citations.test.ts --maxWorkers=2

**Operator acts:** OA-A4 (the out-of-repo prune's keep list) after deploy; OA-A3's respawns may begin once D-6203 is live. **Acceptance:** a new or respawned child runs the highest installed verified build; the banner's `version-unverified` count falls with each respawn; no spawn waited; coordinators unchanged. **Rollback:** `$REG/child-build-verified-off` (no deploy); `git revert`. **Deviations and decisions:** none expected.

### Task D-6205: the deny-file superset chain (spec §3.3; Q3) — GATED: after D-6204; before any PR that changes `CHILD_DENY_RULES`

**Routing:** **band 3, native** (what engages a child for rulings). Two reviewers, **one security-only**: it reads only Review focus 7 and the global constraint "the static deny moves with the deny file"; the other checks the writer, the reader and the twin against spec §3.3. **Lanes:** installer (agent), server, hook. **Needs:** D-6204 merged.

**Files:**
- Modify `shared/api.ts`: `CHILD_DENY_CHAIN_FILE` (`.approvals/child-deny.chain`), `CHILD_DENY_CHAIN_MAX` (16) and its byte cap; the pre-#878 rule list as a named constant (`CHILD_DENY_RULES_GEN1`), derived from `FORBIDDEN_CCD_VERBS`' first eight words and `ccrc update`/`rollback`, with its reason.
- Create `server/src/coord/denychain.ts`: `denyChainEngages(childDigest, currentBytes, chainBytes)`, pure, one definition: true when the digest equals the current file's, or some well-formed entry's bytes hash to it and every rule in them is in the current file's deny array.
- Modify `server/src/coord/routes.ts`: `denyEngaged` reads the chain beside the managed file (`deps.io.readFileMeasured`) and calls `denyChainEngages`, unless `child-deny-chain-off` is in the registry listing.
- Modify `ccd/install-session-hooks.sh`: before replacing an existing regular child file whose bytes differ, append the old bytes to the chain when the new rules are a superset, empty it when narrower, warn on either; seed `CHILD_DENY_RULES_GEN1`'s rendering once (its bash twin) when the current file is a superset of it and the chain does not hold it.
- Modify `ccd/session-hook.sh`: `_hook_approval_wait`'s local check accepts the same set through `CHILD_DENY_CHAIN_JQ` and `_apr_sha256` per entry, unless `$REG/child-deny-chain-off` stands; D-6204's `skip:deny-not-engaged` unchanged in meaning.
- Modify `server/src/coord/approvalrouting.ts`: engaged through the chain counts as engaged.
- Tests: `server/test/denychain.test.ts` (new, with `fixtures/approvals/deny-chain-corpus.json`, which the jq twin also iterates), `server/test/approvals-routes.test.ts`, `server/test/install-session-hooks.test.ts`, `server/test/session-hook-approval-wait.test.ts`.

- [ ] **Step 0: Re-ground**; `gh pr list` for any PR changing `CHILD_DENY_RULES` (wait for this task if one is open); confirm the bash rendering of `CHILD_DENY_RULES_GEN1` through the installer's pipeline reproduces #576's file byte for byte (render it at #576's merge commit and here; compare).
- [ ] **Step 1: Characterization commit** (green on D-6204's tip): "today:" a child whose digest is the previous file's is `deny-not-engaged` on the server and skipped by the hook; a rewrite leaves no record of the old file. "kept:" a child with the current digest engages; a child with no `.deny-settings` or no shell pin is refused; the installer's byte-level converge writes the same new file; the account file is untouched.
- [ ] **Step 2: Red.** "a digest in the chain whose rules are a subset of the current file engages"; "a chain entry whose bytes do not hash to the claimed child digest does not engage"; "an entry with a rule the current file lacks does not engage"; "a narrowing rewrite empties the chain and warns"; "an over-cap or malformed chain engages only the current digest"; "the seed is written once and only when the current file is a superset"; "the seeded generation's bytes equal #576's file"; "the hook's jq twin agrees with denyChainEngages over the corpus"; "the off marker restores current-only on both sides"; "a child without a shell pin is refused whatever the chain says"; "the routing summary counts a chain-engaged child as engaged".
- [ ] **Step 3: Green, in commits.** (1) the constants, `denyChainEngages` and the corpus, unused; (2) the installer's writer and seed (no reader yet: inert); (3) **the behaviour commit**: the server reader, the hook twin and the marker; (4) the summary. The PR body lists the before/after rows and cites Q3 (spec §6.1), and states that A9 (#1078) wrote no child-file entry.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the stored digest trusted, not recomputed | denychain | "a chain entry whose bytes do not hash … does not engage" |
  | the subset test against the newest entry, not the current file | denychain | "an entry with a rule the current file lacks does not engage" |
  | a narrowing appends | install-session-hooks | "a narrowing rewrite empties the chain and warns" |
  | the cap ignored | denychain | "an over-cap … chain engages only the current digest" |
  | the shell pin skipped for chain matches | approvals-routes | "a child without a shell pin is refused …" |
  | the jq twin accepts any listed sha | session-hook-approval-wait | "the hook's jq twin agrees with denyChainEngages …" |
  | the marker ignored by the hook | session-hook-approval-wait | "the off marker restores current-only on both sides" |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/denychain.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvals-routes.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/install-session-hooks.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/session-hook-approval-wait.test.ts --maxWorkers=2

**Operator acts:** OA-A3's digest reading after deploy (does the stale child's digest equal the seeded generation's?). **Acceptance:** a later superset rewrite un-engages no child; the stale-digest child engages if OA-A3's reading matches; a narrower file engages no older child. **Rollback:** `$REG/child-deny-chain-off` (no deploy); `git revert` (the chain file stays, unread). **Deviations and decisions:** if the seed cannot be reproduced byte for byte, the seed is dropped, named `deny-chain-no-seed`, and the stale child joins OA-A3's respawns.

### Task L: the verified list grows to the builds the rig passed (spec §3.1; §6.9's stop rule; no D-number) — GATED: OA-A2

**Routing:** **band 3, native** (it engages rulings for a new build). Two reviewers: one reads only the rig record against spec §6.9's restated criteria (D-5439, D-5440, D-5441); one checks the captures' neutrality (`sanitize.mjs --scan` clean, every id neutralised, no transcript prose). **Lanes:** shared, ccd. **Needs:** D-6203 merged; OA-A2's record.

- [ ] **Step 0:** read OA-A2's per-build table; a build that failed or was not captured stays out (D-5481's rule).
- [ ] **Step 1:** add the passing builds to `APPROVAL_HOOK_VERSIONS`, the passing L6 builds to `APPROVAL_CWD_TRUSTED`, the same builds to `APPROVAL_VERIFIED_BUILDS`; commit the captures under `server/test/fixtures/delegation/<build>/`; append the record to this plan's §Operator acts (OA-A2's record) and to the coordinator-first plan's Task 13 as a dated sub-record.
- [ ] **Step 2: Verify** `session-hook-approval-wait.test.ts` (the lists), `approvals-verified-twin.test.ts`, `approvals-routes.test.ts`.

**Acceptance:** children spawned after the deploy run the newest passing build; the banner's count follows. **Rollback:** `git revert` (children fall back to the previous verified build at their next spawn).

### Task D-6206: the in-worktree allow class (spec §3.4; Q2) — GATED: after D-6204 and D-6205; armed by OA-A5

**Routing:** **band 3, native, security-sensitive** (it widens what a coordinator may allow on untrusted child input). **Three reviewers, one security-only**: the security reviewer reads only Review focus 1 to 5 and runs the hostile corpus by hand against the tip; one checks the grammar against spec §3.4 and D-5360's rounds (that nothing D-5360 rejected for `ordinary` re-enters it); one checks the brief, the skill and the verifier. **Lanes:** server, hook and verifier (agent, deployed first), skill. **Needs:** D-6204 and D-6205 merged; a rig run of the `git diff --quiet` question (Step 0).

**Files:**
- Modify `server/src/coord/approvalguard.ts`:
  - `APPROVAL_CLASS_MAP.worktree` with spec §3.4's sentence; the header comment gains the class, its grammar and its accepted limits.
  - A second walk, `worktreeWalk`, over the same lexer and parser, extended to parse quoted-delimiter heredocs and in-worktree redirects for this walk only (the `ordinary` walk keeps rejecting them); `cd`/`pushd` tracked across `&&` from the trusted `cwd`; the read-command and git-read tables, each with its option allowlist; the interpreter statement; the rule "a directory change and an `rm` in one request escalate".
  - `scriptBodyClass(lang, body, ctx)`: spec §3.4's scan; `sh` bodies through `approvalClass` at depth one with interpreters refused; `FORBIDDEN_PATTERNS` over every body makes the whole request `forbidden`.
  - `approvalClass(tool, input, ctx, bodies?)`: `forbidden`, then `ordinary`, then `worktree` (only with `ctx.worktree` admissible and `bodies` for every interpreter file), else `escalate`. The worktree root alone admits the new class's operands.
- Modify `server/src/coord/routes.ts`: at mint, for each interpreter file the parse names, read it through `deps.io.readFileMeasured` (regular, not a symlink, under the cap; else no body, so the statement escalates); classify with the bodies; when `approvals-worktree-armed` is absent, store `escalate` and journal `shadow-worktree`; the signed ruling carries `files: [{path, sha256}]`; the rule route accepts an allow for `{ordinary, worktree}` (the re-run included) and, for `worktree`, only while armed.
- Modify `server/src/coord/approvalsign.ts`: the ruling's signed bytes include `files` (empty for `ordinary`), versioned so an `ordinary` ruling's bytes are unchanged.
- Modify `ccd/approval-verify.mjs`: an allow for `worktree` only while `$REG/approvals-worktree-armed` stands and every listed file `lstat`s regular, not a symlink, and hashes to its listed sha256; otherwise no output (the prompt stays the operator's).
- Modify `server/src/coord/approvalbrief.ts`: the class sentence; the allow command for `worktree` when armed; each script body inside `untrustedBlock`, redacted and capped, under the command.
- Modify `ccd/session-hook.sh`: the children's PreToolUse deny arm reads each `bash|sh|python3|python|node <file>` operand's body (regular, not a symlink, under the cap) and runs `APPROVAL_FORBIDDEN_JQ` in `deny` mode over it, unless `$REG/child-script-scan-off` stands; the deny reason names the file's basename only.
- Modify `ccd/coordinator-skill/SKILL.md` clause 11 (spec §3.4's text: allow `ordinary` or `worktree`; deny with a rewrite reason when a different shape would do; hand over otherwise), and its CONTRACT literals in `server/test/coordinator-skill.test.ts`.
- Tests: `server/test/approvalguard.test.ts` and `fixtures/approvals/guard-corpus.json` (new rows, each with its class and why), `server/test/approvalguard-worktree.test.ts` (new: the hostile corpus), `server/test/approvals-routes.test.ts`, `server/test/approval-verify.test.ts`, `server/test/approvalsign.test.ts`, `server/test/approvals-brief.test.ts`, `server/test/session-hook-approval-deny.test.ts` (the body read; the classifier parity corpus still equal), `server/test/coordinator-skill.test.ts`.

- [ ] **Step 0: Re-ground**; the overlap check; on the coordinator-first rig (never the fleet box), measure whether `git diff --quiet` and `git diff --exit-code` run a configured `diff.external` or textconv driver on the passing builds, and record the answer in the PR body (it decides whether those forms need `--no-ext-diff --no-textconv`); measure whether `deps.io.readFileMeasured` can report "regular, not a symlink" through the fleet agent, and if it cannot, the PR adds that answer to the agent's read (an agent-lane change, deployed first) or the interpreter-file arm ships disabled and only heredocs are admitted (named `worktree-heredoc-only`).
- [ ] **Step 1: Characterization commit** (green on the base of this PR): "today:" `cd <wt> && git diff --no-ext-diff --no-textconv -- a.ts` is `escalate`; `cat ./notes.md` is `escalate`; `python3 ./tools/x.py` is `escalate`; `python3 - <<'EOF'` with an in-worktree body is `escalate`; the brief offers no allow for them; the verifier refuses an allow of any class but `ordinary`. "kept:" every existing `guard-corpus.json` row's class (`ordinary`, `escalate`, `forbidden`) except the rows this task names as flipping; `ordinary`'s rows byte for byte; the window; the signature over an `ordinary` ruling, byte for byte.
- [ ] **Step 2: Red.** The class: "an in-worktree cd, cat and git read is worktree"; "the reported command's first half (cd, assignment, git diff, quoted heredoc to python3 reading in-worktree files) is worktree, its second half (sed -i, nohup bash -c) escalates" (neutral fixture). **Writes outside:** "a redirect to /tmp escalates"; "a redirect into .git escalates"; "a redirect to CLAUDE.md escalates"; "cd .. above the worktree then cat escalates"; "cd sub; cat ../../x escalates (cd followed only across &&)"; "cd plus rm in one request escalates"; "a body with open('/etc/x','w') escalates"; "a body with ~ or $HOME or os.path.expanduser escalates"; "a body with a .. path escalates". **Forbidden verbs:** "a heredoc body naming ccd ws-rm is forbidden"; "a script file body naming ccrc account remove is forbidden"; "a body naming the approval surface is forbidden"; "a body with subprocess, os.system, eval, exec, __import__, child_process or Function( escalates"; "an sh body with an interpreter statement escalates"; "an unquoted heredoc escalates"; "bash -c and python -c escalate"; "nohup, &, timeout and a subshell around an interpreter escalate". **Credentials:** "cat .env escalates"; "grep -r and rg escalate"; "cat .git/config escalates"; "a body reading os.environ escalates"; "env and printenv escalate". **Files:** "a symlinked script escalates"; "an unreadable script escalates"; "a script over the cap escalates"; "a script changed after the ruling: the verifier prints nothing". **Arm:** "unarmed: the request is stored escalate and journals shadow-worktree"; "unarmed: the rule route refuses a worktree allow"; "unarmed: the verifier refuses a worktree ruling"; "armed: the coordinator's allow is printed once". **Static deny:** "PreToolUse denies python3 ./x.py whose body names ccd ws-rm"; "child-script-scan-off restores today's PreToolUse"; "a top-level session's script is not read". **Brief and skill:** "the brief shows the script body fenced and redacted"; "the brief offers allow for worktree only when armed"; "clause 11 names ordinary and worktree".
- [ ] **Step 3: Green, in commits.** (1) the class, the walk and the body scan, unused by any route (classifier tests only); (2) the verifier and the signing change, accepting nothing new while unarmed (agent lane first); (3) **the behaviour commit**: the mint's body read, the classification, the shadow journal and the rule route's `{ordinary, worktree}`; (4) **the behaviour commit**: the PreToolUse body read and its marker; (5) the brief and the skill. The PR body lists the before/after rows, cites Q2 (spec §6.1) and states that the class ships unarmed.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | redirect targets resolved against the tmp root | approvalguard-worktree | "a redirect to /tmp escalates" (a tmp-leaf fixture) |
  | `.git` admitted for reads | approvalguard-worktree | "cat .git/config escalates" |
  | `cd` followed across `;` | approvalguard-worktree | "cd sub; cat ../../x escalates …" |
  | the cd-plus-rm rule dropped | approvalguard-worktree | "cd plus rm in one request escalates" |
  | `FORBIDDEN_PATTERNS` not run over bodies | approvalguard-worktree | "a heredoc body naming ccd ws-rm is forbidden" |
  | `ACCOUNT_DENY_SUBS` rows skipped for bodies | approvalguard-worktree | "a script file body naming ccrc account remove is forbidden" |
  | `subprocess` removed from the python list | approvalguard-worktree | "a body with subprocess … escalates" |
  | the depth-one rule dropped for sh bodies | approvalguard-worktree | "an sh body with an interpreter statement escalates" |
  | an unquoted heredoc admitted | approvalguard-worktree | "an unquoted heredoc escalates" |
  | recursive grep admitted | approvalguard-worktree | "grep -r and rg escalate" |
  | the credential list skipped for bodies | approvalguard-worktree | "a body reading os.environ escalates" / "cat .env escalates" |
  | symlinked files read | approvals-routes | "a symlinked script escalates" |
  | the verifier skips the re-hash | approval-verify | "a script changed after the ruling …" |
  | the arm ignored by the rule route | approvals-routes | "unarmed: the rule route refuses a worktree allow" |
  | the arm ignored by the verifier | approval-verify | "unarmed: the verifier refuses a worktree ruling" |
  | `ordinary`'s signed bytes changed | approvalsign | "kept: the signature over an ordinary ruling, byte for byte" |
  | the PreToolUse body read reads top-level rows | session-hook-approval-deny | "a top-level session's script is not read" |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/approvalguard.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvalguard-worktree.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvals-routes.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approval-verify.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvalsign.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvals-brief.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/session-hook-approval-deny.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

**Operator acts:** after deploy, a week of `shadow-worktree` counts (OA-A1's queries plus that word), then OA-A5 arms the class or leaves it unarmed. **Acceptance:** every hostile corpus row holds; `ordinary` unchanged byte for byte; unarmed, nothing new is allowable; armed, a coordinator can allow the in-worktree shapes and nothing else. **Rollback:** remove `$REG/approvals-worktree-armed` (no deploy); `$REG/child-script-scan-off` for a false PreToolUse deny; `git revert` newest commit first (the verifier last, after the server). **Deviations and decisions:** `worktree-heredoc-only` (Step 0) if the agent read cannot say "regular, not a symlink".

### Task D-6207: the client timeout against the server stall (spec §3.5) — GATED: OA-A6 (48 h of D-6204's journals)

**Routing:** **band 3, native** (the hook's wait bounds the operator's remainder). Two reviewers: one reads only the window rules (D-5441: the operator keeps about 60 s before Claude Code's countdown; a subagent keeps 180 s); one checks `ccrc-api`'s closed grammar. **Lanes:** hook, `ccrc-api` (agent). **Needs:** OA-A6's reading in the PR body.

- [ ] **Step 0:** read OA-A6: `transport` lines and round trips over 20 s, by main thread and subagent, against the server's stall lines. **If none in 7 days, stop:** the PR is this plan's record of the finding (one paragraph appended to §Deviations' D-6207 entry by the coordinator), and no code changes.
- [ ] **Step 1: Characterization commit:** "today:" a main-thread request that took 25 s still waits the full `waitS`; a subagent request times out at 30 s. "kept:" the window `approvalWindowMs`, `APPROVAL_HOOK_WAIT_S`, the `hook-gone` refusal.
- [ ] **Step 2: Red.** "a main-thread request that took 25 s stops waiting at 60 s from the hook's start"; "a subagent request may take up to 60 s"; "ccrc-api --max-time above 60 is refused by the grammar"; "approval-timeouts-legacy restores both".
- [ ] **Step 3: Green.** (1) `ccrc-api`'s bounded `--max-time` row; (2) **the behaviour commit**: the hook's main-thread budget and the subagent timeout, with the marker.
- [ ] **Step 4: Mutation table, RUN:** the budget measured from mint (red: the 25 s row); the subagent timeout applied to the main thread (red: a main-thread 45 s fixture); the bound removed (red: the grammar row); the marker ignored (red: its row).
- [ ] **Step 5: Verify** `session-hook-approval-wait.test.ts`, `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`.

**Operator acts:** OA-A6 before; its queries again 48 h after deploy. **Acceptance:** `transport` lines 0, or each one explained by a stall over 60 s on the issue. **Rollback:** `$REG/approval-timeouts-legacy`; `git revert`. **Also:** a GitHub issue for the server's delegation-pass stall, with the measured counts and no host or account name.

## Operator acts in this programme

Every act below reads or changes a box; none is done by a worker or a session.

- **OA-A1 (before D-6204 merges): the baseline.** Read-only: `approvals` rows (count, ever and per day); child permission prompts in `feed_events` (by child mark, at the time of reading); live `.child` rows by build, `.deny-settings` (engaged, stale, none) and `.childshell`; installed builds and `.pinned`; the launcher's rung order and whether an absent `CCRC_CLAUDE_VERSION` build is fatal; the server's `delegation pass slow` lines over 24 h. Aggregate counts only go in the PR body.
- **OA-A2 (before Task L): the Task 13 rig for 2.1.303 and later.** On a **throwaway Linux VM with a Claude login** (never the fleet box, never a live `$HOME`), with the Linux re-check record's rig shape (the fleet's `tmux.conf`, `--dangerously-skip-permissions`, one `--settings` holding the child deny rules, the capture hooks), for each build installed on the fleet box: L1 to L8 of that record, and macOS-record checks 3a, 5, 8 and 9 where they are platform-neutral. It needs the operator because the rig needs a login. The record lands as a dated sub-record of the coordinator-first plan's Task 13 and feeds Task L.
- **OA-A3 (after D-6203 and D-6205 deploy): the one-time respawns.** First, compare the stale-digest child's `.deny-settings` with the seeded chain entry's digest; equal, it is engaged and needs nothing. Then respawn each child that still has no deny record (6 measured) and, if not engaged, the stale one: **one at a time, at an idle boundary**, by the operator, never a herd, under the ccrc SAFETY rules (a coordinator asking for one names that rule). Live children on unverified builds need no respawn for this: their next ordinary spawn takes the pick.
- **OA-A4 (after D-6203 deploys): the prune's keep list.** Add `$REG/.approvals/child-build-keep` to the out-of-repo `claude-prune-versions` keep list, once, until the lifecycle W3 adopted prune replaces it (that plan's keep list carries the same file).
- **OA-A5 (after D-6206 deploys and a week of shadow counts): arming.** Read `shadow-worktree` lines and the rows they would have been; place `$REG/approvals-worktree-armed` to arm the class, or leave it absent. Removing it disarms at once.
- **OA-A6 (48 h after D-6204 deploys): the timeout reading.** From both journals: `transport` lines, round-trip p50 and max by main thread and subagent, set against the server's stall lines in the same hours.
- **Markers (any time):** writing or removing `$REG/child-build-verified-off`, `$REG/child-deny-chain-off`, `$REG/approvals-worktree-armed`, `$REG/child-script-scan-off` or `$REG/approval-timeouts-legacy` is the operator's no-deploy switch. The ccrc SAFETY rules forbid sessions these writes.
- **The deploys** follow the standing rule: from a fresh `origin/main` worktree as a detached unit, verified from its log, agent lane before server lane. No session restarts.

## Acceptance

Every PR body carries: the characterization commit's name; the before/after rows of each behaviour commit with its ruling cited (spec §6.1); the mutation table's red test names; the overlap check (each edited file, each open PR holding it, its hunks; #1077 named for D-6203, #960 for D-6204); the marker and its pin; and the operator act's figures where its task names one (D-6204: OA-A1; D-6205: OA-A3's digest comparison; Task L: OA-A2's table; D-6206: the Step 0 rig answer; D-6207: OA-A6). Band 3 PRs carry every reviewer's verdict, the security-only reviewer's separately. Spec §8's "after W1" column is measured 7 days after D-6205 and Task L have deployed and OA-A3 is done; "after W2" 7 days after OA-A5 (or after D-6206 if the operator leaves it unarmed).

## Rollback

Each task is a revert of its PR, newest first. Zero-deploy brakes: the markers (§Operator acts). D-6204 has no marker (it changes no decision). After a revert of D-6203, children spawn on the launcher's choice again; `.childbuild` and `child-build-keep` stay, unread. After a revert of D-6205, the chain file stays, unread, and only current-digest children engage. After a revert of D-6206, the verifier is reverted last (after the server), so no signed `worktree` ruling meets a verifier that would accept it unarmed.

## Deviations and decisions

### Issued for this work and defined here

The orchestrator issued this programme the block 6203 to 6210 from the ledger. This plan defines D-6203 to D-6207, one per task.

- **D-6203** — `child-verified-build` (Task D-6203; spec §3.1, Q1): `ccd` spawns a `.child` row with `CCRC_CLAUDE_VERSION` set to the highest build on `APPROVAL_VERIFIED_BUILDS` (the bash twin of `APPROVAL_HOOK_VERSIONS`, held equal by iteration) that is installed, non-empty, executable, not halted and, once `claude-smoked` exists, smoked; it records `.childbuild`, writes `.approvals/child-build-keep` for the prune and one fleet-journal line; with no such build it spawns on the launcher's choice, journaled, with routing off for that child; it never blocks or delays a spawn and never changes a top-level row's spawn line; a lifecycle roll's `.rolling` and `.claude-build` take precedence when they exist. Off marker `child-build-verified-off`.
- **D-6204** — `approval-refusals-journaled` (Task D-6204; spec §3.2, Q1's alarm): every refusal of `POST /api/approvals` and of the rule and release routes appends `<epoch ms> <reason> <session id|-> [version=] [release=] [ms=]` to `APPROVAL_REFUSALS_LOG` (D-5490's file and first two words kept), and every `_hook_approval_wait` outcome for a `.child` row appends one line to `$REG/.approvals/routing.log`, both rotated at 1 MiB and holding no command text; doctor's `approval-routing` reports routable children, refusals and hook outcomes with fixes; the fleet frame carries `approvalRouting` from one pure summary, which the PWA shows as "permission routing off for N children: <reason>", rendering nothing when unmeasured. No decision changes.
- **D-6205** — `deny-superset-chain` (Task D-6205; spec §3.3, Q3): the installer, before replacing the children's deny file, appends the old file's exact bytes to `$REG/.approvals/child-deny.chain` when the new rules are a superset (empties it on a narrowing), and seeds the pre-#878 generation once; the server's `denyEngaged` and the hook's twin accept a child's digest when it is the current file's, or when a chain entry's bytes hash to it and all its rules are in the current file, with the shell pin still required; over-cap or malformed chains accept only the current digest. A9 (#1078) wrote no child-file entry. Off marker `child-deny-chain-off`.
- **D-6206** — `worktree-allow-class` (Task D-6206; spec §3.4, Q2): `approvalClass` gains `worktree`, a coordinator-allowable class for requests whose every statement is an `ordinary` shape, a `cd`/`pushd` at or inside the worktree followed only across `&&`, an allowlisted read or git read with every operand strictly inside the worktree, a redirect strictly inside it, or a `python3`/`python`/`node`/`bash`/`sh` run of an in-worktree regular file or a quoted-delimiter heredoc whose body passes the forbidden-verb, credential, path and process/dynamic-code scan; a directory change with an `rm` escalates; the server reads file bodies itself and signs their hashes, and the verifier re-hashes before printing; the children's PreToolUse deny reads interpreter files' bodies in `deny` mode. It widens D-5360's grammar by the operator's choice, for the worktree root only, and ships unarmed: allows engage only while `approvals-worktree-armed` stands; before that the request is stored `escalate` and journaled `shadow-worktree`. Marker `child-script-scan-off` undoes only the PreToolUse body read.
- **D-6207** — `approval-client-timeout` (Task D-6207; spec §3.5): `ccrc-api`'s 30 s client timeout against the server's delegation-pass stalls (about 31 s, 370 of 1,257 passes in 24 h) is measured from D-6204's journals; if any request times out or takes over 20 s, the hook bounds a main-thread request's total wait at `APPROVAL_COUNTDOWN_WINDOW_MS` from its own start and a subagent request's client timeout rises to 60 s through a bounded `--max-time` row, behind `approval-timeouts-legacy`; if nothing is measured in 7 days, this entry is the record and nothing changes. The stall itself goes to its own GitHub issue.

Issued and unused: 6208, 6209, 6210. They are held for this programme's departures, entered by the coordinator only, and never defined outside this plan.

## Out of scope

The approval window and late answers (D-5441, kept by the 2026-10-21 restatement); the asks lane; top-level sessions' prompts (the operator's by ruling); a fleet-wide `.pinned`; allow rules in settings; a brief rule telling children to write scripts to files (spec §3.6); interpreters beyond `python3`, `python`, `node`, `bash` and `sh`; reads in the tmp or scratch leaf for the new class; the lifecycle W2/W3 carrier, launcher and prune themselves (this plan only names how D-6203 meets them); the server's delegation-pass stall (its own issue); K5's question module (this plan's helpers move with it).

## Review log

**rev 0 (2026-10-21).** Written from the spec's rev 0 after the operator's 2026-10-21 ruling, measured on `origin/main` `26d57645b` with 23 open PRs (#1077 holds `ccd/ccd`; #960 holds the banner stack; #1050 and #1078 merged). Not yet reviewed.
