# Wave 174: a document in its own tab (desktop polish run 3633)

The note for wave 174, written by its worker for the coordinator to fold into the ledger. The operator's goal of
2026-11-24: opening a document from the console "takes me completely away from the session"; they want "a webpage with a
dedicated view" for the reader only, without the left side panel, "so that I can have many open at a time". Each claim
says whether it was **measured** (read on the tree, in a browser or in a test run by this wave) or **inferred**.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| The one rule for a click, `opensNewTab(href, desk, docsTab)`: at a desk, an in-app link that crosses between the console and the Docs reader opens a new browser tab; a link within its kind of tab moves in the tab; below the desk width nothing opens a tab. The one definition of a Docs tab, `isDocsTab(path, docsSoFar)`, from the tab's history alone, never its width: a tab is a Docs tab while it shows a Docs page and has shown only Docs pages (fix round 2, R2). With them `isDocsHref`, `CONSOLE_ROOT` and `NEW_TAB_WORDS` | `pwa/src/lib/docTab.ts` (L1, pure; it imports the route table and nothing of the Docs context) | Measured: `docs-tab-rule.test.ts` |
| A Docs tab's title, `docsTabTitle` | `pwa/src/docs/docsTabTitle.ts` (L1, pure, with the reader's words) | Measured: `docs-tab-rule.test.ts` |
| An anchor's props by the rule: `useTabLink()` answers `href => props`, a new-tab anchor (`target="_blank"`, `rel="noopener noreferrer"`, the design system's own `rel` for a link that leaves, no click handler, so the browser opens one tab per click) or the in-app click (`inAppClick`) as before. A move by the rule for a control that is not an anchor: `useFollowLink()` answers `href => void`, a new tab (`window.open(href, '_blank', 'noopener,noreferrer')`) where the rule says so, else `navigate(href)`. `DocsTabContext` carries the tab's kind from `App` to both. `navigate` and the router are unchanged | `pwa/src/lib/useTabLink.ts` (L4) | Measured: `docs-tab-links.test.tsx`, `docs-tab-rule.test.ts` |
| The link back, `ConsoleLink`: an anchor wearing the ghost button (`GHOST_ANCHOR`, the repo's standalone-anchor pattern, which carries the tap floor), to `CONSOLE_ROOT` by `useTabLink`; named "Console, opens in a new tab" where it opens one, "Console" where it moves in place. The tab bar draws it at a desk (below the desk width there is no bar, fix round 3), and so does the failed-render fallback in a Docs tab ("Back to the console") | `pwa/src/components/ConsoleLink.tsx`, `pwa/src/components/RenderBoundary.tsx` | Measured: `docs-own-tab.test.tsx`, `docs-tab-links.test.tsx`, the browser leg |
| A notification tap never takes a Docs tab: the push worker brings up a window that is not on a Docs address, and opens a new one when every window is | `pwa/public/push-sw.js` (`onDocs`, the route table's Docs pattern copied, held to it by its test) | Measured: `push-sw.test.ts` |
| The frame's reader-alone mode: `ShellFrame`'s `alone` draws the skip link, at a desk a `<header class="shell-tab-bar">` holding the given node (none below it, fix round 3), and the same keyed `<main id="content">`, with no part of the skin set (no bar, accounts strip, banners, fleet column, inspector, status bar or phone navigation) and no skin frame class; `data-tab="docs"` selects a one-column desk grid | `pwa/src/skins/frame.tsx`, `pwa/src/styles/shell.css` (its last block) | Measured: `docs-own-tab.test.tsx`, `docs-own-tab.browser.test.ts` |
| The Docs tab in `App`: it keeps `docsSoFar` (state that only falls, adjusted while rendering), starting from what the tab was before this load, and `isDocsTab(path, docsSoFar)` picks a second tree with the sign-in and block screens and the frame in its `alone` mode, the link back in its bar, the reader in the detail; the fleet stream, the Overlord poll and the session-screen preload are gated off; the title effect. A console marks its tab (`markConsoleTab`) | `pwa/src/app.tsx` | Measured: the same two suites |
| A place's door in a desk bar: `PlaceDoor`, the "Go to" command door, or, where the rule opens a new tab (the Docs place), an anchor wearing the door's own classes (`DOOR`, `DOOR_GLYPH`) | `pwa/src/skins/DoorLink.tsx`, used by Refined's `AppBar` and Instrument's `TopBar` | Measured: `docs-tab-links.test.tsx` |
| What a tab has been, across a reload: "this tab has been the console", kept in the tab's own store (`tabStorage`, the tab's session storage, added to the one storage port) and read once when the app starts (`wasConsoleTab`); every read and write is guarded, and with no store or one that refuses the first page decides (fix round 2, R4) | `pwa/src/lib/tabMark.ts`, `pwa/src/lib/storage.ts` | Measured: `docs-own-tab.test.tsx`; that a new tab gets no copy, in Chrome |

No server, wire or shared change; no new route (a document's address is what it was); `DocsScreen.tsx` is untouched, and
`DocsHead.tsx` changes by the agreed Back change only, the reader's Back taking `useFollowLink` (fix round 1, F1): two git
hunks against main, the `navigate` import swapped for the hook's, and the Back button taking the hook and its handler calling
it, 3 lines in and 2 out. The reader's owner (the Docs reader
coordinator) said yes to that exact diff, read against main `6c7f126d428de2f346f8d69188e24d46da833d4c`, through the
coordinator on 2026-11-24; the edit is that diff applied unchanged, main had not moved under the file, and the button is
kept at the index. Its tests sit together in `docs-own-tab.test.tsx`: the index in a Docs tab at a desk opens the console in
a new tab, and three cases pin the rest as on main (a leaf's Back moves up within the tab; the console on a phone and a
narrow Docs tab move to the fleet in place).

## 2. Every link source, converted or left

Measured by reading every caller of `docsLinks.ts`'s builders (`docHref`, `sessionDocsHref`, `docsPageUrl` outside the
reader) and every in-app move to a Docs path, at the base.

