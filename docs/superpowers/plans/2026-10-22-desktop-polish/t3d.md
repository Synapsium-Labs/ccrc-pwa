# T3d (D-6334): what the ledger should learn

A task note for the desktop-polish plan's Task T3d (the inspector shows only sections with content and one honest
routing line), from its work run. It records what the run measured and decided, so the coordinator can fold it into the
programme ledger. It edits no ledger row.

## What shipped

- **One provider reader.** `accountProvider(roster, wrapper)` (`pwa/src/lib/accounts.ts`) is the one reader of
  `RosterWire.provider`. An absent field (an older server, an undeclared lane), a value this build does not know, an
  unrostered wrapper and a roster not yet arrived all answer `null`: not measurable. Every caller treats those alike.
- **One measurability rule.** `classReadbackMeasurable(wrapper, provider)` (`pwa/src/lib/models.ts`): the provider is
  known and is the provider of the list `modelOptions` picks for the lane. `modelListProvider(wrapper)` names that list
  once, and `modelOptions` and `effortOptions` go through it, so the dedicated lane's wrapper-id branch is written once
  (departure `model-list-names-its-provider`).
- **One decision for header and rail.** `routeView(live, wrapper, provider)` takes the provider (required), and exposes
  `classPending` and `effortPending`; `wireQueuedField` keeps today's effort-first answer (departure
  `route-view-splits-pending`). `SessionScreen` passes `accountProvider(roster, wrapper)`.
- **One routing line.** `routingLine(row, view, lane)` (`pwa/src/session/routingLine.ts`, L1) returns ordered parts and
  the sentence "Runs <model> on <lane> · effort <x>", then " · asked <class>" only for a measurable pending class,
  " · asked effort <x>" for a pending effort (departure `routing-line-says-pending-effort`), " · model set by the lane"
  for an inert class, " · routing could not be read" for a failed read. The provider reaches it through `routeView`
  (departure `routing-line-takes-the-view`). Its words live once, in a `Record` table the plain-words census reads. The
  rail's model and effort words are the header's chooser doors, at the tap floor. Every " · " is the line's own `sep`
  part, the effort's included, and the markup keeps it, the words after it and the door, ask or note they lead to in
  one nowrap tail that opens on a `<wbr>`, so the line breaks before a " · " and never after it.
- **The doors keep their names.** With nothing read, the doors are "Model: not read yet, change" and "Effort: set
  effort, change", as before T3d (the header chip still says "set effort"), and each shows a word its name contains:
  "Runs a model not read yet on Lane A · set effort". Only the inert effort's "Effort: set by the lane, change" is new.
- **Sections with content only.** Tasks only with tasks, Mail only with mail, PR only when it has a number, the lane
  only with a binding-window reading, Routing only with a fleet row, History always. No "No plan", "No mail",
  "Not read yet", "No PR" or "Usage not read yet" remains. With nothing else, the rail holds History alone.
- **The PR section tolerates a row without `pr`** (a cast fleet frame), as the header's cap already does. The render
  matrix found this: such a row crashed the whole app at >=1600 in Refined.

## Departures (slugs; numbers issued by the coordinator)

- `model-list-names-its-provider`, `routing-line-takes-the-view`, `route-view-splits-pending`,
  `routing-line-says-pending-effort` — issued.
- `routing-line-names-inert-class` — issued: an inert class now reads " · model set by the lane", replacing the old
  rail's "not applied on this lane" note, which the one line would otherwise have dropped (final review M-7).
- `t3d-inspector-css-joins-the-task` — issued (review F2): `pwa/src/inspector/inspector.css` is part of T3d, though the
  plan's file list does not name it. It holds the routing line's inline row, the doors' tap floor, and the nowrap pill
  and tails.

## Anchor drift (Step 0, main at 47b5704e2)

`SessionScreen.tsx` routeView call at :310 (plan ≈:299-307, three lines past its end), its accounts import at :14; `routeView.ts` :40 and :94-131 unchanged;
`RoutingSection.tsx` :13-65; the dedicated-list branch at `models.ts` :139 and :201; `rosterKindOf` at
`shared/roster.ts` :347.

## Residuals

- **Route-less sessions.** With no routing record the header's badge comes from the local-write lane for the tap's own
  moment (up to 60 s and its toast) while the rail reads only the record. Stated in `routeView.ts`; outside T3d's fence
  (`SessionScreen.tsx` ≈:446).
- **Lanes that declare no provider** lose the header's class "queued" badge (the plan's intent: not measurable).
- **A second OpenAI lane** gets the Anthropic list from `modelOptions` and so reads not measurable; the dedicated list
  stays keyed by its wrapper id, as the plan says.
- **Effort readback** is not provider-gated: the plan scopes the rule to the class.
