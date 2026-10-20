# Fleet rollup: quiet projects fold to their header, a coordinator's workers fold to one line (D-6088)

The operator asked (2026-10-20) for every inactive repository to roll up, and for the workspaces that report to a
coordinator to roll up too, unless one of them has a question for the operator that its coordinator did not
intercept and did not answer. "Roll up" is read as COLLAPSE in the fleet list, never archive. One task.

## What exists today (measured on origin/main before this plan)

- **Project grouping.** `fleetTree` (`pwa/src/fleet/fleetTree.ts`, D-5527) returns one `FleetTreeGroup` per card:
  `groupFleet`'s group (live `sessions`, `released`, `archived`, the `attention`/`busy`/`stranded` counts) plus
  the `rows` `nestFleet` draws. `FleetScreen` maps it to `ProjectCard`s.
- **The ▾ collapse.** `ProjectCardHead`'s toggle calls `onToggle(project)`. The state is `foldState.ts`'s
  `useFolded`: a per-browser set (`localStorage` key `ccrc.fleet-folded.v1`) of COLLAPSED project names, absent
  meaning expanded, held by `FleetScreen` so it survives navigation. The same set stores the `Released (n)` and
  `Archived (n)` sub-folds under `<project>::released` / `<project>::archived`, inverted (present means open).
  A folded header already keeps the session count, the pin, `n stranded`, the attention ● and `n working`.
- **Children under a coordinator.** `nestFleet` lifts a child (the worker of an active run whose `claimedBy` is on
  the same card) out of the top level and re-inserts it at depth 1 under its coordinator, attention first, then
  programme order; a pending spawn is a depth-1 `pending` row. One level only. Every child renders as its own row.
- **What says "this question reached the operator and is unanswered".** The server's `bucket` (shared/api.ts's
  `sessionBucket`, THE authority every count and word reads):
  - `dialogPending || hookState === 'waiting'` is an open question or permission prompt in a live pane;
  - while the coordinator holds it, `fleet.ts` sets `withCoordinator` (the newest `asks` row is `held` or
    `answering` and the clock is before `notifyAt`), and the ladder answers `working`, not `attention`;
  - when the coordinator answers, the dialog closes, so neither field is set and the row leaves `attention`;
  - when `notifyAt` passes unanswered (the late case the operator reports), or the coordinator hands it over, or
    there was no coordinator, `withCoordinator` is null and the ladder answers `attention`;
  - a dead pane is `dead` before any of this is read, so a corpse never counts;
  - a cached snapshot revives `withCoordinator` as null, which reads `attention`: the safe direction.
  `session.ask` (`{state, parentId, answeredBy}`) is NOT the predicate: it is the chip that explains a hold or a
  recent ruling, it folds `released`/`declined`/`stale` to null, and a held `ask` can sit on a row the ladder has
  already moved to `attention` (past `notifyAt`). The `asks` store and `GET /api/asks` are server-side reads the
  ladder already consumed. So the predicate is `s.bucket === 'attention'` (`operatorAsk` in `rollup.ts`).

## Deviations and decisions

### Issued for this work and defined here

