# Update follow-ups, slice 1: the installer, five test helpers, the text notes

**Goal:** close the small items #2083 carried past the update programme's close-out that touch `install.sh`, the R43
test helpers and three pieces of stale text.

**Before this change:** `install.sh --release` built a broken URL from a `CCRC_RELEASE_BASE_URL` holding a query or a
fragment and printed it whole. `--release vX.Y.Z` took whatever tarball name SHA256SUMS listed. A bad knob warned on
`--help` and on a checkout install, which read no knob. The SHA256SUMS refusal blamed a stall when the size bound
fired. Five test helpers read a child's output on `exit`, which can come before the last bytes of it.

**This change:**

- `install.sh`, release arm: a base holding `?` or `#` is refused before anything is fetched or staged, and the sentence
  names the variable and never the value. The tag is bound to the name SHA256SUMS lists, tag to tag and un-stripped,
  before the tarball curl, in the words of `_upd_resolve`. The five `_inst_validate_knob` calls moved into the arm, before
  the first curl. The two fetch refusals are the updater's sentences. The bounds comment carries the curl 8.4.0 note.
- The R43 helpers resolve on `close`.
- Text: `pwa/test/build-line.test.tsx`'s two comments, `README.md`'s two sentences on `builds`, and two rows of
  `server/test/install-sh.test.ts`: the "no tarball path written" assertion is gone (the `curl-argv` assertion above it
  says the same thing and fails first), and the path traversal row's name now traverses.

**Not changed:** `ccd/ccrc`, so the updater's half of the base refusal waits for #2295. The five knob defaults and
ceilings, the curl flags, the checksum and name rules, and the update control plane.

## Deviations found

- **D-8017 (2026-11-05)** — `install-release-arm-followups`: the release arm's five items above. The triage asked for six
  rows in `install-sh.test.ts`, and that is what it gained. A wording change has no row of its own, so the two fetch
  refusals went red first in two rows that already existed ("absent release" and the tarball "download failed" row), which
  now compare the printed line with the sentence read out of `ccd/ccrc`. The matching-tag row is green on `main` too, as
  a control for the bind; it also covers the binary-mode marker being stripped before the compare.
- **D-8018 (2026-11-05)** — `helpers-close-not-exit-where-a-survivor-holds-the-pipe`: two of the five helpers cannot
  simply resolve on `close`. In J6 (`ccrc-darwin-job-helpers.test.ts`) and the TERM case
  (`session-hook-approval-wait.test.ts`) the shell leaves its background `sleep` behind by design, and that `sleep` holds
  the pipes. Resolving on `close` moves the case's timing onto the `sleep`: measured on J6, 7.7 s against its 4 s bound.
  So those two time the shell's own end at `exit` and read the output after `close`. `run-tmp.test.ts` also has a third
  `exit` promise, in `armed()`, feeding `firstJsonLine`; it moved too, or that reader would still reject on `exit`.
