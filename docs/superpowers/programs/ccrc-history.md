# Program: ccrc-history

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.2, operator-approved design;
rulings Q1–Q14 of 2026-10-05; Q15–Q19 open)
Plans: `docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md` (waves 1 and 2: W1 Part A and W1-B1). The plans
for W1-B2, B3 and B4 are written by the coordinator while earlier waves run.
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-ridge`   Workspace: **a fresh child per wave** (one PR per child)

**What this program is.** ccrc keeps its own lossless, searchable copy of every Claude Code session transcript on
each box that hosts sessions, and gives a session a way to recall what it compacted away: a per-box SQLite store
(node:sqlite + FTS5) fed by a sole-writer indexer from hook spool lines, a DAG of summaries (native leaves first,
session-written leaves in W3), and a `ccrc history` CLI plus a skill. Modelled on lossless-claw (MIT), ported rather
than depended on (spec §11–§12). A replay eval (W2) decides whether W3 and W4 ship at all.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | W1 Part A: Node floor `>=22.16.0` in the three engines, node-floor assertion 4, the `node floor (22.16.0)` CI leg (plan Tasks 1–2) | engines + CI; full suite | #300 | **merged** 2026-10-06 16:53Z as `f7e51156f` (run 293, after review 298, fix round 1 and review 301) |
| 2 | W1-B1 "capture": `lib.mjs`, `store.mjs`, `sweep.mjs`, the shim, the hook's spool line, journal + pre-migration snapshot + purge carve-out, `status`, install/uninstall/deploy, doctor `history`, lifecycle rows, `measure-history.py` (plan Tasks 3–36). Sessions see no change | fleet (shim + timer); full suite (ci.yml) | — | run 302 dispatched 2026-10-06 16:58Z to a fresh child |
| 3 | W1-B2 "recall": read verbs, parser, native leaves, the skill, operator verbs (`prune`, `doctor --repair/--backup/--adopt/--restore/--rebuild/--migrate`, `reparse`), recovery step | fleet + skills | — | plan owed (coordinator) |
| 4 | W1-B3 "card line": scope marker, `_hook_history_card`, the S6-R11 census re-measure | fleet (hook) | — | plan owed; after wave 3 |
| 5 | W1-B4 "sole-copy export" (ruled Q6, e) | fleet | — | plan owed; after wave 3; **live on every session-hosting node before the earliest W1-k date, at the latest 2026-12-19** |
| 6 | W2: the headless seam, the replay driver, the quiz and the live A/B; the gate (ruled Q7, Q14) | fleet | — | after waves 3 and the backfill |
| 7 | W3: steering (session-written leaves) | fleet (hook) | — | only if the W2 gate passes |
| 8 | W4: subagents and `touched` | fleet | — | only if the W2 gate passes, and never before wave 5 is live |

## Decisions & deviations

- **Operator rulings 2026-10-05** (spec §15.1): Q1 fixed root + `db/` symlink; Q2 spool on PostCompact, Stop,
  SessionStart(startup|resume|clear); Q3 many fleet and many server boxes (one store per session-hosting box, none on
  a server box); Q4 the disk spec's `history` role; Q5 exact span partition; Q6 backup = pre-migration snapshot +
  retained journal + purge keeps the store + restore/rebuild in W1, sole-copy export before retention bites, no
  scheduled full copies; Q7 cluster-bootstrap gate; Q8 recall on every provider and lane, surviving provider
  migration; Q9 archive-quoted gists; Q10–Q14 as recommended.
- **Open operator questions Q15–Q19** (spec §15.3). Every wave follows the spec's stated default until answered:
  Q15 the ruled node-shortest export reducer (planExport takes per-file pairs, so a yes swaps one reducer); Q16 no
  `fork` spooling; Q17 the recommended purge wording (no behaviour change); Q18 is W2's; Q19 no hand-mapping mode.
- **Coordinator rulings at plan review (2026-10-06):** R1 — `sweep.mjs` and `cli.mjs` end in their entry guard, with
  no top-level await, and every later block is inserted above it; R2 — redaction catches a `RangeError` from the
  shape regexes on a multi-MiB run and redacts the whole run (fail closed), pinned at 16 MiB; R3 — a `statfs` that
  throws reads `low-disk` (spec §9.10's failure table).
- **How the plan was checked.** Eight batch reviewers, an integration reviewer and a refute pass per reviewer, then
  two smoke runs that transcribed every task into a throwaway worktree at `d12b5aba0` and ran it: every new
  history suite and every existing suite the plan edits passed (the one red, `tmp-sweep`, is red at the base too).
- **Departures.** The wave-1 plan's 95 departures were issued in one block by the allocator on 2026-10-06 (95
  numbers starting at D-4165) and are defined in the plan's `## Deviations found`, each beside its spec §16 slug.
  Each wave's run gets its own small block at run-open, named in its brief and written bare here until a plan on
  `main` defines it.
  - Run 293 (wave 1) held 4260 to 4265. It defined D-4260, D-4261 and D-4262 in the plan (on `main` with #300).
    4263, 4264 and 4265 were never used and stay unassigned.
  - Run 302 (wave 2) holds the 20 numbers 4296 to 4315, listed one by one in its brief.
- **Wave 1 reviews.**
  - **Review 298** (at `4f2ba96e9`) raised F1 to F6. Rulings:
    - F1 strengthen the O18 pin (D-4261);
    - F2, F3 and F6 prose fixes (D-4260);
    - F4 the probe child's spawn error surfaces as itself, under a timeout (D-4262);
    - F5 no change (squash merge).
    The worker ran one fix round.
  - **Review 301** (at `ea3b8f7d1`, the fix round) found every ruling landed as ruled, with each mutant red-first measured. Rulings:
    - F1 (a quoted `uses:` plus an expression `node-version:` still evades the pin) is the accepted stopping line for this regex guard: two deliberate evasions at once, while every ordinary spelling reds. No action.
    - F2: Part A's floor remedy in `ccrc-doctor-checks` and `install.sh` says a server below the floor "boots without ccrc history's search". History lives only on session-hosting boxes (Q3), and no server code uses FTS5. Carried into wave 2, which rewords both lines in place once the store exists.
    - The refuted finding (spec §9.9 "past 500 rows") needs no edit: §9.9 already names the forced `gc()` every 100 rows, and "past 500" is the row count.
- **Routing (clause 13).** Wave 1 is a dependent chain that fits one context: Opus · high main loop, Sonnet · high
  implementers, Opus · high per-task reviewer, workflows off, `compact 40`. Wave 2 (34 tasks) outgrows one context:
  the bulk row — Opus · ultracode orchestrating, Sonnet · high workers (implementation never below Sonnet · high),
  workflows on. Wave 2 also carries `compact 40`: its tasks are a dependent chain (lib, then store, then sweep), so
  later tasks should start lean even under an orchestrating main loop.

## Carried constraints

- **Order.** Part A merged first (#300). B1 has the 22.16 leg and the engines floor on its base.
- **Peer overlap in wave 2.**
  - Tasks 27 and 29 to 36 edit files that two open PRs in other programmes also edit:
    - #299, session continuity W4;
    - #248, landing order W3.
    Their coordinator, quiet-river, was told so (mail 3725). Whichever lands second resolves the conflict.
  - `session-hook.test.ts` (Task 29) was under claim 1049, child reclamation run 260, at dispatch. The worker
    defers Task 29 while that claim is live.
- **Before wave 2 converges anywhere:** on each session-hosting node that keeps its store on a volume, the operator
  links `~/.ccrc/history/db` onto it (spec §9.3: a 0700 root and target) before that node converges, or doctor FAILs.
  After merge, the operator runs the shim's `--op import --apply` from a shell (B1 has no CLI `import`).
- **Operator acts Part A names:** a read-only `node --version` on every node before Part A merges; optionally making
  `node floor (22.16.0)` a required check.
- **Disk-hygiene W2 is not on `main`.** Its pins O30/O31 join whichever of B1 and disk-hygiene W2 lands second
  (plan Task 34 holds the code). The disk spec (`2026-10-03-fleet-disk-hygiene-design.md`) is still on the
  coordinator's branch, awaiting the operator's review; it is not part of this programme.
- **The volume.** `~/.cc-tmp` leaks ccrc test fixtures (2,327 dirs older than 60 min on 2026-10-06); every wave's
  suites add to it until disk-hygiene wave 1 lands. Workers clean up the fixtures their own runs create.
- **Merge conflicts to expect** (spec §10.6): disk-hygiene W2 and GPT-lane Part 3a/3b edit `ccd/ccrc-doctor-checks`;
  landing-order and continuity edit `ccd/session-hook.sh`. The plan's line anchors are at `d12b5aba0`; a worker
  re-anchors by content on its own base.

## Next-wave brief

Wave 2 (W1-B1) is run 302, and its brief is below as dispatched (route: opus, ultracode, subagent sonnet, workflow on,
compact 40). Wave 3's brief (W1-B2 "recall") is written here when its plan lands. The coordinator writes that plan
against B1's real code while B1 runs.

```text
Run 302 - programme ccrc-history, wave 2: W1-B1 "capture". Coordinator: ccrc-pwa-quiet-ridge.

Ledger: docs/superpowers/programs/ccrc-history.md (on main).
Plan: docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md. Read its header first (Goal, Global Constraints with rulings R1-R3, Review Focus, the file map), then Tasks 3-36 in order. Tasks 1-2 (Part A) are MERGED: PR #300, f7e51156f. Do not redo them.
Spec: docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md (rev 3.2). The plan cites the sections each task needs. Q15-Q19 are open, and the spec's stated defaults are in effect.

Execution skill: superpowers:subagent-driven-development.
Commit on this workspace's own branch. Do not create or switch to a separate feature branch.

What the wave ships (one PR, "B1"):
- ccd/history/{lib,store,sweep,cli}.mjs with their .d.mts files, the MIT sidecar and PROVENANCE;
- the ccd-history-sweep shim and unit, and the ccrc dispatch line;
- the hook's tail spool block;
- install, uninstall and deploy wiring, with --purge keeping the store;
- doctor's history check, the lifecycle rows, single-definition O13/O14, and deploy/measure-history.py;
- the README and CLAUDE.md edits the plan names.
Sessions see no change. The PR edits .github/ and package-adjacent files, so CI runs the full suite. That is intended.

Base: main at f7e51156f or later.
- The plan's anchors were measured at d12b5aba0, and main has moved since. Re-anchor every Modify by its content; line numbers are hints.
- The citation-corpus files are edited in place or end-appended exactly as the plan says, never by inserting lines mid-file: ccd/session-hook.sh, ccd/ccrc, deploy/deploy.sh, README.md, ccd/ccrc-doctor-checks, session-hook.test.ts and single-definition.test.ts.

Order and peers (read GET /api/claims?project=ccrc-pwa before your first edit to any existing file):
- Tasks 3-28 work in new files, except README's append after ## License and the license test (Task 4), and ccd/ccrc with ccrc-cli.test.ts (Task 27). Do them first.
- Two open PRs in other programmes edit the files Tasks 27 and 29-36 touch:
  - #299 (session continuity W4): ccd/ccrc, ccrc-doctor-checks, deploy.sh, gen-wrappers, shared/lifecycle.ts, and the doctor, install, uninstall, lifecycle and single-definition tests;
  - #248 (landing order W3): ccrc-doctor-checks, session-hook.sh, the doctor and install tests.
- Before Task 27, check whether they have merged. If one has, merge origin/main into your own workspace branch and re-anchor.
- If they are still open, proceed. Whichever PR lands second resolves the conflict, and the end-appended and in-place shapes keep that small.
- server/test/session-hook.test.ts (Task 29) is held by claim 1049, which belongs to run 260 (child reclamation W5, PR #290). Peer claims are advisory, but you never edit a contested path. If 1049 is live when you reach Task 29, do Tasks 30-36 first and come back. If Task 29 is the only work left and the claim is still live, mail me.

Coordinator ruling carried from review 301 (F2), and this wave's job:
- Part A's floor remedy says that below the floor the server "boots without ccrc history's search". Two lines carry it:
  - the node-floor FAIL remedy in ccd/ccrc-doctor-checks (_dr_fail node);
  - the comment above `floor=` in install.sh.
- That is not true. History lives on session-hosting boxes, never on a server box (Q3), and nothing on the server uses FTS5.
- Once B1's store exists, reword both lines IN PLACE, keeping each file's line count (both are corpus files), to say what B1's code actually does when node:sqlite has no FTS5. Keep it short and accurate, and do not hard-code a version the line reads from package.json.
- Leave README :171 and CLAUDE.md's floor bullet alone unless B1 makes them false.
- Take a departure number for this edit.

Network: Task 20 Step 13 and Task 36 download the official Node tarballs from nodejs.org, checksum-verified, into the scratch path each names, and remove them afterwards. That is sanctioned. No other network use.

Live safety (on top of your skill and CLAUDE.md):
- Never run the shim, sweep.mjs, cli.mjs, the ccd-history-sweep unit or any `--op` against the live $HOME.
- Never enable or start a timer on this box, never run ccrc update, deploy or rollout, and never create ~/.ccrc/history.
- Fixture HOMEs only (historyHelpers.ts).
- Clean up every fixture directory your runs create. ~/.cc-tmp already leaks ccrc fixtures; do not add to it.

Suites:
- Run as each step states: from inside server/, ./node_modules/.bin/vitest run test/<file>.test.ts, in the foreground, with a Bash timeout of at least 600000.
- Re-run the CLAUDE.md load flakes in isolation before calling a red real.
- tmp-sweep's fail-closed environment case is red on this box at the base. It is not yours.

Task 34: disk-hygiene W2 is NOT on main, so O30/O31 take the plan's not-on-base arm.

Departures:
- The plan defines its own (from D-4165).
- For a departure you find while executing, take the next unused number from this run's block: 4296, 4297, 4298, 4299, 4300, 4301, 4302, 4303, 4304, 4305, 4306, 4307, 4308, 4309, 4310, 4311, 4312, 4313, 4314, 4315.
- Define it in the plan's "## Deviations found" on your branch, in the same commit that first cites it. Format, with the em dash the scanner keys on: "- **D-<n>** — `<slug>` (Task N): <why>".
- Never call the allocator, and never write a range.
- Run `deviation-refs` after `git fetch origin main` before each push.
- Name every number you used in your wave-done.

Not yours, and done by the operator or the coordinator after merge:
- merging;
- linking ~/.ccrc/history/db onto a volume;
- the shim's --op import --apply;
- every rollout.

Wave-done: when PR B1 is open, its required checks are green (build-pwa, test (pwa), test (agent), test (server); test-macos and probe-macos are advisory by ruling), and your branch tip is the PR head. Your fingerprint is the workspace branch tip.

Routing (clause 13; routing matrix row "Bulk independent work ... a wave larger than one context": 34 tasks outgrow one context):
- main loop: Opus, ultracode, orchestrating;
- implementer subagents: Sonnet at effort high (never below);
- per-task reviewer: Opus at effort high;
- scouts: Haiku;
- workflows on, compact threshold 40.
- Name the model and effort explicitly on every Agent and agent() call.
- Commit after each task. If the session dies, the branch is the resume point.

Questions go through the AskUserQuestion rule in your skill. I answer what the spec, the plan and the ledger already decide. Anything new goes to the operator.
```