- **D-6088** — `fleet-rollup`: one pure L1 decider, `pwa/src/fleet/rollup.ts`, decides from the fleet tree, the
  clock, the open session and the per-device preferences what the fleet list rolls up; both skins' fleet lists
  read it (today both place `FleetColumn` → `FleetScreen` → `ProjectCard`). The rules:
  1. OPERATOR-FACING is `s.bucket === 'attention'` (`operatorAsk`): a live pane's question or permission prompt
     that no coordinator holds (the field map above). A coordinator-held or coordinator-answered ask is not.
  2. A project is ACTIVE when any live member (`sessions` and `released`, never `archived`) is `working`, is
     operator-facing, carries a fault (`substrateFault` or a strand marker), or changed state in the last 30
     minutes (the later of `bucketSince` and `statusUpdatedAt`), or when a spawn is pending on the card;
     otherwise INACTIVE. An inactive project is rolled up by default, an active one open.
  3. The header of a rolled-up project keeps its counts and adds `active <age>` (`formatAge`), the latest change
     of a live member, when one is known.
  4. The operator's own ▾ on a project is stored per device with the activity class it was made in, and applies
     only while that class holds; the first frame in the other class drops it and the default applies again, and
     a fresh frame that no longer carries the project drops it too. A toggle back to the default removes the
     entry. A card holding the open session is open by default (a deep link or a jump lands on a visible row);
     the operator may still roll it up, which departs from that default and is stored.
  5. A project with an operator-facing session is never rolled up, whatever is stored. Its ▾ does nothing and says
     why: `aria-disabled`, still in the tab order, with the reason as screen-reader text (never `disabled` and a
     `title`, which keyboard and touch cannot reach).
  6. A coordinator's children (its depth-1 rows) fold into one summary line under it — `n workers · 1 needs you ·
     2 working · 5 idle`, `needs you` straight after the total so a narrow column never pushes it to a second
     line, each `n word` drawn unbreakable so a wrap falls only between counts, and `needs you` in the attention
     ink the row's own `needs you` wears; the row's own state words (`STATE_WORD`, `asleep` for a hibernated row, `spawning`
     for a pending spawn) with `needs you` for an operator-facing child, zero counts left out. The line is the
     fold's toggle (per device, by coordinator id).
  7. While folded, an operator-facing child stays visible as its own row under the line, and so does the open
     session (the row being read never vanishes into a fold, the Released fold's rule).
  8. Phone, laptop and wide follow the same rules: the decider takes no width.
  9. The clock the 30-minute window is read against is read fresh on every render (`useRollupClock`), and one timer
     is set for the next instant a project leaves the window (`nextRollupBoundary`); a quiet fleet sets none. An
     interval that stops while quiet keeps its last tick and would hold a gone-quiet project open.
  The sub-folds (`Released`, `Archived`) keep `useFolded`; the project fold moves to the rollup preferences
  (`ccrc.fleet-rollup.v1`), and the project names `useFolded` stored before are no longer read.
- **D-6089** — `fleet-rollup-one-child`: a coordinator with ONE child keeps that child's row and draws no summary
  line. Folding one row into one line saves no height and replaces the workspace's name with a count, which is the
  glance the card exists for; the fold starts at two children (`CHILD_FOLD_MIN`).

- **D-6090** — `fleet-rollup-hold-view`: an automatic roll-up or roll-out (a project going quiet or waking, a
  worker's question appearing) must not move the card the operator is reading. Chromium's scroll anchoring already
  holds it; WebKit (iOS Safari) has none, and measured at 390 px the card in view moved 468 px there. So
  `useHoldView` (`pwa/src/fleet/useHoldView.ts`), keyed on the rollup's shape, records the first visible card's
  top from the layout still on screen and, once the new layout is in, scrolls its scroller by how far that card
  moved. A departure from the brief, which asked nothing about scroll position: main never folded on its own, so
  this jump arrives with the rollup and is the rollup's to prevent.

Issued and unused: none.

## Task 1 — the rollup decider and both lists reading it (D-6088, D-6089)

### Files

- Create `pwa/src/fleet/rollup.ts` (the decider), `pwa/test/rollup.test.ts` (skin-independent),
  `pwa/test/fleet-rollup-render.test.tsx` (rendered, once per skin through `SKIN_SETS[skin].Nav`, and through
  `ProjectCard`).
- Create `pwa/src/fleet/useRollupClock.ts` (rule 9), `pwa/src/fleet/useHoldView.ts` (D-6090) and
  `pwa/test/useHoldView.test.tsx`.
- Modify `pwa/src/fleet/foldState.ts` (`useRollupPrefs`, its load/save), `pwa/src/fleet/ProjectCard.tsx` (the
  summary row, `rollup` prop), `pwa/src/fleet/ProjectCardHead.tsx` (`active <age>`, the disabled ▾),
  `pwa/src/screens/FleetScreen.tsx` (one `rollupFleet` call, the prune effect), `pwa/src/fleet/fleet.css`
  (`.proj-children-toggle` joins the disclosure rule; `.proj-card-last`), `pwa/src/fleet/sessionFacts.ts`
  (`rowStateWord`, the row's state word spelled once, read by the row's facts and the worker line, so the rollup
  never imports `STATE_WORD`), `pwa/design/audit.mjs` (the disclosure rule's key gains `.proj-children-toggle`;
  `.proj-card-last` grounded on the card), `pwa/test/role-census.test.ts` (`.proj-card-last` reads `--fs-meta`).
- Adapt the cases whose subject is not the rollup but whose fixture is now rolled up: `fleet-screen.test.tsx`
  (an all-archived or emptied project opens with its own ▾ first; the cross-project nesting cases open the worker
  line through the stored preference), `app.test.tsx` and `tap-targets.test.tsx` (the fixture row changed just
  now), and `foldState.test.ts` gains the preferences' failure modes.
- Line-disjoint from open #960 (`FleetScreen.tsx` lines 9-20, 194-298 and the end of `fleet.css`) and #956
  (`fleet.css` near 3232).

### Steps

1. Red tests first (below), proved red on origin/main (the module does not exist; the rendered cases render every
   project open and every child as a row).
2. `rollup.ts`: `operatorAsk`, `projectActivity`, `rollupCard`, `rollupFleet`, `toggleProject`,
   `toggleChildren`, `prunePrefs`, `nextRollupBoundary`.
3. `foldState.ts`: `loadRollupPrefs`/`saveRollupPrefs`/`useRollupPrefs`, tolerant (absent, corrupt or unreadable
   reads as no preferences, which is the default rule, never a hidden fleet).
4. `FleetScreen`: one `rollupFleet` over the tree; `collapsed`, the rows and the toggles come from it; the clock is
   `useRollupClock` (rule 9); `useHoldView` holds the view across an automatic fold (D-6090); the prune effect runs on a fresh
   frame only (`fleetFrameSeen`).
5. `ProjectCard`/`ProjectCardHead`: render `summary` rows; header `active <age>` while folded; ▾ disabled when held
   open.
6. Renders: 360/390/1280/1920 × refined/instrument × dark/light (32 cells), the table in the PR body.

### Red tests

- `rollup.test.ts`: an inactive project collapses; an active one (working / recent change / fault / pending spawn)
  stays open; a project holding an operator-facing session never collapses, even against a stored collapse;
  children fold with the correct summary; an operator-facing child stays visible while its siblings fold; a
  coordinator-held ask (`withCoordinator`, bucket `working`) and an answered one do not keep the child visible;
  the manual toggle sticks within its class and is dropped when the class changes; one child is not folded
  (D-6089); the open session stays visible.
- `fleet-rollup-render.test.tsx`, per skin: the inactive project's body is not rendered and its header says
  `active …`; the active one is open; the coordinator's summary line and the one operator-facing child render,
  the quiet siblings do not; expanding the line shows them.

### Mutation table (each on a git-archive copy, the touched suite alone, all must go red)

| # | Mutant | Expected red |
|---|--------|--------------|
| M1 | `operatorAsk` reads `dialogPending \|\| hookState === 'waiting'` | coordinator-held ask keeps child visible |
| M2 | `operatorAsk` answers `false` | operator-facing child stays visible; hidden-question project never collapses |
| M3 | the held-open rule dropped from `rollupCard` | hidden-question project never collapses |
| M4 | the 30-minute window dropped | recent change keeps the project open |
| M5 | `prunePrefs` keeps a stored toggle whatever its class | toggle resets on class change |
| M6 | an operator-facing child counted as `waiting` | summary line text |
| M7 | a folded coordinator keeps every child | siblings fold |
| M8 | `ProjectCard` draws `group.rows`, not the rollup's | rendered summary line, per skin |
| M9 | `ProjectCard` ignores the rollup's `collapsed` | rendered inactive project collapses, per skin |
| M10 | `FleetScreen` passes the old `folded.has(project)` and no rollup | rendered collapse and worker line, per skin |

Measured on the build: every mutant red. One mutant was equivalent and is recorded, not counted: `rollupCard`
applying a stored ▾ whatever its class. `toggleProject` stores only the non-default of the class it was made in,
so in the other class the stored value always equals that class's default; the reset is carried by
`prunePrefs`, and M5 mutates that instead (its filter keeps every entry).

### Review fixes (after the first build's three verifiers)

- **Stale clock** (rule 9): the first build's `useNow(60_000, …)` kept its in-window tick once the window closed between
  ticks. Red: the frame-between-ticks case and the no-frame case in `fleet-rollup-render.test.tsx`.
- **Deep link into a rolled-up project** (rule 4): `selectedId` exempted only the worker fold. Red: the decider's
  open-session case and the FleetScreen case `shows the open session inside a quiet project`.
- **Worker line breaks a count** (rule 6): the column is 251-322 px wide at every width. Red: the decider's parts
  case and the per-skin rendered parts case (classes, order, CSS `nowrap` and attention ink).
- **WebKit jump** (D-6090): red in `useHoldView.test.tsx`; checked in WebKit at 390 px (the PR body).
- **Low, fixed**: the held-open ▾ (rule 5), red per skin; a stored ▾ for a project the fleet no longer carries
  (rule 4), red in the decider.
- **Low, follow-up**: a worker in `attention` whose held ask chip outlives `notifyAt` by up to 60 s still says
  `with coordinator` (`sessionFacts`' chip window, existing code); placement and counts are right.

| # | Mutant | Red |
|---|--------|-----|
| M5 | `prunePrefs` keeps every entry (re-spelled for the new filter) | class reset ×2, absent project |
| M11 | `needs you` last in the order | needs-you child count text, parts order |
| M12 | the open session no longer opens its card | rendered deep-link case |
| M13 | `prunePrefs` keeps a project the frame no longer carries | absent project |
| M14 | the window-end timer never set | no-frame case |
| M15 | the clock back to the frozen one-minute interval | frame-between-ticks case |
| M16 | `useHoldView` measures but never scrolls | hold case |
| M17 | the counts lose their unbreakable part | rendered parts, per skin |
| M18 | the held-open ▾ back to `disabled` | rendered held-open ▾, per skin |
| M19 | `.proj-children-part` loses `nowrap` | rendered parts, per skin |

Two first spellings were equivalent and are recorded, not counted: dropping `needs you` from the order (a missing
word sorts first) and splitting the part's text into two text nodes inside the same span.

### Verify

- `pwa`: `npx vitest run --maxWorkers=2 test/rollup.test.ts`, then `test/fleet-rollup-render.test.tsx`,
  `test/useHoldView.test.tsx`,
  `test/fleet-screen.test.tsx`, `test/project-card.test.tsx`, `test/fleet-css.test.ts`, `test/foldState.test.ts`,
  `test/app.test.tsx`, `test/tap-targets.test.tsx`, `test/session-line.test.tsx`, `test/role-census.test.ts`,
  `test/audit-refusals.test.ts`, `test/contrast.test.ts`, `test/ink-tiers.test.ts`, one at a time;
  `npx tsc --noEmit -p .`; the full pwa suite once with `--maxWorkers=3`.
- `server` doc suites: deviation-refs (after `git fetch -q origin main`), dtbd, topology-clean,
  single-definition, docs-grammar.

### Renders

32 cells: 360/390/1280/1920 × refined/instrument × dark/light, a fixture fleet holding one quiet project, one
working project, and a coordinator with five children of which one is operator-facing. The PR body carries the
table.
