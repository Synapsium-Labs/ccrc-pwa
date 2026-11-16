# Accessible names hold the visible label (WCAG 2.5.3), on the latest axe-core

**Goal:** storybook-a11y passes on the latest axe-core (4.14.0) in both skins, with no `overrides` pin and no rule turned off (GitHub #1651). axe-core 4.14 adds `label-content-name-mismatch`: an element named by `aria-label` or `aria-labelledby` must hold its visible text, word for word, as one unbroken run of its name. On `main` with 4.14 the job fails 19 of 243 stories in each skin. These are real defects: a voice-control user says the words they see, and when the name does not hold those words, the command finds nothing.

**Decision:**

- **D-7897 (2026-11-03)** — Accessible names contain the visible label, word for word (WCAG 2.5.3). A control named by `aria-label` or `aria-labelledby` holds every word it shows, in order and unbroken. A shortened legend leads its name, and the full word follows in parentheses (`Esc (Escape)`, `PgUp (Page up)`). A word door leads with its word (`Account — your sign-in and accounts`, like `Settings — updates and notifications`). Adjacent spans that a flex or grid container draws apart get a whitespace-only text node between them, which the container never draws, so their text never runs together into one word (`Working2`). A row of data cells (WorkbenchAccountRow) is named by its own content: the cells it shows, in order, with the joining words in screen-reader-only text. Its reset cells are `aria-hidden`, and their words go in that text, because the narrow tiers hide those cells. The visible copy does not change.

**Before this change (axe-core 4.14.0, both skins, the same 19 stories):**

| Story | What it showed | Its name |
|---|---|---|
| Keycap › OnTheWell | `esc`, `^C`, `hist` | `Escape`, `Interrupt`, `History` |
| WorkbenchTerminal › PhoneKeys, PhoneCtrlLatched | `esc`, `PgUp`, `PgDn` | `Escape`, `Page up`, `Page down` |
| Door › Account, InAHeaderGroup | `Account` | `Your sign-in and accounts` |
| WorkbenchSidebar › Projects, CoordinatorFolded, LongNames, WithAccountFoot, Status | `project-a` `pool-a` `2 waiting` `6`, drawn as `project-apool-a2 waiting6` | `project-a 2 waiting6 total`, without the pool |
| WorkbenchAccountRow › Default, NeverMeasured, MeasuredZero, RolledOver, Off, OverCeiling, Column336, Column260 (and the sidebar's foot) | `lane-a 22% ↻ 2h 10m 41% ↻ 3d 4h` | an `aria-label` sentence that cannot hold those cells as one run |
| CommandPalette › LabelledOptions | `lead` `coordinator · project-a`, drawn as `leadcoordinator · project-a` | `lead, coordinator, project-a` |

**Change:**

- `ui/package-lock.json`: axe-core 4.13.0 → 4.14.0, the latest release. `ui/package.json` gets no `overrides`.
- `pwa/src/session/keyBar.ts`: `KEY_CAP`'s `esc`, `pgUp` and `pgDn` names lead with their legends.
- `pwa/src/fleet/FleetHead.tsx`: the Account door's name leads with `Account`.
- `ui/src/components/workbench-sidebar.tsx`: a section head is named by its whole title (the pool chip included) and its counts, with a word gap between spans.
- `ui/src/components/workbench-account-row.tsx`: a row is named by its content, as D-7897 describes. The name is the same sentence the `aria-label` held.
- `ui/src/primitives/command-palette.tsx`: a word gap between an option's title, its group and its key hint.
- Stories: Keycap, WorkbenchTerminal and Door use names that hold their legends, matching the app.

**Tests:**

- New: `pwa/test/labelInName.ts` (the rule as axe-core 4.14 words it, for the jsdom suites that cannot run axe) and `pwa/test/label-in-name.test.ts` (the rule's own cases, and every `KEY_CAP` row held to it).
- Extended: `workbench-sidebar.test.tsx` (each head's exact name and label-in-name, in both modes), `workbench-account-row.test.tsx` (no `aria-label`, the exact names, and every shown word in order in the name), `command-layer.test.tsx` (a session option's shown text in its name), `auth-door.test.tsx` (the door's word in its name).
- Queries changed to the new names, each with a one-line reason: `auth-door`, `terminal`, `terminal-scrollback`, `instrument-shell` (the door census), and `older-server-render`. That last one declares the door's new name as its second named difference from the base's markup. No query is loosened.
- Every new assertion was run red against the unchanged components before the fix.

**Known follow-ups (pwa-only; no story renders them, so storybook-a11y does not measure them):** the drawer's `ctrl` latch (named `Control`), its `send ^C` confirm (`Send Control C`), its `hist` door (`Scroll back`), the session header's `esc` stop cap (`Stop`), and the Instrument status bar's `⌘K` cap (`Open the command palette`) each show words that their names do not hold.
