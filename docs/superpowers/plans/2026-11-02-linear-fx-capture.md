# Linear central key, FX: the fixture capture as run

FX is the coordinator's one fixture capture in the Linear central key plan (#1444; plan item FX, D-7684). It ran on
2026-11-02 and lands as one fixture-only PR: `server/test/fixtures/linear/` with its README, and
`server/test/linear-fixtures.test.ts`. The plan's FX item describes the capture. Five things in that description could
not be done as written, and one number records them.

## Deviations found

- **D-7743 (2026-11-02)** — `linear-fx-capture`: the FX capture's departures. It ran on the operator's Mac, not a test
  box. The key was a throwaway key made for the capture, but the workspace was an existing one with other members and
  issues, not a throwaway test workspace; the capture created and then deleted only its own three issues and one comment,
  and touched nothing else. A forbidden team is not measured: a random team UUID answers `INPUT_ERROR` "Entity not found:
  Team", and whether a real team out of the key's reach answers the same is unknown. The second key-check page came back
  empty. The cost of a list at the maximum limit of 50 is not measured.

**The Mac, not a test box.** The plan says to capture on a test box. The test box is not rebuilt yet: the plan's Part B
waits on the retirement check. So the capture ran on the operator's Mac. The key was a throwaway key: the operator made
it for this capture and revoked it afterwards. The capture never ran on the fleet box and never used the fleet's key.
The scrub's mapping from real values to fixture values stays on the Mac, where the capture ran, instead of on a test box.

**An existing workspace, not a throwaway one.** The plan asks for a throwaway test workspace. The workspace the key
reached was an existing one: it had other members (the users answers list 21 of them) and issues and a project made
before the capture. The capture's writes were only its own: it created three issues and one comment, read them back, and
deleted all four afterwards. It never changed, commented on or deleted anything it had not created. Its reads did return
the workspace's existing members, states, labels and project, and the scrub replaced every one of their names, display
names and ids before commit, as it does for everything else (no answer carries an email field). Whether the workspace is
in day-to-day use was not confirmed.

**Forbidden is not measured.** The plan lists a forbidden team (`linear-forbidden`) among the errors to provoke. The key
reached one team, so a real team out of the key's reach could not be tried. Only a random team UUID, one that names no
team at all, was. It came back HTTP 200 with `data` null and `INPUT_ERROR` "Entity not found: Team", with no 403 and no
forbidden code. That is a not-found answer. Whether a real team the key cannot see answers the same way is unknown.
`error-linear-forbidden.json` records the random-UUID answer under the plan's name. A mapping of Linear's answer to
`linear-forbidden` cannot rest on it as a measured forbidden answer: until a real out-of-reach team is captured, the
forbidden case is unmeasured.

**The empty second page.** The plan asks for both key-check pages. The workspace has one team, so `hasNextPage` was
false. Page 2 was asked with page 1's `endCursor` anyway, and it came back with no teams, at the same `X-Complexity`
(628). No non-empty second page is recorded.

**The cost at limit 50 is not measured.** The read lists that take a caller's `limit` (search, comments, projects, users)
were captured at `first: 25`, the default, and no answer filled a page of 50 (users came back with 21 rows, search with 2,
projects and comments with 1). Cost follows `first` (projects: 60 at 25, 600 at 250), so a full page at the maximum limit
of 50 is not recorded. Every recorded value is under the 10,000-point cap (`LINEAR_QUOTA.maxQueryComplexity`).

The capture's other findings are in the fixtures' README:

- the reset headers are absolute epoch milliseconds, not a wait;
- a revoked key gets the same 401 as an invalid one;
- the error codes;
- the caller-chosen create `id`.

They are measured facts, not departures. This PR changes no code: folding them in is a later PR.
