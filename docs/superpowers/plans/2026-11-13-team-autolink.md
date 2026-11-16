# Automatic team linking, and one row per project in Project linking

- **D-8405 (2026-11-13)** — the automatic team link and one row per project: Settings › Security › Project linking draws one row per project name (the route answers one per checkout directory); a background pass links each project with no key to the Linear team its evidence names, when one team's evidence is decisive, records how (`auto`, with the team's name and the evidence) and otherwise offers the best candidates on the row as one-tap Links; a key the operator typed, chose or cleared is never written over.

## Why

The operator's screenshot of Settings › Project linking showed every row's Team key empty, to be typed by hand, and one
private project as four identical rows. Linking a project to its Linear team is work the box can do from what it already
holds: the teams of every workspace whose key is stored, and the ticket ids the project's own branches, pull requests and
commits carry.

## The duplicate rows

`GET /api/projects` answers one row per checkout DIRECTORY: `listProjects` (`server/src/lifecycle.ts`) keys its rows by
`workdir`, so the projects root's directory and every registry workdir that is not a linked worktree (a second clone of
the same repository, say) is a row of its own, each with the project's name. The fleet screen wants that; the linking
facts are stored once per project name (`project_linking`'s primary key). So the card reads its rows through
`linkingRowsOf` (`pwa/src/fleet/linkingWords.ts`, L1): one row per name, the first row that carries a cell, in the
route's order. The route is unchanged.

## The evidence, its order and its thresholds

Decided in `server/src/linking/teamLink.ts` (L1, pure), strongest first:

1. **Ticket ids** (a PRIVATE repository only; a public or unmeasured one never carries them, so for it this class is not
   read): the distinct `KEY-123` ids of each known team key in the project's branch names, pull request titles and head
   branches, and commit subjects and bodies, as the PR sweep last read them (`ticketTexts`, `ticketTally`; case-insensitive,
   whole tokens, one id counted once). **Decisive when one key has at least 3 ids (`TEAM_LINK_MIN_IDS`) and at least 80%
   (`TEAM_LINK_MIN_SHARE`) of every id seen of any known team key.** A prefix no known team holds is not counted either way.
2. **Name match**: the project's name, or its repository's name (the measured slug's last part), equals a team's name or
   key, ignoring case. **Decisive when exactly one team matches and no id of any other team was seen.**
3. **Nothing**: no link and no candidate.

Short of decisive, the row offers the candidates (ids first, by count, then name matches; at most 3), each a one-tap
Link that saves its key as the operator's. Ambiguity never links.

## One owner of the linking fact

- `coord/linkingStore.ts` stays the one writer of `project_linking`. Migration 64 adds `teamSource` (`manual` | `auto`),
  `teamName`, `teamEvidence` (JSON), `teamAt` and `teamCandidates` (JSON); each JSON cell is read through its L0 guard
  (`isTeamEvidence`, `isTeamCandidate` in `shared/api.ts`), and a cell that does not parse reads as none.
- **The operator wins, in SQL.** `linkTeamAuto` writes only `WHERE teamKey IS NULL AND teamSource IS NOT 'manual'`, in the
  statement that would write it, so an operator's write that lands first is never overwritten. `setLinking` makes any
  write that CHANGES the key the operator's (`teamSourceAfterWrite`); one that sends the stored key back (an override
  change re-sends it) keeps whoever set it. A key the operator cleared stays cleared: the pass offers the decisive team
  as a candidate instead. A key stored before migration 64 reads as the operator's (they were its only writer).
- **When it runs**: on the existing cadence, after each visibility tick of the PR sweep (`VisibilityLane.linkTeams`, the
  linking lane's second step, no new poller), and at once when the console adds a project (`POST /api/projects`) or a
  Linear workspace key is added, replaced or checked `ok` (`onTeamsLearned` on the workspace routes), through
  `FleetWatcher.linkTeamsSoon`. It calls neither Linear nor GitHub: the teams are `routableTeams` of the Linear store (the
  slots the router can reach, by the router's own rules), and the evidence is the PR sweep's last read, kept in memory.
- **Wire**: `ProjectLinkingWire` gains optional `teamLink` (`{source:'manual', at}` or `{source:'auto', teamName, evidence,
  at}`, or null) and `teamCandidates`; an older server omits both and the card shows what it showed before.

## Deviations found

- Pull request BODIES are not read: the PR sweep's rows carry none, and a read of its own would spend the shared GitHub
  budget. Branches, titles, head branches and commit subjects and bodies are read.
- Evidence (1) is read only for projects the PR sweep reaches (a project with at least one workspace). A project with
  none is linked by name match or offered nothing until it has one.
- An automatic link is not re-decided while it stands: new evidence for another team changes nothing until the operator
  clears or changes the key. Never moving a key behind the operator's back was preferred over following drift.
- No new refusal word: a candidate's tap is the existing write (`POST /api/projects/:project/linking`).

## Tests

- `server/test/linking-team-link.test.ts`: the tally; each evidence class; the thresholds; ambiguity gives candidates;
  public and unmeasured repositories never read ids; the guards; the store's operator-wins rules and migration 64; the
  lane over a real coord.db (decisive, ambiguous, typed key left alone, unreadable store).
- `server/test/linking-visibility-watch.test.ts`: the watcher links a project on the sweep's cadence from a stored
  workspace key.
- `server/test/linear-workspaces-routes.test.ts`: an add and an `ok` check tell the link; a refused add does not.
- `pwa/test/project-linking-card.test.tsx`: four rows of one project draw one row; the automatic line; a candidate's tap
  saves its key; the cleared-key line.
- `pwa/browser/project-linking-card.browser.test.ts`: at 360, 390, 1280, 1470 and 1920, both skins and both themes, the
  duplicate rows draw once and the automatic line and the candidates wrap inside the key cell, with no overflow.
