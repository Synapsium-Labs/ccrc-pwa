# Run 4013 (`w8-browser-entry-sheets`): the browser file applies only the shell's own sheets

Linear hierarchy wave 8, follow-up. This is a fix to a test helper. No product code changed, and this note defines no
deviation. The plan, the spec and the programme ledger are unchanged.

## The defect

`pwa/browser/linear-items.browser.test.ts` draws the map and report body as a page of the shared build. Its helper,
`stylesheets(root)`, gave that page every `.css` file under the build's `assets/`: first the sheets that `index.html`
links, then every other sheet in the folder.

The build now has a second entry page, `pwa/review.html` (the Docs reader's review page). That page links a sheet of its
own (`review-*.css`), and only that page loads it. Its rules are written for the review page's whole document. Applied
to the shell, they restyle it. A peer branch measured 10 rows of this file going red that way, and it had to scope its
own sheet to stay green. So the file passed on `main`, but only because of how one sheet happened to be written. The
next entry page could break it again.

## The fix

The helper now works out which sheets the shell itself loads, by reading the build's own files. `reached(tree, page)`
starts from a page and follows what it names:

- the sheets and the entry script that the page names as `/assets/…`;
- the chunks that a script imports, which it names as `./…`;
- the files of a dynamic import, sheets included, which Vite's preload list names as `assets/…`, and a worker's URL,
  named as `/assets/…`.

The build writes these names in double quotes, and some of them as template literals in backticks: a dynamic import of
a chunk, and a worker's URL. The walk reads both. A name that is not a file under `assets/` is not followed.
`shellSheets` keeps the helper's old order (the index's links first, then the rest of the folder in order), but keeps
only the sheets that the walk from `index.html` reaches. If a script or a sheet under `assets/` is reached from no page
at all, the helper throws instead of carrying on. The throw names `reached()`, the files, the pages walked and the forms
the walk reads.

**Why not the peer's starting diff.** The peer's diff dropped every sheet that another page links and the index does not.
That would also drop a sheet that another page links and that a lazily loaded shell chunk imports. The brief named the
exact answer: read which sheets the shell's own chunks import. The build writes no Vite manifest (`vite.config.ts` and
`browser/dist.ts` set none). Turning one on would change the shared build, which is outside this ticket. So the walk
reads the chunks' text, which records the same imports. It costs about 30 ms for the whole build. One of the cases
below holds exactly the case the peer's diff would get wrong.

## Measured

Red first, on `main` at `fabd9d399d`. A new case, `leave out a sheet that only another entry page links, in the real
build`, was run against the old helper with the browser config's shared build:

```
AssertionError: pages review.html: expected [ '/assets/review-C94rVsan.css' ] to deeply equal []
      Tests  1 failed | 160 skipped (161)
```

The build of this tree, measured by hand and again by the review. It holds 57 scripts and 13 sheets under `assets/`,
and two pages, `index.html` and `review.html`. `index.html` links five sheets. The walk from `index.html` reaches 56
scripts and 12 sheets: the five it links and seven more that the shell's chunks load later. The walk from `review.html`
reaches 3 scripts and one sheet, `review-*.css`, the one sheet the shell never reaches. With the backtick form read (fix
round 1), no script or sheet is left unreached by every page. Before it, 11 of the 57 scripts were. Those 11 were the
two font scripts, bootstrap, enhance, guard, the two markdown workers, the Mermaid frame, reader, the reader's render
job and the service worker's window script, and none of them names a sheet.

Green, after fix round 1. The seven cases in `the shell's sheets from the shared build`:

- **Real build, foreign sheet.** The review page is built and links a sheet of its own (asserted, so the case cannot
  pass vacuously). No sheet that only another page links is in the shell's list. `foreign` is read from the pages'
  links, in either attribute order, not from the walk under test.
- **Real build, the exact list.** The list is the index's links, then every other sheet under `assets/` in the folder's
  order, less the sheets another page links and the index does not. It asserts that there is at least one such later
  sheet.
- **In-memory tree, `./` and backticks.** A chunk is reached only through `"./dep.js"`, another only through
  `` import(`./tpl.js`) ``, a worker only through `` `/assets/worker.js` `` and a sheet only through `` `assets/d.css` ``.
- **In-memory tree, two entry pages.** The lazily loaded shell sheet is kept. The sheet that another page links and a
  lazily loaded shell chunk imports is also kept (the peer diff's limit). The other page's own sheet is dropped.
- **In-memory tree, one entry page.** The answer is the old helper's: the index's links first, then every other sheet
  in the folder's order.
- **In-memory tree, a sheet no page loads.** The helper throws.
- **In-memory tree, a script no page reaches** (named as `"./"+"hidden.js"`). The helper throws.

Mutations, each run on these seven cases and then put back:

| Mutant | Red cases |
|---|---|
| The old helper behind `stylesheets` | 2: both real-build cases (`expected [ …(13) ] to deeply equal [ …(12) ]` on the exact list) |
| The backtick dropped from both quote classes | 3: both real-build cases, which throw on the 11 scripts, and the `./`-and-backticks case |
| The `./` arm dropped | 4: both real-build cases, the `./`-and-backticks case and the two-entry case |

The whole file, at 360, 390, 1280, 1470 and 1920, in both skins and both themes, with its stand-ins unchanged:
`Tests  167 passed (167)` (91 s, `ccrc test --` with the browser config, `--maxWorkers=2`, the fleet's Chrome). The pwa
typecheck is clean. `test/browser-leg.test.ts` and `test/review-built.test.ts` pass (34 of 34). No pwa test reads this
helper: it is local to the file, and `browser/slowFirst.ts` only lists the file's measured time.

Running the file: Chrome's singleton socket lives under `TMPDIR`. With a long `TMPDIR` path, Chrome aborts at launch
(`Socket path too long`) and every row fails in `beforeAll`. A short `TMPDIR` avoids it.

## Fix round 1 (review run 4017)

- F1: the walk reads backticks, and the throw covers every script and sheet under `assets/`, not sheets only.
- F2: the `./` arm is pinned by its own fixture, and the second real-build case has an exact expectation that goes red
  on the old helper.
- F3: the throw names `reached()`, says each file is under `assets/` but no page's walk reaches it, and lists the forms
  the walk reads.
- F4: case 1 asserts that the review page links a sheet of its own, and its link reader takes both attribute orders.
- F5: the comment in `pwa/test/review-built.test.ts` no longer gives this file as a reader that applies every sheet to
  the shell.
- F6: the figures above are the build's: 57 scripts and 13 sheets, with what each walk reaches given separately.

## The limit

The walk reads references in the forms the build writes today: `/assets/…` in a page, `./…` between chunks, and
`assets/…` or `/assets/…` in preload lists and worker URLs, each in double quotes, single quotes, backticks or
parentheses. Every script and sheet under `assets/` must be reached from some page, or the helper throws. So a form the
walk cannot read goes red instead of quietly dropping a file. That holds as long as no other page reaches the file.

What the throw cannot catch is a file that another page reaches, where the walk misses only the shell's reference to
it. Today that could only be one of the 3 scripts the review page reaches, or its one sheet. If the shell named one of
those in a form the walk cannot read, that file, and any sheet only it loads, would be left out of the shell's list
without an error.

The walk can also over-include. It reads text, so a string in a shell chunk that names a file counts as loading it.
That can only add a file that the shell's own code names.

