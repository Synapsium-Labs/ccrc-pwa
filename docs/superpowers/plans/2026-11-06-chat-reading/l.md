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

- **`repo-slug-shape-guard`.** `refHref` links a PR or commit only when the repository is one `parseGithubRepo`
  (`shared/projectAdd.ts`) reads, not merely non-null, and builds the address from the owner and name it read. A slug comes
  from the server's measurement; the guard keeps a malformed one (`../x`, `owner-a/..`, `-a/b`) from becoming a GitHub
  path. Fix round 1 (review 1586 A1) replaced the first round's own pattern with this, so the console keeps one GitHub
  repository grammar; its answer fits `refHref`, so this is no departure of shape. A slug written with `.git` now links to
  the repository itself. Pinned by "a repository that is not owner/name stays text" (mutant L10) and "a repository is read
  with the console's one GitHub grammar" (mutant N8).
- **`small-id-by-value`.** The small-id rule reads the number's value, so `run 012` is the small id 12 and `run 0` never
  links. Pinned by "a zero or a leading zero is read by its value".
- **`runparam-digits-only`.** `runParam` accepts plain decimal digits only, so `1e3`, `+3` and ` 3` are refused beside the
  plan's `0`, `-1`, `1.5`, `abc` and empty (mutant L11).
- **`arrival-unfolds-finished`.** The board mounts only the newest `FINISHED_FOLD` finished rows. A finished run past the
  fold that `?run=` names is unfolded to, so its row mounts and can arrive; without it the board would neither arrive nor
  say the run is not loaded. Pinned by "a finished run past the fold is unfolded so it can arrive" (mutant L12).
- **`not-loaded-line-as-empty-state`.** `runNotLoadedLine` is drawn as the board's existing `EmptyState` (`data-state="ok"`),
  above the groups, with `role="status"` passed explicitly: the primitive gives `ok` no role ("an honest nothing stays
  silent") and lets a screen's own `role` win. The first round's note said `ok` carried the role; it does not (review 1586
  F6). The line answers a followed link with no focus move, so it is announced. Pinned by "the not-loaded line is a polite
  status" (mutant N7). No new class or rule.
- **`run-row-focus-target`.** Every run row is a programmatic focus target (`tabindex="-1"`), as every accounts row is.
  Besides the plan's two selector lists (the accent edge and the forced-colours outline), `.run-row` joins the accounts
  row's third one, the `[tabindex="-1"]:focus { outline: none; }` reset, so a scripted focus draws no ring; still selector
  lists, never a second rule.
- **`arrival-guard-is-strictmode-only`.** Mutant 8 as worded ("focus moves on every render") cannot happen: the arrival's
  effect is keyed on the key and on whether its row exists, so a re-render never runs it again, and the once-per-value
  record matters only when React runs a new effect twice (StrictMode). The mutant survived the plan's named cases. A new
  case, "under StrictMode, where React runs the effect twice, the row still arrives once" (`runs-arrival.test.tsx`), kills
  it. `accounts-screen.test.tsx` is unchanged and does not catch it, because it renders without StrictMode.
- **`routedhref-mutant-shape`.** Mutant 4 ("`routedHref` accepts `//host`") is written as the protocol-relative refusal
  replaced by an early return of any text that starts with `//`. The first round's note said a `//` path could not route;
  that was false: `matchRoute` is asked the RESOLVED path, and `//host/runs` resolves to `/runs` (review 1586 F3), while
  `[x](//)` made `new URL` throw and dropped the whole message to plain text (F2). Fix round 1 refuses `//…` and `/\…`
  before resolving (mutant N2), and wraps `new URL` so a refused URL answers null. That wrap has no reachable input today:
  every path that reaches it starts with one `/`, which the URL parser never refuses, so its mutant (N3) survives as
  equivalent. It stays, as the ruling asked, because chat's `a` arm asks `routedHref` of every Markdown link.
- **`navigate-observed-by-location`.** The plan says `navigate` is spied. The cases read `location` after the click
  instead, and spy `window.open` as planned: `navigate` is an ES module export, and the location is what the click must
  change.
- **`shared-code-named`.** `SHARED_COMPONENTS.code` became a named component, `SharedCode`, so chat's `code` arm can
  draw it inside `ChatRef`. The Docs reader's output is unchanged; the markdown goldens are byte-identical.
