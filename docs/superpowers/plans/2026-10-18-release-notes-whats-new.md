# Release notes at release time, and What's new in place: Implementation Plan

The operator asked on 2026-10-18 that the update banner's **See what's new** explain the release: "it currently does nothing". This plan is the record of the change that answers it, written beside the code from `main` at `976bc459`. Deviation numbers 5548 to 5551 were allocated for it.

**Goal:** every release says what changed, and **See what's new** opens that text in place, over the fleet screen.

## The measured problem

1. **Every release body is empty.** Each merge to `main` becomes a prerelease through `deploy/release-main.sh publish`, and a hand-cut tag through `release.yml`. Both run `gh release create … --verify-tag --prerelease` with no notes, so v0.0.288 to v0.0.291 (checked) have no body. Each release is about one squash-merged PR, so its first-parent commit subject is the PR title, for example `feat(ui,pwa): the command palette and shortcuts (D-5103, D-5456, D-5457) (#626)`.
2. **The server already carries a body.** `server/src/update/catalogue.ts` ingests each release's `body` through `capNotes` (`NOTES_CAP_BYTES` 4096, then `NOTES_MARKER`) into the `releases` table, and `GET /api/updates` serves it as `ReleaseWire.notes`. The catalogue's upsert rewrites `notes` on every poll, so a body edited later reaches the console on the next poll.
3. **The button goes somewhere you cannot see.** `pwa/src/fleet/UpdateBanner.tsx`'s "See what's new" called `navigate('/settings')`. Settings is a long page and its release list is far below the fold, so the tap seemed to do nothing.

## The change

**A. Notes at release time (D-5548, D-5551).** `deploy/release-notes.mjs` writes a release's body. It reads `git log --first-parent -z --format=%s prev..tag` through `execFileSync` with an argument list, where `prev` is the highest release-shaped tag below `tag`. It writes one line per change:

- The conventional prefix picks the group: `feat` is New, `fix` is Fixed, `perf` is Faster, and everything else (docs, test, refactor, chore, ci, and unprefixed subjects) is Behind the scenes.
- The prefix and its scope are dropped and the sentence is capitalised.
- Each `(D-…)` reference is stripped. In a mixed parenthetical, only the D-refs go, so `(#601, D-5523)` becomes `(#601)`.
- The trailing `(#NNN)` becomes a separate `#NNN` token at the end of the line.

The header line is `Changes since vPREV` (`First release` when there is no earlier tag), and an empty range says `No changes.`. The groups are written most important first, inside `NOTES_BUDGET_BYTES` (3800, below `NOTES_CAP_BYTES`). When the list overflows, the least important lines are dropped and counted in a last line, `…and N more changes`, so the catalogue never cuts a body.

`release-main.sh publish` writes the notes to `$OUT_DIR/release-notes.txt` before it pushes the tag, and passes `--notes-file`. `release.yml` writes them to `$RUNNER_TEMP`, outside the `release-out/*` publish glob, and passes `--notes-file` too. A writer that fails leaves an empty body with a warning and the release still ships. Commit text moves from git to the file and from the file to gh. It never goes through a shell, a `run:` line or a `${{ }}` expression, and nothing evaluates it.

**B. The sheet (D-5549, D-5550).**

- **Opening it.** "See what's new" opens `WhatsNewSheet`, built on the shared `Sheet`. At ≥900 it is a centred dialog: `.whats-new-panel` in `fleet.css` re-places the panel and sets no colour.
- **What it lists.** The title is "What's new since v<running>" and the eyebrow gives the count of releases. The list holds every release above the oldest version that a behind node runs, up to the banner's tag, newest first.
- **The notes.** Each release shows its notes through `ReleaseNotes`, grouped New, Fixed, Faster and Behind the scenes, with the last group folded behind a disclosure `Button`. Everything renders as React text children. A `#NNN` becomes a `TextLink` to `https://github.com/<owner>/<repo>/pull/NNN`, built by `pullUrl` from the number and the server's release source alone.
- **No notes.** A release with no body says "No notes for this release" under its tag and date.
- **The footer.** It holds Update all, which closes this sheet and opens the banner's own move sheet with the same plan, disabled with the same reason line while a node halts the fleet, and Close.
- **Settings.** The Settings → Updates release rows render their notes with the same `ReleaseNotes`. A body that is not in the format keeps its `<pre>`, so the Settings change is one component swap.

