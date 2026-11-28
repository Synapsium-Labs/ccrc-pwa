# X2 P6.1: Print stage 1 (run 4075, wave 58)

Task note for the programme ledger. The plan's Results section "Wave P6.1" is the record; this note carries what the ledger
should learn. Plan: `docs/superpowers/plans/2026-11-18-native-docs-parity.md`, Task P6.1. Spec: `2026-11-18-native-docs-parity-design.md`
sections 4.3 and 4.6. Read at `main` `7d2c9aecb3` (Reader Mode merged).

## Step 0: the parser

- **Chosen:** `hast-util-from-html` 2.1.0, exact pin (`pwa/package.json`, no caret), the plan's default. It parses with parse5 8.0.1
  through `hast-util-from-parse5` 8.0.4 and needs no DOM.
- **Released** 2026-11-06 (21 days before the pin). Integrity
  `sha512-873p9AuH93gBnATbH8rU3YvjTKxyrIeWd/M9tiLMzn3G82Os0xhQurctfnbYUSrDXoyjbJGpJ2qmTpefMw7ZaQ==`, published from the
  syntax-tree organisation's repository.
- **New in the lock:** `hast-util-from-html` 2.1.0, `hast-util-from-parse5` 8.0.4, `hastscript` 9.0.3, `hast-util-parse-selector` 4.0.0,
  `vfile-location` 5.0.4, `web-namespaces` 2.0.1. `parse5` 8.0.1 and `entities` 8.0.0 were already in the lock as development
  dependencies (through jsdom) and are now runtime ones.
- **`npm audit signatures`:** 1 230 packages with verified registry signatures, 0 invalid, 0 missing. Of the parser's tree only
  `entities` 8.0.0 carries a provenance attestation; the others are signature-only.
- **Its import list** (walked from the package entry, ESM `import`/`export … from`): `hast-util-from-html`, `hast-util-from-parse5`,
  `hastscript`, `hast-util-parse-selector`, `parse5`, `entities`, `vfile`, `vfile-message`, `vfile-location`, `devlop`,
  `property-information`, `space-separated-tokens`, `comma-separated-tokens`, `unist-util-stringify-position`, `web-namespaces`;
  69 files. `vfile`'s Node entries name `node:path`, `node:process` and `node:url`; the bundle takes their browser entries
  (`#minpath`, `#minproc`, `#minurl` default conditions), as the parse chunk already does for `vfile`. No file of the tree uses
  the DOM's `document` or `window` (one `document.length` in `hast-util-from-parse5` is a local variable).

## Step 0b: GATE-L1's desktop Chromium leg

- The page: `LAB_GATE_PAGE` in `pwa/src/readerLab/fixtures.ts`, exactly 524 288 bytes of dense Markdown (headings, tables, lists,
  fenced code, quotes, prose), not one of `LAB_PAGES`, whose pages and pinned outputs are unchanged.
- **Measured 2026-11-27**, headless Chromium (Blink 153) through the reader lab's browser case, 390 px wide, the fleet box at a
  one-minute load of 7.3 on 16 cores: render job median 99 ms, worst 174 ms; render and mount to `ready` median 1 024 ms, worst
  1 132 ms; against `DOCS_PARSE_BUDGET_MS(524288)` = 10 000 ms: within. The whole browser case took 30 s.
- **Measured again after the review's fix round** (the five runs moved after the door's last read), load 7.9 to 6.2: render
  median 98 ms, worst 130 ms; render and mount median 969 ms, worst 1 032 ms; within. The browser case took 30 s.
- The line's words: `within`; `over (run N)` when a render answered `timeout` or ran past the budget, with the figures of the
  runs that rendered; `k of 5 runs ready; first failure: run N, <stage>, <outcome>; … not measured` when a run did not get
  ready, with no figures. The decision is `verdicts.ts#gateReading` (L1); `result.ts` formats it.
- The five gate mounts run after step 9's final door read, so `LAB_RUN_CAPS_MS` still covers everything the door reads; they
  are outside the caps by design, which `run.ts#LAB_GATE_RUNS` says.
