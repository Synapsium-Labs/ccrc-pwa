# One TypeScript parser for the whole repository, on TypeScript 6 first

- **D-8288 (2026-11-11)** — the repo's source-parsing tests read ONE parser: `server/test/scan/parse.ts` exports the
  pinned TypeScript 6 compiler API (`typescript-api`, `npm:typescript@6.0.3`) as `ts`, the pwa census and scan suites
  import it from there instead of from pwa's own `typescript`, the D-5853 single-importer guard counts every TS parser
  package in every package, and no package but server declares the alias. The pin is parse-only: every package
  type-checks with its own TypeScript. This module lands first, alone, on TypeScript 6 (operator ruling of
  2026-11-13); swapping the parser behind it for TypeScript 7.1's parser API, and pwa's move to TypeScript 7, follow.

Mirror issue: #1650. Operator ruling of 2026-11-10: option (a), "pin TypeScript 6 for parsing source in tests only,
route the PWA test files through the one parser module the server already uses, then move the PWA to TypeScript 7 by
redoing #1610". Operator ruling of 2026-11-13: land the one parser module now, on its own, still on TypeScript 6; the
TypeScript 7 bump waits for TypeScript 7.1's parser API (due 24 Nov).

## Why

TypeScript 7 (the native compiler) exports no compiler API apart from `typescript/unstable/*`, which the scanner
design rejected (R5-1). The server's scanners already parse through the TypeScript 6 alias behind `scan/parse.ts`
(D-5853). pwa had 22 test files (21 suites and the `literalWalker.ts` helper) that parse source with
`import ts from 'typescript'`, which kept pwa itself on TypeScript 6. Draft #1610 gave pwa a second copy of the alias,
which turned the D-5853 guard red (15 importers instead of one) and contested `node_modules/.bin/tsc`. With every
parsing test behind one module, the later parser swap touches that module alone.

## Step 1 (this change): the one parser module, on TypeScript 6

- `server/test/scan/parse.ts`: `export { ts }`, the parser namespace, for suites that walk the raw AST.
- The 22 pwa files: `import { ts } from '../../server/test/scan/parse';`, one line each; nothing else in them changes.
- `server/test/single-definition/advance-switches.test.ts` (D-5853's describe): any TS parser package counts in
  every package, not only under `server/`; a new case pins that pwa, ui and agent declare no `typescript-api`.
- `.github/ci/reach.mjs`: `READS.pwa` gains `server/test/scan/` (22 pwa files read it), so a pull request touching
  the parser module runs the pwa suite.
- `.github/dependabot.yml`: the `typescript-api` exception says it is the whole repository's parser.

### Results identical, before and after (this tree)

Both sides parse with TypeScript 6.0.3 (pwa's `typescript` and server's `typescript-api` resolve the same version).
The 21 suites, run in three batches with the JSON reporter: 21 files, 677 tests, all passed, before and after; the
sorted list of file, test name and status is byte-identical (`diff` empty). The D-5853 guard was red first with
exactly the 22 files.

## Step 2 (follows, not here): TypeScript 7.1

Swap the parser inside `scan/parse.ts` for TypeScript 7.1's parser API once it ships, and move pwa to TypeScript 7.
Not in this change: no TypeScript 7 bump in any package and no build or deploy script change.

## Deviations found

- pwa's typecheck (and its `npm run build`) now resolves `typescript-api` from `server/node_modules`, as it already
  resolves ui's imports from `ui/node_modules`. `install.sh`, `deploy/build-release.sh` and CI's shared install
  install server before they build pwa.
- KNOWN WIDTH: `deploy/deploy.sh`'s server lane does not. It installs ui, then runs pwa's `npm ci && npm run build`
  locally, and installs server only on the target, after the build. From a fresh clone or worktree, which is how
  deploys run, pwa's `tsc --noEmit` fails with TS2307 "Cannot find module 'typescript-api'" and the deploy stops
  before it ships anything. A developer checkout that already has `server/node_modules` builds. The fix is one line,
  `(cd server && npm ci --no-audit --no-fund)` before the pwa build, with a `ci-pipeline.test.ts` walk that pins
  the order. It is not in this change (the change leaves every build and deploy script alone) and lands separately;
  until it does, run `npm ci` in `server/` before a deploy.
- KNOWN WIDTH: a pull request that only bumps the pin (server's `package.json` and lock) does not run the pwa suite;
  the merge queue does.
- Not done here: jsdom 30's `^22.22.2` Node range against pwa's `engines` floor (`>=22.16.0`), the ticket's tidy item.
