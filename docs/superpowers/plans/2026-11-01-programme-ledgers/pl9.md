# PL9: moving between items, and a recommended option on every decide item

Task note for plan Task PL9 (spec §2 "Moving between items", §3.2 "The recommendation", D23, D24). It records what the
ledger should learn from this task. The coordinator folds it into the plan's ledger on its own pull request; this note
edits no ledger.

## Step 0: what was measured before any change

| Question | Measured on `main` |
|---|---|
| The item view's way back | At 360 and 390 px, in both skins, the item page drew the `BackButton` as a bare centred `‹` with no label (360×44). At 900, 1280 and 1920 px it was hidden: `.shell-detail .back-btn { display: none }` sits inside `shell.css`'s `@media (min-width: 900px)` block, so it applies on a desk, not on a phone. On a desk, the column beside the item was the fleet column, not the waiting list. So on a desk there was no way back to the list except the navigation tab. Measured in Chrome over the production build, at those five widths in both skins. |
| Which list an item is opened from | The combined list (`WaitingScreen`), its side rail's filter to one programme (local state, not in the URL), the programme view (`ProgrammeScreen`'s waiting card), and the programme view's Goals links to an item. |
| How the list orders items | One function: `groupByProgramme` (`ledgerWords.ts`), built on `orderItems` (`shared/ledgers.ts`). The combined list, its filter and the programme view all draw its groups. |
| How the fleet keeps its list beside a session | `shellViewOf(path)` gives `fleet` or `session`, which drives the phone swap (`data-view`). From 900 px the frame's grid is two tracks: `clamp(300px, 25vw, 380px)` in `shell.css`. Refined overrides it with `clamp(320px, 24vw, 400px)` (400 from 1600), and Instrument with 52/340 (52/420 from 1600). Both skins' text pins hold those literals. The left track, `.shell-nav`, is the fleet column in both skins. |
| The item wire, the raise route, the store, the migration | `ItemView` is in `shared/ledgers.ts`, built by one builder (`viewOfItem` → `itemViewOf`, `ledgersRoutes.ts`). `parseRaise` is in `ledgersRoutes.ts`. The item SQL is in `ledgersStore.ts` (store.ts keeps one-line delegates). The columns come from migration 37 (`MIGRATIONS[36]`), so the next step is entry 38. `ccrc-api items raise` passes its JSON body through, so it needs no client row. |

## Rulings and agreements

- **Migration 38 in `schema.ts`:** the coordinator ruled yes (mail 14399, ruling 14402). The reads and writes are in
  `ledgersStore.ts`; `store.ts` is not touched.
- **`schema.ts` and `coord-db.test.ts` are shared with landing-order 5f** (its worker holds claims on both). My proposal
  (mails 14409 and 14410): PL9 appends one MIGRATIONS entry and changes only the count literals in `coord-db.test.ts`;
  whichever PR lands second moves its own entry after the other's when it absorbs main, and updates the literals then;
  neither edits the other's lines. Their reply (14411), verbatim:

  > Agreed, covering server/src/coord/schema.ts and server/test/coord-db.test.ts. Landing-order 5f (run 1312) appends its
  > own MIGRATIONS entry (landing journal tables plus one landing_entries column) and touches no other line of schema.ts.
  > Each of us edits only our own entry and the count literals; whichever PR lands second moves its own entry after the
  > other on its absorb of main (a merge keeping both entries untouched) and sets the count literals then. One note: on
  > main coord-db.test.ts has THREE count literals at 37 (two at ~693-694 and one at ~761, the second
  > COORD_SCHEMA_VERSION pin), so the second lander updates all three. My new migration test also finds its entry by DDL,
  > not by slot number, apart from the slot banner in my own comment, which I renumber myself if I land second.

  PL9 changed the three literals 37 → 38 and nothing else in that file.
- **The list beside the item on a wide screen:** I asked (structured ask) whether to split the pane or swap the frame's
  left column. The ask first came back "split the pane", but the coordinator's mail ruled to swap the left column, on spec
  §2's "as the fleet list stays beside an open session" and the brief's "no parallel layout". It set four conditions: only
  on the waiting routes, only at the widths with two columns, the fleet one tap away, and the breadcrumb, the rail highlight
  and the phone unchanged apart from the way back. A second ask confirmed the swap. The split I had built was removed.
- **Fix round 1 (review 1399, mail 14512).** The coordinator ruled on every finding. F1, F2, F4 to F9 and the advisories A1
  to A3 and A6 to A9 are fixed below. F3 is accepted as the meaning of ruling 14425, so the swap stays on the item route
  alone (see `pl9-swap-on-the-item-route-only`). A4 and A5 are recorded and are not this task.