- Review: one Opus subagent over the diff (it read every changed file in full; it stated its own context's effort as 15,
  low, although the call asked for high). It found 4 important findings (a render over budget read as "not measured"; a
  "not measured" line printed figures from failed runs; the gate's mounts pushed a run at every cap past its door life; the
  browser case's margin) and 6 minor ones. All were fixed except the margin, which the measured 30 s settles.
- Slips: one implementer test edit was made by a Python script (round 1); one implementer run was piped into `tail`.
- The gate page renders to about 26 500 elements, above `DOCS_MAX_RENDER_ELEMENTS` (20 000), which the plain parse path
  applies and the reader's render job does not: the same page in the plain view would be plain text.
- Not measured: the phone leg (the coordinator's device item) and Firefox.

## Step 0b2: parts cut at the library's own block boundaries

- **How.** The render job gains `blocks: true` (`readerRenderJob.ts`): the same prescan, then the library's `render` with
  highlighting off under `READER_BLOCKS_MAX_BYTES` (2 MiB) and `READER_BLOCKS_HTML_MAX_BYTES` (8 MiB), then the HTML parser
  (`renderTree.ts`, the one module that imports it) reads the outermost `data-line` ranges as blocks (`MdBlock`: heading, list
  with its items, quote with its blocks, fence, code, other; overlaps merged). The console asks for windows of one render
  gate from a confirmed block start (`mdParts.ts#collectMdBlocks`): a window after offset 0 is sent behind one newline, so a
  `---` line there is never front matter; every block but the window's last is confirmed; one block longer than the window
  grows it to 2 MiB, then gives up, and from that offset P1's cutter takes the rest (`tailFrom`).
- **The cut** (`splitMarkdownPartsAt`): a part ends only at a block start, the latest heading start that fits, else the latest
  block start, never before a three-dash line. A block longer than a part is cut inside: a list or quote at its items; a
  fence closed and reopened with its container's prefix (a list item's or a quote's), never leaving a code-point tail that
  starts with a fence marker; anything else by P1's cutter on that block alone. `splitMarkdownParts` (P1) is unchanged and
  stays the fallback: no worker, a refused or timed-out window, the tail after a give-up.
- **The runner** forwards `blocks: true` only when set (`markdownRunner.ts`, by its holder's leave), so every other render
  message is exactly `{id, kind: 'render', src}`. The purity guard holds the parser to `renderTree.ts` (by its holder's leave).
- **The fuzz** (seed 20261120, the full mix, 8 000 documents, `maxBytes` 60 to 800, 7 031 of more than one part, 29 to 45 s
  in the test slice): mdast oracle, new cutter 0 violations, P1's cutter 16 406 in 2 368 documents. The generator was rebuilt
  from Results' description (P1's scripts were not kept), so P1's count differs from the recorded 35 159.
- **The library judge** (the library's parse of the whole document against each part, every code line at any depth): new
  cutter 36 lines in 27 documents, P1's 169 842 in 4 262. What remains is residual class 5's shape: a paragraph, or an item's
  or a quote's text, longer than a part with a line indented four columns or more, at these small part sizes. It is a ratchet
  in the fuzz case (`JUDGE_RECORDED`), not asserted at zero.
- **The nine residual classes**: each recorded input is a case in `docs-md-parts-blocks.test.ts` with zero judge violations
  (class 3 at 51 to 54 bytes; at 11 to 14 only the fit is asserted, a part that small holding no fence's two lines; the input
  measured zero violations at every size from 11 to 140). Residuals 1, 6 and 7's pins in `docs-md-parts.test.ts` now run the
  block cutter. First a positive P1 case was added, red under M11.113, M11.115 and M11.116 each (its three inputs, one a row).
  The plan's mutation table names those rows' red tests as the old "pinned as today's behaviour" cases, which no longer exist
  under those names: the positive case is what guards them now.
- **Review** (one Opus subagent; it read every new file in full and the rest by diff; it stated its context's effort as 15,
  low). Important: a multi-line `<!--` comment crossing a window's end made false block starts (401 in one probe), fixed by
  confirming nothing from a window's first unclosed comment on; no part showed until the whole text was read (about 0.2 to
  0.4 s a window), fixed by an incremental cut that mounts part 1 once it is final ("Part k", then "Part k of n"); the
  runner's forwarding had no red test, now pinned and measured red by deleting it. Minor, all fixed: a code-point tail of
  spaces then a fence marker; a reopen indented past a list item's content column; the html cap's comment (now 10 MiB, a
  table drawing 4.4 times its size in html, a list 3.4); fit and cover in the fuzz; the header's class-2 line; the cut's one
  decision moved from delivery to `mdParts.ts#cutMarkdownText`; a linearity probe that could not see a repeated scan.
- **Still open, stated:** a list item with two or more fences, and a quote or list nested in an item, longer than a part
  (22 and 29 judge lines at 100 bytes in the review's probe); a paragraph or item text longer than a part with a line
  indented four columns or more (class 5's shape, 35 of the fuzz's 36 judge lines). Both need a single block above the
  render gate in production. A fragment link waits for the whole cut before it opens its part.
- **Cost:** the blocks read is about 0.2 to 0.4 s a 512 KiB window in Node on the fleet box, so about 25 to 50 s for a
  64 MiB file on a desktop before the last part is known; part 1 shows after the first windows.
- **Slips:** implementers wrote tree files once with `python3` and once with `sed -i` (their own new files), ran one empty
  heredoc, and wrote `render-tree`, the flipped pins and the fuzz after their code.
- **Security fix** (`0e08fce234`, after the commit): the automated security review of `3cabd3769d` found two main-thread
  denial-of-service paths from a document's bytes in the open-comment scan: a container-prefix regex that backtracked
  exponentially (measured: 18 repeats of `-   ` before `<!--` took 3 s, 20 took 26 s) and a per-`<!--` walk back to the line
  start (quadratic on one long line of openers). Now one linear pass with a 256-character prefix cap, line starts carried
  forward, at most 4 096 candidate lines a window, failing closed (a capped window only shortens). One more quadratic path,
  the fence cutter's tail check over a long run of spaces, now jumps to the run's start. Each is bounded by the cutter's work
  counter, measured red first (`expected 12008695 to be less than or equal to 480624` for the tail).

## Step 0c: Export, Changes since and "as read at" for a document read by range (`f574ef3746`)

- **Export** of a document read by range (above 2 MiB, or a stat-pinned draft) exports the part on screen, and the sheet says
  "This exports the part on screen."; a stat-pinned draft carries the drafts banner from `exportProvenance` with the snapshot
  digest as `fp` and the read's time; a committed document none. A document read whole (up to 2 MiB) keeps Export on its whole
  text through Format anyway, as spec 4.3 says, so the plain view of a text between 512 KiB and 2 MiB still asks the gate
  question. "Acts on the part" is one predicate (`range/rangePolicy.ts#actsOnPart`), read from what the body publishes
  (`ExportBody`'s `part`), and a body that will never come (text above 2 MiB that is not UTF-8) publishes `none`: no Export.
- **The range read's facts** (`{key, digest, readAt}`, `readAt` the wall-clock time the last frame checked) reach the head through
  the visit (`rangeOpened`): matched by the read's own key (project, section, path, range pin, size), so a re-list that leaves
  the bytes alone keeps them; dropped when a read starts again, on Cancel and on failure (`rangeDropped`). The opened pin is built
  from the current listing pin and the digest.
- **"As read at"**: the truth line says "as read at <time>" (`folderPage.ts#utcMinuteText`, the one owner of that format) for a
  stat-pinned draft once its read finished. **Decision:** the plan's "the time its bytes were read, from the opened pin" names a
  time the pin does not carry (its only time is the listing's `mtimeNs`); the read's own wall-clock time is used, carried with
  the read's facts.
- **The plain view** of a document above 2 MiB shows the same parts, at the part the reader was on (a one-entry cache of the
  last whole cut and index per body key and text); a reader only part cut when Export's plain-view tap comes re-cuts at part 1.
- **Changes since on the current part** (`reader/partChanges.ts`, L1): a head at or below 2 MiB uses the whole diff clipped to
  the part, and every refusal of it stands (unavailable: the spec's 20 000-line cap); a head above 2 MiB uses the part's own
  region, aligned by the two texts' common lines before and after (linear scans, no array of lines), with a removal at a part
  edge owned by the part before it, as the whole form owns it. The base above 2 MiB is read by range from the blob its
  `too-large` answer names, through the screen's fetch queue, kept for the history's life. A note under the part bar, above
  2 MiB: "Changes since and Export act on this part." **Stated limits:** a part that starts inside a changed middle may mark the
  removal just above it; a middle past the diff's own bounds gives the edge part no removal mark; the base cache does not
  survive a part switch (each part's history is its own).
- **Styles** (`docs.css`): the part bar (one row; at about 320 px Next drops beneath), the position text in tabular figures, the
  range progress line, each control at the tap floor in its own rule; `.docs-in-parts` fills the leaf as the whole document's
  frame does. Unchecked on a rendered page (jsdom evaluates no stylesheet); the browser leg sees them in Step 1.
- **Reviews:** one Opus subagent over the whole step (it read every diff in full; it stated effort 15, low). Important, all fixed:
  facts lost on a re-list that left the bytes alone; facts kept through a re-read, Cancel or failure; removals at part edges
  lost in the region form; the region form used for a whole-read side over 20 000 lines (I had allowed it; ruled back to the
  spec); the plain view losing the reader's part; non-UTF-8 text above 2 MiB misjudged. Minor, fixed: three copies of the
  predicate; the part bar's wrap comment; the part's frame fill; the page check untested; `rangeRead`'s optional argument; no
  screen-level banner-time case; unused context fields; the base re-read per part.
- **Out of scope, carried:** spec 4.3's "as read at" for a stat-pinned FOLDER file; Export of a version page read by range.
- **Changed existing cases:** `docs-source-parts.test.tsx`'s published-body pins gain `part: true`; one case of the new file
  flipped by the review.
- **Slips:** one implementer made a throwaway git worktree (removed) for red runs; empty heredocs to `/dev/null` three times;
  output piped through `tail` once; `env` before the runner inside the test wrapper.
- **Typecheck:** clean on the implementer's last run; my two runs at commit time were killed by the test slice's memory cap.
- **Caught later by the whole pwa suite** and fixed in Step 1's commit: the progress line's rule re-pointed `accent-color`,
  which only the root may set (`base-defaults.test.ts`).

## Step 1: Print from ccrc's window (`0df0c8521a`)

- **The tree.** The render job with `print: true` (forwarded by the runner only when set) runs the reader's own render
  (`renderOutcome`, one render path) and adds `printTree` = `printAllow(parseRendered(html))`. `printAllow.ts` (L1, no runtime
  import, iterative, total) keeps exactly the elements and classes the library's conformance goldens emit (37 elements, 21
  classes, each list held equal to them by a test), every id prefixed `docs-print-` with in-document `#` links rewritten to
  follow, `data-line`, `open` (a `details` always open), `colspan`/`rowspan`, `align`, `alt`, `title`; an `href` only as an
  in-document fragment, any other kept as text (`target`) that the view prints only when `docLinkTarget` answers an in-app
  target; an `img`'s `src` never, its ref (`imgRef`) mapped by the view to a URL the page already loaded, else its alt text;
  a task checkbox always disabled; no style, handler, `srcset`, `svg`/`math` element, comment or raw node.
- **The view.** `PrintView.tsx`: React elements of the allow-listed names with fixed props only, no raw HTML anywhere under
  `pwa/src/docs/print` (a source scan). The drafts banner first (from `exportProvenance`, through the same decision Export
  uses, with the range read's opened pin when the page was read by range), then each part (a part after the first starts a
  page), a part not prepared as its plain text under its reason's sentence.
- **Preparing.** `preparePrint.ts`: after the reader's `ready` (or a leaf's body), in the background, one part at a time, each
  under `DOCS_PARSE_BUDGET_MS` of its bytes and at most `PRINT_WAIT_MS` (10 s); a part not ready, refused or failed prints as
  its plain text; the next press asks again for parts that were not ready. Text and image leaves through `leafPrintTree`, no
  worker. Nothing is parsed on the main thread or in `beforeprint`.
- **Mounting.** `usePrint.ts` (L4) and `printPlan.ts` (L1, every decision): `beforeprint` mounts the view synchronously from
  what is prepared into one `div.docs-print-root` on `body` (marking `body` with `data-docs-printing`), `afterprint` unmounts
  it; a page with nothing prepared prints "Docs is preparing this page for print; print again in a moment."; a PDF and an HTML
  page print the line that says to print their file. The Print row's press mounts and prints inside the click handler when
  everything is prepared, else from a timer task after the wait (React refuses `flushSync` inside an effect, which the review
  measured).
- **The row.** Print lives in Page details only: the compact row's panel and the one bar's panel, a worded row, "Print" or
  "Download to print" (a PDF or an HTML page, starting the page's own download; with no download reachable, disabled with its
  reason), "Preparing part k of n…" while it waits. **Decision:** not on the desk row, where a fifth action moved the row's
  word staging at 1280 px and broke a name-width sweep (five browser cases); the desk prints with Ctrl+P or the browser's menu,
  through `beforeprint`. The control census has its TOKEN entry (by its holder's leave).
- **The whole-print ceiling (D-9163, the coordinator's ruling).** `printPlan.ts#PRINT_WHOLE_MAX_ELEMENTS` = 120 000 prepared
  elements, counted before the view mounts: at or below it every part prints (PL3); above it the part on screen, with "This
  document is too long to print whole: Print prints the part on screen. To print the rest, open each part and print it." at
  the top of the view and below the row. Part-by-part printing and lifting the ceiling are P5.5's.
- **`@media print`** (`docs.css`): everything in `body` but the print root `display: none` (by `:has` and by the body mark), the
  light palette and `color-scheme: light` forced on `html`, `body` and the root (tokens only), 11 pt text, `figure`, `tr` and
  `pre` kept from breaking, each part on a new page.
- **One link-context builder:** `docsLinkBase.ts#linkBaseFor`, used by `DocsLeaf` and `usePrint` (a characterization case
  first, green on the old inline formula).

### Measured (desktop Chromium, headless, Blink 153, the fleet box under the test slice)

| Document | Parts | Print view elements | Tap to print | `page.pdf` | Heap before / mounted / after | Browser resident peak |
|---|---|---|---|---|---|---|
| 1 gate (524 288 bytes) | 1 | 56 312 | 0.5 to 4.3 s | 1.2 to 1.4 s | 11 to 17 / 79 / 30 MiB | 2.4 GiB |
| 2 gates less 8 KiB | 2 | 109 198 | 2.0 to 5.5 s | 3.0 to 6.2 s | 12 / 139 / 43 MiB | 2.7 to 3.0 GiB |
| 2 gates | 3 | 110 038 | 2.3 s | 3.0 to 3.9 s | 12 / 138 / 43 MiB | 2.7 to 3.0 GiB |
| Just under the ceiling | 2 | 115 303 | 2.3 s | 4.3 s | 12 / 150 / 45 MiB | 3.8 GiB |
| 3 parts, uncapped (before the ceiling) | 3 | 162 482 | 6.3 s | 5.5 s | 12 / 196 / 56 MiB | 3.6 GiB |
| 4 parts, uncapped | 4 | 215 788 | 6.9 s | 7.8 s | 17 / 258 / 69 MiB | 4.1 GiB |
| 3.4 MiB (3 565 158 bytes), uncapped | 7 | 367 866 | 6.2 to 7.1 s | 12.3 s, or killed | 22 / 425 / 109 MiB | 5.5 to 6.0 GiB; killed by the slice's 6 GiB cap in most runs |
| 3.4 MiB, capped | 1 printed | 56 307 | 5.2 to 6.5 s | 1.7 to 2.5 s | 21 / 158 to 165 / 107 MiB | 2.35 to 2.4 GiB |

The uncapped 3.4 MiB print (3 201 PDF pages, 7.27 MB) was the plan's stop-and-ask; the coordinator ruled the ceiling. Not
measured: Firefox, Safari and the phones (acceptance's and F's device rows), lab PRINT-L2 (Ctrl+P with the frame focused).
`page.pdf()` fires `beforeprint` and `afterprint` once each on the page in Chromium, which the browser cases rely on.

### Reviews and rounds

- **Opus review** (it read every file in full; it stated effort 15, low). Important: the row printed the console page
  (`flushSync` refused inside an effect), fixed by printing from the click handler or a timer task and pinned by a spy on what
  the root holds when `window.print` is called; no test held which URL a printed image loads, fixed by moving `imagesFor` into
  L1 with five unit cases (a foreign ref prints its alt text, never loaded). Minor, fixed: a stale view on Ctrl+P after a
  missing `afterprint`; the hiding rule's reliance on `:has` (a body mark too); the per-part clock under queue contention (a
  retry on the next press); the range-read banner untested where wired; the wait restarting when the source republished;
  decisions moved from `usePrint` to `printPlan.ts`; the view root's class renamed `docs-print-view` (the row keeps
  `docs-print`); `printAllow.ts`'s header; non-UTF-8 Markdown shown as plain now prints that text; the download note drawn
  outside the bar's flex box; the light palette on `html` and `body`; a scan that nothing under `print/` imports the parser.
  Kept and recorded: `printWords.ts#printPlainWhy` copies the plain view's sentences with "printed" for "shown"
  (`DocMarkdown.tsx` is an L4 module); one owner is a follow-up.
- **Caught by the whole pwa suite:** "Download failed: {sentence}" spelled in two files (`literal-census.test.ts`), now the
  page's own `DOCS_VIEW_TEXT.downloadFailed`; the browser file serving the build in another form (`browser-dist.test.ts`).
- **The printer glyph** was vendored once by the generator's documented route and taken out again when Print left the desk
  row; `ui/` is unchanged against `main`.
- **Slips:** implementers wrote the print view and the allow-list before their tests (their reds measured by mutation); one
  empty heredoc; one `python3 -c "print(1)"`; one mistyped Edit path; a test run started in the background, then re-run.

### Mutation rows measured (each made with the Edit tool and restored, sha256 equal; the red case as the runner printed it)

| Row | Red |
|---|---|
| M11.24 (parse in `beforeprint`) | `print: tree parsed only after ready, never on the main thread`; `print: Ctrl+P before the tree is ready prints the one-line page` |
| M11.25 (the frame visible under print) | browser: `print: under print media the frame and console chrome are not rendered` (its control overrides the hiding rule and finds the console's words and each token twice) |
| M11.26 (no unmount on `afterprint`) | `print: beforeprint mounts from the prepared tree, afterprint unmounts` |
| M11.46 (`style` through) | `print tree: the allow-list drops style, handlers and foreign URLs` (and the table-alignment case) |
| M11.59 (an id unprefixed) | `print tree: every id is prefixed and in-doc links follow` (and the details/sup/sub/kbd case) |
| M11.60 (no drafts banner) | `print: a draft prints the drafts banner from exportProvenance, a committed doc none`; the stat-pinned case |
| M11.61 (a text leaf as parsed HTML) | `print: a text leaf holding markup prints it as text in one pre` |
| M11.62 (`print` for a PDF) | `print: a PDF or an HTML page offers Download to print` |
| M11.76 (only the part on screen) | `print: a doc in parts prints every part, each parsed under its budget`; the 10 s case; the 524 287 / 288 / 289 case; the 2 MiB and 3.4 MiB fixtures case |
| D-9163 ceiling at 119 999 | `print: a document at the whole-print ceiling prints every part` (and the over-ceiling and measure cases) |
| D-9163 over-ceiling branch removed | `print: a document over the whole-print ceiling prints the part on screen and says so`; its screen case |

**Fix rounds 1 and 2 (reviews 4116 and 4126).** Each row planted alone with the Edit tool on the code as it stands, its one test file
run alone and seen red, then restored with the file's sha256 equal. The cases are `describe > it` as the runner printed them (a long
describe is elided in the middle with …). F2-M1 needs the old code: measured in round 1, not re-run. One row turned nothing red
when measured (F3-C4, second line): a guard with no case, which now has one, red under that row.

| Row | Red |
|---|---|
| A2 (`prepKeyOf` without its `prepStarted` test) | `print: what the worker prepares (…) > asks the worker exactly when the source is the worker's and prepStarted says it can start`<br>`print: from the Docs screen > print: tree parsed only after ready, never on the main thread` |
| F1-a (`rangeExportState`'s comparison replaced by `() => true`) | `export of a document read by range: exportStateFor > export: a body that is not the text the read gave, and is no part, waits as the whole-read path waits (review F1)`<br>`the truth line: as read at <time> (spec 4.3 "The pin") > range facts: the visit holds the bytes the read gave, and the head compares a body with their decoding, the lossy one for bytes that are not UTF-8`<br>`the truth line: as read at <time> (spec 4.3 "The pin") > range facts: a read of a file that is neither Markdown nor text is never decoded, by the visit or the head (review: 64 MiB of an image)`<br>`a document read by range, on the Docs screen, with the reader on … > export: a fallen-back part of a text read by range up to 2 MiB is not the whole text, so Export waits, never exporting the part as the file` |
| F1-b (`bodyExportState`'s `part` forced false) | `export of a document read by range: exportStateFor > export: a document read by range exports the part on screen, and says so`<br>`export of a document read by range: exportStateFor > export: a body that is not the text the read gave, and is no part, waits as the whole-read path waits (review F1)`<br>`a document read by range, on the Docs screen > export: a document read by range exports the part on screen, and says so (on the screen: a 2 MiB text and ten bytes)`<br>`a document read by range, on the Docs screen > export: the plain view of a Markdown text above 2 MiB shows its parts, and Export exports the part on screen`<br>`a document read by range, on the Docs screen, with the reader on … > export: a fallen-back part of a text read by range above 2 MiB exports as the part on screen, and the sheet says so` |
| F1-c (`RangeLeaf` hands the visit `new Uint8Array(0)` for a text class) | `RangeLeaf: what a finished read tells the visit > range facts: the read gives the visit its bytes, so the head has the text of the read`<br>`RangeLeaf: what a finished read tells the visit > range facts: unmounting the leaf drops the read's facts, so the visit holds no bytes past the page (review: the bytes were kept)`<br>`RangeLeaf: … > the bytes reach the visit only for a class with a text view (review 4126 F1) > range facts: a Markdown text above its cap still hands the visit its bytes, the head compares a body with their text`<br>`RangeLeaf: … > the bytes reach the visit only for a class with a text view (review 4126 F1) > range facts: a text file above its cap still hands the visit its bytes, the head compares a body with their text`<br>`a document read by range, on the Docs screen > export: a stat-pinned draft read by range exports with the drafts banner and its snapshot digest (on the screen)`<br>`a document read by range, on the Docs screen > export: the plain view of a 600 KiB Markdown text keeps the gate, and Export of its Format-anyway tree exports the whole text`<br>`a document read by range, on the Docs screen > range facts: the banner's time is the range read's, not the export's`<br>`a document read by range, on the Docs screen > range facts: a page read again says nothing of the old read while it reads, and a Cancel or a failure leaves none`<br>`a document read by range, on the Docs screen > export: a Markdown text above 2 MiB that is not UTF-8 exports its whole plain text, and the sheet does not say it is a part` (`docs-leaf-range.test.tsx` holds no case on the bytes the leaf hands the visit) |
| F1-d (`decodeRangeBytes` without its memo) | `decodeRangeBytes: the one decoder of a range read's bytes (L1) > range text: the same bytes array gives the same answer, so the leaf and the head hold one string; another array decodes anew`<br>`the truth line: as read at <time> (spec 4.3 "The pin") > range facts: a read of a file that is neither Markdown nor text is never decoded, by the visit or the head (review: 64 MiB of an image)` |
| F1-e (`decodeRangeBytes`'s decode not fatal) | `decodeRangeBytes: the one decoder of a range read's bytes (L1) > range text: bytes that are not UTF-8 give the lossy text and utf8 false, never a throw`<br>`a document read by range, on the Docs screen > export: a text above 2 MiB that is not UTF-8 offers no Export, where it showed a Formatting… that never ends`<br>`a document read by range, on the Docs screen > export: a Markdown text above 2 MiB that is not UTF-8 exports its whole plain text, and the sheet does not say it is a part` |
| F1-f (`MarkdownParts` without the parts' mark above 2 MiB) | `a document read by range, on the Docs screen, with the reader on … > export: a fallen-back part of a text read by range above 2 MiB exports as the part on screen, and the sheet says so` |
| F1-g (`RangeLeaf`'s unmount drop a no-op) | `RangeLeaf: what a finished read tells the visit > range facts: unmounting the leaf drops the read's facts, so the visit holds no bytes past the page (review: the bytes were kept)` |
| F1-h (the head's decode above `rangeExportState`'s class check; also review 4126 A1) | `the truth line: as read at <time> (spec 4.3 "The pin") > range facts: a read of a file that is neither Markdown nor text is never decoded, by the visit or the head (review: 64 MiB of an image)` |
| F2-M1 (the fence walk back to recursion; measured in round 1, not re-run) | `the fence walk of one list item, and a cutter that throws (review F2) > md parts at blocks: one list item holding 30 000 fences (about 570 KB) is cut at the part size, with no stack overflow and no fallback`<br>`the fence walk of one list item, and a cutter that throws (review F2) > md parts at blocks: the same item at 4 096 bytes is about 29 800 fence steps, each one part, and the walk is a loop (the stack does not grow with them)` |
| F2-M2 (the walk's remaining bytes passed as unknown) | the two F2-M1 cases |
| F2-M3 (the item's fences searched from index 0 at each step) | `the fence walk of one list item, and a cutter that throws (review F2) > md parts at blocks: the same item at 4 096 bytes is about 29 800 fence steps, each one part, and the walk is a loop (the stack does not grow with them)` |
| F2-M4 (a throw of a feed no longer falls back) | `the fence walk of one list item, and a cutter that throws (review F2) > cutMarkdownText: a cutter that throws in a feed gives the line cutter's whole cut and the fallback signal, after the parts it had streamed` |
| F2-M5 (a throw of `finish` rethrown) | `the fence walk of one list item, and a cutter that throws (review F2) > cutMarkdownText: a cutter that throws in finish gives the line cutter's whole cut and the fallback signal` |
| F2-M6 (no abort check in the `finish` catch) | `the fence walk of one list item, and a cutter that throws (review F2) > cutMarkdownText: a throw while the signal is aborted is an abort, not a fallback, and rejects with the signal's reason` |
| F2-M7 (`onFallback` without `setIndex(0)`) | `MarkdownParts: a failed cut never leaves the page on "Preparing the parts" > md parts page: a fallback replaces the parts streamed so far with the line cutter's whole cut and goes back to part 1` |
| F2-M8 (the rejection handler without its abort check) | `MarkdownParts: a failed cut never leaves the page on "Preparing the parts" > md parts page: an abort changes nothing, even when its rejection arrives after the next text's cut is whole` |
| F2-M9 (`onFallback` sets `complete: false`) | `MarkdownParts: a failed cut never leaves the page on "Preparing the parts" > md parts page: the fallback is a whole cut: the bar says "of 3" as soon as it is told, before the cut's own answer` |
| F2-M10 (the rejection handler's P1 catch re-throws) | `MarkdownParts: a failed cut never leaves the page on "Preparing the parts" > md parts page: a cut that rejects when the line cutter throws too leaves the state as it is and no rejection unhandled` |
| F2-M11, feed path (an abort rejects with an error of its own) | `windows, comments and the cut as a function (review of Step 0b2) > cutMarkdownText: an abort rejects with the signal's reason`<br>`the fence walk of one list item, and a cutter that throws (review F2) > cutMarkdownText: a throw while the signal is aborted is an abort, not a fallback, and rejects with the signal's reason` |
| F2-M11, finish path (the same, around `finish`) | `the fence walk of one list item, and a cutter that throws (review F2) > cutMarkdownText: a throw while the signal is aborted is an abort, not a fallback, and rejects with the signal's reason` |
| F3-C1 (the gap scan returns no comments) | 14 of the file's 20 cases (corrected 2026-11-28, review 4131 A3 and review 4192 F4: the file had 20 cases as merged): `a closed comment … (review F3) > md parts comments: the reported input at 200 bytes (a fence, then a 50-line comment, then a heading) shows no commented text`<br>`a closed comment … > md parts comments: a heading then a 60-line comment, at a size the comment exceeds`<br>`a closed comment … > md parts comments: a comment that fits is one cut candidate beside its block, never cut inside`<br>`a closed comment … > md parts comments: a comment larger than a part is closed at the end of a part and reopened at the start of the next`<br>`a closed comment … > md parts comments: every part fits at every size from 24 to 130 bytes (the closer on its own line, and after text)`<br>`a closed comment … > md parts comments: a comment, then a heading: the heading starts a part, not continued`<br>`a closed comment … > md parts comments: CRLF line ends give the same shape`<br>`a closed comment … > md parts comments: a line longer than a part is cut at a code point boundary, never between a surrogate pair, and the closer is whole`<br>`a closed comment … > md parts comments: a comment at the start of the text, one after another, and one at the end`<br>`a closed comment … > a comment followed by lines of dashes … > md parts comments: two rules after the comment (…) keep both, at 120 bytes`<br>`a closed comment … > a comment followed by lines of dashes … > md parts comments: a comment followed by short text that fits makes no extra tiny part`<br>`a closed comment … > a comment followed by lines of dashes … > md parts comments: text after the rule that the library draws no block for (a reference definition) stays in the comment's last part when it fits`<br>`a closed comment … > a comment followed by lines of dashes … > md parts comments: when the open part has no room for the rule, the closer takes a part of its own and the rules go after it`<br>`a closed comment … > a comment followed by lines of dashes … > md parts comments: a run of rules that does not fit after the comment: the last part takes what it can, no tail starts at dashes` |
| F3-C2 (no candidate after a comment's closer line) | `a closed comment … (review F3) > md parts comments: a comment larger than a part is closed at the end of a part and reopened at the start of the next` |
| F3-C3 (the mid-line close without its leading newline) | `a closed comment … (review F3) > md parts comments: a line longer than a part is cut at a code point boundary, never between a surrogate pair, and the closer is whole` |
| F3-C4 (the final part's room check removed: the branch `if (used + finalBytes > budget)`) | `a closed comment … (review F3) > md parts comments: every part fits at every size from 24 to 130 bytes (the closer on its own line, and after text)` |
| F3-C4, second line (`if (COMMENT_OPEN.length + finalBytes > max) return null;` removed) | none red when measured (the size case's closer lines are at most 14 bytes); then a case of its own, red under this row (`part 14 is at most 24 bytes: expected 69`): `a closed comment … (review F3) > md parts comments: a closer line too long to fit a part beside the reopen line leaves the comment to P1, every part still in size (class 10)` |
| F3-C7 (no check of the text after the first `-->` on the closer line) | `a closed comment … (review F3) > md parts comments: a closer followed by text on its line is no comment (the library reads a paragraph there), and an opener indented four columns is no comment` |
| F3-C8 (the opener's indent rule widened to four spaces) | the F3-C7 case |
| F3-C9 (`cutComment`'s fit path off) | `a closed comment … > a comment followed by lines of dashes … > md parts comments: two rules after the comment (…) keep both, at 120 bytes`<br>`a closed comment … > a comment followed by lines of dashes … > md parts comments: a comment followed by short text that fits makes no extra tiny part`<br>`a closed comment … > a comment followed by lines of dashes … > md parts comments: text after the rule that the library draws no block for (a reference definition) stays in the comment's last part when it fits` |
| F3-C10 (`cutComment`'s dash absorption off) | `a closed comment … > a comment followed by lines of dashes … > md parts comments: when the open part has no room for the rule, the closer takes a part of its own and the rules go after it`<br>`a closed comment … > a comment followed by lines of dashes … > md parts comments: a run of rules that does not fit after the comment: the last part takes what it can, no tail starts at dashes` |
| F3-C11 (`cutComment`'s closer-in-its-own-part branch off) | `a closed comment … > a comment followed by lines of dashes … > md parts comments: when the open part has no room for the rule, the closer takes a part of its own and the rules go after it` |
| R2-M1 (`RangeLeaf` always hands `bytes: r.bytes`) | the four `RangeLeaf: … > the bytes reach the visit only for a class with a text view (review 4126 F1) > range facts: …, read with no view and saved, hands the visit no bytes, and its other facts still stand` cases, for an HTML page above its cap, an SVG above its cap, a PDF above the inline ceiling and a file of a class with no view (other) |
| R2-M2 (`rangeHasTextView` true for `html`) | `export of a document read by range: exportStateFor > export: a range read that gave no bytes offers no Export, a body not yet published is formatting, the reader is the plain view`<br>`RangeLeaf: … > the bytes reach the visit only for a class with a text view (review 4126 F1) > range facts: an HTML page above its cap, read with no view and saved, hands the visit no bytes, and its other facts still stand`<br>`RangeLeaf: … > the bytes reach the visit only for a class with a text view (review 4126 F1) > rangeHasTextView: Markdown and text have a text view above their cap, no other class does`<br>`the truth line: as read at <time> (spec 4.3 "The pin") > range facts: a read of a file that is neither Markdown nor text is never decoded, by the visit or the head (review: 64 MiB of an image)` |
| R2-M4 (the old inline prepare gate put back in `usePrint.ts`) | `print: what the worker prepares (…) > print: usePrint takes its prepare key from prepKeyOf and restates no gate of its own (review 4126 A6)` |

## The gate before the push

- **pwa jsdom suite**, whole, in four shards through the test slice: 169, 169, 168 and 168 files. Red at first and fixed: the
  two guards above and `base-defaults`. Killed by the memory cap and green alone: `mockup-policy`, `docs-export` (241 cases),
  and the vitest typecheck of the browser file (an unused constant, removed). The pwa typecheck clean (with a 3.5 GB heap; the
  default was killed by the cap twice).
- **Browser files that reach the Docs leaf, head or export**, one a run: `docs-print` 11 (and its 9 measurement cases under
  `CCRC_MEASURE=1`), `docs-export` 18, `docs-headers` 13, `docs-mockup` 23, `docs-mockup-export` 20, `docs-own-tab` 12,
  `docs-review` 12 (its first run died in the build under a cap kill), `docs-compact-head` 157 (156 and one skipped; run by
  the browser-leg implementer on the same tree),
  `pdf-frame` 11, `pdf-labs` 12, `mockup-parse` 71, `phone-bar` 58, `reader-frame` 61 (one red in the full file, "refined: the
  worst case renders inside the watchdog", a fallback under load; both worst-case cases green alone), `reader-history` 12,
  `reader-mode` 24 (one expected fail, carried from wave XR), `reader-mode-head` 2, `reader-mode-lab` 4, `reader-places` 10,
  `reader-appearance` 28, `reader-lab` 1 (its gate line: render median 208 ms, worst 283 ms; render and mount median
  1 917 ms, worst 2 616 ms; within, on a busier box).
- **Server whole-tree guards:** `single-definition` 1 631 (50 files); `rings`, `anchors`, `citations`, `deviation-refs`, `dtbd`
  and `growth-check` green (one ring file killed by the cap, green alone).
- **The ui package** is unchanged against `main`.
- **Again on the merged tip** (after the one absorb of `main`, `288fc6471b`, the parity plan alone conflicting): the pwa
  typecheck clean; the pwa jsdom suite in four shards, 170, 170 (with `markdown-worker-built` killed in its build by the cap,
  then 12 green alone), 170 and 169 files (`mockup-policy` killed by the cap, then 153 green alone), shards 3 and 4 with two
  workers after a whole-shard kill; browser `docs-print` 11, `mockup-loader` 6, `docs-mockup` 23, `docs-mockup-export` 20
  (twice killed in its build by the cap first); server `single-definition` and `rings` 1 766 (62 files), and `deviation-refs`,
  `citations`, `anchors` and `dtbd` 49. The private-name scans of the diff, the messages and the pull request text: clean.
