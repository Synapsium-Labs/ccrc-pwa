# The history-maint one-chunk relay flake: the stand-in shim writes once

- **D-7336 (2026-10-29)** — `stubShim` (`server/test/historyHelpers.ts`) writes its canned stdout in ONE write(2) (`cat` of a file it writes beside the stand-in; a write of at most PIPE_BUF bytes is atomic, and both one-chunk cases are far below it), so a relay case that says "in ONE stdout chunk" is one chunk on every runner. A test-side fix: the relay is unchanged, and nothing leaks on any chunking.

## What failed

`server/test/history-maint.test.ts`, "a PEM block that runs into the next line's NAME, in ONE stdout chunk", failed its `CONTROL human stdout: the lines around it arrive unchanged` assertion in two merge-group runs of unrelated pull requests. Both logs show the same received lines: `zqx26 start`, `zqx26 [redacted]`, `[redacted]`, and no `zqx26 after`. The value itself was masked in both.

## Root cause

The case's premise was false. `stubShim` printed the canned stdout with bash's `printf '%s'`, and bash line-buffers its stdout, so the stand-in made one write per line (five writes for this case, measured with strace in a `node:22` container). On a quiet runner the CLI's first read takes all five; on a loaded one it can read between them. The relay batches each read's whole lines but the last, which it holds for the next batch (cli.mjs `onOut`). A read that ends right after the `TOKEN=` line holds that line, and the next batch is `TOKEN=<BEGIN>abc<END>V` and `zqx26 after`, behind a look-behind that ends on the line `zqx26 <BEGIN>`. `relayRead` reads the batch alone first, which masks the batch's own BEGIN to END; the joined reading then sees the look-behind's BEGIN with no END, and its mark runs to the batch's end, so `zqx26 after` is lost.

Forced reproduction (the stand-in's writes split after the `TOKEN=` line with a 0.5 s sleep, on the base helper): the case fails with the CI signature, every run.

## Not a leak

The new history-lib case (D-7336) relays every chunking at line breaks of both one-chunk cases (16 each) through `redactAfter` and finds the value masked in every one. The lost line is the named residual class of a BEGIN line read without its END: an availability loss, never a leak. It is pinned as measured, beside the residuals already pinned there. The residual itself is left for a ruling: closing it means the joined reading must see an END that the standalone pass masked, which bends the R4 ordering, and that is a design change to the redaction path, not a flake fix.

## Why every stubShim case, not only the one that failed

Only `history-maint` and `history-cli` call `stubShim`, and no case can rely on a chunking that is a race. The JSON one-chunk case beside the PEM case had the same premise; it keeps every line on every chunking (measured in the same new case), so it never failed, but it now reads one chunk too. A case that needs the shim's lines on separate writes uses `rawShim`.
