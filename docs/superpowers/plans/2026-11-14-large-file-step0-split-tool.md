# Large-file programme, step 0 part 2: the TypeScript slice tool and its pure-move pin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **D-8636 (2026-11-14)** — `large-file-split-tool`: `.github/ci/file-split.mjs` (`plan`, `preflight`, `move`, `verdict`)
  and `server/test/fileSplit.ts` move named top-level declarations of a TypeScript or `.mjs` file into a destination
  module and repoint every importer. A move is pure when its moved declarations are byte-identical apart from import and
  export lines, no name is defined twice and the program's exported surface is unchanged. `preflight` refuses a slot
  another file's open move PR holds and a declaration any open PR's diff touches, from a heads file the caller writes.
  `server/test/file-split-pin.test.ts` pins it on fixtures and judges every PR's own diff. No real code moves.

**Goal:** the slice tool and its pin that every TypeScript and `.mjs` file of the large-file programme moves with
(spec `docs/superpowers/specs/2026-11-13-large-file-programme-design.md`, D-8615, §2 items 2 and 4, §4 "Parallelism").

**Architecture:** decide in a pure library, act in a thin script. `server/test/fileSplit.ts` holds every decision: the
top-level model of a file (on the one parser, `server/test/scan/parse.ts`), the move as new file texts, the pure-move
verdict, the preflight verdict and `moveBase`. `.github/ci/file-split.mjs` only reads arguments, files and git, calls
the library and writes. The library reuses `gitRead`, `fileAt` and `changedFiles` (`growthCheck.ts`) and the context
table reader (`rings/ringContextMap.ts`); it adds no second git reader or context classifier.

**Tech Stack:** TypeScript 6 compiler API through `parse.ts`'s `ts` export (a syntax-only program per file for name
binding), Node's type stripping plus one `registerHooks` resolve hook (`.js` specifiers to `.ts` sources) for the
script, vitest.

## Shared vocabulary with the ccd plan, not shared code

The ccd plan's Task 1 (`docs/superpowers/plans/2026-11-06-ccd-file-split.md`, D-8048) defines the bash tool. The two
tools use the same words and the same verbs, and no code: bash is judged by `bash -n` and `programDump`, TypeScript by
its parser.

| Word | ccd plan (bash) | This plan (TypeScript, `.mjs`) |
|---|---|---|
| region | a function, its lead `#` block and nothing else | a top-level declaration statement with its leading comments and same-line trailing comment |
| pure move | the splice of both sides equal byte for byte, `__CCD_LIBS` gaining only the library | each moved declaration's text equal (an `export` modifier aside); every other statement of a changed file equal; only import and export lines differ |
| `pureMoveVerdict` | `{pure, differing}`, or null when no pointer is added | `{pure, moved, differing, newlyExported}`, or null when no marker line is added |
| `duplicateDefinitions` | a function defined twice in the program | a name declared top-level in more than one of the given files |
| `moveBase` | `merge_group.base_sha` in a queue run, else `merge-base(origin/main, HEAD)` | the same rule |
| `preflight` | no open PR has a hunk in a slice function | the same, per declaration, plus the context slot (§4) and one open move PR per file |
| `move` | writes the library and pointers | writes the destination, the source and every repointed importer, after its own verdict passes |

## Global Constraints

- The tool moves NO real code in this PR. The proof runs on a scratch copy (Task 5).
- No `gh` call in the tool or its tests. `preflight` reads a heads file the caller writes, and git for each head.
- Only `server/test/scan/parse.ts` imports a TypeScript parser (`single-definition/advance-switches.test.ts`).
- Machine-neutral: no path, host or account in code; the scratch root and the heads file are arguments.
- The script needs a Node with type stripping (22.18 and later strip by default); it refuses with a message otherwise.

## The rules the verdict applies

0. **A diff is judged only when it adds a marker line**, the `destHeader` comment the tool writes at the top of a new
   destination and in front of the regions it appends to an existing one. No marker added: the verdict is null, so an
   ordinary pull request (which shares private names such as `TOKEN` or `server` across files all the time) is never
   read as a move, and `branchVerdict` costs it one `git diff`. The marker is stripped wherever regions are compared.
