# Completeness critique — what is missing before (a) a build-ready worktree-ownership spec and (b) a migration prompt

Read in full: `ccd-map.md` (955 l, incl. Verification), `git-empirics.md` (748 l, incl.
Verification), `cc-conventions.md` (479 l), `surfaces.md` (410 l), `migration.md` (589 l),
`breaker.md` (542 l), `conductor.md` (122 l).

New measurements taken for this pass (read-only, nothing outside the scratchpad written):

| fact | measured now | as stated to me |
|---|---|---|
| free disk on `/` (holds `/mnt/srv-volume`) | **48G avail**, 84% used | 51G |
| `.claude/worktrees/` children | **38 dirs, ~26.3G** (expoAI 20G, custom-tools 5.0G, orchard-api 707M, intake-platform 613M, rp-llm 16M, MekWarLive 0) | 37 trees / 26 GB (breaker, ccd-map) |
| RAM | 30G total, **22G available, 5G of 7G swap in use** | — |
| `ccrc-pwa/.git/info/exclude` | **no non-comment lines** — ccd has never written `.ccrc/` there | — |
| `ccrc-pwa/.gitignore` | 14 lines; **no `.claude/worktrees/`, no `.worktrees/`, no `docs/`** | — |
| `ccrc-pwa/` extra dirs | `.superpowers/sdd/`, `.remember/` present, **neither ignored nor in the manifest allowlist** | — |
| monorepo `.github/` | **does not exist** (freeze guard = first workflow ever) | matches migration.md |
| `ccrc-pwa/docs/` | **does not exist** | matches migration.md M4 |
| `scripts/extraction-manifest.sh` standalone walk | `server agent pwa shared deploy ccd scripts .github` + `README.md`; excludes `*/server/test/ccd-ccclip.test.ts`, `*.tsbuildinfo`, dist/node_modules | — |

---

# 1. Contradictions found

## C1 — `ccd-map.md` contradicts itself on the single fact that orders the whole build, and the contradiction is in the table an implementer will copy

`ccd-map` §2 ("**THE TRAP**"), §4 Phase B, and §10 row #13 all say: children are safe today because
`.claude/` is *untracked*, and adding `.claude/worktrees/` to `info/exclude` is "**critical, and
LAST**" because it is what makes children deletable.

`ccd-map`'s own Verification **R1** refutes that: 6/6 projects that host children already ignore
`.claude/worktrees/` in committed `.gitignore` (and 3 of them also in `info/exclude`). `breaker.md`
§0 measures the same list independently. So the destruction path is **live in shipped ccd today**;
#13 is a low-risk belt-and-braces edit, not the enabling change.

