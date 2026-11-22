# Linear hierarchy, wave 7 follow-up: the map names issues by identifier (D-8186) — task note

This note is run 3310's record for the programme ledger; the coordinator folds it into the ledger on its own pull request.
A Linear owner drafting a team's migration map reads issues through the read proxy, which shows each issue's visible
identifier (`AAA-12`) and not its Linear id. `plan map-propose` required both on every entry, so an owner holding only
identifiers could not send a complete map. The fix is in the proposal contract; the read proxy is unchanged. The design
decision is recorded as call 261. No new D-number: everything here is under D-8186.

## In short

- **An entry may name its issue by identifier alone** (`{"identifier":"AAA-12","class":"leaf","target":{…}}`). The older
  form with `issue` (the Linear id) beside the identifier is still accepted; when `issue` is given it must be that
  identifier's own issue.
- **Resolved in L1, against rows already measured.** `resolveMapProposal` (`server/src/linear/migrationPolicy.ts`) matches
  each identifier against the eligible rows `storeProposal` already passes to `checkMap`: the team's open issues from the
  migration's one read, less the issues a live binding holds, less (on a follow-up) every row not on the report's skipped
  list. No new Linear query, no proxy field, no caller-supplied snapshot.
- **Canonical values are stored.** The stored entry carries the row's own Linear id and identifier, never the caller's
  spelling; the snapshot is still built by the server from the rows and keyed by Linear id. Apply, report and put back
  read the same `MapEntry`/`MapBody` as before; the incoming shape is its own (`ProposedEntry`, `MapProposal`).
- **Matching is exact up to ASCII letter case.** `aaa-12` finds `AAA-12` (the route already takes the team key in either
  case); no other character folds, so a character whose Unicode upper case is ASCII matches nothing. A link or any other
  text is no identifier and is never parsed into one.
- **No new refusal word.** New details under existing words, all refused before any map item is raised:

| Case | Word | Detail |
|---|---|---|
| The identifier is not an eligible row (never existed, closed, another team or workspace, already bound, not on a follow-up's skipped list, a link) | `map-incomplete` | `not-open:<identifier as sent>` |
| More than one measured row has that identifier | `map-incomplete` | `ambiguous:<identifier as sent>` |
| One issue listed twice, in any mix of forms | `map-incomplete` | `twice:<canonical identifier>` |
| `issue` given and it is not that identifier's row (or the identifier matches no row while `issue` does) | `plan-bad-body` | `issue-mismatch:<identifier as sent>` |
| `issue` present but not a string | `plan-bad-body` | `an entry's issue is not a string` |

  Entries are judged in the order sent and the first refusal wins; a missing eligible row is still `checkMap`'s
  `missing:<identifier>`. The legacy form now also refuses a pair whose identifier is not its issue's, which before was
  stored with the wrong identifier.
- **A superseded entry's successor on the same map** (fix round 1, review 3350 F2). A `target.successor` that names an
  entry of this map by its identifier in another ASCII case takes that entry's identifier as Linear spells it, so a map
  that spelled both `aaa-1` and its successor `aaa-2` in lower case, accepted before this change, is still accepted, and the
  apply sends Linear's spelling as the relation's other end. A successor that is exactly an entry's Linear id, one ccrc's
  plan already holds, or one naming nothing on the map is left as sent, so the self-reference check, the eligibility rule and
  `unknown-successor:<identifier>` are what they were.
- **Unchanged:** the owner, workspace and re-read guards, the target checks, the write serialisation, the operator's
  Approve and Return, apply and put back. A stored proposal never applies itself.

## Measured cases

Red first: before the fix, the identifier-only route case answered 400 `plan-bad-body` ("an entry needs issue, identifier
and a class"); the new policy cases failed on the missing decider; the follow-up case failed on the old refusal (25 failed
in the three files at the first round; review 3350, overlaying the tip's tests on the parent's source, counted 27 there
plus 1 in the plan reference's pin). The plan reference's new pin failed on main's text (`expected [ Array(4) ] to not
include 'issue'`) and passes on the new section. The ASCII-only fold was mutated back to `toUpperCase()` and its case went
red. Fix round 1's successor pins were red before its source change (4 failed: three at the route with `400` for `200`,
`unknown-successor`, and one in policy, the successor left `aaa-2`).

Accepted, at the real route over the real migration (`server/test/migration-map-identifier.test.ts`):

- an identifier-only map stores the same entries and snapshot as the legacy pair for the same issue, raises one console
  map item, and the only Linear call during the request is the open-issue read, the same calls as the legacy form;
- the legacy pair, a lowercase identifier (stored canonical), and a mixed map (one pair, one identifier) in the order sent.

Refused at the route, each with no item raised, the migration still `proposing` with no map, and no Linear write: a pair
that disagrees; a pair whose identifier is not open but whose id is; one issue twice across forms; another team's
identifier; a closed issue; an identifier no issue had; a link; an issue the sync already binds; an ambiguous measurement
(two open nodes with one identifier); a non-string `issue`; a superseded entry whose successor is outside the map
(`unknown-successor:AAA-1`).

Another workspace serving the same team (fix round 1, review 3350 F1). The first round's case for this proved nothing:
the second fixture workspace served another team, so the other workspace's answer was never read. Now a second slot (ws-b)
serves team AAA too, each project pinned to its own workspace with its own owner, and the fake answers the open-issue
read by the slot the call is sent with: ws-b answers an `AAA-1` with another Linear id and an `AAA-9` of its own.

- The control: reading ws-b returns exactly those two rows, on ws-b's slot. Resolved against ws-b's rows, the ws-a map
  gives `not-open:AAA-2` and takes ws-b's `AAA-1`; resolved against both workspaces' rows, `ambiguous:AAA-1`. So neither a
  wrong route nor a cross-workspace lookup can produce the accepted result below.
- The ws-a migration, at the real route: a map naming `AAA-9` is `409 map-incomplete not-open:AAA-9`, with no item, no map
  and no write, and its only open-issue read went out on ws-a's slot. The map of ws-a's own `AAA-1` and `AAA-2` is then
  accepted with ws-a's ids, its snapshot keyed by exactly those two, and one item.
- Mutants of the open read (`LinearMigration#readOpen`), each restored byte for byte: reading another slot that serves the
  team, and concatenating the rows of every slot that serves it. Each survived the first round's test file and is killed
  by the new one (two cases red: the control and the ws-a refusal). Removing the successor rewrite is killed too (four red).

A superseded entry's successor in any case (fix round 1, F2), at the real route: the lowercase legacy pair form and the
identifier-only lowercase and mixed-case forms are accepted and stored with canonical ids, identifiers and successor. A
successor outside the map is still `400 plan-bad-body unknown-successor:AAA-1`. After Approve, the apply sends the
superseded issue's relation with `relatedIssueId: 'AAA-2'` and closes it.

The follow-up subset (`server/test/migration-propose.test.ts`): an identifier-only follow-up entry for the skipped issue
is accepted; an identifier-only entry for an issue already moved is `not-open:AAA-1`.

## The coordinator reference

`ccd/coordinator-skill/references/plan.md`, the map section only: the runnable example names issues by identifier (the
recommended path), the older pair is shown as a whole body and still parses, and the refusal lists name the identifier
cases. Pinned in `server/test/coordinator-plan-reference.test.ts`. Both files are under another run's claim, whose
holder consented to these hunks.

## Limits

- A refusal's detail echoes the identifier as the caller sent it, unbounded, as the existing details (`unknown-target:`)
  already do. It goes back to the caller only and is never stored.
