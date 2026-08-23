# Stage 5 — the flip checklist (operator-only)

Prepared 2026-08-23 (plan Task 11, spec §9/S3). Every step below is the operator's own;
none of it is executed by a session — no transfer, no flip, no tag happens from a
session, per standing agreement.

Preconditions, all landed by the Stage 5 PR before this list is touched: the
`topology-clean` ratchet green with all seven classes unscoped (file contents AND
tracked path names, name classes case-blind); all four packages' suites green; history
rewritten 2026-08-22 (the pre-rewrite mirror lives outside the repo, on the server box's
backup directory).

## Ordered steps

1. **A FRESH repo under `Synapsium-Labs` — NOT a transfer** (operator ruling R-B,
   2026-08-23). This step was written as a transfer before the ruling; the ruling exists
   because a transfer carries `refs/pull/*` — 91 of them, pinned by GitHub forever and
   untouched by the 2026-08-22 history rewrite. A new remote does not carry them, which
   is the entire point.

   ```
   # create an EMPTY repo Synapsium-Labs/ccrc-pwa (no README, no licence, no .gitignore)
   git remote add synapsium https://github.com/Synapsium-Labs/ccrc-pwa.git
   git push synapsium main
   git push synapsium --tags
   ```

   History goes across intact; only the pull refs are left behind. Then re-point both
   boxes' checkouts and every worktree:
   `git remote set-url origin https://github.com/Synapsium-Labs/ccrc-pwa.git`

   Three consequences to accept deliberately, none of them blocking:
   - **No redirect.** A transfer would forward the old URL; a fresh remote does not.
     Every external link to the old repo dies rather than forwarding, and the re-point
     above is mandatory rather than tidy — nothing keeps working on the old remote.
   - **`#NN` references misresolve rather than dying.** Commit messages carry 97 distinct
     ones and the docs corpus another 102. In the new repo they auto-link to whatever
     `#NN` eventually exists THERE, which will be a different PR. Keep the OLD repo
     **alive and private** as the archive so the real ones stay readable, and say so in
     the new repo's README or CONTRIBUTING if outside contributors ever arrive.
   - **Branch protection, required checks and any repo settings do not come across.**
     Step 2 is therefore setup, not verification.

   The release-owner literal already reads `Synapsium-Labs` in-tree (`install.sh` and its
   `ccd/ccrc` twin; value pinned by `license.test.ts`, agreement by
   `ccrc-update.test.ts`), so no owner commit rides this step — the README's release
   one-liner starts resolving the moment the new repo exists.

2. **Repo settings, before any outside eyes.** Actions → General → Fork pull request
   workflows: **require approval for all outside collaborators** — the server suite's
   bash runs on `pull_request`, and a fork must never run it unapproved. Verify branch
   Then SET UP branch protection from scratch — it does not survive a fresh remote: the
   four required checks (test server / test agent / test pwa / build-pwa), no force
   pushes, `enforce_admins` on.
   `required_approving_review_count` stays 0 by explicit choice (single maintainer;
   revisit at the first outside contributor). CodeRabbit on public PRs is a cost call —
   yours.

3. **Re-scan — confirmation, not mechanism.**
   `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` must be
   green, then have the fleet session re-run the pre-flip six-finder scan workflow over
   the final tree (its script sits under the session's `workflows/scripts/` as
   `pre-flip-sensitive-scan-*.js`; it sweeps HEAD and every history blob). Anything
   found: stop, fix, re-run — the flip waits.

4. **The flip.** Settings → Danger Zone → *Change visibility* → Public. Explicit go.

5. **Tag `v0.0.1`.** `git tag v0.0.1 && git push origin v0.0.1` — the release workflow
   builds the artifact. Then the outside-developer proof: on a clean VM, install from
   the public repo using only the README (the runbook's step-12 round-trip, now against
   the public origin). The stage is done when a stranger's install works.