Why it matters: §10 is the build-ready artifact of that report. Its ordering ("#13 after #5 and
#10") reads as *"we have time"*. The true statement is *"#5 and #10 are the missing mitigation for a
condition already in production on six projects, one of which holds 20G of children."* A spec
written from §10 as-is will sequence a hotfix as a nice-to-have.

**Also unresolved inside that same contradiction:** `ccrc-pwa` — the repo goal (2) makes canonical —
is **not** in the 6. It has no `.claude/worktrees/` ignore and no ccd `.ccrc/` exclude. See C9.

## C2 — three different opinions on the `info/exclude` edit (ccd:913), and no report picks

| report | position |
|---|---|
| `ccd-map` §2 / §10 #13 | add `.claude/worktrees/` **and** `.worktrees/`, as a loop; critical, last |
| `ccd-map` Verification R1 | still add it (intake-platform and rp-llm have no `info/exclude` entry), but low-risk |
| `breaker` **F14** | **do not use `info/exclude` for this at all** — it is a write into git metadata of repos ccd never initialised (measured: only 6 of 21 projects carry ccd's `.ccrc/` line), it is repo-wide across the user's main checkout, and it hides from the user's own `git status` the only signal that 26G of agent worktrees exist |
| `git-empirics` E7 note 2 | `info/exclude` is uncommitted per-clone state ccd must install *and re-install after every fresh clone* — a maintenance obligation nobody has costed |

This is a genuine fork, not a wording difference: F14's position deletes edit-site #13 entirely and
changes the guard design (enumerate children, teach the guards, never normalise the ignore).

## C3 — `cc-conventions.md`'s "Recommended Cleanup Strategy for ccd" is the exact thing the rest of the corpus forbids

`cc-conventions` C6 step 5 recommends: `git worktree remove --force <path>` and "also runs
`git branch -D <branch>` (automatic)".

- `breaker` **F8** (measured): never reuse `-D`/CAS for children — `branch -d` failure must be a
  refusal; git's "branch in use by a worktree" protection is real on this box (34 `ccrc-wt/*`
  review worktrees may hold the same branch), and `update-ref -d` bypasses it.
- `git-empirics` Verification: `worktree remove --force <parent>` **cascade-deletes un-ignored
  children too** — `--force` is a second, independent unlock of the F1 destruction path.
- ccd today has **no `--force` anywhere** (`ccd:1099`, `ccd:4049`, comment at `ccd:1092`), and
  `ccd-ws-reap.test.ts:123` pins *"implements no force or override flag of any kind"*.

A spec author who lifts `cc-conventions`' checklist builds a tool that violates a pinned test and
arms the cascade. `cc-conventions` is the only report of the seven that is **entirely
documentation-derived**; its recommendations were never checked against ccd or against this box.

## C4 — `cc-conventions`' lock model vs. two independent measurements

`cc-conventions` C2/C4 makes `git worktree lock` the liveness primitive: "CC sets lock while an
agent is running", "sweep skips locked", "if locked, skip (agent is using it)". Both `git-empirics`
(EXTRA) and `breaker` (F7) measured that a lock on a **child does not stop `worktree remove
<parent>`**, and that a locked orphan is immune even to `prune --expire=now` — it converts a
recoverable orphan into a permanent leak that pins its branch forever.

So lock is a usable *marker* and a **non-guard**. Worse: nobody has measured whether Claude Code on
this box actually sets locks on any of the 38 children (see M-E below). `cc-conventions` labels the
lock claims **DOCUMENTED**, with no version of Claude Code named anywhere in the report.

## C5 — the ownership boundary: `cc-conventions` C5 says "leave `.claude/worktrees/` alone"; the whole ccd design says "adopt and delete it"

Quoted verbatim in `cc-conventions` C5 from the superpowers rototill design:

> If the worktree lives under `.worktrees/` or `worktrees/`, superpowers owns it. Anything else
> (`.claude/worktrees/`, …) belongs to the harness or user and is left alone.

`ccd-map` §2/§6/§8 (`ws-adopt`), `surfaces` S2/S3, and `breaker` F13/F15/F17 all assume ccd will
enumerate, classify, adopt, guard and eventually delete exactly those trees. Nobody states the
policy decision that overrides the convention, or what happens when Claude Code's own sweep and
ccd's descent both believe they own the same directory (double-delete: `breaker` F9 measured that a
second `worktree remove` of an already-removed child is rc 128 and wedges `_ws_reap_tail`).

## C6 — the consent surface: `surfaces` says don't add a children field; `breaker` says the sheet is already lying about them

- `surfaces` S2: *"**Recommendation for the design: don't add a field yet.** `FleetSession` has no
  `children` concept today and nothing in the PWA reads one."*
- `breaker` **F7**: the reap sheet lists `.claude/worktrees/` among ignored entries with a byte
  total, i.e. N git worktrees on M branches with dirty trees are presented next to `node_modules`
  under the sentence *"none of it is in git, and all of it goes"* (`ccd:4548`). Not silent —
  **misdescribed**.
- `breaker` **F19**: `archivedBytes` (`_ws_archive_manifest.worktreeBytes` = recursive `du`) already
  promises reclaimable bytes that a child-aware reap will then refuse to reclaim.
- `ccd-map` §5: children must join the fingerprint (14th input `childrenDigest`) because the
  fingerprint exists precisely so that *"a change to WHAT GETS DELETED that no human consented to in
  any form"* is refused.

You cannot have all three: a token that hashes children, a sheet that shows their bytes inside a
`node_modules`-shaped line, and no wire field naming them. Either the sheet names children (wire
change, `surfaces` S2 option A) or the design must state that the operator consents to deleting
things the sheet describes as ignored build output.

