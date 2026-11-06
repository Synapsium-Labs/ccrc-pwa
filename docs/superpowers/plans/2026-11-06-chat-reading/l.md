# Task L: links from names to their objects (D-8062), worker's note

Task L of [the chat reading plan](../2026-11-06-chat-reading.md). This note records what the task measured and where it
departs from the plan's text, by slug, for the coordinator to fold into the plan's ledger. It defines no number.

## Before starting

No open pull request touched `AccountsScreen.tsx`, `RunsScreen.tsx`, `RunRow.tsx`, `WaitingRoutes.tsx`, `ledgerWords.ts` or
`SessionScreen.tsx` (`gh pr list`, every open PR's files), so no merge of main was needed. Base: `6637ad604` (Task M merged).

## Step 0, measured on the base

`ledger-links.test.ts`, `waiting-routes.test.tsx`, `programme-screen.test.tsx`, `lane-route.test.ts`, `accounts-screen.test.tsx`,
`session-docs-link.test.tsx` and `message-bubble.test.tsx`: 7 files, 215 tests, all passed.

The four moves, each its own commit and each green after it:

| Move | To | Tests changed | Green after |
|---|---|---|---|
| `docHref` | `pwa/src/docs/docsLinks.ts` | `ledger-links.test.ts`'s import; `ledgers-console.test.ts` names the new holder | ledger-links, programme-screen, session-docs-link: 88; ledgers-console: 5 |
| `itemPath`, `FROM_QUERY` | `pwa/src/ledgers/ledgerWords.ts`, built on `waitingPath()` | imports in `waiting-routes.test.tsx` and `programme-screen.test.tsx` | waiting-routes, programme-screen, waiting-saved-copy: 117 |
| the console-path arm | `pwa/src/lib/routes.ts` as `routedHref`; `linkOf` calls it | none | ledger-links, lane-route: 21 |
| the arrival effect | `pwa/src/lib/useArrival.ts`; `AccountsScreen` calls it | none | accounts-screen: 38 |

## Departures, by slug

- **`repo-slug-shape-guard`.** `refHref` links a PR or commit only when the repository is `owner/name` in GitHub's own
  spelling, not merely non-null. A slug comes from the server's measurement; the guard keeps a malformed one (`../x`,
  `owner-a/..`) from becoming a GitHub path. Pinned by "a repository that is not owner/name stays text" (mutant L10).
- **`small-id-by-value`.** The small-id rule reads the number's value, so `run 012` is the small id 12 and `run 0` never
  links. Pinned by "a zero or a leading zero is read by its value".
- **`runparam-digits-only`.** `runParam` accepts plain decimal digits only, so `1e3`, `+3` and ` 3` are refused beside the
  plan's `0`, `-1`, `1.5`, `abc` and empty (mutant L11).
- **`arrival-unfolds-finished`.** The board mounts only the newest `FINISHED_FOLD` finished rows. A finished run past the
  fold that `?run=` names is unfolded to, so its row mounts and can arrive; without it the board would neither arrive nor
  say the run is not loaded. Pinned by "a finished run past the fold is unfolded so it can arrive" (mutant L12).
- **`not-loaded-line-as-empty-state`.** `runNotLoadedLine` is drawn as the board's existing `EmptyState` (`data-state="ok"`,
  so `role="status"`), above the groups. No new class or rule.
- **`run-row-focus-target`.** Every run row is a programmatic focus target (`tabindex="-1"`), as every accounts row is.
  Besides the plan's two selector lists (the accent edge and the forced-colours outline), `.run-row` joins the accounts
  row's third one, the `[tabindex="-1"]:focus { outline: none; }` reset, so a scripted focus draws no ring; still selector
  lists, never a second rule.
- **`arrival-guard-is-strictmode-only`.** Mutant 8 as worded ("focus moves on every render") cannot happen: the arrival's
  effect is keyed on the key and on whether its row exists, so a re-render never runs it again, and the once-per-value
  record matters only when React runs a new effect twice (StrictMode). The mutant survived the plan's named cases. A new
  case, "under StrictMode, where React runs the effect twice, the row still arrives once" (`runs-arrival.test.tsx`), kills
  it. `accounts-screen.test.tsx` is unchanged and does not catch it, because it renders without StrictMode.
- **`routedhref-mutant-shape`.** Mutant 4 ("`routedHref` accepts `//host`") is written as an early return of any text that
  starts with `//`. Deleting `resolvedPath`'s own `//` check changes no answer today: no route pattern matches a path that
  starts with `//`, so `matchRoute` refuses it anyway. The check stays as the moved code had it.
- **`navigate-observed-by-location`.** The plan says `navigate` is spied. The cases read `location` after the click
  instead, and spy `window.open` as planned: `navigate` is an ES module export, and the location is what the click must
  change.
