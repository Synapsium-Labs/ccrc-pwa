# Accessible names hold the visible label: the five controls no story measures (WCAG 2.5.3)

**Goal:** the five follow-ups D-7897 left (GitHub #2362; `2026-11-03-label-in-name.md`, "Known follow-ups") hold
their visible label in their accessible name, and each stays measured. No Storybook story renders them, so
storybook-a11y never measured them.

**Decision:**

- **D-8383 (2026-11-12)** — The five unmeasured controls lead their names with the words they show, as D-7897's
  shortened legends do, and a jsdom case measures each one with `labelInName`. The drawer's `ctrl` latch is
  `Ctrl (Control)`, its `send ^C` and `send ^D` confirms are `Send ^C (Control C)` and `Send ^D (Control D)`, its
  `hist` door is `Hist (Scroll back)` (the way back, `live`, stays `Back to live`), the session header's `esc` stop cap
  is `Esc (Stop)`, and the Instrument status bar's `⌘K` cap is `Command K (Open the command palette)`. The old name
  follows in parentheses, so a screen reader still hears what the control does. The visible copy and the layout do
  not change.

**Measured on `main` before the change (all five still wrong; none was already right):**

| Control | What it shows | Its name on `main` | axe-core 4.14 `label-content-name-mismatch` |
|---|---|---|---|
| Drawer `ctrl` latch | `ctrl` | `Control` | fails |
| Drawer `send ^C` confirm | `send ^C` | `Send Control C` | fails |
| Drawer `hist` door | `hist` | `Scroll back` | fails |
| Session header `esc` stop cap | `esc` | `Stop` | fails |
| Instrument status bar `⌘K` cap | the command icon, `K` | `Open the command palette` | inapplicable (its only visible text is one letter) |

The axe column was read in a real Chrome over the production build, by running axe-core 4.14.0 with that one rule
on each control, first with its new name and then with the old name set back on the same element. Every new name
passes, or is inapplicable for the `⌘K` cap. `labelInName` is stricter than axe for one letter and counts `K`; the
cap is fixed too, because a voice user says "Command K".

**Change:**

- `pwa/src/session/KeyBarView.tsx`: the `ctrl` latch's name and the confirm's send name.
- `pwa/src/session/TerminalDrawer.tsx`: the history door's name from live.
- `pwa/src/session/SessionHeader.tsx`: the stop cap's name.
- `pwa/src/skins/instrument/StatusBar.tsx`: the `⌘K` cap's name.

**Tests:**

- `pwa/test/labelInName.ts` gains `namesWithoutTheirLabel(root)`: the same rule run over every aria-labelled button in
  a region.
- New cases, each run red against the unchanged components first: `drawer-keybar.test.tsx` (every cap in the wrapped
  bar with its row open, and both confirms), `terminal-scrollback.test.tsx` (the real door, both ways),
  `header.test.tsx` (the stop cap, and every named control in the header), `instrument-shell.test.tsx` (the status
  bar's keys).
- Queries that asked for an old name now ask for the new one: `drawer-keybar`, `drawer-paste`, `drawer-view`,
  `terminal-scrollback`, `console-window-fit`, `console-window-fit-xterm`, `header`, `session-header-view`,
  `refined-session` and `session-screen-refusals`. The composer's `Stop` slot keeps its name, so `stop-slot` and
  the header suite's slot cases are unchanged. No query is loosened.

**Widths (accessible names only):** at 390, 1280 and 1920, in both skins, each control's border box and its pixels
were the same with the old name and with the new one. The esc stop cap is drawn only by Instrument's header and only
under a touch pointer. The `⌘K` cap is drawn only on Instrument's desk widths. The `ctrl` latch is drawn only in the
drawer's wrapped view, which is not used at 1920.

## Deviations found

- The `⌘K` cap was not a violation in axe-core 4.14's own terms (inapplicable, one visible letter); it was fixed
  anyway, as the task and `labelInName` count it.
- The history door's way back (`live` in `Back to live`) already held its label and is unchanged.