## C7 — `breaker` F1's enumeration requirement is not satisfiable by the design every other report proposes

Every enumeration design in the corpus derives children from `git worktree list --porcelain` +
path-prefix (`git-empirics` E6/fact 2; `ccd-map` §4 Phase A; `breaker` F3's closure). `breaker`
**F1** measured that a plain `git init` / `git clone` / a superpowers `.worktrees/<feature>` clone
inside the same ignored path is **invisible to `worktree list`** and is `rm -rf`'d by
`worktree remove <parent>` with its only copy of the objects.

F1's closure is a *filesystem* walk for any `.git` not in the enumerated set. No other report
carries that requirement, and `ccd-map` §10 has no row for it. This is a BLOCKER with no closure
anywhere in the plan-shaped output.

## C8 — the migration's "Done when" gate names an instrument ambiguously, and the two candidate instruments give different answers

Session-measured fact: **manifest diff = CI file + `ccdWsHelpers` only.** Confirmed by reading
`scripts/extraction-manifest.sh`: standalone mode walks `.github` (so `ci.yml` and any workflow is
hashed) while monorepo mode walks only `infra/ccrc` (which has no `.github`); `ccd-ccclip.test.ts`
is `is_excluded` on **both** sides; `.gitignore` is in **neither** allowlist.

`migration.md` M2 reports the delta as *"Only in mono: `server/test/ccd-ccclip.test.ts`"* +
*"`ccdWsHelpers.ts` differ"* and then says **"That matches the plan's 'Done when: manifest differs
in exactly the two expected lines' exactly."** It does not — those two lines come from M2's *other*
instrument (`git archive HEAD infra/ccrc` vs the pwa working tree, with a hand-written exclude
list), not from the manifest script.

Consequences that must be fixed before the migration prompt is written:
1. The freeze gate must name **which command** produces the "two expected lines", and the two lines
   differ per instrument (manifest → `.github/workflows/ci.yml` + `ccdWsHelpers.ts`; archive-diff →
   `ccd-ccclip.test.ts` + `ccdWsHelpers.ts`).
2. The manifest is **blind by construction** to `.gitignore`, to `docs/` (if specs move there), to
   `.superpowers/`, to `.remember/`, and to anything else outside the eight-directory allowlist —
   its own header says so. A migration that adds `docs/superpowers/` to ccrc-pwa gets *no* manifest
   signal at all. `migration.md` finding-6 notes the blindness but the checklist still uses the
   manifest as the sync proof.

## C9 — `ccrc-pwa` is the one repo in the corpus that has neither guard, and both goals point work into it

Measured this pass: `ccrc-pwa/.gitignore` has no `.claude/worktrees/` and no `.worktrees/`;
`ccrc-pwa/.git/info/exclude` is empty of real patterns (ccd has never run `ws-add` there).

So when the fresh `claude-ccrc-pwa` session creates its own worktrees (goal 1 exercised inside goal
2's repo), they land **untracked**, and:
- every `git status` in that checkout is dirty → any migration step that asserts a clean tree, and
  the `git archive` sync comparison in `migration.md` M2, break;
- the repo is in `breaker` F2's "safe by accident" state, which no report expects any live repo to
  still be in;
- `.superpowers/` and `.remember/` are *already* untracked-and-unignored there (measured), so the
  tree is dirty **before** any worktree is created.

No report notices this. It is the direct interaction of the two goals and it lands in step 1 of the
migration.

## C10 — `migration.md` calls the deploy flip "source-side-only… safe", and its own Phase B restarts both live services

M1: *"Nothing on either box changes: same `~/ccrc/` destination, same units, same ports. The flip is
a **source-side-only** change, which is why it is safe to do before spec 1/2/3."*

Phase B steps 8–11: deploy the **agent** to this box (restarts `ccrc-agent.service`, which the 16
live sessions' PWA controls depend on, and which re-caches `ccd caps` at boot — the standing memory
item), then deploy the **server** to `server-box` (restarts the process serving the PWA, and ships a
`dist-pwa` that is *currently a different bundle on the two checkouts*: `infra/ccrc/server/dist-pwa`
Aug 2 23:51 vs `ccrc-pwa/server/dist-pwa` Aug 3 13:04).

Both statements cannot stand. Also unstated anywhere: **the rollback**. If the flipped deploy ships
a bad bundle or a bad agent, the recovery path is "deploy again from the monorepo" — which the
freeze (Phase C) is designed to make impossible, and which nothing pins as a supported operation.

## C11 — session-count arithmetic

Session-measured fact: **live fleet = 16 sessions.** `migration.md` checklist step 12 makes
*"16 `claude-session@*` units still active"* the post-deploy safety assertion. But goal (2) is
executed by *a fresh agent session* (`claude-ccrc-pwa`). If that session is started through ccd it
is the **17th** unit and step 12 fails by construction; if it is started outside ccd it is invisible
to the fleet and to every guard in the corpus. Neither is written down.

## C12 — three different `HEAD`s are cited as "the" tree

`surfaces.md`: "line refs … at HEAD `5a943c5`". `ccd-map` Verification: ccd read at committed state
`281d625`. `migration.md`: "HEAD `9f15625`… note the session's opening git snapshot showing
`5a943c5` was stale". They are reconcilable (`migration` measured `git log d2c4ba0..HEAD --
infra/ccrc infra/ccrc-portability` = empty, so ccd and the ccrc tree are unchanged across all
three) — but **no report states the reconciliation**, and `ccd-map` R2 already proves that ~25 of its
own line cites are wrong by 5–90 lines. A spec that mixes line numbers from two reports at two HEADs
without pinning one commit will address the wrong code.

## C13 — drift policy: three answers in ccd, two proposals, no decision

`ccd-map` §6 documents ccd holding **three different policies for the same fact**: `ws-reap` refuses
`registry-branch-drift` permanently (`ccd:2534-2535`), `ws-archive` records it as a fact
(`ccd:1436-1448`), `cmd_ws_rm` lets git win and merely notes it (`ccd:1108-1111`).
`breaker` **F11** shows there is **no remedy verb** (ws-rename refuses once upstream exists; ws-rm
is terminal-only and deliberately un-whitelisted; nothing else writes `$REG/<id>.branch`) and says
"pick one and write down the cost". `conductor.md` adds the decisive outside evidence: branch rename
is a **normal, instructed lifecycle event** in agent-driven work, so refusal-forever is wrong by
design. Nobody picked. The choice changes the fingerprint, the CAS, the manifest and Phase A.

## C14 — minor drift in the shared numbers

38 children / 26.3G measured now vs 37 / 26G in `ccd-map` and `breaker`; 48G free now vs the 51G in
the brief. Both moved during the research session. Nothing depends on the exact figures — but
**every disk-pressure argument in the corpus is unsourced**: no report states the free-space budget,
and children (26.3G) are now **more than half of free space (48G)**. See U-B.

---

# 2. Open questions, ranked by how much they change the design

Ranked by blast radius. `[U]` = user's/architect's call. `[M]` = answerable by measurement now.

### Tier 1 — changes what we build at all

1. **[U] What does "WORKS" mean for goal (1)?** No report states an acceptance test. The candidates
   are materially different builds: (i) *ccd never destroys a child* (guards only — ~F1+F2+F3+F4,
   one commit, no new verbs, no wire change); (ii) *ccd tears children down in order* (adds §5's
   fingerprint/tombstone/breadcrumb work, invalidates every token fixture); (iii) *children are
   visible in the PWA* (adds the wire field, `surfaces` S2 option A); (iv) *ccd adopts foreign
   worktrees as sessions* (D1 — the strand `breaker` F10/F12/F13 shows makes sessions strictly worse
   off). The user's sentence — "allow claude code to create its own worktrees **as part of the same
   session that's running**" — most plausibly means (i), possibly (ii), and does **not** obviously
   require (iv) at all. **The whole adoption strand may be out of scope, and no report tests that
   reading.**
2. **[U] Does ccd own Claude Code's children?** (C5.) Adopt-and-delete vs observe-and-refuse. If
   observe-and-refuse, F1/F2/F3/F4/F5 collapse into one guard commit and F6/F8/F9/F16/F18 (ordered
   teardown) go away entirely.
3. **[U] Which repo, in which order, relative to the freeze?** ccd exists in both repos plus a
   hand-copied `~/.local/bin/ccd` (three copies, currently sha-identical). If the worktree work
   starts before the migration freeze, it must dual-land — the exact failure `migration.md` finding 4
   measured ("within an hour of the extraction, a review fix wave landed monorepo-only"). If it
   starts after, the migration is on the critical path of a live data-loss fix (C1).
4. **[U] Is the driver disk, safety, or continuity?** Never stated in any report. 26.3G of children
   on 48G free, 5G of 7G swap in use, and this project's memory carries OOM-class incidents. If the
   driver is reclamation, the cheapest correct answer might be a read-only reporting verb plus
   *letting Claude Code's own sweep* do the deleting (M-F) — which is a different project.
5. **[U] Scope of "children": in-tree only, or `ccrc-wt/*` too?** `breaker` F15 measured that the
   children a session creates today are **not all under its workdir** — 34 `ccrc-wt/*` SDD-review
   worktrees are on a different volume, so path-containment classifies them as orphans forever.
   Memory: *"SDD reviewers need isolated worktrees"* — these are load-bearing and must never be
   reaped. If out-of-tree children are in scope, the child relation must be **recorded at creation**
   (registry side-file), not inferred from paths — a different design.

### Tier 2 — changes the shape of the diff

6. **[U/M] `info/exclude`: write it, or drop it?** (C2.) F14 says drop; ccd-map says add two
   patterns. Deciding factor is measurable: how many projects would receive an ccd-authored write
   into `.git/info/exclude` that ccd never initialised (measured: 15 of 21 do not have ccd's
   `.ccrc/` line today).
7. **[U] Does the reap sheet name children?** (C6.) Wire field vs silence. Consent argument says
   yes; `surfaces` says not yet; F7/F19 say the current sheet is misdescribing them.
8. **[U] Drift: `ws-rebind` verb, or registry-branch-as-cache?** (C13, F11, conductor.)
9. **[U] Auto-archive of adopted sessions (`breaker` F12).** Backfilling `workspace` arms
   `FleetWatcher.archiveMerged` → `ws-archive` → `_ws_unsupervise` + `tmux kill-session` on a session
   a human may be sitting in. Policy change, needs an explicit yes/no and a distinct `adopted` field.
10. **[U] Migration: PR workflow or keep push-to-main?** `ccrc-pwa` has no branch protection, no
    rulesets, never had a PR, `delete_branch_on_merge: false`, and CI is advisory. Turning on
    required checks converts the workflow and is gated on fixing the known flake (finding 3).
11. **[U] `ccclip`: port `server/test/ccd-ccclip.test.ts` (149 l) + the `ccclip` script into
    ccrc-pwa, or record the deletion of `ccd clip`'s only test as intentional?** `ccrc-pwa/ccd/ccd`
    ships the verb and the agent whitelist admits it. Must be decided **while both copies exist**.
12. **[U] Do specs/plans move to `ccrc-pwa/docs/superpowers/`?** It has no `docs/` today (measured).
    This decides the docserver config entry, the CLAUDE.md link convention for this work, and
    whether the manifest's blindness to `docs/` matters.

### Tier 3 — must be closed before code, but the answer is discoverable

13. **[M] `breaker` F5 has no closure**: the 30s `REAP_SCAN_SECONDS` whole-workspace deadline and the
    per-entry `du -sb` over a 20G child tree. Asserted to fail; never run. If it does fail, every
    workspace in `expoAI-assistant` answers `tree-unreadable` and the remedy text tells the operator
    to hand-delete the very children the design exists to manage.
14. **[M] `ccd-map` §0 items 1/2/5/6 remain UNTESTED** by its own Verification: `_ws_status` on a
    wrapper-less adopted id (decides whether adoption is even reachable), parent-vs-child `flock`
    interleaving (`$REG/.reap-$id.lock` — nothing serialises them), `du` cost. All three are runnable
    **in the vitest fixture-HOME harness** without touching the live fleet.
15. **[M] Are any of the 38 live children locked / dirty / unpushed / on branches with upstreams?**
    Nobody measured lock state at all, despite `cc-conventions` making locks the central primitive.
16. **[M] Does Claude Code's own sweep run here, and with what `cleanupPeriodDays`?**
    `cc-conventions` calls the default "assumed 30 days" and offers "expected behaviour IF … / a
    cleanup BUG IF …" without resolving which. 20G in one project suggests the sweep is not
    reclaiming; if it is simply disabled or the trees are all dirty, that is the answer, and it
    changes the size of the whole project (Tier-1 #4).
17. **[M] How many token/fixture tests break when the fingerprint gains a 14th input?** `ccd-map` §5
    warns "invalidates **every** existing token fixture"; the count is a grep away and it is the
    single biggest cost line in the spec.
18. **[M] Which of the 16 live sessions are workspaces vs main checkouts, and how many sit in the 6
    projects that ignore `.claude/worktrees/`?** This is the *live* blast radius of C1 today — i.e.
    how many sessions are currently one `ws-reap` away from destroying a child.
19. **[M] Do the two `dist-pwa` bundles differ, and would a flipped build reproduce the served one?**
    Measurable in a scratch copy **before** anything is deployed; `migration.md` step 11 currently
    proposes to measure it *after* restarting the live server.
20. **[M] Does `server-box.tailnet-example.ts.net` resolve to `server-box` or to this box?**
    `migration.md` §0 flags that the CLAUDE.md docserver convention names `server-box` while
    `claude-docserver.service` runs on **openclaw**, and leaves it in "gaps". Any doc link the
    migration prompt emits depends on the answer.
21. **[M] Do `deploy/ccrc.env` and `ccrc-agent.env` exist anywhere current?** `ship_env` silently
    no-ops when absent (`if [ -f ]`), so a flipped deploy would never re-ship a rotated token and a
    fresh box boots tokenless — a silent-failure shape identical to finding 1.
22. **[M] Does a 17th session fit?** 30G RAM, 22G available, **5G of 7G swap already in use**, and
    this project's memory carries OOM-class outage forensics.

---

# 3. Answerable by measurement NOW vs genuinely the user's call

## Answerable now — read-only, no ccd verb, no live-fleet touch

| # | question | how |
|---|---|---|
| M-A | lock/dirty/unpushed state of all 38 children | `git -C <main> worktree list --porcelain` per project + `git -C <child> status --porcelain` + `rev-list --count` |
| M-B | which of the 16 sessions are workspaces, and in which projects | read `~/.cc-sessions/*.workspace` / `.workdir` (read-only) |
| M-C | the 30s scan budget + `du` cost over the 20G tree (F5) | time a `find`/`du` over `expoAI-assistant/.claude/worktrees` — a measurement, not a ccd run |
| M-D | `_ws_status` on a wrapper-less id; parent/child `flock`; nested-child reap end-to-end | the existing vitest fixture-HOME harness (`ccdWsHelpers.ts`) — isolated `HOME`, never the live fleet |
| M-E | does CC set worktree locks here; `cleanupPeriodDays`; sweep evidence | `worktree list --porcelain \| grep locked`; read `~/.claude/settings.json`; mtimes of `.git/worktrees/<name>/` vs child age |
| M-F | are the 38 children old+clean+unlocked (sweep broken) or dirty/locked (sweep correct) | falls out of M-A + M-E; **this decides Tier-1 #4** |
| M-G | fixture-test blast radius of a 14th fingerprint input | grep the sha fixtures in `ccd-ws-reap.test.ts` / `ccd-ws-audit.test.ts` |
| M-H | the true manifest delta and the true archive-diff delta, each named to its command | run `scripts/extraction-manifest.sh` in both roots; diff. (Already partially done: standalone walks `.github`, so `ci.yml` is a manifest-only delta and `ccd-ccclip.test.ts` is excluded from both — C8) |
| M-I | do the two `dist-pwa` bundles differ; does a flat-layout build reproduce the served one | build in a scratch copy, hash `index.html`'s asset entries |
| M-J | `server-box.tailnet-example.ts.net` → which host | `tailscale status` / fetch a known doc title (never trust the 200) |
| M-K | presence/currency of `ccrc.env`, `ccrc-agent.env`, `~/.ccrc/agent.env` | `ls`, never `cat` |
| M-L | headroom for a 17th session | `free`, per-session RSS |
| M-M | the authoritative ccd commit + re-derived line numbers for `ccd:1350-1510` and `ccd:2600-2860` | re-read the file; `ccd-map` R2 proves this is mandatory |
| M-N | is `wt-model-rates-sync` live (anything registered in it)? does anything register a session in `ccrc-wt/*`? | registry read + `.git` file read |
| M-O | are `.superpowers/` and `.remember/` tracked in `ccrc-pwa`, and does the migration need to ignore them | read the index / `.gitignore`; measured today: neither is ignored |

## Genuinely the user's call

| # | decision | why it cannot be measured |
|---|---|---|
| U-A | **What "works" means for goal (1)** — guards-only / ordered teardown / PWA visibility / full adoption (Tier-1 #1) | scope, not fact. Everything else hangs off it |
| U-B | **Does ccd own Claude Code's children at all**, against the documented convention that they belong to the harness (C5) | a policy that overrides an upstream convention |
| U-C | **Order: worktree fix first, or migration first** — and therefore whether ccd changes dual-land for a while (C10, finding 4) | risk appetite: dual-landing drift vs delaying a live data-loss fix |
| U-D | **Are `ccrc-wt/*` and other out-of-tree children in scope** (F15) — and the corollary that in-scope means recording the relation at creation | scope |
| U-E | **`info/exclude`: write it or drop it** (C2 / F14) — ccd writing into repos it never initialised | ownership/consent judgement about the user's own checkouts |
| U-F | **Does the reap sheet name children** (C6) — wire field vs. accepting that the sheet describes checkouts as ignored build output | what the operator is consenting to |
| U-G | **Drift: `ws-rebind`, or registry-branch-as-cache** (C13/F11) — one turns a refusal into a pass, the other retires a veto | a safety-vs-usability trade |
| U-H | **Auto-archive/pane-kill of adopted sessions** (F12) | it destroys a live pane and its scrollback |
| U-I | **`ccclip` + its 149-line test: port or bury** (C8) | a deliberate coverage loss |
| U-J | **Do specs/plans move into `ccrc-pwa/docs/superpowers/`** — and therefore the docserver entry and the link convention for this work | where the user wants to read them |
| U-K | **`ccrc-pwa` PR workflow + required checks + `delete_branch_on_merge`** — and whether the known flake is fixed first | process change |
| U-L | **The migration agent's permission envelope**: may `claude-ccrc-pwa` restart `ccrc-agent` on a host with 16 live sessions, deploy to `server-box`, edit `~/.claude-docserver/config.json`, run ccd verbs? And is it started through ccd (17th unit, C11) or outside the fleet? | authority, not fact — and **the migration prompt cannot be written responsibly without it** |
| U-M | **Rollback**: is "deploy again from the monorepo" a supported recovery after the freeze, and is the previous `~/.local/bin/ccd` kept anywhere? | a commitment, and today there is no versioned copy of the installed ccd |

---

# 4. The four things I would fix in the reports before anything is written

1. **Rewrite `ccd-map` §10 against R1 and R2.** Rows #5 and #6 address the wrong code; #13's risk
   label is inverted; the ordering argument is moot. As it stands it is the most build-ready-looking
   and least trustworthy artifact in the set.
2. **Add F1's filesystem walk to every enumeration design.** `worktree list` cannot see a nested
   plain repo or clone, and `worktree remove` deletes it (C7).
3. **Retire `cc-conventions`' C6 checklist, or re-label the whole report as unverified upstream
   documentation.** Its `--force` + `-D` recommendation contradicts three measured findings and a
   pinned test (C3), and its lock model is a non-guard (C4). Nothing in it was checked against ccd
   or against this box.
4. **Name the instrument in the migration's "Done when".** Manifest ≠ archive-diff; they disagree on
   two of the three expected lines, and the manifest is structurally blind to `.gitignore`, `docs/`,
   `.superpowers/` and `.remember/` (C8) — the last two of which are already present and unignored
   in the repo we are about to make canonical (C9).