The release source reaches the PWA as `UpdatesView.source` (additive, so absence permits it). No TS root may spell the org (`single-definition.test.ts`), so a server with no usable source, or an older one, sends no field, and the PWA shows the number as text. The name check moved to L0 as `isReleaseSourceName` (`shared/release-notes.ts`). `server/src/config.ts` and `pullUrl` both use it. The format's reader is `shared/release-notes.ts` (`parseReleaseNotes`, `splitPrRefs`).

**C. Backfill.** `deploy/release-notes-backfill.mjs [--last N] [--dry-run] [--force]` regenerates the notes of the newest N releases (default 40) from their own tag ranges. `--dry-run` reads git only and prints each body. The real run is `gh release edit <tag> --notes-file <file>`, newest first. It leaves a release that already has a body alone unless `--force`, and reports each failure, exiting 1 if any edit failed. **The lander runs it after the PR merges, from a checkout with every tag fetched: `--dry-run` first, then for real.** This build stage never edits a release.

## The tests

- `server/test/release-notes.test.ts`: subject to line (groups, D-ref and PR handling, control characters, metacharacters kept as text, the length cap), rendering and the byte budget against `NOTES_CAP_BYTES` and `capNotes`, the generator and parser round-trip and shared group list, `previousReleaseTag`, real-git ranges with first-parent only, and the CLI's exits. Source pins: `execFileSync('git'` with no shell or eval, and node built-ins only.
- `server/test/release-notes-backfill.test.ts`: dry run never calls gh, the real run edits through a file newest first, a release with a body is left alone, `--force`, a failed edit, and usage refusals.
- `server/test/release-main.test.ts`: the publish argv ends `--notes-file <out>/release-notes.txt` and the body names the previous tag. A failing writer still publishes with an empty body. Source pins hold that the notes go through a file and the script runs no `git log`.
- `server/test/build-release.test.ts`: release.yml writes the notes after attest, before publish and outside the glob, with the empty-body fallback. **The injection guard** covers every `run:` body of release.yml, release-main.yml and release-stable.yml: no `${{`, no `github.event`, `head_commit` or `GITHUB_EVENT_PATH`, no `git log`, no `--notes `. A planted case proves the scanner sees both `run:` forms.
- `server/test/update-routes.test.ts`: `source` is present with a usable release source and absent without one.
- `pwa/test/whats-new-sheet.test.tsx`: the range rule, the sheet opened in place from the banner (title, count, order), the footer's Update all and Close, the halted state, groups and fold, the links' hrefs and `rel`, no source meaning no link, no notes, a hostile body staying text with no link taken from it, a bad source name, the Settings row's reuse, and the ≥900 rule with no colour. `pwa/test/update-banner.test.tsx`'s door case now asserts the sheet, not `/settings`.

## Deviations found

- **D-5548.** Release notes are written at release time by `deploy/release-notes.mjs` from the first-parent commits since the previous release tag, grouped and capped under `NOTES_CAP_BYTES`, and handed to `gh release create --notes-file`. The format is written down once, in `shared/release-notes.ts`, and the test holds the two halves equal. Why: every release body was empty, so the console had nothing to say about any release.
- **D-5549.** "See what's new" opens `WhatsNewSheet` in place instead of navigating to `/settings`, and `GET /api/updates` gains the additive `source` (`ReleaseSourceWire`), so a note's `#NNN` links from the number alone. Why: the Settings list sat below the fold, and no TS root may spell the org, so the repository can only reach the PWA from the server's runtime release source.
- **D-5550.** `@ccrc/ui` gains `TextLink`, an inline anchor primitive that inherits colour, carries no tap floor (WCAG 2.2 SC 2.5.8's in-text exemption), opens a new context with `noopener noreferrer`, and wears `FOCUS_RING`. The PWA's `#NNN` links are `TextLink`s, not hand-drawn anchors. Why: an `<a href>` in `pwa/src` is a hand-drawn control that `control-census.test.ts` must register. That census is frozen while #627 is open (the skins foundations plan's in-flight table), and `@ccrc/ui` had no link primitive. A primitive draws the link without editing the frozen census, and it is the route that census exists to push controls toward.
- **D-5551.** The notes step lives in `deploy/release-main.sh`'s publish arm as well as in `release.yml`. Why: the brief named `release.yml` as the release's writer, but every patch release, about one per merge, is cut by `release-main.yml` → `release-main.sh publish`. `release.yml` cuts only a hand-pushed minor tag, so a `release.yml`-only change would have left nearly every release still empty.
