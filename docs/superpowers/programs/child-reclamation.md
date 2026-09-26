# Program: child-reclamation

Spec: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`
Plans: `docs/superpowers/plans/2026-09-22-child-reclamation-wave{1,2,3,4,5}-*.md`
Contract: `docs/superpowers/programs/child-reclamation-contract.md` (cross-wave names and types; §7–§8 rulings)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: **a fresh one per wave**
Ticket: CCR-15

**What this program is.** A workspace the coordinator dispatches is a *child*: declared as one by the server
at creation, never tended by a human, used for at most one PR, and reclaimed with its artifacts when its run
closes. Every other workspace — the operator's, the coordinator's, and every workspace that exists before
wave 1 ships — keeps today's human cleanup ceremony exactly. The operator's four rules and four rulings are
quoted in the spec's §1; §3 argues why an automatic collector is safe on this population when the one
removed on 2026-09-10 was not.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | `--child <runId>` on ws-add behind `child-argv-v1`; the `.child` marker; a child's `TMPDIR` under `~/.cc-tmp/<id>` on every spawn; the scratchpad measurement; the pre-policy count | **AGENT-FIRST** | #175 | **deployed** v0.0.19 (`bbb5e714`, 2026-09-23 15:46–15:51 UTC; run 131 on `keen-hollow`; reviews 135, 136) |
| 2 | the registry's three-way child reading; the three-valued spent verdict with a live measurement; `workspace-spent` and `spent-unmeasured` at open and at dispatch; dispatch clears a spent binding | server | #178 | **deployed** v0.0.22 (`37d9da66`, merged 2026-09-24 00:25 UTC, rolled out by 00:33 (rc 3: the server box's known inactive agent unit); run 138 on `plain-river`; reviews 144, 145, 147). Live measurement: an open naming `ccrc-pwa-plain-river` answered `409 workspace-spent pr:178` and left no run row |
| 3 | `ws-audit --reclaim` and its token; `ws-reclaim` with its own ladder, pin phase, tail arm and breadcrumb; the `reclaim` journal act; close's fourth act; delivery cancellation | **AGENT-FIRST** | #187 | **fix round done** 2026-09-26 at `f2b32a86` (run 148 on `plain-summit`); 3520 being defined, then the scoped review |
| 4 | the reclaim sweep over marked children; `ccd reclaim-pause` and its route and Runs-screen toggle; the attention list of unreclaimable children in the Runs banner | **AGENT-FIRST** | — | planned |
| 5 | the closed run's reclaim chip and its sentences | server + pwa | — | planned |

**Rule 3 is enforced at the end of wave 2** with no destructive verb in existence: a second bind on a
PR-bearing child refuses. **Wave 3 is the only wave that destroys anything.** Waves 3 and 4 do nothing on a
box whose ccd does not advertise their capability tokens; wave 2 does nothing to a workspace without a
marker, which is every workspace until wave 1 is deployed.

**This programme follows its own rule 3 from wave 1.** Every wave runs on a freshly dispatched workspace and
the coordinator opens wave N+1 without `sessionId`. Nothing enforces that until wave 2 ships; the
coordinator does it anyway, because a programme that builds one-PR-per-child while reusing one workspace
across five PRs would be arguing against itself.

**Deviation block: forty numbers, the first of them 3330** (allocated once at run-open, 2026-09-23; floor now
3370). No number of the block is spelled as a `D-` token here until a plan DEFINES it: `deviation-refs.test.ts`
reds on any tracked `D-` ref above the highest defined one, so an issued-but-undefined number in this file
would turn every commit red. Every wave draws from this block. A worker never calls the allocator (worker
clause 11): it names a departure in its wave-done mail and the coordinator assigns a number from the block.

Run ids: wave 1 = **131** (reviews **135**, **136**); wave 2 = **138** (reviews **144**, **145**, **147**); wave 3 = **148** (review **170**). Numbers defined so far: D-3330 … D-3339 in the wave-1 plan, D-3340 … D-3351 in the wave-2 plan. Wave 3 draws from the rest of the block.

## Decisions & deviations

- **2026-09-26 — wave 3's fix round done (`f2b32a86`, 31 commits); departures ruled; 3520 assigned.**
  - **The round.** All 23 findings were fixed, each through an Opus review and re-reviews until clean. Every number
    is defined in the commit that shipped its fix: 3367, 3368 and 3513 to 3519.
  - **Boundary.** Nothing new above `ccd/ccd:19131` except the authorised in-place `_session_probe` anchor (two
    lines), line-neutral comments, and F5's one in-place audit line. Line 19131 is byte-identical, and S6-R11 was
    green on every ccd commit.
  - **Suites.** The first full run caught one real red, the new `resume` words missing from the kebab guard, fixed
    in-round. The second: server 16339 passed, only the box-local `tmp-sweep` case red; agent 331; pwa 3010.
  - **Departures.** Covered by their fixes' numbers, apart from `index-copy-keeps-its-mtime`, which takes 3520. It
    also fixes a pre-existing WIP loss for ordinary tracked files (a same-second, same-size edit was left out).
    Accepted within the fixes:
    - a `..`-spelled row refuses even when it names an ancestor (narrow fail-closed);
    - `cmd_ws_audit --reclaim` is contained whole (wrapping only the fork left a hook running);
    - F20 recognises ccd's pinned pre-lock texts.
  - **F1's exit-empty exception matches real tmux.** Measured by the rulings' attacker on tmux 3.4 with an isolated
    socket: the last `kill-session` exits 0, then `no server running`.
  - **macOS at `f2b32a86` (CI run 36228530456).**
    - test-macos 2/2 (job 108367122769) passed: 211 files, 6668 tests. That covers the pin, audit, ws-reap and
      session-hook suites and the server's close, mark, prose and store cases.
    - test-macos 1/2 (job 108367122762) passed 59 files, including the verb suite (143, with the F1, F2, F3, F4 and
      F7 cases) and lifecycle-purge, then went silent at 08:26 and was cancelled at the 55-minute cap.
    - probe-macos (job 108367079482) failed only on the known D-2661 FIFO flake. Leg 2 passed the same file 7/7.
    - **Ruled: no re-run.** Leg 1's file list puts `ccgpt-proxy.test.ts` 19th, ahead of the ladder, `child-reclaim`
      and `wsaudit` files. A re-run wedges at main's hang before it reaches them. The ladder's Darwin evidence (the
      ported F23 normalise cases, A10 fail-closed, the F2 ladder cases) is therefore UNMEASURED. It is carried as a
      post-merge measurement for when that hang is fixed on main.
- **2026-09-25 — review 170 on wave 3 (`c5962a94`): four critical, seven important, twelve minor; ONE full fix round.**
  - **The panel.** Nine Opus lenses, SAFETY at xhigh; 126 agents; 32 findings survived and merge into 22; 7 were
    refuted. Suites green except the box-local `tmp-sweep` case. AGENT-FIRST, the run-id parses and fixture-only
    tests hold. Whole-branch (a), "nothing deleted that was not first kept", held only pending the critical rulings.
  - **The criticals, each a way to delete something not first kept:**
    - F1: rung 5 and the tail read an unreachable tmux as no session;
    - F2: a registry row nested inside the child is torn out;
    - F3: the reflog pin keeps the 200 lowest shas repo-wide, so the child's own reflog-only commits can be lost;
    - F4: `skip-worktree`/`assume-unchanged` edits are deleted unrecorded.
  - **The rulings were attacked before sending.** Three Opus agents found that my first F1 control would itself have
    reopened the D-308 fail-open, since `no server running` is `unknown`, never gone. They also found:
    - F1: the tmux exit-empty strand, and `_session_probe`'s missing anchor;
    - F7: `_svc_is_loaded` folds "could not ask launchd" into "not loaded";
    - F4: record-only contradicts spec §5.5 step 2 for non-secret tracked edits;
    - F3: nested branches' reflogs were missed, as were unreadable-reflog refusal and pin-before-delete order.

    Every amendment is incorporated. The full rulings travel with the fix-round mail, in the coordinator's clips as
    `rulings-review-170.md`.
  - **Rulings, in short:**
    - F1: `_session_probe` with an anchored target (one authorised line-neutral edit above the boundary); only
      `can't find session` is gone; the tail re-measures the pane, with one exit-empty exception;
    - F2: refuse a nested row (an ancestor row is not refused);
    - F3: the child's own reflogs pinned completely, old and new values, each before its deleting act;
    - F4: a hidden-flag edit goes through the secret classifier, kept in the WIP unless it is secret-shaped;
    - F5: the ladder's reads contained at `_ws_reclaim_fork`;
    - F6: the claim narrowed;
    - F7: stopped only on launchctl rc 113;
    - F8: numbered;
    - F9 to F13: sentences and prose made true;
    - F20: pre-lock dies recognised positively;
    - F21: `wip` discriminated;
    - every other minor fixed.
  - **Accepted:** the +35 lines above the boundary, which are code plus one-line pointers under plan rule R9.
  - **Numbers.** 3367 for F8 and 3368 for F11 and F13, from the programme's block. A new block, 3513 through 3520,
    was minted for this round's safety fixes; 3369 and 3520 stay unassigned.
  - **Advance commitment.** After this round, a review scoped to its commits. Only a destroy path, or a
    shipped-behaviour defect the round introduces, earns another send-back.
