# The Sheet's desktop arm, and workflow controls on the session page (design)

**Status:** approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision. Rev 2 (two reviews applied; the plan's §Review log records each finding). Nothing in it is built yet. One question is left open for the operator (§7, O1). The design works without an answer to it.

**Date:** 2026-10-20 · **Base:** `origin/main` `643c76cd4` (#822); rev 0 and rev 1 were measured on `397be1ec5` (#735), and every anchor below was re-checked on the new base. Read-only. Nothing on any fleet or server box was touched or measured for this document. The Claude Code measurements §4.2 asks for are design inputs that a plan task records on a scratch machine.

**Issues:** #649 (sheets and dialogs: focus in on open and back on close, a pinned footer, and no drag handle on the centred desktop dialog, plus the reduced-motion comment on it) and #641 (workflow controls on the session page, like Claude Code's). #641 depends on #640, the read-only workflow rows, which landed as #652 (D-5560, D-5561).

**Plan:** `docs/superpowers/plans/2026-10-20-sheet-desktop-arm-and-session-workflow-controls-.md`, tasks P3-1 to P3-9 (P3-6 is split into P3-6a and P3-6b), which define D-5930 to D-5939.

**Related:**
- `2026-10-15-ccrc-two-skins-design.md`, §5.3 "Sheets and dialogs" and §10's W1 row: "`Sheet`'s desktop arm (sizes, centred at ≥900, `--elev-pop`, a `Popover` primitive), after the ask sheet half and drawer stage 1". Part A of this document is that "later plan".
- `2026-10-18-ccrc-skins-w2-shells.md`, Task S18 (Instrument `preview: false`, D-5479), which waited for this arm "unless the coordinator rules otherwise". This PR narrows that gate in the W2 plan itself to P3-4 (§2.7).
- `2026-10-17-coordinator-first-routing-design.md` and its classifier `server/src/coord/approvalguard.ts` (D-5299, D-5360).
- `2026-10-19-ccrc-consolidation-wave-design.md`, rev 2.1 on `main` (#819), approved by the operator on 2026-10-19. §5 fits this work into its contexts, kernels and waves.
- `2026-10-19-consolidation-w0-pins.md` (C0a's growth check over `server.ts` and `sessionws.ts`, the feed census) and `2026-10-19-consolidation-w1a-switches-notify.md` (C1c's `notify` funnel and `NoticeSink`, C1e's pinned feed writer set), which P3-8 lands beside (§5).
- `2026-08-10-architecture-ddd-clean-solid.md`, the rings.

## In short

- **Part A, the Sheet (#649).** One primitive, `ui/src/primitives/sheet.tsx`, drives 22 PWA sheets and `QuickConfirm`. It has five defects, all in that one file:
  - focus does not move in on open;
  - focus does not come back on close;
  - there is no footer slot, so action rows scroll away;
  - the grabber and drag are still there at ≥900;
  - under reduced motion it still plays vaul's 500 ms slide.

  The arm fixes all five in the primitive and adds the desktop arm the skins spec planned: centred at ≥900 in three sizes on `--elev-pop`, a ✕, no grabber and no drag. The two local copies of that work are deleted: `.whats-new-panel` in `fleet.css`, and the opener give-back in `useCancelFirst`. A `Popover` primitive lands with its first consumer in Part B.
- **Both gates have cleared.** The ask sheet half landed as #493 and drawer stage 1 as #428. Task 14b (#650), which waited on both, has landed too. No open PR edits `sheet.tsx`.
- **S18.** The flip waits only for the centred-dialog task (P3-4). The footer and the Popover do not gate it. If the coordinator rules the flip first, nothing here breaks, because the arm is chosen by width and never by skin.
- **Part B, workflow controls (#641).** The controls are offered only where a recorded capture shows how that Claude Code version does it (`WORKFLOW_CONTROLS`, keyed by version; a recipe is admitted only when it was recorded the same with and without `--remote-control`, so the server never needs to read a session's mode). Each one is driven through Claude Code's own mechanism with the keys path ccrc already has (`Tmux.sendKey`/`sendLiteral` inside the per-session `KeyedQueue`). No workflow file is ever written and no process is signalled. There is one new verb, `POST /api/sessions/:id/workflows/:runId/control`, and it is **operator-only** for three reasons:
  - the auth gate admits it only with a passkey session, because it is not in `EXEMPT`;
  - the approval classifier marks any Bash or MCP request whose text names it `forbidden`;
  - no `ccrc-api` verb composes it.

  Stopping a workflow or an agent is a danger confirm that says what is lost. Every failure is a typed refusal.

## 1. The problem, measured

### 1.1 The Sheet (`ui/src/primitives/sheet.tsx`, 181 lines at `397be1ec5`)

| # | Defect | Where |
|---|---|---|
| A1 | **Focus does not move in.** vaul's `autoFocus` defaults to false. A sheet opened with Enter leaves the focus on the opener behind the scrim, so the first Tab lands outside the sheet (#649). | `Drawer.Root` ≈:64 passes no `autoFocus`. The palette opts in on purpose (`command-palette.tsx` ≈:165, D-5457). |
| A2 | **Focus does not come back.** Radix gives the focus back only to its own `Dialog.Trigger`, which no sheet uses. The one fix today is local: `useCancelFirst` (`confirm.tsx` ≈:71, D-5507/D-5610) captures the opener and gives the focus back for `QuickConfirm` and its two callers. `UpdateMoveSheet.tsx` calls `useCancelFirst` itself (≈:284). `updateAck.ts`'s `AckConfirm` relies on its own effect running after that give-back (≈:147), so that the row, not the disabled Ack, ends with the focus. | `confirm.tsx` ≈:44–90 |
| A3 | **No footer.** The action row is the last child of the scrolling body (`.sheet-body` ≈:167–176), so it scrolls with the body. Six sheets end in a `QC_ACTIONS` row: `ArchiveConflictSheet`, `AbandonSheet`, `ArchiveSheet`, `WhatsNewSheet`, `UpdateMoveSheet` and `ResumeSheet`. `QuickConfirm` is a seventh. | `sheet.tsx` ≈:167 |
| A4 | **At ≥900 the panel is still a bottom drawer.** The grabber is drawn at ≥900 (≈:143–152), and the drag dismissal still works because `handleOnly` is set only for `full` (≈:75). The one centred dialog in the app is a local override, `.whats-new-panel` in `fleet.css` ≈:3240–3255, whose own comment says "until the Sheet primitive grows that arm itself". It needs an `!important` to remove vaul's unlayered `::after`. | `sheet.tsx`, `fleet.css` |
| A5 | **Reduced motion is ignored.** The panel retimes with `duration-sheet!`/`duration-slow!` (≈:109–110), which set `transition-duration`. vaul 1.1.2 animates with **keyframes** (`slideFromBottom`, 500 ms), so the tokens never reach it, and `tokens.css`'s reduced-motion `--dur-sheet: 1ms` (≈:1321) changes nothing. The palette had the same cause and fixed it locally with `PALETTE_MOTION` (`command-palette.tsx` ≈:109, D-5457). | `sheet.tsx` ≈:109 |

Other measured facts:
- **The 900 breakpoint.** `useMediaQuery('(min-width: 900px)')` is written three times (`pwa/src/app.tsx` ≈:85, `pwa/src/docs/DocsHead.tsx` ≈:226, `pwa/src/session/SessionDetails.tsx` ≈:79). The skins W3 plan adds a fourth in `pwa/src/skins/listColumn.ts`. The hook lives in `pwa/src/lib/useMediaQuery.ts`, which `ui/` may not import (`ui-package-boundary.test.ts`).
- **Elevation.** `--elev-pop` does not exist. Ten of the twelve palettes are generated: `ui/design/make-themes.mjs` ≈:633 writes their `--elev-sheet` into the block at `tokens.css` ≈:545–:1267, and `npm run themes:check` fails on a hand edit there. The two default palettes, dark `:root` and `[data-theme='light']`, are hand-written above that block and declare `--elev-sheet` by hand (≈:412, ≈:529). `theme.css` ≈:256 maps `--shadow-sheet`. Instrument replaces elevations only with `none` or a hairline (`skins.css` ≈:65).
- **Popover.** No popover exists in `ui/` or `pwa/`. vaul already brings in `@radix-ui/react-dialog`, `-dismissable-layer`, `-focus-scope`, `-portal` and `-presence` (`ui/package-lock.json`).

### 1.2 The session's workflows

- **The rows are read-only (#652).** `shared/workflows.ts` (`WorkflowView`, `WorkflowAgentView`) is read from Claude Code's own files by `server/src/workflows/read.ts`, which "writes, signals or starts" nothing. It is carried on the session socket's `workflows` frame (`shared/api.ts` ≈:4510, `sessionws.ts`) and drawn by `WorkflowStrip` (`ui/src/components/workflow-strip.tsx`, used at `SessionScreen.tsx` ≈:603).
- **Claude Code can stop a run.** Its summary carries a final `killed` status (`WorkflowState`, `model.ts` ≈:351), so a stop mechanism exists. How it is driven, and whether one agent can be stopped or skipped, is **unmeasured**. The reader's source was measured on 2.1.203–2.1.302 (`model.ts` ≈:5).
- **An agent has no id on the wire.** `WorkflowAgentView` carries `label`, `phase` and `state`. The server knows each agent's journal key (`foldJournal`), but the wire does not carry it. The reader already owns both identifier shapes: `RUN_ID_RE` (`^wf_[0-9a-f]{8}-[0-9a-f]{3}$`, exported) and the private `KEY_RE` (`^v\d+:[0-9a-f]{64}$`, 67 characters or more), both in `workflows/model.ts` ≈:32–35.
- **The rows are read incrementally, per connection.** `SessionWorkflows` (`read.ts` ≈:109) is created by each session socket (`sessionws.ts` ≈:571) and reads at most `JOURNAL_CHUNKS_PER_TICK` journal chunks and `AGENT_READS_PER_TICK` agent files per tick, so a new instance's first read can be partial. No one-shot read exists.
- **No server code reads a session's remote-control mode.** ccd decides it at spawn from the box's remote-control switch file, the backend, and the row's `rc=off` stamp. `git grep` finds none of those in `server/src` or `shared/`; `Proc` carries only live/startedAt and `FleetSession` has no mode field. The server's existing readers avoid the question on purpose: `interrupt` and `liveStatus` read the live status file because an RC pane never renders the busy marker (`inject/send.ts` ≈:1931, `fleet.ts` ≈:376).
- **The keys path.** `Tmux.sendKey`/`sendLiteral` (`server/src/exec.ts` ≈:310–315) are the only key writers. The agent's whitelist already grants `send-keys` (`agent/src/whitelist.ts` ≈:397). Every key-sending act runs inside `KeyedQueue.run(id, …)` (`inject/queue.ts`). The closest existing verb is `POST /api/sessions/:id/interrupt` (`server.ts` ≈:2574): a pure verdict (`interruptVerdict`, `inject/send.ts` ≈:1916), then one key, a typed refusal on 409, and a recorded source and outcome (`recordInterrupt`, D-5236, D-5237).
- **Who can call a route.** One `onRequest` gate (`server/src/auth/gate.ts`) stands in front of every route. Only routes named in `EXEMPT` (≈:210) take the box token that sessions hold. Any other route needs the operator's passkey session.
- **What a child can do.** `approvalClass` is default-escalate. `FORBIDDEN_PATTERNS` (≈:194) already forbids `tmux` and the approval surface. `CHILD_DENY_RULES` (`shared/api.ts` ≈:11225) denies the forbidden `ccd` verbs and `ccrc update|rollback` as Bash prefixes.
- **The session's version.** `FleetSession.version` (`shared/api.ts` ≈:101) comes from Claude Code's `<cfg>/sessions/<pid>.json` (`livestate.ts`). The binary-lifecycle W1 plan adds `FleetSession.claude.exe` as a cross-check.

## 2. Part A: the Sheet's desktop arm (#649)

### 2.1 Where the arm lives

| Option | Verdict |
|---|---|
| (a) One `Sheet`, one vaul `Root`. Layout comes from CSS at `min-[900px]`. One width reading (`useDesk()`) turns off the grabber and the drag and draws the ✕. | **Chosen.** Crossing 900 while a sheet is open keeps its content and state, because nothing remounts. One owner. |
| (b) A Radix `Dialog` at ≥900 and vaul below it, swapped by width. | Rejected. Resizing across 900 remounts the flow and loses its typed input. It would also be two containers for one job. |
| (c) Keep per-sheet overrides like `.whats-new-panel`. | Rejected. It is the parallel mechanism the architecture direction forbids, and it needs an `!important` per sheet. |

`useMediaQuery` **moves** into `ui/src/lib/use-media-query.ts` with one `DESK_QUERY = '(min-width: 900px)'`. `pwa/src/lib/useMediaQuery.ts` becomes a re-export, and `app.tsx`, `DocsHead.tsx` and `SessionDetails.tsx` read `DESK_QUERY`, so the breakpoint is written once. A test pins that no `(min-width: 900px)` literal exists in non-test source (`pwa/src/**/*.{ts,tsx}` and `ui/src/**/*.{ts,tsx}`) outside `ui/src/lib/use-media-query.ts`. Seven `pwa/test` files carry the literal because they parse CSS `@media` blocks, and they are out of its scope; skins W3's `listColumn.ts` imports `DESK_QUERY` (a Gates row tells that plan). The arm is chosen **by width, never by skin**, as the skins spec §5.3 says ("the container … is decided by `Sheet` from the width, not by the skin").

### 2.2 What the arm draws at ≥900

- **Placement:** centred (`inset: 0; margin: auto; height: fit-content`), at most `100dvh - 2 × --sp-8` tall, `--r-xl` on every corner. vaul's `::after` strip is removed in the primitive, which absorbs the precedent `fleet.css` set.
- **Sizes:** a `size` prop, `'sm' | 'md' | 'lg'` = 440 / 560 / 720 px, defaulting to `md`, each capped at `100vw - 2 × --sp-8`. `QuickConfirm` uses `sm` and `WhatsNewSheet` uses `lg` (it was `min(40rem, …)`). Every other sheet keeps the default.
- **Elevation:** `--elev-pop`, a centred, downward shadow. It is generated in `make-themes.mjs` beside `--elev-sheet` for the ten generated palettes, and written by hand beside `--elev-sheet` in the two hand-written default palettes. It is mapped to `--shadow-pop` in `theme.css`. Instrument replaces it with `0 0 0 1px var(--edge-strong)` in `skins.css`, which is the recipe its rule allows.
- **Chrome:** a ✕ close button at the top right (an `Icon` button, `aria-label="Close"`, at least 44 px on a coarse pointer). There is no grabber. The drag is off: `handleOnly` with no `Drawer.Handle` rendered, so vaul has nothing to drag. Escape, the scrim and the ✕ still close the dialog.
- **Motion:** a fade and a small rise, on the tokens (`--dur-base` in, `--dur-fast` out), in place of vaul's slide. vaul keeps running `slideFromBottom`/`slideToBottom` unless the name is replaced, so the arm declares two keyframes once, `sheet-pop-in` and `sheet-pop-out`, in `ui/src/styles/theme.css`, and `sheet.tsx` names them with literal `min-[900px]:data-[state=open]:[animation-name:sheet-pop-in]!` and `min-[900px]:data-[state=closed]:[animation-name:sheet-pop-out]!` classes. Their timing comes from §2.3's variables, so reduced motion reaches them too.
- **Not changed:** the `full` variant (the terminal drawer), which drawer stage 1 made work at every width, and the command palette, which is a top drawer of its own.

### 2.3 Motion (A5)

Tailwind v4 emits CSS only for class tokens written literally in the source (`@source '../**/*.{ts,tsx}'`), so the helper cannot build classes at runtime. `ui/src/lib/motion.ts` holds one literal class set, `VAUL_MOTION`, which retimes vaul's **keyframes** (`animation-duration`/`-timing-function`, with `!` to beat vaul's attribute selector) from four per-surface variables: `data-[state=open]:[animation-duration:var(--vaul-in-dur)]!`, `data-[state=open]:[animation-timing-function:var(--vaul-in-curve)]!`, and the closed pair on `--vaul-out-dur`/`--vaul-out-curve`. Each surface sets the four variables with literal classes, for example `[--vaul-in-dur:var(--dur-sheet)]`, also exported from `motion.ts` as `SHEET_MOTION_VARS` and `PALETTE_MOTION_VARS`. `PALETTE_MOTION` becomes `VAUL_MOTION` plus the palette's variables (`--dur-base`/`--dur-fast` on the swift curve), so its computed timing is unchanged. `Sheet` uses `--dur-sheet` with the spring to open and `--dur-slow` with the swift curve to close. A browser-leg test reads `getComputedStyle(panel).animationDuration` under `no-preference` and `reduce`, for the Sheet and the palette, because a jsdom check of class strings passes while no CSS exists. All of these are tokens, so `tokens.css`'s reduced-motion block (1 ms) and Instrument's 120 ms reach every vaul surface. Alternatives:
- a `useReducedMotion()` branch that turns animation off. Rejected: it is a second owner of the reduced-motion fact, which `tokens.css` already owns.
- leaving the palette's own copy. Rejected: two definitions of one fix.

### 2.4 Focus (A1, A2)

| Option | Verdict |
|---|---|
| (a) vaul `autoFocus` on every sheet | Rejected. Radix focuses the first focusable element, and in `NewSessionSheet` or `DialogSheet`'s free-text row that is an input, so a phone's keyboard rises unasked. The palette is the one surface that wants that. |
| (b) **The Sheet owns focus, on both of `useCancelFirst`'s measured paths.** A first open mounts the panel one pass after the opening commit (Radix's `Portal` waits for a layout effect of its own, and React flushes the opening commit's passive effects before that pass), so an effect keyed on `open` runs while the panel does not exist yet and `document.activeElement` is still the opener (`confirm.tsx` ≈:51–56, pinned by `quick-confirm-focus.test.tsx`). So: (1) the effect keyed on `open` reads the opener, and its cleanup gives the focus back; (2) a **callback ref** on `Drawer.Content` focuses `initialFocus.current` (child refs attach before the parent's, so the caller's ref is set), or else the panel itself (`tabIndex={-1}`, named by its title), when the panel mounts while open; (3) on a reopen during the close transition the panel is already mounted, so no ref fires, and the effect focuses the target itself after reading the opener. Every focus passes `preventScroll`. `onOpenAutoFocus` only calls `preventDefault`, which keeps Radix's default suppressed. Tab stays trapped (Radix's modal trap, pinned by a test). | **Chosen.** Focusing the panel moves the screen reader into the dialog and raises no keyboard, and the first Tab lands on the first control. This is #649's "or its title" arm. A sheet whose parent mounts it already open (`UpdateMoveSheet` ≈:286 unmounts its Sheet when closed) takes path (2) on every open. |
| (c) Each sheet focuses its own first control | Rejected. That is 22 owners. |

`useCancelFirst`'s give-back half moves into `Sheet`. What remains of it is the choice of Cancel as `initialFocus` for a danger confirm (D-5507), still with `preventScroll` (D-5610). It now returns a `RefObject<HTMLElement>`, which the Cancel button's `ref` and the Sheet's `initialFocus` both take; the Sheet's callback ref and its effect do the focusing, so `useCancelFirst` focuses nothing itself. `UpdateMoveSheet` passes it to its Sheet.

**The terminal drawer (`full`).** The Sheet focuses its panel on open like any other sheet, and xterm takes the focus itself when its socket opens (`TerminalDrawer.tsx` ≈:430, `term.focus()`), which is inside the panel and therefore inside the trap. The Sheet never moves the focus again while open, so it never pulls it back out of the terminal. `full` passes no `initialFocus`, because xterm's textarea does not exist until the terminal mounts. `AckConfirm`'s row focus keeps working because its effect is the parent's: React runs the Sheet's cleanup (the give-back) before the parent's effect, as it ran `useCancelFirst`'s.

**An opener that is a text field.** The ask sheet and the composer's draft-conflict sheet open on their own while the operator may be typing in the composer. The Sheet still takes the focus on open (a modal leaves nothing focused behind its scrim). On close it gives the focus back to a text field only on a fine pointer (`(pointer: fine)`), with `preventScroll`. On a coarse pointer it does not, so a phone keyboard never rises unasked; the draft is untouched, and one tap on the composer resumes typing. Its two documented paths are kept: a first open that mounts Cancel, and a reopen that reuses it (`quick-confirm-focus.test.tsx`). An opener that has left the document, or is disabled, is left alone, as today.

### 2.5 The footer (A3)

`Sheet` gains `footer?: ReactNode`, drawn after `.sheet-body` as a `flex-none` row with the body's side padding and the safe-area bottom, so it stays put while the body scrolls, **at every width**. The seven action rows move into it one consumer per commit. The `full` variant takes no footer.

### 2.6 Popover

A `Popover` primitive (`ui/src/primitives/popover.tsx`) on `@radix-ui/react-popover`:
- It shares Radix's dismissable layer, focus scope and portal, which are already in the tree through vaul.
- It draws on `--elev-pop` with `--bg-sheet`.
- Escape and an outside press close it, and focus returns to its trigger (Radix does this for a popover, because a popover has a real trigger).

The alternatives were hand-rolling the placement and dismissal, which would be a second dismissal mechanism beside Radix's, and deferring the primitive, which would leave the skins W1 row short. Its first consumer is Part B's per-agent menu at ≥900. Below 900 that menu is a `Sheet`.

### 2.7 S18 coordination

The W2 plan's S18 waits for "`Sheet`'s desktop arm (W1, unplanned)" unless the coordinator rules otherwise (D-5479). This design narrows that gate to **P3-4** (the centred dialog), which is what a desktop default actually shows. P3-3 (the footer) and P3-5 (the Popover) do not gate it. This PR applies the narrowed gate to the W2 plan itself (S18's Needs, its Gates row and the dependency line): #813, which held that file, merged before rev 2, and no open PR edits it now. D-5479's definition is not reworded, because "`Sheet`'s desktop arm" is still the gate; the W2 plan now names which task meets it. If the coordinator rules that the flip lands first, every sheet on an Instrument desktop is today's bottom drawer until P3-4 lands, and it is the same drawer Refined desktops already have.

## 3. What Part A must not break

- **The terminal drawer** keeps `handleOnly` with a real `Drawer.Handle`, `repositionInputs={false}` and its z-index arm (`sheet-handle-only.test.tsx`, `sheet-full-chrome.test.tsx`, `sheet-keyboard-once.test.tsx`).
- **The title inside the scroller** (≈:41–61), its 38vh cap, and the ring room (`sheet-ring-room.test.tsx`, D-5495) stay as they are.
- **Escape stays overridable** (`onEscapeKeyDown`, the drawer's terminal).
- **The frozen censuses** follow each change: `shape-census.test.ts`, `role-census.test.ts`, `contrast.test.ts`, `design-system-boundary.test.ts`, `ui-package-boundary.test.ts`, `primitives.test.tsx`, plus `control-census.test.ts` for the ✕. `audit.mjs` measures the new rules, and no colour is minted.
- **Phones** keep the bottom sheet, its spring under `no-preference`, and swipe-to-dismiss.

## 4. Part B: workflow controls (#641)

### 4.1 The rule that comes first

Nothing is built on a guess. Which controls exist, and how each is driven, is recorded **per Claude Code version** from a capture, and the server offers a control only for a version the table names. Every capture-dependent step in the plan is gated on that record (P3-6b).

### 4.2 How to measure it (P3-6b), on a scratch machine and never on a fleet box

1. **Machine.** A developer machine that runs no fleet. Each target Claude Code version is installed side by side, using the lifecycle's own `claude install <version>`, which needs no login. The run uses a throwaway `HOME` with its own login, and a private tmux socket (`tmux -L wfprobe`), so no real session, registry or socket is reachable. The target set is every version the fleet's `FleetSession.version` column showed on the day, read by the operator from the PWA or from `GET /api/fleet`. At most the newest three need recording, plus any older one still running.
2. **A workflow to drive.** A two-phase script with three agents, one of which sleeps long enough to be stopped mid-run. It is launched in the pane by prompt, so that it runs as the fleet's runs do.
   Each version is launched with the fleet's spawn argv in **both** modes, with `--remote-control` and without it. An RC pane renders differently (`inject/send.ts`'s interrupt notes that it never shows "esc to interrupt"), so every step below is recorded in both modes and the two records are compared. The table is keyed by **version only**: a recipe is admitted only when its view, keys, outcome and mid-turn behaviour were recorded the same in both modes. An act whose two records differ is not offered on that version. This keeps the server from needing a session's mode, which no server code reads and which only ccd decides (§1.2). Reading it would need a single source that ccd owns, such as a registry field ccd writes, and that is a spec revision with its own task, not a guess in TS.
3. **What is recorded, at each step, with `tmux capture-pane -e -p`:**
   - **(a)** The prompt and status line while the run is going, and any hint that names a workflow view or key.
   - **(b)** The slash-command menu after typing `/`, filtered for the words workflow, task, agent, background, stop and kill. Each candidate's help line is recorded.
   - **(c)** Whatever opens the run's view (a key named by (a), a command from (b), or neither). For that view, the record covers: its rows, the selection marker, the footer's key hints, how to move between runs and agents, and how it closes.
   - **(d)** For each candidate act (stop the run, stop one agent, skip one agent), the record covers:
     - the key or command;
     - any confirm Claude Code shows;
     - the pane afterwards;
     - the journal's last lines and the summary's `status`.

     These show what was lost: whether running agents are killed, whether done agents' results stay, and whether the run can be resumed.
   - **(e)** Whether the act works while a turn is running, and whether it disturbs the prompt box's draft.
   - **(e2)** For **every** key of a `view-keys` recipe, including the close key, its effect when pressed in the main view, idle and mid-turn. A key that does anything there is not inert.
   - **(e3)** Whether the act itself starts a main turn. Claude Code may report a stopped or finished background task to the model, so the live word may turn busy after the act key, before the close key.
   - **(f)** `claude --help` and the version's changelog lines for any non-interactive surface (a CLI flag, a background-task command). A surface found here is noted, and it is a spec revision, not a build input.
4. **The record.**
   - **Captures:** `server/test/fixtures/panes/workflow-view/<version>/*.txt`. These are the K8 corpus's location, with fixture names only and run ids rewritten to `wf_fixture…`.
   - **Write-up:** `docs/superpowers/research/2026-10-workflow-controls-capture.md`, a table of version × act → drive, confirm, outcome and "works mid-turn".
   - **Table:** `WORKFLOW_CONTROLS` in `server/src/workflows/controls.ts`, written by hand from that table and held equal to the captures by a test that replays each capture through the reader (§4.4). It is server-only knowledge, so it does not ship in the PWA bundle.
5. **Refresh.** The table is keyed by exact version, and the reader was measured across 2.1.203–2.1.302, so versions move fast. A fleet session on a version with no row is offered no control, and the PWA says why (`not-offered`, "not yet recorded for this Claude Code version"). The operator's coordinator owns re-recording: the trigger is that reason showing for a version the fleet runs. A recorded row never covers a later version on its own; a later version gets its own row, after the replay test passes on its own captures.

### 4.3 The controls, and how each is driven

The candidate acts are the three #641 names: `stop-run`, `stop-agent` and `skip-agent`. A version gets an act only if (d) recorded it working. Each act has one **drive** kind, and it is one of the two that the keys path can do:

| Drive | Shape | Chosen when |
|---|---|---|
| `command` | type a slash command that names the run or agent **by id or label**, then Enter. Uses `sendLiteral` and `sendKey('Enter')`, with `submitEnter`'s `expect` discipline. The typed text is composed only from validated tokens (see below). | (b) recorded an addressable command. **Preferred**, because it addresses the target by name, not by cursor position. |
| `view-keys` | open the view, move the selection to the target row (verified against the pane after **every** key), press the act's key, then close the view with its own close key | (c) recorded only the view |

**What may be typed.** An agent label is a raw string written by a script or a model (the journal `label`, or the meta file's `description`), with no charset or length check. The command text is composed only from validated tokens, checked with the reader's own patterns, so no second definition of either identifier exists:
- the run id, matching `workflows/model.ts`'s `RUN_ID_RE`;
- the agent key, matching `workflows/model.ts`'s `KEY_RE`, which this work exports beside `RUN_ID_RE`;
- a label, only when it is printable with no control character (no `\n`, `\r`, ESC or other C0/C1 character) and at most 64 characters.

Anything else is `not-offered` on the frame and `agent-ambiguous` at the route.

**Fresh rows.** The route matches `:runId` and `agentKey` against rows read for this request, through one bounded one-shot read that `read.ts` gains, `readRunOnce(io, dir, runId)`. It reads one run's summary, journal and agent labels to the end within a byte budget, and answers `undecided` when the budget runs out first. An undecided read is the refusal `rows-unread`, with zero keys sent. The executor confirms an outcome only through that read (a later `readRunOnce` showing the run or agent stopped) or through the pane reader (the outcome line the capture recorded), so `read.ts` stays the one reader of the workflow files.

**Which keys may be sent.** A `view-keys` recipe is admissible only if each of its keys was recorded inert in the main view (§4.2 (e2)), or else only while no turn is running. A key that is not inert there (the close key is most likely Escape, which interrupts a running turn) is checked twice, **immediately before it is sent**, not only when the plan is made: the executor re-reads the live word (the reading `interruptVerdict` uses) and captures the pane, and sends the key only while no turn is running and the capture shows the view. The act itself may start a turn (§4.2 (e3)), so a plan-time reading is stale by the time the close key is due. If a turn is running at that point, the key is not sent and the answer is `view-left-open`: the act was sent, the view is still open, and the operator closes it from the terminal drawer once the turn ends. Per-key verification narrows the race between capture and key, and this rule bounds what the race can cost.

Rejected alternatives:
- Writing to the workflow's files, or signalling its processes: #641 forbids it, the reader is read-only by design, and signalling a process is the out-of-band act the SAFETY section exists to stop.
- Asking the session to stop its own workflow with a prompt: it is not deterministic, it spends a turn, and it reaches the model, not the mechanism.
- A third drive kind for a non-interactive surface (f): only after the spec is revised.

### 4.4 The server

**The ring layout follows the 08-10 rings and the consolidation spec's C3 (Session Conversation):**

- **L0 `shared/workflows.ts`:**
  - `WorkflowControlAct`;
  - the additive wire fields:
    - `WorkflowAgentView.key`, the journal key that addresses one agent;
    - `WorkflowView.controls?: WorkflowControlAct[]`, the acts this run offers **now**.
- **Server L1 `server/src/workflows/controls.ts`:** `WorkflowControlDrive` and `WORKFLOW_CONTROLS: Record<version, {act → recipe}>`, the measured table, defined once. Each recipe carries its drive, its keys or command template, `midTurn: boolean` from capture (e), `startsTurn: boolean` from (e3), and, for `view-keys`, which keys were recorded inert in the main view (e2). Every recipe rests on captures in both remote-control modes that agree (§4.2 step 2).
- **K8's pane owner `server/src/pane/workflowView.ts`:** reads a capture of the view (rows, selection, footer) and the post-act pane. `pane/dialog.ts`'s SGR pattern and prompt glyph are private today (≈:51); the task exports them and `workflowView.ts` imports them, declaring no new one (consolidation spec K8; this is the start of ARCH-63's stripper consolidation, which the wave finishes). If a capture cannot be read, the result is `unmeasurable`, never an empty view.
- **L1 `server/src/workflows/control.ts`:** `controlPlan(table, version, liveWord, rows, target, pane)` is pure, where `rows` is `readRunOnce`'s answer. It returns either the key steps to take or a refusal word. `liveWord` is the status reading `interrupt` already uses; with a running turn and a recipe whose `midTurn` is false, the answer is `turn-running` with zero keys.
- **The executor:** `controlWorkflow(d: SendDeps, …)` sits in `inject/send.ts`, the one owner of key sends, beside `interrupt`. It runs inside `d.queue.run(id, …)`, so it never interleaves with a prompt send, a dialog answer or an interrupt for the same session. It loops capture, verify, one key, until done. It ends by closing the view when it opened one, **never with Escape** in the main view, because Escape there interrupts a running turn: immediately before the close key, and before any other key not recorded inert, it re-reads the live word and captures, and sends the key only while no turn is running and the capture shows the view (§4.3, which keys may be sent). It confirms the outcome only through `readRunOnce` or the pane reader.
- **L4:** `POST /api/sessions/:id/workflows/:runId/control` in `server.ts`, beside `interrupt`, with body `{ act, agentKey?, expect: { state: 'running', agentState?: 'running' } }`.
  - A missing or blank `expect` is 400, as `submit` does.
  - Outcomes are recorded, with the act, source and outcome, through the `NoticeSink` that W1a's C1c funnel gives the server's routes, in `record-only` mode, so they are never pushed. P3-8 lands after C1c; it adds no hand-written feed pair, and when C1e's pinned writer set has landed, it adds its writer to that set in the same PR.
- **`controls` on the frame** is computed where the frame is built (`workflowsFrame`): from the session's `FleetSession.version` and the table, only for a `running` row, and without `stop-agent`/`skip-agent` for an agent whose label is null, shared with another running agent, or fails §4.3's token rules. A session whose version cannot be read gets no controls.
  - An older server sends no `controls` field, and the PWA then offers nothing. That is the tolerant reading of absence, and here it is also the safe one.
  - The PWA never decides what a version can do (consolidation K14: one owner per server fact).

**Typed refusals.** These are 409 unless noted, with a closed `WorkflowControlRefusal` union in `shared/api.ts` and plain words for each in the PWA's refusal table:

| Word | Means |
|---|---|
| `unknown-session` (404), `not-alive` | the id is not in the registry, or it has no pane: dead, asleep or hibernated. **The control never wakes a session.** |
| `version-unmeasured` | the session's version could not be read |
| `turn-running` | a turn is running and the recipe was not recorded to work mid-turn. Nothing was sent. |
| `not-offered` | the table has no recipe for this act on this version |
| `unknown-run`, `run-finished`, `unknown-agent`, `agent-finished`, `agent-ambiguous` | the target no longer matches `expect`, or its label cannot pick out one row |
| `rows-unread` | `readRunOnce` could not read the run to the end within its budget. Nothing was sent. |
| `dialog-open`, `draft-present`, `box-unreadable` | the pane holds an ask, a menu or the operator's draft, or the box cannot be read. Nothing was sent. These are the same words, and the same readers, that `sendPrompt` uses. |
| `view-not-reached`, `selection-lost` | a `view-keys` step did not see what it expected. The executor closes the view if it is still showing, and stops. |
| `sent-unconfirmed` | the act's key or command **was sent**, and the outcome (a summary or journal change, or the pane line the capture recorded) was not seen within the budget. This is a distinct word, because "sent" and "refused" need different remedies. |
| `view-left-open` | the act was sent, but a turn started before the close key was due, so the view was left open rather than sending a key that would interrupt it |
| `pane-unmeasurable` | a capture failed |

### 4.5 Operator-only: three layers, one owner each

1. **The auth gate.** The route is not in `EXEMPT`. With `CCRC_AUTH=on` (the live server), only the operator's passkey session reaches it. A box-token caller, which covers every session and coordinator, gets the gate's 401. `auth-gate.test.ts`'s two-way set assertion pins it.
2. **The approval classifier.** `FORBIDDEN_PATTERNS` gains one row, "a workflow control", which matches the route's path shape `/api/sessions/<id>/workflows/<run>/control` anywhere in a Bash command's text or an MCP request's string leaves, tolerating a quote character next to each `/` (as the approvals row tolerates `['"]?`), so a quote-split path still matches. A tool that is neither (WebFetch, say) is `escalate`, not `forbidden`; the auth gate is the wall for it. A child's Bash or MCP permission prompt that names the path is `forbidden`: never held, never mailed, and straight to the operator. This fits coordinator-first routing, under which a coordinator may never allow it.
3. **No session verb.** `ccd/ccrc-api` gets no subcommand for it. A census test is a **deny-list over the surfaces a session can run**: no tracked file under `ccd/` (which holds `ccrc-api`, `ccd`, `session-hook.sh` and `coordinator-skill/`) names the path. Everywhere else may, so `shared/api.ts`'s refusal-union docstrings, `README.md`'s route list and the docs follow their conventions freely. The matcher is `/api/sessions/` then one segment, `/workflows/`, one segment, then `/control`, where a segment is any of `:x`, `{x}`, `<x>`, `${x}`, `$x` or a literal id. `CHILD_DENY_RULES` is a list of Bash-prefix rules over `ccd` and `ccrc`, and with no verb there is no prefix to deny. The test records this, so that a later `ccrc-api` verb fails it until a deny rule and a classifier row exist.

What this does **not** claim: `tmux` is already forbidden to sessions, but CLAUDE.md is plain that the fleet's identity is attribution, not authentication. A session that bypassed the gate by hand could already type into another pane with `tmux`. These layers close the ccrc path. They do not create an OS wall.

### 4.6 The PWA

- **Where.** `WorkflowStrip` gains a control area per row. This is the session page only. A fleet card does not gain controls: a card is a glance, and its header is a superset. Nothing in the header changes either.
- **Stop workflow.** A danger control (`Button variant="danger"`), shown only when `controls` includes `stop-run`. It opens `QuickConfirm tone="danger"`, which focuses Cancel first. The confirm names what is lost, with words taken from P3-6b's record, for example: "Stops {name}. {running} running agents stop; their unfinished work is lost. {done} finished agents keep their results." The counts come from the row.
- **Per agent.** A ⋯ on a running agent's row, shown only when `controls` holds an agent act and the agent has a `key`. It opens the actions in a `Popover` at ≥900 and in a `Sheet` below 900. Each destructive act gets its own danger confirm.
- **Words.** The refusal words live in `pwa/src/session/workflowControlWords.ts` (the PWA's `*Words.ts` convention); `pwa/src/lib/api.ts` gains only the fetch, so the table consolidation K14 moves out of `lib/api.ts` does not grow.
- **Results.** Success shows a toast. `sent-unconfirmed` shows a warning toast that says the key was sent and the row has not changed yet. A refusal shows the refusal table's words.
- **Renders.** 360, 390, 1280 and 1920 × Refined/Instrument × dark/light, for the strip with a running row, the confirm, and the Popover (≥900) or the per-agent sheet (<900).

### 4.7 What Part B must not break

- **Account switching and the auto-swap are never blocked.** The control takes no swap lock and writes no marker, and the view it opens is closed before the queue slot is released, except in the `view-left-open` case, where closing it would interrupt a turn the act started. A swap that restarts the session mid-act makes the next capture fail, which is `pane-unmeasurable` or `not-alive`, and nothing is retried.
- **No herd restart.** Nothing restarts anything.
- **Hibernation.** An asleep or hibernated session refuses with `not-alive` and is never woken.
- **Coordinator-first routing.** Coordinators cannot press these, and the classifier row makes the request go straight to the operator.
- **SAFETY.** No new `ccd` verb, no new agent whitelist entry, no direct `tmux` from a shell or test. Tests use the fake `Tmux` and fixture captures only.
- **The read-only reader** (`workflows/read.ts`) stays read-only. The only change there is the additive `key`.

## 5. How this fits the consolidation contexts and waves

- **Contexts.**
  - Part A is the design system (`ui/`), in ARCH-02a's PWA ring map. It is not one of the nine server contexts.
  - Part B sits in **C3, Session Conversation**: the pane reading (`pane/workflowView.ts`, under K8's one grammar owner and its fixture corpus) and the injection queue (`inject/send.ts`, `KeyedQueue`).
  - **C2, Fleet Mutation** is untouched: no `CCD_ARGV` row and no whitelist change.
  - The recorder is K6's: P3-8 records through W1a's `NoticeSink` (C1c) in `record-only` mode and lands after it. It adds no `recordFeedEvent(` call of its own, so W0's feed census (C0c/C0d) and W1a's pinned writer set (C1e) see one more funnel caller and no new hand-written pair.
  - Growth: `server.ts` and `sessionws.ts` are on W0's growth list (C0a, reporting). P3-8 adds only the route's registration and body check to `server.ts` and one argument to `sessionws.ts`; the logic lives in new L1 files (`workflows/control.ts`, `pane/workflowView.ts`) and in `inject/send.ts`. Its PR body carries C0a's table.
- **Waves.** The consolidation spec's rule 8 keeps its own series out of `pwa/` until W7, and this programme is not part of the wave. Under its rule 6, "the wave rebases; the programme PR never does". W7's PWA gates count matchers and pollers, and this work adds none: `controls` is a server fact read once.
- **One owner per job, applied.**
  - The centred dialog: `.whats-new-panel` is deleted.
  - Focus give-back: `useCancelFirst`'s give-back half is deleted.
  - vaul motion: one helper replaces `PALETTE_MOTION`'s private recipe.
  - The 900 query: written once.
  - Pane parsing: one module, with no new SGR stripper.
  - Key sends: one file, one queue.
  - What a version can do: one table.

## 6. Tests (what the plan's red-first steps pin)

- **Part A:**
  - `sheet-desktop-arm.test.tsx`, through a stubbed `matchMedia`:
    - ≥900: no grabber, no drag, ✕ closes, Escape and the scrim close, sizes;
    - <900: the grabber is back;
    - the crossing keeps the content mounted.
  - `sheet-focus.test.tsx`:
    - the focus is in the panel on a first open (the callback-ref path), including a sheet whose parent mounts it already open (`UpdateMoveSheet`), and a Tab from the last control stays in;
    - the terminal drawer: the panel has the focus until the socket opens, then xterm's textarea, and the Sheet never takes it back;
    - a reopen during the close transition focuses the panel or `initialFocus`;
    - a self-opened sheet over a focused textarea gives the focus back on a fine pointer and not on a coarse one;
    - the focus is back on the opener on close;
    - `initialFocus` is honoured;
    - an opener that left the document is left alone.
  - `sheet-footer.test.tsx`: the footer sits outside `.sheet-body` and does not scroll.
  - `sheet-motion.test.tsx`: the literal class set is applied and each surface sets its variables; the browser leg reads the computed `animation-duration` under `no-preference` and `reduce` for the Sheet and the palette, and the computed `animation-name` at 1280 is the fade.
  - `theme-catalogue.test.ts`: every palette, including the two hand-written defaults, declares `--elev-pop`, and `skins.css` keeps the hairline.
  - `popover.test.tsx`.
  - The censuses follow.
- **Part B:**
  - `workflow-view-pane.test.ts`, which replays every recorded capture;
  - `workflow-control-plan.test.ts`, the pure decider's truth table;
  - `workflow-control-route.test.ts`: the fake `Tmux`, every refusal word, `sent-unconfirmed` kept apart from success, never an Escape when the capture shows no view (including a view that closes after the capture), no close key when the live word turns busy after the act key (`view-left-open`), a partial read refused `rows-unread` with zero keys, a real `v1:<64 hex>` key accepted, labels with control characters typed never, and queue serialisation against `interrupt`;
  - `approvalguard.test.ts`'s new forbidden row, including a quote-split path;
  - `auth-gate.test.ts`: the route is not exempt;
  - `workflow-control-census.test.ts`: the path, in any segment spelling, named nowhere under `ccd/`, and no `ccrc-api` verb;
  - `session-workflows-frame.test.ts`: `controls` and `key` are computed, and a missing version means no controls;
  - `workflow-controls-table.test.ts`: a recipe whose RC and plain captures differ is not admitted;
  - `workflow-strip.test.tsx`: no control without `controls`, danger confirm words, Popover or Sheet by width.

## 7. Open operator question

- **O1. Which Claude Code versions to measure.** P3-6b records the newest three that the fleet's version column shows, plus any older one still running. Measuring needs a scratch login on a machine that runs no fleet. Whose login it uses is the operator's call, because it spends that account's usage. **The design works without an answer.** Until the captures exist, `WORKFLOW_CONTROLS` is empty (P3-6a lands it so), every row offers no control, and Part A and P3-7 (the guards) proceed. P3-8 and P3-9 wait for P3-6b.

## 8. Deviation numbers

Issued for this programme: the block 5930 to 5939. The plan defines all ten, one per task: D-5930 to D-5938 for P3-1 to P3-9 (D-5935 for P3-6a), and D-5939 for P3-6b.