| Source | What it is now | Test |
|---|---|---|
| Chat's document links (`chatRefs.ts` builds, `ChatLink` in `lib/markdown.tsx` draws; a routed Markdown link too) | `useTabLink` | ChatLink cases |
| A Waiting item's, an epic's and a Goals page's text (`ledgerLinks.ts`'s `linkRuns` and `specHref`, drawn by `ItemView`'s `Linked`, `EpicBody`'s `Internal`, `GoalsPanel`) | `useTabLink` | ItemView, EpicBody, GoalsPanel cases |
| The Spec link on the programme header, a Waiting group and an item (`SpecLink`, `GoalsPanel.tsx`) | `useTabLink` | SpecLink cases |
| A run page's "Open the spec" fact (`RunDetailScreen`'s `Facts`) | `useTabLink` | RunDetail case |
| The session actions sheet's Docs row | an anchor wearing `GHOST_ANCHOR` (was a ghost `Button` that navigated), `useTabLink`, closes the sheet | actions sheet cases, and `session-docs-link.test.tsx` updated |
| The session menu's Docs item (`sessionMenu.ts`'s entry, drawn by `SessionFlows`) | an anchor wearing `LIST_ROW` (was a `ListRow` button) with `useTabLink`'s props, so middle click and copy link work; a plain click runs its registry command, `session-docs`, as every item of the menu does, which closes the menu and moves by `useFollowLink` (the palette's "Open this session's docs" runs the same one) | menu cases (the desk case asserts the one tab opened), and `session-docs-link.test.tsx` updated |
| The top bar's Docs place, both skins | `PlaceDoor`: an anchor at a desk | PlaceDoor and the two App bar cases |
| The command palette, the bar doors' commands and the global keys ("Go to Docs", `g` keys) | `CommandLayer`'s `navigate` is `useFollowLink`'s move | the palette case |
| The detail fallback's way out | in a Docs tab, the link back ("Back to the console", to `CONSOLE_ROOT`, a new tab at a desk, named so); in the console, "Back to the fleet" as before | ScreenFallback cases |
| The reader's own Back at the Docs index (`DocsHead.tsx`'s `BackButton`; its up door is the fleet there) | `useFollowLink`: in a Docs tab at a desk the console opens in a new tab and the tab stays a Docs tab; elsewhere `navigate` as before | `docs-own-tab.test.tsx`'s Back case |
| A push notification's tap (`push-sw.js`'s `openApp`) | never a Docs tab's window: another window, or a new one | `push-sw.test.ts`'s Docs tab cases |
| The phone's bottom bar Docs door | left: a phone width, which the rule never crosses | `docs-own-tab.test.tsx`'s phone cases |
| Every link inside the reader (crumbs, rows, the reader's own links, history, export) | left: Docs to Docs, which moves within the Docs tab as before | `docs-tab-rule.test.ts` (a Docs tab's document link stays) |
| Instrument's and Refined's other places, every console-to-console link | unchanged | PlaceDoor `runs` case |