- **2026-09-25 — wave 3 in review.** The worker defined 3352 to 3366 in one docs-only commit (`c5962a94`); the
  commit's one moved line repointed the plan's own lens-1 citation. Run 148 advanced to awaiting-review, and
  review run 170 was dispatched with seven lenses: the held-out three, plus the plan's four, SAFETY at xhigh.
  - **macOS is partly measured.** test-macos 1/2 (job 108201932197) passed 210/210 files, including the ladder
    suite, so `find -perm`/`-quit` are measured on Darwin.
  - Leg 2/2 (job 108201932195) hung on main's `ccgpt-proxy` wedge after `ccd-ws-reap` and `ccd-lifecycle-purge`.
    The pin, audit and close suites are therefore unmeasured on Darwin. A re-run would hang the same way, and
    CI's workflow_dispatch cannot select files, so the review reads their portability by hand.
- **2026-09-25 — wave 3's wave-done at `fcd84cd0` (PR #187); re-measured; numbers assigned before review.**
  - **The claim holds.** PR #187 is open against main, and the merge base is current main (`dcac4691`, merged twice,
    never rebased). 70 files, +9616 lines, 38 commits under the noreply identity.
  - **What the worker measured.** The frozen boundary measured three times at `ccd/ccd:19131`. S6-R11 was paid per
    task, with the headline at 196. First full run on the merged tree: server 16187 passed, and the ONE red was the
    box-local `tmp-sweep` case. At the tip, server 16210, agent 331 and pwa 3010. The scratch-slug case is green in
    both TMPDIR arms (10b).
  - **Mutations.** Every task has a mutation table. The survivors are named double defences, and the final fix wave
    has 29 rows.
  - **Numbers.** Fifteen plan departures, one per task (T1–T10b, the merge), plus `wip-moves-no-ref` and
    `child-gitdir-proof-before-rung-6`. They are 3352 to 3366, to be defined in the wave-3 plan before the review
    opens.
  - **`wip-moves-no-ref` is ACCEPTED.** The WIP is built with `commit-tree` and pinned in the attic, and moves no
    branch or HEAD. "Pin everything" holds, and moving no ref is safer. The spec §5.5 step 2 wording follows later.
  - **Ledger-only.** T0's two commits are a brief-level departure. Tasks 2–4 ran Opus implementers where the brief
    said Sonnet, because the plan's routing row asked for Opus on the destructive ladder, pin and verb. That is a
    routing change under clause 13, judged right for the destructive tasks and recorded here; nothing is escalated
    or demoted.
  - **Open items ruled.** #1, the stranded held child, becomes contract R32 for wave 4's sweep. #2, a retry that
    re-stamps the birth, becomes R33 for wave 4. #3 to #6 are carried (Carried constraints). None destroys
    anything it should not, so none is a send-back.
  - **macOS.** `_ws_reclaim_residue` now derives its root from `${TMPDIR:-/tmp}` and is pinned. The normalise
    cases' `find -perm`/`-quit` await the PR's macOS leg.