## Departures, by slug

- `pl9-list-in-shell-column`: on a desk (the widths where the frame shows two columns), the frame's left column holds the
  list the item was opened from, in place of the fleet, beside the open item. `ShellFrame` gains one optional render prop
  for its existing nav slot (`nav: (fleet) => node`), and `app.tsx` passes `ItemListColumn` on the item route alone. A
  phone always draws the fleet there. The column follows the live order. Since fix round 1 (F6) it is drawn for every item
  page once the list has been heard: it stays when the open item leaves the list mid-visit, and an item the list does not
  hold (recently cleared, gone) has the list beside it with nothing marked. Before the first `waiting` frame the column is
  the fleet.
- `pl9-banners-above-the-swapped-column` (fix round 1, F1): Instrument has no `Banners` part, so it draws the fleet's banner
  stack inside its fleet column, and the item route's column replaced that column and dropped the banners. The chosen owner:
  `ItemListColumn` mounts the same `FleetBanners` stack above the list when the frame's skin set has `Banners === null`
  (read through `useFrameSet`). Refined's frame keeps drawing the stack under its bar and the column draws none, so one stack
  is mounted at any width, and no second stack exists. Instrument was given no desk `Banners` part: that would move the stack
  on every route and change Instrument's grid.
- `pl9-swap-on-the-item-route-only`: the list route itself keeps the fleet in the left column and its full list (summary,
  side rail, Recently cleared) in the detail pane. Moving the list there too would draw it twice or squeeze it into the
  column. The coordinator ruled in fix round 1 (F3) that this meets ruling 14425: its intent was that the list stays beside
  an open item, and the item route alone does that, while on `/waiting` the list already fills the detail pane. The browser
  file pins that bare `/waiting` keeps the fleet in the left column at 900 and 1280 in both skins.
- `pl9-fleet-column-remounts` (corrected in fix round 1): on a desk, entering the item route unmounts the fleet column
  (`FleetColumn` and its `FleetScreen`), and leaving it mounts them again. What is not kept across an item visit is the fleet
  column's scroll position and its local state (an open fold, a typed filter). The D-161 note about leaving the sidebar
  alone holds for every other route, and `app.tsx`'s comment now says so. The fleet's polls and sheets sit above the frame
  (D-5468), so nothing they own is lost. The banner stack the column carried in Instrument is kept: the item route's column
  mounts it (`pl9-banners-above-the-swapped-column`). The first version of this note said "nothing they own is lost", which
  was false for Instrument's banners. The item route does not draw the build readout (`BuildLine`, in both skins),
  the pool-lag readout (in both skins: Refined's desk column draws it in the fleet's head too), Refined's count line (its
  frame has no status bar to print it) or the fleet column's hidden stale-update live region (review 1402, A-2), and because the
  banner stack is mounted again on entering and on leaving the route, it loses its state there too: the "+n more" fold, the
  halt banner's and the host banner's confirm states, and the passkey notice, which reads `/api/auth/status` again (A-4).
- `pl9-steps-items-only`: Previous and Next step from item to item. A session's question is a row of the list but opens its
  session, so the steps skip it, and the position counts items only.
- `pl9-combined-list-writes-no-from`: the combined list, unfiltered, is the default and writes no `?from=`, so `/waiting/<id>`
  links (Goals' links included) keep their shape. The other lists write `from=waiting:<slug>` (the side rail's filter) or
  `from=programme:<slug>`. An unknown, malformed or stale `from` falls back to the combined list.
- `pl9-filter-in-url`: the side rail's filter rides the list's own URL (`/waiting?programme=<slug>`), so the way back from an
  item opened under it lands on the filtered list. Since fix round 1 (F5) the URL is the filter's one home: `WaitingScreen`
  keeps no copy and draws the filter its `programme` prop names, so a door tap to `/waiting`, a reload and Back all show what
  the URL says. For that reason the "Not in a programme" filter rides the URL too, as an empty value (`?programme=`,
  `NO_PROGRAMME_FILTER`), because no slug is empty. A pick replaces the history entry rather than pushing one, as before.
- `pl9-goals-links-carry-from`: an item link in the programme view's Goals carries `from=programme:<slug>`, so its way back
  returns to the programme view. `programme-box.browser.test.ts` pins the new href.
- `pl9-steps-push-history`: Previous and Next push a history entry. The labelled way back goes to the list in one tap. A
  test now steps and then calls `history.back()`, which returns to the item it came from, with its own place.