1. **A move is a name removed from one changed file and added to another.** A marker added with no such name is
   `no-move`.
2. **Each moved name's region text is equal**, after removing one `export ` modifier on each side.
3. **Every other statement of every changed file is equal**, in order, after the same normalisation. Import
   declarations with bindings, `export { … }` lists and `export … from` lines are free; a bare `import './x.js'` and an
   `export default`/`export =` expression are not.
4. **No name is defined twice:** a name added to one file and still declared in another changed file is
   `defined-twice`; a name removed and added nowhere is `removed`; one added and removed nowhere is `added`.
5. **The exported surface is unchanged:** every name a changed file exported is still exported by it or, for a moved
   name, by its destination. A name exported only now is listed in `newlyExported`, and must be imported by another
   changed file (`export-unused` otherwise). A name a file exports twice (a declaration and a local `export { … }`
   list) is `exported-twice`: Node refuses that module.
6. **Every import resolves:** each relative named import or `export … from` (in the changed files and the importers
   given) of a changed file names something that file exports.
7. **`.mjs`:** `mjsNamespace` imports a module and returns its namespace keys and `String()` of each export, so a pin
   can compare a module before and after (spec §2 item 4).

KNOWN WIDTH: a hand move without the tool's marker is not judged (rule 0); a new file's header comment is set aside only
when it is followed by a blank line; `export *` satisfies any name (rule 6); a mention of the source module outside an
import (a `vi.mock`, a dynamic `import()`, a path a test reads) is reported by `plan` and `move`, not repointed; a
namespace object passed on as a value (`Object.keys(ns)`) is reported unless the file spells a moved name as a string;
a side-effect order change between two already-loaded modules is not judged.

## The move

- The named declarations move whole: every statement declaring a name (overloads, merged declarations), and a variable
  statement only when all its declarators are named. `export default`, `export =`, namespaces, decorators and an
  aliased local export (`export { a as b }`) are refused.
- The destination imports what the moved code references: the source's own import bindings (same specifier, re-based to
  the destination's directory, `type` kept per name) and the source's remaining declarations (`import type` when used
  only in type positions or a type declaration).
- The source drops imports only the moved code used, imports what it still references from the destination, and the
  moved declarations it references gain `export`.
- A cut with value references both ways is refused (`cycle`): move more, or cut elsewhere. A type-only edge back is
  allowed, because it is erased.
- A binding assigned on the side that would import it is refused: an import is read-only, so `count++` on an imported
  `let` throws at run time, and `.mjs` files have no typecheck to catch it (TypeScript reports TS2632). Moved together
  with the code that assigns it, the binding stays live for the side that only reads it.
- A staying declaration the destination imports gains `export`, unless a local `export { … }` list already exports it.
- Every importer of a moved, previously exported name is repointed to the destination; a namespace import that uses a
  moved name (`ns.X`, `ns['X']`, or the namespace passed on beside the string `'X'`, as `vi.spyOn(ns, 'X')` does) is
  refused.
- `move` runs `pureMoveVerdict` on its own output and writes nothing unless it is pure.

## Preflight

The heads file is JSON the caller writes from its own `gh pr list` and `git fetch origin pull/<n>/head`:

```json
[{ "pr": 101, "head": "<sha>", "move": { "source": "server/src/coord/store.ts", "dests": ["server/src/coord/runsStore.ts"] } },
 { "pr": 102, "head": "<sha>" }]
```

