# Landing order wave 5o, Task 1: the probe's one head (D-9159)

Run 4111 (wave 36). Plan: `docs/superpowers/plans/2026-11-27-landing-order-wave5o-held-head.md`, Task 1. Built on `main`
`5576023f2553c43f53532a3445fdc48c25dda558`.

## What changed

- `server/src/coord/landingLine.ts`: the exported `probedHeadOf(doc, pr)` (section 5.1, word for word); `landingBindingOf`
  calls it in place of its two inline lines, with no other change. The type import widens to `ProbeDoc` and `ProbeHead`.
  One header line names the reader.
- `server/test/landing-control.test.ts`: the pure case `probedHeadOf answers the one head for a PR, or null` and the text
  case `the probe's heads are searched for a PR only inside probedHeadOf (D-9159)`, in the describe of the binding.

## Measured

- Characterization at the base: `landing-control` 63 passed (63), `landing-next-mail` 49 passed (49).
- Red first, both new cases against the base's `landingLine.ts`: 2 failed. The pure case with
  `TypeError: probedHeadOf is not a function`; the text case with `expected -1 to be greater than or equal to 0` (no
  `probedHeadOf` in the file; its one `.heads` match was the binding's inline lookup).
- Green after the move: `landing-control` 65 passed (65), `landing-next-mail` 49 passed (49), both unchanged but for the
  two new cases.

## Mutation rows (by hand: applied, the case run alone, restored, sha256 compared, green again)

| id | Mutation | Red case, as printed |
|---|---|---|
| M3 | `probedHeadOf` answers `named.length >= 1 ? named[0]! : null` | `probedHeadOf answers the one head for a PR, or null`: `expected { pr: 7, …(4) } to be null` |
| M4 | `landingBindingOf` keeps its inline `probe.doc.heads.filter(…)` beside the call | the `landingLine.ts` text case: `expected [ 11924, 15891 ] to have a length of 1 but got 2` |

After each, `landingLine.ts` read back at sha256 `4a00f69b9aaf28339c9ed1ecd29ef449099f68d37bec8308f8ee55b695f1db08`, the
built file, and both cases passed again.

## Claims

`landingLine.ts`, `landing-control.test.ts` and this note under claim 7611. No packet needed.

## What moved since the plan's baseline

Nothing in the cited owner: the two inline lines stood as the plan quotes them.
