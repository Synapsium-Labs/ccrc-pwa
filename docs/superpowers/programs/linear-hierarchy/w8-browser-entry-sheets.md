# Run 4013 (`w8-browser-entry-sheets`): the browser file applies only the shell's own sheets

Linear hierarchy wave 8, follow-up. This is a fix to a test helper. No product code changed, and this note defines no
deviation. The plan, the spec and the programme ledger are unchanged. The cases and mutations are listed in the PR body.

## The defect

`pwa/browser/linear-items.browser.test.ts` draws the map and report body as a page of the shared build. Its helper,
`stylesheets(root)`, gave that page every `.css` file under the build's `assets/`. The build now has a second entry
page, `pwa/review.html`, whose own sheet (`review-*.css`) is written for the review page's whole document. Applied to
the shell, it restyles it: a peer branch measured 10 rows of this file going red that way. `main` passed only because
of how that one sheet happened to be written.

## The fix, and why there is no manifest

`reached(tree, page)` walks from a page through what the build names:

- the page's `/assets/…` links and entry script;
- each chunk's `./…` imports;
- Vite's `assets/…` preload lists and worker URLs.

It reads them in double quotes, single quotes, backticks or parentheses. `shellSheets` keeps the old order (the index's
links first, then the rest of the folder) but keeps only the sheets the walk from `index.html` reaches. A script or a
sheet under `assets/` that no page reaches makes it throw.

The peer's starting diff dropped every sheet another page links. That would also drop one that a lazily loaded shell
chunk imports. The exact answer is what the shell's chunks import. The build writes no Vite manifest (`vite.config.ts`
and `browser/dist.ts` set none), and turning one on would change the shared build, which is outside this ticket. So the
walk reads the chunks' text, which records the same imports, in about 30 ms.

## Measured

Red first, on `main` at `fabd9d399d`, the old helper:
`expected [ '/assets/review-C94rVsan.css' ] to deeply equal []`. The build holds 57 scripts and 13 sheets.

- From `index.html` the walk reaches 56 scripts and 12 sheets.
- From `review.html` it reaches 3 scripts and the review sheet.
- No page leaves a file unreached.

After the fix, the whole file passes at 360, 390, 1280, 1470 and 1920, in both skins and both themes, with its
stand-ins unchanged: 167 of 167.

Running the file: Chrome's singleton socket lives under `TMPDIR`. With a long `TMPDIR` path, Chrome aborts at launch
(`Socket path too long`), and every row fails in `beforeAll`. A short `TMPDIR` avoids it.

## The limit

The walk reads the reference forms the build writes today. A form it cannot read makes the helper throw, unless another
page reaches the file. In that one case, a shell reference the walk misses would leave the file out silently, along
with any sheet only that file loads. Today that could only be one of the review page's 3 scripts or its sheet. The walk
can also over-include, because it reads text: a shell chunk's string naming a file counts as loading it.
