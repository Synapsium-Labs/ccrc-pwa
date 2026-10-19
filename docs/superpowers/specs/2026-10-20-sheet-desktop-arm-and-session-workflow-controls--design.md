# The Sheet's desktop arm, and workflow controls on the session page (design)

**Status:** approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision. Rev 0. Nothing in it is built yet. One question is left open for the operator (§7, O1). The design works without an answer to it.

**Date:** 2026-10-20 · **Base:** `origin/main` `397be1ec5` (#735). Read-only. Nothing on any fleet or server box was touched or measured for this document. The Claude Code measurements §4.2 asks for are design inputs that a plan task records on a scratch machine.

**Issues:** #649 (sheets and dialogs: focus in on open and back on close, a pinned footer, and no drag handle on the centred desktop dialog, plus the reduced-motion comment on it) and #641 (workflow controls on the session page, like Claude Code's). #641 depends on #640, the read-only workflow rows, which landed as #652 (D-5560, D-5561).

**Plan:** `docs/superpowers/plans/2026-10-20-sheet-desktop-arm-and-session-workflow-controls-.md`, tasks P3-1 to P3-9, which define D-5930 to D-5938.

**Related:**
- `2026-10-15-ccrc-two-skins-design.md`, §5.3 "Sheets and dialogs" and §10's W1 row: "`Sheet`'s desktop arm (sizes, centred at ≥900, `--elev-pop`, a `Popover` primitive), after the ask sheet half and drawer stage 1". Part A of this document is that "later plan".
- `2026-10-18-ccrc-skins-w2-shells.md`, Task S18 (Instrument `preview: false`, D-5479), which waits for this arm "unless the coordinator rules otherwise".
- `2026-10-17-coordinator-first-routing-design.md` and its classifier `server/src/coord/approvalguard.ts` (D-5299, D-5360).
- `2026-10-19-ccrc-consolidation-wave-design.md` (a draft on `docs/consolidation-wave-spec`, not yet ruled), whose contexts and kernels §5 fits this work into.
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
- **Part B, workflow controls (#641).** The controls are offered only where a recorded capture shows how that Claude Code version does it (`WORKFLOW_CONTROLS`, keyed by version). Each one is driven through Claude Code's own mechanism with the keys path ccrc already has (`Tmux.sendKey`/`sendLiteral` inside the per-session `KeyedQueue`). No workflow file is ever written and no process is signalled. There is one new verb, `POST /api/sessions/:id/workflows/:runId/control`, and it is **operator-only** for three reasons:
  - the auth gate admits it only with a passkey session, because it is not in `EXEMPT`;
  - the approval classifier marks any request that names it `forbidden`;
  - no `ccrc-api` verb composes it.

  Stopping a workflow or an agent is a danger confirm that says what is lost. Every failure is a typed refusal.

## 1. The problem, measured

### 1.1 The Sheet (`ui/src/primitives/sheet.tsx`, 181 lines at `397be1ec5`)

| # | Defect | Where |
|---|---|---|
| A1 | **Focus does not move in.** vaul's `autoFocus` defaults to false. A sheet opened with Enter leaves the focus on the opener behind the scrim, so the first Tab lands outside the sheet (#649). | `Drawer.Root` ≈:64 passes no `autoFocus`. The palette opts in on purpose (`command-palette.tsx` ≈:165, D-5457). |
| A2 | **Focus does not come back.** Radix gives the focus back only to its own `Dialog.Trigger`, which no sheet uses. The one fix today is local: `useCancelFirst` (`confirm.tsx` ≈:71, D-5507/D-5610) captures the opener and gives the focus back for `QuickConfirm` and its two callers (`UpdateMoveSheet.tsx`, `updateAck.ts`). | `confirm.tsx` ≈:44–90 |
| A3 | **No footer.** The action row is the last child of the scrolling body (`.sheet-body` ≈:167–176), so it scrolls with the body. Six sheets end in a `QC_ACTIONS` row: `ArchiveConflictSheet`, `AbandonSheet`, `ArchiveSheet`, `WhatsNewSheet`, `UpdateMoveSheet` and `ResumeSheet`. `QuickConfirm` is a seventh. | `sheet.tsx` ≈:167 |
| A4 | **At ≥900 the panel is still a bottom drawer.** The grabber is drawn at ≥900 (≈:143–152), and the drag dismissal still works because `handleOnly` is set only for `full` (≈:75). The one centred dialog in the app is a local override, `.whats-new-panel` in `fleet.css` ≈:3240–3255, whose own comment says "until the Sheet primitive grows that arm itself". It needs an `!important` to remove vaul's unlayered `::after`. | `sheet.tsx`, `fleet.css` |
| A5 | **Reduced motion is ignored.** The panel retimes with `duration-sheet!`/`duration-slow!` (≈:109–110), which set `transition-duration`. vaul 1.1.2 animates with **keyframes** (`slideFromBottom`, 500 ms), so the tokens never reach it, and `tokens.css`'s reduced-motion `--dur-sheet: 1ms` (≈:1321) changes nothing. The palette had the same cause and fixed it locally with `PALETTE_MOTION` (`command-palette.tsx` ≈:109, D-5457). | `sheet.tsx` ≈:109 |

Other measured facts:
- **The 900 breakpoint.** `useMediaQuery('(min-width: 900px)')` is written twice (`pwa/src/app.tsx` ≈:85, `pwa/src/docs/DocsHead.tsx` ≈:226). The hook lives in `pwa/src/lib/useMediaQuery.ts`, which `ui/` may not import (`ui-package-boundary.test.ts`).
- **Elevation.** `--elev-pop` does not exist. The palettes are generated: `ui/design/make-themes.mjs` ≈:633 writes `--elev-sheet`, and `npm run themes:check` fails on a hand edit. `theme.css` ≈:256 maps `--shadow-sheet`. Instrument replaces elevations only with `none` or a hairline (`skins.css` ≈:65).
- **Popover.** No popover exists in `ui/` or `pwa/`. vaul already brings in `@radix-ui/react-dialog`, `-dismissable-layer`, `-focus-scope`, `-portal` and `-presence` (`ui/package-lock.json`).

### 1.2 The session's workflows

- **The rows are read-only (#652).** `shared/workflows.ts` (`WorkflowView`, `WorkflowAgentView`) is read from Claude Code's own files by `server/src/workflows/read.ts`, which "writes, signals or starts" nothing. It is carried on the session socket's `workflows` frame (`shared/api.ts` ≈:4510, `sessionws.ts`) and drawn by `WorkflowStrip` (`ui/src/components/workflow-strip.tsx`, used at `SessionScreen.tsx` ≈:603).
- **Claude Code can stop a run.** Its summary carries a final `killed` status (`WorkflowState`, `model.ts` ≈:351), so a stop mechanism exists. How it is driven, and whether one agent can be stopped or skipped, is **unmeasured**. The reader's source was measured on 2.1.203–2.1.302 (`model.ts` ≈:5).
- **An agent has no id on the wire.** `WorkflowAgentView` carries `label`, `phase` and `state`. The server knows each agent's journal key (`foldJournal`), but the wire does not carry it.
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

`useMediaQuery` **moves** into `ui/src/lib/use-media-query.ts` with one `DESK_QUERY = '(min-width: 900px)'`. `pwa/src/lib/useMediaQuery.ts` becomes a re-export, and `app.tsx` and `DocsHead.tsx` read `DESK_QUERY`, so the breakpoint is written once. The arm is chosen **by width, never by skin**, as the skins spec §5.3 says ("the container … is decided by `Sheet` from the width, not by the skin").

### 2.2 What the arm draws at ≥900

- **Placement:** centred (`inset: 0; margin: auto; height: fit-content`), at most `100dvh - 2 × --sp-8` tall, `--r-xl` on every corner. vaul's `::after` strip is removed in the primitive, which absorbs the precedent `fleet.css` set.
- **Sizes:** a `size` prop, `'sm' | 'md' | 'lg'` = 440 / 560 / 720 px, defaulting to `md`, each capped at `100vw - 2 × --sp-8`. `QuickConfirm` uses `sm` and `WhatsNewSheet` uses `lg` (it was `min(40rem, …)`). Every other sheet keeps the default.
- **Elevation:** `--elev-pop`, generated in `make-themes.mjs` beside `--elev-sheet` (a centred, downward shadow) and mapped to `--shadow-pop` in `theme.css`. Instrument replaces it with `0 0 0 1px var(--edge-strong)` in `skins.css`, which is the recipe its rule allows.
- **Chrome:** a ✕ close button at the top right (an `Icon` button, `aria-label="Close"`, at least 44 px on a coarse pointer). There is no grabber. The drag is off: `handleOnly` with no `Drawer.Handle` rendered, so vaul has nothing to drag. Escape, the scrim and the ✕ still close the dialog.
- **Motion:** a fade and a small rise, on the tokens (`--dur-base` in, `--dur-fast` out), in place of vaul's slide.
- **Not changed:** the `full` variant (the terminal drawer), which drawer stage 1 made work at every width, and the command palette, which is a top drawer of its own.

### 2.3 Motion (A5)

One helper, `vaulMotion(open, close)`, in `ui/src/lib/motion.ts`, retimes vaul's **keyframes** (`animation-duration`/`-timing-function`, with `!` to beat vaul's attribute selector). `PALETTE_MOTION` becomes `vaulMotion` with the palette's tokens, which is a move with identical classes. `Sheet` uses `--dur-sheet` with the spring to open and `--dur-slow` with the swift curve to close. All of these are tokens, so `tokens.css`'s reduced-motion block (1 ms) and Instrument's 120 ms reach every vaul surface. Alternatives:
- a `useReducedMotion()` branch that turns animation off. Rejected: it is a second owner of the reduced-motion fact, which `tokens.css` already owns.
- leaving the palette's own copy. Rejected: two definitions of one fix.

### 2.4 Focus (A1, A2)

| Option | Verdict |
|---|---|
| (a) vaul `autoFocus` on every sheet | Rejected. Radix focuses the first focusable element, and in `NewSessionSheet` or `DialogSheet`'s free-text row that is an input, so a phone's keyboard rises unasked. The palette is the one surface that wants that. |
| (b) **The Sheet owns focus.** On open it focuses `initialFocus` if the caller passes a ref, otherwise the panel itself (`tabIndex={-1}`, named by its title), with `preventScroll`. On close it returns the focus to the opener captured at open. Tab stays trapped (Radix's modal trap, pinned by a test). | **Chosen.** Focusing the panel moves the screen reader into the dialog and raises no keyboard, and the first Tab lands on the first control. This is #649's "or its title" arm. |
| (c) Each sheet focuses its own first control | Rejected. That is 22 owners. |

`useCancelFirst`'s give-back half moves into `Sheet`. What remains of it is the choice of Cancel as `initialFocus` for a danger confirm (D-5507), still with `preventScroll` (D-5610). Its two documented paths are kept: a first open that mounts Cancel, and a reopen that reuses it (`quick-confirm-focus.test.tsx`). An opener that has left the document, or is disabled, is left alone, as today.

### 2.5 The footer (A3)

`Sheet` gains `footer?: ReactNode`, drawn after `.sheet-body` as a `flex-none` row with the body's side padding and the safe-area bottom, so it stays put while the body scrolls, **at every width**. The seven action rows move into it one consumer per commit. The `full` variant takes no footer.

### 2.6 Popover

A `Popover` primitive (`ui/src/primitives/popover.tsx`) on `@radix-ui/react-popover`:
- It shares Radix's dismissable layer, focus scope and portal, which are already in the tree through vaul.
- It draws on `--elev-pop` with `--bg-sheet`.
- Escape and an outside press close it, and focus returns to its trigger (Radix does this for a popover, because a popover has a real trigger).

The alternatives were hand-rolling the placement and dismissal, which would be a second dismissal mechanism beside Radix's, and deferring the primitive, which would leave the skins W1 row short. Its first consumer is Part B's per-agent menu at ≥900. Below 900 that menu is a `Sheet`.

### 2.7 S18 coordination

The W2 plan's S18 waits for "`Sheet`'s desktop arm (W1, unplanned)" unless the coordinator rules otherwise (D-5479). This design narrows that gate to **P3-4** (the centred dialog), which is what a desktop default actually shows. P3-3 (the footer) and P3-5 (the Popover) do not gate it. The W2 plan file is not edited here. #813 edits it, and the gate is recorded in this plan's §Gates for the coordinator to apply. If the coordinator rules that the flip lands first, every sheet on an Instrument desktop is today's bottom drawer until P3-4 lands, and it is the same drawer Refined desktops already have.

## 3. What Part A must not break

- **The terminal drawer** keeps `handleOnly` with a real `Drawer.Handle`, `repositionInputs={false}` and its z-index arm (`sheet-handle-only.test.tsx`, `sheet-full-chrome.test.tsx`, `sheet-keyboard-once.test.tsx`).
- **The title inside the scroller** (≈:41–61), its 38vh cap, and the ring room (`sheet-ring-room.test.tsx`, D-5495) stay as they are.
- **Escape stays overridable** (`onEscapeKeyDown`, the drawer's terminal).
- **The frozen censuses** follow each change: `shape-census.test.ts`, `role-census.test.ts`, `contrast.test.ts`, `design-system-boundary.test.ts`, `ui-package-boundary.test.ts`, `primitives.test.tsx`, plus `control-census.test.ts` for the ✕. `audit.mjs` measures the new rules, and no colour is minted.
- **Phones** keep the bottom sheet, its spring under `no-preference`, and swipe-to-dismiss.

## 4. Part B: workflow controls (#641)

### 4.1 The rule that comes first

Nothing is built on a guess. Which controls exist, and how each is driven, is recorded **per Claude Code version** from a capture, and the server offers a control only for a version the table names. Every capture-dependent step in the plan is gated on that record (P3-6).

### 4.2 How to measure it (P3-6), on a scratch machine and never on a fleet box

1. **Machine.** A developer machine that runs no fleet. Each target Claude Code version is installed side by side, using the lifecycle's own `claude install <version>`, which needs no login. The run uses a throwaway `HOME` with its own login, and a private tmux socket (`tmux -L wfprobe`), so no real session, registry or socket is reachable. The target set is every version the fleet's `FleetSession.version` column showed on the day, read by the operator from the PWA or from `GET /api/fleet`. At most the newest three need recording, plus any older one still running.
2. **A workflow to drive.** A two-phase script with three agents, one of which sleeps long enough to be stopped mid-run. It is launched in the pane by prompt, so that it runs as the fleet's runs do.
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
   - **(f)** `claude --help` and the version's changelog lines for any non-interactive surface (a CLI flag, a background-task command). A surface found here is noted, and it is a spec revision, not a build input.
4. **The record.**
   - **Captures:** `server/test/fixtures/panes/workflow-view/<version>/*.txt`. These are the K8 corpus's location, with fixture names only and run ids rewritten to `wf_fixture…`.
   - **Write-up:** `docs/superpowers/research/2026-10-workflow-controls-capture.md`, a table of version × act → drive, confirm, outcome and "works mid-turn".
   - **Table:** `WORKFLOW_CONTROLS` in `shared/workflows.ts`, generated by hand from that table and held equal to the captures by a test that replays each capture through the reader (§4.4).

### 4.3 The controls, and how each is driven

The candidate acts are the three #641 names: `stop-run`, `stop-agent` and `skip-agent`. A version gets an act only if (d) recorded it working. Each act has one **drive** kind, and it is one of the two that the keys path can do:

| Drive | Shape | Chosen when |
|---|---|---|
| `command` | type a slash command that names the run or agent **by id or label**, then Enter. Uses `sendLiteral` and `sendKey('Enter')`, with `submitEnter`'s `expect` discipline. | (b) recorded an addressable command. **Preferred**, because it addresses the target by name, not by cursor position. |
| `view-keys` | open the view, move the selection to the target row (verified against the pane after **every** key), press the act's key, then close the view with its own close key | (c) recorded only the view |

Rejected alternatives:
- Writing to the workflow's files, or signalling its processes: #641 forbids it, the reader is read-only by design, and signalling a process is the out-of-band act the SAFETY section exists to stop.
- Asking the session to stop its own workflow with a prompt: it is not deterministic, it spends a turn, and it reaches the model, not the mechanism.
- A third drive kind for a non-interactive surface (f): only after the spec is revised.

### 4.4 The server

**The ring layout follows the 08-10 rings and the consolidation draft's C3 (Session Conversation):**

- **L0 `shared/workflows.ts`:**
  - `WorkflowControlAct`;
  - `WORKFLOW_CONTROLS: Record<version, {act → drive recipe}>`, the measured table, defined once;
  - the additive wire fields:
    - `WorkflowAgentView.key`, the journal key that addresses one agent;
    - `WorkflowView.controls?: WorkflowControlAct[]`, the acts this run offers **now**.
- **K8's pane owner `server/src/pane/workflowView.ts`:** reads a capture of the view (rows, selection, footer) and the post-act pane. It shares `pane/dialog.ts`'s SGR stripper and prompt glyph and declares no new one (consolidation draft K8). If a capture cannot be read, the result is `unmeasurable`, never an empty view.
- **L1 `server/src/workflows/control.ts`:** `controlPlan(table, version, view, target, pane)` is pure. It returns either the key steps to take or a refusal word.
- **The executor:** `controlWorkflow(d: SendDeps, …)` sits in `inject/send.ts`, the one owner of key sends, beside `interrupt`. It runs inside `d.queue.run(id, …)`, so it never interleaves with a prompt send, a dialog answer or an interrupt for the same session. It loops capture, verify, one key, until done. It ends by closing the view when it opened one, **never with Escape** in the main view, because Escape there interrupts a running turn.
- **L4:** `POST /api/sessions/:id/workflows/:runId/control` in `server.ts`, beside `interrupt`, with body `{ act, agentKey?, expect: { state: 'running', agentState?: 'running' } }`.
  - A missing or blank `expect` is 400, as `submit` does.
  - Outcomes are recorded like `recordInterrupt`, with the act, source and outcome, and are never pushed.
- **`controls` on the frame** is computed where the frame is built (`workflowsFrame`): from the session's `FleetSession.version` and the table, only for a `running` row, and without `stop-agent`/`skip-agent` for an agent whose label is null or shared with another running agent.
  - An older server sends no `controls` field, and the PWA then offers nothing. That is the tolerant reading of absence, and here it is also the safe one.
  - The PWA never decides what a version can do (consolidation K14: one owner per server fact).

**Typed refusals.** These are 409 unless noted, with a closed `WorkflowControlRefusal` union in `shared/api.ts` and plain words for each in the PWA's refusal table:

| Word | Means |
|---|---|
| `unknown-session` (404), `not-alive` | the id is not in the registry, or it has no pane: dead, asleep or hibernated. **The control never wakes a session.** |
| `version-unmeasured` | the session's version could not be read |
| `not-offered` | the table has no recipe for this act on this version |
| `unknown-run`, `run-finished`, `unknown-agent`, `agent-finished`, `agent-ambiguous` | the target no longer matches `expect`, or its label cannot pick out one row |
| `dialog-open`, `draft-present`, `box-unreadable` | the pane holds an ask, a menu or the operator's draft, or the box cannot be read. Nothing was sent. These are the same words, and the same readers, that `sendPrompt` uses. |
| `view-not-reached`, `selection-lost` | a `view-keys` step did not see what it expected. The executor closes the view if it is still showing, and stops. |
| `sent-unconfirmed` | the act's key or command **was sent**, and the outcome (a summary or journal change, or the pane line the capture recorded) was not seen within the budget. This is a distinct word, because "sent" and "refused" need different remedies. |
| `pane-unmeasurable` | a capture failed |

### 4.5 Operator-only: three layers, one owner each

1. **The auth gate.** The route is not in `EXEMPT`. With `CCRC_AUTH=on` (the live server), only the operator's passkey session reaches it. A box-token caller, which covers every session and coordinator, gets the gate's 401. `auth-gate.test.ts`'s two-way set assertion pins it.
2. **The approval classifier.** `FORBIDDEN_PATTERNS` gains one row, "a workflow control", which matches the route's path shape `/api/sessions/<id>/workflows/<run>/control` anywhere in the text. A child's permission prompt that names it is `forbidden`: never held, never mailed, and straight to the operator. This fits coordinator-first routing, under which a coordinator may never allow it.
3. **No session verb.** `ccd/ccrc-api` gets no subcommand for it. A census test asserts that no tracked file outside `server/src` and `pwa/src` composes that path. `CHILD_DENY_RULES` is a list of Bash-prefix rules over `ccd` and `ccrc`, and with no verb there is no prefix to deny. The test records this, so that a later `ccrc-api` verb fails it until a deny rule and a classifier row exist.

What this does **not** claim: `tmux` is already forbidden to sessions, but CLAUDE.md is plain that the fleet's identity is attribution, not authentication. A session that bypassed the gate by hand could already type into another pane with `tmux`. These layers close the ccrc path. They do not create an OS wall.

### 4.6 The PWA

- **Where.** `WorkflowStrip` gains a control area per row. This is the session page only. A fleet card does not gain controls: a card is a glance, and its header is a superset. Nothing in the header changes either.
- **Stop workflow.** A danger control (`Button variant="danger"`), shown only when `controls` includes `stop-run`. It opens `QuickConfirm tone="danger"`, which focuses Cancel first. The confirm names what is lost, with words taken from P3-6's record, for example: "Stops {name}. {running} running agents stop; their unfinished work is lost. {done} finished agents keep their results." The counts come from the row.
- **Per agent.** A ⋯ on a running agent's row, shown only when `controls` holds an agent act and the agent has a `key`. It opens the actions in a `Popover` at ≥900 and in a `Sheet` below 900. Each destructive act gets its own danger confirm.
- **Results.** Success shows a toast. `sent-unconfirmed` shows a warning toast that says the key was sent and the row has not changed yet. A refusal shows the refusal table's words.
- **Renders.** 360, 390, 1280 and 1920 × Refined/Instrument × dark/light, for the strip with a running row, the confirm, and the Popover (≥900) or the per-agent sheet (<900).

### 4.7 What Part B must not break

- **Account switching and the auto-swap are never blocked.** The control takes no swap lock and writes no marker, and the view it opens is closed before the queue slot is released. A swap that restarts the session mid-act makes the next capture fail, which is `pane-unmeasurable` or `not-alive`, and nothing is retried.
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
  - The recorder follows `recordInterrupt`'s existing shape. If W1a's `notify(event)` funnel (K6) lands first, P3-8 records through it instead.
- **Waves.** The consolidation draft's rule 8 keeps its own series out of `pwa/` until W7, and this programme is not part of the wave. Under its rule 6, "the wave rebases; the programme PR never does". W7's PWA gates count matchers and pollers, and this work adds none: `controls` is a server fact read once.
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
    - the focus is in the panel on open, and a Tab from the last control stays in;
    - the focus is back on the opener on close;
    - `initialFocus` is honoured;
    - an opener that left the document is left alone.
  - `sheet-footer.test.tsx`: the footer sits outside `.sheet-body` and does not scroll.
  - `sheet-motion.test.tsx`: the keyframe classes carry the tokens, and the palette's classes are unchanged.
  - `theme-catalogue.test.ts`: `--elev-pop` is generated in every palette, and `skins.css` keeps the hairline.
  - `popover.test.tsx`.
  - The censuses follow.
- **Part B:**
  - `workflow-view-pane.test.ts`, which replays every recorded capture;
  - `workflow-control-plan.test.ts`, the pure decider's truth table;
  - `workflow-control-route.test.ts`: the fake `Tmux`, every refusal word, `sent-unconfirmed` kept apart from success, never an Escape in the main view, and queue serialisation against `interrupt`;
  - `approvalguard.test.ts`'s new forbidden row;
  - `auth-gate.test.ts`: the route is not exempt;
  - `workflow-control-census.test.ts`: no composer outside `server/src` and `pwa/src`, and no `ccrc-api` verb;
  - `session-workflows-frame.test.ts`: `controls` and `key` are computed, and a missing version means no controls;
  - `workflow-strip.test.tsx`: no control without `controls`, danger confirm words, Popover or Sheet by width.

## 7. Open operator question

- **O1. Which Claude Code versions to measure.** P3-6 records the newest three that the fleet's version column shows, plus any older one still running. Measuring needs a scratch login on a machine that runs no fleet. Whose login it uses is the operator's call, because it spends that account's usage. **The design works without an answer.** Until the captures exist, `WORKFLOW_CONTROLS` is empty, every row offers no control, and Part A and P3-7 (the guards) proceed. P3-8 and P3-9 wait.

## 8. Deviation numbers

Issued for this programme: the block 5930 to 5939. The plan defines D-5930 to D-5938, one per task; 5939 stays issued and unused.