Refusals: `unmapped <dest>` (no context row reaches it), `file-has-open-move #n` (one open move PR per file),
`slot-held <context> #n` (another file's open move PR writes a module in that context), `touched #n <name>` (the
head's diff from its merge base with `--base` has a hunk in that declaration). `--self <n>` skips the slice's own PR.

---

### Task 1: The verdict, on fixtures (red first)

**Files:**
- Create: `server/test/fileSplit.ts`, `server/test/file-split-pin.test.ts`

- [ ] **Step 1: Write the failing FIXTURE tests** for rules 1 to 6 and `duplicateDefinitions`: a byte-for-byte move is
  pure; an edited body, a dropped comment, an edited remaining statement, a kept old copy, a dropped export, an
  unresolved importer and an unused new export are each impure with their word; a feature diff is null.
- [ ] **Step 2: Run** `cd server && ./node_modules/.bin/vitest run test/file-split-pin.test.ts`. Expected: FAIL, the
  module does not exist.
- [ ] **Step 3: Implement** `topLevel`, `pureMoveVerdict`, `duplicateDefinitions`, `exportsOf`. Run: PASS.

### Task 2: The move (red first)

- [ ] **Step 1: Failing tests:** `planMove` on a fixture source with imports, a private helper, a type and a class
  gives the expected destination, source and importer texts; its verdict is pure; the cut both ways is refused; an
  unnamed co-declarator, a default export and a namespace importer are refused; an existing destination gets the
  regions appended and a clash refused.
- [ ] **Step 2: Implement** `planMove`. Run: PASS.

### Task 3: Preflight and the heads (red first)

- [ ] **Step 1: Failing tests** for `touchedDeclarations` (a hunk in a body, in a lead comment, an insertion between
  two declarations), `parseHunks`, `contextOf` and `preflightVerdict` (each refusal, and `--self`).
- [ ] **Step 2: Implement.** Run: PASS.

### Task 4: The script, end to end on a fixture repository

**Files:** Create `.github/ci/file-split.mjs`.

- [ ] **Step 1: Failing test:** in a fixture git repository (git environment scrubbed), `move` writes the destination
  and repoints the importer, `verdict --base` then answers pure, and `preflight` refuses a head that edits a moved
  declaration and passes one that does not. Spawned through `spawnSyncGroup`.
- [ ] **Step 2: Implement the script.** Run: PASS. Add **REAL**: this branch's diff against `moveBase` is pure whenever
  it adds a marker line (null on this PR, which moves nothing, and on every feature PR). `moveBase` reads
  `merge_group.base_sha` in a queue run.
- [ ] **Step 3: Gates:** both typechecks, the tests' typecheck, the census and ratchet suites named in the brief.

### Task 5: Prove it on a scratch copy of the pilot

- [ ] **Step 1:** export `HEAD` to a scratch directory, link `server/node_modules`, and run
  `node .github/ci/file-split.mjs plan` and `move` for `DelegationDurability` and its types into
  `server/src/coord/delegation-durability.ts` (the spec's target module).
- [ ] **Step 2:** in the scratch copy, `tsc --noEmit` and the delegation suites; record the counts in the PR body. The
  scratch copy is deleted; nothing of it is committed.

## Deviations found

- **The spec's pin for `.mjs` is runtime, the TypeScript pin is textual.** Spec §2 item 4 names namespace keys and
  `String()` of each export for `.mjs`. `mjsNamespace` provides that comparison, but importing a module runs its top
  level, so the pin applies it to fixtures only; a real `.mjs` slice is judged by the textual verdict, which applies to
  both languages, until the history programme (which owns the large `.mjs` files) asks for the runtime check.
- **The library lives in `server/test/`, beside the parser and the context table it reads**, as the ccd plan puts
  `ccdSplit.ts` there. The script under `.github/ci/` loads it through Node's type stripping and a `.js`-to-`.ts`
  resolve hook, so the tool's decisions have one copy and the tests import it directly.
- **The move signal is the tool's marker, not a shared name (review round 1).** The first verdict read any name newly
  declared in one changed file and declared at the base in another as a move. Private helpers and test constants share
  names across files all the time, so 12 of about 60 recent merges to main were judged impure moves, and the REAL row
  (a `-pin` suite, so on every fast PR) would have redded them, at 37 to 60 s each. The verdict now waits for a marker
  line, as the ccd verdict waits for a library pointer: over the latest 60 first-parent merges every verdict is null in
  at most 1 s, and the pilot's real move (16 declarations, 26 files) is judged pure in 2 s.
- **Importers are repointed, not served by a façade re-export.** A re-export from the source would make every cut a
  value cycle (the destination imports the source's remaining code, the source re-exports the destination), which the
  pilot's L3-below-L1 cut would hit at once. A file whose role is a façade (`store.ts`) gets its delegates in a
  later step, by its own plan.
