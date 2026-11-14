# The curl front's `-g` rows run on macOS too, and the verifier's dependency-load line is filtered and redacted

- **D-8389 (2026-11-12)** — R48's two related gaps closed: the loopback curl front's `-g` admission is pinned in
  `ccrc-containment.test.ts`, which runs on the darwin job too, and refused rows for `-gK` and `-gx` (separate and
  attached values) show that a cluster leading with `-g` carries no other letter; the verifier's exit-3
  dependency-load sentence writes through `refuse`'s printable-ASCII filter (`shown`) with an ASCII dash, and
  `_upd_fetch` prints the verifier's stderr through `_upd_redact`, so a credentialed URL, a query token or the box's
  absolute home in a dependency's load error never prints.

## Why

Issue #2083's "Installer and release host" section ended on R48's two related gaps, carried past the
centralised-update programme's close (ledger `docs/superpowers/programs/centralised-update-management.md`, R48):

- the contained curl front's `-g` admission was unpinned on macOS, with no refused row for `-gK` or `-gx`;
- the verifier's exit-3 dependency-load sentence still printed unfiltered (D-6842's one named residual).

The four update rows that reach a real curl through the front (`allowCurlPort`) are Linux-only (`itLinux` or a
darwin skip), so on macOS nothing went red if the front stopped admitting the release curls' `-g` (D-6748).

## What changed

- `server/test/ccrc-containment.test.ts`, the front's argv-parser describe (no platform gate):
  - refused rows: `-gK` and `-gx` with a value the URL rule would admit as a positional (so only the cluster's own
    rule can refuse them), `-gKx` and `-gx127.0.0.1:7788` attached, `-gfsSLx`, `-fsSLgK`, and `--globoff` (the long
    spelling, which no release curl sends);
  - passed rows: the release SHA256SUMS fetch and bundle probe shapes, each `-g -fsSL …`, and `-gfsSL`;
  - the real-curl row (`it.skipIf(realCurl === '')`, so it runs on macOS) sends `-g -fsSL …` to a closed listed port
    and gets the real curl's 7, and `-gK` and `-gx` get 97.
- `server/test/containedTools.ts`: the front's docstring names `g` among the admitted letters and the letter-by-letter
  rule. The front itself is unchanged.
- `deploy/verify-provenance.mjs`: `shown(why)` is `refuse`'s byte rule (every byte outside 0x20 to 0x7e is `?`);
  `refuse` and the dependency-load line both write through it, and that line's em dash is ` - `.
- `ccd/ccrc`, `_upd_fetch`: the verifier's stderr is captured (its stdout stays inherited) and printed through
  `_upd_redact` before the verdict's die. `log-line-redact-corpus.test.ts`'s pinned call count for ccd/ccrc moves
  from 20 to 21.
- Rows: `verify-provenance.test.ts` plants a `@sigstore/verify` whose load throws an OSC 52 write, a newline, a
  multibyte letter and a C1 CSI, and asserts exit 3 and one line of printable ASCII ending ` - a local dependency
  problem, not a verdict on the bundle`. `ccrc-update-fetch.test.ts` runs the real verifier behind a `--require` hook
  that makes `@sigstore/verify` throw an error naming `https://deploy:<pw>@mirror.example/r/pkg.tgz?token=<t>` and a
  path under the fixture home; stderr shows `https://mirror.example/r/pkg.tgz?[withheld]` and `~/.ccrc/deps/…`, and
  neither the password, the token nor the absolute path is in stderr, stdout or `update.json`. Each was red before
  its fix.

## Mutants (one at a time, restored by cmp)

- The front admits any `-g…` cluster (a `-g*) ;;` arm ahead of the cluster rule): 6 red (the four `-gK` and `-gx`
  rows, `-gfsSLx`, and the real-curl row); `-fsSLgK` stays green, refused by the cluster rule as expected.
- `g` dropped from the admitted letters: 4 red (the three `-g` pass rows and the real-curl row). Before this change
  that mutant reddened nothing on macOS.

## Deviations found

- The task allowed for the admission letting `-gK` or `-gx` through. It does not: the cluster arm refuses any letter
  outside `gsSfL`, read letter by letter. Only rows were added.
- `refuse`'s filter maps bytes; it withholds nothing printable, so it alone cannot keep a secret-shaped URL out. The
  withholding is `_upd_redact`'s, applied where the update prints the verifier's stderr. That covers every verifier
  line on the update path, its refusals included, not only the exit-3 one.