- `pl9-walk-keeps-its-place` (fix round 1, F2 and F6, the coordinator's ruling): while the operator stays on one item, its
  steps and its "N of M" are the place it had when it was opened or last stepped to. An act on the open item (a tick, an
  answer, or a change the coordinator pushes) moves it in the live order but does not move the steps, so "tick, then Next"
  reaches the item that was next. When the open item leaves the list (confirmed or withdrawn), the steps and the position
  stay, and the strip says in words, "This item is not on the list now." The remembered place is a value taken from
  `itemPlace`, the one list function, never a second order. It is kept in React state keyed by the visit (the item's id
  and its `from` word, in `ItemRoute`'s `useKeptPlace`), not in `history.state`. A step, a link to another item, Back and a
  reload are each a new visit, which takes its place from the live order again, and leaving the route drops it.
  `history.state` was not used because a reload would restore a walk from before it, and the router's `navigate` writes
  `null` there. The left column follows the live order, as the ruling allows.
- `pl9-strip-keeps-focus` (fix round 1, F4): `ItemRouteAt` is no longer keyed by the id, so the strip above the item stays
  mounted across a step; only the item's own panel (`ItemView`) is keyed, so a typed answer still never follows the
  operator. After Previous or Next, focus is put back on the same control, or on the other one when the end of the list
  has disabled it (a browser drops the focus of a control that turns disabled). The position is a polite live region
  (`role="status"`), so a screen reader hears where the step landed.
- `pl9-one-stale-list-rule` (fix round 1, F7 and A8): `resolveList` (`ledgerWords.ts`) is the one rule that a list naming a
  programme no group holds is the combined list. The side rail's filter, `listGroups`, `itemPlace`, the column and the item
  route all settle their list through it, so the three fallbacks the review found are one. The item route settles the
  `from` value once for every branch, so `/waiting/<gone>?from=programme:zzz` goes back to the combined list. The strip's
  words moved into `ledgerWords.ts`, and the way back takes the list's title from the route table (`ROUTES`).
- `pl9-recommendation-reader-l0`: the one reader of the two fields is `recommendationOf` in `shared/ledgers.ts`. It answers
  `null` for a field a server from before PL9 omits, for any kind but `decide`, and for an index outside the options or
  reasons that are not text. So an older item draws as before, and a corrupt row marks nothing rather than the wrong option.
- `pl9-raise-input-optional` (corrected in fix round 1, A3): `RaiseItemInput`'s two fields are optional in the type and stored
  NULL when absent. Since fix round 1 the store also refuses a decide row without a recommendation the one reader
  (`recommendationOf`) can read, with a `RangeError`, beside its kind and needed-by checks. So no caller can store a decide
  item the view would show without one. The route still refuses it first, in words. The only production caller is the raise
  route, secret items included. The first version of this note named "the secret items" as another caller, which was wrong.
  Three operator-route tests that raised a decide item straight through the store now give one.
- `pl9-null-is-absent-on-other-kinds`: on a non-decide kind, `null` for either field is the same as leaving it out and is
  accepted. Any other value is refused.
- `pl9-mark-in-option-span`: `RadioFieldset` cannot set an attribute on one option's label, so the "Recommended" mark and
  `data-recommended` sit in a span inside the label. The choices' fieldset names the reasons as its description. Since fix
  round 1 (F8) a literal space parts the option's words from the mark, so the option's accessible name is "Keep the order
  Recommended", and a test pins that whole name, as `OptionRow` parts its label from its tag.
- `pl9-mark-is-not-recommended-tag` (fix round 1, A2): the session's ask sheet has a "Recommended" tag already,
  `recommendedTag()` in `session/AskParts.tsx`. It is not reused, for two reasons. First, it is the Session Conversation
  context's ask surface: importing it would make the Waiting on you screens depend on that module and its `chat.css`, and
  nothing in `ledgers/` imports from `session/` today. Second, its paint is the sheet eyebrow's (`.dlg-header-chip`: accent
  ink on the accent tint, with the eyebrow's left margin), grounded on the dialog. The item's mark sits inside a radio row's
  label, on the item card's ground, with its own pinned contrast pair. The word is a constant in the ledgers' words file
  (`RECOMMENDED_WORD`, `ledgerWords.ts`); the session side writes it inline in `recommendedTag()`, so the two share no
  constant (review 1402, A-7; the first version of this sentence said each context had one).
- `pl9-cite-plan-not-number`: when the code was written, the branch's tree predated the ledger PR (#2213), and
  `deviation-refs`' floor case reads the branch's own tree, so citing D-7896 in code was red. Code comments cite "plan PL9"
  instead. The branch has since absorbed `main`, which holds the plan that defines D-7896, so that reason no longer holds
  (review 1399, A1). The comments keep "plan PL9", which names the same task and is harmless. A later change may cite the
  number.

## Follow-up (run 1407, the carries of review 1402)

One pull request of the small fixes carried from PL9's second review (mail 14536, which ruled F3 and A-5). It follows PL9 under
D-7896; no number is allocated for it.

### Step 0: measured before any change, on the branch at `dc6ae572b`

- F1, a critical disk banner in Instrument, Chrome, at 900 and at 1280: on `/waiting` the banner sits 16 px from the left
  column's left edge, 17 px from its right edge and 12 px below its top; on `/waiting/1` it sits 0, 1 and 0. Refined: the
  banner's box is the same on both routes.
- F2, the reviewer's probe as a test (items 10, 11, 12, 13; open 11; the coordinator confirms 12; Next to `/waiting/12`;
  `history.back()` to `/waiting/11`): "2 of 3" is not drawn; the strip keeps the stale place.
- F3 (a), `/waiting/9?from=programme:prog-a`, prog-a holding only a cleared item: the way back goes to `/waiting`, not to
  `/programmes/prog-a`.
- F3 (b), prog-a's only item opened from its view, then confirmed: the column beside it holds one row, prog-b's item, and
  the strip reads "Back to prog-a, 1 of 1".

### Departures, by slug

- `pl9-banners-keep-the-fleet-gutters` (F1): the stack above the list beside an item sits in a box (`.wl-banners`) with the
  fleet column's own top space, side gutters and gap, written with the same tokens as `.fleet` in `fleet.css`. With no banner
  it takes no room: the stack keeps every slot mounted, so the box is never empty, and its room is given only while a banner
  draws, by Refined's own test (`:has(> .banner-slot > *, > .banner-more)`; carry C, review 1408 F1). Measured after: within 1 px of `/waiting` at 900 and 1280; Refined unchanged.
- `pl9-new-visit-resets-the-place` (F2): `useKeptPlace` takes a new place on every new visit, a visit with no place
  included, so a cleared item stepped to and left again does not leave its predecessor's place behind.
- `pl9-real-programme-stays` (F3, as ruled): `resolveList` takes the programmes the page knows (`knownProgrammes`: the runs,
  the Goals and the cleared trail) and keeps a programme's VIEW whose slug is real with no group, so the way back goes to
  that programme's page. A filter to such a programme is still stale, because the side rail offers no filter to a programme
  with nothing on the list, and a slug nothing knows is still the combined list (F7's case is unchanged). `resolveList`
  stays the one resolver.
- `pl9-column-draws-the-strips-list` (F3, as ruled): the column beside the item draws the list the strip names. The column is
  drawn in the frame's nav slot, outside the item route's tree, so the route publishes that list, keyed by the visit, to a
  small module cell in `WaitingRoutes.tsx` that the column reads; the kept place itself stays in the route's state, and the
  cell is cleared when the route unmounts. A programme's view with nothing on the list says "Nothing needs you." in the
  column, as the view does.
- `pl9-position-names-the-item` (A-3): the polite live region says "N of M, <the open item's title>", is drawn always and is
  empty with no place. The shown "N of M" is hidden from assistive technology, which hears the region instead.
- `pl9-focus-tests-bear-load` (A-6): the focus test no longer focuses Next before the click, so its first assertion is the
  restore's alone, and a new case covers Previous handing the focus to Next at the start of the list.
- `pl9-remembered-step-lands` (A-5, as ruled): Next and Previous land on the remembered item even when it has left the list,
  with no skip to the live neighbour; a test pins it, and no code changed.
- `pl9-one-measure` (A-8): the list's, the item's and the strip's 72rem is one custom property, `--wl-measure`.

### Recorded, not changed

- A-1: `WaitingRoutes.tsx` keeps importing `FleetBanners` from `screens/FleetScreen`; no import moves.
- A-8: `onDismiss` navigates to the list after its awaits, so stepping on before they resolve pulls the operator back to the
  list. It predates PL9 and is left as it is.
- A-2's and A-4's losses are named under `pl9-fleet-column-remounts` above; nothing changed to draw them on the item route.

## Not changed

- No README or CLAUDE.md sentence quotes clause 20, so only `SKILL.md` and its pin changed.
- `ccrc-api` needs no row: `items raise` sends its JSON body as given, and `ccrc-api-closed.test.ts` stays green.