`TextLink` (`@ccrc/ui`) already carried `target="_blank"` with an in-app click on every in-app use, so a middle click on
those links opened a tab before this wave too (measured: `text-link.tsx`); only a plain click changes, at a desk.

## 3. Choices the brief left to the wave

- **A link from a Docs tab to a console page** (brief item 3): the rule is symmetric. A Docs tab never draws the console:
  a console page opens in a new tab (the link back, the fallback's way out, and the reader's Back at the index); a document
  moves within the tab. Inside the reader one move leaves Docs: Back at the index, whose up door is the fleet (review 3644
  F1; the first round said every `navigate` under `pwa/src/docs` named a Docs page, which was wrong). It takes the rule
  through `useFollowLink`; every other move under `pwa/src/docs` and `DocsScreen.tsx` names a Docs page, and
  `docLinkTarget`'s in-app kind is always a Docs address (measured by reading). Slug `docs-tab-rule-is-symmetric`.
- **The link back** opens the console at its root (`CONSOLE_ROOT`, the route table's home row; renamed from
  `CONSOLE_PATH`, which `lib/routes.ts` uses for another meaning, review 3644 A5) in a new tab, named "Console, opens in a
  new tab", in the tab bar above the reader, outside `DocsHead.tsx`. Its name is spelled whole in `aria-label`: a visually
  hidden span put a space before the comma in Chrome's computed name (measured, in the browser leg). It stands alone, so it
  is the ghost-button anchor, not the inline `TextLink` (review 3644 A3). Slug `link-back-new-tab-at-root`.
- **A Docs tab on a phone has no bar** (fix round 3). Below the desk width the frame draws no tab bar, so the reader's head
  is the top of the page, exactly as in the console, and the phone's one bar keeps its bounds: with the bar, a document
  opened first at 412 x 915 had 53 px of bar above the head and its title 109 px down, against the phone-header plan's 61;
  without it, 56 px in both skins, as in the console. The way back on a phone is the reader's Back, which at the Docs
  index moves the tab to the console in place, and the failed-render fallback's link. At a desk the bar and its link back
  stay. Slug `docs-tab-phone-has-no-bar`.
