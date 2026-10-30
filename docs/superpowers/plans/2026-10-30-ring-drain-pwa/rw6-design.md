# Ring drain, PWA half, Task RW6: the Docs link policy takes its highlight-budget languages through a port — task design note (D-7574)

**What this is.** The design note that the PWA ring-drain plan (`docs/superpowers/plans/2026-10-30-consolidation-ring-exemption-drain-pwa.md`, Task RW6, §Gates, §Global constraints, §Review focus) requires before any RW6 code. RW6 is DESIGN NOTE BEFORE BUILD. This file resolves the task's five open problems, names the route and gives the build in the plan's shape. It is docs only: it builds nothing and edits no plan. D-7574 is the plan's number for this task ("by the route its design note records"); this note cites it and defines no number. §1.5 lists where the note refines the plan's sketch; none of those needs a number.

**Routing.** The note is band 3, native: the page highlight budget is the bound on how much untrusted page text the quadratic grammars are handed (review 450 F1).

**Base.** Every count here was measured on `origin/main` `e2017e8bf`. Between the plan's base (`87cfba3dd`) and this one, `git diff --stat` over `pwa/src/docs`, `pwa/src/lib/markdown.tsx`, the six docs and markdown tests named below and `server/test/rings` is empty, so the plan's counts were checked again rather than inherited. The set still holds 13 entries and its stamp still reads `size: 13`, `since: '2026-10-23'`. Rings come from `server/test/rings/ring.ts#pwaRing`, run in a scratch server test that was deleted afterwards. Call sites were counted by reading every `detachUrls(` line in `pwa/src`, `pwa/test`, `server/test`, `shared` and `ui/src`, comments and test titles excluded. Open PRs come from `gh pr list --state open --json number,title,files` on 2026-10-30 (18 open), and `gh pr diff 1610` was read. Every claim marked **measured** was run on this base, or on a scratch prototype of route (b) on this base (§1.4), and then reverted. Code is cited by file and symbol, never by line.

**Verdict.** **Route (b).** `docs/docsLinks.ts` declares `DocsHighlightLanguages`, and `detachUrls(tree, langs)` takes it as a **required** second parameter. `docs/DocMarkdown.tsx` declares one module constant over the renderer's three real functions and passes it. `lib/markdown.tsx` is not touched. A new composition pin renders through `DocMarkdown` and goes red when the root passes anything but the real three (§2). The build lands in four commits: characterization, port, test call sites, drain (§4).

---

## 1. Open problem 1: the route

### 1.1 The edge, re-measured

- **The pair:** `pwa/src/docs/docsLinks.ts -> pwa/src/lib/markdown.tsx`. `docsLinks.ts` is L1 ("no outer-ring fact") and `markdown.tsx` is L4 ("a .tsx file"). Both measured.
- **The names that cross:** `codeLanguage`, `inScanPageBudget` and `inMarkdownPageBudget`, on one import line, `import { codeLanguage, inMarkdownPageBudget, inScanPageBudget } from '../lib/markdown';`. All three are read only in `detachUrls`' `pre` branch: `const language = codeLanguage(preCodeClass(node));`, `const scan = inScanPageBudget(language);`, `const md = inMarkdownPageBudget(language);`. No other line of `docsLinks.ts` names them, except the `detachUrls` docstring's prose.
- **Who else reads them:** `codeLanguage` is read by `markdown.tsx#CodeBlock` and `docsLinks.ts`. The two predicates are read by `docsLinks.ts` and by `pwa/test/markdown-bounds.test.tsx`, which imports them from `../src/lib/markdown`. Nothing in `server/test`, `ui/src` or `shared` names them.
- **`detachUrls` call sites (measured: 27 text matches, 1 definition, 26 calls).**

