# The Sheet's desktop arm, and workflow controls on the session page — Implementation Plan

> **For agentic workers:** ten PRs, Tasks P3-1 to P3-9 with P3-6 split into P3-6a and P3-6b, one task per PR. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Workers do not edit §Deviations and decisions. Band routing is per task. The orchestrator reviews every diff before it lands.

**Spec:** `docs/superpowers/specs/2026-10-20-sheet-desktop-arm-and-session-workflow-controls--design.md` (rev 2, approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision).

**Issues:** #649 (Part A) and #641 (Part B; its read-only half is #640, landed as #652).

**Status:** rev 2 (2026-10-20): two reviews' findings are applied or rejected in §Review log. Nothing built.

**Base:** `origin/main` `643c76cd4` (#822); rev 0 and rev 1 were measured on `397be1ec5` (#735), and every anchor below was re-checked on the new base. The anchors are written `≈:` and checked again in each task's Step 0:
- `ui/src/primitives/sheet.tsx`: 181 lines; `Drawer.Root` ≈:64, `handleOnly` ≈:75, the motion classes ≈:109, the grabber ≈:143–152, `.sheet-body` ≈:167;
- `ui/src/primitives/confirm.tsx` `useCancelFirst` ≈:71;
- `ui/src/primitives/command-palette.tsx` `PALETTE_MOTION` ≈:109;
- `pwa/src/fleet/fleet.css` `.whats-new-panel` ≈:3240;
- `pwa/src/lib/useMediaQuery.ts`; the `(min-width: 900px)` literals at `pwa/src/app.tsx` ≈:85, `pwa/src/docs/DocsHead.tsx` ≈:226 and `pwa/src/session/SessionDetails.tsx` ≈:79;
- `ui/design/make-themes.mjs` `--elev-sheet` ≈:633; the generated block in `ui/src/styles/tokens.css` ≈:545–:1267, and the two hand-written default palettes' `--elev-sheet` ≈:412 and ≈:529;
- `server/src/pane/dialog.ts`'s private `SGR` ≈:51;
- `server/src/inject/send.ts` `interrupt` ≈:1937;
- `server/src/server.ts` `/interrupt` ≈:2574;
- `server/src/coord/approvalguard.ts` `FORBIDDEN_PATTERNS` ≈:194;
- `server/src/auth/gate.ts` `EXEMPT` ≈:210;
- `shared/workflows.ts` (69 lines);
- `server/src/workflows/model.ts` `RUN_ID_RE` ≈:32 (exported) and `KEY_RE` ≈:35 (private); `server/src/workflows/read.ts` `SessionWorkflows` ≈:109, created per socket at `server/src/sessionws.ts` ≈:571.

## Gates

Re-measured for rev 2 on `643c76cd4` against the 33 open PRs, with `gh pr list --state open` and `gh api …/pulls/<n>/files --paginate` for every one, filtered to the files this plan touches:

| Task | Open PRs on its files | Earlier tasks | Other plans |
|---|---|---|---|
| P3-1 motion | none | — | none |
| P3-2 focus | #817 on `ui/src/index.ts` (only if the exports change): line-disjoint | P3-1 (same file) | none |
| P3-3 footer | none | P3-2 (same file) | none |
| P3-4 desktop arm | #722 on `pwa/src/fleet/fleet.css`: line-disjointness check, and the later of the two rebases | P3-3 (same file) | skins W2 S18 waits for this task (applied in the W2 plan by this PR). Skins W2 S-tasks edit `pwa/src/app.tsx`: line-disjoint (the `useMediaQuery` line only); W2 width-gated mounts read `DESK_QUERY`. Skins W2 S3 regenerates `tokens.css`'s generated block through `make-themes.mjs`: whichever lands second **regenerates on rebase** (`npm run themes`), never hand-merges. Skins W3 adds `useMediaQuery('(min-width: 900px)')` in `pwa/src/skins/listColumn.ts`: it must import `DESK_QUERY` (the coordinator tells that plan), or this task's literal pin reds it |
| P3-5 Popover | #739, #422, #423, #424 on `ui/package.json` and `ui/package-lock.json`: regenerate the lock on rebase; #817 on `ui/src/index.ts`: line-disjoint | — | none |
| P3-6a types | none | — | none |
| P3-6b capture | none | P3-6a | **operator question O1** (whose scratch login) |
| P3-7 guards | none (the census reads `ccd/` and edits no shared file) | — | coordinator-first plan: none open |
| P3-8 server verb | #821 on `server/src/inject/send.ts` (≈:1347, a read-only box probe) and `shared/api.ts`: line-disjoint; #722 on `server/src/sessionws.ts` and `shared/api.ts`: line-disjoint; #722 and #737 on `server/test/single-definition.test.ts`: add the row after theirs on rebase | P3-6b, P3-7 | **W1a C1c** (D-5857, the `notify` funnel and `NoticeSink`): P3-8 records through it, so it lands after C1c. **W1a C1e** (D-5859, the pinned feed writer set): if landed, P3-8 adds its writer to that set. **W1a C1c/C1d** also edit `server.ts` (the sink's composition root, ≈:2485): line-disjoint from the route at ≈:2597. **W0 C0a** (D-5848, growth check over `server.ts` and `sessionws.ts`, reporting): the PR body carries its table. **W0 C0c/C0d** (feed census): P3-8 adds no `recordFeedEvent(` call. The consolidation wave's ARCH-63 (stripper consolidation): this task exports `pane/dialog.ts`'s `SGR`, which the wave then owns |
| P3-9 PWA controls | #722 on `pwa/src/screens/SessionScreen.tsx`: line-disjoint (≈:603 only); #817 on `ui/src/index.ts`: line-disjoint | P3-3, P3-4 (`useDesk()`), P3-5, P3-8 | skins W2/W3 edit `SessionScreen.tsx`: line-disjoint |

**S18 (skins W2, D-5479).** The flip's "`Sheet`'s desktop arm" gate is met by **P3-4** alone; P3-3 and P3-5 do not gate it. This PR applies that to the W2 plan itself (S18's Needs, its Gates row and the dependency line). #813, which held that file at rev 1, merged before rev 2, and no open PR edits it.

No open PR edits `sheet.tsx`, `confirm.tsx`, `command-palette.tsx`, `workflow-strip.tsx`, `server.ts`, `approvalguard.ts`, `gate.ts`, `pane/dialog.ts`, `workflows/model.ts`, `workflows/read.ts`, `shared/workflows.ts` or the skins W2 plan. `inject/send.ts` is edited by #821 (above).

## Global constraints

- **Public repo.** Fixture names only (`project-a`, `lane-a`, `wf_fixture…`). No hosts, accounts, home paths or private tracker ids in code, tests, captures, commits or PR text.
- **SAFETY.** No `ccd` verb is added. No agent whitelist entry is added. No test runs `tmux` or `ccd` against a live `$HOME`. Part B's tests use the fake `Tmux` (`SendDeps`) and recorded fixture captures only. P3-6b's capture runs on a machine that runs no fleet, with a throwaway `HOME` and a private `tmux -L` socket.
- **One owner per job** (CLAUDE.md's architecture direction). Each task deletes the local copy it replaces in the same PR: `.whats-new-panel`, `useCancelFirst`'s give-back, `PALETTE_MOTION`'s private recipe, and the other `(min-width: 900px)` literals. No parallel mechanism lands.
- **Wire:** additive only. `FLEET_PROTO` does not move. An absent `controls` means no controls are offered.
- **Rulings that bind:**
  - Account switching and the auto-swap are never blocked.
  - No herd restart.
  - Hibernation's contract holds: no wake.
  - Coordinator-first routing holds.
  - UI is judged at 360/390/1280/1920 × Refined/Instrument × dark/light, and every UI PR body carries that table.
  - A card is a glance and its header a superset, so no card changes.
- **Tests:** vitest with `--maxWorkers=2`, one suite at a time. Generated palettes are never hand-edited (`npm run themes`, then `themes:check`); the two default palettes above the generated block are hand-written and are edited by hand. The browser leg runs as `npm run test:browser -- --maxWorkers=2`.
- **Deploy class:** PWA/UI (P3-1 to P3-5, P3-9) and SERVER (P3-7, P3-8), each riding an ordinary release. Nothing touches the fleet box.

## Review focus

1. **Keyboard on a phone.** No sheet may focus an input on open (P3-2).
2. **A second owner.** Any surviving local centred-dialog rule, focus give-back or vaul motion recipe is a finding.
3. **Escape in the main view** (P3-8). It interrupts a running turn. The executor may close only the workflow view, only with the key the capture recorded, and only while a live-word reading and a capture taken immediately before that key show no running turn and the view.
4. **What is typed** (P3-8). Command text is composed only from validated tokens; a raw label is never typed.
5. **"Sent" collapsing into "refused" or "done".** `sent-unconfirmed` and `view-left-open` are their own words.
6. **The operator-only layers** (P3-7). The route must not be exempt, the classifier must forbid it, and no `ccrc-api` verb may compose it.
7. **Guessing a control.** No recipe may exist in `WORKFLOW_CONTROLS` without a capture that the replay test reads.

## Tasks

### Task P3-1: the Sheet honours reduced motion — vaul's keyframes on the tokens, one helper (D-5930) — after nothing

**Routing:** band 2 (spec-able, small). **Lane:** PWA/UI.

**Files:**
- Create `ui/src/lib/motion.ts`. Every class in it is written **literally**, because Tailwind v4 emits CSS only for literal class tokens (`@source '../**/*.{ts,tsx}'`); nothing is interpolated at runtime.
  - `VAUL_MOTION`: `data-[state=open]:[animation-duration:var(--vaul-in-dur)]!`, `data-[state=open]:[animation-timing-function:var(--vaul-in-curve)]!`, and the closed pair on `--vaul-out-dur`/`--vaul-out-curve`.
  - `SHEET_MOTION_VARS`: `[--vaul-in-dur:var(--dur-sheet)] [--vaul-in-curve:var(--curve-spring)] [--vaul-out-dur:var(--dur-slow)] [--vaul-out-curve:var(--curve-swift)]`.
  - `PALETTE_MOTION_VARS`: the same four on `--dur-base`/`--dur-fast` and the swift curve.
- Modify `ui/src/primitives/command-palette.tsx` ≈:109: `PALETTE_MOTION = VAUL_MOTION + ' ' + PALETTE_MOTION_VARS` (string concatenation of literals). Its four old literal classes leave the file, so the computed timing, not the class string, is what stays equal.
- Modify `ui/src/primitives/sheet.tsx` ≈:109–110: replace the `duration-*!`/`ease-*!` transition utilities with `VAUL_MOTION` and `SHEET_MOTION_VARS` on the panel and the overlay.
- Create `pwa/test/sheet-motion.test.tsx` (jsdom) and `pwa/browser/vaul-motion.browser.test.tsx` (the browser leg, `vitest.browser.config.ts`).

- [ ] **Step 0: Re-ground.** Confirm that vaul 1.1.2 still animates by keyframes (`slideFromBottom`) and that `tokens.css`'s reduced-motion block sets `--dur-sheet: 1ms`.
- [ ] **Step 1: Red.**
  - jsdom: "the panel carries `VAUL_MOTION` and `SHEET_MOTION_VARS`"; "no `duration-sheet!` transition utility remains on the panel"; "`motion.ts` contains no template literal or `${`" (a source scan: the classes are literal); "`PALETTE_MOTION` starts with `VAUL_MOTION`";
  - `server/test/single-definition.test.ts`, a new row: "no `animation-duration:` or `animation-timing-function:` literal exists in `ui/src` outside `ui/src/lib/motion.ts`";
  - browser: "the open Sheet's computed `animationDuration` equals the resolved `--dur-sheet` under `no-preference` and is `0.001s` under `reduce`"; "the open palette's computed `animationDuration` equals `--dur-base` under `no-preference` (as at base) and `0.001s` under `reduce`"; "the closed panel's computed `animationTimingFunction` is the swift curve".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | panel back on `duration-sheet!` | sheet-motion, vaul-motion (browser) | "carries `VAUL_MOTION`", and the computed-duration row |
  | `VAUL_MOTION` drops the `!` | vaul-motion (browser) | the computed-duration rows (vaul's attribute selector wins) |
  | a class built with `${…}` | sheet-motion | "contains no template literal", and the browser rows (no CSS emitted) |
  | palette given its own recipe again (`[animation-duration:var(--dur-base)]`) | single-definition, sheet-motion | the no-literal-outside-`motion.ts` row, and "`PALETTE_MOTION` starts with `VAUL_MOTION`" |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/sheet-motion.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/command-layer.test.tsx --maxWorkers=2
      cd pwa && npm run test:browser -- --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd ui && npm test

**Review focus:** the reduced-motion reading in the browser at 390 and 1280. Under `reduce`, the sheet appears without the slide.

### Task P3-2: the Sheet owns focus — in on open, trapped, back on close; `useCancelFirst` keeps only "Cancel first" (D-5931) — after P3-1

**Routing:** band 3 (accessibility behaviour across 23 surfaces; native, the orchestrator reviews). **Lane:** PWA/UI.

**Files:**
- Modify `ui/src/primitives/sheet.tsx`:
  - a new `initialFocus?: RefObject<HTMLElement>` prop;
  - both of `useCancelFirst`'s measured paths, moved here (spec §2.4 (b)). The panel does not exist when the opening commit's effect runs (Radix's `Portal` mounts it one pass later; `confirm.tsx` ≈:51–56), so:
    - **a callback ref on `Drawer.Content`**: when the panel mounts while open, focus `initialFocus.current` (child refs attach first) or else the panel (`tabIndex={-1}`, `aria-labelledby` the title), with `preventScroll`. This is the first-open path, and every open of a sheet whose parent mounts it already open;
    - **an effect keyed on `open`**: read the opener; if the panel is already in the document (a reopen during the close transition, so no ref fires), focus the target itself; give the focus back to the opener in the cleanup, after the trap releases. A text-field opener (`input`, `textarea`, contenteditable) gets it back only on a fine pointer (`(pointer: fine)`), so a phone keyboard never rises unasked;
  - the Sheet moves the focus only on those two events, never again while open, so the terminal drawer's own `term.focus()` on socket open (`TerminalDrawer.tsx` ≈:430) keeps it. `full` passes no `initialFocus`;
  - `onOpenAutoFocus` only calls `preventDefault` (Radix's default stays suppressed). It is not the focus mechanism.
- Modify `ui/src/primitives/confirm.tsx` ≈:44–90: `useCancelFirst(open, on)` now returns a `RefObject<HTMLElement>` (it returned a callback ref) that is set only while `on`. The Cancel button's `ref` and the Sheet's `initialFocus` both take it. It focuses nothing itself: its give-back half and its mount and reopen focusing are deleted, because the Sheet's two paths now do both. The reopen-reuses-Cancel behaviour is kept by the Sheet's effect path.
- Modify `pwa/src/fleet/UpdateMoveSheet.tsx` ≈:284: pass `cancelRef` to its `Sheet` as `initialFocus`.
- Modify `pwa/src/fleet/updateAck.ts` ≈:147: the comment now says the parent effect runs after the **Sheet's** give-back. The order holds because React runs the child's cleanup before the parent's effect.
- Modify `ui/src/index.ts` only if the exports change.
- Create `pwa/test/sheet-focus.test.tsx`. Follow on in `pwa/test/quick-confirm-focus.test.tsx`, which must stay green unchanged except for imports, `pwa/test/update-move-sheet.test.tsx`, and the `AckConfirm`/halt-banner focus tests (find them with `git grep -ln AckConfirm pwa/test`).

- [ ] **Step 0: Re-ground.** Confirm that vaul 1.1.2's `Drawer.Content` forwards `onOpenAutoFocus` and calls `preventDefault` when `autoFocus` is false (measured at rev 1: it does). Confirm that a reopen within the close transition keeps the content mounted (`quick-confirm-focus.test.tsx`'s reopen row), and that on a first open the `open`-keyed effect runs before the panel mounts (`confirm.tsx` ≈:51–56). The callback ref covers the first, the effect the second.
- [ ] **Step 1: Red.**
  - "on a first open the active element is inside the panel" (the callback-ref path);
  - "the first open of a sheet whose parent mounts it already open (`UpdateMoveSheet`) focuses Cancel";
  - "opening the terminal drawer: the panel has the focus, then xterm's textarea once the fake socket opens, and the Sheet never takes it back";
  - "on open no `input` or `textarea` has focus (`NewSessionSheet`, `DialogSheet` with a free-text row)";
  - "Tab from the last control lands on the first";
  - "Shift+Tab from the first lands on the last";
  - "on close the opener has focus";
  - "an opener removed while open is left alone";
  - "`initialFocus` wins";
  - "a reopen during the close transition focuses the panel, or `initialFocus` when given";
  - "a sheet opened by state over a focused composer textarea: on a fine pointer the textarea has the focus after close; on a coarse pointer it does not";
  - "`QuickConfirm` still opens on Cancel, scrolled to the top";
  - "`UpdateMoveSheet` opens on Cancel";
  - "after an Ack commit, the row has the focus, not the disabled Ack and not `body`";
  - "`confirm.tsx` contains no `.focus(` call in a `useCancelFirst` effect cleanup" (a source scan: one give-back owner).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | no focus move on open | sheet-focus | "active element is inside the panel" |
  | callback-ref path removed (effect only) | sheet-focus | "on a first open …", and the `UpdateMoveSheet` first-open row |
  | the Sheet refocuses the panel on every render while open | sheet-focus | the terminal drawer row |
  | vaul `autoFocus` set instead | sheet-focus | "no `input` … has focus" |
  | give-back removed | sheet-focus | "on close the opener has focus" |
  | give-back left in `useCancelFirst` as well | sheet-focus | "`confirm.tsx` contains no `.focus(` call in a `useCancelFirst` effect cleanup" |
  | focus moved through `onOpenAutoFocus` instead of the effect | sheet-focus | "a reopen during the close transition focuses …" |
  | text-field give-back on every pointer | sheet-focus | the coarse-pointer textarea row |
  | `preventScroll` dropped | quick-confirm-focus | the 375×667 row |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/sheet-focus.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/quick-confirm-focus.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/dialog-sheet.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/update-move-sheet.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run <each AckConfirm focus test> --maxWorkers=2

**Review focus:** the terminal drawer, where focus belongs in the terminal. Decided: the Sheet focuses the panel on open and never again, and xterm's own `term.focus()` on socket open takes it from there, inside the trap; the terminal drawer row pins it.

### Task P3-3: a pinned footer, and the seven action rows move into it (D-5932) — after P3-2

**Routing:** band 2 for the prop. The seven consumer moves are band 1 (`/handoff`, one consumer per commit, orchestrator-reviewed). **Lane:** PWA/UI.

**Files:**
- Modify `ui/src/primitives/sheet.tsx`: `footer?: ReactNode`, drawn after `.sheet-body` as `sheet-footer flex-none` with the side padding and the safe-area bottom. It is refused on `full` (type-level: `full` and `footer` are exclusive in `SheetProps`).
- Modify `ui/src/primitives/confirm.tsx` (`QuickConfirm`) and `pwa/src/fleet/{ArchiveConflictSheet,AbandonSheet,ArchiveSheet,WhatsNewSheet,UpdateMoveSheet,ResumeSheet}.tsx`: each `QC_ACTIONS` row moves into `footer`.
- Create `pwa/test/sheet-footer.test.tsx`. Modify `pwa/test/sheet.test-d.tsx` for the exclusive props. Follow on in the seven sheets' tests and `shape-census.test.ts`/`role-census.test.ts` as measured.

- [ ] **Step 0: Re-ground.** Run `git grep -l QC_ACTIONS pwa/src ui/src` and expect eight files: the seven sheets' files plus `ui/src/index.ts`'s export.
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
- Create `ui/src/lib/use-media-query.ts`. It holds `useMediaQuery`, moved from `pwa/src/lib/useMediaQuery.ts`, plus `DESK_QUERY` and `useDesk()`. `pwa/src/lib/useMediaQuery.ts` becomes a re-export. Modify `pwa/src/app.tsx` ≈:85, `pwa/src/docs/DocsHead.tsx` ≈:226 and `pwa/src/session/SessionDetails.tsx` ≈:79 to read `DESK_QUERY`.
- Modify `ui/design/make-themes.mjs` ≈:633: generate `--elev-pop` for the ten generated palettes. Run `npm run themes`, which regenerates `tokens.css`'s generated block; that block is never hand-edited.
- Modify `ui/src/styles/tokens.css` by hand **above** the generated block only: add `--elev-pop` beside `--elev-sheet` in the two hand-written default palettes (≈:412 dark `:root`, ≈:529 `[data-theme='light']`), which `themes:check` does not own.
- Modify `ui/src/styles/theme.css` ≈:256 (`--shadow-pop: var(--elev-pop)`, and the arm's two keyframes declared once: `sheet-pop-in`, a fade with a small rise, and `sheet-pop-out`, a fade) and `ui/src/styles/skins.css` (Instrument `--elev-pop: 0 0 0 1px var(--edge-strong)`).
- Modify `ui/src/primitives/sheet.tsx`:
  - `size?: 'sm' | 'md' | 'lg'`;
  - at `useDesk()`: `handleOnly` with no handle, no grabber, a ✕ (`Icon` button, `aria-label="Close"`);
  - the `min-[900px]:` placement, the radius and `shadow-pop`;
  - the `::after` removal, which absorbs the `fleet.css` precedent;
  - the arm's motion: literal `min-[900px]:data-[state=open]:[animation-name:sheet-pop-in]!` and `min-[900px]:data-[state=closed]:[animation-name:sheet-pop-out]!` classes, timed by P3-1's `VAUL_MOTION` variables (at ≥900 the panel sets `--vaul-in-dur:var(--dur-base)` and `--vaul-out-dur:var(--dur-fast)` with literal `min-[900px]:` classes);
  - `full` unchanged.
- Modify `pwa/src/fleet/fleet.css` ≈:3240–3255: delete `.whats-new-panel`. Modify `pwa/src/fleet/WhatsNewSheet.tsx` (`size="lg"`, drop the class) and `confirm.tsx` (`size="sm"`).
- Modify `ui/src/primitives/sheet.stories.tsx`: one story per size at desk width.
- Create `pwa/test/sheet-desktop-arm.test.tsx` and `pwa/browser/sheet-desktop-arm.browser.test.tsx`. Follow on in `theme-catalogue.test.ts`, `contrast.test.ts`, `control-census.test.ts` (the ✕), `shape-census.test.ts`, `design-system-boundary.test.ts`, `ui-package-boundary.test.ts`, `fleet-css.test.ts` and `whats-new-sheet.test.tsx`, as measured.

- [ ] **Step 0: Re-ground.** Run `git grep -n "min-width: 900px" pwa/src ui/src` and record the hits (at rev 2: three in TS, plus CSS `@media` rules, which stay; seven `pwa/test` files also carry it and stay). Confirm that `.whats-new-panel` is the only local centred-dialog rule: `git grep -n "margin: auto" pwa/src/**/*.css` near a `sheet-panel` class.
- [ ] **Step 1: Red.**
  - "≥900 in Refined and in Instrument: no `.sheet-grabber`, ✕ present"; "<900 in Instrument: the grabber is present";
  - "≥900: a ✕ named Close closes";
  - "≥900: a pointer drag on the panel does not close it";
  - "≥900: Escape and the scrim close";
  - "≥900: `size` sets 440/560/720";
  - "<900: the grabber is back and the drag closes";
  - "crossing 900 while open keeps the typed text in a child input";
  - "`full` is identical at both widths";
  - "every palette, including the two hand-written defaults, declares `--elev-pop`" (`theme-catalogue.test.ts`);
  - "Instrument's `--elev-pop` is the hairline";
  - "no `.whats-new-panel` rule exists";
  - "no `(min-width: 900px)` literal exists in `pwa/src/**/*.{ts,tsx}` or `ui/src/**/*.{ts,tsx}` outside `ui/src/lib/use-media-query.ts`" (test files, which parse CSS `@media` blocks, and CSS rules are out of its scope);
  - browser: "at 1280 the open panel's computed `animation-name` is `sheet-pop-in`, not `slideFromBottom`, and under `reduce` its computed `animation-duration` is `0.001s`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | grabber drawn at ≥900 | sheet-desktop-arm | "no `.sheet-grabber`" |
  | `handleOnly` false at ≥900 | sheet-desktop-arm | "a pointer drag … does not close it" |
  | arm chosen by skin, not width | sheet-desktop-arm | "≥900 in Refined and in Instrument", or "<900 in Instrument" |
  | arm remounts on crossing | sheet-desktop-arm | "keeps the typed text" |
  | `--elev-pop` hand-edited in `tokens.css`'s generated block | theme-catalogue (`themes:check`) | the generated-block row |
  | `--elev-pop` missing from a hand-written default | theme-catalogue | "every palette, including the two hand-written defaults" |
  | the arm left on vaul's slide | sheet-desktop-arm (browser) | the `animation-name` row |
  | `SessionDetails.tsx` keeps its literal | sheet-desktop-arm | "no `(min-width: 900px)` literal … outside" |
  | `.whats-new-panel` kept | sheet-desktop-arm | "no `.whats-new-panel` rule" |

- [ ] **Step 4: Verify.**

      cd pwa && ./node_modules/.bin/vitest run test/sheet-desktop-arm.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/theme-catalogue.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/control-census.test.ts --maxWorkers=2
      cd ui && npm run themes:check && npm test
      cd pwa && npm run test:browser -- --maxWorkers=2

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

### Task P3-6a: the workflow-control types, an empty table and its replay test (D-5935) — after nothing

**Routing:** band 2 (types and a test harness). **Lane:** SERVER.

**Files:**
- Modify `shared/workflows.ts`: `WorkflowControlAct = 'stop-run' | 'stop-agent' | 'skip-agent'` only. The table does not live in `shared/`, because it is server-only knowledge and `shared/` ships in the PWA bundle.
- Create `server/src/workflows/controls.ts`:
  - `WorkflowControlDrive`: `command` (a command template whose slots take only §4.3's validated tokens) or `view-keys` (the recorded keys);
  - each recipe carries `midTurn: boolean`, `startsTurn: boolean` and, for `view-keys`, the keys recorded inert in the main view;
  - `WORKFLOW_CONTROLS`, keyed by version only, **empty** in this task. A recipe rests on captures in both remote-control modes that agree (spec §4.2 step 2), so the server never reads a session's mode.
- Create `server/test/workflow-controls-table.test.ts`.

- [ ] **Step 0: Re-ground.** `shared/workflows.ts` is 69 lines; `server/src/workflows/` holds `read.ts` and `model.ts`.
- [ ] **Step 1: Red.**
  - "every `WORKFLOW_CONTROLS` row names a version with both an `rc/` and a `plain/` capture directory";
  - "a recipe whose `rc/` and `plain/` captures differ (view, keys, outcome or mid-turn) is not admitted";
  - "every recipe's keys or command text appear in that version's captures";
  - "every `view-keys` recipe either lists every key as inert in the main view or is marked not-mid-turn";
  - "no act outside the three";
  - "the table is defined once, in `server/src`" (`single-definition`; `topology-clean` keeps it out of `shared/` and `pwa/`).
- [ ] **Step 2: Green**, with the table empty; the rows hold vacuously, and a fixture row in the test itself proves each one reds.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a row with no capture directory | workflow-controls-table | "names a version with both … capture directories" |
| a row whose modes differ admitted | workflow-controls-table | "a recipe whose `rc/` and `plain/` captures differ … is not admitted" |
  | a recipe key absent from its captures | workflow-controls-table | "appear in that version's captures" |
  | the table moved to `shared/workflows.ts` | single-definition / topology-clean | "defined once, in `server/src`" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/workflow-controls-table.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

### Task P3-6b: record which workflow controls each Claude Code version has, and how each is driven (D-5939) — after P3-6a; **operator question O1**

**Routing:** band 3 (it is measurement, and it decides what is built). Native, done by a person or session with a scratch login on a machine that runs no fleet. Never on a fleet or server box.

**Files:**
- Create `server/test/fixtures/panes/workflow-view/<version>/<rc|plain>/*.txt`. These are captures with `-e`, fixture names only, and run ids rewritten to `wf_fixture…`.
- Create `docs/superpowers/research/2026-10-workflow-controls-capture.md`: the version × mode × act table (drive, confirm, outcome, works mid-turn, starts a turn, each key's main-view effect idle and mid-turn, and whether the two modes agree) and the procedure as run.
- Modify `server/src/workflows/controls.ts`: the recorded rows only.

- [ ] **Step 0: The procedure in spec §4.2, run as written.** Steps 1 to 3 (a)–(f), including (e2) and (e3), in both remote-control modes. An act whose two modes' records differ gets no row and is noted in the write-up; if every act differs, report it, because reading the mode is then a spec revision (spec §4.2 step 2). Record every capture before reading it into the table.
- [ ] **Step 1: Red.** P3-6a's table test, now over real rows: each new row first lands without its captures and must red.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a recorded row's capture deleted | workflow-controls-table | "names a version with both … capture directories" |
  | a `view-keys` close key not recorded inert, recipe marked mid-turn | workflow-controls-table | the inert-or-not-mid-turn row |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/workflow-controls-table.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts --maxWorkers=2

**Operator acts:** O1 (spec §7), which settles whose scratch login runs the capture. Until it is answered this task waits; P3-6a has already landed the empty table, so P3-7 is unblocked and P3-8 and P3-9 wait.

**Review focus:** every capture is free of names, hosts and paths. A recipe must not rest on a single capture of a view that redraws. Every recipe key's main-view effect is recorded.

### Task P3-7: the operator-only guards land before the door — classifier row, gate pin, no-composer census (D-5936) — after nothing

**Routing:** band 3 (approval path, security). Native, **two reviewers**. **Lane:** SERVER.

**Files:**
- Modify `server/src/coord/approvalguard.ts` ≈:205: one `FORBIDDEN_PATTERNS` row, `{ why: 'a workflow control', re: /\/api\/sessions\/['"]?[^/\s'"]+['"]?\/workflows\/['"]?[^/\s'"]+['"]?\/control(?![\w-])/ }`. Each segment tolerates one quote character on either side, as the approvals row tolerates `['"]?`, so a quote-split path such as `".../workflows/${RUN}"/control` still matches. The row applies to Bash text and MCP string leaves only; any other tool naming the path stays `escalate`, and the auth gate is its wall (spec §4.5).
- Modify `server/test/approvalguard.test.ts`. The new rows cover:
  - a `curl` naming the path is `forbidden`;
  - a path with a variable for the id is `forbidden`;
  - a quote-split path (`"$API/api/sessions/$ID/workflows/$RUN"/control`) is `forbidden`;
  - a read of `shared/workflows.ts` is unchanged.
- Modify `server/test/auth-gate.test.ts`: "no `EXEMPT` key matches `POST /api/sessions/:id/workflows/:runId/control`". It is written now and goes live when P3-8 registers the route.
- Create `server/test/workflow-control-census.test.ts`. Its rows:
  - "no tracked file under `ccd/` names the path shape" (a deny-list over the surfaces a session can run: `ccd/ccrc-api`, `ccd/ccd`, `ccd/session-hook.sh` and `ccd/coordinator-skill/`; `shared/api.ts` docstrings, `README.md` and `docs/` stay free to name the route). The matcher is `/api/sessions/<seg>/workflows/<seg>/control`, where `<seg>` is any of `:x`, `{x}`, `<x>`, `${x}`, `$x` or a literal id; the test's own rows prove each spelling matches;
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
  | a `ccrc-api workflow-stop` verb added | workflow-control-census | "`ccd/ccrc-api` has no subcommand", and "no tracked file under `ccd/`" |
  | the matcher drops the `${x}` spelling | workflow-control-census | its `${x}` spelling row |
  | the quote tolerance removed | approvalguard | the quote-split row |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/approvalguard.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/workflow-control-census.test.ts --maxWorkers=2

### Task P3-8: the verb — pane reader, pure plan, queued executor, typed refusals, `controls` and `key` on the frame (D-5937) — after P3-6b (a non-empty table), P3-7 and W1a C1c

**Routing:** band 3 (it sends keys into live sessions). Native, **two reviewers**. **Lane:** SERVER.

**Files:**
- Modify `server/src/pane/dialog.ts` ≈:51: export its `SGR` pattern and prompt glyph (both private today). This starts the consolidation wave's ARCH-63 stripper consolidation; the wave finishes it.
- Create `server/src/pane/workflowView.ts`. It reads the recorded view (rows, selection, footer, closed) and the act's outcome line, importing `pane/dialog.ts`'s `SGR` and glyph. A failed capture is `unmeasurable`.
- Modify `server/src/workflows/model.ts` ≈:35: export `KEY_RE` beside `RUN_ID_RE`. Modify `server/src/workflows/read.ts`: add `readRunOnce(io, dir, runId)`, a bounded one-shot read of one run's summary, journal and agent labels to the end within a byte budget, answering `undecided` when the budget runs out first. It reuses `SessionWorkflows`'s fold, so `read.ts` stays the one reader of the workflow files.
- Create `server/src/workflows/control.ts` (L1): `controlPlan(table, version, liveWord, rows, target, pane)` returns the steps or a refusal word; `rows` is `readRunOnce`'s answer.
  - **Tokens.** Command text is composed only from validated tokens, checked with `model.ts`'s `RUN_ID_RE` and `KEY_RE` (imported; `control.ts` declares no token regex of its own), and a label only when it is printable with no C0/C1 control character and at most 64 characters. Anything else is `agent-ambiguous` (an agent) or `unknown-run` (a run), with zero keys.
  - **Fresh rows.** `:runId` and `agentKey` are matched against `readRunOnce`'s rows before any key. `undecided` is `rows-unread`, with zero keys.
  - **Mid-turn.** With a running-turn `liveWord` (the reading `interruptVerdict` uses) and a recipe whose `midTurn` is false, the answer is `turn-running` with zero keys. A `view-keys` recipe with any key not recorded inert in the main view is planned only when `liveWord` is not a running turn.
- Modify `server/src/inject/send.ts`: `controlWorkflow(d, id, …)` inside `d.queue.run`. Before it acts it checks the dialog/menu, the draft and the box (`hasMenu`, `draftOfMeasured`). It then runs capture, verify, one key, up to a budget. Immediately before the close key, and before any other key not recorded inert, it **re-reads the live word and captures**, and sends the key only while no turn is running and the capture shows the view; a running turn there answers `view-left-open` with that key unsent. So it never sends Escape in the main view, even when the act itself started a turn (spec §4.2 (e3)). It confirms the outcome only through `readRunOnce` or `pane/workflowView.ts`; a sent act with no confirmed outcome is `sent-unconfirmed`.
- Modify `server/src/server.ts` ≈:2597, beside `/interrupt`: `POST /api/sessions/:id/workflows/:runId/control`. The body check gives 400 on a missing or blank `expect`. The route answers 404 `unknown-session` and 409 for refusals, and records the outcome through the `NoticeSink` W1a's C1c passes to the server's routes, in `record-only` mode. It adds no `recordFeedEvent(` call (W0's feed census) and, if C1e has landed, adds its writer to C1e's pinned set in the same PR. The handler stays a registration and a body check; the logic is in the files above, so `server.ts`'s C0a growth row stays small.
- Modify `shared/api.ts`: the `WorkflowControlRefusal` union (with `turn-running`, `rows-unread` and `view-left-open`) and its result type.
- Modify `shared/workflows.ts` (`WorkflowAgentView.key`, `WorkflowView.controls?`), `server/src/workflows/model.ts` (`key` from `foldJournal`; `controls` in `workflowsFrame` from the version, the token rules and the table) and `server/src/sessionws.ts` (pass the session's `FleetSession.version`, one argument; a null version gives no controls). No mode is read anywhere (spec §4.2 step 2).
- Create `server/test/workflow-view-pane.test.ts`, `workflow-control-plan.test.ts` and `workflow-control-route.test.ts`. Modify `session-workflows-frame.test.ts`, `workflows-model.test.ts`, `workflows-read.test.ts` (`readRunOnce`) and `single-definition.test.ts` (two rows: `pane/workflowView.ts` declares no SGR or escape regex of its own, five copies existing elsewhere today, so that row is scoped to the new file; and `RUN_ID_RE` and `KEY_RE` are each defined once, in `workflows/model.ts`).

- [ ] **Step 0: Re-ground.**
  - Read P3-6b's write-up. Confirm that each recipe's drive kind is `command` or `view-keys`. Stop and report if the record shows anything else.
  - Read `interrupt` and `submitEnter` as they stand.
  - Confirm that W1a's C1c has landed (`server/src/notice.ts`, the `NoticeSink` in the route deps). If it has not, this task waits; it adds no hand-written feed pair. Check whether C1e's pinned writer set exists.
- [ ] **Step 1: Red.**
  - "every capture replays to its recorded view";
  - "`controlPlan` refuses `not-offered` for an unlisted version and `version-unmeasured` for null";
  - "a draft in the box refuses `draft-present` with zero keys sent";
  - "an open ask refuses `dialog-open` with zero keys";
  - "a selection that does not move refuses `selection-lost` and closes the view";
  - "no `Escape` is sent when the capture shows no view";
  - "race: the fake `Tmux` closes the view after the capture, and no Escape or other recipe key follows";
  - "a label containing `\n`, `\r` or `\x1b[` gets no agent control on the frame, and the route sends zero `sendLiteral` calls";
  - "a `:runId` outside the charset is refused with zero keys";
  - "with the live word `busy` and a `midTurn: false` recipe, zero keys are sent and the answer is `turn-running`";
  - "a real `v1:<64 hex>` agent key is accepted, and a 65-character key outside `KEY_RE` is refused with zero keys";
  - "a `readRunOnce` that answers `undecided` refuses `rows-unread` with zero keys";
  - "the live word turns `busy` after the act key: no close key is sent, and the answer is `view-left-open`";
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
  | Escape sent when the capture shows no view | workflow-control-route | "no `Escape` is sent when the capture shows no view", and the race row |
  | raw label typed | workflow-control-route | the control-character label row |
  | `liveWord` ignored | workflow-control-plan | the `turn-running` row |
  | live word read only at plan time, not before the close key | workflow-control-route | the `view-left-open` row |
  | a local token regex in `control.ts` (`^[A-Za-z0-9_.:-]{1,64}$`) | workflow-control-route, single-definition | the real-key row, and the `KEY_RE` row |
  | `undecided` read treated as a match | workflow-control-route | the `rows-unread` row |
  | outcome check skipped (success on send) | workflow-control-route | "answers `sent-unconfirmed`" |
  | executor outside `queue.run` | workflow-control-route | "never interleave" |
  | per-key verify removed | workflow-control-route | "refuses `selection-lost`" |
  | `controls` offered on a null version | session-workflows-frame | "absent for … a null version" |
  | a second SGR pattern in `workflowView.ts` | single-definition | the new file-scoped `workflowView.ts` row |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/workflow-view-pane.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/workflow-control-plan.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/workflow-control-route.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/session-workflows-frame.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/workflows-read.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd server && npx tsc --noEmit

**Review focus:** the auto-swap. Nothing holds a swap lock, and the view is closed before the queue slot is released except in the `view-left-open` case, where closing it would interrupt a turn. That answer names the open view. The C0a growth table goes in the PR body.

### Task P3-9: the controls on the session page — Stop workflow and the per-agent menu, danger confirms, refusal words, renders (D-5938) — after P3-3, P3-4, P3-5 and P3-8

**Routing:** band 2 for the UI, band 3 for the confirm wording (the orchestrator checks it against P3-6b's record). **Lane:** PWA/UI.

**Files:**
- Modify `ui/src/components/workflow-strip.tsx` and `workflow-strip.css`:
  - a Stop control on a row whose `controls` has `stop-run` (`Button variant="danger"`);
  - a ⋯ per running agent with a `key` when an agent act is offered: `Popover` at `useDesk()`, otherwise a `Sheet`;
  - every act through `QuickConfirm tone="danger"`, with the loss sentence from the row's counts and the recorded outcome;
  - an `onControl(runId, act, agentKey?)` prop.
- Modify `ui/src/components/workflow-strip.stories.tsx`.
- Create `pwa/src/session/workflowControlWords.ts`: words for every `WorkflowControlRefusal` (the PWA's `*Words.ts` convention; consolidation K14 is moving refusal tables out of `lib/api.ts`).
- Modify `pwa/src/lib/api.ts` (only `workflowControl(id, runId, body)`, the fetch) and `pwa/src/screens/SessionScreen.tsx` ≈:603 (pass `onControl`, then a toast for the result).
- Modify `pwa/test/workflow-strip.test.tsx`. Create `pwa/test/workflow-control-words.test.ts`.

- [ ] **Step 0: Re-ground.** Read P3-6b's recorded outcomes. The confirm sentence may claim only what they show.
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

- **O1** (P3-6b): whose scratch login runs the capture. Nothing else waits on the operator. P3-1 to P3-5, P3-6a and P3-7 proceed without an answer; P3-8 waits for P3-6b (and W1a C1c), and P3-9 waits for P3-3, P3-4, P3-5 and P3-8.

## Rollback

Each task is a plain revert:
- P3-4's revert restores `.whats-new-panel` with it.
- P3-8's wire fields are additive. A PWA newer than the server sees no `controls` and offers nothing.
- P3-7's guards may stay after a P3-8 revert, because they refuse a path that no longer exists.

## Deviations and decisions

### Issued for this work and defined here

The block 5930 to 5939 was issued to this programme. This plan defines all ten, one per task: D-5930 to D-5938 for P3-1 to P3-9 (D-5935 for P3-6a), and D-5939 for P3-6b.

- **D-5930** — `sheet-motion-on-keyframes` (Task P3-1): vaul animates by keyframes, so the Sheet and the palette retime `animation-duration`/`-timing-function` through one literal class set, `VAUL_MOTION`, read from per-surface variables set on the motion tokens (Tailwind emits CSS only for literal classes), and the reduced-motion and Instrument values reach every vaul surface. The transition utilities that never moved vaul are removed.
- **D-5931** — `sheet-owns-focus` (Task P3-2): the Sheet moves focus in on open, through a callback ref on its content when the panel mounts and an effect keyed on `open` when a reopen reuses it (the caller's `initialFocus`, else the panel itself, never an input, so a phone keyboard never rises unasked), keeps Radix's trap, and returns focus to the opener on close; a text-field opener gets it back only on a fine pointer. `useCancelFirst` keeps only the choice of Cancel, and its give-back half is deleted.
- **D-5932** — `sheet-pinned-footer` (Task P3-3): `Sheet` gains a `footer` slot outside the scrolling body, pinned at every width and exclusive with `full`. The seven `QC_ACTIONS` rows move into it.
- **D-5933** — `sheet-desktop-arm` (Task P3-4): at ≥900 (`DESK_QUERY`, written once in `ui/`), a sheet is a centred dialog in sm/md/lg (440/560/720) on `--elev-pop` (generated, and hand-written in the two default palettes; Instrument: hairline), with a ✕, no grabber, no drag, and its own fade-and-rise keyframes. The arm is chosen by width, never by skin, and the terminal drawer is unchanged. `.whats-new-panel` is deleted. This task alone meets skins S18's desktop-arm gate.
- **D-5934** — `popover-on-radix` (Task P3-5): a `Popover` primitive on `@radix-ui/react-popover`, sharing the Radix layers vaul already brings in. Its first consumer is the workflow strip's per-agent menu at ≥900.
- **D-5935** — `workflow-controls-measured` (Task P3-6a): workflow controls exist in ccrc only as `WORKFLOW_CONTROLS` rows in `server/src/workflows/controls.ts` (server-only), keyed by Claude Code version only, each backed by recorded captures in both remote-control modes that agree, which a replay test reads; the server never reads a session's mode. The acts are `stop-run`, `stop-agent` and `skip-agent`, and the drives are `command` (preferred, addressed by name) or `view-keys` (verified after every key). Each recipe records `midTurn`, `startsTurn` and which keys are inert in the main view. P3-6a lands the types, the empty table and the replay test.
- **D-5939** — `workflow-controls-captured` (Task P3-6b): the captures from a scratch machine that runs no fleet (throwaway `HOME`, private tmux socket, both remote-control modes, rows only where the two agree), the research write-up, and the table's rows. A version with no row is offered nothing and shown as not yet recorded; re-recording is the coordinator's on that trigger, and a row never covers a later version.
- **D-5936** — `workflow-control-operator-only` (Task P3-7): the control verb is operator-only in three layers. It is absent from the auth gate's `EXEMPT`, the classifier forbids any request naming it, and no `ccrc-api` verb composes it. A census reds the day a session verb composes it without a deny rule.
- **D-5937** — `workflow-control-verb` (Task P3-8): `POST /api/sessions/:id/workflows/:runId/control` drives Claude Code's own mechanism through the per-session key queue, with a pure plan over a bounded one-shot read (`readRunOnce`), a capture/verify loop, a typed refusal for every failure (including `turn-running`, `rows-unread` and `view-left-open`), `sent-unconfirmed` kept apart from success, command text only from tokens checked with the reader's own `RUN_ID_RE` and `KEY_RE`, a live-word re-read before every non-inert key so no Escape reaches the main view, outcomes recorded through W1a's `NoticeSink` in `record-only` mode, no wake and no swap lock. `controls` and the agent `key` are additive frame fields computed by the server.
- **D-5938** — `workflow-controls-ui` (Task P3-9): the session page's workflow strip offers only the server's `controls`: Stop workflow and a per-agent menu (a popover at ≥900, a sheet below), each behind a danger confirm that names what is lost from recorded outcomes, with words for every refusal. Fleet cards are unchanged.


### Departures made while landing

- **D-6018** — `popover-pwa-copy` (Task P3-5, extends D-5934): pwa carries its own `@radix-ui/react-popover`, on the Radix line its own vaul resolves (1.1.20 beside dialog 1.1.20; `ui/` takes 1.1.23 beside its dialog 1.1.23, both under `~1.1.20`), and `vite.config.ts` lists it in `dedupe` and `alias` as it does vaul. Without that copy ui's source resolves the popover from `ui/node_modules` and reaches a second React, which the config's own header says fails only under test as "Invalid hook call". The plan's Files named only `ui/`.
- **D-6019** — `shadow-pop-interim` (Task P3-5, extends D-5934): `theme.css` maps `--shadow-pop` here, as `var(--elev-sheet)`, because P3-5 lands before P3-4 declares `--elev-pop`, an unmapped `shadow-pop` emits no CSS, and the theme-bridge and css-vars guards refuse a `var()` onto a token no palette declares, even as a fallback. Until P3-4 lands a popover wears the sheet's elevation; P3-4 declares `--elev-pop` and repoints this one line to it.
- **D-6022** — `workflow-control-census-whole-ccd` (Task P3-7, extends D-5936): the no-composer census scans every tracked file under `ccd/`, not only the four surfaces P3-7 names, so the worker, reviewer and history skills and every script are covered as spec §4.5 states; the four named surfaces must each stay tracked. Its coverage row pins only that every composing verb has a child deny rule and a classifier row, so a defensive workflow deny rule added with no composer stays green.
- **D-6028** — `quick-confirm-default-focus-row` (Task P3-2, extends D-5931): `quick-confirm-focus.test.tsx`'s first row is rewritten, not only re-imported as the plan's Files allowed. It pinned "the opener keeps the focus" for a QuickConfirm with no `defaultFocus`, which is exactly what D-5931 replaces (the focus stayed behind the scrim of an open modal). What it guarded is kept: no answer is pre-selected. The row now asserts the panel takes the focus, neither Cancel nor the confirm, and closing gives it back to the opener. The other five rows are unchanged.
- **D-6029** — `ask-keys-coarse-focus-row` (Task P3-2, extends D-5931): `ask-keys.test.tsx`'s coarse-pointer row is rewritten; the plan's Files did not name it. It pinned the composer keeping the focus behind the open ask sheet's scrim, which spec §2.4 replaces ("the Sheet still takes the focus on open"). What it guarded is kept: under a coarse pointer no row takes the focus, so no keyboard rises, and a key in the composer is text, never an answer. `useAskKeys`' own fine-pointer move to the cursor row (about a frame after open) is the ask keyboard's roving tabindex, not a second open or give-back owner, and is unchanged.

Issued and unused (Task P3-2): none; both spares are defined above.


## Review log

### Rev 0 review (applied in rev 1)

Rev 0 was reviewed before it landed. Each finding was checked against base `397be1ec5` and the open PRs, and then applied or rejected. All were applied.

| # | Sev. | Finding | Checked | Outcome |
|---|---|---|---|---|
| 1 | high | A runtime `vaulMotion` builds interpolated Tailwind classes that get no CSS, and moving `PALETTE_MOTION` onto it silently stops the palette's working retiming; jsdom reds stay green | Tailwind ^4.3.3 with `@source`; `PALETTE_MOTION` is four literals today | Applied: one literal `VAUL_MOTION` set over per-surface variables, a no-template-literal scan, and a browser leg reading the computed duration (P3-1, spec §2.3) |
| 2 | high | A `command` drive would type a raw script- or model-written label into a live pane | labels come from the journal or the meta `description`, unchecked | Applied: command text only from validated tokens, the route re-matches rows, and control-character reds (spec §4.3, P3-8) |
| 3 | high | "Never Escape in the main view" cannot hold if the recorded close key is Escape (a race between capture and key) | — | Applied: (e2) records every key's main-view effect; a non-inert key only while no turn runs, captured right before; a race red replaces the mutant (spec §4.2–§4.4, P3-6a, P3-8) |
| 4 | med | Only ten palettes are generated; the two defaults are hand-written | `tokens.css` ≈:412, ≈:529, block ≈:545–:1267 | Applied: hand-add `--elev-pop` to both; red covers every palette (P3-4, spec §1.1, §2.2) |
| 5 | med | A third `(min-width: 900px)` literal, and W2/W3 collisions | `SessionDetails.tsx` ≈:79 | Applied: the file is added, the pin is scoped to "outside `use-media-query.ts`", and Gates rows are added for W2 S3 and W3 |
| 6 | med | P3-2 misses `UpdateMoveSheet` and `AckConfirm`; `useCancelFirst` returns a callback ref | `UpdateMoveSheet.tsx` ≈:284, `updateAck.ts` ≈:147, `confirm.tsx` ≈:71 | Applied: both files, a `RefObject` return, and the Ack-commit red |
| 7 | med | `onOpenAutoFocus` skips the reopen-during-close path | vaul 1.1.2 forwards it, then `preventDefault` when `autoFocus` is false | Applied: an effect keyed on `open`; `onOpenAutoFocus` only suppresses; a reopen red |
| 8 | med | The centred arm still runs vaul's slide | — | Applied: `sheet-pop-in`/`-out` keyframes in `theme.css`, literal `animation-name` classes, and a browser red |
| 9 | med | No mid-turn input or refusal | — | Applied: `midTurn` per recipe, `liveWord` into `controlPlan`, `turn-running` |
| 10 | med | No launch mode for captures; RC panes render differently | `interrupt`'s RC note in `inject/send.ts` | Applied: both modes recorded, table keyed by `(version, mode)`, unreadable mode means no controls (superseded in rev 2 by the rev 1 review's #2: keyed by version, both modes must agree) |
| 11 | med | The Gates table is stale | re-measured all 27 open PRs | Applied: #821, #722 (`sessionws.ts`, `single-definition`), #737, #817, #422–#424 rows added; the sentence corrected |
| 12 | med | `dialog.ts`'s SGR is private and `single-definition` has no stripper row | `dialog.ts` ≈:51, `send.ts` ≈:129 | Applied: export from `dialog.ts` (ARCH-63 overlap noted) and a file-scoped row |
| 13 | med | A self-opened sheet over the composer moves focus and raises the keyboard on give-back | — | Applied: a text-field opener gets focus back only on a fine pointer; pinned both ways |
| 14 | low | The double-give-back mutant cannot red | — | Applied: a source-scan red on `confirm.tsx` |
| 15 | low | The recipe table in L0 `shared/` ships to the PWA | — | Applied: `server/src/workflows/controls.ts` |
| 16 | low | Refusal words in `lib/api.ts` grow what K14 shrinks | — | Applied: `pwa/src/session/workflowControlWords.ts` |
| 17 | low | No refresh policy for exact-version keys | — | Applied: spec §4.2 step 5 (the trigger, the owner, no range carry-over) |
| 18 | low | The census reds on the docs that name the path | — | Applied: allowed set named exactly, including `docs/` |
| 19 | low | An empty-table P3-6 breaks "one task, one PR" | — | Applied: split into P3-6a (D-5935) and P3-6b (D-5939, the issued spare) |
| 20 | low | `test:browser` without `--maxWorkers=2`; `QC_ACTIONS` is in eight files | `git grep -l` gives 8 | Applied: both corrected |

### Rev 1 review (applied in rev 2)

Rev 1 (ten tasks, D-5930 to D-5939) was reviewed at its head. Each finding was checked again on `643c76cd4` and then applied or rejected. All thirteen were applied.

| # | Sev. | Finding | Checked | Outcome |
|---|---|---|---|---|
| 1 | high | On a first open the `open`-keyed effect runs before the panel mounts, so "focus `initialFocus` or the panel" finds nothing; the spec dropped `useCancelFirst`'s mount half | `confirm.tsx` ≈:51–56 says Cancel "has not mounted yet" in that effect; `UpdateMoveSheet` unmounts its Sheet when closed | Applied: a callback ref on `Drawer.Content` for the first open, and the effect only for the reopen and the give-back; the spec's "measured order" sentence corrected; reds for a first open and `UpdateMoveSheet`, and a "callback-ref path removed" mutant (spec §2.4, P3-2) |
| 2 | high | P3-8 keys the table on a remote-control mode that no server file reads | `git grep` finds no mode reader in `server/src` or `shared/`; ccd decides it at spawn | Applied: the table is keyed by version only, and a recipe is admitted only when its RC and plain captures agree, so no mode is read and ccd stays the one owner; a mode reader is a spec revision if P3-6b finds every act differs (spec §4.2 step 2, P3-6a, P3-6b, P3-8) |
| 3 | med | The agent-key token rejects every real key, and the run-id token is a looser second definition | `KEY_RE` `^v\d+:[0-9a-f]{64}$` and `RUN_ID_RE` in `model.ts` ≈:32–35 | Applied: `KEY_RE` exported, both imported by `control.ts`, no new token regex; a real-key red and a `single-definition` row (spec §4.3, P3-8) |
| 4 | med | No named fresh read of the rows; the executor would become a second reader of the workflow files | `SessionWorkflows` is per socket and capped per tick (`read.ts` ≈:52–53, `sessionws.ts` ≈:571) | Applied: `readRunOnce` in `read.ts`, bounded, answering `undecided`, refused as `rows-unread`; the executor confirms only through it or the pane reader (spec §4.3, P3-8) |
| 5 | med | The census allow-list reds on `shared/api.ts` docstrings and `README.md`, and names no spellings | 66 `POST /api/` mentions in `shared/api.ts`, 71 in `README.md` | Applied: a deny-list over `ccd/`, with the matcher's `:x`, `{x}`, `<x>`, `${x}`, `$x` and literal spellings named and each pinned (spec §4.5, P3-7) |
| 6 | med | The live-word bound is checked only at plan time, and the act itself may start a turn before the close key | — | Applied: item (e3), a live-word re-read with the capture before every non-inert key, `view-left-open`, and a red (spec §4.2–§4.4, P3-8) |
| 7 | med | Stale context: the consolidation spec is ruled rev 2.1, #813 merged, and the W0 and W1a plans are missing from Gates | consolidation spec header; `gh pr view 813`; the W0 and W1a plans on `main` | Applied: rebased onto `643c76cd4`; rev 2.1 cited as ruled; S18 applied in the W2 plan itself; Gates rows for C0a, C0c/C0d, C1c, C1d and C1e; P3-8 records through C1c's `NoticeSink` in `record-only` mode and lands after it |
| 8 | med | P3-9 uses `useDesk()`, which P3-4 creates, but P3-4 was not among its gates | — | Applied: P3-4 added to P3-9's heading, Gates row and Operator acts |
| 9 | low | The "palette given its own recipe again" mutant survives the `--vaul-` row; Step 4 skips the server suite | — | Applied: a "no `animation-duration:` or `animation-timing-function:` literal in `ui/src` outside `motion.ts`" row, "`PALETTE_MOTION` starts with `VAUL_MOTION`", and the suite in Step 4 (P3-1) |
| 10 | low | The 900px literal pin reds on seven `pwa/test` files that parse CSS | `git grep -l` gives seven | Applied: the pin is scoped to `pwa/src` and `ui/src` TS/TSX (spec §2.1, P3-4) |
| 11 | low | The "arm chosen by skin" mutant's red row did not exist | — | Applied: rows for ≥900 in both skins and <900 in Instrument (P3-4) |
| 12 | low | The terminal drawer's focus was left to the implementer | `TerminalDrawer.tsx` ≈:430 `term.focus()` on socket open | Applied: decided (the Sheet focuses the panel once; xterm takes it on socket open, inside the trap); a red and a mutant (spec §2.4, P3-2) |
| 13 | low | Review focus numbered out of order; the classifier wording overstates; a quote-split path escapes the regex | `FORBIDDEN_PATTERNS` applies to Bash text and MCP string leaves | Applied: renumbered; the wording narrowed to Bash or MCP requests; the regex tolerates a quote beside each `/`, with a quote-split red (spec §4.5, P3-7) |

## Out of scope

- The toast and `QuickConfirm` polish that the skins W1 row orders after the arm.
- Moving the ask sheet onto new chrome beyond the arm (skins W4).
- Any non-interactive control surface P3-6b might find, which needs a spec revision.
- Resuming a stopped workflow.
- Workflow controls on fleet cards.
- A `ccrc-api` verb for any of this.
- The consolidation wave's W7 PWA gates.