- **The desk head in a Docs tab** (fix round 3): the reader alone takes the window's width, so its head has the room the
  console's Docs pane gives it only in a wider window (the pane is 940 px in Instrument and 960 in Refined at 1280). It is
  the same head on the same rule (`HeadRow`: the action words show while the page's whole name fits beside them), so a
  Docs tab given the console's room draws the console's row exactly, and at 1280 it shows the words where the console, on
  a long page name, hides them. On a short name the console at 1280 shows them too. Measured in Chrome, both skins.
  Slug `docs-tab-head-follows-its-room`; whether a Docs tab at a desk should hide the words regardless is the
  coordinator's to rule.
- **The width rule** (brief item 5): the shell's own desk test, `DESK_QUERY` (`(min-width: 900px)`), defined once in
  `ui/src/lib/use-media-query.ts` and re-exported by `pwa/src/lib/useMediaQuery.ts`, read with `useDesk()` by `useTabLink`
  and `useFollowLink`. No second breakpoint. It decides only whether a click opens a tab, asked live. What a tab is takes no
  width at all (the coordinator's ruling on review 3666, R2 and R4, which replaces round 1's "a Docs page at a desk
  always"): a tab is a Docs tab while it shows a Docs page and has shown only Docs pages, and that history survives a reload
  of the tab. So a document opened in a tab of its own stays a Docs tab however its window is resized, with the same reader
  and no fleet stream; a Docs address loaded first draws the reader alone at any width; a console that moves to a document,
  at any width, shows it inside the console as on main, and stays the console when widened or narrowed, with one mount of
  the reader and its stream open; and a console that reloads on a Docs address, the release's reload on a tap included,
  is still the console. Slug `docs-tab-width-is-live` (as the second ruling amends it: the kind is history, the click is
  width).
- **`navigate` is unchanged; `useFollowLink` is new.** Putting the rule inside `navigate` would also have changed every
  test and caller that uses `navigate` to set the address at a desk, and the reader's own moves; a separate door for the
  controls that are not anchors keeps the change where the links are. The first round's `followLink` in the router read
  the tab's kind from the address; with the kind now history (`docsSoFar`), it became a hook beside `useTabLink`
  that reads the same context, and the router is back to its base. Slug `follow-link-beside-navigate`.
- **The title**: `<file name> · <project> · Docs · ccrc`; a directory or section by its own name, a project by its name,
  the index and a refused address as `Docs · ccrc`. The ref is not in the title. Slug `docs-tab-title-names-the-file`.

## 4. What a Docs tab mounts and asks, today and after

Measured in jsdom over the first 1.5 s after mounting `App` at a Docs leaf at a desk width, each skin, every request
answered 503 and every socket recorded (a throwaway copy of `docs-own-tab.test.tsx`'s recorders, run against `main`'s
`pwa/src` at `fffa89aba8` and against this branch). Both skins gave the same figures.

| | main | this branch |
|---|---|---|
| sockets | 1 (`/ws/fleet`) | 0 |
| requests | 7: 1 Docs, and `/api/auth/status`, `/api/claims`, `/api/accounts`, `/api/fleet/health`, `/api/updates`, `/health` | 1: the Docs read |
| console chrome mounted | the badge, the command layer (palette and global keys), the fleet sheets, the splash, the toast host (a toast drew) | none (a toast draws nothing) |
| session screen chunk preloaded | 1 | 0 |
| fleet column, accounts strip, top bar | drawn | none |

The console's polls repeat on their own clocks (health every 15 s, updates every 60 s), so over a longer visit main's count
grows and this branch's does not (inferred from the poll intervals, not measured past 1.5 s).

The main column came from an uncommitted copy and was measured once. This branch's column is asserted by
`docs-own-tab.test.tsx` in both skins: no socket, and exactly one request, the Docs read, over the first 1.5 s.

## 5. The reader's terms

Kept, each measured by `git diff` against main `6c7f126d428de2f346f8d69188e24d46da833d4c`: `DocsScreen.tsx` untouched;
`DocsHead.tsx` changed by the agreed Back change and nothing else, two git hunks, 3 lines in and 2 out (the `navigate`
import swapped for `useFollowLink`'s; the Back button taking the hook and its handler calling it), on the reader's owner's
yes to that exact diff; the link back in the frame's tab bar, outside the reader's head; no `popstate` listener added (the
router's `useLocation` listener is the existing one); the frame's sandbox, the frame policy, the library bridge, export,
share and the server's Docs routes untouched. What Back does now: at the Docs index in a Docs tab at a desk it opens the
console in a new tab and the tab stays a Docs tab; below the index it moves up within the tab, as before; in the console,
and in a Docs tab below the desk width, Back at the index moves to the fleet in place, as before (all four measured in
`docs-own-tab.test.tsx`). A Docs tab's first history entry is the document.

## 6. Real Chrome (the browser leg, `pwa/browser/docs-own-tab.browser.test.ts`)

Measured, and asserted as stated, at 1280 x 800, Refined and Instrument alike: no `.shell-nav`, no `.shell-accounts`, no
Primary navigation; the detail pane's left edge 0 and its width 1280, the viewport's; the Docs screen's left edge 0;
sideways scroll 0; title `<file> · demo · Docs · ccrc`. From the skip link, Tab reaches the link back, `:focus-visible`, a
2 px solid outline, 44 px tall, named "Console, opens in a new tab", `href="/"`, `target="_blank"`. Resized to 640 and back
to 1280, in both skins: still a Docs tab, the same reader element, no phone bar or nav column, no socket opened, sideways
scroll 0, the title kept. A Docs address loaded first at 390 x 844, in both skins: a Docs tab, no tab bar and no phone bar,
the Docs screen's top 0, no link back drawn, no socket, sideways scroll 0, the document's title; at the index, the reader's
Back moves the tab to `/fleet` in place, the console from then on, and opens no tab (fix round 3). In-app navigation from the fleet to the same address at 390 x 844, in both skins: no tab bar, no link back, the
Docs screen inside the console drawn 390 px wide, exactly one fleet socket (so the counter the Docs tab cases read as 0
counts), sideways scroll 0, title `ccrc`. A tab opened from the console at 1280, by the bar's Docs place (a plain new-tab
anchor) and by the palette's "Go to Docs" (`useFollowLink`): the console had marked its own tab; the new tab is a Docs tab
at `/docs`, with no opener and no copy of the mark, and the console stays at `/fleet`.

Fix round 3, the Docs tab's own cases in the files that measure the console (the queue's run found them, section 8):

- `docs-compact-head`: at 412 x 915, in both skins, a Docs tab draws the one bar with nothing above the Docs screen, the
  frame's top 48 and the title 56 px down (the bounds are 48 and 61). Given the console's room at 1280 x 800 (the
  console's pane 940 px in Instrument, 960 in Refined, its head row 924 and 944), a Docs tab's row is the same width to the
  pixel and draws the console's row: words hidden, every crumb, the whole name, one line. At 1280 x 800 a Docs tab's bar is
  53 px, the head starts at 61 and runs 8 to 1272, the pane is the window's width, and the row is one line with the whole
  name, every crumb and, having the room, the action words; under a coarse pointer every control is a tap wide and tall.
  The title at 1280 on a short name: 250 px down in a Docs tab, 310 (Instrument) and 306 (Refined) in the console.
- `reader-frame`: in a Docs tab too, the reader fills its pane and only the frame scrolls, at 1280 x 800 and 390 x 844;
  desk-born at 900 x 800 (both skins, 5 and 7 directories), back keeps the focus the page's reader gave it and the next
  Tab stop is the first crumb, seen whole; phone-born, the same back element holds the focus across the swap to the one
  bar.
- `phone-bar`: at 360 and 390, in both skins, a Docs tab places no bar of any kind, its Docs screen's top is 0, and nothing
  scrolls sideways.
- `chat-links`: at 1280 a document path in the chat opens one new tab, a Docs tab at the document and the session's branch,
  with no opener, and the chat stays on the session; at 390 it moves in place and opens none.

## 7. Guards and their mutants

Each mutant measured red by this wave (a scratch driver that edits one committed file, runs the suite, restores it):
the Docs tab branch in `App`, the frame's no-parts and no-frame-class, the gated fleet connect, Overlord start and session
preload, the title effect and its restore, the sign-in and block screens in the branch, the context's `true`, the rule's
desk test, its crossing test, its path cut, its in-app refusal, the router's `followLink`, as it stood then (since
replaced by `useFollowLink`), opening its new tab and reading its tab kind; on the callers'
side, `useTabLink` never opening a tab, `PlaceDoor` always a button, the command layer and the fallback moving in-app, and
the sheet row and the menu item not closing what they sit in (all red in `docs-tab-links.test.tsx`). One survivor, a
refusal in `isDocsHref` that the route's pattern already made, was removed rather than kept as dead code.

Fix round 1, twelve more, each killed: `isDocsTab`'s `desk ||`, its `docsOnly` arm and its `isDocsHref` test;
`keepsDocsOnly`'s fold; `App`'s fall of `docsOnly`; the `disconnect()` when a tab becomes a Docs tab; the push worker's
`onDocs` skip; the full `rel`; `useFollowLink`'s tab kind; the link back's name only where it opens a tab; the fallback's
Docs tab arm; the menu item's command opening the tab. (Round 1's width arm, its fold and its `disconnect()` were removed
by round 2.)

Fix round 2, eight more, each killed: `isDocsTab`'s history test; `App` reading the mark at its start, writing it for a
console, and its fall; putting a width arm back into `App`'s answer; the mark's value; a flag on the push worker's copied
pattern; and, in Chrome, keeping the mark in the device's storage instead of the tab's (the two opened-tab cases red).

Fix round 3, two more, each run red: the frame drawing the tab bar at every width (in jsdom the two phone-first cases
named; in Chrome the `phone-bar` and `docs-compact-head` Docs tab cases) and the harness's console mark not set (the
`phone-bar` console cases). The Chrome runs were read by the runner's exit code only: a hook refused the edit that would
have printed their failing case names, and it was not retried another way.

