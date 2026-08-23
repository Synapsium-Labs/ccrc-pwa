# ccrc-pwa canonicalisation — migration runbook

> **For the `claude-ccrc-pwa` session.** You are a Claude Code session running
> at `/srv/projects/ccrc-pwa` (main checkout) on the fleet
> host **openclaw** (198.51.100.7) — the box that runs `ccrc-agent.service`,
> `claude-docserver.service`, and all `claude-session@*` units including you.
> The ccrc **server** (`ccrc.service`, port 7788) and the served PWA live on
> **<server-host>** (203.0.113.7). Execute the phases IN ORDER; each has a
> "prove it" step whose expected output is stated. Where a step says
> **CONFIRM**, ask the operator in your session and wait.

**Goal:** make `example-corp/ccrc-pwa` the canonical repo for all ccrc
work; migrate the in-flight work; flip the deploy source; freeze and then
clear the monorepo copy. Ratified decisions (2026-08-04): port the ccclip
test; move the 26 ccrc docs here; enable branch protection; the worktree
build (`docs/superpowers/specs/2026-08-04-worktree-ownership-design.md`)
happens AFTER this runbook, in this repo, via superpowers writing-plans.

## Hard safety rules (no exceptions)

- NEVER run destructive ccd verbs (`ws-rm`, `ws-reap`, `ws-gc --prune`,
  `ws-archive`, `ws-restore`) against the live host. You are not the operator
  of the fleet; the operator retires sessions through the PWA themselves.
- NEVER touch tmux sessions, `~/.cc-sessions`, or `claude-session@*` units
  other than by the two explicitly sanctioned service actions in Phase C.
- Never print secret file contents; existence checks by `ls` only.
- Both repos are live checkouts; other sessions run on this box. Work on
  branches where the runbook says so; never `git clean` outside your tree.
- The monorepo is at `/srv/projects/OpenClawHetzner`
  (= `/data/projects/OpenClawHetzner`; same directory — `/data` is a
  symlink. ALWAYS use the `/mnt/...` spelling in anything you write).

## Phase A — repo hygiene (direct commits to main, protection comes last)

1. `.gitignore` here lacks entries this box already generates. Add:
   `.claude/worktrees/`, `.worktrees/`, `.superpowers/`, `.remember/`.
   Measured 2026-08-04: `.superpowers/` and `.remember/` are ALREADY PRESENT
   untracked — the tree is dirty before any worktree exists. Commit.
2. Prove it: `git status --porcelain` is empty afterwards.

## Phase B — ports (each its own branch + PR-shaped commit series on main
for now; protection is not yet on)

3. **soft-prairie (the caps-refresh + branch-naming work).** The monorepo
   branch `ws/soft-prairie` holds in-flight ccrc work (measure the count at
   execution time: `git -C <mono> rev-list --count origin/main..ws/soft-prairie`
   — it was 13–15 on 2026-08-04 and the session may still be committing;
   **CONFIRM with the operator that the soft-prairie session is idle before
   taking the patches**, and record the exact tip SHA you ported).
   Port: `git -C <mono> format-patch origin/main..ws/soft-prairie` into a
   scratch dir; rewrite paths in the patches (`infra/ccrc/` → repo root,
   i.e. `a/infra/ccrc/server/...` → `a/server/...`; `docs/superpowers/`
   unchanged — this repo now has the same docs tree); `git am` onto a NEW
   branch `port/caps-refresh` here. Do NOT merge it — the work was mid-plan;
   open a PR and leave it for its own review cycle.
   Prove it: on the branch, all three suites + three typechecks green
   (`server` 55 files/1099+, `agent` 13/204+, `pwa` 40/903+ — plus whatever
   the ported tests add); `git log` subjects match the monorepo branch.
4. **ccclip test.** Copy `infra/ccrc/server/test/ccd-ccclip.test.ts` from the
   monorepo to `server/test/ccd-ccclip.test.ts`, adjust the ccd path import
   to this repo's `ccdWsHelpers` convention, remove its entry from
   `is_excluded()` in `scripts/extraction-manifest.sh` (both repos' copies —
   the monorepo copy gets the same edit in the Phase E clear-out PR so the
   instruments agree in the window between). Commit on main.
   Prove it: `npx vitest run test/ccd-ccclip.test.ts` green in `server/`;
   `bash scripts/extraction-manifest.sh` still exits 0.