| File | Calls | Where |
|---|---|---|
| `pwa/src/docs/DocMarkdown.tsx` | 1 | `DocTree`, `useMemo(() => detachUrls(p.tree), [p.tree])` |
| `pwa/test/docs-links.test.tsx` | 15 | a module helper (the `detached` const) and 14 rows |
| `pwa/test/docs-highlight-budget.test.tsx` | 9 | 6 rows, two `decisions` helpers and the review 460 F10 `run` helper |
| `pwa/test/docs-images.test.tsx` | 2 | one module helper and one row |

  So there is 1 production call and 25 test calls, 26 in all. One more text match is the definition in `docsLinks.ts`. Comment mentions and the `it(...)` titles that name `detachUrls` are not counted. No file names `typeof detachUrls`, `Parameters<typeof detachUrls>`, `.call`, `.bind` or `.length`, and none passes `detachUrls` as a value.
- **The other imports of `docsLinks.ts`, and their rings (measured):** `../lib/markdownLimits` L1, `./docsText` L1, `./DocLink` (type only, erased), `./useDocsVisit` for `pinFor`, a **runtime** import of a file that is **L4 ("exports a hook")**. The rule's forbidden targets are a `.tsx` file, a store and `lib/api.ts`, so this L1 → L4 edge is not in the set and the rule cannot see it. It is outside RW6. §6 names it as a follow-up.

### 1.2 Route (b): a port on `detachUrls`, measured

| Measure | Value |
|---|---|
| Files edited | 5: `docsLinks.ts`, `DocMarkdown.tsx`, and the three docs tests. Plus the two ring data files at the drain. |
| Lines moved | **0** |
| Production lines changed | `docsLinks.ts`: the import line goes (−1), the interface is added (+5 with its docstring line), the signature changes (1), the three reads change (3), and the docstring gains one sentence. `DocMarkdown.tsx`: one import line widens, one type import widens, the constant is added (+2 with its docstring), and the `useMemo` call changes (1). |
| Call sites edited | 26 at today's count (25 tests and the root). 27 after the build's Step 1, which adds one `decisions` helper (§3). |
| `markdown.tsx` | untouched |
| Rule 6 | clean (§4) |

**Prototype (measured).** Route (b) was applied on a scratch copy of this base: the interface, the required parameter, the root constant and a `LANGS` fixture constant in each of the three test files, with the entry deleted and the stamp set to 12. On that copy, `tsc --noEmit` was clean, and these files were green: `docs-links.test.tsx` (54), `docs-highlight-budget.test.tsx` (22, then 23 with the composition pin), `docs-images.test.tsx` (74), `docs-markdown.test.tsx` (48), `docs-screen.test.tsx` (82), `markdown-bounds.test.tsx` (125), `tool-well-plan.test.ts` (23) and `docs-scans.test.ts` (23). A full `pwa` vitest run was also green: 11 491 passed and 3 skipped. On the server, `rings/pwa-rings.test.ts` (8) and `rings/exemption-age.test.ts` (4) were green. The copy was then reverted, and none of it is in this branch.

**One effect beyond the edge (measured).** An import-closure walk over `pwa/test` (relative runtime imports; `import type` skipped) finds **38 test files** whose only path to `lib/markdown.tsx`, and so to highlight.js, its 15 grammars, their registration and `session/chat.css`, runs through `docsLinks.ts`. They reach it through `SessionFlows.tsx`, `SessionActionsSheet.tsx` and the Docs heads. Under (b) they stop loading the renderer. All 38 were green in the full run above. In the app nothing changes, because chat loads `markdown.tsx` anyway. The build's Step 0 re-runs the walk, and its Verify runs the full suite once (§4).

**Precedent.** D-6387 already did this for the tool wells. `session/toolWell.ts` is L1, and the caller (`ToolWellText.tsx`) hands it `isRegisteredGrammar` because "an L1 module may not load a `.tsx`". `tool-well-plan.test.ts` gives it a stub in its unit cases and the real registry in one case. Route (b) is the same shape, with the composition pin in place of that one case.

### 1.3 Route (a): the grammar registry moves inward, measured

