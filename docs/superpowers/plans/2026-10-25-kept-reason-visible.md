# The kept reason and the stale sibling: Plan note

PR #1516 names the run behind the child-reclaim skip words `review-report-live` and `siblings-open` in the feed (once
per child, kind and run per day), and stops a provably abandoned sibling run from keeping a child's workspace. One
number, D-6923, was issued for it.

## Deviations found

- **D-6923** — `kept-reason-visible`: `review-report-live` and `siblings-open` were `ordinary` skip words, so no
  surface named the run that kept a child. The sweep now writes a `child reclaim kept` feed row naming the run and its
  age (`server/src/coord/keptReason.ts`). Every reader of a child's sibling runs goes through `readChildSiblings`
  (`server/src/coord/siblingRead.ts`), which splits them by the pure rule in `server/src/coord/staleSibling.ts`: a
  sibling is STALE, and no longer keeps the child, only when it is `planned`, carries no dispatch stamp, is more than
  fourteen days old, and its claimant is proven archived or absent from the registry. Every doubt (an unreadable run,
  a claimant read that rejects or cannot list the registry) keeps the child. A stale sibling is reported, never
  closed.