5. **Docs move.** Copy the 26 `*ccrc*` files from the monorepo's
   `docs/superpowers/{specs,plans}` into the same paths here (they join the
   two already-committed 2026-08-04 docs). One commit:
   `docs: carry the ccrc spec/plan corpus from the monorepo`.
   Prove it: `ls docs/superpowers/specs docs/superpowers/plans | wc -l`
   matches monorepo count + the new files; no content edits.

## Phase C — deploy flip (the dangerous phase; every step gated)

6. **Fix `deploy/deploy.sh` in THIS repo.** Measured defects to close, all
   inherited byte-identical from the monorepo:
   - rsync sources hardcode `infra/ccrc/...` (lines ~22/32/52) — flatten to
     repo-relative, cwd-independent paths.
   - it NEVER builds the PWA (`--exclude dist` does not match `dist-pwa`,
     so it ships whatever stale bundle sits on disk — the exact green-deploy
     failure this project has shipped twice). Add an explicit
     `npm ci && npm run build` for the PWA before rsync, and assert the
     bundle it is about to ship was built in this run (mtime or stamp).
   - it never ships `ccd` (hand-`scp` today) and never ships
     `deploy/notify.sh` (live at `~/.cc-sessions/notify.sh`). Add both as
     explicit steps with backups (below).
   - Update `README.md` stale monorepo paths (~lines 58/59/69/99).
7. **Pre-flight measurements, before anything deploys:**
   - `ls deploy/ccrc.env deploy/ccrc-agent.env` (or wherever `ship_env`
     reads) — if absent, STOP and report: `ship_env` silently no-ops on a
     missing file and a fresh box would boot tokenless.
   - Build the PWA in a scratch copy; confirm it produces a servable
     `server/dist-pwa/index.html`.
   - Rollback prep: in the monorepo `git tag pre-ccrc-freeze` (push the
     tag); on this box `cp ~/.local/bin/ccd ~/.local/bin/ccd.pre-flip`;
     back up the agent's deployed dist dir; note the <server-host> server dist
     backup as part of the deploy script's first flipped run.
8. **CONFIRM with the operator, then deploy from THIS repo.** Order is
   load-bearing (the 113-second lesson — the agent caches `ccd caps` at
   boot): install ccd FIRST, then restart `ccrc-agent`, then the server on
   <server-host>.