## 8. The first full run, and what it found

The first full run of the pwa suite after the build was red: 5 of 610 files, each a guard the change tripped, none a
load flake. Fixed in the same push:

- `design-system-boundary` and `ui-package-boundary`: the link back wore `TEXT_LINK` without `<TextLink>`; it became a
  `TextLink` then, and is the standalone ghost-button anchor (`ConsoleLink`) since fix round 1 (review 3644 A3).
- `hook-class-collision`: `ins-door` (the Docs door's anchor beside `<Door>`) and `menu-item` (the Docs item's anchor beside
  `<ListRow>`) are each one role drawn by two elements; both are registered in its `ONE_ROLE` table with the reason.
- `session-flows`: every menu item must run its registry command on a click; the Docs item had stopped doing so, and now
  does (above).
- `fleet-characterization`: the desk picture's Docs door name is now "Docs, opens in a new tab", by intent.

The browser bars (`refined-bar`, `instrument-bar`, `instrument-desk`, `phone-bar`) were run alone; `instrument-bar`'s touch
floor counted only buttons and now counts the Docs link too (57 of 57 green after).

**The merge queue's run (fix round 3).** The pull request's fast run did not run the browser files, and the queue's did:
20 cases red in four files that loaded a Docs address first and read the console around it (`docs-compact-head` 6,
`phone-bar` 8, `reader-frame` 5, `chat-links` 1). Measured on the tip, each was one of two things. Most read the console
in what is now a Docs tab: the harness's `openApp` gained `tab: 'console'`, which sets the tab's console mark before every
load, as a console tab's reload has it, and each file's opener asks for it, so every one of those cases runs inside the
console and asserts what it asserted, unchanged. Two were real costs of a Docs tab: on a phone the bar above the head broke
the one bar's bounds (section 3, now no bar on a phone), and at a desk the head has more room than in the console
(section 3, the same rule given more room). The chat link at a desk now opens a Docs tab, and its case follows that tab.
The two files the Docs reader's wave C worker holds were changed by the exact diffs that worker said yes to, against main
7e1f9752fe.

