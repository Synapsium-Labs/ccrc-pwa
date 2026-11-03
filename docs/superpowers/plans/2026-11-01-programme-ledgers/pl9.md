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

## Departures, by slug

- `pl9-list-in-shell-column`: on a desk (the widths where the frame shows two columns), the frame's left column holds the
  list the item was opened from, in place of the fleet, beside the open item. `ShellFrame` gains one optional render prop
  for its existing nav slot (`nav: (fleet) => node`), and `app.tsx` passes `ItemListColumn` on the item route alone. A
  phone always draws the fleet there. An item with no place in a list (not heard yet, recently cleared, or gone) leaves the
  fleet in the column.
- `pl9-swap-on-the-item-route-only`: the list route itself keeps the fleet in the left column and its full list (summary,
  side rail, Recently cleared) in the detail pane. Moving the list there too would draw it twice or squeeze it into the
  column. The ruling's "only on the waiting and item routes" is met by the item route alone.
- `pl9-fleet-column-remounts`: entering the item route unmounts the fleet column, and leaving it mounts it again, so its
  scroll position and local state are not kept across an item visit (the D-161 note about leaving the sidebar alone holds
  for every other route). The fleet's polls and sheets sit above the frame (D-5468), so nothing they own is lost.
- `pl9-steps-items-only`: Previous and Next step from item to item. A session's question is a row of the list but opens its
  session, so the steps skip it, and the position counts items only.
- `pl9-combined-list-writes-no-from`: the combined list, unfiltered, is the default and writes no `?from=`, so `/waiting/<id>`
  links (Goals' links included) keep their shape. The other lists write `from=waiting:<slug>` (the side rail's filter) or
  `from=programme:<slug>`. An unknown, malformed or stale `from` falls back to the combined list.
- `pl9-filter-in-url`: the side rail's filter to a programme rides the list's own URL (`/waiting?programme=<slug>`), so the
  way back from an item opened under it lands on the filtered list. The "Not in a programme" filter holds only questions
  and no item can be opened from it, so it stays local state.
- `pl9-goals-links-carry-from`: an item link in the programme view's Goals carries `from=programme:<slug>`, so its way back
  returns to the programme view. `programme-box.browser.test.ts` pins the new href.
- `pl9-steps-push-history`: Previous and Next push a history entry. The labelled way back goes to the list in one tap.
- `pl9-recommendation-reader-l0`: the one reader of the two fields is `recommendationOf` in `shared/ledgers.ts`. It answers
  `null` for a field a server from before PL9 omits, for any kind but `decide`, and for an index outside the options or
  reasons that are not text. So an older item draws as before, and a corrupt row marks nothing rather than the wrong option.
- `pl9-raise-input-optional`: `RaiseItemInput`'s two fields are optional and stored NULL when absent. The route is what
  requires them of a decide item; the store's other callers (tests and the secret items) need no change.
- `pl9-null-is-absent-on-other-kinds`: on a non-decide kind, `null` for either field is the same as leaving it out and is
  accepted. Any other value is refused.
- `pl9-mark-in-option-span`: `RadioFieldset` cannot set an attribute on one option's label, so the "Recommended" mark and
  `data-recommended` sit in a span inside the label. The choices' fieldset names the reasons as its description.
- `pl9-cite-plan-not-number`: the ledger PR (#2213) merged during this task, but `deviation-refs`' floor case reads the
  branch's own tree, whose plan predates the merge. Citing D-7896 in code red that case, so code comments cite "plan PL9".
  A later change on a tree that holds the merged plan may cite the number.

## Not changed

- No README or CLAUDE.md sentence quotes clause 20, so only `SKILL.md` and its pin changed.
- `ccrc-api` needs no row: `items raise` sends its JSON body as given, and `ccrc-api-closed.test.ts` stays green.