- **2026-09-24 — main's macOS leg is red on wave 1's `_child_tmpdir`; fixed by a separate one-wave programme.**
  - **The defect.** `chmod 0700 -- "$dir"` puts `--` after the mode operand. BSD `chmod` reads it as a file and
    exits 1, so on macOS every child answers rc 2 and spawns uncontained. Reported by bright-river; upheld by a
    three-agent check (the runner's `chmod` is BSD, and every failure goes through that rc 2).
  - **Owner.** Programme `child-tmpdir-bsd` (ledger `docs/superpowers/programs/child-tmpdir-bsd.md`).
  - **Why it does not wait for wave 3's claim on `ccd/ccd`.** ws-slug-collision waited out wave 1's claim; this
    narrows that precedent. Two of this coordinator's workers may share a claimed file when the second's edit is
    line-neutral, in a function the first carries unchanged, and the first merges main before its PR as it must
    anyway. The only text both branches change is ccd's generated stamp line. Clause 10 itself governs splitting
    one wave across workers, which this is not.
  - **Not ours.** Main's macOS 3/4 cancellation is `ccgpt-proxy.test.ts` (#165) wedging the single macOS worker
    on every main run since 2026-09-22, before this programme existed. It also blocks stable promotion; it is
    reported to the operator.
  - **Wave 3 portability, from the same check.** `_ws_reclaim_residue` hardcodes `/tmp/claude-<uid>` where
    `ccd-tmp-sweep` uses `${TMPDIR:-/tmp}/claude-<uid>`, so on macOS it reads a measured-looking 0. Its `find
    -perm`/`-quit` are the first Darwin-reachable uses in ccd and need the macOS leg to confirm them. Both are
    mailed to wave 3's worker. Nothing else in its 1151 new lines is platform-sensitive.
- **2026-09-24 — wave 3 stalled for ~3 h after an account move.** At ~16:02 the worker moved from one wrapper
  to another at the weekly limit. The move stopped its background merge subagent (the merge commit `b05d0be5`
  had landed; its S6-R11 follow-up is unknown), and the resumed session never took a turn. Woken by mail at 18:59
  to verify S6-R11 on the merge and continue at Task 5.
- **2026-09-24 — scoped review 147 (`95703aa7`): accepted; wave 2 merges.**
  - **The panel.** 36 agents; 8 findings survived 3–0 and merge into 5 minors; 3 were refuted. All 12 mutations
    behaved as claimed; the named suites passed 1141/1141 and the ledger/topology suites 87/87.
  - **Ruling.** The round's advance commitment was that only a shipped-behaviour defect the round introduced
    earns another send-back. None did: every finding is a stale count, a comment or a commit message. Accepted,
    and the text corrections ride wave 3 as one declared item (Carried constraints).
  - **Three settlements on wave 3's A1**, because the round changed `childSpent` after the pre-flight read it
    (recorded under Carried constraints and in wave 3's brief).
- **2026-09-23 — wave 2 fix round done (`95703aa7`); scoped review 147.** The round fixed the null-tip fail-open
  and the malformed-head lines as one departure (3351) and review 144's ruled minors as another (3350).
- **2026-09-23 — scoped review 145 (`76594fec`): R28/R29 as ruled; one shipped fail-open; one tight round.**
  - **The panel.** 28 agents; 7 findings survived 3–0 and 1 was refuted. 11/11 mutations red, suites green, the
    remerge-diff empty.
  - **The fail-open that earned the round.** A marked child whose registered branch no longer resolves (renamed
    in place) gives ccd a `tip:null` line with no rows. The server read that as `unspent`, and the bind was
    permitted. It predates the fix round but is wave 2's own code, so as committed it is a shipped-behaviour
    defect.
  - **Fixed in the round, as one departure:** that fail-open, plus malformed-head lines answering `unmeasured`.
  - **Bookkeeping under one number:** review 144's ruled minors, which changed plan-prescribed text.
  - **Four small test and prose leftovers** are fixed now rather than carried into the destructive wave.
  - **Numbers.** Two new, 3350 and 3351.
- **2026-09-23 — wave 2's fix round done (`76594fec`); scoped review 145; wave 3 pre-flight started.**
  - **The round.** Every ruling applied, and each fix group got its own review. The R28 measurement passed on
    the real read path: ccd lists `gh pr list --head <branch> --state all` with no base filter.
  - **#177 merged in** from main, clean (no rebase; nothing touched `shared/api.ts`).
  - **First full suite.** Red only on the carried `tmp-sweep` case and a `ccrc-doctor` case that was green
    alone.
  - **Review 145.** Scoped to the round (base = the merge commit). It adds an xhigh fail-shut lens on the two
    changed reads.
  - **Wave 3 pre-flight.** Started in parallel as a workflow, because R28's broader `spent` meets wave 3's
    close-act eligibility. A no-PR child on a recycled slug must not be reclaimed as spent.
- **2026-09-23 — review 144 on wave 2 (`08e40675`): four important, twelve minor; the last full fix round.**
  - **The panel.** Six lenses (the held-out panel plus the plan's three; the fail-shut lens at xhigh), 99
    agents, 25 survivors merged into 16 findings, 6 refuted. Whole-branch: nothing destroyed, wire additive
    with one reader, citation tax paid per commit (green at each of the three commits). Fail-shut held
    everywhere except two reads that take "none" at its word.
  - **Rulings, with contract §9 R28 and R29 written the same hour:**
    1. **Spent means OPENED from the branch.** A same-repo PR whose head is the child's branch spends it,
       even when it does not bind: a stacked base, or a head the local tip does not contain. Measured first on
       the real read path. If ccd's line cannot carry unbound rows, this goes to wave 3.
    2. **A listed-but-absent marker is `unreadable`.**
    3. **Every `unbound:false` names its cause.** §2 says stop on a permanent cause, and otherwise retry once.
    4. **The actor pin binds the call site's value.**
    5. **The minors are all fixed.**
  - **Held items.** A same-project producer's exact SHA is its verified `handoffCommit`, proven merged by the
    PR's `headRefOid`.
  - **Numbers.** Ten assigned, 3340 through 3349.
  - **Named in advance as the last full fix round:** a scoped review follows, and only a shipped-behaviour
    defect sends it back again.
- **2026-09-23 — wave 2's wave-done (PR #178, `08e40675`); review 144 dispatched.**
  - **The claim.** Tasks 1–7 through Step 5, plus the declared wave-1 prose item. Main had not moved, so no
    merge was needed. The server accepted the claim; 8/8 items settled.
  - **First full suite red** (`failure: unclear`). Load flakes, each green alone (`boot`, `ccrc-update`, a
    `session-hook` p95), and the carried `tmp-sweep` case. Run with `TMPDIR=/tmp` as ruled.
  - **Citation tax** paid in each of Tasks 1, 2 and 5's own commits. README's `shared/api.ts` anchors moved
    by content; the census entry stayed at 1 and the sum at 195. Registry-read census 30/31/721 → 31/32/745.
  - **Six departures numbered 3340 through 3345**, to be defined in the plan with the review's fix round:
    - task4-first;
    - anchors-measured-not-plan;
    - mutation-row1-6-of-8;
    - run-routes-stale-sentences;
    - fresh-child-default-branch-prose;
    - leftovers-60s-lane-remote-only.
  - **Five items the worker left for a ruling**, held until the review reports:
    1. a DANGLING-symlink `.child` reads as a proven ENOENT, so `none`, so a bind is permitted;
    2. which exact SHA proves a same-project spent producer merged;
    3. the wave-1 plan still says 13/13 at :1328;
    4. two wording minors in SKILL.md and wave-lifecycle.md;
    5. an unreachable `unbound:false` with no detail.
- **2026-09-23 — wave 2 stalled on claims; ruled to proceed.**
  - **The stall.** At about 17:00 UTC run 138 had Task 4 and the carried prose done, and was blocked on
    Tasks 1, 2, 3, 5 and 6. run 128 (centralised-update-management W2, `warm-river`, PR #176) holds claims
    735 and 736 over `shared/api.ts`, `store.ts`, `watch.ts`, `server.ts`, `README.md` and
    `fleet-health.test.ts`. The worker's mail to warm-river had sat queued for about 45 minutes behind its
    not-idle gate. #176 was still `working` at 22,880 lines.
  - **The ruling.** Proceed with narrow, additive hunks. Claims are advisory: they buy an early answer
    instead of an end-of-wave conflict, and waiting would have stalled all five waves for hours. Whichever
    PR merges second merges main (never rebase), resolves, re-points and re-measures. warm-river's
    coordinator, `bright-river`, was told and invited to object (mail 2235).
  - **Two worker findings carried to wave 3** (see Carried constraints).
- **2026-09-23 — wave 1 deployed; its two measurements; wave 2 dispatched.**
  - **Rollout.** `ccrc rollout --to v0.0.19`, default order (fleet box first), exit 3. Both boxes moved from
    v0.0.15 and agree at `bbb5e714`. The release also carried #171, #173 and #174, which had never been
    rolled out.
    - Fleet box doctor: 0 failed, 5 warned, all pre-existing kinds.
    - Server box doctor: its one FAIL is the old inactive `ccrc-agent.service` unit on a server-role box,
      which is the operator's to clear and predates this programme.
    - Before moving, #171's two new files (`ccgpt-proxy.py`, `ccgpt-usage.py`) were checked on the fleet
      box: neither path was occupied, and no live OpenClaw file names them. The shared unit pair stays
      unplaced (D-3172).
  - **Measurement (a): the scratchpad FOLLOWS `TMPDIR`.** Wave 1's quiescent probe found Claude Code's
    per-uid root under `TMPDIR`, with nothing under `/tmp/claude-<uid>` for that cwd. A child's harness
    scratch therefore dies with its temp root.
  - **Measurement (b): the pre-policy stock.**
    - Pre-merge snapshot, 2026-09-23T12:49:56Z: 27 workspaces, 0 marked.
    - **Shipping figure, 2026-09-23T15:52:17Z, right after the rollout: 31 workspaces, 0 with a `.child`
      marker, 31 pre-policy, 5 of them archived.** That is the stock this programme never reclaims.
    - It includes this programme's own earlier children (`keen-hollow`, `amber-summit`, `plain-ridge`),
      minted before the ccd shipped, and `warm-hollow` (ws-slug-collision, dispatched minutes before the
      rollout). They keep the human ceremony.
  - **Wave 2's dispatch is the first marked child.** `ccrc-pwa-plain-river.child` holds `138`, and
    `~/.cc-tmp/ccrc-pwa-plain-river` exists at 0700.
- **2026-09-23 — wave 1 accepted and merged (`bbb5e714`, #175).** Scoped review 136 over `31c11916..4c23fa25`:
  the held-out panel, 30 agents, nine raw findings, none refuted, merged into six. None is a shipped-behaviour
  defect. Two are false prose in the new `wave-lifecycle.md` sentence: its remedy does not fit the causes it
  lists, and it misses the empty-list case. Four are plan text left stale: row 9's old title, two more copies
  of the census over-claim, and the suite size. As committed before that round opened, the wave is accepted
  and all six are carried into wave 2 as one declared item (see Carried constraints). Two rulings go with
  them: the census over-claim is narrowed wherever the plan states it (plan:49, :843, :984, :1344); and prose
  added under a ruled deviation gets no content pin, since the mutation doctrine binds guards and a prose pin
  against prose is green while both lie. Required checks green on the PR; the macOS leg is non-required and
  was still pending. Merged with `--admin`. Contract §9 (R24–R27) records wave 1's four rulings.
- **2026-09-23 — the last fix round done; scoped review 136 dispatched.** Tip `4c23fa25`: two commits, `ccd/ccd`
  untouched; row 4 re-spelled and measured red on exactly its one case (17/18); the `child-omitted` sentence
  added; the census title narrowed; the count corrected. Touched suites and guards green; `suite: unrun`, as
  ruled. Review 136 reads `31c11916..4c23fa25` on the held-out panel alone. Its first dispatch answered a bare
  502: `ws-add` picked the slug `quiet-delta`, and `git worktree add` refused because a branch `ws/quiet-delta`
  from 2026-09-17 still exists. Nothing was created (run still `planned`, no worktree, no registry row), so it
  was retried once and landed on `plain-ridge`. **An observed ccd defect, outside this programme's scope:**
  `_ws_slug_free` asks only the registry, never whether `ws/<slug>` exists as a branch, so a random pick can
  collide with any leftover branch. Measured the same hour: 27 of this repo's 33 `ws/*` branches have no
  registry row. The operator asked for it to be fixed: its own programme, `ws-slug-collision` (run 137).
- **2026-09-23 — review run 135 on `31c11916`: six minors, no shipped-behaviour defect; one last fix round.**
  Six Opus lenses (the held-out panel plus the plan's three), 51 agents, none died, nothing unexamined;
  whole-branch points (a)–(e) hold; suites green but for the carried `tmp-sweep` case and a `boot.test.ts`
  load flake green alone. Rulings: (F1) mutation row 4, stale since the marker ruling, is re-spelled against
  the shipped line inside that ruling's number; (F2) `wave-lifecycle.md` §2 gains one sentence naming the
  no-evidence cause of `child-omitted` (a server holding no caps list), a new number; (F3) the run-id census is
  a literal-absence pin, accepted as that — its title narrowed, a new number — and wave 3's review reads every
  new run-id parse for a call to `_child_runid_valid`; (F4) no second `-L` after the `chmod`: a path can be
  swapped at any later moment, so it moves the window rather than closing it, and wave 3's tail, which never
  follows a link leaf, is the defence; (F5) a count corrected 18 → 19; (F6) a commit message's false
  "already", recorded only. **Named in advance as wave 1's last fix round:** its review is scoped to the
  round's commits, and anything it finds that is not a shipped-behaviour defect is carried forward and the
  wave accepted with it recorded.
- **2026-09-23 — wave 1's fix round done; review dispatched.** Tip `31c11916` (the marker ruling line-neutral,
  its new case red 5/5 on the old test; the eight numbers defined; `origin/main`'s #174 merged in, no
  rebase, citation corpus re-measured unchanged). Suite red only on the carried `tmp-sweep` case. Review
  run 135 dispatched on the held-out panel plus the plan's three lenses (six Opus lenses). Two things the
  worker flagged are the coordinator's and are owed after the merge: the contract's §1 "non-empty" wording
  (superseded by the marker ruling) and the gap below for live children.
- **2026-09-23 — wave 1's first wave-done, sent back before review for two rulings.** PR #175, tip
  `08442ef4`, re-measured and accepted by the server (`awaiting-review`, 6/6 items). Its report asked
  two rulings, both ruled and sent back in one fix round so the held-out review reads the final tip once:
  (a) `_child_tmpdir` judges the marker with `_child_runid_valid`, not a non-empty test — one run-id
  grammar for every ccd reader of the marker, and a corrupt marker's scratch stays where `ccd-tmp-sweep`
  collects it (a contract change: §1's "non-empty" is superseded); (b) a child's `~/.cc-tmp/<id>` left
  behind by a human verb has no collector — it gets one in wave 4 (a leaf with no registry row,
  twice-observed, only on a clean listing, `reclaim-paused` honoured, never following a link), and the
  interim leak until wave 4 deploys is accepted. Eight numbers of the block are assigned for these two and
  six departures the worker named (probe location; the probe re-run; two test-hygiene fixes from its own
  final review; stopping at Step 6 per the brief; an out-of-scope README anchor repair), defined in the
  wave-1 plan by the fix round. The measurements: the scratchpad **follows** `TMPDIR` (a second,
  quiescent probe; the first was confounded by a concurrent subagent and a probe directory under a path
  containing `/scratchpad/`); a pre-merge snapshot counts 27 workspaces, none marked (5 archived) — the
  shipping figure is owed after rollout. First full suite: red (`failure: unclear`) — a `boot.test.ts`
  load flake, a `typecheck-tests` install-order artifact, and `tmp-sweep.test.ts`'s "FAILS CLOSED" case,
  which the worker measured red on an untouched `aed80210` while CI's test-server leg passed on main:
  box-environment, not this wave's. No routing change: the red is not the worker's.
- **2026-09-23 — documents merged, wave 1 dispatched.** Spec, contract, ledger and plans reached main as
  `aed80210` (#173; the non-required macOS leg was cancelled at its time limit with no test failed). Run 131
  dispatched into a fresh child; `skillState: present`.

- **2026-09-22 — the design, its four rulings, and the accepted spec.** The operator gave four rules, then
  ruled on four questions: pin everything then reap; a PR *opened* spends a child; transcripts are kept;
  kill-switch plus attached-defer. The first form of the design was reviewed adversarially before approval
  (six lenses, 44 findings, three refuters each, 38 survived); the spec's Appendix B records what each
  changed.
- **2026-09-22 — delivery cancellation moves to wave 3.** The spec's §5.6 made it part of the reclaim act
  while its wave table placed it in wave 4. Corrected in the spec before any plan was written: shipping
  reclaim-on-close without it would run the slug-recycling hazard at the new rate for as long as wave 4
  took. Not a deviation — the spec was self-inconsistent and was fixed at the source.
- **2026-09-22 — the artifacts section reconciled with `ccd-tmp-sweep` (#168).** That sweep landed the day the
  spec was written and gives `/tmp/claude-<uid>/` its first collector. Its root and a child's
  `~/.cc-tmp/<id>` are disjoint; the spec's §5.2 states the one consequence (a child under a terminal
  refusal keeps its temp root).

## Carried constraints

Findings every wave's reviewers get, because each is easy to lose between waves:

- **Two authorities, always.** Child-ness is the box marker AND the server's `--child-of` argv, equal. No wave
  may add a path that infers child-ness from anything else — not `--no-rc`, not a dec reason string, not a
  run row alone.
- **No boolean at the child seam.** The registry's reading is three-way (not a child, child with run id,
  unreadable) and the spent verdict is three-way (spent, unspent, unmeasured). An unreadable marker REFUSES
  a bind and DEFERS a reclaim; an unmeasured spent verdict REFUSES a bind. Any wave that collapses either
  is reintroducing the fail-open the spec's Appendix B item 6 exists to prevent.
- **Every new surface is capability-gated and read with `capSupported`**, never `verbSupported`, which
  permits when the box's verb list is absent. Three tokens: `child-argv-v1` (wave 1), `reclaim-v1`
  (wave 3), `reclaim-pause-v1` (wave 4).
- **The pause file is read inside `ws-reclaim`**, on the fresh path and on resume. A server-side check alone
  fails open into deletion.
- **`ws-reclaim` never resumes `ws-reap`'s work and vice versa.** The breadcrumb value is `reclaim:<phase>`;
  a mismatched flavour refuses.
- **Every CITED file pays the citation tax.** An insertion into `ccd/ccd` or `shared/api.ts` (the files the
  README and the frozen compaction-card corpus cite by line) pays S6-R11 in the same task, and edit length
  above the frozen corpus's highest `ccd/ccd` anchor is a decision: prose there stays length-neutral, long
  comments go below it.
- **Another programme holds claims on files waves 2–5 edit.** At run-open (2026-09-23) the
  centralised-update-management workers (runs 128, 129) held claims covering `shared/api.ts`,
  `server/src/coord/schema.ts`, `ccd/ccrc` and `ccd/ccrc-doctor-checks`. Wave 1 touches none of them. From
  wave 2 a worker's `POST /api/claims` may answer 409 naming that holder; the claim protocol (worker clause 11)
  is the answer — mail the holder, work what is uncontested — and a long stall is reported, never forced by
  the worker. The COORDINATOR may rule it to proceed (done for wave 2, 2026-09-23), telling the holder's
  coordinator; the second PR to merge pays the conflict.
- **A journal line with no `at` is invisible to the generation fence and the attention list** (contract §8
  R22′, D8: the ingest time is never an event time). Two consequences are accepted, not fixed: a terminal
  refusal journaled without `at` keeps its child out of the sweep but off the attention list, and a clockless
  `create` cannot fence a recycled slug. ccd writes `at` from one clock read on every line, so both need a
  corrupt or degraded journal; a reviewer who finds a real producer of clockless lines reopens this.
- **A child's temp root outlives a human verb until wave 4.** `ws-rm`/`ws-reap`/`ws-gc --prune`/`forget` on
  a child drop its marker and keep `~/.cc-tmp/<id>`; wave 4's sweep is its owner (ruled 2026-09-23 on
  wave 1's report). Wave 4's plan gains that task before its dispatch. And from wave 1's deploy until
  wave 3's, NO child's temp root is collected, live or finished: they accumulate, still marked, and wave 3's
  reclaim and wave 4's sweep take them.
- **Wave 1's six prose leftovers ride wave 2 as one declared item** (review 136). All of them are text, and none
  is shipped behaviour:
  - `ccd/coordinator-skill/references/wave-lifecycle.md` §2's `child-omitted` sentences get one remedy per cause:
    - the local boot window and a remote list-less or EMPTY-list ready frame both clear within about a minute,
      with no action (the watcher's 60 s caps lane);
    - a failed local caps probe needs a server restart;
    - an agent that stays list-less past that lane needs its ccd or agent looked at.

    The rewrite must still agree with the next sentence, "not an error". D-3338's bullet in the wave-1 plan
    says "two sentences" and matches the text.
  - The wave-1 plan's census over-claim is narrowed wherever it is stated: :49, :843, :984 and :1344 (row 9's
    old title). D-3339 says so.
  - Task 2 Step 7's "13/13" becomes 18/18, and D-3336 names the five invalid-marker cases it added.
- **Two declared items for wave 3, found by wave 2's worker.** Wave 3 is the next wave that edits ccd.
  1. **The scratch-slug guards do not know a child's temp root.** `-tmp*|-private-tmp*|-var-folders*|-private-var-folders*`
     is spelled at `ccd/session-hook.sh:712`, `ccd/ccrc:3486` and `ccd/ccrc-doctor-checks:4670`. A claude
     session rooted under `$HOME/.cc-tmp/<id>` therefore gets a durable memory store, and
     `session-hook.test.ts`'s "skips a scratch slug" case reds inside every marked child (its `os.tmpdir()`
     is that root). All three guards must learn the `$HOME/.cc-tmp/` shape; the second and third files may be
     claimed by the update programme. Until then, a child runs that suite with `TMPDIR=/tmp` and names the case.
  2. **(MOVED TO WAVE 4 by the wave 3 pre-flight's R-5: since R28, `childSpent` never reads `ours`.)**
     **ccd's PR ownership read folds a failed git read into "not ours".** `is_ours` (ccd ~5423) folds a failed
     `git cat-file`/`merge-base` into False. A transient git failure therefore reads a real PR as absent,
     and wave 2's `childSpent` answers `unspent`, which permits a bind. The read becomes three-valued: an
     unreadable answer is `unmeasured`, which already refuses. This is the programme's no-boolean rule, one
     layer down.
- **Wave 3: a recycled slug inherits its head name's PR history** (ruled 2026-09-23 on wave 2's F1 fix).
  Slugs recycle within a 144-name namespace per project; 12 are already PR heads on this repo. `gh pr list
  --head` returns every PR ever opened from that head name. Since R28 counts unbound rows, a child on a
  recycled slug reads `spent` from birth. That is safe, and it costs only a re-bind of a research child: a
  fresh child is never gated. Wave 3 adds `createdAt` to ccd's `PR_JSON_FIELDS`, and a same-branch row then
  counts only if it was created at or after this incarnation's birth. A row with no readable `createdAt` still
  counts.
- **Wave 3 is amended before dispatch** (pre-flight, 2026-09-23; the plan's appended "Pre-dispatch amendments",
  contract R30 and R31). Among them:
  - the incarnation rule, as a new Task 7b;
  - the close reclaims on `spent` only when this incarnation's PR is dated;
  - the reclaim never follows a symlinked workdir, nor acts on a workdir another registry row names;
  - the scratch-slug guards, as a new Task 10b;
  - claims proceed as in wave 2.
- **Wave 3 settlements on A1** (2026-09-24, after wave 2's last round moved `childSpent`):
  1. The live rung's order at `95703aa7`:
     - a non-string `branch` → unmeasured;
     - any same-repo same-branch row → spent, naming the highest number;
     - a non-fork row with a non-string head → unmeasured;
     - an unestablished repository → unmeasured;
     - a non-string `tip` → unmeasured;
     - then `phaseFor`.

     A1's placement goes inside the same-repo same-branch step.
  2. "Only `inherited` rows are dropped" means dropped from every later step, `phaseFor`'s `boundRow` included.
     The tip-rung comment's "boundRow can only return null here" stays true, and an inherited-only line answers
     unspent even when the old row would bind the tip (the merge-commit shape). That case is added.
  3. R-2's row placement is `this | inherited | unplaced`. A birth that cannot be placed is the birth's own arm.
     The round's local `unplaceable` (a non-fork row whose head cannot be read) is neither. No two meanings share
     one word.
- **Review 147's text corrections ride wave 3 as one declared item** (docs and comments only; D-3350 and D-3351
  are edited in place, with no new numbers):
  - F1: the wave-2 plan's rows 2 and 7, and D-3350, name the commit their counts were measured at (90c51032, 62
    cases), or are re-measured at `95703aa7` (65/65; 61/65).
  - F2: `child-reclaim-spent.test.ts` (xii)'s comment gets the true reason: no case covered an ABSENT `tip` key.
  - F3: `child-reclaim-refusals.test.ts`'s sha-tip comment is narrowed to `noPrLine`.
  - F4: `childSpent.ts`'s tip-rung comment attributes the null half to its sources and claims the absent half as
    3351's own.
  - R1: case (vii)'s label reads F7, and D-3351's "for either" gains "for every row with a string head".
  - `wave-lifecycle.md`: a repeated `spent-unmeasured` usually means the child's branch no longer resolves (a hand
    rename), and the next run opens on a fresh child instead of retrying (review 147's dissenting refuter).
- **Wave 4 also inherits from wave 3's fix round** (2026-09-26):
  - the tail's anchored `kill-session` has no deadline (pre-existing);
  - `_ws_tombstone`'s `reflog` field still writes `reflog show --all | head -200`, other sessions' commit ids, into a
    child's tombstone, beside `_ws_attic_pin`'s capped read;
  - `_ws_tombstone`'s comment is inverted under branch drift (F8);
  - a nested checkout's held `index.lock` is checked nowhere, so a nested tree mid-write is committed from disk;
  - "before wave 1's deploy" in `wave-lifecycle.md` and the coordinator SKILL.md (#178) has F11's problem;
  - the reclaim verb suite runs ~414 s against a 600 s ceiling; split it;
  - `ccd-child-reclaim-ladder`, `child-reclaim` and `wsaudit` are unmeasured on Darwin, because main's macOS hang
    precedes them in leg 1. Measure them on the first macOS leg that gets past `ccgpt-proxy.test.ts`, and report the
    job id.

  Accepted residuals, all fail-safe:
  - an aliased `..` row through a link to a standing child is not refused;
  - an exec-bit-only change on a flagged file is not an edit;
  - launchctl's rc 113 is taken from ccd's measured comments, not measured on a real macOS.
- **Wave 4 also carries review 163's three test-text minors** from `child-tmpdir-bsd` (#185), in
  `server/test/ccd-child-tmpdir.test.ts`:
  - the census comment should name line continuation among its blind spots, or join `\`-continued lines first;
  - "the decision lives in _spawn_start" should move out of the `describe.each(CHMODS)` block, or its plan
    entry should be narrowed;
  - the shim comment's "on macOS the real chmod is already BSD" should say it was measured on the CI runner.
- **Wave 4 inherits from wave 3's wave-done** (2026-09-25):
  - contract R32: the sweep reclaims a child held by a programme that has retired, and `not-finished` splits into
    three words;
  - contract R33: birth is the FIRST dispatch stamp;
  - the close's two pr-state calls run inside the coordination mutex for up to ~40 s, against the client's 30 s
    timeout. Bound them, or document the client-side retry;
  - coordinator clause 3 says "reclaimed … when that child's run closes", which overstates for review children and
    non-final closes. It is pinned verbatim, so the change needs a test edit;
  - `wave-lifecycle.md`'s "commits … on the child's branch" is wrong under `wip-moves-no-ref`;
  - the fail-safe portability residuals, recorded, not scheduled:
    - no `origin/HEAD` refuses every child `branch-elsewhere`;
    - git ≥2.48 relative worktree paths refuse `containment-unproven`;
    - a SHA-256 repository gets `pin-failed`;
    - two terminal `tree-unreadable` residuals;
    - an unsearchable `$REG`, clips or temp root.
  Spec text owed by the coordinator's docs PR: R30's placement is in the contract only, while comments cite §5.3;
  §5.5 step 2 needs rewording for `wip-moves-no-ref`; §6 and Appendix A carry T1's counts.
- **Wave 4 inherits, from wave 3's pre-flight:**
  - `is_ours` three-valued;
  - a `ws-reap` guard mirroring R31's symlinked-workdir refusal (`ws-reap` is human-gated but follows the link the
    same way);
  - the sweep as the owner of a child whose close trigger was lost to a server restart, or that wave 2's dispatch
    refusal released.
- **Wave 5 inherits:** the PWA's abandon confirmation says the child's workspace will be reclaimed. The ungated
  abandon door (D-282) reaching a destructive act is inside the single-user trust model; it is recorded, not
  changed.
- **Wave 4 also carries ws-slug-collision's review residue** (that programme's ledger, "Residue"). It is two
  unpinned arms of `_ws_slug_git_state`, plus header and plan wording, plus two fail-closed narrowings. It is
  ccd-only and below the frozen boundary, and it rides wave 4 because wave 4 edits ccd anyway.
- **Wave 3 inherits two readings from wave 1's review.** Every run-id parse wave 3 adds calls
  `_child_runid_valid` — the census only catches a verbatim second copy, so the reviewers check it by
  reading. And `_child_tmpdir` checks the leaf for a symlink once, before `chmod` (contract R1, check-once
  under the single-user trust model): wave 3's tail must re-judge the leaf at removal time and never follow
  a link.
- **`tmp-sweep.test.ts`'s "FAILS CLOSED" case reds on the fleet box on an untouched main** (wave 1,
  2026-09-23) and passes in CI. A reviewer who meets it measures it against the base before calling it a
  wave's.
- **Anchors in these plans are snapshots.** Two other programmes (centralised-update-management W2–W5,
  gpt-lane 2b/3) are live against the same files. Every plan locates code by content; its line numbers are
  not addresses. `ccd/ccd` edits re-stamp and pay the citation-corpus tax.

## Next-wave brief

**Wave 3 is dispatched (run 148).** Brief: the plan with its binding Pre-dispatch amendments; contract §9 R24–R31; the
three A1 settlements and review 147's text corrections above. Its review panel keeps the plan's mandatory xhigh
safety lens. After it merges: roll out AGENT-FIRST (fleet box first), then write wave 4's plan amendments
(R25's orphan roots, `is_ours` three-valued, the `ws-reap` symlink guard, lost close triggers, the slug residue)
before wave 4 dispatches.
