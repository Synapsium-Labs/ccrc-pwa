# Follow-up: the release lookup's read is pinned through the library (release-lookup-pins)

Programme `model-class-advance`, epic `doctor`, ticket `release-lookup-pins`. Run 3339. Built on `main` with wave 3
(#3118) and wave 8 (#3122) in it. These are the three minor points from wave 3's fifth review.

## What changed

- **The read is pinned through the library.** Every earlier release-lookup case installed the real auth library, which
  reads the record file on disk, so a doctor that read that file itself would have stayed green. Two new cases in the
  model-advance doctor tests put a stand-in library on the check's import path (`$HOME/.local/bin/ccgpt-auth.py`).
  Its `read_client_release()` returns its own record, which disagrees with the file on disk:
  - a stale record in the library, over a fresh file: the check WARNs with the library's version and ages;
  - a fresh record in the library, over a stale file: the check PASSes with the library's version.

  Every existing case and assertion is unchanged.
- **One stale comment.** The comment in `_dr_tw_shape` (`ccd/ccrc-doctor-checks`) said a quantified hex class there
  would reach the box-token pin. It dates from when that pin's scans read from the box-token marker to the end of the
  file. Both scans now stop at the end of the box-token section, and the comment now says so. No code changed.
- **D-8843 and the wave 3 note** each gain one sentence: the box-token test's two source scans are bounded to their
  section, and the release lookup's `python3 -I -c` call is pinned by its own assertion. No new number.

## Measured

- **Mutation row**, in a `git archive` copy of the tree (never this worktree): the check's library call replaced by a
  direct read of the record file. The release-lookup cases were run against it. 3 red: the two new cases, and the
  existing case for a record over the reader's byte limit. A direct read that also capped the size would pass that
  last case, so the two new cases are what pin the read itself. Without the mutation, all 13 release-lookup cases are
  green.

## Notes for the ledger

- No departure from the brief. Nothing is left for later.
