# Increment 7 WP2: the runtime-import mutation row survives, ruled

- **D-7665 (2026-10-31)** — increment 7 WP2's mutation row "`coord/ports.ts` imports `CoordStore` at runtime (no `type`)" reds no test and changes no emit; the task records it as a known limit and adds no assertion

## What the plan expected

The WP2 mutation table (plan `2026-10-30-consolidation-increment7-watcher-store-port.md`, Task WP2, Step 3) says that
dropping `type` from `coord/ports.ts`'s new `import type { CoordStore } from './store.js'` reds
`rings/totality.test.ts` or `rings/outward-edges.test.ts`, because the file leaves L2.

## What was measured (WP2's tip, on `origin/main` `6d9d61abf`)

- `serverRing('server/src/coord/ports.ts')` stays **L2** under the mutant, with the reason "declares L2 in its
  header": the file's first line, `// L2 ports (ARCH-03, D-6003): ...`, is a ring declaration, and a declaration
  moves a file outward of its facts (`ring.ts`). Without the header the facts alone would make it L1.
- `coord/store.ts` is **L1** (no outer-ring fact), so the new runtime edge points inward from L2, never outward:
  `rings/outward-edges.test.ts` has nothing to red on. `rings/totality.test.ts` needs only one ring per file.
- The emit is byte-identical under the mutant (`tsc -p tsconfig.json --removeComments`, `diff -r` empty): with no
  `verbatimModuleSyntax`, tsc elides an import whose names are used only as types.

So the mutant is invisible at runtime and to every ring rule. What it breaks is the file's own sentence "every
top-level statement is a type", which no row reads for a header-declared file.

## Ruling

The task does not add an assertion to make the row red: WP2's brief forbids any assertion beyond its two named rows,
and the mutant changes no behaviour. The PR body records the row as survived, with this measurement. A row that holds
a header-declared L2 file to the fact rule (every top-level statement a type) is a follow-up for the rings owner,
not part of increment 7.
