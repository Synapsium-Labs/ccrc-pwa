# Program: box-settings-view

Spec: `docs/superpowers/specs/2026-10-25-box-settings-view-design.md` (#1417).
Plan: `docs/superpowers/plans/2026-10-25-box-settings-view.md`. The wave's worker commits it, with the spec, as its PR's
first commit.
Workspace: the wave's child workspace, minted by its dispatch.

A one-wave programme. On 2026-10-25 the operator asked why `CCRC_BACKUP_KEEP` is not shown in the console if it is an
important setting. Only the `ccrc` CLI on each box reads ccrc's seven settings, so the console has nothing to show.
The coordinator offered to file a read-only Box settings panel and build it as the wave after #1410, and the operator
answered "yes please do that".

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | A read-only `ccrc settings` verb and its snapshot; a five-minute timer on every Linux box; the snapshot as an eleventh node file on `NodeWire.settings`; a Box settings card under Settings › Updates. | — | **PLANNED** 2026-10-25 17:22 UTC. It is dispatched after review-cap-lift's wave 1 is accepted, and once the operator rules on the spec's D2, D3 and D7. **2026-11-02:** both gates are met and no run is open; the wave is held, not dispatched. |

## Decisions & deviations

- **Deviation block:** six numbers, 6914 to 6919, issued 2026-10-25 to this programme.
  - 6914: the verb.
  - 6915: the timer.
  - 6916: the node file, its validator and the wire.
  - 6917: the card.
  - 6918: the growth waiver for the CLI file, if one is needed.
  - 6919: a spare.
- **The CLI stays the one reader** (spec D1). No TypeScript copy of the settings reader, and no agent op that runs the
  CLI.
- **Read-only** (spec D5). Editing a setting from the console is a separate decision.
- **In line with the DDD/Clean/SOLID refactor in flight** (the operator, 2026-10-25: "ensure this plan is in line with the
  ddd/clean/solid refactor changes currently in progress too"). Four Opus lenses checked the spec and plan against the
  rings, decide-in-L1, the shared kernels, refusal and wire totality, and the bash anti-corruption layer, each with an Opus
  verifier: 40 findings, 39 kept, 1 refuted. Spec revision 3 and the plan carry the result:
  - an L1 parse and view, and a ring-declared lane on the `inventory` row, with its state owned by FleetWatcher;
  - shared vocabularies held set-equal to the bash writer;
  - the one redactor and the one usage refusal;
  - characterization-first carve-outs.
  The spec's D10 (the carve-outs inside this PR, or their own PR first) waits on the operator with D2, D3 and D7.
- **Routing:** a worker executing a spec'd plan, as one dependent chain (CLI, units, server, PWA) that fits one
  context. That is Opus at high effort, Sonnet high subagents, workflows off and compaction at 40 (the routing matrix's
  worker row). The review uses the held-out panel.

- **2026-11-02 UTC: the ledger lands on `main`, and the dispatch gates are re-measured.** Until today this ledger
  existed only on the coordinator's workspace branch. It lands now on its own ledger PR, with only this entry and the
  wave's state added. Both gates named above are met. Review-cap-lift's wave 1 was accepted and merged on 2026-10-26
  (#1524). On 2026-10-26 the operator approved the spec's D2, D3, D7 and D10 as written. The coordinator
  then held the dispatch until centralised update management's wave 29 (run 985) landed, because both waves edit the
  settings code in `ccd/ccrc` and the install census. Wave 29 merged on 2026-10-29 (#1578), and that programme closed
  on 2026-11-01. Measured today: #1417 is open, no run of this programme is open, and the spec is still only on the
  coordinator's workspace branch, with the plan held by the coordinator. The worker copies both into its PR, as above.
  This entry dispatches nothing: opening the run, a fresh claim read and a re-check of the plan's rebase triggers come
  first.

## Carried constraints

- No default, range, reader, validator or refusal of any setting changes. No act reads the snapshot.
- No route, agent op, exec-whitelist entry or box-token door is added.
- The snapshot never holds a host, a home path, a credential or an unredacted URL.

## Next-wave brief

None. The programme closes when wave 1 lands and both boxes' snapshots show on the card.
