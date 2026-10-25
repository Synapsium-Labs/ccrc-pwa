# ARCH-04 stage 4: every server/src and pwa/src file has one ring and one context

ARCH-04 (#545) builds the repo-wide import-direction scanner in stages, one rule per file under `server/test/rings/`.
Stages 1 to 3 landed as #934, #944 and #1040 (D-6045, D-6118). Stage 4 is the totality rule: every non-test file
under `server/src` and `pwa/src` takes exactly one ring and exactly one context. One number, D-6734, was issued to
this stage and is defined below.

**What this stage does.** `server/test/rings/totality.test.ts` walks both packages (at least 400 files between them;
the PWA walk includes `.css`, which is L4) and asserts:
- every file's ring is `rings/ring.ts`'s `serverRing` or `pwaRing`, each package has one L5 file (`index.ts`,
  `main.tsx`), no L0, and L1 to L4 are all occupied, so a stale classifier is red;
- every file's context comes from the 08-10 spec's `ring-context-map` table, read by `rings/ringContextMap.ts`, in
  ARCH-34's vocabulary (`CCD_CONTEXTS`): a file row beats a directory row, directory rows do not nest, two rows never
  name one file, and both a file no row reaches and a row that names no file are red.

The spec table's drift is fixed in the same change (rows added for the files that had none, three dead PWA rows
removed). Two per-file L0 pins drop only the `node:*` assertions that `rings/shared-imports.test.ts` already makes on
every `shared/*.ts` file. Tests and docs only; no production file changes.

## Not in this stage

- C0a's `L1_L2_NEW_FILE_DIRS` waiver list (D-6046) is left in place. #545's acceptance criteria do not name it, and
  replacing it changes the growth check's behaviour. It is a follow-up.

## Deviations found

- **D-6734** — `ring-rules-stage-4-totality` (ARCH-04 (#545), stage 4; in D-6045's shape): the 08-10 spec's
  `ring-context-map` table is the context override map, and there is NO exemption set. Every non-test `server/src`
  and `pwa/src` file takes one ring from `serverRing` / `pwaRing` and one context from that table, under the spec's
  own precedence (file row over directory row, no nested directory rows, no file named by two rows); a new file in a
  directory with no row needs a file row in the same PR, and a row naming no file is stale and is deleted. Where a
  file has no owning context, its row is K. Departs from stages 2 and 3, which carry exemption sets that may only
  shrink: here each table row is the written reason, so a set would duplicate it. Pins (`server/test/rings/totality.test.ts`):
  "the spec holds each of the ten contexts, once and in order, and every row names a known context"; "the walk
  reaches at least 400 files across the two packages"; "server/src: every file takes exactly one context from the
  spec's table, and the table has no stale or nested row" and its `pwa/src` twin; "server/src: every file takes
  exactly one ring, L1 to L5, and index.ts alone is the composition root" and "pwa/src: every file takes exactly one
  ring, L1 to L5, and main.tsx alone is the composition root"; with the CONTROL cases "the assignment gives a file row
  precedence and reports each way the table can fail" and "a `*` stays inside one path segment, and a `.` is
  literal". The retired `node:*` assertions are held by `rings/shared-imports.test.ts`'s "no shared/*.ts file imports
  anything but a ./ sibling, and no exemption is stale".
