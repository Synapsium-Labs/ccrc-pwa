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
- **Unchanged:** the owner, workspace and re-read guards, the target and successor checks, the write serialisation, the
  operator's Approve and Return, apply and put back. A stored proposal never applies itself.

## Measured cases

Red first: before the fix, the identifier-only route case answered 400 `plan-bad-body` ("an entry needs issue, identifier
and a class"); the new policy cases failed on the missing decider; the follow-up case failed on the old refusal (25 failed
in the three files). The plan reference's new pin failed on main's text (`expected [ Array(4) ] to not include 'issue'`)
and passes on the new section. The ASCII-only fold was mutated back to `toUpperCase()` and its case went red.

Accepted, at the real route over the real migration (`server/test/migration-map-identifier.test.ts`):

- an identifier-only map stores the same entries and snapshot as the legacy pair for the same issue, raises one console
  map item, and the only Linear call during the request is the open-issue read, the same calls as the legacy form;
- the legacy pair, a lowercase identifier (stored canonical), and a mixed map (one pair, one identifier) in the order sent.

Refused at the route, each with no item raised, the migration still `proposing` with no map, and no Linear write: a pair
that disagrees; a pair whose identifier is not open but whose id is; one issue twice across forms; another team's
identifier; a closed issue; an identifier no issue had; a link; an issue the sync already binds; an ambiguous measurement
(two open nodes with one identifier); an identifier only another workspace's team has (the read goes to the migration's
workspace alone, and the control map takes this workspace's issue, never the other's); a non-string `issue`.

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