A scratch extraction of the region the plan names gives **189 lines**. Those are the 17 highlight.js import lines, one `markdownLimits` import, `xmlWithoutSubLanguages` with its docstring, the registration and aliases (56 lines), and `codeLanguage` through `inMarkdownPageBudget` (113 lines: `codeLanguage`, `embeddedGrammars`, `deriveBoundedCaps`, `HIGHLIGHT_BOUNDED_CAPS`, `BOUNDED_BY_DEF`, `boundedCap`, `highlightBlockCap` and the two predicates). `pwaRing` reads the scratch module as L1 (measured).

| Measure | Value |
|---|---|
| Files edited | 1 new module; `markdown.tsx` (about 186 lines out, and an import in, since `CodeBlock` reads `codeLanguage`, `boundedHighlight` reads `highlightBlockCap`, and `isRegisteredGrammar` and `highlighted` read `hljs`); `docsLinks.ts` (one import line); `markdown-bounds.test.tsx` (its import of `HIGHLIGHT_BOUNDED_CAPS`, `deriveBoundedCaps`, `highlightBlockCap` and the two predicates splits); `render-hast.test.tsx` (two premise comments, "re-derived from the grammars `lib/markdown.tsx` registers" and "importing lib/markdown.tsx registers them", go stale but stay green); `markdownLimits.ts` (two docstrings name `markdown.tsx` as the home of `HIGHLIGHT_BOUNDED_CAPS` and the embedding note); the `markdown.tsx` header ("Moved unchanged: … the highlight.js registration (a module side effect)"); and the spec's context table, if the module's name leaves K |
| Lines moved | about 189 |
| Call sites edited | 0 |
| Rule 6 | **not line-disjoint with #1610** (§4) |
| Ring caveat | the new L1 module mutates the shared `highlight.js/lib/core` instance as a module side effect. No other L1 module in the PWA does that. `CodeBlock` would depend on the import order for registration to happen first. |
| `MARKDOWN_FILES` | `pwa/test/markdown-runner.test.ts#MARKDOWN_FILES` is `readdirSync(lib).filter((f) => /^markdown.*\.tsx?$/.test(f))`. A name starting `markdown` joins its two scans (no `postMessage`/`onmessage`; no `message` listener or `URL.createObjectURL`). The region holds none of those, so it would pass. A name such as `lib/highlightGrammars.ts` stays outside them. |

**Its gain:** one owner for the grammar facts outside the renderer. Today nothing needs that owner. `docsLinks.ts` needs three answers, not the registry. Under (a), `docsLinks.ts`, and through it the session menu and the actions sheet, would still load all 15 grammars at runtime.

### 1.4 Choice: (b), and why

1. **It removes the edge without moving anything.** (a) also removes the pair from the set, but it moves about 189 lines with a global side effect into a module the ring rule calls L1.
2. **Rule 6.** (b) leaves `markdown.tsx` alone, so #1610 rebases cleanly. (a) deletes the region #1610 edits (§4).
3. **It is the codebase's own pattern** (D-6387, `toolWell.ts`), and the plan already recommends it.
4. **The guarantee it relocates is pinned.** Under (b), the root's constant decides whether the Docs page counts the real grammars. §2's pin holds that constant through the real render. Every mutant of the root that was tried turned it red (§4.4).
5. **The 26 call-site edits are mechanical** (band 1). The type checker refuses a missed one once the parameter is required.

Route (a) is not taken. The note records its measurements (§1.3) in case a later task wants one owner for the grammar facts, for a reason of its own.

### 1.5 Where this note refines the plan's sketch

- **The port lands in strangler order (spec §5.1 rule 2), in three commits, not one.** Commit 2 (the port) gives `detachUrls` the parameter as **optional**, with a transitional fallback built from the existing import, and the root passes its constant. Commit 3 (band 1) moves every test call to its file's `LANGS` constant. Commit 4 (the drain) makes the parameter **required**, deletes the fallback and the import, and deletes the entry. The end state is the plan's: required, no default. A single commit would also work, but it would mix the band-3 signature change with the 26 band-1 edits. The split keeps the band-1 commit on its own, so it can be handed off and reviewed alone.
- **The composition pin lives in `docs-highlight-budget.test.tsx` and renders `DocMarkdown`** (§2), as the plan asks. No existing row of that file renders `DocMarkdown` (measured), so the pin is a new row.
- **Step 1 adds one `detachUrls` call** (the new characterization `decisions` helper), so the build edits 27 call sites, not 26.

