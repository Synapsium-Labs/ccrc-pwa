# Workspace holds and program waves — design spec

**Status:** approved in brainstorm (operator, 2026-08-06): *"A sounds good btw as
a temp measure until we get to build 7."*

**Standing:** a deliberately **minimal, temporary operating model** for
long-horizon multi-PR work, shipped now because multi-wave work is broken
today. Build 7 (fleet coordination: ledger + runs/tasks + mail + coordinator)
builds ON this substrate — the program record and the hold are designed to be
what its coordinator later reads — and may replace the *manual* parts (boundary
triggering, wave dispatch). The registry claim, the PR lineage and the
handoff-as-commit discipline are intended to outlive it.

## The problem, in one case

`expoAI-assistant-clear-cove` was mid-program: wave 1's PR #591 merged and the
agent was poised to start wave 2. `archiveMerged` is level-triggered on
`pr.phase === 'merged'` with only busy/attached deferrals — an **idle agent
waiting between waves is indistinguishable from a finished one** — so the
workspace was archived and the pane (with the agent's accumulated context)
destroyed. Separately, the registry holds ONE `prnumber`/`prphase` slot per
workspace: wave 2's PR would overwrite #591, and nothing links successive PRs
to the long-horizon task they serve.

The auto-archive is not wrong — it is one of this project's deliberate
leapfrogs. It is missing one input: *someone claims this workspace is not
done.*

## Operating model (the part that is discipline, not code)

**A program's memory lives in files; every session touching it is disposable.**
Proven twice at smaller scale in this repo: SDD's ledger is what survives
compaction, and fresh-implementer-per-task beats warm-but-bloated context.
Wave N's transcript is ~90% spent material; wave N+1 needs the plan, the
decisions, the carried constraints and the PR lineage — 2–5k tokens of
deliberately written handoff, not a compacted transcript. A handoff file is
lossy in ways you *choose* and reviewable in a way a warm context never is.

- **Program** = spec + plan decomposed into waves + a **program ledger**
  (§ ledger below). All in the project's own repo.
- **Main orchestrator drives every wave boundary** (operator decision). It
  holds no unique state — at a boundary, everything it knows is in the ledger.
- **Wave execution** is SDD per PR, unchanged. Review fan-outs via workflows,
  unchanged. This design adds NO new execution machinery.
- **Parallelism**: across workspaces only. Wave-items the plan proves disjoint
  (explicit file/interface ownership) may fan out to sibling workspaces, each
  its own branch off main, merging in plan-declared order. Within one worktree,
  strictly sequential — SDD's own rule.
- **Waiting**: Build 2's attention machinery already confines a pause to the
  workflow that is waiting (attention bucket, push-actionable asks). A paused
  program is a *visible state*, never an archived corpse.

### Lifecycle

1. **Start**: orchestrator writes the program ledger, commits it, holds the
   workspace: `ccd ws-hold --session <id> --reason "program:<slug> wave:1/N"`.
2. **Wave N**: SDD in the workspace session; PRs via `pr-open`; orchestrator
   merges.
3. **Merge lands**: `archiveMerged` sees the hold and skips. Push copy:
   `✓ merged › <ws> — held for wave 2, nothing archived`.
4. **Wave close**: the session's last act is the ledger-updating commit (the
   handoff); orchestrator stops the session. Worktree persists.
5. **Boundary**: orchestrator reviews the ledger commit, updates the hold
   reason (`wave:2/N`), dispatches wave N+1 as a **fresh session in the same
   workspace**; its first act per the wave brief is rebasing `ws/<slug>` onto
   main.
6. **Final merge**: orchestrator releases; the next sweep archives exactly as
   today, manifest carrying the full PR lineage.

## Mechanism 1 — the hold (registry claim)

One registry file, `$REG/<id>.hold`, containing the reason string verbatim.

- **Verbs**: `ccd ws-hold --session <id> --reason <text>` /
  `ccd ws-release --session <id>`. Idempotent (re-hold updates the reason;
  re-release is a no-op). Workspace-only — a main checkout refuses
  (`not a workspace`): nothing ever auto-archives it, so a hold there is a lie
  waiting to confuse someone. Hold on an archived workspace refuses
  (`already archived — restore first`).
- **Consumers**:
  - `archiveMerged` (server): the gate becomes *merged AND unheld*. Still
    level-triggered, so release alone un-gates it — no edge to miss.
  - `ws-rm` / `ws-reap` (ccd): one new refusal rung, `held` — destroying a
    workspace that is by declaration mid-program takes two deliberate acts
    (release, then reap), not one.