## 9. Unmeasured, and known limits

- **The block screen in a Docs tab**: it is mounted and draws when the fleet store says `blocked` (measured), but nothing in
  a Docs tab sets it, because the fleet protocol's `hello` arrives only on the fleet stream, which a Docs tab does not open.
  A stale build in a Docs tab is still caught by the service worker's update check (inferred from `main.tsx`).
- **A pop-up blocker** may refuse `useFollowLink`'s `window.open` when it runs without a user gesture; every caller today runs
  it from a click or a key (inferred, not measured in a browser). Its answer is not read: with `noopener` it is always
  `null`, so a refusal shows only as the browser's own notice (review 3644 A12).
- **The control census** registers an anchor only when it spells `href` or `onClick` as attributes, so the anchors whose
  props are spread (`ConsoleLink`, `PlaceDoor`'s anchor) are outside it; their floors come from their patterns
  (`GHOST_ANCHOR`'s and `DOOR`'s `min-h-tap`) and the link back's is measured in the browser leg (44 px at both widths). The
  two that are inside it (the sheet's row, the menu's item) are registered under VARIANT, the arm now reading `LIST_ROW`'s
  class string for the list-row anchor (no category covered one). The census file was another worker's claim (6821); the
  edit was made on that worker's yes and the coordinator's ruling to keep the anchors.
- **A console narrower than the desk width** still opens documents in the app, as a phone does.
- **The link back opens another console tab on every click.** A second console costs its own fleet stream and polls; it
  doubles no sound or notification (by reading: `pwa/src` shows no notification or plays no sound outside the reader lab,
  and push comes from the one service worker).
- **An installed standalone app at a desk** with a Docs tab is unmeasured: the browser leg runs in an ordinary tab, and a
  plain click on a same-scope `target="_blank"` link in a standalone window was not tried.
- **Titles begin with the file's date** for specs and plans, whose names start `YYYY-MM-DD-`; two tabs on the same document
  at different refs carry the same title.
- **A Docs tab below the desk width moves in place** (review 3666 R3): there the reader's Back at the index and the
  failed-render link move the tab to the console, because the width cannot tell a half-width window from a phone; the tab
  is the console from then on.
- **A Docs tab below the desk width draws no link back** (fix round 3): from a leaf the way to the console is the reader's
  Back, once per level up to the index and once more there.
- **The push worker judges a window by its address** (R5): a phone console showing a document in the app is passed over,
  and a tap opens a new window where main moved that console to the session. Unmeasured in an installed phone app.
- **A Docs address typed or pasted into a tab that has been the console** shows the document inside the console, since
  the tab's mark says it has been the console.
- **The mark is the tab's session storage.** Chrome gives a tab opened with no opener no copy of it (measured); a browser
  that copied it would open a console's Docs link as the console. "Duplicate tab" copies it, so a duplicated console stays
  the console (inferred).
- **The push worker's Docs pattern** is a copy of the route table's, because the worker is plain JS outside the bundle;
  `push-sw.test.ts` fails when the two differ.
- **A4** (review 3644): the actions sheet's Docs row closes the sheet on every click, a modified one included (a ctrl-click
  closes the sheet while a background tab opens); the menu's Docs item is an anchor, so Space does not activate it, the only
  item of that menu that behaves so. Both are ordinary link behaviour.
- **A10**: `PlaceDoor`'s anchor re-spells `Door`'s glyph-drawn expression (`ui/src/primitives/door.tsx`), the one structural
  copy left; a small predicate exported from `@ccrc/ui` would remove it.
- **A11**: the fleet characterisation's one intended label change (the Docs door's name) landed inside the first round's fix
  commit rather than a commit of its own, and the first round's commits left five guards red between them; this round does
  not touch that file.
- **A12**: as the pop-up blocker line above.