- **`shared-code-named`.** `SHARED_COMPONENTS.code` became a named component, `SharedCode`, so chat's `code` arm can
  draw it inside `ChatRef`. The Docs reader's output is unchanged; the markdown goldens are byte-identical.
- **`browser-fixture-caps-and-pools`.** The browser file serves `/api/coord/caps` (the board's caps dial throws on the
  harness's default `{}`, and the board shows "This screen could not be shown") and sends a `pools` frame, which starts
  the projects read that carries the project's measured repository (`useProjectRows`). Consequence, not a change: until
  that read lands, a session's `#n` and commits stay text, as its header's repository label does.
- **`f1-f2-reading`.** Review 1579's report was not available to this workspace. Its two pins are read from the brief's
  words: F1, a row that kills the commit grammar's 7-character floor, is `abc123` (six hex, a digit and a letter) as text;
  F2, a header cell's kept text, is a header cell `#651 merged` keeping `merged` as plain text beside the `#651` mark. Both
  are in `chat-marks.test.ts`, as the brief says; F2 runs the parse with the plugin there, since a header cell exists only
  in a tree.
- **`browser-main-red-from-export`.** Step 5's "run on main (red)" was measured on a `git archive` of `origin/main`
  (`pwa`, `ui`, `shared`) with this workspace's `node_modules` borrowed: 8 of 8 failed, as no name in chat was a link.

## Mutants

Each was applied to the named file by exact-once replacement, run against the named test files through `ccrc test`, and
restored from a saved copy with its sha256 checked. All 20 went red on the named case.

| # | Mutant | File | Red case |
|---|---|---|---|
| L1 | the small-id rule removed | `chatRefs.ts` | `chat-refs` "run 12 links because the console holds it, run 2 stays text" |
| L2 | `pr` and `commit` resolve a null repo to a guessed slug | `chatRefs.ts` | "with no repo, #651 and a commit stay text" |
| L3 | the branch ignored for documents | `chatRefs.ts` | "a specs path opens the Docs reader at the session's branch"; `chat-links` "inline code whose whole text is a path links …" |
| L3b | the same, in Chrome | `chatRefs.ts` | `chat-links.browser` "a document path opens the Docs reader at the session's branch" (1280 and 390) |
| L4 | `routedHref` accepts `//host` | `routes.ts` | `lane-route` "is null for … \"//host/x\""; `chat-links` "an unrouted or protocol-relative path keeps the external arm" |
| L5 | `ChatRef` draws a link when `refHref` is null | `markdown.tsx` | "an unresolved name is plain text with no anchor" |
| L6 | the `code` arm links any span containing a name | `markdown.tsx` | "inline code holding a sentence with a path does not link" |
| L7 | `linkify` ignores the context | `MessageBubble.tsx` | `message-bubble` "linkify links #651 in the operator's own text under a context" |
| L8 | `useArrival`'s once-per-value record removed | `useArrival.ts` | `runs-arrival` "under StrictMode, where React runs the effect twice, the row still arrives once" (see `arrival-guard-is-strictmode-only`) |
| L9 | a second `docHref` declared in `ledgerLinks.ts` | `ledgerLinks.ts` | `single-definition/ledgers-console` |
| L10 | the repository shape check dropped | `chatRefs.ts` | "a repository that is not owner/name stays text" |
| L11 | `runParam` takes any non-empty value | `routes.ts` | `lane-route` "runParam refuses … \"?run=1e3\"", "… \"?run=+3\"" |
| L12 | the fold not unfolded to the named run | `RunsScreen.tsx` | `runs-arrival` "a finished run past the fold is unfolded so it can arrive" |
| L13 | the not-loaded line said before both sources answer | `RunsScreen.tsx` | "before they answer it says nothing" |
| L14 | a second `refHref` declared in `markdown.tsx` | `markdown.tsx` | `single-definition/chat-marks` "the resolver, the console-path decision and the arrival are each declared once" |
| L15 | the `a` arm never moves within the app | `markdown.tsx` | "a Markdown link to /runs navigates in the app" |
| L16 | `sessionBranchRef` takes any branch | `docsLinks.ts` | `session-docs-link` "sessionBranchRef refuses … \"HEAD\""; `chat-refs` "a branch outside the bare grammar opens the default view" |
| F1 | the commit floor lowered to 6 | `chatMarks.ts` | `chat-marks` "abc123 (six hex, under the floor)" |
| F2 | a header cell's status word dropped instead of kept as text | `remarkChatMarks.ts` | `chat-marks` "the header cell `#651 merged` keeps `merged` as text beside the #651 mark" |

## Gates

Run one at a time through `ccrc test`. The pwa type check (`tsc --noEmit -p .`, which includes `test/`): clean. The whole pwa
suite, on its first full run after the implementation was complete: 470 files, 13 886 passed, 3 skipped. The rest are in
the pull request.