## 2. Open problem 2: the composition pin

**What exists (measured).** All 22 rows of `docs-highlight-budget.test.tsx` call `detachUrls` directly, and the rendered ones draw its result through `renderHast` themselves, with or without `PreHighlightContext`. **None renders through `DocMarkdown`.** Under (b) every one of them passes its own fixture constant, so none can see the root. The only test that renders `DocMarkdown` with code blocks is `docs-markdown.test.tsx`'s row "the page highlight budget reaches the blocks: of nine 60 000-character python blocks the ninth is not highlighted". Its page is python only, so it reads the general budget, which none of the three functions feeds. The measurement substituted the plan's stub `{ codeLanguage: () => '', inScanPageBudget: () => false, inMarkdownPageBudget: () => false }` at `docsLinks.ts`'s import, which on this base is the value a root would pass. With it, `docs-markdown.test.tsx` (48), `docs-screen.test.tsx` (82), `docs-links.test.tsx` (54) and `docs-images.test.tsx` (74) **all stayed green**, and only the 11 direct rows of `docs-highlight-budget.test.tsx` went red. So no existing pin holds the composition root.

**The row to add** (Step 1; green on `main` unported, measured; ran in under a second). It is a new `describe` at the end of `docs-highlight-budget.test.tsx`: `'D-7574: the Docs page hands detachUrls the real highlight-budget languages'`. It has one row: `'through DocMarkdown, a tsx block past the scan budget and an md block past the markdown budget are not highlighted'`. Within the row:

- A `lang(name, text)` builder that makes `pre > code.language-<name>`.
- A `LINK` fixture: `project: 'project-a'`, `pageRef: null`, `view: 'effective'`, `section: 'specs'`, `path: 'a.md'`, `tree: treeOk()` (from `./docsFixtures`), `pageSource: 'committed'` and a no-op `onFragment`.
- A `marks(blocks, selector)` helper. It renders `<DocMarkdown text="budget page" pinKey="p" parser={vi.fn<MarkdownParser>(async () => ({ kind: 'tree', tree, depth: 3 }))} link={LINK} />`, waits for `blocks.length` `.code-block` elements, and returns, per block, how many matches of `selector` it holds. It then calls `cleanup()`.
- **Page T (the scan budget):** `[lang('ts', 'x'.repeat(393216)), lang('tsx', 'const a = 1\n'), lang('python', 'import a\n')]` counted by `.hljs-keyword` is `[0, 0, 1]`. The first block is over the ts block cap, so it is never highlighted or scanned, but it fills the scan sum exactly. The `tsx` block (an alias) is refused only by the scan sum. The python block is the control: the general budget is not reached.
- **Page M (the markdown budget):** `[lang('md', 'x'.repeat(131072)), lang('md', '# h\n'), lang('yaml', '# c\n')]` counted by `.hljs-section, .hljs-comment` is `[0, 0, 1]`, by the same logic with the `md` alias.
- A 60 000 ms timeout, as the file's other rendered rows have.
- New imports: `vi` (vitest), `waitFor` (testing-library), `type DocLinkContextValue` added to the existing `DocLink` import, `DocMarkdown` from `../src/docs/DocMarkdown`, `type MarkdownParser` from `../src/lib/markdownRunner`, and `treeOk` from `./docsFixtures`.

Literal sizes, as the file's comment asks ("never the imported constant, so a mutated constant reds a behaviour case"). Both pages stay under the 524 288 general budget (393 237 and 131 080 characters).

**It goes red for every wrong root (measured, §4.4):** the plan's stub; each function stubbed alone (`codeLanguage` to `''`, `inScanPageBudget` to `false`, `inMarkdownPageBudget` to `false`); either predicate made always `true` (the python or yaml control is refused); and, on the prototype, the root's constant with the two predicates swapped.

