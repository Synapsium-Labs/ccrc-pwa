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
- the files of a dynamic import, sheets included, which Vite's preload list names as `assets/…`.

A name that is not a file under `assets/` is not followed. `shellSheets` keeps the helper's old order (the index's
links first, then the rest of the folder in order), but keeps only the sheets that the walk from `index.html` reaches.
If a sheet under `assets/` is reached from no page at all, the helper throws instead of dropping that sheet quietly.

**Why not the peer's starting diff.** The peer's diff dropped every sheet that another page links and the index does not.
That would also drop a sheet that another page links and that a lazily loaded shell chunk imports. The brief named the
exact answer: read which sheets the shell's own chunks import. The build writes no Vite manifest (`vite.config.ts` and
`browser/dist.ts` set none). Turning one on would change the shared build, which is outside this ticket. So the walk
reads the chunks' text, which records the same imports. It costs about 30 ms for the whole build (45 scripts and 13
sheets on the build measured here). One of the cases below holds exactly the case the peer's diff would get wrong.

## Measured

Red first, on `main` at `fabd9d399d`. A new case, `leave out a sheet that only another entry page links, in the real
build`, was run against the old helper with the browser config's shared build:

```
AssertionError: pages review.html: expected [ '/assets/review-C94rVsan.css' ] to deeply equal []
      Tests  1 failed | 160 skipped (161)
```

A build of the same tree, inspected by hand. `index.html` links five sheets. The walk from it reaches 12 sheets: those
five and seven more that the shell's chunks load later. `review.html` links one sheet, and the walk from it reaches
only that one. The 13th sheet under `assets/` is `review-*.css`, and the shell never reaches it.

Green, after the fix. The five cases in `the shell's sheets from the shared build`:

- **Real build, foreign sheet.** No sheet that only another page links is in the shell's list.
- **Real build, the shell's sheets.** The list starts with the index's links, in their order, and goes on to the sheets
  the shell's chunks load later.
- **In-memory tree, two entry pages.** The lazily loaded shell sheet is kept. The sheet that another page links and a
  lazily loaded shell chunk imports is also kept (the peer diff's limit). The other page's own sheet is dropped.
- **In-memory tree, one entry page.** The answer is the old helper's: the index's links first, then every other sheet
  in the folder's order.
- **In-memory tree, a sheet no page loads.** The helper throws.

The whole file, at 360, 390, 1280, 1470 and 1920, in both skins and both themes, with its stand-ins unchanged:
`Tests  165 passed (165)` (77 s, `ccrc test --` with the browser config, `--maxWorkers=2`, the fleet's Chrome). The pwa
typecheck is clean. No pwa test reads this helper: it is local to the file, and `browser/slowFirst.ts` only lists the
file's measured time. `test/browser-leg.test.ts` passes (22 of 22).

## The limit

The walk depends on how Vite writes chunk references today: `./name.js` between chunks, and `assets/name.css` or
`assets/name.js` in the preload list. If Vite changes that form, the walk could miss a sheet that the shell loads
lazily. If no page reaches that sheet, the helper throws, so the file goes red rather than drawing an unstyled shell.
What the throw cannot catch is a sheet that both another page and the shell load, where the walk misses only the
shell's import. Then the sheet would be left out of the shell's list without any error.

The walk can also over-include. It reads text, so a string in a shell chunk that names a sheet file counts as loading
it. That can only add a sheet that the shell's own code names.
