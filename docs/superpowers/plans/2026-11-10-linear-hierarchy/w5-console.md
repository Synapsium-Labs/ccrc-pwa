# Linear hierarchy, wave 5: the console (D-8184) — task note

This note is the wave's record for the programme ledger. The coordinator folds it into the plan's ledger on its own pull
request. This pull request edits the plan in one place only, under the coordinator's ruling: it defines the wave's one
departure, D-8737, in the plan's `## Deviations found`. That edit carries a `Ledger-Edit:` trailer on the head commit. It
changes no other line and no checkbox.

## In short

- **What was built.** Tasks 5.1, 5.3 and 5.4 of `docs/superpowers/plans/2026-11-10-linear-hierarchy.md`. Task 5.2 (the
  programme page's Plan section) is not built: the desktop-polish Work card replaces it (the ledger's ruling of
  2026-11-16), and `ProgrammeScreen.tsx` is untouched.
  - **5.1, the project row's hierarchy settings** (`pwa/src/screens/settings/ProjectLinkingCard.tsx`, words in
    `pwa/src/fleet/hierarchyWords.ts`): per project, the Linear owner select (its empty option names the default and
    whether it is live), File into initiatives, Owning project (only when another project shares the team key), the
    hierarchy state line (the map item linked when it waits), the count of inbound issues waiting, and a link to the
    project's Upkeep page. One card-level act names one coordinator the Linear owner of every project, behind a
    `QuickConfirm`. The add-project sheet gains the owner select and the initiatives toggle.
  - **5.3, the epic and Upkeep pages** (`EpicScreen.tsx`, `UpkeepScreen.tsx`, one `EpicBody.tsx`, words in
    `epicWords.ts`; routes `epic` and `upkeep` with `epicPath` and `upkeepPath`): the epic's checkpoints in order with
    state, met date and evidence (a pull request, an item, or a repository path in the Docs reader), its tickets with
    their runs, and *Open in Linear*. The Upkeep page is the same body over the project's Upkeep epic, with no
    checkpoints, and lists the inbound closes Linear refused.
  - **5.4, the five hierarchy items' controls** (`LinearItemControls.tsx`, dispatched from `ItemActs.tsx`'s
    `ItemControls`): map *Approve* (confirm) and *Return* (a note); report *Put back* (confirm) and *Done*; drift *Hand to
    a coordinator* (the existing door word) and *Keep the plan*; initiatives *Check again*; owner *Name* (a live
    coordinator, confirm). Each sends the body Task 5.4 lists to `POST /api/items/:id/linear`, and a refusal shows its
    fixed sentence. The map and report bodies (`MigrationBody.tsx`, words in `migrationWords.ts`): counts first, then one
    group per class (D-8737).

## Departure (defined in the plan)

