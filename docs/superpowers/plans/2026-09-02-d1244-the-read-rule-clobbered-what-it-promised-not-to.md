# D-1244 — the read rule clobbered exactly what its own header promised not to

> **Not a multi-task plan.** This is the ledger record for one correction round, written in
> plan shape because that is where this repo's deviation ledger lives.

**Goal:** Make `_inst_graph_always_on` true to the two sentences it already claimed — "content
outside them is never read or rewritten" and "NEVER CLOBBERS" — both of which were false.

---

## How these were found

D-1243 shipped and deployed with nine measured mutations behind it, three green suites, CI
green on five checks including the macOS leg, and a live post-deploy verification. The operator
then asked one question — *"did you verify compliance and robustness?"* — and the answer was no.
A four-lens adversarial review raised 31 findings; **16 survived two independent verifiers each,
0 were unverified, 15 were refuted.** Several were demonstrated with real kernel failures
(ENOSPC on `/dev/full`, an externally delivered `SIGKILL`), not with stubs.

Nothing here was reachable from the happy path, and nothing here was caught by the nine
mutations — because every one of those mutations, and every test, was written from the same
mental model as the code.

## Deviations found

- **D-1244** (2026-09-02) — six defects in D-1243's `_inst_graph_always_on`, five of them data
  loss or silent misreporting on the operator's own `CLAUDE.md`, plus two in its tests and one
  in its ledger.

  **(1) Markers matched as SUBSTRINGS, anywhere in a line.** A `CLAUDE.md` that merely
  *mentions* the markers — an operator documenting what ccrc converges into their home — was
  cut at the mention, a fresh block planted there, and the real block below left stale for
  ever. Measured. Both markers are now matched on WHOLE LINES (`grep -cxF` / `-nxF`).

  **(2) A START marker with no END marker deleted everything after it.** The tail piece never
  set its flag, printed nothing, and the splice emitted prefix+block — silently dropping the
  rest of the file while reporting "converged". One hand-edit that loses a marker line is
  enough, and `CLAUDE.md` is a file people and sessions edit by hand.

  **(3) Two blocks could never measure current.** The old predicate re-armed at each start
  marker and returned both regions concatenated, which can never equal the wanted block, while
  the splice carried the second copy through verbatim. The file reached a fixed point the
  predicate still called "not converged": a `mv` over a file every session reads, plus a fresh
  backup directory, on every install and update, for ever — with the stale block never removed.

  (1)–(3) share one remedy: a **marker census** that counts whole-line markers and requires
  **exactly one well-ordered pair**, or reports and skips the file the way an unmarked
  `## graphify` section is already reported and skipped. Splicing is then done by `sed` with
  LINE ADDRESSES from that census, not by matching markers again.

  **(4) `sed -n "1,0p"` does not print nothing.** An addr2 at or below addr1 makes `sed` match
  the one line at addr1, so a block sitting at LINE 1 had its own start marker re-emitted and
  the block appended after it — two start markers. That layout is not exotic: it is exactly
  what the append path produces for a home that had no `CLAUDE.md` at all, which on the
  reference fleet is a real home (`.claude-dev0`). Found by instrumenting a test whose failure
  disagreed with the artifact on disk.

  **(5) The three-piece splice checked only the LAST piece's status.** `{ a; b; c; } > tmp`
  carries `c`'s status alone, and the tail piece writes NOTHING when the block sits at end of
  file — the layout the append path itself creates — so the status-carrying command was the one
  that could not fail. A failed first piece produced a file holding the block ALONE, moved it
  over the operator's `CLAUDE.md`, and printed "converged". Measured twice, under real ENOSPC
  and a real SIGKILL, with 730,034 lines lost in the second. The pieces are now `&&`-chained.

  **(6) The symlink fallback re-created the defect the symlink fix exists to prevent.**
  `f="$(readlink -f "$f")" || f="$dir/CLAUDE.md"` collapsed "resolved" and "could not resolve"
  into one value, and the failure case is the LINK path — which `mv` then replaces. Reachable:
  `readlink -f` answers empty for a link whose target's parent does not exist yet (a dotfiles
  repo not cloned), and older macOS has no `-f` at all, on a repo that runs a macOS CI leg.
  That is the overloaded null this codebase forbids at a seam, failing into data loss rather
  than into the step's own well-built skip path. An unresolvable link is now skipped.

  Also: the write forced mode 644, silently **widening** a restricted `CLAUDE.md` — and since a
  symlink is resolved first, the file being re-moded need not even sit inside a ccrc home. The
  file's own mode is preserved now (GNU and BSD `stat` spellings both tried). A refusal left
  `CLAUDE.md.tmp.<pid>` behind in the config directory. And a skipped home did not register in
  `INST_DEGRADED`, so the install printed "every step above converged" a few lines after
  announcing a skip.

## Two defects in the tests, one in the ledger

**The awk-portability guard caught one spelling of the defect it was the sole defence against.**
Both assertions anchored on `awk[^\n]*`, so the identical BSD-awk defect written with a `\`
continuation — the spelling `ccd/ccrc` uses everywhere — stayed **green**. Measured. The
function now uses no awk at all: `sed` with line addresses retires the `-v` newline hazard
rather than guarding against it, and the guard asserts that structural fact over EXECUTABLE
lines with continuations joined.

**The README guard reddened on an identical reflow.** It embedded the paragraph's exact line
wrap, so re-flowing the same prose broke the build — a guard that punishes an editor for
touching the file it exists to keep correct trains people to delete it. It collapses whitespace
before matching now; verified in both directions (survives an identical reflow, still reddens
on a wrong count).

**The D-1243 mutation table reported a count no implementation produces.** Row 1 said "never
write the block | 4 tests red" in a document that closes with "the table is measured and not
asserted". Re-measured today: the step never running reddens **14**. The row was a pre-symlink
number carried into a post-symlink table — the table drifted the same way the README did, and
for the same reason: nothing re-derived it.

## Mutation table

| mutation | result |
| --- | --- |
| the step never runs at all | 14 tests red |
| accept any marker census and splice regardless | 3 red (half-block, two-block, degraded) |
| match markers as substrings (`grep -cF` for `-cxF`) | the quoted-prose test red |
| fall back to the link path when `readlink -f` fails | the unresolvable-symlink test red |
| force mode 644 | the mode-preservation test red |
| drop the `[ "$ls" -le 1 ]` prefix guard | the line-1 and REPLACES tests red |
| never add to `INST_DEGRADED` | the degraded test red |
| put awk back in the function | the portability guard red |
| README count reverted to "four" | the README count guard red |
| delete the README read-side paragraph | the README read-side guard red |

## Known, and deliberately not fixed here

No fixture in this file seeds a multi-account roster, so "every rostered home" is measured
against ONE home: `deploy/accounts.default.json` declares a single account. The tests therefore
cannot distinguish "every" from "at least one", and the shared-file case the symlink fix cites
as its motivation — two homes pointing at one file — is exercised only via a dotfiles target
outside the homes. That target does put the write on the `mv` path (the mutation reddens, so
the fix is genuinely pinned), but the `$n`/`$same` counters double-counting one physical file
is unmeasured. A two-account fixture would close all three and is the next thing to do here.
