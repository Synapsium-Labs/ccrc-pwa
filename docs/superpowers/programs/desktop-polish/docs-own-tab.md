# Wave 174: a document in its own tab (desktop polish run 3633)

The note for wave 174, written by its worker for the coordinator to fold into the ledger. The operator's goal of
2026-11-24: opening a document from the console "takes me completely away from the session"; they want "a webpage with a
dedicated view" for the reader only, without the left side panel, "so that I can have many open at a time". Each claim
says whether it was **measured** (read on the tree, in a browser or in a test run by this wave) or **inferred**.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| The one rule, `opensNewTab(href, desk, docsTab)`: at a desk, an in-app link that crosses between the console and the Docs reader opens a new browser tab; a link within its kind of tab moves in the tab; below the desk width nothing crosses. With it `isDocsHref`, `isDocsTab`, `docsTabTitle`, `CONSOLE_PATH` and `NEW_TAB_WORDS` | `pwa/src/lib/docTab.ts` (L1, pure) | Measured: `docs-tab-rule.test.ts` |
| An anchor's props by the rule: `useTabLink()` answers `href => props`, a new-tab anchor (`target="_blank"`, `rel="noopener"`, no click handler, so the browser opens one tab per click) or the in-app click (`inAppClick`) as before. `DocsTabContext` says whether the tree is a Docs tab | `pwa/src/lib/useTabLink.ts` (L4) | Measured: `docs-tab-links.test.tsx` |
| A move by the rule for a control that is not an anchor: `followLink(href)`, a new tab (`window.open(href, '_blank', 'noopener')`) where the rule says so, else `navigate(href)`. `navigate` itself is unchanged | `pwa/src/lib/router.ts` | Measured: `docs-tab-rule.test.ts` |
| The frame's reader-alone mode: `ShellFrame`'s `alone` draws the skip link, a `<header class="shell-tab-bar">` holding the given node, and the same keyed `<main id="content">`, with no part of the skin set (no bar, accounts strip, banners, fleet column, inspector, status bar or phone navigation) and no skin frame class; `data-tab="docs"` selects a one-column desk grid | `pwa/src/skins/frame.tsx`, `pwa/src/styles/shell.css` (its last block) | Measured: `docs-own-tab.test.tsx`, `docs-own-tab.browser.test.ts` |
| The Docs tab in `App`: `isDocsTab(path, useDesk())` picks a second tree with the sign-in and block screens and the frame in its `alone` mode, the link back (`ConsoleLink`) in its bar, the reader in the detail; the fleet stream, the Overlord poll and the session-screen preload are gated off; the title effect | `pwa/src/app.tsx` | Measured: the same two suites |
| A place's door in a desk bar: `PlaceDoor`, the "Go to" command door, or, where the rule opens a new tab (the Docs place), an anchor wearing the door's own classes (`DOOR`, `DOOR_GLYPH`) | `pwa/src/skins/DoorLink.tsx`, used by Refined's `AppBar` and Instrument's `TopBar` | Measured: `docs-tab-links.test.tsx` |

No server, wire or shared change; no new route (a document's address is what it was); `DocsHead.tsx` and
`DocsScreen.tsx` are untouched (measured: `git diff origin/HEAD --stat`).

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
| The session menu's Docs item (`sessionMenu.ts`'s entry, drawn by `SessionFlows`) | an anchor wearing `LIST_ROW` (was a `ListRow` button) with `useTabLink`'s props, so middle click and copy link work; a plain click runs its registry command, `session-docs`, as every item of the menu does, which closes the menu and runs `followLink` (the palette's "Open this session's docs" runs the same one) | menu cases, and `session-docs-link.test.tsx` updated |
| The top bar's Docs place, both skins | `PlaceDoor`: an anchor at a desk | PlaceDoor and the two App bar cases |
| The command palette, the bar doors' commands and the global keys ("Go to Docs", `g` keys) | `CommandLayer`'s `navigate` is `followLink` | the palette case |
| The detail fallback's "Back to the fleet" | `followLink`: in a Docs tab it opens the console in a new tab | ScreenFallback cases |
| The phone's bottom bar Docs door | left: a phone width, which the rule never crosses | `docs-own-tab.test.tsx`'s phone cases |
| Every link inside the reader (crumbs, rows, the reader's own links, history, export) | left: Docs to Docs, which moves within the Docs tab as before | `docs-tab-rule.test.ts` (a Docs tab's document link stays) |
| Instrument's and Refined's other places, every console-to-console link | unchanged | PlaceDoor `runs` case |

`TextLink` (`@ccrc/ui`) already carried `target="_blank"` with an in-app click on every in-app use, so a middle click on
those links opened a tab before this wave too (measured: `text-link.tsx`); only a plain click changes, at a desk.

## 3. Choices the brief left to the wave

