# Linear central key, FX: the fixture capture as run

FX is the coordinator's one fixture capture in the Linear central key plan (#1444; plan item FX, D-7684). It ran on
2026-11-02 and lands as one fixture-only PR: `server/test/fixtures/linear/` with its README, and
`server/test/linear-fixtures.test.ts`. The plan's FX item describes the capture. Four things in that description could
not be done as written, and one number records them.

## Deviations found

- **D-7743 (2026-11-02)** — `linear-fx-capture`: the FX capture's departures. It ran on the operator's Mac, not a test
  box. A forbidden team cannot be told apart from a missing one. The second key-check page came back empty. The cost of a
  list at the maximum limit of 50 is not measured.

**The Mac, not a test box.** The plan says to capture on a test box. The test box is not rebuilt yet: the plan's Part B
waits on the retirement check. So the capture ran on the operator's Mac. Everything else the plan requires still held.
The key was a throwaway key for a throwaway workspace. The operator made it for this capture and revoked it afterwards.
The capture never ran on the fleet box and never used the fleet's key. The scrub's mapping from real values to fixture
values stays on the Mac, where the capture ran, instead of on a test box.

**Forbidden is not separable.** The plan lists a forbidden team (`linear-forbidden`) among the errors to provoke. Linear
has no distinct answer for it. A team id the key cannot see comes back HTTP 200 with `INPUT_ERROR` "Entity not found:
Team", exactly like a missing entity. There is no 403 and no forbidden code. The workspace had one team, so a real team out
of the key's reach could not be tried. Only a random UUID was. `error-linear-forbidden.json` records that answer under the
plan's name. Any mapping of Linear's answer to `linear-forbidden` has to rest on that recorded answer, not on a code Linear
does not send.

**The empty second page.** The plan asks for both key-check pages. The workspace has one team, so `hasNextPage` was
false. Page 2 was asked with page 1's `endCursor` anyway, and it came back with no teams, at the same `X-Complexity`
(628). No non-empty second page is recorded.

**The cost at limit 50 is not measured.** The read lists that take a caller's `limit` (search, comments, projects, users)
were captured at `first: 25`, the default, in an almost empty workspace. Cost follows `first` (projects: 60 at 25, 600 at
250), so a full page at the maximum limit of 50 is not recorded. Every recorded value is under the 10,000-point cap
(`LINEAR_QUOTA.maxQueryComplexity`).

The capture's other findings are in the fixtures' README:

- the reset headers are absolute epoch milliseconds, not a wait;
- a revoked key gets the same 401 as an invalid one;
- the error codes;
- the caller-chosen create `id`.

They are measured facts, not departures. This PR changes no code: folding them in is a later PR.