9. Prove it, all five, and report the outputs verbatim:
   - `~/.local/bin/ccd caps` lists the full verb set;
   - agent `/health` on :7789 ok AFTER its restart, and the PWA's session
     sheet no longer shows any "does not have this verb" state;
   - server `/health` on <server-host>:7788 ok; served PWA bundle is the one
     built in step 6 (compare a content hash, not a timestamp);
   - a PR-state read through the PWA returns real state (known truth at
     writing: `data-internal-clear-mesa` → merged #157; re-verify against
     the live registry, don't assume);
   - `systemctl --user list-units 'claude-session@*' --no-legend | wc -l`
     equals the count taken BEFORE the deploy (17 as of 2026-08-04, you
     included — count first, assert unchanged, never hardcode).
   If any check fails: STOP, restore the backups (monorepo remains fully
   deployable until Phase D), report.

## Phase D — freeze the monorepo copy

10. In the monorepo, on a branch → PR: replace `infra/ccrc/README.md` top
    with a tombstone (canonical repo URL, the tag name, the date), and add a
    CI guard workflow (~15 lines) that FAILS any PR/push whose diff touches
    `infra/ccrc/**` or the four frozen portability files
    (`infra/<server-host>-portability/{ccd,claude-session@.service,statusline-command.sh,tmux.conf}`).
    The other ten `<server-host>-portability` files (ccclip, hammerspoon,
    docserver, hardening, etc.) are NOT ccrc and stay live.
11. **Prove the guard red once**: a scratch branch touching one guarded path
    must fail the check; then delete the scratch. A guard never seen red is
    the green-signal failure class this project keeps paying for.
12. Docserver: add `{"label":"ccrc-pwa","root":"/srv/projects/ccrc-pwa"}`
    to `~/.claude-docserver/config.json` (hot-reloads on mtime). Prove it by
    fetching `https://<server-host>.<tailnet>.ts.net/docs/ccrc-pwa/specs/2026-08-04-worktree-ownership-design.md`
    and grepping the response for "Worktree ownership" — NEVER by status
    code (the SPA answers 200 for everything). If the tailnet name does not
    resolve from here, report which name does (`tailscale status`); the
    CLAUDE.md link convention may need updating — report, don't edit it.

## Phase E — clear-out (monorepo, one PR, operator merges)

13. On a monorepo branch, delete: `infra/ccrc/` entirely; the four frozen
    portability files; the 26 moved docs. Update the two references outside
    those trees (`.gitignore`, `scratch/*` test helpers — grep
    `infra/ccrc\|<server-host>-portability` to catch strays). The CI guard from
    Phase D will fire on this PR by design — grant it the one documented
    exception (path-delete-only diff) or gate the guard's introduction to
    merge after this PR; state which you chose in the PR body.
14. Branch/worktree cleanup in the monorepo (SAFE list, verified 2026-08-04:
    all 24 `ccrc/*` branches merged into main, `ccrc-wt/` trees on merged or
    detached commits): `git worktree remove` each `ccrc-wt/*` tree,
    `git worktree prune`, then `git branch -d` each `ccrc/*` branch
    (plain `-d`; if git refuses one, it is NOT merged — leave it and
    report). Do NOT touch `ws/soft-prairie` (live session; the operator
    retires it through the PWA after the port PR merges) and do NOT touch
    `~/worktrees/` (live ccd workspaces).
15. Prove it: `git -C <mono> branch | grep -c ccrc` → 0 (modulo refusals
    reported); `git -C <mono> worktree list` shows no `ccrc-wt/` entries;
    monorepo suite for remaining code still green; **CONFIRM** → operator
    merges the PR.

## Phase F — process lock

16. Enable branch protection on `ccrc-pwa` main via `gh api`: required
    status checks = the exact job names in `.github/workflows/ci.yml`
    (read them, don't guess), dismiss-stale off, enforce for admins on;
    `gh api -X PATCH repos/example-corp/ccrc-pwa -f delete_branch_on_merge=true`.
    From this point every change here goes via PR — including yours.
17. Prove it: `gh api repos/example-corp/ccrc-pwa/branches/main/protection`
    returns the config (was 404 on 2026-08-04); a direct push to main is
    refused.

## Hand-back to the operator (report, don't do)

- Merge order for the open PRs: ccclip/docs (trivial) → caps-refresh port
  (needs its own review; it fixes the boot-time caps cache — finding 1) →
  monorepo clear-out.
- `ws/soft-prairie` workspace: retire via PWA archive → clean-up once its
  port PR merges.
- `custom-tools-warm-meadow`: registry says `ws/warm-meadow`, git says the
  worktree is on `main` — needs hand-untangling before any lifecycle verb
  will touch it.
- The 26 GB foreign-tree triage and main-session retirement: separate
  effort, after the worktree-ownership build.
- Next build: `docs/superpowers/specs/2026-08-04-worktree-ownership-design.md`
  via superpowers writing-plans, in this repo, PRs against protected main.

## Instruments (use these exact commands when asserting sync)

- Manifest: `bash scripts/extraction-manifest.sh` in each repo, diff.
  Expected delta TODAY: `.github/workflows/ci.yml` (pwa-only) and the
  `server/test/ccdWsHelpers.ts` hash line. After step 4, the ccclip test
  line joins the pwa side until the monorepo copy is deleted. KNOWN BLIND
  SPOTS: `.gitignore`, `docs/`, `.superpowers/`, `.remember/` are in
  neither walk — never cite the manifest as proof about those.
- Modes: `git ls-files -s` comparison (was identical, 2026-08-04).
- Commit window: `git -C <mono> log d2c4ba0..HEAD -- infra/ccrc
  infra/<server-host>-portability` — empty on 2026-08-04; if non-empty at
  execution time, STOP and report the drift before any phase runs.