- **Fail-shut polarity**: an unreadable/undecodable hold file reads as
  **held**. Refusing to archive costs nothing (the level retries forever);
  archiving on a misread kills a pane.
- **No timeout / no expiry.** An orphan hold is visible on every surface and
  archives nothing until a human releases it. A silent expiry that re-enables
  auto-archive is exactly the surprise this design exists to prevent.
- The bucket ladder is **unchanged**: a held workspace never acquires
  `archivedAt`, so it never reaches `cleanup`/`archived`; it lives in the live
  buckets like any session. One gate changes; nothing re-derives.

## Mechanism 2 — PR lineage

Append-only `$REG/<id>.prhistory`, JSON lines:
`{"pr": 591, "branch": "ws/clear-cove", "phase": "merged", "recordedAt": <epoch s>}`.

Written at **one chokepoint** in ccd: wherever the registry's `prnumber` is
about to be overwritten with a *different* number, the outgoing record is
appended first — a single helper used by every such write path, so the history
cannot depend on which verb or sweep caused the replacement. The live
`prnumber`/`prphase` slot keeps its exact current meaning: the workspace's
*current* PR.

`ws-archive` folds the history into the archive manifest (additive field), so
an archived card can tell the whole story: `merged:#591 (waves: #577 #583 #591)`.

## Mechanism 3 — the program ledger (handoff artefact)

`docs/superpowers/programs/<slug>.md` in the **project's own repo** — the
program belongs to the project, survives any worktree, renders on the
docserver. Shape (a convention, not a parser — nothing machine-reads it in
this build):

```markdown
# Program: <slug>
Spec: <link>   Plan: <link>   Workspace: <session id>
## Waves
| # | scope | PRs | state |
## Decisions & deviations     (why, not just what)
## Carried constraints        (findings deferred across waves — reviewers get these)
## Next-wave brief            (what the fresh session needs; nothing else)
```

Both handoff directions ride this one file: orchestrator→wave (the dispatch is
the ledger + the wave's plan slice) and wave→orchestrator (the closing
commit). Each handoff is a **commit** — diffable, reviewable; the quality gate
on handoffs is ordinary review. This is SDD's brief/ledger discipline applied
one level up.

## Surfaces

- `SessionRecord` and `FleetSession` gain one additive field:
  `held: string | null` — the reason verbatim; the reason string IS the
  display, no parsing.
- PWA: a **held** chip on the session card/line; Hold/Release in the actions
  sheet (server route → `runCcd`, same shape as archive/restore). Release
  copy names the consequence: *"released — will archive on the next sweep
  after its PR merges."*
- Push: the merged notification branches on held (§ lifecycle step 3).
- Zero new agent whitelist grants; the only new argv surface is the two verbs.

## Failure modes

- **Orphan hold**: visible everywhere, archives nothing, reason says why it
  exists. Remedy is one tap.
- **Release mid-wave**: `archiveMerged` still defers on busy/attached; the
  worst case is archiving an idle merged workspace — recoverable via
  `ws-restore`, prhistory intact.
- **clear-cove today**: already archived. Recovery path: **restore via PWA →
  hold → dispatch wave 2 fresh** (its ledger seeds from PR #591's record).

## Testing & rollout

- ccd verbs and the prhistory chokepoint: bash-against-fixture-registry tests
  beside their siblings (`server/test/ccd-*.test.ts`), including
  replace-then-read, idempotence, main-checkout refusal, archived refusal, and
  unreadable-hold-reads-as-held.
- Server: the gate pinned both ways (merged+held never archives across sweeps;
  merged+released archives on the next sweep), push-copy branch, wire field.
- PWA: chip, sheet actions, copy.
- **Rollout order: agent first** (this ships ccd), then server+PWA — the
  standing ordering discipline.
- Live proof on clear-cove itself: restore → hold → one sweep → verify skip +
  push copy → proceed to wave 2.

## Non-goals (Build 7's, not this one's)

Automated boundary triggering, wave dispatch, agent-to-agent messaging, any
machine-readable program state, and any coordinator process. This design's
deliverable is that a multi-wave program **can run to completion without losing
its workspace, its PR lineage, or its handoff quality** — with a human at each
boundary, which is where the operator wants one anyway.
