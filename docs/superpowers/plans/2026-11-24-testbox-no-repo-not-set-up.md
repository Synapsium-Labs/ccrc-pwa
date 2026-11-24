# Test box: a directory outside every git work tree is not-set-up

**Goal:** a `ccrc test` run started outside every git work tree falls back as `not-set-up`, decided before the
client opens the link, never as `unreachable`.

**Why:** on the first day with remote runs on, most of the fleet's `unreachable` fallbacks were sessions running
tests from scratch directories with no repository. The client read that as `unreachable (not inside a git work
tree)`, so the console's fallback count reported a box fault the box never had: the box was idle and answering the
whole time. A directory with no repository has no row in the box's table, which is the `not-set-up` row.

## Task 1: the client

- [x] `agent/src/testbox/client.ts`: `whereAmI` answers `not-set-up` outside a work tree, and `remote` asks it before
  `Link.open`, so no status call is spent on a run that cannot go remote.
- [x] `server/test/testbox-wrapper.test.ts`: a run from a bare directory against a closed port falls back `not-set-up`
  and logs that id. It reads `unreachable (the connection failed …)` on the old client (measured red), green on the new.

## Deviations found

- **D-8977** — `unreachable (not inside a git work tree)` was a box fault reported for a run with no repository. It is
  now `not-set-up`, decided before the link opens. Left open: a `runs-locally` command decided by the box after the
  submission still costs one snapshot push each time, because the status answer does not carry the row's command list.
