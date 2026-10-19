# The Sheet's desktop arm, and workflow controls on the session page — Implementation Plan

> **For agentic workers:** nine PRs, Tasks P3-1 to P3-9, one task per PR. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Workers do not edit §Deviations and decisions. Band routing is per task. The orchestrator reviews every diff before it lands.

**Spec:** `docs/superpowers/specs/2026-10-20-sheet-desktop-arm-and-session-workflow-controls--design.md` (rev 0, approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision).

**Issues:** #649 (Part A) and #641 (Part B; its read-only half is #640, landed as #652).

**Status:** rev 0 (2026-10-20). Nothing built.

**Base:** `origin/main` `397be1ec5` (#735). The anchors are written `≈:` and checked again in each task's Step 0:
- `ui/src/primitives/sheet.tsx`: 181 lines; `Drawer.Root` ≈:64, `handleOnly` ≈:75, the motion classes ≈:109, the grabber ≈:143–152, `.sheet-body` ≈:167;
- `ui/src/primitives/confirm.tsx` `useCancelFirst` ≈:71;
- `ui/src/primitives/command-palette.tsx` `PALETTE_MOTION` ≈:109;
- `pwa/src/fleet/fleet.css` `.whats-new-panel` ≈:3240;
- `pwa/src/lib/useMediaQuery.ts`;
- `ui/design/make-themes.mjs` `--elev-sheet` ≈:633;
- `server/src/inject/send.ts` `interrupt` ≈:1937;
- `server/src/server.ts` `/interrupt` ≈:2574;
- `server/src/coord/approvalguard.ts` `FORBIDDEN_PATTERNS` ≈:194;
- `server/src/auth/gate.ts` `EXEMPT` ≈:210;
- `shared/workflows.ts` (69 lines).

## Gates

The open PRs at `397be1ec5` that touch a file in this plan were measured with `gh pr list --state open` and `gh api …/pulls/<n>/files` for #722, which lists 385 files:

| Task | #722 (vocabulary, 385 files) | #739 (ui deps) | #813 (private ids) | Other open PRs | Earlier tasks | Other plans |
|---|---|---|---|---|---|---|
| P3-1 motion | — | — | — | none | — | none |
| P3-2 focus | — | — | — | none | P3-1 (same file) | none |
| P3-3 footer | — | — | — | none | P3-2 (same file) | none |
| P3-4 desktop arm | `pwa/src/fleet/fleet.css`: line-disjointness check, and the later of the two rebases | — | — | none | P3-3 (same file) | skins W2 S-tasks edit `pwa/src/app.tsx`: line-disjoint (the `useMediaQuery` line only) |
| P3-5 Popover | — | `ui/package.json`, `ui/package-lock.json`: land after #739 or regenerate the lock on rebase | — | none | — | none |
| P3-6 capture | — | — | — | none | — | **operator question O1** (whose scratch login) |
| P3-7 guards | `shared/api.ts`: line-disjoint | — | — | none | — | coordinator-first plan: none open |
| P3-8 server verb | `shared/api.ts`: line-disjoint | — | — | none | P3-6, P3-7 | none |
| P3-9 PWA controls | `pwa/src/screens/SessionScreen.tsx`: line-disjoint (≈:603 only) | — | — | none | P3-3, P3-5, P3-8 | skins W2/W3 edit `SessionScreen.tsx`: line-disjoint |

**S18 (skins W2, D-5479).** Recorded here for the coordinator. The flip's "`Sheet`'s desktop arm" gate is met by **P3-4** alone; P3-3 and P3-5 do not gate it. This plan does not edit the W2 plan, because #813 holds that file.

No open PR edits `sheet.tsx`, `confirm.tsx`, `command-palette.tsx`, `workflow-strip.tsx`, `inject/send.ts`, `server.ts`, `approvalguard.ts`, `gate.ts` or `shared/workflows.ts`.

## Global constraints

- **Public repo.** Fixture names only (`project-a`, `lane-a`, `wf_fixture…`). No hosts, accounts, home paths or private tracker ids in code, tests, captures, commits or PR text.
- **SAFETY.** No `ccd` verb is added. No agent whitelist entry is added. No test runs `tmux` or `ccd` against a live `$HOME`. Part B's tests use the fake `Tmux` (`SendDeps`) and recorded fixture captures only. P3-6's capture runs on a machine that runs no fleet, with a throwaway `HOME` and a private `tmux -L` socket.
- **One owner per job** (CLAUDE.md's architecture direction). Each task deletes the local copy it replaces in the same PR: `.whats-new-panel`, `useCancelFirst`'s give-back, `PALETTE_MOTION`'s private recipe, and the second `(min-width: 900px)` literal. No parallel mechanism lands.
- **Wire:** additive only. `FLEET_PROTO` does not move. An absent `controls` means no controls are offered.
- **Rulings that bind:**
  - Account switching and the auto-swap are never blocked.
  - No herd restart.
  - Hibernation's contract holds: no wake.
  - Coordinator-first routing holds.
  - UI is judged at 360/390/1280/1920 × Refined/Instrument × dark/light, and every UI PR body carries that table.
  - A card is a glance and its header a superset, so no card changes.
- **Tests:** vitest with `--maxWorkers=2`, one suite at a time. Generated palettes are never hand-edited (`npm run themes`, then `themes:check`).
- **Deploy class:** PWA/UI (P3-1 to P3-5, P3-9) and SERVER (P3-7, P3-8), each riding an ordinary release. Nothing touches the fleet box.

## Review focus

1. **Keyboard on a phone.** No sheet may focus an input on open (P3-2).
2. **A second owner.** Any surviving local centred-dialog rule, focus give-back or vaul motion recipe is a finding.
3. **Escape in the main view** (P3-8). It interrupts a running turn. The executor may close only the workflow view, and only with the key the capture recorded.
4. **"Sent" collapsing into "refused" or "done".** `sent-unconfirmed` is its own word.
5. **The operator-only layers** (P3-7). The route must not be exempt, the classifier must forbid it, and no `ccrc-api` verb may compose it.
6. **Guessing a control.** No recipe may exist in `WORKFLOW_CONTROLS` without a capture that the replay test reads.

## Tasks

### Task P3-1: the Sheet honours reduced motion — vaul's keyframes on the tokens, one helper (D-5930) — after nothing

**Routing:** band 2 (spec-able, small). **Lane:** PWA/UI.

**Files:**
- Create `ui/src/lib/motion.ts`: `vaulMotion({ open, openCurve, close, closeCurve })`, which returns the `data-[state=open|closed]:[animation-duration:…]!`/`[animation-timing-function:…]!` classes.
- Modify `ui/src/primitives/command-palette.tsx` ≈:109: `PALETTE_MOTION = vaulMotion(--dur-base, --curve-swift, --dur-fast, --curve-swift)`, producing identical classes.
- Modify `ui/src/primitives/sheet.tsx` ≈:109–110: replace the `duration-*!`/`ease-*!` transition utilities with `vaulMotion(--dur-sheet, --curve-spring, --dur-slow, --curve-swift)` on the panel, and a fade on the overlay.
- Create `pwa/test/sheet-motion.test.tsx`.

- [ ] **Step 0: Re-ground.** Confirm that vaul 1.1.2 still animates by keyframes (`slideFromBottom`) and that `tokens.css`'s reduced-motion block sets `--dur-sheet: 1ms`.
- [ ] **Step 1: Red.**
  - "the open panel carries `animation-duration:var(--dur-sheet)` and `animation-timing-function:var(--curve-spring)`";
  - "the closed panel carries `--dur-slow`";
  - "no `duration-sheet!` transition utility remains on the panel";
  - "`PALETTE_MOTION` is byte-equal to its value at base".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | panel back on `duration-sheet!` | sheet-motion | "carries `animation-duration:var(--dur-sheet)`" |
  | `vaulMotion` drops the `!` | sheet-motion | the open-panel class row |
  | palette given its own recipe again | sheet-motion | "`PALETTE_MOTION` is byte-equal" (and `single-definition` if the recipe text is duplicated) |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/sheet-motion.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/command-layer.test.tsx --maxWorkers=2
      cd ui && npm test

**Review focus:** the reduced-motion reading in the browser at 390 and 1280. Under `reduce`, the sheet appears without the slide.

### Task P3-2: the Sheet owns focus — in on open, trapped, back on close; `useCancelFirst` keeps only "Cancel first" (D-5931) — after P3-1

**Routing:** band 3 (accessibility behaviour across 23 surfaces; native, the orchestrator reviews). **Lane:** PWA/UI.

**Files:**
- Modify `ui/src/primitives/sheet.tsx`:
  - a new `initialFocus?: RefObject<HTMLElement>` prop;
  - on open, focus `initialFocus` or the panel (`tabIndex={-1}`, `aria-labelledby` the title), with `preventScroll`;
  - capture the opener at open, and give it back in the effect cleanup after the trap releases. This is `useCancelFirst`'s measured order, moved here.
- Modify `ui/src/primitives/confirm.tsx` ≈:44–90: `useCancelFirst` returns a ref and passes it as `initialFocus`, and its give-back half is deleted. Keep the reopen-reuses-Cancel path.
- Modify `ui/src/index.ts` only if the exports change.
- Create `pwa/test/sheet-focus.test.tsx`. Follow on in `pwa/test/quick-confirm-focus.test.tsx`, which must stay green unchanged except for imports.

- [ ] **Step 0: Re-ground.** Measure whether vaul 1.1.2's `Drawer.Content` forwards `onOpenAutoFocus`. If it does, use it. If it does not, move the focus in an effect after the portal mounts, which is the order `useCancelFirst`'s comment records.
- [ ] **Step 1: Red.**
  - "on open the active element is inside the panel";
  - "on open no `input` or `textarea` has focus (`NewSessionSheet`, `DialogSheet` with a free-text row)";
  - "Tab from the last control lands on the first";
  - "Shift+Tab from the first lands on the last";
  - "on close the opener has focus";
  - "an opener removed while open is left alone";
  - "`initialFocus` wins";
  - "`QuickConfirm` still opens on Cancel, scrolled to the top".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | no focus move on open | sheet-focus | "active element is inside the panel" |
  | vaul `autoFocus` set instead | sheet-focus | "no `input` … has focus" |
  | give-back removed | sheet-focus | "on close the opener has focus" |
  | give-back left in `useCancelFirst` as well | review + quick-confirm-focus | a double give-back is pinned by "on close the opener has focus" with a moved opener |
  | `preventScroll` dropped | quick-confirm-focus | the 375×667 row |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/sheet-focus.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/quick-confirm-focus.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/dialog-sheet.test.tsx --maxWorkers=2

**Review focus:** the terminal drawer, where focus belongs in the terminal. Its own focus handling must win, so `full` passes its terminal as `initialFocus` or keeps today's behaviour, and the test pins whichever is chosen.

### Task P3-3: a pinned footer, and the seven action rows move into it (D-5932) — after P3-2

**Routing:** band 2 for the prop. The seven consumer moves are band 1 (`/handoff`, one consumer per commit, orchestrator-reviewed). **Lane:** PWA/UI.

**Files:**
- Modify `ui/src/primitives/sheet.tsx`: `footer?: ReactNode`, drawn after `.sheet-body` as `sheet-footer flex-none` with the side padding and the safe-area bottom. It is refused on `full` (type-level: `full` and `footer` are exclusive in `SheetProps`).
- Modify `ui/src/primitives/confirm.tsx` (`QuickConfirm`) and `pwa/src/fleet/{ArchiveConflictSheet,AbandonSheet,ArchiveSheet,WhatsNewSheet,UpdateMoveSheet,ResumeSheet}.tsx`: each `QC_ACTIONS` row moves into `footer`.
- Create `pwa/test/sheet-footer.test.tsx`. Modify `pwa/test/sheet.test-d.tsx` for the exclusive props. Follow on in the seven sheets' tests and `shape-census.test.ts`/`role-census.test.ts` as measured.

- [ ] **Step 0: Re-ground.** Run `git grep -l QC_ACTIONS pwa/src ui/src` and expect the seven files.
- [ ] **Step 1: Red.**
  - "the footer is not a descendant of `.sheet-body`";
  - "with a body taller than the panel, the footer's rect stays inside the panel" (jsdom layout is stubbed; the browser leg below is the real check);
  - "`full` with `footer` is a type error";
  - "each of the seven renders its actions in `.sheet-footer`".
- [ ] **Step 2: Green**, one consumer per commit.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | footer rendered inside the body | sheet-footer | "not a descendant of `.sheet-body`" |
  | one consumer left in the body | sheet-footer | that consumer's row |
  | `full` accepts `footer` | sheet.test-d | the exclusive-props row |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/sheet-footer.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/whats-new-sheet.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/update-move-sheet.test.tsx --maxWorkers=2
      cd pwa && npx tsc --noEmit

**Review focus:** What's new with several releases at 390 (Update all is visible without scrolling) and at 1280, where its bottom must not be clipped.

### Task P3-4: the desktop arm — centred at ≥900 in sm/md/lg on `--elev-pop`, a ✕, no grabber, no drag; `.whats-new-panel` deleted; the 900 query written once (D-5933) — after P3-3

**Routing:** band 3 (it changes every sheet's container on every desktop). **Lane:** PWA/UI. **Gates:** #722 on `fleet.css` (line-disjointness).

**Files:**
- Create `ui/src/lib/use-media-query.ts`. It holds `useMediaQuery`, moved from `pwa/src/lib/useMediaQuery.ts`, plus `DESK_QUERY` and `useDesk()`. `pwa/src/lib/useMediaQuery.ts` becomes a re-export. Modify `pwa/src/app.tsx` ≈:85 and `pwa/src/docs/DocsHead.tsx` ≈:226 to read `DESK_QUERY`.
- Modify `ui/design/make-themes.mjs` ≈:633: generate `--elev-pop`. Run `npm run themes`, which regenerates `ui/src/styles/tokens.css` and is never hand-edited.
- Modify `ui/src/styles/theme.css` ≈:256 (`--shadow-pop: var(--elev-pop)`) and `ui/src/styles/skins.css` (Instrument `--elev-pop: 0 0 0 1px var(--edge-strong)`).
- Modify `ui/src/primitives/sheet.tsx`:
  - `size?: 'sm' | 'md' | 'lg'`;
  - at `useDesk()`: `handleOnly` with no handle, no grabber, a ✕ (`Icon` button, `aria-label="Close"`);
  - the `min-[900px]:` placement, the radius and `shadow-pop`;
  - the `::after` removal, which absorbs the `fleet.css` precedent;
  - the fade-in motion through `vaulMotion`;
  - `full` unchanged.
- Modify `pwa/src/fleet/fleet.css` ≈:3240–3255: delete `.whats-new-panel`. Modify `pwa/src/fleet/WhatsNewSheet.tsx` (`size="lg"`, drop the class) and `confirm.tsx` (`size="sm"`).
- Modify `ui/src/primitives/sheet.stories.tsx`: one story per size at desk width.
- Create `pwa/test/sheet-desktop-arm.test.tsx`. Follow on in `theme-catalogue.test.ts`, `contrast.test.ts`, `control-census.test.ts` (the ✕), `shape-census.test.ts`, `design-system-boundary.test.ts`, `ui-package-boundary.test.ts`, `fleet-css.test.ts` and `whats-new-sheet.test.tsx`, as measured.

- [ ] **Step 0: Re-ground.** Run `git grep -n "min-width: 900px" pwa/src ui/src` and record the hits. Confirm that `.whats-new-panel` is the only local centred-dialog rule: `git grep -n "margin: auto" pwa/src/**/*.css` near a `sheet-panel` class.
- [ ] **Step 1: Red.**
  - "≥900: no `.sheet-grabber`";
  - "≥900: a ✕ named Close closes";
  - "≥900: a pointer drag on the panel does not close it";
  - "≥900: Escape and the scrim close";
  - "≥900: `size` sets 440/560/720";
  - "<900: the grabber is back and the drag closes";
  - "crossing 900 while open keeps the typed text in a child input";
  - "`full` is identical at both widths";
  - "`--elev-pop` is generated in every palette";
  - "Instrument's `--elev-pop` is the hairline";
  - "no `.whats-new-panel` rule exists";
  - "`(min-width: 900px)` appears once in TS (`DESK_QUERY`)".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | grabber drawn at ≥900 | sheet-desktop-arm | "no `.sheet-grabber`" |
  | `handleOnly` false at ≥900 | sheet-desktop-arm | "a pointer drag … does not close it" |
  | arm chosen by skin, not width | sheet-desktop-arm | the Refined-at-1280 row |
  | arm remounts on crossing | sheet-desktop-arm | "keeps the typed text" |
  | `--elev-pop` hand-edited in `tokens.css` | theme-catalogue (`themes:check`) | the generated-block row |
  | `.whats-new-panel` kept | sheet-desktop-arm | "no `.whats-new-panel` rule" |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/sheet-desktop-arm.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/theme-catalogue.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/control-census.test.ts --maxWorkers=2
      cd ui && npm run themes:check && npm test
      cd pwa && npm run test:browser

- [ ] **Step 5: Renders.** 360/390/1280/1920 × Refined/Instrument × dark/light, for the update move sheet, What's new and one ask sheet (`DialogSheet`). Use the app on a fixture home (skins spec §9). The table goes in the PR body.

**Review focus:** the ask sheet at 1280 (its long-title cap and the ring room inside a centred panel), and the ✕'s tap target on a coarse pointer at 1280.

### Task P3-5: a `Popover` primitive (D-5934) — after nothing (lands before P3-9)

**Routing:** band 2. **Lane:** PWA/UI. **Gates:** #739 (`ui/package.json`, `package-lock.json`).

**Files:**
- Modify `ui/package.json` and `ui/package-lock.json`: `@radix-ui/react-popover`, on the Radix line vaul already resolves.
- Create `ui/src/primitives/popover.tsx` (`Popover`, `PopoverTrigger`, `PopoverContent` on `--bg-sheet` + `shadow-pop`, `--r-lg`, collision-aware) and `ui/src/primitives/popover.stories.tsx`. Modify `ui/src/index.ts`.
- Create `pwa/test/popover.test.tsx`. Follow on in `primitives.test.tsx`, `design-system-boundary.test.ts`, `contrast.test.ts` and `shape-census.test.ts`, as measured.

- [ ] **Step 0: Re-ground.** `npm ls @radix-ui/react-dismissable-layer` in `ui/` resolves to a single version after the install.
- [ ] **Step 1: Red.**
  - "opens from its trigger";
  - "Escape closes and focus returns to the trigger";
  - "an outside press closes";
  - "its content is in a portal on `shadow-pop`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `modal` focus trap without return | popover | "focus returns to the trigger" |
  | `shadow-sheet` instead of `shadow-pop` | popover | "on `shadow-pop`" |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/popover.test.tsx --maxWorkers=2
      cd ui && npm test

### Task P3-6: record which workflow controls each Claude Code version has, and how each is driven (D-5935) — after nothing; **operator question O1**

**Routing:** band 3 (it is measurement, and it decides what is built). Native, done by a person or session with a scratch login on a machine that runs no fleet. Never on a fleet or server box.

**Files:**
- Create `server/test/fixtures/panes/workflow-view/<version>/*.txt`. These are captures with `-e`, fixture names only, and run ids rewritten to `wf_fixture…`.
- Create `docs/superpowers/research/2026-10-workflow-controls-capture.md`, the version × act table (drive, confirm, outcome, works mid-turn) and the procedure as run.
- Modify `shared/workflows.ts`:
  - `WorkflowControlAct = 'stop-run' | 'stop-agent' | 'skip-agent'`;
  - `WorkflowControlDrive` (`command` | `view-keys`, with the recorded keys or command text);
  - `WORKFLOW_CONTROLS`, which holds only recorded rows. It is empty if O1 is unanswered.
- Create `server/test/workflow-controls-table.test.ts`.

- [ ] **Step 0: The procedure in spec §4.2, run as written.** Steps 1 to 3 (a)–(f). Record every capture before reading it into the table.
- [ ] **Step 1: Red.**
  - "every `WORKFLOW_CONTROLS` row names a version with a capture directory";
  - "every recipe's keys or command text appear in that version's captures";
  - "no act outside the three";
  - "the table is defined once" (`single-definition`).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a row with no capture directory | workflow-controls-table | "names a version with a capture directory" |
  | a recipe key absent from its captures | workflow-controls-table | "appear in that version's captures" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/workflow-controls-table.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts --maxWorkers=2

**Operator acts:** O1 (spec §7), which settles whose scratch login runs the capture. Until it is answered, the task lands its types and an empty table, which keeps P3-7 unblocked. P3-8 and P3-9 wait.

**Review focus:** every capture is free of names, hosts and paths. A recipe must not rest on a single capture of a view that redraws.

### Task P3-7: the operator-only guards land before the door — classifier row, gate pin, no-composer census (D-5936) — after nothing

**Routing:** band 3 (approval path, security). Native, **two reviewers**. **Lane:** SERVER.

**Files:**
- Modify `server/src/coord/approvalguard.ts` ≈:205: one `FORBIDDEN_PATTERNS` row, `{ why: 'a workflow control', re: /\/api\/sessions\/[^/\s'"]+\/workflows\/[^/\s'"]+\/control(?![\w-])/ }`.
- Modify `server/test/approvalguard.test.ts`. The new rows cover:
  - a `curl` naming the path is `forbidden`;
  - a path with a variable for the id is `forbidden`;
  - a read of `shared/workflows.ts` is unchanged.
- Modify `server/test/auth-gate.test.ts`: "no `EXEMPT` key matches `POST /api/sessions/:id/workflows/:runId/control`". It is written now and goes live when P3-8 registers the route.
- Create `server/test/workflow-control-census.test.ts`. Its rows:
  - "`git grep` for the path shape finds composers only under `server/src` and `pwa/src` (and the tests)";
  - "`ccd/ccrc-api` has no subcommand that composes it";
  - "`CHILD_DENY_RULES` needs no row while that holds". This row fails the day a `ccrc-api` verb composes the path, until a deny rule and a classifier row exist.

- [ ] **Step 0: Re-ground.** Confirm that `FORBIDDEN_PATTERNS` tests are linear in the text length (D-5299) and that the new regex has no nested quantifier.
- [ ] **Step 1: Red.** The rows above.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the classifier row deleted | approvalguard | "a `curl` naming the path is `forbidden`" |
  | the route added to `EXEMPT` | auth-gate | "no `EXEMPT` key matches" |
  | a `ccrc-api workflow-stop` verb added | workflow-control-census | "`ccd/ccrc-api` has no subcommand" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/approvalguard.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/workflow-control-census.test.ts --maxWorkers=2

### Task P3-8: the verb — pane reader, pure plan, queued executor, typed refusals, `controls` and `key` on the frame (D-5937) — after P3-6 (a non-empty table) and P3-7

**Routing:** band 3 (it sends keys into live sessions). Native, **two reviewers**. **Lane:** SERVER.

**Files:**
- Create `server/src/pane/workflowView.ts`. It reads the recorded view (rows, selection, footer, closed) and the act's outcome line, using `pane/dialog.ts`'s stripper and glyph. A failed capture is `unmeasurable`.
- Create `server/src/workflows/control.ts` (L1): `controlPlan(table, version, view, target, pane)` returns the steps or a refusal word.
- Modify `server/src/inject/send.ts`: `controlWorkflow(d, id, …)` inside `d.queue.run`. Before it acts it checks the dialog/menu, the draft and the box (`hasMenu`, `draftOfMeasured`). It then runs capture, verify, one key, up to a budget. It closes the view with its recorded key and never sends Escape in the main view.
- Modify `server/src/server.ts` ≈:2597, beside `/interrupt`: `POST /api/sessions/:id/workflows/:runId/control`. The body check gives 400 on a missing or blank `expect`. The route answers 404 `unknown-session` and 409 for refusals, and records the outcome like `recordInterrupt`.
- Modify `shared/api.ts`: the `WorkflowControlRefusal` union and its result type.
- Modify `shared/workflows.ts` (`WorkflowAgentView.key`, `WorkflowView.controls?`), `server/src/workflows/model.ts` (`key` from `foldJournal`; `controls` in `workflowsFrame` from the version and the table) and `server/src/sessionws.ts` (pass the session's `FleetSession.version`).
- Create `server/test/workflow-view-pane.test.ts`, `workflow-control-plan.test.ts` and `workflow-control-route.test.ts`. Modify `session-workflows-frame.test.ts` and `workflows-model.test.ts`.

- [ ] **Step 0: Re-ground.**
  - Read P3-6's write-up. Confirm that each recipe's drive kind is `command` or `view-keys`. Stop and report if the record shows anything else.
  - Read `interrupt` and `submitEnter` as they stand.
  - If W1a's `notify` funnel has landed, record through it instead of a new recorder.
- [ ] **Step 1: Red.**
  - "every capture replays to its recorded view";
  - "`controlPlan` refuses `not-offered` for an unlisted version and `version-unmeasured` for null";
  - "a draft in the box refuses `draft-present` with zero keys sent";
  - "an open ask refuses `dialog-open` with zero keys";
  - "a selection that does not move refuses `selection-lost` and closes the view";
  - "no step sends `Escape` while the view is closed";
  - "a sent act with no observed outcome answers `sent-unconfirmed`, not success";
  - "two acts on one session never interleave, and an `interrupt` queued between waits";
  - "an asleep session refuses `not-alive` and nothing calls ensure";
  - "`controls` is absent for a finished row, a null version and a null or shared agent label";
  - "an older frame (no `controls`) parses".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | draft check removed | workflow-control-route | "refuses `draft-present` with zero keys" |
  | Escape used to close | workflow-control-route | "no step sends `Escape` while the view is closed" |
  | outcome check skipped (success on send) | workflow-control-route | "answers `sent-unconfirmed`" |
  | executor outside `queue.run` | workflow-control-route | "never interleave" |
  | per-key verify removed | workflow-control-route | "refuses `selection-lost`" |
  | `controls` offered on a null version | session-workflows-frame | "absent for … a null version" |
  | a second SGR stripper in `workflowView.ts` | single-definition | the stripper row |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/workflow-view-pane.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/workflow-control-plan.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/workflow-control-route.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/session-workflows-frame.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd server && npx tsc --noEmit

**Review focus:** the auto-swap. The view is never left open after the queue slot is released, and nothing holds a swap lock.

### Task P3-9: the controls on the session page — Stop workflow and the per-agent menu, danger confirms, refusal words, renders (D-5938) — after P3-3, P3-5 and P3-8

**Routing:** band 2 for the UI, band 3 for the confirm wording (the orchestrator checks it against P3-6's record). **Lane:** PWA/UI.

**Files:**
- Modify `ui/src/components/workflow-strip.tsx` and `workflow-strip.css`:
  - a Stop control on a row whose `controls` has `stop-run` (`Button variant="danger"`);
  - a ⋯ per running agent with a `key` when an agent act is offered: `Popover` at `useDesk()`, otherwise a `Sheet`;
  - every act through `QuickConfirm tone="danger"`, with the loss sentence from the row's counts and the recorded outcome;
  - an `onControl(runId, act, agentKey?)` prop.
- Modify `ui/src/components/workflow-strip.stories.tsx`.
- Modify `pwa/src/lib/api.ts` (`workflowControl(id, runId, body)` and the refusal-words table entries for every `WorkflowControlRefusal`) and `pwa/src/screens/SessionScreen.tsx` ≈:603 (pass `onControl`, then a toast for the result).
- Modify `pwa/test/workflow-strip.test.tsx`. Create `pwa/test/workflow-control-words.test.ts`.

- [ ] **Step 0: Re-ground.** Read P3-6's recorded outcomes. The confirm sentence may claim only what they show.
- [ ] **Step 1: Red.**
  - "no control without `controls`";
  - "no agent menu for an agent with no `key`";
  - "Stop opens a danger confirm focused on Cancel";
  - "the confirm names the running and finished counts";
  - "≥900 the agent menu is a popover; <900 a sheet";
  - "`sent-unconfirmed` shows the warning toast, not success";
  - "every `WorkflowControlRefusal` has words" (iterated over the union's runtime list);
  - "no fleet card renders a control".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | control drawn without `controls` | workflow-strip | "no control without `controls`" |
  | `tone="commit"` on Stop | workflow-strip | "a danger confirm" |
  | a refusal word missing | workflow-control-words | "every `WorkflowControlRefusal` has words" |
  | `sent-unconfirmed` read as success | workflow-strip | "shows the warning toast" |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/workflow-strip.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/workflow-control-words.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/control-census.test.ts --maxWorkers=2
      cd pwa && npx tsc --noEmit

- [ ] **Step 5: Renders.** 360/390/1280/1920 × Refined/Instrument × dark/light, for a running row with controls, the Stop confirm, and the agent menu (a popover at 1280/1920, a sheet at 360/390). The table goes in the PR body.

## Operator acts

- **O1** (P3-6): whose scratch login runs the capture. Nothing else waits on the operator. P3-1 to P3-5 and P3-7 proceed without an answer.

## Rollback

Each task is a plain revert:
- P3-4's revert restores `.whats-new-panel` with it.
- P3-8's wire fields are additive. A PWA newer than the server sees no `controls` and offers nothing.
- P3-7's guards may stay after a P3-8 revert, because they refuse a path that no longer exists.

## Deviations and decisions

### Issued for this work and defined here

The block 5930 to 5939 was issued to this programme. This plan defines D-5930 to D-5938, one per task; 5939 stays issued and unused.

- **D-5930** — `sheet-motion-on-keyframes` (Task P3-1): vaul animates by keyframes, so the Sheet and the palette retime `animation-duration`/`-timing-function` through one `vaulMotion` helper on the motion tokens, and the reduced-motion and Instrument values reach every vaul surface. The transition utilities that never moved vaul are removed.
- **D-5931** — `sheet-owns-focus` (Task P3-2): the Sheet moves focus in on open (the caller's `initialFocus`, else the panel itself, never an input, so a phone keyboard never rises unasked), keeps Radix's trap, and returns focus to the opener on close. `useCancelFirst` keeps only the choice of Cancel, and its give-back half is deleted.
- **D-5932** — `sheet-pinned-footer` (Task P3-3): `Sheet` gains a `footer` slot outside the scrolling body, pinned at every width and exclusive with `full`. The seven `QC_ACTIONS` rows move into it.
- **D-5933** — `sheet-desktop-arm` (Task P3-4): at ≥900 (`DESK_QUERY`, written once in `ui/`), a sheet is a centred dialog in sm/md/lg (440/560/720) on the generated `--elev-pop` (Instrument: hairline), with a ✕, no grabber and no drag. The arm is chosen by width, never by skin, and the terminal drawer is unchanged. `.whats-new-panel` is deleted. This task alone meets skins S18's desktop-arm gate.
- **D-5934** — `popover-on-radix` (Task P3-5): a `Popover` primitive on `@radix-ui/react-popover`, sharing the Radix layers vaul already brings in. Its first consumer is the workflow strip's per-agent menu at ≥900.
- **D-5935** — `workflow-controls-measured` (Task P3-6): workflow controls exist in ccrc only as `WORKFLOW_CONTROLS` rows, keyed by Claude Code version, each backed by recorded captures from a scratch machine that a replay test reads. The acts are `stop-run`, `stop-agent` and `skip-agent`, and the drives are `command` (preferred, addressed by name) or `view-keys` (verified after every key).
- **D-5936** — `workflow-control-operator-only` (Task P3-7): the control verb is operator-only in three layers. It is absent from the auth gate's `EXEMPT`, the classifier forbids any request naming it, and no `ccrc-api` verb composes it. A census reds the day a session verb composes it without a deny rule.
- **D-5937** — `workflow-control-verb` (Task P3-8): `POST /api/sessions/:id/workflows/:runId/control` drives Claude Code's own mechanism through the per-session key queue, with a pure plan, a capture/verify loop, a typed refusal for every failure, `sent-unconfirmed` kept apart from success, no Escape in the main view, no wake and no swap lock. `controls` and the agent `key` are additive frame fields computed by the server.
- **D-5938** — `workflow-controls-ui` (Task P3-9): the session page's workflow strip offers only the server's `controls`: Stop workflow and a per-agent menu (a popover at ≥900, a sheet below), each behind a danger confirm that names what is lost from recorded outcomes, with words for every refusal. Fleet cards are unchanged.

Unused: 5939 (issued, not used)

## Out of scope

- The toast and `QuickConfirm` polish that the skins W1 row orders after the arm.
- Moving the ask sheet onto new chrome beyond the arm (skins W4).
- Any non-interactive control surface P3-6 might find, which needs a spec revision.
- Resuming a stopped workflow.
- Workflow controls on fleet cards.
- A `ccrc-api` verb for any of this.
- The consolidation wave's W7 PWA gates.