- **D-8737, map-shapes-early** (the coordinator's ruling on this run). No read on the wire carries a migration map's or
  report's contents before wave 7. This wave adds Task 7.1's `MAP_CLASSES`, `MapEntry` and `MapCounts` to `shared/plan.ts`,
  verbatim from Task 7.1's text, appended at the file's end, and builds the map and report bodies as one component over
  them. **The bodies are not yet wired.** `ItemView` renders the body only when it is handed one (its `migration` prop),
  and nothing hands it one yet, so a map or report item shows its why and how text with its controls. **Wave 7 must add:**
  the read that hands `ItemView` a map's or report's counts and entries, and the `approve`, `return`, `put-back` and
  `done` arms of `POST /api/items/:id/linear`, which answer `unavailable` today (the controls show that word's fixed
  sentence). Wave 7 imports the three shapes and defines them nowhere else. Two more things wave 7 owns here: spec §11.3
  has the map item show each programme's epics and checkpoints (`MapBody.epics` and `backlog`), which the three shapes
  do not carry, so the body grows a section for them once `MapBody` lands; and the sticky act bar dropped the
  `--safe-bottom` inset where no phone bar is mounted, which only matters once a body is handed.

## Wire differences from the plan's Interfaces

| Where | Plan | Built |
|---|---|---|
| 5.3 | `api.ts` gains `upkeep(project)`; `plan(slug)` was Task 5.2's | `plan(slug)` is added here too, since Task 5.2 is not built and the epic page reads `GET /api/programmes/:slug/plan` |
| 5.3 | route rows with two captures | `RouteMatch` carries one `param`; it gains `rest`, the later decoded captures (empty for a one-capture row). The epic row's `accepts` keeps the slug owner's grammar, and an unknown key answers "No such epic in this programme" (the coordinator accepted this design) |
| 5.3 | at 1920 "each ticket's run state inline" | `TicketView` carries only the run's id, so the run's state word (`runStateWord`) comes from the fleet store's live runs and shows from 1920px up beside the run link; a run not among the live runs (closed, or not heard yet) shows no state. No new read |
| 5.3 | evidence `{path}` opens in the Docs reader | `PlanView` carries no home project, so the Docs link uses the epic's `project` |
| 5.3 | evidence `{pr}` links the pull request | `pullUrl` with the project's measured repository slug from the project list; with no slug known, "PR #n" as plain text |
| 5.3 | the Upkeep page lists its tickets | it also lists `notClosed` (the inbound closes Linear refused), each word with a fixed sentence: `not-found`, `linear-forbidden`, `linear-invalid`, `malformed`, `policy-denied`, the words the server records when it gives a close up; any other word is framed |
| 5.1 | the Upkeep link on the row when inbound issues wait | the link shows whenever the project has a team key |
| 5.1 | the owner select's empty option names the default owner and whether it is live | the hierarchy read's `ownerNow` gains `project`, the project the owner was decided for (`linearOwnerOfProject` already decided it; the route dropped it), optional on the wire so an older server's answer reads as the project's own owner (the coordinator's ruling in fix round 1). The option says `Default: <id> (live)`, `(not live)` or `Default: none live` for every source; for a project whose shared team key another project owns, it names that project's owner and its liveness, and a note under the select (which wraps, so a phone shows it whole) says which project the owner comes from and that the project's own owner setting is not used meanwhile |
| 5.1 | `hierarchyWords.ts` under `screens/settings/` | it lives in `pwa/src/fleet/`, beside `linkingWords.ts`, because the add-project sheet in `fleet/` reads it and `fleet/` never imports `screens/` |
| 5.1 | at 1920 "one grid line per row" | from 480px to under 760px of card width a row is four lines, and three lines from 760px up: the card is capped at 960px and its layout follows the card's width (a container query), so 1920 is the same container as 1280. The hierarchy cell takes its own line, and inside it the Linear owner select takes a full line of its own, with the toggles and the state on the line under it, so the select shows its whole value with a long coordinator id (review round 1); the browser file measures a select's shown value against its box |
| 5.4 | every act's control on the item | on a Waiting list row, only the light acts draw (drift: Hand and Keep; initiatives: Check again); map, report and owner draw their controls on the item page only, because Approve and Put back need the body on screen and Name needs the coordinator list |
| 5.4 | initiatives *Check again* sends `{act:'check-again'}` | an answer of `{ok:true, queued:false}` (no Linear key serves the workspace, or the server has no plan sync) is a plain status line saying no check was queued and the item stays open; it is neither "Sent." nor a refusal, and the item is not treated as acted on (review round 1) |
| 5.4 | the act bar sticky at the item's foot | `bottom: var(--phone-bar-h)`, so it clears the phone bar |

## Test and build changes beyond the plan's files

- `pwa/vite.react-singleton.ts` holds the React-singleton lists (dedupe, aliases, inline), read by both
  `pwa/vite.config.ts` and `pwa/vitest.browser.config.ts`, pinned by `pwa/test/react-singleton-pin.test.ts`. The 200-issue
  browser case renders the real `ItemView` to static markup on the node side, and that needs one React. Changing the
  browser config is a CI infrastructure trigger, so this pull request runs the full suite.
- The 200-issue case is a static render of the real `ItemView` with a constructed map, served on the shared build's own
  CSS (no second build, no test route): the act bar stays in view at 360 and 390 scrolled to the middle, beside a stand-in
  phone bar in the shell's own classes. The real shell's views measure the act bar against the real phone bar on a map
  item's page.

## Screenshots

One picture per view of the three browser files, 195 in all, taken with `CCRC_SHOTS=<dir>` at the pull request's tip and
attached to the wave-done mail (they are not committed): the project linking card, the epic page and the Upkeep page in
all twenty views (360, 390, 1280, 1470 and 1920, Refined and Instrument, both themes); the five hierarchy items' pages in
all twenty views; the 200-issue map body in all twenty views and the report body at the five widths; the map item's page
in the real shell at 360 and 390 in both skins and themes; and the Waiting list rows at 360 and 1280. Every picture uses
fixture names only. To make them again:

    ( cd pwa && CCRC_SHOTS=<dir> CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run \
        --config vitest.browser.config.ts browser/project-linking-card.browser.test.ts browser/epic-page.browser.test.ts \
        browser/linear-items.browser.test.ts )

## Follow-ups noted, not built

- **Nothing in the console links to the epic page yet.** No surface on this base names an epic: Task 5.2's Plan section
  was its way in, and the desktop-polish Work card that replaces it does not link epics. The first caller is the Work
  card's epic row, through `epicPath(slug, key)`, in the work-map programme; until then the page is reached by its URL.
  For the coordinators to rule who adds the link.
- **The Upkeep answer's shape is typed on the PWA side only.** `GET /api/projects/:project/upkeep` is not typed against
  a shared shape; a later wave can move it into `shared/plan.ts`, where the server types its reply against it. The same
  goes for the refused-close words, which the PWA lists from the server's give-up words by hand.
- **One minor point from the last re-review, left as it is.** The Upkeep page's test of a refused close with no time
  counts the rows but does not assert that row draws no date (the typecheck catches the null case). (The other point,
  two rows saving at once on the linking card, was fixed in review round 1: a row stays locked until a read at least as
  new as its own write, or the owner-for-all write, has landed; a failed re-read keeps it locked and offers Read again.)
