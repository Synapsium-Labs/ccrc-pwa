# Stage 4 (release pipeline) — decision brief

Not a spec. The 2026-08-21 survey of Stage 4's surface (parent spec §3/§7/§8, rows :233,
:39-41) found nine decisions and twelve gaps a Stage 4 spec must settle — and three of them
are **operator rulings**, not engineering calls, so this brief asks for those rulings before
the spec is written. Recommendations are marked; evidence lives in the survey's citations.

## The three operator rulings

**R1 — Amending the sacred boundary.** Spec §7 step 4 (:190) requires `ccrc update` to sweep
`claude-session@*` supervisors onto the new ccd — the operation `CLAUDE.md`'s SAFETY section
("NEVER touch … `claude-session@*.service` directly") and `ccd/ccrc:2726-2731`'s shipped
refusal both forbid. Moving deploy's `SWEEP_CMD` (with its `KillMode=process` preflight and
verify loops, `deploy.sh:596-668`) into `ccrc update` means writing an explicit carve-out into
CLAUDE.md's sacred section. **Recommendation: grant the carve-out, scoped to the one verb,
with the preflight mandatory** — but this is your safety rule to amend, not mine.

**R2 — How much release infrastructure.** Spec §3 (:84-99) wants: git tags `vX.Y.Z` → a CI
release job → one matched-set tarball + checksums on GitHub Releases → `curl … install.sh |
bash` fetching the artifact. NONE of it exists (no tags anywhere, `.github/workflows/` has
only test CI, `install.sh` builds from a hand-cloned checkout). This is the stage's largest
build item and it is pure greenfield. Options: (a) full spec shape — tag-triggered release
workflow, tarball with prebuilt dists, sha256sums, bootstrap rewritten to fetch-and-verify;
(b) a thinner v1 — tags + checksummed tarball built by the same CI, but `ccrc update` accepts
a local artifact path too, deferring the bootstrap rewrite. **Recommendation: (a) — Stage 5's
"outside developer installs from the public repo using only the README" proof needs the
fetch path anyway.**

**R3 — Restating the stage-4 proof.** Row :233's proof is unsatisfiable twice as written:
the fleet box runs no `ccrc.service`, so "`/health` reports N+1 on both" has no second
`/health` (its version surfaces are `ccrc version` and the agent ready frame); and doctor's
matched-set check deliberately SKIPs — not FAILs — through an armed 3a gate
(`ccrc-doctor-checks:2028-2031`), so "doctor's matched-set check goes red when one box is
stale" is false on any box that finished 3a. **Recommendation: restate the proof** — "both
boxes report N+1 (server `/health`, fleet `ccrc version`/ready frame); the server's
`/api/fleet/health` build agreement goes `skewed` when one box is stale and `agreed` after
both update" — or fund an authenticated doctor path as part of the stage.

## The six engineering decisions (recommendations I would take unless overruled)

**E1 — Version source of truth.** Add `version` (the tag) to `build.json`, written by both
stampers, read additively everywhere (`parseBuildInfo` drops unknown fields, so every reader
is enumerated: both stampers, the strict jq reader, `/health`, `AgentReady.build`,
`ccd version`'s python3 reader, `ccrc version`/`status`, `buildAgreement`). `buildAgreement`
keeps comparing **sha** (tag-equal/sha-differ = skew — the sha is the truth, the tag is the
label).

**E2 — Where update's bits come from.** The release tarball (R2), verified by checksum before
anything is touched; `~/ccrc` stays `.git`-less; the tarball ships prebuilt `dist`/`dist-pwa`
and update runs install's `npm ci --omit=dev` lane (native modules rebuild on the box; the
three-lane disagreement collapses to install's shape). Dirty-tree refusal lives in the
release job (a tag build refuses a dirty tree) — `ccrc update` never sees a tree at all,
which retires `deploy.sh:78`'s promise.

**E3 — Two-box ordering.** `ccrc update` stays per-box (spec :183) but the server-box run
**warns loudly** when `/api/fleet/health` says the fleet host is behind (agent-first
doctrine), and the runbook orders it fleet-box-first. No cross-box orchestration in v1 — the
fleet box cannot even be addressed from the server box today (D-73).

**E4 — Fleet-box install.** Stage 4 needs `ccrc install --role fleet` (deferred at
`stage2d-installer.md:542`): writes `agent.env` (token prompt, tty-only), installs
`ccrc-agent.service`, skips `ccrc.service`/coord-adjacent steps; role recorded in config, not
inferred. Without it "a TWO-BOX install" has no installer path and the stage-4 proof cannot
run.

**E5 — Migration/rollback posture.** coord.db keeps its machinery (readable at higher
versions — rollback-read already works). The registry gets NO invented version key: spec
:191's "registry format" migrations are retracted for v1 (flat files stay additive, the
wave-1/2 durability program just hardened them). Backups land in `~/ccrc-backups/<ts>/`
(deploy's shape); `--to <previous>` reinstalls the older artifact and **prints** the coord.db
restore commands rather than auto-restoring (an automatic restore would silently discard
post-update coordination writes).

**E6 — Uninstall scope.** Inverses for: units (stop/disable/remove incl. drop-ins), settings
hooks (the removal predicate already exists at `install-session-hooks.sh:72`), marker-verified
wrappers (`shared/mark.mjs`), `~/ccrc` tree. Preserved (spec :208-211): `~/.ccrc`,
`~/.cc-sessions` (file-by-file removal of ccrc's OWN artifacts only — the live registry
shares the directory), worktrees, backups; `.pre-ccrc-<UTC>` keep-asides offered back.
Refuses while live sessions exist (`_box_sessions` counts them) unless `--force`; `--purge`
removes the preserve set except worktrees, never tmux state. `ccrc logs`/`backup` (spec
:203-204, unstaged) join Stage 4 — they are operationally adjacent and `backup` is step 2 of
update anyway.

## Already fixed from the survey

The `CoordDbUnmigratable` messages denying the coord.db backup deploy.sh actually takes
(PR #79).

## What happens next

Rulings on R1–R3 (and any overrule of E1–E6) → Stage 4 design spec → plan → build, the 3b
shape. Stage 4 does not block on 3b's review; they touch disjoint surfaces.
