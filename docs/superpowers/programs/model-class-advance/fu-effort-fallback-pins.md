# Follow-up: the effort file's rule, term by term, and wave 3's refusals beside a released hold

Programme `model-class-advance`, epic `doctor`, ticket `effort-fallback-pins`. Run 3340. Tests and text only: no
shipped source changes. Built on `main` at bf2c218053, which holds wave 3 (#3118) and wave 8 (#3122).

## The rule (D-8865, review 3015 F1)

`laneHealth` in `deploy/models-op.mjs` names the lane's effort file in `effort-dropped`'s detail
(`effortDroppedDetail(f, onDisk)`, `shared/model-advance.mjs`) only when the file matches the fallback's rendering
(`materialiseCheck(…, reg.dropped.registry, …).changed?.effort === false`) and measurably differs from the stored
registry's (`materialiseCheck(…, storedOf(reg.dropped), …).changed?.effort === true`). Any other answer gives the
ordinary detail.

## What was pinned before

Earlier cases reached the rule only through the failed-materialise paths: a file left at the fallback (named), a file
rendered from the stored registry (ordinary), and two classes on one model (ordinary). No case pinned the
fallback-match term alone (a file matching neither rendering), and no case made either comparison unmeasurable.

## What changed

1. **Five cases in the ops test file** (`programme wave 3 through the ops`, "the rule, term by term"). Each plants the
   effort file's bytes itself, rendered in the test by the lane's own renderer (`effortFile` against the dropped
   catalogue), and asserts which renderings the file matches before it reads `advance-health`'s opus detail:
   - matches the fallback and not the stored rendering: named;
   - matches neither (the file the lane had before its level was dropped): ordinary;
   - matches both (two classes on one model): ordinary;
   - the stored comparison cannot be measured (a preload fails the second read of the effort file with an EIO): ordinary;
   - the fallback comparison cannot be measured (the first read fails): ordinary.
   The preload writes a marker when it refuses a read, and both unmeasurable cases assert that marker, so each case
   is shown to reach the arm it pins. The fifth case is not in the brief. It covers the one mutation row that survived
   the first four cases (below).
2. **Two cases in the advance file's test**, beside wave 8's combined case: a malformed `missing` and, separately, a
   malformed `effortFallback`, each beside a valid `releasedHold` on the same class, are refused with wave 3's own
   field and message.
3. **Two sentences corrected in place** (see "Text read against the code").

## Mutation rows

Run in a `git archive` copy of the branch's tip (dependencies linked from the worktree), never in the worktree. Each
row edits one guard, runs the named cases and restores the file.

| Row | Result |
|---|---|
| fallback-match term dropped | killed (neither, stored-unmeasurable) |
| fallback-match term inverted (`=== true`) | killed (named, neither, stored-unmeasurable) |
| unmeasurable fallback comparison read as a match (`!== true`) | survived the four briefed cases; killed by the fifth |
| stored-differs term dropped | killed (both, stored-unmeasurable) |
| stored-differs term inverted (`=== false`) | killed (named, both) |
| unmeasurable stored comparison read as differing (`!== false`) | killed (stored-unmeasurable) |
| `missing` validator removed | killed (its new case) |
| `effortFallback` validator removed | killed (its new case) |

Both baselines (the rule's five cases, the parser's two) are green.

## Text read against the code

D-8842 and D-8865 in the Codex arm's plan, and the wave 3 note's effort fallback section, were read against the merged
code: `readRegistry`'s `dropped`, `storedOf`, the `materialise --refresh true` branch, `editAdvance`, `set-effort`'s
`clearEffortFallback`, `effortFallbackOf`, `refreshRecord`, `laneHealth`, and the refresh row in `ccd/ccrc`. Every
sentence holds except one claim, made in both documents:

- **The direct lane's window-lowering after a drop.** D-8842 said the lowering "in the first hour after a drop … fails".
  The note's Measured list said "a direct lane's first hour after a drop names the refused lowering". The refresh runs
  the lowering pass before the probe. So on the hour whose probe first sees the drop, the lowering reads the catalogue
  from before it and is not refused, and that hour's materialise writes the fallback. The lowering is refused only when
  the dropped catalogue is already on disk while the registry still holds the stored level: an older build's refresh
  left it, or a refresh whose materialise kept no fallback. The case behind the sentence sets up exactly that ("an
  earlier hour's probe (an older build's …) left the new catalogue"). Both sentences now say this.
- Left as it is, outside this run's claimed files: that case's own comment opens "the precedence in the first hour after
  a dropped effort level", which has the same shortening. Its setup line says what it measures.

D-8865 does not mention the unmeasurable comparisons. That is an omission, not a wrong sentence, so the text is
unchanged. The new cases pin the behaviour.