- **`browser-fixture-caps-and-pools`.** The browser file serves `/api/coord/caps` (the board's caps dial throws on the
  harness's default `{}`, and the board shows "This screen could not be shown") and sends a `pools` frame, which starts
  the projects read that carries the project's measured repository (`useProjectRows`). Consequence, not a change: until
  that read lands, a session's `#n` and commits stay text, as its header's repository label does.
- **`link-inside-link-context`.** Chat's `a` arm provides a context (`InsideLinkContext`, module-private in `markdown.tsx`)
  under which `ChatRef` draws its children only, so a whole-name code span inside a Markdown link draws the link's anchor
  alone and one click does one thing (review 1586 F1). The remark plugin already marks nothing inside a link; the code arm's
  render-time R13 decision is what needed telling. Pinned in jsdom by four rows (a PR, a run, a document path and a commit
  written as a link's text, mutant N1) and in Chrome by "a name written as a link's text draws that link alone" (N1b).
- **`arrival-held-while-moving`.** A run that closes while its own `?run=` page is open leaves the live frame before the
  archive re-read brings it back in Finished. `useColdRuns` now says whether a re-read is on its way (`reading`, true from
  the mount, which always reads, until the newest re-read settles), and `useArrival` takes an optional `hold`: while the row
  arrived at is missing and `hold` stands, the record and the mark stay. The runs board raises it while a re-read is out or
  the archive last read the run open (the same render the frame drops it, before the re-read is issued). Accounts passes
  none, so its arrival is unchanged. The not-loaded line also waits for `reading` to clear, which covers a remount over
  pages the store already holds (review 1586 F4). `useColdRuns.ts` was claimed for this (claim 3709). Pinned by "a run
  that closes under its own page keeps its one arrival" (mutants N4, N4b, N5) and "over pages the store holds, a run they
  lack is said missing only once this mount's read answers" (N5, N6).
- **`held-ids-pinned-in-chrome`.** `SessionScreen`'s held ids are pinned in the browser file, whose fixture now holds run 12
  in the runs frame and item 41 in the cleared trail (review 1586 F5): mutants G30 (`idSet('')`) and G25 (`cleared`
  dropped) go red at 1280 and 390. The not-loaded line's `runsFrameSeen` conjunct is pinned by "with the archive answered
  and no frame seen, a run it lacks is not said missing" (G22, F7).
- **`names-link-in-header-cells-and-recap`.** Names link inside a table header cell and in an opened recap, as the plan and
  Task M's note say; the brief's sentence saying otherwise was wrong on those two points (fix round 1 ruling 7, review 1586
  F8). No change. A status label in a header cell stays suppressed, as Task M ruled.
- **`linkify-one-external-anchor`.** `linkify` draws its URL anchor through `ChatLink {external: true}`, so chat has one
  external anchor; the markup is byte-identical, which "linkify with no context is today's output" pins (review 1586 A7).
- **`f1-f2-reading`.** Review 1579's report was not available to this workspace. Its two pins are read from the brief's
  words: F1, a row that kills the commit grammar's 7-character floor, is `abc123` (six hex, a digit and a letter) as text;
  F2, a header cell's kept text, is a header cell `#651 merged` keeping `merged` as plain text beside the `#651` mark. Both
  are in `chat-marks.test.ts`, as the brief says; F2 runs the parse with the plugin there, since a header cell exists only
  in a tree.
- **`browser-main-red-from-export`.** Step 5's "run on main (red)" was measured on a `git archive` of `origin/main`
  (`pwa`, `ui`, `shared`) with this workspace's `node_modules` borrowed: 8 of 8 failed, as no name in chat was a link.

## Mutants

Each was applied to the named file by exact-once replacement, run against the named test files through `ccrc test`, and
restored from a saved copy with its sha256 checked. The first round listed 19 (its note said 20: review 1586 A6); fix round 1
re-ran those 19 on its own code (L2, L4, L10 and L13 rewritten to the lines they now mutate) and added 13. Of the 32, 31 went
red on the named case; N3 survives as equivalent (see `routedhref-mutant-shape`).

| # | Mutant | File | Red case |
|---|---|---|---|
| L1 | the small-id rule removed | `chatRefs.ts` | `chat-refs` "run 12 links because the console holds it, run 2 stays text" |
| L2 | `pr` and `commit` resolve a null repo to a guessed slug, read by `parseGithubRepo` | `chatRefs.ts` | "with no repo, #651 and a commit stay text" |
| L3 | the branch ignored for documents | `chatRefs.ts` | "a specs path opens the Docs reader at the session's branch"; `chat-links` "inline code whose whole text is a path links …" |
| L3b | the same, in Chrome | `chatRefs.ts` | `chat-links.browser` "a document path opens the Docs reader at the session's branch" (1280 and 390) |
| L4 | `routedHref`'s protocol-relative refusal replaced by accepting `//host` | `routes.ts` | `lane-route` "is null for … \"//host/x\""; `chat-links` "an unrouted or protocol-relative path keeps the external arm" |
| L5 | `ChatRef` draws a link when `refHref` is null | `markdown.tsx` | "an unresolved name is plain text with no anchor" |
| L6 | the `code` arm links any span containing a name | `markdown.tsx` | "inline code holding a sentence with a path does not link" |
| L7 | `linkify` ignores the context | `MessageBubble.tsx` | `message-bubble` "linkify links #651 in the operator's own text under a context" |
| L8 | `useArrival`'s once-per-value record removed | `useArrival.ts` | `runs-arrival` "under StrictMode, where React runs the effect twice, the row still arrives once" (see `arrival-guard-is-strictmode-only`) |
| L9 | a second `docHref` declared in `ledgerLinks.ts` | `ledgerLinks.ts` | `single-definition/ledgers-console` |
| L10 | the repository grammar dropped (the slug split on `/` as written) | `chatRefs.ts` | "a repository that is not owner/name stays text" |
| L11 | `runParam` takes any non-empty value | `routes.ts` | `lane-route` "runParam refuses … \"?run=1e3\"", "… \"?run=+3\"" |
| L12 | the fold not unfolded to the named run | `RunsScreen.tsx` | `runs-arrival` "a finished run past the fold is unfolded so it can arrive" |
| L13 | the not-loaded line said before both sources answer | `RunsScreen.tsx` | "before they answer it says nothing" |
| L14 | a second `refHref` declared in `markdown.tsx` | `markdown.tsx` | `single-definition/chat-marks` "the resolver, the console-path decision and the arrival are each declared once" |
| L15 | the `a` arm never moves within the app | `markdown.tsx` | "a Markdown link to /runs navigates in the app" |
| L16 | `sessionBranchRef` takes any branch | `docsLinks.ts` | `session-docs-link` "sessionBranchRef refuses … \"HEAD\""; `chat-refs` "a branch outside the bare grammar opens the default view" |
| F1 | the commit floor lowered to 6 | `chatMarks.ts` | `chat-marks` "abc123 (six hex, under the floor)" |
| F2 | a header cell's status word dropped instead of kept as text | `remarkChatMarks.ts` | `chat-marks` "the header cell `#651 merged` keeps `merged` as text beside the #651 mark" |
| N1 | `ChatRef` ignores the inside-a-link context | `markdown.tsx` | `chat-links` "… draws one anchor and one click does one thing" (all four rows), "the same code span outside a link still links" |
| N1b | the same, in Chrome | `markdown.tsx` | `chat-links.browser` "a name written as a link's text draws that link alone …" (1280 and 390) |
| N2 | the protocol-relative refusal dropped | `routes.ts` | `lane-route` "never throws and is null for the protocol-relative \"//host/runs\""; `chat-links` "a link to the protocol-relative \"//host/runs\" keeps the external arm …" |
| N3 | the `try`/`catch` around `new URL` dropped | `routes.ts` | none: survives, equivalent (no reachable input) |
| N4 | the runs board passes no `hold` | `RunsScreen.tsx` | `runs-arrival` "a run that closes under its own page keeps its one arrival …" |
| N4b | `useArrival` ignores `hold` | `useArrival.ts` | the same case |
| N5 | the not-loaded line ignores a re-read in flight | `RunsScreen.tsx` | the same case; "over pages the store holds, a run they lack is said missing only once this mount's read answers" |
| N6 | `useColdRuns` answers `reading: false` | `useColdRuns.ts` | "over pages the store holds, …" |
| N7 | the line's `role="status"` dropped | `RunsScreen.tsx` | "the not-loaded line is a polite status" |
| N8 | the PR address built from the slug as written | `chatRefs.ts` | `chat-refs` "a repository is read with the console's one GitHub grammar" |
| G22 | the line's `runsFrameSeen` conjunct dropped | `RunsScreen.tsx` | "with the archive answered and no frame seen, a run it lacks is not said missing" |
| G30 | `SessionScreen` passes `idSet('')` for both held sets | `SessionScreen.tsx` | `chat-links.browser` "a held small run and a cleared item link through the ids the console holds" (1280 and 390) |
| G25 | `SessionScreen`'s held items drop `cleared` | `SessionScreen.tsx` | the same case (1280 and 390) |

## Gates

Run one at a time through `ccrc test`. The pwa type check (`tsc --noEmit -p .`, which includes `test/`): clean. The whole pwa
suite, on its first full run after the implementation was complete: 470 files, 13 886 passed, 3 skipped. The rest are in
the pull request.