- **A link from a Docs tab to a console page** (brief item 3): the rule is symmetric. A Docs tab never draws the console:
  a console page opens in a new tab (the link back, and `followLink` for the fallback's button); a document moves within
  the tab. Nothing inside the reader links to a console page today (measured: every `navigate` under `pwa/src/docs` and
  `DocsScreen.tsx` names a Docs page, and `docLinkTarget`'s in-app kind is always a Docs address), so the rule's other arm
  serves the link back and the fallback. Slug `docs-tab-rule-is-symmetric`.
- **The link back** opens the console at its root (`CONSOLE_PATH`, the route table's home row) in a new tab, named
  "Console, opens in a new tab", in the tab bar above the reader, outside `DocsHead.tsx`. Its name is spelled whole in
  `aria-label`: a visually hidden span put a space before the comma in Chrome's computed name (measured, in the browser
  leg). Slug `link-back-new-tab-at-root`.
- **The width rule** (brief item 5): the shell's own desk test, `DESK_QUERY` (`(min-width: 900px)`), defined once in
  `ui/src/lib/use-media-query.ts` and re-exported by `pwa/src/lib/useMediaQuery.ts`. `App` reads it with `useDesk()`,
  `useTabLink` with `useDesk()`, `followLink` with `matchMedia(DESK_QUERY)` at the moment of the move. No second
  breakpoint. It is asked live: a Docs tab narrowed below 900 becomes the console (its tree is the console's, so the
  reader mounts again there, and the fleet stream connects). Slug `docs-tab-width-is-live`.
- **`navigate` is unchanged; `followLink` is new.** Putting the rule inside `navigate` would also have changed every test
  and caller that uses `navigate` to set the address at a desk (the Instrument route walk goes through `/docs`), and the
  reader's own moves; a separate door for the controls that are not anchors keeps the change where the links are. Slug
  `follow-link-beside-navigate`.
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

## 5. The reader's terms

Kept, each measured by `git diff origin/HEAD --stat`: `DocsHead.tsx` and `DocsScreen.tsx` untouched; the link back is in
the frame's tab bar; no `popstate` listener added (the router's `useLocation` listener is the existing one); the frame's
sandbox, the frame policy, the library bridge, export, share and the server's Docs routes untouched. A Docs tab's first
history entry is the document, so the reader's Back behaves as it does on a pasted address today (inferred: no history
code changed).

## 6. Real Chrome (the browser leg, `pwa/browser/docs-own-tab.browser.test.ts`)

Measured at 1280 x 800, Refined and Instrument alike: no `.shell-nav`, no `.shell-accounts`, no Primary navigation; the
detail pane's left edge at 0 and its width 1280 (the viewport); the Docs screen's left edge 0; sideways scroll 0; title
`<file> · demo · Docs · ccrc`. From the skip link, Tab reaches the link back, `:focus-visible`, a 2 px solid outline, 44 px
tall, named "Console, opens in a new tab", `href="/"`, `target="_blank"`. At 390 x 844 in both skins: no tab bar, no link
back, the Docs screen inside the console, sideways scroll 0, title `ccrc`.

## 7. Guards and their mutants

Each mutant measured red by this wave (a scratch driver that edits one committed file, runs the suite, restores it):
the Docs tab branch in `App`, the frame's no-parts and no-frame-class, the gated fleet connect, Overlord start and session
preload, the title effect and its restore, the sign-in and block screens in the branch, the context's `true`, the rule's
desk test, its crossing test, its path cut, its in-app refusal, `followLink`'s new tab and its tab kind; on the callers'
side, `useTabLink` never opening a tab, `PlaceDoor` always a button, the command layer and the fallback moving in-app, and
the sheet row and the menu item not closing what they sit in (all red in `docs-tab-links.test.tsx`). One survivor, a
refusal in `isDocsHref` that the route's pattern already made, was removed rather than kept as dead code.

## 8. The first full run, and what it found

The first full run of the pwa suite after the build was red: 5 of 610 files, each a guard the change tripped, none a
load flake. Fixed in the same push:

- `design-system-boundary` and `ui-package-boundary`: the link back wore `TEXT_LINK` without `<TextLink>`; it is a
  `TextLink` now.
- `hook-class-collision`: `ins-door` (the Docs door's anchor beside `<Door>`) and `menu-item` (the Docs item's anchor beside
  `<ListRow>`) are each one role drawn by two elements; both are registered in its `ONE_ROLE` table with the reason.
- `session-flows`: every menu item must run its registry command on a click; the Docs item had stopped doing so, and now
  does (above).
- `fleet-characterization`: the desk picture's Docs door name is now "Docs, opens in a new tab", by intent.

The browser bars (`refined-bar`, `instrument-bar`, `instrument-desk`, `phone-bar`) were run alone; `instrument-bar`'s touch
floor counted only buttons and now counts the Docs link too (57 of 57 green after).

## 9. Unmeasured, and known limits

- **The block screen in a Docs tab**: it is mounted and draws when the fleet store says `blocked` (measured), but nothing in
  a Docs tab sets it, because the fleet protocol's `hello` arrives only on the fleet stream, which a Docs tab does not open.
  A stale build in a Docs tab is still caught by the service worker's update check (inferred from `main.tsx`).
- **A pop-up blocker** may refuse `followLink`'s `window.open` when it runs without a user gesture; every caller today runs it
  from a click or a key (inferred, not measured in a browser).
- **The control census** registers an anchor only when it spells `href` or `onClick` as attributes, so the two anchors whose
  props are spread (`ConsoleLink`, `PlaceDoor`'s anchor) are outside it; their floors are measured in the browser leg (the
  link back, 44 px) and by `DOOR`'s `min-h-tap` (inferred). The two that are inside it (the sheet's row, the menu's item) are
  registered under VARIANT, the arm now reading `LIST_ROW`'s class string for the list-row anchor (no category covered
  one). The census file was another worker's claim (6821); the edit was made on that worker's yes and the coordinator's
  ruling to keep the anchors.
- **A Docs tab narrowed below 900** remounts the reader (it becomes the console's tree); its scroll is not kept (inferred
  from the tree shape, not measured in a browser).
- Two tabs on the same document at different refs carry the same title.
