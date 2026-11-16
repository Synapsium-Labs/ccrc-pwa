# Child reclaim: a superseded review report is released: Plan note

PR #1515 adds `review-report-superseded` to the child reclaim sweep: an EARLIER review child of a reviewed run is
released while that run is still open, once a LATER review of the same run has itself closed `done`. It amends R16 of
`docs/superpowers/programs/child-reclamation-contract.md`. One number, D-6922, was issued for it.

## Deviations found

- **D-6922** — `review-report-superseded`: the sweep reads, for a review child whose reviewed run is open, the newest
  later review of that run that closed `done` (`CoordStore.laterReviewClosedFor`). With the hand-only marker
  `$REG/child-superseded-reclaim-live` standing, that child's verdict no longer keeps it as `review-report-live` or
  `review-report-stale`; every other keep still answers first, and the newest review child is never released this
  way. Absent the marker, the lane records "review report would be reclaimed (superseded)" once per pair, and only when
  the verdict with the marker standing would answer eligible (or `hold-retired`). Amends R16.
