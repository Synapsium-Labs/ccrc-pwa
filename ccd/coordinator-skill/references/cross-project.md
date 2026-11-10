# A wave in another project

Part of the `ccrc-coordinator` skill, whose `SKILL.md` holds the contract.

## When a wave crosses into another project

A programme has ONE home project — the repo whose `docs/superpowers/programs/<slug>.md`
ledger you write, and whose plan every wave is measured against — and its waves
may run in ANY project. The home is stated, never inferred. **Every `POST /api/runs`
for this programme carries `homeProject`**, the same value on every wave; the
response answers `ledgerRepo` and `ledgerAbsPath` for it — the ledger itself, under
`docs/superpowers/programs/`. `ledgerAbsPath` is ONLY that ledger path; it is not
and cannot be used as the home repository root or as the plan path. For a crossing
brief, resolve the home checkout separately as `homeRepoRoot`, keep the tracked
plan path as `planRepoPath` under `docs/superpowers/plans/` with no leading slash,
and name the full 40-hex commit as `planSha`. A later open naming a different home is
refused `home-mismatch` with `by:` the stored value — the fix is your body, never
the server. (An open with no `homeProject` at all is refused
`400 bad-request` with `detail: 'homeProject is required'` — the legacy
generation that accepted it ended 2026-09-16. You never omit it.)

**Reuse `sessionId` ONLY when the next wave stays in the same project.** Step 6
above says so itself: its **Same project:** arm — same `sessionId`, same
workspace — is the one this rule governs, and its **Different project:** arm is
the one below. A wave that CHANGES project opens WITHOUT `sessionId` and
spawns a fresh workspace in the target repo,
which is the path wave 1 already spawns on. Naming the old session for a wave in
a different project is refused `project-mismatch` with `by:` the project that
session's workspace belongs to — at the open, and again at the dispatch resume if
the open ever let one through.

**A crossing wave always spawns fresh, even into a project an earlier wave
already reached.** You may coordinate from ANY project: the server admits your
open wherever your OWN registry project is — the run's project, the
programme's home, or neither (the operator's ruling of 2026-10-18) — and
stamps it on the run. A crossing (you sit outside the run's project) binds only
a fresh spawn. Naming an EXISTING session of the target project from outside it
is refused `project-mismatch` with `by:` your project and a `detail` that says
so, so wave 3 into the same target as wave 2 opens without `sessionId` too.
Where you sit never refuses an open; who you are still does (`claimedByUuid`,
below), and so does a registry row of yours that records no project
(`project-mismatch` with a `detail` and no `by` — stop and report).

**Your children's questions come to you wherever you sit** (the operator's
ruling of 2026-10-18, D-5530). A child's question — and, once approvals ship,
its permission prompt — is held for the recorded claimant of the child's run,
which is you, whatever project you and the child are in: you are mailed it and
answer it exactly as clause 11 and `references/wave-lifecycle.md`'s ask lane
say. Only a run with no claimant, a run of another programme, a run opened
without your attribution (before the fleet carried `ccrc-api`'s claimant uuid,
D-5531), or a parent the server cannot measure sends it straight to the
operator instead, and you are not mailed those.

**Two more `POST /api/runs` refusals, both on `refused` (409).** `not-a-child`:
the `sessionId` you named is an existing session with no child marker — one the
operator created — and only a dispatched child is ever bound to a run; open
without `sessionId` and let dispatch spawn one. `attribution-required`: the
fleet box's `ccrc-api` is new enough to send your `claimedByUuid` and this open
carried none; the `detail` says to upgrade the fleet box's `ccrc-api` (`ccrc
rollout`) — `"$API" runs open` sends it for you, so this means an old client.

**What a crossing costs, so a cap refusal reads as arithmetic rather than a
fault.** The cap rule is exact: concurrency counts dispatched runs in an ACTIVE
state, not held workspaces and not merely non-terminal ones. A terminal producer
retained on a hold and a planned undispatched consumer consume no running-worker
slot, and neither does a run parked IDLE at `awaiting-review`, `merging` or
`closing` — it gives its slot back without closing (D-2803) — while a
dispatched run consumes one concurrency slot for as long as it stays active.
There is no daily dispatch count: concurrency is the only cap.
`cap-concurrency` remains authoritative — stop, say so, and wait to be woken,
exactly as you would for any other run.

**Every brief for a foreign-repo wave carries the three immutable-plan
coordinates: `homeRepoRoot`, `planRepoPath`, and `planSha`.** `homeRepoRoot` is
the absolute home-repository root; `planRepoPath` is the tracked
repository-relative plan path with no leading slash; and `planSha` is the full
40-hex plan commit SHA. The worker reads exactly
`git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`; an unresolved repository,
commit, or path means report and stop, without substituting `HEAD`, reading the
current checkout, fetching, checking out, or mutating the home repo.

**Only a consumer that depends on a producer interface carries the producer
contract:** `producerRepoRoot`, `producerSourceRepoPath`, `producerSha`, and the
contract excerpt inlined verbatim from the merged file. A foreign-repo wave with
no producer-interface dependency carries none of those producer fields and no
invented excerpt. `producerRepoRoot` is the absolute producer-repository root;
`producerSourceRepoPath` is the producer source file's repository-relative path;
and `producerSha` is the exact full merged producer SHA. The worker proves its
provenance with
`git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`. The
inline excerpt remains the dispatched authority for interface shape; the
immutable producer blob proves where that shape came from; and the plan blob
controls wave scope and requirements. `ledgerAbsPath` names only the programme
ledger. Paths, not payloads: the 8 KB ceiling is unchanged.

**Deviations found during a foreign-repo wave are minted against the HOME
project** — `POST /api/ledger/deviations` with the home project's name — and
defined in the home plan, because that is where the plan lives. The allocator
takes the project from the caller and cannot cross-check it, so this one is
discipline rather than a mechanism, which is exactly why it is written down.

**Address the worker as `toId: 'worker'` with this run's `runId`**, and the
coordinator as you do today. Carry the `runId` either way: it is what makes a
crossing programme's mail unambiguous when two of its waves are live in two
repos, and it is what keeps a `worker` mail resolvable at all
(`references/mail-envelope.md`).