## 3. Open problem 3: the characterization (the build's Step 1)

**What `docs-highlight-budget.test.tsx` holds today**, by budget and alias:
- The general budget: python (the first row and the M4.H2 rows), a block with no language, and `ts`, `json` and `markdown` blocks refused after 524 288 characters of python.
- The scan budget: `ts` (the boundary, (a)), `jsx`, `rs`, `rust` and `tsx` as the refused block ((c)), and `json`, `xml` and `svg` outside it ((b), (d), (e)). Rendered: `ts`, `tsx`, `javascript` and `rust` (review 460 F10).
- The markdown budget: `markdown`, `md` and `mkdown`, including the boundary ((a2), (b)), with `yaml` and `ts` outside it ((c), (d), (d2)).

**What is missing** (each row green on this base, measured; "port" marks a row that went red under the stub, so it holds the port's values):

| # | Row (on `main`, `decisions(...)` calls `detachUrls(tree)`) | Expected | Port |
|---|---|---|---|
| C1 | the general budget with the aliases: `[python 524288, tsx 1, md 1, ts 1]` | `[true, false, false, false]` | no (holds the general sum over aliases) |
| C2 | `tsx` fills the scan sum, at and past the boundary: `[tsx 393216, ts 1]`; `[tsx 393215, ts 1, tsx 1]` | `[true, false]`; `[true, true, false]` | yes |
| C3 | the canonical names and `js`: `[typescript 196608, javascript 196608, js 1, json 1]` | `[true, true, false, true]` | yes |
| C4 | how `detachUrls` reads the class (`preCodeClass`, then `codeLanguage`): `className: ['hljs', 'language-TSX']` with 393 216 characters, then `ts 1`; a string `className: 'language-ts'` with 393 216, then `tsx 1`; `['language-md', 'language-ts']` with 131 072, then `md 1`, `ts 1` (the first `language-` wins) | `[true, false]`; `[true, false]`; `[true, false, true]` | yes |
| C5 | `md` fills the markdown sum and `ts`/`tsx` are untouched by it: `[md 131072, tsx 1, ts 1, md 1]` | `[true, true, true, false]` | yes |
| C6 | an unregistered name counts in the general sum only: `[nope 400000, ts 1, md 1]` | `[true, true, true]` | no |
| C7 | both sub-budgets full fill the page exactly, and every later block is refused: `[ts 393216, md 131072, yaml 1, tsx 1, md 1]` | `[true, true, false, false, false]` | no |

They go in one new `describe`, `'D-7574 characterization: highlight decisions across the three budgets, with the aliases ts, tsx and md'`. It has its own `block(className, n)` builder (a `pre > code` whose `className` is the given array, the given string, or absent), a `lang(name, n)` builder over it, and one `decisions` helper. That helper's `detachUrls` call is the 27th call site. The filler is `'x'.repeat(n)`, as in the file's other decision rows. Rows C1, C6 and C7 cannot see the port. They hold the decisions the exit says must not change. C2 to C5 hold the port's values directly.

## 4. Open problem 4: rule 6

Measured on 2026-10-30 against the 18 open PRs:

| File | Open PRs holding it |
|---|---|
| `pwa/src/docs/docsLinks.ts` | none |
| `pwa/src/docs/DocMarkdown.tsx` | none |
| `pwa/test/docs-links.test.tsx`, `docs-highlight-budget.test.tsx`, `docs-images.test.tsx` | none |
| `pwa/test/docs-markdown.test.tsx` (run, not edited) | none |
| `server/test/rings/pwa-rings.data.ts`, `exemption-age.data.ts` | none (RW1 to RW5 and RW7 are not open yet; whichever lands first, the others rebase, §Landing order) |
| `pwa/src/lib/markdown.tsx` (route (a) only) | **#1610** (pwa to TypeScript 7; open, last updated 2026-10-27, head `14714d40c`) |

**#1610 against each route.** #1610's diff against its merge base holds two hunks in `markdown.tsx`: the `xmlWithoutSubLanguages` docstring (the 11.12 narrowing sentence) and its walk (the `subs` line). **Both are already on `main` in identical form.** #1609 ("pwa to the latest major of every dependency", merged 2026-10-27) landed the same text. Under **(b)** `markdown.tsx` is untouched, so a rebase of #1610 merges those hunks as a no-op. Under **(a)** the region moves out of `markdown.tsx`, so the same rebase is a modify/delete conflict inside the moved region. Not line-disjoint.

No other open PR holds a file either route edits. #1984, #1986 and #1627 (§In flight) hold none of them.

## 5. Open problem 5: citations and relative pointers (route (a) only)

Recorded for completeness, since (a) is not taken. The extracted region holds **no** match of `server/test/citations.test.ts#CITATION` (`ccd:\d{3,5}` or `.ts|tsx|mjs|sh:<n>`), measured. Its relative pointers:

| Pointer | Where | Rewrite under (a) |
|---|---|---|
| "so the walk below matches either shape" | `xmlWithoutSubLanguages`' docstring | none: "the walk" is that function's own body, which moves with it |
| "why it is not in the list below" | the registration comment | none: the list moves with it |
| "`deriveBoundedCaps` applied once to this module's instance" | `HIGHLIGHT_BOUNDED_CAPS`' docstring | "applied once to the `highlight.js/lib/core` instance this module registers into" (the instance is the same, but "this module" changes meaning) |
| "no list of aliases is kept here" | `BOUNDED_BY_DEF`'s docstring | none: it is still true of the moved file |

Under (b) no text moves, so §Global constraints' allowed edits (ii) and (iii) do not arise. `citations.test.ts` still runs in Verify, because it reads every added line.

---

## 6. The build, in the plan's shape

**Routing.** Steps 1, 2 and 4 are band 3, native. Step 3, the test call sites, is band 1. The orchestrator reviews every diff. **Branch:** `refactor/ring-drain-pwa-docs-languages`. **Files:** `pwa/src/docs/docsLinks.ts`, `pwa/src/docs/DocMarkdown.tsx`, `pwa/test/docs-highlight-budget.test.tsx`, `pwa/test/docs-links.test.tsx`, `pwa/test/docs-images.test.tsx`, `server/test/rings/pwa-rings.data.ts`, `server/test/rings/exemption-age.data.ts`. Nothing else. In particular, not `lib/markdown.tsx` and not the spec's context table (no new file).

- [ ] **Step 0: Re-ground** on the tree the build starts from, and report any count that differs before any commit:
  - the rings: `docsLinks.ts` L1, `DocMarkdown.tsx` and `markdown.tsx` L4;
  - `docsLinks.ts`' import block (the one runtime import of `../lib/markdown` and its three names; `./useDocsVisit` is still the unseen L4 edge of §1.1, which is not touched);
  - every `detachUrls(` call (26: 1, 15, 9, 2; no value use) and every reader of the three names;
  - the set's size and stamp, and so whether this drain empties it (it does only if every other RW task has landed first; if so, the stamp reads `size: 0, reason: 'empty since D-7574 (ARCH-05, #551)'`, and §Global constraints' "The commit that takes the set to 0" CONTROL check runs);
  - the import-closure walk of §1.2 (the test files that stop loading `lib/markdown.tsx`);
  - rule 6 (`gh pr list --state open --json number,files`, and #1610's state).
- [ ] **Step 1: Characterization commit** (band 3), green on `main`. In `docs-highlight-budget.test.tsx` only: §3's `describe` (C1 to C7) and §2's composition `describe`, with the imports they need. On `main` the new `decisions` helper calls `detachUrls(tree)`.
- [ ] **Step 2: Port commit** (band 3; the set unchanged):
  - **In `docsLinks.ts`:**
    - Declare `export interface DocsHighlightLanguages { codeLanguage(className: string): string; inScanPageBudget(lang: string): boolean; inMarkdownPageBudget(lang: string): boolean }`, with a one-line docstring: the renderer's grammar facts the page highlight budget reads, handed in because this L1 module may not load `lib/markdown.tsx` (D-7574).
    - Change the signature to `detachUrls(tree: HastRoot, langs?: DocsHighlightLanguages)`, with `const l = langs ?? RENDERER_LANGUAGES;`. `RENDERER_LANGUAGES` is a transitional module constant over the three imported functions; it keeps the edge, so the entry stays.
    - The three reads become `l.codeLanguage(…)`, `l.inScanPageBudget(…)` and `l.inMarkdownPageBudget(…)`.
    - The `detachUrls` docstring gains one sentence: `langs` holds the renderer's grammar facts (`DocsHighlightLanguages`), handed in by the Docs page.
  - **In `DocMarkdown.tsx`:**
    - Widen `import { PreHighlightContext, SHARED_COMPONENTS } from '../lib/markdown';` with `codeLanguage, inMarkdownPageBudget, inScanPageBudget`, and `import { detachUrls } from './docsLinks';` with `type DocsHighlightLanguages`.
    - After the import block, add `/** … */ const DOCS_HIGHLIGHT_LANGUAGES: DocsHighlightLanguages = { codeLanguage, inScanPageBudget, inMarkdownPageBudget };`, with a docstring saying it is the composition root's one copy of the three, and naming the pin.
    - `DocTree`'s memo becomes `useMemo(() => detachUrls(p.tree, DOCS_HIGHLIGHT_LANGUAGES), [p.tree])`. The dependency list keeps its bytes. `docs-markdown.test.tsx`'s row that pins one detach per tree object holds.
- [ ] **Step 3: Test call sites commit** (band 1; the set unchanged). In each of the three test files, add one `import { codeLanguage, inMarkdownPageBudget, inScanPageBudget } from '../src/lib/markdown';` (a test may load the renderer), widen the `docsLinks` import with `type DocsHighlightLanguages`, and add one `const LANGS: DocsHighlightLanguages = { codeLanguage, inScanPageBudget, inMarkdownPageBudget };`. Then every `detachUrls(x)` call becomes `detachUrls(x, LANGS)`: 15, 10 and 2 calls. Nothing else changes: no title, no assertion, no fixture.
- [ ] **Step 4: Drain commit** (band 3; −1):
  - In `docsLinks.ts`: `langs: DocsHighlightLanguages`, required; `RENDERER_LANGUAGES` and `l` deleted; the reads become `langs.…`; and the `../lib/markdown` import line deleted. `tsc` then refuses any call that does not pass it.
  - In `pwa-rings.data.ts`: delete the `'pwa/src/docs/docsLinks.ts -> pwa/src/lib/markdown.tsx'` entry.
  - In `exemption-age.data.ts`: write the stamp's `size` from the count, `since` from the commit's day, and the reason with the base's prefix and the tail `— <size> since D-7574 handed detachUrls its highlight-budget languages` (12 on this base; whatever Step 0 counts on the build's base).
- [ ] **Step 5: Mutation table, RUN** (each on a scratch copy, reverted after). "Measured" means the row was run for this note, at the root on the (b) prototype or by the equivalent substitution at `docsLinks.ts`' import on `main`. The build runs every row at the root after Step 4.

  | Mutant | Expected red | |
  |---|---|---|
  | the root passes the plan's stub `{ codeLanguage: () => '', inScanPageBudget: () => false, inMarkdownPageBudget: () => false }` | the composition pin (page T: `[0, 1, 1]`) | measured |
  | the root's `inScanPageBudget` is `() => false` (the other two real) | the composition pin, page T | measured |
  | the root's `inMarkdownPageBudget` is `() => false` | the composition pin, page M | measured |
  | the root's `codeLanguage` is `() => ''` | the composition pin, page T | measured |
  | the root's `inScanPageBudget` is `() => true` | the composition pin (the python control refused: `[0, 0, 0]`) | measured |
  | the root's `inMarkdownPageBudget` is `() => true` | the composition pin (the yaml control refused) | measured |
  | the root swaps the two predicates | the composition pin, page T | measured |
  | `detachUrls`' parameter keeps a default naming the renderer (`langs: DocsHighlightLanguages = { codeLanguage, … }` with the import back) | `pwa-rings.test.ts` "the L1 modules' forbidden runtime edges are exactly the exemptions" (a fresh `docsLinks.ts -> lib/markdown.tsx` pair, the three names listed) | measured |
  | the entry is left in the data file after Step 4 | the same row (a stale entry) | expected |
  | the stamp's `size` is left unchanged | `exemption-age.test.ts` "every stamp holds its set's size" | expected |
  | a test file's `LANGS` passes `inScanPageBudget: () => false` | that file's scan rows; in `docs-highlight-budget.test.tsx`, the 11 rows the stub turned red plus C2 to C5 | measured (the stub at the import turned the same rows red) |

  **Review check no suite can make red:** the root's constant built from anything other than `lib/markdown.tsx`'s three exports, such as a copy of the predicates written locally that agrees on today's two pages. The reviewer reads `DocMarkdown.tsx`'s import line and its constant.
- [ ] **Step 6: Verify,** one file at a time.
  - From `pwa/`: `docs-highlight-budget.test.tsx`, `docs-links.test.tsx`, `docs-images.test.tsx`, `docs-markdown.test.tsx`, `docs-screen.test.tsx`, `markdown-bounds.test.tsx`, `tool-well-plan.test.ts`, `docs-scans.test.ts`, `session-docs-link.test.tsx`, then `tsc --noEmit`.
  - From `pwa/`, once, the full suite (`./node_modules/.bin/vitest run --maxWorkers=2`). It covers the 38 files that stop loading the renderer (§1.2), which the prototype ran green.
  - From `server/`: `rings/pwa-rings.test.ts`, `rings/exemption-age.test.ts`, `rings/totality.test.ts`, `citations.test.ts` and `deviation-refs.test.ts`, then `tsc --noEmit -p test/tsconfig.tests.json`.

**Counted exits (the PR body prints them, base and tip):**
- the set's keys and the stamp;
- `docsLinks.ts`' runtime imports;
- the `detachUrls` call sites by file (26, then 27 after Step 1, every one passing a `DocsHighlightLanguages`);
- the readers of `codeLanguage`, `inScanPageBudget` and `inMarkdownPageBudget` by file and symbol (base: `docsLinks.ts#detachUrls`, `markdown.tsx#CodeBlock`, `markdown-bounds.test.tsx`; tip: `DocMarkdown.tsx#DOCS_HIGHLIGHT_LANGUAGES` and the three tests' `LANGS` in place of `docsLinks.ts`).

**Exit (GATE):**
- no key from `docsLinks.ts`, which no longer imports `lib/markdown.tsx` at runtime;
- every `highlight` decision of every page in `docs-highlight-budget.test.tsx` unchanged: its 22 base rows and C1 to C7 green, their assertions byte-identical, and only the `LANGS` argument added;
- the composition pin green.

**Must not change:** any block's highlighting on any page, any label, `markdown.tsx`. **Rollback:** `git revert`, last commit first.

## 7. Follow-ups this note names (not built here)

- **`slug docs-links-pin-hook-edge`.** `docsLinks.ts` (L1) imports `pinFor` at runtime from `docs/useDocsVisit.ts`, which `pwaRing` reads as L4 ("exports a hook"). The set's rule forbids only a `.tsx` file, a store and `lib/api.ts`, so the edge is outward but neither held nor seen. `pinFor` is pure (`imagePinFor` asks it for the page's own pin). It could move inward to an L1 docs file the hook re-reads. The question is the coordinator's: a later task, or a known limit. RW6 does not touch it.
- Route (a)'s single owner for the grammar facts, if a later task needs one for its own reason (§1.3).

## 8. Reviews

The plan requires two independent reviews of this note. Then the coordinator records the route, and RW6 is dispatched built from this note.
