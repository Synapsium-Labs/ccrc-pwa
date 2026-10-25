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
| 1 | A read-only `ccrc settings` verb and its snapshot; a five-minute timer on every Linux box; the snapshot as an eleventh node file on `NodeWire.settings`; a Box settings card under Settings › Updates. | — | **PLANNED** 2026-10-25 17:22 UTC. It is dispatched after review-cap-lift's wave 1 is accepted, and once the operator rules on the spec's D2, D3 and D7. |

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
- **Routing:** a worker executing a spec'd plan, as one dependent chain (CLI, units, server, PWA) that fits one
  context. That is Opus at high effort, Sonnet high subagents, workflows off and compaction at 40 (the routing matrix's
  worker row). The review uses the held-out panel.

## Carried constraints

- No default, range, reader, validator or refusal of any setting changes. No act reads the snapshot.
- No route, agent op, exec-whitelist entry or box-token door is added.
- The snapshot never holds a host, a home path, a credential or an unredacted URL.

## Next-wave brief

None. The programme closes when wave 1 lands and both boxes' snapshots show on the card.
